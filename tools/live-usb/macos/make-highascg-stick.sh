#!/usr/bin/env bash
# HighAsCG — prepare a bootable USB from an .iso on macOS, then add exFAT HIGHASCGEXF + operator folders.
#
# Usage (run in Terminal):
#   chmod +x tools/live-usb/macos/make-highascg-stick.sh
#   sudo ./tools/live-usb/macos/make-highascg-stick.sh /path/to/live.iso
#
# You will be shown `diskutil list external physical` targets, pick the whole
# disk identifier (e.g. disk4 — never disk4s1). The script requires typing YES
# + re-typing the identifier.
#
# exFAT step: tries `diskutil addPartition <wholeDisk> Exfat HIGHASCGEXF 100%`
# to consume remaining free space after a hybrid ISO layout. If that fails,
# follow the printed Linux alternative (add-exfat-data-partition.sh) or Disk Utility.
#
set -euo pipefail

EXFAT_LABEL="HIGHASCGEXF"

usage() {
	echo "Usage: sudo $0 [--skip-exfat] [--dry-run] /path/to/image.iso" >&2
	exit 1
}

SKIP_EXFAT=false
DRY_RUN=false
ISO=""
while [[ $# -gt 0 ]]; do
	case "$1" in
	--skip-exfat) SKIP_EXFAT=true; shift ;;
	--dry-run) DRY_RUN=true; shift ;;
	-*) usage ;;
	*)
		ISO=$1
		shift
		;;
	esac
done

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run with sudo for raw disk access." >&2
	exit 1
}

[[ -n "$ISO" && -f "$ISO" ]] || usage

list_external_disks() {
	echo ""
	echo "=== External / physical disks (choose the USB STICK whole disk, e.g. disk4) ==="
	diskutil list external physical 2>/dev/null || diskutil list
}

list_external_disks

echo ""
read -r -p "Type the whole-disk identifier to WIPE (example: disk4): " DISK
DISK=${DISK#/dev/}
DISK=${DISK#dev/}
[[ "$DISK" == disk* ]] || {
	echo "Expected something like disk4" >&2
	exit 1
}
if [[ "$DISK" == *s[0-9]* ]]; then
	echo "Refusing a partition id ($DISK) — use whole disk (diskN)." >&2
	exit 1
fi

RAW="/dev/r${DISK}"

echo ""
echo "DESTINATION: /dev/${DISK}  (raw: $RAW)"
echo "SOURCE ISO: $ISO"
echo ""

read -r -p 'Type YES to wipe this disk completely: ' w1
[[ "$w1" == YES ]] || {
	echo Aborted >&2
	exit 1
}
read -r -p "Re-type disk id to confirm ($DISK): " w2
[[ "$w2" == "$DISK" ]] || {
	echo "Mismatch ($w2 vs $DISK)" >&2
	exit 1
}

read -r -p "LAST CHANCE — is ${DISK} your USB stick, not Macintosh HD/external backup? Type YES: " w3
[[ "$w3" == YES ]] || {
	echo Aborted >&2
	exit 1
}

if "$DRY_RUN"; then
	echo "[dry-run] No writes."
	exit 0
fi

echo ""
echo "==> Writing ISO with dd (this takes several minutes) …"
/usr/bin/dd "if=${ISO}" "of=${RAW}" bs=4m status=progress
sync

echo ""
echo "==> Waiting for I/O settle …"
sleep 3
diskutil list "/dev/$DISK" || true

if "$SKIP_EXFAT"; then
	echo "(--skip-exfat) Stopping here."
	exit 0
fi

echo ""
echo "==> Adding exFAT data partition LABEL=$EXFAT_LABEL (diskutil 'R' = remainder of free space) …"
if diskutil addPartition "/dev/$DISK" Exfat "$EXFAT_LABEL" R; then
	:
elif diskutil addPartition "/dev/$DISK" Exfat "$EXFAT_LABEL" 100%; then
	:
else
	echo ""
	echo "diskutil addPartition failed (common after some hybrid ISO layouts)."
	echo "On a Linux workstation run:"
	echo "    sudo bash tools/live-usb/add-exfat-data-partition.sh /dev/sdX"
	echo "…or Disk Utility manually: Partition → Add exFAT, label HIGHASCGEXF (11 chars)."
	exit 4
fi

sleep 2
VOL="/Volumes/${EXFAT_LABEL}"
for _ in $(seq 1 40); do
	[[ -d "$VOL" ]] && break
	sleep 0.25
done
if [[ ! -d "$VOL" ]]; then
	for try in /Volumes/*; do
		[[ -d "$try" ]] || continue
		if /usr/sbin/diskutil info "$try" 2>/dev/null | grep -F 'Volume Name:' | grep -q "$EXFAT_LABEL"; then
			VOL=$try
			break
		fi
	done
fi

if [[ -z "${VOL:-}" || ! -d "$VOL" ]]; then
	echo "exFAT created but not mounted under /Volumes — open Disk Utility to mount, then create folders manually:" >&2
	echo "  sim/highascg  drop-config  media  templates  configs  snapshots/rear-panels" >&2
	exit 0
fi

echo "==> Seeding operator layout under $VOL"
mkdir -p "$VOL/sim/highascg" "$VOL/drop-config" "$VOL/media" "$VOL/templates" "$VOL/configs" "$VOL/snapshots/rear-panels"
cat >"$VOL/README-HIGHASCG-EXFAT.txt" <<EOF
HighAsCG operator data (exFAT volume label: $EXFAT_LABEL)

sim/highascg — Unzip a GitHub release or sync sources here (Linux WO-47 mtime sync → ~/highascg).
drop-config — Optional monolithic highascg.config.json.
media — Carry media; binds to ~/highascg/media/exfat on tuned Linux images.
templates — Extra templates.
configs — Config exports / site bundles.
snapshots/rear-panels — Device / rear-panel snapshots.

Linux: mounts at /home/casparcg/exfat (LABEL=$EXFAT_LABEL).
EOF

echo ""
echo "Done. Eject safely: diskutil eject /dev/$DISK"
