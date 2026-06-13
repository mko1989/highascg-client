/**
 * Program master faders (MIXER MASTERVOLUME) — collapsible section at the bottom of the Inspector.
 */

import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { debounceAsync, postAudioVolume } from '../lib/audio-mixer-volume-api.js'
import { audioOutputRoutesForLayout } from '../lib/audio-routes.js'
import { sceneState } from '../lib/scene-state.js'
import { showScenesToast } from './scenes-editor-support.js'
import { collectProgramAudioRows, collectLiveInputMeterRows } from '../lib/audio-mixer-rows.js'
import { createAudioMeterLoop } from '../lib/audio-mixer-meter-loop.js'
import { escapeHtml, escapeAttr } from '../lib/audio-mixer-ui.js'
import {
	faderPercentToLinearGain,
	formatVolumeDb,
	linearGainToFaderPercent,
} from '../lib/audio-volume-scale.js'
import { bindFaderResetGestures, UNITY_LINEAR_GAIN } from '../lib/audio-mixer-fader-bind.js'
import { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'
import { settingsState } from '../lib/settings-state.js'

export { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'

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
	const meterFills = new Map()
	const meterSmooth = new Map()
	const meterLayerMeta = new Map()
	const meterLoop = createAudioMeterLoop({
		meterFills,
		meterLayerMeta,
		meterSmooth,
		stateStore,
		layerFillAxis: 'width',
	})

	function renderBuses() {
		meterLoop.stop()
		meterFills.clear()
		meterSmooth.clear()
		meterLayerMeta.clear()
		mastersEl.innerHTML = ''
		inputsEl.innerHTML = ''

		const { programChannels, mastersList, inputsList } = collectProgramAudioRows(stateStore, {
			masterLabel: (ch, i) => `PGM ${i + 1} (ch ${ch})`,
		})

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
					<input type="range" class="audio-mixer__fader-vertical" min="0" max="100" value="${linearGainToFaderPercent(r.v)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
				</div>
				<span class="audio-mixer__fader-val">${formatVolumeDb(r.v)}</span>
			`
			mastersEl.appendChild(row)

			meterFills.set(r.key, row.querySelector('.audio-mixer__meter-fill'))

			const fader = row.querySelector('.audio-mixer__fader-vertical')
			const valEl = row.querySelector('.audio-mixer__fader-val')
			const postMasterVolume = debounceAsync(async () => {
				try {
					await postAudioVolume({
						channel: r.ch,
						master: true,
						linearGain: faderPercentToLinearGain(fader.value),
					})
				} catch (e) {
					console.warn('VOLUME failed:', e?.message || e)
				}
			})
			fader.addEventListener('input', () => {
				const x = faderPercentToLinearGain(fader.value)
				valEl.textContent = formatVolumeDb(x)
				audioMixerState.setMasterVolume(r.key, x)
				syncFaderUI(r.key, fader.value)
				postMasterVolume()
			})
			fader.addEventListener('change', async () => {
				try {
					await postAudioVolume({
						channel: r.ch,
						master: true,
						linearGain: faderPercentToLinearGain(fader.value),
					})
				} catch (e) {
					console.warn('VOLUME failed:', e?.message || e)
				}
			})
			bindFaderResetGestures(fader, () => {
				fader.value = String(linearGainToFaderPercent(UNITY_LINEAR_GAIN))
				audioMixerState.setMasterVolume(r.key, UNITY_LINEAR_GAIN)
				fader.dispatchEvent(new Event('input', { bubbles: true }))
				fader.dispatchEvent(new Event('change', { bubbles: true }))
			})
		}

		const liveInputMeters = collectLiveInputMeterRows(stateStore.getState()?.channelMap || {})
		if (liveInputMeters.length > 0) {
			const liveDivider = document.createElement('div')
			liveDivider.className = 'audio-mixer__channel-divider'
			liveDivider.textContent = 'Live inputs'
			inputsEl.appendChild(liveDivider)

			for (const r of liveInputMeters) {
				const row = document.createElement('div')
				row.className = 'audio-mixer__bus-layer audio-mixer__bus-layer--live-input'
				const labelTitle = r.labelTitle || r.label
				row.innerHTML = `
					<div class="audio-mixer__layer-info">
						<div class="audio-mixer__layer-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
					</div>
					<div class="audio-mixer__layer-fader-row">
						<div class="audio-mixer__meter-horizontal" aria-hidden="true">
							<div class="audio-mixer__meter-fill"></div>
						</div>
					</div>
				`
				inputsEl.appendChild(row)
				meterFills.set(r.key, row.querySelector('.audio-mixer__meter-fill'))
			}
		}

		const inputsByCh = {}
		for (const r of inputsList) {
			if (!inputsByCh[r.ch]) inputsByCh[r.ch] = []
			inputsByCh[r.ch].push(r)
		}

		const groups = []
		programChannels.forEach((ch, chIdx) => {
			groups.push({ ch, title: `PGM ${chIdx + 1} (ch ${ch}) Inputs` })
		})
		groups.forEach((g) => {
			const list = inputsByCh[g.ch] || []
			if (list.length === 0) return

			const divider = document.createElement('div')
			divider.className = 'audio-mixer__channel-divider'
			divider.textContent = g.title
			inputsEl.appendChild(divider)

			for (const r of list) {
				const row = document.createElement('div')
				row.className = 'audio-mixer__bus-layer'
				const masterLayout = settingsState.getSettings()?.audioRouting?.programLayout || 'stereo'
				const routes = audioOutputRoutesForLayout(masterLayout)
				const options = routes
					.map(
						(rt) =>
							`<option value="${escapeAttr(rt.value)}"${rt.value === r.audioRoute ? ' selected' : ''}>${escapeHtml(rt.label)}</option>`,
					)
					.join('')
				const routeHtml = r.sceneId ? `<select class="audio-mixer__route-sel" data-ch="${r.ch}" data-layer="${r.layer}" data-scene="${escapeAttr(r.sceneId)}" aria-label="Audio Route" title="Audio routing destination">${options}</select>` : ''
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
						<input type="range" class="audio-mixer__fader-horizontal" min="0" max="100" value="${linearGainToFaderPercent(r.v)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
						<span class="audio-mixer__fader-val">${formatVolumeDb(r.v)}</span>
					</div>
				`
				inputsEl.appendChild(row)

				meterFills.set(r.key, row.querySelector('.audio-mixer__meter-fill'))
				meterLayerMeta.set(r.key, { paused: false, muted: isMuted })

				const soloBtn = row.querySelector('.audio-mixer__solo-btn')
				if (soloBtn) {
					soloBtn.onclick = async (e) => {
						audioMixerState.toggleSolo(r.key, e.metaKey || e.ctrlKey)
						syncAllSolosUI()
						try {
							const solos = audioMixerState.getSoloedLayers().map((k) => {
								const parts = k.split(':')
								return { channel: parseInt(parts[1], 10), layer: parseInt(parts[3], 10) }
							})
							await api.post('/api/audio/solo', { solos })
						} catch {
							console.warn('Solo API not supported on this playout server. Solo state will remain client-side only.')
						}
					}
				}

				const muteBtn = row.querySelector('.audio-mixer__mute-btn')
				if (muteBtn) {
					muteBtn.onclick = async () => {
						const nextMuted = !muteBtn.classList.contains('audio-mixer__mute-btn--active')

						if (r.sceneId) {
							const scene = sceneState.getScene(r.sceneId)
							if (scene) {
								const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
								if (idx >= 0) {
									sceneState.patchLayer(r.sceneId, idx, { muted: nextMuted })
									document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
								}
							}
						} else {
							audioMixerState.setMuted(r.key, nextMuted)
						}

						const liveScenes = stateStore.getState()?.scene?.live || {}
						const liveSceneData = liveScenes[r.ch] || liveScenes[String(r.ch)]
						if (liveSceneData?.scene?.layers) {
							const layer = liveSceneData.scene.layers.find((l) => l.layerNumber === r.layer)
							if (layer) layer.muted = nextMuted
						}
						syncMuteUI(r.key, nextMuted)
						const meta = meterLayerMeta.get(r.key)
						if (meta) meta.muted = nextMuted
						const faderEl = document.querySelector(`input[data-key="${r.key}"]`)
						const currentVol = faderEl ? faderPercentToLinearGain(faderEl.value) : r.v
						try {
							await postAudioVolume({
								channel: r.ch,
								layer: r.layer,
								linearGain: nextMuted ? 0 : currentVol,
							})
						} catch (e) {
							console.warn('MUTE playout update failed:', e?.message || e)
						}
					}
				}

				const fader = row.querySelector('.audio-mixer__fader-horizontal')
				const valEl = row.querySelector('.audio-mixer__fader-val')
				const postLayerVolume = debounceAsync(async () => {
					try {
						await postAudioVolume({
							channel: r.ch,
							layer: r.layer,
							linearGain: faderPercentToLinearGain(fader.value),
						})
					} catch (e) {
						console.warn('VOLUME failed:', e?.message || e)
					}
				})
				fader.addEventListener('input', () => {
					const x = faderPercentToLinearGain(fader.value)
					valEl.textContent = formatVolumeDb(x)
					const liveScenes = stateStore.getState()?.scene?.live || {}
					const liveSceneData = liveScenes[r.ch] || liveScenes[String(r.ch)]
					if (liveSceneData?.scene?.layers) {
						const layer = liveSceneData.scene.layers.find((l) => l.layerNumber === r.layer)
						if (layer) layer.volume = x
					}
					if (!r.sceneId) {
						audioMixerState.setMasterVolume(r.key, x)
					}
					syncFaderUI(r.key, fader.value)
					postLayerVolume()
				})
				fader.addEventListener('change', async () => {
					const x = faderPercentToLinearGain(fader.value)
					if (r.sceneId) {
						const scene = sceneState.getScene(r.sceneId)
						if (scene) {
							const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
							if (idx >= 0) sceneState.patchLayer(r.sceneId, idx, { volume: x })
						}
					}
					try {
						await postAudioVolume({ channel: r.ch, layer: r.layer, linearGain: x })
					} catch (e) {
						console.warn('VOLUME failed:', e?.message || e)
					}
				})
				bindFaderResetGestures(fader, () => {
					fader.value = String(linearGainToFaderPercent(UNITY_LINEAR_GAIN))
					fader.dispatchEvent(new Event('input', { bubbles: true }))
					fader.dispatchEvent(new Event('change', { bubbles: true }))
				})

				const routeSel = row.querySelector('.audio-mixer__route-sel')
				if (routeSel) {
					routeSel.addEventListener('change', () => {
						const scene = sceneState.getScene(r.sceneId)
						if (!scene) return
						const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
						if (idx >= 0) {
							sceneState.patchLayer(r.sceneId, idx, { audioRoute: routeSel.value })
							showScenesToast('Route changed. Re-take the look to apply to output.', 'info')
						}
					})
				}
			}
		})

		if (meterFills.size) meterLoop.start()
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
		if (isExpanded) renderBuses()
		else meterLoop.stop()
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

	const onMixerRefresh = () => {
		if (isExpanded) renderBuses()
	}

	stateStore.on('*', (path) => {
		if (!isExpanded) return
		if (path === 'variables') return
		if (
			path === '*' ||
			path == null ||
			path === 'channelMap' ||
			path === 'channels' ||
			path === 'liveAudioConfigured' ||
			path === 'scene.live' ||
			(typeof path === 'string' && path.startsWith('scene.live'))
		) {
			renderBuses()
		}
	})

	settingsState.subscribe(() => onMixerRefresh())
	sceneState.on('change', onMixerRefresh)
	sceneState.on('softChange', onMixerRefresh)
	document.addEventListener('highascg-settings-applied', onMixerRefresh)
	document.addEventListener('highascg-live-audio-configured', (ev) => {
		const detail = ev?.detail
		if (detail && typeof detail === 'object') stateStore.applyChange('liveAudioConfigured', detail)
		onMixerRefresh()
	})
}
