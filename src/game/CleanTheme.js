// The two menu themes (2026-10-23): Old (the default - rust, paper, Rye)
// and Clean (flat and plain, one colour the player picks - Gaymi: "just
// plain colour whatever colour they pick", white to start). Golden was
// deleted the same day; a save that still says 'golden' lands on Clean.
//
// Clean's whole palette comes from that one colour: the page is the
// colour, text/buttons are near-black or near-white (whichever reads on
// it), panels and cards are the colour nudged a few % toward the text.
// index.html's first inline script has a copy of uiThemeOf + cleanVars
// so the very first paint is already right - keep the two the same.

export const CLEAN_DEFAULT_COLOR = '#ffffff'

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

export function cleanVars(color) {
  const hex = normalizeHex(color) || CLEAN_DEFAULT_COLOR
  const bg = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255
  const fg = lum > 0.55 ? [29, 29, 31] : [245, 245, 247]
  const mix = (t) => `rgb(${bg.map((c, i) => Math.round(c + (fg[i] - c) * t)).join(', ')})`
  return {
    '--clean-bg': hex,
    '--clean-fg': `rgb(${fg.join(', ')})`,
    '--clean-fg-rgb': fg.join(', '),
    '--clean-panel': mix(0.035),
    '--clean-surface': mix(0.08),
    '--clean-hover': mix(0.14),
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
}
