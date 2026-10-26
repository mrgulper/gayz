// Leaves drifting down from trees (2026-10-26, Gaymi: "make trees drop
// leaves"). Now and then a leaf comes loose from the underside of a leaf
// block near you, flutters and spins down, lies on the ground a little
// while, then shrinks away. Leaf colours follow the tree (cherry pink,
// birch yellow-green, dark spruce...). Off on Potato.
//
// Cheap on purpose: one InstancedMesh of MAX small leaf cards, reused.
// Each spawn try looks down one random column near you for leaves.
import * as THREE from 'three'

const MAX = 90
const RANGE = 22 // blocks round you leaves can come from
const TRIES_PER_S = 12 // columns looked at a second
const FALL = 0.9 // blocks / s
const LIE_S = 4 // seconds on the ground before shrinking away

const COLORS = [
  [/cherry/, 0xf2a9c4],
  [/birch/, 0x9cbf4a],
  [/spruce|pine|dark/, 0x2f5a2a],
  [/jungle/, 0x3f8a2c],
  [/acacia|savanna/, 0x7a9a30],
  [/./, 0x4f8f2f],
]

function leafTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')
  // A little pointed leaf with a pale middle vein, in white (tinted per leaf).
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.moveTo(8, 1)
  g.quadraticCurveTo(15, 7, 8, 15)
  g.quadraticCurveTo(1, 7, 8, 1)
  g.fill()
  g.fillStyle = 'rgba(0,0,0,0.25)'
  g.fillRect(7.5, 3, 1, 11)
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class FallingLeaves {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.amount = 0
    this._try = 0
    const B = blockSize
    const geo = new THREE.PlaneGeometry(0.22 * B, 0.22 * B)
    const mat = new THREE.MeshLambertMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide })
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    buildMode.scene.add(this.mesh)
    this.leaves = []
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this._s = new THREE.Vector3()
    this._p = new THREE.Vector3()
    this._color = new THREE.Color()
  }

  // 0 = off (Potato), 1 = on.
  setAmount(a) {
    this.amount = a
    if (!a) this.clear()
  }

  update(dt) {
    const on = this.amount > 0 && this.bm.active !== false
    if (!on) {
      this.mesh.visible = false
      return
    }
    dt = Math.min(dt, 0.1)
    this._try += dt * TRIES_PER_S * this.amount
    while (this._try >= 1) {
      this._try -= 1
      if (this.leaves.length < MAX) this._spawnTry()
    }
    const B = this.B
    let n = 0
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i]
      l.age += dt
      if (!l.down) {
        l.y -= FALL * dt * (0.7 + 0.3 * Math.sin(l.age * 3 + l.seed))
        l.x += Math.sin(l.age * 1.7 + l.seed) * 0.6 * dt + 0.15 * dt
        l.z += Math.cos(l.age * 1.3 + l.seed * 2) * 0.6 * dt
        const below = this.bm.getBlockAt(Math.floor(l.x), Math.floor(l.y - 0.05), Math.floor(l.z))
        if (below || l.age > 30) {
          l.down = true
          l.y = Math.floor(l.y - 0.05) + 1.02
          l.downAt = l.age
        }
      }
      const lying = l.down ? l.age - l.downAt : 0
      const size = l.down ? Math.max(0, 1 - Math.max(0, lying - LIE_S) / 1.5) : 1
      if (size <= 0) {
        this.leaves.splice(i, 1)
        continue
      }
      // Flutters (tips back and forth) while falling, flat on the ground.
      if (l.down) this._e.set(-Math.PI / 2, 0, l.spin)
      else this._e.set(Math.sin(l.age * 4 + l.seed) * 0.9 - 0.6, l.age * 1.5 + l.seed, Math.cos(l.age * 3.3) * 0.5)
      this._q.setFromEuler(this._e)
      this._p.set(l.x * B, l.y * B, l.z * B)
      this._s.setScalar(size)
      this._m.compose(this._p, this._q, this._s)
      this.mesh.setMatrixAt(n, this._m)
      this.mesh.setColorAt(n, this._color.setHex(l.color).multiplyScalar(l.shade))
      n++
    }
    this.mesh.count = n
    this.mesh.visible = n > 0
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }
  }

  // One random column near you: the lowest leaf block in it with air
  // underneath lets a leaf go.
  _spawnTry() {
    const bm = this.bm
    const c = bm.camera.position
    const cx = Math.floor(c.x / this.B + (Math.random() * 2 - 1) * RANGE)
    const cz = Math.floor(c.z / this.B + (Math.random() * 2 - 1) * RANGE)
    const cy = Math.floor(c.y / this.B)
    for (let y = cy + 14; y > cy - 8; y--) {
      const type = bm.getBlockAt(cx, y, cz)
      if (!type || !/leaves$/.test(type)) continue
      if (bm.getBlockAt(cx, y - 1, cz)) return
      this.leaves.push({
        x: cx + Math.random(), y: y - 0.02, z: cz + Math.random(),
        age: 0, seed: Math.random() * 10, spin: Math.random() * Math.PI * 2,
        color: COLORS.find(([re]) => re.test(type))[1], shade: 0.8 + Math.random() * 0.35,
        down: false, downAt: 0,
      })
      return
    }
  }

  clear() {
    this.leaves.length = 0
    this.mesh.count = 0
    this.mesh.visible = false
  }
}
