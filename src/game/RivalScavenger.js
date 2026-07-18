import * as THREE from 'three'
import { audioEngine } from './Audio.js'

// A small human squad that races the player to a landed airdrop (see
// Game.js's _spawnAirdrop) - not zombies, so they don't touch any of the
// zombie-specific systems (bestiary, kill stats, achievements). If a member
// reaches the airdrop before the player does, the squad claims it and the
// player gets nothing; if the player gets close first, every member still
// alive stops and fights instead.
const MOVE_SPEED = 3.2
const ENGAGE_RANGE = 16
const FIRE_INTERVAL_MS = 1500
const DAMAGE_MIN = 8
const DAMAGE_MAX = 16
const MAX_HEALTH = 90
const TRACER_MS = 120
const CLAIM_RADIUS = 1.6

class RivalScavenger {
  constructor(scene, x, z, targetX, targetZ) {
    this.scene = scene
    this.health = MAX_HEALTH
    this.maxHealth = MAX_HEALTH
    this.state = 'alive'
    this.targetX = targetX
    this.targetZ = targetZ
    this.nextFireAt = 0
    this.tracers = []

    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this._buildBody()
    scene.add(this.group)
  }

  // Dark, hooded raider silhouette - deliberately not a Companion recolor
  // (jacket-only), so it reads as hostile at a glance rather than "friendly
  // NPC in the wrong color."
  _buildBody() {
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.85 })
    const maskMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff3b1e, emissiveIntensity: 1.2 })
    const weaponMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.4 })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.64, 0.3), gearMat)
    torso.position.y = 1.15
    torso.castShadow = true
    this.group.add(torso)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12), maskMat)
    head.position.y = 1.63
    head.castShadow = true
    this.group.add(head)

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat)
      eye.position.set(side * 0.06, 1.64, 0.15)
      this.group.add(eye)
    }

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.2), maskMat)
      leg.position.set(side * 0.13, 0.5, 0)
      leg.castShadow = true
      this.group.add(leg)

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.16), gearMat)
      arm.position.set(side * 0.32, 1.15, 0)
      arm.castShadow = true
      this.group.add(arm)
    }

    const weaponProp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.32), weaponMat)
    weaponProp.position.set(0.32, 0.9, 0.1)
    this.group.add(weaponProp)

    // Tagged for WeaponSystem's raycast (see its userData.rival check) -
    // torso and head only, matching the hit-area scope zombies use.
    torso.userData.rival = this
    head.userData.rival = this
    this.hittableMeshes = [torso, head]
  }

  onHit(damage) {
    if (this.state !== 'alive') return
    this.health -= damage
    if (this.health <= 0) {
      this.state = 'dead'
      this.group.visible = false
    }
  }

  // Returns true the frame this scavenger reaches the airdrop while still
  // alive - RivalManager.update turns that into "the squad claimed it."
  update(dt, playerPos, onAttack) {
    if (this.state !== 'alive') return false

    const dx = playerPos.x - this.group.position.x
    const dz = playerPos.z - this.group.position.z
    const distToPlayer = Math.hypot(dx, dz)

    if (distToPlayer <= ENGAGE_RANGE) {
      this.group.rotation.y = Math.atan2(dx, dz)
      if (performance.now() >= this.nextFireAt) {
        this.nextFireAt = performance.now() + FIRE_INTERVAL_MS + Math.random() * 400
        const damage = DAMAGE_MIN + Math.random() * (DAMAGE_MAX - DAMAGE_MIN)
        if (onAttack) onAttack(damage)
        this._spawnTracer(playerPos)
        audioEngine.playShot('pistol', true)
      }
    } else {
      const tx = this.targetX - this.group.position.x
      const tz = this.targetZ - this.group.position.z
      const distToTarget = Math.hypot(tx, tz)
      if (distToTarget > 0.001) {
        const nx = tx / distToTarget
        const nz = tz / distToTarget
        this.group.position.x += nx * MOVE_SPEED * dt
        this.group.position.z += nz * MOVE_SPEED * dt
        this.group.rotation.y = Math.atan2(nx, nz)
      }
    }

    this._updateTracers()

    const tx = this.targetX - this.group.position.x
    const tz = this.targetZ - this.group.position.z
    return Math.hypot(tx, tz) < CLAIM_RADIUS
  }

  _spawnTracer(targetPos) {
    const origin = this.group.position.clone()
    origin.y += 1.3
    const target = targetPos.clone()
    target.y += 0.9

    const geo = new THREE.BufferGeometry().setFromPoints([origin, target])
    const mat = new THREE.LineBasicMaterial({ color: 0xff8a5a, transparent: true, opacity: 0.9 })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this.tracers.push({ line, startedAt: performance.now() })
  }

  _updateTracers() {
    this.tracers = this.tracers.filter((tr) => {
      const age = performance.now() - tr.startedAt
      tr.line.material.opacity = 0.9 * (1 - age / TRACER_MS)
      if (age >= TRACER_MS) {
        this.scene.remove(tr.line)
        tr.line.geometry.dispose()
        return false
      }
      return true
    })
  }

  dispose() {
    this.scene.remove(this.group)
    for (const tr of this.tracers) this.scene.remove(tr.line)
  }
}

export class RivalManager {
  constructor(scene) {
    this.scene = scene
    this.squads = []
  }

  // One squad, positioned in a rough ring around the target so they
  // converge on it from several directions instead of one clump - see
  // Game.js's _spawnAirdrop, the only caller.
  spawnSquad(targetX, targetZ, count = 2) {
    const members = []
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = 18 + Math.random() * 6
      const x = targetX + Math.cos(angle) * dist
      const z = targetZ + Math.sin(angle) * dist
      members.push(new RivalScavenger(this.scene, x, z, targetX, targetZ))
    }
    this.squads.push({ members })
  }

  get hittableMeshes() {
    const meshes = []
    for (const squad of this.squads) {
      for (const m of squad.members) {
        if (m.state === 'alive') meshes.push(...m.hittableMeshes)
      }
    }
    return meshes
  }

  // Returns true if any live member of any squad reached its target this
  // tick - Game.js treats that as "the current airdrop just got claimed by
  // rivals" since there's only ever one airdrop active at a time.
  update(dt, playerPos, onAttack) {
    let claimed = false
    for (const squad of this.squads) {
      for (const m of squad.members) {
        if (m.update(dt, playerPos, onAttack)) claimed = true
      }
    }
    this.squads = this.squads.filter((squad) => {
      const allDead = squad.members.every((m) => m.state === 'dead')
      if (allDead) {
        for (const m of squad.members) m.dispose()
        return false
      }
      return true
    })
    return claimed
  }

  reset() {
    for (const squad of this.squads) {
      for (const m of squad.members) m.dispose()
    }
    this.squads = []
  }
}
