/**
 * Program master faders (MIXER MASTERVOLUME) — collapsible section at the bottom of the Inspector.
 * Per-layer output pairs (ch 1+2, 3+4, …) are set in the layer inspector (looks / scenes).
 */

import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { getVariableStore } from '../lib/variable-state.js'
import { getOscClient, ws } from '../app.js'
import { isMediaOrFileSource } from './scenes-shared.js'
import { audioOutputRoutesForLayout } from '../lib/audio-routes.js'
import { sceneState } from '../lib/scene-state.js'
import { showScenesToast } from './scenes-editor-support.js'

export function syncFaderUI(key, percent) {
	const selectors = [
		`input[data-key="${key}"].audio-mixer__fader-horizontal`,
		`input[data-key="${key}"].audio-mixer__fader-vertical`,
		`input[data-key="${key}"].audio-mixer-view__fader`
	]
	const faders = document.querySelectorAll(selectors.join(', '))
	faders.forEach((f) => {
		if (f.value !== String(percent)) {
			f.value = percent
			const parent = f.closest('.audio-mixer__bus-master, .audio-mixer__bus-layer, .audio-mixer-view__strip')
			if (parent) {
				const valEl = parent.querySelector('.audio-mixer__fader-val, .audio-mixer-view__fader-val')
				if (valEl) valEl.textContent = `${percent}%`
			}
		}
	})
}

export function syncMuteUI(key, muted) {
	const btnCompact = document.querySelector(`.audio-mixer__mute-btn[data-key="${key}"]`)
	const btnBig = document.querySelector(`.audio-mixer-view__mute-btn[data-key="${key}"]`)
	if (btnCompact) {
		if (muted) btnCompact.classList.add('audio-mixer__mute-btn--active')
		else btnCompact.classList.remove('audio-mixer__mute-btn--active')
	}
	if (btnBig) {
		if (muted) btnBig.classList.add('audio-mixer-view__mute-btn--active')
		else btnBig.classList.remove('audio-mixer-view__mute-btn--active')
	}
}

export function syncAllSolosUI() {
	const allBtns = document.querySelectorAll('.audio-mixer__solo-btn, .audio-mixer-view__solo-btn')
	allBtns.forEach(btn => {
		const k = btn.dataset.key
		const activeClass = btn.classList.contains('audio-mixer__solo-btn') 
			? 'audio-mixer__solo-btn--active' 
			: 'audio-mixer-view__solo-btn--active'
		if (audioMixerState.isSoloed(k)) {
			btn.classList.add(activeClass)
		} else {
			btn.classList.remove(activeClass)
		}
	})
}

/** @param {unknown[]} [levels] */
function peakDbfsFromLevels(levels) {
	if (!Array.isArray(levels) || levels.length === 0) return NaN
	const L = levels[0]?.dBFS
	const R = levels[1]?.dBFS
	if (!Number.isFinite(L) && !Number.isFinite(R)) return NaN
	return Math.max(Number.isFinite(L) ? L : -99, Number.isFinite(R) ? R : -99)
}

/** @param {Record<string, string> | undefined} obj */
function peakDbfsFromVarStrings(obj, chNum) {
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
 * Do NOT take Math.min across sources — stale or out-of-phase samples would falsely pin the meter low.
 * @param {number} chNum
 * @param {import('../lib/variable-state.js').VariableStore | null} vars
 * @param {import('../lib/osc-client.js').OscClient | null} oscClient
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
function readBusPeakDbfs(chNum, vars, oscClient, stateStore) {
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
 * Layer dBFS estimate: CasparCG OSC does **not** expose per-layer meters (only `/mixer/audio/`
 * post-mix on the channel). For a layer row we approximate by reading the channel master and
 * attenuating by the layer fader (so the bar still moves with audio + reflects fader changes).
 * When the layer is paused/empty we force silence.
 *
 * @param {number} chNum
 * @param {number} layerNum
 * @param {import('../lib/osc-client.js').OscClient | null} oscClient
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{ volume?: number, paused?: boolean }} layerMeta
 */
function readLayerPeakDbfs(chNum, layerNum, oscClient, stateStore, layerMeta) {
	if (layerMeta?.paused) return -99
	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const oscLayer = chState?.layers?.[layerNum] ?? chState?.layers?.[String(layerNum)]
	// Empty/no foreground producer → silence (avoids meter activity on layers without media).
	const lt = String(oscLayer?.type || '')
	if (lt === 'empty' || oscLayer?.paused === true) return -99
	const master = peakDbfsFromLevels(chState?.audio?.levels)
	if (!Number.isFinite(master)) return -99
	const vol = Number.isFinite(layerMeta?.volume) ? Math.max(0, Math.min(1, layerMeta.volume)) : 1
	if (vol <= 0) return -99
	// Apply fader as a linear gain on amplitude → dBFS: 20·log10(vol).
	return master + 20 * Math.log10(vol)
}

const LS_EXPANDED = 'highascg_inspector_program_audio_expanded'

/** @param {import('../lib/state-store.js').StateStore} stateStore */
export function initAudioMixerPanel(stateStore, mountEl) {
	if (!mountEl) return

	const root = document.createElement('div')
	root.className = 'audio-mixer audio-mixer--inspector'
	root.innerHTML = `
		<button type="button" class="audio-mixer__section-toggle" aria-expanded="false" title="Program audio (MASTERVOLUME)">
			<span class="audio-mixer__section-chevron" aria-hidden="true">▶</span>
			<span class="audio-mixer__section-label">Program audio</span>
		</button>
		<div class="audio-mixer__panel" hidden>
			<div class="audio-mixer__section-title">Masters</div>
			<div class="audio-mixer__masters"></div>
			<div class="audio-mixer__section-title">Inputs</div>
			<div class="audio-mixer__inputs"></div>
		</div>
	`
	mountEl.appendChild(root)

	const toggle = root.querySelector('.audio-mixer__section-toggle')
	const panel = root.querySelector('.audio-mixer__panel')
	const chevron = root.querySelector('.audio-mixer__section-chevron')
	const mastersEl = root.querySelector('.audio-mixer__masters')
	const inputsEl = root.querySelector('.audio-mixer__inputs')
	/** @type {ReturnType<typeof requestAnimationFrame> | null} */
	let raf = null
	/** @type {Map<string, HTMLDivElement>} */
	const meterFills = new Map()
	/** @type {Map<string, number>} smoothed meter */
	const meterSmooth = new Map()
	/** @type {Map<string, { volume: number, paused: boolean }>} per-layer meta for layer rows */
	const meterLayerMeta = new Map()

	function stopMeterLoop() {
		if (raf) {
			cancelAnimationFrame(raf)
			raf = null
		}
	}

	function getChannelMap() {
		return stateStore.getState()?.channelMap || {}
	}

	function renderBuses() {
		stopMeterLoop()
		meterFills.clear()
		meterSmooth.clear()
		meterLayerMeta.clear()
		const cm = getChannelMap()
		const programChannels =
			Array.isArray(cm.programChannels) && cm.programChannels.length > 0 ? cm.programChannels : [1]
		mastersEl.innerHTML = ''
		inputsEl.innerHTML = ''

		const rows = []
		programChannels.forEach((ch, i) => {
			const key = `pgm:${ch}`
			const v = audioMixerState.getMasterVolume(key)
			rows.push({ key, ch, label: `PGM ${i + 1} (ch ${ch})`, v, isMaster: true })

			const liveScenes = stateStore.getState()?.scene?.live || {}
			const liveSceneData = liveScenes[ch] || liveScenes[String(ch)]
			if (liveSceneData?.scene?.layers) {
				liveSceneData.scene.layers.forEach((layer) => {
					if (isMediaOrFileSource(layer.source)) {
						const ln = layer.layerNumber
						const fullName = String(layer.source.value || '').split('/').pop() || ''
						const shortName = shortenMediaName(fullName)
						const lKey = `pgm:${ch}:layer:${ln}`
						rows.push({
							key: lKey,
							ch,
							layer: ln,
							label: `L${ln} · ${shortName}`,
							labelTitle: `L${ln}: ${fullName}`,
							v: layer.volume != null ? layer.volume : 1,
							muted: !!layer.muted,
							isMaster: false,
							audioRoute: layer.audioRoute || '1+2',
							sceneId: liveSceneData.sceneId,
						})
					}
				})
			}
		})

		const mastersList = rows.filter((r) => r.isMaster)
		const inputsList = rows.filter((r) => !r.isMaster)

		// 1. Render Masters Side-by-Side
		for (const r of mastersList) {
			const row = document.createElement('div')
			row.className = 'audio-mixer__bus-master'
			const labelShort = r.label.replace('Program', 'PGM').replace('audio', '')
			row.innerHTML = `
				<div class="audio-mixer__master-label" title="${escapeAttr(r.label)}">${escapeHtml(labelShort)}</div>
				<div class="audio-mixer__master-meter-container">
					<div class="audio-mixer__meter-vertical" aria-hidden="true">
						<div class="audio-mixer__meter-fill"></div>
					</div>
					<input type="range" class="audio-mixer__fader-vertical" min="0" max="100" value="${Math.round(r.v * 100)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
				</div>
				<span class="audio-mixer__fader-val">${Math.round(r.v * 100)}%</span>
			`
			mastersEl.appendChild(row)

			const fill = row.querySelector('.audio-mixer__meter-fill')
			meterFills.set(r.key, fill)

			const fader = row.querySelector('.audio-mixer__fader-vertical')
			const valEl = row.querySelector('.audio-mixer__fader-val')

			fader.addEventListener('input', () => {
				const x = parseInt(fader.value, 10) / 100
				valEl.textContent = `${fader.value}%`
				audioMixerState.setMasterVolume(r.key, x)
				syncFaderUI(r.key, fader.value)
			})

			fader.addEventListener('change', async () => {
				const x = parseInt(fader.value, 10) / 100
				try {
					await api.post('/api/audio/volume', { channel: r.ch, master: true, volume: x })
				} catch (e) {
					console.warn('VOLUME failed:', e?.message || e)
				}
			})
		}

		// 2. Group Inputs by parent channel and render horizontally
		const inputsByCh = {}
		for (const r of inputsList) {
			if (!inputsByCh[r.ch]) inputsByCh[r.ch] = []
			inputsByCh[r.ch].push(r)
		}

		programChannels.forEach((ch, chIdx) => {
			const list = inputsByCh[ch] || []
			if (list.length === 0) return

			// Divider/Header
			const divider = document.createElement('div')
			divider.className = 'audio-mixer__channel-divider'
			divider.textContent = `PGM ${chIdx + 1} (ch ${ch}) Inputs`
			inputsEl.appendChild(divider)

			for (const r of list) {
				const row = document.createElement('div')
				row.className = 'audio-mixer__bus-layer'

				const masterLayout = stateStore.getState()?.settings?.audioRouting?.programLayout || 'stereo'
				const routes = audioOutputRoutesForLayout(masterLayout)
				let options = routes.map((rt) => `<option value="${escapeAttr(rt.value)}"${rt.value === r.audioRoute ? ' selected' : ''}>${escapeHtml(rt.label)}</option>`).join('')
				const routeHtml = `<select class="audio-mixer__route-sel" data-ch="${r.ch}" data-layer="${r.layer}" data-scene="${escapeAttr(r.sceneId)}" aria-label="Audio Route" title="Audio routing destination">${options}</select>`

				const isSolo = audioMixerState.isSoloed(r.key)
				const soloHtml = `<button type="button" class="audio-mixer__solo-btn${isSolo ? ' audio-mixer__solo-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Solo this layer to monitor">S</button>`

				const isMuted = !!r.muted
				const muteHtml = `<button type="button" class="audio-mixer__mute-btn${isMuted ? ' audio-mixer__mute-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Mute this layer">M</button>`

				const labelTitle = r.labelTitle || r.label
				row.innerHTML = `
					<div class="audio-mixer__layer-info">
						<div class="audio-mixer__layer-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
						<div class="audio-mixer__layer-actions">
							${soloHtml}
							${muteHtml}
							${routeHtml}
						</div>
					</div>
					<div class="audio-mixer__layer-fader-row">
						<div class="audio-mixer__meter-horizontal" aria-hidden="true">
							<div class="audio-mixer__meter-fill"></div>
						</div>
						<input type="range" class="audio-mixer__fader-horizontal" min="0" max="100" value="${Math.round(r.v * 100)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
						<span class="audio-mixer__fader-val">${Math.round(r.v * 100)}%</span>
					</div>
				`
				inputsEl.appendChild(row)

				const fill = row.querySelector('.audio-mixer__meter-fill')
				meterFills.set(r.key, fill)
				meterLayerMeta.set(r.key, { volume: r.v, paused: false })

				const soloBtn = row.querySelector('.audio-mixer__solo-btn')
				if (soloBtn) {
					soloBtn.onclick = async (e) => {
						const multi = e.metaKey || e.ctrlKey
						audioMixerState.toggleSolo(r.key, multi)
						
						// Sync all solo buttons in BOTH panels instantly
						syncAllSolosUI()

						// Send to backend
						try {
							const solos = audioMixerState.getSoloedLayers().map(k => {
								const parts = k.split(':')
								return { channel: parseInt(parts[1], 10), layer: parseInt(parts[3], 10) }
							})
							await api.post('/api/audio/solo', { solos })
						} catch (err) {
							console.warn('Solo API not supported on this playout server. Solo state will remain client-side only.')
						}
					}
				}

				const muteBtn = row.querySelector('.audio-mixer__mute-btn')
				if (muteBtn) {
					muteBtn.onclick = async () => {
						const scene = sceneState.getScene(r.sceneId)
						if (scene) {
							const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
							if (idx >= 0) {
								const isCurrentlyMuted = muteBtn.classList.contains('audio-mixer__mute-btn--active')
								const nextMuted = !isCurrentlyMuted
								
								sceneState.patchLayer(r.sceneId, idx, { muted: nextMuted })
								document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))

								// Update in stateStore in-place for instant syncing
								const liveScenes = stateStore.getState()?.scene?.live || {}
								const liveSceneData = liveScenes[r.ch] || liveScenes[String(r.ch)]
								if (liveSceneData?.scene?.layers) {
									const layer = liveSceneData.scene.layers.find(l => l.layerNumber === r.layer)
									if (layer) layer.muted = nextMuted
								}

								// Sync UI across panels
								syncMuteUI(r.key, nextMuted)

								// Read current fresh volume from the DOM fader input
								const faderEl = document.querySelector(`input[data-key="${r.key}"]`)
								const currentVol = faderEl ? (parseInt(faderEl.value, 10) / 100) : r.v

								// Real-time mute playout update on the server
								try {
									await api.post('/api/audio/volume', {
										channel: r.ch,
										layer: r.layer,
										volume: nextMuted ? 0 : currentVol
									})
								} catch (e) {
									console.warn('MUTE playout update failed:', e?.message || e)
								}
							}
						}
					}
				}

				const fader = row.querySelector('.audio-mixer__fader-horizontal')
				const valEl = row.querySelector('.audio-mixer__fader-val')

				fader.addEventListener('input', () => {
					const x = parseInt(fader.value, 10) / 100
					valEl.textContent = `${fader.value}%`
					const meta = meterLayerMeta.get(r.key)
					if (meta) meta.volume = x

					// Update in stateStore in-place for instant syncing
					const liveScenes = stateStore.getState()?.scene?.live || {}
					const liveSceneData = liveScenes[r.ch] || liveScenes[String(r.ch)]
					if (liveSceneData?.scene?.layers) {
						const layer = liveSceneData.scene.layers.find(l => l.layerNumber === r.layer)
						if (layer) layer.volume = x
					}

					// Sync UI across panels
					syncFaderUI(r.key, fader.value)
				})

				fader.addEventListener('change', async () => {
					const x = parseInt(fader.value, 10) / 100
					// Patch the scene editor model
					const scene = sceneState.getScene(r.sceneId)
					if (scene) {
						const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
						if (idx >= 0) {
							sceneState.patchLayer(r.sceneId, idx, { volume: x })
						}
					}
					// Update server playout
					try {
						await api.post('/api/audio/volume', { channel: r.ch, layer: r.layer, volume: x })
					} catch (e) {
						console.warn('VOLUME failed:', e?.message || e)
					}
				})

				const routeSel = row.querySelector('.audio-mixer__route-sel')
				if (routeSel) {
					routeSel.addEventListener('change', () => {
						const scene = sceneState.getScene(r.sceneId)
						if (scene) {
							const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
							if (idx >= 0) {
								sceneState.patchLayer(r.sceneId, idx, { audioRoute: routeSel.value })
								showScenesToast('Route changed. Re-take the look to apply to output.', 'info')
							}
						}
					})
				}
			}
		})

		if (meterFills.size) startMeterLoop()
	}

	function startMeterLoop() {
		if (raf) return
		const vars = getVariableStore(ws)
		const tick = () => {
			const oscClient = getOscClient()
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
				} else {
					const [, chStr] = key.split(':') // 'pgm:1'
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
						fill.style.width = `${pct}%`
					} else {
						fill.style.height = `${pct}%`
					}
					fill._lastPct = pct
				}

				if (level > -90) {
					if (level > -1) fill.style.background = 'var(--accent-red)'
					else fill.style.background = 'var(--accent-green)'
				} else {
					fill.style.removeProperty('background')
				}
			}
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
	}

	let isExpanded = false
	try {
		const v = localStorage.getItem(LS_EXPANDED)
		if (v === '1') isExpanded = true
		else if (v === '0') isExpanded = false
	} catch {
		/* ignore */
	}

	function applyExpanded(expanded) {
		isExpanded = !!expanded
		panel.hidden = !isExpanded
		toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false')
		if (chevron) chevron.textContent = isExpanded ? '▼' : '▶'
		if (isExpanded) {
			renderBuses()
		} else {
			stopMeterLoop()
		}
	}

	applyExpanded(isExpanded)

	toggle.addEventListener('click', () => {
		applyExpanded(!isExpanded)
		try {
			localStorage.setItem(LS_EXPANDED, isExpanded ? '1' : '0')
		} catch {
			/* ignore */
		}
	})

	stateStore.on('*', (path) => {
		if (!isExpanded) return
		// setState emits path '*'. Do not re-DOM on every variables merge (live meter reads state in rAF).
		if (path === 'variables') return
		// Re-render when channels/map change or when a new look is taken (so layer rows reflect the current live scene).
		if (
			path === '*' ||
			path == null ||
			path === 'channelMap' ||
			path === 'channels' ||
			path === 'scene.live' ||
			(typeof path === 'string' && path.startsWith('scene.live'))
		) {
			renderBuses()
		}
	})
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

function escapeAttr(s) {
	return String(s).replace(/"/g, '&quot;')
}

/**
 * Shorten a media filename for the narrow audio-mixer label column.
 * - Strip extension
 * - Drop common technical suffix tokens (resolution, fps, codec, colorspace, dates, etc.)
 * - Cap to ~22 chars with an ellipsis in the middle so both ends stay readable
 * The full name is kept in the row's `title` tooltip.
 */
function shortenMediaName(raw) {
	const s = String(raw || '').trim()
	if (!s) return ''
	const noExt = s.replace(/\.[a-z0-9]{2,4}$/i, '')
	const tokens = noExt.split(/[_\s.-]+/).filter(Boolean)
	const KEEP = []
	for (const tok of tokens) {
		// Drop tokens that look like technical metadata rather than a human title.
		if (/^\d{6,}$/.test(tok)) continue                       // long date/serial
		if (/^\d{1,4}(fps|hz|k|p|i)$/i.test(tok)) continue       // 25fps, 48k, 1080p
		if (/^(hd|uhd|sd|4k|8k|hdr|sdr)$/i.test(tok)) continue
		if (/^(r709|r2020|p3|rec709|rec2020|srgb)$/i.test(tok)) continue
		if (/^(hap|prores|h264|h265|hevc|dnxhd|dnxhr|mxf|mov)$/i.test(tok)) continue
		if (/^(master|final|preview|proxy|mezz|mezzanine)$/i.test(tok)) continue
		if (/^\d+dfx?$/i.test(tok)) continue                     // 20DFX
		if (/^[A-Z]{2}-[A-Z]{2,}$/.test(tok)) continue           // PL-XX language tag
		KEEP.push(tok)
	}
	const cleaned = (KEEP.length ? KEEP.join('_') : noExt)
	const MAX = 22
	if (cleaned.length <= MAX) return cleaned
	const head = cleaned.slice(0, MAX - 4)
	const tail = cleaned.slice(-3)
	return `${head}…${tail}`
}
