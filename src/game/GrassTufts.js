// Little 3D grass plants on grass blocks near you (2026-10-25, Gaymi:
// "its not about more pixels its more of everything all together ... like
// more shapes"). On the Realistic, Ultra and In Real Life graphics levels
// (GraphicsLevels `tufts`, 0..1 = how many) the tops of grass blocks round
// you grow tufts of blades that sway in the wind, so a field looks like a
// field instead of flat green squares. Snow on the ground whitens them.
//
// Cheap on purpose: one InstancedMesh (two crossed quads per tuft). The
// grass round you is found a few rows per frame (ROWS) - each column's
// top block, found by walking up or down from the column next to it (land
// is mostly smooth, so that's a block or two of looking) - and the tufts
// move over when a full pass ends, like BuildWeather's roof grid.
// Grass reaches 100 blocks out (2026-10-26, Gaymi: it "pops up when you
// walk there by like 10-20 blocks make it 100 blocks"): full and close
// up to NEAR, then one bigger tuft per block further out.
import * as THREE from 'three'

export const GRASS_REACH = 100
const RADIUS = GRASS_REACH // blocks round you that get tufts
const NEAR = 24 // closer than this: PER_BLOCK tufts a block, further: one
const SPAN = RADIUS * 2 + 1
const ROWS = 6 // grid rows scanned per frame
const WALK = 24 // most blocks looked up or down from the last column's top
const PER_BLOCK = 3 // most tufts on one grass block
const MAX_TUFTS = Math.ceil(Math.PI * NEAR * NEAR * PER_BLOCK + Math.PI * RADIUS * RADIUS)

// A small picture of grass blades: a few thin tapering blades in greens,
// see-through between them.
function bladeTexture() {
  const W = 64
  const c = document.createElement('canvas')
  c.width = c.height = W
  const g = c.getContext('2d')
  let seed = 4242
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < 14; i++) {
    const x = 4 + rnd() * (W - 8)
    const h = W * (0.45 + rnd() * 0.55)
    const lean = (rnd() - 0.5) * 14
    const w = 2 + rnd() * 2.5
    const shade = 0.75 + rnd() * 0.25
    g.fillStyle = `rgb(${Math.round(112 * shade)}, ${Math.round(172 * shade)}, ${Math.round(66 * shade)})`
    g.beginPath()
    g.moveTo(x - w, W)
    g.quadraticCurveTo(x + lean * 0.3, W - h * 0.6, x + lean, W - h)
    g.quadraticCurveTo(x + lean * 0.3 + w * 0.3, W - h * 0.6, x + w, W)
    g.closePath()
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function hash(x, z, i) {
  let h = (x * 374761393 + z * 668265263 + i * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export class GrassTufts {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.amount = 0
    const B = blockSize
    // Two crossed quads, bottom at y=0, lit as if facing up (so they
    // shade like the ground they stand on, not like thin walls).
    const w = 0.42 * B
    const h = 0.38 * B
    const pos = []
    const uv = []
    const idx = []
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      const base = pos.length / 3
      pos.push(-w * dx, 0, -w * dz, w * dx, 0, w * dz, w * dx, h, w * dz, -w * dx, h, -w * dz)
      uv.push(0, 0, 1, 0, 1, 1, 0, 1)
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    this.fx = { time: { value: 0 }, sway: { value: 0.06 * B } }
    const snow = buildMode._chunks?.fx.snow || { value: 0 }
    const mat = new THREE.MeshLambertMaterial({ map: bladeTexture(), alphaTest: 0.5, side: THREE.DoubleSide })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.fx.time
      shader.uniforms.uSway = this.fx.sway
      shader.uniforms.uSnow = snow
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // Only the tips move; each tuft by where it stands.
          vec3 at = instanceMatrix[3].xyz;
          float tip = uv.y;
          transformed.x += sin(uTime * 1.9 + at.x * 3.1 + at.z * 1.7) * uSway * tip;
          transformed.z += cos(uTime * 1.5 + at.z * 2.7) * uSway * 0.6 * tip;`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSnow;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), uSnow * 0.8);`)
    }
    mat.customProgramCacheKey = () => 'grass-tufts'
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_TUFTS)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.mesh.receiveShadow = true
    buildMode.scene.add(this.mesh)
    // Grass tops found this pass: block x, z and the top's height.
    this._found = new Int32Array(SPAN * SPAN * 3)
    this._foundCount = 0
    this._row = SPAN
    this._origin = { x: 0, y: 0, z: 0 }
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._s = new THREE.Vector3()
    this._p = new THREE.Vector3()
    this._up = new THREE.Vector3(0, 1, 0)
    this._color = new THREE.Color()
  }

  // 0 = none (the other graphics levels), 1 = the most.
  setAmount(a) {
    if (a === this.amount) return
    this.amount = a
    this._row = SPAN // start a fresh pass with the new amount
  }

  update(dt) {
    const on = this.amount > 0 && this.bm.active !== false
    this.mesh.visible = on && this.mesh.count > 0
    if (!on) return
    this.fx.time.value += dt
    this._scan()
  }

  _scan() {
    const bm = this.bm
    const o = this._origin
    if (this._row >= SPAN) {
      if (this._row === SPAN && this._scanned) this._place()
      const p = bm.camera.position
      o.x = Math.floor(p.x / this.B) - RADIUS
      o.z = Math.floor(p.z / this.B) - RADIUS
      o.y = Math.floor(p.y / this.B)
      this._row = 0
      this._foundCount = 0
      this._scanned = true
    }
    const end = Math.min(SPAN, this._row + ROWS)
    const R2 = (RADIUS + 0.5) * (RADIUS + 0.5)
    for (let r = this._row; r < end; r++) {
      const z = o.z + r
      const dz = r - RADIUS
      // Each row starts from your height; each column from the top found
      // next to it.
      let top = o.y
      for (let c = 0; c < SPAN; c++) {
        const dx = c - RADIUS
        if (dx * dx + dz * dz > R2) continue
        const x = o.x + c
        const y = this._topAt(x, z, top)
        if (y === null) continue
        top = y
        if (bm.getBlockAt(x, y, z) === 'grass' && this._foundCount * 3 < this._found.length) {
          const i = this._foundCount++ * 3
          this._found[i] = x
          this._found[i + 1] = y + 1
          this._found[i + 2] = z
        }
      }
    }
    this._row = end
  }

  // The top block of column x, z: from the height `from`, up while
  // there's a block, else down to the first one (null if none near).
  _topAt(x, z, from) {
    const bm = this.bm
    if (bm.getBlockAt(x, from, z)) {
      for (let y = from + 1; y <= from + WALK; y++) if (!bm.getBlockAt(x, y, z)) return y - 1
      return null
    }
    for (let y = from - 1; y >= from - WALK; y--) if (bm.getBlockAt(x, y, z)) return y
    return null
  }

  // A full pass is done: put the tufts on the grass it found. Each block
  // gets the same tufts every time (hash of its spot), so they don't jump.
  _place() {
    const B = this.B
    const p = this.bm.camera.position
    const cx = p.x / B
    const cz = p.z / B
    let n = 0
    for (let f = 0; f < this._foundCount; f++) {
      const x = this._found[f * 3]
      const top = this._found[f * 3 + 1]
      const z = this._found[f * 3 + 2]
      const far = Math.hypot(x + 0.5 - cx, z + 0.5 - cz)
      const dist = far / RADIUS
      if (dist > 1) continue
      // Smaller towards the edge, so the ring of grass has no hard border.
      const edge = 1 - THREE.MathUtils.smoothstep(dist, 0.85, 1)
      // Far away: one tuft a block, a bit bigger so the field still looks full.
      const many = far < NEAR ? PER_BLOCK : 1
      const grow = far < NEAR ? 1 : 1.35
      for (let i = 0; i < many; i++) {
        if (n >= MAX_TUFTS) break
        if (hash(x, z, i) > this.amount * 0.9 + (many === 1 ? 0.1 : 0)) continue
        const size = (0.7 + hash(x, z, i + 7) * 0.6) * edge * grow
        if (size < 0.05) continue
        this._p.set((x + 0.15 + hash(x, z, i + 3) * 0.7) * B, top * B, (z + 0.15 + hash(x, z, i + 5) * 0.7) * B)
        this._q.setFromAxisAngle(this._up, hash(x, z, i + 11) * Math.PI)
        this._s.setScalar(size)
        this._m.compose(this._p, this._q, this._s)
        this.mesh.setMatrixAt(n, this._m)
        const shade = 0.8 + hash(x, z, i + 13) * 0.35
        this.mesh.setColorAt(n, this._color.setRGB(shade, shade, shade * 0.9))
        n++
      }
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  clear() {
    this.mesh.count = 0
    this.mesh.visible = false
    this._row = SPAN
    this._scanned = false
  }
}
