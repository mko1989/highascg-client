/**
 * Header bar streaming and recording status badges (right of FTB).
 * Event-driven — server pushes start/stop over WebSocket; no status polling.
 */

import { settingsState } from '../lib/settings-state.js'
import {
	bootstrapStreamingChannelStatus,
	getStreamingChannelStatus,
	subscribeStreamingChannelStatus,
} from '../lib/streaming-channel-state.js'

export function initStreamingBadge(container) {
	const streamStateWrap = document.createElement('div')
	streamStateWrap.className = 'header-stream-state'
	container.appendChild(streamStateWrap)

	function focusDeviceConnector(connectorId) {
		if (typeof window.highascgActivateWorkspaceTab === 'function') {
			window.highascgActivateWorkspaceTab('device-view')
		}
		setTimeout(() => {
			window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', { detail: { connectorId } }))
		}, 50)
	}

	function hasStreamOrRecordOutputs() {
		const settings = settingsState.getSettings() || {}
		const streamOut = Array.isArray(settings?.streamOutputs) ? settings.streamOutputs : []
		const recordOut = Array.isArray(settings?.recordOutputs) ? settings.recordOutputs : []
		const active = (row) => row && row.enabled !== false && String(row?.id || '').trim()
		return streamOut.some(active) || recordOut.some(active)
	}

	function renderBadges(st) {
		if (!hasStreamOrRecordOutputs()) {
			streamStateWrap.innerHTML = ''
			streamStateWrap.hidden = true
			return
		}
		const settings = settingsState.getSettings() || {}
		const streamOut = Array.isArray(settings?.streamOutputs) ? settings.streamOutputs : []
		const recordOut = Array.isArray(settings?.recordOutputs) ? settings.recordOutputs : []
		streamStateWrap.innerHTML = ''

		for (const s of streamOut) {
			if (s?.enabled === false) continue
			const id = String(s?.id || '').trim()
			if (!id) continue
			const idx = id.match(/(\d+)/)?.[1] || ''
			const fallback = `Str${idx || ''}`.trim() || 'Str'
			const name = String(s?.name || s?.label || fallback).trim() || fallback
			const isOn = !!st?.rtmp?.active && String(st?.rtmp?.outputId || '') === id
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'header-stream-indicator'
			if (isOn) b.classList.add('active')
			const firstChar = name.trim().charAt(0).toUpperCase() || 'S'
			const labelText =
				name.toLowerCase().startsWith('str') || name.toLowerCase().startsWith('stream')
					? 'S' + (idx || '1')
					: firstChar + (idx || '')
			b.textContent = labelText
			b.title = isOn ? `${name} is streaming` : `${name} (idle)`
			b.addEventListener('click', () => focusDeviceConnector(id))
			streamStateWrap.appendChild(b)
		}

		for (const r of recordOut) {
			if (r?.enabled === false) continue
			const id = String(r?.id || '').trim()
			if (!id) continue
			const idx = id.match(/(\d+)/)?.[1] || ''
			const fallback = `Rec${idx || ''}`.trim() || 'Rec'
			const name = String(r?.name || r?.label || fallback).trim() || fallback
			const isOn = !!st?.record?.active && String(st?.record?.outputId || '') === id
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'header-stream-indicator'
			if (isOn) b.classList.add('active')
			const firstChar = name.trim().charAt(0).toUpperCase() || 'R'
			const labelText =
				name.toLowerCase().startsWith('rec') || name.toLowerCase().startsWith('record')
					? 'R' + (idx || '1')
					: firstChar + (idx || '')
			b.textContent = labelText
			b.title = isOn
				? `${name} is recording${st?.record?.path ? ` (${st.record.path})` : ''}`
				: `${name} (idle)`
			b.addEventListener('click', () => focusDeviceConnector(id))
			streamStateWrap.appendChild(b)
		}

		streamStateWrap.hidden = !streamStateWrap.childElementCount
	}

	const unsubStatus = subscribeStreamingChannelStatus((st) => renderBadges(st))

	function scheduleRefresh() {
		if (!hasStreamOrRecordOutputs()) {
			streamStateWrap.innerHTML = ''
			streamStateWrap.hidden = true
			return
		}
		renderBadges(getStreamingChannelStatus())
	}

	scheduleRefresh()
	void bootstrapStreamingChannelStatus()

	document.addEventListener('highascg-streaming-changed', () => scheduleRefresh())

	const unsubSettings = settingsState.subscribe(() => scheduleRefresh())

	return {
		destroy: () => {
			unsubStatus()
			unsubSettings?.()
		},
	}
}
