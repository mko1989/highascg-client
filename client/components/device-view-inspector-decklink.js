/**
 * DeckLink IO controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { api } from '../lib/api-client.js'
import { CASPAR_HOST } from './device-view-helpers.js'
import { DECKLINK_REAR_ORDER_KEY, readSavedDecklinkOrder, orderDecklinkConnectors } from '../lib/device-view-decklink-order.js'
import {
	collectDecklinkDeviceIndices,
	resolveDecklinkKeyFillState,
} from '../lib/device-view-decklink-keyfill.js'
import { decklinkInputForSlot, decklinkSlotFromConnector, routeForDecklinkSlot } from '../lib/input-channels.js'

function decklinkMergedConnectors(lastPayload) {
	const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const deckIo = sug.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_io')
	const deckOut = sug.filter((c) => c && c.deviceId === CASPAR_HOST && c.kind === 'decklink_out')
	return [...deckIo, ...deckOut].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
}

function renderDecklinkKeyFillControls(h, conn, { lastPayload, statusEl, load, setCasparRestartDirty }) {
	const { fillDevice, keyFillEnabled, keyDevice } = resolveDecklinkKeyFillState(conn, lastPayload)
	const keyIndices = collectDecklinkDeviceIndices(lastPayload, { exclude: fillDevice })

	const box = Object.assign(document.createElement('div'), {
		className: 'device-view__decklink-kf',
	})
	const row = Object.assign(document.createElement('div'), { className: 'device-view__decklink-kf-row' })

	const kfCheck = Object.assign(document.createElement('input'), { type: 'checkbox', id: 'decklink_kf_on' })
	kfCheck.checked = keyFillEnabled
	const kfLbl = Object.assign(document.createElement('label'), { htmlFor: 'decklink_kf_on', textContent: 'Fill + key' })

	const keySel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	keySel.innerHTML = '<option value="0">Key port…</option>'
	for (const idx of keyIndices) {
		const opt = document.createElement('option')
		opt.value = String(idx)
		opt.textContent = String(idx)
		keySel.append(opt)
	}
	if (keyDevice > 0 && !keyIndices.includes(keyDevice)) {
		const opt = document.createElement('option')
		opt.value = String(keyDevice)
		opt.textContent = String(keyDevice)
		keySel.append(opt)
	}
	if (keyDevice > 0) keySel.value = String(keyDevice)
	else if (keyIndices.length) keySel.value = String(keyIndices[0])

	const syncKeyUi = () => {
		keySel.disabled = !kfCheck.checked
	}
	syncKeyUi()

	row.append(kfCheck, kfLbl, keySel)
	box.append(row)
	h.append(box)

	let saving = false
	const persist = async () => {
		if (saving) return
		saving = true
		const enabled = kfCheck.checked
		const kd = enabled ? parseInt(String(keySel.value || '0'), 10) || 0 : 0
		if (enabled && fillDevice > 0 && kd > 0 && kd === fillDevice) {
			setStatus(statusEl, 'Key port must differ from fill.', false)
			saving = false
			return
		}
		if (enabled && kd <= 0) {
			setStatus(statusEl, 'Choose key port.', false)
			saving = false
			return
		}
		const casparPatch = {
			ioDirection: 'out',
			decklinkKeyFill: enabled,
			decklinkKeyDevice: enabled ? kd : 0,
			decklinkKeyer: 'internal',
		}
		if (conn?.caspar?.outputBinding) casparPatch.outputBinding = conn.caspar.outputBinding
		try {
			await Actions.updateConnector(conn.id, { caspar: casparPatch })
			setCasparRestartDirty(true)
			setStatus(statusEl, enabled ? `Key on port ${kd}.` : 'Fill only.', true)
			await load()
		} catch (e) {
			setStatus(statusEl, `Save failed: ${e?.message || e}`, false)
		} finally {
			saving = false
		}
	}

	kfCheck.addEventListener('change', () => {
		syncKeyUi()
		if (kfCheck.checked && (parseInt(String(keySel.value || '0'), 10) || 0) <= 0 && keyIndices.length) {
			keySel.value = String(keyIndices[0])
		}
		void persist()
	})
	keySel.addEventListener('change', () => void persist())
}

/**
 * Rear-panel DeckLink port order editor (matches GPU layout inspector pattern).
 */
function renderDecklinkRearOrderEditor(h, { lastPayload, load }) {
	const editMode = document.querySelector('.device-view__band--caspar')?.classList.contains('device-view--edit-mode-decklink')
	if (!editMode) return

	const deckMerged = decklinkMergedConnectors(lastPayload)
	if (!deckMerged.length) return

	const saved = readSavedDecklinkOrder()
	let orderIds = orderDecklinkConnectors(deckMerged, saved).orderIds.slice()

	const editGroup = Object.assign(document.createElement('div'), {
		style: 'border: 1px solid #555; padding: 8px; border-radius: 4px; background: #333; margin-bottom: 8px;',
	})
	editGroup.innerHTML =
		'<div style="font-weight:bold; margin-bottom: 6px; font-size: 11px; color: #aaa;">DeckLink rear order (drag to reorder)</div>'

	const listContainer = Object.assign(document.createElement('div'), {
		style: 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;',
	})

	const persistAndRefresh = async () => {
		try {
			localStorage.setItem(DECKLINK_REAR_ORDER_KEY, JSON.stringify(orderIds))
		} catch (e) {
			console.warn('[device-view] decklink order persist', e)
		}
		if (load) await load()
	}

	const labelForId = (id) => {
		const c = deckMerged.find((x) => String(x.id) === String(id))
		return c ? String(c.label || c.id) : id
	}

	const renderList = () => {
		listContainer.innerHTML = ''
		orderIds.forEach((id, index) => {
			const row = Object.assign(document.createElement('div'), {
				style:
					'display:flex; flex-direction:row; align-items:center; justify-content:space-between; gap:6px; padding:6px; border:1px solid #444; border-radius:3px; background:#2a2a2a; cursor:grab;',
				draggable: true,
			})
			const left = Object.assign(document.createElement('div'), {
				style: 'font-size:11px; display:flex; flex-direction:column; gap:2px; min-width:0; flex:1',
			})
			left.innerHTML = `<span style="opacity:0.75;font-size:10px">Slot ${index + 1}</span><strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${labelForId(
				id
			)}</strong><span style="opacity:0.55;font-size:9px;font-family:ui-monospace,monospace">${id}</span>`

			const grip = Object.assign(document.createElement('span'), {
				textContent: '≡',
				style: 'opacity:0.6; font-size:14px; flex-shrink:0',
			})
			row.append(left, grip)

			row.addEventListener('dragstart', (ev) => {
				ev.dataTransfer.setData('application/x-highascg-inspector-decklink-slot', String(index))
				row.style.opacity = '0.5'
			})
			row.addEventListener('dragend', () => {
				row.style.opacity = '1'
			})
			row.addEventListener('dragover', (ev) => {
				ev.preventDefault()
				row.style.borderTop = '2px solid #007bff'
			})
			row.addEventListener('dragleave', () => {
				row.style.borderTop = '1px solid #444'
			})
			row.addEventListener('drop', (ev) => {
				ev.preventDefault()
				row.style.borderTop = '1px solid #444'
				const dragIdx = parseInt(ev.dataTransfer.getData('application/x-highascg-inspector-decklink-slot'), 10)
				if (!Number.isNaN(dragIdx) && dragIdx !== index) {
					const t = orderIds.splice(dragIdx, 1)[0]
					let insertAt = index
					if (dragIdx < index) insertAt = index - 1
					orderIds.splice(insertAt, 0, t)
					void persistAndRefresh()
				}
			})
			listContainer.append(row)
		})
	}

	renderList()

	const actionsRow = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px; margin-top:8px; flex-wrap:wrap' })
	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save' })
	const exportBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Export' })
	const loadBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Load' })
	const resetBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		textContent: 'Reset order',
		style: 'color: #ff6b6b; border-color: #ff6b6b33; margin-left: auto;',
		title: 'Clear saved DeckLink rear order for this browser',
	})
	const fileIn = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
	fileIn.style.display = 'none'

	saveBtn.onclick = () => void persistAndRefresh()

	exportBtn.onclick = () => {
		const payload = { version: 1, decklinkRearOrder: orderIds }
		const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2))
		const a = document.createElement('a')
		a.setAttribute('href', dataStr)
		a.setAttribute('download', 'decklink_rear_panel_order.json')
		document.body.appendChild(a)
		a.click()
		a.remove()
	}

	loadBtn.onclick = () => fileIn.click()
	fileIn.onchange = async () => {
		const file = fileIn.files?.[0]
		fileIn.value = ''
		if (!file) return
		try {
			const text = await file.text()
			const parsed = JSON.parse(text)
			let raw = []
			if (Array.isArray(parsed)) raw = parsed
			else if (Array.isArray(parsed?.decklinkRearOrder)) raw = parsed.decklinkRearOrder
			else if (Array.isArray(parsed?.connectorIds)) raw = parsed.connectorIds
			const asStrings = raw.map((x) => String(x)).filter(Boolean)
			const merged = orderDecklinkConnectors(deckMerged, asStrings)
			orderIds = merged.orderIds.slice()
			await persistAndRefresh()
		} catch (e) {
			alert('Invalid DeckLink order file: ' + (e?.message || e))
		}
	}

	resetBtn.onclick = async () => {
		if (!confirm('Clear saved DeckLink rear panel order?')) return
		try {
			localStorage.removeItem(DECKLINK_REAR_ORDER_KEY)
		} catch (e) {
			console.warn('[device-view] decklink order reset', e)
		}
		orderIds = orderDecklinkConnectors(deckMerged, []).orderIds.slice()
		if (load) await load()
	}

	actionsRow.append(saveBtn, exportBtn, loadBtn, resetBtn, fileIn)
	editGroup.append(listContainer, actionsRow)
	h.append(editGroup)
}

function appendDecklinkSectionHeading(parent, text) {
	parent.append(
		Object.assign(document.createElement('h4'), {
			className: 'device-view__decklink-io-heading',
			textContent: text,
		})
	)
}

function appendDecklinkSectionNote(parent, text) {
	parent.append(
		Object.assign(document.createElement('p'), {
			className: 'device-view__decklink-io-note',
			textContent: text,
		})
	)
}

export function renderDeckLinkIoControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty }) {
	renderDecklinkRearOrderEditor(h, { lastPayload, load })

	if (conn?.kind === 'decklink_out') return

	const ioDir = String(conn?.caspar?.ioDirection || 'in').toLowerCase() === 'out' ? 'out' : 'in'
	const devNum = parseInt(String(conn?.externalRef || '0'), 10) || 0
	const slot = decklinkSlotFromConnector(conn)
	const channelMap = lastPayload?.live?.caspar?.channelMap || currentSettings?.channelMap || {}
	const inputEntry = decklinkInputForSlot(channelMap, slot)
	const isCurrentlyInput = ioDir === 'in'

	const ioWrap = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })

	const inputSection = Object.assign(document.createElement('div'), { className: 'device-view__decklink-io-section' })
	appendDecklinkSectionHeading(inputSection, 'Input')
	appendDecklinkSectionNote(
		inputSection,
		'Each DeckLink input uses its own Caspar channel so you can meter and route it independently. Drag the input from Sources onto other layers.'
	)

	if (isCurrentlyInput) {
		const removeBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: 'Stop input',
			style: 'width:100%',
		})
		removeBtn.onclick = async () => {
			removeBtn.disabled = true
			try {
				if (inputEntry?.channel != null) {
					const layer = inputEntry.layer ?? slot
					const cl = `${inputEntry.channel}-${layer}`
					try {
						await api.post('/api/raw', { cmd: `STOP ${cl}` })
						await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` })
					} catch (e) {
						/* best effort */
					}
				}
				const routeValue = routeForDecklinkSlot(channelMap, slot) || `decklink://${devNum}`
				try {
					const rm = await api.post('/api/device-view', { removeExtraLiveSource: { value: routeValue } })
					if (Array.isArray(rm?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
						window.__highascgApplyExtraLiveSources(rm.extraLiveSources)
					}
				} catch (e) {
					/* best effort */
				}
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'out' } })
				setCasparRestartDirty(true)
				setStatus(statusEl, `Port ${devNum}: output mode.`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				removeBtn.disabled = false
			}
		}
		inputSection.appendChild(removeBtn)

		if (inputEntry?.channel != null) {
			inputSection.append(
				Object.assign(document.createElement('p'), {
					className: 'device-view__note',
					style: 'margin-top:8px;font-size:11px',
					textContent: `Live on ch ${inputEntry.channel} · layer ${inputEntry.layer ?? slot} · ${inputEntry.route || ''}`,
				})
			)
		}
	} else {
		const formBox = Object.assign(document.createElement('div'), { className: 'device-view__decklink-input-setup' })

		if (inputEntry == null) {
			appendDecklinkSectionNote(
				formBox,
				`Configure DeckLink input count in Settings (slot ${slot} needs a dedicated channel). Apply Caspar config and restart before using this port as input.`
			)
		}

		const activateBtn = Object.assign(document.createElement('button'), {
			className: 'header-btn',
			textContent: 'Use as input',
			style: 'width:100%;margin-top:8px',
		})

		activateBtn.onclick = async () => {
			activateBtn.disabled = true

			try {
				await Actions.updateConnector(conn.id, { caspar: { ioDirection: 'in' } })

				const refetched = await Actions.loadDeviceView()
				const newMap = refetched?.live?.caspar?.channelMap || refetched?.suggested?.channelMap || {}
				const entry = decklinkInputForSlot(newMap, slot)
				const layer = entry?.layer ?? slot
				const playCh = entry?.channel

				if (playCh != null && devNum > 0) {
					try {
						await api.post('/api/raw', { cmd: `PLAY ${playCh}-${layer} DECKLINK ${devNum}` })
					} catch (e) {
						console.warn('[decklink-input] immediate PLAY failed', e)
					}

					const routeValue = entry?.route || routeForDecklinkSlot(newMap, slot)
					if (routeValue) {
						const liveSource = {
							value: routeValue,
							type: 'route',
							routeType: 'decklink',
							label: entry?.label || `DeckLink ${slot}`,
							decklinkSlot: slot,
							inputsChannel: playCh,
							inputsLayer: layer,
							decklinkDevice: devNum,
							connectorId: conn.id,
						}
						try {
							const addRes = await api.post('/api/device-view', { addExtraLiveSource: liveSource })
							if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
								window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
							}
						} catch (e) {
							console.warn('[decklink-input] add extra live source failed', e)
						}
					}
				} else {
					setStatus(statusEl, `Port marked input. Set decklink_input_count ≥ ${slot} and restart Caspar.`, false)
				}

				setCasparRestartDirty(true)
				setStatus(statusEl, playCh != null ? `Port ${devNum} is input on ch ${playCh}.` : `Port ${devNum} is input.`, true)
				await load()
			} catch (e) {
				setStatus(statusEl, `Failed: ${e?.message || e}`, false)
				activateBtn.disabled = false
			}
		}

		formBox.appendChild(activateBtn)
		inputSection.appendChild(formBox)
	}

	ioWrap.appendChild(inputSection)

	ioWrap.append(Object.assign(document.createElement('hr'), { className: 'device-view__section-divider' }))

	const outputSection = Object.assign(document.createElement('div'), { className: 'device-view__decklink-io-section' })
	appendDecklinkSectionHeading(outputSection, 'Output')

	if (isCurrentlyInput) {
		appendDecklinkSectionNote(
			outputSection,
			'This port is in input mode. Stop input above to use it as a program / fill+key output.'
		)
	} else {
		appendDecklinkSectionNote(outputSection, 'Program output, fill+key pairs, and destination mapping.')
		renderDecklinkKeyFillControls(outputSection, conn, { lastPayload, statusEl, load, setCasparRestartDirty })
	}

	ioWrap.appendChild(outputSection)
	h.append(ioWrap)
}
