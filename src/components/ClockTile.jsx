import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { usePolling } from '../lib/usePolling.js'

const pad = (n) => String(n).padStart(2, '0')
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function formatTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDate(d) {
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export default function ClockTile() {
  const [now, setNow] = useState(new Date())

  usePolling(() => setNow(new Date()), 1000)

  return (
    <div className="tile clock-tile">
      <span className="tile-label">LOCAL CORE</span>
      <div className="clock-display">
        <DotMatrix text={formatTime(now)} />
      </div>
      <div className="clock-info">
        <span className="clock-day">{DAYS[now.getDay()]}</span>
        <span className="clock-date">{formatDate(now)} / WASHINGTON NJ</span>
      </div>
    </div>
  )
}
