/**
 * Default empty project — shared by New project, factory reset, and server bootstrap fallbacks.
 */
import { api } from './api-client.js'
import { defaultTransition } from './scene-state-helpers.js'
import { projectState } from './project-state.js'
import { sceneState } from './scene-state.js'
import { timelineState } from './timeline-state.js'
import { multiviewState } from './multiview-state.js'
import { programOutputState } from './program-output-state.js'
import { projectFileIdFromName } from './project-files.js'
import { markLocalProjectSaved } from './project-remote-sync.js'
import { markServerProjectSynced } from './server-project-sync.js'
import { getAppWs } from './app-runtime.js'
import { flushSceneDeckSync } from './app-scene-deck.js'

export const DEFAULT_PROJECT_NAME = 'Untitled'
const PROJECT_VERSION = 2

/** @returns {object} Scene export blob for an empty deck. */
export function buildDefaultSceneExportData() {
	return {
		scenes: [],
		liveSceneId: null,
		previewSceneId: null,
		liveSceneIdByMain: [null, null, null, null],
		previewSceneIdByMain: [null, null, null, null],
		activeScreenIndex: 0,
		globalDefaultTransition: { ...defaultTransition() },
		mainEditorVisible: [true, true, true, true],
		layerPresets: [],
		lookPresets: [],
		globalBorders: [null, null, null, null],
	}
}

/** @returns {object} Full project JSON for an empty Untitled project. */
export function buildDefaultUntitledProject() {
	return {
		version: PROJECT_VERSION,
		name: DEFAULT_PROJECT_NAME,
		savedAt: new Date().toISOString(),
		scenes: buildDefaultSceneExportData(),
		timelines: { timelines: [], activeId: null },
		multiview: {
			cells: [],
			canvasWidth: 1920,
			canvasHeight: 1080,
			showOverlay: true,
			bgColor: '#000000',
			showTimersUnderLabels: false,
		},
	}
}

/**
 * Replace in-memory project with empty Untitled (looks, timelines, multiview, program strip).
 * @param {{ silent?: boolean, emitLoaded?: boolean }} [opts]
 */
export function applyDefaultUntitledProjectLocally(opts = {}) {
	const { silent = false, emitLoaded = true } = opts
	projectState.setProjectName(DEFAULT_PROJECT_NAME)
	sceneState.loadFromData(buildDefaultSceneExportData(), { silent })
	sceneState.setEditingScene(null)
	timelineState.loadFromData({ timelines: [], activeId: null }, { silent })
	multiviewState.loadFromData(
		{
			cells: [],
			canvasWidth: 1920,
			canvasHeight: 1080,
			showOverlay: true,
			bgColor: '#000000',
			showTimersUnderLabels: false,
		},
		{ silent },
	)
	programOutputState.resetForNewProject({ silent })
	if (emitLoaded) window.dispatchEvent(new Event('project-loaded'))
}

/**
 * Persist empty Untitled project to the playout server and sync deck metadata.
 * @returns {Promise<object>} saved project payload
 */
export async function saveDefaultUntitledProjectToServer(opts = {}) {
	const { silent = true } = opts
	applyDefaultUntitledProjectLocally({ silent, emitLoaded: false })
	const project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
	project.name = DEFAULT_PROJECT_NAME
	const id = projectFileIdFromName(project.name)
	await api.post('/api/project/save', { project, id })
	markLocalProjectSaved()
	markServerProjectSynced()
	const appWs = getAppWs()
	if (appWs) flushSceneDeckSync(appWs, sceneState)
	window.dispatchEvent(new Event('project-loaded'))
	return project
}

/**
 * Factory reset: server config wipe + empty Untitled project (clears all looks).
 */
export async function performFactoryReset() {
	await api.post('/api/config/reset', { reset: true })
	await saveDefaultUntitledProjectToServer()
}
