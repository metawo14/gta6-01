"""Inspect a screenshot without eyes: size, brightness, colour spread, and a coarse
ASCII luminance map so composition can be judged from the terminal."""
import sys
from PIL import Image

path = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 64
im = Image.open(path).convert('RGB')
w, h = im.size
px = im.load()
print(f"{path}  {w}x{h}  {im.format}")
small = im.resize((cols, max(1, int(cols * h / w / 2.1))), Image.LANCZOS)
sw, sh = small.size
sp = small.load()
ramp = " .:-=+*#%@"
lum_total = 0
uniq = set()
for y in range(sh):
    row = []
    for x in range(sw):
        r, g, b = sp[x, y]
        uniq.add((r // 24, g // 24, b // 24))
        l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        lum_total += l
        row.append(ramp[min(9, int(l * 10))])
    print("".join(row))
avg = lum_total / (sw * sh)
print(f"avg luminance {avg:.3f}   distinct coarse colours {len(uniq)}")
# Per-third brightness so I can tell a dark sky from a lit street.
for name, box in [("top", (0, 0, w, h // 3)), ("mid", (0, h // 3, w, 2 * h // 3)), ("bottom", (0, 2 * h // 3, w, h))]:
    crop = im.crop(box).resize((24, 8))
    cp = crop.load()
    tot = 0
    for y in range(8):
        for x in range(24):
            r, g, b = cp[x, y]
            tot += (0.299 * r + 0.587 * g + 0.114 * b) / 255
    print(f"  {name:7s} luminance {tot / 192:.3f}")
