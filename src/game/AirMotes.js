// Dust and pollen floating in the air round you (2026-10-26, Gaymi: "make
// the realistic more realistic", picked plants & air among the rest). On
// the In Real Life graphics level (GraphicsLevels `motes`, 0..1) a few
// hundred tiny specks drift slowly through the air near you and catch the
// sunlight, like dust in a sunbeam. Gone at night and in rain, snow or fog
// (BuildSky clearness), so they never fight the weather.
//
// Cheap on purpose: one THREE.Points that follows you; each speck wraps
// round inside a box about you, so none are ever made or thrown away.
import * as THREE from 'three'

const COUNT = 360
const BOX = 18 // blocks across the box of air round you

function moteTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255, 250, 235, 1)')
  grad.addColorStop(0.35, 'rgba(255, 245, 225, 0.55)')
  grad.addColorStop(1, 'rgba(255, 240, 220, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  return new THREE.CanvasTexture(c)
}

export class AirMotes {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.amount = 0
    this._t = 0
    const pos = new Float32Array(COUNT * 3)
    this._seed = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT * 3; i++) {
      this._seed[i] = Math.random()
      pos[i] = 0
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.mat = new THREE.PointsMaterial({
      map: moteTexture(),
      size: 0.09 * blockSize,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(geo, this.mat)
    this.points.frustumCulled = false
    this.points.visible = false
    buildMode.scene.add(this.points)
  }

  // 0 = none (every level but In Real Life).
  setAmount(a) {
    this.amount = a
  }

  update(dt) {
    const bm = this.bm
    const sky = bm.sky
    const day = 1 - (sky?.nightAmount?.() ?? 0)
    const clear = sky?.clearness ?? 1
    const strength = this.amount * Math.max(0, day * 1.4 - 0.4) * clear
    this.points.visible = strength > 0.01 && bm.active !== false
    if (!this.points.visible) return
    this.mat.opacity = 0.55 * strength
    this._t += dt
    const t = this._t
    const B = this.B
    const span = BOX * B
    const c = bm.camera.position
    const pos = this.points.geometry.attributes.position.array
    const s = this._seed
    // Each speck drifts on its own slow wobble plus a gentle breeze, and
    // its place is wrapped into the box round the camera.
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3
      const x = s[k] * span + t * 0.18 * B + Math.sin(t * 0.3 + s[k + 1] * 20) * 0.6 * B
      const y = s[k + 1] * span * 0.6 + Math.sin(t * 0.25 + s[k + 2] * 30) * 0.5 * B
      const z = s[k + 2] * span + t * 0.07 * B + Math.cos(t * 0.27 + s[k] * 25) * 0.6 * B
      pos[k] = c.x + (((x - c.x) % span) + span) % span - span / 2
      pos[k + 1] = c.y + (((y - c.y) % (span * 0.6)) + span * 0.6) % (span * 0.6) - span * 0.3
      pos[k + 2] = c.z + (((z - c.z) % span) + span) % span - span / 2
    }
    this.points.geometry.attributes.position.needsUpdate = true
  }
}
