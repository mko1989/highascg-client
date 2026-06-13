/**
 * GrapesJS integration for HighAsCG CG Overlay Studio (WO-32).
 */

import { buildCasparTemplateHtml } from '../../../lib/cg-studio-caspar-export.js'

/** Editor-only iframe background (not exported in getHtml/getCss). */
const CANVAS_CHECKERBOARD_CSS = `
html, body {
	margin: 0;
	padding: 0;
	width: 100%;
	height: 100%;
	overflow: hidden;
	box-sizing: border-box;
}
*, *::before, *::after { box-sizing: border-box; }
body {
	background-color: #1a1a1a;
	background-image:
		linear-gradient(45deg, #222222 25%, transparent 25%),
		linear-gradient(-45deg, #222222 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #222222 75%),
		linear-gradient(-45deg, transparent 75%, #222222 75%);
	background-size: 20px 20px;
	background-position: 0 0, 0 10px, 10px -10px, -10px 0;
}
`

/** @type {HTMLElement | null} */
let panelsHost = null
/** @type {HTMLElement | null} */
let panelsPark = null

/**
 * @param {HTMLElement} root — `#panel-inspector-scroll`
 * @returns {boolean}
 */
function mountInspectorPanels(root) {
	if (!panelsHost || !root) return false

	let shell = root.querySelector('.cg-studio-inspector-shell')
	if (!shell) {
		root.replaceChildren()
		shell = document.createElement('div')
		shell.className = 'cg-studio-inspector-shell'
		const title = document.createElement('h3')
		title.className = 'inspector-section-title cg-studio-inspector-title'
		title.textContent = 'CG Studio'
		const mount = document.createElement('div')
		mount.className = 'cg-studio-inspector-panels-mount'
		shell.append(title, mount)
		root.appendChild(shell)
	}

	const mount = shell.querySelector('.cg-studio-inspector-panels-mount')
	if (!mount) return false
	if (panelsHost.parentNode !== mount) mount.appendChild(panelsHost)
	panelsHost.classList.remove('cg-studio-panels-host--parked')
	return true
}

function parkInspectorPanels() {
	if (!panelsHost || !panelsPark) return
	panelsHost.classList.add('cg-studio-panels-host--parked')
	panelsPark.appendChild(panelsHost)
}

function isCgStudioWorkspaceTabActive() {
	const t = document.querySelector('.workspace__tabs .tab[data-tab="cg-studio"]')
	return !!(t && t.classList.contains('active'))
}

function tryMountInspectorPanels() {
	if (!isCgStudioWorkspaceTabActive()) return
	const root = document.getElementById('panel-inspector-scroll')
	if (!root) return
	const evt = new CustomEvent('highascg-cg-studio-inspector-mount', {
		detail: { root, handled: false },
	})
	// Allow inspector-panel to participate; editor handles mount directly too.
	window.dispatchEvent(evt)
	if (!evt.detail.handled) mountInspectorPanels(root)
}

/**
 * @param {HTMLElement} container — `#tab-cg-studio`
 */
const GRAPESJS_VENDOR = '/vendor/grapesjs/dist/grapes.mjs'

export async function initEditor(container) {
	const mod = await import(/* @vite-ignore */ GRAPESJS_VENDOR)
	const grapesjs = mod.default || mod

	const header = document.createElement('div')
	header.className = 'cg-studio-toolbar'

	const nameInp = document.createElement('input')
	nameInp.type = 'text'
	nameInp.placeholder = 'Template name (e.g. lowerthird)'
	nameInp.className = 'header-project__name'

	const addTextBtn = mkBtn('+ Text', 'header-btn--secondary')
	const addBoxBtn = mkBtn('+ Box', 'header-btn--secondary')

	const zoomOutBtn = mkBtn('−', 'header-btn--icon')
	const zoomLabel = document.createElement('span')
	zoomLabel.className = 'cg-studio-zoom-label'
	zoomLabel.textContent = '50%'
	const zoomInBtn = mkBtn('+', 'header-btn--icon')
	const zoomFitBtn = mkBtn('Fit', 'header-btn--secondary')

	const saveBtn = mkBtn('Save & deploy')
	const statusSpan = document.createElement('span')
	statusSpan.className = 'cg-studio-status'

	header.append(nameInp, addTextBtn, addBoxBtn, zoomOutBtn, zoomLabel, zoomInBtn, zoomFitBtn, saveBtn, statusSpan)

	const body = document.createElement('div')
	body.className = 'cg-studio-body'

	const canvasWrap = document.createElement('div')
	canvasWrap.className = 'cg-studio-canvas-wrap'

	panelsPark = document.createElement('div')
	panelsPark.className = 'cg-studio-panels-park'
	panelsPark.setAttribute('aria-hidden', 'true')

	panelsHost = document.createElement('div')
	panelsHost.className = 'cg-studio-panels-host cg-studio-panels-host--parked'
	panelsHost.innerHTML = `
		<section class="cg-studio-inspector-section">
			<h4 class="cg-studio-inspector-section__title">Blocks</h4>
			<div class="cg-studio-inspector-blocks"></div>
		</section>
		<section class="cg-studio-inspector-section">
			<h4 class="cg-studio-inspector-section__title">Layers</h4>
			<div class="cg-studio-inspector-layers"></div>
		</section>
		<section class="cg-studio-inspector-section cg-studio-inspector-section--grow">
			<h4 class="cg-studio-inspector-section__title">Style</h4>
			<div class="cg-studio-inspector-styles"></div>
		</section>
	`
	panelsPark.appendChild(panelsHost)

	body.append(canvasWrap)
	container.append(header, body, panelsPark)

	const blocksEl = panelsHost.querySelector('.cg-studio-inspector-blocks')
	const layersEl = panelsHost.querySelector('.cg-studio-inspector-layers')
	const stylesEl = panelsHost.querySelector('.cg-studio-inspector-styles')

	const editor = grapesjs.init({
		container: canvasWrap,
		height: '100%',
		width: 'auto',
		fromElement: false,
		storageManager: false,
		noticeOnUnload: false,
		dragMode: 'absolute', // Enable absolute/freeform drag positioning!
		panels: { defaults: [] },
		blockManager: { appendTo: blocksEl },
		layerManager: { appendTo: layersEl },
		styleManager: { appendTo: stylesEl, clearProperties: true },
		traitManager: { appendTo: stylesEl },
		selectorManager: { appendTo: stylesEl, componentFirst: true },
		deviceManager: {
			devices: [{ id: 'hd', name: '1920×1080', width: '1920px', height: '1080px' }],
		},
		canvas: {
			styles: [],
		},
	})

	let zoomPct = 50
	let dropOffset = 0

	function applyZoom(pct) {
		zoomPct = Math.max(10, Math.min(300, Math.round(pct)))
		editor.Canvas.setZoom(zoomPct)
		zoomLabel.textContent = `${zoomPct}%`
	}

	function fitCanvasZoom() {
		const canvasEl = editor.Canvas.getElement()
		if (!canvasEl) return
		const w = canvasEl.clientWidth
		const h = canvasEl.clientHeight
		if (w < 1 || h < 1) return
		const fit = Math.min((w * 0.92) / 1920, (h * 0.92) / 1080) * 100
		applyZoom(fit)
	}

	function nextDropPosition() {
		dropOffset = (dropOffset + 48) % 280
		return { left: `${80 + dropOffset}px`, top: `${80 + dropOffset}px` }
	}

	function prepareOverlayComponent(component) {
		if (!component || component === editor.getWrapper()) return
		const pos = nextDropPosition()
		component.set({
			draggable: true,
			resizable: true,
			selectable: true,
			removable: true,
			copyable: true,
			badgable: true,
			stylable: true,
			hoverable: true,
			layerable: true,
			dmode: 'absolute', // Set drag mode to absolute per component!
		})
		const style = component.getStyle()
		if (!style.position || style.position === 'static') {
			component.addStyle({
				position: 'absolute',
				left: style.left || pos.left,
				top: style.top || pos.top,
			})
		}
	}

	editor.on('load', () => {
		const doc = editor.Canvas.getDocument()
		if (doc) {
			const style = doc.createElement('style')
			style.setAttribute('data-cg-studio', 'checkerboard')
			style.textContent = CANVAS_CHECKERBOARD_CSS
			doc.head.appendChild(style)

			// Capture wheel events inside GrapesJS's iframe to handle zooming and swipe panning
			doc.addEventListener(
				'wheel',
				(ev) => {
					ev.preventDefault()
					if (ev.ctrlKey || ev.metaKey) {
						// Smooth zoom based on deltaY (0.0005 coefficient ensures comfortable sensitivity)
						const deltaFactor = 1 - ev.deltaY * 0.0005
						const factor = Math.max(0.85, Math.min(1.15, deltaFactor))
						applyZoom(zoomPct * factor)
					} else {
						// Two-finger touchpad swipe panning using native GrapesJS Canvas coords
						const coords = editor.Canvas.getCoords()
						const scale = zoomPct / 100
						editor.Canvas.setCoords(coords.x - ev.deltaX / scale, coords.y - ev.deltaY / scale)
					}
				},
				{ passive: false },
			)
		}

		const wrapper = editor.getWrapper()
		if (wrapper) {
			wrapper.set({
				droppable: true,
				selectable: false,
				hoverable: false,
				badgable: false,
				style: {
					position: 'relative',
					width: '1920px',
					height: '1080px',
					margin: '24px auto',
					'background-color': 'transparent',
				},
			})
		}

		editor.setDevice('hd')
		requestAnimationFrame(() => {
			fitCanvasZoom()
			tryMountInspectorPanels()
		})
	})

	editor.on('component:add', (component) => {
		prepareOverlayComponent(component)
	})

	const bm = editor.BlockManager
	bm.add('text', {
		label: 'Text',
		media: '<span style="font-size:18px">T</span>',
		content: {
			tagName: 'div',
			attributes: { 'data-field': 'headline' },
			style: {
				position: 'absolute',
				left: '80px',
				top: '80px',
				padding: '10px',
				'font-family': 'sans-serif',
				'font-size': '32px',
				color: '#ffffff',
			},
			components: 'Headline',
		},
	})
	bm.add('box', {
		label: 'Box',
		media: '<span style="font-size:18px">▢</span>',
		content: {
			tagName: 'div',
			style: {
				position: 'absolute',
				left: '120px',
				top: '120px',
				width: '200px',
				height: '100px',
				'background-color': '#007bff',
			},
		},
	})

	function addBlockFromManager(blockId) {
		const block = bm.get(blockId)
		if (!block) return
		const added = editor.addComponents(block.get('content'))
		const component = Array.isArray(added) ? added[0] : added
		if (component) {
			prepareOverlayComponent(component)
			editor.select(component)
		}
	}

	addTextBtn.onclick = () => addBlockFromManager('text')
	addBoxBtn.onclick = () => addBlockFromManager('box')
	zoomInBtn.onclick = () => applyZoom(zoomPct * 1.15)
	zoomOutBtn.onclick = () => applyZoom(zoomPct / 1.15)
	zoomFitBtn.onclick = () => fitCanvasZoom()

	canvasWrap.addEventListener(
		'wheel',
		(ev) => {
			ev.preventDefault()
			if (ev.ctrlKey || ev.metaKey) {
				// Smooth zoom based on deltaY (0.0005 coefficient ensures comfortable sensitivity)
				const deltaFactor = 1 - ev.deltaY * 0.0005
				const factor = Math.max(0.85, Math.min(1.15, deltaFactor))
				applyZoom(zoomPct * factor)
			} else {
				// Two-finger touchpad swipe panning using native GrapesJS Canvas coords
				const coords = editor.Canvas.getCoords()
				const scale = zoomPct / 100
				editor.Canvas.setCoords(coords.x - ev.deltaX / scale, coords.y - ev.deltaY / scale)
			}
		},
		{ passive: false },
	)

	saveBtn.onclick = async () => {
		const tplName = nameInp.value.trim().replace(/[^\w.-]+/g, '_')
		if (!tplName) {
			statusSpan.textContent = 'Enter a template name'
			return
		}
		saveBtn.disabled = true
		statusSpan.textContent = 'Saving…'
		try {
			const projectData = editor.getProjectData()
			const html = editor.getHtml()
			const css = editor.getCss()
			const { html: casparHtml, projectJson } = buildCasparTemplateHtml({
				name: tplName,
				html,
				css,
				projectData,
			})

			const res = await fetch('/api/cg-studio/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: tplName,
					html,
					css,
					projectData,
					casparHtml,
					projectJson,
				}),
			})
			if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
			const out = await res.json().catch(() => ({}))
			statusSpan.textContent = out.path ? `Saved → ${out.path}` : `Saved ${tplName}`
			setTimeout(() => {
				statusSpan.textContent = ''
			}, 4000)
		} catch (err) {
			console.error('[cg-studio] save failed:', err)
			statusSpan.textContent = `Error: ${err && err.message ? err.message : err}`
		} finally {
			saveBtn.disabled = false
		}
	}

	window.addEventListener('highascg-cg-studio-inspector-mount', (e) => {
		const root = e.detail?.root
		if (!root) return
		if (mountInspectorPanels(root)) e.detail.handled = true
	})

	window.addEventListener('highascg-workspace-tab-activated', (e) => {
		if (e.detail?.tab === 'cg-studio') {
			tryMountInspectorPanels()
			requestAnimationFrame(() => {
				if (editor) {
					editor.refresh()
					fitCanvasZoom()
				}
			})
		} else {
			parkInspectorPanels()
		}
	})

	injectGrapesThemeOverrides()
	tryMountInspectorPanels()
}

function mkBtn(label, extraClass = '') {
	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = `header-btn${extraClass ? ` ${extraClass}` : ''}`
	btn.textContent = label
	return btn
}

function injectGrapesThemeOverrides() {
	let style = document.getElementById('cg-studio-gjs-theme')
	if (!style) {
		style = document.createElement('style')
		style.id = 'cg-studio-gjs-theme'
	}
	document.head.appendChild(style)
	style.textContent = `
		#tab-cg-studio .gjs-editor,
		#panel-inspector .cg-studio-inspector-shell .gjs-editor {
			height: 100% !important;
			width: 100% !important;
			background: transparent !important;
			border: none !important;
		}
		#tab-cg-studio #gjs-pn-views-container,
		#tab-cg-studio .gjs-pn-views-container,
		#tab-cg-studio #gjs-pn-panels,
		#tab-cg-studio .gjs-pn-panels,
		#tab-cg-studio #gjs-pn-views,
		#tab-cg-studio .gjs-pn-views,
		#tab-cg-studio #gjs-pn-options,
		#tab-cg-studio .gjs-pn-options,
		#tab-cg-studio .gjs-pn-panel {
			display: none !important;
			width: 0 !important;
			height: 0 !important;
			opacity: 0 !important;
			pointer-events: none !important;
		}
		#tab-cg-studio .gjs-editor-contents {
			width: 100% !important;
			height: 100% !important;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			position: absolute !important;
		}
		#tab-cg-studio .gjs-cv-canvas {
			width: 100% !important;
			height: 100% !important;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			margin: 0 !important;
			padding: 0 !important;
			border: none !important;
			background: #141414 !important;
		}
		#tab-cg-studio .gjs-frame-wrapper {
			right: auto !important;
			bottom: auto !important;
			margin: 0 !important;
		}
		#tab-cg-studio .gjs-frame {
			box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px var(--border) !important;
		}
		#tab-cg-studio .gjs-one-bg,
		#panel-inspector .cg-studio-inspector-shell .gjs-one-bg { background-color: var(--bg-panel) !important; }
		#tab-cg-studio .gjs-two-color,
		#panel-inspector .cg-studio-inspector-shell .gjs-two-color { color: var(--text) !important; }
		#tab-cg-studio .gjs-three-bg,
		#panel-inspector .cg-studio-inspector-shell .gjs-three-bg { background-color: var(--bg-dark) !important; }
		#tab-cg-studio .gjs-four-color,
		#tab-cg-studio .gjs-four-color-h:hover,
		#panel-inspector .cg-studio-inspector-shell .gjs-four-color,
		#panel-inspector .cg-studio-inspector-shell .gjs-four-color-h:hover { color: var(--accent) !important; }
		#tab-cg-studio .gjs-sm-sector,
		#panel-inspector .cg-studio-inspector-shell .gjs-sm-sector { border-bottom: 1px solid var(--border) !important; }
		#tab-cg-studio .gjs-sm-title,
		#panel-inspector .cg-studio-inspector-shell .gjs-sm-title { background-color: var(--bg-elevated) !important; color: var(--text) !important; }
		#tab-cg-studio .gjs-field,
		#panel-inspector .cg-studio-inspector-shell .gjs-field { background-color: var(--bg-dark) !important; color: var(--text) !important; border: 1px solid var(--border) !important; }
		#tab-cg-studio .gjs-block,
		#panel-inspector .cg-studio-inspector-shell .gjs-block { background-color: var(--bg-elevated) !important; color: var(--text) !important; border: 1px solid var(--border) !important; }
	`
	document.head.appendChild(style)
}
