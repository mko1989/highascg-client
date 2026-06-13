import { getVariableStore } from './variable-state.js'
import { getAppOsc, getAppWs } from './app-runtime.js'
import { readBusPeakDbfs, readLayerPeakDbfs } from './audio-mixer-peaks.js'

/**
 * @param {{
 *   meterFills: Map<string, HTMLDivElement>,
 *   meterLayerMeta: Map<string, { paused?: boolean, muted?: boolean }>,
 *   meterSmooth: Map<string, number>,
 *   stateStore: import('./state-store.js').StateStore,
 *   layerFillAxis?: 'width' | 'height',
 *   peakClipColor?: string,
 *   peakNormalColor?: string,
 * }} ctx
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createAudioMeterLoop(ctx) {
	const {
		meterFills,
		meterLayerMeta,
		meterSmooth,
		stateStore,
		layerFillAxis = 'height',
		peakClipColor = 'var(--accent-red)',
		peakNormalColor = 'var(--accent-green)',
	} = ctx

	/** @type {ReturnType<typeof requestAnimationFrame> | null} */
	let raf = null

	function stop() {
		if (raf) {
			cancelAnimationFrame(raf)
			raf = null
		}
	}

	function start() {
		if (raf) return
		const ws = getAppWs()
		const vars = ws ? getVariableStore(ws) : null
		const tick = () => {
			const oscClient = getAppOsc()
			for (const [key, fill] of meterFills) {
				let level = -99
				if (key.includes(':layer:')) {
					const [, chStr, , lnStr] = key.split(':')
					const chNum = parseInt(chStr, 10)
					const lnNum = parseInt(lnStr, 10)
					const meta = meterLayerMeta.get(key)
					level =
						Number.isFinite(chNum) && Number.isFinite(lnNum)
							? readLayerPeakDbfs(chNum, lnNum, oscClient, stateStore, meta)
							: -99
				} else if (key.startsWith('input:')) {
					const chNum = parseInt(key.slice(6), 10)
					level = Number.isFinite(chNum) ? readBusPeakDbfs(chNum, vars, oscClient, stateStore) : -99
				} else {
					const [, chStr] = key.split(':')
					const chNum = parseInt(chStr, 10)
					level = Number.isFinite(chNum) ? readBusPeakDbfs(chNum, vars, oscClient, stateStore) : -99
				}

				let s = meterSmooth.get(key) ?? 0
				let aim = 0
				if (level > -90) {
					aim = Math.max(0, Math.min(1, (level + 60) / 60))
				}
				if (aim >= s) s = aim
				else s += (aim - s) * 0.18
				meterSmooth.set(key, s)
				const pct = (s * 100).toFixed(1)
				if (fill._lastPct !== pct) {
					if (key.includes(':layer:')) {
						fill.style[layerFillAxis] = `${pct}%`
					} else {
						fill.style.height = `${pct}%`
					}
					fill._lastPct = pct
				}

				if (level > -90) {
					if (level > -1) fill.style.background = peakClipColor
					else fill.style.background = peakNormalColor
				} else {
					fill.style.removeProperty('background')
				}
			}
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
	}

	return { start, stop }
}
