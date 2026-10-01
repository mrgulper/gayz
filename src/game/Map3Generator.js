// Map 3: a ready-made block city for the Map Editor, built only from the
// editor's existing block types (BLOCK_TYPES in BuildMode.js). Fully
// deterministic (seeded, no Math.random()) - the same map every time, so
// BuildMode only has to store a player's changes to it, not the whole map
// (see BuildMode's map3 save/load).
//
// Layout: the editor's 128x128 ground (x and z from -64 to 63, ground at
// y=-1, buildings from y=0 up), cut into a 4x4 grid of lots by three
// roads each way. The safe zone sits on the lot by the spawn point; the
// other lots are a park, a gas station, a parking lot, and apartments,
// houses, shops and warehouses - some of them ruined, like Map 1's city.

const HALF = 64
const ROAD_CENTERS = [-32, 0, 32]
const ROAD_HALF = 3 // road cells: center-3 .. center+2 (6 wide)
const SIDEWALK = 2

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function roadAt(v) {
  for (const c of ROAD_CENTERS) if (v >= c - ROAD_HALF && v < c + ROAD_HALF) return c
  return null
}

// The 4 lot ranges along one axis (inclusive), between the roads.
function lotRanges() {
  const edges = [-HALF, ...ROAD_CENTERS.flatMap((c) => [c - ROAD_HALF - 1, c + ROAD_HALF]), HALF - 1]
  const out = []
  for (let i = 0; i < edges.length; i += 2) out.push([edges[i], edges[i + 1]])
  return out
}

export function generateMap3() {
  const cells = new Map()
  const doors = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const set = (x, y, z, type) => {
    if (x < -HALF || x >= HALF || z < -HALF || z >= HALF || y < -1) return
    cells.set(key(x, y, z), type)
    doors.delete(key(x, y, z))
  }
  const clear = (x, y, z) => {
    cells.delete(key(x, y, z))
    doors.delete(key(x, y, z))
  }
  const get = (x, y, z) => cells.get(key(x, y, z))
  const fill = (x0, y0, z0, x1, y1, z1, type) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, type)
  }
  const door = (x, y, z, type, facing) => {
    clear(x, y + 1, z)
    set(x, y, z, type)
    doors.set(key(x, y, z), facing)
  }
  const rand = rng(0x6a7a3)
  const pick = (list) => list[Math.floor(rand() * list.length)]

  // --- Ground: roads, center lines, sidewalks, grass ---
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      const rx = roadAt(x)
      const rz = roadAt(z)
      let type
      if (rx !== null || rz !== null) {
        type = rand() < 0.08 ? 'gravel' : 'asphalt'
        // Dashed yellow center lines (not inside the crossings).
        if (rx !== null && rz === null && (x === rx - 1 || x === rx) && ((z + 64) & 7) < 4) type = 'yellowconcrete'
        if (rz !== null && rx === null && (z === rz - 1 || z === rz) && ((x + 64) & 7) < 4) type = 'yellowconcrete'
        // Crosswalk stripes just outside every crossing.
        for (const c of ROAD_CENTERS) {
          if (rz !== null && rx === null && [-5, -4, 3, 4].includes(x - c) && (z & 1) === 0) type = 'whiteconcrete'
          if (rx !== null && rz === null && [-5, -4, 3, 4].includes(z - c) && (x & 1) === 0) type = 'whiteconcrete'
        }
      } else {
        const r = rand()
        type = r < 0.06 ? 'coarsedirt' : r < 0.09 ? 'podzol' : 'grass'
      }
      set(x, -1, z, type)
    }
  }

  const lots = []
  for (const [x0, x1] of lotRanges()) for (const [z0, z1] of lotRanges()) lots.push({ x0, x1, z0, z1 })
  // Sidewalk ring around every lot.
  for (const lot of lots) {
    for (let x = lot.x0; x <= lot.x1; x++) {
      for (let z = lot.z0; z <= lot.z1; z++) {
        const edge = Math.min(x - lot.x0, lot.x1 - x, z - lot.z0, lot.z1 - z)
        const outer = x === -HALF || x === HALF - 1 || z === -HALF || z === HALF - 1
        if (edge < SIDEWALK && !outer) set(x, -1, z, rand() < 0.1 ? 'crackedstonebricks' : 'smoothstone')
      }
    }
  }

  // --- Street lamps along every road ---
  for (const c of ROAD_CENTERS) {
    for (let v = -HALF + 6; v < HALF - 4; v += 16) {
      if (roadAt(v) !== null) continue
      for (const [x, z] of [[c - ROAD_HALF - 1, v], [c + ROAD_HALF, v + 8], [v, c - ROAD_HALF - 1], [v + 8, c + ROAD_HALF]]) {
        if (roadAt(x) !== null || roadAt(z) !== null) continue
        fill(x, 0, z, x, 3, z, 'stonefence')
        set(x, 4, z, 'redstonelamp')
      }
    }
  }

  // --- Wrecked cars on the roads ---
  const car = (x, z, alongX, color) => {
    const [lx, lz] = alongX ? [4, 1] : [1, 4]
    fill(x, 0, z, x + lx, 0, z + lz, color)
    fill(x + (alongX ? 1 : 0), 1, z + (alongX ? 0 : 1), x + (alongX ? 3 : lx), 1, z + (alongX ? lz : 3), 'blackstainedglass')
    for (const [wx, wz] of [[x, z], [x + lx, z], [x, z + lz], [x + lx, z + lz]]) set(wx, 0, wz, 'blackconcrete')
  }
  for (let i = 0; i < 14; i++) {
    const c = pick(ROAD_CENTERS)
    const v = Math.floor(rand() * 110) - 56
    if (roadAt(v) !== null) continue
    const color = pick(['redconcrete', 'blueconcrete', 'whiteconcrete', 'grayconcrete', 'orangeconcrete', 'greenconcrete'])
    if (rand() < 0.5) car(c - 2 + Math.floor(rand() * 2), v, false, color)
    else car(v, c - 2 + Math.floor(rand() * 2), true, color)
  }

  // --- Lot contents ---
  // Which way a lot's front door faces: toward the nearest road.
  const frontOf = (lot) => {
    const cx = (lot.x0 + lot.x1) / 2
    const cz = (lot.z0 + lot.z1) / 2
    return Math.abs(cx) < Math.abs(cz) ? (cz < 0 ? 'zmax' : 'zmin') : cx < 0 ? 'xmax' : 'xmin'
  }

  const tree = (x, z) => {
    const h = 4 + Math.floor(rand() * 2)
    const log = pick(['oaklog', 'oaklog', 'birchlog', 'sprucelog'])
    const leaf = 'leaves'
    for (let y = h - 2; y <= h + 1; y++) {
      const r = y >= h + 1 ? 1 : 2
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.6) continue
        set(x + dx, y, z + dz, leaf)
      }
    }
    fill(x, 0, z, x, h, z, log)
  }

  const building = (lot, opts) => {
    const m = SIDEWALK + 1 + (opts.inset || 0)
    const x0 = lot.x0 + m
    const x1 = lot.x1 - m
    const z0 = lot.z0 + m
    const z1 = lot.z1 - m
    const floors = opts.floors
    const top = floors * 4
    const wall = opts.wall
    // Floors / ceilings.
    for (let f = 0; f <= floors; f++) {
      const y = f * 4 - (f === 0 ? 0 : 1)
      if (f === 0) fill(x0, 0, z0, x1, 0, z1, opts.floor)
      else fill(x0, y, z0, x1, y, z1, f === floors ? opts.roof : opts.floor)
    }
    // Walls with windows.
    for (let y = 1; y < top; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const onX = x === x0 || x === x1
          const onZ = z === z0 || z === z1
          if (!onX && !onZ) continue
          const corner = onX && onZ
          const along = onX ? z - z0 : x - x0
          const level = y % 4
          const isFloorLine = level === 3
          if (corner) set(x, y, z, opts.trim)
          else if (isFloorLine) set(x, y, z, opts.trim)
          else if ((level === 1 || level === 2) && along % 3 !== 0) set(x, y, z, opts.glass)
          else set(x, y, z, wall)
        }
      }
    }
    // Roof rim.
    for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) set(x, top, z, opts.trim)
    for (let z = z0; z <= z1; z++) for (const x of [x0, x1]) set(x, top, z, opts.trim)
    // Front door (two blocks tall), facing the road.
    const front = frontOf(lot)
    const midX = Math.floor((x0 + x1) / 2)
    const midZ = Math.floor((z0 + z1) / 2)
    const [dx, dz, facing] = front === 'zmin' ? [midX, z0, 2] : front === 'zmax' ? [midX, z1, 0] : front === 'xmin' ? [x0, midZ, 3] : [x1, midZ, 1]
    clear(dx, 2, dz)
    door(dx, 1, dz, opts.door, facing)
    // Stairs up: a ladder column in a back corner, with a hole in each floor.
    const lx = x0 + 1
    const lz = front === 'zmin' ? z1 - 1 : z0 + 1
    for (let f = 1; f <= floors; f++) clear(lx, f * 4 - 1, lz)
    for (let y = 1; y < top; y++) set(lx, y, lz, 'ladder')
    // A few things inside the ground floor.
    for (let i = 0; i < 4; i++) {
      const ix = x0 + 2 + Math.floor(rand() * Math.max(1, x1 - x0 - 3))
      const iz = z0 + 2 + Math.floor(rand() * Math.max(1, z1 - z0 - 3))
      if (!get(ix, 1, iz)) set(ix, 1, iz, pick(opts.props))
    }
    // Ruined: knock holes in the upper walls and floors, rubble outside.
    if (opts.ruined) {
      for (let i = 0; i < 6; i++) {
        const hx = x0 + Math.floor(rand() * (x1 - x0 + 1))
        const hz = z0 + Math.floor(rand() * (z1 - z0 + 1))
        const hy = 4 + Math.floor(rand() * Math.max(1, top - 4))
        const r = 1 + Math.floor(rand() * 2)
        for (let ax = -r; ax <= r; ax++) for (let ay = -r; ay <= r; ay++) for (let az = -r; az <= r; az++) {
          if (ax * ax + ay * ay + az * az <= r * r + 1) clear(hx + ax, hy + ay, hz + az)
        }
      }
      for (let i = 0; i < 10; i++) {
        const rx = x0 - 1 + Math.floor(rand() * (x1 - x0 + 3))
        const rz = z0 - 1 + Math.floor(rand() * (z1 - z0 + 3))
        if (!get(rx, 0, rz)) set(rx, 0, rz, pick(['cobblestone', 'gravel', 'mossycobblestone']))
      }
    }
  }

  const BUILDING_STYLES = [
    { name: 'apartment', wall: 'brick', trim: 'polishedandesite', glass: 'glass', floor: 'oakplanks', roof: 'smoothstone', door: 'oakdoor', props: ['bookshelf', 'craftingtable', 'barrel', 'whitewool'] },
    { name: 'office', wall: 'lightgrayconcrete', trim: 'grayconcrete', glass: 'lightbluestainedglass', floor: 'polisheddiorite', roof: 'grayconcrete', door: 'irondoor', props: ['bookshelf', 'barrel', 'noteblock'] },
    { name: 'shop', wall: 'sandstone', trim: 'cutsandstone', glass: 'glass', floor: 'birchplanks', roof: 'smoothsandstone', door: 'birchdoor', props: ['barrel', 'melon', 'pumpkin', 'haybale'] },
    { name: 'house', wall: 'spruceplanks', trim: 'sprucelog', glass: 'glass', floor: 'darkoakplanks', roof: 'darkoakplanks', door: 'sprucedoor', props: ['craftingtable', 'furnace', 'bookshelf', 'redwool'] },
    { name: 'warehouse', wall: 'cutcopper', trim: 'iron', glass: 'blackstainedglass', floor: 'smoothstone', roof: 'weatheredcopper', door: 'irondoor', props: ['barrel', 'barrel', 'haybale', 'iron'] },
  ]

  const safeZone = (lot) => {
    const x0 = lot.x0 + SIDEWALK
    const x1 = lot.x1 - SIDEWALK
    const z0 = lot.z0 + SIDEWALK
    const z1 = lot.z1 - SIDEWALK
    fill(x0, -1, z0, x1, -1, z1, 'gravel')
    // Walls with a gate facing the road.
    const front = frontOf(lot)
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue
      for (let y = 0; y < 3; y++) set(x, y, z, y === 2 ? 'mossystonebricks' : 'cobblestone')
      if ((x + z) % 2 === 0) set(x, 3, z, 'cobblestone')
    }
    const midX = Math.floor((x0 + x1) / 2)
    const midZ = Math.floor((z0 + z1) / 2)
    for (let i = -1; i <= 1; i++) for (let y = 0; y < 4; y++) {
      if (front === 'zmin' || front === 'zmax') clear(midX + i, y, front === 'zmin' ? z0 : z1)
      else clear(front === 'xmin' ? x0 : x1, y, midZ + i)
    }
    // Watch towers on the corners.
    for (const [tx, tz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      fill(tx, 0, tz, tx, 5, tz, 'oaklog')
      fill(tx - 1, 6, tz - 1, tx + 1, 6, tz + 1, 'oakplanks')
      set(tx, 7, tz, 'glowstone')
    }
    // Tents, supply crates, sandbags (hay) and a campfire.
    const cx = midX
    const cz = midZ
    for (const [ox, oz, color] of [[-6, -5, 'greenwool'], [3, -5, 'brownwool'], [-6, 4, 'greenwool']]) {
      for (let i = 0; i < 4; i++) fill(cx + ox + i, 0, cz + oz, cx + ox + i, 0, cz + oz + 2, color)
      fill(cx + ox, 1, cz + oz + 1, cx + ox + 3, 1, cz + oz + 1, color)
    }
    fill(cx + 4, 0, cz + 3, cx + 6, 0, cz + 4, 'barrel')
    set(cx + 5, 1, cz + 3, 'barrel')
    set(cx, 0, cz, 'magmablock')
    for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) set(cx + ox, 0, cz + oz, 'cobblestoneslab')
    for (let i = -3; i <= 3; i++) {
      if (front === 'zmin' || front === 'zmax') set(midX + i, 0, front === 'zmin' ? z0 + 3 : z1 - 3, Math.abs(i) <= 1 ? 'oakfence' : 'haybale')
      else set(front === 'xmin' ? x0 + 3 : x1 - 3, 0, midZ + i, Math.abs(i) <= 1 ? 'oakfence' : 'haybale')
    }
    set(cx - 2, 0, cz + 8, 'craftingtable')
    set(cx - 1, 0, cz + 8, 'furnace')
  }

  const park = (lot) => {
    const cx = Math.floor((lot.x0 + lot.x1) / 2)
    const cz = Math.floor((lot.z0 + lot.z1) / 2)
    for (let x = lot.x0 + SIDEWALK; x <= lot.x1 - SIDEWALK; x++) for (let z = lot.z0 + SIDEWALK; z <= lot.z1 - SIDEWALK; z++) {
      set(x, -1, z, 'grass')
      const d = Math.hypot(x - cx, (z - cz) * 1.3)
      if (d < 6) set(x, -1, z, 'water')
      else if (d < 7) set(x, -1, z, 'sand')
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      tree(Math.round(cx + Math.cos(a) * 10), Math.round(cz + Math.sin(a) * 9))
    }
    for (let x = lot.x0 + SIDEWALK; x <= lot.x1 - SIDEWALK; x++) {
      for (const z of [lot.z0 + SIDEWALK, lot.z1 - SIDEWALK]) if (x % 4) set(x, 0, z, 'oakfence')
    }
    set(cx + 8, 0, cz, 'oakslab')
    set(cx - 8, 0, cz, 'oakslab')
  }

  const gasStation = (lot) => {
    const x0 = lot.x0 + SIDEWALK + 1
    const x1 = lot.x1 - SIDEWALK - 1
    const z0 = lot.z0 + SIDEWALK + 1
    const z1 = lot.z1 - SIDEWALK - 1
    fill(x0, -1, z0, x1, -1, z1, 'asphalt')
    // Canopy on pillars over the pumps.
    const cx0 = x0 + 3
    const cx1 = x1 - 3
    const cz0 = z0 + 3
    const cz1 = z0 + 11
    for (const [px, pz] of [[cx0, cz0], [cx1, cz0], [cx0, cz1], [cx1, cz1]]) fill(px, 0, pz, px, 4, pz, 'whiteconcrete')
    fill(cx0, 5, cz0, cx1, 5, cz1, 'redconcrete')
    fill(cx0 + 1, 5, cz0 + 1, cx1 - 1, 5, cz1 - 1, 'whiteconcrete')
    for (let x = cx0 + 3; x <= cx1 - 3; x += 5) {
      fill(x, 0, cz0 + 4, x, 1, cz0 + 4, 'redconcrete')
      set(x, 2, cz0 + 4, 'sealantern')
    }
    // Small shop at the back.
    const sx0 = x0 + 2
    const sx1 = x1 - 2
    const sz0 = z1 - 7
    const sz1 = z1
    fill(sx0, 0, sz0, sx1, 0, sz1, 'polisheddiorite')
    for (let y = 1; y <= 3; y++) for (let x = sx0; x <= sx1; x++) for (let z = sz0; z <= sz1; z++) {
      if (x !== sx0 && x !== sx1 && z !== sz0 && z !== sz1) continue
      set(x, y, z, z === sz0 && y < 3 && x % 2 ? 'glass' : 'whiteconcrete')
    }
    fill(sx0, 4, sz0, sx1, 4, sz1, 'redconcrete')
    door(Math.floor((sx0 + sx1) / 2), 1, sz0, 'irondoor', 2)
    fill(sx0 + 2, 1, sz1 - 2, sx1 - 2, 1, sz1 - 2, 'barrel')
    set(x1, 0, z0, 'c4')
  }

  const parking = (lot) => {
    const x0 = lot.x0 + SIDEWALK
    const x1 = lot.x1 - SIDEWALK
    const z0 = lot.z0 + SIDEWALK
    const z1 = lot.z1 - SIDEWALK
    fill(x0, -1, z0, x1, -1, z1, 'asphalt')
    for (let x = x0 + 1; x < x1; x += 6) {
      for (let z = z0 + 1; z <= z1 - 1; z++) if (z !== Math.floor((z0 + z1) / 2)) set(x, -1, z, 'whiteconcrete')
    }
    for (let x = x0 + 2; x + 4 < x1; x += 6) {
      if (rand() < 0.6) car(x + 1, z0 + 2, false, pick(['redconcrete', 'blueconcrete', 'grayconcrete', 'yellowconcrete', 'blackconcrete']))
      if (rand() < 0.6) car(x + 1, z1 - 6, false, pick(['redconcrete', 'blueconcrete', 'grayconcrete', 'whiteconcrete']))
    }
    // Barricade of hay and fences across the middle.
    for (let x = x0 + 3; x < x1 - 3; x++) set(x, 0, Math.floor((z0 + z1) / 2), x % 3 ? 'oakfence' : 'haybale')
  }

  // Spawn is at the middle of the map, facing -z (see BuildMode's camera),
  // so the safe zone is the lot just ahead and left of it.
  const roles = new Map()
  const lotIndex = (x, z) => lots.findIndex((l) => x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1)
  roles.set(lotIndex(-10, -10), 'safe')
  roles.set(lotIndex(10, 10), 'park')
  roles.set(lotIndex(10, -10), 'gas')
  roles.set(lotIndex(-10, 10), 'parking')
  roles.set(lotIndex(-50, 50), 'park')
  lots.forEach((lot, i) => {
    const role = roles.get(i)
    if (role === 'safe') safeZone(lot)
    else if (role === 'park') park(lot)
    else if (role === 'gas') gasStation(lot)
    else if (role === 'parking') parking(lot)
    else {
      const style = pick(BUILDING_STYLES)
      const floors = style.name === 'house' || style.name === 'warehouse' ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 3)
      building(lot, { ...style, floors, inset: style.name === 'house' ? 2 : 0, ruined: rand() < 0.45 })
      // A couple of trees in the yard.
      for (let t = 0; t < 2; t++) {
        const tx = lot.x0 + SIDEWALK + 1 + Math.floor(rand() * 2) * (lot.x1 - lot.x0 - 2 * SIDEWALK - 2)
        const tz = lot.z0 + SIDEWALK + 1 + Math.floor(rand() * 2) * (lot.z1 - lot.z0 - 2 * SIDEWALK - 2)
        if (!get(tx, 0, tz) && !get(tx, 1, tz)) set(tx, 0, tz, pick(['leaves', 'haybale', 'barrel']))
      }
    }
  })

  const blocks = []
  for (const [k, type] of cells) {
    const [x, y, z] = k.split(',').map(Number)
    const facing = doors.get(k)
    blocks.push(facing === undefined ? { x, y, z, type } : { x, y, z, type, facing, open: false })
  }
  const hotbar = ['brick', 'cobblestone', 'oakplanks', 'glass', 'asphalt', 'smoothstone', 'oaklog', 'leaves', 'oakdoor', 'redstonelamp']
  return { blocks, hotbar }
}
