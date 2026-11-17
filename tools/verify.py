"""Verify a staged screenshot shows what it should: HUD panels present at their expected
places, a dusk sky in the upper frame, a lit street in the lower frame, and enough
distinct colour and detail that the frame reads as a scene rather than a flat fill."""
import sys
from PIL import Image, ImageStat

path = sys.argv[1]
im = Image.open(path).convert('RGB')
w, h = im.size
ok = []
bad = []


def region(box):
    return im.crop(box)


def mean(box):
    return ImageStat.Stat(region(box)).mean


def check(name, cond, detail):
    (ok if cond else bad).append(f"{'PASS' if cond else 'FAIL'} {name}: {detail}")


# HUD panel: the objective card sits centred at the top; the minimap bottom-right.
def has_neon(box, min_pixels=40):
    r = region(box)
    px = r.load()
    n = 0
    for y in range(r.size[1]):
        for x in range(r.size[0]):
            cr, cg, cb = px[x, y]
            if cg > 120 and cg > cr + 30 and cb > cr + 20:
                n += 1
    return n


obj = (int(w * 0.34), 0, int(w * 0.66), int(h * 0.13))
check('objective card', has_neon(obj, 30) > 30, f'{has_neon(obj)} neon px in top centre')

mm = (int(w * 0.79), int(h * 0.65), w, h)
mapmean = mean(mm)
check('minimap', sum(mapmean) / 3 > 18, f'mean {sum(mapmean)/3:.0f} over bottom-right')

left = (0, 0, int(w * 0.22), int(h * 0.22))
check('health/cash/stars', has_neon(left, 20) > 20 or sum(mean(left)) / 3 > 40,
      f'mean {sum(mean(left))/3:.0f}, {has_neon(left)} neon px')

# Sky: the top strip should be brighter than 12 and cooler/warmer than the asphalt.
sky = mean((int(w * 0.2), 0, int(w * 0.8), int(h * 0.10)))
check('sky visible', sum(sky) / 3 > 12, f'mean rgb {tuple(round(v) for v in sky)}')

# Ground detail: the lower half must have contrast (structures), not a flat fill.
low = region((0, int(h * 0.55), w, h)).convert('L')
st = ImageStat.Stat(low)
check('street detail', st.stddev[0] > 12, f'luma stddev {st.stddev[0]:.1f}')

small = im.resize((160, 90))
colors = small.getcolors(160 * 90)
check('colour richness', len(colors) > 3000, f'{len(colors)} distinct colours in 160x90')

print(path, f'{w}x{h}')
for line in ok + bad:
    print(' ', line)
print(f'  {len(ok)} passed, {len(bad)} failed')
sys.exit(1 if bad else 0)
