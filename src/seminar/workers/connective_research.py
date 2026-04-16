"""Connective research executor: run a synthesis pass across all studies."""

import json

from seminar.service.runs import RunService
from seminar.workers.agent import default_spawn, run_agent
from seminar.workers.types import (
    ConnectiveResearchWorker,
    EmitFn,
    SpawnProcess,
    WorkerState,
)
from seminar.workers.workspace import worker_workspace


class ConnectiveResearchExecutor:
    """Executes a single connective research cycle."""

    def __init__(
        self,
        worker: ConnectiveResearchWorker,
        state: WorkerState,
        run_service: RunService,
        emit: EmitFn,
        *,
        spawn_process: SpawnProcess = default_spawn,
        on_state_change=None,
    ):
        self.worker = worker
        self.state = state
        self.run_service = run_service
        self.emit = emit
        self.spawn_process = spawn_process
        self.on_state_change = on_state_change

    async def execute(self) -> None:
        with worker_workspace(
            self.worker.scratch_dir,
            self.state.worker_id,
            "connective-research",
        ) as workspace:
            self.state.workspace_dir = workspace.path
            if self.on_state_change:
                self.on_state_change(self.state)
            self.emit(
                f"Starting connective research (#{self.state.worker_id})",
                worker_id=self.state.worker_id,
            )

            prompt = (
                f"{self.worker.prompt_preamble}\n\n## Assignment\n\n"
                f"{json.dumps({'workspace_dir': str(workspace.path)})}"
            )
            result = await run_agent(
                self.state, self.worker, self.run_service, self.spawn_process,
                self.on_state_change,
                prompt, slug="connective-research", cwd=str(workspace.path),
            )
            if result.timed_out:
                self.emit(
                    f"Connective research timed out after {self.worker.timeout}s (#{self.state.worker_id})",
                    worker_id=self.state.worker_id,
                )
            elif result.exit_code == 0:
                self.emit(
                    f"Connective research finished (#{self.state.worker_id})",
                    worker_id=self.state.worker_id,
                )
            else:
                self.emit(
                    f"Connective research exited {result.exit_code} (#{self.state.worker_id})",
                    worker_id=self.state.worker_id,
                )
