import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'

const HISTORY = 32      // columns in the dot chart (newest on the right)
const ROWS    = 8       // vertical dot rows — value 0..100 maps to 0..ROWS lit
const SPACING = 10      // SVG units between dot centers
const RADIUS  = 3.4     // dot radius in SVG units

/**
 * Bar chart rendered as a grid of dots.
 * Each column is a sample; dots light up from the bottom in proportion to value.
 */
function DotBarChart({ values }) {
  const cols = values.length
  const w = cols * SPACING
  const h = ROWS * SPACING

  return (
    <svg
      className="pulse-dot-chart"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      {values.flatMap((v, c) => {
        const clamped = Math.max(0, Math.min(100, v))
        const litFromBottom = Math.round((clamped / 100) * ROWS)
        return Array.from({ length: ROWS }, (_, r) => {
          // r = 0 is top, r = ROWS-1 is bottom
          const lit = (ROWS - r) <= litFromBottom
          return (
            <circle
              key={`${c}-${r}`}
              cx={c * SPACING + SPACING / 2}
              cy={r * SPACING + SPACING / 2}
              r={RADIUS}
              style={{ fill: lit ? 'var(--accent)' : 'var(--dot-dim)' }}
            />
          )
        })
      })}
    </svg>
  )
}

export default function SystemPulseTile() {
  const [gpu, setGpu] = useState(0)
  const [model, setModel] = useState('GPU')
  const [history, setHistory] = useState(() => Array(HISTORY).fill(0))

  usePolling(async () => {
    try {
      const data = await sys.gpu()
      if (!data) return
      setGpu(data.percent)
      setModel(data.model || 'GPU')
      setHistory((prev) => [...prev.slice(1), data.percent])
    } catch { /* ignore */ }
  }, 2000)

  return (
    <div className="tile pulse-tile">
      <span className="tile-label">SYSTEM PULSE ●</span>
      <div className="pulse-value-row">
        <div className="tile-value-matrix md">
          <DotMatrix text={String(Math.round(gpu))} />
        </div>
        <span className="pulse-unit">%</span>
      </div>
      <DotBarChart values={history} />
      <span className="tile-meta-line">{model.toUpperCase()} / {HISTORY} SAMPLES</span>
    </div>
  )
}
