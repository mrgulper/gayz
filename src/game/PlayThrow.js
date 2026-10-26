// Throwing the Knife and the Tomahawk (2026-10-18, Gaymi: "for the knife
// and tomahawk when aiming you can throw it"): hold right-click to aim,
// then left-click throws it instead of swinging. It flies spinning in an
// arc, hits the first zombie it touches (harder than a swing) or sticks in
// the block it hits for a moment, and is back in your hand after
// THROW_BACK_S - the hand is empty until then. Owned by BuildSurvival
// (`s.throws`), stepped from its update().
import * as THREE from 'three'
import { cloneViewmodel } from './Viewmodels.js'

const SPEED = 30 // blocks per second
const GRAVITY = 14
const SPIN = 18 // radians a second (about 3 turns)
const MAX_LIFE = 3 // seconds in the air before it is gone
const STUCK_S = 1.2 // seconds it stays in a wall
// Thrown damage, as a share of the swing's.
const THROW_MULT = 1.4
// Seconds until it's back in your hand.
export const THROW_BACK_S = { melee: 0.9, tomahawk: 1.3 }

export class PlayThrow {
  constructor(survival) {
    this.s = survival
    this.list = []
  }

  // Thrown from the camera, along where it looks. Returns true if thrown.
  throw() {
    const s = this.s
    const bm = s.bm
    const B = s.B
    const id = s.weaponId
    bm.camera.updateMatrixWorld()
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(bm.camera.quaternion)
    const from = bm.camera.position.clone().addScaledVector(dir, 0.6 * B)
    const group = new THREE.Group()
    const source = bm.game?.weapons?.viewmodels?.[id]
    if (source) {
      const model = cloneViewmodel(source)
      model.visible = true
      // Viewmodels are sized for the hand camera; a thrown one is about
      // as long as half a block.
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const long = Math.max(size.x, size.y, size.z) || 1
      model.scale.multiplyScalar((0.6 * B) / long)
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar((0.6 * B) / long)
      model.position.sub(c)
      group.add(model)
    } else {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.08 * B, 0.08 * B, 0.5 * B), new THREE.MeshLambertMaterial({ color: 0x9a9a9a })))
    }
    group.position.copy(from)
    // Blade first, spinning end over end around its side axis.
    group.rotation.order = 'YXZ'
    group.rotation.y = bm._yaw
    bm.scene.add(group)
    this.list.push({
      group,
      id,
      pos: from.clone(),
      vel: dir.multiplyScalar(SPEED * B),
      life: 0,
      stuck: 0,
      damage: s.weapon.damage * s._damageMult() * THROW_MULT,
    })
    // The hand is empty until it comes back.
    s._nextShotAt = performance.now() + (THROW_BACK_S[id] ?? 1) * 1000
    this._handBackAt = s._nextShotAt
    if (bm.tryMode._gun) bm.tryMode._gun.visible = false
    return true
  }

  update(dt) {
    const s = this.s
    const bm = s.bm
    const B = s.B
    if (this._handBackAt && performance.now() >= this._handBackAt) {
      this._handBackAt = 0
      if (bm.tryMode._gun) bm.tryMode._gun.visible = true
    }
    const step = new THREE.Vector3()
    const ray = new THREE.Ray()
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    for (const t of [...this.list]) {
      t.life += dt
      if (t.stuck) {
        t.stuck -= dt
        if (t.stuck <= 0) this._drop(t)
        continue
      }
      if (t.life > MAX_LIFE) {
        this._drop(t)
        continue
      }
      t.vel.y -= GRAVITY * B * dt
      step.copy(t.vel).multiplyScalar(dt)
      const len = step.length()
      ray.set(t.pos, step.clone().normalize())
      // The first zombie on the way this frame.
      let best = null
      let bestD = len
      for (const z of s.zombies) {
        const half = s.zombieHalf * (z.size || 1)
        const height = s.zombieHeight * (z.size || 1)
        box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
        box.max.set((z.x + half) * B, (z.y + height) * B, (z.z + half) * B)
        if (!ray.intersectBox(box, hit)) continue
        const d = hit.distanceTo(t.pos)
        if (d <= bestD) {
          bestD = d
          best = { z, head: hit.y / B > z.y + height * 0.76 }
        }
      }
      if (best) {
        s.hitZombieWith(best.z, t.damage * (best.head ? 2 : 1), ray.direction, best.head)
        this._drop(t)
        continue
      }
      // Or an animal (PlayAnimals.js).
      if (s.animals?.hitRay(ray, len, t.damage, s.weaponId)) {
        this._drop(t)
        continue
      }
      // A block on the way: it sticks there for a moment.
      const n = Math.max(1, Math.ceil(len / (0.25 * B)))
      let wall = false
      for (let i = 1; i <= n; i++) {
        const q = t.pos.clone().addScaledVector(step, i / n)
        const type = bm.getBlockAt(Math.floor(q.x / B), Math.floor(q.y / B), Math.floor(q.z / B))
        if (type && !bm._chunks.isLiquid(type)) {
          t.pos.addScaledVector(step, (i - 1) / n)
          wall = true
          break
        }
      }
      if (wall) {
        t.stuck = STUCK_S
        t.group.position.copy(t.pos)
        continue
      }
      t.pos.add(step)
      t.group.position.copy(t.pos)
      t.group.rotation.x -= SPIN * dt
    }
  }

  _drop(t) {
    t.group.removeFromParent()
    const i = this.list.indexOf(t)
    if (i >= 0) this.list.splice(i, 1)
  }

  // A new game, or the game ends: all gone, the hand back.
  clear() {
    for (const t of [...this.list]) this._drop(t)
    this._handBackAt = 0
    const gun = this.s.bm.tryMode?._gun
    if (gun) gun.visible = true
  }
}
