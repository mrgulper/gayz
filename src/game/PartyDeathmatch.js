// Deathmatch (2026-11-16, Gaymi: "it should be smooth and simple like
// kirka.io"). Free for all: everyone against everyone in one arena, for
// ROUND_S.deathmatch seconds; the most kills when the clock runs out wins.
// Plugs into PartyMode (PartyModes.js) as its `ext`.
//
// Gaymi's picks: up to TOTAL players a round - bots fill the empty spots,
// and every real player who joins takes a bot's place (straight away, not
// just between rounds); timer only; endless ammo (you still reload); swap
// guns any time from the pause menu (Escape > Switch Weapon).
//
// The arena is a named map (DeathmatchMaps.js - Small Town first, 121 x 121
// blocks) of real blocks high in the sky (DM_Y), empty void all round
// (walk off the edge and you fall: a death, nobody's kill - _fell).
// Built on every screen (BuildSurvival `_placed`, gone when the game ends).
// Bots find their way round the buildings on a grid of the ground (_nav).
//
// Bots carry a real gun (2026-11-16, Gaymi: "you dont see bots hold gun
// for shooting you"): each gets one from BOT_GUNS, holds it like a player
// does (HeldWeapon.js), turns to face whoever they shoot, flashes at the
// muzzle and makes that gun's sound; their damage and range go by it.
//
// Everyone has DM_HP health of their own (your real health and gear aren't
// touched; the health bar shows this one - BuildSurvival._renderHud
// asks myHp()). A hit takes the gun's damage times DMG_SHARE (headshots
// HEAD_MULT more). Down to 0: the shooter gets a kill, you get a death and
// respawn at once at the spawn point furthest from everyone, safe for
// SPAWN_SAFE seconds. The host keeps everyone's health; a guest's hit
// travels like Duel Arena's (`d` + who). Kill feed top right; the board
// with everyone's kills and deaths shows when the round ends.
//
// Kirka style (2026-11-16, Gaymi: "make it more kirka style but dont
// change the movement"): no wait in the camp first - you start in the
// arena (waitS = 0, PartyModes.js). Dying shows a kill cam: the camera
// flies to whoever killed you and watches them, with their name and
// health, for RESPAWN_S seconds (no moving or shooting; your body waits
// under the floor, safe), then you respawn. Kill streaks get a big banner,
// a bar at the top shows the time left and your place, and a headshot or
// kill turns the hit marker gold / red (BuildSurvival._hitFeedback).
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { DM_MAPS, DEFAULT_DM_MAP, dmMapId, buildEdge } from './DeathmatchMaps.js'

export const DM_Y = 186
export const DM_HP = 100
export const DM_TOTAL = 8
export const DMG_SHARE = 0.65
export const DMG_MIN = 6
export const DMG_MAX = 100
export const HEAD_MULT = 1.5
export const SPAWN_SAFE = 1.5
export const RESPAWN_S = 5
const CAM_FLY = 0.6 // seconds the kill cam takes to reach the killer
const CAM_BACK = 3.2 // blocks the kill cam stays from the killer
const PARK_DROP = 30 // blocks under the floor your body waits during it
const FEED_N = 5
const VOID_DROP = 10 // blocks under the floor that count as fallen into the void
// A bot's gun: seconds between shots, damage a hit, how far it reaches,
// and its chance to hit (null: less the further away). Guesses, tuned to
// about what the one bot gun did before.
export const BOT_GUNS = {
  rifle: { every: [0.3, 0.6], dmg: [8, 13], range: 34, hit: null },
  pistol: { every: [0.45, 0.8], dmg: [10, 15], range: 26, hit: null },
  shotgun: { every: [0.8, 1.2], dmg: [18, 28], range: 12, hit: 0.55 },
  awp: { every: [1.4, 2], dmg: [35, 50], range: 60, hit: 0.4 },
  gpmg: { every: [0.25, 0.5], dmg: [7, 11], range: 34, hit: null },
}
const BOT_GUN_IDS = Object.keys(BOT_GUNS)
const NAV_EVERY = 0.4 // seconds between a bot's path checks

const rand = ([a, b]) => a + Math.random() * (b - a)

export class PartyDeathmatch {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    // The map picked under Game Mode > Deathmatch (settings.dmMap) when
    // this screen runs the game; a guest gets the host's from the sync.
    this.mapId = pm.runs ? dmMapId(pm.s?.bm?.game?.settings?.dmMap) : DEFAULT_DM_MAP
    this._arenaKeys = new Set()
    this.botGuns = true
    this.endlessAmmo = true
    this.waitS = 0
    this._cam = null
    this._streak = 0
    this._topKey = ''
    this.hp = new Map()
    this.deaths = {}
    this.prot = new Map()
    this.feed = [] // { n, k (killer), v (victim) }
    this.feedN = 0
    this._builtFor = ''
    this._myDeaths = 0
    this._fellSent = 0
    this._fellAt = null
    this._seenFeed = 0
    this._feedKey = ''
    this._feedEl = document.createElement('div')
    this._feedEl.id = 'dm-feed'
    document.body.appendChild(this._feedEl)
    this._boardEl = document.createElement('div')
    this._boardEl.id = 'dm-board'
    document.body.appendChild(this._boardEl)
    // The kill cam's card: "Killed by", their name, their health, the
    // countdown.
    this._camEl = document.createElement('div')
    this._camEl.id = 'dm-killcam'
    this._camEl.innerHTML = '<div class="dm-kc-by"></div><div class="dm-kc-name"></div><div class="dm-kc-hp"><i></i></div><div class="dm-kc-time"></div>'
    document.body.appendChild(this._camEl)
    this._streakEl = document.createElement('div')
    this._streakEl.id = 'dm-streak'
    document.body.appendChild(this._streakEl)
    this._topEl = document.createElement('div')
    this._topEl.id = 'dm-top'
    this._topEl.innerHTML = '<b></b><span></span>'
    document.body.appendChild(this._topEl)
  }

  get B() {
    return this.s.B
  }

  get map() {
    return DM_MAPS[this.mapId] || DM_MAPS[DEFAULT_DM_MAP]
  }

  // The map's name ("Small Town"), for the minimap and the round's start.
  mapName() {
    return t(this.map.key)
  }

  // Spawn points for `id` (Team Deathmatch: their side's).
  _spawnList() {
    return this.map.spawns
  }

  get total() {
    return DM_TOTAL
  }

  // Everyone's own kills (here the round's score; Team Deathmatch keeps
  // them apart from the team score).
  _kills() {
    return this.pm.score
  }

  // Someone's team ('r' / 'b'), or '' (free for all).
  _teamOf() {
    return ''
  }

  // Can `a` hurt `b`? (Team Deathmatch: not a teammate.)
  _foe(a, b) {
    return a !== b
  }

  // Bots fill the empty spots; a player who joins takes a bot's place.
  _fill(people) {
    const pm = this.pm
    const real = people.filter((p) => !p.bot).length
    const before = pm.bots.size
    pm._fillBots(Math.max(0, this.total - real))
    return pm.bots.size !== before ? pm._people() : people
  }

  // The same arena round after round (it's where everyone already is).
  home(me) {
    return this.pm.home && Math.abs(this.pm.home.y - (DM_Y + 1)) < 0.5 ? this.pm.home : { x: Math.round(me.x), y: DM_Y + 1, z: Math.round(me.z) }
  }

  _abs(x, z) {
    const h = this.pm.home
    return { x: Math.floor(h.x) + x, z: Math.floor(h.z) + z }
  }

  // The spawn point furthest from everyone else (a little random so two
  // deaths at once don't land on the same spot).
  _spawnFor(id) {
    const others = this.pm._people().filter((p) => this._foe(id, p.id) && this.hp.has(p.id))
    let best = null
    let bestD = -1
    for (const [sx, sz, sy] of this._spawnList(id)) {
      const a = this._abs(sx, sz)
      const d = others.length ? Math.min(...others.map((p) => Math.hypot(p.x - a.x - 0.5, p.z - a.z - 0.5))) : Math.random() * 10
      const score = d + Math.random() * 4
      if (score > bestD) {
        bestD = score
        best = { x: a.x + 0.5, y: DM_Y + 1 + sy, z: a.z + 0.5 }
      }
    }
    return best
  }

  _faceMiddle(at) {
    const h = this.pm.home
    return Math.atan2(-(h.x - at.x), -(h.z - at.z))
  }

  begin(people) {
    this.hp = new Map(people.map((p) => [p.id, DM_HP]))
    this.deaths = {}
    this.prot.clear()
    this.feed = []
    const k = this._kills()
    for (const p of people) k[p.id] = 0
  }

  placeBot(b) {
    const at = this._spawnFor(b.id)
    b.x = b.tx = at.x
    b.y = b.ty = at.y
    b.z = b.tz = at.z
    b.vy = 0
    if (!BOT_GUNS[b.w]) b.w = BOT_GUN_IDS[Math.floor(Math.random() * BOT_GUN_IDS.length)]
    b.shotIn = rand(BOT_GUNS[b.w].every) + 1
    b.dmIn = true
    b.nav = null
  }

  // A hit on `id` by `by` (where it runs).
  _hit(id, amount, by) {
    const pm = this.pm
    if (pm.phase !== 'play' || !this.hp.has(id) || !this.hp.has(by) || !this._foe(by, id) || this.prot.has(id)) return
    // Spectating: nothing can hurt you (PlaySpectate.js).
    if (id === pm.myId && this.s.spectating) return
    this.hp.set(id, Math.max(0, this.hp.get(id) - amount))
    if (this.hp.get(id) <= 0) this._kill(id, by)
  }

  _kill(id, by) {
    const pm = this.pm
    const k = this._kills()
    k[by] = (k[by] || 0) + 1
    this._scored(by)
    this.deaths[id] = (this.deaths[id] || 0) + 1
    this.hp.set(id, DM_HP)
    const b = pm.bots.get(id)
    // A bot is straight back in; a player watches the kill cam first.
    this.prot.set(id, b ? SPAWN_SAFE : RESPAWN_S + SPAWN_SAFE)
    this.feed.push({ n: ++this.feedN, k: by, v: id })
    this.feed = this.feed.slice(-FEED_N)
    if (b) this.placeBot(b)
  }

  // `id` fell into the void past the edge (2026-11-16, Gaymi: "falling
  // off = you die and respawn"): a death, nobody's kill. In the feed the
  // faller is both sides of the line (k === v), shown as "fell".
  _fell(id) {
    const pm = this.pm
    if (pm.phase !== 'play' || !this.hp.has(id) || this.prot.has(id)) return
    if (id === pm.myId && this.s.spectating) return
    this.deaths[id] = (this.deaths[id] || 0) + 1
    this.hp.set(id, DM_HP)
    const b = pm.bots.get(id)
    this.prot.set(id, b ? SPAWN_SAFE : RESPAWN_S + SPAWN_SAFE)
    this.feed.push({ n: ++this.feedN, k: id, v: id })
    this.feed = this.feed.slice(-FEED_N)
    if (b) this.placeBot(b)
  }

  // A kill by `by` (Team Deathmatch adds it to their team).
  _scored() {}

  run(people, dt) {
    const pm = this.pm
    const k = this._kills()
    // A solo game got its server id ('me' -> the real one): keep my kills.
    const myId = pm.myId
    if (myId !== 'me' && this.hp.has('me')) {
      this.hp.set(myId, this.hp.get('me'))
      this.hp.delete('me')
      k[myId] = (k[myId] || 0) + (k.me || 0)
      delete k.me
      if (this.deaths.me) this.deaths[myId] = (this.deaths[myId] || 0) + this.deaths.me
      delete this.deaths.me
      for (const f of this.feed) {
        if (f.k === 'me') f.k = myId
        if (f.v === 'me') f.v = myId
      }
    }
    people = this._fill(people)
    const ids = new Set(people.map((p) => p.id))
    for (const id of [...this.hp.keys()]) {
      if (ids.has(id)) continue
      this.hp.delete(id)
      delete k[id]
      delete this.deaths[id]
    }
    for (const p of people) {
      if (this.hp.has(p.id)) continue
      this.hp.set(p.id, DM_HP)
      k[p.id] = k[p.id] || 0
      this.prot.set(p.id, SPAWN_SAFE)
      if (p.bot) this.placeBot(p.bot)
    }
    for (const [id, left] of this.prot) {
      if (left - dt <= 0) this.prot.delete(id)
      else this.prot.set(id, left - dt)
    }
    const me = people.find((p) => p.id === pm.myId)
    for (const p of people) {
      const b = p.bot
      if (!b) continue
      // Fell into the void: a death, like anyone's.
      if (b.y < DM_Y - VOID_DROP) {
        this._fell(b.id)
        continue
      }
      // Out past the island somehow: back in.
      if (!this._inside(b.x, b.z)) {
        this.placeBot(b)
        continue
      }
      b.faceT = Math.max(0, (b.faceT || 0) - dt)
      const gun = BOT_GUNS[b.w] || BOT_GUNS.rifle
      b.shotIn -= dt
      if (b.shotIn > 0) continue
      b.shotIn = rand(gun.every)
      const foe = this._target(b, people, gun.range)
      if (!foe) continue
      b.aim = foe.id
      // Turns to face them (and keeps facing them a moment, walking or not).
      b.tyaw = Math.atan2(foe.x - b.x, foe.z - b.z)
      b.faceT = 0.7
      const d = Math.hypot(foe.x - b.x, foe.z - b.z)
      pm._botFired(b, me)
      const chance = gun.hit ?? Math.max(0.15, Math.min(0.5, 0.55 - d / 60))
      if (Math.random() < chance) this._hit(foe.id, Math.round(rand(gun.dmg)), b.id)
    }
  }

  _inside(x, z) {
    const h = this.pm.home
    const half = this.map.half
    return Math.abs(x - h.x) < half + 1.5 && Math.abs(z - h.z) < half + 1.5
  }

  // Nothing solid between two people's eyes.
  _sees(a, b) {
    const ay = a.y + 1.5
    const by = b.y + 1.2
    const d = Math.hypot(b.x - a.x, by - ay, b.z - a.z)
    const steps = Math.ceil(d * 2)
    for (let i = 1; i < steps; i++) {
      const k = i / steps
      if (this.s._solid(Math.floor(a.x + (b.x - a.x) * k), Math.floor(ay + (by - ay) * k), Math.floor(a.z + (b.z - a.z) * k))) return false
    }
    return true
  }

  // The nearest enemy a bot can see.
  _target(b, people, range) {
    let best = null
    let bestD = range
    for (const p of people) {
      if (!this._foe(b.id, p.id) || !this.hp.has(p.id) || this.prot.has(p.id)) continue
      const d = Math.hypot(p.x - b.x, p.z - b.z)
      if (d < bestD && this._sees(b, p)) {
        bestD = d
        best = p
      }
    }
    return best
  }

  // A bot heads for the nearest enemy, circles them up close, and walks
  // somewhere else for a bit when it's stuck.
  botGoal(b, people) {
    const pm = this.pm
    if (pm.phase !== 'play' || !pm.home) return null
    const dt = pm._dt || 1 / 60
    const moved = b._lx === undefined ? 1 : Math.hypot(b.x - b._lx, b.z - b._lz)
    b._lx = b.x
    b._lz = b.z
    b._stuck = moved < 0.01 ? (b._stuck || 0) + dt : 0
    if (b._stuck > 0.8) {
      const ways = this.map.waypoints
      const [wx, wz] = ways[Math.floor(Math.random() * ways.length)]
      const a = this._abs(wx, wz)
      b.way = { x: a.x + 0.5, z: a.z + 0.5, left: 2.5 }
      b._stuck = 0
    }
    if (b.way) {
      b.way.left -= dt
      if (b.way.left > 0 && Math.hypot(b.way.x - b.x, b.way.z - b.z) > 1) return b.way
      b.way = null
    }
    // The nearest enemy - one on the ground first (bots don't climb up
    // to the roofs).
    let foe = null
    let fd = Infinity
    for (const p of people) {
      if (!this._foe(b.id, p.id) || !this.hp.has(p.id)) continue
      const d = Math.hypot(p.x - b.x, p.z - b.z) + (p.y > DM_Y + 3 ? 1000 : 0)
      if (d < fd) {
        fd = d
        foe = p
      }
    }
    if (!foe) return null
    if (fd < 9 && this._sees(b, foe)) {
      if (Math.random() < dt * 0.4) b.side = -(b.side || 1)
      const a = Math.atan2(b.z - foe.z, b.x - foe.x) + 0.6 * (b.side || 1)
      return { x: foe.x + Math.cos(a) * 7, z: foe.z + Math.sin(a) * 7 }
    }
    return this._navStep(b, foe, dt) || foe
  }

  // --- finding the way round the buildings (bots, where the game runs) ---

  // Which ground cells can be walked: floor under, room for a body above.
  // Built once the arena's blocks are there.
  _navGrid() {
    if (this._grid && this._gridFor === this._builtFor) return this._grid
    const h = this.pm.home
    if (!h || !this._builtFor) return null
    const half = this.map.half
    const n = half * 2 + 1
    const s = this.s
    const g = new Uint8Array(n * n)
    const hx = Math.floor(h.x)
    const hz = Math.floor(h.z)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = hx + i - half
        const z = hz + j - half
        g[i * n + j] = s._solid(x, DM_Y, z) && !s._solid(x, DM_Y + 1, z) && !s._solid(x, DM_Y + 2, z) ? 1 : 0
      }
    }
    this._grid = g
    this._gridFor = this._builtFor
    return g
  }

  _cell(x, z) {
    const h = this.pm.home
    const half = this.map.half
    const i = Math.floor(x) - Math.floor(h.x) + half
    const j = Math.floor(z) - Math.floor(h.z) + half
    const n = half * 2 + 1
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : i * n + j
  }

  // Where a bot should walk next to reach `foe` the short way round: a
  // few cells along the path (worked out from the foe's cell outwards).
  _navStep(b, foe, dt) {
    if (b.y > DM_Y + 2) return null
    const g = this._navGrid()
    if (!g) return null
    b.navIn = (b.navIn || 0) - dt
    if (b.nav && b.navIn > 0 && b.nav.foe === foe.id) {
      if (Math.hypot(b.nav.x - b.x, b.nav.z - b.z) > 0.6) return b.nav
    }
    b.navIn = NAV_EVERY
    const half = this.map.half
    const n = half * 2 + 1
    const from = this._cell(b.x, b.z)
    const to = this._cell(foe.x, foe.z)
    if (from < 0 || to < 0 || !g[to]) return null
    const dist = new Int16Array(n * n).fill(-1)
    const queue = new Int32Array(n * n)
    let head = 0
    let tail = 0
    dist[to] = 0
    queue[tail++] = to
    while (head < tail && dist[from] < 0) {
      const c = queue[head++]
      const i = Math.floor(c / n)
      const j = c % n
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue
        const k = ni * n + nj
        if (dist[k] >= 0 || !g[k]) continue
        dist[k] = dist[c] + 1
        queue[tail++] = k
      }
    }
    if (dist[from] < 0) return null
    // Down the path up to 3 cells.
    let c = from
    for (let step = 0; step < 3 && dist[c] > 0; step++) {
      const i = Math.floor(c / n)
      const j = c % n
      let next = c
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue
        const k = ni * n + nj
        if (dist[k] >= 0 && dist[k] < dist[next]) next = k
      }
      if (next === c) break
      c = next
    }
    const h = this.pm.home
    const ci = Math.floor(c / n)
    const cj = c % n
    b.nav = { x: Math.floor(h.x) + ci - half + 0.5, z: Math.floor(h.z) + cj - half + 0.5, foe: foe.id }
    return b.nav
  }

  // The minimap's dots besides me: my teammates (Team Deathmatch) - never
  // the enemies (Gaymi's pick).
  mapDots() {
    return []
  }

  // The leader wears a gold diamond.
  markColor(id) {
    const lead = this._leader()
    return lead && lead.n > 0 && lead.id === id ? 0xffd23f : null
  }

  _leader() {
    let best = null
    for (const [id, n] of Object.entries(this._kills())) if (!best || n > best.n) best = { id, n }
    return best
  }

  // My shot: the nearest fighter on the ray.
  shoot(ray, reach, wall, damage) {
    const pm = this.pm
    if (pm.phase !== 'play' || !this.hp.has(pm.myId) || this._cam) return false
    const B = this.B
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    let best = null
    let bestD = Math.min(reach, wall ? wall.t : Infinity)
    let head = false
    for (const p of pm._people()) {
      if (!this._foe(pm.myId, p.id) || !this.hp.has(p.id)) continue
      box.min.set((p.x - 0.4) * B, p.y * B, (p.z - 0.4) * B)
      box.max.set((p.x + 0.4) * B, (p.y + MOB_HEIGHT) * B, (p.z + 0.4) * B)
      if (!ray.intersectBox(box, hit)) continue
      const d = hit.distanceTo(ray.origin)
      if (d < bestD) {
        bestD = d
        best = p
        head = hit.y / B - p.y > MOB_HEIGHT * 0.78
      }
    }
    if (!best) return false
    // A shotgun's pellets all count (the shot only sends the middle ray).
    const pellets = Math.min(4, this.s.weapon?.pellets || 1)
    const amount = Math.round(Math.max(DMG_MIN, Math.min(DMG_MAX, damage * pellets * DMG_SHARE * (head ? HEAD_MULT : 1))))
    const before = this.deaths[best.id] || 0
    if (pm.runs) this._hit(best.id, amount, pm.myId)
    else this.s.net?.queueHit(`d${best.id}`, amount)
    this.s.damageNumbers?.show(best.x, best.y + MOB_HEIGHT, best.z, amount)
    // For the hit marker: gold on a headshot, red on a kill (a guest's
    // kill only shows once the host has it - "You killed").
    return { head, kill: (this.deaths[best.id] || 0) > before }
  }

  // No shooting or walking while the kill cam is on.
  noFire() {
    return !!this._cam
  }

  speed() {
    return this._cam ? 0 : 1
  }

  remoteHit(h) {
    const id = String(h.id)
    // A guest fell into the void (only ever about themselves).
    if (id === 'dfell') return this._fell(String(h.by || ''))
    if (id[0] === 'd') this._hit(id.slice(1), Math.max(0, Math.min(DMG_MAX, Number(h.dmg) || 0)), String(h.by || ''))
  }

  // My health (the health bar shows it), or null outside a round.
  myHp() {
    const pm = this.pm
    if (pm.phase !== 'play') return null
    return this.hp.get(pm.myId) ?? DM_HP
  }

  // --- every screen ---

  draw() {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z},${this.mapId}`
    if (this._builtFor === key) return
    this._builtFor = key
    const s = this.s
    const bm = s.bm
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    bm._suppressUndoRecording = true
    // A different map than before (a guest learning the host's pick):
    // the old one's blocks go first.
    for (const key of this._arenaKeys) {
      const type = s._placed.get(key)
      if (!type) continue
      const [x, y, z] = key.split(',').map(Number)
      if (bm.getBlockAt(x, y, z) === type) bm.removeBlock(x, y, z)
      s._placed.delete(key)
    }
    this._arenaKeys.clear()
    // type 'air' clears the cell; facing turns stairs (0-3, see
    // BuildMode._stairFacing).
    const put = (x, y, z, type, facing = null) => {
      if (!type) return
      const ax = hx + x
      const az = hz + z
      const ay = DM_Y + y
      const key = bm._key(ax, ay, az)
      if (type === 'air') {
        const was = s._placed.get(key)
        if (was && bm.getBlockAt(ax, ay, az) === was) bm.removeBlock(ax, ay, az)
        s._placed.delete(key)
        this._arenaKeys.delete(key)
        return
      }
      this._arenaKeys.add(key)
      if (bm.getBlockAt(ax, ay, az) === type) return
      if (bm.getBlockAt(ax, ay, az)) bm.removeBlock(ax, ay, az)
      bm.placeBlock(ax, ay, az, type, true, facing === null ? null : { facing })
      s._placed.set(key, type)
    }
    // type: a block, or (x, z, y) -> a block (null: leave it).
    const box = (x0, z0, w, d, y0, y1, type) => {
      for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) for (let y = y0; y <= y1; y++) put(x, y, z, typeof type === 'function' ? type(x, z, y) : type)
    }
    const map = this.map
    map.build({ put, box })
    // The void round the uneven edge.
    buildEdge(map, { put, box })
    bm._suppressUndoRecording = false
  }

  _goTo(at) {
    const s = this.s
    const tm = s.bm.tryMode
    tm.pos.set(at.x, at.y, at.z)
    tm.vel?.set(0, 0, 0)
    s.bm.camera.position.set(at.x * this.B, (at.y + 1.62) * this.B, at.z * this.B)
    s.bm._yaw = this._faceMiddle(at)
  }

  // A spawn point (PartyModes _enter: the wait before a round).
  enter() {
    this._goTo(this._spawnFor(this.pm.myId))
  }

  events(was) {
    const pm = this.pm
    const s = this.s
    const me = pm.myId
    const deaths = this.deaths[me] || 0
    if (this._cam && pm.phase !== 'play') this._endCam(false)
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      if (this._cam) this._endCam(false)
      this._streak = 0
      this._goTo(this._spawnFor(me))
      this._myDeaths = deaths
      this._seenFeed = this.feedN
      this._myHp = DM_HP
    }
    if (pm.phase === 'play') {
      // I died: the kill cam, then back in at a spawn point.
      if (deaths > this._myDeaths) {
        const by = [...this.feed].reverse().find((f) => f.v === me)?.k
        this._fellSent = 0
        this._startCam(by === me ? '' : by)
        this._myHp = DM_HP
      }
      if (this._cam) this._runCam()
      // Fell into the void: a death (the host counts it; a guest tells
      // the host once and waits under the floor for the answer).
      const at = s.bodyPos()
      if (!this._cam && pm.home && at.y < DM_Y - VOID_DROP && !s.spectating) {
        if (!this._fellSent) this._fellAt = { x: at.x, z: at.z }
        if (pm.runs) {
          const before = this.deaths[me] || 0
          this._fell(me)
          // Still spawn-safe (not a death): just back in.
          if ((this.deaths[me] || 0) === before) {
            this._fellAt = null
            this._goTo(this._spawnFor(me))
          }
        } else if (!this._fellSent) {
          this._fellSent = performance.now()
          s.net?.queueHit('dfell', 0)
        } else if (performance.now() - this._fellSent > 2500) {
          // No answer (spawn-safe, or the message got lost): just back in.
          this._fellSent = 0
          this._fellAt = null
          this._goTo(this._spawnFor(me))
        }
        if (this._fellSent) this._park()
      }
    }
    this._myDeaths = deaths
    // Hit: a thump, and the health bar moves.
    const mine = this.hp.get(me)
    if (pm.phase === 'play' && mine !== undefined && mine !== this._myHp) {
      if (mine < (this._myHp ?? DM_HP)) {
        try { audioEngine.playSpecial?.('thud') } catch { /* no audio */ }
      }
      this._myHp = mine
      s._renderHud()
    }
    // New kills: mine get a ding and a line in the middle.
    for (const f of this.feed) {
      if (f.n <= this._seenFeed) continue
      if (f.k === me) {
        s._message(t('dmYouKilled', { name: pm._name(f.v) }), 1.5)
        try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
        this._streak++
        if (this._streak >= 2) this._showStreak(this._streak)
      }
    }
    this._seenFeed = Math.max(this._seenFeed, this.feedN)
    this._renderFeed()
    this._renderBoard()
    this._renderTop()
  }

  // --- the kill cam (my screen only) ---

  _startCam(by) {
    const s = this.s
    const cam = s.bm.camera
    const at = this._fellAt || s.bodyPos()
    this._fellAt = null
    this._cam = { by: by || '', start: performance.now(), from: cam.position.clone(), dead: { x: at.x, z: at.z }, k: null, shown: '' }
    this._streak = 0
    s.bm.tryMode.hideGun = true
    s.bm.tryMode.camHeld = true
    this._camEl.classList.add('on')
    this._camEl.querySelector('.dm-kc-by').textContent = by ? t('dmKillCamBy') : ''
    this._park()
  }

  // My body waits under the arena floor, out of sight and out of reach.
  _park() {
    const tm = this.s.bm.tryMode
    const h = this.pm.home
    if (!h) return
    tm.pos.set(h.x, DM_Y - PARK_DROP, h.z)
    tm.vel?.set(0, 0, 0)
  }

  _runCam() {
    const c = this._cam
    const pm = this.pm
    const B = this.B
    const gone = (performance.now() - c.start) / 1000
    if (gone >= RESPAWN_S) return this._endCam(true)
    this._park()
    const k = pm._people().find((p) => p.id === c.by)
    if (k) c.k = { x: k.x, y: k.y, z: k.z }
    const cam = this.s.bm.camera
    if (c.k) {
      // From the killer back towards where I fell (that way was clear -
      // they shot me along it), a bit above their head.
      let dx = c.dead.x - c.k.x
      let dz = c.dead.z - c.k.z
      const len = Math.hypot(dx, dz) || 1
      const back = Math.min(CAM_BACK, len)
      dx /= len
      dz /= len
      const end = new THREE.Vector3((c.k.x + dx * back) * B, (c.k.y + 2.4) * B, (c.k.z + dz * back) * B)
      const a = Math.min(1, gone / CAM_FLY)
      cam.position.lerpVectors(c.from, end, a * a * (3 - 2 * a))
      cam.lookAt(c.k.x * B, (c.k.y + MOB_HEIGHT * 0.75) * B, c.k.z * B)
    } else if (!c.by && pm.home) {
      // Fell into the void: the camera rises above the edge where I went
      // off and looks back over the arena.
      const h = pm.home
      let dx = c.dead.x - h.x
      let dz = c.dead.z - h.z
      const len = Math.hypot(dx, dz) || 1
      const r = Math.min(len, this.map.half - 4)
      dx /= len
      dz /= len
      const end = new THREE.Vector3((h.x + dx * r) * B, (DM_Y + 9) * B, (h.z + dz * r) * B)
      const a = Math.min(1, gone / CAM_FLY)
      cam.position.lerpVectors(c.from, end, a * a * (3 - 2 * a))
      cam.lookAt(h.x * B, DM_Y * B, h.z * B)
    } else {
      cam.position.copy(c.from)
    }
    // The card: their name (in their team colour), health, the countdown.
    const hp = this.hp.get(c.by) ?? DM_HP
    const left = Math.ceil(RESPAWN_S - gone)
    const key = `${c.by}|${hp}|${left}`
    if (key === c.shown) return
    c.shown = key
    const name = this._camEl.querySelector('.dm-kc-name')
    name.textContent = c.by ? pm._name(c.by) : t('dmFellVoid')
    name.className = `dm-kc-name${this._teamOf(c.by) ? ` team-${this._teamOf(c.by)}` : ''}`
    this._camEl.querySelector('.dm-kc-hp i').style.width = `${Math.max(0, Math.min(100, (hp / DM_HP) * 100))}%`
    this._camEl.querySelector('.dm-kc-time').textContent = t('dmRespawnIn', { n: left })
  }

  _endCam(respawn) {
    this._cam = null
    this.s.bm.tryMode.hideGun = false
    this.s.bm.tryMode.camHeld = false
    this._camEl.classList.remove('on')
    if (respawn) this._goTo(this._spawnFor(this.pm.myId))
  }

  // "Double Kill!" and up, big in the middle for a moment.
  _showStreak(n) {
    const el = this._streakEl
    el.textContent = n === 2 ? t('dmDoubleKill') : n === 3 ? t('dmTripleKill') : t('dmKillStreak', { n })
    el.classList.remove('on')
    void el.offsetWidth
    el.classList.add('on')
  }

  // The bar at the top: time left and my place ("#2 of 8").
  _renderTop() {
    const pm = this.pm
    const show = pm.phase === 'play'
    let key = ''
    let place = ''
    let time = ''
    if (show) {
      const rows = this._boardRows()
      const i = rows.findIndex((r) => r.id === pm.myId)
      const left = Math.max(0, Math.floor(pm.left))
      time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
      place = t('dmPlace', { n: i < 0 ? rows.length : i + 1, total: rows.length })
      key = `${time}|${place}`
    }
    if (key === this._topKey) return
    this._topKey = key
    // Just under the mode's line at the top (the stats strip covers the
    // very top).
    const line = document.getElementById('build-play-wave-text')
    const box = line && line.getClientRects().length ? line.getBoundingClientRect() : null
    const y = box && box.bottom > 0 ? `${Math.round(box.bottom + 8)}px` : ''
    if (this._topEl.style.top !== y) this._topEl.style.top = y
    this._topEl.classList.toggle('on', show)
    this._topEl.firstChild.textContent = time
    this._topEl.lastChild.textContent = place
  }

  _renderFeed() {
    const pm = this.pm
    // Just under the minimap and its biome label (top right too), whatever
    // size it is - it changes size on phones.
    const map = document.getElementById('build-try-map')
    const box = map && map.getClientRects().length ? map.getBoundingClientRect() : null
    const top = box && box.bottom > 0 ? `${Math.round(box.bottom + 34)}px` : ''
    if (this._feedEl.style.top !== top) this._feedEl.style.top = top
    const show = pm.phase === 'play'
    const key = show ? this.feed.map((f) => f.n).join(',') : ''
    if (key === this._feedKey) return
    this._feedKey = key
    this._feedEl.replaceChildren(...(show ? this.feed : []).map((f) => {
      const row = document.createElement('div')
      const tm = this._teamOf(f.k)
      row.className = `dm-feed-row${f.k === pm.myId || f.v === pm.myId ? ' mine' : ''}${tm ? ` team-${tm}` : ''}`
      row.textContent = f.k === f.v ? t('dmFeedFell', { b: pm._name(f.v) }) : t('dmFeedLine', { a: pm._name(f.k), b: pm._name(f.v) })
      return row
    }))
  }

  // Everyone's kills and deaths, best first, while a round's result shows.
  _renderBoard() {
    const pm = this.pm
    const show = pm.phase === 'end'
    this._boardEl.classList.toggle('on', show)
    const rows = show ? this._boardRows() : []
    const key = `${show ? this._boardTitle() : ''}|${rows.map((r) => `${r.id}:${r.k}:${r.d}`).join(',')}`
    if (key === this._boardKey) return
    this._boardKey = key
    if (!show) return this._boardEl.replaceChildren()
    const line = (cells, cls) => {
      const row = document.createElement('div')
      row.className = cls
      for (const c of cells) {
        const span = document.createElement('span')
        span.textContent = c
        row.appendChild(span)
      }
      return row
    }
    const title = document.createElement('h3')
    title.textContent = this._boardTitle()
    this._boardEl.replaceChildren(title, line(['', t('dmBoardKills'), t('dmBoardDeaths')], 'dm-board-row dm-board-head'), ...rows.map((r, i) => line([`${i + 1}. ${pm._name(r.id)}`, String(r.k), String(r.d)], `dm-board-row${r.id === pm.myId ? ' mine' : ''}${r.cls ? ` ${r.cls}` : ''}`)))
  }

  // The board's rows, best first.
  _boardRows() {
    return Object.entries(this._kills()).map(([id, k]) => ({ id, k, d: this.deaths[id] || 0 })).sort((a, b) => b.k - a.k || a.d - b.d)
  }

  _boardTitle() {
    return t('dmBoardTitle')
  }

  // "You win!" rather than "You wins!".
  winText(w) {
    return w === this.pm.myId ? t('dmYouWin') : t('partyPlayerWins', { name: this.pm._name(w) })
  }

  startText() {
    return `${t('dmMapLine', { name: this.mapName() })} · ${t('dmStart', { n: Math.round(this.pm.left / 60) || 5 })}`
  }

  hud() {
    const pm = this.pm
    let out = t('dmHudKills', { n: this._kills()[pm.myId] || 0 })
    const lead = this._leader()
    if (lead && lead.n > 0) out += ` · ${t('dmHudLeader', { name: pm._name(lead.id), n: lead.n })}`
    return out
  }

  protects(x, y, z) {
    const pm = this.pm
    const half = this.map.half
    if (!pm.home || y < DM_Y - 2 || y > DM_Y + this.map.wallH + 6) return false
    return Math.abs(x - Math.floor(pm.home.x)) <= half + 2 && Math.abs(z - Math.floor(pm.home.z)) <= half + 2
  }

  snap() {
    const out = (id) => this.pm._out(id)
    const hp = {}
    for (const [id, n] of this.hp) hp[out(id)] = Math.round(n)
    const de = {}
    for (const [id, n] of Object.entries(this.deaths)) de[out(id)] = n
    return { mp: this.mapId, hp, de, kn: this.feedN, kf: this.feed.map((f) => `${f.n},${out(f.k)},${out(f.v)}`).join(';') }
  }

  apply(d) {
    const ok = (id) => /^(?:b\d{1,4}|[A-Za-z0-9]{4,40}|me)$/.test(id)
    if (typeof d.mp === 'string' && DM_MAPS[d.mp]) this.mapId = d.mp
    if (d.hp && typeof d.hp === 'object') this.hp = new Map(Object.entries(d.hp).filter(([id, n]) => ok(id) && Number.isFinite(n)))
    if (d.de && typeof d.de === 'object') this.deaths = Object.fromEntries(Object.entries(d.de).filter(([id, n]) => ok(id) && Number.isFinite(n)))
    if (Number.isFinite(d.kn)) this.feedN = d.kn
    if (typeof d.kf === 'string') {
      this.feed = d.kf.split(';').map((s) => s.split(',')).filter((p) => p.length === 3 && ok(p[1]) && ok(p[2])).map(([n, k, v]) => ({ n: Number(n) || 0, k, v })).slice(-FEED_N)
    }
  }

  dispose() {
    if (this._cam) this._endCam(false)
    this._feedEl.remove()
    this._boardEl.remove()
    this._camEl.remove()
    this._streakEl.remove()
    this._topEl.remove()
  }
}
