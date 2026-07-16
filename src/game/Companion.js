import * as THREE from 'three'
import { audioEngine } from './Audio.js'

const FOLLOW_DISTANCE = 3.2
const CATCH_UP_DISTANCE = 6
const MOVE_SPEED = 4.2
const CATCH_UP_SPEED_MULT = 1.8
const ENGAGE_RANGE = 13
const FIRE_INTERVAL = 1.3
const DAMAGE_MIN = 18
const DAMAGE_MAX = 30
const TRACER_MS = 120

// Follower survivor NPC: trails the player and auto-fires at the nearest
// alive zombie in range. Invulnerable by design - a "companion down" state
// (health, revival, HUD) would be a whole extra feature on top of this one.
export class Companion {
  constructor(scene, x, z) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this._buildBody()
    this._buildNameTag()
    scene.add(this.group)

    this.nextFireAt = 0
    this.tracers = []
  }

  // Floating name label above the head - same canvas-texture-sprite trick
  // Zombie.js uses for its health bars.
  _buildNameTag() {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 48
    this._nameCanvas = canvas
    this._nameCtx = canvas.getContext('2d')

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, fog: false })
    this._nameSprite = new THREE.Sprite(material)
    this._nameSprite.scale.set(0.7, 0.13, 1)
    this._nameSprite.position.set(0, 2.0, 0)
    this._nameSprite.renderOrder = 10
    this.group.add(this._nameSprite)

    this.setName('Assistant')
  }

  setName(name) {
    const ctx = this._nameCtx
    const canvas = this._nameCanvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, 10, canvas.width, canvas.height - 20)
    ctx.font = 'bold 26px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#5be3ff'
    ctx.fillText(name, canvas.width / 2, canvas.height / 2)
    this._nameSprite.material.map.needsUpdate = true
  }

  _buildBody() {
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x2f4f7a, roughness: 0.8 })
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

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), skinMat)
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
  }

  update(dt, playerPos, zombies) {
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

    if (performance.now() >= this.nextFireAt) {
      let nearest = null
      let nearestDist = ENGAGE_RANGE
      for (const z of zombies) {
        if (z.state !== 'alive') continue
        const d = Math.hypot(z.group.position.x - this.group.position.x, z.group.position.z - this.group.position.z)
        if (d < nearestDist) {
          nearest = z
          nearestDist = d
        }
      }
      if (nearest) {
        this.nextFireAt = performance.now() + FIRE_INTERVAL * 1000
        const damage = DAMAGE_MIN + Math.random() * (DAMAGE_MAX - DAMAGE_MIN)
        nearest.onHit(damage)
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

  teleportTo(x, z) {
    this.group.position.set(x, 0, z)
  }

  dispose() {
    this.scene.remove(this.group)
    for (const tr of this.tracers) this.scene.remove(tr.line)
  }
}
