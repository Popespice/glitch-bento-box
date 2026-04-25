import { useState } from 'react'

const INITIAL = [
  { key: 'wifi', name: 'Wi-Fi', value: 'STUDIO-5G', on: true },
  { key: 'bluetooth', name: 'Bluetooth', value: '3 DEVICES', on: true },
  { key: 'focus', name: 'Focus', value: 'WORK', on: true },
  { key: 'glyph', name: 'Glyph', value: 'ESSENTIAL', on: false },
]

export default function QuickSettingsTile() {
  const [settings, setSettings] = useState(INITIAL)

  const toggle = (key) => {
    setSettings((s) => s.map((r) => (r.key === key ? { ...r, on: !r.on } : r)))
  }

  return (
    <div className="tile settings-tile">
      <span className="tile-label">QUICK SETTINGS</span>
      <div className="settings-grid">
        {settings.map((row) => (
          <div key={row.key} className="setting-row">
            <span className="setting-name">{row.name}</span>
            <div className="setting-right">
              <span className="setting-value">{row.value}</span>
              <div
                className={`toggle-switch ${row.on ? 'on' : ''}`}
                onClick={() => toggle(row.key)}
                role="button"
                tabIndex={0}
              >
                <div className="toggle-knob" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
