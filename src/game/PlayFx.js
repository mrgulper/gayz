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
//   burnBlock(x, y, z)    A wooden block on fire (BuildSurvival's fires).
//
// Realistic fire (2026-10-17, Gaymi: "make the fire more realistic"):
// flames use a flickering tongue-of-fire picture (several, picked at
// random) instead of a round ball, and change colour as they live -
// white-yellow at the core, then orange, deep red and out - while they
// rise and wobble; dark smoke curls up from the top of every fire.
//
// One small pool of sprites in the block world's scene, reused round-robin.
// Sprites only - never a THREE.Light (the block world has none, see the
// notes' traps), and nothing here touches localStorage.
import * as THREE from 'three'

const POOL = 220

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

// A tongue of flame: a teardrop of soft white light (the colour comes
// from the sprite's tint, see FLAME_RAMP) with ragged licks on top.
// Seeded so every load draws the same few.
function flameTexture(seed) {
  let n = seed * 9301 + 49297
  const rnd = () => {
    n = (n * 9301 + 49297) % 233280
    return n / 233280
  }
  return canvasTexture((g) => {
    g.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 14; i++) {
      const k = i / 13
      const x = 32 + (rnd() - 0.5) * 18 * k
      const y = 50 - k * 38 - rnd() * 6
      const r = 15 * (1 - k * 0.75) + rnd() * 3
      const a = 0.28 + (1 - k) * 0.3
      const grad = g.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, `rgba(255,255,255,${a})`)
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 64)
    }
  })
}

// Flame colour over its life (k 0-1): white-hot, yellow, orange, red.
const FLAME_RAMP = [
  [0, 1, 0.9, 0.6],
  [0.2, 1, 0.82, 0.38],
  [0.5, 1, 0.45, 0.1],
  [0.8, 0.75, 0.15, 0.03],
  [1, 0.35, 0.05, 0.02],
]
function rampColor(color, k) {
  for (let i = 1; i < FLAME_RAMP.length; i++) {
    const [k1, r1, g1, b1] = FLAME_RAMP[i]
    if (k > k1) continue
    const [k0, r0, g0, b0] = FLAME_RAMP[i - 1]
    const f = (k - k0) / (k1 - k0 || 1)
    color.setRGB(r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f)
    return
  }
  color.setRGB(0.35, 0.05, 0.02)
}

let textures = null
function getTextures() {
  if (textures) return textures
  textures = {
    flames: [1, 2, 3, 4].map(flameTexture),
    fire: blobTexture([[0, 'rgba(255,250,210,1)'], [0.3, 'rgba(255,190,70,0.95)'], [0.65, 'rgba(240,90,20,0.6)'], [1, 'rgba(180,30,0,0)']]),
    smoke: blobTexture([[0, 'rgba(70,66,62,0.75)'], [1, 'rgba(70,66,62,0)']]),
    void: blobTexture([[0, 'rgba(240,210,255,1)'], [0.35, 'rgba(170,80,255,0.85)'], [1, 'rgba(60,0,120,0)']]),
    // White, tinted per particle (the special blocks' sparkles, SpecialBlocks.js).
    dot: blobTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]),
    // Explosions (2026-10-25): the first blinding flash, the shock wave's
    // ring and bits of dirt and rubble thrown out.
    flash: blobTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,245,200,0.9)'], [1, 'rgba(255,200,120,0)']]),
    ring: blobTexture([[0, 'rgba(255,255,255,0)'], [0.72, 'rgba(255,255,255,0)'], [0.86, 'rgba(255,240,220,0.5)'], [1, 'rgba(255,255,255,0)']]),
    debris: canvasTexture((g) => {
      g.fillStyle = '#2b2520'
      g.fillRect(18, 20, 28, 24)
      g.fillStyle = '#4a3f35'
      g.fillRect(22, 24, 12, 10)
    }),
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
      s.userData = { t: 0, life: 0, from: 0, to: 0, alpha: 1, vel: new THREE.Vector3(), spin: 0, flame: false, rise: 0, wob: 0 }
      scene.add(s)
      this._sprites.push(s)
    }
  }

  // One particle: kind picks the picture, size grows from `from` to `to`
  // (block units) over `life` seconds while it fades out.
  // kind 'flame' is a flickering tongue of fire tinted by FLAME_RAMP; it
  // rises by `rise` blocks a second and wobbles sideways.
  // `gravity` (blocks/s²) pulls non-flame particles down (debris).
  _emit(kind, x, y, z, { life, from, to, alpha = 1, vel = null, delay = 0, rise = 0, drag = 2.2, stretch = 1.35, wobble = 14, gravity = 0, color = null }) {
    const s = this._sprites[this._next]
    this._next = (this._next + 1) % POOL
    const d = s.userData
    const tex = getTextures()
    const add = kind !== 'smoke' && kind !== 'debris'
    d.flame = kind === 'flame'
    d.gravity = gravity * this.B
    d.solid = kind === 'debris'
    d.rise = rise * this.B
    d.wob = Math.random() * 10
    d.wobble = wobble
    d.drag = drag
    d.stretch = stretch
    s.material.map = d.flame ? tex.flames[Math.floor(Math.random() * tex.flames.length)] : tex[kind]
    if (color != null) s.material.color.setHex(color)
    else s.material.color.setRGB(1, 1, 1)
    if (s.material.blending !== (add ? THREE.AdditiveBlending : THREE.NormalBlending)) {
      s.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending
      s.material.needsUpdate = true
    }
    // Flames stand upright (a little tilt), everything else spins.
    s.material.rotation = d.flame ? (Math.random() - 0.5) * 0.5 : Math.random() * Math.PI * 2
    s.material.opacity = 0
    s.position.set(x, y, z)
    s.scale.setScalar(from * this.B)
    s.visible = false
    d.t = -delay
    d.life = life
    d.from = from
    d.to = to
    d.alpha = alpha
    d.spin = d.flame ? 0 : (Math.random() - 0.5) * 2
    if (vel) d.vel.copy(vel)
    else d.vel.set(0, 0, 0)
  }

  // Like a real blast (2026-10-25, Gaymi: "actually explodes like irl"):
  // a white flash, a shock-wave ring racing out, the fireball, rubble
  // flung up and falling back, then a big column of dark smoke.
  explode(pos, radius) {
    const B = this.B
    const r = Math.max(1, radius)
    // The ball of fire sits above the ground it hit, not half inside it.
    const ground = pos
    pos = pos.clone()
    pos.y += r * 0.45 * B
    this._emit('flash', pos.x, pos.y, pos.z, { life: 0.16, from: r * 2.2, to: r * 3.2 })
    this._emit('ring', pos.x, pos.y, pos.z, { life: 0.35, from: r * 0.5, to: r * 5, alpha: 0.9 })
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2
      const out = (2 + Math.random() * 3) * r
      const v = new THREE.Vector3(Math.cos(a) * out, 4 + Math.random() * 5, Math.sin(a) * out).multiplyScalar(B)
      this._emit('debris', pos.x, pos.y, pos.z, { life: 0.9 + Math.random() * 0.6, from: 0.18 + Math.random() * 0.2, to: 0.15, vel: v, gravity: 22 })
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2
      const off = (i === 0 ? 0 : 0.3 + Math.random() * 0.5) * r * B
      this._emit('fire', pos.x + Math.cos(a) * off, pos.y + (Math.random() - 0.3) * r * 0.6 * B, pos.z + Math.sin(a) * off, {
        life: 0.55 + Math.random() * 0.35, from: r * 0.6, to: r * (i === 0 ? 2 : 1.4), delay: i * 0.012,
      })
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2
      const v = new THREE.Vector3(Math.cos(a) * 2.5, 1.5 + Math.random() * 2, Math.sin(a) * 2.5).multiplyScalar(r * B)
      this._emit('flame', pos.x, pos.y, pos.z, { life: 0.45 + Math.random() * 0.25, from: r * 0.5, to: r * 0.2, vel: v, rise: 1 })
    }
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2).multiplyScalar(B)
      this._emit('smoke', pos.x + (Math.random() - 0.5) * r * B, ground.y, pos.z + (Math.random() - 0.5) * r * B, {
        life: 1.8 + Math.random() * 1.2, from: r * 0.6, to: r * 2.2, alpha: 0.75, vel: v, delay: 0.12 + i * 0.05,
      })
    }
  }

  // from/dir: world position and unit direction of the shot (the camera's
  // aim); range in blocks. Called once per Flamethrower shot.
  flameStream(from, dir, range) {
    const B = this.B
    const life = 0.5
    for (let i = 0; i < 6; i++) {
      const speed = (range / life) * (0.55 + Math.random() * 0.45) * B
      const v = new THREE.Vector3(
        dir.x + (Math.random() - 0.5) * 0.14,
        dir.y + (Math.random() - 0.3) * 0.14,
        dir.z + (Math.random() - 0.5) * 0.14,
      ).normalize().multiplyScalar(speed)
      this._emit('flame', from.x, from.y, from.z, { life: life * (0.7 + Math.random() * 0.4), from: 0.12, to: 0.9 + Math.random() * 0.5, vel: v, delay: i * 0.012, rise: 0.4, drag: 0.6, alpha: 0.55, stretch: 1 })
    }
    // Smoke rolling off the end of the stream.
    if (Math.random() < 0.35) {
      const end = from.clone().addScaledVector(dir, range * 0.8 * B)
      this._emit('smoke', end.x, end.y + 0.3 * B, end.z, { life: 1.2, from: 0.6, to: 1.6, alpha: 0.35, vel: new THREE.Vector3(0, 0.9 * B, 0), delay: 0.25 })
    }
  }

  // z: a zombie (block units: x, y = feet, z), height in blocks.
  burn(z, height) {
    const B = this.B
    for (let i = 0; i < 2; i++) {
      if (Math.random() > 0.7) continue
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6 + Math.random(), (Math.random() - 0.5) * 0.4).multiplyScalar(B)
      this._emit('flame', (z.x + (Math.random() - 0.5) * 0.7) * B, (z.y + 0.2 + Math.random() * height * 0.75) * B, (z.z + (Math.random() - 0.5) * 0.7) * B, {
        life: 0.45 + Math.random() * 0.25, from: 0.8, to: 0.3, vel: v,
      })
    }
    if (Math.random() < 0.08) this._smokeAt((z.x) * B, (z.y + height) * B, z.z * B, 0.6)
  }

  _smokeAt(x, y, z, size) {
    const B = this.B
    this._emit('smoke', x, y, z, {
      life: 1.4 + Math.random() * 0.6, from: size * 0.6, to: size * 2, alpha: 0.4,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.3 * B, (0.9 + Math.random() * 0.5) * B, (Math.random() - 0.5) * 0.3 * B),
    })
  }

  // A burning block (block coordinates, its lowest corner). `k` 0-1 is how
  // far it has burnt - the flames grow, then die down at the end.
  // Calm flames (2026-10-19, Gaymi: "the animation for the fire is going too
  // fast"): each tongue lives about twice as long, rises and flickers at
  // under half the speed, and half as many start, so it isn't busier.
  burnBlock(x, y, z, k = 0.5) {
    const B = this.B
    const strength = Math.min(1, k * 4) * (k > 0.85 ? (1 - k) / 0.15 : 1)
    for (let i = 0; i < 2; i++) {
      if (Math.random() > 0.3 * strength + 0.05) continue
      // Mostly on top, some licking up the sides.
      const side = Math.random() < 0.35
      const px = x + (side ? (Math.random() < 0.5 ? -0.05 : 1.05) : Math.random())
      const pz = z + (side ? Math.random() : Math.random())
      const py = y + (side ? 0.2 + Math.random() * 0.7 : 1)
      this._emit('flame', px * B, py * B, pz * B, {
        life: 1.1 + Math.random() * 0.6, from: 0.55 + strength * 0.4, to: 0.2, rise: 0.55, wobble: 5,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.1 * B, 0.18 * B, (Math.random() - 0.5) * 0.1 * B),
      })
    }
    if (Math.random() < 0.035 * strength) this._smokeAt((x + 0.5) * B, (y + 1.6) * B, (z + 0.5) * B, 0.8)
  }

  // A tinted sparkle (x, y, z in world units) - opts as _emit's, plus color.
  spark(x, y, z, opts) {
    this._emit('dot', x, y, z, opts)
  }

  // A slow grey puff (Smoke Bomb).
  smoke(x, y, z) {
    this._emit('smoke', x, y, z, { life: 2.5, from: 0.8, to: 2.2, alpha: 0.8, vel: new THREE.Vector3((Math.random() - 0.5) * this.B, 0.3 * this.B, (Math.random() - 0.5) * this.B) })
  }

  // One lick of flame rising from a spot (campfires).
  flame(x, y, z) {
    this._emit('flame', x, y, z, { life: 0.5 + Math.random() * 0.3, from: 0.35, to: 0.12, rise: 1.2, alpha: 0.9 })
  }

  voidHit(pos) {
    for (let i = 0; i < 4; i++) {
      this._emit('void', pos.x, pos.y, pos.z, { life: 0.4 + i * 0.06, from: 1.5 - i * 0.2, to: 0.1, delay: i * 0.04 })
    }
  }

  update(dt) {
    // A slow frame plays the effects a little slower instead of skipping
    // most of a short one (a blast's fireball lasts about half a second).
    dt = Math.min(dt, 0.05)
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
      if (d.flame) {
        // Rises, slows down and wobbles; tint follows FLAME_RAMP.
        d.vel.multiplyScalar(Math.max(0, 1 - dt * d.drag))
        s.position.y += d.rise * dt
        d.wob += dt * d.wobble
        s.position.x += Math.sin(d.wob) * 0.25 * this.B * dt
        s.position.z += Math.cos(d.wob * 0.8) * 0.25 * this.B * dt
        rampColor(s.material.color, k)
        const size = (d.from + (d.to - d.from) * Math.sqrt(k)) * this.B
        s.scale.set(size * (0.8 + Math.sin(d.wob * 1.7) * 0.08), size * d.stretch, 1)
        s.material.opacity = d.alpha * Math.min(1, k * 14) * Math.pow(1 - k, 0.8)
        continue
      }
      if (d.gravity) d.vel.y -= d.gravity * dt
      s.scale.setScalar((d.from + (d.to - d.from) * Math.sqrt(k)) * this.B)
      s.material.rotation += d.spin * dt
      s.material.opacity = d.solid ? d.alpha * Math.min(1, (1 - k) * 4) : d.alpha * Math.min(1, k * 10) * (1 - k)
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
