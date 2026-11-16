// Deathmatch maps (2026-11-16, Gaymi: "make the death match bigger and
// more realistic ... we could make map names lets start with the small
// town streets"). Each map has a name (shown when the round starts and on
// the minimap), a size, spawn points and a build() that puts its blocks.
//
// Small Town: 81 x 81 blocks (Gaymi picked "about 4x" the old 41 x 41).
// Two streets cross in the middle (asphalt, yellow lines, crosswalks,
// sidewalks, street lamps, parked cars and a bus); round them a General
// Store with a gas station and parking lot, houses with yards and hedges,
// a two-storey brick house, a Town Hall with columns, a park with a
// statue, a diner and a workshop with a catwalk. The store and the Town
// Hall have steps up to their roofs. A brick town wall all round.
//
// Coordinates are blocks round the arena's middle: x east, z south, y up
// from the floor (y 0 is the floor, people stand at y 1).

// [x, z, height of the floor under them]
const TOWN_SPAWNS = [
  [-37, -38, 0], [38, -39, 0], [-38, 38, 0], [38, 39, 0],
  [0, -36, 0], [0, 36, 0], [-36, 0, 0], [36, 0, 0],
  [-12, -24, 0], [12, -30, 0], [12, 29, 0], [-17, 14, 0], [27, 26, 0],
  [14, -11, 6], [-17, 14, 7],
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
    build: buildSmallTown,
  },
}

export const DM_MAP_IDS = Object.keys(DM_MAPS)
export const DEFAULT_DM_MAP = 'smallTown'

// A building: hollow walls with door and window gaps, a floor, a flat
// roof (and a low wall round it when people can get up there).
// doors: [side, offset along that side, width, height?]; sides n (low z),
// s (high z), w (low x), e (high x).
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
          if (windows === 'glass') b.put(x, y, z, 'glass')
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

function tree(b, x, z) {
  for (let y = 1; y <= 3; y++) b.put(x, y, z, 'oaklog')
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = 3; y <= 4; y++) if (dx || dz || y > 3) b.put(x + dx, y, z + dz, 'leaves')
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) b.put(x + dx, 5, z + dz, 'leaves')
}

function lamp(b, x, z) {
  for (let y = 1; y <= 3; y++) b.put(x, y, z, 'polishedblackstone')
  b.put(x, 4, z, 'sealantern')
}

// A low hedge from x0 to x1 along z, with a gap from g0 to g1.
function hedge(b, x0, x1, z, g0, g1) {
  for (let x = x0; x <= x1; x++) if (x < g0 || x > g1) b.put(x, 1, z, 'leaves')
}

function buildSmallTown(b) {
  const H = 40
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
  for (let x = 9; x <= 18; x += 3) b.box(x, -14, 2, 1, 1, 2, 'bookshelf')
  b.box(8, -9, 3, 1, 1, 1, 'oakplanks')
  steps(b, 22, -11, 0, -1, 6, 2, 'stonebricks')
  // Gas station: a canopy on four posts, two pumps.
  b.box(26, -16, 13, 10, 0, 0, 'smoothstone')
  for (const [x, z] of [[27, -15], [37, -15], [27, -8], [37, -8]]) b.box(x, z, 1, 1, 1, 4, 'whiteconcrete')
  b.box(27, -15, 11, 8, 5, 5, (x, z) => (x === 27 || x === 37 || z === -15 || z === -8 ? 'redconcrete' : 'whiteconcrete'))
  for (const x of [30, 34]) b.box(x, -12, 1, 1, 1, 2, 'redconcrete')
  // Parking lot.
  b.box(24, -38, 16, 19, 0, 0, (x, z) => ((x - 26) % 4 === 0 && (z <= -33 || z >= -25) ? 'whiteconcrete' : 'asphalt'))
  car(b, 27, -37, 'z', 'redconcrete')
  car(b, 35, -36, 'z', 'blueconcrete')
  car(b, 31, -24, 'z', 'whiteconcrete')
  car(b, 27, -23, 'z', 'grayconcrete')
  // A house behind the store.
  building(b, { x0: 7, z0: -34, w: 11, d: 9, h: 4, wall: 'birchplanks', trim: 'oaklog', roof: 'darkoakplanks', floor: 'oakplanks', doors: [['s', 4, 2], ['e', 3, 2]] })
  b.put(9, 1, -32, 'craftingtable')
  b.box(15, -33, 1, 2, 1, 1, 'redwool')
  tree(b, 21, -28)
  tree(b, 10, -21)

  // --- north-west: houses with yards ---
  building(b, { x0: -19, z0: -15, w: 11, d: 9, h: 4, wall: 'oakplanks', trim: 'oaklog', roof: 'darkoakplanks', floor: 'spruceplanks', doors: [['s', 4, 2], ['n', 6, 2]] })
  hedge(b, -19, -9, -5, -16, -13)
  b.box(-18, -14, 2, 1, 1, 1, 'redwool')
  b.put(-11, 1, -9, 'craftingtable')
  b.box(-10, -14, 1, 1, 5, 7, 'brick')
  building(b, { x0: -35, z0: -15, w: 11, d: 9, h: 4, wall: 'whiteconcrete', trim: 'grayconcrete', roof: 'grayconcrete', floor: 'oakplanks', doors: [['s', 4, 2], ['e', 3, 2]] })
  hedge(b, -35, -25, -5, -32, -29)
  b.box(-33, -14, 3, 1, 1, 2, 'bookshelf')
  b.put(-14, 1, -4, 'blueconcrete')
  // A two-storey brick house with stairs inside.
  building(b, { x0: -36, z0: -36, w: 15, d: 13, h: 8, wall: 'brick', trim: 'stonebricks', roof: 'smoothstone', floor: 'spruceplanks', doors: [['s', 6, 2], ['w', 5, 2]] })
  b.box(-35, -35, 13, 11, 4, 4, (x, z) => (x <= -32 && z <= -33 ? null : 'spruceplanks'))
  steps(b, -34, -35, 1, 0, 3, 2, 'spruceplanks')
  b.box(-25, -27, 2, 1, 5, 5, 'redwool')
  // A shed and a gravel path behind the houses.
  b.box(-40, -21, 37, 2, 0, 0, 'gravel')
  building(b, { x0: -18, z0: -30, w: 5, d: 5, h: 3, wall: 'spruceplanks', roof: 'spruceplanks', floor: 'spruceplanks', windows: null, doors: [['e', 1, 2]] })
  tree(b, -8, -22)
  tree(b, -23, -18)
  tree(b, -38, -18)
  tree(b, -10, -35)

  // --- south-west: the Town Hall and the park ---
  building(b, { x0: -27, z0: 7, w: 21, d: 15, h: 6, wall: 'quartz', trim: 'chiseledstonebricks', roof: 'smoothstone', floor: 'polisheddiorite', windows: 'open', doors: [['n', 9, 3], ['s', 9, 3], ['e', 6, 2], ['w', 3, 2]], parapet: { type: 'quartz', gaps: [[-27, 14], [-27, 15]] } })
  // Columns along the front holding up a porch roof.
  b.box(-27, 5, 21, 2, 7, 7, 'smoothstone')
  for (const x of [-25, -21, -13, -9]) b.box(x, 5, 1, 1, 1, 6, 'quartz')
  for (const [x, z] of [[-23, 11], [-11, 11], [-23, 17], [-11, 17]]) b.box(x, z, 1, 1, 1, 6, 'quartz')
  b.box(-20, 19, 7, 1, 1, 1, 'darkoakplanks')
  steps(b, -29, 20, 0, -1, 7, 2, 'chiseledstonebricks')
  // Park: gravel paths, trees, benches and a statue.
  b.box(-38, 31, 33, 1, 0, 0, 'gravel')
  b.box(-23, 25, 3, 15, 0, 0, 'gravel')
  b.box(-23, 30, 3, 3, 1, 1, 'stonebricks')
  b.box(-22, 31, 1, 1, 2, 4, 'polishedandesite')
  for (const [x, z] of [[-34, 28], [-28, 36], [-14, 28], [-9, 36], [-36, 37], [-17, 37]]) tree(b, x, z)
  b.box(-27, 29, 3, 1, 1, 1, 'oakslab')
  b.box(-18, 34, 3, 1, 1, 1, 'oakslab')

  // --- south-east: the diner, houses and the workshop ---
  b.box(6, 4, 15, 3, 0, 0, 'smoothstone')
  building(b, { x0: 6, z0: 7, w: 15, d: 10, h: 4, wall: 'whiteconcrete', trim: 'redconcrete', roof: 'redconcrete', floor: (x, z) => ((x + z) % 2 ? 'whiteconcrete' : 'blackconcrete'), doors: [['n', 6, 2], ['s', 3, 2]] })
  for (let x = 7; x <= 19; x += 2) b.put(x, 4, 7, 'sealantern')
  b.box(9, 13, 9, 1, 1, 1, 'oakplanks')
  b.box(8, 9, 1, 2, 1, 1, 'redwool')
  b.box(17, 9, 1, 2, 1, 1, 'redwool')
  building(b, { x0: 26, z0: 7, w: 11, d: 9, h: 4, wall: 'smoothsandstone', trim: 'cutsandstone', roof: 'brownconcrete', floor: 'oakplanks', doors: [['n', 4, 2], ['w', 3, 2]] })
  hedge(b, 26, 36, 5, 29, 32)
  building(b, { x0: 7, z0: 24, w: 11, d: 11, h: 4, wall: 'birchplanks', trim: 'oaklog', roof: 'darkoakplanks', floor: 'oakplanks', doors: [['n', 4, 2], ['e', 4, 2]] })
  b.put(9, 1, 32, 'craftingtable')
  // The workshop: a wide door, crates, a car and a catwalk up the back.
  building(b, { x0: 24, z0: 22, w: 15, d: 16, h: 6, wall: 'metal', trim: 'grayconcrete', roof: 'grayconcrete', floor: 'concrete', windows: null, doors: [['n', 4, 6, 4], ['w', 7, 2]] })
  b.box(25, 34, 13, 3, 3, 3, 'spruceplanks')
  steps(b, 26, 33, 1, 0, 3, 1, 'spruceplanks')
  for (const [x, z, h] of [[34, 25, 2], [35, 27, 1], [31, 29, 2], [26, 29, 1]]) b.box(x, z, 2, 2, 1, h, h > 1 ? 'spruceplanks' : 'oakplanks')
  car(b, 29, 24, 'z', 'orangeconcrete')
  for (const [x, z] of [[14, 20], [32, 19], [21, 38], [21, 29], [38, 19]]) tree(b, x, z)

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
