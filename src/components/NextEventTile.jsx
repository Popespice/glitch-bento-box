import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { usePolling } from '../lib/usePolling.js'

function getTarget() {
  const t = new Date()
  t.setMinutes(t.getMinutes() + 24, 18, 0)
  return t
}

export default function NextEventTile() {
  const [target] = useState(getTarget)
  const [now, setNow] = useState(Date.now())

  usePolling(() => setNow(Date.now()), 1000)

  const remaining = Math.max(0, Math.floor((target.getTime() - now) / 1000))
  const hrs = Math.floor(remaining / 3600)
  const mins = Math.floor((remaining % 3600) / 60)
  const secs = remaining % 60

  const parts = hrs > 0
    ? [
        { value: String(hrs), unit: 'H' },
        { value: String(mins).padStart(2, '0'), unit: 'M' },
      ]
    : [
        { value: String(mins), unit: 'M' },
        { value: String(secs).padStart(2, '0'), unit: 'S' },
      ]

  return (
    <div className="tile event-tile">
      <span className="tile-label">NEXT EVENT</span>
      <div className="countdown-display">
        {parts.map((p, i) => (
          <div key={i} className="countdown-segment">
            <div className="tile-value-matrix md">
              <DotMatrix text={p.value} />
            </div>
            <span className="countdown-unit">{p.unit}</span>
          </div>
        ))}
      </div>
      <span className="event-name">Design review</span>
      <span className="event-detail">APPLE CALENDAR / CONF ROOM GLYPH-A</span>
    </div>
  )
}
