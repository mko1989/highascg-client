# Dev GitHub releases (ISO + portable tarball)

Use this flow when you have a **build host or workstation** running the repo (typically with `node_modules` already installed), want a **matching Eggs ISO** (WO‑47 squashfs excludes) and a **frozen copy of HighAsCG** as a downloadable asset.

## What gets published

Every run creates:

| Asset | Produced by |
|-------|----------------|
| `highascg_*.iso` under `/home/eggs/` | **Full:** `sudo tools/live-usb/build-highascg-egg.sh` (**default**) — merges [`penguins-eggs-exclude-highascg-fragment.list`](../tools/live-usb/penguins-eggs-exclude-highascg-fragment.list) via `prepare-eggs-clone-with-exfat.sh`. **Quick:** `sudo tools/release/make-dev-github-release-iso-quick.sh` (`--quick-iso`) — smaller/faster churn for CI-ish builds. |
| `dist/highascg_<UTC>.tar.gz` | `tar -czf` of the repo (gzip-compressed tarball). **`tar`/`gzip`** are bundled with essentially every Linux install—no **`zip`** package needed. **Default archive includes `node_modules`** so the stick can boot simulation without reinstall. |

GitHub Releases have a soft **per-asset ~2 GiB** limit. If the tarball or ISO is too large, use `--zip-exclude-node-modules` and run `npm ci` inside `sim/highascg` after extract (legacy flag name still applies to the bundle).

## Prerequisites

1. **`gh`** installed and **`gh auth login`** finished for the repo you push to.
2. **`tar`** (with gzip compression, i.e. `-z`) — standard on Ubuntu/Debian. **`sudo`** for ISO build steps.
3. **penguins‑eggs** installed and configured enough for **`eggs produce`** on your host (same expectations as [**`BUILD_AND_FLASH.md`**](../tools/live-usb/BUILD_AND_FLASH.md)).
4. Repo root checkout (for `npm run …` wrappers below).

## Commands

Dry run (no sudo / no upload — prints tag, paths, draft release notes):

```bash
npm run release:dev-github:dry
```

Full dev prerelease (`--prerelease` on GitHub) with default full ISO:

```bash
npm run release:dev-github
```

Direct script equivalents:

```bash
./tools/release/make-dev-github-release.sh --dry-run
./tools/release/make-dev-github-release.sh
./tools/release/make-dev-github-release.sh --quick-iso --tag dev-smoke-$(date -u +%Y%m%d)
```

See `./tools/release/make-dev-github-release.sh --help` for every flag.

Useful variants:

| Need | Flags |
|------|--------|
| Rebuild tarball only; ISO already produced | `--no-iso` (still expects an ISO under `/home/eggs/` to attach). |
| Smaller archive | `--zip-exclude-node-modules` |
| Repeat same tag during testing | `--replace` |
| Custom output directory | `--out-dir /tmp/rel` |
| Historical source in archive | `--zip-with-git` and/or `--zip-with-work` |

## ISO discovery

The helper uses **`find_latest_iso`** from [`flash-stick-common.sh`](../tools/live-usb/flash-stick-common.sh) (same rule as flashing tools — typically **`/home/eggs/**/*.iso`** newest). Align **`BASENAME`** with Eggs output if you renamed the image.

## Operator path: Stick Studio + release tarball

Designed to match WO‑47: live system on hybrid ISO plus **`HIGHASCGEXF`** exFAT for data.

### 1. Download release assets

From the GitHub **Releases** page, download:

- The **ISO**.
- **`highascg_<timestamp>.tar.gz`** (unless you deliberately ship without `node_modules`).

### 2. Flash ISO and carve exFAT (desktop)

On a workstation with UI:

```bash
npm run stick-studio
```

Documentation: **`tools/stick-tools/README.md`**.

Rough order in the GUI:

1. Point **ISO** at the downloaded file and **whole-disk USB**.
2. Enable **Erase stick with ISO**, run **pkexec pipeline** (or flash first, then exFAT-only if you skipped dd).
3. Enable **Append exFAT … HIGHASCGEXF** where appropriate.
4. Mount the exFAT volume and set **mount path** in Stick Studio; enable **Ensure sim/highascg (+ operator dirs)**.

### 3. Lay out HighAsCG from the tarball

With the exFAT volume mounted at `<mount>`:

```bash
mkdir -p <mount>/sim/highascg
tar -xzf /path/to/highascg_<stamp>.tar.gz -C <mount>/sim/highascg
```

so that `<mount>/sim/highascg/package.json` exists.

**Stick Studio shortcut:** extract the tarball to a **temporary directory** on disk, then browse that **folder** as “Copy:” source and enable **Copy:** — this mirrors the tree into `sim/highascg` via `sync_tree` (destructive overwrite of matching names).

If the archive omitted `node_modules`:

```bash
cd /path/to/mounted/HIGHASCGEXF/sim/highascg
npm ci
```

(Use **`install:base`** / **`install:previs`** from `package.json` if you mirror production optional deps.)

### 4. Simulation mode

Stick Studio runs **`npm run portable:sim`** against the **HighAsCG repo path** configured at the top of the window (point this at your **local git checkout** on the workstation, not necessarily the stick copy). That script uses [`tools/portable-desktop/launch-sim-from-exfat.js`](../tools/portable-desktop/launch-sim-from-exfat.js) to drive simulation using exFAT paths.

For headless / CI testing, from a repo that has the same mount layout available:

```bash
npm run portable:sim
```

### 5. Reference docs

- [**`WO47_ISO_VS_EXFAT.md`**](WO47_ISO_VS_EXFAT.md) — split between squashfs and exFAT.
- [**`BUILD_AND_FLASH.md`**](../tools/live-usb/BUILD_AND_FLASH.md) — full build and flash runbook.
- [**`EXFAT_DATA_ZERO_TOUCH.md`**](../tools/live-usb/EXFAT_DATA_ZERO_TOUCH.md) — mount and data layout on the stick.

## Environment variables

| Variable | Role |
|----------|------|
| `BASENAME` | Passed to Eggs / build scripts (default `highascg`). |
| `GITHUB_REPOSITORY` | `owner/name` if `gh` cannot infer from `git remote`. |
| `GH_TOKEN` | Token for non-interactive `gh` (CI). |

## CI note

`eggs produce` and full ISO builds usually need **root** and a prepared Linux host. For GitHub Actions you may only run **`--dry-run`**, tarball-only steps, or attach prebuilt ISO artifacts; keep secrets (`GH_TOKEN`) in encrypted vars.
