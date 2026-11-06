// Hot springs (2026-11-02, Gaymi's idea list 6: "steaming pools in snowy
// biomes that slowly heal you while you sit in them"). Owned by
// BuildSurvival (`s.springs`), on every map.
//
// While you're on snow (the block under you, so any snowy place on any
// map), every CHECK_S seconds, if there's no spring within GAP blocks, one
// is found NEAR..FAR blocks away on flat snowy ground: a round pool
// (POOL_R) two blocks deep, with a rim of calcite and stone, and steam
// rising off it. Stand in the water and you heal HEAL_PER_S a second. At
// most MAX_SPRINGS a game. Everything goes back as it was when the game
// ends (TempBlocks.js). Each player's own. Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { TempBlocks } from './TempBlocks.js'
import { SNOWY } from './Sleds.js'

export const MAX_SPRINGS = 6
const CHECK_S = 4
export const GAP = 60
const NEAR = 12
const FAR = 24
export const POOL_R = 2.6
export const HEAL_PER_S = 4
const PUFFS = 10
const NOTICE_R = 14

export class HotSprings {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.springs = []
    this._in = 1
    this._group = null
    this._was = false
  }

  get B() {
    return this.s.B
  }

  // Standing in a spring's water right now?
  inSpring(p) {
    return this.springs.some((sp) => Math.hypot(p.x - sp.x, p.z - sp.z) < POOL_R + 0.3 && p.y > sp.y - 2.2 && p.y < sp.y + 1.2)
  }

  update(dt) {
    const s = this.s
    if (!s.active || s.td || s.escape || s.party) return
    const me = s.bodyPos()
    // Healing in the water.
    const inIt = !s.dead && this.inSpring(me)
    if (inIt && s.health < s.maxHealth) {
      s.health = Math.min(s.maxHealth, s.health + HEAL_PER_S * dt)
      s._renderHud?.()
    }
    if (inIt && !this._was) s._message(t('springIn', { n: HEAL_PER_S }), 3)
    this._was = inIt
    for (const sp of this.springs) {
      if (!sp.seen && Math.hypot(me.x - sp.x, me.z - sp.z) < NOTICE_R) {
        sp.seen = true
        s._message(t('springFound'), 4)
      }
    }
    this._steam(dt)
    if (this.springs.length >= MAX_SPRINGS) return
    this._in -= dt
    if (this._in > 0) return
    this._in = CHECK_S
    const under = s.bm.getBlockAt(Math.floor(me.x), Math.floor(me.y - 0.05), Math.floor(me.z))
    if (!SNOWY.has(under) || this.springs.some((sp) => Math.hypot(sp.x - me.x, sp.z - me.z) < GAP)) return
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2
      const d = NEAR + Math.random() * (FAR - NEAR)
      const x = Math.floor(me.x + Math.cos(a) * d)
      const z = Math.floor(me.z + Math.sin(a) * d)
      const y = this._flatSnow(x, z, me.y)
      if (y === null) continue
      this.build(x, y, z)
      return
    }
  }

  // The top block's y if the ground round (x, z) is flat snow, else null.
  _flatSnow(cx, cz, nearY) {
    const s = this.s
    const R = Math.ceil(POOL_R) + 1
    const top = (x, z) => {
      const g = s._groundUnder(x + 0.5, nearY + 12, z + 0.5)
      return g === nearY + 12 ? null : g - 1
    }
    const y0 = top(cx, cz)
    if (y0 === null || !SNOWY.has(s.bm.getBlockAt(cx, y0, cz))) return null
    for (let x = cx - R; x <= cx + R; x++) {
      for (let z = cz - R; z <= cz + R; z++) {
        if (Math.hypot(x - cx, z - cz) > R) continue
        if (s.camp?.inside?.(x + 0.5, z + 0.5, 2)) return null
        if (top(x, z) !== y0) return null
      }
    }
    return y0
  }

  // A pool round (cx, cz), its water's top at y0 (the ground's top block).
  build(cx, y0, cz) {
    const R = POOL_R
    const rim = Math.ceil(R) + 1
    for (let x = cx - rim; x <= cx + rim; x++) {
      for (let z = cz - rim; z <= cz + rim; z++) {
        const d = Math.hypot(x - cx, z - cz)
        if (d <= R) {
          this.cells.put(x, y0 - 2, z, 'stone')
          this.cells.put(x, y0 - 1, z, 'water')
          this.cells.put(x, y0, z, 'water')
        } else if (d <= R + 1.2) {
          this.cells.put(x, y0, z, Math.random() < 0.6 ? 'calcite' : 'stone')
          this.cells.put(x, y0 - 1, z, 'stone')
        }
      }
    }
    const sp = { x: cx + 0.5, y: y0 + 1, z: cz + 0.5, seen: false, puffs: [] }
    this._puffs(sp)
    this.springs.push(sp)
    try { audioEngine.playSpecial?.('thud') } catch { /* no audio */ }
    return sp
  }

  _scene() {
    if (!this._group) {
      this._group = new THREE.Group()
      this.s.bm.scene.add(this._group)
    }
    return this._group
  }

  _puffs(sp) {
    const B = this.B
    if (!this._puffGeo) this._puffGeo = new THREE.BoxGeometry(0.6 * B, 0.6 * B, 0.6 * B)
    for (let i = 0; i < PUFFS; i++) {
      const m = new THREE.Mesh(this._puffGeo, new THREE.MeshBasicMaterial({ color: 0xf2f4f8, transparent: true, opacity: 0, depthWrite: false }))
      const p = { mesh: m, t: (i / PUFFS) * 3, ox: (Math.random() - 0.5) * POOL_R * 1.4, oz: (Math.random() - 0.5) * POOL_R * 1.4 }
      sp.puffs.push(p)
      this._scene().add(m)
    }
  }

  // Steam rises off the water, grows and fades.
  _steam(dt) {
    const B = this.B
    for (const sp of this.springs) {
      for (const p of sp.puffs) {
        p.t += dt
        if (p.t > 3) {
          p.t -= 3
          p.ox = (Math.random() - 0.5) * POOL_R * 1.4
          p.oz = (Math.random() - 0.5) * POOL_R * 1.4
        }
        const k = p.t / 3
        p.mesh.position.set((sp.x + p.ox + Math.sin(p.t * 1.3) * 0.3) * B, (sp.y + k * 3) * B, (sp.z + p.oz) * B)
        p.mesh.scale.setScalar(0.5 + k * 1.2)
        p.mesh.material.opacity = Math.sin(k * Math.PI) * 0.4
      }
    }
  }

  clear() {
    this.cells.restore()
    this._group?.removeFromParent()
    this._group?.traverse((o) => {
      if (o.isMesh) o.material.dispose()
    })
    this._puffGeo?.dispose()
    this._puffGeo = null
    this._group = null
    this.springs = []
    this._in = 1
    this._was = false
  }
}
