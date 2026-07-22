import * as THREE from 'three'
import { flatMaterial } from './QualitySettings.js'

const PICKUP_RADIUS = 1.6
const EXPIRE_MS = 20000

const gemMat = flatMaterial({
  color: 0x1c3a4a,
  emissive: 0x4fd1e8,
  emissiveIntensity: 1.6,
})
const gemGeo = new THREE.OctahedronGeometry(0.14, 0)

class XpGem {
  constructor(x, z, value) {
    this.value = value
    this.spawnedAt = performance.now()
    this.phase = Math.random() * Math.PI * 2
    this.mesh = new THREE.Mesh(gemGeo, gemMat)
    this.mesh.position.set(x, 0.5, z)
  }

  update(dt, elapsed) {
    this.mesh.rotation.y += dt * 3
    this.mesh.rotation.x += dt * 1.6
    this.mesh.position.y = 0.5 + Math.sin(elapsed * 2.5 + this.phase) * 0.08
  }
}

// Every zombie kill drops one of these (see Game.js's _onZombieKilled) -
// distinct from PickupManager's kill-drop items (ammo/health/etc, every
// 10th kill): gems are the continuous XP-gem leveling economy, dropped on
// every single kill, small and immediately meaningful rather than a rare
// item drop.
export class XpGemManager {
  constructor(scene) {
    this.scene = scene
    this.gems = []
  }

  spawn(x, z, value = 1) {
    const gem = new XpGem(x, z, value)
    this.gems.push(gem)
    this.scene.add(gem.mesh)
  }

  update(dt, elapsed, playerPos, onCollect) {
    for (const gem of this.gems) gem.update(dt, elapsed)

    this.gems = this.gems.filter((gem) => {
      const dist = Math.hypot(playerPos.x - gem.mesh.position.x, playerPos.z - gem.mesh.position.z)
      if (dist <= PICKUP_RADIUS) {
        this.scene.remove(gem.mesh)
        onCollect(gem.value)
        return false
      }
      if (performance.now() - gem.spawnedAt > EXPIRE_MS) {
        this.scene.remove(gem.mesh)
        return false
      }
      return true
    })
  }

  reset() {
    for (const gem of this.gems) this.scene.remove(gem.mesh)
    this.gems = []
  }
}
