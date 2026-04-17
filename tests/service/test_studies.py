import tempfile
import unittest
from pathlib import Path
from typing import cast, override

from seminar import db
from seminar.service import IdeaState
from seminar.service.ideas import IdeaService
from seminar.service.studies import StudyService
from seminar.service.types import ClaimResult, StudyDetail


class StudyServiceTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    data_dir: Path | None = None
    idea_service: IdeaService | None = None
    study_service: StudyService | None = None

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        db.configure(self.data_dir)
        db.init_db()
        self.idea_service = IdeaService(self.data_dir / "scratch", db.connect)
        self.study_service = StudyService(
            self.data_dir / "scratch",
            cooldown_minutes=10,
            connect=db.connect,
        )

    @override
    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def test_claim_initial_claims_oldest_unlocked_idea_and_creates_first_study(self) -> None:
        self._insert_idea("oldest", "2024-01-01T00:00:00Z")
        self._insert_idea("newest", "2024-01-02T00:00:00Z")

        claim = self._study_service().claim("initial_exploration", worker_id=7)
        persisted = self._fetchall(
            "SELECT slug, locked_by, current_state FROM ideas ORDER BY slug"
        )
        studies = self._fetchall(
            "SELECT idea_slug, study_number, mode, completed_at FROM studies"
        )

        self.assertEqual(
            claim,
            ClaimResult(status="claimed", slug="oldest", study_number=1),
        )
        self.assertEqual(
            persisted,
            [
                ("newest", None, IdeaState.NOT_STARTED),
                ("oldest", 7, IdeaState.NOT_STARTED),
            ],
        )
        self.assertEqual(
            studies,
            [("oldest", 1, "initial_exploration", None)],
        )

    def test_claim_further_skips_cooldown_and_returns_completed_study_history(self) -> None:
        self._insert_idea(
            "eligible",
            "2024-01-01T00:00:00Z",
            current_state=IdeaState.FOLLOW_UP_RESEARCH,
            last_studied="2000-01-01T00:00:00Z",
        )
        self._insert_idea(
            "cooling-down",
            "2024-01-02T00:00:00Z",
            current_state=IdeaState.FOLLOW_UP_RESEARCH,
            last_studied="2999-01-01T00:00:00Z",
        )
        self._insert_study(
            "eligible",
            1,
            started_at="2024-01-01T00:00:00Z",
            completed_at="2024-01-01T01:00:00Z",
            mode="initial_exploration",
            title="First pass",
        )

        claim = self._study_service().claim("follow_up_research", worker_id=3)

        self.assertEqual(
            claim,
            ClaimResult(
                status="claimed",
                slug="eligible",
                study_number=2,
                previous_studies=[
                    {"study_number": 1, "title": "First pass", "mode": "initial_exploration"}
                ],
            ),
        )

    def test_complete_persists_body_filename_and_advances_idea_state(self) -> None:
        self._insert_idea(
            "topic",
            "2024-01-01T00:00:00Z",
            current_state=IdeaState.NOT_STARTED,
            locked_by=5,
        )
        self._insert_study(
            "topic",
            1,
            started_at="2024-01-01T00:00:00Z",
            mode="initial_exploration",
        )
        markdown_path = self._data_dir() / "study.md"
        _ = markdown_path.write_text(
            """---
title: ignored
---

Study body
"""
        )

        self._study_service().complete("topic", 1, str(markdown_path), title="Published")

        self.assertEqual(
            self._idea_service().status_summary("topic"),
            self._idea_status("topic", IdeaState.INITIAL_EXPLORATION),
        )
        self.assertEqual(
            self._study_service().for_idea("topic"),
            [
                StudyDetail(
                    title="Published",
                    mode="initial_exploration",
                    study_number=1,
                    created_at=self._require_fetchval(
                        "SELECT completed_at FROM studies WHERE idea_slug = ? AND study_number = ?",
                        ("topic", 1),
                    ),
                    content="Study body",
                )
            ],
        )
        self.assertEqual(
            self._study_service().get_filename("topic", 1),
            "study.md",
        )

    def test_reset_orphaned_removes_incomplete_studies_unlocks_ideas_and_clears_worker_scratch(self) -> None:
        workers_dir = self._data_dir() / "scratch" / "workers"
        workers_dir.mkdir(parents=True)
        _ = (workers_dir / "leftover.txt").write_text("stale")
        self._insert_idea(
            "topic",
            "2024-01-01T00:00:00Z",
            current_state=IdeaState.INITIAL_EXPLORATION,
            locked_by=9,
        )
        self._insert_study(
            "topic",
            1,
            started_at="2024-01-01T00:00:00Z",
            mode="follow_up_research",
        )

        cleaned = self._study_service().reset_orphaned()

        persisted_ideas = self._fetchall(
            "SELECT slug, locked_by FROM ideas ORDER BY slug"
        )
        persisted_studies = self._fetchall(
            "SELECT idea_slug, study_number FROM studies ORDER BY idea_slug, study_number"
        )

        self.assertEqual(
            cleaned,
            ["topic"],
        )
        self.assertEqual(
            persisted_ideas,
            [("topic", None)],
        )
        self.assertEqual(
            persisted_studies,
            [],
        )
        self.assertFalse(
            workers_dir.exists(),
        )

    def _insert_idea(
        self,
        slug: str,
        recorded_at: str,
        *,
        current_state: str = IdeaState.NOT_STARTED,
        last_studied: str | None = None,
        locked_by: int | None = None,
    ) -> None:
        with db.connect() as conn:
            _ = conn.execute(
                """
                INSERT INTO ideas (
                    slug, recorded_at, last_studied, current_state, locked_by, title, author, body
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    slug,
                    recorded_at,
                    last_studied,
                    current_state,
                    locked_by,
                    slug.title(),
                    None,
                    f"{slug} body",
                ),
            )
            conn.commit()

    def _insert_study(
        self,
        slug: str,
        study_number: int,
        *,
        started_at: str,
        completed_at: str | None = None,
        mode: str,
        title: str | None = None,
    ) -> None:
        with db.connect() as conn:
            _ = conn.execute(
                """
                INSERT INTO studies (
                    idea_slug, study_number, started_at, completed_at, mode, title
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (slug, study_number, started_at, completed_at, mode, title),
            )
            conn.commit()

    def _fetchall(
        self, query: str, params: tuple[object, ...] = ()
    ) -> list[tuple[object, ...]]:
        with db.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        typed_rows = cast(list[tuple[object, ...]], rows)
        return [tuple(row) for row in typed_rows]

    def _fetchval(self, query: str, params: tuple[object, ...] = ()) -> str | None:
        with db.connect() as conn:
            typed_row = cast(
                tuple[object, ...] | None,
                conn.execute(query, params).fetchone(),
            )
        return str(typed_row[0]) if typed_row else None

    def _require_fetchval(self, query: str, params: tuple[object, ...] = ()) -> str:
        value = self._fetchval(query, params)
        if value is None:
            raise AssertionError(f"Expected a value for query: {query}")
        return value

    def _idea_status(self, slug: str, current_state: str):
        status = self._idea_service().status_summary(slug)
        status.current_state = current_state
        status.last_studied = self._fetchval(
            "SELECT last_studied FROM ideas WHERE slug = ?",
            (slug,),
        )
        return status

    def _data_dir(self) -> Path:
        if self.data_dir is None:
            raise AssertionError("data_dir was not initialized")
        return self.data_dir

    def _idea_service(self) -> IdeaService:
        if self.idea_service is None:
            raise AssertionError("idea_service was not initialized")
        return self.idea_service

    def _study_service(self) -> StudyService:
        if self.study_service is None:
            raise AssertionError("study_service was not initialized")
        return self.study_service


if __name__ == "__main__":
    _ = unittest.main()
