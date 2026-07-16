import * as THREE from 'three'

// Simple visible body for third-person view - the player has no body mesh
// at all in first person (only WeaponSystem's viewmodel hands+gun), so one
// is needed purely for the external third-person camera to look at. Static
// pose (no walk-cycle animation) to keep this a reasonably small addition -
// same "acceptable for a follower NPC" bar as Companion.js, which is also
// unanimated.
export class PlayerBody {
  constructor(scene) {
    this.group = new THREE.Group()
    this._buildBody()
    this.group.visible = false
    scene.add(this.group)
  }

  _buildBody() {
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.85 })
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8ab7d, roughness: 0.9 })
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x24241f, roughness: 0.9 })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.26), jacketMat)
    torso.position.y = 1.15
    torso.castShadow = true
    this.group.add(torso)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), skinMat)
    head.position.y = 1.6
    head.castShadow = true
    this.group.add(head)

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.19), pantsMat)
      leg.position.set(side * 0.12, 0.5, 0)
      leg.castShadow = true
      this.group.add(leg)

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.15), jacketMat)
      arm.position.set(side * 0.3, 1.15, 0)
      arm.castShadow = true
      this.group.add(arm)
    }
  }

  // yaw is the horizontal look direction only - pitch is deliberately never
  // applied here so the body stays upright while aiming up/down.
  update(feetX, feetY, feetZ, yaw, visible) {
    this.group.visible = visible
    if (!visible) return
    this.group.position.set(feetX, feetY, feetZ)
    this.group.rotation.y = yaw
  }
}
