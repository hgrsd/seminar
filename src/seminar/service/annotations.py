"""Study annotation CRUD over completed studies."""

from __future__ import annotations

from typing import Callable

from seminar.service import now
from seminar.service.types import Annotation


class AnnotationService:
    def __init__(self, connect: Callable):
        self.connect = connect

    def list_for_study(self, slug: str, study_number: int) -> list[Annotation]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, idea_slug, study_number, rendered_text_start_offset,
                       rendered_text_end_offset, rendered_text, body, created_at, updated_at
                FROM annotations
                WHERE idea_slug = ? AND study_number = ?
                ORDER BY rendered_text_start_offset ASC, id ASC
                """,
                (slug, study_number),
            ).fetchall()
        return [self._row_to_annotation(row) for row in rows]

    def create(
        self,
        slug: str,
        study_number: int,
        rendered_text_start_offset: int,
        rendered_text_end_offset: int,
        rendered_text: str,
        body: str,
    ) -> Annotation:
        rendered_text = rendered_text.strip()
        body = body.strip()
        self._validate_inputs(
            rendered_text_start_offset,
            rendered_text_end_offset,
            rendered_text,
            body,
        )

        timestamp = now()
        with self.connect() as conn:
            self._ensure_completed_study(conn, slug, study_number)
            self._ensure_no_overlap(
                conn,
                slug,
                study_number,
                rendered_text_start_offset,
                rendered_text_end_offset,
            )
            cursor = conn.execute(
                """
                INSERT INTO annotations (
                    idea_slug,
                    study_number,
                    rendered_text_start_offset,
                    rendered_text_end_offset,
                    rendered_text,
                    body,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    slug,
                    study_number,
                    rendered_text_start_offset,
                    rendered_text_end_offset,
                    rendered_text,
                    body,
                    timestamp,
                    timestamp,
                ),
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT id, idea_slug, study_number, rendered_text_start_offset,
                       rendered_text_end_offset, rendered_text, body, created_at, updated_at
                FROM annotations
                WHERE id = ?
                """,
                (cursor.lastrowid,),
            ).fetchone()
        if row is None:
            raise ValueError("Annotation could not be created.")
        return self._row_to_annotation(row)

    def update(self, annotation_id: int, body: str) -> Annotation:
        body = body.strip()
        if not body:
            raise ValueError("Annotation body cannot be empty.")

        with self.connect() as conn:
            row = conn.execute(
                "SELECT idea_slug, study_number FROM annotations WHERE id = ?",
                (annotation_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"Unknown annotation: {annotation_id}")
            self._ensure_completed_study(conn, row["idea_slug"], row["study_number"])
            conn.execute(
                "UPDATE annotations SET body = ?, updated_at = ? WHERE id = ?",
                (body, now(), annotation_id),
            )
            conn.commit()
            updated = conn.execute(
                """
                SELECT id, idea_slug, study_number, rendered_text_start_offset,
                       rendered_text_end_offset, rendered_text, body, created_at, updated_at
                FROM annotations
                WHERE id = ?
                """,
                (annotation_id,),
            ).fetchone()
        if updated is None:
            raise ValueError(f"Unknown annotation: {annotation_id}")
        return self._row_to_annotation(updated)

    def delete(self, annotation_id: int) -> None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT idea_slug, study_number FROM annotations WHERE id = ?",
                (annotation_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"Unknown annotation: {annotation_id}")
            self._ensure_completed_study(conn, row["idea_slug"], row["study_number"])
            conn.execute("DELETE FROM annotations WHERE id = ?", (annotation_id,))
            conn.commit()

    def _ensure_completed_study(self, conn, slug: str, study_number: int) -> None:
        row = conn.execute(
            """
            SELECT completed_at
            FROM studies
            WHERE idea_slug = ? AND study_number = ?
            """,
            (slug, study_number),
        ).fetchone()
        if row is None or row["completed_at"] is None:
            raise ValueError(
                f"Study {slug} #{study_number} is not completed and cannot be annotated."
            )

    def _ensure_no_overlap(
        self,
        conn,
        slug: str,
        study_number: int,
        start_offset: int,
        end_offset: int,
    ) -> None:
        row = conn.execute(
            """
            SELECT id
            FROM annotations
            WHERE idea_slug = ?
              AND study_number = ?
              AND rendered_text_start_offset < ?
              AND rendered_text_end_offset > ?
            LIMIT 1
            """,
            (slug, study_number, end_offset, start_offset),
        ).fetchone()
        if row is not None:
            raise ValueError("Annotations cannot overlap existing annotations.")

    def _validate_inputs(
        self,
        start_offset: int,
        end_offset: int,
        rendered_text: str,
        body: str,
    ) -> None:
        if start_offset < 0 or end_offset < 0:
            raise ValueError("Rendered text offsets must be non-negative.")
        if start_offset >= end_offset:
            raise ValueError("Rendered text range must have positive length.")
        if not rendered_text:
            raise ValueError("Rendered text cannot be empty.")
        if not body:
            raise ValueError("Annotation body cannot be empty.")

    def _row_to_annotation(self, row) -> Annotation:
        return Annotation(
            id=row["id"],
            idea_slug=row["idea_slug"],
            study_number=row["study_number"],
            rendered_text_start_offset=row["rendered_text_start_offset"],
            rendered_text_end_offset=row["rendered_text_end_offset"],
            rendered_text=row["rendered_text"],
            body=row["body"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
