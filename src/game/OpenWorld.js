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
import { Underground, rockAt, setUnderSeed } from './Underground.js'

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
// Columns further than the generated radius plus this are dropped.
const UNLOAD_MARGIN = 48
// Time per frame spent growing new columns.
const GEN_BUDGET_MS = 4
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

function fbm(x, z, scale, octaves, seed) {
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

export const inCity = inCityShape

// The land at one cell: its surface height (the top block's y), biome and
// the few numbers the surface needs. Pure - the same cell always gives the
// same answer.
export function sampleLand(x, z) {
  const d = cityDistance(x, z)
  let c = fbm(x, z, 1 / 420, 3, 11)
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
  return { h, c, T, H, m, river, d, biome: pickBiome(x, z, h, c, T, H, m, river, wet) }
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

function surface(s, x, z) {
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

const CORALS = ['tubecoralblock', 'braincoralblock', 'bubblecoralblock', 'firecoralblock', 'horncoralblock']

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
    setWorldSeed(seed)
  }

  // A new game on the same city: all the land goes and grows back from
  // another seed (the city and its saved edits stay).
  reseed(seed = randomSeed()) {
    if (!this.active) return
    this._dropAll()
    this.removed.clear()
    this.edited.clear()
    this._tiles.clear()
    this._coarseTiles = null
    this._plans.clear()
    this._landmarks = []
    setWorldSeed(seed)
    this.version++
  }

  _dropAll() {
    this.under.dropAll()
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
    this._tiles.clear()
  }

  reset() {
    this.active = false
    this.under.chunks.clear()
    this.under._entrances.clear()
    this.columns.clear()
    this.terrainKeys.clear()
    this.removed.clear()
    this.edited.clear()
    this._tiles.clear()
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
  // ones. Called every frame while the map is open.
  update(points) {
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
    const until = performance.now() + GEN_BUDGET_MS
    // Plan one place ahead per frame (a castle takes a few milliseconds),
    // so the columns that need it later don't wait on it.
    this._prefetchPlan(points, r + STRUCT_GRID)
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
    const entrances = this.under.entrancesForColumn(cx, cz)
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
      for (const plan of this._plansOver(x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1)) {
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
          const bottom = bottomFrom(s.h, lowest)
          col.bottoms[(i - 1) * CHUNK + (j - 1)] = bottom
          let { top, under, deep } = surface(s, x, z)
          const onTrack = this._onPath(x, z)
          if (s.h >= SEA) top = this._roadTop(x, z, top, pathTops)
          for (let y = s.h; y >= bottom; y--) {
            const layer = s.h - y
            let type = layer === 0 ? top : groundBlock(layer, x, y, z, under)
            if (layer > 0 && deep && layer > 2 && layer <= 6) type = deep
            put(x, y, z, type)
          }
          // Water up to sea level (frozen oceans freeze over).
          if (s.h < SEA) {
            for (let y = s.h + 1; y <= SEA; y++) {
              const frozen = s.biome === 'frozenOcean' && y === SEA
              // A track from the city crosses water on a plank deck.
              if (onTrack && y === SEA) put(x, y, z, 'spruceplanks')
              else put(x, y, z, frozen ? (hash2(x, z, 157) < 0.3 ? 'packedice' : 'ice') : 'water')
            }
          }
        }
      }
      this._features(x0, z0, put)
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
        if (kind !== 'coral' && (s.h < SEA || this._nearPath(fx, fz))) continue
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
        trunk(3, 'acacialog')
        set(x + dx, y + 3, z + dz, 'acacialog')
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
          if (s.h < SEA || s.biome !== 'bambooJungle') continue
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
        for (let i = 0; i < 5; i++) {
          const cx = x + Math.floor(rnd(40 + i) * 5) - 2
          const cz = z + Math.floor(rnd(50 + i) * 5) - 2
          const s = sampleLand(cx, cz)
          if (s.biome !== 'warmOcean') continue
          const h = 1 + Math.floor(rnd(60 + i) * 3)
          const type = CORALS[Math.floor(rnd(70 + i) * CORALS.length)]
          for (let k = 1; k <= h && s.h + k < SEA; k++) this._replaceWater(cx, s.h + k, cz, type, set, inside)
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
    const plan = planStructure(gx, gz, { land: sampleLand, hash: hash2, sea: SEA, cityDistance, chunk: CHUNK })
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
    const canvas = this._drawTile(tx, tz, T, 32)
    if (this._tiles.size > 1200) this._tiles.clear()
    const entry = { canvas, fresh: true }
    this._tiles.set(key, entry)
    return entry
  }

  // A quick stand-in for a tile not drawn yet: 8x8 samples (64 reads
  // instead of 1024), so the big map never shows dark gaps while it's
  // dragged around (2026-10-13, "dont make it loading when moving it").
  // null when it isn't made yet and `build` is false.
  mapTileCoarse(tx, tz, T = 32, build = true) {
    const key = `${T}:${tx},${tz}`
    let tile = this._coarseTiles?.get(key)
    if (tile || !build) return tile || null
    if (!this._coarseTiles || this._coarseTiles.size > 6000) this._coarseTiles = new Map()
    tile = this._drawTile(tx, tz, T, 8)
    this._coarseTiles.set(key, tile)
    return tile
  }

  _drawTile(tx, tz, T, S) {
    const step = T / S
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(S, S)
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const x = tx * T + Math.floor(i * step + step / 2)
        const z = tz * T + Math.floor(j * step + step / 2)
        const o = (j * S + i) * 4
        if (inCity(x, z)) continue
        const color = this._cellColor(x, z)
        img.data[o] = (color >> 16) & 255
        img.data[o + 1] = (color >> 8) & 255
        img.data[o + 2] = color & 255
        img.data[o + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
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
    if (built && built.type !== 'water') {
      const c = this._typeColor(built.type)
      const k = 0.72 + 0.28 * clamp01((built.y + 6) / 40)
      return (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)
    }
    if (plan?.paths.has(`${x},${z}`) && s.h >= SEA) return this._typeColor(plan.paths.get(`${x},${z}`))
    let color
    if (s.h < SEA) color = s.biome === 'frozenOcean' ? 0xb5d3f0 : s.biome === 'warmOcean' ? 0x3fb6c8 : s.h < SEA - 9 ? 0x1f4f9a : 0x3368c6
    else color = this._typeColor(this._onPath(x, z) ? 'dirtpath' : surface(s, x, z).top)
    const shade = s.h < SEA ? 1 : 0.72 + 0.28 * clamp01((s.h + 6) / 40)
    return (Math.round(((color >> 16) & 255) * shade) << 16) | (Math.round(((color >> 8) & 255) * shade) << 8) | Math.round((color & 255) * shade)
  }

  _typeColor(type) {
    return this.bm.constructor.blockColor?.(type) ?? 0x55aa44
  }
}
