// Underground cities (2026-10-17, Gaymi: "add underground cities"). Deep in
// the rock (Underground.js), at most one per UC_GRID square, a huge dome-
// shaped cavern holds a lost city of deepslate: streets of blackstone
// bricks in a grid, houses and towers with doorways and windows, glowstone
// street lamps and lights inside, sculk creeping over empty lots, and a
// plaza in the middle with a tall monument.
//
// Pure: cityCell(city, x, y, z) says what one cell is - undefined (not the
// city: ordinary rock rules apply), null (open air) or a block type - so
// Underground can treat the city like its caves: the air is "carved" and
// only the city blocks something can see are made into real blocks. The
// same seed always gives the same cities. They are never under the block
// city, and sit deep enough (FLOOR_MIN..FLOOR_MAX) that no ocean or valley
// reaches them; you find one by caving or digging down.

const UC_GRID = 320
const UC_CHANCE = 0.55
const R = 44 // the dome's radius on the ground
const DOME_H = 30 // its height in the middle
const FLOOR_MAX = -80
const FLOOR_MIN = -140
const CITY_GAP = 120 // from the block city's middle
const LOT = 11 // a street (3 wide) plus a building lot (8 wide)
const PLAZA = 10

let SALT = 0
export function setUnderCitySeed(seed) {
  SALT = seed | 0
}

function hash(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x2f6b8e45) ^ Math.imul((c + SALT) | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const cache = new Map()
let cacheSalt = null

// The city in grid square (gx, gz), or null.
function cityIn(gx, gz) {
  if (cacheSalt !== SALT) {
    cache.clear()
    cacheSalt = SALT
  }
  const key = `${gx},${gz}`
  if (cache.has(key)) return cache.get(key)
  let c = null
  if (hash(gx, gz, 901) < UC_CHANCE) {
    const x = gx * UC_GRID + R + 8 + Math.floor(hash(gx, gz, 902) * (UC_GRID - 2 * R - 16))
    const z = gz * UC_GRID + R + 8 + Math.floor(hash(gx, gz, 903) * (UC_GRID - 2 * R - 16))
    if (Math.hypot(x, z) > CITY_GAP + R) c = { x, z, floor: FLOOR_MAX - Math.floor(hash(gx, gz, 904) * (FLOOR_MAX - FLOOR_MIN)), gx, gz }
  }
  cache.set(key, c)
  return c
}

// Every city whose dome reaches into the box (x0..x1, z0..z1).
export function citiesOver(x0, z0, x1, z1) {
  const out = []
  for (let gx = Math.floor((x0 - R) / UC_GRID); gx <= Math.floor((x1 + R) / UC_GRID); gx++) {
    for (let gz = Math.floor((z0 - R) / UC_GRID); gz <= Math.floor((z1 + R) / UC_GRID); gz++) {
      const c = cityIn(gx, gz)
      if (c && c.x + R + 1 >= x0 && c.x - R - 1 <= x1 && c.z + R + 1 >= z0 && c.z - R - 1 <= z1) out.push(c)
    }
  }
  return out
}

// Vertical range a city uses (floor's underside .. dome top).
export function cityYRange(c) {
  return [c.floor - 2, c.floor + DOME_H + 1]
}

// The dome's ceiling height above the floor at a distance r from the middle.
function ceilAt(r) {
  return r >= R ? 0 : DOME_H * Math.sqrt(1 - (r / R) * (r / R))
}

const mod = (a, n) => ((a % n) + n) % n

export function cityCell(c, x, y, z) {
  const dx = x - c.x
  const dz = z - c.z
  const r = Math.hypot(dx, dz)
  if (r > R) return undefined
  const dy = y - c.floor
  if (dy < -2) return undefined
  const ceil = ceilAt(r)
  if (dy > ceil) return undefined
  if (dy < 0) return 'deepslatetiles'
  // The plaza and its monument.
  if (r < PLAZA) {
    if (dy === 0) return mod(dx + dz, 2) ? 'polisheddeepslate' : 'chiseleddeepslate'
    if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
      if (dy <= 9) return dx === 0 && dz === 0 && dy === 9 ? 'sealantern' : Math.abs(dx) + Math.abs(dz) === 2 ? 'reinforceddeepslate' : 'polishedblackstonebricks'
      if (dy === 10) return 'gold'
    }
    return null
  }
  const lx = mod(dx, LOT)
  const lz = mod(dz, LOT)
  const ix = Math.floor(dx / LOT)
  const iz = Math.floor(dz / LOT)
  const street = lx < 3 || lz < 3
  if (street) {
    if (dy === 0) return mod(x * 7 + z * 13, 9) === 0 ? 'crackedpolishedblackstonebricks' : 'polishedblackstonebricks'
    // A lamp post at every other crossing.
    if (lx === 1 && lz === 1 && mod(ix + iz, 2) === 0 && dy <= 4 && ceil > 6) return dy === 4 ? 'glowstone' : 'polishedblackstone'
    return null
  }
  // A building lot: the lot's middle decides what stands on it.
  const midR = Math.hypot(ix * LOT + 7 - 0.5, iz * LOT + 7 - 0.5)
  const roll = hash(ix + c.gx * 97, iz + c.gz * 89, 911)
  const room = Math.floor(ceilAt(midR + 5)) - 3
  if (midR > R - 7 || roll > 0.82 || room < 4) {
    if (dy === 0) return roll > 0.9 ? 'sculk' : 'deepslatetiles'
    return null
  }
  const tower = roll < 0.18
  const h = Math.min(room, tower ? 9 + Math.floor(hash(ix, iz, 913) * 7) : 4 + Math.floor(hash(ix, iz, 912) * 4))
  if (dy === 0) return 'polisheddeepslate'
  const ex = lx === 3 || lx === 10
  const ez = lz === 3 || lz === 10
  if (dy <= h) {
    if (!ex && !ez) return dy === h && (lx === 6 || lx === 7) && (lz === 6 || lz === 7) ? 'glowstone' : null
    if (ex && ez) return tower ? 'polishedblackstone' : 'polisheddeepslate'
    // The doorway faces the street on the low-z side; windows in rows.
    if (lz === 3 && (lx === 6 || lx === 7) && dy <= 2) return null
    if (dy % 3 === 0 && dy < h && mod(ex ? lz : lx, 2) === 1) return null
    return hash(x, y * 31 + z, 914) < 0.2 ? 'crackeddeepslatebricks' : 'deepslatebricks'
  }
  if (dy === h + 1) return 'deepslatetiles'
  // Towers wear a glowing crown on their corners.
  if (tower && dy === h + 2 && ex && ez) return 'glowstone'
  return null
}

// What a cell is across a list of cities (citiesOver): see cityCell.
export function cityAt(cities, x, y, z) {
  for (const c of cities) {
    const v = cityCell(c, x, y, z)
    if (v !== undefined) return v
  }
  return undefined
}
