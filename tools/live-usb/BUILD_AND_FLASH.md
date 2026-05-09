# HighAsCG live USB — build and flash

## Build host (Ubuntu Noble recommended)

1. **Install eggs** (if apt repo fails, use the latest `.deb` from  
   https://github.com/pieroproietti/penguins-eggs/releases )

2. **One-shot build** (network stack + NVIDIA offline cache + excludes + ISO):

   ```bash
   cd /path/to/highascg
   sudo bash tools/live-usb/build-highascg-egg.sh
   ```

   Optional:

   ```bash
   sudo NVIDIA_BRANCHES="470 580" BASENAME=highascg bash tools/live-usb/build-highascg-egg.sh
   ```

3. **Output**: ISO under `/home/eggs/` — name starts with `BASENAME` (default `highascg`), e.g.  
   `highascg_amd64_YYYY-MM-DD_HHMM.iso`

4. **Netplan**: If `netplan` warns about permissions, fix once:

   ```bash
   sudo chmod 600 /etc/netplan/01-live-networkd.yaml
   ```

5. **Excludes** (large dirs omitted from squashfs): fragment merged by  
   `merge-penguins-eggs-exclude-highascg.sh` — includes `home/casparcg/highascg/media`.

6. **Tailscale / tailnet identity**: A cloned ISO is **not** automatically “logged out.” If `tailscaled` state existed on the build host when `eggs produce` ran, that **machine key** is copied into the squashfs unless every storage path is excluded. The laptop then joins the tailnet **as the same node** as the builder (same key → same identity; it effectively replaces that machine until you fix it).  
   - `.deb` installs often use **`/var/lib/tailscale/`**, but **snap** layouts use **`/var/snap/tailscale/…`** — so “no `/var/lib/tailscale`” does **not** prove there is no shipped identity.  
   - Custom locations: check **`systemctl cat tailscaled`** and **`/etc/default/tailscaled`** for `--statedir=` / `--state=`. Add matching paths to **`tools/live-usb/penguins-eggs-exclude-highascg-fragment.list`**, run **`merge-penguins-eggs-exclude-highascg.sh`**, rebuild.  
   - **Persistence** (`FLASH_AND_PERSIST.md`, `/ union`) saves overlays too — once state exists on the stick, it keeps coming back until you delete or reflash.  
   - Sanity-check the ISO/squashfs: mount or `unsquashfs -ll` and search for **`tailscaled.state`** (and anything under **`var/snap/tailscale/`**).

---

## Flash to USB

1. **Identify the stick** (whole disk, e.g. `/dev/sdb` — **not** a partition):

   ```bash
   lsblk -dpno NAME,SIZE,MODEL,TRAN
   ```

2. **Unmount** anything on that disk:

   ```bash
   sudo umount /dev/sdX?* 2>/dev/null || true
   ```

3. **Write ISO** (replace `ISO` and `USB`):

   ```bash
   ISO=/home/eggs/mnt/highascg_amd64_2026-05-09_1311.iso
   USB=/dev/sdc

   sudo dd if=$(ls -t /home/eggs/mnt/highascg_amd64_2026-05-09_1311.iso | head -1) of=$USB bs=4M status=progress oflag=sync conv=fsync
   sudo sync
   ```

   Do **not** quote the glob in `dd if=…` — use `ls -t … | head -1` or the full filename.

4. **Optional — long flash in tmux**:

   ```bash
   tmux new -s flash
   # run dd here; detach: Ctrl+b then d
   tmux attach -t flash
   ```

5. **Persistence** (NVIDIA picker / first-boot changes must persist): see  
   [FLASH_AND_PERSIST.md](./FLASH_AND_PERSIST.md).

---

## GRUB says live/install but there is no disk installer

The menu text does **not** guarantee Calamares (GUI installer) is inside the ISO. With **`eggs produce --clone`** you get a live system clone; the graphical installer is only present if you add it **on the build host**, then rebuild.

### Option A — Calamares (GUI install baked into the ISO)

On the **build machine**, before rebuilding:

```bash
sudo eggs calamares --help
sudo eggs calamares
```

Follow prompts so Calamares is installed **and** configured for eggs, then run `build-highascg-egg.sh` again.

After flashing the new ISO, boot live and start the graphical installer from the desktop/menu (exact label depends on your calamares theme).

### Option B — Krill (TUI install from the live USB, no rebuild)

Eggs ships **`krill`**. From the live session terminal:

```bash
sudo eggs krill --help
sudo eggs krill
```

That installs to disk without Calamares in the ISO.

### Option C — No install, only persistence

If you never install to internal disk, use a **persistence** partition so changes survive reboots. See [FLASH_AND_PERSIST.md](./FLASH_AND_PERSIST.md).

---

## Live session notes

- Default live user/password are whatever **eggs** printed at the end of the build (often `live` / `evolution`-style — check build log).
- Wired DHCP: image should ship **systemd-networkd** + **netplan** `renderer: networkd` + **NetworkManager** as fallback from the build script.
