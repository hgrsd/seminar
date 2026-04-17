import tempfile
import unittest
from pathlib import Path
from typing import cast, override
from unittest.mock import Mock

from seminar import db
from seminar.service import ProposalStatus
from seminar.service.proposals import ProposalService
from seminar.service.types import IdeaMeta, ProposalContent, ProposalSummary


class ProposalServiceTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    data_dir: Path | None = None
    proposal_service: ProposalService | None = None

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        db.configure(self.data_dir)
        db.init_db()
        self.proposal_service = ProposalService(db.connect)

    @override
    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def test_propose_normalizes_slug_and_keeps_only_existing_sources(self) -> None:
        self._insert_idea("existing-parent", "2024-01-01T00:00:00Z", title="Existing Parent")

        slug = self._proposal_service().propose(
            " New Proposal ",
            "Proposal body",
            title="Proposal Title",
            author="Ada",
            parent_slugs=["existing-parent", "missing-parent"],
        )

        self.assertEqual(slug, "new-proposal")
        self.assertEqual(
            self._proposal_service().summary("new-proposal"),
            self._summary_for("new-proposal", "Proposal Title", "Ada", ["existing-parent"], "Proposal body"),
        )
        self.assertEqual(
            self._proposal_service().read("new-proposal"),
            ProposalContent(
                content="Proposal body",
                meta=IdeaMeta(title="Proposal Title", author="Ada"),
            ),
        )

    def test_list_all_orders_newest_first_and_filters_by_status(self) -> None:
        self._insert_proposal(
            "older",
            "2024-01-01T00:00:00Z",
            status=ProposalStatus.PENDING,
            title="Older",
            author="Ada",
            body="Older body",
        )
        self._insert_proposal(
            "newer",
            "2024-01-02T00:00:00Z",
            status=ProposalStatus.REJECTED,
            title="Newer",
            author="Bea",
            body="Newer body",
        )

        self.assertEqual(
            self._proposal_service().list_all(),
            [
                self._summary_for("newer", "Newer", "Bea", [], "Newer body", status=ProposalStatus.REJECTED, recorded_at="2024-01-02T00:00:00Z"),
                self._summary_for("older", "Older", "Ada", [], "Older body", status=ProposalStatus.PENDING, recorded_at="2024-01-01T00:00:00Z"),
            ],
        )
        self.assertEqual(
            self._proposal_service().list_all(ProposalStatus.PENDING),
            [
                self._summary_for("older", "Older", "Ada", [], "Older body", status=ProposalStatus.PENDING, recorded_at="2024-01-01T00:00:00Z"),
            ],
        )

    def test_approve_calls_idea_service_with_expected_arguments_and_marks_proposal_approved(self) -> None:
        self._insert_idea("parent-a", "2024-01-01T00:00:00Z", title="Parent A")
        self._insert_idea("parent-b", "2024-01-02T00:00:00Z", title="Parent B")
        self._proposal_service().propose(
            "proposal-topic",
            "Proposal body",
            title="Proposal Topic",
            author="Ada",
            parent_slugs=["parent-a", "parent-b"],
        )
        idea_service = Mock()
        idea_service.create.return_value = "proposal-topic"

        approved_slug = self._proposal_service().approve("proposal-topic", idea_service)

        self.assertEqual(approved_slug, "proposal-topic")
        idea_service.create.assert_called_once()
        args, kwargs = idea_service.create.call_args
        self.assertEqual(args, ("proposal-topic", "Proposal body"))
        self.assertEqual(
            kwargs["title"],
            "Proposal Topic",
        )
        self.assertEqual(kwargs["author"], "Ada")
        self.assertEqual(kwargs["parent_slugs"], ["parent-a", "parent-b"])
        self.assertIsNotNone(kwargs["conn"])
        self.assertEqual(
            self._proposal_service().summary("proposal-topic"),
            self._summary_for(
                "proposal-topic",
                "Proposal Topic",
                "Ada",
                ["parent-a", "parent-b"],
                "Proposal body",
                status=ProposalStatus.APPROVED,
            ),
        )
        self.assertEqual(
            self._count("SELECT COUNT(*) FROM ideas WHERE slug = ?", ("proposal-topic",)),
            0,
        )
        self.assertEqual(
            self._count("SELECT COUNT(*) FROM idea_sources WHERE slug = ?", ("proposal-topic",)),
            0,
        )

    def test_reject_updates_status_and_second_transition_fails(self) -> None:
        self._insert_proposal(
            "proposal-topic",
            "2024-01-01T00:00:00Z",
            status=ProposalStatus.PENDING,
            title="Proposal Topic",
            author="Ada",
            body="Proposal body",
        )

        self._proposal_service().reject("proposal-topic")

        self.assertEqual(
            self._proposal_service().summary("proposal-topic"),
            self._summary_for(
                "proposal-topic",
                "Proposal Topic",
                "Ada",
                [],
                "Proposal body",
                status=ProposalStatus.REJECTED,
                recorded_at="2024-01-01T00:00:00Z",
            ),
        )
        with self.assertRaisesRegex(ValueError, "No pending proposal"):
            self._proposal_service().approve("proposal-topic", Mock())
        with self.assertRaisesRegex(ValueError, "No pending proposal"):
            self._proposal_service().reject("proposal-topic")

    def test_approve_rolls_back_status_when_idea_service_fails(self) -> None:
        self._insert_idea("parent", "2024-01-01T00:00:00Z", title="Parent")
        self._proposal_service().propose(
            "proposal-topic",
            "Proposal body",
            title="Proposal Topic",
            author="Ada",
            parent_slugs=["parent"],
        )
        idea_service = Mock()
        idea_service.create.side_effect = RuntimeError("boom")

        with self.assertRaisesRegex(RuntimeError, "boom"):
            self._proposal_service().approve("proposal-topic", idea_service)

        self.assertEqual(
            self._proposal_service().summary("proposal-topic"),
            self._summary_for(
                "proposal-topic",
                "Proposal Topic",
                "Ada",
                ["parent"],
                "Proposal body",
                status=ProposalStatus.PENDING,
            ),
        )

    def test_delete_removes_proposal_and_source_links(self) -> None:
        self._insert_idea("parent", "2024-01-01T00:00:00Z", title="Parent")
        self._proposal_service().propose(
            "proposal-topic",
            "Proposal body",
            title="Proposal Topic",
            author="Ada",
            parent_slugs=["parent"],
        )

        self._proposal_service().delete("proposal-topic")

        self.assertIsNone(self._proposal_service().summary("proposal-topic"))
        self.assertIsNone(self._proposal_service().read("proposal-topic"))
        self.assertEqual(
            self._count("SELECT COUNT(*) FROM proposal_sources WHERE slug = ?", ("proposal-topic",)),
            0,
        )

    def _summary_for(
        self,
        slug: str,
        title: str,
        author: str | None,
        sources: list[str],
        body: str,
        *,
        status: str = ProposalStatus.PENDING,
        recorded_at: str | None = None,
    ) -> ProposalSummary:
        if recorded_at is None:
            recorded_at = self._fetch_str(
                "SELECT recorded_at FROM proposed_ideas WHERE slug = ?",
                (slug,),
            )
        return ProposalSummary(
            slug=slug,
            recorded_at=recorded_at,
            status=status,
            title=title,
            author=author,
            sources=sources,
            description=body[:300],
        )

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

    def _insert_proposal(
        self,
        slug: str,
        recorded_at: str,
        *,
        status: str,
        title: str,
        author: str | None,
        body: str,
    ) -> None:
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO proposed_ideas (
                    slug, recorded_at, status, title, author, body
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (slug, recorded_at, status, title, author, body),
            )
            conn.commit()

    def _fetchall(
        self, query: str, params: tuple[object, ...] = ()
    ) -> list[tuple[object, ...]]:
        with db.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        typed_rows = cast(list[tuple[object, ...]], rows)
        return [tuple(row) for row in typed_rows]

    def _fetch_str(self, query: str, params: tuple[object, ...] = ()) -> str:
        rows = self._fetchall(query, params)
        return str(rows[0][0])

    def _count(self, query: str, params: tuple[object, ...] = ()) -> int:
        rows = self._fetchall(query, params)
        value = rows[0][0]
        if not isinstance(value, int):
            raise AssertionError(f"Expected integer count, got {value!r}")
        return value

    def _proposal_service(self) -> ProposalService:
        if self.proposal_service is None:
            raise AssertionError("proposal_service was not initialized")
        return self.proposal_service


if __name__ == "__main__":
    _ = unittest.main()
