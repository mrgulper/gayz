// Musical Chairs (2026-11-06, Gaymi's idea list 8: "silly and great with
// friends. These use the party-mode system GayZ already has"). A party
// mode, servers + bots. Plugs into PartyMode (PartyModes.js) as its `ext`.
//
// A round floor in the sky (MC_Y) with a ring of chairs - one fewer than
// the players still in. The music plays for MUSIC_S seconds (a random
// stretch, so nobody knows when): walk round the ring. When it stops,
// everyone has GRAB_S seconds to get to a free chair - stand on it to sit
// (first one there gets it; sitting early does nothing). Whoever is left
// without a chair is out (PartyMode `out`, they watch). A chair goes and
// the music starts again. The last one in wins.
// Bots notice the music stopping after a short moment (BOT_REACT).
// Real blocks for the floor (BuildSurvival `_placed`), meshes for the
// chairs. Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const MC_Y = 220
export const MUSIC_S = [6, 12]
export const GRAB_S = 5
export const SIT_R = 0.9
const RING_R = 5
const FLOOR_R = 10
const BOT_REACT = [0.3, 1.4]

export class PartyChairs {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.sub = 'music'
    this.subLeft = MUSIC_S[0]
    this.n = 0 // chairs this round
    this.seat = new Map() // chair index -> who sits on it
    this._builtFor = ''
    this._chairs = []
    this._noteIn = 0
  }

  get B() {
    return this.s.B
  }

  home(me) {
    return { x: Math.round(me.x), y: MC_Y + 1, z: Math.round(me.z) }
  }

  // Chair i's spot (blocks).
  chair(i) {
    const h = this.pm.home
    const a = (i / Math.max(1, this.n)) * Math.PI * 2
    return { x: h.x + 0.5 + Math.cos(a) * RING_R, z: h.z + 0.5 + Math.sin(a) * RING_R }
  }

  _alive(people) {
    return people.filter((p) => !this.pm.out.has(p.id))
  }

  begin(people) {
    this._newRound(people.length)
  }

  _newRound(alive) {
    this.n = Math.max(1, alive - 1)
    this.sub = 'music'
    this.subLeft = MUSIC_S[0] + Math.random() * (MUSIC_S[1] - MUSIC_S[0])
    this.seat.clear()
  }

  placeBot(b) {
    const h = this.pm.home
    const a = Math.random() * Math.PI * 2
    b.x = b.tx = h.x + 0.5 + Math.cos(a) * (RING_R + 1.5)
    b.z = b.tz = h.z + 0.5 + Math.sin(a) * (RING_R + 1.5)
    b.y = b.ty = MC_Y + 1
    b.vy = 0
  }

  // Who's on which chair (where the round runs).
  sit(id, i) {
    if (this.sub !== 'grab' || this.pm.out.has(id) || this.seat.has(i) || [...this.seat.values()].includes(id)) return false
    this.seat.set(i, id)
    return true
  }

  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    const alive = this._alive(people)
    if (alive.length <= 1) return pm._end(alive[0]?.id || 'tie')
    this.subLeft -= dt
    if (this.sub === 'music') {
      if (this.subLeft <= 0) {
        this.sub = 'grab'
        this.subLeft = GRAB_S
        pm._say = { k: 'chairsStop' }
        for (const p of alive) if (p.bot) p.bot.react = BOT_REACT[0] + Math.random() * (BOT_REACT[1] - BOT_REACT[0])
      }
      return
    }
    for (const p of alive) {
      for (let i = 0; i < this.n; i++) {
        const c = this.chair(i)
        if (Math.hypot(p.x - c.x, p.z - c.z) < SIT_R && Math.abs(p.y - (MC_Y + 1)) < 1.5) this.sit(p.id, i)
      }
    }
    if (this.seat.size >= this.n || this.subLeft <= 0) {
      const sat = new Set(this.seat.values())
      const lost = alive.filter((p) => !sat.has(p.id))
      for (const p of lost) pm.out.add(p.id)
      if (lost.length === 1) pm._say = { k: 'chairsOut', name: lost[0].id }
      const left = alive.length - lost.length
      if (left <= 1) return pm._end(alive.find((p) => sat.has(p.id))?.id || 'tie')
      this._newRound(left)
    }
  }

  timeUp() {
    this.pm._end('tie')
  }

  botGoal(b) {
    const pm = this.pm
    if (pm.out.has(b.id)) return { x: b.x, z: b.z, stay: true }
    const h = pm.home
    const mine = [...this.seat].find(([, id]) => id === b.id)
    if (mine) {
      const c = this.chair(mine[0])
      return { x: c.x, z: c.z, stay: true }
    }
    if (this.sub === 'grab') {
      if ((b.react = (b.react || 0) - (pm._dt || 0.016)) > 0) return { x: b.x, z: b.z, stay: true }
      let best = null
      let bestD = Infinity
      for (let i = 0; i < this.n; i++) {
        if (this.seat.has(i)) continue
        const c = this.chair(i)
        const d = Math.hypot(c.x - b.x, c.z - b.z)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      return best
    }
    // The music's on: walk round the ring.
    const a = Math.atan2(b.z - h.z - 0.5, b.x - h.x - 0.5) + 0.5
    return { x: h.x + 0.5 + Math.cos(a) * (RING_R + 1.5), z: h.z + 0.5 + Math.sin(a) * (RING_R + 1.5) }
  }

  // Out: no moving. Sitting: stay put.
  speed() {
    const pm = this.pm
    if (pm.phase !== 'play') return 1
    if (pm.out.has(pm.myId) || [...this.seat.values()].includes(pm.myId)) return 0
    return 1
  }

  markColor() {
    return null
  }

  shoot() {
    return false
  }

  events(was) {
    const pm = this.pm
    const s = this.s
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      const tm = s.bm.tryMode
      const h = pm.home
      tm.pos.set(h.x + 0.5 + RING_R + 1.5, MC_Y + 1, h.z + 0.5)
      tm.vel?.set(0, 0, 0)
      this._sub = ''
    }
    const key = pm.phase === 'play' ? `${this.sub}${this.n}` : ''
    if (key !== this._sub) {
      if (pm.phase === 'play' && this.sub === 'music') s._message(t('chairsMusic', { n: this.n }), 3)
      if (pm.phase === 'play' && this.sub === 'grab' && !pm.out.has(pm.myId)) {
        s._message(t('chairsGrab', { n: GRAB_S }), 3)
        try { audioEngine.playSpecial?.('scratch') } catch { /* no audio */ }
      }
      this._sub = key
    }
    if (pm.phase === 'play' && pm.out.has(pm.myId) && !this._wasOut) s._message(t('chairsYouOut'), 3)
    this._wasOut = pm.phase === 'play' && pm.out.has(pm.myId)
    // Sitting early: a nudge.
    if (pm.phase === 'play' && this.sub === 'music' && !pm.out.has(pm.myId)) {
      const me = s.bodyPos()
      for (let i = 0; i < this.n; i++) {
        const c = this.chair(i)
        if (Math.hypot(me.x - c.x, me.z - c.z) < SIT_R && performance.now() - (this._nudged || 0) > 4000) {
          this._nudged = performance.now()
          s._message(t('chairsTooEarly'), 2)
        }
      }
    }
  }

  draw(dt = 1 / 60) {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor !== key) {
      this._builtFor = key
      this._blocks()
    }
    // The music: a little tune now and then while it plays.
    if (pm.phase === 'play' && this.sub === 'music') {
      this._noteIn -= dt
      if (this._noteIn <= 0) {
        this._noteIn = 0.9
        try { audioEngine.playSpecial?.('tune', audioEngine.musicGain || undefined) } catch { /* no audio */ }
      }
    }
    const want = pm.phase === 'play' ? this.n : 0
    while (this._chairs.length < want) this._chairs.push(this._makeChair())
    const B = this.B
    this._chairs.forEach((c, i) => {
      c.visible = i < want
      if (!c.visible) return
      const p = this.chair(i)
      c.position.set(p.x * B, (MC_Y + 1) * B, p.z * B)
      c.rotation.y = -Math.atan2(p.z - pm.home.z - 0.5, p.x - pm.home.x - 0.5) - Math.PI / 2
      c.userData.seat.material.color.set(this.seat.has(i) ? 0x5fd35f : 0xd8452a)
    })
  }

  _makeChair() {
    const B = this.B
    const g = new THREE.Group()
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a2a })
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8 * B, 0.12 * B, 0.8 * B), new THREE.MeshLambertMaterial({ color: 0xd8452a }))
    seat.position.y = 0.5 * B
    g.add(seat)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.8 * B, 0.8 * B, 0.1 * B), wood)
    back.position.set(0, 0.95 * B, -0.35 * B)
    g.add(back)
    for (const [x, z] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1 * B, 0.5 * B, 0.1 * B), wood)
      leg.position.set(x * B, 0.25 * B, z * B)
      g.add(leg)
    }
    g.userData.seat = seat
    this.pm.arena.add(g)
    return g
  }

  _blocks() {
    const s = this.s
    const bm = s.bm
    const h = this.pm.home
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z) === type) return
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      bm.placeBlock(x, y, z, type, true)
      s._placed.set(bm._key(x, y, z), type)
    }
    bm._suppressUndoRecording = true
    for (let x = -FLOOR_R - 1; x <= FLOOR_R + 1; x++) {
      for (let z = -FLOOR_R - 1; z <= FLOOR_R + 1; z++) {
        const d = Math.hypot(x, z)
        if (d > FLOOR_R + 1.5) continue
        put(h.x + x, MC_Y, h.z + z, (Math.abs(d - RING_R) < 0.8) ? 'yellowconcrete' : (x + z) % 2 ? 'whiteconcrete' : 'pinkconcrete')
        if (d > FLOOR_R + 0.5) put(h.x + x, MC_Y + 1, h.z + z, 'oakfence')
      }
    }
    bm._suppressUndoRecording = false
  }

  startText() {
    return t('chairsStart', { n: GRAB_S })
  }

  hud() {
    const pm = this.pm
    const alive = this._alive(pm._people()).length
    let mid = t(this.sub === 'music' ? 'chairsHudMusic' : 'chairsHudGrab', { n: this.n, p: alive })
    if (pm.out.has(pm.myId)) mid += ` · ${t('chairsOutTag')}`
    return mid
  }

  protects(x, y, z) {
    const h = this.pm.home
    if (!h || y < MC_Y - 1 || y > MC_Y + 3) return false
    return Math.hypot(x - h.x, z - h.z) <= FLOOR_R + 2
  }

  snap() {
    const seat = {}
    for (const [i, id] of this.seat) seat[i] = this.pm._out(id)
    return { cs: this.sub, cn: this.n, cl: +this.subLeft.toFixed(1), se: seat }
  }

  apply(d) {
    this.sub = d.cs === 'grab' ? 'grab' : 'music'
    this.n = Math.max(1, Math.min(32, Math.floor(Number(d.cn) || 1)))
    this.subLeft = Number(d.cl) || 0
    this.seat = new Map()
    for (const [i, id] of Object.entries(d.se || {})) if (typeof id === 'string') this.seat.set(Number(i), id)
  }

  dispose() {
    for (const c of this._chairs) {
      c.removeFromParent()
      c.traverse((o) => {
        if (!o.isMesh) return
        o.geometry.dispose()
        o.material.dispose()
      })
    }
    this._chairs = []
  }
}
