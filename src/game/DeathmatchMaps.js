// Deathmatch maps (2026-11-16, Gaymi: "make the death match bigger and
// more realistic ... we could make map names lets start with the small
// town streets"). Each map has a name (shown when the round starts and on
// the minimap), a size, spawn points, an uneven void edge and a build() that
// puts its blocks. Picked under Game Mode > Deathmatch (settings.dmMap);
// Small Town when nothing was picked.
//
// Small Town: 81 x 81 blocks (Gaymi picked "about 4x" the old 41 x 41).
// Two streets cross in the middle (asphalt, yellow lines, crosswalks,
// sidewalks, street lamps, parked cars and a bus); round them a General
// Store with an awning and a gas station, a church with a steeple, a
// timber cottage, a blue house with a porch, a two-storey brick house, a
// water tower, a Town Hall with a clock tower, a park with a statue, a
// diner with a tall sign, an adobe house, a farmhouse and a workshop with
// a catwalk. Roofs differ: thatch, shingles, slate, clay, flat.
//
// Military Base (2026-11-16, Gaymi picked it over warehouse/docks): same
// size. A helipad with a helicopter in the middle inside a gravel ring
// road; round it an HQ you can climb onto, a curved metal barracks, a
// two-storey wooden barracks, a shooting range, a bunker with a roof
// nest, a radar dish, a hangar with a tank, a fuel depot and a yard of
// shipping containers, four watchtowers and sandbag nests.
//
// The edge (2026-11-16, Gaymi: "make the border not just a square more
// irregular"): the play area bends in and out and its corners are cut.
// Past it is empty void (2026-11-16, replaced the wall/cliff/trees/water
// edge): fall off and you die and respawn.
//
// Coordinates are blocks round the arena's middle: x east, z south, y up
// from the floor (y 0 is the floor, people stand at y 1).

// [x, z, height of the floor under them]
const TOWN_SPAWNS = [
  [-26, -19, 0], [30, -31, 0], [-31, 30, 0], [19, 33, 0],
  [0, -34, 0], [0, 35, 0], [-34, 0, 0], [34, 0, 0],
  [-12, -24, 0], [12, -30, 0], [12, 29, 0], [-17, 14, 0], [27, 26, 0],
  [14, -11, 6], [-13, 16, 7],
]

const BASE_SPAWNS = [
  [-28, -11, 0], [-25, 10, 0], [-26, 34, 0], [-12, -37, 0], [12, -37, 0],
  [33, -18, 0], [31, 7, 0], [17, 38, 0], [-5, 18, 0], [6, -15, 0],
  [-15, 4, 0], [15, -4, 0], [-11, 12, 0], [11, -12, 0],
  [-3, -28, 9], [27, -2, 4],
]

export const DM_MAPS = {
  smallTown: {
    key: 'dmMapSmallTown',
    half: 40,
    wallH: 12,
    spawns: TOWN_SPAWNS,
    // Team Deathmatch: Red starts in the west half, Blue in the east.
    teamSpawns: {
      r: TOWN_SPAWNS.filter(([x]) => x < 0),
      b: TOWN_SPAWNS.filter(([x]) => x > 0),
    },
    // Where a stuck bot walks to instead: the streets.
    waypoints: [[0, 10], [0, -10], [10, 0], [-10, 0], [0, 30], [0, -30], [30, 0], [-30, 0]],
    // The edge: how far it comes in (waves round the middle) and where
    // the corners are cut; past it is void.
    edge: {
      base: 3,
      max: 8,
      waves: [[3, 3, 0.7], [2, 5, 2.1], [1, 7, 4]],
      corner: 68,
    },
    build: buildSmallTown,
  },
  militaryBase: {
    key: 'dmMapMilitaryBase',
    half: 40,
    wallH: 12,
    spawns: BASE_SPAWNS,
    teamSpawns: {
      r: BASE_SPAWNS.filter(([x]) => x < 0),
      b: BASE_SPAWNS.filter(([x]) => x > 0),
    },
    // The ring road round the helipad.
    waypoints: [[15, 0], [-15, 0], [0, 15], [0, -15], [15, 15], [-15, -15], [15, -15], [-15, 15]],
    edge: {
      base: 3,
      max: 8,
      waves: [[3, 2, 1.9], [2, 5, 0.3], [1.2, 6, 3.3]],
      corner: 69,
    },
    build: buildMilitaryBase,
  },
}

export const DM_MAP_IDS = Object.keys(DM_MAPS)
export const DEFAULT_DM_MAP = 'smallTown'

// A picked map id (settings.dmMap), or Small Town.
export function dmMapId(v) {
  return typeof v === 'string' && DM_MAPS[v] ? v : DEFAULT_DM_MAP
}

// --- the uneven edge ---

// A steady 0..1 number for a cell (the same every time and on every screen).
function hash(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function insetAt(e, a) {
  let v = e.base
  for (const [amp, k, p] of e.waves) v += amp * Math.sin(k * a + p)
  return Math.max(0, Math.min(e.max, v))
}

const _edgeCache = new Map()

// The edge as a grid over the whole square (the town-wall ring included,
// half + 1 out): 0 for the play area, else how many cells past it.
// { n, depth: Int16Array, at(x, z) }.
export function edgeGrid(map) {
  if (_edgeCache.has(map)) return _edgeCache.get(map)
  const e = map.edge
  const W = map.half + 1
  const n = 2 * W + 1
  const depth = new Int16Array(n * n).fill(-1)
  const queue = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i - W
      const z = j - W
      const a = Math.atan2(z, x)
      const out = Math.abs(x) === W || Math.abs(z) === W ||
        Math.max(Math.abs(x), Math.abs(z)) > map.half - insetAt(e, a) ||
        Math.abs(x) + Math.abs(z) > e.corner + 3 * Math.sin(4 * a + 1)
      if (!out) {
        depth[i * n + j] = 0
        queue.push(i * n + j)
      }
    }
  }
  // How far each edge cell is from the play area (steps across cells).
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]
    const i = Math.floor(c / n)
    const j = c % n
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di
      const nj = j + dj
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue
      const k = ni * n + nj
      if (depth[k] >= 0) continue
      depth[k] = depth[c] + 1
      queue.push(k)
    }
  }
  const grid = {
    n,
    depth,
    at: (x, z) => (Math.abs(x) > W || Math.abs(z) > W ? 99 : depth[(x + W) * n + (z + W)]),
  }
  _edgeCache.set(map, grid)
  return grid
}

// Inside the play area (not the edge).
export function inPlay(map, x, z) {
  return edgeGrid(map).at(x, z) === 0
}

// Puts the void round the play area: run after the map's own build, so
// it clears anything that strays past the edge. Every cell outside the
// play area is emptied, floor and all (2026-11-16, Gaymi: "outside the
// map should be empty void"), so the arena floats like an island with an
// uneven shore; walk off and you fall (PartyDeathmatch: a death).
export function buildEdge(map, b) {
  const g = edgeGrid(map)
  const W = map.half + 1
  const top = map.wallH + 5
  for (let x = -W; x <= W; x++) {
    for (let z = -W; z <= W; z++) {
      if (g.at(x, z) <= 0) continue
      for (let y = -3; y <= top; y++) b.put(x, y, z, 'air')
    }
  }
}

// --- building helpers ---

// A building: hollow walls with door and window gaps, a floor, a flat
// roof (and a low wall round it when people can get up there).
// doors: [side, offset along that side, width, height?]; sides n (low z),
// s (high z), w (low x), e (high x). windows: 'glass', 'open', null, or a
// block for the panes (stained glass).
function building(b, o) {
  const { x0, z0, w, d, h, wall, trim = wall, roof, floor, doors = [], windows = 'glass', parapet = null } = o
  const x1 = x0 + w - 1
  const z1 = z0 + d - 1
  const sideOf = (x, z) => (z === z0 ? ['n', x - x0, w] : z === z1 ? ['s', x - x0, w] : x === x0 ? ['w', z - z0, d] : ['e', z - z0, d])
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1
      if (!edge) {
        if (floor) b.put(x, 0, z, typeof floor === 'function' ? floor(x, z) : floor)
        continue
      }
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1)
      const [side, at, len] = sideOf(x, z)
      for (let y = 1; y <= h; y++) {
        if (corner) {
          b.put(x, y, z, trim)
          continue
        }
        const door = doors.find(([s, o2, dw, dh = 2]) => s === side && at >= o2 && at < o2 + dw && y <= dh)
        if (door) continue
        const nearDoor = doors.some(([s, o2, dw]) => s === side && at >= o2 - 1 && at <= o2 + dw)
        const winRow = (y === 2 || y === 3) || (h >= 8 && (y === 6 || y === 7))
        const win = windows && winRow && !nearDoor && at >= 2 && at <= len - 3 && (at - 2) % 4 < 2
        if (win) {
          if (windows !== 'open') b.put(x, y, z, windows)
          continue
        }
        b.put(x, y, z, y === h ? trim : wall)
      }
    }
  }
  b.box(x0, z0, w, d, h + 1, h + 1, roof)
  if (parapet) {
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue
        if (parapet.gaps?.some(([gx, gz]) => gx === x && gz === z)) continue
        b.put(x, h + 2, z, parapet.type)
      }
    }
  }
}

// A pitched roof on a building (same x0, z0, w, d, h): rows of blocks
// stepping up from both long sides to a ridge, one block of overhang, the
// two ends closed with `end`. ridge 'x': the ridge runs east-west.
function gable(b, { x0, z0, w, d, h, type, end, ridge = 'x' }) {
  const span = ridge === 'x' ? d : w
  const len = ridge === 'x' ? w : d
  const at = (l, s) => (ridge === 'x' ? [x0 + l, z0 + s] : [x0 + s, z0 + l])
  for (let k = 0; 2 * k <= span + 1; k++) {
    const y = h + 1 + k
    for (let l = -1; l <= len; l++) {
      for (const s of [k - 1, span - k]) {
        const [x, z] = at(l, s)
        b.put(x, y, z, type)
      }
    }
    if (k === 0) continue
    for (let s = k; s <= span - k - 1; s++) {
      for (const l of [0, len - 1]) {
        const [x, z] = at(l, s)
        b.put(x, y, z, end)
      }
    }
  }
}

// Steps of full blocks: n steps from (x, z) going (dx, dz), each one block
// higher, `width` wide.
function steps(b, x, z, dx, dz, n, width, type) {
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < width; k++) {
      const sx = x + dx * i + (dz ? k : 0)
      const sz = z + dz * i + (dx ? k : 0)
      for (let y = 1; y <= i + 1; y++) b.put(sx, y, sz, type)
    }
  }
}

// A car: 2 wide, 4 long along `along` ('x' or 'z'), dark windows on top.
function car(b, x, z, along, color) {
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 2; k++) {
      const cx = along === 'x' ? x + i : x + k
      const cz = along === 'x' ? z + k : z + i
      b.put(cx, 1, cz, i === 0 || i === 3 ? (k === 0 ? 'lightgrayconcrete' : color) : color)
      if (i === 1 || i === 2) b.put(cx, 2, cz, 'blackstainedglass')
    }
  }
}

function tree(b, x, z, log = 'oaklog', leaf = 'leaves') {
  for (let y = 1; y <= 3; y++) b.put(x, y, z, log)
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = 3; y <= 4; y++) if (dx || dz || y > 3) b.put(x + dx, y, z + dz, leaf)
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) b.put(x + dx, 5, z + dz, leaf)
}

// A pine: a tall trunk and a cone of needles.
function pine(b, x, z) {
  for (let y = 1; y <= 5; y++) b.put(x, y, z, 'sprucelog')
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if ((dx || dz) && Math.abs(dx) + Math.abs(dz) <= 2) b.put(x + dx, 3, z + dz, 'spruceleaves')
  for (const y of [4, 5]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.put(x + dx, y, z + dz, 'spruceleaves')
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) b.put(x + dx, 6, z + dz, 'spruceleaves')
  b.put(x, 7, z, 'spruceleaves')
}

function lamp(b, x, z) {
  for (let y = 1; y <= 3; y++) b.put(x, y, z, 'polishedblackstone')
  b.put(x, 4, z, 'sealantern')
}

// A low hedge from x0 to x1 along z, with a gap from g0 to g1.
function hedge(b, x0, x1, z, g0, g1) {
  for (let x = x0; x <= x1; x++) if (x < g0 || x > g1) b.put(x, 1, z, 'leaves')
}

// --- Small Town ---

function buildSmallTown(b) {
  const H = 41
  // Ground: grass, then the streets.
  b.box(-H, -H, 2 * H + 1, 2 * H + 1, 0, 0, (x, z) => {
    const ax = Math.abs(x)
    const az = Math.abs(z)
    const ew = az <= 2
    const ns = ax <= 2
    if (ew || ns) {
      // Crosswalks next to the crossing.
      if (ew && (ax === 5 || ax === 6) && z % 2 === 0) return 'whiteconcrete'
      if (ns && (az === 5 || az === 6) && x % 2 === 0) return 'whiteconcrete'
      // The middle line, dashed.
      if (ew && z === 0 && ax > 7 && (x + H) % 4 < 2) return 'yellowconcrete'
      if (ns && x === 0 && az > 7 && (z + H) % 4 < 2) return 'yellowconcrete'
      return 'asphalt'
    }
    if (az === 3 || ax === 3) return 'smoothstone'
    return 'grass'
  })

  // --- north-east: the General Store, gas station, parking lot ---
  b.box(6, -5, 16, 2, 0, 0, 'smoothstone')
  building(b, { x0: 6, z0: -17, w: 16, d: 12, h: 5, wall: 'brick', trim: 'stonebricks', roof: 'smoothstone', floor: 'polishedandesite', windows: 'open', doors: [['s', 6, 3], ['n', 2, 2]], parapet: { type: 'stonebricks', gaps: [[21, -16], [21, -15]] } })
  for (let x = 11; x <= 15; x++) b.put(x, 4, -6, 'yellowconcrete')
  // A striped awning over the front.
  for (let x = 6; x <= 21; x++) b.put(x, 4, -5, x % 2 ? 'redwool' : 'whitewool')
  for (let x = 9; x <= 18; x += 3) b.box(x, -14, 2, 1, 1, 2, 'bookshelf')
  b.box(8, -9, 3, 1, 1, 1, 'oakplanks')
  steps(b, 22, -11, 0, -1, 6, 2, 'stonebricks')
  // Gas station: a canopy on four posts, two pumps, a tall price sign.
  b.box(26, -16, 12, 10, 0, 0, 'smoothstone')
  for (const [x, z] of [[27, -15], [36, -15], [27, -8], [36, -8]]) b.box(x, z, 1, 1, 1, 4, 'whiteconcrete')
  b.box(27, -15, 10, 8, 5, 5, (x, z) => (x === 27 || x === 36 || z === -15 || z === -8 ? 'redconcrete' : 'whiteconcrete'))
  for (const x of [30, 33]) b.box(x, -12, 1, 1, 1, 2, 'redconcrete')
  b.box(25, -5, 1, 1, 1, 6, 'polishedblackstone')
  b.box(24, -5, 3, 1, 7, 8, (x, z, y) => (y === 8 ? 'redconcrete' : 'sealantern'))
  // Parking lot.
  b.box(24, -34, 13, 15, 0, 0, (x, z) => ((x - 26) % 4 === 0 && (z <= -30 || z >= -24) ? 'whiteconcrete' : 'asphalt'))
  car(b, 27, -33, 'z', 'redconcrete')
  car(b, 31, -32, 'z', 'blueconcrete')
  car(b, 31, -23, 'z', 'whiteconcrete')
  car(b, 27, -23, 'z', 'grayconcrete')
  // A church behind the store: pale walls, coloured windows, a slate
  // roof and a steeple at the front.
  building(b, { x0: 7, z0: -34, w: 11, d: 13, h: 5, wall: 'calcite', trim: 'stonebricks', roof: 'spruceplanks', floor: 'polisheddiorite', windows: 'bluestainedglass', doors: [['s', 4, 3, 3]] })
  gable(b, { x0: 7, z0: -34, w: 11, d: 13, h: 5, type: 'slateshingles', end: 'calcite', ridge: 'z' })
  b.box(11, -24, 3, 3, 1, 12, (x, z, y) => (x === 12 && z === -23 ? null : y === 9 || y === 10 ? (x === 12 || z === -23 ? null : 'stonebricks') : 'calcite'))
  b.box(11, -24, 3, 3, 13, 13, 'slateshingles')
  b.put(12, 14, -23, 'slateshingles')
  b.put(12, 15, -23, 'gold')
  for (let z = -31; z <= -26; z += 2) b.box(9, z, 7, 1, 1, 1, (x) => (x === 12 ? null : 'darkoakplanks'))
  tree(b, 21, -28)
  tree(b, 21, -20)

  // --- north-west: a cottage, a blue house, the brick house ---
  // A timber cottage with a thatched roof and a chimney.
  building(b, { x0: -19, z0: -15, w: 11, d: 9, h: 4, wall: 'plaster', trim: 'timberframe', roof: 'oakplanks', floor: 'spruceplanks', doors: [['s', 4, 2], ['n', 6, 2]] })
  gable(b, { x0: -19, z0: -15, w: 11, d: 9, h: 4, type: 'thatch', end: 'timberframe', ridge: 'x' })
  hedge(b, -19, -9, -5, -16, -13)
  b.box(-18, -14, 2, 1, 1, 1, 'redwool')
  b.put(-11, 1, -9, 'craftingtable')
  b.box(-10, -14, 1, 1, 5, 10, 'brick')
  // A blue house with a porch on posts and a shingle roof.
  building(b, { x0: -35, z0: -15, w: 11, d: 8, h: 4, wall: 'lightblueterracotta', trim: 'whiteconcrete', roof: 'oakplanks', floor: 'oakplanks', doors: [['s', 4, 2], ['e', 3, 2]] })
  gable(b, { x0: -35, z0: -15, w: 11, d: 8, h: 4, type: 'roofshingles', end: 'whiteconcrete', ridge: 'x' })
  for (const x of [-35, -31, -29, -25]) b.box(x, -6, 1, 1, 1, 3, 'oakfence')
  b.box(-35, -6, 11, 1, 4, 4, 'spruceplanks')
  hedge(b, -35, -25, -4, -32, -29)
  b.box(-33, -14, 3, 1, 1, 2, 'bookshelf')
  b.put(-14, 1, -4, 'blueconcrete')
  // A two-storey brick house with stairs inside and a dark gable roof.
  building(b, { x0: -32, z0: -32, w: 14, d: 11, h: 8, wall: 'brick', trim: 'stonebricks', roof: 'spruceplanks', floor: 'spruceplanks', doors: [['s', 6, 2], ['w', 5, 2]] })
  b.box(-31, -31, 12, 9, 4, 4, (x, z) => (x <= -28 && z <= -30 ? null : 'spruceplanks'))
  steps(b, -30, -31, 1, 0, 3, 2, 'spruceplanks')
  gable(b, { x0: -32, z0: -32, w: 14, d: 11, h: 8, type: 'darkoakplanks', end: 'brick', ridge: 'x' })
  b.box(-23, -24, 2, 1, 5, 5, 'redwool')
  // A shed, a gravel path behind the houses, and a water tower.
  b.box(-40, -21, 37, 2, 0, 0, 'gravel')
  building(b, { x0: -18, z0: -30, w: 5, d: 5, h: 3, wall: 'spruceplanks', roof: 'spruceplanks', floor: 'spruceplanks', windows: null, doors: [['e', 1, 2]] })
  for (const [x, z] of [[-8, -33], [-4, -33], [-8, -29], [-4, -29]]) b.box(x, z, 1, 1, 1, 7, 'sprucelog')
  b.box(-9, -34, 7, 7, 8, 11, (x, z) => (Math.abs(x + 6) + Math.abs(z + 31) > 4 ? null : 'spruceplanks'))
  b.box(-8, -33, 5, 5, 12, 12, (x, z) => (Math.abs(x + 6) + Math.abs(z + 31) > 3 ? null : 'darkoakplanks'))
  b.put(-6, 13, -31, 'darkoakplanks')
  tree(b, -10, -22)
  tree(b, -23, -18)
  tree(b, -38, -18)

  // --- south-west: the Town Hall and the park ---
  building(b, { x0: -27, z0: 7, w: 21, d: 15, h: 6, wall: 'quartz', trim: 'chiseledstonebricks', roof: 'smoothstone', floor: 'polisheddiorite', windows: 'open', doors: [['n', 9, 3], ['s', 9, 3], ['e', 6, 2], ['w', 3, 2]], parapet: { type: 'quartz', gaps: [[-27, 14], [-27, 15]] } })
  // Columns along the front holding up a porch roof.
  b.box(-27, 5, 21, 2, 7, 7, 'smoothstone')
  for (const x of [-25, -21, -13, -9]) b.box(x, 5, 1, 1, 1, 6, 'quartz')
  for (const [x, z] of [[-23, 11], [-11, 11], [-23, 17], [-11, 17]]) b.box(x, z, 1, 1, 1, 6, 'quartz')
  b.box(-20, 19, 7, 1, 1, 1, 'darkoakplanks')
  steps(b, -29, 20, 0, -1, 7, 2, 'chiseledstonebricks')
  // A clock tower on the roof: a white face on each side, its hand at 12.
  b.box(-19, 12, 3, 3, 8, 12, (x, z, y) => {
    const mid = (x === -18) !== (z === 13)
    if (y < 10 || !mid) return 'quartz'
    return y === 10 ? 'whiteconcrete' : 'blackconcrete'
  })
  b.box(-19, 12, 3, 3, 13, 13, 'roofshingles')
  b.put(-18, 14, 13, 'roofshingles')
  // Park: gravel paths, trees, benches, a statue and a pond.
  b.box(-36, 31, 31, 1, 0, 0, 'gravel')
  b.box(-23, 25, 3, 11, 0, 0, 'gravel')
  b.box(-23, 30, 3, 3, 1, 1, 'stonebricks')
  b.box(-22, 31, 1, 1, 2, 4, 'polishedandesite')
  b.box(-14, 33, 4, 3, 0, 0, 'water')
  b.box(-14, 33, 4, 3, -1, -1, 'sand')
  for (const [x, z] of [[-33, 27], [-28, 35], [-14, 27], [-8, 36], [-30, 33]]) tree(b, x, z)
  b.box(-27, 29, 3, 1, 1, 1, 'oakslab')
  b.box(-19, 34, 3, 1, 1, 1, 'oakslab')

  // --- south-east: the diner, houses and the workshop ---
  b.box(6, 4, 15, 3, 0, 0, 'smoothstone')
  building(b, { x0: 6, z0: 7, w: 15, d: 10, h: 4, wall: 'whiteconcrete', trim: 'redconcrete', roof: 'redconcrete', floor: (x, z) => ((x + z) % 2 ? 'whiteconcrete' : 'blackconcrete'), doors: [['n', 6, 2], ['s', 3, 2]] })
  for (let x = 7; x <= 19; x += 2) b.put(x, 4, 7, 'sealantern')
  b.box(9, 13, 9, 1, 1, 1, 'oakplanks')
  b.box(8, 9, 1, 2, 1, 1, 'redwool')
  b.box(17, 9, 1, 2, 1, 1, 'redwool')
  // The diner's tall sign.
  b.box(22, 5, 1, 1, 1, 6, 'polishedblackstone')
  b.box(21, 5, 3, 1, 7, 9, (x, z, y) => (y === 8 && x === 22 ? 'sealantern' : 'redconcrete'))
  // An adobe house: smooth sandstone, a clay-tile roof.
  building(b, { x0: 26, z0: 7, w: 11, d: 9, h: 4, wall: 'smoothsandstone', trim: 'cutsandstone', roof: 'oakplanks', floor: 'oakplanks', doors: [['n', 4, 2], ['w', 3, 2]] })
  gable(b, { x0: 26, z0: 7, w: 11, d: 9, h: 4, type: 'redterracotta', end: 'smoothsandstone', ridge: 'x' })
  hedge(b, 26, 36, 5, 29, 32)
  // A farmhouse with a porch rail and a shingle roof.
  building(b, { x0: 7, z0: 24, w: 11, d: 11, h: 4, wall: 'birchplanks', trim: 'oaklog', roof: 'oakplanks', floor: 'oakplanks', doors: [['n', 4, 2], ['e', 4, 2]] })
  gable(b, { x0: 7, z0: 24, w: 11, d: 11, h: 4, type: 'roofshingles', end: 'birchplanks', ridge: 'z' })
  for (let x = 7; x <= 17; x++) if (x < 10 || x > 13) b.put(x, 1, 22, 'oakfence')
  b.box(7, 22, 11, 2, 0, 0, 'oakplanks')
  b.put(9, 1, 32, 'craftingtable')
  // The workshop: a wide door with warning stripes, crates, a car and a
  // catwalk up the back.
  building(b, { x0: 23, z0: 21, w: 13, d: 12, h: 6, wall: 'metal', trim: 'grayconcrete', roof: 'grayconcrete', floor: 'concrete', windows: null, doors: [['n', 4, 6, 4], ['w', 7, 2]] })
  for (let x = 26; x <= 33; x++) b.put(x, 5, 21, x % 2 ? 'yellowconcrete' : 'blackconcrete')
  b.box(24, 30, 11, 2, 3, 3, 'spruceplanks')
  steps(b, 25, 29, 1, 0, 3, 1, 'spruceplanks')
  for (const [x, z, h] of [[32, 24, 2], [33, 26, 1], [30, 27, 2], [25, 25, 1]]) b.box(x, z, 2, 2, 1, h, h > 1 ? 'spruceplanks' : 'oakplanks')
  car(b, 29, 23, 'z', 'orangeconcrete')
  for (const [x, z] of [[14, 20], [21, 37], [21, 29], [38, 19]]) tree(b, x, z)

  // --- the streets: lamps, cars, a bus, hydrants ---
  ;[-34, -22, -10, 10, 22, 34].forEach((c, i) => {
    lamp(b, c, i % 2 ? 3 : -3)
    lamp(b, i % 2 ? -3 : 3, c)
  })
  car(b, -30, 1, 'x', 'greenconcrete')
  car(b, 14, -2, 'x', 'blueconcrete')
  car(b, 1, 14, 'z', 'redconcrete')
  car(b, -2, -30, 'z', 'whiteconcrete')
  car(b, 28, 1, 'x', 'yellowconcrete')
  // A bus, parked.
  for (let x = -24; x <= -17; x++) {
    for (const z of [-2, -1]) {
      b.put(x, 1, z, 'yellowconcrete')
      b.put(x, 2, z, x === -24 || x % 2 ? 'blackstainedglass' : 'yellowconcrete')
      b.put(x, 3, z, 'whiteconcrete')
    }
  }
  for (const [x, z] of [[16, 3], [-16, -3], [3, -16], [-3, 18]]) b.put(x, 1, z, 'redconcrete')
}

// --- Military Base ---

// Sandbags: a low wall 2 high.
function sandbags(b, x, z, w, d, h = 2) {
  b.box(x, z, w, d, 1, h, (sx, sz, y) => (y === h && (sx + sz) % 2 ? 'smoothsandstone' : 'cutsandstone'))
}

// A sandbag nest: a 4 x 4 ring open on one side ('n', 's', 'w', 'e').
function nest(b, x, z, open) {
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) {
      if (i > 0 && i < 3 && k > 0 && k < 3) continue
      if (open === 'n' && k === 0 && i > 0 && i < 3) continue
      if (open === 's' && k === 3 && i > 0 && i < 3) continue
      if (open === 'w' && i === 0 && k > 0 && k < 3) continue
      if (open === 'e' && i === 3 && k > 0 && k < 3) continue
      sandbags(b, x + i, z + k, 1, 1)
    }
  }
}

// A tank pointing east: tracks, hull, a turret and its gun (8 long, 4 wide).
function tank(b, x, z) {
  b.box(x, z, 6, 4, 1, 1, (sx, sz) => (sz === z || sz === z + 3 ? 'blackconcrete' : 'greenconcrete'))
  b.box(x, z, 6, 4, 2, 2, 'greenconcrete')
  b.box(x + 1, z + 1, 3, 2, 3, 3, 'greenconcrete')
  b.box(x + 4, z + 1, 4, 1, 3, 3, 'grayconcrete')
}

// A covered army truck along x: cab, then a canvas-covered back.
function truck(b, x, z) {
  b.box(x, z, 2, 2, 1, 1, 'greenconcrete')
  b.box(x, z, 2, 2, 2, 2, (sx) => (sx === x ? 'blackstainedglass' : 'greenconcrete'))
  b.box(x + 2, z, 5, 2, 1, 1, 'greenconcrete')
  b.box(x + 2, z, 5, 2, 2, 3, 'greenwool')
}

// A watchtower on four legs (a 4 x 4 platform at y 6), steps up its west
// side, sandbags round the top and a roof.
function watchtower(b, x, z) {
  for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) b.box(x + dx, z + dz, 1, 1, 1, 9, 'sprucelog')
  b.box(x, z, 4, 4, 6, 6, 'spruceplanks')
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) {
      const rim = i === 0 || i === 3 || k === 0 || k === 3
      const corner = (i === 0 || i === 3) && (k === 0 || k === 3)
      if (rim && !corner && !(i === 0 && k === 1)) b.put(x + i, 7, z + k, 'cutsandstone')
    }
  }
  b.box(x - 1, z - 1, 6, 6, 10, 10, 'spruceplanks')
  steps(b, x - 1, z + 6, 0, -1, 6, 1, 'spruceplanks')
}

// A shipping container along x: 2 wide, 6 long, 3 high, doors at one end.
function container(b, x, z, y, color) {
  b.box(x, z, 6, 2, y, y + 2, (sx) => (sx === x ? 'grayconcrete' : color))
}

// A round fuel tank.
function fuelTank(b, cx, cz) {
  b.box(cx - 2, cz - 2, 5, 5, 1, 6, (x, z, y) => (Math.hypot(x - cx, z - cz) > 2.3 ? null : y === 4 ? 'redconcrete' : 'whiteconcrete'))
}

function buildMilitaryBase(b) {
  const H = 41
  // Ground: grass with worn dirt, a gravel ring road and the helipad.
  b.box(-H, -H, 2 * H + 1, 2 * H + 1, 0, 0, (x, z) => {
    const m = Math.max(Math.abs(x), Math.abs(z))
    if (m >= 14 && m <= 16) return 'gravel'
    if (m <= 8) {
      if (m === 8) return 'yellowconcrete'
      // The H.
      if ((Math.abs(x) === 3 && Math.abs(z) <= 4) || (z === 0 && Math.abs(x) <= 3)) return 'whiteconcrete'
      return 'smoothstone'
    }
    return hash(x, z) < 0.3 ? 'coarsedirt' : hash(z, x) < 0.06 ? 'podzol' : 'grass'
  })
  // The helicopter on the pad.
  b.box(-3, -1, 7, 2, 1, 2, (x, z, y) => (x >= 3 && y === 2 ? 'blackstainedglass' : 'greenconcrete'))
  b.box(-8, 0, 5, 1, 2, 2, 'greenconcrete')
  b.box(-8, 0, 1, 1, 3, 4, 'greenconcrete')
  b.put(0, 3, 0, 'grayconcrete')
  b.box(-5, 0, 11, 1, 4, 4, 'blackconcrete')
  b.box(0, -5, 1, 11, 4, 4, 'blackconcrete')
  // Sandbag nests between the pad and the road.
  nest(b, 10, 10, 'n')
  nest(b, -13, -13, 's')
  nest(b, 10, -13, 'w')
  nest(b, -13, 10, 'e')
  b.box(-12, -5, 1, 2, 1, 2, 'crate')
  b.box(11, 3, 2, 1, 1, 1, 'crate')

  // --- north: the HQ, the flag and the radar ---
  b.box(-12, -21, 21, 2, 0, 0, 'smoothstone')
  building(b, { x0: -12, z0: -34, w: 21, d: 13, h: 8, wall: 'lightgrayconcrete', trim: 'grayconcrete', roof: 'smoothstone', floor: 'polishedandesite', doors: [['s', 9, 3], ['w', 5, 2]], parapet: { type: 'cutsandstone', gaps: [[8, -31], [8, -32]] } })
  b.box(-11, -33, 19, 11, 4, 4, (x, z) => (x <= -8 && z <= -31 ? null : 'polishedandesite'))
  steps(b, -10, -33, 1, 0, 3, 2, 'grayconcrete')
  for (let x = -9; x <= 5; x += 4) b.box(x, -27, 2, 1, 1, 1, 'oakplanks')
  b.box(-2, -33, 3, 1, 5, 6, 'bookshelf')
  steps(b, 9, -23, 0, -1, 9, 2, 'grayconcrete')
  // A radio mast on the roof.
  b.box(-9, -31, 1, 1, 10, 15, 'polishedblackstone')
  b.put(-9, 16, -31, 'redconcrete')
  // The flagpole in front.
  b.box(-2, -19, 1, 1, 1, 10, 'polishedblackstone')
  b.box(-5, -19, 3, 1, 8, 9, (x, z, y) => (y === 9 ? 'redwool' : 'whitewool'))
  // The radar: a hut and a dish on a mast.
  building(b, { x0: 21, z0: -31, w: 5, d: 5, h: 3, wall: 'grayconcrete', roof: 'smoothstone', floor: 'polishedandesite', windows: 'glass', doors: [['s', 2, 1]] })
  b.box(29, -29, 1, 1, 1, 6, 'polishedblackstone')
  b.box(26, -32, 7, 7, 7, 8, (x, z, y) => {
    const r = Math.hypot(x - 29, z + 29)
    return (y === 7 && r <= 1.5) || (y === 8 && r > 1.5 && r <= 3.2) ? 'whiteconcrete' : null
  })
  b.box(29, -29, 1, 1, 8, 9, 'grayconcrete')

  // --- north-west: the curved metal barracks ---
  const arch = [3, 5, 6, 7, 7, 7, 6, 5, 3]
  for (let z = -33; z <= -18; z++) {
    for (let i = 0; i < 9; i++) {
      const x = -34 + i
      const h = arch[i]
      const end = z === -33 || z === -18
      const doorway = end && i >= 3 && i <= 5
      if (end) {
        for (let y = 1; y <= h; y++) if (!(doorway && y <= 3)) b.put(x, y, z, y === h ? 'metal' : 'lightgrayconcrete')
      } else {
        b.put(x, h, z, 'metal')
        if (i === 0 || i === 8) for (let y = 1; y < h; y++) b.put(x, y, z, z % 4 === 0 && y === 2 ? 'glass' : 'metal')
        else if (i === 1 || i === 7) b.put(x, h - 1, z, 'metal')
      }
    }
    if (z > -33 && z < -18) b.box(-33, z, 7, 1, 0, 0, 'spruceplanks')
  }
  for (let z = -31; z <= -20; z += 3) {
    b.box(-33, z, 2, 1, 1, 1, 'greenwool')
    b.box(-27, z, 2, 1, 1, 1, 'greenwool')
  }

  // --- west: the shooting range ---
  b.box(-38, -10, 21, 21, 0, 0, (x, z) => (hash(x, z) < 0.5 ? 'sand' : 'coarsedirt'))
  for (const z of [-6, -2, 2, 6]) sandbags(b, -30, z, 8, 1, 1)
  for (const z of [-8, -4, 0, 4, 8]) b.box(-32, z, 1, 1, 1, 2, 'target')
  b.box(-35, -10, 2, 21, 1, 3, 'coarsedirt')
  // The firing line's roof on posts.
  for (const z of [-10, -4, 4, 10]) b.box(-20, z, 1, 1, 1, 3, 'sprucelog')
  b.box(-21, -10, 3, 21, 4, 4, 'spruceplanks')
  b.box(-19, -9, 1, 19, 1, 1, (x, z) => (z % 4 === 0 ? 'crate' : null))

  // --- south-west: the two-storey wooden barracks and a medical tent ---
  building(b, { x0: -33, z0: 20, w: 13, d: 11, h: 8, wall: 'spruceplanks', trim: 'sprucelog', roof: 'spruceplanks', floor: 'oakplanks', doors: [['n', 5, 2], ['e', 4, 2]] })
  b.box(-32, 21, 11, 9, 4, 4, (x, z) => (x <= -29 && z <= 22 ? null : 'oakplanks'))
  steps(b, -31, 21, 1, 0, 3, 2, 'oakplanks')
  gable(b, { x0: -33, z0: 20, w: 13, d: 11, h: 8, type: 'darkoakplanks', end: 'spruceplanks', ridge: 'x' })
  for (let x = -31; x <= -23; x += 3) b.box(x, 28, 2, 1, 1, 1, 'greenwool')
  // The medical tent: white canvas with a red cross.
  for (let x = -18; x <= -10; x++) {
    for (let z = 33; z <= 37; z++) {
      const k = Math.min(z - 33, 37 - z)
      if (x === -18 || x === -10) {
        if (!(x === -10 && z === 35)) for (let y = 1; y <= k + 1; y++) b.put(x, y, z, 'whitewool')
      } else b.put(x, k + 1, z, (k === 2 && (x === -14 || x === -15 || x === -13)) || (x === -14 && k >= 1) ? 'redwool' : 'whitewool')
    }
  }
  b.box(-16, 34, 1, 3, 0, 0, 'whitewool')
  b.box(-12, 34, 1, 3, 0, 0, 'whitewool')

  // --- south: the hangar, a tank and trucks ---
  b.box(-6, 17, 15, 4, 0, 0, 'smoothstone')
  building(b, { x0: -8, z0: 21, w: 19, d: 15, h: 7, wall: 'metal', trim: 'grayconcrete', roof: 'grayconcrete', floor: 'smoothstone', windows: null, doors: [['n', 5, 9, 5], ['e', 6, 2]] })
  for (let x = -3; x <= 5; x++) b.put(x, 6, 21, x % 2 ? 'yellowconcrete' : 'blackconcrete')
  tank(b, -6, 25)
  truck(b, 2, 30)
  b.box(-7, 33, 17, 2, 3, 3, 'spruceplanks')
  steps(b, 7, 32, -1, 0, 3, 1, 'spruceplanks')
  for (const [x, z, h] of [[6, 23, 2], [8, 26, 1], [-6, 31, 2]]) b.box(x, z, 2, 2, 1, h, 'crate')
  tank(b, -14, 23)
  truck(b, 12, 18)
  b.box(-26, 19, 6, 1, 1, 1, 'barrel')

  // --- south-east: the fuel depot and the container yard ---
  b.box(20, 18, 17, 20, 0, 0, (x, z) => (hash(x, z) < 0.15 ? 'gravel' : 'smoothstone'))
  fuelTank(b, 23, 21)
  fuelTank(b, 30, 21)
  for (let x = 21; x <= 33; x += 3) b.put(x, 1, 25, 'barrel')
  container(b, 20, 28, 1, 'orangeconcrete')
  container(b, 20, 28, 4, 'blueconcrete')
  container(b, 29, 27, 1, 'redconcrete')
  container(b, 20, 32, 1, 'greenconcrete')
  container(b, 28, 31, 1, 'blueconcrete')
  container(b, 28, 31, 4, 'orangeconcrete')
  container(b, 24, 35, 1, 'redconcrete')
  steps(b, 26, 34, 1, 0, 1, 1, 'crate')
  b.box(26, 33, 1, 1, 1, 2, 'crate')
  b.box(27, 33, 1, 1, 1, 3, 'crate')

  // --- east: the bunker ---
  building(b, { x0: 22, z0: -6, w: 11, d: 11, h: 3, wall: 'grayconcrete', trim: 'grayconcrete', roof: 'grayconcrete', floor: 'polishedandesite', windows: 'open', doors: [['w', 4, 3], ['e', 4, 2]], parapet: { type: 'cutsandstone', gaps: [[27, -6], [28, -6]] } })
  b.box(24, -4, 2, 2, 1, 1, 'crate')
  b.box(29, 1, 2, 1, 1, 1, 'barrel')
  steps(b, 27, -10, 0, 1, 4, 2, 'grayconcrete')
  sandbags(b, 20, -9, 1, 5)
  sandbags(b, 20, 6, 1, 5)

  // --- four watchtowers by the road corners ---
  watchtower(b, -22, -23)
  watchtower(b, 18, -22)
  watchtower(b, -22, 13)
  watchtower(b, 29, 11)

  // Pines round the back.
  for (const [x, z] of [[-17, -34], [14, -28], [15, 36], [-25, 36]]) pine(b, x, z)
}
