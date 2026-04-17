"""Local rendered-text annotations attached to completed studies."""

from __future__ import annotations

import sqlite3

MIGRATION_ID = "003_annotations"

SQL = """\
CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_slug TEXT NOT NULL,
    study_number INTEGER NOT NULL,
    rendered_text_start_offset INTEGER NOT NULL,
    rendered_text_end_offset INTEGER NOT NULL,
    rendered_text TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (idea_slug, study_number)
        REFERENCES studies(idea_slug, study_number)
        ON DELETE CASCADE,
    UNIQUE (idea_slug, study_number, rendered_text_start_offset, rendered_text_end_offset)
);

CREATE INDEX IF NOT EXISTS idx_annotations_study
    ON annotations (idea_slug, study_number, rendered_text_start_offset);
"""


def up(conn: sqlite3.Connection) -> None:
    conn.executescript(SQL)
