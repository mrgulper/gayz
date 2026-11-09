// Finds lying about the world (2026-11-09, Gaymi's idea list 9 - "find
// them in the world" for the new Bike, Hoverboard, Guitar and Drums).
// Now and then (FIND_FIRST_S, then every FIND_EVERY_S) one of them you
// don't have yet turns up on the ground FIND_MIN..FIND_MAX blocks from you,
// spinning over a tall shimmering beam you can spot from far off. Walk into
// it to pick it up. One out at a time; gone after FIND_LIFE_S. Chests have
// one now and then too (BuildSurvival, CHEST_FIND_CHANCE).
//
// Only in normal games (not party modes, Tower Defense or Escape Rooms).
// Each player's own. Meshes only, never a light. Owned by BuildSurvival
// (`s.finds`).
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { itemIconCanvas, itemName } from './PlayInventory.js'

export const FIND_IDS = ['bike', 'hoverboard', 'guitar', 'drums', 'bungeeCord']
export const FIND_FIRST_S = 45
export const FIND_EVERY_S = 120
export const FIND_LIFE_S = 180
const FIND_MIN = 14
const FIND_MAX = 26
const PICK_R = 1.4
const BEAM_H = 18

export class WorldFinds {
  constructor(survival) {
    this.s = survival
    this.find = null // { id, x, y, z, group, left }
    this.next = FIND_FIRST_S
  }

  // One you don't have yet, or ''.
  pick() {
    const inv = this.s.inv
    const left = FIND_IDS.filter((id) => !inv?.has(id) && id !== this.find?.id)
    return left.length ? left[Math.floor(Math.random() * left.length)] : ''
  }

  get allowed() {
    const s = this.s
    return s.active && !s.party && !s.td && !s.escape && !s.dead && !s.spectating
  }

  update(dt) {
    if (!this.allowed) return
    if (this.find) {
      this._tick(dt)
      return
    }
    this.next -= dt
    if (this.next > 0) return
    this.next = FIND_EVERY_S
    const id = this.pick()
    if (id) this._place(id)
  }

  _place(id) {
    const s = this.s
    const bm = s.bm
    const me = s.bodyPos()
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2
      const d = FIND_MIN + Math.random() * (FIND_MAX - FIND_MIN)
      const x = Math.floor(me.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(me.z + Math.sin(a) * d) + 0.5
      const y = s._groundUnder(x, me.y + 20, z)
      if (!Number.isFinite(y) || Math.abs(y - me.y) > 12) continue
      const under = bm.getBlockAt(Math.floor(x), Math.floor(y) - 1, Math.floor(z))
      if (!under || under === 'water' || under === 'lava') continue
      this.find = { id, x, y, z, group: this._build(id), left: FIND_LIFE_S, t: 0 }
      s._message(t('findNearby', { item: itemName(id) }), 4)
      try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
      return
    }
  }

  _build(id) {
    const B = this.s.B
    const g = new THREE.Group()
    const tex = new THREE.CanvasTexture(itemIconCanvas(id))
    tex.magFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 }))
    icon.scale.setScalar(0.9 * B)
    icon.position.y = 0.8 * B
    g.add(icon)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * B, 0.3 * B, BEAM_H * B, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.y = (BEAM_H / 2) * B
    g.add(beam)
    this._icon = icon
    this._beam = beam
    this.s.bm.scene.add(g)
    return g
  }

  _tick(dt) {
    const s = this.s
    const f = this.find
    const B = s.B
    f.left -= dt
    f.t += dt
    f.group.position.set(f.x * B, f.y * B, f.z * B)
    this._icon.position.y = (0.8 + Math.sin(f.t * 2.5) * 0.12) * B
    this._beam.material.opacity = 0.2 + Math.sin(f.t * 3) * 0.08
    const me = s.bodyPos()
    if (Math.hypot(me.x - f.x, me.z - f.z) < PICK_R && Math.abs(me.y - f.y) < 2) {
      if (s.inv.add({ kind: 'item', id: f.id, n: 1 }) > 0) {
        if (!f.full) s._message(t('invFull'))
        f.full = true
        return
      }
      s._message(t('findGot', { item: itemName(f.id) }), 3)
      try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
      this._remove()
      return
    }
    if (f.left <= 0) this._remove()
  }

  _remove() {
    const f = this.find
    if (!f) return
    f.group.removeFromParent()
    f.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      o.material.map?.dispose?.()
      o.material.dispose()
    })
    this.find = null
  }

  clear() {
    this._remove()
    this.next = FIND_FIRST_S
  }
}
