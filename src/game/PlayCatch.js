// Catch Traps (2026-10-31, Gaymi picked "weaken, then throw a trap"): hold
// one and click to throw it. It flies in an arc like a thrown knife
// (PlayThrow.js) and snaps shut on the first zombie or wild animal it
// touches. The weaker that one is, the better the chance (catchChance) -
// caught, it's gone from the game and kept (Creatures.js) for your battle
// team; not caught, it breaks free and the trap is used up. Owned by
// BuildSurvival (`s.catcher`), stepped from its update().
//
// On a server only the host runs the zombies and animals (2026-10-31,
// "make catching work for everyone on a server"): another player's trap
// shakes on the one it hit while the catch goes to the host (PlayNet
// queueCatch). The host rolls it against that one's real health, takes it
// out of the game if caught (hostCatch), and the answer comes back to the
// thrower (remoteResult), who keeps the creature.
import * as THREE from 'three'
import { addCreature, creatureCount, creatureName, MAX_CREATURES } from './Creatures.js'
import { PlayAnimals, animalRarity } from './PlayAnimals.js'
import { t } from './i18n.js'

const SPEED = 22 // blocks per second
const GRAVITY = 16
const MAX_LIFE = 3
const THROW_GAP_MS = 600
// A caught creature's trap shakes there this long before it's gone.
const SHAKE_S = 0.8
// A guest's trap shakes this long at most while it waits for the host.
const WAIT_S = 6
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
    // A guest's traps waiting for the host's answer, oldest first.
    this._waiting = []
  }

  get _guestNet() {
    const net = this.s.net
    return net && !net.closed && !net.isHost ? net : null
  }

  // From the held trap (PlayInventory.useHeld). true if thrown (one used).
  throw() {
    const s = this.s
    const bm = s.bm
    const B = s.B
    const now = performance.now()
    if (now < this._nextAt) return false
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
      if (tr.wait > 0) {
        tr.wait -= dt
        tr.group.rotation.z = Math.sin(tr.life * 40) * 0.25
        // No answer: the trap goes (the answer still counts if it comes).
        if (tr.wait <= 0) this._drop(tr)
        continue
      }
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

  // No room for another: says so (true).
  _full() {
    if (creatureCount() < MAX_CREATURES) return false
    this.s._message(t('catchFull', { n: MAX_CREATURES }))
    return true
  }

  // What a zombie or animal is, as a creature (Creatures.js).
  _zombieCreature(z) {
    return { t: 'z', k: z.kind || null, r: z.tier || 'common', n: z.nameIdx ?? 0, b: !!z.boss }
  }

  _animalCreature(a) {
    return { t: 'a', k: a.kind, r: animalRarity(a.kind) }
  }

  // Rolls the catch on one of my own (solo, or the host's): true if caught,
  // and then it's gone from the game (no kill, but the wave counts it).
  _rollZombie(z) {
    const s = this.s
    const c = this._zombieCreature(z)
    if (Math.random() >= catchChance(z.health, z.maxHealth, c.r, c.b)) return false
    if (s._toSpawn > 0 && !z.extra) s._toSpawn--
    s._removeZombie(z)
    s.zombies = s.zombies.filter((o) => o !== z)
    s._renderHud()
    return true
  }

  _rollAnimal(a) {
    const s = this.s
    const c = this._animalCreature(a)
    if (Math.random() >= catchChance(a.health, PlayAnimals.KINDS[a.kind].health, c.r)) {
      // It runs off (or gets angry), like being hit.
      s.animals.damage(a, 0)
      return false
    }
    s.animals.remove(a)
    return true
  }

  // A guest's trap: it waits on the spot for the host's answer.
  _sendToHost(tr, id, x, y, z) {
    const B = this.s.B
    tr.group.position.set(x * B, (y + 0.25) * B, z * B)
    tr.group.rotation.set(0, 0, 0)
    tr.wait = WAIT_S
    this._waiting.push(tr)
    this._guestNet.queueCatch(id)
  }

  _tryZombie(tr, z) {
    if (this._guestNet) return this._sendToHost(tr, `z${z.id}`, z.x, z.y, z.z)
    if (this._full()) return this._drop(tr)
    const c = this._zombieCreature(z)
    if (!this._rollZombie(z)) return this._brokeFree(tr, c)
    addCreature(c)
    this._caught(tr, z.x, z.y, z.z, c)
  }

  _tryAnimal(tr, a) {
    if (this._guestNet) return this._sendToHost(tr, a.netId, a.x, a.y, a.z)
    if (this._full()) return this._drop(tr)
    const c = this._animalCreature(a)
    const { x, y, z } = a
    if (!this._rollAnimal(a)) return this._brokeFree(tr, c)
    addCreature(c)
    this._caught(tr, x, y, z, c)
  }

  // The host: another player's trap hit one of mine (h: { id, by }). The
  // answer goes back to them with what it was.
  hostCatch(h) {
    const s = this.s
    const net = s.net
    if (!net || net.closed) return
    const id = String(h.id)
    if (id[0] === 'z') {
      const z = s.zombies.find((o) => o.id === Number(id.slice(1)))
      if (!z || z.health <= 0) return net.queueCatchResult(h.by, { ok: false })
      const c = this._zombieCreature(z)
      return net.queueCatchResult(h.by, { ok: this._rollZombie(z), ...c })
    }
    const a = s.animals?.list.find((o) => o.netId === id)
    if (!a || a.dying || a.tamed) return net.queueCatchResult(h.by, { ok: false })
    const c = this._animalCreature(a)
    net.queueCatchResult(h.by, { ok: this._rollAnimal(a), ...c })
  }

  // A guest: the host's answer for my oldest waiting trap.
  remoteResult(r) {
    const tr = this._waiting.shift()
    const live = tr && this.list.includes(tr)
    const c = r?.t ? { t: r.t, k: r.k || null, r: r.r, n: r.n, b: r.b } : null
    if (r?.ok && c) {
      if (!addCreature(c)) {
        this.s._message(t('catchFull', { n: MAX_CREATURES }))
        if (live) this._drop(tr)
        return
      }
      this.s.stats.caught = (this.s.stats.caught || 0) + 1
      this.s._message(t('catchCaught', { name: creatureName(c) }))
      if (live) {
        tr.wait = 0
        tr.shake = SHAKE_S
      }
      return
    }
    if (c) this.s._message(t('catchBrokeFree', { name: creatureName(c) }))
    if (live) this._drop(tr)
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
    this._waiting = []
    this._nextAt = 0
  }
}
