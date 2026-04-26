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

  // Spotify state — credentials are bundled, so this is just connect/disconnect.
  const [spotifyConnected,  setSpotifyConnected]  = useState(false)
  const [spotifyConnecting, setSpotifyConnecting] = useState(false)
  const [spotifyError,      setSpotifyError]      = useState('')

  const overlayRef = useRef(null)

  const refreshSpotifyStatus = async () => {
    const s = await sys.settingsGet()
    setSpotifyConnected(!!s?.spotify?.connected)
  }

  // Load existing settings on mount
  useEffect(() => {
    sys.settingsGet().then((s) => {
      if (s?.weather?.query)        setLocationQuery(s.weather.query)
      if (s?.weather?.locationName) setLocationName(s.weather.locationName)
      if (s?.weather?.lat != null)  setResolvedCoords({ lat: s.weather.lat, lon: s.weather.lon })
      if (s?.github?.username)      setGithubUser(s.github.username)
      setSpotifyConnected(!!s?.spotify?.connected)
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

  const handleSpotifyConnect = async () => {
    setSpotifyConnecting(true)
    setSpotifyError('')
    try {
      const result = await sys.spotifyConnect()
      if (result?.ok) {
        await refreshSpotifyStatus()
        window.dispatchEvent(new CustomEvent('bento:settings-changed', { detail: { changed: ['spotify'] } }))
      } else {
        setSpotifyError(result?.error || 'Connect failed')
      }
    } catch (err) {
      setSpotifyError(err?.message || 'Connect failed')
    } finally {
      setSpotifyConnecting(false)
    }
  }

  const handleSpotifyDisconnect = async () => {
    if (!window.confirm('Disconnect Spotify? Your refresh token will be wiped from local storage.')) return
    await sys.spotifyDisconnect()
    await refreshSpotifyStatus()
    setSpotifyError('')
    window.dispatchEvent(new CustomEvent('bento:settings-changed', { detail: { changed: ['spotify'] } }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const changed = []
      if (resolvedCoords) {
        await sys.settingsSet('weather', {
          query:        locationQuery,
          locationName: locationName,
          lat:          resolvedCoords.lat,
          lon:          resolvedCoords.lon,
        })
        changed.push('weather')
      }
      await sys.settingsSet('github', { username: githubUser.trim() })
      changed.push('github')

      // Tell the rest of the app to refetch immediately (the tiles' own
      // intervals are 30 min / 1 hr, which is too slow to feel responsive).
      window.dispatchEvent(new CustomEvent('bento:settings-changed', { detail: { changed } }))

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

        <div className="settings-section">
          <label className="settings-label">SPOTIFY</label>
          <div className="settings-spotify-row">
            {spotifyConnected ? (
              <>
                <span className="settings-status settings-status--ok">✓ CONNECTED</span>
                <button
                  className="settings-button settings-button--ghost"
                  onClick={handleSpotifyDisconnect}
                >
                  DISCONNECT
                </button>
              </>
            ) : (
              <>
                {spotifyConnecting && (
                  <span className="settings-status">WAITING FOR BROWSER…</span>
                )}
                {!spotifyConnecting && spotifyError && (
                  <span className="settings-status settings-status--err">{spotifyError}</span>
                )}
                {!spotifyConnecting && !spotifyError && (
                  <span className="settings-status">NOT CONNECTED</span>
                )}
                <button
                  className="settings-button"
                  onClick={handleSpotifyConnect}
                  disabled={spotifyConnecting}
                >
                  CONNECT SPOTIFY
                </button>
              </>
            )}
          </div>
          <span className="settings-hint">
            Sign in once. Only your refresh token is stored locally — disconnect any time to wipe it.
          </span>
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
