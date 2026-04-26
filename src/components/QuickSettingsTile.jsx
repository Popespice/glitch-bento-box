import { useEffect, useState } from 'react'
import { sys } from '../lib/sys.js'
import { usePolling } from '../lib/usePolling.js'
import PixelToggle from './PixelToggle.jsx'
import DotMatrix from './DotMatrix.jsx'

// ---------------------------------------------------------------------------
// Pixel-art icon patterns — 5 cols × 7 rows (matching DotMatrix character height)
// ---------------------------------------------------------------------------
const ICON_DND = [
  [0,1,1,1,0],
  [1,0,0,1,1],
  [1,0,1,0,1],
  [1,1,0,0,1],
  [1,0,0,0,1],
  [1,0,0,0,1],
  [0,1,1,1,0],
]
const ICON_WORK = [
  [0,1,1,1,0],
  [1,1,1,1,1],
  [1,0,1,0,1],
  [1,1,1,1,1],
  [1,0,0,0,1],
  [1,0,0,0,1],
  [0,1,1,1,0],
]
const ICON_PERSONAL = [
  [0,1,0,1,0],
  [1,1,1,1,1],
  [1,1,1,1,1],
  [0,1,1,1,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,0,0,0],
]
const ICON_SLEEP = [
  [0,0,1,1,1],
  [0,1,1,0,0],
  [1,1,0,0,0],
  [1,1,0,0,0],
  [0,1,1,0,0],
  [0,0,1,1,1],
  [0,0,0,0,0],
]

const FOCUS_MODES = [
  { key: 'dnd',      label: 'DND', shortcut: 'Do Not Disturb', icon: ICON_DND      },
  { key: 'work',     label: 'WRK', shortcut: 'Work',           icon: ICON_WORK     },
  { key: 'personal', label: 'PER', shortcut: 'Personal',       icon: ICON_PERSONAL },
  { key: 'sleep',    label: 'SLP', shortcut: 'Sleep',          icon: ICON_SLEEP    },
]

// Small SVG pixel-art icon
const ICON_S = 5    // dot spacing
const ICON_R = 2    // dot radius
const ICON_W = 4 * ICON_S + ICON_R * 2   // 4 gaps × spacing + 2 radii
const ICON_H = 6 * ICON_S + ICON_R * 2

function FocusIcon({ pattern, active }) {
  return (
    <svg width={ICON_W} height={ICON_H} viewBox={`0 0 ${ICON_W} ${ICON_H}`}>
      {pattern.map((row, r) =>
        row.map((cell, c) => (
          <circle
            key={`${r}-${c}`}
            cx={ICON_R + c * ICON_S}
            cy={ICON_R + r * ICON_S}
            r={ICON_R}
            fill={
              cell
                ? active
                  ? 'var(--dot-lit)'
                  : 'rgba(224,224,224,0.32)'
                : 'var(--dot-dim)'
            }
          />
        ))
      )}
    </svg>
  )
}

const POLL_MS = 10_000

export default function QuickSettingsTile() {
  const [wifiOn,     setWifiOn]     = useState(true)
  const [wifiSSID,   setWifiSSID]   = useState('—')
  const [wifiBusy,   setWifiBusy]   = useState(false)

  const [btOn,       setBtOn]       = useState(true)
  const [btBusy,     setBtBusy]     = useState(false)
  const [btAvail,    setBtAvail]    = useState(true)   // false = helper failed to compile

  const [caffOn,     setCaffOn]     = useState(false)
  const [caffBusy,   setCaffBusy]   = useState(false)

  const [focusMode,  setFocusMode]  = useState(null)   // key string | null
  const [focusError, setFocusError] = useState(false)  // shortcuts not configured

  // ── Status polling ──────────────────────────────────────────────────────
  const fetchStatus = async () => {
    const [wifi, bt, caff] = await Promise.allSettled([
      sys.wifiStatus(),
      sys.bluetoothStatus(),
      sys.caffeinateStatus(),
    ])
    if (wifi.status === 'fulfilled' && wifi.value) {
      setWifiOn(!!wifi.value.on)
      setWifiSSID(wifi.value.ssid || '—')
    }
    if (bt.status === 'fulfilled' && bt.value) {
      setBtOn(!!bt.value.on)
      setBtAvail(bt.value.available !== false)
    }
    if (caff.status === 'fulfilled' && caff.value) {
      setCaffOn(!!caff.value.on)
    }
  }

  usePolling(fetchStatus, POLL_MS)

  // ── WiFi ────────────────────────────────────────────────────────────────
  const handleWifiToggle = async () => {
    if (wifiBusy) return
    setWifiBusy(true)
    const next = !wifiOn
    try {
      const result = await sys.wifiToggle(next)
      if (result?.ok) {
        setWifiOn(next)
        setWifiSSID(next ? '…' : 'OFF')
        // Re-fetch SSID after a short delay for the interface to come up
        setTimeout(fetchStatus, 2000)
      }
    } finally {
      setWifiBusy(false)
    }
  }

  // ── Bluetooth ───────────────────────────────────────────────────────────
  const handleBtToggle = async () => {
    if (btBusy || !btAvail) return
    setBtBusy(true)
    const next = !btOn
    try {
      const result = await sys.bluetoothToggle(next)
      if (result?.ok) setBtOn(next)
    } finally {
      setBtBusy(false)
    }
  }

  // ── Caffeinate ──────────────────────────────────────────────────────────
  const handleCaffToggle = async () => {
    if (caffBusy) return
    setCaffBusy(true)
    const next = !caffOn
    try {
      const result = await sys.caffeinateToggle(next)
      if (result?.ok) setCaffOn(next)
    } finally {
      setCaffBusy(false)
    }
  }

  // ── Focus ───────────────────────────────────────────────────────────────
  const handleFocusMode = async (mode) => {
    const newKey = focusMode === mode.key ? null : mode.key
    setFocusMode(newKey)   // optimistic
    const shortcutName = newKey ? mode.shortcut : null
    const result = await sys.focusSet(shortcutName)
    if (!result?.ok && result?.notConfigured) {
      setFocusError(true)
    }
  }

  const openShortcutsApp = () => {
    sys.openShortcutsApp?.()
  }

  return (
    <div className="tile settings-tile">
      <span className="tile-label">QUICK SETTINGS</span>
      <div className="settings-grid">

        {/* ── Wi-Fi ── */}
        <div className="setting-row">
          <span className="setting-name">WI-FI</span>
          <div className="setting-right">
            <span className="setting-value">{wifiOn ? wifiSSID : 'OFF'}</span>
            <PixelToggle on={wifiOn} onClick={handleWifiToggle} disabled={wifiBusy} />
          </div>
        </div>

        {/* ── Bluetooth ── */}
        <div className="setting-row">
          <span className="setting-name">BLUETOOTH</span>
          <div className="setting-right">
            <span className="setting-value">
              {!btAvail ? 'UNAVAIL' : btOn ? 'ON' : 'OFF'}
            </span>
            <PixelToggle on={btOn} onClick={handleBtToggle} disabled={btBusy || !btAvail} />
          </div>
        </div>

        {/* ── Caffeinate ── */}
        <div className="setting-row">
          <span className="setting-name">CAFFEINATE</span>
          <div className="setting-right">
            <span className="setting-value">{caffOn ? 'AWAKE' : '—'}</span>
            <PixelToggle on={caffOn} onClick={handleCaffToggle} disabled={caffBusy} />
          </div>
        </div>

        {/* ── Focus ── */}
        <div className="setting-row focus-row">
          <span className="setting-name">FOCUS</span>
          <div className="focus-modes-row">
            {FOCUS_MODES.map((mode) => (
              <button
                key={mode.key}
                className={`focus-mode-btn${focusMode === mode.key ? ' focus-mode-btn--active' : ''}`}
                onClick={() => handleFocusMode(mode)}
                title={mode.shortcut}
              >
                <FocusIcon pattern={mode.icon} active={focusMode === mode.key} />
                <span className="focus-mode-label">
                  <DotMatrix text={mode.label} />
                </span>
              </button>
            ))}
          </div>
        </div>

      </div>

      {focusError && (
        <button className="focus-setup-hint" onClick={openShortcutsApp}>
          SETUP SHORTCUTS ↗
        </button>
      )}
    </div>
  )
}
