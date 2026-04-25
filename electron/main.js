import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import si from 'systeminformation'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// In dev: vite-plugin-electron exposes the dev server URL via VITE_DEV_SERVER_URL.
// In prod: load the built index.html bundled into the asar.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const DIST_PATH = path.join(__dirname, '../dist')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#000000',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(DIST_PATH, 'index.html'))
  }
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

// ---------- IPC handlers (system stats) ----------

let prevNet = null

ipcMain.handle('sys:platform', () => ({
  platform: process.platform,
  arch: process.arch,
  release: process.getSystemVersion?.() ?? '',
}))

ipcMain.handle('sys:cpu', async () => {
  const [load, cpu] = await Promise.all([si.currentLoad(), si.cpu()])
  return {
    percent: Math.round(load.currentLoad),
    cores: load.cpus?.map((c) => Math.round(c.load)) ?? [],
    speedGhz: cpu.speed,
    brand: cpu.manufacturer + ' ' + cpu.brand,
  }
})

ipcMain.handle('sys:memory', async () => {
  const m = await si.mem()
  const totalGB = m.total / 1024 / 1024 / 1024
  const usedGB = (m.total - m.available) / 1024 / 1024 / 1024
  const swapGB = m.swapused / 1024 / 1024 / 1024
  return {
    totalGB: Number(totalGB.toFixed(1)),
    usedGB: Number(usedGB.toFixed(1)),
    swapGB: Number(swapGB.toFixed(1)),
    pct: Math.round(((m.total - m.available) / m.total) * 100),
  }
})

function normalizeSsid(raw) {
  if (!raw) return null
  // macOS Sonoma+ returns the literal string "<redacted>" for SSID without
  // Location Services permission — it's not the user's network name.
  if (typeof raw !== 'string') return null
  if (raw.toLowerCase().includes('redacted')) return null
  return raw
}

ipcMain.handle('sys:network', async () => {
  const [stats, wifi, ifaces] = await Promise.all([
    si.networkStats(),
    si.wifiConnections().catch(() => []),
    si.networkInterfaces('default').catch(() => null),
  ])
  const primary = stats[0]
  if (!primary) {
    return { down: 0, up: 0, iface: 'n/a', ssid: null, type: 'unknown', ip: null }
  }
  const wifiConn = wifi.find((w) => w.iface === primary.iface) ?? wifi[0]
  const ifaceInfo = ifaces && !Array.isArray(ifaces) ? ifaces : (Array.isArray(ifaces) ? ifaces.find((i) => i.iface === primary.iface) : null)
  const isWifi = !!wifiConn || ifaceInfo?.type === 'wireless'
  return {
    down: Math.max(0, primary.rx_sec ?? 0),
    up: Math.max(0, primary.tx_sec ?? 0),
    iface: primary.iface,
    ssid: normalizeSsid(wifiConn?.ssid),
    type: isWifi ? 'wifi' : ifaceInfo?.type === 'wired' ? 'wired' : (ifaceInfo?.type ?? 'wired'),
    ip: ifaceInfo?.ip4 ?? null,
    signalQuality: wifiConn?.quality ?? null,
  }
})

ipcMain.handle('sys:battery', async () => {
  const b = await si.battery()
  return {
    hasBattery: b.hasBattery,
    percent: b.percent,
    isCharging: b.isCharging,
    acConnected: b.acConnected,
  }
})
