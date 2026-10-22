#!/usr/bin/env python3
"""Generate the app icons from the logo, so they stay regenerable.

The logo (docs/logga.jpg) is a finch on an open ledger with the word
"bokfink" underneath. The word cannot be read at icon size, so the icons use
the picture alone: the finch and the book, cropped out above the word and
centred on a square of the logo's own paper colour.

Two framings, because the platforms ask for different things:

- "any" icons and the favicon fill most of the square;
- the maskable icon and the apple-touch-icon keep the picture inside the
  inner 80 % circle, which is all a launcher that crops to a circle or a
  squircle promises to show.

Needs Pillow, which is a tool here and never part of the build:

    pip install pillow
    python3 scripts/generate-icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "docs" / "logga.jpg"
PUBLIC = ROOT / "public"

# The logo's paper, sampled from its corners.
PAPER = (247, 246, 242)

# The finch and the book, in logo pixels. Everything below row 288 is the
# word, separated from the picture by an empty band.
PICTURE = (22, 0, 379, 288)


def picture() -> Image.Image:
    return Image.open(LOGO).convert("RGB").crop(PICTURE)


def icon(size: int, fill: float) -> Image.Image:
    """The picture scaled so its longer side is `fill` of the square."""
    bild = picture()
    scale = size * fill / max(bild.size)
    bild = bild.resize(
        (round(bild.width * scale), round(bild.height * scale)), Image.LANCZOS
    )
    canvas = Image.new("RGB", (size, size), PAPER)
    canvas.paste(platta(bild), ((size - bild.width) // 2, (size - bild.height) // 2))
    return canvas


def platta(bild: Image.Image) -> Image.Image:
    """
    Sets every near-paper pixel to the paper colour exactly.

    The logo's paper is not one flat colour - a compressed page never is - so
    pasting it onto a flat square shows the crop as a faint rectangle. Evening
    out only what is already within a few steps of the paper hides the seam
    without fading any of the finch or the book.
    """
    ut = bild.copy()
    pixlar = ut.load()
    for y in range(ut.height):
        for x in range(ut.width):
            nara = (abs(kanal - papper) <= 10 for kanal, papper in zip(pixlar[x, y], PAPER))
            if all(nara):
                pixlar[x, y] = PAPER
    return ut


def main() -> None:
    (PUBLIC / "icons").mkdir(parents=True, exist_ok=True)
    icon(192, 0.9).save(PUBLIC / "icons/icon-192.png", optimize=True)
    icon(512, 0.9).save(PUBLIC / "icons/icon-512.png", optimize=True)
    # The diagonal of a 0.56 square is just under 0.8: the whole picture
    # survives any mask the launcher applies.
    icon(512, 0.56).save(PUBLIC / "icons/icon-maskable-512.png", optimize=True)
    # iOS rounds the corners itself, so the picture needs some room too.
    icon(180, 0.75).save(PUBLIC / "apple-touch-icon.png", optimize=True)
    icon(64, 0.95).save(PUBLIC / "favicon.png", optimize=True)


if __name__ == "__main__":
    main()
