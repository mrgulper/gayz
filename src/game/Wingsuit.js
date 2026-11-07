// Wingsuit (2026-11-06, Gaymi's idea list 8: "jump off Heaven's Peaks or a
// lighthouse and glide down through rings. There are gliders already, but
// no wingsuit flying"). Owned by BuildSurvival (`s.wing`); BuildTryMode
// asks fly() every frame you're in the air (not swimming or climbing).
//
// Craft one (PlayCrafting); it works from your bag, like the Jetpack. Fall
// from somewhere high - more than OPEN_H blocks above the ground, falling
// faster than OPEN_FALL - and it opens by itself: you glide forward the
// way you look at GLIDE_SPEED, sinking slowly. Look down to dive (faster,
// sinks more), look up to float (slower). Crouch to close it and drop.
// Landing or water closes it too. No fall damage in GayZ anyway.
//
// Each time it opens, RINGS gold rings appear in a line ahead and below:
// fly through one for RING_COINS coins, all of them for ALL_RINGS_COINS
// more. Rings left behind go when you land. Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const OPEN_H = 8
export const OPEN_FALL = 12
export const GLIDE_SPEED = 14
export const RINGS = 6
export const RING_COINS = 5
export const ALL_RINGS_COINS = 25
const RING_R = 2.2
const RING_GAP = 15
const RING_DROP = 3

export class Wingsuit {
  constructor(survival) {
    this.s = survival
    this.open = false
    this.rings = []
    this._got = 0
  }

  get worn() {
    return !!this.s.inv?.has('wingsuit')
  }

  _below() {
    const p = this.s.bm.tryMode.pos
    const g = this.s._groundUnder(p.x, p.y, p.z)
    return Number.isFinite(g) ? p.y - g : Infinity
  }

  // BuildTryMode, every frame in the air.
  fly(vel, dt, onGround, crouch) {
    const s = this.s
    if (onGround || s.dead || !this.worn) {
      this.land()
      return
    }
    if (!this.open) {
      if (vel.y < -OPEN_FALL && !crouch && !s.jetpack?.flying && this._below() > OPEN_H) this._open(vel)
      if (!this.open) return
    }
    if (crouch) {
      this.open = false
      s._message(t('wingClosed'), 2)
      return
    }
    const bm = s.bm
    const dive = Math.max(-0.5, Math.min(1.2, -(bm._pitch || 0)))
    const speed = Math.max(8, GLIDE_SPEED + dive * 10)
    const sink = Math.max(0.8, 2.5 + dive * 6)
    const yaw = bm._yaw || 0
    const k = Math.min(1, dt * 3)
    vel.x += (-Math.sin(yaw) * speed - vel.x) * k
    vel.z += (-Math.cos(yaw) * speed - vel.z) * k
    vel.y += (-sink - vel.y) * Math.min(1, dt * 4)
    this._whoosh = (this._whoosh || 0) - dt
    if (this._whoosh <= 0) {
      this._whoosh = 0.9
      try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
    }
  }

  _open(vel) {
    const s = this.s
    this.open = true
    void vel
    s._message(t('wingOpen'), 3)
    this._clearRings()
    this._got = 0
    const p = s.bm.tryMode.pos
    const yaw = s.bm._yaw || 0
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const B = s.B
    for (let i = 0; i < RINGS; i++) {
      const c = new THREE.Vector3(p.x + fx * RING_GAP * (i + 1), p.y + 1 - RING_DROP * (i + 1), p.z + fz * RING_GAP * (i + 1))
      const m = new THREE.Mesh(new THREE.TorusGeometry(RING_R * B, 0.14 * B, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.9 }))
      m.position.set(c.x * B, c.y * B, c.z * B)
      m.rotation.y = yaw
      s.bm.scene.add(m)
      this.rings.push({ c, n: new THREE.Vector3(fx, 0, fz), mesh: m, side: -1, got: false, fade: 0 })
    }
  }

  // Back on the ground (or in water, on a ladder).
  land() {
    if (!this.open && !this.rings.length) return
    this.open = false
    this._clearRings()
  }

  update(dt) {
    const s = this.s
    if (!this.rings.length) return
    const p = s.bm.tryMode.pos
    const me = new THREE.Vector3(p.x, p.y + 1, p.z)
    const rel = new THREE.Vector3()
    for (const r of this.rings) {
      if (r.got) {
        r.fade += dt
        r.mesh.material.opacity = Math.max(0, 0.9 - r.fade * 2)
        r.mesh.scale.setScalar(1 + r.fade)
        continue
      }
      rel.copy(me).sub(r.c)
      const side = Math.sign(rel.dot(r.n)) || -1
      if (r.side < 0 && side > 0) {
        const across = rel.clone().addScaledVector(r.n, -rel.dot(r.n)).length()
        if (across < RING_R) this._pass(r)
      }
      r.side = side
    }
  }

  _pass(r) {
    const s = this.s
    r.got = true
    r.mesh.material.color.set(0x6fe36f)
    this._got++
    s._earn(RING_COINS)
    let msg = t('wingRing', { n: this._got, max: RINGS, c: RING_COINS })
    if (this._got === RINGS) {
      s._earn(ALL_RINGS_COINS)
      msg = t('wingAllRings', { n: ALL_RINGS_COINS })
    }
    s._message(msg, 2)
    s._renderHud?.()
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
  }

  _clearRings() {
    for (const r of this.rings) {
      r.mesh.removeFromParent()
      r.mesh.geometry.dispose()
      r.mesh.material.dispose()
    }
    this.rings = []
  }

  clear() {
    this.open = false
    this._clearRings()
    this._got = 0
  }
}
