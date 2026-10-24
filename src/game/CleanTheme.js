// The two menu themes (2026-10-23): Old (the default - rust, paper, Rye)
// and Clean (flat and plain, one colour the player picks - Gaymi: "just
// plain colour whatever colour they pick"; starts on apple.com's light
// grey #f5f5f7 since 2026-10-23, was white). Golden was
// deleted the same day; a save that still says 'golden' lands on Clean.
//
// Clean's whole palette comes from that one colour: the page is the
// colour, text/buttons are its opposite on the painter's colour wheel
// (Gaymi, 2026-10-23: "if they pick yellow it would be opposite with
// purple"), made dark on a light colour and light on a dark one so it
// always reads; a grey/white/black colour has no opposite, so its text
// stays near-black or near-white. Panels and cards are the colour nudged
// a few % toward the text.
// The homepage boxes (--clean-card: right-column buttons, profile card,
// Game Mode, Settings, coins bar, clock, hover menus) are filled with the
// opposite colour and their words are the picked colour (--clean-card-fg)
// - Gaymi, 2026-10-23: "everything on the homepage should fit with the
// colour they picked" (they used to be white).
// index.html's first inline script doesn't copy cleanVars any more: it
// reads the variables Game saved last time (CLEAN_VARS_KEY), so the very
// first paint is already right without a second copy of the colour maths.

export const CLEAN_DEFAULT_COLOR = '#f5f5f7'
// The last colour's variables, for index.html's first paint. Device-only
// (CloudMerge.DEVICE_ONLY_KEYS); written on picks and once at start, never
// while the swatch is being dragged.
export const CLEAN_VARS_KEY = 'gayz-clean-vars'
// The homepage picture the player uploaded (a JPEG data URL, already cut
// to the screen's shape). Device-only too - too big for Cloud Save.
export const CLEAN_BG_IMAGE_KEY = 'gayz-clean-bg-image'

// '#abc', 'abc', '#AABBCC' -> '#aabbcc'; anything else -> null.
export function normalizeHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim())
  if (!m) return null
  let h = m[1].toLowerCase()
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  return `#${h}`
}

export function uiThemeOf(settings) {
  const t = settings && settings.uiTheme
  return t === 'clean' || t === 'golden' ? 'clean' : 'old'
}

// Hue on the screen's colour wheel (0-360) -> the painter's wheel, where
// yellow sits opposite purple and red opposite green (on the screen's
// wheel yellow is opposite blue). Pairs of [screen, painter] hues.
const WHEEL = [[0, 0], [30, 60], [60, 120], [120, 180], [240, 240], [275, 300], [360, 360]]
function wheelMap(h, from, to) {
  for (let i = 1; i < WHEEL.length; i++) {
    const a = WHEEL[i - 1]
    const b = WHEEL[i]
    if (h <= b[from]) return a[to] + (h - a[from]) / (b[from] - a[from]) * (b[to] - a[to])
  }
  return h
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map((n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))))
}

function luminance(rgb) {
  const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

// The text colour for a page colour: its opposite, dark or light enough
// to read (at least 4.5:1, the usual readable-text contrast).
export function oppositeInk(bg) {
  const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255
  const light = lum > 0.55
  const [r, g, b] = bg.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  if (s < 0.15) return light ? [29, 29, 31] : [245, 245, 247]
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  h = (h * 60 + 360) % 360
  const opp = wheelMap((wheelMap(h, 0, 1) + 180) % 360, 1, 0)
  const bgLum = luminance(bg)
  const sat = Math.max(s, 0.6)
  let ink = light ? 0.32 : 0.78
  let fg = hslToRgb(opp, sat, ink)
  for (let i = 0; i < 20; i++) {
    const fgLum = luminance(fg)
    if ((Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05) >= 4.5) break
    ink = light ? Math.max(0.05, ink - 0.04) : Math.min(0.95, ink + 0.04)
    fg = hslToRgb(opp, sat, ink)
  }
  return fg
}

export function cleanVars(color) {
  const hex = normalizeHex(color) || CLEAN_DEFAULT_COLOR
  const bg = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const fg = oppositeInk(bg)
  const mix = (t) => `rgb(${bg.map((c, i) => Math.round(c + (fg[i] - c) * t)).join(', ')})`
  return {
    '--clean-bg': hex,
    '--clean-fg': `rgb(${fg.join(', ')})`,
    '--clean-fg-rgb': fg.join(', '),
    '--clean-panel': mix(0.035),
    '--clean-surface': mix(0.08),
    '--clean-hover': mix(0.14),
    '--clean-card': `rgb(${fg.join(', ')})`,
    '--clean-card-fg': hex,
    // The tick on a checked box, in the page colour (sits on --clean-fg).
    // Not needed for the first paint, so index.html's copy skips it.
    '--clean-check': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.2 8.4l3 3 6.6-6.8' fill='none' stroke='%23${hex.slice(1)}' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  }
}

export function applyUiTheme(settings, root = document.documentElement) {
  const clean = uiThemeOf(settings) === 'clean'
  root.classList.toggle('ui-theme-old', !clean)
  root.classList.toggle('ui-theme-clean', clean)
  const vars = cleanVars(settings && settings.cleanColor)
  for (const [k, v] of Object.entries(vars)) {
    if (clean) root.style.setProperty(k, v)
    else root.style.removeProperty(k)
  }
  applyCleanBgImage(root)
}

export function rememberCleanVars(settings) {
  const color = normalizeHex(settings && settings.cleanColor) || CLEAN_DEFAULT_COLOR
  const vars = cleanVars(color)
  delete vars['--clean-check']
  try { localStorage.setItem(CLEAN_VARS_KEY, JSON.stringify({ color, vars })) } catch { /* storage full or blocked */ }
}

export function getCleanBgImage() {
  try { return localStorage.getItem(CLEAN_BG_IMAGE_KEY) || '' } catch { return '' }
}

// --clean-bg-image is read by theme-clean.css's #menu-bg rule only, so
// Old never shows the picture.
export function applyCleanBgImage(root = document.documentElement) {
  const img = getCleanBgImage()
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) root.style.setProperty('--clean-bg-image', `url("${img}")`)
  else root.style.removeProperty('--clean-bg-image')
}

// A picked file -> a JPEG cut to the screen's shape (the middle of the
// picture kept, like a phone wallpaper), at most 1920px wide so it stays
// small enough to keep on the device.
export function cropToScreen(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const aspect = Math.max(0.3, Math.min(4, window.innerWidth / Math.max(1, window.innerHeight)))
      let sw = img.naturalWidth
      let sh = sw / aspect
      if (sh > img.naturalHeight) { sh = img.naturalHeight; sw = sh * aspect }
      const w = Math.round(Math.min(1920, sw))
      const h = Math.round(w / aspect)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not a picture')) }
    img.src = url
  })
}
