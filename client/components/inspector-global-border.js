import { sceneState } from '../lib/scene-state.js'
import { PIP_OVERLAY_MAP } from '../lib/pip-overlay-registry.js'
import { renderParamEditor } from './inspector-pip-overlay.js'
import { showScenesToast } from './scenes-editor-support.js'
import { getResolutionForScreen } from './inspector-channel-resolution.js'
import globalBorderFixtureText from '../fixtures/global-border.txt?raw'
import {
	GLOBAL_BORDER_ARTNET_CHANNEL_DEFS,
	normalizeArtnetChannelMap,
} from '../lib/global-border-artnet-map.js'

function requestGlobalBorderPush() {
	window.dispatchEvent(new CustomEvent('highascg-global-border-push'))
}

function scheduleGlobalBorderConfigSave() {
	window.dispatchEvent(new CustomEvent('highascg-global-border-config-save'))
}

export function renderGlobalBorderInspector(root, screenIndex, stateStore) {
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Global Border: Screen ${screenIndex + 1}`
	root.appendChild(title)

	const gbNow = () => sceneState.getGlobalBorderForScreen(screenIndex)
	let gb = gbNow()

	if (!gb) {
		const setup = document.createElement('div')
		setup.className = 'inspector-group'
		setup.innerHTML =
			'<div class="inspector-group__title">Not configured</div><p class="inspector-field inspector-field--hint">This screen has no global border. Enable it here or check “Global Border” on the scene deck column header.</p>'
		const enableBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'scenes-btn',
			textContent: 'Enable global border on this screen',
		})
		enableBtn.addEventListener('click', () => {
			sceneState.setGlobalBorderForScreen(screenIndex, { enabled: true })
			requestGlobalBorderPush()
			renderGlobalBorderInspector(root, screenIndex, stateStore)
		})
		setup.appendChild(enableBtn)
		root.appendChild(setup)
		return
	}

	const patchGlobalBorder = (patch) => {
		sceneState.setGlobalBorderForScreen(screenIndex, patch)
	}

	const borderGrp = document.createElement('div')
	borderGrp.className = 'inspector-group'
	borderGrp.innerHTML = '<div class="inspector-group__title">Global Border Effect</div>'
	
	const typeWrap = document.createElement('div')
	typeWrap.className = 'inspector-field'
	const typeLab = document.createElement('label')
	typeLab.className = 'inspector-field__label'
	typeLab.textContent = 'Type'
	const typeSel = document.createElement('select')
	typeSel.className = 'inspector-field__select'
	const types = ['border', 'shadow', 'edge_strip', 'glow']
	types.forEach(t => {
		const opt = document.createElement('option')
		opt.value = t
		opt.textContent = t
		if (t === gb.type) opt.selected = true
		typeSel.appendChild(opt)
	})
	typeSel.addEventListener('change', () => {
		patchGlobalBorder({ type: typeSel.value })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})
	typeLab.appendChild(typeSel)
	typeWrap.appendChild(typeLab)
	borderGrp.appendChild(typeWrap)

	const fadeWrap = document.createElement('div')
	fadeWrap.className = 'inspector-field'
	const fadeLab = document.createElement('label')
	fadeLab.className = 'inspector-field__label'
	fadeLab.textContent = 'Fade Duration (frames)'
	const fadeInp = document.createElement('input')
	fadeInp.type = 'number'
	fadeInp.className = 'inspector-field__input'
	fadeInp.style.width = '60px'
	fadeInp.min = 0
	fadeInp.max = 250
	fadeInp.value = gb.fadeDuration ?? 25
	fadeInp.addEventListener('change', () => {
		const val = parseInt(fadeInp.value, 10)
		patchGlobalBorder({ fadeDuration: isNaN(val) ? 25 : val })
	})
	fadeLab.appendChild(fadeInp)
	fadeWrap.appendChild(fadeLab)
	borderGrp.appendChild(fadeWrap)

	const mirrorWrap = document.createElement('div')
	mirrorWrap.className = 'inspector-field'
	const mirrorLab = document.createElement('label')
	mirrorLab.className = 'inspector-field__label'
	mirrorLab.style.display = 'flex'
	mirrorLab.style.alignItems = 'center'
	mirrorLab.style.gap = '8px'
	const mirrorChk = document.createElement('input')
	mirrorChk.type = 'checkbox'
	mirrorChk.checked = gb.mirrorBorderOnPrv === true
	mirrorChk.addEventListener('change', () => {
		patchGlobalBorder({ mirrorBorderOnPrv: mirrorChk.checked })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})
	const prvCh = stateStore?.getState?.()?.channelMap?.previewChannels?.[screenIndex]
	const mirrorTxt = document.createElement('span')
	mirrorTxt.textContent = prvCh
		? `PRV on ch ${prvCh} — border controls update layer 997 only (PGM 998/996 unchanged until this is off)`
		: 'PRV on preview bus — layer 997 (no PRV channel mapped for this screen)'
	mirrorLab.appendChild(mirrorChk)
	mirrorLab.appendChild(mirrorTxt)
	mirrorWrap.appendChild(mirrorLab)
	borderGrp.appendChild(mirrorWrap)

	const def = PIP_OVERLAY_MAP.get(gb.type)
	if (def) {
		const paramsBlock = document.createElement('div')
		paramsBlock.className = 'inspector-effect-card__params'
		for (const schema of def.schema) {
			if (schema.key === 'side') continue
			
			const curVal = gb.params?.[schema.key] ?? schema.default
			renderParamEditor(paramsBlock, schema, curVal, (newVal) => {
				const cur = gbNow()
				if (!cur) return
				patchGlobalBorder({
					params: { ...cur.params, [schema.key]: newVal, side: 'inside' },
				})
			})
		}
		borderGrp.appendChild(paramsBlock)
	}
	root.appendChild(borderGrp)

	const screenActions = document.createElement('div')
	screenActions.className = 'inspector-group'
	screenActions.style.marginTop = '8px'
	const removeBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'scenes-btn scenes-btn--danger',
		textContent: 'Remove border from this screen',
	})
	removeBtn.title = 'Clears this screen from globalBorders (null slot). Art-Net and PGM border stop for this screen.'
	removeBtn.addEventListener('click', () => {
		if (!window.confirm(`Remove global border configuration from Screen ${screenIndex + 1}?`)) return
		sceneState.setGlobalBorderForScreen(screenIndex, { __clearSlot: true })
		requestGlobalBorderPush()
		window.dispatchEvent(new CustomEvent('global-border-state-changed'))
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})
	screenActions.appendChild(removeBtn)
	root.appendChild(screenActions)

	const presetGrp = document.createElement('div')
	presetGrp.className = 'inspector-group'
	presetGrp.innerHTML = '<div class="inspector-group__title">Border presets (PGM layers 998 ↔ 996)</div>'
	const slotCount = sceneState.getGlobalBorderPresetSlotCount(screenIndex)
	const presetRows = document.createElement('div')
	presetRows.style.display = 'flex'
	presetRows.style.flexDirection = 'column'
	presetRows.style.gap = '6px'
	for (let s = 1; s <= slotCount; s++) {
		const row = document.createElement('div')
		row.style.display = 'flex'
		row.style.flexWrap = 'wrap'
		row.style.alignItems = 'center'
		row.style.gap = '8px'
		const preset = sceneState.getGlobalBorderPreset(screenIndex, s)
		const lab = document.createElement('span')
		lab.style.minWidth = '120px'
		lab.style.fontSize = '0.85rem'
		lab.textContent = preset ? `${s}. ${preset.name}` : `${s}. —`
		const recallBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'scenes-btn scenes-btn--sm',
			textContent: 'Recall',
			disabled: !preset,
		})
		recallBtn.addEventListener('click', () => {
			if (!preset) return
			window.dispatchEvent(
				new CustomEvent('highascg-border-preset-recall', { detail: { screenIndex, slot: s } }),
			)
			showScenesToast('Preset recall sent to program border stack.', 'info')
		})
		const saveBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'scenes-btn scenes-btn--sm',
			textContent: 'Save',
		})
		saveBtn.addEventListener('click', () => {
			const nm = window.prompt('Preset name?', preset?.name || `Preset ${s}`)
			if (nm === null) return
			sceneState.saveGlobalBorderPresetSlot(screenIndex, s, nm)
			showScenesToast(`Saved border preset ${s}.`, 'info')
			renderGlobalBorderInspector(root, screenIndex, stateStore)
		})
		row.appendChild(lab)
		row.appendChild(recallBtn)
		row.appendChild(saveBtn)
		if (preset) {
			const delBtn = Object.assign(document.createElement('button'), {
				type: 'button',
				className: 'scenes-btn scenes-btn--sm scenes-btn--danger',
				textContent: 'Delete',
			})
			delBtn.addEventListener('click', () => {
				if (!window.confirm(`Delete preset ${s} (${preset.name})?`)) return
				sceneState.deleteGlobalBorderPresetSlot(screenIndex, s)
				showScenesToast('Preset removed.', 'info')
				renderGlobalBorderInspector(root, screenIndex, stateStore)
			})
			row.appendChild(delBtn)
		}
		presetRows.appendChild(row)
	}
	presetGrp.appendChild(presetRows)
	root.appendChild(presetGrp)

	const slicesGrp = document.createElement('div')
	slicesGrp.className = 'inspector-group'
	slicesGrp.innerHTML = '<div class="inspector-group__title">Slices (Multi-segment physical layout)</div>'
	const slicesBody = document.createElement('div')
	slicesBody.className = 'inspector-effect-card__params'
	slicesBody.style.display = 'flex'
	slicesBody.style.flexDirection = 'column'
	slicesBody.style.gap = '10px'

	const res = getResolutionForScreen(stateStore)

	const sliceBtns = document.createElement('div')
	sliceBtns.style.display = 'flex'
	sliceBtns.style.gap = '8px'
	sliceBtns.style.marginTop = '4px'

	const addBtn = document.createElement('button')
	addBtn.type = 'button'
	addBtn.className = 'scenes-btn scenes-btn--sm'
	addBtn.textContent = '+ Add Slice'
	addBtn.addEventListener('click', () => {
		const currentSlices = gbNow()?.slices || []
		patchGlobalBorder({ slices: [...currentSlices, { x: 0, y: 0, w: 0.5, h: 1 }] })
		renderSliceRows()
	})

	const fullBtn = document.createElement('button')
	fullBtn.type = 'button'
	fullBtn.className = 'scenes-btn scenes-btn--sm'
	fullBtn.textContent = 'Full Canvas'
	fullBtn.title = 'Reset to full screen border'
	fullBtn.addEventListener('click', () => {
		patchGlobalBorder({ slices: [] })
		renderSliceRows()
	})

	sliceBtns.appendChild(addBtn)
	sliceBtns.appendChild(fullBtn)
	slicesBody.appendChild(sliceBtns)

	function appendSliceRow(s, idx) {
		const row = document.createElement('div')
		row.className = 'inspector-slice-row'
		row.style.display = 'flex'
		row.style.alignItems = 'center'
		row.style.gap = '6px'
		row.style.background = 'rgba(255,255,255,0.03)'
		row.style.padding = '6px'
		row.style.borderRadius = '4px'

		const createInput = (key, label, val, maxRes) => {
			const w = document.createElement('div')
			w.style.display = 'flex'
			w.style.flexDirection = 'column'
			w.style.gap = '2px'
			const l = document.createElement('label')
			l.style.fontSize = '0.65rem'
			l.style.color = 'var(--text-muted)'
			l.textContent = label
			const i = document.createElement('input')
			i.type = 'number'
			i.className = 'inspector-field__input'
			i.style.width = '52px'
			i.style.padding = '2px 4px'
			i.min = 0
			i.max = maxRes
			i.value = Math.round(val * maxRes)
			i.addEventListener('change', () => {
				const currentSlices = gbNow()?.slices || []
				const next = [...currentSlices]
				if (next[idx]) {
					next[idx] = { ...next[idx], [key]: Math.max(0, Math.min(maxRes, parseFloat(i.value) || 0)) / maxRes }
					patchGlobalBorder({ slices: next })
				}
			})
			w.appendChild(l)
			w.appendChild(i)
			return w
		}

		row.appendChild(createInput('x', 'X(px)', s.x ?? 0, res.w))
		row.appendChild(createInput('y', 'Y(px)', s.y ?? 0, res.h))
		row.appendChild(createInput('w', 'W(px)', s.w ?? 1, res.w))
		row.appendChild(createInput('h', 'H(px)', s.h ?? 1, res.h))

		const del = document.createElement('button')
		del.type = 'button'
		del.className = 'scenes-btn scenes-btn--sm scenes-btn--danger'
		del.style.marginLeft = 'auto'
		del.style.padding = '2px 6px'
		del.textContent = '×'
		del.title = 'Remove slice'
		del.addEventListener('click', () => {
			const currentSlices = gbNow()?.slices || []
			patchGlobalBorder({ slices: currentSlices.filter((_, i) => i !== idx) })
			renderSliceRows()
		})
		row.appendChild(del)
		slicesBody.insertBefore(row, sliceBtns)
	}

	function renderSliceRows() {
		slicesBody.querySelectorAll('.inspector-slice-row').forEach((el) => el.remove())
		slicesBody.querySelectorAll('.inspector-field--hint').forEach((el) => el.remove())
		const slices = gbNow()?.slices || []
		if (slices.length === 0) {
			const empty = document.createElement('div')
			empty.className = 'inspector-field inspector-field--hint'
			empty.textContent = 'No slices defined. Defaulting to full canvas (0,0 100×100).'
			slicesBody.insertBefore(empty, sliceBtns)
		}
		slices.forEach((s, idx) => appendSliceRow(s, idx))
	}

	renderSliceRows()

	slicesGrp.appendChild(slicesBody)
	root.appendChild(slicesGrp)

	const patchGrp = document.createElement('div')
	patchGrp.className = 'inspector-group'
	patchGrp.innerHTML = '<div class="inspector-group__title">Art-Net</div>'

	const patchBlock = document.createElement('div')
	patchBlock.className = 'inspector-effect-card__params'

	const listenWrap = document.createElement('div')
	listenWrap.className = 'inspector-field'
	const listenLab = document.createElement('label')
	listenLab.className = 'inspector-field__label'
	listenLab.style.display = 'flex'
	listenLab.style.alignItems = 'center'
	listenLab.style.gap = '8px'
	const listenChk = document.createElement('input')
	listenChk.type = 'checkbox'
	listenChk.checked = gb.artnetListenEnabled !== false
	listenChk.addEventListener('change', () => {
		patchGlobalBorder({ artnetListenEnabled: listenChk.checked })
		scheduleGlobalBorderConfigSave()
	})
	const listenTxt = document.createElement('span')
	listenTxt.textContent =
		'Listen for Art-Net on this screen (uncheck to freeze border from DMX; UI controls still work)'
	listenLab.appendChild(listenChk)
	listenLab.appendChild(listenTxt)
	listenWrap.appendChild(listenLab)
	patchBlock.appendChild(listenWrap)

	let patchStartCh = Number(gb.artnetPatch?.startChannel) || 1

	const scWrap = document.createElement('div')
	scWrap.className = 'inspector-field'
	const scLab = document.createElement('label')
	scLab.className = 'inspector-field__label'
	scLab.textContent = 'Start Channel'
	const scInp = document.createElement('input')
	scInp.type = 'number'
	scInp.className = 'inspector-field__input'
	scInp.style.width = '60px'
	scInp.min = 1
	scInp.max = 512
	scInp.value = patchStartCh
	scInp.addEventListener('change', () => {
		const val = parseInt(scInp.value, 10)
		const cur = gbNow()
		if (!cur) return
		patchStartCh = isNaN(val) ? 1 : val
		patchGlobalBorder({
			artnetPatch: { ...cur.artnetPatch, startChannel: patchStartCh },
		})
		scheduleGlobalBorderConfigSave()
		rebuildMappingTable()
	})
	scLab.appendChild(scInp)
	scWrap.appendChild(scLab)
	patchBlock.appendChild(scWrap)

	const uniWrap = document.createElement('div')
	uniWrap.className = 'inspector-field'
	const uniLab = document.createElement('label')
	uniLab.className = 'inspector-field__label'
	uniLab.textContent = 'Universe'
	const uniInp = document.createElement('input')
	uniInp.type = 'number'
	uniInp.className = 'inspector-field__input'
	uniInp.style.width = '60px'
	uniInp.min = 0
	uniInp.max = 16
	uniInp.value = gb.artnetPatch?.universe ?? 0
	uniInp.addEventListener('change', () => {
		const val = parseInt(uniInp.value, 10)
		const cur = gbNow()
		if (!cur) return
		patchGlobalBorder({
			artnetPatch: { ...cur.artnetPatch, universe: isNaN(val) ? 0 : val },
		})
		scheduleGlobalBorderConfigSave()
	})
	uniLab.appendChild(uniInp)
	uniWrap.appendChild(uniLab)
	patchBlock.appendChild(uniWrap)

	const channelMapHint = document.createElement('p')
	channelMapHint.className = 'inspector-field inspector-field--hint'
	channelMapHint.style.marginTop = '8px'
	channelMapHint.textContent =
		'Uncheck a row to keep that parameter under UI control while Art-Net is on (server must honor artnetChannelMap).'
	patchBlock.appendChild(channelMapHint)

	const setChannelMap = (nextMap) => {
		patchGlobalBorder({ artnetChannelMap: nextMap })
		scheduleGlobalBorderConfigSave()
	}

	const table = document.createElement('table')
	table.className = 'inspector-mapping-table'
	table.style.width = '100%'
	table.style.marginTop = '10px'
	table.style.fontSize = '0.8rem'
	table.style.borderCollapse = 'collapse'

	table.addEventListener('change', (e) => {
		if (e.target && e.target.type === 'checkbox' && e.target.dataset.offset != null) {
			const offset = parseInt(e.target.dataset.offset, 10)
			const cur = normalizeArtnetChannelMap(gbNow()?.artnetChannelMap)
			cur[offset] = e.target.checked
			setChannelMap(cur)
		}
	})

	function rebuildMappingTable() {
		const tbody = table.querySelector('tbody')
		if (!tbody) return
		const channelMap = normalizeArtnetChannelMap(gbNow()?.artnetChannelMap)
		tbody.innerHTML = GLOBAL_BORDER_ARTNET_CHANNEL_DEFS.map((def) => {
			const ch = patchStartCh + def.offset
			const checked = channelMap[def.offset] !== false ? 'checked' : ''
			return `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
				<td style="padding: 4px;">${def.label}</td>
				<td style="padding: 4px;">${ch}</td>
				<td style="padding: 4px; text-align: center;">
					<input type="checkbox" data-offset="${def.offset}" ${checked} style="cursor: pointer; vertical-align: middle;" />
				</td>
			</tr>`
		}).join('')
	}

	table.innerHTML = `
		<thead>
			<tr style="text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">
				<th style="padding: 4px;">Parameter</th>
				<th style="padding: 4px;">DMX channel</th>
				<th style="padding: 4px; text-align: center;">Art-Net</th>
			</tr>
		</thead>
		<tbody></tbody>
	`
	rebuildMappingTable()
	patchBlock.appendChild(table)
	
	const dlBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Download fixture file',
	})
	dlBtn.style.display = 'block'
	dlBtn.style.marginTop = '15px'
	dlBtn.addEventListener('click', () => {
		try {
			const blob = new Blob([globalBorderFixtureText], { type: 'text/plain;charset=utf-8' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = 'global-border.txt'
			document.body.appendChild(a)
			a.click()
			a.remove()
			URL.revokeObjectURL(url)
		} catch (e) {
			showScenesToast(`Download failed: ${e?.message || e}`, 'warn')
		}
	})
	patchBlock.appendChild(dlBtn)
	
	patchGrp.appendChild(patchBlock)
	root.appendChild(patchGrp)
}
