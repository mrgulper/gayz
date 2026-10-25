// More kinds of zombie (2026-10-24, Gaymi: "use pixels and redesign the
// zombies not human body shapes" - then "keep the current zombies but add
// more types of zombies"). Pixel-art monsters that join the waves next to
// the regular zombies and the skeletons (BuildSurvival._spawnZombie):
//
// - hunched: a bent-over ghoul, big head pushed forward, glowing eyes,
//   long arms dragging near the ground. Slower, hits harder.
// - blob: a rotting lump that squashes and stretches as it hops, a wide
//   mouth full of teeth. Slow and tough.
// - beast: a zombie dog on all fours with a long jaw and a tail. Fast,
//   easy to kill.
//
// Built from boxes (model units: blocks), every face painted procedurally
// 16x16 and drawn crisp, so they match the block world. A monster's
// geometry and pictures are shared by every monster of its kind; each one
// gets its own materials (they flash red when hit and fade when dead).
import * as THREE from 'three'
import { MOB_HEIGHT } from './PlayRules.js'

// hp / speed / damage: times a regular zombie's. tall: how much of a
// zombie's height it is (shots above it miss).
export const MONSTER_KINDS = {
  hunched: { hp: 1.3, speed: 0.9, damage: 1.35, tall: 1 },
  blob: { hp: 1.8, speed: 0.7, damage: 1.1, tall: 0.75 },
  beast: { hp: 0.65, speed: 1.55, damage: 0.8, tall: 0.6 },
}

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A 16x16 picture: `base` colours picked at random per pixel (weighted
// toward the first), then `draw(set, r)` adds the details.
function paint(seed, base, draw) {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')
  const r = rng(seed)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = base[Math.floor(Math.pow(r(), 1.6) * base.length)]
      g.fillRect(x, y, 1, 1)
    }
  }
  const set = (x, y, col, w = 1, h = 1) => {
    g.fillStyle = col
    g.fillRect(x, y, w, h)
  }
  draw?.(set, r)
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const SKIN = ['#6f8a4a', '#5e7a3e', '#7f9a55', '#4e6533', '#8a7a4a']
const DARK_SKIN = ['#4a5e33', '#3f522b', '#56693b', '#33421f']
const RAGS = ['#4a3b52', '#3d3046', '#5a4a63', '#2f2536']
const SLIME = ['#7aa84a', '#6b9a3e', '#8bbf55', '#5a8a35', '#9ccf66']
const FUR = ['#5b5a52', '#4d4c45', '#6a685e', '#3f3e38']

// Patches of darker rot and a few wounds.
const rot = (set, r, n = 6) => {
  for (let i = 0; i < n; i++) set(Math.floor(r() * 15), Math.floor(r() * 15), '#3a4a26', 1 + Math.floor(r() * 2), 1)
  for (let i = 0; i < 2; i++) set(Math.floor(r() * 14), Math.floor(r() * 14), '#7a2a24', 2, 1)
}

let pictures = null
function kindPictures() {
  if (pictures) return pictures
  pictures = {
    skin: paint(11, SKIN, (set, r) => rot(set, r)),
    darkSkin: paint(12, DARK_SKIN, (set, r) => rot(set, r, 4)),
    rags: paint(13, RAGS, (set, r) => {
      // Torn: holes showing skin, a frayed hem.
      for (let i = 0; i < 4; i++) set(Math.floor(r() * 13), Math.floor(r() * 13), SKIN[1], 2, 2)
      for (let x = 0; x < 16; x += 2) set(x, 14 + Math.floor(r() * 2), SKIN[0], 1, 2)
    }),
    // A face: two glowing eyes, a dark mouth with teeth.
    face: paint(14, SKIN, (set) => {
      set(3, 5, '#1a1a10', 4, 3)
      set(9, 5, '#1a1a10', 4, 3)
      set(4, 6, '#ffe24a', 2, 1)
      set(10, 6, '#ffe24a', 2, 1)
      set(4, 11, '#2a0d0a', 8, 3)
      for (let x = 4; x < 12; x += 2) set(x, 11, '#e8e0c0')
    }),
    slime: paint(15, SLIME, (set, r) => {
      // Drips and darker bubbles.
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(r() * 16)
        set(x, 12 + Math.floor(r() * 3), '#4a7a2a', 1, 4)
      }
      for (let i = 0; i < 5; i++) set(Math.floor(r() * 14), Math.floor(r() * 10), '#5a8a35', 2, 2)
    }),
    slimeFace: paint(16, SLIME, (set) => {
      set(2, 3, '#101808', 4, 4)
      set(10, 3, '#101808', 4, 4)
      set(3, 4, '#ff5a3a', 2, 2)
      set(11, 4, '#ff5a3a', 2, 2)
      set(2, 9, '#1a0a08', 12, 5)
      for (let x = 2; x < 14; x += 2) {
        set(x, 9, '#f0ead0')
        set(x + 1, 13, '#f0ead0')
      }
    }),
    fur: paint(17, FUR, (set, r) => {
      rot(set, r, 3)
      // Bare ribs on the side.
      for (let y = 5; y < 12; y += 2) set(5, y, '#d8d0b8', 6, 1)
    }),
    dogFace: paint(18, FUR, (set) => {
      set(2, 3, '#120a06', 4, 3)
      set(10, 3, '#120a06', 4, 3)
      set(3, 4, '#ff3a2a', 2, 1)
      set(11, 4, '#ff3a2a', 2, 1)
      set(3, 10, '#2a0a06', 10, 4)
      for (let x = 3; x < 13; x += 2) set(x, 10, '#efe6c8', 1, 2)
    }),
  }
  return pictures
}

// A box of w x h x d blocks whose origin is `pivot` (0..1 of each side,
// default the middle of its top - where a limb hangs from).
function box(w, h, d, pivot = [0.5, 1, 0.5]) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate((0.5 - pivot[0]) * w, (0.5 - pivot[1]) * h, (0.5 - pivot[2]) * d)
  return g
}

// Per kind: the parts - { name, geo, pic, front (face picture on +z), at
// [x, y, z], rot [x, y, z] } - built once.
const designs = {}
function design(kind) {
  if (designs[kind]) return designs[kind]
  let parts
  if (kind === 'hunched') {
    parts = [
      { name: 'legL', geo: box(0.24, 0.7, 0.26), pic: 'rags', at: [-0.17, 0.7, 0] },
      { name: 'legR', geo: box(0.24, 0.7, 0.26), pic: 'rags', at: [0.17, 0.7, 0] },
      // The back bends forward from the hips.
      { name: 'torso', geo: box(0.62, 0.8, 0.4, [0.5, 0, 0.5]), pic: 'rags', at: [0, 0.68, 0], rot: [0.55, 0, 0] },
      { name: 'head', geo: box(0.56, 0.52, 0.52, [0.5, 0, 0.5]), pic: 'skin', front: 'face', parent: 'torso', at: [0, 0.74, 0.12], rot: [-0.35, 0, 0] },
      { name: 'armL', geo: box(0.18, 1.12, 0.18), pic: 'darkSkin', parent: 'torso', at: [-0.42, 0.7, 0], rot: [-0.45, 0, 0.08] },
      { name: 'armR', geo: box(0.18, 1.12, 0.18), pic: 'darkSkin', parent: 'torso', at: [0.42, 0.7, 0], rot: [-0.45, 0, -0.08] },
    ]
  } else if (kind === 'blob') {
    parts = [
      { name: 'body', geo: box(1.2, 1.2, 1.15, [0.5, 0, 0.5]), pic: 'slime', front: 'slimeFace', at: [0, 0, 0] },
      // Lumps on top.
      { name: 'lump', geo: box(0.55, 0.32, 0.55, [0.5, 0, 0.5]), pic: 'slime', parent: 'body', at: [-0.2, 1.2, -0.15] },
    ]
  } else {
    parts = [
      { name: 'body', geo: box(0.55, 0.5, 1.15, [0.5, 0, 0.5]), pic: 'fur', at: [0, 0.6, 0] },
      { name: 'head', geo: box(0.48, 0.44, 0.55, [0.5, 0.3, 0]), pic: 'fur', front: 'dogFace', parent: 'body', at: [0, 0.4, 0.5] },
      { name: 'legFL', geo: box(0.17, 0.62, 0.17), pic: 'darkSkin', at: [-0.18, 0.62, 0.42] },
      { name: 'legFR', geo: box(0.17, 0.62, 0.17), pic: 'darkSkin', at: [0.18, 0.62, 0.42] },
      { name: 'legBL', geo: box(0.17, 0.62, 0.17), pic: 'darkSkin', at: [-0.18, 0.62, -0.42] },
      { name: 'legBR', geo: box(0.17, 0.62, 0.17), pic: 'darkSkin', at: [0.18, 0.62, -0.42] },
      { name: 'tail', geo: box(0.1, 0.1, 0.5, [0.5, 0.5, 1]), pic: 'darkSkin', parent: 'body', at: [0, 0.4, -0.57], rot: [0.5, 0, 0] },
    ]
  }
  designs[kind] = parts
  return parts
}

// A new monster of `kind`, `height` world units for a regular zombie's
// height. -> { root, materials, kind, update(dt, moveLen), dispose() }.
export function makeMonster(kind, height) {
  const pics = kindPictures()
  const root = new THREE.Group()
  const scale = new THREE.Group()
  scale.scale.setScalar(height / MOB_HEIGHT)
  root.add(scale)
  const materials = []
  const mat = (pic) => {
    const m = new THREE.MeshLambertMaterial({ map: pics[pic], emissive: 0x000000 })
    materials.push(m)
    return m
  }
  const nodes = {}
  for (const p of design(kind)) {
    const side = mat(p.pic)
    // Box faces: +x, -x, +y, -y, +z (front), -z.
    const material = p.front ? [side, side, side, side, mat(p.front), side] : side
    const mesh = new THREE.Mesh(p.geo, material)
    mesh.position.set(...p.at)
    if (p.rot) mesh.rotation.set(...p.rot)
    mesh.userData.rest = mesh.rotation.clone()
    ;(p.parent ? nodes[p.parent] : scale).add(mesh)
    nodes[p.name] = mesh
  }
  let t = Math.random() * 6
  const rest = (n) => nodes[n].userData.rest
  return {
    root,
    materials,
    kind,
    // moveLen: how fast it's going (blocks/s).
    update(dt, moveLen) {
      t += dt * (1 + moveLen * 1.6)
      const go = Math.min(1, moveLen / 2)
      if (kind === 'hunched') {
        const s = Math.sin(t * 1.8) * 0.6 * go
        nodes.legL.rotation.x = s
        nodes.legR.rotation.x = -s
        // Long arms swing loose, a little out of step.
        nodes.armL.rotation.x = rest('armL').x - s * 0.5 + Math.sin(t * 0.9) * 0.08
        nodes.armR.rotation.x = rest('armR').x + s * 0.5 + Math.sin(t * 0.9 + 1) * 0.08
        nodes.head.rotation.z = Math.sin(t * 0.7) * 0.12
      } else if (kind === 'blob') {
        // Hops: squashed when it lands, stretched in the air.
        const hop = Math.abs(Math.sin(t * 2.2))
        const k = 0.2 * (0.3 + go)
        nodes.body.scale.set(1 + k * (1 - hop) * 0.6, 1 - k * (1 - hop) + k * hop * 0.4, 1 + k * (1 - hop) * 0.6)
        nodes.body.position.y = hop * 0.35 * go
      } else {
        // A gallop: front and back pairs in turn.
        const s = Math.sin(t * 2.6) * 0.75 * go
        nodes.legFL.rotation.x = s
        nodes.legFR.rotation.x = s * 0.8
        nodes.legBL.rotation.x = -s
        nodes.legBR.rotation.x = -s * 0.8
        nodes.body.rotation.x = Math.sin(t * 2.6) * 0.06 * go
        nodes.tail.rotation.y = Math.sin(t * 5) * 0.4
        nodes.head.rotation.x = Math.sin(t * 1.3) * 0.08
      }
    },
    // Geometry and pictures are shared - only this one's materials go.
    dispose() {
      for (const m of materials) m.dispose()
    },
  }
}
