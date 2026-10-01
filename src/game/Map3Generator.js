// Map 3: a ready-made block city for the Map Editor, built only from the
// editor's existing block types (BLOCK_TYPES in BuildMode.js). Fully
// deterministic (seeded, no Math.random()) - the same map every time, so
// BuildMode only has to store a player's changes to it, not the whole map
// (see BuildMode's map3 save/load). Changing this file changes Map 3 for
// everyone: bump MAP3_EDITS_KEY in BuildMode.js along with it.
//
// Layout: the editor's 128x128 ground (x and z from -64 to 63, ground at
// y=-1, buildings from y=0 up). A ring of tall, uneven, partly collapsed
// buildings closes the city in along the map edge (the roads end in
// rubble against it). Inside, three roads each way cut it into lots; the
// lots hold a safe zone, parks, a gas station, a parking lot, and blocks
// split into several buildings of different shapes and heights - L-shapes,
// setbacks, pitched roofs, courtyards - so it doesn't read as a grid of
// identical boxes.

const HALF = 64
const BORDER = 8 // depth of the ring of edge buildings
const ROAD_CENTERS = [-30, 1, 30]
const ROAD_HALF = 3 // road cells: center-3 .. center+2 (6 wide)
const SIDEWALK = 2
const INNER = HALF - BORDER // inner city: -INNER .. INNER-1

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

// The 4 lot ranges along one axis (inclusive), between the roads and
// inside the edge ring.
function lotRanges() {
  const edges = [-INNER, ...ROAD_CENTERS.flatMap((c) => [c - ROAD_HALF - 1, c + ROAD_HALF]), INNER - 1]
  const out = []
  for (let i = 0; i < edges.length; i += 2) out.push([edges[i], edges[i + 1]])
  return out
}

export function generateMap3() {
  const cells = new Map()
  const doors = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const inMap = (x, z) => x >= -HALF && x < HALF && z >= -HALF && z < HALF
  const set = (x, y, z, type) => {
    if (!inMap(x, z) || y < -3) return
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
  // facing: which edge of its cell the door panel sits on - 0 = -z,
  // 1 = -x, 2 = +z, 3 = +x (BuildMode's _doorMatrix turns it 90 degrees
  // per step).
  const door = (x, y, z, type, facing) => {
    clear(x, y + 1, z)
    set(x, y, z, type)
    doors.set(key(x, y, z), facing)
  }
  const rand = rng(0x6a7a3)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1))

  // --- Ground: roads, center lines, crosswalks, grass ---
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      const rx = roadAt(x)
      const rz = roadAt(z)
      let type
      if (rx !== null || rz !== null) {
        type = rand() < 0.08 ? 'gravel' : rand() < 0.04 ? 'cobblestone' : 'asphalt'
        if (rx !== null && rz === null && (x === rx - 1 || x === rx) && ((z + 64) & 7) < 4) type = 'yellowconcrete'
        if (rz !== null && rx === null && (z === rz - 1 || z === rz) && ((x + 64) & 7) < 4) type = 'yellowconcrete'
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
  for (const lot of lots) {
    for (let x = lot.x0; x <= lot.x1; x++) {
      for (let z = lot.z0; z <= lot.z1; z++) {
        const edge = Math.min(x - lot.x0, lot.x1 - x, z - lot.z0, lot.z1 - z)
        if (edge < SIDEWALK) set(x, -1, z, rand() < 0.1 ? 'crackedstonebricks' : 'smoothstone')
      }
    }
  }

  // --- Small pieces used everywhere ---
  const tree = (x, z, big = false) => {
    const h = (big ? 6 : 4) + Math.floor(rand() * 2)
    const log = pick(['oaklog', 'oaklog', 'birchlog', 'sprucelog', 'darkoaklog'])
    const leaf = 'leaves'
    for (let y = h - 2; y <= h + 1; y++) {
      const r = y >= h + 1 ? 1 : big ? 3 : 2
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r + 1) continue
        if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.7) continue
        if (!get(x + dx, y, z + dz)) set(x + dx, y, z + dz, leaf)
      }
    }
    fill(x, 0, z, x, h, z, log)
  }
  const car = (x, z, alongX, color) => {
    const [lx, lz] = alongX ? [4, 1] : [1, 4]
    fill(x, 0, z, x + lx, 0, z + lz, color)
    fill(x + (alongX ? 1 : 0), 1, z + (alongX ? 0 : 1), x + (alongX ? 3 : lx), 1, z + (alongX ? lz : 3), 'blackstainedglass')
    for (const [wx, wz] of [[x, z], [x + lx, z], [x, z + lz], [x + lx, z + lz]]) set(wx, 0, wz, 'blackconcrete')
  }
  const CAR_COLORS = ['redconcrete', 'blueconcrete', 'whiteconcrete', 'grayconcrete', 'orangeconcrete', 'greenconcrete', 'blackconcrete', 'yellowconcrete']
  const rubble = (x, z, r) => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const h = Math.round(r - Math.hypot(dx, dz) + rand() * 1.2 - 0.4)
      for (let y = 0; y < h; y++) set(x + dx, y, z + dz, pick(['cobblestone', 'gravel', 'mossycobblestone', 'cobblestone', 'andesite']))
    }
  }

  // --- Buildings ---
  // A building is one or more stacked tiers; each tier is a footprint
  // (a test on x/z) over a run of floors, so upper tiers can step in.
  const STYLES = [
    { name: 'apartment', wall: ['brick', 'brick', 'terracotta'], trim: 'polishedandesite', glass: 'glass', floor: 'oakplanks', roof: 'smoothstone', door: 'oakdoor', props: ['bookshelf', 'craftingtable', 'barrel', 'whitewool'], floors: [3, 6], balconies: true },
    { name: 'office', wall: ['lightgrayconcrete', 'whiteconcrete', 'smoothquartz'], trim: 'grayconcrete', glass: 'lightbluestainedglass', floor: 'polisheddiorite', roof: 'grayconcrete', door: 'irondoor', props: ['bookshelf', 'barrel', 'noteblock'], floors: [4, 8], setback: true },
    { name: 'shop', wall: ['sandstone', 'redterracotta', 'whiteterracotta'], trim: 'cutsandstone', glass: 'glass', floor: 'birchplanks', roof: 'smoothsandstone', door: 'birchdoor', props: ['barrel', 'melon', 'pumpkin', 'haybale'], floors: [1, 2], awning: true },
    { name: 'house', wall: ['spruceplanks', 'birchplanks', 'whiteconcrete'], trim: 'sprucelog', glass: 'glass', floor: 'darkoakplanks', roof: 'darkoakplanks', door: 'sprucedoor', props: ['craftingtable', 'furnace', 'bookshelf', 'redwool'], floors: [1, 2], pitched: true },
    { name: 'warehouse', wall: ['cutcopper', 'weatheredcopper', 'blackstone'], trim: 'iron', glass: 'blackstainedglass', floor: 'smoothstone', roof: 'oxidizedcopper', door: 'irondoor', props: ['barrel', 'barrel', 'haybale', 'iron'], floors: [1, 2] },
  ]

  // Footprint shapes inside a box: a plain rectangle, an L, a U around a
  // courtyard, or a rectangle with a corner bitten out.
  const footprintFor = (x0, x1, z0, z1, shape) => {
    const w = x1 - x0 + 1
    const d = z1 - z0 + 1
    const cutX = x0 + Math.floor(w * (0.45 + rand() * 0.15))
    const cutZ = z0 + Math.floor(d * (0.45 + rand() * 0.15))
    const corner = randInt(0, 3)
    const inBox = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1
    if (shape === 'L' && w >= 9 && d >= 9) {
      return (x, z) => inBox(x, z) && !((corner & 1 ? x > cutX : x < cutX) && (corner & 2 ? z > cutZ : z < cutZ))
    }
    if (shape === 'U' && w >= 13 && d >= 11) {
      const cx0 = x0 + Math.floor(w / 3)
      const cx1 = x1 - Math.floor(w / 3)
      return (x, z) => inBox(x, z) && !(x >= cx0 && x <= cx1 && (corner & 1 ? z <= cutZ : z >= cutZ))
    }
    if (shape === 'notch' && w >= 8 && d >= 8) {
      const nx = corner & 1 ? x1 - 2 : x0 + 2
      const nz = corner & 2 ? z1 - 2 : z0 + 2
      return (x, z) => inBox(x, z) && !((corner & 1 ? x >= nx : x <= nx) && (corner & 2 ? z >= nz : z <= nz))
    }
    return inBox
  }

  // facade: the side facing the street ('xmin' / 'xmax' / 'zmin' / 'zmax').
  const building = (box, style, facade, ruined) => {
    const { x0, x1, z0, z1 } = box
    const wall = pick(style.wall)
    const floors = randInt(style.floors[0], style.floors[1])
    const shape = style.pitched ? pick(['rect', 'L']) : pick(['rect', 'L', 'L', 'U', 'notch'])
    const foot = footprintFor(x0, x1, z0, z1, shape)
    const tiers = [{ foot, from: 0, to: floors }]
    if (style.setback && floors >= 5) {
      const split = randInt(3, floors - 2)
      tiers[0].to = split
      const inset = randInt(2, 3)
      tiers.push({ foot: (x, z) => foot(x, z) && x >= x0 + inset && x <= x1 - inset && z >= z0 + inset && z <= z1 - inset, from: split, to: floors })
    }
    const windowEvery = pick([2, 3, 3, 4])
    const top = floors * 4
    // Jagged collapse line for ruined buildings: how tall each column
    // still stands.
    const standing = (x, z) => {
      if (!ruined) return Infinity
      const n = Math.sin(x * 0.9 + z * 0.4) + Math.sin(z * 1.3 - x * 0.2)
      return top - Math.max(0, Math.round((n + 1.2) * 2.4))
    }
    for (const tier of tiers) {
      const isWall = (x, z) => tier.foot(x, z) && (!tier.foot(x + 1, z) || !tier.foot(x - 1, z) || !tier.foot(x, z + 1) || !tier.foot(x, z - 1))
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          if (!tier.foot(x, z)) continue
          const maxY = standing(x, z)
          // Floors / ceilings.
          for (let f = tier.from; f <= tier.to; f++) {
            const y = f === 0 ? 0 : f * 4 - 1
            if (y > maxY) break
            set(x, y, z, f === floors ? style.roof : f === 0 ? style.floor : style.floor)
          }
          if (!isWall(x, z)) continue
          const corner = [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([a, b]) => !tier.foot(x + a, z) && !tier.foot(x, z + b))
          const along = (tier.foot(x + 1, z) && tier.foot(x - 1, z)) ? x : z
          for (let y = Math.max(1, tier.from * 4); y < tier.to * 4; y++) {
            if (y > maxY) break
            const level = y % 4
            let type = wall
            if (corner || level === 3) type = style.trim
            else if ((level === 1 || level === 2) && along % windowEvery !== 0) type = style.glass
            if (ruined && type === style.glass && rand() < 0.3) continue // smashed window
            set(x, y, z, type)
          }
        }
      }
      // Roof rim on flat roofs.
      if (!style.pitched) {
        const y = tier.to * 4
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          if (isWall(x, z) && y <= standing(x, z)) set(x, y, z, style.trim)
        }
      }
    }
    // Pitched roof: steps up from the two long sides to a ridge of slabs.
    if (style.pitched) {
      const alongX = x1 - x0 >= z1 - z0
      const span = alongX ? z1 - z0 : x1 - x0
      const roofMat = pick(['darkoakplanks', 'redterracotta', 'brick', 'spruceplanks'])
      for (let k = 0; ; k++) {
        const y = top + k
        const lo = (alongX ? z0 : x0) - 1 + k
        const hi = (alongX ? z1 : x1) + 1 - k
        if (hi < lo) break
        for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) {
          const across = alongX ? z : x
          if (across !== lo && across !== hi) continue
          const fx = Math.min(Math.max(x, x0), x1)
          const fz = Math.min(Math.max(z, z0), z1)
          if (!foot(fx, fz)) continue
          set(x, y, z, lo === hi || hi - lo === 1 ? 'darkoakslab' : roofMat)
        }
        // Gable ends are walls.
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          const across = alongX ? z : x
          const end = alongX ? x === x0 || x === x1 : z === z0 || z === z1
          if (end && foot(x, z) && across > (alongX ? z0 : x0) + k && across < (alongX ? z1 : x1) - k) set(x, y, z, wall)
        }
      }
      // Chimney.
      const cx = x0 + 1
      const cz = z0 + 1
      if (foot(cx, cz)) fill(cx, top, cz, cx, top + Math.ceil(span / 2) + 1, cz, 'brick')
    }
    // Front door, on the facade wall nearest the middle.
    const midX = Math.floor((x0 + x1) / 2)
    const midZ = Math.floor((z0 + z1) / 2)
    let dx
    let dz
    let facing
    if (facade === 'zmin' || facade === 'zmax') {
      dz = facade === 'zmin' ? z0 : z1
      dx = midX
      for (let i = 0; i < 8 && !foot(dx, dz); i++) dx += i % 2 ? i : -i
      facing = facade === 'zmin' ? 0 : 2
    } else {
      dx = facade === 'xmin' ? x0 : x1
      dz = midZ
      for (let i = 0; i < 8 && !foot(dx, dz); i++) dz += i % 2 ? i : -i
      facing = facade === 'xmin' ? 1 : 3
    }
    if (foot(dx, dz)) {
      clear(dx, 2, dz)
      door(dx, 1, dz, style.door, facing)
      // Steps out of the door, and an awning over shop doors.
      if (style.awning) {
        const [ox, oz] = facade === 'zmin' ? [0, -1] : facade === 'zmax' ? [0, 1] : facade === 'xmin' ? [-1, 0] : [1, 0]
        const color = pick(['redwool', 'greenwool', 'bluewool', 'yellowwool', 'orangewool'])
        for (let i = -2; i <= 2; i++) {
          const ax = dx + ox + (ox === 0 ? i : 0)
          const az = dz + oz + (oz === 0 ? i : 0)
          set(ax, 3, az, i & 1 ? 'whitewool' : color)
        }
      }
    }
    // Ladder up through every floor, in a corner just inside the walls.
    // (A cell inside the walls, so a wall is right behind it.)
    const inside = (x, z) => foot(x, z) && foot(x + 1, z) && foot(x - 1, z) && foot(x, z + 1) && foot(x, z - 1)
    let lx = null
    let lz = null
    for (const [cx, cz] of [[x0 + 1, z0 + 1], [x1 - 1, z1 - 1], [x1 - 1, z0 + 1], [x0 + 1, z1 - 1]]) {
      if (inside(cx, cz) && (Math.abs(cx - dx) > 1 || Math.abs(cz - dz) > 1)) {
        lx = cx
        lz = cz
        break
      }
    }
    if (lx !== null && floors > 1) {
      for (let f = 1; f < floors; f++) clear(lx, f * 4 - 1, lz)
      for (let y = 1; y < (floors - 1) * 4 + 3; y++) if (!get(lx, y, lz)) set(lx, y, lz, 'ladder')
    }
    // Balconies: a slab ledge with a fence rail under some windows.
    if (style.balconies && !ruined) {
      const [ox, oz] = facade === 'zmin' ? [0, -1] : facade === 'zmax' ? [0, 1] : facade === 'xmin' ? [-1, 0] : [1, 0]
      for (let f = 1; f < floors; f++) {
        if (rand() < 0.4) continue
        const along = ox === 0 ? randInt(x0 + 2, x1 - 3) : randInt(z0 + 2, z1 - 3)
        for (let i = 0; i < 3; i++) {
          const bx = ox === 0 ? along + i : (facade === 'xmin' ? x0 : x1) + ox
          const bz = oz === 0 ? along + i : (facade === 'zmin' ? z0 : z1) + oz
          if (!foot(bx - ox, bz - oz)) continue
          set(bx, f * 4, bz, 'stoneslab')
          set(bx, f * 4 + 1, bz, 'oakfence')
        }
      }
    }
    // Rooftop clutter on flat roofs: AC boxes and a water tank.
    if (!style.pitched && !ruined) {
      const y = tiers[tiers.length - 1].to * 4
      const tf = tiers[tiers.length - 1].foot
      for (let i = 0; i < 3; i++) {
        const rx = randInt(x0 + 2, x1 - 2)
        const rz = randInt(z0 + 2, z1 - 2)
        if (!tf(rx, rz)) continue
        if (i === 0 && floors >= 3) {
          fill(rx, y, rz, rx + 1, y + 1, rz + 1, 'barrel')
          set(rx, y + 2, rz, 'stonefence')
        } else set(rx, y, rz, pick(['iron', 'smoothstone', 'iron']))
      }
    }
    // A few things inside the ground floor.
    for (let i = 0; i < 4; i++) {
      const ix = randInt(x0 + 1, x1 - 1)
      const iz = randInt(z0 + 1, z1 - 1)
      if (foot(ix, iz) && !get(ix, 1, iz)) set(ix, 1, iz, pick(style.props))
    }
    if (ruined) {
      for (let i = 0; i < 4; i++) {
        const hx = randInt(x0, x1)
        const hz = randInt(z0, z1)
        const hy = randInt(4, Math.max(4, top - 2))
        const r = randInt(1, 2)
        for (let ax = -r; ax <= r; ax++) for (let ay = -r; ay <= r; ay++) for (let az = -r; az <= r; az++) {
          if (ax * ax + ay * ay + az * az <= r * r + 1) clear(hx + ax, hy + ay, hz + az)
        }
      }
      for (let i = 0; i < 3; i++) {
        const rx = randInt(x0 - 1, x1 + 1)
        const rz = randInt(z0 - 1, z1 + 1)
        if (!get(rx, 0, rz)) rubble(rx, rz, randInt(1, 2))
      }
    }
  }

  // Which side of a lot faces the city center's nearest road.
  const facadeOf = (lot) => {
    const cx = (lot.x0 + lot.x1) / 2
    const cz = (lot.z0 + lot.z1) / 2
    const near = (v) => Math.min(...ROAD_CENTERS.map((r) => Math.abs(r - v)))
    return near(cx) < near(cz) ? (cx < 0 ? 'xmax' : 'xmin') : cz < 0 ? 'zmax' : 'zmin'
  }

  // A city block: split into 1-3 parcels along its street side, each with
  // its own building (gaps between them become alleys and yards).
  let styleTurn = 0
  const cityBlock = (lot) => {
    const facade = facadeOf(lot)
    const alongX = facade === 'zmin' || facade === 'zmax'
    const a0 = (alongX ? lot.x0 : lot.z0) + SIDEWALK + 1
    const a1 = (alongX ? lot.x1 : lot.z1) - SIDEWALK - 1
    const b0 = (alongX ? lot.z0 : lot.x0) + SIDEWALK + 1
    const b1 = (alongX ? lot.z1 : lot.x1) - SIDEWALK - 1
    const parts = []
    let a = a0
    while (a1 - a >= 6) {
      const left = a1 - a + 1
      const width = left <= 13 ? left : randInt(7, Math.min(14, left - 7))
      parts.push([a, a + width - 1])
      a += width + randInt(1, 3)
    }
    for (const [p0, p1] of parts) {
      // Takes turns through the styles (with a little shuffle) so every
      // kind of building shows up somewhere.
      const style = STYLES[(styleTurn++ + randInt(0, 1)) % STYLES.length]
      // Different depths and setbacks from the sidewalk.
      const front = randInt(0, 2)
      const depth = Math.max(6, (b1 - b0 + 1) - randInt(0, 7))
      const towardFront = facade === 'zmin' || facade === 'xmin'
      const d0 = towardFront ? b0 + front : b1 - front - depth + 1
      const d1 = d0 + depth - 1
      const box = alongX
        ? { x0: p0, x1: p1, z0: Math.max(b0, d0), z1: Math.min(b1, d1) }
        : { x0: Math.max(b0, d0), x1: Math.min(b1, d1), z0: p0, z1: p1 }
      if (style.name === 'house') {
        // Houses sit back in a yard, with a tree out front.
        if (alongX) {
          box.x0 += 1; box.x1 -= 1
          if (towardFront) box.z0 += 2; else box.z1 -= 2
        } else {
          box.z0 += 1; box.z1 -= 1
          if (towardFront) box.x0 += 2; else box.x1 -= 2
        }
      }
      if (box.x1 - box.x0 < 5 || box.z1 - box.z0 < 5) continue
      building(box, style, facade, rand() < 0.4)
      // A tree or rubble in the gap after this building.
      const gx = alongX ? p1 + 2 : towardFront ? b0 + 1 : b1 - 1
      const gz = alongX ? (towardFront ? b0 + 1 : b1 - 1) : p1 + 2
      if (!get(gx, 0, gz) && !get(gx, 1, gz) && rand() < 0.7) tree(gx, gz)
    }
  }

  const safeZone = (lot) => {
    const x0 = lot.x0 + SIDEWALK
    const x1 = lot.x1 - SIDEWALK
    const z0 = lot.z0 + SIDEWALK
    const z1 = lot.z1 - SIDEWALK
    fill(x0, -1, z0, x1, -1, z1, 'gravel')
    const facade = facadeOf(lot)
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue
      // Patched-together wall: uneven height and mixed materials.
      const h = 3 + ((x * 7 + z * 3) % 3 === 0 ? 1 : 0)
      for (let y = 0; y < h; y++) set(x, y, z, pick(['cobblestone', 'cobblestone', 'mossystonebricks', 'oakplanks', 'mossycobblestone']))
    }
    const midX = Math.floor((x0 + x1) / 2)
    const midZ = Math.floor((z0 + z1) / 2)
    for (let i = -1; i <= 1; i++) for (let y = 0; y < 5; y++) {
      if (facade === 'zmin' || facade === 'zmax') clear(midX + i, y, facade === 'zmin' ? z0 : z1)
      else clear(facade === 'xmin' ? x0 : x1, y, midZ + i)
    }
    for (const [tx, tz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      fill(tx, 0, tz, tx, 5, tz, 'oaklog')
      fill(tx - 1, 6, tz - 1, tx + 1, 6, tz + 1, 'oakplanks')
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) set(tx + ox, 7, tz + oz, 'oakfence')
      set(tx, 7, tz, 'glowstone')
    }
    const cx = midX
    const cz = midZ
    for (const [ox, oz, color] of [[-7, -6, 'greenwool'], [3, -6, 'brownwool'], [-7, 4, 'greenwool'], [4, 5, 'graywool']]) {
      for (let i = 0; i < 4; i++) fill(cx + ox + i, 0, cz + oz, cx + ox + i, 0, cz + oz + 2, color)
      fill(cx + ox, 1, cz + oz + 1, cx + ox + 3, 1, cz + oz + 1, color)
    }
    fill(cx + 5, 0, cz - 1, cx + 6, 0, cz + 1, 'barrel')
    set(cx + 5, 1, cz, 'barrel')
    set(cx, 0, cz, 'magmablock')
    for (const [ox, oz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) set(cx + ox, 0, cz + oz, 'cobblestoneslab')
    for (let i = -3; i <= 3; i++) {
      if (facade === 'zmin' || facade === 'zmax') set(midX + i, 0, facade === 'zmin' ? z0 + 3 : z1 - 3, Math.abs(i) <= 1 ? 'oakfence' : 'haybale')
      else set(facade === 'xmin' ? x0 + 3 : x1 - 3, 0, midZ + i, Math.abs(i) <= 1 ? 'oakfence' : 'haybale')
    }
    set(cx - 2, 0, cz + 8, 'craftingtable')
    set(cx - 1, 0, cz + 8, 'furnace')
    tree(x1 - 3, z1 - 3)
  }

  // Ponds are two blocks deep with a solid bottom and sides, so nothing
  // falls out under the water.
  const pond = (cx, cz, rx, rz) => {
    for (let x = cx - rx - 2; x <= cx + rx + 2; x++) for (let z = cz - rz - 2; z <= cz + rz + 2; z++) {
      const wobble = Math.sin(x * 0.7) * 0.6 + Math.cos(z * 0.9) * 0.6
      const d = Math.hypot((x - cx) / rx, (z - cz) / rz) * (1 + wobble * 0.15)
      if (d < 0.65) {
        set(x, -1, z, 'water'); set(x, -2, z, 'water'); set(x, -3, z, pick(['sand', 'gravel', 'clay']))
      } else if (d < 1) {
        set(x, -1, z, 'water'); set(x, -2, z, pick(['sand', 'clay']))
      } else if (d < 1.25) set(x, -1, z, 'sand')
    }
  }

  const park = (lot) => {
    const cx = Math.floor((lot.x0 + lot.x1) / 2) + randInt(-2, 2)
    const cz = Math.floor((lot.z0 + lot.z1) / 2) + randInt(-2, 2)
    for (let x = lot.x0 + SIDEWALK; x <= lot.x1 - SIDEWALK; x++) for (let z = lot.z0 + SIDEWALK; z <= lot.z1 - SIDEWALK; z++) set(x, -1, z, rand() < 0.05 ? 'moss' : 'grass')
    // A winding gravel path across.
    for (let x = lot.x0 + SIDEWALK; x <= lot.x1 - SIDEWALK; x++) {
      const pz = Math.round(lot.z0 + 5 + Math.sin(x * 0.25) * 3)
      set(x, -1, pz, 'gravel'); set(x, -1, pz + 1, 'gravel')
    }
    pond(cx, cz + 3, randInt(5, 7), randInt(4, 5))
    for (let i = 0; i < 11; i++) {
      const tx = randInt(lot.x0 + 3, lot.x1 - 3)
      const tz = randInt(lot.z0 + 3, lot.z1 - 3)
      if (get(tx, -1, tz) === 'grass' && !get(tx, 0, tz)) tree(tx, tz, rand() < 0.3)
    }
    for (let i = 0; i < 6; i++) {
      const bx = randInt(lot.x0 + 3, lot.x1 - 3)
      const bz = randInt(lot.z0 + 3, lot.z1 - 3)
      if (get(bx, -1, bz) === 'gravel' && !get(bx, 0, bz)) set(bx, 0, bz, 'oakslab')
    }
  }

  const gasStation = (lot) => {
    const x0 = lot.x0 + SIDEWALK + 1
    const x1 = lot.x1 - SIDEWALK - 1
    const z0 = lot.z0 + SIDEWALK + 1
    const z1 = lot.z1 - SIDEWALK - 1
    fill(x0, -1, z0, x1, -1, z1, 'asphalt')
    const cx0 = x0 + 3
    const cx1 = x1 - 3
    const cz0 = z0 + 2
    const cz1 = z0 + 10
    for (const [px, pz] of [[cx0, cz0], [cx1, cz0], [cx0, cz1], [cx1, cz1]]) fill(px, 0, pz, px, 4, pz, 'whiteconcrete')
    fill(cx0, 5, cz0, cx1, 5, cz1, 'redconcrete')
    fill(cx0 + 1, 5, cz0 + 1, cx1 - 1, 5, cz1 - 1, 'whiteconcrete')
    for (let x = cx0 + 3; x <= cx1 - 3; x += 5) {
      fill(x, 0, cz0 + 4, x, 1, cz0 + 4, 'redconcrete')
      set(x, 2, cz0 + 4, 'sealantern')
    }
    car(cx0 + 2, cz0 + 6, true, 'blueconcrete')
    const sx0 = x0 + 1
    const sx1 = x1 - 5
    const sz0 = z1 - 7
    const sz1 = z1
    fill(sx0, 0, sz0, sx1, 0, sz1, 'polisheddiorite')
    for (let y = 1; y <= 3; y++) for (let x = sx0; x <= sx1; x++) for (let z = sz0; z <= sz1; z++) {
      if (x !== sx0 && x !== sx1 && z !== sz0 && z !== sz1) continue
      set(x, y, z, z === sz0 && y < 3 && x % 2 ? 'glass' : 'whiteconcrete')
    }
    fill(sx0, 4, sz0, sx1, 4, sz1, 'redconcrete')
    door(Math.floor((sx0 + sx1) / 2), 1, sz0, 'irondoor', 0)
    fill(sx0 + 2, 1, sz1 - 2, sx1 - 2, 1, sz1 - 2, 'barrel')
    // Price sign on a pole.
    fill(x1 - 1, 0, sz0, x1 - 1, 5, sz0, 'stonefence')
    fill(x1 - 2, 6, sz0, x1, 7, sz0, 'yellowconcrete')
    set(x1, 0, z0, 'c4')
  }

  const parking = (lot) => {
    const x0 = lot.x0 + SIDEWALK
    const x1 = lot.x1 - SIDEWALK
    const z0 = lot.z0 + SIDEWALK
    const z1 = lot.z1 - SIDEWALK
    fill(x0, -1, z0, x1, -1, z1, 'asphalt')
    for (let x = x0 + 1; x < x1; x += 6) {
      for (let z = z0 + 1; z <= z1 - 1; z++) if (Math.abs(z - (z0 + z1) / 2) > 2) set(x, -1, z, 'whiteconcrete')
    }
    for (let x = x0 + 2; x + 4 < x1; x += 6) {
      if (rand() < 0.65) car(x + 1, z0 + 2, false, pick(CAR_COLORS))
      if (rand() < 0.65) car(x + 1, z1 - 6, false, pick(CAR_COLORS))
    }
    for (let x = x0 + 3; x < x1 - 3; x++) set(x, 0, Math.floor((z0 + z1) / 2), x % 3 ? 'oakfence' : 'haybale')
    tree(x0 + 1, z0 + 1)
    tree(x1 - 1, z1 - 1)
  }

  const lotIndex = (x, z) => lots.findIndex((l) => x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1)
  const roles = new Map()
  roles.set(lotIndex(-12, -12), 'safe')
  roles.set(lotIndex(14, 14), 'park')
  roles.set(lotIndex(14, -12), 'gas')
  roles.set(lotIndex(-12, 14), 'parking')
  roles.set(lotIndex(-45, 45), 'park')
  lots.forEach((lot, i) => {
    const role = roles.get(i)
    if (role === 'safe') safeZone(lot)
    else if (role === 'park') park(lot)
    else if (role === 'gas') gasStation(lot)
    else if (role === 'parking') parking(lot)
    else cityBlock(lot)
  })

  // Street trees and lamps along the sidewalks, not on a strict grid.
  for (const lot of lots) {
    if (roles.get(lots.indexOf(lot)) === 'safe') continue
    for (let i = 0; i < 4; i++) {
      const side = randInt(0, 3)
      const x = side === 0 ? lot.x0 : side === 1 ? lot.x1 : randInt(lot.x0 + 3, lot.x1 - 3)
      const z = side === 2 ? lot.z0 : side === 3 ? lot.z1 : randInt(lot.z0 + 3, lot.z1 - 3)
      if (get(x, 0, z) || get(x, 1, z)) continue
      if (i % 2) {
        fill(x, 0, z, x, 3, z, 'stonefence')
        set(x, 4, z, 'redstonelamp')
      } else tree(x, z)
    }
  }

  // Wrecked cars on the roads.
  for (let i = 0; i < 16; i++) {
    const c = pick(ROAD_CENTERS)
    const v = randInt(-INNER + 2, INNER - 6)
    if (roadAt(v) !== null || roadAt(v + 4) !== null) continue
    if (rand() < 0.5) car(c - 2 + randInt(0, 1), v, false, pick(CAR_COLORS))
    else car(v, c - 2 + randInt(0, 1), true, pick(CAR_COLORS))
  }

  // --- The edge: a ring of tall, uneven buildings closing the city in ---
  // Walks the map edge in pieces of different widths; each piece is its
  // own building (different height, material and ruin), so the skyline
  // around the city is ragged, not one flat wall. Where a road meets the
  // edge, the gap is jammed with wrecked cars and rubble.
  const EDGE_WALLS = ['brick', 'terracotta', 'lightgrayconcrete', 'sandstone', 'blackstone', 'grayconcrete', 'deepslatebricks', 'whiteterracotta', 'mudbricks']
  const edgeSides = [
    { alongX: true, edge: -HALF },
    { alongX: true, edge: HALF - 1 },
    { alongX: false, edge: -HALF },
    { alongX: false, edge: HALF - 1 },
  ]
  for (const side of edgeSides) {
    let a = -HALF
    while (a < HALF) {
      const width = randInt(5, 11)
      const a1 = Math.min(HALF - 1, a + width - 1)
      const depth = randInt(BORDER - 3, BORDER)
      const inward = side.edge < 0 ? 1 : -1
      const d0 = side.edge
      const d1 = side.edge + inward * (depth - 1)
      const box = side.alongX
        ? { x0: a, x1: a1, z0: Math.min(d0, d1), z1: Math.max(d0, d1) }
        : { x0: Math.min(d0, d1), x1: Math.max(d0, d1), z0: a, z1: a1 }
      // Is a road running into this piece of the edge?
      let roadHere = false
      for (let v = a; v <= a1; v++) if (roadAt(v) !== null) roadHere = true
      if (roadHere) {
        // Barricade: collapsed rubble and cars across the road end.
        for (let v = a; v <= a1; v++) {
          for (let d = 0; d < depth; d++) {
            const x = side.alongX ? v : side.edge + inward * d
            const z = side.alongX ? side.edge + inward * d : v
            const h = Math.max(0, Math.round(depth - d - 1 + rand() * 2 - 1))
            for (let y = 0; y < h; y++) set(x, y, z, pick(['cobblestone', 'gravel', 'mossycobblestone', 'andesite', 'brick']))
          }
        }
        const v = a + 1
        const front = side.edge + inward * (depth + 1)
        if (side.alongX) car(v, Math.min(front, front + inward * 1), true, pick(CAR_COLORS))
        else car(Math.min(front, front + inward * 1), v, false, pick(CAR_COLORS))
      } else if (rand() < 0.15) {
        // A gap where a building has fully collapsed.
        for (let v = a; v <= a1; v++) for (let d = 0; d < depth; d++) {
          const x = side.alongX ? v : side.edge + inward * d
          const z = side.alongX ? side.edge + inward * d : v
          const h = Math.round((depth - d) * 0.9 + rand() * 2)
          for (let y = 0; y < h; y++) set(x, y, z, pick(['cobblestone', 'gravel', 'brick', 'mossycobblestone']))
        }
      } else {
        const style = {
          wall: [pick(EDGE_WALLS)],
          trim: pick(['polishedandesite', 'smoothstone', 'grayconcrete', 'cutsandstone', 'polishedblackstone']),
          glass: pick(['glass', 'blackstainedglass', 'lightbluestainedglass']),
          floor: 'smoothstone',
          roof: 'grayconcrete',
          door: 'irondoor',
          props: ['barrel'],
          floors: [3, 6],
        }
        // Faces into the city.
        const facade = side.alongX ? (side.edge < 0 ? 'zmax' : 'zmin') : side.edge < 0 ? 'xmax' : 'xmin'
        building(box, style, facade, rand() < 0.5)
      }
      a = a1 + 1
    }
  }

  // Grass gaps between the edge ring and the first lots get some weeds.
  for (let i = 0; i < 40; i++) {
    const x = randInt(-HALF + 2, HALF - 3)
    const z = randInt(-HALF + 2, HALF - 3)
    if (get(x, -1, z) === 'grass' && !get(x, 0, z)) set(x, 0, z, pick(['leaves', 'haybale', 'mossycobblestone']))
  }

  const blocks = []
  for (const [k, type] of cells) {
    const [x, y, z] = k.split(',').map(Number)
    const facing = doors.get(k)
    blocks.push(facing === undefined ? { x, y, z, type } : { x, y, z, type, facing, open: false })
  }
  const hotbar = ['brick', 'cobblestone', 'oakplanks', 'glass', 'asphalt', 'smoothstone', 'oaklog', 'leaves', 'oakdoor', 'invisible']
  return { blocks, hotbar }
}
