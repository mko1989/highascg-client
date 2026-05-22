#!/usr/bin/env node
/**
 * Start HighAsCG in simulation mode (--no-caspar) from exFAT labelled HIGHASCGEXF:
 *   app root = {volume}/sim/highascg   (preferred)
 *
 * Fallback (no labelled volume): use current working directory when it contains package.json,
 * so `npm run portable:sim` works from a normal repo clone without the stick plugged in.
 *
 * Usage:
 *   node tools/portable-desktop/launch-sim-from-exfat.js [extra args … passed to index.js]
 *   HIGHASCG_EXFAT_ROOT=E:\  node ...
 *   SIM_USE_CWD=1 node ...        # force cwd as app root
 *   --use-cwd                      # same, as flag
 *   HIGHASCG_LAUNCH_PORT_FALLBACK=N  # try next ports if busy; injects --port
 *   HIGHASCG_LAUNCH_NO_OFFLINE_DEFAULT=1  # do not default HIGHASCG_OFFLINE_MODE=1
 *
 * @see tools/portable-desktop/README.md
 * @see work/work-orders/50_WO_WINDOWS_MAC_EXFAT_SIMULATION_LAUNCHERS.md
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const net = require('net')
const { spawn, execFileSync } = require('child_process')

const DEFAULT_LABEL = process.env.HIGHASCG_EXFAT_LABEL || 'HIGHASCGEXF'
const DEFAULT_PORT_FALLBACK = 4200
const DEFAULT_BIND_ADDRESS = '0.0.0.0'

function getWindowsDriveForLabel(label) {
	const esc = String(label).replace(/'/g, "''")
	const ps = `Get-Volume | Where-Object FileSystemLabel -eq '${esc}' | Select-Object -First 1 | ForEach-Object { $_.DriveLetter }`
	try {
		const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
			encoding: 'utf8',
			windowsHide: true,
			timeout: 15000,
		}).trim()
		const letter = out.split(/\s+/).filter(Boolean)[0]
		if (letter && /^[A-Za-z]$/.test(letter)) {
			return `${letter.toUpperCase()}:`
		}
	} catch (_) {
		/* ignore */
	}
	return null
}

function resolveExfatVolumeRoot() {
	const override = process.env.HIGHASCG_EXFAT_ROOT
	if (override) {
		return path.resolve(override.replace(/[/\\]+$/, ''))
	}
	const label = DEFAULT_LABEL
	const platform = process.platform
	if (platform === 'darwin') {
		const vol = path.join('/Volumes', label)
		if (fs.existsSync(vol) && fs.statSync(vol).isDirectory()) return vol
		try {
			for (const name of fs.readdirSync('/Volumes')) {
				if (name === label || name.startsWith(`${label} `)) {
					const candidate = path.join('/Volumes', name)
					if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
				}
			}
		} catch (_) {
			/* ignore */
		}
	}
	if (platform === 'win32') {
		const drive = getWindowsDriveForLabel(label)
		if (drive && fs.existsSync(drive)) return drive
	}
	if (platform === 'linux') {
		const u = os.userInfo().username
		const tries = [
			path.join('/media', u, label),
			path.join('/run/media', u, label),
			path.join('/mnt', label),
		]
		for (const t of tries) {
			if (fs.existsSync(t) && fs.statSync(t).isDirectory()) return t
		}
		try {
			const out = execFileSync('findmnt', ['-n', '-o', 'TARGET', `-L${label}`], {
				encoding: 'utf8',
				timeout: 5000,
			}).trim()
			if (out && fs.existsSync(out)) return out
		} catch (_) {
			/* ignore */
		}
	}
	return null
}

/** @returns {{ appRoot: string, source: string }} */
function resolveAppRoot() {
	const override = process.env.HIGHASCG_EXFAT_APP_ROOT
	if (override) {
		const r = path.resolve(override)
		if (fs.existsSync(path.join(r, 'package.json'))) return { appRoot: r, source: 'HIGHASCG_EXFAT_APP_ROOT' }
		console.error('[HighAsCG sim] HIGHASCG_EXFAT_APP_ROOT missing package.json')
		process.exit(1)
	}
	const volFromEnv = process.env.HIGHASCG_EXFAT_ROOT
	if (volFromEnv) {
		const vr = path.resolve(volFromEnv.replace(/[/\\]+$/, ''))
		const sim = path.join(vr, 'sim', 'highascg')
		if (fs.existsSync(path.join(sim, 'package.json'))) return { appRoot: sim, source: 'HIGHASCG_EXFAT_ROOT+sim/highascg' }
		if (fs.existsSync(path.join(vr, 'package.json')))
			return { appRoot: vr, source: 'HIGHASCG_EXFAT_ROOT(root=app)' }
		console.error(`[HighAsCG sim] HIGHASCG_EXFAT_ROOT set but no package.json under ${sim} or ${vr}`)
		process.exit(1)
	}

	const forceCwd =
		process.argv.includes('--use-cwd') ||
		process.env.SIM_USE_CWD === '1' ||
		process.env.HIGHASCG_SIM_USE_CWD === '1'

	if (!forceCwd) {
		const vol = resolveExfatVolumeRoot()
		if (vol) {
			const sim = path.join(vol, 'sim', 'highascg')
			if (fs.existsSync(path.join(sim, 'package.json'))) return { appRoot: sim, source: `volume ${DEFAULT_LABEL}` }
		}
	}

	const cwd = process.cwd()
	if (forceCwd && fs.existsSync(path.join(cwd, 'package.json'))) {
		return { appRoot: cwd, source: 'SIM_USE_CWD (--use-cwd)' }
	}
	if (!forceCwd && fs.existsSync(path.join(cwd, 'package.json'))) {
		return {
			appRoot: cwd,
			source: '(no labelled exFAT; using cwd — dev fallback — plug HIGHASCGEXF or set HIGHASCG_EXFAT_ROOT)',
		}
	}

	return { appRoot: '', source: '' }
}

/**
 * HTTP listen targets for preflight + browser URL: follows `index.js` / `ConfigManager` enough
 * for port probe (monolithic file, modular `config/server.json`, or `HIGHASCG_CONFIG_PATH`).
 *
 * @param {string} appRoot
 * @returns {{ httpPort: number, serverBindAddress: string }}
 */
function resolveHttpListenTargets(appRoot) {
	let httpPort = DEFAULT_PORT_FALLBACK
	let serverBindAddress = DEFAULT_BIND_ADDRESS

	const modularDir = path.join(appRoot, 'config')
	const modularServerJson = path.join(modularDir, 'server.json')
	const monolithic = path.join(appRoot, 'highascg.config.json')
	const forcedPath = process.env.HIGHASCG_CONFIG_PATH

	try {
		if (forcedPath) {
			const rp = path.resolve(forcedPath)
			if (fs.existsSync(rp) && fs.statSync(rp).isFile()) {
				const j = JSON.parse(fs.readFileSync(rp, 'utf8'))
				const p = j?.server && Number(j.server.httpPort)
				if (Number.isFinite(p) && p > 0) httpPort = p
				if (typeof j?.server?.bindAddress === 'string' && j.server.bindAddress.trim())
					serverBindAddress = j.server.bindAddress.trim()
			} else if (fs.existsSync(rp) && fs.statSync(rp).isDirectory()) {
				const sj = path.join(rp, 'server.json')
				if (fs.existsSync(sj)) {
					const j = JSON.parse(fs.readFileSync(sj, 'utf8'))
					const p = Number(j?.httpPort)
					if (Number.isFinite(p) && p > 0) httpPort = p
					if (typeof j?.bindAddress === 'string' && j.bindAddress.trim())
						serverBindAddress = j.bindAddress.trim()
				}
			}
		} else if (fs.existsSync(modularDir) && fs.statSync(modularDir).isDirectory()) {
			/* `index.js`: modular `config/` replaces monolithic path when present — do not read both. */
			if (fs.existsSync(modularServerJson)) {
				const j = JSON.parse(fs.readFileSync(modularServerJson, 'utf8'))
				const p = Number(j?.httpPort)
				if (Number.isFinite(p) && p > 0) httpPort = p
				if (typeof j?.bindAddress === 'string' && j.bindAddress.trim())
					serverBindAddress = j.bindAddress.trim()
			}
		} else if (fs.existsSync(monolithic)) {
			const j = JSON.parse(fs.readFileSync(monolithic, 'utf8'))
			const p = j?.server && Number(j.server.httpPort)
			if (Number.isFinite(p) && p > 0) httpPort = p
			if (typeof j?.server?.bindAddress === 'string' && j.server.bindAddress.trim())
				serverBindAddress = j.server.bindAddress.trim()
		}
	} catch (_) {
		/* keep defaults */
	}

	const envHttp = process.env.HTTP_PORT ?? process.env.PORT ?? process.env.HIGHASCG_PORT
	if (envHttp !== undefined && envHttp !== '') {
		const n = parseInt(String(envHttp), 10)
		if (Number.isFinite(n) && n > 0) httpPort = n
	}
	if (process.env.BIND_ADDRESS) serverBindAddress = process.env.BIND_ADDRESS

	return { httpPort, serverBindAddress }
}

/** @returns {Promise<boolean>} */
function canBindTcpOnce(port, bindAddress) {
	return new Promise((resolve, reject) => {
		const srv = net.createServer()
		srv.once('error', (err) => {
			const ne = /** @type {NodeJS.ErrnoException} */ (err)
			if (ne.code === 'EADDRINUSE') resolve(false)
			else reject(err)
		})
		srv.listen(port, bindAddress, () => {
			srv.close((closeErr) => {
				if (closeErr) reject(closeErr)
				else resolve(true)
			})
		})
	})
}

/**
 * First free port starting at base (inclusive); maxExtra Steps = successive +1 offsets.
 *
 * @param {number} basePort
 * @param {string} bindAddress
 * @param {number} maxExtra
 */
async function pickFirstBindableTcpPort(basePort, bindAddress, maxExtra) {
	const cap = Math.max(0, Math.min(Number(maxExtra) || 0, 127))
	let lastBusy = basePort
	for (let step = 0; step <= cap; step++) {
		const port = basePort + step
		if (await canBindTcpOnce(port, bindAddress)) {
			if (step > 0)
				console.error(
					`[HighAsCG sim] TCP ${bindAddress}:${basePort} busy — using ${port} (HIGHASCG_LAUNCH_PORT_FALLBACK=${cap}; pass --port explicitly to override probe).`,
				)
			return port
		}
		lastBusy = port
	}
	throw new Error(
		`TCP ${bindAddress}:${basePort}–${lastBusy} all unavailable (busy or permissions). Stop other listeners, change server.httpPort, or set HIGHASCG_LAUNCH_PORT_FALLBACK=${cap}. ` +
			`(HIGHASCG_LAUNCH_SKIP_PORT_CHECK=1 skips this probe.)`,
	)
}

function argvHasExplicitHttpPort(argv) {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--port' || argv[i] === '-p') return true
	}
	return false
}

function filterArgsForIndex() {
	const skip = new Set(['--use-cwd'])
	return process.argv.slice(2).filter((a) => !skip.has(a))
}

function openBrowser(url) {
	if (process.env.HIGHASCG_LAUNCH_NO_BROWSER === '1') return
	const { spawn } = require('child_process')
	try {
		if (process.platform === 'win32') {
			spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
		} else if (process.platform === 'darwin') {
			spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
		} else {
			spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
		}
	} catch (_) {
		/* ignore */
	}
}

async function main() {
	const resolved = resolveAppRoot()
	const appRoot = resolved.appRoot
	if (!appRoot || !fs.existsSync(path.join(appRoot, 'package.json'))) {
		console.error('')
		console.error('[HighAsCG sim] Could not find app root (need package.json).')
		console.error(`  Preferred: HIGHASCGEXF at .../sim/highascg (${DEFAULT_LABEL} volume).`)
		console.error(
			'  Or set HIGHASCG_EXFAT_ROOT to the stick root (e.g. E:\\ or /Volumes/HIGHASCGEXF), HIGHASCG_EXFAT_APP_ROOT to sim/highascg,',
		)
		console.error('  run from repo root (`npm run portable:sim`), or pass --use-cwd from sim/highascg.')
		console.error('  See tools/portable-desktop/README.md')
		process.exit(1)
	}

	console.error(`[HighAsCG sim] Resolved app root (${resolved.source})`)
	console.error(`[HighAsCG sim] cwd: ${appRoot}`)

	const nm = path.join(appRoot, 'node_modules')
	if (!fs.existsSync(nm)) {
		console.error(`[HighAsCG sim] Missing node_modules — run once: cd "${appRoot}" && npm ci`)
		process.exit(1)
	}
	const indexJs = path.join(appRoot, 'index.js')
	if (!fs.existsSync(indexJs)) {
		console.error(`[HighAsCG sim] Missing ${indexJs}`)
		process.exit(1)
	}

	const resolvedListen = resolveHttpListenTargets(appRoot)
	const extras = filterArgsForIndex()

	let chosenHttpPort = resolvedListen.httpPort
	if (process.env.HIGHASCG_LAUNCH_SKIP_PORT_CHECK !== '1') {
		try {
			const maxFb = parseInt(String(process.env.HIGHASCG_LAUNCH_PORT_FALLBACK || ''), 10)
			const fb = Number.isFinite(maxFb) && maxFb >= 0 ? maxFb : 0
			chosenHttpPort = await pickFirstBindableTcpPort(resolvedListen.httpPort, resolvedListen.serverBindAddress, fb)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			console.error('')
			console.error(`[HighAsCG sim] ${msg}`)
			console.error('')
			process.exit(1)
		}
	}

	const browserHost = process.env.HIGHASCG_BIND_ADDRESS || process.env.HIGHASCG_LAUNCH_BROWSER_HOST || '127.0.0.1'
	const url = `http://${browserHost}:${chosenHttpPort}/`

	const omitInjectPort =
		process.env.HIGHASCG_LAUNCH_INJECT_CLI_PORT === '0' ||
		process.env.HIGHASCG_LAUNCH_SKIP_PORT_CHECK === '1'
	const injectCliPort =
		!omitInjectPort && chosenHttpPort > 0 && !argvHasExplicitHttpPort(extras)
	const childParts = injectCliPort
		? [indexJs, '--no-caspar', '--port', String(chosenHttpPort), ...extras]
		: [indexJs, '--no-caspar', ...extras]

	const skipOfflineDefault = process.env.HIGHASCG_LAUNCH_NO_OFFLINE_DEFAULT === '1'
	const offlineInjector =
		skipOfflineDefault ||
		(process.env.HIGHASCG_OFFLINE_MODE !== undefined && process.env.HIGHASCG_OFFLINE_MODE !== '')
			? {}
			: { HIGHASCG_OFFLINE_MODE: '1' }

	const childArgs = childParts
	console.error(`[HighAsCG sim] spawn: ${process.execPath} ${childArgs.join(' ')}`)

	const browserTimer =
		process.env.HIGHASCG_LAUNCH_NO_BROWSER === '1'
			? null
			: setTimeout(() => {
					console.error(`[HighAsCG sim] opening ${url}`)
					openBrowser(url)
			  }, Number(process.env.HIGHASCG_LAUNCH_BROWSER_DELAY_MS || 2500))

	const child = spawn(process.execPath, childArgs, {
		cwd: appRoot,
		stdio: 'inherit',
		env: {
			...process.env,
			HIGHASCG_SIM_LAUNCHER: '1',
			...offlineInjector,
		},
	})

	const cleanupBrowser = () => {
		if (browserTimer) clearTimeout(browserTimer)
	}
	child.on('exit', (code, signal) => {
		cleanupBrowser()
		if (signal) process.kill(process.pid, signal)
		else process.exit(code === null ? 1 : code)
	})
	child.on('error', (err) => {
		cleanupBrowser()
		console.error('[HighAsCG sim] spawn failed:', err.message)
		process.exit(1)
	})
	for (const sig of /** @type {const} */ ['SIGINT', 'SIGTERM']) {
		process.on(sig, () => {
			try {
				child.kill(sig)
			} catch (_) {
				/* ignore */
			}
		})
	}
}

main().catch((e) => {
	const msg = e instanceof Error ? e.message : String(e)
	console.error('[HighAsCG sim]', msg)
	process.exit(1)
})
