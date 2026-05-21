/**
 * Channel routing map and data resolution logic.
 */
'use strict'

const { routingDestinationsFromConfig } = require('./screen-destinations')

function readCasparSetting(cfg, key) {
	if (!cfg || typeof cfg !== 'object') return undefined
	const cs = cfg.casparServer && typeof cfg.casparServer === 'object' ? cfg.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, key)) return cs[key]
	if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key]
	return undefined
}

function inferGraphMainUsage(config) {
	const out = {
		maxMainCount: 0,
		pgmOnlyMainIndices: new Set(),
	}
	const graph = config?.deviceGraph
	if (!graph || !Array.isArray(graph.edges) || !Array.isArray(graph.connectors)) return out
	const byConnId = new Map(graph.connectors.map((c) => [String(c?.id || ''), c]))
	for (const e of graph.edges) {
		const srcId = String(e?.sourceId || '')
		if (!srcId) continue
		const m = srcId.match(/^dst_ch(\d+)$/i)
		if (m) {
			const n = parseInt(m[1], 10)
			if (Number.isFinite(n) && n >= 1) {
				out.maxMainCount = Math.max(out.maxMainCount, n)
				out.pgmOnlyMainIndices.add(n - 1)
			}
			continue
		}
		const srcConn = byConnId.get(srcId)
		if (!srcConn || srcConn.kind !== 'destination_in') continue
		const ref = String(srcConn.externalRef || '').trim()
		if (!ref) continue
		const topDests = routingDestinationsFromConfig(config) ?? []
		const match = topDests.find((d) => String(d?.id || '') === ref)
		if (!match) continue
		const idx = Math.max(0, parseInt(String(match.mainScreenIndex ?? 0), 10) || 0)
		out.maxMainCount = Math.max(out.maxMainCount, idx + 1)
	}
	return out
}

function resolveMainScreenCount(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	const a = parseInt(String(config?.screen_count ?? ''), 10); const b = parseInt(String(cs?.screen_count ?? ''), 10)
	const nA = Number.isFinite(a) && a >= 1 ? a : 1
	const nB = Number.isFinite(b) && b >= 1 ? b : 1
	const graphMainUsage = inferGraphMainUsage(config)
	const routedDests = routingDestinationsFromConfig(config)
	if (routedDests === null) {
		return Math.max(1, Math.max(nA, nB, graphMainUsage.maxMainCount))
	}
	if (routedDests.length === 0) {
		return Math.max(1, graphMainUsage.maxMainCount)
	}
	const routableDests = routedDests.filter((d) => {
		const mode = String(d?.mode || 'pgm_prv')
		return mode !== 'multiview' && mode !== 'stream'
	})
	// When destinations exist, drive screen count from topology only — stale casparServer.screen_count must not spawn extra PGM/PRV pairs.
	if (routableDests.length > 0) {
		const fromDest = Math.max(
			...routableDests.map((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0) + 1)
		)
		return Math.max(1, fromDest, graphMainUsage.maxMainCount)
	}
	// Destinations exist but none are PGM/PRV mains (only multiview/stream): one main bus — do not inherit stale screen_count from disk.
	return Math.max(1, graphMainUsage.maxMainCount)
}

function resolvePreviewEnabledByMain(config, screenCount) {
	const dests = routingDestinationsFromConfig(config) ?? []
	const graphMainUsage = inferGraphMainUsage(config)
	const withMode = dests.filter(d => {
		const mode = String(d?.mode || 'pgm_prv')
		return mode !== 'multiview' && mode !== 'stream'
	})
	if (!withMode.length) {
		return Array.from({ length: screenCount }, (_, idx) => !graphMainUsage.pgmOnlyMainIndices.has(idx))
	}
	const out = Array.from({ length: screenCount }, () => true)
	for (let idx = 0; idx < screenCount; idx++) {
		const perMain = withMode.filter(d => (parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === idx)
		if (!perMain.length) {
			if (graphMainUsage.pgmOnlyMainIndices.has(idx)) out[idx] = false
			continue
		}
		const picked = perMain.find(d => String(d.mode || 'pgm_prv') === 'pgm_prv') || perMain[0]
		out[idx] = String(picked.mode || 'pgm_prv') !== 'pgm_only'
	}
	return out
}

function resolveDecklinkInputDeviceIndex(cfg, i) {
	const raw = readCasparSetting(cfg, `decklink_input_${i}_device`)
	if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === '0') return i
	const n = parseInt(String(raw), 10); return Number.isFinite(n) && n > 0 ? n : i
}

function getRouteString(channel, layer) {
	return (layer !== undefined && layer !== null) ? `route://${channel}-${layer}` : `route://${channel}`
}



function getChannelMap(config, activeBuses = null) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const virtualMainChannels = Array.isArray(config?.virtual_main_channels) ? config.virtual_main_channels : (Array.isArray(cs?.virtual_main_channels) ? cs.virtual_main_channels : [])
	const useVirtual = virtualMainChannels.length > 0
	const screenCount = useVirtual ? Math.max(1, virtualMainChannels.length) : resolveMainScreenCount(config)
	const previewEnabledByMain = useVirtual ? Array.from({ length: screenCount }, (_, i) => { const v = virtualMainChannels[i] || {}; return !(v.prv == null || String(v.prv).trim() === '') })
		: resolvePreviewEnabledByMain(config, screenCount) || Array.from({ length: screenCount }, () => true)

	const decklinkCount = Math.min(8, Math.max(0, parseInt(String(config?.decklink_input_count ?? cs.decklink_input_count ?? 0), 10) || 0))
	const inputsHostChannelEnabled = readCasparSetting(config, 'decklink_inputs_host_channel_enabled') === true || readCasparSetting(config, 'decklink_inputs_host_channel_enabled') === 'true'
	const inputsEnabled = decklinkCount > 0 || inputsHostChannelEnabled
	const extraAudioCount = Math.min(4, Math.max(0, parseInt(String(config?.extra_audio_channel_count ?? cs.extra_audio_channel_count ?? 0), 10) || 0))

	const programChannels = []; const previewChannels = []
	const switcherBus1Channels = []
	const switcherBusChannels = []
	// Switcher-bus (3-channel per destination) is retired.
	// Keep transition model forced to 2-channel PGM/PRV flow.
	const switcherBusMode = false
	if (useVirtual) {
		for (let i = 0; i < screenCount; i++) {
			const v = virtualMainChannels[i] || {}
			const pgm = parseInt(v.pgm, 10) || 1
			// When prv is empty/missing, preview is disabled for this main — do not default to pgm
			const prvRaw = v.prv != null && String(v.prv).trim() !== '' ? parseInt(v.prv, 10) : null
			const prv = prvRaw != null && Number.isFinite(prvRaw) && prvRaw >= 1 ? prvRaw : null
			programChannels.push(pgm)
			previewChannels.push(previewEnabledByMain[i] && prv != null ? prv : null)
			switcherBus1Channels.push(prv)
			switcherBusChannels.push(null)
		}
		// Warn about duplicate channel assignments in virtual mode
		const allAssigned = [...programChannels, ...previewChannels.filter(Boolean)]
		const seen = new Set()
		for (const ch of allAssigned) {
			if (seen.has(ch)) {
				if (typeof console !== 'undefined') console.warn(`[routing-map] Warning: duplicate channel number ${ch} in virtual main channel assignments`)
			}
			seen.add(ch)
		}
	} else {
		let ch = 1
		for (let i = 0; i < screenCount; i++) {
			if (switcherBusMode) {
				const out = ch++
				if (previewEnabledByMain[i]) {
					const bus1 = ch++
					const bus2 = ch++
					programChannels.push(out)
					previewChannels.push(bus1)
					switcherBus1Channels.push(bus1)
					switcherBusChannels.push(bus2)
				} else {
					programChannels.push(out)
					previewChannels.push(null)
					switcherBus1Channels.push(null)
					switcherBusChannels.push(null)
				}
			} else {
				const pgm = ch++
				const prv = previewEnabledByMain[i] ? ch++ : null
				programChannels.push(pgm)
				previewChannels.push(prv)
				switcherBus1Channels.push(prv)
				switcherBusChannels.push(null)
			}
		}
	}

	let nextCh = Math.max(0, ...programChannels, ...previewChannels.filter(c => c != null), ...switcherBusChannels.filter(c => c != null)) + 1
	
	const mvDests = (routingDestinationsFromConfig(config) ?? []).filter((d) => d && String(d.mode || '').toLowerCase() === 'multiview')
	
	const multiviewChannels = []
	if (mvDests.length > 0) {
		mvDests.forEach(() => multiviewChannels.push(nextCh++))
	}
	const multiviewCh = multiviewChannels[0] || null
	const mvMode = String(readCasparSetting(config, 'multiview_mode') ?? '1080p5000')
	const inMode = String(readCasparSetting(config, 'inputs_channel_mode') ?? '1080p5000')
	const decklinkInputsHost = String(readCasparSetting(config, 'decklink_inputs_host') ?? 'multiview_if_match').toLowerCase()

	const inputsOnMvr =
		inputsEnabled && multiviewCh != null && mvMode === inMode && decklinkInputsHost !== 'preview_1'
	let inputsCh = null; if (inputsEnabled) {
		if (decklinkInputsHost === 'preview_1') inputsCh = previewChannels[0] || 1
		else if (inputsOnMvr) inputsCh = multiviewCh
		else inputsCh = nextCh++
	}

	const audioOnlyChannels = []; for (let i = 0; i < extraAudioCount; i++) audioOnlyChannels.push(nextCh++)
	
	/** @deprecated Always empty — pixel-map DeckLink routing is merged onto the program channel in generated Caspar XML. */
	const mappingChannels = []

	const monitorChannelEnabled = cs.monitor_channel_enabled === true || cs.monitor_channel_enabled === 'true'
	const monitorCh = monitorChannelEnabled ? nextCh++ : null

	const result = {
		screenCount,
		/** True only when at least one multiview Caspar channel is allocated (topology includes a multiview destination). */
		multiviewEnabled: multiviewChannels.length > 0,
		inputsEnabled,
		inputsOnMvr,
		decklinkInputsHost,
		decklinkCount,
		programCh: (n) => programChannels[n - 1] || programChannels[0],
		previewCh: (n) => {
			const idx = n - 1
			if (idx >= 0 && idx < previewChannels.length) {
				if (switcherBusMode && activeBuses) {
					const pgm = programChannels[idx]
					const active = Number(activeBuses[String(pgm)] || switcherBus1Channels[idx])
					const bus1 = Number(switcherBus1Channels[idx])
					const bus2 = Number(switcherBusChannels[idx])
					if (bus1 > 0 && bus2 > 0) return active === bus1 ? bus2 : bus1
				}
				return previewChannels[idx]
			}
			return null
		},
		programChannels, previewChannels, 
		playbackChannels: switcherBusMode ? switcherBus1Channels : programChannels,
		previewEnabledByMain, multiviewCh, inputsCh, audioOnlyChannels,
		mappingChannels,
		monitorCh,
		switcherBus1Channels,
		switcherBusMode,
		switcherBusChannels,
		transitionModel: switcherBusMode ? 'switcher_bus' : 'dynamic_layer',
		streamingCh: null,
		streamingDedicatedChannelSlot: false,
		streamingAttachToChannel: null,
		streamingContentLayer: 10,
		inputsHostChannelEnabled, useVirtual, virtualMainChannels,
		multiviewChannels
	}

	return result
}

function resolveStreamingChannelRouteForRole(config, role = 'video') {
	return null
}

module.exports = {
	getChannelMap,
	getRouteString,
	resolveMainScreenCount,
	resolvePreviewEnabledByMain,
	resolveStreamOutputCasparChannel: () => null,
	resolveDecklinkInputDeviceIndex,
	readCasparSetting,
	resolveStreamingChannelRoute: () => null,
	resolveStreamingChannelRouteForRole: () => null,
}
