'use strict'

const fs = require('fs')
const path = require('path')

function quoteSh(p) {
	return JSON.stringify(path.resolve(p))
}

function quotePs(p) {
	return `'${path.resolve(p).replace(/'/g, "''")}'`
}

function validateIso(iso) {
	if (!fs.existsSync(iso) || !fs.statSync(iso).isFile()) {
		throw new Error(`ISO not found: ${iso}`)
	}
}

function validateApp(app) {
	if (!fs.existsSync(app)) throw new Error(`HighAsCG path not found: ${app}`)
	const st = fs.statSync(app)
	if (st.isDirectory()) {
		if (!fs.existsSync(path.join(app, 'package.json'))) {
			throw new Error(`No package.json in ${app}`)
		}
		return
	}
	if (app.endsWith('.tar.gz') || app.endsWith('.tgz')) return
	throw new Error('HighAsCG must be a folder with package.json or a .tar.gz release')
}

function appCopyShell(app) {
	const appQ = quoteSh(app)
	const vol = '/Volumes/HIGHASCGEXF/sim/highascg'
	if (fs.statSync(app).isDirectory()) {
		return `ditto ${appQ}/. "${vol}/"`
	}
	return `mkdir -p "${vol}" && tar -xzf ${appQ} -C "${vol}"`
}

function appCopyPs(app, drive = 'E:') {
	const vol = `${drive}\\sim\\highascg`
	const appQ = quotePs(app)
	if (fs.statSync(app).isDirectory()) {
		return `robocopy ${appQ} "${vol}" /E`
	}
	return `mkdir "${vol}" 2>nul & tar -xzf ${appQ} -C "${vol}"`
}

function macStickArgs(app) {
	return fs.statSync(app).isDirectory()
		? `--app-dir ${quoteSh(app)}`
		: `--tar-gz ${quoteSh(app)}`
}

function generateUsbCommands(iso, app, repo) {
	validateIso(iso)
	validateApp(app)
	if (process.platform === 'darwin') return usbMacos(iso, app, repo)
	if (process.platform === 'win32') return usbWindows(iso, app, repo)
	return usbLinux(iso, app, repo)
}

function generateSimCommands(app, repo) {
	validateApp(app)
	if (!fs.statSync(app).isDirectory()) {
		const appQ = quoteSh(app)
		return [
			`mkdir -p ~/highascg-sim && tar -xzf ${appQ} -C ~/highascg-sim`,
			'# Fix layout so package.json is under ~/highascg-sim/… then:',
			'cd ~/highascg-sim && npm ci && node index.js --no-caspar',
		].join('\n')
	}
	const appQ = quoteSh(app)
	const repoQ = quoteSh(repo)
	return [`cd ${appQ} && npm ci`, `cd ${repoQ} && HIGHASCG_EXFAT_APP_ROOT=${appQ} npm run portable:sim`].join(
		'\n'
	)
}

function usbMacos(iso, app, repo) {
	const isoQ = quoteSh(iso)
	const repoQ = quoteSh(repo)
	const stick = path.join(repo, 'tools/live-usb/macos/make-highascg-stick.sh')
	const args = macStickArgs(app)
	return [
		'# HighAsCG USB — run each block separately (do not paste the whole file at once).',
		'',
		'# --- Block A: Etcher (GUI) — flash this ISO onto the USB:',
		`#   ${path.resolve(iso)}`,
		'',
		'# --- Block B: list external disks (read-only):',
		'diskutil list external physical',
		'',
		'# --- Block C: automated wipe + flash (paste ONLY these two lines):',
		`cd ${repoQ}`,
		`sudo bash ${quoteSh(stick)} ${args} ${isoQ}`,
		'# Script will ask which disk (e.g. disk2). Re-type that same id when prompted.',
		'# Do NOT pass --disk diskN — diskN was a bad placeholder.',
		'',
		'# --- Block D: exFAT (GUI) — if script said "must be GPT" / addPartition failed:',
		'#   1) Open Disk Utility:  open -a "Disk Utility"',
		'#   2) View → Show All Devices → select top-level USB (31.5 GB), not "Macintosh HD"',
		'#   3) Partition → use free space → add ExFAT volume named exactly: HIGHASCGEXF',
		'#   Guide: tools/live-usb/MANUAL_STICK_WINDOWS_MACOS.md (Part C — macOS)',
		'',
		'# --- Block E: AFTER /Volumes/HIGHASCGEXF appears in Finder (not before):',
		'mkdir -p "/Volumes/HIGHASCGEXF/sim/highascg" "/Volumes/HIGHASCGEXF/drop-config" "/Volumes/HIGHASCGEXF/media" "/Volumes/HIGHASCGEXF/templates" "/Volumes/HIGHASCGEXF/configs" "/Volumes/HIGHASCGEXF/snapshots/rear-panels"',
		appCopyShell(app),
	].join('\n')
}

function usbLinux(iso, app, repo) {
	const isoQ = quoteSh(iso)
	const appQ = quoteSh(app)
	const repoQ = quoteSh(repo)
	const flag = fs.statSync(app).isDirectory() ? `--app-dir ${appQ}` : `--tar-gz ${appQ}`
	return [
		`cd ${repoQ}`,
		"bash -lc 'source tools/live-usb/flash-stick-common.sh && list_flash_candidates'",
		'npm run stick-studio',
		'# — or —',
		`npm run operator-kit -- prepare-stick --iso ${isoQ} ${flag}`,
	].join('\n')
}

function usbWindows(iso, app, repo) {
	const isoPs = quotePs(iso)
	const appPs = quotePs(app)
	const repoPs = quotePs(repo)
	const ps1 = path.join(repo, 'tools/live-usb/windows/make-highascg-stick.ps1')
	const param = fs.statSync(app).isDirectory()
		? `-AppSourceDirectory ${appPs}`
		: `-TarGzPath ${appPs}`
	return [
		`# Etcher → flash ${path.resolve(iso)}`,
		`cd ${repoPs}`,
		`powershell -ExecutionPolicy Bypass -File ${quotePs(ps1)} -IsoPath ${isoPs} ${param}`,
		'',
		'# Or copy app (set drive letter):',
		appCopyPs(app),
	].join('\n')
}

module.exports = { generateUsbCommands, generateSimCommands }
