// Spotify OAuth uses Authorization Code with PKCE — only the client_id is
// needed (no client_secret), and the client_id is a public identifier (safe
// to commit to the repo). Spotify additionally requires user consent in the
// browser before any token is issued, so a leaked client_id alone is harmless.
//
// To register your own Spotify OAuth App:
//   1. https://developer.spotify.com/dashboard
//   2. Click "Create app"
//   3. Add bento://callback to Redirect URIs (Edit Settings → Redirect URIs → Add)
//   4. Check the Web API box, agree, save
//   5. Copy the Client ID below

export const SPOTIFY_CLIENT_ID = '2589832cc5134b8ea6dd84b122665967'
export const SPOTIFY_REDIRECT_URI = 'bento://callback'
