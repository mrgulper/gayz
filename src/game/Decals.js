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

export class DecalManager {
  constructor(scene) {
    this.scene = scene
    this.decals = []
    this.puddles = []
  }

  spawn(point, normal, isBlood) {
    const size = isBlood ? 0.3 + Math.random() * 0.25 : 0.1 + Math.random() * 0.05
    const material = new THREE.MeshBasicMaterial({
      map: isBlood ? bloodTexture : holeTexture,
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
