"""Agent-to-director inbox messages."""

from __future__ import annotations

from typing import Callable

from seminar.service import now
from seminar.service.types import IdeaMeta, MessageContent, MessageSummary


class MessageService:
    def __init__(self, connect: Callable):
        self.connect = connect

    def send(
        self,
        title: str,
        body: str,
        author: str,
        *,
        idea_slug: str | None = None,
    ) -> int:
        if not body.strip():
            raise ValueError("Message body must not be empty.")
        with self.connect() as conn:
            cur = conn.execute(
                "INSERT INTO messages (recorded_at, title, author, body, idea_slug)"
                " VALUES (?, ?, ?, ?, ?)",
                (now(), title, author, body, idea_slug),
            )
            conn.commit()
            return cur.lastrowid

    def list_all(self, status_filter: str | None = None) -> list[MessageSummary]:
        with self.connect() as conn:
            if status_filter:
                rows = conn.execute(
                    "SELECT * FROM messages WHERE status = ? ORDER BY recorded_at DESC",
                    (status_filter,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM messages ORDER BY recorded_at DESC"
                ).fetchall()
        return [_to_summary(r) for r in rows]

    def get(self, id: int) -> MessageSummary | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (id,)).fetchone()
        return _to_summary(row) if row else None

    def read_content(self, id: int) -> MessageContent | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT title, author, body FROM messages WHERE id = ?", (id,)
            ).fetchone()
        if row is None:
            return None
        return MessageContent(
            content=row["body"],
            meta=IdeaMeta(title=row["title"], author=row["author"]),
        )

    def mark_read(self, id: int) -> None:
        with self.connect() as conn:
            row = conn.execute("SELECT 1 FROM messages WHERE id = ?", (id,)).fetchone()
            if row is None:
                raise ValueError(f"No message with id {id}")
            conn.execute("UPDATE messages SET status = 'read' WHERE id = ?", (id,))
            conn.commit()

    def delete(self, id: int) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM messages WHERE id = ?", (id,))
            conn.commit()


def _to_summary(row) -> MessageSummary:
    return MessageSummary(
        id=row["id"],
        recorded_at=row["recorded_at"],
        title=row["title"] or "",
        author=row["author"] or "",
        status=row["status"],
        idea_slug=row["idea_slug"],
        description=(row["body"] or "").strip()[:300],
    )
