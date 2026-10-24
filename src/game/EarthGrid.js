// Reading the Earth biome grid (EarthMapData.js) - shared by the spawn map
// (SpawnMap.js) and, in the World Map game mode, the land itself
// (OpenWorld.js), so walking east from Paris really reaches Germany.
// One world unit of latitude/longitude is EARTH_DEG blocks: x = lon * DEG,
// z = -lat * DEG.
import { EARTH_W, EARTH_H, EARTH_BIOMES, EARTH_RLE } from './EarthMapData.js'

export const EARTH_DEG = 120
// Grid cells per degree (2: half-degree cells since 2026-10-24).
const RES = EARTH_W / 360
export const WATER_BIOMES = new Set(['ocean', 'deepOcean', 'frozenOcean', 'warmOcean', 'river'])

let grid = null
export function earthCells() {
  if (grid) return grid
  grid = new Uint8Array(EARTH_W * EARTH_H)
  let i = 0
  for (const m of EARTH_RLE.matchAll(/(\d*)([a-z])/g)) {
    const n = Number(m[1] || 1)
    const b = m[2].charCodeAt(0) - 97
    grid.fill(b, i, i + n)
    i += n
  }
  return grid
}

function cellAt(i, j) {
  const ii = ((i % EARTH_W) + EARTH_W) % EARTH_W
  const jj = Math.min(EARTH_H - 1, Math.max(0, j))
  return EARTH_BIOMES[earthCells()[jj * EARTH_W + ii]]
}

// The Earth biome at a latitude / longitude.
export function earthBiome(lat, lon) {
  return cellAt(Math.floor((lon + 180) * RES), Math.floor((90 - lat) * RES))
}

// How much land is around a point, 0 (open sea) .. 1 (inland), blended
// smoothly between the grid's cells so coasts aren't squares.
export function earthLandAmount(lat, lon) {
  const fx = (lon + 180) * RES - 0.5
  const fy = (90 - lat) * RES - 0.5
  const i = Math.floor(fx)
  const j = Math.floor(fy)
  const tx = fx - i
  const ty = fy - j
  const v = (a, b) => (WATER_BIOMES.has(cellAt(a, b)) ? 0 : 1)
  const top = v(i, j) * (1 - tx) + v(i + 1, j) * tx
  const bottom = v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx
  return top * (1 - ty) + bottom * ty
}
