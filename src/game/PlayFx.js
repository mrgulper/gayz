// Special-gun effects out in the world during a run (2026-10-17, Gaymi:
// "the flamethrower should have flame when shooting, same with the grenade
// launcher and other special guns"). BuildSurvival.shoot() calls these:
//
//   explode(pos, radius)  Rocket / Grenade Launcher: a fireball that swells
//                         and fades, then smoke drifting up.
//   flameStream(from, dir, range)
//                         Flamethrower: a cone of fire rolling out from in
//                         front of you as far as the flames reach.
//   burn(zombie)          Flamethrower: flames licking up a burning zombie
//                         (called every frame while it burns).
//   voidHit(pos)          Void Ripper: a purple implosion where it hits.
//
// One small pool of sprites in the block world's scene, reused round-robin.
// Sprites only - never a THREE.Light (the block world has none, see the
// notes' traps), and nothing here touches localStorage.
import * as THREE from 'three'

const POOL = 140

function canvasTexture(draw) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  draw(c.getContext('2d'))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function blobTexture(stops) {
  return canvasTexture((g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    for (const [at, color] of stops) grad.addColorStop(at, color)
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
  })
}

let textures = null
function getTextures() {
  if (textures) return textures
  textures = {
    fire: blobTexture([[0, 'rgba(255,250,210,1)'], [0.3, 'rgba(255,190,70,0.95)'], [0.65, 'rgba(240,90,20,0.6)'], [1, 'rgba(180,30,0,0)']]),
    smoke: blobTexture([[0, 'rgba(70,66,62,0.75)'], [1, 'rgba(70,66,62,0)']]),
    void: blobTexture([[0, 'rgba(240,210,255,1)'], [0.35, 'rgba(170,80,255,0.85)'], [1, 'rgba(60,0,120,0)']]),
  }
  return textures
}

export class PlayFx {
  constructor(scene, blockSize) {
    this.scene = scene
    this.B = blockSize
    this._sprites = []
    this._next = 0
    const tex = getTextures()
    for (let i = 0; i < POOL; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.fire, depthWrite: false, transparent: true, opacity: 0 }))
      s.visible = false
      s.renderOrder = 5
      s.userData = { t: 0, life: 0, from: 0, to: 0, alpha: 1, vel: new THREE.Vector3(), spin: 0 }
      scene.add(s)
      this._sprites.push(s)
    }
  }

  // One particle: kind picks the picture, size grows from `from` to `to`
  // (block units) over `life` seconds while it fades out.
  _emit(kind, x, y, z, { life, from, to, alpha = 1, vel = null, delay = 0 }) {
    const s = this._sprites[this._next]
    this._next = (this._next + 1) % POOL
    const d = s.userData
    const tex = getTextures()
    const add = kind !== 'smoke'
    s.material.map = tex[kind]
    if (s.material.blending !== (add ? THREE.AdditiveBlending : THREE.NormalBlending)) {
      s.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending
      s.material.needsUpdate = true
    }
    s.material.rotation = Math.random() * Math.PI * 2
    s.material.opacity = 0
    s.position.set(x, y, z)
    s.scale.setScalar(from * this.B)
    s.visible = false
    d.t = -delay
    d.life = life
    d.from = from
    d.to = to
    d.alpha = alpha
    d.spin = (Math.random() - 0.5) * 2
    if (vel) d.vel.copy(vel)
    else d.vel.set(0, 0, 0)
  }

  explode(pos, radius) {
    const B = this.B
    const r = Math.max(1, radius)
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2
      const off = (i === 0 ? 0 : 0.35 + Math.random() * 0.4) * r * B
      this._emit('fire', pos.x + Math.cos(a) * off, pos.y + (Math.random() - 0.3) * r * 0.5 * B, pos.z + Math.sin(a) * off, {
        life: 0.35 + Math.random() * 0.2, from: r * 0.4, to: r * (i === 0 ? 1.6 : 1.1), delay: i * 0.015,
      })
    }
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, 1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8).multiplyScalar(B)
      this._emit('smoke', pos.x + (Math.random() - 0.5) * r * B, pos.y, pos.z + (Math.random() - 0.5) * r * B, {
        life: 1.1 + Math.random() * 0.5, from: r * 0.5, to: r * 1.5, alpha: 0.7, vel: v, delay: 0.12 + i * 0.03,
      })
    }
  }

  // from/dir: world position and unit direction of the shot (the camera's
  // aim); range in blocks. Called once per Flamethrower shot.
  flameStream(from, dir, range) {
    const B = this.B
    const life = 0.4
    for (let i = 0; i < 3; i++) {
      const speed = (range / life) * (0.75 + Math.random() * 0.35) * B
      const v = new THREE.Vector3(
        dir.x + (Math.random() - 0.5) * 0.12,
        dir.y + (Math.random() - 0.2) * 0.12,
        dir.z + (Math.random() - 0.5) * 0.12,
      ).normalize().multiplyScalar(speed)
      this._emit('fire', from.x, from.y, from.z, { life, from: 0.25, to: 1.5, vel: v, delay: i * 0.02 })
    }
  }

  // z: a zombie (block units: x, y = feet, z), height in blocks.
  burn(z, height) {
    const B = this.B
    for (let i = 0; i < 2; i++) {
      if (Math.random() > 0.7) continue
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6 + Math.random(), (Math.random() - 0.5) * 0.4).multiplyScalar(B)
      this._emit('fire', (z.x + (Math.random() - 0.5) * 0.7) * B, (z.y + 0.2 + Math.random() * height * 0.75) * B, (z.z + (Math.random() - 0.5) * 0.7) * B, {
        life: 0.4 + Math.random() * 0.25, from: 0.75, to: 0.25, vel: v,
      })
    }
  }

  voidHit(pos) {
    for (let i = 0; i < 4; i++) {
      this._emit('void', pos.x, pos.y, pos.z, { life: 0.4 + i * 0.06, from: 1.5 - i * 0.2, to: 0.1, delay: i * 0.04 })
    }
  }

  update(dt) {
    for (const s of this._sprites) {
      const d = s.userData
      if (d.t >= d.life) continue
      d.t += dt
      if (d.t < 0) continue
      const k = d.t / d.life
      if (k >= 1) {
        s.visible = false
        continue
      }
      s.visible = true
      s.position.addScaledVector(d.vel, dt)
      s.scale.setScalar((d.from + (d.to - d.from) * Math.sqrt(k)) * this.B)
      s.material.rotation += d.spin * dt
      s.material.opacity = d.alpha * Math.min(1, k * 10) * (1 - k)
    }
  }

  clear() {
    for (const s of this._sprites) {
      s.userData.t = s.userData.life
      s.visible = false
    }
  }

  dispose() {
    for (const s of this._sprites) {
      this.scene.remove(s)
      s.material.dispose()
    }
    this._sprites = []
  }
}
