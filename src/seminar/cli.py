"""Argument parsing and subcommand dispatch."""

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from urllib import error, request

from seminar import config, db, providers, service
from seminar.config import Config, IntervalsConfig, TimeoutsConfig, WorkersConfig
from seminar.service.ideas import IdeaService
from seminar.service.proposals import ProposalService
from seminar.service.studies import StudyService

LOCAL_API_BASE = "http://127.0.0.1:8765"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="seminar",
        description="Autonomous research lab — drop in topics as markdown and a pool of AI agents will research them, producing structured studies that build on each other over time.",
    )
    parser.add_argument(
        "--headless", action="store_true", help="Run without opening a browser"
    )
    sub = parser.add_subparsers(dest="command")

    # init
    init_p = sub.add_parser("init", help="Bootstrap config, DB, and install skills")
    init_p.add_argument(
        "--provider", help="Agent provider (e.g. claude-code, codex)"
    )

    # status
    status_p = sub.add_parser("status", help="Show ideas / drill into studies")
    status_p.add_argument("slug", nargs="?", help="Idea slug to drill into")

    # done
    done_p = sub.add_parser("done", help="Mark idea as done")
    done_p.add_argument("slug")

    # reset
    reset_p = sub.add_parser("reset", help="Reset idea to not_started")
    reset_p.add_argument("slug")

    # reset-all
    sub.add_parser("reset-all", help="Reset all ideas")

    # nuke-db
    sub.add_parser("nuke-db", help="Delete the database")

    # ideas
    ideas_p = sub.add_parser("ideas", help="Idea commands")
    ideas_sub = ideas_p.add_subparsers(dest="ideas_command")
    ideas_sub.add_parser(
        "list", help="List all ideas with slug, title, and description"
    )
    ideas_read_p = ideas_sub.add_parser("read", help="Read the full idea file")
    ideas_read_p.add_argument("slug")
    ideas_propose_p = ideas_sub.add_parser(
        "propose",
        help="Propose a new idea (body via stdin, goes to proposals queue)",
    )
    ideas_propose_p.add_argument("slug")
    ideas_propose_p.add_argument("parent_slugs", nargs="*", help="Parent idea slug(s)")
    ideas_propose_p.add_argument("--title", default=None, help="Proposal title")
    ideas_propose_p.add_argument(
        "--author", required=True, help="Author name for the proposal"
    )

    # proposals
    proposals_p = sub.add_parser("proposals", help="Proposal commands")
    proposals_sub = proposals_p.add_subparsers(dest="proposals_command")
    proposals_sub.add_parser("list", help="List all proposals")
    proposals_approve_p = proposals_sub.add_parser("approve", help="Approve a proposal")
    proposals_approve_p.add_argument("slug")
    proposals_reject_p = proposals_sub.add_parser("reject", help="Reject a proposal")
    proposals_reject_p.add_argument("slug")

    # studies
    studies_p = sub.add_parser("studies", help="Study commands")
    studies_sub = studies_p.add_subparsers(dest="studies_command")
    studies_list_p = studies_sub.add_parser("list", help="List studies for an idea")
    studies_list_p.add_argument("slug")
    studies_read_p = studies_sub.add_parser("read", help="Read a study's content")
    studies_read_p.add_argument("slug")
    studies_read_p.add_argument("study_number", type=int)

    # pause / resume
    sub.add_parser("pause", help="Pause the worker fleet")
    sub.add_parser("resume", help="Resume the worker fleet")

    # uninstall
    sub.add_parser("uninstall", help="Remove installed skills and config")

    # claim-new (agent-facing)
    sub.add_parser("claim-new", help="Claim an unstarted idea for initial exploration")

    # claim-further (agent-facing)
    sub.add_parser("claim-further", help="Claim an explored idea for follow-up research")

    # complete-study (agent-facing)
    complete_p = sub.add_parser("complete-study", help="Mark a study as complete")
    complete_p.add_argument("slug")
    complete_p.add_argument("study_number", type=int)
    complete_p.add_argument("markdown_path", help="Path to the study markdown file")
    complete_p.add_argument(
        "--mode", default=None, help="Override the study mode (e.g. synthesis)"
    )
    complete_p.add_argument("--title", required=True, help="Study title")

    args = parser.parse_args(argv)

    def _svc():
        cfg = config.load()
        db.configure(Path(cfg.data_dir))
        db.init_db()
        connect = db.connect
        return SimpleNamespace(
            ideas=IdeaService(cfg.scratch_dir, connect),
            studies=StudyService(cfg.scratch_dir, cfg.follow_up_research_cooldown_minutes, connect),
            proposals=ProposalService(connect),
        )

    def _configure_db():
        cfg = config.load()
        db.configure(Path(cfg.data_dir))

    dispatch = {
        "init": lambda: _cmd_init(args.provider),
        "status": lambda: _cmd_status(_svc(), args.slug),
        "done": lambda: _cmd_done(args.slug),
        "reset": lambda: _cmd_reset(args.slug),
        "reset-all": _cmd_reset_all,
        "pause": _cmd_pause,
        "resume": _cmd_resume,
        "nuke-db": lambda: (_configure_db(), service.nuke_db(), print("Database deleted.")),
        "ideas": lambda: _cmd_ideas(_svc(), args),
        "proposals": lambda: _cmd_proposals(_svc(), args),
        "studies": lambda: _cmd_studies(_svc(), args),
        "uninstall": _cmd_uninstall,
        "claim-new": _cmd_claim_new,
        "claim-further": _cmd_claim_further,
        "complete-study": lambda: _cmd_complete_study(
            args.slug, args.study_number, args.markdown_path, args.mode, args.title
        ),
    }

    handler = dispatch.get(args.command)
    if handler is None:
        _cmd_supervisor(headless=args.headless)
    else:
        handler()


def _strip_control(s: str) -> str:
    return "".join(c for c in s if c >= " " or c in "\t\n")


def _prompt(label: str, default: str) -> str:
    default = _strip_control(default)
    display = f"  {label} [{default}]: " if default else f"  {label}: "
    value = input(display).strip()
    return value or default


def _prompt_provider(default: str) -> str:
    options = ", ".join(providers.PROVIDERS)
    while True:
        value = _prompt(f"Provider ({options})", default)
        if value in providers.PROVIDERS:
            return value
        print(f"Error: unsupported provider {value!r}. Use one of: {options}.")


def _cmd_init(provider_name: str | None) -> None:
    # Load existing config if re-initializing
    try:
        existing = config.load()
    except (FileNotFoundError, KeyError):
        existing = None

    default_dir = str(Path.home() / ".seminar")

    print("Configure seminar (press Enter to accept defaults):\n")

    provider_name = provider_name or _prompt_provider(
        existing.provider if existing else "claude-code"
    )
    provider = providers.load(provider_name)
    data_dir = _prompt("Data directory", existing.data_dir if existing else default_dir)
    agent_cmd_default = (
        existing.agent_cmd
        if existing and existing.provider == provider_name
        else provider.agent_cmd_default()
    )
    agent_cmd = _prompt("Agent command", agent_cmd_default)

    worker_kinds = [("initial", "Initial exploration"), ("follow_up", "Follow-up research"), ("connective", "Connective research")]

    worker_defaults = {
        "initial": "1",
        "follow_up": "1",
        "connective": "0"
    }
    worker_vals: dict[str, int] = {}
    for key, label in worker_kinds:
        current = str(getattr(existing.workers, key)) if existing else worker_defaults[key]
        worker_vals[key] = int(_prompt(f"{label} workers", current))

    interval_vals: dict[str, int] = {}
    for key, label in worker_kinds:
        current = str(getattr(existing.intervals, key)) if existing else {"initial": "30", "follow_up": "600", "connective": "900"}[key]
        interval_vals[key] = int(_prompt(f"{label} interval (seconds)", current))

    timeout_vals: dict[str, int] = {}
    for key, label in worker_kinds:
        current = str(getattr(existing.timeouts, key)) if existing else "1500"
        timeout_vals[key] = int(_prompt(f"{label} timeout (seconds)", current))

    cooldown = int(_prompt(
        "Follow-up research cooldown (minutes)",
        str(existing.follow_up_research_cooldown_minutes) if existing else "10",
    ))

    cfg = Config(
        data_dir=data_dir,
        provider=provider_name,
        agent_cmd=agent_cmd,
        intervals=IntervalsConfig(
            initial=interval_vals["initial"],
            follow_up=interval_vals["follow_up"],
            connective=interval_vals["connective"],
        ),
        timeouts=TimeoutsConfig(
            initial=timeout_vals["initial"],
            follow_up=timeout_vals["follow_up"],
            connective=timeout_vals["connective"],
        ),
        workers=WorkersConfig(
            initial=worker_vals["initial"],
            follow_up=worker_vals["follow_up"],
            connective=worker_vals["connective"],
        ),
        follow_up_research_cooldown_minutes=cooldown,
        tools=existing.tools if existing else [],
    )

    print()
    config.save(cfg)
    db.configure(Path(cfg.data_dir))
    db.init_db()

    print(f"Initialized seminar with provider {provider_name!r}.")
    print(f"Config written to {config.CONFIG_PATH}")


def _cmd_status(svc: SimpleNamespace, slug: str | None) -> None:
    if slug:
        try:
            print(json.dumps(asdict(svc.ideas.status(slug)), indent=2))
        except KeyError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print(json.dumps([asdict(s) for s in svc.ideas.status_all()], indent=2))


def _cmd_propose_idea(
    slug: str, parent_slugs: list[str],
    title: str | None = None, author: str = "",
) -> None:
    if not parent_slugs:
        print(
            "Error: proposals must include the slug(s) of the idea(s) that inspired them.",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        slug = service.validate_slug(slug)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    if title is None:
        title = slug.replace("-", " ").replace("_", " ").title()
    body = sys.stdin.read()
    if not body.strip():
        print("Error: proposal body must be provided via stdin.", file=sys.stderr)
        sys.exit(1)
    result = _api_request(
        "POST",
        "/api/proposals",
        {
            "slug": slug,
            "title": title,
            "author": author,
            "body": body,
            "parent_slugs": parent_slugs,
        },
    )
    canonical = result["slug"]
    print(canonical)


def _cmd_proposals(svc: SimpleNamespace, args) -> None:
    if args.proposals_command == "list":
        print(json.dumps([asdict(p) for p in svc.proposals.list_all()], indent=2))
    elif args.proposals_command == "approve":
        result = _api_request("POST", f"/api/proposals/{args.slug}/approve")
        canonical = result["slug"]
        print(f"Approved. Created idea: {canonical}")
    elif args.proposals_command == "reject":
        _api_request("POST", f"/api/proposals/{args.slug}/reject")
        print(f"Rejected proposal: {args.slug}")
    else:
        print("Usage: seminar proposals {list|approve|reject}", file=sys.stderr)
        sys.exit(1)


def _cmd_ideas(svc: SimpleNamespace, args) -> None:
    if args.ideas_command == "list":
        print(json.dumps([asdict(i) for i in svc.ideas.list_all()], indent=2))
    elif args.ideas_command == "read":
        content = svc.ideas.read(args.slug)
        if content is None:
            print(f"Idea not found: {args.slug}", file=sys.stderr)
            sys.exit(1)
        print(content)
    elif args.ideas_command == "propose":
        _cmd_propose_idea(args.slug, args.parent_slugs, args.title, args.author)
    else:
        print("Usage: seminar ideas {list|read|propose}", file=sys.stderr)
        sys.exit(1)


def _cmd_studies(svc: SimpleNamespace, args) -> None:
    if args.studies_command == "list":
        studies = svc.studies.for_idea(args.slug)
        # Output metadata only (without full content) for listing.
        print(json.dumps([
            {"study_number": s.study_number, "title": s.title, "mode": s.mode, "created_at": s.created_at}
            for s in studies
        ], indent=2))
    elif args.studies_command == "read":
        body = svc.studies.read_study_body(args.slug, args.study_number)
        if body is None:
            print(f"Study not found: {args.slug} #{args.study_number}", file=sys.stderr)
            sys.exit(1)
        print(body)
    else:
        print("Usage: seminar studies {list|read} ...", file=sys.stderr)
        sys.exit(1)


def _cmd_reset(slug: str) -> None:
    print(f"This will destructively reset '{slug}':")
    print("  - Delete all study rows from the database")
    print("  - Delete any study files for this idea")
    print("  - Set state back to not_started")
    answer = input("Proceed? [y/N] ").strip().lower()
    if answer != "y":
        print("Aborted.")
        return
    _api_request("POST", f"/api/ideas/{slug}/reset")
    print(f"Reset {slug}.")


def _cmd_reset_all() -> None:
    print("This will destructively reset ALL ideas:")
    print("  - Delete all study rows from the database")
    print("  - Delete all study directories")
    print("  - Set all ideas back to not_started")
    answer = input("Proceed? [y/N] ").strip().lower()
    if answer != "y":
        print("Aborted.")
        return
    _api_request("POST", "/api/ideas/reset-all")
    print("Reset all ideas.")


def _cmd_uninstall() -> None:
    try:
        cfg = config.load()
        db.configure(Path(cfg.data_dir))
    except (FileNotFoundError, KeyError):
        pass

    print("This will delete:")
    if db.DB_PATH.exists():
        print(f"  - {db.DB_PATH} (state database)")
    if config.CONFIG_PATH.exists():
        print(f"  - {config.CONFIG_PATH} (config)")
    seminar_dir = config.CONFIG_PATH.parent
    if seminar_dir.exists():
        print(f"  - {seminar_dir}/ (if empty)")

    print()
    answer = input("Proceed? [y/N] ").strip().lower()
    if answer != "y":
        print("Aborted.")
        return

    service.nuke_db()
    if config.CONFIG_PATH.exists():
        config.CONFIG_PATH.unlink()
    if seminar_dir.exists() and not any(seminar_dir.iterdir()):
        seminar_dir.rmdir()
    print("Done.")


def _cmd_supervisor(headless: bool = False) -> None:
    if not config.CONFIG_PATH.exists():
        print(
            "Seminar is not initialized. Run `seminar init` first."
        )
        sys.exit(1)
    cfg = config.load()
    db.configure(Path(cfg.data_dir))
    db.init_db()
    from seminar.server.server import run

    run(headless=headless)


def _cmd_pause() -> None:
    _api_request("POST", "/api/pause")
    print("Fleet paused.")


def _cmd_resume() -> None:
    _api_request("POST", "/api/resume")
    print("Fleet resumed.")


def _cmd_done(slug: str) -> None:
    _api_request("POST", f"/api/ideas/{slug}/done")


def _cmd_claim_new() -> None:
    result = _api_request("POST", "/api/studies/claim", {"mode": "initial_exploration"})
    print(json.dumps(result))


def _cmd_claim_further() -> None:
    result = _api_request("POST", "/api/studies/claim", {"mode": "follow_up_research"})
    print(json.dumps(result))


def _cmd_complete_study(
    slug: str,
    study_number: int,
    markdown_path: str,
    mode: str | None,
    title: str,
) -> None:
    _api_request(
        "POST",
        f"/api/studies/{slug}/{study_number}/complete",
        {"markdown_path": markdown_path, "mode": mode, "title": title},
    )
    print(f"Study {slug} #{study_number} published.")


def _api_request(method: str, path: str, payload: dict | None = None):
    url = f"{LOCAL_API_BASE}{path}"
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
    except error.HTTPError as e:
        message = _decode_api_error(e)
        print(f"Error: {message}", file=sys.stderr)
        sys.exit(1)
    except error.URLError:
        print(
            f"Error: Seminar server is not running at {LOCAL_API_BASE}. Start `seminar` first.",
            file=sys.stderr,
        )
        sys.exit(1)

    if not body:
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"raw": body}


def _decode_api_error(e: error.HTTPError) -> str:
    try:
        payload = json.loads(e.read().decode("utf-8"))
    except Exception:
        return f"request failed with status {e.code}"
    if isinstance(payload, dict) and isinstance(payload.get("error"), str):
        return payload["error"]
    return f"request failed with status {e.code}"


if __name__ == "__main__":
    main()
