// A rickety blocky go-kart (2026-10-31, Gaymi's idea list: "a rickety
// blocky go-kart for running over zombies"). Owned by BuildSurvival
// (`survival.kart`): every Zombie Survival run parks one a few blocks
// from where you start.
//
// - Walk up to it (within ENTER_REACH blocks) and press Use (the phone's
//   use button) to hop in; press it again to hop out beside it.
// - Forward / back (or the phone's stick up and down) drive and reverse,
//   left / right (stick sideways) steer. You can still look round and
//   shoot while driving. It climbs one-block steps, falls off ledges and
//   bounces off walls.
// - Hitting a zombie at speed (over RAM_MIN blocks a second) hurts it -
//   at top speed about a regular zombie's whole health this wave
//   (BuildSurvival.ramDamage) - and flings it; the kart loses a bit of
//   speed. Zombies can still bite you while you drive.
//
// BuildTryMode hands it your keys each frame while you drive (drive()) and
// puts you and the camera in the seat. On a server your hits go to the
// host like shots do; the others don't see the kart (only you, moving).
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

const ENTER_REACH = 3
const HINT_REACH = 5
const MAX_SPEED = 16
const REVERSE_MAX = 6
const ACCEL = 14
const BRAKE = 26
const COAST = 5
const TURN = 2.4
const GRAVITY = 30
const STEP = 1.05
const BODY_R = 0.75
const RAM_REACH = 1.4
const RAM_MIN = 3
const RAM_CD = 0.5
// Where you sit and see from (blocks above the kart's floor).
export const KART_EYE = 1.15

export class GoKart {
  constructor(survival) {
    this.s = survival
    this.group = null
    this.driving = false
  }

  get B() {
    return this.s.B
  }

  // A new run: park one near `at` (your start).
  park(at) {
    this.dispose()
    const spot = this._spotNear(at)
    if (!spot) return false
    this.x = spot.x
    this.y = spot.y
    this.z = spot.z
    this.heading = Math.random() * Math.PI * 2
    this.speed = 0
    this.vy = 0
    this._hinted = false
    this.group = makeKart(this.B)
    this.s.bm.scene.add(this.group)
    this._place()
    return true
  }

  // Open ground 3..6 blocks from `at`, with room over it.
  _spotNear(at) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2
      const d = 3 + Math.random() * 3
      const x = Math.floor(at.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(at.z + Math.sin(a) * d) + 0.5
      if (this.s.camp?.inside(x, z, 2)) continue
      const y = this.s._groundUnder(x, at.y + 3, z)
      if (y === at.y + 3 || Math.abs(y - at.y) > 3) continue
      if (this._blocked(x, y, z)) continue
      return { x, y, z }
    }
    return null
  }

  // Something solid where the kart's body would be.
  _blocked(x, y, z) {
    const cy = Math.floor(y + 0.01)
    for (const [dx, dz] of [[0, 0], [BODY_R, 0], [-BODY_R, 0], [0, BODY_R], [0, -BODY_R]]) {
      const cx = Math.floor(x + dx)
      const cz = Math.floor(z + dz)
      if (this.s._solid(cx, cy, cz) || this.s._solid(cx, cy + 1, cz)) return true
    }
    return false
  }

  // The Use key (BuildMode._tryUseFromCamera): hop in or out.
  use() {
    if (!this.group || this.s.dead || this.s.spectating) return false
    if (this.driving) {
      this.leave()
      return true
    }
    const me = this.s.bm.tryMode.pos
    if (Math.hypot(me.x - this.x, me.z - this.z) > ENTER_REACH || Math.abs(me.y - this.y) > 2) return false
    this.driving = true
    this.speed = 0
    this.s._message(t('buildPlayKartIn'), 3)
    return true
  }

  // Out, standing beside it (or on top, if both sides are walled in).
  leave() {
    if (!this.driving) return
    this.driving = false
    this.speed = 0
    const tm = this.s.bm.tryMode
    const sx = Math.cos(this.heading)
    const sz = -Math.sin(this.heading)
    for (const side of [1.6, -1.6, 2.4, -2.4]) {
      const x = this.x + sx * side
      const z = this.z + sz * side
      const y = this.s._groundUnder(x, this.y + 1.5, z)
      if (!tm._hits(x, y + 0.01, z)) {
        tm.pos.set(x, y + 0.01, z)
        return
      }
    }
    tm.pos.set(this.x, this.y + 1.2, this.z)
  }

  // Every frame (BuildSurvival): the "hop in" hint, and parked physics.
  update(dt) {
    if (!this.group) return
    if (this.driving && (this.s.dead || this.s.spectating)) this.leave()
    if (!this.driving) {
      // Rolls to a stop, and falls if the ground goes.
      this._move(dt, 0, 0)
      const me = this.s.bodyPos()
      if (!this._hinted && !this.s.dead && Math.hypot(me.x - this.x, me.z - this.z) < HINT_REACH) {
        this._hinted = true
        this.s._message(t('buildPlayKartHint'), 4)
      }
    }
  }

  // Driving (BuildTryMode.update): your keys or the phone's stick.
  drive(dt, { fwd, back, left, right, stick }) {
    let throttle = (fwd ? 1 : 0) - (back ? 1 : 0)
    let steer = (left ? 1 : 0) - (right ? 1 : 0)
    if (stick) {
      if (!throttle) throttle = THREE.MathUtils.clamp(stick.y, -1, 1)
      if (!steer) steer = THREE.MathUtils.clamp(-stick.x, -1, 1)
    }
    this._move(dt, throttle, steer)
    this._ram()
  }

  _move(dt, throttle, steer) {
    // Speed: gas, brake (pressing against the way it's rolling), coast.
    if (throttle && Math.sign(throttle) !== Math.sign(this.speed) && Math.abs(this.speed) > 0.5) this.speed += Math.sign(throttle) * BRAKE * dt
    else if (throttle) this.speed += throttle * ACCEL * dt
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), COAST * dt)
    this.speed = THREE.MathUtils.clamp(this.speed, -REVERSE_MAX, MAX_SPEED)
    // Steering turns it more the faster it goes (and backwards in reverse).
    this.heading += steer * TURN * dt * THREE.MathUtils.clamp(this.speed / 6, -1, 1)
    const nx = this.x + Math.sin(this.heading) * this.speed * dt
    const nz = this.z + Math.cos(this.heading) * this.speed * dt
    // Up a step of a block at most; a taller wall bounces it back.
    const ground = this.s._groundUnder(nx, this.y + STEP + 0.05, nz)
    if (ground > this.y + STEP || this._blocked(nx, Math.max(ground, this.y), nz)) {
      if (Math.abs(this.speed) > 4) audioEngine.playMelee?.()
      this.speed *= -0.3
    } else {
      this.x = nx
      this.z = nz
      if (ground >= this.y) {
        this.y = ground
        this.vy = 0
      } else {
        this.vy -= GRAVITY * dt
        this.y = Math.max(ground, this.y + this.vy * dt)
        if (this.y === ground) this.vy = 0
      }
    }
    this._place(dt)
  }

  // Zombies in front of a moving kart get run over.
  _ram() {
    const s = this.s
    const fast = Math.abs(this.speed)
    const now = performance.now() / 1000
    if (fast < RAM_MIN) return
    const dir = new THREE.Vector3(Math.sin(this.heading) * Math.sign(this.speed), 0, Math.cos(this.heading) * Math.sign(this.speed))
    for (const zb of [...s.zombies]) {
      if (zb.health <= 0 || (zb._rammedAt || 0) > now - RAM_CD) continue
      if (Math.hypot(zb.x - this.x, zb.z - this.z) > RAM_REACH * (zb.wide || 1) || Math.abs(zb.y - this.y) > 1.5) continue
      zb._rammedAt = now
      const amount = s.ramDamage(fast / MAX_SPEED)
      zb.vy = 6
      try { audioEngine.playMelee?.() } catch { /* no audio */ }
      this.speed *= 0.85
      s.damageNumbers?.atZombie(zb, amount, '', s.zombieHeight)
      if (s.net && !s.net.isHost) {
        s.net.queueHit(`z${zb.id}`, amount)
        zb.flash = 0.12
      } else s.damageZombie(zb, amount, dir)
    }
  }

  // The model where the kart is; wheels spin with the speed.
  _place(dt = 0) {
    const B = this.B
    this.group.position.set(this.x * B, this.y * B, this.z * B)
    this.group.rotation.y = this.heading
    const spin = (this.speed * dt) / 0.25
    for (const w of this.group.userData.wheels) w.rotation.x += spin
    // A rickety rattle while it moves.
    this.group.userData.body.position.y = Math.abs(this.speed) > 1 ? Math.sin(performance.now() / 40) * 0.02 * B : 0
  }

  dispose() {
    this.driving = false
    if (!this.group) return
    this.group.removeFromParent()
    this.group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    this.group = null
  }
}

// Boxes: a red frame, a seat, a steering wheel, a little engine and four
// fat wheels. Under a block tall; facing +z.
function makeKart(B) {
  const g = new THREE.Group()
  const body = new THREE.Group()
  g.add(body)
  const box = (w, h, d, color, x, y, z, parent = body) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
    m.position.set(x * B, y * B, z * B)
    parent.add(m)
    return m
  }
  box(1.1, 0.18, 1.9, 0xc0392b, 0, 0.3, 0)
  box(1.2, 0.22, 0.2, 0x333333, 0, 0.32, 1.02)
  box(1.2, 0.22, 0.2, 0x333333, 0, 0.32, -1.02)
  box(0.6, 0.12, 0.55, 0x2a2a2a, 0, 0.45, -0.25)
  box(0.6, 0.5, 0.12, 0x2a2a2a, 0, 0.7, -0.52)
  box(0.08, 0.08, 0.6, 0x888888, 0, 0.6, 0.35).rotation.x = 0.6
  box(0.42, 0.08, 0.08, 0x222222, 0, 0.78, 0.15)
  box(0.5, 0.35, 0.4, 0x777777, 0, 0.5, -0.82)
  box(0.12, 0.12, 0.3, 0x555555, 0.18, 0.62, -1.05)
  // A number plate on the nose.
  box(0.5, 0.2, 0.05, 0xf2d24a, 0, 0.32, 1.13)
  const wheels = []
  for (const [x, z] of [[-0.62, 0.65], [0.62, 0.65], [-0.62, -0.65], [0.62, -0.65]]) {
    const w = box(0.26, 0.5, 0.5, 0x151515, x, 0.25, z, g)
    box(0.28, 0.16, 0.16, 0xbbbbbb, 0, 0, 0, w)
    wheels.push(w)
  }
  g.userData.wheels = wheels
  g.userData.body = body
  return g
}
