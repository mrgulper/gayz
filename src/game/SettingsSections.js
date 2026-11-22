// Settings sections (2026-11-22): a row of jump-to-section chips under the
// tabs (#settings-jump-chips, rebuilt for the open tab) and headings that
// fold their rows away when clicked. Folded headings are remembered on this
// device (FOLD_KEY, DEVICE_ONLY in CloudMerge.js).
//
// A heading owns its next siblings up to the next heading, or a box that
// holds one (Couch Co-op's #couch-settings). Rows stay in place and just get
// .settings-fold-hidden, so MoreSettings' `before:` anchors keep working.
// While the search box has text, #settings-panel.settings-searching shows
// folded rows again so a match is never hidden.

import { t } from './i18n.js'

export const FOLD_KEY = 'gayz-settings-folds'
const HEADING = '.settings-section-heading'
// Each tab's own "Reset X to Defaults" button sits after the last section
// but belongs to the whole tab, so it never folds away.
const TAB_RESET_ID = /^reset-[a-z]+-defaults-btn$/

let folded = loadFolds()

function loadFolds() {
  try {
    const list = JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveFolds() {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...folded]))
  } catch {
    // Storage full or blocked: folding still works for this visit.
  }
}

function sectionRows(heading) {
  const rows = []
  for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.matches(HEADING) || el.querySelector(HEADING)) break
    if (!TAB_RESET_ID.test(el.id)) rows.push(el)
  }
  return rows
}

function headingsOf(page) {
  return [...page.querySelectorAll(HEADING)]
}

function activePage() {
  return document.querySelector('#settings-panel .settings-page:not([style*="display: none"])')
}

// Every heading on the page shows the remembered folded/open state.
export function applyFolds(page) {
  if (!page) return
  for (const h of headingsOf(page)) {
    const isFolded = folded.has(h.id)
    h.classList.toggle('folded', isFolded)
    h.setAttribute('aria-expanded', String(!isFolded))
    for (const row of sectionRows(h)) row.classList.toggle('settings-fold-hidden', isFolded)
  }
}

export function setFolded(heading, isFolded) {
  if (!heading?.id) return
  if (isFolded) folded.add(heading.id)
  else folded.delete(heading.id)
  saveFolds()
  applyFolds(heading.closest('.settings-page'))
  markCurrentChip()
}

function scrollToHeading(page, heading) {
  const top = page.scrollTop + heading.getBoundingClientRect().top - page.getBoundingClientRect().top - 4
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const target = Math.max(0, top)
  const start = page.scrollTop
  page.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' })
  // Smooth scrolling never starts in a background/hidden page; land there
  // anyway if it hasn't moved at all.
  setTimeout(() => {
    if (page.scrollTop === start && Math.abs(start - target) > 2) page.scrollTop = target
  }, 600)
}

// The chip for the section at the top of the scrolled page gets .active
// (same look as a picked tab, every theme).
function markCurrentChip() {
  const box = document.getElementById('settings-jump-chips')
  const page = activePage()
  if (!box || !page) return
  const chips = [...box.querySelectorAll('.settings-jump-chip')]
  if (!chips.length) return
  const pageTop = page.getBoundingClientRect().top
  let current = chips[0]
  for (const chip of chips) {
    const h = document.getElementById(chip.dataset.target)
    if (h && h.getBoundingClientRect().top - pageTop <= 24) current = chip
  }
  // Scrolled to the very bottom: the last section is the one being read,
  // even if its heading can't reach the top.
  if (page.scrollTop > 0 && page.scrollTop + page.clientHeight >= page.scrollHeight - 2) current = chips[chips.length - 1]
  for (const chip of chips) {
    const on = chip === current
    chip.classList.toggle('active', on)
    chip.setAttribute('aria-current', on ? 'true' : 'false')
  }
}

export function renderJumpChips(page) {
  const box = document.getElementById('settings-jump-chips')
  if (!box) return
  box.textContent = ''
  box.setAttribute('aria-label', t('settingsJumpChipsLabel'))
  const heads = page ? headingsOf(page).filter((h) => h.getClientRects().length && h.textContent.trim()) : []
  // A tab with fewer than two sections has nothing to jump between.
  box.classList.toggle('empty', heads.length < 2)
  if (heads.length < 2) return
  for (const h of heads) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'settings-jump-chip'
    chip.dataset.target = h.id
    chip.textContent = h.textContent.trim()
    box.appendChild(chip)
  }
  markCurrentChip()
}

// Called whenever a tab is shown (tab click, panel open).
export function showSettingsSections(page) {
  applyFolds(page)
  renderJumpChips(page)
}

export function bindSettingsSections() {
  const panel = document.getElementById('settings-panel')
  const box = document.getElementById('settings-jump-chips')
  if (!panel) return
  for (const h of panel.querySelectorAll(`.settings-page ${HEADING}`)) {
    h.setAttribute('role', 'button')
    h.tabIndex = 0
  }
  const toggle = (h) => setFolded(h, !h.classList.contains('folded'))
  panel.addEventListener('click', (e) => {
    const h = e.target.closest?.(`.settings-page ${HEADING}`)
    if (h) toggle(h)
  })
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const h = e.target.closest?.(`.settings-page ${HEADING}`)
    if (!h || e.target !== h) return
    e.preventDefault()
    toggle(h)
  })
  if (box) {
    box.addEventListener('click', (e) => {
      const chip = e.target.closest?.('.settings-jump-chip')
      const h = chip && document.getElementById(chip.dataset.target)
      const page = h?.closest('.settings-page')
      if (!page) return
      if (h.classList.contains('folded')) setFolded(h, false)
      scrollToHeading(page, h)
    })
  }
  let queued = false
  for (const page of panel.querySelectorAll('.settings-page')) {
    page.addEventListener('scroll', () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        markCurrentChip()
      })
    }, { passive: true })
  }
}

// Search box: folded rows show while there's a filter.
export function setSettingsSearching(on) {
  document.getElementById('settings-panel')?.classList.toggle('settings-searching', !!on)
}
