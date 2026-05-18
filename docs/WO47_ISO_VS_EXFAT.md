# WO‑47: What stays in the Eggs squashfs vs what rides on exFAT

This matches **`tools/live-usb/penguins-eggs-exclude-highascg-fragment.list`** and the boot chain **`highascg-exfat-bootstrap`** → **`highascg-exfat-sync`** → **`highascg.service`**.

## Intended layout on the ISO (minimal “Caspar shell”)

Keep these under **`/home/casparcg/highascg`** in the clone source so live/Caspar starts:

| Path | Purpose |
|------|---------|
| **`bin/`** | Site / helper binaries (optional; Caspar may expect scripts here) |
| **`cef-cache/`** | Empty in image; Caspar recreates at runtime |
| **`config/`** | **`casparcg.config`** at minimum — trim other JSON before **`eggs produce`** if you want modular HighAsCG config only on exFAT |
| **`data/`** | Empty stub |
| **`lib/`** | **`libndi.so`** copies etc. (Phase 3 installer) |
| **`log/`** | Empty stub |
| **`media/`** | Empty stub (WO‑47 bind mounts **`exfat/media`** → **`media/exfat`** when present) |
| **`template/`** | Empty stub unless your Caspar config references templates in-tree |

**Openbox** autostart still **`cd /home/casparcg/highascg`** for Caspar + scanner.

## Omitted from squashfs (restored from stick)

These paths are **excluded** from the snapshot and are expected from **`/home/casparcg/exfat/sim/highascg/`** when the operator stick is present:

- **`examples/`**, **`node_modules/`**, **`samples/`**, **`scratch/`**, **`scripts/`**, **`src/`**, **`tools/`**, **`web/`**, **`work/`**
- Root **`package.json`**, **`package-lock.json`**, **`index.js`**, etc. (see fragment list)
- **`media/`**, **`log/`**, **`cef-cache/`**, **`data/`** **contents** (mount stubs stay empty in ISO)

**First boot with stick:** **`highascg-exfat-bootstrap.service`** runs **`rsync`** from **`sim/highascg/`** into **`~/highascg/`** if **`package.json`** is **missing** on the root tree, using **`/etc/highascg/bootstrap-rsync-excludes.txt`** so ISO files **`config/casparcg.config`**, **`lib/`**, and runtime dirs are **not** overwritten from the stick.

Then **`highascg-exfat-sync.service`** runs **`node tools/exfat-sync-cli.js`** (mtime rules in **`/etc/highascg/exfat-sync.json`**).

## Safeguards (knobs)

| File / env | Effect |
|------------|--------|
| **`/etc/highascg/disable-exfat-bootstrap`** | Skip rsync seed entirely |
| **`/etc/highascg/force-exfat-bootstrap-once`** | Next boot: re-run seed even if **`package.json`** exists (file deletes itself) |
| **`HIGHASCG_BOOTSTRAP_DRY_RUN=1`** in unit drop-in | Log only (testing) |
| **`ConditionPathExists=…/package.json`** on **`highascg.service`** | Node app does not start until tree exists (**`scripts/write-highascg-systemd-unit.sh`**) |

## Operator workflow

1. Build host: **`sudo bash tools/live-usb/prepare-eggs-clone-with-exfat.sh`** — installs bootstrap + excludes merge + WO‑47 units into **`/`**  
2. Eggs **`--clone`**: squashfs honors **`exclude.list`** fragment (re-merge after editing the fragment: remove the marked block in **`/etc/penguins-eggs.d/exclude.list`**, then rerun **`merge-penguins-eggs-exclude-highascg.sh`**).  
3. Stick: **`sim/highascg`** holds sources (and usually **`package-lock.json`**). **`node_modules`** is typically **not** synced (excluded in **`exfat-sync.json`** and often absent on the stick); run **`npm ci`** once on the playout machine **after** bootstrap (or bake **`node_modules`** on the stick only if you accept the size).  
4. Boot with **`HIGHASCGEXF`**: bootstrap seeds if **`package.json`** was missing on **`~/highascg`**, sync runs when **`tools/exfat-sync-cli.js`** exists, **`highascg.service`** starts when **`package.json`** is present.  

## Prerequisites on image

**`rsync`** must be installed ( **`prepare-eggs-clone-with-exfat.sh`** installs **`rsync`** alongside **`parted`** / **`exfatprogs`**).
