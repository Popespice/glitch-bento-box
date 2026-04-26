import { useEffect, useMemo, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'

const BARS = 36
const PROGRESS_DOTS = 36

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

function fmt(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function NowPlayingTile() {
  const track = { name: 'Nightcall', artist: 'KAVINSKY / OUTRUN', duration: 287 }
  const [position, setPosition] = useState(236)

  useEffect(() => {
    const id = setInterval(() => {
      setPosition((p) => (p + 1) % track.duration)
    }, 1000)
    return () => clearInterval(id)
  }, [track.duration])

  const bars = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => ({
        base: 0.25 + Math.random() * 0.75,
        dur: (0.7 + Math.random() * 0.9).toFixed(2),
        delay: (-Math.random() * 2).toFixed(2),
      })),
    []
  )

  const pct = (position / track.duration) * 100

  return (
    <div className="tile playing-tile">
      <span className="tile-label">NOW PLAYING</span>
      <div className="playing-main">
        <div className="playing-info">
          <div className="playing-track-matrix">
            <DotMatrix text={track.name} />
          </div>
          <span className="playing-artist">{track.artist}</span>
        </div>
        <div className="waveform">
          {bars.map((b, i) => (
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
      <div className="progress-row">
        <span className="progress-time"><DotMatrix text={fmt(position)} /></span>
        <DotProgressBar pct={pct} />
        <span className="progress-time"><DotMatrix text={fmt(track.duration)} /></span>
      </div>
    </div>
  )
}
