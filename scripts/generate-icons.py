#!/usr/bin/env python3
"""Generate the app icons from code, so they stay regenerable and reviewable.

The mark is an equals sign: two bars of identical length. Debit equals credit
is the one invariant the whole application is built around, and it survives
being shrunk to a 32-pixel favicon.

Run after changing BRAND or the geometry:

    python3 scripts/generate-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"

INK = (14, 59, 50)  # deep ledger green
PAPER = (245, 241, 232)  # warm off-white


def rounded_rect_distance(
    px: float, py: float, half_w: float, half_h: float, radius: float
) -> float:
    """Signed distance from (px, py) to a rounded rectangle centred on origin."""
    dx = abs(px) - (half_w - radius)
    dy = abs(py) - (half_h - radius)
    outside = (max(dx, 0.0) ** 2 + max(dy, 0.0) ** 2) ** 0.5
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def coverage(distance: float) -> float:
    """Antialias by treating the distance as pixel coverage across one pixel."""
    return min(max(0.5 - distance, 0.0), 1.0)


def render(size: int, *, full_bleed: bool) -> bytes:
    half = size / 2
    corner = 0.0 if full_bleed else size * 0.22

    bar_half_w = size * 0.26
    bar_half_h = size * 0.052
    bar_radius = bar_half_h
    bar_offset = size * 0.115

    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter type 0 (none)
        py = y + 0.5 - half
        for x in range(size):
            px = x + 0.5 - half

            background = coverage(
                rounded_rect_distance(px, py, half, half, corner)
            )
            bars = max(
                coverage(
                    rounded_rect_distance(
                        px, py - bar_offset, bar_half_w, bar_half_h, bar_radius
                    )
                ),
                coverage(
                    rounded_rect_distance(
                        px, py + bar_offset, bar_half_w, bar_half_h, bar_radius
                    )
                ),
            )

            # Bars are clipped to the background so they never bleed past a corner.
            mark = bars * background
            rows.extend(
                round(INK[channel] * (1 - mark) + PAPER[channel] * mark)
                for channel in range(3)
            )
            rows.append(round(background * 255))

    return bytes(rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"{path.relative_to(PUBLIC.parent)}  {size}x{size}  {len(png):,} bytes")


def main() -> None:
    # purpose "any": rounded, so it looks right where the platform does not mask.
    write_png(PUBLIC / "icons/icon-192.png", 192, render(192, full_bleed=False))
    write_png(PUBLIC / "icons/icon-512.png", 512, render(512, full_bleed=False))

    # purpose "maskable" and iOS: full bleed, because the platform applies its
    # own mask and would otherwise cut the corners twice.
    write_png(
        PUBLIC / "icons/icon-maskable-512.png", 512, render(512, full_bleed=True)
    )
    write_png(PUBLIC / "apple-touch-icon.png", 180, render(180, full_bleed=True))


if __name__ == "__main__":
    main()
