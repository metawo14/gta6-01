"""Region colour report: mean RGB per grid cell, printed as hex, so the palette and
lighting of a frame can be checked numerically."""
import sys
from PIL import Image

path = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 8
rows = int(sys.argv[3]) if len(sys.argv) > 3 else 6
im = Image.open(path).convert('RGB')
w, h = im.size
print(f"{path} {w}x{h}")
for r in range(rows):
    line = []
    for c in range(cols):
        box = (c * w // cols, r * h // rows, (c + 1) * w // cols, (r + 1) * h // rows)
        crop = im.crop(box).resize((1, 1), Image.LANCZOS)
        px = crop.load()[0, 0]
        line.append("#%02x%02x%02x" % px)
    print("  ".join(line))
# dominant hues
sat = []
small = im.resize((80, 45))
sp = small.load()
for y in range(45):
    for x in range(80):
        r, g, b = sp[x, y]
        mx, mn = max(r, g, b), min(r, g, b)
        if mx > 40:
            sat.append((mx - mn) / mx)
print(f"mean saturation {sum(sat) / max(1, len(sat)):.3f} over {len(sat)} px")
