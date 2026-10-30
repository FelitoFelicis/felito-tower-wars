"""v0.28.020F: silver level metal (LIM) reads as metal, not white.

Bright, nearly colourless parts of a silver-level tower picture (trims, buckles, armour, blades) get a metal curve:
mid-tones darker, highlights kept, a faint cool tint. Small specks (eye whites, teeth, sparkles) stay as they are:
only patches of at least MIN_AREA pixels count. Run from the repo root on the files to change (art and attack sheets):
    python3 tools/silver-metal.py assets/art/tower-archer.webp assets/anim/tower-bash-v1.webp ...
"""
import sys
from collections import deque
from PIL import Image

MIN_AREA = 40

def curve(l):
    return l if l <= 0.55 else 0.55 + 0.45 * ((l - 0.55) / 0.45) ** 2.2

def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)

def process(path, out=None):
    im = Image.open(path).convert("RGBA")
    W, H = im.size
    px = im.load()
    weight = {}
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            l = mx / 255
            s = (mx - mn) / mx if mx else 0
            w = smooth(0.55, 0.75, l) * (1 - smooth(0.10, 0.20, s))
            if w > 0.02:
                weight[(x, y)] = w
    # patches: drop small ones (eye whites, teeth, sparkles)
    seen = set()
    keep = set()
    for p in weight:
        if p in seen:
            continue
        q = deque([p])
        seen.add(p)
        comp = [p]
        while q:
            x, y = q.popleft()
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in weight and n not in seen:
                    seen.add(n)
                    q.append(n)
                    comp.append(n)
        if len(comp) >= MIN_AREA:
            keep.update(comp)
    for p in keep:
        r, g, b, a = px[p]
        w = weight[p]
        l = max(r, g, b) / 255
        f = curve(l) / l if l else 1
        tint = (0.97, 0.99, 1.04)
        nr, ng, nb = (round(c * (1 + w * (f * t - 1))) for c, t in zip((r, g, b), tint))
        px[p] = (max(0, min(255, nr)), max(0, min(255, ng)), max(0, min(255, nb)), a)
    im.save(out or path, "WEBP", lossless=True) if (out or path).endswith(".webp") else im.save(out or path)
    return len(keep)

if __name__ == "__main__":
    for f in sys.argv[1:]:
        print(f, process(f))
