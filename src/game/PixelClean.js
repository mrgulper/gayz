// Clean, simple pictures (2026-10-17, Gaymi: "make the blocks more clearer
// instead of so burry like kirka and bloxd their blocks are simple but very
// clean ... same with the weapon"): a picture is cut down to k flat colours
// (a small k-means over its pixels) and lone pixels that hardly match their
// neighbours take the colour around them, so it reads as a few clean shapes
// instead of speckled noise. Used on every block face (BlockTextures.js) and
// the guns' colour pictures (Viewmodels.js). Changes the canvas in place.
export const CLEAN_COLORS = 4
export function cleanPixels(canvas, k = CLEAN_COLORS) {
  const W = canvas.width
  const H = canvas.height
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  const idx = []
  for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] >= 128) idx.push(i)
  if (idx.length < k * 2) return canvas
  // Start from k colours spread across the picture's brightness.
  const lum = (i) => d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11
  const sorted = [...idx].sort((a, b) => lum(a) - lum(b))
  let centers = []
  for (let c = 0; c < k; c++) {
    const i = sorted[Math.floor(((c + 0.5) / k) * sorted.length)]
    centers.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]])
  }
  const group = new Int8Array(W * H).fill(-1)
  for (let iter = 0; iter < 8; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0])
    for (const i of idx) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < centers.length; c++) {
        const dr = d[i * 4] - centers[c][0]
        const dg = d[i * 4 + 1] - centers[c][1]
        const db = d[i * 4 + 2] - centers[c][2]
        const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11
        if (dist < bestD) {
          bestD = dist
          best = c
        }
      }
      group[i] = best
      sum[best][0] += d[i * 4]
      sum[best][1] += d[i * 4 + 1]
      sum[best][2] += d[i * 4 + 2]
      sum[best][3]++
    }
    centers = centers.map((c, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c))
  }
  // Lone pixels (at most one neighbour of their colour, the picture tiling
  // round) take the commonest colour beside them.
  const at = (x, y) => group[((y + H) % H) * W + ((x + W) % W)]
  const out = Int8Array.from(group)
  for (const i of idx) {
    const x = i % W
    const y = Math.floor(i / W)
    const g = group[i]
    let same = 0
    const count = new Array(k).fill(0)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const n = at(x + dx, y + dy)
        if (n === g) same++
        if (n >= 0 && (dx === 0 || dy === 0)) count[n]++
      }
    }
    if (same > 1) continue
    const top = count.indexOf(Math.max(...count))
    if (top !== g && count[top] >= (same ? 3 : 2)) out[i] = top
  }
  for (const i of idx) {
    const c = centers[out[i]]
    d[i * 4] = Math.round(c[0])
    d[i * 4 + 1] = Math.round(c[1])
    d[i * 4 + 2] = Math.round(c[2])
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}
