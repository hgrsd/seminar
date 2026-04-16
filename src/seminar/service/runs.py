"""Worker run tracking, cost extraction, and log parsing."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Callable

from seminar.providers import Provider
from seminar.providers.types import LogEvent
from seminar.service.types import WorkerRun


class RunType(Enum):
    INITIAL_EXPLORATION = "initial_exploration"
    FOLLOW_UP_RESEARCH = "follow_up_research"
    CONNECTIVE_RESEARCH = "connective_research"


class RunService:
    def __init__(
        self,
        logs_dir: Path,
        provider: Provider,
        connect: Callable,
        on_run_updated: Callable[[], None] | None = None,
    ):
        self.logs_dir = logs_dir
        self.provider = provider
        self.connect = connect
        self.on_run_updated = on_run_updated

    def start(
        self,
        worker_id: int,
        run_type: RunType,
        slug: str | None = None,
        study_number: int | None = None,
        log_file: str | None = None,
    ) -> int:
        """Record the start of a worker run. Returns the run ID."""
        now = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            cursor = conn.execute(
                "INSERT INTO worker_runs (worker_id, worker_type, provider, slug, study_number, started_at, log_file) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (worker_id, run_type.value, type(self.provider).__name__, slug, study_number, now, log_file),
            )
            conn.commit()
            return cursor.lastrowid

    def finish(
        self,
        run_id: int,
        *,
        exit_code: int | None = None,
        timed_out: bool = False,
        duration_ms: int | None = None,
    ) -> None:
        """Record the end of a worker run and extract cost data from the log."""
        now = datetime.now(timezone.utc).isoformat()

        with self.connect() as conn:
            row = conn.execute("SELECT log_file FROM worker_runs WHERE id = ?", (run_id,)).fetchone()
        log_file = row["log_file"] if row else None

        log_result = None
        if log_file and self.logs_dir:
            log_path = self.logs_dir / log_file
            log_result = self.provider.extract_log_result(log_path)

        with self.connect() as conn:
            conn.execute(
                """UPDATE worker_runs SET
                    finished_at = ?,
                    exit_code = ?,
                    timed_out = ?,
                    duration_ms = ?,
                    cost_usd = ?,
                    cost_is_estimate = ?,
                    input_tokens = ?,
                    output_tokens = ?,
                    cache_read_tokens = ?,
                    cache_creation_tokens = ?,
                    num_turns = ?
                WHERE id = ?""",
                (
                    now,
                    exit_code,
                    1 if timed_out else 0,
                    duration_ms,
                    log_result.cost_usd if log_result else None,
                    1 if log_result and log_result.cost_is_estimate else 0,
                    log_result.input_tokens if log_result else None,
                    log_result.output_tokens if log_result else None,
                    log_result.cache_read_tokens if log_result else None,
                    log_result.cache_creation_tokens if log_result else None,
                    log_result.num_turns if log_result else None,
                    run_id,
                ),
            )
            conn.commit()
        if self.on_run_updated:
            self.on_run_updated()

    def by_date(self, date_str: str) -> list[WorkerRun]:
        """Return all worker runs for the given date (YYYY-MM-DD), enriched with study info."""
        start = f"{date_str}T00:00:00"
        end = f"{date_str}T23:59:59"
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    r.id, r.worker_id, r.worker_type, r.slug, r.study_number,
                    s.title AS study_title, s.filename AS study_filename,
                    r.started_at, r.finished_at, r.exit_code, r.timed_out,
                    r.duration_ms, r.cost_usd, r.cost_is_estimate,
                    r.input_tokens, r.output_tokens,
                    r.cache_read_tokens, r.cache_creation_tokens,
                    r.num_turns, r.log_file
                FROM worker_runs r
                LEFT JOIN studies s
                    ON r.slug = s.idea_slug AND r.study_number = s.study_number
                WHERE r.started_at >= ? AND r.started_at <= ?
                ORDER BY r.started_at DESC
                """,
                (start, end),
            ).fetchall()

        result = []
        for row in rows:
            if row["finished_at"] is None:
                completed = None
            elif row["exit_code"] == 0 and row["timed_out"] == 0:
                completed = True
            else:
                completed = False
            result.append(WorkerRun(
                id=row["id"],
                worker_id=row["worker_id"],
                worker_type=row["worker_type"],
                slug=row["slug"],
                study_number=row["study_number"],
                study_title=row["study_title"],
                study_filename=row["study_filename"],
                started_at=row["started_at"],
                finished_at=row["finished_at"],
                exit_code=row["exit_code"],
                timed_out=row["timed_out"],
                duration_ms=row["duration_ms"],
                cost_usd=row["cost_usd"],
                cost_is_estimate=row["cost_is_estimate"],
                input_tokens=row["input_tokens"],
                output_tokens=row["output_tokens"],
                cache_read_tokens=row["cache_read_tokens"],
                cache_creation_tokens=row["cache_creation_tokens"],
                num_turns=row["num_turns"],
                log_file=row["log_file"],
                completed=completed,
            ))
        return result

    def parse_log_file(self, worker_id: int, filename: str) -> list[LogEvent] | None:
        """Parse a log file for a worker. Returns None if the file is invalid or not found."""
        if not re.match(r'^[\w.-]+-worker' + str(worker_id) + r'\.log$', filename):
            return None
        if not self.logs_dir:
            return None
        log_path = self.logs_dir / filename
        if not log_path.exists():
            return None
        raw = log_path.read_text()
        lines = raw.splitlines()
        if len(lines) > 500:
            raw = "\n".join(lines[-500:])
        return self.provider.parse_log(raw)

    def session_cost(self, since: str) -> float:
        """Return total cost in USD for runs started since the given ISO timestamp."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(cost_usd), 0) as cost FROM worker_runs WHERE started_at >= ?",
                (since,),
            ).fetchone()
        return row["cost"]
