// Castle flags (2026-10-26, Gaymi: "design a flag and use it on castles
// that thin and actually like looks like irl", then "do all" of the three
// designs offered). Each castle's towers and keep fly a thin cloth flag on
// a slim pole with a gold ball on top; the cloth waves in the wind. One
// castle picks one design for all its flags:
//   logo   - the GayZ face on a coloured field
//   banner - a field with a band and a coloured edge
//   skull  - a zombie skull crest
// Drawn as meshes, not blocks (open-world terrain is full cubes only), and
// only for castles near you; nothing to walk on or break.
import * as THREE from 'three'

const SHOW_RANGE = 160 // blocks from you a castle's flags are drawn
const CHECK_EVERY = 0.5 // seconds between looking for castles near you
const SEG_X = 12
const SEG_Y = 6

// Field colours a castle can pick (cloth, then its trim).
const COLORS = [
  ['#b3262d', '#f2c230'],
  ['#1f4f9e', '#f2f2f2'],
  ['#f2c230', '#b3262d'],
  ['#5c2d91', '#f2c230'],
  ['#2f7d32', '#f2f2f2'],
  ['#1b1b1b', '#c9c9c9'],
]
export const FLAG_DESIGNS = ['logo', 'banner', 'skull']

let logoImg = null
function logoImage(onLoad) {
  if (!logoImg) {
    logoImg = new Image()
    logoImg.src = '/favicon-64.png'
  }
  if (logoImg.complete && logoImg.naturalWidth) return logoImg
  logoImg.addEventListener('load', onLoad, { once: true })
  return null
}

// The flag's picture, 128x80, with a little cloth weave over it.
function drawFlag(g, design, [field, trim], logo) {
  const W = 128
  const H = 80
  g.fillStyle = field
  g.fillRect(0, 0, W, H)
  if (design === 'banner') {
    g.fillStyle = trim
    g.fillRect(0, H * 0.38, W, H * 0.24)
    g.fillRect(0, 0, W * 0.22, H)
    g.fillStyle = field
    g.beginPath()
    g.moveTo(W * 0.04, H * 0.5)
    g.lineTo(W * 0.11, H * 0.3)
    g.lineTo(W * 0.18, H * 0.5)
    g.lineTo(W * 0.11, H * 0.7)
    g.closePath()
    g.fill()
  } else if (design === 'skull') {
    const cx = W * 0.55
    const cy = H * 0.46
    g.fillStyle = trim
    // Crossed bones behind.
    g.lineCap = 'round'
    g.lineWidth = 7
    g.strokeStyle = trim
    g.beginPath()
    g.moveTo(cx - 34, cy - 24)
    g.lineTo(cx + 34, cy + 28)
    g.moveTo(cx + 34, cy - 24)
    g.lineTo(cx - 34, cy + 28)
    g.stroke()
    // Skull and jaw, a zombie-green tint.
    g.fillStyle = '#b8c99a'
    g.beginPath()
    g.ellipse(cx, cy - 4, 20, 19, 0, 0, Math.PI * 2)
    g.fill()
    g.fillRect(cx - 12, cy + 8, 24, 13)
    g.fillStyle = field
    g.beginPath()
    g.ellipse(cx - 8, cy - 3, 5.5, 6.5, 0, 0, Math.PI * 2)
    g.ellipse(cx + 8, cy - 3, 5.5, 6.5, 0, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.moveTo(cx, cy + 4)
    g.lineTo(cx - 3, cy + 10)
    g.lineTo(cx + 3, cy + 10)
    g.closePath()
    g.fill()
    for (let i = -1; i <= 1; i++) g.fillRect(cx + i * 7 - 1, cy + 14, 2, 7)
  } else {
    // The GayZ face, in a trim-coloured ring.
    const cx = W * 0.55
    const cy = H * 0.5
    g.fillStyle = trim
    g.beginPath()
    g.arc(cx, cy, 31, 0, Math.PI * 2)
    g.fill()
    if (logo) {
      g.imageSmoothingEnabled = false
      g.save()
      g.beginPath()
      g.rect(cx - 26, cy - 26, 52, 52)
      g.clip()
      g.drawImage(logo, cx - 26, cy - 26, 52, 52)
      g.restore()
    } else {
      g.fillStyle = '#f4e83c'
      g.fillRect(cx - 26, cy - 26, 52, 52)
    }
  }
  // Hem along the pole side and a faint weave so it reads as cloth.
  g.fillStyle = 'rgba(0,0,0,0.25)'
  g.fillRect(0, 0, 4, H)
  for (let y = 0; y < H; y += 2) {
    g.fillStyle = y % 4 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
    g.fillRect(0, y, W, 1)
  }
}

export class CastleFlags {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.shown = new Map() // plan -> THREE.Group
    this._wait = 0
    this._textures = new Map()
    this.fx = { time: { value: 0 } }
    const B = blockSize
    this._poleGeo = new THREE.CylinderGeometry(0.05 * B, 0.07 * B, 1, 8)
    this._poleGeo.translate(0, 0.5, 0)
    this._ballGeo = new THREE.SphereGeometry(0.13 * B, 10, 8)
    this._poleMat = new THREE.MeshLambertMaterial({ color: 0x5b4632 })
    this._ballMat = new THREE.MeshLambertMaterial({ color: 0xd8b13a })
  }

  _texture(design, colors) {
    const key = `${design}:${colors[0]}`
    let tex = this._textures.get(key)
    if (tex) return tex
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 80
    const g = c.getContext('2d')
    tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const draw = () => {
      drawFlag(g, design, colors, design === 'logo' ? logoImage(draw) : null)
      tex.needsUpdate = true
    }
    draw()
    this._textures.set(key, tex)
    return tex
  }

  // The cloth: a plane from the pole outwards (+x), waving more the
  // further it is from the pole.
  _clothMaterial(tex) {
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.fx.time
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float out_ = uv.x;
          vec3 at = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float ph = uTime * 4.0 - uv.x * 6.0 + at.x * 0.37 + at.z * 0.23;
          transformed.z += sin(ph) * 0.22 * out_ * ${(this.B).toFixed(3)};
          transformed.y -= (1.0 - cos(ph * 0.5)) * 0.05 * out_ * ${(this.B).toFixed(3)};`)
    }
    mat.customProgramCacheKey = () => 'castle-flag'
    return mat
  }

  _build(plan) {
    const B = this.B
    const group = new THREE.Group()
    const colors = COLORS[plan.flagColor % COLORS.length]
    const mat = this._clothMaterial(this._texture(plan.flagDesign, colors))
    group.userData.mats = [mat]
    group.userData.parts = []
    for (const f of plan.flags) {
      const h = f.height
      const pole = new THREE.Mesh(this._poleGeo, this._poleMat)
      pole.scale.y = h * B
      pole.position.set((f.x + 0.5) * B, f.y * B, (f.z + 0.5) * B)
      pole.castShadow = true
      group.add(pole)
      const ball = new THREE.Mesh(this._ballGeo, this._ballMat)
      ball.position.set((f.x + 0.5) * B, (f.y + h + 0.08) * B, (f.z + 0.5) * B)
      group.add(ball)
      const w = 1.6 + f.size * 0.7
      const ht = w * 0.62
      const geo = new THREE.PlaneGeometry(w * B, ht * B, SEG_X, SEG_Y)
      geo.translate((w / 2) * B, -(ht / 2) * B, 0)
      const cloth = new THREE.Mesh(geo, mat)
      cloth.position.set((f.x + 0.5) * B, (f.y + h - 0.12) * B, (f.z + 0.5) * B)
      cloth.rotation.y = Math.atan2(-f.dz, f.dx)
      cloth.castShadow = true
      group.add(cloth)
      group.userData.parts.push({ f, meshes: [pole, ball, cloth] })
    }
    this.bm.scene.add(group)
    return group
  }

  _drop(plan) {
    const group = this.shown.get(plan)
    if (!group) return
    this.bm.scene.remove(group)
    for (const c of group.children) if (c.geometry !== this._poleGeo && c.geometry !== this._ballGeo) c.geometry.dispose()
    for (const m of group.userData.mats) m.dispose()
    this.shown.delete(plan)
  }

  clear() {
    for (const plan of [...this.shown.keys()]) this._drop(plan)
  }

  update(dt) {
    this.fx.time.value += dt
    const w = this.bm.world
    this._wait -= dt
    if (this._wait > 0) return
    this._wait = CHECK_EVERY
    if (!w?.active) {
      this.clear()
      return
    }
    const p = this.bm.tryMode?.active ? this.bm.tryMode.pos : { x: this.bm.camera.position.x / this.B, z: this.bm.camera.position.z / this.B }
    const near = new Set()
    for (const plan of w._plansOver(p.x - SHOW_RANGE, p.z - SHOW_RANGE, p.x + SHOW_RANGE, p.z + SHOW_RANGE, 0, true)) {
      if (plan.flags?.length) near.add(plan)
    }
    for (const plan of [...this.shown.keys()]) if (!near.has(plan)) this._drop(plan)
    for (const plan of near) if (!this.shown.has(plan)) this.shown.set(plan, this._build(plan))
    // A flag whose tower top was broken away (or isn't grown yet) is
    // hidden, so it never hangs in the air.
    for (const group of this.shown.values()) {
      for (const { f, meshes } of group.userData.parts) {
        const on = !!this.bm.getBlockAt(f.x, f.y - 1, f.z)
        for (const m of meshes) m.visible = on
      }
    }
  }
}
