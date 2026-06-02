import { api } from '../lib/api-client.js'
import * as audioMixerState from '../lib/audio-mixer-state.js'
import { audioOutputRoutesForLayout } from '../lib/audio-routes.js'
import { sceneState } from '../lib/scene-state.js'
import { showScenesToast } from './scenes-editor-support.js'
import { collectProgramAudioRows } from '../lib/audio-mixer-rows.js'
import { createAudioMeterLoop } from '../lib/audio-mixer-meter-loop.js'
import { escapeHtml, escapeAttr } from '../lib/audio-mixer-ui.js'
import { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'

/**
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {{
 *   root: HTMLElement,
 *   inputsListEl: HTMLElement,
 *   mastersListEl: HTMLElement,
 * }} mount
 */
export function mountAudioMixerViewConsole(stateStore, { root, inputsListEl, mastersListEl }) {
	const meterFills = new Map()
	const meterSmooth = new Map()
	const meterLayerMeta = new Map()
	const meterLoop = createAudioMeterLoop({
		meterFills,
		meterLayerMeta,
		meterSmooth,
		stateStore,
		peakClipColor: '#ef4444',
		peakNormalColor: '#22c55e',
	})

	function renderConsole() {
		meterLoop.stop()
		meterFills.clear()
		meterSmooth.clear()
		meterLayerMeta.clear()
		inputsListEl.innerHTML = ''
		mastersListEl.innerHTML = ''

		const { programChannels, mastersList, inputsList } = collectProgramAudioRows(stateStore, {
			masterLabel: (_ch, i) => `PGM ${i + 1} Master`,
			labelMax: 14,
			labelTailChars: 0,
		})

		const inputsByCh = {}
		for (const r of inputsList) {
			if (!inputsByCh[r.ch]) inputsByCh[r.ch] = []
			inputsByCh[r.ch].push(r)
		}

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
				const masterLayout = stateStore.getState()?.settings?.audioRouting?.programLayout || 'stereo'
				const routes = audioOutputRoutesForLayout(masterLayout)
				const matrixButtonsHtml = routes
					.map((rt) => {
						const active = rt.value === r.audioRoute
						return `<button type="button" class="audio-mixer-view__matrix-btn${active ? ' audio-mixer-view__matrix-btn--active' : ''}" data-route="${rt.value}" title="Route to ${rt.label}">${rt.label}</button>`
					})
					.join('')
				const labelTitle = r.labelTitle || r.label
				strip.innerHTML = `
					<div class="audio-mixer-view__strip-label" title="${escapeAttr(labelTitle)}">${escapeHtml(r.label)}</div>
					<div class="audio-mixer-view__fader-container">
						<div class="audio-mixer-view__meter-vertical" aria-hidden="true">
							<div class="audio-mixer-view__meter-fill"></div>
						</div>
						<div class="audio-mixer-view__scale">
							<span>+6</span><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-48</span><span>-∞</span>
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

				meterFills.set(r.key, strip.querySelector('.audio-mixer-view__meter-fill'))
				meterLayerMeta.set(r.key, { volume: r.v, paused: false })

				const fader = strip.querySelector('.audio-mixer-view__fader')
				const valEl = strip.querySelector('.audio-mixer-view__fader-val')
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

				strip.querySelector('.audio-mixer-view__solo-btn')?.addEventListener('click', async (e) => {
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
				})

				strip.querySelector('.audio-mixer-view__mute-btn')?.addEventListener('click', async () => {
					const muteBtn = strip.querySelector('.audio-mixer-view__mute-btn')
					const scene = sceneState.getScene(r.sceneId)
					if (!scene || !muteBtn) return
					const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
					if (idx < 0) return
					const nextMuted = !muteBtn.classList.contains('audio-mixer-view__mute-btn--active')
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
				})

				strip.querySelectorAll('.audio-mixer-view__matrix-btn').forEach((btn) => {
					btn.addEventListener('click', () => {
						const routeVal = btn.dataset.route
						const scene = sceneState.getScene(r.sceneId)
						if (!scene) return
						const idx = scene.layers.findIndex((l) => l.layerNumber === r.layer)
						if (idx >= 0) {
							sceneState.patchLayer(r.sceneId, idx, { audioRoute: routeVal })
							showScenesToast(`Route changed to ${routeVal}. Re-take look to apply.`, 'info')
						}
					})
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
						<span>+6</span><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-48</span><span>-∞</span>
					</div>
					<input type="range" class="audio-mixer-view__fader" min="0" max="100" value="${Math.round(r.v * 100)}" data-ch="${r.ch}" data-key="${escapeAttr(r.key)}" aria-label="Volume" />
				</div>
				<span class="audio-mixer-view__fader-val">${Math.round(r.v * 100)}%</span>
				<div class="audio-mixer-view__strip-actions">
					<div class="audio-mixer-view__master-badge">PGM</div>
				</div>
			`
			mastersListEl.appendChild(strip)
			meterFills.set(r.key, strip.querySelector('.audio-mixer-view__meter-fill'))
			const fader = strip.querySelector('.audio-mixer-view__fader')
			const valEl = strip.querySelector('.audio-mixer-view__fader-val')
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

		if (meterFills.size) meterLoop.start()
	}

	renderConsole()

	const observer = new MutationObserver(() => {
		if (root.classList.contains('active')) renderConsole()
		else meterLoop.stop()
	})
	observer.observe(root, { attributes: true, attributeFilter: ['class'] })

	const unbindState = stateStore.on('*', (path) => {
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

	return { stop: () => meterLoop.stop(), unbindState }
}
