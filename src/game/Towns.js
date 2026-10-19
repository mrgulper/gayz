// Real cities as block towns (2026-10-18, Gaymi picked "real cities as
// towns": "make more human buildings, but those buildings must fit if they
// actually exist irl ... human-built things should use bricks, also make
// more buildings like skyscrapers"). Spawning from the map near one of
// CITIES builds a small town in that city's style around you - streets in a
// grid, a plaza in the middle (with the city's landmark from Landmarks.js
// when it has one), and buildings that fit the place:
//
//   modern    glass and steel skyscrapers, concrete office blocks
//             (New York, Chicago, Toronto, Dubai, Singapore, Shanghai...)
//   european  brick and plaster terraces, 3-5 floors, pitched roofs
//             (London, Paris, Amsterdam, Berlin, Rome, Madrid...)
//   asian     towers mixed with low houses under dark curved roofs
//             (Tokyo, Seoul, Beijing, Bangkok...)
//   desert    sandstone blocks with flat roofs, domes and minarets
//             (Cairo, Riyadh, Istanbul, Marrakesh...)
//   latin     bright painted concrete houses and a few towers
//             (Rio, Mexico City, Buenos Aires, Lima...)
//
// Like the landmarks, full cubes only, and it's this game's land only.

export const CITIES = [
  { name: 'New York', lat: 40.7, lon: -74, style: 'modern', landmark: 'liberty' },
  { name: 'Chicago', lat: 41.9, lon: -87.6, style: 'modern' },
  { name: 'Los Angeles', lat: 34.05, lon: -118.2, style: 'modern' },
  { name: 'Toronto', lat: 43.65, lon: -79.4, style: 'modern', landmark: 'cntower' },
  { name: 'Mexico City', lat: 19.4, lon: -99.1, style: 'latin' },
  { name: 'Mérida', lat: 20.97, lon: -89.6, style: 'latin', landmark: 'chichen' },
  { name: 'Rio de Janeiro', lat: -22.9, lon: -43.2, style: 'latin', landmark: 'christ' },
  { name: 'São Paulo', lat: -23.55, lon: -46.6, style: 'modern' },
  { name: 'Buenos Aires', lat: -34.6, lon: -58.4, style: 'latin' },
  { name: 'Lima', lat: -12.05, lon: -77, style: 'latin' },
  { name: 'London', lat: 51.5, lon: -0.1, style: 'european', landmark: 'bigben' },
  { name: 'Paris', lat: 48.85, lon: 2.35, style: 'european', landmark: 'eiffel' },
  { name: 'Amsterdam', lat: 52.37, lon: 4.9, style: 'european', landmark: 'windmill' },
  { name: 'Berlin', lat: 52.52, lon: 13.4, style: 'european', landmark: 'brandenburg' },
  { name: 'Rome', lat: 41.9, lon: 12.5, style: 'european', landmark: 'colosseum' },
  { name: 'Madrid', lat: 40.4, lon: -3.7, style: 'european' },
  { name: 'Athens', lat: 37.98, lon: 23.73, style: 'european', landmark: 'parthenon' },
  { name: 'Moscow', lat: 55.75, lon: 37.6, style: 'european', landmark: 'stbasil' },
  { name: 'Istanbul', lat: 41, lon: 29, style: 'desert' },
  { name: 'Cairo', lat: 30.05, lon: 31.25, style: 'desert', landmark: 'giza' },
  { name: 'Marrakesh', lat: 31.6, lon: -8, style: 'desert' },
  { name: 'Lagos', lat: 6.5, lon: 3.4, style: 'latin' },
  { name: 'Johannesburg', lat: -26.2, lon: 28, style: 'modern' },
  { name: 'Riyadh', lat: 24.7, lon: 46.7, style: 'desert' },
  { name: 'Dubai', lat: 25.2, lon: 55.3, style: 'modern', landmark: 'burj' },
  { name: 'Mumbai', lat: 19.07, lon: 72.9, style: 'modern' },
  { name: 'Agra', lat: 27.2, lon: 78, style: 'desert', landmark: 'tajmahal' },
  { name: 'Beijing', lat: 39.9, lon: 116.4, style: 'asian', landmark: 'greatwall' },
  { name: 'Shanghai', lat: 31.2, lon: 121.5, style: 'modern' },
  { name: 'Hong Kong', lat: 22.3, lon: 114.2, style: 'modern' },
  { name: 'Seoul', lat: 37.55, lon: 127, style: 'asian' },
  { name: 'Tokyo', lat: 35.7, lon: 139.7, style: 'asian', landmark: 'pagoda' },
  { name: 'Bangkok', lat: 13.75, lon: 100.5, style: 'asian' },
  { name: 'Singapore', lat: 1.3, lon: 103.8, style: 'modern' },
  { name: 'Jakarta', lat: -6.2, lon: 106.8, style: 'modern' },
  { name: 'Sydney', lat: -33.87, lon: 151.2, style: 'modern', landmark: 'opera' },
]

// A city near a map point (within NEAR_DEG degrees), or null.
const NEAR_DEG = 4
// A town look for any real city (the spawn map's cities from
// EarthProvinces, 2026-10-18): by its land and part of the world.
export function townStyleAt(lat, lon, biome) {
  if (biome === 'desert' || biome === 'badlands' || (lat > 12 && lat < 38 && lon > -18 && lon < 60)) return 'desert'
  if (lon > 60 && lon < 150 && lat > -12) return 'asian'
  if (lon > -120 && lon < -30 && lat < 32) return 'latin'
  if (lon > -25 && lon < 45 && lat > 35) return 'european'
  return 'modern'
}

export function cityNear(lat, lon) {
  let best = null
  let bestD = NEAR_DEG
  for (const c of CITIES) {
    const dLon = Math.abs(((lon - c.lon + 540) % 360) - 180) * Math.cos((lat * Math.PI) / 180)
    const d = Math.hypot(lat - c.lat, dLon)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

// The town's half size (blocks) and where you start in it: this far south
// of the middle, on the road that runs south, with open ground around you
// (SPAWN_CLEAR) - 2026-10-18, Gaymi: "dont make the start of the spawn the
// buildings around you just be bigger and further also not square should
// look more naturely".
export const TOWN_R = 96
export const TOWN_SPAWN = 58
const SPAWN_CLEAR = 18
const ROAD_HALF = 2.3 // roads are about 5 wide
const GAP = 4 // ground between neighbouring buildings

function prng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


// Not a square (2026-10-18, Gaymi: "don't make it a square shape"): the
// town's edge wanders in and out around the middle - a few smooth bumps
// per town, from its seed - so streets and buildings stop at an uneven
// line, and some lots are left as small green squares.
function outline(seed) {
  const r = prng(seed ^ 0x51ed)
  const waves = [1, 2, 3, 5].map((k) => ({ k, a: r() * 0.16 / Math.sqrt(k), p: r() * Math.PI * 2 }))
  return (dx, dz) => {
    const ang = Math.atan2(dz, dx)
    let f = 0.78
    for (const w of waves) f += w.a * Math.sin(ang * w.k + w.p)
    return Math.hypot(dx, dz) <= TOWN_R * f
  }
}

// The roads, as lines of points from the middle (town coordinates): a few
// winding roads out from the plaza in every direction (one always due
// south, past where you start) and a wobbly ring road between them.
function roadLines(seed, plazaR, edge) {
  const r = prng(seed ^ 0x2c1b)
  const lines = []
  const n = 5 + Math.floor(r() * 3)
  const turn = r() * Math.PI * 2
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI / 2 + (i * Math.PI * 2) / n + (i ? (r() - 0.5) * 0.5 : 0)
    const bend = 0.12 + r() * 0.16
    const ph = r() * Math.PI * 2
    const pts = []
    for (let d = plazaR; d <= TOWN_R + 4; d += 1) {
      const a = a0 + (i ? bend * Math.sin(d / 28 + ph) : 0)
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      if (d > plazaR + 4 && !edge(x, z, 6)) break
      pts.push([x, z])
    }
    lines.push(pts)
  }
  const ring = []
  const rr = TOWN_R * (0.48 + r() * 0.08)
  for (let k = 0; k <= 720; k++) {
    const a = (k / 720) * Math.PI * 2
    const d = rr * (1 + 0.09 * Math.sin(a * 3 + turn) + 0.05 * Math.sin(a * 5 + turn * 2))
    ring.push([Math.cos(a) * d, Math.sin(a) * d])
  }
  lines.push(ring)
  return lines
}

// Paints the roads (and the round plaza) at ground level, following the
// land; returns the set of road cells ("x,z").
function paveRoads(b, H, cx, cz, lines, plazaR, roadType, walkType) {
  const cells = new Map()
  const mark = (x, z, type) => {
    const k = `${x},${z}`
    if (cells.get(k) === roadType) return
    cells.set(k, type)
  }
  for (let x = -plazaR; x <= plazaR; x++) for (let z = -plazaR; z <= plazaR; z++) if (Math.hypot(x, z) <= plazaR) mark(cx + x, cz + z, walkType)
  for (const pts of lines) {
    for (const [px, pz] of pts) {
      for (let x = Math.floor(px - ROAD_HALF); x <= Math.ceil(px + ROAD_HALF); x++) {
        for (let z = Math.floor(pz - ROAD_HALF); z <= Math.ceil(pz + ROAD_HALF); z++) {
          const d = Math.hypot(x - px, z - pz)
          if (d <= ROAD_HALF) mark(cx + x, cz + z, d <= ROAD_HALF - 1 ? roadType : walkType)
        }
      }
    }
  }
  for (const [k, type] of cells) {
    const [x, z] = k.split(',').map(Number)
    const h = H(x, z).h
    if (h < -3) continue // not paving the sea
    b.set(x, h, z, type)
  }
  return cells
}

function tree(b, H, tx, tz) {
  const g = H(tx, tz).h
  if (g < -3) return
  b.set(tx, g, tz, 'grass')
  for (let y = g + 1; y <= g + 4; y++) b.set(tx, y, tz, 'oaklog')
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 3; dy <= 5; dy++) {
    if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy - 4) <= 3 && !(dx === 0 && dz === 0 && dy <= 4)) b.set(tx + dx, g + dy, tz + dz, 'leaves')
  }
}

// A box building on the lot (x0..x1, z0..z1): walls with windows, floors
// every 4 blocks inside, a door on the street side, a flat or pitched roof.
function building(b, H, earthAt, { x0, x1, z0, z1, floors, wall, trim, glass, roof, pitched, rand, door = 'z0' }) {
  let base = -Infinity
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) base = Math.max(base, H(x, z).h)
  if (base < -3) return
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = H(x, z).h + 1; y <= base; y++) b.set(x, y, z, earthAt(x, y, z, base))
  const top = base + floors * 4
  for (let y = base + 1; y <= top; y++) {
    const level = (y - base) % 4
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const edgeX = x === x0 || x === x1
        const edgeZ = z === z0 || z === z1
        if (!edgeX && !edgeZ) {
          if (level === 0) b.set(x, y, z, trim) // the floor of the next storey
          continue
        }
        const corner = edgeX && edgeZ
        const window = !corner && (level === 2 || (glass === 'curtain' && level !== 0)) && ((edgeX ? z : x) % 2 === 0 || glass === 'curtain')
        b.set(x, y, z, corner || level === 0 ? trim : window ? (glass === 'curtain' ? 'lightbluestainedglass' : glass) : wall)
      }
    }
  }
  // Door in the middle of the side facing the road.
  const mx = Math.floor((x0 + x1) / 2)
  const mz = Math.floor((z0 + z1) / 2)
  const [dx, dz] = door === 'z0' ? [mx, z0] : door === 'z1' ? [mx, z1] : door === 'x0' ? [x0, mz] : [x1, mz]
  b.clear(dx, base + 1, dz)
  b.clear(dx, base + 2, dz)
  // Roof.
  if (pitched) {
    const w = Math.floor((z1 - z0) / 2)
    for (let k = 0; k <= w; k++) for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 + k; z <= z1 - k; z++) b.set(x, top + 1 + k, z, roof)
  } else {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) b.set(x, top + 1, z, roof)
    if (rand() < 0.4) for (let y = top + 2; y < top + 2 + Math.floor(rand() * 6); y++) b.set(Math.floor((x0 + x1) / 2), y, Math.floor((z0 + z1) / 2), 'iron')
  }
}

function dome(b, cx, cy, cz, r, type) {
  for (let y = 0; y <= r; y++) {
    const rr = Math.sqrt(Math.max(0, r * r - y * y))
    for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) for (let z = Math.floor(cz - rr); z <= Math.ceil(cz + rr); z++) if (Math.hypot(x - cx, z - cz) <= rr) b.set(x, cy + y, z, type)
  }
}

const STYLE = {
  modern(lot, ctx) {
    const { rand } = ctx
    const tall = rand() < 0.6
    const walls = tall ? ['iron', 'grayconcrete', 'blackconcrete', 'lightgrayconcrete'] : ['concrete', 'whiteconcrete', 'lightgrayconcrete', 'brick']
    return { floors: tall ? 8 + Math.floor(rand() * 10) : 3 + Math.floor(rand() * 4), wall: walls[Math.floor(rand() * walls.length)], trim: tall ? 'grayconcrete' : 'smoothstone', glass: tall ? 'curtain' : 'glass', roof: 'smoothstone', pitched: false, inset: tall ? 2 : 1 }
  },
  european(lot, { rand }) {
    const walls = ['brick', 'brick', 'whiteterracotta', 'smoothsandstone', 'quartz']
    return { floors: 3 + Math.floor(rand() * 3), wall: walls[Math.floor(rand() * walls.length)], trim: rand() < 0.5 ? 'stonebricks' : 'smoothstone', glass: 'glass', roof: rand() < 0.5 ? 'blackconcrete' : 'redterracotta', pitched: true, inset: 0 }
  },
  asian(lot, { rand }) {
    if (rand() < 0.45) return { floors: 7 + Math.floor(rand() * 9), wall: rand() < 0.5 ? 'whiteconcrete' : 'grayconcrete', trim: 'blackconcrete', glass: 'curtain', roof: 'smoothstone', pitched: false, inset: 2 }
    return { floors: 1 + Math.floor(rand() * 2), wall: rand() < 0.5 ? 'darkoakplanks' : 'whiteconcrete', trim: 'darkoaklog', glass: 'glass', roof: 'blackconcrete', pitched: true, inset: 1 }
  },
  desert(lot, { rand }) {
    const walls = ['smoothsandstone', 'sandstone', 'cutsandstone', 'whiteterracotta']
    return { floors: 1 + Math.floor(rand() * 3), wall: walls[Math.floor(rand() * walls.length)], trim: 'cutsandstone', glass: 'glass', roof: 'smoothsandstone', pitched: false, inset: 1, dome: rand() < 0.3 }
  },
  latin(lot, { rand }) {
    if (rand() < 0.2) return { floors: 6 + Math.floor(rand() * 6), wall: 'whiteconcrete', trim: 'grayconcrete', glass: 'curtain', roof: 'smoothstone', pitched: false, inset: 2 }
    const walls = ['yellowconcrete', 'pinkconcrete', 'lightblueconcrete', 'orangeconcrete', 'limeconcrete', 'whiteconcrete']
    return { floors: 1 + Math.floor(rand() * 3), wall: walls[Math.floor(rand() * walls.length)], trim: 'whiteconcrete', glass: 'glass', roof: 'terracotta', pitched: false, inset: 1 }
  },
}

const ROADS = {
  modern: ['blackconcrete', 'lightgrayconcrete'],
  european: ['cobblestone', 'smoothstone'],
  asian: ['grayconcrete', 'smoothstone'],
  desert: ['sandstone', 'smoothsandstone'],
  latin: ['grayconcrete', 'whiteconcrete'],
}

// Builds a town of `style` centred on (cx, cz) into the Builder; the
// plaza (plazaR cells from the middle) is left open for the landmark.
// Buildings stand along the winding roads, set back from them with ground
// between neighbours, never near where you start (TOWN_SPAWN south of the
// middle), and trees fill some of the open ground.
export function buildTown(b, { H, cx, cz, style, plazaR, seed, earthAt }) {
  const make = STYLE[style] || STYLE.european
  const rand = prng(seed)
  const [road, walk] = ROADS[style] || ROADS.european
  const inside = outline(seed)
  const edge = (x, z, pad = 0) => inside(x * (TOWN_R / Math.max(1, TOWN_R - pad)), z * (TOWN_R / Math.max(1, TOWN_R - pad)))
  const lines = roadLines(seed, plazaR, edge)
  const roads = paveRoads(b, H, cx, cz, lines, plazaR, road, walk)
  const boxes = []
  const free = (x0, z0, x1, z1) => {
    for (const q of boxes) if (x0 - GAP <= q[2] && x1 + GAP >= q[0] && z0 - GAP <= q[3] && z1 + GAP >= q[1]) return false
    for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) if (roads.has(`${x},${z}`)) return false
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      if (!edge(x - cx, z - cz, 2)) return false
      if (Math.hypot(x - cx, z - cz) < plazaR + 3) return false
    }
    // Open ground round where you start.
    const nx = Math.max(x0, Math.min(cx, x1))
    const nz = Math.max(z0, Math.min(cz + TOWN_SPAWN, z1))
    return Math.hypot(nx - cx, nz - cz - TOWN_SPAWN) > SPAWN_CLEAR
  }
  for (const pts of lines) {
    for (let i = 4 + Math.floor(rand() * 8); i < pts.length - 2; i += 16 + Math.floor(rand() * 10)) {
      const [px, pz] = pts[i]
      const [qx, qz] = pts[Math.min(pts.length - 1, i + 2)]
      const len = Math.hypot(qx - px, qz - pz) || 1
      const nx = -(qz - pz) / len
      const nz = (qx - px) / len
      for (const side of [-1, 1]) {
        if (rand() < 0.15) continue
        const w = 9 + Math.floor(rand() * 9)
        const d = 9 + Math.floor(rand() * 7)
        const back = ROAD_HALF + 2 + Math.floor(rand() * 4) + Math.max(w, d) / 2
        const bx = Math.round(cx + px + nx * side * back)
        const bz = Math.round(cz + pz + nz * side * back)
        const x0 = bx - Math.floor(w / 2)
        const z0 = bz - Math.floor(d / 2)
        const x1 = x0 + w - 1
        const z1 = z0 + d - 1
        if (!free(x0, z0, x1, z1)) continue
        boxes.push([x0, z0, x1, z1])
        // The door faces the road.
        const door = Math.abs(nx) > Math.abs(nz) ? (nx * side > 0 ? 'x0' : 'x1') : (nz * side > 0 ? 'z0' : 'z1')
        const spec = make(null, { rand })
        // A storey taller than the old grid towns' low houses.
        building(b, H, earthAt, { x0, x1, z0, z1, rand, door, ...spec, floors: spec.floors + (spec.floors < 6 ? 1 : 0) })
        if (spec.dome) {
          let base = -Infinity
          for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) base = Math.max(base, H(x, z).h)
          dome(b, (x0 + x1) / 2, base + spec.floors * 4 + 2, (z0 + z1) / 2, Math.min(4, Math.min(w, d) / 2 - 1), 'smoothsandstone')
        }
      }
    }
  }
  // Trees on open ground here and there.
  for (let k = 0; k < 60; k++) {
    const a = rand() * Math.PI * 2
    const dist = plazaR + 4 + rand() * TOWN_R
    const tx = Math.round(cx + Math.cos(a) * dist)
    const tz = Math.round(cz + Math.sin(a) * dist)
    if (!edge(tx - cx, tz - cz) || !free(tx - 2, tz - 2, tx + 2, tz + 2)) continue
    boxes.push([tx - 2, tz - 2, tx + 2, tz + 2])
    tree(b, H, tx, tz)
  }
}
