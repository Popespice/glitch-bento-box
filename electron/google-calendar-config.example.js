// Copy this file to `google-calendar-config.js` (which is gitignored) and fill in real values.
//
// 1. Go to https://console.cloud.google.com → New Project
// 2. APIs & Services → Library → enable "Google Calendar API"
// 3. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
//    → Application type: "Desktop app"
// 4. Add `http://127.0.0.1:8899/callback` to Authorized Redirect URIs
// 5. Copy the Client ID and Client Secret here

export const GOOGLE_CLIENT_ID = 'paste-your-client-id-here'
export const GOOGLE_CLIENT_SECRET = 'paste-your-client-secret-here'
export const GOOGLE_REDIRECT_URI = 'http://127.0.0.1:8899/callback'
