import { useEffect, useMemo, useState } from 'react'
import { sys } from '../lib/sys.js'

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
  const max = Math.max(1, ...days.map((d) => d.count))
  const cells = []
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const count = days[w * DAYS + d]?.count ?? 0
      cells.push(count / max)
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

  useEffect(() => {
    let cancelled = false
    const fetchHeatmap = () => {
      // Fetch login label alongside heatmap data
      sys.githubStatus?.()?.then((s) => {
        if (!cancelled) setLogin(s?.login || '')
      }).catch(() => {})

      sys
        .githubHeatmap()
        .then((days) => {
          if (cancelled || !days?.length) return
          setCells(realToIntensity(days))
          setActiveCount(days.filter((d) => d.count > 0).length)
          setLive(true)
        })
        .catch(() => {})
    }
    fetchHeatmap()

    const onSettings = (e) => {
      if (e.detail?.changed?.includes('github')) fetchHeatmap()
    }
    window.addEventListener('bento:settings-changed', onSettings)
    return () => {
      cancelled = true
      window.removeEventListener('bento:settings-changed', onSettings)
    }
  }, [])

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
