import * as THREE from 'three'
import { CachedColliderGrid } from './ColliderGrid.js'

const MAX_SPEED = 14
const REVERSE_MAX_SPEED = 6
const ACCEL = 9
const FRICTION_DECEL = 5
const TURN_RATE = 2.2 // rad/sec, scaled by current speed fraction below
const CAR_HALF_W = 0.9
const CAR_HALF_D = 2.0
const CAR_COLLIDER_TOP = 1.4
const CAR_COLLIDER_BOTTOM = 0.1

// Local-space seat/exit offsets, relative to the car's own position+heading.
const DRIVER_SEAT_OFFSET = new THREE.Vector3(-0.35, 1.05, 0.1)
const EXIT_OFFSET = new THREE.Vector3(1.4, 0, 0)

// Simple arcade driving: WASD accelerate/steer, speed-scaled turn rate,
// friction when idle, slide-along-walls collision (same one-axis-at-a-time
// trick as PlayerController._tryMove). The player is invulnerable while
// driving and can't shoot - giving the car its own health/damage model
// would be a whole separate feature on top of this one.
export class Vehicle {
  constructor(scene, x, z, heading = 0) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this.group.rotation.y = heading
    this._buildBody()
    scene.add(this.group)

    this.speed = 0
    this.occupied = false
    // Same fix as PlayerController/ZombieManager (see ColliderGrid.js) -
    // _tryMove used to linear-scan every world collider every frame while
    // driving. Built lazily on first update() call since the colliders
    // array isn't available yet at construction time; the array reference
    // itself never changes for the life of the game, only its contents, so
    // caching it here once is safe.
    this._colliderGrid = null
  }

  _buildBody() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb43a2e, roughness: 0.5, metalness: 0.35 })
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2226, roughness: 0.2, metalness: 0.6 })
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff6d0, emissiveIntensity: 1.2 })

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4), bodyMat)
    body.position.y = 0.55
    body.castShadow = true
    this.group.add(body)

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2), glassMat)
    cabin.position.set(0, 1.05, -0.3)
    cabin.castShadow = true
    this.group.add(cabin)

    this.wheels = []
    for (const [wx, wz] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16), wheelMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(wx, 0.35, wz)
      this.group.add(wheel)
      this.wheels.push(wheel)
    }

    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.06), lightMat)
      headlight.position.set(side * 0.6, 0.55, 2.02)
      this.group.add(headlight)
    }
  }

  distanceTo(x, z) {
    return Math.hypot(this.group.position.x - x, this.group.position.z - z)
  }

  update(dt, input, colliders) {
    if (!this.occupied) return

    if (input.forward) this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt)
    else if (input.back) this.speed = Math.max(-REVERSE_MAX_SPEED, this.speed - ACCEL * dt)
    else if (this.speed > 0) this.speed = Math.max(0, this.speed - FRICTION_DECEL * dt)
    else if (this.speed < 0) this.speed = Math.min(0, this.speed + FRICTION_DECEL * dt)

    if (Math.abs(this.speed) > 0.05) {
      const turnDir = (input.left ? 1 : 0) - (input.right ? 1 : 0)
      const speedFrac = Math.min(1, Math.abs(this.speed) / MAX_SPEED + 0.3)
      this.group.rotation.y += turnDir * TURN_RATE * dt * Math.sign(this.speed) * speedFrac
    }

    for (const wheel of this.wheels) wheel.rotation.x += this.speed * dt * 1.5

    const dx = Math.sin(this.group.rotation.y) * this.speed * dt
    const dz = Math.cos(this.group.rotation.y) * this.speed * dt
    this._tryMove(dx, dz, colliders)
  }

  _tryMove(dx, dz, colliders) {
    if (!this._colliderGrid) this._colliderGrid = new CachedColliderGrid(colliders)
    const fits = (nx, nz) => {
      const box = new THREE.Box3(
        new THREE.Vector3(nx - CAR_HALF_W, CAR_COLLIDER_BOTTOM, nz - CAR_HALF_D),
        new THREE.Vector3(nx + CAR_HALF_W, CAR_COLLIDER_TOP, nz + CAR_HALF_D)
      )
      for (const c of this._colliderGrid.query(nx, nz)) {
        if (box.intersectsBox(c)) return false
      }
      return true
    }

    const x = this.group.position.x
    const z = this.group.position.z

    // If the car's own box already overlaps a collider at its CURRENT spot
    // (e.g. a spawn point that ended up embedded in a wall - this exact bug
    // happened with the old safe-zone spawn before it was relocated), `fits`
    // rejects every direction forever and the car is permanently stuck: it
    // never entered `colliders` overlapping-but-moving-out, it's just stuck
    // failing the "does the destination fit" check in every direction, with
    // no path back to a valid state. Zombie._tryMove already has this same
    // escape hatch (see its own "walk itself free" comment) - mirror it here
    // so a car can always still be steered back out of an overlap instead of
    // freezing for the rest of the run.
    const alreadyStuck = !fits(x, z)

    if (alreadyStuck || fits(x + dx, z)) this.group.position.x += dx
    else this.speed = 0
    if (alreadyStuck || fits(this.group.position.x, z + dz)) this.group.position.z += dz
    else this.speed = 0
  }

  getDriverSeatWorld(target) {
    target.copy(DRIVER_SEAT_OFFSET)
    target.applyQuaternion(this.group.quaternion)
    target.add(this.group.position)
    return target
  }

  getExitWorld(target) {
    target.copy(EXIT_OFFSET)
    target.applyQuaternion(this.group.quaternion)
    target.add(this.group.position)
    return target
  }
}
