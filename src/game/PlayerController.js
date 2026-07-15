import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import { getKeyFor } from './Keybinds.js'

const EYE_HEIGHT = 1.7
const CROUCH_EYE_HEIGHT = 1.05
const EYE_HEIGHT_LERP_SPEED = 10
const RADIUS = 0.4
const MOVE_SPEED = 6
const CROUCH_SPEED_MULT = 0.5
const JUMP_SPEED = 10
const GRAVITY = -18
const SPRINT_MULTIPLIER = 1.6
const STAMINA_MAX = 100
const STAMINA_DRAIN_PER_SEC = 28
const STAMINA_REGEN_PER_SEC = 16
const RAYCAST_ORIGIN_Y = 80

// Browsers occasionally report one wildly wrong mousemove delta right when
// pointer lock is (re)acquired (pause/resume, respawn, alt-tab). No real
// mouse movement produces this much delta in a single frame, so any event
// past this threshold is dropped before PointerLockControls' own handler
// (registered on the bubble phase) ever sees it.
const MAX_MOUSE_DELTA = 250

export class PlayerController {
  constructor(camera, domElement, colliders, groundMeshes) {
    document.addEventListener('mousemove', (e) => {
      if (Math.abs(e.movementX) > MAX_MOUSE_DELTA || Math.abs(e.movementY) > MAX_MOUSE_DELTA) {
        e.stopImmediatePropagation()
      }
    }, { capture: true })

    this.controls = new PointerLockControls(camera, domElement)
    this.colliders = colliders
    this.groundMeshes = groundMeshes || []
    this.camera = camera

    this.velocity = new THREE.Vector3()
    this.input = { forward: false, back: false, left: false, right: false, sprint: false, crouch: false }
    this.onGround = true
    this.groundY = 0
    this.stamina = STAMINA_MAX
    this.maxStamina = STAMINA_MAX
    this.sprintMultiplier = SPRINT_MULTIPLIER
    this.isSprinting = false
    this.isCrouching = false
    this.eyeHeight = EYE_HEIGHT

    this.camera.position.set(0, EYE_HEIGHT, 8)

    this._forward = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._raycaster = new THREE.Raycaster()
    this._rayOrigin = new THREE.Vector3()
    this._rayDir = new THREE.Vector3(0, -1, 0)

    window.addEventListener('keydown', (e) => this._onKey(e, true))
    window.addEventListener('keyup', (e) => this._onKey(e, false))
  }

  // Public wrapper so other systems (e.g. Vehicle exit placement) can
  // ground-check an arbitrary point without reaching into the private
  // raycast helper directly.
  sampleGroundHeight(x, z) {
    return this._sampleGroundHeight(x, z)
  }

  resetPosition() {
    this.controls.object.position.set(0, EYE_HEIGHT, 8)
    this.controls.object.rotation.set(0, 0, 0)
    this.velocity.set(0, 0, 0)
    this.onGround = true
    this.groundY = 0
    this.maxStamina = STAMINA_MAX
    this.stamina = this.maxStamina
    this.sprintMultiplier = SPRINT_MULTIPLIER
    this.isCrouching = false
    this.eyeHeight = EYE_HEIGHT
  }

  // Rebindable primary key per action (see Keybinds.js), each with an
  // always-available fallback (arrows for movement, Ctrl for crouch) so a
  // remap can never lock movement out entirely.
  _onKey(e, isDown) {
    const code = e.code
    if (code === getKeyFor('moveForward') || code === 'ArrowUp') this.input.forward = isDown
    else if (code === getKeyFor('moveBack') || code === 'ArrowDown') this.input.back = isDown
    else if (code === getKeyFor('moveLeft') || code === 'ArrowLeft') this.input.left = isDown
    else if (code === getKeyFor('moveRight') || code === 'ArrowRight') this.input.right = isDown
    else if (code === getKeyFor('sprint')) this.input.sprint = isDown
    else if (code === getKeyFor('crouch') || code === 'ControlLeft' || code === 'ControlRight') this.input.crouch = isDown
    else if (code === 'Space') {
      if (isDown && this.onGround) {
        this.velocity.y = JUMP_SPEED
        this.onGround = false
      }
    }
  }

  // Casts straight down from high above the player's current XZ and returns
  // the height of the nearest surface below (ground, a stair step, a floor
  // slab, a car roof, ...). Falls back to 0 if nothing is found.
  _sampleGroundHeight(x, z) {
    this._rayOrigin.set(x, RAYCAST_ORIGIN_Y, z)
    this._raycaster.set(this._rayOrigin, this._rayDir)
    const hits = this._raycaster.intersectObjects(this.groundMeshes, true)
    return hits.length > 0 ? hits[0].point.y : 0
  }

  update(dt) {
    const obj = this.controls.object

    this._forward.set(0, 0, -1).applyQuaternion(obj.quaternion)
    this._forward.y = 0
    this._forward.normalize()
    this._right.set(1, 0, 0).applyQuaternion(obj.quaternion)
    this._right.y = 0
    this._right.normalize()

    const moveDir = new THREE.Vector3()
    if (this.input.forward) moveDir.add(this._forward)
    if (this.input.back) moveDir.sub(this._forward)
    if (this.input.right) moveDir.add(this._right)
    if (this.input.left) moveDir.sub(this._right)

    const isMoving = moveDir.lengthSq() > 0
    this.isCrouching = this.input.crouch
    this.isSprinting = this.input.sprint && this.stamina > 1 && isMoving && !this.isCrouching

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_PER_SEC * dt)
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN_PER_SEC * dt)
    }

    let speedMultiplier = this.isSprinting ? this.sprintMultiplier : 1
    if (this.isCrouching) speedMultiplier *= CROUCH_SPEED_MULT
    if (isMoving) moveDir.normalize().multiplyScalar(MOVE_SPEED * speedMultiplier * dt)

    this._tryMove(obj, moveDir.x, 0)
    this._tryMove(obj, 0, moveDir.z)

    const targetEyeHeight = this.isCrouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT
    this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, targetEyeHeight, EYE_HEIGHT_LERP_SPEED, dt)

    // Ground height at the (possibly just-moved) XZ position — this is what
    // makes stairs and elevated floors work: the "floor" isn't a constant.
    this.groundY = this._sampleGroundHeight(obj.position.x, obj.position.z)
    const targetEyeY = this.groundY + this.eyeHeight

    this.velocity.y += GRAVITY * dt

    if (this.velocity.y <= 0) {
      const nextY = obj.position.y + this.velocity.y * dt
      if (nextY <= targetEyeY) {
        obj.position.y = targetEyeY
        this.velocity.y = 0
        this.onGround = true
      } else {
        obj.position.y = nextY
        this.onGround = false
      }
    } else {
      obj.position.y += this.velocity.y * dt
      this.onGround = false
    }
  }

  _tryMove(obj, dx, dz) {
    if (dx === 0 && dz === 0) return
    const next = obj.position.clone()
    next.x += dx
    next.z += dz

    const playerBox = new THREE.Box3(
      new THREE.Vector3(next.x - RADIUS, next.y - this.eyeHeight, next.z - RADIUS),
      new THREE.Vector3(next.x + RADIUS, next.y + 0.3, next.z + RADIUS)
    )

    for (const collider of this.colliders) {
      if (playerBox.intersectsBox(collider)) return
    }

    obj.position.x = next.x
    obj.position.z = next.z
  }
}
