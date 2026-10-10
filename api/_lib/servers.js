// Servers (2026-10-10, Gaymi: "do the same like Kirka, make Global have
// servers too"): rooms of up to MAX_PLAYERS that play Map 1 together.
// These are the rules every /api/servers/* function runs, written against
// a tiny database interface (`db.get(path)`, `db.update(paths)`) so the
// tests can run the very same code on an in-memory copy
// (tests/servers.spec.js); the real functions hand them Firebase Realtime
// Database through firebase-admin (dbAdapter in firebaseAdmin.js).
//
// Layout in the database:
//   servers/{id}      { name, mode, host, createdAt, wave, zombies,
//                       players: { pid: { nick, x, y, z, yaw, weapon,
//                                         firing, dead, t, hurt, credits } },
//                       hits: { key: { id, dmg, by } } }
//   serverSecrets/{id}/{pid}  the player's token (never sent to others)
//   serverSkins/{id}/{pid}    the player's skin picture (sent once on ask)
//
// A player is a public id (seen by everyone, keys their avatar) plus a
// secret token only they hold - every write needs both, so knowing
// someone's id isn't enough to move them or speak for them.
//
// The host (whoever made the server, or whoever takes over when they
// leave or go quiet) runs the zombies for everyone: their sync sends the
// zombie list and wave, and collects the hits other players' shots
// landed. Zombie bites on another player and the kills another player's
// shots finished are queued on that player and handed over (and cleared)
// on their next sync.
import { randomUUID, randomInt } from 'node:crypto'

export const MAX_PLAYERS = 8
// No sync for this long = gone (closed the tab, lost connection).
export const STALE_MS = 10000
// A new player has this long to load Map 1 before their first sync
// (opening the map can take several seconds on a slow computer).
export const JOIN_GRACE_MS = 30000
export const MODES = ['main']
const NAME_MAX = 24
const NICK_MAX = 20
const MAX_ZOMBIES = 40
const MAX_HITS_PER_SYNC = 40
const MAX_SKIN_LENGTH = 50000
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export class ServerError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

function newId(len) {
  let id = ''
  for (let i = 0; i < len; i++) id += ID_CHARS[randomInt(ID_CHARS.length)]
  return id
}

// Plain text only, trimmed and capped.
function cleanText(v, max) {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max)
}

function num(v, lo, hi) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(lo, Math.min(hi, n))
}

function validId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9]{4,40}$/.test(v)
}

function skinOf(v) {
  return typeof v === 'string' && v.startsWith('data:image/') && v.length <= MAX_SKIN_LENGTH ? v : null
}

function livePlayers(server, now) {
  return Object.entries(server?.players || {}).filter(([, p]) => p && now - (p.t || 0) < STALE_MS)
}

export function summary(id, server, now) {
  const live = livePlayers(server, now)
  return {
    id,
    name: server.name,
    mode: server.mode,
    players: live.length,
    max: MAX_PLAYERS,
    wave: server.wave || 0,
    createdAt: server.createdAt || 0,
  }
}

// Every server with someone still in it. Empty ones are deleted on the way.
export async function listServers(db, now = Date.now()) {
  const all = (await db.get('servers')) || {}
  const out = []
  const gone = {}
  for (const [id, server] of Object.entries(all)) {
    if (!server || !livePlayers(server, now).length) {
      gone[`servers/${id}`] = null
      gone[`serverSecrets/${id}`] = null
      gone[`serverSkins/${id}`] = null
      continue
    }
    out.push(summary(id, server, now))
  }
  if (Object.keys(gone).length) await db.update(gone)
  out.sort((a, b) => b.players - a.players || b.createdAt - a.createdAt)
  return out
}

function newPlayer(nickname, now) {
  return { nick: cleanText(nickname, NICK_MAX) || 'Survivor', x: 0, y: 0, z: 0, yaw: 0, weapon: '', firing: false, dead: false, away: false, t: now + JOIN_GRACE_MS - STALE_MS }
}

export async function createServer(db, { name, mode, nickname, skin } = {}, now = Date.now()) {
  const m = MODES.includes(mode) ? mode : 'main'
  const id = newId(6)
  const pid = newId(10)
  const token = randomUUID().replace(/-/g, '')
  const updates = {
    [`servers/${id}`]: {
      name: cleanText(name, NAME_MAX) || `${cleanText(nickname, NICK_MAX) || 'Survivor'}'s server`,
      mode: m,
      host: pid,
      createdAt: now,
      wave: 0,
      players: { [pid]: newPlayer(nickname, now) },
    },
    [`serverSecrets/${id}/${pid}`]: token,
  }
  const s = skinOf(skin)
  if (s) updates[`serverSkins/${id}/${pid}`] = s
  await db.update(updates)
  return { serverId: id, playerId: pid, token, host: pid }
}

export async function joinServer(db, { serverId, nickname, skin } = {}, now = Date.now()) {
  if (!validId(serverId)) throw new ServerError(400, 'bad-request')
  const server = await db.get(`servers/${serverId}`)
  if (!server) throw new ServerError(404, 'gone')
  const live = livePlayers(server, now)
  if (!live.length) throw new ServerError(404, 'gone')
  if (live.length >= MAX_PLAYERS) throw new ServerError(409, 'full')
  const pid = newId(10)
  const token = randomUUID().replace(/-/g, '')
  const updates = {
    [`servers/${serverId}/players/${pid}`]: newPlayer(nickname, now),
    [`serverSecrets/${serverId}/${pid}`]: token,
  }
  // A host that went quiet hands over to whoever is still here.
  const hostLive = live.some(([p]) => p === server.host)
  if (!hostLive) updates[`servers/${serverId}/host`] = live[0][0]
  const s = skinOf(skin)
  if (s) updates[`serverSkins/${serverId}/${pid}`] = s
  await db.update(updates)
  return { serverId, playerId: pid, token, host: hostLive ? server.host : live[0][0], name: server.name, mode: server.mode }
}

async function checkToken(db, serverId, playerId, token) {
  if (!validId(serverId) || !validId(playerId) || typeof token !== 'string') throw new ServerError(400, 'bad-request')
  const real = await db.get(`serverSecrets/${serverId}/${playerId}`)
  if (!real || real !== token) throw new ServerError(403, 'not-in-server')
}

export async function leaveServer(db, { serverId, playerId, token } = {}, now = Date.now()) {
  await checkToken(db, serverId, playerId, token)
  const server = await db.get(`servers/${serverId}`)
  const updates = {
    [`servers/${serverId}/players/${playerId}`]: null,
    [`serverSecrets/${serverId}/${playerId}`]: null,
    [`serverSkins/${serverId}/${playerId}`]: null,
  }
  const others = livePlayers(server, now).filter(([p]) => p !== playerId)
  if (!others.length) {
    updates[`servers/${serverId}`] = null
    updates[`serverSecrets/${serverId}`] = null
    updates[`serverSkins/${serverId}`] = null
    delete updates[`servers/${serverId}/players/${playerId}`]
    delete updates[`serverSecrets/${serverId}/${playerId}`]
    delete updates[`serverSkins/${serverId}/${playerId}`]
  } else if (server?.host === playerId) {
    updates[`servers/${serverId}/host`] = others[0][0]
  }
  await db.update(updates)
  return { ok: true }
}

function cleanZombie(z) {
  if (!z || typeof z !== 'object') return null
  return {
    x: num(z.x, -1000, 1000),
    y: num(z.y, -100, 300),
    z: num(z.z, -1000, 1000),
    r: num(z.r, -10, 10),
    hp: num(z.hp, 0, 1e6),
    max: num(z.max, 1, 1e6),
    boss: !!z.boss,
  }
}

// One round trip a few times a second: write my state, read everyone
// else's. See the header comment for the host's extra job.
export async function syncServer(db, body = {}, now = Date.now()) {
  const { serverId, playerId, token } = body
  await checkToken(db, serverId, playerId, token)
  const server = await db.get(`servers/${serverId}`)
  if (!server) throw new ServerError(404, 'gone')
  const me = server.players?.[playerId]
  if (!me) throw new ServerError(403, 'not-in-server')
  const base = `servers/${serverId}`
  const s = body.state || {}
  const updates = {
    [`${base}/players/${playerId}/x`]: num(s.x, -1000, 1000),
    [`${base}/players/${playerId}/y`]: num(s.y, -100, 300),
    [`${base}/players/${playerId}/z`]: num(s.z, -1000, 1000),
    [`${base}/players/${playerId}/yaw`]: num(s.yaw, -100, 100),
    [`${base}/players/${playerId}/weapon`]: cleanText(s.weapon, 20),
    [`${base}/players/${playerId}/firing`]: !!s.firing,
    [`${base}/players/${playerId}/dead`]: !!s.dead,
    [`${base}/players/${playerId}/away`]: !!s.away,
    [`${base}/players/${playerId}/t`]: now,
  }
  // Drop players who went quiet; take over as host if the host did.
  const live = new Set(livePlayers(server, now).map(([p]) => p))
  live.add(playerId)
  for (const pid of Object.keys(server.players || {})) {
    if (live.has(pid)) continue
    updates[`${base}/players/${pid}`] = null
    updates[`serverSecrets/${serverId}/${pid}`] = null
    updates[`serverSkins/${serverId}/${pid}`] = null
  }
  // A host whose tab is hidden runs nothing (hidden tabs don't draw), so
  // anyone who is actually playing takes the zombies over.
  let host = server.host
  if (!live.has(host) || (host !== playerId && server.players?.[host]?.away && !s.away)) {
    host = playerId
    updates[`${base}/host`] = host
  }
  const isHost = host === playerId
  const out = { host, isHost, wave: server.wave || 0, players: {}, zombies: {}, hurt: [], credits: [], hits: [] }

  if (isHost) {
    // The zombies and the wave, straight from the host's game.
    if (body.zombies && typeof body.zombies === 'object') {
      const zs = {}
      for (const [id, z] of Object.entries(body.zombies).slice(0, MAX_ZOMBIES)) {
        if (!/^z\d{1,9}$/.test(id)) continue
        const c = cleanZombie(z)
        if (c) zs[id] = c
      }
      updates[`${base}/zombies`] = zs
      out.zombies = zs
    }
    if (body.wave !== undefined) {
      updates[`${base}/wave`] = Math.round(num(body.wave, 0, 9999))
      out.wave = updates[`${base}/wave`]
    }
    // Hits other players landed, handed over once.
    for (const [key, h] of Object.entries(server.hits || {})) {
      out.hits.push(h)
      updates[`${base}/hits/${key}`] = null
    }
    // Bites on other players and kills they finished.
    for (const h of [].concat(body.hurt || []).slice(0, 40)) {
      if (!h || !live.has(h.to) || h.to === playerId) continue
      updates[`${base}/players/${h.to}/hurt/${newId(8)}`] = num(h.amount, 0, 1000)
    }
    for (const c of [].concat(body.credits || []).slice(0, 40)) {
      if (!c || !live.has(c.to) || c.to === playerId) continue
      updates[`${base}/players/${c.to}/credits/${newId(8)}`] = { boss: !!c.boss }
    }
  } else {
    out.zombies = server.zombies || {}
    for (const h of [].concat(body.hits || []).slice(0, MAX_HITS_PER_SYNC)) {
      if (!h || !/^z\d{1,9}$/.test(h.id)) continue
      updates[`${base}/hits/${newId(8)}`] = { id: h.id, dmg: num(h.dmg, 0, 5000), by: playerId }
    }
  }
  // What was queued for me.
  for (const [key, amount] of Object.entries(me.hurt || {})) {
    out.hurt.push(Number(amount) || 0)
    updates[`${base}/players/${playerId}/hurt/${key}`] = null
  }
  for (const [key, c] of Object.entries(me.credits || {})) {
    out.credits.push({ boss: !!c?.boss })
    updates[`${base}/players/${playerId}/credits/${key}`] = null
  }
  for (const [pid, p] of Object.entries(server.players || {})) {
    if (pid === playerId || !live.has(pid) || !p) continue
    out.players[pid] = { nick: p.nick, x: p.x, y: p.y, z: p.z, yaw: p.yaw, weapon: p.weapon, firing: !!p.firing, dead: !!p.dead }
  }
  // Skins only for the players asked about (each is a few KB).
  if (Array.isArray(body.skinsFor) && body.skinsFor.length) {
    out.skins = {}
    for (const pid of body.skinsFor.slice(0, MAX_PLAYERS)) {
      if (!validId(pid)) continue
      out.skins[pid] = (await db.get(`serverSkins/${serverId}/${pid}`)) || null
    }
  }
  await db.update(updates)
  return out
}
