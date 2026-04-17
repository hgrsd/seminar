"""Initial expectations attached to ideas."""

from __future__ import annotations

import sqlite3

MIGRATION_ID = "002_initial_expectations"

SQL = """\
CREATE TABLE IF NOT EXISTS initial_expectations (
    idea_slug TEXT PRIMARY KEY REFERENCES ideas(slug) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def up(conn: sqlite3.Connection) -> None:
    conn.executescript(SQL)
