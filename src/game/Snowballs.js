// Snowball fights (2026-11-01, Gaymi's idea list 3: "a winter event where
// snowballs freeze zombies for a moment"). Winter only - December to
// February on your own clock - unless Settings > Snowballs All Year is on
// (winterOn). In winter you start a game with START_SNOWBALLS, every new
// wave hands out WAVE_SNOWBALLS more, loot chests have some, and a Snow
// block crafts into four (PlayCrafting `winter` recipe).
//
// Hold a Snowball and use it (click / the use button) to throw one: it
// flies in an arc and the first zombie it hits is frozen solid for
// FREEZE_S (it can't move or bite) inside a block of ice, and takes a
// little damage. Alone or a server's host freezes it straight away; a
// guest's hit travels like a shot (PlayNet.queueFreeze) and the host
// freezes it. Owned by BuildSurvival (`s.snowballs`).
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

const SPEED = 24 // blocks per second
const GRAVITY = 16
const MAX_LIFE = 2.5
const COOLDOWN_S = 0.35
export const FREEZE_S = 3
export const SNOWBALL_DAMAGE = 4
export const START_SNOWBALLS = 8
export const WAVE_SNOWBALLS = 4
export const CHEST_SNOWBALLS = [3, 6]

// Is it snowball season? December, January, February - or the setting.
export function winterOn(settings, now = new Date()) {
  if (settings?.snowballsAllYear) return true
  const m = now.getMonth()
  return m === 11 || m === 0 || m === 1
}

export class Snowballs {
  constructor(survival) {
    this.s = survival
    this.list = []
    this.ice = new Map() // zombie -> its ice block mesh
    this._nextAt = 0
    this._geo = null
    this._mat = null
    this._iceGeo = null
    this._iceMat = null
  }

  get on() {
    return winterOn(this.s.bm.game?.settings)
  }

  // A new wave (BuildSurvival._startWave): snowballs to start with on
  // wave 1, a few more on every one after.
  onWave(n) {
    if (!this.on || !this.s.inv) return
    this.s.inv.add({ kind: 'item', id: 'snowball', n: n <= 1 ? START_SNOWBALLS : WAVE_SNOWBALLS })
    if (n <= 1) setTimeout(() => this.s.active && this.s._message(t('snowballSeason'), 4), 2500)
  }

  // How many a loot chest gives (0 out of season).
  chestCount() {
    if (!this.on) return 0
    const [lo, hi] = CHEST_SNOWBALLS
    return lo + Math.floor(Math.random() * (hi - lo + 1))
  }

  // Thrown from the camera. -> true if thrown (one snowball used).
  throw() {
    const s = this.s
    const bm = s.bm
    const B = s.B
    if (!s.active || s.dead || performance.now() < this._nextAt) return false
    this._nextAt = performance.now() + COOLDOWN_S * 1000
    if (!this._geo) {
      this._geo = new THREE.SphereGeometry(0.16 * B, 8, 6)
      this._mat = new THREE.MeshLambertMaterial({ color: 0xf4f8ff })
    }
    bm.camera.updateMatrixWorld()
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(bm.camera.quaternion)
    const from = bm.camera.position.clone().addScaledVector(dir, 0.6 * B)
    const mesh = new THREE.Mesh(this._geo, this._mat)
    mesh.position.copy(from)
    bm.scene.add(mesh)
    this.list.push({ mesh, pos: from.clone(), vel: dir.multiplyScalar(SPEED * B).add(new THREE.Vector3(0, 2 * B, 0)), life: 0 })
    try { audioEngine.playSpecial?.('snowThrow') } catch { /* no audio */ }
    return true
  }

  // Freeze one zombie (alone, or the host - a guest's hit comes here too).
  freeze(z) {
    if (!z || z.dead) return
    z.frozen = FREEZE_S
    this._iceOn(z)
  }

  _iceOn(z) {
    if (this.ice.has(z)) return
    const B = this.s.B
    if (!this._iceGeo) {
      this._iceGeo = new THREE.BoxGeometry(1, 1, 1)
      this._iceMat = new THREE.MeshLambertMaterial({ color: 0xaee4f0, transparent: true, opacity: 0.45, depthWrite: false })
    }
    const size = z.size || 1
    const m = new THREE.Mesh(this._iceGeo, this._iceMat)
    m.scale.set(0.9 * size * B, 2.2 * size * B, 0.9 * size * B)
    this.s.bm.scene.add(m)
    this.ice.set(z, m)
  }

  update(dt) {
    const s = this.s
    const B = s.B
    const bm = s.bm
    // Ice blocks follow their zombie and melt when it thaws.
    for (const [z, m] of this.ice) {
      if (z.dead || !(z.frozen > 0) || !s.zombies.includes(z)) {
        m.removeFromParent()
        this.ice.delete(z)
        continue
      }
      m.position.set(z.x * B, (z.y + 1.1 * (z.size || 1)) * B, z.z * B)
    }
    const ray = new THREE.Ray()
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    const step = new THREE.Vector3()
    for (const b of [...this.list]) {
      b.life += dt
      if (b.life > MAX_LIFE) {
        this._drop(b)
        continue
      }
      b.vel.y -= GRAVITY * B * dt
      step.copy(b.vel).multiplyScalar(dt)
      const len = step.length()
      ray.set(b.pos, step.clone().normalize())
      let best = null
      let bestD = len
      for (const z of s.zombies) {
        const half = s.zombieHalf * (z.size || 1)
        const height = s.zombieHeight * (z.size || 1)
        box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
        box.max.set((z.x + half) * B, (z.y + height) * B, (z.z + half) * B)
        if (!ray.intersectBox(box, hit)) continue
        const d = hit.distanceTo(b.pos)
        if (d <= bestD) {
          bestD = d
          best = z
        }
      }
      if (best) {
        this._splat(b.pos.clone().addScaledVector(ray.direction, bestD))
        if (s.net && !s.net.isHost) {
          s.net.queueFreeze(`z${best.id}`, SNOWBALL_DAMAGE)
          this._iceOn(best)
          best.frozen = FREEZE_S
        } else {
          this.freeze(best)
          s.damageZombie(best, SNOWBALL_DAMAGE)
        }
        this._drop(b)
        continue
      }
      // A block (not water): it splats.
      const n = Math.max(1, Math.ceil(len / (0.25 * B)))
      let wall = null
      for (let i = 1; i <= n; i++) {
        const q = b.pos.clone().addScaledVector(step, i / n)
        const type = bm.getBlockAt(Math.floor(q.x / B), Math.floor(q.y / B), Math.floor(q.z / B))
        if (type && !bm._chunks.isLiquid(type)) {
          wall = q
          break
        }
      }
      if (wall) {
        this._splat(wall)
        this._drop(b)
        continue
      }
      b.pos.add(step)
      b.mesh.position.copy(b.pos)
    }
  }

  _splat(p) {
    const B = this.s.B
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2
      this.s._fx?.spark(p.x, p.y, p.z, { life: 0.5, from: 0.14, to: 0.04, gravity: 6, color: 0xffffff, vel: new THREE.Vector3(Math.cos(a) * 2 * B, 2.5 * B, Math.sin(a) * 2 * B) })
    }
    try { audioEngine.playSpecial?.('snowSplat') } catch { /* no audio */ }
  }

  _drop(b) {
    b.mesh.removeFromParent()
    const i = this.list.indexOf(b)
    if (i >= 0) this.list.splice(i, 1)
  }

  clear() {
    for (const b of [...this.list]) this._drop(b)
    for (const m of this.ice.values()) m.removeFromParent()
    this.ice.clear()
  }
}
