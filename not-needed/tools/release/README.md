# Release tooling

| Script | Purpose |
|--------|---------|
| [`make-dev-github-release.sh`](./make-dev-github-release.sh) | **Full:** Eggs ISO + tarball → **`gh release create`** (**`npm run release:dev-github`**). **App-only:** tarball only → prerelease (**`npm run release:github-app`**, **`--app-only`**, tags default `alpha_…`). |
| [`make-dev-github-release-iso-quick.sh`](./make-dev-github-release-iso-quick.sh) | Fast path: prepare Eggs clone + `eggs produce` only (used with `--quick-iso` on the main script). |
| [`make-github-release-server.sh`](./make-github-release-server.sh) | **Server only:** `src/`, `index.js`, `config/`, `tools/`, … — tag `server_…` (**`npm run release:github-server`**). |
| [`make-github-release-client.sh`](./make-github-release-client.sh) | **Frontend only:** Vite `dist-web/` — tag `client_…` (**`npm run release:github-client`**). |

**Runbook:** [`docs/DEV_RELEASE_GITHUB.md`](../../docs/DEV_RELEASE_GITHUB.md)

**NPM**

- **Split:** `release:github-server` · `release:github-client` (and `:dry` variants)
- **Monolith:** `release:github-app` (builds `dist-web/`, omits `client/` sources) / `release:dev-github`

**Shared layout:** [`scripts/archive-common.sh`](../../scripts/archive-common.sh) — server at repo root (`src/`), UI in `client/` / `dist-web/`
- **Operator:** `npm run operator-kit`
