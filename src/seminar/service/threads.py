"""Threaded conversations between the user and agents."""

from __future__ import annotations

from typing import Callable

from seminar.service import now
from seminar.service.types import ThreadDetail, ThreadMessage, ThreadSummary


class ThreadService:
    def __init__(self, connect: Callable):
        self.connect = connect

    def create(
        self,
        title: str,
        body: str,
        *,
        author_type: str,
        author_name: str,
        idea_slug: str | None = None,
    ) -> int:
        title = title.strip()
        if not title:
            raise ValueError("Thread title must not be empty.")
        if author_type not in {"user", "agent", "system"}:
            raise ValueError(f"Invalid author type: {author_type}")
        if not body.strip():
            raise ValueError("Thread body must not be empty.")
        ts = now()
        status = "waiting_on_agent" if author_type == "user" else "waiting_on_user"
        with self.connect() as conn:
            cur = conn.execute(
                "INSERT INTO threads (title, status, idea_slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (title, status, idea_slug, ts, ts),
            )
            thread_id = cur.lastrowid
            conn.execute(
                "INSERT INTO thread_messages (thread_id, author_type, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)",
                (thread_id, author_type, author_name.strip(), body, ts),
            )
            conn.commit()
            return thread_id

    def list_all(self, status_filter: str | None = None) -> list[ThreadSummary]:
        with self.connect() as conn:
            sql = """
                SELECT
                    t.*,
                    COUNT(m.id) AS message_count,
                    lm.author_type AS last_author_type,
                    lm.author_name AS last_author_name,
                    lm.body AS last_body
                FROM threads t
                LEFT JOIN thread_messages m ON m.thread_id = t.id
                LEFT JOIN thread_messages lm ON lm.id = (
                    SELECT m2.id
                    FROM thread_messages m2
                    WHERE m2.thread_id = t.id
                    ORDER BY m2.created_at DESC, m2.id DESC
                    LIMIT 1
                )
            """
            params: tuple[object, ...]
            if status_filter:
                sql += " WHERE t.status = ?"
                params = (status_filter,)
            else:
                params = ()
            sql += """
                GROUP BY t.id
                ORDER BY t.updated_at DESC, t.id DESC
            """
            rows = conn.execute(sql, params).fetchall()
        return [_to_summary(r) for r in rows]

    def get(self, thread_id: int) -> ThreadSummary | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT
                    t.*,
                    COUNT(m.id) AS message_count,
                    lm.author_type AS last_author_type,
                    lm.author_name AS last_author_name,
                    lm.body AS last_body
                FROM threads t
                LEFT JOIN thread_messages m ON m.thread_id = t.id
                LEFT JOIN thread_messages lm ON lm.id = (
                    SELECT m2.id
                    FROM thread_messages m2
                    WHERE m2.thread_id = t.id
                    ORDER BY m2.created_at DESC, m2.id DESC
                    LIMIT 1
                )
                WHERE t.id = ?
                GROUP BY t.id
                """,
                (thread_id,),
            ).fetchone()
        return _to_summary(row) if row else None

    def list_for_idea(self, idea_slug: str) -> list[ThreadSummary]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    t.*,
                    COUNT(m.id) AS message_count,
                    lm.author_type AS last_author_type,
                    lm.author_name AS last_author_name,
                    lm.body AS last_body
                FROM threads t
                LEFT JOIN thread_messages m ON m.thread_id = t.id
                LEFT JOIN thread_messages lm ON lm.id = (
                    SELECT m2.id
                    FROM thread_messages m2
                    WHERE m2.thread_id = t.id
                    ORDER BY m2.created_at DESC, m2.id DESC
                    LIMIT 1
                )
                WHERE t.idea_slug = ?
                GROUP BY t.id
                ORDER BY t.updated_at DESC, t.id DESC
                """,
                (idea_slug,),
            ).fetchall()
        return [_to_summary(r) for r in rows]

    def get_detail(self, thread_id: int) -> ThreadDetail | None:
        with self.connect() as conn:
            thread = conn.execute(
                "SELECT * FROM threads WHERE id = ?",
                (thread_id,),
            ).fetchone()
            if thread is None:
                return None
            rows = conn.execute(
                "SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC",
                (thread_id,),
            ).fetchall()
        return ThreadDetail(
            id=thread["id"],
            title=thread["title"],
            status=thread["status"],
            idea_slug=thread["idea_slug"],
            assigned_responder=thread["assigned_responder"],
            assigned_run_id=thread["assigned_run_id"],
            created_at=thread["created_at"],
            updated_at=thread["updated_at"],
            messages=[_to_message(r) for r in rows],
        )

    def add_message(
        self,
        thread_id: int,
        *,
        author_type: str,
        author_name: str,
        body: str,
        responder: str | None = None,
    ) -> int:
        if author_type not in {"user", "agent", "system"}:
            raise ValueError(f"Invalid author type: {author_type}")
        if not body.strip():
            raise ValueError("Thread body must not be empty.")
        ts = now()
        next_status = "waiting_on_agent" if author_type == "user" else "waiting_on_user"
        with self.connect() as conn:
            row = conn.execute("SELECT 1 FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if row is None:
                raise ValueError(f"No thread with id {thread_id}")
            cur = conn.execute(
                "INSERT INTO thread_messages (thread_id, author_type, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)",
                (thread_id, author_type, author_name.strip(), body, ts),
            )
            conn.execute(
                "UPDATE threads SET status = ?, assigned_responder = COALESCE(?, assigned_responder), updated_at = ? WHERE id = ?",
                (next_status, responder, ts, thread_id),
            )
            conn.commit()
            return cur.lastrowid

    def update_pending_response(
        self,
        thread_id: int,
        *,
        responder: str,
        run_id: int | None = None,
    ) -> None:
        with self.connect() as conn:
            row = conn.execute("SELECT 1 FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if row is None:
                raise ValueError(f"No thread with id {thread_id}")
            conn.execute(
                "UPDATE threads SET status = 'waiting_on_agent', assigned_responder = ?, assigned_run_id = ?, updated_at = ? WHERE id = ?",
                (responder, run_id, now(), thread_id),
            )
            conn.commit()

    def finish_pending_response(self, thread_id: int) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE threads SET assigned_run_id = NULL, updated_at = ? WHERE id = ?",
                (now(), thread_id),
            )
            conn.commit()

    def close(self, thread_id: int) -> None:
        with self.connect() as conn:
            row = conn.execute("SELECT 1 FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if row is None:
                raise ValueError(f"No thread with id {thread_id}")
            conn.execute(
                "UPDATE threads SET status = 'closed', assigned_run_id = NULL, updated_at = ? WHERE id = ?",
                (now(), thread_id),
            )
            conn.commit()

    def add_system_event(
        self,
        thread_id: int,
        *,
        body: str,
        event_type: str,
        related_idea_slug: str | None = None,
        related_study_number: int | None = None,
    ) -> int:
        ts = now()
        with self.connect() as conn:
            row = conn.execute("SELECT 1 FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if row is None:
                raise ValueError(f"No thread with id {thread_id}")
            cur = conn.execute(
                """
                INSERT INTO thread_messages (
                    thread_id, author_type, author_name, body, created_at, event_type, related_idea_slug, related_study_number
                ) VALUES (?, 'system', 'Seminar', ?, ?, ?, ?, ?)
                """,
                (thread_id, body, ts, event_type, related_idea_slug, related_study_number),
            )
            conn.execute(
                "UPDATE threads SET updated_at = ? WHERE id = ?",
                (ts, thread_id),
            )
            conn.commit()
            return cur.lastrowid

    def delete(self, thread_id: int) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM thread_messages WHERE thread_id = ?", (thread_id,))
            conn.execute("DELETE FROM threads WHERE id = ?", (thread_id,))
            conn.commit()


def _preview(text: str | None, limit: int = 180) -> str:
    body = (text or "").strip()
    if len(body) <= limit:
        return body
    return body[:limit].rstrip() + "..."


def _to_summary(row) -> ThreadSummary:
    return ThreadSummary(
        id=row["id"],
        title=row["title"] or "",
        status=row["status"],
        idea_slug=row["idea_slug"],
        assigned_responder=row["assigned_responder"],
        assigned_run_id=row["assigned_run_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        preview=_preview(row["last_body"]),
        message_count=row["message_count"] or 0,
        last_author_type=row["last_author_type"],
        last_author_name=row["last_author_name"],
    )


def _to_message(row) -> ThreadMessage:
    return ThreadMessage(
        id=row["id"],
        thread_id=row["thread_id"],
        author_type=row["author_type"],
        author_name=row["author_name"],
        body=row["body"],
        created_at=row["created_at"],
        event_type=row["event_type"],
        related_idea_slug=row["related_idea_slug"],
        related_study_number=row["related_study_number"],
    )
