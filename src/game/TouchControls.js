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

    this._lookEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    this._bindLookZone()

    this._bindFireAndAim()
    this._bindInstantButtons()
    this._bindSprintAndCrouch()
  }

  // Matches the exact pattern this codebase's own "One-Handed Layout"
  // feature and gamepad support already use - window.dispatchEvent with a
  // synthetic KeyboardEvent, since PlayerController's real listener is
  // registered on window (not document).
  _dispatchKeyDown(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }))
  }

  _dispatchKeyUp(code) {
    window.dispatchEvent(new KeyboardEvent('keyup', { code }))
  }

  _dispatchKey(code) {
    this._dispatchKeyDown(code)
    this._dispatchKeyUp(code)
  }

  // Instant-tap button: fires once per touchstart, no separate up-state
  // needed (matches a quick real keypress).
  _bindTapButton(elementId, code) {
    const el = document.getElementById(elementId)
    el.addEventListener('touchstart', (e) => {
      e.preventDefault()
      this._dispatchKey(code)
    }, { passive: false })
  }

  _bindInstantButtons() {
    this._bindTapButton('touch-btn-jump', 'Space')
    this._bindTapButton('touch-btn-reload', getKeyFor('reload'))
    this._bindTapButton('touch-btn-interact', getKeyFor('interact'))
    this._bindTapButton('touch-btn-melee', 'Digit1')
    this._bindTapButton('touch-btn-weapon-1', 'Digit1')
    this._bindTapButton('touch-btn-weapon-2', 'Digit2')
    this._bindTapButton('touch-btn-weapon-3', 'Digit3')
    this._bindTapButton('touch-btn-weapon-4', 'Digit4')
  }

  // Sprint/Crouch need real keydown/keyup (not just an instant tap),
  // since PlayerController._onKey's existing toggle-vs-hold branch reads
  // isDown on each call - it must see a keydown then later a keyup,
  // exactly like a real held key, for both hold-mode and toggle-mode
  // (including double-tap-to-prone on crouch) to behave identically to
  // keyboard.
  _bindSprintAndCrouch() {
    this._bindHoldButton('touch-btn-sprint',
      () => this._dispatchKeyDown(getKeyFor('sprint')),
      () => this._dispatchKeyUp(getKeyFor('sprint')))

    this._bindHoldButton('touch-btn-crouch',
      () => this._dispatchKeyDown(getKeyFor('crouch')),
      () => this._dispatchKeyUp(getKeyFor('crouch')))
  }

  // Shared by Fire/Aim here and Sprint/Crouch in the next task - a button
  // that needs to know both "pressed" and "released" (as opposed to the
  // instant-tap buttons, which only need one event). Assigns the touch
  // its own role in the identifier map so a look-drag or the joystick
  // never steals it, and vice versa.
  _bindHoldButton(elementId, onDown, onUp) {
    const el = document.getElementById(elementId)
    let touchId = null
    el.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (touchId !== null) return
      const touch = e.changedTouches[0]
      touchId = touch.identifier
      this._activeTouches.set(touchId, elementId)
      onDown()
    }, { passive: false })
    const onEnd = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== touchId) continue
        this._activeTouches.delete(touchId)
        touchId = null
        onUp()
      }
    }
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
  }

  _bindFireAndAim() {
    this._bindHoldButton('touch-btn-fire',
      () => { this.game.weapons.triggerDown = true },
      () => { this.game.weapons.triggerDown = false })

    this._bindHoldButton('touch-btn-aim',
      () => {
        const w = this.game.weapons
        const wasAiming = w.aiming
        if (w.toggleAds) w.aiming = !w.aiming
        else w.aiming = true
        if (w.aiming && !wasAiming) w.aimStartedAt = performance.now()
      },
      () => {
        const w = this.game.weapons
        if (!w.toggleAds) w.aiming = false
      })
  }

  _bindLookZone() {
    const isLookTouch = (x, y) => {
      // Anything on the right side of the screen that isn't already
      // claimed by the joystick or a button - button touches are always
      // assigned their own role first in each button's own touchstart
      // handler, which runs before this document-level check ever sees
      // that identifier (target-phase listeners fire before the event
      // bubbles up to document), since those handlers claim the
      // identifier into _activeTouches synchronously before returning.
      return x >= window.innerWidth * 0.4
    }

    document.addEventListener('touchstart', (e) => {
      for (const touch of e.changedTouches) {
        if (this._activeTouches.has(touch.identifier)) continue
        if (!isLookTouch(touch.clientX, touch.clientY)) continue
        this._lookTouchId = touch.identifier
        this._activeTouches.set(touch.identifier, 'look')
        this._lookLast.x = touch.clientX
        this._lookLast.y = touch.clientY
      }
    }, { passive: true })

    document.addEventListener('touchmove', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this._lookTouchId) continue
        const dx = touch.clientX - this._lookLast.x
        let dy = touch.clientY - this._lookLast.y
        this._lookLast.x = touch.clientX
        this._lookLast.y = touch.clientY
        if (this.game.settings.invertY) dy = -dy
        const sens = TOUCH_LOOK_BASE_SENSITIVITY * (this.game.settings.sensitivity / 100)
        this._lookEuler.setFromQuaternion(this.game.camera.quaternion)
        this._lookEuler.y -= dx * sens
        this._lookEuler.x -= dy * sens
        this._lookEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this._lookEuler.x))
        this.game.camera.quaternion.setFromEuler(this._lookEuler)
      }
    }, { passive: true })

    const onEnd = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this._lookTouchId) continue
        this._activeTouches.delete(touch.identifier)
        this._lookTouchId = null
      }
    }
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
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
