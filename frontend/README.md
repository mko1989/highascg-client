# HighAsCG frontend

Static **HTML / CSS / ES modules** — the operator UI (dashboard, scenes, device view, timeline, settings).

| Entry / area | Path |
|--------------|------|
| Document shell | `index.html` |
| App bootstrap | `app.js` |
| Global styles | `styles.css`, `styles/*.css` |
| Components | `components/*.js` |
| API + WebSocket clients | `lib/*.js` |
| Assets | `assets/`, `fonts/` |

## Run with the backend (default)

From repo root:

```bash
npm start
```

Open the URL printed by the server (e.g. `http://127.0.0.1:8080/`). The backend serves this folder as static files unless `HIGHASCG_HEADLESS=true`.

## Dev: Vite + API proxy

```bash
npm run dev:frontend   # port 3000 → proxies /api to backend (see vite.config.js)
# in another terminal:
npm start
```

Optional build output: `npm run build:frontend` → `dist-web/`.

Caspar HTML templates for playout live in repo [`../template/`](../template/) (not part of this SPA).

Server entry: [`../index.js`](../index.js), [`../src/`](../src/). WO‑23: `work/work-orders/23_WO_HTML_WEBPAGE_SOURCE.md`.
