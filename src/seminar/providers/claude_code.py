"""Claude Code provider — agent command defaults and log parsing."""

import json
import logging
import time
import urllib.request
from pathlib import Path

from seminar.providers.types import LogEvent, LogResult

log = logging.getLogger(__name__)


class ClaudeCodeProvider:
    def agent_cmd_default(self) -> str:
        return "claude -p --dangerously-skip-permissions --verbose --output-format stream-json"

    def parse_log(self, raw: str) -> list[LogEvent]:
        """Parse Claude Code stream-json log into generic events."""
        events: list[LogEvent] = []
        last_ts = None
        for line in raw.split("\n"):
            trimmed = line.strip()
            if not trimmed:
                continue

            try:
                parsed = json.loads(trimmed)
            except json.JSONDecodeError:
                events.append(LogEvent(kind="raw", body=trimmed, ts=last_ts))
                continue

            ts = parsed.get("timestamp") or last_ts
            last_ts = ts
            msg_type = parsed.get("type")

            if msg_type == "system":
                continue
            elif msg_type == "assistant" and "message" in parsed:
                new_events = _parse_assistant_blocks(parsed["message"])
            elif msg_type == "user" and "message" in parsed:
                new_events = _parse_tool_results(parsed)
            elif msg_type == "result":
                new_events = [_parse_result_summary(parsed)]
            else:
                continue

            for evt in new_events:
                evt.ts = ts
            events.extend(new_events)

        return events

    def extract_log_result(self, path: Path) -> LogResult | None:
        """Extract cost, duration, and per-model stats from a log file.

        Uses the authoritative result line if present. Falls back to estimating
        from deduplicated intermediate usage + LiteLLM pricing for failed/incomplete runs.
        """
        try:
            lines = path.read_bytes().split(b"\n")
        except Exception:
            return None

        if not lines:
            return None

        for line in reversed(lines):
            if line.strip():
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    break
                if data.get("type") == "result":
                    return _extract_from_result(data)
                break

        return _estimate_from_intermediates(lines)


def _parse_assistant_blocks(message: dict) -> list[LogEvent]:
    events: list[LogEvent] = []
    for block in message.get("content", []):
        block_type = block.get("type")
        if block_type == "thinking" and block.get("thinking"):
            events.append(LogEvent(kind="thinking", body=block["thinking"]))
        elif block_type == "text" and block.get("text"):
            events.append(LogEvent(kind="text", body=block["text"]))
        elif block_type == "tool_use":
            inp = block.get("input", {})
            if inp.get("command"):
                summary = inp["command"]
            elif inp.get("file_path"):
                summary = f"Read {inp['file_path']}"
            elif inp.get("pattern"):
                summary = f"Glob {inp['pattern']}"
            elif inp.get("skill"):
                summary = f"Skill: {inp['skill']}"
            else:
                summary = json.dumps(inp, indent=2)
            events.append(LogEvent(
                kind="tool_call",
                body=summary,
                label=block.get("name", "unknown"),
                tool_id=block.get("id", ""),
            ))
    return events


def _parse_tool_results(parsed: dict) -> list[LogEvent]:
    events: list[LogEvent] = []
    for block in parsed["message"].get("content", []):
        if block.get("type") != "tool_result":
            continue
        content = block.get("content", "")
        tur = parsed.get("tool_use_result", {})
        if isinstance(tur, dict):
            if tur.get("file", {}).get("content"):
                content = tur["file"]["content"]
            elif tur.get("stdout"):
                content = tur["stdout"]
                if tur.get("stderr"):
                    content += "\n" + tur["stderr"]
        if not isinstance(content, str):
            content = json.dumps(content, indent=2) if content else ""
        if len(content) > 2000:
            content = content[:2000] + "\n... (truncated)"
        if content:
            events.append(LogEvent(
                kind="tool_result",
                body=content,
                tool_id=block.get("tool_use_id", ""),
            ))
    return events


def _parse_result_summary(parsed: dict) -> LogEvent:
    parts = []
    if parsed.get("duration_ms"):
        parts.append(f"Duration: {parsed['duration_ms'] / 1000:.1f}s")
    if parsed.get("num_turns"):
        parts.append(f"Turns: {parsed['num_turns']}")
    if parsed.get("total_cost_usd"):
        parts.append(f"Cost: ${parsed['total_cost_usd']:.4f}")
    return LogEvent(kind="result", body="  \u00b7  ".join(parts))


_LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
_PRICING_CACHE_TTL = 86400  # 24 hours
_pricing_cache: dict | None = None
_pricing_cache_ts: float = 0


def _get_pricing() -> dict:
    """Fetch LiteLLM pricing data, cached for 24 hours."""
    global _pricing_cache, _pricing_cache_ts
    now = time.time()
    if _pricing_cache is not None and now - _pricing_cache_ts < _PRICING_CACHE_TTL:
        return _pricing_cache
    try:
        with urllib.request.urlopen(_LITELLM_URL, timeout=10) as r:
            _pricing_cache = json.loads(r.read())
            _pricing_cache_ts = now
    except Exception:
        log.warning("Failed to fetch LiteLLM pricing, using cached or empty")
        if _pricing_cache is None:
            _pricing_cache = {}
    return _pricing_cache or {}


def _lookup_pricing(model: str) -> dict | None:
    """Find pricing for a model string, handling provider prefixes and suffixes."""
    pricing = _get_pricing()
    clean = model.split("[")[0]
    if clean in pricing:
        return pricing[clean]
    for key in pricing:
        if clean.startswith(key) or key.startswith(clean):
            p = pricing[key]
            if "input_cost_per_token" in p:
                return p
    return None


def _calc_model_cost(tokens: dict, price: dict) -> float:
    return (
        tokens.get("input_tokens", 0) * price.get("input_cost_per_token", 0)
        + tokens.get("output_tokens", 0) * price.get("output_cost_per_token", 0)
        + tokens.get("cache_creation_tokens", 0) * price.get("cache_creation_input_token_cost", 0)
        + tokens.get("cache_read_tokens", 0) * price.get("cache_read_input_token_cost", 0)
    )


def _extract_from_result(data: dict) -> LogResult:
    """Extract authoritative cost data from a result line."""
    usage = data.get("usage", {})
    return LogResult(
        cost_usd=data.get("total_cost_usd"),
        cost_is_estimate=False,
        duration_ms=data.get("duration_ms"),
        num_turns=data.get("num_turns"),
        input_tokens=usage.get("input_tokens"),
        output_tokens=usage.get("output_tokens"),
        cache_read_tokens=usage.get("cache_read_input_tokens"),
        cache_creation_tokens=usage.get("cache_creation_input_tokens"),
    )


def _estimate_from_intermediates(lines: list[bytes]) -> LogResult | None:
    """Estimate cost by deduplicating per-message usage and applying LiteLLM pricing."""
    msg_data: dict[str, dict] = {}
    num_turns = 0
    for line in lines:
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if parsed.get("type") == "assistant" and "message" in parsed:
            msg = parsed["message"]
            mid = msg.get("id", "")
            model = msg.get("model", "")
            u = msg.get("usage", {})
            msg_data[mid] = {
                "model": model,
                "input_tokens": u.get("input_tokens", 0),
                "output_tokens": u.get("output_tokens", 0),
                "cache_creation_tokens": u.get("cache_creation_input_tokens", 0),
                "cache_read_tokens": u.get("cache_read_input_tokens", 0),
            }
        elif parsed.get("type") == "user":
            num_turns += 1

    if not msg_data:
        return None

    per_model: dict[str, dict] = {}
    for info in msg_data.values():
        model = info["model"]
        if model not in per_model:
            per_model[model] = {"input_tokens": 0, "output_tokens": 0, "cache_creation_tokens": 0, "cache_read_tokens": 0}
        for k in ("input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens"):
            per_model[model][k] += info[k]

    total_cost = 0.0
    total_input = 0
    total_output = 0
    total_cache_read = 0
    total_cache_creation = 0

    for model, tokens in per_model.items():
        price = _lookup_pricing(model)
        if price:
            total_cost += _calc_model_cost(tokens, price)
        total_input += tokens["input_tokens"]
        total_output += tokens["output_tokens"]
        total_cache_read += tokens["cache_read_tokens"]
        total_cache_creation += tokens["cache_creation_tokens"]

    return LogResult(
        cost_usd=total_cost if total_cost > 0 else None,
        cost_is_estimate=True,
        duration_ms=None,
        num_turns=num_turns if num_turns > 0 else None,
        input_tokens=total_input,
        output_tokens=total_output,
        cache_read_tokens=total_cache_read,
        cache_creation_tokens=total_cache_creation,
    )
