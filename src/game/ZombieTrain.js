// The Zombie Train (2026-11-02, Gaymi's idea list 5: "a train runs a loop
// through the Open World. You can ride it, fight zombies through its
// carriages and jump off at stations"). Owned by BuildSurvival
// (`s.train`): Zombie Survival with the open world on, alone or as a
// server's host. On a server the host runs it and everyone else sees the
// same train on the same track and can ride it too (2026-11-09:
// snapshot() -> applySnapshot(), a "mirror" that follows the host's).
//
// The track: a loop about LOOP_R blocks round, picked out in the open land
// LOOP_FAR blocks from where you start (away from the city and the sea),
// laid over the ground (smoothed, so hills are crossed on low bridges).
// It never runs through a building the game made (2026-11-15, Gaymi: "the
// rail must not go through buildings, including any added later"): where a
// village, castle, bridge, town, landmark or the Theme Park is in the way
// the loop swings up to BEND blocks in or out round it, keeping CLEAR
// blocks away (_route). Buildings that pop up later (the graveyard, the
// haunted house, the bank...) ask overlaps() first and pick another spot.
// Anything new the game builds in the open world must do one or the other.
// On Detailed graphics and up the track looks real (_buildRealTrack):
// steel rails (foot, web and head), wooden sleepers on tie plates with
// bolts, on a gravel bed.
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
import { GRAPHICS_LEVELS } from './GraphicsLevels.js'
import { SIZE as PARK_SIZE } from './ThemePark.js'

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
export const BEND = 20 // how far the loop may swing in or out round a building
export const CLEAR = 5 // blocks kept between the rail and any building (platforms fit)
const STEER = 2 // what a step in or out costs the route (keeps it smooth)
const REAL_FROM = GRAPHICS_LEVELS.indexOf('detailed') // the real-looking track from here up

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
    this._lay(spot.radii)
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
      // The same world, so the same way round the same buildings.
      this._lay(this._route(d.cx, d.cz) || new Array(SAMPLES).fill(LOOP_R))
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

  // Open, dry, not too steep land LOOP_FAR (or a bit further) away in
  // some direction, with a way round every building there.
  _findLoop(start) {
    const spots = []
    for (const far of [LOOP_FAR, LOOP_FAR + 45]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        const x = Math.round(start.x + Math.cos(a) * (far + LOOP_R))
        const z = Math.round(start.z + Math.sin(a) * (far + LOOP_R))
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
        if (ok && hi - lo < 30) spots.push({ x, z, spread: hi - lo + (far - LOOP_FAR) / 3 })
      }
    }
    spots.sort((p, q) => p.spread - q.spread)
    for (const sp of spots.slice(0, 8)) {
      const radii = this._route(sp.x, sp.z)
      if (radii) return { ...sp, radii }
    }
    return null
  }

  // Where nothing may go round (cx, cz): every building the game made
  // (villages, castles, bridges, towns, landmarks, the Theme Park) and the
  // city, CLEAR blocks wider, and the sea. -> { x0, z0, size, grid }
  // (grid[i * size + j] = 1: blocked at (x0 + i, z0 + j)).
  _keepOut(cx, cz) {
    const reach = LOOP_R + BEND + CLEAR + 2
    const x0 = Math.floor(cx - reach)
    const z0 = Math.floor(cz - reach)
    const size = reach * 2 + 2
    const grid = new Uint8Array(size * size)
    const mark = (ax0, az0, ax1, az1) => {
      const i0 = Math.max(0, ax0 - x0)
      const i1 = Math.min(size - 1, ax1 - x0)
      const j0 = Math.max(0, az0 - z0)
      const j1 = Math.min(size - 1, az1 - z0)
      for (let i = i0; i <= i1; i++) grid.fill(1, i * size + j0, j1 >= j0 ? i * size + j1 + 1 : i * size + j0)
    }
    for (let i = 0; i < size; i += 2) {
      for (let j = 0; j < size; j += 2) {
        const x = x0 + i
        const z = z0 + j
        if (inCity(x, z)) mark(x - CLEAR, z - CLEAR, x + 1 + CLEAR, z + 1 + CLEAR)
        else if (/cean$/.test(sampleLand(x, z)?.biome || '')) mark(x, z, x + 1, z + 1)
      }
    }
    const world = this.s.bm.world
    for (const plan of world?._plansOver?.(x0, z0, x0 + size, z0 + size, CLEAR) || []) {
      if (plan.top?.size) {
        for (const k of plan.top.keys()) {
          const c = k.indexOf(',')
          const x = +k.slice(0, c)
          const z = +k.slice(c + 1)
          mark(x - CLEAR, z - CLEAR, x + CLEAR, z + CLEAR)
        }
      } else mark(plan.x0 - CLEAR, plan.z0 - CLEAR, plan.x1 + CLEAR, plan.z1 + CLEAR)
    }
    const park = this.s.park?.spot?.()
    if (park) {
      const r = Math.ceil(PARK_SIZE / 2) + 1 + CLEAR
      mark(park.x - r, park.z - r, park.x + r, park.z + r)
    }
    return { x0, z0, size, grid }
  }

  // The loop's distance from (cx, cz) at each of SAMPLES angles: as near
  // LOOP_R as it can be while missing everything in _keepOut, stepping in
  // or out at most a block per sample (the cheapest way round, worked out
  // a sample at a time), then smoothed. null: no way round.
  _route(cx, cz) {
    const { x0, z0, size, grid } = this._keepOut(cx, cz)
    const K = BEND * 2 + 1
    const N = SAMPLES
    const radius = (k) => LOOP_R - BEND + k
    const blocked = (i, r) => {
      const a = (i / N) * Math.PI * 2
      const gi = Math.floor(cx + Math.cos(a) * r) - x0
      const gj = Math.floor(cz + Math.sin(a) * r) - z0
      return gi < 0 || gj < 0 || gi >= size || gj >= size || grid[gi * size + gj] === 1
    }
    const free = new Uint8Array(N * K)
    for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) free[i * K + k] = blocked(i, radius(k)) ? 0 : 1
    // Start (and end) a few different distances out at angle 0; keep the
    // cheapest whole loop.
    const starts = [...Array(K).keys()].filter((k) => free[k]).sort((p, q) => Math.abs(p - BEND) - Math.abs(q - BEND)).slice(0, 6)
    let best = null
    const from = new Int8Array((N + 1) * K)
    for (const s0 of starts) {
      let cost = new Float64Array(K).fill(Infinity)
      cost[s0] = 0
      for (let i = 1; i <= N; i++) {
        const ii = i % N
        const next = new Float64Array(K).fill(Infinity)
        for (let k = 0; k < K; k++) {
          if (!free[ii * K + k] || (i === N && k !== s0)) continue
          for (let d = -1; d <= 1; d++) {
            const p = k - d
            if (p < 0 || p >= K || cost[p] === Infinity) continue
            const c = cost[p] + (d ? STEER : 0) + Math.abs(k - BEND) * 0.05
            if (c < next[k]) {
              next[k] = c
              from[i * K + k] = d
            }
          }
        }
        cost = next
      }
      if (cost[s0] === Infinity || (best && cost[s0] >= best.cost)) continue
      const ks = new Array(N)
      let k = s0
      for (let i = N; i >= 1; i--) {
        ks[i % N] = k
        k -= from[i * K + k]
      }
      best = { cost: cost[s0], radii: ks.map(radius) }
    }
    if (!best) return null
    // Smoothed, if the smooth one still misses everything.
    for (const w of [10, 4]) {
      const smooth = best.radii.map((_, i) => {
        let sum = 0
        for (let k = -w; k <= w; k++) sum += best.radii[(i + k + N) % N]
        return sum / (w * 2 + 1)
      })
      if (smooth.every((r, i) => !blocked(i, r))) return smooth
    }
    return best.radii
  }

  // Lays the loop out from its radii: the points, how far round each is,
  // which way it runs there, and the rail's height all the way round (over
  // the highest ground nearby, smoothed).
  _lay(radii) {
    const N = SAMPLES
    this.radii = radii
    this.px = new Float64Array(N)
    this.pz = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      this.px[i] = this.cx + Math.cos(a) * radii[i]
      this.pz[i] = this.cz + Math.sin(a) * radii[i]
    }
    this.cum = new Float64Array(N + 1)
    for (let i = 0; i < N; i++) this.cum[i + 1] = this.cum[i] + Math.hypot(this.px[(i + 1) % N] - this.px[i], this.pz[(i + 1) % N] - this.pz[i])
    this.perim = this.cum[N]
    this.tx = new Float64Array(N)
    this.tz = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const dx = this.px[(i + 1) % N] - this.px[(i - 1 + N) % N]
      const dz = this.pz[(i + 1) % N] - this.pz[(i - 1 + N) % N]
      const l = Math.hypot(dx, dz) || 1
      this.tx[i] = dx / l
      this.tz[i] = dz / l
    }
    const raw = []
    for (let i = 0; i < N; i++) raw.push((sampleLand(Math.floor(this.px[i]), Math.floor(this.pz[i]))?.h ?? 0) + 1)
    const top = raw.map((_, i) => {
      let m = -Infinity
      for (let k = -3; k <= 3; k++) m = Math.max(m, raw[(i + k + N) % N])
      return m
    })
    this.h = top.map((_, i) => {
      let sum = 0
      for (let k = -8; k <= 8; k++) sum += top[(i + k + N) % N]
      return sum / 17
    })
    // The cells the track and its platforms cover (overlaps()).
    this._cells = new Set()
    for (let i = 0; i < N; i++) {
      for (let dx = -CLEAR + 1; dx <= CLEAR - 1; dx++) for (let dz = -CLEAR + 1; dz <= CLEAR - 1; dz++) this._cells.add(`${Math.floor(this.px[i]) + dx},${Math.floor(this.pz[i]) + dz}`)
    }
  }

  // Does the box (cells, inclusive) touch the track? Anything the game
  // builds in the open world after the track is laid asks this first.
  overlaps(x0, z0, x1, z1) {
    if (!this.on || !this._cells) return false
    for (let x = Math.floor(Math.min(x0, x1)); x <= Math.floor(Math.max(x0, x1)); x++) {
      for (let z = Math.floor(Math.min(z0, z1)); z <= Math.floor(Math.max(z0, z1)); z++) if (this._cells.has(`${x},${z}`)) return true
    }
    return false
  }

  // A spot `d` blocks along the loop: where, which way along, and the side
  // (n: out of the loop).
  at(d) {
    const N = SAMPLES
    const p = ((d % this.perim) + this.perim) % this.perim
    let lo = 0
    let hi = N
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.cum[mid] <= p) lo = mid
      else hi = mid
    }
    const i = lo
    const j = (i + 1) % N
    const f = (p - this.cum[i]) / (this.cum[i + 1] - this.cum[i] || 1)
    let dx = this.tx[i] + (this.tx[j] - this.tx[i]) * f
    let dz = this.tz[i] + (this.tz[j] - this.tz[i]) * f
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    return {
      x: this.px[i] + (this.px[j] - this.px[i]) * f,
      y: this.h[i] + (this.h[j] - this.h[i]) * f,
      z: this.pz[i] + (this.pz[j] - this.pz[i]) * f,
      dx, dz, nx: dz, nz: -dx,
    }
  }

  // --- meshes ---

  _build() {
    const B = this.B
    const g = new THREE.Group()
    this._group = g
    this.s.bm.scene.add(g)
    this._buildTrack()
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

  // Detailed graphics and up (not Performance Mode): the real-looking track.
  _real() {
    const set = this.s.bm.game?.settings
    const lvl = GRAPHICS_LEVELS.indexOf(set?.graphicsLevel)
    return !set?.performanceMode && (lvl < 0 ? REAL_FROM : lvl) >= REAL_FROM
  }

  // The track itself (rails, sleepers, its posts), in its own group so a
  // graphics change swaps it without touching the train.
  _buildTrack() {
    this._dropTrack()
    const g = new THREE.Group()
    this._track = g
    this._trackReal = this._real()
    this._group.add(g)
    if (this._trackReal) this._buildRealTrack(g)
    else this._buildPlainTrack(g)
    this._buildPosts(g)
  }

  _dropTrack() {
    if (!this._track) return
    this._track.removeFromParent()
    disposeAll(this._track)
    this._track = null
  }

  // Lower graphics: one sleeper and two plain rails per block.
  _buildPlainTrack(g) {
    const B = this.B
    const n = Math.ceil(this.perim)
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2 * B, 0.15 * B, 0.35 * B), new THREE.MeshLambertMaterial({ color: 0x5a3d24 }), n)
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12 * B, 0.15 * B, 1 * B), new THREE.MeshLambertMaterial({ color: 0x9a9aa4 }), n * 2)
    const step = this.perim / n
    for (let i = 0; i < n; i++) {
      const p = this.at(i * step)
      place(sleepers, i, B, p.x, p.y + 0.07, p.z, p.dx, 0, p.dz, 1)
      for (const side of [0, 1]) {
        const o = side ? 0.7 : -0.7
        this._segment(rails, i * 2 + side, i * step, step, o, 0.2, 1.04)
      }
    }
    g.add(sleepers, rails)
  }

  // Detailed and up: a gravel bed with sloped shoulders, two weathered
  // wooden sleepers per block, a steel tie plate with two bolts under each
  // rail, and steel rails shaped like real ones (a wide foot, a thin web, a
  // shiny rounded head), laid in short lengths so curves and slopes are
  // smooth. Rail top stays where the wagons' wheels run.
  _buildRealTrack(g) {
    const B = this.B
    const n = Math.ceil(this.perim * 2) // half-block steps
    const step = this.perim / n
    const gravelMat = new THREE.MeshLambertMaterial({ map: gravelTexture() })
    const bed = new THREE.InstancedMesh(new THREE.BoxGeometry(2.9 * B, 0.26 * B, 1 * B), gravelMat, n)
    const shoulder = new THREE.InstancedMesh(new THREE.BoxGeometry(3.7 * B, 0.16 * B, 1 * B), gravelMat, n)
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5 * B, 0.14 * B, 0.26 * B), new THREE.MeshLambertMaterial({ map: woodTexture() }), n)
    const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34 * B, 0.03 * B, 0.22 * B), new THREE.MeshStandardMaterial({ color: 0x3e3834, roughness: 0.85, metalness: 0.3 }), n * 2)
    const bolts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05 * B, 0.05 * B, 0.05 * B), new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.7, metalness: 0.5 }), n * 4)
    const rustMat = new THREE.MeshStandardMaterial({ color: 0x6a4e3e, roughness: 0.9, metalness: 0.25 })
    const foot = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15 * B, 0.025 * B, 1 * B), rustMat, n * 2)
    const web = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045 * B, 0.075 * B, 1 * B), rustMat, n * 2)
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.085 * B, 0.05 * B, 1 * B), new THREE.MeshStandardMaterial({ color: 0xb4b8c0, roughness: 0.3, metalness: 0.55 }), n * 2)
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const d = i * step
      const p = this.at(d)
      this._segment(bed, i, d, step, 0, -0.1, 1.02)
      this._segment(shoulder, i, d, step, 0, -0.14, 1.02)
      // Each sleeper a little different: tone, a hair off square.
      const r = hashNum(i)
      const skew = (r - 0.5) * 0.06
      place(sleepers, i, B, p.x, p.y + 0.07, p.z, p.dx + p.nx * skew, 0, p.dz + p.nz * skew, 1)
      c.setHSL(0.07 + r * 0.02, 0.25 + r * 0.15, 0.55 + hashNum(i + 7919) * 0.25)
      sleepers.setColorAt(i, c)
      for (const side of [0, 1]) {
        const o = side ? 0.7 : -0.7
        place(plates, i * 2 + side, B, p.x + p.nx * o, p.y + 0.155, p.z + p.nz * o, p.dx, 0, p.dz, 1)
        for (const b of [0, 1]) {
          const bo = o + (b ? 0.12 : -0.12)
          place(bolts, i * 4 + side * 2 + b, B, p.x + p.nx * bo, p.y + 0.18, p.z + p.nz * bo, p.dx, 0, p.dz, 1)
        }
        this._segment(foot, i * 2 + side, d, step, o, 0.18, 1.03)
        this._segment(web, i * 2 + side, d, step, o, 0.225, 1.03)
        this._segment(head, i * 2 + side, d, step, o, 0.28, 1.03)
      }
    }
    sleepers.instanceColor.needsUpdate = true
    g.add(shoulder, bed, sleepers, plates, bolts, foot, web, head)
  }

  // One straight length of something laid along the track: from `d` to
  // `d + len`, `side` blocks out, `up` over the rail's height, following
  // the bends and the slopes (stretched by `over` so lengths meet).
  _segment(mesh, idx, d, len, side, up, over) {
    const a = this.at(d)
    const b = this.at(d + len)
    const ax = a.x + a.nx * side
    const az = a.z + a.nz * side
    const bx = b.x + b.nx * side
    const bz = b.z + b.nz * side
    const l = Math.hypot(bx - ax, b.y - a.y, bz - az) || len
    _o.position.set(((ax + bx) / 2) * this.B, ((a.y + b.y) / 2 + up) * this.B, ((az + bz) / 2) * this.B)
    _o.lookAt(bx * this.B, (b.y + up) * this.B, bz * this.B)
    _o.scale.set(1, 1, l * over)
    _o.updateMatrix()
    mesh.setMatrixAt(idx, _o.matrix)
  }

  // A post down to the ground every few blocks where the track runs high.
  _buildPosts(g) {
    const B = this.B
    const n = Math.ceil(this.perim)
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5 * B, 1, 0.5 * B), new THREE.MeshLambertMaterial({ color: 0x6a6a70 }), Math.ceil(n / 4))
    let pi = 0
    for (let i = 0; i < n; i += 4) {
      const p = this.at(i)
      const ground = (sampleLand(Math.floor(p.x), Math.floor(p.z))?.h ?? p.y) + 1
      if (p.y - ground <= 1.5) continue
      const hgt = (p.y - ground) * B
      _o.position.set(p.x * B, ground * B + hgt / 2, p.z * B)
      _o.rotation.set(0, Math.atan2(p.dx, p.dz), 0)
      _o.scale.set(1, hgt, 1)
      _o.updateMatrix()
      posts.setMatrixAt(pi++, _o.matrix)
    }
    posts.count = pi
    g.add(posts)
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
    // Graphics changed: the other look for the track.
    this._lookIn = (this._lookIn || 0) - dt
    if (this._lookIn <= 0 && this._group) {
      this._lookIn = 1
      if (this._real() !== this._trackReal) this._buildTrack()
    }
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
      disposeAll(this._group)
      this._group = null
      this._track = null
    }
  }
}

const _o = new THREE.Object3D()

// Instance `i` of `mesh` at (x, y, z) blocks, its length along (dx, dy, dz).
function place(mesh, i, B, x, y, z, dx, dy, dz, scale) {
  _o.position.set(x * B, y * B, z * B)
  _o.lookAt((x + dx) * B, (y + dy) * B, (z + dz) * B)
  _o.scale.set(scale, scale, scale)
  _o.updateMatrix()
  mesh.setMatrixAt(i, _o.matrix)
}

function disposeAll(group) {
  const seen = new Set()
  group.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    for (const m of [].concat(o.material)) {
      if (seen.has(m)) continue
      seen.add(m)
      m.map?.dispose()
      m.dispose()
    }
  })
}

// 0..1, the same every time for the same i.
// A copy of a drawn texture (each material gets its own to dispose).
function copyOf(tex) {
  const c = tex.clone()
  c.needsUpdate = true
  return c
}

function hashNum(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Gravel: grey-brown stones of all sizes, drawn once (no image to load).
let _gravel = null
function gravelTexture() {
  if (_gravel) return copyOf(_gravel)
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')
  x.fillStyle = '#6e6862'
  x.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 420; i++) {
    const v = 70 + Math.floor(hashNum(i) * 90)
    const warm = Math.floor(hashNum(i + 50) * 14)
    x.fillStyle = `rgb(${v + warm},${v + Math.floor(warm / 2)},${v})`
    const sz = 1 + Math.floor(hashNum(i + 99) * 4)
    x.fillRect(Math.floor(hashNum(i + 3) * 64), Math.floor(hashNum(i + 5) * 64), sz, sz)
  }
  _gravel = new THREE.CanvasTexture(c)
  _gravel.colorSpace = THREE.SRGBColorSpace
  _gravel.wrapS = _gravel.wrapT = THREE.RepeatWrapping
  return copyOf(_gravel)
}

// Wood grain for the sleepers: long darker streaks and a crack or two
// (light, so each sleeper's own colour tints it).
let _wood = null
function woodTexture() {
  if (_wood) return copyOf(_wood)
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 16
  const x = c.getContext('2d')
  x.fillStyle = '#e8e0d4'
  x.fillRect(0, 0, 64, 16)
  for (let i = 0; i < 26; i++) {
    const v = 150 + Math.floor(hashNum(i + 200) * 70)
    x.fillStyle = `rgb(${v},${v - 12},${v - 26})`
    x.fillRect(Math.floor(hashNum(i + 300) * 40), Math.floor(hashNum(i + 400) * 16), 10 + Math.floor(hashNum(i + 500) * 30), 1)
  }
  x.fillStyle = '#6a5a4a'
  x.fillRect(18, 7, 22, 1)
  _wood = new THREE.CanvasTexture(c)
  _wood.colorSpace = THREE.SRGBColorSpace
  return copyOf(_wood)
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
