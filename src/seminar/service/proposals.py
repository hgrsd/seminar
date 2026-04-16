"""Proposal workflow: creation, listing, approval, rejection, deletion."""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

from seminar import db
from seminar.service import ProposalStatus, now, validate_slug
from seminar.service.types import IdeaMeta, ProposalContent, ProposalSummary

if TYPE_CHECKING:
    from seminar.service.ideas import IdeaService


class ProposalService:
    def __init__(self, connect: Callable):
        self.connect = connect

    def propose(
        self,
        slug: str,
        body: str,
        *,
        title: str,
        author: str | None = None,
        parent_slugs: list[str] | None = None,
    ) -> str:
        """Create a proposal DB row with body content. Returns the slug."""
        slug = validate_slug(slug)

        with self.connect() as conn:
            conn.execute(
                "INSERT INTO proposed_ideas (slug, recorded_at, status, title, author, body) VALUES (?, ?, ?, ?, ?, ?)",
                (slug, now(), ProposalStatus.PENDING, title, author, body),
            )
            if parent_slugs:
                for source_slug in parent_slugs:
                    exists = conn.execute(
                        "SELECT 1 FROM ideas WHERE slug = ?", (source_slug,)
                    ).fetchone()
                    if exists:
                        conn.execute(
                            "INSERT OR IGNORE INTO proposal_sources (slug, source_slug) VALUES (?, ?)",
                            (slug, source_slug),
                        )
            conn.commit()

        return slug

    def list_all(self, status_filter: str | None = None) -> list[ProposalSummary]:
        """Return proposals, optionally filtered by status."""
        with self.connect() as conn:
            if status_filter:
                rows = conn.execute(
                    "SELECT * FROM proposed_ideas WHERE status = ? ORDER BY recorded_at DESC",
                    (status_filter,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM proposed_ideas ORDER BY recorded_at DESC"
                ).fetchall()

            source_rows = conn.execute("SELECT slug, source_slug FROM proposal_sources").fetchall()
            sources_by_slug: dict[str, list[str]] = {}
            for r in source_rows:
                sources_by_slug.setdefault(r["slug"], []).append(r["source_slug"])

        return [
            ProposalSummary(
                slug=row["slug"],
                recorded_at=row["recorded_at"],
                status=row["status"],
                title=row["title"] or "",
                author=row["author"],
                sources=sources_by_slug.get(row["slug"], []),
                description=(row["body"] or "").strip()[:300],
            )
            for row in rows
        ]

    def summary(self, slug: str) -> ProposalSummary | None:
        """Return a single proposal summary, or None if not found."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM proposed_ideas WHERE slug = ?",
                (slug,),
            ).fetchone()
            if row is None:
                return None
            source_rows = conn.execute(
                "SELECT source_slug FROM proposal_sources WHERE slug = ?",
                (slug,),
            ).fetchall()
        return ProposalSummary(
            slug=row["slug"],
            recorded_at=row["recorded_at"],
            status=row["status"],
            title=row["title"] or "",
            author=row["author"],
            sources=[r["source_slug"] for r in source_rows],
            description=(row["body"] or "").strip()[:300],
        )

    def read(self, slug: str) -> ProposalContent | None:
        """Return proposal content and metadata, or None if not found."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT title, author, body FROM proposed_ideas WHERE slug = ?", (slug,)
            ).fetchone()
        if row is None:
            return None
        body = row["body"] or ""
        if not body:
            return None
        return ProposalContent(
            content=body,
            meta=IdeaMeta(title=row["title"] or "", author=row["author"]),
        )

    def approve(self, slug: str, idea_service: IdeaService) -> str:
        """Approve a proposal: create the idea and update proposal status in a single transaction."""
        with db.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM proposed_ideas WHERE slug = ? AND status = ?", (slug, ProposalStatus.PENDING)
            ).fetchone()
            if row is None:
                raise ValueError(f"No pending proposal with slug {slug!r}")

            source_rows = conn.execute(
                "SELECT source_slug FROM proposal_sources WHERE slug = ?", (slug,)
            ).fetchall()
            source_slugs = [sr["source_slug"] for sr in source_rows]

            body = row["body"] or ""

            idea_slug = idea_service.create(
                slug, body, title=row["title"], author=row["author"],
                parent_slugs=source_slugs, conn=conn,
            )

            conn.execute(
                "UPDATE proposed_ideas SET status = ? WHERE slug = ?", (ProposalStatus.APPROVED, slug)
            )

        return idea_slug

    def reject(self, slug: str) -> None:
        """Reject a proposal."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM proposed_ideas WHERE slug = ? AND status = ?", (slug, ProposalStatus.PENDING)
            ).fetchone()
            if row is None:
                raise ValueError(f"No pending proposal with slug {slug!r}")
            conn.execute(
                "UPDATE proposed_ideas SET status = ? WHERE slug = ?", (ProposalStatus.REJECTED, slug)
            )
            conn.commit()

    def delete(self, slug: str) -> None:
        """Delete a proposal entirely."""
        with self.connect() as conn:
            conn.execute("DELETE FROM proposal_sources WHERE slug = ?", (slug,))
            conn.execute("DELETE FROM proposed_ideas WHERE slug = ?", (slug,))
            conn.commit()
