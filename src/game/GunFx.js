// Muzzle flash and smoke on the gun you hold in first person (2026-10-17,
// Gaymi: "make more like kirka with that smoke when shooting"). Lives in
// BuildTryMode's own gun scene (drawn on top of the world), so it costs a
// handful of sprites and never touches the block world's lights.
//
// - The flash is a bright star sprite plus a warm light, both children of
//   the gun group so they ride the kick; they show for FLASH_LIFE seconds.
//   The light is added once and only its intensity changes (never added,
//   removed or toggled at runtime - see CLAUDE.md's traps).
// - Smoke is a small pool of soft grey puffs left where the muzzle was
//   (in the gun scene, not on the gun), so the gun kicks back out of them
//   while they drift up, grow and fade. Fainter while aiming so they never
//   cover the sights.
import * as THREE from 'three'

const FLASH_LIFE = 0.05
const FLASH_SIZE = 0.16
const SMOKE_MAX = 18
const SMOKE_LIFE = 0.8
const SMOKE_START = 0.05
const SMOKE_END = 0.4
const SMOKE_ALPHA = 0.6
const SMOKE_ALPHA_AIMING = 0.18
const LIGHT_POWER = 2.2

function canvasTexture(draw) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  draw(c.getContext('2d'))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// A four-pointed star with a hot middle.
function flashTexture() {
  return canvasTexture((g) => {
    const glow = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    glow.addColorStop(0, 'rgba(255,255,235,1)')
    glow.addColorStop(0.25, 'rgba(255,214,120,0.9)')
    glow.addColorStop(1, 'rgba(255,140,40,0)')
    g.fillStyle = glow
    g.fillRect(0, 0, 64, 64)
    g.globalCompositeOperation = 'lighter'
    g.fillStyle = 'rgba(255,230,160,0.85)'
    for (const [w, h] of [[6, 64], [64, 6]]) {
      g.beginPath()
      g.ellipse(32, 32, w / 2, h / 2, 0, 0, Math.PI * 2)
      g.fill()
    }
  })
}

// A soft, slightly lumpy puff.
function smokeTexture() {
  return canvasTexture((g) => {
    for (const [x, y, r] of [[32, 32, 28], [24, 28, 16], [40, 30, 15], [30, 40, 15]]) {
      const puff = g.createRadialGradient(x, y, 0, x, y, r)
      puff.addColorStop(0, 'rgba(185,185,188,0.8)')
      puff.addColorStop(1, 'rgba(185,185,188,0)')
      g.fillStyle = puff
      g.fillRect(0, 0, 64, 64)
    }
  })
}

export class GunFx {
  constructor(scene) {
    this.scene = scene
    this._flashT = 0
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }))
    this.flash.visible = false
    this.light = new THREE.PointLight(0xffb060, 0, 1.2, 2)
    const smokeMap = smokeTexture()
    this._smoke = []
    for (let i = 0; i < SMOKE_MAX; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeMap, depthWrite: false, transparent: true, opacity: 0 }))
      s.visible = false
      s.userData = { t: SMOKE_LIFE, vel: new THREE.Vector3(), spin: 0, alpha: SMOKE_ALPHA }
      scene.add(s)
      this._smoke.push(s)
    }
    this._next = 0
    this._world = new THREE.Vector3()
  }

  // One shot: `gun` is the held gun's group, `muzzle` its barrel tip in
  // that group's space.
  fire(gun, muzzle, aiming) {
    if (!gun || !muzzle) return
    for (const o of [this.flash, this.light]) if (o.parent !== gun) gun.add(o)
    this.flash.position.copy(muzzle).z -= 0.03
    this.light.position.copy(muzzle)
    this.flash.material.rotation = Math.random() * Math.PI
    this.flash.scale.setScalar(FLASH_SIZE * (0.8 + Math.random() * 0.45) * (aiming ? 0.7 : 1))
    this.flash.visible = true
    this._flashT = FLASH_LIFE
    gun.updateMatrixWorld(true)
    gun.localToWorld(this._world.copy(muzzle))
    for (let i = 0; i < 2; i++) {
      const s = this._smoke[this._next]
      this._next = (this._next + 1) % SMOKE_MAX
      const d = s.userData
      s.position.copy(this._world)
      d.t = -i * 0.04
      d.vel.set((Math.random() - 0.5) * 0.05, 0.05 + Math.random() * 0.04, -0.03 - Math.random() * 0.04)
      d.spin = (Math.random() - 0.5) * 1.5
      d.alpha = aiming ? SMOKE_ALPHA_AIMING : SMOKE_ALPHA
      s.material.rotation = Math.random() * Math.PI * 2
      s.material.opacity = 0
      s.scale.setScalar(SMOKE_START)
      s.visible = false
    }
  }

  update(dt) {
    if (this._flashT > 0) {
      this._flashT -= dt
      const on = this._flashT > 0
      this.flash.visible = on
      this.light.intensity = on ? LIGHT_POWER * (this._flashT / FLASH_LIFE) : 0
    }
    for (const s of this._smoke) {
      const d = s.userData
      if (d.t >= SMOKE_LIFE) continue
      d.t += dt
      if (d.t < 0) continue
      const k = Math.min(1, d.t / SMOKE_LIFE)
      if (k >= 1) {
        s.visible = false
        continue
      }
      s.visible = true
      s.position.addScaledVector(d.vel, dt)
      d.vel.multiplyScalar(Math.max(0, 1 - dt * 1.5))
      s.scale.setScalar(SMOKE_START + (SMOKE_END - SMOKE_START) * Math.sqrt(k))
      s.material.rotation += d.spin * dt
      // Quick to appear, slow to fade.
      s.material.opacity = d.alpha * Math.min(1, k * 8) * Math.pow(1 - k, 1.3)
    }
  }

  // Leaving Try/Play: nothing left hanging in the air next time.
  clear() {
    this._flashT = 0
    this.flash.visible = false
    this.light.intensity = 0
    for (const s of this._smoke) {
      s.userData.t = SMOKE_LIFE
      s.visible = false
    }
  }
}
