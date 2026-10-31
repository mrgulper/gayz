// Death replay (2026-10-31, Gaymi's idea list: "a slow-motion look at your
// last 3 seconds, followed by one of your death jokes"). While you play
// alone, BuildSurvival.update hands every frame to record(): where you
// were and where each zombie was, SAMPLE_HZ times a second, the last SPAN
// seconds kept. When you die, start() plays them back at SLOW speed: the
// HUD goes (body.play-replay), the camera circles your body (yours from
// the third-person view, BuildTryMode._body) while the zombies walk back
// in, and the death joke comes up near the end. Then the You Died card.
// A click, a tap, Space, Enter or Escape skips it.
//
// Not on a server - the world there keeps going while you're dead, so
// there's nothing to rewind. The world is still while it plays (a dead
// player's game doesn't run alone), so the zombies are only moved for the
// drawing and put back after. Zombies that died in those seconds are gone
// and aren't shown.
import * as THREE from 'three'
import { poseZombieLimbs } from './FunnyZombies.js'
import { t } from './i18n.js'

export const SPAN = 3 // seconds kept
export const SLOW = 0.45 // playback speed
const SAMPLE_HZ = 20
const MIN_FRAMES = 6
const ORBIT_DIST = 4.5 // blocks
const ORBIT_RISE = 2.2
const ORBIT_TURN = 0.5 // radians per replay second
const JOKE_AT = 0.55 // how far through before the joke shows

export class DeathReplay {
  constructor(survival) {
    this.s = survival
    this.active = false
    this._frames = []
    this._acc = 0
    this._cam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), center: new THREE.Vector3() }
  }

  // A new life: nothing recorded.
  clear() {
    this._onDone = null
    if (this.active) this.stop()
    this._frames = []
    this._acc = 0
  }

  // Every frame while playing alone.
  record(dt) {
    this._acc += dt
    if (this._acc < 1 / SAMPLE_HZ && this._frames.length) return
    this._acc = 0
    const p = this.s.bm.tryMode.pos
    this._frames.push({
      me: [p.x, p.y, p.z],
      yaw: this.s.bm._yaw,
      zs: this.s.zombies.map((z) => [z, z.group.position.x, z.group.position.y, z.group.position.z, z.group.rotation.y]),
    })
    if (this._frames.length > SPAN * SAMPLE_HZ) this._frames.shift()
  }

  // Plays it, then onDone(). false (and nothing played) when there's too
  // little recorded.
  start(onDone, joke = '') {
    if (this.active || this._frames.length < MIN_FRAMES) return false
    this.active = true
    this._onDone = onDone
    this._t = 0
    this._len = (this._frames.length - 1) / SAMPLE_HZ
    // Where everything is now, to put it back after.
    this._kept = this.s.zombies.map((z) => [z, z.group.position.clone(), z.group.rotation.y])
    this._turn0 = this._frames[0].yaw + Math.PI * 0.75
    const tm = this.s.bm.tryMode
    if (!tm._body && tm._armSkin) tm._buildBody()
    this._showUi(true, joke)
    if (document.pointerLockElement) document.exitPointerLock()
    return true
  }

  // Each frame of the replay (BuildSurvival.update, before anything else).
  update(dt) {
    if (!this.active) return
    this._t += Math.min(dt, 0.1) * SLOW
    if (this._t >= this._len) {
      this.stop()
      return
    }
    const f = this._t * SAMPLE_HZ
    const a = this._frames[Math.floor(f)]
    const b = this._frames[Math.min(this._frames.length - 1, Math.floor(f) + 1)]
    const k = f - Math.floor(f)
    const lerp = (x, y) => x + (y - x) * k
    const B = this.s.B
    const alive = new Set(this.s.zombies)
    const next = new Map(b.zs.map((e) => [e[0], e]))
    for (const [z, x, y, zz, ry] of a.zs) {
      if (!alive.has(z)) continue
      const e = next.get(z) || [z, x, y, zz, ry]
      z.group.position.set(lerp(x, e[1]), lerp(y, e[2]), lerp(zz, e[3]))
      z.group.rotation.y = ry
      const lp = z.body?.limbPivots
      if (lp) poseZombieLimbs(lp, Math.sin(this._t * 9 + (z.id || 0)) * 0.6, z.shine === 'disco', this._t, z.id || 0)
    }
    // Me, seen from outside.
    const me = [0, 1, 2].map((i) => lerp(a.me[i], b.me[i]))
    const body = this.s.bm.tryMode._body
    if (body) {
      body.group.visible = true
      body.group.position.set(me[0] * B, me[1] * B, me[2] * B)
      body.group.rotation.y = a.yaw + Math.PI
      const lp = body.char.limbPivots
      const moved = Math.hypot(b.me[0] - a.me[0], b.me[2] - a.me[2]) * SAMPLE_HZ
      const swing = Math.sin(this._t * 14) * Math.min(1, moved / 2) * 0.7
      if (lp) {
        lp.legR.rotation.x = swing
        lp.legL.rotation.x = -swing
      }
    }
    this._cam.center.set(me[0] * B, (me[1] + 1.1) * B, me[2] * B)
    const joke = document.getElementById('play-replay-joke')
    if (joke && this._t / this._len > JOKE_AT) joke.classList.add('show')
  }

  // BuildMode.render: the camera circles me for this drawing only.
  applyView(cam) {
    if (!this.active) return null
    const B = this.s.B
    this._cam.pos.copy(cam.position)
    this._cam.quat.copy(cam.quaternion)
    const ang = this._turn0 + this._t * ORBIT_TURN / SLOW
    const c = this._cam.center
    cam.position.set(c.x + Math.sin(ang) * ORBIT_DIST * B, c.y + ORBIT_RISE * B, c.z + Math.cos(ang) * ORBIT_DIST * B)
    cam.lookAt(c)
    cam.updateMatrixWorld()
    return () => {
      cam.position.copy(this._cam.pos)
      cam.quaternion.copy(this._cam.quat)
      cam.updateMatrixWorld()
    }
  }

  // Ends it (played out or skipped): everything back where it is now.
  stop() {
    if (!this.active) return
    this.active = false
    for (const [z, pos, ry] of this._kept || []) {
      z.group.position.copy(pos)
      z.group.rotation.y = ry
    }
    this._kept = null
    const tm = this.s.bm.tryMode
    if (tm._body) tm._body.group.visible = !!tm.view
    this._frames = []
    this._showUi(false)
    const done = this._onDone
    this._onDone = null
    done?.()
  }

  _showUi(on, joke = '') {
    document.body.classList.toggle('play-replay', on)
    let ui = document.getElementById('play-replay-ui')
    if (on && !ui) {
      ui = document.createElement('div')
      ui.id = 'play-replay-ui'
      ui.innerHTML = `
        <p id="play-replay-tag"><span></span><b></b></p>
        <p id="play-replay-joke"></p>
        <button type="button" id="play-replay-skip"></button>`
      document.body.appendChild(ui)
      ui.addEventListener('pointerdown', (e) => e.stopPropagation())
      // Anywhere on the screen skips it.
      ui.addEventListener('click', (e) => {
        e.stopPropagation()
        this.stop()
      })
      this._onKey = (e) => {
        if (!this.active || !['Space', 'Enter', 'Escape'].includes(e.code)) return
        e.preventDefault()
        e.stopPropagation()
        this.stop()
      }
      window.addEventListener('keydown', this._onKey, true)
    }
    if (!ui) return
    ui.style.display = on ? '' : 'none'
    if (!on) return
    ui.querySelector('#play-replay-tag b').textContent = t('deathReplayTag')
    ui.querySelector('#play-replay-skip').textContent = t('deathReplaySkip')
    const jokeEl = ui.querySelector('#play-replay-joke')
    jokeEl.textContent = joke
    jokeEl.classList.remove('show')
  }
}
