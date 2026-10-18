// Broken blocks pop out (2026-10-18, Gaymi: "when you break a block it
// should pop out and you pick it up", from a picture of a small spinning
// block on the ground). A block broken by hand in a game leaves a little
// copy of itself (DROP_SCALE of a block) that hops out, falls to the
// ground, slowly spins and bobs, and flies into you when you walk near -
// then it's in your inventory (PlayInventory.js). If the inventory is full
// it waits on the ground. Gone after DROP_LIFE_S, or when the game ends.
// Meshes only (the block's own held-block look, BuildMode._heldBlockParts),
// never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { itemIconCanvas } from './PlayInventory.js'

const DROP_SCALE = 0.36
const DROP_LIFE_S = 300
const MAX_DROPS = 120
const PICKUP_R = 2.2 // blocks: starts flying to you
const COLLECT_R = 0.45
const GRAVITY = 22 // blocks / s^2
const PICKUP_DELAY_S = 0.6 // it hops out first, then comes to you

export class PlayDrops {
  constructor(survival) {
    this.s = survival
    this.list = []
  }

  get bm() {
    return this.s.bm
  }

  // A drop of `type` from the block at cell (x, y, z).
  spawn(type, x, y, z) {
    const parts = this.bm._heldBlockParts?.(type)
    if (!parts) return false
    const mesh = new THREE.Mesh(parts.geometry, parts.material)
    mesh.scale.setScalar(DROP_SCALE)
    this.bm.scene.add(mesh)
    const a = Math.random() * Math.PI * 2
    this.list.push({ type, mesh, x: x + 0.5, y: y + 0.4, z: z + 0.5, vx: Math.cos(a) * 1.2, vy: 4.5, vz: Math.sin(a) * 1.2, age: 0, spin: Math.random() * 6, onGround: false })
    while (this.list.length > MAX_DROPS) this._remove(this.list[0])
    return true
  }

  // An item (not a block) lying on the ground - Meat from an animal
  // (PlayAnimals.js): its inventory picture, always facing you.
  spawnItem(id, x, y, z) {
    if (!this._itemMats) this._itemMats = new Map()
    let mat = this._itemMats.get(id)
    if (!mat) {
      const tex = new THREE.CanvasTexture(itemIconCanvas(id))
      tex.magFilter = THREE.NearestFilter
      tex.colorSpace = THREE.SRGBColorSpace
      mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 })
      this._itemMats.set(id, mat)
    }
    const mesh = new THREE.Sprite(mat)
    mesh.scale.setScalar(DROP_SCALE * 1.4 * this.s.B)
    this.bm.scene.add(mesh)
    const a = Math.random() * Math.PI * 2
    this.list.push({ type: id, kind: 'item', mesh, x: x + 0.5, y: y + 0.4, z: z + 0.5, vx: Math.cos(a) * 1.2, vy: 4.5, vz: Math.sin(a) * 1.2, age: 0, spin: 0, onGround: false })
    while (this.list.length > MAX_DROPS) this._remove(this.list[0])
    return true
  }

  _remove(d) {
    this.bm.scene.remove(d.mesh)
    this.list = this.list.filter((o) => o !== d)
  }

  update(dt) {
    if (!this.list.length) return
    const B = this.s.B
    const p = this.bm.tryMode.pos
    const px = p.x
    const py = p.y + 0.4 // around your middle, so drops in a hole you dug still come
    const pz = p.z
    for (const d of [...this.list]) {
      d.age += dt
      if (d.age > DROP_LIFE_S) {
        this._remove(d)
        continue
      }
      const dist = Math.hypot(px - d.x, py - d.y, pz - d.z)
      if (dist < PICKUP_R && d.age > PICKUP_DELAY_S && !d.full && !this.s.dead) {
        // Flies into you.
        const k = Math.min(1, dt * 10)
        d.x += (px - d.x) * k
        d.y += (py - d.y) * k
        d.z += (pz - d.z) * k
        if (dist < COLLECT_R) {
          const left = this.s.inv?.add({ kind: d.kind || 'block', id: d.type, n: 1 }) ?? 1
          if (left === 0) {
            this._remove(d)
            continue
          }
          // Inventory full: stays put until there's room.
          d.full = true
          this.s._message(t('invFull'))
        }
      } else {
        if (d.full && dist > PICKUP_R * 1.5) d.full = false
        // Hop out, fall, land.
        d.vy -= GRAVITY * dt
        d.x += d.vx * dt
        d.z += d.vz * dt
        d.y += d.vy * dt
        d.vx *= Math.max(0, 1 - dt * 3)
        d.vz *= Math.max(0, 1 - dt * 3)
        const ground = this.s._groundUnder(d.x, d.y + 0.5, d.z)
        if (d.y <= ground) {
          d.y = ground
          d.vy = 0
          d.vx = 0
          d.vz = 0
          d.onGround = true
        }
      }
      d.spin += dt * 1.6
      const bob = d.onGround ? 0.12 + Math.sin(d.age * 2.6) * 0.06 : 0
      d.mesh.position.set(d.x * B, (d.y + bob + DROP_SCALE / 2) * B, d.z * B)
      d.mesh.rotation.set(0, d.spin, 0)
    }
  }

  clear() {
    for (const d of this.list) this.bm.scene.remove(d.mesh)
    this.list = []
  }
}
