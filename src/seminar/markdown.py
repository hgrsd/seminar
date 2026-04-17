"""Small Markdown transforms used by export and presentation code."""

from __future__ import annotations

import re

_ATX_HEADING_RE = re.compile(r"^(#{1,6})([ \t]+.*)$")
_FENCE_RE = re.compile(r"^([ \t]{0,3})(`{3,}|~{3,})(.*)$")


def shift_headings(markdown: str, levels: int = 1) -> str:
    """Shift ATX headings deeper by `levels`, skipping fenced and indented code blocks."""
    if levels <= 0 or not markdown:
        return markdown

    lines = markdown.splitlines()
    shifted: list[str] = []
    in_fence = False
    active_fence_char: str | None = None
    active_fence_len = 0

    for line in lines:
        fence_match = _FENCE_RE.match(line)
        if fence_match:
            fence_marker = fence_match.group(2)
            fence_char = fence_marker[0]
            fence_len = len(fence_marker)
            if not in_fence:
                in_fence = True
                active_fence_char = fence_char
                active_fence_len = fence_len
            elif fence_char == active_fence_char and fence_len >= active_fence_len:
                in_fence = False
                active_fence_char = None
                active_fence_len = 0
            shifted.append(line)
            continue

        if in_fence or line.startswith("    ") or line.startswith("\t"):
            shifted.append(line)
            continue

        heading_match = _ATX_HEADING_RE.match(line)
        if heading_match:
            depth = min(6, len(heading_match.group(1)) + levels)
            shifted.append(f"{'#' * depth}{heading_match.group(2)}")
            continue

        shifted.append(line)

    trailing_newline = "\n" if markdown.endswith("\n") else ""
    return "\n".join(shifted) + trailing_newline
