"""Compact copy-paste commands for the operator dashboard."""
from __future__ import annotations

import shlex
import sys
from pathlib import Path


def quote_sh(path: Path) -> str:
	return shlex.quote(str(path.expanduser().resolve()))


def quote_ps(path: Path) -> str:
	s = str(path.expanduser().resolve())
	return "'" + s.replace("'", "''") + "'"


def validate_iso(iso: Path) -> None:
	if not iso.is_file():
		raise FileNotFoundError(f"ISO not found: {iso}")


def validate_app(app: Path) -> None:
	if not app.exists():
		raise FileNotFoundError(f"HighAsCG path not found: {app}")
	if app.is_dir():
		if not (app / "package.json").is_file():
			raise FileNotFoundError(f"No package.json in {app}")
		return
	if app.suffixes[-2:] == [".tar", ".gz"] or app.suffix == ".tgz":
		return
	raise ValueError("HighAsCG must be a folder with package.json or a .tar.gz release")


def _app_copy_shell(app: Path) -> str:
	app_q = quote_sh(app)
	vol = "/Volumes/HIGHASCGEXF/sim/highascg"
	if app.is_dir():
		return f'ditto {app_q}/. "{vol}/"'
	return f'mkdir -p "{vol}" && tar -xzf {app_q} -C "{vol}"'


def _app_copy_ps(app: Path, drive: str = "E:") -> str:
	vol = f"{drive}\\sim\\highascg"
	app_q = quote_ps(app)
	if app.is_dir():
		return f'robocopy {app_q} "{vol}" /E'
	return f'mkdir "{vol}" 2>nul & tar -xzf {app_q} -C "{vol}"'


def _mac_stick_args(app: Path) -> str:
	if app.is_dir():
		return f"--app-dir {quote_sh(app)}"
	return f"--tar-gz {quote_sh(app)}"


def generate_usb_commands(iso: Path, app: Path, repo: Path) -> str:
	validate_iso(iso)
	validate_app(app)
	if sys.platform == "darwin":
		return _usb_macos(iso, app, repo)
	if sys.platform == "win32":
		return _usb_windows(iso, app, repo)
	return _usb_linux(iso, app, repo)


def generate_sim_commands(app: Path, repo: Path) -> str:
	if not app.is_dir():
		app_q = quote_sh(app)
		return (
			f"mkdir -p ~/highascg-sim && tar -xzf {app_q} -C ~/highascg-sim\n"
			"# Fix layout so package.json is under ~/highascg-sim/… then:\n"
			f"cd ~/highascg-sim && npm ci && node index.js --no-caspar"
		)
	app_q, repo_q = quote_sh(app), quote_sh(repo)
	return (
		f"cd {app_q} && npm ci\n"
		f"cd {repo_q} && HIGHASCG_EXFAT_APP_ROOT={app_q} npm run portable:sim"
	)


def _usb_macos(iso: Path, app: Path, repo: Path) -> str:
	iso_q, repo_q = quote_sh(iso), quote_sh(repo)
	stick = repo / "tools/live-usb/macos/make-highascg-stick.sh"
	app_args = _mac_stick_args(app)
	return "\n".join(
		[
			f"# Etcher → flash {iso.resolve()}",
			"diskutil list external physical",
			"",
			f"cd {repo_q}",
			f"sudo bash {quote_sh(stick)} {app_args} {iso_q}",
			"",
			"# After exFAT volume HIGHASCGEXF mounts:",
			'mkdir -p "/Volumes/HIGHASCGEXF/sim/highascg" "/Volumes/HIGHASCGEXF/drop-config" '
			'"/Volumes/HIGHASCGEXF/media" "/Volumes/HIGHASCGEXF/templates" '
			'"/Volumes/HIGHASCGEXF/configs" "/Volumes/HIGHASCGEXF/snapshots/rear-panels"',
			_app_copy_shell(app),
		]
	)


def _usb_linux(iso: Path, app: Path, repo: Path) -> str:
	iso_q, app_q, repo_q = quote_sh(iso), quote_sh(app), quote_sh(repo)
	flag = f"--app-dir {app_q}" if app.is_dir() else f"--tar-gz {app_q}"
	return "\n".join(
		[
			f"cd {repo_q}",
			"bash -lc 'source tools/live-usb/flash-stick-common.sh && list_flash_candidates'",
			f"npm run stick-studio",
			"# — or —",
			f"npm run operator-kit -- prepare-stick --iso {iso_q} {flag}",
		]
	)


def _usb_windows(iso: Path, app: Path, repo: Path) -> str:
	iso_ps, app_ps, repo_ps = quote_ps(iso), quote_ps(app), quote_ps(repo)
	ps1 = repo / "tools/live-usb/windows/make-highascg-stick.ps1"
	param = (
		f"-AppSourceDirectory {app_ps}"
		if app.is_dir()
		else f"-TarGzPath {app_ps}"
	)
	return "\n".join(
		[
			f"# Etcher → flash {iso.resolve()}",
			f"cd {repo_ps}",
			f"powershell -ExecutionPolicy Bypass -File {quote_ps(ps1)} -IsoPath {iso_ps} {param}",
			"",
			f"# Or copy app (set drive letter):",
			_app_copy_ps(app),
		]
	)
