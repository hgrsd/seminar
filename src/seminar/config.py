"""Typed config: load from ~/.seminar/config.json, save back."""

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

CONFIG_PATH = Path.home() / ".seminar" / "config.json"


@dataclass
class IntervalsConfig:
    initial: int
    follow_up: int
    connective: int


@dataclass
class TimeoutsConfig:
    initial: int
    follow_up: int
    connective: int


@dataclass
class WorkersConfig:
    initial: int
    follow_up: int
    connective: int


@dataclass
class Config:
    data_dir: str
    provider: str
    agent_cmd: str
    intervals: IntervalsConfig
    timeouts: TimeoutsConfig
    workers: WorkersConfig
    follow_up_research_cooldown_minutes: int
    tools: list[str] = field(default_factory=list)

    @property
    def db_path(self) -> Path:
        return Path(self.data_dir) / "state.db"

    @property
    def scratch_dir(self) -> Path:
        return Path(self.data_dir) / "scratch"

    @property
    def logs_dir(self) -> Path:
        return Path(self.data_dir) / "logs"

    @property
    def skills_dir(self) -> Path:
        return Path(self.data_dir) / "skills"


def load() -> Config:
    """Load config from disk. Raises if not found or incomplete."""
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Config not found at {CONFIG_PATH}. Run `seminar init` first."
        )
    with open(CONFIG_PATH) as f:
        raw = json.load(f)
    return Config(
        data_dir=raw["data_dir"],
        provider=raw["provider"],
        agent_cmd=raw["agent_cmd"],
        intervals=IntervalsConfig(**raw["intervals"]),
        timeouts=TimeoutsConfig(**raw["timeouts"]),
        workers=WorkersConfig(**raw["workers"]),
        follow_up_research_cooldown_minutes=raw["follow_up_research_cooldown_minutes"],
        tools=raw.get("tools", []),
    )


def save(cfg: Config) -> None:
    """Write config to disk."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(asdict(cfg), f, indent=2)
        f.write("\n")
