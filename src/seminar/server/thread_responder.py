"""On-demand stateless thread responder runs."""

from __future__ import annotations

import asyncio
import json
import shlex
from dataclasses import asdict
from itertools import count

from seminar.config import Config
from seminar.server.broadcast import BroadcastHub
from seminar.service.ideas import IdeaService
from seminar.service.runs import RunService, RunType
from seminar.service.studies import StudyService
from seminar.service.threads import ThreadService
from seminar.workers.agent import default_spawn
from seminar.workers.factory import _render_skill
from seminar.workers.types import AgentResult, ThreadResponderWorker, WorkerState, WorkerStatus
from seminar.workers.workspace import worker_workspace

THREAD_RESPONDER_ID = "thread-responder"
THREAD_RESPONDER_LABEL = "Thread Responder"


class ThreadResponderRunner:
    def __init__(
        self,
        cfg: Config,
        loop: asyncio.AbstractEventLoop,
        run_service: RunService,
        threads: ThreadService,
        ideas: IdeaService,
        studies: StudyService,
        hub: BroadcastHub,
    ) -> None:
        self.cfg = cfg
        self._loop = loop
        self.run_service = run_service
        self.threads = threads
        self.ideas = ideas
        self.studies = studies
        self.hub = hub
        self._worker_ids = count(1_000_001)

    def available_responders(self) -> list[dict[str, str]]:
        return [{"id": THREAD_RESPONDER_ID, "label": THREAD_RESPONDER_LABEL}]

    def launch(self, thread_id: int, responder: str) -> None:
        if responder != THREAD_RESPONDER_ID:
            raise ValueError(f"Unknown responder: {responder}")
        self._loop.call_soon_threadsafe(self._start_task, thread_id)

    def _start_task(self, thread_id: int) -> None:
        asyncio.create_task(self._run(thread_id))

    async def _run(self, thread_id: int) -> None:
        detail = self.threads.get_detail(thread_id)
        if detail is None:
            return

        worker_id = next(self._worker_ids)
        worker = ThreadResponderWorker(
            interval=0.0,
            timeout=self.cfg.timeouts.follow_up,
            agent_cmd=self.cfg.agent_cmd,
            logs_dir=self.cfg.logs_dir,
            scratch_dir=self.cfg.scratch_dir,
            prompt_preamble=_render_skill("thread-responder.md", self.cfg),
        )
        state = WorkerState(worker_type=worker, worker_id=worker_id, status=WorkerStatus.IDLE)

        with worker_workspace(worker.scratch_dir, worker_id, f"thread-{thread_id}") as workspace:
            state.workspace_dir = workspace.path
            idea_payload = None
            if detail.idea_slug:
                try:
                    idea_payload = {
                        "status": asdict(self.ideas.status_summary(detail.idea_slug)),
                        "studies": [asdict(s) for s in self.studies.for_idea(detail.idea_slug)],
                    }
                except KeyError:
                    idea_payload = None
            prompt = (
                f"{worker.prompt_preamble}\n\n## Assignment\n\n"
                f"{json.dumps({'thread': asdict(detail), 'idea': idea_payload, 'workspace_dir': str(workspace.path)})}"
            )
            run_id = self.run_service.start(
                worker_id=worker_id,
                run_type=RunType.THREAD_RESPONSE,
                slug=f"thread-{thread_id}",
                log_file=worker.log_filename(worker_id, str(thread_id), None),
            )
            self.threads.update_pending_response(
                thread_id,
                responder=THREAD_RESPONDER_ID,
                run_id=run_id,
            )
            summary = self.threads.get(thread_id)
            if summary is not None:
                self.hub.publish_event("thread_upserted", asdict(summary))
            self.hub.emit(f"Responder assigned to thread #{thread_id}", thread_id=thread_id)

            result = AgentResult()
            try:
                state.status = WorkerStatus.RESEARCHING
                worker.logs_dir.mkdir(parents=True, exist_ok=True)
                log_path = worker.logs_dir / worker.log_filename(worker_id, str(thread_id), None)
                argv = [*shlex.split(worker.agent_cmd), prompt]
                with open(log_path, "w") as log_fh:
                    proc = await default_spawn(
                        argv,
                        stdout=log_fh,
                        stderr=asyncio.subprocess.STDOUT,
                        cwd=str(workspace.path),
                    )
                    state._proc = proc
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=worker.timeout)
                        result.exit_code = proc.returncode
                    except asyncio.TimeoutError:
                        proc.kill()
                        await proc.wait()
                        result.exit_code = proc.returncode
                        result.timed_out = True
            finally:
                self.run_service.finish(
                    run_id,
                    exit_code=result.exit_code,
                    timed_out=result.timed_out,
                )
                self.threads.finish_pending_response(thread_id)
                summary = self.threads.get(thread_id)
                if summary is not None:
                    self.hub.publish_event("thread_upserted", asdict(summary))
                if result.timed_out:
                    self.hub.emit(f"Thread responder timed out for thread #{thread_id}", thread_id=thread_id)
                elif result.exit_code == 0:
                    self.hub.emit(f"Thread responder finished for thread #{thread_id}", thread_id=thread_id)
                else:
                    self.hub.emit(
                        f"Thread responder exited {result.exit_code} for thread #{thread_id}",
                        thread_id=thread_id,
                    )
