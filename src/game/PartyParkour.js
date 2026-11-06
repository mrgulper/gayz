// Obstacle Course (2026-11-02, Gaymi's idea list 6: "a parkour course in
// the sky with moving platforms, checkpoints and a best-time leaderboard" -
// it fills the Parkour tab, which said Coming Soon). Plugs into PartyMode
// (PartyModes.js) as its `ext`: alone, or on a Parkour server with others
// racing the same course (no bots).
//
// The course is high in the sky (PK_Y) and the same for everyone: stepping
// stones, steps up, a narrow beam, zigzag jumps, two moving platforms (one
// sliding along, one sideways; they move by the clock, so everyone sees
// them in the same place, and carry you while you stand on them) and a
// finish pad under a glowing arch. Touch a gold checkpoint pad to save your
// spot; fall off and you're back on the last one. Your time runs from the
// start of the round; the first to finish wins the round. Your best time
// is kept (BEST_KEY) and, signed in, goes on the leaderboard (`parkourMs`,
// OnlineUI), and the course shows the world's fastest.
//
// The course is real blocks (BuildSurvival `_placed`, gone when the game
// ends), put in on every screen. Meshes only, never a light.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const PK_Y = 260
export const BEST_KEY = 'gayz-parkour-best'
export const TOP_N = 5
const FALL = 6

// The course from its start (x along, y up, z across): [x, y, z, w, d,
// block] pads (w along x, d across z, from x / z - floor(d / 2)).
const PADS = [
  [0, 0, 0, 5, 5, 'smoothquartz'],
  [7, 0, 0, 1, 1, 'limeconcrete'], [10, 0, 1, 1, 1, 'limeconcrete'], [13, 0, -1, 1, 1, 'limeconcrete'],
  [16, 1, 0, 2, 2, 'lightblueconcrete'], [19, 2, 0, 2, 2, 'lightblueconcrete'], [22, 3, 0, 2, 2, 'lightblueconcrete'],
  [25, 3, 0, 3, 3, 'yellowconcrete'], // checkpoint 1
  [28, 3, 0, 10, 1, 'quartz'], // the beam
  [40, 3, 1, 1, 1, 'orangeconcrete'], [43, 4, -1, 1, 1, 'orangeconcrete'], [46, 4, 1, 1, 1, 'orangeconcrete'], [49, 5, 0, 1, 1, 'orangeconcrete'],
  [52, 5, 0, 3, 3, 'yellowconcrete'], // checkpoint 2
  [67, 5, 0, 3, 3, 'pinkconcrete'], // after the sliding platform
  [72, 6, 0, 2, 1, 'magentaconcrete'], [75, 7, 0, 2, 1, 'magentaconcrete'], [78, 8, 0, 2, 1, 'magentaconcrete'],
  [81, 8, 0, 3, 3, 'yellowconcrete'], // checkpoint 3
  [89, 8, 6, 3, 3, 'pinkconcrete'], // after the sideways platform
  [94, 8, 4, 1, 1, 'limeconcrete'], [97, 9, 2, 1, 1, 'limeconcrete'], [100, 9, 0, 1, 1, 'limeconcrete'],
  [103, 9, 0, 5, 5, 'yellowconcrete'], // the finish
]
// Checkpoints: where you come back (x, y, z of the pad's middle).
export const CHECKPOINTS = [[2, 0, 0], [26, 3, 0], [53, 5, 0], [82, 8, 0]]
const FINISH = { x: 103, y: 9, z: 0, w: 5, d: 5 }
// Moving platforms: 3 x 3, from -> to (x, y, z of their corner) and back
// every `period` seconds.
const MOVERS = [
  { from: [56, 5, -1], to: [63, 5, -1], period: 7 },
  { from: [85, 8, -1], to: [85, 8, 5], period: 6 },
]
const MOVER = 'purpurblock'

export function loadParkourBest() {
  try {
    const v = Number(localStorage.getItem(BEST_KEY))
    return Number.isFinite(v) && v >= 1000 && v < 36000000 ? Math.round(v) : null
  } catch {
    return null
  }
}

export function parkourTime(ms) {
  const s = ms / 1000
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

export class PartyParkour {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.cp = 0
    this.t0 = 0
    this.done = 0
    this.best = loadParkourBest()
    this.top = null
    this._builtFor = ''
    this._movers = MOVERS.map(() => null)
    this._loadTop()
  }

  get B() {
    return this.s.B
  }

  // No bots: a race against the clock (and anyone else on the server).
  get total() {
    return 0
  }

  home(me) {
    return { x: Math.round(me.x), y: PK_Y + 1, z: Math.round(me.z) }
  }

  // Course (x, y, z) -> world.
  _at(x, y, z) {
    return { x: Math.floor(this.pm.home.x) + x, y: PK_Y + y, z: Math.floor(this.pm.home.z) + z }
  }

  run() {}

  timeUp() {
    this.pm._end('tie')
  }

  // A guest finished (their time, from their own screen).
  remoteHit(h) {
    if (/^f\d{4,8}$/.test(String(h.id)) && this.pm.phase === 'play') this.pm._end(String(h.by))
  }

  shoot() {
    return false
  }

  protects(x, y, z) {
    const pm = this.pm
    if (!pm.home || y < PK_Y - 2 || y > PK_Y + 16) return false
    const dx = x - Math.floor(pm.home.x)
    const dz = z - Math.floor(pm.home.z)
    return dx >= -4 && dx <= 112 && dz >= -6 && dz <= 9
  }

  // --- every screen ---

  _put(x, y, z, type) {
    const s = this.s
    const bm = s.bm
    if (bm.getBlockAt(x, y, z) === type) return
    if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
    bm.placeBlock(x, y, z, type, true)
    s._placed.set(bm._key(x, y, z), type)
  }

  _take(x, y, z) {
    const s = this.s
    const bm = s.bm
    if (!bm.getBlockAt(x, y, z)) return
    bm.removeBlock(x, y, z)
    s._placed.delete(bm._key(x, y, z))
  }

  _pad(x, y, z, w, d, type) {
    const c = this._at(x, y, z)
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) this._put(c.x + i, c.y, c.z + j - Math.floor(d / 2), type)
  }

  _blocks() {
    const bm = this.s.bm
    bm._suppressUndoRecording = true
    for (const [x, y, z, w, d, type] of PADS) this._pad(x, y, z, w, d, type)
    // The finish arch.
    const f = FINISH
    for (const dz of [-2, 2]) for (let y = 1; y <= 4; y++) this._pad(f.x + 2, f.y + y, f.z + dz, 1, 1, 'glowstone')
    for (let dz = -2; dz <= 2; dz++) this._pad(f.x + 2, f.y + 5, f.z + dz, 1, 1, 'glowstone')
    bm._suppressUndoRecording = false
    this._movers = MOVERS.map(() => null)
  }

  // Where a moving platform's corner is now (whole blocks, by the clock).
  moverAt(i, now = Date.now()) {
    const m = MOVERS[i]
    const k = ((now / 1000) % m.period) / m.period
    const f = k < 0.5 ? k * 2 : 2 - k * 2
    return m.from.map((a, j) => Math.round(a + (m.to[j] - a) * f))
  }

  _moveMovers() {
    const s = this.s
    const bm = s.bm
    const tm = bm.tryMode
    bm._suppressUndoRecording = true
    MOVERS.forEach((_, i) => {
      const at = this.moverAt(i)
      const was = this._movers[i]
      if (was && was.every((v, j) => v === at[j])) return
      // Standing on it: carried along.
      if (was && tm?.active) {
        const c = this._at(...was)
        const p = tm.pos
        if (p.x >= c.x && p.x < c.x + 3 && p.z >= c.z && p.z < c.z + 3 && Math.abs(p.y - (c.y + 1)) < 0.3) {
          p.x += at[0] - was[0]
          p.z += at[2] - was[2]
        }
      }
      if (was) {
        const c = this._at(...was)
        for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) this._take(c.x + x, c.y, c.z + z)
      }
      const c = this._at(...at)
      for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) this._put(c.x + x, c.y, c.z + z, MOVER)
      this._movers[i] = at
    })
    bm._suppressUndoRecording = false
  }

  draw() {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor !== key) {
      this._builtFor = key
      this._blocks()
    }
    this._moveMovers()
    this._mine()
  }

  // Me: checkpoints, falling back to one, the finish.
  _mine() {
    const pm = this.pm
    const s = this.s
    const tm = s.bm.tryMode
    if (pm.phase !== 'play' || !tm?.active) return
    const p = tm.pos
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    CHECKPOINTS.forEach(([x, y, z], i) => {
      if (i <= this.cp) return
      if (Math.abs(p.x - (hx + x + 0.5)) < 2 && Math.abs(p.z - (hz + z + 0.5)) < 2 && Math.abs(p.y - (PK_Y + y + 1)) < 0.6) {
        this.cp = i
        s._message(t('parkourCheckpoint', { n: i, max: CHECKPOINTS.length - 1 }), 2)
        try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
      }
    })
    if (p.y < PK_Y - FALL) this._toCheckpoint()
    const f = FINISH
    if (!this.done && p.x >= hx + f.x && p.x < hx + f.x + f.w && Math.abs(p.z - (hz + f.z + 0.5)) < f.d / 2 + 0.5 && Math.abs(p.y - (PK_Y + f.y + 1)) < 0.6) this._finish()
  }

  _toCheckpoint() {
    const [x, y, z] = CHECKPOINTS[this.cp]
    const c = this._at(x, y, z)
    const s = this.s
    const tm = s.bm.tryMode
    tm.pos.set(c.x + 0.5, c.y + 1, c.z + 0.5)
    tm.vel?.set(0, 0, 0)
    s.bm.camera.position.set((c.x + 0.5) * this.B, (c.y + 1 + 1.62) * this.B, (c.z + 0.5) * this.B)
    s.bm._yaw = -Math.PI / 2
  }

  _finish() {
    const pm = this.pm
    const s = this.s
    const ms = Math.max(1000, Math.round(performance.now() - this.t0))
    this.done = ms
    const better = !this.best || ms < this.best
    if (better) {
      this.best = ms
      try { localStorage.setItem(BEST_KEY, String(ms)) } catch { /* storage full */ }
    }
    s._message(t(better ? 'parkourNewBest' : 'parkourFinished', { t: parkourTime(ms), b: parkourTime(this.best) }), 6)
    try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
    s._fx?.confetti?.(s.bodyPos().x * this.B, (PK_Y + 12) * this.B, s.bodyPos().z * this.B)
    if (pm.runs) pm._end(pm.myId)
    else s.net?.queueHit(`f${ms}`, 0)
  }

  events(was) {
    const pm = this.pm
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      this.cp = 0
      this.done = 0
      this.t0 = performance.now()
      this._toCheckpoint()
    }
  }

  // The world's fastest (signed in or not, it's public).
  async _loadTop() {
    try {
      const CloudSync = await import('./CloudSync.js')
      this.top = await CloudSync.fetchTopParkour(TOP_N)
    } catch {
      this.top = null
    }
  }

  startText() {
    return t('parkourStart', { n: CHECKPOINTS.length - 1 })
  }

  hud() {
    const pm = this.pm
    const now = pm.phase === 'play' ? (this.done || performance.now() - this.t0) : 0
    let out = t('parkourHud', { t: parkourTime(now), c: this.cp, max: CHECKPOINTS.length - 1 })
    if (this.best) out += ` · ${t('parkourBest', { t: parkourTime(this.best) })}`
    if (this.top?.length) out += ` · ${t('speedrunWorldTop')} ${this.top.slice(0, 3).map((e, i) => `${i + 1}. ${String(e.name || '?').slice(0, 14)} ${parkourTime(e.parkourMs)}`).join(', ')}`
    return out
  }

  dispose() {}
}
