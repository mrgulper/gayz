// Old mine lines (2026-11-13, Gaymi: "a random old railway pops up out of
// nowhere, please make it just spawn naturally underground"). Before, a
// track was dug out in front of you while you walked underground; now the
// lines are part of the world, like the dungeons (Dungeons.js): at most
// one per MT_GRID square, MT_FLOOR_MAX..MT_FLOOR_MIN below ground, a
// straight tunnel LEN_MIN..LEN_MAX cells long, 3 wide and 3 high, with a
// stone-brick bed, a wooden frame (log posts and a plank beam) every
// BEAM_EVERY cells and now and then a glowstone lamp in a beam. The same
// seed always gives the same lines, so everyone on a server shares them.
//
// Pure, like UnderCity.js: mineCell(m, x, y, z) says what one cell is -
// undefined (not the line: rock and caves as normal), null (open air) or
// a block type - and Underground treats lines like its underground cities
// (they ride along in the same lists). The rails and the minecart are
// meshes, added by Minecarts.js when you come near one.
import { dungeonsOver, dungeonYRange } from './Dungeons.js'

export const MT_GRID = 112
const MT_CHANCE = 0.65
export const LEN_MIN = 30
export const LEN_MAX = 64
// Deep enough that no ocean floor (lowest about -18) or dungeon reaches it.
const MT_FLOOR_MAX = -28
const MT_FLOOR_MIN = -40
const CITY_GAP = 150 // from the block city's middle
const HEAD = 3 // air over the bed
const BEAM_EVERY = 8
const LAMP_EVERY = 3 // every third beam has a lamp

let SALT = 0
export function setMineSeed(seed) {
  SALT = seed | 0
}

function hash(a, b, c) {
  let h = Math.imul(a | 0, 0x3c6ef372) ^ Math.imul(b | 0, 0x1b873593) ^ Math.imul((c + SALT) | 0, 0x5bd1e995)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const cache = new Map()
let cacheSalt = null

// The line in grid square (gx, gz), or null. x0, z0: its first cell; it
// runs `len` cells along (dx, dz); floor: the bed's y.
export function mineIn(gx, gz) {
  if (cacheSalt !== SALT) {
    cache.clear()
    cacheSalt = SALT
  }
  const key = `${gx},${gz}`
  if (cache.has(key)) return cache.get(key)
  let m = null
  if (hash(gx, gz, 2101) < MT_CHANCE) {
    const len = LEN_MIN + Math.floor(hash(gx, gz, 2102) * (LEN_MAX - LEN_MIN + 1))
    const alongX = hash(gx, gz, 2103) < 0.5
    const back = hash(gx, gz, 2104) < 0.5
    const dx = alongX ? (back ? -1 : 1) : 0
    const dz = alongX ? 0 : back ? -1 : 1
    // Kept inside its square, a couple of cells from the edges.
    const room = MT_GRID - len - 4
    const a = 2 + Math.floor(hash(gx, gz, 2105) * room) + (back ? len : 0)
    const b = 2 + Math.floor(hash(gx, gz, 2106) * (MT_GRID - 4))
    const x0 = gx * MT_GRID + (alongX ? a : b)
    const z0 = gz * MT_GRID + (alongX ? b : a)
    const floor = MT_FLOOR_MAX - Math.floor(hash(gx, gz, 2107) * (MT_FLOOR_MAX - MT_FLOOR_MIN))
    m = { mine: true, id: `m${key}`, x0, z0, dx, dz, len, floor }
    const box = mineBox(m)
    const far = Math.hypot((box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2) > CITY_GAP
    // Never through a dungeon.
    const clash = dungeonsOver(box.x0 - 2, box.z0 - 2, box.x1 + 2, box.z1 + 2).some((d) => {
      const [lo, hi] = dungeonYRange(d)
      return hi >= floor - 1 && lo <= floor + HEAD + 2
    })
    if (!far || clash) m = null
  }
  cache.set(key, m)
  return m
}

// The cells a line covers (x/z, walls included).
export function mineBox(m) {
  const x1 = m.x0 + m.dx * m.len
  const z1 = m.z0 + m.dz * m.len
  const w = m.dx ? 0 : 1
  const d = m.dz ? 0 : 1
  return { x0: Math.min(m.x0, x1) - w, x1: Math.max(m.x0, x1) + w, z0: Math.min(m.z0, z1) - d, z1: Math.max(m.z0, z1) + d }
}

// Every line reaching into the box (x0..x1, z0..z1).
export function minesOver(x0, z0, x1, z1) {
  const out = []
  for (let gx = Math.floor((x0 - 2) / MT_GRID); gx <= Math.floor((x1 + 2) / MT_GRID); gx++) {
    for (let gz = Math.floor((z0 - 2) / MT_GRID); gz <= Math.floor((z1 + 2) / MT_GRID); gz++) {
      const m = mineIn(gx, gz)
      if (!m) continue
      const b = mineBox(m)
      if (b.x1 >= x0 && b.x0 <= x1 && b.z1 >= z0 && b.z0 <= z1) out.push(m)
    }
  }
  return out
}

export function mineYRange(m) {
  return [m.floor, m.floor + HEAD + 1]
}

export function mineCell(m, x, y, z) {
  const dy = y - m.floor
  if (dy < 0 || dy > HEAD + 1) return undefined
  // k: how far along; w: across (-1..1).
  const k = m.dx ? (x - m.x0) * m.dx : (z - m.z0) * m.dz
  const w = m.dx ? z - m.z0 : x - m.x0
  if (k < 0 || k > m.len || w < -1 || w > 1) return undefined
  // (never at the ends, where you hop off the cart to the side)
  const beam = k > 0 && k < m.len && k % BEAM_EVERY === BEAM_EVERY / 2
  if (dy === 0) return w ? 'cobblestone' : 'stonebricks'
  if (dy === HEAD + 1) {
    if (!beam) return undefined
    return !w && Math.floor(k / BEAM_EVERY) % LAMP_EVERY === 1 ? 'glowstone' : 'oakplanks'
  }
  if (beam && w) return 'oaklog'
  return null
}
