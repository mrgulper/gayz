// "Try Map" in the Map Editor: walk around the map you're building in first
// person, holding your gun, with gravity and real collision - then press T
// (or the pause screen's button) to go straight back to flying and
// building. Owned by BuildMode (`buildMode.tryMode`); BuildMode.update()
// hands movement over to update() here while it's on, and render() draws
// the gun on top with drawGun().
//
// Sizes are Minecraft's, in blocks: the body is 0.6 wide and 1.8 tall
// (so it fits through a one-block gap and a two-block-tall doorway), eyes
// at 1.62, steps up half a block (slabs) on its own, and jumps a little
// over one block. Ladders are climbed, water and lava slow you down and
// let you swim up, open doors let you through.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const HALF_WIDTH = 0.3
const HEIGHT = 1.8
const EYE = 1.62
const WALK = 4.3 // blocks per second
const SPRINT = 6.6 // with Shift held
const GRAVITY = 32
const JUMP = 9
const STEP_UP = 0.55
const CLIMB = 3
const MAX_FALL = 60
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
    this._flyPos = cam.position.clone()
    this.active = true
    this._showGun()
  }

  exit() {
    this.active = false
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
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight')
    const inLiquid = this._touching(p.x, p.y, p.z, (x, y, z) => this.bm._cellIsLiquid(x, y, z))
    const onLadder = this._touching(p.x, p.y, p.z, (x, y, z) => this.bm._cellIsLadder(x, y, z))
    let speed = sprint ? SPRINT : WALK
    if (inLiquid) speed *= 0.55
    const want = len ? speed / len : 0
    // Quick to start and stop on the ground, floatier in the air.
    const grip = this.onGround ? 18 : 5
    this.vel.x = THREE.MathUtils.damp(this.vel.x, mx * want, grip, dt)
    this.vel.z = THREE.MathUtils.damp(this.vel.z, mz * want, grip, dt)

    if (onLadder) {
      const up = keys.has('KeyW') || keys.has('Space')
      this.vel.y = up ? CLIMB : keys.has('KeyS') ? -CLIMB : -1
    } else if (inLiquid) {
      this.vel.y = keys.has('Space') ? 3.5 : Math.max(this.vel.y - GRAVITY * 0.2 * dt, -2.5)
    } else {
      if (keys.has('Space') && this.onGround) this.vel.y = JUMP
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -MAX_FALL)
    }

    // Horizontal moves, stepping up onto a slab or half-block on the way.
    for (const axis of ['x', 'z']) {
      const amount = this.vel[axis] * dt
      if (!amount) continue
      const before = p[axis]
      const blocked = this._moveAxis(p, axis, amount)
      if (blocked && this.onGround) {
        const q = { x: p.x, y: p.y + STEP_UP, z: p.z }
        q[axis] = before
        if (!this._hits(q.x, q.y, q.z)) {
          const stepped = { ...q }
          this._moveAxis(stepped, axis, amount)
          if (Math.abs(stepped[axis] - before) > Math.abs(p[axis] - before) + 1e-3) {
            // Settle back down onto what we stepped up on.
            this._moveAxis(stepped, 'y', -STEP_UP)
            Object.assign(p, stepped)
            continue
          }
        }
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

    // Camera at eye height, with a little head bob while walking.
    const moving = this.onGround && Math.hypot(this.vel.x, this.vel.z) > 0.5
    this._bob += moving ? dt * (sprint ? 13 : 9) : 0
    const bob = moving ? Math.sin(this._bob) * 0.04 : 0
    cam.position.set(p.x * B, (p.y + EYE + bob) * B, p.z * B)
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
