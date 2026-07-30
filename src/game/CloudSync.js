// Cloud Save - Google Sign-In + Drive appDataFolder, no backend needed.
//
// Google Identity Services (loaded via <script> in index.html's <head>)
// issues an access token directly in the browser for the scopes below,
// using only a public OAuth Client ID - this flow has no client secret at
// all, so there is nothing sensitive to protect server-side. The access
// token is then used to read/write a single JSON file in the user's
// hidden, per-app "appDataFolder" on their own Google Drive - a small
// per-user key/value store Google already provides for free, so this
// project doesn't need its own database either.
//
// SETUP (one-time, done by the project owner, not by players):
// 1. https://console.cloud.google.com/ -> new project (or reuse one).
// 2. "APIs & Services" -> "Library" -> enable the "Google Drive API".
// 3. "APIs & Services" -> "OAuth consent screen" -> configure it (External,
//    app name "GayZ", your email) -> add the `drive.appdata` scope.
// 4. "APIs & Services" -> "Credentials" -> "Create Credentials" ->
//    "OAuth client ID" -> Application type "Web application".
//    "Authorized JavaScript origins": add https://gayz.vercel.app (and
//    http://localhost:<port> for local testing). No redirect URI needed.
// 5. Copy the Client ID (looks like `123-abc.apps.googleusercontent.com`)
//    and paste it as GOOGLE_CLIENT_ID below. It is NOT a secret - this is
//    the one piece of Google config that is meant to be public/client-side.
export const GOOGLE_CLIENT_ID = 'REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com'

const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata'
const SAVE_FILE_NAME = 'gayz-cloud-save.json'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

let tokenClient = null
let accessToken = null
let tokenExpiresAt = 0

export function isConfigured() {
  return !GOOGLE_CLIENT_ID.startsWith('REPLACE_WITH_')
}

function ensureTokenClient() {
  if (tokenClient) return tokenClient
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    throw new Error('google-identity-not-loaded')
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  })
  return tokenClient
}

// prompt: '' attempts a silent reuse of an already-granted session (no UI);
// 'consent' always shows the Google account/consent picker. Both resolve
// with the access token string, or reject on error/dismissal.
function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    const client = ensureTokenClient()
    client.callback = (resp) => {
      if (resp && resp.error) {
        reject(new Error(resp.error))
        return
      }
      accessToken = resp.access_token
      tokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000
      resolve(accessToken)
    }
    client.error_callback = (err) => reject(new Error(err?.type || 'popup_closed'))
    client.requestAccessToken({ prompt })
  })
}

// Reuses the current in-memory token if it still has >60s left, otherwise
// silently requests a new one - callers should catch a rejection here as
// "the user needs to sign in again" (the token client can't silently
// re-auth across a full page reload since nothing is persisted to disk).
export async function getValidToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken
  return requestToken('')
}

export async function signIn() {
  const token = await requestToken('consent')
  const profile = await fetchProfile(token)
  return { token, profile }
}

export function signOut() {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {})
  }
  accessToken = null
  tokenExpiresAt = 0
}

async function fetchProfile(token) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('userinfo-failed')
  return res.json()
}

// Looks up the save file's id inside appDataFolder (there should only ever
// be one - see pushCloudSave, which updates it in place rather than
// creating duplicates). Returns null if the player has never synced before.
async function findSaveFile(token) {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${SAVE_FILE_NAME}' and trashed=false`,
    fields: 'files(id,modifiedTime)',
  })
  const res = await fetch(`${DRIVE_FILES_URL}?${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('drive-list-failed')
  const data = await res.json()
  return data.files && data.files.length > 0 ? data.files[0] : null
}

// Returns { data, modifiedTime } or null if no cloud save exists yet.
// `data` is the raw parsed JSON - same shape _exportSave() already
// produces (a flat { localStorageKey: stringValue } map) - untrusted the
// same way an imported save file is (see CLAUDE.md's Import Save note),
// so callers must run it through the same sanitized-import path.
export async function fetchCloudSave(token) {
  const file = await findSaveFile(token)
  if (!file) return null
  const res = await fetch(`${DRIVE_FILES_URL}/${file.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('drive-download-failed')
  const data = await res.json()
  return { data, modifiedTime: file.modifiedTime }
}

// Creates the save file on first sync, updates it in place afterward -
// never leaves more than one file in appDataFolder.
export async function pushCloudSave(token, dataObj) {
  const existing = await findSaveFile(token)
  const body = JSON.stringify(dataObj)
  if (existing) {
    const res = await fetch(`${DRIVE_UPLOAD_URL}/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) throw new Error('drive-update-failed')
  } else {
    const metadata = { name: SAVE_FILE_NAME, parents: ['appDataFolder'] }
    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
    form.append('file', new Blob([body], { type: 'application/json' }))
    const res = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!res.ok) throw new Error('drive-create-failed')
  }
}
