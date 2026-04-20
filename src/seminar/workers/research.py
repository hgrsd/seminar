"""Research executor: claim an idea, run the agent, handle the result."""

import json
import logging
from dataclasses import asdict

from seminar.service.runs import RunService
from seminar.service.studies import StudyService
from seminar.workers.agent import default_spawn, run_agent
from seminar.workers.types import (
    EmitFn,
    FollowUpResearchWorker,
    InitialExplorationWorker,
    SpawnProcess,
    WorkerState,
)
from seminar.workers.workspace import worker_workspace

log = logging.getLogger(__name__)


class ResearchExecutor:
    """Executes a single research cycle: claim, run agent, handle result."""

    def __init__(
        self,
        worker: InitialExplorationWorker | FollowUpResearchWorker,
        state: WorkerState,
        study_service: StudyService,
        run_service: RunService,
        emit: EmitFn,
        *,
        spawn_process: SpawnProcess = default_spawn,
        on_state_change=None,
    ):
        self.worker = worker
        self.state = state
        self.study_service = study_service
        self.run_service = run_service
        self.emit = emit
        self.spawn_process = spawn_process
        self.on_state_change = on_state_change

    async def execute(self) -> None:
        claim = self.study_service.claim(self.worker.claim_mode, worker_id=self.state.worker_id)
        if claim.status == "idle":
            return

        assert claim.slug is not None and claim.study_number is not None
        slug = claim.slug
        study_number = claim.study_number
        self.emit(
            f"Claimed {slug} for {self.worker.claim_mode} research (#{self.state.worker_id})",
            slug=slug,
            worker_id=self.state.worker_id,
        )

        with worker_workspace(
            self.worker.scratch_dir,
            self.state.worker_id,
            f"{slug}-{study_number}",
        ) as workspace:
            self.state.workspace_dir = workspace.path
            if self.on_state_change:
                self.on_state_change(self.state)

            assignment = {
                **asdict(claim),
                "workspace_dir": str(workspace.path),
                "study_markdown_path": str(workspace.study_markdown_path),
            }
            prompt = f"{self.worker.prompt_preamble}\n\n## Assignment\n\n{json.dumps(assignment)}"
            try:
                result = await run_agent(
                    self.state, self.worker, self.run_service, self.spawn_process,
                    self.on_state_change,
                    prompt, slug=slug, study_number=study_number,
                    cwd=str(workspace.path),
                )
                if result.timed_out:
                    self.emit(
                        f"Agent timed out after {self.worker.timeout}s for {slug} (#{self.state.worker_id})",
                        slug=slug,
                        worker_id=self.state.worker_id,
                    )
                elif result.exit_code == 0:
                    study_fn = self.study_service.get_filename(slug, study_number)
                    self.emit(
                        f"Agent finished {slug} #{study_number} (#{self.state.worker_id})",
                        slug=slug,
                        worker_id=self.state.worker_id,
                        study_filename=study_fn,
                    )
                else:
                    self.emit(
                        f"Agent exited {result.exit_code} for {slug} (#{self.state.worker_id})",
                        slug=slug,
                        worker_id=self.state.worker_id,
                    )
            finally:
                if not self.study_service.is_complete(slug, study_number):
                    try:
                        self.study_service.release_claim(slug, study_number)
                    except Exception:
                        log.exception("Failed to release claim for %s #%d", slug, study_number)
