MIGRATION_ID = "005_threads"


def up(conn) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS threads (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            title               TEXT NOT NULL,
            status              TEXT NOT NULL
                                CHECK(status IN ('waiting_on_user', 'waiting_on_agent', 'closed')),
            idea_slug           TEXT REFERENCES ideas(slug),
            assigned_responder  TEXT,
            assigned_run_id     INTEGER,
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS thread_messages (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id    INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
            author_type  TEXT NOT NULL
                         CHECK(author_type IN ('user', 'agent', 'system')),
            author_name  TEXT NOT NULL,
            body         TEXT NOT NULL,
            created_at   TEXT NOT NULL,
            event_type   TEXT,
            related_idea_slug TEXT REFERENCES ideas(slug),
            related_study_number INTEGER
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_threads_status_updated
            ON threads (status, updated_at)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_created
            ON thread_messages (thread_id, created_at, id)
    """)
    conn.execute("""
        INSERT INTO threads (id, title, status, idea_slug, assigned_responder, assigned_run_id, created_at, updated_at)
        SELECT
            id,
            title,
            CASE
                WHEN status = 'read' THEN 'closed'
                ELSE 'waiting_on_user'
            END,
            idea_slug,
            NULL,
            NULL,
            recorded_at,
            recorded_at
        FROM messages
    """)
    conn.execute("""
        INSERT INTO thread_messages (thread_id, author_type, author_name, body, created_at, event_type, related_idea_slug, related_study_number)
        SELECT
            id,
            'agent',
            author,
            body,
            recorded_at,
            NULL,
            NULL,
            NULL
        FROM messages
    """)
    conn.execute("DROP INDEX IF EXISTS idx_messages_status")
    conn.execute("DROP TABLE IF EXISTS messages")
