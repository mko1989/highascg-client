#!/usr/bin/env bash
# Install WO-47 systemd units: mount exFAT by LABEL=HIGHASCGEXF at /home/casparcg/exfat, then boot sync.
# Uses casparcg's uid/gid in mount options (no manual UUID — partition must be labelled HIGHASCGEXF).
#
# Usage:
#   sudo bash scripts/install-exfat-systemd-units.sh [casparcg]
#
# Idempotent. Safe to re-run after useradd changes UIDs.
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

USER_CASPAR="${1:-casparcg}"
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || {
	echo "Unknown user: $USER_CASPAR" >&2
	exit 1
}
UIDN="$(id -u "$USER_CASPAR")"
GNAME="$(id -gn "$USER_CASPAR")"

install -d /home/casparcg/exfat /etc/systemd/system
chown "$USER_CASPAR:$USER_CASPAR" /home/casparcg/exfat

# shellcheck disable=SC2094
cat > /etc/systemd/system/home-casparcg-exfat.mount <<EOF
[Unit]
Description=HighAsCG exFAT data (LABEL=HIGHASCGEXF)
Documentation=file:/home/casparcg/highascg/tools/live-usb/EXFAT_DATA_ZERO_TOUCH.md
DefaultDependencies=no
Conflicts=umount.target
Before=highascg-exfat-sync.service highascg.service
After=blk-availability.target systemd-remount-fs.service

[Mount]
What=/dev/disk/by-label/HIGHASCGEXF
Where=/home/casparcg/exfat
Type=exfat
Options=defaults,uid=${UIDN},gid=${GIDN},umask=002,nofail,x-systemd.device-timeout=20

[Install]
WantedBy=local-fs.target
EOF

cat > /etc/systemd/system/highascg-exfat-sync.service <<SVCEOF
[Unit]
Description=HighAsCG exFAT to project mtime sync (WO-47)
Documentation=file:/home/casparcg/highascg/tools/live-usb/EXFAT_DATA_ZERO_TOUCH.md
DefaultDependencies=no
After=network-pre.target home-casparcg-exfat.mount
Wants=home-casparcg-exfat.mount
Before=highascg.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=${USER_CASPAR}
Group=${GNAME}
WorkingDirectory=/home/casparcg/highascg
ExecStart=/usr/bin/node /home/casparcg/highascg/tools/exfat-sync-cli.js

[Install]
WantedBy=multi-user.target
SVCEOF

chmod 0644 /etc/systemd/system/home-casparcg-exfat.mount /etc/systemd/system/highascg-exfat-sync.service

systemctl daemon-reload
systemctl enable home-casparcg-exfat.mount highascg-exfat-sync.service 2>/dev/null || true

echo "Installed:"
echo "  /etc/systemd/system/home-casparcg-exfat.mount  (What=/dev/disk/by-label/HIGHASCGEXF)"
echo "  /etc/systemd/system/highascg-exfat-sync.service"
echo "Enable is set; mount activates when a volume labelled HIGHASCGEXF appears (e.g. after add-exfat-data-partition.sh)."
