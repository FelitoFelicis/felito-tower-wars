"""v0.28.027F: the Storm element symbol in a greyish lavender, like the Storm element frame (#bcbcff / #d4c6ff / #7a6cff).
Violet and blue pixels (hue 200–330°) lose most of their saturation and move towards the frame's hue; the gold rim stays.
Run from the repo root: python3 tools/storm-grey.py assets/art/icon-el-storm.webp
"""
import sys
import numpy as np
from PIL import Image
import importlib.util
spec = importlib.util.spec_from_file_location("g", __file__.replace("storm-grey.py", "arcane-gems.py"))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

def process(path, out=None, sat=0.3, hue=246 / 360):
    a = np.asarray(Image.open(path).convert("RGBA")).copy()
    h, s, v = g.hsv(a)
    deg = h * 360
    w = np.clip(np.minimum(deg - 195, 335 - deg) / 10, 0, 1) * (a[..., 3] > 0)
    nh = h + (hue - h) * w
    ns = s * (1 - (1 - sat) * w)
    nv = v
    rgb = g.to_rgb(nh % 1, ns, np.clip(nv, 0, 1))
    sel = w > 0
    a[..., :3][sel] = np.clip(rgb[sel] * 255 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(a, "RGBA").save(out or path, "WEBP", quality=95, method=6, alpha_quality=100)

if __name__ == "__main__":
    for f in sys.argv[1:]:
        process(f)
