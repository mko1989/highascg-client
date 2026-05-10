/**
 * Stream Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'

/**
 * @param {string} title
 * @returns {HTMLDivElement}
 */
function streamSection(title) {
	const box = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-stream-section',
	})
	box.style.display = 'flex'
	box.style.flexDirection = 'column'
	box.style.gap = '0.35rem'
	if (title) {
		box.appendChild(
			Object.assign(document.createElement('span'), {
				className: 'device-view__note',
				textContent: title,
			})
		)
	}
	return box
}

export function renderStreamOutControls(h, conn, { currentSettings, streamingStatus, statusEl, load, setCasparRestartDirty, onRemoveStreamOutput }) {
	const wrapCtl = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const caspar = conn?.caspar && typeof conn.caspar === 'object' ? conn.caspar : {}
	const streamType = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	streamType.innerHTML = '<option value="ndi">NDI</option><option value="rtmp">RTMP</option><option value="srt">SRT</option><option value="udp">UDP</option>'
	streamType.value = String(caspar.type || 'rtmp').toLowerCase()

	const nameIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'name / label',
		value: String(caspar.name || conn?.label || ''),
	})

	const rtmpUrlIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'rtmp://a.rtmp.youtube.com/live2',
		value: String(caspar.rtmpServerUrl || ''),
	})
	const keyIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'stream key',
		value: String(caspar.streamKey || ''),
		autocomplete: 'off',
	})
	const srtUrlIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'srt://0.0.0.0:9000?mode=listener',
		value: String(caspar.srtUrl || ''),
	})
	const udpUrlIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'udp://127.0.0.1:5004',
		value: String(caspar.udpUrl || ''),
	})

	const grpConnRtmp = streamSection('RTMP')
	grpConnRtmp.append(rtmpUrlIn, keyIn)

	const grpConnSrt = streamSection('SRT')
	grpConnSrt.append(srtUrlIn)

	const grpConnUdp = streamSection('UDP / MPEG-TS')
	grpConnUdp.append(udpUrlIn)

	const grpConnNdi = streamSection('')
	const ndiNote = Object.assign(document.createElement('p'), {
		className: 'device-view__note',
		textContent: 'NDI uses the name above for discovery. Apply Caspar config after saving.',
	})
	grpConnNdi.append(ndiNote)

	const qSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	qSel.innerHTML = '<option value="low">low</option><option value="medium">medium</option><option value="high">high</option>'
	qSel.value = String(caspar.quality || 'medium')
	const vCodecSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	vCodecSel.innerHTML = '<option value="h264">h264</option><option value="hevc">hevc</option>'
	vCodecSel.value = String(caspar.videoCodec || 'h264').toLowerCase()
	const vBitrateIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '200',
		step: '100',
		placeholder: 'video kbps',
		value: String(caspar.videoBitrateKbps ?? 4500),
	})
	const presetSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	presetSel.innerHTML =
		'<option value="ultrafast">ultrafast</option><option value="veryfast">veryfast</option><option value="fast">fast</option><option value="medium">medium</option><option value="slow">slow</option>'
	presetSel.value = String(caspar.encoderPreset || 'veryfast').toLowerCase()
	const aCodecSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	aCodecSel.innerHTML = '<option value="aac">aac</option><option value="copy">copy</option><option value="none">none</option>'
	aCodecSel.value = String(caspar.audioCodec || 'aac').toLowerCase()
	const aBitrateIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '32',
		step: '32',
		placeholder: 'audio kbps',
		value: String(caspar.audioBitrateKbps ?? 128),
	})

	const grpEncode = streamSection('Encoding (FFmpeg)')
	grpEncode.append(qSel, vCodecSel, vBitrateIn, presetSel, aCodecSel, aBitrateIn)

	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save stream settings' })
	const startBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Start stream' })
	const stopBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Stop stream' })

	const grpLive = document.createElement('div')
	grpLive.style.display = 'flex'
	grpLive.style.flexWrap = 'wrap'
	grpLive.style.gap = '0.35rem'
	grpLive.append(startBtn, stopBtn)

	const logBox = Object.assign(document.createElement('pre'), {
		className: 'device-view__status',
		style: 'white-space:pre-wrap;max-height:180px;overflow:auto;width:100%;margin-top:6px',
	})
	const logSection = document.createElement('div')
	logSection.appendChild(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Stream log (RTMP quick start)' }))
	logSection.appendChild(logBox)

	const renderStreamLogs = () => {
		const list = Array.isArray(streamingStatus?.rtmp?.logs) ? streamingStatus.rtmp.logs : []
		if (!list.length) {
			logBox.textContent = 'No stream logs yet.'
			return
		}
		const lines = list
			.slice(-20)
			.map((x) => {
				const ts = String(x?.ts || '').replace('T', ' ').replace('Z', '')
				const lvl = String(x?.level || 'info').toUpperCase()
				const msg = String(x?.message || '')
				const extra = x?.extra && typeof x.extra === 'object' ? ` ${JSON.stringify(x.extra)}` : ''
				return `[${ts}] [${lvl}] ${msg}${extra}`
			})
		logBox.textContent = lines.join('\n')
	}

	const updateTypeVisibility = () => {
		const t = String(streamType.value || 'rtmp').toLowerCase()
		grpConnRtmp.style.display = t === 'rtmp' ? '' : 'none'
		grpConnSrt.style.display = t === 'srt' ? '' : 'none'
		grpConnUdp.style.display = t === 'udp' ? '' : 'none'
		grpConnNdi.style.display = t === 'ndi' ? '' : 'none'
		grpEncode.style.display = t === 'ndi' ? 'none' : ''
		grpLive.style.display = t === 'rtmp' ? '' : 'none'
		logSection.style.display = t === 'rtmp' ? '' : 'none'
	}
	updateTypeVisibility()
	streamType.addEventListener('change', updateTypeVisibility)

	const removeBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		type: 'button',
		textContent: 'Remove stream output',
		title: 'Remove this output from settings and clear its cables',
	})

	saveBtn.onclick = async () => {
		const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
		const idx = cur.findIndex((x) => String(x?.id || '') === String(conn.id || ''))
		if (idx < 0) throw new Error('Stream output not found')
		const t = String(streamType.value || 'rtmp').toLowerCase()
		const name = String(nameIn.value || conn?.label || conn.id).trim() || String(conn?.label || conn.id)
		const prev = cur[idx] || {}
		const next = [...cur]
		const readEnc = () => ({
			quality: String(qSel.value || 'medium'),
			videoCodec: String(vCodecSel.value || 'h264').toLowerCase(),
			videoBitrateKbps: Math.max(200, parseInt(String(vBitrateIn.value || '4500'), 10) || 4500),
			encoderPreset: String(presetSel.value || 'veryfast').toLowerCase(),
			audioCodec: String(aCodecSel.value || 'aac').toLowerCase(),
			audioBitrateKbps: Math.max(32, parseInt(String(aBitrateIn.value || '128'), 10) || 128),
		})
		const enc = t === 'ndi' ? {
			quality: String(prev.quality || 'medium'),
			videoCodec: String(prev.videoCodec || 'h264').toLowerCase(),
			videoBitrateKbps: Math.max(200, parseInt(String(prev.videoBitrateKbps ?? 4500), 10) || 4500),
			encoderPreset: String(prev.encoderPreset || 'veryfast').toLowerCase(),
			audioCodec: String(prev.audioCodec || 'aac').toLowerCase(),
			audioBitrateKbps: Math.max(32, parseInt(String(prev.audioBitrateKbps ?? 128), 10) || 128),
		} : readEnc()

		next[idx] = {
			...prev,
			id: String(conn.id),
			type: t,
			name,
			label: t === 'ndi' ? name : String(prev.label || name),
			...enc,
			rtmpServerUrl: t === 'rtmp' ? String(rtmpUrlIn.value || '').trim() : String(prev.rtmpServerUrl || ''),
			streamKey: t === 'rtmp' ? String(keyIn.value || '').trim() : '',
			srtUrl: t === 'srt' ? String(srtUrlIn.value || '').trim() : String(prev.srtUrl || ''),
			udpUrl: t === 'udp' ? String(udpUrlIn.value || '').trim() : String(prev.udpUrl || ''),
		}
		await Actions.saveSettingsPatch({ streamOutputs: next })
		setCasparRestartDirty(true)
		await load()
	}

	startBtn.onclick = async () => {
		try {
			const t = String(streamType.value || 'rtmp').toLowerCase()
			if (t !== 'rtmp') {
				setStatus(statusEl, `Start for ${t.toUpperCase()} is not wired yet. Save settings and apply Caspar config.`, false)
				return
			}
			const cur = Array.isArray(currentSettings?.streamOutputs) ? currentSettings.streamOutputs : []
			const saved = cur.find((x) => String(x?.id || '') === String(conn.id || '')) || {}
			const rtmpServerUrl = String(rtmpUrlIn.value || saved?.rtmpServerUrl || caspar.rtmpServerUrl || '').trim()
			const streamKey = String(keyIn.value || saved?.streamKey || caspar.streamKey || '').trim()
			const quality = String(qSel.value || saved?.quality || caspar.quality || 'medium')
			const videoCodec = String(vCodecSel.value || saved?.videoCodec || caspar.videoCodec || 'h264').toLowerCase()
			const videoBitrateKbps = Math.max(200, parseInt(String(vBitrateIn.value || saved?.videoBitrateKbps || caspar.videoBitrateKbps || '4500'), 10) || 4500)
			const encoderPreset = String(presetSel.value || saved?.encoderPreset || caspar.encoderPreset || 'veryfast').toLowerCase()
			const audioCodec = String(aCodecSel.value || saved?.audioCodec || caspar.audioCodec || 'aac').toLowerCase()
			const audioBitrateKbps = Math.max(32, parseInt(String(aBitrateIn.value || saved?.audioBitrateKbps || caspar.audioBitrateKbps || '128'), 10) || 128)
			if (!rtmpServerUrl) {
				setStatus(statusEl, 'RTMP server URL is empty. Fill it in stream inspector first.', false)
				return
			}
			const sc = currentSettings?.streamingChannel && typeof currentSettings.streamingChannel === 'object'
				? currentSettings.streamingChannel
				: {}
			if (!(sc.enabled === true || sc.enabled === 'true')) {
				await Actions.saveSettingsPatch({ streamingChannel: { ...sc, enabled: true } })
			}
			await Actions.startStreamingChannelRtmp({
				outputId: String(conn.id),
				rtmpServerUrl,
				streamKey,
				quality,
				videoCodec,
				videoBitrateKbps,
				encoderPreset,
				audioCodec,
				audioBitrateKbps,
			})
			setStatus(statusEl, 'Streaming started', true)
			await load()
			renderStreamLogs()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	stopBtn.onclick = async () => {
		try {
			await Actions.stopStreamingChannelRtmp()
			setStatus(statusEl, 'Streaming stopped', true)
			await load()
			renderStreamLogs()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	removeBtn.onclick = async () => {
		if (!onRemoveStreamOutput) return
		if (!confirm(`Remove stream output ${conn.id}?`)) return
		try {
			await onRemoveStreamOutput(String(conn.id || ''))
		} catch (e) {
			setStatus(statusEl, e?.message || String(e), false)
		}
	}

	wrapCtl.append(
		streamType,
		nameIn,
		grpConnRtmp,
		grpConnSrt,
		grpConnUdp,
		grpConnNdi,
		grpEncode,
		saveBtn,
		grpLive,
		removeBtn
	)
	h.append(wrapCtl)
	h.append(logSection)
	renderStreamLogs()
}
