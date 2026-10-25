// Built places out in Map 1's open world (2026-10-16, Gaymi: "make more
// human made buildings like bridge on water and castles, village etc").
// OpenWorld.js asks for the plan of each STRUCT_GRID square (cached) and
// stamps the part of it inside every chunk column it grows, before the
// ground - so the ground and water fill in around it and trees keep clear
// of it (`claims`). Plans are pure: the same seed and square always give
// the same village, castle or bridge, so neighbouring columns match.
//
// Terrain blocks can only be full cubes (no ladders, slabs, fences or
// doors - those are the editor's shaped blocks), so doorways are open
// gaps, towers are climbed on spiral steps of whole blocks (one jump each)
// and railings are log posts or a low stone parapet.

// One possible place per STRUCT_GRID x STRUCT_GRID square of land, its
// centre anywhere in the square (so they never line up in rows); of two
// centres closer than MIN_APART only the one with the lower priority
// number is kept, so places never overlap. A place's blocks reach less
// than STRUCT_GRID from its centre.
export const STRUCT_GRID = 80
const MIN_APART = 95
// No places this close to the city's outline (the land is flattened there).
const CITY_GAP = 48

const VILLAGE_BIOMES = new Set(['plains', 'savanna', 'desert', 'taiga', 'snowyPlains', 'snowyTaiga', 'forest', 'birchForest', 'cherryGrove', 'badlands'])
const CASTLE_BIOMES = new Set(['plains', 'forest', 'birchForest', 'darkForest', 'taiga', 'snowyTaiga', 'snowyPlains', 'mountains', 'savanna', 'cherryGrove'])

import { buildLandmark } from './Landmarks.js'
import { buildTown } from './Towns.js'

// Names for the HUD (i18n keys).
export const STRUCTURE_NAMES = { village: 'placeVillage', castle: 'placeCastle', bridge: 'placeBridge', pyramid: 'placePyramid' }

// Materials per climate. walls: picked per house; trim: the roof's
// overhanging edge; shutter: window shutters; lamp: street and door lights.
function villageStyle(biome) {
  if (biome === 'desert' || biome === 'badlands') {
    return { walls: ['smoothsandstone', 'sandstonebricks', 'plaster'], frame: 'cutsandstone', base: 'sandstone', roofs: ['smoothsandstone', 'cutsandstone'], trim: 'chiseledsandstone', floor: 'sandstone', path: 'smoothsandstone', lamp: 'paperlantern', fence: 'cutsandstone', shutter: 'orangeterracotta', rug: 'redwool', timber: false }
  }
  if (biome === 'savanna') {
    return { walls: ['acaciaplanks', 'plaster', 'orangeterracotta'], frame: 'acacialog', base: 'terracotta', roofs: ['thatch', 'acaciaplanks'], trim: 'acacialog', floor: 'acaciaplanks', path: 'coarsedirt', lamp: 'paperlantern', fence: 'acacialog', shutter: 'acaciaplanks', rug: 'orangewool', timber: false }
  }
  if (biome === 'taiga' || biome === 'snowyTaiga' || biome === 'snowyPlains') {
    return { walls: ['spruceplanks', 'spruceplanks', 'stonebricks'], frame: 'sprucelog', base: 'cobblestone', roofs: ['slateshingles', 'darkoakplanks'], trim: 'darkoakplanks', floor: 'spruceplanks', path: 'coarsedirt', lamp: 'paperlantern', fence: 'sprucelog', shutter: 'darkoakplanks', rug: 'bluewool', timber: false }
  }
  return { walls: ['timberframe', 'plaster', 'oakplanks'], frame: 'oaklog', base: 'cobblestone', roofs: ['thatch', 'roofshingles', 'roofshingles'], trim: 'darkoakplanks', floor: 'spruceplanks', path: 'gravel', lamp: 'paperlantern', fence: 'oaklog', shutter: 'spruceplanks', rug: 'redwool', timber: true }
}

const CASTLE_STONE = [[0.36, 'stonebricks'], [0.16, 'mossystonebricks'], [0.14, 'crackedstonebricks'], [0.12, 'cobblestone'], [0.1, 'mossycobblestone'], [0.07, 'andesite'], [0.05, 'stonebricks']]

// A tiny seeded generator for one plan.
function prng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Collects a plan's blocks; later writes win (so a doorway can be cut
// through a finished wall).
class Builder {
  constructor(kind, cx, cz) {
    this.kind = kind
    this.cx = cx
    this.cz = cz
    this.cells = new Map()
    this.paths = new Map()
  }

  set(x, y, z, type) {
    this.cells.set(`${x},${y},${z}`, type)
  }

  clear(x, y, z) {
    this.cells.delete(`${x},${y},${z}`)
  }

  fill(x0, y0, z0, x1, y1, z1, type) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, type)
      }
    }
  }

  path(x, z, type) {
    this.paths.set(`${x},${z}`, type)
  }

  // Columns of blocks per chunk column, the bounding box, and each cell's
  // top block (the minimap).
  finish(chunk) {
    const byColumn = new Map()
    const top = new Map()
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (const [k, type] of this.cells) {
      const [x, y, z] = k.split(',').map(Number)
      const ck = `${Math.floor(x / chunk)},${Math.floor(z / chunk)}`
      let list = byColumn.get(ck)
      if (!list) byColumn.set(ck, (list = []))
      list.push(x, y, z, type)
      const tk = `${x},${z}`
      const cur = top.get(tk)
      if (!cur || y > cur.y) top.set(tk, { y, type })
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (z < z0) z0 = z
      if (z > z1) z1 = z
    }
    for (const k of this.paths.keys()) {
      const [x, z] = k.split(',').map(Number)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (z < z0) z0 = z
      if (z > z1) z1 = z
    }
    return { kind: this.kind, cx: this.cx, cz: this.cz, x0, x1, z0, z1, byColumn, top, paths: this.paths }
  }
}

// What square (i, j) would hold, from cheap checks only (its centre's
// land, a roll, for a bridge some water nearby): { cx, cz, kind, order }
// or null.
function candidate(i, j, { land, hash, sea, cityDistance }) {
  const cx = i * STRUCT_GRID + Math.floor(hash(i, j, 401) * STRUCT_GRID)
  const cz = j * STRUCT_GRID + Math.floor(hash(i, j, 409) * STRUCT_GRID)
  if (cityDistance(cx, cz) < CITY_GAP) return null
  const roll = hash(i, j, 421)
  const centre = land(cx, cz)
  let kind = null
  // Deserts: a pyramid in some squares (2026-10-17, "add pyramids in deserts").
  if (centre.h > sea && centre.biome === 'desert' && roll < 0.3) kind = 'pyramid'
  else if (centre.h > sea && VILLAGE_BIOMES.has(centre.biome) && roll < 0.45) kind = 'village'
  else if (centre.h > sea && CASTLE_BIOMES.has(centre.biome) && roll < 0.75) kind = 'castle'
  else {
    for (let x = cx - 32; x <= cx + 32 && !kind; x += 8) for (let z = cz - 32; z <= cz + 32; z += 8) if (land(x, z).h < sea) { kind = 'bridge'; break }
  }
  return kind ? { cx, cz, kind, order: hash(i, j, 431) } : null
}

// The plan for grid square (gx, gz), or null for plain land.
// land(x, z): OpenWorld's sampleLand; hash(a, b, seed): its 0..1 hash;
// sea: sea level; cityDistance(x, z); chunk: the column size.
export function planStructure(gx, gz, opts) {
  const { land, hash, sea, cityDistance, chunk } = opts
  const me = candidate(gx, gz, opts)
  if (!me) return null
  // Of two would-be places too close together, the lower order wins.
  for (let i = gx - 2; i <= gx + 2; i++) {
    for (let j = gz - 2; j <= gz + 2; j++) {
      if (i === gx && j === gz) continue
      const o = candidate(i, j, opts)
      if (o && o.order < me.order && Math.hypot(o.cx - me.cx, o.cz - me.cz) < MIN_APART) return null
    }
  }
  const { cx, cz } = me
  const heights = new Map()
  const H = (x, z) => {
    const k = `${x},${z}`
    let s = heights.get(k)
    if (!s) heights.set(k, (s = land(x, z)))
    return s
  }
  const rand = prng(Math.floor(hash(gx, gz, 419) * 4294967296))
  const ctx = { H, rand, sea, cx, cz }
  const b = me.kind === 'village' ? village(ctx, H(cx, cz).biome) : me.kind === 'castle' ? castle(ctx) : me.kind === 'pyramid' ? pyramid(ctx) : bridge(ctx, cityDistance)
  return b ? b.finish(chunk) : null
}

// A real-world landmark (Landmarks.js) centred on (cx, cz), from the spawn
// map. Its plan works like any other place's; plan.nameKey names it.
export function planLandmark(kind, cx, cz, { land, chunk }) {
  const heights = new Map()
  const H = (x, z) => {
    const k = `${x},${z}`
    let s = heights.get(k)
    if (!s) heights.set(k, (s = land(x, z)))
    return s
  }
  const b = new Builder('landmark', cx, cz)
  if (!buildLandmark(kind, b, { H, cx, cz })) return null
  return b.finish(chunk)
}

// A real city's block town (Towns.js) centred on (cx, cz), from the spawn
// map; plazaR cells in the middle stay open for its landmark.
export function planTown(style, cx, cz, plazaR, seed, { land, chunk }) {
  const heights = new Map()
  const H = (x, z) => {
    const k = `${x},${z}`
    let s = heights.get(k)
    if (!s) heights.set(k, (s = land(x, z)))
    return s
  }
  const b = new Builder('town', cx, cz)
  buildTown(b, { H, cx, cz, style, plazaR, seed, earthAt })
  return b.finish(chunk)
}

// Highest and lowest ground over a box, and whether it's all dry land.
function siteOf(H, sea, x0, z0, x1, z1, step = 1) {
  let lo = Infinity
  let hi = -Infinity
  let dry = true
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) {
      const s = H(x, z)
      if (s.h <= sea) dry = false
      if (s.h < lo) lo = s.h
      if (s.h > hi) hi = s.h
    }
  }
  return { lo, hi, dry }
}

// Natural rock and earth (2026-10-18, Gaymi: "those mountains should not
// use bricks, human-built things should"): what the ground under a
// building is raised with - stone, andesite, cobblestone and moss deep
// down, dirt near the top - so a raised site reads as a hill, not a brick
// cliff. The building itself keeps its own materials.
export function earthAt(x, y, z, top) {
  if (top - y <= 1) return 'dirt'
  const r = (Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791, 0x9e3779b1) >>> 0) / 4294967296
  return r < 0.55 ? 'stone' : r < 0.72 ? 'andesite' : r < 0.86 ? 'cobblestone' : r < 0.95 ? 'mossycobblestone' : 'gravel'
}

// Blocks from the ground up to (not including) y, so nothing floats: the
// last one is the building's own base (type), everything under it natural.
function foundation(b, H, x, z, y, type) {
  for (let k = H(x, z).h + 1; k < y; k++) b.set(x, k, z, k === y - 1 ? type : earthAt(x, k, z, y - 1))
}

// Full-block steps down from a doorway at floor height `top` (the floor
// block's y) along (dx, dz), `width` cells wide across it - each one a
// block lower, so every step is one jump.
function stepsDown(b, H, x, z, dx, dz, top, width, type) {
  for (let k = 1; k <= 12; k++) {
    const y = top - k
    let any = false
    for (let w = -width; w <= width; w++) {
      const sx = x + dx * k + (dz !== 0 ? w : 0)
      const sz = z + dz * k + (dx !== 0 ? w : 0)
      const g = H(sx, sz).h
      if (y > g) {
        any = true
        for (let yy = g + 1; yy <= y; yy++) b.set(sx, yy, sz, type)
      }
    }
    if (!any) break
  }
}

// --- pyramid ---

// A stepped sandstone pyramid (2026-10-17): every layer a block in from
// the one below, a stripe of orange terracotta every few layers, gold on
// the very top. It's hollow: a doorway and a 2-wide passage lead into a
// tall chamber with sandstone pillars, glowing sea lanterns and a lapis
// altar holding gold. Full blocks only (terrain), so every step outside
// is one jump - you can climb it.
function pyramid({ H, rand, sea, cx, cz }) {
  const R = 15
  const site = siteOf(H, sea, cx - R, cz - R, cx + R, cz + R, 2)
  if (!site.dry || site.hi - site.lo > 8) return null
  const b = new Builder('pyramid', cx, cz)
  const base = site.hi + 1
  const shell = (k) => (k % 4 === 2 ? 'orangeterracotta' : k % 2 ? 'smoothsandstone' : 'sandstonebricks')
  for (let k = 0; k <= R; k++) {
    const half = R - k
    const y = base + k
    for (let x = cx - half; x <= cx + half; x++) {
      for (let z = cz - half; z <= cz + half; z++) {
        const edge = Math.max(Math.abs(x - cx), Math.abs(z - cz))
        // Two blocks thick, solid near the top; the floor layer is whole.
        if (k === 0 || edge >= half - 1 || half <= 3) b.set(x, y, z, k === R ? 'gold' : k === 0 && edge < half - 1 ? 'sandstonebricks' : shell(k))
      }
    }
  }
  // Ground under the bottom layer, so it never floats.
  for (let x = cx - R; x <= cx + R; x++) for (let z = cz - R; z <= cz + R; z++) foundation(b, H, x, z, base, 'sandstone')
  // Doorway and passage on a random side, 2 wide and 3 tall.
  const side = Math.floor(rand() * 4)
  const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][side]
  for (let d = 0; d <= R; d++) {
    for (let w = 0; w <= 1; w++) {
      const x = cx + dx * d + (dz !== 0 ? w : 0)
      const z = cz + dz * d + (dx !== 0 ? w : 0)
      for (let y = base + 1; y <= base + 3; y++) b.clear(x, y, z)
    }
  }
  // Chamber pillars, lights and the altar.
  for (const [px, pz] of [[-5, -5], [-5, 5], [5, -5], [5, 5]]) {
    for (let y = base + 1; y <= base + 6; y++) b.set(cx + px, y, cz + pz, y === base + 6 ? 'sealantern' : 'chiseledsandstone')
  }
  b.set(cx, base + 1, cz, 'lapisblock')
  b.set(cx, base + 2, cz, 'gold')
  return b
}

// --- village ---

function village({ H, rand, sea, cx, cz }, biome) {
  const R = 24
  const site = siteOf(H, sea, cx - R, cz - R, cx + R, cz + R, 4)
  if (!site.dry || site.hi - site.lo > 8) return null
  const st = villageStyle(biome)
  const b = new Builder('village', cx, cz)
  const taken = new Set() // "x,z" of path and house cells
  const take = (x, z) => taken.add(`${x},${z}`)
  const isTaken = (x, z) => taken.has(`${x},${z}`)
  const houses = new Set() // "x,z" of houses and the cell around each
  // Four winding streets out from the well.
  const arms = []
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const len = 14 + Math.floor(rand() * 9)
    const phase = rand() * 6
    const pts = []
    for (let t = 0; t <= len; t++) {
      const wob = Math.round(Math.sin(t * 0.28 + phase) * 1.6)
      const px = cx + dx * t + (dz !== 0 ? wob : 0)
      const pz = cz + dz * t + (dx !== 0 ? wob : 0)
      pts.push([px, pz])
      for (let w = -1; w <= 1; w++) {
        const qx = px + (dz !== 0 ? w : 0)
        const qz = pz + (dx !== 0 ? w : 0)
        if (H(qx, qz).h > sea) {
          b.path(qx, qz, st.path)
          take(qx, qz)
        }
      }
    }
    arms.push({ dx, dz, pts })
  }
  // The well in the middle.
  let wy = -Infinity
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) wy = Math.max(wy, H(x, z).h)
  for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) take(x, z)
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let z = cz - 1; z <= cz + 1; z++) {
      foundation(b, H, x, z, wy + 1, st.base)
      b.set(x, wy, z, st.base)
      b.set(x, wy - 1, z, st.base)
      if (x !== cx || z !== cz) b.set(x, wy + 1, z, st.base)
    }
  }
  b.set(cx, wy, cz, 'water')
  b.set(cx, wy + 1, cz, 'water')
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.fill(cx + ox, wy + 2, cz + oz, cx + ox, wy + 3, cz + oz, st.frame)
  b.fill(cx - 1, wy + 4, cz - 1, cx + 1, wy + 4, cz + 1, st.roofs[0])
  b.set(cx, wy + 5, cz, st.trim)

  // Market stalls on two corners of the square: four posts, a striped
  // canopy and a counter of goods.
  const CANOPIES = [['redwool', 'whitewool'], ['bluewool', 'whitewool'], ['yellowwool', 'greenwool']]
  const GOODS = ['barrel', 'crate', 'melon', 'pumpkin', 'haybale']
  const corners = [[1, 1], [-1, 1], [1, -1], [-1, -1]].sort(() => rand() - 0.5).slice(0, 2)
  for (const [sx, sz] of corners) {
    const xs = [cx + sx * 3, cx + sx * 5]
    const zs = [cz + sz * 4, cz + sz * 5]
    const fx0 = Math.min(...xs)
    const fz0 = Math.min(...zs)
    let ok = true
    let lo = Infinity
    let hi = -Infinity
    for (let x = fx0; x <= fx0 + 2 && ok; x++) {
      for (let z = fz0; z <= fz0 + 1; z++) {
        const g = H(x, z).h
        if (isTaken(x, z) || g <= sea) { ok = false; break }
        lo = Math.min(lo, g)
        hi = Math.max(hi, g)
      }
    }
    if (!ok || hi - lo > 1) continue
    const colors = CANOPIES[Math.floor(rand() * CANOPIES.length)]
    for (let x = fx0; x <= fx0 + 2; x++) {
      for (let z = fz0; z <= fz0 + 1; z++) {
        take(x, z)
        const post = (x === fx0 || x === fx0 + 2)
        if (post) for (let y = H(x, z).h + 1; y <= hi + 2; y++) b.set(x, y, z, st.fence)
        else if (z === (sz > 0 ? fz0 : fz0 + 1)) b.set(x, H(x, z).h + 1, z, GOODS[Math.floor(rand() * GOODS.length)])
        b.set(x, hi + 3, z, colors[(x - fx0) % 2])
      }
    }
  }

  // Houses along the streets, on alternating sides, and one big hall.
  let hallDone = false
  for (const arm of arms) {
    let side = rand() < 0.5 ? 1 : -1
    for (let t = 5; t < arm.pts.length - 3; t += 7 + Math.floor(rand() * 3)) {
      side = -side
      const big = !hallDone && t >= 8 && rand() < 0.35
      const w = big ? 7 : 5 + Math.floor(rand() * 3) // along the street
      const d = big ? 11 : 5 + Math.floor(rand() * 3) // away from it
      const [px, pz] = arm.pts[t]
      // Perpendicular to the street, `side` way.
      const nx = arm.dz !== 0 ? side : 0
      const nz = arm.dx !== 0 ? side : 0
      const off = 3 // just past the street's edge
      let x0, x1, z0, z1
      if (arm.dx !== 0) {
        x0 = px - Math.floor(w / 2)
        x1 = x0 + w - 1
        z0 = nz > 0 ? pz + off : pz - off - d + 1
        z1 = z0 + d - 1
      } else {
        z0 = pz - Math.floor(w / 2)
        z1 = z0 + w - 1
        x0 = nx > 0 ? px + off : px - off - d + 1
        x1 = x0 + d - 1
      }
      // Off the street, and a cell clear of every other house and field.
      let free = true
      for (let x = x0 - 1; x <= x1 + 1 && free; x++) {
        for (let z = z0 - 1; z <= z1 + 1; z++) {
          const onFoot = x >= x0 && x <= x1 && z >= z0 && z <= z1
          if (houses.has(`${x},${z}`) || (onFoot && isTaken(x, z))) { free = false; break }
        }
      }
      if (!free) continue
      const s = siteOf(H, sea, x0, z0, x1, z1)
      if (!s.dry || s.hi - s.lo > 3) continue
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        for (let z = z0 - 1; z <= z1 + 1; z++) {
          take(x, z)
          houses.add(`${x},${z}`)
        }
      }
      // The door faces the street.
      house(b, H, st, rand, { x0, x1, z0, z1 }, [-nx, -nz], s.hi + 1, big)
      if (big) hallDone = true
    }
  }

  // A field or two at street ends, on flat ground: rows of crops with a
  // water channel down the middle, inside a low log border.
  let fields = 0
  for (const arm of arms) {
    if (fields >= 2 || rand() < 0.35) continue
    const [ex, ez] = arm.pts[arm.pts.length - 1]
    const side = rand() < 0.5 ? 1 : -1
    const fx0 = arm.dx !== 0 ? ex - 4 : ex + (side > 0 ? 3 : -11)
    const fz0 = arm.dz !== 0 ? ez - 4 : ez + (side > 0 ? 3 : -11)
    const fw = 9
    let flat = true
    const fy = H(fx0, fz0).h
    for (let x = fx0; x < fx0 + fw && flat; x++) for (let z = fz0; z < fz0 + 9; z++) if (H(x, z).h !== fy || isTaken(x, z)) { flat = false; break }
    if (!flat || fy <= sea) continue
    fields++
    const crop = ['haybale', 'haybale', 'pumpkin', 'melon'][Math.floor(rand() * 4)]
    for (let x = fx0; x < fx0 + fw; x++) {
      for (let z = fz0; z < fz0 + 9; z++) {
        take(x, z)
        const edge = x === fx0 || x === fx0 + fw - 1 || z === fz0 || z === fz0 + 8
        if (edge) {
          b.set(x, fy + 1, z, st.fence)
          continue
        }
        const mid = arm.dx !== 0 ? z === fz0 + 4 : x === fx0 + 4
        if (mid) {
          // Sealed: ground under it and crops' soil both sides.
          b.set(x, fy, z, 'water')
          continue
        }
        b.set(x, fy, z, 'podzol')
        if (rand() < 0.45) b.set(x, fy + 1, z, crop)
      }
    }
  }

  // Lamp posts along the streets.
  for (const arm of arms) {
    for (let t = 4; t < arm.pts.length; t += 6) {
      const [px, pz] = arm.pts[t]
      const lx = px + (arm.dz !== 0 ? 2 : 0)
      const lz = pz + (arm.dx !== 0 ? 2 : 0)
      if (isTaken(lx, lz) && !b.paths.has(`${lx},${lz}`)) continue
      const g = H(lx, lz).h
      if (g <= sea) continue
      b.fill(lx, g + 1, lz, lx, g + 4, lz, st.fence)
      b.set(lx, g + 5, lz, st.trim)
      b.set(lx, g + 4, lz, st.lamp)
      b.paths.delete(`${lx},${lz}`)
    }
  }
  return b
}

// One house: a stone base course, walls (timber frame, plaster, planks or
// stone, per house) with log corners and a beam along the top, windows with
// shutters or flowering bushes under them, log door posts and a lantern
// over the open doorway, steps down to the street, a flat roof that
// overhangs the walls with a darker trim edge (and sometimes a chimney),
// a rug, a bed, furniture and a ceiling light inside, and bushes at the
// corners outside.
function house(b, H, st, rand, { x0, x1, z0, z1 }, [dx, dz], floorY, big) {
  const wallH = big ? 7 : 3 + Math.floor(rand() * 2)
  const top = floorY + wallH + 1
  const wallType = st.walls[Math.floor(rand() * st.walls.length)]
  const roofType = st.roofs[Math.floor(rand() * st.roofs.length)]
  const shutters = rand() < 0.5
  const midX = Math.floor((x0 + x1) / 2)
  const midZ = Math.floor((z0 + z1) / 2)
  const doorX = dx > 0 ? x1 : dx < 0 ? x0 : midX
  const doorZ = dz > 0 ? z1 : dz < 0 ? z0 : midZ
  const windows = []
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      foundation(b, H, x, z, floorY, st.base)
      b.set(x, floorY, z, st.floor)
      const wall = x === x0 || x === x1 || z === z0 || z === z1
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1)
      if (!wall) continue
      // Next to a corner the window would touch the corner post.
      const nearCorner = (x <= x0 + 1 || x >= x1 - 1) && (z <= z0 + 1 || z >= z1 - 1)
      for (let y = floorY + 1; y < top; y++) {
        const level = y - floorY
        let type = corner ? st.frame : level === 1 ? st.base : level === wallH && st.timber ? st.frame : wallType
        const windowRow = level === 2 || (big && level === 5)
        if (!corner && !nearCorner && windowRow && (x + z) % 2 === 0) {
          type = 'glass'
          if (level === 2) windows.push([x, z])
        }
        b.set(x, y, z, type)
      }
    }
  }
  // The roof: one block past the walls all round, trim on its edge.
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      const edge = x === x0 - 1 || x === x1 + 1 || z === z0 - 1 || z === z1 + 1
      b.set(x, top, z, edge ? st.trim : roofType)
    }
  }
  // Shutters beside the windows, or flowering bushes under them.
  const outward = (x, z) => [x === x0 ? -1 : x === x1 ? 1 : 0, z === z0 ? -1 : z === z1 ? 1 : 0]
  for (const [wx, wz] of windows) {
    if (Math.abs(wx - doorX) + Math.abs(wz - doorZ) <= 1) continue
    const [ox, oz] = outward(wx, wz)
    if (shutters) {
      const ax = oz !== 0 ? 1 : 0
      const az = ox !== 0 ? 1 : 0
      for (const sgn of [-1, 1]) b.set(wx + ox + ax * sgn, floorY + 2, wz + oz + az * sgn, st.shutter)
    } else if (rand() < 0.8) {
      const g = H(wx + ox, wz + oz).h
      if (g >= floorY - 1) b.set(wx + ox, Math.max(g + 1, floorY), wz + oz, 'azalealeaves')
    }
  }
  // The doorway: middle of the side facing the street, with log posts
  // either side and a lantern above it.
  b.clear(doorX, floorY + 1, doorZ)
  b.clear(doorX, floorY + 2, doorZ)
  if (big) b.clear(doorX, floorY + 3, doorZ)
  const ax = dz !== 0 ? 1 : 0
  const az = dx !== 0 ? 1 : 0
  for (const sgn of [-1, 1]) for (let y = floorY + 1; y <= floorY + 2; y++) b.set(doorX + ax * sgn, y, doorZ + az * sgn, st.frame)
  b.set(doorX, floorY + (big ? 4 : 3), doorZ, st.lamp)
  stepsDown(b, H, doorX, doorZ, dx, dz, floorY, 0, st.base)
  // Something left by the door outside.
  if (rand() < 0.6) {
    const sx = doorX + dx + ax * 2
    const sz = doorZ + dz + az * 2
    const g = H(sx, sz).h
    if (g <= floorY && g >= floorY - 2) b.set(sx, g + 1, sz, ['barrel', 'haybale', 'crate'][Math.floor(rand() * 3)])
  }
  // Inside: a rug in the middle, furniture along the back wall, a light.
  const inX = (x) => Math.max(x0 + 1, Math.min(x1 - 1, x))
  const inZ = (z) => Math.max(z0 + 1, Math.min(z1 - 1, z))
  for (let x = midX - 1; x <= midX; x++) for (let z = midZ - 1; z <= midZ; z++) if (x > x0 && x < x1 && z > z0 && z < z1) b.set(x, floorY, z, st.rug)
  const backX = dx > 0 ? x0 + 1 : dx < 0 ? x1 - 1 : null
  const backZ = dz > 0 ? z0 + 1 : dz < 0 ? z1 - 1 : null
  const props = big ? ['bookshelf', 'bookshelf', 'bookshelf', 'craftingtable', 'barrel'] : ['craftingtable', 'furnace', 'barrel', 'bookshelf', 'haybale', 'crate']
  for (let i = 0; i < (big ? 5 : 3); i++) {
    const t = props[Math.floor(rand() * props.length)]
    const px = backX !== null ? backX : inX(x0 + 1 + Math.floor(rand() * (x1 - x0 - 1)))
    const pz = backZ !== null ? backZ : inZ(z0 + 1 + Math.floor(rand() * (z1 - z0 - 1)))
    b.set(px, floorY + 1, pz, t)
  }
  // A bed: two wool blocks along a side wall.
  if (!big && rand() < 0.8) {
    const color = ['redwool', 'bluewool', 'greenwool', 'yellowwool'][Math.floor(rand() * 4)]
    const sx = dx !== 0 ? inX(midX) : x0 + 1
    const sz = dz !== 0 ? inZ(midZ) : z0 + 1
    if (sx !== doorX || sz !== doorZ) {
      b.set(sx, floorY + 1, sz, color)
      b.set(sx + (dz !== 0 ? 1 : 0), floorY + 1, sz + (dx !== 0 ? 1 : 0), 'whitewool')
    }
  }
  b.set(midX, top - 1, midZ, st.lamp)
  if (rand() < 0.6) {
    const chx = backX !== null ? backX : x0 + 1
    const chz = backZ !== null ? backZ : z0 + 1
    b.fill(chx, top + 1, chz, chx, top + 3, chz, rand() < 0.5 ? 'cobblestone' : 'brick')
  }
  // Bushes at the outside corners.
  for (const [kx, kz] of [[x0 - 1, z0 - 1], [x1 + 1, z0 - 1], [x0 - 1, z1 + 1], [x1 + 1, z1 + 1]]) {
    if (rand() > 0.45) continue
    const g = H(kx, kz).h
    if (g >= floorY - 2 && g <= floorY) b.set(kx, g + 1, kz, rand() < 0.5 ? 'azalealeaves' : 'leaves')
  }
  // The big hall gets a bell tower over its doorway.
  if (big) {
    // Centred one cell in from the doorway, on the roof.
    const tx = doorX - dx * 2
    const tz = doorZ - dz * 2
    for (let x = tx - 1; x <= tx + 1; x++) {
      for (let z = tz - 1; z <= tz + 1; z++) {
        const ring = x !== tx || z !== tz
        for (let y = top + 1; y <= top + 6; y++) {
          // Open arches high up, so the bell shows.
          if (ring && (y < top + 4 || (x !== tx && z !== tz))) b.set(x, y, z, st.frame)
        }
        b.set(x, top + 7, z, roofType)
      }
    }
    b.set(tx, top + 8, tz, st.trim)
    b.set(tx, top + 5, tz, 'gold')
  }
}

// --- castle ---

function castle({ H, rand, sea, cx, cz }) {
  const R = 13 // the curtain wall's half size
  const T = 3 // the corner towers' half size
  const REACH = R + T + 1
  const site = siteOf(H, sea, cx - REACH, cz - REACH, cx + REACH, cz + REACH, 2)
  if (!site.dry || site.hi - site.lo > 10) return null
  const b = new Builder('castle', cx, cz)
  const stone = (x, y, z) => {
    let r = (Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791, 0x9e3779b1) >>> 0) / 4294967296
    for (const [p, t] of CASTLE_STONE) {
      if (r < p) return t
      r -= p
    }
    return 'stonebricks'
  }
  const base = site.hi + 1 // the courtyard's floor block
  const wallTop = base + 7
  const towerTop = base + 12
  const gate = Math.floor(rand() * 4) // 0 +x, 1 -x, 2 +z, 3 -z
  const [gx, gz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][gate]
  // A solid stone platform under the whole castle.
  for (let x = cx - REACH + 1; x <= cx + REACH - 1; x++) {
    for (let z = cz - REACH + 1; z <= cz + REACH - 1; z++) {
      const inTower = Math.abs(Math.abs(x - cx) - R) <= T && Math.abs(Math.abs(z - cz) - R) <= T
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > R && !inTower) continue
      for (let y = H(x, z).h + 1; y < base; y++) b.set(x, y, z, y === base - 1 ? stone(x, y, z) : earthAt(x, y, z, base - 1))
      const r = (Math.imul(x * 31 + z * 17, 0x9e3779b1) >>> 0) / 4294967296
      b.set(x, base, z, r < 0.5 ? 'cobblestone' : r < 0.75 ? 'gravel' : 'coarsedirt')
    }
  }
  const towerAt = (x, z) => Math.abs(Math.abs(x - cx) - R) <= T && Math.abs(Math.abs(z - cz) - R) <= T
  // The curtain wall: two thick, crenellated on the outer edge.
  for (let x = cx - R; x <= cx + R; x++) {
    for (let z = cz - R; z <= cz + R; z++) {
      const ring = Math.max(Math.abs(x - cx), Math.abs(z - cz))
      if (ring < R - 1 || towerAt(x, z)) continue
      // A rougher, darker base course under the dressed stone.
      for (let y = base + 1; y <= wallTop; y++) b.set(x, y, z, y <= base + 2 ? ((x * 7 + y + z * 3) % 3 ? 'cobblestone' : 'mossycobblestone') : stone(x, y, z))
      if (ring === R && (x + z) % 2 === 0) b.set(x, wallTop + 1, z, stone(x, wallTop + 1, z))
    }
  }
  // Each side's position along the wall, and where the gate is.
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [nx, nz] of sides) {
    const gateSide = nx === gx && nz === gz
    for (let a = -R + T + 2; a <= R - T - 2; a++) {
      const ox = nx !== 0 ? cx + nx * R : cx + a
      const oz = nz !== 0 ? cz + nz * R : cz + a
      // Arrow slits: narrow gaps in the outer layer of the wall.
      if ((a + 100) % 4 === 2 && !(gateSide && Math.abs(a) <= 4)) {
        b.clear(ox, base + 4, oz)
        b.clear(ox, base + 5, oz)
      }
      // Buttresses: a column of stone leaning on the wall every 5 cells.
      if ((a + 100) % 5 === 0 && !(gateSide && Math.abs(a) <= 5)) {
        const bx = ox + nx
        const bz = oz + nz
        for (let y = H(bx, bz).h + 1; y <= wallTop - 2; y++) b.set(bx, y, bz, stone(bx, y, bz))
      }
    }
  }
  // Wall-walk stairs up from the courtyard: a flight of whole blocks along
  // the inside of the wall, one each side of the gate.
  for (const sgn of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const along = 3 + k
      const inner = R - 2
      const x = gx !== 0 ? cx + gx * inner : cx + sgn * along
      const z = gz !== 0 ? cz + gz * inner : cz + sgn * along
      for (let y = base + 1; y <= base + 1 + k; y++) b.set(x, y, z, stone(x, y, z))
    }
  }
  // The gate: three wide, four high, through both wall layers, framed.
  for (let w = -1; w <= 1; w++) {
    for (let d = R - 1; d <= R; d++) {
      const x = gx !== 0 ? cx + gx * d : cx + w
      const z = gz !== 0 ? cz + gz * d : cz + w
      for (let y = base + 1; y <= base + 4; y++) b.clear(x, y, z)
    }
  }
  for (const w of [-2, 2]) {
    const x = gx !== 0 ? cx + gx * R : cx + w
    const z = gz !== 0 ? cz + gz * R : cz + w
    for (let y = base + 1; y <= base + 5; y++) b.set(x, y, z, 'chiseledstonebricks')
  }
  for (let w = -1; w <= 1; w++) b.set(gx !== 0 ? cx + gx * R : cx + w, base + 5, gz !== 0 ? cz + gz * R : cz + w, 'chiseledstonebricks')
  // Banners either side of the gate.
  for (const w of [-4, 4]) {
    const x = gx !== 0 ? cx + gx * (R + 1) : cx + w
    const z = gz !== 0 ? cz + gz * (R + 1) : cz + w
    for (let y = base + 3; y <= base + 6; y++) b.set(x, y, z, 'redwool')
  }
  // Steps from the gate down to the land, and a road away from it.
  stepsDown(b, H, cx + gx * R, cz + gz * R, gx, gz, base, 2, 'cobblestone')
  for (let k = 1; k <= 14; k++) {
    for (let w = -1; w <= 1; w++) {
      const x = cx + gx * (R + k) + (gz !== 0 ? w : 0)
      const z = cz + gz * (R + k) + (gx !== 0 ? w : 0)
      if (H(x, z).h > sea) b.path(x, z, 'gravel')
    }
  }
  // Corner towers with spiral steps inside: a doorway from the courtyard
  // (on the side facing the middle, next to the corner the courtyard
  // touches) and openings onto the wall-walk from both walls.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const tx = cx + sx * R
    const tz = cz + sz * R
    const door = [sx > 0 ? tx - T : tx + T, sz > 0 ? tz - T + 1 : tz + T - 1, -sx, 0]
    const walk = [
      [sx > 0 ? tx - T : tx + T, tz - sz],
      [sx > 0 ? tx - T : tx + T, tz],
      [tx - sx, sz > 0 ? tz - T : tz + T],
      [tx, sz > 0 ? tz - T : tz + T],
    ]
    tower(b, stone, tx, tz, T, base, towerTop, door, walk.map(([i, j]) => [i, j, wallTop]))
  }
  // The keep: across the courtyard from the gate, taller, with windows,
  // banners and its own spiral up to a crenellated roof.
  const kx = cx - gx * 4
  const kz = cz - gz * 4
  tower(b, stone, kx, kz, 4, base, base + 16, [gx > 0 ? kx + 4 : gx < 0 ? kx - 4 : kx, gz > 0 ? kz + 4 : gz < 0 ? kz - 4 : kz, gx, gz], [], true)
  // Flags flying over every tower and the keep.
  const flagColor = ['redwool', 'bluewool', 'yellowwool', 'purplewool'][Math.floor(rand() * 4)]
  const flag = (x, z, top, size) => {
    const poleTop = top + 4 + size
    for (let y = top + 2; y <= poleTop; y++) b.set(x, y, z, 'sprucelog')
    for (let k = 1; k <= size + 1; k++) for (let y = poleTop - size; y <= poleTop; y++) b.set(x + k * gz, y, z + k * gx, flagColor)
  }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) flag(cx + sx * R, cz + sz * R, towerTop, 1)
  flag(kx, kz, base + 16, 2)
  // A stable along one side wall: posts, a slate roof against the wall,
  // hay and crates inside.
  const px = gz !== 0 ? 1 : 0 // across the gate's direction
  const pz = gx !== 0 ? 1 : 0
  for (let a = -2; a <= 6; a++) {
    for (let d = R - 3; d <= R - 2; d++) {
      const x = cx + gx * a + px * d
      const z = cz + gz * a + pz * d
      b.set(x, base + 4, z, 'slateshingles')
      if (d === R - 3 && (a + 2) % 4 === 0) for (let y = base + 1; y <= base + 3; y++) b.set(x, y, z, 'sprucelog')
      else if (d === R - 2 && rand() < 0.5) b.set(x, base + 1, z, rand() < 0.7 ? 'haybale' : 'crate')
    }
  }
  // A well on the other side of the courtyard.
  const wx = cx + gx * 2 - px * 7
  const wz = cz + gz * 2 - pz * 7
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      const x = wx + ox
      const z = wz + oz
      if (ox === 0 && oz === 0) {
        b.set(x, base, z, 'water')
        continue
      }
      b.set(x, base + 1, z, 'stonebricks')
      if (ox !== 0 && oz !== 0) for (let y = base + 2; y <= base + 3; y++) b.set(x, y, z, 'sprucelog')
    }
  }
  b.fill(wx - 1, base + 4, wz - 1, wx + 1, base + 4, wz + 1, 'slateshingles')
  // Inside the courtyard: hay, barrels, a training dummy.
  const yard = [[gz !== 0 ? 6 : 0, gx !== 0 ? 6 : 0], [gz !== 0 ? -6 : 0, gx !== 0 ? -6 : 0]]
  for (const [ox, oz] of yard) {
    const x = cx + gx * 6 + ox
    const z = cz + gz * 6 + oz
    b.set(x, base + 1, z, 'haybale')
    b.set(x + (gz !== 0 ? 0 : 1), base + 1, z + (gx !== 0 ? 0 : 1), 'barrel')
  }
  const dummyX = cx + gx * 5 + (gz !== 0 ? 3 : 0)
  const dummyZ = cz + gz * 5 + (gx !== 0 ? 3 : 0)
  b.set(dummyX, base + 1, dummyZ, 'haybale')
  b.set(dummyX, base + 2, dummyZ, 'haybale')
  b.set(dummyX, base + 3, dummyZ, 'jackolantern')
  return b
}

// A square tower (half size `half`) on (x, z): hollow, a spiral of
// whole-block steps around its inside up to a floor at `top`,
// crenellations, a two-high doorway in its wall at (doorX, doorZ) leading
// out toward (dx, dz), and openings [x, z, y] (two high, from y + 1) -
// a corner tower's way onto the wall-walk.
function tower(b, stone, x, z, half, base, top, [doorX, doorZ, dx, dz], openings, keep = false) {
  const x0 = x - half
  const x1 = x + half
  const z0 = z - half
  const z1 = z + half
  // The inner ring of cells, going round: steps climb one per cell.
  const ring = []
  for (let i = x0 + 1; i < x1 - 1; i++) ring.push([i, z0 + 1])
  for (let i = z0 + 1; i < z1 - 1; i++) ring.push([x1 - 1, i])
  for (let i = x1 - 1; i > x0 + 1; i--) ring.push([i, z1 - 1])
  for (let i = z1 - 1; i > z0 + 1; i--) ring.push([x0 + 1, i])
  for (let i = x0; i <= x1; i++) {
    for (let j = z0; j <= z1; j++) {
      const wall = i === x0 || i === x1 || j === z0 || j === z1
      for (let y = base + 1; y <= top; y++) {
        if (wall) b.set(i, y, j, stone(i, y, j))
        else b.clear(i, y, j)
      }
      b.set(i, base, j, keep ? 'smoothstone' : stone(i, base, j))
      if (wall && (i + j) % 2 === 0) b.set(i, top + 1, j, stone(i, top + 1, j))
    }
  }
  for (let y = base + 1; y <= base + (keep ? 3 : 2); y++) b.clear(doorX, y, doorZ)
  // Start the spiral just inside the door, going round from there.
  const startAt = ring.findIndex(([i, j]) => Math.abs(i - doorX) + Math.abs(j - doorZ) === 1)
  const start = startAt < 0 ? 0 : (startAt + 1) % ring.length
  const steps = top - base - 1
  const stepAt = new Map()
  for (let k = 0; k < steps; k++) {
    const [i, j] = ring[(start + k) % ring.length]
    const y = base + 1 + k
    b.set(i, y, j, stone(i, y, j))
    stepAt.set(`${i},${j}`, Math.max(stepAt.get(`${i},${j}`) ?? -Infinity, y))
  }
  // The top floor, open over the last few steps so you can walk up
  // through it.
  for (let i = x0 + 1; i < x1; i++) {
    for (let j = z0 + 1; j < z1; j++) {
      const s = stepAt.get(`${i},${j}`)
      if (s !== undefined && s > top - 4 && s < top) continue
      b.set(i, top, j, keep ? 'darkoakplanks' : stone(i, top, j))
    }
  }
  // Light at the bottom and at the top.
  b.set(x, base, z, 'glowstone')
  b.set(x, top + 1, z, 'glowstone')
  for (const [i, j, y] of openings) {
    b.clear(i, y + 1, j)
    b.clear(i, y + 2, j)
  }
  if (keep) {
    // Windows on every floor's sides (not over the door) and banners.
    for (let y = base + 5; y < top; y += 4) {
      for (const [i, j] of [[x0, z], [x1, z], [x, z0], [x, z1]]) {
        if (i === doorX && j === doorZ) continue
        b.set(i, y, j, 'glass')
        b.set(i, y + 1, j, 'glass')
      }
    }
    for (const [i, j] of [[doorX + (dz !== 0 ? 2 : 0) + dx, doorZ + (dx !== 0 ? 2 : 0) + dz], [doorX - (dz !== 0 ? 2 : 0) + dx, doorZ - (dx !== 0 ? 2 : 0) + dz]]) {
      for (let y = base + 4; y <= base + 8; y++) b.set(i, y, j, 'redwool')
    }
    // A red carpet in from the door, and a table at the back.
    for (let k = 1; k <= 3; k++) b.set(doorX - dx * k, base, doorZ - dz * k, 'redwool')
    b.set(x - dx * 2, base + 1, z - dz * 2, 'craftingtable')
    b.set(x - dx * 2 + (dz !== 0 ? 1 : 0), base + 1, z - dz * 2 + (dx !== 0 ? 1 : 0), 'bookshelf')
  }
}

// --- bridge ---

// Open air kept between the water (which fills up to y = sea) and the
// lowest block of a bridge.
const BRIDGE_CLEARANCE = 3

// A crossing over a river near the centre: the shortest run of water
// (4..30 wide) with dry land at both ends, along x or z.
function bridge({ H, rand, sea, cx, cz }, cityDistance) {
  let wet = false
  for (let x = cx - 32; x <= cx + 32 && !wet; x += 8) for (let z = cz - 32; z <= cz + 32; z += 8) if (H(x, z).h < sea) { wet = true; break }
  if (!wet) return null
  let best = null
  for (const alongX of [true, false]) {
    for (let off = -18; off <= 18; off += 6) {
      let runStart = null
      let lastLand = null
      for (let t = -36; t <= 36; t++) {
        const x = alongX ? cx + t : cx + off
        const z = alongX ? cz + off : cz + t
        const s = H(x, z)
        if (s.h >= sea) {
          if (runStart !== null && lastLand !== null) {
            const len = t - runStart
            if (len >= 4 && len <= 30 && (!best || len < best.len)) best = { alongX, off, a: lastLand, b: t, len }
          }
          runStart = null
          lastLand = t
        } else if (runStart === null) runStart = t
      }
    }
  }
  if (!best) return null
  const { alongX, off } = best
  const at = (t, w) => (alongX ? [cx + t, cz + off + w] : [cx + off + w, cz + t])
  for (let t = best.a - 2; t <= best.b + 2; t++) {
    for (let w = -2; w <= 2; w++) if (cityDistance(...at(t, w)) < 8) return null
  }
  const b = new Builder('bridge', ...at(Math.round((best.a + best.b) / 2), 0))
  const stoneBridge = rand() < 0.45
  // High over the water (2026-10-18, Gaymi: "the bridge should go across
  // the river, above it - a player could walk through under it"): the
  // underside, arches and all, leaves room for a player above the water.
  const deck = Math.max(sea + BRIDGE_CLEARANCE + 2, H(...at(best.a, 0)).h, H(...at(best.b, 0)).h)
  const mat = stoneBridge
    ? { deck: 'polishedandesite', edge: 'stonebricks', post: 'stonebricks', pillar: 'stonebricks', lamp: 'sealantern', cap: 'chiseledstonebricks' }
    : { deck: 'spruceplanks', edge: 'sprucelog', post: 'oaklog', pillar: 'sprucelog', lamp: 'paperlantern', cap: 'oaklog' }
  for (let t = best.a; t <= best.b; t++) {
    for (let w = -2; w <= 2; w++) {
      const [x, z] = at(t, w)
      b.set(x, deck, z, Math.abs(w) === 2 ? mat.edge : mat.deck)
      // Supports under the deck down to the ground or river bed.
      const pier = (t - best.a) % 5 === 0 || t === best.b
      if (pier && Math.abs(w) >= 1) for (let y = H(x, z).h + 1; y < deck; y++) b.set(x, y, z, mat.pillar)
      const span = (t - best.a) % 5
      // A stone bridge's arches: two blocks deep beside each pier, one
      // in the middle of the span, so each span curves.
      if (stoneBridge && !pier) {
        const depth = span === 1 || span === 4 ? 2 : 1
        for (let k = 1; k <= depth; k++) if (deck - k > H(x, z).h && deck - k > sea + BRIDGE_CLEARANCE) b.set(x, deck - k, z, mat.edge)
      }
      // A wooden bridge's braces: logs angling out from each pier.
      if (!stoneBridge && !pier && Math.abs(w) === 2 && (span === 1 || span === 4) && deck - 1 > H(x, z).h) b.set(x, deck - 1, z, mat.edge)
    }
    // Railings: a parapet with a capped top on a stone bridge; posts and a
    // log top rail on a wooden one. Lamps every few cells.
    for (const w of [-2, 2]) {
      const [x, z] = at(t, w)
      if (stoneBridge) b.set(x, deck + 1, z, (t - best.a) % 3 === 0 ? mat.cap : mat.post)
      else {
        if ((t - best.a) % 2 === 0) b.set(x, deck + 1, z, mat.post)
        b.set(x, deck + 2, z, mat.edge)
      }
      if ((t - best.a) % 6 === 3) b.set(x, deck + (stoneBridge ? 2 : 3), z, mat.lamp)
    }
  }
  // Gateposts at both ends, beside the ramps, with a lamp on each.
  for (const t of [best.a - 1, best.b + 1]) {
    for (const w of [-3, 3]) {
      const [x, z] = at(t, w)
      const g = H(x, z).h
      if (g < sea) continue
      for (let y = g + 1; y <= deck + 2; y++) b.set(x, y, z, mat.cap)
      b.set(x, deck + 3, z, mat.lamp)
    }
  }
  // Ramps of whole blocks down to the banks at both ends.
  for (const [t, dir] of [[best.a, -1], [best.b, 1]]) {
    const [x, z] = at(t, 0)
    stepsDown(b, H, x, z, alongX ? dir : 0, alongX ? 0 : dir, deck, 2, mat.deck)
  }
  return b
}
