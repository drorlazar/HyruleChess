# HyruleChess UI/UX Design Principles Brief
**Source:** PA Bible (Playable Ads Bible, NotebookLM notebook `ad4d9ac7-92ba-4613-913d-2924f93bd3fd`)
**Date:** 2026-04-10
**Context:** 3D browser chess (Three.js, Zelda-themed). Redesigning HUD because opaque panels currently block the board. Target: non-obstructive, readable, mobile-first; graceful on desktop 16:9.

---

## 1. Non-Obstructive HUD Design

**Principle:** The HUD must be minimal, non-intrusive, and highly contextual. Default to showing nothing; earn every pixel.

- **Persistent vs. transient split:** Only truly always-needed info (turn indicator, clock) stays persistent. Everything else (last-move toast, check warning, capture popup) is transient — fades in, then fades out so it does not block the board.
- **Edge-hugging layout + safe zones:** Organize the screen into logical regions (top / center / bottom / sides). Keep crucial UI away from the outermost edges to dodge notches, rounded corners, and accidental touches.
- **Translucent panels, not solid:** Use semi-transparent panels so the 3D board remains legible through the HUD. PA Bible recommends "semi-transparent darkened overlay" to subtly dim the background while preserving 3D context. (It does not give exact CSS opacity numbers — a safe working range based on its guidance is roughly `rgba(0,0,0, 0.35-0.55)` with `backdrop-filter: blur(8-12px)`; validate by contrast ratio, see section 2.)
- **Center column = sacred:** The center of the viewport is for the board. No persistent UI overlaps it at any breakpoint.

Source: PA Bible — HUD/UI minimalism, safe zones, persistent vs transient patterns.

---

## 2. Readability Over 3D Scenes

**Principle:** WCAG contrast, firm minimum font sizes, bold numerical hierarchy.

- **WCAG contrast (non-negotiable):**
  - Normal text (<18pt): minimum **4.5:1** contrast against whatever the 3D scene shows behind it.
  - Large text (>=18pt): minimum **3:1**.
- **Font size floors (PA Bible hard numbers):**
  - Body text: **16px minimum**
  - Secondary text: **14-18px**
  - Headings: **18-24px**
  Apply these to both mobile and desktop; do not shrink below 14px on any device.
- **Make it survive a busy background:** Use contrasting colors, outlines/strokes, or a translucent darkened pill behind text. Combine at least two of (outline, shadow, blurred backdrop) because the 3D scene behind the text is variable.
- **Numerical hierarchy:** Numbers (score, move count, clock) should be visually stronger than their descriptive labels — bolder weight, larger size. Labels are the whisper; numbers are the voice.

Source: PA Bible — WCAG contrast, typography scale, hierarchy rules.

---

## 3. Mobile Portrait Layout (Board Games)

**Principle:** Everything is driven by the Thumb Zone — 75% of mobile input is thumb-based.

- **Three-zone map:**
  - **Natural Zone (bottom-center):** primary, frequent actions — e.g., "Confirm Move," resign-confirm, main CTA.
  - **Stretch Zone (mid-screen sides):** secondary navigation, side-rail toggles.
  - **Hard-to-Reach Zone (top corners):** non-interactive info (opponent name/timer, connection status) and rare/destructive actions (Quit, Settings).
- **Move history & captures = progressive disclosure:** Never persistent on mobile portrait. Collapsible bottom drawer or tab that pulls up on demand. Default state is closed.
- **Safe-area insets:** Respect iPhone notch and home indicator. Use `env(safe-area-inset-top/bottom/left/right)` and adapt margins accordingly.
- **Touch targets (mandatory minimums):**
  - Apple HIG: **44 x 44 pt**
  - Google Material: **48 x 48 dp**
  - Spacing between interactive elements: **minimum 8 dp** — prevents mis-taps.
- **Layout skeleton for portrait:**
  - Top bar (thin): opponent avatar + timer, connection status.
  - Center: the 3D board, unobstructed.
  - Bottom bar (thin): your avatar + timer, plus primary action (Confirm / Resign).
  - Drawer (collapsed by default): History + Captures.

Source: PA Bible — Thumb Zone, 44/48 minimum touch target, 8dp spacing, progressive disclosure, safe-area guidance.

---

## 4. Desktop 16:9 Layout (Board Games)

**Principle:** A square board in a widescreen frame leaves massive horizontal slack. Don't fight it — frame the board with it.

- **Letterbox Side Panels pattern:** Confine all UI to strict left and right vertical columns that frame the central 3D canvas. Applies Law of Proximity / Common Region — controls stay grouped, board stays pure.
- **Floating Cards pattern (immersive alternative):** For cinematic Zelda atmosphere, use semi-transparent floating cards in the side Stretch Zones instead of solid sidebars. Keeps the center column completely unobstructed.
- **Collapsible Rails:** Chat, detailed settings, full history start hidden as icons; expand on hover/click. Maximizes 3D viewport.
- **Critical rule:** The central column containing the board must never be cropped to make room for UI — if UI needs more space, the rails expand into horizontal slack, never into the board.

Source: PA Bible — Law of Proximity / Common Region, widescreen layout patterns.

---

## 5. Onboarding / Title Screen / Lobby

**Principle:** The 3-Second Rule — over 70% of users decide to engage or leave in under 3 seconds.

- **AOI (Area of Interest) cap: 2-3 elements max.** Hard limit. At 4-5 AOIs, drop-off increases massively.
- **Ideal hierarchy for HyruleChess title screen:**
  1. **Game logo (top)** — visual identity, the Zelda/Hyrule wordmark.
  2. **3D background (center)** — atmospheric hero, the board/characters in a Zelda scene.
  3. **"PLAY" CTA (bottom-center)** — single, bold, high-contrast button.
- **Center-placed CTA wins:** Players find centrally placed elements ~2x faster than top or bottom-edge elements. Put Play at or near center-bottom.
- **Instant clarity:** No manual required. The screen must communicate "this is chess; press Play" without reading.
- **Fast load:** Lobby should appear immediately; defer 3D asset loads to background where possible.

Source: PA Bible — 3-Second Rule, AOI limit, centered-CTA eye-tracking data.

---

## 6. Turn Indicator Patterns

**Principle:** No giant "YOUR TURN" banner. Use micro-interactions and environmental signals.

- **Dynamic lighting / halo:** Subtle localized halo of light around the active player's King or their half of the board. On turn change, interpolate lighting to the other side — the 3D scene itself becomes the indicator.
- **Micro-animation timing:** **200-300 ms** transition window. Active player's portrait gently scales up (squash-and-stretch), waiting player's portrait scales down and dims.
- **Color cues:** Subtle saturation/glow on active side; desaturate waiting side. Never color-only — pair with motion or lighting.
- **Game juice (audio + haptic):** Sync turn change to a distinct audio sting — a low "thud" or soft chime in the Zelda palette. Communicates state without forcing eye movement away from the board. On mobile, add a light haptic tap if available.
- **Directional hint:** Optional small arrow or pulse on the active player's avatar edge; never across the board itself.

Source: PA Bible — micro-interactions, 200-300 ms easing, game juice, audio/haptic proxies.

---

## 7. Move History & Captures Display

**Principle:** Progressive disclosure + chunking. Never show everything at once — it creates Choice Overload / Cognitive Load.

- **Progressive disclosure:** Show only what's critical now; defer the rest behind a tap.
- **Show-on-demand drawer:** History lives behind a "History" toggle in the side rail (desktop) or a bottom drawer (mobile). Tap to expand. Closed by default.
- **Chunking for captures:** Do not render five pawn icons. Render one pawn icon with a "x5" multiplier. Saves massive UI space and reads faster.
- **"Latest Move" Ghosting pattern:** Instead of requiring players to open a history panel for context, indicate the last move directly on the 3D board — a fading translucent trail from origin square to destination, or a soft glow on both squares for ~1.5-2 seconds. Gives immediate spatial context without any UI panel at all.
- **Compact algebraic format:** When the history drawer is opened, use tight two-column pairs ("1. e4 e5"), monospace, 14-16px — fits many moves in a small space.

Source: PA Bible — progressive disclosure, chunking, cognitive load, spatial UI patterns.

---

## Quick-Reference Numeric Cheat Sheet

| Rule | Value |
|---|---|
| Body text minimum | 16px |
| Secondary text | 14-18px |
| Heading text | 18-24px |
| Contrast (normal text) | 4.5:1 |
| Contrast (large text >=18pt) | 3:1 |
| Touch target (iOS) | 44 x 44 pt |
| Touch target (Android) | 48 x 48 dp |
| Touch target spacing | >=8 dp |
| Micro-interaction duration | 200-300 ms |
| Title screen AOI cap | 2-3 elements |
| Engagement window | <3 seconds |
| Thumb-driven interaction share | ~75% |

## Working Opacity / Backdrop Recommendations
*(Not explicit in PA Bible — derived from its "semi-transparent darkened overlay + high contrast" principle. Validate against the 4.5:1 contrast rule.)*

- Panel background: `rgba(0, 0, 0, 0.40-0.55)` over a mid-tone 3D scene.
- Backdrop blur: `backdrop-filter: blur(8-12px) saturate(1.1)`.
- Panel border: 1px with low-opacity accent (e.g. `rgba(255,255,255,0.12)`) for edge definition.
- Text over panel: near-white (`#F5F5F5` or brand accent gold) with a subtle 1-2px dark text-shadow for scenes where the blur is insufficient.

---

## Design Checklist for HyruleChess Redesign

- [ ] All UI lives in side rails (desktop) or thin top/bottom bars (mobile). Center column is board-only.
- [ ] Every panel is semi-transparent with backdrop blur, never solid.
- [ ] All text passes WCAG 4.5:1 (3:1 for large) against the worst-case board background.
- [ ] Move history and captures drawer is closed by default; opened on tap.
- [ ] Captured pieces use chunked icon + count format.
- [ ] Turn change uses lighting + micro-animation + audio sting. No banner.
- [ ] Title screen has exactly 3 AOIs: logo, 3D hero, Play CTA.
- [ ] Mobile: thumb-zone validated; 44pt/48dp touch targets; safe-area insets applied.
- [ ] Desktop: letterbox or floating-card pattern; board never cropped for UI.
- [ ] All interactive elements animate in 200-300 ms.
