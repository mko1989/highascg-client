/**
 * Edit view rendering for Scenes Editor.
 */
import { defaultTransition as defaultTransitionDef } from '../lib/scene-state.js'
import { mountLookTransitionControls } from './scenes-shared.js'
import { appendLayerPresetBar, appendSceneLayerStripRows } from './scene-layer-row.js'
import { escapeHtml } from './scenes-editor-support.js'

export function renderEdit(ctx) {
	const { mainHost, sceneState, takeSceneToProgram, clearLastPreviewLayers, dispatchLayerSelect, schedulePreviewPush, applyNativeFillForSource, renderCompose, selectedLayerIndexRef, showScenesToast } = ctx
	const id = sceneState.editingSceneId; const scene = id ? sceneState.getScene(id) : null
	if (!scene) { sceneState.setEditingScene(null); return }

	mainHost.innerHTML = ''
	const bar = document.createElement('div'); bar.className = 'scenes-edit-bar'
	bar.innerHTML = `
		<button type="button" class="scenes-btn scenes-btn--icon" id="scenes-back">←</button>
		<input type="text" class="scenes-edit-name" id="scenes-name" value="${escapeHtml(scene.name)}" placeholder="Look name" />
		<button type="button" class="scenes-btn scenes-btn--take scenes-btn--icon" id="scenes-take-live">▶</button>
		<button type="button" class="scenes-btn scenes-btn--sm" id="scenes-take-cut" title="Hard cut" aria-label="Hard cut">CUT</button>
		<button type="button" class="scenes-btn scenes-btn--primary scenes-btn--icon" id="scenes-add-layer">＋</button>
	`
	mainHost.appendChild(bar)

	bar.querySelector('#scenes-take-live').addEventListener('click', () => {
		void takeSceneToProgram(scene.id, false)
	})
	bar.querySelector('#scenes-take-cut').addEventListener('click', () => {
		void takeSceneToProgram(scene.id, true)
	})
	bar.querySelector('#scenes-back').addEventListener('click', () => { sceneState.setEditingScene(null); selectedLayerIndexRef.current = null; dispatchLayerSelect(null); clearLastPreviewLayers() })
	bar.querySelector('#scenes-name').addEventListener('change', e => sceneState.setSceneName(scene.id, e.target.value))
	bar.querySelector('#scenes-add-layer').addEventListener('click', () => sceneState.addLayer(scene.id))

	const body = document.createElement('div'); body.className = 'scenes-edit-body scenes-edit-body--stacked'
	const mainRow = document.createElement('div'); mainRow.className = 'scenes-edit-main'
	const layerStrip = document.createElement('div'); layerStrip.className = 'scenes-layer-strip'
	layerStrip.innerHTML = '<div class="scenes-layer-strip__title">Layers (bottom → top)</div>'

	const renderFn = () => renderEdit(ctx)
	appendSceneLayerStripRows(layerStrip, { scene, dispatchLayerSelect, render: renderFn, showToast: showScenesToast, schedulePreviewPush, selectedLayerIndexRef, sceneState, escapeHtml, applyNativeFillForSource })
	appendLayerPresetBar(layerStrip, { scene, render: renderFn, showToast: showScenesToast, schedulePreviewPush, selectedLayerIndexRef, sceneState })

	mainRow.appendChild(layerStrip); mainRow.appendChild(renderCompose(scene))
	mountLookTransitionControls(body, scene.defaultTransition || defaultTransitionDef(), t => sceneState.setDefaultTransition(scene.id, t), 'scenes-edit-dt', { label: 'Look transition (this look)', hint: 'Applies when layers enter or change.' })
	
	// Global Border Settings (WO-09)
	const borderSection = document.createElement('div')
	borderSection.className = 'scenes-look-border-settings'
	borderSection.style.marginTop = '10px'
	borderSection.style.padding = '10px'
	borderSection.style.background = 'rgba(255,255,255,0.05)'
	borderSection.style.borderRadius = '4px'
	borderSection.innerHTML = `
		<div class="scenes-look-transition__label" style="font-weight: bold; margin-bottom: 5px;">Global Border Effect</div>
		<div style="display: flex; gap: 10px; align-items: center;">
			<label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
				<input type="checkbox" id="global-border-enable" ${scene.globalBorder?.enabled ? 'checked' : ''} />
				Enable
			</label>
			<select id="global-border-type" class="scenes-look-transition__select" style="width: auto; height: 24px; padding: 0 5px;">
				<option value="border" ${scene.globalBorder?.type === 'border' ? 'selected' : ''}>Border</option>
				<option value="glow" ${scene.globalBorder?.type === 'glow' ? 'selected' : ''}>Glow</option>
				<option value="edge_strip" ${scene.globalBorder?.type === 'edge_strip' ? 'selected' : ''}>Edge Strip</option>
				<option value="shadow" ${scene.globalBorder?.type === 'shadow' ? 'selected' : ''}>Shadow</option>
			</select>
			<button type="button" id="global-border-config" class="scenes-btn scenes-btn--sm" style="height: 24px; padding: 0 10px;">⚙️ Configure</button>
		</div>
	`
	body.appendChild(borderSection)

	borderSection.querySelector('#global-border-enable').addEventListener('change', e => {
		sceneState.setGlobalBorder(scene.id, { ...scene.globalBorder, enabled: e.target.checked })
		if (e.target.checked) {
			window.dispatchEvent(new CustomEvent('scene-select', { detail: { sceneId: scene.id } }))
		}
	})
	borderSection.querySelector('#global-border-type').addEventListener('change', e => {
		sceneState.setGlobalBorder(scene.id, { ...scene.globalBorder, type: e.target.value })
	})
	borderSection.querySelector('#global-border-config').addEventListener('click', () => {
		window.dispatchEvent(new CustomEvent('scene-select', { detail: { sceneId: scene.id } }))
	})

	body.appendChild(mainRow); mainHost.appendChild(body)
}
