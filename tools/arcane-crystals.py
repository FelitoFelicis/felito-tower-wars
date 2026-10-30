"""v0.28.021F: the Arcane Golem's crystals in arcane violet (were near white).

Bright, nearly colourless, cool pixels (the crystals and the gem on the tabard) are tinted towards arcane violet
(hue 288°), keeping their lightness; stone (warmer, darker grey), the glowing eyes and the team-blue cloth stay.
Run from the repo root: python3 tools/arcane-crystals.py assets/art/creep-n-arcane-golem.webp ...
"""
import sys, colorsys
from PIL import Image

def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)

def process(path, out=None, lossless=False):
    im = Image.open(path).convert("RGBA")
    px = im.load()
    n = 0
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 20:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            l = mx / 255
            s = (mx - mn) / mx if mx else 0
            w = smooth(0.74, 0.86, l) * (1 - smooth(0.2, 0.32, s)) * smooth(-14, 2, b - r)
            if w <= 0.01:
                continue
            tr, tg, tb = colorsys.hsv_to_rgb(288 / 360, 0.32 + 0.22 * (1 - l), l)
            px[x, y] = (round(r + (tr * 255 - r) * w), round(g + (tg * 255 - g) * w), round(b + (tb * 255 - b) * w), a)
            n += 1
    dst = out or path
    if dst.endswith(".webp"):
        im.save(dst, "WEBP", quality=95, method=6, alpha_quality=100)
    else:
        im.save(dst)
    return n

if __name__ == "__main__":
    for f in sys.argv[1:]:
        print(f, process(f))
