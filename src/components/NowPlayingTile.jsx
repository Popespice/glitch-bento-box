import { useEffect, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'
import { useSettingsChanged } from '../lib/useSettingsChanged.js'
import { fmtProgress } from '../lib/formatters.js'

const BARS = 36
const PROGRESS_DOTS = 120
const FETCH_MS = 5000 // server poll cadence — be nice to Spotify
const TICK_MS = 1000 // local interpolation of position between fetches

// Decorative waveform bar data — computed once at module load (not during render)
// so Math.random() stays outside the component's render cycle.
const BARS_DATA = Array.from({ length: BARS }, () => ({
  base: 0.25 + Math.random() * 0.75,
  dur: (0.7 + Math.random() * 0.9).toFixed(2),
  delay: (-Math.random() * 2).toFixed(2),
}))

function DotProgressBar({ pct }) {
  const filled = Math.round((pct / 100) * PROGRESS_DOTS)
  return (
    <div className="progress-dot-bar">
      {Array.from({ length: PROGRESS_DOTS }, (_, i) => (
        <div key={i} className={`progress-dot${i < filled ? ' active' : ''}`} />
      ))}
    </div>
  )
}

export default function NowPlayingTile() {
  const [status, setStatus] = useState('idle') // 'playing' | 'idle' | 'disconnected' | 'error'
  const [track, setTrack] = useState(null) // { name, artist, duration }
  const [position, setPosition] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const fetchNow = async () => {
    try {
      const data = await sys.nowPlaying()
      if (!data) {
        setStatus('error')
        return
      }
      setStatus(data.status)
      if (data.status === 'playing') {
        setTrack(data.track)
        setPosition(data.position ?? 0)
        setIsPlaying(!!data.isPlaying)
      } else {
        setIsPlaying(false)
      }
    } catch {
      setStatus('error')
    }
  }

  // Server poll — visibility-paused via usePolling.
  usePolling(fetchNow, FETCH_MS)

  // Refetch immediately on connect/disconnect rather than waiting for the 5s poll.
  useSettingsChanged(['spotify'], fetchNow)

  // Local 1s interpolation — only attached while actually playing. Each
  // upstream fetch snaps `position` back to the server value so drift can't
  // accumulate. Gating the effect itself (instead of reading a ref inside an
  // always-running interval) means StrictMode double-mount doesn't double-tick.
  useEffect(() => {
    if (!isPlaying || status !== 'playing') return
    const dur = track?.duration ?? 0
    if (!dur) return
    const id = setInterval(() => {
      setPosition((p) => Math.min(dur, p + 1))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [isPlaying, status, track?.duration])

  // Branch render by state. We always draw the tile chrome (label + waveform)
  // so the layout doesn't jump around as Spotify state changes.
  let nameText = track?.name || ''
  let artistText = track?.artist || ''
  let showProgress = false

  if (status === 'disconnected') {
    nameText = 'SPOTIFY OFFLINE'
    artistText = 'OPEN SETTINGS TO CONNECT'
  } else if (status === 'idle' || !track) {
    nameText = 'NOTHING PLAYING'
    artistText = ''
  } else if (status === 'error') {
    nameText = 'CONNECTION ERROR'
    artistText = 'RETRYING…'
  } else {
    showProgress = true
  }

  const pct = showProgress ? (position / track.duration) * 100 : 0
  const tileClass = `tile playing-tile${isPlaying && status === 'playing' ? '' : ' playing-tile--paused'}`

  return (
    <div className={tileClass}>
      <span className="tile-label">NOW PLAYING</span>
      <div className="playing-main">
        <div className="playing-info">
          <div className="playing-track-matrix">
            <DotMatrix text={nameText} />
          </div>
          {artistText && <span className="playing-artist">{artistText}</span>}
        </div>
        <div className="waveform">
          {BARS_DATA.map((b, i) => (
            <div
              key={i}
              className="waveform-bar"
              style={{
                height: `${b.base * 100}%`,
                '--dur': `${b.dur}s`,
                animationDelay: `${b.delay}s`,
              }}
            />
          ))}
        </div>
      </div>
      {showProgress && (
        <div className="progress-row">
          <span className="progress-time">
            <DotMatrix text={fmtProgress(position)} />
          </span>
          <DotProgressBar pct={pct} />
          <span className="progress-time">
            <DotMatrix text={fmtProgress(track.duration)} />
          </span>
        </div>
      )}
    </div>
  )
}
