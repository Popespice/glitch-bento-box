import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import si from 'systeminformation'
import Store from 'electron-store'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const store = new Store({
  defaults: {
    weather: {
      query: '',
      locationName: '',
      lat: null,
      lon: null,
    },
    github: {
      username: '',
    },
    pomodoro: {
      minutes: 25,
    },
  },
})

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
    if (process.env.BENTO_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
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
    hasBattery:    b.hasBattery,
    percent:       b.percent,
    isCharging:    b.isCharging,
    acConnected:   b.acConnected,
    timeRemaining: b.timeRemaining ?? -1,  // minutes, -1 = unknown/charging
  }
})

ipcMain.handle('sys:uptime', async () => {
  const t = await si.time()
  return { uptime: t.uptime }   // seconds since boot
})

ipcMain.handle('sys:disk', async () => {
  const disks = await si.fsSize()
  const main = disks.find(d => d.mount === '/') ?? disks[0]
  if (!main) return null
  return {
    totalGB: Number((main.size / 1e9).toFixed(1)),
    usedGB:  Number((main.used / 1e9).toFixed(1)),
    freeGB:  Number(((main.size - main.used) / 1e9).toFixed(1)),
    pct:     Math.round(main.use),
  }
})

// Fire-and-forget: plays a macOS system sound. No-op on Windows.
ipcMain.handle('sys:play-sound', (_event, sound = 'Glass') => {
  if (process.platform === 'darwin') {
    exec(`afplay "/System/Library/Sounds/${sound}.aiff"`)
  }
})

// ---------- Last shell command (from history file) ----------

function tailFile(filePath, bytes = 8192) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const { size } = fs.fstatSync(fd)
    const len = Math.min(bytes, size)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

ipcMain.handle('sys:last-command', () => {
  const home = os.homedir()
  const candidates = [
    { path: `${home}/.zsh_history`, shell: 'ZSH', extended: true },
    { path: `${home}/.bash_history`, shell: 'BASH', extended: false },
  ]

  for (const { path: histPath, shell, extended } of candidates) {
    try {
      const text = tailFile(histPath)
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

      let command = null
      if (extended) {
        // Walk backwards looking for the last extended-format entry
        // ': timestamp:elapsed;command'. Plain entries look like normal commands.
        for (let i = lines.length - 1; i >= 0; i--) {
          const ext = lines[i].match(/^: \d+:\d+;(.+)/)
          if (ext) { command = ext[1]; break }
        }
        // If no extended entries found, treat as plain
        if (!command && lines.length) command = lines[lines.length - 1]
      } else {
        command = lines[lines.length - 1] ?? null
      }

      if (!command) continue
      const trimmed = command.trim()
      const verb = trimmed.split(/\s+/)[0].toUpperCase()
      // Some verbs may contain non-alpha chars (e.g. './foo', '~/script') — strip
      // anything DotMatrix can't render to keep the verb clean. Letters/digits/dash only.
      const cleanVerb = verb.replace(/[^A-Z0-9\-]/g, '') || 'CMD'
      return { verb: cleanVerb, full: trimmed, shell }
    } catch {
      // file not found or unreadable — try next candidate
    }
  }
  return null
})

// ---------- Weather (Open-Meteo, no API key) ----------

const WMO_DESCRIPTIONS = {
  0: 'CLEAR SKY', 1: 'MAINLY CLEAR', 2: 'PARTLY CLOUDY', 3: 'OVERCAST',
  45: 'FOGGY', 48: 'FREEZING FOG',
  51: 'LIGHT DRIZZLE', 53: 'DRIZZLE', 55: 'HEAVY DRIZZLE',
  61: 'LIGHT RAIN', 63: 'RAIN', 65: 'HEAVY RAIN',
  71: 'LIGHT SNOW', 73: 'SNOW', 75: 'HEAVY SNOW', 77: 'SNOW GRAINS',
  80: 'RAIN SHOWERS', 81: 'RAIN SHOWERS', 82: 'VIOLENT SHOWERS',
  85: 'SNOW SHOWERS', 86: 'HEAVY SNOW SHOWERS',
  95: 'THUNDERSTORM', 96: 'THUNDERSTORM', 99: 'THUNDERSTORM',
}

function degreesToCardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

let _weatherCache = null
let _weatherFetchedAt = 0
const WEATHER_TTL = 30 * 60 * 1000 // 30 min

ipcMain.handle('sys:weather', async () => {
  const lat = store.get('weather.lat')
  const lon = store.get('weather.lon')
  if (lat == null || lon == null) return null   // not configured yet

  if (_weatherCache && Date.now() - _weatherFetchedAt < WEATHER_TTL) {
    return _weatherCache
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weathercode,windspeed_10m,winddirection_10m,relativehumidity_2m` +
      `&temperature_unit=fahrenheit&windspeed_unit=mph&wind_speed_unit=mph`
    const res = await fetch(url)
    const json = await res.json()
    const c = json.current
    _weatherCache = {
      tempF:       Math.round(c.temperature_2m),
      condition:   WMO_DESCRIPTIONS[c.weathercode] ?? 'UNKNOWN',
      humidity:    c.relativehumidity_2m,
      windSpeed:   Math.round(c.windspeed_10m),
      windDir:     degreesToCardinal(c.winddirection_10m),
      locationName: store.get('weather.locationName') || '',
    }
    _weatherFetchedAt = Date.now()
    return _weatherCache
  } catch (err) {
    console.error('[weather]', err.message)
    return null
  }
})

// ---------- Settings ----------

ipcMain.handle('settings:get', () => ({
  weather: store.get('weather'),
  github:  store.get('github'),
}))

ipcMain.handle('settings:set', (_event, key, value) => {
  store.set(key, value)
  // Invalidate relevant caches so the next poll picks up new values
  if (key.startsWith('weather')) {
    _weatherCache    = null
    _weatherFetchedAt = 0
  }
  if (key.startsWith('github')) {
    _heatmapCache    = null
    _heatmapFetchedAt = 0
  }
  return true
})

ipcMain.handle('settings:geocode', async (_event, query) => {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search` +
      `?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
    const res = await fetch(url)
    const json = await res.json()
    const r = json.results?.[0]
    if (!r) return null
    const parts = [r.name, r.admin1, r.country_code].filter(Boolean)
    return {
      lat:          r.latitude,
      lon:          r.longitude,
      locationName: parts.join(', '),
    }
  } catch (err) {
    console.error('[geocode]', err.message)
    return null
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

    const storedUsername = store.get('github.username')
    let login
    if (storedUsername) {
      login = storedUsername
    } else {
      const { stdout: userRaw } = await execAsync('gh api user -q .login')
      login = userRaw.trim()
    }

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
