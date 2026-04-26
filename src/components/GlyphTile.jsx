import { useEffect, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'

export default function GlyphTile() {
  const [cmd, setCmd] = useState(null)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const result = await sys.lastCommand()
        if (!cancelled) setCmd(result)
      } catch { /* ignore */ }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const full = cmd?.full ?? ''
  const truncated = full.length > 48 ? full.slice(0, 47) + '…' : full

  return (
    <div className="tile glyph-tile">
      <span className="tile-label">LAST CMD</span>
      {cmd ? (
        <>
          <div className="tile-value-row">
            <div className="tile-value-matrix">
              <DotMatrix text={cmd.verb} />
            </div>
          </div>
          <div className="tile-meta">
            <span className="tile-meta-line last-cmd-full">{truncated}</span>
            <span className="tile-meta-line">{cmd.shell}</span>
          </div>
        </>
      ) : (
        <div className="tile-meta">
          <span className="tile-meta-line" style={{ color: 'var(--text-secondary)' }}>NO HISTORY FOUND</span>
        </div>
      )}
    </div>
  )
}
