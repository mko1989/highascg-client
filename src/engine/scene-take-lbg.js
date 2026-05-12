/**
 * Standard program take: LOADBG … MIX … then PLAY per layer (Caspar FG/BG swap).
 * Replaces the former dual-bank mixer opacity crossfade (`scene-take.js`).
 *
 * Pipeline order (smooth look→look):
 * 1) Build takeJobs + exit list (no AMCP).
 * 2) Exit layers: batched MIXER OPACITY→0 DEFER + channel COMMIT (starts outgoing fade). Chunks use
 *    `skipMixerPreCommit` so pre-batch channel COMMIT cannot flush a subset of DEFER lines.
 * 3) Incoming: LOADBG → batched MIXER … DEFER for all layers (fill/effects) → clear old PIP → new PIP (MIXER … DEFER) →
 *    PLAY → one channel COMMIT (atomic incoming look).
 * 4) Wait only remaining time until exit-fade window completes, then batched STOP/CLEAR/PIP + COMMIT.
 * LOADBG/PLAY stay `_send` (not inside BEGIN…COMMIT) so Caspar can resolve each layer reliably.
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const { param, deferMixerAmcpLine, amcpVerboseTrace } = require('../caspar/amcp-utils')
const { diffCasparLayerPlan } = require('../caspar/amcp-layer-diff-plan')
const { describeClipCommandPlan } = require('../caspar/amcp-command-plan')
const { getResolvedFillForSceneLayer } = require('./scene-native-fill')
const { audioRouteToAudioFilter } = require('./audio-route')
const { mixerEffectNeutralLines } = require('./timeline-playback-helpers')
const {
	buildPipOverlayAmcpLinesAll,
	buildPipOverlayOpacityFadeDeferLines,
	buildPipOverlayRemoveLines,
	buildPipOverlayRemoveLinesForTakeJobSet,
	nextPipContentLayerInScene,
	nextPipContentLayerInTake,
	pipOverlaysFromLayer,
	sendPipOverlayLinesSerial,
	buildGlobalBorderAmcpLines,
	buildGlobalBorderUpdateLines,
	buildGlobalBorderOpacityFadeLine,
	buildGlobalBorderClearLines,
} = require('./pip-overlay')

const GLOBAL_BORDER_LAYER = 998

const { buildTakeJobs } = require('./scene-take-lbg-jobs')

function logPlannedCommand(self, phase, sceneLayer, plan) {
	if (!amcpVerboseTrace() || typeof self?.log !== 'function' || !plan) return
	const d = describeClipCommandPlan(plan)
	self.log(
		'debug',
		`AMCP plan ${phase} sceneLayer=${sceneLayer} ch=${d.channel} layer=${d.layer} cmd=${d.commandName}` +
			(d.clip ? ` clip=${d.clip}` : '') +
			(d.transition ? ` transition=${d.transition} duration=${d.duration || 0} tween=${d.tween || 'linear'}` : '') +
			(d.seek != null ? ` seek=${d.seek}` : '') +
			(d.length != null ? ` length=${d.length}` : '')
	)
}

/**
 * @param {object} amcp
 * @param {{ self: object, channel: number, currentScene: object|null, incomingScene: object, framerate?: number, forceCut?: boolean, onProgramTransitionStarted?: Function }} opts
 */
async function runSceneTakeLbg(amcp, opts) {
	const {
		diffScenes,
		layerHasContent,
		normalizeTransition,
		physicalProgramLayer,
		normalizeProgramLayerBank,
		layerVisuallyEqual,
		resolveChannelFramerateForMixerTween,
		persistProgramLayerBanks,
	} = require('./scene-transition')

	const self = opts.self
	const channel = parseInt(opts.channel, 10)
	if (!channel || channel < 1) throw new Error('channel required')
	const incoming = opts.incomingScene
	if (!incoming || !Array.isArray(incoming.layers)) throw new Error('incomingScene.layers required')
	const layersWithContent = incoming.layers.filter(layerHasContent)
	if (layersWithContent.length === 0) {
		throw new Error('incomingScene has no layers with sources — cannot take an empty look')
	}

	const forceCut = !!opts.forceCut
	const globalT = normalizeTransition(incoming.defaultTransition, forceCut)
	const diff = diffScenes(opts.currentScene || null, incoming)

	const currentMap = new Map()
	for (const l of opts.currentScene?.layers || []) {
		if (layerHasContent(l)) currentMap.set(l.layerNumber, l)
	}

	const chKey = String(channel)
	if (!self.programLayerBankByChannel) self.programLayerBankByChannel = {}
	const activeBank = normalizeProgramLayerBank(self.programLayerBankByChannel[chKey])
	const inactiveBank = activeBank === 'a' ? 'b' : 'a'
	const phys = (sceneLn, bank) => physicalProgramLayer(sceneLn, bank)

	const fadeWatcher = self.clipEndFadeWatcher || null
	if (fadeWatcher) fadeWatcher.cancelChannel(channel)

	const framerate = resolveChannelFramerateForMixerTween(self, channel, opts.framerate)
	const incomingSorted = [...layersWithContent].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))

	const exitCandidates = [...(diff.exit || [])]
	for (const updatedIncoming of diff.update || []) {
		const prev = currentMap.get(updatedIncoming.layerNumber)
		if (layerHasContent(prev)) exitCandidates.push(prev)
	}

	if (self.timelineEngine) {
		const pbNow = self.timelineEngine.getPlayback()
		if (pbNow?.timelineId) {
			const exitingTimeline = diff.exit.find((l) => layerHasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId)
			if (exitingTimeline) {
				self.timelineEngine.stop(pbNow.timelineId)
			}
		}
	}

	const fadeDur = forceCut || globalT.duration <= 0 ? 0 : globalT.duration
	const fadeTw = globalT.tween
	const fadeMs = fadeDur > 0 ? (fadeDur / framerate) * 1000 : 0
	const shouldRunBankCrossfade = fadeDur > 0 && currentMap.size > 0
	let fadeClockStart = null
	let transitionStartedNotified = false
	function notifyProgramTransitionStarted() {
		if (transitionStartedNotified) return
		transitionStartedNotified = true
		if (typeof opts.onProgramTransitionStarted !== 'function') return
		try {
			const r = opts.onProgramTransitionStarted()
			if (r && typeof r.catch === 'function') {
				r.catch((e) => self.log?.('warn', `[scene-take-lbg] transition-start callback failed: ${e?.message || e}`))
			}
		} catch (e) {
			self.log?.('warn', `[scene-take-lbg] transition-start callback failed: ${e?.message || e}`)
		}
	}

	self.log?.('info', `[scene-take-lbg] shouldRunBankCrossfade=${shouldRunBankCrossfade} fadeDur=${fadeDur} currentMapSize=${currentMap.size}`)

	const { takeJobs, extraExitCandidates } = await buildTakeJobs({
		incomingSorted,
		currentMap,
		channel,
		incoming,
		self,
		phys,
		inactiveBank,
		shouldRunBankCrossfade,
		forceCut,
		globalT,
		framerate,
	})

	if (extraExitCandidates && extraExitCandidates.length > 0) {
		exitCandidates.push(...extraExitCandidates)
	}

	const seenExitLayerNums = new Set()
	const exitMedia = exitCandidates.filter((l) => {
		if (!layerHasContent(l) || String(l.source?.type || '') === 'timeline') return false
		const ln = Number(l.layerNumber)
		if (!Number.isFinite(ln)) return true
		if (seenExitLayerNums.has(ln)) return false
		seenExitLayerNums.add(ln)
		return true
	})

	const currentSceneLayers = opts.currentScene?.layers

	if (exitMedia.length > 0 && fadeDur > 0 && !shouldRunBankCrossfade) {
		const fadeLines = []
		for (const layer of exitMedia) {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
			const cl = `${channel}-${pOut}`
			let p = `0 ${fadeDur}`
			if (fadeTw) p += ` ${param(fadeTw)}`
				fadeLines.push(`MIXER ${cl} OPACITY ${p}`)
			try {
				const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
				const pipN = pipOverlaysFromLayer(layer).length
				if (pipN > 0) {
					fadeLines.push(...buildPipOverlayOpacityFadeDeferLines(channel, pOut, p, nextL, pipN))
				}
			} catch (_) {}
		}
		try {
			await amcp.batchSendChunked(fadeLines, { skipMixerPreCommit: true })
			await amcp.mixerCommit(channel)
		} catch (_) {}
		fadeClockStart = Date.now()
		notifyProgramTransitionStarted()
	} else if (exitMedia.length > 0) {
		for (const layer of exitMedia) {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			if (fadeWatcher) fadeWatcher.cancel(channel, pOut)
		}
	}

	// Global border (layer 998) lifecycle is computed before takeJobs so the teardown
	// block can also act when only the border changes (no media swap). See WO-09.
	const currentGb = opts.currentScene?.globalBorder
	const incomingGb = incoming.globalBorder
	const currentGbEnabled = !!(currentGb && currentGb.enabled)
	const incomingGbEnabled = !!(incomingGb && incomingGb.enabled)
	const sameGbTemplateType =
		currentGbEnabled &&
		incomingGbEnabled &&
		String(currentGb.type || '').toLowerCase() === String(incomingGb.type || '').toLowerCase()
	const gbCanFadeWithCrossfade = shouldRunBankCrossfade && fadeDur > 0 && !forceCut
	const gbWillFadeIn = incomingGbEnabled && !sameGbTemplateType && gbCanFadeWithCrossfade
	const gbWillFadeOut = currentGbEnabled && !incomingGbEnabled && gbCanFadeWithCrossfade

	if (takeJobs.length > 0) {
		for (const job of takeJobs) {
			await amcp.mixerClear(channel, job.pLayer).catch(() => {})
			if (job.loadPlan) {
				logPlannedCommand(self, 'load', job.layer.layerNumber, job.loadPlan)
				await amcp.loadbg(job.loadPlan.channel, job.loadPlan.layer, job.loadPlan.clip, job.loadPlan.opts)
			}
		}

		const flatMixer = takeJobs.flatMap((j) => j.mixerLines)
		if (flatMixer.length > 0) {
			await amcp.batchSendChunked(flatMixer, { skipMixerPreCommit: true })
		}
		const prePlayOpacityLines = takeJobs.map((j) => j.prePlayOpacityZeroLine).filter(Boolean)
		if (prePlayOpacityLines.length > 0) {
			await amcp.batchSendChunked(prePlayOpacityLines, { skipMixerPreCommit: true })
		}

		let pipRemoveLines = []
		try {
			pipRemoveLines = buildPipOverlayRemoveLinesForTakeJobSet(channel, takeJobs, currentSceneLayers)
		} catch (_) {}
		if (pipRemoveLines.length > 0) {
			try {
				await sendPipOverlayLinesSerial(amcp, pipRemoveLines)
			} catch (_) {}
		}

		const pipAddLines = []
		for (const job of takeJobs) {
			if (job.pipOverlays.length > 0) {
				try {
					const lines = buildPipOverlayAmcpLinesAll(
						job.pipOverlays,
						channel,
						job.pLayer,
						job.f,
						self,
						nextPipContentLayerInTake(takeJobs, job.pLayer),
						currentMap.get(job.layer.layerNumber) || null
					)
					if (lines.length > 0) pipAddLines.push(...lines)
				} catch (e) {
					self.log?.('warn', `PIP overlay layer ${job.pLayer}: ${e?.message || e}`)
				}
			}
		}
		if (pipAddLines.length > 0) {
			try {
				await sendPipOverlayLinesSerial(amcp, pipAddLines)
			} catch (_) {}
		}

		// Global border (layer 998) lifecycle — must ride the same channel COMMIT/crossfade
		// as the bank swap so it doesn't pop on/off when looks transition. See WO-09.
		if (incomingGbEnabled) {
			try {
				let borderLines = []
				if (sameGbTemplateType) {
					// Same template → CG UPDATE so params (color/width/etc.) change without re-adding the CG instance.
					borderLines = buildGlobalBorderUpdateLines(channel, GLOBAL_BORDER_LAYER, incomingGb)
				} else {
					// Fresh add (or template type changed): load hidden when crossfading, full-opacity when cutting.
					borderLines = buildGlobalBorderAmcpLines(channel, GLOBAL_BORDER_LAYER, incomingGb, self, {
						initialOpacity: gbWillFadeIn ? 0 : 1,
					})
				}
				if (borderLines.length > 0) {
					await sendPipOverlayLinesSerial(amcp, borderLines)
				}
			} catch (e) {
				self.log?.('warn', `Global border failed: ${e?.message || e}`)
			}
		}
		let crossfadeLines = []
		if (shouldRunBankCrossfade) {
			const handledOut = new Set()
			for (const job of takeJobs) {
				const pOut = phys(Number(job.layer.layerNumber), activeBank)
				const pIn = job.pLayer
				handledOut.add(pOut)
				if (pIn === pOut) {
					// Defensive: incoming should be prepared on the inactive bank, but
					// never fade a layer against itself if state is corrupt.
					continue
				}
				// Deterministic dissolve: always ramp incoming up and paired outgoing down.
				if (!job.useLoadAuto) {
					const clIn = `${channel}-${pIn}`
					let pInTail = `${job.targetOpacity} ${fadeDur}`
					if (fadeTw) pInTail += ` ${param(fadeTw)}`
					crossfadeLines.push(`MIXER ${clIn} OPACITY ${pInTail}`)
				}

				const clOut = `${channel}-${pOut}`
				let pOutTail = `0 ${fadeDur}`
				if (fadeTw) pOutTail += ` ${param(fadeTw)}`
				crossfadeLines.push(`MIXER ${clOut} OPACITY ${pOutTail}`)
			}
			for (const layer of exitMedia) {
				const pOut = phys(Number(layer.layerNumber), activeBank)
				if (handledOut.has(pOut)) continue
				const clOut = `${channel}-${pOut}`
				let p = `0 ${fadeDur}`
				if (fadeTw) p += ` ${param(fadeTw)}`
				crossfadeLines.push(`MIXER ${clOut} OPACITY ${p}`)
			}
			// Tween the global border in sync with the bank crossfade so it never cuts in/out.
			if (gbWillFadeIn) {
				crossfadeLines.push(
					buildGlobalBorderOpacityFadeLine(channel, GLOBAL_BORDER_LAYER, 1, fadeDur, fadeTw ? param(fadeTw) : undefined)
				)
			} else if (gbWillFadeOut) {
				crossfadeLines.push(
					buildGlobalBorderOpacityFadeLine(channel, GLOBAL_BORDER_LAYER, 0, fadeDur, fadeTw ? param(fadeTw) : undefined)
				)
			}
		}
		try {
			await amcp.mixerCommit(channel)
		} catch (_) {}

		const needsIncomingFadePreroll = shouldRunBankCrossfade && takeJobs.some((j) => j.incomingStartsHidden)
		const prebufferMs = needsIncomingFadePreroll ? 180 : 80
		await new Promise((r) => setTimeout(r, prebufferMs))

		const playLinesForCrossfade = []
		if (crossfadeLines.length > 0) {
			for (const job of takeJobs) {
				if (!job.playPlan) continue
				logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
				playLinesForCrossfade.push(`PLAY ${job.playPlan.channel}-${job.playPlan.layer}`)
				if (job.incomingStartsHidden) {
					playLinesForCrossfade.push(`MIXER ${job.playPlan.channel}-${job.playPlan.layer} OPACITY 0 0`)
				}
			}
		} else {
			for (const job of takeJobs) {
				if (job.playPlan) {
					logPlannedCommand(self, 'play', job.layer.layerNumber, job.playPlan)
					await amcp.play(job.playPlan.channel, job.playPlan.layer, job.playPlan.clip, job.playPlan.opts)
				}
			}
		}
		if (crossfadeLines.length > 0) {
			try {
				await amcp.batchSendChunked([...playLinesForCrossfade, ...crossfadeLines], { skipMixerPreCommit: true })
				await amcp.mixerCommit(channel)
				fadeClockStart = Date.now()
				notifyProgramTransitionStarted()
			} catch (_) {}
		} else if (shouldRunBankCrossfade) {
			fadeClockStart = Date.now()
			notifyProgramTransitionStarted()
		}

		for (const job of takeJobs) {
			try {
				playbackTracker.recordPlay(self, channel, job.pLayer, job.clip, { loop: !!job.layer.loop })
			} catch (_) {}

			const foe = job.layer.fadeOnEnd
			if (fadeWatcher && foe?.enabled && !job.layer.loop) {
				const fadeFr = foe.frames || 12
				let durationMs = playbackTracker.resolveClipDurationMs(self, job.clip)
				if (!durationMs || durationMs <= 0) {
					durationMs = await playbackTracker.resolveClipDurationMsWithDiskProbe(self, job.clip)
				}
				if (durationMs && durationMs > 0) {
					fadeWatcher.schedule(channel, job.pLayer, durationMs, fadeFr, framerate)
				} else {
					const oscDelay = playbackTracker.getOscClipEndFadeDelayMs(
						self,
						channel,
						job.pLayer,
						job.clip,
						fadeFr,
						framerate,
					)
					if (oscDelay != null && Number.isFinite(oscDelay)) {
						fadeWatcher.scheduleMidPlayback(channel, job.pLayer, oscDelay, fadeFr, framerate)
					} else {
						fadeWatcher.scheduleWithOscFallback(
							self,
							channel,
							job.pLayer,
							job.clip,
							fadeFr,
							framerate,
							() =>
								playbackTracker.getOscClipEndFadeDelayMs(
									self,
									channel,
									job.pLayer,
									job.clip,
									fadeFr,
									framerate,
								),
						)
					}
				}
			}
		}
	}

	// Border-only teardown path: when the new look removes the border and there's no exit
	// media to anchor the wait, still respect the crossfade clock before clearing the CG.
	const needsBorderOnlyTeardown = currentGbEnabled && !incomingGbEnabled && exitMedia.length === 0
	if (exitMedia.length > 0 || needsBorderOnlyTeardown) {
		let teardownWait = 0
		if (fadeClockStart != null && fadeDur > 0) {
			teardownWait = Math.max(0, fadeMs - (Date.now() - fadeClockStart))
		}
		if (teardownWait > 0) {
			await new Promise((r) => setTimeout(r, Math.ceil(teardownWait) + 5))
		}

		const teardownLines = []
		for (const layer of exitMedia) {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			const cl = `${channel}-${pOut}`
			teardownLines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
			try {
				const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
				const pipN = pipOverlaysFromLayer(layer).length
				if (pipN > 0) {
					teardownLines.push(...buildPipOverlayRemoveLines(channel, pOut, nextL, pipN))
				}
			} catch (_) {}
			try {
				playbackTracker.recordStop(self, channel, pOut)
			} catch (_) {}
		}

		// Border was on the previous look but not the new one — opacity tween (if any) is done,
		// so the CG and mixer slot are safe to free now.
		if (currentGbEnabled && !incomingGbEnabled) {
			teardownLines.push(...buildGlobalBorderClearLines(channel, GLOBAL_BORDER_LAYER))
		}

		if (teardownLines.length > 0) {
			try {
				await sendPipOverlayLinesSerial(amcp, teardownLines)
			} catch (_) {}
		}
		try {
			await amcp.mixerCommit(channel)
		} catch (_) {}
	}

	if (takeJobs.length > 0) {
		self.programLayerBankByChannel[chKey] = inactiveBank
	}
	persistProgramLayerBanks(self)

	return {
		ok: true,
		takeMode: 'lbg',
		diff: {
			update: diff.update.length,
			enter: diff.enter.length,
			exit: diff.exit.length,
			unchanged: diff.unchanged.length,
		},
	}
}

module.exports = { runSceneTakeLbg }
