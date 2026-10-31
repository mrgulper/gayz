// Blood Moon (2026-10-31, Gaymi's idea list: "a rare red night with double
// zombies and double rewards"). In a game from the homepage, each night
// from wave FROM_WAVE has a CHANCE of being a Blood Moon: the sky, the
// light and the moon go red (BuildSky.bloodMoon), a red edge creeps round
// the screen (body.play-blood-moon), and until sunrise every wave has
// twice the zombies, twice as many at once, coming twice as fast - and
// every coin counts double (BuildSurvival._earn).
//
// The roll is made once a night, when it's really dark (NIGHT_ON), alone
// or as a server's host; the others get it with the host's sky
// (BuildSky.skyState `b`) and see and earn the same. It ends once the
// night lifts (NIGHT_OFF). `start()` starts one now (tests).
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const CHANCE = 1 / 3
export const MULT = 2
export const FROM_WAVE = 2
const NIGHT_ON = 0.85
const NIGHT_OFF = 0.5

export class BloodMoon {
  constructor(survival) {
    this.s = survival
    this._rolled = false
    this._shown = false
  }

  get sky() {
    return this.s.bm.sky
  }

  // On now (also on a server, from the host's sky).
  get on() {
    return !!this.sky?.bloodMoon && !!this.s.fromMenu
  }

  // How many times over: zombies, spawn speed, coins.
  get mult() {
    return this.on ? MULT : 1
  }

  // A new run: nothing rolled yet tonight.
  reset() {
    this._rolled = false
    if (this.sky) this.sky.bloodMoon = false
    this._shown = false
    document.body.classList.remove('play-blood-moon')
  }

  // Every frame, alone or the host: the night's roll, and sunrise.
  update() {
    const s = this.s
    const sky = this.sky
    if (!sky || !s.fromMenu || s.cfg.noZombies || sky.time !== 'cycle') return
    const night = sky.nightAmount()
    if (sky.bloodMoon) {
      // Over once it's been dark and the night lifts (one started by day -
      // tests - lasts through the next night).
      if (night >= NIGHT_ON) this._dark = true
      else if (night < NIGHT_OFF && this._dark) sky.bloodMoon = false
    } else if (night < NIGHT_OFF) {
      this._rolled = false
    } else if (night >= NIGHT_ON && !this._rolled) {
      this._rolled = true
      if (s.wave >= FROM_WAVE && Math.random() < CHANCE) this.start()
    }
  }

  start() {
    const s = this.s
    if (!this.sky || this.sky.bloodMoon) return false
    this.sky.bloodMoon = true
    this._rolled = true
    this._dark = this.sky.nightAmount() >= NIGHT_ON
    // The wave already going gets its extra zombies too.
    if (s._toSpawn > 0) s._toSpawn *= MULT
    return true
  }

  // Every frame, everyone: the red screen edge and the "it's started /
  // it's over" message follow the sky.
  syncLook() {
    const on = this.on && this.s.active
    if (on === this._shown) return
    this._shown = on
    document.body.classList.toggle('play-blood-moon', on)
    if (!this.s.active) return
    this.s._message(t(on ? 'bloodMoonStart' : 'bloodMoonEnd'), on ? 6 : 4)
    try {
      if (on) audioEngine.playZombieScream?.(0)
      else audioEngine.playLevelUp?.()
    } catch { /* no audio */ }
  }
}
