# exFAT data volume — zero–hand-edit workflow (WO-47)

HighAsCG mounts cross-platform data at **`/home/casparcg/exfat`** by **volume label** `HIGHASCGEXF` (no UUID editing). **`mkfs.exfat`** accepts at most **11** characters for `-L`, so the label is kept short on purpose. **`scripts/install-exfat-systemd-units.sh`** writes **`home-casparcg-exfat.mount`**, **`highascg-exfat-media-prep.service`**, **`home-casparcg-highascg-media-exfat.mount`** (bind **`/home/casparcg/exfat/media` → `/home/casparcg/highascg/media/exfat`** when the data volume is present), and **`highascg-exfat-sync.service`** using the **`casparcg`** user’s **uid/gid** at install time. **`scripts/install-phase4.sh`** runs that installer when the app tree is present.

**Same label on every operator stick** lets the correct volume attach whether the machine boots from internal disk or from the USB: plug the stick **before** **`local-fs`** if you need it on HDD boots.

Boot order: **`home-casparcg-exfat.mount`** → **`highascg-exfat-media-prep.service`** → **`home-casparcg-highascg-media-exfat.mount`** (bind) → **`highascg-exfat-server-update.service`** (**`update/server/`** → **`~/highascg`**) → **`highascg-exfat-sync.service`** (**`drop-config/`** mtime sync; **skipped** if **`tools/runtime/exfat-sync-cli.js`** missing) → **`highascg.service`** (**`ConditionPathExists=package.json`**). Matrix: **[`docs/WO47_ISO_VS_EXFAT.md`](../../docs/WO47_ISO_VS_EXFAT.md)**.

---

## 1. One-time on the **build / dev machine** (becomes the eggs `--clone` source)

Before **`sudo eggs produce --clone`** (or **`build-highascg-egg.sh`**), bake WO-47 into **`/`** so the clone snapshots it:

```bash
sudo bash tools/live-usb/prepare-eggs-clone-with-exfat.sh
```

That installs **`exfatprogs`**, **`parted`**, **`python3`**; merges **[`merge-penguins-eggs-exclude-highascg.sh`](merge-penguins-eggs-exclude-highascg.sh)** (once **`/etc/penguins-eggs.d/exclude.list`** exists — see **`docs/LIVE_USB_IMAGE.md`**); creates empty mount stubs; writes **`install-exfat-systemd-units.sh`** outputs + **`/etc/highascg/exfat-sync.json`** when missing; and refreshes **`highascg.service`** ordering (**[`write-highascg-systemd-unit.sh`](../../scripts/write-highascg-systemd-unit.sh)**).

**Eggs excludes:** merging is marker-idempotent.

If **`penguins-eggs-exclude-highascg-fragment.list`** gained new paths (e.g. **`home/casparcg/exfat/*`**), delete the **`# --- HighAsCG tools/live-usb:` …** block from **`exclude.list`** and re-run **`prepare-eggs-clone-with-exfat.sh`** so the ISO drops builder scratch under **`~/exfat`**.

Or run the granular steps manually:

1. **Install OS packages** used on sticks and for formatting:  
   `sudo apt install -y exfatprogs parted python3` (plus your existing eggs / HighAsCG deps).

2. **Clone / pull HighAsCG** into `/home/casparcg/highascg` (or your deploy path).

3. **`npm ci`** (or `npm install`) in that directory if you rely on a full `node_modules` tree.

4. Install everything else (Caspar deps, WO-38, WO-47, **`highascg.service`**) on the imaging host: **`sudo bash scripts/install.sh`** (recommended once). For **WO-47 + service ordering only** (if the rest is already baked): **`sudo bash scripts/install-exfat-systemd-units.sh casparcg`** then **`sudo bash scripts/write-highascg-systemd-unit.sh casparcg`** — or use **`prepare-eggs-clone-with-exfat.sh`** above instead of repeating these fragments.

5. **Squashfs empty mount points** (before `eggs produce`):  
   `sudo bash tools/live-usb/ensure-empty-live-usb-dirs.sh`

6. **Build the ISO** (your usual eggs flow), e.g.:  
   `sudo bash tools/live-usb/build-highascg-egg.sh`  
   (or `eggs produce --clone …` after merge excludes).

---

## 2. **Flash** the ISO to the USB

Use `dd`, Balena Etcher, or **`tools/live-usb/build-flash-and-persist.sh`** — same as today. Replace **`/dev/sdX`** with your whole-disk device (not a partition).

---

## 3. **Partitions on the stick** (still scripted; order matters if you want **both** exFAT and **union persistence**)

| Goal | Commands |
|------|-----------|
| **exFAT + persistence** (recommended) | ① `sudo bash tools/live-usb/add-exfat-data-partition.sh /dev/sdX` (default **4 GiB** exFAT, leaves the tail free) ② `sudo bash tools/live-usb/add-union-persistence-partition.sh /dev/sdX` |
| **exFAT only** (whole free space) | `EXFAT_FILL_DISK=1 sudo bash tools/live-usb/add-exfat-data-partition.sh /dev/sdX` — **do not** run persistence afterward unless you shrink/repartition manually. |
| **Persistence only** (no exFAT) | Only **`add-union-persistence-partition.sh`**. Mount unit stays enabled; until a volume labelled **`HIGHASCGEXF`** appears, the mount is skipped (`nofail` + device timeout). |

Optional: **`EXFAT_SIZE_MIB=8192`** before **`add-exfat-data-partition.sh`** to change the reserved exFAT size.

**Safety:** unplug internal disks if unsure; scripts refuse if any partition on the target disk is mounted.

---

## 4. **Boot**

1. Boot **Live with persistence** when you added the persistence partition (GRUB entry / `persistence` cmdline — see **`tools/live-usb/FLASH_AND_PERSIST.md`**).

2. On boot with **`HIGHASCGEXF`** present: **mount → bind → server-update (`update/server/`) → mtime sync (node)** — see **[`docs/WO47_ISO_VS_EXFAT.md`](../../docs/WO47_ISO_VS_EXFAT.md)** — then **`highascg.service`** if **`package.json`** exists.

3. **Settings → media/usb → exFAT sync** shows the map and pair status; **Dry-run sync** is safe to click anytime.

---

## 5. **What you never edit by hand**

- **`/etc/systemd/system/home-casparcg-exfat.mount`** — regenerated by **`install-exfat-systemd-units.sh`**; uses **`What=/dev/disk/by-label/HIGHASCGEXF`** and **`uid=`/`gid=`** for **`casparcg`** — plus **`Documentation=`** targets under **`/usr/share/doc/highascg-wo47/`** (so units stay valid after eggs omit **`~/highascg/tools`**).
- **Partition UUID** — not used for mount; only the fixed label **`HIGHASCGEXF`** (set by **`add-exfat-data-partition.sh`**).

You **may** edit **`/etc/highascg/exfat-sync.json`** (or **`config/exfat-sync.json`** in the repo) to change which folders sync — that is normal configuration, not “mount plumbing.”

---

## 6. **Troubleshooting**

| Symptom | Check |
|--------|--------|
| exFAT not mounted | `lsblk -f`, `blkid` — partition must show **`LABEL="HIGHASCGEXF"`** (or `HIGHASCGEXF` per `blkid`). |
| Boot from HDD, **`/home/casparcg/exfat`** empty — not a stick mountpoint | **`HIGHASCGEXF`** wasn’t plugged in soon enough **or** no volume with that label exists. Re-plug USB; **`sudo systemctl start home-casparcg-exfat.mount`**. WO-47 does **not** use partition UUID — only that label identifies the operators’ data volume across machines. |
| **`media/exfat`** not wired | **`journalctl -b -u home-casparcg-highascg-media-exfat.mount`**, **`journalctl -b -u highascg-exfat-media-prep.service`** — **`home-casparcg-exfat.mount`** must be active (`findmnt`). Re-run **`install-exfat-systemd-units.sh`**. |
| Mount fails at boot | `journalctl -b -u home-casparcg-exfat.mount`; install **`exfatprogs`** / kernel exfat on the image. |
| Wrong owner on exFAT | Re-run **`sudo bash scripts/install-exfat-systemd-units.sh casparcg`** on the **cloned** system, then `daemon-reload`. |
| Stick won't boot after **`add-exfat-data-partition.sh`** | Usually exFAT was placed **inside the hybrid ISO** because **`parted`** showed a too-small end for partition 1 (e.g. only the ESP). The script now uses **max(`parted`, `/sys/block/.../start`+`size`)** and re-applies **`boot`/`esp`/`lba`** flags after **`mkpart`**. If the stick was already damaged, **re-`dd` the ISO** and run the updated script. |

### **Portable newer app than the boot partition**

Boot sync (**`highascg-exfat-sync.service`**) applies **`drop-config/highascg.config.json`** ↔ **`~/highascg/highascg.config.json`** (mtime-wins). **Server tree updates** use **`update/server/`** ( **`highascg-exfat-server-update`** ), not whole-tree mtime sync. Manual sync: **`sudo systemctl start highascg-exfat-sync.service`** or `node tools/runtime/exfat-sync-cli.js`. After a server drop with new lockfile, **`npm ci`** runs automatically when enabled.

---

## Related files

| Path | Role |
|------|------|
| `scripts/install-exfat-systemd-units.sh` | Writes mount, media bind chain, sync units (label + uid/gid). |
| `tools/live-usb/add-exfat-data-partition.sh` | Creates exFAT partition (**`mkpart … ntfs`** for MBR type **0x07**) + **`mkfs.exfat -L HIGHASCGEXF`**; placement uses **max(parted, sysfs)** so the slice starts after the real ISO extent. |
| `tools/live-usb/add-union-persistence-partition.sh` | ext4 persistence to end of disk (after exFAT if you followed §3). |
| `config/exfat-sync.json` | Default sync map (shipped / copied to **`/etc`** once). |
| `tools/live-usb/systemd/*.example` | Reference only; **installed units** come from **`install-exfat-systemd-units.sh`**. |
