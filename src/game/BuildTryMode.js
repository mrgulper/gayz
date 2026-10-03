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
// The feel is bloxd.io's (asked for by name, then "exactly like" it):
// its own speeds - walk 4 blocks/s, run 7 (Shift + W), crouch 2 (C, Ctrl,
// Z or Caps Lock; crouching also keeps you from walking off an edge) -
// and its bunny hop: jump again right as you land and each hop in a row
// is faster (+15%, +22.5%, +30%), lost as soon as you stay on the ground.
// Movement starts and stops almost instantly, steers well in the air, a
// short grace window still lets you jump just after walking off a ledge,
// a jump pressed a moment before landing still counts, holding Space keeps
// hopping (and counts as a bunny hop), running widens the view a little,
// and there's almost no head bob.
//
// Shooting a window (any glass block) cracks it; the second shot breaks
// it and later shots fly through the hole. Broken windows come back when
// you stop trying the map and are never saved.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { audioEngine } from './Audio.js'

const HALF_WIDTH = 0.3
const HEIGHT = 1.8
const EYE = 1.62
const CROUCH_HEIGHT = 1.5
const CROUCH_EYE = 1.27
const WALK = 4 // blocks per second (bloxd.io's)
const SPRINT = 7 // Shift + W
const CROUCH = 2
// Bunny hop: a fresh jump within this long of landing keeps the chain
// going; each link speeds you up (bloxd.io's numbers).
const BHOP_WINDOW = 0.12
const BHOP_MULT = [1, 1.15, 1.225, 1.3]
const CROUCH_KEYS = ['KeyC', 'ControlLeft', 'ControlRight', 'KeyZ', 'CapsLock']
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
// Kirka-style blocky arms holding the gun, made from the player's own
// skin: each runs from a shoulder off the bottom of the screen to its hand
// spot on the gun (_findHandSpots; positions relative to GUN_OFFSET).
// ARM_PX is the size of one skin pixel across the arm (made wider
// 2026-10-03 - "looks too skinny").
const ARM_SHOULDERS = {
  armR: [0.16, -0.53, 0.4],
  armL: [-0.46, -0.58, 0.25],
}
const ARM_PX = 0.036
// Building, like Minecraft: just the held block in the bottom-right corner,
// no arm (camera space).
const HAND_BLOCK_POS = [0.33, -0.29, -0.6]
const HAND_BLOCK_SIZE = 0.2
const SWING_TIME = 0.25 // seconds
// Map sizes M cycles through (Try Map's own minimap, top-right square):
// normal, big, big in the middle of the screen.
const MAP_SIZES = ['normal', 'big', 'center']
const NEAR = 0.012 // camera near plane while trying (world units; a block is 0.35)
// Glass shards flying out of a broken window.
const SHARDS_PER_WINDOW = 14
const SHARD_LIFE = 1.4
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
    this._groundTime = 0
    this._hopChain = 0
    this._landedFromJump = false
    this._jumpedAt = false
    this._crouch = false
    this._height = HEIGHT
    this._eye = EYE
    this._baseFov = null
    this._arms = null
    this._armsUrl = null
    this._mapMode = 0
    this._mapEl = null
    this._mapCanvas = null
    this._mapImage = null
    this._mapDrawAt = 0
    this._cracked = new Map() // cell key -> { x, y, z }
    this._broken = new Map() // cell key -> { x, y, z, type }
    this._crackMesh = null
    this._crackMaterial = null
    this._shards = []
    this._shardGeometry = null
    this._shardMaterials = new Map()
    this._underwater = null
    this._underwaterEl = null
    this._baseNear = null
  }

  // --- Minimap (top-right square; M makes it big, then big in the middle) ---
  _ensureMapEl() {
    if (this._mapEl) return
    this._mapEl = document.createElement('div')
    this._mapEl.id = 'build-try-map'
    this._mapEl.style.display = 'none'
    this._mapCanvas = document.createElement('canvas')
    this._mapEl.appendChild(this._mapCanvas)
    document.body.appendChild(this._mapEl)
    window.addEventListener('resize', () => { if (this.active) this._applyMapMode() })
  }

  cycleMap() {
    this._mapMode = (this._mapMode + 1) % MAP_SIZES.length
    this._applyMapMode()
  }

  _applyMapMode() {
    if (!this._mapEl) return
    this._mapEl.dataset.size = MAP_SIZES[this._mapMode]
    // Drawn at the size it's shown, so the blocks stay crisp.
    const px = Math.max(1, Math.round(this._mapEl.clientWidth * Math.min(window.devicePixelRatio || 1, 2)))
    this._mapCanvas.width = px
    this._mapCanvas.height = px
    this._mapDrawAt = 0
  }

  _drawMap(now) {
    if (!this._mapImage || now - this._mapDrawAt < 60) return
    this._mapDrawAt = now
    const c = this._mapCanvas
    const ctx = c.getContext('2d')
    const s = c.width
    const cells = this._mapImage.width
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this._mapImage, 0, 0, s, s)
    // Where you are, and which way you're looking.
    const k = s / cells
    const px = (this.pos.x + cells / 2) * k
    const pz = (this.pos.z + cells / 2) * k
    const yaw = this.bm._yaw
    const ang = Math.atan2(-Math.cos(yaw), -Math.sin(yaw))
    const r = Math.max(5, s / 34)
    ctx.save()
    ctx.translate(px, pz)
    ctx.rotate(ang)
    ctx.beginPath()
    ctx.moveTo(r * 1.4, 0)
    ctx.lineTo(-r, r * 0.85)
    ctx.lineTo(-r * 0.45, 0)
    ctx.lineTo(-r, -r * 0.85)
    ctx.closePath()
    ctx.fillStyle = '#ffde5c'
    ctx.strokeStyle = '#1a1408'
    ctx.lineWidth = Math.max(1.5, r / 4)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  // --- Collision, in block units ---
  // Every block cell the body's box overlaps, checked against how much of
  // that cell is solid (a slab is the bottom half, most blocks all of it).
  _hits(x, y, z, height = this._height) {
    const x0 = Math.floor(x - HALF_WIDTH + 1e-4)
    const x1 = Math.floor(x + HALF_WIDTH - 1e-4)
    const z0 = Math.floor(z - HALF_WIDTH + 1e-4)
    const z1 = Math.floor(z + HALF_WIDTH - 1e-4)
    const y0 = Math.floor(y + 1e-4)
    const y1 = Math.floor(y + height - 1e-4)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = y0; cy <= y1; cy++) {
          const top = this.bm._cellSolidTop(cx, cy, cz)
          if (top > 0 && y < cy + top - 1e-4 && y + height > cy + 1e-4) return true
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
      for (let cy = Math.floor(y); cy <= Math.floor(y + this._height - 0.01); cy++) if (test(cx, cy, cz)) return true
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
    this._crouch = false
    this._height = HEIGHT
    this._eye = EYE
    const p = { x: cam.position.x / B, y: cam.position.y / B - EYE, z: cam.position.z / B }
    for (let i = 0; i < 200 && this._hits(p.x, p.y, p.z); i++) p.y += 1
    this.pos.set(p.x, p.y, p.z)
    this._spawn.copy(this.pos)
    this.vel.set(0, 0, 0)
    this.onGround = false
    this._coyote = 0
    this._jumpBuffer = 0
    this._hopChain = 0
    this._groundTime = 0
    this._baseFov = cam.fov
    // The flying camera's near plane (0.1) is a third of a block: walking
    // right up to a wall let the view cut into it and see through. The
    // body keeps the eyes 0.3 blocks from any wall, so a much nearer plane
    // never clips.
    this._baseNear = cam.near
    cam.near = NEAR
    cam.updateProjectionMatrix()
    this._flyPos = cam.position.clone()
    this.active = true
    this._showGun()
    this._ensureMapEl()
    this._mapImage = this.bm._buildTopDownMap()
    this._mapEl.style.display = 'block'
    this._applyMapMode()
  }

  exit() {
    this.active = false
    this._restoreWindows()
    if (this._mapEl) this._mapEl.style.display = 'none'
    if (this._baseFov !== null) {
      this.bm.camera.fov = this._baseFov
      this._baseFov = null
    }
    if (this._baseNear != null) {
      this.bm.camera.near = this._baseNear
      this._baseNear = null
    }
    this.bm.camera.updateProjectionMatrix()
    this._setUnderwater(null)
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
    // Crouch while a crouch key is held - standing back up waits until
    // there's room overhead.
    const crouchHeld = CROUCH_KEYS.some((k) => keys.has(k))
    if (crouchHeld !== this._crouch && (crouchHeld || !this._hits(p.x, p.y, p.z, HEIGHT))) {
      this._crouch = crouchHeld
      this._height = crouchHeld ? CROUCH_HEIGHT : HEIGHT
    }
    const crouch = this._crouch
    // Run: Shift while walking forward (bloxd.io's Shift + W).
    const sprint = !crouch && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && keys.has('KeyW') && !keys.has('KeyS')
    const inLiquid = this._touching(p.x, p.y, p.z, (x, y, z) => this.bm._cellIsLiquid(x, y, z))
    const onLadder = this._touching(p.x, p.y, p.z, (x, y, z) => this.bm._cellIsLadder(x, y, z))
    // Staying on the ground past the hop window ends a bunny-hop chain.
    if (this.onGround) {
      this._groundTime += dt
      if (this._groundTime > BHOP_WINDOW) this._hopChain = 0
    }
    let speed = crouch ? CROUCH : sprint ? SPRINT : WALK
    speed *= BHOP_MULT[this._hopChain]
    if (inLiquid) speed *= 0.55
    const want = len ? speed / len : 0
    const grip = this.onGround ? GROUND_GRIP : AIR_GRIP
    this.vel.x = THREE.MathUtils.damp(this.vel.x, mx * want, grip, dt)
    this.vel.z = THREE.MathUtils.damp(this.vel.z, mz * want, grip, dt)

    // Jump timing: coyote time after leaving the ground, a buffered press
    // just before landing, and holding Space hops again on every landing.
    const spaceDown = keys.has('Space')
    if (spaceDown && !this._spaceWasDown) this._jumpBuffer = JUMP_BUFFER
    this._spaceWasDown = spaceDown
    this._coyote = this.onGround ? COYOTE : Math.max(0, this._coyote - dt)
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt)

    if (onLadder) {
      const up = keys.has('KeyW') || spaceDown
      this.vel.y = up ? CLIMB : keys.has('KeyS') ? -CLIMB : -1
    } else if (inLiquid) {
      this.vel.y = spaceDown ? 3.5 : Math.max(this.vel.y - GRAVITY * 0.2 * dt, -2.5)
    } else {
      // Holding Space keeps hopping: jumps again the moment you land.
      if ((this._jumpBuffer > 0 || (spaceDown && this.onGround)) && this._coyote > 0) {
        // Jumping again right as you land (a press just before, or Space
        // held down) adds a link to the bunny-hop chain; a late one doesn't.
        const timed = this.onGround && this._groundTime <= BHOP_WINDOW && this._landedFromJump
        this._hopChain = timed ? Math.min(BHOP_MULT.length - 1, this._hopChain + 1) : 0
        this._landedFromJump = false
        this._jumpedAt = true
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
      // Crouching on the ground never walks you off an edge (anything
      // deeper than a step).
      if (crouch && this.onGround && !onLadder && !inLiquid && !this._hits(p.x, p.y - STEP_UP - 0.05, p.z)) {
        p[axis] = before
        this.vel[axis] = 0
        continue
      }
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
    const wasOnGround = this.onGround
    this.onGround = hitY && falling
    if (this.onGround && !wasOnGround) {
      this._groundTime = 0
      this._landedFromJump = !!this._jumpedAt
      this._jumpedAt = false
    }
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
    this._eye = THREE.MathUtils.damp(this._eye, crouch ? CROUCH_EYE : EYE, 18, dt)
    cam.position.set(p.x * B, (p.y + this._eye + bob) * B, p.z * B)
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
    this._updateShards(dt)
    this._drawMap(performance.now())
    this._setUnderwater(this._liquidAtEye(p))
  }

  // Which liquid (if any) the eyes are in - below a flowing cell's surface,
  // not just inside its cell.
  _liquidAtEye(p) {
    const ey = p.y + this._eye
    const cx = Math.floor(p.x)
    const cy = Math.floor(ey)
    const cz = Math.floor(p.z)
    const type = this.bm.getBlockAt(cx, cy, cz)
    if (type !== 'water' && type !== 'lava') return null
    const full = this.bm.getBlockAt(cx, cy + 1, cz) === type
    return full || ey - cy < this.bm.liquids.heightAt(cx, cy, cz) ? type : null
  }

  // Head under water tints the screen blue (bloxd.io's look), lava orange.
  _setUnderwater(kind) {
    if (kind === this._underwater) return
    this._underwater = kind
    if (!this._underwaterEl) {
      if (!kind) return
      this._underwaterEl = document.createElement('div')
      this._underwaterEl.id = 'build-try-underwater'
      document.body.appendChild(this._underwaterEl)
    }
    this._underwaterEl.className = kind || ''
    this._underwaterEl.style.display = kind ? 'block' : 'none'
  }

  // Left click while trying: the gun kicks and fires. Nothing gets built
  // or broken - except windows (see _shootWindow).
  fire() {
    this._recoil = 1
    audioEngine.playShot(this._gunId)
    this._shootWindow()
  }

  // --- Windows: the first shot cracks a glass block, the second breaks it,
  // and after that shots go through the hole. Only for this try - exit()
  // puts every broken window back, and saves always count them as there
  // (BuildMode._snapshot reads brokenWindows()). ---
  _shootWindow() {
    const bm = this.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const hit = bm._raycastGridAligned()
    if (!hit) return
    const [x, y, z] = hit.existingBlock
    const type = bm.getBlockAt(x, y, z)
    if (!bm._isWindowType(type)) return
    const key = bm._key(x, y, z)
    if (!this._cracked.has(key)) {
      this._cracked.set(key, { x, y, z })
      this._rebuildCracks()
      audioEngine.playGlassCrack()
      return
    }
    this._cracked.delete(key)
    this._rebuildCracks()
    this._broken.set(key, { x, y, z, type })
    bm._suppressUndoRecording = true
    bm.removeBlock(x, y, z)
    bm._suppressUndoRecording = false
    this._spawnShards(x, y, z, type)
    audioEngine.playGlassBreak()
  }

  brokenWindows() {
    return [...this._broken.values()]
  }

  // The scene was cleared (another slot loaded, map reset): nothing to
  // put back any more.
  forgetWindows() {
    this._broken.clear()
    this._cracked.clear()
    this._rebuildCracks()
    this._clearShards()
  }

  _restoreWindows() {
    const bm = this.bm
    bm._suppressUndoRecording = true
    for (const b of this._broken.values()) {
      if (!bm.getBlockAt(b.x, b.y, b.z)) bm.placeBlock(b.x, b.y, b.z, b.type)
    }
    bm._suppressUndoRecording = false
    this.forgetWindows()
  }

  // A pixel-art crack, drawn once: lines running out from the middle.
  _crackTexture() {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const ctx = c.getContext('2d')
    const paths = [
      [[8, 8], [6, 6], [5, 3], [3, 1], [2, 0]],
      [[8, 8], [10, 6], [12, 5], [13, 2], [15, 1]],
      [[8, 8], [11, 9], [13, 11], [15, 12]],
      [[8, 8], [7, 11], [5, 13], [4, 15]],
      [[8, 8], [5, 9], [2, 8], [0, 9]],
      [[11, 9], [11, 12], [12, 15]],
      [[6, 6], [3, 5]],
    ]
    const dot = (px, py, color) => {
      ctx.fillStyle = color
      ctx.fillRect(px, py, 1, 1)
    }
    for (const path of paths) {
      for (let i = 1; i < path.length; i++) {
        const [x0, y0] = path[i - 1]
        const [x1, y1] = path[i]
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
        for (let j = 0; j <= n; j++) {
          const px = Math.round(x0 + ((x1 - x0) * j) / n)
          const py = Math.round(y0 + ((y1 - y0) * j) / n)
          if (px + 1 < 16) dot(px + 1, py, 'rgba(40,50,60,0.45)')
          dot(px, py, 'rgba(255,255,255,0.95)')
        }
      }
    }
    const tex = new THREE.CanvasTexture(c)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // Cracked windows get a crack drawn on every face (one InstancedMesh,
  // a hair bigger than the block so it shows on top).
  _rebuildCracks() {
    const bm = this.bm
    if (this._crackMesh) {
      bm.scene.remove(this._crackMesh)
      this._crackMesh.geometry.dispose()
      this._crackMesh.dispose()
      this._crackMesh = null
    }
    if (!this._cracked.size) return
    if (!this._crackMaterial) {
      this._crackMaterial = new THREE.MeshBasicMaterial({ map: this._crackTexture(), transparent: true, alphaTest: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    }
    const B = this.B
    const size = B * 1.01
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), this._crackMaterial, this._cracked.size)
    const m = new THREE.Matrix4()
    let i = 0
    for (const { x, y, z } of this._cracked.values()) {
      m.makeTranslation((x + 0.5) * B, (y + 0.5) * B, (z + 0.5) * B)
      mesh.setMatrixAt(i++, m)
    }
    mesh.renderOrder = 2
    bm.scene.add(mesh)
    this._crackMesh = mesh
  }

  _spawnShards(x, y, z, type) {
    const B = this.B
    const scene = this.bm.scene
    if (!this._shardGeometry) this._shardGeometry = new THREE.BoxGeometry(B * 0.14, B * 0.14, B * 0.02)
    let mat = this._shardMaterials.get(type)
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: this.bm._blockColor(type), transparent: true, opacity: 0.75 })
      this._shardMaterials.set(type, mat)
    }
    // Flying away from the shooter.
    const cam = this.bm.camera.position
    const cx = (x + 0.5) * B
    const cy = (y + 0.5) * B
    const cz = (z + 0.5) * B
    const away = new THREE.Vector3(cx - cam.x, 0, cz - cam.z).normalize()
    for (let i = 0; i < SHARDS_PER_WINDOW; i++) {
      const shard = new THREE.Mesh(this._shardGeometry, mat)
      shard.position.set(cx + (Math.random() - 0.5) * B * 0.8, cy + (Math.random() - 0.5) * B * 0.8, cz + (Math.random() - 0.5) * B * 0.8)
      shard.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
      scene.add(shard)
      this._shards.push({
        mesh: shard,
        vel: new THREE.Vector3(away.x * 2 + (Math.random() - 0.5) * 2.5, Math.random() * 2.5, away.z * 2 + (Math.random() - 0.5) * 2.5).multiplyScalar(B),
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
        life: SHARD_LIFE * (0.7 + Math.random() * 0.3),
      })
    }
  }

  _updateShards(dt) {
    if (!this._shards.length) return
    const g = GRAVITY * 0.6 * this.B
    this._shards = this._shards.filter((s) => {
      s.life -= dt
      if (s.life <= 0) {
        this.bm.scene.remove(s.mesh)
        return false
      }
      s.vel.y -= g * dt
      s.mesh.position.addScaledVector(s.vel, dt)
      s.mesh.rotation.x += s.spin.x * dt
      s.mesh.rotation.y += s.spin.y * dt
      s.mesh.scale.setScalar(Math.min(1, s.life * 3))
      return true
    })
  }

  _clearShards() {
    for (const s of this._shards) this.bm.scene.remove(s.mesh)
    this._shards = []
  }

  // Whether the body overlaps a solid cell right now (BuildMode checks
  // this so a door never swings shut onto the player).
  overlapsSolid() {
    return this._hits(this.pos.x, this.pos.y, this.pos.z)
  }

  // --- The gun, drawn on top of the world in its own little scene, so it
  // never pokes into a wall you're standing against. ---
  _ensureGunScene() {
    if (this._gunScene) return
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

  _showGun() {
    const weapons = this.bm.game?.weapons
    if (!weapons?.viewmodels) return
    // The first gun in the player's hotbar (not the knife), else the rifle.
    const hotbar = this.bm.game?.settings?.hotbar || []
    const gunIds = hotbar.filter((wid) => wid && weapons.viewmodels[wid] && !/melee|knife|bat|katana|machete/i.test(wid))
    const id = gunIds[0] || (weapons.viewmodels.rifle ? 'rifle' : weapons.current?.id)
    const source = id && weapons.viewmodels[id]
    if (!source) return
    this._ensureGunScene()
    if (this._gunId !== id) {
      if (this._gun) this._gunScene.remove(this._gun)
      // A copy of the game's own gun model (geometry/materials shared).
      const gun = source.clone(true)
      gun.visible = true
      this._gun = new THREE.Group()
      this._gun.add(gun)
      this._gunScene.add(this._gun)
      this._gunId = id
      this._armSpots = this._findHandSpots(gun)
      this._rebuildArms()
    }
    this._gun.visible = true
    this._loadArms()
  }

  // Where the two hands go on this gun, in the gun group's space, from the
  // gun's own size (every gun points along -z): the right hand on the grip
  // near the back, the left hand under the barrel halfway along. (The
  // models' hidden grip markers sit in the wrong places for this.)
  _findHandSpots(gun) {
    const g = this._gun
    g.position.set(0, 0, 0)
    g.rotation.set(0, 0, 0)
    g.updateMatrixWorld(true)
    const box = new THREE.Box3()
    const corner = new THREE.Vector3()
    gun.traverse((o) => {
      if (!o.isMesh) return
      for (let q = o; q; q = q.parent) if (q.userData?.isHand) return
      o.geometry.computeBoundingBox()
      const bb = o.geometry.boundingBox
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        box.expandByPoint(corner.set(x, y, z).applyMatrix4(o.matrixWorld))
      }
    })
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.03, -0.1, -0.6), new THREE.Vector3(0.03, 0.1, 0.05))
    const size = box.getSize(new THREE.Vector3())
    const cx = (box.min.x + box.max.x) / 2
    const grip = new THREE.Vector3(cx, box.min.y + size.y * 0.25, box.max.z - size.z * 0.12)
    const fore = new THREE.Vector3(cx, box.min.y + size.y * 0.35, box.max.z - size.z * 0.5)
    return [
      { limb: 'armR', shoulder: ARM_SHOULDERS.armR, hand: grip.toArray() },
      { limb: 'armL', shoulder: ARM_SHOULDERS.armL, hand: fore.toArray() },
    ]
  }

  // Loads the equipped skin (once per skin) and builds the arms from it.
  _loadArms() {
    const url = this.bm.game?.settings?.customSkinDataUrl || DEFAULT_SKIN_DATA_URL
    if (this._armsUrl === url) return
    this._armsUrl = url
    loadSkinTexture(url).then((skin) => {
      if (this._armsUrl !== url) return
      this._armSkin = skin
      this._rebuildArms()
    }).catch(() => {
      // Unreadable skin - the gun is shown without arms.
    })
  }

  // Arms reaching from the bottom of the screen to this gun's hand spots.
  _rebuildArms() {
    if (!this._armSkin || !this._gun || !this._armSpots) return
    this._disposeArms()
    this._arms = buildArms(this._armSkin, this._armSpots)
    this._gun.add(this._arms)
  }

  _disposeArms() {
    if (!this._arms) return
    disposeArms(this._arms)
    this._arms = null
  }

  // --- Building (not trying): the selected block held in the corner like
  // Minecraft (just the block, no arm), swinging on every place/break.
  // Drawn in the same on-top scene as Try Map's gun. ---
  swingHand() {
    this._swingT = 0
  }

  drawHand(renderer, type) {
    if (this.active) return
    this._ensureGunScene()
    if (this._gun) this._gun.visible = false
    if (!this._hand) {
      this._hand = new THREE.Group()
      this._handHeld = new THREE.Group()
      this._handHeld.position.set(...HAND_BLOCK_POS)
      this._handHeld.rotation.set(0.12, 0.72, 0)
      this._hand.add(this._handHeld)
      this._gunScene.add(this._hand)
    }
    if (type !== this._handType) {
      this._handType = type
      this._setHeldBlock(type)
    }
    // Swing: down and in toward the middle of the screen, then back.
    const now = performance.now()
    const dt = Math.min(0.05, (now - (this._handAt || now)) / 1000)
    this._handAt = now
    let swing = 0
    if (this._swingT !== null && this._swingT !== undefined) {
      this._swingT += dt / SWING_TIME
      if (this._swingT >= 1) this._swingT = null
      else swing = Math.sin(this._swingT * Math.PI)
    }
    this._hand.rotation.set(-swing * 0.55, swing * 0.35, 0)
    this._hand.position.set(-swing * 0.06, -swing * 0.03, 0)
    this._hand.visible = true
    this._renderOnTop(renderer)
    this._hand.visible = false
  }

  _setHeldBlock(type) {
    for (const child of [...this._handHeld.children]) {
      this._handHeld.remove(child)
      for (const m of [].concat(child.material)) m.dispose()
    }
    const parts = type && this.bm._heldBlockParts(type)
    if (!parts) return
    // Own copies of the block's materials, toned for the bright scene
    // (the textures themselves are shared, never disposed here).
    const toned = [].concat(parts.material).map((m) => {
      const c = m.clone()
      c.color?.multiplyScalar(0.62)
      if (c.emissive && c.emissiveIntensity) c.emissiveIntensity *= 0.7
      return c
    })
    const mesh = new THREE.Mesh(parts.geometry, Array.isArray(parts.material) ? toned : toned[0])
    mesh.scale.setScalar(HAND_BLOCK_SIZE / this.B)
    mesh.frustumCulled = false
    this._handHeld.add(mesh)
  }


  _renderOnTop(renderer) {
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

  drawGun(renderer) {
    if (!this.active || !this._gun?.visible) return
    if (this._hand) this._hand.visible = false
    this._renderOnTop(renderer)
  }
}

// Blocky arms from a skin: each limb stretched from its shoulder (off the
// bottom of the screen) to its hand, matte and toned down for the on-top
// scene's bright lights (made for shiny metal) - otherwise the skin washes
// out to near white.
function buildArms(skin, list) {
  const character = buildTexturedCharacter(skin)
  const arms = new THREE.Group()
  const up = new THREE.Vector3(0, -1, 0)
  for (const { limb, shoulder, hand } of list) {
    const pivot = character.limbPivots[limb]
    pivot.position.set(0, 0, 0)
    const from = new THREE.Vector3(...shoulder)
    const dir = new THREE.Vector3(...hand).sub(from)
    const arm = new THREE.Group()
    arm.position.copy(from)
    arm.quaternion.setFromUnitVectors(up, dir.clone().normalize())
    // The limb hangs 12 skin pixels down from its pivot: stretch it to
    // reach the hand, keep its width.
    arm.scale.set(ARM_PX, dir.length() / 12, ARM_PX)
    arm.add(pivot)
    arms.add(arm)
  }
  arms.traverse((o) => {
    if (!o.isMesh) return
    o.frustumCulled = false
    const old = o.material
    o.material = new THREE.MeshLambertMaterial({ map: old.map, color: 0x8a8a8a, alphaTest: old.alphaTest, transparent: old.transparent, side: old.side })
    old.dispose()
  })
  return arms
}

function disposeArms(arms) {
  arms.parent?.remove(arms)
  arms.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
