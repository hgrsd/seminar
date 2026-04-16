"""SQLite database helpers and migration runner for seminar state."""

from __future__ import annotations

import importlib.util
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

SEMINAR_DIR = Path.home() / ".seminar"
DB_PATH = SEMINAR_DIR / "state.db"
MIGRATIONS_DIR = Path(__file__).with_name("migrations")
MIGRATIONS_TABLE = "_seminar_migrations"


def configure(data_dir: Path) -> None:
    """Set the database path from a data directory. Call before any DB access."""
    global SEMINAR_DIR, DB_PATH
    SEMINAR_DIR = data_dir
    DB_PATH = data_dir / "state.db"


@dataclass(frozen=True)
class Migration:
    migration_id: str
    up: Callable[[sqlite3.Connection], None]


def _load_migrations() -> list[Migration]:
    migrations: list[Migration] = []
    for path in sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.py")):
        module_name = f"seminar_migration_{path.stem}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Could not load migration module from {path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        migration_id = getattr(module, "MIGRATION_ID", path.stem)
        up = getattr(module, "up", None)
        if not migration_id or not callable(up):
            raise RuntimeError(
                f"Migration {path.name} must define MIGRATION_ID and callable up(conn)"
            )
        migrations.append(Migration(migration_id=str(migration_id), up=up))
    return migrations


def _ensure_migrations_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {MIGRATIONS_TABLE} (
            migration_id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def applied_migrations() -> list[str]:
    """Return applied migration ids in application order."""
    if not DB_PATH.exists():
        return []
    with connect() as conn:
        _ensure_migrations_table(conn)
        conn.commit()
        rows = conn.execute(
            f"SELECT migration_id FROM {MIGRATIONS_TABLE} ORDER BY migration_id"
        ).fetchall()
        return [str(row["migration_id"]) for row in rows]


@contextmanager
def connect():
    """Open a connection to the seminar database with WAL mode. Closes on exit."""
    SEMINAR_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction():
    """Open a connection with an immediate transaction. Commits on success, rolls back on error."""
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def migrate() -> list[str]:
    """Apply pending migrations and return the ids applied in this run."""
    migrations = _load_migrations()
    with connect() as conn:
        _ensure_migrations_table(conn)
        conn.commit()
        applied_rows = conn.execute(
            f"SELECT migration_id FROM {MIGRATIONS_TABLE}"
        ).fetchall()
        applied = {str(row["migration_id"]) for row in applied_rows}
        newly_applied: list[str] = []
        for migration in migrations:
            if migration.migration_id in applied:
                continue
            conn.execute("BEGIN IMMEDIATE")
            try:
                migration.up(conn)
                conn.execute(
                    f"INSERT INTO {MIGRATIONS_TABLE} (migration_id) VALUES (?)",
                    (migration.migration_id,),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            newly_applied.append(migration.migration_id)
        return newly_applied


def init_db() -> None:
    """Apply all pending database migrations."""
    _ = migrate()
