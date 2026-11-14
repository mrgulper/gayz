// Settings > Controls, ideas 11-24 of the 80-idea list (2026-11-11; the
// rows are in MoreSettingsList.js). Everything a game frame needs:
// - Controller (Xbox / PlayStation, any "standard" browser gamepad):
//   left stick walks, right stick looks, the buttons press the same keys
//   the keyboard does (so rebinding and every key path keep working).
// - Rumble, stick deadzone, aim sensitivity, mouse smoothing, gyro aim,
//   hold-to-interact.
// Only imports Keybinds on purpose (BuildMode/BuildTryMode/BuildSurvival
// import this, and MoreSettings - which imports Game.js - calls in here).
import { getKeyFor } from './Keybinds.js'

const S = (bm) => bm?.game?.settings || {}
const PITCH_MAX = Math.PI / 2 - 0.01

function clampPitch(p) {
  return Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p))
}

// ---------- Look ----------

// Aim Sensitivity (16): look speed while aiming down the sights, on top of
// the usual slow-down. aimAmount is 0 (not aiming) .. 1 (fully aimed).
export function aimSensScale(bm, aimAmount) {
  const a = (Number(S(bm).aimSensitivity) || 100) / 100
  return 1 + (a - 1) * (aimAmount || 0)
}

// Mouse Smoothing (17): mouse movement goes into a queue that the camera
// eats a share of every frame, so jerky hands give a gliding view.
export function lookBy(bm, dYaw, dPitch) {
  if ((Number(S(bm).mouseSmoothing) || 0) <= 0) {
    bm._yaw += dYaw
    bm._pitch = clampPitch(bm._pitch + dPitch)
    return
  }
  const q = (bm._lookQueue ||= { yaw: 0, pitch: 0 })
  q.yaw += dYaw
  q.pitch += dPitch
}

// 1% smoothing eats ~40x the queue per second, 100% ~6x (heavy glide).
const SMOOTH_FAST = 40
const SMOOTH_SLOW = 6

function drainLook(bm, dt) {
  const q = bm._lookQueue
  if (!q || (!q.yaw && !q.pitch)) return
  const s = Number(S(bm).mouseSmoothing) || 0
  const k = s <= 0 ? 1 : 1 - Math.exp(-(SMOOTH_FAST - (SMOOTH_FAST - SMOOTH_SLOW) * (s / 100)) * dt)
  const y = q.yaw * k
  const p = q.pitch * k
  bm._yaw += y
  bm._pitch = clampPitch(bm._pitch + p)
  q.yaw -= y
  q.pitch -= p
  if (Math.abs(q.yaw) < 1e-5 && Math.abs(q.pitch) < 1e-5) q.yaw = q.pitch = 0
}

// ---------- Controller (11, 12, 13) ----------

// Standard gamepad button numbers -> the keyboard action they press.
// 0 A/Cross, 1 B/Circle, 2 X/Square, 3 Y/Triangle, 10 left stick click,
// 11 right stick click, 12-15 the D-pad (up, down, left, right).
const PAD_KEYS = { 0: 'jump', 1: 'crouch', 2: 'reload', 3: 'use', 11: 'cameraView', 12: 'cycleMap', 13: 'dropItem', 14: 'emote', 15: 'shop' }
const PAD_LB = 4
const PAD_RB = 5
const PAD_LT = 6
const PAD_RT = 7
const PAD_BACK = 8
const PAD_START = 9
const PAD_L3 = 10
const TRIGGER_AT = 0.4
// Right stick look speed at 100% sensitivity, radians per second.
const PAD_LOOK = 3.4

const pad = { index: -1, down: new Set(), run: false, wasActive: false }

// Couch Co-op (CouchCoop.js): Player 2's controller is theirs alone.
// 'waiting' = no controller for Player 1 until Player 2 has picked one;
// a number = Player 2's controller (Player 1 may use any other one).
let couchPad = null

export function setCouchPad(v) {
  couchPad = v
  pad.index = -1
}

function findPad() {
  if (couchPad === 'waiting') return null
  let list
  try { list = navigator.getGamepads?.() || [] } catch { return null }
  if (pad.index >= 0 && pad.index !== couchPad && list[pad.index]?.connected) return list[pad.index]
  for (const gp of list) {
    if (gp?.connected && gp.index !== couchPad) {
      pad.index = gp.index
      return gp
    }
  }
  pad.index = -1
  return null
}

// Stick Deadzone (13): a stick nearer the middle than this counts as
// let go; past it the amount starts again from 0, so there's no jump.
export function applyDeadzone(x, y, dz) {
  const m = Math.hypot(x, y)
  if (m <= dz || m === 0) return { x: 0, y: 0, m: 0 }
  const scaled = Math.min(1, (m - dz) / (1 - dz))
  return { x: (x / m) * scaled, y: (y / m) * scaled, m: scaled }
}

function pressed(gp, i) {
  const b = gp.buttons[i]
  if (!b) return false
  return i === PAD_LT || i === PAD_RT ? b.value > TRIGGER_AT || (b.pressed && b.value === 0) : b.pressed
}

const fakeKey = (code) => ({ code, repeat: false, target: null, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {} })

function keyDown(bm, action) {
  const code = getKeyFor(action)
  if (code) bm._onKeyDown?.(fakeKey(code))
}

function keyUp(bm, action) {
  const code = getKeyFor(action)
  if (code) bm._onKeyUp?.(fakeKey(code))
}

// Lets go of every button the controller is holding.
function releasePad(bm) {
  for (const i of pad.down) {
    if (PAD_KEYS[i]) keyUp(bm, PAD_KEYS[i])
    if (i === PAD_RT) bm._fireHeld = false
    if (i === PAD_LT) bm.tryMode?.setAim(false)
  }
  pad.down.clear()
  pad.run = false
  bm._padMove = null
}

function onPress(bm, i) {
  const play = bm.survival
  if (i === PAD_START) {
    bm.toggleMenu?.()
    return
  }
  if (i === PAD_BACK) {
    bm.togglePicker?.()
    return
  }
  if (bm.menuOpen || bm.pickerOpen) return
  if (PAD_KEYS[i]) keyDown(bm, PAD_KEYS[i])
  else if (i === PAD_RT) {
    if (play?.active && play.holding?.kind === 'block') play.placeHeldBlock()
    else {
      bm._fireHeld = true
      bm.tryMode.fire()
    }
  } else if (i === PAD_LT) {
    if (play?.active && (play.kart?.rightClick() || play.vehicles?.rightClick())) return
    if (play?.active && play.holding?.kind === 'block') play.placeHeldBlock()
    else bm.tryMode.setAim(true)
  } else if (i === PAD_LB || i === PAD_RB) {
    const dir = i === PAD_RB ? 1 : -1
    if (play?.active && play.inv) play.inv.select((((play.inv.active + dir) % 10) + 10) % 10)
    else bm._selectHotbarSlot?.((((bm.activeHotbarIndex + dir) % 10) + 10) % 10)
  } else if (i === PAD_L3) {
    // A click of the left stick runs until the stick is let go.
    pad.run = !pad.run
  }
}

function onRelease(bm, i) {
  if (PAD_KEYS[i]) keyUp(bm, PAD_KEYS[i])
  else if (i === PAD_RT) bm._fireHeld = false
  else if (i === PAD_LT) bm.tryMode.setAim(false)
}

function updatePad(bm, dt) {
  const set = S(bm)
  const gp = set.controllerSupport === false ? null : findPad()
  const playing = !!bm.tryMode?.active
  if (!gp || !playing) {
    if (pad.wasActive || pad.down.size) releasePad(bm)
    pad.wasActive = false
    return
  }
  pad.wasActive = true
  // Buttons: press on the way down, let go on the way up.
  const n = Math.min(gp.buttons.length, 16)
  for (let i = 0; i < n; i++) {
    const on = pressed(gp, i)
    if (on && !pad.down.has(i)) {
      pad.down.add(i)
      onPress(bm, i)
    } else if (!on && pad.down.has(i)) {
      pad.down.delete(i)
      onRelease(bm, i)
    }
  }
  if (bm.menuOpen || bm.pickerOpen) {
    bm._padMove = null
    return
  }
  const dzRaw = Number(set.stickDeadzone)
  const dz = Math.max(0, Math.min(0.9, (Number.isFinite(dzRaw) ? dzRaw : 15) / 100))
  // Left stick: walk (pushed up = forward).
  const mv = applyDeadzone(gp.axes[0] || 0, gp.axes[1] || 0, dz)
  if (mv.m > 0) bm._padMove = { x: mv.x, y: -mv.y, run: pad.run }
  else {
    bm._padMove = null
    pad.run = false
  }
  // Right stick: look, on a curve so small pushes aim finely.
  const lk = applyDeadzone(gp.axes[2] || 0, gp.axes[3] || 0, dz)
  if (lk.m > 0) {
    const curve = lk.m // direction (x, y) times m again: m * m overall
    const rate = PAD_LOOK * ((set.sensitivity ?? 100) / 100) * (bm.tryMode.aimLookScale?.() ?? 1) * dt
    bm._yaw -= lk.x * curve * rate
    bm._pitch = clampPitch(bm._pitch - lk.y * curve * rate * (set.invertY ? -1 : 1))
  }
}

// Controller Vibration (12): a short rumble (strength 0-1, ms long).
export function padRumble(bm, strength, ms) {
  if (!pad.wasActive || S(bm).controllerVibration === false) return
  const gp = findPad()
  const act = gp?.vibrationActuator
  if (!act?.playEffect) return
  try {
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength * 1.2) })?.catch?.(() => {})
  } catch { /* this controller can't rumble */ }
}

export function padConnected() {
  return !!findPad()
}

// ---------- Hold to Interact (22) ----------

// Use pressed: straight away, or after holding it the chosen time
// (a ring fills round the crosshair meanwhile).
export function startUse(bm) {
  const need = Number(S(bm).holdToInteract) || 0
  if (need <= 0) {
    bm._tryUseFromCamera()
    return
  }
  bm._useHold = { t: 0, need }
}

export function endUse(bm) {
  bm._useHold = null
  showRing(0)
}

let ringEl = null

function showRing(p) {
  if (!p) {
    if (ringEl) ringEl.style.display = 'none'
    return
  }
  if (!ringEl) {
    ringEl = document.createElement('div')
    ringEl.id = 'use-hold-ring'
    ringEl.setAttribute('aria-hidden', 'true')
    document.body.appendChild(ringEl)
  }
  ringEl.style.display = 'block'
  ringEl.style.setProperty('--p', `${Math.round(p * 100)}%`)
}

function updateUseHold(bm, dt) {
  const h = bm._useHold
  if (!h) return
  if (!bm.tryMode?.active || bm.menuOpen || bm.pickerOpen) {
    endUse(bm)
    return
  }
  h.t += dt
  if (h.t >= h.need) {
    endUse(bm)
    bm._tryUseFromCamera()
    return
  }
  showRing(h.t / h.need)
}

// ---------- Gyro Aim (20, phones) ----------

let gyro = null
let gyroListening = false
let gyroAsked = false

function onMotion(e) {
  const r = e.rotationRate
  if (r) gyro = { beta: r.beta || 0, gamma: r.gamma || 0, at: performance.now() }
}

// Starts listening to the phone's turning. iPhones ask first, and only
// from a tap - so this is also called on the first touch of a game.
export function ensureGyro(on) {
  if (!on) {
    if (gyroListening) window.removeEventListener('devicemotion', onMotion)
    gyroListening = false
    gyro = null
    return
  }
  if (gyroListening || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return
  const start = () => {
    if (gyroListening) return
    window.addEventListener('devicemotion', onMotion)
    gyroListening = true
  }
  const ask = window.DeviceMotionEvent.requestPermission
  if (typeof ask === 'function') {
    if (gyroAsked) return
    gyroAsked = true
    ask.call(window.DeviceMotionEvent).then((r) => {
      if (r === 'granted') start()
      else gyroAsked = false
    }).catch(() => { gyroAsked = false })
  } else start()
}

const DEG = Math.PI / 180
// Phone turning (degrees per second) -> look speed at 100% sensitivity.
const GYRO_SCALE = 1

// Turning the phone turns the view (BuildTouch.update, while playing).
export function gyroLook(bm, dt) {
  const set = S(bm)
  if (!set.gyroAim || !gyro || performance.now() - gyro.at > 400) return
  const angle = Number(screen.orientation?.angle ?? window.orientation ?? 0)
  let yaw
  let pitch
  // Which way the phone is held changes which of its axes is "up".
  if (angle === 90) { yaw = gyro.beta; pitch = -gyro.gamma }
  else if (angle === 270 || angle === -90) { yaw = -gyro.beta; pitch = gyro.gamma }
  else if (angle === 180) { yaw = -gyro.gamma; pitch = -gyro.beta }
  else { yaw = gyro.gamma; pitch = gyro.beta }
  const k = DEG * GYRO_SCALE * ((set.sensitivity ?? 100) / 100) * (bm.tryMode.aimLookScale?.() ?? 1) * dt
  bm._yaw += yaw * k
  bm._pitch = clampPitch(bm._pitch + pitch * k * (set.invertY ? -1 : 1))
}

// ---------- Every frame (BuildMode.update, before the camera turns) ----------

export function controlsTick(bm, dt) {
  try {
    updatePad(bm, dt)
  } catch { /* a strange controller never stops the game */ }
  drainLook(bm, dt)
  updateUseHold(bm, dt)
}
