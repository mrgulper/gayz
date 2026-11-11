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
//                       hidden, sky, animals, inf, editSeq,
//                       players: { pid: { nick, x, y, z, yaw, weapon, held,
//                                         firing, dead, emote, hat, cape, sit, t,
//                                         hurt, credits, caught,
//                                         say } },
//                       hits: { key: { id, dmg, by, tame, catch, freeze, boo } },
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
// main: Zombie Survival; infection: Infection mode (src/game/Infection.js);
// zone: Shrinking Zone (src/game/ShrinkZone.js).
// td: Tower Defense (src/game/TowerDefense.js).
// hide / ctf / koth / soccer / potato / bowling / paint / build / lava / laser / kart / parkour / duel / golf / freeze / bomb / werewolf / dodge / chairs / simon / prop / tug: the party modes (src/game/PartyModes.js).
// escape / escapeSolo: Escape Rooms as a team, and Escape Race (src/game/EscapeRooms.js).
export const MODES = ['main', 'infection', 'zone', 'escape', 'escapeSolo', 'hide', 'ctf', 'koth', 'soccer', 'potato', 'bowling', 'paint', 'build', 'lava', 'laser', 'kart', 'parkour', 'duel', 'golf', 'freeze', 'bomb', 'werewolf', 'dodge', 'chairs', 'simon', 'prop', 'tug', 'td']
const PARTY_KINDS = { hide: 'hideSeek', ctf: 'captureFlag', koth: 'kingHill', soccer: 'zombieSoccer', potato: 'hotPotato', bowling: 'zombieBowling', paint: 'paintWars', build: 'buildBattle', lava: 'floorLava', laser: 'laserTag', kart: 'kartRace', parkour: 'obstacleCourse', duel: 'duelArena', golf: 'miniGolf', freeze: 'freezeTag', bomb: 'bombDefuse', werewolf: 'werewolfNight', dodge: 'dodgeball', chairs: 'musicalChairs', simon: 'simonSays', prop: 'propHunt', tug: 'tugOfWar' }
const ESCAPE_MODES = ['escape', 'escapeSolo']
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
    // The host's Who Can Join setting (Settings > Social, 2026-11-11):
    // Link Only and Nobody keep it off the list.
    if (server.access) continue
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

// Who can join (the host's Settings > Social > Who Can Join My Server):
// nothing = anyone, 'link' = only with the invite link, 'nobody' = locked.
const ACCESS = ['link', 'nobody']
const cleanAccess = (v) => (ACCESS.includes(v) ? v : null)

// hidden: a solo game made ready for friends the moment it starts (its
// address is the invite link) - left out of the Global list.
export async function createServer(db, { name, mode, nickname, skin, world, id: wanted, hidden, access } = {}, now = Date.now()) {
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
      ...(cleanAccess(access) ? { access: cleanAccess(access) } : {}),
    },
    // Whole, so an old server's players and skins under this id go too.
    [`serverSecrets/${id}`]: { [pid]: token },
  }
  const s = skinOf(skin)
  updates[`serverSkins/${id}`] = s ? { [pid]: s } : null
  await db.update(updates)
  return { serverId: id, playerId: pid, token, host: pid, mode: m }
}

export async function joinServer(db, { serverId, nickname, skin } = {}, now = Date.now()) {
  if (!validId(serverId)) throw new ServerError(400, 'bad-request')
  const server = await db.get(`servers/${serverId}`)
  if (!server) throw new ServerError(404, 'gone')
  const live = livePlayers(server, now)
  if (!live.length) throw new ServerError(404, 'gone')
  if (live.length >= MAX_PLAYERS) throw new ServerError(409, 'full')
  if (server.access === 'nobody') throw new ServerError(403, 'locked')
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
const ZOMBIE_SHINE_IDS = new Set(['gold', 'diamond', 'disco', 'pinata'])

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
// A Catch Trap's answer (PlayCatch.hostCatch): caught or not, and what it
// was ({ t: 'z' | 'a', k: kind, r: tier, n: name, b: boss }). Checked again
// by the game (Creatures.cleanCreature) before it's kept.
function cleanCatch(c) {
  if (c?.t !== 'z' && c?.t !== 'a') return { ok: false }
  const k = typeof c.k === 'string' && (c.t === 'a' ? ANIMAL_RE : KIND_RE).test(c.k) ? c.k : ''
  return {
    ok: c.ok === true,
    t: c.t,
    k,
    r: ZOMBIE_TIER_IDS.has(c.r) ? c.r : 'common',
    n: Number.isInteger(c.n) && c.n >= 0 && c.n < 100000 ? c.n : 0,
    b: c.b === true,
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

// The host's Infection round (Infection.snapshot): phase, time left,
// round, winner, who's infected, who's stunned, and the bots.
const INF_ID_RE = /^(?:b\d{1,4}|[A-Za-z0-9]{4,40})$/
function cleanInf(v) {
  if (!v || typeof v !== 'object') return null
  const ids = [].concat(v.ids || []).filter((id) => typeof id === 'string' && INF_ID_RE.test(id)).slice(0, 40)
  const st = {}
  for (const [id, left] of Object.entries(v.st && typeof v.st === 'object' ? v.st : {}).slice(0, 40)) if (INF_ID_RE.test(id)) st[id] = num(left, 0, 10)
  const bots = {}
  for (const [id, b] of Object.entries(v.bots && typeof v.bots === 'object' ? v.bots : {}).slice(0, 12)) {
    if (!/^b\d{1,4}$/.test(id) || !b || typeof b !== 'object') continue
    bots[id] = { x: num(b.x, -1e5, 1e5), y: num(b.y, -520, 520), z: num(b.z, -1e5, 1e5), h: num(b.h, -100, 100), n: Math.round(num(b.n, 1, 9999)) }
  }
  return {
    ph: ['wait', 'play', 'end'].includes(v.ph) ? v.ph : 'wait',
    t: num(v.t, 0, 1000),
    r: Math.round(num(v.r, 1, 1e6)),
    w: v.w === 'h' || v.w === 'z' ? v.w : '',
    ids,
    st,
    bots,
  }
}

// A party round (PartyModes.snapshot): phase, time, round, winner, where
// the arena is, teams, seekers, stuns, scores, flags, the King, the ball,
// the bots, Hot Potato's bomb (holder, fuse, who's out) and Zombie
// Bowling's turn, rolls and pins down, Paint Wars' painted ground and Build
// Battle's stage, theme, plot on show and plots. Only the server's own mode's kind is kept.
function cleanParty(v, kind) {
  if (!v || typeof v !== 'object' || v.k !== kind) return null
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).slice(0, 40) : [])
  const id = (s) => typeof s === 'string' && INF_ID_RE.test(s)
  const tm = {}
  for (const [k, team] of obj(v.tm)) if (id(k) && (team === 'r' || team === 'b')) tm[k] = team
  const st = {}
  for (const [k, left] of obj(v.st)) if (id(k)) st[k] = num(left, 0, 10)
  const sc = {}
  for (const [k, n] of obj(v.sc)) if (id(k) || k === 'r' || k === 'b') sc[k] = Math.round(num(n, 0, 1000))
  const fl = {}
  for (const k of ['r', 'b']) {
    const f = v.fl?.[k]
    if (f && typeof f === 'object') fl[k] = { a: ['base', 'carried', 'down'].includes(f.a) ? f.a : 'base', by: id(f.by) ? f.by : '', x: num(f.x, -1e5, 1e5), y: num(f.y, -520, 520), z: num(f.z, -1e5, 1e5) }
  }
  const bots = {}
  for (const [k, b] of obj(v.bots).slice(0, 12)) {
    if (!/^b\d{1,4}$/.test(k) || !b || typeof b !== 'object') continue
    bots[k] = { x: num(b.x, -1e5, 1e5), y: num(b.y, -520, 520), z: num(b.z, -1e5, 1e5), h: num(b.h, -100, 100), n: Math.round(num(b.n, 1, 9999)) }
  }
  const h = Array.isArray(v.h) && v.h.length === 3 ? [num(v.h[0], -1e5, 1e5), num(v.h[1], -520, 520), num(v.h[2], -1e5, 1e5)] : null
  const ball = Array.isArray(v.ball) && v.ball.length === 3 ? [num(v.ball[0], -1e5, 1e5), num(v.ball[1], -520, 520), num(v.ball[2], -1e5, 1e5)] : null
  return {
    k: kind,
    ph: ['wait', 'play', 'end'].includes(v.ph) ? v.ph : 'wait',
    t: num(v.t, 0, 1000),
    r: Math.round(num(v.r, 1, 1e6)),
    w: typeof v.w === 'string' && (id(v.w) || ['r', 'b', 'h', 's', 'tie'].includes(v.w)) ? v.w : '',
    h,
    tm,
    sk: [].concat(v.sk || []).filter(id).slice(0, 40),
    st,
    sc,
    fl,
    kg: id(v.kg) ? v.kg : '',
    ball,
    bots,
    ho: id(v.ho) ? v.ho : '',
    fu: num(v.fu, 0, 60),
    ou: [].concat(v.ou || []).filter(id).slice(0, 40),
    tu: id(v.tu) ? v.tu : '',
    ro: Object.fromEntries(obj(v.ro).filter(([k]) => id(k)).map(([k, n]) => [k, Math.round(num(n, 0, 10))])),
    pd: Math.round(num(v.pd, 0, 1023)),
    pa: typeof v.pa === 'string' && /^[0rb]{0,1100}$/.test(v.pa) ? v.pa : '',
    sb: v.sb === 'build' || v.sb === 'vote' ? v.sb : '',
    th: Math.round(num(v.th, 0, 20)),
    vi: Math.round(num(v.vi, 0, 40)),
    pl: Object.fromEntries(obj(v.pl).filter(([k]) => id(k)).map(([k, n]) => [k, Math.round(num(n, 0, 7))])),
    x: cleanPartyExt(v.x),
  }
}

// The part of a party round from a mode in its own file (PartyModes
// `ext`, e.g. Floor is Lava's tiles): up to 16 fields of short plain
// strings, numbers, or small lists / maps of numbers.
function cleanPartyExt(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out = {}
  for (const [k, x] of Object.entries(v).slice(0, 16)) {
    if (!/^[a-z]{1,4}$/.test(k)) continue
    if (typeof x === 'string') {
      if (/^[A-Za-z0-9_.,:;|-]{0,1200}$/.test(x)) out[k] = x
    } else if (typeof x === 'number') out[k] = num(x, -1e6, 1e6)
    else if (Array.isArray(x)) out[k] = x.slice(0, 64).map((n) => num(n, -1e6, 1e6))
    else if (x && typeof x === 'object') {
      const m = {}
      for (const [mk, n] of Object.entries(x).slice(0, 40)) if (/^(?:b\d{1,4}|[A-Za-z0-9]{1,40})$/.test(mk)) m[mk] = num(n, -1e6, 1e6)
      out[k] = m
    }
  }
  return out
}

// Shrinking Zone (src/game/ShrinkZone.js): where it began, its seed and
// how far along it is.
function cleanZone(v) {
  if (!v || typeof v !== 'object') return null
  return { x: num(v.x, -1e5, 1e5), z: num(v.z, -1e5, 1e5), y: Math.round(num(v.y, -520, 520)), s: Math.round(num(v.s, 0, 2 ** 31)), t: num(v.t, 0, 3600) }
}

// Tower Defense (src/game/TowerDefense.js): the lives left.
function cleanTd(v) {
  if (!v || typeof v !== 'object') return null
  return { l: Math.round(num(v.l, 0, 99)) }
}

// A player's boats and helicopters (src/game/Vehicles.js): b / h, where,
// facing, rotor on.
// Up to 3 map pins: a spot and who sees it ('a' everyone, 'f' friends).
// A friends pin carries `to`: the nicknames (lower case) of the players
// in the server who are on its owner's friends list - only they get it.
function cleanPins(v) {
  if (!Array.isArray(v)) return []
  return v.slice(0, 3).filter((d) => d && (d.v === 'a' || d.v === 'f')).map((d) => {
    const pin = { x: num(d.x, -1e5, 1e5), z: num(d.z, -1e5, 1e5), v: d.v }
    if (d.v === 'f') pin.to = (Array.isArray(d.to) ? d.to : []).filter((n) => typeof n === 'string').slice(0, MAX_PLAYERS).map((n) => n.slice(0, 40).toLowerCase())
    return pin
  })
}

// Another player's pins as `viewer` (a nickname) may see them: everyone's,
// and friends pins only when they name the viewer. `to` never goes out.
function pinsFor(list, viewer) {
  const me = String(viewer || '').toLowerCase()
  return (Array.isArray(list) ? list : []).filter((p) => p && (p.v === 'a' || (p.v === 'f' && Array.isArray(p.to) && p.to.includes(me)))).map((p) => ({ x: p.x, z: p.z, v: p.v }))
}

// The host's Zombie Train (src/game/ZombieTrain.js snapshot()): the loop's
// middle and how far round its front is.
// Escape Rooms as a team (src/game/EscapeRooms.js snapshot()): the host's
// puzzles (lever bits, code, button order, sign order), which rooms are
// solved / broken in, each door's seconds left, the team's room.
function cleanEsc(v) {
  if (!v || typeof v !== 'object') return null
  const digits = (s, len, max) => (typeof s === 'string' && s.length === len && [...s].every((c) => c >= '0' && c <= String(max)) ? s : null)
  const c = digits(v.c, 4, 9)
  const m = digits(v.m, 5, 3)
  const o = digits(v.o, 4, 3)
  if (!c || !m || !o) return null
  const bits = (n, max) => Math.round(num(n, 0, max))
  return { p: bits(v.p, 15), c, m, o, s: bits(v.s, 7), b: bits(v.b, 7), d: (Array.isArray(v.d) ? v.d : []).slice(0, 3).map((n) => Math.round(num(n, 0, 999))), r: bits(v.r, 2) }
}

function cleanTrain(v) {
  if (!v || typeof v !== 'object') return null
  return { cx: num(v.cx, -1e5, 1e5), cz: num(v.cz, -1e5, 1e5), head: num(v.head, -1e9, 1e9), w: v.w ? 1 : 0 }
}

// The host's dragon (DragonBoss.js): its lair, where round it is, health.
function cleanDragon(v) {
  if (!v || typeof v !== 'object') return null
  return { lx: Math.round(num(v.lx, -1e5, 1e5)), ly: Math.round(num(v.ly, -520, 520)), lz: Math.round(num(v.lz, -1e5, 1e5)), a: num(v.a, -1e6, 1e6), hp: Math.round(num(v.hp, 0, 1e5)), dy: v.dy ? 1 : 0 }
}

// The host's UFO (Ufo.js): where it drifts round, its height and clock.
function cleanUfo(v) {
  if (!v || typeof v !== 'object') return null
  return { gx: num(v.gx, -1e5, 1e5), gz: num(v.gz, -1e5, 1e5), y: num(v.y, -520, 1000), t: num(v.t, 0, 1e6) }
}

function cleanVeh(v) {
  if (!Array.isArray(v)) return []
  // b/h/a/s/j: boat, helicopter, balloon, submarine, jet ski (up to 4); k: the go-kart.
  return v.slice(0, 5).filter((d) => d && ['b', 'h', 'a', 's', 'j', 'k'].includes(d.k)).map((d) => ({ k: d.k, x: num(d.x, -1e5, 1e5), y: num(d.y, -520, 520), z: num(d.z, -1e5, 1e5), h: num(d.h, -100, 100), r: d.r ? 1 : 0 }))
}

// A player's spray tags (src/game/Sprays.js): the 16 x 16 picture (hex
// digits, one per square) and up to 3 spots (a block cell + which side).
const SPRAY_RE = /^[0-9a-f]{256}$/
function cleanSpray(v) {
  if (!v || typeof v !== 'object' || typeof v.p !== 'string' || !SPRAY_RE.test(v.p) || !Array.isArray(v.s)) return null
  const int = (n, lo, hi) => (Number.isInteger(n) && n >= lo && n <= hi ? n : null)
  const s = v.s.slice(0, 3).map((d) => d && { x: int(d.x, -1e5, 1e5), y: int(d.y, -520, 520), z: int(d.z, -1e5, 1e5), f: int(d.f, 0, 5) }).filter((d) => d && d.x !== null && d.y !== null && d.z !== null && d.f !== null)
  return s.length ? { p: v.p, s } : null
}

// A ghost (src/game/Ghosts.js): the grave [x, y, z] and up to 4 marked zombie ids.
function cleanGhost(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.g) || v.g.length !== 3) return null
  const g = [num(v.g[0], -1e5, 1e5), num(v.g[1], -520, 520), num(v.g[2], -1e5, 1e5)]
  const m = [].concat(v.m || []).filter((id) => Number.isInteger(id) && id >= 0 && id < 1e9).slice(0, 4)
  return { g, m }
}

// Notes just played on a Guitar or Drums (src/game/Instruments.js).
function cleanJam(v) {
  if (!v || typeof v !== 'object' || !['g', 'd'].includes(v.i) || typeof v.k !== 'string' || !/^[1-8]{0,16}$/.test(v.k)) return null
  return { i: v.i, n: Math.round(num(v.n, 0, 1e6)), k: v.k }
}

// A piece of the explored map a player is sharing (World Map mode,
// src/game/ExploredMap.js shareState): its number and the cells, sorted,
// as base-36 gaps.
const FOG_RE = /^[0-9a-z]+(,[0-9a-z]+){0,399}$/
function cleanFog(v) {
  if (!v || typeof v !== 'object' || typeof v.c !== 'string' || v.c.length > 4000 || !FOG_RE.test(v.c)) return null
  return { n: Math.round(num(v.n, 0, 1e9)), c: v.c }
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
    // An emote playing and the hat / cape worn (Emotes.js, Cosmetics.js).
    [`${base}/players/${playerId}/emote`]: typeof s.emote === 'string' && /^[a-z]{1,12}$/.test(s.emote) ? s.emote : '',
    [`${base}/players/${playerId}/hat`]: typeof s.hat === 'string' && ID_RE.test(s.hat) ? s.hat : '',
    [`${base}/players/${playerId}/cape`]: typeof s.cape === 'string' && /^[A-Za-z]{1,20}$/.test(s.cape) ? s.cape : '',
    // Sitting in a vehicle: the seat's eye height in blocks, 0 standing.
    [`${base}/players/${playerId}/sit`]: num(s.sit, 0, 4),
    [`${base}/players/${playerId}/veh`]: cleanVeh(s.veh),
    // Map pins shared with the others (src/game/MapPins.js).
    [`${base}/players/${playerId}/pins`]: cleanPins(s.pins),
    [`${base}/players/${playerId}/spray`]: cleanSpray(s.spray),
    // Escape Race: which copy of the rooms is theirs (src/game/EscapeRooms.js).
    [`${base}/players/${playerId}/lane`]: Math.round(num(s.lane, 0, 15)),
    // ...and whether they're already out (the "escaped first" news).
    [`${base}/players/${playerId}/esc`]: s.esc ? 1 : 0,
    // A ghost's grave and marks, and the notes just played (src/game/Ghosts.js, Instruments.js).
    [`${base}/players/${playerId}/gh`]: cleanGhost(s.gh),
    [`${base}/players/${playerId}/jam`]: cleanJam(s.jam),
    [`${base}/players/${playerId}/fog`]: cleanFog(s.fog),
    // This game's kill count, for the others' kill feed (src/game/HudSettings.js).
    [`${base}/players/${playerId}/kills`]: Math.round(num(s.kills, 0, 1e6)),
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
  // The host's Who Can Join setting, changed mid-game.
  if (isHost && 'access' in body && cleanAccess(body.access) !== (server.access || null)) updates[`${base}/access`] = cleanAccess(body.access)
  const out = { host, isHost, wave: server.wave || 0, players: {}, zombies: {}, hurt: [], credits: [], caught: [], hits: [], edits: [], editSeq: server.editSeq || 0 }

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
    const inf = server.mode === 'infection' ? cleanInf(body.inf) : null
    if (inf) updates[`${base}/inf`] = inf
    const zone = server.mode === 'zone' ? cleanZone(body.zone) : null
    if (zone) updates[`${base}/zone`] = zone
    const td = server.mode === 'td' ? cleanTd(body.td) : null
    if (td) updates[`${base}/td`] = td
    // The Zombie Train, the dragon and the UFO (2026-11-09): null clears.
    if (body.train !== undefined) updates[`${base}/train`] = cleanTrain(body.train)
    if (body.dragon !== undefined) updates[`${base}/dragon`] = cleanDragon(body.dragon)
    if (body.ufo !== undefined) updates[`${base}/ufo`] = cleanUfo(body.ufo)
    const esc = ESCAPE_MODES.includes(server.mode) ? cleanEsc(body.esc) : null
    if (esc) updates[`${base}/esc`] = esc
    const party = PARTY_KINDS[server.mode] ? cleanParty(body.party, PARTY_KINDS[server.mode]) : null
    if (party) updates[`${base}/party`] = party
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
    // Catch Trap answers for other players (PlayCatch.hostCatch).
    for (const c of [].concat(body.catches || []).slice(0, 20)) {
      if (!c || !live.has(c.to) || c.to === playerId) continue
      updates[`${base}/players/${c.to}/caught/${newId(8)}`] = cleanCatch(c)
    }
  } else {
    out.zombies = server.zombies || {}
    out.sky = server.sky || null
    out.animals = server.animals || {}
    if (server.inf) out.inf = server.inf
    if (server.zone) out.zone = server.zone
    if (server.td) out.td = server.td
    if (server.party) out.party = server.party
    out.train = server.train || null
    out.dragon = server.dragon || null
    out.ufo = server.ufo || null
    if (server.esc) out.esc = server.esc
    // Shots on the host's zombies (z...) and animals (a..., or taming one).
    for (const h of [].concat(body.hits || []).slice(0, MAX_HITS_PER_SYNC)) {
      // z/a: a zombie or animal; s: a stun shot in Infection (s + who).
      // p: a Paint Wars splat (p + x_z); v: Build Battle stars (v + whose plot, dmg = stars).
      // k: a Kart Racing banana (k + x_z, tenths); f: an Obstacle Course finish (f + ms).
      // d: a Duel Arena hit (d + who, dmg = damage).
      // g: a Mini-Golf putt (g + angle in mrad, dmg = power x 10).
      // s / w (Bomb Defuse, Werewolf Night): a stun (s + who) or a werewolf
      // knock-out / day vote (w + who, dmg 1 = knock out, 2 = vote).
      // s / q (Prop Hunt): a find (s + who) or a new disguise (q + prop).
      // u (Tug of War): how many times they pulled (u + count).
      if (!h || !(/^[za]\d{1,9}$/.test(h.id) || (['infection', 'ctf', 'koth', 'laser', 'dodge'].includes(server.mode) && /^s(?:b\d{1,4}|[A-Za-z0-9]{4,40})$/.test(h.id)) || (server.mode === 'paint' && /^p-?\d{1,6}_-?\d{1,6}$/.test(h.id)) || (server.mode === 'kart' && /^k-?\d{1,6}_-?\d{1,6}$/.test(h.id)) || (server.mode === 'parkour' && /^f\d{4,8}$/.test(h.id)) || (server.mode === 'duel' && /^d(?:b\d{1,4}|[A-Za-z0-9]{4,40})$/.test(h.id)) || (server.mode === 'golf' && /^g-?\d{1,5}$/.test(h.id)) || (['bomb', 'werewolf'].includes(server.mode) && /^[sw](?:b\d{1,4}|[A-Za-z0-9]{4,40})$/.test(h.id)) || (server.mode === 'tug' && /^u\d{1,2}$/.test(h.id)) || (server.mode === 'prop' && /^(?:s(?:b\d{1,4}|[A-Za-z0-9]{4,40})|q\d{1,2})$/.test(h.id)) || (server.mode === 'build' && /^v(?:b\d{1,4}|[A-Za-z0-9]{4,40})$/.test(h.id)) || h.id === 'x1' || (ESCAPE_MODES.includes(server.mode) && /^e[swb]\d(?:_\d{1,2})?$/.test(h.id)))) continue
      updates[`${base}/hits/${newId(8)}`] = { id: h.id, dmg: num(h.dmg, 0, 5000), by: playerId, ...(h.tame === true && h.id[0] === 'a' ? { tame: true } : {}), ...(h.catch === true ? { catch: true } : {}), ...(h.freeze === true && h.id[0] === 'z' ? { freeze: true } : {}), ...(h.boo === true && h.id[0] === 'z' ? { boo: true } : {}) }
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
  for (const [key, c] of Object.entries(me.caught || {})) {
    out.caught.push(cleanCatch(c))
    updates[`${base}/players/${playerId}/caught/${key}`] = null
  }
  for (const [pid, p] of Object.entries(server.players || {})) {
    if (pid === playerId || !live.has(pid) || !p) continue
    out.players[pid] = { nick: p.nick, x: p.x, y: p.y, z: p.z, yaw: p.yaw, weapon: p.weapon, held: p.held || '', firing: !!p.firing, dead: !!p.dead, emote: p.emote || '', hat: p.hat || '', cape: p.cape || '', veh: Array.isArray(p.veh) ? p.veh : [], pins: pinsFor(p.pins, me.nick), sit: Number(p.sit) || 0, spray: p.spray || null, lane: Number(p.lane) || 0, esc: p.esc ? 1 : 0, gh: p.gh || null, jam: p.jam || null, fog: p.fog || null, kills: Number(p.kills) || 0 }
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
