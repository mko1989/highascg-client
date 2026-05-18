# Release tooling

| Script | Purpose |
|--------|---------|
| [`make-dev-github-release.sh`](./make-dev-github-release.sh) | Build (optional) Eggs ISO + gzip tarball of full HighAsCG → **`gh release create`** prerelease with both assets. |
| [`make-dev-github-release-iso-quick.sh`](./make-dev-github-release-iso-quick.sh) | Fast path: prepare Eggs clone + `eggs produce` only (used with `--quick-iso` on the main script). |

**Runbook:** [`docs/DEV_RELEASE_GITHUB.md`](../../docs/DEV_RELEASE_GITHUB.md)

**NPM:** `npm run release:dev-github` · `npm run release:dev-github:dry`
