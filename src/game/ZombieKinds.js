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
// Five more (2026-10-26, Gaymi: "redesign the zombies dont make them
// human shape or some can still be human shape but make more types"):
// - crawler: no legs, drags itself along the ground on its arms. Low,
//   so it's hard to hit; slow-ish.
// - spider: a zombie spider on eight legs that climbs straight up walls.
//   Out of the waves since 2026-10-26 (Gaymi: "make the spider a friendly
//   animal instead of zombie type" - see AnimalKinds.js); waves: false.
// - brute: a huge hunched tank with giant arms - still 2 blocks tall,
//   but very wide. Slow, takes many shots, hits very hard.
// - bloater: a swollen belly on stubby legs that bursts when it dies,
//   hurting everyone (and every zombie) close by.
// - skinny: a tall, thin, pale runner. Very fast, very weak.
//
// Twelve more that only live in one place (2026-10-30, Gaymi: "make
// demons underground but in heaven make angels", "ocean will have new
// zombies") - `realm` says where; they never join the usual mix
// (BuildSurvival._spawnZombie picks them by where a zombie appears):
// - heaven (HeavenRealm.js, y 300+): angel (white robe, halo, wings),
//   seraph (a floating eye in six wings), archangel (gold armour and a
//   sword - big and tough), cherub (a small floating winged child).
//   Angels never burn in the sun.
// - demon (the Demon Realm, below y -300): imp (thin, horned, quick),
//   hellhound (a burning dog), demon (a huge horned brute with bat
//   wings), fiend (a hunched clawed ghoul).
// - ocean (in or by the sea): drowned (soggy, seaweed-wrapped), sharkman
//   (a shark's head and fin), jelly (a glowing jellyfish), angler (a
//   deep-sea fish-man with a glowing lure).
// Parts marked `glow` are drawn unlit (always bright): halos, eyes, lures.
//
// Built from boxes (model units: blocks), every face painted procedurally
// 16x16 and drawn crisp, so they match the block world. A monster's
// geometry and pictures are shared by every monster of its kind; each one
// gets its own materials (they flash red when hit and fade when dead).
import * as THREE from 'three'
import { MOB_HEIGHT } from './PlayRules.js'

// hp / speed / damage: times a regular zombie's. tall: how much of a
// zombie's height it is (shots above it miss).
// wide: its hit box's width, times a zombie's. climbs: goes straight up
// walls. burst: blows up when killed, hurting things this many blocks round.
// waves: false - never joins the waves.
export const MONSTER_KINDS = {
  hunched: { hp: 1.3, speed: 0.9, damage: 1.35, tall: 1 },
  blob: { hp: 1.8, speed: 0.7, damage: 1.1, tall: 0.75 },
  beast: { hp: 0.65, speed: 1.55, damage: 0.8, tall: 0.6 },
  crawler: { hp: 0.8, speed: 0.75, damage: 0.9, tall: 0.35 },
  spider: { hp: 0.9, speed: 1.2, damage: 0.9, tall: 0.45, wide: 1.6, climbs: true, waves: false },
  brute: { hp: 3, speed: 0.6, damage: 2, tall: 1, wide: 1.7 },
  bloater: { hp: 1.2, speed: 0.75, damage: 1, tall: 1, wide: 1.4, burst: 3.5 },
  skinny: { hp: 0.6, speed: 1.45, damage: 0.85, tall: 1 },
  angel: { hp: 1.3, speed: 1.1, damage: 1.1, tall: 1, realm: 'heaven', noSun: true, waves: false },
  seraph: { hp: 1, speed: 1.3, damage: 1, tall: 1, realm: 'heaven', noSun: true, waves: false },
  archangel: { hp: 2.6, speed: 0.85, damage: 1.8, tall: 1, wide: 1.3, realm: 'heaven', noSun: true, waves: false },
  cherub: { hp: 0.7, speed: 1.4, damage: 0.8, tall: 1, realm: 'heaven', noSun: true, waves: false },
  imp: { hp: 0.8, speed: 1.5, damage: 0.9, tall: 1, realm: 'demon', waves: false },
  hellhound: { hp: 0.9, speed: 1.65, damage: 1.1, tall: 0.6, realm: 'demon', waves: false },
  demon: { hp: 3, speed: 0.7, damage: 2, tall: 1, wide: 1.5, realm: 'demon', waves: false },
  fiend: { hp: 1.4, speed: 1, damage: 1.4, tall: 1, realm: 'demon', waves: false },
  drowned: { hp: 1.1, speed: 0.95, damage: 1, tall: 1, realm: 'ocean', waves: false },
  sharkman: { hp: 1.6, speed: 1.2, damage: 1.5, tall: 1, realm: 'ocean', waves: false },
  jelly: { hp: 0.8, speed: 0.8, damage: 1.2, tall: 1, realm: 'ocean', waves: false },
  angler: { hp: 1.4, speed: 0.9, damage: 1.3, tall: 1, realm: 'ocean', waves: false },
}

// Kinds animated by the shared realm moves (makeMonster's update).
const REALM_ANIM = new Set(Object.keys(MONSTER_KINDS).filter((k) => MONSTER_KINDS[k].realm))

// The kinds that live in each realm.
export const REALM_KINDS = { heaven: [], demon: [], ocean: [] }
for (const [id, k] of Object.entries(MONSTER_KINDS)) if (k.realm) REALM_KINDS[k.realm].push(id)

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
const BLOAT = ['#9aaa6a', '#8a9a5c', '#a8b878', '#7c8c50', '#b4b07a']
const SHELL = ['#2a2230', '#231c29', '#33293a', '#1c1621']
const PALE = ['#b8bfa2', '#a9b094', '#c4caaf', '#9aa286']
const BRUTE = ['#56703a', '#4b6332', '#607c42', '#3f5429', '#6a6a3e']
const ROBE = ['#f4f1e8', '#e9e4d6', '#fbf9f2', '#ded8c6']
const GOLD = ['#f2c94c', '#e5b83a', '#f8d870', '#d4a52c']
const HOLY_SKIN = ['#f3dcc4', '#ecd2b8', '#f7e4d0']
const FEATHER = ['#ffffff', '#f2f0ea', '#e6e3da', '#fbfaf6']
const RED_SKIN = ['#b3261e', '#9e2019', '#c43327', '#86190f']
const HELL_FUR = ['#2a1210', '#36160f', '#1f0d0b', '#4a1a10']
const BAT = ['#3a1418', '#2d0f12', '#47191d']
const DROWNED = ['#4f8a86', '#447a76', '#5b9a94', '#3a6a66']
const KELP = ['#2f6a2a', '#3a7a30', '#285a22', '#4a8a3a']
const SHARK = ['#7d8c99', '#6f7e8b', '#8a99a6', '#64727e']
const JELLY = ['#f29ad8', '#e888cc', '#f7b0e2', '#d978c0']
const DEEP = ['#2a3040', '#232838', '#323a4c', '#1c2130']

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
    // Swollen skin: dark veins and yellow boils.
    bloat: paint(19, BLOAT, (set, r) => {
      for (let i = 0; i < 5; i++) {
        let x = Math.floor(r() * 16)
        for (let y = 0; y < 16; y += 1) {
          set(x, y, '#5a4a6a')
          if (r() < 0.3) x = Math.max(0, Math.min(15, x + (r() < 0.5 ? -1 : 1)))
        }
      }
      for (let i = 0; i < 4; i++) {
        const x = 1 + Math.floor(r() * 12)
        const y = 1 + Math.floor(r() * 12)
        set(x, y, '#d8c84a', 2, 2)
        set(x, y, '#f2e27a')
      }
    }),
    bloatFace: paint(20, BLOAT, (set) => {
      set(4, 4, '#1a1a10', 3, 3)
      set(9, 4, '#1a1a10', 3, 3)
      set(5, 5, '#e8f05a')
      set(10, 5, '#e8f05a')
      set(5, 10, '#3a1410', 6, 4)
      set(6, 13, '#9ac04a', 2, 3)
    }),
    // A dark shell with a red mark.
    shell: paint(21, SHELL, (set, r) => {
      set(6, 3, '#8a1a1a', 4, 2)
      set(7, 5, '#8a1a1a', 2, 6)
      set(5, 9, '#8a1a1a', 6, 2)
      for (let i = 0; i < 6; i++) set(Math.floor(r() * 16), Math.floor(r() * 16), '#4a3e52')
    }),
    // Eight red eyes and fangs.
    spiderFace: paint(22, SHELL, (set) => {
      for (const [x, y] of [[3, 4], [6, 3], [9, 3], [12, 4], [4, 7], [7, 6], [8, 6], [11, 7]]) set(x, y, '#ff2a1a', 2, 2)
      set(5, 11, '#d8d0b8', 2, 4)
      set(9, 11, '#d8d0b8', 2, 4)
    }),
    pale: paint(23, PALE, (set, r) => {
      for (let i = 0; i < 5; i++) set(Math.floor(r() * 15), Math.floor(r() * 15), '#7a8070', 1, 2)
      for (let y = 3; y < 13; y += 2) set(4, y, '#8a9078', 8, 1)
    }),
    paleFace: paint(24, PALE, (set) => {
      set(4, 3, '#0a0a0a', 3, 5)
      set(9, 3, '#0a0a0a', 3, 5)
      set(5, 5, '#c8f0ff')
      set(10, 5, '#c8f0ff')
      set(5, 10, '#0a0a0a', 6, 5)
    }),
    bruteSkin: paint(25, BRUTE, (set, r) => {
      rot(set, r, 8)
      // Stitches and scars.
      for (let x = 2; x < 14; x += 2) set(x, 8, '#2a1a12', 1, 2)
      set(2, 9, '#2a1a12', 12, 1)
    }),
    bruteFace: paint(26, BRUTE, (set) => {
      set(3, 4, '#2a2a1a', 10, 2)
      set(4, 6, '#ff6a1a', 2, 2)
      set(10, 6, '#ff6a1a', 2, 2)
      set(3, 11, '#1a0a08', 10, 4)
      set(4, 10, '#e8e0c0', 2, 2)
      set(10, 10, '#e8e0c0', 2, 2)
    }),
    bone: paint(27, ['#d8d0b8', '#c8c0a6', '#e4dcc6']),
    // Heaven.
    robe: paint(30, ROBE, (set, r) => {
      for (let i = 0; i < 3; i++) set(Math.floor(r() * 15), 0, '#d8cfb4', 1, 16)
      set(0, 14, '#e5c158', 16, 1)
    }),
    holySkin: paint(31, HOLY_SKIN),
    holyFace: paint(32, HOLY_SKIN, (set) => {
      set(3, 5, '#fff7c2', 4, 3)
      set(9, 5, '#fff7c2', 4, 3)
      set(4, 6, '#ffd23a', 2, 1)
      set(10, 6, '#ffd23a', 2, 1)
      set(5, 11, '#7a3a2a', 6, 1)
    }),
    gold: paint(33, GOLD, (set, r) => {
      for (let i = 0; i < 6; i++) set(Math.floor(r() * 15), Math.floor(r() * 15), '#fff0a8', 2, 1)
    }),
    feather: paint(34, FEATHER, (set) => {
      for (let y = 2; y < 16; y += 3) set(0, y, '#d6d2c6', 16, 1)
    }),
    eye: paint(35, FEATHER, (set) => {
      set(3, 3, '#7ac8ff', 10, 10)
      set(5, 5, '#1a3a8a', 6, 6)
      set(7, 7, '#050a1a', 2, 2)
      set(5, 4, '#ffffff', 2, 1)
    }),
    // The Demon Realm.
    redSkin: paint(40, RED_SKIN, (set, r) => {
      for (let i = 0; i < 5; i++) set(Math.floor(r() * 15), Math.floor(r() * 15), '#5a0c08', 1, 2)
    }),
    demonFace: paint(41, RED_SKIN, (set) => {
      set(2, 4, '#120404', 5, 3)
      set(9, 4, '#120404', 5, 3)
      set(3, 5, '#ffd21a', 3, 1)
      set(10, 5, '#ffd21a', 3, 1)
      set(3, 10, '#1a0402', 10, 4)
      for (const x of [3, 5, 10, 12]) set(x, 10, '#f0e8d0', 1, 2)
    }),
    horn: paint(42, ['#2a2420', '#3a322a', '#1c1814'], (set) => set(0, 0, '#8a7a60', 16, 3)),
    hellFur: paint(43, HELL_FUR, (set, r) => {
      for (let i = 0; i < 8; i++) set(Math.floor(r() * 15), Math.floor(r() * 15), '#ff5a14', 1, 1)
    }),
    hellFace: paint(44, HELL_FUR, (set) => {
      set(2, 3, '#ffb21a', 4, 3)
      set(10, 3, '#ffb21a', 4, 3)
      set(3, 10, '#ff4a0a', 10, 4)
      for (let x = 3; x < 13; x += 2) set(x, 10, '#f0e8d0', 1, 2)
    }),
    flame: paint(45, ['#ff7a14', '#ffa21a', '#ff5a0a', '#ffd04a']),
    bat: paint(46, BAT, (set) => {
      for (let x = 2; x < 16; x += 4) set(x, 0, '#1a0608', 1, 16)
    }),
    // The ocean.
    drowned: paint(50, DROWNED, (set, r) => rot(set, r, 3)),
    drownedFace: paint(51, DROWNED, (set) => {
      set(3, 5, '#0a1a1a', 4, 3)
      set(9, 5, '#0a1a1a', 4, 3)
      set(4, 6, '#7af0ff', 2, 1)
      set(10, 6, '#7af0ff', 2, 1)
      set(4, 11, '#0a1414', 8, 2)
    }),
    kelp: paint(52, KELP, (set, r) => {
      for (let i = 0; i < 5; i++) set(Math.floor(r() * 16), 0, '#1f4a1a', 1, 16)
    }),
    shark: paint(53, SHARK, (set) => set(0, 11, '#dfe4e8', 16, 5)),
    sharkFace: paint(54, SHARK, (set) => {
      set(2, 3, '#0a0a0a', 3, 3)
      set(11, 3, '#0a0a0a', 3, 3)
      set(1, 9, '#2a0a0a', 14, 5)
      for (let x = 1; x < 15; x += 2) {
        set(x, 9, '#ffffff', 1, 2)
        set(x + 1, 12, '#ffffff', 1, 2)
      }
    }),
    jelly: paint(55, JELLY, (set, r) => {
      for (let i = 0; i < 6; i++) set(Math.floor(r() * 14), Math.floor(r() * 14), '#ffe0f4', 2, 2)
    }),
    deep: paint(56, DEEP, (set, r) => {
      for (let i = 0; i < 8; i++) set(Math.floor(r() * 15), Math.floor(r() * 15), '#4a5a7a', 1, 1)
    }),
    anglerFace: paint(57, DEEP, (set) => {
      set(3, 2, '#e8f4ff', 3, 3)
      set(10, 2, '#e8f4ff', 3, 3)
      set(4, 3, '#0a0a0a')
      set(11, 3, '#0a0a0a')
      set(0, 8, '#0a0408', 16, 7)
      for (let x = 0; x < 16; x += 2) {
        set(x, 8, '#f0f0e0', 1, 3)
        set(x + 1, 13, '#f0f0e0', 1, 2)
      }
    }),
    lure: paint(58, ['#fff27a', '#ffe84a', '#fffbc0']),
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
  } else if (kind === 'crawler') {
    // Lying on its front, legs gone, pulling itself on long arms.
    parts = [
      { name: 'torso', geo: box(0.56, 0.32, 0.92, [0.5, 0, 0.5]), pic: 'rags', at: [0, 0.08, -0.25] },
      { name: 'spine', geo: box(0.14, 0.12, 0.42, [0.5, 0, 1]), pic: 'bone', parent: 'torso', at: [0, 0.12, -0.46] },
      { name: 'head', geo: box(0.46, 0.42, 0.44, [0.5, 0.15, 0]), pic: 'skin', front: 'face', at: [0, 0.3, 0.2], rot: [-0.25, 0, 0] },
      { name: 'armL', geo: box(0.15, 0.8, 0.15), pic: 'darkSkin', at: [-0.34, 0.36, 0.12], rot: [-1.2, 0, 0.15] },
      { name: 'armR', geo: box(0.15, 0.8, 0.15), pic: 'darkSkin', at: [0.34, 0.36, 0.12], rot: [-1.2, 0, -0.15] },
    ]
  } else if (kind === 'spider') {
    parts = [
      { name: 'body', geo: box(0.62, 0.42, 0.56, [0.5, 0, 0.5]), pic: 'shell', front: 'spiderFace', at: [0, 0.42, 0.22] },
      { name: 'tail', geo: box(0.92, 0.62, 1.0, [0.5, 0.3, 1]), pic: 'shell', parent: 'body', at: [0, 0.22, -0.26], rot: [-0.2, 0, 0] },
    ]
    // Four legs a side, splayed out and down from the body.
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1
      const k = i % 4
      const z = 0.38 - k * 0.24
      parts.push({ name: `leg${i}`, geo: box(0.08, 1.05, 0.08), pic: 'shell', at: [side * 0.3, 0.68, z], rot: [(k - 1.5) * 0.25, 0, -side * 0.95] })
    }
  } else if (kind === 'brute') {
    // 2 blocks tall like every standing mob, but built like a wall.
    parts = [
      { name: 'legL', geo: box(0.42, 0.7, 0.42), pic: 'rags', at: [-0.3, 0.7, 0] },
      { name: 'legR', geo: box(0.42, 0.7, 0.42), pic: 'rags', at: [0.3, 0.7, 0] },
      { name: 'torso', geo: box(1.25, 0.96, 0.72, [0.5, 0, 0.5]), pic: 'bruteSkin', at: [0, 0.66, 0], rot: [0.22, 0, 0] },
      { name: 'head', geo: box(0.44, 0.4, 0.42, [0.5, 0, 0.5]), pic: 'bruteSkin', front: 'bruteFace', parent: 'torso', at: [0, 0.9, 0.22], rot: [-0.2, 0, 0] },
      { name: 'boneL', geo: box(0.22, 0.26, 0.22, [0.5, 0, 0.5]), pic: 'bone', parent: 'torso', at: [-0.5, 0.94, -0.08] },
      { name: 'boneR', geo: box(0.22, 0.26, 0.22, [0.5, 0, 0.5]), pic: 'bone', parent: 'torso', at: [0.5, 0.94, -0.08] },
      { name: 'armL', geo: box(0.44, 1.15, 0.44), pic: 'bruteSkin', parent: 'torso', at: [-0.84, 0.92, 0.05], rot: [-0.3, 0, 0.1] },
      { name: 'armR', geo: box(0.44, 1.15, 0.44), pic: 'bruteSkin', parent: 'torso', at: [0.84, 0.92, 0.05], rot: [-0.3, 0, -0.1] },
    ]
  } else if (kind === 'bloater') {
    // 2 blocks tall: stubby legs, a huge belly, a small head on top.
    parts = [
      { name: 'legL', geo: box(0.26, 0.52, 0.26), pic: 'rags', at: [-0.24, 0.52, 0] },
      { name: 'legR', geo: box(0.26, 0.52, 0.26), pic: 'rags', at: [0.24, 0.52, 0] },
      { name: 'belly', geo: box(1.15, 1.04, 1.05, [0.5, 0, 0.5]), pic: 'bloat', at: [0, 0.48, 0] },
      { name: 'boil1', geo: box(0.24, 0.24, 0.12, [0.5, 0.5, 0]), pic: 'bloat', parent: 'belly', at: [-0.25, 0.4, 0.52] },
      { name: 'boil2', geo: box(0.18, 0.18, 0.1, [0.5, 0.5, 0]), pic: 'bloat', parent: 'belly', at: [0.3, 0.7, 0.52] },
      { name: 'head', geo: box(0.48, 0.48, 0.48, [0.5, 0, 0.5]), pic: 'bloat', front: 'bloatFace', parent: 'belly', at: [0, 1.04, 0.1] },
      { name: 'armL', geo: box(0.16, 0.5, 0.16), pic: 'bloat', parent: 'belly', at: [-0.65, 0.88, 0.05], rot: [-0.3, 0, 0.3] },
      { name: 'armR', geo: box(0.16, 0.5, 0.16), pic: 'bloat', parent: 'belly', at: [0.65, 0.88, 0.05], rot: [-0.3, 0, -0.3] },
    ]
  } else if (kind === 'skinny') {
    // 2 blocks tall, all long thin limbs.
    parts = [
      { name: 'legL', geo: box(0.15, 0.96, 0.15), pic: 'pale', at: [-0.1, 0.96, 0] },
      { name: 'legR', geo: box(0.15, 0.96, 0.15), pic: 'pale', at: [0.1, 0.96, 0] },
      { name: 'torso', geo: box(0.38, 0.6, 0.2, [0.5, 0, 0.5]), pic: 'pale', at: [0, 0.94, 0], rot: [0.12, 0, 0] },
      { name: 'head', geo: box(0.38, 0.46, 0.38, [0.5, 0, 0.5]), pic: 'pale', front: 'paleFace', parent: 'torso', at: [0, 0.6, 0.02] },
      { name: 'armL', geo: box(0.11, 1.0, 0.11), pic: 'pale', parent: 'torso', at: [-0.25, 0.56, 0], rot: [-0.25, 0, 0.06] },
      { name: 'armR', geo: box(0.11, 1.0, 0.11), pic: 'pale', parent: 'torso', at: [0.25, 0.56, 0], rot: [-0.25, 0, -0.06] },
    ]
  } else if (kind === 'angel' || kind === 'archangel') {
    // 2 blocks tall, robed (or armoured in gold), a halo and big wings.
    const big = kind === 'archangel'
    const body = big ? 'gold' : 'robe'
    const w = big ? 1.25 : 1
    parts = [
      { name: 'legL', geo: box(0.22 * w, 0.8, 0.22), pic: body, at: [-0.13 * w, 0.8, 0] },
      { name: 'legR', geo: box(0.22 * w, 0.8, 0.22), pic: body, at: [0.13 * w, 0.8, 0] },
      { name: 'skirt', geo: box(0.62 * w, 0.42, 0.4, [0.5, 0, 0.5]), pic: 'robe', at: [0, 0.46, 0] },
      { name: 'torso', geo: box(0.58 * w, 0.64, 0.34, [0.5, 0, 0.5]), pic: body, at: [0, 0.82, 0] },
      { name: 'head', geo: box(0.42, 0.42, 0.42, [0.5, 0, 0.5]), pic: big ? 'gold' : 'holySkin', front: 'holyFace', parent: 'torso', at: [0, 0.64, 0] },
      { name: 'halo', geo: box(0.52, 0.05, 0.52, [0.5, 0, 0.5]), pic: 'gold', glow: true, parent: 'head', at: [0, 0.54, 0] },
      { name: 'armL', geo: box(0.15 * w, 0.66, 0.15 * w), pic: body, parent: 'torso', at: [-0.37 * w, 0.62, 0], rot: [-0.7, 0, 0.1] },
      { name: 'armR', geo: box(0.15 * w, 0.66, 0.15 * w), pic: body, parent: 'torso', at: [0.37 * w, 0.62, 0], rot: [-0.7, 0, -0.1] },
      { name: 'wingL', geo: box(0.06, big ? 1.2 : 0.95, big ? 0.95 : 0.75, [0.5, 0.25, 1]), pic: 'feather', parent: 'torso', at: [-0.16, 0.56, -0.15], rot: [0.25, 0.55, 0.3] },
      { name: 'wingR', geo: box(0.06, big ? 1.2 : 0.95, big ? 0.95 : 0.75, [0.5, 0.25, 1]), pic: 'feather', parent: 'torso', at: [0.16, 0.56, -0.15], rot: [0.25, -0.55, -0.3] },
    ]
    if (big) parts.push({ name: 'sword', geo: box(0.08, 1.1, 0.14, [0.5, 0.1, 0.5]), pic: 'gold', glow: true, parent: 'armR', at: [0, -0.62, 0.1], rot: [1.4, 0, 0] })
  } else if (kind === 'seraph') {
    // A great eye hanging in the air, wrapped in six wings.
    parts = [
      { name: 'float', geo: box(0.56, 0.56, 0.56, [0.5, 0.5, 0.5]), pic: 'feather', front: 'eye', at: [0, 1.35, 0] },
      { name: 'halo', geo: box(0.8, 0.05, 0.8, [0.5, 0.5, 0.5]), pic: 'gold', glow: true, parent: 'float', at: [0, 0.5, 0] },
    ]
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1
      const row = Math.floor(i / 2) - 1
      parts.push({ name: `wing${i}`, geo: box(0.06, 0.75, 0.55, [0.5, 0.1, 1]), pic: 'feather', parent: 'float', at: [side * 0.3, row * 0.32, -0.05], rot: [row * 0.6, side * -0.7, side * -(0.4 + row * 0.3)] })
    }
  } else if (kind === 'cherub') {
    // A small winged child floating at head height.
    parts = [
      { name: 'float', geo: box(0.46, 0.5, 0.36, [0.5, 0, 0.5]), pic: 'holySkin', at: [0, 1.05, 0] },
      { name: 'legL', geo: box(0.16, 0.34, 0.16), pic: 'holySkin', parent: 'float', at: [-0.12, 0.02, 0] },
      { name: 'legR', geo: box(0.16, 0.34, 0.16), pic: 'holySkin', parent: 'float', at: [0.12, 0.02, 0] },
      { name: 'head', geo: box(0.48, 0.46, 0.46, [0.5, 0, 0.5]), pic: 'holySkin', front: 'holyFace', parent: 'float', at: [0, 0.5, 0] },
      { name: 'halo', geo: box(0.46, 0.05, 0.46, [0.5, 0, 0.5]), pic: 'gold', glow: true, parent: 'head', at: [0, 0.56, 0] },
      { name: 'wingL', geo: box(0.05, 0.55, 0.45, [0.5, 0.25, 1]), pic: 'feather', parent: 'float', at: [-0.12, 0.42, -0.16], rot: [0.2, 0.6, 0.3] },
      { name: 'wingR', geo: box(0.05, 0.55, 0.45, [0.5, 0.25, 1]), pic: 'feather', parent: 'float', at: [0.12, 0.42, -0.16], rot: [0.2, -0.6, -0.3] },
    ]
  } else if (kind === 'imp' || kind === 'demon') {
    // Red, horned, a pointed tail and bat wings. The demon is a huge brute.
    const big = kind === 'demon'
    const w = big ? 1.55 : 0.8
    parts = [
      { name: 'legL', geo: box(0.22 * w, 0.78, 0.24 * w), pic: 'redSkin', at: [-0.16 * w, 0.78, 0] },
      { name: 'legR', geo: box(0.22 * w, 0.78, 0.24 * w), pic: 'redSkin', at: [0.16 * w, 0.78, 0] },
      { name: 'torso', geo: box(0.62 * w, 0.74, 0.4 * w, [0.5, 0, 0.5]), pic: 'redSkin', at: [0, 0.74, 0], rot: [big ? 0.18 : 0.08, 0, 0] },
      { name: 'head', geo: box(0.42, 0.44, 0.42, [0.5, 0, 0.5]), pic: 'redSkin', front: 'demonFace', parent: 'torso', at: [0, 0.72, big ? 0.12 : 0.02] },
      { name: 'hornL', geo: box(0.08, 0.3, 0.08, [0.5, 0, 0.5]), pic: 'horn', parent: 'head', at: [-0.15, 0.42, 0], rot: [0, 0, 0.4] },
      { name: 'hornR', geo: box(0.08, 0.3, 0.08, [0.5, 0, 0.5]), pic: 'horn', parent: 'head', at: [0.15, 0.42, 0], rot: [0, 0, -0.4] },
      { name: 'armL', geo: box(0.17 * w, 0.8, 0.17 * w), pic: 'redSkin', parent: 'torso', at: [-0.42 * w, 0.7, 0], rot: [-0.4, 0, 0.1] },
      { name: 'armR', geo: box(0.17 * w, 0.8, 0.17 * w), pic: 'redSkin', parent: 'torso', at: [0.42 * w, 0.7, 0], rot: [-0.4, 0, -0.1] },
      { name: 'tail', geo: box(0.08, 0.08, 0.7, [0.5, 0.5, 1]), pic: 'redSkin', parent: 'torso', at: [0, 0.05, -0.18], rot: [0.6, 0, 0] },
      { name: 'wingL', geo: box(0.05, big ? 1.1 : 0.6, big ? 1 : 0.55, [0.5, 0.25, 1]), pic: 'bat', parent: 'torso', at: [-0.18 * w, 0.62, -0.18], rot: [0.2, 0.7, 0.4] },
      { name: 'wingR', geo: box(0.05, big ? 1.1 : 0.6, big ? 1 : 0.55, [0.5, 0.25, 1]), pic: 'bat', parent: 'torso', at: [0.18 * w, 0.62, -0.18], rot: [0.2, -0.7, -0.4] },
    ]
  } else if (kind === 'fiend') {
    // Hunched like the ghoul, red-skinned with horns and long claws.
    parts = [
      { name: 'legL', geo: box(0.24, 0.7, 0.26), pic: 'hellFur', at: [-0.17, 0.7, 0] },
      { name: 'legR', geo: box(0.24, 0.7, 0.26), pic: 'hellFur', at: [0.17, 0.7, 0] },
      { name: 'torso', geo: box(0.62, 0.8, 0.4, [0.5, 0, 0.5]), pic: 'redSkin', at: [0, 0.68, 0], rot: [0.6, 0, 0] },
      { name: 'head', geo: box(0.5, 0.48, 0.5, [0.5, 0, 0.5]), pic: 'redSkin', front: 'demonFace', parent: 'torso', at: [0, 0.74, 0.12], rot: [-0.4, 0, 0] },
      { name: 'hornL', geo: box(0.08, 0.34, 0.08, [0.5, 0, 0.5]), pic: 'horn', parent: 'head', at: [-0.18, 0.46, -0.05], rot: [-0.4, 0, 0.3] },
      { name: 'hornR', geo: box(0.08, 0.34, 0.08, [0.5, 0, 0.5]), pic: 'horn', parent: 'head', at: [0.18, 0.46, -0.05], rot: [-0.4, 0, -0.3] },
      { name: 'armL', geo: box(0.18, 1.12, 0.18), pic: 'redSkin', parent: 'torso', at: [-0.42, 0.7, 0], rot: [-0.45, 0, 0.08] },
      { name: 'armR', geo: box(0.18, 1.12, 0.18), pic: 'redSkin', parent: 'torso', at: [0.42, 0.7, 0], rot: [-0.45, 0, -0.08] },
      { name: 'clawL', geo: box(0.22, 0.24, 0.06), pic: 'horn', parent: 'armL', at: [0, -1.1, 0.05] },
      { name: 'clawR', geo: box(0.22, 0.24, 0.06), pic: 'horn', parent: 'armR', at: [0, -1.1, 0.05] },
    ]
  } else if (kind === 'hellhound') {
    // A burning dog: black-red fur, glowing face, flames along its back.
    parts = [
      { name: 'body', geo: box(0.58, 0.52, 1.2, [0.5, 0, 0.5]), pic: 'hellFur', at: [0, 0.62, 0] },
      { name: 'head', geo: box(0.5, 0.46, 0.58, [0.5, 0.3, 0]), pic: 'hellFur', front: 'hellFace', parent: 'body', at: [0, 0.42, 0.52] },
      { name: 'legFL', geo: box(0.17, 0.64, 0.17), pic: 'hellFur', at: [-0.19, 0.64, 0.44] },
      { name: 'legFR', geo: box(0.17, 0.64, 0.17), pic: 'hellFur', at: [0.19, 0.64, 0.44] },
      { name: 'legBL', geo: box(0.17, 0.64, 0.17), pic: 'hellFur', at: [-0.19, 0.64, -0.44] },
      { name: 'legBR', geo: box(0.17, 0.64, 0.17), pic: 'hellFur', at: [0.19, 0.64, -0.44] },
      { name: 'tail', geo: box(0.1, 0.1, 0.5, [0.5, 0.5, 1]), pic: 'flame', glow: true, parent: 'body', at: [0, 0.42, -0.6], rot: [0.5, 0, 0] },
      { name: 'flame1', geo: box(0.16, 0.26, 0.16, [0.5, 0, 0.5]), pic: 'flame', glow: true, parent: 'body', at: [0, 0.52, 0.25] },
      { name: 'flame2', geo: box(0.14, 0.2, 0.14, [0.5, 0, 0.5]), pic: 'flame', glow: true, parent: 'body', at: [0, 0.52, -0.1] },
      { name: 'flame3', geo: box(0.12, 0.16, 0.12, [0.5, 0, 0.5]), pic: 'flame', glow: true, parent: 'body', at: [0, 0.52, -0.4] },
    ]
  } else if (kind === 'drowned' || kind === 'sharkman') {
    // 2 blocks tall: the drowned wrapped in kelp; the sharkman with a
    // shark's head and a fin on his back.
    const shark = kind === 'sharkman'
    const skin = shark ? 'shark' : 'drowned'
    parts = [
      { name: 'legL', geo: box(0.24, 0.8, 0.26), pic: 'kelp', at: [-0.14, 0.8, 0] },
      { name: 'legR', geo: box(0.24, 0.8, 0.26), pic: 'kelp', at: [0.14, 0.8, 0] },
      { name: 'torso', geo: box(0.6, 0.7, 0.36, [0.5, 0, 0.5]), pic: shark ? 'shark' : 'kelp', at: [0, 0.78, 0], rot: [0.1, 0, 0] },
      shark
        ? { name: 'head', geo: box(0.46, 0.44, 0.7, [0.5, 0, 0.3]), pic: 'shark', front: 'sharkFace', parent: 'torso', at: [0, 0.68, 0.05] }
        : { name: 'head', geo: box(0.44, 0.44, 0.44, [0.5, 0, 0.5]), pic: 'drowned', front: 'drownedFace', parent: 'torso', at: [0, 0.68, 0.02] },
      { name: 'armL', geo: box(0.16, 0.72, 0.16), pic: skin, parent: 'torso', at: [-0.38, 0.64, 0], rot: [-1.2, 0, 0.05] },
      { name: 'armR', geo: box(0.16, 0.72, 0.16), pic: skin, parent: 'torso', at: [0.38, 0.64, 0], rot: [-1.2, 0, -0.05] },
    ]
    if (shark) parts.push({ name: 'fin', geo: box(0.06, 0.5, 0.42, [0.5, 0, 0.5]), pic: 'shark', parent: 'torso', at: [0, 0.5, -0.2], rot: [-0.5, 0, 0] })
    else parts.push({ name: 'weed', geo: box(0.5, 0.5, 0.06, [0.5, 1, 0.5]), pic: 'kelp', parent: 'torso', at: [0.05, 0.7, -0.2], rot: [0.1, 0, 0.1] })
  } else if (kind === 'jelly') {
    // A glowing bell floating above the ground, long tentacles hanging.
    parts = [{ name: 'float', geo: box(1, 0.6, 1, [0.5, 0, 0.5]), pic: 'jelly', glow: true, at: [0, 1.25, 0] }]
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      parts.push({ name: `tent${i}`, geo: box(0.08, 1.1, 0.08), pic: 'jelly', parent: 'float', at: [Math.cos(a) * 0.34, 0.02, Math.sin(a) * 0.34] })
    }
  } else if (kind === 'angler') {
    // A hunched deep-sea fish-man: a huge toothy mouth and a glowing lure.
    parts = [
      { name: 'legL', geo: box(0.24, 0.66, 0.26), pic: 'deep', at: [-0.18, 0.66, 0] },
      { name: 'legR', geo: box(0.24, 0.66, 0.26), pic: 'deep', at: [0.18, 0.66, 0] },
      { name: 'torso', geo: box(0.7, 0.62, 0.5, [0.5, 0, 0.5]), pic: 'deep', at: [0, 0.62, 0], rot: [0.35, 0, 0] },
      { name: 'head', geo: box(0.72, 0.62, 0.6, [0.5, 0, 0.4]), pic: 'deep', front: 'anglerFace', parent: 'torso', at: [0, 0.6, 0.12], rot: [-0.3, 0, 0] },
      { name: 'stalk', geo: box(0.05, 0.5, 0.05, [0.5, 0, 0.5]), pic: 'deep', parent: 'head', at: [0, 0.6, 0.1], rot: [0.7, 0, 0] },
      { name: 'lure', geo: box(0.14, 0.14, 0.14, [0.5, 0.5, 0.5]), pic: 'lure', glow: true, parent: 'stalk', at: [0, 0.52, 0] },
      { name: 'armL', geo: box(0.17, 0.9, 0.17), pic: 'deep', parent: 'torso', at: [-0.44, 0.52, 0], rot: [-0.5, 0, 0.12] },
      { name: 'armR', geo: box(0.17, 0.9, 0.17), pic: 'deep', parent: 'torso', at: [0.44, 0.52, 0], rot: [-0.5, 0, -0.12] },
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
  const mat = (pic, glow) => {
    // Glowing parts are unlit (no emissive - BuildSurvival's hit flash
    // skips them).
    const m = glow ? new THREE.MeshBasicMaterial({ map: pics[pic] }) : new THREE.MeshLambertMaterial({ map: pics[pic], emissive: 0x000000 })
    materials.push(m)
    return m
  }
  const nodes = {}
  for (const p of design(kind)) {
    const side = mat(p.pic, p.glow)
    // Box faces: +x, -x, +y, -y, +z (front), -z.
    const material = p.front ? [side, side, side, side, mat(p.front, p.glow || kind === 'seraph'), side] : side
    const mesh = new THREE.Mesh(p.geo, material)
    mesh.position.set(...p.at)
    if (p.rot) mesh.rotation.set(...p.rot)
    mesh.userData.rest = mesh.rotation.clone()
    mesh.userData.y0 = mesh.position.y
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
      } else if (kind === 'crawler') {
        // Arms reach forward and pull in turn; the body lurches.
        const s = Math.sin(t * 2) * 0.55 * go
        nodes.armL.rotation.x = rest('armL').x + s
        nodes.armR.rotation.x = rest('armR').x - s
        nodes.torso.rotation.z = s * 0.12
        nodes.head.rotation.y = Math.sin(t * 0.8) * 0.2
      } else if (kind === 'spider') {
        // Legs scuttle in two sets of four.
        for (let i = 0; i < 8; i++) {
          const s = Math.sin(t * 4 + (i % 2) * Math.PI) * 0.35 * go
          nodes[`leg${i}`].rotation.x = rest(`leg${i}`).x + s
          nodes[`leg${i}`].rotation.z = rest(`leg${i}`).z + Math.abs(s) * 0.3 * (i < 4 ? 1 : -1)
        }
        nodes.tail.rotation.x = rest('tail').x + Math.sin(t * 1.5) * 0.06
      } else if (kind === 'brute') {
        // Heavy stomps, arms swinging like clubs.
        const s = Math.sin(t * 1.4) * 0.45 * go
        nodes.legL.rotation.x = s
        nodes.legR.rotation.x = -s
        nodes.armL.rotation.x = rest('armL').x - s * 0.7
        nodes.armR.rotation.x = rest('armR').x + s * 0.7
        nodes.torso.rotation.z = s * 0.08
      } else if (kind === 'bloater') {
        // Waddles; the belly swells and sags as it breathes.
        const s = Math.sin(t * 1.8) * 0.4 * go
        nodes.legL.rotation.x = s
        nodes.legR.rotation.x = -s
        nodes.belly.rotation.z = s * 0.1
        const b = 1 + Math.sin(t * 2.4) * 0.04
        nodes.belly.scale.set(b, 1, b)
      } else if (kind === 'skinny') {
        // A long, fast stride with arms pumping.
        const s = Math.sin(t * 2.2) * 0.8 * go
        nodes.legL.rotation.x = s
        nodes.legR.rotation.x = -s
        nodes.armL.rotation.x = rest('armL').x - s * 0.8
        nodes.armR.rotation.x = rest('armR').x + s * 0.8
        nodes.head.rotation.z = Math.sin(t * 1.1) * 0.1
      } else if (REALM_ANIM.has(kind)) {
        // The realm kinds: legs and arms swing, wings beat, tails and
        // tentacles sway, floating ones bob; a hellhound gallops.
        const s = Math.sin(t * 2) * 0.6 * go
        if (nodes.legFL) {
          nodes.legFL.rotation.x = s * 1.2
          nodes.legFR.rotation.x = s
          nodes.legBL.rotation.x = -s * 1.2
          nodes.legBR.rotation.x = -s
        } else if (nodes.legL) {
          nodes.legL.rotation.x = rest('legL').x + s
          nodes.legR.rotation.x = rest('legR').x - s
        }
        if (nodes.armL) {
          nodes.armL.rotation.x = rest('armL').x - s * 0.4
          nodes.armR.rotation.x = rest('armR').x + s * 0.4
        }
        const beat = Math.sin(t * 5)
        for (const [n, dir] of [['wingL', 1], ['wingR', -1]]) if (nodes[n]) nodes[n].rotation.y = rest(n).y + beat * 0.35 * dir
        for (let i = 0; i < 6; i++) {
          const w = nodes[`wing${i}`]
          if (w) w.rotation.y = rest(`wing${i}`).y + Math.sin(t * 6 + i) * 0.3 * (i % 2 ? -1 : 1)
          const tent = nodes[`tent${i}`]
          if (tent) {
            tent.rotation.x = Math.sin(t * 2.4 + i) * 0.25
            tent.rotation.z = Math.cos(t * 2 + i * 1.3) * 0.2
          }
        }
        if (nodes.tail) nodes.tail.rotation.y = Math.sin(t * 3) * 0.4
        if (nodes.float) nodes.float.position.y = nodes.float.userData.y0 + Math.sin(t * 1.6) * 0.12
        for (const n of ['flame1', 'flame2', 'flame3']) if (nodes[n]) nodes[n].scale.y = 0.8 + Math.abs(Math.sin(t * 7 + n.length)) * 0.5
        if (nodes.lure) nodes.lure.scale.setScalar(0.85 + Math.sin(t * 4) * 0.15)
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
