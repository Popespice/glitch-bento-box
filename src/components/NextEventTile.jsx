import { useEffect, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'

const FETCH_MS = 60 * 1000   // calendar data doesn't need to be real-time
const TICK_MS  = 1000        // local countdown cadence

export default function NextEventTile() {
  const [status,    setStatus]    = useState('idle')   // 'event' | 'no-event' | 'disconnected' | 'error' | 'idle'
  const [eventData, setEventData] = useState(null)     // { title, start, calendarName }
  const [now,       setNow]       = useState(Date.now())

  const fetchNow = async () => {
    try {
      const data = await sys.calendarNextEvent()
      if (!data) { setStatus('error'); return }
      setStatus(data.status)
      if (data.status === 'event') setEventData({
        title:        data.title || '',
        start:        data.start,
        calendarName: data.calendarName || '',
      })
    } catch {
      setStatus('error')
    }
  }

  usePolling(fetchNow, FETCH_MS)
  usePolling(() => setNow(Date.now()), TICK_MS)

  // Refetch immediately when settings change rather than waiting for the 60s poll.
  useEffect(() => {
    const onChanged = (e) => {
      if (e.detail?.changed?.includes('calendar')) fetchNow()
    }
    window.addEventListener('bento:settings-changed', onChanged)
    return () => window.removeEventListener('bento:settings-changed', onChanged)
  }, [])

  // Branch by state — always render the tile chrome so layout doesn't jump.
  let nameText = ''
  let detailText = ''
  let parts = null

  if (status === 'disconnected') {
    nameText = 'CONNECT CALENDAR'
    detailText = 'OPEN SETTINGS TO CONNECT'
  } else if (status === 'no-event') {
    nameText = 'NOTHING UPCOMING'
    detailText = ''
  } else if (status === 'error') {
    nameText = 'CALENDAR ERROR'
    detailText = 'RETRYING…'
  } else if (status === 'event' && eventData) {
    const remaining = Math.max(0, Math.floor((eventData.start - now) / 1000))
    const hrs  = Math.floor(remaining / 3600)
    const mins = Math.floor((remaining % 3600) / 60)
    const secs = remaining % 60
    parts = hrs > 0
      ? [{ value: String(hrs), unit: 'H' }, { value: String(mins).padStart(2, '0'), unit: 'M' }]
      : [{ value: String(mins), unit: 'M' }, { value: String(secs).padStart(2, '0'), unit: 'S' }]
    nameText = eventData.title
    detailText = eventData.calendarName
  } else {
    // 'idle' (initial render before first fetch)
    nameText = 'LOADING…'
    detailText = ''
  }

  return (
    <div className="tile event-tile">
      <span className="tile-label">NEXT EVENT</span>
      {parts ? (
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
      ) : (
        <div className="event-status">
          <DotMatrix text={nameText} />
        </div>
      )}
      {parts && <span className="event-name">{nameText}</span>}
      {detailText && <span className="event-detail">{detailText}</span>}
    </div>
  )
}
