# Felito Tower Wars

A Line Tower Wars game for desktop and mobile,build towers, lay out a maze, send creeps to your enemies and grow your income.
Play against 1–7 AI opponents or online against a friend.

**Play:** https://felitofelicis.github.io/felito-tower-wars/

## Mobile redesign (v0.11, branch `mobile-redesign`)

- New art for all 45 tower lines and the props, cut from `docs/concepts/towers-and-world.png` (one figure per line for every level).
- Phones in portrait: the board fills the width; a slim HUD on top and one card tray at the bottom sit over it. Two fingers zoom (1–3×), one finger pans while zoomed, the magnifier button resets. Phones held sideways get a "turn your phone" hint.
- A guided first match against one AI (`src/tutorial.js`), short hints afterwards, a "whose board" label, an enemy list for 4+ enemies, a pause menu with Resume and Leave match.
- Saves drop the bot caches, so Continue works with 1–7 AIs.

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
| `style.css` | All styling |
| `src/app.js` | UI: menus, card bar, tower panel, saving |
| `src/tutorial.js`, `tutorial.css` | Guided first match against the AI (bubble and pointing hand); done flag in `localStorage` key `felito.tutorial.v1` |
| `src/arena.js`, `src/b2d.js` | Board rendering with Babylon.js |
| `src/simulation.js` | Game logic (20 ticks/s, deterministic: randomness only via `random(game)`) |
| `src/content.js`, `data/` | Towers, creeps and research from the map |
| `src/art.js` | Artwork per tower/creep, team colours |
| `src/multiplayer.js` | Online duel via PeerJS |
| `src/soundtrack.js`, `src/music.js`, `src/sfx.js` | Music and sound effects |
| `assets/`, `vendor/` | Art, fonts, music; bundled libraries (Babylon.js subset, PeerJS) |

When publishing a new version, renew all `?v=` keys in `index.html` and `APP_VERSION` in `src/app.js`.
