import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import si from 'systeminformation'
import Store from 'electron-store'
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from './google-calendar-config.js'

// Redirect URIs are identical for every install (the user must add them to
// their OAuth App's allowed list during registration). The OAuth client_ids
// themselves are user-supplied at runtime via Settings (see store schema).
const SPOTIFY_REDIRECT_URI = 'bento://callback'

function getGithubClientId() {
  return (store.get('github.clientId') || '').trim()
}

function getSpotifyClientId() {
  return (store.get('spotify.clientId') || '').trim()
}
import { createDAVClient } from 'tsdav'
import nodeIcal from 'node-ical'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Screen-size presets. Window is resized to these dimensions and the renderer
// is zoomed by targetWidth / DESIGN_WIDTH so pixel-based UI (DotMatrix dots,
// fixed font sizes) scales proportionally with the canvas.
const DESIGN_WIDTH = 1440
const SCREEN_PRESETS = {
  native: { w: 1440, h: 900 },
  '1080p': { w: 1920, h: 1080 },
  '2.5k': { w: 2560, h: 1440 },
  '4k': { w: 3840, h: 2160 },
}

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
      // IANA timezone (e.g. "America/New_York"). Resolved by the geocoder
      // alongside lat/lon and used by the clock tile.
      timezone: '',
    },
    github: {
      clientId: '',      // user-supplied OAuth App client_id (from github.com/settings/applications)
      username: '',      // manual override / gh-CLI fallback
      accessToken: null, // GitHub OAuth access token (stored after Connect)
      login: '',         // username resolved via OAuth
    },
    pomodoro: {
      minutes: 25,
    },
    // Privacy: this section holds exactly two fields — the user-supplied
    // client_id (a public identifier they pasted from developer.spotify.com),
    // and the OAuth refresh token (only after the user explicitly clicks
    // Connect, nulled on Disconnect). No client_secret (PKCE eliminates the
    // need for one), no access token (kept in main-process memory only),
    // no display name, no email/profile/listening data of any kind.
    spotify: {
      clientId: '',      // user-supplied OAuth App client_id (from developer.spotify.com)
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
    ui: {
      // 1.0 = floor (current sizes); valid presets: 1.0 / 1.15 / 1.3 / 1.5
      textScale: 1.0,
      // 'native' (1440x900) | '1080p' | '2.5k' | '4k' | 'custom' (set when
      // the user manually drags the window so the Settings UI doesn't show a
      // stale highlighted button).
      screenSize: 'native',
    },
  },
})

// In-memory only — never persisted, dies when the process exits.
let _spotifyAccess = null // { token: string, expiresAt: number (ms epoch) }
let _pendingConnect = null // { resolve, reject, state, timeoutId } during Spotify OAuth flow
let _googleAccess = null // { token: string, expiresAt: number }
let _pendingGCalConnect = null // { resolve, reject, state, timeoutId } during Google OAuth flow
let _powerSaveId = null // number | null — Electron powerSaveBlocker ID while keep-awake is on
let _btHelperPath = null // string | null — path to compiled Swift BT helper binary
let _wifiAdapterName = null // string | null — cached Windows Wi-Fi interface name
let _githubDeviceFlow = null // { deviceCode, timerId, abort } during active GitHub Device Flow

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const DIST_PATH = path.join(__dirname, '../dist')

let mainWindow
let _suppressResizeListener = false // set true while we programmatically resize

// Resolve a screen-size preset to the actual window dims + zoom that should
// be applied. Clamps to the workArea of the display the window currently
// sits on so a 4K request on a 1080p panel degrades gracefully.
function resolveScreenSize(presetKey, displayBounds) {
  const preset = SCREEN_PRESETS[presetKey] || SCREEN_PRESETS.native
  const display = displayBounds
    ? screen.getDisplayMatching(displayBounds)
    : screen.getPrimaryDisplay()
  const wa = display.workAreaSize
  const width = Math.min(preset.w, wa.width)
  const height = Math.min(preset.h, wa.height)
  return { width, height, zoom: width / DESIGN_WIDTH, workArea: display.workArea }
}

function createWindow() {
  const storedPreset = store.get('ui.screenSize') || 'native'
  const initial = resolveScreenSize(storedPreset)

  mainWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
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
      zoomFactor: initial.zoom,
    },
  })

  // Detect manual user resize → mark preset as 'custom' so the Settings UI
  // doesn't show a stale highlighted button. Debounced so live drags don't
  // spam the store. Suppressed during programmatic setBounds calls below.
  let resizeTimer = null
  mainWindow.on('resize', () => {
    if (_suppressResizeListener) return
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      const ui = store.get('ui') || {}
      if (ui.screenSize !== 'custom') {
        store.set('ui', { ...ui, screenSize: 'custom' })
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ui:screen-size-changed', 'custom')
        }
      }
    }, 200)
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

// Release the keep-awake hold when the app exits so the system can sleep
// normally. powerSaveBlocker.stop is a no-op if the ID is already released
// or invalid, so this is safe to call unconditionally.
app.on('before-quit', () => {
  if (_powerSaveId != null) {
    try { powerSaveBlocker.stop(_powerSaveId) } catch { /* ignore */ }
    _powerSaveId = null
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

// ---------- System stats cache ----------
//
// All hardware-stat IPC handlers serve from a single shared cache that is
// refreshed by one background loop every STATS_INTERVAL_MS. This eliminates
// N overlapping systeminformation/ioreg subprocess calls (one per tile) and
// replaces them with a single coordinated fetch. Tiles can poll as fast as
// they like — the main process does real work at most once per interval.

const STATS_INTERVAL_MS = 3000 // one sweep every 3 s
const STATS_TTL_MS = STATS_INTERVAL_MS + 500 // cache is "fresh" for 3.5 s

let _statsCache = null // { cpu, gpu, memory, network, battery, disk, fetchedAt }

// GPU model never changes mid-session — cache it after the first lookup.
let _gpuModelCache = null
async function getGpuModel() {
  if (_gpuModelCache) return _gpuModelCache
  try {
    const g = await si.graphics()
    const ctrl = g.controllers?.[0]
    _gpuModelCache = ctrl?.model || ctrl?.name || 'GPU'
  } catch {
    _gpuModelCache = 'GPU'
  }
  return _gpuModelCache
}

function normalizeSsid(raw) {
  if (!raw || typeof raw !== 'string') return null
  if (raw.toLowerCase().includes('redacted')) return null
  return raw
}

// Resolve to `fallback` after `ms` so a single hung systeminformation call
// can't stall the whole sweep. (E.g. si.networkStats() can hang indefinitely
// on Windows.) Failed calls also resolve to `fallback`.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

const SYSTEM_DRIVE = (process.env.SystemDrive || 'C:').toUpperCase()

// ---------- Windows-specific stat helpers ----------
//
// systeminformation's Windows backend has two gaps:
//   1. si.graphics() doesn't populate `utilizationGpu`.
//   2. si.networkStats() hangs (5s+) regardless of interface argument.
// nvidia-smi covers (1) for NVIDIA cards, and `netstat -e` covers (2) with
// a manual delta calculation.

async function getGpuStatsWindows() {
  let percent = null
  let model = null
  let powerDrawW = null
  let powerLimitW = null
  let temperatureGpu = null
  let utilizationMemory = null

  // nvidia-smi: gives us utilization.gpu (which si.graphics() omits) plus
  // power.draw/power.limit/temperature in one cheap call. Sub-second on
  // machines with NVIDIA drivers; throws ENOENT otherwise.
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=utilization.gpu,power.draw,power.limit,temperature.gpu,name --format=csv,noheader,nounits',
      { timeout: 2000 },
    )
    const line = stdout.split('\n').find((l) => l.trim().length > 0) ?? ''
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length >= 5) {
      percent = Number(parts[0])
      powerDrawW = Number(parts[1])
      powerLimitW = Number(parts[2])
      temperatureGpu = Number(parts[3])
      model = parts[4]
    }
  } catch { /* nvidia-smi unavailable — fall through */ }

  // si.graphics() supplements with utilizationMemory and (sometimes) the
  // same power/temp numbers — useful as a fallback when nvidia-smi is missing.
  try {
    const g = await si.graphics()
    const ctrl =
      g.controllers?.find((c) => c.vendor?.toLowerCase().includes('nvidia')) ??
      g.controllers?.[0]
    if (ctrl) {
      if (model == null) model = ctrl.model || ctrl.name || 'GPU'
      if (powerDrawW == null && typeof ctrl.powerDraw === 'number') powerDrawW = ctrl.powerDraw
      if (powerLimitW == null && typeof ctrl.powerLimit === 'number') powerLimitW = ctrl.powerLimit
      if (temperatureGpu == null && typeof ctrl.temperatureGpu === 'number') {
        temperatureGpu = ctrl.temperatureGpu
      }
      if (typeof ctrl.utilizationMemory === 'number') utilizationMemory = ctrl.utilizationMemory
    }
  } catch { /* ignore */ }

  return {
    percent: percent != null ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
    model: model ?? 'GPU',
    powerDrawW,
    powerLimitW,
    temperatureGpu,
    utilizationMemory,
  }
}

// Cross-sweep state for Windows network rate calculation. `netstat -e` returns
// cumulative byte counters; we need two samples to compute a rate.
let _lastNetSample = null

async function getNetStatsWindows() {
  const fallback =
    _statsCache?.network ??
    { down: 0, up: 0, iface: 'n/a', ssid: null, type: 'unknown', ip: null, signalQuality: null }
  try {
    const { stdout } = await execAsync('netstat -e', { timeout: 2000 })
    const m = stdout.match(/Bytes\s+(\d+)\s+(\d+)/)
    if (!m) return fallback
    const rxBytes = Number(m[1])
    const txBytes = Number(m[2])
    const now = Date.now()
    const last = _lastNetSample
    _lastNetSample = { rxBytes, txBytes, t: now }
    let down = 0
    let up = 0
    if (last && now > last.t) {
      const elapsed = (now - last.t) / 1000
      down = Math.max(0, (rxBytes - last.rxBytes) / elapsed)
      up = Math.max(0, (txBytes - last.txBytes) / elapsed)
    }
    let iface = 'net'
    let ip = null
    let type = 'unknown'
    try {
      const i = await si.networkInterfaces('default')
      const def = Array.isArray(i) ? i.find((x) => x.default) ?? i[0] : i
      if (def) {
        iface = def.iface
        ip = def.ip4 ?? null
        type = def.type === 'wireless' ? 'wifi' : 'wired'
      }
    } catch { /* ignore */ }
    return { down, up, iface, ssid: null, type, ip, signalQuality: null }
  } catch {
    return fallback
  }
}

async function sweepStats() {
  // Each si.*() call gets its own timeout + fallback so one slow call can't
  // poison the whole sweep. Last-known-good values come from _statsCache.
  const prev = _statsCache
  const isWin = process.platform === 'win32'

  // 1. CPU — cross-platform via systeminformation
  const [load, cpuInfo] = await Promise.all([
    withTimeout(si.currentLoad(), 2500, null),
    withTimeout(si.cpu(), 2500, null),
  ])
  const cpu = load
    ? {
        percent: Math.round(load.currentLoad),
        cores: load.cpus?.map((c) => Math.round(c.load)) ?? [],
        speedGhz: cpuInfo?.speed ?? prev?.cpu?.speedGhz ?? 0,
        brand: cpuInfo
          ? `${cpuInfo.manufacturer} ${cpuInfo.brand}`
          : (prev?.cpu?.brand ?? ''),
      }
    : (prev?.cpu ?? { percent: 0, cores: [], speedGhz: 0, brand: '' })

  // 2. GPU — Windows uses nvidia-smi + si.graphics() (utilizationGpu missing
  // from si on Windows); macOS uses ioreg; everything else falls back to si.
  const gpuProm = isWin
    ? getGpuStatsWindows()
    : (async () => {
        if (process.platform === 'darwin') {
          try {
            const { stdout } = await execAsync('ioreg -rc IOAccelerator', { timeout: 2000 })
            const match = stdout.match(/"Device Utilization %"=(\d+)/)
            if (match) {
              return {
                percent: Math.max(0, Math.min(100, parseInt(match[1], 10))),
                model: await getGpuModel(),
              }
            }
          } catch { /* fall through */ }
        }
        try {
          const g = await si.graphics()
          const ctrl =
            g.controllers?.find((c) => typeof c.utilizationGpu === 'number') ?? g.controllers?.[0]
          return {
            percent: Math.max(0, Math.min(100, Math.round(ctrl?.utilizationGpu ?? 0))),
            model: ctrl?.model || ctrl?.name || 'GPU',
          }
        } catch { /* ignore */ }
        return prev?.gpu ?? { percent: 0, model: 'GPU' }
      })()

  // 3. Network — Windows uses `netstat -e` with a delta calc (si.networkStats
  // hangs on Windows). macOS keeps the existing si-based path.
  const netProm = isWin
    ? getNetStatsWindows()
    : (async () => {
        const [netStats, wifiList, ifaceInfo] = await Promise.all([
          withTimeout(si.networkStats(), 2000, []),
          withTimeout(si.wifiConnections(), 2000, []),
          withTimeout(si.networkInterfaces('default'), 2000, null),
        ])
        const primary = Array.isArray(netStats) ? netStats[0] : null
        const wifiConn =
          (Array.isArray(wifiList) &&
            (wifiList.find((w) => w.iface === primary?.iface) ?? wifiList[0])) ||
          null
        const iface = Array.isArray(ifaceInfo)
          ? ifaceInfo.find((i) => i.iface === primary?.iface)
          : ifaceInfo
        const isWifi = !!wifiConn || iface?.type === 'wireless'
        return primary
          ? {
              down: Math.max(0, primary.rx_sec ?? 0),
              up: Math.max(0, primary.tx_sec ?? 0),
              iface: primary.iface,
              ssid: normalizeSsid(wifiConn?.ssid),
              type: isWifi ? 'wifi' : 'wired',
              ip: iface?.ip4 ?? null,
              signalQuality: wifiConn?.quality ?? null,
            }
          : (prev?.network ?? {
              down: 0, up: 0, iface: 'n/a', ssid: null, type: 'unknown', ip: null,
            })
      })()

  // 4. Memory, Battery, Disk — cross-platform via systeminformation
  const [mem, bat, disks, gpu, network] = await Promise.all([
    withTimeout(si.mem(), 2000, null),
    withTimeout(si.battery(), 2000, null),
    withTimeout(si.fsSize(), 2500, []),
    withTimeout(gpuProm, 3000, prev?.gpu ?? { percent: 0, model: 'GPU' }),
    withTimeout(netProm, 3000, prev?.network ?? {
      down: 0, up: 0, iface: 'n/a', ssid: null, type: 'unknown', ip: null,
    }),
  ])

  // Memory
  const memory = mem
    ? {
        totalGB: Number((mem.total / 1e9).toFixed(1)),
        usedGB: Number(((mem.total - mem.available) / 1e9).toFixed(1)),
        swapGB: Number((mem.swapused / 1e9).toFixed(1)),
        pct: Math.round(((mem.total - mem.available) / mem.total) * 100),
      }
    : (prev?.memory ?? { totalGB: 0, usedGB: 0, swapGB: 0, pct: 0 })

  // Battery — on a desktop with no battery, surface GPU power-draw fields so
  // the BatteryTile can render a "POWER" view instead of a useless "AC ONLY".
  const batteryBase = bat
    ? {
        hasBattery: bat.hasBattery,
        percent: bat.percent,
        isCharging: bat.isCharging,
        acConnected: bat.acConnected,
        timeRemaining: bat.timeRemaining ?? -1,
      }
    : (prev?.battery ?? {
        hasBattery: false,
        percent: 0,
        isCharging: false,
        acConnected: true,
        timeRemaining: -1,
      })
  const battery =
    !batteryBase.hasBattery && gpu?.powerDrawW != null && gpu?.powerLimitW
      ? { ...batteryBase, powerDrawW: gpu.powerDrawW, powerLimitW: gpu.powerLimitW }
      : batteryBase

  // Disk — keep only non-virtual mounts
  const diskList = (disks ?? [])
    .filter((d) => !d.fs.startsWith('dev') && d.size > 0)
    .map((d) => ({
      fs: d.fs,
      mount: d.mount,
      totalGB: Number((d.size / 1e9).toFixed(1)),
      usedGB: Number((d.used / 1e9).toFixed(1)),
      freeGB: Number(((d.size - d.used) / 1e9).toFixed(1)),
      pct: Math.round((d.used / d.size) * 100),
    }))
  // Pick the system drive: '/' on Unix, the SystemDrive (e.g. 'C:') on Windows.
  const mainDisk =
    diskList.find((d) => d.mount === '/' || d.mount?.toUpperCase() === SYSTEM_DRIVE) ??
    diskList[0] ??
    null
  const diskResult = mainDisk
    ? {
        totalGB: mainDisk.totalGB,
        usedGB: mainDisk.usedGB,
        freeGB: mainDisk.freeGB,
        pct: mainDisk.pct,
      }
    : (prev?.disk ?? null)

  _statsCache = { cpu, gpu, memory, network, battery, disk: diskResult, fetchedAt: Date.now() }
}

// Prime the cache immediately then sweep on schedule
sweepStats()
setInterval(sweepStats, STATS_INTERVAL_MS)

/** Return cached stats, doing a blocking fetch if cache is cold. */
async function getStats(key) {
  if (_statsCache && Date.now() - _statsCache.fetchedAt < STATS_TTL_MS) {
    return _statsCache[key] ?? null
  }
  // Cold start or stale — wait for a fresh sweep
  await sweepStats()
  return _statsCache?.[key] ?? null
}

// ---------- IPC handlers (system stats) ----------

ipcMain.handle('sys:platform', () => ({
  platform: process.platform,
  arch: process.arch,
  release: process.getSystemVersion?.() ?? '',
}))

ipcMain.handle('sys:cpu', () => getStats('cpu'))
ipcMain.handle('sys:gpu', () => getStats('gpu'))
ipcMain.handle('sys:memory', () => getStats('memory'))

ipcMain.handle('sys:network', () => getStats('network'))
ipcMain.handle('sys:battery', () => getStats('battery'))
ipcMain.handle('sys:disk', () => getStats('disk'))

ipcMain.handle('sys:uptime', async () => {
  const t = await si.time()
  return { uptime: t.uptime } // seconds since boot — cheap, not cached
})

// Fire-and-forget: plays a system "ding" sound when the Pomodoro timer ends.
// macOS plays one of the named system sounds (Glass, Hero, etc.); Windows
// plays a built-in notification WAV via PowerShell's SoundPlayer.
ipcMain.handle('sys:play-sound', (_event, sound = 'Glass') => {
  if (process.platform === 'darwin') {
    exec(`afplay "/System/Library/Sounds/${sound}.aiff"`)
  } else if (process.platform === 'win32') {
    // Windows ships several .wav files in C:\Windows\Media. Alarm04 is a
    // bright two-tone chime that's a reasonable analogue to macOS Glass.
    exec(
      `powershell -NoProfile -Command "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Alarm04.wav').PlaySync()"`,
    )
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
  // Privacy: never return the access token to the renderer. The Settings UI
  // only needs the client_id (so it can show "Configured ✓" vs "Not configured")
  // and the manual username override.
  github: {
    clientId: store.get('github.clientId') || '',
    username: store.get('github.username') || '',
  },
  spotify: {
    clientId: store.get('spotify.clientId') || '',
    connected: !!store.get('spotify.refreshToken'),
  },
  ui: store.get('ui'),
}))

ipcMain.handle('settings:set', (_event, key, value) => {
  // For object-shaped sections (ui, weather, github, calendar) merge with the
  // current value rather than replacing — otherwise a partial update like
  // `{ textScale }` would clobber sibling keys like `screenSize`.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const current = store.get(key)
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      store.set(key, { ...current, ...value })
    } else {
      store.set(key, value)
    }
  } else {
    store.set(key, value)
  }

  // Invalidate relevant caches so the next poll picks up new values
  if (key.startsWith('weather')) {
    _weatherCache = null
    _weatherFetchedAt = 0
  }
  if (key.startsWith('github')) {
    _heatmapCache = null
    _heatmapFetchedAt = 0
  }

  // Apply screen-size preset: resize the window, recenter on the current
  // display, and push the new zoom factor to the renderer.
  if (key === 'ui' && value && typeof value === 'object' && 'screenSize' in value) {
    const newPreset = value.screenSize
    if (newPreset && newPreset !== 'custom' && mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds()
      const resolved = resolveScreenSize(newPreset, bounds)
      const wa = resolved.workArea
      const x = Math.round(wa.x + (wa.width - resolved.width) / 2)
      const y = Math.round(wa.y + (wa.height - resolved.height) / 2)
      _suppressResizeListener = true
      mainWindow.setBounds({ x, y, width: resolved.width, height: resolved.height })
      // Re-enable the resize listener after the OS has finished animating.
      setTimeout(() => {
        _suppressResizeListener = false
      }, 400)
      mainWindow.webContents.send('ui:zoom-changed', resolved.zoom)
      mainWindow.webContents.send('ui:screen-size-changed', newPreset)
    }
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
      timezone: r.timezone || '',
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
// Auth flow: OAuth 2.0 Authorization Code with PKCE (no client_secret).
// The user clicks Connect → main opens a minimal BrowserWindow pointed at the
// Spotify authorize URL with a code_challenge → user approves in that window
// → Spotify issues a redirect to bento://callback?code=...&state=... →
// Electron's will-redirect / will-navigate events intercept the bento:// URL
// before the OS ever sees it → handleSpotifyCallback exchanges the code (with
// the matching code_verifier) for tokens → window closes.
//
// Using an in-app window (rather than shell.openExternal + OS protocol routing)
// is reliable in both dev and production: no Info.plist registration required,
// no single-instance lock races, no macOS security quarantine edge cases.
//
// Privacy: only the refresh token is persisted to electron-store. Access tokens
// + display name + everything else stays in main-process memory or is never
// requested at all. See store defaults at the top of this file.

const SPOTIFY_SCOPE = 'user-read-currently-playing user-read-playback-state'
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — abandon if user wanders off

// PKCE: client generates a random verifier, sends sha256(verifier) as the
// challenge in the authorize request, and proves possession by sending the
// raw verifier back in the token exchange. No client_secret needed.
function generateCodeVerifier() {
  // 64 random bytes → ~86 base64url chars, well within the 43–128 spec range.
  return crypto.randomBytes(64).toString('base64url')
}

function computeCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

// Token exchange (both authorization_code and refresh_token grants). PKCE
// requires client_id in the body and forbids Basic auth, so callers pass
// code_verifier (for code grant) or just refresh_token (for refresh). The
// client_id is read from the store at call time so the user's runtime-
// configured value is always used (not a stale snapshot from app startup).
async function exchangeSpotifyToken(params) {
  const clientId = getSpotifyClientId()
  if (!clientId) throw new Error('Spotify OAuth not configured')
  const body = new URLSearchParams({ ...params, client_id: clientId })
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
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
      code_verifier: _pendingConnect.codeVerifier,
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
  // Refuse to start if the client_id isn't set — opening the auth window with
  // a placeholder just shows a Spotify error page with no redirect, which
  // wedges the UI until the user finds and closes the orphaned window.
  const clientId = getSpotifyClientId()
  if (!clientId) {
    return {
      ok: false,
      error: 'Spotify OAuth not configured. Open Settings → Spotify → OAuth App to add your client ID.',
    }
  }

  // Supersede any orphaned in-flight connect (e.g. from a previous attempt
  // where the auth window got hidden and the user reopened Settings).
  if (_pendingConnect?.cancel) _pendingConnect.cancel(new Error('Superseded'))

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = computeCodeChallenge(codeVerifier)
  const state = crypto.randomBytes(16).toString('hex')
  const authUrl = new URL('https://accounts.spotify.com/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI)
  authUrl.searchParams.set('scope', SPOTIFY_SCOPE)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('show_dialog', 'true')

  return new Promise((resolve, reject) => {
    // Open a dedicated auth window so Electron intercepts the bento:// redirect
    // directly via will-redirect / will-navigate — no OS protocol routing needed.
    // parent: mainWindow keeps the auth window above main on Windows so it
    // can't get hidden behind and orphaned.
    const authWin = new BrowserWindow({
      width: 480,
      height: 700,
      title: 'Connect Spotify',
      parent: mainWindow ?? undefined,
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

    _pendingConnect = { resolve, reject, state, timeoutId, cancel: cleanup, codeVerifier }

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

ipcMain.handle('spotify:connect-cancel', () => {
  if (_pendingConnect?.cancel) {
    _pendingConnect.cancel(new Error('Cancelled'))
  }
  return { ok: true }
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

// ---------- GitHub Personal Access Token ----------
//
// Simpler than OAuth for a personal app — user generates a PAT at
// github.com/settings/tokens with read:user scope, pastes it into Settings,
// and we validate it once by hitting api.github.com/user to resolve the login.
// Token is stored in electron-store; no rebuild or OAuth App required.

// GitHub OAuth Device Flow — same UX as `gh auth login -w`. The user clicks
// Sign In, the OS browser opens to github.com/login/device with the user code
// pre-filled, they click Authorize, and we poll until GitHub gives us an
// access token. No client_secret, no callback URL, identical on Mac/Windows.

ipcMain.handle('github:connect-start', async () => {
  // Cancel any in-flight flow before starting a new one
  if (_githubDeviceFlow) {
    if (_githubDeviceFlow.timerId) clearTimeout(_githubDeviceFlow.timerId)
    _githubDeviceFlow.abort = true
    _githubDeviceFlow = null
  }

  const clientId = getGithubClientId()
  if (!clientId) {
    return {
      ok: false,
      error: 'GitHub OAuth not configured. Open Settings → GitHub → OAuth App to add your client ID.',
    }
  }

  let codeData
  try {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: 'read:user' }),
    })
    if (!res.ok) return { ok: false, error: `GitHub responded ${res.status}` }
    codeData = await res.json()
  } catch (err) {
    return { ok: false, error: err.message }
  }

  const { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval } = codeData
  if (!device_code || !user_code) {
    return { ok: false, error: 'GitHub did not return device flow fields' }
  }

  const fullUri = verification_uri_complete || verification_uri || 'https://github.com/login/device'
  const expiresAt = Date.now() + (expires_in || 900) * 1000

  // Auto-open the OS browser. If this fails (e.g. no default browser set) the
  // user can still copy the URL from the renderer's "Reopen" button.
  shell.openExternal(fullUri).catch(() => {})

  const flow = { deviceCode: device_code, abort: false, timerId: null }
  _githubDeviceFlow = flow
  let pollIntervalMs = (interval || 5) * 1000

  const poll = async () => {
    if (flow.abort) return
    if (Date.now() > expiresAt) {
      _githubDeviceFlow = null
      mainWindow?.webContents.send('github:auth-result', { ok: false, error: 'Code expired' })
      return
    }
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      })
      const data = await res.json()

      if (data.access_token) {
        let login = ''
        try {
          const ur = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${data.access_token}`, Accept: 'application/vnd.github+json' },
          })
          if (ur.ok) login = (await ur.json()).login || ''
        } catch { /* token still valid even if /user lookup fails */ }
        store.set('github.accessToken', data.access_token)
        store.set('github.login', login)
        _heatmapCache = null
        _heatmapFetchedAt = 0
        _githubDeviceFlow = null
        mainWindow?.webContents.send('github:auth-result', { ok: true, login })
        return
      }

      // Per spec: authorization_pending → keep polling; slow_down → +5s; everything else → fail
      if (data.error === 'authorization_pending') {
        // no-op, keep polling at current interval
      } else if (data.error === 'slow_down') {
        pollIntervalMs += 5000
      } else if (data.error === 'expired_token') {
        _githubDeviceFlow = null
        mainWindow?.webContents.send('github:auth-result', { ok: false, error: 'Code expired' })
        return
      } else if (data.error === 'access_denied') {
        _githubDeviceFlow = null
        mainWindow?.webContents.send('github:auth-result', { ok: false, error: 'Authorization denied' })
        return
      } else if (data.error) {
        _githubDeviceFlow = null
        mainWindow?.webContents.send('github:auth-result', {
          ok: false,
          error: data.error_description || data.error,
        })
        return
      }
    } catch { /* transient network error — keep polling */ }

    if (!flow.abort) flow.timerId = setTimeout(poll, pollIntervalMs)
  }

  flow.timerId = setTimeout(poll, pollIntervalMs)
  return { ok: true, userCode: user_code, verificationUri: fullUri, expiresAt }
})

ipcMain.handle('github:connect-cancel', () => {
  if (_githubDeviceFlow) {
    if (_githubDeviceFlow.timerId) clearTimeout(_githubDeviceFlow.timerId)
    _githubDeviceFlow.abort = true
    _githubDeviceFlow = null
  }
  return { ok: true }
})

// Open a github.com URL in the user's default browser — used by the renderer
// to "reopen" the device-flow verification page if they accidentally close it.
ipcMain.handle('app:open-external', (_event, url) => {
  if (typeof url !== 'string') return { ok: false }
  if (!/^https:\/\/github\.com\//i.test(url)) return { ok: false, error: 'Only github.com URLs allowed' }
  shell.openExternal(url).catch(() => {})
  return { ok: true }
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
  // Refuse to start with placeholder credentials — same wedge as Spotify
  // (Google's invalid_client page doesn't redirect, so the orphan auth window
  // strands the renderer's "WAITING FOR BROWSER…" state).
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('paste-')) {
    return { ok: false, error: 'Google not configured — set credentials in electron/google-calendar-config.js' }
  }
  if (!GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET.startsWith('paste-')) {
    return { ok: false, error: 'Google not configured — set credentials in electron/google-calendar-config.js' }
  }

  // Supersede any orphaned in-flight connect.
  if (_pendingGCalConnect?.cancel) _pendingGCalConnect.cancel(new Error('Superseded'))

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
      parent: mainWindow ?? undefined,
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

    _pendingGCalConnect = { resolve, reject, state, timeoutId, cancel: cleanup }

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

ipcMain.handle('calendar:connect-google-cancel', () => {
  if (_pendingGCalConnect?.cancel) {
    _pendingGCalConnect.cancel(new Error('Cancelled'))
  }
  return { ok: true }
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

// ---------- Windows Wi-Fi helpers ----------
//
// `netsh wlan show interfaces` is unreliable on some Windows configs; we use
// `netsh interface show interface` (always works) for adapter state and
// Get-NetConnectionProfile for the connected SSID.
// Toggling requires admin — try direct first, fall back to UAC elevation.

async function getWifiStatusWindows() {
  try {
    const { stdout } = await execAsync('netsh interface show interface', { timeout: 2000 })
    // Find the line for the Wi-Fi adapter (case-insensitive name match)
    const adapterLine = stdout.split('\n').find(
      (l) => l.toLowerCase().includes('wi-fi') || l.toLowerCase().includes('wireless'),
    )
    if (!adapterLine) return { on: false, ssid: '' }

    const isDisabled = adapterLine.toLowerCase().includes('disabled')
    if (isDisabled) return { on: false, ssid: '' }

    // Extract interface name — everything after the Type column (Dedicated/etc.)
    const nameMatch = adapterLine.match(/(?:Dedicated|Loopback|PPP)\s+(\S[\s\S]+?)\s*$/)
    const adapterName = nameMatch ? nameMatch[1].trim() : null
    if (adapterName && !_wifiAdapterName) _wifiAdapterName = adapterName

    const isConnected = adapterLine.toLowerCase().includes(' connected')
    if (!isConnected) return { on: true, ssid: '' }

    // SSID from the connection profile
    const name = _wifiAdapterName
    if (!name) return { on: true, ssid: '' }
    try {
      const { stdout: p } = await execAsync(
        `powershell -NoProfile -Command "(Get-NetConnectionProfile -InterfaceAlias '${name}' -ErrorAction SilentlyContinue).Name"`,
        { timeout: 2000 },
      )
      return { on: true, ssid: p.trim() || '' }
    } catch {
      return { on: true, ssid: '' }
    }
  } catch {
    return { on: false, ssid: '' }
  }
}

async function toggleWifiWindows(on) {
  // Ensure we have the adapter name (status populates _wifiAdapterName as a side-effect)
  if (!_wifiAdapterName) await getWifiStatusWindows()
  const adapter = _wifiAdapterName
  if (!adapter) return { ok: false, error: 'No Wi-Fi adapter found' }
  const action = on ? 'enable' : 'disable'
  // Try without elevation (succeeds if process already has admin rights)
  try {
    await execAsync(`netsh interface set interface "${adapter}" ${action}`, { timeout: 5000 })
    return { ok: true }
  } catch { /* needs elevation */ }
  // Elevate via UAC — user sees a Windows admin-consent dialog
  try {
    await execAsync(
      `powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList 'interface set interface ""${adapter}"" ${action}'"`,
      { timeout: 30000 },
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'Toggle failed' }
  }
}

// ---------- Windows Bluetooth helpers ----------
//
// The WinRT Radio API requires UWP capability declarations that Electron
// doesn't have, so we use Get-PnpDevice / Enable|Disable-PnpDevice instead.
// The USB-based host controller (VID 8087 for Intel, etc.) represents the
// radio; its Status 'OK' means the radio is active.

async function getBtStatusWindows() {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'USB*' } | Select-Object -First 1 -ExpandProperty Status"`,
      { timeout: 3000 },
    )
    const status = stdout.trim()
    return { on: status === 'OK', available: status.length > 0 }
  } catch {
    return { on: false, available: false }
  }
}

async function toggleBtWindows(on) {
  try {
    const { stdout: idOut } = await execAsync(
      `powershell -NoProfile -Command "Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'USB*' } | Select-Object -First 1 -ExpandProperty InstanceId"`,
      { timeout: 3000 },
    )
    const instanceId = idOut.trim()
    if (!instanceId) return { ok: false, error: 'Bluetooth adapter not found' }
    const action = on ? 'Enable-PnpDevice' : 'Disable-PnpDevice'
    // Write a temp ps1 to avoid quoting InstanceId (which contains & and \)
    const scriptPath = path.join(app.getPath('temp'), 'bento-bt-toggle.ps1')
    await fs.promises.writeFile(scriptPath, `${action} -InstanceId '${instanceId}' -Confirm:$false`)
    // Try without elevation first
    try {
      await execAsync(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`,
        { timeout: 10000 },
      )
      return { ok: true }
    } catch { /* needs elevation */ }
    // Elevate via UAC
    const escapedPath = scriptPath.replace(/\\/g, '\\\\')
    await execAsync(
      `powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""${escapedPath}"""`,
      { timeout: 30000 },
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'Toggle failed' }
  }
}

// ---------- WiFi ----------

ipcMain.handle('sys:wifi-status', async () => {
  if (process.platform === 'win32') return getWifiStatusWindows()
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
  if (process.platform === 'win32') return toggleWifiWindows(on)
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
  if (process.platform === 'win32') return getBtStatusWindows()
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
  if (process.platform === 'win32') return toggleBtWindows(on)
  try {
    await runBTHelper(on ? 'on' : 'off')
    return { ok: true }
  } catch (err) {
    console.error('[bluetooth-toggle]', err?.message)
    return { ok: false, error: err?.message || 'Toggle failed' }
  }
})

// ---------- Caffeinate (keep display awake) ----------
// Uses Electron's built-in powerSaveBlocker, which wraps:
//   macOS:   IOPMAssertionCreateWithName(kIOPMAssertionTypeNoDisplaySleep)
//   Windows: SetThreadExecutionState(ES_DISPLAY_REQUIRED | ES_CONTINUOUS)
//   Linux:   org.freedesktop.ScreenSaver.Inhibit
// One cross-platform API, no shell calls, no stray-process cleanup.

ipcMain.handle('sys:caffeinate-status', () => {
  return { on: _powerSaveId != null && powerSaveBlocker.isStarted(_powerSaveId) }
})

ipcMain.handle('sys:caffeinate-toggle', (_event, on) => {
  if (on) {
    if (_powerSaveId == null || !powerSaveBlocker.isStarted(_powerSaveId)) {
      _powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
    }
  } else if (_powerSaveId != null) {
    try { powerSaveBlocker.stop(_powerSaveId) } catch { /* ignore */ }
    _powerSaveId = null
  }
  return { ok: true }
})

// ---------- Focus ----------

ipcMain.handle('sys:focus-set', async (_event, shortcutName) => {
  // Focus modes are macOS-Shortcuts-specific; Windows Focus Assist has no
  // documented CLI for programmatic control, so we no-op there. The renderer
  // hides the Focus row entirely on Windows (see QuickSettingsTile).
  if (process.platform !== 'darwin') return { ok: false, notSupported: true }
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
  if (process.platform !== 'darwin') return
  await execAsync('open -a Shortcuts').catch(() => {})
})
