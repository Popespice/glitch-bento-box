import { useEffect, useMemo, useRef, useState } from 'react'
import { sys } from '../lib/sys.js'
import { useSettingsChanged } from '../lib/useSettingsChanged.js'

const WEEKS = 20
const DAYS = 7

function seedRandom(seed) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function generateFallback() {
  const rand = seedRandom(42)
  const cells = []
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const base = rand()
      const weekdayBias = d >= 1 && d <= 5 ? 1 : 0.35
      const recencyBias = 0.6 + (w / WEEKS) * 0.4
      cells.push(Math.min(1, base * weekdayBias * recencyBias * 1.5))
    }
  }
  return cells
}

function realToIntensity(days) {
  const logMax = Math.log1p(Math.max(1, ...days.map((d) => d.count)))
  const cells = []
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const count = days[w * DAYS + d]?.count ?? 0
      cells.push(Math.log1p(count) / logMax)
    }
  }
  return cells
}

function cellStyle(intensity) {
  if (intensity < 0.08) return { background: 'var(--heatmap-empty)' }
  const warm = intensity > 0.55
  return {
    background: warm ? 'var(--heatmap-warm)' : 'var(--heatmap-cool)',
    opacity: 0.35 + intensity * 0.65,
  }
}

export default function HeatmapTile() {
  const fallback = useMemo(() => generateFallback(), [])
  const [cells, setCells] = useState(fallback)
  const [activeCount, setActiveCount] = useState(null)
  const [live, setLive] = useState(false)
  const [login, setLogin] = useState('')
  // Request id — connect/disconnect can fire multiple fetches; only the
  // most recent one is allowed to commit state. Without this, a stale
  // response can land after a fresh one and leave `live=true` showing old data.
  const reqIdRef = useRef(0)

  const fetchHeatmap = () => {
    const myReq = ++reqIdRef.current

    sys
      .githubStatus?.()
      ?.then((s) => {
        if (myReq !== reqIdRef.current) return
        setLogin(s?.login || '')
      })
      .catch(() => {})

    sys
      .githubHeatmap()
      .then((days) => {
        if (myReq !== reqIdRef.current) return
        if (days == null) return // null = not authenticated / unavailable
        // Treat empty-but-real days as live data (a brand-new account with
        // no commits yet is still "live"); only null leaves the fallback.
        setCells(days.length ? realToIntensity(days) : Array(WEEKS * DAYS).fill(0))
        setActiveCount(days.filter((d) => d.count > 0).length)
        setLive(true)
      })
      .catch(() => {})
  }

  useEffect(() => {
    fetchHeatmap()
  }, [])

  useSettingsChanged(['github'], fetchHeatmap)

  const total = live ? activeCount : cells.reduce((s, c) => s + (c > 0.1 ? 1 : 0), 0)
  const label = login ? `@${login}` : 'GITHUB ACTIVITY'

  return (
    <div className="tile heatmap-tile">
      <span className="tile-label">
        {label}
        {live ? ' ●' : ''}
      </span>
      <div className="heatmap-grid">
        {cells.map((c, i) => (
          <div key={i} className="heatmap-cell" style={cellStyle(c)} />
        ))}
      </div>
      <span className="tile-meta-line">
        {total ?? '—'} ACTIVE / {WEEKS * DAYS} DAYS
      </span>
    </div>
  )
}
