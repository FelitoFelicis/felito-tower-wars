# Felito Tower Wars

A Line Tower Wars game for desktop and mobile,build towers, lay out a maze, send creeps to your enemies and grow your income.
Play against 1–7 AI opponents or online against a friend.

**Play:** https://felitofelicis.github.io/felito-tower-wars/

## Run locally

No build step. Start any static web server in this folder, e.g.

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

## Layout

| Path | Contents |
| --- | --- |
| `index.html` | Page and import map |
| `style.css` | All styling (the commented source; the page loads the generated `style.min.css`) |
| `src/app.js` | UI: menus, card bar, tower panel, saving |
| `src/arena.js`, `src/b2d.js` | Board rendering with Babylon.js |
| `src/simulation.js` | Game logic (20 ticks/s, deterministic: randomness only via `random(game)`) |
| `src/content.js`, `data/` | Towers, creeps and research from the map |
| `src/art.js` | Artwork per tower/creep, team colours |
| `src/multiplayer.js` | Online duel via PeerJS |
| `src/soundtrack.js`, `src/music.js`, `src/sfx.js` | Music and sound effects |
| `assets/`, `vendor/` | Art, fonts (WOFF2), music (MP3, 96 kbps); bundled libraries (Babylon.js subset, PeerJS) |
| `tools/` | Build scripts for the generated files (`style.min.css`, `vendor/babylon-felito.js`) |

When publishing a new version, renew all `?v=` keys in `index.html` and `APP_VERSION` in `src/app.js`.

**After editing style.css run `node tools/build-css.mjs`** – it writes `style.min.css` (the file the page loads; no dependencies). Commit both files.

### Generated files

- `style.min.css` comes from `style.css` via `node tools/build-css.mjs`.
- `vendor/babylon-felito.js` is a minified Babylon.js subset. Its readable source is
  `tools/babylon/babylon-felito.full.js` (the core modules the game uses, bundled into one file). It is
  rebuilt with `node tools/build-babylon.mjs` (uses `npx -y esbuild@0.28.2`, or `ESBUILD=/path/to/esbuild`):
  the script removes the texture-file loaders the game never uses (DDS, ENV, HDR, KTX, Basis, TGA, EXR,
  IES – the game draws all textures from canvases) and everything only they need, then minifies.
- Fonts: the WOFF2 files in `assets/fonts/` were made from the Google Fonts TTFs with
  `python3 -m fontTools.ttLib.woff2 compress` (same names); they are declared at the top of `style.css`.
- Music: `ffmpeg -i in.mp3 -map_metadata 0 -c:a libmp3lame -b:a 96k out.mp3`.
