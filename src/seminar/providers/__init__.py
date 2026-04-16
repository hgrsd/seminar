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


def provider_name(provider: Provider) -> str:
    """Return the configured provider key for a provider instance."""
    provider_class = type(provider).__name__
    for name, entry in PROVIDERS.items():
        _, class_name = entry.split(":")
        if class_name == provider_class:
            return name
    raise ValueError(f"Unknown provider instance: {provider_class}")


def load(name: str) -> Provider:
    """Instantiate a provider by config key or legacy stored class name."""
    entry = PROVIDERS.get(name)
    if entry is None:
        for candidate in PROVIDERS.values():
            _, class_name = candidate.split(":")
            if class_name == name:
                entry = candidate
                break
    if entry is None:
        raise ValueError(f"Unknown provider: {name!r}. Available: {', '.join(PROVIDERS)}")
    module_path, class_name = entry.split(":")
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    return cls()
