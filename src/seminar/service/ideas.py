"""Idea lifecycle: creation, state transitions, and querying."""

from __future__ import annotations

import sqlite3
import shutil
from pathlib import Path
from typing import Callable

from seminar.markdown import shift_headings
from seminar.service import IdeaState, now, validate_slug
from seminar.service.types import (
    IdeaContent,
    IdeaDetail,
    IdeaMeta,
    IdeaRef,
    IdeaStatus,
    IdeaSummary,
    StudyRow,
)


class IdeaService:
    def __init__(self, scratch_dir: Path, connect: Callable):
        self.scratch_dir = scratch_dir
        self.connect = connect

    def create(
        self,
        slug: str,
        body: str,
        *,
        title: str,
        author: str | None = None,
        parent_slugs: list[str] | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> str:
        """Create a new idea DB row with body content. Returns the slug."""
        slug = validate_slug(slug)

        def _do(c: sqlite3.Connection) -> None:
            c.execute(
                "INSERT INTO ideas (slug, recorded_at, title, author, body) VALUES (?, ?, ?, ?, ?)",
                (slug, now(), title, author, body),
            )
            for source_slug in parent_slugs or []:
                c.execute(
                    "INSERT OR IGNORE INTO idea_sources (slug, source_slug) VALUES (?, ?)",
                    (slug, source_slug),
                )

        if conn is not None:
            _do(conn)
        else:
            with self.connect() as c:
                _do(c)
                c.commit()

        return slug

    def mark_done(self, slug: str) -> None:
        """Mark an idea as done."""
        with self.connect() as conn:
            conn.execute(
                "UPDATE ideas SET current_state = ? WHERE slug = ?",
                (IdeaState.DONE, slug),
            )
            conn.commit()

    def reopen(self, slug: str) -> None:
        """Re-open a done idea for further research."""
        with self.connect() as conn:
            conn.execute(
                "UPDATE ideas SET current_state = ?, locked_by = NULL WHERE slug = ? AND current_state = ?",
                (IdeaState.FOLLOW_UP_RESEARCH, slug, IdeaState.DONE),
            )
            conn.commit()

    def reset(self, slug: str) -> None:
        """Destructively reset an idea: delete all study rows and files, back to not_started."""
        studies_dir = self.scratch_dir / slug
        if studies_dir.exists():
            shutil.rmtree(studies_dir)

        with self.connect() as conn:
            conn.execute("DELETE FROM studies WHERE idea_slug = ?", (slug,))
            conn.execute(
                "UPDATE ideas SET current_state = ?, last_studied = NULL, locked_by = NULL WHERE slug = ?",
                (IdeaState.NOT_STARTED, slug),
            )
            conn.commit()

    def reset_all(self) -> None:
        """Destructively reset all ideas: delete all study rows and files, back to not_started."""
        if self.scratch_dir.exists():
            for child in self.scratch_dir.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)

        with self.connect() as conn:
            conn.execute("DELETE FROM studies")
            conn.execute(
                "UPDATE ideas SET current_state = ?, last_studied = NULL, locked_by = NULL",
                (IdeaState.NOT_STARTED,),
            )
            conn.commit()

    def delete(self, slug: str) -> None:
        """Delete an idea entirely: remove all studies and all DB records."""
        studies_dir = self.scratch_dir / slug
        if studies_dir.exists():
            shutil.rmtree(studies_dir)

        with self.connect() as conn:
            conn.execute("DELETE FROM studies WHERE idea_slug = ?", (slug,))
            conn.execute(
                "DELETE FROM idea_sources WHERE slug = ? OR source_slug = ?",
                (slug, slug),
            )
            conn.execute("DELETE FROM proposal_sources WHERE source_slug = ?", (slug,))
            conn.execute("DELETE FROM ideas WHERE slug = ?", (slug,))
            conn.commit()

    def read(self, slug: str) -> str | None:
        """Read the body of an idea by slug."""
        with self.connect() as conn:
            row = conn.execute("SELECT body FROM ideas WHERE slug = ?", (slug,)).fetchone()
        if row is None:
            return None
        return row["body"] or ""

    def list_all(self) -> list[IdeaSummary]:
        """Return a compact list of all ideas with slug, title, and description."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT slug, title, body FROM ideas ORDER BY recorded_at"
            ).fetchall()
        return [
            IdeaSummary(
                slug=r["slug"],
                title=r["title"] or "",
                description=(r["body"] or "").strip()[:300],
            )
            for r in rows
        ]

    def content(self, slug: str) -> IdeaContent | None:
        """Return idea content and metadata, or None if not found."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT title, author, body FROM ideas WHERE slug = ?", (slug,)
            ).fetchone()
        if row is None:
            return None
        meta = IdeaMeta(title=row["title"] or "", author=row["author"])
        return IdeaContent(content=row["body"] or "", meta=meta)

    def sources(self, slug: str) -> list[IdeaRef]:
        """Return parent/source ideas with slug and title."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT i.slug, i.title FROM idea_sources s JOIN ideas i ON i.slug = s.source_slug WHERE s.slug = ?",
                (slug,),
            ).fetchall()
        return [IdeaRef(slug=r["slug"], title=r["title"]) for r in rows]

    def children(self, slug: str) -> list[IdeaRef]:
        """Return child ideas with slug and title."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT i.slug, i.title FROM idea_sources s JOIN ideas i ON i.slug = s.slug WHERE s.source_slug = ?",
                (slug,),
            ).fetchall()
        return [IdeaRef(slug=r["slug"], title=r["title"]) for r in rows]

    def export_markdown(self, slug: str) -> str | None:
        """Return a bundled Markdown export of an idea and its completed studies."""
        with self.connect() as conn:
            idea = conn.execute(
                "SELECT slug, recorded_at, last_studied, current_state, title, author, body FROM ideas WHERE slug = ?",
                (slug,),
            ).fetchone()
            if idea is None:
                return None
            sources = conn.execute(
                "SELECT i.slug, i.title FROM idea_sources s JOIN ideas i ON i.slug = s.source_slug WHERE s.slug = ? ORDER BY i.recorded_at",
                (slug,),
            ).fetchall()
            children = conn.execute(
                "SELECT i.slug, i.title FROM idea_sources s JOIN ideas i ON i.slug = s.slug WHERE s.source_slug = ? ORDER BY i.recorded_at",
                (slug,),
            ).fetchall()
            studies = conn.execute(
                "SELECT study_number, mode, title, body, completed_at, started_at "
                "FROM studies WHERE idea_slug = ? AND completed_at IS NOT NULL ORDER BY study_number",
                (slug,),
            ).fetchall()

        lines = [f"# {idea['title'] or idea['slug']}", ""]

        metadata = [
            ("Slug", f"`{idea['slug']}`"),
            ("Recorded", idea["recorded_at"]),
            ("Author", idea["author"]),
            ("State", idea["current_state"]),
            ("Last studied", idea["last_studied"]),
            ("Completed studies", str(len(studies))),
        ]
        lines.append("## Metadata")
        lines.append("")
        for label, value in metadata:
            if value:
                lines.append(f"- **{label}:** {value}")
        lines.append("")

        if sources or children:
            lines.append("## Lineage")
            lines.append("")
            if sources:
                lines.append("**Derived from**")
                lines.append("")
                for source in sources:
                    lines.append(f"- {source['title']} (`{source['slug']}`)")
                lines.append("")
            if children:
                lines.append("**Spawned ideas**")
                lines.append("")
                for child in children:
                    lines.append(f"- {child['title']} (`{child['slug']}`)")
                lines.append("")

        lines.append("## Idea")
        lines.append("")
        body = (idea["body"] or "").strip()
        if body:
            lines.append(body)
        else:
            lines.append("_No idea body provided._")
        lines.append("")

        if studies:
            for study in studies:
                study_title = study["title"] or f"Study {study['study_number']}"
                study_mode = study["mode"] or "unknown"
                study_created_at = study["completed_at"] or study["started_at"]
                lines.append(f"## Study #{study['study_number']}: {study_title}")
                lines.append("")
                lines.append(f"- **Mode:** {study_mode}")
                if study_created_at:
                    lines.append(f"- **Completed:** {study_created_at}")
                lines.append("")
                study_body = (study["body"] or "").strip()
                if study_body:
                    lines.append(shift_headings(study_body, levels=1).rstrip())
                else:
                    lines.append("_No study content captured._")
                lines.append("")

        return "\n".join(lines).rstrip() + "\n"

    def status(self, slug: str) -> IdeaDetail:
        """Return detailed status for a single idea. Raises KeyError if not found."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM ideas WHERE slug = ?", (slug,)
            ).fetchone()
            if row is None:
                raise KeyError(f"Unknown idea: {slug}")
            studies = conn.execute(
                "SELECT * FROM studies WHERE idea_slug = ? ORDER BY study_number",
                (slug,),
            ).fetchall()
        return IdeaDetail(
            slug=row["slug"],
            recorded_at=row["recorded_at"],
            last_studied=row["last_studied"],
            current_state=row["current_state"],
            locked_by=row["locked_by"],
            title=row["title"],
            author=row["author"],
            studies=[
                StudyRow(
                    idea_slug=s["idea_slug"],
                    study_number=s["study_number"],
                    started_at=s["started_at"],
                    completed_at=s["completed_at"],
                    mode=s["mode"],
                    title=s["title"],
                )
                for s in studies
            ],
        )

    def status_summary(self, slug: str) -> IdeaStatus:
        """Return summary status for a single idea. Raises KeyError if not found."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM ideas WHERE slug = ?",
                (slug,),
            ).fetchone()
            if row is None:
                raise KeyError(f"Unknown idea: {slug}")
            in_progress = conn.execute(
                "SELECT mode FROM studies WHERE idea_slug = ? AND completed_at IS NULL",
                (slug,),
            ).fetchone()
        return IdeaStatus(
            slug=row["slug"],
            recorded_at=row["recorded_at"],
            last_studied=row["last_studied"],
            current_state=row["current_state"],
            locked_by=row["locked_by"],
            title=row["title"],
            author=row["author"],
            locked=row["locked_by"] is not None,
            locked_mode=in_progress["mode"] if in_progress else None,
        )

    def status_all(self) -> list[IdeaStatus]:
        """Return summary status for all ideas."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM ideas ORDER BY recorded_at"
            ).fetchall()
            in_progress = conn.execute(
                "SELECT idea_slug, mode FROM studies WHERE completed_at IS NULL"
            ).fetchall()
        locked_modes = {r["idea_slug"]: r["mode"] for r in in_progress}
        return [
            IdeaStatus(
                slug=r["slug"],
                recorded_at=r["recorded_at"],
                last_studied=r["last_studied"],
                current_state=r["current_state"],
                locked_by=r["locked_by"],
                title=r["title"],
                author=r["author"],
                locked=r["locked_by"] is not None,
                locked_mode=locked_modes.get(r["slug"]),
            )
            for r in rows
        ]
