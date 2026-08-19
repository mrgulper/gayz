import * as THREE from 'three'

const MAX_DECALS = 60

function buildDecalTexture(isBlood) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')

  if (isBlood) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = 6 + Math.random() * 14
      ctx.fillStyle = `rgba(90, 10, 10, ${0.55 + Math.random() * 0.3})`
      ctx.beginPath()
      ctx.ellipse(
        32 + Math.cos(angle) * r,
        32 + Math.sin(angle) * r,
        5 + Math.random() * 7,
        3 + Math.random() * 5,
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      )
      ctx.fill()
    }
  } else {
    ctx.fillStyle = 'rgba(60, 55, 48, 0.45)'
    ctx.beginPath()
    ctx.arc(32, 32, 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(18, 16, 14, 0.85)'
    ctx.beginPath()
    ctx.arc(32, 32, 9, 0, Math.PI * 2)
    ctx.fill()
  }

  return new THREE.CanvasTexture(canvas)
}

const bloodTexture = buildDecalTexture(true)
const holeTexture = buildDecalTexture(false)

// Bullet-hole decals share ONE unit-size geometry (scaled per-instance,
// same trick WeaponSystem.js's tracers already use) and ONE material
// across an InstancedMesh pool, instead of a brand new PlaneGeometry +
// MeshBasicMaterial per shot - these were never mutated per-instance after
// creation (no per-decal color/opacity), so sharing is safe (see this
// project's own "clone materials that get mutated at runtime" rule; a
// never-mutated material doesn't qualify). Blood splats below are
// deliberately left on the old per-mesh path, unchanged.
const HOLE_DECAL_GEOMETRY = new THREE.PlaneGeometry(1, 1)
const HOLE_DECAL_MATERIAL = new THREE.MeshBasicMaterial({
  map: holeTexture,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -4,
})

function buildPuddleTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  // One big irregular dark-red pool, distinct from bloodTexture's cluster
  // of small splat blobs above - this is meant to sit under a corpse, not
  // mark a bullet-impact point.
  for (let i = 0; i < 3; i++) {
    const angle = Math.random() * Math.PI * 2
    const r = Math.random() * 4
    ctx.fillStyle = `rgba(60, 8, 8, ${0.5 + Math.random() * 0.2})`
    ctx.beginPath()
    ctx.ellipse(32 + Math.cos(angle) * r, 32 + Math.sin(angle) * r, 22 + Math.random() * 6, 17 + Math.random() * 5, Math.random() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  return new THREE.CanvasTexture(canvas)
}
const puddleTexture = buildPuddleTexture()

// Flat, camera-facing-surface splats: blood on zombie hits, bullet holes on
// environment hits. Capped and recycled oldest-first so a long fight can't
// leak geometry.
const MAX_PUDDLES = 24

// Footprint decals (batch 4 feature) - a single shared shoe-print texture
// on an InstancedMesh, same "never mutated per-instance, so sharing across
// a ring buffer is safe" reasoning as HOLE_DECAL_GEOMETRY/MATERIAL above.
function buildFootprintTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(30, 26, 20, 0.5)'
  ctx.beginPath()
  ctx.ellipse(16, 20, 9, 14, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(16, 46, 7, 10, 0, 0, Math.PI * 2)
  ctx.fill()
  return new THREE.CanvasTexture(canvas)
}
const footprintTexture = buildFootprintTexture()
const FOOTPRINT_GEOMETRY = new THREE.PlaneGeometry(0.14, 0.28)
const FOOTPRINT_MATERIAL = new THREE.MeshBasicMaterial({
  map: footprintTexture,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
})
const MAX_FOOTPRINTS = 50
const FOOTPRINT_UP = new THREE.Vector3(0, 1, 0)

export class DecalManager {
  constructor(scene) {
    this.scene = scene
    this.decals = []
    this.puddles = []

    // Bullet-hole instanced pool (see HOLE_DECAL_GEOMETRY/MATERIAL's own
    // comment) - a ring buffer over a fixed MAX_DECALS capacity, so a new
    // hole past the cap overwrites the oldest instance slot's transform
    // instead of allocating anything or disposing anything.
    this.holeMesh = new THREE.InstancedMesh(HOLE_DECAL_GEOMETRY, HOLE_DECAL_MATERIAL, MAX_DECALS)
    this.holeMesh.count = 0
    // Instance transforms span wherever bullets land across the whole map -
    // three.js can't cheaply keep an accurate per-instance bounding volume
    // for that automatically, so this one mesh skips frustum culling
    // rather than risk holes popping in/out incorrectly near screen edges.
    this.holeMesh.frustumCulled = false
    this.scene.add(this.holeMesh)
    this._holeNextIndex = 0
    this._holeObj = new THREE.Object3D()

    // Footprint instanced pool (see FOOTPRINT_GEOMETRY/MATERIAL's own
    // comment) - same ring-buffer-over-a-fixed-capacity shape as the bullet
    // hole pool above.
    this.footprintMesh = new THREE.InstancedMesh(FOOTPRINT_GEOMETRY, FOOTPRINT_MATERIAL, MAX_FOOTPRINTS)
    this.footprintMesh.count = 0
    this.footprintMesh.frustumCulled = false
    this.scene.add(this.footprintMesh)
    this._footprintNextIndex = 0
    this._footprintObj = new THREE.Object3D()
  }

  // dirX/dirZ: normalized ground-plane travel direction, used to both
  // rotate the print to face the way the player was walking and to offset
  // it sideways (perpendicular to travel) so left/right prints don't stack
  // on the same spot - isLeft alternates which side each call lands on.
  spawnFootprint(x, z, dirX, dirZ, isLeft) {
    const len = Math.hypot(dirX, dirZ)
    const fx = len > 0.0001 ? dirX / len : 0
    const fz = len > 0.0001 ? dirZ / len : 1
    const perpX = -fz
    const perpZ = fx
    const side = isLeft ? -1 : 1
    const offset = 0.13
    // Same lookAt(normal)-then-rotateZ(yaw) technique as _spawnHole above -
    // lookAt lays the plane flat facing up, then rotateZ spins it around
    // that now-vertical local Z axis, which is exactly what "which way is
    // this print pointing" means for a decal lying on the ground.
    this._footprintObj.position.set(x + perpX * offset * side, 0.015, z + perpZ * offset * side)
    this._footprintObj.lookAt(this._footprintObj.position.clone().add(FOOTPRINT_UP))
    this._footprintObj.rotateZ(Math.atan2(fx, fz))
    this._footprintObj.updateMatrix()
    this.footprintMesh.setMatrixAt(this._footprintNextIndex, this._footprintObj.matrix)
    this.footprintMesh.instanceMatrix.needsUpdate = true
    this._footprintNextIndex = (this._footprintNextIndex + 1) % MAX_FOOTPRINTS
    this.footprintMesh.count = Math.min(MAX_FOOTPRINTS, this.footprintMesh.count + 1)
  }

  // caliberScale (batch 7 feature) - a shotgun blast/heavy melee hit should
  // visibly do more than a pistol tap on the same target (see Game.js's own
  // caller comment for how it's derived). Defaults to 1 for callers that
  // don't pass one, same size as before this feature existed.
  spawn(point, normal, isBlood, caliberScale = 1) {
    if (!isBlood) {
      this._spawnHole(point, normal)
      return
    }
    const size = (0.3 + Math.random() * 0.25) * caliberScale
    const material = new THREE.MeshBasicMaterial({
      map: bloodTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
    mesh.position.copy(point).addScaledVector(normal, 0.01)
    mesh.lookAt(mesh.position.clone().add(normal))
    mesh.rotation.z = Math.random() * Math.PI * 2
    this.scene.add(mesh)
    this.decals.push(mesh)

    if (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift()
      this.scene.remove(old)
      old.material.dispose()
      old.geometry.dispose()
    }
  }

  _spawnHole(point, normal) {
    const size = 0.1 + Math.random() * 0.05
    this._holeObj.position.copy(point).addScaledVector(normal, 0.01)
    this._holeObj.lookAt(this._holeObj.position.clone().add(normal))
    this._holeObj.rotateZ(Math.random() * Math.PI * 2)
    this._holeObj.scale.setScalar(size)
    this._holeObj.updateMatrix()
    this.holeMesh.setMatrixAt(this._holeNextIndex, this._holeObj.matrix)
    this.holeMesh.instanceMatrix.needsUpdate = true
    this._holeNextIndex = (this._holeNextIndex + 1) % MAX_DECALS
    this.holeMesh.count = Math.min(MAX_DECALS, this.holeMesh.count + 1)
  }

  // Corpse-puddle ground decal - own pool/cap (see MAX_PUDDLES), separate
  // from the hit-splat decals above's MAX_DECALS, so a long fight's bullet
  // holes/blood splats can't evict the (much rarer, longer-meaningful)
  // marks of where zombies actually died.
  spawnPuddle(x, z) {
    const size = 1.1 + Math.random() * 0.6
    const material = new THREE.MeshBasicMaterial({
      map: puddleTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
    mesh.position.set(x, 0.02, z)
    mesh.rotation.x = -Math.PI / 2
    mesh.rotation.z = Math.random() * Math.PI * 2
    this.scene.add(mesh)
    this.puddles.push(mesh)

    if (this.puddles.length > MAX_PUDDLES) {
      const old = this.puddles.shift()
      this.scene.remove(old)
      old.material.dispose()
      old.geometry.dispose()
    }
  }
}
