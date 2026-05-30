/**
 * Build selectable GPU output entries from server live.gpu (physicalMap + suggested).
 */
import { normRandrCaspar } from '../components/device-view-caspar-render-helpers.js'

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

export const GPU_CUSTOM_LAYOUT_KEY = 'gpu_custom_layout'

/** @returns {{ byId: Map<string, object>, orderIds: string[] }} */
export function readGpuLayoutPrefs() {
	try {
		const raw = localStorage.getItem(GPU_CUSTOM_LAYOUT_KEY)
		const arr = raw ? JSON.parse(raw) : null
		if (!Array.isArray(arr)) return { byId: new Map(), orderIds: [] }
		const byId = new Map()
		for (const item of arr) {
			const id = String(item?.id || '').trim()
			if (id) byId.set(id, item)
		}
		return { byId, orderIds: arr.map((x) => String(x?.id || '').trim()).filter(Boolean) }
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
	const byId = prefs?.byId || new Map()
	const orderIds = prefs?.orderIds || []
	const merged = entries.map((entry) => {
		const id = String(entry.connectorId || entry.layoutSlotId || '').trim()
		const saved = byId.get(id)
		const hidden =
			saved != null ? !!saved.hidden : defaultHideDisconnected ? !entry.connected : !!entry.hidden
		return {
			...entry,
			hidden,
			label: saved?.label ? String(saved.label) : entry.label,
			pairs:
				Array.isArray(saved?.pairs) && saved.pairs.length ? [...saved.pairs] : entry.pairs,
		}
	})
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
 * Prefer DRM physicalMap.ports when the server provides them (topologySource drm / gpu_p* ids).
 * @param {{ live: object, suggestedGpuOuts?: object[], layoutPrefs?: { byId: Map, orderIds: string[] }, hideDisconnectedByDefault?: boolean }} opts
 * @returns {Array<object>}
 */
export function buildGpuSelectablePortEntries({
	live,
	suggestedGpuOuts = [],
	layoutPrefs = null,
	hideDisconnectedByDefault = null,
}) {
	const physicalPorts = Array.isArray(live?.gpu?.physicalMap?.ports) ? live.gpu.physicalMap.ports : []
	const usePhysical = hasDrmGpuPhysicalMap(live)

	let raw = []
	if (usePhysical) {
		const sorted = [...physicalPorts].sort(
			(a, b) => (Number(a?.slotOrder) || 0) - (Number(b?.slotOrder) || 0),
		)
		raw = sorted.map((p, index) => {
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
		})
		const prefs = layoutPrefs ?? readGpuLayoutPrefs()
		const hideDefault =
			hideDisconnectedByDefault !== null ? hideDisconnectedByDefault : true
		return mergeGpuLayoutEntriesWithPrefs(raw, prefs, {
			defaultHideDisconnected: hideDefault,
		})
	}

	const displays = Array.isArray(live?.gpu?.displays) ? live.gpu.displays : []
	raw = []
	const seen = new Set()

	for (const c of suggestedGpuOuts) {
		if (!c || c.kind !== 'gpu_out') continue
		const id = String(c.id || '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		const ref = String(c.externalRef || c.label || id).trim()
		const disp = displays.find(
			(d) => d?.connected && normRandrCaspar(d.name) === normRandrCaspar(ref),
		)
		raw.push({
			connectorId: id,
			layoutSlotId: id,
			label: String(c.label || ref || id),
			kind: 'gpu_out',
			index: raw.length,
			connected: !!disp,
			hidden: false,
			pairs: ref ? [ref] : [],
			monitor: disp?.name || ref,
			resolution: disp?.resolution || '',
			refreshHz: Number.isFinite(Number(disp?.refreshHz)) ? Number(disp.refreshHz) : null,
			icon: iconForPortHints(ref),
			isVirtual: !disp,
		})
	}

	for (const d of displays) {
		if (!d?.connected) continue
		const name = String(d.name || '').trim()
		if (!name) continue
		const match = suggestedGpuOuts.find(
			(c) => c?.kind === 'gpu_out' && normRandrCaspar(c.externalRef || c.label) === normRandrCaspar(name),
		)
		if (match && seen.has(String(match.id))) continue
		const id = match?.id || `gpu_${normRandrCaspar(name).replace(/[^A-Z0-9]+/g, '_')}`
		if (seen.has(id)) continue
		seen.add(id)
		raw.push({
			connectorId: id,
			layoutSlotId: id,
			label: name,
			kind: 'gpu_out',
			index: raw.length,
			connected: true,
			hidden: false,
			pairs: [name],
			monitor: name,
			resolution: d.resolution || '',
			refreshHz: Number.isFinite(Number(d.refreshHz)) ? Number(d.refreshHz) : null,
			icon: iconForPortHints(name),
			isVirtual: false,
		})
	}

	const prefs = layoutPrefs ?? readGpuLayoutPrefs()
	return mergeGpuLayoutEntriesWithPrefs(raw, prefs, { defaultHideDisconnected: false })
}

/**
 * @param {ReturnType<typeof buildGpuSelectablePortEntries>[number]} entry
 * @param {object[]} connectedDisplays
 */
export function entryToRearPanelGpuItem(entry, connectedDisplays = []) {
	const pairs = Array.isArray(entry.pairs) ? entry.pairs : []
	const connected =
		entry.connected ||
		pairs.some((pName) =>
			connectedDisplays.some((d) => d?.connected && normRandrCaspar(d.name) === normRandrCaspar(pName)),
		)
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
		isVirtual: entry.isVirtual ?? !connected,
	}
}
