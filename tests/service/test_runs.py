import tempfile
import unittest
from pathlib import Path
from typing import cast, override
from unittest.mock import Mock, patch

from seminar import db
from seminar.providers.types import LogEvent, LogResult
from seminar.service.runs import RunService, RunType
from seminar.service.types import WorkerRun


class CodexProvider:
    def __init__(self) -> None:
        self.extract_log_result_mock = Mock()
        self.parse_log_mock = Mock()

    def agent_cmd_default(self) -> str:
        return "codex exec"

    def parse_log(self, raw: str) -> list[LogEvent]:
        return cast(list[LogEvent], self.parse_log_mock(raw))

    def extract_log_result(self, path: Path) -> LogResult | None:
        return cast(LogResult | None, self.extract_log_result_mock(path))


class ClaudeCodeProvider(CodexProvider):
    def agent_cmd_default(self) -> str:
        return "claude"


class RunServiceTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    data_dir: Path | None = None
    logs_dir: Path | None = None
    provider: CodexProvider | None = None
    run_service: RunService | None = None
    on_run_updated: Mock | None = None

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.logs_dir = self.data_dir / "logs"
        self.logs_dir.mkdir()
        db.configure(self.data_dir)
        db.init_db()
        self.provider = CodexProvider()
        self.on_run_updated = Mock()
        self.run_service = RunService(
            self.logs_dir,
            self.provider,
            db.connect,
            on_run_updated=self.on_run_updated,
        )

    @override
    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def test_start_persists_run_with_current_provider_name(self) -> None:
        run_id = self._run_service().start(
            worker_id=7,
            run_type=RunType.INITIAL_EXPLORATION,
            slug="topic",
            study_number=2,
            log_file="topic-worker7.log",
        )

        self.assertEqual(
            self._fetchall(
                """
                SELECT id, worker_id, worker_type, provider, slug, study_number, log_file
                FROM worker_runs
                WHERE id = ?
                """,
                (run_id,),
            ),
            [
                (
                    run_id,
                    7,
                    "initial_exploration",
                    "codex",
                    "topic",
                    2,
                    "topic-worker7.log",
                )
            ],
        )

    def test_finish_updates_run_from_provider_log_result_and_emits_callback(self) -> None:
        log_file = "topic-worker3.log"
        log_path = self._logs_dir() / log_file
        _ = log_path.write_text("log body")
        run_id = self._run_service().start(
            worker_id=3,
            run_type=RunType.FOLLOW_UP_RESEARCH,
            slug="topic",
            study_number=4,
            log_file=log_file,
        )
        provider = CodexProvider()
        provider.extract_log_result_mock.return_value = LogResult(
            cost_usd=1.25,
            cost_is_estimate=True,
            duration_ms=999,
            num_turns=7,
            input_tokens=100,
            output_tokens=200,
            cache_read_tokens=300,
            cache_creation_tokens=400,
        )

        with patch("seminar.service.runs.providers.load", return_value=provider):
            self._run_service().finish(
                run_id,
                exit_code=0,
                timed_out=False,
                duration_ms=1234,
            )

        provider.extract_log_result_mock.assert_called_once_with(log_path)
        self._on_run_updated().assert_called_once_with()
        rows = self._fetchall(
            """
            SELECT exit_code, timed_out, duration_ms, cost_usd, cost_is_estimate,
                   input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                   num_turns, finished_at
            FROM worker_runs
            WHERE id = ?
            """,
            (run_id,),
        )
        self.assertEqual(
            rows[0][:10],
            (0, 0, 1234, 1.25, 1, 100, 200, 300, 400, 7),
        )
        self.assertIsInstance(rows[0][10], str)

    def test_by_date_returns_joined_runs_with_completed_flags(self) -> None:
        self._insert_idea("topic", "2024-01-01T00:00:00Z", title="Topic")
        self._insert_study(
            "topic",
            2,
            started_at="2024-01-01T00:00:00Z",
            completed_at="2024-01-01T01:00:00Z",
            mode="follow_up_research",
            title="Study Title",
            filename="study.md",
        )
        self._insert_run(
            worker_id=1,
            worker_type="initial_exploration",
            provider="codex",
            started_at="2024-04-20T13:00:00",
            finished_at=None,
            exit_code=None,
            timed_out=0,
            slug="topic",
            study_number=2,
            log_file="topic-worker1.log",
        )
        self._insert_run(
            worker_id=2,
            worker_type="follow_up_research",
            provider="codex",
            started_at="2024-04-20T12:00:00",
            finished_at="2024-04-20T12:30:00",
            exit_code=0,
            timed_out=0,
            slug="topic",
            study_number=2,
            log_file="topic-worker2.log",
            cost_usd=0.5,
        )
        self._insert_run(
            worker_id=3,
            worker_type="connective_research",
            provider="codex",
            started_at="2024-04-20T11:00:00",
            finished_at="2024-04-20T11:20:00",
            exit_code=1,
            timed_out=0,
            slug=None,
            study_number=None,
            log_file="connective-worker3.log",
        )

        runs = self._run_service().by_date("2024-04-20")

        self.assertEqual(
            runs,
            [
                WorkerRun(
                    id=1,
                    worker_id=1,
                    worker_type="initial_exploration",
                    provider="codex",
                    slug="topic",
                    study_number=2,
                    study_title="Study Title",
                    study_filename="study.md",
                    started_at="2024-04-20T13:00:00",
                    finished_at=None,
                    exit_code=None,
                    timed_out=0,
                    duration_ms=None,
                    cost_usd=None,
                    cost_is_estimate=0,
                    input_tokens=None,
                    output_tokens=None,
                    cache_read_tokens=None,
                    cache_creation_tokens=None,
                    num_turns=None,
                    log_file="topic-worker1.log",
                    completed=None,
                ),
                WorkerRun(
                    id=2,
                    worker_id=2,
                    worker_type="follow_up_research",
                    provider="codex",
                    slug="topic",
                    study_number=2,
                    study_title="Study Title",
                    study_filename="study.md",
                    started_at="2024-04-20T12:00:00",
                    finished_at="2024-04-20T12:30:00",
                    exit_code=0,
                    timed_out=0,
                    duration_ms=None,
                    cost_usd=0.5,
                    cost_is_estimate=0,
                    input_tokens=None,
                    output_tokens=None,
                    cache_read_tokens=None,
                    cache_creation_tokens=None,
                    num_turns=None,
                    log_file="topic-worker2.log",
                    completed=True,
                ),
                WorkerRun(
                    id=3,
                    worker_id=3,
                    worker_type="connective_research",
                    provider="codex",
                    slug=None,
                    study_number=None,
                    study_title=None,
                    study_filename=None,
                    started_at="2024-04-20T11:00:00",
                    finished_at="2024-04-20T11:20:00",
                    exit_code=1,
                    timed_out=0,
                    duration_ms=None,
                    cost_usd=None,
                    cost_is_estimate=0,
                    input_tokens=None,
                    output_tokens=None,
                    cache_read_tokens=None,
                    cache_creation_tokens=None,
                    num_turns=None,
                    log_file="connective-worker3.log",
                    completed=False,
                ),
            ],
        )

    def test_parse_log_file_returns_none_for_invalid_filename_or_missing_file(self) -> None:
        self.assertIsNone(self._run_service().parse_log_file(7, "bad.log"))
        self.assertIsNone(self._run_service().parse_log_file(7, "topic-worker7.log"))
        self._provider().parse_log_mock.assert_not_called()

    def test_parse_log_file_uses_loaded_provider_and_truncates_to_last_500_lines(self) -> None:
        filename = "topic-worker5.log"
        log_path = self._logs_dir() / filename
        _ = log_path.write_text("\n".join(f"line {i}" for i in range(600)))
        self._insert_run(
            worker_id=5,
            worker_type="initial_exploration",
            provider="claude-code",
            started_at="2024-04-20T10:00:00",
            finished_at=None,
            exit_code=None,
            timed_out=0,
            slug="topic",
            study_number=1,
            log_file=filename,
        )
        provider = ClaudeCodeProvider()
        provider.parse_log_mock.return_value = [LogEvent(kind="message", body="parsed")]

        with patch("seminar.service.runs.providers.load", return_value=provider):
            result = self._run_service().parse_log_file(5, filename)

        self.assertEqual(result, [LogEvent(kind="message", body="parsed")])
        provider.parse_log_mock.assert_called_once()
        raw = cast(str, provider.parse_log_mock.call_args.args[0])
        self.assertTrue(raw.startswith("line 100"))
        self.assertTrue(raw.endswith("line 599"))
        self.assertNotIn("line 99", raw)

    def test_session_cost_sums_runs_since_timestamp(self) -> None:
        self._insert_run(
            worker_id=1,
            worker_type="initial_exploration",
            provider="codex",
            started_at="2024-04-20T09:00:00",
            finished_at="2024-04-20T09:10:00",
            exit_code=0,
            timed_out=0,
            cost_usd=0.25,
        )
        self._insert_run(
            worker_id=2,
            worker_type="follow_up_research",
            provider="codex",
            started_at="2024-04-20T10:00:00",
            finished_at="2024-04-20T10:10:00",
            exit_code=0,
            timed_out=0,
            cost_usd=0.75,
        )

        self.assertEqual(self._run_service().session_cost("2024-04-20T09:30:00"), 0.75)

    def _insert_idea(
        self,
        slug: str,
        recorded_at: str,
        *,
        title: str,
        body: str = "",
        author: str | None = None,
    ) -> None:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO ideas (
                    slug, recorded_at, last_studied, current_state, locked_by, title, author, body
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (slug, recorded_at, None, "not_started", None, title, author, body),
            )
            conn.commit()

    def _insert_study(
        self,
        slug: str,
        study_number: int,
        *,
        started_at: str,
        completed_at: str | None,
        mode: str,
        title: str | None = None,
        filename: str | None = None,
    ) -> None:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO studies (
                    idea_slug, study_number, started_at, completed_at, mode, title, filename
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (slug, study_number, started_at, completed_at, mode, title, filename),
            )
            conn.commit()

    def _insert_run(
        self,
        *,
        worker_id: int,
        worker_type: str,
        provider: str,
        started_at: str,
        finished_at: str | None,
        exit_code: int | None,
        timed_out: int,
        slug: str | None = None,
        study_number: int | None = None,
        log_file: str | None = None,
        cost_usd: float | None = None,
    ) -> None:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO worker_runs (
                    worker_id, worker_type, provider, slug, study_number,
                    started_at, finished_at, exit_code, timed_out, log_file, cost_usd
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    worker_id,
                    worker_type,
                    provider,
                    slug,
                    study_number,
                    started_at,
                    finished_at,
                    exit_code,
                    timed_out,
                    log_file,
                    cost_usd,
                ),
            )
            conn.commit()

    def _fetchall(
        self, query: str, params: tuple[object, ...] = ()
    ) -> list[tuple[object, ...]]:
        with db.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        typed_rows = cast(list[tuple[object, ...]], rows)
        return [tuple(row) for row in typed_rows]

    def _logs_dir(self) -> Path:
        if self.logs_dir is None:
            raise AssertionError("logs_dir was not initialized")
        return self.logs_dir

    def _on_run_updated(self) -> Mock:
        if self.on_run_updated is None:
            raise AssertionError("on_run_updated was not initialized")
        return self.on_run_updated

    def _provider(self) -> CodexProvider:
        if self.provider is None:
            raise AssertionError("provider was not initialized")
        return self.provider

    def _run_service(self) -> RunService:
        if self.run_service is None:
            raise AssertionError("run_service was not initialized")
        return self.run_service


if __name__ == "__main__":
    _ = unittest.main()
