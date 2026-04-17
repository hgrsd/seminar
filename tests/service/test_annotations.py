import tempfile
import unittest
from pathlib import Path
from typing import override

from seminar import db
from seminar.service.annotations import AnnotationService
from seminar.service.ideas import IdeaService
from seminar.service.studies import StudyService
from seminar.service.types import Annotation


class AnnotationServiceTests(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    data_dir: Path | None = None
    annotation_service: AnnotationService | None = None
    idea_service: IdeaService | None = None
    study_service: StudyService | None = None

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        db.configure(self.data_dir)
        db.init_db()
        self.annotation_service = AnnotationService(db.connect)
        self.idea_service = IdeaService(self.data_dir / "scratch", db.connect)
        self.study_service = StudyService(self.data_dir / "scratch", 10, db.connect)
        self._insert_completed_study("topic", 1, "Published body")

    @override
    def tearDown(self) -> None:
        if self.temp_dir is not None:
            self.temp_dir.cleanup()

    def test_create_list_update_and_delete_annotation(self) -> None:
        created = self._annotation_service().create(
            "topic",
            1,
            10,
            21,
            "Published b",
            "Important passage.",
        )

        self.assertEqual(
            self._annotation_service().list_for_study("topic", 1),
            [
                Annotation(
                    id=created.id,
                    idea_slug="topic",
                    study_number=1,
                    rendered_text_start_offset=10,
                    rendered_text_end_offset=21,
                    rendered_text="Published b",
                    body="Important passage.",
                    created_at=created.created_at,
                    updated_at=created.updated_at,
                )
            ],
        )

        updated = self._annotation_service().update(created.id, "Revised note.")
        self.assertEqual(updated.body, "Revised note.")

        self._annotation_service().delete(created.id)
        self.assertEqual(self._annotation_service().list_for_study("topic", 1), [])

    def test_create_rejects_overlapping_annotation_ranges(self) -> None:
        _ = self._annotation_service().create(
            "topic",
            1,
            5,
            12,
            "shed bo",
            "First note.",
        )

        with self.assertRaisesRegex(ValueError, "cannot overlap"):
            self._annotation_service().create(
                "topic",
                1,
                8,
                14,
                "d body",
                "Second note.",
            )

    def _insert_completed_study(self, slug: str, study_number: int, body: str) -> None:
        self._idea_service().create(slug, body, title=slug.title(), author="Ada")
        markdown_path = self._data_dir() / f"{slug}-{study_number}.md"
        _ = markdown_path.write_text(body)
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO studies (
                    idea_slug, study_number, started_at, completed_at, mode, title, filename, body
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    slug,
                    study_number,
                    "2024-01-01T00:00:00Z",
                    "2024-01-01T01:00:00Z",
                    "initial_exploration",
                    "Study",
                    markdown_path.name,
                    body,
                ),
            )
            conn.commit()

    def _annotation_service(self) -> AnnotationService:
        assert self.annotation_service is not None
        return self.annotation_service

    def _idea_service(self) -> IdeaService:
        assert self.idea_service is not None
        return self.idea_service

    def _data_dir(self) -> Path:
        assert self.data_dir is not None
        return self.data_dir
