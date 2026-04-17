"""Full-text search across ideas, studies, and proposals."""

from __future__ import annotations

from typing import Callable

from seminar.service.types import SearchHit


class SearchService:
    def __init__(self, connect: Callable):
        self.connect = connect

    def search(self, query: str) -> list[SearchHit]:
        """Search across ideas, studies, and proposals by title and body content."""
        q = query.lower()
        scored: list[tuple[float, SearchHit]] = []

        like_pattern = f"%{q}%"

        with self.connect() as conn:
            idea_rows = conn.execute(
                "SELECT slug, title, body FROM ideas WHERE title LIKE ? OR body LIKE ?",
                (like_pattern, like_pattern),
            ).fetchall()
            for row in idea_rows:
                score, snippet = self._score(q, row["title"] or "", row["body"] or "")
                scored.append((score, SearchHit(type="idea", slug=row["slug"], title=row["title"] or "", snippet=snippet)))

            study_rows = conn.execute(
                "SELECT idea_slug, study_number, title, body FROM studies WHERE completed_at IS NOT NULL AND (title LIKE ? OR body LIKE ?)",
                (like_pattern, like_pattern),
            ).fetchall()
            for row in study_rows:
                score, snippet = self._score(q, row["title"] or "", row["body"] or "")
                scored.append((score, SearchHit(type="study", slug=row["idea_slug"], title=row["title"] or "", snippet=snippet, study_number=row["study_number"])))

            proposal_rows = conn.execute(
                "SELECT slug, title, body FROM proposed_ideas WHERE title LIKE ? OR body LIKE ?",
                (like_pattern, like_pattern),
            ).fetchall()
            for row in proposal_rows:
                score, snippet = self._score(q, row["title"] or "", row["body"] or "")
                scored.append((score, SearchHit(type="proposal", slug=row["slug"], title=row["title"] or "", snippet=snippet)))

            annotation_rows = conn.execute(
                "SELECT id, idea_slug, study_number, rendered_text, body FROM annotations WHERE rendered_text LIKE ? OR body LIKE ?",
                (like_pattern, like_pattern),
            ).fetchall()
            for row in annotation_rows:
                score, snippet = self._score(q, row["rendered_text"] or "", row["body"] or "")
                scored.append((score, SearchHit(
                    type="annotation",
                    slug=row["idea_slug"],
                    title=row["rendered_text"] or "",
                    snippet=snippet,
                    study_number=row["study_number"],
                    annotation_id=row["id"],
                )))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [entry for _, entry in scored[:25]]

    @staticmethod
    def _score(query_lower: str, title: str, body: str) -> tuple[float, str]:
        """Score and snippet for a row already matched by SQL LIKE."""
        score = 10.0 if query_lower in title.lower() else 0.0
        body_lower = body.lower()
        score += body_lower.count(query_lower)

        body_pos = body_lower.find(query_lower)
        if body_pos >= 0:
            start = max(0, body_pos - 60)
            end = min(len(body), body_pos + 90)
            snippet = body[start:end].strip()
            if start > 0:
                snippet = "..." + snippet
            if end < len(body):
                snippet = snippet + "..."
        else:
            snippet = body.strip()[:150] + ("..." if len(body.strip()) > 150 else "")

        return score, snippet
