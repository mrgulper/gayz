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
// - Couch Co-op (Batch 5c): only whoever climbs in goes. An equal Player 2
//   can place and fly the rocket too (Y beside it); the countdown is
//   COUCH_COUNTDOWN_S then, so the other player can run over and climb in.
//   Gravity and the starry sky follow each player (viewSky, gravityAt).
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'
import { traveller, travellerIds } from './Travellers.js'

export const MOON_Y = 300
export const MOON_R = 26
export const MOON_G = 0.3
export const COUNTDOWN_S = 3
export const LIFT_S = 4
export const COUCH_COUNTDOWN_S = 6
const SKY_R = 160
const ENTER_REACH = 3
const ON_MOON = 25 // within this many blocks of MOON_Y you're on the Moon

export class MoonTrip {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.rocket = null // the one on Earth: { x, y, z, group }
    this.home = null // the one on the Moon
    this.trip = null // { t, r, up, riders: Set('p1' | 'p2'), said }
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

  // Player 1 on the Moon (the rest of the game asks this).
  get on() {
    return this.onAt(this.s.bm.tryMode.pos)
  }

  // Is a body at p on the Moon? (Couch Co-op's Player 2 too, Batch 5c.)
  onAt(p) {
    if (!this.built || !p) return false
    return Math.abs(p.y - MOON_Y) < ON_MOON && Math.hypot(p.x - this.cx, p.z - this.cz) < SKY_R * 0.8
  }

  // Couch Co-op (Batch 5c, Gaymi: "longer countdown"): the other player
  // gets time to run over and climb in too.
  get countdown() {
    return traveller(this.s, 'p2') ? COUCH_COUNTDOWN_S : COUNTDOWN_S
  }

  // Holding the Rocket and using it (PlayInventory.useHeld, or Couch
  // Co-op's Player 2 - CouchGear). -> true if it went down (then it's used up).
  place(who = 'p1') {
    const s = this.s
    const me = traveller(s, who)
    if (!me || s.dead || this.trip) return false
    if (this.onAt(me.pos())) {
      me.say(t('moonAlreadyHere'), 3)
      return false
    }
    const spot = s.vehicles?._groundAhead('balloon', me.pos(), me.yaw())
    if (!spot) {
      me.say(t('vehicleNeedRoom'), 3)
      return false
    }
    this._dropRocket('rocket')
    const g = makeRocket(this.B)
    g.position.set(spot.x * this.B, spot.y * this.B, spot.z * this.B)
    s.bm.scene.add(g)
    this.rocket = { ...spot, group: g }
    me.say(t('moonRocketPlaced'), 4)
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

  _near(r, p) {
    return !!r && Math.hypot(p.x - r.x, p.z - r.z) < ENTER_REACH && Math.abs(p.y - r.y) < 3
  }

  // The Use key beside a rocket (Player 2: Y): lift off - or, during the
  // countdown, climb in too.
  use(who = 'p1') {
    const s = this.s
    const me = traveller(s, who)
    if (!me || s.dead || (who === 'p1' && s.spectating)) return false
    if (who === 'p2' && s.couch?.p2.isDown) return false
    const at = me.pos()
    const tr = this.trip
    if (tr) {
      if (tr.t >= 0 || tr.riders.has(who) || !this._near(tr.r, at)) return false
      this._climbIn(who)
      me.say(t('moonClimbedIn'), 2)
      return true
    }
    if (this._near(this.rocket, at)) this._launch(this.rocket, true, who)
    else if (this._near(this.home, at)) this._launch(this.home, false, who)
    else return false
    return true
  }

  _climbIn(who) {
    traveller(this.s, who)?.leaveRide()
    this.trip.riders.add(who)
  }

  _launch(r, up, who) {
    if (up) this.back = { x: r.x, y: r.y, z: r.z }
    const n = this.countdown
    this.trip = { t: -n, r, up, said: n + 1, riders: new Set() }
    this._climbIn(who)
    // The other player, if they're close: there's time to climb in.
    for (const id of travellerIds(this.s)) {
      if (id === who) continue
      const other = traveller(this.s, id)
      const p = other.pos()
      if (Math.hypot(p.x - r.x, p.z - r.z) < 24 && Math.abs(p.y - r.y) < 12) other.say(t(`${up ? 'moonJoinUp' : 'moonJoinHome'}${id === 'p2' ? 'P2' : ''}`, { n }), 3)
    }
  }

  // Riders still in the game (Player 2 can leave mid-trip).
  _riders() {
    return [...this.trip.riders].map((id) => traveller(this.s, id)).filter(Boolean)
  }

  // Is this player riding the rocket right now?
  riding(who) {
    return !!this.trip?.riders.has(who)
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    if (this.trip) this._fly(dt)
    // Gravity and the sky.
    s.bm.tryMode.gravityMult = this.on && !this.riding('p1') ? MOON_G : 1
    this.viewSky('p1', s.bm.camera)
    if (this.built && (this.on || this.onAt(s.couch?.joined && s.couch.p2))) this._suits()
  }

  // Player 2's gravity (CouchCoop._physics): the Moon's, up there.
  gravityAt(p) {
    return this.onAt(p) ? MOON_G : 1
  }

  // The starry sky shows for whoever is on the Moon (or nearly up), and
  // only on their half of a split screen (CouchCoop.drawFrame).
  viewSky(who, camera) {
    if (!this._sky) return
    const me = traveller(this.s, who)
    const p = me?.pos()
    const tr = this.trip
    const show = !!p && ((this.onAt(p) && !this.riding(who)) || (!!tr && tr.riders.has(who) && tr.t > LIFT_S * 0.6))
    this._sky.visible = show
    if (show) this._sky.position.copy(camera.position)
  }

  // The countdown, then up you go.
  _fly(dt) {
    const s = this.s
    const tr = this.trip
    tr.t += dt
    const r = tr.r
    const riders = this._riders()
    if (!riders.length) {
      this.trip = null
      return
    }
    const seat = (id, climb) => {
      const i = [...tr.riders].indexOf(id)
      const spot = { x: r.x + (i ? 0.35 : 0), y: r.y + 0.9 + climb, z: r.z }
      if (id === 'p1') s._ride = { ...spot, eye: 1.4 }
      else if (s.couch) s.couch.p2.lockedTo = spot
    }
    if (tr.t < 0) {
      const n = Math.ceil(-tr.t)
      if (n < tr.said) {
        tr.said = n
        for (const me of riders) me.say(t('moonCountdown', { n }), 1)
        try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
      }
      for (const id of tr.riders) seat(id, 0)
      return
    }
    if (!tr.boom) {
      tr.boom = true
      try { audioEngine.playSpecial?.('jetpack') } catch { /* no audio */ }
      for (const me of riders) me.say(t(tr.up ? 'moonLiftOff' : 'moonGoingHome'), 3)
    }
    // Speeding up as it climbs; the flame shows.
    const climb = 4 * tr.t * tr.t
    r.group.position.y = (r.y + climb) * this.B
    if (r.group.userData.flame) {
      r.group.userData.flame.visible = true
      r.group.userData.flame.scale.y = 1 + Math.sin(performance.now() / 40) * 0.25
    }
    for (const id of tr.riders) seat(id, climb)
    if (tr.riders.has('p1')) s.bm.sky?.disasters && (s.bm.sky.disasters.shake = Math.max(s.bm.sky.disasters.shake, 0.05 * Math.max(0, 1 - tr.t / LIFT_S)))
    if (tr.t < LIFT_S) return
    // Arrived.
    this._unseat()
    this.trip = null
    r.group.position.y = r.y * this.B
    if (r.group.userData.flame) r.group.userData.flame.visible = false
    if (tr.up) this._arrive(riders)
    else this._home(riders)
  }

  _unseat() {
    if (this.trip?.riders.has('p1')) this.s._ride = null
    if (this.s.couch) this.s.couch.p2.lockedTo = null
  }

  _arrive(riders) {
    const s = this.s
    if (!this.built) this._build()
    riders.forEach((me, i) => {
      const z = this.cz + i * 1.2
      me.put(this.cx + 3, this._top(this.cx + 3, z), z)
      // Waves follow you: the zombies on Earth are left behind.
      me.say(t('moonArrived'), 6)
    })
    try { audioEngine.playSpecial?.('bell') } catch { /* no audio */ }
    s._renderHud?.()
  }

  _home(riders) {
    const s = this.s
    const b = this.back || this.rocket || { x: s.bm.tryMode._spawn?.x ?? 0, y: s.bm.tryMode._spawn?.y ?? 80, z: s.bm.tryMode._spawn?.z ?? 0 }
    riders.forEach((me, i) => {
      const x = b.x + 2
      const z = b.z + i * 1.2
      me.put(x, s._groundUnder(x, b.y + 4, z), z)
      me.say(t('moonHome'), 4)
    })
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
    if (this.trip) this._unseat()
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
