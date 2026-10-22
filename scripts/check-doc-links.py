#!/usr/bin/env python3
"""Verify that internal links in the project's markdown files resolve.

Catches the two ways documentation rots silently: an anchor that points at a
heading someone renamed, and a relative link to a file someone moved. Both are
invisible until a reader clicks them, so CI clicks them instead.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FENCE = re.compile(r"^\s*(```|~~~)")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")


def slugify(heading: str) -> str:
    """Approximate GitHub's heading-to-anchor conversion."""
    text = re.sub(r"`([^`]*)`", r"\1", heading)
    text = re.sub(r"\*\*?([^*]*)\*\*?", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s]+", "-", text)
    return re.sub(r"-+", "-", text)


def headings_of(source: str) -> set[str]:
    anchors: set[str] = set()
    in_fence = False
    for line in source.splitlines():
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = HEADING.match(line)
        if match:
            anchors.add(slugify(match.group(2)))
    return anchors


def links_of(source: str) -> list[str]:
    found: list[str] = []
    in_fence = False
    for line in source.splitlines():
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        found.extend(LINK.findall(line))
    return found


def main() -> int:
    files = sorted(
        p
        for p in ROOT.rglob("*.md")
        if not any(part in {".git", "node_modules"} for part in p.parts)
    )
    if not files:
        print("No markdown files found — nothing to check.")
        return 0

    anchors = {p: headings_of(p.read_text(encoding="utf-8")) for p in files}
    problems: list[str] = []

    for path in files:
        rel = path.relative_to(ROOT)
        for link in links_of(path.read_text(encoding="utf-8")):
            if link.startswith(("http://", "https://", "mailto:")):
                continue

            target, _, fragment = link.partition("#")

            if target:
                resolved = (path.parent / target).resolve()
                if not resolved.exists():
                    problems.append(f"{rel}: link to missing file: {link}")
                    continue
            else:
                resolved = path

            if fragment and resolved.suffix == ".md":
                if fragment not in anchors.get(resolved, headings_of(resolved.read_text(encoding="utf-8"))):
                    problems.append(f"{rel}: anchor not found: {link}")

    for problem in problems:
        print(f"::error::{problem}" if "--github" in sys.argv else problem)

    checked = sum(len(links_of(p.read_text(encoding="utf-8"))) for p in files)
    print(f"Checked {checked} links across {len(files)} files.")

    if problems:
        print(f"{len(problems)} broken link(s).")
        return 1

    print("All internal links resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
