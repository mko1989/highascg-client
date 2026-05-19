# Release tooling

| Script | Purpose |
|--------|---------|
| [`make-dev-github-release.sh`](./make-dev-github-release.sh) | **Full:** Eggs ISO + tarball → **`gh release create`** (**`npm run release:dev-github`**). **App-only:** tarball only → prerelease (**`npm run release:github-app`**, **`--app-only`**, tags default `alpha_…`). |
| [`make-dev-github-release-iso-quick.sh`](./make-dev-github-release-iso-quick.sh) | Fast path: prepare Eggs clone + `eggs produce` only (used with `--quick-iso` on the main script). |

**Runbook:** [`docs/DEV_RELEASE_GITHUB.md`](../../docs/DEV_RELEASE_GITHUB.md)

**NPM:** **`npm run release:github-app`** / **`release:github-app:dry`** (alpha / tarball-only) · `npm run release:dev-github` (full Eggs ISO + tarball — rare) · `release:dev-github:dry` · **`npm run operator-kit`**
