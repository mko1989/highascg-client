/**
 * Stream Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'

export function renderStreamOutControls(h, conn, { currentSettings, streamingStatus, statusEl, load, setCasparRestartDirty, onRemoveStreamOutput }) {
	const wrapCtl = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	
	const note = Object.assign(document.createElement('p'), {
		className: 'device-view__note',
		style: 'margin-bottom: 12px; color: #ff9999;',
		textContent: 'Dynamic streaming features have been completely removed to optimize server performance.'
	})
	wrapCtl.appendChild(note)

	const removeBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		type: 'button',
		textContent: 'Remove stream output',
		title: 'Remove this output from settings and clear its cables',
	})

	removeBtn.onclick = async () => {
		if (!onRemoveStreamOutput) return
		if (!confirm(`Remove stream output ${conn.id}?`)) return
		try {
			await onRemoveStreamOutput(String(conn.id || ''))
		} catch (e) {
			setStatus(statusEl, e?.message || String(e), false)
		}
	}

	wrapCtl.appendChild(removeBtn)
	h.append(wrapCtl)
}
