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

function getOffset(el) {
  return el.dataset.gzcOffset ? JSON.parse(el.dataset.gzcOffset) : { x: 0, y: 0 }
}

function setOffset(el, x, y) {
  el.dataset.gzcOffset = JSON.stringify({ x, y })
  el.style.position = 'relative'
  el.style.left = `${x}px`
  el.style.top = `${y}px`
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

// Console-only "+" button, appended under Map Editor (the real last nav
// button) whenever the picker is active - lets a new placeholder nav
// button be prototyped (renamed, recolored, dragged) using the exact same
// editing tools as everything else, without ever touching the real
// deployed game. Purely a DOM insertion in this browser tab; nothing here
// is saved or sent anywhere on its own - same "preview, then tell Claude
// to make it permanent" flow as every other edit.
const ADD_BTN_ID = 'gzc-add-btn'
let newButtonCount = 0

function ensureAddButton() {
  const navList = document.getElementById('menu-nav-buttons')
  const lastBtn = document.getElementById('build-mode-btn')
  if (!navList || !lastBtn || document.getElementById(ADD_BTN_ID)) return
  const addBtn = lastBtn.cloneNode(true)
  addBtn.id = ADD_BTN_ID
  addBtn.innerHTML = ''
  const span = document.createElement('span')
  span.textContent = '+ New Feature'
  addBtn.appendChild(span)
  navList.appendChild(addBtn)
}

function removeAddButton() {
  const addBtn = document.getElementById(ADD_BTN_ID)
  if (addBtn) addBtn.remove()
}

function insertNewButton() {
  const addBtn = document.getElementById(ADD_BTN_ID)
  const lastBtn = document.getElementById('build-mode-btn')
  if (!addBtn || !lastBtn) return
  newButtonCount++
  const btn = lastBtn.cloneNode(true)
  btn.id = `gzc-new-feature-${newButtonCount}`
  btn.innerHTML = ''
  const span = document.createElement('span')
  span.textContent = 'New Feature'
  btn.appendChild(span)
  addBtn.parentElement.insertBefore(btn, addBtn)
}

function onPickerClick(e) {
  if (!pickerEnabled || replaying) return
  if (dragJustHappened) { dragJustHappened = false; return }
  e.preventDefault()
  e.stopPropagation()
  const el = e.target

  if (el.closest(`#${ADD_BTN_ID}`)) {
    insertNewButton()
    return
  }

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

// Free-drag - press and drag any element to reposition it live, instead of
// only nudging it via the sidebar's X/Y number fields. A press that never
// moves past DRAG_THRESHOLD px still falls through to onPickerClick as a
// normal click/double-click; one that does becomes a drag instead, and
// dragJustHappened suppresses the click that would otherwise follow it.
const DRAG_THRESHOLD = 4
let dragState = null
let dragJustHappened = false

function onPickerMouseDown(e) {
  if (!pickerEnabled || replaying) return
  dragState = { el: e.target, startX: e.clientX, startY: e.clientY, dragging: false }
}

function onPickerMouseMove(e) {
  if (!pickerEnabled || !dragState) return
  const dx = e.clientX - dragState.startX
  const dy = e.clientY - dragState.startY

  if (!dragState.dragging) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
    dragState.dragging = true
    dragJustHappened = true
    if (pendingClickTimer) { clearTimeout(pendingClickTimer); pendingClickTimer = null }
    const origin = getOffset(dragState.el)
    dragState.origX = origin.x
    dragState.origY = origin.y
    selectElement(dragState.el)
  }

  e.preventDefault()
  const newX = dragState.origX + dx
  const newY = dragState.origY + dy
  setOffset(dragState.el, newX, newY)
  window.parent.postMessage({ type: 'gzc-position', x: newX, y: newY }, TRUSTED_CONSOLE_ORIGIN)
}

function onPickerMouseUp() {
  dragState = null
}

window.addEventListener('message', (event) => {
  if (event.origin !== TRUSTED_CONSOLE_ORIGIN) return
  if (event.source !== window.parent) return
  const msg = event.data
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'gzc-enable-picker') {
    pickerEnabled = true
    document.addEventListener('click', onPickerClick, true)
    document.addEventListener('mousedown', onPickerMouseDown, true)
    document.addEventListener('mousemove', onPickerMouseMove, true)
    document.addEventListener('mouseup', onPickerMouseUp, true)
    ensureAddButton()
  } else if (msg.type === 'gzc-disable-picker') {
    pickerEnabled = false
    document.removeEventListener('click', onPickerClick, true)
    document.removeEventListener('mousedown', onPickerMouseDown, true)
    document.removeEventListener('mousemove', onPickerMouseMove, true)
    document.removeEventListener('mouseup', onPickerMouseUp, true)
    if (pendingClickTimer) { clearTimeout(pendingClickTimer); pendingClickTimer = null }
    dragState = null
    removeAddButton()
  } else if (msg.type === 'gzc-edit' && selectedEl) {
    if (msg.prop === 'text') selectedEl.textContent = msg.value
    else if (msg.prop === 'color') selectedEl.style.color = msg.value
    else if (msg.prop === 'x' || msg.prop === 'y') {
      const cur = getOffset(selectedEl)
      cur[msg.prop] = Number(msg.value) || 0
      setOffset(selectedEl, cur.x, cur.y)
    }
  }
})
