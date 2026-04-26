import { useCallback, useEffect, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'

function randomHex() {
  return '#' + Math.floor(Math.random() * 0xFFFFFF)
    .toString(16).padStart(6, '0').toUpperCase()
}

export default function GlyphTile() {
  const [color, setColor] = useState(randomHex)
  const refresh = useCallback(() => setColor(randomHex()), [])

  useEffect(() => {
    const id = setInterval(refresh, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [refresh])

  return (
    <div className="tile glyph-tile">
      <span className="tile-label">COLOR</span>
      <div
        className="color-swatch"
        style={{ backgroundColor: color }}
        onClick={refresh}
        title="Click to refresh"
      />
      <div className="tile-meta">
        <div className="tile-value-matrix xs">
          <DotMatrix text={color.slice(1)} />
        </div>
      </div>
    </div>
  )
}
