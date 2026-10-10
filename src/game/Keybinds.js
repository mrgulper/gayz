// Rebindable letter-key actions. Movement keeps its arrow-key fallback and
// crouch keeps its Ctrl fallback regardless of the rebound primary key, so
// remapping never locks anyone out of basic control.
import { setKeyNameLookup } from './i18n.js'

const STORAGE_KEY = 'gayz-keybinds'

export const ACTIONS = [
  { id: 'moveForward', defaultKey: 'KeyW', labelKey: 'actionMoveForward' },
  { id: 'moveBack', defaultKey: 'KeyS', labelKey: 'actionMoveBack' },
  { id: 'moveLeft', defaultKey: 'KeyA', labelKey: 'actionMoveLeft' },
  { id: 'moveRight', defaultKey: 'KeyD', labelKey: 'actionMoveRight' },
  { id: 'sprint', defaultKey: 'KeyE', labelKey: 'actionSprint' },
  { id: 'crouch', defaultKey: 'KeyC', labelKey: 'actionCrouch' },
  { id: 'reload', defaultKey: 'KeyR', labelKey: 'actionReload' },
  { id: 'interact', defaultKey: 'KeyF', labelKey: 'actionInteract' },
  { id: 'flashlight', defaultKey: 'KeyT', labelKey: 'actionFlashlight' },
  // Moved off KeyV (its old default) to make room for the hold-to-zoom
  // feature, which uses V to match Build Mode's existing zoom key.
  { id: 'noisemaker', defaultKey: 'End', labelKey: 'actionNoisemaker' },
  { id: 'barricade', defaultKey: 'KeyN', labelKey: 'actionBarricade' },
  // Health Pack, Armor, Grenade, C4, Molotov, Spike Trap and Adrenaline
  // live on the gameplay hotbar now (number keys 4-0, see Game.js's
  // HOTBAR_ITEMS, 2026-10-03) instead of a letter key each. The five
  // things that used to sit on hard-coded 6-0 got letter keys of their own
  // (the freed-up ones) so they can still be used - and rebound.
  { id: 'shield', defaultKey: 'KeyG', labelKey: 'actionShield' },
  { id: 'throwKnife', defaultKey: 'KeyB', labelKey: 'actionThrowKnife' },
  { id: 'turret', defaultKey: 'KeyJ', labelKey: 'actionTurret' },
  { id: 'alarm', defaultKey: 'KeyY', labelKey: 'actionAlarm' },
  { id: 'ration', defaultKey: 'KeyZ', labelKey: 'actionRation' },
  { id: 'emp', defaultKey: 'KeyU', labelKey: 'actionEmp' },
  { id: 'weaponWheel', defaultKey: 'KeyQ', labelKey: 'actionWeaponWheel' },
  { id: 'toggleMap', defaultKey: 'KeyL', labelKey: 'actionToggleMap' },
  // Minimap size: normal -> big -> big in the middle of the screen -> normal.
  { id: 'cycleMap', defaultKey: 'KeyM', labelKey: 'actionCycleMap' },
  { id: 'squadHold', defaultKey: 'Period', labelKey: 'actionSquadHold' },
  { id: 'drinkWater', defaultKey: 'Quote', labelKey: 'actionDrinkWater' },
  { id: 'journal', defaultKey: 'KeyI', labelKey: 'actionJournal' },
  { id: 'photoMode', defaultKey: 'KeyO', labelKey: 'actionPhotoMode' },
  { id: 'toggleView', defaultKey: 'KeyK', labelKey: 'actionToggleView' },
  { id: 'dodge', defaultKey: 'ShiftLeft', labelKey: 'actionDodge' },
  { id: 'fastTravelNearest', defaultKey: 'BracketLeft', labelKey: 'actionFastTravelNearest' },
  { id: 'smokeBomb', defaultKey: 'BracketRight', labelKey: 'actionSmokeBomb' },
  { id: 'parry', defaultKey: 'Minus', labelKey: 'actionParry' },
  { id: 'barricadeCrate', defaultKey: 'Backslash', labelKey: 'actionBarricadeCrate' },
  { id: 'medStation', defaultKey: 'Insert', labelKey: 'actionMedStation' },
  // Turns the gun to show it off at an angle, like Kirka (2026-10-10 - took
  // over the old Map 1's grapple, which nothing used any more).
  { id: 'inspectWeapon', defaultKey: 'KeyX', labelKey: 'actionInspectWeapon' },
  { id: 'stealthScreen', defaultKey: 'PageUp', labelKey: 'actionStealthScreen' },
  { id: 'nightVision', defaultKey: 'PageDown', labelKey: 'actionNightVision' },
  { id: 'decoyDummy', defaultKey: 'F2', labelKey: 'actionDecoyDummy' },
  { id: 'whistle', defaultKey: 'F3', labelKey: 'actionWhistle' },
]

// The gameplay hotbar's item slots (number keys 4-0, not rebindable -
// they're the slot numbers). Game.js draws them (HOTBAR_ITEMS: icons and
// counts by id); touch screens list them in the More menu.
export const HOTBAR_ITEM_SLOTS = [
  { id: 'healthPack', code: 'Digit4', labelKey: 'hotbarHealthPack' },
  { id: 'armor', code: 'Digit5', labelKey: 'hotbarArmor' },
  { id: 'grenade', code: 'Digit6', labelKey: 'hotbarGrenade' },
  { id: 'molotov', code: 'Digit7', labelKey: 'hotbarMolotov' },
  { id: 'c4', code: 'Digit8', labelKey: 'hotbarC4' },
  { id: 'trap', code: 'Digit9', labelKey: 'hotbarTrap' },
  { id: 'adrenaline', code: 'Digit0', labelKey: 'hotbarAdrenaline' },
]

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
  buildUse: 'KeyE',
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

// Human-readable label for a KeyboardEvent.code, for the rebind UI.
export function keyLabel(code) {
  if (!code) return '-'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const special = {
    Space: 'Space',
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
// action's current key, a hotbar slot's number, a fixed key, or "move"
// (all four movement keys, e.g. WASD).
setKeyNameLookup((id) => {
  if (id === 'move') return ['moveForward', 'moveLeft', 'moveBack', 'moveRight'].map((a) => keyLabel(bindings[a])).join('')
  if (bindings[id]) return keyLabel(bindings[id])
  const slot = HOTBAR_ITEM_SLOTS.find((s) => s.id === id)
  if (slot) return keyLabel(slot.code)
  if (FIXED_KEYS[id]) return keyLabel(FIXED_KEYS[id])
  return undefined
})
