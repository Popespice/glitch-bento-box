import { useEffect, useRef, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'

function formatSpeed(bps) {
  if (bps >= 1_000_000) return { value: (bps / 1_000_000).toFixed(1), unit: 'MB/S' }
  if (bps >= 1_000) return { value: (bps / 1_000).toFixed(0), unit: 'KB/S' }
  return { value: String(Math.round(bps)), unit: 'B/S' }
}

const BARS = 26
const PEAK_WINDOW = 20 // samples ≈ 20 * 1s = 20s rolling peak

export default function NetworkTile() {
  const [down, setDown] = useState(0)
  const [up, setUp] = useState(0)
  const [iface, setIface] = useState('—')
  const [ssid, setSsid] = useState(null)
  const [ip, setIp] = useState(null)
  const [type, setType] = useState('wired')
  const [history, setHistory] = useState(() => Array(BARS).fill(0.05))
  const peakRef = useRef([])
  const [peakDown, setPeakDown] = useState(0)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const n = await sys.network()
        if (cancelled) return
        setDown(n.down)
        setUp(n.up)
        setIface(n.iface)
        setSsid(n.ssid ?? null)
        setIp(n.ip ?? null)
        setType(n.type ?? 'wired')

        peakRef.current = [...peakRef.current.slice(-(PEAK_WINDOW - 1)), n.down]
        setPeakDown(Math.max(...peakRef.current))

        // History intensity normalized to 0..1 against the rolling peak so the
        // bar chart stays alive instead of pinning to 0 when peak is high.
        const peak = Math.max(...peakRef.current, 1)
        const intensity = Math.max(0.06, Math.min(1, n.down / peak))
        setHistory((prev) => [...prev.slice(1), intensity])
      } catch {
        /* ignore */
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const downFmt = formatSpeed(down)
  const peakFmt = formatSpeed(peakDown)
  const upFmt = formatSpeed(up)
  const networkName = ssid || ip || iface
  const typeLabel = type === 'wifi' || type === 'wireless' ? 'WIFI' : type === 'wired' ? 'ETH' : (type || iface).toUpperCase()

  return (
    <div className="tile freq-tile">
      <span className="tile-label">NETWORK ● {typeLabel}</span>
      <div className="freq-value-row">
        <div className="tile-value-matrix md">
          <DotMatrix text={downFmt.value} />
        </div>
        <span className="freq-unit">{downFmt.unit}</span>
      </div>
      <div className="freq-bars">
        {history.map((h, i) => (
          <div
            key={i}
            className="freq-bar"
            style={{
              height: `${h * 100}%`,
              background: i === history.length - 1 ? 'var(--accent)' : 'var(--text-secondary)',
              opacity: 0.3 + h * 0.7,
            }}
          />
        ))}
      </div>
      <span className="tile-meta-name">{networkName}</span>
      <span className="tile-meta-line">
        PEAK {peakFmt.value} {peakFmt.unit} / ↑ {upFmt.value} {upFmt.unit}
      </span>
    </div>
  )
}
