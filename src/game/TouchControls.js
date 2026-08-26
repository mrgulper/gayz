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

    this._joystickBase = document.getElementById('touch-joystick-base')
    this._joystickKnobEl = document.getElementById('touch-joystick-knob')
    this._bindJoystick()
  }

  _bindJoystick() {
    const base = this._joystickBase
    const maxRadius = 40 // px the knob can travel from center before clamping

    const rect = () => base.getBoundingClientRect()

    const isInActivationZone = (x, y) => {
      // Generous activation zone (spec: "roughly the whole bottom-left
      // quarter of the screen"), not just the visible ~110px circle -
      // real thumbs don't land pixel-precise.
      return x < window.innerWidth * 0.4 && y > window.innerHeight * 0.5
    }

    const setInput = (dx, dy, mag) => {
      const input = this.game.player.input
      if (mag < JOYSTICK_DEADZONE * maxRadius) {
        input.forward = input.back = input.left = input.right = false
        return
      }
      input.forward = dy < -maxRadius * 0.2
      input.back = dy > maxRadius * 0.2
      input.left = dx < -maxRadius * 0.2
      input.right = dx > maxRadius * 0.2
    }

    const reset = () => {
      this._joystickTouchId = null
      this._joystickKnob.x = 0
      this._joystickKnob.y = 0
      this._joystickKnobEl.style.transform = 'translate(0, 0)'
      const input = this.game.player.input
      input.forward = input.back = input.left = input.right = false
    }

    document.addEventListener('touchstart', (e) => {
      if (this._joystickTouchId !== null) return
      for (const touch of e.changedTouches) {
        if (this._activeTouches.has(touch.identifier)) continue
        if (!isInActivationZone(touch.clientX, touch.clientY)) continue
        this._joystickTouchId = touch.identifier
        this._activeTouches.set(touch.identifier, 'joystick')
        const r = rect()
        this._joystickOrigin.x = r.left + r.width / 2
        this._joystickOrigin.y = r.top + r.height / 2
        break
      }
    }, { passive: true })

    document.addEventListener('touchmove', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this._joystickTouchId) continue
        let dx = touch.clientX - this._joystickOrigin.x
        let dy = touch.clientY - this._joystickOrigin.y
        const mag = Math.hypot(dx, dy)
        if (mag > maxRadius) {
          dx = (dx / mag) * maxRadius
          dy = (dy / mag) * maxRadius
        }
        this._joystickKnob.x = dx
        this._joystickKnob.y = dy
        this._joystickKnobEl.style.transform = `translate(${dx}px, ${dy}px)`
        setInput(dx, dy, Math.hypot(dx, dy))
      }
    }, { passive: true })

    const onEnd = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this._joystickTouchId) continue
        this._activeTouches.delete(touch.identifier)
        reset()
      }
    }
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
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
