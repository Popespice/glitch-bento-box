import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import si from 'systeminformation'
import Store from 'electron-store'
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from './spotify-config.js'
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from './google-calendar-config.js'
import {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_REDIRECT_URI,
} from './github-config.js'
import { createDAVClient } from 'tsdav'
import nodeIcal from 'node-ical'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------- Custom protocol (bento://) for Spotify OAuth callback ----------
// Must be registered before app.whenReady() so the OS knows about the scheme.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('bento', process.execPath, [path.resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient('bento')
}

// Single-instance lock: required so that on Windows/Linux the second invocation
// (the one carrying the bento:// callback URL) gets routed back into the running
// app rather than spawning a duplicate.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

const store = new Store({
  defaults: {
    weather: {
      query: '',
      locationName: '',
      lat: null,
      lon: null,
    },
    github: {
      username: '',   // manual override / gh-CLI fallback
      accessToken: null, // GitHub OAuth access token (stored after Connect)
      login: '',         // username resolved via OAuth
    },
    pomodoro: {
      minutes: 25,
    },
    // Privacy: this section holds exactly one field — the OAuth refresh token,
    // and only after the user explicitly clicks Connect. It's nulled on Disconnect.
    // No client ID/secret (those are bundled at build time, not user data),
    // no access token (kept in main-process memory only), no display name,
    // no email/profile/listening data of any kind.
    spotify: {
      refreshToken: null,
    },
    // Privacy: stored locally only. iCloud uses an app-specific password (user
    // generates at appleid.apple.com). Google stores only the refresh token +
    // email needed to construct the CalDAV URL. No event data is ever persisted.
    calendar: {
      provider: null, // 'icloud' | 'google' | null
      icloudUsername: '',
      icloudAppPassword: '',
      googleRefreshToken: null,
      googleEmail: '',
      activeCalendarIds: [], // calendar URLs the user opted into
    },
  },
})

// In-memory only — never persisted, dies when the process exits.
let _spotifyAccess = null // { token: string, expiresAt: number (ms epoch) }
let _pendingConnect = null // { resolve, reject, state, timeoutId } during Spotify OAuth flow
let _googleAccess = null // { token: string, expiresAt: number }
let _pendingGCalConnect = null // { resolve, reject, state, timeoutId } during Google OAuth flow
let _pendingGithubConnect = null // { resolve, reject, state, timeoutId } during GitHub OAuth flow
let _caffeinateProc = null // ChildProcess | null — caffeinate -d background process
let _btHelperPath = null // string | null — path to compiled Swift BT helper binary

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

// Ensure caffeinate is killed when the app exits so the Mac can sleep normally.
app.on('before-quit', () => {
  if (_caffeinateProc && !_caffeinateProc.killed) {
    _caffeinateProc.kill()
    _caffeinateProc = null
  }
})

// ---------- bento:// protocol routing ----------
// macOS: protocol URLs arrive as their own event.
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('bento://')) handleSpotifyCallback(url)
})

// Windows / Linux: protocol URLs arrive in argv when the OS launches a second
// instance of the app to handle the URL. The single-instance lock above ensures
// that second instance immediately quits and forwards argv to the running one.
app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => a.startsWith('bento://'))
  if (url) handleSpotifyCallback(url)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ---------- Window controls (custom traffic lights) ----------

ipcMain.on('win:close', () => mainWindow?.close())
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

// GPU model is expensive to fetch (system_profiler / si.graphics() can take seconds)
// but the model name never changes during a session, so cache it after first lookup.
let gpuModelCache = null
async function getGpuModel() {
  if (gpuModelCache) return gpuModelCache
  try {
    const g = await si.graphics()
    const ctrl = g.controllers?.[0]
    gpuModelCache = ctrl?.model || ctrl?.name || 'GPU'
  } catch {
    gpuModelCache = 'GPU'
  }
  return gpuModelCache
}

ipcMain.handle('sys:gpu', async () => {
  // macOS: `ioreg -rc IOAccelerator` exposes "Device Utilization %" in the
  // PerformanceStatistics dict — works without sudo on both Intel and Apple Silicon.
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execAsync('ioreg -rc IOAccelerator', { timeout: 1500 })
      const match = stdout.match(/"Device Utilization %"=(\d+)/)
      if (match) {
        const pct = parseInt(match[1], 10)
        return {
          percent: Math.max(0, Math.min(100, pct)),
          model: await getGpuModel(),
        }
      }
    } catch {
      /* fall through */
    }
  }

  // Cross-platform fallback — works on some Windows/NVIDIA/AMD drivers, often 0 on Linux.
  try {
    const g = await si.graphics()
    const ctrl =
      g.controllers?.find((c) => typeof c.utilizationGpu === 'number') ?? g.controllers?.[0]
    return {
      percent: Math.max(0, Math.min(100, Math.round(ctrl?.utilizationGpu ?? 0))),
      model: ctrl?.model || ctrl?.name || 'GPU',
    }
  } catch {
    return { percent: 0, model: 'GPU' }
  }
})

ipcMain.handle('sys:memory', async () => {
  const m = await si.mem()
  return {
    totalGB: Number((m.total / 1e9).toFixed(1)),
    usedGB: Number(((m.total - m.available) / 1e9).toFixed(1)),
    swapGB: Number((m.swapused / 1e9).toFixed(1)),
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
  const ifaceInfo = Array.isArray(ifaces) ? ifaces.find((i) => i.iface === primary.iface) : ifaces
  const isWifi = !!wifiConn || ifaceInfo?.type === 'wireless'

  return {
    down: Math.max(0, primary.rx_sec ?? 0),
    up: Math.max(0, primary.tx_sec ?? 0),
    iface: primary.iface,
    ssid: normalizeSsid(wifiConn?.ssid),
    type: isWifi ? 'wifi' : 'wired',
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
    timeRemaining: b.timeRemaining ?? -1, // minutes, -1 = unknown/charging
  }
})

ipcMain.handle('sys:uptime', async () => {
  const t = await si.time()
  return { uptime: t.uptime } // seconds since boot
})

ipcMain.handle('sys:disk', async () => {
  const disks = await si.fsSize()
  const main = disks.find((d) => d.mount === '/') ?? disks[0]
  if (!main) return null
  return {
    totalGB: Number((main.size / 1e9).toFixed(1)),
    usedGB: Number((main.used / 1e9).toFixed(1)),
    freeGB: Number(((main.size - main.used) / 1e9).toFixed(1)),
    pct: Math.round(main.use),
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
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

      let command = null
      if (extended) {
        // Walk backwards looking for the last extended-format entry
        // ': timestamp:elapsed;command'. Plain entries look like normal commands.
        for (let i = lines.length - 1; i >= 0; i--) {
          const ext = lines[i].match(/^: \d+:\d+;(.+)/)
          if (ext) {
            command = ext[1]
            break
          }
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
      const cleanVerb = verb.replace(/[^A-Z0-9-]/g, '') || 'CMD'
      return { verb: cleanVerb, full: trimmed, shell }
    } catch {
      // file not found or unreadable — try next candidate
    }
  }
  return null
})

// ---------- Weather (Open-Meteo, no API key) ----------

const WMO_DESCRIPTIONS = {
  0: 'CLEAR SKY',
  1: 'MAINLY CLEAR',
  2: 'PARTLY CLOUDY',
  3: 'OVERCAST',
  45: 'FOGGY',
  48: 'FREEZING FOG',
  51: 'LIGHT DRIZZLE',
  53: 'DRIZZLE',
  55: 'HEAVY DRIZZLE',
  61: 'LIGHT RAIN',
  63: 'RAIN',
  65: 'HEAVY RAIN',
  71: 'LIGHT SNOW',
  73: 'SNOW',
  75: 'HEAVY SNOW',
  77: 'SNOW GRAINS',
  80: 'RAIN SHOWERS',
  81: 'RAIN SHOWERS',
  82: 'VIOLENT SHOWERS',
  85: 'SNOW SHOWERS',
  86: 'HEAVY SNOW SHOWERS',
  95: 'THUNDERSTORM',
  96: 'THUNDERSTORM',
  99: 'THUNDERSTORM',
}

function degreesToCardinal(deg) {
  const dirs = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ]
  return dirs[Math.round(deg / 22.5) % 16]
}

let _weatherCache = null
let _weatherFetchedAt = 0
const WEATHER_TTL = 30 * 60 * 1000 // 30 min

ipcMain.handle('sys:weather', async () => {
  const lat = store.get('weather.lat')
  const lon = store.get('weather.lon')
  if (lat == null || lon == null) return null // not configured yet

  if (_weatherCache && Date.now() - _weatherFetchedAt < WEATHER_TTL) {
    return _weatherCache
  }
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weathercode,windspeed_10m,winddirection_10m,relativehumidity_2m` +
      `&temperature_unit=fahrenheit&windspeed_unit=mph&wind_speed_unit=mph`
    const res = await fetch(url)
    const json = await res.json()
    const c = json.current
    _weatherCache = {
      tempF: Math.round(c.temperature_2m),
      condition: WMO_DESCRIPTIONS[c.weathercode] ?? 'UNKNOWN',
      humidity: c.relativehumidity_2m,
      windSpeed: Math.round(c.windspeed_10m),
      windDir: degreesToCardinal(c.winddirection_10m),
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
  github: store.get('github'),
  // Privacy: only return a boolean, never the token itself.
  spotify: { connected: !!store.get('spotify.refreshToken') },
}))

ipcMain.handle('settings:set', (_event, key, value) => {
  store.set(key, value)
  // Invalidate relevant caches so the next poll picks up new values
  if (key.startsWith('weather')) {
    _weatherCache = null
    _weatherFetchedAt = 0
  }
  if (key.startsWith('github')) {
    _heatmapCache = null
    _heatmapFetchedAt = 0
  }
  return true
})

ipcMain.handle('settings:geocode', async (_event, query) => {
  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search` +
      `?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
    const res = await fetch(url)
    const json = await res.json()
    const r = json.results?.[0]
    if (!r) return null
    const parts = [r.name, r.admin1, r.country_code].filter(Boolean)
    return {
      lat: r.latitude,
      lon: r.longitude,
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
    // Priority 1: in-app GitHub OAuth token
    let token = store.get('github.accessToken') || null
    let login = store.get('github.login') || ''

    // Priority 2: gh CLI token (if not connected via OAuth)
    if (!token) {
      try {
        const { stdout } = await execAsync('gh auth token')
        token = stdout.trim()
      } catch { /* gh not installed or not logged in */ }
    }

    // Resolve login: stored OAuth login → manual override → gh CLI → give up
    if (!login) {
      login = store.get('github.username') || ''
    }
    if (!login && token) {
      try {
        const { stdout } = await execAsync('gh api user -q .login')
        login = stdout.trim()
      } catch { /* ignore */ }
    }

    if (!token || !login) return null

    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: GH_QUERY, variables: { login } }),
    })

    const json = await res.json()
    if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error')
    const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks

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

// ---------- Spotify ----------
//
// Auth flow: bundled-credential OAuth Authorization Code.
// The user clicks Connect → main opens a minimal BrowserWindow pointed at the
// Spotify authorize URL → user approves in that window → Spotify issues a
// redirect to bento://callback?code=...&state=... → Electron's will-redirect /
// will-navigate events intercept the bento:// URL before the OS ever sees it →
// handleSpotifyCallback exchanges the code for tokens → window closes.
//
// Using an in-app window (rather than shell.openExternal + OS protocol routing)
// is reliable in both dev and production: no Info.plist registration required,
// no single-instance lock races, no macOS security quarantine edge cases.
//
// Privacy: only the refresh token is persisted to electron-store. Access tokens
// + display name + everything else stays in main-process memory or is never
// requested at all. See store defaults at the top of this file.

const SPOTIFY_BASIC_AUTH = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString(
  'base64'
)

const SPOTIFY_SCOPE = 'user-read-currently-playing user-read-playback-state'
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — abandon if user wanders off

async function exchangeSpotifyToken(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${SPOTIFY_BASIC_AUTH}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Spotify token exchange failed: ${res.status} ${text}`)
  }
  return res.json()
}

/**
 * Returns a valid access token, refreshing if needed.
 * Throws 'NO_REFRESH_TOKEN' if the user hasn't connected.
 * Throws 'REFRESH_FAILED' if Spotify rejects the refresh (e.g. token revoked).
 */
async function getValidAccessToken() {
  if (_spotifyAccess && _spotifyAccess.expiresAt - Date.now() > 60_000) {
    return _spotifyAccess.token
  }
  const refreshToken = store.get('spotify.refreshToken')
  if (!refreshToken) throw new Error('NO_REFRESH_TOKEN')

  let payload
  try {
    payload = await exchangeSpotifyToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  } catch (err) {
    console.error('[spotify] refresh failed:', err.message)
    throw new Error('REFRESH_FAILED')
  }

  _spotifyAccess = {
    token: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  }
  // Spotify occasionally returns a new refresh token; rotate if so.
  if (payload.refresh_token && payload.refresh_token !== refreshToken) {
    store.set('spotify.refreshToken', payload.refresh_token)
  }
  return _spotifyAccess.token
}

function clearPendingConnect() {
  if (_pendingConnect?.timeoutId) clearTimeout(_pendingConnect.timeoutId)
  _pendingConnect = null
}

async function handleSpotifyCallback(url) {
  if (!_pendingConnect) return // stale or unsolicited — ignore silently

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    _pendingConnect.reject(new Error('Malformed callback URL'))
    clearPendingConnect()
    return
  }

  const code = parsed.searchParams.get('code')
  const state = parsed.searchParams.get('state')
  const error = parsed.searchParams.get('error')

  // Bring the app to the front regardless of outcome — user expects it.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }

  if (error) {
    _pendingConnect.reject(new Error(error === 'access_denied' ? 'Permission denied' : error))
    clearPendingConnect()
    return
  }
  if (state !== _pendingConnect.state) {
    _pendingConnect.reject(new Error('State mismatch (CSRF check failed)'))
    clearPendingConnect()
    return
  }
  if (!code) {
    _pendingConnect.reject(new Error('No authorization code in callback'))
    clearPendingConnect()
    return
  }

  try {
    const payload = await exchangeSpotifyToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    })
    // Persist ONLY the refresh token. Access token + expiry stay in memory.
    store.set('spotify.refreshToken', payload.refresh_token)
    _spotifyAccess = {
      token: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    }
    _pendingConnect.resolve({ ok: true })
  } catch (err) {
    _pendingConnect.reject(err)
  } finally {
    clearPendingConnect()
  }
}

ipcMain.handle('spotify:connect', async () => {
  if (_pendingConnect) {
    return { ok: false, error: 'Connect already in progress' }
  }

  const state = crypto.randomBytes(16).toString('hex')
  const authUrl = new URL('https://accounts.spotify.com/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI)
  authUrl.searchParams.set('scope', SPOTIFY_SCOPE)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('show_dialog', 'true')

  return new Promise((resolve, reject) => {
    // Open a dedicated auth window so Electron intercepts the bento:// redirect
    // directly via will-redirect / will-navigate — no OS protocol routing needed.
    const authWin = new BrowserWindow({
      width: 480,
      height: 700,
      title: 'Connect Spotify',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    const cleanup = (err) => {
      if (!authWin.isDestroyed()) authWin.close()
      clearPendingConnect()
      if (err) reject(err)
    }

    const timeoutId = setTimeout(() => {
      cleanup(new Error('Connect timed out — window closed?'))
    }, CONNECT_TIMEOUT_MS)

    _pendingConnect = { resolve, reject, state, timeoutId }

    // Intercept the bento:// redirect before the webview tries to navigate to it.
    const interceptRedirect = (_event, url) => {
      if (!url.startsWith('bento://')) return
      _event.preventDefault()
      handleSpotifyCallback(url) // resolves / rejects _pendingConnect
      if (!authWin.isDestroyed()) authWin.close()
    }
    authWin.webContents.on('will-redirect', interceptRedirect)
    authWin.webContents.on('will-navigate', interceptRedirect)

    // User closed the window without completing auth.
    authWin.on('closed', () => {
      if (_pendingConnect) cleanup(new Error('Auth window closed'))
    })

    authWin.loadURL(authUrl.toString())
  }).then(
    (result) => result,
    (err) => ({ ok: false, error: err.message })
  )
})

ipcMain.handle('spotify:disconnect', () => {
  store.set('spotify.refreshToken', null)
  _spotifyAccess = null
  return { ok: true }
})

ipcMain.handle('sys:now-playing', async () => {
  let token
  try {
    token = await getValidAccessToken()
  } catch (err) {
    if (err.message === 'REFRESH_FAILED') {
      // Token revoked or otherwise invalid — wipe so the UI can prompt reconnect.
      store.set('spotify.refreshToken', null)
      _spotifyAccess = null
    }
    return { status: 'disconnected' }
  }

  let res
  try {
    res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    console.error('[spotify] currently-playing fetch failed:', err.message)
    return { status: 'error' }
  }

  if (res.status === 204) return { status: 'idle' } // nothing playing
  if (!res.ok) return { status: 'error' }

  let data
  try {
    data = await res.json()
  } catch {
    return { status: 'error' }
  }
  if (!data?.item) return { status: 'idle' }

  // Map ONLY the four fields the tile needs. Ignore the rest of the payload —
  // defense-in-depth so we don't accidentally surface or store user metadata.
  return {
    status: 'playing',
    isPlaying: !!data.is_playing,
    track: {
      name: data.item.name,
      artist: (data.item.artists ?? []).map((a) => a.name).join(' / '),
      duration: Math.floor((data.item.duration_ms ?? 0) / 1000),
    },
    position: Math.floor((data.progress_ms ?? 0) / 1000),
  }
})

// ---------- GitHub OAuth ----------
//
// Auth flow mirrors Spotify — opens a BrowserWindow, intercepts the
// bento://github-callback redirect, exchanges code for an access token, and
// stores it. GitHub access tokens don't expire (unlike Spotify), so we store
// the token directly — no refresh token needed.
//
// Scope: read:user — enough for the GraphQL contributionsCollection query.

const GITHUB_SCOPE = 'read:user'
const GITHUB_CONNECT_TIMEOUT_MS = 5 * 60 * 1000

function clearPendingGithubConnect() {
  if (_pendingGithubConnect?.timeoutId) clearTimeout(_pendingGithubConnect.timeoutId)
  _pendingGithubConnect = null
}

async function handleGithubCallback(url) {
  if (!_pendingGithubConnect) return

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    _pendingGithubConnect.reject(new Error('Malformed callback URL'))
    clearPendingGithubConnect()
    return
  }

  const code = parsed.searchParams.get('code')
  const state = parsed.searchParams.get('state')
  const error = parsed.searchParams.get('error')

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }

  if (error) {
    _pendingGithubConnect.reject(
      new Error(error === 'access_denied' ? 'Permission denied' : error)
    )
    clearPendingGithubConnect()
    return
  }
  if (state !== _pendingGithubConnect.state) {
    _pendingGithubConnect.reject(new Error('State mismatch (CSRF check failed)'))
    clearPendingGithubConnect()
    return
  }
  if (!code) {
    _pendingGithubConnect.reject(new Error('No authorization code in callback'))
    clearPendingGithubConnect()
    return
  }

  try {
    // Exchange code for access token
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    })
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
    const payload = await res.json()
    if (payload.error) throw new Error(payload.error_description || payload.error)

    const accessToken = payload.access_token

    // Resolve the username immediately so we can store it
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    })
    const userJson = await userRes.json()
    const login = userJson.login || ''

    store.set('github.accessToken', accessToken)
    store.set('github.login', login)
    // Invalidate heatmap cache so next poll re-fetches with the new token
    _heatmapCache = null
    _heatmapFetchedAt = 0

    _pendingGithubConnect.resolve({ ok: true, login })
  } catch (err) {
    _pendingGithubConnect.reject(err)
  } finally {
    clearPendingGithubConnect()
  }
}

ipcMain.handle('github:connect', async () => {
  if (_pendingGithubConnect) {
    return { ok: false, error: 'Connect already in progress' }
  }
  // If credentials are still placeholders, tell the renderer immediately.
  if (GITHUB_CLIENT_ID === 'paste-your-client-id-here') {
    return { ok: false, error: 'NO_CREDENTIALS' }
  }

  const state = crypto.randomBytes(16).toString('hex')
  const authUrl = new URL('https://github.com/login/oauth/authorize')
  authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', GITHUB_REDIRECT_URI)
  authUrl.searchParams.set('scope', GITHUB_SCOPE)
  authUrl.searchParams.set('state', state)

  return new Promise((resolve, reject) => {
    const authWin = new BrowserWindow({
      width: 520,
      height: 700,
      title: 'Connect GitHub',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    const cleanup = (err) => {
      if (!authWin.isDestroyed()) authWin.close()
      clearPendingGithubConnect()
      if (err) reject(err)
    }

    const timeoutId = setTimeout(() => {
      cleanup(new Error('Connect timed out — window closed?'))
    }, GITHUB_CONNECT_TIMEOUT_MS)

    _pendingGithubConnect = { resolve, reject, state, timeoutId }

    const interceptRedirect = (_event, url) => {
      if (!url.startsWith('bento://github-callback')) return
      _event.preventDefault()
      handleGithubCallback(url)
      if (!authWin.isDestroyed()) authWin.close()
    }
    authWin.webContents.on('will-redirect', interceptRedirect)
    authWin.webContents.on('will-navigate', interceptRedirect)

    authWin.on('closed', () => {
      if (_pendingGithubConnect) cleanup(new Error('Auth window closed'))
    })

    authWin.loadURL(authUrl.toString())
  }).then(
    (result) => result,
    (err) => ({ ok: false, error: err.message })
  )
})

ipcMain.handle('github:disconnect', () => {
  store.set('github.accessToken', null)
  store.set('github.login', '')
  _heatmapCache = null
  _heatmapFetchedAt = 0
  return { ok: true }
})

ipcMain.handle('github:status', () => {
  const token = store.get('github.accessToken')
  const login = store.get('github.login') || ''
  return { connected: !!token, login }
})

// ---------- Calendar (CalDAV: iCloud + Google) ----------
//
// Supports two providers, one active at a time:
//   - iCloud:  Basic auth with an app-specific password (user generates at appleid.apple.com)
//   - Google:  OAuth 2.0 with bundled developer credentials (mirrors Spotify pattern)
//
// Privacy: only the credentials needed to refresh access are persisted. No event
// titles, attendees, locations, or descriptions ever touch electron-store. Each
// fetch maps Spotify-style to a minimal payload — title, start time, calendar name —
// so accidental over-storage is structurally prevented.

const ICLOUD_SERVER_URL = 'https://caldav.icloud.com'
const GOOGLE_SERVER_URL = 'https://apidata.googleusercontent.com/caldav/v2/'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GOOGLE_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email'
const EVENT_LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

function clearPendingGCalConnect() {
  if (_pendingGCalConnect?.timeoutId) clearTimeout(_pendingGCalConnect.timeoutId)
  _pendingGCalConnect = null
}

async function exchangeGoogleToken(params) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      ...params,
    }).toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google token exchange failed: ${res.status} ${text}`)
  }
  return res.json()
}

async function getValidGoogleAccessToken() {
  if (_googleAccess && _googleAccess.expiresAt - Date.now() > 60_000) {
    return _googleAccess.token
  }
  const refreshToken = store.get('calendar.googleRefreshToken')
  if (!refreshToken) throw new Error('NO_REFRESH_TOKEN')

  let payload
  try {
    payload = await exchangeGoogleToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  } catch (err) {
    console.error('[calendar/google] refresh failed:', err.message)
    throw new Error('REFRESH_FAILED')
  }
  _googleAccess = {
    token: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  }
  // Google occasionally rotates refresh tokens; persist if returned.
  if (payload.refresh_token) {
    store.set('calendar.googleRefreshToken', payload.refresh_token)
  }
  return _googleAccess.token
}

async function buildIcloudClient() {
  const username = store.get('calendar.icloudUsername')
  const password = store.get('calendar.icloudAppPassword')
  if (!username || !password) throw new Error('NO_CREDS')
  return createDAVClient({
    serverUrl: ICLOUD_SERVER_URL,
    credentials: { username, password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  })
}

async function buildGoogleClient() {
  const username = store.get('calendar.googleEmail')
  const refreshToken = store.get('calendar.googleRefreshToken')
  if (!username || !refreshToken) throw new Error('NO_CREDS')
  // Verify token works (will throw NO_REFRESH_TOKEN / REFRESH_FAILED on issues)
  await getValidGoogleAccessToken()
  return createDAVClient({
    serverUrl: GOOGLE_SERVER_URL,
    credentials: {
      tokenUrl: GOOGLE_TOKEN_URL,
      username,
      refreshToken,
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
    },
    authMethod: 'Oauth',
    defaultAccountType: 'caldav',
  })
}

async function buildActiveClient() {
  const provider = store.get('calendar.provider')
  if (provider === 'icloud') return { provider, client: await buildIcloudClient() }
  if (provider === 'google') return { provider, client: await buildGoogleClient() }
  throw new Error('NO_PROVIDER')
}

ipcMain.handle('calendar:status', () => {
  const provider = store.get('calendar.provider')
  const connected =
    (provider === 'icloud' && !!store.get('calendar.icloudAppPassword')) ||
    (provider === 'google' && !!store.get('calendar.googleRefreshToken'))
  return {
    provider,
    connected,
    activeCalendarIds: store.get('calendar.activeCalendarIds') || [],
  }
})

ipcMain.handle('calendar:connect-icloud', async (_event, username, appPassword) => {
  if (!username || !appPassword) {
    return { ok: false, error: 'Username and app password required' }
  }
  try {
    const client = await createDAVClient({
      serverUrl: ICLOUD_SERVER_URL,
      credentials: { username, password: appPassword },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    })
    const cals = await client.fetchCalendars()
    // Persist only after we've verified it actually works
    store.set('calendar.provider', 'icloud')
    store.set('calendar.icloudUsername', username)
    store.set('calendar.icloudAppPassword', appPassword)
    store.set('calendar.googleRefreshToken', null)
    store.set('calendar.googleEmail', '')
    return { ok: true, calendars: cals.map(mapCalendar) }
  } catch (err) {
    console.error('[calendar/icloud] connect failed:', err?.message || err)
    return { ok: false, error: err?.message || 'iCloud connection failed' }
  }
})

ipcMain.handle('calendar:connect-google', async () => {
  if (_pendingGCalConnect) return { ok: false, error: 'Connect already in progress' }

  const state = crypto.randomBytes(16).toString('hex')
  const authUrl = new URL(GOOGLE_AUTH_URL)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI)
  authUrl.searchParams.set('scope', GOOGLE_SCOPE)
  authUrl.searchParams.set('access_type', 'offline') // we need refresh_token
  authUrl.searchParams.set('prompt', 'consent') // force consent so refresh_token is always returned
  authUrl.searchParams.set('state', state)

  return new Promise((resolve, reject) => {
    const authWin = new BrowserWindow({
      width: 480,
      height: 700,
      title: 'Connect Google Calendar',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    })

    const cleanup = (err) => {
      if (!authWin.isDestroyed()) authWin.close()
      clearPendingGCalConnect()
      if (err) reject(err)
    }

    const timeoutId = setTimeout(
      () => {
        cleanup(new Error('Connect timed out — window closed?'))
      },
      5 * 60 * 1000
    )

    _pendingGCalConnect = { resolve, reject, state, timeoutId }

    const intercept = async (event, url) => {
      if (!url.startsWith(GOOGLE_REDIRECT_URI)) return
      event.preventDefault()
      try {
        const parsed = new URL(url)
        const code = parsed.searchParams.get('code')
        const error = parsed.searchParams.get('error')
        const cbState = parsed.searchParams.get('state')

        if (error) throw new Error(error === 'access_denied' ? 'Permission denied' : error)
        if (cbState !== state) throw new Error('State mismatch (CSRF check failed)')
        if (!code) throw new Error('No authorization code returned')

        const tokenPayload = await exchangeGoogleToken({
          grant_type: 'authorization_code',
          code,
          redirect_uri: GOOGLE_REDIRECT_URI,
        })

        // Get the email needed to construct the CalDAV URL
        const userinfoRes = await fetch(GOOGLE_USERINFO, {
          headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
        })
        if (!userinfoRes.ok) throw new Error('Could not fetch Google account email')
        const userinfo = await userinfoRes.json()
        if (!userinfo.email) throw new Error('Google did not return an email')

        // Persist ONLY refresh token + email; access token in memory only.
        store.set('calendar.provider', 'google')
        store.set('calendar.googleRefreshToken', tokenPayload.refresh_token)
        store.set('calendar.googleEmail', userinfo.email)
        store.set('calendar.icloudUsername', '')
        store.set('calendar.icloudAppPassword', '')
        _googleAccess = {
          token: tokenPayload.access_token,
          expiresAt: Date.now() + tokenPayload.expires_in * 1000,
        }

        // Fetch calendar list now so the renderer can show the picker.
        const client = await buildGoogleClient()
        const cals = await client.fetchCalendars()

        cleanup()
        resolve({ ok: true, calendars: cals.map(mapCalendar) })
      } catch (err) {
        cleanup()
        resolve({ ok: false, error: err?.message || 'Google connect failed' })
      }
    }
    authWin.webContents.on('will-redirect', intercept)
    authWin.webContents.on('will-navigate', intercept)

    authWin.on('closed', () => {
      if (_pendingGCalConnect) {
        clearPendingGCalConnect()
        resolve({ ok: false, error: 'Auth window closed' })
      }
    })

    authWin.loadURL(authUrl.toString())
  })
})

ipcMain.handle('calendar:get-calendars', async () => {
  try {
    const { client } = await buildActiveClient()
    const cals = await client.fetchCalendars()
    return { ok: true, calendars: cals.map(mapCalendar) }
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not fetch calendars' }
  }
})

ipcMain.handle('calendar:set-active-calendars', (_event, ids) => {
  store.set('calendar.activeCalendarIds', Array.isArray(ids) ? ids : [])
  return true
})

ipcMain.handle('calendar:disconnect', () => {
  store.set('calendar.provider', null)
  store.set('calendar.icloudUsername', '')
  store.set('calendar.icloudAppPassword', '')
  store.set('calendar.googleRefreshToken', null)
  store.set('calendar.googleEmail', '')
  store.set('calendar.activeCalendarIds', [])
  _googleAccess = null
  return { ok: true }
})

// Map a tsdav calendar to the minimal shape the renderer needs.
function mapCalendar(cal) {
  // tsdav calendar shape: { url, displayName, ctag, calendarColor, components, ... }
  return {
    id: cal.url,
    name:
      typeof cal.displayName === 'string'
        ? cal.displayName
        : cal.displayName?._cdata || cal.displayName?.['#text'] || 'Untitled',
    color: cal.calendarColor || null,
  }
}

// Pull every VEVENT (including expanded recurring instances) out of a chunk
// of raw iCalendar data, returning future-only events as { start, title }.
function extractFutureEvents(rawICS, calendarName, lookaheadMs) {
  const now = Date.now()
  const horizon = now + lookaheadMs
  const out = []
  let parsed
  try {
    parsed = nodeIcal.sync.parseICS(rawICS)
  } catch {
    return out
  }
  for (const ev of Object.values(parsed)) {
    if (ev?.type !== 'VEVENT') continue
    const title = (ev.summary || '').toString().trim() || 'Untitled'

    // Recurring: expand within [now, horizon] using rrule
    if (ev.rrule) {
      let occurrences = []
      try {
        occurrences = ev.rrule.between(new Date(now), new Date(horizon), true)
      } catch {
        occurrences = []
      }
      for (const occ of occurrences) {
        const ts = occ.getTime()
        if (ts >= now && ts <= horizon) out.push({ start: ts, title, calendarName })
      }
    } else if (ev.start) {
      const ts = new Date(ev.start).getTime()
      if (ts >= now && ts <= horizon) out.push({ start: ts, title, calendarName })
    }
  }
  return out
}

ipcMain.handle('sys:calendar-next-event', async () => {
  let provider, client
  try {
    ;({ provider, client } = await buildActiveClient())
  } catch (err) {
    if (err.message === 'REFRESH_FAILED') {
      // Google refresh token revoked — wipe so the UI prompts reconnect.
      store.set('calendar.googleRefreshToken', null)
      _googleAccess = null
    }
    return { status: 'disconnected' }
  }

  let cals
  try {
    cals = await client.fetchCalendars()
  } catch (err) {
    console.error('[calendar] fetchCalendars failed:', err?.message || err)
    return { status: 'error' }
  }

  const activeIds = store.get('calendar.activeCalendarIds') || []
  const targets = activeIds.length ? cals.filter((c) => activeIds.includes(c.url)) : cals
  if (targets.length === 0) return { status: 'no-event' }

  const now = Date.now()
  const lookahead = EVENT_LOOKAHEAD_MS

  // Fan out across calendars; collect candidate events, pick the soonest.
  const allEvents = []
  await Promise.all(
    targets.map(async (cal) => {
      try {
        const objects = await client.fetchCalendarObjects({
          calendar: cal,
          timeRange: {
            start: new Date(now).toISOString(),
            end: new Date(now + lookahead).toISOString(),
          },
          // Google supports server-side expansion; iCloud ignores it harmlessly,
          // and we expand client-side via rrule as a fallback either way.
          expand: provider === 'google',
        })
        const calName = mapCalendar(cal).name
        for (const obj of objects) {
          if (!obj?.data) continue
          allEvents.push(...extractFutureEvents(obj.data, calName, lookahead))
        }
      } catch (err) {
        console.error(`[calendar] failed fetching "${cal.url}":`, err?.message || err)
      }
    })
  )

  if (allEvents.length === 0) return { status: 'no-event' }

  // Soonest future event
  allEvents.sort((a, b) => a.start - b.start)
  const next = allEvents[0]
  return {
    status: 'event',
    title: next.title,
    start: next.start,
    calendarName: next.calendarName,
  }
})

// ============================================================
//  QUICK SETTINGS — WiFi, Bluetooth, Caffeinate, Focus
// ============================================================

// ---------- WiFi ----------

ipcMain.handle('sys:wifi-status', async () => {
  try {
    const { stdout } = await execAsync('networksetup -getairportpower en0', { timeout: 3000 })
    const on = stdout.includes(': On')
    let ssid = ''
    if (on) {
      const conns = await si.wifiConnections().catch(() => [])
      ssid = conns[0]?.ssid || ''
    }
    return { on, ssid }
  } catch (err) {
    console.error('[wifi-status]', err?.message)
    return { on: false, ssid: '' }
  }
})

ipcMain.handle('sys:wifi-toggle', async (_event, on) => {
  const subcmd = `networksetup -setairportpower en0 ${on ? 'on' : 'off'}`
  try {
    await execAsync(`osascript -e 'do shell script "${subcmd}" with administrator privileges'`, {
      timeout: 30000,
    })
    return { ok: true }
  } catch (err) {
    console.error('[wifi-toggle]', err?.message)
    return { ok: false, error: err?.message || 'Toggle failed' }
  }
})

// ---------- Bluetooth ----------
// Modern macOS (Sonoma+) requires NSBluetoothAlwaysUsageDescription in the
// caller's Info.plist; TCC kills bare binaries that touch IOBluetooth even
// for power-state reads. We therefore package the helper as a tiny .app
// bundle and launch it via Launch Services (`open -W`) so TCC reads the
// bundle's Info.plist. Status results round-trip through a temp file since
// `open -W` doesn't pipe stdout back.

const BT_SWIFT_SOURCE = `import IOBluetooth
import Foundation

@_silgen_name("IOBluetoothPreferenceGetControllerPowerState")
func _btGet() -> Int32

@_silgen_name("IOBluetoothPreferenceSetControllerPowerState")
func _btSet(_ state: Int32)

let args = CommandLine.arguments
let cmd = args.dropFirst().first ?? "status"
let outPath = args.dropFirst(2).first ?? "/tmp/bento-bt-result"

switch cmd {
case "status":
  break
case "on":
  _btSet(1)
case "off":
  _btSet(0)
default:
  exit(2)
}

let final = _btGet() == 1 ? "on" : "off"
try? final.write(toFile: outPath, atomically: true, encoding: .utf8)
`

const BT_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.glitch.bento.bt-helper</string>
  <key>CFBundleExecutable</key>
  <string>bt-helper</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSBluetoothAlwaysUsageDescription</key>
  <string>Glitch Bento Box toggles your Mac's Bluetooth controller from the Quick Settings tile.</string>
</dict>
</plist>
`

// Lazily build the BT helper bundle once; cache the bundle path.
async function getBTHelper() {
  if (_btHelperPath) return _btHelperPath
  const dir = app.getPath('userData')
  const bundle = path.join(dir, 'bt-helper.app')
  const macos = path.join(bundle, 'Contents', 'MacOS')
  const binary = path.join(macos, 'bt-helper')
  const plist = path.join(bundle, 'Contents', 'Info.plist')
  const src = path.join(dir, 'bt-helper.swift')

  // Reuse existing bundle if both binary and plist already exist (skip recompile).
  try {
    await fs.promises.access(binary)
    await fs.promises.access(plist)
    _btHelperPath = bundle
    return bundle
  } catch {
    /* binary doesn't exist yet — fall through to compile */
  }

  // Build the .app bundle structure.
  await fs.promises.mkdir(macos, { recursive: true })
  await fs.promises.writeFile(plist, BT_INFO_PLIST)
  await fs.promises.writeFile(src, BT_SWIFT_SOURCE)
  await execAsync(`swiftc "${src}" -o "${binary}"`, { timeout: 60000 })
  // Ad-hoc sign so Launch Services treats the bundle as a real app.
  await execAsync(`codesign --force --sign - "${bundle}"`, { timeout: 10000 })

  _btHelperPath = bundle
  return bundle
}

// Run the helper via Launch Services; return the resulting state from the temp file.
async function runBTHelper(cmd) {
  const bundle = await getBTHelper()
  const resultPath = path.join(app.getPath('userData'), 'bt-result.txt')
  // Wipe any stale result so we never accept old data.
  await fs.promises.rm(resultPath, { force: true }).catch(() => {})
  await execAsync(`open -W "${bundle}" --args ${cmd} "${resultPath}"`, { timeout: 10000 })
  const out = await fs.promises.readFile(resultPath, 'utf8').catch(() => '')
  return out.trim()
}

ipcMain.handle('sys:bluetooth-status', async () => {
  try {
    const out = await runBTHelper('status')
    if (out === 'on' || out === 'off') return { on: out === 'on', available: true }
    throw new Error('helper returned no result')
  } catch {
    // Fallback: system_profiler — slow but always works without TCC.
    try {
      const { stdout } = await execAsync('system_profiler SPBluetoothDataType', { timeout: 8000 })
      return { on: stdout.includes('State: On'), available: false }
    } catch (err) {
      console.error('[bluetooth-status]', err?.message)
      return { on: false, available: false }
    }
  }
})

ipcMain.handle('sys:bluetooth-toggle', async (_event, on) => {
  try {
    await runBTHelper(on ? 'on' : 'off')
    return { ok: true }
  } catch (err) {
    console.error('[bluetooth-toggle]', err?.message)
    return { ok: false, error: err?.message || 'Toggle failed' }
  }
})

// ---------- Caffeinate ----------

ipcMain.handle('sys:caffeinate-status', async () => {
  // Check our own process first (fastest path).
  if (_caffeinateProc && !_caffeinateProc.killed) return { on: true }
  // Also catch stray caffeinate processes from before the app started.
  try {
    await execAsync('pgrep -x caffeinate', { timeout: 2000 })
    return { on: true }
  } catch {
    return { on: false }
  }
})

ipcMain.handle('sys:caffeinate-toggle', async (_event, on) => {
  if (on) {
    if (_caffeinateProc && !_caffeinateProc.killed) return { ok: true }
    _caffeinateProc = spawn('caffeinate', ['-d'], { detached: false })
    _caffeinateProc.on('exit', () => {
      _caffeinateProc = null
    })
  } else {
    if (_caffeinateProc) {
      _caffeinateProc.kill()
      _caffeinateProc = null
    }
    // Kill any stray system-level caffeinate processes too.
    await execAsync('pgrep -x caffeinate | xargs kill 2>/dev/null || true', {
      timeout: 2000,
    }).catch(() => {})
  }
  return { ok: true }
})

// ---------- Focus ----------

ipcMain.handle('sys:focus-set', async (_event, shortcutName) => {
  // null shortcutName = deactivate (no standard shortcut for this, so just clear locally)
  if (!shortcutName) return { ok: true }
  try {
    await execAsync(`/usr/bin/shortcuts run "${shortcutName}"`, { timeout: 15000 })
    return { ok: true }
  } catch {
    return { ok: false, notConfigured: true }
  }
})

ipcMain.handle('sys:open-shortcuts', async () => {
  await execAsync('open -a Shortcuts').catch(() => {})
})
