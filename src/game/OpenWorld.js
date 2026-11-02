// The open world around Map 1 (2026-10-12, Gaymi: "make outside of the map
// 1 open world with all the biomes on earth", like bloxd.io). Owned by
// BuildMode (`buildMode.world`), switched on whenever the block city is
// loaded (Map 1 / a map shared from it).
//
// The land is never stored: every column comes out of seeded noise, so the
// same spot always grows the same hills, trees and coral. Terrain is
// generated a chunk column (16x16 cells, every height) at a time around
// the player - or the flying editor camera - nearest first, a few
// milliseconds per frame, and columns far away are dropped again unless
// the player changed something in them. The city has an uneven outline
// inside -64..63 (CityShape.js); terrain goes on every cell outside it -
// also in the city's own chunk columns - and blends down to the city's
// ground height (y=-1) near its edge, where the roads run out of the city
// as dirt tracks.
//
// A new world every game (2026-10-12, Gaymi: "regenerate the whole biome
// again every time a new player creates or joins the map"): `reseed()`
// with a random seed for a solo game or the Map Editor, and one made from
// the server's / Build Together room's id, so everyone in the same game
// walks the same land. Generated blocks are in `terrainKeys` and left out
// of saves (BuildMode._snapshot), and so are changes out in the land -
// they'd land on different hills next time. A broken terrain block goes in
// `removed` (never grown back this game) and a column the player touched
// (`edited`) is never dropped while the game lasts.
import { t } from './i18n.js'
import { inCityShape, cityEdgeDistance } from './CityShape.js'
import { planStructure, planLandmark, planTown, STRUCT_GRID, STRUCTURE_NAMES } from './WorldStructures.js'
import { EARTH_DEG, earthBiome, earthLandAmount, WATER_BIOMES } from './EarthGrid.js'
import { loadEarthTerrain, earthTerrainReady, earthHeight, earthLakeAt, earthLakeNear, earthRiverNear } from './EarthTerrain.js'
import { Underground, rockAt, setUnderSeed } from './Underground.js'
import { HeavenRealm } from './HeavenRealm.js'

const CHUNK = 16
// The city lies within -CITY .. CITY-1 on x and z (its outline: CityShape.js).
const CITY = 64
const CITY_CHUNKS = CITY / CHUNK
// Chunk columns that are city all the way through (no land grows there).
const FULL_CITY_COLUMNS = new Set()
for (let cx = -CITY_CHUNKS; cx < CITY_CHUNKS; cx++) {
  for (let cz = -CITY_CHUNKS; cz < CITY_CHUNKS; cz++) {
    let full = true
    for (let i = 0; i < CHUNK && full; i++) for (let j = 0; j < CHUNK; j++) if (!inCityShape(cx * CHUNK + i, cz * CHUNK + j)) { full = false; break }
    if (full) FULL_CITY_COLUMNS.add(`${cx},${cz}`)
  }
}
// Sea level (the city's ground is y=-1, a little above it).
export const SEA = -4
// No limit (2026-10-17, Gaymi: "make the map no limit"): the land goes on
// forever in every direction. (It used to stop 30,000 blocks out.)
export const WORLD_LIMIT = Infinity
// Generated out to the view distance plus a margin, never past this.
const MAX_RADIUS = 144
const MIN_RADIUS = 64
// Columns further than the generated radius plus this are dropped. Was 48,
// which kept about twice the land the radius needs loaded after a walk
// (2026-10-19, memory): 16 still leaves ~20 blocks between growing a
// column and dropping it, so walking back and forth doesn't regrow it.
const UNLOAD_MARGIN = 16
// Time per frame spent growing new columns.
const GEN_BUDGET_MS = 4
// The big map's tile pictures kept (32x32 each, ~4 KB), the tiles drawn
// ahead on each side of you at every zoom (prewarmMap), the time per
// background slice and the gap between slices, and the big map's opening
// span (BuildTryMode's MAP_SPAN_FOR.big).
const MAP_TILE_CACHE = 4000
// Sharp map (2026-10-26, Gaymi: "the map its a bit too blurry fix that from
// the root cause"): a tile of T cells used to be 32x32 samples whatever its
// size, so the big map (~1400 canvas pixels across, 5-10 tiles) stretched
// each sample over 4-5 pixels and smoothed it into a blur. Now a tile has
// one sample per block up to MAP_TILE_SAMPLES, i.e. about one sample per
// canvas pixel. Cached tiles are held to MAP_TILE_PIXELS samples in all
// (~26 MB), the oldest dropped first.
const MAP_TILE_SAMPLES = 128
const MAP_TILE_PIXELS = 6.5e6
const mapTileSamples = (T) => Math.min(T, MAP_TILE_SAMPLES)
// Sharp tiles are drawn by MAP_TILE_WORKERS Web Workers (MapTileWorker.js),
// MAP_TILE_JOBS at a time each, so drawing never slows the game
// (2026-10-26: a 128x128 tile took ~15 ms on the main thread, and zoomed
// out the edges stayed blurry for seconds).
const MAP_TILE_WORKERS = 2
const MAP_TILE_JOBS = 2
const MAP_PREWARM_R = 5
const MAP_PREWARM_SLICE_MS = 6
const MAP_PREWARM_GAP_MS = 30
// The World Map mode's whole-Earth picture (earthPicture): pixels per
// degree (4 = one pixel per 30 blocks, 1440 x 720), rows per batch and the
// time spent per batch.
const EARTH_PIC_RES = 4
const EARTH_PIC_ROWS = 4
const EARTH_PIC_SLICE_MS = 8
const EARTH_PIC_GAP_MS = 24
const MAP_SPAN_OPEN = 640
// How far the roads continue out of the gates as dirt tracks.
const PATH_LEN = 64

// Every biome: its name (i18n key) and how it's drawn on the minimap.
export const BIOMES = {
  ocean: { key: 'biomeOcean' },
  deepOcean: { key: 'biomeDeepOcean' },
  frozenOcean: { key: 'biomeFrozenOcean' },
  warmOcean: { key: 'biomeWarmOcean' },
  beach: { key: 'biomeBeach' },
  snowyBeach: { key: 'biomeSnowyBeach' },
  river: { key: 'biomeRiver' },
  plains: { key: 'biomePlains' },
  forest: { key: 'biomeForest' },
  birchForest: { key: 'biomeBirchForest' },
  darkForest: { key: 'biomeDarkForest' },
  cherryGrove: { key: 'biomeCherryGrove' },
  taiga: { key: 'biomeTaiga' },
  snowyTaiga: { key: 'biomeSnowyTaiga' },
  snowyPlains: { key: 'biomeSnowyPlains' },
  iceSpikes: { key: 'biomeIceSpikes' },
  desert: { key: 'biomeDesert' },
  savanna: { key: 'biomeSavanna' },
  badlands: { key: 'biomeBadlands' },
  jungle: { key: 'biomeJungle' },
  bambooJungle: { key: 'biomeBambooJungle' },
  swamp: { key: 'biomeSwamp' },
  mangroveSwamp: { key: 'biomeMangroveSwamp' },
  mushroomFields: { key: 'biomeMushroomFields' },
  mountains: { key: 'biomeMountains' },
  snowyPeaks: { key: 'biomeSnowyPeaks' },
}

export function biomeName(id) {
  return BIOMES[id] ? t(BIOMES[id].key) : ''
}

// --- noise ---

// The current world's seed, mixed into every random number below.
let WORLD_SALT = 0

export function setWorldSeed(seed) {
  WORLD_SALT = seed | 0
  setUnderSeed(WORLD_SALT)
}

export function worldSeed() {
  return WORLD_SALT
}

// A seed from any text (a server or room id), the same everywhere.
export function seedFromText(text) {
  let h = 0x811c9dc5
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
  return h | 0
}

export function hash2(x, z, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul((seed + WORLD_SALT) | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Smooth value noise, -1..1.
function noise(x, z, seed) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1
}

export function fbm(x, z, scale, octaves, seed) {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = scale
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * f, z * f, seed + i * 101) * amp
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

function randomSeed() {
  return (Math.random() * 2 ** 31) | 0
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (v) => {
  const c = clamp01(v)
  return c * c * (3 - 2 * c)
}
const lerp = (a, b, k) => a + (b - a) * k

// How far a cell is outside the city's outline (0 inside it).
export const cityDistance = cityEdgeDistance

// A Plain map (2026-10-24, Gaymi: "plain where its all grass no void"):
// the player's own slots get endless flat grass instead of the biomes -
// the same growing/dropping columns, just one flat layer at the slot's
// ground height, no trees, caves or buildings. The slot's own 128x128
// ground (BuildMode GROUND_SIZE) is its "city": nothing grows over it.
let FLAT = false
const FLAT_HALF = 64
export function setFlatWorld(on) {
  FLAT = !!on
}
export function isFlatWorld() {
  return FLAT
}
export const inCity = (x, z) => (FLAT ? x >= -FLAT_HALF && x < FLAT_HALF && z >= -FLAT_HALF && z < FLAT_HALF : inCityShape(x, z))

// The land at one cell: its surface height (the top block's y), biome and
// the few numbers the surface needs. Pure - the same cell always gives the
// same answer.
// The World Map game mode (2026-10-18, Gaymi: "the map should be based on
// the real world map after they spawn in the world"): the land follows
// Earth (EarthGrid.js) - sea where Earth has sea, coasts where its coasts
// are (blended between the 1-degree cells, with noise so they wiggle),
// and each place's biome from the real spot (a little jitter so biome
// borders aren't straight lines). Since 2026-10-23 the heights, mountains,
// lakes and rivers are the real ones too (EarthTerrain.js, sampleEarth)
// once their data has loaded. setEarthWorld(on) switches it.
let EARTH = false
export function setEarthWorld(on) {
  EARTH = !!on
}
export function isEarthWorld() {
  return EARTH
}

// Heaven's Peaks (2026-10-30, Gaymi: Heaven at y 300-500, reached by
// "build and dig make very tall mountains"): now and then a giant lone
// mountain rises out of the land, about PEAK_H blocks high - its top pokes
// through Heaven's cloud floor (HeavenRealm.js). One may sit in each
// PEAK_GRID square (PEAK_CHANCE), never near the city. Its sides climb
// about one block per cell, so it can be walked up (with jumps).
export const PEAK_GRID = 1100
const PEAK_CHANCE = 0.8
export const PEAK_R = 330
const PEAK_H = 330
const PEAK_CITY_GAP = 520

// The peak (if any) planned in grid square (gx, gz): { x, z }.
export function peakIn(gx, gz) {
  if (hash2(gx, gz, 211) > PEAK_CHANCE) return null
  const m = PEAK_R + 40
  const x = Math.round(gx * PEAK_GRID + m + hash2(gx, gz, 212) * (PEAK_GRID - 2 * m))
  const z = Math.round(gz * PEAK_GRID + m + hash2(gx, gz, 213) * (PEAK_GRID - 2 * m))
  // Its whole foot stays well away from the city.
  if (Math.hypot(x, z) < PEAK_CITY_GAP + PEAK_R) return null
  return { x, z }
}

// Roughly how high a Heaven's Peak alone reaches at (x, z) (0 off one) -
// Heaven's cloud floor leaves a hole where the mountain comes through.
export function peakLift(x, z) {
  const k = peakAmount(x, z)
  return k > 0 ? k * PEAK_H + fbm(x, z, 1 / 60, 2, 217) * 10 * k : 0
}

// How much a Heaven's Peak lifts the land at (x, z): 0..1 (1 = its top).
function peakAmount(x, z) {
  // (Not in World Map mode: its land follows the real Earth.)
  if (EARTH) return 0
  const gx = Math.floor(x / PEAK_GRID)
  const gz = Math.floor(z / PEAK_GRID)
  const p = peakIn(gx, gz)
  if (!p) return 0
  // Not perfectly round: the edge wanders in and out.
  const r = Math.hypot(x - p.x, z - p.z) / (PEAK_R * (1 + fbm(x, z, 1 / 140, 2, 215) * 0.18))
  if (r >= 1) return 0
  // A cone with a rounded, flat-ish summit.
  return r < 0.05 ? 1 : 1 - (r - 0.05) / 0.95
}

export function sampleLand(x, z) {
  if (FLAT) return { h: -1, c: 0.3, T: 0, H: 0, m: 0, river: false, d: 99, biome: 'plains', w: SEA }
  const s = sampleBase(x, z)
  const k = s.d > 60 && s.h >= SEA && !s.river ? peakAmount(x, z) : 0
  if (k <= 0) return s
  // Lumpy rock on its sides; snow and ice high up.
  const lift = peakLift(x, z)
  s.h = Math.round(Math.max(s.h, s.h + lift))
  if (s.h > 120) s.biome = 'snowyPeaks'
  else if (s.h > 30) s.biome = 'mountains'
  s.m = Math.max(s.m, k)
  s.peak = true
  return s
}

function sampleBase(x, z) {
  const d = cityDistance(x, z)
  if (EARTH && earthTerrainReady()) return sampleEarth(x, z, d)
  let c = fbm(x, z, 1 / 420, 3, 11)
  let earthLat = 0
  let earthLon = 0
  if (EARTH) {
    earthLon = x / EARTH_DEG
    earthLat = -z / EARTH_DEG
    c = (earthLandAmount(earthLat, earthLon) - 0.5) * 1.3 + fbm(x, z, 1 / 160, 3, 71) * 0.28
  }
  // Land all around the city for a good way out.
  // (a round area, so the coast never traces the city's square)
  c = lerp(0.3, c, smooth((Math.hypot(x + 0.5, z + 0.5) - 160) / 220))
  const T = fbm(x, z, 1 / 420, 2, 23) * 1.6
  const H = fbm(x, z, 1 / 360, 2, 37) * 1.6
  let h
  const shore = -0.2
  if (c < shore) h = SEA - 1 - smooth((shore - c) / 0.3) * 13
  else h = SEA + (c - shore) * 18
  const land = smooth((c - shore) / 0.08)
  h += fbm(x, z, 1 / 70, 2, 41) * 3.2 * land
  // Mountain ranges: ridged noise inside wide mountain areas.
  const ridge = 1 - Math.abs(fbm(x, z, 1 / 230, 3, 53))
  const area = smooth((fbm(x, z, 1 / 700, 2, 59) - 0.05) / 0.3)
  const m = Math.pow(clamp01((ridge - 0.55) / 0.45), 1.6) * area * land
  h += m * 52
  // Mesas in the badlands, grown smoothly so they rise in steps.
  const hot = smooth((T - 0.45) / 0.15)
  const dry = smooth((-0.22 - H) / 0.15)
  const mesa = hot * dry * land * (1 - m)
  if (mesa > 0) {
    const p = clamp01((fbm(x, z, 1 / 80, 2, 61) + 0.1) * 2)
    h += Math.floor(p * 18 * mesa / 4) * 4
  }
  // Swamps: warm, wet lowland flattened down to the water line, with
  // puddles.
  const wet = smooth((H - 0.28) / 0.1) * smooth((T - 0.2) / 0.06) * (1 - smooth((T - 0.43) / 0.06)) * land * (1 - m)
  if (wet > 0) h = lerp(h, SEA + 0.6 + fbm(x, z, 1 / 9, 1, 63) * 1.4, wet)
  // Rivers wind through the lowlands.
  const rv = Math.abs(fbm(x, z, 1 / 360, 2, 67))
  let river = false
  if (land > 0.5 && m < 0.35 && rv < 0.045) {
    const k = smooth(rv / 0.045)
    h = lerp(SEA - 2, h, k)
    if (h < SEA) river = true
  }
  // Down to the city's ground near its edge.
  const w = smooth((d - 3) / 40)
  h = Math.round(lerp(-1, h, w))
  if (h < SEA) river = river && w > 0.9
  let biome = pickBiome(x, z, h, c, T, H, m, river, wet)
  // World Map: the real place's biome, except rivers, beaches and the
  // high mountains the noise made; the sea's kind from where it is.
  if (EARTH && biome !== 'river' && biome !== 'beach' && biome !== 'snowyBeach' && !(m > 0.45 && (biome === 'mountains' || biome === 'snowyPeaks'))) {
    const real = earthBiome(earthLat + biomeWobble(x, z, 73), earthLon + biomeWobble(x, z, 79))
    if (h < SEA) {
      if (WATER_BIOMES.has(biome)) biome = Math.abs(earthLat) > 62 ? 'frozenOcean' : Math.abs(earthLat) < 23 ? 'warmOcean' : c < -0.45 ? 'deepOcean' : 'ocean'
    } else if (!WATER_BIOMES.has(real)) biome = real
  }
  return { h, c, T, H, m, river, d, biome, w: SEA }
}

// --- the World Map mode's real land (EarthTerrain.js) ---
// Real heights are squeezed to fit: sea level is SEA + 1, Everest about
// SEA + 59. Sea depth: down to SEA - 15.
const landBlocks = (m) => SEA + 1 + 58 * Math.pow(Math.max(0, m) / 8000, 0.6)
const seaBlocks = (m) => SEA - 1 - 14 * Math.min(1, Math.sqrt(m / 5000))
// Snow line (metres) by latitude - high in the tropics, sea level near
// the poles.
function snowLine(lat) {
  const a = Math.abs(lat)
  if (a < 25) return 5600
  if (a < 60) return 5600 - ((a - 25) / 35) * 4000
  return Math.max(0, 1600 - ((a - 60) / 15) * 1600)
}
// River half-widths in blocks by size (0 big .. 3 small), and how wide
// their banks slope.
const RIVER_HALF = [4.5, 3.2, 2.2, 1.4]
const RIVER_BANK = 7
const LAKE_RIM = 3
const lakeWater = (level) => Math.max(SEA, Math.round(landBlocks(level)))

// How far (degrees) a spot's biome is looked up off the real spot: big
// slow bends plus small ones, so borders between the half-degree climate
// cells wander like real nature instead of running in straight lines.
const biomeWobble = (x, z, seed) => fbm(x, z, 1 / 90, 2, seed) * 0.45 + fbm(x, z, 1 / 22, 2, seed + 100) * 0.12

function sampleEarth(x, z, d) {
  const lon = x / EARTH_DEG
  const lat = -z / EARTH_DEG
  const T = fbm(x, z, 1 / 420, 2, 23) * 1.6
  const H = fbm(x, z, 1 / 360, 2, 37) * 1.6
  let e = earthHeight(lat, lon) + fbm(x, z, 1 / 60, 3, 71) * 30
  // Land below sea level that is still land (the Caspian lowland, the
  // Netherlands): the biome grid says it's well inland.
  if (e < 0 && earthLandAmount(lat, lon) > 0.999) e = 2
  // Land all around the city (an island in the Gulf of Guinea).
  e = lerp(40, e, smooth((Math.hypot(x + 0.5, z + 0.5) - 160) / 220))
  let h
  let w = SEA
  let m = 0
  let river = false
  let biome
  if (e < 0) {
    h = Math.round(seaBlocks(-e))
    biome = Math.abs(lat) > 62 ? 'frozenOcean' : Math.abs(lat) < 23 ? 'warmOcean' : h < SEA - 9 ? 'deepOcean' : 'ocean'
  } else {
    const base = landBlocks(e)
    // Mountains: ridges on top of the real height where it's high.
    m = smooth((e - 900) / 1800)
    const ridge = Math.pow(clamp01((1 - Math.abs(fbm(x, z, 1 / 120, 3, 53)) - 0.5) / 0.5), 1.5) * m
    let hh = base + fbm(x, z, 1 / 70, 2, 41) * 3.2 * smooth(e / 60) + ridge * 16
    const top = e + ridge * 1400
    const lake = earthLakeNear(lat, lon) ? earthLakeAt(lat, lon) : null
    if (lake !== null) {
      w = lakeWater(lake)
      hh = w - 2 - Math.floor(clamp01(fbm(x, z, 1 / 40, 2, 91) + 0.5) * 3)
      river = true
    } else {
      // Just outside a lake: a rim at least as high as its water.
      if (earthLakeNear(lat, lon)) {
        const r = LAKE_RIM / EARTH_DEG
        for (const [dl, dn] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const near = earthLakeAt(lat + dn, lon + dl)
          if (near !== null) hh = Math.max(hh, lakeWater(near))
        }
      }
      const rv = earthRiverNear(lat, lon)
      if (rv) {
        const half = RIVER_HALF[rv.size]
        const dist = rv.d * EARTH_DEG + fbm(x, z, 1 / 14, 1, 93) * 0.9
        const wl = Math.max(SEA, Math.round(base) - 1)
        if (dist < half) {
          w = wl
          hh = wl - (rv.size <= 1 ? 3 : 2)
          river = true
        } else if (dist < half + RIVER_BANK) {
          hh = Math.max(wl, lerp(wl, hh, smooth((dist - half) / RIVER_BANK)))
        }
      }
    }
    h = hh
    if (river) biome = 'river'
    else if (top > snowLine(lat)) biome = 'snowyPeaks'
    else if (top > 2400) biome = 'mountains'
    else {
      biome = earthBiome(lat + biomeWobble(x, z, 73), lon + biomeWobble(x, z, 79))
      // The grid's sea or mountains where the real land is low.
      if (WATER_BIOMES.has(biome) || biome === 'mountains' || biome === 'snowyPeaks' || biome === 'beach' || biome === 'snowyBeach') {
        const a = Math.abs(lat)
        biome = a > 66 ? 'snowyPlains' : a > 56 ? 'taiga' : 'plains'
      }
      if (e < 12 && earthLandAmount(lat, lon) < 0.9) biome = Math.abs(lat) > 60 ? 'snowyBeach' : 'beach'
    }
  }
  // Down to the city's ground near its edge.
  const k = smooth((d - 3) / 40)
  h = Math.round(lerp(-1, h, k))
  if (k < 1) w = SEA
  return { h, c: e < 0 ? -0.5 : 0.3, T, H, m, river, d, biome, w }
}

function pickBiome(x, z, h, c, T, H, m, river, wet) {
  if (wet > 0.5 && h >= SEA - 1) return fbm(x, z, 1 / 180, 2, 89) > 0 ? 'mangroveSwamp' : 'swamp'
  if (h < SEA) {
    if (river) return 'river'
    if (T < -0.4) return 'frozenOcean'
    if (T > 0.4) return 'warmOcean'
    return h < SEA - 9 ? 'deepOcean' : 'ocean'
  }
  if (h <= SEA + 1 && c < -0.1) return T < -0.4 ? 'snowyBeach' : 'beach'
  if (m > 0.3) return h >= 34 ? 'snowyPeaks' : 'mountains'
  if (c < 0.05 && fbm(x, z, 1 / 260, 2, 71) > 0.3) return 'mushroomFields'
  if (T < -0.4) {
    if (H > 0.05) return 'snowyTaiga'
    return fbm(x, z, 1 / 160, 2, 73) > 0.12 ? 'iceSpikes' : 'snowyPlains'
  }
  if (T < -0.12) return H > -0.08 ? 'taiga' : 'plains'
  if (T < 0.22) {
    if (H > 0.3) return 'darkForest'
    if (H > 0.08) return fbm(x, z, 1 / 200, 2, 79) > 0.05 ? 'birchForest' : 'forest'
    if (H > -0.15 && fbm(x, z, 1 / 220, 2, 83) > 0.12) return 'cherryGrove'
    return 'plains'
  }
  if (T < 0.45) {
    if (H > 0.08) return 'forest'
    if (H < -0.15) return 'savanna'
    return 'plains'
  }
  if (H > 0.22) return fbm(x, z, 1 / 150, 2, 97) > 0.1 ? 'bambooJungle' : 'jungle'
  if (H > 0) return 'savanna'
  if (H > -0.22) return 'desert'
  return 'badlands'
}

// The top block of a cell, and what's under it.
const BANDS = ['orangeterracotta', 'terracotta', 'yellowterracotta', 'terracotta', 'brownterracotta', 'redterracotta', 'orangeterracotta', 'whiteterracotta', 'lightgrayterracotta', 'terracotta']

export function surface(s, x, z) {
  const r = hash2(x, z, 131)
  const y = s.h
  switch (s.biome) {
    case 'ocean': return { top: r < 0.25 ? 'clay' : r < 0.6 ? 'gravel' : 'sand', under: 'gravel' }
    case 'deepOcean': return { top: r < 0.15 ? 'clay' : 'gravel', under: 'gravel' }
    case 'frozenOcean': return { top: 'gravel', under: 'gravel' }
    case 'warmOcean': return { top: 'sand', under: 'sand' }
    case 'river': return { top: r < 0.3 ? 'gravel' : r < 0.45 ? 'clay' : 'sand', under: 'sand' }
    case 'beach': return { top: 'sand', under: 'sand', deep: 'sandstone' }
    case 'snowyBeach': return { top: 'snow', under: 'sand', deep: 'sandstone' }
    case 'desert': return { top: 'sand', under: 'sand', deep: 'sandstone' }
    case 'badlands': return { top: r < 0.85 ? 'redsand' : 'coarsedirt', under: 'band' }
    case 'savanna': return { top: r < 0.18 ? 'coarsedirt' : 'grass', under: 'dirt' }
    case 'taiga': return { top: r < 0.3 ? 'podzol' : r < 0.36 ? 'coarsedirt' : 'grass', under: 'dirt' }
    case 'snowyTaiga':
    case 'snowyPlains': return { top: 'snow', under: 'dirt' }
    case 'iceSpikes': return { top: r < 0.2 ? 'packedice' : 'snow', under: 'snow' }
    case 'swamp': return { top: r < 0.25 ? 'mud' : r < 0.32 ? 'moss' : 'grass', under: 'dirt' }
    case 'mangroveSwamp': return { top: r < 0.75 ? 'mud' : 'rooteddirt', under: 'mud' }
    case 'mushroomFields': return { top: 'mycelium', under: 'dirt' }
    case 'jungle':
    case 'bambooJungle': return { top: r < 0.12 ? 'moss' : r < 0.18 ? 'podzol' : 'grass', under: 'dirt' }
    case 'darkForest': return { top: r < 0.12 ? 'podzol' : r < 0.2 ? 'moss' : 'grass', under: 'dirt' }
    case 'mountains':
      if (y >= 26) return { top: r < 0.5 ? 'snow' : 'stone', under: 'stone' }
      if (y >= 14) return { top: r < 0.15 ? 'gravel' : r < 0.3 ? 'andesite' : r < 0.55 ? 'grass' : 'stone', under: 'stone' }
      return { top: r < 0.1 ? 'gravel' : 'grass', under: 'dirt' }
    case 'snowyPeaks':
      if (y >= 40) return { top: r < 0.4 ? 'packedice' : 'snow', under: 'snow' }
      return { top: r < 0.75 ? 'snow' : 'calcite', under: 'stone' }
    default: return { top: 'grass', under: 'dirt' }
  }
}

function groundBlock(layer, x, y, z, under) {
  if (layer === 0) return null
  if (under === 'band') return BANDS[((y % BANDS.length) + BANDS.length) % BANDS.length]
  if (layer <= 3) return under
  if (layer <= 6 && under === 'sand') return 'sandstone'
  // The same layers and ores as the rock under it (Underground.js).
  return rockAt(x, y, z)
}

// y of the lowest cell a land column stores at (x, z): its own top two
// below the surface, deeper on a slope so cliff sides stay closed. Below
// it is the underground's rock (Underground.js).
function bottomFrom(h, lowest) {
  return Math.min(lowest - 1, h - 2)
}

// --- features: trees, cacti, spikes, mushrooms, coral ---

// One possible feature per GRID x GRID square, at a jittered spot.
const GRID = 5
const FEATURE_REACH = 6

const FEATURES = {
  plains: [[0.05, 'oak'], [0.02, 'pumpkin'], [0.015, 'hay'], [0.01, 'boulder']],
  forest: [[0.75, 'oak'], [0.08, 'birch']],
  birchForest: [[0.75, 'birch']],
  darkForest: [[0.85, 'darkOak'], [0.06, 'redMushroom'], [0.05, 'brownMushroom']],
  cherryGrove: [[0.5, 'cherry']],
  taiga: [[0.65, 'spruce'], [0.03, 'boulder']],
  snowyTaiga: [[0.55, 'spruce']],
  snowyPlains: [[0.04, 'spruce']],
  iceSpikes: [[0.35, 'iceSpike']],
  desert: [[0.22, 'cactus']],
  savanna: [[0.2, 'acacia']],
  badlands: [[0.05, 'cactus']],
  jungle: [[0.55, 'jungleBig'], [0.3, 'jungle'], [0.06, 'melon']],
  bambooJungle: [[0.7, 'bamboo'], [0.2, 'jungle']],
  swamp: [[0.3, 'swampOak']],
  mangroveSwamp: [[0.55, 'mangrove']],
  mushroomFields: [[0.25, 'redMushroom'], [0.2, 'brownMushroom']],
  mountains: [[0.06, 'spruce'], [0.05, 'boulder']],
  warmOcean: [[0.65, 'coral']],
}

// Thin coral plants and seagrass (BuildMode `plant` blocks, 2026-10-26:
// whole coral blocks looked too chunky); seagrass listed twice so it's
// the commonest.
const CORALS = ['tubecoral', 'braincoral', 'bubblecoral', 'firecoral', 'horncoral', 'seagrass', 'seagrass']

// --- the big map's tile pictures (shared with MapTileWorker.js) ---

const shadeColor = (c, k) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)

// A spot's colour from its land (s = sampleLand): water by its sea, land by
// its top block (a dirt track's when onPath), shaded by height.
export function groundColor(s, x, z, onPath, typeColor) {
  if (s.h < s.w) return s.biome === 'frozenOcean' ? 0xb5d3f0 : s.biome === 'warmOcean' ? 0x3fb6c8 : s.h < SEA - 9 ? 0x1f4f9a : 0x3368c6
  return shadeColor(typeColor(onPath ? 'dirtpath' : surface(s, x, z).top), 0.72 + 0.28 * clamp01((s.h + 6) / 40))
}

// A built thing's colour (a house's roof...), shaded by its height.
export const builtColor = (c, y) => shadeColor(c, 0.72 + 0.28 * clamp01((y + 6) / 40))

// The pixels (RGBA, S x S) of tile (tx, tz) of T cells. cell(x, z, out)
// fills out.c (colour, -1 = city: left see-through), out.h (height) and
// out.wet (0 land, 1 water, 2 built/path).
// Looks like a real map, not blocks (2026-10-26, Gaymi: "make it not so
// blocky more realistic type map"): each spot's colour is softened with
// its 8 neighbours (no single-block speckle), and hills are lit from the
// top-left like a relief map - slopes facing the light brighter, the
// far sides darker. The big map then draws the tiles smoothly.
export function tilePixels(tx, tz, T, S, cell) {
  const step = T / S
  const px = new Uint8ClampedArray(S * S * 4)
  // Colours and heights one ring wider than the tile, so blending and
  // shading match across tile edges.
  const W = S + 2
  const col = new Int32Array(W * W).fill(-1)
  const hgt = new Float32Array(W * W)
  const wet = new Uint8Array(W * W)
  const out = { c: -1, h: 0, wet: 0 }
  for (let i = -1; i <= S; i++) {
    for (let j = -1; j <= S; j++) {
      cell(tx * T + Math.floor(i * step + step / 2), tz * T + Math.floor(j * step + step / 2), out)
      if (out.c < 0) continue
      const g = (j + 1) * W + i + 1
      col[g] = out.c
      hgt[g] = out.h
      wet[g] = out.wet
    }
  }
  // Relief: height change per map pixel in blocks, scaled so a gentle
  // hill shows and a cliff doesn't go black.
  const relief = Math.min(1, 1.6 / step)
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < S; j++) {
      const g = (j + 1) * W + i + 1
      if (col[g] < 0) continue
      let r = 0
      let gg = 0
      let b = 0
      let n = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const q = g + dj * W + di
          // Land, water and built things (houses, paths) aren't blended
          // into each other: shores and roads stay clean lines.
          if (col[q] < 0 || wet[q] !== wet[g]) continue
          // The spot itself counts most, so the map stays sharp.
          const w = di || dj ? 1 : 6
          r += ((col[q] >> 16) & 255) * w
          gg += ((col[q] >> 8) & 255) * w
          b += (col[q] & 255) * w
          n += w
        }
      }
      let shade = 1
      if (wet[g] !== 1) {
        const dx = (hgt[g + 1] - hgt[g - 1]) * relief
        const dz = (hgt[g + W] - hgt[g - W]) * relief
        shade = Math.max(0.6, Math.min(1.3, 1 - (dx + dz) * 0.07))
      }
      const o = (j * S + i) * 4
      px[o] = (r / n) * shade
      px[o + 1] = (gg / n) * shade
      px[o + 2] = (b / n) * shade
      px[o + 3] = 255
    }
  }
  return px
}

export class OpenWorld {
  constructor(bm) {
    this.bm = bm
    this.active = false
    this.columns = new Map() // "cx,cz" -> { keys: [] }
    this.terrainKeys = new Set()
    this.removed = new Set()
    this.edited = new Set() // column keys the player changed
    this.version = 0
    this._paths = null
    this._tiles = new Map()
    this._generating = false
    this._plans = new Map() // "gx,gz" -> a village/castle/bridge plan or null
    // Real-world landmarks from the spawn map (addLandmark), this game only.
    this._landmarks = []
    this.under = new Underground(this)
    this.heaven = new HeavenRealm(this)
    // (For tests and tools: where the Heaven's Peaks are.)
    this.peakIn = peakIn
    this.sea = SEA
  }

  // Map 1 (or a map made from it) was just loaded: the world comes on,
  // with a fresh random seed unless one is given.
  start(seed = randomSeed()) {
    // Reloaded over itself (Reset Map): the old land goes first.
    this._dropAll()
    this.reset()
    this.active = true
    this._plans.clear()
    this._landmarks = []
    this._paths = null
    setWorldSeed(seed)
  }

  // A new game on the same city: all the land goes and grows back from
  // another seed (the city and its saved edits stay).
  // World Map mode on/off (setEarthWorld): everything grown so far goes.
  // The real heights/rivers load the first time (EarthTerrain.js); any
  // land grown from the noise before they arrived grows again from them
  // (same seed - before you're placed on the map, see BuildSurvival).
  setEarth(on) {
    if (on) {
      loadEarthTerrain().then((ok) => {
        if (ok && isEarthWorld() && this.active && this.columns.size) this.reseed(worldSeed())
      })
    }
    if (isEarthWorld() === !!on) return
    setEarthWorld(on)
    if (this.active) this.reseed()
  }

  reseed(seed = randomSeed()) {
    if (!this.active) return
    this._dropAll()
    this.removed.clear()
    this.edited.clear()
    this._clearTiles()
    this._coarseTiles = null
    this._plans.clear()
    this._landmarks = []
    setWorldSeed(seed)
    this.version++
  }

  _dropAll() {
    this.under.dropAll()
    this.heaven.dropAll()
    for (const [key, col] of [...this.columns]) this._unload(key, col)
    // Anything built out in the land goes with it.
    const bm = this.bm
    const was = bm._suppressUndoRecording
    bm._suppressUndoRecording = true
    try {
      for (const key of [...bm._blocks.keys()]) {
        const [x, y, z] = key.split(',').map(Number)
        if (inCity(x, z) || !bm._blocks.has(key)) continue
        bm.liquids?.levels.delete(key)
        bm._removeBlockInner(x, y, z)
      }
    } finally {
      bm._suppressUndoRecording = was
    }
  }

  // The city's blocks are in. gates: where its roads leave it
  // (Map3Generator.js) - each carries on as a dirt track.
  cityLoaded(gates = []) {
    this._paths = this._findPaths(gates)
    this._clearTiles()
  }

  reset() {
    this.active = false
    this.under.chunks.clear()
    this.under._entrances.clear()
    this.heaven.cols.clear()
    this.columns.clear()
    this.terrainKeys.clear()
    this.removed.clear()
    this.edited.clear()
    this._clearTiles()
    this.version++
  }

  _colKeyOfCell(x, z) {
    return `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`
  }

  isTerrain(key) {
    return this.terrainKeys.has(key)
  }

  // A player change (place or break) at a cell. Under the city too: its
  // rock is terrain like the land's (Underground.js).
  touched(x, y, z, key, removing) {
    if (!this.active || this._generating) return
    const city = inCity(x, z)
    if (!city) this.edited.add(this._colKeyOfCell(x, z))
    if (!removing) return
    if (this.terrainKeys.has(key)) {
      this.terrainKeys.delete(key)
      this.removed.add(key)
    }
    // The rock around the hole becomes real (never a see-through hole).
    this.under.reveal(x, y, z)
  }

  // The land at a cell (null in the city).
  landAt(x, z) {
    return inCity(x, z) ? null : sampleLand(x, z)
  }

  // bottomFrom for one cell, worked out from the noise.
  bottomOf(x, z) {
    if (inCity(x, z)) return -1
    const h = (a, b) => (inCity(a, b) ? -1 : sampleLand(a, b).h)
    const here = h(x, z)
    return bottomFrom(here, Math.min(here, h(x - 1, z), h(x + 1, z), h(x, z - 1), h(x, z + 1)))
  }

  // How far out terrain is grown right now.
  radius() {
    const view = this.bm.viewDistance()
    const r = Number.isFinite(view) ? view + CHUNK : MAX_RADIUS
    return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, r))
  }

  // Grows the columns nearest the given points (blocks) and drops far
  // ones. Called every frame while the map is open. share (0..1) shrinks
  // the time slice on a slow device (BuildMode.workShare).
  update(points, share = 1) {
    if (!this.active || !points.length) return
    const r = this.radius()
    const rc = Math.ceil(r / CHUNK)
    // The column you stand in (and its neighbors) always exists, so you
    // never fall through land that hasn't grown yet.
    for (const p of points) {
      const pcx = Math.floor(p.x / CHUNK)
      const pcz = Math.floor(p.z / CHUNK)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this._ensure(pcx + dx, pcz + dz)
    }
    const until = performance.now() + GEN_BUDGET_MS * share
    // Plan one place ahead per frame (a castle takes a few milliseconds),
    // so the columns that need it later don't wait on it.
    if (!FLAT) this._prefetchPlan(points, r + STRUCT_GRID)
    const wanted = []
    for (const p of points) {
      const pcx = Math.floor(p.x / CHUNK)
      const pcz = Math.floor(p.z / CHUNK)
      for (let dx = -rc; dx <= rc; dx++) {
        for (let dz = -rc; dz <= rc; dz++) {
          const cx = pcx + dx
          const cz = pcz + dz
          if (this.columns.has(`${cx},${cz}`) || this._isCityColumn(cx, cz)) continue
          const ex = Math.max(0, Math.abs((cx + 0.5) * CHUNK - p.x) - CHUNK / 2)
          const ez = Math.max(0, Math.abs((cz + 0.5) * CHUNK - p.z) - CHUNK / 2)
          const dist = Math.hypot(ex, ez)
          if (dist <= r) wanted.push([dist, cx, cz])
        }
      }
    }
    wanted.sort((a, b) => a[0] - b[0])
    for (const [, cx, cz] of wanted) {
      if (performance.now() > until) break
      this._ensure(cx, cz)
    }
    // Cave walls around you (the first point is always you or the camera).
    this.under.update(points[0])
    // Heaven's clouds and islands while you're up high (HeavenRealm.js).
    this.heaven.update(points[0])
    // Drop columns well past every point (the player's own changes stay).
    if ((this._unloadTick = (this._unloadTick || 0) + 1) % 30 === 0) {
      const far = r + UNLOAD_MARGIN
      for (const [key, col] of this.columns) {
        if (this.edited.has(key)) continue
        const near = points.some((p) => Math.hypot((col.cx + 0.5) * CHUNK - p.x, (col.cz + 0.5) * CHUNK - p.z) < far + CHUNK)
        if (!near) this._unload(key, col)
      }
    }
  }

  _isCityColumn(cx, cz) {
    if (FLAT) return cx >= -FLAT_HALF / CHUNK && cx < FLAT_HALF / CHUNK && cz >= -FLAT_HALF / CHUNK && cz < FLAT_HALF / CHUNK
    return FULL_CITY_COLUMNS.has(`${cx},${cz}`)
  }

  _ensure(cx, cz) {
    const key = `${cx},${cz}`
    if (this.columns.has(key) || this._isCityColumn(cx, cz)) return
    if (Math.abs(cx * CHUNK) > WORLD_LIMIT || Math.abs(cz * CHUNK) > WORLD_LIMIT) return
    this._generate(cx, cz)
  }

  // Grows one column: ground, water, then whatever features reach into it.
  _generate(cx, cz) {
    const bm = this.bm
    const x0 = cx * CHUNK
    const z0 = cz * CHUNK
    const col = { cx, cz, keys: [], minY: Infinity, maxY: -Infinity, bottoms: new Int16Array(CHUNK * CHUNK).fill(-1) }
    this.columns.set(`${cx},${cz}`, col)
    // Heights for the column plus a one-cell border (for cliff sides).
    const W = CHUNK + 2
    const samples = new Array(W * W)
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < W; j++) {
        const x = x0 - 1 + i
        const z = z0 - 1 + j
        samples[i * W + j] = inCity(x, z) ? { h: -1, biome: 'plains', city: true } : sampleLand(x, z)
      }
    }
    const occupied = (k) => bm._blocks.has(k)
    // Cave entrances reaching into this column (Underground.js): their
    // open air stays open.
    const entrances = FLAT ? [] : this.under.entrancesForColumn(cx, cz)
    const put = (x, y, z, type) => {
      const k = `${x},${y},${z}`
      if (this.removed.has(k) || occupied(k)) return false
      if (entrances.length && this.under.entranceAir(entrances, x, y, z)) return false
      bm._setTerrainBlock(k, x, y, z, type)
      this.terrainKeys.add(k)
      col.keys.push(k)
      if (y < col.minY) col.minY = y
      if (y > col.maxY) col.maxY = y
      return true
    }
    this._generating = true
    try {
      // Villages, castles and bridges first (WorldStructures.js): the
      // ground and water then fill in around them.
      const pathTops = new Map()
      for (const plan of FLAT ? [] : this._plansOver(x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1)) {
        const list = plan.byColumn.get(`${cx},${cz}`)
        if (list) {
          for (let i = 0; i < list.length; i += 4) {
            if (!inCity(list[i], list[i + 2])) put(list[i], list[i + 1], list[i + 2], list[i + 3])
          }
        }
        for (const [k, type] of plan.paths) pathTops.set(k, type)
      }
      for (let i = 1; i <= CHUNK; i++) {
        for (let j = 1; j <= CHUNK; j++) {
          const s = samples[i * W + j]
          if (s.city) continue
          const x = x0 - 1 + i
          const z = z0 - 1 + j
          const lowest = Math.min(s.h, samples[(i - 1) * W + j].h, samples[(i + 1) * W + j].h, samples[i * W + j - 1].h, samples[i * W + j + 1].h)
          const bottom = FLAT ? s.h : bottomFrom(s.h, lowest)
          col.bottoms[(i - 1) * CHUNK + (j - 1)] = bottom
          let { top, under, deep } = surface(s, x, z)
          const onTrack = this._onPath(x, z)
          if (s.h >= s.w) top = this._roadTop(x, z, top, pathTops)
          for (let y = s.h; y >= bottom; y--) {
            const layer = s.h - y
            let type = layer === 0 ? top : groundBlock(layer, x, y, z, under)
            if (layer > 0 && deep && layer > 2 && layer <= 6) type = deep
            put(x, y, z, type)
          }
          // Water up to sea level, or a real lake's or river's level
          // (frozen oceans freeze over).
          if (s.h < s.w) {
            for (let y = s.h + 1; y <= s.w; y++) {
              const frozen = s.biome === 'frozenOcean' && y === s.w
              // A track from the city crosses water on a plank deck.
              if (onTrack && y === s.w) put(x, y, z, 'spruceplanks')
              else put(x, y, z, frozen ? (hash2(x, z, 157) < 0.3 ? 'packedice' : 'ice') : 'water')
            }
          }
        }
      }
      if (!FLAT) this._features(x0, z0, put)
      if (entrances.length) this.under.columnGrown(cx, cz, entrances)
    } finally {
      this._generating = false
    }
    // Rebuild this column's chunks, and the neighbors' whose border faces
    // it now covers - soon, nearest first, not all this frame.
    if (col.keys.length) {
      const cy0 = Math.floor(col.minY / CHUNK) - 1
      const cy1 = Math.floor(col.maxY / CHUNK) + 1
      for (let cy = cy0; cy <= cy1; cy++) {
        bm._chunks.markLazy(`${cx},${cy},${cz}`)
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (this.columns.has(`${cx + dx},${cz + dz}`)) bm._chunks.markLazy(`${cx + dx},${cy},${cz + dz}`)
        }
      }
    }
    this.version++
  }

  _unload(key, col) {
    const bm = this.bm
    this.under.columnDropped(col.cx, col.cz)
    for (const k of col.keys) {
      if (!this.terrainKeys.has(k)) continue
      this.terrainKeys.delete(k)
      bm._dropTerrainBlock(k)
    }
    // Nothing of it is left to rebuild.
    for (let cy = Math.floor(col.minY / CHUNK) - 1; cy <= Math.floor(col.maxY / CHUNK) + 1; cy++) {
      const ck = `${col.cx},${cy},${col.cz}`
      if (!bm._chunkCells.has(ck)) bm._chunks.dropChunk(ck)
    }
    this.columns.delete(key)
    this.version++
  }

  // Every feature whose spot is near this column, drawn only where it
  // lands inside it (so each column grows on its own and still matches
  // its neighbors).
  _features(x0, z0, put) {
    const x1 = x0 + CHUNK - 1
    const z1 = z0 + CHUNK - 1
    const inside = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1
    const set = (x, y, z, type) => {
      if (inside(x, z) && !inCity(x, z)) put(x, y, z, type)
    }
    const gx0 = Math.floor((x0 - FEATURE_REACH) / GRID)
    const gx1 = Math.floor((x1 + FEATURE_REACH) / GRID)
    const gz0 = Math.floor((z0 - FEATURE_REACH) / GRID)
    const gz1 = Math.floor((z1 + FEATURE_REACH) / GRID)
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const fx = gx * GRID + Math.floor(hash2(gx, gz, 211) * GRID)
        const fz = gz * GRID + Math.floor(hash2(gx, gz, 223) * GRID)
        if (inCity(fx, fz)) continue
        const s = sampleLand(fx, fz)
        if (s.d < 5 || this._claimed(fx, fz) || this.under.nearEntrance(fx, fz)) continue
        const list = FEATURES[s.biome]
        if (!list) continue
        let roll = hash2(gx, gz, 227)
        let kind = null
        for (const [chance, k] of list) {
          if (roll < chance) {
            kind = k
            break
          }
          roll -= chance
        }
        if (!kind) continue
        if (kind !== 'coral' && (s.h < s.w || this._nearPath(fx, fz))) continue
        const rnd = (n) => hash2(gx * 7 + n, gz * 13 - n, 239 + n)
        this._feature(kind, fx, s.h + 1, fz, rnd, set, inside)
      }
    }
  }

  _feature(kind, x, y, z, rnd, set, inside) {
    const blob = (cx, cy, cz, r, type, squash = 1) => {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + (dy * dy) / (squash * squash) + dz * dz <= r * r + 0.5) set(cx + dx, cy + dy, cz + dz, type)
      }
    }
    const disc = (cx, cy, cz, r, type, cornerCut = true) => {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (cornerCut && Math.abs(dx) === r && Math.abs(dz) === r) continue
        set(cx + dx, cy, cz + dz, type)
      }
    }
    // Down to the ground under a column (the feature's own spot is at y,
    // but on a slope the cells beside it can be lower - a wide trunk or a
    // root there used to hang in the air).
    const toGround = (cx, cz, from, type) => {
      const g = sampleLand(cx, cz).h
      for (let k = Math.max(g + 1, from - 12); k < from; k++) set(cx, k, cz, type)
    }
    const trunk = (h, type, w = 1) => {
      for (let a = 0; a < w; a++) {
        for (let b = 0; b < w; b++) {
          toGround(x + a, z + b, y, type)
          for (let i = 0; i < h; i++) set(x + a, y + i, z + b, type)
        }
      }
    }
    // Each tree its own kind of leaves (2026-10-16).
    const leaf = { birch: 'birchleaves', spruce: 'spruceleaves', jungle: 'jungleleaves', jungleBig: 'jungleleaves', mangrove: 'mangroveleaves' }[kind] || 'leaves'
    switch (kind) {
      case 'oak':
      case 'birch':
      case 'swampOak': {
        const h = (kind === 'birch' ? 5 : 4) + Math.floor(rnd(1) * 3)
        const log = kind === 'birch' ? 'birchlog' : 'oaklog'
        trunk(h, log)
        disc(x, y + h - 2, z, 2, leaf)
        disc(x, y + h - 1, z, 2, leaf)
        disc(x, y + h, z, 1, leaf, false)
        disc(x, y + h + 1, z, 1, leaf)
        if (kind === 'swampOak') disc(x, y + h - 3, z, 3, leaf)
        break
      }
      case 'spruce': {
        const h = 6 + Math.floor(rnd(1) * 5)
        trunk(h, 'sprucelog')
        set(x, y + h, z, leaf)
        set(x, y + h + 1, z, leaf)
        // Tiers widening downward: 1, 1, 2, 1, 3, 2, 3, 2...
        for (let i = h - 1, n = 0; i >= 2; i--, n++) {
          const r = Math.max(1, Math.min(3, 1 + Math.floor(n / 2)) - (n % 2))
          disc(x, y + i, z, r, leaf, r > 1)
        }
        break
      }
      case 'darkOak': {
        const h = 5 + Math.floor(rnd(1) * 3)
        trunk(h, 'darkoaklog', 2)
        for (let i = 0; i < 2; i++) disc(x, y + h - 1 + i, z, 4 - i, leaf)
        disc(x + 1, y + h + 1, z + 1, 2, leaf)
        break
      }
      case 'cherry': {
        const h = 5 + Math.floor(rnd(1) * 2)
        const dir = rnd(2) < 0.5 ? 1 : -1
        trunk(h, 'cherrylog')
        set(x + dir, y + h - 1, z, 'cherrylog')
        set(x + dir * 2, y + h, z, 'cherrylog')
        blob(x + dir, y + h + 1, z, 3, 'cherryleaves', 0.6)
        break
      }
      case 'acacia': {
        const dx = rnd(1) < 0.5 ? 1 : -1
        const dz = rnd(2) < 0.5 ? 1 : -1
        // The leaning trunk steps over one side at a time, so every log
        // sits face to face on the one below - nothing hangs in the air
        // joined only by a corner (2026-10-26, Gaymi: "nothing can be
        // floating").
        trunk(4, 'acacialog')
        set(x + dx, y + 3, z, 'acacialog')
        set(x + dx, y + 3, z + dz, 'acacialog')
        set(x + dx, y + 4, z + dz, 'acacialog')
        set(x + dx * 2, y + 4, z + dz, 'acacialog')
        set(x + dx * 2, y + 4, z + dz * 2, 'acacialog')
        disc(x + dx * 2, y + 5, z + dz * 2, 3, leaf)
        disc(x + dx * 2, y + 6, z + dz * 2, 1, leaf)
        break
      }
      case 'jungle': {
        const h = 5 + Math.floor(rnd(1) * 3)
        trunk(h, 'junglelog')
        disc(x, y + h - 1, z, 2, leaf)
        disc(x, y + h, z, 2, leaf)
        disc(x, y + h + 1, z, 1, leaf, false)
        break
      }
      case 'jungleBig': {
        const h = 11 + Math.floor(rnd(1) * 7)
        trunk(h, 'junglelog', 2)
        disc(x, y + h - 2, z, 4, leaf)
        disc(x, y + h - 1, z, 4, leaf)
        disc(x, y + h, z, 3, leaf)
        disc(x, y + h + 1, z, 2, leaf)
        // A few side branches with their own leaves.
        for (const [bx, bz, bi] of [[2, 0, 0.5], [-1, 2, 0.65]]) {
          const by = y + Math.floor(h * bi)
          set(x + bx, by, z + bz, 'junglelog')
          disc(x + bx, by + 1, z + bz, 1, leaf, false)
        }
        break
      }
      case 'mangrove': {
        const h = 6 + Math.floor(rnd(1) * 3)
        trunk(h, 'mangrovelog')
        // Roots arching up out of the mud.
        // Roots arching out of the trunk on each side and down into the mud.
        for (const [rx, rz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          set(x + rx, y + 2, z + rz, 'mangrovelog')
          set(x + rx, y + 1, z + rz, 'mangrovelog')
          toGround(x + rx * 2, z + rz * 2, y + 1, 'mangrovelog')
          set(x + rx * 2, y, z + rz * 2, 'mangrovelog')
        }
        blob(x, y + h, z, 2, leaf, 0.8)
        break
      }
      case 'redMushroom': {
        const h = 4 + Math.floor(rnd(1) * 3)
        trunk(h, 'calcite')
        disc(x, y + h, z, 2, 'redmushroomblock')
        disc(x, y + h + 1, z, 2, 'redmushroomblock')
        disc(x, y + h + 2, z, 1, 'redmushroomblock', false)
        break
      }
      case 'brownMushroom': {
        const h = 4 + Math.floor(rnd(1) * 3)
        trunk(h, 'calcite')
        disc(x, y + h, z, 3, 'brownmushroomblock')
        break
      }
      case 'cactus': {
        const h = 1 + Math.floor(rnd(1) * 3)
        trunk(h, 'cactus')
        break
      }
      case 'iceSpike': {
        const tall = rnd(1) < 0.2
        const h = tall ? 14 + Math.floor(rnd(2) * 10) : 4 + Math.floor(rnd(2) * 5)
        trunk(h, 'packedice')
        const base = tall ? Math.floor(h * 0.4) : 2
        for (let i = 0; i < base; i++) for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) set(x + ox, y + i, z + oz, 'packedice')
        if (tall) set(x, y + h, z, 'blueice')
        break
      }
      case 'bamboo': {
        for (let i = 0; i < 4; i++) {
          const bx = x + Math.floor(rnd(10 + i) * 5) - 2
          const bz = z + Math.floor(rnd(20 + i) * 5) - 2
          const s = sampleLand(bx, bz)
          if (s.h < s.w || s.biome !== 'bambooJungle') continue
          const h = 5 + Math.floor(rnd(30 + i) * 8)
          // Thin stalks (`inset` blocks) with a tuft of thin leaves on top.
          for (let k = 1; k <= h; k++) set(bx, s.h + k, bz, 'bamboo')
          set(bx, s.h + h + 1, bz, 'bambooleaves')
          set(bx, s.h + h + 2, bz, 'bambooleaves')
        }
        break
      }
      case 'melon':
        set(x, y, z, 'melon')
        break
      case 'pumpkin':
        set(x, y, z, 'pumpkin')
        break
      case 'hay':
        set(x, y, z, 'haybale')
        if (rnd(1) < 0.5) set(x + 1, y, z, 'haybale')
        break
      case 'boulder':
        blob(x, y, z, 1 + Math.floor(rnd(1) * 2), rnd(2) < 0.5 ? 'mossycobblestone' : 'cobblestone')
        break
      case 'coral': {
        // On the sea floor (y is one above it), never up out of the water.
        for (let i = 0; i < 8; i++) {
          const cx = x + Math.floor(rnd(40 + i) * 5) - 2
          const cz = z + Math.floor(rnd(50 + i) * 5) - 2
          const s = sampleLand(cx, cz)
          if (s.biome !== 'warmOcean') continue
          const type = CORALS[Math.floor(rnd(70 + i) * CORALS.length)]
          const h = type === 'seagrass' ? 1 : 1 + Math.floor(rnd(60 + i) * 2)
          for (let k = 1; k <= h && s.h + k < s.w; k++) this._replaceWater(cx, s.h + k, cz, type, set, inside)
        }
        break
      }
    }
  }

  // Coral grows where the water is: the water cell is swapped for it
  // (only while this column is being grown, so it's still terrain).
  _replaceWater(x, y, z, type, set, inside) {
    if (!inside(x, z)) return
    const bm = this.bm
    const k = `${x},${y},${z}`
    if (bm._blocks.get(k) === 'water' && this.terrainKeys.has(k)) {
      this.terrainKeys.delete(k)
      bm._dropTerrainBlock(k)
    }
    set(x, y, z, type)
  }

  // --- the dirt tracks out of the city's gates ---

  // Each gate (a road cell at the outline, and the way its road runs)
  // carries on straight out as a track, over the land only.
  _findPaths(gates) {
    const cells = new Set()
    for (const g of gates) {
      for (let s = 1; s <= PATH_LEN; s++) {
        const x = Math.floor(g.x + 0.5 + g.dx * s)
        const z = Math.floor(g.z + 0.5 + g.dz * s)
        if (!inCity(x, z)) cells.add(`${x},${z}`)
      }
    }
    return cells
  }

  // Roads blend into the land (2026-10-16, "make it blend naturally"): a
  // mix of dirt path, coarse dirt and a little gravel (sand and sandstone
  // for a desert village's streets) instead of one flat material, with a
  // frayed edge - some edge cells keep the land's own surface, and some of
  // the land just beside a road is worn to dirt.
  _roadTop(x, z, natural, pathTops) {
    const pathAt = (px, pz) => pathTops.get(`${px},${pz}`) || (this._onPath(px, pz) ? 'track' : null)
    const here = pathAt(x, z)
    const r = hash2(x, z, 151)
    const r2 = hash2(x, z, 163)
    if (here) {
      let edge = 0
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!pathAt(x + ox, z + oz)) edge++
      if (edge && r < 0.18 + edge * 0.08) return natural
      if (here === 'smoothsandstone') return r2 < 0.5 ? 'smoothsandstone' : r2 < 0.8 ? 'sandstone' : 'sand'
      if (here === 'coarsedirt') return r2 < 0.5 ? 'dirtpath' : r2 < 0.9 ? 'coarsedirt' : 'gravel'
      return r2 < 0.55 ? 'dirtpath' : r2 < 0.83 ? 'coarsedirt' : 'gravel'
    }
    if (r < 0.3 && (natural === 'grass' || natural === 'podzol' || natural === 'snow')) {
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (pathAt(x + ox, z + oz)) return r2 < 0.6 ? 'coarsedirt' : 'dirtpath'
      }
    }
    return natural
  }

  _onPath(x, z) {
    return !!this._paths?.has(`${x},${z}`)
  }

  _nearPath(x, z) {
    if (!this._paths?.size || cityDistance(x, z) > PATH_LEN + 3) return false
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (this._paths.has(`${x + dx},${z + dz}`)) return true
    return false
  }

  // --- villages, castles and bridges (WorldStructures.js) ---

  _plan(gx, gz) {
    const key = `${gx},${gz}`
    if (this._plans.has(key)) return this._plans.get(key)
    if (this._plans.size > 600) this._plans.clear()
    // A real lake or river above sea level counts as water too.
    const land = (x, z) => {
      const s = sampleLand(x, z)
      return s.w > SEA && s.h < s.w ? { ...s, h: SEA - 1 } : s
    }
    const plan = planStructure(gx, gz, { land, hash: hash2, sea: SEA, cityDistance, chunk: CHUNK })
    this._plans.set(key, plan)
    return plan
  }

  // A real landmark (Landmarks.js) centred on (x, z) - only where none of
  // its land has grown yet (it's stamped as the columns grow). Ordinary
  // places it overlaps give way to it. Returns the plan or null.
  addLandmark(kind, x, z, nameKey) {
    return this._addPlan(planLandmark(kind, Math.round(x), Math.round(z), { land: sampleLand, chunk: CHUNK }), nameKey)
  }

  // A real city's block town (Towns.js), the same way. name: shown as is.
  addTown(style, x, z, plazaR, cityName) {
    const plan = this._addPlan(planTown(style, Math.round(x), Math.round(z), plazaR, (Math.imul(Math.round(x), 73856093) ^ Math.round(z)) >>> 0, { land: sampleLand, chunk: CHUNK }), null)
    if (plan) plan.placeName = cityName
    return plan
  }

  _addPlan(plan, nameKey) {
    if (!plan) return null
    for (let cx = Math.floor(plan.x0 / CHUNK); cx <= Math.floor(plan.x1 / CHUNK); cx++) {
      for (let cz = Math.floor(plan.z0 / CHUNK); cz <= Math.floor(plan.z1 / CHUNK); cz++) if (this.columns.has(`${cx},${cz}`)) return null
    }
    plan.nameKey = nameKey
    this._landmarks.push(plan)
    return plan
  }

  // The map asks for the places in its view to be planned (one per call).
  prefetchPlansAround(x, z, reach) {
    this._prefetchPlan([{ x, z }], reach)
  }

  _prefetchPlan(points, reach) {
    for (const p of points) {
      const gx0 = Math.floor((p.x - reach) / STRUCT_GRID)
      const gx1 = Math.floor((p.x + reach) / STRUCT_GRID)
      const gz0 = Math.floor((p.z - reach) / STRUCT_GRID)
      const gz1 = Math.floor((p.z + reach) / STRUCT_GRID)
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          if (this._plans.has(`${gx},${gz}`)) continue
          this._plan(gx, gz)
          return
        }
      }
    }
  }

  // Every plan whose blocks reach into the box (cells), `margin` wider.
  _plansOver(x0, z0, x1, z1, margin = 0, cachedOnly = false) {
    const out = []
    const gx0 = Math.floor((x0 - margin) / STRUCT_GRID) - 1
    const gx1 = Math.floor((x1 + margin) / STRUCT_GRID) + 1
    const gz0 = Math.floor((z0 - margin) / STRUCT_GRID) - 1
    const gz1 = Math.floor((z1 + margin) / STRUCT_GRID) + 1
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const plan = cachedOnly ? this._plans.get(`${gx},${gz}`) : this._plan(gx, gz)
        if (!plan || !(plan.x1 >= x0 - margin && plan.x0 <= x1 + margin && plan.z1 >= z0 - margin && plan.z0 <= z1 + margin)) continue
        if (this._landmarks.some((l) => plan.x1 >= l.x0 - 4 && plan.x0 <= l.x1 + 4 && plan.z1 >= l.z0 - 4 && plan.z0 <= l.z1 + 4)) continue
        out.push(plan)
      }
    }
    for (const l of this._landmarks) if (l.x1 >= x0 - margin && l.x0 <= x1 + margin && l.z1 >= z0 - margin && l.z0 <= z1 + margin) out.push(l)
    return out
  }

  // Trees and boulders keep clear of a place (canopies reach 4 cells).
  _claimed(x, z) {
    return this._plansOver(x, z, x, z, 5).length > 0
  }

  // The place you stand in (its name, for the HUD), or ''.
  placeName(x, z) {
    if (!this.active || inCity(x, z)) return ''
    const plan = this._plansOver(x, z, x, z)[0]
    return plan ? plan.placeName || t(plan.nameKey || STRUCTURE_NAMES[plan.kind]) : ''
  }

  // Every place near (x, z): { kind, x, z } (tests, the minimap).
  placesNear(x, z, radius) {
    return this._plansOver(x - radius, z - radius, x + radius, z + radius).map((p) => ({ kind: p.kind, x: p.cx, z: p.cz }))
  }

  // --- minimap ---

  // A 32x32 picture of the land at tile (tx, tz) of T cells a side (one
  // sample every T / 32 cells - bigger tiles for a zoomed-out map, so a view
  // never needs more than about a hundred of them), drawn from the noise
  // (not the blocks), cached.
  // Returns { canvas, fresh }, or null when it isn't drawn yet and `build`
  // is false.
  mapTile(tx, tz, build = true, T = 32) {
    const key = `${T}:${tx},${tz}`
    const cached = this._tiles.get(key)
    if (cached) {
      cached.fresh = false
      return cached
    }
    if (!build) return null
    // Drawn in a worker: here once it's back (the map keeps redrawing
    // while a tile is missing).
    if (this._tileWorkersUp()) {
      this._requestTile(tx, tz, T)
      return null
    }
    return this._storeTile(key, this._drawTile(tx, tz, T, mapTileSamples(T)))
  }

  _storeTile(key, canvas) {
    // Oldest tiles go first (they used to be dropped all at once at 1200).
    this._tilePixels = (this._tilePixels || 0) + canvas.width * canvas.height
    if (this._tiles.size >= MAP_TILE_CACHE || this._tilePixels > MAP_TILE_PIXELS) {
      let drop = Math.ceil(this._tiles.size / 10)
      for (const [k, old] of this._tiles) {
        this._tiles.delete(k)
        this._tilePixels -= old.canvas.width * old.canvas.height
        if (--drop <= 0) break
      }
    }
    const entry = { canvas, fresh: true }
    this._tiles.set(key, entry)
    return entry
  }

  // Tile (tx, tz) of T cells made of the 4 (or 16) smaller tiles already
  // drawn inside it - zooming out shows them shrunk, as sharp as before,
  // instead of a blurry stand-in while the bigger tile is drawn. Returns
  // [[canvas, fx, fz, f], ...] (f = fraction of the tile each covers) or
  // null when any is missing.
  mapTileChildren(tx, tz, T) {
    for (let n = 2; n <= 4 && T / n >= 32; n *= 2) {
      const out = []
      for (let q = 0; q < n * n; q++) {
        const i = q % n
        const j = Math.floor(q / n)
        const c = this._tiles.get(`${T / n}:${tx * n + i},${tz * n + j}`)
        if (!c) break
        out.push([c.canvas, i / n, j / n, 1 / n])
      }
      if (out.length === n * n) return out
    }
    return null
  }

  // A new seed (or the real Earth's heights arriving) redraws the map, and
  // its drawing ahead starts over.
  _clearTiles() {
    // Tiles still being drawn are for the old land: dropped when they come.
    this._tileGen = (this._tileGen || 0) + 1
    this._tileJobs?.clear()
    for (const w of this._tileWorkers || []) w.busy = 0
    this._tiles.clear()
    this._tilePixels = 0
    this._prewarm = null
    this._earthPic = null
  }

  // World Map mode: the whole Earth as one picture, EARTH_PIC_RES pixels a
  // degree, coloured like the block map (same land, minus villages and
  // paths). Drawn a few rows at a time in the background once the real
  // heights are in; returns { canvas, done } (null outside the World Map
  // mode). The big map draws it under its tiles, so zooming never shows
  // squares filling in, and it's the globe's picture (2026-10-24, Gaymi:
  // "when scrolling out or in dont make it lag or those blocks are like
  // generating").
  earthPicture() {
    if (!this.active || !EARTH || !earthTerrainReady()) return null
    if (this._earthPic) return this._earthPic
    const W = 360 * EARTH_PIC_RES
    const H = 180 * EARTH_PIC_RES
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    const pic = { canvas, done: false, version: 0 }
    this._earthPic = pic
    const step = EARTH_DEG / EARTH_PIC_RES
    let row = 0
    const work = () => {
      if (this._earthPic !== pic || !this.active) return
      const until = performance.now() + EARTH_PIC_SLICE_MS
      while (row < H && performance.now() < until) {
        const img = ctx.createImageData(W, EARTH_PIC_ROWS)
        for (let j = 0; j < EARTH_PIC_ROWS; j++) {
          const z = Math.floor((row + j + 0.5) * step - 90 * EARTH_DEG)
          for (let i = 0; i < W; i++) {
            const c = this._landColor(Math.floor((i + 0.5) * step - 180 * EARTH_DEG), z)
            const o = (j * W + i) * 4
            img.data[o] = (c >> 16) & 255
            img.data[o + 1] = (c >> 8) & 255
            img.data[o + 2] = c & 255
            img.data[o + 3] = 255
          }
        }
        ctx.putImageData(img, 0, row)
        row += EARTH_PIC_ROWS
      }
      pic.version++
      if (row < H) setTimeout(work, EARTH_PIC_GAP_MS)
      else pic.done = true
    }
    setTimeout(work, EARTH_PIC_GAP_MS)
    return pic
  }

  // A spot's colour from the land alone (no villages/paths), shaded by
  // height like _cellColor.
  _landColor(x, z) {
    const s = sampleLand(x, z)
    let color
    if (s.h < s.w) color = s.biome === 'frozenOcean' ? 0xb5d3f0 : s.biome === 'warmOcean' ? 0x3fb6c8 : s.h < SEA - 9 ? 0x1f4f9a : 0x3368c6
    else color = this._typeColor(surface(s, x, z).top)
    const shade = s.h < s.w ? 1 : 0.72 + 0.28 * clamp01((s.h + 6) / 40)
    return (Math.round(((color >> 16) & 255) * shade) << 16) | (Math.round(((color >> 8) & 255) * shade) << 8) | Math.round((color & 255) * shade)
  }

  // A drawn bigger tile covering tile (tx, tz) of T cells: { canvas, sx,
  // sy, sw } (the piece of its picture), or null.
  mapTilePart(tx, tz, T) {
    for (let up = 2; up <= 16; up *= 2) {
      const big = this._tiles.get(`${T * up}:${Math.floor(tx / up)},${Math.floor(tz / up)}`)
      if (!big) continue
      const sw = big.canvas.width / up
      return { canvas: big.canvas, sx: (tx - Math.floor(tx / up) * up) * sw, sy: (tz - Math.floor(tz / up) * up) * sw, sw }
    }
    return null
  }

  // Draws the big map's tiles around (x, z) at every zoom out to `most`
  // cells across, a few milliseconds at a time in the background, once the
  // game has started (2026-10-24, Gaymi: "make the map not load when
  // scrolling make it fully load when youre in the game"). Biggest tiles
  // first, so any zoom has at least a stand-in (mapTilePart) early on.
  prewarmMap(x, z, most) {
    if (this._prewarm) return
    const queue = []
    let T = 32
    while (T * 10 < MAP_SPAN_OPEN) T *= 2
    const levels = []
    for (; T * 5 <= most; T *= 2) levels.push(T)
    for (const L of levels.reverse()) {
      const cx = Math.floor(x / L)
      const cz = Math.floor(z / L)
      const tiles = []
      for (let dx = -MAP_PREWARM_R; dx <= MAP_PREWARM_R; dx++) {
        for (let dz = -MAP_PREWARM_R; dz <= MAP_PREWARM_R; dz++) tiles.push([dx * dx + dz * dz, cx + dx, cz + dz])
      }
      tiles.sort((a, b) => a[0] - b[0])
      for (const [, tx, tz] of tiles) queue.push([tx, tz, L])
    }
    const job = { queue, i: 0 }
    this._prewarm = job
    const step = () => {
      if (this._prewarm !== job || !this.active) return
      const until = performance.now() + MAP_PREWARM_SLICE_MS
      const off = this._tileWorkersUp()
      while (job.i < queue.length && performance.now() < until) {
        const [tx, tz, L] = queue[job.i]
        // With workers: one job per worker at most, the rest left for the
        // tiles in view (BuildTryMode asks for those every draw).
        if (off) {
          if (!this._tiles.has(`${L}:${tx},${tz}`) && (this._tileJobs.size >= this._tileWorkers.length || !this._requestTile(tx, tz, L))) break
          job.i++
        } else {
          job.i++
          this.mapTile(tx, tz, true, L)
        }
      }
      if (job.i < queue.length) setTimeout(step, MAP_PREWARM_GAP_MS)
    }
    setTimeout(step, MAP_PREWARM_GAP_MS)
  }

  // The tile workers, started the first time a sharp tile is wanted; false
  // when there are none (no Worker support, or one failed) - tiles are
  // then drawn here, a few milliseconds' worth at a time, as before.
  _tileWorkersUp() {
    if (this._tileWorkers !== undefined) return !!this._tileWorkers
    this._tileWorkers = false
    if (typeof Worker === 'undefined' || typeof ImageData === 'undefined') return false
    try {
      const colors = this.bm.constructor.blockColorTable?.() || {}
      const workers = []
      for (let n = 0; n < MAP_TILE_WORKERS; n++) {
        const w = new Worker(new URL('./MapTileWorker.js', import.meta.url), { type: 'module' })
        w.busy = 0
        w.onmessage = (e) => this._tileDone(w, e.data)
        w.onerror = () => this._tileWorkersFailed()
        w.postMessage({ type: 'init', colors })
        workers.push(w)
      }
      this._tileWorkers = workers
      this._tileJobs = new Map() // tile key -> its job id
      this._tileJobId = 0
    } catch {
      this._tileWorkers = false
    }
    return !!this._tileWorkers
  }

  // Sharp tiles drawn in workers (BuildTryMode asks for them while moving).
  tilesOffThread() {
    return this._tileWorkersUp()
  }

  _tileWorkersFailed() {
    for (const w of this._tileWorkers || []) w.terminate()
    this._tileWorkers = false
    this._tileJobs = null
  }

  // Hands tile (tx, tz) of T cells to the least busy worker. False when
  // they're all full (asked again on a later draw); true once it's on its
  // way (or already was).
  _requestTile(tx, tz, T) {
    const key = `${T}:${tx},${tz}`
    if (this._tileJobs.has(key)) return true
    let w = null
    for (const o of this._tileWorkers) if (o.busy < MAP_TILE_JOBS && (!w || o.busy < w.busy)) w = o
    if (!w) return false
    const id = ++this._tileJobId
    this._tileJobs.set(key, id)
    w.busy++
    const S = mapTileSamples(T)
    const { built, paths, track } = this._tileOverlay(tx, tz, T, S)
    w.postMessage(
      { type: 'draw', id, gen: this._tileGen || 0, key, tx, tz, T, S, seed: worldSeed(), flat: isFlatWorld(), earth: isEarthWorld(), earthReady: isEarthWorld() && earthTerrainReady(), built, paths, track },
      [built.buffer, paths.buffer, track.buffer],
    )
    return true
  }

  _tileDone(w, d) {
    w.busy = Math.max(0, w.busy - 1)
    if (d.gen !== (this._tileGen || 0) || !this._tileJobs || this._tileJobs.get(d.key) !== d.id) return
    this._tileJobs.delete(d.key)
    // The worker couldn't draw this land (the real Earth's heights didn't
    // load there): this tile and the rest are drawn here instead.
    if (!d.pixels) {
      this._tileWorkersFailed()
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = d.S
    canvas.height = d.S
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.pixels), d.S, d.S), 0, 0)
    this._storeTile(d.key, canvas)
  }

  // What the worker can't work out from the noise: the planned villages',
  // castles' and landmarks' blocks and paths, and the city's dirt tracks,
  // at the tile's sample spots (one sample every T / S cells, and the ring
  // just outside it that tilePixels blends with), as flat
  // lists - built [x, z, y, colour (-1 water)], paths [x, z, colour],
  // track [x, z].
  _tileOverlay(tx, tz, T, S) {
    const step = T / S
    const x0 = tx * T
    const z0 = tz * T
    const built = []
    const paths = []
    const track = []
    const taken = new Set()
    // The sample spots' indexes around cell offset v (-1 .. S).
    const first = (v) => Math.max(-1, Math.ceil((v - step / 2) / step))
    const last = (v) => Math.min(S, Math.floor((v - step / 2) / step))
    for (const plan of this._plansOver(x0 - step, z0 - step, x0 + T + step, z0 + T + step, 0, true)) {
      for (let i = first(plan.x0 - x0 - 1); i <= last(plan.x1 - x0 + 1); i++) {
        const x = x0 + Math.floor(i * step + step / 2)
        if (x < plan.x0 || x > plan.x1) continue
        for (let j = first(plan.z0 - z0 - 1); j <= last(plan.z1 - z0 + 1); j++) {
          const z = z0 + Math.floor(j * step + step / 2)
          if (z < plan.z0 || z > plan.z1) continue
          const k = `${x},${z}`
          // The first plan over a spot is the one drawn (as _cellColor).
          if (taken.has(k)) continue
          taken.add(k)
          const b = plan.top?.get(k)
          if (b) built.push(x, z, b.y, b.type === 'water' ? -1 : this._typeColor(b.type))
          const p = plan.paths?.get(k)
          if (p) paths.push(x, z, this._typeColor(p))
        }
      }
    }
    if (this._paths?.size) {
      if (this._trackCells?.from !== this._paths) this._trackCells = { from: this._paths, cells: [...this._paths].map((k) => k.split(',').map(Number)) }
      for (const [x, z] of this._trackCells.cells) {
        const i = Math.round((x - x0 - step / 2) / step)
        const j = Math.round((z - z0 - step / 2) / step)
        if (i < -1 || j < -1 || i > S || j > S) continue
        if (x - x0 === Math.floor(i * step + step / 2) && z - z0 === Math.floor(j * step + step / 2)) track.push(x, z)
      }
    }
    return { built: new Int32Array(built), paths: new Int32Array(paths), track: new Int32Array(track) }
  }

  // A quick stand-in for a tile not drawn yet: 16x16 samples (256 reads
  // instead of up to 16384; 8x8 was a blur, 2026-10-26), so the big map never shows dark gaps while it's
  // dragged around (2026-10-13, "dont make it loading when moving it").
  // null when it isn't made yet and `build` is false.
  mapTileCoarse(tx, tz, T = 32, build = true) {
    const key = `${T}:${tx},${tz}`
    let tile = this._coarseTiles?.get(key)
    if (tile || !build) return tile || null
    if (!this._coarseTiles || this._coarseTiles.size > 6000) this._coarseTiles = new Map()
    tile = this._drawTile(tx, tz, T, 16)
    this._coarseTiles.set(key, tile)
    return tile
  }

  // A tile's picture drawn here on the main thread (the quick stand-ins,
  // and the sharp ones when there's no worker - _requestTile).
  _drawTile(tx, tz, T, S) {
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const px = tilePixels(tx, tz, T, S, (x, z, out) => {
      if (inCity(x, z)) {
        out.c = -1
        return
      }
      out.c = this._cellColor(x, z)
      out.h = this._lastMapH
      out.wet = this._lastMapWet
    })
    canvas.getContext('2d').putImageData(new ImageData(px, S, S), 0, 0)
    return canvas
  }

  // A cell's colour on the minimap, shaded by height.
  _cellColor(x, z) {
    // Only places already planned - planning one here (a castle takes
    // ~10ms) inside a tile made the map stutter; _prefetchPlan plans the
    // ones in view one per frame.
    const plan = this._plansOver(x, z, x, z, 0, true)[0]
    const built = plan?.top.get(`${x},${z}`)
    const s = sampleLand(x, z)
    // For _drawTile's relief shading and shores.
    this._lastMapH = built ? built.y : Math.max(s.h, s.w)
    this._lastMapWet = built ? 2 : s.h < s.w ? 1 : 0
    if (built && built.type !== 'water') return builtColor(this._typeColor(built.type), built.y)
    if (plan?.paths.has(`${x},${z}`) && s.h >= s.w) {
      this._lastMapWet = 2
      return this._typeColor(plan.paths.get(`${x},${z}`))
    }
    const onPath = s.h >= s.w && this._onPath(x, z)
    if (onPath) this._lastMapWet = 2
    return groundColor(s, x, z, onPath, (type) => this._typeColor(type))
  }

  _typeColor(type) {
    return this.bm.constructor.blockColor?.(type) ?? 0x55aa44
  }
}
