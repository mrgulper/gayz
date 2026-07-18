import * as THREE from 'three'
import { audioEngine } from './Audio.js'

const FOLLOW_DISTANCE = 3.2
const CATCH_UP_DISTANCE = 6
const MOVE_SPEED = 4.2
const CATCH_UP_SPEED_MULT = 1.8
const TRACER_MS = 120

// Downed state (vulnerable companions only, see the constructor's
// `vulnerable` option): being swarmed drains health over time rather than
// a single hit killing outright, since there's no per-zombie "companion
// attack" animation to hang a direct hit off of - any alive zombie standing
// this close is treated as chipping away at the companion each tick instead.
const COMPANION_MAX_HEALTH = 100
const SWARM_RADIUS = 2.0
const SWARM_TICK_MS = 700
const SWARM_DAMAGE_PER_ZOMBIE = 5
const DOWNED_BLEED_OUT_MS = 30000
const REVIVE_HEALTH_FRACTION = 0.5
const REVIVE_RADIUS = 2.2

// Role stat blocks - 'ranged' hangs back and shoots, 'melee' charges in and
// swings. Chosen once on the main menu (see Game.js's companionRole setting).
const ROLE_STATS = {
  ranged: { engageRange: 13, meleeRange: 0, fireInterval: 1.3, damageMin: 18, damageMax: 30, jacket: 0x2f4f7a },
  melee: { engageRange: 2.4, meleeRange: 2.2, fireInterval: 0.9, damageMin: 26, damageMax: 42, jacket: 0x7a2f2f },
  medic: { engageRange: 0, meleeRange: 0, fireInterval: 5, damageMin: 0, damageMax: 0, jacket: 0x2f7a4f, healAmount: 15 },
}
const MEDIC_FOLLOW_DISTANCE = 2.2

// Follower survivor NPC: trails the player and auto-fights the nearest alive
// zombie in range. Static NPCs built from this same class (safe zone guards,
// the trader/ammo guide NPCs) pass `vulnerable: false` to keep their
// original invulnerable behavior - only the player's real companion(s)
// (this.companion / this.tempCompanion in Game.js) go down and need reviving.
export class Companion {
  constructor(scene, x, z, role = 'ranged', { vulnerable = true } = {}) {
    this.scene = scene
    this.role = ROLE_STATS[role] ? role : 'ranged'
    // Cloned rather than the shared preset directly - applyTraining below
    // mutates this per-instance, and mutating the shared ROLE_STATS object
    // would leak training bonuses into every future companion/preview.
    this.stats = { ...ROLE_STATS[this.role] }
    this.trainingLevel = 0
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this._buildBody()
    this._buildNameTag()
    scene.add(this.group)

    this.nextFireAt = 0
    this.tracers = []

    this.vulnerable = vulnerable
    this.health = COMPANION_MAX_HEALTH
    this.downed = false
    this.dead = false
    this.justWentDown = false
    this.justDied = false
    this.downedAt = 0
    this.nextSwarmTickAt = 0
  }

  // Points-purchased training (see Game.js's "Train Companion" trader item) -
  // recomputed from the untouched ROLE_STATS preset each time rather than
  // stacking onto whatever this.stats currently holds, so repeated calls
  // (e.g. after a role swap rebuilds the companion) stay predictable instead
  // of compounding.
  applyTraining(level) {
    this.trainingLevel = level
    const base = ROLE_STATS[this.role]
    const mult = 1 + level * 0.15
    this.stats.damageMin = base.damageMin * mult
    this.stats.damageMax = base.damageMax * mult
    if (base.healAmount) this.stats.healAmount = base.healAmount * mult
  }

  // Floating name label above the head - same canvas-texture-sprite trick
  // Zombie.js uses for its health bars.
  _buildNameTag() {
    const canvas = document.createElement('canvas')
    canvas.width = 384
    canvas.height = 48
    this._nameCanvas = canvas
    this._nameCtx = canvas.getContext('2d')

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, fog: false })
    this._nameSprite = new THREE.Sprite(material)
    this._nameSprite.scale.set(1.05, 0.13, 1)
    this._nameSprite.position.set(0, 2.0, 0)
    this._nameSprite.renderOrder = 10
    this.group.add(this._nameSprite)

    this.setName('Assistant')
  }

  // Shrinks the font until the name actually fits the canvas - a long
  // nickname ("Survivor48213 Assistant") was previously getting clipped off
  // both edges because the font size was fixed regardless of text length.
  setName(name) {
    this._displayName = name
    this._renderTag(name, '#5be3ff')
  }

  // Temporarily overwrites the name tag with a "DOWNED" callout without
  // losing the real name - _restoreNameTag() puts it back on revive.
  _showDownedTag() {
    this._renderTag('DOWNED - Press F', '#ff4a3a')
  }

  _restoreNameTag() {
    this._renderTag(this._displayName, '#5be3ff')
  }

  _renderTag(text, color) {
    const ctx = this._nameCtx
    const canvas = this._nameCanvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, 10, canvas.width, canvas.height - 20)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color

    const maxWidth = canvas.width - 16
    let fontSize = 26
    ctx.font = `bold ${fontSize}px sans-serif`
    while (ctx.measureText(text).width > maxWidth && fontSize > 12) {
      fontSize -= 1
      ctx.font = `bold ${fontSize}px sans-serif`
    }
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    this._nameSprite.material.map.needsUpdate = true
  }

  _buildBody() {
    const jacketMat = new THREE.MeshStandardMaterial({ color: this.stats.jacket, roughness: 0.8 })
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8ab7d, roughness: 0.9 })
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.9 })
    const packMat = new THREE.MeshStandardMaterial({ color: 0x3a3428, roughness: 0.85 })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.28), jacketMat)
    torso.position.y = 1.15
    torso.castShadow = true
    this.group.add(torso)

    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.16), packMat)
    pack.position.set(0, 1.18, -0.2)
    pack.castShadow = true
    this.group.add(pack)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), skinMat)
    head.position.y = 1.62
    head.castShadow = true
    this.group.add(head)

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.2), pantsMat)
      leg.position.set(side * 0.13, 0.5, 0)
      leg.castShadow = true
      this.group.add(leg)

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.16), jacketMat)
      arm.position.set(side * 0.32, 1.15, 0)
      arm.castShadow = true
      this.group.add(arm)
    }

    // Role-distinct weapon prop in the right hand, so the two loadouts read
    // apart at a glance even before either one attacks.
    let weaponMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.4 })
    if (this.role === 'medic') {
      weaponMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 })
      this.weaponProp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.06), weaponMat)
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xd6402f, emissive: 0xd6402f, emissiveIntensity: 0.5 })
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.01), crossMat)
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.01), crossMat)
      crossH.position.z = 0.035
      crossV.position.z = 0.035
      this.weaponProp.add(crossH, crossV)
    } else if (this.role === 'melee') {
      this.weaponProp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.55, 12), weaponMat)
    } else {
      this.weaponProp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.28), weaponMat)
    }
    this.weaponProp.position.set(0.32, 0.9, 0.1)
    this.weaponProp.rotation.x = this.role === 'melee' ? Math.PI / 2.4 : 0
    this.weaponProp.castShadow = true
    this.group.add(this.weaponProp)
  }

  update(dt, playerPos, zombies, onHeal) {
    if (this.dead) return
    if (this.downed) {
      if (!this.dead && performance.now() - this.downedAt > DOWNED_BLEED_OUT_MS) {
        this.dead = true
        this.justDied = true
      }
      return
    }
    if (this.vulnerable) this._updateSwarmDamage(zombies)
    if (this.downed) return // just went down above - skip this frame's follow/attack

    if (this.role === 'medic') {
      const dx = playerPos.x - this.group.position.x
      const dz = playerPos.z - this.group.position.z
      const dist = Math.hypot(dx, dz)
      if (dist > MEDIC_FOLLOW_DISTANCE) {
        const nx = dx / dist
        const nz = dz / dist
        const speed = dist > CATCH_UP_DISTANCE ? MOVE_SPEED * CATCH_UP_SPEED_MULT : MOVE_SPEED
        this.group.position.x += nx * speed * dt
        this.group.position.z += nz * speed * dt
        this.group.rotation.y = Math.atan2(nx, nz)
      }
      if (performance.now() >= this.nextFireAt) {
        this.nextFireAt = performance.now() + this.stats.fireInterval * 1000
        if (onHeal) onHeal(this.stats.healAmount)
      }
      return
    }

    let nearest = null
    let nearestDist = this.stats.engageRange
    for (const z of zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - this.group.position.x, z.group.position.z - this.group.position.z)
      if (d < nearestDist) {
        nearest = z
        nearestDist = d
      }
    }

    const chasing = this.role === 'melee' && nearest && nearestDist > this.stats.meleeRange
    if (chasing) {
      const dx = nearest.group.position.x - this.group.position.x
      const dz = nearest.group.position.z - this.group.position.z
      const dist = Math.hypot(dx, dz)
      const nx = dist > 0.0001 ? dx / dist : 0
      const nz = dist > 0.0001 ? dz / dist : 1
      this.group.position.x += nx * MOVE_SPEED * CATCH_UP_SPEED_MULT * dt
      this.group.position.z += nz * MOVE_SPEED * CATCH_UP_SPEED_MULT * dt
      this.group.rotation.y = Math.atan2(nx, nz)
    } else {
      const dx = playerPos.x - this.group.position.x
      const dz = playerPos.z - this.group.position.z
      const dist = Math.hypot(dx, dz)
      if (dist > FOLLOW_DISTANCE) {
        const nx = dx / dist
        const nz = dz / dist
        const speed = dist > CATCH_UP_DISTANCE ? MOVE_SPEED * CATCH_UP_SPEED_MULT : MOVE_SPEED
        this.group.position.x += nx * speed * dt
        this.group.position.z += nz * speed * dt
        this.group.rotation.y = Math.atan2(nx, nz)
      }
    }

    const attackRange = this.role === 'melee' ? this.stats.meleeRange : this.stats.engageRange
    if (nearest && nearestDist <= attackRange && performance.now() >= this.nextFireAt) {
      this.nextFireAt = performance.now() + this.stats.fireInterval * 1000
      const damage = this.stats.damageMin + Math.random() * (this.stats.damageMax - this.stats.damageMin)
      nearest.onHit(damage)
      if (this.role === 'melee') {
        audioEngine.playMelee()
      } else {
        this._spawnTracer(nearest.group.position)
        audioEngine.playShot('pistol')
      }
    }

    this._updateTracers()
  }

  _spawnTracer(targetPos) {
    const origin = this.group.position.clone()
    origin.y += 1.3
    const target = targetPos.clone()
    target.y += 0.9

    const geo = new THREE.BufferGeometry().setFromPoints([origin, target])
    const mat = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.9 })
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

  // Any alive zombie standing this close chips away at health every
  // SWARM_TICK_MS, scaled by how many are crowding in at once - the
  // companion's stand-in for "actually being attacked" since zombies never
  // target it directly (see ZombieManager/Zombie.js, which only ever aim at
  // the player).
  _updateSwarmDamage(zombies) {
    let nearbyCount = 0
    for (const z of zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - this.group.position.x, z.group.position.z - this.group.position.z)
      if (d <= SWARM_RADIUS) nearbyCount++
    }
    if (nearbyCount === 0) return
    if (performance.now() < this.nextSwarmTickAt) return
    this.nextSwarmTickAt = performance.now() + SWARM_TICK_MS
    this.health -= SWARM_DAMAGE_PER_ZOMBIE * nearbyCount
    if (this.health <= 0) this._goDown()
  }

  _goDown() {
    this.downed = true
    this.downedAt = performance.now()
    this.justWentDown = true
    this.group.rotation.x = -Math.PI / 2
    this._showDownedTag()
  }

  // Called by Game.js when the player interacts with a downed companion in
  // range (see isNear) - restores partial health and stands them back up.
  // Bleeds out permanently (see update's DOWNED_BLEED_OUT_MS check) if this
  // never happens in time.
  revive() {
    if (!this.downed) return
    this.downed = false
    this.dead = false
    this.health = COMPANION_MAX_HEALTH * REVIVE_HEALTH_FRACTION
    this.nextSwarmTickAt = performance.now() + SWARM_TICK_MS
    this.group.rotation.x = 0
    this._restoreNameTag()
  }

  isNear(playerPos) {
    if (!this.downed) return false
    return Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z) <= REVIVE_RADIUS
  }

  // Full health/downed reset for a fresh run (see Game.js's restart path) -
  // unlike revive(), doesn't require currently being downed.
  resetVitals() {
    this.health = COMPANION_MAX_HEALTH
    this.downed = false
    this.dead = false
    this.justWentDown = false
    this.justDied = false
    this.nextSwarmTickAt = 0
    this.group.rotation.x = 0
    this._restoreNameTag()
  }

  teleportTo(x, z) {
    this.group.position.set(x, 0, z)
  }

  dispose() {
    this.scene.remove(this.group)
    for (const tr of this.tracers) this.scene.remove(tr.line)
  }
}
