/**
 * Audio Mixer "+" modal — add/configure ALSA live inputs on program channels.
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { refreshLiveAudioConfigured } from '../lib/live-audio-state.js'
import {
	alsaCaptureDeviceOptions,
	buildLiveAudioConfigBody,
	LIVE_AUDIO_MAX_SLOTS,
	readLiveAudioCasparSettings,
} from '../lib/live-audio-inputs.js'
import { clearPlayTarget, resolvePlayTarget, setPlayTarget } from '../lib/live-audio-play-targets.js'
import { playLiveAudioOnChannel, stopLiveAudioOnChannel } from '../lib/live-audio-play.js'
import { listInputChannels } from '../lib/input-channels.js'

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
export async function showLiveAudioMixerModal(stateStore) {
	if (document.getElementById('live-audio-mixer-modal')) return

	const modal = document.createElement('div')
	modal.id = 'live-audio-mixer-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content live-audio-modal">
			<div class="modal-header">
				<h2>Live Audio Inputs</h2>
				<button type="button" class="modal-close" id="live-audio-mixer-close" aria-label="Close">×</button>
			</div>
			<div class="modal-body live-audio-modal__body" id="live-audio-mixer-container">
				<p class="settings-note">Loading…</p>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const container = modal.querySelector('#live-audio-mixer-container')
	const close = () => modal.remove()
	modal.querySelector('#live-audio-mixer-close').onclick = close
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
		await mountLiveAudioMixerPanel(container, stateStore)
	} catch (e) {
		container.innerHTML = `<p class="status-error">Error: ${esc(e?.message || e)}</p>`
	}
}

/**
 * @param {HTMLElement} container
 * @param {import('../lib/state-store.js').StateStore} stateStore
 */
async function mountLiveAudioMixerPanel(container, stateStore) {
	let captureDevices = []

	function programChannelOptions() {
		const cm = stateStore.getState()?.channelMap || {}
		const chs =
			Array.isArray(cm.programChannels) && cm.programChannels.length ? cm.programChannels : [1]
		return chs.map((ch, i) => ({ value: ch, label: `PGM ${i + 1} (ch ${ch})` }))
	}

	function inputChannelOptions() {
		const cm = stateStore.getState()?.channelMap || {}
		const entries = listInputChannels(cm).filter((e) => e.kind === 'live_audio')
		if (entries.length > 0) {
			return entries.map((e) => ({ value: e.channel, label: `Input ch ${e.channel} (slot ${e.slot})` }))
		}
		return programChannelOptions()
	}

	async function loadDevices(refresh = false) {
		const q = refresh ? '?refresh=1' : ''
		const hw = await api.get(`/api/audio/devices${q}`)
		captureDevices = Array.isArray(hw?.devices) ? hw.devices : []
	}

	function readUiFromDom() {
		const cs = settingsState.getSettings()?.casparServer || {}
		const base = readLiveAudioCasparSettings(cs)
		const countEl = container.querySelector('#live-audio-mixer-count')
		const count = countEl ? parseInt(String(countEl.value || '0'), 10) || 0 : base.count
		const slots = []
		const targets = []
		for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
			const sel = container.querySelector(`#live-audio-mixer-slot-${i}-device`)
			slots.push(sel ? String(sel.value || '').trim() : base.slots[i - 1] || '')
			const chEl = container.querySelector(`#live-audio-mixer-slot-${i}-channel`)
			const layerEl = container.querySelector(`#live-audio-mixer-slot-${i}-layer`)
			const labelEl = container.querySelector(`#live-audio-mixer-slot-${i}-label`)
			const cm = stateStore.getState()?.channelMap || {}
			const fallback = resolvePlayTarget(cm, i)
			targets.push({
				channel: chEl ? parseInt(String(chEl.value || fallback.channel), 10) || fallback.channel : fallback.channel,
				layer: layerEl ? parseInt(String(layerEl.value || fallback.layer), 10) || fallback.layer : fallback.layer,
				label: labelEl ? String(labelEl.value || '').trim() : fallback.label || '',
			})
		}
		return {
			...base,
			count: Math.max(0, Math.min(LIVE_AUDIO_MAX_SLOTS, count)),
			slots,
			targets,
			hostChannelEnabled: false,
		}
	}

	function renderSlotRows(ui) {
		const wrap = container.querySelector('#live-audio-mixer-slots')
		if (!wrap) return
		const opts = alsaCaptureDeviceOptions(captureDevices)
		const chOpts = inputChannelOptions()
		const cm = stateStore.getState()?.channelMap || {}
		let html = ''
		for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
			const show = i <= ui.count
			const cur = ui.slots[i - 1] || ''
			const target = ui.targets?.[i - 1] || resolvePlayTarget(cm, i)
			let optHtml = opts
				.map((o) => `<option value="${esc(o.value)}"${o.value === cur ? ' selected' : ''}>${esc(o.label)}</option>`)
				.join('')
			if (cur && !opts.some((o) => o.value === cur)) {
				optHtml += `<option value="${esc(cur)}" selected>${esc(cur)} (saved)</option>`
			}
			const chHtml = chOpts
				.map(
					(o) =>
						`<option value="${esc(o.value)}"${Number(o.value) === Number(target.channel) ? ' selected' : ''}>${esc(o.label)}</option>`,
				)
				.join('')
			html += `
				<div class="settings-group live-audio-slot-row" data-slot="${i}" style="display:${show ? 'block' : 'none'};margin-bottom:0.85rem;padding-bottom:0.85rem;border-bottom:1px solid rgba(255,255,255,0.06)">
					<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem">
						<strong>Input ${i}</strong>
						<button type="button" class="btn btn--secondary live-audio-mixer-remove" data-slot-index="${i - 1}" style="padding:4px 10px;font-size:0.75rem">Remove</button>
					</div>
					<label>Label</label>
					<input type="text" id="live-audio-mixer-slot-${i}-label" value="${esc(target.label || '')}" placeholder="Live audio ${i}" style="width:100%;margin-bottom:0.5rem" />
					<label>Capture device</label>
					<select id="live-audio-mixer-slot-${i}-device" style="width:100%;margin-bottom:0.5rem">${optHtml}</select>
					<div style="display:flex;gap:0.75rem;flex-wrap:wrap">
						<div style="flex:1;min-width:8rem">
							<label>Input channel</label>
							<select id="live-audio-mixer-slot-${i}-channel" style="width:100%">${chHtml}</select>
						</div>
						<div style="flex:0">
							<label>Layer</label>
							<input type="number" id="live-audio-mixer-slot-${i}-layer" min="1" max="99" value="${target.layer}" style="width:4rem" />
						</div>
					</div>
					<p class="settings-note small" style="margin:0.35rem 0 0">Plays on <code>${target.channel}-${target.layer}</code> (audio-only, opacity 0).</p>
				</div>
			`
		}
		wrap.innerHTML = html
	}

	function renderPanel() {
		const cs = settingsState.getSettings()?.casparServer || {}
		const ui = readLiveAudioCasparSettings(cs)
		const cm = stateStore.getState()?.channelMap || {}
		const targets = []
		for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
			targets.push(resolvePlayTarget(cm, i))
		}
		container.innerHTML = `
			<p class="settings-note" style="margin-bottom:0.75rem">
				Add ALSA/USB capture devices here. Each input plays directly on the program channel and layer you choose (defaults: slot 1→L1, slot 2→L2, … below the video stack at L10+). Mixer strips appear under that PGM group.
			</p>
			<input type="hidden" id="live-audio-mixer-count" value="${ui.count}" />
			<div id="live-audio-mixer-slots"></div>
			<div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.75rem 0">
				<button type="button" class="btn btn--secondary" id="live-audio-mixer-add"${ui.count >= LIVE_AUDIO_MAX_SLOTS ? ' disabled' : ''}>+ Add Live Audio Input</button>
				<button type="button" class="btn btn--secondary" id="live-audio-mixer-refresh-devices">Refresh devices</button>
			</div>
			<div style="display:flex;flex-wrap:wrap;gap:0.5rem">
				<button type="button" class="btn btn--primary" id="live-audio-mixer-save">Save &amp; Start</button>
			</div>
			<p class="settings-note" id="live-audio-mixer-status" style="margin-top:0.5rem"></p>
		`
		renderSlotRows({ ...ui, targets })
		bindPanel(ui)
	}

	function bindPanel(initialUi) {
		const statusLine = container.querySelector('#live-audio-mixer-status')
		const setStatus = (msg, ok = true) => {
			if (statusLine) {
				statusLine.textContent = msg || ''
				statusLine.className = ok ? 'settings-note status-ok' : 'settings-note status-error'
			}
		}

		container.querySelector('#live-audio-mixer-add')?.addEventListener('click', () => {
			const currentUi = readUiFromDom()
			if (currentUi.count >= LIVE_AUDIO_MAX_SLOTS) return
			currentUi.count += 1
			const countEl = container.querySelector('#live-audio-mixer-count')
			if (countEl) countEl.value = String(currentUi.count)
			renderSlotRows(currentUi)
			const addBtn = container.querySelector('#live-audio-mixer-add')
			if (addBtn) addBtn.disabled = currentUi.count >= LIVE_AUDIO_MAX_SLOTS
		})

		container.querySelector('#live-audio-mixer-slots')?.addEventListener('click', async (e) => {
			const btn = e.target.closest('.live-audio-mixer-remove')
			if (!btn) return
			const idx = parseInt(String(btn.dataset.slotIndex || ''), 10)
			if (!Number.isFinite(idx) || idx < 0) return
			const currentUi = readUiFromDom()
			const cm = stateStore.getState()?.channelMap || {}
			const prevTarget = currentUi.targets[idx] || resolvePlayTarget(cm, idx + 1)
			try {
				await stopLiveAudioOnChannel(prevTarget.channel, prevTarget.layer)
			} catch {
				/* ignore */
			}

			const newSlots = []
			const newTargets = []
			for (let i = 0; i < currentUi.count; i++) {
				if (i === idx) continue
				newSlots.push(currentUi.slots[i] || '')
				newTargets.push(currentUi.targets[i] || resolvePlayTarget(cm, i + 1))
			}
			for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) clearPlayTarget(i)
			for (let i = 0; i < newSlots.length; i++) {
				setPlayTarget(i + 1, newTargets[i])
			}

			const nextUi = {
				...currentUi,
				count: newSlots.length,
				slots: Array.from({ length: LIVE_AUDIO_MAX_SLOTS }, (_, i) => newSlots[i] || ''),
				targets: newTargets,
			}
			const countEl = container.querySelector('#live-audio-mixer-count')
			if (countEl) countEl.value = String(nextUi.count)
			renderSlotRows(nextUi)
			const addBtn = container.querySelector('#live-audio-mixer-add')
			if (addBtn) addBtn.disabled = nextUi.count >= LIVE_AUDIO_MAX_SLOTS
			setStatus('Removed. Click Save & Start to persist.', true)
		})

		container.querySelector('#live-audio-mixer-refresh-devices')?.addEventListener('click', async () => {
			setStatus('Refreshing devices…', true)
			try {
				await loadDevices(true)
				renderSlotRows(readUiFromDom())
				setStatus('Device list updated.', true)
			} catch (err) {
				setStatus(err?.message || String(err), false)
			}
		})

		container.querySelector('#live-audio-mixer-save')?.addEventListener('click', async () => {
			const ui = readUiFromDom()
			setStatus('Saving and starting capture…', true)
			try {
				for (let i = 1; i <= ui.count; i++) {
					const t = ui.targets[i - 1]
					if (t) setPlayTarget(i, t)
				}
				await api.post('/api/audio/live-inputs/config', buildLiveAudioConfigBody(ui))
				await settingsState.load()

				const errors = []
				for (let i = 1; i <= ui.count; i++) {
					const device = ui.slots[i - 1]
					const t = ui.targets[i - 1]
					if (!device || !t) continue
					try {
						await playLiveAudioOnChannel(t.channel, t.layer, device, { audioOnly: true })
					} catch (err) {
						errors.push(`Slot ${i}: ${err?.message || err}`)
					}
				}

				await refreshLiveAudioConfigured(stateStore)
				document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
				renderPanel()
				if (errors.length) {
					setStatus(`Saved. Some inputs failed: ${errors.join('; ')}`, false)
				} else {
					setStatus('Saved and started on program channel(s).', true)
				}
			} catch (err) {
				setStatus(err?.message || String(err), false)
			}
		})

		if (initialUi.count === 0) {
			setStatus('No live inputs configured. Click + Add to create one.', true)
		}
	}

	await Promise.all([loadDevices(false), settingsState.load()])
	renderPanel()
}
