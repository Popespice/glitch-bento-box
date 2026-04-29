# Bento

A pixel-art developer dashboard for macOS and Windows. Live system stats, Spotify now-playing, calendar countdown, GitHub activity, and quick-settings toggles, all rendered in dot-matrix style in a single resizable window.

---

## READ THIS FIRST: GitHub and Spotify require your own OAuth Apps

> **Bento does not ship with credentials for GitHub or Spotify. To use the GitHub heatmap tile or the Spotify Now Playing tile, YOU MUST register your own free OAuth Apps with each service and paste your own Client ID into the in-app Settings panel. This takes about 60 seconds per service and only needs to happen once.**
>
> **Why?** This app is for personal use. The author of Bento does not administer your authentications, does not see your data, and does not want users authorizing apps that the author owns. Each user is the operator of their own GitHub/Spotify integration.
>
> **What works without setup:** Clock, Uptime, Disk, Focus timer, Weather, Battery / Power Draw, System Pulse (GPU), Network, CPU, Memory, Wi-Fi toggle, Bluetooth toggle, Caffeinate.
>
> **What requires the OAuth setup below:** GitHub Activity heatmap, Spotify Now Playing, Google Calendar Next Event (iCloud Calendar uses a different mechanism and does not need OAuth registration).
>
> Full step-by-step instructions are in [First-time setup](#first-time-setup) below. **Skip those steps and the GitHub/Spotify tiles WILL NOT WORK.** That is a guarantee, not a bug.

---

## Privacy

**Bento collects zero data. Nothing about you, your system, or your activity ever leaves your machine.**

- All OAuth tokens (GitHub, Spotify, Google) are stored exclusively in your local app data directory via `electron-store`. They are never transmitted to the author or any third party.
- API calls to GitHub, Spotify, Google Calendar, and the weather service are made directly from your machine to those services. There is no proxy, no relay, and no backend server involved.
- No analytics. No telemetry. No crash reporting. No usage tracking of any kind.
- The author of Bento has no server, receives no data, and has no visibility into what you do with the app.

---

## Using Bento

### Window

The app opens at 1440x900 and can be freely resized (minimum 1024x640).

On **macOS**, the traffic light controls (close/minimize/zoom) appear in the top-left corner when you hover your cursor into the window.

On **Windows**, the standard title bar controls appear at the top.

### Settings

Click the **gear** button (bottom-right corner, next to the theme toggle) to open the settings panel. Press **Escape** or click outside the panel to close it. Settings are saved immediately, and connected tiles refresh as soon as you save.

If your text size is large enough that the panel reaches the bottom of the screen, the panel body scrolls — the title and **SAVE** button stay pinned so they're always reachable.

### Theme

The **LIGHT / DARK** button (bottom-right corner) switches between light and dark mode. Your choice is remembered between sessions.

### Text size

Open Settings and pick a preset under **TEXT SIZE**: **S** (the default — current sizes), **M**, **L**, or **XL**. The preset scales every small label (tile labels, meta lines, settings text) up from S; the big DotMatrix readouts (clock time, temperature, CPU%) intentionally stay the same size at every preset. Your choice persists between sessions.

---

## Tiles

### Clock
Current time and date in dot-matrix display. Updates every second.

### Uptime / Disk / Focus
Three sections stacked in one tile.

- **Uptime**: time since last boot, formatted as `D HH:MM` or `HH:MM`.
- **Disk**: free gigabytes on the startup volume with a segment bar showing used space.
- **Focus timer**: a pomodoro-style countdown. Press **play** to start, **pause** to pause, **stop** to cancel. Use **-5** and **+5** to adjust the duration (1-120 minutes). When the timer reaches zero, a chime plays and the display shows **DONE** for 8 seconds. Your last duration is saved between sessions.

### Weather
Temperature in degrees F with a pixel-art condition icon. If no location is configured, the tile shows **CONFIGURE IN SETTINGS**. Open Settings and type a city name or zip code.

### Battery / Power Draw
On laptops: charge percentage with a segment bar and charging indicator. When discharging, the estimated time remaining is shown below the bar.

On desktops or machines without a battery: the tile switches to **Power Draw** mode and shows live GPU wattage as a fill bar scaled against your GPU's TDP. On Windows this data comes from nvidia-smi, so an NVIDIA GPU is required for live wattage. Without one the tile shows **AC ONLY**.

### System Pulse
GPU load percentage as a live dot-bar chart. Updates every 5 seconds. On Windows, requires an NVIDIA GPU (reads via nvidia-smi). Without a compatible GPU the tile shows 0%.

### Network
Current download speed with a scrolling bar history. Shows your Wi-Fi SSID (or IP on ethernet), and the rolling peak download and current upload in the footer.

### CPU
CPU load percentage with a scrolling sparkline. Updates every 2 seconds.

### Memory
RAM in use as a percentage with a fill bar.

### Now Playing
Spotify track and artist name in dot-matrix, an animated waveform, and a dot-matrix progress bar with elapsed/total time.

| Display | Meaning |
|---|---|
| Track name + waveform | Playing (waveform animates) |
| Track name + static waveform | Paused |
| `NOTHING PLAYING` | Spotify is open but idle |
| `SPOTIFY OFFLINE` | Not connected. Open Settings to connect. |
| `CONNECTION ERROR / RETRYING` | Network or auth issue, retrying automatically |

### Quick Settings
Toggles for Wi-Fi, Bluetooth, Caffeinate, and (macOS only) Focus modes.

- **Wi-Fi**: shows your current SSID when connected. Toggling requires elevated privileges on both platforms (see [Wi-Fi toggle](#wi-fi-toggle) for details).
- **Bluetooth**: shows ON/OFF. See [Bluetooth toggle](#bluetooth-toggle) for platform details.
- **Caffeinate**: prevents the display from sleeping while active. Shows **AWAKE** when on. Automatically deactivates when Bento quits. Works on both macOS and Windows.
- **Focus modes** (macOS only): four buttons (**DND**, **WRK**, **PER**, **SLP**). Pressing one activates the matching macOS Focus mode by running a Shortcut. Pressing the active mode again deactivates it. Not available on Windows.

### GitHub Activity
A 20-week contribution heatmap. Brighter cells = more commits that day; empty cells = no activity. Once connected, the tile label shows your `@username` with a connected indicator.

Requires GitHub authentication. See [GitHub Heatmap](#github-heatmap) in setup.

### Next Event
Countdown to your next calendar event. Counts down in hours and minutes when more than an hour away, switching to minutes and seconds in the final hour. Shows the event title and calendar name below the countdown.

| Display | Meaning |
|---|---|
| Countdown + event title | An upcoming event was found |
| `NOTHING UPCOMING` | No events in the next window |
| `CONNECT CALENDAR` | Not connected. Open Settings. |
| `CALENDAR ERROR / RETRYING` | Fetch failed, retrying automatically |

---

## Installation

Download the latest release from the [releases page](https://github.com/Popespice/glitch-bento-box/releases).

### macOS

- **`Bento-x.x.x-arm64.dmg`**: Apple Silicon (M1 and later)
- **`Bento-x.x.x.dmg`**: Intel

Open the DMG, drag **Bento.app** to your Applications folder, and launch it.

**First launch note.** The DMG is signed with a local identity but not notarized. Gatekeeper will block the first launch. Right-click the app, choose **Open**, and confirm in the dialog. macOS remembers this decision after the first run.

### Windows

- **`Bento Setup x.x.x.exe`**: Windows 10/11 x64 (NSIS installer)

Run the installer and follow the prompts. Bento installs to your user AppData folder by default and does not require administrator rights.

**First launch note.** The installer is not code-signed. Windows SmartScreen may warn you. Click **More info** and then **Run anyway**. Windows remembers this after the first run.

---

## First-time setup

All service connections are made through the in-app **Settings** panel (gear icon). Nothing requires editing config files if you're using the pre-built app.

### Weather
Open Settings, type a city name or zip code in the **Weather Location** field, and press Enter or click away. The location is geocoded automatically. No API key needed.

### Spotify (Now Playing tile)

> **REQUIRED:** The Now Playing tile will display `SPOTIFY OFFLINE` until you complete this section. Bento does not ship with Spotify credentials. **You must register your own OAuth App.** No exceptions, no workarounds.

Bento uses PKCE, so you only need a Client ID. No Client Secret to manage or keep safe. The whole thing takes about 60 seconds.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and click **Create app**
2. App name: anything (`Bento` is fine). Description: anything.
3. Under **Redirect URIs**, add `bento://callback` exactly, then click **Add**
4. Check the **Web API** box, agree to the terms, click **Save**
5. On the app detail page, copy the **Client ID** from **Basic Information**
6. In Bento: **Settings > SPOTIFY > paste your Client ID > SAVE**, then click **CONNECT SPOTIFY**

> **Note:** Spotify's free developer tier caps at 25 unique authorized users. Above that you would need to submit a Quota Extension request. Personal or small-circle use stays well under the cap.

### Calendar: iCloud (Next Event tile)
No developer account needed. iCloud Calendar is currently macOS only.

1. Go to [appleid.apple.com](https://appleid.apple.com) and navigate to **Sign-In and Security > App-Specific Passwords**
2. Generate a new password
3. In Bento: **Settings > Calendar > iCloud** and enter your Apple ID and the app-specific password

### Calendar: Google (Next Event tile)
Works on both macOS and Windows.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project
2. Navigate to **APIs & Services > Library** and enable the **Google Calendar API**
3. Go to **Credentials > Create Credentials > OAuth 2.0 Client ID** and choose **Desktop app**
4. Add `http://127.0.0.1:8899/callback` to **Authorized Redirect URIs**
5. Copy your **Client ID** and **Client Secret** into `electron/google-calendar-config.js`
6. In Bento: **Settings > Calendar > Google > Connect Google**

### GitHub Heatmap

> **REQUIRED:** The GitHub Activity tile will be empty until you complete this section. Bento does not ship with GitHub credentials. **You must register your own OAuth App.** No exceptions, no workarounds.

Bento uses GitHub's OAuth Device Flow. You sign in through your browser exactly like any other website login. No tokens to copy or paste. The whole thing takes about 60 seconds.

1. Go to [github.com/settings/applications/new](https://github.com/settings/applications/new)
2. Application name: anything (`Bento` is fine)
3. Homepage URL: `https://github.com/Popespice/glitch-bento-box` (or anything)
4. Authorization callback URL: `http://localhost` (required field but never actually used by Device Flow)
5. **Check the "Enable Device Flow" box before saving.** This is the critical step.
6. Click **Register application**
7. Copy the **Client ID** (you do not need to generate a client secret)
8. In Bento: **Settings > GITHUB > paste your Client ID > SAVE**, then click **SIGN IN WITH GITHUB**

Your browser opens to `github.com/login/device` with a code pre-filled. Click Authorize and Bento picks up the access token automatically.

> **Tip:** Only commits authored with an email registered to your GitHub account appear in the heatmap. If your graph looks sparse, verify your git email with `git config --global user.email`.

**Alternative: GitHub CLI fallback.** If you have already authenticated the [GitHub CLI](https://cli.github.com) with `gh auth login`, Bento can auto-detect that token and use it for the heatmap without any OAuth App registration.

---

## Building from source

### Requirements

**All platforms:**
- Node.js 18 or later and npm

**macOS only:**
- Xcode Command Line Tools (`xcode-select --install`) for the Bluetooth toggle helper

**Windows only:**
- Windows 10 or 11, x64
- NVIDIA GPU for GPU load and power-draw stats (optional; tiles show 0 without one)

### Setup

```bash
git clone https://github.com/Popespice/glitch-bento-box.git
cd glitch-bento-box
npm install
cp electron/google-calendar-config.example.js electron/google-calendar-config.js
```

Fill in `google-calendar-config.js` if you plan to use Google Calendar. GitHub and Spotify credentials are configured at runtime through the in-app Settings panel and do not require any config file edits.

### Dev mode

```bash
npm run dev
```

Opens Electron with hot-reload. The UI is also available at `http://localhost:5173` in a browser with mock data and no live system calls.

### Production build

```bash
npm run dist:mac   # macOS only: outputs release/*.dmg (arm64 + x64)
npm run dist:win   # Windows only: outputs release/*.exe (NSIS installer)
npm run dist       # both
```

Output lands in `release/`. The first build downloads approximately 200 MB of Electron binaries. Subsequent builds use the cache.

---

## Quick Settings details

### Wi-Fi toggle

**macOS:** Requires admin privileges. macOS shows an authentication dialog on each toggle. To skip the prompt permanently, add a sudoers rule:

```
%admin ALL=(ALL) NOPASSWD: /usr/sbin/networksetup -setairportpower *
```

**Windows:** Uses `netsh interface set interface` under the hood. A UAC elevation prompt appears on each toggle.

### Bluetooth toggle

**macOS:** On first use, Bento compiles a small Swift helper into your app data directory. This takes about 5 seconds once and is then cached. macOS prompts for Bluetooth permission the first time; click **Allow**.

If `swiftc` is not available (Xcode CLT not installed), the toggle is disabled and the tile shows **UNAVAIL**.

**Windows:** Uses PowerShell's `Get-PnpDevice`, `Enable-PnpDevice`, and `Disable-PnpDevice`. A UAC elevation prompt appears on each toggle.

### Caffeinate
Prevents the display from sleeping while enabled. Works on both platforms using Electron's built-in power management. The sleep block is removed automatically when Bento quits.

### Focus modes (macOS only)
The four focus buttons fire macOS Shortcuts by name. In **Shortcuts.app**, create shortcuts using the **Set Focus** action with these exact names:

- `Do Not Disturb`
- `Work`
- `Personal`
- `Sleep`

Only create the ones you need. Missing shortcuts are silently skipped. If no shortcuts are configured at all, a **SETUP SHORTCUTS** hint appears in the tile. Focus modes are not available on Windows.

---

## Permissions

### macOS

| Feature | What macOS asks for |
|---|---|
| Bluetooth toggle | Bluetooth permission (one-time dialog) |
| Wi-Fi toggle | Admin authentication (each toggle, or configure sudoers to skip) |
| Focus modes | None (Shortcuts.app handles its own permissions) |
| Caffeinate | None |
| Calendar (iCloud) | None (credentials stored locally) |
| Calendar (Google) | Google OAuth in a browser window |
| Spotify | Spotify OAuth in a browser window |
| GitHub | GitHub OAuth Device Flow in a browser window |

### Windows

| Feature | What Windows asks for |
|---|---|
| Bluetooth toggle | UAC elevation (each toggle) |
| Wi-Fi toggle | UAC elevation (each toggle) |
| Focus modes | Not available |
| Caffeinate | None |
| Calendar (iCloud) | Not available |
| Calendar (Google) | Google OAuth in a browser window |
| Spotify | Spotify OAuth in a browser window |
| GitHub | GitHub OAuth Device Flow in a browser window |

---

## Project structure

```
electron/
  main.js                          # IPC handlers, system calls, OAuth flows
  preload.js                       # Context bridge that exposes window.bento
  google-calendar-config.js        # gitignored, your Google credentials
  google-calendar-config.example.js
src/
  components/                      # One file per tile and shared components
  lib/
    sys.js                         # Thin wrapper: real IPC in Electron, mocks in browser
    usePolling.js                  # Visibility-aware polling hook
    useSettingsChanged.js          # Hook for reacting to settings changes
    formatters.js                  # Shared time/speed formatting utilities
  styles.css
```

---

## License

MIT
