"""Initial expectation lifecycle: create and read per-idea user expectations."""

from __future__ import annotations

import sqlite3
from typing import Callable

from seminar.service import now
from seminar.service.types import InitialExpectation


class InitialExpectationService:
    def __init__(self, connect: Callable):
        self.connect = connect

    def create(
        self,
        slug: str,
        body: str,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        trimmed = body.strip()
        if not trimmed:
            return

        def _do(c: sqlite3.Connection) -> None:
            c.execute(
                "INSERT INTO initial_expectations (idea_slug, body, created_at) VALUES (?, ?, ?)",
                (slug, trimmed, now()),
            )

        if conn is not None:
            _do(conn)
        else:
            with self.connect() as c:
                _do(c)
                c.commit()

    def get(self, slug: str) -> InitialExpectation | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT idea_slug, body, created_at FROM initial_expectations WHERE idea_slug = ?",
                (slug,),
            ).fetchone()
        if row is None:
            return None
        return InitialExpectation(
            idea_slug=row["idea_slug"],
            body=row["body"] or "",
            created_at=row["created_at"],
        )
