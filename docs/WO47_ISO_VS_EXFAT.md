# WO‑47: What stays in the Eggs squashfs vs what rides on exFAT

This matches **`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`** and the boot chain **`highascg-exfat-server-update`** → **`highascg-exfat-sync`** → **`highascg.service`**.

**Server drops:** [`EXFAT_SERVER_UPDATE.md`](EXFAT_SERVER_UPDATE.md) (`exfat/update/server/` — contents of **`highascg-server_*.tar.gz`**, including **`tools/runtime/`** only).

## Intended layout on the ISO (minimal “Caspar shell”)

Keep these under **`/home/casparcg/highascg`** in the clone source so live/Caspar starts:

| Path | Purpose |
|------|---------|
| **`bin/`** | Site / helper binaries (optional; Caspar may expect scripts here) |
| **`cef-cache/`** | Empty in image; Caspar recreates at runtime |
| **`config/`** | **`casparcg.config`** at minimum |
| **`data/`** | Empty stub |
| **`lib/`** | **`libndi.so`** copies etc. (Phase 3 installer) |
| **`log/`** | Empty stub |
| **`media/`** | Empty stub (WO‑47 bind mounts **`exfat/media`** → **`media/exfat`** when present) |
| **`template/`** | Empty stub unless your Caspar config references templates in-tree |

**Openbox** autostart still **`cd /home/casparcg/highascg`** for Caspar + scanner.

## Omitted from squashfs (restored from stick)

Excluded from the snapshot; applied from **`exfat/update/server/`** when the stick is present:

- **`index.js`**, **`src/`**, **`scripts/`**, **`package.json`**, **`package-lock.json`**
- **`tools/`** (entire tree) — playout receives **`tools/runtime/`** only inside the server tarball (`exfat-sync-cli.js`, staged Caspar helpers)
- **`client/`**, **`dist-web/`**, **`work/`**, **`deprecated/`**, **`node_modules/`**, dev trees

**First boot / hotfix:** **`highascg-exfat-server-update.service`** rsyncs **`update/server/`** → **`~/highascg/`** when **`update/server/package.json`** exists (stops **`highascg.service`**, optional **`npm ci`**, archives drop to **`update/applied/<UTC>/`**).

Then **`highascg-exfat-sync.service`** runs **`node tools/runtime/exfat-sync-cli.js`** ( **`drop-config/`** mtime sync per **`/etc/highascg/exfat-sync.json`**).

Legacy **`highascg-exfat-bootstrap`** (`sim/highascg/`) is deprecated — do not rely on it for new sticks.

## Safeguards (knobs)

| File / env | Effect |
|------------|--------|
| **`/etc/highascg/disable-exfat-server-update`** | Skip server drop apply |
| **`/etc/highascg/disable-exfat-bootstrap`** | Skip legacy bootstrap (if unit still enabled) |
| **`HIGHASCG_SERVER_UPDATE_DRY_RUN=1`** | Log only (server update) |
| **`ConditionPathExists=…/package.json`** on **`highascg.service`** | Node app does not start until tree exists |

## Operator workflow

1. Build host: **`sudo npm run eggs:prepare`** (or **`sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh`**) — WO‑47 units + exclude merge  
2. Eggs **`--clone`**: squashfs honors **`exclude.list`** fragment (re-merge after edits: **`sudo bash tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh`**)  
3. Stick: extract **`highascg-server_*.tar.gz`** into **`update/server/`** (must include top-level **`package.json`**, **`src/`**, **`tools/runtime/`**, …)  
4. Client UI: separate Mac/Windows install or **`release:github-client`** — **not** on the playout stick  
5. Boot with **`HIGHASCGEXF`**: server-update applies when pending; sync runs when **`tools/runtime/exfat-sync-cli.js`** exists; **`highascg.service`** starts when **`package.json`** is present  

## Prerequisites on image

**`rsync`** must be installed (**`prepare-eggs-clone-with-exfat.sh`** installs **`rsync`**, **`parted`**, **`exfatprogs`**).
