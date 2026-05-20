const { ipcRenderer } = require('electron')

// Tab Navigation
const navItems = document.querySelectorAll('.nav-menu .nav-item')
const tabPanes = document.querySelectorAll('.tab-pane')
const pageTitle = document.getElementById('page-title')
const pageSubtitle = document.getElementById('page-subtitle')

const pageMeta = {
  dashboard: { title: 'Operator Dashboard', subtitle: 'Quick overview of system preparation state' },
  flash: { title: 'Flashing Guide', subtitle: 'How to flash the bootable live ISO image' },
  partition: { title: 'Partitioning & exFAT Guide', subtitle: 'Create the exFAT HIGHASCGEXF storage partition' },
  simulation: { title: 'Simulation Center', subtitle: 'Run HighAsCG locally in simulated offline mode' }
}

function switchTab(tabId) {
  navItems.forEach(item => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active')
    } else {
      item.classList.remove('active')
    }
  })

  tabPanes.forEach(pane => {
    if (pane.id === `tab-${tabId}`) {
      pane.classList.add('active')
    } else {
      pane.classList.remove('active')
    }
  })

  if (pageMeta[tabId]) {
    pageTitle.textContent = pageMeta[tabId].title
    pageSubtitle.textContent = pageMeta[tabId].subtitle
  }
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    switchTab(item.getAttribute('data-tab'))
  })
})

// Shortcut navigation in Dashboard
document.querySelectorAll('[data-go-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.getAttribute('data-go-tab'))
  })
})

// Inner OS Tab Navigation (Partition Tab)
const innerTabs = document.querySelectorAll('.inner-tab')
const osGuides = document.querySelectorAll('.os-guide')

innerTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    innerTabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')

    const targetOs = tab.getAttribute('data-os')
    osGuides.forEach(guide => {
      if (guide.id === `guide-${targetOs}`) {
        guide.classList.add('active')
      } else {
        guide.classList.remove('active')
      }
    })
  })
})

// USB Drive & Payload Status Polling
const usbIndicator = document.getElementById('usb-indicator')
const usbLabelText = document.getElementById('usb-label-text')
const usbDescText = document.getElementById('usb-desc-text')

const checkUsb = document.getElementById('check-usb')
const checkUsbDetails = document.getElementById('check-usb-details')
const checkPayload = document.getElementById('check-payload')
const checkPayloadDetails = document.getElementById('check-payload-details')

async function pollUsbStatus() {
  try {
    const status = await ipcRenderer.invoke('check-usb-status')
    if (status.mounted) {
      usbIndicator.className = 'indicator-dot status-success'
      usbLabelText.textContent = 'HIGHASCGEXF Connected'
      usbDescText.textContent = `Mounted at ${status.path}`

      checkUsb.classList.add('checked')
      checkUsb.querySelector('.check-box').textContent = '✓'
      checkUsbDetails.textContent = `USB stick detected exFAT volume mounted at: ${status.path}`

      if (status.hasPayload) {
        checkPayload.classList.add('checked')
        checkPayload.querySelector('.check-box').textContent = '✓'
        checkPayloadDetails.textContent = `Payload package.json verified at: ${status.payloadPath}`
      } else {
        checkPayload.classList.remove('checked')
        checkPayload.querySelector('.check-box').textContent = '!'
        checkPayloadDetails.textContent = `Payload folder 'sim/highascg/' not found. Place the extracted release files on the stick.`
      }
    } else {
      usbIndicator.className = 'indicator-dot status-warning'
      usbLabelText.textContent = 'USB Stick Offline'
      usbDescText.textContent = 'HIGHASCGEXF volume not detected'

      checkUsb.classList.remove('checked')
      checkUsb.querySelector('.check-box').textContent = '!'
      checkUsbDetails.textContent = `USB drive with exFAT partition not detected. Connect stick or run in local dev mode.`

      checkPayload.classList.remove('checked')
      checkPayload.querySelector('.check-box').textContent = '!'
      checkPayloadDetails.textContent = `Application payload not verified. Please configure your exFAT stick.`
    }
  } catch (e) {
    console.error('Probing USB status error:', e)
  }
}

// Run initial status check and poll every 3 seconds
pollUsbStatus()
setInterval(pollUsbStatus, 3000)

// Simulation controls
const serverIpInput = document.getElementById('server-ip')
const simPortInput = document.getElementById('sim-port')
const simOfflineToggle = document.getElementById('sim-offline')
const btnStartSim = document.getElementById('btn-start-sim')
const btnStopSim = document.getElementById('btn-stop-sim')
const btnOpenWebui = document.getElementById('btn-open-webui')
const terminalOutput = document.getElementById('terminal-output-text')
const terminalBody = document.getElementById('terminal-body-box')
const btnClearTerminal = document.getElementById('btn-clear-terminal')

let isSimRunning = false

function getTargetUrl() {
  const ip = (serverIpInput.value || 'localhost').trim()
  const port = simPortInput.value || 4200
  return `http://${ip}:${port}/`
}

function updateWebuiButton() {
  btnOpenWebui.textContent = `Open Web UI (${getTargetUrl()})`
}

// Bind live text change listeners to update Open Web UI button label
serverIpInput.addEventListener('input', updateWebuiButton)
simPortInput.addEventListener('input', updateWebuiButton)
serverIpInput.addEventListener('change', updateWebuiButton)
simPortInput.addEventListener('change', updateWebuiButton)

// Initial update to reflect default inputs
updateWebuiButton()

function appendLog(text) {
  if (terminalOutput.textContent === '[Idle] Simulation has not been started. Select configurations and hit \'Start Simulation\'.' || 
      terminalOutput.textContent === '') {
    terminalOutput.textContent = text
  } else {
    terminalOutput.textContent += text
  }
  // Auto-scroll
  terminalBody.scrollTop = terminalBody.scrollHeight

  // Check for successful express listener bind to update button text
  if (text.includes('listening on') || text.includes('HTTP Server') || text.includes('Server running') || text.includes('Express')) {
    updateWebuiButton()
  }
}

btnStartSim.addEventListener('click', () => {
  const port = parseInt(simPortInput.value, 10) || 4200
  const offlineMode = simOfflineToggle.checked

  terminalOutput.textContent = ''
  appendLog(`[Launcher] Starting HighAsCG in simulation mode on port ${port}...\n`)

  btnStartSim.disabled = true
  serverIpInput.disabled = true
  simPortInput.disabled = true
  simOfflineToggle.disabled = true

  ipcRenderer.send('start-sim', { port, offlineMode })
})

btnStopSim.addEventListener('click', () => {
  appendLog('[Launcher] Dispatching shutdown signal to simulator process...\n')
  ipcRenderer.send('stop-sim')
})

btnClearTerminal.addEventListener('click', () => {
  terminalOutput.textContent = ''
})

ipcRenderer.on('sim-log', (event, text) => {
  appendLog(text)
})

ipcRenderer.on('sim-status', (event, status) => {
  isSimRunning = status.running
  if (isSimRunning) {
    btnStartSim.disabled = true
    btnStopSim.disabled = false
  } else {
    btnStartSim.disabled = false
    btnStopSim.disabled = true
    serverIpInput.disabled = false
    simPortInput.disabled = false
    simOfflineToggle.disabled = false
    updateWebuiButton()

    if (status.error) {
      appendLog(`[Launcher Error] Simulator error: ${status.error}\n`)
    }
  }
})

// Web UI opener trigger
btnOpenWebui.addEventListener('click', () => {
  ipcRenderer.send('open-external-url', getTargetUrl())
})

// Quick Simulation Button on Dashboard
document.getElementById('btn-quick-sim').addEventListener('click', () => {
  switchTab('simulation')
  // Autotrigger start if not running
  if (!isSimRunning) {
    setTimeout(() => {
      btnStartSim.click()
    }, 100)
  }
})

// Quick links
document.getElementById('btn-open-readme').addEventListener('click', () => {
  switchTab('flash')
})

document.getElementById('btn-open-logs').addEventListener('click', () => {
  // Try to open operator directory manual
  ipcRenderer.send('open-external-url', 'https://github.com/')
})
