import * as audioMixerState from './audio-mixer-state.js'
import { isMediaOrFileSource } from '../components/scenes-shared.js'
import { shortenMediaName } from './audio-mixer-ui.js'

/**
 * Build master + layer fader rows for program channels.
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {{ masterLabel: (ch: number, index: number) => string, labelMax?: number, labelTailChars?: number }} options
 */
export function collectProgramAudioRows(stateStore, { masterLabel, labelMax = 22, labelTailChars = 3 }) {
	const cm = stateStore.getState()?.channelMap || {}
	const programChannels =
		Array.isArray(cm.programChannels) && cm.programChannels.length > 0 ? cm.programChannels : [1]

	const rows = []
	programChannels.forEach((ch, i) => {
		const key = `pgm:${ch}`
		const v = audioMixerState.getMasterVolume(key)
		rows.push({ key, ch, label: masterLabel(ch, i), v, isMaster: true })

		const liveScenes = stateStore.getState()?.scene?.live || {}
		const liveSceneData = liveScenes[ch] || liveScenes[String(ch)]
		if (liveSceneData?.scene?.layers) {
			liveSceneData.scene.layers.forEach((layer) => {
				if (isMediaOrFileSource(layer.source)) {
					const ln = layer.layerNumber
					const fullName = String(layer.source.value || '').split('/').pop() || ''
					const shortName = shortenMediaName(fullName, { max: labelMax, tailChars: labelTailChars })
					const lKey = `pgm:${ch}:layer:${ln}`
					rows.push({
						key: lKey,
						ch,
						layer: ln,
						label: `L${ln} · ${shortName}`,
						labelTitle: `L${ln}: ${fullName}`,
						v: layer.volume != null ? layer.volume : 1,
						muted: !!layer.muted,
						isMaster: false,
						audioRoute: layer.audioRoute || '1+2',
						sceneId: liveSceneData.sceneId,
					})
				}
			})
		}
	})

	return {
		programChannels,
		rows,
		mastersList: rows.filter((r) => r.isMaster),
		inputsList: rows.filter((r) => !r.isMaster),
	}
}