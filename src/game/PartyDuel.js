// Duel Arena (2026-11-02, Gaymi's idea list 6: "1v1 player battles on
// servers with rankings, separate from your zombie runs"). Plugs into
// PartyMode (PartyModes.js) as its `ext`. On the Deathmatch tab; alone
// you duel a bot, on a Duel server (Global > Deathmatch) two players fight
// and everyone else watches from the stand - the winner stays on and the
// next in line steps in.
//
// A walled stone arena high in the sky (DUEL_Y) with cover in the middle.
// Each fighter has DUEL_HP health of their own (your real health and
// gear aren't touched); a hit takes the gun's damage times DMG_SHARE
// (DMG_MIN..DMG_MAX). Down to 0 and you lose; if time runs out, whoever has
// more health left wins. Every duel you fight moves your rating (RATING_START
// to begin with: +WIN_PTS for a win, -LOSS_PTS for a loss, never below 0),
// kept on this device (RATING_KEY) and, signed in, on the leaderboard
// (`duelRating`, `duelWins`, OnlineUI) - the top of the screen shows the
// world's best.
//
// The arena is real blocks (BuildSurvival `_placed`, gone when the game
// ends), put in on every screen. The host keeps everyone's duel health.
// Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const DUEL_Y = 170
export const DUEL_HP = 100
export const DMG_SHARE = 0.35
export const DMG_MIN = 5
export const DMG_MAX = 30
export const RATING_KEY = 'gayz-duel'
export const RATING_START = 1000
export const WIN_PTS = 20
export const LOSS_PTS = 15
export const TOP_N = 5
const HALF = 9
const H = 4
const BOT_SHOT = [0.9, 1.6]
const BOT_AIM = 0.5 // how often a bot's shot hits
const BOT_DMG = 9
const COLORS = [0xe8443a, 0x3a7be8]

// { rating, wins, losses }, never trusted when read back.
export function loadDuel() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(RATING_KEY) || 'null')
  } catch {
    d = null
  }
  const n = (v, def) => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : def)
  return { rating: n(d?.rating, RATING_START), wins: n(d?.wins, 0), losses: n(d?.losses, 0) }
}

function saveDuel(d) {
  try {
    localStorage.setItem(RATING_KEY, JSON.stringify(d))
  } catch {
    // Full storage: it's just not remembered.
  }
}

export class PartyDuel {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.hp = new Map()
    this.fighters = []
    this.me = loadDuel()
    this.top = null
    this._builtFor = ''
    this._loadTop()
  }

  get B() {
    return this.s.B
  }

  // Two in the arena (a bot if you're alone).
  get total() {
    return 2
  }

  home(me) {
    return { x: Math.round(me.x), y: DUEL_Y + 1, z: Math.round(me.z) }
  }

  // Fighter i's end of the arena; the stand (watchers) off to one side.
  spotOf(i) {
    const h = this.pm.home
    return { x: h.x + (i ? 1 : -1) * (HALF - 2), z: h.z }
  }

  stand() {
    const h = this.pm.home
    return { x: h.x, y: DUEL_Y + H + 1, z: h.z + HALF + 3 }
  }

  begin(people) {
    // Players before bots; last round's winner stays on.
    const real = people.filter((p) => !p.bot).map((p) => p.id)
    const bots = people.filter((p) => p.bot).map((p) => p.id)
    const keep = this._lastWinner && real.includes(this._lastWinner) ? [this._lastWinner] : []
    const queue = [...keep, ...real.filter((id) => !keep.includes(id)), ...bots]
    this.fighters = queue.slice(0, 2)
    this.hp = new Map(this.fighters.map((id) => [id, DUEL_HP]))
  }

  placeBot(b) {
    const i = this.fighters.indexOf(b.id)
    const at = i >= 0 ? this.spotOf(i) : this.stand()
    b.x = b.tx = at.x
    b.z = b.tz = at.z
    b.y = b.ty = i >= 0 ? DUEL_Y + 1 : DUEL_Y + H + 2
    b.vy = 0
    b.shotIn = BOT_SHOT[1]
  }

  _other(id) {
    return this.fighters.find((f) => f !== id) || ''
  }

  // A hit on `id` by `by` (where it runs).
  _hit(id, amount, by) {
    const pm = this.pm
    if (pm.phase !== 'play' || !this.hp.has(id) || !this.hp.has(by) || id === by) return
    this.hp.set(id, Math.max(0, this.hp.get(id) - amount))
    if (this.hp.get(id) <= 0) pm._end(by)
  }

  run(people, dt) {
    const pm = this.pm
    // A fighter who left loses.
    for (const id of this.fighters) if (!people.some((p) => p.id === id)) return pm._end(this._other(id) || 'tie')
    // Bot fighters shoot back.
    for (const p of people) {
      const b = p.bot
      if (!b || !this.hp.has(b.id)) continue
      b.shotIn -= dt
      if (b.shotIn > 0) continue
      b.shotIn = BOT_SHOT[0] + Math.random() * (BOT_SHOT[1] - BOT_SHOT[0])
      const foe = this._other(b.id)
      if (foe && Math.random() < BOT_AIM) this._hit(foe, BOT_DMG, b.id)
      try { audioEngine.playSpecial?.('turret') } catch { /* no audio */ }
    }
  }

  timeUp() {
    const [a, b] = this.fighters
    const ha = this.hp.get(a) ?? 0
    const hb = this.hp.get(b) ?? 0
    this.pm._end(ha === hb ? 'tie' : ha > hb ? a : b)
  }

  // A bot fighter keeps its distance and side-steps; a watching bot stays.
  botGoal(b, people) {
    if (!this.hp.has(b.id)) return { x: b.x, z: b.z, stay: true }
    const foe = people.find((p) => p.id === this._other(b.id))
    if (!foe) return null
    const d = Math.hypot(foe.x - b.x, foe.z - b.z)
    if (d > 10) return foe
    const a = Math.atan2(b.z - foe.z, b.x - foe.x) + 0.5
    return { x: foe.x + Math.cos(a) * 8, z: foe.z + Math.sin(a) * 8 }
  }

  markColor(id) {
    const i = this.fighters.indexOf(id)
    return i >= 0 ? COLORS[i] : null
  }

  // My shot: only a fighter's, only at the other one.
  shoot(ray, reach, wall, damage) {
    const pm = this.pm
    if (pm.phase !== 'play' || !this.hp.has(pm.myId)) return false
    const foeId = this._other(pm.myId)
    const foe = pm._people().find((p) => p.id === foeId)
    if (!foe) return false
    const B = this.B
    const box = new THREE.Box3(new THREE.Vector3((foe.x - 0.4) * B, foe.y * B, (foe.z - 0.4) * B), new THREE.Vector3((foe.x + 0.4) * B, (foe.y + MOB_HEIGHT) * B, (foe.z + 0.4) * B))
    const hit = ray.intersectBox(box, new THREE.Vector3())
    if (!hit || hit.distanceTo(ray.origin) > Math.min(reach, wall ? wall.t : Infinity)) return false
    const amount = Math.round(Math.max(DMG_MIN, Math.min(DMG_MAX, damage * DMG_SHARE)))
    if (pm.runs) this._hit(foeId, amount, pm.myId)
    else this.s.net?.queueHit(`d${foeId}`, amount)
    this.s.damageNumbers?.show(foe.x, foe.y + MOB_HEIGHT, foe.z, amount)
    return true
  }

  remoteHit(h) {
    const id = String(h.id)
    if (id[0] === 'd') this._hit(id.slice(1), Math.max(0, Math.min(DMG_MAX, Number(h.dmg) || 0)), String(h.by || ''))
  }

  // --- every screen ---

  draw() {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor === key) return
    this._builtFor = key
    const s = this.s
    const bm = s.bm
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z) === type) return
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      bm.placeBlock(x, y, z, type, true)
      s._placed.set(bm._key(x, y, z), type)
    }
    bm._suppressUndoRecording = true
    for (let x = -HALF - 1; x <= HALF + 1; x++) {
      for (let z = -HALF - 1; z <= HALF + 1; z++) {
        const edge = Math.abs(x) === HALF + 1 || Math.abs(z) === HALF + 1
        put(hx + x, DUEL_Y, hz + z, edge ? 'stonebricks' : (x + z) % 2 ? 'smoothstone' : 'polishedtuff')
        if (edge) for (let y = 1; y <= H; y++) put(hx + x, DUEL_Y + y, hz + z, y === H ? 'glowstone' : 'stonebricks')
      }
    }
    // Cover in the middle.
    for (const [x, z] of [[0, -3], [0, 3], [-3, 0], [3, 0]]) for (let y = 1; y <= 2; y++) put(hx + x, DUEL_Y + y, hz + z, 'cobblestone')
    // The stand for everyone watching, over the south wall.
    for (let x = -4; x <= 4; x++) for (let z = HALF + 2; z <= HALF + 4; z++) put(hx + x, DUEL_Y + H, hz + z, 'oak')
    bm._suppressUndoRecording = false
  }

  events(was) {
    const pm = this.pm
    const s = this.s
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      const i = this.fighters.indexOf(pm.myId)
      const at = i >= 0 ? { ...this.spotOf(i), y: DUEL_Y + 1 } : this.stand()
      const tm = s.bm.tryMode
      tm.pos.set(at.x, at.y, at.z)
      tm.vel?.set(0, 0, 0)
      s.bm.camera.position.set(at.x * this.B, (at.y + 1.62) * this.B, at.z * this.B)
      s.bm._yaw = i === 1 ? Math.PI / 2 : -Math.PI / 2
      this._myHp = DUEL_HP
    }
    // Hit: a thump.
    const mine = this.hp.get(pm.myId)
    if (pm.phase === 'play' && mine !== undefined && mine < (this._myHp ?? DUEL_HP)) {
      try { audioEngine.playSpecial?.('thud') } catch { /* no audio */ }
    }
    this._myHp = mine
    if (pm.phase === 'end') this._lastWinner = pm.winner
    // A duel I fought is over: my rating moves.
    if (pm.phase === 'end' && was.phase === 'play' && this.fighters.includes(pm.myId) && pm.winner !== 'tie') {
      const won = pm.winner === pm.myId
      const d = loadDuel()
      if (won) {
        d.rating += WIN_PTS
        d.wins++
      } else {
        d.rating = Math.max(0, d.rating - LOSS_PTS)
        d.losses++
      }
      saveDuel(d)
      this.me = d
      s._message(t(won ? 'duelWon' : 'duelLost', { r: d.rating, n: won ? WIN_PTS : LOSS_PTS }), 5)
    }
  }

  async _loadTop() {
    try {
      const CloudSync = await import('./CloudSync.js')
      this.top = await CloudSync.fetchTopDuels(TOP_N)
    } catch {
      this.top = null
    }
  }

  startText() {
    const pm = this.pm
    if (!this.fighters.includes(pm.myId)) return t('duelWatch', { a: pm._name(this.fighters[0] || ''), b: pm._name(this.fighters[1] || '') })
    return t('duelStart', { name: pm._name(this._other(pm.myId)), n: DUEL_HP })
  }

  hud() {
    const pm = this.pm
    const [a, b] = this.fighters
    let out = a && b ? `${pm._name(a)} ${Math.ceil(this.hp.get(a) ?? 0)} - ${Math.ceil(this.hp.get(b) ?? 0)} ${pm._name(b)}` : ''
    out += `${out ? ' · ' : ''}${t('duelRating', { r: this.me.rating })}`
    if (this.top?.length) out += ` · ${t('duelWorldTop')} ${this.top.slice(0, 3).map((e, i) => `${i + 1}. ${String(e.name || '?').slice(0, 14)} ${Math.round(e.duelRating)}`).join(', ')}`
    return out
  }

  protects(x, y, z) {
    const pm = this.pm
    if (!pm.home || y < DUEL_Y - 1 || y > DUEL_Y + H + 3) return false
    return Math.abs(x - pm.home.x) <= HALF + 2 && z >= pm.home.z - HALF - 2 && z <= pm.home.z + HALF + 5
  }

  snap() {
    const hp = {}
    for (const [id, n] of this.hp) hp[this.pm._out(id)] = Math.round(n)
    return { hp, fi: this.fighters.map((id) => this.pm._out(id)).join('|') }
  }

  apply(d) {
    if (d.hp && typeof d.hp === 'object') this.hp = new Map(Object.entries(d.hp).filter(([, n]) => Number.isFinite(n)))
    if (typeof d.fi === 'string') this.fighters = d.fi.split('|').filter((id) => /^(?:b\d{1,4}|[A-Za-z0-9]{4,40})$/.test(id)).slice(0, 2)
  }

  dispose() {}
}
