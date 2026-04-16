"""One-off migration: strip numeric prefixes from slugs, backfill titles from frontmatter."""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from seminar import config, db

PREFIX_RE = re.compile(r"^\d+[_-](.+)$")


def _strip_frontmatter(text: str) -> dict:
    """Extract simple key:value frontmatter metadata."""
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    meta = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            meta[key.strip()] = val.strip().strip("\"'")
    return meta


def _title_from_slug(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").title()


def main():
    cfg = config.load()
    db.init_db()

    ideas_dir = Path(cfg["ideas_dir"])
    studies_dir = Path(cfg["studies_dir"])
    logs_dir = Path(cfg.get("logs_dir", "")) if cfg.get("logs_dir") else None

    with db.connect() as conn:
        rows = conn.execute("SELECT slug, title FROM ideas").fetchall()

    renames: list[tuple[str, str]] = []
    for row in rows:
        old_slug = row["slug"]
        m = PREFIX_RE.match(old_slug)
        if m:
            new_slug = m.group(1)
            # Check for conflicts
            with db.connect() as conn:
                conflict = conn.execute(
                    "SELECT 1 FROM ideas WHERE slug = ?", (new_slug,)
                ).fetchone()
            if conflict:
                print(f"  SKIP {old_slug} → {new_slug} (conflict)")
                continue
            renames.append((old_slug, new_slug))

    if not renames:
        print("No slugs to rename.")
    else:
        print(f"Renaming {len(renames)} slug(s):\n")

    for old_slug, new_slug in renames:
        print(f"  {old_slug} → {new_slug}")

        # Rename idea file
        old_file = ideas_dir / f"{old_slug}.md"
        new_file = ideas_dir / f"{new_slug}.md"
        if old_file.exists():
            old_file.rename(new_file)
            print(f"    Renamed idea file")

        # Rename study directory
        old_study_dir = studies_dir / old_slug
        new_study_dir = studies_dir / new_slug
        if old_study_dir.exists():
            old_study_dir.rename(new_study_dir)
            print(f"    Renamed study directory")

        # Rename log files
        if logs_dir and logs_dir.exists():
            for log_file in logs_dir.glob(f"{old_slug}-*.log"):
                new_name = log_file.name.replace(f"{old_slug}-", f"{new_slug}-", 1)
                log_file.rename(logs_dir / new_name)
            print(f"    Renamed log files")

        # Update DB — disable FK checks so we can update parent and children freely
        with db.connect() as conn:
            conn.execute("PRAGMA foreign_keys=OFF")
            conn.execute("UPDATE studies SET idea_slug = ? WHERE idea_slug = ?", (new_slug, old_slug))
            conn.execute("UPDATE idea_sources SET slug = ? WHERE slug = ?", (new_slug, old_slug))
            conn.execute("UPDATE idea_sources SET source_slug = ? WHERE source_slug = ?", (new_slug, old_slug))
            conn.execute("UPDATE proposal_sources SET source_slug = ? WHERE source_slug = ?", (new_slug, old_slug))
            conn.execute("UPDATE worker_runs SET slug = ? WHERE slug = ?", (new_slug, old_slug))
            conn.execute(
                "UPDATE worker_runs SET log_file = REPLACE(log_file, ?, ?) WHERE log_file LIKE ?",
                (f"{old_slug}-", f"{new_slug}-", f"{old_slug}-%"),
            )
            conn.execute("UPDATE ideas SET slug = ? WHERE slug = ?", (new_slug, old_slug))
            conn.commit()
            conn.execute("PRAGMA foreign_keys=ON")
        print(f"    Updated DB")

    # Backfill titles from frontmatter (or slug derivation)
    print("\nBackfilling titles...")
    with db.connect() as conn:
        # Ideas
        null_title_rows = conn.execute(
            "SELECT slug FROM ideas WHERE title IS NULL OR title = ''"
        ).fetchall()
        for row in null_title_rows:
            slug = row["slug"]
            title = None
            idea_file = ideas_dir / f"{slug}.md"
            if idea_file.exists():
                meta = _strip_frontmatter(idea_file.read_text())
                title = meta.get("title")
            if not title:
                title = _title_from_slug(slug)
            conn.execute("UPDATE ideas SET title = ? WHERE slug = ?", (title, slug))
            print(f"  Idea {slug}: {title}")

        # Proposals
        null_proposal_rows = conn.execute(
            "SELECT slug FROM proposed_ideas WHERE title IS NULL OR title = ''"
        ).fetchall()
        proposals_dir = Path(cfg["proposals_dir"])
        for row in null_proposal_rows:
            slug = row["slug"]
            title = None
            proposal_file = proposals_dir / f"{slug}.md"
            if proposal_file.exists():
                meta = _strip_frontmatter(proposal_file.read_text())
                title = meta.get("title")
            if not title:
                title = _title_from_slug(slug)
            conn.execute("UPDATE proposed_ideas SET title = ? WHERE slug = ?", (title, slug))
            print(f"  Proposal {slug}: {title}")

        conn.commit()

    print("\nDone.")


if __name__ == "__main__":
    main()
