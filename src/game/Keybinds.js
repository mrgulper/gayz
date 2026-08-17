// Rebindable letter-key actions. Movement keeps its arrow-key fallback and
// crouch keeps its Ctrl fallback regardless of the rebound primary key, so
// remapping never locks anyone out of basic control.
const STORAGE_KEY = 'gayz-keybinds'

export const ACTIONS = [
  { id: 'moveForward', defaultKey: 'KeyW', labelKey: 'actionMoveForward' },
  { id: 'moveBack', defaultKey: 'KeyS', labelKey: 'actionMoveBack' },
  { id: 'moveLeft', defaultKey: 'KeyA', labelKey: 'actionMoveLeft' },
  { id: 'moveRight', defaultKey: 'KeyD', labelKey: 'actionMoveRight' },
  { id: 'sprint', defaultKey: 'KeyE', labelKey: 'actionSprint' },
  { id: 'crouch', defaultKey: 'KeyC', labelKey: 'actionCrouch' },
  { id: 'reload', defaultKey: 'KeyR', labelKey: 'actionReload' },
  { id: 'heal', defaultKey: 'KeyH', labelKey: 'actionHeal' },
  { id: 'armor', defaultKey: 'KeyG', labelKey: 'actionArmor' },
  { id: 'interact', defaultKey: 'KeyF', labelKey: 'actionInteract' },
  { id: 'flashlight', defaultKey: 'KeyT', labelKey: 'actionFlashlight' },
  // Moved off KeyV (its old default) to make room for the hold-to-zoom
  // feature, which uses V to match Build Mode's existing zoom key.
  { id: 'noisemaker', defaultKey: 'End', labelKey: 'actionNoisemaker' },
  { id: 'grenade', defaultKey: 'KeyB', labelKey: 'actionGrenade' },
  { id: 'barricade', defaultKey: 'KeyN', labelKey: 'actionBarricade' },
  { id: 'trap', defaultKey: 'KeyM', labelKey: 'actionTrap' },
  { id: 'molotov', defaultKey: 'KeyZ', labelKey: 'actionMolotov' },
  // Places a charge if none is armed yet, detonates the armed one if there
  // already is one - one key does both now (see Game.js's keydown handler).
  { id: 'c4', defaultKey: 'KeyJ', labelKey: 'actionC4' },
  { id: 'adrenaline', defaultKey: 'KeyY', labelKey: 'actionAdrenaline' },
  { id: 'emp', defaultKey: 'KeyU', labelKey: 'actionEmp' },
  { id: 'weaponWheel', defaultKey: 'KeyQ', labelKey: 'actionWeaponWheel' },
  { id: 'toggleMap', defaultKey: 'KeyL', labelKey: 'actionToggleMap' },
  { id: 'minimapZoom', defaultKey: 'Comma', labelKey: 'actionMinimapZoom' },
  { id: 'squadHold', defaultKey: 'Period', labelKey: 'actionSquadHold' },
  { id: 'horn', defaultKey: 'Semicolon', labelKey: 'actionHorn' },
  { id: 'drinkWater', defaultKey: 'Quote', labelKey: 'actionDrinkWater' },
  { id: 'journal', defaultKey: 'KeyI', labelKey: 'actionJournal' },
  { id: 'photoMode', defaultKey: 'KeyO', labelKey: 'actionPhotoMode' },
  { id: 'screenshot', defaultKey: 'KeyP', labelKey: 'actionScreenshot' },
  { id: 'toggleView', defaultKey: 'KeyK', labelKey: 'actionToggleView' },
  { id: 'dodge', defaultKey: 'ShiftLeft', labelKey: 'actionDodge' },
  { id: 'threatPing', defaultKey: 'Backquote', labelKey: 'actionThreatPing' },
  { id: 'taunt', defaultKey: 'Slash', labelKey: 'actionTaunt' },
  { id: 'fastTravelNearest', defaultKey: 'BracketLeft', labelKey: 'actionFastTravelNearest' },
  { id: 'smokeBomb', defaultKey: 'BracketRight', labelKey: 'actionSmokeBomb' },
  { id: 'parry', defaultKey: 'Minus', labelKey: 'actionParry' },
  { id: 'slowMo', defaultKey: 'Equal', labelKey: 'actionSlowMo' },
  { id: 'clipRecording', defaultKey: 'CapsLock', labelKey: 'actionClipRecording' },
  { id: 'barricadeCrate', defaultKey: 'Backslash', labelKey: 'actionBarricadeCrate' },
  { id: 'weaponInspect', defaultKey: 'Delete', labelKey: 'actionWeaponInspect' },
  { id: 'radio', defaultKey: 'Home', labelKey: 'actionRadio' },
]

function defaultBindings() {
  const defaults = {}
  for (const a of ACTIONS) defaults[a.id] = a.defaultKey
  return defaults
}

function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return { ...defaultBindings(), ...parsed }
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
