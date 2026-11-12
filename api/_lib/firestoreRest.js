// Firestore through its plain web (REST) API, for the Console's Reports
// list (admin.js). Not firebase-admin/firestore: that pulls in a large
// library this one read doesn't need (and firebase-admin/auth already
// crashed every /api function once, see firebaseAdmin.js). Uses the same
// FIREBASE_SERVICE_ACCOUNT_KEY, swapped for a 1-hour Google access token.
import crypto from 'node:crypto'

const PROJECT = 'gayz-aa69c'
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`

let cached = { token: null, until: 0 }

async function accessToken() {
  if (cached.token && Date.now() < cached.until) return cached.token
  const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
  const now = Math.floor(Date.now() / 1000)
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`
  const jwt = `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), key.private_key).toString('base64url')}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) throw new Error(`token ${res.status}`)
  cached = { token: data.access_token, until: Date.now() + 50 * 60 * 1000 }
  return cached.token
}

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`firestore ${res.status} ${data?.[0]?.error?.message || data?.error?.message || ''}`.trim())
  return data
}

const str = (f) => f?.stringValue || ''
const int = (f) => Number(f?.integerValue ?? f?.doubleValue ?? 0)

// Every report on a shared map or community build (both live in a
// `reports` sub-collection, one doc per reporter), grouped per map/build:
// [{ kind: 'map'|'build', id, name, by, count, latest }].
export async function reports() {
  const rows = await call(':runQuery', { structuredQuery: { from: [{ collectionId: 'reports', allDescendants: true }], limit: 500 } })
  const groups = new Map()
  for (const r of rows || []) {
    const name = r.document?.name
    if (!name) continue
    const m = name.match(/\/documents\/(sharedMaps|communityBuilds)\/([^/]+)\/reports\//)
    if (!m) continue
    const parent = name.slice(0, name.indexOf('/reports/'))
    const g = groups.get(parent) || { kind: m[1] === 'sharedMaps' ? 'map' : 'build', id: m[2], parent, name: '', by: '', count: 0, latest: 0 }
    g.count++
    g.latest = Math.max(g.latest, int(r.document.fields?.reportedAt))
    groups.set(parent, g)
  }
  if (groups.size) {
    const got = await call(':batchGet', { documents: [...groups.keys()], mask: { fieldPaths: ['name', 'creatorNickname'] } })
    for (const d of got || []) {
      const g = d.found && groups.get(d.found.name)
      if (g) {
        g.name = str(d.found.fields?.name)
        g.by = str(d.found.fields?.creatorNickname)
      }
    }
  }
  return [...groups.values()].map((g) => {
    const out = { ...g }
    delete out.parent
    return out
  })
}
