// Tug of War (2026-11-09, Gaymi's idea list 10: "two teams mash a key, and
// the losing team gets pulled into a zombie pit"). A party mode, servers +
// bots. Plugs into PartyMode (PartyModes.js) as its `ext`.
//
// A long bridge in the sky (TUG_Y) with a zombie pit in the middle, Red on
// one side and Blue on the other, everyone holding the rope. Mash Jump or
// fire (a tap anywhere on a phone) to pull: each press adds to your pull,
// which fades away again (PULL_FADE a second) - so it's how fast you keep
// pressing that counts, and holding a key down does nothing. The team
// pulling harder (on average, so a smaller team isn't beaten just for
// being smaller) drags the rope its way, PULL_K blocks a second per point
// of difference. Get the rope WIN blocks your way and the other team is
// dragged into the pit - you win. When the clock runs out the rope's side
// wins (or a draw, dead in the middle). Each person counts at most
// MAX_TAPS presses a second.
//
// Whoever runs the round (alone, or the host) adds the pulls up; a guest's
// presses go to the host as hits ('u' + how many, PlayNet.queueHit) and the
// rope goes out in the host's sync (snap / apply). Real blocks for the
// bridge (BuildSurvival `_placed`); the rope and the pit's zombies are
// meshes. Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { getKeyFor } from './Keybinds.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const TUG_Y = 205
export const ROUND = 120
export const WIN = 5
export const PULL_K = 0.25
export const PULL_FADE = 1.5
export const MAX_TAPS = 15
export const FALL_S = 2.5
export const PIT = 2 // the pit is PIT x 2 + 1 blocks long
const GAP = PIT + 5 // the front person stands this far from the middle
const SPACING = 1.3
const HALF_W = 3
const LEN = 22
const SEND_EVERY = 0.2
const BOT_TAPS = [4, 8]

export class PartyTug {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.teams = true
    this.rope = 0
    this.pull = new Map() // id -> pull (only where it runs)
    this.fall = '' // the team going into the pit
    this.fallT = 0
    this._send = 0
    this._sendT = 0
    this._taps = [] // my last second of presses (performance.now())
    this._builtFor = ''
    this._onKey = (e) => {
      if (e.repeat || this.pm.phase !== 'play') return
      if (e.code === getKeyFor('jump') || e.code === 'Space') this.tap()
    }
    this._onPress = () => {
      if (this.pm.phase === 'play' && this.s.active) this.tap()
    }
    window.addEventListener('keydown', this._onKey)
    window.addEventListener('mousedown', this._onPress)
    window.addEventListener('touchstart', this._onPress, { passive: true })
  }

  home(me) {
    return { x: Math.round(me.x), y: TUG_Y + 1, z: Math.round(me.z) }
  }

  begin() {
    this.rope = 0
    this.pull.clear()
    this.fall = ''
    this.fallT = 0
    this._send = 0
  }

  // One press of mine.
  tap() {
    const pm = this.pm
    if (this.fall || !pm.myTeam) return
    const now = performance.now()
    this._taps = this._taps.filter((x) => now - x < 1000)
    if (this._taps.length >= MAX_TAPS) return
    this._taps.push(now)
    if (pm.runs) this._add(pm.myId, 1)
    else this._send++
    this._rope = 0.12
  }

  _add(id, n) {
    this.pull.set(id, (this.pull.get(id) || 0) + n)
  }

  // A guest's presses (`u` + how many) - at most what MAX_TAPS allows.
  remoteHit(h) {
    const n = Math.max(0, Math.min(Math.ceil(MAX_TAPS * SEND_EVERY) + 1, Math.floor(Number(String(h.id).slice(1)) || 0)))
    if (n && h.by) this._add(String(h.by), n)
  }

  // Everyone on a team, in the same order for everyone.
  members(tm) {
    return [...this.pm.teams].filter(([, v]) => v === tm).map(([id]) => id).sort()
  }

  // Where someone stands holding the rope (or falling into the pit).
  slot(id) {
    const pm = this.pm
    const h = pm.home
    const tm = pm.teams.get(id)
    if (!h || !tm) return null
    const list = this.members(tm)
    const k = Math.max(0, list.indexOf(id))
    const side = tm === 'r' ? -1 : 1
    let x = h.x + 0.5 + this.rope + side * (GAP + k * SPACING)
    let y = TUG_Y + 1
    if (this.fall === tm) {
      // Dragged over the edge and down into the pit.
      const f = Math.min(1, this.fallT / FALL_S)
      x += (h.x + 0.5 + side * (k % 2 ? 0.8 : -0.2) - x) * f
      y -= 4 * Math.min(1, f * 1.6)
    }
    return { x, y, z: h.z + 0.5 + (k % 2 ? 0.7 : -0.7) }
  }

  run(people, dt) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    if (this.fall) {
      this.fallT += dt
      if (this.fallT >= FALL_S) pm._end(this.fall === 'r' ? 'b' : 'r')
      return
    }
    // Bots press away.
    for (const p of people) {
      if (!p.bot) continue
      const b = p.bot
      if (!b.tugRate || Math.random() < dt * 0.3) b.tugRate = BOT_TAPS[0] + Math.random() * (BOT_TAPS[1] - BOT_TAPS[0])
      if (Math.random() < b.tugRate * dt) this._add(p.id, 1)
    }
    const fade = Math.exp(-PULL_FADE * dt)
    let r = 0
    let nr = 0
    let b = 0
    let nb = 0
    for (const p of people) {
      const tm = pm.teams.get(p.id)
      const v = this.pull.get(p.id) || 0
      if (tm === 'r') {
        r += v
        nr++
      } else if (tm === 'b') {
        b += v
        nb++
      }
      this.pull.set(p.id, v * fade)
    }
    const diff = (nb ? b / nb : 0) - (nr ? r / nr : 0)
    this.rope += diff * PULL_K * dt
    if (this.rope <= -WIN) this._drag('b')
    else if (this.rope >= WIN) this._drag('r')
  }

  _drag(tm) {
    this.rope = Math.max(-WIN, Math.min(WIN, this.rope))
    this.fall = tm
    this.fallT = 0
  }

  timeUp() {
    this.pm._end(this.rope < -0.5 ? 'r' : this.rope > 0.5 ? 'b' : 'tie')
  }

  placeBot(b) {
    const at = this.slot(b.id)
    if (!at) return
    b.x = b.tx = at.x
    b.z = b.tz = at.z
    b.y = b.ty = at.y
    b.vy = 0
  }

  moveBot(b) {
    if (this.pm.phase !== 'play') return false
    this.placeBot(b)
    return true
  }

  botGoal(b) {
    return { x: b.x, z: b.z, stay: true }
  }

  // Holding the rope: you don't walk.
  speed() {
    return this.pm.phase === 'play' ? 0 : 1
  }

  shoot() {
    return false
  }

  events(was) {
    const pm = this.pm
    const s = this.s
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      this._shownFall = ''
      this._taps = []
    }
    if (pm.phase === 'play' && this.fall && this._shownFall !== this.fall) {
      this._shownFall = this.fall
      const mine = this.fall === pm.myTeam
      s._message(t(mine ? 'tugYouFall' : 'tugTheyFall', { team: t(this.fall === 'r' ? 'partyRed' : 'partyBlue') }), 3)
      try { audioEngine.playSpecial?.(mine ? 'warn' : 'firework') } catch { /* no audio */ }
    }
  }

  draw(dt) {
    const pm = this.pm
    const s = this.s
    if (!pm.home) return
    this._blocks()
    // Hold my place on the rope.
    if (pm.phase === 'play' && pm.myTeam) {
      const at = this.slot(pm.myId)
      const tm = s.bm.tryMode
      if (at) {
        tm.pos.set(at.x, at.y, at.z)
        tm.vel?.set(0, 0, 0)
      }
    }
    // A guest sends their presses now and then.
    if (!pm.runs) {
      this._sendT -= dt
      if (this._sendT <= 0) {
        this._sendT = SEND_EVERY
        if (this._send > 0) {
          s.net?.queueHit(`u${Math.min(this._send, Math.ceil(MAX_TAPS * SEND_EVERY) + 1)}`, 0)
          this._send = 0
        }
      }
    }
    this._drawRope(dt)
  }

  // The bridge, the pit and its fences (real blocks, once per spot).
  _blocks() {
    const pm = this.pm
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor === key) return
    this._builtFor = key
    const s = this.s
    const bm = s.bm
    const h = pm.home
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z) === type) return
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      if (type) {
        bm.placeBlock(x, y, z, type, true)
        s._placed.set(bm._key(x, y, z), type)
      }
    }
    bm._suppressUndoRecording = true
    for (let x = -LEN; x <= LEN; x++) {
      for (let z = -HALF_W; z <= HALF_W; z++) {
        const inPit = Math.abs(x) <= PIT
        const edge = Math.abs(z) === HALF_W
        // The pit: walls down to a floor 5 below.
        if (inPit) {
          put(h.x + x, TUG_Y, h.z + z, edge ? 'cobblestone' : '')
          for (let d = 1; d <= 4; d++) put(h.x + x, TUG_Y - d, h.z + z, edge ? 'cobblestone' : '')
          put(h.x + x, TUG_Y - 5, h.z + z, 'smoothstone')
        } else {
          put(h.x + x, TUG_Y, h.z + z, x < 0 ? (edge ? 'redwool' : 'oakplanks') : edge ? 'bluewool' : 'oakplanks')
          if (edge || Math.abs(x) === LEN) put(h.x + x, TUG_Y + 1, h.z + z, 'oakfence')
        }
      }
      if (Math.abs(x) === PIT + 1) for (let d = 1; d <= 4; d++) for (let z = -HALF_W; z <= HALF_W; z++) put(h.x + x, TUG_Y - d, h.z + z, 'cobblestone')
    }
    bm._suppressUndoRecording = false
  }

  // Meshes: the rope, its middle ribbon and the pit's zombies.
  build() {
    const pm = this.pm
    const B = this.s.B
    const h = pm.home
    if (!h) return
    const rope = new THREE.Mesh(new THREE.BoxGeometry((LEN * 2 - 2) * B, 0.12 * B, 0.12 * B), new THREE.MeshLambertMaterial({ color: 0xc9a46a }))
    pm.arena.add(rope)
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.2 * B, 0.6 * B, 0.2 * B), new THREE.MeshLambertMaterial({ color: 0xffd23f }))
    pm.arena.add(ribbon)
    this._ropeMesh = rope
    this._ribbon = ribbon
    this._pit = []
    const green = new THREE.MeshLambertMaterial({ color: 0x4f8a3a })
    const shirt = new THREE.MeshLambertMaterial({ color: 0x5b4a7a })
    for (let i = 0; i < 4; i++) {
      const z = new THREE.Group()
      const part = (w, ht, d, mat, x, y) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, ht * B, d * B), mat)
        m.position.set(x * B, y * B, 0)
        z.add(m)
        return m
      }
      // 2 blocks tall, arms up and waving.
      part(0.5, 0.75, 0.25, shirt, 0, 0.375)
      part(0.5, 0.75, 0.25, shirt, 0, 1.125)
      part(0.5, 0.5, 0.5, green, 0, 1.75)
      const armL = part(0.22, 0.75, 0.22, green, -0.36, 1.7)
      const armR = part(0.22, 0.75, 0.22, green, 0.36, 1.7)
      z.position.set((h.x + 0.5 + (i - 1.5) * 1.1) * B, (TUG_Y - 4) * B, (h.z + 0.5 + (i % 2 ? 1 : -1)) * B)
      z.rotation.y = Math.random() * Math.PI * 2
      pm.arena.add(z)
      this._pit.push({ z, armL, armR, t: Math.random() * 6 })
    }
  }

  _drawRope(dt) {
    const pm = this.pm
    const B = this.s.B
    const h = pm.home
    if (!this._ropeMesh || !h) return
    this._rope = Math.max(0, (this._rope || 0) - dt)
    const y = TUG_Y + 1 + MOB_HEIGHT * 0.5 + (this._rope > 0 ? 0.05 : 0)
    this._ropeMesh.position.set((h.x + 0.5 + this.rope) * B, y * B, (h.z + 0.5) * B)
    this._ribbon.position.set((h.x + 0.5 + this.rope) * B, (y - 0.25) * B, (h.z + 0.5) * B)
    for (const p of this._pit || []) {
      p.t += dt * 4
      p.armL.rotation.x = Math.PI + Math.sin(p.t) * 0.4
      p.armR.rotation.x = Math.PI + Math.sin(p.t + 1.5) * 0.4
    }
  }

  startText() {
    const tm = this.pm.myTeam
    return t('tugStart', { team: tm ? t(tm === 'r' ? 'partyRed' : 'partyBlue') : '', key: t('tugKeys') })
  }

  // A little meter: where the rope's middle is between the two pits' edges.
  hud() {
    const n = 11
    const at = Math.round(((this.rope + WIN) / (WIN * 2)) * (n - 1))
    let bar = ''
    for (let i = 0; i < n; i++) bar += i === at ? '●' : '━'
    return `${t('partyRed')} ${bar} ${t('partyBlue')} · ${t('tugMash')}`
  }

  protects(x, y, z) {
    const h = this.pm.home
    if (!h || y < TUG_Y - 6 || y > TUG_Y + 3) return false
    return Math.abs(x - h.x) <= LEN + 1 && Math.abs(z - h.z) <= HALF_W + 1
  }

  snap() {
    return { ur: +this.rope.toFixed(2), uf: this.fall, ut: +this.fallT.toFixed(2) }
  }

  apply(d) {
    this.rope = Math.max(-WIN, Math.min(WIN, Number(d.ur) || 0))
    this.fall = d.uf === 'r' || d.uf === 'b' ? d.uf : ''
    this.fallT = Math.max(0, Number(d.ut) || 0)
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey)
    window.removeEventListener('mousedown', this._onPress)
    window.removeEventListener('touchstart', this._onPress)
  }
}
