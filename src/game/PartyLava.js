// Floor is Lava (2026-11-02, Gaymi's idea list 6: "the ground keeps
// turning into lava and you jump between safe blocks until one person is
// left" - a party mode, servers + bots like the others). Plugs into
// PartyMode (PartyModes.js) as its `ext`.
//
// A floor of GRID x GRID tiles (each TILE x TILE blocks) high in the sky
// (LAVA_Y) over a glowing sea of lava. Every so often (STEP_S, quicker as
// the round goes on, down to STEP_MIN) some tiles glow red (WARN_S), then
// melt away, and come back REGROW_S later; more melt each time. Fall
// through and you're out - you land on the viewing ledge beside the floor
// to watch. The last one standing wins (the clock running out is a tie).
// No shooting, no building on the floor.
//
// The floor is real blocks (BuildSurvival `_placed`, gone when the game
// ends), put in on every screen from the tiles' state in the host's sync.
// Meshes only (the lava), never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const LAVA_Y = 230
export const GRID = 9
export const TILE = 2
export const WARN_S = 1.5
export const STEP_S = 3.2
export const STEP_MIN = 1.3
export const REGROW_S = 5
const LEDGE_GAP = 6 // blocks between the floor's edge and the viewing ledge
const LEDGE_W = 5
const SIZE = GRID * TILE
const SOLID = ['polishedblackstone', 'blackstone']
const WARN = 'magmablock'

export class PartyLava {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.tiles = new Array(GRID * GRID).fill(0) // 0 solid, 1 glowing, 2 melted
    this.timers = new Array(GRID * GRID).fill(0)
    this._step = 2
    this._drawn = null
    this._ledgeFor = ''
    this._lava = null
  }

  get B() {
    return this.s.B
  }

  // The floor's north-west corner (blocks).
  _x0() {
    return Math.floor(this.pm.home.x) - SIZE / 2
  }

  _z0() {
    return Math.floor(this.pm.home.z) - SIZE / 2
  }

  home(me) {
    return { x: Math.round(me.x), y: LAVA_Y + 1, z: Math.round(me.z) }
  }

  // Tile i's middle (blocks).
  tileMid(i) {
    return { x: this._x0() + (i % GRID) * TILE + TILE / 2, z: this._z0() + Math.floor(i / GRID) * TILE + TILE / 2 }
  }

  // The tile at (x, z), or -1 off the floor.
  tileAt(x, z) {
    if (!this.pm.home) return -1
    const tx = Math.floor((x - this._x0()) / TILE)
    const tz = Math.floor((z - this._z0()) / TILE)
    if (tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) return -1
    return tz * GRID + tx
  }

  // Where out players stand: a ledge off the floor's east side.
  ledge() {
    return { x: this._x0() + SIZE + LEDGE_GAP + LEDGE_W / 2, y: LAVA_Y + 1, z: Math.floor(this.pm.home.z) }
  }

  begin() {
    this.tiles.fill(0)
    this.timers.fill(0)
    this._step = 2.5
    this._melts = 3
    // Everyone needs a moment to arrive on the floor (a guest's spot comes
    // in their next sync).
    this._grace = 3
  }

  placeBot(b) {
    const at = this.tileMid(Math.floor(Math.random() * GRID * GRID))
    b.x = b.tx = at.x + (Math.random() - 0.5)
    b.z = b.tz = at.z + (Math.random() - 0.5)
    b.y = b.ty = LAVA_Y + 1
    b.vy = 0
    b.react = 0
  }

  // --- the round (where it runs) ---

  run(people, dt) {
    const pm = this.pm
    this._grace -= dt
    // Anyone below the floor is out.
    for (const p of this._grace > 0 ? [] : people) {
      if (pm.out.has(p.id) || p.y > LAVA_Y - 1) continue
      pm.out.add(p.id)
      pm._say = { k: 'lavaOut', name: p.id }
      if (p.bot) this._toLedge(p.bot)
    }
    const alive = people.filter((p) => !pm.out.has(p.id))
    if (alive.length <= 1 && people.length > 1) return pm._end(alive[0]?.id || 'tie')
    if (!alive.length) return pm._end('tie')
    // The tiles: glowing ones melt, melted ones come back.
    for (let i = 0; i < this.tiles.length; i++) {
      if (!this.tiles[i]) continue
      this.timers[i] -= dt
      if (this.timers[i] > 0) continue
      if (this.tiles[i] === 1) {
        this.tiles[i] = 2
        this.timers[i] = REGROW_S
      } else this.tiles[i] = 0
    }
    this._step -= dt
    if (this._step > 0) return
    // Quicker and more of them as the round goes on.
    const into = 1 - pm.left / 240
    this._step = Math.max(STEP_MIN, STEP_S - into * 2.2)
    this._melts = Math.min(Math.floor(GRID * GRID * 0.55), 3 + Math.floor(into * 30))
    const solid = []
    for (let i = 0; i < this.tiles.length; i++) if (!this.tiles[i]) solid.push(i)
    solid.sort(() => Math.random() - 0.5)
    for (const i of solid.slice(0, Math.min(this._melts, solid.length - 4))) {
      this.tiles[i] = 1
      this.timers[i] = WARN_S
    }
  }

  timeUp() {
    this.pm._end('tie')
  }

  // A bot: off a glowing or melted tile to the nearest safe one (after a
  // moment to notice - sometimes too late).
  botGoal(b) {
    const pm = this.pm
    if (pm.out.has(b.id)) {
      const l = this.ledge()
      return Math.hypot(l.x - b.x, l.z - b.z) > 1.5 ? l : { x: b.x, z: b.z, stay: true }
    }
    const here = this.tileAt(b.x, b.z)
    const safe = here >= 0 && this.tiles[here] === 0
    if (safe) {
      b.react = 0.3 + Math.random() * 0.7
      const m = this.tileMid(here)
      return Math.hypot(m.x - b.x, m.z - b.z) > 0.5 ? m : { x: b.x, z: b.z, stay: true }
    }
    if ((b.react -= pm._dt || 0) > 0) return { x: b.x, z: b.z, stay: true }
    let best = null
    let bestD = Infinity
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i]) continue
      const m = this.tileMid(i)
      const d = Math.hypot(m.x - b.x, m.z - b.z)
      if (d < bestD) {
        bestD = d
        best = m
      }
    }
    return best
  }

  _toLedge(b) {
    const l = this.ledge()
    b.x = b.tx = l.x + (Math.random() - 0.5) * 2
    b.z = b.tz = l.z + (Math.random() - 0.5) * 3
    b.y = b.ty = l.y
    b.vy = 0
  }

  markColor(id) {
    return this.pm.out.has(id) ? 0x777777 : null
  }

  // --- every screen ---

  // The floor's blocks follow the tiles; the ledge goes in once.
  draw() {
    const pm = this.pm
    if (!pm.home) return
    const s = this.s
    const bm = s.bm
    const key = `${pm.home.x},${pm.home.z}`
    bm._suppressUndoRecording = true
    if (this._ledgeFor !== key) {
      this._ledgeFor = key
      this._drawn = null
      const l = this.ledge()
      for (let x = Math.floor(l.x - LEDGE_W / 2); x < l.x + LEDGE_W / 2; x++) {
        for (let z = Math.floor(l.z - LEDGE_W); z <= l.z + LEDGE_W; z++) this._put(x, LAVA_Y, z, 'polishedtuff')
      }
    }
    for (let i = 0; i < this.tiles.length; i++) {
      const st = this.tiles[i]
      if (this._drawn && this._drawn[i] === st) continue
      const x0 = this._x0() + (i % GRID) * TILE
      const z0 = this._z0() + Math.floor(i / GRID) * TILE
      const checker = ((i % GRID) + Math.floor(i / GRID)) % 2
      for (let x = x0; x < x0 + TILE; x++) {
        for (let z = z0; z < z0 + TILE; z++) {
          if (st === 2) this._take(x, LAVA_Y, z)
          else this._put(x, LAVA_Y, z, st === 1 ? WARN : SOLID[checker])
        }
      }
    }
    bm._suppressUndoRecording = false
    this._drawn = [...this.tiles]
    // The lava glows and rolls.
    if (this._lava) {
      const k = performance.now() / 1000
      this._lava.material.color.setHSL(0.04 + Math.sin(k * 1.5) * 0.015, 1, 0.5 + Math.sin(k * 2.3) * 0.05)
    }
    this._keepMe()
  }

  _put(x, y, z, type) {
    const s = this.s
    const bm = s.bm
    if (bm.getBlockAt(x, y, z) === type) return
    if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
    bm.placeBlock(x, y, z, type, true)
    s._placed.set(bm._key(x, y, z), type)
  }

  _take(x, y, z) {
    const s = this.s
    const bm = s.bm
    if (!bm.getBlockAt(x, y, z)) return
    bm.removeBlock(x, y, z)
    s._placed.delete(bm._key(x, y, z))
  }

  // Fell through: up onto the ledge (before the long fall ends).
  _keepMe() {
    const pm = this.pm
    const tm = this.s.bm.tryMode
    if (!tm?.active || pm.phase === 'wait') return
    if (tm.pos.y > LAVA_Y - 3) return
    if (tm.pos.y < LAVA_Y - 60) return
    const l = this.ledge()
    this._tp(l.x, l.z)
    this.s._fx?.confetti?.(l.x * this.B, (LAVA_Y + 2) * this.B, l.z * this.B)
  }

  _tp(x, z) {
    const s = this.s
    const tm = s.bm.tryMode
    tm.pos.set(x, LAVA_Y + 1, z)
    tm.vel?.set(0, 0, 0)
    s.bm.camera.position.set(x * this.B, (LAVA_Y + 1 + 1.62) * this.B, z * this.B)
  }

  // The lava sea under the floor.
  build() {
    const B = this.B
    const pm = this.pm
    const sea = new THREE.Mesh(new THREE.BoxGeometry((SIZE + LEDGE_GAP * 2 + LEDGE_W * 2) * B, 0.2 * B, (SIZE + 12) * B), new THREE.MeshBasicMaterial({ color: 0xff5a1a }))
    sea.position.set((this._x0() + SIZE / 2 + LEDGE_GAP / 2) * B, (LAVA_Y - 4) * B, (this._z0() + SIZE / 2) * B)
    pm.arena.add(sea)
    this._lava = sea
  }

  events(was) {
    const pm = this.pm
    const s = this.s
    // A new round: everyone onto a tile.
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      const i = Math.floor(Math.random() * GRID * GRID)
      const m = this.tileMid(i)
      this._tp(m.x, m.z)
    }
    if (pm.phase !== 'play') return
    for (const id of pm.out) {
      if (was.out.has(id)) continue
      try { audioEngine.playSpecial?.('thud') } catch { /* no audio */ }
      if (id === pm.myId) s._message(t('lavaYouOut'), 4)
    }
  }

  startText() {
    return t('lavaStart')
  }

  hud() {
    const pm = this.pm
    const left = pm._people().filter((p) => !pm.out.has(p.id)).length
    return `${t('lavaHud', { n: left })}${pm.out.has(pm.myId) ? ` · ${t('partyPotatoOutTag')}` : ''}`
  }

  shoot() {
    return false
  }

  // No building on (or bridging over) the floor or the ledge.
  protects(x, y, z) {
    const pm = this.pm
    if (!pm.home || y < LAVA_Y - 2 || y > LAVA_Y + 8) return false
    return x >= this._x0() - 2 && x <= this._x0() + SIZE + LEDGE_GAP + LEDGE_W + 2 && z >= this._z0() - 2 && z <= this._z0() + SIZE + 2
  }

  snap() {
    return { tl: this.tiles.join('') }
  }

  apply(d) {
    if (typeof d.tl !== 'string' || d.tl.length !== GRID * GRID || !/^[012]+$/.test(d.tl)) return
    for (let i = 0; i < this.tiles.length; i++) this.tiles[i] = Number(d.tl[i])
  }

  dispose() {
    this._lava = null
  }
}
