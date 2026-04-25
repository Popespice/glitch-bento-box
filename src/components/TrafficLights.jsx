import { useEffect, useState } from 'react'

const isMac = typeof navigator !== 'undefined' &&
  navigator.userAgent.includes('Macintosh')

export default function TrafficLights() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isMac) return
    const show = () => setVisible(true)
    const hide = () => setVisible(false)
    // mouseenter/mouseleave on the document element fire when the cursor
    // crosses the window boundary in Electron's Chromium renderer.
    document.documentElement.addEventListener('mouseenter', show)
    document.documentElement.addEventListener('mouseleave', hide)
    return () => {
      document.documentElement.removeEventListener('mouseenter', show)
      document.documentElement.removeEventListener('mouseleave', hide)
    }
  }, [])

  if (!isMac) return null

  const send = (channel) => () => window.bento?.[channel]?.()

  return (
    <div className={`traffic-lights ${visible ? 'tl-visible' : ''}`}>
      <button
        className="tl-btn tl-close"
        onClick={send('windowClose')}
        aria-label="Close"
        title="Close"
      />
      <button
        className="tl-btn tl-minimize"
        onClick={send('windowMinimize')}
        aria-label="Minimize"
        title="Minimize"
      />
      <button
        className="tl-btn tl-maximize"
        onClick={send('windowMaximize')}
        aria-label="Zoom"
        title="Zoom"
      />
    </div>
  )
}
