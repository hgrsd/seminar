"""Typed return values for the service layer."""

from dataclasses import dataclass, field


# --- Shared ---


@dataclass
class IdeaRef:
    slug: str
    title: str


@dataclass
class IdeaMeta:
    title: str
    author: str | None


# --- Ideas ---


@dataclass
class IdeaSummary:
    slug: str
    title: str
    description: str


@dataclass
class IdeaContent:
    content: str
    meta: IdeaMeta


@dataclass
class StudyRow:
    """Raw study record as stored in the DB."""
    idea_slug: str
    study_number: int
    started_at: str
    completed_at: str | None
    mode: str
    title: str | None


@dataclass
class IdeaDetail:
    slug: str
    recorded_at: str
    last_studied: str | None
    current_state: str
    locked_by: int | None
    title: str
    author: str | None
    studies: list[StudyRow]


@dataclass
class IdeaStatus:
    slug: str
    recorded_at: str
    last_studied: str | None
    current_state: str
    locked_by: int | None
    title: str
    author: str | None
    locked: bool
    locked_mode: str | None


# --- Studies ---


@dataclass
class ClaimResult:
    status: str
    slug: str | None = None
    study_number: int | None = None
    workspace_dir: str | None = None
    study_markdown_path: str | None = None
    previous_studies: list[dict] | None = None


@dataclass
class StudyDetail:
    title: str
    mode: str
    study_number: int
    created_at: str
    content: str


# --- Proposals ---


@dataclass
class ProposalSummary:
    slug: str
    recorded_at: str
    status: str
    title: str
    author: str | None
    sources: list[str]
    description: str


@dataclass
class ProposalContent:
    content: str
    meta: IdeaMeta


# --- Runs ---


@dataclass
class WorkerRun:
    id: int
    worker_id: int
    worker_type: str
    slug: str | None
    study_number: int | None
    study_title: str | None
    study_filename: str | None
    started_at: str
    finished_at: str | None
    exit_code: int | None
    timed_out: int
    duration_ms: int | None
    cost_usd: float | None
    cost_is_estimate: int
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None
    cache_creation_tokens: int | None
    num_turns: int | None
    log_file: str | None
    completed: bool | None


# --- Search ---


@dataclass
class SearchHit:
    type: str
    slug: str
    title: str
    snippet: str
    study_number: int | None = None
