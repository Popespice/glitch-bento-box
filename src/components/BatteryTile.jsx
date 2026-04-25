import { useEffect, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys, isReal } from '../lib/sys.js'

const SEGMENTS = 28

export default function BatteryTile() {
  const [level, setLevel] = useState(0)
  const [charging, setCharging] = useState(false)
  const [hasBattery, setHasBattery] = useState(true)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const b = await sys.battery()
        if (cancelled) return
        setHasBattery(b.hasBattery)
        setLevel(b.percent ?? 0)
        setCharging(b.isCharging || b.acConnected)
      } catch {
        /* ignore */
      }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const activeSegs = Math.round((level / 100) * SEGMENTS)
  const sourceLabel = isReal ? 'SYSTEM POWER' : 'MOCK DATA'
  const stateLabel = !hasBattery ? 'AC ONLY' : charging ? 'WIRED' : 'DISCHARGING'

  return (
    <div className="tile battery-tile">
      <span className="tile-label">BATTERY{charging ? ' ● CHARGING' : ''}</span>
      <div className="tile-value-row">
        <div className="tile-value-matrix">
          <DotMatrix text={`${level}.`} />
        </div>
        <span className="tile-value-unit">%</span>
      </div>
      <div className="battery-segments">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <div
            key={i}
            className={`battery-seg ${i < activeSegs ? 'active' : 'inactive'}`}
          />
        ))}
      </div>
      <div className="tile-meta">
        <span className="tile-meta-line">
          {sourceLabel} / {stateLabel}
        </span>
      </div>
    </div>
  )
}
