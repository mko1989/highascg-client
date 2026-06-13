/**
 * Build selectable GPU output entries from server live.gpu (physicalMap + suggested).
 *
 * Server payload (GET /api/device-view → `live.gpu`), simplified:
 *
 * ```json
 * {
 *   "model": "NVIDIA GeForce ...",
 *   "displays": [
 *     { "name": "DP-3", "connected": true, "resolution": "1920x1080", "refreshHz": 60 }
 *   ],
 *   "physicalMap": {
 *     "topologySource": "drm",
 *     "ports": [
 *       {
 *         "physicalPortId": "gpu_p0",
 *         "slotOrder": 0,
 *         "pair": { "name": "DP-0/DP-1", "dpA": "DP-0", "dpB": "DP-1" },
 *         "runtime": {
 *           "connected": false,
 *           "activePort": "DP-1",
 *           "xrandrName": "card1-DP-1",
 *           "displayName": "card1-DP-1",
 *           "resolution": "",
 *           "refreshHz": null
 *         }
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * Rear panel: **one jack per physical DP socket** when the server probe lists separate
 * connectors (modetest topology). Legacy dual-DP brackets still show one jack per pair.
 * `suggested.connectors` (`kind: "gpu_out"`, ids like `gpu_p0`) align with those ports.
 * Extra `displays[]` rows only add jacks when not already driven by a port's active runtime.
 */
import { normRandrCaspar } from '../components/device-view-caspar-render-helpers.js'
import {
	isGpuLayoutDebugEnabled,
	traceGpuLayoutAdd,
	traceGpuLayoutBuildStart,
	traceGpuLayoutMergeComplete,
	traceGpuLayoutRawComplete,
	traceGpuLayoutSkip,
} from './device-view-gpu-layout-debug.js'

/** @type {number} */
let lastGpuLayoutTraceSeq = 0

/** localStorage override: `highascg_gpu_rear_port_count` = 1..8 */
export const GPU_REAR_PORT_COUNT_OVERRIDE_KEY = 'highascg_gpu_rear_port_count'

/** Same filter as device-view Caspar rear panel for `live.gpu.connectors`. */
export function countUsableGpuConnectorInventory(live) {
	const raw = Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : []
	return raw.filter((inv) => {
		const name = String(inv?.shortName || inv?.name || '').trim().toLowerCase()
		if (!name) return false
		if (/^card\d+($|[\s:])/.test(name) || /^gpu\d+($|[\s:])/.test(name) || /^renderd\d+($|[\s:])/.test(name)) {
			return false
		}
		return true
	}).length
}

function maxGpuPIndex(physicalPorts, suggestedGpuOuts) {
	let max = -1
	const bump = (id) => {
		const m = /^gpu_p(\d+)$/i.exec(String(id || '').trim())
		if (m) max = Math.max(max, parseInt(m[1], 10))
	}
	for (const p of physicalPorts) bump(p?.physicalPortId)
	for (const c of suggestedGpuOuts || []) bump(c?.id)
	return max
}

/**
 * How many rear GPU jacks to show (one per physical socket / gpu_pN).
 * @param {object} [live]
 * @param {object[]} physicalPorts
 * @param {object[]} suggestedGpuOuts
 */
export function resolveExpectedGpuPhysicalPortCount(live, physicalPorts, suggestedGpuOuts) {
	const map = live?.gpu?.physicalMap || {}
	for (const key of ['totalPorts', 'portCount', 'physicalPortCount', 'connectorCount']) {
		const n = Number(map[key])
		if (Number.isFinite(n) && n > 0) return Math.min(8, n)
	}
	const inv = countUsableGpuConnectorInventory(live)
	const fromMaxId = maxGpuPIndex(physicalPorts, suggestedGpuOuts) + 1
	let expected = Math.max(physicalPorts.length, inv, fromMaxId)
	// Quad-output cards: DRM may report 3 dual-DP groups while the backplate has 4 sockets — only infer a 4th
	// when inventory or saved connector ids already imply it (avoid phantom gpu_p3 on 3-port DRM maps).
	if (!hasDrmGpuPhysicalMap(live) && physicalPorts.length === 3 && fromMaxId <= 3 && inv >= 4) {
		expected = Math.max(expected, 4)
	}
	try {
		const override = parseInt(localStorage.getItem(GPU_REAR_PORT_COUNT_OVERRIDE_KEY), 10)
		if (override >= 1 && override <= 8) expected = Math.max(expected, override)
	} catch {
		/* ignore */
	}
	return expected
}

function entryFromInferredPhysicalPort(portIndex, suggestedGpuOuts, displays) {
	const id = `gpu_p${portIndex}`
	const existing = (suggestedGpuOuts || []).find((c) => String(c?.id || '').trim() === id)
	if (existing) return entryFromSuggested(existing, displays, 0, null)
	const dpA = `DP-${portIndex * 2}`
	const dpB = `DP-${portIndex * 2 + 1}`
	return {
		connectorId: id,
		layoutSlotId: id,
		label: `${dpA}/${dpB}`,
		kind: 'gpu_out',
		index: 0,
		connected: false,
		hidden: false,
		pairs: [dpA, dpB],
		monitor: '',
		resolution: '',
		refreshHz: null,
		icon: iconForPortHints(dpA, dpB),
		isVirtual: true,
	}
}

/** @param {object} [live] */
export function hasDrmGpuPhysicalMap(live) {
	const physicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	const topologySource = String(live?.gpu?.physicalMap?.topologySource || '').trim().toLowerCase()
	return (
		physicalPorts.length > 0 &&
		(topologySource === 'drm' ||
			physicalPorts.some((p) => /^gpu_p\d+(_\d+)?$/i.test(String(p?.physicalPortId || ''))))
	)
}

/**
 * Port names for GPU layout editor dropdowns (DP, HDMI, eDP/EDP, active xrandr names).
 * @param {object} [live]
 * @returns {string[]}
 */
export function collectGpuPortNameOptions(live) {
	const names = new Set()
	const add = (v) => {
		const s = String(v || '').trim()
		if (s && !/^none$/i.test(s)) names.add(s)
	}
	const physicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	for (const p of physicalPorts) {
		const pair = p?.pair
		if (pair) {
			add(pair.dpA)
			add(pair.dpB)
			add(pair.name)
		}
		const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
		add(rt.activePort)
		add(rt.xrandrName)
		add(rt.displayName)
	}
	for (const d of Array.isArray(live?.gpu?.displays) ? live.gpu.displays : []) {
		add(d?.name)
	}
	for (let i = 0; i < 8; i++) add(`DP-${i}`)
	for (let i = 0; i < 4; i++) add(`HDMI-${i}`)
	add('EDP-1')
	add('EDP-1-1')

	const rank = (s) => {
		const u = String(s).toUpperCase()
		if (u.startsWith('DP-')) return [0, parseInt(u.slice(3), 10) || 0, u]
		if (u.startsWith('HDMI-')) return [1, parseInt(u.slice(5), 10) || 0, u]
		if (u.includes('EDP')) return [2, 0, u]
		return [3, 0, u]
	}
	return [...names].sort((a, b) => {
		const ra = rank(a)
		const rb = rank(b)
		return ra[0] - rb[0] || ra[1] - rb[1] || String(ra[2]).localeCompare(String(rb[2]))
	})
}

function iconForPortHints(...parts) {
	const s = parts.filter(Boolean).join(' ').toUpperCase()
	if (s.includes('HDMI')) return '/assets/hdmi-port-icon.svg'
	return '/assets/display-port-icon.svg'
}

function labelForPhysicalPort(p) {
	const pairLabel = String(p?.pair?.name || '').trim() || String(p?.physicalPortId || '').trim()
	const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
	const mon = String(rt.xrandrName || rt.displayName || rt.activePort || '').trim()
	if (rt.connected && mon) return `${pairLabel} · ${mon}`
	return pairLabel
}

/** Per-connector jack id, e.g. gpu_p0 + DP-1 → gpu_p0__DP_1 */
export function gpuSplitConnectorId(parentPortId, shortName) {
	const base = String(parentPortId || '').trim()
	const tag = String(shortName || '').trim().replace(/[^A-Za-z0-9]+/g, '_')
	return tag ? `${base}__${tag}` : base
}

/** modetest reports each DP as its own connector — show 4 jacks on a 4-DP card, not 2 pairs. */
function shouldExpandPhysicalPortToConnectors(p, live) {
	const src = String(live?.gpu?.physicalMap?.topologySource || '').trim().toLowerCase()
	if (src !== 'modetest') return false
	const a = String(p?.probe?.connectorA?.shortName || '').trim()
	const b = String(p?.probe?.connectorB?.shortName || '').trim()
	return !!(a && b && normRandrCaspar(a) !== normRandrCaspar(b))
}

function entryFromPhysicalPortSide(p, probeConn, index, suggestedConnector = null) {
	const parentId = String(p.physicalPortId || '').trim()
	const shortName = String(probeConn.shortName || '').trim()
	const id = gpuSplitConnectorId(parentId, shortName)
	const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
	const active = normRandrCaspar(rt.activePort || rt.xrandrName || '')
	const selfNorm = normRandrCaspar(shortName)
	const connected = !!probeConn.connected || (active === selfNorm && !!rt.connected)
	const isActive = active === selfNorm
	let label = shortName
	if (isActive && rt.resolution && rt.resolution !== 'unknown') {
		label = `${shortName} · ${rt.resolution}`
	} else if (isActive && rt.casparMode) {
		label = `${shortName} · ${rt.casparMode}`
	}
	return {
		connectorId: id,
		layoutSlotId: id,
		parentPortId: parentId,
		label,
		kind: 'gpu_out',
		index,
		connected,
		hidden: false,
		pairs: [shortName],
		monitor: isActive ? String(rt.xrandrName || rt.displayName || shortName).trim() : '',
		resolution: isActive ? String(rt.resolution || '').trim() : '',
		refreshHz: isActive && Number.isFinite(Number(rt.refreshHz)) ? Number(rt.refreshHz) : null,
		icon: iconForPortHints(shortName),
		isVirtual: false,
		physicalPort: p,
		suggestedConnectorId: String(suggestedConnector?.id || parentId).trim(),
	}
}

/**
 * One jack per bracket, or one per probe connector when modetest lists separate DPs.
 * @param {object} p
 * @param {object} live
 * @param {object[]} displays
 * @param {number} index
 * @param {object | null} [suggestedConnector]
 */
function entriesFromPhysicalPort(p, live, displays, index, suggestedConnector = null) {
	if (shouldExpandPhysicalPortToConnectors(p, live)) {
		const out = []
		for (const key of ['connectorA', 'connectorB']) {
			const pc = p?.probe?.[key]
			if (pc?.shortName) out.push(entryFromPhysicalPortSide(p, pc, index + out.length, suggestedConnector))
		}
		if (out.length > 0) return out
	}
	if (suggestedConnector) return [entryFromSuggested(suggestedConnector, displays, index, p)]
	return [entryFromPhysicalPort(p, index)]
}

/** One rear jack per physical connector bracket (DP-0/DP-1 share one jack when not expanded). */
function entryFromPhysicalPort(p, index) {
	const id = String(p.physicalPortId || '').trim()
	const rt = p?.runtime && typeof p.runtime === 'object' ? p.runtime : {}
	const pairs = [p?.pair?.dpA, p?.pair?.dpB].filter(Boolean).map(String)
	const connected = !!rt.connected
	return {
		connectorId: id,
		layoutSlotId: id,
		label: labelForPhysicalPort(p),
		kind: 'gpu_out',
		index,
		connected,
		hidden: false,
		pairs,
		monitor: String(rt.xrandrName || rt.displayName || rt.activePort || '').trim(),
		resolution: String(rt.resolution || '').trim(),
		refreshHz: Number.isFinite(Number(rt.refreshHz)) ? Number(rt.refreshHz) : null,
		icon: iconForPortHints(p?.pair?.dpA, p?.pair?.dpB, p?.pair?.name, rt.activePort),
		isVirtual: !connected,
		physicalPort: p,
	}
}

/** RandR output already represented by a port's active runtime (not merely listed in pair.dpA/dpB). */
function entryActivelyBoundToDisplay(entry, name) {
	const n = normRandrCaspar(name)
	if (!n) return false
	if (normRandrCaspar(entry.monitor) === n) return true
	if (Array.isArray(entry.pairs) && entry.pairs.some(p => normRandrCaspar(p) === n)) return true
	const rt = entry.physicalPort?.runtime
	if (!rt) return false
	const active = normRandrCaspar(rt.xrandrName || rt.displayName || rt.activePort || '')
	return active === n
}

function entryFromSuggested(c, displays, index, physicalPort = null) {
	const id = String(c.id || '').trim()
	const ref = String(c.externalRef || c.label || id).trim()
	const disp =
		displays.find((d) => normRandrCaspar(d?.name) === normRandrCaspar(ref)) ||
		displays.find((d) => d?.connected && normRandrCaspar(d.name) === normRandrCaspar(ref))
	if (physicalPort) {
		const merged = entryFromPhysicalPort(physicalPort, index)
		return {
			...merged,
			connectorId: id || merged.connectorId,
			layoutSlotId: id || merged.layoutSlotId,
			label: String(c.label || merged.label || ref || id),
			monitor: disp?.name || merged.monitor || ref,
			connected: merged.connected || !!disp?.connected,
			isVirtual: !(merged.connected || !!disp?.connected),
		}
	}
	const connected = !!disp?.connected
	return {
		connectorId: id,
		layoutSlotId: id,
		label: String(c.label || ref || id),
		kind: 'gpu_out',
		index,
		connected,
		hidden: false,
		pairs: ref ? [ref] : [],
		monitor: disp?.name || ref,
		resolution: String(disp?.resolution || '').trim(),
		refreshHz: Number.isFinite(Number(disp?.refreshHz)) ? Number(disp.refreshHz) : null,
		icon: iconForPortHints(ref, c?.label),
		isVirtual: !connected,
	}
}

function entryFromDisplay(d, suggestedGpuOuts, index) {
	const name = String(d.name || '').trim()
	const match = suggestedGpuOuts.find(
		(c) =>
			c?.kind === 'gpu_out' &&
			normRandrCaspar(c.externalRef || c.label) === normRandrCaspar(name),
	)
	const id = String(match?.id || '').trim() || `gpu_${normRandrCaspar(name).replace(/[^A-Z0-9]+/g, '_')}`
	const connected = !!d.connected
	return {
		connectorId: id,
		layoutSlotId: id,
		label: String(match?.label || name),
		kind: 'gpu_out',
		index,
		connected,
		hidden: false,
		pairs: [name],
		monitor: name,
		resolution: String(d.resolution || '').trim(),
		refreshHz: Number.isFinite(Number(d.refreshHz)) ? Number(d.refreshHz) : null,
		icon: iconForPortHints(name),
		isVirtual: !connected,
	}
}

/**
 * @param {object[]} [suggestedGpuOuts]
 * @param {object[]} [graphGpuOuts]
 */
export function collectGpuConnectorIdsInGraph(suggestedGpuOuts = [], graphGpuOuts = []) {
	const ids = new Set()
	for (const c of [...suggestedGpuOuts, ...graphGpuOuts]) {
		if (!c || (c.kind !== 'gpu_out' && c.kind !== 'gpu_output')) continue
		const id = String(c.id || '').trim()
		if (id) ids.add(id)
	}
	return ids
}

/**
 * One rear-panel jack per physical port, suggested connector, or RandR output (connected or not).
 * @param {object} [live]
 * @param {object[]} [suggestedGpuOuts]
 * @param {object[]} [graphGpuOuts] — persisted device graph gpu_out connectors
 * @returns {object[]}
 */
export function buildRawGpuPortEntriesFromLive(live, suggestedGpuOuts = [], graphGpuOuts = []) {
	const physicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	const displays = Array.isArray(live?.gpu?.displays) ? live.gpu.displays : []
	const entries = []
	const seenIds = new Set()
	const seq = traceGpuLayoutBuildStart(live, suggestedGpuOuts, { physicalPorts, displays })
	lastGpuLayoutTraceSeq = seq

	const push = (entry, phase) => {
		const id = String(entry?.connectorId || '').trim()
		if (!id) {
			traceGpuLayoutSkip(seq, phase, 'empty connectorId', { entry })
			return
		}
		if (seenIds.has(id)) {
			traceGpuLayoutSkip(seq, phase, 'duplicate connectorId', { id, label: entry?.label })
			return
		}
		seenIds.add(id)
		entry.index = entries.length
		entries.push(entry)
		traceGpuLayoutAdd(seq, phase, entry)
	}

	const physicalById = new Map()
	const sortedPhysical = [...physicalPorts].sort(
		(a, b) => (Number(a?.slotOrder) || 0) - (Number(b?.slotOrder) || 0),
	)
	for (const p of sortedPhysical) {
		const pid = String(p?.physicalPortId || '').trim()
		if (pid) physicalById.set(pid, p)
	}

	// Suggested gpu_out ids (gpu_p0…) are canonical; merge DRM bracket data when ids match.
	for (const c of suggestedGpuOuts) {
		if (!c || c.kind !== 'gpu_out') {
			traceGpuLayoutSkip(seq, 'suggested', 'not gpu_out', { kind: c?.kind, id: c?.id })
			continue
		}
		const id = String(c.id || '').trim()
		if (!id) {
			traceGpuLayoutSkip(seq, 'suggested', 'empty id', { c })
			continue
		}
		if (seenIds.has(id)) {
			traceGpuLayoutSkip(seq, 'suggested', 'duplicate id', { id, label: c?.label })
			continue
		}
		const ref = String(c.externalRef || c.label || '').trim()
		if (ref && entries.some((e) => entryActivelyBoundToDisplay(e, ref))) {
			traceGpuLayoutSkip(seq, 'suggested', 'actively bound (ref)', {
				id,
				ref,
				coveredBy: entries
					.filter((e) => entryActivelyBoundToDisplay(e, ref))
					.map((e) => e.connectorId),
			})
			continue
		}
		const physical = physicalById.get(id) || null
		if (physical) physicalById.delete(id)
		for (const entry of physical
			? entriesFromPhysicalPort(physical, live, displays, entries.length, c)
			: [entryFromSuggested(c, displays, entries.length, null)]) {
			push(
				entry,
				physical ? (shouldExpandPhysicalPortToConnectors(physical, live) ? 'physical-split' : 'suggested+physical') : 'suggested',
			)
		}
		if (physical && shouldExpandPhysicalPortToConnectors(physical, live)) {
			seenIds.add(id)
		}
	}

	for (const p of physicalById.values()) {
		for (const entry of entriesFromPhysicalPort(p, live, displays, entries.length)) {
			push(entry, shouldExpandPhysicalPortToConnectors(p, live) ? 'physical-split' : 'physical')
		}
	}

	if (!physicalPorts.length && !suggestedGpuOuts.length && isGpuLayoutDebugEnabled()) {
		traceGpuLayoutSkip(seq, 'physical', 'no physicalMap.ports or suggested gpu_out', {})
	}

	const drmMap = hasDrmGpuPhysicalMap(live)
	if (drmMap && displays.length) {
		traceGpuLayoutSkip(seq, 'display', 'skipped display rows (DRM physical map is canonical)', {
			displayCount: displays.length,
		})
	} else for (const d of displays) {
		const name = String(d?.name || '').trim()
		if (!name) {
			traceGpuLayoutSkip(seq, 'display', 'empty name', { d })
			continue
		}
		const coveredBy = entries.filter((e) => entryActivelyBoundToDisplay(e, name))
		if (coveredBy.length) {
			traceGpuLayoutSkip(seq, 'display', 'actively bound on existing jack', {
				name,
				connected: !!d?.connected,
				coveredBy: coveredBy.map((e) => ({
					id: e.connectorId,
					pairs: e.pairs,
					monitor: e.monitor,
				})),
			})
			continue
		}
		push(entryFromDisplay(d, suggestedGpuOuts, entries.length), 'display')
	}

	// Only infer gpu_pN jacks explicitly listed in suggested connectors — never pad gpu_p3/gpu_p4 from heuristics.
	for (const c of suggestedGpuOuts || []) {
		if (!c || c.kind !== 'gpu_out') continue
		const id = String(c.id || '').trim()
		if (!id || seenIds.has(id)) continue
		if (entries.some((e) => String(e.parentPortId || '') === id)) {
			traceGpuLayoutSkip(seq, 'inferred-suggested', 'per-DP jacks already shown for bracket', { id })
			continue
		}
		const m = /^gpu_p(\d+)$/i.exec(id)
		if (!m) continue
		push(
			entryFromInferredPhysicalPort(parseInt(m[1], 10), suggestedGpuOuts, displays),
			'inferred-suggested',
		)
	}

	if (!drmMap && !suggestedGpuOuts.length && !physicalPorts.length) {
		const expectedPorts = resolveExpectedGpuPhysicalPortCount(live, physicalPorts, suggestedGpuOuts)
		for (let i = 0; i < expectedPorts; i++) {
			const id = `gpu_p${i}`
			if (seenIds.has(id)) continue
			push(entryFromInferredPhysicalPort(i, suggestedGpuOuts, displays), 'inferred-port')
		}
	}

	const graphIds = collectGpuConnectorIdsInGraph(suggestedGpuOuts, graphGpuOuts)
	const suggestedIds = collectGpuConnectorIdsInGraph(suggestedGpuOuts, [])
	const physicalIds = new Set(
		physicalPorts.map((p) => String(p?.physicalPortId || '').trim()).filter(Boolean),
	)
	const tagged = entries
		.filter((entry) => {
			const id = String(entry?.connectorId || '').trim()
			if (/^gpu_p\d+(__[A-Za-z0-9_]+)?$/i.test(id)) return true
			if (drmMap) {
				traceGpuLayoutSkip(seq, 'filter', 'non-canonical gpu id omitted (DRM rear panel uses gpu_pN only)', {
					id,
					label: entry?.label,
				})
				return false
			}
			return true
		})
		.map((entry) => {
			const id = String(entry.connectorId || '').trim()
			const parentPortId =
				entry.parentPortId || (id.match(/^(gpu_p\d+)__/i) || [])[1] || null
			return {
				...entry,
				inDeviceGraph:
					graphIds.has(id) ||
					suggestedIds.has(id) ||
					physicalIds.has(id) ||
					(parentPortId != null &&
						(suggestedIds.has(parentPortId) || graphIds.has(parentPortId))),
			}
		})
	traceGpuLayoutRawComplete(seq, tagged)
	return tagged
}

export const GPU_CUSTOM_LAYOUT_KEY = 'gpu_custom_layout'

/** Remove saved rear-panel order/hidden/port mapping from localStorage. */
export function clearGpuLayoutPrefs() {
	try {
		localStorage.removeItem(GPU_CUSTOM_LAYOUT_KEY)
	} catch {
		/* ignore */
	}
}

/**
 * Layout-editor rows from current live GPU data (no saved prefs).
 * @param {object} [live]
 * @param {object[]} [suggestedGpuOuts]
 */
export function buildGpuLayoutItemsFromLive(live, suggestedGpuOuts = []) {
	return layoutItemsFromGpuEntries(
		buildGpuSelectablePortEntries({
			live,
			suggestedGpuOuts,
			layoutPrefs: { byId: new Map(), orderIds: [] },
			hideDisconnectedByDefault: false,
		}),
	)
}

/** @returns {{ byId: Map<string, object>, orderIds: string[] }} */
export function readGpuLayoutPrefs() {
	try {
		const raw = localStorage.getItem(GPU_CUSTOM_LAYOUT_KEY)
		const arr = raw ? JSON.parse(raw) : null
		if (!Array.isArray(arr)) return { byId: new Map(), orderIds: [] }
		const byId = new Map()
		const orderIds = []
		for (const item of arr) {
			const id = String(item?.id || '').trim()
			if (!id || !/^gpu_p\d+(__[A-Za-z0-9_]+)?$/i.test(id)) continue
			byId.set(id, item)
			orderIds.push(id)
		}
		return { byId, orderIds }
	} catch {
		return { byId: new Map(), orderIds: [] }
	}
}

/**
 * Apply saved order/hidden/labels from localStorage onto port entries.
 * @param {object[]} entries
 * @param {{ byId?: Map<string, object>, orderIds?: string[] }} [prefs]
 * @param {{ defaultHideDisconnected?: boolean }} [opts]
 */
export function mergeGpuLayoutEntriesWithPrefs(entries, prefs, { defaultHideDisconnected = false } = {}) {
	const liveIds = new Set(entries.map((e) => String(e.connectorId || e.layoutSlotId || '').trim()).filter(Boolean))
	const byIdRaw = prefs?.byId || new Map()
	const byId = new Map()
	for (const [id, saved] of byIdRaw.entries()) {
		if (liveIds.has(String(id).trim())) byId.set(id, saved)
	}
	const orderIds = (prefs?.orderIds || []).filter((id) => liveIds.has(String(id).trim()))
	const decisions = []
	const merged = entries.map((entry) => {
		const id = String(entry.connectorId || entry.layoutSlotId || '').trim()
		const saved = byId.get(id)
		let hiddenReason = 'visible (default)'
		let hidden
		if (saved != null) {
			hidden = !!saved.hidden
			hiddenReason = hidden ? 'localStorage hidden=true' : 'localStorage hidden=false'
		} else if (defaultHideDisconnected) {
			hidden = !entry.connected
			hiddenReason = hidden ? 'defaultHideDisconnected (disconnected)' : 'defaultHideDisconnected (connected)'
		} else {
			hidden = !!entry.hidden
			hiddenReason = hidden ? 'entry.hidden' : 'visible (default)'
		}
		decisions.push({
			id,
			hidden,
			hiddenReason,
			inSavedPrefs: saved != null,
			savedHidden: saved != null ? !!saved.hidden : null,
			connected: !!entry.connected,
			label: entry.label,
			orphanSavedPref: false,
		})
		return {
			...entry,
			hidden,
			label: saved?.label ? String(saved.label) : entry.label,
			pairs:
				Array.isArray(saved?.pairs) && saved.pairs.length ? [...saved.pairs] : entry.pairs,
		}
	})
	for (const savedId of byIdRaw.keys()) {
		if (!liveIds.has(String(savedId).trim())) {
			decisions.push({
				id: savedId,
				hidden: !!byIdRaw.get(savedId)?.hidden,
				hiddenReason: 'orphan saved pref (pruned — not in live rear panel list)',
				inSavedPrefs: true,
				savedHidden: !!byIdRaw.get(savedId)?.hidden,
				connected: null,
				label: byIdRaw.get(savedId)?.label,
				orphanSavedPref: true,
			})
		}
	}
	traceGpuLayoutMergeComplete(lastGpuLayoutTraceSeq, merged, decisions)
	if (!orderIds.length) return merged
	const rank = (id) => {
		const i = orderIds.indexOf(id)
		return i >= 0 ? i : 9000 + merged.findIndex((e) => e.connectorId === id)
	}
	return [...merged].sort((a, b) => rank(a.connectorId) - rank(b.connectorId))
}

/** Layout-editor / localStorage row shape from port entries. */
export function layoutItemsFromGpuEntries(entries) {
	return entries.map((e) => {
		const pairs = [...(e.pairs || [])]
		if (!pairs.length && e.monitor) pairs.push(e.monitor)
		const blob = [...pairs, e.monitor].join(' ').toUpperCase()
		return {
			id: e.connectorId,
			label: e.label,
			pairs,
			type: blob.includes('HDMI') ? 'hdmi' : blob.includes('EDP') ? 'edp' : 'dp',
			hidden: !!e.hidden,
		}
	})
}

/**
 * Build GPU rear-panel entries from live server data (physical map + suggested + all RandR outputs).
 * @param {{ live: object, suggestedGpuOuts?: object[], layoutPrefs?: { byId: Map, orderIds: string[] }, hideDisconnectedByDefault?: boolean }} opts
 * @returns {Array<object>}
 */
export function buildGpuSelectablePortEntries({
	live,
	suggestedGpuOuts = [],
	graphGpuOuts = [],
	layoutPrefs = null,
	hideDisconnectedByDefault = null,
}) {
	const raw = buildRawGpuPortEntriesFromLive(live, suggestedGpuOuts, graphGpuOuts)
	const prefs = layoutPrefs ?? readGpuLayoutPrefs()
	const hideDefault =
		hideDisconnectedByDefault !== null ? hideDisconnectedByDefault : false
	return mergeGpuLayoutEntriesWithPrefs(raw, prefs, {
		defaultHideDisconnected: hideDefault,
	})
}

/**
 * @param {ReturnType<typeof buildGpuSelectablePortEntries>[number]} entry
 * @param {object[]} connectedDisplays
 */
/**
 * gpu_out rows in the device graph that are not canonical rear-panel jacks (gpu_pN).
 * @param {object[]} graphGpuOuts
 * @param {object[]} rearEntries
 */
export function listStaleGpuGraphConnectors(graphGpuOuts = [], rearEntries = []) {
	const rearIds = new Set(
		rearEntries.map((e) => String(e?.connectorId || e?.id || '').trim()).filter(Boolean),
	)
	return (graphGpuOuts || []).filter((c) => {
		if (!c || (c.kind !== 'gpu_out' && c.kind !== 'gpu_output')) return false
		const id = String(c.id || '').trim()
		return id && !rearIds.has(id)
	})
}

export function entryToRearPanelGpuItem(entry, connectedDisplays = []) {
	const pairs = Array.isArray(entry.pairs) ? entry.pairs : []
	const connected =
		entry.connected ||
		pairs.some((pName) =>
			connectedDisplays.some((d) => d?.connected && normRandrCaspar(d.name) === normRandrCaspar(pName)),
		)
	const inDeviceGraph = entry.inDeviceGraph === true
	return {
		id: entry.connectorId,
		layoutSlotId: entry.layoutSlotId || entry.connectorId,
		icon: entry.icon,
		label: entry.label,
		kind: 'gpu_out',
		index: entry.index,
		connected,
		hidden: entry.hidden,
		pairs,
		monitor: entry.monitor || '',
		resolution: entry.resolution || '',
		refreshHz: entry.refreshHz,
		inDeviceGraph,
		// Unmapped = jack exists on the card but has no gpu_pN row in the device graph (not merely unplugged).
		isVirtual: !inDeviceGraph,
	}
}
