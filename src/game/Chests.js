import * as THREE from 'three'

const INTERACT_RADIUS = 2.2
const INTERACT_HEIGHT_TOLERANCE = 2.2
const EYE_HEIGHT = 1.7

const LOOT_WEIGHTS = { health: 1, ammo: 1, noisemaker: 0.4, scope: 0.2, extended_mag: 0.3, fuelcan: 0.5, grenade: 0.35, melee_bat: 0.15, melee_machete: 0.15 }
const LOOT_LABELS = { health: 'Health Pack', ammo: 'Ammo Crate', noisemaker: 'Noisemaker', scope: 'Scope', extended_mag: 'Extended Mag', fuelcan: 'Fuel Can', grenade: 'Grenade', melee_bat: 'Bat', melee_machete: 'Machete' }
const LOOT_COUNT_MIN = 1
const LOOT_COUNT_MAX = 2

function pickLoot() {
  const entries = Object.entries(LOOT_WEIGHTS)
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

class Chest {
  constructor(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
    this.opened = false

    this.group = new THREE.Group()
    this.group.position.set(x, y, z)

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
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 10, Math.PI), trimMat)
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
    if (this.opened) return
    this.indicatorMat.emissiveIntensity = 0.6 + Math.sin(elapsed * 2.2) * 0.3
  }

  open() {
    this.opened = true
    this.lid.rotation.x = -2.0
    this.indicatorMat.color.setHex(0x0a2a0a)
    this.indicatorMat.emissive.setHex(0x2aff3e)
    this.indicatorMat.emissiveIntensity = 0.6
  }

  reset() {
    this.opened = false
    this.lid.rotation.x = 0
    this.indicatorMat.color.setHex(0x1a0505)
    this.indicatorMat.emissive.setHex(0xff2a1e)
    this.indicatorMat.emissiveIntensity = 0.9
  }
}

export class ChestManager {
  constructor(scene, extraSpots = []) {
    this.scene = scene
    const spots = [...CHEST_SPOTS, ...extraSpots]
    this.chests = spots.map((p) => new Chest(p.x, p.y || 0, p.z))
    for (const c of this.chests) scene.add(c.group)
    this.nearbyChest = null
  }

  // Adds one extra chest at runtime, for the "Supply Drop" random night event.
  addChest(x, y, z) {
    const chest = new Chest(x, y, z)
    this.chests.push(chest)
    this.scene.add(chest.group)
    return chest
  }

  update(dt, elapsed, playerPos) {
    let nearest = null
    let nearestDist = INTERACT_RADIUS
    const playerFeetY = playerPos.y - EYE_HEIGHT

    for (const chest of this.chests) {
      chest.update(dt, elapsed)
      if (chest.opened) continue

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

    const type = pickLoot()
    const count = LOOT_COUNT_MIN + Math.floor(Math.random() * (LOOT_COUNT_MAX - LOOT_COUNT_MIN + 1))
    return { type, label: LOOT_LABELS[type], count }
  }

  reset() {
    for (const c of this.chests) c.reset()
    this.nearbyChest = null
  }
}
