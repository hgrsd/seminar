import tempfile
import unittest
from pathlib import Path
from typing import override

from seminar import db
from seminar.service.search import SearchService
from seminar.service.types import SearchHit


class SearchServiceTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    data_dir: Path | None = None
    search_service: SearchService | None = None

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        db.configure(self.data_dir)
        db.init_db()
        self.search_service = SearchService(db.connect)

    @override
    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def test_search_includes_threads_in_corpus(self) -> None:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO threads (title, status, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    "Question about corpus coverage",
                    "waiting_on_user",
                    "2024-01-01T00:00:00Z",
                    "2024-01-01T00:00:00Z",
                ),
            )
            conn.execute(
                """
                INSERT INTO thread_messages (thread_id, author_type, author_name, body, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    1,
                    "agent",
                    "agent-1",
                    "Please add threads to the searchable corpus so conversations appear in results.",
                    "2024-01-01T00:00:00Z",
                ),
            )
            conn.commit()

        self.assertEqual(
            self._search_service().search("conversations"),
            [
                SearchHit(
                    type="thread",
                    slug=None,
                    title="Question about corpus coverage",
                    snippet="Please add threads to the searchable corpus so conversations appear in results.",
                    thread_id=1,
                )
            ],
        )

    def test_search_returns_thread_without_idea_slug(self) -> None:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO threads (title, status, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    "General note",
                    "waiting_on_user",
                    "2024-01-01T00:00:00Z",
                    "2024-01-01T00:00:00Z",
                ),
            )
            conn.execute(
                """
                INSERT INTO thread_messages (thread_id, author_type, author_name, body, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    1,
                    "agent",
                    "agent-2",
                    "A free-floating reminder about annotations.",
                    "2024-01-01T00:00:00Z",
                ),
            )
            conn.commit()

        self.assertEqual(
            self._search_service().search("reminder"),
            [
                SearchHit(
                    type="thread",
                    slug=None,
                    title="General note",
                    snippet="A free-floating reminder about annotations.",
                    thread_id=1,
                )
            ],
        )

    def _search_service(self) -> SearchService:
        assert self.search_service is not None
        return self.search_service
