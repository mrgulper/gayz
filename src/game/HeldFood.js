// An animal's body-part drop held in your hands (2026-11-15, Gaymi's
// drops plan, part 6: "a small 3D blocky version of the drop in the
// player's hand when it's held, with bite animations while eating").
//
// The model is the drop's own 16 x 16 pixel picture (PlayInventory.js
// part<Part>, in the animal's colours) pushed out into a slab of little
// cubes, one per pixel, so every one of the 45 parts gets a 3D look that
// matches its icon. Drawn by BuildTryMode.drawFood in the on-top hand
// scene, between the two skin arms (like a held block).
//
// Eating one (PlayInventory.useHeld): the hands lift it to your mouth,
// take BITES bites - each one chews a round piece out of the model with a
// crunch and a few crumbs - then lower it again. The item is used up at
// the start (as before), so the bitten copy is kept on screen until the
// animation ends even when it was your last one.
import * as THREE from 'three'
import { itemIconCanvas } from './PlayInventory.js'

export const isHeldFood = (id) => typeof id === 'string' && /^meat_/.test(id)

const PX = 0.0125 // one icon pixel, in the on-top scene (a held block is 0.18)
export const BITES = 3
const LIFT = 0.22 // seconds up to the mouth (and back down)
const BITE = 0.32 // seconds per bite
export const EAT_TIME = LIFT * 2 + BITES * BITE
const BITE_R = 2.9 // pixels
const SIDE_SHADE = [0.8, 0.8, 0.95, 0.65, 1, 0.72] // +x -x +y -y +z -z
const TONE = 0.7 // like the held block, toned for the bright hand scene
const CRUMBS = 4

// The picture's filled pixels: [x, y, r, g, b] (y up), and its middle.
const _pixels = new Map()
function pixelsOf(id) {
  if (_pixels.has(id)) return _pixels.get(id)
  const c = itemIconCanvas(id)
  const data = c.getContext('2d').getImageData(0, 0, 16, 16).data
  const list = []
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4
      if (data[i + 3] < 128) continue
      list.push([x, 15 - y, data[i] / 255, data[i + 1] / 255, data[i + 2] / 255])
    }
  }
  _pixels.set(id, list)
  return list
}

// Which pixels are left after `bites` bites: each bite takes a round
// piece from the top-right-most pixel still there.
function bitten(list, bites) {
  let left = list
  for (let b = 0; b < bites && left.length; b++) {
    let best = left[0]
    for (const p of left) if (p[0] + p[1] > best[0] + best[1]) best = p
    left = left.filter((p) => Math.hypot(p[0] - best[0] - 0.8, p[1] - best[1] - 0.8) > BITE_R)
  }
  return left
}

// One cube per pixel; sides shared with a neighbour are left out.
function buildGeometry(list) {
  const filled = new Set(list.map((p) => p[0] + p[1] * 16))
  const pos = []
  const col = []
  const nor = []
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  for (const [x, y, r, g, b] of list) {
    DIRS.forEach(([dx, dy, dz], f) => {
      if (!dz) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && filled.has(nx + ny * 16)) return
      }
      // The face's 4 corners (unit cube from x,y,-0.5 to x+1,y+1,0.5).
      const corners = faceCorners(dx, dy, dz)
      const quad = corners.map(([cx, cy, cz]) => [(x + cx - 8) * PX, (y + cy - 8) * PX, cz * PX])
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(...quad[k])
        nor.push(dx, dy, dz)
        const s = SIDE_SHADE[f] * TONE
        col.push(r * s, g * s, b * s)
      }
    })
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.computeBoundingSphere()
  return geo
}

// Counter-clockwise from outside, for a unit cube centred on z.
function faceCorners(dx, dy, dz) {
  if (dz > 0) return [[0, 0, 0.5], [1, 0, 0.5], [1, 1, 0.5], [0, 1, 0.5]]
  if (dz < 0) return [[1, 0, -0.5], [0, 0, -0.5], [0, 1, -0.5], [1, 1, -0.5]]
  if (dx > 0) return [[1, 0, 0.5], [1, 0, -0.5], [1, 1, -0.5], [1, 1, 0.5]]
  if (dx < 0) return [[0, 0, -0.5], [0, 0, 0.5], [0, 1, 0.5], [0, 1, -0.5]]
  if (dy > 0) return [[0, 1, 0.5], [1, 1, 0.5], [1, 1, -0.5], [0, 1, -0.5]]
  return [[0, 0, -0.5], [1, 0, -0.5], [1, 0, 0.5], [0, 0, 0.5]]
}

export class HeldFood {
  constructor() {
    this.group = new THREE.Group()
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true })
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat)
    this.mesh.frustumCulled = false
    this.group.add(this.mesh)
    this._geos = new Map() // `${id}|${bites}` -> geometry
    this._key = ''
    this.eating = null // { id, t }
    this._crumbs = []
    this._crumbGeo = new THREE.BoxGeometry(PX * 1.2, PX * 1.2, PX * 1.2)
  }

  // Start eating one `id` (already taken from the bag).
  eat(id) {
    if (!isHeldFood(id)) return
    this.eating = { id, t: 0, bites: 0, at: performance.now() }
  }

  // Timed by the clock, so it also finishes while it isn't drawn (third
  // person, a menu open).
  _tick() {
    const e = this.eating
    if (!e) return
    e.t = (performance.now() - e.at) / 1000
    if (e.t >= EAT_TIME) this.eating = null
  }

  // Shown this frame: the food being eaten, else the held one (or null).
  showing(heldId) {
    this._tick()
    if (this.eating) return this.eating.id
    return isHeldFood(heldId) ? heldId : null
  }

  // How many bites are gone so far, and how far toward the mouth (0..1),
  // plus a little forward jab on each bite.
  _pose() {
    const e = this.eating
    if (!e) return { lift: 0, jab: 0, bites: 0 }
    const t = e.t
    const lift = Math.min(1, t / LIFT, (EAT_TIME - t) / LIFT)
    const bt = (t - LIFT) / BITE
    const inBites = bt >= 0 && bt < BITES
    const jab = inBites ? Math.sin((bt % 1) * Math.PI) : 0
    // A bite lands at the top of each jab.
    const bites = Math.max(0, Math.min(BITES, Math.floor(bt + 0.5)))
    return { lift: Math.max(0, lift), jab, bites }
  }

  // Moves the hands (`hand`, the group with the arms) and the food for
  // this frame; `dt` in seconds. -> the id shown, or null.
  update(dt, heldId, hand, scene) {
    const id = this.showing(heldId)
    const { lift, jab, bites } = this._pose()
    if (this.eating && bites > this.eating.bites) {
      this.eating.bites = bites
      this._bite(scene)
    }
    if (id) this._setModel(id, this.eating ? bites : 0)
    // Toward the mouth (the bottom middle of the view, closer in), turned
    // so its bitten corner faces you.
    const ease = lift * lift * (3 - 2 * lift)
    // (The hands move without turning: turning the group swings the arms
    // round the camera and they cover the view.)
    hand.position.set(-0.07 * ease, 0.07 * ease - jab * 0.012, 0.1 * ease + jab * 0.04)
    hand.rotation.set(0, 0, 0)
    this.group.rotation.set(0.1 + 0.3 * ease, 0.45 - 0.5 * ease, -0.35 + 0.25 * ease)
    this._updateCrumbs(dt, scene)
    return id
  }

  _setModel(id, bites) {
    const key = `${id}|${bites}`
    if (key === this._key) return
    this._key = key
    let geo = this._geos.get(key)
    if (!geo) {
      geo = buildGeometry(bitten(pixelsOf(id), bites))
      this._geos.set(key, geo)
    }
    this.mesh.geometry = geo
  }

  // A crunch and a few crumbs falling from the bitten corner.
  _bite(scene) {
    this.onBite?.()
    if (!scene) return
    const list = pixelsOf(this.eating.id)
    const [r, g, b] = (list[(list.length * 0.7) | 0] || [0, 0, 0.6, 0.4, 0.3]).slice(2)
    const from = new THREE.Vector3(5 * PX, 5 * PX, 0)
    this.mesh.updateWorldMatrix(true, false)
    this.mesh.localToWorld(from)
    for (let i = 0; i < CRUMBS; i++) {
      const m = new THREE.Mesh(this._crumbGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(r * TONE, g * TONE, b * TONE) }))
      m.position.copy(from)
      m.frustumCulled = false
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.25, Math.random() * 0.12, (Math.random() - 0.2) * 0.12)
      m.userData.life = 0.35
      scene.add(m)
      this._crumbs.push(m)
    }
  }

  // Nothing to show any more: crumbs still falling go too (they'd hang
  // in front of the gun otherwise).
  clearCrumbs(scene) {
    for (const m of this._crumbs) {
      scene?.remove(m)
      m.material.dispose()
    }
    this._crumbs.length = 0
  }

  _updateCrumbs(dt, scene) {
    for (let i = this._crumbs.length - 1; i >= 0; i--) {
      const m = this._crumbs[i]
      m.userData.life -= dt
      m.userData.v.y -= 1.2 * dt
      m.position.addScaledVector(m.userData.v, dt)
      m.rotation.x += dt * 8
      if (m.userData.life <= 0) {
        scene?.remove(m)
        m.material.dispose()
        this._crumbs.splice(i, 1)
      }
    }
  }
}
