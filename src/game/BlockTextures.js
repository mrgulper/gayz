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

import { cleanPixels } from './PixelClean.js'
import { specialFaces } from './SpecialGlyphs.js'

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

// Natural rock for mountains, cliffs and the underground (2026-10-25,
// Gaymi: "only use bricks in human made structures not mountains"): uneven
// light and dark patches, a few cracks and grit - no mortar lines. Built
// things use Stone Bricks (stonebricks) instead.
function rock(px, base, r) {
  stone(px, base, r)
  const c = cells(r, 6)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) px.scale(x, y, 0.86 + c.pts[c.at(x, y)][2] * 0.24)
  }
  speckle(px, mul(base, 0.7), r, 14)
  speckle(px, mul(base, 1.18), r, 10)
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

// Coral and seagrass that grow like plants (BuildMode `plant`): a
// see-through picture standing on its bottom edge - tubes, branches, a
// fan, bubbles on stalks or grass blades - lighter at the tips.
function coralPlant(px, base, r, style) {
  const dark = mul(base, 0.7)
  const tip = mul(base, 1.35)
  const dot = (x, y, c) => { if (x >= 0 && x < S && y >= 0 && y < S) px.set(x, y, c) }
  if (style === 'tube') {
    for (const x0 of [2, 5, 8, 11, 13]) {
      const top = 3 + Math.floor(r() * 7)
      const x = x0 + Math.floor(r() * 2)
      for (let y = S - 1; y >= top; y--) { dot(x, y, y < top + 2 ? tip : base); dot(x + 1, y, dark) }
    }
  } else if (style === 'grass') {
    for (let b = 0; b < 6; b++) {
      let x = 1 + r() * 13
      const lean = (r() - 0.5) * 0.5
      const top = 1 + Math.floor(r() * 7)
      for (let y = S - 1; y >= top; y--) { dot(Math.round(x), y, y < top + 3 ? tip : r() < 0.3 ? dark : base); x += lean }
    }
  } else if (style === 'fan') {
    // A fan spreading from one stalk, with darker veins.
    for (let y = 2; y < S - 3; y++) {
      const half = Math.round(6 * Math.sin(((y - 1) / (S - 4)) * Math.PI))
      for (let x = 8 - half; x <= 7 + half; x++) dot(x, y, (x + y) % 3 === 0 ? dark : y < 5 ? tip : base)
    }
    for (let y = S - 4; y < S; y++) { dot(7, y, dark); dot(8, y, base) }
  } else {
    // Branches: a stalk that forks as it climbs (bubble coral ends each
    // branch in a round blob).
    const grow = (x, y, dx, len, depth) => {
      for (let i = 0; i < len; i++) {
        dot(Math.round(x), y, depth > 1 ? base : dark)
        if (style === 'branch') dot(Math.round(x) + 1, y, dark)
        y--
        x += dx
        if (y < 1) break
      }
      if (depth < 3 && y > 2) {
        grow(x, y, dx - 0.35 - r() * 0.3, 2 + Math.floor(r() * 3), depth + 1)
        grow(x, y, dx + 0.35 + r() * 0.3, 2 + Math.floor(r() * 3), depth + 1)
      } else if (style === 'bubble') {
        const cx = Math.round(x)
        for (const [ox, oy] of [[0, 0], [1, 0], [0, -1], [1, -1], [-1, 0], [0, 1]]) dot(cx + ox, y + oy, tip)
      } else {
        dot(Math.round(x), y, tip)
      }
    }
    grow(7, S - 1, 0, 4 + Math.floor(r() * 2), 1)
  }
}

// Clear, light blue water with soft ripples (bloxd.io's look) rather than
// Minecraft's darker streaks.
function water(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Softer, wider ripples and no speckle (2026-10-26, "more clear and
      // clean") - this picture is what Potato and Simple show.
      const wave = Math.sin(((y + Math.sin((x * Math.PI) / 8) * 1.5) * Math.PI) / 4)
      px.set(x, y, mul(base, 1.02 + 0.06 * Math.max(0, wave) + r() * 0.008))
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

// C4 (replaced TNT, 2026-09-30; redrawn 2026-10-16 - the pale block with a
// dark band read as Minecraft's TNT): an olive-drab charge with its
// wrapper's seams, red and blue leads, and a white label saying C4.
const C4_LETTERS = [
  [5, 6], [6, 6], [4, 7], [4, 8], [5, 9], [6, 9], // C
  [8, 6], [10, 6], [8, 7], [10, 7], [8, 8], [9, 8], [10, 8], [11, 8], [10, 9], // 4
]
function c4Side(px, base, r) {
  const olive = [92, 100, 58]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const seam = x === 0 || x === 15 || y === 0 || y === 15 || y === 12
      px.set(x, y, mul(olive, (seam ? 0.7 : 1) * (0.93 + r() * 0.12)))
    }
  }
  // The putty showing at the wrapper's torn bottom edge.
  for (let x = 1; x < 15; x++) if (r() < 0.6) px.set(x, 13 + Math.floor(r() * 2), mul(base, 0.95 + r() * 0.1))
  // White label with black C4.
  for (let y = 5; y <= 10; y++) for (let x = 3; x <= 12; x++) px.set(x, y, mul([236, 232, 220], 0.95 + r() * 0.06))
  for (const [x, y] of C4_LETTERS) px.set(x, y, [24, 24, 22])
  // Red and blue leads from the detonator on top.
  for (let y = 1; y <= 4; y++) {
    px.set(4, y, [190, 36, 30])
    px.set(11, y, [40, 80, 190])
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

// ---- Map Editor game blocks (2026-10-04) ------------------------------------
// Player Start: a green pad with a white arrow pointing the way you'll face.
function startPadTop(px, base, r) {
  noise(px, base, r, 0.06)
  frame(px, [235, 245, 235])
  const arrow = [[7, 3], [8, 3], [6, 4], [7, 4], [8, 4], [9, 4], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5]]
  for (const [x, y] of arrow) px.set(x, y, [250, 250, 250])
  for (let y = 6; y < 12; y++) { px.set(7, y, [250, 250, 250]); px.set(8, y, [250, 250, 250]) }
}

// Loot Chest: planks in a dark frame with the lid's seam; the front also
// has the gold latch.
function chestSide(px, base, r, front) {
  planks(px, base, r)
  const dark = mul(base, 0.5)
  frame(px, dark)
  for (let x = 0; x < S; x++) px.set(x, 5, dark)
  if (front) {
    for (let y = 4; y < 8; y++) for (let x = 7; x < 9; x++) px.set(x, y, y === 4 ? [255, 236, 140] : [222, 180, 60])
  }
}

// Zombie Spawner: a black iron cage (see-through between the bars) with
// embers glowing inside.
function spawnerCage(px, base, r) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const bar = x % 5 === 0 || y % 5 === 0 || x === S - 1 || y === S - 1
      if (bar) px.set(x, y, mul(base, 0.8 + r() * 0.4))
      else px.set(x, y, [0, 0, 0], 0)
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = 6 + Math.floor(r() * 4)
    const y = 6 + Math.floor(r() * 4)
    px.set(x, y, r() < 0.5 ? [255, 120, 40] : [220, 40, 30])
  }
}

// Lever / Sign: two parts in one picture - the top half paints the moving
// part (lever stick with a red knob / the sign board), the bottom half the
// part it stands on (stone base / wooden post).
function leverParts(px, base, r) {
  planks(px, hex(0x9a7444), r)
  for (let x = 0; x < S; x++) for (let y = 0; y < 2; y++) px.set(x, y, [200, 40, 30])
  for (let y = 8; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, mul(base, 0.85 + r() * 0.3))
}

function signParts(px, base, r) {
  planks(px, base, r)
  for (let y = 8; y < S; y++) for (let x = 0; x < S; x++) px.set(x, y, mul(base, 0.6 + r() * 0.12))
}

const OVERRIDE = {
  playerstart: (base, r) => {
    const top = paint((px) => startPadTop(px, base, r))
    const side = paint((px) => noise(px, mul(base, 0.8), r, 0.06))
    return { top, side, bottom: side }
  },
  pressureplate: (base, r) => {
    const top = paint((px) => { noise(px, base, r, 0.05); frame(px, mul(base, 0.75)) })
    return { top, side: top, bottom: top }
  },
  lootchest: (base, r) => {
    const top = paint((px) => { planks(px, base, r); frame(px, mul(base, 0.5)) })
    return { top, side: paint((px) => chestSide(px, base, r, false)), bottom: top, front: paint((px) => chestSide(px, base, r, true)) }
  },
  zombiespawner: (base, r) => {
    const cage = paint((px) => spawnerCage(px, base, r))
    return { top: cage, side: cage, bottom: cage }
  },
  lever: (base, r) => {
    const parts = paint((px) => leverParts(px, base, r))
    return { top: parts, side: parts, bottom: parts }
  },
  sign: (base, r) => {
    const parts = paint((px) => signParts(px, base, r))
    return { top: parts, side: parts, bottom: parts }
  },
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
  // A bamboo stalk: only the middle 4 pixels show (it's drawn inset), so
  // the stalk's light edge, shading and growth nodes sit there.
  bamboo: (base, r) => {
    const side = paint((px) => {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const k = x === 6 ? 1.2 : x === 7 ? 1.06 : x === 9 ? 0.74 : 1
          px.set(x, y, mul(base, k * (0.95 + r() * 0.08)))
        }
      }
      for (const y of [3, 11]) for (let x = 6; x <= 9; x++) px.set(x, y, mul(base, 0.62))
      for (const y of [4, 12]) for (let x = 6; x <= 9; x++) px.set(x, y, mul(base, 1.15))
    })
    const top = paint((px) => {
      noise(px, mul(base, 0.75), r, 0.05)
      for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) px.set(x, y, mul([226, 220, 160], 0.95 + r() * 0.08))
    })
    return { top, side, bottom: top }
  },
  // Plaster panels between dark timber beams, with a cross brace.
  timberframe: (base, r) => {
    const side = paint((px) => {
      noise(px, base, r, 0.04)
      const wood = [86, 58, 34]
      for (let i = 0; i < S; i++) {
        for (const w of [0, 15]) {
          px.set(i, w, mul(wood, 0.9 + r() * 0.15))
          px.set(w, i, mul(wood, 0.9 + r() * 0.15))
        }
        px.set(i, i, mul(wood, 0.9 + r() * 0.15))
        if (i > 0) px.set(i - 1, i, mul(wood, 0.8))
      }
    })
    const top = paint((px) => planks(px, [110, 76, 44], r))
    return { top, side, bottom: top }
  },
  paperlantern: (base, r) => {
    const side = paint((px) => {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const glow = 1.15 - Math.abs(x - 7.5) / 16
          px.set(x, y, mul(base, glow * (y % 4 === 0 ? 0.7 : 0.96 + r() * 0.06)))
        }
      }
      for (let i = 0; i < S; i++) for (const y of [0, 15]) px.set(i, y, [60, 40, 26])
    })
    const top = paint((px) => { noise(px, [70, 48, 30], r, 0.08); for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) px.set(x, y, mul(base, 1.2)) })
    return { top, side, bottom: top }
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
  snow: (px, b, r) => noise(px, b, r, 0.03), stone: rock,
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
  tubecoral: (px, b, r) => coralPlant(px, b, r, 'tube'),
  braincoral: (px, b, r) => coralPlant(px, b, r, 'branch'),
  firecoral: (px, b, r) => coralPlant(px, b, r, 'branch'),
  bubblecoral: (px, b, r) => coralPlant(px, b, r, 'bubble'),
  horncoral: (px, b, r) => coralPlant(px, b, r, 'fan'),
  seagrass: (px, b, r) => coralPlant(px, b, r, 'grass'),
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
  // 2026-10-16 blocks (villages, castles, nature).
  stonebricks: (px, b, r) => bricks(px, b, mul(b, 0.66), r, 4, 8, true),
  sandstonebricks: (px, b, r) => bricks(px, b, mul(b, 0.74), r, 4, 8, true),
  plaster: (px, b, r) => { noise(px, b, r, 0.035); speckle(px, mul(b, 0.92), r, 10) },
  thatch: thatch,
  roofshingles: shingles, slateshingles: shingles,
  birchleaves: leaves, spruceleaves: leaves, jungleleaves: leaves, cherryleaves: leaves, mangroveleaves: leaves, bambooleaves: leaves,
  azalealeaves: (px, b, r) => { leaves(px, b, r); for (let i = 0; i < 9; i++) { const x = Math.floor(r() * S); const y = Math.floor(r() * S); if (px.alpha(x, y)) px.set(x, y, [214, 120, 196]) } },
  dirtpath: (px, b, r) => { dirt(px, b, r); speckle(px, mul(b, 1.18), r, 14); speckle(px, [128, 122, 112], r, 6) },
}

// Bundles of straw laid in overlapping rows.
function thatch(px, base, r) {
  for (let x = 0; x < S; x++) {
    const f = 0.82 + r() * 0.3
    for (let y = 0; y < S; y++) {
      const row = y % 6
      px.set(x, y, mul(base, f * (row === 5 ? 0.62 : row === 0 ? 1.12 : 0.95 + r() * 0.1)))
    }
  }
}

// Overlapping rounded roof tiles, each row half a tile along.
function shingles(px, base, r) {
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / 4)
    const off = row % 2 ? 2 : 0
    for (let x = 0; x < S; x++) {
      const lx = (x + off) % 4
      const ly = y % 4
      let f = 0.92 + r() * 0.12
      if (ly === 3) f *= 0.6
      else if (lx === 0) f *= 0.78
      else if (ly === 0) f *= 1.1
      px.set(x, y, mul(base, f))
    }
  }
}

function paint(fn) {
  const px = new Px()
  fn(px)
  return px.toCanvas()
}


// Clean, simple pixel art (2026-10-17, Gaymi: "make the blocks more clearer
// instead of so burry like kirka and bloxd their blocks are simple but very
// clean"): every painted face goes through cleanPixels (PixelClean.js) - a
// few flat colours, no lone speckles - and is drawn crisp (nearest
// filtering) in BlockChunks. Liquids and glass keep their painting.

// Base (16x16) faces per block.
const cache = new Map()

function baseFaces(type) {
  const cached = cache.get(type.id)
  if (cached) return cached
  const base = hex(type.color)
  const r = rng(hashStr(type.id))
  let faces
  if (type.look) {
    // Special blocks: a base with a symbol (SpecialGlyphs.js).
    faces = specialFaces(type)
  } else if (OVERRIDE[type.id]) {
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
  if (!/^(water|lava)$/.test(type.id) && (!textureHasAlpha(type) || /leaves$/.test(type.id))) {
    for (const canvas of new Set(Object.values(faces))) cleanPixels(canvas)
  }
  if (!/^(water|lava)$/.test(type.id)) {
    const done = new Map()
    for (const k of Object.keys(faces)) {
      const src = faces[k]
      if (!done.has(src)) done.set(src, detailFace(src, hashStr(`${type.id}:${k}`), type.id, k))
      faces[k] = done.get(src)
    }
  }
  cache.set(type.id, faces)
  return faces
}

// Twice the detail, still crisp (2026-10-24, Gaymi: "can we make the whole
// game like not blocky texture like the sky without lagging", picked
// "smoother, detailed textures"; on 2026-10-17 they wanted clean, not
// blurry, so nothing here blurs): each 16x16 face becomes 32x32 -
// - stair-stepped edges between colours are smoothed (Scale2x: a pixel's
//   corner takes its neighbours' colour where they meet diagonally),
// - a faint grain of lighter and darker pixels gives the surface texture,
// - a soft lighter top-left and darker bottom-right rim makes each block
//   read as a solid, slightly rounded cube.
// See-through faces (glass, leaves) only get the smoothing.
// Graphics levels (GraphicsLevels.js): Simple and Balanced keep the plain
// 16x16 pictures (setTextureDetail(1)), the rest use the detailed ones.
let DETAIL = 2
export function textureDetail() {
  return DETAIL
}
// Changes the detail and forgets every picture made at the old one (the
// atlas is redrawn by BlockChunks.redrawAtlas).
export function setTextureDetail(n) {
  n = n === 1 ? 1 : n === 4 ? 4 : 2
  if (n === DETAIL) return false
  DETAIL = n
  cache.clear()
  iconCache.clear()
  return true
}
function detailFace(src, seed, id = '', face = 'side') {
  if (DETAIL === 1) return src
  const crisp = crispFace(src, seed)
  if (DETAIL !== 4) return crisp
  const real = realFace(crisp, seed)
  realSurface(real, id, face, seed)
  return real
}

// Natural unevenness (2026-10-26, Gaymi: "all texture packs have a big
// upgrade more realistic"): soft lighter and darker patches a few pixels
// across, wrapping round the picture so neighbouring blocks still join.
// -> brightness factor around 1 for pixel (x, y) of an m x m picture.
function patchNoise(seed, m) {
  const r = rng(seed ^ 0x5bd1)
  const grids = [4, 8].map((g) => ({ g, v: Array.from({ length: g * g }, () => r()) }))
  const smooth = (t) => t * t * (3 - 2 * t)
  return (x, y) => {
    let sum = 0
    for (const [k, { g, v }] of grids.entries()) {
      const fx = (x / m) * g
      const fy = (y / m) * g
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = smooth(fx - x0)
      const ty = smooth(fy - y0)
      const at = (a, b) => v[((b + g) % g) * g + ((a + g) % g)]
      const n = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
      sum += (n - 0.5) * (k === 0 ? 0.6 : 0.4)
    }
    return 1 + sum
  }
}

// In Real Life's pictures (2026-10-26, Gaymi picked "near photo-real" on
// the top level): the 32x32 picture doubled to 64x64 with smooth blending
// instead of hard pixel steps, then a fine natural grain and a light
// sharpen so it reads as a real surface (stone, bark, soil) up close.
// See-through faces (glass, leaves) are just doubled crisp, so their holes
// stay clean.
function realFace(src, seed) {
  const n = src.width
  const m = n * 2
  const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, n, n).data
  const out = new Uint8ClampedArray(m * m * 4)
  let opaque = true
  for (let i = 3; i < sd.length; i += 4) if (sd[i] < 255) opaque = false
  const at = (x, y, c) => sd[((((y + n) % n) * n + ((x + n) % n)) * 4) + c]
  const r = rng(seed ^ 0x9e37)
  const patch = patchNoise(seed ^ 0x77, m)
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < m; x++) {
      const o = (y * m + x) * 4
      if (!opaque) {
        for (let c = 0; c < 4; c++) out[o + c] = at(x >> 1, y >> 1, c)
        continue
      }
      // Smooth (bilinear) between the 4 nearest pixels, wrapping round.
      const fx = (x + 0.5) / 2 - 0.5
      const fy = (y + 0.5) / 2 - 0.5
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = fx - x0
      const ty = fy - y0
      const g = (1 + (r() - 0.5) * 0.06) * (1 + (patch(x, y) - 1) * 0.6)
      for (let c = 0; c < 3; c++) {
        const lin = (at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx) * (1 - ty) + (at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx) * ty
        // Light sharpen: push away from the blend toward the nearest pixel.
        const near = at(Math.round(fx), Math.round(fy), c)
        out[o + c] = (lin * 0.7 + near * 0.3) * g
      }
      out[o + 3] = 255
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = m
  canvas.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(out, m, m), 0, 0)
  return canvas
}

// Real surfaces on In Real Life (2026-10-30, Gaymi: "check if it actually
// looks like the block if it was based on irl like the rocks look so fake
// too smooth"): the smooth 64x64 picture alone looked like soft blobs, so
// natural blocks get what the real thing has at that size, drawn on top -
// a rough grit everywhere, then by material: crystal flecks (granite pink,
// white and black; diorite black on white), hairline cracks in rock,
// fine grains in sand, crumbs and tiny stones in soil, round shaded
// pebbles in gravel, deep furrows in bark and grain lines in planks.
// Matched by block id; the first rule that fits is used.
const SURFACES = [
  [/^(granite)$/, { grit: 0.16, flecks: [[[236, 214, 205], 70], [[40, 30, 30], 60], [[200, 120, 100], 50]], cracks: 1 }],
  [/^(diorite)$/, { grit: 0.1, flecks: [[[45, 45, 45], 90], [[120, 120, 120], 60]], cracks: 0 }],
  [/^(andesite|tuff)$/, { grit: 0.18, flecks: [[[70, 70, 70], 50], [[220, 220, 215], 30]], cracks: 2 }],
  [/^(stone|calcite|endstone|blackstone|cobbleddeepslate)$|ore$/, { grit: 0.18, flecks: [[0.7, 40], [1.25, 30]], cracks: 3 }],
  [/^(deepslate|basalt)$/, { grit: 0.16, flecks: [[0.75, 30]], cracks: 2, lines: true }],
  [/^(cobblestone|mossycobblestone)$/, { grit: 0.2, flecks: [[0.72, 40], [1.2, 30]], cracks: 1 }],
  [/^(netherrack)$/, { grit: 0.22, flecks: [[0.6, 50]], cracks: 1 }],
  [/^(gravel)$/, { grit: 0.12, pebbles: 70 }],
  [/^(sand|redsand|soulsand)$/, { grit: 0.16, grains: 260 }],
  [/^(sandstone)$/, { grit: 0.14, grains: 120, lines: true }],
  [/^(dirt|coarsedirt|podzol|mud|packedmud|rooteddirt|farmland)$/, { grit: 0.2, crumbs: 26, grains: 60 }],
  [/^(clay)$/, { grit: 0.08, grains: 40 }],
  [/^(snow)$/, { grit: 0.05, sparkle: 50 }],
  [/^(grass|mycelium)$/, { grit: 0.16, blades: true, crumbs: 18 }],
  [/log$|wood$|stem$/, { grit: 0.12, bark: true }],
  [/planks$/, { grit: 0.08, grain: true }],
]

function realSurface(canvas, id, face, seed) {
  const rule = SURFACES.find(([re]) => re.test(id))
  if (!rule) return
  const o = rule[1]
  const m = canvas.width
  const g = canvas.getContext('2d', { willReadFrequently: true })
  const img = g.getImageData(0, 0, m, m)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return
  const r = rng(seed ^ 0x51ed)
  const wrap = (v) => ((v % m) + m) % m
  const idx = (x, y) => (wrap(y) * m + wrap(x)) * 4
  const scale = (x, y, f) => {
    const i = idx(x, y)
    d[i] *= f
    d[i + 1] *= f
    d[i + 2] *= f
  }
  // A colour (rgb) or, as one number, a brightness of what's there.
  const paintAt = (x, y, c, amt = 1) => {
    if (typeof c === 'number') return scale(x, y, 1 + (c - 1) * amt)
    const i = idx(x, y)
    for (let k = 0; k < 3; k++) d[i + k] = d[i + k] * (1 - amt) + c[k] * amt
  }
  const top = face === 'top'
  const soilSide = (y) => o.blades && !top && y >= m * 0.28
  // Grit: fine bumps 1-3 pixels across plus a per-pixel grain, so the
  // surface reads rough instead of smooth.
  if (o.grit) {
    const fine = patchNoise(seed ^ 0x2b, m)
    const n4 = Array.from({ length: (m / 2) * (m / 2) }, () => r())
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < m; x++) {
        const lump = n4[(y >> 1) * (m / 2) + (x >> 1)] - 0.5
        scale(x, y, 1 + (lump * 1.3 + (r() - 0.5) * 1.1 + (fine(x * 4, y * 4) - 1) * 1.4) * o.grit)
      }
    }
  }
  // Long faint layers (deepslate, basalt, sandstone): bands across.
  if (o.lines) {
    for (let y = 0; y < m; y++) {
      const f = 1 + Math.sin(y * 0.9 + r() * 0.4) * 0.04 + (r() < 0.12 ? -0.08 : 0)
      for (let x = 0; x < m; x++) scale(id === 'basalt' ? y : x, id === 'basalt' ? x : y, f)
    }
  }
  // Crystal flecks: 1-2 pixel specks of their own colour.
  for (const [c, count] of o.flecks || []) {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(r() * m)
      const y = Math.floor(r() * m)
      const big = r() < 0.35
      paintAt(x, y, c, 0.75)
      if (big) {
        paintAt(x + 1, y, c, 0.55)
        paintAt(x, y + 1, c, 0.45)
      }
    }
  }
  // Hairline cracks: a wandering dark line with a lit lip under it.
  for (let k = 0; k < (o.cracks || 0); k++) {
    let x = r() * m
    let y = r() * m
    let a = r() * Math.PI * 2
    const len = 8 + Math.floor(r() * 18)
    for (let i = 0; i < len; i++) {
      scale(Math.floor(x), Math.floor(y), 0.62)
      scale(Math.floor(x), Math.floor(y) + 1, 1.12)
      a += (r() - 0.5) * 0.9
      x += Math.cos(a)
      y += Math.sin(a)
    }
  }
  // Sand / soil grains: single light and dark pixels.
  for (let i = 0; i < (o.grains || 0); i++) {
    const x = Math.floor(r() * m)
    const y = Math.floor(r() * m)
    scale(x, y, r() < 0.5 ? 0.78 : 1.2)
  }
  // Snow glints.
  for (let i = 0; i < (o.sparkle || 0); i++) paintAt(Math.floor(r() * m), Math.floor(r() * m), [255, 255, 255], 0.8)
  // Soil crumbs: little clods lit on top, shaded underneath, and a few
  // tiny grey stones.
  for (let i = 0; i < (o.crumbs || 0); i++) {
    const x = Math.floor(r() * m)
    const y = Math.floor(r() * m)
    if (o.blades && (top || !soilSide(y))) continue
    const w = 1 + Math.floor(r() * 2)
    const stoney = r() < 0.25
    for (let dy = 0; dy <= w; dy++) {
      for (let dx = 0; dx <= w; dx++) {
        if (stoney) paintAt(x + dx, y + dy, [128, 124, 116], 0.45)
        scale(x + dx, y + dy, dy === 0 ? 1.18 : dy === w ? 0.72 : 1)
      }
    }
  }
  // Grass: thin blade strokes on top (and along the green edge of the side).
  if (o.blades) {
    const count = top ? 140 : 40
    for (let i = 0; i < count; i++) {
      const x = Math.floor(r() * m)
      const y = top ? Math.floor(r() * m) : Math.floor(r() * m * 0.22)
      const len = 2 + Math.floor(r() * 3)
      const f = r() < 0.5 ? 1.22 : 0.76
      const lean = r() < 0.5 ? -1 : 1
      for (let k = 0; k < len; k++) scale(x + (k > 1 ? lean : 0), y - k, f)
    }
  }
  // Gravel: round pebbles, each lit from the top left with a shadow under.
  for (let i = 0; i < (o.pebbles || 0); i++) {
    const cx = r() * m
    const cy = r() * m
    const rad = 2.5 + r() * 4
    const tone = 0.75 + r() * 0.5
    const tint = r() < 0.2 ? [150, 120, 100] : null
    for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) {
      for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
        const dx = (x + 0.5 - cx) / rad
        const dy = (y + 0.5 - cy) / (rad * 0.8)
        const q = dx * dx + dy * dy
        if (q > 1.25) continue
        if (q > 1) {
          scale(x, y, 0.7)
          continue
        }
        if (tint) paintAt(x, y, tint, 0.25)
        scale(x, y, tone * (1.12 - (dx + dy) * 0.18) * (1 - q * 0.15))
      }
    }
  }
  // Bark: deep wavy furrows up the side; rings stay on the cut ends.
  if (o.bark && !top && face !== 'bottom') {
    for (let k = 0; k < 9; k++) {
      let x = r() * m
      for (let y = 0; y < m; y++) {
        x += (r() - 0.5) * 0.9
        scale(Math.floor(x), y, 0.58)
        scale(Math.floor(x) + 1, y, 0.82)
        scale(Math.floor(x) - 1, y, 1.14)
      }
    }
  }
  // Planks: fine grain lines along the board.
  if (o.grain) {
    for (let k = 0; k < 22; k++) {
      const y0 = Math.floor(r() * m)
      const x0 = Math.floor(r() * m)
      const len = 10 + Math.floor(r() * 30)
      const f = r() < 0.6 ? 0.86 : 1.1
      for (let i = 0; i < len; i++) scale(x0 + i, y0 + Math.round(Math.sin((x0 + i) * 0.15) * 0.6), f)
    }
  }
  g.putImageData(img, 0, 0)
}

// The 32x32 detailed picture (every level from Simple up).
function crispFace(src, seed) {
  const n = src.width
  const m = n * 2
  const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, n, n).data
  const at = (x, y) => (((y + n) % n) * n + ((x + n) % n)) * 4
  const same = (a, b) => sd[a] === sd[b] && sd[a + 1] === sd[b + 1] && sd[a + 2] === sd[b + 2] && sd[a + 3] === sd[b + 3]
  const out = new Uint8ClampedArray(m * m * 4)
  let opaque = true
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const P = at(x, y)
      if (sd[P + 3] < 255) opaque = false
      const A = at(x, y - 1)
      const B = at(x + 1, y)
      const C = at(x - 1, y)
      const D = at(x, y + 1)
      const quad = [
        same(C, A) && !same(C, D) && !same(A, B) ? A : P,
        same(A, B) && !same(A, C) && !same(B, D) ? B : P,
        same(D, C) && !same(D, B) && !same(C, A) ? C : P,
        same(B, D) && !same(B, A) && !same(D, C) ? D : P,
      ]
      for (let q = 0; q < 4; q++) {
        const o = ((y * 2 + (q >> 1)) * m + x * 2 + (q & 1)) * 4
        const i = quad[q]
        out[o] = sd[i]
        out[o + 1] = sd[i + 1]
        out[o + 2] = sd[i + 2]
        out[o + 3] = sd[i + 3]
      }
    }
  }
  if (opaque) {
    const r = rng(seed)
    const patch = patchNoise(seed, m)
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < m; x++) {
        let f = (1 + (r() - 0.5) * 0.07) * (1 + (patch(x, y) - 1) * 0.45)
        // The rim: two pixels deep, the outer one stronger.
        const lt = Math.min(x, y)
        const rb = Math.min(m - 1 - x, m - 1 - y)
        if (lt < 2 && lt <= rb) f *= lt === 0 ? 1.1 : 1.05
        else if (rb < 2) f *= rb === 0 ? 0.86 : 0.93
        const o = (y * m + x) * 4
        out[o] *= f
        out[o + 1] *= f
        out[o + 2] *= f
      }
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = m
  canvas.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(out, m, m), 0, 0)
  return canvas
}

// -> { top, side, bottom } 32x32 canvases (16x16 for water and lava) for
// this block type.
export function blockFaceCanvases(type) {
  return baseFaces(type)
}

// True when the texture itself carries transparency (glass panes, leaf
// holes, jelly blocks) - those render with the texture's own alpha rather
// than one flat opacity for the whole block.
export function textureHasAlpha(type) {
  return !!type.plant || type.id === 'glass' || GLASS_IDS.test(type.id) || /leaves$/.test(type.id) || type.id === 'honeyblock' || type.id === 'slimeblock' || type.id === 'zombiespawner'
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
  // n is whatever size the faces really are.
  const shaded = (src, dark) => {
    const n = src.width
    const c = document.createElement('canvas')
    c.width = c.height = n
    const cc = c.getContext('2d', { willReadFrequently: true })
    cc.drawImage(src, 0, 0)
    cc.globalCompositeOperation = 'source-atop'
    cc.fillStyle = `rgba(0,0,0,${dark})`
    cc.fillRect(0, 0, n, n)
    return c
  }
  // crop: how much of the texture's height to show (the bottom part, for
  // a slab's sides).
  const face = (src, origin, xAxis, yAxis, dark, crop = 1) => {
    const n = src.width
    ctx.setTransform(xAxis[0] / n, xAxis[1] / n, yAxis[0] / n, yAxis[1] / n, origin[0], origin[1])
    ctx.drawImage(dark ? shaded(src, dark) : src, 0, n * (1 - crop), n, n * crop, 0, 0, n, n)
  }
  face(faces.side, L, [B[0] - L[0], B[1] - L[1]], [0, h], 0.22, heightFrac)
  face(faces.side, B, [R[0] - B[0], R[1] - B[1]], [0, h], 0.4, heightFrac)
  face(faces.top, T, [R[0] - T[0], R[1] - T[1]], [L[0] - T[0], L[1] - T[1]], 0)
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}

// A plant's (coral, seagrass) icon: its picture standing flat, like
// Minecraft's flowers in the inventory.
export function plantIconURL(type, size = 64) {
  const key = `plant:${type.id}:${size}`
  if (iconCache.has(key)) return iconCache.get(key)
  const src = blockFaceCanvases(type).side
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, size * 0.08, size * 0.08, size * 0.84, size * 0.84)
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}

// Stairs: a slab with a half-depth block standing on its back half, drawn
// in the same isometric view as blockIconURL. Unit-cube coordinates: x
// runs toward the right corner, z toward the left, y up; only the top,
// the z = max and the x = max faces of each box show.
export function stairsIconURL(type, size = 64) {
  return boxesIconURL(type, 'stairs', [[0, 1, 0, 0.5, 0, 1], [0, 1, 0.5, 1, 0, 0.5]], size)
}

// Fences show as a fence - two posts joined by two rails - not a whole
// block (2026-10-24, Gaymi: "when you holding a block the block in hotbar
// should not look like a block ... its a fence but a block in the hotbar").
export function fenceIconURL(type, size = 64) {
  return boxesIconURL(type, 'fence', [
    [0.05, 0.3, 0, 1, 0.375, 0.625],
    [0.3, 0.7, 0.75, 0.9, 0.44, 0.56],
    [0.3, 0.7, 0.4, 0.55, 0.44, 0.56],
    [0.7, 0.95, 0, 1, 0.375, 0.625],
  ], size)
}

// A ladder shows flat, as a ladder: two rails and rungs cut out of its
// wood's texture, see-through between them.
export function ladderIconURL(type, size = 64) {
  const key = `${type.id}:${size}:ladder`
  if (iconCache.has(key)) return iconCache.get(key)
  const wood = blockFaceCanvases(type).side
  const n = wood.width
  const mask = document.createElement('canvas')
  mask.width = mask.height = n
  const m = mask.getContext('2d', { willReadFrequently: true })
  const u = n / 16
  m.fillStyle = '#000'
  m.fillRect(2 * u, 0, 2 * u, n)
  m.fillRect(12 * u, 0, 2 * u, n)
  for (const y of [1, 5, 9, 13]) m.fillRect(2 * u, y * u, 12 * u, 2 * u)
  m.globalCompositeOperation = 'source-in'
  m.drawImage(wood, 0, 0)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  const pad = size * 0.08
  ctx.drawImage(mask, pad, pad, size - pad * 2, size - pad * 2)
  const url = canvas.toDataURL()
  iconCache.set(key, url)
  return url
}

// Boxes [x0, x1, y0, y1, z0, z1] of a unit cube, back ones first, drawn in
// the same isometric view as blockIconURL.
function boxesIconURL(type, name, boxes, size) {
  const key = `${type.id}:${size}:${name}`
  if (iconCache.has(key)) return iconCache.get(key)
  const faces = blockFaceCanvases(type)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
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
    const n = src.width
    const c = document.createElement('canvas')
    c.width = c.height = n
    const cc = c.getContext('2d', { willReadFrequently: true })
    cc.drawImage(src, 0, 0)
    cc.globalCompositeOperation = 'source-atop'
    cc.fillStyle = `rgba(0,0,0,${dark})`
    cc.fillRect(0, 0, n, n)
    return c
  }
  // A parallelogram from origin along xAxis/yAxis, showing the texture's
  // rows from v0 to v1 (0 = top of the texture).
  const face = (src, origin, xAxis, yAxis, dark, v0 = 0, v1 = 1) => {
    const n = src.width
    ctx.setTransform(xAxis[0] / n, xAxis[1] / n, yAxis[0] / n, yAxis[1] / n, origin[0], origin[1])
    ctx.drawImage(shade(src, dark), 0, n * v0, n, n * (v1 - v0), 0, 0, n, n)
  }
  const box = (x0, x1, y0, y1, z0, z1) => {
    face(faces.side, at(x0, y1, z1), sub(at(x1, y1, z1), at(x0, y1, z1)), sub(at(x0, y0, z1), at(x0, y1, z1)), 0.22, 1 - y1, 1 - y0)
    face(faces.side, at(x1, y1, z1), sub(at(x1, y1, z0), at(x1, y1, z1)), sub(at(x1, y0, z1), at(x1, y1, z1)), 0.4, 1 - y1, 1 - y0)
    face(faces.top, at(x0, y1, z0), sub(at(x1, y1, z0), at(x0, y1, z0)), sub(at(x0, y1, z1), at(x0, y1, z0)), 0)
  }
  for (const b of boxes) box(...b)
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

const flatIconCache = new Map()

// Picker icons for the lever and the sign (drawn, since a cube icon would
// look like a whole block of their texture).
export function gadgetIconURL(id, size = 64) {
  const key = `gadget:${id}:${size}`
  if (flatIconCache.has(key)) return flatIconCache.get(key)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const u = size / 16
  if (id === 'lever') {
    ctx.fillStyle = '#7d7d7d'
    ctx.fillRect(4 * u, 11 * u, 8 * u, 3 * u)
    ctx.fillStyle = '#5a5a5a'
    ctx.fillRect(4 * u, 13 * u, 8 * u, 1 * u)
    ctx.save()
    ctx.translate(8 * u, 11.5 * u)
    ctx.rotate(0.55)
    ctx.fillStyle = '#9a7444'
    ctx.fillRect(-1 * u, -9 * u, 2 * u, 9 * u)
    ctx.fillStyle = '#c8281e'
    ctx.fillRect(-1.3 * u, -10 * u, 2.6 * u, 2.4 * u)
    ctx.restore()
  } else {
    ctx.fillStyle = '#6b4a2c'
    ctx.fillRect(7 * u, 9 * u, 2 * u, 6 * u)
    ctx.fillStyle = '#b4864a'
    ctx.fillRect(1 * u, 2 * u, 14 * u, 8 * u)
    ctx.fillStyle = '#7a5a34'
    ctx.fillRect(1 * u, 9 * u, 14 * u, 1 * u)
    ctx.fillStyle = '#ffe9a8'
    for (const y of [4, 6.5]) ctx.fillRect(3 * u, y * u, 10 * u, 1 * u)
  }
  const url = c.toDataURL()
  flatIconCache.set(key, url)
  return url
}
