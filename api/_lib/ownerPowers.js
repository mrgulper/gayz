// Owner powers (2026-11-15, Gaymi: "give bigger and more admin powers",
// picked: teleport + freeze, spawn / clear zombies, give to one player,
// server control - in the game AND from the owner's tools, owner only).
//
// Two doors in, both owner-only:
//   - in the game: a player the server marked `own` or `ghost` (dropped in
//     with the owner's pass, OwnerDropIn.js) sends `oc: [cmd]` with its
//     sync (servers.js syncServer). Nobody else's `oc` is ever read.
//   - the owner's tools: api/admin.js `serverCmd` (ADMIN_SECRET) and
//     `giveTo` (a Player ID, for someone who isn't in a server).
//
// A command becomes plain database writes, handed out on the next syncs:
//   servers/{id}/players/{slot}/oq/{key} { k: 'tp', x, y, z } |
//                  { k: 'give', coins, gems, skins, text } - for that player
//   servers/{id}/players/{slot}/frz  1 = frozen in place until unfrozen
//   servers/{id}/hq/{key} { k: 'horde' | 'boss' | 'clear' | 'sky', ... }
//                  - for whoever runs the zombies and the sky (the host)
//   servers/{id}/ann { n, text } - a big message on everyone's screen
//   servers/{id}/closed  when it was closed: every sync and join is
//                  refused ('closed') and it's off the list
//   playerGifts/{pid}/{id} { coins, gems, skins, text, at } - a gift for a
//                  Player ID, picked up by their page (api/live.js)
import { randomInt } from 'node:crypto'

export const OWNER_TIMES = ['day', 'night']
// Weather the owner can set (BuildSky SKY_WEATHERS ids).
export const OWNER_WEATHERS = ['clear', 'lightRain', 'thunderstorm', 'lightSnow', 'blizzard', 'fog', 'heatwave', 'sandstorm']
export const HORDE_SIZES = [5, 10, 20]
export const GIVE_MAX = { coins: 100000, gems: 1000, skins: 5 }
export const ANN_MAX = 120
// How long an announcement stays up (and is still handed to someone who
// syncs late).
export const ANN_SHOW_MS = 8000
// A host command older than this is dropped (the host changed, say).
const HQ_KEEP_MS = 60000
const GIFTS_KEPT = 20
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export class OwnerError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function newKey() {
  let k = ''
  for (let i = 0; i < 8; i++) k += KEY_CHARS[randomInt(KEY_CHARS.length)]
  return k
}

const validSlot = (v) => typeof v === 'string' && /^[A-Za-z0-9]{4,40}$/.test(v)

function cleanText(v, max) {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max)
}

function num(v, lo, hi) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(lo, Math.min(hi, n))
}

// A spot { x, y, z } or null.
function spotOf(v) {
  if (!v || typeof v !== 'object') return null
  const x = num(v.x, -1e5, 1e5)
  const y = num(v.y, -520, 520)
  const z = num(v.z, -1e5, 1e5)
  return x === null || y === null || z === null ? null : { x, y, z }
}

// What a gift gives, checked: { coins, gems, skins, text } or null.
// skinIds: the skins a gift may hold (admin.js GIFT_SKINS).
export function cleanGift(g, skinIds) {
  if (!g || typeof g !== 'object') return null
  const coins = Math.floor(num(g.coins, 0, GIVE_MAX.coins) || 0)
  const gems = Math.floor(num(g.gems, 0, GIVE_MAX.gems) || 0)
  const skins = [...new Set(Array.isArray(g.skins) ? g.skins : [])].filter((id) => skinIds.has(id)).slice(0, GIVE_MAX.skins)
  if (!coins && !gems && !skins.length) return null
  return { coins, gems, skins, text: cleanText(g.text, 120) }
}

// One owner command for server `serverId` -> the database writes.
// cmd: { k, to?, on?, n?, time?, weather?, text?, coins?, gems?, skins?,
// x?, y?, z? }. The spot (x, y, z) is where the owner is (in the game);
// from the owner's tools there is none, so the host picks a player.
export async function ownerCommand(db, serverId, cmd, { skinIds, now = Date.now() }) {
  if (!validSlot(serverId) || !cmd || typeof cmd !== 'object') throw new OwnerError('bad-request')
  const base = `servers/${serverId}`
  const server = await db.get(base)
  if (!server || server.closed) throw new OwnerError('gone')
  const live = (slot) => validSlot(slot) && server.players?.[slot] && now - (Number(server.players[slot].t) || 0) < 10000
  const spot = spotOf(cmd)
  const updates = {}
  switch (cmd.k) {
    case 'pull': {
      if (!live(cmd.to) || !spot) throw new OwnerError('bad-request')
      updates[`${base}/players/${cmd.to}/oq/${newKey()}`] = { k: 'tp', ...spot }
      break
    }
    case 'freeze': {
      if (!live(cmd.to)) throw new OwnerError('bad-request')
      updates[`${base}/players/${cmd.to}/frz`] = cmd.on === false ? null : 1
      break
    }
    case 'give': {
      if (!live(cmd.to)) throw new OwnerError('bad-request')
      const gift = cleanGift(cmd, skinIds)
      if (!gift) throw new OwnerError('bad-request')
      updates[`${base}/players/${cmd.to}/oq/${newKey()}`] = { k: 'give', ...gift }
      break
    }
    case 'horde': {
      const n = HORDE_SIZES.includes(Number(cmd.n)) ? Number(cmd.n) : HORDE_SIZES[0]
      updates[`${base}/hq/${newKey()}`] = { k: 'horde', n, at: now, ...(spot || {}) }
      break
    }
    case 'boss':
      updates[`${base}/hq/${newKey()}`] = { k: 'boss', at: now, ...(spot || {}) }
      break
    case 'clear':
      updates[`${base}/hq/${newKey()}`] = { k: 'clear', at: now }
      break
    case 'sky': {
      const time = OWNER_TIMES.includes(cmd.time) ? cmd.time : null
      const weather = OWNER_WEATHERS.includes(cmd.weather) ? cmd.weather : null
      if (!time && !weather) throw new OwnerError('bad-request')
      updates[`${base}/hq/${newKey()}`] = { k: 'sky', at: now, ...(time ? { time } : {}), ...(weather ? { weather } : {}) }
      break
    }
    case 'ann': {
      const text = cleanText(cmd.text, ANN_MAX)
      if (!text) throw new OwnerError('bad-request')
      updates[`${base}/ann`] = { n: now, text }
      break
    }
    case 'close':
      updates[`${base}/closed`] = now
      break
    default:
      throw new OwnerError('bad-request')
  }
  await db.update(updates)
  return { ok: true }
}

// What a sync hands out (servers.js): this player's own queue, whether
// they're frozen, the announcement, and (for the host) the host's queue.
// Adds the clearing writes to `updates`.
export function ownerDeliveries(server, base, playerId, isHost, updates, now) {
  const me = server.players?.[playerId] || {}
  const out = { oq: [], frz: me.frz ? 1 : 0, hq: [], ann: null }
  for (const [key, c] of Object.entries(me.oq || {})) {
    if (c && typeof c === 'object') out.oq.push(c)
    updates[`${base}/players/${playerId}/oq/${key}`] = null
  }
  if (isHost) {
    for (const [key, c] of Object.entries(server.hq || {})) {
      if (c && typeof c === 'object' && now - (Number(c.at) || 0) < HQ_KEEP_MS) out.hq.push(c)
      updates[`${base}/hq/${key}`] = null
    }
  }
  const a = server.ann
  if (a && typeof a === 'object' && now - (Number(a.n) || 0) < ANN_SHOW_MS && a.text) out.ann = { n: Number(a.n), text: String(a.text) }
  return out
}

// A gift for a Player ID who may not be in a server (the owner's tools,
// Player card). The newest GIFTS_KEPT wait for them.
export async function giveToPid(db, pid, g, skinIds, now = Date.now()) {
  const gift = cleanGift(g, skinIds)
  if (!validSlot(pid) || !gift) throw new OwnerError('bad-request')
  const all = (await db.get(`playerGifts/${pid}`)) || {}
  const updates = { [`playerGifts/${pid}/${now}${newKey().slice(0, 4)}`]: { ...gift, at: now } }
  const ids = Object.keys(all).sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
  for (const old of ids.slice(0, Math.max(0, ids.length - GIFTS_KEPT + 1))) updates[`playerGifts/${pid}/${old}`] = null
  await db.update(updates)
  return { ok: true }
}

// The gifts waiting for a player (api/live.js publicConfig): [{ id, ... }].
export function waitingGifts(all, skinIds) {
  return Object.entries(all && typeof all === 'object' ? all : {})
    .map(([id, g]) => ({ id, ...cleanGift(g, skinIds) }))
    .filter((g) => g.coins !== undefined && /^[A-Za-z0-9]{4,40}$/.test(g.id))
    .slice(0, 10)
}

// The player's page picks one up: it's taken off the list in one step, so
// it can only be had once.
export async function claimPidGift(db, { pid, id } = {}, skinIds) {
  if (!validSlot(pid) || typeof id !== 'string' || !/^[A-Za-z0-9]{4,40}$/.test(id)) throw new OwnerError('bad-request')
  // (Firebase may first run this on an empty guess and again on the real
  // value, so it never says "leave it" - an empty one stays empty.)
  let got = null
  const res = await db.transaction(`playerGifts/${pid}/${id}`, (g) => {
    got = g || null
    return null
  })
  if (!res.committed || !got) return { error: 'gone' }
  const gift = cleanGift(got, skinIds)
  return gift ? { ok: true, ...gift } : { error: 'gone' }
}
