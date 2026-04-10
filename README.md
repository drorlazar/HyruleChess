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
- **Play Online** — two friends on separate networks, one creates a room and shares the code, the other joins. Each player enters a name (persisted across sessions). Supports resign, rematch, and reconnect-with-replay (refresh your tab mid-game and pick up where you left off).

## Controls

- **Click** a piece to select, then click a highlighted tile to move
- **Drag** with the mouse to orbit the camera, scroll to zoom
- **E** — toggle the **Scene Editor** (tune lights, tone mapping, fog, bloom live)
- **Esc** — return to main menu (during a game)

## Play Online — one-time setup

Online PvP uses **Firebase Realtime Database** (free tier, no backend code on your side). You need to create a Firebase project once and paste the config into `net.js`. The API key is not a secret — it only identifies your project to Google, and security is enforced by Database Rules (which you'll paste below).

### Part A — Firebase project (~7 min)

1. Go to https://console.firebase.google.com → **Add project** → name it e.g. `zelda-chess` → disable Analytics → **Create project**
2. Left sidebar → **Build → Realtime Database** → **Create Database** → any region (e.g. `us-central1`) → **Start in locked mode**
3. Switch to the **Rules** tab and paste this exactly, then **Publish**:
   ```json
   {
     "rules": {
       "rooms": {
         "$roomCode": {
           ".read": true,
           ".write": true,
           ".validate": "$roomCode.length >= 4 && $roomCode.length <= 8"
         }
       }
     }
   }
   ```
4. Gear icon (top-left) → **Project settings** → scroll to "Your apps" → click the `</>` (Web) icon → nickname `zelda-chess-web` → **do not** check "Firebase Hosting" → **Register app**
5. Copy the displayed `firebaseConfig` object. Open `net.js` in this repo and paste the values into the `FIREBASE_CONFIG` block at the top (replacing `PASTE_HERE`, `your-project`, etc.). Save.

That's it. Commit `net.js` if you want the values to ship with the deployed site.

### Part B — Deploy to GitHub Pages (~3 min)

1. Push this repo to GitHub if you haven't yet:
   ```bash
   gh repo create zledaChess --public --source=. --push
   ```
2. Repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main`, Folder: `/ (root)` → **Save**
3. Wait ~30 seconds. Your site will be at `https://<your-user>.github.io/zledaChess`
4. Open that URL on two phones (can be on different networks — cellular + WiFi works) and play

### Using it

- Click **Play Online** in the main menu
- Enter your name (it's remembered across sessions, editable any time)
- Click **Create Room** — you'll see a 5-character code. Share it with your friend any way you like (SMS, WhatsApp, shouting)
- Your friend clicks Play Online → Join Room → types the code → you're in
- One of you plays Hyrule (room creator), the other plays Ganon
- Both of you see your own pieces at the bottom of the screen (the black player's camera flips to their side)
- HUD header shows `You vs Friend`, turn indicator says `Your Turn` / `Friend's Turn`

### Reconnect

If you refresh your tab or close the app mid-game, reopen the site and click **Play Online**. A **"Resume room XYZ12"** button appears — click it to rejoin the same game at the current position.

### Troubleshooting

- **"Online play not configured"** — you haven't pasted the Firebase config into `net.js` yet. See Part A.
- **"Room not found"** — typo in the code, or the room was never created, or both players closed the tab and it expired.
- **Nothing happens when I click moves** — it's your opponent's turn. The input gate blocks clicks until it's your turn.
- **Moves feel slow** — Firebase Realtime DB has sub-second latency worldwide. If you see multi-second delays, check your network or the Firebase console (Usage tab).

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
net.js                  — online-PvP client (Firebase Realtime DB)
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
- **Firebase Realtime Database** (compat UMD from gstatic CDN) for online PvP
- Vanilla JS — no bundlers, no frameworks
- Google Fonts: MedievalSharp for fantasy UI
