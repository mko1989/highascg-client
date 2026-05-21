# Not needed for client development

Everything here belonged to the **playout server**, ISO/eggs build, smoke tests, Caspar templates, and legacy monolith workflows. The operator **browser UI** and **Electron launcher** live at the repo root in [`client/`](../client/).

Use this tree only when you work on the Node API, Linux image, or full-stack deploy — not for day-to-day UI changes.

| Moved path | Role |
|------------|------|
| `index.js`, `src/` | Node server (AMCP, REST, WebSocket) |
| `config/`, `template/` | Runtime settings, Caspar HTML templates |
| `scripts/` | systemd, installer, exFAT server update |
| `tools/` | smoke, eggs, runtime, server/launcher release scripts |
| `docs/`, `work/` | architecture docs and work orders |
| `deprecated/`, `web/` | legacy assets |
| `client-scripts/` | `dev-push.sh` server deploy (was `client/scripts/`) |

Server dev: use `not-needed/index.js` with the server `package.json` from git history, or a separate server checkout. This folder is not wired to `npm start` at the client repo root.

Client dev (repo root):

```bash
npm run dev:client
npm run launcher
```
