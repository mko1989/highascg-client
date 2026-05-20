'use strict'

const { getChannelMap } = require('../config/routing')
const { clipParamForPlay } = require('../caspar/amcp-utils')
const { resolveClipDurationMs } = require('../state/playback-tracker')
const {
	buildEffectAmcpLinesPlayback,
	mixerEffectNeutralLines,
	playAfSuffix,
	TIMELINE_LAYER_BASE,
	TIMELINE_AMCP_DRIFT_MS,
} = require('./timeline-playback-helpers')

/**
 * @param {object} clip
 * @param {number} ms timeline position
 * @param {object} tl timeline model
 * @param {object} self app ctx
 */
function clipTransportMeta(clip, ms, tl, self) {
	const src = String(clip.source?.value || '')
	const isRoute = src.startsWith('route://')
	const fps = Math.max(1, tl.fps || 25)
	const inFrames = Number(clip.inPoint) || 0
	const localMs = Math.max(0, ms - clip.startTime)
	const relativeFrame = Math.floor((localMs * fps) / 1000)
	let frame = !isRoute ? relativeFrame + inFrames : 0
	let implicitLoop = false
	if (!isRoute && src) {
		const durMs = resolveClipDurationMs(self, src)
		if (durMs != null && durMs > 0) {
			const totalFrames = Math.max(1, Math.floor((durMs * fps) / 1000))
			if (inFrames < totalFrames) {
				const spanFrames = totalFrames - inFrames
				const spanMs = (spanFrames * 1000) / fps
				if (clip.duration > spanMs + 0.5) {
					implicitLoop = true
					frame = inFrames + (relativeFrame % spanFrames)
				}
			}
		}
	}
	return {
		src,
		srcQ: clipParamForPlay(src),
		isRoute,
		frame,
		implicitLoop,
		loopClip: !!(clip.loopAlways || clip.loop),
		loopAlways: !!clip.loopAlways,
	}
}

module.exports = {
	_caspLayer(_ch, li) {
		return TIMELINE_LAYER_BASE + li
	},

	/**
	 * Full transport + mixer sync (scrub, play start, inspector edits). Not called from the UI tick.
	 * @param {string} id timeline id
	 * @param {number} ms position
	 * @param {boolean} force scrub / explicit seek — sends PLAY|LOAD|SEEK for active clips
	 */
	_applyAt(id, ms, force) {
		this._syncAmcpLayers(id, ms, { force: !!force, allowDriftSeek: false })
	},

	/**
	 * Called from {@link TimelineEngine#_tick} only — clip enter/exit, throttled drift SEEK for stretched clips,
	 * and keyframed mixer when values change. Does not PLAY/SEEK on every tick for normal 1× clips.
	 */
	_syncAmcpOnTimelineTick(id, ms) {
		this._syncAmcpLayers(id, ms, { force: false, allowDriftSeek: true })
	},

	/**
	 * @param {string} id
	 * @param {number} ms
	 * @param {{ force?: boolean, allowDriftSeek?: boolean }} opts
	 */
	_syncAmcpLayers(id, ms, opts) {
		const tl = this.timelines.get(id)
		const self = this.self
		if (!tl || !self?.amcp) return
		const force = !!opts.force
		const allowDriftSeek = !!opts.allowDriftSeek
		const channels = this._channels()
		const playing = this._pb?.playing ?? false
		const mixerDirty = new Set()

		for (let li = 0; li < tl.layers.length; li++) {
			const layer = tl.layers[li]
			const clip = this._clipAt(layer, ms)

			for (const ch of channels) {
				const caspLayer = this._caspLayer(ch, li)
				const key = `${ch}-${caspLayer}`
				const prev = this._prevKey.get(key)

				if (clip) {
					const meta = clipTransportMeta(clip, ms, tl, self)
					const newClip = !prev || prev.clipId !== clip.id
					let transportSent = false

					if (meta.loopAlways) {
						if (newClip || force) {
							this._sendClipTransport(ch, caspLayer, clip, meta, { playing, startTransport: true })
							transportSent = true
						}
					} else if (newClip || force) {
						this._sendClipTransport(ch, caspLayer, clip, meta, { playing, startTransport: true })
						transportSent = true
					} else if (
						allowDriftSeek &&
						playing &&
						meta.implicitLoop &&
						!meta.isRoute &&
						prev?.clipId === clip.id
					) {
						const now = Date.now()
						const driftDue = !prev.lastDriftAt || now - prev.lastDriftAt >= TIMELINE_AMCP_DRIFT_MS
						if (driftDue && prev.frame !== meta.frame) {
							self.amcp.call(ch, caspLayer, 'SEEK', String(meta.frame)).catch(() => {})
							transportSent = true
							this._prevKey.set(key, {
								clipId: clip.id,
								frame: meta.frame,
								lastDriftAt: now,
							})
						}
					}

					if (transportSent && (force || newClip)) {
						for (const pk of this._lastKfValues.keys()) {
							if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
						}
					}

					if (transportSent || newClip || !prev) {
						this._prevKey.set(key, {
							clipId: clip.id,
							frame: meta.frame,
							lastDriftAt:
								transportSent && meta.implicitLoop
									? Date.now()
									: prev?.lastDriftAt,
						})
					}

					if (this._applyClipMixer(ch, caspLayer, clip, ms - clip.startTime)) {
						mixerDirty.add(ch)
					}
				} else if (prev?.clipId) {
					self.amcp.stop(ch, caspLayer).catch(() => {})
					this._prevKey.set(key, null)
					for (const pk of this._lastKfValues.keys()) {
						if (pk.startsWith(`${ch}-${caspLayer}-`)) this._lastKfValues.delete(pk)
					}
				}
			}
		}

		for (const ch of mixerDirty) {
			self.amcp.mixerCommit(ch).catch(() => {})
		}
	},

	/**
	 * PLAY / LOAD for one layer — only when clip starts or user scrubs (startTransport).
	 * @param {boolean} opts.playing timeline transport playing
	 * @param {boolean} opts.startTransport new clip, play(), or seek/scrub
	 */
	_sendClipTransport(ch, caspLayer, clip, meta, opts) {
		const self = this.self
		if (!self?.amcp) return
		const { playing, startTransport } = opts

		if (meta.loopAlways) {
			if (!startTransport) return
			self.amcp.raw(`PLAY ${ch}-${caspLayer} ${meta.srcQ} LOOP${playAfSuffix(clip)}`).catch(() => {})
			return
		}
		if (!startTransport) return

		if (meta.isRoute) {
			self.amcp.raw(`PLAY ${ch}-${caspLayer} ${meta.srcQ}${playAfSuffix(clip)}`).catch(() => {})
		} else if (playing || meta.loopClip) {
			const loopStr = meta.loopClip ? ' LOOP' : ''
			self.amcp
				.raw(`PLAY ${ch}-${caspLayer} ${meta.srcQ}${loopStr} SEEK ${meta.frame}${playAfSuffix(clip)}`)
				.catch(() => {})
		} else {
			self.amcp
				.raw(`LOAD ${ch}-${caspLayer} ${meta.srcQ} SEEK ${meta.frame}${playAfSuffix(clip)}`)
				.catch(() => {})
		}
	},

	/**
	 * @returns {boolean} True if any mixer command was sent (caller should COMMIT that channel on Caspar 2.5+).
	 */
	_applyClipMixer(ch, layer, clip, localMs) {
		const self = this.self
		if (!self?.amcp) return false
		const { w, h } = this._programResolutionForPlayback()
		const base = this._clipFillBaseNormalized(clip, w, h)
		const fx = this._interpProp(clip, 'fill_x', localMs, base.fill_x)
		const fy = this._interpProp(clip, 'fill_y', localMs, base.fill_y)
		const sx = this._interpProp(clip, 'scale_x', localMs, base.scale_x)
		const sy = this._interpProp(clip, 'scale_y', localMs, base.scale_y)
		const op = this._interpProp(clip, 'opacity', localMs, 1)
		const volRaw = this._interpProp(clip, 'volume', localMs, clip.volume != null ? clip.volume : 1)
		const vol = clip.muted ? 0 : volRaw

		let sent = false
		const kFill = `${ch}-${layer}-fill`
		const fillStr = `${fx},${fy},${sx},${sy}`
		if (this._lastKfValues.get(kFill) !== fillStr) {
			this._lastKfValues.set(kFill, fillStr)
			self.amcp.mixerFill(ch, layer, fx, fy, sx, sy, 0).catch(() => {})
			sent = true
			if (typeof self.log === 'function') {
				self.log('debug', `[Timeline] MIXER ${ch}-${layer} FILL ${fx} ${fy} ${sx} ${sy} 0`)
			}
		}
		const kOp = `${ch}-${layer}-opacity`
		const lastOp = this._lastKfValues.get(kOp)
		if (lastOp === undefined || Math.abs(op - lastOp) >= 1e-5) {
			this._lastKfValues.set(kOp, op)
			self.amcp.mixerOpacity(ch, layer, op).catch(() => {})
			sent = true
		}
		const kVol = `${ch}-${layer}-volume`
		const lastVol = this._lastKfValues.get(kVol)
		if (lastVol === undefined || Math.abs(vol - lastVol) >= 1e-5) {
			this._lastKfValues.set(kVol, vol)
			self.amcp.mixerVolume(ch, layer, vol).catch(() => {})
			sent = true
		}

		const kFx = `${ch}-${layer}-fx`
		const fxKey =
			Array.isArray(clip.effects) && clip.effects.length > 0
				? clip.effects.map((f) => `${f.type}:${JSON.stringify(f.params || {})}`).join('|')
				: ''
		if (this._lastKfValues.get(kFx) !== fxKey) {
			this._lastKfValues.set(kFx, fxKey)
			const cl = `${ch}-${layer}`
			const lines = [...mixerEffectNeutralLines(cl)]
			if (Array.isArray(clip.effects)) {
				for (const fx of clip.effects) {
					const fxLines = buildEffectAmcpLinesPlayback(fx.type, fx.params || {}, cl)
					if (fxLines) lines.push(...fxLines)
				}
			}
			if (lines.length > 0) {
				self.amcp.batchSendChunked(lines).catch(() => {})
				sent = true
			}
		}
		return sent
	},

	_channelsFor(sendTo) {
		const st = sendTo || {}
		const previewOn = st.preview !== false
		const programOn = st.program !== false
		let map = null
		try {
			map = this.self?.config ? getChannelMap(this.self.config) : null
		} catch (_) {}
		const screenCount = map?.screenCount || 1
		const screenIdx = st.screenIdx != null ? st.screenIdx : null
		const ch = []
		const addScreen = (i) => {
			if (previewOn) {
				const prv = map?.previewCh ? map.previewCh(i + 1) : (i + 1) * 2
				if (prv != null) ch.push(prv)
			}
			if (programOn) ch.push(map?.programCh ? map.programCh(i + 1) : (i + 1) * 2 - 1)
		}
		if (screenIdx !== null) addScreen(screenIdx)
		else for (let i = 0; i < screenCount; i++) addScreen(i)
		if (ch.length === 0) {
			const fallback = programOn ? (map?.programCh?.(1) ?? 1) : (map?.previewCh?.(1) ?? map?.programCh?.(1) ?? 1)
			ch.push(fallback)
		}
		return ch
	},

	_channels() {
		return this._channelsFor(this._pb?.sendTo)
	},

	_timelineLayerIndex(caspLayer) {
		const li = caspLayer - TIMELINE_LAYER_BASE
		return li >= 0 ? li : -1
	},

	_pauseAll() {
		const self = this.self
		if (!self?.amcp) return
		const tl = this.timelines.get(this._pb?.timelineId)
		if (!tl) return
		const ms = this._nowMs()
		for (const key of this._prevKey.keys()) {
			const [ch, caspLayer] = key.split('-').map(Number)
			if (isNaN(ch) || isNaN(caspLayer)) continue
			const li = this._timelineLayerIndex(caspLayer)
			if (li >= 0 && li < tl.layers.length) {
				const clip = this._clipAt(tl.layers[li], ms)
				if (clip?.loopAlways) continue
			}
			self.amcp.pause(ch, caspLayer).catch(() => {})
		}
	},

	_resumeAll() {
		const self = this.self
		if (!self?.amcp) return
		const tl = this.timelines.get(this._pb?.timelineId)
		if (!tl) return
		const ms = this._nowMs()
		for (const key of this._prevKey.keys()) {
			const [ch, caspLayer] = key.split('-').map(Number)
			if (isNaN(ch) || isNaN(caspLayer)) continue
			const li = this._timelineLayerIndex(caspLayer)
			if (li >= 0 && li < tl.layers.length) {
				const clip = this._clipAt(tl.layers[li], ms)
				if (clip?.loopAlways) continue
			}
			self.amcp.resume(ch, caspLayer).catch(() => {})
		}
	},

	_stopAll(tl) {
		const self = this.self
		if (!self?.amcp) return
		const channels = this._channels()
		for (let li = 0; li < tl.layers.length; li++) {
			for (const ch of channels) {
				self.amcp.stop(ch, this._caspLayer(ch, li)).catch(() => {})
			}
		}
		this._lastKfValues.clear()
	},
}
