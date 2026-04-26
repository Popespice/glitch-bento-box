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

  // Calendar state — provider-aware (iCloud or Google), with calendar picker.
  const [calProvider,    setCalProvider]    = useState(null)        // persisted provider
  const [calTab,         setCalTab]         = useState('icloud')    // active tab in UI
  const [calConnected,   setCalConnected]   = useState(false)
  const [calConnecting,  setCalConnecting]  = useState(false)
  const [calError,       setCalError]       = useState('')
  const [calCalendars,   setCalCalendars]   = useState([])          // [{ id, name }]
  const [activeCalIds,   setActiveCalIds]   = useState([])
  const [icloudUser,     setIcloudUser]     = useState('')
  const [icloudPass,     setIcloudPass]     = useState('')
  const [calSaving,      setCalSaving]      = useState(false)
  const [calSaved,       setCalSaved]       = useState(false)

  const overlayRef = useRef(null)

  const refreshSpotifyStatus = async () => {
    const s = await sys.settingsGet()
    setSpotifyConnected(!!s?.spotify?.connected)
  }

  const refreshCalendarStatus = async () => {
    const cs = await sys.calendarStatus()
    setCalProvider(cs?.provider || null)
    setCalConnected(!!cs?.connected)
    setActiveCalIds(cs?.activeCalendarIds || [])
    if (cs?.provider) setCalTab(cs.provider)
    // If connected, fetch the calendar list so the picker works.
    if (cs?.connected) {
      const result = await sys.calendarGetCalendars()
      if (result?.ok) setCalCalendars(result.calendars || [])
    } else {
      setCalCalendars([])
    }
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
    refreshCalendarStatus()
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

  const handleCalendarConnectIcloud = async () => {
    if (!icloudUser.trim() || !icloudPass.trim()) {
      setCalError('Enter your Apple ID and app-specific password')
      return
    }
    setCalConnecting(true)
    setCalError('')
    try {
      const result = await sys.calendarConnectIcloud(icloudUser.trim(), icloudPass)
      if (result?.ok) {
        setCalCalendars(result.calendars || [])
        // Default: include all calendars until the user picks
        setActiveCalIds((result.calendars || []).map((c) => c.id))
        setIcloudPass('')   // clear password from the input field
        await refreshCalendarStatus()
        window.dispatchEvent(new CustomEvent('bento:settings-changed', { detail: { changed: ['calendar'] } }))
      } else {
        setCalError(result?.error || 'iCloud connect failed')
      }
    } catch (err) {
      setCalError(err?.message || 'iCloud connect failed')
    } finally {
      setCalConnecting(false)
    }
  }

  const handleCalendarConnectGoogle = async () => {
    setCalConnecting(true)
    setCalError('')
    try {
      const result = await sys.calendarConnectGoogle()
      if (result?.ok) {
        setCalCalendars(result.calendars || [])
        setActiveCalIds((result.calendars || []).map((c) => c.id))
        await refreshCalendarStatus()
        window.dispatchEvent(new CustomEvent('bento:settings-changed', { detail: { changed: ['calendar'] } }))
      } else {
        setCalError(result?.error || 'Google connect failed')
      }
    } catch (err) {
      setCalError(err?.message || 'Google connect failed')
    } finally {
      setCalConnecting(false)
    }
  }

  const handleCalendarDisconnect = async () => {
    if (!window.confirm('Disconnect calendar? All credentials will be wiped from local storage.')) return
    await sys.calendarDisconnect()
    setCalCalendars([])
    setActiveCalIds([])
    setIcloudUser('')
    setIcloudPass('')
    setCalError('')
    await refreshCalendarStatus()
    window.dispatchEvent(new CustomEvent('bento:settings-changed', { detail: { changed: ['calendar'] } }))
  }

  const toggleCalendarId = (id) => {
    setActiveCalIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleSaveCalendars = async () => {
    setCalSaving(true)
    try {
      await sys.calendarSetActive(activeCalIds)
      window.dispatchEvent(new CustomEvent('bento:settings-changed', { detail: { changed: ['calendar'] } }))
      setCalSaved(true)
      setTimeout(() => setCalSaved(false), 1200)
    } finally {
      setCalSaving(false)
    }
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
          <label className="settings-label">CALENDAR</label>

          <div className="settings-calendar-tabs">
            <button
              type="button"
              className={`settings-tab${calTab === 'icloud' ? ' settings-tab--active' : ''}`}
              onClick={() => setCalTab('icloud')}
              disabled={calConnected && calProvider === 'google'}
            >
              iCLOUD
            </button>
            <button
              type="button"
              className={`settings-tab${calTab === 'google' ? ' settings-tab--active' : ''}`}
              onClick={() => setCalTab('google')}
              disabled={calConnected && calProvider === 'icloud'}
            >
              GOOGLE
            </button>
          </div>

          {calTab === 'icloud' && (
            <>
              {!(calConnected && calProvider === 'icloud') && (
                <>
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="Apple ID (email)"
                    value={icloudUser}
                    onChange={(e) => setIcloudUser(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <input
                    className="settings-input"
                    type="password"
                    placeholder="App-specific password"
                    value={icloudPass}
                    onChange={(e) => setIcloudPass(e.target.value)}
                    autoComplete="off"
                  />
                  <span className="settings-hint">
                    Generate an app-specific password at appleid.apple.com — never your real Apple ID password.
                  </span>
                </>
              )}
              <div className="settings-spotify-row">
                {calConnected && calProvider === 'icloud' ? (
                  <>
                    <span className="settings-status settings-status--ok">✓ CONNECTED</span>
                    <button
                      className="settings-button settings-button--ghost"
                      onClick={handleCalendarDisconnect}
                    >
                      DISCONNECT
                    </button>
                  </>
                ) : (
                  <>
                    {calConnecting && <span className="settings-status">CONNECTING…</span>}
                    {!calConnecting && calError && (
                      <span className="settings-status settings-status--err">{calError}</span>
                    )}
                    {!calConnecting && !calError && (
                      <span className="settings-status">NOT CONNECTED</span>
                    )}
                    <button
                      className="settings-button"
                      onClick={handleCalendarConnectIcloud}
                      disabled={calConnecting}
                    >
                      CONNECT
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {calTab === 'google' && (
            <div className="settings-spotify-row">
              {calConnected && calProvider === 'google' ? (
                <>
                  <span className="settings-status settings-status--ok">✓ CONNECTED</span>
                  <button
                    className="settings-button settings-button--ghost"
                    onClick={handleCalendarDisconnect}
                  >
                    DISCONNECT
                  </button>
                </>
              ) : (
                <>
                  {calConnecting && <span className="settings-status">WAITING FOR BROWSER…</span>}
                  {!calConnecting && calError && (
                    <span className="settings-status settings-status--err">{calError}</span>
                  )}
                  {!calConnecting && !calError && (
                    <span className="settings-status">NOT CONNECTED</span>
                  )}
                  <button
                    className="settings-button"
                    onClick={handleCalendarConnectGoogle}
                    disabled={calConnecting}
                  >
                    CONNECT GOOGLE
                  </button>
                </>
              )}
            </div>
          )}

          {calConnected && calCalendars.length > 0 && (
            <>
              <label className="settings-label settings-label--sub">CALENDARS TO MONITOR</label>
              <div className="settings-calendar-list">
                {calCalendars.map((c) => (
                  <label key={c.id} className="settings-calendar-item">
                    <input
                      type="checkbox"
                      checked={activeCalIds.includes(c.id)}
                      onChange={() => toggleCalendarId(c.id)}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
              <button
                className={`settings-button${calSaved ? ' settings-button--done' : ''}`}
                onClick={handleSaveCalendars}
                disabled={calSaving || calSaved}
              >
                {calSaved ? '✓ SAVED' : calSaving ? 'SAVING…' : 'SAVE CALENDARS'}
              </button>
            </>
          )}
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
