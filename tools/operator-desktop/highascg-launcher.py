#!/usr/bin/env python3
"""
HighAsCG Launcher — minimal GUI: prepare bootable USB (ISO + release) or start simulation.

Requires Python 3 + tkinter (Debian/Ubuntu: sudo apt install python3-tk).

  python3 tools/operator-desktop/highascg-launcher.py
  npm run launcher
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path


def repo_root() -> Path:
	return Path(__file__).resolve().parents[2]


def log(widget, msg: str) -> None:
	widget.insert("end", msg + "\n")
	widget.see("end")


def list_linux_usb_disks() -> list[str]:
	rr = repo_root()
	common = rr / "tools/live-usb/flash-stick-common.sh"
	if not common.is_file():
		return []
	proc = subprocess.run(
		["bash", "-lc", f"source {common.as_posix()} && list_flash_candidates"],
		capture_output=True,
		text=True,
	)
	return [ln.strip() for ln in proc.stdout.splitlines() if ln.strip().startswith("/dev/")]


def disk_label(path: str) -> str:
	try:
		out = subprocess.run(
			["lsblk", "-dnro", "SIZE,MODEL", path],
			capture_output=True,
			text=True,
			timeout=5,
		).stdout.strip().replace("\n", " ")
		return f"{path}  {out}".strip()
	except (FileNotFoundError, subprocess.TimeoutExpired):
		return path


def find_exfat_mount() -> Path | None:
	label = os.environ.get("HIGHASCG_EXFAT_LABEL", "HIGHASCGEXF")
	try:
		out = subprocess.run(
			["findmnt", "-n", "-o", "TARGET", f"-L{label}"],
			capture_output=True,
			text=True,
			timeout=8,
		)
		if out.returncode == 0:
			p = Path(out.stdout.strip())
			if p.is_dir():
				return p
	except (FileNotFoundError, subprocess.TimeoutExpired):
		pass
	u = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
	for base in (Path("/media") / u, Path("/run/media") / u, Path("/mnt")):
		cand = base / label
		if cand.is_dir():
			return cand
	return None


def extract_release(release: Path, dest: Path) -> None:
	dest.mkdir(parents=True, exist_ok=True)
	if release.is_dir():
		if not (release / "package.json").is_file():
			raise FileNotFoundError(f"No package.json in {release}")
		for item in release.iterdir():
			target = dest / item.name
			if item.is_dir():
				if target.exists():
					shutil.rmtree(target)
				shutil.copytree(item, target, symlinks=False, ignore_dangling_symlinks=True)
			else:
				shutil.copy2(item, target)
		return
	if release.suffixes[-2:] == [".tar", ".gz"] or release.suffix == ".tgz":
		with tarfile.open(release, "r:gz") as tf:
			kw = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}
			tf.extractall(dest, **kw)
		if not (dest / "package.json").is_file():
			# tarball may have one top-level directory
			subs = [p for p in dest.iterdir() if p.is_dir()]
			if len(subs) == 1 and (subs[0] / "package.json").is_file():
				for item in subs[0].iterdir():
					shutil.move(str(item), str(dest / item.name))
				subs[0].rmdir()
		if not (dest / "package.json").is_file():
			raise FileNotFoundError(f"After extract, no package.json under {dest}")
		return
	raise ValueError(f"Release must be a directory or .tar.gz: {release}")


def linux_prepare(iso: Path, release: Path | None, usb: str, log_w) -> None:
	priv = repo_root() / "tools/stick-tools/stick-studio-priv.sh"
	if not priv.is_file():
		raise RuntimeError(f"Missing {priv}")
	os.chmod(priv, priv.stat().st_mode | 0o111)

	log(log_w, f"Flash {iso.name} → {usb}")
	r = subprocess.run(["pkexec", str(priv), "flash", str(iso), usb])
	if r.returncode != 0:
		raise RuntimeError("Flash failed (pkexec).")

	subprocess.run(["pkexec", str(priv), "partprobe", usb], check=False)
	log(log_w, "Add exFAT HIGHASCGEXF…")
	r = subprocess.run(
		["pkexec", str(priv), "exfat", "--iso-path", str(iso), usb],
	)
	if r.returncode != 0:
		raise RuntimeError("exFAT step failed.")

	if release is None:
		log(log_w, "Done (no release selected). Mount HIGHASCGEXF and copy sim/highascg manually.")
		return

	mount = find_exfat_mount()
	if mount is None:
		raise RuntimeError(
			"Could not find mounted HIGHASCGEXF. Mount the exFAT partition, then copy release to sim/highascg."
		)
	dest = mount / "sim/highascg"
	for rel in ("sim/highascg", "drop-config", "media", "templates", "configs"):
		(mount / rel).mkdir(parents=True, exist_ok=True)
	log(log_w, f"Copy release → {dest}")
	extract_release(release, dest)
	log(log_w, "USB ready.")


def elevated_prepare(iso: Path, release: Path | None) -> None:
	root = repo_root()
	op = root / "tools/operator-desktop/highascg-operator.js"
	args = [str(op), "prepare-stick", "--iso", str(iso)]
	if release is not None:
		if release.is_dir():
			args.extend(["--app-dir", str(release)])
		else:
			args.extend(["--tar-gz", str(release)])
	subprocess.run([shutil.which("node") or "node", *args], cwd=root, check=True)


def start_simulation(log_w) -> None:
	root = repo_root()
	launcher = root / "tools/portable-desktop/launch-sim-from-exfat.js"
	log(log_w, "Starting simulation…")
	subprocess.Popen(
		[shutil.which("node") or "node", str(launcher)],
		cwd=root,
		stdin=subprocess.DEVNULL,
	)


class LauncherUi:
	def __init__(self, root) -> None:
		import tkinter as tk
		from tkinter import filedialog, messagebox, ttk

		self.tk = tk
		self.messagebox = messagebox
		self.filedialog = filedialog
		root.title("HighAsCG")
		root.minsize(420, 220)

		pad = {"padx": 10, "pady": 4}
		f = tk.Frame(root, padx=10, pady=10)
		f.pack(fill=tk.X)
		f.columnconfigure(1, weight=1)

		self.var_iso = tk.StringVar()
		self.var_release = tk.StringVar()
		self.var_usb = tk.StringVar()

		tk.Label(f, text="ISO").grid(row=0, column=0, sticky="w", **pad)
		tk.Entry(f, textvariable=self.var_iso).grid(row=0, column=1, sticky="ew", **pad)
		tk.Button(f, text="…", width=3, command=self._pick_iso).grid(row=0, column=2, **pad)

		tk.Label(f, text="Release").grid(row=1, column=0, sticky="w", **pad)
		tk.Entry(f, textvariable=self.var_release).grid(row=1, column=1, sticky="ew", **pad)
		tk.Button(f, text="…", width=3, command=self._pick_release).grid(row=1, column=2, **pad)

		tk.Label(f, text="USB", font=("", 9)).grid(row=2, column=0, sticky="nw", **pad)
		usb_fr = tk.Frame(f)
		usb_fr.grid(row=2, column=1, columnspan=2, sticky="ew", **pad)
		self._usb_labels: list[str] = []
		self.cmb_usb = ttk.Combobox(usb_fr, textvariable=self.var_usb, state="readonly")
		self.cmb_usb.pack(side=tk.LEFT, fill=tk.X, expand=True)
		tk.Button(usb_fr, text="↻", width=3, command=self._refresh_usb).pack(side=tk.LEFT, padx=(4, 0))
		self._refresh_usb()

		if sys.platform not in ("linux",):
			hint = "Mac/Windows: disk is chosen in the elevated script."
			tk.Label(f, text=hint, fg="gray", wraplength=360, justify=tk.LEFT).grid(
				row=3, column=0, columnspan=3, sticky="w", padx=10
			)

		btn = tk.Frame(root, pady=8)
		btn.pack()
		tk.Button(btn, text="Prepare USB", width=14, command=self._prepare).pack(side=tk.LEFT, padx=6)
		tk.Button(btn, text="Simulation", width=14, command=self._sim).pack(side=tk.LEFT, padx=6)

		self.log_w = tk.Text(root, height=8, wrap="word", font=("TkFixedFont", 9))
		self.log_w.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

	def _pick_iso(self) -> None:
		p = self.filedialog.askopenfilename(filetypes=[("ISO", "*.iso"), ("All", "*")])
		if p:
			self.var_iso.set(p)

	def _pick_release(self) -> None:
		p = self.filedialog.askopenfilename(filetypes=[("tar.gz", "*.tar.gz"), ("All", "*")])
		if p:
			self.var_release.set(p)
			return
		d = self.filedialog.askdirectory(title="Unpacked HighAsCG (package.json)")
		if d:
			self.var_release.set(d)

	def _refresh_usb(self) -> None:
		if sys.platform != "linux":
			self.cmb_usb["values"] = ("(elevated script)",)
			self.cmb_usb.current(0)
			return
		disks = list_linux_usb_disks()
		self._usb_labels = disks
		labels = [disk_label(d) for d in disks]
		self.cmb_usb["values"] = labels or ("(no USB disks — Refresh)",)
		if labels:
			self.cmb_usb.current(0)

	def _selected_usb(self) -> str | None:
		if sys.platform != "linux":
			return None
		i = self.cmb_usb.current()
		if i < 0 or i >= len(self._usb_labels):
			return None
		return self._usb_labels[i]

	def _prepare(self) -> None:
		m = self.messagebox
		iso_s = self.var_iso.get().strip()
		if not iso_s:
			m.showerror("HighAsCG", "Choose an ISO.")
			return
		iso = Path(iso_s).expanduser()
		if not iso.is_file():
			m.showerror("HighAsCG", f"ISO not found:\n{iso}")
			return

		rel_s = self.var_release.get().strip()
		release: Path | None = None
		if rel_s:
			release = Path(rel_s).expanduser()
			if not release.exists():
				m.showerror("HighAsCG", f"Release not found:\n{release}")
				return

		if sys.platform == "linux":
			usb = self._selected_usb()
			if not usb:
				m.showerror("HighAsCG", "Select a USB disk.")
				return
			if not m.askyesno(
				"Erase USB?",
				f"All data on {usb} will be destroyed.\n\nISO:\n{iso}",
				icon="warning",
			):
				return
			try:
				linux_prepare(iso, release, usb, self.log_w)
				m.showinfo("HighAsCG", "Done.")
			except Exception as e:
				m.showerror("HighAsCG", str(e))
			return

		try:
			log(self.log_w, "Opening elevated prepare-stick…")
			elevated_prepare(iso, release)
			log(self.log_w, "Done.")
		except subprocess.CalledProcessError:
			m.showerror("HighAsCG", "prepare-stick failed.")
		except Exception as e:
			m.showerror("HighAsCG", str(e))

	def _sim(self) -> None:
		try:
			start_simulation(self.log_w)
		except Exception as e:
			self.messagebox.showerror("HighAsCG", str(e))


def main() -> None:
	try:
		import tkinter as tk
	except ImportError:
		print("Install python3-tk (e.g. sudo apt install python3-tk)", file=sys.stderr)
		sys.exit(1)
	root = tk.Tk()
	LauncherUi(root)
	root.mainloop()


if __name__ == "__main__":
	main()
