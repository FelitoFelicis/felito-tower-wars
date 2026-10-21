# Design variants

Added on top of v0.22zk as one separate update, so it can be reverted as a whole. The choice is stored per
browser (`localStorage["felito.design"]`); **Original** is the default and looks exactly as before.

| Design | Look | Figures |
| --- | --- | --- |
| `original` | Night forest, painted art | `assets/art` (unchanged) |
| `sonne` – Sonnenwiese, button "Meadow" | Daylight sky, the board as a floating meadow island, cream panels | `assets/art-toy` |
| `bonbon` – Bonbon, button "Candy" | Turquoise with dots, white sticker panels with navy outlines | `assets/art-toy` |
| `pets` – Pfotenwelt, button "Paws" | Warm peach sky with paw prints, animals instead of people | `assets/art-pets` |

The new looks are called *Circle Tower Wars* (page title, logo, boot screen).

## Files

| Path | What it does |
| --- | --- |
| `src/design.js` | List of designs, board colours, props around the board, `setDesign` |
| `design.css` | All UI styling of the new looks (tokens per design, panels, buttons, welcome cast, icons) |
| `src/art-sets.js` | Size and plate data of every figure in the toy and pet sets, list of toy icons |
| `src/art.js` | `artSetFor`, `useArtSet`, `setArtKey`, `uiArt`: picks the picture of the active set; level variants (`-v1..-v3`, `-l1/-l2`) share their base figure there |
| `src/motion.js` | Idle, attack and walk motion per tower and creep (math on the sprite transform, no extra draw calls) |
| `src/arena.js` | `need`/`fold` (figures load on first use from the active set, size data travels with the texture), `switchArt` (every loaded figure is fetched again from the new set and swapped in place), `figureMotion`, creep gaits, `drawThemeTerrain`, `placeProps` (props from one atlas per design, `loadTerrainAtlas`), `pawFlow` (Pfotenwelt route) |
| `src/b2d.js` | `reloadImage` (fetch a picture again over a texture of the same key), `derivedKeys`, `artKeys`, `urlOf`, `dropTexture` |
| `src/app.js` | Design row in Options › Graphic, `applyDesignArt` (cards, portraits, logo, HUD icons follow at once), welcome cast |
| `index.html` | Loads `design.css`, import map entries, sets the design before the first frame (boot logo) |
| `assets/art-toy`, `assets/art-pets` | One picture per tower and creep, board props (`deco-*`), logo; `assets/art-toy/ui` icons and reward pictures |
| `assets/fonts/fredoka-*` | Font of Bonbon and Pfotenwelt (OFL) |

All art was generated with GPT Image 2.5 (Higgsfield) as sheets on a transparent background, cut by script and
measured: towers stand on identical stone plates per sheet, so `plateW/plateCX/plateCY/plateTop` come from the
sheet's clean plates; creeps and props carry `footY`.

## Adding a tower or creep

Without new art a new figure simply shows its original painting in the new looks too. For a matching figure add
`assets/art-toy/<key>.webp` and `assets/art-pets/<key>.webp` and their entries in `src/art-sets.js`
(same fields as `BASE_ART` in `src/art.js`), and optionally a motion profile in `src/motion.js` (`TOWER` / `CREEP`).

## Removing the variants

Delete `design.css`, `DESIGNS.md`, `src/design.js`, `src/motion.js`, `src/art-sets.js`, `assets/art-toy`,
`assets/art-pets` and the two Fredoka fonts, then revert this update's changes in `index.html`, `src/app.js`,
`src/art.js`, `src/arena.js`, `src/b2d.js` and `README.md` (or simply `git revert` the commit).
