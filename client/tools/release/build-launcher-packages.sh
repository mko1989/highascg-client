#!/usr/bin/env bash
# Build multi-platform Electron launcher folders under dist/launcher-pack/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-lib.sh
source "${SCRIPT_DIR}/release-lib.sh"

REPO_ROOT="$(release_lib_repo_root)"
LAUNCHER_DIR="${REPO_ROOT}/client/tools/electron-launcher"
PACK_OUT="${1:-${REPO_ROOT}/dist/launcher-pack}"
SKIP_PREPARE="${SKIP_PREPARE:-0}"

release_lib_need_cmd node
release_lib_need_cmd npx

if [[ "$SKIP_PREPARE" -eq 0 ]]; then
	echo "==> launcher:prepare (Vite + dist-web sync)"
	(cd "$REPO_ROOT" && npm run launcher:prepare)
fi

if [[ ! -f "${LAUNCHER_DIR}/dist-web/index.html" ]]; then
	echo "Missing launcher dist-web — run npm run launcher:prepare" >&2
	exit 1
fi

ELECTRON_VER="$(node -e "console.log(require('${REPO_ROOT}/node_modules/electron/package.json').version)")"
echo "==> @electron/packager (electron ${ELECTRON_VER})"
mkdir -p "$PACK_OUT"
rm -rf "${PACK_OUT:?}/"*

npx --yes @electron/packager@18.3.5 "$LAUNCHER_DIR" HighAsCG-Launcher \
	--out="$PACK_OUT" \
	--overwrite \
	--electron-version="$ELECTRON_VER" \
	--platform=darwin,linux,win32 \
	--arch=x64,arm64 \
	--darwin-dark-mode-support \
	--prune=true

echo "==> Packaged apps:"
find "$PACK_OUT" -maxdepth 1 -mindepth 1 -type d -print
