// GayzConsole bridge - a passive listener with zero effect on normal play.
// It does nothing at all unless the page is embedded in an iframe AND the
// parent frame explicitly sends it a 'gzc-enable-picker' message - regular
// players loading gayz.vercel.app directly never touch any of this code
// path. Only ever makes local, visual-only DOM changes in the visitor's
// own browser tab - nothing here reads/writes localStorage, calls any API,
// or persists anywhere, so there's no real security surface even if some
// other page iframed this one and sent it messages.
//
// See the separate GayzConsole project (own repo, own Vercel deploy, not
// linked from anywhere in this game) for the actual password-gated editor
// UI that talks to this bridge.

// Only GayzConsole's real deployed origin may talk to this bridge -
// checked on every inbound message, and used as the explicit target for
// every outbound one (instead of '*') so selected-element data is never
// handed to some other page that happened to iframe this one.
const TRUSTED_CONSOLE_ORIGIN = 'https://gayzconsole.vercel.app'

let pickerEnabled = false
let selectedEl = null
let highlightEl = null

function ensureHighlightEl() {
  if (highlightEl) return highlightEl
  highlightEl = document.createElement('div')
  highlightEl.style.cssText =
    'position:fixed;pointer-events:none;z-index:999999;border:2px solid #4ee06f;' +
    'background:rgba(78,224,111,0.12);display:none;box-sizing:border-box;'
  document.body.appendChild(highlightEl)
  return highlightEl
}

function elementId(el) {
  if (el.id) return `#${el.id}`
  // Fallback for un-id'd elements - an nth-child path good enough to
  // re-find the same element within this same page session (not meant to
  // be stable across reloads/builds).
  const parts = []
  let node = el
  while (node && node.nodeType === 1 && node !== document.body) {
    const parent = node.parentElement
    if (!parent) break
    const idx = Array.prototype.indexOf.call(parent.children, node) + 1
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${idx})`)
    node = parent
  }
  return parts.join(' > ')
}

function findByElementId(id) {
  if (id.startsWith('#')) return document.getElementById(id.slice(1))
  try {
    return document.querySelector(id)
  } catch {
    return null
  }
}

function highlightRect(el) {
  const h = ensureHighlightEl()
  const r = el.getBoundingClientRect()
  h.style.display = 'block'
  h.style.left = `${r.left}px`
  h.style.top = `${r.top}px`
  h.style.width = `${r.width}px`
  h.style.height = `${r.height}px`
}

function onPickerClick(e) {
  if (!pickerEnabled) return
  e.preventDefault()
  e.stopPropagation()
  const el = e.target
  selectedEl = el
  highlightRect(el)
  const cs = getComputedStyle(el)
  window.parent.postMessage(
    {
      type: 'gzc-selected',
      id: elementId(el),
      tag: el.tagName.toLowerCase(),
      text: el.children.length === 0 ? el.textContent : null,
      color: cs.color,
    },
    TRUSTED_CONSOLE_ORIGIN
  )
}

window.addEventListener('message', (event) => {
  if (event.origin !== TRUSTED_CONSOLE_ORIGIN) return
  if (event.source !== window.parent) return
  const msg = event.data
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'gzc-enable-picker') {
    pickerEnabled = true
    document.addEventListener('click', onPickerClick, true)
  } else if (msg.type === 'gzc-disable-picker') {
    pickerEnabled = false
    document.removeEventListener('click', onPickerClick, true)
    if (highlightEl) highlightEl.style.display = 'none'
  } else if (msg.type === 'gzc-edit' && selectedEl) {
    if (msg.prop === 'text') selectedEl.textContent = msg.value
    else if (msg.prop === 'color') selectedEl.style.color = msg.value
    else if (msg.prop === 'x' || msg.prop === 'y') {
      const cur = selectedEl.dataset.gzcOffset ? JSON.parse(selectedEl.dataset.gzcOffset) : { x: 0, y: 0 }
      cur[msg.prop] = Number(msg.value) || 0
      selectedEl.dataset.gzcOffset = JSON.stringify(cur)
      selectedEl.style.position = 'relative'
      selectedEl.style.left = `${cur.x}px`
      selectedEl.style.top = `${cur.y}px`
    }
    highlightRect(selectedEl)
  }
})
