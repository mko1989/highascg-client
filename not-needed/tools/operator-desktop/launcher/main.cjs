'use strict'

const { app, BrowserWindow, dialog, ipcMain, clipboard } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const { generateUsbCommands, generateSimCommands } = require('./recipes.cjs')

const REPO = path.resolve(__dirname, '../../..')
const isDev = process.env.HIGHASCG_LAUNCHER_DEV === '1'

function createWindow() {
	const win = new BrowserWindow({
		width: 600,
		height: 480,
		minWidth: 480,
		minHeight: 400,
		title: 'HighAsCG',
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	})
	win.setMenuBarVisibility(false)
	win.loadFile(path.join(__dirname, 'index.html'))
	if (isDev) win.webContents.openDevTools({ mode: 'detach' })
}

app.whenReady().then(() => {
	createWindow()
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('pick-iso', async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: 'Live ISO',
		properties: ['openFile'],
		filters: [{ name: 'ISO', extensions: ['iso'] }],
	})
	if (canceled || !filePaths[0]) return null
	return filePaths[0]
})

ipcMain.handle('pick-app', async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: 'HighAsCG release (.tar.gz)',
		properties: ['openFile'],
		filters: [{ name: 'tar.gz', extensions: ['tar.gz', 'tgz'] }, { name: 'All', extensions: ['*'] }],
	})
	if (!canceled && filePaths[0]) return filePaths[0]
	const folder = await dialog.showOpenDialog({
		title: 'HighAsCG folder (package.json)',
		properties: ['openDirectory'],
	})
	if (folder.canceled || !folder.filePaths[0]) return null
	return folder.filePaths[0]
})

ipcMain.handle('usb-commands', async (_e, { iso, app }) => {
	return generateUsbCommands(iso, app, REPO)
})

ipcMain.handle('sim-commands', async (_e, { app }) => {
	return generateSimCommands(app, REPO)
})

ipcMain.handle('run-sim', async (_e, { app }) => {
	const commands = generateSimCommands(app, REPO)
	if (!fs.statSync(app).isDirectory()) {
		return { commands, started: false, note: 'Extract tarball first, then Run sim again.' }
	}
	const launcher = path.join(REPO, 'tools/portable-desktop/launch-sim-from-exfat.js')
	const child = spawn(process.execPath, [launcher], {
		cwd: REPO,
		env: { ...process.env, HIGHASCG_EXFAT_APP_ROOT: path.resolve(app) },
		detached: true,
		stdio: 'ignore',
	})
	child.unref()
	return { commands, started: true }
})

ipcMain.handle('copy-text', async (_e, text) => {
	clipboard.writeText(text || '')
})
