# Version Publishing Rules

**Read this document before every push or publish, and follow every rule in it.**
It applies to **every push**, to `main` and to every branch alike, and to Felix, Steven and every Claude session working on Felito Tower Wars.

## 1. Version numbers

Format: `v0.<number><letters><author>`, e.g. `v0.23pF`.

- **Large update** (new feature set, overhaul, many changes): raise the number and reset the letters: `v0.23zc` → `v0.24`.
- **Small update** (fixes, tweaks, a few changes): next letter: `v0.23o` → `v0.23p`.
- **After `z`** the letters continue doubled: `z` → `za` → `zb` … → `zz` → `zza`.
- Every published version gets its own new version. Never publish two different states under the same version.

## 2. Author marker (F / S)

Every version ends with the initial of the person who made the **last change**:

- **F** = Felix, **S** = Steven.
- Examples: `v0.23pF`, `v0.23qS`, `v0.23a (steven graphics) 0.02S`.
- Changes made by Claude count for the person who asked for them.
- The marker is part of the displayed version (title, start screen, commit message). `APP_VERSION` in `src/app.js` stays without marker and branch text, so online matches stay compatible; the marker and branch text go into `APP_BRANCH`.

## 3. Branch versions

- A branch **always keeps the version it originated from** (number and letters), e.g. a branch started from `v0.23a` stays `v0.23a`.
- It is marked with a short name in brackets behind the version: `v0.23a (steven graphics)`.
- Behind the brackets is the branch counter. It starts at `0.01`; **every update of the branch raises the counter**: `0.01` → `0.02` → `0.03`.
- Full example: `v0.23a (steven graphics) 0.03S`.
- Parallel chats on the same line get a chat number: `v0.17r2`.
- **Merging into `main`:** bracket text, branch counter and chat number are dropped, and the version continues normally from the current `main` version (e.g. `main` is `v0.23pF` → merged result `v0.23qF` or `v0.23qS`).

## 4. Before every push (main or branch)

1. Read this document.
2. **Push only when Felix explicitly says so** ("push it"). This also applies to branch pushes.
3. Compare versions: the live artifact (`APP_VERSION` in `src/app.js`) and GitHub (all branches). Never continue two lines in parallel. On a branch, check that the branch on GitHub is not ahead of your state; if it is, pull first.
4. Set the new version everywhere:
   - `APP_VERSION` (and `APP_BRANCH` if used) in `src/app.js`
   - all `?v=` cache keys in `index.html`
   - `ART_VERSION` in `src/art.js` if images changed
   - rebuild `style.min.css` with `node tools/build-css.mjs` if `style.css` changed
   - rebuild the minified modules with `node tools/build-js.mjs` (needs esbuild: `npm install`) and publish `build/src/<name>.js` under the path `src/<name>.js`; the repo keeps the readable sources in `src/`
5. If `src/simulation.js` changed: keep it deterministic (randomness only via `random(game)`) and compare two identical bot matches (same hash).
6. Test the build in the browser.
7. Commit message starts with the full version, e.g. `v0.23pF: staggered large sends` or `v0.23a (steven graphics) 0.02S: readable menus`.
8. Branch versions are pushed to their own branch, never to `main`, unless Felix asks for a merge. `main` only receives main-line versions or merges (section 3).

## 5. After every push (main or branch)

- Note the version as pushed (Prompt History: "- pushed" behind the heading), with the target (`main` or branch name).
