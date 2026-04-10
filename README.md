# Hyrule Chess

A 3D chess game themed around The Legend of Zelda — Hyrule vs Ganon's Forces. Single-file Three.js, no build step, GLB piece models generated via Tripo3D from hand-crafted reference art.

![](screenshots/polish_final.png)

## Running the game

The game loads `.glb` models via `fetch()`, which browsers block on `file://` URLs. **You must run a local server** — otherwise you'll see the geometric fallback pieces (cylinders/spheres/cones) instead of the actual models.

```bash
./run.sh
```

That script starts `python3 -m http.server 8765` and opens `http://localhost:8765/index.html` in your default browser. Press **Ctrl+C** to stop.

If `run.sh` can't find a free port, set one manually:

```bash
PORT=9000 ./run.sh
```

Requirements: `python3` (shipped with macOS/Linux).

## Modes

- **Player vs Player** — local hotseat
- **Player vs CPU** — you play Hyrule, CPU plays Ganon
  - Courage: depth 2 (easiest)
  - Wisdom: depth 3
  - Power: depth 4 (hardest)

## Controls

- **Click** a piece to select, then click a highlighted tile to move
- **Drag** with the mouse to orbit the camera, scroll to zoom
- **E** — toggle the **Scene Editor** (tune lights, tone mapping, fog, bloom live)
- **Esc** — return to main menu (during a game)

## Scene Editor

Press **E** during a game to open the Scene Editor. You can tune every light, the tone-mapping curve, fog density, and the bloom post-process in real time.

Once you're happy with the look:

1. Click **Copy as JS** — the panel dumps the current lighting config to the clipboard as JavaScript
2. Paste it into `index.html` (replace the existing values in `initThree()`)
3. Commit

Settings are also auto-saved to `localStorage` so the next reload picks up your tweaks without editing the source.

## Project layout

```
index.html              — the entire game (Three.js r128 from CDN)
run.sh                  — local dev server launcher
assets/
  models/*.glb          — Tripo3D-generated 3D piece models
  references/*.png      — reference art used to generate the models
  textures/hyrule_map.png — Gemini-generated Hyrule map (floor)
  generate_models.py    — batch Tripo3D runner
docs/superpowers/specs/ — design docs
plans/                  — implementation plans
```

## Tech stack

- **Three.js r128** (CDN, non-module scripts)
- **GLTFLoader** for piece models
- **EffectComposer + UnrealBloomPass** for post-processing
- Vanilla JS — no bundlers, no frameworks
- Google Fonts: MedievalSharp for fantasy UI
