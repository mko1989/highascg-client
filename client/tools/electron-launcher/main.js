const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, execFile } = require('child_process')

/** @param {string} file @param {string[]} args @param {import('child_process').ExecFileOptions} opts */
function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}
const http = require('http')
const url = require('url')

let webuiApiOrigin = 'http://127.0.0.1:4200' // Default fallback

// IPC Handler to keep track of the active connection API origin
ipcMain.on('update-api-origin', (event, origin) => {
  webuiApiOrigin = origin
  console.log('[Electron Main] WebUI API Origin updated to:', webuiApiOrigin)
})

const LAUNCHER_DIR = __dirname

function requireLauncherModule(bundledRel, devRel) {
  const bundled = path.join(LAUNCHER_DIR, bundledRel)
  if (fs.existsSync(bundled)) {
    return require(bundled)
  }
  return require(path.join(LAUNCHER_DIR, devRel))
}

const { WEBUI_PORT } = requireLauncherModule('lib/webui-port.cjs', '../../lib/webui-port.cjs')
const {
  resolveSimAppRoot,
  formatSimRootHelp,
  isServerAppRoot,
  simPathOnVolume,
} = requireLauncherModule('portable-sim/sim-app-root.cjs', '../portable-desktop/sim-app-root.cjs')

const REPO_ROOT = app.isPackaged ? LAUNCHER_DIR : path.resolve(LAUNCHER_DIR, '../../..')
const SIM_LAUNCHER_SCRIPT = path.join(
  LAUNCHER_DIR,
  fs.existsSync(path.join(LAUNCHER_DIR, 'portable-sim/launch-sim-from-exfat.cjs'))
    ? 'portable-sim/launch-sim-from-exfat.cjs'
    : '../portable-desktop/launch-sim-from-exfat.cjs',
)

// WebUI Static Server served directly by client/launcher backend
const PORT = WEBUI_PORT
const distWebPath = path.resolve(__dirname, 'dist-web')

function mapInstanceStaticPath(requestPath) {
  const m = String(requestPath || '/').match(/^\/instance\/[^/]+(\/.*)?$/)
  if (!m) return requestPath
  const rest = m[1]
  if (!rest || rest === '/') return '/'
  return rest
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url)
  let pathname = parsedUrl.pathname
  
  // Transparent proxy for backend-hosted assets & APIs to prevent missing functionality (supporting Companion prefixes)
  const isProxyPath = /^\/(instance\/[^/]+\/)?(api|vendor|template|templates)\b/.test(pathname)
  if (isProxyPath) {
    try {
      const targetUrl = new URL(req.url, webuiApiOrigin)
      const proxyReq = http.request({
        hostname: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: targetUrl.pathname + (parsedUrl.search || ''),
        method: req.method,
        headers: {
          ...req.headers,
          host: targetUrl.host
        }
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers)
        proxyRes.pipe(res)
      })
      
      proxyReq.on('error', (err) => {
        res.statusCode = 502
        res.end(`Proxy error: ${err.message}`)
      })
      
      req.pipe(proxyReq)
    } catch (err) {
      res.statusCode = 500
      res.end(`Proxy failed: ${err.message}`)
    }
    return
  }
  
  // Map Companion-style prefix to local static folder root
  let cleanPath = mapInstanceStaticPath(pathname)
  if (cleanPath === '/' || cleanPath === '') {
    cleanPath = '/index.html'
  }
  
  let filePath = path.join(distWebPath, cleanPath)
  if (!filePath.startsWith(distWebPath)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }
  
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Single Page App routing fallback
      filePath = path.join(distWebPath, 'index.html')
    }
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 500
        res.end(`Error reading file: ${err.message}`)
        return
      }
      
      const ext = path.extname(filePath).toLowerCase()
      let contentType = 'text/plain'
      if (ext === '.html') contentType = 'text/html'
      else if (ext === '.js') contentType = 'application/javascript'
      else if (ext === '.css') contentType = 'text/css'
      else if (ext === '.json') contentType = 'application/json'
      else if (ext === '.png') contentType = 'image/png'
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'
      else if (ext === '.svg') contentType = 'image/svg+xml'
      else if (ext === '.ico') contentType = 'image/x-icon'
      else if (ext === '.woff') contentType = 'font/woff'
      else if (ext === '.woff2') contentType = 'font/woff2'
      else if (ext === '.ttf') contentType = 'font/ttf'
      
      res.setHeader('Content-Type', contentType)
      
      if (ext === '.html') {
        let htmlContent = data.toString('utf8')
        // Dynamically inject the active API server origin into meta tag
        htmlContent = htmlContent.replace(
          /<meta name="highascg-api-origin" content="[^"]*">/,
          `<meta name="highascg-api-origin" content="${webuiApiOrigin}">`
        )
        res.end(htmlContent)
      } else {
        res.end(data)
      }
    })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Electron Main] WebUI Static Server listening on http://localhost:${PORT}`)
})

// Transparent WebSocket Upgrade Proxy to route real-time client traffic under same-origin mapping
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url)
  const pathname = parsedUrl.pathname
  
  const isWsPath = /^\/(instance\/[^/]+\/)?api\/ws\b/.test(pathname)
  if (isWsPath) {
    try {
      const targetUrl = new URL(webuiApiOrigin)
      const targetHost = targetUrl.hostname
      const targetPort = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80)
      
      const net = require('net')
      const targetSocket = net.connect(targetPort, targetHost, () => {
        let rawHeaders = `${req.method} ${req.url} HTTP/1.1\r\n`
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const key = req.rawHeaders[i]
          const val = req.rawHeaders[i+1]
          if (key.toLowerCase() === 'host') {
            rawHeaders += `Host: ${targetUrl.host}\r\n`
          } else {
            rawHeaders += `${key}: ${val}\r\n`
          }
        }
        rawHeaders += '\r\n'
        
        targetSocket.write(rawHeaders)
        if (head && head.length > 0) {
          targetSocket.write(head)
        }
        
        targetSocket.pipe(socket)
        socket.pipe(targetSocket)
      })
      
      targetSocket.on('error', (err) => {
        console.error('[Electron Main] WebSocket Proxy target error:', err.message)
        socket.destroy()
      })
      
      socket.on('error', (err) => {
        console.error('[Electron Main] WebSocket Proxy client error:', err.message)
        targetSocket.destroy()
      })
    } catch (err) {
      console.error('[Electron Main] WebSocket Proxy upgrade failed:', err.message)
      socket.destroy()
    }
  } else {
    socket.destroy()
  }
})

let mainWindow = null
let simProcess = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    title: 'HighAsCG Operator Panel & Launcher',
    icon: path.join(__dirname, 'icon.svg'), // Svg icon copied from client
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
  server.close()
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

  if (!fs.existsSync(SIM_LAUNCHER_SCRIPT)) {
    event.reply('sim-log', `[Launcher] Missing simulation helper: ${SIM_LAUNCHER_SCRIPT}\n`)
    event.reply('sim-status', { running: false, error: 'missing launcher script' })
    return
  }

  const resolved = resolveSimAppRoot({
    launcherDir: LAUNCHER_DIR,
    repoRoot: REPO_ROOT,
    allowExfatStick: false,
  })
  if (!resolved) {
    event.reply('sim-log', `[Launcher] ${formatSimRootHelp({ repoRoot: REPO_ROOT, launcherDir: LAUNCHER_DIR })}\n`)
    event.reply('sim-status', { running: false, error: 'no server tree' })
    return
  }

  event.reply('sim-log', `[Launcher] Server app root (${resolved.source}): ${resolved.appRoot}\n`)
  event.reply('sim-log', `[Launcher] Helper: ${SIM_LAUNCHER_SCRIPT}\n`)

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HIGHASCG_LAUNCH_NO_BROWSER: '1',
    HIGHASCG_OFFLINE_MODE: offlineMode ? '1' : '0',
    HTTP_PORT: String(port),
    HIGHASCG_LAUNCHER_DIR: LAUNCHER_DIR,
    HIGHASCG_SIM_APP_ROOT: resolved.appRoot,
  }

  try {
    simProcess = spawn(process.execPath, [SIM_LAUNCHER_SCRIPT], {
      cwd: resolved.appRoot,
      env,
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

/** Fast drive-letter scan via `vol` (avoids blocking PowerShell Get-Volume on Windows). */
async function checkWindowsVolume(label) {
  const want = String(label).toUpperCase()
  const letters = []
  for (let code = 67; code <= 90; code++) letters.push(`${String.fromCharCode(code)}:`)

  const hits = await Promise.all(
    letters.map(
      (drive) =>
        new Promise((resolve) => {
          execFile(
            'cmd.exe',
            ['/c', 'vol', drive],
            { windowsHide: true, timeout: 400, maxBuffer: 64 * 1024 },
            (err, stdout) => {
              if (err || !stdout) {
                resolve(null)
                return
              }
              if (String(stdout).toUpperCase().includes(want)) {
                resolve(`${drive}\\`)
              } else {
                resolve(null)
              }
            },
          )
        }),
    ),
  )
  return hits.find(Boolean) || null
}

function findDarwinVolumeByLabel(label) {
  const volumesDev = (() => {
    try {
      return fs.statSync('/Volumes').dev
    } catch (_) {
      return null
    }
  })()

  const exact = path.join('/Volumes', label)
  if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) {
    if (volumesDev === null || fs.statSync(exact).dev !== volumesDev) {
      return exact
    }
  }
  try {
    for (const name of fs.readdirSync('/Volumes')) {
      if (name === label || name.startsWith(`${label} `)) {
        const candidate = path.join('/Volumes', name)
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          if (volumesDev === null || fs.statSync(candidate).dev !== volumesDev) {
            return candidate
          }
        }
      }
    }
  } catch (_) {}
  return null
}

ipcMain.handle('check-sim-runtime', async () => {
  const resolved = resolveSimAppRoot({
    launcherDir: LAUNCHER_DIR,
    repoRoot: REPO_ROOT,
    allowExfatStick: false,
  })
  if (!resolved) {
    return { ready: false, help: formatSimRootHelp({ repoRoot: REPO_ROOT, launcherDir: LAUNCHER_DIR }) }
  }
  const nm = path.join(resolved.appRoot, 'node_modules')
  return {
    ready: true,
    appRoot: resolved.appRoot,
    source: resolved.source,
    hasNodeModules: fs.existsSync(nm),
  }
})

let usbStatusInFlight = null

async function probeUsbStatus() {
  const label = 'HIGHASCGEXF'
  const platform = process.platform
  let mountedPath = null

  if (platform === 'darwin') {
    mountedPath = findDarwinVolumeByLabel(label)
  } else if (platform === 'win32') {
    mountedPath = await checkWindowsVolume(label)
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
        const { stdout } = await execFileAsync('findmnt', ['-n', '-o', 'TARGET', `-L${label}`], {
          timeout: 2000,
          windowsHide: true,
        })
        const out = stdout.trim()
        if (out && fs.existsSync(out)) mountedPath = out
      } catch (_) {
        /* ignore */
      }
    }
  }

  if (mountedPath) {
    const simDir = simPathOnVolume(mountedPath)
    const hasPayload = isServerAppRoot(simDir)
    return {
      mounted: true,
      path: mountedPath,
      hasPayload,
      payloadPath: simDir,
    }
  }

  return { mounted: false }
}

ipcMain.handle('check-usb-status', async () => {
  if (usbStatusInFlight) return usbStatusInFlight
  usbStatusInFlight = probeUsbStatus().finally(() => {
    usbStatusInFlight = null
  })
  return usbStatusInFlight
})
