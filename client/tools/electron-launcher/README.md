# HighAsCG Electron launcher

Operator **prep kit** (flash / exFAT guides) plus **embedded control UI** (`dist-web/`).

The playout machine runs **API only** (`HIGHASCG_HEADLESS=true`). This app hosts the Web UI on port **4350** (`client/lib/webui-port.json`) and points it at the server with `window.__HIGHASCG_API_ORIGIN__`.

## Prepare UI bundle

From repo root:

```bash
npm run launcher:prepare   # build:client + sync dist-web/ here
npm run launcher
```

`sync-dist-web.sh` copies `dist-web/` into `client/tools/electron-launcher/dist-web/` for packaging.

## Connect to playout

1. Set **Playout API host** and **HTTP port** (default **4200**).
2. Click **Open Control UI (embedded)** — opens a second window (`highascg://app/…`).
3. Optional: **Open in system browser** — legacy; only works if the server still serves static files.

## Simulation

**Start Simulation** runs a local API child from the launcher bundle (`sim-server/`, synced from `not-needed/` via `launcher:prepare`) — **not** from the USB stick. Opens the embedded UI against `http://127.0.0.1:<port>`.

```bash
npm run launcher:prepare      # syncs dist-web + sim-server
npm run launcher:sim-install  # once per machine (npm install; no lockfile required)
npm run launcher              # from repo root — not from sim-server/
```

## Packaging

```bash
npm run launcher:prepare      # dist-web + lib + portable-sim + sim-server tree
npm run launcher:sim-install  # node_modules inside sim-server (required for sim in zip)
npm run build:launcher        # multi-platform folders under dist/launcher-pack/
```

**System Node.js is not required** on the operator machine. The zip ships **Electron** (Chromium + embedded Node for the prep UI). **Start Simulation** uses the same `HighAsCG-Launcher.exe` with `ELECTRON_RUN_AS_NODE=1` — still no separate Node install.

The packager only includes files under `client/tools/electron-launcher/` (see `sync-launcher-bundle.sh`). A dev checkout that never ran `launcher:prepare` will produce a broken zip (missing `lib/webui-port.cjs`, etc.).

See [`not-needed/docs/PLAN_SERVER_CLIENT_SPLIT.md`](../../../not-needed/docs/PLAN_SERVER_CLIENT_SPLIT.md).
