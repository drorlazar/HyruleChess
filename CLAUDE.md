# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

```bash
./run.sh                 # starts python3 -m http.server on :8765 and opens the browser
PORT=9000 ./run.sh       # override port
```

GLB models are loaded via `fetch()`, so **the game must be served over HTTP** — opening `index.html` via `file://` silently falls back to geometric primitive pieces (cylinders/spheres/cones) without any other visible failure.

## Tests

```bash
npm install              # one-time; installs Playwright
npm test                 # == npm run test:resume
BASE_URL=https://drorlazar.github.io/HyruleChess/ npm run test:resume  # test against Pages
HEADED=1 SLOW=1 npm test # headed browser + 150ms slow-mo for debugging
```

`scripts/test-resume.mjs` is a single Playwright suite (8 scenarios) that drives two isolated browser contexts and exercises the online-PvP resume/reconnect flow. It **requires `run.sh` to be running on :8765** and Firebase Anonymous Auth enabled on the `hyrulechess` project. There is no unit test runner — this is the only test harness.

## High-level architecture

### The whole game lives in one HTML file
`index.html` is ~7.5k lines of vanilla JS + CSS + HTML, loaded by non-module `<script>` tags from CDNs (Three.js r128, Firebase compat SDK, Google Fonts). There is **no bundler, no framework, no TypeScript, no build step**. Edit and reload.

Inside `index.html`, functionality is organized as IIFE modules and top-level functions. Key anchors:

- **`const Chess = (() => { … })()`** (~L2166) — pure chess rules engine. Holds board/turn/history/castling/en-passant. Board is `[row][col]`, **row 0 = rank 8 (black back rank), row 7 = rank 1 (white back rank)**. Pieces are `{type, color, hasMoved}` with `type ∈ {P,N,B,R,Q,K}` and `color ∈ {w,b}`. Exposes `getLegalMoves`, `makeMove`, `isInCheck`, `getGameStatus`, etc.
- **`const AI = (() => { … })()`** (~L2647) — alpha-beta minimax with piece-square tables. CPU difficulty = search depth (Courage=2, Wisdom=3, Power=4). Operates on a cloned board, never mutates game state.
- **`const SoundEngine = (() => { … })()`** (~L1976) — HTMLAudio-based SFX + BGM. Preloaded on first user gesture to satisfy autoplay policy. Settings persist to localStorage under `hyruleChess.audio.v1`.
- **`ModelLoader`** (~L3156) — async GLB loader. Normalizes each model to a target height from `HEIGHT_MAP`, centers horizontally, sets bottom at y=0. Uses deep material clones so capture fade-outs don't bleed across pieces.
- **`initThree()`** (~L3309) — builds scene, camera, renderer, lights, ground plane, board tiles, labels, particle systems, and the EffectComposer/UnrealBloomPass post-processing chain.
- **`buildLink()`, `buildZelda()`, `buildImpa()`, …** (~L3890–4935) — primitive Three.js fallback pieces used when GLBs fail to load. Leave these alone unless you are deliberately regenerating fallbacks.
- **`placePieces()`, `animateMove()`, `animateCapture()`, `animateCastleRook()`, `animate()`** — the render loop and move animations.
- **Scene Editor** (~L5892) — live lighting/tone-mapping/fog/bloom tuner. Press **E** in-game to toggle. Current settings auto-save to `localStorage['hyruleChess.sceneEditor.v1']`. **"Copy as JS"** dumps the current config as JS you can paste into `initThree()` for a permanent commit.
- **Material Editor** (~L6478) — sibling of the Scene Editor for tuning piece materials (color/metalness/roughness/emissive/opacity). Press **U** to toggle (panel appears top-left next to Scene Editor's top-right). Click any visible mesh on a piece or disc to pick that material; the sliders below edit the live material, the `ModelLoader` template, AND the store in one pass so all pieces of the same type update together (edit one pawn → all 8 pawns change). Edits persist to `localStorage['hyruleChess.materials.v1'|'.v2']` (keyed by model version so v1/v2 edits stay separate) and are baked into templates inside `ModelLoader.loadAll()` before the first clone, so reopening the game retains them. **"Copy JSON"** exports a `window.MATERIAL_OVERRIDES_V1`/`_V2` snippet for shipping to production — paste it above `initThree()` and `ModelLoader.loadAll` merges it on boot (localStorage wins for in-session edits).

**Material-key identification**: every loaded material is tagged with `material.userData.matKey = '<pieceKey>:<meshPath>:<matIdx>'` during `ModelLoader.loadAll`. The pieceKey is the `MODEL_MAP` entry (`w_K`, `b_P`, …) or `disc_w`/`disc_b` for v2 pedestals. `meshPath` is a dot-joined child-index path relative to the template root — deterministic across reloads because `GLTFLoader` and the procedural builders produce the same tree every time. `matIdx` is 0 for single-material meshes and 0..N for material arrays (the v2 disc uses `[side, top, bottom]`). Keys survive template cloning via Three's shallow `Object.assign` userData copy, so live scene clones carry them too. **Do not rename meshes** or change the order of `template.traverse` — both would invalidate saved matKeys. The defaults snapshot is captured into `material.userData.matKeyDefaults` on first load so "Reset mat" can restore without reloading the GLB. Because `scene.environment` is never set (no PMREM), `metalness` only affects direct spotlight highlights; crank `emissiveIntensity` if you want bloom to kick in.

### `net.js` — online PvP over Firebase Realtime Database
Separate UMD-style file (`(function () { 'use strict'; … })()`) exposing `window.NetClient`. Responsible for: room creation/join, anonymous auth, move streaming, presence heartbeats (15s), resign, rematch, and **resume** (reconnect + replay). Storage keys: `zledaChess.playerName`, `zledaChess.resume.v2`. Auto-resume fires on page load if a fresh saved room is found (<24h old).

Firebase config is **committed** in `net.js`. This is intentional and safe — the API key is not a secret (per Firebase docs), security is enforced by `database.rules.json`, which restricts writes to room codes of length 4–8 under `/rooms/$roomCode`.

### Model version toggle (v1 vs v2)
Two full sets of GLB models live under `assets/models/` (v1) and `assets/models/v2/` (v2). Toggle at runtime via `?v=1` or `?v=2` URL param, or the in-game switch — both persist to `localStorage['hyruleChess.modelVersion']`.

- **v1**: pedestal disc baked into each piece GLB. Paths are flat under `assets/models/`.
- **v2**: pieces are separate from pedestals. `ModelLoader.discs` holds two shared disc templates built **programmatically** by `buildRuneDisc('w'|'b')` (not loaded from GLB). Each placed piece is a group composed of `disc.clone()` + piece mesh. We tried Tripo3D for the discs and abandoned it — it baked the reference image's 3/4 camera tilt into the mesh. Keep discs programmatic.
- **Hyrule v2 disc style**: `?disc=royal` (default, blue+gold, subtle glow) or `?disc=sheikah` (cyan+triforce, high glow). Persists to `localStorage['hyruleChess.hyruleDiscStyle']`.

### Assets pipeline
- `assets/references/*.png` — hand-crafted reference art (one per piece).
- `assets/generate_models.py` / `generate_models_v2.py` — batch Tripo3D runners (`image_to_model`) that output into `assets/models/` or `assets/models/v2/`. These are **one-shot generation scripts** — not part of the build. Only run them when you want to regenerate a set, and note the Tripo API key is hardcoded in the scripts.
- `assets/audio/*.mp3` — all SFX + BGM. Referenced by `SoundEngine` by basename.
- `assets/textures/hyrule_map.png` — Gemini-generated floor texture under the board.

### Deployment
GitHub Pages, served from the `main` branch, root folder. **Do not disable GitHub Actions on this repo** — even though nothing in `.github/workflows` looks critical, disabling Actions silently breaks Pages auto-deploy (this has bitten us before). See `memory/actions_pages_coupling_2026-04-10.md`.

## Conventions & gotchas

- **Single-file philosophy**: prefer extending `index.html` over adding new script files. The only split is `net.js`, because online PvP is cleanly separable and can be stubbed out.
- **Three.js is r128 non-module**: CDN scripts create `THREE` on `window`. Do not introduce `import` statements — there's no bundler.
- **Row/col vs rank/file**: always `board[row][col]`, row 0 is where Ganon's pieces start. Conversion to Three.js world coords goes through `boardToWorld(row, col)` / `worldToBoard(pos)` — use them, don't inline the math.
- **Animation system**: moves use an `animateMove → executeMove → afterMove` pipeline. Never mutate `Chess.board` outside of `Chess.makeMove` — the render loop relies on `processAnimations()` to keep pieces in sync with chess state.
- **Online-game input gate**: during online play, clicks are blocked unless it's your turn. Don't bypass this — the net layer assumes moves only flow in one direction at a time.
- **Scene Editor persistence** lives at `localStorage['hyruleChess.sceneEditor.v1']`. If you see the game looking different than expected, check/clear this key before debugging `initThree()`.
- **Fallback pieces**: if a GLB is missing or fails to load, `ModelLoader.getModel()` returns `null` and `createPieceMesh()` falls back to a primitive `buildX()` builder. If you see cube/cylinder pieces instead of Zelda characters, the GLBs didn't load — check the server and the browser's Network tab.
