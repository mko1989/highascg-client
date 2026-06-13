/**
 * Start/stop ALSA capture directly on a program (or any) Caspar channel/layer.
 */
import { api } from './api-client.js'

/**
 * @param {string} device - e.g. alsa://hw:0,0 or hw:0,0
 */
export function normalizeAlsaClip(device) {
	const d = String(device || '').trim()
	if (!d) return ''
	if (d.startsWith('alsa://')) return d
	return `alsa://${d}`
}

/**
 * @param {number} channel
 * @param {number} layer
 * @param {string} device
 * @param {{ audioOnly?: boolean }} [opts]
 */
export async function playLiveAudioOnChannel(channel, layer, device, opts = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const ln = Math.max(1, parseInt(String(layer), 10) || 1)
	const clip = normalizeAlsaClip(device)
	if (!clip) throw new Error('No capture device selected')
	const cl = `${ch}-${ln}`
	await api.post('/api/raw', { cmd: `STOP ${cl}` })
	await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
	await api.post('/api/raw', { cmd: `PLAY ${cl} ${clip} LOOP` })
	if (opts.audioOnly !== false) {
		await api.post('/api/raw', { cmd: `MIXER ${cl} OPACITY 0` })
	}
}

/**
 * @param {number} channel
 * @param {number} layer
 */
export async function stopLiveAudioOnChannel(channel, layer) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const ln = Math.max(1, parseInt(String(layer), 10) || 1)
	const cl = `${ch}-${ln}`
	await api.post('/api/raw', { cmd: `STOP ${cl}` })
	await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
}
