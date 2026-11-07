// Water Guns (2026-11-06, Gaymi's idea list 8: "a summer weapon that slows
// zombies down and puts out fire. It could fit a summer event"). Owned by
// BuildSurvival (`s.water`).
//
// An item, never used up: hold it and use it (click / the use button) to
// squirt a spray of water. A zombie it soaks is slowed to SOAK_SLOW of its
// speed for SOAK_S seconds and stops burning; any fire where the water
// lands (a burning block or ground fire, PlayFx's flames) goes out. It
// does no damage. The tank holds TANK squirts; it fills up again by
// itself while you stand in water, or in the rain.
//
// Craft one any time (PlayCrafting). Summer - June to August on your own
// clock - is its event: you start every game with one (summerOn), like
// Snowballs in winter. Each player's own; on a server a guest's soak only
// shows for them (it doesn't hurt anyone, so the host doesn't need it).
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { showPill, hidePill } from './PlayPills.js'

export const SOAK_S = 4
export const SOAK_SLOW = 0.45
export const TANK = 25
export const RANGE = 11 // blocks
const DROPS = 5
const SPEED = 26
const GRAVITY = 9
const COOLDOWN_S = 0.18
const REFILL_S = 3 // a full tank, standing in water

export function summerOn(now = new Date()) {
  const m = now.getMonth()
  return m >= 5 && m <= 7
}

export class WaterGun {
  constructor(survival) {
    this.s = survival
    this.list = []
    this.tank = TANK
    this._nextAt = 0
    this._geo = null
    this._mat = null
  }

  // A new game: a full tank, and in summer a gun to go with it.
  start() {
    this.tank = TANK
    if (summerOn() && this.s.inv && !this.s.inv.has('waterGun')) {
      this.s.inv.add({ kind: 'item', id: 'waterGun', n: 1 })
      setTimeout(() => this.s.active && this.s._message(t('waterSummer'), 4), 3500)
    }
  }

  // Squirt. -> true when water came out (the gun itself is kept).
  squirt() {
    const s = this.s
    const bm = s.bm
    const B = s.B
    if (!s.active || s.dead || performance.now() < this._nextAt) return false
    if (this.tank <= 0) {
      s._message(t('waterEmpty'), 2.5)
      return false
    }
    this._nextAt = performance.now() + COOLDOWN_S * 1000
    this.tank--
    if (!this._geo) {
      this._geo = new THREE.SphereGeometry(0.07 * B, 6, 4)
      this._mat = new THREE.MeshBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0.8, depthWrite: false })
    }
    bm.camera.updateMatrixWorld()
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(bm.camera.quaternion)
    const from = bm.camera.position.clone().addScaledVector(dir, 0.5 * B).add(new THREE.Vector3(0, -0.12 * B, 0))
    for (let i = 0; i < DROPS; i++) {
      const d = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06)).normalize()
      const mesh = new THREE.Mesh(this._geo, this._mat)
      mesh.position.copy(from)
      bm.scene.add(mesh)
      this.list.push({ mesh, pos: from.clone(), vel: d.multiplyScalar(SPEED * B * (0.9 + i * 0.04)), life: 0, max: RANGE / SPEED })
    }
    try { audioEngine.playSpecial?.('squirt') } catch { /* no audio */ }
    return true
  }

  // Soaked: slow and not burning.
  soak(z) {
    z.soaked = SOAK_S
    z.burn = 0
  }

  // Fires near where water landed go out.
  douse(x, y, z) {
    const s = this.s
    let n = 0
    for (const [key, f] of s._fires || []) {
      if (Math.abs(f.x + 0.5 - x) < 1.6 && Math.abs(f.y + 0.5 - y) < 1.6 && Math.abs(f.z + 0.5 - z) < 1.6) {
        s._fires.delete(key)
        n++
      }
    }
    const g = s._groundFires
    if (g) {
      for (let i = g.length - 1; i >= 0; i--) {
        const f = g[i]
        if (Math.abs(f.x + 0.5 - x) < 1.6 && Math.abs(f.y - y) < 2 && Math.abs(f.z + 0.5 - z) < 1.6) {
          g.splice(i, 1)
          n++
        }
      }
    }
    return n
  }

  update(dt) {
    const s = this.s
    const B = s.B
    const bm = s.bm
    // Refilling: standing in water, or out in the rain.
    if (s.active && this.tank < TANK) {
      const p = bm.tryMode.pos
      const wet = bm._cellIsLiquid?.(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) || (s._raining?.() && s._skyAbove?.(Math.floor(p.x), Math.floor(p.y) + 2, Math.floor(p.z)))
      if (wet) {
        this.tank = Math.min(TANK, this.tank + (TANK / REFILL_S) * dt)
        if (this.tank >= TANK) s._message(t('waterFull'), 2)
      }
    }
    const holding = s.active && s.holding?.kind === 'item' && s.holding.id === 'waterGun'
    if (holding) showPill('waterGun', t('waterPill', { n: Math.floor(this.tank), max: TANK }), this.tank < 4)
    else hidePill('waterGun')
    if (!this.list.length) return
    const box = new THREE.Box3()
    const ray = new THREE.Ray()
    const hit = new THREE.Vector3()
    const step = new THREE.Vector3()
    for (const b of [...this.list]) {
      b.life += dt
      b.vel.y -= GRAVITY * B * dt
      step.copy(b.vel).multiplyScalar(dt)
      const len = step.length()
      ray.set(b.pos, step.clone().normalize())
      let best = null
      let bestD = len
      for (const z of s.zombies) {
        const half = s.zombieHalf * (z.size || 1)
        box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
        box.max.set((z.x + half) * B, (z.y + s.zombieHeight * (z.size || 1)) * B, (z.z + half) * B)
        if (!ray.intersectBox(box, hit)) continue
        const d = hit.distanceTo(b.pos)
        if (d <= bestD) {
          bestD = d
          best = z
        }
      }
      if (best) {
        this.soak(best)
        this._splash(b.pos)
        this._drop(b)
        continue
      }
      const q = b.pos.clone().add(step)
      const type = bm.getBlockAt(Math.floor(q.x / B), Math.floor(q.y / B), Math.floor(q.z / B))
      if ((type && !bm._chunks?.isLiquid?.(type)) || b.life > b.max) {
        this.douse(q.x / B, q.y / B, q.z / B)
        if (type) this._splash(q)
        this._drop(b)
        continue
      }
      b.pos.copy(q)
      b.mesh.position.copy(q)
    }
  }

  _splash(p) {
    const B = this.s.B
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2
      this.s._fx?.spark(p.x, p.y, p.z, { life: 0.4, from: 0.1, to: 0.03, gravity: 8, color: 0x8fd6ff, vel: new THREE.Vector3(Math.cos(a) * 1.5 * B, 2 * B, Math.sin(a) * 1.5 * B) })
    }
  }

  _drop(b) {
    b.mesh.removeFromParent()
    const i = this.list.indexOf(b)
    if (i >= 0) this.list.splice(i, 1)
  }

  clear() {
    for (const b of [...this.list]) this._drop(b)
    this.tank = TANK
    hidePill('waterGun')
  }
}
