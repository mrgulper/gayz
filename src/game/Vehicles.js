// Crafted boats and helicopters (2026-11-01, Gaymi's idea list 2, big
// batch: "boats + helicopters - crafted"). Owned by BuildSurvival
// (`survival.vehicles`).
//
// - Craft a Boat or a Helicopter (PlayCrafting.js), hold it and use it
//   (click / the phone's use button): a boat goes on the water in front of
//   you, a helicopter on open ground in front of you.
// - Right-click one, or press Use beside it, to get in; right-click or Use
//   again gets out (a helicopter has to be near the ground first), and so
//   does Crouch in a boat.
// - A boat only moves on water: forward / back / left / right like the
//   go-kart. A helicopter flies where you look: forward / back / sideways,
//   Jump to climb, Crouch to go down.
// - Helicopters burn fuel (Gaymi picked "uses fuel"): a full tank is
//   HELI_FUEL_S seconds of flying, a new one comes with one. Craft Heli
//   Fuel (from zombie goo) and use it in or beside one, or keep some on
//   you and the tank refills itself from it when it runs dry. Empty, it
//   sinks slowly to the ground.
// - On a server everyone sees your boats and helicopters (snapshot() goes
//   out with your state, `veh` in api/_lib/servers.js; drawRemote() draws
//   the others').
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

const ENTER_REACH = 3
const HINT_REACH = 5
// At most this many of yours out at once: placing another takes the
// oldest one you're not in away.
export const MAX_OUT = 4
// Boat.
const BOAT_SPEED = 12
const BOAT_REVERSE = 4
const BOAT_ACCEL = 9
const BOAT_COAST = 3
const BOAT_TURN = 2
const BOAT_EYE = 0.9
// Helicopter.
export const HELI_FUEL_S = 60
const HELI_SPEED = 14
const HELI_ACCEL = 10
const HELI_CLIMB = 7
const HELI_SINK_EMPTY = 2.5
// How high above the ground under it a helicopter can go.
export const HELI_CEILING = 40
const HELI_EYE = 1.3
const HELI_R = 0.9
// Getting out: no higher than this over the ground.
const HELI_EXIT_HIGH = 2.5

const isWater = (bm, x, y, z) => {
  const type = bm.getBlockAt(x, y, z)
  return type === 'water' || (!!type && bm._cellIsLiquid(x, y, z) && type !== 'lava')
}

export class Vehicles {
  constructor(survival) {
    this.s = survival
    this.list = []
    this.riding = null
    this._n = 0
  }

  get B() {
    return this.s.B
  }

  get bm() {
    return this.s.bm
  }

  clear() {
    this.riding = null
    for (const v of this.list) disposeGroup(v.group)
    this.list = []
    this._hinted = false
    this._fuelEl?.remove()
    this._fuelEl = null
  }

  // Holding a Boat / Helicopter and using it (PlayInventory.useHeld).
  // -> true if one was put down.
  place(kind) {
    const s = this.s
    if (s.dead || s.spectating || this.riding) return false
    const spot = kind === 'boat' ? this._waterAhead() : this._groundAhead()
    if (!spot) {
      s._message(t(kind === 'boat' ? 'vehicleNeedWater' : 'vehicleNeedRoom'), 3)
      return false
    }
    // Too many out: the oldest one you're not in goes.
    const mine = this.list.filter((v) => v !== this.riding)
    if (this.list.length >= MAX_OUT && mine.length) this._remove(mine[0])
    const v = {
      id: ++this._n,
      kind,
      x: spot.x,
      y: spot.y,
      z: spot.z,
      heading: this.bm._yaw + Math.PI,
      speed: 0,
      side: 0,
      vy: 0,
      fuel: kind === 'heli' ? HELI_FUEL_S : 0,
      rotor: 0,
      group: kind === 'boat' ? makeBoat(this.B) : makeHeli(this.B),
    }
    this.bm.scene.add(v.group)
    this.list.push(v)
    this._place(v, 0)
    s._message(t(kind === 'boat' ? 'vehicleBoatPlaced' : 'vehicleHeliPlaced'), 4)
    try { audioEngine.playPlace?.() } catch { /* no audio */ }
    return true
  }

  _remove(v) {
    if (this.riding === v) this.leave(true)
    disposeGroup(v.group)
    this.list = this.list.filter((o) => o !== v)
  }

  // Water within a few blocks in front of you: its top.
  _waterAhead() {
    const p = this.bm.tryMode.pos
    const yaw = this.bm._yaw
    for (let d = 1; d <= 5; d += 0.5) {
      const x = p.x - Math.sin(yaw) * d
      const z = p.z - Math.cos(yaw) * d
      const y = this._surface(x, z, p.y)
      if (y !== null) return { x: Math.floor(x) + 0.5, y, z: Math.floor(z) + 0.5 }
    }
    return null
  }

  // The water's top in this column, near height `nearY` (null: no water).
  _surface(x, z, nearY) {
    const cx = Math.floor(x)
    const cz = Math.floor(z)
    for (let cy = Math.floor(nearY) + 1; cy >= Math.floor(nearY) - 3; cy--) {
      if (isWater(this.bm, cx, cy, cz) && !isWater(this.bm, cx, cy + 1, cz)) {
        return this.s._solid(cx, cy + 1, cz) ? null : cy + 0.85
      }
    }
    return null
  }

  // Open ground 2..4 blocks in front of you with room for the rotor.
  _groundAhead() {
    const p = this.bm.tryMode.pos
    const yaw = this.bm._yaw
    for (let d = 2.5; d <= 4.5; d += 0.5) {
      const x = Math.floor(p.x - Math.sin(yaw) * d) + 0.5
      const z = Math.floor(p.z - Math.cos(yaw) * d) + 0.5
      if (this.s.camp?.inside(x, z, 1)) continue
      const y = this.s._groundUnder(x, p.y + 3, z)
      if (y === p.y + 3 || Math.abs(y - p.y) > 3) continue
      if (this._heliBlocked(x, y, z)) continue
      return { x, y, z }
    }
    return null
  }

  _heliBlocked(x, y, z) {
    const cy = Math.floor(y + 0.01)
    for (const [dx, dz] of [[0, 0], [HELI_R, 0], [-HELI_R, 0], [0, HELI_R], [0, -HELI_R]]) {
      const cx = Math.floor(x + dx)
      const cz = Math.floor(z + dz)
      for (let k = 0; k < 3; k++) if (this.s._solid(cx, cy + k, cz)) return true
    }
    return false
  }

  _nearest(reach) {
    const me = this.bm.tryMode.pos
    let best = null
    let bestD = reach
    for (const v of this.list) {
      const d = Math.hypot(me.x - v.x, me.z - v.z)
      if (d <= bestD && Math.abs(me.y - v.y) < 2.5) {
        best = v
        bestD = d
      }
    }
    return best
  }

  // Right-clicking (BuildMode's mouse-down): get in if you're looking at one.
  // Riding, right-click gets out again (like the go-kart).
  rightClick() {
    if (this.riding) return this.use()
    if (this.s.dead || this.s.spectating) return false
    const v = this._nearest(ENTER_REACH + 0.5)
    if (!v) return false
    const cam = this.bm.camera
    const look = cam.getWorldDirection(new THREE.Vector3())
    const to = new THREE.Vector3(v.x * this.B, (v.y + 0.6) * this.B, v.z * this.B).sub(cam.position).normalize()
    if (look.dot(to) < 0.75) return false
    return this.use()
  }

  // The Use key (BuildMode._tryUseFromCamera): in or out.
  use() {
    if (this.s.dead || this.s.spectating) return false
    if (this.riding) {
      this.leave()
      return true
    }
    const v = this._nearest(ENTER_REACH)
    if (!v) return false
    this.s.kart?.leave()
    this.riding = v
    v.speed = 0
    v.side = 0
    this.s._message(t(v.kind === 'boat' ? 'vehicleBoatIn' : 'vehicleHeliIn'), 4)
    this._renderFuel()
    return true
  }

  // Out beside it. A helicopter up high says to land first (unless `force`).
  leave(force = false) {
    const v = this.riding
    if (!v) return
    const tm = this.bm.tryMode
    if (v.kind === 'heli' && !force) {
      const ground = this.s._groundUnder(v.x, v.y + 0.5, v.z)
      if (v.y - ground > HELI_EXIT_HIGH) {
        this.s._message(t('vehicleLandFirst'), 2)
        return
      }
    }
    this.riding = null
    v.speed = 0
    v.side = 0
    this._renderFuel()
    const sx = Math.cos(v.heading)
    const sz = -Math.sin(v.heading)
    for (const side of [1.8, -1.8, 2.6, -2.6]) {
      const x = v.x + sx * side
      const z = v.z + sz * side
      const y = this.s._groundUnder(x, v.y + 1.5, z)
      if (Math.abs(y - v.y) < 3 && !tm._hits(x, y + 0.01, z)) {
        tm.pos.set(x, y + 0.01, z)
        return
      }
    }
    // Open water all round: you drop in beside the boat.
    tm.pos.set(v.x + sx * 1.6, v.y - 0.4, v.z + sz * 1.6)
  }

  // Where you sit and see from while riding (BuildTryMode).
  seat() {
    const v = this.riding
    if (!v) return null
    return { x: v.x, y: v.y + 0.01, z: v.z, eye: (v.kind === 'boat' ? BOAT_EYE : HELI_EYE) + (v.bob || 0) }
  }

  // Every frame (BuildSurvival): the parked ones float / settle, the hint.
  update(dt) {
    if (!this.list.length) return
    if (this.riding && (this.s.dead || this.s.spectating)) this.leave(true)
    const me = this.s.bodyPos()
    for (const v of this.list) {
      if (v === this.riding) continue
      if (v.kind === 'boat') this._moveBoat(v, dt, 0, 0)
      else this._moveHeli(v, dt, {})
      if (!this._hinted && !this.s.dead && Math.hypot(me.x - v.x, me.z - v.z) < HINT_REACH) {
        this._hinted = true
        this.s._message(t('vehicleHint'), 4)
      }
    }
  }

  // Riding (BuildTryMode.update): your keys or the phone's stick.
  drive(dt, { fwd, back, left, right, stick, up, down }) {
    const v = this.riding
    if (!v) return
    let throttle = (fwd ? 1 : 0) - (back ? 1 : 0)
    let steer = (left ? 1 : 0) - (right ? 1 : 0)
    if (stick) {
      if (!throttle) throttle = THREE.MathUtils.clamp(stick.y, -1, 1)
      if (!steer) steer = THREE.MathUtils.clamp(-stick.x, -1, 1)
    }
    if (v.kind === 'boat') this._moveBoat(v, dt, throttle, steer)
    else this._moveHeli(v, dt, { throttle, steer, up, down, riding: true })
  }

  _moveBoat(v, dt, throttle, steer) {
    if (throttle && Math.sign(throttle) !== Math.sign(v.speed) && Math.abs(v.speed) > 0.5) v.speed += Math.sign(throttle) * BOAT_ACCEL * 2 * dt
    else if (throttle) v.speed += throttle * BOAT_ACCEL * dt
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), BOAT_COAST * dt)
    v.speed = THREE.MathUtils.clamp(v.speed, -BOAT_REVERSE, BOAT_SPEED)
    v.heading += steer * BOAT_TURN * dt * THREE.MathUtils.clamp(Math.abs(v.speed) / 4 + 0.3, 0, 1) * Math.sign(v.speed || 1)
    const nx = v.x + Math.sin(v.heading) * v.speed * dt
    const nz = v.z + Math.cos(v.heading) * v.speed * dt
    // Only on water: the shore (or a wall) bumps it back.
    const surf = this._surface(nx, nz, v.y)
    if (surf === null || Math.abs(surf - v.y) > 1.2) {
      if (Math.abs(v.speed) > 3) try { audioEngine.playMelee?.() } catch { /* no audio */ }
      v.speed *= -0.3
    } else {
      v.x = nx
      v.z = nz
      v.y = surf
    }
    // The water it was on is gone (broken out, drained): it sits there.
    v.bob = Math.sin(performance.now() / 450 + v.id) * 0.06
    this._place(v, dt)
  }

  _moveHeli(v, dt, { throttle = 0, steer = 0, up = false, down = false, riding = false }) {
    const ground = this.s._groundUnder(v.x, v.y + 0.5, v.z)
    const air = v.y - ground > 0.05
    let lift = 0
    if (riding && v.fuel > 0) {
      lift = (up ? 1 : 0) - (down ? 1 : 0)
      // It points the way you look.
      let dh = this.bm._yaw + Math.PI - v.heading
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      v.heading += dh * Math.min(1, dt * 6)
    }
    // Fuel burns while it's up or climbing.
    if (riding && (air || lift > 0)) this._burn(v, dt)
    const powered = riding && v.fuel > 0
    // Forward / back along where it points, sideways for left / right.
    const want = powered ? throttle * HELI_SPEED : 0
    const wantSide = powered ? steer * HELI_SPEED * 0.7 : 0
    const k = Math.min(1, (HELI_ACCEL / HELI_SPEED) * dt * 2)
    v.speed += (want - v.speed) * k
    v.side += (wantSide - v.side) * k
    if (!air && !powered) {
      v.speed = 0
      v.side = 0
    }
    const fx = Math.sin(v.heading)
    const fz = Math.cos(v.heading)
    const nx = v.x + (fx * v.speed + fz * v.side) * dt
    const nz = v.z + (fz * v.speed - fx * v.side) * dt
    if (!this._heliBlocked(nx, v.y, nz)) {
      v.x = nx
      v.z = nz
    } else {
      v.speed *= -0.2
      v.side *= -0.2
    }
    // Up and down: Jump / Crouch, no higher than HELI_CEILING over the
    // ground. Empty (or nobody in it) it sinks to the ground.
    let vy = powered ? lift * HELI_CLIMB : -HELI_SINK_EMPTY
    if (!powered && !riding) vy = -HELI_SINK_EMPTY * 2
    const g = this.s._groundUnder(v.x, v.y + 0.5, v.z)
    let ny = v.y + vy * dt
    if (ny > g + HELI_CEILING) ny = Math.max(v.y, g + HELI_CEILING)
    if (vy > 0 && this._heliBlocked(v.x, ny + 0.3, v.z)) ny = v.y
    v.y = Math.max(g, ny)
    // The rotor spins with the engine on (or still slowing down).
    v.rotor = THREE.MathUtils.damp(v.rotor, powered ? 1 : 0, 2, dt)
    v.bob = 0
    this._place(v, dt)
  }

  _burn(v, dt) {
    const had = v.fuel
    v.fuel = Math.max(0, v.fuel - dt)
    if (v.fuel === 0 && had > 0) {
      // Fuel on you: the tank fills itself from it.
      if (this.s.inv?.takeItem?.('heliFuel')) {
        v.fuel = HELI_FUEL_S
        this.s._message(t('vehicleRefueled'), 3)
      } else this.s._message(t('vehicleOutOfFuel'), 4)
    } else if (had > 10 && v.fuel <= 10) this.s._message(t('vehicleLowFuel'), 3)
    if (Math.ceil(had) !== Math.ceil(v.fuel)) this._renderFuel()
  }

  // Using Heli Fuel (PlayInventory.useHeld): fills the helicopter you're
  // in or standing next to. -> true if used.
  addFuel() {
    const v = this.riding?.kind === 'heli' ? this.riding : this.list.find((o) => o.kind === 'heli' && Math.hypot(o.x - this.bm.tryMode.pos.x, o.z - this.bm.tryMode.pos.z) < ENTER_REACH + 1)
    if (!v) {
      this.s._message(t('vehicleFuelNoHeli'), 3)
      return false
    }
    if (v.fuel >= HELI_FUEL_S - 0.5) {
      this.s._message(t('vehicleFuelFull'), 2)
      return false
    }
    v.fuel = HELI_FUEL_S
    this.s._message(t('vehicleRefueled'), 3)
    this._renderFuel()
    return true
  }

  // The fuel left, under the crosshair while you fly one.
  _renderFuel() {
    const v = this.riding
    const on = v?.kind === 'heli'
    if (!this._fuelEl) {
      if (!on) return
      this._fuelEl = document.createElement('div')
      this._fuelEl.id = 'vehicle-fuel'
      document.body.appendChild(this._fuelEl)
    }
    this._fuelEl.classList.toggle('on', on)
    this._fuelEl.classList.toggle('low', on && v.fuel <= 10)
    if (on) this._fuelEl.textContent = t('vehicleFuelHud', { s: Math.ceil(v.fuel) })
  }

  _place(v, dt) {
    const B = this.B
    v.group.position.set(v.x * B, (v.y + (v.bob || 0)) * B, v.z * B)
    v.group.rotation.y = v.heading
    const ud = v.group.userData
    if (ud.rotor) {
      ud.rotor.rotation.y += v.rotor * dt * 28
      ud.tail.rotation.x += v.rotor * dt * 34
      // Leaning into the way it flies.
      v.group.rotation.x = THREE.MathUtils.damp(v.group.rotation.x, (v.speed / HELI_SPEED) * 0.18, 4, dt)
      v.group.rotation.z = THREE.MathUtils.damp(v.group.rotation.z, (-v.side / HELI_SPEED) * 0.18, 4, dt)
    } else {
      v.group.rotation.z = Math.sin(performance.now() / 600 + v.id) * 0.04
    }
  }

  // What the other players need to draw mine (PlayNet, each sync).
  snapshot() {
    return this.list.map((v) => ({ k: v.kind === 'boat' ? 'b' : 'h', x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2), h: +v.heading.toFixed(2), r: v.rotor > 0.05 ? 1 : 0 }))
  }

  dispose() {
    this.clear()
  }
}

// Another player's boats and helicopters (PlayNet._drawPlayer): made,
// slid along and spun from their latest `veh` list.
export function drawRemote(survival, p, dt) {
  const list = Array.isArray(p.veh) ? p.veh : []
  if (!p.vehicles) p.vehicles = []
  const B = survival.B
  // One model per slot; a slot changing kind gets a new one.
  while (p.vehicles.length > list.length) disposeGroup(p.vehicles.pop().group)
  const k = 1 - Math.exp(-12 * dt)
  list.forEach((d, i) => {
    let m = p.vehicles[i]
    if (m && m.k !== d.k) {
      disposeGroup(m.group)
      m = null
    }
    if (!m) {
      m = { k: d.k, x: d.x, y: d.y, z: d.z, h: d.h, group: d.k === 'b' ? makeBoat(B) : makeHeli(B) }
      survival.bm.scene.add(m.group)
      p.vehicles[i] = m
    }
    m.x += (d.x - m.x) * k
    m.y += (d.y - m.y) * k
    m.z += (d.z - m.z) * k
    let dh = d.h - m.h
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    m.h += dh * k
    m.group.position.set(m.x * B, m.y * B, m.z * B)
    m.group.rotation.y = m.h
    const ud = m.group.userData
    if (ud.rotor && d.r) {
      ud.rotor.rotation.y += dt * 28
      ud.tail.rotation.x += dt * 34
    }
  })
}

export function disposeRemote(p) {
  for (const m of p.vehicles || []) disposeGroup(m.group)
  p.vehicles = []
}

// A `veh` list from the server, made safe (PlayNet._apply).
export function cleanRemote(list) {
  if (!Array.isArray(list)) return []
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return list.slice(0, MAX_OUT).filter((d) => d && (d.k === 'b' || d.k === 'h')).map((d) => ({ k: d.k, x: n(d.x), y: n(d.y), z: n(d.z), h: n(d.h), r: d.r ? 1 : 0 }))
}

function disposeGroup(group) {
  if (!group) return
  group.removeFromParent()
  group.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}

// Boxes, facing +z. A wooden rowboat: a flat hull with raised sides, a
// pointed bow, two benches and a little outboard motor.
export function makeBoat(B) {
  const g = new THREE.Group()
  const box = (w, h, d, color, x, y, z, parent = g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
    m.position.set(x * B, y * B, z * B)
    parent.add(m)
    return m
  }
  const wood = 0x8a5a32
  const dark = 0x5e3b1f
  box(1.4, 0.15, 2.6, dark, 0, -0.05, 0)
  box(0.15, 0.45, 2.6, wood, -0.72, 0.15, 0)
  box(0.15, 0.45, 2.6, wood, 0.72, 0.15, 0)
  box(1.4, 0.45, 0.15, wood, 0, 0.15, -1.3)
  // The bow narrows to a point.
  box(1.0, 0.45, 0.4, wood, 0, 0.15, 1.45)
  box(0.5, 0.45, 0.35, wood, 0, 0.15, 1.75)
  box(1.3, 0.1, 0.35, 0xb98a5a, 0, 0.25, 0.5)
  box(1.3, 0.1, 0.35, 0xb98a5a, 0, 0.25, -0.6)
  // A white stripe and the motor.
  box(1.46, 0.08, 2.0, 0xeeeeee, 0, 0.3, 0)
  box(0.35, 0.45, 0.35, 0x333333, 0, 0.35, -1.5)
  box(0.12, 0.6, 0.12, 0x555555, 0, -0.05, -1.6)
  return g
}

// A little blocky one-seat helicopter: a round-ish cabin with a glass
// front, a tail boom with a small side rotor, skids, and the main rotor.
export function makeHeli(B) {
  const g = new THREE.Group()
  const box = (w, h, d, color, x, y, z, parent = g, emissive = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, emissive }))
    m.position.set(x * B, y * B, z * B)
    parent.add(m)
    return m
  }
  const paint = 0xd9a020
  const dark = 0x22241f
  box(1.5, 1.2, 2.0, paint, 0, 1.0, 0)
  box(1.3, 0.8, 0.5, 0x8fc4d9, 0, 1.15, 1.15, g, 0x1a2c33)
  box(1.3, 0.3, 0.4, paint, 0, 0.55, 1.1)
  box(0.35, 0.35, 2.4, paint, 0, 1.25, -2.1)
  box(0.12, 0.8, 0.5, paint, 0, 1.6, -3.2)
  box(0.12, 0.12, 2.2, dark, -0.65, 0.12, 0.1)
  box(0.12, 0.12, 2.2, dark, 0.65, 0.12, 0.1)
  for (const [x, z] of [[-0.65, 0.6], [0.65, 0.6], [-0.65, -0.5], [0.65, -0.5]]) box(0.1, 0.35, 0.1, dark, x, 0.32, z)
  box(0.25, 0.3, 0.25, dark, 0, 1.75, 0)
  const rotor = new THREE.Group()
  rotor.position.y = 1.95 * B
  for (const r of [0, Math.PI / 2]) box(4.6, 0.05, 0.25, dark, 0, 0, 0, rotor).rotation.y = r
  g.add(rotor)
  const tail = new THREE.Group()
  tail.position.set(0.12 * B, 1.6 * B, -3.25 * B)
  box(0.04, 0.9, 0.12, dark, 0, 0, 0, tail)
  g.add(tail)
  g.userData.rotor = rotor
  g.userData.tail = tail
  return g
}
