import { useEffect, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'

export default function WeatherTile() {
  const [w, setW] = useState({
    tempF: null, condition: '—', humidity: null,
    windSpeed: null, windDir: '—',
  })

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const data = await sys.weather()
        if (cancelled) return
        // Reset to the empty shape if main returned null (no location set yet)
        setW(data ?? {
          tempF: null, condition: '—', humidity: null,
          windSpeed: null, windDir: '—',
        })
      } catch { /* ignore */ }
    }
    tick()
    // Refresh every 30 min (main process caches, so this is cheap)
    const id = setInterval(tick, 30 * 60 * 1000)

    // Refetch immediately when settings change
    const onSettings = (e) => {
      if (e.detail?.changed?.includes('weather')) tick()
    }
    window.addEventListener('bento:settings-changed', onSettings)

    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener('bento:settings-changed', onSettings)
    }
  }, [])

  const temp = w.tempF !== null ? String(w.tempF) : '—'
  const showMatrix = w.tempF !== null

  return (
    <div className="tile weather-tile">
      <span className="tile-label">WEATHER</span>
      <div className="tile-value-row">
        {showMatrix ? (
          <div className="tile-value-matrix">
            <DotMatrix text={`${temp}.`} />
          </div>
        ) : (
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'Space Mono', fontSize: 28 }}>—</span>
        )}
        <span className="tile-value-unit">°F</span>
      </div>
      <div className="tile-meta">
        {w.tempF === null ? (
          <span className="tile-meta-line" style={{ color: 'var(--accent)' }}>CONFIGURE IN SETTINGS</span>
        ) : (
          <>
            <span className="tile-meta-name">{w.locationName || '—'}</span>
            <span className="tile-meta-line">{w.condition}{w.humidity !== null ? ` / ${w.humidity}%` : ''}</span>
            <span className="tile-meta-line">
              {w.windSpeed !== null ? `WIND ${w.windDir} ${w.windSpeed} MPH` : '—'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
