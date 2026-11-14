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
// - Hot-air balloons (2026-11-01, Gaymi's idea list 4, quick wins: "up
//   down and wind also some fuel"): crafted too and put down on open
//   ground. You only steer up and down - Jump lights the burner (it burns
//   fuel, BALLOON_FUEL_S a tank, filled from Heli Fuel like a helicopter),
//   Crouch lets air out, neither and it sinks slowly. The wind
//   (BuildSky.wind) pushes it along, harder the higher it is.
// - Submarines (2026-11-02, Gaymi's idea list 5: "dive in a craftable sub
//   and explore sea-floor ruins"): crafted, put on water like a boat. The
//   keys drive it like a boat, Jump rises and Crouch dives (SUB_DIVE). It
//   only moves through water and never above the surface. Use / right-click
//   gets out, even deep down (you swim up). Riding one over the deep sea
//   finds reefs and sunken ruins (Reefs.js). No fuel.
// - Jet skis (2026-11-09, Gaymi's idea list 10: "a fast ride on the
//   water that jumps over waves, while sea zombies grab at you"): crafted,
//   put on water like a boat. JET_SPEED top speed, quick to turn; going
//   faster than JET_HOP_SPEED it bounces off the waves now and then. While
//   you ride, sea zombies come up out of the water near you (one every
//   JET_SEA_EVERY seconds, JET_SEA_MAX at once - alone or as the host); one
//   that gets within JET_GRAB_R blocks grabs it and holds you down to
//   JET_GRAB_SPEED for JET_GRAB_S seconds.
// - On a server everyone sees your boats and helicopters (snapshot() goes
//   out with your state, `veh` in api/_lib/servers.js; drawRemote() draws
//   the others').
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { makeKart } from './GoKart.js'
import { REALM_KINDS } from './ZombieKinds.js'
import { hintOk } from './GameplayAssist.js'

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
// Hot-air balloon. Climb / vent / sink speeds (blocks/s), how quickly it
// gets there (a balloon is slow to answer), the wind speed it drifts at
// (blocks/s, never less than BALLOON_WIND_MIN, more the higher it is).
export const BALLOON_FUEL_S = 60
const BALLOON_CLIMB = 3.2
const BALLOON_VENT = 3
const BALLOON_SINK = 0.7
const BALLOON_EASE = 1.2
const BALLOON_WIND_MIN = 1.2
const BALLOON_WIND_K = 1.6
const BALLOON_WIND_HIGH = 30
export const BALLOON_CEILING = 60
const BALLOON_EYE = 1.35
const BALLOON_R = 1.3
// The envelope's bottom and top over the basket floor (blocks).
const BALLOON_ENV_LOW = 2.6
const BALLOON_ENV_HIGH = 9.5
// Submarine.
export const SUB_SPEED = 8
const SUB_ACCEL = 6
const SUB_TURN = 1.6
export const SUB_DIVE = 4
const SUB_EYE = 0.7
// Jet ski.
export const JET_SPEED = 20
const JET_ACCEL = 16
const JET_TURN = 2.6
const JET_EYE = 0.85
export const JET_HOP_SPEED = 12
const JET_HOP_EVERY = [1.2, 2.6]
const JET_GRAVITY = 14
export const JET_SEA_EVERY = 6
export const JET_SEA_MAX = 3
export const JET_GRAB_R = 1.8
export const JET_GRAB_SPEED = 5
export const JET_GRAB_S = 1.5
const JET_SEA_NEAR = 9
const JET_SEA_FAR = 15
const FUEL_FOR = { heli: HELI_FUEL_S, balloon: BALLOON_FUEL_S }
// The text for each kind (i18n keys).
const KEYS = {
  boat: { placed: 'vehicleBoatPlaced', in: 'vehicleBoatIn' },
  heli: { placed: 'vehicleHeliPlaced', in: 'vehicleHeliIn', refueled: 'vehicleRefueled', out: 'vehicleOutOfFuel' },
  balloon: { placed: 'vehicleBalloonPlaced', in: 'vehicleBalloonIn', refueled: 'vehicleBalloonRefueled', out: 'vehicleBalloonOutOfFuel' },
  sub: { placed: 'vehicleSubPlaced', in: 'vehicleSubIn' },
  jetski: { placed: 'vehicleJetSkiPlaced', in: 'vehicleJetSkiIn' },
}
const MAKE = { boat: (B) => makeBoat(B), heli: (B) => makeHeli(B), balloon: (B) => makeBalloon(B), sub: (B) => makeSub(B), jetski: (B) => makeJetSki(B), kart: (B) => makeKart(B) }
// Kinds over the network (snapshot / cleanRemote).
const NET_KIND = { boat: 'b', heli: 'h', balloon: 'a', sub: 's', jetski: 'j', kart: 'k' }
const KIND_OF_NET = { b: 'boat', h: 'heli', a: 'balloon', s: 'sub', j: 'jetski', k: 'kart' }
// A player's list on a server: their boats etc. plus their go-kart.
export const MAX_REMOTE = MAX_OUT + 1

const isWater = (bm, x, y, z) => {
  const type = bm.getBlockAt(x, y, z)
  return type === 'water' || (!!type && bm._cellIsLiquid(x, y, z) && type !== 'lava')
}

export class Vehicles {
  constructor(survival) {
    this.s = survival
    this.list = []
    this.riding = null
    // The one Couch Co-op's equal Player 2 is in (CouchHands.js): Player 1
    // can't get in it, and the other way round.
    this.p2Riding = null
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
    this.p2Riding = null
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
    const wet = kind === 'boat' || kind === 'sub' || kind === 'jetski'
    const spot = wet ? this._waterAhead() : this._groundAhead(kind)
    if (!spot) {
      s._message(t(wet ? 'vehicleNeedWater' : 'vehicleNeedRoom'), 3)
      return false
    }
    // Too many out: the oldest one you're not in goes.
    const mine = this.list.filter((v) => v !== this.riding && v !== this.p2Riding)
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
      fuel: FUEL_FOR[kind] || 0,
      rotor: 0,
      burner: false,
      group: MAKE[kind](this.B),
    }
    this.bm.scene.add(v.group)
    this.list.push(v)
    this._place(v, 0)
    s._message(t(KEYS[kind].placed), 4)
    try { audioEngine.playPlace?.() } catch { /* no audio */ }
    return true
  }

  _remove(v) {
    if (this.riding === v) this.leave(true)
    if (this.p2Riding === v) this.p2Riding = null
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

  // Open ground 2..4 blocks in front of you with room for the rotor (a
  // balloon: a little further, with open sky for the envelope).
  _groundAhead(kind = 'heli') {
    const p = this.bm.tryMode.pos
    const yaw = this.bm._yaw
    const from = kind === 'balloon' ? 3 : 2.5
    for (let d = from; d <= from + 2; d += 0.5) {
      const x = Math.floor(p.x - Math.sin(yaw) * d) + 0.5
      const z = Math.floor(p.z - Math.cos(yaw) * d) + 0.5
      if (this.s.camp?.inside(x, z, 1)) continue
      const y = this.s._groundUnder(x, p.y + 3, z)
      if (y === p.y + 3 || Math.abs(y - p.y) > 3) continue
      if (kind === 'balloon' ? this._balloonBlocked(x, y, z) : this._heliBlocked(x, y, z)) continue
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

  // The basket (3 high, so you fit) and the envelope above it (wider).
  _balloonBlocked(x, y, z) {
    const cy = Math.floor(y + 0.01)
    const r = BALLOON_R * 0.7
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const cx = Math.floor(x + dx)
      const cz = Math.floor(z + dz)
      for (let k = 0; k < 3; k++) if (this.s._solid(cx, cy + k, cz)) return true
    }
    for (const [dx, dz] of [[0, 0], [BALLOON_R * 1.6, 0], [-BALLOON_R * 1.6, 0], [0, BALLOON_R * 1.6], [0, -BALLOON_R * 1.6]]) {
      const cx = Math.floor(x + dx)
      const cz = Math.floor(z + dz)
      for (let k = Math.floor(BALLOON_ENV_LOW); k <= Math.ceil(BALLOON_ENV_HIGH); k++) if (this.s._solid(cx, cy + k, cz)) return true
    }
    return false
  }

  _nearest(reach, me = this.bm.tryMode.pos) {
    let best = null
    let bestD = reach
    for (const v of this.list) {
      if (v === this.p2Riding || v === this.riding) continue
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
    if (v.kind === 'jetski') {
      v.seaIn = JET_SEA_EVERY
      this.s.bingo?.note('jetski')
    }
    v.speed = 0
    v.side = 0
    this.s._message(t(KEYS[v.kind].in), 4)
    this._renderFuel()
    return true
  }

  // Out beside it. A helicopter or balloon up high says to land first
  // (unless `force`).
  leave(force = false) {
    const v = this.riding
    if (!v) return
    const tm = this.bm.tryMode
    if (v.kind !== 'boat' && v.kind !== 'sub' && v.kind !== 'jetski' && !force) {
      const ground = this.s._groundUnder(v.x, v.y + 0.5, v.z)
      if (v.y - ground > HELI_EXIT_HIGH) {
        this.s._message(t('vehicleLandFirst'), 2)
        return
      }
    }
    this.riding = null
    v.speed = 0
    v.side = 0
    v.burner = false
    this._renderFuel()
    const at = this._exitSpot(v)
    tm.pos.set(at.x, at.y, at.z)
  }

  // Where you stand after getting out of `v`.
  _exitSpot(v) {
    const tm = this.bm.tryMode
    const sx = Math.cos(v.heading)
    const sz = -Math.sin(v.heading)
    for (const side of [1.8, -1.8, 2.6, -2.6]) {
      const x = v.x + sx * side
      const z = v.z + sz * side
      const y = this.s._groundUnder(x, v.y + 1.5, z)
      if (Math.abs(y - v.y) < 3 && !tm._hits(x, y + 0.01, z)) return { x, y: y + 0.01, z }
    }
    // Open water all round: you drop in beside the boat.
    return { x: v.x + sx * 1.6, y: v.y - 0.4, z: v.z + sz * 1.6 }
  }

  // ---------- Couch Co-op's equal Player 2 (CouchHands.js) ----------

  // Player 2 at `at` gets in the nearest free one: it, or null.
  enterP2(at) {
    if (this.s.dead || this.p2Riding) return null
    const v = this._nearest(ENTER_REACH, at)
    if (!v) return null
    this.p2Riding = v
    if (v.kind === 'jetski') v.seaIn = JET_SEA_EVERY
    v.speed = 0
    v.side = 0
    return v
  }

  // Player 2 gets out: where they stand, or null (a helicopter or balloon
  // up high has to land first, unless `force`).
  leaveP2(force = false) {
    const v = this.p2Riding
    if (!v) return null
    if (v.kind !== 'boat' && v.kind !== 'sub' && v.kind !== 'jetski' && !force) {
      const ground = this.s._groundUnder(v.x, v.y + 0.5, v.z)
      if (v.y - ground > HELI_EXIT_HIGH) return null
    }
    this.p2Riding = null
    v.speed = 0
    v.side = 0
    v.burner = false
    return this._exitSpot(v)
  }

  // Player 2 drives theirs: the same as Player 1's drive(), steering by
  // Player 2's look (`yaw`) and with its notes on Player 2's half (`note`).
  driveP2(dt, yaw, input, note) {
    const v = this.p2Riding
    if (!v) return
    const riding = this.riding
    const bmYaw = this.bm._yaw
    const message = this.s._message
    this.riding = v
    this.bm._yaw = yaw
    this._asP2 = true
    this.s._message = note
    try {
      this.drive(dt, input)
    } finally {
      this.riding = riding
      this.bm._yaw = bmYaw
      this._asP2 = false
      this.s._message = message
    }
  }

  // Where you sit and see from while riding (BuildTryMode).
  seat(v = this.riding) {
    if (!v) return null
    const eye = v.kind === 'jetski' ? JET_EYE : v.kind === 'boat' ? BOAT_EYE : v.kind === 'sub' ? SUB_EYE : v.kind === 'balloon' ? BALLOON_EYE : HELI_EYE
    return { x: v.x, y: v.y + 0.01, z: v.z, eye: eye + (v.bob || 0) }
  }

  // Every frame (BuildSurvival): the parked ones float / settle, the hint.
  update(dt) {
    if (!this.list.length) return
    if (this.riding && (this.s.dead || this.s.spectating)) this.leave(true)
    const me = this.s.bodyPos()
    for (const v of this.list) {
      if (v === this.riding || v === this.p2Riding) continue
      if (v.kind === 'boat' || v.kind === 'jetski') this._moveBoat(v, dt, 0, 0)
      else if (v.kind === 'sub') this._moveSub(v, dt, 0, 0, 0)
      else if (v.kind === 'balloon') this._moveBalloon(v, dt, {})
      else this._moveHeli(v, dt, {})
      if (!this._hinted && !this.s.dead && Math.hypot(me.x - v.x, me.z - v.z) < HINT_REACH) {
        this._hinted = true
        if (hintOk('vehicle')) this.s._message(t('vehicleHint'), 4)
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
    else if (v.kind === 'jetski') this._moveJet(v, dt, throttle, steer)
    else if (v.kind === 'sub') this._moveSub(v, dt, throttle, steer, (up ? 1 : 0) - (down ? 1 : 0))
    else if (v.kind === 'balloon') this._moveBalloon(v, dt, { up, down, riding: true })
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

  // A jet ski: a fast boat that hops off the waves and gets grabbed.
  _moveJet(v, dt, throttle, steer) {
    v.grab = Math.max(0, (v.grab || 0) - dt)
    const top = v.grab > 0 ? JET_GRAB_SPEED : JET_SPEED
    if (throttle) v.speed += throttle * JET_ACCEL * dt
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), BOAT_COAST * 2 * dt)
    v.speed = THREE.MathUtils.clamp(v.speed, -BOAT_REVERSE, top)
    v.heading += steer * JET_TURN * dt * THREE.MathUtils.clamp(Math.abs(v.speed) / 5 + 0.3, 0, 1) * Math.sign(v.speed || 1)
    const nx = v.x + Math.sin(v.heading) * v.speed * dt
    const nz = v.z + Math.cos(v.heading) * v.speed * dt
    const surf = this._surface(nx, nz, v.y)
    if (surf === null || Math.abs(surf - v.y) > 1.2) {
      if (Math.abs(v.speed) > 3) try { audioEngine.playMelee?.() } catch { /* no audio */ }
      v.speed *= -0.3
    } else {
      v.x = nx
      v.z = nz
      v.y = surf
    }
    // Off a wave now and then at speed: up, and back down with a splash.
    v.air = v.air || 0
    v.airV = v.airV || 0
    if (v.air > 0 || v.airV > 0) {
      v.airV -= JET_GRAVITY * dt
      v.air += v.airV * dt
      if (v.air <= 0) {
        v.air = 0
        v.airV = 0
        try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
      }
    } else if (v.speed > JET_HOP_SPEED) {
      v.hopIn = (v.hopIn ?? 1) - dt
      if (v.hopIn <= 0) {
        v.hopIn = JET_HOP_EVERY[0] + Math.random() * (JET_HOP_EVERY[1] - JET_HOP_EVERY[0])
        v.airV = 3.5 + Math.random() * 2.5
      }
    }
    v.bob = v.air + Math.sin(performance.now() / 300 + v.id) * 0.05
    this._place(v, dt)
    v.group.rotation.x = THREE.MathUtils.damp(v.group.rotation.x, v.air > 0 ? -v.airV * 0.05 : -v.speed * 0.006, 6, dt)
    this._seaZombies(v, dt)
  }

  // Sea zombies come up round a jet ski, and grab it.
  _seaZombies(v, dt) {
    const s = this.s
    if (s.cfg?.noZombies || (s.net && !s.net.isHost) || s.party || s.td || s.escape) return
    this._sea = (this._sea || []).filter((z) => z.health > 0 && s.zombies.includes(z))
    v.seaIn = (v.seaIn ?? JET_SEA_EVERY) - dt
    if (v.seaIn <= 0 && this._sea.length < JET_SEA_MAX) {
      v.seaIn = JET_SEA_EVERY
      const kinds = REALM_KINDS.ocean
      for (let i = 0; i < 10; i++) {
        // Somewhere ahead or off to the side, in the water.
        const a = v.heading + (Math.random() - 0.5) * 1.6
        const d = JET_SEA_NEAR + Math.random() * (JET_SEA_FAR - JET_SEA_NEAR)
        const x = v.x + Math.sin(a) * d
        const z = v.z + Math.cos(a) * d
        const y = this._surface(x, z, v.y)
        if (y === null) continue
        const zb = s._extraZombie(Math.floor(x) + 0.5, Math.floor(y), Math.floor(z) + 0.5, kinds.length ? kinds[Math.floor(Math.random() * kinds.length)] : undefined)
        if (zb) {
          this._sea.push(zb)
          if (!this._seaTold) {
            this._seaTold = true
            s._message(t('jetSkiSea'), 3)
          }
        }
        break
      }
    }
    if (v.grab > 0 || v.air > 0.3) return
    for (const z of s.zombies) {
      if (z.health <= 0 || Math.hypot(z.x - v.x, z.z - v.z) > JET_GRAB_R || Math.abs(z.y - v.y) > 2.5) continue
      v.grab = JET_GRAB_S
      v.speed = Math.min(v.speed, JET_GRAB_SPEED)
      s._message(t('jetSkiGrabbed'), 2)
      try { audioEngine.playSpecial?.('clank') } catch { /* no audio */ }
      break
    }
  }

  // A submarine: like a boat, plus up and down, only through water.
  _moveSub(v, dt, throttle, steer, dive) {
    const bm = this.bm
    const wet = (x, y, z) => isWater(bm, Math.floor(x), Math.floor(y), Math.floor(z))
    if (throttle) v.speed += throttle * SUB_ACCEL * dt
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), SUB_ACCEL * 0.5 * dt)
    v.speed = THREE.MathUtils.clamp(v.speed, -SUB_SPEED * 0.4, SUB_SPEED)
    v.heading += steer * SUB_TURN * dt
    const nx = v.x + Math.sin(v.heading) * v.speed * dt
    const nz = v.z + Math.cos(v.heading) * v.speed * dt
    if (wet(nx, v.y + 0.2, nz) && !this.s._solid(Math.floor(nx), Math.floor(v.y + 0.2), Math.floor(nz))) {
      v.x = nx
      v.z = nz
    } else {
      if (Math.abs(v.speed) > 3) try { audioEngine.playMelee?.() } catch { /* no audio */ }
      v.speed *= -0.3
    }
    // Up and down; never out of the top of the water.
    v.vy = THREE.MathUtils.damp(v.vy || 0, dive * SUB_DIVE, 3, dt)
    const ny = v.y + v.vy * dt
    if (v.vy < 0 ? wet(v.x, ny - 0.1, v.z) && !this.s._solid(Math.floor(v.x), Math.floor(ny - 0.1), Math.floor(v.z)) : wet(v.x, ny + 0.6, v.z)) v.y = ny
    else v.vy = 0
    // At the top it bobs on the surface like a boat.
    const surf = this._surface(v.x, v.z, v.y + 1)
    if (surf !== null && v.y > surf - 0.5) {
      v.y = Math.min(v.y, surf - 0.35)
      v.bob = Math.sin(performance.now() / 450 + v.id) * 0.05
    } else v.bob = 0
    v.rotor = Math.abs(v.speed) > 0.3 ? 1 : 0
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

  // A hot-air balloon: up and down are yours, the wind takes it along.
  _moveBalloon(v, dt, { up = false, down = false, riding = false }) {
    const g = this.s._groundUnder(v.x, v.y + 0.5, v.z)
    const air = v.y - g > 0.05
    v.burner = riding && up && v.fuel > 0
    if (v.burner) this._burn(v, dt)
    // Where it's heading up or down; it eases there slowly.
    let want = -BALLOON_SINK
    if (v.burner) want = BALLOON_CLIMB
    else if (riding && down) want = -BALLOON_VENT
    else if (!riding) want = -BALLOON_SINK * 1.6
    v.vy += (want - v.vy) * Math.min(1, dt * BALLOON_EASE)
    let ny = v.y + v.vy * dt
    if (ny > g + BALLOON_CEILING) ny = Math.max(v.y, g + BALLOON_CEILING)
    if (v.vy > 0 && this._balloonBlocked(v.x, ny + 0.2, v.z)) {
      ny = v.y
      v.vy = 0
    }
    v.y = Math.max(g, ny)
    if (v.y <= g && v.vy < 0) v.vy = 0
    // Off the ground the wind carries it, faster the higher it is.
    const w = this._wind(v.y - g)
    const k = Math.min(1, dt * 0.6)
    v.side += ((air ? w.x : 0) - v.side) * k
    v.speed += ((air ? w.z : 0) - v.speed) * k
    if (!air) {
      v.side *= Math.max(0, 1 - dt * 6)
      v.speed *= Math.max(0, 1 - dt * 6)
    }
    const nx = v.x + v.side * dt
    const nz = v.z + v.speed * dt
    if (!this._balloonBlocked(nx, v.y, nz)) {
      v.x = nx
      v.z = nz
    } else {
      v.side = 0
      v.speed = 0
    }
    if (riding) this._renderFuel()
    v.bob = 0
    this._place(v, dt)
  }

  // The wind (blocks/s, x and z) at `high` blocks over the ground: the
  // sky's own (BuildSky.wind) where there is one, else a slow breeze.
  _wind(high) {
    const sky = this.bm.sky?.wind
    let x
    let z
    if (sky && sky.length() > 0.01) {
      x = sky.x / sky.length()
      z = sky.y / sky.length()
    } else {
      this._windAng = (this._windAng || 0) + 0.0005
      x = Math.cos(this._windAng)
      z = Math.sin(this._windAng)
    }
    const strength = Math.max(BALLOON_WIND_MIN, (sky ? sky.length() : 0) * BALLOON_WIND_K) * (1 + Math.max(0, high) / BALLOON_WIND_HIGH)
    return { x: x * strength, z: z * strength }
  }

  _burn(v, dt) {
    const had = v.fuel
    v.fuel = Math.max(0, v.fuel - dt)
    if (v.fuel === 0 && had > 0) {
      // Fuel on you: the tank fills itself from it.
      if (this.s.inv?.takeItem?.('heliFuel')) {
        v.fuel = FUEL_FOR[v.kind]
        this.s._message(t(KEYS[v.kind].refueled), 3)
      } else this.s._message(t(KEYS[v.kind].out), 4)
    } else if (had > 10 && v.fuel <= 10) this.s._message(t('vehicleLowFuel'), 3)
    if (Math.ceil(had) !== Math.ceil(v.fuel)) this._renderFuel()
  }

  // Using Heli Fuel (PlayInventory.useHeld): fills the helicopter or
  // balloon you're in or standing next to. -> true if used.
  addFuel() {
    const fuels = (o) => !!FUEL_FOR[o?.kind]
    const v = fuels(this.riding) ? this.riding : this.list.find((o) => fuels(o) && Math.hypot(o.x - this.bm.tryMode.pos.x, o.z - this.bm.tryMode.pos.z) < ENTER_REACH + 1)
    if (!v) {
      this.s._message(t('vehicleFuelNoHeli'), 3)
      return false
    }
    if (v.fuel >= FUEL_FOR[v.kind] - 0.5) {
      this.s._message(t('vehicleFuelFull'), 2)
      return false
    }
    v.fuel = FUEL_FOR[v.kind]
    this.s._message(t(KEYS[v.kind].refueled), 3)
    this._renderFuel()
    return true
  }

  // The fuel left, under the crosshair while you fly one (a balloon: and
  // how high you are, since height is all you steer).
  _renderFuel() {
    // Player 2's fuel shows on their own half (CouchHands.js).
    if (this._asP2) return
    const v = this.riding
    const on = !!FUEL_FOR[v?.kind]
    if (!this._fuelEl) {
      if (!on) return
      this._fuelEl = document.createElement('div')
      this._fuelEl.id = 'vehicle-fuel'
      document.body.appendChild(this._fuelEl)
    }
    this._fuelEl.classList.toggle('on', on)
    this._fuelEl.classList.toggle('low', on && v.fuel <= 10)
    if (!on) return
    let text = t('vehicleFuelHud', { s: Math.ceil(v.fuel) })
    if (v.kind === 'balloon') text = t('vehicleBalloonHud', { s: Math.ceil(v.fuel), h: Math.max(0, Math.round(v.y - this.s._groundUnder(v.x, v.y + 0.5, v.z))) })
    if (text !== this._fuelText) {
      this._fuelText = text
      this._fuelEl.textContent = text
    }
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
    if (ud.flame) ud.flame.visible = !!v.burner
    if (ud.prop) ud.prop.rotation.z += v.rotor * dt * 20
  }

  // What the other players need to draw mine (PlayNet, each sync).
  snapshot() {
    return this.list.map((v) => ({ k: NET_KIND[v.kind], x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2), h: +v.heading.toFixed(2), r: v.rotor > 0.05 || v.burner ? 1 : 0 }))
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
      m = { k: d.k, x: d.x, y: d.y, z: d.z, h: d.h, group: MAKE[KIND_OF_NET[d.k]](B) }
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
    if (ud.flame) ud.flame.visible = !!d.r
    if (ud.prop && d.r) ud.prop.rotation.z += dt * 20
    // A kart's wheels turn while it's driven.
    if (ud.wheels && d.r) for (const w of ud.wheels) w.rotation.x += dt * 30
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
  return list.slice(0, MAX_REMOTE).filter((d) => d && KIND_OF_NET[d.k]).map((d) => ({ k: d.k, x: n(d.x), y: n(d.y), z: n(d.z), h: n(d.h), r: d.r ? 1 : 0 }))
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

// A blocky hot-air balloon: a wicker basket, four ropes, the burner (its
// flame shows while it burns) and a striped envelope stacked from boxes,
// widest in the middle. Every material is its own (disposeGroup).
export function makeBalloon(B) {
  const g = new THREE.Group()
  const box = (w, h, d, color, x, y, z, emissive = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, emissive }))
    m.position.set(x * B, y * B, z * B)
    g.add(m)
    return m
  }
  const wicker = 0x9a6a36
  const rim = 0x5e3b1f
  // The basket: a floor and four low walls you see over.
  box(1.6, 0.12, 1.6, rim, 0, 0.06, 0)
  box(0.12, 0.9, 1.6, wicker, -0.74, 0.5, 0)
  box(0.12, 0.9, 1.6, wicker, 0.74, 0.5, 0)
  box(1.6, 0.9, 0.12, wicker, 0, 0.5, -0.74)
  box(1.6, 0.9, 0.12, wicker, 0, 0.5, 0.74)
  for (const [x, z] of [[-0.74, -0.74], [0.74, -0.74], [-0.74, 0.74], [0.74, 0.74]]) {
    box(0.16, 0.12, 0.16, rim, x, 0.98, z)
    // Ropes up to the envelope.
    box(0.05, BALLOON_ENV_LOW - 0.9, 0.05, 0x3a2a1a, x * 0.9, (0.9 + BALLOON_ENV_LOW) / 2 + 0.1, z * 0.9)
  }
  // The burner and its flame.
  box(0.4, 0.25, 0.4, 0x333333, 0, 2.15, 0)
  const flame = box(0.26, 0.5, 0.26, 0xffa020, 0, 2.55, 0, 0xff6a00)
  flame.visible = false
  // The envelope: layers of boxes, stripes of red and cream.
  const layers = [[1.2, 0.5], [2.2, 0.6], [3.0, 0.8], [3.5, 1.0], [3.7, 1.2], [3.5, 1.0], [3.0, 0.8], [2.2, 0.6], [1.2, 0.4]]
  let y = BALLOON_ENV_LOW
  layers.forEach(([w, h], i) => {
    box(w, h, w, i % 2 ? 0xf2e6c8 : 0xd8352a, 0, y + h / 2, 0)
    y += h
  })
  g.userData.flame = flame
  return g
}

// A yellow submarine: a long rounded hull, a tower with a periscope,
// round portholes down each side, fins and a propeller at the back.
// A jet ski: a sleek two-tone hull, a seat and handlebars, facing +z.
export function makeJetSki(B) {
  const g = new THREE.Group()
  const box = (w, h, d, color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
    m.position.set(x * B, y * B, z * B)
    g.add(m)
    return m
  }
  box(0.9, 0.35, 2.2, 0xf2f0ea, 0, 0, 0)
  box(0.7, 0.3, 0.5, 0xf2f0ea, 0, 0, 1.3)
  box(0.95, 0.12, 2.2, 0xd8352a, 0, 0.2, 0)
  box(0.5, 0.25, 0.4, 0xd8352a, 0, 0.3, 1.25)
  // The seat and the handlebars.
  box(0.45, 0.2, 1.0, 0x2b2b2b, 0, 0.38, -0.35)
  box(0.1, 0.45, 0.1, 0x4a4a4a, 0, 0.5, 0.55)
  box(0.7, 0.08, 0.08, 0x2b2b2b, 0, 0.75, 0.55)
  // A spray of foam at the back.
  box(0.6, 0.1, 0.25, 0xd8f0ff, 0, -0.1, -1.2)
  return g
}

export function makeSub(B) {
  const g = new THREE.Group()
  const box = (w, h, d, color, x, y, z, parent = g, extra = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, ...extra }))
    m.position.set(x * B, y * B, z * B)
    parent.add(m)
    return m
  }
  const paint = 0xf2c12e
  const dark = 0x3a3a40
  box(1.3, 1.1, 2.8, paint, 0, 0.55, 0)
  box(1.0, 0.85, 0.5, paint, 0, 0.55, 1.6)
  box(0.6, 0.5, 0.3, paint, 0, 0.55, 1.95)
  box(1.0, 0.85, 0.4, paint, 0, 0.55, -1.55)
  box(0.6, 0.7, 0.9, paint, 0, 1.4, 0.2)
  box(0.1, 0.5, 0.1, dark, 0.1, 1.95, 0.4)
  box(0.1, 0.1, 0.3, dark, 0.1, 2.15, 0.5)
  for (const side of [-1, 1]) for (const z of [-0.8, 0, 0.8]) box(0.05, 0.3, 0.3, 0x8fd6ff, side * 0.66, 0.65, z, g, { emissive: 0x2a6a88 })
  box(1.8, 0.08, 0.4, dark, 0, 0.55, -1.4)
  box(0.08, 0.8, 0.4, dark, 0, 0.55, -1.6)
  const prop = new THREE.Group()
  prop.position.set(0, 0.55 * B, -1.85 * B)
  box(0.7, 0.12, 0.05, dark, 0, 0, 0, prop)
  box(0.12, 0.7, 0.05, dark, 0, 0, 0, prop)
  g.add(prop)
  g.userData.prop = prop
  return g
}
