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
// Ordered array, not a single element - shift-click adds/removes instead
// of replacing, so one edit (color, hidden, etc.) can apply to several
// elements at once. selectedEls[0] is "primary" - its own current values
// are what the sidebar's fields show/start from.
let selectedEls = []
const SELECTION_OUTLINE = '2px dashed #4ee06f'

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

// additive (shift-click) toggles el in/out of the current selection
// instead of replacing it - clicking an already-selected element with
// shift held deselects just that one, matching standard multi-select
// conventions (Figma, design tools, file managers).
function selectElement(el, additive) {
  if (additive) {
    const idx = selectedEls.indexOf(el)
    if (idx === -1) {
      selectedEls.push(el)
      el.style.outline = SELECTION_OUTLINE
    } else {
      selectedEls[idx].style.outline = ''
      selectedEls.splice(idx, 1)
    }
  } else {
    clearSelectionOutline()
    selectedEls = [el]
    el.style.outline = SELECTION_OUTLINE
  }
  broadcastSelection()
}

function clearSelectionOutline() {
  for (const el of selectedEls) el.style.outline = ''
}

function clearSelection() {
  clearSelectionOutline()
  selectedEls = []
  broadcastSelection()
}

// Sidebar always reflects the PRIMARY (first-selected) element's own
// current values - editing still applies to every selected element (see
// the gzc-edit handler below), this just decides what the fields start
// showing when the selection changes.
function broadcastSelection() {
  if (!selectedEls.length) {
    window.parent.postMessage({ type: 'gzc-selected', count: 0 }, TRUSTED_CONSOLE_ORIGIN)
    return
  }
  const primary = selectedEls[0]
  const cs = getComputedStyle(primary)
  window.parent.postMessage(
    {
      type: 'gzc-selected',
      count: selectedEls.length,
      id: elementId(primary),
      tag: primary.tagName.toLowerCase(),
      text: primary.children.length === 0 ? primary.textContent : null,
      color: cs.color,
      hidden: primary.style.display === 'none',
      fontSize: primary.style.fontSize || cs.fontSize,
      backgroundImage: primary.style.backgroundImage || '',
    },
    TRUSTED_CONSOLE_ORIGIN
  )
}

// Shared by the gzc-edit/gzc-undo handlers below - one place that knows
// how to read/write each editable prop, so undo can capture a real
// "previous value" per element before applying a batch edit.
function getPropValue(el, prop) {
  if (prop === 'text') return el.textContent
  if (prop === 'color') return el.style.color
  if (prop === 'x') return getOffset(el).x
  if (prop === 'y') return getOffset(el).y
  if (prop === 'hidden') return el.style.display === 'none'
  if (prop === 'fontSize') return el.style.fontSize
  if (prop === 'backgroundImage') return el.style.backgroundImage
  return undefined
}

function setPropValue(el, prop, value) {
  if (prop === 'text') el.textContent = value
  else if (prop === 'color') el.style.color = value
  else if (prop === 'x' || prop === 'y') {
    const cur = getOffset(el)
    cur[prop] = Number(value) || 0
    setOffset(el, cur.x, cur.y)
  } else if (prop === 'hidden') el.style.display = value ? 'none' : ''
  else if (prop === 'fontSize') el.style.fontSize = value
  else if (prop === 'backgroundImage') el.style.backgroundImage = value ? `url("${value}")` : ''
}

// One entry per edit ACTION (which may touch several elements at once
// under multi-select), not per element - one Undo click reverts the
// whole action in one step. No cap/redo; a whole-session stack is cheap
// enough for how few edits a real console session makes.
const undoStack = []

// Named Session Snapshots (console's own Console Menu) - the LATEST
// value per element+prop touched this page life, keyed so re-editing the
// same field just overwrites its entry rather than growing forever.
// Deliberately separate from undoStack above (which tracks PREVIOUS
// values for reverting one action at a time) - this tracks CURRENT
// values for the console to save/restore a whole session later via
// gzc-get-session-edits/gzc-apply-by-id below. Not affected by Undo -
// undoing a change here doesn't retroactively "unrecord" it, since a
// snapshot is a best-effort convenience, not a true source of truth.
const sessionEdits = new Map()

function recordSessionEdit(id, prop, value) {
  sessionEdits.set(`${id}::${prop}`, { id, prop, value })
}

// elementId() above produces either a real #id or a synthetic
// "tag:nth-child(n) > ..." path - both are already valid CSS selectors,
// so a plain querySelector handles both without needing to know which
// kind it's looking at.
function findElementById(id) {
  try {
    return document.querySelector(id)
  } catch {
    return null
  }
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
  // Captured now, not read from the event again inside the deferred
  // timeout below - by the time that fires the original event is gone.
  const additive = e.shiftKey

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
    selectElement(el, additive)
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
const REORDER_SLIDE_MS = 150

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

  // FLIP animation (First/Last/Invert/Play) for the buttons being passed
  // over - el itself (actively being dragged) is excluded and keeps
  // snapping straight to the mouse-driven slot, only the OTHERS get a
  // smooth slide, otherwise every mousemove tick would recompute rects for
  // a still-in-flight transition and stutter. Naturally a no-op on ticks
  // where nothing actually moved (prevRect === nextRect), since dragging
  // fires this on every mousemove, not just on a real reorder.
  const prevRects = new Map()
  for (const btn of others) { if (btn !== el) prevRects.set(btn, btn.getBoundingClientRect()) }

  others.forEach((btn, i) => { btn.style.order = i })
  if (addBtn) addBtn.style.order = others.length

  for (const [btn, prevRect] of prevRects) {
    const dy = prevRect.top - btn.getBoundingClientRect().top
    if (!dy) continue
    btn.style.transition = 'none'
    btn.style.transform = `translateY(${dy}px)`
    requestAnimationFrame(() => {
      btn.style.transition = `transform ${REORDER_SLIDE_MS}ms ease`
      btn.style.transform = ''
    })
  }
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
    // Dragging always collapses to a single selection (dragging a whole
    // multi-selection as a group isn't supported) - additive:false even
    // if dragState.el happened to already be part of one.
    selectElement(dragState.el, false)
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

// Escape clears the whole selection (and its outlines) - the only way to
// deselect previously was clicking something else, which single-select
// never needed since selecting the new thing always replaced the old.
function onPickerKeyDown(e) {
  if (!pickerEnabled) return
  if (e.key === 'Escape') clearSelection()
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
    document.addEventListener('keydown', onPickerKeyDown, true)
    ensureAddButton()
  } else if (msg.type === 'gzc-disable-picker') {
    pickerEnabled = false
    document.removeEventListener('click', onPickerClick, true)
    document.removeEventListener('mousedown', onPickerMouseDown, true)
    document.removeEventListener('mousemove', onPickerMouseMove, true)
    document.removeEventListener('mouseup', onPickerMouseUp, true)
    document.removeEventListener('keydown', onPickerKeyDown, true)
    if (pendingClickTimer) { clearTimeout(pendingClickTimer); pendingClickTimer = null }
    dragState = null
    clearSelection()
    removeAddButton()
  } else if (msg.type === 'gzc-edit' && selectedEls.length) {
    // One undo entry per action, covering every element it touched (see
    // undoStack's own comment) - captured before applying, not after.
    undoStack.push(selectedEls.map((el) => ({ el, prop: msg.prop, prevValue: getPropValue(el, msg.prop) })))
    for (const el of selectedEls) {
      setPropValue(el, msg.prop, msg.value)
      recordSessionEdit(elementId(el), msg.prop, msg.value)
    }
  } else if (msg.type === 'gzc-get-session-edits') {
    window.parent.postMessage({ type: 'gzc-session-edits', edits: [...sessionEdits.values()] }, TRUSTED_CONSOLE_ORIGIN)
  } else if (msg.type === 'gzc-apply-by-id' && Array.isArray(msg.edits)) {
    // Named Session Snapshots' load path - re-applies a previously saved
    // {id, prop, value} list directly by looking each element back up,
    // without needing it selected first (that's the whole point - restore
    // a whole session's edits in one message instead of reselecting and
    // re-typing every field by hand).
    for (const { id, prop, value } of msg.edits) {
      const el = findElementById(id)
      if (el) {
        setPropValue(el, prop, value)
        recordSessionEdit(id, prop, value)
      }
    }
  } else if (msg.type === 'gzc-undo') {
    const batch = undoStack.pop()
    if (batch) {
      for (const { el, prop, prevValue } of batch) setPropValue(el, prop, prevValue)
      // Refresh the sidebar's own fields so they reflect the reverted
      // value instead of continuing to show the just-undone one.
      if (selectedEls.length) broadcastSelection()
    }
  } else if (msg.type === 'gzc-set-theme') {
    document.documentElement.classList.toggle('ui-theme-old', msg.theme === 'old')
  }
})
