// Phone panel heights (2026-11-25). On a 375x812 phone, Upgrades,
// Achievements and Global came out 24-56px taller than How to Play: their
// titles and tab rows wrap onto more lines, and Global's columns had no
// set height. Same idea as fitCommerceTabs (CommerceTabs.js): measure how
// much the box is taller than every panel's shared size (its min-height)
// and take that off the scroll area, so the box never grows.

// Upgrades / Achievements: CSS subtracts --panel-fit from every tab's
// scroll area (all tabs share the same title and tab rows).
const VAR_PANELS = ['upgrades-panel', 'achievements-panel']
// Global: its columns' height:100% forgets the title, so they get a
// height inline.
const INLINE_PANELS = { 'server-panel': '#server-panel-columns' }

function _box(panel) {
  return panel?.querySelector(':scope > .panel-box')
}

function _shown(panel) {
  return panel && panel.style.display !== 'none' && panel.getClientRects().length > 0
}

// How many px the box is taller than the shared panel size. offsetHeight,
// not the on-screen rect: the open animation scales the box.
function _extra(box) {
  const target = parseFloat(getComputedStyle(box).minHeight) || 0
  return Math.max(0, box.offsetHeight - target)
}

function _pageTop(el) {
  let top = 0
  for (; el; el = el.offsetParent) top += el.offsetTop
  return top
}

export function fitPanels() {
  for (const id of VAR_PANELS) {
    const panel = document.getElementById(id)
    const box = _box(panel)
    if (!box || !_shown(panel)) continue
    panel.style.removeProperty('--panel-fit')
    const extra = _extra(box)
    if (extra > 0.5) panel.style.setProperty('--panel-fit', `${extra}px`)
  }
  for (const [id, sel] of Object.entries(INLINE_PANELS)) {
    const panel = document.getElementById(id)
    const box = _box(panel)
    const area = panel?.querySelector(sel)
    if (!box || !area || !_shown(panel)) continue
    area.style.removeProperty('height')
    // Its height:100% ignores the title above it, so it spills out of the
    // bottom (or pushes the box taller). Work it out from the space around
    // it instead: the shared size minus the title above and the padding
    // below. offsetTop, not the on-screen rect: the open animation scales.
    const cs = getComputedStyle(box)
    const target = parseFloat(cs.minHeight) || 0
    if (box.offsetHeight <= target + 0.5 && box.scrollHeight <= target + 0.5) continue
    // (offsetTop starts inside the box's border, so add the border back.)
    const above = _pageTop(area) - _pageTop(box) + box.clientTop
    const below = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth)
    area.style.height = `${Math.max(0, target - above - below)}px`
  }
}

let _queued = false
let _changed = null
function _queueFit() {
  if (_queued) return
  _queued = true
  requestAnimationFrame(() => {
    _queued = false
    fitPanels()
    // Our own --panel-fit writes count as style changes; drop them so
    // fitting doesn't set itself off again.
    _changed?.takeRecords()
  })
}

// Re-fit when a panel opens, a tab switch changes its size, or the window
// resizes. A box already at the shared size is left alone, so fitting
// never sets itself off again.
export function bindPanelFit() {
  window.addEventListener('resize', _queueFit)
  if (typeof ResizeObserver === 'undefined') return
  const watch = new ResizeObserver((entries) => {
    for (const e of entries) {
      const t = e.target
      if (t.getClientRects().length && (_extra(t) > 0.5 || t.scrollHeight > t.offsetHeight + 0.5)) {
        _queueFit()
        return
      }
    }
  })
  // Opening a panel or changing the theme can leave the box the same size
  // it was, which ResizeObserver doesn't report - so watch those too.
  const changed = (_changed = new MutationObserver(_queueFit))
  changed.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  for (const id of [...VAR_PANELS, ...Object.keys(INLINE_PANELS)]) {
    const panel = document.getElementById(id)
    const box = _box(panel)
    if (!box) continue
    watch.observe(box)
    changed.observe(panel, { attributes: true, attributeFilter: ['style', 'class'] })
  }
}
