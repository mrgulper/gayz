// Death Heatmap (2026-11-27): the city map (map3, x and z from -64 to 63)
// cut into 16 x 16 squares of 8 blocks. A death is counted as the square's
// "column-row" name ("0-0" = the north-west corner), or "out" when it
// happened off the city (the open world around it). Shared by the page
// (PlayStats.js) and the server's list of allowed stat keys.
export const DEATH_HALF = 64
export const DEATH_CELL = 8
export const DEATH_GRID = (DEATH_HALF * 2) / DEATH_CELL

export const DEATH_KEYS = [
  ...Array.from({ length: DEATH_GRID * DEATH_GRID }, (_, i) => `${i % DEATH_GRID}-${Math.floor(i / DEATH_GRID)}`),
  'out',
]

export function deathCell(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const cx = Math.floor((x + DEATH_HALF) / DEATH_CELL)
  const cz = Math.floor((z + DEATH_HALF) / DEATH_CELL)
  if (cx < 0 || cz < 0 || cx >= DEATH_GRID || cz >= DEATH_GRID) return 'out'
  return `${cx}-${cz}`
}
