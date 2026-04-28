import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys, isReal } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'
import { fmtTimeRemaining } from '../lib/formatters.js'

const SEGMENTS = 28

export default function BatteryTile() {
  const [level, setLevel] = useState(0)
  const [charging, setCharging] = useState(false)
  const [hasBattery, setHasBattery] = useState(true)
  const [timeRemaining, setTimeRemaining] = useState(-1)
  const [powerDrawW, setPowerDrawW] = useState(null)
  const [powerLimitW, setPowerLimitW] = useState(null)

  usePolling(async () => {
    try {
      const b = await sys.battery()
      setHasBattery(b.hasBattery)
      setLevel(b.percent ?? 0)
      setCharging(b.isCharging || b.acConnected)
      setTimeRemaining(b.timeRemaining ?? -1)
      setPowerDrawW(b.powerDrawW ?? null)
      setPowerLimitW(b.powerLimitW ?? null)
    } catch {
      /* ignore */
    }
  }, 5000)

  // Desktop with live GPU power telemetry → render power-draw mode instead of
  // the useless "AC ONLY" battery view.
  if (!hasBattery && powerDrawW != null && powerLimitW) {
    const drawW = Math.round(powerDrawW)
    const pct = Math.max(0, Math.min(100, (powerDrawW / powerLimitW) * 100))
    const activeSegs = Math.round((pct / 100) * SEGMENTS)
    return (
      <div className="tile battery-tile">
        <span className="tile-label">POWER ● GPU</span>
        <div className="tile-value-row">
          <div className="tile-value-matrix">
            <DotMatrix text={String(drawW)} />
          </div>
          <span className="tile-value-unit">W</span>
        </div>
        <div className="battery-segments">
          {Array.from({ length: SEGMENTS }).map((_, i) => (
            <div key={i} className={`battery-seg ${i < activeSegs ? 'active' : 'inactive'}`} />
          ))}
        </div>
        <div className="tile-meta">
          <span className="tile-meta-line">
            {isReal ? 'GPU DRAW' : 'MOCK DATA'} / {Math.round(powerLimitW)}W LIMIT
          </span>
        </div>
      </div>
    )
  }

  const activeSegs = Math.round((level / 100) * SEGMENTS)
  const sourceLabel = isReal ? 'SYSTEM POWER' : 'MOCK DATA'
  const stateLabel = !hasBattery ? 'AC ONLY' : charging ? 'WIRED' : 'DISCHARGING'

  return (
    <div className="tile battery-tile">
      <span className="tile-label">BATTERY{charging ? ' ● CHARGING' : ''}</span>
      <div className="tile-value-row">
        <div className="tile-value-matrix">
          <DotMatrix text={String(level)} />
        </div>
        <span className="tile-value-unit">%</span>
      </div>
      <div className="battery-segments">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <div key={i} className={`battery-seg ${i < activeSegs ? 'active' : 'inactive'}`} />
        ))}
      </div>
      {!charging && timeRemaining > 0 && (
        <div className="battery-time-row">
          <div className="tile-value-matrix battery-time-matrix">
            <DotMatrix text={fmtTimeRemaining(timeRemaining)} />
          </div>
          <span className="tile-value-unit">LEFT</span>
        </div>
      )}
      <div className="tile-meta">
        <span className="tile-meta-line">
          {sourceLabel} / {stateLabel}
        </span>
      </div>
    </div>
  )
}
