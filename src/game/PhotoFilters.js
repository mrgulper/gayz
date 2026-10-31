// Photo Mode's filters (PlaySpectate.js) - on their own so GayZ Features
// can count them without loading the game.
// The filters: [id, 4x5 colour matrix (rows r, g, b; the last number of
// each row is added, 0-1)] - the same numbers as an SVG feColorMatrix.
export const PHOTO_FILTERS = [
  ['none', null],
  ['warm', [1.08, 0.04, 0, 0, 0.03, 0.02, 1, 0, 0, 0.015, 0, 0, 0.82, 0, 0]],
  ['cool', [0.84, 0, 0.04, 0, 0, 0, 0.96, 0.06, 0, 0.01, 0, 0.08, 1.1, 0, 0.04]],
  ['bw', [0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0]],
  ['retro', [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0]],
  ['horror', [0.7, 0.45, 0.1, 0, 0.04, 0.1, 0.25, 0.05, 0, 0, 0.08, 0.15, 0.05, 0, 0]],
  ['candy', [1, 0.12, 0.04, 0, 0.06, 0, 0.92, 0.08, 0, 0.03, 0.08, 0.04, 1, 0, 0.1]],
]

// The SVG filters the live look uses (once, hidden in the page).
export function filterDefs() {
  if (document.getElementById('gz-photo-filters')) return
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.id = 'gz-photo-filters'
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0'
  for (const [id, m] of PHOTO_FILTERS) {
    if (!m) continue
    const f = document.createElementNS(ns, 'filter')
    f.id = `gz-photo-${id}`
    f.setAttribute('color-interpolation-filters', 'sRGB')
    const cm = document.createElementNS(ns, 'feColorMatrix')
    cm.setAttribute('type', 'matrix')
    cm.setAttribute('values', `${m.join(' ')} 0 0 0 1 0`)
    f.appendChild(cm)
    svg.appendChild(f)
  }
  document.body.appendChild(svg)
}

// The picture with a filter's matrix applied (2D canvas, changed in place).
export function applyFilter(canvas, m) {
  if (!m) return
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const o = [m[4] * 255, m[9] * 255, m[14] * 255]
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    d[i] = m[0] * r + m[1] * g + m[2] * b + o[0]
    d[i + 1] = m[5] * r + m[6] * g + m[7] * b + o[1]
    d[i + 2] = m[10] * r + m[11] * g + m[12] * b + o[2]
  }
  ctx.putImageData(img, 0, 0)
}
