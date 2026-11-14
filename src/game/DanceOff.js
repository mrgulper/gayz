// Dance-Off (2026-11-02, Gaymi's idea list 5: "a music game where you
// press arrows on the beat, and nearby zombies stop and copy your moves
// while you keep the rhythm" - Gaymi picked "both": a crafted boombox and
// a random disco ball).
//
// - Boombox: crafted, never used up. Hold it and use it: it goes down in
//   front of you and the music starts (then COOLDOWN_S before it plays
//   again).
// - Disco ball: a random world event (WorldEvents 'disco') - a glittering
//   ball hangs over a spot near you under a beam of light for DISCO_LIFE
//   seconds. Walk under it to start.
//
// The dance lasts DANCE_S seconds at BPM. Arrows rise up four lanes (left,
// down, up, right); press the arrow key (or W/A/S/D, or tap the lane on a
// phone) as each one reaches the line - within HIT_OK seconds counts,
// within HIT_PERFECT is Perfect. You can't walk while dancing. The Groove
// meter goes up with every hit and down with every miss; empty, the
// dance is over and the zombies wake up. Every zombie within DANCE_R
// blocks stops and copies your moves while you keep the rhythm (where the
// game runs: alone or a server's host). Dance to the end for DANCE_COINS
// coins plus PERFECT_COINS for each Perfect, and the zombies stay dazed
// for DAZE_S more seconds. Meshes only, never a light.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const DANCE_S = 30
export const BPM = 120
export const DANCE_R = 16
const HIT_OK = 0.16
const HIT_PERFECT = 0.07
const RISE_S = 1.6 // how long an arrow takes to rise to the line
export const DANCE_COINS = 20
const PERFECT_COINS = 1
export const DAZE_S = 5
export const COOLDOWN_S = 45
export const DISCO_LIFE = 90
const DISCO_REACH = 2.5
const GROOVE_HIT = 0.06
const GROOVE_MISS = 0.16
const LANES = ['left', 'down', 'up', 'right']
const KEYS = { ArrowLeft: 0, KeyA: 0, ArrowDown: 1, KeyS: 1, ArrowUp: 2, KeyW: 2, ArrowRight: 3, KeyD: 3 }
const GLYPH = ['◀', '▼', '▲', '▶']
// A little tune (Hz) over the beat, one note every half beat.
const TUNE = [392, 0, 494, 587, 0, 494, 440, 0, 392, 0, 330, 392, 0, 440, 494, 0]

export class DanceOff {
  constructor(survival) {
    this.s = survival
    this.on = false
    this._cool = 0
    this._mesh = null
    this._disco = null
    this._el = null
    // Couch Co-op's Player 2 dances with the D-pad (CouchHands -> press),
    // not the keyboard, with the arrows on their half (CouchToys.js).
    this.keys = true
    this.uiHost = null
  }

  get B() {
    return this.s.B
  }

  // The boombox (PlayInventory.useHeld). -> true if it started.
  useBoombox() {
    const s = this.s
    if (!s.active || s.dead || this.on) return false
    if (this._cool > 0) {
      s._message(t('danceCooldown', { n: Math.ceil(this._cool) }), 2)
      return false
    }
    const p = s.bm.tryMode.pos
    const yaw = s.bm._yaw
    const x = p.x - Math.sin(yaw) * 1.5
    const z = p.z - Math.cos(yaw) * 1.5
    this._placeBox(x, s._groundUnder(x, p.y + 2, z), z)
    this.start()
    return true
  }

  // The disco ball event (WorldEvents). -> a run, or null.
  disco(spot) {
    if (!spot || this._disco) return null
    const B = this.B
    const g = new THREE.Group()
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 * B, 1), new THREE.MeshLambertMaterial({ color: 0xdfe6f0, emissive: 0x8a6cff, emissiveIntensity: 0.5, flatShading: true }))
    ball.position.y = 5 * B
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.05 * B, 6 * B, 0.05 * B), new THREE.MeshLambertMaterial({ color: 0x888888 }))
    string.position.y = 8.6 * B
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6 * B, DISCO_REACH * B, 5 * B, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7ae0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }))
    beam.position.y = 2.5 * B
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(DISCO_REACH * B, DISCO_REACH * B, 0.05 * B, 24), new THREE.MeshBasicMaterial({ color: 0xff7ae0, transparent: true, opacity: 0.3, depthWrite: false }))
    floor.position.y = 0.03 * B
    g.add(ball, string, beam, floor)
    g.position.set(spot.x * B, spot.y * B, spot.z * B)
    this.s.bm.scene.add(g)
    this._disco = { ...spot, g, ball, beam, left: DISCO_LIFE }
    this.s._message(t('danceDiscoAppears'), 4)
    return {
      update: (dt) => this._updateDisco(dt),
      dispose: () => this._endDisco(),
    }
  }

  _updateDisco(dt) {
    const d = this._disco
    if (!d) return false
    d.left -= dt
    d.ball.rotation.y += dt * 1.5
    d.beam.material.color.setHSL((performance.now() / 2000) % 1, 0.9, 0.65)
    if (!this.on && !this.s.dead) {
      const me = this.s.bodyPos()
      if (Math.hypot(me.x - d.x, me.z - d.z) < DISCO_REACH && Math.abs(me.y - d.y) < 3) {
        this.start()
        d.left = Math.min(d.left, 0)
      }
    }
    return d.left > 0 || this.on
  }

  _endDisco() {
    const d = this._disco
    if (!d) return
    this._disco = null
    d.g.removeFromParent()
    disposeTree(d.g)
  }

  _placeBox(x, y, z) {
    this._removeBox()
    const B = this.B
    const g = new THREE.Group()
    const box = (w, h, d, color, px, py, pz, extra = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, ...extra }))
      m.position.set(px * B, py * B, pz * B)
      g.add(m)
      return m
    }
    box(1.0, 0.5, 0.35, 0x2b2b33, 0, 0.25, 0)
    box(0.7, 0.06, 0.06, 0x999999, 0, 0.6, 0)
    this._speakers = [box(0.28, 0.28, 0.04, 0x111111, -0.28, 0.25, 0.18), box(0.28, 0.28, 0.04, 0x111111, 0.28, 0.25, 0.18)]
    box(0.2, 0.1, 0.04, 0x62e0ff, 0, 0.3, 0.18, { emissive: 0x2a8aa8 })
    g.position.set(x * B, y * B, z * B)
    g.rotation.y = this.s.bm._yaw
    this.s.bm.scene.add(g)
    this._mesh = g
  }

  _removeBox() {
    if (!this._mesh) return
    this._mesh.removeFromParent()
    disposeTree(this._mesh)
    this._mesh = null
    this._speakers = null
  }

  // --- the dance ---

  start() {
    const s = this.s
    if (this.on) return
    this.on = true
    this.time = -RISE_S // the first arrow reaches the line after RISE_S
    this.groove = 0.6
    this.perfects = 0
    this.hits = 0
    this.combo = 0
    this.lastMove = -1
    this._beatAt = 0
    this._note = 0
    this.notes = this._chart()
    this._speedWas = s.bm.tryMode.speedMult ?? 1
    this._buildUi()
    this._onKey = (e) => {
      const lane = KEYS[e.code]
      if (lane === undefined || e.repeat) return
      e.preventDefault()
      e.stopPropagation()
      this.press(lane)
    }
    if (this.keys) window.addEventListener('keydown', this._onKey, true)
    s._message(t(this.keys ? 'danceStart' : 'couchDanceStart', { n: DANCE_S }), 3)
  }

  // Arrows on the beat (and now and then on the half beat), random lanes,
  // never the same lane three times running.
  _chart() {
    const beat = 60 / BPM
    const out = []
    let last = -1
    let twice = false
    for (let tm = beat * 2; tm < DANCE_S - 0.5; tm += beat) {
      const add = (at) => {
        let lane = Math.floor(Math.random() * 4)
        if (lane === last && twice) lane = (lane + 1 + Math.floor(Math.random() * 3)) % 4
        twice = lane === last
        last = lane
        out.push({ at, lane, done: false })
      }
      add(tm)
      if (tm > 8 && Math.random() < 0.25) add(tm + beat / 2)
    }
    return out
  }

  // An arrow pressed (keys, or a lane tapped on a phone).
  press(lane) {
    if (!this.on) return
    let best = null
    for (const n of this.notes) {
      if (n.done || n.lane !== lane) continue
      const off = Math.abs(n.at - this.time)
      if (off <= HIT_OK && (!best || off < Math.abs(best.at - this.time))) best = n
    }
    if (!best) return this._miss(lane)
    best.done = true
    const perfect = Math.abs(best.at - this.time) <= HIT_PERFECT
    this.hits++
    this.combo++
    if (perfect) this.perfects++
    this.groove = Math.min(1, this.groove + GROOVE_HIT)
    this.lastMove = lane
    this._moveT = 0
    this._flash(lane, perfect ? 'perfect' : 'good')
  }

  _miss(lane) {
    this.combo = 0
    this.groove -= GROOVE_MISS
    this._flash(lane, 'miss')
    if (this.groove <= 0) this.stop(false)
  }

  update(dt) {
    const s = this.s
    this._cool = Math.max(0, this._cool - dt)
    if (this._speakers) {
      const k = 1 + Math.max(0, Math.sin(performance.now() / 1000 * Math.PI * 2 * (BPM / 60))) * (this.on ? 0.25 : 0)
      for (const sp of this._speakers) sp.scale.set(k, k, 1)
    }
    if (!this.on) return
    if (s.dead || !s.active) return this.stop(false)
    this.time += dt
    s.bm.tryMode.speedMult = 0
    // The music: a drum every beat, the tune on the half beats.
    const half = 30 / BPM
    while (this.time >= this._beatAt) {
      if (this._note % 2 === 0) try { audioEngine.playSpecial?.('drum', audioEngine.musicGain || undefined) } catch { /* no audio */ }
      const hz = TUNE[this._note % TUNE.length]
      if (hz) try { audioEngine.playNote?.(hz) } catch { /* no audio */ }
      this._note++
      this._beatAt += half
    }
    // Arrows that slipped past the line are misses.
    for (const n of this.notes) {
      if (!n.done && this.time - n.at > HIT_OK) {
        n.done = true
        this._miss(n.lane)
        if (!this.on) return
      }
    }
    this._moveT = (this._moveT || 0) + dt
    this._zombies(dt)
    this._drawUi()
    if (this.time >= DANCE_S) this.stop(true)
  }

  // Zombies close by stop and copy your last move.
  _zombies() {
    const s = this.s
    if (s.net && !s.net.isHost) return
    const me = s.bodyPos()
    const k = Math.max(0, 1 - (this._moveT || 0) / 0.35)
    for (const zb of s.zombies) {
      if (zb.health <= 0 || Math.hypot(zb.x - me.x, zb.z - me.z) > DANCE_R) continue
      zb.frozen = Math.max(zb.frozen || 0, 0.3)
      zb.dancing = true
      this._pose(zb, this.lastMove, k)
    }
  }

  // A move on a zombie: lean left / right, a hop, a squat.
  _pose(zb, lane, k) {
    const g = zb.group
    if (!g) return
    g.rotation.z = lane === 0 ? 0.35 * k : lane === 3 ? -0.35 * k : 0
    g.scale.y = (zb.size || 1) * (lane === 1 ? 1 - 0.25 * k : 1)
    g.position.y = (zb.y + (lane === 2 ? 0.5 * Math.sin(k * Math.PI) : 0)) * this.B
  }

  _unpose() {
    for (const zb of this.s.zombies) {
      if (!zb.dancing) continue
      zb.dancing = false
      if (zb.group) {
        zb.group.rotation.z = 0
        zb.group.scale.y = zb.size || 1
      }
    }
  }

  stop(won) {
    if (!this.on) return
    const s = this.s
    this.on = false
    this._cool = COOLDOWN_S
    window.removeEventListener('keydown', this._onKey, true)
    s.bm.tryMode.speedMult = this._speedWas
    this._unpose()
    this._el?.remove()
    this._el = null
    this._removeBox()
    if (won) {
      const coins = DANCE_COINS + this.perfects * PERFECT_COINS
      s.coins = (s.coins || 0) + coins
      s._renderHud?.()
      if (!s.net || s.net.isHost) {
        const me = s.bodyPos()
        for (const zb of s.zombies) if (Math.hypot(zb.x - me.x, zb.z - me.z) <= DANCE_R) zb.frozen = Math.max(zb.frozen || 0, DAZE_S)
      }
      s._message(t('danceWon', { n: coins, p: this.perfects }), 4)
      try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
    } else {
      s._message(t('danceLost'), 3)
      try { audioEngine.playSpecial?.('warn') } catch { /* no audio */ }
    }
  }

  // --- the arrows on screen ---

  _buildUi() {
    const el = document.createElement('div')
    el.id = 'dance-off'
    el.innerHTML = `<div class="dance-groove"><i></i><span></span></div><div class="dance-lanes">${LANES.map((l, i) => `<button type="button" class="dance-lane" data-lane="${i}"><span class="dance-target">${GLYPH[i]}</span></button>`).join('')}</div>`
    el.querySelector('.dance-groove span').textContent = t('danceGroove')
    for (const b of el.querySelectorAll('.dance-lane')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        this.press(Number(b.dataset.lane))
      })
    }
    if (!this.keys) el.classList.add('p2')
    ;(this.uiHost?.() || document.body).appendChild(el)
    this._el = el
    this._lanes = [...el.querySelectorAll('.dance-lane')]
    this._arrows = new Map()
  }

  _drawUi() {
    const el = this._el
    if (!el) return
    el.querySelector('.dance-groove i').style.width = `${Math.round(this.groove * 100)}%`
    // Arrows on screen: from the bottom (RISE_S early) up to the line.
    for (const n of this.notes) {
      const left = n.at - this.time
      let a = this._arrows.get(n)
      if (n.done || left > RISE_S) {
        if (a) {
          a.remove()
          this._arrows.delete(n)
        }
        continue
      }
      if (!a) {
        a = document.createElement('span')
        a.className = 'dance-arrow'
        a.textContent = GLYPH[n.lane]
        this._lanes[n.lane].appendChild(a)
        this._arrows.set(n, a)
      }
      a.style.top = `${Math.max(0, left / RISE_S) * 100}%`
    }
  }

  _flash(lane, kind) {
    const b = this._lanes?.[lane]
    if (!b) return
    b.dataset.hit = kind
    clearTimeout(b._t)
    b._t = setTimeout(() => { delete b.dataset.hit }, 180)
  }

  clear() {
    if (this.on) this.stop(false)
    this._endDisco()
    this._removeBox()
    this._cool = 0
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
