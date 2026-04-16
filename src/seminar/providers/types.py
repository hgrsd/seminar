"""Typed return values for providers."""

from dataclasses import dataclass


@dataclass
class LogResult:
    """Cost and usage data extracted from a log file."""
    cost_usd: float | None
    cost_is_estimate: bool
    duration_ms: int | None
    num_turns: int | None
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None
    cache_creation_tokens: int | None


@dataclass
class LogEvent:
    """A single parsed event from an agent log."""
    kind: str
    body: str
    ts: str | None = None
    label: str | None = None
    tool_id: str | None = None
