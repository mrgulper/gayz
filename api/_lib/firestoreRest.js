// Firestore through its plain web (REST) API, for the Console's Reports
// list and Players tools (admin.js). Not firebase-admin/firestore: that pulls in a large
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

async function call(path, body, method = 'POST') {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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

// --- Players (Console "Players" batch) ---

const ACCOUNT_FIELDS = ['nickname', 'playerId', 'bestNight', 'lastActiveAt', 'clanId']

// Signed-in accounts (leaderboard docs) where `field` equals `value`, at
// most 10: [{ uid, nickname, playerId, bestNight, lastActiveAt, clanId }].
async function accountsWhere(field, value) {
  const rows = await call(':runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'leaderboard' }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
      select: { fields: ACCOUNT_FIELDS.map((f) => ({ fieldPath: f })) },
      limit: 10,
    },
  })
  const out = []
  for (const r of rows || []) {
    const d = r.document
    if (!d?.name) continue
    const f = d.fields || {}
    out.push({ uid: d.name.split('/').pop(), nickname: str(f.nickname), playerId: str(f.playerId), bestNight: int(f.bestNight), lastActiveAt: int(f.lastActiveAt), clanId: str(f.clanId) })
  }
  return out
}

export const accountsByPid = (pid) => accountsWhere('playerId', pid)

// A signed-in player's skin picture by Player ID (the Hall of Fame cards):
// only their cloud save's settings line is fetched, and only the skin (and
// nickname) is kept from it. { skin: data URL or '', nickname }.
const SKIN_MAX = 3000000
export async function skinByPid(pid) {
  const [acc] = await accountsByPid(pid)
  if (!acc) return { skin: '', nickname: '', noAccount: true }
  const doc = await call(`/saves/${encodeURIComponent(acc.uid)}?mask.fieldPaths=${encodeURIComponent('data.`gayz-settings`')}`, undefined, 'GET')
  let settings = null
  try { settings = JSON.parse(doc?.fields?.data?.mapValue?.fields?.['gayz-settings']?.stringValue || 'null') } catch { /* not JSON */ }
  const url = settings?.customSkinDataUrl
  const skin = typeof url === 'string' && url.startsWith('data:image/') && url.length <= SKIN_MAX ? url : ''
  return { skin, nickname: acc.nickname || '' }
}
export const accountsByName = (name) => accountsWhere('nickname', name)

// chatMutes/{uid}: Firebase's rules refuse that account's chat messages
// while `until` is 0 (forever) or still ahead (see FIRESTORE_SECURITY_RULES
// in src/game/CloudSync.js).
export async function setChatMute(uid, until, now = Date.now()) {
  await call(`/chatMutes/${encodeURIComponent(uid)}`, { fields: { until: { integerValue: String(Math.max(0, Math.floor(until))) }, at: { integerValue: String(now) } } }, 'PATCH')
}

export async function clearChatMute(uid) {
  await call(`/chatMutes/${encodeURIComponent(uid)}`, undefined, 'DELETE')
}

// --- Live events (Console "Live events" batch) ---

// A staff message into both Global chat rooms (in-game globalChat and the
// homepage's serverChat), same fields a player's message has. The service
// account isn't held to the security rules; the game shows uid STAFF_UID
// as a gold "GayZ Team" line.
export async function postStaffChat(uid, nickname, text, now = Date.now()) {
  const fields = { uid: { stringValue: uid }, nickname: { stringValue: nickname }, text: { stringValue: text }, createdAt: { integerValue: String(now) } }
  await Promise.all(['globalChat', 'serverChat'].map((c) => call(`/${c}`, { fields })))
}

// The Gallery's map posts (at most 80, the same the homepage reads), for
// the Map of the Week picker: [{ id, mapCode, title, by, likes, createdAt }].
export async function galleryMaps() {
  const rows = await call(':runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'gallery' }],
      where: { fieldFilter: { field: { fieldPath: 'kind' }, op: 'EQUAL', value: { stringValue: 'map' } } },
      select: { fields: ['mapCode', 'title', 'creatorNickname', 'likes', 'createdAt'].map((f) => ({ fieldPath: f })) },
      limit: 80,
    },
  })
  const out = []
  for (const r of rows || []) {
    const d = r.document
    if (!d?.name) continue
    const f = d.fields || {}
    out.push({ id: d.name.split('/').pop(), mapCode: str(f.mapCode), title: str(f.title), by: str(f.creatorNickname), likes: int(f.likes), createdAt: int(f.createdAt) })
  }
  return out.sort((a, b) => b.likes - a.likes || b.createdAt - a.createdAt)
}
