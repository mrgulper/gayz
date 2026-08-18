import * as THREE from 'three'
import { flatMaterial } from './QualitySettings.js'

// A deployable support fixture (see Inventory.js's medStationKits /
// Game.js's _deployMedStation) - the existing Turret Kit is purely
// offensive (shoots the nearest zombie); this is the support-archetype
// counterpart, healing the player and any nearby companions on a tick
// instead of dealing damage. Same "static mount, no health/downed state"
// shape as Turret.js.
const RANGE = 6
const HEAL_INTERVAL_S = 1
const HEAL_PER_TICK = 6

export class MedStation {
  constructor(scene, x, z) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)

    const baseMat = flatMaterial({ color: 0xe8e4d8, roughness: 0.6, metalness: 0.1 })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 8), baseMat)
    base.position.y = 0.25
    base.castShadow = true
    this.group.add(base)

    // A simple red cross on top - reads as "medical" at a glance from any
    // angle without needing a dedicated texture.
    const crossMat = flatMaterial({ color: 0xd6402f, emissive: 0xd6402f, emissiveIntensity: 0.4 })
    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.1), crossMat)
    barH.position.y = 0.56
    this.group.add(barH)
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.36), crossMat)
    barV.position.y = 0.56
    this.group.add(barV)

    // Green pulsing indicator, same "own material clone, never shared"
    // convention as every other blinking-light prop (see Turret.js) - just
    // green instead of red, to read as "healing" rather than "hostile."
    this.indicatorMat = flatMaterial({ color: 0x0a1a0a, emissive: 0x6fe08a, emissiveIntensity: 0.9 })
    const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), this.indicatorMat)
    indicator.position.set(0, 0.72, 0)
    this.group.add(indicator)

    this.light = new THREE.PointLight(0x6fe08a, 0.8, RANGE + 2)
    this.light.position.y = 0.6
    this.group.add(this.light)

    scene.add(this.group)
    this.nextHealAt = 0
    this._flashUntil = 0
  }

  // playerHeal(amount) and companions (array of {x, z, heal(amount)} -
  // Companion instances already expose both) are passed in rather than
  // reached for directly, same "caller owns the real objects" convention
  // Turret.update(zombies) already uses.
  update(playerPos, playerHeal, companions) {
    if (this._flashUntil && performance.now() >= this._flashUntil) {
      this.indicatorMat.emissiveIntensity = 0.9
      this._flashUntil = 0
    }
    if (performance.now() < this.nextHealAt) return

    let healedAnything = false
    const distToPlayer = Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z)
    if (distToPlayer <= RANGE) {
      playerHeal(HEAL_PER_TICK)
      healedAnything = true
    }
    if (companions) {
      for (const c of companions) {
        if (c.downed || c.dead) continue
        const d = Math.hypot(c.group.position.x - this.group.position.x, c.group.position.z - this.group.position.z)
        if (d <= RANGE && c.health < c.maxHealth) {
          c.health = Math.min(c.maxHealth, c.health + HEAL_PER_TICK)
          healedAnything = true
        }
      }
    }

    if (healedAnything) {
      this.nextHealAt = performance.now() + HEAL_INTERVAL_S * 1000
      this.indicatorMat.emissiveIntensity = 2.2
      this._flashUntil = performance.now() + 150
    }
  }

  dispose() {
    this.scene.remove(this.group)
  }
}
