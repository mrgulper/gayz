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

function highlightRect(el) {
  const h = ensureHighlightEl()
  const r = el.getBoundingClientRect()
  h.style.display = 'block'
  h.style.left = `${r.left}px`
  h.style.top = `${r.top}px`
  h.style.width = `${r.width}px`
  h.style.height = `${r.height}px`
}

// Single click selects an element for editing; double-click instead lets
// the real page do its real thing (open the Hub/Store/whatever panel) -
// same "single click selects, double click enters" convention design
// tools like Figma use. Implemented by debouncing each click: if a second
// one lands within DBLCLICK_WINDOW_MS, the pending selection is cancelled
// and the real action replays instead.
const DBLCLICK_WINDOW_MS = 300
let pendingClickTimer = null
let replaying = false

function selectElement(el) {
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

// Double-clicking the 3D character avatar opens the real skin-upload file
// picker directly (see Game.js's upload-skin-input) instead of replaying a
// plain click on the canvas, which has no click handler of its own to
// replay in the first place.
function activateElement(el) {
  if (el.closest('#setup-avatar-wrap')) {
    const input = document.getElementById('upload-skin-input')
    if (input) {
      replaying = true
      input.click()
      replaying = false
      return
    }
  }
  replaying = true
  el.click()
  replaying = false
}

function onPickerClick(e) {
  if (!pickerEnabled || replaying) return
  e.preventDefault()
  e.stopPropagation()
  const el = e.target

  if (pendingClickTimer) {
    clearTimeout(pendingClickTimer)
    pendingClickTimer = null
    activateElement(el)
    return
  }
  pendingClickTimer = setTimeout(() => {
    pendingClickTimer = null
    selectElement(el)
  }, DBLCLICK_WINDOW_MS)
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
    if (pendingClickTimer) { clearTimeout(pendingClickTimer); pendingClickTimer = null }
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
