/**
 * Screen Destinations UI for Device View (Static Stacked Nodes).
 */
import { destinationRectLabel } from './device-view-ui-utils.js'
import { edgeOutputLayer } from './device-view-destinations-inspector.js'

export function renderDestinations(ctx) {
	const {
		destBody,
		lastPayload,
		highlightDestinationIntent,
		clearChipHighlights,
		selectDestinationById,
		resolveDestinationSinkConnectorId,
		onDestinationPortClick,
		onDecklinkDropToDestinationOutput,
	} = ctx

	destBody.innerHTML = ''

	const transitionModel = String(lastPayload?.live?.caspar?.channelMap?.transitionModel || 'legacy_layer')
	const switcherBusMode = transitionModel === 'switcher_bus'
	/** @type {Map<string, HTMLElement[]>} */
	const chipByKey = new Map()
	/** @type {Map<string, HTMLElement[]>} */
	const destinationByKey = new Map()

	function addChipKey(key, el) {
		if (!chipByKey.has(key)) chipByKey.set(key, [])
		chipByKey.get(key).push(el)
	}
	function addDestinationKey(key, el) {
		if (!destinationByKey.has(key)) destinationByKey.set(key, [])
		destinationByKey.get(key).push(el)
	}

	const localClearHighlights = () => {
		for (const els of chipByKey.values()) {
			for (const el of els) el.classList.remove('device-view__channel-chip--active')
		}
		for (const els of destinationByKey.values()) {
			for (const el of els) el.classList.remove('device-view__destination--active')
		}
		clearChipHighlights()
	}

	const localHighlightIntent = (intent) => {
		localClearHighlights()
		if (!intent) return
		if (intent.mode === 'multiview') {
			for (const el of chipByKey.get('mv') || []) el.classList.add('device-view__channel-chip--active')
			for (const el of destinationByKey.get('mv') || []) el.classList.add('device-view__destination--active')
			highlightDestinationIntent(intent)
			return
		}
		const main = Number.isFinite(intent.mainScreenIndex) ? intent.mainScreenIndex : 0
		const keyPgm = `${main}:pgm`
		for (const el of chipByKey.get(keyPgm) || []) el.classList.add('device-view__channel-chip--active')
		for (const el of destinationByKey.get(keyPgm) || []) el.classList.add('device-view__destination--active')
		if (intent.mode !== 'pgm_only') {
			const keyPrv = `${main}:prv`
			for (const el of chipByKey.get(keyPrv) || []) el.classList.add('device-view__channel-chip--active')
			for (const el of destinationByKey.get(keyPrv) || []) el.classList.add('device-view__destination--active')
		}
		highlightDestinationIntent(intent)
	}

	const parseDecklinkDrop = (ev) => {
		const raw = ev?.dataTransfer?.getData('application/x-highascg-connector') || ''
		if (!raw) return null
		try {
			const p = JSON.parse(raw)
			if (String(p?.kind || '') !== 'decklink_io') return null
			const connectorId = String(p?.connectorId || '').trim()
			return connectorId ? { connectorId } : null
		} catch {
			return null
		}
	}

	const destinationsRaw = Array.isArray(lastPayload?.screenDestinations?.destinations) ? lastPayload.screenDestinations.destinations : []
	const seenDestinationIds = new Set()
	const destinationsList = destinationsRaw.filter((d) => {
		const id = String(d?.id || '').trim()
		if (!id) return false
		if (seenDestinationIds.has(id)) return false
		seenDestinationIds.add(id)
		return true
	})
	const intentItems = Array.isArray(lastPayload?.live?.caspar?.destinationIntent?.items)
		? lastPayload.live.caspar.destinationIntent.items
		: []
	if (!destinationsList.length) {
		const p = document.createElement('p')
		p.className = 'device-view__note'
		p.textContent = 'No destinations yet. Use + and choose PGM/PRV, PGM only, or Multiview.'
		destBody.appendChild(p)
		return
	}

	const container = document.createElement('div')
	container.className = 'device-view__destinations-vertical-stack'

	for (const d of destinationsList) {
		const mode = String(d?.mode || 'pgm_prv')
		const b = document.createElement('div')
		b.className = `device-view__destination device-view__destination--mode-${mode}`
		const main = parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0
		const title = document.createElement('strong')
		title.textContent = String(d?.label || d?.id || 'Destination')
		const subtitle = document.createElement('small')
		subtitle.textContent = destinationRectLabel(d)
		
		const ports = document.createElement('div')
		ports.className = 'device-view__destination-ports'
		const outputDot = document.createElement('span')
		outputDot.className = 'device-view__destination-port device-view__destination-port--output'
		const sinkConnectorId = resolveDestinationSinkConnectorId ? resolveDestinationSinkConnectorId(d) : ''
		if (sinkConnectorId) b.dataset.connectorId = sinkConnectorId
		const graphEdges = Array.isArray(lastPayload?.graph?.edges) ? lastPayload.graph.edges : []
		const graphConnectors = Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []
		const suggestedConnectors = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
		const connectorById = new Map([...graphConnectors, ...suggestedConnectors].map((c) => [String(c?.id || ''), c]))
		const mappedOutputEdges = graphEdges.filter((e) => String(e?.sourceId || '') === String(sinkConnectorId || ''))
		if (sinkConnectorId) outputDot.dataset.connectorId = sinkConnectorId
		outputDot.title = sinkConnectorId ? `Output connector ${sinkConnectorId}` : 'No mapped output connector'
		outputDot.addEventListener('click', (ev) => {
			ev.preventDefault()
			ev.stopPropagation()
			if (onDestinationPortClick) onDestinationPortClick(sinkConnectorId)
		})
		
		const intent = intentItems.find((x) => String(x?.id || '') === String(d?.id || '')) || null
		
		if (mode !== 'stream') {
			outputDot.addEventListener('dragover', (ev) => {
				const parsed = parseDecklinkDrop(ev)
				if (!parsed) return
				ev.preventDefault()
				b.classList.add('device-view__destination--active')
			})
			outputDot.addEventListener('dragleave', () => b.classList.remove('device-view__destination--active'))
			outputDot.addEventListener('drop', (ev) => {
				b.classList.remove('device-view__destination--active')
				const parsed = parseDecklinkDrop(ev)
				if (!parsed) return
				ev.preventDefault()
				if (onDecklinkDropToDestinationOutput) onDecklinkDropToDestinationOutput(parsed.connectorId, d, intent)
			})
			ports.append(outputDot)
		} else {
			ports.append(outputDot)
		}
		
		b.append(title, subtitle, ports)
		
		if (mode === 'pgm_prv') {
			b.classList.add('device-view__destination--pair')
			const basePorts = b.querySelector('.device-view__destination-ports')
			if (basePorts) basePorts.remove()
			const pair = document.createElement('div')
			pair.className = 'device-view__destination-pair'
			pair.innerHTML = '<div class="device-view__destination-pair-half device-view__destination-pair-half--pgm">PGM<span class="device-view__destination-port device-view__destination-port--pair-out" data-pair-node="pgm-out"></span></div><div class="device-view__destination-pair-half device-view__destination-pair-half--prv">PRV<span class="device-view__destination-port device-view__destination-port--pair-out" data-pair-node="prv-out"></span></div>'
			if (switcherBusMode) {
				const prvDot = pair.querySelector('[data-pair-node="prv-out"]')
				if (prvDot) prvDot.remove()
			}
			for (const half of pair.querySelectorAll('.device-view__destination-pair-half')) {
				if (sinkConnectorId) half.dataset.connectorId = sinkConnectorId
			}
			b.appendChild(pair)
			for (const nd of pair.querySelectorAll('[data-pair-node$="-out"]')) {
				if (sinkConnectorId) nd.dataset.connectorId = sinkConnectorId
				nd.addEventListener('click', (ev) => {
					ev.preventDefault()
					ev.stopPropagation()
					if (onDestinationPortClick) onDestinationPortClick(sinkConnectorId)
				})
				nd.title = 'Drop DeckLink connector to assign destination output'
				nd.addEventListener('dragover', (ev) => {
					const parsed = parseDecklinkDrop(ev)
					if (!parsed) return
					ev.preventDefault()
					b.classList.add('device-view__destination--active')
				})
				nd.addEventListener('dragleave', () => b.classList.remove('device-view__destination--active'))
				nd.addEventListener('drop', (ev) => {
					b.classList.remove('device-view__destination--active')
					const parsed = parseDecklinkDrop(ev)
					if (!parsed) return
					ev.preventDefault()
					if (onDecklinkDropToDestinationOutput) onDecklinkDropToDestinationOutput(parsed.connectorId, d, intent)
				})
			}
		}
		
		if (mappedOutputEdges.length) {
			const chips = document.createElement('div')
			chips.className = 'device-view__destination-map-chips'
			for (const edge of mappedOutputEdges) {
				const c = connectorById.get(String(edge?.sinkId || '')) || null
				const chip = document.createElement('span')
				chip.className = 'device-view__channel-chip'
				chip.style.fontSize = '10px'
				chip.style.padding = '1px 6px'
				chip.textContent = `${String(c?.label || edge?.sinkId || 'OUT')} · L${edgeOutputLayer(edge)}`
				chips.appendChild(chip)
			}
			b.appendChild(chips)
		}
		
		const mainFromIntent = Number.isFinite(intent?.mainScreenIndex) ? intent.mainScreenIndex : main
		if (mode !== 'multiview' && mode !== 'stream') {
			addDestinationKey(`${mainFromIntent}:pgm`, b)
			if (mode !== 'pgm_only') addDestinationKey(`${mainFromIntent}:prv`, b)
		} else if (mode === 'multiview') {
			const mvIdx = intent?.mainScreenIndex ?? destinationsList.filter(x => x.mode === 'multiview').indexOf(d)
			addDestinationKey(`mv:${mvIdx}`, b)
		}
		
		b.addEventListener('mouseenter', () => localHighlightIntent(intent))
		b.addEventListener('mouseleave', () => localClearHighlights())
		b.addEventListener('click', (ev) => {
			localHighlightIntent(intent)
			if (typeof selectDestinationById === 'function') {
				selectDestinationById(d.id)
			}
		})

		container.appendChild(b)
	}

	destBody.appendChild(container)
}
