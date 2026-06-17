/**
 * Header bar streaming and recording status badges (right of FTB).
 */

import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'

export function initStreamingBadge(container) {
	const streamStateWrap = document.createElement('div')
	streamStateWrap.className = 'header-stream-state'
	container.appendChild(streamStateWrap)

	function focusDeviceConnector(connectorId) {
		window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', { detail: { connectorId } }))
	}

	async function syncStreamingRecordBadge() {
		try {
			const settings = settingsState.getSettings() || {}
			const st = await api.get('/api/streaming-channel')
			const streamOut = Array.isArray(settings?.streamOutputs) ? settings.streamOutputs : []
			const recordOut = Array.isArray(settings?.recordOutputs) ? settings.recordOutputs : []
			streamStateWrap.innerHTML = ''

			for (const s of streamOut) {
				const id = String(s?.id || '').trim()
				if (!id) continue
				const idx = id.match(/(\d+)/)?.[1] || ''
				const fallback = `Str${idx || ''}`.trim() || 'Str'
				const name = String(s?.name || s?.label || fallback).trim() || fallback
				const isOn = !!st?.rtmp?.active && String(st?.rtmp?.outputId || '') === id
				if (!isOn) continue
				const b = document.createElement('button')
				b.type = 'button'
				b.className = 'header-btn header-btn--on-air'
				b.textContent = name
				b.title = `${name} is streaming`
				b.addEventListener('click', () => focusDeviceConnector(id))
				streamStateWrap.appendChild(b)
			}

			for (const r of recordOut) {
				const id = String(r?.id || '').trim()
				if (!id) continue
				const idx = id.match(/(\d+)/)?.[1] || ''
				const fallback = `Rec${idx || ''}`.trim() || 'Rec'
				const name = String(r?.name || r?.label || fallback).trim() || fallback
				const isOn = !!st?.record?.active && String(st?.record?.outputId || '') === id
				if (!isOn) continue
				const b = document.createElement('button')
				b.type = 'button'
				b.className = 'header-btn header-btn--on-air'
				b.textContent = name
				b.title = `${name} is recording${st?.record?.path ? ` (${st.record.path})` : ''}`
				b.addEventListener('click', () => focusDeviceConnector(id))
				streamStateWrap.appendChild(b)
			}

			streamStateWrap.hidden = !streamStateWrap.childElementCount
		} catch {
			streamStateWrap.innerHTML = ''
			streamStateWrap.hidden = true
		}
	}

	void syncStreamingRecordBadge()
	const timer = setInterval(() => {
		if (document.visibilityState !== 'visible') return
		void syncStreamingRecordBadge()
	}, 2000)

	document.addEventListener('highascg-streaming-changed', () => {
		void syncStreamingRecordBadge()
	})

	return {
		destroy: () => clearInterval(timer),
	}
}
