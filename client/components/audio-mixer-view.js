/**
 * Dedicated Audio Mixer tab view - full professional audio mixing console.
 */

import { mountLiveAudioSettingsPanel } from './settings-live-audio-panel.js'
import { mountAudioMixerViewConsole } from './audio-mixer-view-console.js'

let mounted = false

/** @param {import('../lib/state-store.js').StateStore} stateStore */
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

	const viewRoot = root.querySelector('.audio-mixer-view')
	const addInputBtn = root.querySelector('.audio-mixer-view__add-input-btn')
	if (addInputBtn) {
		addInputBtn.onclick = () => {
			void showLiveAudioSettingsModal()
		}
	}

	mountAudioMixerViewConsole(stateStore, {
		root: viewRoot,
		inputsListEl: root.querySelector('.audio-mixer-view__inputs-list'),
		mastersListEl: root.querySelector('.audio-mixer-view__masters-list'),
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
	modal.addEventListener('click', (e) => {
		if (e.target === modal) close()
	})

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
