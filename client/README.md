# HighAsCG client

Static **HTML / CSS / ES modules** — the operator UI (dashboard, scenes, device view, timeline, settings).

| Entry / area | Path |
|--------------|------|
| Document shell | `index.html` |
| App bootstrap | `app.js` |
| Global styles | `styles.css`, `styles/*.css` |
| Components | `components/*.js` |
| API + WebSocket clients | `lib/*.js` |
| Assets | `assets/`, `fonts/` |

## Run with the server (default)

From repo root:

```bash
npm start
```

Open the URL printed by the server (e.g. `http://127.0.0.1:8080/`). The server serves `client/` (or `dist-web/` when built) unless `HIGHASCG_HEADLESS=true`.

## Dev: Vite + API proxy

```bash
npm run dev:client   # port 3000 → proxies /api to server (see vite.config.js)
# in another terminal:
npm start
```

Optional production bundle: `npm run build:client` → `dist-web/`.

Caspar HTML templates for playout live in [`../template/`](../template/) (not part of this SPA).

Server: [`../index.js`](../index.js), [`../src/`](../src/).
