import { useEffect, useRef, useState } from 'react'
import DotMatrix from './DotMatrix.jsx'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'

function ecgValue(phase) {
  const p = ((phase % 1) + 1) % 1
  if (p < 0.10) return 0
  if (p < 0.18) return Math.sin((p - 0.10) / 0.08 * Math.PI) * 0.12
  if (p < 0.24) return 0
  if (p < 0.26) return -((p - 0.24) / 0.02) * 0.18
  if (p < 0.285) return -0.18 + ((p - 0.26) / 0.025) * 1.30
  if (p < 0.31) return 1.12 - ((p - 0.285) / 0.025) * 1.40
  if (p < 0.33) return -0.28 + ((p - 0.31) / 0.02) * 0.28
  if (p < 0.45) return 0
  if (p < 0.60) return Math.sin((p - 0.45) / 0.15 * Math.PI) * 0.22
  return 0
}

export default function SystemPulseTile() {
  const canvasRef = useRef(null)
  const [cpu, setCpu] = useState(38)
  const cpuRef = useRef(cpu)
  cpuRef.current = cpu

  usePolling(async () => {
    try {
      const c = await sys.cpu()
      setCpu(c.percent)
    } catch { /* ignore */ }
  }, 2000)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let phaseOffset = 0
    let smoothBpm = 60 + cpuRef.current * 1.2
    let lastTime = performance.now()
    let rafId

    const draw = (now) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      const targetBpm = 60 + cpuRef.current * 1.2
      smoothBpm += (targetBpm - smoothBpm) * Math.min(1, dt * 2.5)

      phaseOffset += (dt * smoothBpm) / 60

      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      const stroke = getComputedStyle(document.body).getPropertyValue('--ekg-stroke').trim() || '#e0e0e0'
      ctx.strokeStyle = stroke
      ctx.lineWidth = 1.5 * dpr
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      const scrollSpeed = 110 * dpr
      const step = 1.2 * dpr
      const midY = h / 2
      const amp = h * 0.42

      ctx.beginPath()
      for (let x = 0; x <= w; x += step) {
        const timeOffset = -(w - x) / scrollSpeed
        const phase = phaseOffset + (timeOffset * smoothBpm) / 60
        const y = midY - ecgValue(phase) * amp
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      rafId = requestAnimationFrame(draw)
    }
    rafId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [])

  const bpm = Math.round(60 + cpu * 1.2)

  return (
    <div className="tile pulse-tile">
      <span className="tile-label">SYSTEM PULSE ●</span>
      <div className="pulse-value-row">
        <div className="tile-value-matrix md">
          <DotMatrix text={String(bpm)} />
        </div>
        <span className="pulse-unit">BPM</span>
      </div>
      <div className="ekg-wrapper">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <span className="tile-meta-line">TIED TO CPU LOAD / {Math.round(cpu)}%</span>
    </div>
  )
}
