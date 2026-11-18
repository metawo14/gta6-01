#!/usr/bin/env python3
"""Dump a rectangular crop of a frame to a file, and report its brightness statistics.

Usage: python3 tools/inspect.py <file.jpg> <left> <top> <right> <bottom> [outprefix]
The box values are fractions of the frame (0..1).
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def main() -> int:
    if len(sys.argv) < 6:
        print(__doc__)
        return 2
    path = Path(sys.argv[1])
    left, top, right, bottom = (float(v) for v in sys.argv[2:6])
    prefix = sys.argv[6] if len(sys.argv) > 6 else None
    image = Image.open(path).convert("RGB")
    w, h = image.size
    box = (int(left * w), int(top * h), int(right * w), int(bottom * h))
    crop = image.crop(box)
    grey = crop.convert("L")
    px = list(grey.getdata())
    px.sort()
    n = max(1, len(px))
    print(f"{path.name} crop {box} ({crop.width}x{crop.height})")
    print(f"  mean {sum(px) // n}, min {px[0]}, max {px[-1]}, "
          f"p10 {px[n // 10]}, p50 {px[n // 2]}, p90 {px[n * 9 // 10]}")
    print(f"  distinct colours {len(set(crop.getdata()))}")
    if prefix:
        out = Path(f"{prefix}.png")
        crop.save(out)
        print(f"  wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
