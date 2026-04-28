# Bento

A pixel-art developer dashboard for macOS. Live system stats, Spotify now-playing, calendar countdown, GitHub activity, and quick-settings toggles, all rendered in dot-matrix style in a single resizable window.

---

## Using Bento

### Window

The app opens at 1440×900 and can be freely resized (minimum 1024×640). On macOS, the traffic light controls (close/minimize/zoom) appear in the top-left corner when you move your cursor into the window.

### Settings

Click the **⚙** button (bottom-left corner) to open the settings panel. Press **Escape** or click outside the panel to close it. Settings are saved immediately, and connected tiles refresh as soon as you save.

### Theme

The **◐ LIGHT / ◑ DARK** button (bottom-right corner) switches between light and dark mode. Your choice is remembered between sessions.

---

## Tiles

### Clock
Current time and date in dot-matrix display. Updates every second.

### Uptime / Disk / Focus
Three sections stacked in one tile.

- **Uptime**: time since last boot, formatted as `D HH:MM` or `HH:MM`.
- **Disk**: free gigabytes on the startup volume with a segment bar showing used space.
- **Focus timer**: a pomodoro-style countdown. Press **▶** to start, **■** to pause, **✕** to cancel. Use **−5** and **+5** to adjust the duration (1–120 minutes). When the timer reaches zero, a chime plays and the display shows **DONE** for 8 seconds. Your last duration is saved between sessions.

### Weather
Temperature in °F with a pixel-art condition icon. If no location is configured, the tile shows **CONFIGURE IN SETTINGS**. Open Settings and type a city name or zip code.

### Battery
Charge percentage with a segment bar and charging indicator. When discharging, the time remaining is shown below the bar. On desktops or machines without a battery, this tile shows **AC ONLY**.

### System Pulse
GPU load percentage as a live dot-bar chart. Updates every 5 seconds.

### Network
Current download speed with a scrolling bar history. Shows your Wi-Fi SSID (or IP on ethernet), and the rolling peak download and current upload in the footer.

### CPU
CPU load percentage with a scrolling sparkline. Updates every 2 seconds.

### Memory
RAM in use as a percentage with a fill bar.

### Now Playing
Spotify track and artist name in dot-matrix, an animated waveform, and a dot-matrix progress bar with elapsed/total time. States:

| Display | Meaning |
|---|---|
| Track name + waveform | Playing (waveform animates) |
| Track name + paused state | Paused (waveform dims) |
| `NOTHING PLAYING` | Spotify is open but idle |
| `SPOTIFY OFFLINE` | Not connected. Open Settings to connect. |
| `CONNECTION ERROR / RETRYING…` | Network or auth issue, retrying automatically |

### Quick Settings
Toggles for Wi-Fi, Bluetooth, Caffeinate, and Focus modes.

- **Wi-Fi**: shows your current SSID when on. Toggling requires an admin password (see [Wi-Fi toggle](#wi-fi-toggle) below to skip the prompt).
- **Bluetooth**: shows ON/OFF. `UNAVAIL` means the Bluetooth helper couldn't be compiled (Xcode CLT required).
- **Caffeinate**: prevents the display from sleeping while active. Shows **AWAKE** when on; automatically deactivates when Bento quits.
- **Focus modes**: four buttons (**DND**, **WRK**, **PER**, **SLP**). Pressing one activates the matching macOS Focus by running a Shortcut (see [Focus modes](#focus-modes) below). Pressing the active mode again deactivates it. If Shortcuts aren't configured yet, a **SETUP SHORTCUTS ↗** hint appears; clicking it opens Shortcuts.app.

### GitHub Activity
A 20-week contribution heatmap. Brighter cells = more commits that day; empty cells = no activity. Once connected, the tile label shows your `@username` and a **●** indicator.

Requires GitHub authentication. See [GitHub Heatmap](#7-github-heatmap) in setup.

### Next Event
Countdown to your next calendar event. Counts down in hours and minutes when more than an hour away, switching to minutes and seconds in the final hour. Shows the event title and calendar name below the countdown. States:

| Display | Meaning |
|---|---|
| Countdown + event title | An upcoming event was found |
| `NOTHING UPCOMING` | No events in the next window |
| `CONNECT CALENDAR` | Not connected. Open Settings. |
| `CALENDAR ERROR / RETRYING…` | Fetch failed, retrying automatically |

---

## Installation

Download the latest DMG from the [releases page](https://github.com/Popespice/glitch-bento-box/releases):

- **`Bento-x.x.x-arm64.dmg`**: Apple Silicon (M1 and later)
- **`Bento-x.x.x.dmg`**: Intel

Open the DMG, drag **Bento.app** to your Applications folder, and launch it.

**First launch note.** The DMG is signed with a local identity but not notarized. Gatekeeper will block the first launch; right-click the app, choose **Open**, and confirm in the dialog. macOS remembers this after the first run.

---

## First-time setup

All service connections are made through the in-app **Settings** panel (⚙). Nothing requires editing config files if you're using the pre-built app.

### Weather
Open Settings → type a city name or zip code in the **Weather Location** field and press Enter or click away. The location is geocoded automatically (no API key needed).

### Spotify (Now Playing tile)
Bento doesn't ship with bundled Spotify credentials. Each user registers their own free developer app, which takes about 60 seconds. Bento uses PKCE, so you only need a Client ID (no Client Secret to manage).

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → **Create app**
2. App name: anything (`Bento` is fine). Description: anything.
3. Under **Redirect URIs**, add `bento://callback` exactly, then click **Add**
4. Check the **Web API** box, agree to terms, click **Save**
5. On the app's page, copy the **Client ID** from **Basic Information**
6. In Bento: **Settings → SPOTIFY → paste your Client ID → SAVE**, then click **CONNECT SPOTIFY**

> **Note:** Spotify's free developer apps cap at 25 unique authorized users. Above that you'd submit for "Quota Extension" review. Personal/small-circle use stays well under the cap.

### Calendar: iCloud (Next Event tile)
No developer account needed.

1. Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security → App-Specific Passwords** → generate a new password
2. In Bento: **Settings → Calendar → iCloud** → enter your Apple ID and the app-specific password

### Calendar: Google (Next Event tile)
Only needed if you prefer Google Calendar over iCloud.

1. [console.cloud.google.com](https://console.cloud.google.com) → New Project
2. **APIs & Services → Library** → enable **Google Calendar API**
3. **Credentials → Create Credentials → OAuth 2.0 Client ID → Desktop app**
4. Add `http://127.0.0.1:8899/callback` to **Authorized Redirect URIs**
5. Copy **Client ID** and **Client Secret** into `electron/google-calendar-config.js`
6. In Bento: **Settings → Calendar → Google → Connect Google**

### GitHub Heatmap
Bento uses GitHub's OAuth Device Flow, which means you sign in through your browser like any normal website (no token generation, no copy-pasting tokens). You do need to register your own OAuth App once, which takes about 60 seconds.

1. Go to [github.com/settings/applications/new](https://github.com/settings/applications/new)
2. Application name: anything (`Bento` is fine)
3. Homepage URL: `https://github.com/Popespice/glitch-bento-box` (or anything)
4. Authorization callback URL: `http://localhost` (required field but never used by the Device Flow)
5. **Check the "Enable Device Flow" box** before saving — this is the important step
6. Click **Register application**
7. Copy the **Client ID** (you do **not** need to generate a client secret)
8. In Bento: **Settings → GITHUB → paste your Client ID → SAVE**, then click **SIGN IN WITH GITHUB**

Your browser opens to `github.com/login/device` with the code pre-filled. Click Authorize and Bento picks up the rest automatically.

> **Tip:** Only commits authored with an email registered to your GitHub account appear in the heatmap. If your contribution graph looks sparse, check your git email with `git config --global user.email`.

**Alternative: `gh` CLI fallback**
If you've already authenticated the [GitHub CLI](https://cli.github.com) (`gh auth login`), Bento can auto-detect that token and use it for the heatmap. No OAuth App registration needed in that case.

---

## Building from source

### Requirements
- macOS (primary platform)
- Node.js 18+ and npm
- Xcode Command Line Tools (`xcode-select --install`)

### Setup

```bash
git clone https://github.com/Popespice/glitch-bento-box.git
cd glitch-bento-box
npm install
cp electron/spotify-config.example.js electron/spotify-config.js
cp electron/google-calendar-config.example.js electron/google-calendar-config.js
```

Fill in the config files if you're using those services. Leave the placeholder values to skip them.

### Dev mode

```bash
npm run dev
```

Opens Electron with hot-reload. The UI is also available at `http://localhost:5173` in a browser with mock data (no live system calls).

### Production build

```bash
npm run dist:mac   # → release/*.dmg  (arm64 + x64)
npm run dist:win   # → release/*.exe  (NSIS installer)
npm run dist       # both
```

Output lands in `release/`. The first build downloads ~200 MB of Electron binaries; subsequent builds use the cache.

---

## Quick Settings details

### Wi-Fi toggle
Toggling Wi-Fi requires admin privileges, so macOS shows an authentication dialog on each toggle. To skip the prompt, add a sudoers rule:

```
%admin ALL=(ALL) NOPASSWD: /usr/sbin/networksetup -setairportpower *
```

### Bluetooth toggle
On first use, Bento compiles a small Swift helper into your app data directory using Xcode CLT. This takes about 5 seconds once, then it's cached. macOS will prompt for Bluetooth permission the first time; click **Allow**.

If `swiftc` isn't available, the toggle is disabled and the tile shows **UNAVAIL**.

### Caffeinate
Prevents the display from sleeping while enabled. The process is automatically stopped when Bento quits.

### Focus modes
The four focus buttons fire macOS Shortcuts by name. Create shortcuts in **Shortcuts.app** using the **Set Focus** action, named exactly:

- `Do Not Disturb`
- `Work`
- `Personal`
- `Sleep`

Only create the ones you need. Missing shortcuts are silently skipped. If no shortcuts are configured at all, the **SETUP SHORTCUTS ↗** hint appears in the tile.

---

## Permissions

| Feature | What macOS asks for |
|---|---|
| Bluetooth toggle | Bluetooth permission (one-time dialog) |
| Wi-Fi toggle | Admin authentication (each toggle, or configure sudoers) |
| Focus modes | None (Shortcuts.app handles its own permissions) |
| Caffeinate | None |
| Calendar (iCloud) | None (credentials stored locally) |
| Calendar (Google) | Google OAuth in a browser window |
| Spotify | Spotify OAuth in a browser window |

---

## Project structure

```
electron/
  main.js                        # IPC handlers, system calls, OAuth flows
  preload.js                     # Context bridge that exposes window.bento
  spotify-config.js              # gitignored, your Spotify credentials
  spotify-config.example.js
  google-calendar-config.js      # gitignored, your Google credentials
  google-calendar-config.example.js
src/
  components/                    # One file per tile + shared components
  lib/
    sys.js                       # Thin wrapper: real IPC in Electron, mocks in browser
    usePolling.js                # Visibility-aware polling hook
    useSettingsChanged.js        # Hook for reacting to settings changes
    formatters.js                # Shared time/speed formatting utilities
  styles.css
```

---

## License

MIT
