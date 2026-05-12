import { sceneState } from '../lib/scene-state.js'
import { fillToPixelRect, pixelRectToFill, fullFill } from '../lib/fill-math.js'
import { multiviewState } from '../lib/multiview-state.js'
import { getContentResolution } from '../lib/mixer-fill.js'
import { appendSceneLayerFillGroup, appendMultiviewPositionSize } from './inspector-fill.js'
import { appendSceneLayerMixerGroup } from './inspector-mixer.js'
import { renderEffectsGroup } from './inspector-effects.js'
import { renderPipOverlayGroup, renderParamEditor } from './inspector-pip-overlay.js'
import { appendSceneLayerHtmlTemplateGroup } from './inspector-html-template.js'
import { getPipOverlaysFromLayer, PIP_OVERLAY_MAP } from '../lib/pip-overlay-registry.js'
import { showScenesToast } from './scenes-editor-support.js'

let activeInteractionAr = null
let activeInteractionTimer = null

/**
 * @param {object} stateStore
 */
export function getResolutionForScreen(stateStore) {
	const state = stateStore.getState()
	const idx = sceneState.activeScreenIndex ?? 0
	const pr = state?.channelMap?.programResolutions?.[idx]
	return pr && pr.w > 0 && pr.h > 0 ? pr : { w: 1920, h: 1080 }
}

/**
 * @param {{
 *   root: HTMLElement,
 *   stateStore: object,
 *   renderEmpty: () => void,
 *   rerenderSceneLayer: (sel: object) => void,
 * }} deps
 */
export function renderSceneLayerInspector(deps, sel) {
	const { root, stateStore, renderEmpty, rerenderSceneLayer } = deps
	const { sceneId, layerIndex } = sel
	const scene = sceneState.getScene(sceneId)
	const layer = scene?.layers?.[layerIndex]
	if (!layer) {
		renderEmpty()
		return
	}
	const res = getResolutionForScreen(stateStore)
	const canvas = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
	const fill = layer.fill || fullFill()
	const pxRect = fillToPixelRect(fill, canvas)

	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Layer ${layer.layerNumber} (look)`
	root.appendChild(title)

	const canPasteInsp = sceneState.hasLayerStyleClipboard()
	const styleGrp = document.createElement('div')
	styleGrp.className = 'inspector-group inspector-layer-style'
	const styleTitle = document.createElement('div')
	styleTitle.className = 'inspector-group__title'
	styleTitle.textContent = 'Layer style (clipboard)'
	styleGrp.appendChild(styleTitle)
	const clipRow = document.createElement('div')
	clipRow.className = 'inspector-layer-style__row'
	clipRow.innerHTML = `
		<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-insp-ls-copy title="Copy position, scale, opacity, keyer, transition" aria-label="Copy layer settings">⎘</button>
		<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-insp-ls-paste title="Paste copied settings" aria-label="Paste layer settings" ${canPasteInsp ? '' : 'disabled'}>📋</button>
		<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-insp-ls-save title="Save as layer style preset" aria-label="Save as layer style preset">💾</button>
	`
	clipRow.querySelector('[data-insp-ls-copy]')?.addEventListener('click', () => {
		if (sceneState.copyLayerStyle(sceneId, layerIndex)) {
			showScenesToast('Layer settings copied (not source).', 'info')
			const p = clipRow.querySelector('[data-insp-ls-paste]')
			if (p) p.disabled = false
		}
	})
	clipRow.querySelector('[data-insp-ls-paste]')?.addEventListener('click', () => {
		if (sceneState.pasteLayerStyle(sceneId, layerIndex)) {
			showScenesToast('Settings pasted.', 'info')
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			rerenderSceneLayer(sel)
		}
	})
	clipRow.querySelector('[data-insp-ls-save]')?.addEventListener('click', () => {
		const name = window.prompt('Layer style preset name?')
		if (name == null) return
		if (sceneState.saveLayerPresetFromLayer(sceneId, layerIndex, name)) {
			showScenesToast('Layer preset saved.', 'info')
			rerenderSceneLayer(sel)
		} else {
			showScenesToast('Could not save preset (empty name).', 'warn')
		}
	})
	styleGrp.appendChild(clipRow)
	const lpHint = document.createElement('p')
	lpHint.className = 'inspector-field inspector-field--hint inspector-layer-style__preset-hint'
	lpHint.textContent = 'Named preset library: use the Layer presets tab (header) or the look editor layer strip.'
	styleGrp.appendChild(lpHint)
	root.appendChild(styleGrp)

	function patchFillPx(partial) {
		const sc = sceneState.getScene(sceneId)
		const L = sc?.layers?.[layerIndex]
		if (!L) return
		const f = L.fill || fullFill()
		const r = fillToPixelRect(f, canvas)
		let next = { x: r.x, y: r.y, w: r.w, h: r.h, ...partial }
		if (L.aspectLocked !== false) {
			const cr = L.source ? getContentResolution(L.source, stateStore, sceneState.activeScreenIndex) : null
			let ar = cr && cr.w > 0 && cr.h > 0 ? cr.w / cr.h : null
			
			if (!ar) {
				if (activeInteractionAr) {
					ar = activeInteractionAr
				} else {
					ar = r.w > 0 && r.h > 0 ? r.w / r.h : 16 / 9
					activeInteractionAr = ar
				}
				if (activeInteractionTimer) clearTimeout(activeInteractionTimer)
				activeInteractionTimer = setTimeout(() => {
					activeInteractionAr = null
					activeInteractionTimer = null
				}, 500)
			}
			
			if (partial.w != null && partial.h == null) {
				next.h = Math.max(1, Math.round(next.w / ar))
			} else if (partial.h != null && partial.w == null) {
				next.w = Math.max(1, Math.round(next.h * ar))
			}
		}
		sceneState.patchLayer(sceneId, layerIndex, { fill: pixelRectToFill(next, canvas) })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	}

	/**
	 * @param {'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'center'} mode
	 */
	function patchFillAlign(mode) {
		const sc = sceneState.getScene(sceneId)
		const L = sc?.layers?.[layerIndex]
		if (!L) return
		const f = L.fill || fullFill()
		const sx = f.scaleX ?? 0
		const sy = f.scaleY ?? 0
		let nx = f.x ?? 0
		let ny = f.y ?? 0
		if (mode === 'left') nx = 0
		else if (mode === 'right') nx = 1 - sx
		else if (mode === 'top') ny = 0
		else if (mode === 'bottom') ny = 1 - sy
		else if (mode === 'center-h') nx = (1 - sx) / 2
		else if (mode === 'center-v') ny = (1 - sy) / 2
		else if (mode === 'center') {
			nx = (1 - sx) / 2
			ny = (1 - sy) / 2
		}
		sceneState.patchLayer(sceneId, layerIndex, { fill: { ...f, x: nx, y: ny } })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	}

	appendSceneLayerFillGroup(root, {
		res,
		pxRect,
		patchFillPx,
		patchFillAlign,
		layer,
		sceneId,
		layerIndex,
		sceneState,
		stateStore,
	})
	appendSceneLayerMixerGroup(root, { sceneId, layerIndex, layer })

	appendSceneLayerHtmlTemplateGroup(root, { sceneState, stateStore, sceneId, layer })

	renderEffectsGroup(root, {
		effects: layer.effects || [],
		onUpdate: (newEffects) => {
			sceneState.patchLayer(sceneId, layerIndex, { effects: newEffects })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			rerenderSceneLayer(sel)
		},
	})

	renderPipOverlayGroup(root, {
		pipOverlays: getPipOverlaysFromLayer(layer),
		livePushContext: { sceneState, stateStore, sceneId, layerIndex },
		onUpdate: (next) => {
			sceneState.patchLayer(sceneId, layerIndex, { pipOverlays: next })
			document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
			// Do not rerenderSceneLayer here: <input type="color"> would unmount on every input and close the native picker.
		},
	})

	const takeGrp = document.createElement('div')
	takeGrp.className = 'inspector-group'
	takeGrp.innerHTML = '<div class="inspector-group__title">Look take (playback)</div>'
	const startWrap = document.createElement('div')
	startWrap.className = 'inspector-field'
	const startLab = document.createElement('label')
	startLab.className = 'inspector-field__label'
	startLab.textContent = 'Start behaviour override'
	const startSel = document.createElement('select')
	startSel.className = 'inspector-field__select'
	startSel.setAttribute('aria-label', 'Override timeline clip start behaviour for this layer')
	startSel.innerHTML =
		'<option value="inherit">Same as timeline clip</option>' +
		'<option value="beginning">Start from beginning (trim)</option>' +
		'<option value="relativeToPrevious">Relative to timeline (layer)</option>'
	const rawSb = layer.startBehaviour
	startSel.value =
		rawSb === 'relativeToPrevious'
			? 'relativeToPrevious'
			: rawSb === 'beginning'
				? 'beginning'
				: 'inherit'
	startSel.addEventListener('change', () => {
		const v = startSel.value
		sceneState.patchLayer(sceneId, layerIndex, {
			startBehaviour: v === 'inherit' ? null : v === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning',
		})
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
	})
	startLab.appendChild(startSel)
	startWrap.appendChild(startLab)
	const startHint = document.createElement('p')
	startHint.className = 'inspector-field inspector-field--hint'
	startHint.style.fontSize = '0.78rem'
	startHint.style.color = 'var(--text-muted)'
	startHint.textContent =
		'Optional: override the timeline clip’s setting for this layer index when taking the look. “Same as timeline” uses the clip inspector value.'
	startWrap.appendChild(startHint)
	takeGrp.appendChild(startWrap)
	root.appendChild(takeGrp)
}

/**
 * @param {{
 *   root: HTMLElement,
 *   renderEmpty: () => void,
 * }} deps
 */
export function renderMultiviewInspector(deps, cellId) {
	const { root, renderEmpty } = deps
	const cell = multiviewState.getCell(cellId)
	if (!cell) { renderEmpty(); return }
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = cell.label || cell.id
	root.appendChild(title)
	appendMultiviewPositionSize(root, { cellId, cell })
}

export function renderSceneInspector(root, sceneId) {
	const scene = sceneState.getScene(sceneId)
	if (!scene) {
		root.innerHTML = '<p class="inspector-empty">Select a scene</p>'
		return
	}
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Look: ${scene.name}`
	root.appendChild(title)

	const gb = scene.globalBorder || { enabled: false, type: 'border', params: {}, artnetPatch: {} }

	// Global Border Settings Group
	const borderGrp = document.createElement('div')
	borderGrp.className = 'inspector-group'
	borderGrp.innerHTML = '<div class="inspector-group__title">Global Border Effect</div>'
	
	const def = PIP_OVERLAY_MAP.get(gb.type)
	if (def) {
		const paramsBlock = document.createElement('div')
		paramsBlock.className = 'inspector-effect-card__params'
		for (const schema of def.schema) {
			// Skip 'side' as it's hardcoded to inside
			if (schema.key === 'side') continue
			
			const curVal = gb.params?.[schema.key] ?? schema.default
			renderParamEditor(paramsBlock, schema, curVal, (newVal) => {
				sceneState.setGlobalBorder(sceneId, {
					...gb,
					params: { ...gb.params, [schema.key]: newVal, side: 'inside' } // enforce inside
				})
			})
		}
		borderGrp.appendChild(paramsBlock)
	}
	root.appendChild(borderGrp)

	// Art-Net Patch Group
	const patchGrp = document.createElement('div')
	patchGrp.className = 'inspector-group'
	patchGrp.innerHTML = '<div class="inspector-group__title">Art-Net Patch</div>'
	
	const patchBlock = document.createElement('div')
	patchBlock.className = 'inspector-effect-card__params'
	
	// Start Channel
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
	scInp.value = gb.artnetPatch?.startChannel || 1
	scInp.addEventListener('change', () => {
		const val = parseInt(scInp.value, 10)
		sceneState.setGlobalBorder(sceneId, {
			...gb,
			artnetPatch: { ...gb.artnetPatch, startChannel: isNaN(val) ? 1 : val }
		})
		renderSceneInspector(root, sceneId) // rerender to update table
	})
	scLab.appendChild(scInp)
	scWrap.appendChild(scLab)
	patchBlock.appendChild(scWrap)

	// Universe
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
	uniInp.value = gb.artnetPatch?.universe || 0
	uniInp.addEventListener('change', () => {
		const val = parseInt(uniInp.value, 10)
		sceneState.setGlobalBorder(sceneId, {
			...gb,
			artnetPatch: { ...gb.artnetPatch, universe: isNaN(val) ? 0 : val }
		})
	})
	uniLab.appendChild(uniInp)
	uniWrap.appendChild(uniLab)
	patchBlock.appendChild(uniWrap)

	// Read-only mapping table
	const start = gb.artnetPatch?.startChannel || 1
	const mapping = [
		{ label: 'On/Off', ch: start },
		{ label: 'Effect Type', ch: start + 1 },
		{ label: 'Opacity', ch: start + 2 },
		{ label: 'Color (RGB)', ch: `${start + 3} - ${start + 5}` },
		{ label: 'Width / Thickness', ch: start + 6 },
		{ label: 'Speed', ch: start + 7 },
		{ label: 'Spread / Blur', ch: start + 8 },
		{ label: 'Glow Color (RGB)', ch: `${start + 9} - ${start + 11}` },
		{ label: 'Radius', ch: start + 12 },
		{ label: 'Count', ch: start + 13 },
		{ label: 'Length', ch: start + 14 }
	]

	const table = document.createElement('table')
	table.className = 'inspector-mapping-table'
	table.style.width = '100%'
	table.style.marginTop = '10px'
	table.style.fontSize = '0.8rem'
	table.style.borderCollapse = 'collapse'
	
	table.innerHTML = `
		<thead>
			<tr style="text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">
				<th style="padding: 4px;">Parameter</th>
				<th style="padding: 4px;">Channel</th>
			</tr>
		</thead>
		<tbody>
			${mapping.map(m => `
				<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
					<td style="padding: 4px;">${m.label}</td>
					<td style="padding: 4px;">${m.ch}</td>
				</tr>
			`).join('')}
		</tbody>
	`
	patchBlock.appendChild(table)
	
	const dlLink = document.createElement('a')
	dlLink.href = '/fixtures/global-border.txt'
	dlLink.download = 'global-border.txt'
	dlLink.textContent = 'Download Fixture File'
	dlLink.style.display = 'block'
	dlLink.style.marginTop = '15px'
	dlLink.style.color = '#38bdf8'
	dlLink.style.textDecoration = 'none'
	dlLink.style.fontSize = '0.85rem'
	dlLink.style.fontWeight = 'bold'
	patchBlock.appendChild(dlLink)
	
	patchGrp.appendChild(patchBlock)
	root.appendChild(patchGrp)
}
