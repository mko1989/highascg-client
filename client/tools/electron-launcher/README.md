# HighAsCG Electron launcher

Operator **prep kit** (flash / exFAT guides) plus **embedded control UI** (`dist-web/`).

The playout machine runs **API only** (`HIGHASCG_HEADLESS=true`). This app hosts the Web UI and points it at the server with `window.__HIGHASCG_API_ORIGIN__`.

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

**Start Simulation** spawns a headless local API (`HIGHASCG_HEADLESS=true`, `launch-sim-from-exfat.js`) and opens the embedded UI against `http://127.0.0.1:<port>`.

## Packaging

```bash
npm run launcher:prepare
npm run build:launcher
```

See [`not-needed/docs/PLAN_SERVER_CLIENT_SPLIT.md`](../../../not-needed/docs/PLAN_SERVER_CLIENT_SPLIT.md).
