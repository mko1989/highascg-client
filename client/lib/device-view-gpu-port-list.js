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

function entryFromInferredPhysicalPort(portIndex, suggestedGpuOuts, displays, topology = null) {
	const id = `gpu_p${portIndex}`
	const existing = (suggestedGpuOuts || []).find((c) => String(c?.id || '').trim() === id)
	if (existing) return entryFromSuggested(existing, displays, 0, null)
	const topoRow = (topology || defaultClientGpuTopology()).find(
		(t) => String(t?.physicalPortId || '').trim() === id,
	)
	const pairs = topoRow
		? [topoRow.dpA, topoRow.dpB].filter(Boolean).map(String)
		: [`DP-${portIndex * 2}`, `DP-${portIndex * 2 + 1}`]
	return entryFromTopologyRow(
		{ physicalPortId: id, dpA: pairs[0] || '', dpB: pairs[1] || '', slotOrder: portIndex },
		displays,
		suggestedGpuOuts,
		0,
	)
}

/** RTX 20/30 quad + HDMI: four physical sockets on the backplate. */
export const RTX_20_30_SOCKET_COUNT = 4

/** RTX 20/30 backplate order: DP 0/1, HDMI, DP 2/3, DP 4/5. */
export function defaultClientGpuTopology() {
	return [
		{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-0', dpB: 'DP-1', connectorNumber: 0, location: 0 },
		{ physicalPortId: 'gpu_p1', slotOrder: 1, dpA: 'HDMI-0', dpB: 'HDMI-1', connectorNumber: 1, location: 1 },
		{ physicalPortId: 'gpu_p2', slotOrder: 2, dpA: 'DP-2', dpB: 'DP-3', connectorNumber: 2, location: 2 },
		{ physicalPortId: 'gpu_p3', slotOrder: 3, dpA: 'DP-4', dpB: 'DP-5', connectorNumber: 3, location: 3 },
	]
}

/** Fill gpu_p0..p3 when saved layout only has 3 rows (stale prefs). */
function mergeTopologyWithDefaultSockets(rows) {
	const defaults = defaultClientGpuTopology()
	const byId = new Map((rows || []).map((r) => [String(r?.physicalPortId || '').trim(), r]))
	const merged = defaults.map((def, idx) => {
		const cur = byId.get(def.physicalPortId)
		if (!cur) return { ...def }
		return {
			...def,
			...cur,
			physicalPortId: def.physicalPortId,
			dpA: String(cur.dpA || def.dpA || '').trim(),
			dpB: String(cur.dpB || def.dpB || '').trim(),
			slotOrder: idx,
			connectorNumber: idx,
			location: idx,
		}
	})
	for (const row of rows || []) {
		const id = String(row?.physicalPortId || '').trim()
		if (!id || defaults.some((d) => d.physicalPortId === id)) continue
		merged.push(row)
	}
	return merged.map((row, idx) => ({
		...row,
		slotOrder: idx,
		connectorNumber: idx,
		location: idx,
	}))
}

function topologyRowsFromLayoutPrefs(prefs) {
	const order =
		(prefs?.orderIds || []).length > 0
			? prefs.orderIds
			: [...(prefs?.byId || new Map()).keys()]
	if (!order.length || !prefs?.byId?.size) return []
	const rows = []
	for (const rawId of order) {
		const item = prefs.byId.get(rawId)
		if (!item) continue
		const physicalPortId = String(item.id || rawId).replace(/__.*$/i, '')
		if (!/^gpu_p\d+$/i.test(physicalPortId)) continue
		const pairs = Array.isArray(item.pairs) ? item.pairs.filter(Boolean) : []
		rows.push({
			physicalPortId,
			slotOrder: rows.length,
			dpA: String(pairs[0] || '').trim(),
			dpB: String(pairs[1] || '').trim(),
			connectorNumber: rows.length,
			location: rows.length,
		})
	}
	return rows
}

/**
 * Saved settings topology + localStorage layout; layout wins, else settings, else client default.
 * Always includes all four RTX 20/30 sockets (gpu_p0..gpu_p3).
 * @param {object[] | null | undefined} savedTopology
 * @param {{ byId?: Map<string, object>, orderIds?: string[] }} [layoutPrefs]
 */
export function resolveEffectiveGpuTopology(savedTopology, layoutPrefs = null) {
	const prefs = layoutPrefs || readGpuLayoutPrefs()
	const fromPrefs = topologyRowsFromLayoutPrefs(prefs)
	if (fromPrefs.length) return mergeTopologyWithDefaultSockets(fromPrefs)
	if (Array.isArray(savedTopology) && savedTopology.length) {
		return mergeTopologyWithDefaultSockets(savedTopology)
	}
	return defaultClientGpuTopology()
}

function connectedLiveRandrNames(live) {
	const out = new Set()
	for (const d of live?.gpu?.displays || []) {
		if (!d || d.connected === false) continue
		const n = normRandrCaspar(d?.name)
		if (n) out.add(n)
	}
	return out
}

function bracketHasLiveRandr(connected, dpA, dpB) {
	const a = normRandrCaspar(dpA)
	const b = normRandrCaspar(dpB)
	return (a && connected.has(a)) || (b && connected.has(b))
}

/** xrandr shows DP-0, HDMI-0, DP-2, DP-4 (or bracket alternates) — RTX 20/30 quad. */
export function detectRtx2030QuadFromLive(live) {
	const connected = connectedLiveRandrNames(live)
	if (connected.size < 4) return false
	const rtx = defaultClientGpuTopology()
	let matched = 0
	for (const row of rtx) {
		if (bracketHasLiveRandr(connected, row.dpA, row.dpB)) matched++
	}
	return matched >= 4
}

/** Prefer live xrandr over stale saved pair → gpu_pN map (fixes DP-4 on gpu_unmapped). */
export function reconcileTopologyWithLiveDisplays(topology, live) {
	const connected = connectedLiveRandrNames(live)
	if (!connected.size) return topology
	if (detectRtx2030QuadFromLive(live)) return defaultClientGpuTopology()
	const rtx = defaultClientGpuTopology()
	const merged = mergeTopologyWithDefaultSockets(topology)
	return merged.map((row, idx) => {
		const def = rtx.find((r) => r.physicalPortId === row.physicalPortId)
		if (!def) return row
		if (bracketHasLiveRandr(connected, row.dpA, row.dpB)) return row
		if (bracketHasLiveRandr(connected, def.dpA, def.dpB)) {
			return {
				...row,
				dpA: def.dpA,
				dpB: def.dpB,
				slotOrder: idx,
				connectorNumber: idx,
				location: idx,
			}
		}
		return row
	})
}

/**
 * Topology for cabling + server persist: server-reconciled map, else live xrandr, else saved/default.
 * @param {object | null | undefined} payload
 * @param {object | null | undefined} settings
 */
export function resolveTopologyForDeviceView(payload, settings = null) {
	const fromMap = payload?.live?.gpu?.physicalMap?.effectiveTopology
	if (Array.isArray(fromMap) && fromMap.length) return fromMap
	const base = resolveEffectiveGpuTopology(
		payload?.gpuPhysicalTopology || settings?.gpuPhysicalTopology,
	)
	return reconcileTopologyWithLiveDisplays(base, payload?.live)
}

/** RandR output present on the socket (includes connected-without-active-mode, e.g. DP-4). */
function displaysMatchingPairs(pairs, displays, connectors) {
	const want = new Set((pairs || []).map((p) => normRandrCaspar(p)).filter(Boolean))
	if (!want.size) return []
	const hits = []
	for (const d of displays || []) {
		const n = normRandrCaspar(d?.name)
		if (!n || !want.has(n)) continue
		if (d.connected === false) continue
		hits.push({ name: n, ref: d })
	}
	for (const c of connectors || []) {
		const n = normRandrCaspar(c?.shortName || c?.name)
		if (!n || !want.has(n)) continue
		if (c.connected === false) continue
		if (hits.some((h) => h.name === n)) continue
		hits.push({ name: n, ref: c })
	}
	return hits
}

function isPrimaryTopologySocket(id) {
	const m = /^gpu_p(\d+)$/i.exec(String(id || '').trim())
	if (!m) return false
	return parseInt(m[1], 10) < RTX_20_30_SOCKET_COUNT
}

function labelForTopologyPairs(pairs) {
	const list = (pairs || []).filter(Boolean).map(String)
	if (!list.length) return ''
	const blob = list.join(' ').toUpperCase()
	if (blob.includes('HDMI')) {
		return `HDMI ${list.map((p) => p.split('-').slice(1).join('-')).join('/')}`
	}
	if (blob.includes('EDP')) return list.join(' · ')
	return `DP ${list.map((p) => p.replace(/^DP-/i, '')).join('/')}`
}

function entryFromTopologyRow(row, displays, connectors, suggestedGpuOuts, index, graphGpuOuts = []) {
	const id = String(row?.physicalPortId || '').trim()
	const pairs = [row?.dpA, row?.dpB].filter(Boolean).map(String)
	const hits = displaysMatchingPairs(pairs, displays, connectors)
	const connected = hits.length > 0
	const activeHit = hits[0] || null
	const active = activeHit?.name || ''
	const disp =
		activeHit?.ref && 'resolution' in activeHit.ref
			? activeHit.ref
			: (displays || []).find((d) => normRandrCaspar(d?.name) === normRandrCaspar(active)) || null
	const suggested = (suggestedGpuOuts || []).find((c) => String(c?.id || '').trim() === id)
	const inGraph = (graphGpuOuts || []).some((c) => String(c?.id || '').trim() === id)
	const resolution = String(disp?.resolution || '').trim()
	const hasMode = connected && resolution && resolution !== 'unknown'
	let label = labelForTopologyPairs(pairs) || id
	if (connected && active) {
		label = hasMode ? `${label} · ${active}` : `${label} · ${active} (no mode)`
	}
	return {
		connectorId: id,
		layoutSlotId: id,
		label,
		kind: 'gpu_out',
		index,
		connected: hasMode,
		livePresent: connected,
		topologySlot: isPrimaryTopologySocket(id),
		hidden: false,
		pairs,
		monitor: active ? String(active).trim() : '',
		resolution,
		refreshHz: Number.isFinite(Number(disp?.refreshHz)) ? Number(disp.refreshHz) : null,
		icon: iconForPortHints(...pairs),
		isVirtual: !suggested && !inGraph && !connected,
		inDeviceGraph: !!(suggested || inGraph || connected),
	}
}

/** Build rear-panel rows from topology (authoritative pair → gpu_pN map). */
export function buildGpuEntriesFromTopology(topology, live, suggestedGpuOuts = [], graphGpuOuts = []) {
	const displays = Array.isArray(live?.gpu?.displays) ? live.gpu.displays : []
	const connectors = Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : []
	const sorted = [...(topology || [])].sort(
		(a, b) => (Number(a?.slotOrder) || 0) - (Number(b?.slotOrder) || 0),
	)
	return sorted.map((row, index) =>
		entryFromTopologyRow(row, displays, connectors, suggestedGpuOuts, index, graphGpuOuts),
	)
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

export function gpuPhysicalPortCableId(connectorOrSlotId) {
	const raw = String(connectorOrSlotId || '').trim()
	const m = raw.match(/^(gpu_p\d+)/i)
	return m ? m[1] : raw
}

/** Per-connector jack id, e.g. gpu_p0 + DP-1 → gpu_p0__DP_1 */
export function gpuSplitConnectorId(parentPortId, shortName) {
	const base = String(parentPortId || '').trim()
	const tag = String(shortName || '').trim().replace(/[^A-Za-z0-9]+/g, '_')
	return tag ? `${base}__${tag}` : base
}

/** modetest lists DP-N and DP-(N+1) on the same physical socket — never show as two cabled jacks. */
function shouldExpandPhysicalPortToConnectors(_p, _live) {
	return false
}

/** Merge gpu_pN__DP_X split rows back into one jack per physical socket. */
function consolidateBracketSplitEntries(entries) {
	const splitByParent = new Map()
	const keep = []
	for (const entry of entries) {
		const id = String(entry?.connectorId || '').trim()
		const parent =
			String(entry?.parentPortId || '').trim() || (id.match(/^(gpu_p\d+)__/i) || [])[1] || ''
		if (!parent) {
			keep.push(entry)
			continue
		}
		let row = splitByParent.get(parent)
		if (!row) {
			const pairs = Array.isArray(entry.pairs) ? [...entry.pairs] : []
			row = {
				...entry,
				connectorId: parent,
				layoutSlotId: parent,
				parentPortId: undefined,
				pairs,
			}
			splitByParent.set(parent, row)
			continue
		}
		const pairs = Array.isArray(entry.pairs) ? entry.pairs : []
		row.pairs = [...new Set([...(row.pairs || []), ...pairs])]
		row.connected = !!(row.connected || entry.connected)
		if (entry.connected && entry.monitor) {
			row.monitor = entry.monitor
			row.resolution = entry.resolution || row.resolution
			row.refreshHz = entry.refreshHz ?? row.refreshHz
			row.label = entry.label || row.label
		}
	}
	return [...keep, ...splitByParent.values()]
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
	return consolidateBracketSplitEntries(tagged)
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
export function buildGpuLayoutItemsFromLive(live, suggestedGpuOuts = [], savedTopology = null) {
	return layoutItemsFromGpuEntries(
		buildGpuSelectablePortEntries({
			live,
			suggestedGpuOuts,
			savedTopology,
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

/** Saved layout row → server `gpuPhysicalTopology` (persisted in settings). */
export function gpuLayoutItemsToPhysicalTopology(items) {
	if (!Array.isArray(items)) return []
	return items
		.map((item, idx) => {
			const rawId = String(item?.id || '').trim()
			const m = rawId.match(/^(gpu_p\d+)/i)
			if (!m) return null
			const pairs = Array.isArray(item.pairs) ? item.pairs.filter(Boolean) : []
			return {
				physicalPortId: m[1],
				slotOrder: idx,
				dpA: String(pairs[0] || '').trim(),
				dpB: String(pairs[1] || '').trim(),
				connectorNumber: idx,
				location: idx,
			}
		})
		.filter(Boolean)
}

/**
 * Map RandR pair names to layout slot id (gpu_pN) from saved rear-panel layout or settings topology.
 * @param {string[]} pairs
 * @param {{ byId?: Map<string, object> }} [prefs]
 * @param {object[] | null} [savedTopology]
 */
export function resolveGpuSlotIdFromSavedLayout(pairs, prefs = null, savedTopology = null) {
	const want = new Set((pairs || []).map((p) => normRandrCaspar(p)).filter(Boolean))
	if (!want.size) return ''
	const byId = prefs?.byId || readGpuLayoutPrefs().byId
	for (const [slotId, item] of byId) {
		const canonical = String(slotId).replace(/__.*$/i, '')
		if (!/^gpu_p\d+$/i.test(canonical)) continue
		const itemPairs = Array.isArray(item?.pairs) ? item.pairs : []
		for (const p of itemPairs) {
			if (want.has(normRandrCaspar(p))) return canonical
		}
	}
	for (const row of resolveEffectiveGpuTopology(savedTopology, prefs)) {
		const canonical = String(row?.physicalPortId || '').trim()
		if (!/^gpu_p\d+$/i.test(canonical)) continue
		for (const p of [row.dpA, row.dpB].filter(Boolean)) {
			if (want.has(normRandrCaspar(p))) return canonical
		}
	}
	return ''
}

/**
 * Apply saved order/hidden/labels from localStorage onto port entries.
 * @param {object[]} entries
 * @param {{ byId?: Map<string, object>, orderIds?: string[] }} [prefs]
 * @param {{ defaultHideDisconnected?: boolean, connectedDisplays?: object[], connectors?: object[], topology?: object[] }} [opts]
 */
export function mergeGpuLayoutEntriesWithPrefs(entries, prefs, { defaultHideDisconnected = false, connectedDisplays = [], connectors = [], topology = null } = {}) {
	const connectedNames = new Set(
		(connectedDisplays || [])
			.filter((d) => d?.connected)
			.map((d) => normRandrCaspar(d.name))
			.filter(Boolean),
	)
	const liveIds = new Set(entries.map((e) => String(e.connectorId || e.layoutSlotId || '').trim()).filter(Boolean))
	const byIdRaw = prefs?.byId || new Map()
	const orderIds = [
		...new Set([
			...(prefs?.orderIds || []),
			...byIdRaw.keys(),
			...(topology || []).map((t) => String(t?.physicalPortId || '').trim()),
		]),
	].filter((id) => /^gpu_p\d+$/i.test(String(id).trim()))
	const decisions = []
	const merged = entries.map((entry) => {
		const id = String(entry.connectorId || entry.layoutSlotId || '').trim()
		const saved = byIdRaw.get(id)
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
		const pairs =
			Array.isArray(saved?.pairs) && saved.pairs.length ? [...saved.pairs] : entry.pairs
		let livePresent = !!entry.livePresent
		let connected = !!entry.connected
		let monitor = entry.monitor || ''
		if (Array.isArray(saved?.pairs) && saved.pairs.length) {
			const hits = displaysMatchingPairs(pairs, connectedDisplays, connectors)
			if (hits.length) {
				livePresent = true
				monitor = hits[0].name
				const disp = (connectedDisplays || []).find(
					(d) => normRandrCaspar(d?.name) === hits[0].name,
				)
				const res = String(disp?.resolution || '').trim()
				connected = !!(res && res !== 'unknown')
			} else if (connectedNames.size) {
				livePresent = pairs.some((p) => connectedNames.has(normRandrCaspar(p)))
				connected = livePresent
				const active = pairs.find((p) => connectedNames.has(normRandrCaspar(p)))
				if (active) monitor = String(active).trim()
			}
		}
		decisions.push({
			id,
			hidden,
			hiddenReason,
			inSavedPrefs: saved != null,
			savedHidden: saved != null ? !!saved.hidden : null,
			connected,
			livePresent,
			label: entry.label,
			orphanSavedPref: false,
		})
		return {
			...entry,
			hidden,
			connected,
			livePresent,
			monitor,
			label: saved?.label ? String(saved.label) : entry.label,
			pairs,
			topologySlot: entry.topologySlot === true || isPrimaryTopologySocket(id),
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
	let result = merged
	const mergedIds = new Set(merged.map((e) => String(e.connectorId || '').trim()))
	for (const slotId of orderIds) {
		const id = String(slotId).trim()
		if (!id || mergedIds.has(id)) continue
		const m = /^gpu_p(\d+)$/i.exec(id)
		if (!m) continue
		const saved = byIdRaw.get(id)
		const topoRow = (topology || []).find((t) => String(t?.physicalPortId || '').trim() === id)
		const inferred = topoRow
			? entryFromTopologyRow(topoRow, connectedDisplays, [], [], result.length)
			: entryFromInferredPhysicalPort(parseInt(m[1], 10), [], connectedDisplays, topology)
		if (saved?.pairs?.length) {
			inferred.pairs = [...saved.pairs]
			if (connectedNames.size) {
				inferred.connected = inferred.pairs.some((p) => connectedNames.has(normRandrCaspar(p)))
				const active = inferred.pairs.find((p) => connectedNames.has(normRandrCaspar(p)))
				if (active) inferred.monitor = String(active).trim()
			}
		}
		if (saved?.label) inferred.label = String(saved.label)
		if (saved?.hidden != null) inferred.hidden = !!saved.hidden
		result.push(inferred)
		mergedIds.add(id)
	}
	if (!orderIds.length) return result
	const rank = (id) => {
		const i = orderIds.indexOf(id)
		return i >= 0 ? i : 9000 + result.findIndex((e) => e.connectorId === id)
	}
	return [...result].sort((a, b) => rank(a.connectorId) - rank(b.connectorId))
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
 * @param {{ live: object, suggestedGpuOuts?: object[], graphGpuOuts?: object[], layoutPrefs?: { byId: Map, orderIds: string[] }, savedTopology?: object[], hideDisconnectedByDefault?: boolean }} opts
 * @returns {Array<object>}
 */
export function buildGpuSelectablePortEntries({
	live,
	suggestedGpuOuts = [],
	graphGpuOuts = [],
	layoutPrefs = null,
	savedTopology = null,
	hideDisconnectedByDefault = null,
}) {
	const prefs = layoutPrefs ?? readGpuLayoutPrefs()
	const topology = reconcileTopologyWithLiveDisplays(
		resolveEffectiveGpuTopology(savedTopology, prefs),
		live,
	)
	let base = buildGpuEntriesFromTopology(topology, live, suggestedGpuOuts, graphGpuOuts)

	const raw = consolidateBracketSplitEntries(
		buildRawGpuPortEntriesFromLive(live, suggestedGpuOuts, graphGpuOuts),
	)
	const baseIds = new Set(base.map((e) => String(e?.connectorId || '').trim()))
	for (const e of raw) {
		const id = String(e?.connectorId || '').trim()
		if (/^gpu_p\d+(__.*)?$/i.test(id)) continue
		if (!id || baseIds.has(id)) continue
		base.push(e)
		baseIds.add(id)
	}

	const hideDefault =
		hideDisconnectedByDefault !== null ? hideDisconnectedByDefault : false
	return mergeGpuLayoutEntriesWithPrefs(base, prefs, {
		defaultHideDisconnected: hideDefault,
		connectedDisplays: Array.isArray(live?.gpu?.displays) ? live.gpu.displays : [],
		connectors: Array.isArray(live?.gpu?.connectors) ? live.gpu.connectors : [],
		topology,
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

export function entryToRearPanelGpuItem(entry, connectedDisplays = [], connectors = []) {
	const pairs = Array.isArray(entry.pairs) ? entry.pairs : []
	const hits = displaysMatchingPairs(pairs, connectedDisplays, connectors)
	const livePresent = !!(entry.livePresent || hits.length > 0)
	const connected = !!(entry.connected || (livePresent && entry.resolution && entry.resolution !== 'unknown'))
	const inDeviceGraph = entry.inDeviceGraph === true
	return {
		id: entry.connectorId,
		layoutSlotId: entry.layoutSlotId || entry.connectorId,
		icon: entry.icon,
		label: entry.label,
		kind: 'gpu_out',
		index: entry.index,
		connected,
		livePresent,
		topologySlot: entry.topologySlot === true || isPrimaryTopologySocket(entry.connectorId),
		hidden: entry.hidden,
		pairs,
		monitor: entry.monitor || '',
		resolution: entry.resolution || '',
		refreshHz: entry.refreshHz,
		inDeviceGraph,
		isVirtual: !inDeviceGraph,
	}
}
