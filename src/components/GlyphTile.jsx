import { useEffect, useRef, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'
import { fmtUptime, fmtCountdown } from '../lib/formatters.js'

const DISK_SEGS = 20

export default function GlyphTile() {
  const [uptime, setUptime] = useState(null)
  const [disk, setDisk] = useState(null)

  const [duration, setDuration] = useState(25)
  const [remaining, setRemaining] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const tickRef = useRef(null)
  const doneRef = useRef(null)

  // Uptime — update every 60s, paused when window hidden
  usePolling(async () => {
    try {
      const t = await sys.uptime()
      if (typeof t?.uptime === 'number' && Number.isFinite(t.uptime)) setUptime(t.uptime)
    } catch {
      /* best-effort */
    }
  }, 60_000)

  // Disk — update every 30s, paused when window hidden
  usePolling(async () => {
    try {
      const d = await sys.disk()
      if (d) setDisk(d)
    } catch {
      /* best-effort */
    }
  }, 30_000)

  // Load saved pomodoro duration on mount
  useEffect(() => {
    sys
      .settingsGet()
      .then((s) => {
        const mins = s?.pomodoro?.minutes ?? 25
        setDuration(mins)
        setRemaining(mins * 60)
      })
      .catch(() => {})
  }, [])

  // Countdown tick — capture id locally so the cleanup clears *this* effect's
  // interval, not whatever tickRef.current happens to point at when cleanup
  // runs. (Reset/Start cycles can otherwise leak the prior interval.)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id)
          tickRef.current = null
          setRunning(false)
          setDone(true)
          sys.playSound('Glass')
          // Auto-clear DONE after 8s if not manually dismissed
          doneRef.current = setTimeout(() => setDone(false), 8000)
          return 0
        }
        return r - 1
      })
    }, 1000)
    tickRef.current = id
    return () => clearInterval(id)
  }, [running])

  const reset = () => {
    clearInterval(tickRef.current)
    clearTimeout(doneRef.current)
    setRunning(false)
    setDone(false)
    setRemaining(duration * 60)
  }

  const toggle = () => {
    if (running) {
      setRunning(false)
    } else {
      if (remaining === 0) setRemaining(duration * 60)
      setRunning(true)
    }
  }

  const adjust = (delta) => {
    if (running) return
    const next = Math.max(1, Math.min(120, duration + delta))
    setDuration(next)
    setRemaining(next * 60)
    sys.settingsSet('pomodoro', { minutes: next })
  }

  const activeSegs = disk ? Math.round((disk.pct / 100) * DISK_SEGS) : 0
  const isPaused = !running && !done && remaining < duration * 60

  return (
    <div className="tile glyph-tile">
      {/* ── UPTIME ── */}
      <span className="tile-label">UPTIME</span>
      <div className="glyph-row">
        <div className="tile-value-matrix sm">
          <DotMatrix text={uptime !== null ? fmtUptime(uptime) : '--:--'} />
        </div>
      </div>

      {/* ── DISK ── */}
      <span className="tile-label glyph-section-label">DISK</span>
      <div className="glyph-row">
        <div className="tile-value-matrix sm">
          <DotMatrix text={disk ? String(Math.round(disk.freeGB)) : '--'} />
        </div>
        <span className="tile-value-unit">GB FREE</span>
      </div>
      <div className="glyph-segments">
        {Array.from({ length: DISK_SEGS }).map((_, i) => (
          <div key={i} className={`battery-seg ${i < activeSegs ? 'active' : 'inactive'}`} />
        ))}
      </div>

      {/* ── FOCUS TIMER ── */}
      <span className="tile-label glyph-section-label">FOCUS</span>
      <div className="glyph-row">
        <div className="tile-value-matrix sm">
          <DotMatrix text={done ? 'DONE' : fmtCountdown(remaining)} />
        </div>
      </div>
      <div className="glyph-timer-controls">
        {/* DONE — dismiss only */}
        {done && (
          <button className="glyph-btn" onClick={reset} aria-label="Dismiss">
            ✕
          </button>
        )}

        {/* RUNNING — pause + cancel */}
        {running && (
          <>
            <button className="glyph-btn" onClick={toggle} aria-label="Pause">
              ■
            </button>
            <button className="glyph-btn glyph-btn--sm" onClick={reset} aria-label="Cancel">
              ✕
            </button>
          </>
        )}

        {/* IDLE — start + adjust (+ reset if paused mid-run) */}
        {!running && !done && (
          <>
            <button className="glyph-btn" onClick={toggle} aria-label="Start">
              ▶
            </button>
            <button className="glyph-btn glyph-btn--sm" onClick={() => adjust(-5)}>
              -5
            </button>
            <span className="glyph-timer-label">{duration}M</span>
            <button className="glyph-btn glyph-btn--sm" onClick={() => adjust(5)}>
              +5
            </button>
            {isPaused && (
              <button className="glyph-btn glyph-btn--sm" onClick={reset} aria-label="Reset">
                ✕
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
