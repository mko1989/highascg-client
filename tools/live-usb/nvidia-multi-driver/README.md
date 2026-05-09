# Multi-NVIDIA driver support for the HighAsCG live USB

The live image has to run on a fleet whose GPUs span more than one driver
branch (e.g. legacy Kepler/Maxwell on `nvidia-driver-470`, modern Ada on 535,
Blackwell on 580). Only one `nvidia.ko` can be loaded at a time, so the
strategy is:

1. **Bake the most common branch into the image.** Whatever is installed on
   the build host (currently `nvidia-driver-535` via DKMS) gets cloned into
   the live image by `eggs produce --clone`. For Maxwell-Ada GPUs the picker
   detects "loaded matches recommendation" and stamps the marker without
   doing any work — boot is instant.

2. **Ship the alternate branches as offline `.deb`s** at `/opt/nvidia-debs/`.
   `fetch-debs.sh` populates the cache; the path lives inside the squashfs
   so installs work without network.

3. **First-boot service picks the recommended branch.** A oneshot systemd
   unit (`highascg-pick-nvidia.service`) runs `ubuntu-drivers devices`,
   compares against the loaded branch, and if a swap is needed: purges the
   stale branch, installs the recommended one from the offline cache,
   stamps `/var/lib/highascg/nvidia-installed`, reboots.

4. **`highascg.service` waits for the marker** via a drop-in
   (`ConditionPathExists=/var/lib/highascg/nvidia-installed`) so the app
   never starts on top of a half-installed GPU stack.

## Files

| File | Lives at on the live image |
|---|---|
| `highascg-pick-nvidia.sh` | `/usr/local/sbin/highascg-pick-nvidia.sh` |
| `highascg-pick-nvidia.service` | `/etc/systemd/system/highascg-pick-nvidia.service` |
| `fetch-debs.sh` | (build host only — populates `/opt/nvidia-debs/`) |
| `install-on-build-host.sh` | (build host only — copies the above into place) |

## Build-host workflow

```bash
# 1. Drop the picker assets into system paths, enable the unit
sudo bash tools/live-usb/nvidia-multi-driver/install-on-build-host.sh

# 2. Populate offline deb cache with the *additional* branches you need
sudo NVIDIA_BRANCHES="470 580" bash tools/live-usb/nvidia-multi-driver/fetch-debs.sh

# 3. Merge the eggs exclude fragment (does not exclude /opt/nvidia-debs)
sudo bash tools/live-usb/merge-penguins-eggs-exclude-highascg.sh

# 4. Optional: pre-build cleanup
sudo PURGE_DEV=1 PURGE_SNAPS=1 BUILD_EGGS=0 bash tools/prepare-eggs-minimal.sh

# 5. Build
sudo eggs produce --nointeractive --clone --max --basename highascg-live
```

## Persistence

`--clone` produces a live ISO whose default boot mode does **not** persist
changes — meaning the picker would re-run every boot and never escape the
"install + reboot" loop on machines that need a swap.

You must either:

- **Install the live USB to internal disk** via Calamares on first run
  (changes persist on the installed disk), or
- **Flash with a persistence partition** (changes persist on the USB itself).

See `../FLASH_AND_PERSIST.md` for the flash procedure.

## Picker behaviour matrix

| Loaded branch on boot | `ubuntu-drivers` recommends | Picker action |
|---|---|---|
| 535 | 535 | stamp marker, no reboot |
| 535 | 580 | purge 535, install 580 from cache, reboot |
| (none, nouveau) | 535 | install 535 from cache or apt, reboot |
| anything | (none — non-NVIDIA host) | stamp marker, no reboot |
