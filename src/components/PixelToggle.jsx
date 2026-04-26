// Dot-matrix SVG toggle — matches the DotMatrix aesthetic (same circle-grid approach).
// 2 rows × 8 cols of dots. ON = right half lit, OFF = left half dim-lit.

const COLS = 8
const ROWS = 2
const S    = 6      // dot spacing
const R    = 2.2    // dot radius

const W = (COLS - 1) * S + R * 2
const H = (ROWS - 1) * S + R * 2

export default function PixelToggle({ on, onClick, disabled = false }) {
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      onClick={disabled ? undefined : onClick}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1, flexShrink: 0 }}
      aria-label={on ? 'On' : 'Off'}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={disabled ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.() }}
    >
      {Array.from({ length: ROWS }, (_, row) =>
        Array.from({ length: COLS }, (_, col) => {
          const rightHalf = col >= COLS / 2
          // ON:  right half fully lit, left dim
          // OFF: left half low-opacity (position indicator), right fully dim
          let fill
          if (on) {
            fill = rightHalf ? 'var(--dot-lit)' : 'var(--dot-dim)'
          } else {
            fill = rightHalf ? 'var(--dot-dim)' : 'rgba(224,224,224,0.22)'
          }
          return (
            <circle
              key={`${row}-${col}`}
              cx={R + col * S}
              cy={R + row * S}
              r={R}
              fill={fill}
            />
          )
        })
      )}
    </svg>
  )
}
