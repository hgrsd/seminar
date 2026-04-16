"""Initial Seminar schema."""

from __future__ import annotations

import sqlite3

MIGRATION_ID = "001_initial_schema"

SQL = """\
CREATE TABLE IF NOT EXISTS ideas (
    slug TEXT PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    last_studied TEXT,
    current_state TEXT NOT NULL DEFAULT 'not_started'
        CHECK(current_state IN ('not_started', 'initial_exploration', 'follow_up_research', 'done')),
    locked_by INTEGER,
    title TEXT NOT NULL,
    author TEXT,
    body TEXT
);

CREATE TABLE IF NOT EXISTS studies (
    idea_slug TEXT NOT NULL REFERENCES ideas(slug),
    study_number INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    mode TEXT NOT NULL DEFAULT 'initial_exploration',
    title TEXT,
    filename TEXT,
    body TEXT,
    PRIMARY KEY (idea_slug, study_number)
);

CREATE TABLE IF NOT EXISTS idea_sources (
    slug TEXT NOT NULL REFERENCES ideas(slug),
    source_slug TEXT NOT NULL REFERENCES ideas(slug),
    PRIMARY KEY (slug, source_slug)
);

CREATE TABLE IF NOT EXISTS proposed_ideas (
    slug TEXT PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'approved', 'rejected')),
    title TEXT NOT NULL,
    author TEXT,
    body TEXT
);

CREATE TABLE IF NOT EXISTS proposal_sources (
    slug TEXT NOT NULL REFERENCES proposed_ideas(slug),
    source_slug TEXT NOT NULL REFERENCES ideas(slug),
    PRIMARY KEY (slug, source_slug)
);

CREATE TABLE IF NOT EXISTS worker_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    worker_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    slug TEXT,
    study_number INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    exit_code INTEGER,
    timed_out INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    log_file TEXT,
    cost_usd REAL,
    cost_is_estimate INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_creation_tokens INTEGER,
    num_turns INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ideas_claimable
    ON ideas (current_state, locked_by, recorded_at);

CREATE INDEX IF NOT EXISTS idx_studies_completed
    ON studies (idea_slug, completed_at);

CREATE INDEX IF NOT EXISTS idx_worker_runs_started
    ON worker_runs (started_at);

CREATE TABLE IF NOT EXISTS global_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO global_state (key, value) VALUES ('paused', '0');
"""


def up(conn: sqlite3.Connection) -> None:
    conn.executescript(SQL)
