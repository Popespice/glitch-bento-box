import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'

const HISTORY = 32

export default function CPUTile() {
  const [cpu, setCpu] = useState(0)
  const [meta, setMeta] = useState({ speedGhz: 0, brand: '' })
  const [history, setHistory] = useState(() => Array(HISTORY).fill(0))

  usePolling(async () => {
    try {
      const { percent, speedGhz, brand } = await sys.cpu()
      setCpu(percent)
      setMeta({ speedGhz, brand })
      setHistory((prev) => [...prev.slice(1), percent])
    } catch { /* ignore */ }
  }, 2000)

  const points = history
    .map((v, i) => {
      const x = (i / (HISTORY - 1)) * 100
      const y = 100 - Math.max(0, Math.min(100, v))
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="tile cpu-tile">
      <span className="tile-label">CPU LOAD +</span>
      <div className="cpu-header">
        <div className="cpu-value-block">
          <div className="tile-value-matrix md">
            <DotMatrix text={String(Math.round(cpu))} />
          </div>
          <span className="tile-value-unit">%</span>
        </div>
        <svg
          className="cpu-sparkline"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <polyline
            points={points}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <span className="cpu-meta">
        {meta.speedGhz ? `${meta.speedGhz} GHZ` : '—'} / {history.length} SAMPLES
      </span>
    </div>
  )
}
