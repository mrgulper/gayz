// Kites (2026-11-02, Gaymi's idea list 5, quick wins: "craft one, fly it
// on windy days, it pulls you a little" - picked "crafted").
//
// Hold a Kite and use it to let it up; use it again (or put it away) to
// reel it in. While it's up it flies on a string downwind of you, higher
// and steadier the stronger the wind (the sky's wind, like the hot-air
// balloon's). It pulls you along with the wind (PULL x the
// wind, about walking speed on a stormy day) and, off the ground, holds
// you up so you drift down slowly (GLIDE_FALL) instead of dropping.
// On a calm day it hangs low and hardly pulls (CALM: a message says so).
//
// Never used up. Each player's own (others don't see it). Meshes and one
// line, never a light. Owned by BuildSurvival (`s.kite`); BuildTryMode
// asks pull() and fall() every frame.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

const PULL = 0.9
const MAX_PULL = 4.5 // blocks/s
export const GLIDE_FALL = 3.5 // blocks/s at most while it's up
const CALM = 1.2 // wind (blocks/s) under this: a calm day
const WIND_K = 1.6
const LINE = 9 // string length in blocks
const RISE_S = 1.2

export class Kites {
  constructor(survival) {
    this.s = survival
    this.up = false
    this.mesh = null
    this.line = null
    this._rise = 0
    this._t = 0
    this._wind = { x: 0, z: 0 }
  }

  get holding() {
    const it = this.s.inv?.selected()
    return it?.kind === 'item' && it.id === 'kite'
  }

  // Used (PlayInventory.useHeld): up or down. Never used up.
  use() {
    const s = this.s
    if (!s.active || s.dead) return
    if (this.up) return this.reel()
    this.up = true
    this._rise = 0
    this._build()
    const w = this._windNow()
    s._message(t(Math.hypot(w.x, w.z) < CALM ? 'kiteCalm' : 'kiteUp'), 3)
    s.bingo?.note('kite')
    try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
  }

  reel() {
    if (!this.up) return
    this.up = false
    this._remove()
  }

  // The sky's wind (BuildSky.wind: a clear day ~0.25, a storm 3+), turned
  // into the kite's (blocks/s); a slow turning breeze where there's no sky.
  _windNow() {
    const sky = this.s.bm.sky?.wind
    const raw = sky ? sky.length() : 0.25
    let x
    let z
    if (sky && raw > 0.01) {
      x = sky.x / raw
      z = sky.y / raw
    } else {
      this._ang = (this._ang || 0) + 0.0005
      x = Math.cos(this._ang)
      z = Math.sin(this._ang)
    }
    const strength = raw * WIND_K + 0.3
    return { x: x * strength, z: z * strength }
  }

  // The push this frame (blocks/s, BuildTryMode adds it to your walk), or null.
  pull() {
    if (!this.up) return null
    const w = this._wind
    const k = Math.min(1, this._rise / RISE_S) * PULL
    let x = w.x * k
    let z = w.z * k
    const m = Math.hypot(x, z)
    if (m > MAX_PULL) {
      x *= MAX_PULL / m
      z *= MAX_PULL / m
    }
    return { x, z }
  }

  // Your fall speed with the kite up (it can't drop faster than GLIDE_FALL).
  fall(vy) {
    return this.up && this._rise > RISE_S * 0.5 ? Math.max(vy, -GLIDE_FALL) : vy
  }

  update(dt) {
    const s = this.s
    if (!this.up) return
    if (!this.holding || !s.active || s.dead || s.vehicles?.riding) return this.reel()
    this._rise += dt
    this._t += dt
    this._wind = this._windNow()
    const B = s.B
    const me = s.bodyPos()
    const w = this._wind
    const ws = Math.hypot(w.x, w.z)
    const dx = ws > 0.01 ? w.x / ws : 0
    const dz = ws > 0.01 ? w.z / ws : 1
    // Stronger wind: further out and higher; calm: low and droopy.
    const lift = Math.min(1, ws / 4) * Math.min(1, this._rise / RISE_S)
    const out = LINE * (0.35 + 0.45 * lift)
    const high = 1.8 + LINE * (0.15 + 0.6 * lift)
    const wob = Math.sin(this._t * 2.3) * (0.3 + ws * 0.08)
    const kx = me.x + dx * out - dz * wob
    const kz = me.z + dz * out + dx * wob
    const ky = me.y + high + Math.sin(this._t * 3.1) * 0.25
    this.mesh.position.set(kx * B, ky * B, kz * B)
    this.mesh.lookAt(me.x * B, (me.y + 1.2) * B, me.z * B)
    this.mesh.rotateZ(Math.sin(this._t * 1.7) * 0.25)
    const pos = this.line.geometry.attributes.position
    pos.setXYZ(0, me.x * B, (me.y + 1.2) * B, me.z * B)
    pos.setXYZ(1, kx * B, ky * B, kz * B)
    pos.needsUpdate = true
    this.line.geometry.computeBoundingSphere()
  }

  _build() {
    if (this.mesh) return
    const B = this.s.B
    const g = new THREE.Group()
    // A diamond sail in four coloured quarters, a cross of sticks and a tail of bows.
    const shape = new THREE.Shape()
    shape.moveTo(0, 0.9 * B)
    shape.lineTo(0.6 * B, 0.1 * B)
    shape.lineTo(0, -1.0 * B)
    shape.lineTo(-0.6 * B, 0.1 * B)
    shape.closePath()
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0xe8443a, side: THREE.DoubleSide }))
    g.add(sail)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08 * B, 1.9 * B, 0.03 * B), new THREE.MeshLambertMaterial({ color: 0xffd23f }))
    stripe.position.y = -0.05 * B
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2 * B, 0.08 * B, 0.03 * B), new THREE.MeshLambertMaterial({ color: 0xffd23f }))
    cross.position.y = 0.1 * B
    g.add(stripe, cross)
    const bow = new THREE.MeshLambertMaterial({ color: 0x3a7be8 })
    for (let i = 1; i <= 3; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22 * B, 0.1 * B, 0.03 * B), bow)
      b.position.set(Math.sin(i) * 0.1 * B, (-1.0 - i * 0.35) * B, 0)
      g.add(b)
    }
    this.mesh = g
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf2f0ea }))
    this.line.frustumCulled = false
    this.s.bm.scene.add(g, this.line)
  }

  _remove() {
    if (!this.mesh) return
    this.mesh.removeFromParent()
    this.mesh.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    this.line.removeFromParent()
    this.line.geometry.dispose()
    this.line.material.dispose()
    this.mesh = null
    this.line = null
  }

  clear() {
    this.up = false
    this._remove()
  }
}
