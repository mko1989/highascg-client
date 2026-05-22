/**
 * ALSA / USB live audio inputs (inputs host layers 10+).
 * @see from_server/ALSA_LIVE_AUDIO_CLIENT.md
 */

export const LIVE_AUDIO_MAX_SLOTS = 8
export const LIVE_AUDIO_LAYER_BASE = 10

/** 1-based slot → layer on shared inputs host channel. */
export function liveAudioHostLayer(slot) {
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1) return LIVE_AUDIO_LAYER_BASE
	return LIVE_AUDIO_LAYER_BASE + n - 1
}

export function liveAudioRouteValue(inputsCh, slot) {
	if (inputsCh == null) return ''
	return `route://${inputsCh}-${liveAudioHostLayer(slot)}`
}

/**
 * @param {Record<string, unknown>} cs - casparServer settings slice
 */
export function readLiveAudioCasparSettings(cs) {
	const c = cs && typeof cs === 'object' ? cs : {}
	const count = Math.max(0, Math.min(LIVE_AUDIO_MAX_SLOTS, parseInt(String(c.live_audio_input_count ?? '0'), 10) || 0))
	const slots = []
	for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
		slots.push(String(c[`live_audio_input_${i}_device`] ?? '').trim())
	}
	const ar = c.audioRouting && typeof c.audioRouting === 'object' ? c.audioRouting : {}
	const ap = ar.audioPreview && typeof ar.audioPreview === 'object' ? ar.audioPreview : {}
	return {
		count,
		slots,
		pgmAlwaysOn: c.live_audio_pgm_always_on !== false && c.live_audio_pgm_always_on !== 'false',
		pgmScreen: parseInt(String(c.live_audio_pgm_screen ?? '1'), 10) || 1,
		pgmLayer: parseInt(String(c.live_audio_pgm_layer ?? '2'), 10) || 2,
		pgmAudioOnly: c.live_audio_pgm_audio_only !== false && c.live_audio_pgm_audio_only !== 'false',
		hostChannelEnabled:
			c.live_audio_inputs_host_channel_enabled === true || c.live_audio_inputs_host_channel_enabled === 'true',
		inputsChannelMode: String(c.live_audio_inputs_channel_mode || '1080p5000'),
		audioPreviewEnabled:
			ap.enabled === true ||
			ap.enabled === 'true' ||
			c.audio_preview_enabled === true ||
			c.audio_preview_enabled === 'true',
		audioPreviewBus: String(ap.bus || c.audio_preview_bus || 'preview_1'),
		audioPreviewScreen: parseInt(String(ap.screenIndex ?? c.audio_preview_screen ?? '1'), 10) || 1,
		audioPreviewDevice: String(ap.deviceName || c.audio_preview_device_name || '').trim(),
		audioPreviewDefaultSource: String(ap.defaultSource || c.audio_preview_default_source || 'preview_1'),
	}
}

/**
 * @param {ReturnType<typeof readLiveAudioCasparSettings>} ui
 */
export function buildLiveAudioConfigBody(ui) {
	const body = {
		live_audio_input_count: ui.count,
		live_audio_pgm_always_on: ui.pgmAlwaysOn,
		live_audio_pgm_screen: ui.pgmScreen,
		live_audio_pgm_layer: ui.pgmLayer,
		live_audio_pgm_audio_only: ui.pgmAudioOnly,
		live_audio_inputs_host_channel_enabled: ui.hostChannelEnabled,
		live_audio_inputs_channel_mode: ui.inputsChannelMode,
		audio_preview_enabled: ui.audioPreviewEnabled,
		audio_preview_bus: ui.audioPreviewBus,
		audio_preview_screen: ui.audioPreviewScreen,
		audio_preview_device_name: ui.audioPreviewDevice,
		audio_preview_default_source: ui.audioPreviewDefaultSource,
	}
	for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
		body[`live_audio_input_${i}_device`] = ui.slots[i - 1] || ''
	}
	return body
}

/**
 * @param {Array<{ id?: string, name?: string, card?: number, device?: number, type?: string }>} devices
 * @returns {{ value: string, label: string }[]}
 */
export function alsaCaptureDeviceOptions(devices) {
	const out = [{ value: '', label: '— none —' }]
	const seen = new Set()
	for (const d of devices || []) {
		if (!d || d.type !== 'alsa') continue
		const id = String(d.id || '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		const name = String(d.name || id).trim()
		out.push({ value: id, label: name === id ? id : `${name} (${id})` })
	}
	return out
}

/**
 * @param {object | null | undefined} channelMap
 * @param {object | null | undefined} [configured] - from GET /api/audio/live-inputs
 */
export function buildLiveAudioSources(channelMap, configured) {
	const sources = []
	if (!channelMap) return sources
	const inputsCh = channelMap.inputsCh
	const count =
		parseInt(String(channelMap.liveAudioCount ?? configured?.liveAudioCount ?? '0'), 10) || 0
	if (inputsCh == null || count <= 0) return sources

	const slots = Array.isArray(configured?.configured?.slots) ? configured.configured.slots : []
	for (let slot = 1; slot <= count; slot++) {
		const row = slots.find((s) => s && Number(s.slot) === slot) || null
		const layer = row?.layer != null ? Number(row.layer) : liveAudioHostLayer(slot)
		const route = row?.route || liveAudioRouteValue(inputsCh, slot)
		const label = row?.label || `Live audio ${slot}`
		sources.push({
			type: 'live_audio',
			routeType: 'live_audio',
			value: String(slot),
			label,
			route,
			liveAudioSlot: slot,
			inputsChannel: inputsCh,
			inputsLayer: layer,
			thumbnailChannel: inputsCh,
		})
	}
	return sources
}

/**
 * @param {object | null | undefined} status - liveAudioInputsStatus
 * @param {number} slot - 1-based
 */
export function liveAudioSlotStatusMessage(status, slot) {
	if (status == null || typeof status !== 'object') return ''
	if (status.enabled === false && status.reason === 'amcp_disconnected') {
		return 'AMCP offline — live audio not started'
	}
	const failed = Array.isArray(status.failed)
		? status.failed.find((x) => x && (x.slot === slot || x.layer === liveAudioHostLayer(slot)))
		: null
	if (failed) return (failed.message && String(failed.message)) || 'PLAY failed on this slot'
	const ok = Array.isArray(status.started)
		? status.started.find((x) => x && (x.slot === slot || x.layer === liveAudioHostLayer(slot)))
		: null
	if (ok) return 'Running on inputs host'
	return ''
}
