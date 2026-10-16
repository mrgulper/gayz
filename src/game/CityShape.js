// Map 1's outline (2026-10-16, Gaymi: "make it not like a square ... more
// irregular shape from looking at the top"). The block city used to fill
// the whole 128x128 square, so from above (and on the minimap) it was a
// square in the open world. Now it's a lumpy, uneven blob inside that
// square: Map3Generator.js builds only inside it, and OpenWorld.js grows
// land on every cell outside it, right up to its edge.
//
// Fixed (never reseeded): the city is the same every game, only the land
// around it changes. Changing the outline changes Map 1 - see
// Map3Generator.js's note about MAP3_EDITS_KEY.

const HALF = 64
// The radius for each of ANGLES directions, from a few waves of different
// sizes: wide bulges, smaller bays and a little roughness.
const ANGLES = 1440
const WAVES = [
  [2, 0.05, 1.3],
  [3, 0.07, 4.1],
  [4, 0.045, 2.2],
  [5, 0.05, 2.0],
  [7, 0.035, 2.6],
  [11, 0.022, 5.3],
  [17, 0.012, 1.9],
]
// Plus uneven bumps: KNOTS fixed random heights around the circle, eased
// between, so no stretch of edge runs straight.
const KNOTS = 28
const knot = (i) => {
  let h = Math.imul(((i % KNOTS) + KNOTS) % KNOTS, 0x9e3779b1) ^ 0x5bd1e995
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  return (((h ^ (h >>> 13)) >>> 0) / 4294967296) * 2 - 1
}
const bumps = (a) => {
  const f = (a / (Math.PI * 2)) * KNOTS
  const i = Math.floor(f)
  const t = f - i
  const e = t * t * (3 - 2 * t)
  return knot(i) * (1 - e) + knot(i + 1) * e
}
const radii = new Float32Array(ANGLES)
for (let i = 0; i < ANGLES; i++) {
  const a = (i / ANGLES) * Math.PI * 2
  // Mostly round, a little square, so the corners still reach out a bit
  const square = (HALF - 1) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)))
  let k = 0.86
  for (const [n, amp, phase] of WAVES) k += amp * Math.sin(n * a + phase)
  k += bumps(a) * 0.045
  // Never past the square (the generator's 128x128 ground).
  radii[i] = Math.min(((HALF - 1) * 0.75 + square * 0.25) * k, square - 1)
}

// The camp's block (Map3Generator.js's safe zone) plus a margin always
// stays inside: the outline bulges out around it, so the camp keeps its
// place and its walls (and the ring of edge buildings leaves it alone,
// inCampBlock).
const CAMP_BLOCK = [29, 55, -25, 4]
const MARGIN = 2
const KEEP = [[CAMP_BLOCK[0] - MARGIN, CAMP_BLOCK[1] + MARGIN, CAMP_BLOCK[2] - MARGIN, CAMP_BLOCK[3] + MARGIN]]

export function inCampBlock(x, z) {
  return x >= CAMP_BLOCK[0] && x <= CAMP_BLOCK[1] && z >= CAMP_BLOCK[2] && z <= CAMP_BLOCK[3]
}
const keepRadius = (a) => {
  const c = Math.cos(a)
  const sn = Math.sin(a)
  let r = 0
  for (const [x0, x1, z0, z1] of KEEP) {
    // How far along this direction the ray leaves the box (if it crosses it).
    let t0 = 0
    let t1 = Infinity
    for (const [o, lo, hi] of [[c, x0, x1 + 1], [sn, z0, z1 + 1]]) {
      if (Math.abs(o) < 1e-9) {
        if (lo > 0 || hi < 0) t1 = -1
        continue
      }
      const ta = lo / o
      const tb = hi / o
      t0 = Math.max(t0, Math.min(ta, tb))
      t1 = Math.min(t1, Math.max(ta, tb))
    }
    if (t1 > t0) r = Math.max(r, t1)
  }
  return r
}
{
  const kept = Float32Array.from(radii, (_, i) => Math.max(radii[i], keepRadius((i / ANGLES) * Math.PI * 2)))
  // Rounded off around the bulge (a moving average over a few degrees),
  // never smaller than the box needs.
  const W = 24
  for (let i = 0; i < ANGLES; i++) {
    let sum = 0
    for (let j = -W; j <= W; j++) sum += kept[(i + j + ANGLES) % ANGLES]
    radii[i] = Math.max(sum / (W * 2 + 1), keepRadius((i / ANGLES) * Math.PI * 2))
  }
}

// How far the city reaches from its middle in the direction of (x, z).
export function cityRadius(x, z) {
  let a = Math.atan2(z, x)
  if (a < 0) a += Math.PI * 2
  const f = (a / (Math.PI * 2)) * ANGLES
  const i = Math.floor(f) % ANGLES
  const j = (i + 1) % ANGLES
  const t = f - Math.floor(f)
  return radii[i] * (1 - t) + radii[j] * t
}

// A cell (block coordinates) belongs to the city.
const inside = new Uint8Array(HALF * 2 * HALF * 2)
for (let x = -HALF; x < HALF; x++) {
  for (let z = -HALF; z < HALF; z++) {
    const px = x + 0.5
    const pz = z + 0.5
    inside[(x + HALF) * HALF * 2 + (z + HALF)] = Math.hypot(px, pz) < cityRadius(px, pz) ? 1 : 0
  }
}

// One piece with no holes: a stray cell cut off by a bay (or a hole) would
// leave a speck of city out in the land (or of land in the city).
const flood = (start, want) => {
  const seen = new Uint8Array(inside.length)
  const stack = [start]
  seen[start] = 1
  while (stack.length) {
    const i = stack.pop()
    const x = Math.floor(i / (HALF * 2))
    const z = i % (HALF * 2)
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      if (nx < 0 || nz < 0 || nx >= HALF * 2 || nz >= HALF * 2) continue
      const j = nx * HALF * 2 + nz
      if (!seen[j] && inside[j] === want) {
        seen[j] = 1
        stack.push(j)
      }
    }
  }
  return seen
}
{
  const city = flood(HALF * HALF * 2 + HALF, 1)
  for (let i = 0; i < inside.length; i++) inside[i] = city[i]
  // Land reachable from the square's corner (always outside); the rest is city.
  const land = flood(0, 0)
  for (let i = 0; i < inside.length; i++) inside[i] = land[i] ? 0 : 1
}

export function inCityShape(x, z) {
  return x >= -HALF && x < HALF && z >= -HALF && z < HALF && inside[(x + HALF) * HALF * 2 + (z + HALF)] === 1
}

// Roughly how many cells a cell lies outside the city (0 inside it).
export function cityEdgeDistance(x, z) {
  if (inCityShape(x, z)) return 0
  const px = x + 0.5
  const pz = z + 0.5
  return Math.max(1, Math.round(Math.hypot(px, pz) - cityRadius(px, pz)))
}
