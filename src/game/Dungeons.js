// Underground dungeons (2026-11-01, Gaymi's idea list 3: "add the dungeons
// underground of normal map for worlds" - Map 1's land and every Open
// World world). At most one per DG_GRID square, DG_FLOOR_MAX..DG_FLOOR_MIN
// below ground: a 3 x 3 grid of stone-brick rooms (SLOT cells each) joined
// by corridors, glowstone lamps in the ceilings, loot chests in some
// rooms, and a big Boss Room in the middle. A sloped tunnel comes down
// from the land to the door on the west side (Underground.js plans it,
// like a cave entrance) - or dig / cave your way in.
//
// Pure, like UnderCity.js: dungeonCell(d, x, y, z) says what one cell is -
// undefined (not the dungeon), null (open air) or a block type - and
// Underground treats dungeons like its underground cities (the air is
// carved, the walls are kept, only what can be seen becomes real blocks).
// Never under or near the block city. Entering one and its Boss Room is
// noticed by BuildSurvival (dungeonAt / inBossRoom).

export const DG_GRID = 144
const DG_CHANCE = 0.7
export const SLOT = 12
export const SIZE = SLOT * 3 // the whole dungeon is SIZE x SIZE cells
const DG_FLOOR_MAX = -26
const DG_FLOOR_MIN = -38
const CITY_GAP = 150 // from the block city's middle
const ROOM_H = 4
const BOSS_H = 6
const HALL_H = 3
const CHEST_CHANCE = 0.55

let SALT = 0
export function setDungeonSeed(seed) {
  SALT = seed | 0
}

function hash(a, b, c) {
  let h = Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39) ^ Math.imul((c + SALT) | 0, 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const cache = new Map()
let cacheSalt = null

// Its rooms ({ x0, z0, x1, z1 } interior, h) and corridors ({ x0, z0,
// x1, z1 } interior), in cells from the dungeon's corner.
function layout(gx, gz) {
  const rooms = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const boss = i === 1 && j === 1
      const w = boss ? 10 : 6 + Math.floor(hash(gx * 3 + i, gz * 3 + j, 1201) * 4)
      const d = boss ? 10 : 6 + Math.floor(hash(gx * 3 + i, gz * 3 + j, 1202) * 4)
      const x0 = i * SLOT + Math.floor((SLOT - w) / 2)
      const z0 = j * SLOT + Math.floor((SLOT - d) / 2)
      rooms.push({ i, j, boss, x0, z0, x1: x0 + w - 1, z1: z0 + d - 1, h: boss ? BOSS_H : ROOM_H, chest: !boss && hash(gx * 3 + i, gz * 3 + j, 1203) < CHEST_CHANCE })
    }
  }
  const halls = []
  const mid = (k) => k * SLOT + Math.floor(SLOT / 2)
  // Every column joined top to bottom, the middle row joined across, and
  // the other rows now and then: always one connected dungeon.
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) halls.push({ x0: mid(i) - 1, x1: mid(i) + 1, z0: mid(j), z1: mid(j + 1) })
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 2; i++) {
      if (j !== 1 && hash(gx * 5 + i, gz * 5 + j, 1204) < 0.5) continue
      halls.push({ x0: mid(i), x1: mid(i + 1), z0: mid(j) - 1, z1: mid(j) + 1 })
    }
  }
  // The way in: from the first room out through the west wall.
  halls.push({ x0: 0, x1: mid(0), z0: mid(0) - 1, z1: mid(0) + 1, door: true })
  return { rooms, halls }
}

// The dungeon in grid square (gx, gz), or null.
export function dungeonIn(gx, gz) {
  if (cacheSalt !== SALT) {
    cache.clear()
    cacheSalt = SALT
  }
  const key = `${gx},${gz}`
  if (cache.has(key)) return cache.get(key)
  let d = null
  if (hash(gx, gz, 1101) < DG_CHANCE) {
    const x0 = gx * DG_GRID + 16 + Math.floor(hash(gx, gz, 1102) * (DG_GRID - SIZE - 32))
    const z0 = gz * DG_GRID + 16 + Math.floor(hash(gx, gz, 1103) * (DG_GRID - SIZE - 32))
    if (Math.hypot(x0 + SIZE / 2, z0 + SIZE / 2) > CITY_GAP) {
      const floor = DG_FLOOR_MAX - Math.floor(hash(gx, gz, 1104) * (DG_FLOOR_MAX - DG_FLOOR_MIN))
      d = { dungeon: true, id: key, gx, gz, x0, z0, floor, ...layout(gx, gz) }
      // Where the way in meets the west wall (Underground plans the tunnel).
      d.door = { x: x0 - 1, y: floor + 1, z: z0 + Math.floor(SLOT / 2) }
    }
  }
  cache.set(key, d)
  return d
}

// Every dungeon reaching into the box (x0..x1, z0..z1).
export function dungeonsOver(x0, z0, x1, z1) {
  const out = []
  for (let gx = Math.floor((x0 - SIZE) / DG_GRID); gx <= Math.floor((x1 + SIZE) / DG_GRID); gx++) {
    for (let gz = Math.floor((z0 - SIZE) / DG_GRID); gz <= Math.floor((z1 + SIZE) / DG_GRID); gz++) {
      const d = dungeonIn(gx, gz)
      if (d && d.x0 + SIZE >= x0 && d.x0 - 1 <= x1 && d.z0 + SIZE >= z0 && d.z0 - 1 <= z1) out.push(d)
    }
  }
  return out
}

export function dungeonYRange(d) {
  return [d.floor - 1, d.floor + BOSS_H + 2]
}

const inside = (r, lx, lz, pad = 0) => lx >= r.x0 - pad && lx <= r.x1 + pad && lz >= r.z0 - pad && lz <= r.z1 + pad

function wall(x, y, z) {
  const r = hash(x, y * 31 + z, 1301)
  return r < 0.18 ? 'mossystonebricks' : r < 0.3 ? 'crackedstonebricks' : 'stonebricks'
}

export function dungeonCell(d, x, y, z) {
  const lx = x - d.x0
  const lz = z - d.z0
  const dy = y - d.floor
  if (lx < 0 || lz < 0 || lx >= SIZE || lz >= SIZE || dy < 0 || dy > BOSS_H + 1) return undefined
  // A room's inside.
  for (const r of d.rooms) {
    if (!inside(r, lx, lz)) continue
    if (dy > r.h + 1) return undefined
    if (dy === 0) return r.boss && (lx + lz) % 2 ? 'chiseledstonebricks' : 'stonebricks'
    if (dy === r.h + 1) return lx === Math.floor((r.x0 + r.x1) / 2) && lz === Math.floor((r.z0 + r.z1) / 2) ? 'glowstone' : 'stonebricks'
    // A chest in the far corner; the Boss Room's pillars and two chests.
    if (dy === 1 && r.chest && lx === r.x1 && lz === r.z1) return 'lootchest'
    if (r.boss) {
      if (dy === 1 && lz === r.z1 && (lx === r.x0 || lx === r.x1)) return 'lootchest'
      if ((lx === r.x0 + 2 || lx === r.x1 - 2) && (lz === r.z0 + 2 || lz === r.z1 - 2)) return 'chiseledstonebricks'
    }
    return null
  }
  // A corridor's inside (through the walls too).
  for (const c of d.halls) {
    if (!inside(c, lx, lz)) continue
    if (dy > HALL_H + 1) break
    if (dy === 0) return 'stonebricks'
    if (dy === HALL_H + 1) return (lx + lz) % 6 === 0 ? 'glowstone' : 'stonebricks'
    return null
  }
  // Walls round the rooms and corridors.
  for (const r of d.rooms) if (inside(r, lx, lz, 1) && dy <= r.h + 1) return wall(x, y, z)
  for (const c of d.halls) if (inside(c, lx, lz, 1) && dy <= HALL_H + 1) return wall(x, y, z)
  return undefined
}

// Which dungeon (if any) a spot in blocks is inside, from a list.
export function dungeonAt(list, x, y, z) {
  for (const d of list) {
    const lx = x - d.x0
    const lz = z - d.z0
    if (lx >= 0 && lz >= 0 && lx < SIZE && lz < SIZE && y >= d.floor && y < d.floor + BOSS_H + 2) return d
  }
  return null
}

// Standing in its Boss Room? -> the room's middle, or null.
export function inBossRoom(d, x, y, z) {
  const r = d.rooms.find((o) => o.boss)
  const lx = Math.floor(x) - d.x0
  const lz = Math.floor(z) - d.z0
  if (!inside(r, lx, lz) || y < d.floor || y > d.floor + r.h + 1) return null
  return { x: d.x0 + (r.x0 + r.x1) / 2 + 0.5, y: d.floor + 1, z: d.z0 + (r.z0 + r.z1) / 2 + 0.5 }
}
