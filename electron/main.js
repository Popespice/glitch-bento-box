import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import si from 'systeminformation'
import Store from 'electron-store'
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from './spotify-config.js'

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
      username: '',
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
  },
})

// In-memory only — never persisted, dies when the process exits.
let _spotifyAccess = null    // { token: string, expiresAt: number (ms epoch) }
let _pendingConnect = null   // { resolve, reject, state, timeoutId } during OAuth flow

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
    } catch { /* fall through */ }
  }

  // Cross-platform fallback — works on some Windows/NVIDIA/AMD drivers, often 0 on Linux.
  try {
    const g = await si.graphics()
    const ctrl =
      g.controllers?.find((c) => typeof c.utilizationGpu === 'number') ??
      g.controllers?.[0]
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
  // Privacy: only return a boolean, never the token itself.
  spotify: { connected: !!store.get('spotify.refreshToken') },
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

const SPOTIFY_BASIC_AUTH = Buffer
  .from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)
  .toString('base64')

const SPOTIFY_SCOPE = 'user-read-currently-playing user-read-playback-state'
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000   // 5 minutes — abandon if user wanders off

async function exchangeSpotifyToken(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization':  `Basic ${SPOTIFY_BASIC_AUTH}`,
      'Content-Type':   'application/x-www-form-urlencoded',
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
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    })
  } catch (err) {
    console.error('[spotify] refresh failed:', err.message)
    throw new Error('REFRESH_FAILED')
  }

  _spotifyAccess = {
    token:     payload.access_token,
    expiresAt: Date.now() + (payload.expires_in * 1000),
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
  if (!_pendingConnect) return  // stale or unsolicited — ignore silently

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    _pendingConnect.reject(new Error('Malformed callback URL'))
    clearPendingConnect()
    return
  }

  const code  = parsed.searchParams.get('code')
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
      grant_type:   'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    })
    // Persist ONLY the refresh token. Access token + expiry stay in memory.
    store.set('spotify.refreshToken', payload.refresh_token)
    _spotifyAccess = {
      token:     payload.access_token,
      expiresAt: Date.now() + (payload.expires_in * 1000),
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
  authUrl.searchParams.set('client_id',     SPOTIFY_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri',  SPOTIFY_REDIRECT_URI)
  authUrl.searchParams.set('scope',         SPOTIFY_SCOPE)
  authUrl.searchParams.set('state',         state)
  authUrl.searchParams.set('show_dialog',   'true')

  return new Promise((resolve, reject) => {
    // Open a dedicated auth window so Electron intercepts the bento:// redirect
    // directly via will-redirect / will-navigate — no OS protocol routing needed.
    const authWin = new BrowserWindow({
      width:  480,
      height: 700,
      title:  'Connect Spotify',
      webPreferences: {
        nodeIntegration:  false,
        contextIsolation: true,
        sandbox:          true,
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
      handleSpotifyCallback(url)   // resolves / rejects _pendingConnect
      if (!authWin.isDestroyed()) authWin.close()
    }
    authWin.webContents.on('will-redirect', interceptRedirect)
    authWin.webContents.on('will-navigate',  interceptRedirect)

    // User closed the window without completing auth.
    authWin.on('closed', () => {
      if (_pendingConnect) cleanup(new Error('Auth window closed'))
    })

    authWin.loadURL(authUrl.toString())
  }).then(
    (result) => result,
    (err)    => ({ ok: false, error: err.message }),
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

  if (res.status === 204) return { status: 'idle' }    // nothing playing
  if (!res.ok)            return { status: 'error' }

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
    status:    'playing',
    isPlaying: !!data.is_playing,
    track: {
      name:     data.item.name,
      artist:   (data.item.artists ?? []).map((a) => a.name).join(' / '),
      duration: Math.floor((data.item.duration_ms ?? 0) / 1000),
    },
    position: Math.floor((data.progress_ms ?? 0) / 1000),
  }
})
