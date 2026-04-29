import { useEffect, useState } from 'react'
import ClockTile from './components/ClockTile.jsx'
import GlyphTile from './components/GlyphTile.jsx'
import WeatherTile from './components/WeatherTile.jsx'
import BatteryTile from './components/BatteryTile.jsx'
import SystemPulseTile from './components/SystemPulseTile.jsx'
import NetworkTile from './components/NetworkTile.jsx'
import CPUTile from './components/CPUTile.jsx'
import MemoryTile from './components/MemoryTile.jsx'
import NowPlayingTile from './components/NowPlayingTile.jsx'
import QuickSettingsTile from './components/QuickSettingsTile.jsx'
import HeatmapTile from './components/HeatmapTile.jsx'
import NextEventTile from './components/NextEventTile.jsx'
import SettingsOverlay from './components/SettingsOverlay.jsx'
import { sys } from './lib/sys.js'
import { useSettingsChanged } from './lib/useSettingsChanged.js'

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return localStorage.getItem('bento-theme') || 'dark'
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [textScale, setTextScale] = useState(1)

  useEffect(() => {
    localStorage.setItem('bento-theme', theme)
  }, [theme])

  const loadTextScale = async () => {
    const s = await sys.settingsGet()
    setTextScale(s?.ui?.textScale ?? 1)
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only init
    loadTextScale()
  }, [])
  useSettingsChanged(['ui'], loadTextScale)

  // Pause CSS animations when window is hidden — saves significant GPU work
  useEffect(() => {
    const onVis = () => {
      document.documentElement.classList.toggle('window-hidden', document.hidden)
    }
    onVis()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <div className={`dashboard ${theme}`} style={{ '--text-scale': textScale }}>
      <div className="left-panel">
        <ClockTile />
        <GlyphTile />
        <WeatherTile />
        <BatteryTile />
        <SystemPulseTile />
        <NetworkTile />
      </div>
      <div className="right-panel">
        <CPUTile />
        <MemoryTile />
        <NowPlayingTile />
        <QuickSettingsTile />
        <HeatmapTile />
        <NextEventTile />
      </div>
      <div className="dashboard-controls">
        <button
          className="settings-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
        >
          ⚙
        </button>
        <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? '◐ LIGHT' : '◑ DARK'}
        </button>
      </div>
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
