'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('highascg', {
	pickIso: () => ipcRenderer.invoke('pick-iso'),
	pickApp: () => ipcRenderer.invoke('pick-app'),
	usbCommands: (iso, app) => ipcRenderer.invoke('usb-commands', { iso, app }),
	simCommands: (app) => ipcRenderer.invoke('sim-commands', { app }),
	runSim: (app) => ipcRenderer.invoke('run-sim', { app }),
	copyText: (text) => ipcRenderer.invoke('copy-text', text),
})
