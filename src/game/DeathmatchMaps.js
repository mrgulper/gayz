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
// Docks (2026-11-16, Gaymi picked shipping containers, a big warehouse,
// cranes + a ship and water on one side): same size. The sea along the
// east with a quay wall, two piers, a rowing boat and a cargo ship you
// walk onto up a gangway (a hold under the deck, containers on it, a
// bridge with a funnel); two gantry cranes with booms out over the water;
// a lighthouse; a container yard in the north; a big warehouse in the
// west with racks and a catwalk; a harbour office and a fish market in
// the south. Water is 2 deep with ladders up the quay wall.
//
// The edge (2026-11-16, Gaymi: "make the border not just a square more
// irregular"): the play area bends in and out and its corners are cut.
// Past it is empty void (2026-11-16, replaced the wall/cliff/trees/water
// edge): fall off and you die and respawn.
//
// Bigger (2026-11-16, Gaymi: "make both maps even bigger and more
// detailed"): every map is 121 x 121 now (half 60, was 81 x 81). The old
// map stays in the middle and a ring of new places goes round it (see
// the *Outer builders). New maps get this size too.
//
// Coordinates are blocks round the arena's middle: x east, z south, y up
// from the floor (y 0 is the floor, people stand at y 1).

// [x, z, height of the floor under them]
const TOWN_SPAWNS = [
  [-26, -19, 0], [30, -31, 0], [-31, 30, 0], [19, 33, 0],
  [0, -34, 0], [0, 35, 0], [-34, 0, 0], [34, 0, 0],
  [-12, -24, 0], [12, -30, 0], [12, 29, 0], [-17, 14, 0], [27, 26, 0],
  [14, -11, 6], [-13, 16, 7],
  // The outer ring (2026-11-16): the ring road, the school roof.
  [43, -20, 0], [43, 20, 0], [-43, -20, 0], [-43, 20, 0],
  [20, 43, 0], [-20, 43, 0], [20, -43, 0], [-20, -43, 0], [-20, -49, 6], [49, -26, 0],
]

const BASE_SPAWNS = [
  [-28, -11, 0], [-25, 10, 0], [-26, 34, 0], [-12, -37, 0], [12, -37, 0],
  [33, -18, 0], [31, 7, 0], [17, 38, 0], [-5, 18, 0], [6, -15, 0],
  [-15, 4, 0], [15, -4, 0], [-11, 12, 0], [11, -12, 0],
  [-3, -28, 9], [27, -2, 4],
  [-43, -30, 0], [-43, 30, 0], [43, -35, 0], [43, 22, 0],
  [-30, 44, 0], [30, 44, 0], [-25, -44, 0], [25, -44, 0],
]

const DOCKS_SPAWNS = [
  [-30, -12, 0], [-29, 11, 0], [-17, 20, 0], [-30, 30, 0], [-12, -32, 0],
  [-5, -22, 0], [-5, 8, 0], [-14, 30, 0], [-21, -30, 0],
  [12, -27, 0], [17, 0, 0], [12, 12, 0], [28, -6, 2], [29, 5, 2],
  [20, 37, 0], [3, 18, 0],
  [-43, -25, 0], [-43, 35, 0], [-30, -44, 0], [-30, 44, 0],
  [12, -44, 0], [12, 44, 0], [18, -44, 0], [45, 4, 0],
]

export const DM_MAPS = {
  smallTown: {
    key: 'dmMapSmallTown',
    half: 60,
    wallH: 12,
    spawns: TOWN_SPAWNS,
    // Team Deathmatch: Red starts in the west half, Blue in the east.
    teamSpawns: {
      r: TOWN_SPAWNS.filter(([x]) => x < 0),
      b: TOWN_SPAWNS.filter(([x]) => x > 0),
    },
    // Where a stuck bot walks to instead: the streets.
    waypoints: [[0, 10], [0, -10], [10, 0], [-10, 0], [0, 30], [0, -30], [30, 0], [-30, 0], [43, 43], [-43, -43], [43, -43], [-43, 43]],
    // The edge: how far it comes in (waves round the middle) and where
    // the corners are cut; past it is void.
    edge: {
      base: 3,
      max: 8,
      waves: [[3, 3, 0.7], [2, 5, 2.1], [1, 7, 4]],
      corner: 102,
    },
    build: buildSmallTown,
  },
  militaryBase: {
    key: 'dmMapMilitaryBase',
    half: 60,
    wallH: 12,
    spawns: BASE_SPAWNS,
    teamSpawns: {
      r: BASE_SPAWNS.filter(([x]) => x < 0),
      b: BASE_SPAWNS.filter(([x]) => x > 0),
    },
    // The ring road round the helipad.
    waypoints: [[15, 0], [-15, 0], [0, 15], [0, -15], [15, 15], [-15, -15], [15, -15], [-15, 15], [43, 0], [-43, 0], [0, 43], [0, -44]],
    edge: {
      base: 3,
      max: 8,
      waves: [[3, 2, 1.9], [2, 5, 0.3], [1.2, 6, 3.3]],
      corner: 103,
    },
    build: buildMilitaryBase,
  },
  docks: {
    key: 'dmMapDocks',
    half: 60,
    wallH: 12,
    spawns: DOCKS_SPAWNS,
    teamSpawns: {
      r: DOCKS_SPAWNS.filter(([x]) => x < 0),
      b: DOCKS_SPAWNS.filter(([x]) => x > 0),
    },
    // The road, the yard lanes and the quay.
    waypoints: [[8, 0], [8, -20], [8, 20], [-6, 0], [-6, -28], [18, -24], [18, 6], [-20, 28], [8, -44], [8, 44], [-43, 0], [45, 4]],
    edge: {
      base: 3,
      max: 8,
      waves: [[2.5, 3, 2.4], [1.5, 5, 1.1], [1, 7, 0.2]],
      corner: 102,
    },
    build: buildDocks,
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

// A pitched roof on a building (same x0, z0, w, d, h): rows of stairs
// stepping up from both long sides to a ridge of full blocks, one block of
// overhang, the two ends closed with `end`. ridge 'x': the ridge runs
// east-west. (Stairs, not plain blocks, since 2026-11-16: Gaymi wanted
// "slabs, stairs, ladders" in the buildings - and you can climb them.)
function gable(b, { x0, z0, w, d, h, type, end, ridge = 'x' }) {
  const span = ridge === 'x' ? d : w
  const len = ridge === 'x' ? w : d
  const at = (l, s) => (ridge === 'x' ? [x0 + l, z0 + s] : [x0 + s, z0 + l])
  const st = stairsOf(type)
  for (let k = 0; 2 * k <= span + 1; k++) {
    const y = h + 1 + k
    const top = 2 * (k + 1) > span + 1
    for (let l = -1; l <= len; l++) {
      for (const s of [k - 1, span - k]) {
        const [x, z] = at(l, s)
        // The low side rises toward the ridge.
        const up = s === k - 1 ? (ridge === 'x' ? 0 : 1) : ridge === 'x' ? 2 : 3
        if (top) b.put(x, y, z, type)
        else b.put(x, y, z, st, up)
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

// The stairs and slab cut from a block (a few old ones keep their own ids).
const HAND_STAIRS = { oakplanks: 'oakstairs', stonebricks: 'stonestairs', brick: 'brickstairs', cobblestone: 'cobblestonestairs' }
const HAND_SLAB = {
  oakplanks: 'oakslab', spruceplanks: 'spruceslab', birchplanks: 'birchslab', darkoakplanks: 'darkoakslab',
  smoothstone: 'stoneslab', cobblestone: 'cobblestoneslab', brick: 'brickslab', stonebricks: 'stonebrickslab',
  sandstone: 'sandstoneslab', quartz: 'quartzslab', blackstone: 'blackstoneslab', prismarine: 'prismarineslab',
}
const stairsOf = (id) => HAND_STAIRS[id] || `${id}stairs`
const slabOf = (id) => HAND_SLAB[id] || `${id}slab`

// Which way a stair faces when you walk up it going (dx, dz): the side its
// high step is on (BuildMode._stairFacing: 0 +z, 1 +x, 2 -z, 3 -x).
const faceUp = (dx, dz) => (dz > 0 ? 0 : dx > 0 ? 1 : dz < 0 ? 2 : 3)

// A real staircase: n steps from (x, z) going (dx, dz), the first at
// height y0 + 1, each a stair block on top of full blocks, `width` wide.
function stairs(b, x, z, dx, dz, n, width, type, y0 = 0) {
  const st = stairsOf(type)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < width; k++) {
      const sx = x + dx * i + (dz ? k : 0)
      const sz = z + dz * i + (dx ? k : 0)
      for (let y = y0 + 1; y <= y0 + i; y++) b.put(sx, y, sz, type)
      b.put(sx, y0 + i + 1, sz, st, faceUp(dx, dz))
    }
  }
}

// A ladder from y0 to y1 (it hangs on the wall next to it, so put the wall
// first).
function ladder(b, x, z, y0, y1) {
  for (let y = y0; y <= y1; y++) b.put(x, y, z, 'ladder')
}

// A bench: stairs with their backs to `back` ('n', 's', 'w', 'e').
function bench(b, x, z, len, along, back, type = 'oakplanks') {
  const f = { s: 0, e: 1, n: 2, w: 3 }[back]
  for (let i = 0; i < len; i++) b.put(along === 'x' ? x + i : x, 1, along === 'x' ? z : z + i, stairsOf(type), f)
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
  const H = 61
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
    // The ring road round the old town (2026-11-16, the map grew).
    const m = Math.max(ax, az)
    if (m >= 42 && m <= 44) return m === 43 && (ax === m ? z : x) % 6 === 0 ? 'yellowconcrete' : 'asphalt'
    if (m === 41 || m === 45) return 'smoothstone'
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
  stairs(b, 22, -11, 0, -1, 6, 2, 'stonebricks')
  // A counter of slabs and stools at the till.
  b.box(8, -9, 3, 1, 1, 1, slabOf('oakplanks'))
  for (const x of [8, 10]) b.put(x, 1, -8, 'oakfence')
  // Gas station: a canopy on four posts, two pumps, a tall price sign.
  b.box(26, -16, 12, 10, 0, 0, 'smoothstone')
  for (const [x, z] of [[27, -15], [36, -15], [27, -8], [36, -8]]) b.box(x, z, 1, 1, 1, 4, 'whiteconcrete')
  b.box(27, -15, 10, 8, 5, 5, (x, z) => (x === 27 || x === 36 || z === -15 || z === -8 ? 'redconcrete' : 'whiteconcrete'))
  for (const x of [30, 33]) b.box(x, -12, 1, 1, 1, 2, 'redconcrete')
  for (const x of [30, 33]) b.put(x, 3, -12, slabOf('whiteconcrete'))
  // A ladder up the back post to the canopy roof.
  ladder(b, 37, -15, 1, 5)
  // Kerbs of slabs round the pumps' island.
  b.box(29, -13, 6, 3, 1, 1, (x, z) => (x === 30 || x === 33) && z === -12 ? null : slabOf('smoothstone'))
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
  // Pews (backs to the door) and an altar of quartz slabs.
  for (let z = -31; z <= -26; z += 2) {
    bench(b, 9, z, 3, 'x', 's', 'darkoakplanks')
    bench(b, 13, z, 3, 'x', 's', 'darkoakplanks')
  }
  b.box(10, -33, 5, 1, 1, 1, slabOf('quartz'))
  b.put(12, 1, -33, 'gold')
  // A way in through the steeple, and a ladder up its middle to the
  // belfry's four arches.
  for (const z of [-22, -24]) b.box(12, z, 1, 1, 1, 2, 'air')
  ladder(b, 12, -23, 1, 10)
  b.put(12, 11, -23, slabOf('stonebricks'))
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
  b.put(-10, 11, -14, slabOf('stonebricks'))
  // Flower boxes under the front windows.
  for (const x of [-17, -12]) b.put(x, 1, -6, slabOf('spruceplanks'))
  // A blue house with a porch on posts and a shingle roof.
  building(b, { x0: -35, z0: -15, w: 11, d: 8, h: 4, wall: 'lightblueterracotta', trim: 'whiteconcrete', roof: 'oakplanks', floor: 'oakplanks', doors: [['s', 4, 2], ['e', 3, 2]] })
  gable(b, { x0: -35, z0: -15, w: 11, d: 8, h: 4, type: 'roofshingles', end: 'whiteconcrete', ridge: 'x' })
  for (const x of [-35, -31, -29, -25]) b.box(x, -6, 1, 1, 1, 3, 'oakfence')
  b.box(-35, -6, 11, 1, 4, 4, slabOf('spruceplanks'))
  b.box(-34, -6, 9, 1, 0, 0, 'spruceplanks')
  bench(b, -34, -6, 2, 'x', 'n', 'oakplanks')
  hedge(b, -35, -25, -4, -32, -29)
  b.box(-33, -14, 3, 1, 1, 2, 'bookshelf')
  b.put(-14, 1, -4, 'blueconcrete')
  // A two-storey brick house with stairs inside and a dark gable roof.
  building(b, { x0: -32, z0: -32, w: 14, d: 11, h: 8, wall: 'brick', trim: 'stonebricks', roof: 'spruceplanks', floor: 'spruceplanks', doors: [['s', 6, 2], ['w', 5, 2]] })
  b.box(-31, -31, 12, 9, 4, 4, (x, z) => (x <= -28 && z <= -30 ? null : 'spruceplanks'))
  stairs(b, -30, -31, 1, 0, 3, 2, 'spruceplanks')
  // A balcony on the upper floor, with a fence rail.
  b.box(-29, -21, 6, 2, 4, 4, 'spruceplanks')
  for (let x = -29; x <= -24; x++) b.put(x, 5, -20, 'oakfence')
  b.box(-27, -22, 2, 1, 5, 6, 'air')
  gable(b, { x0: -32, z0: -32, w: 14, d: 11, h: 8, type: 'darkoakplanks', end: 'brick', ridge: 'x' })
  b.box(-23, -24, 2, 1, 5, 5, 'redwool')
  // A shed, a gravel path behind the houses, and a water tower.
  b.box(-40, -21, 37, 2, 0, 0, 'gravel')
  building(b, { x0: -18, z0: -30, w: 5, d: 5, h: 3, wall: 'spruceplanks', roof: 'spruceplanks', floor: 'spruceplanks', windows: null, doors: [['e', 1, 2]] })
  for (const [x, z] of [[-8, -33], [-4, -33], [-8, -29], [-4, -29]]) b.box(x, z, 1, 1, 1, 7, 'sprucelog')
  b.box(-9, -34, 7, 7, 8, 11, (x, z) => (Math.abs(x + 6) + Math.abs(z + 31) > 4 ? null : 'spruceplanks'))
  b.box(-8, -33, 5, 5, 12, 12, (x, z) => (Math.abs(x + 6) + Math.abs(z + 31) > 3 ? null : 'darkoakplanks'))
  b.put(-6, 13, -31, 'darkoakplanks')
  // A post under the tank and a ladder up it to the top: a lookout.
  b.box(-9, -31, 1, 1, 1, 7, 'sprucelog')
  ladder(b, -10, -31, 1, 11)
  tree(b, -10, -22)
  tree(b, -23, -18)
  tree(b, -38, -18)

  // --- south-west: the Town Hall and the park ---
  building(b, { x0: -27, z0: 7, w: 21, d: 15, h: 6, wall: 'quartz', trim: 'chiseledstonebricks', roof: 'smoothstone', floor: 'polisheddiorite', windows: 'open', doors: [['n', 9, 3], ['s', 9, 3], ['e', 6, 2], ['w', 3, 2]], parapet: { type: 'quartz', gaps: [[-27, 14], [-27, 15], [-7, 18]] } })
  // Columns along the front holding up a porch roof.
  b.box(-27, 5, 21, 2, 7, 7, 'smoothstone')
  for (const x of [-25, -21, -13, -9]) b.box(x, 5, 1, 1, 1, 6, 'quartz')
  for (const [x, z] of [[-23, 11], [-11, 11], [-23, 17], [-11, 17]]) b.box(x, z, 1, 1, 1, 6, 'quartz')
  b.box(-20, 19, 7, 1, 1, 1, 'darkoakplanks')
  stairs(b, -29, 20, 0, -1, 7, 2, 'chiseledstonebricks')
  // Benches under the porch.
  bench(b, -24, 6, 3, 'x', 's', 'quartz')
  bench(b, -12, 6, 3, 'x', 's', 'quartz')
  // A Wind Tunnel in the floor by the east wall floats you up to the
  // roof (a gap in the low wall there).
  b.box(-6, 17, 2, 3, 0, 0, (x, z) => (x === -6 && z === 18 ? 'windtunnel' : 'yellowconcrete'))
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
  bench(b, -27, 29, 3, 'x', 'n')
  bench(b, -19, 34, 3, 'x', 's')
  // A pond rim of slabs and a Teleporter Pad (its other end is in the
  // parking lot, across the town).
  for (let x = -15; x <= -10; x++) for (const z of [32, 36]) b.put(x, 1, z, slabOf('stonebricks'))
  for (let z = 33; z <= 35; z++) for (const x of [-15, -10]) b.put(x, 1, z, slabOf('stonebricks'))
  b.put(-26, 1, 32, 'teleporterpad')

  // --- south-east: the diner, houses and the workshop ---
  b.box(6, 4, 15, 3, 0, 0, 'smoothstone')
  building(b, { x0: 6, z0: 7, w: 15, d: 10, h: 4, wall: 'whiteconcrete', trim: 'redconcrete', roof: 'redconcrete', floor: (x, z) => ((x + z) % 2 ? 'whiteconcrete' : 'blackconcrete'), doors: [['n', 6, 2], ['s', 3, 2]] })
  for (let x = 7; x <= 19; x += 2) b.put(x, 4, 7, 'sealantern')
  b.box(9, 13, 9, 1, 1, 1, slabOf('quartz'))
  for (let x = 10; x <= 16; x += 2) b.put(x, 1, 12, 'oakfence')
  // A ladder up the back wall to the roof.
  ladder(b, 19, 17, 1, 5)
  b.box(8, 9, 1, 2, 1, 1, 'redwool')
  b.box(17, 9, 1, 2, 1, 1, 'redwool')
  // The diner's tall sign.
  b.box(22, 5, 1, 1, 1, 6, 'polishedblackstone')
  b.box(21, 5, 3, 1, 7, 9, (x, z, y) => (y === 8 && x === 22 ? 'sealantern' : 'redconcrete'))
  // An adobe house: smooth sandstone, a clay-tile roof.
  building(b, { x0: 26, z0: 7, w: 11, d: 9, h: 4, wall: 'smoothsandstone', trim: 'cutsandstone', roof: 'oakplanks', floor: 'oakplanks', doors: [['n', 4, 2], ['w', 3, 2]] })
  gable(b, { x0: 26, z0: 7, w: 11, d: 9, h: 4, type: 'redterracotta', end: 'smoothsandstone', ridge: 'x' })
  hedge(b, 26, 36, 5, 29, 32)
  bench(b, 28, 16, 3, 'x', 'n', 'cutsandstone')
  // A farmhouse with a porch rail and a shingle roof.
  building(b, { x0: 7, z0: 24, w: 11, d: 11, h: 4, wall: 'birchplanks', trim: 'oaklog', roof: 'oakplanks', floor: 'oakplanks', doors: [['n', 4, 2], ['e', 4, 2]] })
  gable(b, { x0: 7, z0: 24, w: 11, d: 11, h: 4, type: 'roofshingles', end: 'birchplanks', ridge: 'z' })
  for (let x = 7; x <= 17; x++) if (x < 10 || x > 13) b.put(x, 1, 22, 'oakfence')
  b.box(7, 22, 11, 2, 0, 0, 'oakplanks')
  b.put(9, 1, 32, 'craftingtable')
  bench(b, 8, 23, 2, 'x', 's')
  bench(b, 15, 23, 2, 'x', 's')
  // The workshop: a wide door with warning stripes, crates, a car and a
  // catwalk up the back.
  building(b, { x0: 23, z0: 21, w: 13, d: 12, h: 6, wall: 'metal', trim: 'grayconcrete', roof: 'grayconcrete', floor: 'concrete', windows: null, doors: [['n', 4, 6, 4], ['w', 7, 2]] })
  for (let x = 26; x <= 33; x++) b.put(x, 5, 21, x % 2 ? 'yellowconcrete' : 'blackconcrete')
  b.box(24, 30, 11, 2, 3, 3, 'spruceplanks')
  stairs(b, 25, 29, 1, 0, 3, 1, 'spruceplanks')
  ladder(b, 34, 29, 1, 3)
  // A rail along the catwalk, and a Jump Pad up to its end.
  for (let x = 28; x <= 32; x++) b.put(x, 4, 29, 'oakfence')
  b.put(33, 1, 28, 'jumppad')
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
  // Bus roof seats of slabs; a Jump Pad on the pavement gets you up there.
  b.box(-23, -2, 6, 2, 4, 4, (x) => (x % 2 ? slabOf('grayconcrete') : null))
  b.put(-20, 1, -3, 'jumppad')
  // Speed Pads on the four roads into the crossing.
  for (const [x, z] of [[0, -9], [0, 9], [9, 0], [-9, 0]]) b.put(x, 1, z, 'speedpad')
  // The parking lot end of the park's Teleporter Pad.
  b.put(35, 1, -27, 'teleporterpad')
  smallTownOuter(b)
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

// A watchtower on four legs (a 4 x 4 platform at y 6), a ladder up its
// west side to the gap in the sandbags round the top, and a roof.
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
  b.box(x, z + 1, 1, 1, 1, 5, 'sprucelog')
  ladder(b, x - 1, z + 1, 1, 7)
  // A slab bench up top.
  b.put(x + 2, 7, z + 2, slabOf('spruceplanks'))
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
  const H = 61
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
  // Speed Pads on the ring road, and a pair of Teleporter Pads between
  // the west and east sides.
  for (const [x, z] of [[15, 0], [-15, 0], [0, 15], [0, -15]]) b.put(x, 1, z, 'speedpad')
  b.put(-26, 1, 13, 'teleporterpad')
  b.put(30, 1, -14, 'teleporterpad')

  // --- north: the HQ, the flag and the radar ---
  b.box(-12, -21, 21, 2, 0, 0, 'smoothstone')
  building(b, { x0: -12, z0: -34, w: 21, d: 13, h: 8, wall: 'lightgrayconcrete', trim: 'grayconcrete', roof: 'smoothstone', floor: 'polishedandesite', doors: [['s', 9, 3], ['w', 5, 2]], parapet: { type: 'cutsandstone', gaps: [[8, -31], [8, -32]] } })
  b.box(-11, -33, 19, 11, 4, 4, (x, z) => (x <= -8 && z <= -31 ? null : 'polishedandesite'))
  stairs(b, -10, -33, 1, 0, 3, 2, 'grayconcrete')
  // Desks of slabs with chairs.
  for (let x = -9; x <= 5; x += 4) {
    b.box(x, -27, 2, 1, 1, 1, slabOf('darkoakplanks'))
    b.put(x, 1, -26, stairsOf('oakplanks'), 0)
  }
  b.box(-2, -33, 3, 1, 5, 6, 'bookshelf')
  stairs(b, 9, -23, 0, -1, 9, 2, 'grayconcrete')
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
  // A Wind Tunnel on a block beside the dish floats you up into it.
  b.put(29, 1, -25, 'windtunnel')

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
  b.box(-19, -9, 1, 19, 1, 1, (x, z) => (z % 4 === 0 ? 'crate' : z % 4 === 2 || z % 4 === -2 ? slabOf('spruceplanks') : null))

  // --- south-west: the two-storey wooden barracks and a medical tent ---
  building(b, { x0: -33, z0: 20, w: 13, d: 11, h: 8, wall: 'spruceplanks', trim: 'sprucelog', roof: 'spruceplanks', floor: 'oakplanks', doors: [['n', 5, 2], ['e', 4, 2]] })
  b.box(-32, 21, 11, 9, 4, 4, (x, z) => (x <= -29 && z <= 22 ? null : 'oakplanks'))
  stairs(b, -31, 21, 1, 0, 3, 2, 'oakplanks')
  // A slab porch roof over the front door, on fence posts.
  b.box(-30, 18, 6, 2, 3, 3, slabOf('spruceplanks'))
  for (const x of [-30, -25]) b.box(x, 18, 1, 1, 1, 2, 'oakfence')
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
  stairs(b, 7, 32, -1, 0, 3, 1, 'spruceplanks')
  // A rail along the catwalk with a gap over a Jump Pad.
  for (let x = -4; x <= 4; x++) if (x < -3 || x > -1) b.put(x, 4, 32, 'oakfence')
  b.put(-2, 1, 32, 'jumppad')
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
  // A Jump Pad onto the green container and a ladder up the tall stack.
  b.put(22, 1, 34, 'jumppad')
  ladder(b, 22, 30, 1, 6)

  // --- east: the bunker ---
  building(b, { x0: 22, z0: -6, w: 11, d: 11, h: 3, wall: 'grayconcrete', trim: 'grayconcrete', roof: 'grayconcrete', floor: 'polishedandesite', windows: 'open', doors: [['w', 4, 3], ['e', 4, 2]], parapet: { type: 'cutsandstone', gaps: [[27, -6], [28, -6]] } })
  b.box(24, -4, 2, 2, 1, 1, 'crate')
  b.box(29, 1, 2, 1, 1, 1, 'barrel')
  stairs(b, 27, -10, 0, 1, 4, 2, 'grayconcrete')
  sandbags(b, 20, -9, 1, 5)
  sandbags(b, 20, 6, 1, 5)

  // --- four watchtowers by the road corners ---
  watchtower(b, -22, -23)
  watchtower(b, 18, -22)
  watchtower(b, -22, 13)
  watchtower(b, 29, 11)

  // Pines round the back.
  for (const [x, z] of [[-17, -34], [14, -28], [15, 36], [-25, 36]]) pine(b, x, z)
  militaryBaseOuter(b)
}

// --- Docks ---

// A shipping container along z: 2 wide, 6 long, 3 high, doors at the
// north end (the ship's deck runs north-south).
function containerZ(b, x, z, y, color) {
  b.box(x, z, 2, 6, y, y + 2, (sx, sz) => (sz === z ? 'grayconcrete' : color))
}

// A gantry crane on the quay: four yellow legs, a frame on top and a long
// boom out over the water you can walk along (ladder up the north-west
// leg), with a hook hanging off its end.
function gantry(b, z0) {
  for (const [x, z] of [[14, z0], [20, z0], [14, z0 + 6], [20, z0 + 6]]) b.box(x, z, 1, 1, 1, 13, 'yellowconcrete')
  b.box(14, z0, 7, 7, 13, 13, (x, z) => (x === 14 || x === 20 || z === z0 || z === z0 + 6 ? 'yellowconcrete' : null))
  b.box(10, z0 + 2, 25, 3, 14, 14, (x, z) => (z === z0 + 3 ? 'metal' : 'yellowconcrete'))
  // A rail along both sides of the boom.
  for (let x = 10; x <= 34; x++) for (const z of [z0 + 2, z0 + 4]) if (x % 2 === 0) b.put(x, 15, z, 'oakfence')
  // The driver's cab under the boom.
  b.box(17, z0 + 2, 3, 3, 11, 12, (x, z, y) => (y === 12 && x === 19 ? 'blackstainedglass' : 'yellowconcrete'))
  // The hook on its cable.
  b.box(32, z0 + 3, 1, 1, 9, 13, 'polishedblackstone')
  b.put(32, 8, z0 + 3, 'grayconcrete')
  ladder(b, 13, z0, 1, 14)
}

// A forklift facing east: body, seat, mast and forks.
function forklift(b, x, z) {
  b.box(x, z, 3, 2, 1, 1, 'yellowconcrete')
  b.put(x, 2, z, 'blackconcrete')
  b.put(x + 1, 2, z, stairsOf('oakplanks'), 3)
  b.box(x + 3, z, 1, 2, 1, 3, 'grayconcrete')
  b.box(x + 4, z, 1, 2, 1, 1, slabOf('smoothstone'))
}

// A wooden pier out over the water at y 0 from the quay, on log posts.
function pier(b, x0, x1, z0, d) {
  b.box(x0, z0, x1 - x0 + 1, d, 0, 0, 'oakplanks')
  for (let x = x0 + 1; x <= x1; x += 4) for (const z of [z0, z0 + d - 1]) b.box(x, z, 1, 1, -3, -1, 'oaklog')
  for (let x = x0 + 1; x <= x1; x += 2) for (const z of [z0, z0 + d - 1]) b.put(x, 1, z, 'oakfence')
}

function buildDocks(b) {
  const H = 61
  // Ground: concrete with gravel, the quay apron (yellow line at its edge),
  // a road and the container yard. Past x 22 is the sea.
  b.box(-H, -H, 2 * H + 1, 2 * H + 1, 0, 0, (x, z) => {
    if (x >= 23) return null
    if (x === 22) return 'yellowconcrete'
    if (x >= 14) return hash(x, z) < 0.08 ? 'gravel' : 'smoothstone'
    if (x >= 6 && x <= 10) return x === 8 && (z + H) % 4 < 2 ? 'whiteconcrete' : 'asphalt'
    if (x >= -16 && x <= 4 && z >= -37 && z <= -19) return hash(x, z) < 0.12 ? 'gravel' : 'smoothstone'
    if (x <= -30 && z >= 27) return hash(x, z) < 0.2 ? 'coarsedirt' : 'grass'
    return hash(x, z) < 0.18 ? 'gravel' : 'lightgrayconcrete'
  })

  // --- east: the sea, the quay wall, piers and the ship ---
  b.box(23, -H, H - 22, 2 * H + 1, -3, -3, 'sand')
  b.box(23, -H, H - 22, 2 * H + 1, -2, -1, 'water')
  b.box(22, -H, 1, 2 * H + 1, -3, -1, 'stonebricks')
  // Ladders up the quay wall out of the water.
  for (const z of [-26, -15, 4, 18, 32]) ladder(b, 23, z, -2, 0)
  // Bollards along the quay.
  for (let z = -36; z <= 36; z += 6) b.put(21, 1, z, 'polishedblackstone')
  pier(b, 23, 32, -32, 3)
  pier(b, 23, 34, 23, 3)
  // A rowing boat tied to the south pier.
  b.box(28, 27, 6, 3, -1, -1, (x, z) => (x === 28 || x === 33 || z === 27 || z === 29 ? 'spruceplanks' : 'oakplanks'))
  b.box(28, 27, 6, 3, 0, 0, (x, z) => (x === 28 || x === 33 || z === 27 || z === 29 ? 'spruceplanks' : null))
  b.box(30, 27, 1, 3, 0, 0, slabOf('oakplanks'))

  // The cargo ship: hull x 26-32 from z -24 (a pointed bow) to z 14, red
  // under the water line, dark blue above, a white rail; a hold below the
  // deck (y 2) with two hatches down into it.
  const hullW = (z) => (z >= -20 ? 3 : z >= -22 ? 2 : z === -23 ? 1 : 0)
  for (let z = -24; z <= 14; z++) {
    const w = hullW(z)
    for (let x = 29 - w; x <= 29 + w; x++) {
      // The hull's skin: its outer ring, plus any cell sticking out past
      // the row in front of it (the bow's steps).
      const side = Math.abs(x - 29) === w || z === -24 || z === 14 || Math.abs(x - 29) > hullW(z - 1)
      b.put(x, -3, z, 'blackconcrete')
      for (let y = -2; y <= 1; y++) b.put(x, y, z, side ? (y <= -1 ? 'redconcrete' : 'blueconcrete') : 'air')
      b.put(x, 2, z, side ? 'blueconcrete' : 'spruceplanks')
      const gangway = x === 26 && (z === -6 || z === -5)
      if (side && !gangway) b.put(x, 3, z, 'whiteconcrete')
    }
  }
  // Hatches: one with a ladder down the hull side, one open in the middle
  // (climb out by the ladder on the east wall).
  b.box(27, -12, 2, 3, 2, 2, 'air')
  ladder(b, 27, -11, -2, 2)
  b.box(30, 0, 2, 3, 2, 2, 'air')
  ladder(b, 31, 1, -2, 2)
  // Crates in the hold.
  for (const [x, z] of [[27, -18], [31, -15], [28, -4], [30, 6], [27, 10]]) b.box(x, z, 1, 2, -2, -1, 'crate')
  b.box(28, -8, 3, 1, -2, -2, 'barrel')
  // Containers on the deck, one stacked (ladder between them).
  containerZ(b, 27, -19, 3, 'orangeconcrete')
  containerZ(b, 30, -19, 3, 'blueconcrete')
  containerZ(b, 30, -19, 6, 'greenconcrete')
  ladder(b, 29, -16, 3, 8)
  containerZ(b, 30, -8, 3, 'redconcrete')
  containerZ(b, 27, -3, 3, 'yellowconcrete')
  // The mast at the bow.
  b.box(29, -22, 1, 1, 3, 9, 'sprucelog')
  b.put(29, 10, -22, 'sealantern')
  // The bridge at the stern: a white cabin with a window band, a ladder up
  // to its roof and a red funnel.
  b.box(27, 8, 5, 6, 3, 8, (x, z, y) => {
    const ring = x === 27 || x === 31 || z === 8 || z === 13
    if (!ring) return null
    if (z === 8 && x === 29 && y <= 4) return null
    return y === 7 ? 'glass' : 'whiteconcrete'
  })
  b.box(26, 7, 7, 8, 9, 9, 'whiteconcrete')
  for (let x = 26; x <= 32; x++) for (const z of [7, 14]) b.put(x, 10, z, 'whiteconcrete')
  for (let z = 7; z <= 14; z++) for (const x of [26, 32]) b.put(x, 10, z, 'whiteconcrete')
  ladder(b, 30, 12, 3, 9)
  b.box(28, 11, 2, 2, 10, 12, (x, z, y) => (y === 12 ? 'blackconcrete' : 'redconcrete'))
  b.box(28, 9, 3, 1, 3, 3, slabOf('darkoakplanks'))
  // The gangway from the quay up to the deck.
  b.box(23, -6, 1, 2, 0, 0, 'spruceplanks')
  stairs(b, 24, -6, 1, 0, 2, 2, 'spruceplanks')
  for (let x = 23; x <= 25; x++) for (const z of [-7, -4]) b.put(x, 1, z, 'oakfence')

  // Two gantry cranes over the quay and the water.
  gantry(b, -15)
  gantry(b, 16)

  // The lighthouse on the north-east point: red and white rings, a ladder
  // up the inside to a lamp room with an open balcony.
  b.box(15, -36, 5, 5, 1, 13, (x, z, y) => {
    const r = Math.hypot(x - 17, z + 34)
    if (r > 2.3) return null
    if (r < 1.5) return null
    if (x === 17 && z === -32 && y <= 2) return null
    return y === 13 ? 'smoothstone' : Math.floor((y - 1) / 3) % 2 ? 'whiteconcrete' : 'redconcrete'
  })
  b.box(14, -37, 7, 7, 13, 13, (x, z) => (Math.hypot(x - 17, z + 34) <= 3.3 ? 'smoothstone' : null))
  b.box(14, -37, 7, 7, 14, 14, (x, z) => {
    const r = Math.hypot(x - 17, z + 34)
    return r > 2.5 && r <= 3.3 && (x + z) % 2 === 0 ? 'oakfence' : null
  })
  b.box(16, -35, 3, 3, 14, 15, (x, z) => (x === 17 && z === -34 ? 'sealantern' : x === 17 || z === -34 ? null : 'glass'))
  b.box(16, -35, 3, 3, 16, 16, 'redconcrete')
  ladder(b, 17, -35, 1, 13)

  // --- north: the container yard (rows with lanes between, stacks to
  // climb by ladder, a Jump Pad onto the tallest) ---
  container(b, -16, -35, 1, 'redconcrete')
  container(b, -9, -35, 1, 'blueconcrete')
  container(b, -9, -35, 4, 'orangeconcrete')
  container(b, -2, -35, 1, 'greenconcrete')
  container(b, -2, -35, 4, 'redconcrete')
  container(b, -2, -35, 7, 'blueconcrete')
  ladder(b, 4, -35, 1, 9)
  container(b, -14, -30, 1, 'orangeconcrete')
  container(b, -7, -30, 1, 'yellowconcrete')
  container(b, 0, -30, 1, 'blueconcrete')
  container(b, 0, -30, 4, 'greenconcrete')
  container(b, -16, -25, 1, 'blueconcrete')
  container(b, -16, -25, 4, 'redconcrete')
  ladder(b, -10, -25, 1, 6)
  container(b, -8, -25, 1, 'greenconcrete')
  container(b, -1, -25, 1, 'redconcrete')
  container(b, -12, -21, 1, 'cyanconcrete')
  b.put(-4, 1, -32, 'jumppad')
  steps(b, -8, -27, 1, 0, 3, 1, 'crate')
  // A forklift and pallets by the yard.
  forklift(b, -3, -18)
  b.box(1, -18, 2, 2, 1, 1, slabOf('oakplanks'))
  b.box(1, -18, 2, 2, 2, 2, 'crate')
  // A trailer truck on the road.
  truck(b, 4, -10)

  // --- west: the big warehouse (racks of crates, a catwalk round two
  // walls, stairs and ladders up, a ladder on to the roof) ---
  building(b, { x0: -36, z0: -2, w: 24, d: 26, h: 9, wall: 'brick', trim: 'stonebricks', roof: 'grayconcrete', floor: 'smoothstone', doors: [['e', 9, 6, 5], ['n', 6, 2], ['s', 16, 2]], parapet: { type: 'stonebricks', gaps: [] } })
  for (let z = 7; z <= 12; z++) b.put(-13, 6, z, z % 2 ? 'yellowconcrete' : 'blackconcrete')
  // Racks: log posts, slab shelves, crates and barrels on them.
  for (const x of [-31, -27, -23, -19]) {
    for (let z = 4; z <= 18; z++) {
      if (z === 11) continue
      const post = z === 4 || z === 10 || z === 12 || z === 18
      for (let y = 1; y <= 4; y++) {
        if (post) b.put(x, y, z, 'sprucelog')
        else if (y === 2 || y === 4) b.put(x, y, z, slabOf('spruceplanks'))
        else if (hash(x * 7 + y, z) < 0.55) b.put(x, y, z, hash(z, x + y) < 0.3 ? 'barrel' : 'crate')
      }
    }
  }
  // The catwalk: along the north wall (3 wide) and the west wall (2 wide)
  // at y 5, with a fence on its open side.
  b.box(-35, -1, 22, 3, 5, 5, 'spruceplanks')
  b.box(-35, 2, 2, 21, 5, 5, 'spruceplanks')
  for (let x = -33; x <= -16; x++) b.put(x, 6, 2, 'oakfence')
  for (let z = 3; z <= 22; z++) b.put(-33, 6, z, 'oakfence')
  stairs(b, -15, 6, 0, -1, 5, 2, 'spruceplanks')
  ladder(b, -35, 20, 1, 5)
  ladder(b, -35, 10, 6, 10)
  // A loading dock outside the big door: a truck backed up to it.
  truck(b, -10, 12)
  b.box(-12, 4, 1, 2, 1, 2, 'crate')
  b.box(-12, 17, 2, 1, 1, 1, 'barrel')

  // --- south: the harbour office (two floors) and the fish market ---
  building(b, { x0: -8, z0: 26, w: 11, d: 9, h: 8, wall: 'whiteconcrete', trim: 'blueconcrete', roof: 'blueconcrete', floor: 'oakplanks', doors: [['n', 4, 2], ['w', 3, 2]], parapet: { type: 'whiteconcrete', gaps: [] } })
  b.box(-7, 27, 9, 7, 4, 4, (x, z) => (x >= 0 && z <= 29 ? null : 'oakplanks'))
  stairs(b, 1, 32, 0, -1, 3, 1, 'oakplanks')
  b.box(-6, 32, 3, 1, 1, 1, slabOf('darkoakplanks'))
  b.put(-5, 1, 31, stairsOf('oakplanks'), 2)
  ladder(b, -7, 33, 5, 9)
  // The fish market: a striped awning on posts over slab stalls.
  for (const [x, z] of [[6, 28], [17, 28], [6, 35], [17, 35]]) b.box(x, z, 1, 1, 1, 3, 'sprucelog')
  b.box(6, 28, 12, 8, 4, 4, (x) => (x % 2 ? 'bluewool' : 'whitewool'))
  for (const z of [30, 33]) b.box(8, z, 8, 1, 1, 1, slabOf('spruceplanks'))
  for (let x = 8; x <= 15; x += 3) b.put(x, 1, 34, 'barrel')
  // Stacks of crates and barrels round the south quay.
  for (const [x, z, h] of [[14, 6, 2], [18, 9, 1], [15, 26, 1], [-3, 12, 2], [-20, 30, 1]]) b.box(x, z, 2, 2, 1, h, 'crate')
  for (const [x, z] of [[19, 3], [12, -4], [-24, -6], [-8, 20]]) b.box(x, z, 2, 1, 1, 1, 'barrel')
  // Trees by the office lawn and a bench.
  for (const [x, z] of [[-31, 30], [-25, 34], [-19, 31]]) tree(b, x, z)
  bench(b, -30, 29, 3, 'x', 'n')
  // Speed Pads down the road, Teleporter Pads between the far west and
  // the south quay.
  for (const z of [-24, 0, 22]) b.put(8, 1, z, 'speedpad')
  b.put(-30, 1, -14, 'teleporterpad')
  b.put(20, 1, 32, 'teleporterpad')
  docksOuter(b)
}

// --- the outer rings (2026-11-16, Gaymi: "make both maps even bigger and
// more detailed" - all three went from 81 x 81 to 121 x 121, about 1.5x).
// The old maps stay in the middle; each gets a ring of new places round
// them (x or z from about 45 out to 52 - past that the uneven edge).

// A jeep: 2 wide, 3 long along z, a windscreen.
function jeep(b, x, z) {
  b.box(x, z, 2, 3, 1, 1, 'greenconcrete')
  b.put(x, 2, z, 'blackstainedglass')
  b.put(x + 1, 2, z, 'blackstainedglass')
}

// An army tent along z: green canvas sloping to a ridge, open at both ends
// (5 wide, `d` deep).
function tent(b, x0, z0, d = 6) {
  for (let z = z0; z < z0 + d; z++) {
    for (let k = 0; k < 2; k++) {
      b.put(x0 + k, 1 + k, z, 'greenwool')
      b.put(x0 + 4 - k, 1 + k, z, 'greenwool')
    }
    b.put(x0 + 2, 3, z, 'greenwool')
  }
}

function smallTownOuter(b) {
  // --- north: a school and its playground, a fire station, a court ---
  building(b, { x0: -30, z0: -52, w: 20, d: 7, h: 5, wall: 'yellowterracotta', trim: 'whiteconcrete', roof: 'smoothstone', floor: 'oakplanks', doors: [['s', 9, 2], ['e', 3, 2]], parapet: { type: 'whiteconcrete', gaps: [[-30, -49]] } })
  ladder(b, -31, -49, 1, 6)
  // Desks and a blackboard.
  for (let x = -28; x <= -13; x += 3) for (const z of [-50, -48]) b.put(x, 1, z, slabOf('oakplanks'))
  b.box(-24, -51, 5, 1, 2, 3, 'blackconcrete')
  // The playground: a slide, swings.
  b.box(-8, -52, 5, 7, 0, 0, 'sand')
  stairs(b, -8, -47, 0, -1, 3, 1, 'oakplanks')
  b.box(-8, -50, 1, 1, 1, 3, 'oakplanks')
  b.put(-8, 1, -51, 'quartz')
  b.put(-8, 2, -51, stairsOf('quartz'), 0)
  b.put(-8, 1, -52, stairsOf('quartz'), 0)
  for (const z of [-52, -48]) b.box(-5, z, 1, 1, 1, 3, 'oakfence')
  b.box(-5, -52, 1, 5, 4, 4, 'sprucelog')
  for (const z of [-51, -49]) {
    b.box(-5, z, 1, 1, 2, 3, 'oakfence')
    b.put(-5, 1, z, slabOf('oakplanks'))
  }
  // The fire station: two big bays, a fire engine, a hose tower to climb.
  building(b, { x0: 6, z0: -52, w: 14, d: 7, h: 6, wall: 'redterracotta', trim: 'whiteconcrete', roof: 'grayconcrete', floor: 'polishedandesite', doors: [['s', 2, 4, 4], ['s', 8, 4, 4], ['w', 3, 1]] })
  b.box(9, -51, 2, 5, 1, 2, (x, z, y) => (z === -47 && y === 2 ? 'blackstainedglass' : 'redconcrete'))
  b.box(9, -51, 2, 3, 3, 3, 'whiteconcrete')
  b.box(15, -51, 2, 2, 1, 1, 'barrel')
  building(b, { x0: 20, z0: -52, w: 4, d: 4, h: 11, wall: 'brick', trim: 'stonebricks', roof: 'smoothstone', floor: 'polishedandesite', windows: 'open', doors: [['s', 1, 1]], parapet: { type: 'stonebricks' } })
  ladder(b, 21, -51, 1, 12)
  b.put(21, 12, -51, 'air')
  // A basketball court.
  b.box(28, -52, 17, 7, 0, 0, (x, z) => (x === 28 || x === 44 || z === -52 || z === -46 || x === 36 ? 'whiteconcrete' : 'cyanterracotta'))
  for (const [x, rim] of [[28, 29], [44, 43]]) {
    b.box(x, -49, 1, 1, 1, 4, 'polishedblackstone')
    b.put(x, 5, -49, 'whiteconcrete')
    b.put(rim, 4, -49, 'orangeterracotta')
  }
  for (const [x, z] of [[-40, -48], [-46, -46], [-48, -40], [-36, -50], [48, -45]]) pine(b, x, z)

  // --- west: a farm - barn, silo, fields, a windmill, a sheep pen ---
  building(b, { x0: -52, z0: -22, w: 7, d: 12, h: 5, wall: 'redterracotta', trim: 'whiteconcrete', roof: 'oakplanks', floor: 'spruceplanks', windows: null, doors: [['e', 4, 4, 4]] })
  gable(b, { x0: -52, z0: -22, w: 7, d: 12, h: 5, type: 'darkoakplanks', end: 'redterracotta', ridge: 'z' })
  b.box(-51, -21, 2, 3, 1, 2, 'haybale')
  b.box(-51, -14, 5, 3, 3, 3, slabOf('spruceplanks'))
  ladder(b, -51, -15, 1, 3)
  // The silo: climb the ladder for a long look over the fields.
  b.box(-52, -33, 7, 7, 1, 12, (x, z, y) => (Math.hypot(x + 49, z + 30) > 2.5 ? null : y === 12 ? 'grayconcrete' : 'lightgrayconcrete'))
  b.box(-51, -32, 5, 5, 13, 13, (x, z) => (Math.hypot(x + 49, z + 30) > 1.5 ? null : 'grayconcrete'))
  ladder(b, -49, -27, 1, 13)
  // Fields: rows of hay with paths between (the street runs through).
  for (const [z0, z1] of [[-9, -4], [4, 15]]) {
    b.box(-52, z0, 7, z1 - z0 + 1, 0, 0, 'coarsedirt')
    for (let x = -52; x <= -46; x += 2) for (let z = z0; z <= z1; z++) if (z !== 9) b.put(x, 1, z, 'haybale')
  }
  // A scarecrow.
  b.box(-49, 9, 1, 1, 1, 2, 'oakfence')
  b.put(-49, 3, 9, 'jackolantern')
  for (const z of [8, 10]) b.put(-49, 2, z, 'oakfence')
  // The windmill.
  b.box(-51, 26, 3, 3, 1, 9, 'cobblestone')
  b.box(-51, 26, 3, 3, 10, 10, 'spruceplanks')
  for (let i = -4; i <= 4; i++) {
    b.put(-50 + i, 8, 25, 'whitewool')
    b.put(-50, 8 + i, 25, 'whitewool')
  }
  b.put(-50, 8, 25, 'sprucelog')
  // A sheep pen with hay in it.
  for (let x = -52; x <= -46; x++) for (const z of [32, 40]) b.put(x, 1, z, 'oakfence')
  for (let z = 33; z <= 39; z++) if (z !== 36) b.put(-46, 1, z, 'oakfence')
  b.box(-51, 35, 2, 2, 1, 1, 'haybale')

  // --- east: a pond with a jetty, a radio tower, three houses ---
  b.box(46, -38, 7, 13, -1, 0, (x, z, y) => (Math.hypot((x - 50) / 4, (z + 32) / 6) > 1 ? null : y === -1 ? 'sand' : 'water'))
  b.box(46, -32, 4, 1, 0, 0, 'oakplanks')
  b.put(49, 1, -32, 'oakfence')
  building(b, { x0: 46, z0: -24, w: 5, d: 4, h: 3, wall: 'spruceplanks', trim: 'sprucelog', roof: 'spruceplanks', floor: 'spruceplanks', doors: [['w', 1, 1]] })
  // The radio tower: a ladder up its spine to a railed platform.
  for (const [x, z] of [[47, -14], [50, -14], [47, -11], [50, -11]]) b.box(x, z, 1, 1, 1, 14, 'metal')
  for (const y of [5, 9]) b.box(47, -14, 4, 4, y, y, (x, z) => (x === 47 || x === 50 || z === -14 || z === -11 ? 'metal' : null))
  b.box(47, -13, 1, 1, 1, 13, 'metal')
  b.box(47, -14, 4, 4, 14, 14, 'smoothstone')
  for (let x = 47; x <= 50; x++) for (let z = -14; z <= -11; z++) if ((x === 47 || x === 50 || z === -14 || z === -11) && !(x === 47 && z === -13)) b.put(x, 15, z, 'oakfence')
  b.box(49, -12, 1, 1, 15, 19, 'metal')
  b.put(49, 20, -12, 'redstonelamp')
  ladder(b, 46, -13, 1, 14)
  // Three houses, picket fences in front.
  const houses = [
    [5, 8, 'whiteterracotta', 'oaklog', 'roofshingles'],
    [16, 8, 'mudbricks', 'darkoaklog', 'thatch'],
    [27, 9, 'cyanterracotta', 'whiteconcrete', 'slateshingles'],
  ]
  for (const [z0, d, wall, trim, roof] of houses) {
    building(b, { x0: 46, z0, w: 7, d, h: 4, wall, trim, roof: 'oakplanks', floor: 'oakplanks', doors: [['w', 3, 2]] })
    gable(b, { x0: 46, z0, w: 7, d, h: 4, type: roof, end: wall, ridge: 'z' })
    b.put(51, 1, z0 + 1, 'bookshelf')
    b.put(47, 1, z0 + d - 2, slabOf('oakplanks'))
  }
  for (let z = 5; z <= 35; z++) if (![8, 9, 19, 20, 30, 31].includes(z)) b.put(45, 1, z, 'oakfence')

  // --- south: a motel, a cinema, a gazebo ---
  building(b, { x0: -40, z0: 46, w: 26, d: 7, h: 4, wall: 'pinkterracotta', trim: 'whiteconcrete', roof: 'smoothstone', floor: 'oakplanks', doors: [['n', 2, 1], ['n', 7, 1], ['n', 12, 1], ['n', 17, 1], ['n', 22, 1]], parapet: { type: 'whiteconcrete', gaps: [[-15, 48]] } })
  for (const x of [-35, -30, -25, -20]) b.box(x, 47, 1, 5, 1, 4, 'pinkterracotta')
  for (const x of [-38, -33, -28, -23, -18]) {
    b.box(x, 50, 2, 2, 1, 1, (bx) => (bx === x ? 'whitewool' : 'redwool'))
  }
  stairs(b, -14, 52, 0, -1, 5, 1, 'whiteconcrete')
  building(b, { x0: 6, z0: 46, w: 16, d: 7, h: 7, wall: 'redconcrete', trim: 'blackconcrete', roof: 'blackconcrete', floor: 'redwool', windows: null, doors: [['n', 6, 4, 3]] })
  b.box(10, 45, 8, 1, 4, 4, (x) => (x % 2 ? 'glowstone' : 'yellowconcrete'))
  b.box(9, 51, 10, 1, 2, 5, 'whiteconcrete')
  for (const z of [48, 49]) bench(b, 8, z, 12, 'x', 'n', 'darkoakplanks')
  b.box(30, 46, 5, 5, 0, 0, 'spruceplanks')
  for (const [x, z] of [[30, 46], [34, 46], [30, 50], [34, 50]]) b.box(x, z, 1, 1, 1, 3, 'oakfence')
  b.box(30, 46, 5, 5, 4, 4, slabOf('spruceplanks'))
  bench(b, 31, 48, 3, 'x', 's', 'spruceplanks')
  for (const [x, z] of [[47, 47], [40, 50], [-46, 46], [-50, 44]]) tree(b, x, z)
  // Street lamps round the ring road.
  for (const [x, z] of [[41, 20], [41, -20], [-41, 20], [-41, -20], [20, 41], [-20, 41], [20, -41], [-20, -41]]) lamp(b, x, z)
}

function militaryBaseOuter(b) {
  // --- north: the airstrip, a cargo plane you walk through, the tower ---
  b.box(-40, -52, 71, 7, 0, 0, (x, z) => (z === -49 && x % 6 < 3 ? 'whiteconcrete' : z === -52 || z === -46 ? 'yellowconcrete' : 'asphalt'))
  b.box(-12, -50, 14, 3, 1, 4, (x, z, y) => {
    if (x > -12 && x < 1 && z === -49 && (y === 2 || y === 3)) return null
    if (y === 3 && x % 2 === 0 && z !== -49) return 'lightbluestainedglass'
    return 'lightgrayconcrete'
  })
  for (const y of [2, 3]) {
    b.put(-12, y, -49, 'air')
    b.put(-8, y, -48, 'air')
  }
  b.put(2, 2, -49, 'blackstainedglass')
  b.box(-6, -56, 4, 13, 2, 2, (x, z) => (z >= -50 && z <= -48 ? null : 'lightgrayconcrete'))
  // A step up into the back and the side door.
  b.put(-13, 1, -49, slabOf('smoothstone'))
  b.put(-8, 1, -47, slabOf('smoothstone'))
  b.box(-12, -49, 1, 1, 5, 7, 'lightgrayconcrete')
  b.box(-12, -52, 2, 7, 4, 4, 'lightgrayconcrete')
  b.box(34, -52, 5, 5, 0, 0, 'polishedandesite')
  building(b, { x0: 34, z0: -52, w: 5, d: 5, h: 10, wall: 'lightgrayconcrete', trim: 'grayconcrete', roof: 'smoothstone', floor: 'polishedandesite', windows: 'lightbluestainedglass', doors: [['w', 2, 1]], parapet: { type: 'grayconcrete' } })
  ladder(b, 35, -51, 1, 11)
  b.put(35, 11, -51, 'air')
  b.box(36, -50, 1, 1, 12, 15, 'metal')
  b.put(36, 16, -50, 'redstonelamp')

  // --- west: an obstacle course ---
  b.box(-52, -36, 7, 73, 0, 0, (x, z) => (hash(x, z) < 0.4 ? 'coarsedirt' : 'dirt'))
  for (const z of [-30, -8, 14]) b.box(-52, z, 7, 1, 1, 1, 'spruceplanks')
  for (const z of [-24, 6]) {
    b.box(-52, z, 7, 1, 1, 3, 'spruceplanks')
    ladder(b, -49, z - 1, 1, 3)
    ladder(b, -49, z + 1, 1, 3)
  }
  for (let x = -52; x <= -46; x += 2) for (let z = -18; z <= -13; z += 2) b.put(x + ((z / 2) & 1), 1, z, 'blackconcrete')
  for (const x of [-51, -48]) {
    b.box(x, 20, 1, 7, 2, 2, 'sprucelog')
    for (const z of [20, 26]) b.put(x, 1, z, 'sprucelog')
  }
  watchtower(b, -51, 31)

  // --- east: the motor pool, a second helipad, more containers ---
  building(b, { x0: 46, z0: -30, w: 7, d: 20, h: 5, wall: 'metal', trim: 'grayconcrete', roof: 'grayconcrete', floor: 'smoothstone', windows: null, doors: [['w', 3, 4, 4], ['w', 12, 4, 4]], parapet: { type: 'grayconcrete', gaps: [[46, -20]] } })
  ladder(b, 45, -20, 1, 6)
  jeep(b, 48, -27)
  jeep(b, 48, -17)
  b.box(50, -22, 2, 2, 1, 2, 'crate')
  tank(b, 41, -6)
  b.box(44, 8, 9, 9, 0, 0, (x, z) => {
    if (Math.hypot(x - 48, z - 12) > 4.5) return null
    if ((Math.abs(x - 48) === 2 && Math.abs(z - 12) <= 2) || (z === 12 && Math.abs(x - 48) <= 2)) return 'yellowconcrete'
    return 'smoothstone'
  })
  b.box(44, 18, 2, 2, 1, 1, 'crate')
  container(b, 45, 30, 1, 'greenconcrete')
  container(b, 45, 33, 1, 'redconcrete')
  container(b, 45, 33, 4, 'blueconcrete')
  ladder(b, 44, 34, 1, 6)
  sandbags(b, 42, 24, 4, 1)

  // --- south: tents, the mess hall and a firing range ---
  for (const x of [-42, -34, -26]) tent(b, x, 46)
  building(b, { x0: -18, z0: 46, w: 16, d: 7, h: 4, wall: 'spruceplanks', trim: 'sprucelog', roof: 'spruceplanks', floor: 'oakplanks', doors: [['n', 7, 2], ['e', 3, 1]] })
  gable(b, { x0: -18, z0: 46, w: 16, d: 7, h: 4, type: 'greenconcrete', end: 'spruceplanks', ridge: 'x' })
  for (let x = -16; x <= -5; x += 4) b.box(x, 48, 3, 1, 1, 1, slabOf('oakplanks'))
  b.box(-16, 51, 3, 1, 1, 1, 'furnace')
  for (const [x0, len] of [[8, 10], [22, 10]]) sandbags(b, x0, 46, len, 1)
  for (let x = 10; x <= 36; x += 4) b.box(x, 51, 1, 1, 1, 2, 'target')
  for (const [x, z] of [[-48, -46], [46, 46], [-48, 44]]) pine(b, x, z)
}

function docksOuter(b) {
  // --- north: the truck depot and the gate on the road ---
  for (const [x, color] of [[-40, 'redconcrete'], [-28, 'blueconcrete'], [-16, 'orangeconcrete'], [-4, 'greenconcrete']]) {
    container(b, x, -50, 1, color)
    b.box(x + 6, -50, 2, 2, 1, 2, (bx, bz, y) => (y === 2 && bx === x + 7 ? 'blackstainedglass' : 'whiteconcrete'))
  }
  container(b, -28, -47, 1, 'yellowconcrete')
  container(b, -28, -47, 4, 'redconcrete')
  ladder(b, -29, -46, 1, 6)
  building(b, { x0: 12, z0: -50, w: 4, d: 4, h: 3, wall: 'whiteconcrete', trim: 'blackconcrete', roof: 'smoothstone', floor: 'polishedandesite', doors: [['w', 1, 1]] })
  b.box(11, -45, 1, 1, 1, 3, 'whiteconcrete')
  b.box(6, -45, 5, 1, 3, 3, (x) => (x % 2 ? 'redconcrete' : 'whiteconcrete'))
  for (let x = -40; x <= 0; x += 8) b.put(x, 1, -46, 'barrel')

  // --- west: coal heaps and a row of brick houses ---
  for (const [cx, cz] of [[-49, -38], [-49, -30]]) {
    for (let y = 1; y <= 3; y++) b.box(cx - 3 + y, cz - 3 + y, 7 - 2 * y, 7 - 2 * y, y, y, 'coalblock')
  }
  for (const [z0, wall] of [[6, 'brick'], [14, 'mudbricks'], [22, 'brick']]) {
    building(b, { x0: -52, z0, w: 7, d: 7, h: 5, wall, trim: 'stonebricks', roof: 'spruceplanks', floor: 'oakplanks', doors: [['e', 2, 2]] })
    gable(b, { x0: -52, z0, w: 7, d: 7, h: 5, type: 'slateshingles', end: wall, ridge: 'z' })
    b.put(-50, 1, z0 + 5, 'bookshelf')
    b.box(-51, z0 + 1, 2, 1, 1, 1, slabOf('oakplanks'))
  }

  // --- south: a seafood restaurant, boat sheds and stacked lobster pots ---
  building(b, { x0: -10, z0: 46, w: 12, d: 7, h: 4, wall: 'whiteterracotta', trim: 'blueconcrete', roof: 'oakplanks', floor: 'birchplanks', doors: [['n', 5, 2]] })
  gable(b, { x0: -10, z0: 46, w: 12, d: 7, h: 4, type: 'blueterracotta', end: 'whiteterracotta', ridge: 'x' })
  for (const x of [-8, -4, 0]) b.put(x, 1, 49, slabOf('birchplanks'))
  for (const x of [-7, -2, 3]) {
    b.put(x, 1, 44, slabOf('oakplanks'))
    b.put(x - 1, 1, 44, stairsOf('oakplanks'), 3)
  }
  for (const x0 of [-40, -30]) {
    building(b, { x0, z0: 46, w: 8, d: 7, h: 4, wall: 'spruceplanks', trim: 'sprucelog', roof: 'spruceplanks', floor: 'spruceplanks', windows: null, doors: [['n', 2, 4, 3]] })
    b.box(x0 + 2, 49, 3, 2, 1, 1, 'oakplanks')
  }
  b.box(10, 47, 3, 2, 1, 2, 'crate')
  b.put(11, 3, 47, 'crate')

  // --- east: a long pier out to a sea fort ---
  pier(b, 35, 43, 23, 3)
  b.box(42, 9, 3, 14, 0, 0, 'oakplanks')
  for (let z = 10; z <= 22; z += 4) for (const x of [42, 44]) b.box(x, z, 1, 1, -3, -1, 'oaklog')
  b.box(42, -8, 11, 17, -3, 0, (x, z, y) => (y === 0 ? 'sand' : 'stone'))
  b.box(42, -8, 11, 17, 1, 4, (x, z) => {
    const rim = x === 42 || x === 52 || z === -8 || z === 8
    if (!rim) return null
    // The gate (north of the pier) and arrow slits.
    if (z === 8 && x >= 42 && x <= 44) return null
    return 'stonebricks'
  })
  for (let x = 42; x <= 52; x++) for (let z = -8; z <= 8; z++) {
    const rim = x === 42 || x === 52 || z === -8 || z === 8
    if (rim && (x + z) % 2 === 0 && !(z === 8 && x <= 44)) b.put(x, 5, z, 'stonebricks')
  }
  // The walk round the top of the wall, a keep in the middle.
  b.box(43, -7, 9, 15, 4, 4, (x, z) => (x === 43 || x === 51 || z === -7 || z === 7 ? slabOf('stonebricks') : null))
  building(b, { x0: 46, z0: -2, w: 4, d: 4, h: 8, wall: 'stonebricks', trim: 'chiseledstonebricks', roof: 'stonebricks', floor: 'stone', windows: 'open', doors: [['w', 1, 2]], parapet: { type: 'stonebricks' } })
  ladder(b, 47, -1, 1, 9)
  b.put(47, 9, -1, 'air')
  stairs(b, 44, 5, 0, -1, 3, 1, 'stonebricks')
  b.box(49, 5, 2, 1, 1, 1, 'barrel')
  b.put(38, 0, -30, 'redconcrete')
  b.put(38, 0, 36, 'redconcrete')
}
