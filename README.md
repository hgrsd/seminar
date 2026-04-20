# Seminar

![](./assets/screenshot.png)
![](./assets/screenshot_2.png)

Seminar is a local research desk where AI agents investigate ideas from multiple angles over time.

Drop in an idea and leave it alone for a while. Workers claim it, research it, and write studies, each from a deliberate angle. Studies accumulate until a follow-up worker decides the corpus is ready and writes a final synthesis. Along the way, agents can open conversation threads with you, and a separate connective worker reads across the whole corpus looking for genuinely new directions worth pursuing.

When you come back, you'll have a growing body of studies, a queue of follow-up proposals, open threads with agents, and a dashboard for deciding what to pursue, approve, reject, or close.

Seminar runs locally and uses the tools you already have. It does not ship its own model backend; instead, it runs agents through [Claude Code](https://claude.com/claude-code) or [Codex](https://github.com/openai/codex), so it fits into an existing Claude or OpenAI workflow.

## How it works

Three kinds of workers run against the queue on their own schedule:

- Initial exploration: claims an unexplored idea and writes the first study, choosing an angle (deep dive, contrarian take, cross-discipline connection, case study) rather than defaulting to a survey.
- Follow-up research: reads the existing studies and decides whether more research is needed or whether the corpus is ready to close. If more research, it writes a new study from a fresh angle, building on but not repeating prior work. If ready, it writes the synthesis, a capstone document that stands alone as the complete account of what was found.
- Connective research: reads across the whole corpus, does external research, and opens a thread with you when something genuinely new has emerged. The bar is high; exiting without creating anything is the expected outcome. When it does open a thread, the goal is to make you think hard about whether the idea deserves promotion, not to hand you a ready-made proposal.

Initial exploration and follow-up research workers can also propose new ideas mid-research, which land in the proposals queue for you to approve or reject from the dashboard.

Agents can start conversation threads with you at any point, and you can reply from the dashboard. Each reply spins up a fresh stateless turn with no persistent session. If a thread produces concrete research guidance, the thread responder can write a director note directly into the idea's study sequence; follow-up researchers treat the most recent director note as a priority input for their next study.

A study is a long-form research document (750+ words). Studies are required to be well-sourced. Multiple studies accumulate on the same idea over time, each adding a new perspective, until a synthesis closes it out.

## Quick start

Requirements: Python 3.10+, `uv`, Node.js 18+, npm, and Claude Code or Codex installed locally.

```bash
git clone https://github.com/hgrsd/seminar
cd seminar
./install.sh
```

The installer builds the frontend, installs the `seminar` CLI, and runs `seminar init` once to bootstrap local state and install the default worker skills.

Then:

```bash
seminar
```

The dashboard opens at `http://127.0.0.1:8765`. Pass `--headless` to skip the browser.

Open Settings in the dashboard to choose the provider, adjust the agent command, set worker counts and timing, and tell agents what tools and local resources they can use.

## Configuration

`seminar init` creates `~/.seminar/config.json` and installs the default worker skill templates into `~/.seminar/skills`. Ongoing configuration is managed from the dashboard's Settings modal.

Settings currently cover:

| Key | Purpose |
| --- | --- |
| `data_dir` | Where state, logs, and study artifacts live |
| `provider` | `claude-code` or `codex` |
| `agent_cmd` | The exact (non-interactive, permission-skipping) command used to launch the agent |
| `workers.{initial,follow_up,connective}` | Number of workers of each type |
| `intervals.*` | Poll interval, in seconds, per worker type |
| `timeouts.*` | Per-run timeout, in seconds, per worker type |
| `follow_up_research_cooldown_minutes` | Minimum gap before an idea is re-studied |
| `tools` | Notes for agents about the tools, files, sites, or other resources available in your environment |

Use the Tools field in Settings for simple notes like "use `gh` for GitHub data", "check our internal wiki first", or "read this local folder before going to the web."

## Storage

State lives under `data_dir` (default `~/.seminar`):

- `state.db`: durable state, including all studies
- `logs/`: worker run logs
- `scratch/`: per-run working directories and study artefacts

Worker skill templates are installed separately to `~/.seminar/skills` and are not affected by changing `data_dir`.

## CLI

The dashboard covers the human workflow, including configuration. Most CLI commands are intended for workers and external agents: they are how agents claim ideas, submit studies, and propose follow-ups without going through the UI. The handful of exceptions are bootstrap or administrative operations such as `init`, pausing, resetting, and wiping the database.

```text
seminar [--headless]           # launch server + dashboard
seminar init [--provider <name>]
seminar pause | resume
seminar status [slug]
seminar done <slug>
seminar reopen <slug>
seminar reset <slug> | reset-all
seminar nuke-db
seminar uninstall

seminar ideas list
seminar ideas read <slug>
seminar ideas initial-expectation <slug>
seminar ideas director-note <slug> [--thread <id>]   # body via stdin
seminar ideas propose <slug> <parent-slug>... [--title <title>] --author <name>

seminar proposals list
seminar proposals approve <slug>
seminar proposals reject <slug>

seminar threads start <title> --author <name> [--idea <slug>]
seminar threads reply <thread-id> --author <name>
seminar threads close <thread-id>

seminar studies list <slug>
seminar studies read <slug> <study-number>
seminar complete-study <slug> <study-number> <markdown-path> [--mode <mode>] --title <title>

# agent-facing (used by worker skill templates)
seminar claim-new
seminar claim-further
```

## Development

```bash
# backend
uv tool install -e .
uv run --group dev pytest

# frontend
cd src/seminar/server/frontend
npm install
npm run build
```
