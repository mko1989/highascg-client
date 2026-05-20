/**
 * Per-screen global border read/write helpers for {@link SceneState}.
 * Extracted to keep `scene-state.js` under the sweep line limit.
 */
import { PIP_OVERLAY_MAP } from './pip-overlay-registry.js'

function normActivePgmLayer(v) {
	return Number(v) === 996 ? 996 : 998
}

export function sceneStateGetGlobalBorderForScreen(self, screenIdx) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const stored = self.globalBorders[m]
	if (stored) {
		// Always force `side: 'inside'` — the global border covers the full screen,
		// `outside` would push the frame past the viewport (scrollbars on the consumer).
		const snap =
			stored.pgmAirSnapshot && typeof stored.pgmAirSnapshot === 'object'
				? {
						...stored.pgmAirSnapshot,
						params: { ...(stored.pgmAirSnapshot.params || {}), side: 'inside' },
						activePgmLayer: normActivePgmLayer(stored.pgmAirSnapshot.activePgmLayer),
					}
				: null
		return {
			...stored,
			fadeDuration: stored.fadeDuration ?? 25,
			params: { ...(stored.params || {}), side: 'inside' },
			slices: Array.isArray(stored.slices) ? stored.slices : [],
			mirrorBorderOnPrv: stored.mirrorBorderOnPrv === true,
			activePgmLayer: normActivePgmLayer(stored.activePgmLayer),
			borderPresets: Array.isArray(stored.borderPresets) ? stored.borderPresets : [],
			pgmAirSnapshot: snap,
		}
	}
	const def = PIP_OVERLAY_MAP.get('border')
	return {
		enabled: false,
		type: 'border',
		fadeDuration: 25,
		params: { ...(def?.defaults || {}), side: 'inside' },
		slices: [],
		artnetPatch: { startChannel: 1, universe: 0 },
		/** When true, border control AMCP targets only the PRV Caspar channel (layer 997). */
		mirrorBorderOnPrv: false,
		activePgmLayer: 998,
		borderPresets: [],
		pgmAirSnapshot: null,
	}
}

export function sceneStateSetGlobalBorderForScreen(self, screenIdx, border) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const prev = sceneStateGetGlobalBorderForScreen(self, screenIdx)

	if (!self.borderJustEnabled) self.borderJustEnabled = {}
	if (border.enabled !== undefined && !prev.enabled && border.enabled) {
		self.borderJustEnabled[m] = true
	}
	if (border.type !== undefined && prev.type !== border.type) {
		self.borderJustEnabled[m] = true
	}

	let merged = { ...prev, ...border }
	const turningPrvOff = prev.mirrorBorderOnPrv === true && merged.mirrorBorderOnPrv === false
	if (turningPrvOff && prev.pgmAirSnapshot && typeof prev.pgmAirSnapshot === 'object') {
		const snap = prev.pgmAirSnapshot
		merged = {
			...merged,
			enabled: snap.enabled,
			type: snap.type,
			params: { ...(snap.params || {}), side: 'inside' },
			slices: Array.isArray(snap.slices) ? snap.slices : [],
			fadeDuration: snap.fadeDuration ?? merged.fadeDuration,
			artnetPatch: { startChannel: 1, universe: 0, ...(snap.artnetPatch || {}) },
			activePgmLayer: normActivePgmLayer(snap.activePgmLayer ?? merged.activePgmLayer),
			mirrorBorderOnPrv: false,
		}
	}

	if (border.slices != null) {
		merged.slices = Array.isArray(border.slices) ? border.slices : []
	}

	const nextParams = turningPrvOff
		? { ...merged.params, side: 'inside' }
		: border.params != null
			? { ...(prev.params || {}), ...border.params, side: 'inside' }
			: { ...(prev.params || {}), side: 'inside' }
	merged.params = nextParams
	merged.activePgmLayer = normActivePgmLayer(merged.activePgmLayer)
	if (!Array.isArray(merged.borderPresets)) merged.borderPresets = [...(prev.borderPresets || [])]

	self.globalBorders[m] = merged
	self.borderChanged = true
	self._softSave()
}

export function sceneStateNoteGlobalBorderPushedToPgm(self, screenIdx, slice) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	const snap = {
		enabled: slice.enabled !== undefined ? !!slice.enabled : !!cur.enabled,
		type: slice.type != null ? String(slice.type) : String(cur.type || 'border'),
		params: { ...(cur.params || {}), ...(slice.params || {}), side: 'inside' },
		slices: Array.isArray(slice.slices ?? cur.slices) ? (slice.slices ?? cur.slices) : [],
		fadeDuration: Math.max(0, parseInt(String(slice.fadeDuration ?? cur.fadeDuration ?? 25), 10) || 25),
		artnetPatch: { startChannel: 1, universe: 0, ...(slice.artnetPatch || cur.artnetPatch || {}) },
		activePgmLayer: normActivePgmLayer(slice.activePgmLayer ?? cur.activePgmLayer),
	}
	self.globalBorders[m] = { ...cur, pgmAirSnapshot: snap }
	self._softSave()
}

export function sceneStateGetGlobalBorderPresetSlotCount(self, screenIdx) {
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	const presets = cur.borderPresets || []
	const maxSlot = presets.reduce(
		(mx, p) => (p && Number.isFinite(Number(p.slot)) ? Math.max(mx, Number(p.slot)) : mx),
		0,
	)
	return Math.max(2, maxSlot + 2)
}

export function sceneStateSaveGlobalBorderPresetSlot(self, screenIdx, slotNum, name) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const sn = Math.max(1, Math.floor(Number(slotNum)) || 1)
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	const source = cur.pgmAirSnapshot && typeof cur.pgmAirSnapshot === 'object' ? cur.pgmAirSnapshot : cur
	const presets = [...(cur.borderPresets || [])]
	const idx = presets.findIndex((p) => p && Number(p.slot) === sn)
	const nm = String(name || `Preset ${sn}`).trim() || `Preset ${sn}`
	const entry = { slot: sn, name: nm, data }
	if (idx >= 0) presets[idx] = entry
	else presets.push(entry)
	presets.sort((a, b) => Number(a.slot) - Number(b.slot))
	self.globalBorders[m] = { ...cur, borderPresets: presets }
	self._save()
}

export function sceneStateDeleteGlobalBorderPresetSlot(self, screenIdx, slotNum) {
	const m = Math.max(0, Math.min(3, screenIdx))
	const sn = Math.floor(Number(slotNum))
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	const presets = (cur.borderPresets || []).filter((p) => !p || Number(p.slot) !== sn)
	self.globalBorders[m] = { ...cur, borderPresets: presets }
	self._save()
}

export function sceneStateGetGlobalBorderPreset(self, screenIdx, slotNum) {
	const cur = sceneStateGetGlobalBorderForScreen(self, screenIdx)
	const sn = Math.floor(Number(slotNum))
	return (cur.borderPresets || []).find((p) => p && Number(p.slot) === sn) || null
}

export function sceneStateSetGlobalBorder(self, sceneId, border) {
	const s = self.getScene(sceneId)
	if (s) {
		s.globalBorder = { ...s.globalBorder, ...border }
		self.borderChanged = true
		self._softSave()
	}
}
