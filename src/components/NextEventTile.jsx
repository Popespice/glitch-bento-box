import { useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'
import { useSettingsChanged } from '../lib/useSettingsChanged.js'

const FETCH_MS = 60 * 1000 // calendar data doesn't need to be real-time
const TICK_MS = 1000 // local countdown cadence

export default function NextEventTile() {
  const [status, setStatus] = useState('idle') // 'event' | 'no-event' | 'disconnected' | 'error' | 'idle'
  const [eventData, setEventData] = useState(null) // { title, start, calendarName }
  const [now, setNow] = useState(() => Date.now())

  const fetchNow = async () => {
    try {
      const data = await sys.calendarNextEvent()
      if (!data) {
        setStatus('error')
        setEventData(null)
        return
      }
      setStatus(data.status)
      if (data.status === 'event') {
        setEventData({
          title: data.title || '',
          start: data.start,
          calendarName: data.calendarName || '',
        })
      } else {
        // Clear stale event data on transitions — without this, going
        // event → no-event → event briefly shows the prior title.
        setEventData(null)
      }
    } catch {
      setStatus('error')
      setEventData(null)
    }
  }

  usePolling(fetchNow, FETCH_MS)
  // Only run the second-tick poll when a countdown is actually visible. The
  // tile re-renders on every tick, so unconditionally polling wastes ~1 React
  // commit/sec for the entire session when no event is upcoming.
  usePolling(() => setNow(Date.now()), status === 'event' ? TICK_MS : null)
  useSettingsChanged(['calendar'], fetchNow)

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
    const hrs = Math.floor(remaining / 3600)
    const mins = Math.floor((remaining % 3600) / 60)
    const secs = remaining % 60
    parts =
      hrs > 0
        ? [
            { value: String(hrs), unit: 'H' },
            { value: String(mins).padStart(2, '0'), unit: 'M' },
          ]
        : [
            { value: String(mins), unit: 'M' },
            { value: String(secs).padStart(2, '0'), unit: 'S' },
          ]
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
