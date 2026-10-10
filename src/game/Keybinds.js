// Settings > Controls: the keys Map 1 (walking the block city - Play and
// Try Map) reads, every one rebindable. Cleaned 2026-10-10 (Gaymi: "delete
// all of these") - the list still held ~35 actions from the deleted old
// Map 1 (flashlight, dodge, parry, fast travel, night vision...) that did
// nothing, and movement/sprint/crouch were shown but Try Map read W/A/S/D,
// Shift and C straight off the keyboard. Now BuildTryMode reads them from
// here (heldAction). Crouch keeps Ctrl/Caps Lock and movement the arrow
// keys as fallbacks (fallbackFor) unless another action took that key, so
// remapping never locks anyone out of basic control.
import { setKeyNameLookup } from './i18n.js'

const STORAGE_KEY = 'gayz-keybinds'

export const ACTIONS = [
  { id: 'moveForward', defaultKey: 'KeyW', labelKey: 'actionMoveForward' },
  { id: 'moveBack', defaultKey: 'KeyS', labelKey: 'actionMoveBack' },
  { id: 'moveLeft', defaultKey: 'KeyA', labelKey: 'actionMoveLeft' },
  { id: 'moveRight', defaultKey: 'KeyD', labelKey: 'actionMoveRight' },
  { id: 'jump', defaultKey: 'Space', labelKey: 'actionJump' },
  { id: 'sprint', defaultKey: 'ShiftLeft', labelKey: 'actionSprint' },
  { id: 'crouch', defaultKey: 'KeyC', labelKey: 'actionCrouch' },
  { id: 'reload', defaultKey: 'KeyR', labelKey: 'actionReload' },
  // Doors, chests, levers and the camp's people.
  { id: 'use', defaultKey: 'KeyE', labelKey: 'actionUse' },
  // Turns the gun to show it off at an angle, like Kirka (2026-10-10).
  { id: 'inspectWeapon', defaultKey: 'KeyX', labelKey: 'actionInspectWeapon' },
  // Minimap size: normal -> big -> big in the middle of the screen -> normal.
  { id: 'cycleMap', defaultKey: 'KeyM', labelKey: 'actionCycleMap' },
]

// Extra keys that also work for an action, as long as no action is bound
// to them.
const FALLBACK_KEYS = {
  moveForward: ['ArrowUp'],
  moveBack: ['ArrowDown'],
  moveLeft: ['ArrowLeft'],
  moveRight: ['ArrowRight'],
  sprint: ['ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight', 'CapsLock'],
}

// Keys that can't be rebound but still show up in text - the code that
// handles them reads them from here too, so text and behavior can't differ.
export const FIXED_KEYS = {
  inventory: 'Tab',
  buildTry: 'KeyT',
  buildMirror: 'KeyM',
  buildZoom: 'KeyV',
  buildFill: 'KeyF',
  buildReplace: 'KeyR',
  buildShape: 'KeyG',
  buildRotate: 'KeyQ',
}

function defaultBindings() {
  const defaults = {}
  for (const a of ACTIONS) defaults[a.id] = a.defaultKey
  return defaults
}

function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    // Only actions that still exist - removed ones (Taunt, Slow-Motion,
    // Screenshot... 2026-10-01) would otherwise linger in old saves and
    // still count as "taken" when another action is rebound to their key.
    const out = defaultBindings()
    for (const id of Object.keys(out)) if (typeof parsed[id] === 'string') out[id] = parsed[id]
    // Sprint's old default was E, which is Use now - a save still holding
    // it gets Shift back instead of two actions on one key.
    if (parsed.sprint === 'KeyE' && out.use === 'KeyE') out.sprint = 'ShiftLeft'
    return out
  } catch {
    return defaultBindings()
  }
}

function saveBindings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // Storage unavailable - rebinds just won't persist across sessions.
  }
}

let bindings = loadBindings()

// Re-reads storage - main.js calls this after Cloud Save's pre-boot pull
// (CloudPreBoot.js), which can change the saved keybinds after this module
// already loaded them at import time.
export function reloadBindings() {
  bindings = loadBindings()
}

export function getKeyFor(action) {
  return bindings[action]
}

export function setBinding(action, code) {
  bindings[action] = code
  saveBindings()
}

export function resetBindings() {
  bindings = defaultBindings()
  saveBindings()
}

// Export/Import Keybinds Code (Controls tab) - a plain {action: code}
// snapshot, same shape saveBindings already persists, just exposed for
// Game.js to base64-encode/decode rather than looping setBinding per
// action (which would call saveBindings() once per key instead of once
// total).
export function getAllBindings() {
  return { ...bindings }
}

export function setAllBindings(map) {
  const validIds = new Set(ACTIONS.map((a) => a.id))
  const next = { ...bindings }
  for (const [id, code] of Object.entries(map)) {
    if (validIds.has(id) && typeof code === 'string') next[id] = code
  }
  bindings = next
  saveBindings()
}

// Every key that does this action right now: its binding plus any free
// fallback key.
export function keysFor(action) {
  const bound = new Set(Object.values(bindings))
  return [bindings[action], ...(FALLBACK_KEYS[action] || []).filter((k) => !bound.has(k))].filter(Boolean)
}

// Is the action held, given the set of key codes currently down?
export function heldAction(keys, action) {
  return keysFor(action).some((k) => keys.has(k))
}

// Human-readable label for a KeyboardEvent.code, for the rebind UI.
export function keyLabel(code) {
  if (!code) return '-'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const special = {
    Space: 'Space',
    Period: '.',
    Comma: ',',
    Quote: "'",
    Semicolon: ';',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Tab: 'Tab',
    Backquote: '`',
    Slash: '/',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    CapsLock: 'Caps',
    Backslash: '\\',
  }
  return special[code] || code
}

// Fills {key:<id>} in any translated text (see i18n.js): a rebindable
// action's current key, a fixed key, or "move"
// (all four movement keys, e.g. WASD).
setKeyNameLookup((id) => {
  if (id === 'move') return ['moveForward', 'moveLeft', 'moveBack', 'moveRight'].map((a) => keyLabel(bindings[a])).join('')
  if (bindings[id]) return keyLabel(bindings[id])
  if (FIXED_KEYS[id]) return keyLabel(FIXED_KEYS[id])
  return undefined
})
