"""v0.24a: pack many small pictures into a few files (the game artifact holds at most ~511 files).

Format of a pack: JSON { "assets/art/x.webp": "<base64 of the file>", ... } (artifacts only serve standard
web types, so no raw binary). src/art.js (loadPacks) turns every entry into a blob: URL under its original
path, so the code keeps asking for "assets/art/x.webp" as before.

Run from the repo root:  python3 tools/build-packs.py
Then publish assets/packs/*.json instead of the packed single files (the single files stay in the repo as sources).
v0.27zwF: tower attack sheets (assets/anim/tower-*.webp) are packed per tower line too (assets/packs/anim-<line>.json).
"""
import base64, glob, json, os, re

PACKS = {
    "assets/packs/perks.json": sorted(glob.glob("assets/art/perks/*.webp") + glob.glob("assets/art/perk-*.webp")),
    "assets/packs/towers.json": sorted(f for f in glob.glob("assets/art/tower-*.webp") if re.search(r"-(v|l)\d\.webp$", f)),
}

def anim_packs():
    """v0.27zwF: tower attack sheets: one pack per tower line (all its levels), loaded on demand by src/art.js."""
    lines = {}
    for f in sorted(glob.glob("assets/anim/tower-*.webp")):
        key = os.path.basename(f)[:-5]
        line = re.sub(r"-(v|l)\d$", "", key)[len("tower-"):]
        lines.setdefault("assets/packs/anim-" + line + ".json", []).append(f)
    return lines

def build():
    os.makedirs("assets/packs", exist_ok=True)
    for old in glob.glob("assets/packs/anim-*.json"):
        os.remove(old)
    for out, files in {**PACKS, **anim_packs()}.items():
        pack = {f.replace(os.sep, "/"): base64.b64encode(open(f, "rb").read()).decode() for f in files}
        with open(out, "w") as fh:
            json.dump(pack, fh, separators=(",", ":"))
        print(f"{out}: {len(files)} files, {os.path.getsize(out)} bytes")

if __name__ == "__main__":
    build()
