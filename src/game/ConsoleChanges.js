// Homepage edits saved from the Console (its Save button opens a GitHub
// pull request that only changes src/consoleChanges.json). Each change is
// { id, prop, value }: id is a CSS selector - "#some-id", or a short path
// from the nearest element with an id ("#play-btn > span:nth-child(2)").
//
// Applied the same in every theme and on phones. Text changes are English
// only (other languages keep their own translation), so this runs again at
// the end of every language switch (Game._applyLanguage). Bundled into the
// main script (no extra download), and an id that no longer exists is
// skipped quietly instead of breaking anything.
import data from '../consoleChanges.json'

const EDITABLE = new Set(['text', 'color', 'x', 'y', 'hidden', 'fontSize', 'backgroundImage'])

function find(id) {
  try {
    return document.querySelector(id)
  } catch {
    return null
  }
}

// x and y of the same element are saved as two changes - gathered first so
// both end up in one translate.
export function applyConsoleChanges(lang) {
  const list = Array.isArray(data && data.changes) ? data.changes : []
  if (!list.length) return
  const offsets = new Map()
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !EDITABLE.has(c.prop)) continue
    const el = find(c.id)
    if (!el) continue
    const v = c.value
    if (c.prop === 'text') {
      if (lang === 'en' && typeof v === 'string') el.textContent = v
    } else if (c.prop === 'color') {
      if (v) el.style.setProperty('color', String(v), 'important')
    } else if (c.prop === 'fontSize') {
      if (v) el.style.setProperty('font-size', /^\d+(\.\d+)?$/.test(String(v)) ? `${v}px` : String(v), 'important')
    } else if (c.prop === 'hidden') {
      if (v === true) el.style.setProperty('display', 'none', 'important')
    } else if (c.prop === 'backgroundImage') {
      if (v) el.style.backgroundImage = `url("${String(v).replace(/["\\\n]/g, '')}")`
    } else {
      const o = offsets.get(el) || { x: 0, y: 0 }
      o[c.prop] = Number(v) || 0
      offsets.set(el, o)
    }
  }
  for (const [el, o] of offsets) el.style.translate = `${o.x}px ${o.y}px`
}
