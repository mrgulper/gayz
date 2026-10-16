// The HD block-texture pass as plain pixel maths (2026-10-16) - no DOM, so
// it runs in a Web Worker (BlockTexturesHD.worker.js) off the main thread;
// see BlockTextures.js prepareHdTextures.
// Gaymi: "sharper, more realistic block textures ... close to no lag". Every
// 16x16 painter in BlockTextures.js still decides a block's layout (where the bricks,
// planks, stones and ore are); this pass turns each face into an HD_SIZE
// texture that reads like a realistic resource pack:
// 1. colour is upscaled smoothly *inside* each stone/plank/brick but stays
//    sharp across strong edges (each tap is weighted by how close its colour
//    is to the nearest source pixel),
// 2. a height map (the picture's brightness, smoothed, plus fine grain)
//    lights the surface from the top-left - bumps catch light, mortar,
//    cracks and seams sink into shadow (cavity darkening),
// 3. per-material grain: wood grain along the planks/bark, brushed metal,
//    woven cloth, fine speckle on ground, almost nothing on glass/liquids.
// Same number of draw calls and the same atlas, just more pixels in it, so
// the frame rate doesn't change (BlockChunks' `tile` holds it). Making all
// ~311 textures takes ~0.9 s of CPU, which is why it runs in a worker.
export const HD_SIZE = 64

// Material looks: relief = how strongly the height map lights the surface,
// cavity = how much low spots darken, grain = fine noise strength, stretch =
// grain lengthened along x (1) or y (2), sharp = colour edge sharpness
// (smaller keeps more edges), smooth = height blur radius in HD pixels.
const HD_STYLES = {
  stone: { relief: 2.2, cavity: 0.9, grain: 0.075, stretch: 0, sharp: 34, smooth: 2 },
  brick: { relief: 2.6, cavity: 1.3, grain: 0.07, stretch: 0, sharp: 30, smooth: 1 },
  ground: { relief: 1.8, cavity: 0.7, grain: 0.16, stretch: 0, sharp: 60, smooth: 1, epx: false, grit: 0.9 },
  wood: { relief: 1.5, cavity: 1.0, grain: 0.09, stretch: 1, sharp: 26, smooth: 1 },
  bark: { relief: 2.0, cavity: 1.1, grain: 0.1, stretch: 2, sharp: 30, smooth: 1 },
  metal: { relief: 0.9, cavity: 0.5, grain: 0.045, stretch: 1, sharp: 22, smooth: 1 },
  cloth: { relief: 0.8, cavity: 0.4, grain: 0.09, stretch: 0, sharp: 40, smooth: 2, weave: true },
  smooth: { relief: 0.6, cavity: 0.35, grain: 0.035, stretch: 0, sharp: 24, smooth: 2 },
  glow: { relief: 0.7, cavity: 0.3, grain: 0.04, stretch: 0, sharp: 30, smooth: 2 },
  leaves: { relief: 1.4, cavity: 0.6, grain: 0.1, stretch: 0, sharp: 40, smooth: 1 },
  glass: { relief: 0, cavity: 0, grain: 0.015, stretch: 0, sharp: 0, smooth: 0, crisp: true },
  liquid: { relief: 0.3, cavity: 0, grain: 0.02, stretch: 0, sharp: 60, smooth: 2 },
}


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

// Tileable value noise on a `period`-cell lattice over an n-pixel square.
function tileNoise(n, period, seed, sx = 1, sy = 1) {
  const r = rng(seed)
  const px = Math.max(1, Math.round(period * sx))
  const py = Math.max(1, Math.round(period * sy))
  const lat = new Float32Array(px * py)
  for (let i = 0; i < lat.length; i++) lat[i] = r() * 2 - 1
  const out = new Float32Array(n * n)
  const sm = (t) => t * t * (3 - 2 * t)
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * py
    const y0 = Math.floor(fy)
    const ty = sm(fy - y0)
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * px
      const x0 = Math.floor(fx)
      const tx = sm(fx - x0)
      const a = lat[(y0 % py) * px + (x0 % px)]
      const b = lat[(y0 % py) * px + ((x0 + 1) % px)]
      const c = lat[((y0 + 1) % py) * px + (x0 % px)]
      const d = lat[((y0 + 1) % py) * px + ((x0 + 1) % px)]
      out[y * n + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty
    }
  }
  return out
}

// Scale2x/EPX on RGBA data with wrap-around (textures tile), treating
// colours closer than EPX_SIMILAR as equal.
const EPX_SIMILAR = 28
function epx(d, w, h) {
  const out = new Uint8ClampedArray(w * h * 16)
  const at = (x, y) => ((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4
  const same = (a, b) => Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]) < EPX_SIMILAR && (d[a + 3] > 127) === (d[b + 3] > 127)
  const W2 = w * 2
  const put = (x, y, s) => {
    const o = (y * W2 + x) * 4
    out[o] = d[s]
    out[o + 1] = d[s + 1]
    out[o + 2] = d[s + 2]
    out[o + 3] = d[s + 3]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = at(x, y)
      const A = at(x, y - 1)
      const B = at(x + 1, y)
      const C = at(x - 1, y)
      const D = at(x, y + 1)
      let e0 = P, e1 = P, e2 = P, e3 = P
      if (!same(A, D) && !same(C, B)) {
        if (same(C, A)) e0 = C
        if (same(A, B)) e1 = B
        if (same(D, C)) e2 = C
        if (same(B, D)) e3 = D
      }
      put(x * 2, y * 2, e0)
      put(x * 2 + 1, y * 2, e1)
      put(x * 2, y * 2 + 1, e2)
      put(x * 2 + 1, y * 2 + 1, e3)
    }
  }
  return out
}

// Grain noise is made once per size/stretch and shared by every block.
const noiseCache = new Map()
function sharedNoise(n, period, sx, sy) {
  const key = `${n}:${period}:${sx}:${sy}`
  let a = noiseCache.get(key)
  if (!a) {
    a = tileNoise(n, period, hashStr(key), sx, sy)
    noiseCache.set(key, a)
  }
  return a
}

export function hdPixels(sd, w, h, styleName, seed) {
  const st = HD_STYLES[styleName] || HD_STYLES.stone
  const k = Math.round(HD_SIZE / Math.min(w, h)) || 1
  const W = w * k
  const H = h * k
  const od = new Uint8ClampedArray(W * H * 4)
  const wrap = (v, m) => ((v % m) + m) % m
  const sIdx = (x, y) => (wrap(y, h) * w + wrap(x, w)) * 4
  if (st.crisp) {
    // Glass: frames and edges stay sharp, the highlights get rounded by
    // EPX instead of staying square pixels, plus a whisper of grain.
    let up = sd
    for (let cw = w, ch = h; cw < W; cw *= 2, ch *= 2) up = epx(up, cw, ch)
    const g = tileNoise(W, 16, seed)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        const f = 1 + g[(y % W) * W + (x % W)] * st.grain
        od[o] = up[o] * f
        od[o + 1] = up[o + 1] * f
        od[o + 2] = up[o + 2] * f
        od[o + 3] = up[o + 3]
      }
    }
    return { data: od, width: W, height: H }
  }
  // 1. Upscale with Scale2x/EPX (twice for 4x): diagonal staircases -
  // mortar lines, cobble cracks, ore veins, leaf holes - become smooth
  // lines instead of 4x4 steps. "Same colour" means close enough
  // (EPX_SIMILAR), so the painters' per-pixel noise doesn't stop it.
  // Ground (grass, dirt, sand...) has no shapes to round - only noise,
  // which EPX would melt into puddles - so it's upscaled smoothly instead
  // and gets its detail from the grit below.
  let cur = sd
  if (st.epx === false) {
    cur = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / k - 0.5
      const y0 = Math.floor(v)
      const fy = v - y0
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / k - 0.5
        const x0 = Math.floor(u)
        const fx = u - x0
        const a = sIdx(x0, y0)
        const b = sIdx(x0 + 1, y0)
        const c = sIdx(x0, y0 + 1)
        const d = sIdx(x0 + 1, y0 + 1)
        const o = (y * W + x) * 4
        for (let ch = 0; ch < 3; ch++) {
          const top = sd[a + ch] + (sd[b + ch] - sd[a + ch]) * fx
          const bot = sd[c + ch] + (sd[d + ch] - sd[c + ch]) * fx
          cur[o + ch] = top + (bot - top) * fy
        }
        cur[o + 3] = sd[sIdx(Math.round(u), Math.round(v)) + 3]
      }
    }
  } else {
    let cw = w
    let ch = h
    while (cw < W) {
      cur = epx(cur, cw, ch)
      cw *= 2
      ch *= 2
    }
  }
  const col = new Float32Array(W * H * 3)
  const hgt = new Float32Array(W * H)
  const alpha = new Uint8ClampedArray(W * H)
  const sharp2 = st.sharp * st.sharp
  for (let i = 0; i < W * H; i++) {
    col[i * 3] = cur[i * 4]
    col[i * 3 + 1] = cur[i * 4 + 1]
    col[i * 3 + 2] = cur[i * 4 + 2]
    alpha[i] = cur[i * 4 + 3]
  }
  // Melt the 4x4 blocks the upscale leaves inside each region: an
  // edge-preserving (bilateral) blur, so stones/planks stay separate.
  if (st.sharp) {
    // 5x5 window; weights from lookup tables (exp() per tap made the whole
    // texture set take ~5 s).
    const R = 2
    const LUT_N = 256
    const LUT_MAX = 6 // colour distance (in sharp^2 units) past which weight ~ 0
    const lut = new Float32Array(LUT_N + 1)
    for (let i = 0; i <= LUT_N; i++) lut[i] = Math.exp(-(i / LUT_N) * LUT_MAX)
    const toLut = LUT_N / (LUT_MAX * sharp2)
    const spatial = new Float32Array((R * 2 + 1) * (R * 2 + 1))
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) spatial[(dy + R) * (R * 2 + 1) + dx + R] = Math.exp(-(dx * dx + dy * dy) / (R * R))
    const tmp = new Float32Array(col.length)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3
        const cr = col[o]
        const cg = col[o + 1]
        const cb = col[o + 2]
        let r = 0
        let g = 0
        let b = 0
        let ws = 0
        let si = 0
        for (let dy = -R; dy <= R; dy++) {
          const row = ((y + dy + H) % H) * W
          for (let dx = -R; dx <= R; dx++, si++) {
            const q = (row + (x + dx + W) % W) * 3
            const dr = col[q] - cr
            const dg = col[q + 1] - cg
            const db = col[q + 2] - cb
            const li = (dr * dr + dg * dg + db * db) * toLut
            if (li >= LUT_N) continue
            const ww = spatial[si] * lut[li | 0]
            r += col[q] * ww
            g += col[q + 1] * ww
            b += col[q + 2] * ww
            ws += ww
          }
        }
        tmp[o] = r / ws
        tmp[o + 1] = g / ws
        tmp[o + 2] = b / ws
      }
    }
    col.set(tmp)
  }
  for (let i = 0; i < W * H; i++) hgt[i] = (0.299 * col[i * 3] + 0.587 * col[i * 3 + 1] + 0.114 * col[i * 3 + 2]) / 255
  // Grain (tileable): mid-size mottling, fine grain and single-pixel grit,
  // stretched along the grain for wood, bark and brushed metal.
  const sx = st.stretch === 1 ? 0.25 : 1
  const sy = st.stretch === 2 ? 0.25 : 1
  const n1 = sharedNoise(W, 8, sx, sy)
  const n2 = sharedNoise(W, 20, sx, sy)
  const n3 = sharedNoise(W, W, st.stretch === 1 ? 0.35 : 1, st.stretch === 2 ? 0.35 : 1)
  // Each block reads the shared noise from its own offset, so no two
  // blocks get the same grain.
  const offX = seed % W
  const offY = (seed >>> 8) % W
  const weave = st.weave ? (x, y) => ((x >> 1) + (y >> 1)) % 2 ? 0.5 : -0.5 : null
  for (let i = 0; i < W * H; i++) {
    const x = i % W
    const y = Math.floor(i / W)
    const gi = ((y + offY) % W) * W + ((x + offX) % W)
    let n = n1[gi] * 0.4 + n2[gi] * 0.35 + n3[gi] * (st.grit ?? 0.45)
    if (weave) n = n * 0.5 + weave(x, y) * 0.5
    hgt[i] += n * st.grain * 0.8
    const f = 1 + n * st.grain
    col[i * 3] *= f
    col[i * 3 + 1] *= f
    col[i * 3 + 2] *= f
  }
  // 2. Smoothed height for lighting, and its wider average for cavities.
  // Box blur with running sums (cost doesn't grow with the radius), wrapped.
  const blur = (a, rad) => {
    if (!rad) return a
    const t = new Float32Array(a.length)
    const o = new Float32Array(a.length)
    const n = rad * 2 + 1
    for (let y = 0; y < H; y++) {
      const row = y * W
      let sum = 0
      for (let d = -rad; d <= rad; d++) sum += a[row + ((d + W) % W)]
      for (let x = 0; x < W; x++) {
        t[row + x] = sum / n
        sum += a[row + ((x + rad + 1) % W)] - a[row + ((x - rad + W) % W)]
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0
      for (let d = -rad; d <= rad; d++) sum += t[((d + H) % H) * W + x]
      for (let y = 0; y < H; y++) {
        o[y * W + x] = sum / n
        sum += t[((y + rad + 1) % H) * W + x] - t[((y - rad + H) % H) * W + x]
      }
    }
    return o
  }
  const hs = blur(hgt, st.smooth)
  const wide = blur(hgt, k * 2)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      // Light from the top-left: brighter where the surface rises toward it.
      const dx = hs[y * W + wrap(x + 1, W)] - hs[y * W + wrap(x - 1, W)]
      const dy = hs[wrap(y + 1, H) * W + x] - hs[wrap(y - 1, H) * W + x]
      let f = 1 + (-dx - dy) * st.relief * k / 4
      f *= 1 + Math.min(0, hgt[i] - wide[i]) * st.cavity
      f = Math.max(0.45, Math.min(1.45, f))
      const o = i * 4
      od[o] = col[i * 3] * f
      od[o + 1] = col[i * 3 + 1] * f
      od[o + 2] = col[i * 3 + 2] * f
      // Alpha stays crisp (leaf holes, glass frames, cut-outs).
      od[o + 3] = alpha[i]
    }
  }
  return { data: od, width: W, height: H }
}

