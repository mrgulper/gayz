// A new player's first game (2026-10-31, Gaymi's "first 30 seconds" plan:
// "Play drops you straight into action: no pop-ups on a first visit, a
// zombie shows up quickly, and a tiny hint fades away on its own").
//
// The check-up found a first game took ~40 s before anything happened:
// the weapon picker covered the screen, you started deep inside the
// walled camp (zombies can't come in), and the first wave spawned far
// off and burned in the daytime sun before it got near you.
//
// So, only while career games played is 0 (a solo homepage game in a
// mode that starts at the camp): no weapon picker (the default gun), you
// start just outside the camp's gate facing out, one "starter" zombie
// walks up from STARTER_MIN-STARTER_MAX blocks in front within a couple
// of seconds, and the first wave doesn't burn in the sun. A hint with the
// controls shows for HINT_S seconds (sooner gone on your first kill).
// Owned by BuildSurvival (`s.onboard`).
import { t } from './i18n.js'
import { isTouchDevice } from './BuildTouch.js'

export const STARTER_MIN = 8
export const STARTER_MAX = 16
export const HINT_S = 7
// How far out of the gate you start (blocks).
const GATE_OUT = 3

// BuildSurvival's flow-field key (cellKey) back to a cell.
function cellOf(key) {
  const xz = Math.floor(key / 512)
  return [Math.floor(xz / 65536) - 32768, (key % 512) - 256, (xz % 65536) - 32768]
}

// A first game: nothing played to the end yet.
export function isFirstGame(game) {
  return !(Number(game?.careerStats?.totalRuns) > 0)
}

export class PlayOnboarding {
  constructor(survival) {
    this.s = survival
    this.active = false
    this._hintLeft = 0
    this._el = null
  }

  // From BuildSurvival.start, before the camera is handed to Try Map.
  // zone: the camp (Map3Generator safeZone). Returns true if it moved you.
  begin(zone) {
    this.active = true
    this.starter = null
    this._hintLeft = 0
    this._hintShown = false
    this._dir = null
    return !!zone && this._toGate(zone)
  }

  end() {
    this.active = false
    this.starter = null
    this._hideHint(true)
  }

  // Just outside the camp's one gate, facing away from it.
  _toGate(zone) {
    const s = this.s
    const { x0, x1, z0, z1, facade, cx, cz } = zone
    const dir = { zmin: [0, -1], zmax: [0, 1], xmin: [-1, 0], xmax: [1, 0] }[facade]
    if (!dir) return false
    const gx = facade === 'xmin' ? x0 : facade === 'xmax' ? x1 : cx
    const gz = facade === 'zmin' ? z0 : facade === 'zmax' ? z1 : cz
    for (let out = GATE_OUT; out <= GATE_OUT + 4; out++) {
      for (const side of [0, 1, -1, 2, -2]) {
        const x = gx + dir[0] * out + (dir[0] ? 0 : side)
        const z = gz + dir[1] * out + (dir[1] ? 0 : side)
        for (const y of [0, 1, -1, 2]) {
          if (!s._standable(x, y, z)) continue
          const B = s.B
          const bm = s.bm
          bm.camera.position.set((x + 0.5) * B, (y + 1.62) * B, (z + 0.5) * B)
          // The camera looks down -z at yaw 0.
          bm._yaw = Math.atan2(-dir[0], -dir[1])
          bm._pitch = 0
          this._dir = dir
          return true
        }
      }
    }
    return false
  }

  // Each frame from BuildSurvival.update.
  update(dt) {
    const s = this.s
    if (!this.active || s.dead) return
    if (s._picking || s._spawnPicking) return
    if (!this._hintShown) this._showHint()
    if (this._hintLeft > 0) {
      this._hintLeft -= dt
      if (this._hintLeft <= 0) this._hideHint()
    }
    // The first wave's zombies don't burn in the sun.
    if (s.wave <= 1) for (const zb of s.zombies) zb.noSun = true
    if (!this.starter && s.wave >= 1 && s._skin !== undefined && s._flow?.size) this._spawnStarter()
    // Once it's down the first game plays on as usual.
    if (this.starter && !s.zombies.includes(this.starter)) this.starter = false
  }

  // One zombie a short walk in front of you.
  _spawnStarter() {
    const s = this.s
    const p = s.bodyPos()
    const dir = this._dir || [-Math.sin(s.bm._yaw), -Math.cos(s.bm._yaw)]
    const ahead = []
    const near = []
    for (const [key, steps] of s._flow) {
      if (steps > STARTER_MAX + 6) continue
      const [x, y, z] = cellOf(key)
      const dx = x + 0.5 - p.x
      const dz = z + 0.5 - p.z
      const d = Math.hypot(dx, dz)
      if (d < STARTER_MIN || d > STARTER_MAX) continue
      if (s.camp?.inside(x + 0.5, z + 0.5, 1)) continue
      ;((dx * dir[0] + dz * dir[1]) / d > 0.5 ? ahead : near).push([x, y, z])
    }
    const spots = ahead.length ? ahead : near
    // No room close by: wait for the flow field to grow (or give up after
    // the first wave, when the game is going anyway).
    if (!spots.length) {
      if (s.wave > 1) this.starter = false
      return
    }
    const before = s.zombies.length
    if (!s._spawnZombie(spots) || s.zombies.length === before) return
    const zb = s.zombies[s.zombies.length - 1]
    // Not one of the wave's own (it doesn't hold the wave up).
    zb.extra = true
    zb.noSun = true
    this.starter = zb
  }

  _showHint() {
    this._hintShown = true
    let el = document.getElementById('play-first-hint')
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-first-hint'
      el.setAttribute('role', 'status')
      document.body.appendChild(el)
    }
    el.textContent = t(isTouchDevice() ? 'playFirstHintTouch' : 'playFirstHint')
    el.classList.remove('gone')
    el.style.display = 'block'
    this._el = el
    this._hintLeft = HINT_S
  }

  // You died: the hint goes with the HUD (the update stops while dead).
  onDeath() {
    this._hideHint(true)
  }

  // The first kill: the hint has done its job.
  onKill() {
    if (this._hintLeft > 0) this._hintLeft = Math.min(this._hintLeft, 1.2)
  }

  _hideHint(now = false) {
    this._hintLeft = 0
    const el = this._el || document.getElementById('play-first-hint')
    if (!el) return
    if (now) el.style.display = 'none'
    else el.classList.add('gone')
  }
}
