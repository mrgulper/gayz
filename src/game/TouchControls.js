// Fourth input source alongside keyboard+mouse and gamepad (see Game.js's
// _updateGamepad for the pattern this mirrors). Every control here writes
// into the exact same fields those two already write into, or dispatches
// the same synthetic KeyboardEvents the existing "One-Handed Layout"
// feature already dispatches - see docs/superpowers/specs/
// 2026-08-26-touch-controls-design.md for the full design.
import * as THREE from 'three'
import { getKeyFor, ACTIONS } from './Keybinds.js'
import { t } from './i18n.js'

// Movement joystick deadzone, as a fraction of the joystick's max travel
// radius - matches the spirit of GAMEPAD_DEADZONE in Game.js (a stick
// nudge this small doesn't count as a real directional input).
const JOYSTICK_DEADZONE = 0.2

// Look-drag base sensitivity (touch pixels of drag -> radians of camera
// rotation, before the Settings sensitivity slider's multiplier is
// applied). Tuned independently from mouse/gamepad since raw touch pixel
// deltas behave differently from either.
const TOUCH_LOOK_BASE_SENSITIVITY = 0.0028

export class TouchControls {
  constructor(game) {
    this.game = game
    // Touch-identifier -> role map. A role is one of: 'joystick', 'look',
    // or a button id string (e.g. 'touch-btn-fire'). Populated on
    // touchstart, read on touchmove, deleted on touchend/touchcancel.
    this._activeTouches = new Map()
    this._joystickTouchId = null
    this._joystickOrigin = { x: 0, y: 0 }
    this._joystickKnob = { x: 0, y: 0 }
    this._lookTouchId = null
    this._lookLast = { x: 0, y: 0 }
  }

  // Called once per frame from Game.js's main tick loop, same spot
  // _updateGamepad(dt) is already called from.
  update(dt) {
    // Per-frame continuous work goes here in later tasks. Left empty in
    // this task - the skeleton just needs to exist and be called safely
    // every frame with no functional behavior yet.
  }

  dispose() {
    this._activeTouches.clear()
  }
}
