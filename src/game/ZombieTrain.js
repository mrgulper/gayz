// The Zombie Train (2026-11-02, Gaymi's idea list 5: "a train runs a loop
// through the Open World. You can ride it, fight zombies through its
// carriages and jump off at stations"). Owned by BuildSurvival
// (`s.train`): Zombie Survival with the open world on, alone or as a
// server's host. On a server the host runs it and everyone else sees the
// same train on the same track and can ride it too (2026-11-09:
// snapshot() -> applySnapshot(), a "mirror" that follows the host's).
//
// The track: a circle LOOP_R blocks round, picked out in the open land
// LOOP_FAR blocks from where you start (away from the city and the sea),
// laid over the ground (smoothed, so hills are crossed on low bridges).
// STATIONS stations sit round it, each with a platform and a blue beam you
// can see from far off. The train - an engine and CARS open wagons - runs
// round at TRAIN_SPEED and waits STOP_S seconds at every station.
//
// Riding: press Use next to a wagon to climb in. Your keys walk you along
// the train from wagon to wagon. Jump (or Crouch) jumps off - at a station
// that's safe; off a moving train you tumble (TUMBLE_HURT). Every time the
// train leaves a station with you on it, zombies climb into the wagons
// (CAR_ZOMBIES each, not part of the wave): they ride along and come
// through the wagons at you. Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { sampleLand, inCity } from './OpenWorld.js'

export const LOOP_R = 55
const LOOP_FAR = 95
export const STATIONS = 3
export const CARS = 3
export const TRAIN_SPEED = 9
export const STOP_S = 8
export const CAR_ZOMBIES = 2
export const TUMBLE_HURT = 10
const CAR_L = 4
const GAP = 0.6
const FLOOR = 1.1 // a wagon's floor over the rail
const SAMPLES = 360
const BOARD_REACH = 3
const WALK = 4
const ZOMBIE_WALK = 2.2
const BITE_EVERY = 1
const BITE = 8
const TRAIN_EYE = 1.62
const SLOW_NEAR = 12 // blocks before a station it starts slowing

export class ZombieTrain {
  constructor(survival) {
    this.s = survival
    this.on = false
    this.aboard = null // { off, side }
    this.riders = []
    this._group = null
  }

  get B() {
    return this.s.B
  }

  get length() {
    return (CARS + 1) * (CAR_L + GAP)
  }

  // A new game: lay the track out near `start` (open world only).
  setup(start) {
    this.clear()
    const s = this.s
    if (!s.bm.world?.active || (s.net && !s.net.isHost) || s.cfg.noZombies || s.td) return false
    const spot = this._findLoop(start)
    if (!spot) return false
    this.cx = spot.x
    this.cz = spot.z
    this._heights()
    this.perim = Math.PI * 2 * LOOP_R
    this.stations = Array.from({ length: STATIONS }, (_, i) => (i / STATIONS) * this.perim)
    this.head = this.length + 1
    this.speed = 0
    this.wait = STOP_S
    this.next = 0
    this.on = true
    this._build()
    return true
  }

  // --- on a server ---

  // The host's train for the others (PlayNet, `train`): the track's middle
  // and how far round the front is.
  snapshot() {
    if (!this.on || this.mirror) return null
    return { cx: +this.cx.toFixed(2), cz: +this.cz.toFixed(2), head: +this.head.toFixed(2), w: this.wait > 0 ? 1 : 0 }
  }

  // Everyone else: the same track (it's worked out from the same world)
  // and the train following the host's. null: there's none (any more).
  applySnapshot(d) {
    if (!d) {
      if (this.mirror) this.clear()
      return
    }
    if (!this.on || !this.mirror || this.cx !== d.cx || this.cz !== d.cz) {
      this.clear()
      this.cx = d.cx
      this.cz = d.cz
      this._heights()
      this.perim = Math.PI * 2 * LOOP_R
      this.stations = Array.from({ length: STATIONS }, (_, i) => (i / STATIONS) * this.perim)
      this.head = d.head
      this.speed = 0
      this.wait = 0
      this.on = true
      this.mirror = true
      this._build()
    }
    this._netHead = d.head
    this._netWait = !!d.w
  }

  // A mirror's frame: slide after the host's train (a little ahead of the
  // last update while it's moving, so it doesn't stop and start).
  _follow(dt) {
    // The host left and it's me now: the train carries on, run here.
    if (this.s.net?.isHost) {
      this.mirror = false
      return
    }
    if (!this._netWait) this._netHead += TRAIN_SPEED * 0.5 * dt
    const before = this.head
    const gap = this._netHead - this.head
    if (Math.abs(gap) > 30) this.head = this._netHead
    else this.head += gap * Math.min(1, dt * 4)
    this.speed = dt > 0 ? Math.abs(this.head - before) / dt : 0
    this.wait = this._netWait ? 1 : 0
    this._draw()
    if (this.aboard && (this.s.dead || !this.s.active)) this.aboard = null
  }

  // Open, dry, not too steep land LOOP_FAR away in some direction.
  _findLoop(start) {
    let best = null
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const x = start.x + Math.cos(a) * (LOOP_FAR + LOOP_R)
      const z = start.z + Math.sin(a) * (LOOP_FAR + LOOP_R)
      let lo = Infinity
      let hi = -Infinity
      let ok = true
      for (let k = 0; k < 36 && ok; k++) {
        const b = (k / 36) * Math.PI * 2
        const px = Math.floor(x + Math.cos(b) * LOOP_R)
        const pz = Math.floor(z + Math.sin(b) * LOOP_R)
        if (inCity(px, pz)) ok = false
        const land = sampleLand(px, pz)
        if (!land || /cean$|river|swamp/i.test(land.biome || '')) ok = false
        lo = Math.min(lo, land?.h ?? 0)
        hi = Math.max(hi, land?.h ?? 0)
      }
      if (ok && (!best || hi - lo < best.spread)) best = { x, z, spread: hi - lo }
    }
    return best && best.spread < 30 ? best : null
  }

  // The rail's height all the way round: over the highest ground nearby,
  // smoothed.
  _heights() {
    const raw = []
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * Math.PI * 2
      raw.push((sampleLand(Math.floor(this.cx + Math.cos(a) * LOOP_R), Math.floor(this.cz + Math.sin(a) * LOOP_R))?.h ?? 0) + 1)
    }
    const top = raw.map((_, i) => {
      let m = -Infinity
      for (let k = -3; k <= 3; k++) m = Math.max(m, raw[(i + k + SAMPLES) % SAMPLES])
      return m
    })
    this.h = top.map((_, i) => {
      let sum = 0
      for (let k = -8; k <= 8; k++) sum += top[(i + k + SAMPLES) % SAMPLES]
      return sum / 17
    })
  }

  // A spot `d` blocks along the loop: where, which way along, and the side.
  at(d) {
    const p = ((d % this.perim) + this.perim) % this.perim
    const a = p / LOOP_R
    const f = (a / (Math.PI * 2)) * SAMPLES
    const i = Math.floor(f)
    const h = this.h[i % SAMPLES] + (this.h[(i + 1) % SAMPLES] - this.h[i % SAMPLES]) * (f - i)
    return { x: this.cx + Math.cos(a) * LOOP_R, y: h, z: this.cz + Math.sin(a) * LOOP_R, dx: -Math.sin(a), dz: Math.cos(a), nx: Math.cos(a), nz: Math.sin(a) }
  }

  // --- meshes ---

  _build() {
    const B = this.B
    const g = new THREE.Group()
    this._group = g
    this.s.bm.scene.add(g)
    // Sleepers and two rails, one of each per block.
    const n = Math.ceil(this.perim)
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2 * B, 0.15 * B, 0.35 * B), new THREE.MeshLambertMaterial({ color: 0x5a3d24 }), n)
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12 * B, 0.15 * B, 1.02 * B), new THREE.MeshLambertMaterial({ color: 0x9a9aa4 }), n * 2)
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5 * B, 1, 0.5 * B), new THREE.MeshLambertMaterial({ color: 0x6a6a70 }), Math.ceil(n / 4))
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const one = new THREE.Vector3(1, 1, 1)
    let pi = 0
    for (let i = 0; i < n; i++) {
      const p = this.at(i)
      q.setFromAxisAngle(up, Math.atan2(p.dx, p.dz))
      m.compose(new THREE.Vector3(p.x * B, (p.y + 0.07) * B, p.z * B), q, one)
      sleepers.setMatrixAt(i, m)
      for (const side of [0, 1]) {
        const o = side ? 0.7 : -0.7
        m.compose(new THREE.Vector3((p.x + p.nx * o) * B, (p.y + 0.2) * B, (p.z + p.nz * o) * B), q, one)
        rails.setMatrixAt(i * 2 + side, m)
      }
      // A post down to the ground every few blocks where it runs high.
      const ground = (sampleLand(Math.floor(p.x), Math.floor(p.z))?.h ?? p.y) + 1
      if (i % 4 === 0 && p.y - ground > 1.5) {
        const hgt = (p.y - ground) * B
        m.compose(new THREE.Vector3(p.x * B, ground * B + hgt / 2, p.z * B), q, new THREE.Vector3(1, hgt, 1))
        posts.setMatrixAt(pi++, m)
      }
    }
    posts.count = pi
    g.add(sleepers, rails, posts)
    // Stations: a stone platform on the outside, a roof and a beam.
    for (const d of this.stations) {
      const p = this.at(d)
      const st = new THREE.Group()
      const plat = new THREE.Mesh(new THREE.BoxGeometry(2.4 * B, 1 * B, 10 * B), new THREE.MeshLambertMaterial({ color: 0xb0aaa0 }))
      plat.position.set(2.4 * B, 0.5 * B, 0)
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8 * B, 0.2 * B, 8 * B), new THREE.MeshLambertMaterial({ color: 0x8a3a2a }))
      roof.position.set(2.6 * B, 3.6 * B, 0)
      st.add(plat, roof)
      for (const z of [-3.5, 3.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2 * B, 2.6 * B, 0.2 * B), new THREE.MeshLambertMaterial({ color: 0x3a3a3a }))
        post.position.set(3.4 * B, 2.3 * B, z * B)
        st.add(post)
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.5 * B, 50 * B, 1.5 * B), new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.14, depthWrite: false }))
      beam.position.set(2.4 * B, 25 * B, 0)
      st.add(beam)
      st.position.set(p.x * B, p.y * B, p.z * B)
      // Facing along the track: its +x is the outside of the loop.
      st.rotation.y = Math.atan2(p.dx, p.dz)
      g.add(st)
    }
    // The train.
    this._cars = []
    for (let i = 0; i <= CARS; i++) {
      const car = i === 0 ? makeEngine(B) : makeWagon(B, i)
      g.add(car)
      this._cars.push(car)
    }
  }

  // --- running ---

  // How far along the next station is (blocks).
  _toStation() {
    const p = ((this.head % this.perim) + this.perim) % this.perim
    let best = Infinity
    for (const d of this.stations) {
      const ahead = (d - p + this.perim) % this.perim
      if (ahead > 0.01 && ahead < best) best = ahead
    }
    return best
  }

  update(dt) {
    if (!this.on) return
    if (this.mirror) return this._follow(dt)
    const s = this.s
    if (this.wait > 0) {
      this.wait -= dt
      this.speed = 0
      if (this.wait <= 0) this._depart()
    } else {
      const left = this._toStation()
      const want = left < SLOW_NEAR ? Math.max(1.2, TRAIN_SPEED * (left / SLOW_NEAR)) : TRAIN_SPEED
      this.speed += (want - this.speed) * Math.min(1, dt * 1.5)
      const step = Math.min(this.speed * dt, left)
      this.head += step
      if (left - step < 0.02) {
        this.wait = STOP_S
        if (this.aboard) s._message(t('trainStation'), 3)
        try { audioEngine.playSpecial?.('bell') } catch { /* no audio */ }
      }
    }
    this._draw()
    this._ride(dt)
    if (this.aboard && (s.dead || !s.active)) this.aboard = null
  }

  _draw() {
    const B = this.B
    this._cars.forEach((car, i) => {
      const mid = this.head - i * (CAR_L + GAP) - CAR_L / 2
      const a = this.at(mid + CAR_L / 2)
      const b = this.at(mid - CAR_L / 2)
      car.position.set(((a.x + b.x) / 2) * B, ((a.y + b.y) / 2 + 0.25) * B, ((a.z + b.z) / 2) * B)
      car.rotation.set(0, Math.atan2(a.x - b.x, a.z - b.z), 0)
      car.rotateX(-Math.atan2(a.y - b.y, CAR_L))
    })
  }

  // Leaving a station: with you on it, zombies climb into the wagons.
  _depart() {
    const s = this.s
    try { audioEngine.playSpecial?.('honk') } catch { /* no audio */ }
    if (!this.aboard) return
    for (let c = 1; c <= CARS; c++) {
      for (let k = 0; k < CAR_ZOMBIES; k++) {
        const off = c * (CAR_L + GAP) + 0.6 + k * (CAR_L - 1.2) / Math.max(1, CAR_ZOMBIES - 1)
        if (Math.abs(off - this.aboard.off) < 2) continue
        const p = this._spot(off, 0)
        const zb = s._extraZombie?.(p.x, p.y, p.z)
        if (!zb) continue
        zb.trainOff = off
        zb.trainSide = (Math.random() - 0.5) * 0.8
        this.riders.push(zb)
      }
    }
    s._message(t('trainZombies'), 3)
  }

  // Where `off` blocks back from the front of the train is (on a wagon floor).
  _spot(off, side) {
    const p = this.at(this.head - off)
    return { x: p.x + p.nx * side, y: p.y + FLOOR, z: p.z + p.nz * side, dx: p.dx, dz: p.dz }
  }

  // The zombies riding along: kept on the train, walking at you.
  _ride(dt) {
    const s = this.s
    this.riders = this.riders.filter((zb) => zb.health > 0 && s.zombies.includes(zb))
    const me = this.aboard
    for (const zb of this.riders) {
      if (me) {
        const d = me.off - zb.trainOff
        if (Math.abs(d) > 0.9) zb.trainOff += Math.sign(d) * Math.min(Math.abs(d), ZOMBIE_WALK * dt)
        zb.trainSide += (me.side - zb.trainSide) * Math.min(1, dt * 2)
        zb.trainBite = (zb.trainBite || 0) - dt
        if (Math.abs(d) < 1.1 && zb.trainBite <= 0 && !s.dead) {
          zb.trainBite = BITE_EVERY
          s._hurtPlayer(BITE)
        }
      }
      zb.trainOff = Math.max(CAR_L + GAP + 0.3, Math.min(this.length - 0.3, zb.trainOff))
      const p = this._spot(zb.trainOff, zb.trainSide)
      zb.x = p.x
      zb.y = p.y
      zb.z = p.z
      zb.vx = zb.vy = zb.vz = 0
      zb.frozen = Math.max(zb.frozen || 0, 0.2)
      if (zb.group) {
        zb.group.position.set(p.x * this.B, p.y * this.B, p.z * this.B)
        if (me) zb.group.rotation.y = Math.atan2(p.dx, p.dz) + (me.off < zb.trainOff ? 0 : Math.PI)
      }
    }
  }

  // --- you ---

  // The Use key: climb into the wagon beside you.
  use() {
    const s = this.s
    if (!this.on || this.aboard || s.dead || s.spectating) return false
    const me = s.bodyPos()
    for (let off = CAR_L + GAP + 0.5; off < this.length; off += 0.5) {
      const p = this._spot(off, 0)
      if (Math.hypot(p.x - me.x, p.z - me.z) < BOARD_REACH && Math.abs(p.y - me.y) < 3) {
        s.kart?.leave()
        this.aboard = { off, side: 0 }
        this._jumpWas = true
        s._message(t('trainAboard'), 4)
        return true
      }
    }
    return false
  }

  // Riding (BuildTryMode): the keys walk you along the train; Jump or
  // Crouch jumps off.
  drive(dt, { fwd, back, left, right, stick, jump, crouch }) {
    const a = this.aboard
    if (!a) return
    const off = (jump && !this._jumpWas) || crouch
    this._jumpWas = jump
    if (off) return this.leave()
    let mf = (fwd ? 1 : 0) - (back ? 1 : 0)
    let ms = (right ? 1 : 0) - (left ? 1 : 0)
    if (stick) {
      if (!mf) mf = stick.y
      if (!ms) ms = stick.x
    }
    // Your keys go the way you're looking; along the train and across it.
    const yaw = this.s.bm._yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const wx = fx * mf - fz * ms
    const wz = fz * mf + fx * ms
    const p = this.at(this.head - a.off)
    const along = wx * p.dx + wz * p.dz
    const across = wx * p.nx + wz * p.nz
    a.off = Math.max(CAR_L + GAP + 0.3, Math.min(this.length - 0.3, a.off - along * WALK * dt))
    // Not in the gap between two wagons.
    a.side = Math.max(-0.5, Math.min(0.5, a.side + across * WALK * dt))
  }

  seat() {
    const a = this.aboard
    if (!a) return null
    const p = this._spot(a.off, a.side)
    return { x: p.x, y: p.y, z: p.z, eye: TRAIN_EYE }
  }

  // Off the train, beside the track (the platform side at a station).
  leave() {
    const a = this.aboard
    if (!a) return
    const s = this.s
    this.aboard = null
    const p = this.at(this.head - a.off)
    const x = p.x + p.nx * 2.6
    const z = p.z + p.nz * 2.6
    const y = s._groundUnder(x, p.y + 4, z)
    s.bm.tryMode.pos.set(x, Math.max(y, p.y - 6), z)
    s.bm.tryMode.vel?.set(0, 0, 0)
    if (this.speed > 2) {
      s._hurtPlayer(TUMBLE_HURT)
      s._message(t('trainTumble'), 3)
    }
  }

  clear() {
    this.aboard = null
    this.on = false
    this.mirror = false
    for (const zb of this.riders) zb.frozen = 0
    this.riders = []
    if (this._group) {
      this._group.removeFromParent()
      this._group.traverse((o) => {
        if (!o.isMesh) return
        o.geometry.dispose()
        for (const m of [].concat(o.material)) m.dispose()
      })
      this._group = null
    }
  }
}

function boxIn(g, B, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
  m.position.set(x * B, y * B, z * B)
  g.add(m)
  return m
}

// The engine: a black boiler, a red cab, a chimney and a cow-catcher,
// facing +z.
function makeEngine(B) {
  const g = new THREE.Group()
  boxIn(g, B, 1.6, 0.4, CAR_L, 0x2a2a2a, 0, 0.6, 0)
  boxIn(g, B, 1.2, 1.2, 2.4, 0x1c1c22, 0, 1.4, 0.6)
  boxIn(g, B, 1.6, 1.8, 1.4, 0xa8302a, 0, 1.7, -1.2)
  boxIn(g, B, 1.8, 0.2, 1.6, 0x2a2a2a, 0, 2.7, -1.2)
  boxIn(g, B, 0.4, 0.9, 0.4, 0x1c1c22, 0, 2.4, 1.4)
  boxIn(g, B, 1.4, 0.4, 0.3, 0xc8a83a, 0, 0.5, 2.05)
  boxIn(g, B, 0.5, 0.5, 0.06, 0xffe8a0, 0, 1.6, 1.82)
  for (const z of [-1.3, 0, 1.3]) for (const x of [-0.75, 0.75]) boxIn(g, B, 0.15, 0.7, 0.7, 0x3a1a14, x, 0.35, z)
  return g
}

// An open wagon (you stand on its floor) with low walls.
function makeWagon(B, i) {
  const g = new THREE.Group()
  const color = [0x3a6a3a, 0x6a4a2a, 0x3a4a7a][(i - 1) % 3]
  boxIn(g, B, 1.6, 0.3, CAR_L, 0x2a2a2a, 0, 0.55, 0)
  boxIn(g, B, 1.6, 0.15, CAR_L, 0x7a5a3a, 0, 0.78, 0)
  for (const x of [-0.82, 0.82]) boxIn(g, B, 0.08, 0.8, CAR_L, color, x, 1.25, 0)
  for (const z of [-CAR_L / 2, CAR_L / 2]) {
    for (const x of [-0.6, 0.6]) boxIn(g, B, 0.4, 0.8, 0.08, color, x, 1.25, z)
  }
  for (const z of [-1.3, 1.3]) for (const x of [-0.75, 0.75]) boxIn(g, B, 0.15, 0.6, 0.6, 0x1c1c1c, x, 0.3, z)
  return g
}
