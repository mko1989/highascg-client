# HighAsCG client

Operator **browser UI** and **Electron launcher** for a remote HighAsCG playout API (HTTP `/api/*`, WebSocket `/api/ws`). This repository does not include the Node server — that lives under [`not-needed/`](not-needed/) for ISO/server work.

## Layout

| Path | Role |
|------|------|
| [`client/`](client/) | Static ES modules: dashboards, scenes, device view, settings |
| [`client/tools/electron-launcher/`](client/tools/electron-launcher/) | Production UI host (`npm run launcher`) |
| [`vite.config.js`](vite.config.js) | Dev server :3000, build → `dist-web/` |
| [`not-needed/`](not-needed/) | Server, config, templates, eggs/smoke — not used for UI-only work |

## Requirements

- **Node.js** ≥ 20
- Running **playout API** on the LAN (default `http://<host>:4200`) for full behaviour

## Install

```bash
npm install
```

Copy [`.env.development.example`](.env.development.example) → `.env.development` and set `VITE_HIGHASCG_API_ORIGIN` to your playout host.

## Usage

| Command | Purpose |
|---------|---------|
| `npm run dev:client` | Vite on **:3000**, proxies `/api` to `VITE_HIGHASCG_API_ORIGIN` |
| `npm run build:client` | Production bundle in `dist-web/` |
| `npm run launcher` | Electron app (syncs `dist-web/` into launcher bundle) |
| `npm run release:github-client` | Pack `dist-web/` for GitHub |

Open **http://localhost:3000/** in dev, or use the launcher in production and set the playout API host in the launcher UI.

## API contract

The UI never opens AMCP directly. All playout, config, and state go through the server documented in [`not-needed/work/BACKEND_AND_CLIENT_SPLIT.md`](not-needed/work/BACKEND_AND_CLIENT_SPLIT.md).

Caspar HTML templates are served by the API at `/templates/` (sources under `not-needed/template/`).

More detail: [`client/README.md`](client/README.md).
