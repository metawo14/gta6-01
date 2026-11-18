#!/usr/bin/env python3
"""verify.py — check a staged screenshot for the things a good frame must show.

Six checks, each PASS/FAIL, and a non-zero exit when any fails:

  1. the objective card (top centre) has neon pixels
  2. the minimap region (bottom right) is not black
  3. the top-left health/cash/stars region has neon or brightness
  4. the sky strip is brighter than a dark fill
  5. the lower half has real contrast, not a flat fill
  6. a downscaled copy has thousands of distinct colours

usage: python3 tools/verify.py <shot.jpg> [...]
"""

import sys

try:
    from PIL import Image
except ImportError:
    print("verify: Pillow is required (pip install pillow)")
    sys.exit(2)

SAT_MIN = 0.055
BRIGHT_MIN = 46
SKY_MIN = 26
CONTRAST_MIN = 17
COLOURS_MIN = 2500


def neon_pixels(img):
    """Pixels that read as neon: saturated and reasonably bright."""
    small = img.convert("RGB")
    w, h = small.size
    n = 0
    for r, g, b in small.getdata():
        mx = max(r, g, b)
        mn = min(r, g, b)
        if mx < 70:
            continue
        sat = (mx - mn) / mx if mx else 0.0
        if sat >= SAT_MIN and mx >= 96:
            n += 1
    return n, w * h


def region(img, fx0, fy0, fx1, fy1):
    w, h = img.size
    return img.crop((int(fx0 * w), int(fy0 * h), int(fx1 * w), int(fy1 * h)))


def mean_luma(img):
    g = img.convert("L")
    data = list(g.getdata())
    return sum(data) / max(1, len(data))


def dominant_share(img, step=3):
    """Share of pixels equal to the single most common colour."""
    px = list(img.convert("RGB").resize((img.width // step, img.height // step)).getdata())
    counts = {}
    for p in px:
        q = (p[0] // 8, p[1] // 8, p[2] // 8)
        counts[q] = counts.get(q, 0) + 1
    top = max(counts.values()) if counts else len(px)
    return top / max(1, len(px))


def check_objective(img):
    card = region(img, 0.31, 0.015, 0.69, 0.115)
    n, total = neon_pixels(card)
    ok = n >= 260
    return ok, f"neon pixels in the objective card: {n} of {total}", n


def check_minimap(img):
    mm = region(img, 0.80, 0.66, 0.99, 0.985)
    lum = mean_luma(mm)
    # a black hole means the 2D canvas never drew
    dark = sum(1 for v in mm.convert("L").getdata() if v < 8) / max(1, mm.width * mm.height)
    ok = lum >= 11 and dark < 0.9
    return ok, f"minimap mean luma {lum:.1f}, {dark * 100:.1f}% near-black", lum


def check_topleft(img):
    box = region(img, 0.015, 0.025, 0.30, 0.145)
    n, total = neon_pixels(box)
    lum = mean_luma(box)
    ok = n >= 200 or lum >= 30
    return ok, f"top-left neon {n}, luma {lum:.1f}", max(n, lum)


def check_sky(img):
    sky = region(img, 0.05, 0.13, 0.95, 0.24)
    lum = mean_luma(sky)
    ok = lum >= SKY_MIN
    return ok, f"sky strip luma {lum:.1f} (dark fill would be under 20)", lum


def check_contrast(img):
    low = region(img, 0.0, 0.5, 1.0, 1.0)
    g = low.convert("L")
    data = list(g.getdata())
    mean = sum(data) / max(1, len(data))
    var = sum((v - mean) ** 2 for v in data[::7]) / max(1, len(data[::7]))
    sd = var ** 0.5
    share = dominant_share(low, 4)
    ok = sd >= CONTRAST_MIN and share < 0.62
    return ok, f"lower-half sd {sd:.1f}, dominant colour share {share * 100:.1f}%", sd


def check_colours(img):
    small = img.convert("RGB").resize((160, 100), Image.LANCZOS)
    seen = set(small.getdata())
    n = len(seen)
    ok = n >= COLOURS_MIN
    return ok, f"distinct colours in a 160x100 copy: {n}", n


CHECKS = [
    ("objective card neon", check_objective),
    ("minimap drawn", check_minimap),
    ("health/cash/stars region", check_topleft),
    ("sky strip bright", check_sky),
    ("lower half contrast", check_contrast),
    ("colour richness", check_colours),
]


def verify(path):
    try:
        img = Image.open(path)
        img.load()
    except Exception as exc:  # noqa: BLE001
        print(f"verify: {path}: cannot open ({exc})")
        return False
    img = img.convert("RGB")
    print(f"verify: {path}  {img.width}x{img.height}")
    all_ok = True
    for name, fn in CHECKS:
        try:
            ok, detail, _ = fn(img)
        except Exception as exc:  # noqa: BLE001
            ok, detail = False, f"check failed: {exc}"
        all_ok = all_ok and ok
        print(f"  {'PASS' if ok else 'FAIL'}  {name:26s} {detail}")
    print(f"  {path}: {'PASS' if all_ok else 'FAIL'}")
    return all_ok


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    ok = True
    for p in argv[1:]:
        ok = verify(p) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
