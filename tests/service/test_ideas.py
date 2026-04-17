import tempfile
import unittest
from pathlib import Path
from typing import cast, override

from seminar import db
from seminar.service import IdeaState
from seminar.service.ideas import IdeaService
from seminar.service.types import IdeaContent, IdeaMeta, IdeaRef, IdeaStatus, IdeaSummary


class IdeaServiceTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    data_dir: Path | None = None
    idea_service: IdeaService | None = None

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        db.configure(self.data_dir)
        db.init_db()
        self.idea_service = IdeaService(self.data_dir / "scratch", db.connect)

    @override
    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def test_create_normalizes_slug_and_persists_sources(self) -> None:
        self._insert_idea("source-a", "2024-01-01T00:00:00Z", title="Source A")
        self._insert_idea("source-b", "2024-01-02T00:00:00Z", title="Source B")

        created = self._idea_service().create(
            " New Topic ",
            "Idea body",
            title="New Topic",
            author="Ada",
            parent_slugs=["source-a", "source-b"],
        )

        self.assertEqual(created, "new-topic")
        self.assertEqual(
            self._idea_service().content("new-topic"),
            IdeaContent(
                content="Idea body",
                meta=IdeaMeta(title="New Topic", author="Ada"),
            ),
        )
        self.assertEqual(
            self._idea_service().sources("new-topic"),
            [
                IdeaRef(slug="source-a", title="Source A"),
                IdeaRef(slug="source-b", title="Source B"),
            ],
        )
        self.assertEqual(
            self._idea_service().children("source-a"),
            [IdeaRef(slug="new-topic", title="New Topic")],
        )

    def test_list_all_and_status_summary_include_lock_state(self) -> None:
        self._insert_idea("older", "2024-01-01T00:00:00Z", title="Older", body="Older body")
        self._insert_idea(
            "newer",
            "2024-01-02T00:00:00Z",
            title="Newer",
            body="Newer body",
            current_state=IdeaState.FOLLOW_UP_RESEARCH,
            locked_by=11,
        )
        self._insert_study(
            "newer",
            1,
            started_at="2024-01-02T01:00:00Z",
            mode="follow_up_research",
        )

        self.assertEqual(
            self._idea_service().list_all(),
            [
                IdeaSummary(slug="older", title="Older", description="Older body"),
                IdeaSummary(slug="newer", title="Newer", description="Newer body"),
            ],
        )
        self.assertEqual(
            self._idea_service().status_summary("newer"),
            IdeaStatus(
                slug="newer",
                recorded_at="2024-01-02T00:00:00Z",
                last_studied=None,
                current_state=IdeaState.FOLLOW_UP_RESEARCH,
                locked_by=11,
                title="Newer",
                author=None,
                locked=True,
                locked_mode="follow_up_research",
            ),
        )

    def test_mark_done_and_reopen_transition_state(self) -> None:
        self._insert_idea("topic", "2024-01-01T00:00:00Z", title="Topic")

        self._idea_service().mark_done("topic")
        self.assertEqual(self._fetch_idea_row("topic"), (IdeaState.DONE, None))

        self._idea_service().reopen("topic")
        self.assertEqual(
            self._fetch_idea_row("topic"),
            (IdeaState.FOLLOW_UP_RESEARCH, None),
        )

    def test_reset_removes_studies_files_and_unlocks_idea(self) -> None:
        scratch_topic = self._data_dir() / "scratch" / "topic"
        scratch_topic.mkdir(parents=True)
        _ = (scratch_topic / "study.md").write_text("study")
        self._insert_idea(
            "topic",
            "2024-01-01T00:00:00Z",
            title="Topic",
            current_state=IdeaState.INITIAL_EXPLORATION,
            last_studied="2024-01-02T00:00:00Z",
            locked_by=5,
        )
        self._insert_study(
            "topic",
            1,
            started_at="2024-01-01T00:00:00Z",
            completed_at="2024-01-01T01:00:00Z",
            mode="initial_exploration",
        )

        self._idea_service().reset("topic")

        self.assertEqual(
            self._fetch_idea_detail_row("topic"),
            (IdeaState.NOT_STARTED, None, None),
        )
        self.assertEqual(self._count("SELECT COUNT(*) FROM studies WHERE idea_slug = ?", ("topic",)), 0)
        self.assertFalse(scratch_topic.exists())

    def test_reset_all_clears_all_studies_and_scratch_dirs(self) -> None:
        scratch_dir = self._data_dir() / "scratch"
        (scratch_dir / "topic-a").mkdir(parents=True)
        (scratch_dir / "topic-b").mkdir(parents=True)
        self._insert_idea(
            "topic-a",
            "2024-01-01T00:00:00Z",
            title="Topic A",
            current_state=IdeaState.INITIAL_EXPLORATION,
            last_studied="2024-01-02T00:00:00Z",
            locked_by=1,
        )
        self._insert_idea(
            "topic-b",
            "2024-01-02T00:00:00Z",
            title="Topic B",
            current_state=IdeaState.FOLLOW_UP_RESEARCH,
            last_studied="2024-01-03T00:00:00Z",
            locked_by=2,
        )
        self._insert_study("topic-a", 1, started_at="2024-01-01T00:00:00Z", mode="initial_exploration")
        self._insert_study("topic-b", 1, started_at="2024-01-02T00:00:00Z", mode="follow_up_research")

        self._idea_service().reset_all()

        self.assertEqual(self._count("SELECT COUNT(*) FROM studies"), 0)
        self.assertEqual(
            self._fetchall(
                "SELECT slug, current_state, last_studied, locked_by FROM ideas ORDER BY slug"
            ),
            [
                ("topic-a", IdeaState.NOT_STARTED, None, None),
                ("topic-b", IdeaState.NOT_STARTED, None, None),
            ],
        )
        self.assertEqual(list(scratch_dir.iterdir()), [])

    def test_delete_removes_idea_studies_and_relationships(self) -> None:
        scratch_topic = self._data_dir() / "scratch" / "topic"
        scratch_topic.mkdir(parents=True)
        self._insert_idea("parent", "2024-01-01T00:00:00Z", title="Parent")
        self._insert_idea("child", "2024-01-02T00:00:00Z", title="Child")
        self._insert_idea("topic", "2024-01-03T00:00:00Z", title="Topic")
        self._insert_study("topic", 1, started_at="2024-01-03T00:00:00Z", mode="initial_exploration")
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO idea_sources (slug, source_slug) VALUES (?, ?)",
                ("topic", "parent"),
            )
            conn.execute(
                "INSERT INTO idea_sources (slug, source_slug) VALUES (?, ?)",
                ("child", "topic"),
            )
            conn.execute(
                "INSERT INTO proposed_ideas (slug, recorded_at, status, title, author, body) VALUES (?, ?, ?, ?, ?, ?)",
                ("proposal", "2024-01-04T00:00:00Z", "pending", "Proposal", "Ada", "body"),
            )
            conn.execute(
                "INSERT INTO proposal_sources (slug, source_slug) VALUES (?, ?)",
                ("proposal", "topic"),
            )
            conn.commit()

        self._idea_service().delete("topic")

        self.assertEqual(self._count("SELECT COUNT(*) FROM ideas WHERE slug = ?", ("topic",)), 0)
        self.assertEqual(self._count("SELECT COUNT(*) FROM studies WHERE idea_slug = ?", ("topic",)), 0)
        self.assertEqual(self._count("SELECT COUNT(*) FROM idea_sources WHERE slug = ? OR source_slug = ?", ("topic", "topic")), 0)
        self.assertEqual(self._count("SELECT COUNT(*) FROM proposal_sources WHERE source_slug = ?", ("topic",)), 0)
        self.assertFalse(scratch_topic.exists())

    def _insert_idea(
        self,
        slug: str,
        recorded_at: str,
        *,
        title: str,
        body: str = "",
        author: str | None = None,
        current_state: str = IdeaState.NOT_STARTED,
        last_studied: str | None = None,
        locked_by: int | None = None,
    ) -> None:
        with db.connect() as conn:
            conn.execute(
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
                    title,
                    author,
                    body,
                ),
            )
            conn.commit()

    def _insert_study(
        self,
        slug: str,
        study_number: int,
        *,
        started_at: str,
        mode: str,
        completed_at: str | None = None,
        title: str | None = None,
    ) -> None:
        with db.connect() as conn:
            conn.execute(
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

    def _fetch_idea_row(self, slug: str) -> tuple[object, ...]:
        rows = self._fetchall(
            "SELECT current_state, locked_by FROM ideas WHERE slug = ?",
            (slug,),
        )
        return rows[0]

    def _fetch_idea_detail_row(self, slug: str) -> tuple[object, ...]:
        rows = self._fetchall(
            "SELECT current_state, last_studied, locked_by FROM ideas WHERE slug = ?",
            (slug,),
        )
        return rows[0]

    def _count(self, query: str, params: tuple[object, ...] = ()) -> int:
        rows = self._fetchall(query, params)
        value = rows[0][0]
        if not isinstance(value, int):
            raise AssertionError(f"Expected integer count, got {value!r}")
        return value

    def _data_dir(self) -> Path:
        if self.data_dir is None:
            raise AssertionError("data_dir was not initialized")
        return self.data_dir

    def _idea_service(self) -> IdeaService:
        if self.idea_service is None:
            raise AssertionError("idea_service was not initialized")
        return self.idea_service


if __name__ == "__main__":
    _ = unittest.main()
