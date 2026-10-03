// Minecraft-style 16x16 pixel-art block textures for the map editor
// (2026-09-29, "make each block detailed as Minecraft blocks, and the
// pictures in the block search too").
//
// Every texture is painted procedurally, pixel by pixel, from a seeded
// random generator - no image files, and the same block always gets the
// exact same texture. Blocks that look different on different sides
// (grass, logs, bookshelf, C4, pumpkin, hay, cactus, sandstone, bone)
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

// Clear, light blue water with soft ripples (bloxd.io's look) rather than
// Minecraft's darker streaks.
function water(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wave = (y + Math.round(Math.sin((x * Math.PI) / 4) * 1.2) + 16) % 8
      px.set(x, y, mul(base, wave === 0 ? 1.18 : wave === 1 ? 1.08 : 1 + r() * 0.03))
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

// C4 (replaced TNT, 2026-09-30): putty-colored explosive bricks wrapped
// in olive tape, with a detonator on top.
function c4Side(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const seam = x === 0 || x === 8 || y === 0 || y === 15
      px.set(x, y, mul(base, (seam ? 0.72 : 1) * (0.94 + r() * 0.1)))
    }
  }
  // Olive tape band, with a black wire along it.
  for (let y = 6; y <= 9; y++) for (let x = 0; x < S; x++) px.set(x, y, mul([88, 92, 52], 0.92 + r() * 0.12))
  for (let x = 0; x < S; x++) px.set(x, 7 + (x % 6 < 3 ? 0 : 1), [30, 30, 28])
  // Red and blue leads running up to the detonator.
  for (let y = 1; y <= 5; y++) {
    px.set(5, y, [190, 36, 30])
    px.set(10, y, [40, 80, 190])
  }
}

function c4Top(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const seam = x === 0 || x === 8 || y === 0 || y === 8
      px.set(x, y, mul(base, (seam ? 0.72 : 1) * (0.94 + r() * 0.1)))
    }
  }
  // Detonator box with a red timer readout.
  for (let y = 4; y <= 11; y++) for (let x = 3; x <= 12; x++) px.set(x, y, mul([42, 44, 40], 0.9 + r() * 0.15))
  for (let x = 5; x <= 10; x++) px.set(x, 7, [230, 40, 30])
  px.set(5, 6, [230, 40, 30])
  px.set(10, 8, [230, 40, 30])
  px.set(11, 5, [60, 220, 60])
  px.set(5, 3, [190, 36, 30])
  px.set(10, 3, [40, 80, 190])
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

// ---- block batch 2 ----------------------------------------------------------

function frame(px, color, width = 1) {
  for (let w = 0; w < width; w++) {
    for (let i = 0; i < S; i++) {
      px.set(i, w, color)
      px.set(i, S - 1 - w, color)
      px.set(w, i, color)
      px.set(S - 1 - w, i, color)
    }
  }
}

// A wooden supply crate: planks inside a thick darker frame, with a
// diagonal brace and corner nails (the same on every face).
function crate(px, base, r) {
  planks(px, base, r)
  const dark = mul(base, 0.62)
  frame(px, dark, 2)
  for (let i = 2; i < S - 2; i++) {
    px.set(i, i, mul(base, 0.7))
    px.set(i + 1 < S - 2 ? i + 1 : i, i, mul(base, 0.8))
  }
  for (const [nx, ny] of [[1, 1], [S - 2, 1], [1, S - 2], [S - 2, S - 2]]) px.set(nx, ny, [150, 150, 140])
}

function craftingTop(px, wood, r) {
  planks(px, wood, r)
  frame(px, mul(wood, 0.55))
  for (let i = 1; i < 15; i++) {
    for (const g of [5, 10]) {
      px.set(g, i, mul(wood, 0.6))
      px.set(i, g, mul(wood, 0.6))
    }
  }
}

function craftingSide(px, wood, r) {
  planks(px, wood, r)
  for (let x = 0; x < S; x++) for (let y = 0; y < 3; y++) px.set(x, y, mul(wood, 0.62 + r() * 0.08))
  const dark = [60, 45, 30]
  const metal = [150, 150, 150]
  // a saw and a hammer hanging on the side
  for (let y = 5; y < 12; y++) px.set(4, y, dark)
  for (let y = 5; y < 10; y++) px.set(5, y, metal)
  for (let y = 5; y < 13; y++) px.set(11, y, dark)
  for (const x of [9, 10, 11, 12, 13]) px.set(x, 5, metal)
  px.set(9, 6, metal)
  px.set(13, 6, metal)
}

function furnaceSide(px, stoneBase, r) {
  noise(px, stoneBase, r, 0.1)
  bevel(px, 1.15, 0.7)
  for (let y = 4; y < 7; y++) for (let x = 5; x < 11; x++) px.set(x, y, [40, 40, 40])
  for (let y = 9; y < 14; y++) for (let x = 3; x < 13; x++) px.set(x, y, y === 13 ? [70, 40, 20] : [22, 22, 22])
}

function jukeboxSide(px, wood, r) {
  planks(px, wood, r)
  frame(px, mul(wood, 0.5), 2)
}

function jukeboxTop(px, wood, r) {
  jukeboxSide(px, wood, r)
  for (let x = 3; x < 13; x++) {
    px.set(x, 7, [20, 20, 20])
    px.set(x, 8, [35, 35, 35])
  }
}

function noteBlock(px, wood, r) {
  planks(px, wood, r)
  frame(px, mul(wood, 0.55))
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) px.set(x, y, (x + y) % 2 ? [30, 22, 16] : [48, 34, 24])
}

function melonSide(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const stripe = x % 3 === 0
      px.set(x, y, mul(stripe ? [60, 110, 40] : base, 0.92 + r() * 0.14))
    }
  }
}

function melonTop(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5)
      px.set(x, y, mul(d < 3 ? [150, 180, 70] : base, (Math.floor(d) % 3 === 0 ? 0.8 : 1) * (0.94 + r() * 0.1)))
    }
  }
}

// Grass-shaped blocks: a colored top, and a dirt (or netherrack) side
// with a fringe of the top color.
function toppedFaces(topColor, soil, r, soilPainter = dirt) {
  const bottom = paint((px) => soilPainter(px, soil, r))
  return {
    top: paint((px) => grassTop(px, topColor, r)),
    side: paint((px) => {
      soilPainter(px, soil, r)
      for (let x = 0; x < S; x++) {
        const depth = 2 + Math.floor(r() * 3)
        for (let y = 0; y < depth; y++) px.set(x, y, mul(topColor, [0.8, 0.9, 1, 1.08][Math.floor(r() * 4)]))
      }
    }),
    bottom,
  }
}

function netherrack(px, b, r) {
  noise(px, b, r, 0.22)
  speckle(px, mul(b, 0.6), r, 14)
}

function cracked(px, b, r) {
  bricks(px, b, mul(b, 0.68), r, 8, 16, true)
  for (let i = 0; i < 2; i++) {
    let x = Math.floor(r() * S)
    let y = Math.floor(r() * S)
    for (let k = 0; k < 8; k++) {
      px.set(x, y, mul(b, 0.45))
      x += r() < 0.5 ? 1 : -1
      y += r() < 0.7 ? 1 : 0
    }
  }
}

function chiseled(px, b, r) {
  polished(px, b, r)
  for (let i = 3; i <= 12; i++) {
    px.scale(i, 3, 0.7)
    px.scale(i, 12, 1.15)
    px.scale(3, i, 0.7)
    px.scale(12, i, 1.15)
  }
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) px.scale(x, y, 0.8)
}

function mushroomBlock(px, b, r, spots) {
  noise(px, b, r, 0.08)
  if (!spots) return
  for (const [cx, cy] of [[3, 3], [11, 4], [6, 10], [13, 12], [1, 12]]) {
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x * x + y * y < 2) px.set(cx + x, cy + y, [240, 236, 228])
  }
}

function kelpSide(px, b, r) {
  for (let y = 0; y < S; y++) {
    const band = y % 4 === 3
    for (let x = 0; x < S; x++) px.set(x, y, mul(b, (band ? 0.7 : 1) * (0.92 + r() * 0.14)))
  }
}

function soulSand(px, b, r) {
  noise(px, b, r, 0.14)
  for (const [cx, cy] of [[3, 3], [10, 5], [5, 11], [12, 12]]) {
    px.set(cx, cy, mul(b, 0.5))
    px.set(cx + 2, cy, mul(b, 0.5))
    px.set(cx + 1, cy + 2, mul(b, 0.45))
  }
}

function pillarSide(px, b, r) {
  noise(px, b, r, 0.04)
  for (let y = 0; y < S; y++) {
    px.scale(0, y, 0.78)
    px.scale(15, y, 0.78)
    px.scale(5, y, 0.88)
    px.scale(10, y, 0.88)
  }
}

function pillarTop(px, b, r) {
  polished(px, b, r)
  for (let i = 3; i <= 12; i++) {
    px.scale(i, 3, 0.85)
    px.scale(i, 12, 0.85)
    px.scale(3, i, 0.85)
    px.scale(12, i, 0.85)
  }
}

// Mirrored four-way swirl, like Minecraft's glazed terracotta.
function glazed(px, b, r) {
  const light = mix(b, [255, 255, 255], 0.6)
  const dark = mul(b, 0.55)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const d = x + y
      const c = d < 3 ? light : d === 5 || d === 6 ? dark : (x === 6 && y < 5) || (y === 6 && x < 5) ? light : b
      const col = mul(c, 0.95 + r() * 0.08)
      px.set(x, y, col)
      px.set(15 - y, x, col)
      px.set(15 - x, 15 - y, col)
      px.set(y, 15 - x, col)
    }
  }
}

function honeycomb(px, b, r) {
  const c = cells(r, 12)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, c.edge(x, y) ? mul(b, 0.62) : mul(b, 0.95 + c.pts[c.at(x, y)][2] * 0.2))
}

function target(px, b, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.floor(Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)))
      px.set(x, y, mul(d % 4 === 0 || d % 4 === 1 ? [200, 40, 40] : b, 0.94 + r() * 0.1))
    }
  }
}

function sculk(px, b, r) {
  noise(px, b, r, 0.25)
  speckle(px, [40, 200, 220], r, 7)
  speckle(px, [20, 110, 130], r, 10)
}

function lamp(px, b, r) {
  glowstone(px, b, r)
  frame(px, [90, 50, 30])
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
  c4: (base, r) => ({
    top: paint((px) => c4Top(px, base, r)),
    side: paint((px) => c4Side(px, base, r)),
    bottom: paint((px) => { noise(px, base, r, 0.06); frame(px, mul(base, 0.72)) }),
  }),
  crimsonstem: (base, r) => logFaces(base, hex(0x6a3448), r),
  warpedstem: (base, r) => logFaces(base, hex(0x2b6a64), r),
  mangrovelog: (base, r) => logFaces(base, hex(0x7a3a34), r),
  strippedsprucelog: (base, r) => logFaces(base, hex(0x8a6440), r),
  strippedbirchlog: (base, r) => logFaces(base, hex(0xd8c898), r),
  bambooblock: (base, r) => {
    const top = paint((px) => logTop(px, base, mix(base, [230, 220, 150], 0.5), r))
    return { top, side: paint((px) => pillarSide(px, base, r)), bottom: top }
  },
  barrel: (base, r) => {
    const top = paint((px) => { planks(px, base, r); frame(px, mul(base, 0.6)); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) px.set(x, y, mul(base, 0.55)) })
    return { top, side: paint((px) => kelpSide(px, base, r)), bottom: top }
  },
  chiseledsandstone: (base, r) => {
    const top = paint((px) => noise(px, mul(base, 1.04), r, 0.05))
    return { top, side: paint((px) => chiseled(px, base, r)), bottom: top }
  },
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
  craftingtable: (base, r) => ({
    top: paint((px) => craftingTop(px, base, r)),
    side: paint((px) => craftingSide(px, base, r)),
    bottom: paint((px) => planks(px, hex(0xb4864a), r)),
  }),
  furnace: (base, r) => {
    const top = paint((px) => { noise(px, base, r, 0.1); bevel(px, 1.1, 0.75) })
    return { top, side: paint((px) => furnaceSide(px, base, r)), bottom: top }
  },
  jukebox: (base, r) => {
    const side = paint((px) => jukeboxSide(px, base, r))
    return { top: paint((px) => jukeboxTop(px, base, r)), side, bottom: side }
  },
  melon: (base, r) => {
    const top = paint((px) => melonTop(px, base, r))
    return { top, side: paint((px) => melonSide(px, base, r)), bottom: top }
  },
  mycelium: (base, r) => toppedFaces(base, hex(0x6b4a30), r),
  podzol: (base, r) => toppedFaces(hex(0x7a5a2a), hex(0x6b4a30), r),
  crimsonnylium: (base, r) => toppedFaces(base, hex(0x723232), r, netherrack),
  warpednylium: (base, r) => toppedFaces(base, hex(0x723232), r, netherrack),
  redsandstone: (base, r) => {
    const top = paint((px) => noise(px, mul(base, 1.04), r, 0.05))
    return { top, side: paint((px) => sandstoneSide(px, base, r)), bottom: top }
  },
  darkoaklog: (base, r) => logFaces(base, hex(0x4a3524), r),
  junglelog: (base, r) => logFaces(base, hex(0xb5895a), r),
  acacialog: (base, r) => logFaces(base, hex(0xb85a3a), r),
  cherrylog: (base, r) => logFaces(base, hex(0xe4b4ac), r),
  strippedoaklog: (base, r) => logFaces(base, hex(0xc49a5c), r),
  driedkelpblock: (base, r) => {
    const top = paint((px) => hayTop(px, base, r))
    return { top, side: paint((px) => kelpSide(px, base, r)), bottom: top }
  },
  purpurpillar: (base, r) => {
    const top = paint((px) => pillarTop(px, base, r))
    return { top, side: paint((px) => pillarSide(px, base, r)), bottom: top }
  },
  quartzpillar: (base, r) => {
    const top = paint((px) => pillarTop(px, base, r))
    return { top, side: paint((px) => pillarSide(px, base, r)), bottom: top }
  },
  target: (base, r) => {
    const side = paint((px) => target(px, base, r))
    return { top: side, side, bottom: side }
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
  noteblock: noteBlock, coarsedirt: (px, b, r) => { dirt(px, b, r); speckle(px, [120, 110, 100], r, 14) },
  redsand: (px, b, r) => speckled(px, b, r, [mul(b, 0.85), mul(b, 1.1)], 30),
  smoothsandstone: smooth, cutsandstone: (px, b, r) => bricks(px, b, mul(b, 0.8), r, 8, 16, true),
  chiseledstonebricks: chiseled, crackedstonebricks: cracked,
  polisheddiorite: polished, polishedblackstone: polished,
  polishedblackstonebricks: (px, b, r) => bricks(px, b, mul(b, 0.6), r, 4, 8, true),
  netherquartzore: (px, b, r) => { netherrack(px, b, r); ore(px, b, [240, 236, 228], r) },
  redstoneore: (px, b, r) => ore(px, b, [220, 30, 30], r), lapisore: (px, b, r) => ore(px, b, [40, 80, 200], r),
  emeraldore: (px, b, r) => ore(px, b, [40, 200, 100], r), copperore: (px, b, r) => ore(px, b, [220, 120, 70], r),
  deepslatediamondore: (px, b, r) => ore(px, b, [90, 230, 220], r),
  packedice: ice, blueice: ice,
  redmushroomblock: (px, b, r) => mushroomBlock(px, b, r, true), brownmushroomblock: (px, b, r) => mushroomBlock(px, b, r, false),
  soulsand: soulSand, soulsoil: (px, b, r) => noise(px, b, r, 0.14),
  endstonebricks: (px, b, r) => bricks(px, b, mul(b, 0.75), r, 8, 16, true),
  prismarinebricks: (px, b, r) => bricks(px, b, mul(b, 0.7), r, 8, 8, true),
  darkprismarine: (px, b, r) => bricks(px, b, mul(b, 0.65), r, 8, 8, true),
  chiseledquartz: chiseled, exposedcopper: mineral, weatheredcopper: mineral, oxidizedcopper: mineral,
  glazedterracotta: glazed, honeycombblock: honeycomb, dripstone: (px, b, r) => streaks(px, b, r, true),
  sculk: sculk, shroomlight: glowstone, redstonelamp: lamp,
  cobbleddeepslate: (px, b, r) => cobble(px, b, r, 10),
  deepslatebricks: (px, b, r) => bricks(px, b, mul(b, 0.6), r, 4, 8, true),
  deepslatetiles: (px, b, r) => bricks(px, b, mul(b, 0.55), r, 4, 4, true),
  polisheddeepslate: polished,
  mudbricks: (px, b, r) => bricks(px, b, mul(b, 0.75), r, 4, 8, true),
  packedmud: (px, b, r) => { noise(px, b, r, 0.1); speckle(px, mul(b, 0.8), r, 16) },
  quartzbricks: (px, b, r) => bricks(px, b, mul(b, 0.85), r, 4, 8, true),
  smoothquartz: smooth,
  rednetherbricks: (px, b, r) => bricks(px, b, mul(b, 0.55), r, 4, 8, true),
  netherwartblock: (px, b, r) => { noise(px, b, r, 0.2); speckle(px, mul(b, 0.6), r, 16) },
  warpedwartblock: (px, b, r) => { noise(px, b, r, 0.2); speckle(px, mul(b, 0.6), r, 16) },
  rawironblock: mineral, rawgoldblock: mineral, rawcopperblock: mineral,
  cutcopper: (px, b, r) => bricks(px, b, mul(b, 0.8), r, 8, 8, true),
  ancientdebris: (px, b, r) => { streaks(px, b, r, true); speckle(px, [150, 110, 95], r, 10) },
  gildedblackstone: (px, b, r) => { cobble(px, b, r, 9); speckle(px, [240, 190, 60], r, 14) },
  lodestone: chiseled,
  ochrefroglight: (px, b, r) => { polished(px, b, r); frame(px, mul(b, 0.8)) },
  verdantfroglight: (px, b, r) => { polished(px, b, r); frame(px, mul(b, 0.8)) },
  pearlescentfroglight: (px, b, r) => { polished(px, b, r); frame(px, mul(b, 0.8)) },
  tintedglass: (px, b, r) => glass(px, b, r, true),
  crate: crate,
  deepslateironore: (px, b, r) => ore(px, b, [216, 175, 147], r),
  deepslategoldore: (px, b, r) => ore(px, b, [252, 220, 80], r),
  deepslatecoalore: (px, b, r) => ore(px, b, [20, 20, 20], r),
  deepslateemeraldore: (px, b, r) => ore(px, b, [40, 200, 100], r),
  deepslateredstoneore: (px, b, r) => ore(px, b, [220, 30, 30], r),
  deepslatelapisore: (px, b, r) => ore(px, b, [40, 80, 200], r),
  deepslatecopperore: (px, b, r) => ore(px, b, [220, 120, 70], r),
  polishedtuff: polished, chiseledtuff: chiseled,
  tuffbricks: (px, b, r) => bricks(px, b, mul(b, 0.7), r, 4, 8, true),
  polishedbasalt: (px, b, r) => streaks(px, b, r, true), smoothbasalt: smooth,
  chiseleddeepslate: chiseled, crackeddeepslatebricks: cracked, crackeddeepslatetiles: cracked,
  cutredsandstone: (px, b, r) => bricks(px, b, mul(b, 0.8), r, 8, 16, true),
  smoothredsandstone: smooth, chiseledredsandstone: chiseled,
  crackednetherbricks: cracked, chiselednetherbricks: chiseled,
  chiseledpolishedblackstone: chiseled, crackedpolishedblackstonebricks: cracked,
  tubecoralblock: (px, b, r) => speckled(px, b, r, [mul(b, 0.72), mul(b, 1.22)], 34),
  braincoralblock: (px, b, r) => speckled(px, b, r, [mul(b, 0.72), mul(b, 1.22)], 34),
  bubblecoralblock: (px, b, r) => speckled(px, b, r, [mul(b, 0.72), mul(b, 1.22)], 34),
  firecoralblock: (px, b, r) => speckled(px, b, r, [mul(b, 0.72), mul(b, 1.22)], 34),
  horncoralblock: (px, b, r) => speckled(px, b, r, [mul(b, 0.72), mul(b, 1.22)], 34),
  rooteddirt: (px, b, r) => { dirt(px, b, r); speckle(px, [200, 160, 110], r, 12) },
  chiseledcopper: chiseled,
  reinforceddeepslate: (px, b, r) => { bricks(px, b, mul(b, 0.6), r, 8, 8, true); frame(px, [200, 190, 160]) },
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
        : /terracotta$/.test(type.id) ? (px, b, rr) => noise(px, b, rr, 0.05)
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
// heightFrac < 1 draws a shorter block (0.5 = a slab).
export function blockIconURL(type, size = 64, heightFrac = 1) {
  const key = `${type.id}:${size}:${heightFrac}`
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
  const drop = half * (1 - heightFrac)
  const T = [cx, pad + drop]
  const R = [cx + half, pad + q + drop]
  const B = [cx, pad + 2 * q + drop]
  const L = [cx - half, pad + q + drop]
  const h = half * heightFrac
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
  // crop: how much of the texture's height to show (the bottom part, for
  // a slab's sides).
  const face = (src, origin, xAxis, yAxis, dark, crop = 1) => {
    ctx.setTransform(xAxis[0] / S, xAxis[1] / S, yAxis[0] / S, yAxis[1] / S, origin[0], origin[1])
    ctx.drawImage(dark ? shaded(src, dark) : src, 0, S * (1 - crop), S, S * crop, 0, 0, S, S)
  }
  face(faces.side, L, [B[0] - L[0], B[1] - L[1]], [0, h], 0.22, heightFrac)
  face(faces.side, B, [R[0] - B[0], R[1] - B[1]], [0, h], 0.4, heightFrac)
  face(faces.top, T, [R[0] - T[0], R[1] - T[1]], [L[0] - T[0], L[1] - T[1]], 0)
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}

// Stairs: a slab with a half-depth block standing on its back half, drawn
// in the same isometric view as blockIconURL. Unit-cube coordinates: x
// runs toward the right corner, z toward the left, y up; only the top,
// the z = max and the x = max faces of each box show.
export function stairsIconURL(type, size = 64) {
  const key = `${type.id}:${size}:stairs`
  if (iconCache.has(key)) return iconCache.get(key)
  const faces = blockFaceCanvases(type)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  const pad = size * 0.06
  const half = (size - pad * 2) / 2
  const q = half / 2
  const T = [size / 2, pad]
  const ex = [half, q] // T -> right corner
  const ez = [-half, q] // T -> left corner
  const at = (x, y, z) => [T[0] + x * ex[0] + z * ez[0], T[1] + x * ex[1] + z * ez[1] + (1 - y) * half]
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
  const shade = (src, dark) => {
    if (!dark) return src
    const c = document.createElement('canvas')
    c.width = c.height = S
    const cc = c.getContext('2d', { willReadFrequently: true })
    cc.drawImage(src, 0, 0)
    cc.globalCompositeOperation = 'source-atop'
    cc.fillStyle = `rgba(0,0,0,${dark})`
    cc.fillRect(0, 0, S, S)
    return c
  }
  // A parallelogram from origin along xAxis/yAxis, showing the texture's
  // rows from v0 to v1 (0 = top of the texture).
  const face = (src, origin, xAxis, yAxis, dark, v0 = 0, v1 = 1) => {
    ctx.setTransform(xAxis[0] / S, xAxis[1] / S, yAxis[0] / S, yAxis[1] / S, origin[0], origin[1])
    ctx.drawImage(shade(src, dark), 0, S * v0, S, S * (v1 - v0), 0, 0, S, S)
  }
  const box = (x0, x1, y0, y1, z0, z1) => {
    face(faces.side, at(x0, y1, z1), sub(at(x1, y1, z1), at(x0, y1, z1)), sub(at(x0, y0, z1), at(x0, y1, z1)), 0.22, 1 - y1, 1 - y0)
    face(faces.side, at(x1, y1, z1), sub(at(x1, y1, z0), at(x1, y1, z1)), sub(at(x1, y0, z1), at(x1, y1, z1)), 0.4, 1 - y1, 1 - y0)
    face(faces.top, at(x0, y1, z0), sub(at(x1, y1, z0), at(x0, y1, z0)), sub(at(x0, y1, z1), at(x0, y1, z0)), 0)
  }
  box(0, 1, 0, 0.5, 0, 1)
  box(0, 1, 0.5, 1, 0, 0.5)
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}

// ---- doors -------------------------------------------------------------------

// 16x32 pixel-art door (bottom half = rows 16-31, top half = rows 0-15),
// transparent where the windows are. `kind`: oak, spruce, birch, darkoak,
// acacia, iron.
const DOOR_STYLES = {
  oak: { base: [180, 134, 74], windows: 'two' },
  spruce: { base: [107, 74, 44], windows: 'none' },
  birch: { base: [216, 200, 152], windows: 'grid' },
  darkoak: { base: [74, 53, 36], windows: 'two' },
  acacia: { base: [184, 90, 58], windows: 'diamond' },
  iron: { base: [210, 210, 206], windows: 'two', metal: true },
}
const doorCache = new Map()
export function doorCanvas(kind) {
  if (doorCache.has(kind)) return doorCache.get(kind)
  const style = DOOR_STYLES[kind] || DOOR_STYLES.oak
  const r = rng(hashStr(`door:${kind}`))
  const W = 16
  const H = 32
  const d = new Uint8ClampedArray(W * H * 4)
  const set = (x, y, c, a = 255) => {
    const i = (y * W + x) * 4
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a
  }
  const b = style.base
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || x === W - 1 || y === 0 || y === H - 1
      // Wood: vertical planks with grain; iron: flat plate with rivet rows.
      let f = style.metal ? (y % 8 === 3 && x % 5 === 2 ? 1.18 : 0.96 + r() * 0.06) : (x % 4 === 0 ? 0.8 : 0.92 + r() * 0.14)
      if (edge) f *= 0.62
      set(x, y, mul(b, f))
    }
  }
  // Panel frames on the bottom half.
  for (let x = 2; x <= 13; x++) { set(x, 18, mul(b, 0.7)); set(x, 29, mul(b, 0.7)) }
  for (let y = 18; y <= 29; y++) { set(2, y, mul(b, 0.7)); set(13, y, mul(b, 0.7)) }
  for (let x = 2; x <= 13; x++) set(x, 23, mul(b, 0.7))
  // Windows (holes) in the top half.
  const hole = (x, y) => set(x, y, [0, 0, 0], 0)
  if (style.windows === 'two') {
    for (let y = 3; y <= 11; y++) for (let x = 3; x <= 12; x++) if (x !== 7 && x !== 8) hole(x, y)
  } else if (style.windows === 'grid') {
    for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++) if (x % 3 !== 2 && y % 3 !== 2) hole(x, y)
  } else if (style.windows === 'diamond') {
    for (let y = 2; y <= 13; y++) for (let x = 2; x <= 13; x++) if (Math.abs(x - 7.5) + Math.abs(y - 7.5) < 5) hole(x, y)
  } else {
    for (let x = 2; x <= 13; x++) { set(x, 4, mul(b, 0.7)); set(x, 11, mul(b, 0.7)) }
  }
  // Handle.
  const handle = style.metal ? [90, 90, 90] : [60, 60, 60]
  set(12, 16, handle); set(12, 17, handle); set(11, 17, handle)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  canvas.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(d, W, H), 0, 0)
  doorCache.set(kind, canvas)
  return canvas
}

// Flat door picture for the picker/hotbar.
export function doorIconURL(kind, size = 64) {
  const key = `door:${kind}:${size}`
  if (iconCache.has(key)) return iconCache.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  const h = size * 0.9
  ctx.drawImage(doorCanvas(kind), (size - h / 2) / 2, (size - h) / 2, h / 2, h)
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}
