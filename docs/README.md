# HighAsCG documentation

Operator and integrator docs live at the **top level** of this folder. Deeper material is grouped by audience.

## Start here (operators & installers)

| Document | Topic |
|----------|--------|
| [MANUAL_INSTALL.md](MANUAL_INSTALL.md) | Production install on Ubuntu (`scripts/install.sh`) |
| [LIVE_USB_IMAGE.md](LIVE_USB_IMAGE.md) | Build / flash / boot a live USB from a running host |
| [ISO_CONTENTS.md](ISO_CONTENTS.md) | What is inside the Eggs live ISO (OS → Caspar → HighAsCG) |
| [DEV_RELEASE_GITHUB.md](DEV_RELEASE_GITHUB.md) | GitHub prereleases (alpha tarball, full ISO+tarball) |
| [WO47_ISO_VS_EXFAT.md](WO47_ISO_VS_EXFAT.md) | ISO squashfs vs exFAT stick payload (modular updates) |
| [CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md](CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md) | Caspar-only ISO shell + HighAsCG from exFAT |
| [HIGHASCG_PASSWORDLESS_SUDO.md](HIGHASCG_PASSWORDLESS_SUDO.md) | Narrow `sudo` rules for media mount, NVIDIA, etc. |
| [openbox_autostart.md](openbox_autostart.md) | nodm + Openbox + Caspar autostart chain |
| [casparcg-linux-usb-guide.md](casparcg-linux-usb-guide.md) | USB stick usage on Linux |
| [USB_AUTO_MOUNT_UBUNTU.md](USB_AUTO_MOUNT_UBUNTU.md) | Auto-mount removable media (udisks / polkit) |

## Application & integration

| Document | Topic |
|----------|--------|
| [api-reference.md](api-reference.md) | HTTP / WebSocket API overview |
| [MODULES.md](MODULES.md) | Feature flags and optional modules |
| [osc-integration.md](osc-integration.md) | OSC from CasparCG into HighAsCG |
| [caspar_config_explained.md](caspar_config_explained.md) | Caspar XML / config concepts |
| [companion-websocket-catalog-bootstrap.md](companion-websocket-catalog-bootstrap.md) | Bitfocus Companion + slim WS catalog |
| [companion-module-ui-selection.md](companion-module-ui-selection.md) | Companion module UI notes |

## Audio (operator guides)

| Document | Topic |
|----------|--------|
| [guides/audio/audio-setup-guide.md](guides/audio/audio-setup-guide.md) | Audio routing entry point |
| [guides/audio/audio_features_walkthrough.md](guides/audio/audio_features_walkthrough.md) | Audio features tour |

## Other folders

| Folder | Audience |
|--------|----------|
| [reference/](reference/) | AMCP mapping, GPU/xrandr design, PixelHue API, deep audio routing |
| [internal/](internal/) | Custom Caspar builds, image consolidation, architecture notes |
| [../work/work-orders/](../work/work-orders/) | Engineering work orders (WO-*) |

Stick / release tooling: [`client/tools/stick-tools/README.md`](../client/tools/stick-tools/README.md), [`client/tools/operator-desktop/README.md`](../client/tools/operator-desktop/README.md), [`tools/eggs/live-usb/BUILD_AND_FLASH.md`](../tools/eggs/live-usb/BUILD_AND_FLASH.md).
