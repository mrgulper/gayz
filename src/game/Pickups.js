import * as THREE from 'three'
import { buildMinigunModel } from './Viewmodels.js'

const PICKUP_RADIUS = 1.4
const LOOT_EXPIRE_MS = 25000

const TYPES = {
  health: { weight: 4, label: 'Health Pack' },
  ammo: { weight: 4, label: 'Ammo Crate' },
  armor: { weight: 2, label: 'Armor' },
  battery: { weight: 3, label: 'Battery' },
  noisemaker: { weight: 2, label: 'Noisemaker' },
  scope: { weight: 1, label: 'Scope' },
  extended_mag: { weight: 1.5, label: 'Extended Mag' },
  fuelcan: { weight: 2, label: 'Fuel Can' },
  grenade: { weight: 1.5, label: 'Grenade' },
  melee_bat: { weight: 0.6, label: 'Bat' },
  melee_machete: { weight: 0.6, label: 'Machete' },
  melee_uvbaton: { weight: 0.4, label: 'UV Baton' },
  // weight 0: never drawn by the street-slot weighted pool, only ever placed
  // via spawnUnique() as one-off fixed-location pickups.
  minigun: { weight: 0, label: 'Minigun' },
  audiolog1: { weight: 0, label: 'Audio Log' },
  audiolog2: { weight: 0, label: 'Audio Log' },
  audiolog3: { weight: 0, label: 'Audio Log' },
  audiolog4: { weight: 0, label: 'Audio Log' },
  audiolog5: { weight: 0, label: 'Audio Log' },
  vaultkey: { weight: 0, label: 'Vault Key' },
}

function buildVisual(type) {
  const group = new THREE.Group()

  if (type === 'health') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f1414, emissive: 0xff3b3b, emissiveIntensity: 0.9 })
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), mat)
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.16), mat)
    group.add(vBar, hBar)
  } else if (type === 'ammo') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a6a2a, emissive: 0xd4af37, emissiveIntensity: 0.5, roughness: 0.6 })
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.4), mat)
    group.add(crate)
  } else if (type === 'armor') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c4a6b, emissive: 0x3fa9f5, emissiveIntensity: 0.9 })
    const shield = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), mat)
    group.add(shield)
  } else if (type === 'battery') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.4, metalness: 0.6 })
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, emissive: 0xf2c14e, emissiveIntensity: 0.9 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.45, 12), bodyMat)
    group.add(body)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 12), capMat)
    cap.position.y = 0.26
    group.add(cap)
  } else if (type === 'noisemaker') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.5, metalness: 0.4 })
    const pinMat = new THREE.MeshStandardMaterial({ color: 0xd8cfa0, emissive: 0xd8cfa0, emissiveIntensity: 0.6 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.32, 10), bodyMat)
    group.add(body)
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12), pinMat)
    pin.position.y = 0.2
    pin.rotation.x = Math.PI / 2
    group.add(pin)
  } else if (type === 'fuelcan') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb03a2a, roughness: 0.55, metalness: 0.3 })
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.4, metalness: 0.6 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.36, 0.18), bodyMat)
    group.add(body)
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 10), capMat)
    spout.position.set(0.1, 0.22, 0)
    spout.rotation.z = -0.3
    group.add(spout)
  } else if (type === 'grenade') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2e, roughness: 0.6, metalness: 0.3 })
    const pinMat = new THREE.MeshStandardMaterial({ color: 0xc9b34a, roughness: 0.4, metalness: 0.6 })
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), bodyMat)
    group.add(body)
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.03), pinMat)
    lever.position.set(0.14, 0.1, 0)
    group.add(lever)
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 10), pinMat)
    pin.position.set(0.16, 0.2, 0)
    group.add(pin)
  } else if (type === 'melee_bat') {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7 })
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.025, 0.5, 10), woodMat)
    barrel.rotation.z = Math.PI / 2 - 0.3
    group.add(barrel)
  } else if (type === 'melee_machete') {
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 })
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x2a1e14, roughness: 0.9 })
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.016, 0.4), bladeMat)
    blade.rotation.y = 0.3
    group.add(blade)
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 10), gripMat)
    grip.rotation.z = Math.PI / 2
    grip.position.set(0, 0, 0.26)
    group.add(grip)
  } else if (type === 'melee_uvbaton') {
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2d, roughness: 0.5, metalness: 0.5 })
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x2a0a44, emissive: 0x8b2fe0, emissiveIntensity: 2.0 })
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 10), shaftMat)
    shaft.rotation.z = Math.PI / 2
    group.add(shaft)
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 10), tipMat)
    tip.rotation.z = Math.PI / 2
    tip.position.set(0.24, 0, 0)
    group.add(tip)
  } else if (type === 'scope') {
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.3, metalness: 0.7 })
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x2a5a6b, emissive: 0x4fd1e8, emissiveIntensity: 0.8 })
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 12), tubeMat)
    tube.rotation.z = Math.PI / 2
    group.add(tube)
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 12), lensMat)
    lens.rotation.z = Math.PI / 2
    lens.position.x = 0.2
    group.add(lens)
  } else if (type === 'extended_mag') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.4, metalness: 0.6 })
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, emissive: 0xd4af37, emissiveIntensity: 0.4 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.1), mat)
    group.add(body)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.06, 0.105), accentMat)
    stripe.position.y = 0.05
    group.add(stripe)
  } else if (type.startsWith('audiolog')) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2a, roughness: 0.6, metalness: 0.3 })
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 1.2 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), bodyMat)
    group.add(body)
    const speaker = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0x111110, roughness: 0.8 }))
    speaker.rotation.z = Math.PI / 2
    speaker.position.set(0.1, 0, 0.13)
    group.add(speaker)
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 10), lightMat)
    light.position.set(-0.12, 0.05, 0.13)
    group.add(light)
  } else if (type === 'minigun') {
    const gun = buildMinigunModel()
    gun.scale.setScalar(1.6)
    gun.rotation.z = Math.PI / 2 // lie the barrel cluster on its side, muzzle out
    group.add(gun)

    // Golden beacon marking it as a rare, unique pickup - a glowing ring plus
    // a faint light pillar, visible well before you're close enough to read
    // the gun shape itself.
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffcf5c, transparent: true, opacity: 0.35 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 24), new THREE.MeshStandardMaterial({ color: 0x3a2f10, emissive: 0xffcf5c, emissiveIntensity: 1.1 }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = -0.35
    group.add(ring)

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 3.2, 10, 1, true), beaconMat)
    beam.position.y = 1.3
    group.add(beam)
  } else if (type === 'vaultkey') {
    const goldMat = new THREE.MeshStandardMaterial({ color: 0x3a2f10, emissive: 0xffcf5c, emissiveIntensity: 1.4, roughness: 0.35, metalness: 0.6 })
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 16), goldMat)
    bow.rotation.y = Math.PI / 2
    group.add(bow)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 8), goldMat)
    shaft.rotation.z = Math.PI / 2
    shaft.position.x = 0.22
    group.add(shaft)
    for (const tx of [0.06, 0.11]) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.025), goldMat)
      tooth.position.set(0.36 + tx, -0.04, 0)
      group.add(tooth)
    }

    // Soft golden beacon, smaller than the minigun's tall pillar - enough
    // to catch the eye from a distance without overselling a small
    // key-sized pickup.
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffcf5c, transparent: true, opacity: 0.3 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 24), new THREE.MeshStandardMaterial({ color: 0x3a2f10, emissive: 0xffcf5c, emissiveIntensity: 1.0 }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = -0.25
    group.add(ring)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 1.8, 10, 1, true), beaconMat)
    beam.position.y = 0.75
    group.add(beam)
  }

  group.traverse((o) => { if (o.isMesh) o.castShadow = true })
  return group
}

class Pickup {
  constructor(type, x, z, isLoot = false, options = {}) {
    const { floatY } = options
    this.type = type
    this.active = true
    this.phase = Math.random() * Math.PI * 2
    this.isLoot = isLoot
    this.spawnedAt = performance.now()
    this.baseY = floatY ?? (isLoot ? 0.5 : 1.1)

    this.group = new THREE.Group()
    this.group.position.set(x, this.baseY, z)
    this.visual = buildVisual(type)
    if (isLoot) this.visual.scale.setScalar(0.7)
    this.group.add(this.visual)
  }

  update(dt, elapsed) {
    if (!this.active) return
    this.visual.rotation.y += dt * 1.4
    this.group.position.y = this.baseY + Math.sin(elapsed * 2 + this.phase) * 0.1
  }
}

function pickWeightedType() {
  const entries = Object.entries(TYPES)
  const total = entries.reduce((sum, [, t]) => sum + t.weight, 0)
  let roll = Math.random() * total
  for (const [id, t] of entries) {
    roll -= t.weight
    if (roll <= 0) return id
  }
  return entries[0][0]
}

export class PickupManager {
  // Everyday consumables (ammo/health/armor/etc.) no longer spawn randomly
  // around the street - they come from kills instead (see spawnKillDrop,
  // called every 10th kill from Game.js). spawnPoints is kept only for
  // spawnUnique()'s callers (the minigun, audio logs) which still place
  // fixed one-off pickups directly.
  constructor(scene, spawnPoints) {
    this.scene = scene
    this.spawnPoints = spawnPoints
    this.pickups = []
  }

  // One-off drop (e.g. zombie loot) that doesn't occupy a fixed street slot
  // and doesn't respawn once collected or expired.
  spawnLootDrop(type, x, z) {
    const pickup = new Pickup(type, x, z, true)
    this.pickups.push(pickup)
    this.scene.add(pickup.group)
  }

  // Guaranteed kill-drop (see Game.js's _onZombieKilled, every 10th kill) -
  // a random item from the same weighted pool that used to spawn around
  // the street, dropped at the kill location instead.
  spawnKillDrop(x, z) {
    this.spawnLootDrop(pickWeightedType(), x, z)
  }

  // A single fixed-location pickup (e.g. the minigun) that persists until
  // collected and never respawns or expires afterward.
  spawnUnique(type, x, z, y) {
    const pickup = new Pickup(type, x, z, false, { floatY: y })
    this.pickups.push(pickup)
    this.scene.add(pickup.group)
  }

  update(dt, elapsed, playerPos, handlers) {
    for (const pickup of this.pickups) {
      pickup.update(dt, elapsed)
      if (!pickup.active) continue

      const dist = Math.hypot(playerPos.x - pickup.group.position.x, playerPos.z - pickup.group.position.z)
      if (dist <= PICKUP_RADIUS) {
        this._collect(pickup, handlers)
      }
    }

    this.pickups = this.pickups.filter((p) => {
      if (!p.isLoot) return true
      if (performance.now() - p.spawnedAt > LOOT_EXPIRE_MS) {
        this.scene.remove(p.group)
        return false
      }
      return true
    })
  }

  _collect(pickup, handlers) {
    pickup.active = false
    this.scene.remove(pickup.group)
    this.pickups = this.pickups.filter((p) => p !== pickup)

    handlers.onPickup(pickup.type, TYPES[pickup.type].label, pickup.isLoot)
  }
}
