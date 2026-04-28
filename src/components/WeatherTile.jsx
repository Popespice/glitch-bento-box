import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import WeatherDotIcon from './WeatherDotIcon.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'
import { useSettingsChanged } from '../lib/useSettingsChanged.js'

const EMPTY = { tempF: null, condition: '—', humidity: null, windSpeed: null, windDir: '—' }

export default function WeatherTile() {
  const [w, setW] = useState(EMPTY)

  const fetchWeather = async () => {
    try {
      const data = await sys.weather()
      // Reset to empty shape if main returned null (no location set yet)
      setW(data ?? EMPTY)
    } catch {
      /* ignore */
    }
  }

  // Refresh every 30 min (main process caches, so this is cheap)
  usePolling(fetchWeather, 30 * 60 * 1000)
  useSettingsChanged(['weather'], fetchWeather)

  const temp = w.tempF !== null ? String(w.tempF) : '—'
  const showMatrix = w.tempF !== null

  return (
    <div className="tile weather-tile">
      <span className="tile-label">WEATHER</span>
      <div className="tile-value-row">
        {showMatrix ? (
          <div className="tile-value-matrix">
            <DotMatrix text={temp} />
          </div>
        ) : (
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'Space Mono', fontSize: 28 }}>
            —
          </span>
        )}
        <span className="tile-value-unit">°F</span>
      </div>
      {showMatrix && (
        <div className="weather-icon-row">
          <WeatherDotIcon condition={w.condition} />
        </div>
      )}
      <div className="tile-meta">
        {w.tempF === null ? (
          <span className="tile-meta-line" style={{ color: 'var(--accent)' }}>
            CONFIGURE IN SETTINGS
          </span>
        ) : (
          <>
            <span className="tile-meta-name">{w.locationName || '—'}</span>
            <span className="tile-meta-line">
              {w.condition}
              {w.humidity !== null ? ` / ${w.humidity}%` : ''}
            </span>
            <span className="tile-meta-line">
              {w.windSpeed !== null ? `WIND ${w.windDir} ${w.windSpeed} MPH` : '—'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
