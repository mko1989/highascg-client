'use strict'

const isoEl = document.getElementById('isoPath')
const appEl = document.getElementById('appPath')
const cmds = document.getElementById('cmds')
const status = document.getElementById('status')

let isoPath = null
let appPath = null

function setStatus(msg, kind) {
	status.textContent = msg
	status.className = kind || ''
}

function setPath(el, p) {
	el.textContent = p || '(not set)'
	el.classList.toggle('set', Boolean(p))
}

async function copyCommands() {
	const text = cmds.value.trim()
	if (!text) {
		setStatus('Nothing to copy.', 'err')
		return
	}
	await window.highascg.copyText(text)
	setStatus('Copied to clipboard.', 'ok')
}

function requirePaths(needIso) {
	if (needIso && !isoPath) {
		setStatus('Open an ISO first.', 'err')
		return false
	}
	if (!appPath) {
		setStatus('Open HighAsCG first.', 'err')
		return false
	}
	return true
}

document.getElementById('btnIso').onclick = async () => {
	const p = await window.highascg.pickIso()
	if (p) {
		isoPath = p
		setPath(isoEl, p)
	}
}

document.getElementById('btnApp').onclick = async () => {
	const p = await window.highascg.pickApp()
	if (p) {
		appPath = p
		setPath(appEl, p)
	}
}

document.getElementById('btnUsb').onclick = async () => {
	if (!requirePaths(true)) return
	try {
		cmds.value = await window.highascg.usbCommands(isoPath, appPath)
		await copyCommands()
		setStatus('Copied. Run Block B, then Block C only — not the mkdir lines until HIGHASCGEXF mounts.', 'ok')
	} catch (e) {
		setStatus(e.message || String(e), 'err')
	}
}

document.getElementById('btnSim').onclick = async () => {
	if (!requirePaths(false)) return
	try {
		const r = await window.highascg.runSim(appPath)
		cmds.value = r.commands || ''
		await copyCommands()
		if (r.started) setStatus('Simulation starting — check Terminal.', 'ok')
		else setStatus(r.note || 'Commands copied.', 'ok')
	} catch (e) {
		setStatus(e.message || String(e), 'err')
	}
}

document.getElementById('btnCopy').onclick = () => copyCommands()
