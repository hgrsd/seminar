"""Worker type definitions and shared state."""

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Protocol

from seminar.service.runs import RunType


# --- Worker types ---


@dataclass
class InitialExplorationWorker:
    interval: float
    timeout: float | None
    agent_cmd: str
    logs_dir: Path
    scratch_dir: Path
    prompt_preamble: str

    claim_mode = "initial_exploration"
    run_type = RunType.INITIAL_EXPLORATION

    def log_filename(self, worker_id: int, slug: str | None, study_number: int | None) -> str:
        return f"{slug}-{study_number}-worker{worker_id}.log"


@dataclass
class FollowUpResearchWorker:
    interval: float
    timeout: float | None
    agent_cmd: str
    logs_dir: Path
    scratch_dir: Path
    prompt_preamble: str

    claim_mode = "follow_up_research"
    run_type = RunType.FOLLOW_UP_RESEARCH

    def log_filename(self, worker_id: int, slug: str | None, study_number: int | None) -> str:
        return f"{slug}-{study_number}-worker{worker_id}.log"


@dataclass
class ConnectiveResearchWorker:
    interval: float
    timeout: float | None
    agent_cmd: str
    logs_dir: Path
    scratch_dir: Path
    prompt_preamble: str

    run_type = RunType.CONNECTIVE_RESEARCH

    def log_filename(self, worker_id: int, slug: str | None = None, study_number: int | None = None) -> str:
        return f"connective-research-worker{worker_id}.log"


WorkerType = InitialExplorationWorker | FollowUpResearchWorker | ConnectiveResearchWorker


# --- Worker state ---


class WorkerStatus(Enum):
    IDLE = "idle"
    RESEARCHING = "researching"


EventCallback = Callable[[dict[str, Any]], None]
EmitFn = Callable[..., None]


@dataclass
class WorkerState:
    """Observable state for the web UI."""

    worker_type: WorkerType
    worker_id: int
    status: WorkerStatus = WorkerStatus.IDLE
    current_slug: str | None = None
    started_at: float | None = None
    started_at_wall: str | None = None
    log_file: Path | None = None
    workspace_dir: Path | None = None
    _proc: asyncio.subprocess.Process | None = field(default=None, repr=False)

    def reset(self) -> None:
        self.status = WorkerStatus.IDLE
        self.current_slug = None
        self.started_at = None
        self.started_at_wall = None
        self.log_file = None
        self.workspace_dir = None
        self._proc = None


# --- Subprocess abstraction ---


@dataclass
class AgentResult:
    exit_code: int | None = None
    timed_out: bool = False


class SpawnProcess(Protocol):
    """Protocol for spawning an agent subprocess. Injectable for testing."""

    async def __call__(
        self, argv: list[str], stdout: Any, stderr: Any, cwd: str | None = None,
    ) -> asyncio.subprocess.Process: ...
