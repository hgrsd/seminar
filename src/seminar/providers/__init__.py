"""Provider interface and loader."""

import importlib
from pathlib import Path
from typing import Protocol

from seminar.providers.types import LogEvent, LogResult


class Provider(Protocol):
    """Contract for agent providers.

    Implement this to add a new provider (e.g. CodexProvider).
    Register it in PROVIDERS below — no downstream changes needed.
    """

    def agent_cmd_default(self) -> str: ...
    def parse_log(self, raw: str) -> list[LogEvent]: ...
    def extract_log_result(self, path: Path) -> LogResult | None: ...


PROVIDERS: dict[str, str] = {
    "claude-code": "seminar.providers.claude_code:ClaudeCodeProvider",
    "codex": "seminar.providers.codex:CodexProvider",
}


def load(name: str) -> Provider:
    """Instantiate a provider by name."""
    entry = PROVIDERS.get(name)
    if entry is None:
        raise ValueError(f"Unknown provider: {name!r}. Available: {', '.join(PROVIDERS)}")
    module_path, class_name = entry.split(":")
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    return cls()
