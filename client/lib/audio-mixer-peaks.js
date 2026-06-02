/** @param {unknown[]} [levels] */
export function peakDbfsFromLevels(levels) {
	if (!Array.isArray(levels) || levels.length === 0) return NaN
	const L = levels[0]?.dBFS
	const R = levels[1]?.dBFS
	if (!Number.isFinite(L) && !Number.isFinite(R)) return NaN
	return Math.max(Number.isFinite(L) ? L : -99, Number.isFinite(R) ? R : -99)
}

/** @param {Record<string, string> | undefined} obj */
export function peakDbfsFromVarStrings(obj, chNum) {
	if (!obj || typeof obj !== 'object') return NaN
	const fromStr = (s) => {
		const t = String(s ?? '').trim()
		if (t === '') return NaN
		const n = parseFloat(t)
		return Number.isFinite(n) ? n : NaN
	}
	const vL = fromStr(obj[`osc_ch${chNum}_audio_L`])
	const vR = fromStr(obj[`osc_ch${chNum}_audio_R`])
	if (!Number.isFinite(vL) && !Number.isFinite(vR)) return NaN
	return Math.max(Number.isFinite(vL) ? vL : -99, Number.isFinite(vR) ? vR : -99)
}

/**
 * Bus peak dBFS: read OSC first (freshest, ~50ms tick), fall back to variables (10Hz throttle).
 * @param {number} chNum
 * @param {import('./variable-state.js').VariableStore | null} vars
 * @param {import('./osc-client.js').OscClient | null} oscClient
 * @param {import('./state-store.js').StateStore} stateStore
 */
export function readBusPeakDbfs(chNum, vars, oscClient, stateStore) {
	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const pOsc = peakDbfsFromLevels(chState?.audio?.levels)
	if (Number.isFinite(pOsc)) return pOsc
	const pSt = peakDbfsFromVarStrings(stateStore?.getState?.()?.variables, chNum)
	if (Number.isFinite(pSt)) return pSt
	const pVs = vars ? peakDbfsFromVarStrings(vars.variables, chNum) : NaN
	if (Number.isFinite(pVs)) return pVs
	return -99
}

/**
 * Layer dBFS estimate from channel master × layer fader (Caspar has no per-layer meters).
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {{ volume?: number, paused?: boolean }} [layerMeta]
 */
export function readLayerPeakDbfs(chNum, layerNum, oscClient, stateStore, layerMeta) {
	if (layerMeta?.paused) return -99
	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const oscLayer = chState?.layers?.[layerNum] ?? chState?.layers?.[String(layerNum)]
	const lt = String(oscLayer?.type || '')
	if (lt === 'empty' || oscLayer?.paused === true) return -99
	const master = peakDbfsFromLevels(chState?.audio?.levels)
	if (!Number.isFinite(master)) return -99
	const vol = Number.isFinite(layerMeta?.volume) ? Math.max(0, Math.min(1, layerMeta.volume)) : 1
	if (vol <= 0) return -99
	return master + 20 * Math.log10(vol)
}
