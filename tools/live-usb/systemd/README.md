# systemd snippets for live USB

| File | Purpose |
|------|---------|
| [`home-casparcg-highascg.mount.example`](home-casparcg-highascg.mount.example) | Mount ext4 labeled **`HIGHASCG_PERSIST`** at **`/home/casparcg/highascg`**. See [**`../HIGHASCG_FOLDER_USB_PARTITION.md`**](../HIGHASCG_FOLDER_USB_PARTITION.md). |
| [`home-casparcg-exfat.mount.example`](home-casparcg-exfat.mount.example) | **Superseded** on installed hosts by **`scripts/install-exfat-systemd-units.sh`** (mounts **`LABEL=HIGHASCGEXF`**). Example kept for reference. |
| [`highascg-exfat-sync.service.example`](highascg-exfat-sync.service.example) | **Superseded** by the same installer. See **[`../EXFAT_DATA_ZERO_TOUCH.md`](../EXFAT_DATA_ZERO_TOUCH.md)** for the full procedure. |

Copy `*.example` to `/etc/systemd/system/` **without** the `.example` suffix, then `daemon-reload`, `enable`, `reboot`.
