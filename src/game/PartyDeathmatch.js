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
// The arena (about 41 x 41 blocks, a guess at a Kirka map's size) is real
// blocks high in the sky (DM_Y): walls all round, a tower in the middle
// with stairs up both sides, a raised deck along each side wall, and crates
// for cover. Built on every screen (BuildSurvival `_placed`, gone when the
// game ends).
//
// Everyone has DM_HP health of their own (your real health and gear aren't
// touched; the health bar shows this one - BuildSurvival._renderHud
// asks myHp()). A hit takes the gun's damage times DMG_SHARE (headshots
// HEAD_MULT more). Down to 0: the shooter gets a kill, you get a death and
// respawn at once at the spawn point furthest from everyone, safe for
// SPAWN_SAFE seconds. The host keeps everyone's health; a guest's hit
// travels like Duel Arena's (`d` + who). Kill feed top right; the board
// with everyone's kills and deaths shows when the round ends.
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const DM_Y = 186
export const DM_HP = 100
export const DM_TOTAL = 8
export const DM_HALF = 20 // the floor runs -DM_HALF..DM_HALF round home
export const DMG_SHARE = 0.65
export const DMG_MIN = 6
export const DMG_MAX = 100
export const HEAD_MULT = 1.5
export const SPAWN_SAFE = 1.5
const WALL_H = 9
const DECK = 4 // the side decks' and the tower's height
const FEED_N = 5
const BOT_SHOT = [0.35, 0.75]
const BOT_RANGE = 26
const BOT_DMG = [8, 14]
// Spawn points: [x, z, height of the floor under them] round home.
const SPAWNS = [[-17, -17, 0], [17, 17, 0], [-17, 17, 0], [17, -17, 0], [0, -18, 0], [0, 18, 0], [-9, 0, 0], [9, 0, 0], [-18.5, 0, DECK], [18.5, 0, DECK]]
// Cover: [x, z, width, depth, height].
const COVER = [[-10, -10, 2, 2, 2], [9, 9, 2, 2, 2], [-10, 9, 3, 1, 2], [9, -11, 1, 3, 2], [-2, -14, 4, 1, 2], [-2, 13, 4, 1, 2], [-14, -3, 1, 2, 1], [13, 2, 1, 2, 1], [-6, -6, 1, 1, 1], [6, 6, 1, 1, 1], [-6, 6, 1, 1, 3], [6, -6, 1, 1, 3]]
// Where a bot that's stuck walks to instead: stair feet and open floor.
const WAYPOINTS = [[0, 8], [0, -8], [18.5, 14], [18.5, -14], [-18.5, 14], [-18.5, -14], [-12, 0], [12, 0], [0, 17], [0, -17]]

const rand = ([a, b]) => a + Math.random() * (b - a)

export class PartyDeathmatch {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.endlessAmmo = true
    this.hp = new Map()
    this.deaths = {}
    this.prot = new Map()
    this.feed = [] // { n, k (killer), v (victim) }
    this.feedN = 0
    this._builtFor = ''
    this._myDeaths = 0
    this._seenFeed = 0
    this._feedKey = ''
    this._feedEl = document.createElement('div')
    this._feedEl.id = 'dm-feed'
    document.body.appendChild(this._feedEl)
    this._boardEl = document.createElement('div')
    this._boardEl.id = 'dm-board'
    document.body.appendChild(this._boardEl)
  }

  get B() {
    return this.s.B
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
    const others = this.pm._people().filter((p) => p.id !== id && this.hp.has(p.id))
    let best = null
    let bestD = -1
    for (const [sx, sz, sy] of SPAWNS) {
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
    b.shotIn = rand(BOT_SHOT) + 1
    b.dmIn = true
  }

  // A hit on `id` by `by` (where it runs).
  _hit(id, amount, by) {
    const pm = this.pm
    if (pm.phase !== 'play' || !this.hp.has(id) || !this.hp.has(by) || !this._foe(by, id) || this.prot.has(id)) return
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
    this.prot.set(id, SPAWN_SAFE)
    this.feed.push({ n: ++this.feedN, k: by, v: id })
    this.feed = this.feed.slice(-FEED_N)
    const b = pm.bots.get(id)
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
      // Fell out somehow: back in.
      if (b.y < DM_Y - 3 || !this._inside(b.x, b.z)) {
        this.placeBot(b)
        continue
      }
      b.shotIn -= dt
      if (b.shotIn > 0) continue
      b.shotIn = rand(BOT_SHOT)
      const foe = this._target(b, people)
      if (!foe) continue
      b.aim = foe.id
      b.tyaw = Math.atan2(foe.x - b.x, foe.z - b.z)
      const d = Math.hypot(foe.x - b.x, foe.z - b.z)
      if (foe.id === pm.myId || (me && Math.hypot(me.x - b.x, me.z - b.z) < 14)) {
        try { audioEngine.playSpecial?.('turret') } catch { /* no audio */ }
      }
      if (Math.random() < Math.max(0.15, Math.min(0.5, 0.55 - d / 60))) this._hit(foe.id, Math.round(rand(BOT_DMG)), b.id)
    }
  }

  _inside(x, z) {
    const h = this.pm.home
    return Math.abs(x - h.x) < DM_HALF + 1.5 && Math.abs(z - h.z) < DM_HALF + 1.5
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
  _target(b, people) {
    let best = null
    let bestD = BOT_RANGE
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
      const [wx, wz] = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)]
      const a = this._abs(wx, wz)
      b.way = { x: a.x + 0.5, z: a.z + 0.5, left: 2.5 }
      b._stuck = 0
    }
    if (b.way) {
      b.way.left -= dt
      if (b.way.left > 0 && Math.hypot(b.way.x - b.x, b.way.z - b.z) > 1) return b.way
      b.way = null
    }
    let foe = null
    let fd = Infinity
    for (const p of people) {
      if (!this._foe(b.id, p.id) || !this.hp.has(p.id)) continue
      const d = Math.hypot(p.x - b.x, p.z - b.z)
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
    return foe
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
    if (pm.phase !== 'play' || !this.hp.has(pm.myId)) return false
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
    if (pm.runs) this._hit(best.id, amount, pm.myId)
    else this.s.net?.queueHit(`d${best.id}`, amount)
    this.s.damageNumbers?.show(best.x, best.y + MOB_HEIGHT, best.z, amount)
    return true
  }

  remoteHit(h) {
    const id = String(h.id)
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
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor === key) return
    this._builtFor = key
    const s = this.s
    const bm = s.bm
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    const put = (x, y, z, type) => {
      const ax = hx + x
      const az = hz + z
      const ay = DM_Y + y
      if (bm.getBlockAt(ax, ay, az) === type) return
      if (bm.getBlockAt(ax, ay, az)) bm.removeBlock(ax, ay, az)
      bm.placeBlock(ax, ay, az, type, true)
      s._placed.set(bm._key(ax, ay, az), type)
    }
    const box = (x0, z0, w, d, y0, y1, type) => {
      for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) for (let y = y0; y <= y1; y++) put(x, y, z, typeof type === 'function' ? type(x, y, z) : type)
    }
    bm._suppressUndoRecording = true
    const W = DM_HALF
    // Floor and walls.
    for (let x = -W - 1; x <= W + 1; x++) {
      for (let z = -W - 1; z <= W + 1; z++) {
        const edge = Math.abs(x) === W + 1 || Math.abs(z) === W + 1
        put(x, 0, z, edge ? 'stonebricks' : (Math.floor(x / 3) + Math.floor(z / 3)) % 2 ? 'redsandstone' : 'terracotta')
        if (edge) for (let y = 1; y <= WALL_H; y++) put(x, y, z, y === 3 && (x + z) % 4 === 0 ? 'sealantern' : y === WALL_H ? 'glowstone' : 'stonebricks')
      }
    }
    // The tower in the middle, with stairs up the north and south sides.
    box(-3, -3, 7, 7, 1, DECK, (x, y) => (y === DECK ? 'quartz' : 'stonebricks'))
    for (let step = 1; step <= DECK; step++) {
      box(-1, 3 + step, 3, 1, 1, DECK - step + 1, 'quartz')
      box(-1, -3 - step, 3, 1, 1, DECK - step + 1, 'quartz')
    }
    // A raised deck along each side wall, with stairs at both ends.
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -W : W - 3
      box(x0, -10, 4, 21, 1, DECK, (x, y) => (y === DECK ? 'oak' : 'stonebricks'))
      for (let step = 1; step < DECK; step++) {
        box(x0, 10 + step, 4, 1, 1, DECK - step, 'oak')
        box(x0, -10 - step, 4, 1, 1, DECK - step, 'oak')
      }
    }
    // Crates.
    for (const [x, z, w, d, h] of COVER) box(x, z, w, d, 1, h, (cx, y) => (y === h ? 'oaklog' : 'oak'))
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

  events(was) {
    const pm = this.pm
    const s = this.s
    const me = pm.myId
    const deaths = this.deaths[me] || 0
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      this._goTo(this._spawnFor(me))
      this._myDeaths = deaths
      this._seenFeed = this.feedN
      this._myHp = DM_HP
    }
    if (pm.phase === 'play') {
      // I died: back in at a spawn point.
      if (deaths > this._myDeaths) {
        this._goTo(this._spawnFor(me))
        const by = [...this.feed].reverse().find((f) => f.v === me)?.k
        s._message(t('dmKilledBy', { name: by ? pm._name(by) : '?' }), 2)
        this._myHp = DM_HP
      }
      // Fell out somehow.
      const at = s.bodyPos()
      if (pm.home && (at.y < DM_Y - 3 || !this._inside(at.x, at.z))) this._goTo(this._spawnFor(me))
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
      }
    }
    this._seenFeed = Math.max(this._seenFeed, this.feedN)
    this._renderFeed()
    this._renderBoard()
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
      row.textContent = t('dmFeedLine', { a: pm._name(f.k), b: pm._name(f.v) })
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
    return t('dmStart', { n: Math.round(this.pm.left / 60) || 5 })
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
    if (!pm.home || y < DM_Y - 1 || y > DM_Y + WALL_H + 2) return false
    return Math.abs(x - Math.floor(pm.home.x)) <= DM_HALF + 2 && Math.abs(z - Math.floor(pm.home.z)) <= DM_HALF + 2
  }

  snap() {
    const out = (id) => this.pm._out(id)
    const hp = {}
    for (const [id, n] of this.hp) hp[out(id)] = Math.round(n)
    const de = {}
    for (const [id, n] of Object.entries(this.deaths)) de[out(id)] = n
    return { hp, de, kn: this.feedN, kf: this.feed.map((f) => `${f.n},${out(f.k)},${out(f.v)}`).join(';') }
  }

  apply(d) {
    const ok = (id) => /^(?:b\d{1,4}|[A-Za-z0-9]{4,40}|me)$/.test(id)
    if (d.hp && typeof d.hp === 'object') this.hp = new Map(Object.entries(d.hp).filter(([id, n]) => ok(id) && Number.isFinite(n)))
    if (d.de && typeof d.de === 'object') this.deaths = Object.fromEntries(Object.entries(d.de).filter(([id, n]) => ok(id) && Number.isFinite(n)))
    if (Number.isFinite(d.kn)) this.feedN = d.kn
    if (typeof d.kf === 'string') {
      this.feed = d.kf.split(';').map((s) => s.split(',')).filter((p) => p.length === 3 && ok(p[1]) && ok(p[2])).map(([n, k, v]) => ({ n: Number(n) || 0, k, v })).slice(-FEED_N)
    }
  }

  dispose() {
    this._feedEl.remove()
    this._boardEl.remove()
  }
}
