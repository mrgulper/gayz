// Map 3: a ready-made block city for the Map Editor, built only from the
// editor's existing block types (BLOCK_TYPES in BuildMode.js). Fully
// deterministic (seeded, no Math.random()) - the same map every time, so
// BuildMode only has to store a player's changes to it, not the whole map
// (see BuildMode's map3 save/load). Changing this file changes Map 3 for
// everyone: bump MAP3_EDITS_KEY in BuildMode.js along with it.
//
// Layout: the editor's 128x128 ground (x and z from -64 to 63, ground at
// y=-1, buildings from y=0 up). A ring of tall buildings of uneven height
// closes the city in along the map edge (the roads end in barricades
// against it). Inside, the streets are NOT a grid: a winding main avenue,
// a bending street, a diagonal, side streets of different lengths and a
// roundabout with a fountain cut the city into blocks of different sizes
// and shapes. Each block holds a safe zone, a park, a gas station, a
// parking lot, or several buildings of different shapes and heights that
// follow the block's outline.

const HALF = 64
const BORDER = 8 // depth of the ring of edge buildings
const ROAD_W = 3 // a cell is road when its center is within 3 of a road line
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

// Road center lines, as polylines of [x, z] points.
const avenueZ = (x) => 4 + Math.round(7 * Math.sin((x + 20) / 26))
function roadLines() {
  const avenue = []
  for (let x = -HALF; x <= HALF; x += 4) avenue.push([x, avenueZ(x)])
  const west = []
  for (let z = -HALF; z <= avenueZ(-28); z += 4) west.push([-28 + 4 * Math.sin(z / 14), z])
  west.push([-28, avenueZ(-28)])
  return [
    avenue, // winds east-west across the whole city
    west, // bends north from the avenue to the edge
    [[24, -HALF], [24, HALF]], // straight north-south
    [[-28, -34], [24, -30], [HALF, -27]], // north street, slightly angled
    [[-HALF, 50], [-6, avenueZ(-6)]], // diagonal from the south-west
    [[24, 40], [HALF, 45]], // short street off the east side
    [[-6, 36], [24, 32]], // a side street between the diagonal and the east street
  ]
}
// The roundabout sits where the straight east street crosses the avenue.
const ROUNDABOUT = [24.5, avenueZ(24) + 0.5]

export function generateMap3() {
  const cells = new Map()
  const doors = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const inMap = (x, z) => x >= -HALF && x < HALF && z >= -HALF && z < HALF
  // While a block of land is being filled in, nothing may spill outside
  // it (onto a road or a neighbor's sidewalk).
  let clipMask = null
  const set = (x, y, z, type) => {
    if (!inMap(x, z) || y < -3) return
    if (clipMask && !clipMask(x, z)) return
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
  const rand = rng(0x6a7a6)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1))

  // --- Street plan ---
  // Every cell gets a kind: road, plaza (the roundabout's middle), side
  // (sidewalk), edge (the outer ring) or lot (buildable land).
  const segs = []
  for (const line of roadLines()) {
    let acc = 0
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i]
      const [bx, bz] = line[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len > 0) segs.push({ ax, az, bx, bz, len, acc })
      acc += len
    }
  }
  const idx = (x, z) => (x + HALF) * (HALF * 2) + (z + HALF)
  const kind = new Array(HALF * 2 * HALF * 2)
  const lineDist = new Float32Array(kind.length)
  const lineAlong = new Float32Array(kind.length)
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      const px = x + 0.5
      const pz = z + 0.5
      let best = Infinity
      let along = 0
      for (const sg of segs) {
        const dx = sg.bx - sg.ax
        const dz = sg.bz - sg.az
        const t = Math.max(0, Math.min(1, ((px - sg.ax) * dx + (pz - sg.az) * dz) / (sg.len * sg.len)))
        const d = Math.hypot(px - (sg.ax + dx * t), pz - (sg.az + dz * t))
        if (d < best) {
          best = d
          along = sg.acc + t * sg.len
        }
      }
      const rd = Math.hypot(px - ROUNDABOUT[0], pz - ROUNDABOUT[1])
      let k = best < ROAD_W ? 'road' : 'lot'
      if (rd < 9.5 && rd >= 5) k = 'road'
      if (rd < 5) k = 'plaza'
      if (k === 'lot' && (Math.abs(px) > INNER || Math.abs(pz) > INNER)) k = 'edge'
      kind[idx(x, z)] = k
      lineDist[idx(x, z)] = rd < 10.5 ? 99 : best
      lineAlong[idx(x, z)] = along
    }
  }
  const kindAt = (x, z) => (inMap(x, z) ? kind[idx(x, z)] : 'out')
  const isRoad = (x, z) => kindAt(x, z) === 'road'
  // Sidewalks: land within 2 cells of a road or the plaza.
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      if (kind[idx(x, z)] !== 'lot') continue
      let near = false
      for (let dx = -SIDEWALK; dx <= SIDEWALK && !near; dx++) {
        for (let dz = -SIDEWALK; dz <= SIDEWALK; dz++) {
          const k = kindAt(x + dx, z + dz)
          if (k === 'road' || k === 'plaza') { near = true; break }
        }
      }
      if (near) kind[idx(x, z)] = 'side'
    }
  }

  // --- Ground ---
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      const k = kind[idx(x, z)]
      let type
      if (k === 'road') {
        type = rand() < 0.07 ? 'gravel' : rand() < 0.03 ? 'cobblestone' : 'asphalt'
        // Dashed yellow center line along every road (not in the roundabout).
        if (lineDist[idx(x, z)] < 0.75 && (lineAlong[idx(x, z)] % 8) < 4) type = 'yellowconcrete'
      } else if (k === 'side') type = rand() < 0.1 ? 'crackedstonebricks' : 'smoothstone'
      else if (k === 'plaza') type = 'polishedandesite'
      else {
        const r = rand()
        type = r < 0.06 ? 'coarsedirt' : r < 0.09 ? 'podzol' : 'grass'
      }
      set(x, -1, z, type)
    }
  }
  // The roundabout's fountain: a quartz basin (one block deep, with a
  // solid bottom) around a lit pillar.
  for (let x = -6; x <= 6; x++) {
    for (let z = -6; z <= 6; z++) {
      const cx = Math.floor(ROUNDABOUT[0]) + x
      const cz = Math.floor(ROUNDABOUT[1]) + z
      const rd = Math.hypot(cx + 0.5 - ROUNDABOUT[0], cz + 0.5 - ROUNDABOUT[1])
      if (rd < 2.6) {
        set(cx, -1, cz, 'water')
        set(cx, -2, cz, 'smoothquartz')
      } else if (rd < 3.6) set(cx, 0, cz, 'quartz')
      else if (rd < 4.6 && (cx + cz) % 3 === 0) set(cx, 0, cz, 'leaves')
    }
  }
  const fx = Math.floor(ROUNDABOUT[0])
  const fz = Math.floor(ROUNDABOUT[1])
  set(fx, -1, fz, 'quartzpillar')
  fill(fx, 0, fz, fx, 2, fz, 'quartzpillar')
  set(fx, 3, fz, 'sealantern')

  // --- Blocks of land ---
  // Each connected patch of lot cells (4-neighbors) is one city block.
  const regions = []
  const regionOf = new Int32Array(kind.length).fill(-1)
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      if (kind[idx(x, z)] !== 'lot' || regionOf[idx(x, z)] !== -1) continue
      const id = regions.length
      const cellsIn = []
      const stack = [[x, z]]
      regionOf[idx(x, z)] = id
      while (stack.length) {
        const [cx, cz] = stack.pop()
        cellsIn.push([cx, cz])
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + ox
          const nz = cz + oz
          if (kindAt(nx, nz) !== 'lot' || regionOf[idx(nx, nz)] !== -1) continue
          regionOf[idx(nx, nz)] = id
          stack.push([nx, nz])
        }
      }
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, sx = 0, sz = 0
      for (const [cx, cz] of cellsIn) {
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz)
        sx += cx; sz += cz
      }
      const size = cellsIn.length
      regions.push({
        id, x0, x1, z0, z1, size,
        cx: sx / size, cz: sz / size,
        fill: size / ((x1 - x0 + 1) * (z1 - z0 + 1)),
        has: (qx, qz) => inMap(qx, qz) && regionOf[idx(qx, qz)] === id,
      })
    }
  }

  // --- Small pieces used everywhere ---
  const tree = (x, z, big = false) => {
    const h = (big ? 6 : 4) + Math.floor(rand() * 2)
    const log = pick(['oaklog', 'oaklog', 'birchlog', 'sprucelog', 'darkoaklog'])
    // Never grow a tree through something already standing there.
    for (let y = 0; y <= h; y++) if (get(x, y, z)) return
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
  // mask: the cells this building may use (its block of land, which may
  // be curved along a road) - the footprint is cut to it before any wall
  // goes up, so walls always close. Buildings are never ruined: broken
  // tops and blown-out holes read as glitches, not as a ruined city.
  const building = (box, style, facade, mask = () => true) => {
    const { x0, x1, z0, z1 } = box
    let full = true
    for (let x = x0; x <= x1 && full; x++) for (let z = z0; z <= z1; z++) if (!mask(x, z)) { full = false; break }
    // Sloped roofs only sit on plain, whole rectangles - on an L (or a
    // rectangle clipped by a curving road) they come out as a staircase.
    const pitched = !!style.pitched && full
    const wall = pick(style.wall)
    const floors = pitched ? randInt(1, 2) : randInt(style.floors[0], style.floors[1])
    const shape = pitched ? 'rect' : pick(['rect', 'L', 'L', 'U', 'notch'])
    const baseFoot = footprintFor(x0, x1, z0, z1, shape)
    const foot = (x, z) => baseFoot(x, z) && mask(x, z)
    const tiers = [{ foot, from: 0, to: floors }]
    const inset = randInt(2, 3)
    // A setback only where the narrower top still leaves real rooms (and
    // room for a ladder) - a too-thin top tier had no inside at all.
    if (style.setback && floors >= 5 && x1 - x0 - 2 * inset >= 5 && z1 - z0 - 2 * inset >= 5) {
      const split = randInt(3, floors - 2)
      tiers[0].to = split
      tiers.push({ foot: (x, z) => foot(x, z) && x >= x0 + inset && x <= x1 - inset && z >= z0 + inset && z <= z1 - inset, from: split, to: floors })
    }
    const windowEvery = pick([2, 3, 3, 4])
    const top = floors * 4
    // Start from an empty lot: a tree (or anything else) placed here before
    // would otherwise be left standing inside the rooms, in the ladder's way.
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (foot(x, z)) for (let y = 0; y <= top + 8; y++) clear(x, y, z)
    }
    for (const tier of tiers) {
      const isWall = (x, z) => tier.foot(x, z) && (!tier.foot(x + 1, z) || !tier.foot(x - 1, z) || !tier.foot(x, z + 1) || !tier.foot(x, z - 1))
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          if (!tier.foot(x, z)) continue
          // Floors / ceilings.
          for (let f = tier.from; f <= tier.to; f++) {
            const y = f === 0 ? 0 : f * 4 - 1
            set(x, y, z, f === floors ? style.roof : style.floor)
          }
          if (!isWall(x, z)) continue
          const corner = [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([a, b]) => !tier.foot(x + a, z) && !tier.foot(x, z + b))
          const along = (tier.foot(x + 1, z) && tier.foot(x - 1, z)) ? x : z
          for (let y = Math.max(1, tier.from * 4); y < tier.to * 4; y++) {
            const level = y % 4
            let type = wall
            if (corner || level === 3) type = style.trim
            else if ((level === 1 || level === 2) && along % windowEvery !== 0) type = style.glass
            set(x, y, z, type)
          }
        }
      }
      // Roof rim on flat roofs.
      if (!pitched) {
        const y = tier.to * 4
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          if (isWall(x, z)) set(x, y, z, style.trim)
        }
      }
    }
    // Sloped roof: rises half a block per cell from both long sides (a
    // slab, then a full block, then a slab one higher...) to the ridge,
    // overhanging the walls by one block all round. The two short ends
    // are filled in with wall up to the roof line.
    if (pitched) {
      const alongX = x1 - x0 >= z1 - z0
      const [roofBlock, roofSlab] = pick([['darkoakplanks', 'darkoakslab'], ['spruceplanks', 'spruceslab'], ['brick', 'brickslab'], ['redterracotta', 'redterracottaslab'], ['deepslatetiles', 'deepslatetilesslab']])
      const lo0 = (alongX ? z0 : x0) - 1
      const hi0 = (alongX ? z1 : x1) + 1
      let ridge = 0
      for (let a = lo0; a <= hi0; a++) {
        const d = Math.min(a - lo0, hi0 - a)
        const y = top + Math.floor(d / 2)
        ridge = Math.max(ridge, y)
        const type = d % 2 === 0 ? roofSlab : roofBlock
        for (let b = (alongX ? x0 : z0) - 1; b <= (alongX ? x1 : z1) + 1; b++) {
          const [x, z] = alongX ? [b, a] : [a, b]
          set(x, y, z, type)
        }
        // Gable ends: wall under the roof line, inside the walls' width.
        if (a > lo0 && a < hi0) {
          for (const b of alongX ? [x0, x1] : [z0, z1]) {
            const [x, z] = alongX ? [b, a] : [a, b]
            for (let gy = top; gy < y; gy++) set(x, gy, z, wall)
          }
        }
      }
      // Chimney through the roof.
      const cx = alongX ? x0 + 2 : x0 + 1
      const cz = alongX ? z0 + 1 : z0 + 2
      fill(cx, top, cz, cx, ridge + 1, cz, 'brick')
    }
    // Front door: on a stretch of wall facing the street (the facade side
    // first, then the others), nearest the middle - never on a corner or
    // where the inside is just another wall (a thin arm of an L or U), and
    // only where the outside is open, so every building can be walked into.
    const midX = Math.floor((x0 + x1) / 2)
    const midZ = Math.floor((z0 + z1) / 2)
    const SIDES = { zmin: [0, -1, 0], zmax: [0, 1, 2], xmin: [-1, 0, 1], xmax: [1, 0, 3] }
    const interior = (x, z) => foot(x, z) && foot(x + 1, z) && foot(x - 1, z) && foot(x, z + 1) && foot(x, z - 1)
    let dx = null
    let dz = null
    let facing = 0
    let doorSide = facade
    for (const side of [facade, ...Object.keys(SIDES).filter((k) => k !== facade)]) {
      const [ox, oz, f] = SIDES[side]
      let best = Infinity
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        if (!foot(x, z) || foot(x + ox, z + oz)) continue
        if (!interior(x - ox, z - oz)) continue
        if (!foot(x + oz, z + ox) || !foot(x - oz, z - ox)) continue
        if (get(x + ox, 1, z + oz) || get(x + ox, 2, z + oz)) continue
        const dist = Math.abs(x - midX) + Math.abs(z - midZ)
        if (dist < best) {
          best = dist
          dx = x
          dz = z
        }
      }
      if (dx !== null) {
        facing = f
        doorSide = side
        break
      }
    }
    if (dx !== null) {
      clear(dx, 2, dz)
      door(dx, 1, dz, style.door, facing)
      // The ground floor sits a block above the street: a half-block step
      // outside the door, so you walk straight in instead of jumping.
      {
        const [sx, sz] = SIDES[doorSide]
        const keep = clipMask
        clipMask = null
        if (!get(dx + sx, 0, dz + sz)) set(dx + sx, 0, dz + sz, 'stoneslab')
        clipMask = keep
      }
      // Steps out of the door, and an awning over shop doors.
      if (style.awning) {
        const [ox, oz] = SIDES[doorSide]
        const color = pick(['redwool', 'greenwool', 'bluewool', 'yellowwool', 'orangewool'])
        for (let i = -2; i <= 2; i++) {
          const ax = dx + ox + (ox === 0 ? i : 0)
          const az = dz + oz + (oz === 0 ? i : 0)
          set(ax, 3, az, i & 1 ? 'whitewool' : color)
        }
      }
    }
    // Ladder up through every floor, just inside a wall of the TOP tier -
    // a tower that steps in higher up would otherwise leave the ladder
    // standing outside in the open above the step.
    const topFoot = tiers[tiers.length - 1].foot
    const inTop = (x, z) => topFoot(x, z) && topFoot(x + 1, z) && topFoot(x - 1, z) && topFoot(x, z + 1) && topFoot(x, z - 1)
    let lx = null
    let lz = null
    let wallSide = null
    for (let x = x0; x <= x1 && lx === null; x++) for (let z = z0; z <= z1; z++) {
      if (!inTop(x, z) || (dx !== null && Math.abs(x - dx) <= 1 && Math.abs(z - dz) <= 1)) continue
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([ox, oz]) => !inTop(x + ox, z + oz))
      if (side) {
        lx = x
        lz = z
        wallSide = [x + side[0], z + side[1]]
        break
      }
    }
    // Every building can be climbed: the ladder runs through every floor,
    // and on a flat roof on up through a hole in the roof, so the top of
    // even a one-floor shop is reachable. (A sloped roof's attic is too
    // low to stand in, so houses stop at their top floor.)
    const toRoof = !pitched
    if (lx === null) {
      // Nowhere away from the door: any inside spot against a wall will do.
      for (let x = x0; x <= x1 && lx === null; x++) for (let z = z0; z <= z1; z++) {
        if (!inTop(x, z) || (x === dx && z === dz)) continue
        const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([ox, oz]) => !inTop(x + ox, z + oz))
        if (side) {
          lx = x
          lz = z
          wallSide = [x + side[0], z + side[1]]
          break
        }
      }
    }
    if (lx !== null && (floors > 1 || toRoof)) {
      for (let f = 1; f < floors; f++) clear(lx, f * 4 - 1, lz)
      if (toRoof) clear(lx, top - 1, lz)
      const ladderTop = toRoof ? top : (floors - 1) * 4 + 3
      for (let y = 1; y < ladderTop; y++) {
        if (!get(lx, y, lz)) set(lx, y, lz, 'ladder')
        // Below a step-in, the top tier's wall isn't there yet: a support
        // column behind the ladder instead.
        if (!get(wallSide[0], y, wallSide[1])) set(wallSide[0], y, wallSide[1], style.trim)
      }
    }
    // Balconies: a slab ledge with a fence rail under some windows.
    if (style.balconies) {
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
    if (!pitched) {
      const y = tiers[tiers.length - 1].to * 4
      const tf = tiers[tiers.length - 1].foot
      for (let i = 0; i < 3; i++) {
        const rx = randInt(x0 + 2, x1 - 2)
        const rz = randInt(z0 + 2, z1 - 2)
        if (!tf(rx, rz)) continue
        // Keep the roof hatch clear.
        if (lx !== null && Math.abs(rx - lx) <= 2 && Math.abs(rz - lz) <= 2) continue
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
      // Never in the doorway or in front of the ladder.
      if (dx !== null && Math.abs(ix - dx) <= 1 && Math.abs(iz - dz) <= 1) continue
      if (lx !== null && Math.abs(ix - lx) <= 1 && Math.abs(iz - lz) <= 1) continue
      if (foot(ix, iz) && !get(ix, 1, iz)) set(ix, 1, iz, pick(style.props))
    }
  }

  // Which side of a block faces a street: the side with the most road
  // or sidewalk right outside it.
  const facadeOf = (region) => {
    const count = { zmin: 0, zmax: 0, xmin: 0, xmax: 0 }
    for (let x = region.x0; x <= region.x1; x++) {
      for (let z = region.z0; z <= region.z1; z++) {
        if (!region.has(x, z)) continue
        for (const [ox, oz, dir] of [[0, -1, 'zmin'], [0, 1, 'zmax'], [-1, 0, 'xmin'], [1, 0, 'xmax']]) {
          const k = kindAt(x + ox, z + oz)
          if (k === 'side' || k === 'road') count[dir]++
        }
      }
    }
    return Object.keys(count).reduce((a, b) => (count[b] > count[a] ? b : a))
  }

  // A city block: split into parcels of different widths along its street
  // side, each with its own building cut to the block's outline (gaps
  // between them become alleys and yards).
  let styleTurn = 0
  const opposite = { zmin: 'zmax', zmax: 'zmin', xmin: 'xmax', xmax: 'xmin' }
  const cityBlock = (region, facadeOverride = null, area = region) => {
    const facade = facadeOverride || facadeOf(region)
    const alongX = facade === 'zmin' || facade === 'zmax'
    const a0 = (alongX ? area.x0 : area.z0) + 1
    const a1 = (alongX ? area.x1 : area.z1) - 1
    const b0 = (alongX ? area.z0 : area.x0) + 1
    const b1 = (alongX ? area.z1 : area.x1) - 1
    const towardFront = facade === 'zmin' || facade === 'xmin'
    // A deep block gets a row of buildings on its back side too, facing
    // the other way, instead of an empty field behind the front row.
    if (!facadeOverride && b1 - b0 > 30) {
      const mid = Math.floor((b0 + b1) / 2)
      const frontHalf = alongX
        ? { x0: area.x0, x1: area.x1, z0: towardFront ? area.z0 : mid + 1, z1: towardFront ? mid : area.z1 }
        : { x0: towardFront ? area.x0 : mid + 1, x1: towardFront ? mid : area.x1, z0: area.z0, z1: area.z1 }
      const backHalf = alongX
        ? { x0: area.x0, x1: area.x1, z0: towardFront ? mid + 1 : area.z0, z1: towardFront ? area.z1 : mid }
        : { x0: towardFront ? mid + 1 : area.x0, x1: towardFront ? area.x1 : mid, z0: area.z0, z1: area.z1 }
      cityBlock(region, facade, frontHalf)
      cityBlock(region, opposite[facade], backHalf)
      return
    }
    let a = a0
    while (a1 - a >= 5) {
      const left = a1 - a + 1
      const width = left <= 13 ? left : randInt(7, Math.min(15, left - 6))
      const p0 = a
      const p1 = a + width - 1
      a += width + randInt(1, 3)
      const style = STYLES[(styleTurn++ + randInt(0, 1)) % STYLES.length]
      const front = randInt(0, 2)
      const depth = Math.max(6, Math.min(18, (b1 - b0 + 1) - randInt(0, 6)))
      const d0 = towardFront ? b0 + front : b1 - front - depth + 1
      const d1 = d0 + depth - 1
      const box = alongX
        ? { x0: p0, x1: p1, z0: Math.max(b0, d0), z1: Math.min(b1, d1) }
        : { x0: Math.max(b0, d0), x1: Math.min(b1, d1), z0: p0, z1: p1 }
      if (style.name === 'house') {
        if (alongX) {
          box.x0 += 1; box.x1 -= 1
          if (towardFront) box.z0 += 2; else box.z1 -= 2
        } else {
          box.z0 += 1; box.z1 -= 1
          if (towardFront) box.x0 += 2; else box.x1 -= 2
        }
      }
      if (box.x1 - box.x0 < 5 || box.z1 - box.z0 < 5) continue
      // Only build where enough of the box is real land (a curve can eat it).
      let usable = 0
      for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) if (region.has(x, z)) usable++
      if (usable < 36) {
        const tx = Math.round((box.x0 + box.x1) / 2)
        const tz = Math.round((box.z0 + box.z1) / 2)
        if (region.has(tx, tz)) tree(tx, tz)
        continue
      }
      building(box, style, facade, region.has)
      // A tree in the gap after this building.
      const gx = alongX ? p1 + 2 : towardFront ? b0 + 1 : b1 - 1
      const gz = alongX ? (towardFront ? b0 + 1 : b1 - 1) : p1 + 2
      if (region.has(gx, gz) && !get(gx, 0, gz) && !get(gx, 1, gz) && rand() < 0.7) tree(gx, gz)
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

  // --- What goes on each block ---
  // The safe zone, gas station and parking lot need near-rectangular
  // blocks; the most irregular big blocks become parks; the rest are city.
  const roles = new Map()
  const taken = new Set()
  const pickRegion = (ok, score) => {
    let best = null
    for (const r of regions) {
      if (taken.has(r.id) || !ok(r)) continue
      if (!best || score(r) < score(best)) best = r
    }
    if (best) taken.add(best.id)
    return best
  }
  const rect = (min, max) => (r) => r.fill >= 0.88 && r.size >= min && r.size <= max && r.x1 - r.x0 >= 14 && r.z1 - r.z0 >= 14
  const safe = pickRegion(rect(300, 1200), (r) => Math.hypot(r.cx, r.cz))
  if (safe) roles.set(safe.id, 'safe')
  const gas = pickRegion(rect(250, 900), (r) => Math.hypot(r.cx - 30, r.cz + 10))
  if (gas) roles.set(gas.id, 'gas')
  const lotP = pickRegion(rect(250, 900), (r) => Math.hypot(r.cx + 20, r.cz - 25))
  if (lotP) roles.set(lotP.id, 'parking')
  for (let n = 0; n < 2; n++) {
    const pk = pickRegion((r) => r.size >= 200 && r.size <= 1100, (r) => r.fill)
    if (pk) roles.set(pk.id, 'park')
  }
  for (const region of regions) {
    clipMask = region.has
    const role = roles.get(region.id)
    if (role === 'safe') safeZone(region)
    else if (role === 'park') park(region)
    else if (role === 'gas') gasStation(region)
    else if (role === 'parking') parking(region)
    else if (region.size >= 80) cityBlock(region)
    else {
      // A scrap of land too small to build on: grass and a tree.
      const tx = Math.round(region.cx)
      const tz = Math.round(region.cz)
      if (region.has(tx, tz)) tree(tx, tz)
    }
    clipMask = null
  }

  // --- Street lamps and trees along the sidewalks, spaced out unevenly ---
  const sideCells = []
  for (let x = -INNER; x < INNER; x++) {
    for (let z = -INNER; z < INNER; z++) {
      if (kindAt(x, z) !== 'side') continue
      // Right at the curb (touching the road), away from the plaza.
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oz]) => isRoad(x + ox, z + oz))) continue
      if (Math.hypot(x - ROUNDABOUT[0], z - ROUNDABOUT[1]) < 12) continue
      sideCells.push([x, z])
    }
  }
  const placed = []
  for (let n = 0; n < sideCells.length * 3 && placed.length < 70; n++) {
    const [x, z] = sideCells[Math.floor(rand() * sideCells.length)]
    if (placed.some(([px, pz]) => Math.abs(px - x) + Math.abs(pz - z) < 9)) continue
    if (get(x, 0, z) || get(x, 1, z)) continue
    placed.push([x, z])
    if (placed.length % 2) {
      fill(x, 0, z, x, 3, z, 'stonefence')
      set(x, 4, z, 'redstonelamp')
    } else tree(x, z)
  }

  // --- Wrecked cars, parked along the roads ---
  for (let n = 0; n < 60 && n < 400; n++) {
    const x = randInt(-INNER + 2, INNER - 6)
    const z = randInt(-INNER + 2, INNER - 6)
    const d = lineDist[idx(x, z)]
    if (!isRoad(x, z) || d < 1 || d > 2.4) continue
    // Which way the road runs here.
    const alongX = isRoad(x + 3, z) && isRoad(x - 3, z) && !(isRoad(x, z + 3) && isRoad(x, z - 3))
    const alongZ = isRoad(x, z + 3) && isRoad(x, z - 3) && !(isRoad(x + 3, z) && isRoad(x - 3, z))
    if (!alongX && !alongZ) continue
    let fits = true
    for (let i = 0; i <= 4 && fits; i++) for (let j = 0; j <= 1; j++) {
      const cx = alongX ? x + i : x + j
      const cz = alongX ? z + j : z + i
      if (!isRoad(cx, cz) || get(cx, 0, cz)) fits = false
    }
    if (fits) car(x, z, alongX, pick(CAR_COLORS))
  }

  // --- The edge: a ring of tall buildings closing the city in ---
  // Walks the map edge in pieces of different widths and depths; each
  // piece is its own building (different height and material), so the
  // skyline around the city is uneven, not one flat wall. Where a road
  // runs into the edge, a barricade of stone and a wrecked car closes it.
  const EDGE_WALLS = ['brick', 'terracotta', 'lightgrayconcrete', 'sandstone', 'blackstone', 'grayconcrete', 'deepslatebricks', 'whiteterracotta', 'mudbricks']
  const edgeSides = [
    { alongX: true, edge: -HALF },
    { alongX: true, edge: HALF - 1 },
    { alongX: false, edge: -HALF },
    { alongX: false, edge: HALF - 1 },
  ]
  // Cells already taken by an edge building - two sides' buildings used to
  // overlap at the corners, walling each other's doors in.
  const edgeTaken = new Set()
  const edgeLand = (x, z) => kindAt(x, z) === 'edge' && !edgeTaken.has(x * 1000 + z)
  for (const side of edgeSides) {
    let a = -HALF
    while (a < HALF) {
      const width = randInt(5, 12)
      const a1 = Math.min(HALF - 1, a + width - 1)
      const depth = randInt(BORDER - 3, BORDER)
      const inward = side.edge < 0 ? 1 : -1
      const d0 = side.edge
      const d1 = side.edge + inward * (depth - 1)
      const box = side.alongX
        ? { x0: a, x1: a1, z0: Math.min(d0, d1), z1: Math.max(d0, d1) }
        : { x0: Math.min(d0, d1), x1: Math.max(d0, d1), z0: a, z1: a1 }
      let roadCells = 0
      let landCells = 0
      for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) {
        if (isRoad(x, z)) roadCells++
        else if (edgeLand(x, z)) landCells++
      }
      if (landCells >= 30) {
        const style = {
          wall: [pick(EDGE_WALLS)],
          trim: pick(['polishedandesite', 'smoothstone', 'grayconcrete', 'cutsandstone', 'polishedblackstone']),
          glass: pick(['glass', 'blackstainedglass', 'lightbluestainedglass']),
          floor: 'smoothstone',
          roof: 'grayconcrete',
          door: 'irondoor',
          props: ['barrel'],
          floors: [3, 7],
        }
        const facade = side.alongX ? (side.edge < 0 ? 'zmax' : 'zmin') : side.edge < 0 ? 'xmax' : 'xmin'
        building(box, style, facade, edgeLand)
        for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) if (edgeLand(x, z)) edgeTaken.add(x * 1000 + z)
      }
      if (roadCells) {
        // Barricade across the road end: a stone wall with a fence on top,
        // and a wrecked car pushed against it on the city side.
        let carSpot = null
        for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) {
          if (!isRoad(x, z)) continue
          const d = side.alongX ? Math.abs(z - side.edge) : Math.abs(x - side.edge)
          if (d === depth - 1) {
            set(x, 0, z, 'cobblestone')
            set(x, 1, z, 'cobblestone')
            set(x, 2, z, 'oakfence')
            if (!carSpot) carSpot = [x, z]
          }
        }
        if (carSpot) {
          const [cx, cz] = carSpot
          if (side.alongX) car(cx, cz + inward * (inward > 0 ? 1 : 2), true, pick(CAR_COLORS))
          else car(cx + inward * (inward > 0 ? 1 : 2), cz, false, pick(CAR_COLORS))
        }
      }
      a = a1 + 1
    }
  }

  // --- Rock walls along the very edge ---
  // Anywhere the edge ring left open (a road's end, the gap between two
  // edge buildings, a corner), a ragged wall of rock rises at the map's
  // border - tallest at the outside, lower inward - so the map never just
  // stops at empty sky, and nobody can walk or see out of it.
  const ROCKS = ['stone', 'stone', 'andesite', 'cobblestone', 'mossycobblestone', 'stone', 'gravel', 'deepslate']
  for (let x = -HALF; x < HALF; x++) {
    for (let z = -HALF; z < HALF; z++) {
      const d = Math.min(x + HALF, HALF - 1 - x, z + HALF, HALF - 1 - z)
      if (d > 2) continue
      if (get(x, 0, z)) continue
      const noise = Math.round(1.5 + Math.sin(x * 0.7 + z * 0.3) + Math.cos(z * 0.9 - x * 0.4))
      const h = [10, 7, 3][d] + noise
      for (let y = 0; y < h; y++) {
        if (!get(x, y, z)) set(x, y, z, y === h - 1 && d === 2 ? pick(['moss', 'gravel', 'stone']) : pick(ROCKS))
      }
    }
  }

  // A door that ended up facing a wall (a neighbor built right up against
  // it later - mostly where two sides of the edge ring meet) gets a second
  // door through that wall, so the two buildings connect instead.
  const DOOR_OUT = [[0, -1], [-1, 0], [0, 1], [1, 0]]
  for (const [k, facing] of [...doors]) {
    const [x, y, z] = k.split(',').map(Number)
    const [ox, oz] = DOOR_OUT[facing]
    const [nx, nz] = [x + ox, z + oz]
    // A tree's low leaves in front of a door are trimmed back.
    for (const cy of [y, y + 1]) if (get(nx, cy, nz) === 'leaves') clear(nx, cy, nz)
    if (!get(nx, y, nz) && !get(nx, y + 1, nz)) continue
    if (doors.has(key(nx, y, nz))) continue
    const [fx2, fz2] = [nx + ox, nz + oz]
    if (get(fx2, y, fz2) || get(fx2, y + 1, fz2) || !get(fx2, y - 1, fz2)) continue
    door(nx, y, nz, get(x, y, z), facing)
  }

  // Water never has an open side or bottom (rule 4): a deep cell whose
  // neighbor got cut off (a pond clipped by a road) becomes the sandy
  // bottom of the shallow water above it instead.
  let changed = true
  while (changed) {
    changed = false
    for (const [k, type] of [...cells]) {
      if (type !== 'water') continue
      const [x, y, z] = k.split(',').map(Number)
      const open = !get(x, y - 1, z) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oz]) => !get(x + ox, y, z + oz))
      if (open) {
        set(x, y, z, 'sand')
        changed = true
      }
    }
  }

  // Ladders need something behind them: drop any ladder block that ended
  // up with nothing solid beside it (a ruin's hole, a collapsed wall).
  const solidAt = (x, y, z) => {
    const t = get(x, y, z)
    return !!t && t !== 'ladder' && t !== 'water'
  }
  for (const [k, type] of [...cells]) {
    if (type !== 'ladder') continue
    const [x, y, z] = k.split(',').map(Number)
    if (!solidAt(x + 1, y, z) && !solidAt(x - 1, y, z) && !solidAt(x, y, z + 1) && !solidAt(x, y, z - 1)) clear(x, y, z)
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
