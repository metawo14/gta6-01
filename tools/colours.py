#!/usr/bin/env python3
"""Sample colours from a frame: region means, brightest pixels, and a coarse brightness map.

Usage: python3 tools/colours.py <file.jpg>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = Path(sys.argv[1])
    image = Image.open(path).convert("RGB")
    w, h = image.size
    print(f"{path.name} — {w}x{h}")

    # A 8x6 grid of mean colour and luma, so a dark frame is obvious at a glance.
    cols, rows = 8, 6
    for ry in range(rows):
        line = []
        for rx in range(cols):
            box = (rx * w // cols, ry * h // rows, (rx + 1) * w // cols, (ry + 1) * h // rows)
            crop = image.crop(box)
            px = list(crop.getdata())
            n = max(1, len(px))
            r = sum(p[0] for p in px) // n
            g = sum(p[1] for p in px) // n
            b = sum(p[2] for p in px) // n
            luma = (r * 299 + g * 587 + b * 114) // 1000
            line.append(f"{luma:3d} #{r:02x}{g:02x}{b:02x}")
        print("  " + " | ".join(line))

    grey = image.convert("L")
    px = sorted(grey.getdata())
    n = len(px)
    print("  luma: " + ", ".join(
        f"p{q}={px[min(n - 1, int(n * q / 100))]}" for q in (1, 5, 25, 50, 75, 95, 99)
    ))

    # The minimap corner.
    mapbox = (int(w * 0.80), int(h * 0.68), w, h)
    crop = image.crop(mapbox)
    cpx = list(crop.convert("L").getdata())
    print(f"  minimap mean luma {sum(cpx) // max(1, len(cpx))}, max {max(cpx) if cpx else 0}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
