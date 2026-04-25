import { useEffect, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'

export default function MemoryTile() {
  const [m, setM] = useState({ totalGB: 0, usedGB: 0, swapGB: 0, pct: 0 })

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const next = await sys.memory()
        if (!cancelled) setM(next)
      } catch {
        /* ignore */
      }
    }
    tick()
    const id = setInterval(tick, 2500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return (
    <div className="tile memory-tile">
      <span className="tile-label">MEMORY</span>
      <div className="tile-value-row">
        <div className="tile-value-matrix md">
          <DotMatrix text={String(m.usedGB.toFixed(1))} />
        </div>
        <span className="tile-value-unit">GB</span>
      </div>
      <div className="memory-sub">/ {m.totalGB} GB ACTIVE</div>
      <div className="mem-bar-track">
        <div className="mem-bar-fill" style={{ width: `${m.pct}%` }} />
      </div>
      <span className="mem-swap">SWAP {m.swapGB.toFixed(1)} GB / {m.pct}% UTILIZED</span>
    </div>
  )
}
