import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys, isReal } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'

const SEGMENTS = 28

function fmtTimeRemaining(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}H ${String(m).padStart(2, '0')}M` : `${m}M`
}

export default function BatteryTile() {
  const [level, setLevel] = useState(0)
  const [charging, setCharging] = useState(false)
  const [hasBattery, setHasBattery] = useState(true)
  const [timeRemaining, setTimeRemaining] = useState(-1)

  usePolling(async () => {
    try {
      const b = await sys.battery()
      setHasBattery(b.hasBattery)
      setLevel(b.percent ?? 0)
      setCharging(b.isCharging || b.acConnected)
      setTimeRemaining(b.timeRemaining ?? -1)
    } catch {
      /* ignore */
    }
  }, 30000)

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
