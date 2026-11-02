// Jetpack (2026-11-01, Gaymi's idea list 3: "a short burst of flying that
// runs on fuel"). Crafted (PlayCrafting) or, rarely, found in a loot chest.
// It works from anywhere in your bag - no need to hold it: jump, and keep
// Jump held once you're in the air (after START_S) to fly up (THRUST, up to
// MAX_UP). A full tank lasts JET_S seconds of flying; when it runs dry a
// Jetpack Fuel from your bag fills it again on its own. A pill shows the
// tank while it isn't full. Flames and a hiss while it burns.
// Each player's own. Owned by BuildSurvival (`s.jetpack`); BuildTryMode
// asks thrust() every frame it isn't swimming or climbing.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { showPill, hidePill } from './PlayPills.js'

export const JET_S = 8
const START_S = 0.18
const THRUST = 48 // blocks/s^2 (gravity is 30)
const MAX_UP = 7
const HISS_EVERY_S = 0.25

export class Jetpack {
  constructor(survival) {
    this.s = survival
    this.fuel = 1
    this._air = 0
    this._hissIn = 0
    this.flying = false
    this._warned = false
  }

  get worn() {
    return !!this.s.inv?.has('jetpack')
  }

  // The up speed this frame. held: Jump is held.
  thrust(dt, held, onGround, vy) {
    this.flying = false
    if (onGround || !this.worn) {
      this._air = 0
      this._warned = false
      return vy
    }
    this._air += dt
    if (!held || this._air < START_S || this.s.dead) return vy
    if (this.fuel <= 0) {
      if (this.s.inv.takeItem('jetFuel')) {
        this.fuel = 1
        this.s._message(t('jetpackRefuel'), 2)
      } else {
        if (!this._warned) this.s._message(t('jetpackEmpty'), 3)
        this._warned = true
        return vy
      }
    }
    this.flying = true
    this.fuel = Math.max(0, this.fuel - dt / JET_S)
    const s = this.s
    const p = s.bm.tryMode.pos
    const B = s.B
    for (let i = 0; i < 2; i++) {
      s._fx?.spark(p.x * B, (p.y + 0.4) * B, p.z * B, { life: 0.35, from: 0.2, to: 0.05, color: i ? 0xffd23f : 0xff6a1a, vel: new THREE.Vector3((Math.random() - 0.5) * B, -6 * B, (Math.random() - 0.5) * B) })
    }
    this._hissIn -= dt
    if (this._hissIn <= 0) {
      this._hissIn = HISS_EVERY_S
      try { audioEngine.playSpecial?.('jetpack') } catch { /* no audio */ }
    }
    return Math.min(MAX_UP, Math.max(vy, -2) + THRUST * dt)
  }

  update() {
    if (this.s.active && this.worn && (this.flying || this.fuel < 1)) showPill('jetpack', `${t('invJetpack')} ${Math.round(this.fuel * 100)}%`, this.fuel < 0.2)
    else hidePill('jetpack')
  }

  // A new game: a full tank.
  clear() {
    this.fuel = 1
    this._air = 0
    this.flying = false
    hidePill('jetpack')
  }
}
