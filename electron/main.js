import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import si from 'systeminformation'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
    // 'customButtonsOnHover' — native traffic lights invisible until cursor
    // enters the top-left corner; no custom React component needed.
    titleBarStyle: process.platform === 'darwin' ? 'customButtonsOnHover' : 'default',
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

// ---------- Window controls (custom traffic lights) ----------

ipcMain.on('win:close',    () => mainWindow?.close())
ipcMain.on('win:minimize', () => mainWindow?.minimize())
ipcMain.on('win:maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})

// ---------- IPC handlers (system stats) ----------

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
  return {
    totalGB: Number((m.total / 1e9).toFixed(1)),
    usedGB:  Number(((m.total - m.available) / 1e9).toFixed(1)),
    swapGB:  Number((m.swapused / 1e9).toFixed(1)),
    pct: Math.round(((m.total - m.available) / m.total) * 100),
  }
})

function normalizeSsid(raw) {
  if (!raw || typeof raw !== 'string') return null
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
  if (!primary) return { down: 0, up: 0, iface: 'n/a', ssid: null, type: 'unknown', ip: null }

  const wifiConn = wifi.find((w) => w.iface === primary.iface) ?? wifi[0]
  const ifaceInfo = Array.isArray(ifaces)
    ? ifaces.find((i) => i.iface === primary.iface)
    : ifaces
  const isWifi = !!wifiConn || ifaceInfo?.type === 'wireless'

  return {
    down: Math.max(0, primary.rx_sec ?? 0),
    up:   Math.max(0, primary.tx_sec ?? 0),
    iface: primary.iface,
    ssid: normalizeSsid(wifiConn?.ssid),
    type: isWifi ? 'wifi' : 'wired',
    ip:   ifaceInfo?.ip4 ?? null,
    signalQuality: wifiConn?.quality ?? null,
  }
})

ipcMain.handle('sys:battery', async () => {
  const b = await si.battery()
  return {
    hasBattery:  b.hasBattery,
    percent:     b.percent,
    isCharging:  b.isCharging,
    acConnected: b.acConnected,
  }
})

// ---------- GitHub contributions heatmap ----------

let _heatmapCache = null
let _heatmapFetchedAt = 0
const HEATMAP_TTL = 60 * 60 * 1000 // 1 hour

const GH_QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }
  }
}`.trim()

ipcMain.handle('sys:github-heatmap', async () => {
  if (_heatmapCache && Date.now() - _heatmapFetchedAt < HEATMAP_TTL) {
    return _heatmapCache
  }
  try {
    // Use gh's stored OAuth token — works without any extra config
    const { stdout: tokenRaw } = await execAsync('gh auth token')
    const token = tokenRaw.trim()

    const { stdout: userRaw } = await execAsync('gh api user -q .login')
    const login = userRaw.trim()

    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: GH_QUERY, variables: { login } }),
    })

    const { data } = await res.json()
    const weeks = data.user.contributionsCollection.contributionCalendar.weeks

    // Flatten into array of { date, count }, most recent 140 days (20 weeks)
    const days = weeks
      .flatMap((w) => w.contributionDays)
      .map((d) => ({ date: d.date, count: d.contributionCount }))
      .slice(-140)

    _heatmapCache = days
    _heatmapFetchedAt = Date.now()
    return days
  } catch (err) {
    console.error('[github-heatmap]', err.message)
    return null // renderer falls back to seeded random
  }
})
