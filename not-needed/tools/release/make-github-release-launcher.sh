#!/usr/bin/env bash
# Electron operator launcher GitHub prerelease (prep kit + embedded dist-web/).
#
# Usage (repo root):
#   npm run release:github-launcher
#   npm run release:github-launcher:dry
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-lib.sh
source "${SCRIPT_DIR}/release-lib.sh"

REPO_ROOT="$(release_lib_repo_root)"
DRY_RUN=0
TAG=""
REPLACE_RELEASE=0
OUT_DIR=""
SKIP_PREPARE=0

usage() {
	sed -n '2,/^set -euo/p' "$0" | head -n -1 | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	-h | --help) usage 0 ;;
	--dry-run) DRY_RUN=1 ;;
	--tag)
		TAG="${2:?}"
		shift
		;;
	--replace) REPLACE_RELEASE=1 ;;
	--out-dir)
		OUT_DIR="${2:?}"
		shift
		;;
	--no-prepare) SKIP_PREPARE=1 ;;
	*)
		echo "Unknown option: $1" >&2
		usage 1
		;;
	esac
	shift || true
done

STAMP="$(release_lib_stamp)"
if [[ -z "${TAG}" ]]; then
	TAG="$(release_lib_stamp_tag "$STAMP")"
	TAG="${TAG%Z}"
	TAG="launcher_${TAG}"
fi

DIST="${OUT_DIR:-${REPO_ROOT}/dist}"
LAUNCHER_DIR="${REPO_ROOT}/client/tools/electron-launcher"
ARCHIVE_BASENAME="highascg-launcher_${STAMP}"
ARCHIVE_PATH="${DIST}/${ARCHIVE_BASENAME}.tar.gz"
mkdir -p "$DIST"

if [[ "$DRY_RUN" -eq 0 ]]; then
	release_lib_need_cmd tar
	release_lib_check_gh
fi

if [[ "$SKIP_PREPARE" != "1" && "$DRY_RUN" != "1" ]]; then
	echo "==> launcher:prepare (Vite + sync dist-web)"
	(cd "$REPO_ROOT" && npm run launcher:prepare)
fi

build_launcher_archive() {
	if [[ ! -f "${LAUNCHER_DIR}/dist-web/index.html" ]]; then
		echo "Missing ${LAUNCHER_DIR}/dist-web/index.html — run: npm run launcher:prepare" >&2
		exit 1
	fi
	if [[ "$DRY_RUN" -eq 1 ]]; then
		echo "[dry-run] would pack ${LAUNCHER_DIR} → $ARCHIVE_PATH"
		return 0
	fi
	rm -f "$ARCHIVE_PATH"
	echo "==> Launcher tarball → $ARCHIVE_PATH"
	tar -C "$REPO_ROOT/client/tools" -czf "$ARCHIVE_PATH" \
		--exclude='electron-launcher/node_modules' \
		electron-launcher
	echo "==> Ready: $(du -h "$ARCHIVE_PATH" | cut -f1)  $ARCHIVE_PATH"
}

build_launcher_archive

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT

cat >"$NOTES" <<EOF
## HighAsCG launcher (${STAMP})

Electron **prep kit** + embedded \`dist-web/\` (control UI).

| Step | Command |
|------|---------|
| Extract | \`tar -xzf ${ARCHIVE_BASENAME}.tar.gz\` → \`electron-launcher/\` |
| Run | \`cd electron-launcher && npm install electron && npx electron --no-sandbox .\` |
| Or from full repo | \`npm run launcher\` after clone |

Set playout **API host** + port in the launcher, then **Open Control UI (embedded)**.

Requires headless server on playout (\`HIGHASCG_HEADLESS=true\`).

[\`client/tools/electron-launcher/README.md\`](client/tools/electron-launcher/README.md)
EOF

if [[ "$DRY_RUN" -eq 1 ]]; then
	echo "Tag: $TAG"
	echo "Archive: $ARCHIVE_PATH"
	cat "$NOTES"
	exit 0
fi

release_lib_check_asset_size "launcher tarball" "$ARCHIVE_PATH"
release_lib_ensure_release_tag "$REPO_ROOT" "$TAG" "$REPLACE_RELEASE"
release_lib_create_prerelease "$REPO_ROOT" "$TAG" "Launcher ${STAMP}" "$NOTES" "$ARCHIVE_PATH"
echo "Local tarball: $ARCHIVE_PATH"
