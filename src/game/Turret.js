import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { flatMaterial } from './QualitySettings.js'

// A permanent, purchasable base-defense fixture (see CoinShop.js's 'turret'
// item) - distinct from Companion's invulnerable safe-zone guards (a
// stationary NPC), this is a genuine placed prop: a static mount that
// rotates to track and fire at the nearest alive zombie in range, no
// movement, no health/downed state, nothing for a zombie to damage.
const RANGE = 14
const FIRE_INTERVAL_S = 0.9
const DAMAGE_MIN = 20
const DAMAGE_MAX = 32

export class Turret {
  constructor(scene, x, z) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)

    const baseMat = flatMaterial({ color: 0x3a3a38, roughness: 0.7, metalness: 0.5 })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 8), baseMat)
    base.position.y = 0.25
    base.castShadow = true
    this.group.add(base)

    // Only the head rotates to track a target - the base mount stays fixed.
    this.head = new THREE.Group()
    this.head.position.y = 0.6
    this.group.add(this.head)

    const bodyMat = flatMaterial({ color: 0x4a4a46, roughness: 0.5, metalness: 0.6 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), bodyMat)
    body.castShadow = true
    this.head.add(body)

    const barrelMat = flatMaterial({ color: 0x232320, roughness: 0.4, metalness: 0.7 })
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8), barrelMat)
    barrel.rotation.x = Math.PI / 2
    barrel.position.z = 0.5
    this.head.add(barrel)

    // Red idle / bright flash-on-fire indicator, same "own material clone,
    // never shared" reasoning as every other blinking-light prop in this
    // codebase (practice targets, locked-door indicators, etc.).
    this.indicatorMat = flatMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })
    const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), this.indicatorMat)
    indicator.position.set(0, 0.2, 0.2)
    this.head.add(indicator)

    scene.add(this.group)
    this.nextFireAt = 0
    this._flashUntil = 0
  }

  // No dt needed - fire timing is real-timestamp-based (performance.now())
  // like every other cooldown in this class, not delta-accumulated.
  update(zombies) {
    if (this._flashUntil && performance.now() >= this._flashUntil) {
      this.indicatorMat.emissiveIntensity = 0.9
      this._flashUntil = 0
    }

    let nearest = null
    let nearestDist = RANGE
    for (const z of zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - this.group.position.x, z.group.position.z - this.group.position.z)
      if (d < nearestDist) {
        nearest = z
        nearestDist = d
      }
    }

    if (!nearest) return

    const dx = nearest.group.position.x - this.group.position.x
    const dz = nearest.group.position.z - this.group.position.z
    this.head.rotation.y = Math.atan2(dx, dz)

    if (performance.now() >= this.nextFireAt) {
      this.nextFireAt = performance.now() + FIRE_INTERVAL_S * 1000
      const damage = DAMAGE_MIN + Math.random() * (DAMAGE_MAX - DAMAGE_MIN)
      nearest.onHit(damage)
      this.indicatorMat.emissiveIntensity = 2.2
      this._flashUntil = performance.now() + 80
      audioEngine.playShot('pistol')
    }
  }

  dispose() {
    this.scene.remove(this.group)
  }
}
