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

// Every report on a shared map, community build or GayZ TV clip (each in a
// `reports` sub-collection, one doc per reporter), grouped per item:
// [{ kind: 'map'|'build'|'tv', id, name, by, count, latest }]. TV clips
// also carry creatorUid, clipKind, youtubeId, thumb, hidden (owner-hidden),
// total (the clip's own counter) and reporters (uids).
const TV_THUMB_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/
const KINDS = { sharedMaps: 'map', communityBuilds: 'build', tvClips: 'tv' }
export async function reports() {
  const rows = await call(':runQuery', { structuredQuery: { from: [{ collectionId: 'reports', allDescendants: true }], limit: 500 } })
  const groups = new Map()
  for (const r of rows || []) {
    const name = r.document?.name
    if (!name) continue
    const m = name.match(/\/documents\/(sharedMaps|communityBuilds|tvClips)\/([^/]+)\/reports\/([^/]+)$/)
    if (!m) continue
    const parent = name.slice(0, name.indexOf('/reports/'))
    const g = groups.get(parent) || { kind: KINDS[m[1]], id: m[2], parent, name: '', by: '', count: 0, latest: 0 }
    g.count++
    g.latest = Math.max(g.latest, int(r.document.fields?.reportedAt))
    if (g.kind === 'tv') (g.reporters ||= []).push(m[3])
    groups.set(parent, g)
  }
  if (groups.size) {
    const fieldPaths = ['name', 'title', 'creatorNickname', 'creatorUid', 'kind', 'youtubeId', 'thumb', 'hidden', 'reports']
    const got = await call(':batchGet', { documents: [...groups.keys()], mask: { fieldPaths } })
    for (const d of got || []) {
      const g = d.found && groups.get(d.found.name)
      if (!g) continue
      const f = d.found.fields || {}
      g.by = str(f.creatorNickname)
      if (g.kind !== 'tv') {
        g.name = str(f.name)
        continue
      }
      g.name = str(f.title)
      g.creatorUid = str(f.creatorUid)
      g.clipKind = str(f.kind) === 'gif' ? 'gif' : 'youtube'
      g.youtubeId = /^[A-Za-z0-9_-]{11}$/.test(str(f.youtubeId)) ? str(f.youtubeId) : ''
      g.thumb = TV_THUMB_RE.test(str(f.thumb)) ? str(f.thumb) : ''
      g.hidden = f.hidden?.booleanValue === true
      g.total = int(f.reports)
      g.found = true
    }
  }
  return [...groups.values()]
    // A deleted TV clip can leave its reports behind - not worth listing.
    .filter((g) => g.kind !== 'tv' || g.found)
    .map((g) => {
      const out = { ...g }
      delete out.parent
      delete out.found
      return out
    })
}

// --- GayZ TV (owner's TV reports) ---
const DOCS = `projects/${PROJECT}/databases/(default)/documents`
const enc = (id) => encodeURIComponent(id)
async function commit(writes) {
  if (writes.length) await call(':commit', { writes })
}
// The uids that reported this clip (one doc each).
export async function tvReporters(id) {
  const data = await call(`/tvClips/${enc(id)}/reports?pageSize=300&mask.fieldPaths=reportedAt`, undefined, 'GET')
  return (data?.documents || []).map((d) => d.name.split('/').pop())
}
// Hide or show a clip (the game leaves out `hidden: true` clips).
export async function tvSetHidden(id, hidden) {
  await call(`/tvClips/${enc(id)}?updateMask.fieldPaths=hidden&currentDocument.exists=true`, { fields: { hidden: { booleanValue: !!hidden } } }, 'PATCH')
}
// Clears every report on a clip: report docs gone, counter 0, shown again.
export async function tvClearReports(id, uids) {
  await commit([
    ...uids.map((uid) => ({ delete: `${DOCS}/tvClips/${id}/reports/${uid}` })),
    { update: { name: `${DOCS}/tvClips/${id}`, fields: { reports: { integerValue: '0' }, hidden: { booleanValue: false } } }, updateMask: { fieldPaths: ['reports', 'hidden'] }, currentDocument: { exists: true } },
  ])
}
// Deletes a clip for good: its reports, its GIF and the clip.
export async function tvDeleteClip(id, uids) {
  await commit([
    ...uids.map((uid) => ({ delete: `${DOCS}/tvClips/${id}/reports/${uid}` })),
    { delete: `${DOCS}/tvGifs/${id}` },
    { delete: `${DOCS}/tvClips/${id}` },
  ])
}
// tvBans/{uid} { until (0 = forever), at, nick }: the rules refuse new
// clips from that account while it's there and not over.
export async function tvBanSet(uid, until, nick, now = Date.now()) {
  await call(`/tvBans/${enc(uid)}`, { fields: { until: { integerValue: String(Math.max(0, Math.floor(until))) }, at: { integerValue: String(now) }, nick: { stringValue: String(nick || '').slice(0, 24) } } }, 'PATCH')
}
export async function tvBanClear(uid) {
  await call(`/tvBans/${enc(uid)}`, undefined, 'DELETE')
}
export async function tvBans() {
  const data = await call('/tvBans?pageSize=300', undefined, 'GET')
  return (data?.documents || []).map((d) => ({ uid: d.name.split('/').pop(), until: int(d.fields?.until), at: int(d.fields?.at), nick: str(d.fields?.nick) }))
}
// A signed-in account's Player ID and name (its leaderboard doc).
export async function accountByUid(uid) {
  try {
    const d = await call(`/leaderboard/${enc(uid)}?mask.fieldPaths=playerId&mask.fieldPaths=nickname`, undefined, 'GET')
    return { pid: str(d?.fields?.playerId), nickname: str(d?.fields?.nickname) }
  } catch {
    return { pid: '', nickname: '' }
  }
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

// --- Player ID changes from the Console (2026-11-15, admin.js changeId) ---

// Who owns playerIds/{id}: their uid, or null when nobody claimed it.
export async function playerIdOwner(id) {
  try {
    const doc = await call(`/playerIds/${encodeURIComponent(id)}`, undefined, 'GET')
    return str(doc?.fields?.uid) || 'unknown'
  } catch (err) {
    if (/^firestore 404/.test(String(err?.message))) return null
    throw err
  }
}

// The same claim the Shop makes (CloudSync.claimPlayerId), for this uid.
// Only creates: an ID someone else owns fails with 'taken'.
export async function claimPlayerIdFor(uid, id, now = Date.now()) {
  try {
    await call(`/playerIds?documentId=${encodeURIComponent(id)}`, { fields: { uid: { stringValue: uid }, at: { integerValue: String(now) } } })
  } catch (err) {
    if (!/^firestore 409/.test(String(err?.message))) throw err
    if ((await playerIdOwner(id)) !== uid) throw new Error('taken', { cause: err })
  }
}

// Their leaderboard doc's Player ID, so the leaderboard and the Console
// show the new one at once (their game also sends it next time).
export async function setLeaderboardPid(uid, pid) {
  await call(`/leaderboard/${encodeURIComponent(uid)}?updateMask.fieldPaths=playerId&currentDocument.exists=true`, { fields: { playerId: { stringValue: pid } } }, 'PATCH')
}
