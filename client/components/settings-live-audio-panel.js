/**
 * Settings → Live audio (ALSA capture + headphone preview bus).
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import {
	alsaCaptureDeviceOptions,
	buildLiveAudioConfigBody,
	LIVE_AUDIO_MAX_SLOTS,
	readLiveAudioCasparSettings,
} from '../lib/live-audio-inputs.js'
import { listInputChannels } from '../lib/input-channels.js'

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * @param {HTMLElement} container
 */
export async function mountLiveAudioSettingsPanel(container) {
	container.innerHTML = '<p class="settings-note">Loading live audio settings…</p>'

	let captureDevices = []
	let liveState = null

	async function loadDevices(refresh = false) {
		const q = refresh ? '?refresh=1' : ''
		const hw = await api.get(`/api/audio/devices${q}`)
		captureDevices = Array.isArray(hw?.devices) ? hw.devices : []
	}

	async function loadLiveInputs() {
		try {
			liveState = await api.get('/api/audio/live-inputs')
		} catch {
			liveState = null
		}
	}

	function readUiFromDom() {
		const cs = settingsState.getSettings()?.casparServer || {}
		const base = readLiveAudioCasparSettings(cs)
		const countEl = container.querySelector('#live-audio-slot-count')
		const count = countEl ? parseInt(String(countEl.value || '0'), 10) || 0 : base.count
		const slots = []
		for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
			const sel = container.querySelector(`#live-audio-slot-${i}-device`)
			slots.push(sel ? String(sel.value || '').trim() : base.slots[i - 1] || '')
		}
		const chk = (id, fallback) => {
			const el = container.querySelector(id)
			return el ? !!el.checked : fallback
		}
		const num = (id, fallback) => {
			const el = container.querySelector(id)
			return el ? parseInt(String(el.value || fallback), 10) || fallback : fallback
		}
		const str = (id, fallback) => {
			const el = container.querySelector(id)
			return el ? String(el.value || '').trim() : fallback
		}
		return {
			...base,
			count: Math.max(0, Math.min(LIVE_AUDIO_MAX_SLOTS, count)),
			slots,
			pgmAlwaysOn: chk('#live-audio-pgm-always', base.pgmAlwaysOn),
			pgmScreen: num('#live-audio-pgm-screen', base.pgmScreen),
			pgmLayer: num('#live-audio-pgm-layer', base.pgmLayer),
			pgmAudioOnly: chk('#live-audio-pgm-audio-only', base.pgmAudioOnly),
			hostChannelEnabled: chk('#live-audio-host-enabled', base.hostChannelEnabled),
			inputsChannelMode: str('#live-audio-host-mode', base.inputsChannelMode),
			audioPreviewEnabled: chk('#live-audio-preview-en', base.audioPreviewEnabled),
			audioPreviewBus: str('#live-audio-preview-bus', base.audioPreviewBus),
			audioPreviewScreen: num('#live-audio-preview-screen', base.audioPreviewScreen),
			audioPreviewDevice: str('#live-audio-preview-device', base.audioPreviewDevice),
			audioPreviewDefaultSource: str('#live-audio-preview-default', base.audioPreviewDefaultSource),
		}
	}

	function renderSlotRows(ui) {
		const wrap = container.querySelector('#live-audio-slots')
		if (!wrap) return
		const opts = alsaCaptureDeviceOptions(captureDevices)
		const configured = liveState?.configured?.slots || []
		let html = ''
		for (let i = 1; i <= LIVE_AUDIO_MAX_SLOTS; i++) {
			const show = i <= ui.count
			const cur = ui.slots[i - 1] || ''
			const cfg = configured.find((s) => s && Number(s.slot) === i)
			const routeHint = cfg?.route ? `<span class="settings-note small" style="display:block;margin-top:0.25rem">${esc(cfg.route)}</span>` : ''
			let optHtml = opts
				.map((o) => `<option value="${esc(o.value)}"${o.value === cur ? ' selected' : ''}>${esc(o.label)}</option>`)
				.join('')
			if (cur && !opts.some((o) => o.value === cur)) {
				optHtml += `<option value="${esc(cur)}" selected>${esc(cur)} (saved)</option>`
			}
			html += `
				<div class="settings-group live-audio-slot-row" data-slot="${i}" style="display:${show ? 'block' : 'none'};margin-bottom:0.75rem">
					<label>Slot ${i} — capture device</label>
					<div style="display:flex;gap:0.5rem;align-items:center;">
						<select id="live-audio-slot-${i}-device" class="live-audio-device-select" style="flex:1">${optHtml}</select>
						<button type="button" class="btn btn--secondary live-audio-remove-slot" data-slot-index="${i - 1}" style="padding:4px 12px;font-size:0.8rem;white-space:nowrap;">Remove</button>
					</div>
					${routeHint}
				</div>`
		}
		wrap.innerHTML = html
	}

	function renderStatus() {
		const el = container.querySelector('#live-audio-status')
		if (!el) return
		const st = liveState?.status || liveState?.liveAudioInputsStatus
		const cm = liveState?.channelMap || {}
		const inputEntries = listInputChannels(cm).filter((e) => e.kind === 'live_audio')
		if (inputEntries.length === 0) {
			const count = parseInt(String(liveState?.liveAudioCount ?? liveState?.configured?.count ?? '0'), 10) || 0
			if (count <= 0) {
				el.innerHTML =
					'<span class="settings-note">Add capture devices below. Each slot uses one dedicated Caspar channel (allocated after apply + restart).</span>'
				return
			}
			el.innerHTML =
				'<span class="status-warn">Live audio channels not in channelMap yet. Apply Caspar config and restart, then refresh.</span>'
			return
		}
		const lines = [
			`<strong>Live audio inputs:</strong> ${inputEntries.length} dedicated channel(s)`,
			`<span class="settings-note small">${inputEntries.map((e) => `Slot ${e.slot} → ch ${e.channel} (${e.route})`).join(' · ')}</span>`,
		]
		if (st && typeof st === 'object') {
			if (st.enabled === false && st.reason) {
				lines.push(`<span class="status-warn">${esc(st.reason)}</span>`)
			}
			if (Array.isArray(st.started) && st.started.length) {
				lines.push(
					`<span class="status-ok">Started: ${st.started.map((x) => esc(x.slot != null ? `slot ${x.slot}` : x.layer)).join(', ')}</span>`
				)
			}
			if (Array.isArray(st.failed) && st.failed.length) {
				lines.push(
					`<span class="status-warn">Failed: ${st.failed.map((x) => esc(x.message || x.slot || x.layer)).join('; ')}</span>`
				)
			}
		}
		const preview = liveState?.configured?.audioPreview || liveState?.audioPreview
		if (preview?.enabled && preview?.channel != null) {
			lines.push(`<span>Headphones bus: ch ${preview.channel} (${esc(preview.bus || 'preview')})</span>`)
		}
		el.innerHTML = lines.join('<br>')
	}

	function renderPanel() {
		const cfg = settingsState.getSettings() || {}
		const ui = readLiveAudioCasparSettings(cfg.casparServer || {})
		const deviceOpts = alsaCaptureDeviceOptions(captureDevices)
		const previewDevices = [{ value: '', label: 'Default sink' }]
		for (const d of captureDevices) {
			const n = String(d.name || d.id || '').trim()
			if (n) previewDevices.push({ value: n, label: n })
		}

		container.innerHTML = `
			<h3 class="settings-category">Live audio (ALSA / USB)</h3>
			<p class="settings-note">Each capture device uses its own Caspar channel (no shared inputs host). Set devices below, then <strong>Apply server config and restart</strong> so channels are allocated. Drag inputs from Sources → Live onto looks.</p>
			<div id="live-audio-status" class="settings-note" style="margin-bottom:0.75rem"></div>

			<input type="hidden" id="live-audio-slot-count" value="${ui.count}" />
			<div id="live-audio-slots"></div>
			<div class="settings-group" style="margin-top:0.5rem;margin-bottom:1rem">
				<button type="button" class="btn btn--secondary" id="live-audio-add-slot"${ui.count >= LIVE_AUDIO_MAX_SLOTS ? ' disabled' : ''}>+ Add Live Audio Input</button>
			</div>

			<hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:1rem 0" />

			<h4 style="margin:0 0 0.5rem;font-size:13px">PGM routing (always-on)</h4>
			<div class="settings-group checkbox">
				<label><input type="checkbox" id="live-audio-pgm-always" ${ui.pgmAlwaysOn ? 'checked' : ''}> Route live inputs to program after connect</label>
			</div>
			<div class="settings-group" style="display:flex;gap:0.75rem;flex-wrap:wrap">
				<div><label>Screen</label><input type="number" id="live-audio-pgm-screen" min="1" max="4" value="${ui.pgmScreen}" style="width:4rem" /></div>
				<div><label>First PGM layer</label><input type="number" id="live-audio-pgm-layer" min="1" max="99" value="${ui.pgmLayer}" style="width:4rem" /></div>
			</div>
			<div class="settings-group checkbox">
				<label><input type="checkbox" id="live-audio-pgm-audio-only" ${ui.pgmAudioOnly ? 'checked' : ''}> Audio only on PGM routes (opacity 0)</label>
			</div>

			<hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:1rem 0" />

			<h4 style="margin:0 0 0.5rem;font-size:13px">Headphones / solo (audio preview)</h4>
			<p class="settings-note small">Uses <code>&lt;system-audio&gt;</code> on preview or multiview — not the legacy PortAudio monitor channel.</p>
			<div class="settings-group checkbox">
				<label><input type="checkbox" id="live-audio-preview-en" ${ui.audioPreviewEnabled ? 'checked' : ''}> Enable audio preview bus</label>
			</div>
			<div class="settings-group">
				<label>Preview bus</label>
				<select id="live-audio-preview-bus" style="width:100%">
					<option value="preview_1" ${ui.audioPreviewBus === 'preview_1' ? 'selected' : ''}>Preview 1</option>
					<option value="multiview" ${ui.audioPreviewBus === 'multiview' ? 'selected' : ''}>Multiview</option>
				</select>
			</div>
			<div class="settings-group">
				<label>Preview screen index</label>
				<input type="number" id="live-audio-preview-screen" min="1" max="4" value="${ui.audioPreviewScreen}" style="width:4rem" />
			</div>
			<div class="settings-group">
				<label>OpenAL device (optional)</label>
				<select id="live-audio-preview-device" style="width:100%">
					${previewDevices.map((o) => `<option value="${esc(o.value)}"${o.value === ui.audioPreviewDevice ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
				</select>
			</div>
			<div class="settings-group">
				<label>When solo cleared</label>
				<select id="live-audio-preview-default" style="width:100%">
					<option value="preview_1" ${ui.audioPreviewDefaultSource === 'preview_1' ? 'selected' : ''}>Preview 1</option>
					<option value="program_1" ${ui.audioPreviewDefaultSource === 'program_1' ? 'selected' : ''}>Program 1</option>
					<option value="multiview" ${ui.audioPreviewDefaultSource === 'multiview' ? 'selected' : ''}>Multiview</option>
				</select>
			</div>

			<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:1rem">
				<button type="button" class="btn btn--secondary" id="live-audio-refresh-devices">Refresh devices</button>
				<button type="button" class="btn btn--primary" id="live-audio-save-config">Save config</button>
				<button type="button" class="btn btn--secondary" id="live-audio-apply-routes">Apply PLAY + PGM routes</button>
			</div>
			<p class="settings-note" id="live-audio-action-status" style="margin-top:0.35rem"></p>
			<p class="settings-note small"><strong>Note:</strong> Regenerating CasparCG config and restarting the server is only required when adding or removing slots (which alters the audio channel map layout). If you only changed capture device names for existing slots, just click <strong>Apply PLAY + PGM routes</strong> below to apply changes instantly.</p>
		`

		renderSlotRows(ui)
		renderStatus()

		container.querySelector('#live-audio-add-slot')?.addEventListener('click', (e) => {
			e.preventDefault()
			const currentUi = readUiFromDom()
			if (currentUi.count >= LIVE_AUDIO_MAX_SLOTS) return

			currentUi.count++

			const countEl = container.querySelector('#live-audio-slot-count')
			if (countEl) countEl.value = currentUi.count

			renderSlotRows(currentUi)

			const addBtn = container.querySelector('#live-audio-add-slot')
			if (addBtn) addBtn.disabled = currentUi.count >= LIVE_AUDIO_MAX_SLOTS
		})

		container.querySelector('#live-audio-slots')?.addEventListener('click', (e) => {
			const btn = e.target.closest('.live-audio-remove-slot')
			if (!btn) return
			e.preventDefault()

			const idx = parseInt(btn.getAttribute('data-slot-index') || '0', 10)
			const currentUi = readUiFromDom()

			currentUi.slots.splice(idx, 1)
			currentUi.slots.push('')
			currentUi.count = Math.max(0, currentUi.count - 1)

			const countEl = container.querySelector('#live-audio-slot-count')
			if (countEl) countEl.value = currentUi.count

			renderSlotRows(currentUi)

			const addBtn = container.querySelector('#live-audio-add-slot')
			if (addBtn) addBtn.disabled = currentUi.count >= LIVE_AUDIO_MAX_SLOTS
		})

		const statusLine = container.querySelector('#live-audio-action-status')
		const setActionStatus = (msg, ok = true) => {
			if (statusLine) {
				statusLine.textContent = msg || ''
				statusLine.style.color = ok ? 'var(--accent-green, #86efac)' : 'var(--accent-red, #f87171)'
			}
		}

		container.querySelector('#live-audio-refresh-devices')?.addEventListener('click', async () => {
			setActionStatus('Refreshing capture devices…', true)
			try {
				await loadDevices(true)
				renderSlotRows(readUiFromDom())
				setActionStatus('Device list updated.', true)
			} catch (e) {
				setActionStatus(e?.message || String(e), false)
			}
		})

		container.querySelector('#live-audio-save-config')?.addEventListener('click', async () => {
			const ui = readUiFromDom()
			if (ui.count > 0) ui.hostChannelEnabled = true
			setActionStatus('Saving…', true)
			try {
				await api.post('/api/audio/live-inputs/config', buildLiveAudioConfigBody(ui))
				await settingsState.load()
				await loadLiveInputs()
				renderStatus()
				renderSlotRows(readUiFromDom())
				setActionStatus('Saved. (Only regenerate Caspar config & restart if slot count changed; otherwise, click "Apply PLAY + PGM routes")', true)
				document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
				document.dispatchEvent(new CustomEvent('highascg-live-audio-configured', { detail: liveState }))
			} catch (e) {
				setActionStatus(e?.message || String(e), false)
			}
		})

		container.querySelector('#live-audio-apply-routes')?.addEventListener('click', async () => {
			setActionStatus('Applying routes…', true)
			try {
				await api.post('/api/audio/live-inputs/apply', {})
				await loadLiveInputs()
				renderStatus()
				setActionStatus('PLAY + PGM routes sent (requires AMCP connected).', true)
				document.dispatchEvent(new CustomEvent('highascg-live-audio-configured', { detail: liveState }))
			} catch (e) {
				setActionStatus(e?.message || String(e), false)
			}
		})
	}

	try {
		await Promise.all([loadDevices(false), loadLiveInputs(), settingsState.load()])
		renderPanel()
	} catch (e) {
		container.innerHTML = `<p class="status-error">Failed to load live audio settings: ${esc(e?.message || e)}</p>`
	}

	return async function refresh() {
		await Promise.all([loadDevices(false), loadLiveInputs()])
		renderPanel()
	}
}
