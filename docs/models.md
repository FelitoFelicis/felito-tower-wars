# 3D figures (mobile-3d)

All towers, creeps and props are low-poly models built in code. Target look: `docs/concepts/towers-and-world.png`
(chunky chibi figures, bright colours, round stone plates with a coloured rim).

## Files

| File | Content |
| --- | --- |
| `src/r3d.js` | Renderer core: `Geo` builder, `defineModel`, shaders, instancing (`Batch`), `View3D` |
| `src/models/kit.js` | Shared parts: `chibi()` humanoid, `quadruped()`, hoods, helmets, hats, weapons, wings, flames, crystals, `plateGeo()` |
| `src/models/towers-a.js` | Towers 1–15 of the concept sheet |
| `src/models/towers-b.js` | Towers 16–30 |
| `src/models/towers-c.js` | Towers 31–45 |
| `src/models/creeps-a.js`, `creeps-b.js` | Creeps (keys `creep-…`, same names as the old 2D art in `assets/art/`) |
| `src/models/world.js` | Board pieces and props (`w-…`) and projectile models |
| `tools/model-preview.html` | Preview of any models (see the comment at the top for URL parameters) |
| `tools/model-shots.mjs` | Screenshots of models: `node tools/model-shots.mjs --models t-archer --out shots/models` |

## Conventions

- 1 unit = one board cell. +Y is up, the figure faces +Z (towards the camera).
- Towers stand on y = 0, the top of the round plate. The renderer draws the plate (`plateGeo`) in the element colour and scales tower figures by `FIG_SCALE` (1.2). Model a 1×1 tower about 0.75–0.9 tall and at most ±0.4 wide. Halls are 2×2 (`meta.size: 2`) and modelled at their real size.
- Creeps stand on y = 0 with their feet and walk towards +Z. Normal creeps 0.5–0.7 tall, bosses about 1.0. Flyers: model them as if hovering just above y = 0; the renderer lifts them.
- Every figure is leaned back towards the camera by the renderer (`FIG_TILT`), the camera looks down at `CAM_PITCH`.
- `build({ tier })`: tier 1 = levels 1–2, tier 2 = levels 3–4, tier 3 = level 5+. Same silhouette, higher tiers add metal trim, gold and glow.
- Animation is done in the vertex shader through `part` tags: legs and arms swing while walking, wings flap, `SPIN` parts turn, `FLOAT` parts hover, `TAIL` parts sway. Give limbs a `pivot: [y, z]` at the joint. Held items use the arm's `part`/`pivot` (the `chibi()` anchors `armL`/`armR`).
- `glow` (0–1) makes surfaces self-lit: fire, magic, crystals, eyes.
- Budget: towers ≤ 2500 triangles, creeps ≤ 1500, props ≤ 600. Spheres with 8–12 segments are enough.
- All designs are original. No characters, logos or names from other games.
