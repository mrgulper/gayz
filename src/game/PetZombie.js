// Pet Zombie (2026-11-06, Gaymi's idea list 8: "tame one tiny zombie that
// follows you around. You can tame animals, but not zombies"). Owned by
// BuildSurvival (`s.pet`).
//
// Craft a Brain Snack (PlayCrafting), hold it, look at a zombie close by
// (TAME_R, not a boss) and use it: the zombie calms down and becomes your
// pet - it keeps its name, with a pink bow on its head and "(pet)" on its
// tag. Only one at a time. It's remembered on this device (KEY), so it's
// back beside you at the start of every game.
//
// It follows a little behind you (your body, so in Spectate too), catches
// up if it falls far behind (teleports past FAR), and nibbles any zombie
// that comes within GUARD_R of it - PET_DAMAGE every BITE_S. Zombies never
// go for it and nothing hurts it. Exactly 2 blocks tall like every mob
// (the "tiny" from the idea list became the pink bow - Gaymi's mob-height
// rule wins). Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { buildTexturedCharacter } from './MenuAvatar3D.js'
import { nameTag } from './BuildCamp.js'
import { zombieName, rollZombieName } from './ZombieNames.js'

export const KEY = 'gayz-pet-zombie'
export const TAME_R = 5
export const GUARD_R = 5
export const PET_DAMAGE = 10
export const BITE_S = 1.2
const FOLLOW = 2.5
const FAR = 24
const SPEED = 6.5

export function loadPet() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (d && Number.isInteger(d.name) && d.name >= 0) return { name: d.name }
  } catch { /* nothing saved */ }
  return null
}

function savePet(d) {
  try {
    if (d) localStorage.setItem(KEY, JSON.stringify(d))
    else localStorage.removeItem(KEY)
  } catch { /* not remembered */ }
}

export class PetZombie {
  constructor(survival) {
    this.s = survival
    this.data = loadPet()
    this.pet = null
    this._bite = 0
  }

  get B() {
    return this.s.B
  }

  // The zombie you're looking at, close enough to tame.
  _aimed() {
    const s = this.s
    const bm = s.bm
    const B = this.B
    bm.camera.updateMatrixWorld()
    const ray = new THREE.Ray()
    ray.origin.copy(bm.camera.position)
    ray.direction.set(0, 0, -1).applyQuaternion(bm.camera.quaternion)
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    let best = null
    let bestD = TAME_R * B
    for (const z of s.zombies) {
      const half = s.zombieHalf * (z.size || 1) * 1.3
      box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
      box.max.set((z.x + half) * B, (z.y + s.zombieHeight * (z.size || 1)) * B, (z.z + half) * B)
      if (!ray.intersectBox(box, hit)) continue
      const d = hit.distanceTo(ray.origin)
      if (d < bestD) {
        bestD = d
        best = z
      }
    }
    return best
  }

  // Using a held Brain Snack. -> true if it was eaten (one used up).
  tame() {
    const s = this.s
    if (!s.active || s.dead) return false
    if (this.data) {
      s._message(t('petAlready', { name: zombieName(this.data.name) }), 3)
      return false
    }
    if (s.net && !s.net.isHost) {
      s._message(t('petHostOnly'), 3)
      return false
    }
    const z = this._aimed()
    if (!z) {
      s._message(t('petLookAt', { n: TAME_R }), 3)
      return false
    }
    if (z.boss) {
      s._message(t('petNoBoss'), 3)
      return false
    }
    const at = { x: z.x, y: z.y, z: z.z }
    const name = Number.isInteger(z.nameIdx) ? z.nameIdx : rollZombieName()
    // It leaves the horde (no kill, no coins).
    if (s._toSpawn > 0 && !z.extra) s._toSpawn--
    s._removeZombie(z)
    s.zombies = s.zombies.filter((o) => o !== z)
    s._renderHud?.()
    this.data = { name }
    savePet(this.data)
    this._spawn(at.x, at.y, at.z)
    s._message(t('petTamed', { name: zombieName(name) }), 4)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    return true
  }

  // Lets it go (Settings-free: only the test and a future button use it).
  release() {
    this._despawn()
    this.data = null
    savePet(null)
  }

  _spawn(x, y, z) {
    const s = this.s
    if (this.pet || !this.data || !s._skin) return false
    const B = this.B
    const group = new THREE.Group()
    const body = buildTexturedCharacter(s._skin)
    const sc = (MOB_HEIGHT * B) / 32
    body.scale.setScalar(sc)
    body.position.y = 2 * sc
    group.add(body)
    // The pink bow.
    const pink = new THREE.MeshLambertMaterial({ color: 0xff6fb5 })
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22 * B, 0.16 * B, 0.1 * B), pink)
      m.position.set(side * 0.14 * B, (MOB_HEIGHT + 0.06) * B, 0)
      m.rotation.z = side * 0.35
      group.add(m)
    }
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.08 * B, 0.08 * B, 0.11 * B), pink)
    knot.position.set(0, (MOB_HEIGHT + 0.06) * B, 0)
    group.add(knot)
    group.add(nameTag(t('petTag', { name: zombieName(this.data.name) }), B))
    s.bm.scene.add(group)
    this.pet = { x, y, z, group, body, walk: 0, target: null }
    group.position.set(x * B, y * B, z * B)
    return true
  }

  _despawn() {
    const p = this.pet
    if (!p) return
    p.group.removeFromParent()
    p.group.traverse((o) => {
      if (o.isSprite) {
        o.material.map?.dispose()
        o.material.dispose()
      } else if (o.isMesh && o.parent === p.group) {
        o.geometry.dispose()
      }
    })
    this.pet = null
  }

  update(dt) {
    const s = this.s
    if (!s.active || !this.data) return
    const me = s.bodyPos()
    if (!this.pet) {
      // At the start of a game, once the zombie skin is in.
      this._spawn(me.x + 1.5, me.y, me.z + 1.5)
      if (!this.pet) return
    }
    const p = this.pet
    const B = this.B
    // Far behind (a teleport, a vehicle): it pops up beside you.
    if (Math.hypot(me.x - p.x, me.z - p.z) > FAR || Math.abs(me.y - p.y) > 8) {
      p.x = me.x + 1.5
      p.z = me.z + 1.5
      p.y = me.y
    }
    // A zombie close to it: go and nibble it.
    let foe = null
    let foeD = GUARD_R
    for (const z of s.zombies) {
      if (z.health <= 0) continue
      const d = Math.hypot(z.x - p.x, z.z - p.z)
      if (d < foeD && Math.abs(z.y - p.y) < 2.5) {
        foe = z
        foeD = d
      }
    }
    const goal = foe || me
    const stop = foe ? 1.1 : FOLLOW
    const dx = goal.x - p.x
    const dz = goal.z - p.z
    const d = Math.hypot(dx, dz)
    let moved = 0
    if (d > stop) {
      const step = Math.min(d - stop, SPEED * dt)
      p.x += (dx / d) * step
      p.z += (dz / d) * step
      moved = step
    }
    if (d > 0.01) p.group.rotation.y = Math.atan2(dx, dz)
    const ground = s._groundUnder(p.x, p.y + 2, p.z)
    p.y = Number.isFinite(ground) ? ground : me.y
    this._bite -= dt
    if (foe && foeD < 1.6 && this._bite <= 0 && !(s.net && !s.net.isHost)) {
      this._bite = BITE_S
      s.damageZombie(foe, PET_DAMAGE, { x: dx / (d || 1), z: dz / (d || 1) })
      const lp = p.body.limbPivots
      if (lp) lp.armR.rotation.x = -1.6
    }
    p.walk += moved * 3
    const lp = p.body.limbPivots
    if (lp) {
      const sw = Math.sin(p.walk) * 0.6 * Math.min(1, moved / (SPEED * dt + 1e-6))
      lp.legL.rotation.x = sw
      lp.legR.rotation.x = -sw
      // Arms out in front, like a zombie - a bite swings one down.
      lp.armL.rotation.x = -1.4
      lp.armR.rotation.x = THREE.MathUtils.lerp(lp.armR.rotation.x, -1.4, Math.min(1, dt * 6))
    }
    p.group.position.set(p.x * B, p.y * B, p.z * B)
  }

  // A game ends: it goes, and comes back next game.
  clear() {
    this._despawn()
    this._bite = 0
  }
}
