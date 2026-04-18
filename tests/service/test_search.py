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

    def test_search_includes_messages_in_corpus(self) -> None:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO ideas (
                    slug, recorded_at, last_studied, current_state, locked_by, title, author, body
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "topic",
                    "2024-01-01T00:00:00Z",
                    None,
                    "not_started",
                    None,
                    "Topic",
                    None,
                    "Topic body",
                ),
            )
            conn.execute(
                """
                INSERT INTO messages (recorded_at, title, author, body, idea_slug)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    "2024-01-01T00:00:00Z",
                    "Question about corpus coverage",
                    "agent-1",
                    "Please add messages to the searchable corpus so inbox notes appear in results.",
                    "topic",
                ),
            )
            conn.commit()

        self.assertEqual(
            self._search_service().search("inbox"),
            [
                SearchHit(
                    type="message",
                    slug="topic",
                    title="Question about corpus coverage",
                    snippet="Please add messages to the searchable corpus so inbox notes appear in results.",
                    message_id=1,
                )
            ],
        )

    def test_search_returns_message_without_idea_slug(self) -> None:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO messages (recorded_at, title, author, body, idea_slug)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    "2024-01-01T00:00:00Z",
                    "General note",
                    "agent-2",
                    "A free-floating reminder about annotations.",
                    None,
                ),
            )
            conn.commit()

        self.assertEqual(
            self._search_service().search("reminder"),
            [
                SearchHit(
                    type="message",
                    slug=None,
                    title="General note",
                    snippet="A free-floating reminder about annotations.",
                    message_id=1,
                )
            ],
        )

    def _search_service(self) -> SearchService:
        assert self.search_service is not None
        return self.search_service
