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
