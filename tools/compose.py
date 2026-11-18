#!/usr/bin/env python3
"""compose.py — a composition checker for a staged frame.

Reports what a still frame is actually made of, in regions: how much of the frame the
sky takes, where the dark mass sits, whether the hero subject is centred, and how the
colours are spread. It answers "is this a photograph of a city or a photograph of a wall?"

usage: python3 tools/compose.py <shot.jpg> [...]
"""

import sys

from PIL import Image

REGIONS = {
    "sky": (0.0, 0.0, 1.0, 0.30),
    "horizon band": (0.0, 0.28, 1.0, 0.42),
    "centre": (0.28, 0.24, 0.72, 0.78),
    "lower left": (0.0, 0.6, 0.34, 1.0),
    "lower centre": (0.34, 0.6, 0.72, 1.0),
    "lower right": (0.72, 0.6, 1.0, 1.0),
    "left third": (0.0, 0.0, 0.34, 1.0),
    "mid third": (0.34, 0.0, 0.66, 1.0),
    "right third": (0.66, 0.0, 1.0, 1.0),
}


def stats(img):
    g = img.convert("L")
    data = list(g.getdata())
    mean = sum(data) / len(data)
    var = sum((v - mean) ** 2 for v in data[::5]) / max(1, len(data[::5]))
    return mean, var ** 0.5


def hue_hist(img):
    hsv = img.convert("HSV")
    h = hsv.getchannel("H")
    s = hsv.getchannel("S")
    v = hsv.getchannel("V")
    buckets = [0] * 12
    hd = list(h.getdata())
    sd = list(s.getdata())
    vd = list(v.getdata())
    colored = 0
    for i in range(0, len(hd), 3):
        if sd[i] < 40 or vd[i] < 40:
            continue
        colored += 1
        buckets[min(11, hd[i] // 21)] += 1
    total = max(1, colored)
    names = ["red", "orange", "yellow", "yel-grn", "green", "grn-cyn", "cyan", "cyn-blu", "blue", "blu-vio", "violet", "magenta"]
    return [(names[i], round(buckets[i] / total * 100, 1)) for i in range(12) if buckets[i] / total > 0.02]


def check(path):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    print(f"compose: {path}  {w}x{h}")
    m, sd = stats(img)
    print(f"  whole frame: mean luma {m:.1f}, sd {sd:.1f}")
    for name, (x0, y0, x1, y1) in REGIONS.items():
        box = img.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
        rm, rsd = stats(box)
        # the share of the region that is very dark (mass) and very bright (light)
        g = list(box.convert("L").getdata())
        dark = sum(1 for v in g if v < 22) / len(g)
        bright = sum(1 for v in g if v > 170) / len(g)
        print(f"    {name:13s} luma {rm:5.1f}  sd {rsd:5.1f}  dark {dark*100:5.1f}%  bright {bright*100:5.1f}%")
    print(f"  hues: {hue_hist(img)}")
    # a coarse brightness map, 12x6 cells, so the layout can be read as numbers
    print("  luma map (12 x 6):")
    cw, ch = w // 12, h // 6
    for ry in range(6):
        row = []
        for rx in range(12):
            cell = img.crop((rx * cw, ry * ch, (rx + 1) * cw, (ry + 1) * ch)).convert("L")
            cd = list(cell.getdata())
            row.append(f"{sum(cd)/len(cd):4.0f}")
        print("    " + " ".join(row))


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    for p in argv[1:]:
        check(p)
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
