/**
 * Live stream / record status — event-driven from WebSocket (no polling).
 * Shape matches GET /api/streaming-channel: { rtmp?, record? }.
 */
import { api } from './api-client.js'

/** @type {object | null} */
let status = null
/** @type {Set<(st: object | null) => void>} */
const listeners = new Set()

function notify() {
	for (const fn of listeners) {
		try {
			fn(status)
		} catch (e) {
			console.warn('[streaming-channel-state]', e)
		}
	}
}

/**
 * Normalize server payloads (WS event, change patch, GET body, POST response).
 * @param {unknown} raw
 * @returns {object | null}
 */
export function normalizeStreamingChannelStatus(raw) {
	if (!raw || typeof raw !== 'object') return null
	const p = /** @type {Record<string, unknown>} */ (raw)
	if (p.rtmp != null || p.record != null) return { ...p }

	// Device-view live slice: { streaming: { activeOutputs }, recording: { activeOutputs } }
	const streaming = p.streaming && typeof p.streaming === 'object' ? p.streaming : null
	const recording = p.recording && typeof p.recording === 'object' ? p.recording : null
	if (streaming || recording) {
		const streamIds = Array.isArray(streaming?.activeOutputs) ? streaming.activeOutputs.map(String) : []
		const recIds = Array.isArray(recording?.activeOutputs) ? recording.activeOutputs.map(String) : []
		return {
			rtmp: { active: streamIds.length > 0, outputId: streamIds[0] || null, activeOutputs: streamIds },
			record: { active: recIds.length > 0, outputId: recIds[0] || null, activeOutputs: recIds },
		}
	}
	return null
}

/**
 * @param {unknown} next
 */
export function setStreamingChannelStatus(next) {
	const norm = normalizeStreamingChannelStatus(next)
	if (!norm) return
	status = norm
	notify()
}

export function getStreamingChannelStatus() {
	return status
}

/**
 * @param {(st: object | null) => void} fn
 */
export function subscribeStreamingChannelStatus(fn) {
	listeners.add(fn)
	try {
		fn(status)
	} catch {}
	return () => listeners.delete(fn)
}

/**
 * Apply WS `change` path updates from state store.
 * @param {string} path
 * @param {unknown} value
 */
export function ingestStreamingChannelChange(path, value) {
	const p = String(path || '')
	if (p === 'streamingChannel' || p === 'streaming-channel' || p === 'streaming_channel') {
		setStreamingChannelStatus(value)
	}
}

/**
 * Dedicated WS event `{ type: 'streaming_channel', data: … }`.
 * @param {unknown} data
 */
export function ingestStreamingChannelWsEvent(data) {
	setStreamingChannelStatus(data)
}

/**
 * Merge POST start/stop response when server returns updated status.
 * @param {unknown} res
 */
export function applyStreamingChannelActionResponse(res) {
	if (!res || typeof res !== 'object') return
	const r = /** @type {Record<string, unknown>} */ (res)
	if (r.status) setStreamingChannelStatus(r.status)
	else if (r.rtmp != null || r.record != null) setStreamingChannelStatus(r)
}

/** One-shot sync after connect / page load — not a poll loop. */
let bootstrapPromise = null

export async function bootstrapStreamingChannelStatus() {
	if (status) return status
	if (bootstrapPromise) return bootstrapPromise
	bootstrapPromise = (async () => {
		try {
			const st = await api.get('/api/streaming-channel')
			setStreamingChannelStatus(st)
			return status
		} catch {
			return null
		} finally {
			bootstrapPromise = null
		}
	})()
	return bootstrapPromise
}

export function clearStreamingChannelStatus() {
	status = null
	notify()
}
