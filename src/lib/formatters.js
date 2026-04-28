export function fmtProgress(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtCountdown(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtUptime(sec) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return d > 0 ? `${d}D ${hh}:${mm}` : `${hh}:${mm}`
}

export function fmtTimeRemaining(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}H ${String(m).padStart(2, '0')}M` : `${m}M`
}

export function fmtSpeed(bps) {
  if (bps >= 1_000_000) return { value: (bps / 1_000_000).toFixed(1), unit: 'MB/S' }
  if (bps >= 1_000) return { value: (bps / 1_000).toFixed(0), unit: 'KB/S' }
  return { value: String(Math.round(bps)), unit: 'B/S' }
}
