"""v0.28.027F: gems and crystals on the Magic Tower and Hall of Arcane figures in arcane pink (were blue / violet).

A gem is a small blue or violet patch (hue 190–300°, saturated) whose rim is mostly gold or light (its setting / glint).
Large patches (team-blue robes, the purple robe), eyes (rimmed by skin and white) and the base ring stay as they are.
Hue moves to arcane pink (318°), lightness and saturation stay. Works on stills and attack sheets (frame by frame).
Run from the repo root: python3 tools/arcane-gems.py assets/art/tower-magic-elite.webp ...   (--debug writes *-gems.png)
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

ARCANE_HUE = 318 / 360

def hsv(a):
    rgb = a[..., :3].astype(np.float32) / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    c = mx - mn
    h = np.zeros_like(mx)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = c > 1e-6
    hr = m & (mx == r)
    hg = m & (mx == g) & ~hr
    hb = m & ~hr & ~hg
    h[hr] = ((g - b)[hr] / c[hr]) % 6
    h[hg] = (b - r)[hg] / c[hg] + 2
    h[hb] = (r - g)[hb] / c[hb] + 4
    h = h / 6
    s = np.where(mx > 0, c / np.maximum(mx, 1e-6), 0)
    return h, s, mx

def to_rgb(h, s, v):
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    out = np.zeros(h.shape + (3,), np.float32)
    for k, (R, G, B) in enumerate([(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]):
        m = i == k
        out[m, 0], out[m, 1], out[m, 2] = R[m], G[m], B[m]
    return out

def gem_mask(a, scale=1.0):
    """Gems: small, compact, bright blue/violet patches set in metal. Crystals: compact, very bright violet patches."""
    h, s, v = hsv(a)
    alpha = a[..., 3] > 100
    deg = h * 360
    cand = alpha & (deg >= 190) & (deg <= 300) & (s > 0.32) & (v > 0.3)
    metal = alpha & (((deg >= 20) & (deg <= 62) & (s > 0.25) & (v > 0.3)) | ((s < 0.16) & (v > 0.5)) | ((s < 0.4) & (v >= 0.9)))  # gold, bronze or silver settings and their glint
    lab, n = ndimage.label(cand, structure=np.ones((3, 3)))
    mask = np.zeros(cand.shape, bool)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        y0, y1 = max(0, sl[0].start - 4), min(cand.shape[0], sl[0].stop + 4)
        x0, x1 = max(0, sl[1].start - 4), min(cand.shape[1], sl[1].stop + 4)
        comp = lab[y0:y1, x0:x1] == i
        area = comp.sum()
        if area < 6 * scale:
            continue
        hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        fill = area / (hh * ww)
        vv, ss, dd = v[y0:y1, x0:x1][comp], s[y0:y1, x0:x1][comp], deg[y0:y1, x0:x1][comp]
        ring = ndimage.binary_dilation(comp, iterations=3) & ~comp & alpha[y0:y1, x0:x1]
        gold = (metal[y0:y1, x0:x1] & ring).sum() / max(1, ring.sum())
        gem = area <= 320 * scale and fill >= 0.55 and vv.mean() >= 0.6 and vv.max() >= 0.9 and gold >= 0.25
        # the staff crystal (held on the left); the magic orb in the right hand stays
        crystal = (sl[1].start + sl[1].stop) / 2 < 0.45 * cand.shape[1] and 60 * scale <= area <= 1600 * scale and fill >= 0.38 and vv.mean() >= 0.6 and ss.mean() >= 0.5 and 270 <= dd.mean() <= 300
        if gem or crystal:
            mask[y0:y1, x0:x1] |= comp
    return mask

def process(path, out=None, debug=False, frame=None, scale=1.0):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    H, W = a.shape[:2]
    fw, fh = frame or (W, H)
    total = np.zeros((H, W), bool)
    cells = [(y, x) for y in range(0, H, fh) for x in range(0, W, fw)]
    masks = [gem_mask(a[y:y + fh, x:x + fw], scale) for y, x in cells]
    # attack sheets: a gem found in a neighbouring frame counts here too (no gem that blinks for one frame)
    if len(cells) > 1:
        hh, ss, vv = hsv(a)
        dd = hh * 360
        cand = (a[..., 3] > 100) & (dd >= 190) & (dd <= 300) & (ss > 0.32) & (vv > 0.3)
        fixed = []
        for i, (y, x) in enumerate(cells):
            near = np.zeros_like(masks[i])
            for j in (i - 1, i + 1):
                if 0 <= j < len(cells) and masks[j].shape == masks[i].shape:
                    near |= masks[j]
            c = cand[y:y + fh, x:x + fw]
            grow = ndimage.binary_dilation(near, iterations=4) & c[: near.shape[0], : near.shape[1]]
            # keep only candidate patches that overlap a neighbour's gem (not new cloth)
            lab, n = ndimage.label(grow, structure=np.ones((3, 3)))
            add = np.zeros_like(grow)
            for k, sl in enumerate(ndimage.find_objects(lab), 1):
                comp = lab[sl] == k
                if comp.sum() <= 1.6 * max(1, (near[sl] & comp).sum()) + 40:
                    add[sl] |= comp
            fixed.append(masks[i] | add)
        masks = fixed
    for (y, x), m in zip(cells, masks):
        total[y:y + m.shape[0], x:x + m.shape[1]] = m
    h, s, v = hsv(a)
    deg = h * 360
    # blend the edge: neighbours of a gem with blue/violet hue move too
    edge = ndimage.binary_dilation(total, iterations=1) & ~total & (deg >= 185) & (deg <= 305) & (s > 0.15)
    w = total * 1.0 + edge * 0.6
    nh = (h + (ARCANE_HUE - h) * w) % 1
    ns = np.clip(s * (1 + 0.05 * w), 0, 1)
    rgb = to_rgb(nh, ns, v)
    sel = w > 0
    a[..., :3][sel] = np.clip(rgb[sel] * 255 + 0.5, 0, 255).astype(np.uint8)
    res = Image.fromarray(a, "RGBA")
    dst = out or path
    if debug:
        dbg = np.asarray(im).copy()
        dbg[total] = [0, 255, 0, 255]
        Image.fromarray(dbg, "RGBA").save(dst.rsplit(".", 1)[0] + "-gems.png")
    if dst.endswith(".webp"):
        res.save(dst, "WEBP", lossless=True, method=6) if frame else res.save(dst, "WEBP", quality=95, method=6, alpha_quality=100)
    else:
        res.save(dst)
    return int(total.sum())

if __name__ == "__main__":
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    for f in args:
        print(f, process(f))
