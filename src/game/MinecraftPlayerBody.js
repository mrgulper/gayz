// Renders the same blocky Minecraft-style character shown spinning on the
// homepage's Player Setup panel - used for every OTHER player in
// multiplayer, and (per request) for the local player's own third-person
// view too, replacing the realistic GLB humanoid PlayerBody.js used to
// show there. PlayerBody.js itself is untouched (still used for its own
// outfit/hat cosmetics elsewhere) - this is a separate class, not a
// change to it.
import * as THREE from 'three'
import { loadSkinTexture, DEFAULT_SKIN_DATA_URL, buildTexturedCharacter } from './MenuAvatar3D.js'

let _skinCache = null
let _skinPromise = null

export async function preloadMinecraftPlayerSkin() {
  if (_skinCache) return
  if (!_skinPromise) _skinPromise = loadSkinTexture(DEFAULT_SKIN_DATA_URL)
  _skinCache = await _skinPromise
}

// Keyed by the raw data URL string - a session with several remote players
// who never customized their skin would otherwise decode the exact same
// default PNG bytes over and over, once per body. Module-level (not
// per-body) since the same skin can recur across bodies within one session
// and, for the shared default case, across sessions too.
const _remoteSkinPromises = new Map()

function _loadRemoteSkin(dataUrl) {
  if (!_remoteSkinPromises.has(dataUrl)) {
    _remoteSkinPromises.set(dataUrl, loadSkinTexture(dataUrl).catch(() => _skinCache))
  }
  return _remoteSkinPromises.get(dataUrl)
}

// buildTexturedCharacter()'s boxes are built in raw skin-pixel units with
// the character's FEET sitting at local y=-2, not y=0 (legs are 12 tall,
// centered at y=4, so their bottom edge is 4 - 6 = -2) - this game's own
// world uses real-world-ish units (EYE_HEIGHT = 1.7, see
// PlayerController.js), so the raw ~32-unit-tall character needs both a
// scale correction and a feet-to-origin offset before it can be
// positioned the same way PlayerBody positions its own feet.
const RAW_HEIGHT = 32 // head top (30) to feet (-2)
const RAW_FEET_Y = -2
const TARGET_HEIGHT = 1.85 // roughly matches EYE_HEIGHT (1.7) as ~92% of total height
const SCALE = TARGET_HEIGHT / RAW_HEIGHT

// Walk cycle - the character had no animation at all before this (a
// static pose that just slid around), unlike PlayerBody.js's GLB model
// which has a real walk cycle. Deliberately simple (a sine-wave swing on
// each limb's own shoulder/hip pivot, arms and legs counter-swinging like
// a real gait) rather than a full authored animation clip - there's no
// rig/skeleton here, just 4 independent pivot groups (see
// buildTexturedCharacter's own limbPivots).
const WALK_CYCLE_SPEED = 9 // phase radians/sec while moving - tuned by eye to read as a natural stride at this character's scale
const MAX_SWING_ANGLE = 0.7 // radians each direction
const MIN_WALK_SPEED = 0.4 // world units/sec - below this, treated as standing still (filters out sub-pixel network/float jitter, not a real walk)
const ANIM_EASE_PER_SEC = 10 // how quickly each limb's actual angle eases toward its target - avoids a hard snap when starting/stopping

// A floating nickname label, same technique PlayerBody.js uses (a
// THREE.Sprite so it always faces the camera regardless of the body's
// own facing).
function _buildNicknameSprite(nickname) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.font = 'bold 40px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.strokeText(nickname, canvas.width / 2, canvas.height / 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(nickname, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.1, 0.28, 1)
  sprite.position.set(0, 2.05, 0)
  return sprite
}

function _disposeCharacterMesh(mesh) {
  mesh.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
    if (obj.material) obj.material.dispose()
  })
}

export class MinecraftPlayerBody {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.visible = false
    // Inner group carries the scale + feet-offset correction, so this.group's
    // own origin (what update() positions) always means "feet position",
    // same contract PlayerBody.update() already has.
    this._inner = new THREE.Group()
    this._inner.scale.setScalar(SCALE)
    this._inner.position.y = -RAW_FEET_Y * SCALE
    // Built with the shared default skin immediately (never left empty
    // while a real skin loads) - setSkin() below swaps this out once this
    // player's own real skin (if any) comes back from the server.
    this._characterMesh = _skinCache ? buildTexturedCharacter(_skinCache) : null
    this._limbPivots = this._characterMesh ? this._characterMesh.limbPivots : null
    if (this._characterMesh) this._inner.add(this._characterMesh)
    this._appliedSkinUrl = null
    this.group.add(this._inner)
    scene.add(this.group)

    // Walk-cycle state - see the constants above for what each of these
    // drives. _lastX/_lastZ start null so the very first update() call
    // never computes a bogus "moved 1000 units in one frame" speed spike.
    this._lastX = null
    this._lastZ = null
    this._lastTime = performance.now()
    this._walkPhase = 0
    this._limbAngle = { armR: 0, armL: 0, legR: 0, legL: 0 }
  }

  // Swaps this one player's body onto their own real skin instead of the
  // shared default - see _renderRemotePlayers' first-seen branch in
  // Game.js, which fetches it once per player per session (not on every
  // sync tick) and calls this exactly once as a result. A null/undefined
  // dataUrl (never customized) is a no-op - the default already applied
  // at construction is correct as-is.
  async setSkin(dataUrl) {
    if (!dataUrl || dataUrl === this._appliedSkinUrl) return
    this._pendingSkinUrl = dataUrl
    const skin = await _loadRemoteSkin(dataUrl)
    // The body may have been removed (player left) while this was loading,
    // or setSkin called again with a newer value - either way, don't apply
    // a stale result to a group that's no longer in the scene, or clobber
    // a more recent call's result.
    if (!this.group.parent || dataUrl !== this._pendingSkinUrl) return
    this._applySkinMesh(buildTexturedCharacter(skin), dataUrl)
  }

  // For the local player's own body only (see Game.js's skin-reset
  // button) - explicitly reverts BACK to the shared default, unlike
  // setSkin(null/undefined) which means "no real skin to apply, leave
  // whatever's already showing" (the correct behavior for a remote player
  // who simply never customized one). A no-op if already on default.
  resetToDefaultSkin() {
    if (!this._appliedSkinUrl || !_skinCache) return
    this._applySkinMesh(buildTexturedCharacter(_skinCache), null)
  }

  _applySkinMesh(mesh, appliedUrl) {
    if (this._characterMesh) {
      this._inner.remove(this._characterMesh)
      _disposeCharacterMesh(this._characterMesh)
    }
    this._characterMesh = mesh
    this._limbPivots = mesh.limbPivots
    this._inner.add(mesh)
    this._appliedSkinUrl = appliedUrl
  }

  update(feetX, feetY, feetZ, yaw, visible) {
    this.group.visible = visible
    if (!visible) return
    this.group.position.set(feetX, feetY, feetZ)
    this.group.rotation.y = yaw
    this._updateWalkCycle(feetX, feetZ)
  }

  // Speed is derived from how far feetX/feetZ actually moved since the
  // last call, not a value the caller passes in - both the local player
  // (driven every render frame from the real camera/controller position)
  // and a remote player (driven from position-sync ticks that land every
  // ~100ms, not every frame) already call update() with their real
  // current position each time, so this works the same way for either
  // without needing a separate velocity input.
  _updateWalkCycle(feetX, feetZ) {
    const now = performance.now()
    const dt = Math.min((now - this._lastTime) / 1000, 0.1)
    this._lastTime = now

    let moving = false
    if (this._lastX !== null && dt > 0) {
      const dx = feetX - this._lastX
      const dz = feetZ - this._lastZ
      const speed = Math.sqrt(dx * dx + dz * dz) / dt
      moving = speed > MIN_WALK_SPEED
    }
    this._lastX = feetX
    this._lastZ = feetZ

    if (!this._limbPivots) return

    if (moving) this._walkPhase += dt * WALK_CYCLE_SPEED
    const swing = moving ? Math.sin(this._walkPhase) * MAX_SWING_ANGLE : 0
    // Counter-swing gait: right arm forward pairs with left leg forward
    // (and vice versa), same as a real walking stride.
    const target = { armR: swing, armL: -swing, legR: -swing, legL: swing }
    const ease = Math.min(dt * ANIM_EASE_PER_SEC, 1)
    for (const key of ['armR', 'armL', 'legR', 'legL']) {
      this._limbAngle[key] += (target[key] - this._limbAngle[key]) * ease
      this._limbPivots[key].rotation.x = this._limbAngle[key]
    }
  }

  setNickname(nickname) {
    if (this._nicknameText === nickname) return
    if (this._nicknameSprite) {
      this.group.remove(this._nicknameSprite)
      this._nicknameSprite.material.map.dispose()
      this._nicknameSprite.material.dispose()
    }
    this._nicknameText = nickname
    this._nicknameSprite = _buildNicknameSprite(nickname)
    this.group.add(this._nicknameSprite)
  }
}
