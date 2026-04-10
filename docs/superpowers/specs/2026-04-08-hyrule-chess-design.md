# Hyrule Chess — Design Spec
**Date:** 2026-04-08  
**Project:** zledaChess  

## Overview
Single-file 3D chess game (Three.js) themed around Legend of Zelda. Hyrule vs Ganon's Forces. PvP + vs CPU.

## Architecture
- Single `index.html`, Three.js r128 from CDN, no build tools
- Vanilla JS, no frameworks
- Google Fonts (MedievalSharp) for fantasy UI

## Game Modes
1. **PvP** — local hotseat, fixed camera, turn indicator
2. **vs CPU** — player=Hyrule, CPU=Ganon. Difficulties: Courage(d2), Wisdom(d3), Power(d4)

## Chess Engine
- 8x8 array board, pieces as `{type, color, hasMoved}`
- Pseudo-legal move gen → filter by check legality
- Special: castling (both sides), en passant, pawn promotion (UI dialog)
- Check/checkmate/stalemate detection
- Move history (algebraic notation)

## AI
- Minimax + alpha-beta pruning
- Piece values: P=100, N=320, B=330, R=500, Q=900, K=20000
- Piece-square tables for positional eval
- Move ordering: captures first (MVV-LVA), then positional
- setTimeout yield to prevent UI freeze

## Piece Mapping
| Role | Hyrule | Ganon |
|------|--------|-------|
| King | Link | Ganondorf |
| Queen | Zelda | Phantom Ganon |
| Bishop | Sage/Impa | Wizzrobe |
| Knight | Epona | Darknut |
| Rook | Hyrule Tower | Ganon's Tower |
| Pawn | Hylian Soldier | Moblin |

All pieces: Three.js primitives (Cylinder, Sphere, Cone, Box) with MeshStandardMaterial.

## Board
- Light tiles: #C8A96E (gold/sand), Dark tiles: #2D5016 (forest green)
- Wood frame: #3E2723, gold inlay
- Stone pedestal base
- File/rank labels as sprites

## Visual Effects
- Selection: golden emissive glow
- Valid moves: translucent green circles
- Check: red pulse on king square
- Capture: shrink + particles + fly to tray
- Movement: smooth lerp ~0.4s
- Ambient: golden dust motes
- Game start: pieces drop onto board
- Checkmate: particle celebration

## Lighting
- Warm ambient + directional (shadows) + hemisphere
- Sky gradient background
- Subtle fog

## UI Overlays
- Main menu: title, Triforce logo, mode buttons, difficulty
- HUD: turn indicator, captured pieces, move history
- Promotion dialog: 4 piece choices
- Game over: victory/defeat + replay options

## Sound
- Web Audio API oscillators: select chime, move whoosh, capture clash, check warning, checkmate fanfare

## Verification
- Open in Playwright, verify board renders, pieces clickable, moves execute, AI responds, game completes
