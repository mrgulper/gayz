// Bikes and hoverboards (2026-11-09, Gaymi's idea list 9: "new rideables:
// quick, quiet, and great for weaving through zombies" - Gaymi picked
// "find them in the world": WorldFinds.js lays them about, chests have
// them now and then).
//
// - Bike: hold it and use it to hop on (use again, or put it away, to get
//   off). Pedalling is BIKE_SPEED x faster with good grip - easy to weave
//   between zombies. The wheels turn and the pedals go round.
// - Hoverboard: the same, HOVER_SPEED x faster, slidey (HOVER_GRIP), and it
//   floats: you drift down slowly (HOVER_FALL) instead of dropping, and it
//   bobs under you with a glow underneath.
// - Both are quiet: zombies more than QUIET_HEAR blocks away lose you while
//   you ride (BuildSpecials.zombieTarget).
//
// Each player's own (others see you walking, like the skateboard). Meshes
// only, never a light. Owned by BuildSurvival (`s.rides`); BuildTryMode
// asks mods() for speed and grip. Never used up.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const BIKE_SPEED = 1.9
const BIKE_GRIP = 0.9
export const HOVER_SPEED = 1.6
const HOVER_GRIP = 0.3
export const HOVER_FALL = 3 // blocks/s, as fast as a hoverboard drops
export const QUIET_HEAR = 10
// Which held item is which ride.
export const RIDE_ITEMS = { bike: 'bike', hoverboard: 'hover' }

export class Rides {
  constructor(survival) {
    this.s = survival
    this.on = '' // 'bike' | 'hover' | ''
    this.mesh = null
    this._spin = 0
  }

  // The ride you're holding ('bike' / 'hover'), or ''.
  get held() {
    const it = this.s.inv?.selected()
    return (it?.kind === 'item' && RIDE_ITEMS[it.id]) || ''
  }

  // Quiet while riding (zombies far off lose you).
  get quiet() {
    return !!this.on
  }

  // Used (PlayInventory.useHeld): on or off.
  use() {
    const s = this.s
    if (!s.active || s.dead) return
    if (this.on) return this.off()
    const kind = this.held
    if (!kind) return
    this.on = kind
    this._build()
    s._message(t(kind === 'bike' ? 'rideBikeOn' : 'rideHoverOn', { n: QUIET_HEAR }), 3)
    try { audioEngine.playSpecial?.(kind === 'bike' ? 'dingdong' : 'whoosh') } catch { /* no audio */ }
  }

  off() {
    if (!this.on) return
    this.on = ''
    this.mesh?.removeFromParent()
    disposeGroup(this.mesh)
    this.mesh = null
  }

  // BuildTryMode._walk: how much faster you go and how much grip you have.
  mods(onGround) {
    if (this.on === 'bike' && onGround) return { speed: BIKE_SPEED, grip: BIKE_GRIP }
    // A hoverboard works in the air too (it's floating anyway).
    if (this.on === 'hover') return { speed: HOVER_SPEED, grip: HOVER_GRIP }
    return null
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    if (this.on && (s.dead || s.spectating || this.held !== this.on || s.vehicles?.riding || s.kart?.driving)) this.off()
    if (!this.on) return
    const tm = s.bm.tryMode
    // A hoverboard floats down gently.
    if (this.on === 'hover' && !tm.onGround && tm.vel.y < -HOVER_FALL) tm.vel.y = -HOVER_FALL
    this._spin += Math.hypot(tm.vel.x, tm.vel.z) * dt * 2.4
    this._draw()
  }

  _build() {
    const B = this.s.B
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z, parent = g, extra = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, ...extra }))
      m.position.set(x * B, y * B, z * B)
      parent.add(m)
      return m
    }
    if (this.on === 'bike') {
      this._wheels = []
      for (const z of [-0.5, 0.5]) {
        const w = new THREE.Group()
        w.position.set(0, 0.3 * B, z * B)
        const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.26 * B, 0.05 * B, 6, 14), new THREE.MeshLambertMaterial({ color: 0x222222 }))
        tyre.rotation.y = Math.PI / 2
        w.add(tyre)
        for (const a of [0, Math.PI / 2]) {
          const spoke = box(0.02, 0.48, 0.02, 0xc9ccd2, 0, 0, 0, w)
          spoke.rotation.x = a
        }
        g.add(w)
        this._wheels.push(w)
      }
      // The frame, seat and handlebars.
      const bar = box(0.06, 0.06, 0.9, 0xd8352a, 0, 0.62, 0)
      bar.rotation.x = 0.08
      box(0.06, 0.4, 0.06, 0xd8352a, 0, 0.45, -0.18)
      box(0.06, 0.45, 0.06, 0xd8352a, 0, 0.55, 0.45)
      box(0.2, 0.06, 0.28, 0x2b2016, 0, 0.72, -0.2)
      box(0.55, 0.05, 0.05, 0x4a4a4a, 0, 0.82, 0.45)
      // Pedals.
      this._crank = new THREE.Group()
      this._crank.position.set(0, 0.3 * B, -0.05 * B)
      box(0.04, 0.3, 0.04, 0x4a4a4a, 0.08, 0, 0, this._crank)
      box(0.04, 0.3, 0.04, 0x4a4a4a, -0.08, 0, 0, this._crank).rotation.x = Math.PI
      g.add(this._crank)
    } else {
      // A smooth board with glowing strips and a soft glow below.
      box(0.5, 0.08, 1.15, 0x2a2f3a, 0, 0.18, 0)
      box(0.52, 0.02, 0.9, 0x5aa7d8, 0, 0.13, 0, g, { emissive: 0x5aa7d8, emissiveIntensity: 0.9 })
      for (const z of [-0.45, 0.45]) box(0.4, 0.04, 0.12, 0xf2f0ea, 0, 0.23, z)
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.55 * B, 18), new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.35, depthWrite: false }))
      glow.rotation.x = -Math.PI / 2
      glow.position.y = 0.02 * B
      g.add(glow)
      this._glow = glow
    }
    this.mesh = g
    this.s.bm.scene.add(g)
  }

  _draw() {
    const m = this.mesh
    if (!m) return
    const B = this.s.B
    const p = this.s.bm.tryMode.pos
    const bob = this.on === 'hover' ? 0.05 + Math.sin(performance.now() / 250) * 0.04 : 0
    m.position.set(p.x * B, (p.y + bob) * B, p.z * B)
    m.rotation.set(0, this.s.bm._yaw, 0)
    if (this.on === 'bike') {
      for (const w of this._wheels || []) w.rotation.x = -this._spin
      if (this._crank) this._crank.rotation.x = -this._spin * 0.6
    } else if (this._glow) {
      this._glow.position.y = -bob * B + 0.02 * B
      this._glow.material.opacity = 0.25 + Math.sin(performance.now() / 180) * 0.08
    }
  }

  clear() {
    this.off()
  }
}

function disposeGroup(g) {
  g?.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
