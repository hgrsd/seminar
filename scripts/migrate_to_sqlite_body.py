"""One-off migration: rename research_status → ideas, add body columns, ingest markdown files."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from seminar import config, db


def _strip_frontmatter(text: str) -> str:
    """Return the body of a markdown file, stripping YAML frontmatter."""
    if not text.startswith("---"):
        return text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return text
    return parts[2].strip()


def main():
    cfg = config.load()
    ideas_dir = Path(cfg.ideas_dir)
    studies_dir = Path(cfg.studies_dir)
    proposals_dir = Path(cfg.proposals_dir)

    with db.connect() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

        # Step 1: Rename research_status → ideas
        if "research_status" in tables and "ideas" not in tables:
            conn.execute("ALTER TABLE research_status RENAME TO ideas")
            print("Renamed research_status → ideas")
        elif "ideas" in tables:
            print("Table 'ideas' already exists, skipping rename")
        else:
            print("ERROR: neither research_status nor ideas table found", file=sys.stderr)
            sys.exit(1)

        # Step 2: Add body columns where missing
        for table in ("ideas", "studies", "proposed_ideas"):
            existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            if "body" not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN body TEXT")
                print(f"Added body column to {table}")
            else:
                print(f"Table {table} already has body column")

        conn.commit()

        # Step 3: Ingest idea bodies from markdown files
        idea_rows = conn.execute("SELECT slug FROM ideas WHERE body IS NULL").fetchall()
        ingested_ideas = 0
        missing_ideas = 0
        for row in idea_rows:
            slug = row["slug"]
            path = ideas_dir / f"{slug}.md"
            if path.exists():
                body = _strip_frontmatter(path.read_text())
                conn.execute("UPDATE ideas SET body = ? WHERE slug = ?", (body, slug))
                ingested_ideas += 1
            else:
                missing_ideas += 1
                print(f"  WARN: no file for idea {slug}")
        conn.commit()
        print(f"Ideas: ingested {ingested_ideas}, missing files {missing_ideas}, already had body {len(conn.execute('SELECT 1 FROM ideas WHERE body IS NOT NULL').fetchall()) - ingested_ideas}")

        # Step 4: Ingest study bodies from markdown files
        study_rows = conn.execute(
            "SELECT idea_slug, study_number, filename FROM studies WHERE body IS NULL AND completed_at IS NOT NULL"
        ).fetchall()
        ingested_studies = 0
        missing_studies = 0
        for row in study_rows:
            slug = row["idea_slug"]
            filename = row["filename"]
            if filename:
                path = studies_dir / slug / filename
                if path.exists():
                    body = _strip_frontmatter(path.read_text())
                    conn.execute(
                        "UPDATE studies SET body = ? WHERE idea_slug = ? AND study_number = ?",
                        (body, slug, row["study_number"]),
                    )
                    ingested_studies += 1
                else:
                    missing_studies += 1
                    print(f"  WARN: no file for study {slug}/{filename}")
            else:
                missing_studies += 1
                print(f"  WARN: no filename for study {slug} #{row['study_number']}")
        conn.commit()
        print(f"Studies: ingested {ingested_studies}, missing files {missing_studies}")

        # Step 5: Ingest proposal bodies from markdown files
        proposal_rows = conn.execute("SELECT slug FROM proposed_ideas WHERE body IS NULL").fetchall()
        ingested_proposals = 0
        missing_proposals = 0
        for row in proposal_rows:
            slug = row["slug"]
            path = proposals_dir / f"{slug}.md"
            if path.exists():
                body = _strip_frontmatter(path.read_text())
                conn.execute("UPDATE proposed_ideas SET body = ? WHERE slug = ?", (body, slug))
                ingested_proposals += 1
            else:
                missing_proposals += 1
                print(f"  WARN: no file for proposal {slug}")
        conn.commit()
        print(f"Proposals: ingested {ingested_proposals}, missing files {missing_proposals}")

        # Step 6: Verify
        ideas_total = conn.execute("SELECT COUNT(*) as n FROM ideas").fetchone()["n"]
        ideas_with_body = conn.execute("SELECT COUNT(*) as n FROM ideas WHERE body IS NOT NULL AND body != ''").fetchone()["n"]
        studies_total = conn.execute("SELECT COUNT(*) as n FROM studies WHERE completed_at IS NOT NULL").fetchone()["n"]
        studies_with_body = conn.execute("SELECT COUNT(*) as n FROM studies WHERE completed_at IS NOT NULL AND body IS NOT NULL AND body != ''").fetchone()["n"]
        proposals_total = conn.execute("SELECT COUNT(*) as n FROM proposed_ideas").fetchone()["n"]
        proposals_with_body = conn.execute("SELECT COUNT(*) as n FROM proposed_ideas WHERE body IS NOT NULL AND body != ''").fetchone()["n"]

        print(f"\nVerification:")
        print(f"  Ideas:     {ideas_with_body}/{ideas_total} have body")
        print(f"  Studies:   {studies_with_body}/{studies_total} have body")
        print(f"  Proposals: {proposals_with_body}/{proposals_total} have body")

        if ideas_with_body < ideas_total or studies_with_body < studies_total or proposals_with_body < proposals_total:
            print("\nWARN: some rows are missing body content — check the warnings above.")
        else:
            print("\nAll rows have body content. Migration complete.")


if __name__ == "__main__":
    main()
