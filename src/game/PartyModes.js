// Six party modes (2026-11-01, Gaymi's idea list 3: "hide-and-seek,
// capture the flag, king of the hill, or zombie soccer" - Gaymi picked
// "servers + bots solo", like Infection; Hot Potato and Zombie Bowling
// added 2026-11-02, idea list 5, "like other party modes"). Owned by BuildSurvival
// (`s.party`) when cfg.mode is one of PARTY_MODES (all NO_ZOMBIE_MODES:
// no waves). Every mode plays in rounds: WAIT_S to get ready (bots fill
// the empty spots up to TOTAL), the round, then END_S showing who won.
// The arena is laid out round where the round began (`home`):
//
// - hideSeek (Hide and Seek): one seeker (two from 6 players) is
//   blindfolded and frozen for HIDE_S while everyone hides. Then a seeker
//   touching a hider finds them - they turn seeker too. Everyone found =
//   the seekers win; anyone still hidden when the clock runs out wins.
//   No shooting.
// - captureFlag (Capture the Flag): Red and Blue, a flag at each base
//   FLAG_GAP blocks apart. Touch the other team's flag to carry it; bring
//   it to your own base (while your own flag is home) to score. A shot
//   stuns an enemy for STUN_S - a stunned carrier drops the flag where
//   they stand; touch your own dropped flag to send it home. CAPS_TO_WIN,
//   or the most when time runs out.
// - kingHill (King of the Hill): everyone for themselves. Stand alone on
//   the glowing hill (HILL_R) for a point every second; a shot stuns
//   (stunned players don't score). First to HILL_POINTS wins, else the
//   most points when time runs out.
// - zombieSoccer (Zombie Soccer): Red and Blue kick a big zombie-head
//   ball (run into it) into the other team's goal (GOAL_GAP apart,
//   GOAL_W wide). A shot knocks the ball along. GOALS_TO_WIN, or the most
//   when time runs out.
// - hotPotato (Hot Potato): everyone for themselves. One player carries a
//   ticking zombie bomb over their head; touching someone passes it (not
//   straight back: PASS_CD). Its fuse (FUSE_S, hidden - it ticks faster
//   near the end) runs out on whoever holds it: they blow up into
//   confetti and are out, and a new bomb starts on someone still in. The
//   last one standing wins. No shooting.
// - zombieBowling (Zombie Bowling): everyone for themselves, in turns
//   (ROLLS each). On your turn (TURN_S) run into the ball at the line - or
//   shoot it - to send it down at 10 little zombie pins BOWL_GAP away; a
//   pin hit falls and can knock its neighbours. Pins down = points, all
//   10 is a Strike. Only the bowler can touch the ball. Most pins wins.
//
// Whoever runs it (alone, or a server's host - `runs`) keeps the round,
// moves the bots and the ball and checks touches from everyone's synced
// spots (PlayNet.players). Its state goes to the others in the host's sync
// (snapshot / applySnapshot, `party` in api/_lib/servers.js). A guest's
// stun shot travels like Infection's (PlayNet.queueHit, 's' + who).
// Winners get WIN_COINS shop coins. Meshes only, never a light.
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { nameTag } from './BuildCamp.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { saveShopProgress } from './Game.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const PARTY_MODES = ['hideSeek', 'captureFlag', 'kingHill', 'zombieSoccer', 'hotPotato', 'zombieBowling']
// Each mode's server mode (api/_lib/servers.js MODES).
export const PARTY_SERVER_MODES = { hideSeek: 'hide', captureFlag: 'ctf', kingHill: 'koth', zombieSoccer: 'soccer', hotPotato: 'potato', zombieBowling: 'bowling' }
export const TOTAL = 6
export const WAIT_S = 8
export const END_S = 7
export const ROUND_S = { hideSeek: 150, captureFlag: 300, kingHill: 240, zombieSoccer: 240, hotPotato: 300, zombieBowling: 300 }
export const HIDE_S = 20
export const STUN_S = 2.5
export const FLAG_GAP = 32
export const CAPS_TO_WIN = 3
export const HILL_R = 3.5
export const HILL_POINTS = 45
export const GOAL_GAP = 34
export const GOAL_W = 5
export const GOALS_TO_WIN = 3
export const WIN_COINS = 25
export const FUSE_S = [12, 22]
const PASS_CD = 1
export const BOWL_GAP = 22
export const PINS = 10
export const ROLLS = 2
export const TURN_S = 14
const PIN_R = 0.3
const PIN_CHAIN = 0.55 // a falling pin knocks a neighbour this often
const BOT_AIM = 1.4 // how far off a bot's roll can be (blocks)
const ID_SCORE_MODES = new Set(['kingHill', 'hotPotato', 'zombieBowling'])
const TEAM_MODES = new Set(['captureFlag', 'zombieSoccer'])
const TAG_DIST = 1.2
const STUN_SPEED = 0.4
const BOT_SPEED = 5.2
const BOT_SEEK_SEE = 12
const BALL_R = 0.45
const KICK = 9
const SHOT_KICK = 12
const BALL_DRAG = 1.2
const BOWL_DRAG = 0.35
const GRAVITY = 28
const JUMP = 8.6
const FOLLOW = 12
const BOT_SHOT_EVERY = [2, 4]
const BOT_SHOT_RANGE = 8
export const TEAM_COLORS = { r: 0xe8443a, b: 0x3a7be8 }
const BOT_NAMES = ['Bean', 'Pickles', 'Noodle', 'Biscuit', 'Waffles', 'Sprout', 'Gizmo', 'Muffin', 'Tater', 'Pebble']
const ID_RE = /^(?:b\d{1,4}|[A-Za-z0-9]{4,40}|me)$/

let _skin = null
function skin() {
  if (!_skin) _skin = loadSkinTexture(DEFAULT_SKIN_DATA_URL).catch(() => null)
  return _skin
}

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra })

export class PartyMode {
  constructor(survival, kind) {
    this.s = survival
    this.kind = kind
    this.phase = 'wait'
    this.left = WAIT_S
    this.round = 1
    this.winner = ''
    this.home = null
    this.teams = new Map() // id -> 'r' | 'b'
    this.seekers = new Set()
    this.stunned = new Map()
    this.score = {} // team or player id -> points
    this.flags = { r: { at: 'base', by: '', x: 0, y: 0, z: 0 }, b: { at: 'base', by: '', x: 0, y: 0, z: 0 } }
    this.ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
    this.holder = '' // Hot Potato: who has the bomb
    this.fuse = 0
    this.out = new Set()
    this._passCd = 0
    this.turn = '' // Zombie Bowling: whose roll it is
    this.order = []
    this.rolls = {} // id -> rolls done
    this.rolled = false
    this.turnLeft = 0
    this.pinsDown = new Array(PINS).fill(false)
    this._still = 0
    this.bots = new Map()
    this._botN = 0
    this._myId = 'me'
    this._hillT = 0
    this._was = { phase: '', round: 0, seeker: false, holder: '', out: new Set(), turn: '' }
    this._baseSpeed = survival.bm.tryMode.speedMult ?? 1
    this._skin = null
    skin().then((k) => { this._skin = k })
    this._blind = document.createElement('div')
    this._blind.id = 'party-blind'
    this._blind.appendChild(document.createElement('span'))
    document.body.appendChild(this._blind)
    this.arena = new THREE.Group()
    survival.bm.scene.add(this.arena)
    this._marks = new Map() // id -> team mark mesh over their head
  }

  get runs() {
    const n = this.s.net
    return !n || n.isHost
  }

  get myId() {
    const id = (this.s.net || this.s.lobby)?.playerId || 'me'
    if (id !== this._myId) {
      for (const set of [this.seekers]) if (set.delete(this._myId)) set.add(id)
      if (this.teams.has(this._myId)) {
        this.teams.set(id, this.teams.get(this._myId))
        this.teams.delete(this._myId)
      }
      this._myId = id
    }
    return id
  }

  get myTeam() {
    return this.teams.get(this.myId) || ''
  }

  // Everyone: { id, x, y, z, bot? } in blocks (feet).
  _people() {
    const out = []
    const me = this.s.bodyPos()
    out.push({ id: this.myId, x: me.x, y: me.y, z: me.z })
    for (const [pid, p] of this.s.net?.players || []) if (p.seen) out.push({ id: pid, x: p.tx ?? p.x, y: p.ty ?? p.y, z: p.tz ?? p.z })
    for (const b of this.bots.values()) out.push({ id: b.id, x: b.x, y: b.y, z: b.z, bot: b })
    return out
  }

  // Where things stand round `home`: the bases / goals (r on -x, b on +x)
  // and the hill.
  spot(which) {
    const h = this.home
    if (!h) return null
    const gap = this.kind === 'zombieSoccer' ? GOAL_GAP : this.kind === 'zombieBowling' ? BOWL_GAP : FLAG_GAP
    const dx = which === 'r' ? -gap / 2 : which === 'b' ? gap / 2 : 0
    const x = h.x + dx
    const z = h.z
    return { x, y: this.s._groundUnder(x, h.y + 6, z), z }
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    if (this.runs) this._run(dt)
    else this.left = Math.max(0, this.left - dt)
    for (const [id, left] of this.stunned) {
      if (left - dt <= 0) this.stunned.delete(id)
      else this.stunned.set(id, left - dt)
    }
    for (const b of this.bots.values()) {
      if (this.runs) this._moveBot(b, dt)
      this._drawBot(b, dt)
    }
    this._drawArena(dt)
    this._markPlayers()
    this._events()
    const me = this.myId
    const frozen = this.kind === 'hideSeek' && this.phase === 'play' && this.seekers.has(me) && this._hiding()
    s.bm.tryMode.speedMult = this._baseSpeed * (frozen ? 0 : this.stunned.has(me) ? STUN_SPEED : 1)
    this._blind.className = frozen ? 'on' : ''
    if (frozen) this._blind.firstChild.textContent = t('partyBlindfold', { n: Math.ceil(this._hideLeft()) })
    if (Math.floor(this.left) !== this._lastShown) {
      this._lastShown = Math.floor(this.left)
      s._renderHud()
    }
  }

  _hideLeft() {
    return this.left - (ROUND_S.hideSeek - HIDE_S)
  }

  _hiding() {
    return this.kind === 'hideSeek' && this.phase === 'play' && this._hideLeft() > 0
  }

  // --- the round (only where it runs) ---

  _run(dt) {
    const people = this._people()
    const real = people.filter((p) => !p.bot).length
    if (this.phase === 'wait') {
      this._fillBots(Math.max(0, TOTAL - real))
      this.left -= dt
      if (this.left <= 0) this._begin()
      return
    }
    if (this.phase === 'end') {
      this.left -= dt
      if (this.left <= 0) {
        this.phase = 'wait'
        this.left = WAIT_S
        this.round++
        this.winner = ''
      }
      return
    }
    // Whoever left isn't counted; whoever joined gets a team.
    const ids = new Set(people.map((p) => p.id))
    for (const id of [...this.teams.keys()]) if (!ids.has(id)) this.teams.delete(id)
    for (const id of this.seekers) if (!ids.has(id)) this.seekers.delete(id)
    for (const id of this.out) if (!ids.has(id)) this.out.delete(id)
    if (TEAM_MODES.has(this.kind)) for (const p of people) if (!this.teams.has(p.id)) this.teams.set(p.id, this._smallerTeam())
    this.left -= dt
    if (this.kind === 'hideSeek') this._runHide(people)
    else if (this.kind === 'captureFlag') this._runFlags(people)
    else if (this.kind === 'kingHill') this._runHill(people, dt)
    else if (this.kind === 'hotPotato') this._runPotato(people, dt)
    else if (this.kind === 'zombieBowling') this._runBowl(people, dt)
    else this._runBall(people, dt)
    if (this.phase === 'play' && this.left <= 0) this._timeUp()
  }

  _smallerTeam() {
    let r = 0
    let b = 0
    for (const tm of this.teams.values()) tm === 'r' ? r++ : b++
    return r <= b ? 'r' : 'b'
  }

  _begin() {
    const me = this.s.bodyPos()
    this.home = { x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, z: Math.round(me.z * 10) / 10 }
    this.phase = 'play'
    this.left = ROUND_S[this.kind]
    this.stunned.clear()
    this.teams.clear()
    this.seekers.clear()
    this.score = {}
    const people = this._people()
    const shuffled = people.map((p) => p.id).sort(() => Math.random() - 0.5)
    if (TEAM_MODES.has(this.kind)) {
      shuffled.forEach((id, i) => this.teams.set(id, i % 2 ? 'b' : 'r'))
      this.score = { r: 0, b: 0 }
    }
    if (this.kind === 'hideSeek') for (const id of shuffled.slice(0, people.length >= 6 ? 2 : 1)) this.seekers.add(id)
    if (this.kind === 'captureFlag') for (const tm of ['r', 'b']) this._flagHome(tm)
    if (this.kind === 'zombieSoccer') this._ballHome()
    this.out.clear()
    if (this.kind === 'hotPotato') this._newBomb(people)
    if (this.kind === 'zombieBowling') {
      this.order = shuffled
      this.rolls = {}
      for (const id of shuffled) this.score[id] = 0
      this._startTurn(shuffled[0])
    }
    // Bots start at their own end (team modes) or scattered.
    for (const b of this.bots.values()) {
      const tm = this.teams.get(b.id)
      const at = tm ? this.spot(tm) : null
      if (at) this._place(b, at.x + (Math.random() - 0.5) * 4, at.z + (Math.random() - 0.5) * 4)
      b.hideAt = null
      b.shotIn = BOT_SHOT_EVERY[0] + Math.random() * (BOT_SHOT_EVERY[1] - BOT_SHOT_EVERY[0])
    }
  }

  _place(b, x, z) {
    b.x = b.tx = x
    b.z = b.tz = z
    b.y = b.ty = this.s._groundUnder(x, (this.home?.y ?? b.y) + 8, z)
    b.vy = 0
  }

  _end(winner) {
    this.phase = 'end'
    this.left = END_S
    this.winner = winner
  }

  // The clock ran out: the most points wins (Hide and Seek: the hiders).
  _timeUp() {
    if (this.kind === 'hideSeek') return this._end('h')
    if (this.kind === 'hotPotato') return this._end('tie')
    let best = ''
    let top = -1
    let tie = false
    for (const [id, n] of Object.entries(this.score)) {
      if (n > top) {
        top = n
        best = id
        tie = false
      } else if (n === top) tie = true
    }
    this._end(tie || !best ? 'tie' : best)
  }

  _runHide(people) {
    if (!this.seekers.size && people.length) this.seekers.add(people[0].id)
    if (this._hiding()) return
    for (const z of people) {
      if (!this.seekers.has(z.id)) continue
      for (const h of people) {
        if (this.seekers.has(h.id)) continue
        if (Math.hypot(h.x - z.x, h.z - z.z) < TAG_DIST && Math.abs(h.y - z.y) < 1.6) this.seekers.add(h.id)
      }
    }
    if (!people.some((p) => !this.seekers.has(p.id))) this._end('s')
  }

  _flagHome(tm) {
    const at = this.spot(tm)
    Object.assign(this.flags[tm], { at: 'base', by: '', x: at.x, y: at.y, z: at.z })
  }

  _runFlags(people) {
    const near = (p, q, r = TAG_DIST + 0.3) => Math.hypot(p.x - q.x, p.z - q.z) < r && Math.abs(p.y - q.y) < 2
    for (const tm of ['r', 'b']) {
      const f = this.flags[tm]
      if (f.at === 'carried') {
        const c = people.find((p) => p.id === f.by)
        if (!c) {
          f.at = 'down'
          f.by = ''
          continue
        }
        Object.assign(f, { x: c.x, y: c.y, z: c.z })
        // Home with it, and my own flag is home too: a capture.
        const mine = this.teams.get(c.id)
        if (near(c, this.spot(mine), 2.5) && this.flags[mine].at === 'base') {
          this.score[mine] = (this.score[mine] || 0) + 1
          this._flagHome(tm)
          this._say = { k: 'partyCapture', team: mine }
          if (this.score[mine] >= CAPS_TO_WIN) this._end(mine)
        }
        continue
      }
      for (const p of people) {
        if (this.stunned.has(p.id) || !near(p, f)) continue
        const pt = this.teams.get(p.id)
        if (pt === tm) {
          if (f.at === 'down') this._flagHome(tm)
        } else if (!Object.values(this.flags).some((o) => o.by === p.id)) {
          f.at = 'carried'
          f.by = p.id
          this._say = { k: 'partyFlagTaken', team: pt }
          break
        }
      }
    }
  }

  // A stunned carrier drops the flag.
  _dropFlags(id) {
    for (const f of Object.values(this.flags)) {
      if (f.at === 'carried' && f.by === id) {
        f.at = 'down'
        f.by = ''
      }
    }
  }

  _runHill(people, dt) {
    const hill = this.spot('hill')
    const on = people.filter((p) => !this.stunned.has(p.id) && Math.hypot(p.x - hill.x, p.z - hill.z) < HILL_R && Math.abs(p.y - hill.y) < 2.5)
    this.king = on.length === 1 ? on[0].id : ''
    this._hillT += dt
    if (this._hillT < 1) return
    this._hillT -= 1
    if (!this.king) return
    this.score[this.king] = (this.score[this.king] || 0) + 1
    if (this.score[this.king] >= HILL_POINTS) this._end(this.king)
  }

  _ballHome() {
    const at = this.spot('mid')
    Object.assign(this.ball, { x: at.x, y: at.y + 0.5, z: at.z, vx: 0, vy: 0, vz: 0 })
  }

  _runBall(people, dt) {
    const b = this.ball
    this._moveBall(dt, people)
    // A goal: past a goal line, between the posts.
    const h = this.home
    if (Math.abs(b.z - h.z) < GOAL_W / 2) {
      const scorer = b.x < h.x - GOAL_GAP / 2 ? 'b' : b.x > h.x + GOAL_GAP / 2 ? 'r' : ''
      if (scorer) {
        this.score[scorer] = (this.score[scorer] || 0) + 1
        this._say = { k: 'partyGoal', team: scorer }
        this._ballHome()
        if (this.score[scorer] >= GOALS_TO_WIN) this._end(scorer)
      }
    }
    // Lost far away: back to the middle.
    if (Math.hypot(b.x - h.x, b.z - h.z) > GOAL_GAP * 1.5 || b.y < h.y - 30) this._ballHome()
  }

  // The ball rolls, bounces off walls and is kicked by `kickers` running
  // into it. -> true if someone kicked it.
  _moveBall(dt, kickers) {
    const s = this.s
    const b = this.ball
    let kicked = false
    for (const p of kickers) {
      const dx = b.x - p.x
      const dz = b.z - p.z
      const d = Math.hypot(dx, dz)
      if (d > 0.9 || Math.abs(b.y - p.y) > 1.6 || this.stunned.has(p.id)) continue
      b.vx = (dx / (d || 1)) * KICK
      b.vz = (dz / (d || 1)) * KICK
      b.vy = this.kind === 'zombieBowling' ? 0.5 : 3
      kicked = true
    }
    const k = Math.exp(-(this.kind === 'zombieBowling' ? BOWL_DRAG : BALL_DRAG) * dt)
    b.vx *= k
    b.vz *= k
    for (const axis of ['x', 'z']) {
      const v = axis === 'x' ? b.vx : b.vz
      if (!v) continue
      const nx = axis === 'x' ? b.x + v * dt : b.x
      const nz = axis === 'z' ? b.z + v * dt : b.z
      if (s._solid(Math.floor(nx + Math.sign(axis === 'x' ? v : 0) * BALL_R), Math.floor(b.y + 0.1), Math.floor(nz + Math.sign(axis === 'z' ? v : 0) * BALL_R))) {
        if (axis === 'x') b.vx = -b.vx * 0.6
        else b.vz = -b.vz * 0.6
        continue
      }
      b.x = nx
      b.z = nz
    }
    b.vy -= GRAVITY * dt
    b.y += b.vy * dt
    const ground = s._groundUnder(b.x, b.y + 0.6, b.z)
    if (b.y <= ground) {
      b.y = ground
      b.vy = Math.abs(b.vy) > 3 ? -b.vy * 0.4 : 0
    }
    return kicked
  }

  // --- Hot Potato ---

  // A new bomb on someone still in, with a fresh (hidden) fuse.
  _newBomb(people) {
    const alive = people.filter((p) => !this.out.has(p.id))
    this.holder = alive.length ? alive[Math.floor(Math.random() * alive.length)].id : ''
    this.fuse = FUSE_S[0] + Math.random() * (FUSE_S[1] - FUSE_S[0])
    this._passCd = PASS_CD
    this._from = ''
  }

  _runPotato(people, dt) {
    const alive = people.filter((p) => !this.out.has(p.id))
    if (alive.length <= 1) return this._end(alive[0]?.id || 'tie')
    const h = alive.find((p) => p.id === this.holder)
    if (!h) return this._newBomb(people)
    this.fuse -= dt
    if (this.fuse <= 0) {
      this.out.add(h.id)
      this._say = { k: 'partyPotatoBoom', name: h.id }
      const left = alive.filter((p) => p.id !== h.id)
      if (left.length <= 1) return this._end(left[0]?.id || 'tie')
      return this._newBomb(people)
    }
    this._passCd -= dt
    if (this._passCd > 0) return
    for (const p of alive) {
      if (p.id === h.id || (p.id === this._from && this._passCd > -PASS_CD)) continue
      if (Math.hypot(p.x - h.x, p.z - h.z) < TAG_DIST + 0.2 && Math.abs(p.y - h.y) < 1.6) {
        this._from = h.id
        this.holder = p.id
        this._passCd = PASS_CD
        break
      }
    }
  }

  // --- Zombie Bowling ---

  // Where pin i stands: a triangle (1, 2, 3, 4) pointing at the line.
  pinSpot(i) {
    const key = this.home ? `${this.home.x},${this.home.z}` : ''
    if (this._pinKey !== key) {
      this._pinKey = key
      this._pinAt = []
    }
    return this._pinAt[i] || (this._pinAt[i] = this._pinSpot(i))
  }

  _pinSpot(i) {
    const head = this.spot('b')
    if (!head) return null
    let row = 0
    let first = 0
    while (i >= first + row + 1) {
      first += row + 1
      row++
    }
    const x = head.x + row * 0.8
    const z = head.z + (i - first - row / 2) * 0.8
    return { x, y: this.s._groundUnder(x, head.y + 4, z), z }
  }

  _ballAtLine() {
    const at = this.spot('r')
    Object.assign(this.ball, { x: at.x + 1.5, y: at.y + 0.5, z: at.z, vx: 0, vy: 0, vz: 0 })
  }

  _startTurn(id) {
    this.turn = id || ''
    this.rolled = false
    this.turnLeft = TURN_S
    this._still = 0
    this.pinsDown.fill(false)
    this._ballAtLine()
    const b = this.bots.get(id)
    if (b) {
      const at = this.spot('r')
      this._place(b, at.x - 1, at.z + (Math.random() - 0.5))
      b.aim = (Math.random() - 0.5) * 2 * BOT_AIM
      b.wait = 0.8 + Math.random()
    }
  }

  _runBowl(people, dt) {
    for (const p of people) if (!this.order.includes(p.id)) {
      this.order.push(p.id)
      this.score[p.id] = this.score[p.id] || 0
    }
    const bowler = people.find((p) => p.id === this.turn)
    if (!bowler) return this._nextTurn(people)
    this.turnLeft -= dt
    const b = this.ball
    if (this._moveBall(dt, [bowler])) this.rolled = true
    // Pins it hits fall, and can knock a neighbour over.
    const speed = Math.hypot(b.vx, b.vz)
    const fall = (i) => {
      if (this.pinsDown[i]) return
      this.pinsDown[i] = true
      const at = this.pinSpot(i)
      for (let j = 0; j < PINS; j++) {
        if (this.pinsDown[j]) continue
        const o = this.pinSpot(j)
        if (Math.hypot(o.x - at.x, o.z - at.z) < 0.95 && Math.random() < PIN_CHAIN) fall(j)
      }
    }
    if (speed > 1) for (let i = 0; i < PINS; i++) {
      const at = this.pinSpot(i)
      if (!this.pinsDown[i] && Math.hypot(at.x - b.x, at.z - b.z) < PIN_R + BALL_R && Math.abs(at.y - b.y) < 1.5) fall(i)
    }
    const head = this.spot('b')
    this._still = this.rolled && speed < 0.4 ? this._still + dt : 0
    const gone = b.x > head.x + 5 || Math.abs(b.z - head.z) > 8 || b.y < head.y - 10
    if (this._still > 0.8 || (this.rolled && gone) || this.turnLeft <= 0) this._finishTurn(people)
  }

  _finishTurn(people) {
    const n = this.pinsDown.filter(Boolean).length
    const id = this.turn
    this.score[id] = (this.score[id] || 0) + n
    this.rolls[id] = (this.rolls[id] || 0) + 1
    this._say = n === PINS ? { k: 'partyBowlStrike', name: id } : { k: 'partyBowlPins', name: id, n }
    this._nextTurn(people)
  }

  // The next one in the order with rolls left; nobody left: the most pins wins.
  _nextTurn(people) {
    const here = new Set(people.map((p) => p.id))
    const i0 = this.order.indexOf(this.turn)
    for (let k = 1; k <= this.order.length; k++) {
      const id = this.order[(i0 + k) % this.order.length]
      if (here.has(id) && (this.rolls[id] || 0) < ROLLS) return this._startTurn(id)
    }
    this.turn = ''
    this._timeUp()
  }

  // --- bots ---

  _fillBots(want) {
    while (this.bots.size > want) this._removeBot([...this.bots.keys()].pop())
    while (this.bots.size < want) {
      const me = this.s.bodyPos()
      const a = Math.random() * Math.PI * 2
      const r = 4 + Math.random() * 6
      const x = me.x + Math.cos(a) * r
      const z = me.z + Math.sin(a) * r
      this._addBot(`b${++this._botN}`, { x, y: this.s._groundUnder(x, me.y + 12, z), z, n: this._botN })
    }
  }

  _addBot(id, { x, y, z, n }) {
    const B = this.s.B
    const group = new THREE.Group()
    group.add(nameTag(`${BOT_NAMES[(n - 1) % BOT_NAMES.length]} (${t('infectionBot')})`, B))
    this.s.bm.scene.add(group)
    const bot = { id, n, x, y, z, tx: x, ty: y, tz: z, vy: 0, yaw: 0, tyaw: 0, walk: 0, heading: Math.random() * Math.PI * 2, turnIn: 0, group, body: null, hideAt: null, shotIn: 3 }
    this.bots.set(id, bot)
    return bot
  }

  _removeBot(id) {
    const b = this.bots.get(id)
    if (!b) return
    this.bots.delete(id)
    this.teams.delete(id)
    this.seekers.delete(id)
    b.group.removeFromParent()
    disposeTree(b.group)
  }

  // Where a bot wants to go this frame -> { x, z, run } or null (wander).
  _botGoal(b, people) {
    const me = people.find((p) => p.id === b.id)
    const others = people.filter((p) => p.id !== b.id)
    const nearest = (list) => list.reduce((best, p) => (!best || Math.hypot(p.x - b.x, p.z - b.z) < Math.hypot(best.x - b.x, best.z - b.z) ? p : best), null)
    if (this.phase !== 'play' || !me) return null
    if (this.kind === 'hideSeek') {
      if (this.seekers.has(b.id)) {
        if (this._hiding()) return { x: b.x, z: b.z, stay: true }
        const h = nearest(others.filter((p) => !this.seekers.has(p.id) && Math.hypot(p.x - b.x, p.z - b.z) < BOT_SEEK_SEE))
        return h ? { x: h.x, z: h.z } : null
      }
      const z = nearest(others.filter((p) => this.seekers.has(p.id) && Math.hypot(p.x - b.x, p.z - b.z) < 7))
      if (z && !this._hiding()) return { x: b.x * 2 - z.x, z: b.z * 2 - z.z }
      if (!b.hideAt) {
        const a = Math.random() * Math.PI * 2
        const r = 12 + Math.random() * 16
        b.hideAt = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r }
      }
      return Math.hypot(b.hideAt.x - b.x, b.hideAt.z - b.z) > 1 ? b.hideAt : { x: b.x, z: b.z, stay: true }
    }
    const tm = this.teams.get(b.id)
    if (this.kind === 'captureFlag') {
      const enemy = tm === 'r' ? 'b' : 'r'
      const carrying = Object.values(this.flags).some((f) => f.by === b.id)
      if (carrying) return this.spot(tm)
      const mine = this.flags[tm]
      if (mine.at === 'carried') {
        const c = people.find((p) => p.id === mine.by)
        if (c) return c
      }
      if (mine.at === 'down') return mine
      return this.flags[enemy]
    }
    if (this.kind === 'kingHill') return this.spot('hill')
    if (this.kind === 'hotPotato') {
      if (this.out.has(b.id)) return null
      const alive = others.filter((p) => !this.out.has(p.id))
      if (this.holder === b.id) return nearest(alive)
      const h = alive.find((p) => p.id === this.holder)
      if (h && Math.hypot(h.x - b.x, h.z - b.z) < 9) return { x: b.x * 2 - h.x, z: b.z * 2 - h.z }
      return null
    }
    if (this.kind === 'zombieBowling') {
      const line = this.spot('r')
      if (this.turn !== b.id || this.rolled) {
        // Waiting: off to the side of the line.
        const w = { x: line.x - 2, z: line.z + 3 + (b.n % 3) }
        return Math.hypot(w.x - b.x, w.z - b.z) > 1 ? w : { x: b.x, z: b.z, stay: true }
      }
      if ((b.wait -= this._dt || 0) > 0) return { x: b.x, z: b.z, stay: true }
      const head = this.spot('b')
      const ball = this.ball
      const gx = head.x + 1.2 - ball.x
      const gz = head.z + (b.aim || 0) - ball.z
      const gd = Math.hypot(gx, gz) || 1
      const behind = { x: ball.x - (gx / gd) * 1.2, z: ball.z - (gz / gd) * 1.2 }
      return Math.hypot(behind.x - b.x, behind.z - b.z) > 0.6 ? behind : { x: ball.x + gx / gd, z: ball.z + gz / gd }
    }
    // Soccer: get behind the ball (on the side away from the goal it's
    // going for), then run through it.
    const goal = this.spot(tm === 'r' ? 'b' : 'r')
    const ball = this.ball
    const gx = goal.x - ball.x
    const gz = goal.z - ball.z
    const gd = Math.hypot(gx, gz) || 1
    const behind = { x: ball.x - (gx / gd) * 1.2, z: ball.z - (gz / gd) * 1.2 }
    return Math.hypot(behind.x - b.x, behind.z - b.z) > 1.2 ? behind : { x: ball.x + (gx / gd), z: ball.z + (gz / gd) }
  }

  _moveBot(b, dt) {
    const s = this.s
    const people = this._people()
    this._dt = dt
    const goal = this._botGoal(b, people)
    // Bots stun enemies close by now and then (Flag and Hill).
    if (this.phase === 'play' && (this.kind === 'captureFlag' || this.kind === 'kingHill') && !this.stunned.has(b.id)) {
      b.shotIn -= dt
      if (b.shotIn <= 0) {
        b.shotIn = BOT_SHOT_EVERY[0] + Math.random() * (BOT_SHOT_EVERY[1] - BOT_SHOT_EVERY[0])
        const tm = this.teams.get(b.id)
        const target = people.find((p) => p.id !== b.id && (!tm || this.teams.get(p.id) !== tm) && Math.hypot(p.x - b.x, p.z - b.z) < BOT_SHOT_RANGE)
        if (target && Math.random() < 0.5) this.stun(target.id)
      }
    }
    let dx = 0
    let dz = 0
    if (goal && !goal.stay) {
      const d = Math.hypot(goal.x - b.x, goal.z - b.z)
      if (d > 0.4) {
        dx = (goal.x - b.x) / d
        dz = (goal.z - b.z) / d
      }
    } else if (!goal) {
      b.turnIn -= dt
      if (b.turnIn <= 0) {
        b.heading = Math.random() * Math.PI * 2
        b.turnIn = 2 + Math.random() * 3
      }
      dx = Math.cos(b.heading) * 0.5
      dz = Math.sin(b.heading) * 0.5
    }
    const speed = BOT_SPEED * (this.stunned.has(b.id) ? STUN_SPEED : 1)
    const ground = s._groundUnder(b.x, b.y + 0.05, b.z)
    const onGround = b.y <= ground + 0.01
    for (const [ax, az] of [[dx, 0], [0, dz]]) {
      if (!ax && !az) continue
      const nx = b.x + ax * speed * dt
      const nz = b.z + az * speed * dt
      const cx = Math.floor(nx + Math.sign(ax) * 0.3)
      const cz = Math.floor(nz + Math.sign(az) * 0.3)
      const fy = Math.floor(b.y + 0.05)
      if (s._solid(cx, fy, cz) || s._solid(cx, fy + 1, cz)) {
        if (onGround && !s._solid(cx, fy + 1, cz) && !s._solid(cx, fy + 2, cz)) b.vy = JUMP
        else b.turnIn = 0
        continue
      }
      b.x = nx
      b.z = nz
    }
    b.vy -= GRAVITY * dt
    b.y += b.vy * dt
    const under = s._groundUnder(b.x, Math.max(b.y, ground) + 0.05, b.z)
    if (b.y <= under) {
      b.y = under
      b.vy = 0
    }
    if (dx || dz) b.tyaw = Math.atan2(dx, dz)
    b.tx = b.x
    b.ty = b.y
    b.tz = b.z
  }

  _body(sk) {
    const B = this.s.B
    const body = buildTexturedCharacter(sk)
    const sc = (MOB_HEIGHT * B) / 32
    body.scale.setScalar(sc)
    body.position.y = 2 * sc
    return body
  }

  _drawBot(b, dt) {
    const B = this.s.B
    const k = 1 - Math.exp(-FOLLOW * dt)
    if (!this.runs) {
      b.x += (b.tx - b.x) * k
      b.y += (b.ty - b.y) * k
      b.z += (b.tz - b.z) * k
    }
    let dy = b.tyaw - b.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    b.yaw += dy * k
    const ox = b.group.position.x / B
    const oz = b.group.position.z / B
    b.group.position.set(b.x * B, b.y * B, b.z * B)
    b.group.rotation.y = b.yaw
    if (this._skin && !b.body) b.group.add(b.body = this._body(this._skin))
    this._mark(b.id, b.group)
    const lp = b.body?.limbPivots
    if (lp) {
      const speed = dt > 0 ? Math.hypot(b.x - ox, b.z - oz) / dt : 0
      b.walk += dt * Math.min(speed, 8) * 3.2
      const swing = Math.sin(b.walk) * Math.min(1, speed / 2) * 0.7
      lp.legR.rotation.x = swing
      lp.legL.rotation.x = -swing
      lp.armR.rotation.x = -swing
      lp.armL.rotation.x = swing
    }
  }

  // A coloured diamond over someone's head: their team (or a seeker's
  // purple, or the King's gold).
  _markColor(id) {
    if (this.phase !== 'play' && this.phase !== 'end') return null
    if (this.kind === 'hideSeek') return this.seekers.has(id) ? 0xa060ff : null
    if (this.kind === 'kingHill') return this.king === id ? 0xffd23f : null
    if (this.kind === 'hotPotato') return this.holder === id ? 0xff5a1a : this.out.has(id) ? 0x777777 : null
    if (this.kind === 'zombieBowling') return this.turn === id ? 0xffd23f : null
    const tm = this.teams.get(id)
    return tm ? TEAM_COLORS[tm] : null
  }

  _mark(id, group) {
    const color = this._markColor(id)
    let m = this._marks.get(id)
    if (color === null) {
      if (m) m.visible = false
      return
    }
    if (!m || m.parent !== group) {
      m?.removeFromParent()
      const B = this.s.B
      m = new THREE.Mesh(new THREE.OctahedronGeometry(0.22 * B), lambert(color, { emissive: color, emissiveIntensity: 0.5 }))
      m.position.y = (MOB_HEIGHT + 0.85) * B
      group.add(m)
      this._marks.set(id, m)
    }
    m.visible = true
    m.material.color.set(color)
    m.material.emissive.set(color)
    m.rotation.y += 0.03
  }

  _markPlayers() {
    for (const [pid, p] of this.s.net?.players || []) if (p.group) this._mark(pid, p.group)
  }

  // --- the arena: flags, bases, the hill, goals and the ball ---

  _drawArena() {
    const B = this.s.B
    const show = !!this.home && this.phase !== 'wait'
    this.arena.visible = show
    if (!show) return
    if (!this._built || this._builtFor !== `${this.home.x},${this.home.z}`) this._build()
    if (this.kind === 'captureFlag') {
      for (const tm of ['r', 'b']) {
        const f = this.flags[tm]
        const mesh = this._flagMeshes[tm]
        let at = f
        if (f.at === 'carried') {
          const c = this._people().find((p) => p.id === f.by)
          if (c) at = { x: c.x, y: c.y + MOB_HEIGHT * 0.6, z: c.z }
        }
        mesh.position.set(at.x * B, at.y * B, at.z * B)
      }
    }
    if (this.kind === 'zombieSoccer') {
      const b = this.ball
      this._ballMesh.position.set(b.x * B, (b.y + BALL_R) * B, b.z * B)
      this._ballMesh.rotation.x += (b.vz || 0) * 0.02
      this._ballMesh.rotation.z -= (b.vx || 0) * 0.02
    }
    if (this.kind === 'kingHill' && this._hillMesh) this._hillMesh.material.opacity = 0.3 + Math.sin(performance.now() / 300) * 0.1
    if (this.kind === 'hotPotato' && this._bomb) {
      const h = this._people().find((p) => p.id === this.holder && !this.out.has(p.id))
      this._bomb.visible = !!h && this.phase === 'play'
      if (h) {
        this._bomb.position.set(h.x * B, (h.y + MOB_HEIGHT + 0.7) * B, h.z * B)
        this._bomb.rotation.y += 0.04
        // Ticks faster as the fuse burns down (guests go by the host's).
        const rate = 2 + Math.max(0, 10 - this.fuse) * 1.2
        const on = Math.sin(performance.now() / 1000 * rate * Math.PI) > 0
        this._spark.material.color.set(on ? 0xffee55 : 0xff3a1a)
        this._spark.scale.setScalar(on ? 1.4 : 0.8)
      }
    }
    if (this.kind === 'zombieBowling' && this._pinMeshes) {
      const b = this.ball
      this._ballMesh.position.set(b.x * B, (b.y + BALL_R) * B, b.z * B)
      this._ballMesh.rotation.z -= (b.vx || 0) * 0.03
      this._ballMesh.visible = !!this.turn
      this._pinMeshes.forEach((m, i) => {
        const at = this.pinSpot(i)
        m.position.set(at.x * B, at.y * B, at.z * B)
        // A knocked pin tips over onto its back.
        const want = this.pinsDown[i] ? -Math.PI / 2 : 0
        m.rotation.z += (want - m.rotation.z) * 0.2
      })
    }
  }

  _build() {
    const B = this.s.B
    disposeTree(this.arena)
    this.arena.clear()
    this._built = true
    this._builtFor = `${this.home.x},${this.home.z}`
    if (this.kind === 'captureFlag') {
      this._flagMeshes = {}
      for (const tm of ['r', 'b']) {
        const base = this.spot(tm)
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.5 * B, 2.5 * B, 0.08 * B, 24), lambert(TEAM_COLORS[tm], { transparent: true, opacity: 0.55 }))
        pad.position.set(base.x * B, (base.y + 0.04) * B, base.z * B)
        this.arena.add(pad)
        const flag = new THREE.Group()
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1 * B, 2.6 * B, 0.1 * B), lambert(0xdddddd))
        pole.position.y = 1.3 * B
        const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.9 * B, 0.6 * B, 0.05 * B), lambert(TEAM_COLORS[tm], { emissive: TEAM_COLORS[tm], emissiveIntensity: 0.3 }))
        cloth.position.set(0.45 * B, 2.25 * B, 0)
        flag.add(pole, cloth)
        this.arena.add(flag)
        this._flagMeshes[tm] = flag
      }
    } else if (this.kind === 'kingHill') {
      const hill = this.spot('hill')
      this._hillMesh = new THREE.Mesh(new THREE.CylinderGeometry(HILL_R * B, HILL_R * B, 3 * B, 32, 1, true), lambert(0xffd23f, { transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, emissive: 0x6b4a00 }))
      this._hillMesh.position.set(hill.x * B, (hill.y + 1.5) * B, hill.z * B)
      this.arena.add(this._hillMesh)
    } else if (this.kind === 'zombieSoccer') {
      for (const tm of ['r', 'b']) {
        const g = this.spot(tm)
        const frame = new THREE.Group()
        const white = lambert(TEAM_COLORS[tm])
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.2 * B, 2.4 * B, 0.2 * B), white)
          post.position.set(0, 1.2 * B, side * (GOAL_W / 2) * B)
          frame.add(post)
        }
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2 * B, 0.2 * B, GOAL_W * B), white)
        bar.position.y = 2.4 * B
        frame.add(bar)
        frame.position.set(g.x * B, g.y * B, g.z * B)
        this.arena.add(frame)
      }
      // The ball: a green zombie head with a face.
      const ball = new THREE.Group()
      ball.add(new THREE.Mesh(new THREE.BoxGeometry(BALL_R * 2 * B, BALL_R * 2 * B, BALL_R * 2 * B), lambert(0x5c9a4a)))
      const dark = lambert(0x1c2a14)
      for (const [x, y, w] of [[-0.18, 0.12, 0.16], [0.18, 0.12, 0.16], [0, -0.17, 0.42]]) {
        const bit = new THREE.Mesh(new THREE.BoxGeometry(w * B, 0.1 * B, 0.03 * B), dark)
        bit.position.set(x * B, y * B, (BALL_R + 0.01) * B)
        ball.add(bit)
      }
      this._ballMesh = ball
      this.arena.add(ball)
    } else if (this.kind === 'hotPotato') {
      // The bomb: a green zombie head with a lit fuse on top.
      const bomb = new THREE.Group()
      bomb.add(new THREE.Mesh(new THREE.BoxGeometry(0.6 * B, 0.6 * B, 0.6 * B), lambert(0x4f8a3e)))
      const dark = lambert(0x1c2a14)
      for (const [x, y, w] of [[-0.13, 0.08, 0.12], [0.13, 0.08, 0.12], [0, -0.14, 0.3]]) {
        const bit = new THREE.Mesh(new THREE.BoxGeometry(w * B, 0.08 * B, 0.03 * B), dark)
        bit.position.set(x * B, y * B, 0.31 * B)
        bomb.add(bit)
      }
      const wick = new THREE.Mesh(new THREE.BoxGeometry(0.06 * B, 0.25 * B, 0.06 * B), lambert(0x2b2016))
      wick.position.y = 0.42 * B
      this._spark = new THREE.Mesh(new THREE.BoxGeometry(0.12 * B, 0.12 * B, 0.12 * B), new THREE.MeshBasicMaterial({ color: 0xffee55 }))
      this._spark.position.y = 0.58 * B
      bomb.add(wick, this._spark)
      this._bomb = bomb
      this.arena.add(bomb)
    } else if (this.kind === 'zombieBowling') {
      // The foul line, the pins (little zombies) and a dark purple ball.
      const line = this.spot('r')
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15 * B, 0.06 * B, 5 * B), lambert(0xffd23f, { emissive: 0x6b4a00 }))
      bar.position.set((line.x + 0.5) * B, (line.y + 0.03) * B, line.z * B)
      this.arena.add(bar)
      const head = this.spot('b')
      const pad = new THREE.Mesh(new THREE.BoxGeometry(4.2 * B, 0.06 * B, 4.2 * B), lambert(0xc89a5a, { transparent: true, opacity: 0.6 }))
      pad.position.set((head.x + 1.2) * B, (head.y + 0.03) * B, head.z * B)
      this.arena.add(pad)
      const body = lambert(0x5c9a4a)
      const shirt = lambert(0x3a5fa8)
      const eye = lambert(0x1c2a14)
      this._pinMeshes = []
      for (let i = 0; i < PINS; i++) {
        const pin = new THREE.Group()
        const legs = new THREE.Mesh(new THREE.BoxGeometry(0.26 * B, 0.3 * B, 0.2 * B), shirt)
        legs.position.y = 0.15 * B
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3 * B, 0.35 * B, 0.22 * B), body)
        torso.position.y = 0.47 * B
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.3 * B, 0.3 * B, 0.3 * B), body)
        top.position.y = 0.8 * B
        pin.add(legs, torso, top)
        for (const z of [-0.07, 0.07]) {
          const e = new THREE.Mesh(new THREE.BoxGeometry(0.03 * B, 0.06 * B, 0.06 * B), eye)
          e.position.set(-0.16 * B, 0.84 * B, z * B)
          pin.add(e)
        }
        this.arena.add(pin)
        this._pinMeshes.push(pin)
      }
      const ball = new THREE.Mesh(new THREE.BoxGeometry(BALL_R * 2 * B, BALL_R * 2 * B, BALL_R * 2 * B), lambert(0x4a2a8a))
      this._ballMesh = ball
      this.arena.add(ball)
    }
  }

  // --- what happened, on every screen ---

  _events() {
    const s = this.s
    const was = this._was
    const seeker = this.seekers.has(this.myId)
    if (this.phase !== was.phase || this.round !== was.round) {
      if (this.phase === 'wait') s._message(t('partyGetReady', { mode: this._modeName() }), 4)
      else if (this.phase === 'play') s._message(this._startText(), 5)
      else if (this.phase === 'end') this._roundOver()
    } else if (this.phase === 'play' && this.kind === 'hideSeek' && seeker && !was.seeker) s._message(t('partyFound'), 4)
    if (this.kind === 'hotPotato' && this.phase === 'play') {
      if (this.holder === this.myId && was.holder !== this.myId && !this.out.has(this.myId)) {
        s._message(t('partyPotatoYouHave'), 3)
        try { audioEngine.playSpecial?.('warn') } catch { /* no audio */ }
      }
      // Someone new is out: a bang and confetti where they stand.
      for (const id of this.out) {
        if (was.out.has(id)) continue
        const p = this._people().find((q) => q.id === id)
        if (p) s._fx?.confetti?.(p.x * s.B, (p.y + 1.2) * s.B, p.z * s.B)
        try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
        if (id === this.myId) s._message(t('partyPotatoYouOut'), 4)
      }
    }
    if (this.kind === 'zombieBowling' && this.phase === 'play' && this.turn !== was.turn && this.turn === this.myId) s._message(t('partyBowlYourTurn', { s: TURN_S }), 4)
    if (this._say && this.runs) this._sayNow(this._say)
    this._say = null
    was.phase = this.phase
    was.round = this.round
    was.seeker = seeker
    was.holder = this.holder
    was.out = new Set(this.out)
    was.turn = this.turn
  }

  _sayNow({ k, team, name, n }) {
    this.s._message(t(k, { team: t(team === 'r' ? 'partyRed' : 'partyBlue'), name: name ? this._name(name) : '', n }), 3)
  }

  _modeName() {
    return t(`topBarMode${this.kind[0].toUpperCase()}${this.kind.slice(1)}`)
  }

  _startText() {
    const tm = this.myTeam
    const team = tm ? t(tm === 'r' ? 'partyRed' : 'partyBlue') : ''
    if (this.kind === 'hideSeek') return t(this.seekers.has(this.myId) ? 'partyYouSeek' : 'partyYouHide', { n: HIDE_S })
    if (this.kind === 'captureFlag') return t('partyFlagStart', { team, n: CAPS_TO_WIN })
    if (this.kind === 'kingHill') return t('partyHillStart', { n: HILL_POINTS })
    if (this.kind === 'hotPotato') return t('partyPotatoStart')
    if (this.kind === 'zombieBowling') return t('partyBowlStart', { n: ROLLS })
    return t('partySoccerStart', { team, n: GOALS_TO_WIN })
  }

  _won() {
    const w = this.winner
    const me = this.myId
    if (this.kind === 'hideSeek') return (w === 'h' && !this.seekers.has(me)) || (w === 's' && this.seekers.has(me))
    if (ID_SCORE_MODES.has(this.kind)) return w === me
    return !!w && w === this.myTeam
  }

  _roundOver() {
    const game = this.s.bm.game
    const won = this._won()
    if (won && game) {
      game.coins = (game.coins || 0) + WIN_COINS
      saveShopProgress(game)
      game._renderCurrencyBar?.()
    }
    const w = this.winner
    let who
    if (w === 'tie') who = t('partyTie')
    else if (this.kind === 'hideSeek') who = t(w === 's' ? 'partySeekersWin' : 'partyHidersWin')
    else if (this.kind === 'kingHill') who = t('partyKingWins', { name: this._name(w) })
    else if (ID_SCORE_MODES.has(this.kind)) who = t('partyPlayerWins', { name: this._name(w) })
    else who = t('partyTeamWins', { team: t(w === 'r' ? 'partyRed' : 'partyBlue') })
    this.s._message(`${who}${won ? ` ${t('partyYouWon', { n: WIN_COINS })}` : ''}`, END_S - 1)
  }

  _name(id) {
    if (id === this.myId) return t('partyYou')
    const b = this.bots.get(id)
    if (b) return BOT_NAMES[(b.n - 1) % BOT_NAMES.length]
    return String(this.s.net?.players.get(id)?.nick || '?').slice(0, 20)
  }

  // The line at the top of the screen.
  hudText() {
    const time = `${Math.floor(this.left / 60)}:${String(Math.floor(this.left % 60)).padStart(2, '0')}`
    const name = this._modeName()
    if (this.phase === 'wait') return `${name} · ${t('infectionStartsIn', { n: Math.ceil(this.left) })}`
    let mid
    if (this.kind === 'hideSeek') {
      const people = this._people()
      mid = t('partyHideCounts', { h: people.filter((p) => !this.seekers.has(p.id)).length, s: this.seekers.size })
      if (this.phase === 'play') mid += ` · ${t(this.seekers.has(this.myId) ? 'partySeeker' : 'partyHider')}`
    } else if (this.kind === 'kingHill') {
      mid = t('partyHillScore', { n: this.score[this.myId] || 0, max: HILL_POINTS })
    } else if (this.kind === 'hotPotato') {
      const left = this._people().filter((p) => !this.out.has(p.id)).length
      mid = t('partyPotatoHud', { name: this.holder ? this._name(this.holder) : '-', n: left })
      if (this.out.has(this.myId)) mid += ` · ${t('partyPotatoOutTag')}`
    } else if (this.kind === 'zombieBowling') {
      mid = t('partyBowlHud', { name: this.turn ? this._name(this.turn) : '-', n: this.score[this.myId] || 0, r: Math.min(ROLLS, (this.rolls[this.myId] || 0) + (this.turn === this.myId ? 1 : 0)), max: ROLLS })
    } else {
      mid = `${t('partyRed')} ${this.score.r || 0} - ${this.score.b || 0} ${t('partyBlue')}`
      if (this.myTeam) mid += ` · ${t('partyYourTeam', { team: t(this.myTeam === 'r' ? 'partyRed' : 'partyBlue') })}`
    }
    return `${name} · ${mid} · ${time}`
  }

  // --- shots ---

  // My shot (BuildSurvival.shoot). Flag / Hill: stuns the first enemy on
  // the ray. Soccer: knocks the ball. Hide and Seek: nothing.
  shoot(ray, reach) {
    if (this.phase !== 'play' || this.stunned.has(this.myId)) return false
    const B = this.s.B
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    if (this.kind === 'hotPotato') return false
    if (this.kind === 'zombieSoccer' || this.kind === 'zombieBowling') {
      if (this.kind === 'zombieBowling' && this.turn !== this.myId) return false
      const b = this.ball
      box.min.set((b.x - BALL_R) * B, b.y * B, (b.z - BALL_R) * B)
      box.max.set((b.x + BALL_R) * B, (b.y + BALL_R * 2) * B, (b.z + BALL_R) * B)
      if (!ray.intersectBox(box, hit) || hit.distanceTo(ray.origin) > reach || !this.runs) return false
      b.vx += ray.direction.x * SHOT_KICK
      b.vz += ray.direction.z * SHOT_KICK
      b.vy = this.kind === 'zombieBowling' ? 1 : 4
      if (this.kind === 'zombieBowling') this.rolled = true
      return true
    }
    if (this.kind === 'hideSeek') return false
    let best = null
    let bestD = reach
    const myTeam = this.myTeam
    for (const p of this._people()) {
      if (p.id === this.myId || (myTeam && this.teams.get(p.id) === myTeam)) continue
      box.min.set((p.x - 0.4) * B, p.y * B, (p.z - 0.4) * B)
      box.max.set((p.x + 0.4) * B, (p.y + MOB_HEIGHT) * B, (p.z + 0.4) * B)
      if (!ray.intersectBox(box, hit)) continue
      const d = hit.distanceTo(ray.origin)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    if (!best) return false
    if (this.runs) this.stun(best.id)
    else {
      this.s.net.queueHit(`s${best.id}`, 0)
      this.stunned.set(best.id, STUN_S)
    }
    return true
  }

  stun(id) {
    this.stunned.set(id, STUN_S)
    this._dropFlags(id)
  }

  // A guest's stun shot (BuildSurvival._applyRemoteHits).
  remoteHit(h) {
    if (this.kind === 'captureFlag' || this.kind === 'kingHill') this.stun(String(h.id).slice(1))
  }

  // --- the server ---

  snapshot() {
    const bots = {}
    for (const b of this.bots.values()) bots[b.id] = { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), h: +b.tyaw.toFixed(2), n: b.n }
    const st = {}
    for (const [id, left] of this.stunned) st[this._out(id)] = +left.toFixed(1)
    const tm = {}
    for (const [id, team] of this.teams) tm[this._out(id)] = team
    const sc = {}
    for (const [id, n] of Object.entries(this.score)) sc[this._out(id)] = n
    const fl = {}
    for (const [k, f] of Object.entries(this.flags)) fl[k] = { a: f.at, by: this._out(f.by), x: +f.x.toFixed(2), y: +f.y.toFixed(2), z: +f.z.toFixed(2) }
    const b = this.ball
    return {
      k: this.kind,
      ph: this.phase,
      t: +this.left.toFixed(1),
      r: this.round,
      w: this._out(this.winner),
      h: this.home ? [this.home.x, this.home.y, this.home.z] : null,
      tm,
      sk: [...this.seekers].map((id) => this._out(id)),
      st,
      sc,
      fl,
      kg: this._out(this.king || ''),
      ball: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)],
      bots,
      ho: this._out(this.holder),
      fu: +this.fuse.toFixed(1),
      ou: [...this.out].map((id) => this._out(id)),
      tu: this._out(this.turn),
      ro: Object.fromEntries(Object.entries(this.rolls).map(([id, n]) => [this._out(id), n])),
      pd: this.pinsDown.reduce((m, down, i) => m | (down ? 1 << i : 0), 0),
    }
  }

  // 'me' (before there's a server id) goes out as my real id.
  _out(id) {
    return id === 'me' ? this.myId : id
  }

  applySnapshot(d) {
    if (!d || typeof d !== 'object' || d.k !== this.kind) return
    const ok = (id) => typeof id === 'string' && ID_RE.test(id)
    this.phase = ['wait', 'play', 'end'].includes(d.ph) ? d.ph : 'wait'
    this.left = Number(d.t) || 0
    this.round = Number(d.r) || 1
    this.winner = typeof d.w === 'string' && (ok(d.w) || ['r', 'b', 'h', 's', 'tie'].includes(d.w)) ? d.w : ''
    this.home = Array.isArray(d.h) && d.h.length === 3 && d.h.every(Number.isFinite) ? { x: d.h[0], y: d.h[1], z: d.h[2] } : null
    this.teams = new Map(Object.entries(d.tm || {}).filter(([id, v]) => ok(id) && (v === 'r' || v === 'b')))
    this.seekers = new Set([].concat(d.sk || []).filter(ok))
    this.stunned = new Map(Object.entries(d.st || {}).filter(([id]) => ok(id)).map(([id, left]) => [id, Number(left) || 0]))
    this.score = Object.fromEntries(Object.entries(d.sc || {}).filter(([id, n]) => (ok(id) || id === 'r' || id === 'b') && Number.isFinite(n)))
    for (const k of ['r', 'b']) {
      const f = d.fl?.[k]
      if (f && Number.isFinite(f.x)) Object.assign(this.flags[k], { at: ['base', 'carried', 'down'].includes(f.a) ? f.a : 'base', by: ok(f.by) ? f.by : '', x: f.x, y: f.y, z: f.z })
    }
    this.king = ok(d.kg) ? d.kg : ''
    this.holder = ok(d.ho) ? d.ho : ''
    this.fuse = Number(d.fu) || 0
    this.out = new Set([].concat(d.ou || []).filter(ok))
    this.turn = ok(d.tu) ? d.tu : ''
    this.rolls = Object.fromEntries(Object.entries(d.ro || {}).filter(([id, n]) => ok(id) && Number.isFinite(n)))
    const pd = Number(d.pd) || 0
    for (let i = 0; i < PINS; i++) this.pinsDown[i] = !!(pd & (1 << i))
    if (Array.isArray(d.ball) && d.ball.every(Number.isFinite)) {
      // Glides to where the host has it.
      const b = this.ball
      b.vx = (d.ball[0] - b.x) * 4
      b.vz = (d.ball[2] - b.z) * 4
      ;[b.x, b.y, b.z] = d.ball
    }
    const seen = new Set()
    for (const [id, v] of Object.entries(d.bots || {})) {
      if (!/^b\d{1,4}$/.test(id) || !v) continue
      seen.add(id)
      const b = this.bots.get(id) || this._addBot(id, { x: v.x, y: v.y, z: v.z, n: Number(v.n) || 1 })
      b.tx = v.x
      b.ty = v.y
      b.tz = v.z
      b.tyaw = Number(v.h) || 0
      this._botN = Math.max(this._botN, Number(id.slice(1)))
    }
    for (const id of [...this.bots.keys()]) if (!seen.has(id)) this._removeBot(id)
  }

  dispose() {
    for (const id of [...this.bots.keys()]) this._removeBot(id)
    for (const m of this._marks.values()) {
      m.removeFromParent()
      m.geometry.dispose()
      m.material.dispose()
    }
    this._marks.clear()
    disposeTree(this.arena)
    this.arena.removeFromParent()
    this.s.bm.tryMode.speedMult = this._baseSpeed
    this._blind.remove()
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return
    o.geometry?.dispose?.()
    for (const m of [].concat(o.material)) {
      if (o.isSprite) m.map?.dispose?.()
      m.dispose?.()
    }
  })
}
