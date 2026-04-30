import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'

// Coerce a possibly-undefined numeric IPC field to a finite number. Without
// this, partial responses (e.g. swap missing on Windows) would crash .toFixed().
const num = (v) => (Number.isFinite(v) ? v : 0)

export default function MemoryTile() {
  const [m, setM] = useState({ totalGB: 0, usedGB: 0, swapGB: 0, pct: 0 })

  usePolling(async () => {
    try {
      const next = await sys.memory()
      if (next) setM(next)
    } catch {
      /* ignore */
    }
  }, 5000)

  return (
    <div className="tile memory-tile">
      <span className="tile-label">MEMORY</span>
      <div className="tile-value-row">
        <div className="tile-value-matrix md">
          <DotMatrix text={num(m.usedGB).toFixed(1)} />
        </div>
        <span className="tile-value-unit">GB</span>
      </div>
      <div className="memory-sub">/ {num(m.totalGB)} GB ACTIVE</div>
      <div className="mem-bar-track">
        <div className="mem-bar-fill" style={{ width: `${num(m.pct)}%` }} />
      </div>
      <span className="mem-swap">
        SWAP {num(m.swapGB).toFixed(1)} GB / {num(m.pct)}% UTILIZED
      </span>
    </div>
  )
}
