// "Try Map" in the Map Editor: walk around the map you're building in first
// person, holding your gun, with gravity and real collision - then press T
// (or the pause screen's button) to go straight back to flying and
// building. Owned by BuildMode (`buildMode.tryMode`); BuildMode.update()
// hands movement over to update() here while it's on, and render() draws
// the gun on top with drawGun().
//
// Sizes are Minecraft's, in blocks: the body is 0.6 wide and 1.8 tall
// (so it fits through a one-block gap and a two-block-tall doorway), eyes
// at 1.62, steps up half a block (slabs) on its own - and a whole block
// onto stairs, so staircases just walk up - and jumps a little over one
// block. Ladders are climbed, water and lava slow you down and let you
// swim up, open doors let you through.
//
// The feel is bloxd.io's (asked for by name): quick, snappy movement that
// starts and stops almost instantly, strong steering in the air, a short
// grace window to still jump just after walking off a ledge, a jump
// pressed a moment before landing still counts, holding Space keeps
// hopping, sprint (Shift, or double-tap W) widens the view a little, and
// almost no head bob.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const HALF_WIDTH = 0.3
const HEIGHT = 1.8
const EYE = 1.62
const WALK = 5.2 // blocks per second
const SPRINT = 7.6 // Shift held, or W double-tapped
const GROUND_GRIP = 26 // how fast speed follows the keys on the ground
const AIR_GRIP = 11 // ...and in the air (bloxd steers well mid-jump)
const GRAVITY = 30
const JUMP = 8.8 // ~1.3 blocks high
const COYOTE = 0.1 // seconds after leaving a ledge you can still jump
const JUMP_BUFFER = 0.15 // a jump pressed this early before landing counts
const STEP_UP = 0.55
const STAIR_STEP = 1.05
const CLIMB = 3.4
const MAX_FALL = 60
const SPRINT_FOV = 8 // degrees added while sprinting
const DOUBLE_TAP_MS = 280
// Same spot on screen the game holds its gun (WeaponSystem's VIEWMODEL_BASE).
const GUN_OFFSET = new THREE.Vector3(0.26, -0.22, -0.5)

export class BuildTryMode {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.active = false
    this.pos = new THREE.Vector3() // feet, in world units
    this.vel = new THREE.Vector3() // blocks per second
    this.onGround = false
    this._bob = 0
    this._recoil = 0
    this._spawn = new THREE.Vector3()
    this._gunScene = null
    this._gunCamera = null
    this._gun = null
    this._gunId = null
    this._coyote = 0
    this._jumpBuffer = 0
    this._spaceWasDown = false
    this._sprintLatched = false
    this._lastWTap = 0
    this._wWasDown = false
    this._baseFov = null
  }

  // --- Collision, in block units ---
  // Every block cell the body's box overlaps, checked against how much of
  // that cell is solid (a slab is the bottom half, most blocks all of it).
  _hits(x, y, z) {
    const x0 = Math.floor(x - HALF_WIDTH + 1e-4)
    const x1 = Math.floor(x + HALF_WIDTH - 1e-4)
    const z0 = Math.floor(z - HALF_WIDTH + 1e-4)
    const z1 = Math.floor(z + HALF_WIDTH - 1e-4)
    const y0 = Math.floor(y + 1e-4)
    const y1 = Math.floor(y + HEIGHT - 1e-4)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = y0; cy <= y1; cy++) {
          const top = this.bm._cellSolidTop(cx, cy, cz)
          if (top > 0 && y < cy + top - 1e-4 && y + HEIGHT > cy + 1e-4) return true
        }
      }
    }
    return false
  }

  _touching(x, y, z, test) {
    const x0 = Math.floor(x - HALF_WIDTH)
    const x1 = Math.floor(x + HALF_WIDTH)
    const z0 = Math.floor(z - HALF_WIDTH)
    const z1 = Math.floor(z + HALF_WIDTH)
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      for (let cy = Math.floor(y); cy <= Math.floor(y + HEIGHT - 0.01); cy++) if (test(cx, cy, cz)) return true
    }
    return false
  }

  // Moves along one axis, stopping flush against whatever's in the way.
  _moveAxis(p, axis, amount) {
    if (!amount) return false
    const tryAt = (d) => {
      const q = { x: p.x, y: p.y, z: p.z }
      q[axis] += d
      return this._hits(q.x, q.y, q.z) ? null : q
    }
    const full = tryAt(amount)
    if (full) {
      p[axis] = full[axis]
      return false
    }
    // Blocked: close the gap in a few halving steps.
    let lo = 0
    let hi = amount
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2
      if (tryAt(mid)) lo = mid
      else hi = mid
    }
    p[axis] += lo
    return true
  }

  enter() {
    const B = this.B
    const cam = this.bm.camera
    // Start where the camera is; if that's inside a block, rise until free.
    const p = { x: cam.position.x / B, y: cam.position.y / B - EYE, z: cam.position.z / B }
    for (let i = 0; i < 200 && this._hits(p.x, p.y, p.z); i++) p.y += 1
    this.pos.set(p.x, p.y, p.z)
    this._spawn.copy(this.pos)
    this.vel.set(0, 0, 0)
    this.onGround = false
    this._coyote = 0
    this._jumpBuffer = 0
    this._sprintLatched = false
    this._baseFov = cam.fov
    this._flyPos = cam.position.clone()
    this.active = true
    this._showGun()
  }

  exit() {
    this.active = false
    if (this._baseFov !== null) {
      this.bm.camera.fov = this._baseFov
      this.bm.camera.updateProjectionMatrix()
      this._baseFov = null
    }
    if (this._gun) this._gun.visible = false
  }

  update(dt, keys) {
    dt = Math.min(dt, 1 / 30)
    const B = this.B
    const p = { x: this.pos.x, y: this.pos.y, z: this.pos.z }
    const cam = this.bm.camera
    const yaw = this.bm._yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    let mx = 0
    let mz = 0
    if (keys.has('KeyW')) { mx += fx; mz += fz }
    if (keys.has('KeyS')) { mx -= fx; mz -= fz }
    if (keys.has('KeyD')) { mx -= fz; mz += fx }
    if (keys.has('KeyA')) { mx += fz; mz -= fx }
    const len = Math.hypot(mx, mz)
    // Sprint: Shift, or a double-tapped W that stays on until W is let go.
    const wDown = keys.has('KeyW')
    if (wDown && !this._wWasDown) {
      const now = performance.now()
      if (now - this._lastWTap < DOUBLE_TAP_MS) this._sprintLatched = true
      this._lastWTap = now
    }
    if (!wDown) this._sprintLatched = false
    this._wWasDown = wDown
    const sprint = (keys.has('ShiftLeft') || keys.has('ShiftRight') || this._sprintLatched) && len > 0
    const inLiquid = this._touching(p.x, p.y, p.z, (x, y, z) => this.bm._cellIsLiquid(x, y, z))
    const onLadder = this._touching(p.x, p.y, p.z, (x, y, z) => this.bm._cellIsLadder(x, y, z))
    let speed = sprint ? SPRINT : WALK
    if (inLiquid) speed *= 0.55
    const want = len ? speed / len : 0
    const grip = this.onGround ? GROUND_GRIP : AIR_GRIP
    this.vel.x = THREE.MathUtils.damp(this.vel.x, mx * want, grip, dt)
    this.vel.z = THREE.MathUtils.damp(this.vel.z, mz * want, grip, dt)

    // Jump timing: coyote time after leaving the ground, a buffered press
    // just before landing, and holding Space hops again on every landing.
    const spaceDown = keys.has('Space')
    if (spaceDown && !this._spaceWasDown) this._jumpBuffer = JUMP_BUFFER
    else if (spaceDown && this.onGround) this._jumpBuffer = Math.max(this._jumpBuffer, dt)
    this._spaceWasDown = spaceDown
    this._coyote = this.onGround ? COYOTE : Math.max(0, this._coyote - dt)
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt)

    if (onLadder) {
      const up = keys.has('KeyW') || spaceDown
      this.vel.y = up ? CLIMB : keys.has('KeyS') ? -CLIMB : -1
    } else if (inLiquid) {
      this.vel.y = spaceDown ? 3.5 : Math.max(this.vel.y - GRAVITY * 0.2 * dt, -2.5)
    } else {
      if (this._jumpBuffer > 0 && this._coyote > 0) {
        this.vel.y = JUMP
        this._jumpBuffer = 0
        this._coyote = 0
        this.onGround = false
      }
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -MAX_FALL)
    }

    // Horizontal moves, stepping up onto a slab (or a stair) on the way.
    const stairs = (x, y, z) => this.bm._cellIsStairs(x, y, z)
    for (const axis of ['x', 'z']) {
      const amount = this.vel[axis] * dt
      if (!amount) continue
      const before = p[axis]
      const blocked = this._moveAxis(p, axis, amount)
      if (blocked && (this.onGround || onLadder)) {
        const ahead = { x: p.x, y: p.y, z: p.z }
        ahead[axis] += Math.sign(amount) * 0.05
        const heights = this._touching(ahead.x, ahead.y, ahead.z, stairs) ? [STEP_UP, STAIR_STEP] : [STEP_UP]
        let didStep = false
        for (const h of heights) {
          const q = { x: p.x, y: p.y + h, z: p.z }
          q[axis] = before
          if (this._hits(q.x, q.y, q.z)) continue
          const stepped = { ...q }
          this._moveAxis(stepped, axis, amount)
          if (Math.abs(stepped[axis] - before) > Math.abs(p[axis] - before) + 1e-3) {
            // Settle back down onto what we stepped up on.
            this._moveAxis(stepped, 'y', -h)
            Object.assign(p, stepped)
            didStep = true
            break
          }
        }
        if (didStep) continue
      }
      if (blocked) this.vel[axis] = 0
    }
    const falling = this.vel.y <= 0
    const hitY = this._moveAxis(p, 'y', this.vel.y * dt)
    this.onGround = hitY && falling
    if (hitY) this.vel.y = 0

    // Never off the map: held inside the 128x128 ground, and anyone who
    // still falls out (dug through the bottom) comes back to where they
    // started.
    p.x = Math.max(-64 + HALF_WIDTH, Math.min(64 - HALF_WIDTH, p.x))
    p.z = Math.max(-64 + HALF_WIDTH, Math.min(64 - HALF_WIDTH, p.z))
    if (p.y < -40) {
      Object.assign(p, { x: this._spawn.x, y: this._spawn.y, z: this._spawn.z })
      this.vel.set(0, 0, 0)
    }
    this.pos.set(p.x, p.y, p.z)

    // Camera at eye height, with only a faint bob while walking, and the
    // view widening a little while sprinting.
    const moving = this.onGround && Math.hypot(this.vel.x, this.vel.z) > 0.5
    this._bob += moving ? dt * (sprint ? 13 : 9) : 0
    const bob = moving ? Math.sin(this._bob) * 0.015 : 0
    cam.position.set(p.x * B, (p.y + EYE + bob) * B, p.z * B)
    if (this._baseFov !== null) {
      const fov = THREE.MathUtils.damp(cam.fov, this._baseFov + (sprint ? SPRINT_FOV : 0), 10, dt)
      if (Math.abs(fov - cam.fov) > 0.01) {
        cam.fov = fov
        cam.updateProjectionMatrix()
      }
    }
    this._recoil = Math.max(0, this._recoil - dt * 6)
    if (this._gun) {
      this._gun.position.set(GUN_OFFSET.x + Math.cos(this._bob * 0.5) * (moving ? 0.008 : 0), GUN_OFFSET.y + Math.abs(Math.sin(this._bob * 0.5)) * (moving ? -0.012 : 0), GUN_OFFSET.z + this._recoil * 0.05)
      this._gun.rotation.x = this._recoil * 0.18
    }
  }

  // Left click while trying: the gun kicks (nothing is placed or broken).
  fire() {
    this._recoil = 1
  }

  // Whether the body overlaps a solid cell right now (BuildMode checks
  // this so a door never swings shut onto the player).
  overlapsSolid() {
    return this._hits(this.pos.x, this.pos.y, this.pos.z)
  }

  // --- The gun, drawn on top of the world in its own little scene, so it
  // never pokes into a wall you're standing against. ---
  _showGun() {
    const weapons = this.bm.game?.weapons
    if (!weapons?.viewmodels) return
    // The first gun in the player's hotbar (not the knife), else the rifle.
    const hotbar = this.bm.game?.settings?.hotbar || []
    const gunIds = hotbar.filter((wid) => wid && weapons.viewmodels[wid] && !/melee|knife|bat|katana|machete/i.test(wid))
    const id = gunIds[0] || (weapons.viewmodels.rifle ? 'rifle' : weapons.current?.id)
    const source = id && weapons.viewmodels[id]
    if (!source) return
    if (!this._gunScene) {
      this._gunScene = new THREE.Scene()
      const pmrem = new THREE.PMREMGenerator(this.bm.renderer)
      this._gunScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      pmrem.dispose()
      this._gunScene.add(new THREE.HemisphereLight(0xffffff, 0x666655, 1.6))
      const key = new THREE.DirectionalLight(0xffffff, 1.8)
      key.position.set(1, 2, 1)
      this._gunScene.add(key)
      this._gunCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10)
    }
    if (this._gunId !== id) {
      if (this._gun) this._gunScene.remove(this._gun)
      // A copy of the game's own gun model (geometry/materials shared).
      const gun = source.clone(true)
      gun.visible = true
      this._gun = new THREE.Group()
      this._gun.add(gun)
      this._gunScene.add(this._gun)
      this._gunId = id
    }
    this._gun.visible = true
  }

  drawGun(renderer) {
    if (!this.active || !this._gun?.visible) return
    const cam = this.bm.camera
    this._gunCamera.aspect = cam.aspect
    this._gunCamera.fov = 70
    this._gunCamera.updateProjectionMatrix()
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(this._gunScene, this._gunCamera)
    renderer.autoClear = autoClear
  }
}
