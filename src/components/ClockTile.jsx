import { useEffect, useMemo, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'
import { useSettingsChanged } from '../lib/useSettingsChanged.js'

const FORMAT_OPTS = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'long',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}

function buildFormatter(timezone) {
  const opts = timezone ? { ...FORMAT_OPTS, timeZone: timezone } : FORMAT_OPTS
  try {
    return new Intl.DateTimeFormat('en-US', opts)
  } catch {
    // Bad timezone string — fall back to system local.
    return new Intl.DateTimeFormat('en-US', FORMAT_OPTS)
  }
}

function partsFor(formatter, date) {
  const map = {}
  for (const p of formatter.formatToParts(date)) map[p.type] = p.value
  return {
    time: `${map.hour === '24' ? '00' : map.hour}:${map.minute}`,
    day: map.weekday,
    date: `${map.day} ${(map.month || '').toUpperCase().replace('.', '')} ${map.year}`,
  }
}

export default function ClockTile() {
  const [now, setNow] = useState(new Date())
  const [locationName, setLocationName] = useState('')
  const [timezone, setTimezone] = useState('')

  const loadSettings = async () => {
    const s = await sys.settingsGet()
    setLocationName(s?.weather?.locationName || '')
    setTimezone(s?.weather?.timezone || '')
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only init
    loadSettings()
  }, [])
  useSettingsChanged(['weather'], loadSettings)
  usePolling(() => setNow(new Date()), 1000)

  // Construct the formatter once per timezone change, not once per second.
  const formatter = useMemo(() => buildFormatter(timezone), [timezone])
  const { time, day, date } = partsFor(formatter, now)
  const locLabel = locationName ? locationName.toUpperCase() : 'SET LOCATION IN SETTINGS'

  return (
    <div className="tile clock-tile">
      <span className="tile-label">LOCAL CORE</span>
      <div className="clock-display">
        <DotMatrix text={time} />
      </div>
      <div className="clock-info">
        <span className="clock-day">{day}</span>
        <span className="clock-date">{date} / {locLabel}</span>
      </div>
    </div>
  )
}
