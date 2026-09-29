// Minecraft-style 16x16 pixel-art block textures for the map editor
// (2026-09-29, "make each block detailed as Minecraft blocks, and the
// pictures in the block search too").
//
// Every texture is painted procedurally, pixel by pixel, from a seeded
// random generator - no image files, and the same block always gets the
// exact same texture. Blocks that look different on different sides
// (grass, logs, bookshelf, TNT, pumpkin, hay, cactus, sandstone, bone)
// get separate top / side / bottom textures.
//
// Colors here are plain sRGB [r, g, b] arrays written straight into the
// pixels - deliberately NOT THREE.Color, whose .r/.g/.b are linear values
// (that mix-up made the old editor textures ~3x too dark).

const S = 16

function hashStr(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f]
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

class Px {
  constructor() {
    this.d = new Uint8ClampedArray(S * S * 4)
  }

  set(x, y, c, a = 255) {
    x = ((x % S) + S) % S
    y = ((y % S) + S) % S
    const i = (y * S + x) * 4
    this.d[i] = c[0]
    this.d[i + 1] = c[1]
    this.d[i + 2] = c[2]
    this.d[i + 3] = a
  }

  get(x, y) {
    x = ((x % S) + S) % S
    y = ((y % S) + S) % S
    const i = (y * S + x) * 4
    return [this.d[i], this.d[i + 1], this.d[i + 2]]
  }

  alpha(x, y) {
    return this.d[(((y % S) + S) % S * S + (((x % S) + S) % S)) * 4 + 3]
  }

  scale(x, y, f) {
    this.set(x, y, mul(this.get(x, y), f), this.alpha(x, y))
  }

  toCanvas() {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.putImageData(new ImageData(this.d, S, S), 0, 0)
    return canvas
  }
}

// ---- building blocks -------------------------------------------------------

// Base fill: each pixel one of a few brightness steps - the chunky,
// few-shades look of Minecraft's textures rather than smooth noise.
function noise(px, base, r, amp = 0.1, a = 255) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const step = Math.floor(r() * 5) - 2
      px.set(x, y, mul(base, 1 + step * amp * 0.5), a)
    }
  }
}

function speckle(px, color, r, count, size = 1) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(r() * S)
    const y = Math.floor(r() * S)
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) px.set(x + dx, y + dy, color)
  }
}

// Wrapped (tileable) Voronoi cells - cobblestone, gravel, glowstone, lava.
function cells(r, count) {
  const pts = []
  for (let i = 0; i < count; i++) pts.push([r() * S, r() * S, r()])
  const id = new Int16Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let best = 0
      let bestD = Infinity
      pts.forEach((p, i) => {
        let dx = Math.abs(x + 0.5 - p[0])
        let dy = Math.abs(y + 0.5 - p[1])
        dx = Math.min(dx, S - dx)
        dy = Math.min(dy, S - dy)
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      id[y * S + x] = best
    }
  }
  const at = (x, y) => id[(((y % S) + S) % S) * S + (((x % S) + S) % S)]
  const edge = (x, y) => at(x, y) !== at(x + 1, y) || at(x, y) !== at(x, y + 1)
  return { pts, at, edge }
}

function bevel(px, light = 1.18, dark = 0.72, inset = 0) {
  const lo = inset
  const hi = S - 1 - inset
  for (let i = lo; i <= hi; i++) {
    px.scale(i, lo, light)
    px.scale(lo, i, light)
    px.scale(i, hi, dark)
    px.scale(hi, i, dark)
  }
}

// ---- materials -------------------------------------------------------------

function stone(px, base, r) {
  noise(px, base, r, 0.12)
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(r() * S)
    const y = Math.floor(r() * S)
    const len = 2 + Math.floor(r() * 3)
    for (let k = 0; k < len; k++) px.set(x + k, y, mul(base, 0.8))
  }
}

function speckled(px, base, r, colors, count = 22) {
  noise(px, base, r, 0.08)
  colors.forEach((c) => speckle(px, c, r, count, 1))
}

function streaks(px, base, r, vertical) {
  for (let a = 0; a < S; a++) {
    const f = 0.86 + r() * 0.24
    for (let b = 0; b < S; b++) {
      const jitter = 1 + (r() - 0.5) * 0.08
      if (vertical) px.set(a, b, mul(base, f * jitter))
      else px.set(b, a, mul(base, f * jitter))
    }
  }
}

function cobble(px, base, r, count = 8, mossColor = null) {
  const c = cells(r, count)
  const shades = c.pts.map((p) => 0.8 + p[2] * 0.38)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const f = shades[c.at(x, y)] * (1 + (r() - 0.5) * 0.1)
      px.set(x, y, c.edge(x, y) ? mul(base, 0.52) : mul(base, f))
    }
  }
  if (mossColor) moss(px, mossColor, r)
}

function moss(px, color, r) {
  for (let i = 0; i < 4; i++) {
    const cx = Math.floor(r() * S)
    const cy = Math.floor(r() * S)
    const rad = 1.5 + r() * 2
    for (let y = -3; y <= 3; y++) {
      for (let x = -3; x <= 3; x++) {
        if (x * x + y * y <= rad * rad && r() < 0.85) px.set(cx + x, cy + y, mul(color, 0.85 + r() * 0.3))
      }
    }
  }
}

function gravel(px, base, r) {
  const c = cells(r, 16)
  const tints = c.pts.map((p) => mix(mul(base, 0.72 + p[2] * 0.5), [150, 120, 100], p[2] > 0.8 ? 0.25 : 0))
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, mul(tints[c.at(x, y)], c.edge(x, y) && r() < 0.5 ? 0.8 : 1))
}

// rowH / brickW in pixels; offset shifts every other row by half a brick.
function bricks(px, base, mortar, r, rowH = 4, brickW = 8, beveled = false) {
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rowH)
    const off = row % 2 ? brickW / 2 : 0
    for (let x = 0; x < S; x++) {
      const ly = y % rowH
      const lx = (x + off) % brickW
      if (ly === 0 || lx === 0) {
        px.set(x, y, mul(mortar, 0.95 + r() * 0.1))
        continue
      }
      let f = 0.9 + r() * 0.18
      if (beveled) {
        if (ly === 1 || lx === 1) f *= 1.12
        if (ly === rowH - 1 || lx === brickW - 1) f *= 0.8
      } else if (ly === rowH - 1) f *= 0.86
      px.set(x, y, mul(base, f))
    }
  }
}

function planks(px, base, r) {
  const seams = [3, 11, 6, 14]
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / 4)
    const rowTint = 0.94 + ((row * 37) % 5) * 0.03
    for (let x = 0; x < S; x++) {
      let f = rowTint * (0.95 + r() * 0.1)
      if (y % 4 === 3) f *= 0.7
      else if (x === seams[row]) f *= 0.76
      px.set(x, y, mul(base, f))
    }
    // grain
    if (y % 4 !== 3 && r() < 0.6) {
      const gx = Math.floor(r() * S)
      const len = 2 + Math.floor(r() * 4)
      for (let k = 0; k < len; k++) px.set(gx + k, y, mul(base, rowTint * 0.84))
    }
  }
}

function logSide(px, bark, r, birch = false) {
  if (birch) {
    noise(px, bark, r, 0.05)
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * S)
      const y = Math.floor(r() * S)
      const len = 1 + Math.floor(r() * 3)
      for (let k = 0; k < len; k++) px.set(x + k, y, [48, 44, 40])
    }
    return
  }
  let f = 1
  for (let x = 0; x < S; x++) {
    f = Math.max(0.72, Math.min(1.15, f + (r() - 0.5) * 0.3))
    const groove = x % 4 === 0
    for (let y = 0; y < S; y++) px.set(x, y, mul(bark, (groove ? 0.7 : f) * (0.94 + r() * 0.12)))
  }
}

function logTop(px, bark, inner, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
      if (d > 6.5) {
        px.set(x, y, mul(bark, 0.9 + r() * 0.15))
        continue
      }
      const ring = Math.floor(d) % 2 === 0
      px.set(x, y, mul(inner, (ring ? 1 : 0.84) * (0.96 + r() * 0.08)))
    }
  }
}

function ore(px, stoneBase, oreColor, r) {
  stone(px, stoneBase, r)
  const n = 4 + Math.floor(r() * 2)
  for (let i = 0; i < n; i++) {
    const cx = 1 + Math.floor(r() * 13)
    const cy = 1 + Math.floor(r() * 13)
    const shape = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2]].filter(() => r() < 0.75)
    shape.forEach(([dx, dy], k) => px.set(cx + dx, cy + dy, mul(oreColor, k === 0 ? 1.25 : 0.85 + r() * 0.3)))
  }
}

// Minecraft mineral blocks (gold/iron/diamond/emerald/...): bright bevel
// frame, inner inset, a few shine pixels.
function mineral(px, base, r) {
  noise(px, base, r, 0.06)
  bevel(px, 1.2, 0.7, 0)
  bevel(px, 0.88, 1.1, 2)
  for (let i = 0; i < 4; i++) {
    const x = 3 + Math.floor(r() * 9)
    const y = 3 + Math.floor(r() * 9)
    px.set(x, y, mix(base, [255, 255, 255], 0.55))
    px.set(x + 1, y, mix(base, [255, 255, 255], 0.3))
  }
}

function metalPlate(px, base, r) {
  noise(px, base, r, 0.05)
  for (let i = 0; i < S; i++) {
    px.scale(i, 7, 0.75)
    px.scale(7, i, 0.75)
    px.scale(i, 8, 1.12)
    px.scale(8, i, 1.12)
  }
  bevel(px, 1.15, 0.72)
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px.set(x, y, mul(base, 1.35))
}

function polished(px, base, r) {
  noise(px, base, r, 0.05)
  bevel(px, 1.15, 0.75)
}

function smooth(px, base, r) {
  noise(px, base, r, 0.03)
  for (let i = 0; i < S; i++) {
    px.scale(i, 0, 0.8)
    px.scale(i, 15, 0.8)
    px.scale(0, i, 0.8)
    px.scale(15, i, 0.8)
  }
}

function concrete(px, base, r) {
  noise(px, base, r, 0.03)
}

function wool(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let f = 0.94 + r() * 0.1
      if ((x + y * 3) % 5 === 0) f *= 0.9
      if ((x * 2 + y) % 7 === 0) f *= 1.06
      px.set(x, y, mul(base, f))
    }
  }
}

function glass(px, base, r, stained) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, base, stained ? 110 : 0)
  const frame = stained ? mul(base, 1.1) : mix(base, [255, 255, 255], 0.5)
  for (let i = 0; i < S; i++) {
    px.set(i, 0, frame, 230)
    px.set(i, 15, frame, 230)
    px.set(0, i, frame, 230)
    px.set(15, i, frame, 230)
  }
  for (const [x, y] of [[3, 2], [2, 3], [4, 3], [3, 4], [2, 5], [11, 10], [12, 11], [10, 12]]) px.set(x, y, [255, 255, 255], 200)
}

function leaves(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (r() < 0.16) {
        px.set(x, y, mul(base, 0.5), 0)
        continue
      }
      const f = [0.72, 0.85, 1, 1.12][Math.floor(r() * 4)]
      px.set(x, y, mul(base, f))
    }
  }
}

function water(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wave = (y + Math.round(Math.sin(x * 0.8) * 1.4) + 16) % 5
      px.set(x, y, mul(base, wave === 0 ? 1.25 : wave === 1 ? 1.1 : 0.95 + r() * 0.06))
    }
  }
}

function lava(px, base, r) {
  const c = cells(r, 7)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = c.pts[c.at(x, y)]
      const hot = mix(base, [255, 220, 90], p[2] * 0.6)
      px.set(x, y, c.edge(x, y) ? mul(base, 0.72) : mul(hot, 0.95 + r() * 0.1))
    }
  }
}

function ice(px, base, r) {
  noise(px, base, r, 0.05)
  for (let i = 0; i < 3; i++) {
    let x = Math.floor(r() * S)
    let y = Math.floor(r() * S)
    for (let k = 0; k < 7; k++) {
      px.set(x, y, [245, 252, 255])
      x += r() < 0.5 ? 1 : 0
      y += r() < 0.6 ? 1 : -1
    }
  }
}

function magma(px, base, r) {
  const c = cells(r, 9)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      px.set(x, y, c.edge(x, y) ? [255, 150 + Math.floor(r() * 60), 40] : mul(base, 0.6 + r() * 0.25))
    }
  }
}

function glowstone(px, base, r) {
  const c = cells(r, 10)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = c.pts[c.at(x, y)]
      px.set(x, y, c.edge(x, y) ? mul(base, 0.6) : mix(base, [255, 245, 190], p[2] * 0.7))
    }
  }
}

function obsidian(px, base, r, crying) {
  noise(px, base, r, 0.25)
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * S)
    const y = Math.floor(r() * S)
    px.set(x, y, mix(base, [120, 70, 170], 0.6))
    px.set(x + 1, y + 1, mix(base, [90, 50, 140], 0.5))
  }
  if (crying) speckle(px, [170, 60, 255], r, 12)
}

function sealantern(px, base, r) {
  noise(px, base, r, 0.05)
  for (let i = 0; i < S; i++) {
    px.set(i, 7, mix(base, [255, 255, 255], 0.6))
    px.set(7, i, mix(base, [255, 255, 255], 0.6))
  }
  bevel(px, 1.1, 0.75)
}

function amethyst(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const band = Math.floor((x + y) / 3) % 3
      px.set(x, y, mul(base, [0.8, 1, 1.22][band] * (0.94 + r() * 0.1)))
    }
  }
}

function jelly(px, base, r) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, mul(base, 0.96 + r() * 0.06), 170)
  for (let i = 3; i <= 12; i++) {
    px.set(i, 3, mul(base, 0.75), 230)
    px.set(i, 12, mul(base, 0.75), 230)
    px.set(3, i, mul(base, 0.75), 230)
    px.set(12, i, mul(base, 0.75), 230)
  }
  bevel(px, 1.15, 0.8)
}

function sponge(px, base, r) {
  noise(px, base, r, 0.08)
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * S)
    const y = Math.floor(r() * S)
    px.set(x, y, mul(base, 0.55))
    if (r() < 0.4) px.set(x + 1, y, mul(base, 0.62))
  }
}

// ---- multi-face blocks -----------------------------------------------------

function grassTop(px, base, r) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, mul(base, [0.8, 0.9, 1, 1.1][Math.floor(r() * 4)]))
}

function dirt(px, base, r) {
  noise(px, base, r, 0.14)
  speckle(px, mul(base, 0.7), r, 10)
  speckle(px, mul(base, 1.2), r, 6)
}

function grassSide(px, grass, soil, r) {
  dirt(px, soil, r)
  for (let x = 0; x < S; x++) {
    const depth = 2 + Math.floor(r() * 3)
    for (let y = 0; y < depth; y++) px.set(x, y, mul(grass, [0.8, 0.9, 1, 1.08][Math.floor(r() * 4)]))
  }
}

function bookshelfSide(px, wood, r) {
  planks(px, wood, r)
  const bookColors = [[150, 40, 40], [50, 70, 150], [60, 120, 60], [170, 130, 50], [110, 60, 120], [140, 90, 50]]
  for (const [top, bottom] of [[2, 6], [9, 13]]) {
    let x = 1
    while (x < 15) {
      const w = r() < 0.6 ? 1 : 2
      const c = bookColors[Math.floor(r() * bookColors.length)]
      const h = top + Math.floor(r() * 2)
      for (let bx = x; bx < Math.min(15, x + w); bx++) {
        for (let y = top; y <= bottom; y++) px.set(bx, y, y < h ? mul(wood, 0.35) : mul(c, bx === x ? 1.1 : 0.9))
      }
      x += w
    }
  }
}

const TNT_LETTERS = [
  '###.#..#.###',
  '.#..##.#..#.',
  '.#..#.##..#.',
  '.#..#..#..#.',
]
function tntSide(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const band = y >= 5 && y <= 10
      px.set(x, y, band ? [232, 228, 220] : mul(base, x % 4 === 0 ? 0.78 : 0.95 + r() * 0.1))
    }
  }
  TNT_LETTERS.forEach((row, ly) => {
    for (let lx = 0; lx < row.length; lx++) if (row[lx] === '#') px.set(2 + lx, 6 + ly, [30, 30, 30])
  })
}

function tntTop(px, base, r) {
  noise(px, [200, 196, 190], r, 0.06)
  bevel(px, 1, 0.8)
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) px.set(x, y, mul(base, 0.85))
  px.set(7, 7, [40, 40, 40])
  px.set(8, 8, [40, 40, 40])
}

function pumpkinSide(px, base, r, face) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, mul(base, (x % 4 === 0 ? 0.78 : 1) * (0.94 + r() * 0.1)))
  if (!face) return
  const glow = [255, 214, 90]
  for (const [x, y] of [[4, 5], [5, 5], [4, 6], [10, 5], [11, 5], [11, 6]]) px.set(x, y, glow)
  for (let x = 3; x <= 12; x++) px.set(x, 10, glow)
  for (const x of [4, 7, 10]) px.set(x, 11, glow)
}

function pumpkinTop(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ring = Math.floor(Math.hypot(x - 7.5, y - 7.5)) % 3 === 0
      px.set(x, y, mul(base, (ring ? 0.82 : 1) * (0.95 + r() * 0.08)))
    }
  }
  for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) px.set(x, y, [90, 70, 30])
}

function haySide(px, base, r) {
  for (let x = 0; x < S; x++) {
    const f = 0.85 + r() * 0.3
    for (let y = 0; y < S; y++) px.set(x, y, mul(base, f * (0.95 + r() * 0.1)))
  }
  for (const y of [3, 4, 11, 12]) for (let x = 0; x < S; x++) px.set(x, y, mul([150, 60, 30], y % 2 ? 0.85 : 1))
}

function hayTop(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ring = Math.floor(Math.hypot(x - 7.5, y - 7.5) * 1.3) % 2 === 0
      px.set(x, y, mul(base, (ring ? 1.05 : 0.82) * (0.95 + r() * 0.1)))
    }
  }
}

function cactusSide(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const edge = x === 0 || x === 15
      px.set(x, y, mul(base, (edge ? 0.62 : x % 4 === 2 ? 0.82 : 1) * (0.95 + r() * 0.1)))
    }
  }
  for (let i = 0; i < 8; i++) px.set(1 + Math.floor(r() * 14), Math.floor(r() * S), [220, 230, 190])
}

function cactusTop(px, base, r) {
  noise(px, mul(base, 1.12), r, 0.06)
  bevel(px, 0.7, 0.7)
  for (const [x, y] of [[7, 7], [8, 8], [7, 8], [8, 7]]) px.set(x, y, mul(base, 0.7))
}

function sandstoneSide(px, base, r) {
  noise(px, base, r, 0.05)
  for (let x = 0; x < S; x++) {
    for (const y of [0, 1, 2]) px.scale(x, y, 1.08)
    px.scale(x, 3, 0.82)
    for (const y of [12, 13, 14, 15]) px.scale(x, y, 0.9)
    if (r() < 0.5) px.scale(x, 8, 0.9)
  }
}

function boneSide(px, base, r) {
  noise(px, base, r, 0.04)
  for (let y = 0; y < S; y++) for (const x of [4, 11]) px.scale(x, y, 0.82)
}

function boneTop(px, base, r) {
  noise(px, mul(base, 0.92), r, 0.05)
  bevel(px, 1.1, 0.8)
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) px.set(x, y, mul(base, 1.05))
}

// ---- which texture each block uses ------------------------------------------

const GLASS_IDS = /stainedglass$/
const OVERRIDE = {
  grass: (base, r) => ({
    top: paint((px) => grassTop(px, base, r)),
    side: paint((px) => grassSide(px, base, hex(0x6b4a30), r)),
    bottom: paint((px) => dirt(px, hex(0x6b4a30), r)),
  }),
  oaklog: (base, r) => logFaces(base, hex(0xb4864a), r),
  sprucelog: (base, r) => logFaces(base, hex(0x7a5a38), r),
  birchlog: (base, r) => logFaces(base, hex(0xd8c898), r, true),
  bookshelf: (base, r) => {
    const top = paint((px) => planks(px, hex(0xb4864a), r))
    return { top, side: paint((px) => bookshelfSide(px, hex(0xb4864a), r)), bottom: top }
  },
  tnt: (base, r) => ({
    top: paint((px) => tntTop(px, base, r)),
    side: paint((px) => tntSide(px, base, r)),
    bottom: paint((px) => noise(px, [200, 196, 190], r, 0.06)),
  }),
  pumpkin: (base, r) => {
    const top = paint((px) => pumpkinTop(px, base, r))
    return { top, side: paint((px) => pumpkinSide(px, base, r, false)), bottom: top }
  },
  jackolantern: (base, r) => {
    const top = paint((px) => pumpkinTop(px, base, r))
    return { top, side: paint((px) => pumpkinSide(px, base, r, true)), bottom: top }
  },
  haybale: (base, r) => {
    const top = paint((px) => hayTop(px, base, r))
    return { top, side: paint((px) => haySide(px, base, r)), bottom: top }
  },
  cactus: (base, r) => {
    const top = paint((px) => cactusTop(px, base, r))
    return { top, side: paint((px) => cactusSide(px, base, r)), bottom: top }
  },
  sandstone: (base, r) => {
    const top = paint((px) => noise(px, mul(base, 1.04), r, 0.05))
    return { top, side: paint((px) => sandstoneSide(px, base, r)), bottom: top }
  },
  boneblock: (base, r) => {
    const top = paint((px) => boneTop(px, base, r))
    return { top, side: paint((px) => boneSide(px, base, r)), bottom: top }
  },
}

function logFaces(bark, inner, r, birch = false) {
  const top = paint((px) => logTop(px, bark, inner, r))
  return { top, side: paint((px) => logSide(px, bark, r, birch)), bottom: top }
}

// Single-texture blocks, by id (checked first) or by the block's old
// `pattern` name (fallback, so a future block type still gets something
// sensible).
const BY_ID = {
  concrete: concrete, asphalt: (px, b, r) => speckled(px, b, r, [mul(b, 1.5)], 10),
  dirt: dirt, sand: (px, b, r) => speckled(px, b, r, [mul(b, 0.88), mul(b, 1.08)], 30),
  snow: (px, b, r) => noise(px, b, r, 0.03), stone: (px, b, r) => bricks(px, b, mul(b, 0.68), r, 8, 16, true),
  obsidian: (px, b, r) => obsidian(px, b, r, false), cryingobsidian: (px, b, r) => obsidian(px, b, r, true),
  granite: (px, b, r) => speckled(px, b, r, [[170, 110, 95], [110, 70, 60]], 26),
  marble: (px, b, r) => { polished(px, b, r); speckle(px, mul(b, 0.85), r, 8) },
  clay: (px, b, r) => noise(px, b, r, 0.05), moss: grassTop,
  cobblestone: (px, b, r) => cobble(px, b, r), mossycobblestone: (px, b, r) => cobble(px, hex(0x7d7d7d), r, 8, hex(0x4f7a38)),
  blackstone: (px, b, r) => cobble(px, b, r, 9),
  mossystonebricks: (px, b, r) => { bricks(px, hex(0x808078), hex(0x55554f), r, 8, 16, true); moss(px, hex(0x4f7a38), r) },
  netherrack: (px, b, r) => { noise(px, b, r, 0.22); speckle(px, mul(b, 0.6), r, 14) },
  netherbrick: (px, b, r) => bricks(px, b, mul(b, 0.55), r, 4, 8, true),
  quartz: smooth, andesite: (px, b, r) => speckled(px, b, r, [mul(b, 0.78), mul(b, 1.18)], 24),
  diorite: (px, b, r) => speckled(px, b, r, [mul(b, 0.7), [250, 250, 250]], 24),
  tuff: (px, b, r) => speckled(px, b, r, [mul(b, 0.75), mul(b, 1.2)], 20),
  calcite: (px, b, r) => speckled(px, b, r, [mul(b, 0.9)], 16),
  ironore: (px, b, r) => ore(px, hex(0x808078), [216, 175, 147], r),
  goldore: (px, b, r) => ore(px, hex(0x808078), [252, 220, 80], r),
  diamondore: (px, b, r) => ore(px, hex(0x808078), [90, 230, 220], r),
  coalore: (px, b, r) => ore(px, hex(0x808078), [30, 30, 30], r),
  bedrock: (px, b, r) => { noise(px, b, r, 0.5); speckle(px, [110, 110, 110], r, 14, 2) },
  endstone: (px, b, r) => speckled(px, b, r, [mul(b, 0.85)], 26),
  gravel: gravel, mud: (px, b, r) => { noise(px, b, r, 0.1); speckle(px, mul(b, 0.75), r, 12) },
  deepslate: (px, b, r) => streaks(px, b, r, false), basalt: (px, b, r) => streaks(px, b, r, true),
  smoothstone: smooth, prismarine: (px, b, r) => { const c = cells(r, 9); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, mix(b, [110, 180, 160], c.pts[c.at(x, y)][2] * 0.5)) },
  sealantern: sealantern, amethystblock: amethyst, honeyblock: jelly, slimeblock: jelly,
  purpurblock: (px, b, r) => bricks(px, b, mul(b, 0.75), r, 8, 8, true),
  terracotta: (px, b, r) => noise(px, b, r, 0.05), glowstone: glowstone, magmablock: magma,
  coalblock: (px, b, r) => { noise(px, b, r, 0.3); speckle(px, [70, 70, 70], r, 8) },
  spongeblock: sponge, lava: lava, water: water, ice: ice, leaves: leaves, glass: (px, b, r) => glass(px, b, r, false),
  metal: metalPlate, polishedgranite: polished, polishedandesite: polished, netherite: mineral,
}
const BY_PATTERN = {
  speckle: stone, brick: (px, b, r) => bricks(px, b, [168, 164, 156], r), wood: planks, metal: mineral,
  glass: (px, b, r) => glass(px, b, r, true), liquid: water, crack: ice, leaves: leaves, wool: wool,
  log: (px, b, r) => logSide(px, b, r), spine: planks, ridged: (px, b, r) => pumpkinSide(px, b, r, false),
  stripe: boneSide, ore: (px, b, r) => ore(px, hex(0x808078), mix(b, [255, 255, 255], 0.3), r),
  crystal: amethyst, porous: sponge, ladder: planks,
}

function paint(fn) {
  const px = new Px()
  fn(px)
  return px.toCanvas()
}

const cache = new Map()

// -> { top, side, bottom } 16x16 canvases for this block type.
export function blockFaceCanvases(type) {
  const cached = cache.get(type.id)
  if (cached) return cached
  const base = hex(type.color)
  const r = rng(hashStr(type.id))
  let faces
  if (OVERRIDE[type.id]) {
    faces = OVERRIDE[type.id](base, r)
  } else {
    const draw = BY_ID[type.id] ? BY_ID[type.id]
      : /concrete$/.test(type.id) ? concrete
      : GLASS_IDS.test(type.id) ? (px, b, rr) => glass(px, b, rr, true)
        : /wool$/.test(type.id) ? wool
          : /planks$/.test(type.id) ? planks
            : /(^gold|^iron|^diamondblock|^emeraldblock|^lapisblock|^redstoneblock|^copper)/.test(type.id) ? mineral
              : BY_PATTERN[type.pattern] || stone
    const tex = paint((px) => draw(px, base, r))
    faces = { top: tex, side: tex, bottom: tex }
  }
  cache.set(type.id, faces)
  return faces
}

// True when the texture itself carries transparency (glass panes, leaf
// holes, jelly blocks) - those render with the texture's own alpha rather
// than one flat opacity for the whole block.
export function textureHasAlpha(type) {
  return type.id === 'glass' || GLASS_IDS.test(type.id) || type.id === 'leaves' || type.id === 'honeyblock' || type.id === 'slimeblock'
}

// Minecraft-inventory-style isometric block icon (top + two shaded sides)
// as a data URL, for the block picker and hotbar.
const iconCache = new Map()
export function blockIconURL(type, size = 64) {
  const key = `${type.id}:${size}`
  if (iconCache.has(key)) return iconCache.get(key)
  const faces = blockFaceCanvases(type)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  // CPU-backed canvas: toDataURL on a GPU canvas is a readback per icon -
  // ~6.5s for the picker's 121 icons in a 2026-09-29 profile.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  const pad = size * 0.06
  const w = size - pad * 2
  const half = w / 2
  const q = w / 4
  const cx = size / 2
  const T = [cx, pad]
  const R = [cx + half, pad + q]
  const B = [cx, pad + 2 * q]
  const L = [cx - half, pad + q]
  const h = half
  const shaded = (src, dark) => {
    const c = document.createElement('canvas')
    c.width = c.height = S
    const cc = c.getContext('2d', { willReadFrequently: true })
    cc.drawImage(src, 0, 0)
    cc.globalCompositeOperation = 'source-atop'
    cc.fillStyle = `rgba(0,0,0,${dark})`
    cc.fillRect(0, 0, S, S)
    return c
  }
  const face = (src, origin, xAxis, yAxis, dark) => {
    ctx.setTransform(xAxis[0] / S, xAxis[1] / S, yAxis[0] / S, yAxis[1] / S, origin[0], origin[1])
    ctx.drawImage(dark ? shaded(src, dark) : src, 0, 0)
  }
  face(faces.side, L, [B[0] - L[0], B[1] - L[1]], [0, h], 0.22)
  face(faces.side, B, [R[0] - B[0], R[1] - B[1]], [0, h], 0.4)
  face(faces.top, T, [R[0] - T[0], R[1] - T[1]], [L[0] - T[0], L[1] - T[1]], 0)
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}
