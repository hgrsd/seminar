MIGRATION_ID = "004_messages"


def up(conn) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_at TEXT NOT NULL,
            title       TEXT NOT NULL,
            author      TEXT NOT NULL,
            body        TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'unread'
                        CHECK(status IN ('unread', 'read')),
            idea_slug   TEXT REFERENCES ideas(slug)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_messages_status
            ON messages (status, recorded_at)
    """)
