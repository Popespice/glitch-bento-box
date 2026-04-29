import { useEffect, useRef, useState } from 'react'
import { sys } from '../lib/sys.js'

const dispatchSettingsChanged = (changed) =>
  window.dispatchEvent(new CustomEvent('bento:settings-changed', { detail: { changed } }))

const TEXT_SIZE_PRESETS = [
  { label: 'S', value: 1.0 },
  { label: 'M', value: 1.15 },
  { label: 'L', value: 1.3 },
  { label: 'XL', value: 1.5 },
]

export default function SettingsOverlay({ onClose }) {
  const [locationQuery, setLocationQuery] = useState('')
  const [locationName, setLocationName] = useState('')
  const [locationError, setLocationError] = useState('')
  const [resolvedCoords, setResolvedCoords] = useState(null)
  const [githubUser, setGithubUser] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [textScale, setTextScale] = useState(1)

  // GitHub OAuth state (Device Flow)
  const [githubConnected, setGithubConnected] = useState(false)
  const [githubLogin, setGithubLogin] = useState('')
  const [githubError, setGithubError] = useState('')
  const [githubAwaiting, setGithubAwaiting] = useState(false)
  const [githubUserCode, setGithubUserCode] = useState('')
  const [githubVerificationUri, setGithubVerificationUri] = useState('')
  const [githubClientId, setGithubClientId] = useState('')
  const [githubClientIdInput, setGithubClientIdInput] = useState('')
  const [githubEditingCreds, setGithubEditingCreds] = useState(false)

  // Spotify state — user-supplied client_id (PKCE), refresh token after Connect.
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [spotifyConnecting, setSpotifyConnecting] = useState(false)
  const [spotifyError, setSpotifyError] = useState('')
  const [spotifyClientId, setSpotifyClientId] = useState('')
  const [spotifyClientIdInput, setSpotifyClientIdInput] = useState('')
  const [spotifyEditingCreds, setSpotifyEditingCreds] = useState(false)

  // Calendar state — provider-aware (iCloud or Google), with calendar picker.
  const [calProvider, setCalProvider] = useState(null) // persisted provider
  const [calTab, setCalTab] = useState('icloud') // active tab in UI
  const [calConnected, setCalConnected] = useState(false)
  const [calConnecting, setCalConnecting] = useState(false)
  const [calError, setCalError] = useState('')
  const [calCalendars, setCalCalendars] = useState([]) // [{ id, name }]
  const [activeCalIds, setActiveCalIds] = useState([])
  const [icloudUser, setIcloudUser] = useState('')
  const [icloudPass, setIcloudPass] = useState('')
  const [calSaving, setCalSaving] = useState(false)
  const [calSaved, setCalSaved] = useState(false)

  const overlayRef = useRef(null)

  const refreshGithubStatus = async () => {
    const s = await sys.githubStatus()
    setGithubConnected(!!s?.connected)
    setGithubLogin(s?.login || '')
  }

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
      if (s?.weather?.query) setLocationQuery(s.weather.query)
      if (s?.weather?.locationName) setLocationName(s.weather.locationName)
      if (s?.weather?.lat != null)
        setResolvedCoords({
          lat: s.weather.lat,
          lon: s.weather.lon,
          timezone: s.weather.timezone || '',
        })
      if (s?.github?.username) setGithubUser(s.github.username)
      setGithubClientId(s?.github?.clientId || '')
      setSpotifyClientId(s?.spotify?.clientId || '')
      setSpotifyConnected(!!s?.spotify?.connected)
      setTextScale(s?.ui?.textScale ?? 1)
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only init
    refreshGithubStatus()
    refreshCalendarStatus()
  }, [])

  // Listen for GitHub Device Flow completion (sent from main process when
  // GitHub finally returns an access token or the flow fails/expires).
  useEffect(() => {
    if (!sys.onGithubAuthResult) return
    const unsubscribe = sys.onGithubAuthResult((result) => {
      setGithubAwaiting(false)
      setGithubUserCode('')
      setGithubVerificationUri('')
      if (result?.ok) {
        setGithubError('')
        refreshGithubStatus()
        dispatchSettingsChanged(['github'])
      } else {
        setGithubError(result?.error || 'Authorization failed')
      }
    })
    return unsubscribe
  }, [])

  // Escape key to close
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
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
        setResolvedCoords({ lat: result.lat, lon: result.lon, timezone: result.timezone || '' })
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
  const handleLocationKey = (e) => {
    if (e.key === 'Enter') geocode(locationQuery)
  }

  const handleGithubSaveClientId = async () => {
    const id = githubClientIdInput.trim()
    if (!id) return
    await sys.settingsSet('github.clientId', id)
    setGithubClientId(id)
    setGithubClientIdInput('')
    setGithubEditingCreds(false)
    setGithubError('')
  }

  const handleGithubClearClientId = async () => {
    if (!window.confirm('Replace OAuth client ID? You will be signed out.')) return
    await sys.githubDisconnect()
    await sys.settingsSet('github.clientId', '')
    setGithubClientId('')
    await refreshGithubStatus()
  }

  const handleSpotifySaveClientId = async () => {
    const id = spotifyClientIdInput.trim()
    if (!id) return
    await sys.settingsSet('spotify.clientId', id)
    setSpotifyClientId(id)
    setSpotifyClientIdInput('')
    setSpotifyEditingCreds(false)
    setSpotifyError('')
  }

  const handleSpotifyClearClientId = async () => {
    if (!window.confirm('Replace OAuth client ID? You will be signed out.')) return
    await sys.spotifyDisconnect()
    await sys.settingsSet('spotify.clientId', '')
    setSpotifyClientId('')
    await refreshSpotifyStatus()
  }

  const handleGithubConnect = async () => {
    setGithubError('')
    try {
      const result = await sys.githubConnectStart()
      if (result?.ok) {
        setGithubUserCode(result.userCode || '')
        setGithubVerificationUri(result.verificationUri || '')
        setGithubAwaiting(true)
      } else {
        setGithubError(result?.error || 'Sign-in failed to start')
      }
    } catch (err) {
      setGithubError(err?.message || 'Sign-in failed to start')
    }
  }

  const handleGithubReopenBrowser = () => {
    if (githubVerificationUri) sys.openExternal?.(githubVerificationUri)
  }

  const handleGithubCancel = async () => {
    await sys.githubConnectCancel?.()
    setGithubAwaiting(false)
    setGithubUserCode('')
    setGithubVerificationUri('')
  }

  const handleGithubDisconnect = async () => {
    if (!window.confirm('Disconnect GitHub? Your token will be wiped from local storage.')) return
    await sys.githubDisconnect()
    await refreshGithubStatus()
    setGithubError('')
    dispatchSettingsChanged(['github'])
  }

  const handleSpotifyConnect = async () => {
    setSpotifyConnecting(true)
    setSpotifyError('')
    try {
      const result = await sys.spotifyConnect()
      if (result?.ok) {
        await refreshSpotifyStatus()
        dispatchSettingsChanged(['spotify'])
      } else {
        setSpotifyError(result?.error || 'Connect failed')
      }
    } catch (err) {
      setSpotifyError(err?.message || 'Connect failed')
    } finally {
      setSpotifyConnecting(false)
    }
  }

  const handleSpotifyCancel = async () => {
    await sys.spotifyConnectCancel?.()
    // The pending connect's promise will resolve/reject from the cancel,
    // which flips spotifyConnecting back to false in handleSpotifyConnect's
    // finally block — no need to set state here.
  }

  const handleSpotifyDisconnect = async () => {
    if (!window.confirm('Disconnect Spotify? Your refresh token will be wiped from local storage.'))
      return
    await sys.spotifyDisconnect()
    await refreshSpotifyStatus()
    setSpotifyError('')
    dispatchSettingsChanged(['spotify'])
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
        setIcloudPass('') // clear password from the input field
        await refreshCalendarStatus()
        dispatchSettingsChanged(['calendar'])
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
        dispatchSettingsChanged(['calendar'])
      } else {
        setCalError(result?.error || 'Google connect failed')
      }
    } catch (err) {
      setCalError(err?.message || 'Google connect failed')
    } finally {
      setCalConnecting(false)
    }
  }

  const handleCalendarGoogleCancel = async () => {
    await sys.calendarConnectGoogleCancel?.()
  }

  const handleCalendarDisconnect = async () => {
    if (!window.confirm('Disconnect calendar? All credentials will be wiped from local storage.'))
      return
    await sys.calendarDisconnect()
    setCalCalendars([])
    setActiveCalIds([])
    setIcloudUser('')
    setIcloudPass('')
    setCalError('')
    await refreshCalendarStatus()
    dispatchSettingsChanged(['calendar'])
  }

  const toggleCalendarId = (id) => {
    setActiveCalIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSaveCalendars = async () => {
    setCalSaving(true)
    try {
      await sys.calendarSetActive(activeCalIds)
      dispatchSettingsChanged(['calendar'])
      setCalSaved(true)
      setTimeout(() => setCalSaved(false), 1200)
    } finally {
      setCalSaving(false)
    }
  }

  const handleTextSizeSelect = async (value) => {
    setTextScale(value)
    await sys.settingsSet('ui', { textScale: value })
    dispatchSettingsChanged(['ui'])
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const changed = []
      if (resolvedCoords) {
        await sys.settingsSet('weather', {
          query: locationQuery,
          locationName: locationName,
          lat: resolvedCoords.lat,
          lon: resolvedCoords.lon,
          timezone: resolvedCoords.timezone || '',
        })
        changed.push('weather')
      }
      await sys.settingsSet('github', { username: githubUser.trim() })
      changed.push('github')

      // Tell the rest of the app to refetch immediately (the tiles' own
      // intervals are 30 min / 1 hr, which is too slow to feel responsive).
      dispatchSettingsChanged(changed)

      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        onClose()
      }, 800)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={handleBackdropClick}>
      <div className="settings-panel">
        <div className="settings-header">
          <span className="settings-title">SETTINGS</span>
          <button className="settings-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="settings-body">
        <div className="settings-section">
          <label className="settings-label">TEXT SIZE</label>
          <div className="settings-calendar-tabs">
            {TEXT_SIZE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`settings-tab${textScale === preset.value ? ' settings-tab--active' : ''}`}
                onClick={() => handleTextSizeSelect(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <span className="settings-hint">
            Scales every small label. Big readouts (clock, temp, %) stay the same.
          </span>
        </div>

        <div className="settings-section">
          <label className="settings-label">WEATHER LOCATION</label>
          <input
            className="settings-input"
            type="text"
            placeholder="City name or zip code"
            value={locationQuery}
            onChange={(e) => {
              setLocationQuery(e.target.value)
              setLocationName('')
              setResolvedCoords(null)
            }}
            onBlur={handleLocationBlur}
            onKeyDown={handleLocationKey}
            spellCheck={false}
          />
          {geocoding && <span className="settings-status">LOCATING…</span>}
          {!geocoding && locationName && (
            <span className="settings-status settings-status--ok">✓ {locationName}</span>
          )}
          {!geocoding && locationError && (
            <span className="settings-status settings-status--err">{locationError}</span>
          )}
        </div>

        <div className="settings-section">
          <label className="settings-label">GITHUB</label>
          {githubConnected ? (
            <>
              <div className="settings-spotify-row">
                <span className="settings-status settings-status--ok">
                  ✓ {githubLogin || 'CONNECTED'}
                </span>
                <button
                  className="settings-button settings-button--ghost"
                  onClick={handleGithubDisconnect}
                >
                  DISCONNECT
                </button>
              </div>
              <button
                className="settings-link-button"
                onClick={handleGithubClearClientId}
              >
                Change OAuth App
              </button>
            </>
          ) : !githubClientId || githubEditingCreds ? (
            <>
              <input
                className="settings-input"
                type="text"
                placeholder="Paste your GitHub OAuth Client ID"
                value={githubClientIdInput}
                onChange={(e) => setGithubClientIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGithubSaveClientId()}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="settings-spotify-row">
                <span className="settings-status">
                  {githubClientId ? 'EDIT OAUTH APP' : 'NOT CONFIGURED'}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {githubEditingCreds && (
                    <button
                      className="settings-button settings-button--ghost"
                      onClick={() => {
                        setGithubEditingCreds(false)
                        setGithubClientIdInput('')
                      }}
                    >
                      CANCEL
                    </button>
                  )}
                  <button
                    className="settings-button"
                    onClick={handleGithubSaveClientId}
                    disabled={!githubClientIdInput.trim()}
                  >
                    SAVE
                  </button>
                </div>
              </div>
              <span className="settings-hint">
                Register a Device-Flow OAuth App at{' '}
                <code>github.com/settings/applications/new</code>. Check{' '}
                <strong>Enable Device Flow</strong>, then paste the Client ID. See the README for
                full instructions.
              </span>
            </>
          ) : githubAwaiting ? (
            <>
              <div className="settings-github-code-row">
                <span className="settings-status">CODE IN BROWSER:</span>
                <span className="settings-github-code">{githubUserCode}</span>
              </div>
              <div className="settings-spotify-row">
                <span className="settings-status">WAITING FOR AUTHORIZATION…</span>
                <button
                  className="settings-button settings-button--ghost"
                  onClick={handleGithubReopenBrowser}
                >
                  REOPEN ↗
                </button>
                <button
                  className="settings-button settings-button--ghost"
                  onClick={handleGithubCancel}
                >
                  CANCEL
                </button>
              </div>
              <span className="settings-hint">
                Verify this code matches the one shown in your browser, then click Authorize.
              </span>
            </>
          ) : (
            <>
              <div className="settings-spotify-row">
                {githubError ? (
                  <span className="settings-status settings-status--err">{githubError}</span>
                ) : (
                  <span className="settings-status">NOT CONNECTED</span>
                )}
                <button className="settings-button" onClick={handleGithubConnect}>
                  SIGN IN WITH GITHUB
                </button>
              </div>
              <button
                className="settings-link-button"
                onClick={handleGithubClearClientId}
              >
                Change OAuth App
              </button>
            </>
          )}
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
                    Generate an app-specific password at appleid.apple.com — never your real Apple
                    ID password.
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
              ) : calConnecting ? (
                <>
                  <span className="settings-status">WAITING FOR BROWSER…</span>
                  <button
                    className="settings-button settings-button--ghost"
                    onClick={handleCalendarGoogleCancel}
                  >
                    CANCEL
                  </button>
                </>
              ) : (
                <>
                  {calError ? (
                    <span className="settings-status settings-status--err">{calError}</span>
                  ) : (
                    <span className="settings-status">NOT CONNECTED</span>
                  )}
                  <button
                    className="settings-button"
                    onClick={handleCalendarConnectGoogle}
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
          {!spotifyClientId || spotifyEditingCreds ? (
            <>
              <input
                className="settings-input"
                type="text"
                placeholder="Paste your Spotify OAuth Client ID"
                value={spotifyClientIdInput}
                onChange={(e) => setSpotifyClientIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSpotifySaveClientId()}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="settings-spotify-row">
                <span className="settings-status">
                  {spotifyClientId ? 'EDIT OAUTH APP' : 'NOT CONFIGURED'}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {spotifyEditingCreds && (
                    <button
                      className="settings-button settings-button--ghost"
                      onClick={() => {
                        setSpotifyEditingCreds(false)
                        setSpotifyClientIdInput('')
                      }}
                    >
                      CANCEL
                    </button>
                  )}
                  <button
                    className="settings-button"
                    onClick={handleSpotifySaveClientId}
                    disabled={!spotifyClientIdInput.trim()}
                  >
                    SAVE
                  </button>
                </div>
              </div>
              <span className="settings-hint">
                Register a PKCE app at <code>developer.spotify.com/dashboard</code> with{' '}
                <code>bento://callback</code> as a Redirect URI, then paste the Client ID. See the
                README for full instructions.
              </span>
            </>
          ) : (
            <>
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
                ) : spotifyConnecting ? (
                  <>
                    <span className="settings-status">WAITING FOR BROWSER…</span>
                    <button
                      className="settings-button settings-button--ghost"
                      onClick={handleSpotifyCancel}
                    >
                      CANCEL
                    </button>
                  </>
                ) : (
                  <>
                    {spotifyError ? (
                      <span className="settings-status settings-status--err">{spotifyError}</span>
                    ) : (
                      <span className="settings-status">NOT CONNECTED</span>
                    )}
                    <button className="settings-button" onClick={handleSpotifyConnect}>
                      CONNECT SPOTIFY
                    </button>
                  </>
                )}
              </div>
              <button
                className="settings-link-button"
                onClick={handleSpotifyClearClientId}
              >
                Change OAuth App
              </button>
            </>
          )}
        </div>
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
