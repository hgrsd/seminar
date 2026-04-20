# Seminar

![](./assets/screenshot.png)
![](./assets/screenshot_2.png)

Seminar is a research desk for ideas that deserve more than a chat session.

Drop one in and leave. Agents pick it up, each from a different angle: a deep dive, a contrarian take, a cross-discipline link, a case study. Studies pile up on the idea's page. When the corpus is ready, a later agent writes a synthesis that closes it out.

It is not an oracle. It gives you things to read and questions to sit with. Studies are long and sourced on purpose. When an agent interrupts you, it's with a question, not a conclusion.

## Using it

Open the dashboard. Your ideas are on the left with study counts next to them. Click one to see the original idea definition and every study written under it so far. Read one, read them all, or jump to the synthesis.

Threads are the means of making the thinking more collaborative. An agent might flag a tension between two studies, question an assumption, or hand you a reading list before the next round. The bar for opening one is high, so when a thread shows up it's worth opening. Reply at whatever depth you want. If your reply contains real steering, it becomes a director's note on the idea, and the next agent to pick it up treats that note as a priority. This is how you steer the research: by talking to the agents already doing it.

Agents can also propose new ideas for you to approve, reject (or ignore...).

## How it works

Three kinds of workers run against the queue.

An initial exploration worker claims an unexplored idea and writes the opening study. A follow-up research worker reads what exists and decides whether the idea needs another study or is ready for synthesis, then writes whichever applies. A connective worker reads across everything you're researching, does its own external reading, and opens a thread only when something genuinely new has surfaced to ask you for your views or to propose a new idea for further study.

## Running it

Seminar runs locally and brings no model of its own. It drives agents through [Claude Code](https://claude.com/claude-code) or [Codex](https://github.com/openai/codex), so it fits into a setup you already have.

You'll need Python 3.10+, `uv`, Node.js 18+, npm, and Claude Code or Codex on your machine.

```bash
git clone https://github.com/hgrsd/seminar
cd seminar
./install.sh
seminar
```

The dashboard opens at `http://127.0.0.1:8765`. Pass `--headless` to skip the browser.

Configuration lives in the dashboard's Settings panel: provider, worker counts, poll intervals, timeouts, and notes about what tools and resources agents can use. The Tools field is where you tell agents things like "use `gh` for GitHub" or "check the internal wiki before the open web."

## Reference

The dashboard covers the human workflow. The CLI is mostly for worker agents claiming ideas and submitting studies, plus a handful of admin commands.

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
