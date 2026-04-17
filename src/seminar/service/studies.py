"""Study management: claiming, completion, querying, and cleanup."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable

from seminar.service import IdeaState, now, read_body
from seminar.service.types import ClaimResult, StudyDetail


class StudyService:
    def __init__(
        self,
        scratch_dir: Path,
        cooldown_minutes: int,
        connect: Callable,
    ):
        self.scratch_dir = scratch_dir
        self.cooldown_minutes = cooldown_minutes
        self.connect = connect

    def claim(self, mode: str, *, worker_id: int | None = None) -> ClaimResult:
        """Claim an idea for research. Mode is 'initial_exploration' or 'follow_up_research'.

        Returns a ClaimResult with status 'claimed' or 'idle'.
        """
        if mode == "initial_exploration":
            state_filter = "current_state = ? AND locked_by IS NULL"
            params = (IdeaState.NOT_STARTED,)
        elif mode == "follow_up_research":
            state_filter = """
                current_state IN (?, ?)
                AND locked_by IS NULL
                AND (last_studied IS NULL OR julianday('now') - julianday(last_studied) > ? / 1440.0)
            """
            params = (IdeaState.INITIAL_EXPLORATION, IdeaState.FOLLOW_UP_RESEARCH, self.cooldown_minutes)
        else:
            raise ValueError(f"Unknown claim mode: {mode!r}")

        with self.connect() as conn:
            try:
                conn.execute("BEGIN IMMEDIATE")
                if worker_id is not None:
                    already = conn.execute(
                        "SELECT slug FROM ideas WHERE locked_by = ?",
                        (worker_id,),
                    ).fetchone()
                    if already:
                        conn.rollback()
                        return ClaimResult(status="idle")
                row = conn.execute(
                    f"""
                    SELECT slug FROM ideas
                    WHERE {state_filter}
                    ORDER BY recorded_at ASC
                    LIMIT 1
                    """,
                    params,
                ).fetchone()
                if row is None:
                    conn.rollback()
                    return ClaimResult(status="idle")

                slug = row["slug"]
                conn.execute(
                    "UPDATE ideas SET locked_by = ? WHERE slug = ?",
                    (worker_id, slug),
                )
                study_number = conn.execute(
                    "SELECT COALESCE(MAX(study_number), 0) + 1 AS n FROM studies WHERE idea_slug = ?",
                    (slug,),
                ).fetchone()["n"]
                conn.execute(
                    "INSERT INTO studies (idea_slug, study_number, started_at, mode) VALUES (?, ?, ?, ?)",
                    (slug, study_number, now(), mode),
                )
                conn.commit()

                result = ClaimResult(
                    status="claimed",
                    slug=slug,
                    study_number=study_number,
                )
                if mode == "follow_up_research":
                    prev_rows = conn.execute(
                        "SELECT study_number, title, mode FROM studies "
                        "WHERE idea_slug = ? AND completed_at IS NOT NULL ORDER BY study_number",
                        (slug,),
                    ).fetchall()
                    result.previous_studies = [
                        {"study_number": r["study_number"], "title": r["title"] or "", "mode": r["mode"] or ""}
                        for r in prev_rows
                    ]
                return result
            except Exception:
                conn.rollback()
                raise

    def complete(
        self,
        slug: str,
        study_number: int,
        markdown_path: str,
        mode: str | None = None,
        title: str | None = None,
    ) -> None:
        """Mark a study as complete, ingest body into DB, and advance the idea's state."""
        completed_at = now()

        path = Path(markdown_path)
        if not path.exists():
            raise ValueError(f"Study markdown not found: {markdown_path}")
        if title is None or not title.strip():
            raise ValueError(f"Title is required to complete study {slug} #{study_number}")

        study_filename = path.name
        body = read_body(path)
        title = title.strip()

        with self.connect() as conn:
            try:
                conn.execute("BEGIN IMMEDIATE")
                updates = {"completed_at": completed_at, "title": title, "filename": study_filename, "body": body}
                if mode is not None:
                    updates["mode"] = mode
                set_clause = ", ".join(f"{k} = ?" for k in updates)
                conn.execute(
                    f"UPDATE studies SET {set_clause} WHERE idea_slug = ? AND study_number = ?",
                    (*updates.values(), slug, study_number),
                )
                mode_row = conn.execute(
                    "SELECT mode FROM studies WHERE idea_slug = ? AND study_number = ?",
                    (slug, study_number),
                ).fetchone()

                new_state = IdeaState.FOLLOW_UP_RESEARCH if mode_row and mode_row["mode"] != "initial_exploration" else IdeaState.INITIAL_EXPLORATION
                conn.execute(
                    "UPDATE ideas SET current_state = ?, last_studied = ?, locked_by = NULL WHERE slug = ? AND current_state != ?",
                    (new_state, completed_at, slug, IdeaState.DONE),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    def for_idea(self, slug: str) -> list[StudyDetail]:
        """Return studies for an idea with their content."""
        return [
            StudyDetail(
                title=r["title"] or "",
                mode=r["mode"] or "",
                study_number=r["study_number"],
                created_at=r["completed_at"] or r["started_at"] or "",
                content=r["body"] or "",
            )
            for r in self._completed_rows(slug)
        ]

    def _completed_rows(self, slug: str) -> list:
        """Fetch completed study rows for an idea."""
        with self.connect() as conn:
            return conn.execute(
                "SELECT study_number, mode, title, body, completed_at, started_at "
                "FROM studies WHERE idea_slug = ? AND completed_at IS NOT NULL ORDER BY study_number",
                (slug,),
            ).fetchall()

    def counts(self) -> dict[str, int]:
        """Return {slug: count} of completed studies per idea."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT idea_slug, COUNT(*) as n FROM studies WHERE completed_at IS NOT NULL GROUP BY idea_slug"
            ).fetchall()
        return {r["idea_slug"]: r["n"] for r in rows}

    def count_for_idea(self, slug: str) -> int:
        """Return number of completed studies for a single idea."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as n FROM studies WHERE idea_slug = ? AND completed_at IS NOT NULL",
                (slug,),
            ).fetchone()
        return row["n"] if row else 0

    def reset_orphaned(self) -> list[str]:
        """Clear all in-progress state unconditionally. Called on startup to clean up after unclean shutdown."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT idea_slug, study_number FROM studies WHERE completed_at IS NULL"
            ).fetchall()
            to_delete = [(r["idea_slug"], r["study_number"]) for r in rows]

            for slug, study_num in to_delete:
                conn.execute(
                    "DELETE FROM studies WHERE idea_slug = ? AND study_number = ?",
                    (slug, study_num),
                )

            affected_slugs = list({s for s, _ in to_delete})
            conn.execute("UPDATE ideas SET locked_by = NULL WHERE locked_by IS NOT NULL")
            conn.commit()

        workers_dir = self.scratch_dir / "workers"
        if workers_dir.exists():
            shutil.rmtree(workers_dir, ignore_errors=True)
        return affected_slugs

    def add_director_note(self, slug: str, body: str) -> int:
        """Add a director's note as a study. Reopens done ideas and resets cooldown."""
        ts = now()
        with self.connect() as conn:
            try:
                conn.execute("BEGIN IMMEDIATE")
                study_number = conn.execute(
                    "SELECT COALESCE(MAX(study_number), 0) + 1 AS n FROM studies WHERE idea_slug = ?",
                    (slug,),
                ).fetchone()["n"]

                filename = f"{study_number:04d}-directors-note.md"

                conn.execute(
                    "INSERT INTO studies (idea_slug, study_number, started_at, completed_at, mode, title, filename, body) "
                    "VALUES (?, ?, ?, ?, 'director_note', ?, ?, ?)",
                    (slug, study_number, ts, ts, "Director's Note", filename, body),
                )

                row = conn.execute(
                    "SELECT current_state, locked_by FROM ideas WHERE slug = ?",
                    (slug,),
                ).fetchone()
                if row:
                    if row["current_state"] == IdeaState.DONE:
                        conn.execute(
                            "UPDATE ideas SET current_state = ?, locked_by = NULL WHERE slug = ?",
                            (IdeaState.FOLLOW_UP_RESEARCH, slug),
                        )
                    if row["locked_by"] is None:
                        conn.execute(
                            "UPDATE ideas SET last_studied = NULL WHERE slug = ?",
                            (slug,),
                        )

                conn.commit()
                return study_number
            except Exception:
                conn.rollback()
                raise

    def is_complete(self, slug: str, study_number: int) -> bool:
        """Check if a study has been marked as complete."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT completed_at FROM studies WHERE idea_slug = ? AND study_number = ?",
                (slug, study_number),
            ).fetchone()
        return row is not None and row["completed_at"] is not None

    def get_filename(self, slug: str, study_number: int) -> str | None:
        """Return the filename of a completed study, or None."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT filename FROM studies WHERE idea_slug = ? AND study_number = ? AND completed_at IS NOT NULL",
                (slug, study_number),
            ).fetchone()
        return row["filename"] if row else None

    def read_study_body(self, slug: str, study_number: int) -> str | None:
        """Return the body of a completed study, or None if not found."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT body FROM studies WHERE idea_slug = ? AND study_number = ? AND completed_at IS NOT NULL",
                (slug, study_number),
            ).fetchone()
        if row is None:
            return None
        return row["body"] or ""

    def release_claim(self, slug: str, study_number: int) -> None:
        """Release a claimed study that wasn't completed: remove the study row and clear the lock."""
        with self.connect() as conn:
            conn.execute(
                "DELETE FROM studies WHERE idea_slug = ? AND study_number = ? AND completed_at IS NULL",
                (slug, study_number),
            )
            conn.execute(
                "UPDATE ideas SET locked_by = NULL WHERE slug = ?",
                (slug,),
            )
            conn.commit()
