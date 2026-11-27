// Death Heatmap (2026-11-27): the city map (map3) seen from above, for the
// owner tools' Charts tab to draw under the death counts. Built from the
// same generator the game uses, so it always matches the map; worked out
// once per server copy and kept.
//
// Returns { half, cell, rows }: `rows` is 128 strings of 128 letters, row 0
// = the north edge (z = -half), letter 0 = the west edge (x = -half).
//   .  nothing         w  water          r  road
//   g  grass / trees   s  stone ground   1-4  buildings, low to tall
import { generateMap3 } from '../../src/game/Map3Generator.js'
import { DEATH_HALF, DEATH_CELL } from '../../src/game/DeathCells.js'

let cached = null

const ROAD = new Set(['asphalt', 'gravel', 'blackconcrete', 'graygravel'])
const GREEN = /grass|leaves|moss|hedge|flower|fern|vine/

function letterOf(type, y) {
  const t = String(type || '')
  if (t.includes('water')) return 'w'
  if (y <= 0) return ROAD.has(t) ? 'r' : GREEN.test(t) ? 'g' : 's'
  if (GREEN.test(t) && y <= 6) return 'g'
  return y <= 4 ? '1' : y <= 9 ? '2' : y <= 19 ? '3' : '4'
}

export function cityView() {
  if (cached) return cached
  const size = DEATH_HALF * 2
  const topY = new Array(size * size).fill(-Infinity)
  const topType = new Array(size * size).fill('')
  for (const b of generateMap3().blocks) {
    const x = b.x + DEATH_HALF
    const z = b.z + DEATH_HALF
    if (x < 0 || z < 0 || x >= size || z >= size) continue
    const i = z * size + x
    if (b.y >= topY[i]) {
      topY[i] = b.y
      topType[i] = b.type
    }
  }
  const rows = []
  for (let z = 0; z < size; z++) {
    let row = ''
    for (let x = 0; x < size; x++) {
      const i = z * size + x
      row += topY[i] === -Infinity ? '.' : letterOf(topType[i], topY[i])
    }
    rows.push(row)
  }
  cached = { half: DEATH_HALF, cell: DEATH_CELL, rows }
  return cached
}
