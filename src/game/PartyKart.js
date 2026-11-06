// Kart Racing (2026-11-02, Gaymi's idea list 6: "race the go-kart around
// a track against bots, with item boxes (a speed boost, a banana-style
// slip patch). The game has go-karts but no races" - a party mode, servers
// + bots). Plugs into PartyMode (PartyModes.js) as its `ext`.
//
// A walled oval track high in the sky (KART_Y): two straights of 2 x
// HALF_STRAIGHT blocks joined by two half circles (radius TURN_R), ROAD_W
// wide, with a chequered start line. Each round everyone starts on the grid
// in a go-kart (GoKart.js placeAt: you can't hop out mid-race). LAPS laps;
// the first across the line wins. Drive through a "?" box (three sets round
// the track, back BOX_BACK seconds after one's taken) for an item - a Boost
// (BOOST_S seconds of extra speed) or a Banana - and shoot to use it. A
// banana dropped behind you spins out whoever drives over it (SPIN_S).
// Bots drive the track in their own karts and use items too.
//
// The track is real blocks (BuildSurvival `_placed`, gone when the game
// ends), put in on every screen. The host keeps the laps (from everyone's
// synced spot) and the bananas. Others see you as a player, not in a kart
// (like the go-kart everywhere else). Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { makeKart } from './GoKart.js'

export const KART_Y = 210
export const LAPS = 3
export const HALF_STRAIGHT = 20
export const TURN_R = 13
export const ROAD_W = 7
export const BOOST_S = 1.8
export const SPIN_S = 1.2
export const BOX_BACK = 3
const A = HALF_STRAIGHT
const R = TURN_R
const L = 4 * A + 2 * Math.PI * R // one lap along the middle of the road
const BOT_V = [12.5, 14.5]
const BOX_AT = [0.3, 0.55, 0.8] // share of a lap after the line
const LANES = [-2, 0, 2]
const BANANA_R = 0.9

// The middle of the road at s blocks along it (s = 0 at the start line,
// halfway along the near straight), `lane` blocks to the driver's left.
// -> { x, z, heading } from the track's middle.
export function trackPoint(s, lane = 0) {
  let d = (((s + A) % L) + L) % L
  let x
  let z
  let dx
  let dz
  if (d < 2 * A) {
    x = -A + d
    z = -R
    dx = 1
    dz = 0
  } else if ((d -= 2 * A) < Math.PI * R) {
    const a = -Math.PI / 2 + d / R
    x = A + Math.cos(a) * R
    z = Math.sin(a) * R
    dx = -Math.sin(a)
    dz = Math.cos(a)
  } else if ((d -= Math.PI * R) < 2 * A) {
    x = A - d
    z = R
    dx = -1
    dz = 0
  } else {
    d -= 2 * A
    const a = Math.PI / 2 + d / R
    x = -A + Math.cos(a) * R
    z = Math.sin(a) * R
    dx = -Math.sin(a)
    dz = Math.cos(a)
  }
  // Left of the way you're driving is (dz, -dx).
  return { x: x + dz * lane, z: z - dx * lane, heading: Math.atan2(dx, dz) }
}

// How far along a lap (x, z) is (from the track's middle), and how far it
// is from the middle of the road.
export function trackParam(x, z) {
  let s
  let off
  if (x >= -A && x <= A) {
    if (z < 0) {
      s = x + A
      off = Math.abs(z + R)
    } else {
      s = 2 * A + Math.PI * R + (A - x)
      off = Math.abs(z - R)
    }
  } else if (x > A) {
    const a = Math.atan2(z, x - A)
    s = 2 * A + (a + Math.PI / 2) * R
    off = Math.abs(Math.hypot(x - A, z) - R)
  } else {
    let a = Math.atan2(z, x + A)
    if (a < 0) a += Math.PI * 2
    s = 4 * A + Math.PI * R + (a - Math.PI / 2) * R
    off = Math.abs(Math.hypot(x + A, z) - R)
  }
  return { s: (((s - A) % L) + L) % L, off }
}

export class PartyKart {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.prog = new Map() // id -> { s, laps, cp }
    this.bananas = [] // { x, z } (track-relative)
    this.item = ''
    this.boxesTaken = new Map() // box index -> seconds left
    this._builtFor = ''
    this._boxMeshes = []
    this._bananaMeshes = []
    this._spunBy = new Set()
  }

  get B() {
    return this.s.B
  }

  get total() {
    return 6
  }

  home(me) {
    return { x: Math.round(me.x), y: KART_Y + 1, z: Math.round(me.z) }
  }

  // Track-relative <-> world.
  _w(p) {
    return { x: this.pm.home.x + p.x, z: this.pm.home.z + p.z, heading: p.heading }
  }

  _rel(x, z) {
    return trackParam(x - this.pm.home.x, z - this.pm.home.z)
  }

  // Grid slot i: rows of two just past the line.
  grid(i) {
    return this._w(trackPoint(2 + Math.floor(i / 2) * 3.2, i % 2 ? -1.6 : 1.6))
  }

  begin(people, shuffled) {
    this.prog.clear()
    this.bananas = []
    this.boxesTaken.clear()
    this.order = shuffled
    for (const id of shuffled) this.prog.set(id, { s: 0, laps: 0, cp: false })
  }

  placeBot(b) {
    const i = Math.max(0, (this.order || []).indexOf(b.id))
    const g = this.grid(i)
    const lane = i % 2 ? -1.6 : 1.6
    Object.assign(b, { x: g.x, z: g.z, tx: g.x, tz: g.z, y: KART_Y + 1, ty: KART_Y + 1, vy: 0, ks: 2 + Math.floor(i / 2) * 3.2, lane, v: 0, top: BOT_V[0] + Math.random() * (BOT_V[1] - BOT_V[0]), boostT: 0, spinT: 0, item: '', useIn: 0 })
    b.tyaw = b.yaw = g.heading
  }

  // --- the race (where it runs) ---

  run(people, dt) {
    const pm = this.pm
    for (const p of people) {
      let pr = this.prog.get(p.id)
      if (!pr) this.prog.set(p.id, (pr = { s: 0, laps: 0, cp: false }))
      const { s } = this._rel(p.x, p.z)
      if (s > L * 0.4 && s < L * 0.6) pr.cp = true
      if (pr.s > L * 0.8 && s < L * 0.2 && pr.cp) {
        pr.laps++
        pr.cp = false
        if (pr.laps >= LAPS) return pm._end(p.id)
        if (p.id !== pm.myId) pm._say = { k: pr.laps === LAPS - 1 ? 'kartFinalLapOf' : 'kartLapOf', name: p.id, n: pr.laps + 1 }
      }
      pr.s = s
      // Another player's kart through a "?" box: it's taken (they got
      // the item on their own screen).
      if (!p.bot && p.id !== pm.myId) this._takeBoxes(p.x, p.z, () => true)
      // Over a banana: it's gone, and a bot spins out (players spin on
      // their own screens).
      for (let i = this.bananas.length - 1; i >= 0; i--) {
        const bn = this.bananas[i]
        if (Math.hypot(pm.home.x + bn.x - p.x, pm.home.z + bn.z - p.z) > BANANA_R) continue
        this.bananas.splice(i, 1)
        if (p.bot) p.bot.spinT = SPIN_S
        else if (p.id === pm.myId) this._spin()
      }
    }
    for (const [i, left] of this.boxesTaken) {
      if (left - dt <= 0) this.boxesTaken.delete(i)
      else this.boxesTaken.set(i, left - dt)
    }
  }

  // Out of time: whoever's furthest round wins.
  timeUp() {
    let best = ''
    let top = -1
    for (const [id, pr] of this.prog) {
      const v = pr.laps * L + pr.s
      if (v > top) {
        top = v
        best = id
      }
    }
    this.pm._end(best || 'tie')
  }

  // A bot drives its line round the track (true: it moved here).
  moveBot(b, dt) {
    const pm = this.pm
    if (pm.phase !== 'play' || b.ks === undefined) return true
    b.boostT = Math.max(0, b.boostT - dt)
    b.spinT = Math.max(0, b.spinT - dt)
    const want = b.spinT > 0 ? 0 : b.top * (b.boostT > 0 ? 1.5 : 1)
    b.v += Math.sign(want - b.v) * Math.min(Math.abs(want - b.v), (b.spinT > 0 ? 18 : 9) * dt)
    b.ks += b.v * dt
    if (Math.random() < dt * 0.4) b.laneGoal = LANES[Math.floor(Math.random() * 3)] * 0.9
    b.lane += Math.sign((b.laneGoal ?? b.lane) - b.lane) * Math.min(Math.abs((b.laneGoal ?? b.lane) - b.lane), 1.5 * dt)
    const p = this._w(trackPoint(b.ks, b.lane))
    b.x = b.tx = p.x
    b.z = b.tz = p.z
    b.y = b.ty = KART_Y + 1
    b.tyaw = p.heading + (b.spinT > 0 ? b.spinT * 9 : 0)
    // Item boxes, and using what it got.
    this._takeBoxes(b.x, b.z, (item) => {
      if (b.item) return false
      b.item = item
      b.useIn = 0.8 + Math.random() * 2
      return true
    })
    if (b.item && (b.useIn -= dt) <= 0) {
      if (b.item === 'boost') b.boostT = BOOST_S
      else this._dropBanana(trackPoint(b.ks - 1.6, b.lane))
      b.item = ''
    }
    return true
  }

  // Any "?" box under (x, z) that's there: give(item) -> taken?
  _takeBoxes(x, z, give) {
    BOX_AT.forEach((at, set) => {
      LANES.forEach((lane, j) => {
        const i = set * 3 + j
        if (this.boxesTaken.has(i)) return
        const p = this._w(trackPoint(at * L, lane))
        if (Math.hypot(p.x - x, p.z - z) > 1.3) return
        if (give(Math.random() < 0.55 ? 'boost' : 'banana')) this.boxesTaken.set(i, BOX_BACK)
      })
    })
  }

  _dropBanana(rel) {
    if (this.bananas.length < 24) this.bananas.push({ x: +rel.x.toFixed(2), z: +rel.z.toFixed(2) })
  }

  // --- my kart ---

  _kart() {
    return this.s.kart
  }

  _spin() {
    const k = this._kart()
    if (!k?.driving || k.spinT > 0) return
    k.spinT = SPIN_S
    this.s._message(t('kartSpin'), 1.5)
    try { audioEngine.playSpecial?.('honk') } catch { /* no audio */ }
  }

  // Shooting uses the item.
  shoot() {
    const pm = this.pm
    const k = this._kart()
    if (pm.phase !== 'play' || !this.item || !k?.driving) return false
    if (this.item === 'boost') {
      k.boostT = BOOST_S
      try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
    } else {
      const bx = k.x - Math.sin(k.heading) * 1.8 - pm.home.x
      const bz = k.z - Math.cos(k.heading) * 1.8 - pm.home.z
      if (pm.runs) this._dropBanana({ x: bx, z: bz })
      else this.s.net?.queueHit(`k${Math.round(bx * 10)}_${Math.round(bz * 10)}`, 0)
      // Just dropped: don't slip on my own banana straight away.
      this._grace = 1
    }
    this.item = ''
    return true
  }

  remoteHit(h) {
    const m = /^k(-?\d{1,6})_(-?\d{1,6})$/.exec(String(h.id))
    if (m) this._dropBanana({ x: Number(m[1]) / 10, z: Number(m[2]) / 10 })
  }

  // --- every screen ---

  draw() {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor !== key) {
      this._builtFor = key
      this._blocks()
    }
    const B = this.B
    const now = performance.now() / 1000
    // The "?" boxes spin and bob; taken ones are hidden.
    this._boxMeshes.forEach((m, i) => {
      m.visible = !this.boxesTaken.has(i)
      m.rotation.y = now * 2
      m.position.y = (KART_Y + 1.7 + Math.sin(now * 3 + i) * 0.15) * B
      m.material.color.setHSL((now * 0.4 + i * 0.1) % 1, 0.9, 0.6)
    })
    // The bananas.
    while (this._bananaMeshes.length < this.bananas.length) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5 * B, 0.18 * B, 0.3 * B), new THREE.MeshLambertMaterial({ color: 0xf2d24a, emissive: 0x3a3000 }))
      pm.arena.add(m)
      this._bananaMeshes.push(m)
    }
    this._bananaMeshes.forEach((m, i) => {
      const bn = this.bananas[i]
      m.visible = !!bn
      if (bn) m.position.set((pm.home.x + bn.x) * B, (KART_Y + 1.1) * B, (pm.home.z + bn.z) * B)
    })
    // Bots sit in karts.
    for (const b of pm.bots.values()) {
      if (!b.kartMesh) {
        b.kartMesh = makeKart(B)
        b.group.add(b.kartMesh)
      }
      if (b.body && !b.sat) {
        b.body.position.y -= 0.55 * B
        b.sat = true
      }
      for (const w of b.kartMesh.userData.wheels) w.rotation.x += (b.v || 0) * 0.02
    }
    this._mine()
  }

  // My kart: into it on the grid, boxes, bananas, back on the track.
  _mine() {
    const pm = this.pm
    const k = this._kart()
    if (!k) return
    if (pm.phase !== 'play') {
      k.lockedIn = false
      return
    }
    if (!k.driving) return
    const me = { x: k.x, z: k.z }
    this._takeBoxes(me.x, me.z, (item) => {
      if (this.item) return false
      this.item = item
      this.s._message(t('kartGot', { item: t(`kartItem_${item}`) }), 2)
      try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
      if (!pm.runs) return false
      return true
    })
    this._grace = Math.max(0, (this._grace || 0) - 1 / 60)
    if (!this._grace) for (const bn of this.bananas) if (Math.hypot(pm.home.x + bn.x - me.x, pm.home.z + bn.z - me.z) < BANANA_R) this._spin()
    // Off the track somehow: back on it.
    if (k.y < KART_Y - 4) {
      const { s } = this._rel(k.x, k.z)
      const p = this._w(trackPoint(s))
      k.placeAt(p.x, KART_Y + 1, p.z, p.heading)
    }
  }

  _blocks() {
    const s = this.s
    const bm = s.bm
    const pm = this.pm
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z) === type) return
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      bm.placeBlock(x, y, z, type, true)
      s._placed.set(bm._key(x, y, z), type)
    }
    bm._suppressUndoRecording = true
    const half = ROAD_W / 2
    for (let dx = -A - R - half - 2; dx <= A + R + half + 2; dx++) {
      for (let dz = -R - half - 2; dz <= R + half + 2; dz++) {
        const { s: along, off } = trackParam(dx + 0.5 + (pm.home.x - hx), dz + 0.5 + (pm.home.z - hz))
        if (off > half + 1) continue
        const x = hx + dx
        const z = hz + dz
        const line = along < 1 || along > L - 0.01
        put(x, KART_Y, z, off > half ? 'whiteconcrete' : line ? ((dx + dz) % 2 ? 'whiteconcrete' : 'blackconcrete') : 'grayconcrete')
        if (off > half) put(x, KART_Y + 1, z, (Math.floor(along / 2) % 2) ? 'redconcrete' : 'whiteconcrete')
      }
    }
    bm._suppressUndoRecording = false
    // The "?" boxes.
    const B = this.B
    for (const m of this._boxMeshes) m.removeFromParent()
    this._boxMeshes = []
    for (const at of BOX_AT) {
      for (const lane of LANES) {
        const p = this._w(trackPoint(at * L, lane))
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.8 * B, 0.8 * B, 0.8 * B), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }))
        m.position.set(p.x * B, (KART_Y + 1.7) * B, p.z * B)
        pm.arena.add(m)
        this._boxMeshes.push(m)
      }
    }
  }

  // The arena group is rebuilt (PartyMode._build): the boxes go with it.
  build() {
    this._builtFor = ''
    this._boxMeshes = []
    this._bananaMeshes = []
  }

  events(was) {
    const pm = this.pm
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      const i = Math.max(0, (this.order || []).indexOf(pm.myId))
      const g = this.grid(this.order ? i : Math.floor(Math.random() * 6))
      this.item = ''
      this.s.kart?.placeAt(g.x, KART_Y + 1, g.z, g.heading)
      this.s.bm._yaw = g.heading + Math.PI
    }
    const mine = this.prog.get(pm.myId)
    if (pm.phase === 'play' && mine && mine.laps !== this._myLaps) {
      if (this._myLaps !== undefined && mine.laps > this._myLaps) this.s._message(t(mine.laps === LAPS - 1 ? 'kartFinalLap' : 'kartLap', { n: mine.laps + 1, max: LAPS }), 2.5)
      this._myLaps = mine.laps
    }
  }

  startText() {
    return t('kartStart', { n: LAPS })
  }

  // My place in the race (1 = in front).
  place() {
    const v = (id) => {
      const pr = this.prog.get(id)
      return pr ? pr.laps * L + pr.s : 0
    }
    const mine = v(this.pm.myId)
    return 1 + [...this.prog.keys()].filter((id) => id !== this.pm.myId && v(id) > mine).length
  }

  hud() {
    const pm = this.pm
    const pr = this.prog.get(pm.myId)
    const lap = Math.min(LAPS, (pr?.laps || 0) + 1)
    return t('kartHud', { l: lap, n: LAPS, p: this.place(), all: Math.max(1, this.prog.size), item: this.item ? t(`kartItem_${this.item}`) : t('kartItemNone') })
  }

  protects(x, y, z) {
    const pm = this.pm
    if (!pm.home || y < KART_Y - 1 || y > KART_Y + 3) return false
    return Math.abs(x - pm.home.x) <= A + R + ROAD_W && Math.abs(z - pm.home.z) <= R + ROAD_W
  }

  snap() {
    const pr = {}
    for (const [id, p] of this.prog) pr[this.pm._out(id)] = p.laps * 10000 + Math.round(p.s)
    const tk = [...this.boxesTaken.keys()].reduce((m, i) => m | (1 << i), 0)
    return { pr, bn: this.bananas.flatMap((b) => [b.x, b.z]), tk }
  }

  apply(d) {
    if (d.pr && typeof d.pr === 'object') {
      this.prog = new Map(Object.entries(d.pr).filter(([, n]) => Number.isFinite(n)).map(([id, n]) => [id, { laps: Math.floor(n / 10000), s: n % 10000, cp: false }]))
    }
    if (Array.isArray(d.bn)) {
      this.bananas = []
      for (let i = 0; i + 1 < d.bn.length; i += 2) this.bananas.push({ x: d.bn[i], z: d.bn[i + 1] })
    }
    if (Number.isFinite(d.tk)) {
      this.boxesTaken = new Map()
      for (let i = 0; i < 9; i++) if (d.tk & (1 << i)) this.boxesTaken.set(i, BOX_BACK)
    }
  }

  dispose() {
    const k = this._kart()
    if (k) k.lockedIn = false
    for (const b of this.pm.bots.values()) b.kartMesh = null
  }
}
