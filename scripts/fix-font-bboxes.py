# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools==4.60.1", "brotli==1.1.0"]
# ///
"""Recompute glyph bounding boxes in the Rajdhani woff2 files the site serves.

Fontsource's Rajdhani 600 and 700 files carry glyph bounding boxes that disagree with the glyph outlines. Firefox's
font sanitiser corrects them at load and logs a warning per glyph (about 100 on the home page). This recomputes the
glyph boxes (and the font-wide box in head) from the outlines, changing nothing else. Firefox renders identically;
Chromium's text-shadow blur shifts by a few sub-perceptual pixel values around the glyphs whose boxes were too narrow.

    uv run scripts/fix-font-bboxes.py

Rajdhani is under the SIL Open Font License 1.1 with no Reserved Font Name, so a corrected copy may keep its name.
"""

from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "node_modules/@fontsource/rajdhani/files"
TARGET = ROOT / "src/styles/fonts"
FILES = ["rajdhani-latin-600-normal.woff2", "rajdhani-latin-700-normal.woff2"]


def fix(name: str) -> None:
    font = TTFont(SOURCE / name, recalcBBoxes=True)
    glyf = font["glyf"]
    corrected = 0
    for glyph_name in font.getGlyphOrder():
        glyph = glyf[glyph_name]
        if glyph.numberOfContours == 0:
            continue
        before = (glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax)
        glyph.recalcBounds(glyf)
        if (glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax) != before:
            corrected += 1
    font.flavor = "woff2"
    font.save(TARGET / name)
    print(f"{name}: {corrected} glyph bounding boxes corrected")


TARGET.mkdir(parents=True, exist_ok=True)
for file in FILES:
    fix(file)
(TARGET / "OFL.txt").write_text(
    "Rajdhani 600 and 700 (latin subset) from @fontsource/rajdhani, with glyph bounding boxes recomputed from the\n"
    "outlines by scripts/fix-font-bboxes.py. No other changes.\n\n"
    + (ROOT / "node_modules/@fontsource/rajdhani/LICENSE").read_text()
)
