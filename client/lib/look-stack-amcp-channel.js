/**
 * Caspar channel used for look-stack preview / compose (matches
 * {@link createScenesPreviewRuntime} `resolvePreviewAmcpChannel` when `forcePrvBus` is false).
 */

/**
 * @param {object} cm - `channelMap` from state
 * @param {{ activeScreenIndex?: number, editOnPgm?: boolean }} sceneState
 * @param {{ mainScope?: string } | null | undefined} scene
 * @param {'edit' | 'pgm' | 'prv'} busMode — `edit` = respect editOnPgm + PRV-first; `pgm` / `prv` = force that bus (PRV falls back to PGM if disabled)
 * @returns {number | null}
 */
export function resolveLookStackChannelForBus(cm, sceneState, scene, busMode) {
	const map = cm && typeof cm === 'object' ? cm : {}
	const screenCount = Math.max(1, map.screenCount ?? 1)
	const scope = String(scene?.mainScope || 'all')
	const mIdx =
		scope === 'all'
			? (sceneState?.activeScreenIndex ?? 0)
			: Math.min(Math.max(parseInt(scope, 10) || 0, 0), screenCount - 1)
	const pgm = Number(map.programChannels?.[mIdx] ?? map.playbackChannels?.[mIdx])
	const prv = Number(map.previewChannels?.[mIdx])

	if (busMode === 'pgm') {
		return Number.isFinite(pgm) && pgm > 0 ? pgm : null
	}
	if (busMode === 'prv') {
		if (Number.isFinite(prv) && prv > 0) return prv
		return Number.isFinite(pgm) && pgm > 0 ? pgm : null
	}
	// edit — same as resolvePreviewAmcpChannel(mIdx, false)
	if (sceneState?.editOnPgm) {
		return Number.isFinite(pgm) && pgm > 0 ? pgm : null
	}
	if (Number.isFinite(prv) && prv > 0) return prv
	return Number.isFinite(pgm) && pgm > 0 ? pgm : null
}
