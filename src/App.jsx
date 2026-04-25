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
export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return localStorage.getItem('bento-theme') || 'dark'
  })

  useEffect(() => {
    localStorage.setItem('bento-theme', theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <div className={`dashboard ${theme}`}>
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
      <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
        {theme === 'dark' ? '◐ LIGHT' : '◑ DARK'}
      </button>
    </div>
  )
}
