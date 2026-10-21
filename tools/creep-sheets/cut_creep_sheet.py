"""Cut a creep sheet into clean game assets (layout-independent).

usage: cut3.py SRC NAME OUTDIR [--mist] [--mist-death] [--debug]

The sheet holds: an optional portrait, 8 walk rows x 6 frames (front, front-right, right,
back-right, back, back-left, left, front-left) and an optional death row of 6 frames, above or
below the walk rows. Labels, pills and separator lines are erased; every frame is cut from the
white background with an un-blended (halo-free) edge.

Writes OUTDIR/anim/NAME.webp (walk), OUTDIR/anim/NAME-death.webp, OUTDIR/art/NAME.webp (still),
OUTDIR/art/<portrait key>.webp and OUTDIR/NAME.json.
"""
import sys, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, name, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
MIST = "--mist" in sys.argv
MIST_DEATH = MIST or "--mist-death" in sys.argv
PALE = "--pale" in sys.argv
DEBUG = "--debug" in sys.argv
raw = np.array(Image.open(src).convert("RGB")).astype(np.float32)
H, W, _ = raw.shape
border = np.concatenate([raw[0], raw[-1], raw[:, 0], raw[:, -1]])
BG = np.median(border, 0)
img = raw.copy()
sat = raw.max(2) - raw.min(2)
dbg = np.abs(raw - BG).max(2)
log = lambda *a: print(name, *a)

# ---------- 1. erase pills, label text and separator lines ----------
def ring_bgshare(y0, y1, x0, x1, pad=3):
    Y0, Y1, X0, X1 = max(0, y0 - pad), min(H, y1 + pad), max(0, x0 - pad), min(W, x1 + pad)
    sub = dbg[Y0:Y1, X0:X1].copy()
    inner = np.zeros(sub.shape, bool)
    inner[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = True
    ring = sub[~inner]
    return (ring < 22).mean() if ring.size else 1.0

erase = np.zeros((H, W), bool)
pill_mask = np.zeros((H, W), bool)
# pills: uniform, mostly filled rounded rectangles (coloured or grey)
nonbg = dbg > 6
lab, n = ndi.label(nonbg)
pills = 0
for k, sl in enumerate(ndi.find_objects(lab)):
    h_, w_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
    if not (16 <= h_ <= 52 and 55 <= w_ <= 210 and w_ > 2.2 * h_):
        continue
    m = lab[sl] == k + 1
    fill = m.mean()
    px = raw[sl][m]
    light = px.min(1) > 150
    if fill < 0.7 or light.mean() < 0.55:
        continue
    lp = px[light]
    if lp.std(0).max() > 22:
        continue
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    pill_mask[max(0, y0 - 3):y1 + 3, max(0, x0 - 3):x1 + 3] = True
    pills += 1
# glyphs: small dark unsaturated components standing in the background, chained into words
dark = (raw.max(2) < 150) & (sat < 40)
gl, gn = ndi.label(dark)
cand = []
for k, sl in enumerate(ndi.find_objects(gl)):
    h_, w_ = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
    if not (6 <= h_ <= 30 and 2 <= w_ <= 26):
        continue
    if erase[sl].all():
        continue
    if ring_bgshare(sl[0].start, sl[0].stop, sl[1].start, sl[1].stop, 3) < 0.35:
        continue
    cand.append([sl[0].start, sl[0].stop, sl[1].start, sl[1].stop])
cand.sort(key=lambda b: (b[0] + b[1]) / 2)
words = []
used = [False] * len(cand)
for i, b in enumerate(cand):
    if used[i]:
        continue
    group = [i]
    used[i] = True
    changed = True
    while changed:
        changed = False
        for j, c in enumerate(cand):
            if used[j]:
                continue
            for g in group:
                a = cand[g]
                cy_a, cy_c = (a[0] + a[1]) / 2, (c[0] + c[1]) / 2
                gap = max(c[2] - a[3], a[2] - c[3])
                if abs(cy_a - cy_c) <= max(4, 0.35 * (a[1] - a[0])) and gap <= 12:
                    group.append(j)
                    used[j] = True
                    changed = True
                    break
    if len(group) >= 2:
        bs = np.array([cand[g] for g in group])
        words.append((bs[:, 0].min(), bs[:, 1].max(), bs[:, 2].min(), bs[:, 3].max()))
wy = np.array([(w[0] + w[1]) / 2 for w in words]) if words else np.zeros(0)
for y0, y1, x0, x1 in words:
    inline = (np.abs(wy - (y0 + y1) / 2) <= 4).sum() >= 4
    share = ring_bgshare(y0, y1, x0, x1, 4)
    if share >= 0.6:
        erase[max(0, y0 - 3):y1 + 3, max(0, x0 - 4):x1 + 4] |= True
    elif inline and share >= 0.25 and (x1 - x0) < 60:
        # a frame label touching a figure: erase only its dark glyph pixels (and their soft edge)
        sub = (raw[y0 - 1:y1 + 1, x0 - 1:x1 + 1].max(2) < 150) & (sat[y0 - 1:y1 + 1, x0 - 1:x1 + 1] < 40)
        sub = ndi.binary_dilation(sub, iterations=2)
        Y0, X0 = y0 - 1, x0 - 1
        reg = np.zeros((H, W), bool)
        reg[Y0:Y0 + sub.shape[0], X0:X0 + sub.shape[1]] = sub
        pill_mask |= reg
# long thin separator lines (dashed or solid), light grey
lines = 0
for y in range(3, H - 4):
    rowm = (sat[y] < 14) & (raw[y].max(1) < 248) & (raw[y].min(1) > 110)
    if rowm.mean() < 0.22:
        continue
    clear = (dbg[y - 3] < 8) & (dbg[y + 4] < 8)
    if (clear[rowm]).mean() > 0.85:
        erase[y] |= rowm
        lines += 1
log("pills", pills, "words", len(words), "line rows", lines)
# only erase text-like pixels (never colourful figure pixels that may sit in a box)
emask = erase & ((sat < 45) | (dbg < 30) | (raw.min(2) > 140))
emask |= pill_mask
img[emask] = BG
dbg = np.abs(img - BG).max(2)
sat = img.max(2) - img.min(2)

if DEBUG:
    os.makedirs(outdir, exist_ok=True)
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(f"{outdir}/{name}-erased.png")
# ---------- 2. foreground mask ----------
def cutout_mask(white, dref):
    lab, n = ndi.label(white)
    bd = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(bd))
    if n:
        sizes = ndi.sum(np.ones_like(lab), lab, index=np.arange(n + 1))
        means = ndi.mean(dref, lab, index=np.arange(n + 1))
        for i in range(1, n + 1):
            if i not in bd and sizes[i] > 60 and means[i] < 2.5:
                bg |= lab == i
    return ~bg

TOL = 7 if PALE else 9
fg = cutout_mask(dbg <= TOL, dbg)
GROW = 1 if PALE else 3
# grow the background a few px into pale grey fringe that touches it (soft halos)
loose = (img.min(2) > BG.min() - 40) & (sat < 16)
near = ndi.distance_transform_edt(fg) <= GROW
cand_ = loose & near & fg
l2, n2 = ndi.label(cand_ | ~fg)
keep = np.unique(l2[~fg])
fg &= ~(np.isin(l2, keep) & cand_)
# light enclosed pockets (gaps between limbs)
pocket = (img.min(2) > BG.min() - 22) & (sat < 10) & fg
pl, pn = ndi.label(pocket)
if pn:
    psz = ndi.sum(pocket, pl, index=np.arange(1, pn + 1))
    pmn = ndi.mean(img.min(2), pl, index=np.arange(1, pn + 1))
    drop = [k + 1 for k in range(pn) if psz[k] >= (60 if PALE else 14) and pmn[k] > BG.min() - (4 if PALE else 14)]
    fg &= ~np.isin(pl, drop)
fg = ndi.binary_opening(fg, iterations=1) | (fg & ~ndi.binary_erosion(fg, iterations=1) & (dbg > 60))
dist = ndi.distance_transform_edt(fg)

def soften(fgm, dst, im):
    alpha = np.ones(fgm.shape, np.float32)
    rim = fgm & (dst <= 2.5)
    a_est = np.clip(np.abs(im - BG).max(2) / 255 * 1.8, 0, 1)
    alpha[rim] = np.minimum(1, np.maximum(a_est[rim], np.clip((dst[rim] - 0.6) / 2.0, 0, 1)))
    alpha[~fgm] = 0
    safe = np.maximum(alpha, 1e-3)[..., None]
    unbl = (im - BG * (1 - alpha[..., None])) / safe
    rgb = np.where(rim[..., None], np.clip(unbl, 0, 255), im)
    return alpha, rgb

alpha, rgb = soften(fg, dist, img)
# colour-to-alpha (white) for mist and smoke outside the solid mask
c2a = np.clip((BG.min() - img.min(2)) / max(1, BG.min() - 40), 0, 1)
c2a[c2a < 0.07] = 0

# ---------- 3. blobs, rows and columns ----------
blab, bn = ndi.label(fg)
bl = np.where(fg, blab, 0)
objs = ndi.find_objects(blab)
area = ndi.sum(fg, blab, index=np.arange(1, bn + 1))
top = np.sort(area)[::-1][:40]
thr = 0.22 * np.median(top)
figs = [i + 1 for i in range(bn) if area[i] >= thr]
box = {i: (objs[i - 1][0].start, objs[i - 1][0].stop, objs[i - 1][1].start, objs[i - 1][1].stop) for i in range(1, bn + 1)}
cy = {i: (box[i][0] + box[i][1]) / 2 for i in box}
cx = {i: (box[i][2] + box[i][3]) / 2 for i in box}
hts = np.array([box[i][1] - box[i][0] for i in figs])
medh = float(np.median(hts))
def cluster_rows(ids):
    rows_ = []
    for i in sorted(ids, key=lambda i: cy[i]):
        y0, y1 = box[i][0], box[i][1]
        placed = False
        for r in rows_:
            ry0, ry1 = r[0], r[1]
            ov = min(y1, ry1) - max(y0, ry0)
            if ov > 0.4 * min(y1 - y0, ry1 - ry0) and abs(cy[i] - r[2]) < 0.9 * medh:
                r[3].append(i)
                r[0], r[1] = min(ry0, y0), max(ry1, y1)
                r[2] = np.median([cy[j] for j in r[3]])
                placed = True
                break
        if not placed:
            rows_.append([y0, y1, cy[i], [i]])
    rows_.sort(key=lambda r: r[2])
    return [r[3] for r in rows_]

rows = cluster_rows(figs)
log("rows", [len(r) for r in rows], "medh", medh)
# portrait: the clearly largest blob in the upper part, not part of a regular 6-row
cands = [i for i in figs if cy[i] < H * 0.3]
portrait = None
if cands:
    big = max(cands, key=lambda i: area[i - 1])
    rest = sorted(area[j - 1] for j in figs if j != big)
    if area[big - 1] > 1.6 * np.median(rest) or (box[big][1] - box[big][0]) > 1.35 * medh:
        portrait = big
if portrait:
    for r in rows:
        if portrait in r:
            r.remove(portrait)
    rows = [r for r in rows if r]
    rows = cluster_rows([i for r in rows for i in r])
log("rows after portrait", [len(r) for r in rows])

# row bands
bands = []
for r in rows:
    bands.append([min(box[i][0] for i in r), max(box[i][1] for i in r)])
# columns from the rows that hold exactly 6 figures
six = [r for r in rows if len(r) == 6]
colc = np.median(np.array([sorted(cx[i] for i in r) for r in six]), 0)
log("cols", colc.astype(int))

def assign_row(i):
    best, bd = None, 1e9
    for k, (y0, y1) in enumerate(bands):
        d = 0 if y0 - 6 <= cy[i] <= y1 + 6 else min(abs(cy[i] - y0), abs(cy[i] - y1))
        if d < bd:
            best, bd = k, d
    return best, bd

# which row is death? candidates: first and last; death frames vary in height a lot
def height_cv(k):
    r = rows[k]
    if len(r) < 4:
        return 0
    h = np.array([box[i][1] - box[i][0] for i in r], float)
    w = np.array([box[i][3] - box[i][2] for i in r], float)
    a = w / h
    return np.std(h) / np.mean(h) + 0.6 * np.std(a) / np.mean(a)

death_k = None
cv0, cv1 = height_cv(0), height_cv(len(rows) - 1)
if len(rows) >= 9 or max(cv0, cv1) > 0.22:
    death_k = 0 if cv0 > cv1 else len(rows) - 1
    log("death row", death_k, "cv", round(cv0, 2), round(cv1, 2))
walk_ks = [k for k in range(len(rows)) if k != death_k]

# death row columns: weighted k-means over the row's pixels
death_cols = None
if death_k is not None:
    y0, y1 = bands[death_k]
    sub = fg[max(0, y0 - 40):y1 + 10]
    xs = np.where(sub)[1].astype(float)
    if portrait:
        px0, px1 = box[portrait][2], box[portrait][3]
        xs = xs[(xs < px0 - 4) | (xs > px1 + 4)]
    p3, p97 = np.percentile(xs, 3), np.percentile(xs, 97)
    sp = (p97 - p3) / 5.2
    prof = np.bincount(xs.astype(int), minlength=W).astype(float)
    prof = ndi.uniform_filter1d(prof, max(9, int(sp * 0.5)))
    peaks = []
    pr = prof.copy()
    for _ in range(6):
        k_ = int(np.argmax(pr))
        peaks.append(k_)
        pr[max(0, int(k_ - 0.6 * sp)):int(k_ + 0.6 * sp)] = 0
    c = np.array(sorted(peaks), float)
    for _ in range(10):
        a = np.argmin(np.abs(xs[:, None] - c[None]), 1)
        c = np.array([xs[a == k].mean() if (a == k).any() else c[k] for k in range(6)])
    death_cols = c
    log("death cols", c.astype(int))

# split blobs that span two frames (touching neighbours) at the emptiest column near the boundary
area = list(area)
next_id = bn + 1
for i in list(range(1, bn + 1)):
    if i == portrait or area[i - 1] < 50:
        continue
    k, d = assign_row(i)
    if k is None:
        continue
    cols = death_cols if k == death_k else colc
    sp = float(np.median(np.diff(cols)))
    y0, y1, x0, x1 = box[i]
    if x1 - x0 < 0.8 * sp:
        continue
    cuts = []
    for t in range(5):
        mid = (cols[t] + cols[t + 1]) / 2
        if x0 + 8 < mid < x1 - 8:
            lo, hi = int(max(x0 + 4, mid - 0.25 * sp)), int(min(x1 - 4, mid + 0.25 * sp))
            prof = (bl[y0:y1, lo:hi] == i).sum(0)
            cuts.append(lo + int(np.argmin(ndi.uniform_filter1d(prof.astype(float), 5))))
    if not cuts:
        continue
    ys_, xs_ = np.where(bl[y0:y1, x0:x1] == i)
    ys_ += y0; xs_ += x0
    edges = [x0] + cuts + [x1]
    for t in range(len(edges) - 1):
        sel = (xs_ >= edges[t]) & (xs_ < edges[t + 1])
        if not sel.any():
            continue
        nid = i if t == 0 else next_id
        if t > 0:
            next_id += 1
        bl[ys_[sel], xs_[sel]] = nid
        by0, by1, bx0, bx1 = ys_[sel].min(), ys_[sel].max() + 1, xs_[sel].min(), xs_[sel].max() + 1
        box[nid] = (by0, by1, bx0, bx1)
        cy[nid], cx[nid] = (by0 + by1) / 2, (bx0 + bx1) / 2
        if nid == i:
            area[i - 1] = int(sel.sum())
        else:
            area.append(int(sel.sum()))
    log("split blob", i, "at", cuts)
bn = next_id - 1
area = np.array(area)

# group blobs into cells: every blob goes to the cell of its row band and column; per cell the
# largest blob is the figure, other pieces join it when they are close (or big)
pieces = {}
for i in range(1, bn + 1):
    if i == portrait or area[i - 1] < 4:
        continue
    k, d = assign_row(i)
    if k is None:
        continue
    isdeath = k == death_k
    if d > (60 if isdeath else 14):
        continue
    cols = death_cols if isdeath else colc
    c = int(np.argmin(np.abs(cols - cx[i])))
    pieces.setdefault((k, c), []).append(i)
log('pieces', sorted((k,c,len(v)) for (k,c),v in pieces.items() if k in (0, death_k)))
cells = {}
for (k, c), ids in pieces.items():
    isdeath = k == death_k
    ids.sort(key=lambda i: -area[i - 1])
    m = ids[0]
    tot = sum(area[i - 1] for i in ids)
    keep = [m]
    for i in ids[1:]:
        dy = max(0, box[m][0] - box[i][1], box[i][0] - box[m][1])
        dx = max(0, box[m][2] - box[i][3], box[i][2] - box[m][3])
        if area[i - 1] >= 0.12 * tot or max(dx, dy) <= (70 if isdeath else 10):
            if not isdeath and area[i - 1] < 25 and max(dx, dy) > 3:
                continue
            if not isdeath and area[i - 1] < 300 and box[i][0] >= box[m][1] - 6:
                continue  # label text under the feet
            if isdeath and area[i - 1] < 150 and box[i][0] >= box[m][1] - 2:
                continue
            if isdeath and not MIST_DEATH and area[i - 1] < 40 and max(dx, dy) > 22:
                continue
            keep.append(i)
    cells[(k, c)] = keep

def frame(k, c, mist):
    ids = cells.get((k, c))
    if not ids and not mist:
        return None
    if ids:
        m = np.isin(bl, ids)
        ys_, xs_ = np.where(m)
        y0, y1, x0, x1 = ys_.min(), ys_.max() + 1, xs_.min(), xs_.max() + 1
    else:
        # nothing solid left (a frame that is only mist): take the mist of the cell
        m = np.zeros((H, W), bool)
        cols = death_cols if k == death_k else colc
        x0 = int(cols[c] - 0.45 * np.median(np.diff(cols))); x1 = int(cols[c] + 0.45 * np.median(np.diff(cols)))
        y0, y1 = bands[k][0], bands[k][1]
    a = np.where(m, alpha, 0)
    col = rgb
    if mist:
        pad = 26
        Y0, Y1, X0, X1 = max(0, y0 - pad), min(H, y1 + pad), max(0, x0 - pad), min(W, x1 + pad)
        reg = np.zeros_like(m)
        reg[Y0:Y1, X0:X1] = True
        # stay inside this cell's column
        cols = death_cols if k == death_k else colc
        lo = (cols[c - 1] + cols[c]) / 2 if c > 0 else 0
        hi = (cols[c] + cols[c + 1]) / 2 if c < 5 else W
        reg[:, : int(lo)] = False
        reg[:, int(hi):] = False
        if k > 0:
            reg[: int((bands[k - 1][1] + bands[k][0]) / 2)] = False
        if k < len(bands) - 1:
            reg[int((bands[k][1] + bands[k + 1][0]) / 2):] = False
        soft = np.clip((BG.min() - img.min(2)) / max(1, BG.min() - 150), 0, 1)
        soft[soft < 0.06] = 0
        fade = MIST or (k == death_k and c >= 3)
        extra = reg & (soft > 0) & (~m if not fade else True)
        if k != death_k and m.any():
            extra &= ndi.distance_transform_edt(~m) <= 10
            stray = ~m & (img.min(2) < 160) & (sat < 40) & reg
            extra &= ~ndi.binary_dilation(stray, iterations=3)
        a = np.where(extra, soft if fade else c2a, a)
        av = soft if fade else c2a
        safe = np.maximum(av, 1e-3)[..., None]
        unbl = np.clip((img - BG * (1 - av[..., None])) / safe, 0, 255)
        col = np.where(extra[..., None], unbl, rgb)
        ys_, xs_ = np.where(a > 0.02)
        y0, y1, x0, x1 = ys_.min(), ys_.max() + 1, xs_.min(), xs_.max() + 1
    aa = a[y0:y1, x0:x1]
    im = np.dstack([col[y0:y1, x0:x1], aa * 255]).clip(0, 255).astype(np.uint8)
    return dict(im=im, a=aa, x0=x0, y0=y0, x1=x1, y1=y1, h=y1 - y0, w=x1 - x0)

# ---------- 4. walk sheet ----------
ROWS = 8
grid = []
for k in walk_ks:
    row = [frame(k, c, MIST) for c in range(6)]
    grid.append(row)
if len(grid) < ROWS:
    # a missing view: find the gap by the row spacing and mirror the partner view
    centres = [np.mean(bands[k]) for k in walk_ks]
    step = np.median(np.diff(centres))
    full, src_rows = [], []
    j = 0
    for t in range(ROWS):
        want = centres[0] + t * step
        if j < len(centres) and abs(centres[j] - want) < 0.45 * step:
            full.append(grid[j]); j += 1
        else:
            full.append(None)
    grid = full
MIRROR = {7: 1, 1: 7, 6: 2, 2: 6, 5: 3, 3: 5, 0: 0, 4: 4}
for r in range(ROWS):
    if grid[r] is None or any(f is None for f in grid[r]):
        s = MIRROR[r]
        log("mirroring row", s, "->", r)
        grid[r] = [dict(f, im=f["im"][:, ::-1].copy(), a=f["a"][:, ::-1].copy()) for f in grid[s]]
for row in grid:
    for f in row:
        t = f["a"][: max(1, int(f["h"] * 0.65))]
        f["cx"] = (t.sum(0) * np.arange(t.shape[1])).sum() / max(1e-6, t.sum())
margin = 4
half = int(np.ceil(max(max(f["cx"], f["w"] - f["cx"]) for row in grid for f in row))) + margin
maxH = max(f["h"] for row in grid for f in row)
fw, footY = 2 * half, maxH + margin
fh = footY + 4
sheet = Image.new("RGBA", (fw * 6, fh * ROWS), (0, 0, 0, 0))
hs = []
for r, row in enumerate(grid):
    cxm = float(np.median([f["cx"] for f in row]))
    for c, f in enumerate(row):
        x = 0.5 * f["cx"] + 0.5 * cxm
        sheet.alpha_composite(Image.fromarray(f["im"]), (int(round(c * fw + half - x)), r * fh + footY - f["h"]))
        hs.append(f["h"])
os.makedirs(f"{outdir}/anim", exist_ok=True)
os.makedirs(f"{outdir}/art", exist_ok=True)
sheet.save(f"{outdir}/anim/{name}.webp", "WEBP", quality=92, method=6)
meta = dict(walk=dict(fw=int(fw), fh=int(fh), footX=int(half), footY=int(footY), figH=int(np.median(hs))))

f = grid[1][0]
st = Image.fromarray(f["im"])
pad = 4
still = Image.new("RGBA", (st.width + 2 * pad, st.height + 2 * pad), (0, 0, 0, 0))
still.alpha_composite(st, (pad, pad))
still.save(f"{outdir}/art/{name}.webp", "WEBP", quality=92, method=6)
meta["still"] = dict(w=int(still.width), h=int(still.height), footY=int(still.height - pad - 1))

# ---------- 5. death sheet ----------
if death_k is not None:
    ds = [(c, frame(death_k, c, MIST_DEATH)) for c in range(6)]
    if all(g is not None for _, g in ds):
        ground = max(g["y1"] for _, g in ds)
        left = max(death_cols[c] - g["x0"] for c, g in ds)
        right = max(g["x1"] - death_cols[c] for c, g in ds)
        up = max(ground - g["y0"] for _, g in ds)
        g0 = ds[0][1]
        t = g0["a"][: int(g0["h"] * 0.65)]
        shift = g0["x0"] + (t.sum(0) * np.arange(t.shape[1])).sum() / t.sum() - death_cols[0]
        dhalf = int(np.ceil(max(left - shift, right + shift))) + margin
        dfw, dfootY = 2 * dhalf, int(up) + margin
        dfh = dfootY + 4
        dsheet = Image.new("RGBA", (dfw * 6, dfh), (0, 0, 0, 0))
        for kk, (c, g) in enumerate(ds):
            x = int(round(kk * dfw + dhalf + (g["x0"] - death_cols[c]) - shift))
            y = int(round(dfootY - (ground - g["y0"])))
            dsheet.alpha_composite(Image.fromarray(g["im"]), (x, y))
        dsheet.save(f"{outdir}/anim/{name}-death.webp", "WEBP", quality=92, method=6)
        meta["death"] = dict(fw=int(dfw), fh=int(dfh), footX=int(dhalf), footY=int(dfootY), figH=int(g0["h"]))
    else:
        log("death frames missing", [g is None for _, g in ds])

# ---------- 6. portrait ----------
if portrait:
    y0, y1, x0, x1 = box[portrait]
    sub = img[y0:y1, x0:x1]
    darkm = sub.max(2) < 110

    def edge_dark(line):
        n_ = len(line)
        return line[n_ // 5: n_ - n_ // 5].mean() > 0.7

    edges = [[t for t in range(12) if edge_dark(e(t))] for e in (lambda t: darkm[t], lambda t: darkm[-1 - t], lambda t: darkm[:, t], lambda t: darkm[:, -1 - t])]
    framed = sum(1 for e in edges if e) >= 3
    if framed:
        inset = max(t for e in edges for t in e) + 3
        sub = sub[inset:-inset, inset:-inset]
    sdb = np.abs(sub - BG).max(2)
    sw = sdb <= TOL
    if not framed:
        sw |= (sub.min(2) > BG.min() - 40) & ((sub.max(2) - sub.min(2)) < 16) & (ndi.distance_transform_edt(~(sdb <= TOL)) <= 3)
    pf = cutout_mask(sw, np.where(sdb < 6, 0, sdb))
    pf = ndi.binary_opening(pf, iterations=1)
    lab_, n_ = ndi.label(pf)
    if n_ > 1:
        sz = ndi.sum(pf, lab_, index=np.arange(1, n_ + 1))
        pf = np.isin(lab_, [k + 1 for k in range(n_) if sz[k] >= 0.02 * sz.max()])
    pd = ndi.distance_transform_edt(np.pad(pf, 1, constant_values=False))[1:-1, 1:-1]
    pa, prgb = soften(pf, pd, sub)
    yy, xx = np.where(pa > 0.02)
    pa, prgb = pa[yy.min():yy.max() + 1, xx.min():xx.max() + 1], prgb[yy.min():yy.max() + 1, xx.min():xx.max() + 1]
    pim = Image.fromarray(np.dstack([prgb, pa * 255]).clip(0, 255).astype(np.uint8))
    if max(pim.size) > 220:
        kf = 220 / max(pim.size)
        pim = pim.resize((round(pim.width * kf), round(pim.height * kf)), Image.LANCZOS)
    pkey = name.replace("creep-n-", "creep-p-")
    pim.save(f"{outdir}/art/{pkey}.webp", "WEBP", quality=92, method=6)
    meta["portrait"] = dict(key=pkey, w=pim.width, h=pim.height, framed=framed)
json.dump(meta, open(f"{outdir}/{name}.json", "w"))
log(json.dumps(meta))
