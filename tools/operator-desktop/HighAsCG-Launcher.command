#!/bin/bash
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
if npm run launcher; then
  echo "Electron launcher closed successfully."
else
  echo "Electron launcher failed. Falling back to Python legacy launcher..."
  exec python3 tools/operator-desktop/highascg-launcher.py
fi
