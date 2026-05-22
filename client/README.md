# HighAsCG client

Static **HTML / CSS / ES modules** — the operator UI (dashboard, scenes, device view, timeline, settings).

| Entry / area | Path |
|--------------|------|
| Document shell | `index.html` |
| App bootstrap | `app.js` |
| API origin | `lib/api-origin.js` |
| API + WebSocket clients | `lib/api-client.js`, `lib/ws-client.js` |
| Global styles | `styles.css`, `styles/*.css` |
| Components | `components/*.js` |
| Assets | `assets/`, `fonts/` |

## Split dev (recommended)

API and UI run on different ports. See [`not-needed/docs/PLAN_SERVER_CLIENT_SPLIT.md`](../not-needed/docs/PLAN_SERVER_CLIENT_SPLIT.md).

```bash
# Playout / API host
npm start

# Operator machine — UI (Vite :4350 → API via VITE_HIGHASCG_API_ORIGIN)
npm run dev:client
```

Open **http://localhost:4350/** (or your LAN IP when Vite uses `host: true`). Copy `.env.development.example` → `.env.development`; set `VITE_HIGHASCG_API_ORIGIN` to the playout host (e.g. `http://192.168.0.2:4200`).

## Production operator path

UI is hosted by the [**Electron launcher**](tools/electron-launcher/) (`npm run launcher`), not by the playout server. The launcher sets `window.__HIGHASCG_API_ORIGIN__` to the playout host (e.g. `http://192.168.0.10:4200`).

## Legacy monolith (deprecated)

```bash
npm run start:monolith   # legacy — server also serves client/ or dist-web/
```

## Build

`npm run build:client` → `dist-web/` (packaged in Electron / `release:github-client`).

Caspar HTML templates for playout live in [`../not-needed/template/`](../not-needed/template/) (served from the **API** host at `/templates/`).
