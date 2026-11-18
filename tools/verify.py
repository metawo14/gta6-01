#!/usr/bin/env python3
"""Check a staged Port Meridian screenshot.

Six checks, each printed PASS or FAIL, exit non-zero on any failure:
  1. the objective card has neon pixels in the top centre
  2. the minimap region is not black
  3. the top-left health/cash/stars region has neon or brightness
  4. the sky strip is brighter than a dark fill
  5. the lower half has real contrast (not a flat fill)
  6. a downscaled copy has thousands of distinct colours

Usage: python3 tools/verify.py <file.jpg> [file2.jpg ...]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

NEON_HUE_MIN = 140.0   # teal-to-cyan band, degrees
NEON_HUE_MAX = 200.0
NEON_SAT_MIN = 0.28
NEON_VAL_MIN = 0.35


def load(path: Path) -> Image.Image:
    image = Image.open(path)
    return image.convert("RGB")


def hsv(pixel: tuple[int, int, int]) -> tuple[float, float, float]:
    r, g, b = (v / 255.0 for v in pixel)
    high = max(r, g, b)
    low = min(r, g, b)
    delta = high - low
    if delta == 0:
        hue = 0.0
    elif high == r:
        hue = (60 * ((g - b) / delta)) % 360
    elif high == g:
        hue = 60 * ((b - r) / delta) + 120
    else:
        hue = 60 * ((r - g) / delta) + 240
    sat = 0.0 if high == 0 else delta / high
    return hue, sat, high


def region(image: Image.Image, box: tuple[float, float, float, float]) -> Image.Image:
    w, h = image.size
    left, top, right, bottom = box
    return image.crop((int(left * w), int(top * h), int(right * w), int(bottom * h)))


def mean_luma(image: Image.Image) -> float:
    grey = image.convert("L")
    px = list(grey.getdata())
    return sum(px) / max(1, len(px))


def neon_fraction(image: Image.Image) -> float:
    small = image.resize((max(1, image.width // 2), max(1, image.height // 2)))
    total = small.width * small.height
    hits = 0
    for pixel in small.getdata():
        hue, sat, val = hsv(pixel)
        if NEON_HUE_MIN <= hue <= NEON_HUE_MAX and sat >= NEON_SAT_MIN and val >= NEON_VAL_MIN:
            hits += 1
    return hits / max(1, total)


def bright_fraction(image: Image.Image, threshold: int = 60) -> float:
    grey = image.convert("L")
    px = list(grey.getdata())
    return sum(1 for p in px if p >= threshold) / max(1, len(px))


def contrast(image: Image.Image) -> float:
    """Standard deviation of luminance: 0 is a flat fill."""
    grey = image.convert("L")
    px = list(grey.getdata())
    n = max(1, len(px))
    mean = sum(px) / n
    var = sum((p - mean) ** 2 for p in px) / n
    return var ** 0.5


def distinct_colours(image: Image.Image) -> int:
    small = image.resize((160, 100), Image.Resampling.NEAREST)
    # Count distinct RGB tuples directly; PIL's quantize rejects large colour counts on
    # some builds, and a set is exact anyway.
    return len(set(small.getdata()))


CHECKS = []


def check(name):
    def wrap(fn):
        CHECKS.append((name, fn))
        return fn

    return wrap


@check("objective card has neon pixels in the top centre")
def objective_neon(image: Image.Image) -> tuple[bool, str]:
    card = region(image, (0.30, 0.0, 0.70, 0.17))
    frac = neon_fraction(card)
    return frac >= 0.004, f"teal pixel share {frac * 100:.2f}%"


@check("minimap region is not black")
def minimap_lit(image: Image.Image) -> tuple[bool, str]:
    # The live minimap is a 230 px circle pinned 18 px from the bottom-right corner, so this
    # box tracks the map itself rather than the dark city around it.
    map_region = region(image, (0.795, 0.675, 0.995, 0.995))
    luma = mean_luma(map_region)
    bright = bright_fraction(map_region, 45)
    return luma >= 16 and bright >= 0.10, f"mean luma {luma:.1f}, bright share {bright * 100:.1f}%"


@check("top-left health/cash/stars region has neon or brightness")
def top_left_hud(image: Image.Image) -> tuple[bool, str]:
    hud = region(image, (0.0, 0.0, 0.30, 0.30))
    bright = bright_fraction(hud, 110)
    luma = mean_luma(hud)
    return bright >= 0.01 or luma >= 34, f"bright share {bright * 100:.2f}%, mean luma {luma:.1f}"


@check("sky strip is brighter than a dark fill")
def sky_strip(image: Image.Image) -> tuple[bool, str]:
    sky = region(image, (0.0, 0.0, 1.0, 0.05))
    luma = mean_luma(sky)
    return luma >= 22, f"mean sky luma {luma:.1f}"


@check("lower half has real contrast")
def lower_contrast(image: Image.Image) -> tuple[bool, str]:
    lower = region(image, (0.0, 0.5, 1.0, 1.0))
    sd = contrast(lower)
    return sd >= 22, f"luminance sd {sd:.1f}"


@check("downscaled copy has thousands of distinct colours")
def colour_richness(image: Image.Image) -> tuple[bool, str]:
    count = distinct_colours(image)
    return count >= 1500, f"{count} distinct colours"


def verify(path: Path) -> bool:
    if not path.is_file():
        print(f"FAIL {path.name}: no such file")
        return False
    image = load(path)
    ok_all = True
    print(f"{path.name} — {image.width}x{image.height}, {path.stat().st_size} bytes")
    for name, fn in CHECKS:
        try:
            ok, detail = fn(image)
        except Exception as exc:  # a broken frame must fail, not crash
            ok, detail = False, f"error: {exc}"
        print(f"  {'PASS' if ok else 'FAIL'} — {name} ({detail})")
        ok_all = ok_all and ok
    return ok_all


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    results = [verify(Path(a)) for a in args]
    if len(results) > 1:
        print(f"{sum(results)}/{len(results)} files pass all checks")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
