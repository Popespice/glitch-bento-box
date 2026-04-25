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
    tempF: 58, condition: 'PARTLY CLOUDY', humidity: 64,
    windSpeed: 7, windDir: 'NW',
  }),
  settingsGet:     async () => ({ weather: { query: '', locationName: '', lat: null, lon: null }, github: { username: '' } }),
  settingsSet:     async () => true,
  settingsGeocode: async (query) => ({ lat: 40.7128, lon: -74.0060, locationName: `${query} (mock)` }),
  windowClose:    () => {},
  windowMinimize: () => {},
  windowMaximize: () => {},
  cpu: async () => ({
    percent: Math.round(jitter(15, 75)),
    cores: Array.from({ length: 8 }, () => Math.round(jitter(5, 90))),
    speedGhz: 3.61,
    brand: 'Mock CPU',
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
  }),
}

export const sys = isElectron ? window.bento : mocks
export const isReal = isElectron
