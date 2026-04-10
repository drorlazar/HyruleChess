#!/usr/bin/env bash
# Hyrule Chess — local dev server
#
# The game loads .glb piece models via fetch(), which browsers block over
# file:// URLs. This script starts a tiny HTTP server and opens the game.

set -e
cd "$(dirname "$0")"

PORT="${PORT:-8765}"

# Kill any previous server on the same port (ignore failures)
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PID="$(lsof -ti:$PORT || true)"
  if [ -n "$EXISTING_PID" ]; then
    echo "Stopping previous server on port $PORT (pid $EXISTING_PID)…"
    kill "$EXISTING_PID" 2>/dev/null || true
    sleep 0.3
  fi
fi

URL="http://localhost:$PORT/index.html"
echo "Starting Hyrule Chess at $URL"
echo "Press Ctrl+C to stop."

# Open the browser shortly after the server starts
(
  sleep 0.6
  if [ "$(uname)" = "Darwin" ]; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  fi
) &

# Foreground the server so Ctrl+C cleanly stops it
exec python3 -m http.server "$PORT"
