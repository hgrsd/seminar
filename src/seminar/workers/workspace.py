"""Per-run scratch workspace helpers for worker execution."""

import shutil
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4


@dataclass
class RunWorkspace:
    path: Path

    @property
    def study_markdown_path(self) -> Path:
        return self.path / "study.md"


@contextmanager
def worker_workspace(scratch_dir: Path, worker_id: int, label: str):
    path = (
        scratch_dir
        / "workers"
        / f"worker-{worker_id}"
        / f"{label}-{uuid4().hex[:8]}"
    ).resolve()
    path.mkdir(parents=True, exist_ok=True)
    workspace = RunWorkspace(path)
    try:
        yield workspace
    finally:
        shutil.rmtree(path, ignore_errors=True)
