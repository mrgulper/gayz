// The Zombie Theme Park (2026-11-06, Gaymi's idea list 7: "a rollercoaster
// you can ride, a Ferris wheel and carnival games, all overrun by zombies"
// - Gaymi picked "inside the Open World"). Owned by BuildSurvival
// (`s.park`), in the open world, in your own games (not a server guest's).
//
// - The park stands at one spot in each world (spot(): picked from the
//   world's seed, PARK_DIST blocks out from the middle, on dry land). Come
//   within HEAR_R and you hear about it; within BUILD_R it's put up: a
//   fenced plaza SIZE x SIZE of coloured paths (real blocks, put back when
//   the game ends - TempBlocks.js) with its rides on it, built from meshes.
// - Ferris Wheel: 8 cabins on a turning wheel. Press Use at the bottom to
//   climb into a cabin and ride one turn (FERRIS_S seconds), high over
//   the park.
// - Rollercoaster: a track looping round the plaza over two big hills.
//   Press Use at the station to ride one lap - slow up the hills, fast
//   down them.
// - Whack-a-Zombie: a booth where zombie heads pop up out of 6 holes. Press
//   Use to play for GAME_S seconds and shoot as many as you can - every
//   head is TICKET_COINS coins.
// - It's overrun: while you're in it, clown zombies in party hats keep
//   climbing over the fence (up to PARK_ZOMBIES at a time).
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { sampleLand, inCity, worldSeed } from './OpenWorld.js'
import { TempBlocks } from './TempBlocks.js'
import { makeLabel } from './CampTrophies.js'

export const SIZE = 30
export const PARK_DIST = 220
export const FERRIS_S = 30
export const COASTER_LAP = 1
export const GAME_S = 20
export const TICKET_COINS = 4
export const PARK_ZOMBIES = 6
const HEAR_R = 150
const BUILD_R = 64
const DROP_R = 170
const CABINS = 8
const WHEEL_R = 7
const HOLES = 6
const POP_GAP = 0.55
const UP_S = 1.1
const SPAWN_EVERY = 6
const USE_R = 2.6
const HALF = SIZE / 2
// Where things stand from the middle (blocks).
const FERRIS = { x: -8, z: 6 }
const BOOTH = { x: 6, z: -6 }
const TRACK_R = 12
const HAT_COLORS = [0xff4a4a, 0x4ab0ff, 0xffd23f, 0x6be06b, 0xd070ff]

export class ThemePark {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.park = null // { x, y, z } middle and floor
    this._spot = null
    this._spotSeed = null
    this.ride = null // { kind: 'ferris' | 'coaster', t, u, v }
    this.game = null // { left, hits, heads: [{ up, t }] }
    this.wheelAngle = 0
    this.cartU = 0
    this._heard = false
    this._spawnT = SPAWN_EVERY
    this.zombies = []
  }

  get B() {
    return this.s.B
  }

  _allowed() {
    const s = this.s
    return !!s.bm.world?.active && !(s.net && !s.net.isHost) && !s.td && !s.escape && !s.party && !s.moon?.on && !s.time?.away
  }

  // This world's park spot: { x, z } (whole blocks), or null.
  spot() {
    const seed = worldSeed()
    if (this._spotSeed === seed) return this._spot
    this._spotSeed = seed
    this._spot = null
    const a0 = ((seed % 3600) / 3600) * Math.PI * 2
    for (let k = 0; k < 36 && !this._spot; k++) {
      for (const r of [PARK_DIST, PARK_DIST + 60, PARK_DIST - 60]) {
        const a = a0 + k * 0.35
        const x = Math.round(Math.cos(a) * r)
        const z = Math.round(Math.sin(a) * r)
        if (this._dryFlat(x, z)) {
          this._spot = { x, z }
          break
        }
      }
    }
    return this._spot
  }

  _dryFlat(x, z) {
    let lo = Infinity
    let hi = -Infinity
    for (const [dx, dz] of [[0, 0], [-HALF, -HALF], [HALF, -HALF], [-HALF, HALF], [HALF, HALF], [0, HALF], [0, -HALF]]) {
      if (inCity(x + dx, z + dz)) return false
      const l = sampleLand(x + dx, z + dz)
      if (!l || l.river || /cean|river|beach/i.test(l.biome || '') || l.h < (l.w ?? -Infinity)) return false
      lo = Math.min(lo, l.h)
      hi = Math.max(hi, l.h)
    }
    return hi - lo <= 6
  }

  update(dt) {
    const s = this.s
    if (!this._allowed()) {
      if (this.ride) this._getOff()
      return
    }
    const sp = this.spot()
    if (!sp) return
    const me = s.bodyPos()
    const d = Math.hypot(me.x - sp.x, me.z - sp.z)
    if (!this._heard && d < HEAR_R) {
      this._heard = true
      s._message(t('parkHear'), 5)
    }
    if (!this.park && d < BUILD_R) this._tryBuild(sp)
    if (this.park && d > DROP_R && !this.ride) {
      this.clear()
      return
    }
    if (!this.park) return
    // The rides turn whether anyone's on them or not.
    if (!this.ride || this.ride.kind !== 'ferris') this.wheelAngle = (this.wheelAngle + (dt / FERRIS_S) * Math.PI * 2) % (Math.PI * 2)
    if (this.ride) this._rideStep(dt)
    else this.cartU = 0
    if (this.game) this._gameStep(dt)
    this._draw()
    this._overrun(dt, me)
    this._prompt(me)
  }

  _tryBuild(sp) {
    const s = this.s
    // The floor: the middle of what's under it (when the land's loaded).
    const ys = []
    for (const [dx, dz] of [[0, 0], [-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      const top = s.bodyPos().y + 40
      const g = s._groundUnder(sp.x + dx + 0.5, top, sp.z + dz + 0.5)
      if (g === top) return false
      ys.push(g)
    }
    ys.sort((a, b) => a - b)
    this.build(sp.x, ys[2], sp.z)
    s._message(t('parkWelcome'), 5)
    try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
    return true
  }

  // x, z: the middle; y: the plaza's floor (the first air cell).
  build(x, y, z) {
    const s = this.s
    const bm = s.bm
    const undo = bm._suppressUndoRecording
    bm._suppressUndoRecording = true
    for (let dx = -HALF; dx < HALF; dx++) for (let dz = -HALF; dz < HALF; dz++) {
      const wx = x + dx
      const wz = z + dz
      // A foundation down to the ground, the paths, clear air above.
      for (let k = 2; k <= 8; k++) {
        if (bm.getBlockAt(wx, y - k, wz)) break
        this.cells.put(wx, y - k, wz, 'stonebricks')
      }
      const edge = dx === -HALF || dx === HALF - 1 || dz === -HALF || dz === HALF - 1
      const ring = Math.abs(Math.hypot(dx + 0.5, dz + 0.5) - TRACK_R) < 1
      const path = Math.abs(dx + 0.5) < 1.6 || ring
      this.cells.put(wx, y - 1, wz, edge ? 'stonebricks' : path ? 'yellowconcrete' : (Math.floor(dx / 3) + Math.floor(dz / 3)) % 2 ? 'whiteconcrete' : 'lightblueconcrete')
      for (let k = 0; k <= 12; k++) this.cells.clear(wx, y + k, wz)
      // The fence, with the gate in the middle of the -z side.
      if (edge && !(dz === -HALF && Math.abs(dx + 0.5) < 2.6)) this.cells.put(wx, y, wz, 'oakfence')
    }
    // Gate posts.
    for (const dx of [-3, 2]) for (let k = 0; k < 4; k++) this.cells.put(x + dx, y + k, z - HALF, k === 3 ? 'glowstone' : 'redconcrete')
    bm._suppressUndoRecording = undo
    this.park = { x: x + 0.5, y, z: z + 0.5 }
    this._meshes()
  }

  // --- the rides (meshes) ---

  _meshes() {
    const B = this.B
    const p = this.park
    const g = new THREE.Group()
    g.position.set(p.x * B, p.y * B, p.z * B)
    const box = (w, h, d, color, x, y, z, parent = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
      m.position.set(x * B, y * B, z * B)
      parent.add(m)
      return m
    }
    // The sign over the gate.
    const sign = makeLabel(t('parkSign'), 512, 56, '#ffd23f')
    sign.scale.set(6 * B, 0.9 * B, 1)
    sign.position.set(0, 4.6 * B, -HALF * B)
    g.add(sign)
    // Ferris wheel: two legs either side of a hub, a ring of spokes, cabins.
    const hubY = WHEEL_R + 1.6
    for (const sx of [-1.2, 1.2]) {
      for (const sz of [-1, 1]) {
        const leg = box(0.3, hubY + 0.6, 0.3, 0xdddddd, FERRIS.x + sx, hubY / 2, FERRIS.z + sz * 2.2)
        leg.rotation.x = -sz * Math.atan2(2.2, hubY)
      }
    }
    const wheel = new THREE.Group()
    wheel.position.set(FERRIS.x * B, hubY * B, FERRIS.z * B)
    g.add(wheel)
    for (let i = 0; i < CABINS; i++) {
      const spoke = box(0.12, WHEEL_R, 0.12, 0xe8e8e8, 0, 0, 0, wheel)
      spoke.geometry.translate(0, (WHEEL_R / 2) * B, 0)
      spoke.position.set(0, 0, 0)
      spoke.rotation.x = (i / CABINS) * Math.PI * 2
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R * B, 0.1 * B, 6, 48), new THREE.MeshLambertMaterial({ color: 0xff5a8a }))
    rim.rotation.y = Math.PI / 2
    wheel.add(rim)
    this._wheel = wheel
    this._cabins = []
    for (let i = 0; i < CABINS; i++) {
      const c = new THREE.Group()
      box(1.1, 0.9, 1.1, HAT_COLORS[i % HAT_COLORS.length], 0, -0.45, 0, c)
      box(1.2, 0.12, 1.2, 0xffffff, 0, 0.05, 0, c)
      g.add(c)
      this._cabins.push(c)
    }
    // The rollercoaster: a ring of track over two hills, posts under it.
    const N = 120
    this._track = []
    for (let i = 0; i < N; i++) this._track.push(this.trackPoint(i / N))
    for (let i = 0; i < N; i++) {
      const a = this._track[i]
      const b = this._track[(i + 1) % N]
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
      const seg = box(0.9, 0.14, len + 0.05, 0x8a3a2a, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
      seg.lookAt(new THREE.Vector3(b.x * B + g.position.x, b.y * B + g.position.y, b.z * B + g.position.z))
      if (i % 6 === 0) box(0.18, a.y, 0.18, 0xcccccc, a.x, a.y / 2, a.z)
    }
    this._cart = new THREE.Group()
    box(1, 0.6, 1.4, 0xd8352a, 0, 0.3, 0, this._cart)
    box(1.05, 0.12, 0.2, 0xffd23f, 0, 0.66, 0.6, this._cart)
    g.add(this._cart)
    // The station.
    const st = this.trackPoint(0)
    box(2.2, 0.2, 3, 0x7a4f2a, st.x + 1.6, 0.1, st.z)
    // Whack-a-Zombie: a counter, a back board with holes, heads.
    box(4.4, 1, 0.6, 0x7a4f2a, BOOTH.x, 0.5, BOOTH.z)
    box(4.4, 3, 0.2, 0xd8352a, BOOTH.x, 1.5, BOOTH.z + 1.6)
    for (const sx of [-2.1, 2.1]) box(0.2, 3.4, 2.2, 0xffd23f, BOOTH.x + sx, 1.7, BOOTH.z + 0.6)
    box(4.6, 0.25, 2.4, 0xffffff, BOOTH.x, 3.4, BOOTH.z + 0.6)
    const bsign = makeLabel(t('parkWhack'), 512, 40, '#ffffff')
    bsign.scale.set(3.6 * B, 0.5 * B, 1)
    bsign.position.set(BOOTH.x * B, 3.9 * B, (BOOTH.z + 0.4) * B)
    g.add(bsign)
    this._heads = []
    for (let i = 0; i < HOLES; i++) {
      const hx = BOOTH.x + ((i % 3) - 1) * 1.3
      const hy = 1.4 + Math.floor(i / 3) * 1.1
      box(0.7, 0.7, 0.05, 0x1a1a1a, hx, hy, BOOTH.z + 1.48)
      const head = box(0.55, 0.55, 0.55, 0x5f9a52, hx, hy, BOOTH.z + 1.2)
      const eyes = box(0.4, 0.1, 0.02, 0x111111, 0, 0.08, -0.28, head)
      eyes.position.set(0, 0.08 * B, -0.28 * B)
      head.visible = false
      this._heads.push({ mesh: head, x: hx, y: hy, z: BOOTH.z + 1.2 })
    }
    this._group = g
    this.s.bm.scene.add(g)
  }

  // A point on the track, u in [0, 1): a ring round the plaza over two
  // hills; u = 0 is the station (low).
  trackPoint(u) {
    const a = u * Math.PI * 2
    const y = 1.2 + 3.6 * (1 - Math.cos(a * 2))
    return { x: Math.cos(a) * TRACK_R, y, z: Math.sin(a) * TRACK_R }
  }

  // Cabin i's spot (park frame).
  _cabin(i, angle = this.wheelAngle) {
    const th = angle + (i / CABINS) * Math.PI * 2
    // The same way round as the spokes (wheel.rotation.x).
    return { x: FERRIS.x, y: WHEEL_R + 1.6 - Math.cos(th) * WHEEL_R, z: FERRIS.z - Math.sin(th) * WHEEL_R }
  }

  _draw() {
    const B = this.B
    if (!this._group) return
    this._wheel.rotation.x = this.wheelAngle
    this._cabins.forEach((c, i) => {
      const p = this._cabin(i)
      c.position.set(p.x * B, p.y * B, p.z * B)
    })
    const cp = this.trackPoint(this.cartU)
    const ahead = this.trackPoint((this.cartU + 0.01) % 1)
    this._cart.position.set(cp.x * B, cp.y * B, cp.z * B)
    this._cart.lookAt(new THREE.Vector3(ahead.x * B + this._group.position.x, ahead.y * B + this._group.position.y, ahead.z * B + this._group.position.z))
    for (const h of this._heads) h.mesh.visible = !!h.up
  }

  // --- riding ---

  // The Use key (BuildMode._tryUseFromCamera). -> true if it was the park.
  use() {
    const s = this.s
    if (!this.park || this.ride || s.dead || s.spectating) return false
    const me = this._local(s.bodyPos())
    const bottom = this._cabin(0, 0)
    const station = this.trackPoint(0)
    if (Math.hypot(me.x - bottom.x, me.z - bottom.z) < USE_R + 1 && me.y < 3) {
      this.wheelAngle = 0
      this.ride = { kind: 'ferris', t: 0 }
      s._message(t('parkFerrisOn'), 3)
      return true
    }
    if (Math.hypot(me.x - (station.x + 1.6), me.z - station.z) < USE_R && me.y < 3) {
      this.ride = { kind: 'coaster', u: 0, v: 4 }
      s._message(t('parkCoasterOn'), 3)
      try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
      return true
    }
    if (!this.game && Math.hypot(me.x - BOOTH.x, me.z - (BOOTH.z - 1.6)) < USE_R) {
      this.game = { left: GAME_S, hits: 0, next: 0.4 }
      for (const h of this._heads) h.up = 0
      s._message(t('parkWhackStart', { n: GAME_S }), 3)
      return true
    }
    return false
  }

  _local(p) {
    return { x: p.x - this.park.x, y: p.y - this.park.y, z: p.z - this.park.z }
  }

  _rideStep(dt) {
    const s = this.s
    const r = this.ride
    if (s.dead || !s.active) return this._getOff()
    const p = this.park
    let at
    if (r.kind === 'ferris') {
      r.t += dt
      this.wheelAngle = Math.min(1, r.t / FERRIS_S) * Math.PI * 2
      at = this._cabin(0)
      at.y -= 0.85
      if (r.t >= FERRIS_S) return this._getOff()
    } else {
      // Slow up the hills, fast down them.
      const here = this.trackPoint(r.u)
      const top = 1.2 + 7.2
      r.v += ((top - here.y) * 1.6 + 4 - r.v) * Math.min(1, dt * 2)
      r.u += (Math.max(3, r.v) * dt) / (Math.PI * 2 * TRACK_R)
      this.cartU = r.u % 1
      at = this.trackPoint(this.cartU)
      at.y += 0.25
      if (r.u >= COASTER_LAP) return this._getOff()
    }
    s._ride = { x: p.x + at.x, y: p.y + at.y, z: p.z + at.z, eye: 1.1 }
  }

  _getOff() {
    const s = this.s
    const r = this.ride
    this.ride = null
    this.cartU = 0
    s._ride = null
    if (!r || !this.park) return
    const p = this.park
    const off = r.kind === 'ferris' ? { x: FERRIS.x + 2.5, z: FERRIS.z - WHEEL_R + 0.5 } : { x: this.trackPoint(0).x + 1.6, z: this.trackPoint(0).z - 2 }
    s.bm.tryMode.pos.set(p.x + off.x, p.y, p.z + off.z)
    s.bm.tryMode.vel?.set(0, 0, 0)
    s._message(t('parkRideOver'), 2)
  }

  // --- Whack-a-Zombie ---

  _gameStep(dt) {
    const g = this.game
    g.left -= dt
    for (const h of this._heads) {
      if (h.up > 0) {
        h.up -= dt
        if (h.up < 0) h.up = 0
      }
    }
    g.next -= dt
    if (g.next <= 0 && g.left > 0.5) {
      g.next = POP_GAP * (0.6 + Math.random() * 0.8)
      const down = this._heads.filter((h) => !h.up)
      if (down.length) down[Math.floor(Math.random() * down.length)].up = UP_S
    }
    if (g.left <= 0) {
      const s = this.s
      const n = g.hits * TICKET_COINS
      s.coins = (s.coins || 0) + n
      s._renderHud?.()
      s._message(t('parkWhackOver', { h: g.hits, n }), 5)
      for (const h of this._heads) h.up = 0
      this.game = null
      try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    }
  }

  // My shot (BuildSurvival.shoot): a popped-up head? -> true if hit.
  shoot(ray) {
    if (!this.game || !this.park) return false
    const B = this.B
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    const p = this.park
    for (const h of this._heads) {
      if (!h.up) continue
      const cx = (p.x + h.x) * B
      const cy = (p.y + h.y) * B
      const cz = (p.z + h.z) * B
      box.min.set(cx - 0.32 * B, cy - 0.32 * B, cz - 0.32 * B)
      box.max.set(cx + 0.32 * B, cy + 0.32 * B, cz + 0.32 * B)
      if (!ray.intersectBox(box, hit)) continue
      h.up = 0
      this.game.hits++
      this.s._fx?.confetti?.(cx, cy, cz)
      try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
      return true
    }
    return false
  }

  // --- overrun ---

  inside(p) {
    const k = this.park
    return !!k && Math.abs(p.x - k.x) < HALF + 2 && Math.abs(p.z - k.z) < HALF + 2 && Math.abs(p.y - k.y) < 20
  }

  _overrun(dt, me) {
    const s = this.s
    if (s.cfg?.noZombies || !this.inside(me)) return
    this.zombies = this.zombies.filter((zb) => zb.health > 0 && s.zombies.includes(zb))
    this._spawnT -= dt
    if (this._spawnT > 0 || this.zombies.length >= PARK_ZOMBIES) return
    this._spawnT = SPAWN_EVERY
    const side = Math.floor(Math.random() * 4)
    const along = (Math.random() - 0.5) * (SIZE - 4)
    const k = this.park
    const x = side < 2 ? k.x + along : k.x + (side === 2 ? -1 : 1) * (HALF - 1.5)
    const z = side < 2 ? k.z + (side ? -1 : 1) * (HALF - 1.5) : k.z + along
    const zb = s._extraZombie?.(x, k.y, z, null)
    if (!zb) return
    this.zombies.push(zb)
    // A clown's party hat.
    const B = this.B
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.22 * B, 0.55 * B, 8), new THREE.MeshLambertMaterial({ color: HAT_COLORS[Math.floor(Math.random() * HAT_COLORS.length)] }))
    hat.position.y = 2.25 * B
    zb.group?.add(hat)
  }

  _prompt(me) {
    const s = this.s
    if (this.ride) return
    const l = this._local(me)
    const bottom = this._cabin(0, 0)
    const st = this.trackPoint(0)
    let key = ''
    if (Math.hypot(l.x - bottom.x, l.z - bottom.z) < USE_R + 1 && l.y < 3) key = 'parkFerrisPrompt'
    else if (Math.hypot(l.x - (st.x + 1.6), l.z - st.z) < USE_R && l.y < 3) key = 'parkCoasterPrompt'
    else if (!this.game && Math.hypot(l.x - BOOTH.x, l.z - (BOOTH.z - 1.6)) < USE_R) key = 'parkWhackPrompt'
    if (key && key !== this._lastPrompt) s._message(t(key), 3)
    this._lastPrompt = key
  }

  clear() {
    if (this.ride) this._getOff()
    this.cells.restore()
    this._group?.removeFromParent()
    this._group?.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      o.material.map?.dispose?.()
      o.material.dispose()
    })
    this._group = null
    this.park = null
    this.game = null
    this.zombies = []
    this._heard = false
  }
}
