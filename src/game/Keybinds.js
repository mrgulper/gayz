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
  { id: 'noisemaker', defaultKey: 'KeyV', labelKey: 'actionNoisemaker' },
  { id: 'grenade', defaultKey: 'KeyB', labelKey: 'actionGrenade' },
  { id: 'barricade', defaultKey: 'KeyN', labelKey: 'actionBarricade' },
  { id: 'weaponWheel', defaultKey: 'KeyQ', labelKey: 'actionWeaponWheel' },
  { id: 'screenshot', defaultKey: 'KeyP', labelKey: 'actionScreenshot' },
  { id: 'toggleView', defaultKey: 'KeyX', labelKey: 'actionToggleView' },
  { id: 'dodge', defaultKey: 'ShiftLeft', labelKey: 'actionDodge' },
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
  }
  return special[code] || code
}
