const FONT = {
  '0': [
    [0,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,1,1,0],
  ],
  '1': [
    [0,0,1,0,0],
    [0,1,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,1,1,1,0],
  ],
  '2': [
    [0,1,1,1,0],
    [1,0,0,0,1],
    [0,0,0,0,1],
    [0,0,1,1,0],
    [0,1,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,1],
  ],
  '3': [
    [0,1,1,1,0],
    [1,0,0,0,1],
    [0,0,0,0,1],
    [0,0,1,1,0],
    [0,0,0,0,1],
    [1,0,0,0,1],
    [0,1,1,1,0],
  ],
  '4': [
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,1,1,1,1],
    [0,0,0,0,1],
    [0,0,0,0,1],
    [0,0,0,0,1],
  ],
  '5': [
    [1,1,1,1,1],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,0],
    [0,0,0,0,1],
    [0,0,0,0,1],
    [1,1,1,1,0],
  ],
  '6': [
    [0,1,1,1,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,1,1,0],
  ],
  '7': [
    [1,1,1,1,1],
    [0,0,0,0,1],
    [0,0,0,1,0],
    [0,0,1,0,0],
    [0,1,0,0,0],
    [0,1,0,0,0],
    [0,1,0,0,0],
  ],
  '8': [
    [0,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,1,1,0],
  ],
  '9': [
    [0,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,1,1,1],
    [0,0,0,0,1],
    [0,0,0,0,1],
    [0,1,1,1,0],
  ],
  ':': [
    [0,0,0],
    [0,1,0],
    [0,1,0],
    [0,0,0],
    [0,1,0],
    [0,1,0],
    [0,0,0],
  ],
  '.': [
    [0,0],
    [0,0],
    [0,0],
    [0,0],
    [0,0],
    [1,1],
    [1,1],
  ],
  ' ': [
    [0,0,0],
    [0,0,0],
    [0,0,0],
    [0,0,0],
    [0,0,0],
    [0,0,0],
    [0,0,0],
  ],
}

const DOT_SPACING = 10
const DOT_RADIUS = 3.8
const CHAR_GAP = 6
const ROWS = 7

export default function DotMatrix({ text, className = '' }) {
  const chars = text.split('')
  let cursorX = 0
  const placed = []

  chars.forEach((ch, idx) => {
    const pattern = FONT[ch]
    if (!pattern) return
    const cols = pattern[0].length
    placed.push({ idx, ch, x: cursorX, pattern, cols })
    cursorX += cols * DOT_SPACING + CHAR_GAP
  })

  const totalW = Math.max(0, cursorX - CHAR_GAP)
  const totalH = ROWS * DOT_SPACING

  return (
    <svg
      className={className}
      viewBox={`0 0 ${totalW} ${totalH}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      {placed.map(({ idx, ch, x, pattern, cols }) =>
        pattern.flatMap((row, r) =>
          row.map((on, c) => (
            <circle
              key={`${idx}-${r}-${c}`}
              cx={x + c * DOT_SPACING + DOT_SPACING / 2}
              cy={r * DOT_SPACING + DOT_SPACING / 2}
              r={DOT_RADIUS}
              style={{ fill: on ? 'var(--dot-lit)' : 'var(--dot-dim)' }}
            />
          ))
        )
      )}
    </svg>
  )
}
