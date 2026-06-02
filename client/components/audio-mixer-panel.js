/**
 * Program master faders (MIXER MASTERVOLUME) — collapsible section at the bottom of the Inspector.
 */

import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { audioOutputRoutesForLayout } from '../lib/audio-routes.js'
import { sceneState } from '../lib/scene-state.js'
import { showScenesToast } from './scenes-editor-support.js'
import { collectProgramAudioRows } from '../lib/audio-mixer-rows.js'
import { createAudioMeterLoop } from '../lib/audio-mixer-meter-loop.js'
import { escapeHtml, escapeAttr } from '../lib/audio-mixer-ui.js'
import { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'

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
					<input type="range" class="audio-mixer__fader-vertical" min="0" max="100" value="${Math.round(r.v * 100)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
				</div>
				<span class="audio-mixer__fader-val">${Math.round(r.v * 100)}%</span>
			`
			mastersEl.appendChild(row)

			meterFills.set(r.key, row.querySelector('.audio-mixer__meter-fill'))

			const fader = row.querySelector('.audio-mixer__fader-vertical')
			const valEl = row.querySelector('.audio-mixer__fader-val')
			fader.addEventListener('input', () => {
				valEl.textContent = `${fader.value}%`
				audioMixerState.setMasterVolume(r.key, parseInt(fader.value, 10) / 100)
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

		const inputsByCh = {}
		for (const r of inputsList) {
			if (!inputsByCh[r.ch]) inputsByCh[r.ch] = []
			inputsByCh[r.ch].push(r)
		}

		programChannels.forEach((ch, chIdx) => {
			const list = inputsByCh[ch] || []
			if (list.length === 0) return

			const divider = document.createElement('div')
			divider.className = 'audio-mixer__channel-divider'
			divider.textContent = `PGM ${chIdx + 1} (ch ${ch}) Inputs`
			inputsEl.appendChild(divider)

			for (const r of list) {
				const row = document.createElement('div')
				row.className = 'audio-mixer__bus-layer'
				const masterLayout = stateStore.getState()?.settings?.audioRouting?.programLayout || 'stereo'
				const routes = audioOutputRoutesForLayout(masterLayout)
				const options = routes
					.map(
						(rt) =>
							`<option value="${escapeAttr(rt.value)}"${rt.value === r.audioRoute ? ' selected' : ''}>${escapeHtml(rt.label)}</option>`,
					)
					.join('')
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

				meterFills.set(r.key, row.querySelector('.audio-mixer__meter-fill'))
				meterLayerMeta.set(r.key, { volume: r.v, paused: false })

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
						const scene = sceneState.getScene(r.sceneId)
						if (!scene) return
						const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
						if (idx < 0) return
						const nextMuted = !muteBtn.classList.contains('audio-mixer__mute-btn--active')
						sceneState.patchLayer(r.sceneId, idx, { muted: nextMuted })
						document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
						const liveScenes = stateStore.getState()?.scene?.live || {}
						const liveSceneData = liveScenes[r.ch] || liveScenes[String(r.ch)]
						if (liveSceneData?.scene?.layers) {
							const layer = liveSceneData.scene.layers.find((l) => l.layerNumber === r.layer)
							if (layer) layer.muted = nextMuted
						}
						syncMuteUI(r.key, nextMuted)
						const faderEl = document.querySelector(`input[data-key="${r.key}"]`)
						const currentVol = faderEl ? parseInt(faderEl.value, 10) / 100 : r.v
						try {
							await api.post('/api/audio/volume', {
								channel: r.ch,
								layer: r.layer,
								volume: nextMuted ? 0 : currentVol,
							})
						} catch (e) {
							console.warn('MUTE playout update failed:', e?.message || e)
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
					const liveScenes = stateStore.getState()?.scene?.live || {}
					const liveSceneData = liveScenes[r.ch] || liveScenes[String(r.ch)]
					if (liveSceneData?.scene?.layers) {
						const layer = liveSceneData.scene.layers.find((l) => l.layerNumber === r.layer)
						if (layer) layer.volume = x
					}
					syncFaderUI(r.key, fader.value)
				})
				fader.addEventListener('change', async () => {
					const x = parseInt(fader.value, 10) / 100
					const scene = sceneState.getScene(r.sceneId)
					if (scene) {
						const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
						if (idx >= 0) sceneState.patchLayer(r.sceneId, idx, { volume: x })
					}
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

	stateStore.on('*', (path) => {
		if (!isExpanded) return
		if (path === 'variables') return
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
