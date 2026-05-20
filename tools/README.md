# Backend tools (minimal)

Production playout host and **eggs ISO build** only. Development smoke tests, client launchers, and legacy helpers live elsewhere.

| Path | Purpose |
|------|---------|
| [`runtime/`](runtime/) | Playout helpers shipped in server releases (`exfat-sync-cli`, Caspar staged start) |
| [`eggs/`](eggs/) | penguins-eggs / live USB image prep (`live-usb/`, `verify-w02-structure.js`) |
| [`release/`](release/) | `release:github-server` — backend tarball |
| [`smoke/`](smoke/) | All HTTP/AMCP/unit smoke tests (`npm run smoke`, `npm run test:*`) |

**Client / operator:** [`../client/tools/`](../client/tools/)  
**Deprecated:** [`../deprecated/`](../deprecated/)

```bash
npm run verify:structure
npm run eggs:prepare    # sudo — WO-47 clone prep on build host
npm run eggs:build      # sudo — eggs produce
npm run release:github-server
```
