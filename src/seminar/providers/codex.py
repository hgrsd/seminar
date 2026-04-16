"""Codex provider - agent command defaults and JSON event parsing."""

from __future__ import annotations

import json
import re
import shlex
from pathlib import Path

from seminar import config
from seminar.providers.claude_code import _calc_model_cost, _lookup_pricing
from seminar.providers.types import LogEvent, LogResult


class CodexProvider:
    def agent_cmd_default(self) -> str:
        return (
            "codex exec --json --skip-git-repo-check "
            "-c 'model_reasoning_effort=\"high\"' "
            "--dangerously-bypass-approvals-and-sandbox"
        )

    def parse_log(self, raw: str) -> list[LogEvent]:
        """Parse Codex exec --json output into generic events."""
        events: list[LogEvent] = []
        for line in raw.splitlines():
            trimmed = line.strip()
            if not trimmed:
                continue

            try:
                parsed = json.loads(trimmed)
            except json.JSONDecodeError:
                events.append(LogEvent(kind="raw", body=trimmed))
                continue
            if not isinstance(parsed, dict):
                continue

            evt_type = parsed.get("type")
            if evt_type in {"thread.started", "turn.started"}:
                continue
            if evt_type in {"turn.completed", "task_complete"}:
                event = _parse_result_event(parsed)
                if event is not None:
                    events.append(event)
                continue
            if evt_type in {"turn.failed", "error"}:
                body = _error_text(parsed)
                if body:
                    events.append(LogEvent(kind="result", body=body))
                continue
            if isinstance(evt_type, str) and evt_type.startswith("item."):
                item = parsed.get("item")
                if isinstance(item, dict):
                    event = _parse_item_event(item)
                    if event is not None:
                        events.append(event)
                continue

        return events

    def extract_log_result(self, path: Path) -> LogResult | None:
        """Extract aggregate usage from Codex JSON logs.

        Codex's JSON stream exposes turn-level token usage. When model names are
        present, estimate cost using LiteLLM pricing; otherwise return usage only.
        """
        try:
            raw = path.read_text()
        except Exception:
            return None

        model = _configured_model()
        per_model: dict[str, dict[str, int]] = {}
        unknown_totals = {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
        }
        num_turns = 0
        found_usage = False

        for line in raw.splitlines():
            trimmed = line.strip()
            if not trimmed:
                continue
            try:
                parsed = json.loads(trimmed)
            except json.JSONDecodeError:
                continue
            if not isinstance(parsed, dict):
                continue

            if parsed.get("type") == "turn.completed":
                usage = parsed.get("usage") or {}
                if not isinstance(usage, dict):
                    continue
                input_tokens = int(usage.get("input_tokens") or 0)
                output_tokens = int(usage.get("output_tokens") or 0)
                cache_read_tokens = int(
                    usage.get("cached_input_tokens")
                    or usage.get("cache_read_input_tokens")
                    or 0
                )
                if model:
                    bucket = per_model.setdefault(
                        model,
                        {
                            "input_tokens": 0,
                            "output_tokens": 0,
                            "cache_creation_tokens": 0,
                            "cache_read_tokens": 0,
                        },
                    )
                    bucket["input_tokens"] += input_tokens
                    bucket["output_tokens"] += output_tokens
                    bucket["cache_read_tokens"] += cache_read_tokens
                else:
                    unknown_totals["input_tokens"] += input_tokens
                    unknown_totals["output_tokens"] += output_tokens
                    unknown_totals["cache_read_tokens"] += cache_read_tokens
                num_turns += 1
                found_usage = True

        if not found_usage:
            return None

        total_cost = 0.0
        cost_estimated = False
        for model, tokens in per_model.items():
            price = _lookup_pricing(model)
            if not price:
                continue
            total_cost += _calc_model_cost(tokens, price)
            cost_estimated = True

        total_input = unknown_totals["input_tokens"]
        total_output = unknown_totals["output_tokens"]
        total_cache_read = unknown_totals["cache_read_tokens"]
        for tokens in per_model.values():
            total_input += tokens["input_tokens"]
            total_output += tokens["output_tokens"]
            total_cache_read += tokens["cache_read_tokens"]

        return LogResult(
            cost_usd=total_cost if cost_estimated else None,
            cost_is_estimate=cost_estimated,
            duration_ms=None,
            num_turns=num_turns,
            input_tokens=total_input,
            output_tokens=total_output,
            cache_read_tokens=total_cache_read,
            cache_creation_tokens=None,
        )


def _parse_item_event(item: dict) -> LogEvent | None:
    item_type = item.get("type")
    item_id = item.get("id")

    if item_type == "reasoning":
        text = item.get("text")
        if text:
            return LogEvent(kind="thinking", body=text, tool_id=item_id)
        return None

    if item_type == "agent_message":
        text = item.get("text")
        if text:
            return LogEvent(kind="text", body=text, tool_id=item_id)
        return None

    if item_type == "command_execution":
        command = item.get("command")
        output = item.get("aggregated_output")
        if command and item.get("status") == "in_progress":
            return LogEvent(
                kind="tool_call",
                body=command,
                label="shell",
                tool_id=item_id,
            )
        if output:
            return LogEvent(
                kind="tool_result",
                body=_truncate(output),
                tool_id=item_id,
            )
        if command and item.get("exit_code") is not None:
            return LogEvent(
                kind="tool_result",
                body=f"Command exited with code {item['exit_code']}",
                tool_id=item_id,
            )
        return None

    if item_type == "mcp_tool_call":
        title = item.get("server")
        if item.get("tool"):
            title = f"{title}:{item['tool']}" if title else item["tool"]
        body = item.get("arguments")
        if not isinstance(body, str) and body is not None:
            body = json.dumps(body, indent=2)
        if body:
            return LogEvent(
                kind="tool_call",
                body=body,
                label=title or "mcp",
                tool_id=item_id,
            )
        return None

    if item_type == "web_search":
        query = item.get("query")
        if query:
            return LogEvent(
                kind="tool_call",
                body=query,
                label="web_search",
                tool_id=item_id,
            )
        return None

    if item_type == "file_change":
        path = item.get("path") or item.get("file_path")
        if path:
            return LogEvent(
                kind="tool_call",
                body=f"Edited {path}",
                label="file_change",
                tool_id=item_id,
            )
        return None

    if item_type == "todo_list":
        items = item.get("items")
        if isinstance(items, list):
            lines = []
            for entry in items:
                if not isinstance(entry, dict):
                    continue
                text = entry.get("text")
                status = entry.get("status")
                if text:
                    prefix = f"[{status}] " if status else ""
                    lines.append(prefix + text)
            if lines:
                return LogEvent(kind="thinking", body="\n".join(lines), tool_id=item_id)
        return None

    return None


def _parse_result_event(parsed: dict) -> LogEvent | None:
    parts: list[str] = []
    usage = parsed.get("usage")
    if isinstance(usage, dict):
        in_tokens = usage.get("input_tokens")
        cached = usage.get("cached_input_tokens") or usage.get("cache_read_input_tokens")
        out_tokens = usage.get("output_tokens")
        if in_tokens is not None:
            parts.append(f"Input: {in_tokens}")
        if cached is not None:
            parts.append(f"Cached: {cached}")
        if out_tokens is not None:
            parts.append(f"Output: {out_tokens}")

    last_message = (
        parsed.get("last_agent_message")
        or parsed.get("last_message")
        or parsed.get("text")
    )
    if last_message and not parts:
        parts.append(str(last_message))

    if not parts:
        return None
    return LogEvent(kind="result", body="  ·  ".join(parts))


def _configured_model() -> str | None:
    agent_cmd_model = _model_from_seminar_agent_cmd()
    if agent_cmd_model:
        return agent_cmd_model
    return _model_from_codex_config()


def _model_from_seminar_agent_cmd() -> str | None:
    try:
        cfg = config.load()
    except Exception:
        return None

    try:
        parts = shlex.split(cfg.agent_cmd)
    except ValueError:
        return None

    for i, part in enumerate(parts):
        if part == "-m" and i + 1 < len(parts):
            return parts[i + 1]
        if part.startswith("--model="):
            model = part.split("=", 1)[1]
            if model:
                return model
        if part == "--model" and i + 1 < len(parts):
            return parts[i + 1]

    return None


def _model_from_codex_config() -> str | None:
    path = Path.home() / ".codex" / "config.toml"
    try:
        raw = path.read_text()
    except Exception:
        return None

    match = re.search(r'(?m)^\s*model\s*=\s*"([^"]+)"\s*$', raw)
    if match:
        return match.group(1)
    return None


def _error_text(parsed: dict) -> str:
    error = parsed.get("error")
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])
    if parsed.get("message"):
        return str(parsed["message"])
    return ""


def _truncate(value: str, limit: int = 2000) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "\n... (truncated)"
