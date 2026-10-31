// Servers (2026-10-10, Gaymi: "do the same like Kirka, make Global have
// servers too"): rooms of up to MAX_PLAYERS that play Map 1 together.
// These are the rules every /api/servers/* function runs, written against
// a tiny database interface (`db.get(path)`, `db.update(paths)`) so the
// tests can run the very same code on an in-memory copy
// (tests/servers.spec.js); the real functions hand them Firebase Realtime
// Database through firebase-admin (dbAdapter in firebaseAdmin.js).
//
// Layout in the database:
//   servers/{id}      { name, mode, host, createdAt, wave, zombies, world,
//                       hidden, sky, animals, editSeq,
//                       players: { pid: { nick, x, y, z, yaw, weapon, held,
//                                         firing, dead, t, hurt, credits,
//                                         say } },
//                       hits: { key: { id, dmg, by, tame } },
//                       edits: { "x,y,z": { b, s, by } } }
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
//
// Everyone sees the same world (2026-10-26, Gaymi: "they didn't see the
// same thing I had on my screen, please fix this from the root cause"):
// the host's sky (time of day, weather, rainbow) and animals travel like
// its zombies, and every player's placed and broken blocks go in `edits`
// (one per cell, the latest wins, numbered so each player only gets the
// ones they haven't had yet).
import { randomUUID, randomInt } from 'node:crypto'

export const MAX_PLAYERS = 8
// No sync for this long = gone (closed the tab, lost connection).
export const STALE_MS = 10000
// A new player has this long to load Map 1 before their first sync
// (opening the map, then drawing the weapon picker's 15 gun pictures, can
// take well over 30s on a slow phone or a software-rendered browser -
// 30s dropped joiners there, 2026-10-10).
export const JOIN_GRACE_MS = 90000
export const MODES = ['main']
const NAME_MAX = 24
const NICK_MAX = 20
const MAX_ZOMBIES = 40
const MAX_HITS_PER_SYNC = 40
const MAX_SKIN_LENGTH = 50000
const MAX_ANIMALS = 24
// Placed/broken cells kept per server (the oldest stay, new cells stop
// being shared past this).
export const MAX_EDITS = 4000
const MAX_EDITS_PER_SYNC = 40
const SAY_MAX = 120
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
    // A solo game ready for friends (PlayNet lobby): joined by its link only.
    if (server.hidden) continue
    out.push(summary(id, server, now))
  }
  if (Object.keys(gone).length) await db.update(gone)
  out.sort((a, b) => b.players - a.players || b.createdAt - a.createdAt)
  return out
}

function newPlayer(nickname, now) {
  return { nick: cleanText(nickname, NICK_MAX) || 'Survivor', x: 0, y: 0, z: 0, yaw: 0, weapon: '', held: '', firing: false, dead: false, away: false, t: now + JOIN_GRACE_MS - STALE_MS }
}

// A game made joinable mid-run (Invite Friends, 2026-10-18) brings its
// world along so players joining get the same land and start where the
// host did: the land's seed, whether it's the World Map mode's Earth, and
// the spawn-map place picked ({ lat, lon, biome, country, city }).
function cleanWorld(w) {
  if (!w || typeof w !== 'object') return null
  const out = { seed: Math.floor(num(w.seed, 0, 4294967295)), earth: w.earth === true }
  const p = w.pick
  if (p && typeof p === 'object') {
    out.pick = { lat: num(p.lat, -90, 90), lon: num(p.lon, -180, 180), biome: cleanText(p.biome, 30), country: cleanText(p.country, 60), city: cleanText(p.city, 60) }
  }
  return out
}

// hidden: a solo game made ready for friends the moment it starts (its
// address is the invite link) - left out of the Global list.
export async function createServer(db, { name, mode, nickname, skin, world, id: wanted, hidden } = {}, now = Date.now()) {
  const m = MODES.includes(mode) ? mode : 'main'
  // Invite Friends picks the id itself so its link shows at once; taken or
  // malformed, a new one is made (the reply says which). A server nobody is
  // left in can be opened again under its old id - a dropped player
  // getting back in (PlayNet._rejoin) keeps the same invite link.
  const okWanted = typeof wanted === 'string' && wanted.length === 6 && [...wanted].every((ch) => ID_CHARS.includes(ch)) && !livePlayers(await db.get(`servers/${wanted}`), now).length
  const id = okWanted ? wanted : newId(6)
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
      ...(cleanWorld(world) ? { world: cleanWorld(world) } : {}),
      ...(hidden === true ? { hidden: true } : {}),
    },
    // Whole, so an old server's players and skins under this id go too.
    [`serverSecrets/${id}`]: { [pid]: token },
  }
  const s = skinOf(skin)
  updates[`serverSkins/${id}`] = s ? { [pid]: s } : null
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
  return { serverId, playerId: pid, token, host: hostLive ? server.host : live[0][0], name: server.name, mode: server.mode, world: server.world || null }
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

const SKELETON_KIND_IDS = new Set(['minion', 'rogue', 'warrior', 'mage'])
// A zombie's rarity (ZombieNames.js ZOMBIE_TIERS) - a kill credit carries it
// so the player paid gets that rarity's coins.
const ZOMBIE_TIER_IDS = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'])
// A Golden or Diamond zombie (ZombieNames.js ZOMBIE_SHINES) - pays more.
const ZOMBIE_SHINE_IDS = new Set(['gold', 'diamond'])

// A kill (or assist) credit for another player: { boss, skeleton?, tier?, assist? }.
function cleanCredit(c) {
  return {
    boss: !!c?.boss,
    ...(SKELETON_KIND_IDS.has(c?.skeleton) ? { skeleton: c.skeleton } : {}),
    ...(ZOMBIE_TIER_IDS.has(c?.tier) ? { tier: c.tier } : {}),
    ...(c?.assist ? { assist: true } : {}),
    ...(ZOMBIE_SHINE_IDS.has(c?.shine) ? { shine: c.shine } : {}),
  }
}
// A zombie's kind: a skeleton or a monster (ZombieKinds.js) - plain
// lowercase words, checked against the real lists by the game.
const KIND_RE = /^[a-z]{1,20}$/
// Animal kinds are camelCase ("polarBear") - KIND_RE dropped every one of
// those from the host's animal list, so other players never saw them.
const ANIMAL_RE = /^[a-zA-Z]{1,24}$/
// Block, weapon and item ids.
const ID_RE = /^[a-z0-9_]{1,40}$/
const WEATHER_RE = /^[a-zA-Z]{1,20}$/

function cleanZombie(z) {
  if (!z || typeof z !== 'object') return null
  return {
    x: num(z.x, -1e5, 1e5),
    y: num(z.y, -520, 520),
    z: num(z.z, -1e5, 1e5),
    r: num(z.r, -10, 10),
    hp: num(z.hp, 0, 1e6),
    max: num(z.max, 1, 1e6),
    boss: !!z.boss,
    // A skeleton's or monster's kind; plain zombies have none.
    ...(typeof z.k === 'string' && KIND_RE.test(z.k) ? { k: z.k } : {}),
    // Its rarity and name number (ZombieNames.js), so everyone sees the
    // same "Grumpy Gary".
    ...(typeof z.rt === 'string' && KIND_RE.test(z.rt) ? { rt: z.rt } : {}),
    ...(Number.isInteger(z.nm) && z.nm >= 0 && z.nm < 10000 ? { nm: z.nm } : {}),
    ...(ZOMBIE_SHINE_IDS.has(z.sh) ? { sh: z.sh } : {}),
  }
}

// The host's sky: the day-night clock, the weather showing and where it's
// heading, seconds of rainbow left, and a natural disaster going on - its
// kind, seed, spot and how long it's been going (BuildSky.skyState,
// Disasters.state).
function cleanSky(v) {
  if (!v || typeof v !== 'object') return null
  const kind = (k) => (typeof k === 'string' && WEATHER_RE.test(k) ? k : 'clear')
  const d = v.d && typeof v.d === 'object' && typeof v.d.k === 'string' && WEATHER_RE.test(v.d.k)
    ? { k: v.d.k, s: Math.floor(num(v.d.s, 0, 2 ** 31)), x: num(v.d.x, -1e5, 1e5), z: num(v.d.z, -1e5, 1e5), t: num(v.d.t, 0, 3000) }
    : null
  return { c: num(v.c, 0, 1e7), n: kind(v.n), g: kind(v.g), r: num(v.r, 0, 600), ...(d ? { d } : {}) }
}

// One of the host's animals (PlayAnimals.snapshot): kind, spot, heading,
// health, who tamed it ('' wild, 'h' the host, or a player id), dying.
function cleanAnimal(a) {
  if (!a || typeof a !== 'object' || typeof a.k !== 'string' || !ANIMAL_RE.test(a.k)) return null
  return {
    k: a.k,
    x: num(a.x, -1e5, 1e5),
    y: num(a.y, -520, 520),
    z: num(a.z, -1e5, 1e5),
    h: num(a.h, -100, 100),
    hp: num(a.hp, 0, 1e4),
    t: a.t === 'h' || validId(a.t) ? a.t : '',
    d: !!a.d,
  }
}

// A placed (b: block id) or broken (b: '') cell.
function cleanEdit(e) {
  if (!e || typeof e !== 'object') return null
  const x = Math.round(num(e.x, -1e5, 1e5))
  const y = Math.round(num(e.y, -520, 520))
  const z = Math.round(num(e.z, -1e5, 1e5))
  const b = typeof e.b === 'string' && ID_RE.test(e.b) ? e.b : ''
  return { key: `${x},${y},${z}`, b }
}

function cleanSay(v) {
  if (!v || typeof v !== 'object') return null
  const text = cleanText(v.text, SAY_MAX)
  return text ? { n: Math.round(num(v.n, 0, 1e9)), text } : null
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
    [`${base}/players/${playerId}/x`]: num(s.x, -1e5, 1e5),
    [`${base}/players/${playerId}/y`]: num(s.y, -520, 520),
    [`${base}/players/${playerId}/z`]: num(s.z, -1e5, 1e5),
    [`${base}/players/${playerId}/yaw`]: num(s.yaw, -100, 100),
    [`${base}/players/${playerId}/weapon`]: cleanText(s.weapon, 20),
    [`${base}/players/${playerId}/held`]: typeof s.held === 'string' && ID_RE.test(s.held) ? s.held : '',
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
  const out = { host, isHost, wave: server.wave || 0, players: {}, zombies: {}, hurt: [], credits: [], hits: [], edits: [], editSeq: server.editSeq || 0 }

  // Something I said in chat: a bubble over my head for the others.
  const say = cleanSay(body.say)
  if (say && say.n !== me.say?.n) updates[`${base}/players/${playerId}/say`] = { ...say, at: now }

  // Blocks I placed or broke since my last sync.
  const edits = server.edits || {}
  let count = Object.keys(edits).length
  let seq = server.editSeq || 0
  for (const raw of [].concat(body.edits || []).slice(0, MAX_EDITS_PER_SYNC)) {
    const e = cleanEdit(raw)
    if (!e) continue
    if (!edits[e.key]) {
      if (count >= MAX_EDITS) continue
      count++
    }
    seq++
    updates[`${base}/edits/${e.key}`] = { b: e.b, s: seq, by: playerId }
  }
  if (seq !== (server.editSeq || 0)) updates[`${base}/editSeq`] = seq
  // ...and everyone else's I haven't had yet (all of them when I've just joined).
  const after = num(body.editsAfter, 0, 1e9)
  for (const [key, e] of Object.entries(edits)) {
    if (!e || e.by === playerId || !(e.s > after)) continue
    const [x, y, z] = key.split(',').map(Number)
    out.edits.push({ x, y, z, b: e.b || '' })
  }
  out.editSeq = seq

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
    const sky = cleanSky(body.sky)
    if (sky) updates[`${base}/sky`] = sky
    if (body.animals && typeof body.animals === 'object') {
      const as = {}
      for (const [id, a] of Object.entries(body.animals).slice(0, MAX_ANIMALS)) {
        if (!/^a\d{1,9}$/.test(id)) continue
        const c = cleanAnimal(a)
        if (c) as[id] = c
      }
      updates[`${base}/animals`] = as
    }
    // Where the host spawned can be picked after the game was made.
    const world = body.world !== undefined ? cleanWorld(body.world) : null
    if (world) updates[`${base}/world`] = world
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
      updates[`${base}/players/${c.to}/credits/${newId(8)}`] = cleanCredit(c)
    }
  } else {
    out.zombies = server.zombies || {}
    out.sky = server.sky || null
    out.animals = server.animals || {}
    // Shots on the host's zombies (z...) and animals (a..., or taming one).
    for (const h of [].concat(body.hits || []).slice(0, MAX_HITS_PER_SYNC)) {
      if (!h || !/^[za]\d{1,9}$/.test(h.id)) continue
      updates[`${base}/hits/${newId(8)}`] = { id: h.id, dmg: num(h.dmg, 0, 5000), by: playerId, ...(h.tame === true && h.id[0] === 'a' ? { tame: true } : {}) }
    }
  }
  // What was queued for me.
  for (const [key, amount] of Object.entries(me.hurt || {})) {
    out.hurt.push(Number(amount) || 0)
    updates[`${base}/players/${playerId}/hurt/${key}`] = null
  }
  for (const [key, c] of Object.entries(me.credits || {})) {
    out.credits.push(cleanCredit(c))
    updates[`${base}/players/${playerId}/credits/${key}`] = null
  }
  for (const [pid, p] of Object.entries(server.players || {})) {
    if (pid === playerId || !live.has(pid) || !p) continue
    out.players[pid] = { nick: p.nick, x: p.x, y: p.y, z: p.z, yaw: p.yaw, weapon: p.weapon, held: p.held || '', firing: !!p.firing, dead: !!p.dead }
    // A chat bubble: its number (new one = new bubble) and how long ago.
    if (p.say?.text) out.players[pid].say = { n: p.say.n, text: p.say.text, age: Math.max(0, now - (p.say.at || 0)) }
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
