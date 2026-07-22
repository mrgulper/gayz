import * as THREE from 'three'
import { flatMaterial } from './QualitySettings.js'

const BLADE_RADIUS = 1.7
const BLADE_BASE_DAMAGE = 6
const BLADE_HIT_RADIUS = 0.9
const BLADE_HIT_COOLDOWN_MS = 500
const BLADE_SPIN_SPEED = 2.6
const MAX_BLADES = 3

const HOMING_BASE_INTERVAL = 2.4
const HOMING_MIN_INTERVAL = 1.0
const HOMING_INTERVAL_STEP = 0.4
const HOMING_BASE_DAMAGE = 12
const HOMING_DAMAGE_STEP = 4
const HOMING_RANGE = 16
const HOMING_HIT_RADIUS = 0.6
const HOMING_SPEED = 14

const AURA_BASE_RADIUS = 2.2
const AURA_RADIUS_STEP = 0.4
const AURA_MAX_RADIUS = 3.8
const AURA_BASE_DAMAGE = 4
const AURA_DAMAGE_STEP = 2
const AURA_TICK_COOLDOWN_MS = 400

const CHAIN_BASE_INTERVAL = 3.0
const CHAIN_MIN_INTERVAL = 1.4
const CHAIN_INTERVAL_STEP = 0.5
const CHAIN_BASE_DAMAGE = 10
const CHAIN_DAMAGE_STEP = 4
const CHAIN_RANGE = 14
const CHAIN_HOP_RANGE = 6
const CHAIN_MAX_HOPS = 3
const CHAIN_LINE_MS = 200

// Evolution buffs (see evolveBlade/evolveHoming) - unlocked once a weapon
// is fully leveled AND the player also holds a specific passive perk,
// mirroring the "maxed weapon + matching passive" evolution hook from
// Vampire-Survivors-style games.
const BLADE_EVOLVED_DAMAGE_MULT = 1.8
const BLADE_EVOLVED_RADIUS_MULT = 1.3
const BLADE_EVOLVED_SPIN_MULT = 1.5

const bladeGeo = new THREE.OctahedronGeometry(0.28, 0)
const bladeMat = flatMaterial({
  color: 0x555555,
  emissive: 0x66d9ff,
  emissiveIntensity: 1.4,
  metalness: 0.6,
  roughness: 0.3,
})
const bladeMatEvolved = flatMaterial({
  color: 0x551a1a,
  emissive: 0xff3b3b,
  emissiveIntensity: 1.8,
  metalness: 0.6,
  roughness: 0.3,
})

const shotGeo = new THREE.SphereGeometry(0.12, 10, 10)
const shotMat = flatMaterial({
  color: 0x1c0a0a,
  emissive: 0xff5c5c,
  emissiveIntensity: 1.8,
})
const shotMatEvolved = flatMaterial({
  color: 0x0a1c1a,
  emissive: 0x5cffe0,
  emissiveIntensity: 2.2,
})

const auraGeo = new THREE.RingGeometry(0.05, 1, 32)
const auraMat = new THREE.MeshBasicMaterial({
  color: 0x8b2fe0,
  transparent: true,
  opacity: 0.28,
  side: THREE.DoubleSide,
})

const chainLineMat = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9 })

// Auto-attacking weapons unlocked through XP level-up choices (see
// getAutoWeaponUpgrades below and XpUpgrades.js's rollXpUpgrades) - these
// fight on their own every frame with no aiming from the player, unlike
// WeaponSystem.js's manually fired guns.
export class AutoWeaponManager {
  constructor(scene) {
    this.scene = scene

    this.bladeMeshes = []
    this.bladeDamage = BLADE_BASE_DAMAGE
    this.bladeAngle = 0
    this.bladeEvolved = false
    this.bladeRadius = BLADE_RADIUS
    this.bladeSpinSpeed = BLADE_SPIN_SPEED
    this._bladeHitAt = new Map()

    this.homingUnlocked = false
    this.homingInterval = HOMING_BASE_INTERVAL
    this.homingDamage = HOMING_BASE_DAMAGE
    this.homingEvolved = false
    this._homingTimer = 0
    this.shots = []

    this.auraUnlocked = false
    this.auraRadius = AURA_BASE_RADIUS
    this.auraDamage = AURA_BASE_DAMAGE
    this.auraMesh = null
    this._auraHitAt = new Map()

    this.chainUnlocked = false
    this.chainInterval = CHAIN_BASE_INTERVAL
    this.chainDamage = CHAIN_BASE_DAMAGE
    this._chainTimer = 0
    this.chainLines = []
  }

  get bladeCount() {
    return this.bladeMeshes.length
  }

  unlockBlade() {
    this._addBladeMesh()
  }

  addBlade() {
    this._addBladeMesh()
  }

  increaseBladeDamage(amount) {
    this.bladeDamage += amount
  }

  evolveBlade() {
    if (this.bladeEvolved) return
    this.bladeEvolved = true
    this.bladeDamage *= BLADE_EVOLVED_DAMAGE_MULT
    this.bladeRadius *= BLADE_EVOLVED_RADIUS_MULT
    this.bladeSpinSpeed *= BLADE_EVOLVED_SPIN_MULT
    for (const mesh of this.bladeMeshes) mesh.material = bladeMatEvolved
  }

  _addBladeMesh() {
    if (this.bladeMeshes.length >= MAX_BLADES) return
    const mesh = new THREE.Mesh(bladeGeo, this.bladeEvolved ? bladeMatEvolved : bladeMat)
    this.scene.add(mesh)
    this.bladeMeshes.push(mesh)
  }

  unlockHoming() {
    this.homingUnlocked = true
  }

  decreaseHomingInterval(amount) {
    this.homingInterval = Math.max(HOMING_MIN_INTERVAL, this.homingInterval - amount)
  }

  increaseHomingDamage(amount) {
    this.homingDamage += amount
  }

  // Evolved Homing Shot fires a second projectile at the next-nearest
  // zombie instead of just hitting harder - see _updateHoming's fire step.
  evolveHoming() {
    this.homingEvolved = true
  }

  unlockAura() {
    if (this.auraMesh) return
    this.auraUnlocked = true
    this.auraMesh = new THREE.Mesh(auraGeo, auraMat)
    this.auraMesh.rotation.x = -Math.PI / 2
    this.auraMesh.position.y = 0.05
    this.auraMesh.scale.setScalar(this.auraRadius)
    this.scene.add(this.auraMesh)
  }

  increaseAuraRadius(amount) {
    this.auraRadius = Math.min(AURA_MAX_RADIUS, this.auraRadius + amount)
  }

  increaseAuraDamage(amount) {
    this.auraDamage += amount
  }

  unlockChain() {
    this.chainUnlocked = true
  }

  decreaseChainInterval(amount) {
    this.chainInterval = Math.max(CHAIN_MIN_INTERVAL, this.chainInterval - amount)
  }

  increaseChainDamage(amount) {
    this.chainDamage += amount
  }

  update(dt, playerPos, zombies, onHit) {
    this._updateBlades(dt, playerPos, zombies, onHit)
    this._updateHoming(dt, playerPos, zombies, onHit)
    this._updateAura(dt, playerPos, zombies, onHit)
    this._updateChain(dt, playerPos, zombies, onHit)
  }

  _updateBlades(dt, playerPos, zombies, onHit) {
    if (this.bladeMeshes.length === 0) return
    this.bladeAngle += dt * this.bladeSpinSpeed
    const now = performance.now()
    for (let i = 0; i < this.bladeMeshes.length; i++) {
      const angle = this.bladeAngle + (i / this.bladeMeshes.length) * Math.PI * 2
      const mesh = this.bladeMeshes[i]
      mesh.position.set(
        playerPos.x + Math.cos(angle) * this.bladeRadius,
        0.9,
        playerPos.z + Math.sin(angle) * this.bladeRadius
      )
      mesh.rotation.y += dt * 6
      mesh.rotation.x += dt * 4

      for (const zombie of zombies) {
        if (zombie.state !== 'alive') continue
        const lastHit = this._bladeHitAt.get(zombie) || 0
        if (now - lastHit < BLADE_HIT_COOLDOWN_MS) continue
        const dist = Math.hypot(zombie.group.position.x - mesh.position.x, zombie.group.position.z - mesh.position.z)
        if (dist <= BLADE_HIT_RADIUS) {
          this._bladeHitAt.set(zombie, now)
          zombie.lastHitWeaponId = 'orbiting_blade'
          zombie.onHit(this.bladeDamage)
          if (onHit) onHit()
        }
      }
    }
  }

  _updateHoming(dt, playerPos, zombies, onHit) {
    if (this.homingUnlocked) {
      this._homingTimer -= dt
      if (this._homingTimer <= 0) {
        const target = this._findNearestZombie(playerPos, zombies)
        this._homingTimer = this.homingInterval
        if (target) {
          this._fireShot(playerPos, target)
          if (this.homingEvolved) {
            const second = this._findNearestZombie(playerPos, zombies.filter((z) => z !== target))
            if (second) this._fireShot(playerPos, second)
          }
        }
      }
    }

    for (const shot of this.shots) {
      if (shot.target.state !== 'alive') {
        shot.target = this._findNearestZombie(shot.mesh.position, zombies)
      }
      if (!shot.target) {
        shot.expired = true
        continue
      }
      const dx = shot.target.group.position.x - shot.mesh.position.x
      const dz = shot.target.group.position.z - shot.mesh.position.z
      const dist = Math.hypot(dx, dz)
      if (dist <= HOMING_HIT_RADIUS) {
        shot.target.lastHitWeaponId = 'homing_shot'
        shot.target.onHit(this.homingDamage)
        if (onHit) onHit()
        shot.expired = true
        continue
      }
      shot.mesh.position.x += (dx / dist) * HOMING_SPEED * dt
      shot.mesh.position.z += (dz / dist) * HOMING_SPEED * dt
      shot.mesh.rotation.y += dt * 10
    }

    for (const shot of this.shots) {
      if (shot.expired) this.scene.remove(shot.mesh)
    }
    this.shots = this.shots.filter((s) => !s.expired)
  }

  // Passive always-on zone (unlike blade/homing, needs no fire timer) -
  // any alive zombie standing inside auraRadius takes auraDamage on a
  // per-zombie cooldown, same shape as the blade's per-zombie hit cooldown.
  _updateAura(dt, playerPos, zombies, onHit) {
    if (!this.auraMesh) return
    this.auraMesh.position.x = playerPos.x
    this.auraMesh.position.z = playerPos.z
    this.auraMesh.scale.setScalar(this.auraRadius)
    this.auraMesh.rotation.z += dt * 0.4

    const now = performance.now()
    for (const zombie of zombies) {
      if (zombie.state !== 'alive') continue
      const lastHit = this._auraHitAt.get(zombie) || 0
      if (now - lastHit < AURA_TICK_COOLDOWN_MS) continue
      const dist = Math.hypot(zombie.group.position.x - playerPos.x, zombie.group.position.z - playerPos.z)
      if (dist <= this.auraRadius) {
        this._auraHitAt.set(zombie, now)
        zombie.lastHitWeaponId = 'damage_aura'
        zombie.onHit(this.auraDamage)
        if (onHit) onHit()
      }
    }
  }

  // Fires a jolt at the nearest zombie, then arcs to the nearest zombie to
  // *that* one (not the player) up to CHAIN_MAX_HOPS times - each hop draws
  // a short-lived line segment between the two points it just jumped.
  _updateChain(dt, playerPos, zombies, onHit) {
    if (this.chainUnlocked) {
      this._chainTimer -= dt
      if (this._chainTimer <= 0) {
        this._chainTimer = this.chainInterval
        this._fireChain(playerPos, zombies, onHit)
      }
    }

    const now = performance.now()
    for (const entry of this.chainLines) {
      if (now >= entry.expiresAt) {
        this.scene.remove(entry.line)
        entry.line.geometry.dispose()
      }
    }
    this.chainLines = this.chainLines.filter((entry) => now < entry.expiresAt)
  }

  _fireChain(playerPos, zombies, onHit) {
    const hit = new Set()
    let fromPos = playerPos
    let hopRange = CHAIN_RANGE
    for (let hop = 0; hop < CHAIN_MAX_HOPS; hop++) {
      let target = null
      let targetDist = hopRange
      for (const z of zombies) {
        if (z.state !== 'alive' || hit.has(z)) continue
        const d = Math.hypot(z.group.position.x - fromPos.x, z.group.position.z - fromPos.z)
        if (d < targetDist) {
          target = z
          targetDist = d
        }
      }
      if (!target) break

      hit.add(target)
      target.lastHitWeaponId = 'lightning_chain'
      target.onHit(this.chainDamage)
      if (onHit) onHit()
      this._spawnChainLine(fromPos, target.group.position)

      fromPos = target.group.position
      hopRange = CHAIN_HOP_RANGE
    }
  }

  _spawnChainLine(fromPos, toPos) {
    const points = [
      new THREE.Vector3(fromPos.x, 1.1, fromPos.z),
      new THREE.Vector3(toPos.x, 1.1, toPos.z),
    ]
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.Line(geo, chainLineMat)
    this.scene.add(line)
    this.chainLines.push({ line, expiresAt: performance.now() + CHAIN_LINE_MS })
  }

  _findNearestZombie(fromPos, zombies) {
    let nearest = null
    let nearestDist = HOMING_RANGE
    for (const z of zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - fromPos.x, z.group.position.z - fromPos.z)
      if (d < nearestDist) {
        nearest = z
        nearestDist = d
      }
    }
    return nearest
  }

  _fireShot(playerPos, target) {
    const mesh = new THREE.Mesh(shotGeo, this.homingEvolved ? shotMatEvolved : shotMat)
    mesh.position.set(playerPos.x, 1.1, playerPos.z)
    this.scene.add(mesh)
    this.shots.push({ mesh, target })
  }

  reset() {
    for (const mesh of this.bladeMeshes) this.scene.remove(mesh)
    this.bladeMeshes = []
    this.bladeDamage = BLADE_BASE_DAMAGE
    this.bladeEvolved = false
    this.bladeRadius = BLADE_RADIUS
    this.bladeSpinSpeed = BLADE_SPIN_SPEED
    this._bladeHitAt.clear()

    for (const shot of this.shots) this.scene.remove(shot.mesh)
    this.shots = []
    this.homingUnlocked = false
    this.homingInterval = HOMING_BASE_INTERVAL
    this.homingDamage = HOMING_BASE_DAMAGE
    this.homingEvolved = false
    this._homingTimer = 0

    if (this.auraMesh) this.scene.remove(this.auraMesh)
    this.auraUnlocked = false
    this.auraRadius = AURA_BASE_RADIUS
    this.auraDamage = AURA_BASE_DAMAGE
    this.auraMesh = null
    this._auraHitAt.clear()

    for (const entry of this.chainLines) {
      this.scene.remove(entry.line)
      entry.line.geometry.dispose()
    }
    this.chainLines = []
    this.chainUnlocked = false
    this.chainInterval = CHAIN_BASE_INTERVAL
    this.chainDamage = CHAIN_BASE_DAMAGE
    this._chainTimer = 0
  }
}

// Upgrade choices these weapons contribute to the XP level-up pool (see
// XpUpgrades.js's rollXpUpgrades). Only the relevant entry is offered at
// any time: the unlock entry disappears once unlocked, the "+" entry
// disappears once maxed out. Once maxed, if the player also holds the
// matching passive perk (tracked in game.xpPicked - see Game.js's
// _renderXpLevelupOptions), a one-time "Evolve" choice takes priority over
// the plain damage-boost entry; after evolving, damage-boost resumes for
// further stacking.
export function getAutoWeaponUpgrades(autoWeapons, xpPicked) {
  const defs = []

  if (autoWeapons.bladeCount === 0) {
    defs.push({
      id: 'auto_blade_unlock',
      titleKey: 'xpUpgradeBladeUnlock',
      apply: (game) => game.autoWeapons.unlockBlade(),
    })
  } else if (autoWeapons.bladeCount < MAX_BLADES) {
    defs.push({
      id: 'auto_blade_plus',
      titleKey: 'xpUpgradeBladePlus',
      apply: (game) => game.autoWeapons.addBlade(),
    })
  } else if (!autoWeapons.bladeEvolved && xpPicked.has('xp_damage')) {
    defs.push({
      id: 'auto_blade_evolve',
      titleKey: 'xpUpgradeBladeEvolve',
      apply: (game) => game.autoWeapons.evolveBlade(),
    })
  } else {
    defs.push({
      id: 'auto_blade_damage',
      titleKey: 'xpUpgradeBladeDamage',
      apply: (game) => game.autoWeapons.increaseBladeDamage(3),
    })
  }

  if (!autoWeapons.homingUnlocked) {
    defs.push({
      id: 'auto_homing_unlock',
      titleKey: 'xpUpgradeHomingUnlock',
      apply: (game) => game.autoWeapons.unlockHoming(),
    })
  } else if (autoWeapons.homingInterval > HOMING_MIN_INTERVAL) {
    defs.push({
      id: 'auto_homing_plus',
      titleKey: 'xpUpgradeHomingPlus',
      apply: (game) => game.autoWeapons.decreaseHomingInterval(HOMING_INTERVAL_STEP),
    })
  } else if (!autoWeapons.homingEvolved && xpPicked.has('xp_max_health')) {
    defs.push({
      id: 'auto_homing_evolve',
      titleKey: 'xpUpgradeHomingEvolve',
      apply: (game) => game.autoWeapons.evolveHoming(),
    })
  } else {
    defs.push({
      id: 'auto_homing_damage',
      titleKey: 'xpUpgradeHomingDamage',
      apply: (game) => game.autoWeapons.increaseHomingDamage(HOMING_DAMAGE_STEP),
    })
  }

  if (!autoWeapons.auraUnlocked) {
    defs.push({
      id: 'auto_aura_unlock',
      titleKey: 'xpUpgradeAuraUnlock',
      apply: (game) => game.autoWeapons.unlockAura(),
    })
  } else if (autoWeapons.auraRadius < AURA_MAX_RADIUS) {
    defs.push({
      id: 'auto_aura_plus',
      titleKey: 'xpUpgradeAuraPlus',
      apply: (game) => game.autoWeapons.increaseAuraRadius(AURA_RADIUS_STEP),
    })
  } else {
    defs.push({
      id: 'auto_aura_damage',
      titleKey: 'xpUpgradeAuraDamage',
      apply: (game) => game.autoWeapons.increaseAuraDamage(AURA_DAMAGE_STEP),
    })
  }

  if (!autoWeapons.chainUnlocked) {
    defs.push({
      id: 'auto_chain_unlock',
      titleKey: 'xpUpgradeChainUnlock',
      apply: (game) => game.autoWeapons.unlockChain(),
    })
  } else if (autoWeapons.chainInterval > CHAIN_MIN_INTERVAL) {
    defs.push({
      id: 'auto_chain_plus',
      titleKey: 'xpUpgradeChainPlus',
      apply: (game) => game.autoWeapons.decreaseChainInterval(CHAIN_INTERVAL_STEP),
    })
  } else {
    defs.push({
      id: 'auto_chain_damage',
      titleKey: 'xpUpgradeChainDamage',
      apply: (game) => game.autoWeapons.increaseChainDamage(CHAIN_DAMAGE_STEP),
    })
  }

  return defs
}
