// Bridge to the Electron preload. When running in a plain browser (no preload),
// fall back to mock data so the Vite dev server still works for UI iteration.

const isElectron = typeof window !== 'undefined' && !!window.bento

function jitter(min, max) {
  return min + Math.random() * (max - min)
}

const mocks = {
  platform: async () => ({ platform: 'mock', arch: 'mock', release: '' }),
  githubHeatmap: async () => null,
  weather: async () => ({
    tempF: 58,
    condition: 'PARTLY CLOUDY',
    humidity: 64,
    windSpeed: 7,
    windDir: 'NW',
  }),
  lastCommand: async () => ({ verb: 'GIT', full: 'git push origin main', shell: 'ZSH' }),
  uptime: async () => ({ uptime: 3600 * 24 * 2 + 3600 * 14 + 60 * 22 }),
  disk: async () => ({ totalGB: 500, usedGB: 312, freeGB: 188, pct: 62 }),
  playSound: async () => {},
  nowPlaying: async () => ({
    status: 'playing',
    isPlaying: true,
    track: { name: 'Nightcall', artist: 'KAVINSKY / OUTRUN', duration: 287 },
    position: Math.floor(Date.now() / 1000) % 287,
  }),
  wifiStatus: async () => ({ on: true, ssid: 'STUDIO-5G' }),
  wifiToggle: async () => ({ ok: true }),
  bluetoothStatus: async () => ({ on: true, available: true }),
  bluetoothToggle: async () => ({ ok: true }),
  caffeinateStatus: async () => ({ on: false }),
  caffeinateToggle: async () => ({ ok: true }),
  focusSet: async () => ({ ok: true }),
  openShortcutsApp: async () => {},
  spotifyConnect: async () => ({ ok: false, error: 'Not available in dev mode' }),
  spotifyDisconnect: async () => ({ ok: true }),
  githubConnect: async () => ({ ok: false, error: 'Not available in dev mode' }),
  githubDisconnect: async () => ({ ok: true }),
  githubStatus: async () => ({ connected: false, login: '' }),
  calendarStatus: async () => ({ provider: null, connected: false, activeCalendarIds: [] }),
  calendarConnectIcloud: async () => ({ ok: false, error: 'Not available in dev mode' }),
  calendarConnectGoogle: async () => ({ ok: false, error: 'Not available in dev mode' }),
  calendarGetCalendars: async () => ({ ok: true, calendars: [] }),
  calendarSetActive: async () => true,
  calendarDisconnect: async () => ({ ok: true }),
  calendarNextEvent: async () => ({
    status: 'event',
    title: 'Design Review',
    start: Date.now() + 24 * 60 * 1000,
    calendarName: 'WORK',
  }),
  settingsGet: async () => ({
    weather: { query: '', locationName: '', lat: null, lon: null, timezone: '' },
    github: { username: '' },
    pomodoro: { minutes: 25 },
    spotify: { connected: false },
    ui: { textScale: 1 },
  }),
  settingsSet: async () => true,
  settingsGeocode: async (query) => ({
    lat: 40.7128,
    lon: -74.006,
    locationName: `${query} (mock)`,
    timezone: 'America/New_York',
  }),
  windowClose: () => {},
  windowMinimize: () => {},
  windowMaximize: () => {},
  cpu: async () => ({
    percent: Math.round(jitter(15, 75)),
    cores: Array.from({ length: 8 }, () => Math.round(jitter(5, 90))),
    speedGhz: 3.61,
    brand: 'Mock CPU',
  }),
  gpu: async () => ({
    percent: Math.round(jitter(5, 65)),
    model: 'Mock GPU',
  }),
  memory: async () => ({
    totalGB: 16,
    usedGB: Number(jitter(8, 13).toFixed(1)),
    swapGB: 0.8,
    pct: Math.round(jitter(50, 80)),
  }),
  network: async () => ({
    down: jitter(2_000_000, 30_000_000),
    up: jitter(200_000, 2_000_000),
    iface: 'mock0',
    ssid: 'STUDIO-5G',
    type: 'wifi',
    ip: '10.0.0.53',
    signalQuality: 80,
  }),
  battery: async () => ({
    hasBattery: true,
    percent: 87,
    isCharging: false,
    acConnected: false,
    timeRemaining: 142,
  }),
}

export const sys = isElectron ? window.bento : mocks
export const isReal = isElectron
