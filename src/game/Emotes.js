// Emotes (2026-10-31, Gaymi's funny update: "dance, wave or a flex
// pose"). Press the Emote key (B, Settings > Controls) - or the smiley
// touch button on a phone - and a little bar shows the three; 1 / 2 / 3
// (or a click / tap) plays one for EMOTE_S seconds. Your own body shows
// it in third person (P), and on a server everyone sees it: the emote's
// id rides along with your position (PlayNet state `emote`).
//
// Owned by BuildSurvival (`s.emotes`). poseEmote() is shared by your own
// body (BuildTryMode._updateBody) and other players' (PlayNet._drawPlayer).
import { t } from './i18n.js'

export const EMOTES = ['dance', 'wave', 'flex']
export const EMOTE_S = 3.5
const BAR_S = 4 // the bar closes itself after this long

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
  // Flex: both arms up and out, a proud little bounce.
  lp.armR.rotation.x = -Math.PI * 0.5
  lp.armL.rotation.x = -Math.PI * 0.5
  lp.armR.rotation.z = 1.3 + Math.sin(time * 6) * 0.12
  lp.armL.rotation.z = -1.3 - Math.sin(time * 6) * 0.12
  return Math.abs(Math.sin(time * 3)) * 0.5
}

export class Emotes {
  constructor(survival) {
    this.s = survival
    this.current = '' // the emote playing now ('' = none)
    this._left = 0
    this._barLeft = 0
    this._bar = null
  }

  // The Emote key / touch button: opens or closes the bar.
  toggleBar() {
    if (!this.s.active || this.s.dead) return
    this._ensureBar()
    const open = this._bar.hidden
    this._bar.hidden = !open
    this._barLeft = open ? BAR_S : 0
  }

  // A number key while the bar is open picks that emote. -> true if it
  // was used (the hotbar leaves it alone).
  pick(code) {
    if (!this._bar || this._bar.hidden) return false
    const i = { Digit1: 0, Digit2: 1, Digit3: 2 }[code]
    if (i === undefined) return false
    this.play(EMOTES[i])
    return true
  }

  play(id) {
    if (!EMOTES.includes(id) || !this.s.active || this.s.dead) return
    this.current = id
    this._left = EMOTE_S
    if (this._bar) this._bar.hidden = true
  }

  // Moving, shooting or getting hurt stops it, like any game.
  stop() {
    this.current = ''
    this._left = 0
  }

  update(dt) {
    if (this.current && this.s.dead) this.stop()
    if (this._left > 0 && (this._left -= dt) <= 0) this.stop()
    if (this._bar && !this._bar.hidden && (this._barLeft -= dt) <= 0) this._bar.hidden = true
  }

  clear() {
    this.stop()
    if (this._bar) this._bar.hidden = true
  }

  _ensureBar() {
    if (this._bar) {
      this._label()
      return
    }
    const bar = document.createElement('div')
    bar.id = 'emote-bar'
    bar.hidden = true
    bar.innerHTML = EMOTES.map((id, i) => `<button type="button" data-emote="${id}"><kbd>${i + 1}</kbd><span></span></button>`).join('')
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-emote]')
      if (btn) this.play(btn.dataset.emote)
    })
    document.body.appendChild(bar)
    this._bar = bar
    this._label()
  }

  _label() {
    for (const btn of this._bar.querySelectorAll('[data-emote]')) {
      const id = btn.dataset.emote
      btn.querySelector('span').textContent = t(`emote${id.charAt(0).toUpperCase()}${id.slice(1)}`)
    }
  }
}
