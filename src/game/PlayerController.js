import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import { getKeyFor } from './Keybinds.js'
import { CachedColliderGrid, CachedMeshGrid } from './ColliderGrid.js'

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
// Multi-floor structures (skyscraper interiors) stack a walkable slab per
// floor at the same X/Z footprint, only offset in Y. Without a cap here,
// the downward raycast always returns the topmost slab in the column no
// matter which floor you're standing on, so climbing the first flight of
// stairs would snap you straight past the middle floor to the roof, and
// the middle floor's own slab could never be stood on. Capping how far
// above the player's current feet a hit may be still allows stepping up
// stairs/curbs (~0.25-0.3 per step) with room to spare, while rejecting
// surfaces a whole floor (3.9 units) higher.
const MAX_STEP_UP = 0.65

// Dash-dodge: a short speed burst in the current movement direction (or
// straight ahead if not moving) with a brief invincibility window (see
// Game.js's _onZombieAttack, which checks isDodging before applying any
// damage) - the melee-focused answer to "zombies shouldn't be unavoidable."
const DODGE_SPEED = 13
const DODGE_DURATION_MS = 220
const DODGE_COOLDOWN_MS = 1400
const DODGE_STAMINA_COST = 20

// Mantle/vault: a waist-high obstacle (a low wall, a sandbag row, a car
// hood) blocks normal movement outright, but MAX_STEP_UP above only covers
// stair-sized rises (~0.65). Anything taller than that up to roughly chest
// height gets a scripted hop up and over instead of just stopping the
// player dead against it. Below MANTLE_MIN_HEIGHT, the ordinary step-up
// already handles it - this only ever fires for obstacles nothing else
// would let the player cross.
const MANTLE_MIN_HEIGHT = 0.7
const MANTLE_MAX_HEIGHT = 1.4
const MANTLE_PROBE_DIST = 0.8
const MANTLE_LAND_DIST = 0.55
const MANTLE_DURATION_MS = 320
const MANTLE_STAMINA_COST = 15

// Sprint-to-slide: tapping crouch mid-sprint instead of just slowing to
// crouch speed. Same flat-speed-then-stop shape as dodge above, just
// slower/longer and gated on already sprinting rather than any-direction.
const SLIDE_SPEED = 11
const SLIDE_DURATION_MS = 400
const SLIDE_COOLDOWN_MS = 900
const SLIDE_STAMINA_COST = 15

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
    // Performance: _tryMove used to linear-scan every one of the 900+ world
    // colliders, up to 4 times per frame (fits() checks current position
    // AND the attempted new one, called separately for the X and Z move) -
    // on the single JS thread, every single movement input. See
    // ColliderGrid.js - ZombieManager uses the exact same class for the
    // exact same reason.
    this._colliderGrid = new CachedColliderGrid(colliders)
    this.groundMeshes = groundMeshes || []
    // Same performance fix as _colliderGrid above, for the ground/ceiling
    // raycasts below - those used to raycast against the WHOLE groundMeshes
    // array (900+ real meshes, actual triangle-level intersection, not just
    // a box test) unconditionally every single frame regardless of whether
    // the player was even moving. See ColliderGrid.js's CachedMeshGrid.
    this._groundMeshGrid = new CachedMeshGrid(this.groundMeshes)
    this.camera = camera

    this.velocity = new THREE.Vector3()
    // Stage 11's slippery walkway (see Game.js's _updateSlipperyZone) - set
    // externally to >0 while standing on it, 0 everywhere else in the game.
    // Horizontal movement normally snaps straight to the target direction
    // every frame (no persisted momentum at all); _horizVelocity only comes
    // into play when slipFactor > 0, so behavior everywhere else is
    // untouched.
    this.slipFactor = 0
    this._horizVelocity = new THREE.Vector3()
    this.input = { forward: false, back: false, left: false, right: false, sprint: false, crouch: false }
    this.onGround = true
    this.groundY = 0
    this.stamina = STAMINA_MAX
    this.maxStamina = STAMINA_MAX
    this.sprintMultiplier = SPRINT_MULTIPLIER
    this.moveSpeed = MOVE_SPEED
    // Adrenaline shot (see Game.js's _useAdrenaline) - set/cleared externally
    // by a timer there rather than owned here, same pattern as every other
    // timed perk/consumable effect in this game.
    this.adrenalineMult = 1
    // Corpse pile-up (see Game.js's _updateCorpsePileSlow) - recomputed
    // live every frame from nearby recent kills, not a timed effect.
    this.corpsePileMult = 1
    // Webber zombie's web patch (see Game.js's _updateHazardZones) - same
    // "recomputed live every frame" shape as corpsePileMult above.
    this.webSlowMult = 1
    this.isSprinting = false
    this.isCrouching = false
    this.eyeHeight = EYE_HEIGHT
    this.isDodging = false
    this.dodgeUntil = 0
    this.dodgeCooldownUntil = 0
    this.dodgeDir = new THREE.Vector3()

    this.isMantling = false
    this.mantleUntil = 0
    this._mantleStart = new THREE.Vector3()
    this._mantleTarget = new THREE.Vector3()

    this.isSliding = false
    this.slideUntil = 0
    this.slideCooldownUntil = 0
    this.slideDir = new THREE.Vector3()

    this.camera.position.set(0, EYE_HEIGHT, 8)

    this._forward = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._raycaster = new THREE.Raycaster()
    this._rayOrigin = new THREE.Vector3()
    this._rayDir = new THREE.Vector3(0, -1, 0)
    // Separate raycaster for the upward ceiling check (see _tick's jump
    // branch) - kept distinct from the ground-sampling one above so mutating
    // its `far` distance every frame can't bleed into the downward check.
    this._ceilingRaycaster = new THREE.Raycaster()
    this._ceilingRayOrigin = new THREE.Vector3()
    this._upDir = new THREE.Vector3(0, 1, 0)

    window.addEventListener('keydown', (e) => this._onKey(e, true))
    window.addEventListener('keyup', (e) => this._onKey(e, false))
  }

  // Public wrapper so other systems (e.g. Vehicle exit placement) can
  // ground-check an arbitrary point without reaching into the private
  // raycast helper directly. No reference height is available for these
  // one-off queries, so they get the uncapped "topmost surface" behavior -
  // fine for placing something at a known-clear spot, unlike the player's
  // own per-frame footing check below.
  sampleGroundHeight(x, z) {
    return this._sampleGroundHeight(x, z, Infinity)
  }

  // Public wrapper so Game.js's third-person camera collision check can
  // reuse the same narrowed candidate list instead of raycasting against
  // the full groundMeshes array itself.
  queryGroundMeshesNear(x, z) {
    return this._groundMeshGrid.query(x, z)
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
    this.moveSpeed = MOVE_SPEED
    // Adrenaline shot (see Game.js's _useAdrenaline) - set/cleared externally
    // by a timer there rather than owned here, same pattern as every other
    // timed perk/consumable effect in this game.
    this.adrenalineMult = 1
    this.corpsePileMult = 1
    this.webSlowMult = 1
    this.isCrouching = false
    this.eyeHeight = EYE_HEIGHT
    this.isDodging = false
    this.dodgeUntil = 0
    this.dodgeCooldownUntil = 0
    this.isMantling = false
    this.mantleUntil = 0
    this.isSliding = false
    this.slideUntil = 0
    this.slideCooldownUntil = 0
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
    else if (code === getKeyFor('crouch') || code === 'ControlLeft' || code === 'ControlRight') {
      const wasDown = this.input.crouch
      this.input.crouch = isDown
      if (isDown && !wasDown) this._trySlide()
    }
    else if (code === 'Space') {
      if (isDown && !this._tryMantle() && this.onGround) {
        this.velocity.y = JUMP_SPEED
        this.onGround = false
      }
    } else if (code === getKeyFor('dodge')) {
      if (isDown) this._tryDodge()
    }
  }

  _tryDodge() {
    const now = performance.now()
    if (this.isDodging || now < this.dodgeCooldownUntil || this.stamina < DODGE_STAMINA_COST) return

    const dir = new THREE.Vector3()
    if (this.input.forward) dir.add(this._forward)
    if (this.input.back) dir.sub(this._forward)
    if (this.input.right) dir.add(this._right)
    if (this.input.left) dir.sub(this._right)
    if (dir.lengthSq() < 0.0001) dir.copy(this._forward)
    dir.normalize()

    this.dodgeDir.copy(dir)
    this.isDodging = true
    this.dodgeUntil = now + DODGE_DURATION_MS
    this.dodgeCooldownUntil = now + DODGE_COOLDOWN_MS
    this.stamina = Math.max(0, this.stamina - DODGE_STAMINA_COST)
  }

  // Returns true (and starts the mantle) only when there's a real obstacle
  // in the right height band directly ahead AND clear space to land on top
  // of it - a failed probe falls through to a normal jump instead (see the
  // Space key handler), so mantle never eats a jump input on flat ground.
  _tryMantle() {
    if (this.isMantling || this.isDodging || this.isSliding) return false
    if (this.stamina < MANTLE_STAMINA_COST) return false

    const obj = this.controls.object
    const feetY = obj.position.y - this.eyeHeight
    const probeX = obj.position.x + this._forward.x * MANTLE_PROBE_DIST
    const probeZ = obj.position.z + this._forward.z * MANTLE_PROBE_DIST

    let obstacleTop = null
    for (const collider of this._colliderGrid.query(probeX, probeZ)) {
      if (probeX < collider.min.x || probeX > collider.max.x || probeZ < collider.min.z || probeZ > collider.max.z) continue
      // Grounded low wall, not a floating platform overhead - only obstacles
      // starting near the player's own feet read as "climb over this",
      // otherwise a doorway lintel or ceiling would trigger it too.
      if (collider.min.y > feetY + 0.4) continue
      const height = collider.max.y - feetY
      if (height < MANTLE_MIN_HEIGHT || height > MANTLE_MAX_HEIGHT) continue
      if (obstacleTop === null || collider.max.y > obstacleTop) obstacleTop = collider.max.y
    }
    if (obstacleTop === null) return false

    const landX = obj.position.x + this._forward.x * MANTLE_LAND_DIST
    const landZ = obj.position.z + this._forward.z * MANTLE_LAND_DIST
    const landBox = new THREE.Box3(
      new THREE.Vector3(landX - RADIUS, obstacleTop + 0.05, landZ - RADIUS),
      new THREE.Vector3(landX + RADIUS, obstacleTop + 1.6, landZ + RADIUS)
    )
    for (const collider of this._colliderGrid.query(landX, landZ)) {
      if (landBox.intersectsBox(collider)) return false // something's sitting right on the landing spot
    }

    this.stamina = Math.max(0, this.stamina - MANTLE_STAMINA_COST)
    this.isMantling = true
    this.mantleUntil = performance.now() + MANTLE_DURATION_MS
    this._mantleStart.copy(obj.position)
    this._mantleTarget.set(landX, obstacleTop + this.eyeHeight, landZ)
    this.velocity.set(0, 0, 0)
    this.onGround = false
    return true
  }

  // Only triggers off an active sprint (matches the "you were already
  // moving fast" feel this move is for) - crouching from a standing start
  // just crouches normally, same as before this existed.
  _trySlide() {
    const now = performance.now()
    if (this.isSliding || this.isMantling || now < this.slideCooldownUntil) return
    if (!this.isSprinting || this.stamina < SLIDE_STAMINA_COST) return

    const dir = new THREE.Vector3()
    if (this.input.forward) dir.add(this._forward)
    if (this.input.back) dir.sub(this._forward)
    if (this.input.right) dir.add(this._right)
    if (this.input.left) dir.sub(this._right)
    if (dir.lengthSq() < 0.0001) return
    dir.normalize()

    this.slideDir.copy(dir)
    this.isSliding = true
    this.slideUntil = now + SLIDE_DURATION_MS
    this.slideCooldownUntil = now + SLIDE_COOLDOWN_MS
    this.stamina = Math.max(0, this.stamina - SLIDE_STAMINA_COST)
  }

  // Casts straight down from high above the player's current XZ and returns
  // the height of the nearest surface at or below maxY (ground, a stair
  // step, a floor slab, a car roof, ...). Hits are sorted nearest-first
  // (i.e. highest first, since the ray travels downward), so the first one
  // within the maxY cap is the correct standing surface. Falls back to 0 if
  // nothing qualifies.
  _sampleGroundHeight(x, z, maxY) {
    this._rayOrigin.set(x, RAYCAST_ORIGIN_Y, z)
    this._raycaster.set(this._rayOrigin, this._rayDir)
    const hits = this._raycaster.intersectObjects(this._groundMeshGrid.query(x, z), true)
    for (const hit of hits) {
      if (hit.point.y <= maxY) return hit.point.y
    }
    return 0
  }

  update(dt) {
    const obj = this.controls.object

    this._forward.set(0, 0, -1).applyQuaternion(obj.quaternion)
    this._forward.y = 0
    this._forward.normalize()
    this._right.set(1, 0, 0).applyQuaternion(obj.quaternion)
    this._right.y = 0
    this._right.normalize()

    if (this.isMantling) {
      // Scripted lerp straight from start to the landing spot, bypassing
      // gravity/ground-sampling entirely for the brief hop - same reasoning
      // as the dodge's own invincibility window (Game.js's _onZombieAttack
      // checks isDodging the same way a caller could check isMantling, not
      // wired up yet since nothing currently needs it).
      const now = performance.now()
      if (now >= this.mantleUntil) {
        obj.position.copy(this._mantleTarget)
        this.isMantling = false
        this.onGround = true
      } else {
        const frac = 1 - (this.mantleUntil - now) / MANTLE_DURATION_MS
        obj.position.lerpVectors(this._mantleStart, this._mantleTarget, Math.min(1, frac))
      }
      return
    }

    if (this.isDodging && performance.now() >= this.dodgeUntil) this.isDodging = false
    if (this.isSliding && performance.now() >= this.slideUntil) this.isSliding = false

    if (this.isDodging) {
      this.isSprinting = false
      this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN_PER_SEC * dt)
      const dash = DODGE_SPEED * dt
      this._tryMove(obj, this.dodgeDir.x * dash, 0)
      this._tryMove(obj, 0, this.dodgeDir.z * dash)
    } else if (this.isSliding) {
      this.isCrouching = true
      this.isSprinting = false
      const remaining = Math.max(0, this.slideUntil - performance.now())
      const speed = SLIDE_SPEED * (remaining / SLIDE_DURATION_MS)
      const step = speed * dt
      this._tryMove(obj, this.slideDir.x * step, 0)
      this._tryMove(obj, 0, this.slideDir.z * step)
    } else {
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
      speedMultiplier *= this.adrenalineMult
      speedMultiplier *= this.corpsePileMult
      speedMultiplier *= this.webSlowMult

      if (this.slipFactor > 0) {
        // Wet planks over a sewer, not solid ground - momentum carries the
        // player a bit once moving instead of stopping/turning the instant
        // input changes. Higher slipFactor = slower to catch up to the
        // target velocity = more slide.
        const targetVel = isMoving
          ? moveDir.clone().normalize().multiplyScalar(this.moveSpeed * speedMultiplier)
          : new THREE.Vector3()
        const responsiveness = THREE.MathUtils.lerp(14, 2, Math.min(1, this.slipFactor))
        this._horizVelocity.lerp(targetVel, Math.min(1, dt * responsiveness))
        this._tryMove(obj, this._horizVelocity.x * dt, 0)
        this._tryMove(obj, 0, this._horizVelocity.z * dt)
      } else {
        if (isMoving) moveDir.normalize().multiplyScalar(this.moveSpeed * speedMultiplier * dt)
        this._tryMove(obj, moveDir.x, 0)
        this._tryMove(obj, 0, moveDir.z)
        this._horizVelocity.set(0, 0, 0) // no carried momentum once off the slippery zone
      }
    }

    const targetEyeHeight = this.isCrouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT
    this.eyeHeight = THREE.MathUtils.damp(this.eyeHeight, targetEyeHeight, EYE_HEIGHT_LERP_SPEED, dt)

    // Ground height at the (possibly just-moved) XZ position — this is what
    // makes stairs and elevated floors work: the "floor" isn't a constant.
    // Capped to the player's current feet height + one step's worth of rise
    // so a higher floor stacked in the same footprint (see MAX_STEP_UP)
    // can't snap you upward through the floor you're actually standing on.
    const currentFeetY = obj.position.y - this.eyeHeight
    this.groundY = this._sampleGroundHeight(obj.position.x, obj.position.z, currentFeetY + MAX_STEP_UP)
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
      // Ceiling check while ascending (jumping). Floor slabs (skyscraper
      // interiors, tower lookout platforms) are deliberately left out of
      // `colliders` so walking onto them from the side isn't blocked (see
      // World.js's "intentionally not a horizontal collider" comments) -
      // which also means nothing stops a jump from passing straight up
      // through one from underneath without this separate check. Raycasting
      // against `groundMeshes` (the same walkable-surface list used for
      // landing) catches those slabs too, unlike `colliders`.
      const ascend = this.velocity.y * dt
      this._ceilingRayOrigin.set(obj.position.x, obj.position.y + 0.3, obj.position.z)
      this._ceilingRaycaster.set(this._ceilingRayOrigin, this._upDir)
      this._ceilingRaycaster.far = ascend
      const ceilingHits = this._ceilingRaycaster.intersectObjects(this._groundMeshGrid.query(obj.position.x, obj.position.z), true)
      if (ceilingHits.length > 0) {
        obj.position.y = Math.max(obj.position.y, ceilingHits[0].point.y - 0.3)
        this.velocity.y = 0
      } else {
        obj.position.y += ascend
      }
      this.onGround = false
    }
  }

  _tryMove(obj, dx, dz) {
    if (dx === 0 && dz === 0) return

    const fits = (x, z) => {
      const box = new THREE.Box3(
        new THREE.Vector3(x - RADIUS, obj.position.y - this.eyeHeight, z - RADIUS),
        new THREE.Vector3(x + RADIUS, obj.position.y + 0.3, z + RADIUS)
      )
      for (const collider of this._colliderGrid.query(x, z)) {
        if (box.intersectsBox(collider)) return false
      }
      return true
    }

    // Checking only the FINAL position (as this used to do) lets a single
    // frame's movement skip clean through a thin wall without ever
    // overlapping it, if that frame's distance exceeds the wall's own
    // thickness - many walls in this codebase (including the underground
    // junction walls) are only 0.2 units thick, while a lag-spiked frame
    // (this game's fps has documented drops during combat) or a dodge dash
    // (DODGE_SPEED=13, dt capped at 0.1s = up to 1.3 units in one frame)
    // can easily move further than that in a single call. Sub-step any
    // move bigger than a safe fraction of the thinnest wall so no single
    // step can ever jump clean over a collider.
    const dist = Math.hypot(dx, dz)
    const MAX_STEP = 0.15
    const steps = Math.max(1, Math.ceil(dist / MAX_STEP))
    const stepDx = dx / steps
    const stepDz = dz / steps

    for (let i = 0; i < steps; i++) {
      const nx = obj.position.x + stepDx
      const nz = obj.position.z + stepDz
      if (fits(nx, nz)) {
        obj.position.x = nx
        obj.position.z = nz
        continue
      }
      // Blocked. If the player is already overlapping a collider right
      // where they stand (knockback shoving them into geometry, a
      // vehicle-exit point placed against a wall, a spawn point that ends
      // up embedded in something) - as opposed to just walking into solid
      // geometry from a valid position - rejecting every direction would
      // freeze them in place for good, the exact "car spawned inside a
      // wall collider" bug this game hit before, just for the player
      // instead of the vehicle. Zombie._tryMove/Vehicle._tryMove have the
      // same escape hatch.
      //
      // Two earlier versions of this got the direction wrong: one let the
      // escape hatch grant the FULL remaining requested distance whenever
      // "stuck" (let a player merely grazing a wall - easy to do by feel
      // in an unlit corridor - ride a single dodge/sprint's whole distance
      // straight through it); the other capped it to a tiny nudge but
      // still pushed in the player's OWN held direction, which - if that
      // direction happened to be further into the same wall - just made
      // the embed worse one tiny step at a time, still crossing the
      // entire wall given enough consecutive frames of held input.
      //
      // The actual fix: push the player back OUT along whichever
      // overlapping collider's own shortest overlap axis, regardless of
      // which way they're trying to move. This always resolves toward
      // clear space, never deeper into solid geometry, so it can't be
      // "ridden" through a wall no matter how long input is held into it.
      const box = new THREE.Box3(
        new THREE.Vector3(obj.position.x - RADIUS, obj.position.y - this.eyeHeight, obj.position.z - RADIUS),
        new THREE.Vector3(obj.position.x + RADIUS, obj.position.y + 0.3, obj.position.z + RADIUS)
      )
      for (const collider of this._colliderGrid.query(obj.position.x, obj.position.z)) {
        if (!box.intersectsBox(collider)) continue
        const overlapX = Math.min(box.max.x, collider.max.x) - Math.max(box.min.x, collider.min.x)
        const overlapZ = Math.min(box.max.z, collider.max.z) - Math.max(box.min.z, collider.min.z)
        if (overlapX <= 0 || overlapZ <= 0) continue
        if (overlapX < overlapZ) {
          const sign = (box.min.x + box.max.x) / 2 >= (collider.min.x + collider.max.x) / 2 ? 1 : -1
          obj.position.x += sign * (overlapX + 0.005)
        } else {
          const sign = (box.min.z + box.max.z) / 2 >= (collider.min.z + collider.max.z) / 2 ? 1 : -1
          obj.position.z += sign * (overlapZ + 0.005)
        }
        break
      }
      break
    }
  }
}
