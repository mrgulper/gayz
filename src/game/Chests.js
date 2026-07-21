import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

// Phase 5 (bespoke interactables) of the 3D asset overhaul - real rigged
// GLB chest (Quaternius "Chest", CC0, poly.pizza) with its own baked
// Chest_Open animation clip, replacing the procedural military-crate group
// below. Same preload/clone pattern as Companion.js/Zombie.js.
export const USE_GLB_CHEST = true
let _chestModelCache = null

export async function preloadChestModel() {
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('/models/props/chest.glb')
    _chestModelCache = { scene: gltf.scene, animations: gltf.animations }
  } catch (err) {
    console.warn('GLB chest model failed to load, falling back to procedural chest', err)
  }
}

// Raw model bounds (Box3 on the unscaled scene): ~2.14 wide x 1.81 tall x
// 1.88 deep. Scaled down to a human-waist-height loot chest, ~0.9 wide.
const GLB_SCALE_CORRECTION = 0.42

const INTERACT_RADIUS = 2.2
const INTERACT_HEIGHT_TOLERANCE = 2.2
const EYE_HEIGHT = 1.7

// Exported so a zone-tagged location can build an override table by
// spreading/adjusting this base table (e.g. `{ ...LOOT_WEIGHTS, rare_weapon: 1 }`
// for a "high loot complexity" spot) instead of hand-duplicating every entry.
export const LOOT_WEIGHTS = { health: 1, ammo: 1, noisemaker: 0.4, scope: 0.2, extended_mag: 0.3, fuelcan: 0.5, grenade: 0.35, melee_bat: 0.15, melee_machete: 0.15, melee_uvbaton: 0.1, rare_weapon: 0.25, legendary_weapon: 0.08 }
const LOOT_LABELS = { health: 'Health Pack', ammo: 'Ammo Crate', noisemaker: 'Noisemaker', scope: 'Scope', extended_mag: 'Extended Mag', fuelcan: 'Fuel Can', grenade: 'Grenade', melee_bat: 'Bat', melee_machete: 'Machete', melee_uvbaton: 'UV Baton', rare_weapon: 'Rare Weapon Part', legendary_weapon: 'Legendary Weapon Part' }
const LOOT_COUNT_MIN = 1
const LOOT_COUNT_MAX = 2

// Optional weights param lets a zone-tagged chest (see Zones.js/the
// Extended Metropolitan Grid plan's per-location loot tiers) roll from its
// own table instead of the global one - e.g. a "high loot complexity"
// location can boost rare_weapon/legendary_weapon odds without touching
// every other chest on the map.
function pickLoot(weights = LOOT_WEIGHTS) {
  const entries = Object.entries(weights)
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let roll = Math.random() * total
  for (const [id, w] of entries) {
    roll -= w
    if (roll <= 0) return id
  }
  return entries[0][0]
}

// Flanking the central avenue, spread along its length so exploring away
// from the middle of the street is rewarded.
const CHEST_SPOTS = []
for (let z = -38; z <= 38; z += 15) {
  CHEST_SPOTS.push({ x: -(7 + Math.random() * 3), y: 0, z: z + (Math.random() - 0.5) * 4 })
  CHEST_SPOTS.push({ x: 7 + Math.random() * 3, y: 0, z: z + (Math.random() - 0.5) * 4 })
}

// Squat, rectangular steel supply crate - olive-drab body, black banded
// seams and corner brackets, a stenciled lid marking, and a pair of latch
// clasps with a status LED - reads as military ammo storage rather than a
// hinged wooden treasure chest.
const CRATE_W = 0.95
const CRATE_D = 0.55
const BASE_HEIGHT = 0.34
const LID_HEIGHT = 0.14

function buildStencilTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 96
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#4b5333'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#20241670'
  ctx.lineWidth = 5
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12)

  ctx.fillStyle = '#c9b34a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 30px sans-serif'
  ctx.fillText('AMMO', canvas.width / 2, canvas.height / 2 - 8)
  ctx.font = 'bold 13px sans-serif'
  ctx.fillText('SUPPLY CRATE', canvas.width / 2, canvas.height / 2 + 22)

  const texture = new THREE.CanvasTexture(canvas)
  return texture
}

// Chests earlier this session opened once and stayed empty for the rest of
// the run - there was no reason to check an already-opened one again. Now
// only 3 random chests are "stocked" at a time (see ChestManager.refillNight,
// called each night) instead of every chest being available from the start,
// so there's fresh loot to find each night instead of the map going stale
// once everything's been picked clean.
class Chest {
  constructor(x, y, z, lootWeights = null) {
    this.x = x
    this.y = y
    this.z = z
    this.opened = false
    this.locked = true
    this.lootWeights = lootWeights

    this.group = new THREE.Group()
    this.group.position.set(x, y, z)

    if (USE_GLB_CHEST && _chestModelCache) {
      this._buildFromGLB()
    } else {
      this._buildProcedural()
    }
  }

  _buildFromGLB() {
    this.usingGLB = true
    const cloned = cloneSkeleton(_chestModelCache.scene)
    cloned.scale.setScalar(GLB_SCALE_CORRECTION)
    cloned.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
    })
    this.group.add(cloned)

    this.mixer = new THREE.AnimationMixer(cloned)
    const openClip = _chestModelCache.animations.find((c) => c.name === 'Chest_Open')
    if (openClip) {
      this._openAction = this.mixer.clipAction(openClip)
      this._openAction.setLoop(THREE.LoopOnce, 1)
      this._openAction.clampWhenFinished = true
    }

    // Status LEDs (red locked / green unlocked) - not part of the source
    // model, added as small emissive boxes near the front so there's still
    // an at-a-glance "has this been opened" cue like the old crate had.
    this.indicatorMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })
    for (const side of [-0.16, 0.16]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.02), this.indicatorMat)
      light.position.set(side, 0.42, 0.36)
      this.group.add(light)
    }
  }

  _buildProcedural() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4b5333, roughness: 0.85 })
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.55, metalness: 0.45 })
    const stencilMat = new THREE.MeshStandardMaterial({ map: buildStencilTexture(), roughness: 0.8 })
    this.indicatorMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })

    const half = CRATE_W / 2
    const halfD = CRATE_D / 2

    const base = new THREE.Mesh(new THREE.BoxGeometry(CRATE_W, BASE_HEIGHT, CRATE_D), bodyMat)
    base.position.y = BASE_HEIGHT / 2
    base.castShadow = true
    base.receiveShadow = true
    this.group.add(base)

    // Black reinforcement seam at the base/lid split line.
    const seam = new THREE.Mesh(new THREE.BoxGeometry(CRATE_W + 0.02, 0.05, CRATE_D + 0.02), trimMat)
    seam.position.y = BASE_HEIGHT - 0.02
    this.group.add(seam)

    // Corner angle brackets running the full closed height.
    for (const [cx, cz] of [[-half, -halfD], [half, -halfD], [-half, halfD], [half, halfD]]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.05, BASE_HEIGHT + LID_HEIGHT, 0.05), trimMat)
      bracket.position.set(cx, (BASE_HEIGHT + LID_HEIGHT) / 2, cz)
      this.group.add(bracket)
    }

    // Recessed D-ring carry handles on both ends.
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 14, Math.PI), trimMat)
      handle.rotation.z = Math.PI / 2
      handle.rotation.y = Math.PI / 2
      handle.position.set(side * (half + 0.005), BASE_HEIGHT * 0.6, 0)
      this.group.add(handle)
    }

    this.lid = new THREE.Group()
    this.lid.position.set(0, BASE_HEIGHT, -halfD)
    this.group.add(this.lid)

    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(CRATE_W, LID_HEIGHT, CRATE_D), bodyMat)
    lidMesh.position.set(0, LID_HEIGHT / 2, halfD)
    lidMesh.castShadow = true
    this.lid.add(lidMesh)

    // Stenciled "AMMO SUPPLY CRATE" marking on the lid top.
    const stencil = new THREE.Mesh(new THREE.PlaneGeometry(CRATE_W * 0.7, CRATE_D * 0.6), stencilMat)
    stencil.rotation.x = -Math.PI / 2
    stencil.position.set(0, LID_HEIGHT + 0.006, halfD)
    this.lid.add(stencil)

    // Latch clasps, each with a small status light (red = locked, green = open).
    for (const side of [-0.22, 0.22]) {
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.03), trimMat)
      latch.position.set(side, BASE_HEIGHT - 0.01, halfD + 0.015)
      this.group.add(latch)

      const light = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.015), this.indicatorMat)
      light.position.set(side, BASE_HEIGHT - 0.01, halfD + 0.032)
      this.group.add(light)
    }
  }

  update(dt, elapsed) {
    if (this.mixer && this._openAction && this._openAction.isRunning()) this.mixer.update(dt)
    if (this.opened || this.locked) return
    this.indicatorMat.emissiveIntensity = 0.6 + Math.sin(elapsed * 2.2) * 0.3
  }

  _resetLid() {
    if (this._openAction) {
      this._openAction.stop()
      this._openAction.reset()
      this.mixer.update(0)
    } else if (this.lid) {
      this.lid.rotation.x = 0
    }
  }

  open() {
    this.opened = true
    if (this._openAction) {
      this._openAction.reset()
      this._openAction.play()
    } else if (this.lid) {
      this.lid.rotation.x = -2.0
    }
    this.indicatorMat.color.setHex(0x0a2a0a)
    this.indicatorMat.emissive.setHex(0x2aff3e)
    this.indicatorMat.emissiveIntensity = 0.6
  }

  // Refilled and interactable - the red pulsing "unopened" look.
  unlock() {
    this.locked = false
    this.opened = false
    this.group.visible = true
    this._resetLid()
    this.indicatorMat.color.setHex(0x1a0505)
    this.indicatorMat.emissive.setHex(0xff2a1e)
    this.indicatorMat.emissiveIntensity = 0.9
  }

  // Not part of this rotation's 3 stocked chests. Previously just a dim,
  // non-pulsing crate players could still walk up to and find nothing at -
  // now hidden entirely so every crate actually standing in the world has
  // real loot in it, instead of ~9 of 12 being decorative dead props at any
  // given moment (see ChestManager.refillNight's 3-of-N-stocked rotation).
  lock() {
    this.locked = true
    this.opened = false
    this.group.visible = false
    this._resetLid()
    this.indicatorMat.color.setHex(0x14140f)
    this.indicatorMat.emissive.setHex(0x2a2a22)
    this.indicatorMat.emissiveIntensity = 0.15
  }
}

// Bespoke Blender-built model (see asset-source/build-interactables.py) -
// no good free pack matches a bank-vault door, so this one's modeled
// directly rather than sourced. Exported flat (no parent/child) since
// Blender's glTF exporter mangled manually-parented children's transforms;
// Dial/Handle/notches get reparented onto Door via THREE's attach() below
// instead, once at construction time.
export const USE_GLB_VAULT = true
let _vaultModelCache = null

export async function preloadVaultModel() {
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('/models/props/vault.glb')
    _vaultModelCache = gltf.scene
  } catch (err) {
    console.warn('GLB vault model failed to load, falling back to procedural vault', err)
  }
}

const VAULT_INTERACT_RADIUS = 2.2
const VAULT_W = 1.1
const VAULT_H = 1.3
const VAULT_D = 0.9

// A single fixed heavy safe (distinct from the ammo-crate Chest above) that
// stays locked until the player brings it a Vault Key (see Pickups.js's
// 'vaultkey' type) - a one-off "hunt down the key, then cash in a guaranteed
// good reward" loop rather than another random-roll container. Unlike
// ChestManager there's only ever one of these, so it's a plain class rather
// than its own manager.
export class Vault {
  constructor(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
    this.opened = false

    this.group = new THREE.Group()
    this.group.position.set(x, y, z)

    if (USE_GLB_VAULT && _vaultModelCache) {
      this._buildFromGLB()
    } else {
      this._buildProcedural()
    }
  }

  _buildFromGLB() {
    this.usingGLB = true
    const cloned = _vaultModelCache.clone(true)
    cloned.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.receiveShadow = true
      child.material = child.material.clone()
    })
    this.group.add(cloned)
    cloned.updateMatrixWorld(true)

    this.door = cloned.getObjectByName('Door')
    const decorNames = ['Dial', 'Handle', 'DialNotch0', 'DialNotch1', 'DialNotch2', 'DialNotch3', 'DialNotch4', 'DialNotch5', 'DialNotch6', 'DialNotch7']
    for (const name of decorNames) {
      const obj = cloned.getObjectByName(name)
      if (obj) this.door.attach(obj)
    }

    // Same door-local coordinates the procedural version used for this
    // light (added the same way, as a direct child of this.door - not
    // reparented via attach(), so these are plain local offsets).
    this.indicatorMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), this.indicatorMat)
    light.position.set(0, VAULT_H - 0.15, VAULT_D / 2 + 0.07)
    this.door.add(light)
  }

  _buildProcedural() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 })
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.5, metalness: 0.6 })
    const dialMat = new THREE.MeshStandardMaterial({ color: 0xc9b34a, roughness: 0.35, metalness: 0.7 })
    this.indicatorMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2a1e, emissiveIntensity: 0.9 })

    const half = VAULT_D / 2

    const body = new THREE.Mesh(new THREE.BoxGeometry(VAULT_W, VAULT_H, VAULT_D), bodyMat)
    body.position.y = VAULT_H / 2
    body.castShadow = true
    body.receiveShadow = true
    this.group.add(body)

    // Reinforced door face on the front, standing slightly proud of the body.
    this.door = new THREE.Mesh(new THREE.BoxGeometry(VAULT_W - 0.1, VAULT_H - 0.1, 0.06), trimMat)
    this.door.position.set(0, VAULT_H / 2, half + 0.03)
    this.group.add(this.door)

    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 16), dialMat)
    dial.rotation.x = Math.PI / 2
    dial.position.set(0.15, VAULT_H / 2 + 0.1, half + 0.07)
    this.door.add(dial)

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.35, 0.05), trimMat)
    handle.position.set(-0.28, VAULT_H / 2 - 0.05, half + 0.07)
    this.door.add(handle)

    const light = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), this.indicatorMat)
    light.position.set(0, VAULT_H - 0.15, half + 0.07)
    this.door.add(light)
  }

  update(dt, elapsed) {
    if (this.opened) return
    this.indicatorMat.emissiveIntensity = 0.6 + Math.sin(elapsed * 2.2) * 0.3
  }

  isNear(playerPos) {
    if (this.opened) return false
    if (Math.abs(playerPos.y - EYE_HEIGHT - this.y) > INTERACT_HEIGHT_TOLERANCE) return false
    return Math.hypot(playerPos.x - this.x, playerPos.z - this.z) <= VAULT_INTERACT_RADIUS
  }

  open() {
    this.opened = true
    this.door.rotation.y = -1.7
    this.door.position.x = -0.3
    this.door.position.z += 0.35
    this.indicatorMat.color.setHex(0x0a2a0a)
    this.indicatorMat.emissive.setHex(0x2aff3e)
    this.indicatorMat.emissiveIntensity = 0.6
  }
}

export class ChestManager {
  constructor(scene, extraSpots = []) {
    this.scene = scene
    const spots = [...CHEST_SPOTS, ...extraSpots]
    this.chests = spots.map((p) => new Chest(p.x, p.y || 0, p.z, p.lootWeights || null))
    for (const c of this.chests) scene.add(c.group)
    this.nearbyChest = null
    this.refillNight()
  }

  // Adds one extra chest at runtime, for the "Supply Drop" random night event.
  // Unlocked immediately - it's a bonus reward for that event, not part of
  // the regular nightly rotation.
  addChest(x, y, z, lootWeights = null) {
    const chest = new Chest(x, y, z, lootWeights)
    chest.unlock()
    this.chests.push(chest)
    this.scene.add(chest.group)
    return chest
  }

  // Locks every chest, then picks 3 at random to stock for the night -
  // called once per night (see Game.js's night-advance block) so there's
  // always fresh loot to find instead of the map staying picked-clean for
  // the rest of the run.
  refillNight(count = 3) {
    for (const c of this.chests) c.lock()
    const pool = [...this.chests]
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      pool.splice(idx, 1)[0].unlock()
    }
  }

  update(dt, elapsed, playerPos) {
    let nearest = null
    let nearestDist = INTERACT_RADIUS
    const playerFeetY = playerPos.y - EYE_HEIGHT

    for (const chest of this.chests) {
      chest.update(dt, elapsed)
      if (chest.opened || chest.locked) continue

      if (Math.abs(playerFeetY - chest.y) > INTERACT_HEIGHT_TOLERANCE) continue

      const dist = Math.hypot(playerPos.x - chest.x, playerPos.z - chest.z)
      if (dist < nearestDist) {
        nearest = chest
        nearestDist = dist
      }
    }

    this.nearbyChest = nearest
  }

  tryInteract() {
    if (!this.nearbyChest) return null
    const chest = this.nearbyChest
    chest.open()
    this.nearbyChest = null

    const type = pickLoot(chest.lootWeights || undefined)
    const count = LOOT_COUNT_MIN + Math.floor(Math.random() * (LOOT_COUNT_MAX - LOOT_COUNT_MIN + 1))
    return { type, label: LOOT_LABELS[type], count }
  }

  reset() {
    this.refillNight()
    this.nearbyChest = null
  }
}
