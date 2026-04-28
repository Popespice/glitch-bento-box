// GitHub OAuth Device Flow — only the client_id is needed. Unlike
// client_secret, the client_id is a public identifier (it's safe to commit
// to a public repo) since GitHub additionally requires user consent in the
// browser before any token is issued.
//
// To register your own OAuth App instead of using this one:
//   1. https://github.com/settings/applications/new
//   2. Application name: Bento (or whatever you want)
//   3. Homepage URL: https://github.com/Popespice/glitch-bento-box
//   4. Authorization callback URL: http://localhost (required field, never used)
//   5. Check "Enable Device Flow" before clicking Register
//   6. Copy the Client ID below

export const GITHUB_CLIENT_ID = 'Ov23liHX0xJ8DIA780YY'
