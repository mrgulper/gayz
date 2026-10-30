// The underground (2026-10-17, Gaymi: "add layers underground up to 200
// layers underground with different layers and ores also add caves under
// ground and places where caves are on ground where you can just go in",
// like bloxd.io). Owned by OpenWorld (`world.under`).
//
// Under every cell - the city and the land around it - there is rock down
// to y = BOTTOM (bedrock), in layers: stone (with granite, diorite,
// andesite, gravel and dirt pockets), a tuff band, deepslate, a smooth
// basalt band, deeper deepslate, blackstone, then bedrock, with ores by
// depth (rockAt). Storing all of it would be millions of blocks, so the
// rock is never stored whole: below a column's ground (its "bottom") every
// cell is solid unless a cave carves it (implicit rock), and only the
// cells something can see are made into real blocks:
//  - cave walls, a 16x16x16 chunk at a time around the player (update),
//  - the walls of the cave entrances out in the land, when their column
//    grows (columnGrown), so a mouth seen from afar is never a hole,
//  - and whatever touches a block the player breaks (reveal), so digging
//    down always finds the next layer.
// Like the land above, all of it is terrain (never saved, new every game).
//
// Caves never cut into the city's buildings or the land's villages,
// castles and bridges: under the city and under a place they stay well
// below the ground (CAVE_ROOF_CITY / CAVE_ROOF_PLACE), and elsewhere keep a
// roof of CAVE_ROOF cells - the only openings to the surface are the
// entrances, sloping tunnels from the land down into the caves, placed off
// roads, water, the city and every place.
//
// Underground cities (UnderCity.js, 2026-10-17) are treated like caves:
// their open air is carved, their buildings are kept solid (caves never
// cut through them) and only the city blocks something can see become
// real blocks, in the city's own materials.
import { inCityShape, cityEdgeDistance } from './CityShape.js'
import { cityAt, citiesOver, cityYRange, setUnderCitySeed } from './UnderCity.js'

const CHUNK = 16
// The last layer: bedrock from BOTTOM + 4 down to BOTTOM (always solid).
// Was -200 until 2026-10-30, when the Demon Realm went in under it.
export const BOTTOM = -500
// The Demon Realm (2026-10-30, Gaymi: "-300 to -500 for demons ... make
// demons underground"): from DEMON_TOP down to bedrock the rock turns to
// netherrack, soul sand and blackstone, and huge caverns open up - red
// fungus floors, glowing magma and glowstone, demons in the dark
// (ZombieKinds.js). Reached by digging down (no portals).
export const DEMON_TOP = -300
const DEMON_FLOOR = BOTTOM + 10
// The caverns: where this noise is above DEMON_OPEN (half-ish of the rock).
const DEMON_OPEN = 0.02
// While you're down there more is grown round you (the caverns are big).
const DEMON_RADIUS = 3
const DEMON_BUDGET_MS = 4
// Cells of solid rock kept over a cave.
const CAVE_ROOF = 4
const CAVE_ROOF_PLACE = 14
// Under the city, caves only start this deep.
const CITY_CAVE_TOP = -16
// Caves stop this far above the bottom (bedrock stays whole).
const CAVE_FLOOR = BOTTOM + 7
// Cave noise is worked out on a lattice this many cells apart and blended
// between (cheap, and the same in every chunk).
const LATTICE = 4
// Tunnels: where two noises are both near zero. Rooms: where a third is high.
const TUNNEL_WIDTH = 0.012
const ROOM_LEVEL = 0.6
const ROOM_BELOW = -24
// Entrances: at most one per ENTRANCE_GRID square.
const ENTRANCE_GRID = 64
const ENTRANCE_CHANCE = 0.65
const ENTRANCE_LEN = 46
const ENTRANCE_DROP = 0.55 // cells down per cell along
const ENTRANCE_R = 2.4
const ENTRANCE_ROOM_R = 4.6
// Every entrance leads on into a big cave (2026-10-25, Gaymi: "the holes
// have a dead end ... we want holes to connect to a bigger cave"): from
// the room at its end a second tunnel goes down to the nearest cave room
// (or long tunnel) the cave noise has, searched for within LINK_REACH
// cells; with none near, a big hall is dug at the end instead.
const LINK_REACH = 40
const LINK_DEEPER = 36
const LINK_R = 2.2
const HALL_R = 9
// Cave chunks are grown this many chunks around you (and kept a bit past).
const UNDER_RADIUS = 2
const UNDER_BELOW = 2
const UNDER_ABOVE = 1
const UNDER_BUDGET_MS = 2
// Near an underground city (within CITY_NEAR cells) more is grown.
const CITY_NEAR = 40
const CITY_RADIUS = 4
const CITY_ABOVE = 3
const CITY_BUDGET_MS = 4

// --- numbers ---

let SALT = 0
export function setUnderSeed(seed) {
  SALT = seed | 0
  setUnderCitySeed(seed)
}

// Cities reaching into a box, and the block (or rock) at one cell.
function citiesNear(x0, y0, z0, x1, y1, z1) {
  return citiesOver(x0, z0, x1, z1).filter((c) => {
    const [lo, hi] = cityYRange(c)
    return hi >= y0 && lo <= y1
  })
}
function solidAt(x, y, z) {
  const v = cityAt(citiesNear(x, y, z, x, y, z), x, y, z)
  return typeof v === 'string' ? v : rockAt(x, y, z)
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x2f6b8e45) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul((seed + SALT) | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Smooth 3D value noise, -1..1.
function noise3(x, y, z, seed) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  let fx = x - ix
  let fy = y - iy
  let fz = z - iz
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  fz = fz * fz * (3 - 2 * fz)
  const c000 = hash3(ix, iy, iz, seed)
  const c100 = hash3(ix + 1, iy, iz, seed)
  const c010 = hash3(ix, iy + 1, iz, seed)
  const c110 = hash3(ix + 1, iy + 1, iz, seed)
  const c001 = hash3(ix, iy, iz + 1, seed)
  const c101 = hash3(ix + 1, iy, iz + 1, seed)
  const c011 = hash3(ix, iy + 1, iz + 1, seed)
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed)
  const x00 = c000 + (c100 - c000) * fx
  const x10 = c010 + (c110 - c010) * fx
  const x01 = c001 + (c101 - c001) * fx
  const x11 = c011 + (c111 - c011) * fx
  const y0 = x00 + (x10 - x00) * fy
  const y1 = x01 + (x11 - x01) * fy
  return (y0 + (y1 - y0) * fz) * 2 - 1
}

// --- the rock ---

// Pockets of other rock in each layer: [noise seed, block, how rare].
const STONE_POCKETS = [[31, 'granite', 0.55], [37, 'diorite', 0.58], [41, 'andesite', 0.55], [43, 'gravel', 0.7], [47, 'dirt', 0.72]]
const DEEP_POCKETS = [[53, 'tuff', 0.56], [59, 'cobbleddeepslate', 0.66]]
const DEEPER_POCKETS = [[61, 'tuff', 0.6], [67, 'calcite', 0.72], [71, 'smoothbasalt', 0.64]]
const BLACK_POCKETS = [[73, 'basalt', 0.58], [79, 'magmablock', 0.74]]
const DEMON_POCKETS = [[83, 'soulsand', 0.5], [89, 'blackstone', 0.55], [97, 'magmablock', 0.7], [101, 'netherbrick', 0.82]]
// Ores, rarest first: [block, deepslate block, top y, bottom y, chance per
// 2x2x2 group of cells].
const ORES = [
  ['diamondore', 'deepslatediamondore', -150, -195, 0.006],
  ['emeraldore', 'deepslateemeraldore', -20, -100, 0.002],
  ['redstoneore', 'deepslateredstoneore', -120, -195, 0.012],
  ['goldore', 'deepslategoldore', -60, -180, 0.008],
  ['lapisore', 'deepslatelapisore', -60, -140, 0.007],
  ['ironore', 'deepslateironore', -8, -130, 0.014],
  ['copperore', 'deepslatecopperore', -8, -70, 0.012],
  ['coalore', 'deepslatecoalore', -3, -60, 0.018],
]
const SOFT_ROCK = new Set(['stone', 'granite', 'diorite', 'andesite'])

function pocket(x, y, z, list) {
  for (const [seed, type, level] of list) {
    if (noise3(x / 9, y / 7, z / 9, seed) > level) return type
  }
  return null
}

// The rock (or ore) at a cell below the ground. Pure.
export function rockAt(x, y, z) {
  if (y <= BOTTOM + 4 && (y <= BOTTOM || hash3(x, y, z, 3) < (BOTTOM + 5 - y) / 5)) return 'bedrock'
  // Layer borders wave up and down a few cells, never dead flat.
  const yy = y + noise3(x / 23, 0.5, z / 23, 5) * 3
  let base
  if (yy > -40) base = pocket(x, y, z, y > -24 ? STONE_POCKETS : STONE_POCKETS.slice(0, 4)) || 'stone'
  else if (yy > -48) base = 'tuff'
  else if (yy > -108) base = pocket(x, y, z, DEEP_POCKETS) || 'deepslate'
  else if (yy > -116) base = 'smoothbasalt'
  else if (yy > -172) base = pocket(x, y, z, DEEPER_POCKETS) || 'deepslate'
  else if (yy > DEMON_TOP + 8) base = pocket(x, y, z, BLACK_POCKETS) || 'blackstone'
  else return pocket(x, y, z, DEMON_POCKETS) || 'netherrack'
  if (base === 'gravel' || base === 'dirt' || base === 'magmablock') return base
  for (let i = 0; i < ORES.length; i++) {
    const [ore, deep, top, low, chance] = ORES[i]
    if (y > top || y < low) continue
    if (hash3(x >> 1, y >> 1, z >> 1, 100 + i) < chance && hash3(x, y, z, 120 + i) < 0.62) return SOFT_ROCK.has(base) ? ore : deep
  }
  return base
}

// --- the Demon Realm's caverns ---

// Is the Demon Realm's cavern noise open here? Closing up near its top and
// its floor, so a solid roof and floor stay.
export function demonOpen(x, y, z) {
  if (y > DEMON_TOP - 4 || y < DEMON_FLOOR) return false
  const v = noise3(x / 46, y / 20, z / 46, 501) * 0.72 + noise3(x / 15, y / 9, z / 15, 502) * 0.28
  const edge = Math.max(0, (y - (DEMON_TOP - 20)) / 16, (DEMON_FLOOR + 14 - y) / 14)
  return v > DEMON_OPEN + edge * 0.6
}

// A demon cavern's floor or roof block (the cell above or below is open).
function demonSurface(x, y, z, openAbove, openBelow) {
  const r = hash3(x, y, z, 503)
  if (openAbove) return r < 0.55 ? 'crimsonnylium' : r < 0.8 ? 'soulsand' : r < 0.86 ? 'magmablock' : 'netherrack'
  if (openBelow) return r < 0.04 ? 'glowstone' : r < 0.06 ? 'shroomlight' : null
  return null
}

// --- caves ---

// The three cave noises at one lattice point (cells LATTICE apart).
function latticeAt(ix, iy, iz, out, o) {
  const x = ix * LATTICE
  const y = iy * LATTICE
  const z = iz * LATTICE
  out[o] = noise3(x / 38, y / 19, z / 38, 201) * 0.78 + noise3(x / 13, y / 8, z / 13, 202) * 0.22
  out[o + 1] = noise3(x / 38, y / 19, z / 38, 203) * 0.78 + noise3(x / 13, y / 8, z / 13, 204) * 0.22
  out[o + 2] = noise3(x / 52, y / 26, z / 52, 205)
}

// Is the cave noise open here (no roof or entrance rules)? From the 8
// lattice points around it - the same answer chunk gen gets.
const CORNERS = new Float64Array(24)
function noiseOpen(x, y, z) {
  const ix = Math.floor(x / LATTICE)
  const iy = Math.floor(y / LATTICE)
  const iz = Math.floor(z / LATTICE)
  for (let i = 0; i < 8; i++) latticeAt(ix + (i & 1), iy + ((i >> 1) & 1), iz + (i >> 2), CORNERS, i * 3)
  const fx = (x - ix * LATTICE) / LATTICE
  const fy = (y - iy * LATTICE) / LATTICE
  const fz = (z - iz * LATTICE) / LATTICE
  const v = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const x00 = CORNERS[k] + (CORNERS[3 + k] - CORNERS[k]) * fx
    const x10 = CORNERS[6 + k] + (CORNERS[9 + k] - CORNERS[6 + k]) * fx
    const x01 = CORNERS[12 + k] + (CORNERS[15 + k] - CORNERS[12 + k]) * fx
    const x11 = CORNERS[18 + k] + (CORNERS[21 + k] - CORNERS[18 + k]) * fx
    const y0 = x00 + (x10 - x00) * fy
    const y1 = x01 + (x11 - x01) * fy
    v[k] = y0 + (y1 - y0) * fz
  }
  return v[0] * v[0] + v[1] * v[1] < TUNNEL_WIDTH || (y < ROOM_BELOW && v[2] > ROOM_LEVEL)
}

// The nearest big open spot in the cave noise below and around an
// entrance's end (heading: the entrance's own direction, searched first):
// a cave room, or a tunnel with open cells all round. null if none.
function findCaveNear(end, heading) {
  let best = null
  let bestD = Infinity
  for (let dy = 4; dy <= LINK_DEEPER; dy += 4) {
    const y = Math.round(end.y - dy)
    if (y <= CAVE_FLOOR + 3) break
    for (let r = 4; r <= LINK_REACH; r += 6) {
      const steps = Math.max(6, Math.round(r / 2))
      for (let i = 0; i < steps; i++) {
        const a = heading + (i / steps) * Math.PI * 2
        const x = Math.round(end.x + Math.cos(a) * r)
        const z = Math.round(end.z + Math.sin(a) * r)
        const d = r + dy * 0.7
        if (d >= bestD) continue
        if (!noiseOpen(x, y, z)) continue
        // Big enough: open a few cells away on most sides too.
        let open = 0
        for (const [ox, oy, oz] of [[3, 0, 0], [-3, 0, 0], [0, 0, 3], [0, 0, -3], [0, -2, 0], [0, 2, 0]]) if (noiseOpen(x + ox, y + oy, z + oz)) open++
        if (open < 3) continue
        best = { x: x + 0.5, y: y + 0.5, z: z + 0.5 }
        bestD = d
      }
    }
    if (best) break
  }
  return best
}

export class Underground {
  // (For tests and tools: the layers' numbers and rock.)
  static BOTTOM = BOTTOM
  static DEMON_TOP = DEMON_TOP
  static rockAt = rockAt
  static demonOpen = demonOpen

  constructor(world) {
    this.world = world
    this.chunks = new Map() // "cx,cy,cz" -> { keys: [], keep: bool }
    this._entrances = new Map() // "gx,gz" -> entrance or null
  }

  get bm() {
    return this.world.bm
  }

  // A new world (seed) or none: everything grown goes.
  dropAll() {
    for (const key of [...this.chunks.keys()]) this._dropChunk(key)
    this._entrances.clear()
  }

  // --- where the ground ends ---

  // y of the lowest stored cell of the ground at (x, z): rock is implicit
  // below it. The city's ground is y = -1.
  bottomAt(x, z) {
    if (inCityShape(x, z)) return -1
    const cx = Math.floor(x / CHUNK)
    const cz = Math.floor(z / CHUNK)
    const col = this.world.columns.get(`${cx},${cz}`)
    if (col?.bottoms) return col.bottoms[(x - cx * CHUNK) * CHUNK + (z - cz * CHUNK)]
    return this.world.bottomOf(x, z)
  }

  // 16x16 bottoms for a chunk column, or null while its land hasn't grown.
  _bottoms(cx, cz) {
    if (this.world._isCityColumn(cx, cz)) {
      if (!this._cityBottoms) this._cityBottoms = new Int16Array(CHUNK * CHUNK).fill(-1)
      return this._cityBottoms
    }
    return this.world.columns.get(`${cx},${cz}`)?.bottoms || null
  }

  // Lowest y a cave may reach up to (exclusive) at a cell.
  _caveTop(x, z, bottom, places) {
    if (inCityShape(x, z)) return CITY_CAVE_TOP
    for (const p of places) {
      if (x >= p.x0 - 3 && x <= p.x1 + 3 && z >= p.z0 - 3 && z <= p.z1 + 3) return bottom - CAVE_ROOF_PLACE
    }
    return bottom - CAVE_ROOF
  }

  // --- entrances ---

  _entrance(gx, gz) {
    const key = `${gx},${gz}`
    if (this._entrances.has(key)) return this._entrances.get(key)
    let e = null
    try {
      e = this._planEntrance(gx, gz)
    } finally {
      this._entrances.set(key, e)
    }
    return e
  }

  _planEntrance(gx, gz) {
    const world = this.world
    if (hash3(gx, 7, gz, 301) > ENTRANCE_CHANCE) return null
    const ex = gx * ENTRANCE_GRID + 10 + Math.floor(hash3(gx, 1, gz, 302) * (ENTRANCE_GRID - 20))
    const ez = gz * ENTRANCE_GRID + 10 + Math.floor(hash3(gx, 2, gz, 303) * (ENTRANCE_GRID - 20))
    const a = hash3(gx, 3, gz, 304) * Math.PI * 2
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const land = world.landAt(ex, ez)
    if (!land || land.h < land.w + 1) return null
    const sx = ex
    const sy = land.h + 1
    const sz = ez
    const L = ENTRANCE_LEN
    const end = { x: sx + dx * L, y: sy - ENTRANCE_DROP * L, z: sz + dz * L }
    if (end.y < CAVE_FLOOR + ENTRANCE_ROOM_R) return null
    // Along the way: no city, no water over it, no road at the mouth.
    for (let s = 0; s <= L; s += 4) {
      const x = Math.round(sx + dx * s)
      const z = Math.round(sz + dz * s)
      if (cityEdgeDistance(x, z) < 10) return null
      const at = world.landAt(x, z)
      if (!at) return null
      const y = sy - ENTRANCE_DROP * s
      if (at.h < at.w + 1 && y + ENTRANCE_R + 3 > at.h - 2) return null
    }
    for (let s = 0; s <= 10; s++) if (world._nearPath(Math.round(sx + dx * s), Math.round(sz + dz * s))) return null
    const link = findCaveNear(end, a)
    // No cave near: a big hall at the end, low and wide.
    const hall = link ? null : { x: end.x + dx * HALL_R * 0.6, y: end.y - 3, z: end.z + dz * HALL_R * 0.6 }
    const far = link || hall
    const R = Math.max(ENTRANCE_ROOM_R, hall ? HALL_R : LINK_R) + 1
    const x0 = Math.floor(Math.min(sx, end.x, far.x) - R)
    const x1 = Math.ceil(Math.max(sx, end.x, far.x) + R)
    const z0 = Math.floor(Math.min(sz, end.z, far.z) - R)
    const z1 = Math.ceil(Math.max(sz, end.z, far.z) + R)
    // Never under, through or beside a village, castle or bridge.
    if (world._plansOver(x0, z0, x1, z1, 6).length) return null
    // The link tunnel or hall never comes up under the city.
    if (cityEdgeDistance(Math.round(far.x), Math.round(far.z)) < 6 && far.y > CITY_CAVE_TOP - HALL_R) return null
    return {
      sx, sy, sz, dx: dx * L, dy: end.y - sy, dz: dz * L, end,
      link: link && { lx: link.x - end.x, ly: link.y - end.y, lz: link.z - end.z }, hall,
      x0, x1, z0, z1, y0: Math.floor(Math.min(end.y, far.y) - R), y1: Math.ceil(sy + ENTRANCE_R + 1),
    }
  }

  // Entrances whose box reaches into this x/z box.
  _entrancesOver(x0, z0, x1, z1) {
    const out = []
    const gx0 = Math.floor((x0 - ENTRANCE_LEN - LINK_REACH - HALL_R - 8) / ENTRANCE_GRID)
    const gx1 = Math.floor((x1 + ENTRANCE_LEN + LINK_REACH + HALL_R + 8) / ENTRANCE_GRID)
    const gz0 = Math.floor((z0 - ENTRANCE_LEN - LINK_REACH - HALL_R - 8) / ENTRANCE_GRID)
    const gz1 = Math.floor((z1 + ENTRANCE_LEN + LINK_REACH + HALL_R + 8) / ENTRANCE_GRID)
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const e = this._entrance(gx, gz)
        if (e && e.x1 >= x0 && e.x0 <= x1 && e.z1 >= z0 && e.z0 <= z1) out.push(e)
      }
    }
    return out
  }

  // Inside an entrance's tunnel or the room at its end?
  _inEntrance(e, x, y, z) {
    if (x < e.x0 || x > e.x1 || z < e.z0 || z > e.z1 || y < e.y0 || y > e.y1) return false
    const px = x + 0.5 - e.sx
    const py = y + 0.5 - e.sy
    const pz = z + 0.5 - e.sz
    const len2 = e.dx * e.dx + e.dy * e.dy + e.dz * e.dz
    const k = Math.max(0, Math.min(1, (px * e.dx + py * e.dy + pz * e.dz) / len2))
    const qx = px - e.dx * k
    const qy = (py - e.dy * k) * 1.15
    const qz = pz - e.dz * k
    if (qx * qx + qy * qy + qz * qz < ENTRANCE_R * ENTRANCE_R) return true
    const rx = x + 0.5 - e.end.x
    const ry = (y + 0.5 - e.end.y) * 1.4
    const rz = z + 0.5 - e.end.z
    if (rx * rx + ry * ry + rz * rz < ENTRANCE_ROOM_R * ENTRANCE_ROOM_R) return true
    if (e.link) {
      const l = e.link
      const k2 = Math.max(0, Math.min(1, (rx * l.lx + (y + 0.5 - e.end.y) * l.ly + rz * l.lz) / (l.lx * l.lx + l.ly * l.ly + l.lz * l.lz)))
      const ax = rx - l.lx * k2
      const ay = (y + 0.5 - e.end.y - l.ly * k2) * 1.15
      const az = rz - l.lz * k2
      return ax * ax + ay * ay + az * az < LINK_R * LINK_R
    }
    if (e.hall) {
      const hx = x + 0.5 - e.hall.x
      const hy = (y + 0.5 - e.hall.y) * 2
      const hz = z + 0.5 - e.hall.z
      return hx * hx + hy * hy + hz * hz < HALL_R * HALL_R
    }
    return false
  }

  // For the land's own cells as a column grows: is this cell an entrance's
  // open air? `list` from entrancesForColumn.
  entranceAir(list, x, y, z) {
    for (const e of list) if (this._inEntrance(e, x, y, z)) return true
    return false
  }

  // A tree or rock at (x, z) would stand in an entrance's mouth?
  nearEntrance(x, z) {
    const pad = ENTRANCE_R + 5
    for (const e of this._entrancesOver(x - pad, z - pad, x + pad, z + pad)) {
      // Distance from the tunnel's line, on the map.
      const px = x + 0.5 - e.sx
      const pz = z + 0.5 - e.sz
      const len2 = e.dx * e.dx + e.dz * e.dz
      const k = Math.max(0, Math.min(1, (px * e.dx + pz * e.dz) / len2))
      if (Math.hypot(px - e.dx * k, pz - e.dz * k) < pad) return true
    }
    return false
  }

  entrancesForColumn(cx, cz) {
    return this._entrancesOver(cx * CHUNK, cz * CHUNK, cx * CHUNK + CHUNK - 1, cz * CHUNK + CHUNK - 1)
  }

  // --- one cell ---

  // Open (cave or entrance) at a cell? bottom: bottomAt(x, z).
  _carved(x, y, z, bottom, places, entrances) {
    if (entrances.length && this.entranceAir(entrances, x, y, z)) return true
    if (demonOpen(x, y, z)) return true
    if (y <= CAVE_FLOOR || y >= this._caveTop(x, z, bottom, places)) return false
    return noiseOpen(x, y, z)
  }

  // Solid rock that isn't stored yet (below the ground, not a cave, not
  // broken this game)?
  implicitSolid(x, y, z, key) {
    if (y < BOTTOM) return false
    const bottom = this.bottomAt(x, z)
    if (y >= bottom) return false
    if (this.world.removed.has(key)) return false
    const city = cityAt(citiesNear(x, y, z, x, y, z), x, y, z)
    if (city !== undefined) return city !== null
    const places = this.world._plansOver(x, z, x, z, 3, true)
    return !this._carved(x, y, z, bottom, places, this._entrancesOver(x, z, x, z))
  }

  // A block was broken (or a block that was there is gone): the rock it
  // was hiding becomes real so the hole has walls and a floor.
  reveal(x, y, z) {
    const bm = this.bm
    for (const [dx, dy, dz] of SIDES) {
      const nx = x + dx
      const ny = y + dy
      const nz = z + dz
      const key = `${nx},${ny},${nz}`
      if (bm._blocks.has(key) || !this.implicitSolid(nx, ny, nz, key)) continue
      this._put(this._record(nx, ny, nz), key, nx, ny, nz, solidAt(nx, ny, nz))
      bm._chunks.markDirty(nx, ny, nz)
    }
  }

  _record(x, y, z) {
    const ck = `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`
    let rec = this.chunks.get(ck)
    if (!rec) this.chunks.set(ck, (rec = { keys: [], done: false, keep: false }))
    return rec
  }

  _put(rec, key, x, y, z, type) {
    this.bm._setTerrainBlock(key, x, y, z, type)
    this.world.terrainKeys.add(key)
    rec.keys.push(key)
  }

  // --- a chunk of cave walls ---

  // Makes the walls of every cave (and entrance) in one 16x16x16 chunk.
  // false when the land above it hasn't grown yet (try again later).
  _grow(cx, cy, cz) {
    const ck = `${cx},${cy},${cz}`
    const had = this.chunks.get(ck)
    if (had?.done) return true
    const x0 = cx * CHUNK
    const y0 = cy * CHUNK
    const z0 = cz * CHUNK
    // Bottoms for the chunk and a one-cell border (18x18).
    const W = CHUNK + 2
    const bottoms = new Int16Array(W * W)
    let top = -Infinity
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < W; j++) {
        const x = x0 - 1 + i
        const z = z0 - 1 + j
        const ncx = Math.floor(x / CHUNK)
        const ncz = Math.floor(z / CHUNK)
        const b = this._bottoms(ncx, ncz)
        const v = b ? b[(x - ncx * CHUNK) * CHUNK + (z - ncz * CHUNK)] : inCityShape(x, z) ? -1 : this.world.bottomOf(x, z)
        bottoms[i * W + j] = v
        if (i > 0 && j > 0 && i <= CHUNK && j <= CHUNK && v > top) top = v
      }
    }
    if (!this._bottoms(cx, cz)) return false
    const rec = had || { keys: [], done: false, keep: false }
    this.chunks.set(ck, rec)
    rec.done = true
    // Entirely in the air, or under bedrock: nothing to do.
    if (y0 >= top || y0 + CHUNK - 1 < BOTTOM) return true
    const places = this.world._plansOver(x0 - 1, z0 - 1, x0 + CHUNK, z0 + CHUNK, 3, true)
    const entrances = this._entrancesOver(x0 - 1, z0 - 1, x0 + CHUNK, z0 + CHUNK)
    // Cave noise on the lattice over the chunk + border, then blended.
    const lx0 = Math.floor((x0 - 1) / LATTICE)
    const ly0 = Math.floor((y0 - 1) / LATTICE)
    const lz0 = Math.floor((z0 - 1) / LATTICE)
    const LN = Math.floor((CHUNK + 1) / LATTICE) + 3
    const lat = new Float64Array(LN * LN * LN * 3)
    for (let a = 0; a < LN; a++) for (let b = 0; b < LN; b++) for (let c = 0; c < LN; c++) latticeAt(lx0 + a, ly0 + b, lz0 + c, lat, ((a * LN + b) * LN + c) * 3)
    const open = new Uint8Array(W * W * W)
    const idx = (i, j, k) => (i * W + k) * W + j // x, y, z
    const cities = citiesNear(x0 - 1, y0 - 1, z0 - 1, x0 + CHUNK, y0 + CHUNK, z0 + CHUNK)
    const cityType = cities.length ? new Map() : null
    for (let i = 0; i < W; i++) {
      const x = x0 - 1 + i
      const ax = Math.floor(x / LATTICE) - lx0
      const fx = (x - Math.floor(x / LATTICE) * LATTICE) / LATTICE
      for (let k = 0; k < W; k++) {
        const z = z0 - 1 + k
        const bottom = bottoms[i * W + k]
        const caveTop = this._caveTop(x, z, bottom, places)
        const az = Math.floor(z / LATTICE) - lz0
        const fz = (z - Math.floor(z / LATTICE) * LATTICE) / LATTICE
        for (let j = 0; j < W; j++) {
          const y = y0 - 1 + j
          if (cityType) {
            const v = cityAt(cities, x, y, z)
            if (v === null) {
              open[idx(i, j, k)] = 1
              continue
            }
            if (v !== undefined) {
              cityType.set(idx(i, j, k), v)
              continue
            }
          }
          if (entrances.length && this.entranceAir(entrances, x, y, z)) {
            open[idx(i, j, k)] = 1
            continue
          }
          if (y < DEMON_TOP && demonOpen(x, y, z)) {
            open[idx(i, j, k)] = 1
            continue
          }
          if (y <= CAVE_FLOOR || y >= caveTop) continue
          const ay = Math.floor(y / LATTICE) - ly0
          const fy = (y - Math.floor(y / LATTICE) * LATTICE) / LATTICE
          const v0 = blend(lat, LN, ax, ay, az, fx, fy, fz, 0)
          const v1 = blend(lat, LN, ax, ay, az, fx, fy, fz, 1)
          if (v0 * v0 + v1 * v1 < TUNNEL_WIDTH || (y < ROOM_BELOW && blend(lat, LN, ax, ay, az, fx, fy, fz, 2) > ROOM_LEVEL)) open[idx(i, j, k)] = 1
        }
      }
    }
    // Cells broken this game near here count as open too.
    const removed = this.world.removed
    const gone = new Set()
    if (removed.size) {
      for (const key of removed) {
        const [x, y, z] = key.split(',').map(Number)
        if (x >= x0 - 1 && x <= x0 + CHUNK && y >= y0 - 1 && y <= y0 + CHUNK && z >= z0 - 1 && z <= z0 + CHUNK) gone.add(key)
      }
    }
    const blocks = this.bm._blocks
    let put = 0
    for (let i = 1; i <= CHUNK; i++) {
      const x = x0 - 1 + i
      for (let k = 1; k <= CHUNK; k++) {
        const z = z0 - 1 + k
        const bottom = bottoms[i * W + k]
        const jTop = Math.min(CHUNK, bottom - y0) // cells with y < bottom
        for (let j = 1; j <= jTop; j++) {
          const y = y0 - 1 + j
          if (y < BOTTOM || open[idx(i, j, k)]) continue
          const key = `${x},${y},${z}`
          if (gone.has(key) || blocks.has(key)) continue
          // Seen from a cave, a broken cell, or a hole in the ground above.
          let seen = open[idx(i + 1, j, k)] || open[idx(i - 1, j, k)] || open[idx(i, j + 1, k)] || open[idx(i, j - 1, k)] || open[idx(i, j, k + 1)] || open[idx(i, j, k - 1)]
          if (!seen && gone.size) seen = SIDES.some(([dx, dy, dz]) => gone.has(`${x + dx},${y + dy},${z + dz}`))
          if (!seen && y === bottom - 1 && !blocks.has(`${x},${bottom},${z}`)) seen = true
          if (!seen) continue
          const demon = y < DEMON_TOP ? demonSurface(x, y, z, open[idx(i, j + 1, k)], open[idx(i, j - 1, k)]) : null
          this._put(rec, key, x, y, z, cityType?.get(idx(i, j, k)) ?? demon ?? rockAt(x, y, z))
          put++
        }
      }
    }
    if (put) {
      const chunks = this.bm._chunks
      chunks.markLazy(ck)
      for (const [dx, dy, dz] of SIDES) chunks.markLazy(`${cx + dx},${cy + dy},${cz + dz}`)
    }
    return true
  }

  // A land column just grew: the walls of any entrance in it grow too, so
  // its mouth is never a hole into nothing. Returns the chunk keys made.
  columnGrown(cx, cz, entrances) {
    const made = []
    for (const e of entrances) {
      for (let cy = Math.floor(e.y0 / CHUNK) - 1; cy <= Math.floor(e.y1 / CHUNK); cy++) {
        if (!this._grow(cx, cy, cz)) continue
        const ck = `${cx},${cy},${cz}`
        this.chunks.get(ck).keep = true
        made.push(ck)
      }
    }
    return made
  }

  // The land column was dropped: its kept entrance chunks go too.
  columnDropped(cx, cz) {
    for (const [ck, rec] of [...this.chunks]) {
      if (!rec.keep) continue
      const [x, , z] = ck.split(',').map(Number)
      if (x === cx && z === cz) this._dropChunk(ck)
    }
  }

  // Grows cave chunks around the player and drops far ones. p: blocks.
  update(p) {
    if (!p || !Number.isFinite(p.y)) return
    const pcx = Math.floor(p.x / CHUNK)
    const pcy = Math.floor(p.y / CHUNK)
    const pcz = Math.floor(p.z / CHUNK)
    // In or near an underground city its whole dome is grown, so the far
    // walls and the roof never show gaps.
    const nearCity = citiesNear(p.x - CITY_NEAR, p.y - CITY_NEAR, p.z - CITY_NEAR, p.x + CITY_NEAR, p.y + CITY_NEAR, p.z + CITY_NEAR).length > 0
    const demon = p.y < DEMON_TOP + 16
    const radius = nearCity ? CITY_RADIUS : demon ? DEMON_RADIUS : UNDER_RADIUS
    const above = nearCity ? CITY_ABOVE : UNDER_ABOVE
    const until = performance.now() + (nearCity ? CITY_BUDGET_MS : demon ? DEMON_BUDGET_MS : UNDER_BUDGET_MS)
    const wanted = []
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dy = -UNDER_BELOW; dy <= above; dy++) {
          const cy = pcy + dy
          if (cy * CHUNK + CHUNK - 1 < BOTTOM) continue
          const rec = this.chunks.get(`${pcx + dx},${cy},${pcz + dz}`)
          if (rec?.done) continue
          wanted.push([dx * dx + dz * dz + dy * dy, pcx + dx, cy, pcz + dz])
        }
      }
    }
    wanted.sort((a, b) => a[0] - b[0])
    for (const [, cx, cy, cz] of wanted) {
      if (performance.now() > until) break
      this._grow(cx, cy, cz)
    }
    if ((this._tick = (this._tick || 0) + 1) % 30 === 0) {
      for (const [ck, rec] of [...this.chunks]) {
        if (rec.keep) continue
        const [cx, cy, cz] = ck.split(',').map(Number)
        if (Math.abs(cx - pcx) > radius + 2 || Math.abs(cz - pcz) > radius + 2 || cy < pcy - UNDER_BELOW - 2 || cy > pcy + above + 2) this._dropChunk(ck)
      }
    }
  }

  _dropChunk(ck) {
    const rec = this.chunks.get(ck)
    if (!rec) return
    this.chunks.delete(ck)
    const world = this.world
    for (const key of rec.keys) {
      if (!world.terrainKeys.has(key)) continue
      world.terrainKeys.delete(key)
      this.bm._dropTerrainBlock(key)
    }
  }
}

const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

// One cave noise (k) at a cell, blended from the lattice points around it.
function blend(lat, LN, ax, ay, az, fx, fy, fz, k) {
  const at = (a, b, c) => lat[((a * LN + b) * LN + c) * 3 + k]
  const x00 = at(ax, ay, az) + (at(ax + 1, ay, az) - at(ax, ay, az)) * fx
  const x10 = at(ax, ay + 1, az) + (at(ax + 1, ay + 1, az) - at(ax, ay + 1, az)) * fx
  const x01 = at(ax, ay, az + 1) + (at(ax + 1, ay, az + 1) - at(ax, ay, az + 1)) * fx
  const x11 = at(ax, ay + 1, az + 1) + (at(ax + 1, ay + 1, az + 1) - at(ax, ay + 1, az + 1)) * fx
  const y0 = x00 + (x10 - x00) * fy
  const y1 = x01 + (x11 - x01) * fy
  return y0 + (y1 - y0) * fz
}
