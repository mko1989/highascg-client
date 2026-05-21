"""Small tkinter dashboard: paths, paste-ready commands, run sim."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from launcher_recipes import generate_sim_commands, generate_usb_commands


def _repo_root() -> Path:
	return Path(__file__).resolve().parents[2]


class OperatorDashboard:
	def __init__(self, root) -> None:
		import tkinter as tk
		from tkinter import filedialog, messagebox

		self.root = root
		self.tk = tk
		tk = self.tk  # noqa: PLW2901 — layout alias
		self.filedialog = filedialog
		self.messagebox = messagebox
		self.iso_path: Path | None = None
		self.app_path: Path | None = None

		root.title("HighAsCG")
		root.minsize(560, 400)
		root.columnconfigure(0, weight=1)
		root.rowconfigure(3, weight=1)

		pad = {"padx": 12, "pady": 6}
		tk.Label(root, text="HighAsCG", font=("", 15, "bold")).grid(
			row=0, column=0, sticky="w", **pad
		)

		paths = tk.Frame(root)
		paths.grid(row=1, column=0, sticky="ew", **pad)
		paths.columnconfigure(1, weight=1)
		self.lbl_iso = self._path_row(paths, 0, "ISO", self._open_iso)
		self.lbl_app = self._path_row(paths, 1, "HighAsCG", self._open_app)

		actions = tk.Frame(root)
		actions.grid(row=2, column=0, sticky="ew", padx=12, pady=(0, 6))
		tk.Button(
			actions,
			text="Create bootable drive",
			width=20,
			command=self._bootable,
		).pack(side=tk.LEFT, padx=(0, 8))
		tk.Button(actions, text="Run sim", width=12, command=self._run_sim).pack(
			side=tk.LEFT
		)

		cmd_fr = tk.Frame(root)
		cmd_fr.grid(row=3, column=0, sticky="nsew", padx=12, pady=4)
		cmd_fr.columnconfigure(0, weight=1)
		cmd_fr.rowconfigure(0, weight=1)
		root.rowconfigure(3, weight=1)

		mono = "Menlo" if sys.platform == "darwin" else "TkFixedFont"
		self.cmd_w = tk.Text(
			cmd_fr,
			height=12,
			wrap="none",
			font=(mono, 11),
			relief="sunken",
			borderwidth=1,
		)
		self.cmd_w.grid(row=0, column=0, sticky="nsew")
		scroll = tk.Scrollbar(cmd_fr, command=self.cmd_w.yview)
		scroll.grid(row=0, column=1, sticky="ns")
		self.cmd_w.configure(yscrollcommand=scroll.set, state="disabled", cursor="arrow")

		bar = tk.Frame(root)
		bar.grid(row=4, column=0, sticky="ew", padx=12, pady=(0, 10))
		tk.Button(bar, text="Copy commands", command=self._copy).pack(side=tk.LEFT)
		self.status = tk.Label(
			bar,
			text="Open ISO and HighAsCG, then use an action.",
			fg="gray",
			anchor="w",
		)
		self.status.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(10, 0))

	def _path_row(self, parent, row: int, label: str, command) -> object:
		tk = self.tk
		tk.Label(parent, text=label, width=9, anchor="w").grid(
			row=row, column=0, sticky="w", pady=5
		)
		lbl = tk.Label(
			parent,
			text="(not set)",
			anchor="w",
			justify="left",
			wraplength=380,
			fg="#444",
		)
		lbl.grid(row=row, column=1, sticky="ew", padx=6)
		tk.Button(parent, text="Open…", width=8, command=command).grid(
			row=row, column=2, sticky="e"
		)
		return lbl

	def _set_path_label(self, lbl, path: Path) -> None:
		text = str(path)
		if len(text) > 72:
			text = "…" + text[-69:]
		lbl.config(text=text, fg="#111")

	def _open_iso(self) -> None:
		p = self.filedialog.askopenfilename(
			title="Live ISO",
			filetypes=[("ISO", "*.iso"), ("All", "*")],
		)
		if not p:
			return
		self.iso_path = Path(p).expanduser()
		self._set_path_label(self.lbl_iso, self.iso_path)

	def _open_app(self) -> None:
		p = self.filedialog.askopenfilename(
			title="HighAsCG release (.tar.gz)",
			filetypes=[("tar.gz", "*.tar.gz"), ("All", "*")],
		)
		if p:
			self.app_path = Path(p).expanduser()
			self._set_path_label(self.lbl_app, self.app_path)
			return
		d = self.filedialog.askdirectory(title="HighAsCG folder (package.json)")
		if d:
			self.app_path = Path(d).expanduser()
			self._set_path_label(self.lbl_app, self.app_path)

	def _show_commands(self, text: str, *, select_all: bool = True) -> None:
		self.cmd_w.configure(state="normal")
		self.cmd_w.delete("1.0", "end")
		self.cmd_w.insert("1.0", text.rstrip() + "\n")
		self.cmd_w.configure(state="disabled")
		if select_all:
			self.cmd_w.tag_add("sel", "1.0", "end")
			self.cmd_w.mark_set("insert", "1.0")
			self.cmd_w.see("1.0")

	def _copy(self) -> None:
		text = self.cmd_w.get("1.0", "end").strip()
		if not text:
			self.status.config(text="Nothing to copy.", fg="#a00")
			return
		self.root.clipboard_clear()
		self.root.clipboard_append(text)
		self.root.update_idletasks()
		self.status.config(text="Copied to clipboard.", fg="#060")

	def _require_paths(self, *, need_iso: bool) -> bool:
		if need_iso and not self.iso_path:
			self.messagebox.showwarning("HighAsCG", "Open an ISO first.")
			return False
		if not self.app_path:
			self.messagebox.showwarning("HighAsCG", "Open HighAsCG (folder or .tar.gz) first.")
			return False
		return True

	def _bootable(self) -> None:
		if not self._require_paths(need_iso=True):
			return
		try:
			text = generate_usb_commands(
				self.iso_path, self.app_path, _repo_root()  # type: ignore[arg-type]
			)
		except (FileNotFoundError, ValueError) as e:
			self.messagebox.showerror("HighAsCG", str(e))
			return
		self._show_commands(text)
		self._copy()
		self.status.config(
			text="Bootable-drive commands ready (copied to clipboard).",
			fg="#060",
		)

	def _run_sim(self) -> None:
		if not self._require_paths(need_iso=False):
			return
		try:
			text = generate_sim_commands(self.app_path, _repo_root())  # type: ignore[arg-type]
		except (FileNotFoundError, ValueError) as e:
			self.messagebox.showerror("HighAsCG", str(e))
			return
		self._show_commands(text)
		self._copy()
		if not self.app_path.is_dir():
			self.status.config(
				text="Extract the tarball first, then Run sim again.",
				fg="#a60",
			)
			return
		launcher = _repo_root() / "tools/portable-desktop/launch-sim-from-exfat.js"
		env = os.environ.copy()
		env["HIGHASCG_EXFAT_APP_ROOT"] = str(self.app_path.resolve())
		subprocess.Popen(
			[shutil.which("node") or "node", str(launcher)],
			cwd=_repo_root(),
			env=env,
			stdin=subprocess.DEVNULL,
		)
		self.status.config(text="Simulation starting — see Terminal.", fg="#060")
