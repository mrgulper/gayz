// Team battles (2026-10-31): your team (Creatures.js) against another
// player's saved "ghost team" - or a made-up one when none can be found -
// in a small fenced arena. Everyone fights by themselves (Gaymi, same day:
// "it auto battles for you"; it used to be "you control one creature"),
// going for the nearest enemy, and every creature has a special power
// (Creatures.powerOf: Horde, Bone Throw, Rage, Stomp, Pounce, Roar, Thick
// Hide, Heal Friends - the numbers are below). From level 5 it also has a
// trigger power (Creatures.triggerOf, 2026-11-11), and types matter:
// Zombies beat Animals beat Skeletons beat Zombies (Creatures.beats). My
// team earns XP when a battle ends (Creatures.giveTeamXP). Team combos
// (Creatures.combosOf) boost a group's members on both sides, my snacks
// (Creatures.SNACKS) are eaten when it starts, and shiny ones sparkle
// (2026-11-11). Last team standing wins;
// after ROUND_S the one with more health left wins. Speed x1/x2/x4 and
// Leave buttons; Esc leaves too.
//
// Shown in 3D (a WebGL scene seen from above at an angle) or 2D (the
// arena from straight above on a plain canvas, creature pictures as
// pieces) - Settings > Team Battle View picks, and the battle's own
// button flips it mid-fight (remembered through onView). The 3D scene is
// only built the first time it's shown.
//
// A screen of its own over the homepage (#team-battle), made when a battle
// starts and thrown away when it ends - the homepage keeps running
// underneath. Opened from Inventory's Pets tab (TeamUI.js).
import * as THREE from 'three'
import { PlayAnimals } from './PlayAnimals.js'
import { stats, creatureName, kindNote, creatureIconURL, tierColor, powerOf, powerName, powerInfo, hasTrigger, triggerOf, triggerName, triggerInfo, beats, TYPE_MULT, levelOf, giveTeamXP, rarityName, combosOf, comboName, comboInfo, SNACKS, snackName, snackInfo, eatSnacks, snackImg, ITEMS, itemName, itemInfo, itemImg, SHINY_HUE, SHINY_FILTER, flies } from './Creatures.js'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { SKELETON_KINDS } from './SkeletonModels.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { setLastReplay, saveReplay, REPLAY_V } from './ReplayStore.js'

export const ROUND_S = 120
// Friend battles (FriendBattle.js, Batch G): both screens run the very same
// fight - the same dice (a shared seed) and fixed steps this long - so only
// the two teams and the seed travel between them.
export const LIVE_STEP = 1 / 60
const LIVE_MAX_STEPS = 240 // per frame, catching up after a hidden tab
// Distance with a plain square root (exact in every browser, unlike
// Math.hypot), so both friends' screens move everyone the same.
const dist = (x, z) => Math.sqrt(x * x + z * z)
const ARENA = 11 // half the arena's width, in blocks
const START_Z = 6
const SPREAD = 3
// Up to this many side by side; a bigger team stands in a second row behind.
const ROW = 5
const ROW_GAP = 2.2
const CRIT_CHANCE = 0.1
const CRIT_MULT = 1.5
const KNOCK = 0.7
const FALL_S = 0.6
const GAP = 0.9 // fighters push apart when closer than this
const CAM = { up: 11, back: 10 }
const MINE = 0x4aa3ff
const FOE = 0xff4d4d
const START_S = 2.2 // "3, 2, 1" before anyone moves
// Powers (Creatures.powerOf).
const HORDE_EACH = 0.06 // Horde: +6% attack per other plain zombie on the team
const BONE_REACH = 3.4 // Bone Throw: hits from this far...
const BONE_SPEED = 9 // ...with a bone flying this fast
const RAGE_MULT = 1.5 // Rage: under half health
const STOMP_EVERY = 3 // Stomp: every 3rd hit...
const STOMP_REACH = 2.5 // ...also hits everyone this close to the target...
const STOMP_MULT = 0.5 // ...this hard
const ROAR_MULT = 0.85 // Roar: the other team's attack at the start
const HIDE_CUT = 0.2 // Thick Hide: takes this much less
const CHARM_EVERY = 4 // Healing Charm: seconds between heals
const HEAL_EVERY = 5 // Heal Friends: seconds between heals...
const HEAL_SHARE = 0.12 // ...each this share of the friend's health
// Trigger powers (Creatures.triggerOf, from level 5).
const GROAN_SHARE = 0.5 // Last Groan: the mini zombie's health and attack
const GROAN_SCALE = 0.7 // ...and size
const GIFT_MULT = 1.25 // Bone Gift: the nearest friend's attack
const REVENGE_MULT = 1.1 // Revenge: per friend fallen...
const REVENGE_MAX = 3 // ...up to this many times
const QUAKE_S = 1.5 // Ground Shake: the other team waits this long
const SECOND_AT = 0.25 // Second Wind: under this share of health...
const SECOND_HEAL = 0.3 // ...heals this share, once
const CRY_MULT = 1.1 // Battle Cry: the whole team's attack
const GUARD_CUT = 0.2 // Guard: the nearest friend takes this much less
const MEND_SHARE = 0.15 // Last Gift: every friend heals this share
// Cheer (pet battles round 4, Batch H, 2026-11-24): each team has a meter
// that fills as its pets take hits; full = one cheer, picked from three.
// All numbers are a guess.
export const CHEER_FILL = 0.3 // full after the team loses this share of its total health
export const CHEER_S = 5 // Attack and Speed cheers last this long
// Co-op boss raid (Batch O): one giant boss (PetRaid.js picks it and its
// numbers). Every SPECIAL_EVERY seconds it does its special; under half
// health it gets angry (RAGE) and does it more often. All a guess.
export const RAID_S = 180 // a raid lasts longer than a normal battle
const SPECIAL_EVERY = 7
const SPECIAL_RAGE_EVERY = 4.5
const BOSS_RAGE_MULT = 1.3
const SLAM_REACH = 4.5 // slam: everyone this close
const SLAM_MULT = 0.8
const QUAKE_STUN = 1.5 // quake: everyone stands still, and takes a little
const QUAKE_MULT = 0.35
const RAIN_HITS = 4 // rain: this many random pets
const RAIN_MULT = 0.7
const SUMMON_N = 2 // summon: this many minions
const SUMMON_HP = 0.04 // ...each with this share of the boss's health
const SUMMON_ATK = 0.25 // ...and attack
const REGEN_SHARE = 0.035 // regen: health back
export const BOSS_SPECIALS = ['slam', 'quake', 'rain', 'summon', 'regen']
const KO_SCORE = 0.25 // Best Pet: a knockout counts as 25% of an average pet's health (a guess)
export const CHEERS = { atk: { n: 30 }, heal: { n: 20 }, speed: { n: 40 } } // +% attack, % health back, +% speed
export const CHEER_IDS = Object.keys(CHEERS)
// In a friend battle a cheer is sent ahead and lands this many fixed steps
// later on both screens (1.5 s), so both run the same fight.
export const CHEER_LEAD = 90
const BOT_CHEER_WAIT = [0.5, 3] // a bot team cheers this many seconds after its meter fills
export const cheerName = (id) => t(`cheer${id[0].toUpperCase()}${id.slice(1)}`)
export const cheerInfo = (id) => t(`cheerInfo${id[0].toUpperCase()}${id.slice(1)}`, { n: CHEERS[id].n, s: CHEER_S })

// Escaped text for innerHTML (names come from other players' saves).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

let _animalHelper = null
export function animalModel(kind) {
  // PlayAnimals' own models, built with a block as 1 unit and no world.
  if (!_animalHelper) _animalHelper = new PlayAnimals({ B: 1, bm: null })
  const built = _animalHelper._build(kind)
  built.tag.visible = false
  return built
}

// A blocky zombie, 2 blocks tall (a skeleton in bone, a monster kind
// stretched to its shape). Its own materials, so a hit can light it up.
export function zombieModel(c) {
  const skel = !!SKELETON_KINDS[c.k]
  const mon = MONSTER_KINDS[c.k]
  const skin = skel ? 0xe8e0c8 : mon ? 0x7a9a4a : 0x5f9a52
  const shirts = [0x3a5fa8, 0x8a3a3a, 0x4a6a3a, 0x6a4a8a, 0x8a6a2a]
  const shirt = skel ? 0xd8d0b8 : shirts[(c.n || 0) % shirts.length]
  const pants = skel ? 0xc8c0a8 : 0x2e3a5a
  const mats = [skin, shirt, pants].map((color) => new THREE.MeshLambertMaterial({ color }))
  const [skinM, shirtM, pantsM] = mats
  const group = new THREE.Group()
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  const legs = []
  for (const side of [-1, 1]) {
    const hip = new THREE.Group()
    hip.position.set(side * 0.13, 0.75, 0)
    const leg = box(0.25, 0.75, 0.25, pantsM)
    leg.position.y = -0.375
    hip.add(leg)
    group.add(hip)
    legs.push(hip)
  }
  const body = box(0.5, 0.75, 0.28, shirtM)
  body.position.y = 1.125
  group.add(body)
  const arms = []
  for (const side of [-1, 1]) {
    const sh = new THREE.Group()
    sh.position.set(side * 0.36, 1.45, 0)
    const arm = box(0.22, 0.7, 0.22, skinM)
    arm.position.y = -0.3
    sh.add(arm)
    sh.rotation.x = -Math.PI / 2 + 0.15
    group.add(sh)
    arms.push(sh)
  }
  const head = new THREE.Group()
  head.position.y = 1.74
  head.add(box(0.48, 0.48, 0.48, skinM))
  const eyeM = new THREE.MeshBasicMaterial({ color: c.b ? 0xff2a1a : 0x111111 })
  mats.push(eyeM)
  for (const side of [-1, 1]) {
    const eye = box(0.09, 0.07, 0.01, eyeM)
    eye.position.set(side * 0.11, 0.04, 0.245)
    head.add(eye)
  }
  group.add(head)
  if (mon) group.scale.set(mon.wide || 1, Math.max(0.6, mon.tall || 1), mon.wide || 1)
  if (c.b) group.scale.multiplyScalar(1.25)
  return { group, head, legs, arms, mats }
}

// The arena's look (Batch B, 2026-11-23, Gaymi: "more realistic", still
// blocky). Pixel textures drawn once on small canvases (no image files,
// light enough for phones) and shared by the 3D and 2D views: grass with
// blades, a few flowers and a worn dirt patch in the middle where the
// fights happen, plain dirt outside, wood-grain fence. Seeded, so the
// arena looks the same every battle.
const PX = 16 // texture pixels per block
function seeded(seed) {
  let n = seed >>> 0
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296)
}
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)))
const rgb = (r, g, b) => `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`
const DIRT = [118, 88, 58]
function dirtPixel(g, x, y, rand, shade = 1) {
  const v = (rand() - 0.5) * 26
  const pebble = rand() < 0.04
  const [r, gg, b] = pebble ? [150, 140, 128] : DIRT
  g.fillStyle = rgb((r + v) * shade, (gg + v * 0.8) * shade, (b + v * 0.6) * shade)
  g.fillRect(x, y, 1, 1)
}

const _tex = {}
// The whole floor: ARENA * 2 blocks across, PX pixels each.
function floorCanvas() {
  if (_tex.floor) return _tex.floor
  const n = ARENA * 2
  const cv = document.createElement('canvas')
  cv.width = cv.height = n * PX
  const g = cv.getContext('2d')
  const rand = seeded(1234)
  for (let by = 0; by < n; by++) {
    for (let bx = 0; bx < n; bx++) {
      // Each block a slightly different green, like real turf.
      const tint = (rand() - 0.5) * 14
      const stripe = (bx % 2 ? -5 : 5)
      for (let y = 0; y < PX; y++) {
        for (let x = 0; x < PX; x++) {
          const wx = bx + x / PX - ARENA
          const wy = by + y / PX - ARENA
          // Worn into dirt toward the middle (patchy, not a circle).
          const d = Math.hypot(wx * 1.1, wy * 0.9)
          const wear = Math.max(0, 1 - d / 6) * 0.85 + Math.sin(wx * 1.7) * Math.cos(wy * 1.3) * 0.12
          const seam = x === PX - 1 || y === PX - 1 ? 0.9 : 1
          if (rand() < wear) {
            dirtPixel(g, bx * PX + x, by * PX + y, rand, seam)
            continue
          }
          const v = (rand() - 0.5) * 22 + tint + stripe
          const blade = rand()
          let c
          if (blade < 0.1) c = [56, 112, 40] // dark blade
          else if (blade < 0.17) c = [128, 186, 82] // sunlit tip
          else c = [86 + v, 148 + v, 58 + v * 0.5]
          g.fillStyle = rgb(c[0] * seam, c[1] * seam, c[2] * seam)
          g.fillRect(bx * PX + x, by * PX + y, 1, 1)
        }
      }
      // Now and then a little flower (away from the worn middle).
      if (rand() < 0.12 && Math.hypot(bx - ARENA, by - ARENA) > 6) {
        const fx = bx * PX + 2 + Math.floor(rand() * (PX - 5))
        const fy = by * PX + 2 + Math.floor(rand() * (PX - 5))
        g.fillStyle = ['#f4e04a', '#ffffff', '#f07ab0', '#9ab8ff'][Math.floor(rand() * 4)]
        g.fillRect(fx - 1, fy, 3, 1)
        g.fillRect(fx, fy - 1, 1, 3)
        g.fillStyle = '#e8a020'
        g.fillRect(fx, fy, 1, 1)
      }
    }
  }
  return (_tex.floor = cv)
}

// One block of dirt (repeated outside the fence).
function dirtCanvas() {
  if (_tex.dirt) return _tex.dirt
  const cv = document.createElement('canvas')
  cv.width = cv.height = PX
  const g = cv.getContext('2d')
  const rand = seeded(77)
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) dirtPixel(g, x, y, rand, x === PX - 1 || y === PX - 1 ? 0.9 : 1)
  return (_tex.dirt = cv)
}

// One block of wood, the grain running along x.
function woodCanvas() {
  if (_tex.wood) return _tex.wood
  const cv = document.createElement('canvas')
  cv.width = cv.height = PX
  const g = cv.getContext('2d')
  const rand = seeded(9)
  for (let y = 0; y < PX; y++) {
    const ring = Math.sin(y * 1.3) * 10 + (y % 5 === 0 ? -22 : 0)
    for (let x = 0; x < PX; x++) {
      const v = ring + (rand() - 0.5) * 12
      g.fillStyle = rgb(150 + v, 108 + v * 0.8, 64 + v * 0.5)
      g.fillRect(x, y, 1, 1)
    }
  }
  // A knot.
  g.fillStyle = '#6a4424'
  g.fillRect(10, 6, 2, 2)
  return (_tex.wood = cv)
}

function canvasTexture(cv, repeat = 1) {
  const tx = new THREE.CanvasTexture(cv)
  tx.magFilter = THREE.NearestFilter
  tx.minFilter = THREE.NearestFilter
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping
  tx.repeat.set(repeat, repeat)
  tx.colorSpace = THREE.SRGBColorSpace
  return tx
}

// The fenced arena.
function buildArena(scene) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 1, ARENA * 2), new THREE.MeshLambertMaterial({ map: canvasTexture(floorCanvas()) }))
  floor.position.y = -0.5
  scene.add(floor)
  const dirt = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2 + 6, 1, ARENA * 2 + 6), new THREE.MeshLambertMaterial({ map: canvasTexture(dirtCanvas(), ARENA * 2 + 6) }))
  dirt.position.y = -0.52
  scene.add(dirt)
  // Fence posts and rails all round, wood-grained (one mesh each). Rails
  // are one block long each so the grain doesn't stretch.
  const wood = new THREE.MeshLambertMaterial({ map: canvasTexture(woodCanvas()) })
  const n = ARENA * 2 + 1
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), wood, n * 4)
  const m = new THREE.Matrix4()
  let i = 0
  for (let k = 0; k < n; k++) {
    const p = -ARENA + k
    for (const [x, z] of [[p, -ARENA], [p, ARENA], [-ARENA, p], [ARENA, p]]) {
      m.makeTranslation(x, 0.55, z)
      posts.setMatrixAt(i++, m)
    }
  }
  scene.add(posts)
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 0.12), wood, ARENA * 2 * 4 * 2)
  const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2)
  i = 0
  for (const y of [0.45, 0.9]) {
    for (let k = 0; k < ARENA * 2; k++) {
      const p = -ARENA + k + 0.5
      for (const [x, z, side] of [[p, -ARENA, false], [p, ARENA, false], [-ARENA, p, true], [ARENA, p, true]]) {
        m.makeTranslation(x, y, z)
        if (side) m.multiply(turn)
        rails.setMatrixAt(i++, m)
      }
    }
  }
  scene.add(rails)
}

// 2D: the arena drawn once at this size (dirt, grass, fence from above),
// then copied each frame.
function board2d(w, h, ratio, b, hazard = null, cells = null) {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w * ratio))
  cv.height = Math.max(1, Math.round(h * ratio))
  const g = cv.getContext('2d')
  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.imageSmoothingEnabled = false
  const dirt = dirtCanvas()
  const ox = b.x % b.cell - b.cell
  const oy = b.y % b.cell - b.cell
  for (let y = oy; y < h; y += b.cell) for (let x = ox; x < w; x += b.cell) g.drawImage(dirt, x, y, b.cell + 0.5, b.cell + 0.5)
  g.drawImage(floorCanvas(), b.x, b.y, b.size, b.size)
  if (hazard && cells) {
    const tile = hazardCanvas(hazard)
    const inset = hazard === 'bounce' ? b.cell * 0.07 : 0
    for (const k of cells) {
      const [x, z] = k.split(',').map(Number)
      const px = b.x + (x + ARENA) * b.cell + inset
      const py = b.y + (z + ARENA) * b.cell + inset
      g.drawImage(tile, px, py, b.cell - inset * 2 + 0.5, b.cell - inset * 2 + 0.5)
    }
  }
  // Rails along each side, posts at every block.
  const wood = woodCanvas()
  const rail = Math.max(3, b.cell * 0.22)
  for (let k = 0; k < ARENA * 2; k++) {
    const p = k * b.cell
    g.drawImage(wood, b.x + p, b.y - rail / 2, b.cell + 0.5, rail)
    g.drawImage(wood, b.x + p, b.y + b.size - rail / 2, b.cell + 0.5, rail)
    g.save()
    for (const x of [b.x, b.x + b.size]) {
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.translate((x + rail / 2) * ratio, (b.y + p) * ratio)
      g.rotate(Math.PI / 2)
      g.drawImage(wood, 0, 0, (b.cell + 0.5) * ratio, rail * ratio)
    }
    g.restore()
  }
  const post = rail * 1.5
  g.fillStyle = '#6a4424'
  for (let k = 0; k <= ARENA * 2; k++) {
    const p = k * b.cell
    for (const [x, y] of [[b.x + p, b.y], [b.x + p, b.y + b.size], [b.x, b.y + p], [b.x + b.size, b.y + p]]) g.fillRect(x - post / 2, y - post / 2, post, post)
  }
  return cv
}

// --- Arena hazards (Batch E, 2026-11-23) ---
// About 1 battle in HAZARD_EVERY gets one hazard on the floor, laid out the
// same for both halves (turned round the middle), so it's fair. Flyers
// float over all of them. Numbers are a guess.
export const HAZARD_EVERY = 3
export const HAZARDS = {
  lava: { n: 6 }, // % health a second, in two burns
  mud: { n: 50 }, // walks at this % speed
  bounce: {},
  flowers: { n: 4 }, // % health a second
}
export const HAZARD_IDS = Object.keys(HAZARDS)
const LAVA_TICK = 0.5
const FLOWER_TICK = 1
const BOUNCE_PUSH = 12 // how hard a pad throws...
const BOUNCE_AIR = 0.5 // ...how long it's in the air...
const BOUNCE_HIGH = 1.2 // ...how high...
const BOUNCE_CD = 1.2 // ...and how soon the same one can bounce again
const capId = (id) => id[0].toUpperCase() + id.slice(1)
export const hazardName = (id) => t(`hazard${capId(id)}`)
export const hazardInfo = (id) => t(`hazardInfo${capId(id)}`, { n: HAZARDS[id].n })

// Which hazard a battle gets: null most of the time.
export function rollHazard(rand = Math.random) {
  if (rand() >= 1 / HAZARD_EVERY) return null
  return HAZARD_IDS[Math.floor(rand() * HAZARD_IDS.length)] || null
}

// The hazard's blocks, as "x,z" of each block's corner (a block covers x to
// x + 1). Laid out on my half (z 0 to 5, between the two teams), then turned
// round the middle onto theirs.
export function hazardCells(id, rand = Math.random) {
  const cells = new Set()
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1))
  const add = (x, z) => {
    if (x < -ARENA + 1 || x > ARENA - 2 || z < -ARENA + 1 || z > ARENA - 2) return
    cells.add(`${x},${z}`)
    cells.add(`${-x - 1},${-z - 1}`)
  }
  const patch = (x, z, w, d) => {
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) add(x + i, z + j)
  }
  if (id === 'lava') {
    // Two cracks that wander across the floor, plus one through the middle.
    for (let k = 0; k < 2; k++) {
      let x = ri(-8, 4)
      let z = ri(1, 4)
      for (let s = 0; s < 6; s++) {
        add(x, z)
        if (rand() < 0.7) x++
        else z += rand() < 0.5 ? 1 : -1
        z = Math.max(0, Math.min(5, z))
      }
    }
    add(ri(-2, 1), 0)
  } else if (id === 'mud') {
    patch(-1, -1, 2, 1) // the middle (its other half comes from turning it)
    patch(ri(-8, -3), ri(1, 3), 3, 2)
    patch(ri(2, 5), ri(1, 3), 3, 2)
  } else if (id === 'bounce') {
    let tries = 0
    while (cells.size < 8 && tries++ < 40) {
      const x = ri(-8, 7)
      const z = ri(1, 4)
      if (![...cells].some((k) => { const [a, b] = k.split(',').map(Number); return Math.abs(a - x) < 2 && Math.abs(b - z) < 2 })) add(x, z)
    }
  } else if (id === 'flowers') {
    patch(ri(-8, -4), ri(1, 3), 2, 2)
    patch(ri(3, 6), ri(1, 3), 2, 2)
    patch(ri(-1, 0), ri(2, 3), 2, 1)
  }
  return cells
}

// One block's picture for each hazard (16 x 16, drawn once).
function hazardCanvas(id) {
  const key = `hz-${id}`
  if (_tex[key]) return _tex[key]
  const cv = document.createElement('canvas')
  cv.width = cv.height = PX
  const g = cv.getContext('2d')
  const rand = seeded({ lava: 31, mud: 47, bounce: 59, flowers: 71 }[id] || 1)
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const r = rand()
      const edge = x === 0 || y === 0 || x === PX - 1 || y === PX - 1
      if (id === 'lava') {
        // Hot in the middle, dark crust round the edges.
        const mid = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
        if (mid > 6 && r < 0.55) g.fillStyle = rgb(52 + r * 30, 34 + r * 20, 28)
        else if (r < 0.18) g.fillStyle = rgb(255, 214, 90)
        else if (r < 0.7) g.fillStyle = rgb(240 + r * 15, 110 + r * 40, 20)
        else g.fillStyle = rgb(190, 50 + r * 30, 12)
      } else if (id === 'mud') {
        const shine = r < 0.05
        g.fillStyle = shine ? rgb(150, 120, 90) : rgb(78 + r * 22, 54 + r * 16, 34 + r * 10)
        if (edge && r < 0.5) g.fillStyle = rgb(60, 42, 26)
      } else if (id === 'bounce') {
        // A slime-green spring pad with a lighter rim and a ring in the middle.
        const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
        if (edge) g.fillStyle = rgb(48, 120, 40)
        else if (ring < 1.5 || (ring > 3.5 && ring < 4.6)) g.fillStyle = rgb(160 + r * 30, 240, 120)
        else g.fillStyle = rgb(90 + r * 25, 196 + r * 25, 70 + r * 15)
      } else {
        g.fillStyle = rgb(72 + r * 30, 140 + r * 40, 52 + r * 20)
      }
      g.fillRect(x, y, 1, 1)
    }
  }
  if (id === 'flowers') {
    // A few 2 x 2 flowers with a yellow middle pixel.
    const cols = ['#ff7ab8', '#ffd84a', '#ffffff', '#c58cff']
    for (let k = 0; k < 6; k++) {
      const x = 1 + Math.floor(rand() * (PX - 3))
      const y = 1 + Math.floor(rand() * (PX - 3))
      g.fillStyle = cols[k % cols.length]
      g.fillRect(x, y, 2, 2)
      g.fillStyle = '#f4b400'
      g.fillRect(x, y, 1, 1)
    }
  }
  _tex[key] = cv
  return cv
}
export const hazardIconURL = (id) => hazardCanvas(id).toDataURL()

// 3D: one instanced mesh of thin blocks (raised pads for bounce).
function buildHazard(scene, id, cells) {
  if (!id || !cells.size) return null
  const tall = id === 'bounce' ? 0.16 : 0.012
  const inset = id === 'bounce' ? 0.86 : 1
  const map = canvasTexture(hazardCanvas(id))
  // Lava glows by itself (not lit, so it looks hot in the shade too).
  const mat = id === 'lava' ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshLambertMaterial({ map })
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(inset, tall, inset), mat, cells.size)
  const m = new THREE.Matrix4()
  let i = 0
  for (const k of cells) {
    const [x, z] = k.split(',').map(Number)
    m.makeTranslation(x + 0.5, tall / 2, z + 0.5)
    mesh.setMatrixAt(i++, m)
  }
  scene.add(mesh)
  return mesh
}

export class TeamBattle {
  // mine, theirs: creatures (Creatures.js). foe: who the other team is.
  // onEnd(won | null): null when left before the end. view: '3d' | '2d';
  // onView(view) when the battle's own button changes it.
  // againKey(won): the again button's text (the tournament's own).
  // xp: my team earns XP (Creatures.giveTeamXP) when it ends.
  // hazard: an arena hazard id, null for none, or left out to roll one.
  // live: a friend battle - { seed, me: 'mine' | 'foe', ids }. `mine` is
  // always the challenger's team, so both screens run the same fight; me
  // says which side this screen's player is (the view turns round for the
  // friend who accepted), ids = this player's own creature ids (XP, snacks).
  // onCheer(kind, at): a friend battle sends my cheer (landing at fixed
  // step `at`); returns a promise, true once it's sent. botCheer: false
  // stops the other team cheering by itself (tests). onClose(): the battle's gone.
  // replay: a saved replay (ReplayStore.js, Batch J) - the same fight
  // again, only to watch: no XP, no coins, no snacks eaten, no cheering.
  constructor({ mine, theirs, foe, ghost, onEnd, onAgain, againKey, view = '3d', onView, xp = true, hazard, live, onCheer, botCheer = true, onClose, replay, raid }) {
    this.replay = replay && Number.isInteger(replay.seed) && !live ? replay : null
    if (this.replay) {
      xp = false
      botCheer = this.replay.bc !== false
    }
    this.xp = xp
    // raid: { id, c (the boss creature), s (its stats), big (its size),
    // special, minion (a creature) } - see PetRaid.js. Both friends in a
    // live raid are the 'mine' side.
    const r = this.replay ? this.replay.raid : raid
    this.raid = r && r.c && r.s && BOSS_SPECIALS.includes(r.special) ? r : null
    if (this.raid) botCheer = false
    this.roundS = this.raid ? RAID_S : ROUND_S
    this.onCheer = onCheer
    this.onClose = onClose
    this.botCheer = botCheer
    // Cheer meters (0..1) and cheers waiting to land: { side, kind, at }.
    this.meter = { mine: 0, foe: 0 }
    this.cheerQueue = []
    this.cheerWait = { mine: false, foe: false }
    this.steps = 0
    this.live = live && Number.isInteger(live.seed) ? live : null
    // Was a friend battle (this one, or the one a replay is of).
    this.wasLive = !!(this.live || this.replay?.lv)
    this.me = (this.live?.me ?? this.replay?.me) === 'foe' ? 'foe' : 'mine'
    this._flip = this.me === 'foe'
    // Every battle's dice come from a seed (Batch J: so it can be replayed).
    // A friend battle's is shared; others pick one now. Only which hazard
    // (if any) still rolls Math.random - except in a friend battle, where
    // the seed rolls it on both screens.
    this.seed = this.live ? this.live.seed : this.replay ? this.replay.seed : Math.floor(Math.random() * 4294967296)
    this.rand = seeded(this.seed)
    const fromSeed = !!this.live && hazard === undefined
    if (this.replay) this.hazard = this.replay.hs ? rollHazard(this.rand) : HAZARDS[this.replay.hz] ? this.replay.hz : null
    else this.hazard = hazard === undefined ? rollHazard(fromSeed ? this.rand : Math.random) : HAZARDS[hazard] ? hazard : null
    this.hazardCells = this.hazard ? hazardCells(this.hazard, this.rand) : new Set()
    // What a replay needs (copies, so later XP / snacks don't change it).
    // ch: every cheer that went off, [step, side 0 mine / 1 foe, kind].
    const copy = (list) => JSON.parse(JSON.stringify(list || []))
    this.rec = this.replay ? null : {
      v: REPLAY_V, seed: this.seed, hs: fromSeed, hz: this.hazard, lv: !!this.live, me: this.me,
      bc: botCheer, foe: String(foe ?? ''), ghost: !!ghost, mine: copy(mine), theirs: copy(theirs), ch: [],
    }
    if (this.rec && this.raid) this.rec.raid = copy(this.raid)
    if (this.replay) {
      this.cheerQueue = this.replay.ch
        .filter((c) => Array.isArray(c) && Number.isInteger(c[0]) && CHEER_IDS[c[2]])
        .map(([at, s, k]) => ({ side: s ? 'foe' : 'mine', kind: CHEER_IDS[k], at }))
    }
    this.paused = false
    this.mine = mine
    this.theirs = theirs
    this.foe = foe
    this.ghost = ghost
    this.onEnd = onEnd
    this.onAgain = onAgain
    this.againKey = againKey
    this.view = view === '2d' ? '2d' : '3d'
    this.onView = onView
    this.speed = 1
    this.over = false
    this.time = 0
    this.shots = []
  }

  open() {
    const root = document.createElement('div')
    root.id = 'team-battle'
    root.innerHTML = `
      <canvas class="tb-canvas tb-canvas-3d"></canvas>
      <canvas class="tb-canvas tb-canvas-2d"></canvas>
      <div class="tb-labels"></div>
      <div class="tb-top">
        <div class="tb-side tb-mine"></div>
        <div class="tb-vs"><span class="tb-vs-word">${esc(t('teamBattleVs'))}</span><span class="tb-foe-name">${esc(this.foe)}</span>${this.replay ? `<span class="tb-replay-tag">${esc(t('replayTag'))}</span>` : ''}<span class="tb-foe-cheer" title="${esc(t('cheerFoeMeter'))}"><span></span></span><span class="tb-clock"></span></div>
        <div class="tb-side tb-foe"></div>
        <div class="tb-combos"><div class="tb-combos-mine"></div><div class="tb-combos-foe"></div></div>
      </div>
      <div class="tb-msg" aria-live="polite"></div>
      <div class="tb-bottom">
        ${this.replay ? `<div class="tb-replay-bar">
          <button type="button" class="tb-btn tb-replay-pause"></button>
          <button type="button" class="tb-btn tb-replay-restart">${esc(t('replayRestart'))}</button>
          <button type="button" class="tb-btn tb-replay-skip">${esc(t('replaySkip'))}</button>
        </div>` : ''}
        <div class="tb-cheer"${this.replay ? ' hidden' : ''}>
          <div class="tb-cheer-pick" hidden>
            ${CHEER_IDS.map((id) => `<button type="button" class="tb-cheer-opt tb-cheer-${id}" data-cheer="${id}" title="${esc(cheerInfo(id))}"><b>${esc(cheerName(id))}</b><small>${esc(cheerInfo(id))}</small></button>`).join('')}
          </div>
          <button type="button" class="tb-cheer-btn" disabled><span class="tb-cheer-fill"></span><span class="tb-cheer-word">${esc(t('cheerBtn'))}</span></button>
        </div>
        ${this.hazard ? `<p class="tb-hazard tb-hazard-${this.hazard}"><img class="tb-hazard-icon" src="${hazardIconURL(this.hazard)}" alt="" draggable="false" />${esc(t('hazardLine', { name: hazardName(this.hazard), info: hazardInfo(this.hazard) }))}</p>` : ''}
        <p class="tb-hint">${esc(t(this.replay ? 'replayHint' : 'teamBattleAutoHint'))}</p>
      </div>
      <div class="tb-buttons">
        <button type="button" class="tb-btn tb-view"></button>
        <button type="button" class="tb-btn tb-speed"></button>
        <button type="button" class="tb-btn tb-leave">${esc(t('teamBattleLeave'))}</button>
      </div>
      <div class="tb-result" style="display: none">
        <div class="panel-box tb-result-box">
          <h2 class="tb-result-title"></h2>
          <p class="tb-result-text"></p>
          <ul class="tb-result-news"></ul>
          <div class="tb-stats"></div>
          <div class="tb-result-btns">
            <button type="button" class="tb-again"></button>
            <button type="button" class="tb-back"></button>
          </div>
          ${this.replay ? '' : `<div class="tb-result-btns tb-replay-btns">
            <button type="button" class="tb-replay-watch">${esc(t('replayWatchBtn'))}</button>
            <button type="button" class="tb-replay-save">${esc(t('replaySaveBtn'))}</button>
          </div>`}
        </div>
      </div>`
    document.body.appendChild(root)
    this.root = root

    this.fighters = [
      ...this.mine.map((c, i) => this._fighter(c, 'mine', i, this.mine.length)),
      ...(this.raid
        ? [this._fighter(this.raid.c, 'foe', 0, 1, { s: { ...this.raid.s }, big: this.raid.big })]
        : this.theirs.map((c, i) => this._fighter(c, 'foe', i, this.theirs.length))),
    ]
    // Horde: a little stronger for every other plain zombie on its team.
    for (const f of this.fighters) {
      if (f.power !== 'horde') continue
      const others = this.fighters.filter((o) => o !== f && o.side === f.side && o.power === 'horde').length
      f.atkMul *= 1 + HORDE_EACH * others
    }
    this._applyCombos()
    this._applySnacks()
    this._applyItems()
    // Each team's total health, for how fast its cheer meter fills.
    this.teamHp = { mine: 0, foe: 0 }
    for (const f of this.fighters) this.teamHp[f.side] += f.s.hp
    this._renderCards()

    this._resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      this.w = w
      this.h = h
      if (this.renderer) {
        this.renderer.setSize(w, h, false)
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
      }
      const c2 = root.querySelector('.tb-canvas-2d')
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      c2.width = Math.round(w * ratio)
      c2.height = Math.round(h * ratio)
      this._ratio = ratio
    }
    this._bindInput()
    // A friend battle runs at one speed on both screens.
    if (this.live) this.root.querySelector('.tb-speed').style.display = 'none'
    if (this.raid) {
      this.root.classList.add('tb-raid')
      this.root.querySelector('.tb-foe-cheer').hidden = true
    }
    this._setView(this.view, false)
    this._resize()
    window.addEventListener('resize', this._resize)
    this._placeCamera(1)
    this._say(t('teamBattleReady'), START_S)
    this._last = performance.now()
    const loop = () => {
      if (!this.root) return
      this._raf = requestAnimationFrame(loop)
      const now = performance.now()
      // Fixed steps for every battle (Batch J), so a replay runs the very
      // same fight. A friend battle catches up after a hidden tab; others
      // just wait (at most 0.25 s a frame, times the speed).
      const real = (now - this._last) / 1000
      const add = this.live ? Math.min(60, real) : this.paused ? 0 : Math.min(0.25, real) * this.speed
      this._acc = (this._acc || 0) + add
      let n = 0
      while (this._acc >= LIVE_STEP && n++ < LIVE_MAX_STEPS) {
        this._acc -= LIVE_STEP
        this._step(LIVE_STEP)
      }
      this._last = now
      this._draw()
      this._placeLabels()
      this._cheerUI()
    }
    loop()
  }

  // Team combos (Creatures.combosOf): each group that's on boosts its members.
  _applyCombos() {
    this.combos = {}
    for (const side of ['mine', 'foe']) {
      const list = this.fighters.filter((f) => f.side === side)
      const on = combosOf(list.map((f) => f.c)).filter((k) => k.step)
      this.combos[side] = on
      for (const k of on) {
        const v = k.n / 100
        for (const f of list) {
          if (!k.members(f.c)) continue
          if (k.id === 'zombie' || k.id === 'boss') {
            f.s = { ...f.s, hp: Math.round(f.s.hp * (1 + v)) }
            f.hp = f.s.hp
          }
          if (k.id === 'animal' || k.id === 'boss') f.atkMul *= 1 + v
          if (k.id === 'skeleton') f.s = { ...f.s, speed: f.s.speed * (1 + v) }
          if (k.id === 'dino') f.skin *= 1 - v
          if (k.id === 'flyer') f.dodge = Math.max(f.dodge, v)
        }
      }
      const el = this.root.querySelector(`.tb-combos-${this._seen(side)}`)
      if (el) {
        el.innerHTML = on.map((k) => `<span class="tb-combo" title="${esc(comboInfo(k.id, k.n))}">${esc(comboName(k.id))} ${'★'.repeat(k.step)}</span>`).join('')
      }
    }
  }

  // My snacks (Creatures.SNACKS), eaten now whatever happens next. A
  // friend battle has both friends' snacks.
  _applySnacks() {
    const ids = []
    let ate = false
    for (const f of this.fighters) {
      if ((!this.wasLive && f.side !== 'mine') || !f.c.sn || !SNACKS[f.c.sn]) continue
      f.snack = f.c.sn
      if (f.side === this.me) ate = true
      if (!this.wasLive && Number.isInteger(f.c.id)) ids.push(f.c.id)
      const v = SNACKS[f.snack].n / 100
      if (f.snack === 'steak') f.atkMul *= 1 + v
      else if (f.snack === 'candy') f.s = { ...f.s, speed: f.s.speed * (1 + v) }
      else if (f.snack === 'cookie') f.shield = true
      f.label.querySelector('.tb-label-name').insertAdjacentHTML('beforeend', ` ${snackImg(f.snack, 'tb-label-snack')}`)
    }
    // A replay only shows them (they were eaten the first time).
    if (this.replay) return
    if (this.live && ate) eatSnacks(this.live.ids || [])
    else if (ids.length) eatSnacks(ids)
  }

  // Which side of the screen an arena side is on: mine is always this
  // player's (in a friend battle the friend who accepted is 'foe' inside).
  _seen(side) {
    return side === this.me ? 'mine' : 'foe'
  }

  // Held items (Creatures.ITEMS, Batch D): both teams' - other players'
  // ghost teams keep theirs. The ones that change numbers do it now.
  _applyItems() {
    for (const f of this.fighters) {
      const id = f.c.hi
      if (!id || !ITEMS[id]) continue
      f.item = id
      const v = ITEMS[id].n / 100
      if (id === 'fang') f.atkMul *= 1 + v
      else if (id === 'feather') f.s = { ...f.s, speed: f.s.speed * (1 + v) }
      else if (id === 'helmet') f.skin *= 1 - v
      f.label.querySelector('.tb-label-name').insertAdjacentHTML('beforeend', ` ${itemImg(id, 'tb-label-item')}`)
    }
  }

  _itemText(f) {
    this._float(f, `${itemName(f.item)}!`, 'power')
  }

  // A snack that only works once (Bandage, Shield Cookie) is gone.
  _snackUsed(f) {
    this._float(f, `${snackName(f.snack)}!`, 'power snack')
    f.snack = null
    f.label.querySelector('.tb-label-snack')?.remove()
  }

  _fighter(c, side, i, n, opts = {}) {
    const s = opts.s || stats(c)
    const row = Math.floor(i / ROW)
    const inRow = Math.min(ROW, n - row * ROW)
    const x = ((i % ROW) - (inRow - 1) / 2) * SPREAD
    const back = START_Z + row * ROW_GAP
    const z = side === 'mine' ? back : -back
    const heading = side === 'mine' ? Math.PI : 0
    const label = document.createElement('div')
    label.className = `tb-label ${this._seen(side)}`
    const lv = levelOf(c)
    label.innerHTML = `<span class="tb-label-name" style="color: ${tierColor(c.r)}">${c.s ? '<span class="tb-label-shiny">✦</span> ' : ''}<span class="tb-label-nick">${esc(creatureName(c))}</span>${lv > 1 ? ` <small>${esc(t('teamLevel', { n: lv }))}</small>` : ''}${kindNote(c) ? `<small class="tb-label-kind">${esc(kindNote(c))}</small>` : ''}</span><span class="tb-label-bar"><span></span></span>`
    this.root.querySelector('.tb-labels').appendChild(label)
    const power = opts.noPowers ? null : powerOf(c)
    const icon = new Image()
    icon.src = creatureIconURL(c)
    return {
      c, s, side, x, z, heading, vx: 0, vz: 0, hp: s.hp, cd: 0.5 + this.rand() * 0.4, walk: 0, hop: 0, fall: 0, flash: 0,
      alive: true, label, icon, power, atkMul: 1, hits: 0, raged: false, pounced: false, healCd: HEAL_EVERY,
      trig: opts.noPowers ? null : hasTrigger(c) ? triggerOf(c) : null, guard: 1, revenge: 0, winded: false, mini: !!opts.mini,
      // Combos and snacks (2026-11-11): damage taken x skin, a dodge chance.
      skin: 1, dodge: 0, snack: null, shield: false, sparkle: this.rand(),
      // Held item (Batch D): which, and whether a once-a-battle one went off.
      item: null, itemUsed: false, charmCd: CHARM_EVERY,
      // Arena hazards (Batch E): burn / heal timers, a bounce's air time.
      flies: flies(c), lavaCd: 0, flowerCd: FLOWER_TICK, bounceCd: 0, air: 0,
      reach: power === 'bones' && !opts.noPowers ? BONE_REACH : s.reach,
      // After-battle stats (Batch I): a mini zombie adds to its maker's.
      st: opts.st || { dmg: 0, heal: 0, took: 0, ko: 0 },
      // Raid boss (Batch O): bigger, heavier, its own special.
      boss: !!opts.big, big: opts.big || 1, rad: GAP / 2 * (opts.big || 1), specialCd: SPECIAL_EVERY, bossRaged: false,
      // The 3D model, ring and height are made by _build3d() when first needed.
      group: null, height: 2,
    }
  }

  // --- 3D: built the first time the battle is shown in 3D ---

  _build3d() {
    if (this.renderer) return
    const canvas = this.root.querySelector('.tb-canvas-3d')
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x8cc8f0)
    this.scene.fog = new THREE.Fog(0x8cc8f0, 40, 80)
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 140)
    // The sky fades from the fog's pale blue at the horizon to a deeper blue
    // overhead, like the main game's sky (2026-11-09), not one flat colour.
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(120, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { horizon: { value: new THREE.Color(0x8cc8f0) }, zenith: { value: new THREE.Color(0x3a7fd0) }, height: { value: 1 } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform float height; varying vec3 vDir;
          void main() {
            // The camera looks down on the arena, so the bit of sky you see
            // is all near the horizon: it deepens towards the top of the
            // screen instead (and overhead, if the view ever looks up).
            float up = max(smoothstep(0.0, 0.5, normalize(vDir).y), smoothstep(0.55, 1.0, gl_FragCoord.y / height));
            gl_FragColor = vec4(mix(horizon, zenith, up), 1.0);
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
      }),
    )
    this.skyDome.frustumCulled = false
    this.skyDome.renderOrder = -3
    this.scene.add(this.skyDome)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a3a, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(6, 14, 8)
    this.scene.add(sun)
    buildArena(this.scene)
    this.hazardMesh = buildHazard(this.scene, this.hazard, this.hazardCells)
    for (const f of this.fighters) this._add3d(f)
    this._boneGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22)
    this._boneMat = new THREE.MeshLambertMaterial({ color: 0xf2ecdc })
    this._resize?.()
    this.camera.position.set(0, CAM.up, CAM.back)
  }

  // One fighter's model and ring in the 3D scene.
  _add3d(f) {
    const built = f.c.t === 'a' ? animalModel(f.c.k) : zombieModel(f.c)
    Object.assign(f, built)
    if (f.mini) f.group.scale.multiplyScalar(GROAN_SCALE)
    if (f.c.s) this._shinyColours(f)
    const baseY = f.group.scale.y
    f.group.position.set(f.x, 0, f.z)
    f.group.rotation.y = f.heading
    this.scene.add(f.group)
    // A ring on the ground in the team's colour.
    f.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 24), new THREE.MeshBasicMaterial({ color: f.side === this.me ? MINE : FOE, side: THREE.DoubleSide }))
    f.ring.rotation.x = -Math.PI / 2
    f.ring.position.set(f.x, 0.02, f.z)
    f.ring.visible = f.alive
    this.scene.add(f.ring)
    const k = f.c.t === 'a' ? PlayAnimals.KINDS[f.c.k] : null
    f.height = k ? Math.max(k.leg + k.body[1], (k.headAt ? k.headAt[0] : k.leg + k.body[1]) + k.head[1] / 2) : 2 * f.group.scale.y
    if (f.boss) {
      // The label goes over its (much bigger) head.
      f.labelY = f.height * baseY * f.big + 0.35
      f.group.scale.multiplyScalar(f.big)
      f.ring.scale.setScalar(f.big)
    }
    if (!f.alive) f.group.rotation.z = Math.PI / 2
  }

  // Shiny: the model's colours turned round the colour wheel. Animal
  // materials are shared per kind, so those are copied first.
  _shinyColours(f) {
    this._shinyMats ||= []
    const turn = (m) => m?.color?.offsetHSL(SHINY_HUE / 360, 0.1, 0)
    if (f.mats) {
      f.mats.forEach(turn)
      return
    }
    f.group.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return
      o.material = o.material.clone()
      if (o.material.map) o.material.color.set(0xb0ffe0)
      else turn(o.material)
      this._shinyMats.push(o.material)
    })
  }

  _setView(view, remember = true) {
    this.view = view
    if (view === '3d') this._build3d()
    this.root.querySelector('.tb-canvas-3d').style.display = view === '3d' ? '' : 'none'
    this.root.querySelector('.tb-canvas-2d').style.display = view === '2d' ? '' : 'none'
    this.root.classList.toggle('flat', view === '2d')
    // The button names the view it switches to.
    this.root.querySelector('.tb-view').textContent = t(view === '3d' ? 'teamBattleTo2d' : 'teamBattleTo3d')
    this.root.querySelector('.tb-speed').textContent = t('teamBattleSpeed', { n: this.speed })
    if (remember) this.onView?.(view)
  }

  _bindInput() {
    this._onKey = (e) => {
      if (!this.root) return
      // The homepage's own shortcuts stay quiet while a battle is up.
      e.stopPropagation()
      if (e.type === 'keydown' && e.code === 'Escape') {
        if (this.over) this.close()
        else this._leave()
        e.preventDefault()
      }
      // C opens the cheer choices, 1 / 2 / 3 picks one.
      if (e.type === 'keydown' && e.code === 'KeyC' && this._canCheer()) {
        const pick = this.root.querySelector('.tb-cheer-pick')
        pick.hidden = !pick.hidden
      }
      // A replay: Space pauses / plays.
      if (e.type === 'keydown' && e.code === 'Space' && this.replay && !this.over) {
        this._pause(!this.paused)
        e.preventDefault()
      }
      const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code)
      if (e.type === 'keydown' && n >= 0 && !this.root.querySelector('.tb-cheer-pick').hidden) this.cheer(CHEER_IDS[n])
    }
    window.addEventListener('keydown', this._onKey, true)
    window.addEventListener('keyup', this._onKey, true)
    this.root.querySelector('.tb-leave').addEventListener('click', () => this._leave())
    this.root.querySelector('.tb-view').addEventListener('click', () => this._setView(this.view === '3d' ? '2d' : '3d'))
    this.root.querySelector('.tb-speed').addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1
      this.root.querySelector('.tb-speed').textContent = t('teamBattleSpeed', { n: this.speed })
    })
    this.root.querySelector('.tb-again').addEventListener('click', () => {
      this.close()
      this.onAgain?.()
    })
    this.root.querySelector('.tb-back').addEventListener('click', () => this.close())
    // Replays (Batch J): watch this one again / keep it; a replay's own bar.
    this.root.querySelector('.tb-replay-watch')?.addEventListener('click', () => {
      if (!this.rec?.t) return
      const rec = this.rec
      this.close()
      playReplay(rec, { view: this.view, onView: this.onView })
    })
    this.root.querySelector('.tb-replay-save')?.addEventListener('click', (e) => {
      const res = saveReplay(this.rec)
      this._saveBtn(e.currentTarget, res)
    })
    if (this.replay) {
      this._pause(false)
      this.root.querySelector('.tb-replay-pause').addEventListener('click', () => this._pause(!this.paused))
      this.root.querySelector('.tb-replay-restart').addEventListener('click', () => this._restart())
      this.root.querySelector('.tb-replay-skip').addEventListener('click', () => this._skip())
    }
    // Cheer: the button opens the three choices, a choice cheers.
    const pick = this.root.querySelector('.tb-cheer-pick')
    this.root.querySelector('.tb-cheer-btn').addEventListener('click', () => {
      if (this._canCheer()) pick.hidden = !pick.hidden
    })
    pick.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cheer]')
      if (b) this.cheer(b.dataset.cheer)
    })
  }

  // --- Replays (Batch J) ---

  _pause(on) {
    this.paused = !!on
    const b = this.root?.querySelector('.tb-replay-pause')
    if (b) b.textContent = t(this.paused ? 'replayPlay' : 'replayPause')
  }

  // The same replay from the start (a fresh battle).
  _restart() {
    const rec = this.replay
    if (!rec) return
    this.close()
    playReplay(rec, { view: this.view, onView: this.onView })
  }

  // Straight to the result: every step left, without drawing.
  _skip() {
    if (!this.replay || this.over) return
    this._skipping = true
    for (let i = 0; i < (ROUND_S + START_S + 5) / LIVE_STEP && !this.over && this._winner === undefined && this.root; i++) this._step(LIVE_STEP)
    this._skipping = false
    if (this._winner !== undefined) this._finish(this._winner)
  }

  // The Save Replay button shows how it went.
  _saveBtn(btn, res) {
    if (!btn) return
    const key = { saved: 'replaySaved', already: 'replaySaved', full: 'replayFull', error: 'replayError' }[res] || 'replayError'
    btn.textContent = t(key)
    btn.disabled = res === 'saved' || res === 'already'
  }

  // --- Cheer (Batch H) ---

  // Can this screen's player cheer right now?
  _canCheer() {
    return !this.replay && !this.over && this.time >= START_S && this.meter[this.me] >= 1 && !this.cheerWait[this.me]
  }

  // A team took dmg: its cheer meter fills a bit.
  _fill(side, dmg) {
    if (this.over || this.time < START_S || !this.teamHp?.[side]) return
    this.meter[side] = Math.min(1, this.meter[side] + dmg / (this.teamHp[side] * CHEER_FILL))
  }

  // This screen's player cheers (kind: CHEER_IDS). In a friend battle it's
  // sent first and lands CHEER_LEAD steps later on both screens; if it
  // can't be sent, nothing happens and the meter stays full.
  cheer(kind) {
    if (!CHEERS[kind] || !this._canCheer()) return false
    this.root.querySelector('.tb-cheer-pick').hidden = true
    const side = this.me
    if (!this.live) {
      this.cheerQueue.push({ side, kind, at: this.steps })
      this._cheerUI()
      return true
    }
    const at = this.steps + CHEER_LEAD
    this.cheerWait[side] = true
    this._say(t('cheerSending'), 1.2)
    this._cheerUI()
    Promise.resolve(this.onCheer ? this.onCheer(kind, at) : false).catch(() => false).then((ok) => {
      if (!this.root) return
      if (ok) this.cheerQueue.push({ side, kind, at })
      else {
        this.cheerWait[side] = false
        this._say(t('cheerFailed'), 1.6)
      }
      this._cheerUI()
    })
    return true
  }

  // The friend's cheer arrived (a friend battle): it lands at step `at`
  // here too (straight away if it came late).
  friendCheer(kind, at) {
    if (!CHEERS[kind] || !Number.isInteger(at)) return
    // In a raid my friend is on my side: one meter for both of us.
    const side = this.raid ? this.me : this.me === 'mine' ? 'foe' : 'mine'
    if (this.cheerQueue.some((q) => q.side === side && q.at === at)) return
    this.cheerWait[side] = true
    this.cheerQueue.push({ side, kind, at })
  }

  // Cheers whose step has come go off (in the order sent).
  _cheerStep(dt, started) {
    if (!started || this.over) return
    // A bot / ghost team cheers a little while after its meter fills:
    // heal when it's hurt, otherwise attack or speed.
    // (A replay rolls the same dice, but its cheers come from the recording.)
    if (!this.wasLive && this.botCheer && this.meter.foe >= 1 && !this.cheerWait.foe) {
      if (this._botCheerIn === undefined) this._botCheerIn = BOT_CHEER_WAIT[0] + this.rand() * (BOT_CHEER_WAIT[1] - BOT_CHEER_WAIT[0])
      if ((this._botCheerIn -= dt) <= 0) {
        this._botCheerIn = undefined
        const list = this.fighters.filter((f) => f.alive && f.side === 'foe')
        const health = list.reduce((s, f) => s + f.hp / f.s.hp, 0) / (list.length || 1)
        const kind = health < 0.5 ? 'heal' : this.rand() < 0.5 ? 'atk' : 'speed'
        if (!this.replay) this.cheerQueue.push({ side: 'foe', kind, at: this.steps })
      }
    }
    if (!this.cheerQueue.length) return
    // A replay's are already in the order they went off.
    const due = this.cheerQueue.filter((q) => q.at <= this.steps)
    if (!this.replay) due.sort((a, b) => a.at - b.at || (a.side < b.side ? -1 : a.side > b.side ? 1 : CHEER_IDS.indexOf(a.kind) - CHEER_IDS.indexOf(b.kind)))
    if (!due.length) return
    this.cheerQueue = this.cheerQueue.filter((q) => !due.includes(q))
    for (const q of due) {
      this.rec?.ch.push([this.steps, q.side === 'mine' ? 0 : 1, CHEER_IDS.indexOf(q.kind)])
      this._applyCheer(q.side, q.kind)
    }
  }

  _applyCheer(side, kind) {
    this.cheerWait[side] = false
    // Only with a full meter (the same check on both friends' screens).
    if (this.meter[side] < 1) return
    this.meter[side] = 0
    for (const f of this.fighters) {
      if (!f.alive || f.side !== side) continue
      if (kind === 'heal') {
        const add = Math.max(1, Math.round(f.s.hp * CHEERS.heal.n / 100))
        this._heal(f, add)
        this._number(f, `+${add}`, 'heal')
      } else {
        f.cheer = kind
        f.cheerT = CHEER_S
        this._float(f, `${cheerName(kind)}!`, `power cheer cheer-${kind}`)
      }
    }
    this.cheers = this.cheers || { mine: 0, foe: 0 }
    this.cheers[side]++
    this._say(t(this._seen(side) === 'mine' ? 'cheerMine' : 'cheerFoe', { name: cheerName(kind) }), 1.4)
    audioEngine.playLevelUp?.()
    this._renderCards()
  }

  // The meter and button (and the other team's small meter).
  _cheerUI() {
    if (!this.root) return
    const mine = this.meter[this.me]
    const theirs = this.meter[this.me === 'mine' ? 'foe' : 'mine']
    const btn = this.root.querySelector('.tb-cheer-btn')
    const ready = this._canCheer()
    btn.disabled = !ready
    btn.classList.toggle('ready', ready)
    btn.querySelector('.tb-cheer-fill').style.width = `${mine * 100}%`
    btn.querySelector('.tb-cheer-word').textContent = t(this.cheerWait[this.me] ? 'cheerOnWay' : ready ? 'cheerReady' : 'cheerBtn')
    if (!ready) this.root.querySelector('.tb-cheer-pick').hidden = true
    const foe = this.root.querySelector('.tb-foe-cheer')
    foe.querySelector('span').style.width = `${theirs * 100}%`
    foe.classList.toggle('ready', theirs >= 1)
  }

  _say(text, seconds = 1.6) {
    const el = this.root?.querySelector('.tb-msg')
    if (!el) return
    el.textContent = text
    el.classList.add('show')
    clearTimeout(this._sayTimer)
    this._sayTimer = setTimeout(() => el.classList.remove('show'), seconds * 1000)
  }

  // A raid boss's special (BOSS_SPECIALS), with a shout above its head.
  _bossSpecial(f) {
    const kind = this.raid.special
    const foes = this._enemiesOf(f)
    this._float(f, t(`raidSpecial${kind[0].toUpperCase()}${kind.slice(1)}`), 'power')
    if (kind === 'slam') {
      for (const o of foes) if (dist(o.x - f.x, o.z - f.z) - f.rad < SLAM_REACH) this._hit(f, o, SLAM_MULT)
    } else if (kind === 'quake') {
      for (const o of foes) {
        o.stun = QUAKE_STUN
        o.cd += QUAKE_STUN
        this._hit(f, o, QUAKE_MULT)
      }
    } else if (kind === 'rain') {
      const list = [...foes]
      for (let i = 0; i < RAIN_HITS && list.length; i++) {
        const o = list.splice(Math.floor(this.rand() * list.length), 1)[0]
        this._hit(f, o, RAIN_MULT)
      }
    } else if (kind === 'summon') {
      for (let i = 0; i < SUMMON_N; i++) {
        const s = { ...stats(this.raid.minion), hp: Math.max(1, Math.round(f.s.hp * SUMMON_HP)), atk: Math.max(1, Math.round(f.s.atk * SUMMON_ATK)) }
        const m = this._fighter(this.raid.minion, f.side, 0, 1, { s, mini: true, noPowers: true, st: f.st })
        m.x = f.x + (i ? 1 : -1) * (f.rad + 0.8)
        m.z = f.z + f.rad
        m.cd = 0.8
        this.fighters.push(m)
        if (this.scene) this._add3d(m)
      }
    } else if (kind === 'regen' && f.hp < f.s.hp) {
      const add = Math.max(1, Math.round(f.s.hp * REGEN_SHARE))
      this._heal(f, add)
      this._number(f, `+${add}`, 'heal')
    }
    this._renderCards()
  }

  _enemiesOf(f) {
    return this.fighters.filter((o) => o.alive && o.side !== f.side)
  }

  _nearest(f, list) {
    let best = null
    let bestD = Infinity
    for (const o of list) {
      const d = dist(o.x - f.x, o.z - f.z)
      if (d < bestD) {
        bestD = d
        best = o
      }
    }
    return best ? { o: best, d: bestD } : null
  }

  // A swing (or, for Bone Throw, a bone that lands a moment later).
  _attack(f, to) {
    f.cd = f.s.rate * (0.9 + this.rand() * 0.25)
    f.hop = 0.18
    if (f.power === 'bones') {
      const d = dist(to.x - f.x, to.z - f.z)
      const shot = { from: f, to, x: f.x, z: f.z, sx: f.x, sz: f.z, t: 0, dur: Math.max(0.15, d / BONE_SPEED), mesh: null }
      this.shots.push(shot)
      return
    }
    this._hit(f, to)
  }

  _hit(from, to, mult = 1) {
    if (!to.alive) return
    from.hits++
    // Shield Cookie: the first hit does nothing.
    if (to.shield) {
      to.shield = false
      this._snackUsed(to)
      this._renderCards()
      return
    }
    // Flock combo: a chance to dodge.
    if (to.dodge && this.rand() < to.dodge) {
      this._float(to, t('teamDodge'), 'power')
      return
    }
    let m = mult * from.atkMul
    // Attack cheer.
    if (from.cheer === 'atk') m *= 1 + CHEERS.atk.n / 100
    // Pounce: its first hit lands twice as hard.
    if (from.power === 'pounce' && !from.pounced) {
      from.pounced = true
      m *= 2
      this._powerText(from)
    }
    // Sharp Claws: big hits more often.
    const crit = this.rand() < CRIT_CHANCE + (from.item === 'claws' ? ITEMS.claws.n / 100 : 0)
    let dmg = from.s.atk * (0.85 + this.rand() * 0.3) * (crit ? CRIT_MULT : 1) * m
    // Thick Hide takes less.
    if (to.power === 'hide') dmg *= 1 - HIDE_CUT
    // Guard (a Thick Hide friend's trigger) takes less too.
    dmg *= to.guard
    // Thick Skin combo (dinosaurs).
    dmg *= to.skin
    // Types: Zombies beat Animals, Animals beat Skeletons, Skeletons beat Zombies.
    const strong = beats(from.c, to.c)
    if (strong) dmg *= TYPE_MULT
    dmg = Math.max(1, Math.round(dmg))
    // Lucky Bone: once a battle, the hit that would knock it out misses.
    if (to.item === 'bone' && !to.itemUsed && dmg >= to.hp) {
      to.itemUsed = true
      this._itemText(to)
      return
    }
    this._fill(to.side, Math.min(dmg, to.hp))
    from.st.dmg += Math.min(dmg, to.hp)
    to.st.took += Math.min(dmg, to.hp)
    to.hp = Math.max(0, to.hp - dmg)
    const dx = to.x - from.x
    const dz = to.z - from.z
    const len = dist(dx, dz) || 1
    to.vx += (dx / len) * KNOCK * 6
    to.vz += (dz / len) * KNOCK * 6
    to.hop = 0.15
    to.flash = 0.12
    if (to.mats) for (const mat of to.mats) if (mat.emissive) mat.emissive.setHex(0x661111)
    this._number(to, dmg, crit ? 'crit' : strong ? 'strong' : '')
    audioEngine.playMelee?.()
    // Rage: under half health it hits half as hard again.
    if (to.alive && to.power === 'rage' && !to.raged && to.hp > 0 && to.hp < to.s.hp / 2) {
      to.raged = true
      to.atkMul *= RAGE_MULT
      this._powerText(to)
    }
    // A raid boss gets angry under half health.
    if (to.boss && !to.bossRaged && to.hp > 0 && to.hp < to.s.hp / 2) {
      to.bossRaged = true
      to.atkMul *= BOSS_RAGE_MULT
      to.specialCd = Math.min(to.specialCd, SPECIAL_RAGE_EVERY)
      this._float(to, t('raidRage'), 'power')
      this._say(t('raidRageSay'), 1.6)
    }
    // Second Wind: the first time it gets low, it gets some back.
    if (to.alive && to.trig === 'second' && !to.winded && to.hp > 0 && to.hp < to.s.hp * SECOND_AT) {
      to.winded = true
      const add = Math.round(to.s.hp * SECOND_HEAL)
      this._heal(to, add)
      this._trigText(to)
      this._number(to, `+${add}`, 'heal')
    }
    if (to.hp <= 0) this._down(to, from)
    this._itemsAfterHit(from, to, dmg)
    // Stomp: every few hits shakes everyone near the one it hit.
    if (from.power === 'stomp' && mult === 1 && from.hits % STOMP_EVERY === 0) {
      this._powerText(from)
      for (const o of this._enemiesOf(from)) if (o !== to && dist(o.x - to.x, o.z - to.z) < STOMP_REACH) this._hit(from, o, STOMP_MULT)
    }
    this._renderCards()
  }

  // Held items that go off once a hit lands (from hit to for dmg).
  _itemsAfterHit(from, to, dmg) {
    // Vampire Tooth: heals some of what it did.
    if (from.item === 'tooth' && from.alive && from.hp < from.s.hp) {
      const add = Math.max(1, Math.round(dmg * ITEMS.tooth.n / 100))
      this._heal(from, add)
      this._number(from, `+${add}`, 'heal')
    }
    // Stun Horn: its first hit stuns.
    if (from.item === 'horn' && !from.itemUsed && to.alive) {
      from.itemUsed = true
      to.stun = ITEMS.horn.n
      to.cd += ITEMS.horn.n
      this._itemText(from)
    }
    // Spiked Collar: whoever hit it gets some back (never knocks out by
    // itself twice in a row: no hitting back a hit-back).
    if (to.item === 'collar' && from.alive && from !== to) {
      const back = Math.max(1, Math.round(dmg * ITEMS.collar.n / 100))
      this._fill(from.side, Math.min(back, from.hp))
      to.st.dmg += Math.min(back, from.hp)
      from.st.took += Math.min(back, from.hp)
      from.hp = Math.max(0, from.hp - back)
      this._number(from, back, '')
      if (from.hp <= 0) this._down(from, to)
    }
  }

  // Health back for o, counted as healing done by by (only what it really got).
  _heal(o, add, by = o) {
    const gain = Math.max(0, Math.min(add, o.s.hp - o.hp))
    o.hp += gain
    by.st.heal += gain
  }

  // by: who knocked it out (none for lava).
  _down(f, by) {
    // Bandage: gets back up once.
    if (f.snack === 'bandage' && !this.over) {
      f.hp = Math.max(1, Math.round(f.s.hp * SNACKS.bandage.n / 100))
      f.st.heal += f.hp
      this._snackUsed(f)
      this._number(f, `+${f.hp}`, 'heal')
      this._renderCards()
      return
    }
    // Spirit Totem: gets back up once too.
    if (f.item === 'totem' && !f.itemUsed && !this.over) {
      f.itemUsed = true
      f.hp = Math.max(1, Math.round(f.s.hp * ITEMS.totem.n / 100))
      f.st.heal += f.hp
      this._itemText(f)
      this._number(f, `+${f.hp}`, 'heal')
      this._renderCards()
      return
    }
    f.alive = false
    if (by && by.side !== f.side) by.st.ko++
    f.fall = FALL_S
    if (f.ring) f.ring.visible = false
    f.label.style.display = 'none'
    audioEngine.playZombieDeath?.(0.8, 0)
    if (!this.over) this._onFaint(f)
    // A raid: the boss down = won (its minions fall with it).
    if (f.boss) {
      for (const o of this.fighters) {
        if (o.alive && o.side === f.side) {
          o.alive = false
          o.fall = FALL_S
          if (o.ring) o.ring.visible = false
          o.label.style.display = 'none'
        }
      }
    }
    const mineLeft = this.fighters.some((o) => o.alive && o.side === 'mine')
    const foesLeft = this.raid ? this.fighters.some((o) => o.alive && o.boss) : this.fighters.some((o) => o.alive && o.side === 'foe')
    // The first side to run out decides it (the same on both friends' screens).
    if (!mineLeft || !foesLeft) {
      if (this._winner === undefined) this._winner = mineLeft
      setTimeout(() => this._finish(this._winner), 700)
    }
  }

  // Where (x, y, z) in the arena is on screen, in % of the screen.
  _screen(x, y, z) {
    if (this.view === '3d' && this.camera) {
      const p = new THREE.Vector3(x, y, z).project(this.camera)
      return { left: ((p.x + 1) / 2) * 100, top: ((1 - p.y) / 2) * 100 }
    }
    const b = this._board()
    const fl = this._flip ? -1 : 1
    return { left: ((b.x + (x * fl + ARENA) * b.cell) / this.w) * 100, top: ((b.y + (z * fl + ARENA) * b.cell - y * b.cell * 0.5) / this.h) * 100 }
  }

  _float(f, text, cls) {
    if (this._skipping) return
    const el = document.createElement('span')
    el.className = `tb-number ${cls}`
    el.textContent = text
    this.root.querySelector('.tb-labels').appendChild(el)
    const at = this._screen(f.x, f.height + 0.3, f.z)
    el.style.left = `${at.left}%`
    el.style.top = `${at.top}%`
    setTimeout(() => el.remove(), cls === 'power' ? 1100 : 800)
  }

  _number(f, n, cls) {
    this._float(f, String(n), cls)
  }

  _powerText(f) {
    this._float(f, `${powerName(f.c)}!`, 'power')
  }

  _trigText(f) {
    this._float(f, `${triggerName(f.trig)}!`, 'power trig')
  }

  _friendsOf(f) {
    return this.fighters.filter((o) => o.alive && o !== f && o.side === f.side)
  }

  // Trigger powers that go off when one of them faints.
  _onFaint(f) {
    const friends = this._friendsOf(f)
    if (f.trig === 'groan') {
      // Last Groan: a mini zombie gets up where it fell.
      this._trigText(f)
      const c = { t: 'z', k: f.c.k, r: 'common', n: f.c.n, b: false }
      const s = { ...f.s, hp: Math.max(1, Math.round(f.s.hp * GROAN_SHARE)), atk: Math.max(1, Math.round(f.s.atk * GROAN_SHARE)) }
      const mini = this._fighter(c, f.side, 0, 1, { s, mini: true, noPowers: true, st: f.st })
      mini.x = f.x
      mini.z = f.z
      mini.heading = f.heading
      mini.cd = 0.8
      this.fighters.push(mini)
      if (this.scene) this._add3d(mini)
    } else if (f.trig === 'gift') {
      // Bone Gift: the nearest friend hits harder.
      const n = this._nearest(f, friends)
      if (n) {
        this._trigText(f)
        n.o.atkMul *= GIFT_MULT
      }
    } else if (f.trig === 'cry' && friends.length) {
      // Battle Cry: the whole team hits harder.
      this._trigText(f)
      for (const o of friends) o.atkMul *= CRY_MULT
    } else if (f.trig === 'mend' && friends.length) {
      // Last Gift: every friend heals a bit.
      this._trigText(f)
      for (const o of friends) {
        const add = Math.max(1, Math.round(o.s.hp * MEND_SHARE))
        this._heal(o, add, f)
        this._number(o, `+${add}`, 'heal')
      }
    }
    // Revenge: friends with it get angrier for every friend that falls.
    for (const o of friends) {
      if (o.trig !== 'revenge' || o.revenge >= REVENGE_MAX) continue
      o.revenge++
      o.atkMul *= REVENGE_MULT
      this._trigText(o)
    }
    this._renderCards()
  }

  _step(dt) {
    if (!this.over) this.time += dt
    this.steps++
    const started = this.time >= START_S
    if (started && !this.over && this.time - dt < START_S) {
      this._say(t('teamBattleFight'), 1)
      // Roar: when the fight starts, the other team's hits get weaker.
      for (const f of this.fighters) {
        if (f.power !== 'roar' || !f.alive) continue
        this._powerText(f)
        for (const o of this._enemiesOf(f)) o.atkMul *= ROAR_MULT
      }
      // Trigger powers that go off at the start.
      for (const f of this.fighters) {
        if (!f.alive) continue
        if (f.trig === 'quake') {
          // Ground Shake: the other team stands still for a moment.
          this._trigText(f)
          for (const o of this._enemiesOf(f)) {
            o.cd += QUAKE_S
            o.stun = QUAKE_S
          }
        } else if (f.trig === 'guard') {
          // Guard: the nearest friend takes less all battle.
          const n = this._nearest(f, this._friendsOf(f))
          if (n) {
            this._trigText(f)
            n.o.guard *= 1 - GUARD_CUT
          }
        }
      }
    }
    this._cheerStep(dt, started)
    const clock = this.root.querySelector('.tb-clock')
    if (clock) clock.textContent = started ? `${Math.max(0, Math.ceil(this.roundS - (this.time - START_S)))}` : `${Math.ceil(START_S - this.time)}`
    if (started && !this.over && this.time - START_S >= this.roundS) this._timeUp()
    for (const f of this.fighters) {
      if (f.flash > 0) {
        f.flash -= dt
        if (f.flash <= 0 && f.mats) for (const m of f.mats) if (m.emissive) m.emissive.setHex(0x000000)
      }
      if (!f.alive) {
        if (f.fall > 0) f.fall = Math.max(0, f.fall - dt)
        continue
      }
      f.cd = Math.max(0, f.cd - dt)
      if (f.stun > 0) f.stun -= dt
      // An Attack / Speed cheer wears off.
      if (f.cheer && (f.cheerT -= dt) <= 0) f.cheer = null
      // Shiny ones sparkle now and then.
      if (f.c.s && (f.sparkle -= dt) <= 0) {
        f.sparkle = 1.4
        this._float(f, '✦', 'sparkle')
      }
      let mx = 0
      let mz = 0
      // Healing Charm: a little health every few seconds.
      if (started && !this.over && f.item === 'charm' && (f.charmCd -= dt) <= 0) {
        f.charmCd = CHARM_EVERY
        if (f.hp < f.s.hp) {
          const add = Math.max(1, Math.round(f.s.hp * ITEMS.charm.n / 100))
          this._heal(f, add)
          this._number(f, `+${add}`, 'heal')
          this._renderCards()
        }
      }
      if (f.boss && started && !this.over && (f.specialCd -= dt) <= 0) {
        f.specialCd = f.bossRaged ? SPECIAL_RAGE_EVERY : SPECIAL_EVERY
        this._bossSpecial(f)
      }
      if (started && !this.over && !(f.stun > 0)) {
        // Heal Friends: every few seconds patches up the most hurt friend.
        if (f.power === 'heal') {
          f.healCd -= dt
          if (f.healCd <= 0) {
            f.healCd = HEAL_EVERY
            const hurt = this.fighters.filter((o) => o.alive && o.side === f.side && o.hp < o.s.hp).sort((a, b) => a.hp / a.s.hp - b.hp / b.s.hp)[0]
            if (hurt) {
              const add = Math.max(1, Math.round(hurt.s.hp * HEAL_SHARE))
              this._heal(hurt, add, f)
              this._number(hurt, `+${add}`, 'heal')
              this._renderCards()
            }
          }
        }
        const n = this._nearest(f, this._enemiesOf(f))
        if (n) {
          const dx = n.o.x - f.x
          const dz = n.o.z - f.z
          f.heading = Math.atan2(dx, dz)
          if (n.d - (n.o.rad + f.rad - GAP) > f.reach) {
            mx = dx / n.d
            mz = dz / n.d
          } else if (f.cd <= 0) this._attack(f, n.o)
        }
      }
      const slow = this._hazardStep(f, dt, started) * (f.cheer === 'speed' ? 1 + CHEERS.speed.n / 100 : 1)
      if (!f.alive) continue
      if (mx || mz) f.walk += dt * f.s.speed * 3 * slow
      f.x += (mx * f.s.speed * slow + f.vx) * dt
      f.z += (mz * f.s.speed * slow + f.vz) * dt
      f.vx *= Math.max(0, 1 - dt * 6)
      f.vz *= Math.max(0, 1 - dt * 6)
    }
    // Bones in the air.
    for (const s of this.shots) {
      s.t += dt
      const k = Math.min(1, s.t / s.dur)
      s.x = s.sx + (s.to.x - s.sx) * k
      s.z = s.sz + (s.to.z - s.sz) * k
      s.y = 1.2 + Math.sin(k * Math.PI) * 0.8
      if (k >= 1) {
        s.done = true
        if (!this.over) this._hit(s.from, s.to)
      }
    }
    for (const s of this.shots) if (s.done && s.mesh) s.mesh.removeFromParent()
    this.shots = this.shots.filter((s) => !s.done)
    // Nobody stands inside anybody else, or outside the fence.
    const alive = this.fighters.filter((f) => f.alive)
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]
        const b = alive[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d = dist(dx, dz)
        const gap = a.rad + b.rad
        if (d > 0 && d < gap) {
          // A raid boss is too heavy to push: the other one moves it all.
          const pa = b.boss ? 0 : a.boss ? 1 : 0.5
          const push = gap - d
          a.x -= (dx / d) * push * (1 - pa)
          a.z -= (dz / d) * push * (1 - pa)
          b.x += (dx / d) * push * pa
          b.z += (dz / d) * push * pa
        }
      }
    }
    for (const f of this.fighters) {
      const edge = ARENA - 0.8 * f.big
      f.x = Math.max(-edge, Math.min(edge, f.x))
      f.z = Math.max(-edge, Math.min(edge, f.z))
      f.hop = Math.max(0, f.hop - dt)
      f.air = Math.max(0, f.air - dt)
    }
    this._placeCamera(dt)
  }

  // How high it is off the floor: a hit's little hop, or a bounce pad's jump.
  _lift(f) {
    const hop = f.hop > 0 ? Math.sin((f.hop / 0.18) * Math.PI) * 0.25 : 0
    const air = f.air > 0 ? Math.sin((f.air / BOUNCE_AIR) * Math.PI) * BOUNCE_HIGH : 0
    return Math.max(hop, air)
  }

  // Is it standing on one of the hazard's blocks? (Not flyers, not mid-air.)
  _onHazard(f) {
    return !!this.hazard && !f.flies && !(f.air > 0) && this.hazardCells.has(`${Math.floor(f.x)},${Math.floor(f.z)}`)
  }

  // The arena hazard's effect on one fighter this step. Returns its speed
  // multiplier (mud slows it).
  _hazardStep(f, dt, started) {
    f.bounceCd = Math.max(0, f.bounceCd - dt)
    if (!started || this.over || !this._onHazard(f)) {
      f.lavaCd = 0
      f.flowerCd = FLOWER_TICK
      return 1
    }
    if (this.hazard === 'mud') return HAZARDS.mud.n / 100
    if (this.hazard === 'lava' && (f.lavaCd -= dt) <= 0) {
      f.lavaCd = LAVA_TICK
      const dmg = Math.max(1, Math.round((f.s.hp * HAZARDS.lava.n * LAVA_TICK) / 100))
      this._fill(f.side, Math.min(dmg, f.hp))
      f.st.took += Math.min(dmg, f.hp)
      f.hp = Math.max(0, f.hp - dmg)
      f.flash = 0.12
      if (f.mats) for (const mat of f.mats) if (mat.emissive) mat.emissive.setHex(0x663300)
      this._number(f, dmg, 'lava')
      this._renderCards()
      if (f.hp <= 0) this._down(f)
    } else if (this.hazard === 'flowers' && (f.flowerCd -= dt) <= 0) {
      f.flowerCd = FLOWER_TICK
      if (f.hp < f.s.hp) {
        const add = Math.max(1, Math.round((f.s.hp * HAZARDS.flowers.n) / 100))
        this._heal(f, add)
        this._number(f, `+${add}`, 'heal')
        this._renderCards()
      }
    } else if (this.hazard === 'bounce' && f.bounceCd <= 0) {
      // Thrown toward its target (or the middle when nobody's left).
      const n = this._nearest(f, this._enemiesOf(f))
      const dx = (n ? n.o.x : 0) - f.x
      const dz = (n ? n.o.z : 0) - f.z
      const len = dist(dx, dz) || 1
      f.vx = (dx / len) * BOUNCE_PUSH
      f.vz = (dz / len) * BOUNCE_PUSH
      f.air = BOUNCE_AIR
      f.bounceCd = BOUNCE_CD
      this._float(f, t('hazardBoing'), 'power bounce')
    }
    return 1
  }

  _draw() {
    if (this.view === '2d') this._draw2d()
    else this._draw3d()
  }

  _draw3d() {
    for (const f of this.fighters) {
      f.group.position.set(f.x, this._lift(f), f.z)
      if (f.alive) {
        // Turn smoothly toward where it's heading.
        let d = f.heading - f.group.rotation.y
        d = Math.atan2(Math.sin(d), Math.cos(d))
        f.group.rotation.y += d * 0.2
        const swing = Math.sin(f.walk) * 0.6
        f.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? swing : -swing })
      } else f.group.rotation.z = (1 - f.fall / FALL_S) * (Math.PI / 2)
      f.ring.position.set(f.x, 0.02, f.z)
    }
    for (const s of this.shots) {
      if (!s.mesh) {
        s.mesh = new THREE.Mesh(this._boneGeo, this._boneMat)
        this.scene.add(s.mesh)
      }
      s.mesh.position.set(s.x, s.y, s.z)
      s.mesh.rotation.x += 0.3
    }
    if (this.hazard === 'lava' && this.hazardMesh) this.hazardMesh.material.color.setScalar(0.85 + 0.15 * Math.sin(this.time * 3))
    this.skyDome.position.copy(this.camera.position)
    this.skyDome.material.uniforms.height.value = this.renderer.domElement.height || 1
    this.renderer.render(this.scene, this.camera)
  }

  // The 2D board: the arena seen from straight above, fitted to the screen
  // under the team bar.
  _board() {
    const top = this.w < 600 ? 150 : 110
    const size = Math.max(120, Math.min(this.w - 24, this.h - top - 50))
    const cell = size / (ARENA * 2)
    return { x: (this.w - size) / 2, y: top + (this.h - top - 50 - size) / 2, size, cell }
  }

  _draw2d() {
    const cv = this.root.querySelector('.tb-canvas-2d')
    const g = cv.getContext('2d')
    const r = this._ratio || 1
    g.setTransform(r, 0, 0, r, 0, 0)
    g.imageSmoothingEnabled = false
    const b = this._board()
    // The arena picture, made again only when the size changes.
    const key = `${this.w}x${this.h}x${r}`
    if (this._bg?.key !== key) this._bg = { key, cv: board2d(this.w, this.h, r, b, this.hazard, this.hazardCells) }
    g.drawImage(this._bg.cv, 0, 0, this.w, this.h)
    // A friend who accepted sees the arena turned round (their team below).
    const fl = this._flip ? -1 : 1
    const px = (x) => b.x + (x * fl + ARENA) * b.cell
    // Fallen ones first, so the standing ones are drawn on top.
    const order = [...this.fighters].sort((a, c) => (a.alive - c.alive) || a.z - c.z)
    for (const f of order) {
      const cx = px(f.x)
      const cy = px(f.z)
      const lift = this._lift(f) * 1.4
      const sz = b.cell * (1.7 + lift) * (f.c.b ? 1.25 : 1) * (f.mini ? GROAN_SCALE : 1) * f.big
      g.save()
      if (!f.alive) {
        g.globalAlpha = 0.25 + 0.75 * (f.fall / FALL_S)
        g.translate(cx, cy)
        g.rotate((1 - f.fall / FALL_S) * (Math.PI / 2))
        g.translate(-cx, -cy)
      } else {
        // The team's ring under it.
        g.strokeStyle = f.side === this.me ? '#4aa3ff' : '#ff4d4d'
        g.lineWidth = Math.max(2, b.cell * 0.14)
        g.beginPath()
        g.arc(cx, cy, sz * 0.55, 0, Math.PI * 2)
        g.stroke()
      }
      // Facing: the picture flips to look toward its target.
      const flip = Math.sin(f.heading) * fl < -0.1 ? -1 : 1
      g.translate(cx, cy)
      g.scale(flip, 1)
      if (f.c.s) g.filter = SHINY_FILTER
      if (f.icon.complete && f.icon.naturalWidth) g.drawImage(f.icon, -sz / 2, -sz / 2, sz, sz)
      g.filter = 'none'
      if (f.flash > 0) {
        g.globalAlpha = 0.5
        g.fillStyle = '#ff2a1a'
        g.fillRect(-sz / 2, -sz / 2, sz, sz)
      }
      g.restore()
    }
    g.fillStyle = '#f2ecdc'
    for (const s of this.shots) {
      const d = b.cell * 0.4
      g.fillRect(px(s.x) - d / 2, px(s.z) - d / 2 - s.y * b.cell * 0.5, d, d)
    }
  }

  // 3D: a view over the whole arena that drifts toward where the fight is.
  _placeCamera(dt) {
    if (!this.camera) return
    const alive = this.fighters.filter((f) => f.alive)
    const at = new THREE.Vector3()
    for (const f of alive) at.add(new THREE.Vector3(f.x, 0, f.z))
    if (alive.length) at.multiplyScalar(0.4 / alive.length)
    // Narrow (phone) screens step back so the arena still fits across.
    const far = Math.min(2.2, Math.max(1, 1.2 / (this.camera.aspect || 1)))
    // The friend who accepted watches from the other end.
    const want = new THREE.Vector3(at.x, CAM.up * far, at.z + (this._flip ? -1 : 1) * CAM.back * far)
    this.camera.position.lerp(want, Math.min(1, dt * 3))
    this.camera.lookAt(at.x, 0, at.z)
  }

  _placeLabels() {
    for (const f of this.fighters) {
      if (!f.alive) continue
      const at = this._screen(f.x, this.view === '3d' ? f.labelY ?? f.height * (f.group?.scale.y || 1) + 0.35 : 1.9 * f.big, f.z)
      f.label.style.left = `${at.left}%`
      f.label.style.top = `${at.top}%`
      f.label.querySelector('.tb-label-bar span').style.width = `${(f.hp / f.s.hp) * 100}%`
    }
  }

  _renderCards() {
    for (const side of ['mine', 'foe']) {
      const el = this.root?.querySelector(this._seen(side) === 'mine' ? '.tb-mine' : '.tb-foe')
      if (!el) continue
      el.innerHTML = this.fighters.filter((f) => f.side === side).map((f) => `
        <div class="tb-card${f.alive ? '' : ' down'}${f.mini ? ' mini' : ''}${f.c.s ? ' shiny' : ''}" style="border-color: ${tierColor(f.c.r)}" title="${esc(f.power ? `${powerName(f.c)}: ${powerInfo(f.c)}${f.trig ? ` · ${triggerName(f.trig)}: ${triggerInfo(f.trig)}` : ''}${f.snack ? ` · ${snackName(f.snack)}: ${snackInfo(f.snack)}` : ''}` : '')}${f.item ? esc(`${f.power ? ' · ' : ''}${itemName(f.item)}: ${itemInfo(f.item)}`) : ''}">
          <img src="${creatureIconURL(f.c)}" alt="" draggable="false" />${f.snack ? snackImg(f.snack, 'tb-card-snack') : ''}${f.item ? itemImg(f.item, 'tb-card-item') : ''}
          <span class="tb-card-bar"><span style="width: ${(f.hp / f.s.hp) * 100}%"></span></span>
        </div>`).join('')
    }
  }

  _timeUp() {
    // A raid boss still standing when time runs out wins.
    if (this.raid) return this._finish(false)
    const share = (side) => {
      const list = this.fighters.filter((f) => f.side === side)
      return list.reduce((sum, f) => sum + f.hp / f.s.hp, 0) / (list.length || 1)
    }
    this._finish(share('mine') >= share('foe'))
  }

  // mineWon: the arena's 'mine' side won (in a friend battle that's the
  // challenger) - turned into this screen's player's win.
  _finish(mineWon) {
    if (this.over || !this.root) return
    this.over = true
    const won = this.me === 'mine' ? mineWon : !mineWon
    if (this.replay) return this._finishReplay(won)
    // Kept as the "last battle" replay (ReplayStore.js).
    if (this.rec) {
      this.rec.t = Date.now()
      this.rec.won = won
      setLastReplay(this.rec)
    }
    // XP for my team first, so onEnd's Team page shows the new levels.
    const ids = this.live ? this.live.ids || [] : this.mine.map((c) => c.id)
    const xp = this.xp ? giveTeamXP(ids.filter(Number.isInteger), won) : null
    // onEnd: the coins, or { coins, item } when a held item was found.
    const out = this.onEnd?.(won)
    const reward = (out && typeof out === 'object' ? out.coins : out) || 0
    const found = out && typeof out === 'object' && ITEMS[out.item] ? out.item : null
    const box = this.root.querySelector('.tb-result')
    box.querySelector('.tb-result-title').textContent = t(won ? 'teamBattleWon' : 'teamBattleLost')
    box.querySelector('.tb-result-text').textContent = out && typeof out === 'object' && typeof out.text === 'string' ? out.text : this.live ? t('petDuelNoCoins') : t('teamBattleReward', { n: reward })
    const news = box.querySelector('.tb-result-news')
    news.innerHTML = !xp ? '' : [t('teamXpGained', { n: xp.gain }), ...xp.news.map((e) => {
      const name = creatureName(e.c)
      if (e.kind === 'level') return t('teamLevelUp', { name, n: e.n })
      if (e.kind === 'trigger') return t('teamTrigUnlocked', { name, power: triggerName(e.n) })
      return t('teamEvolved', { name, rarity: rarityName(e.n) })
    })].map((line, i) => `<li${i ? ' class="tb-news-big"' : ''}>${esc(line)}</li>`).join('')
    // Trophies (PetRank.js, Batch M): only the Battle button's battles.
    if (out && typeof out === 'object' && Number.isInteger(out.tr)) {
      const line = t(out.tr >= 0 ? 'trophyWon' : 'trophyLost', { n: Math.abs(out.tr) })
      const up = out.rank ? `<li class="tb-news-big">${esc(t('petRankUp', { rank: out.rank }))}</li>` : ''
      news.insertAdjacentHTML('beforeend', `<li class="tb-news-big tb-news-trophy">${esc(line)}</li>${up}`)
    }
    // Extra lines (a raid badge).
    if (out && typeof out === 'object' && Array.isArray(out.news)) {
      news.insertAdjacentHTML('afterbegin', out.news.map((line) => `<li class="tb-news-big">${esc(String(line))}</li>`).join(''))
    }
    if (found) news.insertAdjacentHTML('afterbegin', `<li class="tb-news-big tb-news-item">${itemImg(found, 'tb-news-icon')} ${esc(t('itemFound', { name: itemName(found) }))}</li>`)
    this._renderStats()
    // againKey returning false: no again button (a Pack Leader beaten in a game).
    const again = this.againKey?.(won)
    box.querySelector('.tb-again').style.display = again === false ? 'none' : ''
    box.querySelector('.tb-again').textContent = t(again || 'teamBattleAgain')
    box.querySelector('.tb-back').textContent = t('teamBattleBack')
    box.style.display = 'flex'
    if (won) audioEngine.playLevelUp?.()
  }

  // A replay's end: the result and stats, Watch Again and Back.
  _finishReplay(won) {
    const box = this.root.querySelector('.tb-result')
    box.querySelector('.tb-result-title').textContent = t(won ? 'teamBattleWon' : 'teamBattleLost')
    box.querySelector('.tb-result-text').textContent = t('replayDone')
    box.querySelector('.tb-result-news').innerHTML = ''
    this._renderStats()
    box.querySelector('.tb-again').textContent = t('replayWatchAgain')
    box.querySelector('.tb-back').textContent = t('teamBattleBack')
    this.onAgain = () => playReplay(this.replay, { view: this.view, onView: this.onView })
    this.root.querySelector('.tb-replay-bar').hidden = true
    box.style.display = 'flex'
  }

  // After-battle stats (Batch I): both teams' pets (mine first), with a
  // Best Pet award for the top score = damage + healing + a knockout bonus.
  _renderStats() {
    const el = this.root.querySelector('.tb-stats')
    const pets = this.fighters.filter((f) => !f.mini)
    if (!el || !pets.length) return
    const avgHp = pets.reduce((sum, f) => sum + f.s.hp, 0) / pets.length
    const score = (f) => f.st.dmg + f.st.heal + f.st.ko * avgHp * KO_SCORE
    const best = pets.reduce((a, b) => (score(b) > score(a) ? b : a))
    const row = (f) => `<tr class="${f === best ? 'tb-stats-best' : ''}${f.alive ? '' : ' down'}">
      <td class="tb-stats-pet"><img src="${creatureIconURL(f.c)}" alt="" draggable="false" /><span style="color: ${tierColor(f.c.r)}">${f === best ? '★ ' : ''}${esc(creatureName(f.c))}</span></td>
      <td>${Math.round(f.st.dmg)}</td><td>${Math.round(f.st.heal)}</td><td>${Math.round(f.st.took)}</td><td>${f.st.ko}</td></tr>`
    const team = (side) => {
      const list = pets.filter((f) => this._seen(f.side) === side)
      return list.length ? `<tr class="tb-stats-team"><th colspan="5">${esc(t(side === 'mine' ? 'statsYourTeam' : 'statsTheirTeam'))}</th></tr>${list.map(row).join('')}` : ''
    }
    el.innerHTML = `<p class="tb-stats-award">★ ${esc(t(this._seen(best.side) === 'mine' ? 'statsBestPet' : 'statsBestPetFoe', { name: creatureName(best.c) }))}</p>
      <div class="tb-stats-scroll"><table class="tb-stats-table">
        <thead><tr><th></th><th>${esc(t('statsDmg'))}</th><th>${esc(t('statsHeal'))}</th><th>${esc(t('statsTook'))}</th><th>${esc(t('statsKo'))}</th></tr></thead>
        <tbody>${team('mine')}${team('foe')}</tbody>
      </table></div>`
  }

  // Left before the end: no win, no loss.
  _leave() {
    if (!this.over) this.onEnd?.(null)
    this.over = true
    this.close()
  }

  close() {
    if (!this.root) return
    cancelAnimationFrame(this._raf)
    clearTimeout(this._sayTimer)
    window.removeEventListener('resize', this._resize)
    window.removeEventListener('keydown', this._onKey, true)
    window.removeEventListener('keyup', this._onKey, true)
    if (this.renderer) {
      // Zombie bodies are this battle's own; animal ones are shared, kept.
      this.scene.traverse((o) => {
        if (o.isMesh && !this.fighters.some((f) => f.c.t === 'a' && f.group && o.parent && isInside(o, f.group))) {
          o.geometry?.dispose?.()
        }
      })
      for (const m of this._shinyMats || []) m.dispose()
      this.renderer.dispose()
      this.renderer.forceContextLoss?.()
    }
    this.root.remove()
    this.root = null
    this.onClose?.()
  }
}

// Watch a replay (ReplayStore.js): a battle of its own. TeamBattle.track(b)
// (set by TeamUI.js) tells the game which battle is up.
export function playReplay(rec, { view = '3d', onView } = {}) {
  if (!rec || !Number.isInteger(rec.seed)) return null
  const b = new TeamBattle({ mine: rec.mine, theirs: rec.theirs, foe: rec.foe, ghost: rec.ghost, view, onView, replay: rec })
  // (rec.raid: a raid replay - the constructor reads it from the replay.)
  TeamBattle.track?.(b)
  b.open()
  return b
}

function isInside(o, group) {
  for (let p = o; p; p = p.parent) if (p === group) return true
  return false
}
