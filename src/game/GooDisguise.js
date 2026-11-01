// The zombie-goo disguise (2026-10-31, Gaymi's idea list 2, picked
// "crafted, 30s, breaks on attack"). Crafted from Zombie Goo
// (PlayCrafting.js), used from the hotbar like a health pack. Owned by
// BuildSurvival (`survival.disguise`):
//
// - While it lasts, zombies don't count you as a target (_targets leaves
//   you out), so they wander past - on your own or as a server's host.
//   (On someone else's server the host's zombies still see you.)
// - Shooting or swinging (BuildSurvival.shoot) washes it off at once.
// - A green slimy edge round the screen with the seconds left.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export class GooDisguise {
  constructor(survival) {
    this.s = survival
    this.left = 0
    this._el = null
    this._shown = -1
  }

  get active() {
    return this.left > 0
  }

  // -> true if put on (not again while one is still on).
  put(seconds) {
    if (this.active) {
      this.s._message(t('gooAlreadyOn'))
      return false
    }
    this.left = seconds
    this.s._message(t('gooOn', { s: seconds }), 3)
    try { audioEngine.playFootstep?.(false, 'default') } catch { /* no audio */ }
    this._render()
    return true
  }

  // Attacked something: it's gone.
  break() {
    if (!this.active) return
    this.left = 0
    this.s._message(t('gooBroken'), 2.5)
    this._render()
  }

  update(dt) {
    if (!this.active) return
    this.left = Math.max(0, this.left - dt)
    if (this.left === 0) this.s._message(t('gooWoreOff'), 2.5)
    if (Math.ceil(this.left) !== this._shown) this._render()
  }

  clear() {
    this.left = 0
    this._render()
  }

  _render() {
    if (!this._el) {
      if (!this.active) return
      this._el = document.createElement('div')
      this._el.id = 'goo-vignette'
      this._el.innerHTML = '<span></span>'
      document.body.appendChild(this._el)
    }
    this._shown = Math.ceil(this.left)
    this._el.classList.toggle('on', this.active)
    this._el.firstChild.textContent = this.active ? t('gooHud', { s: this._shown }) : ''
  }
}
