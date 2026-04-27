# glitch-bento-box

A pixel-art developer dashboard built with Electron + React. Dot-matrix displays, live system stats, calendar countdown, Spotify now-playing, and functional quick-settings toggles — all in a single always-on-top window.

---

## What's in the box

| Tile | What it shows |
|---|---|
| **Clock** | Current time in dot-matrix |
| **Weather** | Temperature, condition, wind — OpenWeatherMap |
| **GitHub Heatmap** | Contribution grid for any username |
| **System Pulse** | CPU, GPU, RAM, disk — live dot-matrix bar charts |
| **Network** | Download/upload rates, Wi-Fi SSID, signal |
| **Battery** | Charge level and charging state |
| **Now Playing** | Spotify track, artist, live progress bar |
| **Next Event** | Countdown to next calendar event (iCloud or Google) |
| **Quick Settings** | Wi-Fi, Bluetooth, Caffeinate, Focus mode toggles |

---

## Requirements

- **macOS** (primary target — some features are macOS-only)
- **Node.js 18+** and **npm**
- **Xcode Command Line Tools** — required for the Bluetooth helper (`xcode-select --install`)

Optional, depending on which tiles you use:

- **`gh` CLI** — GitHub heatmap auto-detects the logged-in user (`brew install gh`)
- Spotify developer credentials (for Now Playing)
- Google Cloud project credentials (for Google Calendar)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Popespice/glitch-bento-box.git
cd glitch-bento-box
npm install
```

### 2. Copy the config files

Two files need to exist before the app will start. Copy the examples and fill them in:

```bash
cp electron/spotify-config.example.js    electron/spotify-config.js
cp electron/google-calendar-config.example.js electron/google-calendar-config.js
```

If you're not using Spotify or Google Calendar you can leave the placeholder strings — those tiles simply stay disconnected.

### 3. Spotify (Now Playing tile)

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → Create App
2. Add `bento://callback` to **Redirect URIs**
3. Copy **Client ID** and **Client Secret** into `electron/spotify-config.js`
4. In the app: **Settings → Spotify → Connect Spotify**

### 4. Google Calendar (Next Event tile — optional)

Only needed if you prefer Google Calendar over iCloud.

1. [console.cloud.google.com](https://console.cloud.google.com) → New Project
2. **APIs & Services → Library** → enable **Google Calendar API**
3. **Credentials → Create Credentials → OAuth 2.0 Client ID → Desktop app**
4. Add `http://127.0.0.1:8899/callback` to **Authorized Redirect URIs**
5. Copy **Client ID** and **Client Secret** into `electron/google-calendar-config.js`
6. In the app: **Settings → Calendar → Google → Connect Google**

### 5. iCloud Calendar (Next Event tile — optional)

No developer account needed.

1. Generate an **app-specific password** at [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
2. In the app: **Settings → Calendar → iCloud** → enter Apple ID + app-specific password

### 6. Weather

In the app: **Settings → Weather Location** → type a city name or zip code. The location is geocoded via Open-Meteo (no API key needed).

### 7. GitHub Heatmap

The heatmap pulls your contribution data from the GitHub GraphQL API. Two ways to authenticate:

**Option A — in-app OAuth (recommended):**

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**
2. Set **Authorization callback URL** to `bento://github-callback`
3. Copy `electron/github-config.example.js` → `electron/github-config.js` and fill in Client ID + Secret
4. In the app: **Settings → GitHub → Connect GitHub**

**Option B — `gh` CLI fallback (no config needed):**

If `github-config.js` has placeholder values, the app falls back to the `gh` CLI token automatically. Install `gh`, run `gh auth login`, then enter your username in **Settings → GitHub** (or leave blank to auto-detect).

> **Commit email matters.** Only commits authored with an email registered to your GitHub account appear in the contribution graph. Set it with:
> ```bash
> git config --global user.email "your-github-email@example.com"
> # or use your GitHub noreply address:
> git config --global user.email "ID+username@users.noreply.github.com"
> ```

---

## Running

### Dev mode

```bash
npm run dev
```

Opens Electron with hot-reload. The UI is also visible at `http://localhost:5173` in a browser (mock data only — no system calls).

### Production build

```bash
npm run dist:mac   # → release/*.dmg  (arm64 + x64)
npm run dist:win   # → release/*.exe  (NSIS installer)
npm run dist       # both
```

A first run downloads ~200 MB of Electron binaries from GitHub; subsequent builds reuse the cache. Output lands in `release/`:

```
release/
  Bento-0.0.1-arm64.dmg     # Apple Silicon
  Bento-0.0.1.dmg           # Intel
  mac-arm64/Bento.app       # unpacked .app for direct testing
  mac/Bento.app
```

**First launch on macOS.** The DMGs are signed with a local ad-hoc identity, not notarized. Gatekeeper will block the first launch — right-click the app and choose **Open**, then confirm in the dialog. After the first run macOS remembers the choice.

**Native Bluetooth permission.** When the user toggles Bluetooth for the first time, the app compiles `bt-helper.app` into the user-data directory and macOS prompts for Bluetooth access (see [Bluetooth toggle](#bluetooth-toggle) below).

**Notarization (optional).** To distribute publicly without the right-click-to-open step, sign and notarize with an Apple Developer ID by setting `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` in your environment before running `npm run dist:mac`. See the [electron-builder docs](https://www.electron.build/code-signing) for details.

---

## Quick Settings tile

### Wi-Fi toggle

Toggling Wi-Fi requires admin privileges. macOS will show a standard authentication dialog on each toggle. To skip the prompt, add a sudoers rule:

```
%admin ALL=(ALL) NOPASSWD: /usr/sbin/networksetup -setairportpower *
```

### Bluetooth toggle

On first use, the app compiles a tiny Swift helper (`bt-helper.app`) in your app's user-data directory using Xcode CLT. This takes ~5 seconds once and is then cached. macOS will prompt for Bluetooth permission the first time — click **Allow**.

If `swiftc` isn't available, Bluetooth status falls back to read-only (`system_profiler`) and the toggle is disabled.

### Caffeinate

Prevents the display from sleeping while enabled. The process is automatically killed when the app quits.

### Focus modes

The four focus buttons (DND, WRK, PER, SLP) fire macOS Shortcuts by name. Create four shortcuts in **Shortcuts.app** — one for each mode you want — with the **Set Focus** action, named exactly:

- `Do Not Disturb`
- `Work`
- `Personal`
- `Sleep`

If a shortcut doesn't exist yet, a **SETUP SHORTCUTS ↗** hint appears in the tile that opens Shortcuts.app.

---

## Permissions summary

| Feature | What macOS asks for |
|---|---|
| Bluetooth toggle | Bluetooth permission (one-time dialog) |
| Wi-Fi toggle | Admin authentication (each toggle, or configure sudoers) |
| Focus modes | None — Shortcuts handles its own permissions |
| Caffeinate | None |
| Calendar (iCloud) | None — credentials stored locally |
| Calendar (Google) | Google OAuth in a browser window |
| Spotify | Spotify OAuth in a browser window |

---

## Project structure

```
electron/
  main.js                        # IPC handlers, system calls, OAuth flows
  preload.js                     # Context bridge — exposes window.bento
  spotify-config.js              # gitignored — your Spotify credentials
  spotify-config.example.js      # committed template
  google-calendar-config.js      # gitignored — your Google credentials
  google-calendar-config.example.js
src/
  components/                    # One file per tile + shared components
  lib/
    sys.js                       # Thin wrapper — real calls in Electron, mocks in browser
    usePolling.js                # Visibility-aware polling hook
  styles.css
```

---

## License

MIT
