"""Service layer: shared utilities and constants."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from seminar import db

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,198}[a-z0-9]$")


class IdeaState:
    NOT_STARTED = "not_started"
    INITIAL_EXPLORATION = "initial_exploration"
    FOLLOW_UP_RESEARCH = "follow_up_research"
    DONE = "done"


class ProposalStatus:
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


def validate_slug(slug: str) -> str:
    """Validate and return a sanitized slug, or raise ValueError."""
    slug = slug.strip().lower().replace(" ", "-")
    if not slug or not SLUG_RE.match(slug):
        raise ValueError(
            f"Invalid slug {slug!r}: must be 2-200 chars, lowercase alphanumeric/hyphens/underscores, "
            "no leading/trailing hyphens or underscores."
        )
    return slug



def build_frontmatter(**fields: str | None) -> str:
    """Build a YAML frontmatter block from key-value pairs. None values are omitted."""
    lines = [f"{k}: {v}" for k, v in fields.items() if v is not None]
    lines.append(f"created_at: {now()}")
    return "---\n" + "\n".join(lines) + "\n---\n\n"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def strip_frontmatter(text: str) -> tuple[dict, str]:
    """Split YAML frontmatter from markdown body.

    Only handles simple single-line 'key: value' pairs.
    Multiline values, lists, and quoted strings are not supported.
    """
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    meta = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            meta[key.strip()] = val.strip().strip("\"'")
    return meta, parts[2].strip()


def read_body(path: Path) -> str:
    """Read a markdown file and return the body without frontmatter."""
    if not path.exists():
        return ""
    _, body = strip_frontmatter(path.read_text())
    return body


def is_paused() -> bool:
    """Check if the worker fleet is paused."""
    with db.connect() as conn:
        row = conn.execute(
            "SELECT value FROM global_state WHERE key = 'paused'"
        ).fetchone()
        return row is not None and row["value"] == "1"


def pause() -> None:
    """Pause the worker fleet."""
    with db.connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO global_state (key, value) VALUES ('paused', '1')"
        )
        conn.commit()


def resume() -> None:
    """Resume the worker fleet."""
    with db.connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO global_state (key, value) VALUES ('paused', '0')"
        )
        conn.commit()


def nuke_db() -> None:
    """Delete the database file."""
    if db.DB_PATH.exists():
        db.DB_PATH.unlink()
    wal = db.DB_PATH.parent / (db.DB_PATH.name + "-wal")
    shm = db.DB_PATH.parent / (db.DB_PATH.name + "-shm")
    for f in (wal, shm):
        if f.exists():
            f.unlink()


