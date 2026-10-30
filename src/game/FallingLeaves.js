// Leaves drifting down from trees (2026-10-26, Gaymi: "make trees drop
// leaves"). Now and then a leaf comes loose from the underside of a leaf
// block near you, flutters and spins down, lies on the ground a little
// while, then shrinks away. Leaf shapes and colours follow the tree (see
// LEAF_KINDS). Off on Potato.
//
// Cheap on purpose: one InstancedMesh of small leaf cards per leaf shape.
// Each spawn try looks down one random column near you for leaves.
import * as THREE from 'three'

const MAX = 90
const RANGE = 22 // blocks round you leaves can come from
const TRIES_PER_S = 12 // columns looked at a second
const FALL = 0.9 // blocks / s
const LIE_S = 4 // seconds on the ground before shrinking away

// Real leaf shapes (2026-10-30, Gaymi: "actually drop maple leaves or
// whatever leaves by real leaves shape"): each kind of tree lets go of
// its own leaf - a five-pointed maple leaf from plain trees (now and then
// already turned red, orange or gold), a toothed birch leaf, a pink
// cherry petal, a spruce twig of needles, a long jungle leaf with a drip
// tip, a feathery acacia leaf, ... First match wins.
const LEAF_KINDS = [
  { re: /cherry/, shape: 'petal', colors: [0xf2a9c4, 0xf7c2d6, 0xe98fb2] },
  { re: /birch/, shape: 'birch', colors: [0x9cbf4a, 0xb5c94e, 0xd8c040] },
  { re: /spruce|pine|dark/, shape: 'needles', colors: [0x2f5a2a, 0x3b6a33] },
  { re: /jungle/, shape: 'jungle', colors: [0x3f8a2c, 0x357a26] },
  { re: /acacia|savanna/, shape: 'acacia', colors: [0x7a9a30, 0x8aa83a] },
  { re: /mangrove/, shape: 'mangrove', colors: [0x4c8a34, 0x5a9a3c] },
  { re: /azalea/, shape: 'azalea', colors: [0x5f9a3a, 0x6aa842, 0xd779b8] },
  { re: /bamboo/, shape: 'bamboo', colors: [0x7fae3c, 0x8fbc48] },
  { re: /./, shape: 'maple', colors: [0x4f8f2f, 0x4f8f2f, 0x5a9a34, 0x4a852b, 0xc8401e, 0xe07a1f, 0xd9a520] },
]

// A leaf outline by angle round its middle: r(angle) on a 64px canvas,
// y down, so -PI/2 is the tip.
function polarLeaf(g, r, cx = 32, cy = 34) {
  g.beginPath()
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2
    const d = r(a)
    g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * d, cy + Math.sin(a) * d)
  }
  g.closePath()
  g.fill()
}

// Distance from angle a to angle b (-PI..PI).
const turn = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

// The pictures: white (tinted per leaf), darker veins, see-through round.
const DRAW = {
  maple(g) {
    // Five pointed lobes (top, two sides, two smaller lower ones), a gap
    // for the stalk at the bottom, little teeth all round.
    const lobes = [[-Math.PI / 2, 27], [-Math.PI / 2 - 1.05, 24], [-Math.PI / 2 + 1.05, 24], [Math.PI / 2 + 1.0, 15], [Math.PI / 2 - 1.0, 15]]
    polarLeaf(g, (a) => {
      let r = 6
      for (const [at, len] of lobes) r = Math.max(r, len * Math.max(0, 1 - Math.abs(turn(a, at)) / 0.42))
      return r + (r > 9 ? Math.abs(Math.sin(a * 14)) * 2.2 : 0)
    })
    g.fillRect(31, 38, 2, 24)
    veins(g, 32, 40, lobes.map(([at, len]) => [at, len * 0.85]))
  },
  birch(g) {
    // Egg shaped with a pointed tip and a toothed edge.
    polarLeaf(g, (a) => {
      const tip = Math.max(0, -Math.sin(a))
      return (13 + tip * tip * 14 + Math.max(0, Math.sin(a)) * 3) + Math.abs(Math.sin(a * 22)) * 1.4
    }, 32, 36)
    g.fillRect(31, 50, 2, 13)
    midrib(g, 32, 50, 12, 6)
  },
  petal(g) {
    // A cherry blossom petal: round, with a little notch at the end.
    polarLeaf(g, (a) => {
      const t = Math.abs(turn(a, -Math.PI / 2))
      return 20 - (t < 0.18 ? (0.18 - t) * 40 : 0) - Math.max(0, Math.sin(a)) * 8
    }, 32, 36)
  },
  needles(g) {
    // A bit of spruce twig: a stalk with short needles both sides.
    g.strokeStyle = '#ffffff'
    g.lineCap = 'round'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(32, 62)
    g.lineTo(32, 4)
    g.stroke()
    g.lineWidth = 2
    for (let y = 8; y < 58; y += 4) {
      const len = 9 + Math.sin(y) * 2
      for (const side of [-1, 1]) {
        g.beginPath()
        g.moveTo(32, y + 2)
        g.lineTo(32 + side * len, y - 3)
        g.stroke()
      }
    }
  },
  jungle(g) {
    // Long and wide with a thin drip tip.
    polarLeaf(g, (a) => {
      const up = -Math.sin(a)
      return up > 0 ? 12 + Math.pow(up, 6) * 19 : 12 + Math.pow(-up, 3) * 8
    }, 32, 34)
    g.fillRect(31, 46, 2, 17)
    midrib(g, 32, 46, 18, 7)
  },
  acacia(g) {
    // A feathery leaf: a stalk with pairs of small round leaflets.
    g.strokeStyle = '#ffffff'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(32, 62)
    g.lineTo(32, 3)
    g.stroke()
    for (let y = 7; y < 54; y += 6) {
      for (const side of [-1, 1]) {
        g.beginPath()
        g.ellipse(32 + side * 6, y, 5, 2.6, side * 0.3, 0, Math.PI * 2)
        g.fill()
      }
    }
  },
  mangrove(g) {
    // Long thick oval, round tip.
    g.beginPath()
    g.ellipse(32, 32, 11, 25, 0, 0, Math.PI * 2)
    g.fill()
    g.fillRect(31, 55, 2, 8)
    midrib(g, 32, 55, 10, 5)
  },
  azalea(g) {
    // Small round leaf.
    g.beginPath()
    g.ellipse(32, 30, 15, 21, 0, 0, Math.PI * 2)
    g.fill()
    g.fillRect(31, 49, 2, 13)
    midrib(g, 32, 49, 10, 6)
  },
  bamboo(g) {
    // A long narrow blade.
    polarLeaf(g, (a) => {
      const up = Math.abs(Math.sin(a))
      return 7 + Math.pow(up, 8) * 24
    }, 32, 32)
    midrib(g, 32, 60, 40, 0)
  },
}

// Darker lines from the stalk out to each lobe's point.
function veins(g, x, y, ends) {
  g.strokeStyle = 'rgba(0,0,0,0.22)'
  g.lineWidth = 1.2
  for (const [a, len] of ends) {
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(32 + Math.cos(a) * len, 34 + Math.sin(a) * len)
    g.stroke()
  }
}

// The middle vein from the stalk up `len` px, with side veins every `gap`.
function midrib(g, x, y, len, gap) {
  g.strokeStyle = 'rgba(0,0,0,0.22)'
  g.lineWidth = 1.2
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x, y - len * 2.2)
  g.stroke()
  if (!gap) return
  for (let v = y - gap; v > y - len * 2; v -= gap) {
    g.beginPath()
    g.moveTo(x - 9, v - 6)
    g.lineTo(x, v)
    g.lineTo(x + 9, v - 6)
    g.stroke()
  }
}

function leafTexture(shape) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#ffffff'
  DRAW[shape](g)
  const tex = new THREE.CanvasTexture(c)
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
    // One mesh per leaf shape (a picture each), all sharing the leaves.
    const geo = new THREE.PlaneGeometry(0.3 * B, 0.3 * B)
    this.meshes = {}
    for (const shape of Object.keys(DRAW)) {
      const mat = new THREE.MeshLambertMaterial({ map: leafTexture(shape), alphaTest: 0.5, side: THREE.DoubleSide })
      const mesh = new THREE.InstancedMesh(geo, mat, MAX)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.visible = false
      buildMode.scene.add(mesh)
      this.meshes[shape] = mesh
    }
    this._counts = {}
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
      for (const mesh of Object.values(this.meshes)) mesh.visible = false
      return
    }
    dt = Math.min(dt, 0.1)
    this._try += dt * TRIES_PER_S * this.amount
    while (this._try >= 1) {
      this._try -= 1
      if (this.leaves.length < MAX) this._spawnTry()
    }
    const B = this.B
    const counts = this._counts
    for (const shape in this.meshes) counts[shape] = 0
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
      const mesh = this.meshes[l.shape]
      const n = counts[l.shape]++
      mesh.setMatrixAt(n, this._m)
      mesh.setColorAt(n, this._color.setHex(l.color).multiplyScalar(l.shade))
    }
    for (const shape in this.meshes) {
      const mesh = this.meshes[shape]
      const n = counts[shape]
      mesh.count = n
      mesh.visible = n > 0
      if (n) {
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
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
      const kind = LEAF_KINDS.find(({ re }) => re.test(type))
      this.leaves.push({
        x: cx + Math.random(), y: y - 0.02, z: cz + Math.random(),
        age: 0, seed: Math.random() * 10, spin: Math.random() * Math.PI * 2,
        shape: kind.shape, color: kind.colors[Math.floor(Math.random() * kind.colors.length)], shade: 0.85 + Math.random() * 0.3,
        down: false, downAt: 0,
      })
      return
    }
  }

  clear() {
    this.leaves.length = 0
    for (const mesh of Object.values(this.meshes)) {
      mesh.count = 0
      mesh.visible = false
    }
  }
}
