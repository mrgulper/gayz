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
// handed to some other page that happened to iframe this one. Moved from
// Render (gayz-console.onrender.com) to Vercel (gayzconsole.vercel.app) -
// the console's own backend (password check) is now a Vercel serverless
// function instead of a persistent Express server, see gayz-console's own
// api/verify.js.
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

// Every real nav button carries its own explicit CSS `order` (see the
// reorderNavListItem comment below), so a freshly created button with no
// order set at all defaults to the CSS-initial 0 - tying it with General
// (also 0) and popping it up second in the visual list, nowhere near
// where it actually sits in the DOM. Gives el the next order after
// everything else already in the list, landing it at the true end by
// default instead of relying on a drag to fix that up first.
function placeAtEnd(el, list) {
  const maxOrder = [...list.children]
    .filter((c) => c !== el)
    .reduce((max, c) => Math.max(max, Number(getComputedStyle(c).order) || 0), 0)
  el.style.order = maxOrder + 1
}

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
  placeAtEnd(addBtn, navList)
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
  const list = addBtn.parentElement
  list.insertBefore(btn, addBtn)
  // Order matters: place the new button first (it inherits addBtn's old,
  // already-highest order), then bump addBtn again so it re-claims the
  // very top spot - keeps the trigger last no matter how many placeholder
  // buttons have piled up before it.
  placeAtEnd(btn, list)
  placeAtEnd(addBtn, list)
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

// Dragging a button that lives in the nav list (a real nav button, or a
// "+ New Feature" placeholder) reorders it in the list instead of applying
// a pixel offset - the surrounding buttons actually move out of the way to
// make room, same as a real drag-to-reorder list, rather than the dragged
// button just floating on top of them at whatever offset it was pushed to.
// Every other draggable element on the page keeps the plain offset drag
// below, since there's no list for them to reorder within.
function isNavListItem(el) {
  return !!el && el.parentElement && el.parentElement.id === 'menu-nav-buttons' && el.id !== ADD_BTN_ID
}

// A mousedown's real e.target is usually the icon <svg> or label <span>
// inside a nav button, not the <button> itself (same reason onPickerClick
// elsewhere in this file has to special-case things) - resolves up to the
// actual direct child of the nav list so isNavListItem/reorderNavListItem
// above see the button, not one of its children.
function closestNavListItem(el) {
  const btn = el && el.closest && el.closest('#menu-nav-buttons > *')
  return btn && btn.id !== ADD_BTN_ID ? btn : null
}

// Visual nav-button position is driven entirely by each button's CSS
// `order` (see _applyNavOrder() in Game.js, behind the user-facing Nav
// Order setting) - NOT by where it actually sits in the DOM, so moving
// el's DOM node on its own has zero visual effect (found this live: a
// first version that used insertBefore/appendChild silently did nothing,
// since every real nav button already carries its own explicit `order`
// that wins regardless of DOM position). Reassigns a fresh 0..N `order`
// to every button in the list instead, in whatever new sequence the drag
// produced, so the ones being passed over genuinely shift to make room.
// The "+ New Feature" trigger is excluded from the reorderable set and
// always gets the highest order of the group, so it can never end up
// anywhere but last.
function reorderNavListItem(el, clientY) {
  const list = el.parentElement
  const addBtn = document.getElementById(ADD_BTN_ID)
  const others = [...list.children]
    .filter((c) => c !== el && c !== addBtn)
    .sort((a, b) => Number(getComputedStyle(a).order) - Number(getComputedStyle(b).order))

  let insertAt = others.length
  for (let i = 0; i < others.length; i++) {
    const rect = others[i].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) { insertAt = i; break }
  }
  others.splice(insertAt, 0, el)
  others.forEach((btn, i) => { btn.style.order = i })
  if (addBtn) addBtn.style.order = others.length
}

function onPickerMouseDown(e) {
  if (!pickerEnabled || replaying) return
  const navItem = closestNavListItem(e.target)
  dragState = { el: navItem || e.target, startX: e.clientX, startY: e.clientY, dragging: false }
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
    dragState.isNavItem = isNavListItem(dragState.el)
    if (!dragState.isNavItem) {
      const origin = getOffset(dragState.el)
      dragState.origX = origin.x
      dragState.origY = origin.y
    }
    selectElement(dragState.el)
  }

  e.preventDefault()

  if (dragState.isNavItem) {
    reorderNavListItem(dragState.el, e.clientY)
    return
  }

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
