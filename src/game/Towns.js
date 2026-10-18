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

// The town's half size (blocks), its street grid, and the plaza kept clear
// in the middle (for the landmark).
export const TOWN_R = 56
const BLOCK = 22 // one street block: a 5-wide street + a 17-wide lot
const STREET = 5

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

const mod = (a, n) => ((a % n) + n) % n

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

// The road and pavement at ground level, following the land.
function streets(b, H, cx, cz, plazaR, roadType, walkType, inside) {
  for (let x = cx - TOWN_R; x <= cx + TOWN_R; x++) {
    for (let z = cz - TOWN_R; z <= cz + TOWN_R; z++) {
      const lx = mod(x - cx + 2, BLOCK)
      const lz = mod(z - cz + 2, BLOCK)
      const inPlaza = Math.max(Math.abs(x - cx), Math.abs(z - cz)) <= plazaR
      const road = lx < STREET || lz < STREET
      if (!road && !inPlaza) continue
      if (!inPlaza && !inside(x - cx, z - cz)) continue
      const h = H(x, z).h
      if (h < -3) continue // not paving the sea
      const edge = (lx === 0 || lx === STREET - 1 || lz === 0 || lz === STREET - 1) && !inPlaza
      b.set(x, h, z, inPlaza ? walkType : edge ? walkType : roadType)
    }
  }
}

// A box building on the lot (x0..x1, z0..z1): walls with windows, floors
// every 4 blocks inside, a door on the street side, a flat or pitched roof.
function building(b, H, earthAt, { x0, x1, z0, z1, floors, wall, trim, glass, roof, pitched, rand }) {
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
  // Door in the middle of the front (low-z) side.
  const dx = Math.floor((x0 + x1) / 2)
  b.clear(dx, base + 1, z0)
  b.clear(dx, base + 2, z0)
  // Roof.
  if (pitched) {
    const w = Math.floor((z1 - z0) / 2)
    for (let k = 0; k <= w; k++) for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 + k; z <= z1 - k; z++) b.set(x, top + 1 + k, z, roof)
  } else {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) b.set(x, top + 1, z, roof)
    if (rand() < 0.4) for (let y = top + 2; y < top + 2 + Math.floor(rand() * 6); y++) b.set(Math.floor((x0 + x1) / 2), y, Math.floor((z0 + z1) / 2), 'iron')
  }
}

function park(b, H, x0, z0, x1, z1, rand) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) b.set(x, H(x, z).h, z, 'grass')
  for (let k = 0; k < 2; k++) {
    const tx = x0 + 3 + Math.floor(rand() * (x1 - x0 - 6))
    const tz = z0 + 3 + Math.floor(rand() * (z1 - z0 - 6))
    const g = H(tx, tz).h
    for (let y = g + 1; y <= g + 4; y++) b.set(tx, y, tz, 'oaklog')
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 3; dy <= 5; dy++) {
      if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy - 4) <= 3 && !(dx === 0 && dz === 0 && dy <= 4)) b.set(tx + dx, g + dy, tz + dz, 'leaves')
    }
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
export function buildTown(b, { H, cx, cz, style, plazaR, seed, earthAt }) {
  const make = STYLE[style] || STYLE.european
  const rand = prng(seed)
  const [road, walk] = ROADS[style] || ROADS.european
  const inside = outline(seed)
  streets(b, H, cx, cz, plazaR, road, walk, inside)
  // Lots between the streets: one or two buildings each.
  // Streets run where (x - cx + 2) mod BLOCK < STREET, so a 5-wide avenue
  // goes straight through the middle; each lot is the 17 x 17 between.
  const n = Math.ceil(TOWN_R / BLOCK)
  for (let kx = -n; kx < n; kx++) {
    for (let kz = -n; kz < n; kz++) {
      const x0 = cx + kx * BLOCK + 3
      const z0 = cz + kz * BLOCK + 3
      const x1 = x0 + BLOCK - STREET - 1
      const z1 = z0 + BLOCK - STREET - 1
      if (x0 < cx - TOWN_R || z0 < cz - TOWN_R || x1 > cx + TOWN_R || z1 > cz + TOWN_R) continue
      // Keep the plaza clear; lots past the town's edge stay land, and now
      // and then one is a little park (grass with a tree or two).
      if (x0 <= cx + plazaR + 1 && x1 >= cx - plazaR - 1 && z0 <= cz + plazaR + 1 && z1 >= cz - plazaR - 1) continue
      if (!inside((x0 + x1) / 2 - cx, (z0 + z1) / 2 - cz)) continue
      if (rand() < 0.12) {
        park(b, H, x0, z0, x1, z1, rand)
        continue
      }
      const split = rand() < 0.5
      const parts = split ? [[x0, x0 + 7], [x0 + 9, x1]] : [[x0, x1]]
      for (const [a, c] of parts) {
        const spec = make(null, { rand })
        const inset = spec.inset || 0
        building(b, H, earthAt, { x0: a + inset, x1: c - inset, z0: z0 + inset, z1: z1 - inset, rand, ...spec })
        if (spec.dome) {
          let base = -Infinity
          for (let x = a; x <= c; x++) for (let z = z0; z <= z1; z++) base = Math.max(base, H(x, z).h)
          dome(b, (a + c) / 2, base + spec.floors * 4 + 2, (z0 + z1) / 2, Math.min(4, (c - a) / 2 - 1), 'smoothsandstone')
        }
      }
    }
  }
}
