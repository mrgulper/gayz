// Couch Co-op without a controller (2026-11-15): Player 2 plays on the
// arrow keys and the number pad, so Player 1 keeps the mouse, W/A/S/D and
// the top-row numbers. This builds a pretend controller out of the keys
// that are down, shaped like a real Gamepad (buttons + axes), so all of
// CouchCoop / CouchGear / CouchHands / CouchToys works unchanged.
//
//   Arrows        up/down walk, left/right turn (steer in a vehicle; move
//                 around Player 2's menu and the Dance-Off like a D-pad)
//   Num 1-8       hotbar slot 1-8 (Buddy: gun 1-8)   Num 9  next slot
//   Num 0         shoot / use / dig (RT)     Num .  aim / place / get in (LT)
//   Num Enter     jump, pick in menus (A)    Num +  pick up / vehicle (Y)
//   Num -         reload (X)                 Num *  Player 2's menu (Back)
//   Num /         sneak, back in menus (B)   Right Shift  run
//   End           drop the held item (D-pad down)
//
// Looking up and down happens by itself (CouchCoop._autoPitch): at the
// nearest zombie in front with a gun out, a little down at the ground with
// a block or tool, so digging and placing hit the block ahead.
import { setBlockedKeys } from './Keybinds.js'

// Key -> standard controller button.
const BUTTON_KEYS = {
  Numpad0: 7, // RT
  NumpadDecimal: 6, // LT
  NumpadEnter: 0, // A
  NumpadDivide: 1, // B
  NumpadSubtract: 2, // X
  NumpadAdd: 3, // Y
  NumpadMultiply: 8, // Back
  Numpad9: 5, // RB: next slot
  End: 13, // D-pad down: drop
}
const SLOT_KEYS = { Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad7: 6, Numpad8: 7 }
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
const DPAD = { ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15 }
// Every key Player 2 owns: Player 1's arrow / Right Shift fallbacks stop.
export const P2_KEYS = [...Object.keys(BUTTON_KEYS), ...Object.keys(SLOT_KEYS), ...ARROWS, 'ShiftRight']
const P2_SET = new Set(P2_KEYS)

export class CouchKeys {
  constructor(couch) {
    this.c = couch
    this.joined = false
    this.held = new Set()
    this._onDown = (e) => {
      if (!P2_SET.has(e.code)) return
      if (e.target?.closest?.('input, textarea, select')) return
      // Before joining only the number pad counts (Player 1 may walk on
      // the arrows until then).
      if (!this.joined && !e.code.startsWith('Numpad')) return
      // Player 2 already picked a controller: the keys stay Player 1's.
      if (!this.joined && this.c.padIndex >= 0) return
      e.preventDefault()
      if (e.repeat) return
      this.held.add(e.code)
      if (!this.joined) {
        this.joined = true
        setBlockedKeys(P2_KEYS)
        return
      }
      if (e.code in SLOT_KEYS) this.c.pickSlot(SLOT_KEYS[e.code])
    }
    this._onUp = (e) => {
      this.held.delete(e.code)
    }
    // Capture: before the game's own key handlers, which skip the keys
    // Player 2 owns once they've joined (Keybinds.setBlockedKeys).
    window.addEventListener('keydown', this._onDown, true)
    window.addEventListener('keyup', this._onUp, true)
    this._onBlur = () => this.held.clear()
    window.addEventListener('blur', this._onBlur)
  }

  // A Gamepad-shaped snapshot of the keys down right now.
  // dpad: the arrows press the D-pad (menu open, dancing) instead of moving.
  // steer: left/right is the left stick (driving) instead of turning.
  pad({ dpad = false, steer = false } = {}) {
    const k = this.held
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    for (const [code, i] of Object.entries(BUTTON_KEYS)) {
      if (k.has(code)) buttons[i] = { pressed: true, value: 1 }
    }
    const axes = [0, 0, 0, 0]
    const ud = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)
    const lr = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)
    if (dpad) {
      for (const [code, i] of Object.entries(DPAD)) if (k.has(code)) buttons[i] = { pressed: true, value: 1 }
    } else {
      axes[1] = ud
      if (steer) axes[0] = lr
      // Turning is a bit slower than a full stick so it's easy to line up.
      else axes[2] = lr * 0.75
    }
    return { connected: true, keyboard: true, index: -2, buttons, axes, run: k.has('ShiftRight') }
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown, true)
    window.removeEventListener('keyup', this._onUp, true)
    window.removeEventListener('blur', this._onBlur)
    setBlockedKeys([])
  }
}
