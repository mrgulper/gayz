// Catch Traps (2026-10-31, Gaymi picked "weaken, then throw a trap"): hold
// one and click to throw it. It flies in an arc like a thrown knife
// (PlayThrow.js) and snaps shut on the first zombie or wild animal it
// touches. The weaker that one is, the better the chance (catchChance) -
// caught, it's gone from the game and kept (Creatures.js) for your battle
// team; not caught, it breaks free and the trap is used up. Owned by
// BuildSurvival (`s.catcher`), stepped from its update().
//
// On a server only the host runs the zombies and animals, so a player who
// isn't the host can't catch yet (a message says so, the trap is kept).
import * as THREE from 'three'
import { addCreature, creatureName, MAX_CREATURES } from './Creatures.js'
import { PlayAnimals, animalRarity } from './PlayAnimals.js'
import { t } from './i18n.js'

const SPEED = 22 // blocks per second
const GRAVITY = 16
const MAX_LIFE = 3
const THROW_GAP_MS = 600
// A caught creature's trap shakes there this long before it's gone.
const SHAKE_S = 0.8
// Harder to catch the rarer it is, and a boss is harder still.
const RARITY_MULT = { common: 1, uncommon: 0.9, rare: 0.78, epic: 0.64, legendary: 0.5, mythic: 0.4 }
const BOSS_MULT = 0.4

// 0..1: a little at full health, most of the way at nearly none.
export function catchChance(health, maxHealth, tier = 'common', boss = false) {
  const left = Math.max(0, Math.min(1, health / (maxHealth || 1)))
  const base = 0.08 + 0.84 * (1 - left) ** 1.4
  return Math.min(0.95, base * (RARITY_MULT[tier] ?? 1) * (boss ? BOSS_MULT : 1))
}

let _geo = null
let _mats = null
function trapParts(B) {
  if (!_geo) {
    _geo = { bar: new THREE.BoxGeometry(0.05 * B, 0.42 * B, 0.05 * B), lid: new THREE.BoxGeometry(0.46 * B, 0.06 * B, 0.46 * B) }
    _mats = { bar: new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }), lid: new THREE.MeshLambertMaterial({ color: 0xc8a040 }) }
  }
  return { geo: _geo, mats: _mats }
}

// A little cage: a gold lid and floor with metal bars between.
function makeTrap(B) {
  const { geo, mats } = trapParts(B)
  const g = new THREE.Group()
  for (const y of [-0.21, 0.21]) {
    const lid = new THREE.Mesh(geo.lid, mats.lid)
    lid.position.y = y * B
    g.add(lid)
  }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const bar = new THREE.Mesh(geo.bar, mats.bar)
    bar.position.set(x * 0.2 * B, 0, z * 0.2 * B)
    g.add(bar)
  }
  return g
}

export class PlayCatch {
  constructor(survival) {
    this.s = survival
    this.list = []
    this._nextAt = 0
  }

  // From the held trap (PlayInventory.useHeld). true if thrown (one used).
  throw() {
    const s = this.s
    const bm = s.bm
    const B = s.B
    const now = performance.now()
    if (now < this._nextAt) return false
    if (s.net && !s.net.closed && !s.net.isHost) {
      s._message(t('catchHostOnly'))
      return false
    }
    this._nextAt = now + THROW_GAP_MS
    bm.camera.updateMatrixWorld()
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(bm.camera.quaternion)
    const from = bm.camera.position.clone().addScaledVector(dir, 0.6 * B)
    const group = makeTrap(B)
    group.position.copy(from)
    bm.scene.add(group)
    this.list.push({ group, pos: from.clone(), vel: dir.multiplyScalar(SPEED * B), life: 0, shake: 0 })
    return true
  }

  update(dt) {
    const s = this.s
    const bm = s.bm
    const B = s.B
    const step = new THREE.Vector3()
    const ray = new THREE.Ray()
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    for (const tr of [...this.list]) {
      tr.life += dt
      if (tr.shake > 0) {
        tr.shake -= dt
        tr.group.rotation.z = Math.sin(tr.life * 40) * 0.25
        if (tr.shake <= 0) this._drop(tr)
        continue
      }
      if (tr.life > MAX_LIFE) {
        this._drop(tr)
        continue
      }
      tr.vel.y -= GRAVITY * B * dt
      step.copy(tr.vel).multiplyScalar(dt)
      const len = step.length()
      ray.set(tr.pos, step.clone().normalize())
      tr.group.rotation.y += dt * 8
      // The first zombie on the way this frame.
      let best = null
      let bestD = len
      for (const z of s.zombies) {
        if (z.health <= 0) continue
        const half = s.zombieHalf * (z.size || 1)
        const height = s.zombieHeight * (z.size || 1)
        box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
        box.max.set((z.x + half) * B, (z.y + height) * B, (z.z + half) * B)
        if (!ray.intersectBox(box, hit)) continue
        const d = hit.distanceTo(tr.pos)
        if (d <= bestD) {
          bestD = d
          best = z
        }
      }
      if (best) {
        this._tryZombie(tr, best)
        continue
      }
      const a = s.animals?._onRay(ray, len, { wildOnly: true })
      if (a) {
        this._tryAnimal(tr, a)
        continue
      }
      // A block on the way: it falls there, used up.
      const n = Math.max(1, Math.ceil(len / (0.25 * B)))
      let wall = false
      for (let i = 1; i <= n; i++) {
        const q = tr.pos.clone().addScaledVector(step, i / n)
        const type = bm.getBlockAt(Math.floor(q.x / B), Math.floor(q.y / B), Math.floor(q.z / B))
        if (type && !bm._chunks.isLiquid(type)) {
          wall = true
          break
        }
      }
      if (wall) {
        this._drop(tr)
        continue
      }
      tr.pos.add(step)
      tr.group.position.copy(tr.pos)
    }
  }

  _full() {
    this.s._message(t('catchFull', { n: MAX_CREATURES }))
  }

  _tryZombie(tr, z) {
    const s = this.s
    const c = { t: 'z', k: z.kind || null, r: z.tier || 'common', n: z.nameIdx ?? 0, b: !!z.boss }
    if (Math.random() >= catchChance(z.health, z.maxHealth, c.r, c.b)) return this._brokeFree(tr, c)
    if (!addCreature(c)) {
      this._full()
      return this._drop(tr)
    }
    // Gone from the game like a lost zombie (no kill, but the wave counts it).
    if (s._toSpawn > 0 && !z.extra) s._toSpawn--
    s._removeZombie(z)
    s.zombies = s.zombies.filter((o) => o !== z)
    s._renderHud()
    this._caught(tr, z.x, z.y, z.z, c)
  }

  _tryAnimal(tr, a) {
    const s = this.s
    const k = PlayAnimals.KINDS[a.kind]
    const c = { t: 'a', k: a.kind, r: animalRarity(a.kind) }
    if (Math.random() >= catchChance(a.health, k.health, c.r)) {
      // It runs off (or gets angry), like being hit.
      s.animals.damage(a, 0)
      return this._brokeFree(tr, c)
    }
    if (!addCreature(c)) {
      this._full()
      return this._drop(tr)
    }
    s.animals.remove(a)
    this._caught(tr, a.x, a.y, a.z, c)
  }

  _caught(tr, x, y, z, c) {
    const B = this.s.B
    tr.group.position.set(x * B, (y + 0.25) * B, z * B)
    tr.group.rotation.set(0, 0, 0)
    tr.shake = SHAKE_S
    this.s.stats.caught = (this.s.stats.caught || 0) + 1
    this.s._message(t('catchCaught', { name: creatureName(c) }))
  }

  _brokeFree(tr, c) {
    this.s._message(t('catchBrokeFree', { name: creatureName(c) }))
    this._drop(tr)
  }

  _drop(tr) {
    tr.group.removeFromParent()
    const i = this.list.indexOf(tr)
    if (i >= 0) this.list.splice(i, 1)
  }

  clear() {
    for (const tr of [...this.list]) this._drop(tr)
    this._nextAt = 0
  }
}
