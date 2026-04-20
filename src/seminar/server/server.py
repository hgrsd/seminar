"""FastAPI server for Seminar web UI."""

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from seminar import config, db, providers, service
from seminar.config import Config
from seminar.server.broadcast import BroadcastHub
from seminar.server.routers import annotations, ideas, proposals, studies, system, threads, workers
from seminar.server.thread_responder import ThreadResponderRunner
from seminar.server.worker_serialization import serialize_worker, serialize_workers
from seminar.service.annotations import AnnotationService
from seminar.service.ideas import IdeaService
from seminar.service.initial_expectations import InitialExpectationService
from seminar.service.proposals import ProposalService
from seminar.service.runs import RunService
from seminar.service.search import SearchService
from seminar.service.studies import StudyService
from seminar.service.threads import ThreadService
from seminar.workers import WorkerPool
from seminar.workers.factory import (
    make_connective_research_worker,
    make_follow_up_worker,
    make_initial_exploration_worker,
)

log = logging.getLogger(__name__)

LOCK_PATH = Path.home() / ".seminar" / "seminar.lock"
FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"


class SPAStaticFiles(StaticFiles):
    """Serve index.html for frontend routes while preserving asset 404s."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code != 404 or "." in Path(path).name:
            return response
        directory = self.directory
        if directory is None:
            return response
        return FileResponse(Path(directory) / "index.html")


def _acquire_file_lock():
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock_file = open(LOCK_PATH, "w")
    try:
        import fcntl
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except ImportError:
        pass
    except OSError:
        lock_file.close()
        print("ERROR: Another seminar instance is already running.", file=sys.stderr)
        sys.exit(1)
    return lock_file


def _release_file_lock(lock_file) -> None:
    try:
        import fcntl
        fcntl.flock(lock_file, fcntl.LOCK_UN)
    except ImportError:
        pass
    lock_file.close()


@dataclass
class AppContext:
    cfg: Config
    started_at: str
    hub: BroadcastHub
    annotation_service: AnnotationService
    idea_service: IdeaService
    initial_expectation_service: InitialExpectationService
    study_service: StudyService
    thread_service: ThreadService
    proposal_service: ProposalService
    search_service: SearchService
    run_service: RunService
    thread_runner: ThreadResponderRunner
    pool: WorkerPool


def _build_context(cfg: Config, loop: asyncio.AbstractEventLoop) -> AppContext:
    db.configure(Path(cfg.data_dir))
    db.init_db()
    connect = db.connect
    provider = providers.load(cfg.provider)

    hub = BroadcastHub()
    hub.set_loop(loop)

    run_service = RunService(cfg.logs_dir, provider, connect)
    study_service = StudyService(cfg.scratch_dir, cfg.follow_up_research_cooldown_minutes, connect)
    idea_service = IdeaService(cfg.scratch_dir, connect)
    thread_service = ThreadService(connect)

    pool = WorkerPool(
        study_service=study_service,
        run_service=run_service,
        on_event=hub.on_event,
        on_worker_state=lambda ws: hub.publish_event(
            "worker_upserted",
            serialize_worker(ws.worker_id, ws, cfg.provider),
        ),
        on_worker_removed=lambda wid: hub.publish_event("worker_removed", {"id": wid}),
    )

    return AppContext(
        cfg=cfg,
        started_at=datetime.now(timezone.utc).isoformat(),
        hub=hub,
        annotation_service=AnnotationService(connect),
        idea_service=idea_service,
        initial_expectation_service=InitialExpectationService(connect),
        study_service=study_service,
        thread_service=thread_service,
        proposal_service=ProposalService(connect),
        search_service=SearchService(connect),
        run_service=run_service,
        thread_runner=ThreadResponderRunner(
            cfg, loop, run_service, thread_service, idea_service, study_service, hub,
        ),
        pool=pool,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    lock_file = _acquire_file_lock()
    cfg = config.load()
    ctx = _build_context(cfg, asyncio.get_running_loop())

    app.state.hub = ctx.hub
    app.state.annotation_service = ctx.annotation_service
    app.state.idea_service = ctx.idea_service
    app.state.initial_expectation_service = ctx.initial_expectation_service
    app.state.study_service = ctx.study_service
    app.state.thread_service = ctx.thread_service
    app.state.proposal_service = ctx.proposal_service
    app.state.search_service = ctx.search_service
    app.state.run_service = ctx.run_service
    app.state.thread_runner = ctx.thread_runner
    app.state.pool = ctx.pool
    app.state.cfg = ctx.cfg
    app.state.started_at = ctx.started_at

    ctx.run_service.on_run_updated = lambda: ctx.hub.publish_event(
        "session_cost_changed",
        ctx.run_service.session_cost(ctx.started_at),
    )

    orphaned = ctx.study_service.reset_orphaned()
    if orphaned:
        ctx.hub.emit(f"Cleaned up orphaned locks for: {', '.join(orphaned)}")

    for _ in range(cfg.workers.initial):
        ctx.pool.spawn(make_initial_exploration_worker(cfg))
    ctx.hub.emit(f"Started {cfg.workers.initial} initial exploration worker(s)")
    for _ in range(cfg.workers.follow_up):
        ctx.pool.spawn(make_follow_up_worker(cfg))
    ctx.hub.emit(f"Started {cfg.workers.follow_up} follow-up research worker(s)")
    for _ in range(cfg.workers.connective):
        ctx.pool.spawn(make_connective_research_worker(cfg))
    ctx.hub.emit(f"Started {cfg.workers.connective} connective research worker(s)")

    ctx.hub.set_snapshot_factory(lambda: _snapshot_payload(app))
    yield
    await ctx.pool.shutdown()
    _release_file_lock(lock_file)


def _snapshot_payload(app: FastAPI) -> dict:
    return {
        "ideas": [asdict(s) for s in app.state.idea_service.status_all()],
        "workers": serialize_workers(
            app.state.pool,
            app.state.cfg.provider,
            app.state.thread_runner.active_worker_states(),
        ),
        "activity": app.state.hub.activities,
        "study_counts": app.state.study_service.counts(),
        "proposals": [asdict(p) for p in app.state.proposal_service.list_all()],
        "threads": [asdict(t) for t in app.state.thread_service.list_all()],
        "paused": service.is_paused(),
        "session_cost": app.state.run_service.session_cost(app.state.started_at),
        "responders": app.state.thread_runner.available_responders(),
    }


app = FastAPI(lifespan=lifespan)

app.include_router(annotations.router)
app.include_router(ideas.router)
app.include_router(proposals.router)
app.include_router(studies.router)
app.include_router(workers.router)
app.include_router(system.router)
app.include_router(threads.router)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    hub: BroadcastHub = app.state.hub
    async with hub.connect(ws):
        await hub.send_snapshot(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass


if FRONTEND_DIST.exists():
    app.mount("/", SPAStaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


def run(port: int = 8765, headless: bool = False) -> None:
    import uvicorn

    url = f"http://localhost:{port}"
    print(f"Starting Seminar at {url}")

    if not headless:
        import threading
        import time
        import webbrowser

        def open_browser():
            time.sleep(3)
            webbrowser.open(url)

        threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
