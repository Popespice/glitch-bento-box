export default function GlyphTile() {
  const dots = []
  const r = 30
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2
    dots.push({
      cx: 40 + Math.cos(angle) * r,
      cy: 40 + Math.sin(angle) * r,
    })
  }

  return (
    <div className="tile glyph-tile">
      <span className="tile-label">GLYPH INTERFACE</span>
      <div className="glyph-empty">
        <div className="glyph-ring-container">
          <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
            {dots.map((d, i) => (
              <circle key={i} cx={d.cx} cy={d.cy} r="1.6" style={{ fill: 'var(--dot-lit)' }} />
            ))}
            <circle cx="40" cy="40" r="3" style={{ fill: 'var(--dot-lit)' }} />
          </svg>
        </div>
        <span className="glyph-placeholder-text">AWAITING ASSIGNMENT</span>
      </div>
    </div>
  )
}
