import * as THREE from 'three'
import { Zombie } from './Zombie.js'
import { pickZombieType, ZOMBIE_TYPES } from './ZombieTypes.js'
import { audioEngine } from './Audio.js'

const BASE_SPAWN_COUNT = 9
const MAX_SPAWN_COUNT = 18
const SPAWN_RADIUS_MIN = 20
const SPAWN_RADIUS_MAX = 44
const AMBUSH_RADIUS_MIN = 7
const AMBUSH_RADIUS_MAX = 26
const BASE_AMBUSH_CHANCE = 0.55
const MAX_AMBUSH_CHANCE = 0.85
const BASE_RESPAWN_DELAY = 8
const MIN_RESPAWN_DELAY = 3
const REMOVE_AFTER_DEATH_MS = 3000
const PROJECTILE_HIT_RADIUS = 1.7
const MOAN_RADIUS = 26
const MOAN_MIN_DELAY_MS = 4500
const MOAN_MAX_DELAY_MS = 9500
const NOISEMAKER_THROW_SPEED = 14
const NOISEMAKER_DISTRACTION_MS = 9000
const GRENADE_THROW_SPEED = 16
const GRENADE_DAMAGE_RADIUS = 5
const GRENADE_DAMAGE_MIN = 80
const GRENADE_DAMAGE_MAX = 220
const ELITE_CHANCE = 0.08

const projectileMat = new THREE.MeshStandardMaterial({
  color: 0x2f4a12,
  emissive: 0x9fe23f,
  emissiveIntensity: 1.8,
})

const noisemakerMat = new THREE.MeshStandardMaterial({
  color: 0x8a8478,
  emissive: 0xd8cfa0,
  emissiveIntensity: 0.4,
  roughness: 0.5,
  metalness: 0.4,
})

const grenadeMat = new THREE.MeshStandardMaterial({
  color: 0x3a4a2e,
  roughness: 0.6,
  metalness: 0.3,
})

const EXPLOSION_FX_MS = 350
const SCREAM_FX_MS = 450

export class ZombieManager {
  constructor(scene, spawnRateMult = 1, colliders = [], solidMeshes = []) {
    this.scene = scene
    // World collision/raycast geometry, the same lists PlayerController
    // uses - so zombies stop clipping through buildings/cars/tunnel walls,
    // and can't melee through a wall/floor they have no line of sight
    // through (see Zombie.js's _tryMove/_hasLineOfSight).
    this.colliders = colliders
    this.solidMeshes = solidMeshes
    this.zombies = []
    this.projectiles = []
    this.explosionFx = []
    this.screamFx = []
    this.noisemakerThrows = []
    this.grenadeThrows = []
    this.distraction = null
    this.elapsed = 0
    this.pendingRespawns = []

    this.spawnRateMult = spawnRateMult
    this.currentNight = 1
    this.bossSpawnedForNight = 0
    this.targetCount = Math.round(BASE_SPAWN_COUNT * this.spawnRateMult)
    this.respawnDelay = BASE_RESPAWN_DELAY
    this.ambushChance = BASE_AMBUSH_CHANCE
    this.nextMoanAt = performance.now() + this._randomMoanDelay()

    for (let i = 0; i < this.targetCount; i++) {
      this._spawnRandom()
    }
  }

  _randomMoanDelay() {
    return MOAN_MIN_DELAY_MS + Math.random() * (MOAN_MAX_DELAY_MS - MOAN_MIN_DELAY_MS)
  }

  // Scales spawn count / respawn speed / ambush frequency up with night number.
  applyDifficulty(night) {
    this.currentNight = night
    this.targetCount = Math.round(Math.min(MAX_SPAWN_COUNT, BASE_SPAWN_COUNT + (night - 1)) * this.spawnRateMult)
    this.respawnDelay = Math.max(MIN_RESPAWN_DELAY, BASE_RESPAWN_DELAY - (night - 1) * 0.5)
    this.ambushChance = Math.min(MAX_AMBUSH_CHANCE, BASE_AMBUSH_CHANCE + (night - 1) * 0.03)

    while (this.zombies.length < this.targetCount) {
      this._spawnRandom()
    }

    if (night % 5 === 0 && this.bossSpawnedForNight !== night) {
      this.bossSpawnedForNight = night
      this._spawnBoss()
    }
  }

  // Bosses walk in from max spawn range rather than ambushing, and never
  // enter the normal weighted pool - see colossus's weight: 0 in ZombieTypes.
  _spawnBoss() {
    const angle = Math.random() * Math.PI * 2
    const x = Math.sin(angle) * SPAWN_RADIUS_MAX
    const z = Math.cos(angle) * SPAWN_RADIUS_MAX

    // Alternates every boss night: 5=colossus, 10=patient_zero, 15=colossus...
    const bossType = (this.currentNight / 5) % 2 === 0 ? ZOMBIE_TYPES.patient_zero : ZOMBIE_TYPES.colossus
    const zombie = new Zombie(x, z, bossType, false)
    zombie.deathHandled = false
    zombie.isBoss = true
    this.zombies.push(zombie)
    this.scene.add(zombie.group)
  }

  // One-off guardian spawn at a specific spot (the VIREO facility terminal
  // fight) rather than the normal random-radius boss walk-in - returns the
  // zombie instance so the caller can watch its state for "is it dead yet".
  spawnGuardian(x, z, typeConfig) {
    const zombie = new Zombie(x, z, typeConfig, false)
    zombie.deathHandled = false
    zombie.isBoss = true
    this.zombies.push(zombie)
    this.scene.add(zombie.group)
    return zombie
  }

  // Live-updates the Easy/Normal/Hard spawn-rate multiplier without
  // reconstructing the manager, re-applying it against the current night.
  setDifficultyMultiplier(mult) {
    this.spawnRateMult = mult
    this.applyDifficulty(this.currentNight)
  }

  reset() {
    for (const zombie of this.zombies) this.scene.remove(zombie.group)
    for (const p of this.projectiles) this.scene.remove(p.mesh)
    for (const fx of this.explosionFx) this.scene.remove(fx.mesh)
    for (const fx of this.screamFx) this.scene.remove(fx.mesh)
    for (const n of this.noisemakerThrows) this.scene.remove(n.mesh)
    for (const g of this.grenadeThrows) this.scene.remove(g.mesh)
    this.zombies = []
    this.projectiles = []
    this.explosionFx = []
    this.screamFx = []
    this.noisemakerThrows = []
    this.grenadeThrows = []
    this.distraction = null
    this.pendingRespawns = []
    this.currentNight = 1
    this.bossSpawnedForNight = 0
    this.targetCount = Math.round(BASE_SPAWN_COUNT * this.spawnRateMult)
    this.respawnDelay = BASE_RESPAWN_DELAY
    this.ambushChance = BASE_AMBUSH_CHANCE
    this.nextMoanAt = performance.now() + this._randomMoanDelay()
    for (let i = 0; i < this.targetCount; i++) this._spawnRandom()
  }

  _spawnRandom() {
    const type = pickZombieType()
    const isAmbush = !type.ranged && Math.random() < this.ambushChance

    const radiusMin = isAmbush ? AMBUSH_RADIUS_MIN : SPAWN_RADIUS_MIN
    const radiusMax = isAmbush ? AMBUSH_RADIUS_MAX : SPAWN_RADIUS_MAX
    const angle = Math.random() * Math.PI * 2
    const radius = radiusMin + Math.random() * (radiusMax - radiusMin)
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius

    const isElite = Math.random() < ELITE_CHANCE
    const zombie = new Zombie(x, z, type, isAmbush, isElite)
    zombie.deathHandled = false
    this.zombies.push(zombie)
    this.scene.add(zombie.group)
  }

  // Immediate burst of extra ambush-biased zombies, for the "Horde Surge"
  // random night event - a one-off punch rather than a sustained rate change.
  spawnSurge(count) {
    for (let i = 0; i < count; i++) this._spawnRandom()
  }

  // Shared explosion-damage logic - used by both thrown grenades and shot
  // explosive world props (parked cars, see WeaponSystem._fire).
  explodeAt(x, z, radius, damageMin, damageMax) {
    this._spawnExplosionFX(x, z)
    for (const zombie of this.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - x, zombie.group.position.z - z)
      if (dist > radius) continue
      const falloff = 1 - dist / radius
      zombie.onHit(damageMin + (damageMax - damageMin) * falloff)
    }
  }

  get hittableMeshes() {
    return this.zombies
      .filter((z) => z.state === 'alive')
      .flatMap((z) => z.hittableMeshes)
  }

  _spawnProjectile(origin, targetSnapshot, damage, travelSpeed) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), projectileMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(targetSnapshot)
    const travelTime = Math.max(0.15, distance / travelSpeed)

    this.projectiles.push({ mesh, origin, target: targetSnapshot, damage, travelTime, t: 0 })
  }

  // Player-thrown decoy: arcs to the target point, then plays a loud sound
  // and marks that spot as a distraction zombies will investigate instead
  // of the player (see the targeting override in update() below).
  spawnNoisemakerThrow(origin, target) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10), noisemakerMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(target)
    const travelTime = Math.max(0.2, distance / NOISEMAKER_THROW_SPEED)

    this.noisemakerThrows.push({ mesh, origin: origin.clone(), target: target.clone(), travelTime, t: 0 })
  }

  _updateNoisemakerThrows(dt) {
    this.noisemakerThrows = this.noisemakerThrows.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        this.distraction = { x: p.target.x, z: p.target.z, expiresAt: performance.now() + NOISEMAKER_DISTRACTION_MS }
        audioEngine.playNoisemaker()
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 1.2
      p.mesh.rotation.x += dt * 12
      return true
    })
  }

  // Player-thrown frag grenade: arcs to the target point, then explodes -
  // reuses the same explosion FX/sound as the Bloater zombie's detonation,
  // dealing falloff damage to every zombie within range. No player
  // self-damage for now, even at point-blank.
  spawnGrenadeThrow(origin, target) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), grenadeMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(target)
    const travelTime = Math.max(0.25, distance / GRENADE_THROW_SPEED)

    this.grenadeThrows.push({ mesh, origin: origin.clone(), target: target.clone(), travelTime, t: 0 })
  }

  _updateGrenadeThrows(dt) {
    this.grenadeThrows = this.grenadeThrows.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        this._spawnExplosionFX(p.target.x, p.target.z)
        for (const zombie of this.zombies) {
          if (zombie.state !== 'alive') continue
          const dist = Math.hypot(zombie.group.position.x - p.target.x, zombie.group.position.z - p.target.z)
          if (dist > GRENADE_DAMAGE_RADIUS) continue
          const falloff = 1 - dist / GRENADE_DAMAGE_RADIUS
          zombie.onHit(GRENADE_DAMAGE_MIN + (GRENADE_DAMAGE_MAX - GRENADE_DAMAGE_MIN) * falloff)
        }
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 1.6
      return true
    })
  }

  _spawnExplosionFX(x, z) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffcc66,
      emissive: 0xffaa33,
      emissiveIntensity: 3,
      transparent: true,
      opacity: 1,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), mat)
    mesh.position.set(x, 1.1, z)
    this.scene.add(mesh)
    this.explosionFx.push({ mesh, startedAt: performance.now() })
    audioEngine.playExplosion()
  }

  _updateExplosionFx() {
    this.explosionFx = this.explosionFx.filter((fx) => {
      const progress = Math.min(1, (performance.now() - fx.startedAt) / EXPLOSION_FX_MS)
      const scale = 1 + progress * 14
      fx.mesh.scale.setScalar(scale)
      fx.mesh.material.opacity = 1 - progress
      if (progress >= 1) {
        this.scene.remove(fx.mesh)
        return false
      }
      return true
    })
  }

  // A screamer's scream: instantly wakes every dormant (ambush) zombie in
  // radius and speeds up every alive zombie in radius for a few seconds.
  _onZombieScream(x, z, radius, enrageMs) {
    audioEngine.playAmbushShriek()
    this._spawnScreamFX(x, z)
    for (const zombie of this.zombies) {
      const dist = Math.hypot(zombie.group.position.x - x, zombie.group.position.z - z)
      if (dist > radius) continue
      if (zombie.state === 'dormant') zombie.forceWake()
      else if (zombie.state === 'alive') zombie.enrage(enrageMs)
    }
  }

  _spawnScreamFX(x, z) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb060e0,
      emissive: 0xb060e0,
      emissiveIntensity: 2.5,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.4, 24), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.15, z)
    this.scene.add(mesh)
    this.screamFx.push({ mesh, startedAt: performance.now() })
  }

  _updateScreamFx() {
    this.screamFx = this.screamFx.filter((fx) => {
      const progress = Math.min(1, (performance.now() - fx.startedAt) / SCREAM_FX_MS)
      const scale = 1 + progress * 18
      fx.mesh.scale.setScalar(scale)
      fx.mesh.material.opacity = 0.8 * (1 - progress)
      if (progress >= 1) {
        this.scene.remove(fx.mesh)
        return false
      }
      return true
    })
  }

  _updateAmbientMoan(playerPos) {
    if (performance.now() < this.nextMoanAt) return

    const nearby = this.zombies.some((z) => {
      if (z.state !== 'alive' && z.state !== 'dormant') return false
      const dist = Math.hypot(playerPos.x - z.group.position.x, playerPos.z - z.group.position.z)
      return dist <= MOAN_RADIUS
    })

    if (nearby) audioEngine.playZombieMoan()
    this.nextMoanAt = performance.now() + this._randomMoanDelay()
  }

  _updateProjectiles(dt, playerPos, onPlayerDamage) {
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        const dist = Math.hypot(playerPos.x - p.target.x, playerPos.z - p.target.z)
        if (dist <= PROJECTILE_HIT_RADIUS && onPlayerDamage) onPlayerDamage(p.damage)
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 0.6
      return true
    })
  }

  update(dt, playerPos, onPlayerDamage, onZombieLoot, onAmbushTrigger, onZombieKilled, playerCrouching = false) {
    this.elapsed += dt

    const distractionActive = this.distraction && performance.now() < this.distraction.expiresAt
    if (this.distraction && !distractionActive) this.distraction = null

    for (const zombie of this.zombies) {
      let targetPos = playerPos
      let attackCb = onPlayerDamage
      let spitCb = (origin, target, damage, speed) => this._spawnProjectile(origin, target, damage, speed)

      // While a decoy is active, any zombie closer to it than to the real
      // player chases the noise instead - and can't actually deal damage
      // while doing so, since it isn't engaging the player at all.
      if (distractionActive && zombie.state === 'alive') {
        const distToPlayer = Math.hypot(playerPos.x - zombie.group.position.x, playerPos.z - zombie.group.position.z)
        const distToDecoy = Math.hypot(this.distraction.x - zombie.group.position.x, this.distraction.z - zombie.group.position.z)
        if (distToDecoy < distToPlayer) {
          targetPos = this.distraction
          attackCb = null
          spitCb = null
        }
      }

      zombie.update(
        dt,
        this.elapsed,
        targetPos,
        attackCb,
        spitCb,
        onAmbushTrigger,
        (x, z) => this._spawnExplosionFX(x, z),
        playerCrouching,
        (x, z, radius, enrageMs) => this._onZombieScream(x, z, radius, enrageMs),
        this.colliders,
        this.solidMeshes,
        this.zombies
      )

      if (zombie.state === 'dead' && !zombie.deathHandled) {
        zombie.deathHandled = true
        this.pendingRespawns.push({ at: performance.now() + REMOVE_AFTER_DEATH_MS + this.respawnDelay * 1000 })

        if (!zombie.config.explodes) audioEngine.playZombieDeath()
        if (onZombieKilled) onZombieKilled(zombie.config.id, zombie.lastHitWeaponId, zombie.group.position.x, zombie.group.position.z, zombie.isElite)
        // Regular kills no longer roll a random loot chance here - see
        // Game.js's _onZombieKilled for the guaranteed every-10th-kill drop.
        // Bosses still always drop on top of that.
        if (onZombieLoot && zombie.isBoss) {
          onZombieLoot(zombie.group.position.x, zombie.group.position.z)
        }

        // screamer_swarmer-style hybrids (see ZombieTypes.js) release a
        // small burst of a weaker type on death instead of just dying quietly.
        if (zombie.config.summonOnDeath) {
          const summonType = ZOMBIE_TYPES[zombie.config.summonType]
          if (summonType) {
            for (let i = 0; i < zombie.config.summonOnDeath; i++) {
              const angle = Math.random() * Math.PI * 2
              const r = 1.5 + Math.random() * 1.5
              const sx = zombie.group.position.x + Math.sin(angle) * r
              const sz = zombie.group.position.z + Math.cos(angle) * r
              const summoned = new Zombie(sx, sz, summonType, false)
              summoned.deathHandled = false
              this.zombies.push(summoned)
              this.scene.add(summoned.group)
            }
          }
        }

        setTimeout(() => {
          this.scene.remove(zombie.group)
          this.zombies = this.zombies.filter((z) => z !== zombie)
        }, REMOVE_AFTER_DEATH_MS)
      }
    }

    this._updateProjectiles(dt, playerPos, onPlayerDamage)
    this._updateExplosionFx()
    this._updateScreamFx()
    this._updateAmbientMoan(playerPos)
    this._updateNoisemakerThrows(dt)
    this._updateGrenadeThrows(dt)

    this.pendingRespawns = this.pendingRespawns.filter((r) => {
      if (performance.now() < r.at) return true
      if (this.zombies.length < this.targetCount) this._spawnRandom()
      return false
    })
  }
}
