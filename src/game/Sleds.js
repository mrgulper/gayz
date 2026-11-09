// Sleds (2026-11-02, Gaymi's idea list 6: "craft a sled and race down
// snowy hills - like the skateboard, but on snow").
//
// - Crafted. Hold it and use it to sit on it (use again, or put it away,
//   to get off). On snow or ice it glides (SNOW_SPEED x, little grip); on
//   anything else it drags (DRAG_SPEED x).
// - Going downhill builds speed: every block you drop on snow adds
//   DOWN_GAIN to your speed, up to MAX_BOOST more; going up a block costs
//   UP_COST, and on the flat it slowly fades (FLAT_FADE a second).
// - A run is every block you slide on snow without stopping: stop (or get
//   off) after at least RUN_MIN blocks and you get SLED_COINS coins for
//   every RUN_STEP blocks, with the run's length and top speed.
//
// Each player's own (others don't see your sled). Meshes only, never a
// light. Owned by BuildSurvival (`s.sled`); BuildTryMode asks mods() for
// speed and grip, like the skateboard's.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const SNOW_SPEED = 1.45
export const DRAG_SPEED = 0.6
const SNOW_GRIP = 0.18
export const DOWN_GAIN = 0.35
export const MAX_BOOST = 1.6
const UP_COST = 0.5
const FLAT_FADE = 0.12
export const RUN_MIN = 25
export const RUN_STEP = 10
export const SLED_COINS = 3
const STOP_SPEED = 1.5 // blocks/s: slower than this for STOP_S ends the run
const STOP_S = 0.8
export const SNOWY = new Set(['snow', 'ice', 'packedice', 'blueice'])

export class Sleds {
  constructor(survival) {
    this.s = survival
    this.on = false
    this.mesh = null
    this.boost = 0
    this.run = 0
    this.top = 0
    this._y = null
    this._slow = 0
    this._last = null
  }

  get holding() {
    const it = this.s.inv?.selected()
    return it?.kind === 'item' && it.id === 'sled'
  }

  // Used (PlayInventory.useHeld): on or off. Never used up.
  use() {
    const s = this.s
    if (!s.active || s.dead) return
    if (this.on) return this.off()
    s.skate?.off()
    this.on = true
    this.boost = 0
    this._y = null
    this._build()
    s._message(t('sledOn'), 3)
    s.bingo?.note('ride')
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
  }

  off() {
    if (!this.on) return
    this._endRun()
    this.on = false
    this.boost = 0
    this.mesh?.removeFromParent()
    disposeGroup(this.mesh)
    this.mesh = null
  }

  _under(p) {
    return this.s.bm.getBlockAt(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z))
  }

  // BuildTryMode._walk: how fast you go and how much grip you have.
  mods(onGround, p) {
    if (!this.on) return null
    if (!onGround) return { speed: SNOW_SPEED + this.boost, grip: 0.6 }
    if (!SNOWY.has(this._under(p))) return { speed: DRAG_SPEED, grip: 1 }
    return { speed: SNOW_SPEED + this.boost, grip: SNOW_GRIP }
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    if (this.on && (s.dead || s.spectating || !this.holding || s.vehicles?.riding || s.kart?.driving || s.skate?.on)) this.off()
    if (!this.on) return
    const tm = s.bm.tryMode
    const p = tm.pos
    const snowy = tm.onGround && SNOWY.has(this._under(p))
    // Down a block on snow: faster. Up one: slower. Flat: it fades.
    if (this._y !== null && tm.onGround) {
      const dy = p.y - this._y
      if (snowy && dy < -0.5) this.boost = Math.min(MAX_BOOST, this.boost + DOWN_GAIN * Math.min(3, -dy))
      else if (dy > 0.5) this.boost = Math.max(0, this.boost - UP_COST)
      else this.boost = Math.max(0, this.boost - FLAT_FADE * dt)
    }
    if (tm.onGround) this._y = p.y
    if (!snowy && tm.onGround) this.boost = Math.max(0, this.boost - FLAT_FADE * 4 * dt)
    // The run: blocks slid on snow.
    const speed = Math.hypot(tm.vel.x, tm.vel.z)
    if (this._last && (snowy || !tm.onGround)) {
      this.run += Math.hypot(p.x - this._last.x, p.z - this._last.z)
      this.top = Math.max(this.top, speed)
    }
    this._last = { x: p.x, z: p.z }
    this._slow = speed < STOP_SPEED ? this._slow + dt : 0
    if (this._slow >= STOP_S) this._endRun()
    this._draw()
  }

  _endRun() {
    const s = this.s
    const run = Math.floor(this.run)
    this.run = 0
    const top = this.top
    this.top = 0
    if (run < RUN_MIN) return
    const coins = Math.floor(run / RUN_STEP) * SLED_COINS
    s.coins = (s.coins || 0) + coins
    s._renderHud?.()
    s._message(t('sledRun', { n: run, v: Math.round(top), c: coins }), 3)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
  }

  // A red wooden sled on two curled metal runners.
  _build() {
    const B = this.s.B
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    box(0.7, 0.07, 1.3, 0xc8352a, 0, 0.2, 0.05)
    for (const z of [-0.4, 0, 0.4]) box(0.72, 0.05, 0.12, 0x8a5a2a, 0, 0.25, z)
    for (const x of [-0.3, 0.3]) {
      box(0.06, 0.06, 1.4, 0xb8b8c0, x, 0.04, 0)
      box(0.06, 0.2, 0.06, 0xb8b8c0, x, 0.12, -0.72)
      for (const z of [-0.35, 0.35]) box(0.05, 0.14, 0.05, 0x6a6a72, x, 0.12, z)
    }
    // The rope to steer by.
    box(0.5, 0.03, 0.03, 0xe3cf9a, 0, 0.3, -0.62)
    this.mesh = g
    this.s.bm.scene.add(g)
  }

  _draw() {
    const m = this.mesh
    if (!m) return
    const B = this.s.B
    const p = this.s.bm.tryMode.pos
    m.position.set(p.x * B, p.y * B, p.z * B)
    m.rotation.set(0, this.s.bm._yaw, 0)
    // A little wobble at speed.
    m.rotation.z = Math.sin(performance.now() / 90) * Math.min(0.06, this.boost * 0.04)
  }

  clear() {
    this.off()
    this.run = 0
    this.top = 0
    this._last = null
  }
}

function disposeGroup(g) {
  g?.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
