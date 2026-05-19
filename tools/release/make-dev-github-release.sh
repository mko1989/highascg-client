#!/usr/bin/env bash
# Dev release: Eggs ISO (WO-47 excludes via prepare-eggs scripts) + full HighAsCG .tar.gz → GitHub prerelease assets.
#
# Usage (repo root):
#   ./tools/release/make-dev-github-release.sh
#   ./tools/release/make-dev-github-release.sh --dry-run
#   npm run release:github-app
#   npm run release:github-app:dry
#
# Options:
#   --no-iso                    Skip building ISO; still uploads latest ISO from /home/eggs/ if present.
#   --quick-iso                 eggs produce only (see make-dev-github-release-iso-quick.sh).
#   --full-iso                  Full build-highascg-egg.sh (default when building ISO).
#   --dry-run                   Print tag/ISO/archive/release notes only; no sudo/gh/tar upload.
#   --app-only                  No ISO / no eggs — publish HighAsCG .tar.gz only (default tag alpha_<date_time>Z). Includes node_modules unless --zip-exclude-node-modules.
#   --tag NAME                  Override auto tag (default: dev-<UTC> full run, alpha_<…> when --app-only).
#   --replace                   Delete existing release+tag before create.
#   --zip-with-git              Include .git in the tarball (flag name kept from zip era).
#   --zip-with-work             Include work/ in the tarball.
#   --zip-exclude-node-modules  Omit node_modules (smaller; run npm ci on stick after extract).
#   --out-dir DIR               Write .tar.gz elsewhere (default: dist/).
#
# Env:
#   BASENAME                  eggs ISO basename (default: highascg)
#   GITHUB_REPOSITORY         override owner/repo if not inferred from git remote
#   GH_TOKEN                  non-interactive gh (optional if gh logged in)
#   HIGHASCG_ISO              use this .iso path instead of find_latest_iso
#
# Documentation: docs/DEV_RELEASE_GITHUB.md
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../live-usb/flash-stick-common.sh
source "${REPO_ROOT}/tools/live-usb/flash-stick-common.sh"

BASENAME="${BASENAME:-highascg}"
SKIP_ISO=0
FULL_ISO_BUILD=1
DRY_RUN=0
TAG=""
ZIP_WITH_GIT=0
ZIP_WITH_WORK=0
ZIP_EXCLUDE_NODE_MODULES=0
OUT_DIR=""
REPLACE_RELEASE=0
APP_ONLY=0

usage() {
	sed -n '2,/^# Documentation:/p' "$0" | sed '/^$/d' | sed '/^# Documentation:/d' | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	-h | --help) usage 0 ;;
	--app-only)
		APP_ONLY=1
		SKIP_ISO=1
		;;
	--no-iso) SKIP_ISO=1 ;;
	--quick-iso | --minimal-iso) FULL_ISO_BUILD=0 ;;
	--full-iso) FULL_ISO_BUILD=1 ;;
	--dry-run) DRY_RUN=1 ;;
	--tag)
		TAG="${2:?}"
		shift
		;;
	--zip-with-git) ZIP_WITH_GIT=1 ;;
	--zip-with-work) ZIP_WITH_WORK=1 ;;
	--zip-exclude-node-modules) ZIP_EXCLUDE_NODE_MODULES=1 ;;
	--out-dir)
		OUT_DIR="${2:?}"
		shift
		;;
	--replace)
		REPLACE_RELEASE=1
		;;
	*)
		echo "Unknown option: $1" >&2
		usage 1
		;;
	esac
	shift || true
done

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
ZIP_BASENAME="highascg_${STAMP}"
if [[ -z "${TAG}" ]]; then
	if [[ "$APP_ONLY" -eq 1 ]]; then
		TAG="alpha_${STAMP/T/_}"
	else
		TAG="dev-${STAMP}"
	fi
fi
DIST="${OUT_DIR:-${REPO_ROOT}/dist}"
MAX_GITHUB_ASSET=$((2 * 1024 * 1024 * 1024 - 100 * 1024 * 1024))

mkdir -p "$DIST"

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "Missing command: $1" >&2
		exit 1
	}
}

if [[ "${SKIP_ISO}${DRY_RUN}" != "11" ]] && [[ "$SKIP_ISO" -eq 0 ]]; then
	if ! command -v sudo >/dev/null 2>&1; then
		echo "sudo required for ISO build." >&2
		exit 1
	fi
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
	need_cmd gh
	need_cmd tar
	gh auth status >/dev/null 2>&1 || {
		echo "gh not authenticated. Run: gh auth login" >&2
		exit 1
	}
fi

if [[ "$SKIP_ISO" -eq 0 ]]; then
	if [[ "$DRY_RUN" -eq 1 ]]; then
		echo "[dry-run] would build ISO ($([[ "$FULL_ISO_BUILD" -eq 1 ]] && echo full build-highascg-egg.sh || echo quick iso script))"
	else
		if [[ "$FULL_ISO_BUILD" -eq 1 ]]; then
			echo "==> Full ISO via build-highascg-egg.sh (sudo)"
			sudo env BASENAME="$BASENAME" bash "${REPO_ROOT}/tools/live-usb/build-highascg-egg.sh"
			# Eggs writes ISO under /home/eggs/mnt as root — unprivileged tarball/gh need read + dir traverse
			sudo chmod a+rx /home/eggs /home/eggs/mnt 2>/dev/null || true
			sudo find /home/eggs /home/eggs/mnt -maxdepth 1 -type f -name '*.iso' -exec chmod a+r {} \; 2>/dev/null || true
		else
			echo "==> Quick ISO via prepare + eggs produce only (sudo)"
			sudo env BASENAME="$BASENAME" bash "${REPO_ROOT}/tools/release/make-dev-github-release-iso-quick.sh"
			sudo chmod a+rx /home/eggs /home/eggs/mnt 2>/dev/null || true
			sudo find /home/eggs /home/eggs/mnt -maxdepth 1 -type f -name '*.iso' -exec chmod a+r {} \; 2>/dev/null || true
		fi
	fi
fi

ISO=""
HIGHASCG_ISO="${HIGHASCG_ISO:-}"
if [[ "$APP_ONLY" -eq 1 ]]; then
	ISO=""
	if [[ -n "${HIGHASCG_ISO}" ]]; then
		echo "[app-only] Ignoring HIGHASCG_ISO (${HIGHASCG_ISO}) — this release has no ISO asset." >&2
	fi
elif [[ -n "$HIGHASCG_ISO" ]]; then
	if [[ ! -f "$HIGHASCG_ISO" ]]; then
		echo "HIGHASCG_ISO not a file: $HIGHASCG_ISO" >&2
		exit 1
	fi
	ISO="$(realpath "$HIGHASCG_ISO")"
elif [[ "$SKIP_ISO" -eq 0 ]] || [[ "$DRY_RUN" -eq 1 ]]; then
	if ISO="$(find_latest_iso 2>/dev/null)" && [[ -n "$ISO" && -f "$ISO" ]]; then
		:
	elif [[ "$DRY_RUN" -eq 1 ]]; then
		ISO="/home/eggs/PLACEHOLDER.iso"
		echo "[dry-run] no *.iso under /home/eggs/ — placeholder in notes only"
	else
		echo "No ISO under /home/eggs/. Build failed." >&2
		echo "Tip: Eggs often writes to /home/eggs/mnt/*.iso ; ensure it is readable, or pass HIGHASCG_ISO=/path/to/file.iso." >&2
		exit 1
	fi
else
	ISO="$(find_latest_iso 2>/dev/null)" || {
		echo "--no-iso still requires an ISO under /home/eggs/ to upload alongside the tarball." >&2
		exit 1
	}
fi

ARCHIVE_PATH="${DIST}/${ZIP_BASENAME}.tar.gz"

build_archive() {
	local -a excludes=()
	[[ "$ZIP_WITH_GIT" -eq 0 ]] && excludes+=(--exclude="./.git")
	[[ "$ZIP_WITH_WORK" -eq 0 ]] && excludes+=(--exclude="./work")
	[[ "$ZIP_EXCLUDE_NODE_MODULES" -eq 1 ]] && excludes+=(--exclude="./node_modules")
	# Runtime / local workstation bulk (see .gitignore + WO-47 eggs fragment — not stick payload)
	excludes+=(
		--exclude="./media"
		--exclude="./_media"
		--exclude="./data"
		--exclude="./refs"
		--exclude="./bin"
		--exclude="./lib"
		--exclude="./cef-cache"
		--exclude="./log"
		--exclude="./core"
		--exclude="./dist"
		--exclude="./CasparCG_Enhanced-main"
		--exclude="./examples"
		--exclude="./samples"
		--exclude="./scratch"
		--exclude="./.reference"
		--exclude="./.cursor"
		--exclude="./.cursor-server"
		--exclude="./*.log"
		--exclude="./server.log"
		--exclude="./health.json"
		--exclude="./libndi.so.6"
		--exclude="./casparcg.config"
		--exclude="./highascg.config.json"
		--exclude="./highascg.config.json.bak"
		--exclude="./autosave.json"
		--exclude="./*.pyc"
		--exclude="./__pycache__"
	)

	if [[ "$DRY_RUN" -eq 1 ]]; then
		echo "[dry-run] would create $ARCHIVE_PATH from $REPO_ROOT (git=$ZIP_WITH_GIT work=$ZIP_WITH_WORK nm_excl=$ZIP_EXCLUDE_NODE_MODULES)"
		echo "[dry-run] excludes media/, dist/, bin/, lib/, logs, local config — includes node_modules by default"
		return 0
	fi
	rm -f "$ARCHIVE_PATH"
	echo "==> Compressing repo → $ARCHIVE_PATH (includes node_modules; excludes media/, dist/, bin/, lib/, …)"
	echo "    This can take several minutes; no progress line until tar finishes."
	tar -C "$REPO_ROOT" -czf "$ARCHIVE_PATH" "${excludes[@]}" .
	echo "==> Tarball ready: $(du -h "$ARCHIVE_PATH" | cut -f1)  $ARCHIVE_PATH"
}

build_archive

if [[ "$DRY_RUN" -eq 0 ]] && [[ -f "$ARCHIVE_PATH" ]]; then
	sz_arch=$(stat -c %s "$ARCHIVE_PATH")
	check_sz() {
		local label="$1" path="$2" s="$3"
		if ((s > MAX_GITHUB_ASSET)); then
			echo "ERROR: $label exceeds GitHub ~2 GiB asset limit: $path ($s bytes)" >&2
			echo "Try: --zip-exclude-node-modules; see docs/DEV_RELEASE_GITHUB.md" >&2
			exit 1
		fi
	}
	check_sz "tarball" "$ARCHIVE_PATH" "$sz_arch"
	if [[ "$APP_ONLY" -eq 0 ]] && [[ -n "$ISO" ]] && [[ -f "$ISO" ]]; then
		sz_iso=$(stat -c %s "$ISO")
		check_sz "ISO" "$ISO" "$sz_iso"
	fi
fi

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT

ZIP_NOTE="Includes **node_modules** (watch GitHub ~2 GiB per asset)."
[[ "$ZIP_EXCLUDE_NODE_MODULES" -eq 1 ]] && ZIP_NOTE="**node_modules** omitted — run \`npm ci\` in \`sim/highascg\` after extract."

if [[ "$APP_ONLY" -eq 1 ]]; then
	RELEASE_TITLE="Alpha ${STAMP/T/_}"
else
	RELEASE_TITLE="Dev ${STAMP}"
fi

if [[ "$APP_ONLY" -eq 1 ]]; then
	cat >"$NOTES" <<EOF
## Alpha app bundle (${STAMP})

Portable HighAsCG drop for **exFAT-first / modular workflows** (no Eggs ISO in this release).

| Asset | Purpose |
|-------|---------|
| \`${ZIP_BASENAME}.tar.gz\` | Extract to \`HIGHASCGEXF/sim/highascg\`: \`mkdir -p … && tar -xzf … -C …\`. ${ZIP_NOTE} |

Combine with your existing live USB image when ready; rebuild ISO / Eggs only when needed: \`npm run release:dev-github\`.

**Operators:** \`npm run operator-kit\` — [\`tools/operator-desktop/README.md\`](tools/operator-desktop/README.md); stick layout: [\`MANUAL_STICK_WINDOWS_MACOS.md\`](tools/live-usb/MANUAL_STICK_WINDOWS_MACOS.md).

Full runbook: [\`docs/DEV_RELEASE_GITHUB.md\`](docs/DEV_RELEASE_GITHUB.md).
EOF
else
	cat >"$NOTES" <<EOF
## Dev snapshot (${STAMP})

| Asset | Purpose |
|-------|---------|
| \`$(basename "$ISO")\` | Live USB image (penguins-eggs, \`--excludes static\`, WO-47). See [\`WO47_ISO_VS_EXFAT.md\`](docs/WO47_ISO_VS_EXFAT.md). |
| \`${ZIP_BASENAME}.tar.gz\` | \`mkdir -p sim/highascg && tar -xzf … -C sim/highascg\`. ${ZIP_NOTE} |

**Operator:** flash ISO → exFAT → extract tarball into \`sim/highascg\` → [\`Stick Studio\`](tools/stick-tools/README.md) or boot the live system.

Full runbook: [\`docs/DEV_RELEASE_GITHUB.md\`](docs/DEV_RELEASE_GITHUB.md).
EOF
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
	echo "Tag: $TAG"
	echo "Mode: $([[ "$APP_ONLY" -eq 1 ]] && echo app-only || echo full)"
	echo "ISO: ${ISO:-(none)}"
	echo "Tarball: $ARCHIVE_PATH"
	cat "$NOTES"
	exit 0
fi

if ( cd "$REPO_ROOT" && gh release view "$TAG" >/dev/null 2>&1 ); then
	if [[ "$REPLACE_RELEASE" -eq 1 ]]; then
		( cd "$REPO_ROOT" && ( gh release delete "$TAG" --yes --cleanup-tag 2>/dev/null || gh release delete "$TAG" --yes ) )
	else
		echo "Release tag $TAG already exists. Use --replace to delete & recreate, or pass --tag <new>." >&2
		exit 1
	fi
fi

if [[ "$APP_ONLY" -eq 1 ]]; then
	( cd "$REPO_ROOT" &&
		gh release create "$TAG" \
			--prerelease \
			--title "$RELEASE_TITLE" \
			--notes-file "$NOTES" \
			"$ARCHIVE_PATH" )
else
	( cd "$REPO_ROOT" &&
		gh release create "$TAG" \
			--prerelease \
			--title "$RELEASE_TITLE" \
			--notes-file "$NOTES" \
			"$ISO" \
			"$ARCHIVE_PATH" )
fi

owner_repo="$(cd "$REPO_ROOT" && gh repo view --json nameWithOwner -q .nameWithOwner)"
base_url="$(cd "$REPO_ROOT" && gh repo view --json url -q .url)"
echo ""
echo "Release: ${base_url}/releases/tag/${TAG}  (${owner_repo})"
echo "Local tarball: $ARCHIVE_PATH"
