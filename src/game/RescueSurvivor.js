import * as THREE from 'three'

// A trapped NPC that occasionally appears (see NightEvents.js's
// 'survivor_found' event) - walk up and press interact to rescue them for a
// reward. Purely a stationary interactable, not a companion/combatant.
export class RescueSurvivor {
  constructor(scene, x, z) {
    this.scene = scene
    this.x = x
    this.z = z
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this._build()
    scene.add(this.group)
  }

  _build() {
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x6b6255, roughness: 0.9 })
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a077, roughness: 0.9 })
    const signalMat = new THREE.MeshStandardMaterial({ color: 0x1a1a10, emissive: 0xffcf5c, emissiveIntensity: 1.2 })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.26), clothMat)
    torso.position.y = 0.55
    torso.rotation.x = 0.3
    torso.castShadow = true
    this.group.add(torso)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skinMat)
    head.position.set(0, 0.85, 0.08)
    head.castShadow = true
    this.group.add(head)

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.18), clothMat)
      leg.position.set(side * 0.1, 0.2, 0.15)
      leg.rotation.x = -0.9
      leg.castShadow = true
      this.group.add(leg)
    }

    const signal = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), signalMat)
    signal.position.set(0, 1.1, 0)
    this.group.add(signal)
    this.signalMat = signalMat
  }

  update(elapsed) {
    this.signalMat.emissiveIntensity = 0.8 + Math.sin(elapsed * 3) * 0.4
  }

  dispose() {
    this.scene.remove(this.group)
  }
}
