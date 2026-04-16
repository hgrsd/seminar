"""FastAPI server for Seminar web UI."""

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from seminar import config, db, providers, service
from seminar.server.broadcast import BroadcastHub
from seminar.server.routers import ideas, proposals, studies, system, workers
from seminar.service.ideas import IdeaService
from seminar.service.proposals import ProposalService
from seminar.service.runs import RunService
from seminar.service.search import SearchService
from seminar.service.studies import StudyService
from seminar.workers import WorkerPool
from seminar.workers.factory import (
    make_connective_research_worker,
    make_follow_up_worker,
    make_initial_exploration_worker,
)

log = logging.getLogger(__name__)

LOCK_PATH = Path.home() / ".seminar" / "seminar.lock"
FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    lock_file = _acquire_file_lock()

    cfg = config.load()
    db.configure(Path(cfg.data_dir))
    db.init_db()
    connect = db.connect
    provider = providers.load(cfg.provider)

    hub = BroadcastHub()
    hub.set_loop(asyncio.get_running_loop())

    app.state.hub = hub
    app.state.idea_service = IdeaService(cfg.scratch_dir, connect)
    app.state.study_service = StudyService(cfg.scratch_dir, cfg.follow_up_research_cooldown_minutes, connect)
    app.state.proposal_service = ProposalService(connect)
    app.state.search_service = SearchService(connect)
    app.state.run_service = RunService(cfg.logs_dir, provider, connect)
    app.state.cfg = cfg
    app.state.started_at = datetime.now(timezone.utc).isoformat()

    def publish_session_cost() -> None:
        hub.publish_event(
            "session_cost_changed",
            app.state.run_service.session_cost(app.state.started_at),
        )

    app.state.run_service.on_run_updated = publish_session_cost

    orphaned = app.state.study_service.reset_orphaned()
    if orphaned:
        hub.emit(f"Cleaned up orphaned locks for: {', '.join(orphaned)}")

    app.state.pool = WorkerPool(
        study_service=app.state.study_service,
        run_service=app.state.run_service,
        on_event=hub.on_event,
        on_worker_state=lambda ws: hub.publish_event(
            "worker_upserted",
            workers.serialize_worker(ws.worker_id, ws),
        ),
        on_worker_removed=lambda wid: hub.publish_event(
            "worker_removed",
            {"id": wid},
        ),
    )

    for _ in range(cfg.workers.initial):
        app.state.pool.spawn(make_initial_exploration_worker(cfg))
    hub.emit(f"Started {cfg.workers.initial} initial exploration worker(s)")
    for _ in range(cfg.workers.follow_up):
        app.state.pool.spawn(make_follow_up_worker(cfg))
    hub.emit(f"Started {cfg.workers.follow_up} follow-up research worker(s)")
    for _ in range(cfg.workers.connective):
        app.state.pool.spawn(make_connective_research_worker(cfg))
    hub.emit(f"Started {cfg.workers.connective} connective research worker(s)")

    hub.set_snapshot_factory(lambda: _snapshot_payload(app))
    yield
    await app.state.pool.shutdown()
    _release_file_lock(lock_file)


def _snapshot_payload(app: FastAPI) -> dict:
    return {
        "ideas": [asdict(s) for s in app.state.idea_service.status_all()],
        "workers": workers.serialize_workers(app.state.pool),
        "activity": app.state.hub.activities,
        "study_counts": app.state.study_service.counts(),
        "proposals": [asdict(p) for p in app.state.proposal_service.list_all()],
        "paused": service.is_paused(),
        "session_cost": app.state.run_service.session_cost(app.state.started_at),
    }


app = FastAPI(lifespan=lifespan)

app.include_router(ideas.router)
app.include_router(proposals.router)
app.include_router(studies.router)
app.include_router(workers.router)
app.include_router(system.router)


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
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


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
