// Grappling Hook (2026-11-28). Owned by BuildSurvival (`s.grapple`).
//
// Gaymi's answers: bought (Shop > Items, HOOK_COST) or crafted (PlayCrafting
// RECIPES); zip straight (aim, use it, and you're pulled fast to the spot -
// no rope swing); works in survival, the open world and servers, but not in
// any party game (PARTY_MODES - Deathmatch, Duel, Obstacle Course and the
// rest); a short cooldown (COOLDOWN_S) and it's never used up.
//
// Hold it and use it (click / the phone's use button): the first solid
// block straight ahead, MIN_RANGE..RANGE blocks away, is hooked. You zip
// there at SPEED blocks a second and stop just short of it. Hook the top
// edge of a wall (two free blocks above it) and you land on top - that's
// how you get onto a roof. Water and see-through panes don't hold a hook.
// The rope is one mesh made for the zip and thrown away after; never a
// light. Each player's own (on a server it's just your own movement).
// Numbers are a guess.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const HOOK_COST = 60
export const RANGE = 20 // blocks
export const MIN_RANGE = 2
export const SPEED = 32 // blocks a second
export const COOLDOWN_S = 1.5
const MISS_COOLDOWN_S = 0.4
const STOP_SHORT = 0.6
const MIN_ZIP_S = 0.15
const STEP = 0.2
const LIB = { HOOK_COST, RANGE, MIN_RANGE, SPEED, COOLDOWN_S }

export class Grapple {
  constructor(survival) {
    this.s = survival
    this.lib = LIB
    this.zip = null // { from, to, t, dur, hook }
    this._readyAt = 0
    this.rope = null
  }

  get B() {
    return this.s.B
  }

  // Party games (Deathmatch, Duel, Obstacle Course...) say no.
  allowed() {
    return !this.s.party
  }

  _solid(x, y, z) {
    const bm = this.s.bm
    const type = bm.getBlockAt(Math.floor(x), Math.floor(y), Math.floor(z))
    return !!type && !bm._chunks?.isLiquid?.(type) && !/pane|window/.test(type)
  }

  // The first solid block straight ahead. -> { d, point, cell } or null.
  aim() {
    const s = this.s
    const B = this.B
    const cam = s.bm.camera
    cam.updateMatrixWorld()
    const eye = cam.position.clone().divideScalar(B)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize()
    const p = new THREE.Vector3()
    for (let d = 0.3; d <= RANGE; d += STEP) {
      p.copy(eye).addScaledVector(dir, d)
      if (this._solid(p.x, p.y, p.z)) {
        return { d, eye, dir, point: p.clone(), cell: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } }
      }
    }
    return null
  }

  // Where my feet end up for a hook at `h` (blocks; feet = tm.pos).
  landing(h, eyeUp) {
    const c = h.cell
    // The top edge of a wall with room above: land on top of it.
    if (h.point.y - c.y >= 0.3 && !this._solid(c.x + 0.5, c.y + 1.5, c.z + 0.5) && !this._solid(c.x + 0.5, c.y + 2.5, c.z + 0.5)) {
      return new THREE.Vector3(c.x + 0.5, c.y + 1.02, c.z + 0.5)
    }
    // Otherwise just short of the hook, my eyes where it hit.
    const end = h.point.clone().addScaledVector(h.dir, -STOP_SHORT)
    end.y -= eyeUp
    // Not inside a block: up a little if my feet or head would be.
    for (let up = 0; up < 3; up++) {
      if (!this._solid(end.x, end.y + 0.1, end.z) && !this._solid(end.x, end.y + 1.6, end.z)) return end
      end.y = Math.floor(end.y) + 1.02
    }
    return null
  }

  // Used with the hook held. -> true when it fired (it's never used up).
  use() {
    const s = this.s
    if (!s.active || s.dead || s.spectating) return false
    if (!this.allowed()) {
      s._message(t('grappleNoParty'), 2.5)
      return false
    }
    if (s.vehicles?.riding) {
      s._message(t('grappleNoRide'), 2)
      return false
    }
    const now = performance.now()
    if (this.zip || now < this._readyAt) return false
    const tm = s.bm.tryMode
    const h = this.aim()
    if (!h) {
      this._readyAt = now + MISS_COOLDOWN_S * 1000
      s._message(t('grappleMiss', { n: RANGE }), 2)
      return false
    }
    if (h.d < MIN_RANGE) {
      this._readyAt = now + MISS_COOLDOWN_S * 1000
      s._message(t('grappleTooClose'), 2)
      return false
    }
    const eyeUp = Math.max(0.5, h.eye.y - tm.pos.y)
    const to = this.landing(h, eyeUp)
    if (!to) {
      this._readyAt = now + MISS_COOLDOWN_S * 1000
      s._message(t('grappleNoRoom'), 2)
      return false
    }
    const from = tm.pos.clone()
    const dur = Math.max(MIN_ZIP_S, from.distanceTo(to) / SPEED)
    this.zip = { from, to, t: 0, dur, hook: h.point.clone() }
    this._readyAt = now + COOLDOWN_S * 1000
    this._ropeOn(true)
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
    return true
  }

  update(dt) {
    const z = this.zip
    if (!z) return
    const s = this.s
    if (!s.active || s.dead || s.spectating || s.vehicles?.riding || !this.allowed()) return this.stop()
    const tm = s.bm.tryMode
    z.t += dt
    const f = Math.min(1, z.t / z.dur)
    const e = 1 - Math.pow(1 - f, 2)
    tm.pos.lerpVectors(z.from, z.to, e)
    // No fall damage from a zip, and no speed left over at the end.
    tm.vel?.set(0, 0, 0)
    this._drawRope()
    if (f >= 1) {
      tm.pos.copy(z.to)
      this.stop()
    }
  }

  get zipping() {
    return !!this.zip
  }

  // Seconds until it can fire again (0 = ready).
  wait() {
    return Math.max(0, (this._readyAt - performance.now()) / 1000)
  }

  _ropeOn(on) {
    if (!on) {
      if (this.rope) {
        this.rope.removeFromParent()
        this.rope.geometry.dispose()
        this.rope.material.dispose()
      }
      this.rope = null
      return
    }
    if (this.rope) return
    const B = this.B
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05 * B, 1, 0.05 * B), new THREE.MeshLambertMaterial({ color: 0x8a6a42 }))
    this.s.bm.scene.add(m)
    this.rope = m
  }

  _drawRope() {
    const m = this.rope
    const z = this.zip
    if (!m || !z) return
    const B = this.B
    const p = this.s.bm.tryMode.pos
    const top = z.hook.clone().multiplyScalar(B)
    const end = new THREE.Vector3(p.x * B, (p.y + 1.1) * B, p.z * B)
    const len = Math.max(0.01, top.distanceTo(end))
    m.position.copy(top).add(end).multiplyScalar(0.5)
    m.scale.set(1, len, 1)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(top).normalize())
  }

  stop() {
    this.zip = null
    this._ropeOn(false)
  }

  clear() {
    this.stop()
    this._readyAt = 0
  }
}
