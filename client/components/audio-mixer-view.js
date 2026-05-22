/**
 * Dedicated Audio Mixer tab view - full professional audio mixing console.
 */

import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { getVariableStore } from '../lib/variable-state.js'
import { getOscClient, ws } from '../app.js'
import { isMediaOrFileSource } from './scenes-shared.js'
import { audioOutputRoutesForLayout } from '../lib/audio-routes.js'
import { sceneState } from '../lib/scene-state.js'
import { showScenesToast } from './scenes-editor-support.js'
import { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel.js'
import { mountLiveAudioSettingsPanel } from './settings-live-audio-panel.js'

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
 * Layer dBFS estimate: CasparCG OSC does not expose per-layer meters, so we approximate
 * by reading the channel master and attenuating by the layer fader.
 */
function readLayerPeakDbfs(chNum, layerNum, oscClient, stateStore, layerMeta) {
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

let mounted = false
let unbindState = null

export function initAudioMixerView(root, stateStore) {
	if (!root || mounted) return
	mounted = true

	root.innerHTML = `
		<div class="audio-mixer-view">
			<div class="audio-mixer-view__header">
				<div class="audio-mixer-view__header-left">
					<div class="audio-mixer-view__title-wrap">
						<h2 class="audio-mixer-view__title">Audio Mixer Console</h2>
						<button type="button" class="audio-mixer-view__add-input-btn" title="Configure Live Audio Inputs">+</button>
					</div>
					<p class="audio-mixer-view__subtitle">Full tactile control over program masters, active inputs, and channel routing destinations.</p>
				</div>
				<div class="audio-mixer-view__status-badge">
					<span class="audio-mixer-view__status-dot"></span> OSC Active
				</div>
			</div>
			<div class="audio-mixer-view__console">
				<div class="audio-mixer-view__inputs-bay">
					<div class="audio-mixer-view__inputs-list"></div>
				</div>
				<div class="audio-mixer-view__masters-bay">
					<div class="audio-mixer-view__masters-list"></div>
				</div>
			</div>
		</div>
	`

	const inputsListEl = root.querySelector('.audio-mixer-view__inputs-list')
	const mastersListEl = root.querySelector('.audio-mixer-view__masters-list')
	const addInputBtn = root.querySelector('.audio-mixer-view__add-input-btn')

	if (addInputBtn) {
		addInputBtn.onclick = () => {
			void showLiveAudioSettingsModal()
		}
	}

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

	function renderConsole() {
		stopMeterLoop()
		meterFills.clear()
		meterSmooth.clear()
		meterLayerMeta.clear()
		inputsListEl.innerHTML = ''
		mastersListEl.innerHTML = ''

		const cm = getChannelMap()
		const programChannels =
			Array.isArray(cm.programChannels) && cm.programChannels.length > 0 ? cm.programChannels : [1]

		const rows = []
		programChannels.forEach((ch, i) => {
			const key = `pgm:${ch}`
			const v = audioMixerState.getMasterVolume(key)
			rows.push({ key, ch, label: `PGM ${i + 1} Master`, v, isMaster: true })

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

		// Group inputs by parent program channel for visual segregation
		const inputsByCh = {}
		for (const r of inputsList) {
			if (!inputsByCh[r.ch]) inputsByCh[r.ch] = []
			inputsByCh[r.ch].push(r)
		}

		// 1. Render Grouped Inputs
		programChannels.forEach((ch, chIdx) => {
			const list = inputsByCh[ch] || []
			if (list.length === 0) return

			const groupCard = document.createElement('div')
			groupCard.className = 'audio-mixer-view__group'
			groupCard.innerHTML = `
				<div class="audio-mixer-view__group-header">PGM ${chIdx + 1} (ch ${ch}) Inputs</div>
				<div class="audio-mixer-view__group-strips"></div>
			`
			inputsListEl.appendChild(groupCard)
			const stripsEl = groupCard.querySelector('.audio-mixer-view__group-strips')

			for (const r of list) {
				const strip = document.createElement('div')
				strip.className = 'audio-mixer-view__strip audio-mixer-view__strip--input'

				const isSolo = audioMixerState.isSoloed(r.key)
				const isMuted = !!r.muted

				// Routing Matrix Buttons
				const masterLayout = stateStore.getState()?.settings?.audioRouting?.programLayout || 'stereo'
				const routes = audioOutputRoutesForLayout(masterLayout)
				const matrixButtonsHtml = routes.map((rt) => {
					const active = rt.value === r.audioRoute
					return `<button type="button" class="audio-mixer-view__matrix-btn${active ? ' audio-mixer-view__matrix-btn--active' : ''}" data-route="${rt.value}" title="Route to ${rt.label}">${rt.label}</button>`
				}).join('')

				const labelTitle = r.labelTitle || r.label
				strip.innerHTML = `
					<div class="audio-mixer-view__strip-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
					
					<div class="audio-mixer-view__fader-container">
						<div class="audio-mixer-view__meter-vertical" aria-hidden="true">
							<div class="audio-mixer-view__meter-fill"></div>
						</div>
						<div class="audio-mixer-view__scale">
							<span>+6</span>
							<span>0</span>
							<span>-6</span>
							<span>-12</span>
							<span>-24</span>
							<span>-48</span>
							<span>-∞</span>
						</div>
						<input type="range" class="audio-mixer-view__fader" min="0" max="100" value="${Math.round(r.v * 100)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
					</div>
					
					<span class="audio-mixer-view__fader-val">${Math.round(r.v * 100)}%</span>

					<div class="audio-mixer-view__strip-actions">
						<button type="button" class="audio-mixer-view__solo-btn${isSolo ? ' audio-mixer-view__solo-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Solo layer (Ctrl+Click for multi)">SOLO</button>
						<button type="button" class="audio-mixer-view__mute-btn${isMuted ? ' audio-mixer-view__mute-btn--active' : ''}" data-key="${escapeAttr(r.key)}" title="Mute layer">MUTE</button>
					</div>

					<div class="audio-mixer-view__matrix">
						<div class="audio-mixer-view__matrix-title">Routing</div>
						<div class="audio-mixer-view__matrix-buttons">${matrixButtonsHtml}</div>
					</div>
				`
				stripsEl.appendChild(strip)

				const fill = strip.querySelector('.audio-mixer-view__meter-fill')
				meterFills.set(r.key, fill)
				meterLayerMeta.set(r.key, { volume: r.v, paused: false })

				const fader = strip.querySelector('.audio-mixer-view__fader')
				const valEl = strip.querySelector('.audio-mixer-view__fader-val')

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

				const soloBtn = strip.querySelector('.audio-mixer-view__solo-btn')
				if (soloBtn) {
					soloBtn.onclick = async (e) => {
						const multi = e.metaKey || e.ctrlKey
						audioMixerState.toggleSolo(r.key, multi)
						
						// Sync all solo buttons in BOTH panels instantly
						syncAllSolosUI()

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

				const muteBtn = strip.querySelector('.audio-mixer-view__mute-btn')
				if (muteBtn) {
					muteBtn.onclick = async () => {
						const scene = sceneState.getScene(r.sceneId)
						if (scene) {
							const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
							if (idx >= 0) {
								const isCurrentlyMuted = muteBtn.classList.contains('audio-mixer-view__mute-btn--active')
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

				// Tactile Matrix Routing Click Handling
				const matrixBtns = strip.querySelectorAll('.audio-mixer-view__matrix-btn')
				matrixBtns.forEach(btn => {
					btn.onclick = () => {
						const routeVal = btn.dataset.route
						const scene = sceneState.getScene(r.sceneId)
						if (scene) {
							const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
							if (idx >= 0) {
								sceneState.patchLayer(r.sceneId, idx, { audioRoute: routeVal })
								showScenesToast(`Route changed to ${routeVal}. Re-take look to apply.`, 'info')
							}
						}
					}
				})
			}
		})

		if (inputsListEl.innerHTML === '') {
			inputsListEl.innerHTML = `
				<div class="audio-mixer-view__empty-state">
					<div class="audio-mixer-view__empty-icon">🎚</div>
					<div class="audio-mixer-view__empty-text">No active program inputs playing audio. Play a scene look with audio/video media to see channel strips here.</div>
				</div>
			`
		}

		// 2. Render Masters (Stationary panel on the right)
		for (const r of mastersList) {
			const strip = document.createElement('div')
			strip.className = 'audio-mixer-view__strip audio-mixer-view__strip--master'

			strip.innerHTML = `
				<div class="audio-mixer-view__strip-label audio-mixer-view__strip-label--master" title="${escapeAttr(r.label)}">${escapeHtml(r.label)}</div>
				
				<div class="audio-mixer-view__fader-container">
					<div class="audio-mixer-view__meter-vertical" aria-hidden="true">
						<div class="audio-mixer-view__meter-fill"></div>
					</div>
					<div class="audio-mixer-view__scale">
						<span>+6</span>
						<span>0</span>
						<span>-6</span>
						<span>-12</span>
						<span>-24</span>
						<span>-48</span>
						<span>-∞</span>
					</div>
					<input type="range" class="audio-mixer-view__fader" min="0" max="100" value="${Math.round(r.v * 100)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
				</div>
				
				<span class="audio-mixer-view__fader-val">${Math.round(r.v * 100)}%</span>

				<div class="audio-mixer-view__strip-actions">
					<div class="audio-mixer-view__master-badge">PGM</div>
				</div>
			`
			mastersListEl.appendChild(strip)

			const fill = strip.querySelector('.audio-mixer-view__meter-fill')
			meterFills.set(r.key, fill)

			const fader = strip.querySelector('.audio-mixer-view__fader')
			const valEl = strip.querySelector('.audio-mixer-view__fader-val')

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
					fill.style.height = `${pct}%`
					fill._lastPct = pct
				}

				if (level > -90) {
					if (level > -1) fill.style.background = '#ef4444' // peak clip
					else fill.style.background = '#22c55e' // normal
				} else {
					fill.style.removeProperty('background')
				}
			}
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
	}

	renderConsole()

	// Handle visibility / state changes
	const observer = new MutationObserver(() => {
		const isVisible = root.classList.contains('active')
		if (isVisible) {
			renderConsole()
		} else {
			stopMeterLoop()
		}
	})
	observer.observe(root, { attributes: true, attributeFilter: ['class'] })

	unbindState = stateStore.on('*', (path) => {
		if (!root.classList.contains('active')) return
		if (path === 'variables') return
		if (
			path === '*' ||
			path == null ||
			path === 'channelMap' ||
			path === 'channels' ||
			path === 'scene.live' ||
			(typeof path === 'string' && path.startsWith('scene.live'))
		) {
			renderConsole()
		}
	})
}

export async function showLiveAudioSettingsModal() {
	if (document.getElementById('live-audio-settings-modal')) return

	const modal = document.createElement('div')
	modal.id = 'live-audio-settings-modal'
	modal.className = 'modal-overlay'

	modal.innerHTML = `
		<div class="modal-content live-audio-modal">
			<div class="modal-header">
				<h2>Live Audio Input Settings</h2>
				<button type="button" class="modal-close" id="live-audio-settings-close" aria-label="Close">×</button>
			</div>
			<div class="modal-body live-audio-modal__body" id="live-audio-settings-container">
				<p class="settings-note">Loading live audio settings…</p>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const container = modal.querySelector('#live-audio-settings-container')
	const closeBtn = modal.querySelector('#live-audio-settings-close')

	const close = () => modal.remove()
	closeBtn.onclick = close
	modal.addEventListener('click', (e) => { if (e.target === modal) close() })

	const onKey = (e) => {
		if (e.key === 'Escape') {
			close()
			document.removeEventListener('keydown', onKey)
		}
	}
	document.addEventListener('keydown', onKey)

	try {
		await mountLiveAudioSettingsPanel(container)
	} catch (e) {
		container.innerHTML = `<p class="status-error">Error loading settings: ${e.message || e}</p>`
	}
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
 * Shorten media file names to fit nicely in channel strip headers
 */
function shortenMediaName(raw) {
	const s = String(raw || '').trim()
	if (!s) return ''
	const noExt = s.replace(/\.[a-z0-9]{2,4}$/i, '')
	const tokens = noExt.split(/[_\s.-]+/).filter(Boolean)
	const KEEP = []
	for (const tok of tokens) {
		if (/^\d{6,}$/.test(tok)) continue
		if (/^\d{1,4}(fps|hz|k|p|i)$/i.test(tok)) continue
		if (/^(hd|uhd|sd|4k|8k|hdr|sdr)$/i.test(tok)) continue
		if (/^(r709|r2020|p3|rec709|rec2020|srgb)$/i.test(tok)) continue
		if (/^(hap|prores|h264|h265|hevc|dnxhd|dnxhr|mxf|mov)$/i.test(tok)) continue
		if (/^(master|final|preview|proxy|mezz|mezzanine)$/i.test(tok)) continue
		if (/^\d+dfx?$/i.test(tok)) continue
		if (/^[A-Z]{2}-[A-Z]{2,}$/.test(tok)) continue
		KEEP.push(tok)
	}
	const cleaned = (KEEP.length ? KEEP.join('_') : noExt)
	const MAX = 14
	if (cleaned.length <= MAX) return cleaned
	const head = cleaned.slice(0, MAX - 3)
	return `${head}…`
}
