'use strict'

const dmxnet = require('dmxnet')

class ArtnetReceiver {
	constructor(appCtx) {
		this.appCtx = appCtx
		this.log = appCtx.log || console.log
		this.artnet = null
		this.receiver = null
		this.lastData = null
	}

	init(options = {}) {
		if (this.artnet) return
		
		try {
			this.artnet = new dmxnet.dmxnet({
				log: { level: 'error' },
				...options
			})

			const universe = options.universe || 0
			this.receiver = this.artnet.newReceiver({
				universe: universe
			})

			this.receiver.on('data', (data) => {
				this.handleData(data)
			})

			this.log('info', `[ArtNet] Receiver started on universe ${universe}`)
		} catch (e) {
			this.log('error', `[ArtNet] Failed to start receiver: ${e.message}`)
		}
	}

	handleData(data) {
		if (!data || data.length === 0) return

		if (this.lastData && this._isEqual(this.lastData, data)) {
			return
		}
		
		this.log('info', `[ArtNet] Received data change (first 10 channels: ${data.slice(0, 10).join(',')})`)
		this.lastData = [...data]

		const liveSceneState = require('../state/live-scene-state')
		const channel = 1 // default channel for now
		const live = liveSceneState.getChannel(channel)
		
		if (!live || !live.scene) return
		const scene = live.scene
		const gb = scene.globalBorder
		
		if (!gb || !gb.enabled) return
		
		const patch = gb.artnetPatch || { startChannel: 1, universe: 0 }
		const start = (patch.startChannel || 1) - 1 // DMX is 1-based, array is 0-based
		
		const params = { ...gb.params, side: 'inside' } // start with defaults and enforce inside
		
		// Helper to get hex color from 3 channels
		const getHex = (r, g, b) => `#${this._toHex(r)}${this._toHex(g)}${this._toHex(b)}`

		// Fixed 15-channel mapping
		
		// 1. On/Off
		if (start >= 0 && start < data.length) {
			params.enabled = data[start] >= 128
		}
		
		// 2. Type
		if (start + 1 >= 0 && start + 1 < data.length) {
			const val = data[start + 1]
			if (val < 64) params.type = 'border'
			else if (val < 128) params.type = 'glow'
			else if (val < 192) params.type = 'edge_strip'
			else params.type = 'shadow'
		}
		
		// 3. Opacity
		if (start + 2 >= 0 && start + 2 < data.length) {
			params.opacity = data[start + 2] / 255
		}
		
		// 4-6. Color (RGB)
		if (start + 5 >= 0 && start + 5 < data.length) {
			params.color = getHex(data[start + 3], data[start + 4], data[start + 5])
		}
		
		// 7. Width / Thickness / Intensity
		if (start + 6 >= 0 && start + 6 < data.length) {
			const val = data[start + 6]
			params.width = (val / 255) * 50
			params.intensity = (val / 255) * 50 // map to both width and intensity
		}
		
		// 8. Speed
		if (start + 7 >= 0 && start + 7 < data.length) {
			params.speed = 0.1 + (data[start + 7] / 255) * 9.9
		}
		
		// 9. Spread / Blur
		if (start + 8 >= 0 && start + 8 < data.length) {
			params.spread = (data[start + 8] / 255) * 20
			params.blur = (data[start + 8] / 255) * 50
		}
		
		// 10-12. Glow Color (RGB)
		if (start + 11 >= 0 && start + 11 < data.length) {
			params.glowColor = getHex(data[start + 9], data[start + 10], data[start + 11])
		}
		
		// 13. Radius
		if (start + 12 >= 0 && start + 12 < data.length) {
			params.radius = (data[start + 12] / 255) * 50
		}
		
		// 14. Count
		if (start + 13 >= 0 && start + 13 < data.length) {
			params.count = Math.floor((data[start + 13] / 255) * 12) + 1
		}
		
		// 15. Length
		if (start + 14 >= 0 && start + 14 < data.length) {
			params.length = 5 + (data[start + 14] / 255) * 95
		}

		// If disabled via DMX, force opacity to 0 to hide it
		if (params.enabled === false) {
			params.opacity = 0
		}

		this.log('debug', `[ArtNet] Dynamic Border update: ${JSON.stringify(params)}`)

		// Update state so UI reflects changes
		gb.params = params
		liveSceneState.setChannel(channel, live)
		liveSceneState.broadcastSceneLive(this.appCtx)

		// Trigger update to CasparCG
		this.updateBorder(params)
	}

	updateBorder(params) {
		const amcp = this.appCtx.amcp
		if (!amcp?.isConnected) {
			this.log('warn', '[ArtNet] Cannot update border, AMCP not connected')
			return
		}

		// Target layer 998 on channel 1 (default)
		// In a full implementation, the channel should be configurable or mapped to screens.
		const channel = 1 
		const layer = 998

		// Build the CG UPDATE command
		// Reusing the template name 'pip_border' as seen in WO-25
		const templateName = 'pip_border'
		
		// The template expects JSON parameters.
		// From WO-25: { width, color, radius, opacity, style, gradientEnd }
		const jsonPayload = JSON.stringify(params)

		// AMCP command: CG channel-layer UPDATE 1 json
		// Wait, WO-25 says: CG 1-110 ADD 0 "pip_border" 1 <data>
		// And for update: CG 1-110 UPDATE 1 <data>
		// Let's assume we need to send the JSON string.
		
		const cmd = `CG ${channel}-${layer} UPDATE 1 ${jsonPayload}`
		
		amcp.raw(cmd).catch(e => {
			this.log('error', `[ArtNet] Failed to send CG UPDATE: ${e.message}`)
		})
	}

	_toHex(val) {
		const hex = Math.max(0, Math.min(255, Math.round(val))).toString(16)
		return hex.length === 1 ? '0' + hex : hex
	}

	_isEqual(arr1, arr2) {
		if (arr1.length !== arr2.length) return false
		for (let i = 0; i < arr1.length; i++) {
			if (arr1[i] !== arr2[i]) return false
		}
		return true
	}

	stop() {
		this.receiver = null
		this.artnet = null
		this.log('info', '[ArtNet] Receiver stopped')
	}
}

module.exports = { ArtnetReceiver }
