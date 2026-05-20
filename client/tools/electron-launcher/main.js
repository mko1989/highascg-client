const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, execFileSync } = require('child_process')

let mainWindow = null
let simProcess = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    title: 'HighAsCG Operator Panel & Launcher',
    icon: path.join(__dirname, 'icon.png'), // Fallback if no icon
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
    cleanupSimulation()
  })
}

function cleanupSimulation() {
  if (simProcess) {
    console.log('[Electron Main] Killing active simulation process...')
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', simProcess.pid, '/f', '/t'])
      } else {
        simProcess.kill('SIGINT')
        setTimeout(() => {
          if (simProcess) {
            simProcess.kill('SIGKILL')
          }
        }, 1000)
      }
    } catch (e) {
      console.error('[Electron Main] Error killing sim process:', e)
    }
    simProcess = null
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  cleanupSimulation()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC Handlers
ipcMain.on('open-external-url', (event, url) => {
  shell.openExternal(url)
})

ipcMain.on('start-sim', (event, { port, offlineMode }) => {
  if (simProcess) {
    event.reply('sim-log', '[Launcher] Simulation is already running!\n')
    return
  }

  event.reply('sim-log', '[Launcher] Preparing to launch simulation...\n')

  const repoRoot = path.resolve(__dirname, '../../..')
  const launcherScript = path.join(repoRoot, 'client/tools/portable-desktop/launch-sim-from-exfat.js')

  event.reply('sim-log', `[Launcher] App root detected: ${repoRoot}\n`)
  event.reply('sim-log', `[Launcher] Simulation helper: ${launcherScript}\n`)

  const env = {
    ...process.env,
    HIGHASCG_LAUNCH_NO_BROWSER: '1', // We want Electron launcher to control browser open
    HIGHASCG_OFFLINE_MODE: offlineMode ? '1' : '0',
    HTTP_PORT: String(port)
  }

  try {
    simProcess = spawn(process.execPath, [launcherScript], {
      cwd: repoRoot,
      env: env
    })

    simProcess.stdout.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('sim-log', data.toString())
      }
    })

    simProcess.stderr.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('sim-log', data.toString())
      }
    })

    simProcess.on('error', (err) => {
      if (mainWindow) {
        mainWindow.webContents.send('sim-log', `[Launcher Error] Spawn failed: ${err.message}\n`)
        mainWindow.webContents.send('sim-status', { running: false, error: err.message })
      }
      simProcess = null
    })

    simProcess.on('exit', (code, signal) => {
      if (mainWindow) {
        mainWindow.webContents.send('sim-log', `[Launcher] Simulation process exited with code ${code} ${signal ? `(signal: ${signal})` : ''}\n`)
        mainWindow.webContents.send('sim-status', { running: false, code })
      }
      simProcess = null
    })

    event.reply('sim-status', { running: true })
  } catch (err) {
    event.reply('sim-log', `[Launcher Error] Exception: ${err.message}\n`)
    event.reply('sim-status', { running: false, error: err.message })
    simProcess = null
  }
})

ipcMain.on('stop-sim', (event) => {
  cleanupSimulation()
  event.reply('sim-status', { running: false })
  event.reply('sim-log', '[Launcher] Simulation stopped by user.\n')
})

function checkWindowsVolume(label) {
  const esc = String(label).replace(/'/g, "''")
  const ps = `Get-Volume | Where-Object FileSystemLabel -eq '${esc}' | Select-Object -First 1 | ForEach-Object { $_.DriveLetter }`
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    }).trim()
    const letter = out.split(/\s+/).filter(Boolean)[0]
    if (letter && /^[A-Za-z]$/.test(letter)) {
      return `${letter.toUpperCase()}:`
    }
  } catch (_) {}
  return null
}

ipcMain.handle('check-usb-status', async () => {
  const label = 'HIGHASCGEXF'
  const platform = process.platform
  let mountedPath = null

  if (platform === 'darwin') {
    const vol = path.join('/Volumes', label)
    if (fs.existsSync(vol) && fs.statSync(vol).isDirectory()) mountedPath = vol
  } else if (platform === 'win32') {
    mountedPath = checkWindowsVolume(label)
  } else if (platform === 'linux') {
    const u = os.userInfo().username
    const tries = [
      path.join('/media', u, label),
      path.join('/run/media', u, label),
      path.join('/mnt', label),
    ]
    for (const t of tries) {
      if (fs.existsSync(t) && fs.statSync(t).isDirectory()) {
        mountedPath = t
        break
      }
    }
    if (!mountedPath) {
      try {
        const out = execFileSync('findmnt', ['-n', '-o', 'TARGET', `-L${label}`], {
          encoding: 'utf8',
          timeout: 2000,
        }).trim()
        if (out && fs.existsSync(out)) mountedPath = out
      } catch (_) {}
    }
  }

  if (mountedPath) {
    const simDir = path.join(mountedPath, 'sim/highascg')
    const hasSim = fs.existsSync(simDir) && fs.existsSync(path.join(simDir, 'package.json'))
    return {
      mounted: true,
      path: mountedPath,
      hasPayload: hasSim,
      payloadPath: simDir
    }
  }

  return {
    mounted: false
  }
})
