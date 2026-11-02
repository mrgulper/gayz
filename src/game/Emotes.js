// Emotes (2026-10-31, Gaymi's funny update: "dance, wave or a flex
// pose"). Press the Emote key (Z, Settings > Controls) - or the smiley
// touch button on a phone - and a wheel of them opens round the middle of
// the screen (2026-11-01, Gaymi: "a circle where you can pick"); click /
// tap one, or press its number, and it plays for EMOTE_S seconds. The
// mouse is free while the wheel is up; Z or Escape closes it. Your own body shows
// it in third person (P), and on a server everyone sees it: the emote's
// id rides along with your position (PlayNet state `emote`).
//
// Owned by BuildSurvival (`s.emotes`). poseEmote() is shared by your own
// body (BuildTryMode._updateBody) and other players' (PlayNet._drawPlayer).
import { t } from './i18n.js'

export const EMOTES = ['dance', 'wave', 'flex', 'cheer', 'point', 'sit']
export const EMOTE_S = 3.5
const WHEEL_R = 96 // px from the wheel's middle to each button's

// Poses a blocky body (MenuAvatar3D limbPivots) for an emote at time t
// (seconds). -> how far the body bobs up (body units), or null when
// `emote` isn't one (the caller poses it as usual).
export function poseEmote(lp, emote, time) {
  if (!lp || !EMOTES.includes(emote)) return null
  for (const k of ['armR', 'armL', 'legR', 'legL']) lp[k].rotation.set(0, 0, 0)
  if (emote === 'dance') {
    const beat = time * 4.2
    const up = Math.sin(beat * 0.5) > 0
    lp.armR.rotation.x = up ? -Math.PI * 0.95 : -0.3
    lp.armL.rotation.x = up ? -0.3 : -Math.PI * 0.95
    lp.armR.rotation.z = up ? 0.35 : -0.5
    lp.armL.rotation.z = up ? 0.5 : -0.35
    const step = Math.sin(beat) * 0.35
    lp.legR.rotation.x = step
    lp.legL.rotation.x = -step
    return Math.abs(Math.sin(beat)) * 1.2
  }
  if (emote === 'wave') {
    lp.armR.rotation.x = -Math.PI * 0.85
    lp.armR.rotation.z = 0.35 + Math.sin(time * 10) * 0.45
    return 0
  }
  if (emote === 'cheer') {
    lp.armR.rotation.x = -Math.PI
    lp.armL.rotation.x = -Math.PI
    lp.armR.rotation.z = 0.25 + Math.sin(time * 12) * 0.15
    lp.armL.rotation.z = -0.25 - Math.sin(time * 12) * 0.15
    return Math.abs(Math.sin(time * 6)) * 1.5
  }
  if (emote === 'point') {
    lp.armR.rotation.x = -Math.PI / 2
    return 0
  }
  if (emote === 'sit') {
    // On the ground: the hips drop to the feet's level (poseSit).
    poseSit(lp)
    lp.armR.rotation.x = -0.35
    lp.armL.rotation.x = -0.35
    return -12
  }
  // Flex: both arms up and out, a proud little bounce.
  lp.armR.rotation.x = -Math.PI * 0.5
  lp.armL.rotation.x = -Math.PI * 0.5
  lp.armR.rotation.z = 1.3 + Math.sin(time * 6) * 0.12
  lp.armL.rotation.z = -1.3 - Math.sin(time * 6) * 0.12
  return Math.abs(Math.sin(time * 3)) * 0.5
}

// Sitting in a vehicle (2026-11-01, Gaymi: "you should be sitting not
// standing"): both legs straight out in front. `eye` is how far above
// your feet the seat view is (blocks) -> how far to move the body (world
// units) so the hips land on the seat. Shared by your own body and the
// other players' (PlayNet `sit`).
const HIP_TO_EYE = 1.06 // blocks, on the standard 2-block body
const STAND_HIP = 0.75
export function poseSit(lp) {
  if (!lp) return
  lp.legR.rotation.set(-Math.PI / 2, 0, 0.08)
  lp.legL.rotation.set(-Math.PI / 2, 0, -0.08)
}
export function sitDrop(eye, B) {
  return (eye - HIP_TO_EYE - STAND_HIP) * B
}

export class Emotes {
  constructor(survival) {
    this.s = survival
    this.current = '' // the emote playing now ('' = none)
    this._left = 0
    this._wheel = null
  }

  get open() {
    return !!this._wheel && !this._wheel.hidden
  }

  // The Emote key / touch button: opens or closes the wheel.
  toggleBar() {
    if (this.open) return this.close()
    if (!this.s.active || this.s.dead) return
    this._ensureWheel()
    this._wheel.hidden = false
    this._hover('')
    // The real mouse, to click one.
    this.s.bm._keys?.clear()
    if (document.pointerLockElement) document.exitPointerLock()
  }

  close(relock = true) {
    if (!this.open) return
    this._wheel.hidden = true
    if (relock && !this.s.dead && this.s.active) {
      try { this.s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  // A number key while the wheel is open picks that emote. -> true if it
  // was used (the hotbar leaves it alone).
  pick(code) {
    if (!this.open) return false
    const m = /^Digit([1-9])$/.exec(code)
    const id = m && EMOTES[Number(m[1]) - 1]
    if (!id) return false
    this.play(id)
    return true
  }

  play(id) {
    if (!EMOTES.includes(id) || !this.s.active || this.s.dead) return
    this.current = id
    this._left = EMOTE_S
    this.close()
  }

  // Moving, shooting or getting hurt stops it, like any game.
  stop() {
    this.current = ''
    this._left = 0
  }

  update(dt) {
    if (this.current && this.s.dead) this.stop()
    if (this._left > 0 && (this._left -= dt) <= 0) this.stop()
    if (this.open && (this.s.dead || !this.s.active)) this.close(false)
  }

  clear() {
    this.stop()
    this.close(false)
  }

  _ensureWheel() {
    if (this._wheel) {
      this._label()
      return
    }
    const wheel = document.createElement('div')
    wheel.id = 'emote-wheel'
    wheel.hidden = true
    // Evenly round the circle, the first one at the top.
    wheel.innerHTML = `<div class="emote-ring">${EMOTES.map((id, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2
      return `<button type="button" data-emote="${id}" style="left: calc(50% + ${Math.round(Math.sin(a) * WHEEL_R)}px); top: calc(50% - ${Math.round(Math.cos(a) * WHEEL_R)}px)"><kbd>${i + 1}</kbd><span></span></button>`
    }).join('')}<b class="emote-mid"></b></div>`
    wheel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-emote]')
      if (btn) this.play(btn.dataset.emote)
      // A click off the ring closes it.
      else if (!e.target.closest('.emote-ring')) this.close()
    })
    wheel.addEventListener('pointerover', (e) => this._hover(e.target.closest('[data-emote]')?.dataset.emote || ''))
    document.body.appendChild(wheel)
    this._wheel = wheel
    this._label()
  }

  _name(id) {
    return t(`emote${id.charAt(0).toUpperCase()}${id.slice(1)}`)
  }

  // The middle says which one you're pointing at.
  _hover(id) {
    const mid = this._wheel?.querySelector('.emote-mid')
    if (mid) mid.textContent = id ? this._name(id) : t('actionEmote')
  }

  _label() {
    for (const btn of this._wheel.querySelectorAll('[data-emote]')) btn.querySelector('span').textContent = this._name(btn.dataset.emote)
    this._hover('')
  }
}
