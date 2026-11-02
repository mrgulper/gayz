// The Moon (2026-11-02, Gaymi's idea list 5: "a low-gravity moon base with
// big floaty jumps and space-suit zombies" - Gaymi picked "a crafted
// rocket"). Owned by BuildSurvival (`s.moon`), every Zombie Survival game.
//
// - Craft a Rocket, hold it and use it: it stands on open ground in front
//   of you. Press Use beside it to climb in: a COUNTDOWN_S countdown, then
//   it blasts off (you ride it up for LIFT_S seconds) and lands you on the
//   Moon.
// - The Moon: a grey cratered disc MOON_R blocks round, high above
//   everything (MOON_Y), under a black sky full of stars with the Earth
//   hanging in it - real blocks, put in on your first trip and put back as
//   they were when the game ends (TempBlocks.js). A little glass-roofed
//   base stands in the middle with a rocket home beside it.
// - Gravity there is MOON_G of Earth's: you jump far higher and float
//   down. The waves go on: zombies come out of the craters wearing glass
//   space helmets and air tanks.
// - Use the rocket home to fly back to where you took off.
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'

export const MOON_Y = 300
export const MOON_R = 26
export const MOON_G = 0.3
export const COUNTDOWN_S = 3
export const LIFT_S = 4
const SKY_R = 160
const ENTER_REACH = 3
const ON_MOON = 25 // within this many blocks of MOON_Y you're on the Moon

export class MoonTrip {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.rocket = null // the one on Earth: { x, y, z, group }
    this.home = null // the one on the Moon
    this.trip = null // { t, from, to, up }
    this.built = false
    this.back = null // where you took off from
  }

  get B() {
    return this.s.B
  }

  // Where the Moon is: over the middle of the world.
  get cx() {
    return 0.5
  }

  get cz() {
    return 0.5
  }

  get on() {
    if (!this.built) return false
    const p = this.s.bm.tryMode.pos
    return Math.abs(p.y - MOON_Y) < ON_MOON && Math.hypot(p.x - this.cx, p.z - this.cz) < SKY_R * 0.8
  }

  // Holding the Rocket and using it (PlayInventory.useHeld). -> true if
  // it went down (then it's used up).
  place() {
    const s = this.s
    if (s.dead || this.trip) return false
    if (this.on) {
      s._message(t('moonAlreadyHere'), 3)
      return false
    }
    const spot = s.vehicles?._groundAhead('balloon')
    if (!spot) {
      s._message(t('vehicleNeedRoom'), 3)
      return false
    }
    this._dropRocket('rocket')
    const g = makeRocket(this.B)
    g.position.set(spot.x * this.B, spot.y * this.B, spot.z * this.B)
    s.bm.scene.add(g)
    this.rocket = { ...spot, group: g }
    s._message(t('moonRocketPlaced'), 4)
    try { audioEngine.playPlace?.() } catch { /* no audio */ }
    return true
  }

  _dropRocket(which) {
    const r = this[which]
    if (!r) return
    r.group.removeFromParent()
    disposeTree(r.group)
    this[which] = null
  }

  // The Use key beside a rocket: lift off.
  use() {
    const s = this.s
    if (this.trip || s.dead || s.spectating) return false
    const me = s.bodyPos()
    const near = (r) => r && Math.hypot(me.x - r.x, me.z - r.z) < ENTER_REACH && Math.abs(me.y - r.y) < 3
    if (near(this.rocket)) this._launch(this.rocket, true)
    else if (near(this.home)) this._launch(this.home, false)
    else return false
    return true
  }

  _launch(r, up) {
    const s = this.s
    s.kart?.leave()
    if (up) this.back = { x: r.x, y: r.y, z: r.z }
    this.trip = { t: -COUNTDOWN_S, r, up, said: COUNTDOWN_S + 1 }
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    if (this.trip) this._fly(dt)
    // Gravity and the sky.
    const on = this.on && !this.trip
    s.bm.tryMode.gravityMult = on ? MOON_G : 1
    if (this._sky) this._sky.visible = on || (this.trip && this.trip.t > LIFT_S * 0.6)
    if (this._sky?.visible) this._sky.position.copy(s.bm.camera.position)
    if (on) this._suits()
  }

  // The countdown, then up you go.
  _fly(dt) {
    const s = this.s
    const tr = this.trip
    tr.t += dt
    const r = tr.r
    if (tr.t < 0) {
      const n = Math.ceil(-tr.t)
      if (n < tr.said) {
        tr.said = n
        s._message(t('moonCountdown', { n }), 1)
        try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
      }
      s._ride = { x: r.x, y: r.y + 0.9, z: r.z, eye: 1.4 }
      return
    }
    if (!tr.boom) {
      tr.boom = true
      try { audioEngine.playSpecial?.('jetpack') } catch { /* no audio */ }
      s._message(t(tr.up ? 'moonLiftOff' : 'moonGoingHome'), 3)
    }
    // Speeding up as it climbs; the flame shows.
    const climb = 4 * tr.t * tr.t
    r.group.position.y = (r.y + climb) * this.B
    if (r.group.userData.flame) {
      r.group.userData.flame.visible = true
      r.group.userData.flame.scale.y = 1 + Math.sin(performance.now() / 40) * 0.25
    }
    s._ride = { x: r.x, y: r.y + 0.9 + climb, z: r.z, eye: 1.4 }
    s.bm.sky?.disasters && (s.bm.sky.disasters.shake = Math.max(s.bm.sky.disasters.shake, 0.05 * Math.max(0, 1 - tr.t / LIFT_S)))
    if (tr.t < LIFT_S) return
    // Arrived.
    s._ride = null
    this.trip = null
    r.group.position.y = r.y * this.B
    if (r.group.userData.flame) r.group.userData.flame.visible = false
    if (tr.up) this._arrive()
    else this._home()
  }

  _arrive() {
    const s = this.s
    if (!this.built) this._build()
    const tm = s.bm.tryMode
    tm.pos.set(this.cx + 3, this._top(this.cx + 3, this.cz) , this.cz)
    tm.vel?.set(0, 0, 0)
    // Waves follow you: the zombies on Earth are left behind.
    s._message(t('moonArrived'), 6)
    try { audioEngine.playSpecial?.('bell') } catch { /* no audio */ }
  }

  _home() {
    const s = this.s
    const b = this.back || this.rocket || { x: s.bm.tryMode._spawn?.x ?? 0, y: s.bm.tryMode._spawn?.y ?? 80, z: s.bm.tryMode._spawn?.z ?? 0 }
    const x = b.x + 2
    const z = b.z
    s.bm.tryMode.pos.set(x, s._groundUnder(x, b.y + 4, z), z)
    s.bm.tryMode.vel?.set(0, 0, 0)
    s._message(t('moonHome'), 4)
  }

  // The Moon's ground height at a column (the y you stand at).
  _top(x, z) {
    return MOON_Y + 1 + this._bump(Math.floor(x), Math.floor(z))
  }

  // Craters: bowls pressed into the grey ground (0 = flat, -1 / -2 deep, +1 a rim).
  _bump(x, z) {
    let h = 0
    for (const c of this._craters) {
      const d = Math.hypot(x - c.x, z - c.z)
      if (d < c.r - 0.5) h = Math.min(h, -Math.round((1 - d / c.r) * c.deep + 0.4))
      else if (d < c.r + 0.8) h = Math.max(h, 1)
    }
    return h
  }

  _build() {
    this.built = true
    const cx = Math.floor(this.cx)
    const cz = Math.floor(this.cz)
    // A few craters, away from the base in the middle.
    const rnd = mulberry(1234)
    this._craters = []
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2
      const d = 8 + rnd() * (MOON_R - 12)
      this._craters.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, r: 2.5 + rnd() * 3, deep: 1 + Math.round(rnd()) })
    }
    const s = this.s
    const bm = s.bm
    bm._suppressUndoRecording = true
    for (let x = cx - MOON_R; x <= cx + MOON_R; x++) {
      for (let z = cz - MOON_R; z <= cz + MOON_R; z++) {
        if (Math.hypot(x - cx, z - cz) > MOON_R) continue
        const h = Math.hypot(x - cx, z - cz) < 5 ? 0 : this._bump(x, z)
        const top = MOON_Y + h
        const n = (x * 7 + z * 13) & 7
        for (let y = MOON_Y - 2; y <= top; y++) this.cells.put(x, y, z, y === top ? (n < 2 ? 'tuff' : n < 3 ? 'calcite' : 'endstone') : 'polishedtuff')
      }
    }
    // The base: a quartz room with a glass roof and a doorway, a lamp inside.
    for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) {
      const edge = Math.abs(x - cx) === 2 || Math.abs(z - cz) === 2
      const door = x === cx + 2 && Math.abs(z - cz) === 0
      if (edge && !door) for (let y = MOON_Y + 1; y <= MOON_Y + 3; y++) this.cells.put(x, y, z, 'smoothquartz')
      else if (door) this.cells.put(x, MOON_Y + 3, z, 'smoothquartz')
      this.cells.put(x, MOON_Y + 4, z, 'glass')
    }
    this.cells.put(cx, MOON_Y + 1, cz - 1, 'sealantern')
    bm._suppressUndoRecording = false
    // The rocket home, beside the base.
    const home = makeRocket(this.B)
    const hx = cx + 6.5
    const hz = cz + 0.5
    home.position.set(hx * this.B, (MOON_Y + 1) * this.B, hz * this.B)
    s.bm.scene.add(home)
    this.home = { x: hx, y: MOON_Y + 1, z: hz, group: home }
    this._makeSky()
  }

  // A black sky with stars and the Earth, kept round the camera while
  // you're up here.
  _makeSky() {
    const B = this.B
    const g = new THREE.Group()
    const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * B, 24, 16), new THREE.MeshBasicMaterial({ color: 0x03040a, side: THREE.BackSide, fog: false, depthWrite: false }))
    dome.renderOrder = -10
    const n = 600
    const pos = new Float32Array(n * 3)
    const rnd = mulberry(99)
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      pos.set([r * Math.cos(a) * SKY_R * 0.95 * B, Math.abs(u) * SKY_R * 0.95 * B - SKY_R * 0.1 * B, r * Math.sin(a) * SKY_R * 0.95 * B], i * 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false }))
    const earth = new THREE.Mesh(new THREE.SphereGeometry(14 * B, 24, 16), new THREE.MeshBasicMaterial({ color: 0x3a7ad8, fog: false }))
    earth.position.set(-60 * B, 70 * B, -90 * B)
    const land = new THREE.Mesh(new THREE.SphereGeometry(14.2 * B, 12, 8, 0, 1.6, 0.6, 1.2), new THREE.MeshBasicMaterial({ color: 0x4aa84a, fog: false }))
    land.position.copy(earth.position)
    g.add(dome, stars, earth, land)
    g.visible = false
    this.s.bm.scene.add(g)
    this._sky = g
  }

  // Zombies on the Moon wear space helmets and air tanks.
  _suits() {
    const B = this.B
    for (const zb of this.s.zombies) {
      if (zb.suit || !zb.group || Math.abs(zb.y - MOON_Y) > ON_MOON) continue
      zb.suit = true
      const size = zb.size || 1
      const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.75 * B, 0.75 * B, 0.75 * B), new THREE.MeshLambertMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35, depthWrite: false }))
      helmet.position.y = 1.62 * B / size
      const tank = new THREE.Mesh(new THREE.BoxGeometry(0.45 * B, 0.6 * B, 0.25 * B), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }))
      tank.position.set(0, 1.05 * B / size, -0.3 * B)
      zb.group.add(helmet, tank)
    }
  }

  // Zombies come out of the Moon's craters (BuildSurvival._spawnSpots).
  spawnSpots() {
    const out = []
    for (const c of this._craters || []) out.push([Math.floor(c.x), this._top(c.x, c.z), Math.floor(c.z)])
    return out
  }

  protects(x, y, z) {
    return this.built && this.cells.has(x, y, z)
  }

  clear() {
    this.cells.restore()
    this._dropRocket('rocket')
    this._dropRocket('home')
    if (this._sky) {
      this._sky.removeFromParent()
      disposeTree(this._sky)
      this._sky = null
    }
    if (this.trip) this.s._ride = null
    this.trip = null
    this.built = false
    this.back = null
    this._craters = []
    if (this.s.bm.tryMode) this.s.bm.tryMode.gravityMult = 1
  }
}

// A white rocket with red fins and a window, standing up; a flame under it.
export function makeRocket(B) {
  const g = new THREE.Group()
  const box = (w, h, d, color, x, y, z, extra = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, ...extra }))
    m.position.set(x * B, y * B, z * B)
    g.add(m)
    return m
  }
  box(1.2, 4, 1.2, 0xeeeeee, 0, 2.6, 0)
  box(0.8, 0.8, 0.8, 0xd8352a, 0, 5, 0)
  box(0.4, 0.5, 0.4, 0xd8352a, 0, 5.6, 0)
  box(0.5, 0.5, 0.06, 0x8fd6ff, 0, 3.6, 0.62, { emissive: 0x2a6a88 })
  for (const [x, z] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) box(x ? 0.5 : 0.1, 1.2, z ? 0.5 : 0.1, 0xd8352a, x, 0.9, z)
  box(0.8, 0.4, 0.8, 0x444444, 0, 0.4, 0)
  const flame = new THREE.Mesh(new THREE.BoxGeometry(0.6 * B, 1.6 * B, 0.6 * B), new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.85 }))
  flame.position.y = -0.6 * B
  flame.visible = false
  g.add(flame)
  g.userData.flame = flame
  return g
}

function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t2 = a
    t2 = Math.imul(t2 ^ (t2 >>> 15), t2 | 1)
    t2 ^= t2 + Math.imul(t2 ^ (t2 >>> 7), t2 | 61)
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
