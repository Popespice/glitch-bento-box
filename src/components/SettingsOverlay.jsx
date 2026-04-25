import { useEffect, useRef, useState } from 'react'
import { sys } from '../lib/sys.js'

export default function SettingsOverlay({ onClose }) {
  const [locationQuery, setLocationQuery]   = useState('')
  const [locationName,  setLocationName]    = useState('')
  const [locationError, setLocationError]   = useState('')
  const [resolvedCoords, setResolvedCoords] = useState(null)
  const [githubUser,    setGithubUser]      = useState('')
  const [saving,        setSaving]          = useState(false)
  const [saved,         setSaved]           = useState(false)
  const [geocoding,     setGeocoding]       = useState(false)

  const overlayRef = useRef(null)

  // Load existing settings on mount
  useEffect(() => {
    sys.settingsGet().then((s) => {
      if (s?.weather?.query)        setLocationQuery(s.weather.query)
      if (s?.weather?.locationName) setLocationName(s.weather.locationName)
      if (s?.weather?.lat != null)  setResolvedCoords({ lat: s.weather.lat, lon: s.weather.lon })
      if (s?.github?.username)      setGithubUser(s.github.username)
    })
  }, [])

  // Escape key to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Click outside to close
  const handleBackdropClick = (e) => {
    if (e.target === overlayRef.current) onClose()
  }

  const geocode = async (query) => {
    if (!query.trim()) return
    setGeocoding(true)
    setLocationError('')
    setLocationName('')
    setResolvedCoords(null)
    try {
      const result = await sys.settingsGeocode(query.trim())
      if (result) {
        setLocationName(result.locationName)
        setResolvedCoords({ lat: result.lat, lon: result.lon })
      } else {
        setLocationError('Location not found — try a city name or zip code')
      }
    } catch {
      setLocationError('Geocoding failed — check your connection')
    } finally {
      setGeocoding(false)
    }
  }

  const handleLocationBlur = () => geocode(locationQuery)
  const handleLocationKey  = (e) => { if (e.key === 'Enter') geocode(locationQuery) }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (resolvedCoords) {
        await sys.settingsSet('weather', {
          query:        locationQuery,
          locationName: locationName,
          lat:          resolvedCoords.lat,
          lon:          resolvedCoords.lon,
        })
      }
      await sys.settingsSet('github', { username: githubUser.trim() })
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 800)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={handleBackdropClick}>
      <div className="settings-panel">
        <div className="settings-header">
          <span className="settings-title">SETTINGS</span>
          <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="settings-section">
          <label className="settings-label">WEATHER LOCATION</label>
          <input
            className="settings-input"
            type="text"
            placeholder="City name or zip code"
            value={locationQuery}
            onChange={(e) => { setLocationQuery(e.target.value); setLocationName(''); setResolvedCoords(null) }}
            onBlur={handleLocationBlur}
            onKeyDown={handleLocationKey}
            spellCheck={false}
          />
          {geocoding && (
            <span className="settings-status">LOCATING…</span>
          )}
          {!geocoding && locationName && (
            <span className="settings-status settings-status--ok">✓ {locationName}</span>
          )}
          {!geocoding && locationError && (
            <span className="settings-status settings-status--err">{locationError}</span>
          )}
        </div>

        <div className="settings-section">
          <label className="settings-label">GITHUB USERNAME</label>
          <input
            className="settings-input"
            type="text"
            placeholder="Leave blank to auto-detect via gh CLI"
            value={githubUser}
            onChange={(e) => setGithubUser(e.target.value)}
            spellCheck={false}
          />
          <span className="settings-hint">Used for the contributions heatmap</span>
        </div>

        <div className="settings-footer">
          <button
            className={`settings-save${saved ? ' settings-save--done' : ''}`}
            onClick={handleSave}
            disabled={saving || saved}
          >
            {saved ? '✓ SAVED' : saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  )
}
