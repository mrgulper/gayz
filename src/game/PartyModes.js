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
// - paintWars (Paint Wars, 2026-11-02, idea list 5): Red against Blue.
//   Every shot splats your team's paint on the ground where it lands
//   (SPLAT_R blocks round), inside PAINT_R blocks of the middle; painting
//   over the other team's colour takes it back. The team covering the
//   most ground when the time runs out wins.
// - buildBattle (Build Battle, 2026-11-02, idea list 5): everyone gets a
//   plot (PLOT x PLOT) on a white platform high in the sky (BB_Y, built
//   on every screen like Tower Defense's map) and BUILD_S seconds to build
//   something on a theme, with a free set of blocks (BB_PALETTE). Then
//   everyone visits each plot in turn (VOTE_S each) and gives it 1-5 stars
//   (keys 1-5 or the buttons; not your own). Bots build one of a few
//   shapes and vote too. The most stars wins.
//
// More modes live in their own files and plug in through `this.ext`
// (PARTY_EXT, 2026-11-02, idea list 6): Floor is Lava (PartyLava.js), Laser
// Tag (PartyLaser.js), Kart Racing (PartyKart.js), Obstacle Course
// (PartyParkour.js), Duel Arena (PartyDuel.js); idea list 7 (2026-11-06):
// Zombie Mini-Golf (PartyGolf.js), Freeze Tag (PartyFreeze.js), Bomb
// Defuse (PartyBomb.js), Werewolf Night (PartyWerewolf.js).
// An ext can give: home(me), begin(people, shuffled), run(people, dt),
// timeUp(), botGoal(b, people), moveBot(b, dt), botsStun, markColor(id),
// build(), draw(dt), events(was), startText(), hud(), shoot(ray, reach,
// wall), onStun(id, by), remoteHit(h), protects(x, y, z), speed(),
// won() / winText(w) (its own winners), snap() / apply(d) (its part of
// the host's sync) and dispose().
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
import { PartyLava } from './PartyLava.js'
import { PartyLaser } from './PartyLaser.js'
import { PartyKart } from './PartyKart.js'
import { PartyParkour } from './PartyParkour.js'
import { PartyDuel } from './PartyDuel.js'
import { PartyGolf } from './PartyGolf.js'
import { PartyFreeze } from './PartyFreeze.js'
import { PartyBomb } from './PartyBomb.js'

// The modes that live in their own files (see `this.ext` above).
const PARTY_EXT = { floorLava: PartyLava, laserTag: PartyLaser, kartRace: PartyKart, obstacleCourse: PartyParkour, duelArena: PartyDuel, miniGolf: PartyGolf, freezeTag: PartyFreeze, bombDefuse: PartyBomb }
export const PARTY_MODES = ['hideSeek', 'captureFlag', 'kingHill', 'zombieSoccer', 'hotPotato', 'zombieBowling', 'paintWars', 'buildBattle', 'floorLava', 'laserTag', 'kartRace', 'obstacleCourse', 'duelArena', 'miniGolf', 'freezeTag', 'bombDefuse']
// Each mode's server mode (api/_lib/servers.js MODES).
export const PARTY_SERVER_MODES = { hideSeek: 'hide', captureFlag: 'ctf', kingHill: 'koth', zombieSoccer: 'soccer', hotPotato: 'potato', zombieBowling: 'bowling', paintWars: 'paint', buildBattle: 'build', floorLava: 'lava', laserTag: 'laser', kartRace: 'kart', obstacleCourse: 'parkour', duelArena: 'duel', miniGolf: 'golf', freezeTag: 'freeze', bombDefuse: 'bomb' }
export const TOTAL = 6
export const WAIT_S = 8
export const END_S = 7
export const ROUND_S = { hideSeek: 150, captureFlag: 300, kingHill: 240, zombieSoccer: 240, hotPotato: 300, zombieBowling: 300, paintWars: 150, buildBattle: 300, floorLava: 240, laserTag: 180, kartRace: 300, obstacleCourse: 420, duelArena: 120, miniGolf: 240, freezeTag: 150, bombDefuse: 150 }
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
export const PAINT_R = 16
const SPLAT_R = 1.6
const BOT_PAINT_EVERY = [0.45, 1]
export const BUILD_S = 300
export const VOTE_S = 8
export const PLOT = 9
const PLOT_GAP = 3
const PLOTS = 8 // 2 rows of 4
const PLOT_H = 14 // how high you can build
export const BB_Y = 220
export const BB_PALETTE = ['oak', 'stonebricks', 'glass', 'concrete', 'redsandstone', 'quartz', 'oaklog', 'birchleaves', 'sealantern', 'prismarinebricks', 'terracotta', 'pumpkin']
export const BB_THEMES = ['house', 'castle', 'tree', 'monster', 'rocket', 'boat', 'tower', 'animal', 'car', 'statue']
const BB_STACK = 64
const ID_SCORE_MODES = new Set(['kingHill', 'hotPotato', 'zombieBowling', 'buildBattle', 'floorLava'])
const TEAM_MODES = new Set(['captureFlag', 'zombieSoccer', 'paintWars'])
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
    this.paint = new Map() // Paint Wars: "x,z" -> 'r' | 'b'
    this._paintDirty = true
    this.sub = '' // Build Battle: 'build' | 'vote'
    this.theme = 0
    this.plots = new Map() // id -> plot number
    this.voteI = 0
    this.votes = {} // owner id -> { voter id: stars }
    this.myVote = 0
    this._platformFor = ''
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
    this.ext = PARTY_EXT[kind] ? new PARTY_EXT[kind](this) : null
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
    if (this.kind === 'buildBattle') {
      if (this.home) this._platform()
      // A new round on a guest's screen: the plots empty out.
      if (!this.runs && this.sub === 'build' && this._clearedFor !== this.round) this._clearPlots(false)
      this._clearedFor = this.sub === 'build' ? this.round : this._clearedFor
      this._bbPlace()
      this._bbBag()
      this._renderVote()
    }
    const voting = this.kind === 'buildBattle' && this.phase === 'play' && this.sub === 'vote'
    const frozen = (this.kind === 'hideSeek' && this.phase === 'play' && this.seekers.has(me) && this._hiding()) || voting
    s.bm.tryMode.speedMult = this._baseSpeed * (frozen ? 0 : this.stunned.has(me) ? STUN_SPEED : 1) * (this.ext?.speed?.() ?? 1)
    this._blind.className = frozen && !voting ? 'on' : ''
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
      this._fillBots(Math.max(0, (this.ext?.total ?? TOTAL) - real))
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
    if (TEAM_MODES.has(this.kind) || this.ext?.teams) for (const p of people) if (!this.teams.has(p.id)) this.teams.set(p.id, this._smallerTeam())
    this.left -= dt
    if (this.kind === 'hideSeek') this._runHide(people)
    else if (this.kind === 'captureFlag') this._runFlags(people)
    else if (this.kind === 'kingHill') this._runHill(people, dt)
    else if (this.kind === 'hotPotato') this._runPotato(people, dt)
    else if (this.kind === 'zombieBowling') this._runBowl(people, dt)
    else if (this.kind === 'paintWars') this._runPaint(people, dt)
    else if (this.kind === 'buildBattle') this._runBuild(people)
    else if (this.ext) this.ext.run(people, dt)
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
    // Build Battle: the same platform in the sky, round after round.
    if (this.kind === 'buildBattle') this.home = this._bbHome || (this._bbHome = { x: Math.round(me.x), y: BB_Y + 1, z: Math.round(me.z) })
    if (this.ext?.home) this.home = this.ext.home(me)
    this.phase = 'play'
    this.left = ROUND_S[this.kind]
    this.stunned.clear()
    this.teams.clear()
    this.seekers.clear()
    this.score = {}
    const people = this._people()
    const shuffled = people.map((p) => p.id).sort(() => Math.random() - 0.5)
    if (TEAM_MODES.has(this.kind) || this.ext?.teams) {
      shuffled.forEach((id, i) => this.teams.set(id, i % 2 ? 'b' : 'r'))
      this.score = { r: 0, b: 0 }
    }
    if (this.kind === 'hideSeek') for (const id of shuffled.slice(0, people.length >= 6 ? 2 : 1)) this.seekers.add(id)
    if (this.kind === 'captureFlag') for (const tm of ['r', 'b']) this._flagHome(tm)
    if (this.kind === 'zombieSoccer') this._ballHome()
    this.out.clear()
    if (this.kind === 'hotPotato') this._newBomb(people)
    if (this.kind === 'paintWars') {
      this.paint.clear()
      this._paintDirty = true
    }
    if (this.kind === 'buildBattle') {
      this.sub = 'build'
      this.theme = Math.floor(Math.random() * BB_THEMES.length)
      this.plots.clear()
      shuffled.forEach((id, i) => this.plots.set(id, i % PLOTS))
      this.votes = {}
      this.voteI = 0
      for (const id of shuffled) this.score[id] = 0
      this._clearPlots(true)
    }
    if (this.kind === 'zombieBowling') {
      this.order = shuffled
      this.rolls = {}
      for (const id of shuffled) this.score[id] = 0
      this._startTurn(shuffled[0])
    }
    this.ext?.begin?.(people, shuffled)
    // Bots start at their own end (team modes) or scattered.
    for (const b of this.bots.values()) {
      const tm = this.teams.get(b.id)
      const at = tm ? this.spot(tm) : null
      if (this.ext?.placeBot) this.ext.placeBot(b)
      else if (at) this._place(b, at.x + (Math.random() - 0.5) * 4, at.z + (Math.random() - 0.5) * 4)
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
    if (this.ext?.timeUp) return this.ext.timeUp()
    if (this.kind === 'hideSeek') return this._end('h')
    if (this.kind === 'hotPotato') return this._end('tie')
    if (this.kind === 'paintWars') {
      const [r, b] = this.paintCounts()
      return this._end(r === b ? 'tie' : r > b ? 'r' : 'b')
    }
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

  // --- Paint Wars ---

  inArena(x, z) {
    return !!this.home && Math.hypot(x + 0.5 - this.home.x, z + 0.5 - this.home.z) <= PAINT_R
  }

  // Paint a splat for team `tm` round (x, z) (blocks).
  splat(x, z, tm) {
    if (tm !== 'r' && tm !== 'b') return
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const cx = Math.floor(x) + dx
        const cz = Math.floor(z) + dz
        if (Math.hypot(cx + 0.5 - x, cz + 0.5 - z) > SPLAT_R || !this.inArena(cx, cz)) continue
        const k = `${cx},${cz}`
        if (this.paint.get(k) !== tm) {
          this.paint.set(k, tm)
          this._paintDirty = true
        }
      }
    }
  }

  paintCounts() {
    let r = 0
    let b = 0
    for (const v of this.paint.values()) v === 'r' ? r++ : b++
    return [r, b]
  }

  _runPaint(people, dt) {
    // Bots fire paint ahead of them now and then.
    for (const b of this.bots.values()) {
      b.paintIn = (b.paintIn ?? 0) - dt
      if (b.paintIn > 0) continue
      b.paintIn = BOT_PAINT_EVERY[0] + Math.random() * (BOT_PAINT_EVERY[1] - BOT_PAINT_EVERY[0])
      const d = 3 + Math.random() * 6
      const a = b.tyaw + (Math.random() - 0.5) * 0.8
      this.splat(b.x + Math.sin(a) * d, b.z + Math.cos(a) * d, this.teams.get(b.id))
    }
  }

  // The painted ground as a string (the server sync): one letter a cell,
  // row by row over the arena's square.
  _paintCode() {
    if (!this.home) return ''
    const R = PAINT_R
    const hx = Math.floor(this.home.x)
    const hz = Math.floor(this.home.z)
    let out = ''
    for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) out += this.paint.get(`${hx + x},${hz + z}`) || '0'
    return out.replace(/0+$/, '')
  }

  _paintFrom(code) {
    if (typeof code !== 'string' || !this.home) return
    const R = PAINT_R
    const W = R * 2 + 1
    const hx = Math.floor(this.home.x)
    const hz = Math.floor(this.home.z)
    const next = new Map()
    for (let i = 0; i < code.length && i < W * W; i++) {
      const c = code[i]
      if (c === 'r' || c === 'b') next.set(`${hx + (i % W) - R},${hz + Math.floor(i / W) - R}`, c)
    }
    if (next.size !== this.paint.size || [...next].some(([k, v]) => this.paint.get(k) !== v)) {
      this.paint = next
      this._paintDirty = true
    }
  }

  // The painted cells: one flat square each, on the ground's top.
  _drawPaint() {
    const B = this.s.B
    if (!this._paintMesh) {
      const max = (PAINT_R * 2 + 1) ** 2
      const geo = new THREE.PlaneGeometry(B, B).rotateX(-Math.PI / 2)
      this._paintMesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), max)
      this._paintMesh.frustumCulled = false
      this._paintMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.arena.add(this._paintMesh)
      this._groundY = new Map()
    }
    if (!this._paintDirty) return
    this._paintDirty = false
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    let i = 0
    for (const [k, tm] of this.paint) {
      let y = this._groundY.get(k)
      const [x, z] = k.split(',').map(Number)
      if (y === undefined) {
        y = this.s._groundUnder(x + 0.5, this.home.y + 6, z + 0.5)
        this._groundY.set(k, y)
      }
      m.makeTranslation((x + 0.5) * B, (y + 0.02) * B, (z + 0.5) * B)
      this._paintMesh.setMatrixAt(i, m)
      this._paintMesh.setColorAt(i, c.set(TEAM_COLORS[tm]))
      i++
    }
    this._paintMesh.count = i
    this._paintMesh.instanceMatrix.needsUpdate = true
    if (this._paintMesh.instanceColor) this._paintMesh.instanceColor.needsUpdate = true
  }

  // --- Build Battle ---

  // Plot n's corner (its lowest x, z) and floor height.
  plotAt(n) {
    const h = this.home
    const step = PLOT + PLOT_GAP
    return { x: Math.floor(h.x + ((n % 4) - 2) * step + PLOT_GAP / 2), y: BB_Y, z: Math.floor(h.z + (Math.floor(n / 4) - 1) * step + PLOT_GAP / 2) }
  }

  _plotOf(x, z) {
    if (!this.home) return -1
    for (let n = 0; n < PLOTS; n++) {
      const p = this.plotAt(n)
      if (x >= p.x && x < p.x + PLOT && z >= p.z && z < p.z + PLOT) return n
    }
    return -1
  }

  _inPlatform(x, y, z) {
    if (!this.home || y < BB_Y - 1 || y > BB_Y + PLOT_H + 1) return false
    const step = PLOT + PLOT_GAP
    return Math.abs(x + 0.5 - this.home.x) <= step * 2 + 1 && Math.abs(z + 0.5 - this.home.z) <= step + 1
  }

  // BuildSurvival: may this block be placed / broken? Only inside your
  // own plot while building.
  protects(x, y, z) {
    if (this.ext) return !!this.ext.protects?.(x, y, z)
    if (this.kind !== 'buildBattle' || !this.home) return false
    if (!this._inPlatform(x, y, z)) return false
    if (y <= BB_Y) return true
    return !(this.phase === 'play' && this.sub === 'build' && this._plotOf(x, z) === this.plots.get(this.myId))
  }

  // The platform: real blocks, put in on every screen (gone at the end).
  _platform() {
    const key = this.home ? `${this.home.x},${this.home.z}` : ''
    if (!key || this._platformFor === key) return
    this._platformFor = key
    const s = this.s
    const bm = s.bm
    const step = PLOT + PLOT_GAP
    bm._suppressUndoRecording = true
    for (let x = Math.floor(this.home.x - step * 2 - 1); x <= this.home.x + step * 2 + 1; x++) {
      for (let z = Math.floor(this.home.z - step - 1); z <= this.home.z + step + 1; z++) {
        const type = this._plotOf(x, z) >= 0 ? 'smoothquartz' : 'polishedtuff'
        if (bm.getBlockAt(x, BB_Y, z) === type) continue
        bm.placeBlock(x, BB_Y, z, type, true)
        s._placed.set(bm._key(x, BB_Y, z), type)
      }
    }
    bm._suppressUndoRecording = false
  }

  // Everything built on the plots goes (a new round).
  _clearPlots(record) {
    if (!this.home) return
    this._platform()
    const s = this.s
    const bm = s.bm
    bm._suppressUndoRecording = true
    for (let n = 0; n < PLOTS; n++) {
      const p = this.plotAt(n)
      for (let x = p.x; x < p.x + PLOT; x++) for (let z = p.z; z < p.z + PLOT; z++) for (let y = BB_Y + 1; y <= BB_Y + PLOT_H; y++) {
        if (!bm.getBlockAt(x, y, z)) continue
        bm.removeBlock(x, y, z)
        s._placed.delete(bm._key(x, y, z))
        if (record && this.runs) s._recordEdit(x, y, z, '')
      }
    }
    bm._suppressUndoRecording = false
    for (const b of this.bots.values()) b.built = 0
  }

  _plotOrder() {
    return [...this.plots.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
  }

  _voteOwner() {
    return this._plotOrder()[this.voteI] || ''
  }

  _runBuild(people) {
    const here = new Set(people.map((p) => p.id))
    // Someone who joined mid-round gets a free plot.
    for (const p of people) {
      if (this.plots.has(p.id)) continue
      const used = new Set(this.plots.values())
      for (let n = 0; n < PLOTS; n++) if (!used.has(n)) {
        this.plots.set(p.id, n)
        this.score[p.id] = this.score[p.id] || 0
        break
      }
    }
    if (this.sub === 'build') {
      for (const b of this.bots.values()) this._botBuild(b)
      if (this.left <= 0) {
        this.sub = 'vote'
        this.voteI = 0
        this.left = VOTE_S
      }
      return
    }
    // Voting: bots give their stars a moment in.
    const owner = this._voteOwner()
    if (owner && this.left < VOTE_S - 2) {
      for (const b of this.bots.values()) {
        if (b.id === owner) continue
        const v = (this.votes[owner] ||= {})
        if (v[b.id]) continue
        v[b.id] = 2 + Math.floor(Math.random() * 3) + (this._plotBlocks(this.plots.get(owner)) > 20 && Math.random() < 0.5 ? 1 : 0)
      }
    }
    if (this.left > 0) return
    // Stars for this plot.
    if (owner && here.has(owner)) this.score[owner] = Object.values(this.votes[owner] || {}).reduce((a, n) => a + Math.max(1, Math.min(5, n)), 0)
    this.voteI++
    this.left = VOTE_S
    if (this.voteI >= this._plotOrder().length) {
      this.left = 0.001
      this.sub = ''
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
  }

  _plotBlocks(n) {
    if (n === undefined) return 0
    const p = this.plotAt(n)
    const bm = this.s.bm
    let k = 0
    for (let x = p.x; x < p.x + PLOT; x++) for (let z = p.z; z < p.z + PLOT; z++) for (let y = BB_Y + 1; y <= BB_Y + 8; y++) if (bm.getBlockAt(x, y, z)) k++
    return k
  }

  // A bot builds its shape a block at a time over most of the build time.
  _botBuild(b) {
    const n = this.plots.get(b.id)
    if (n === undefined) return
    const p = this.plotAt(n)
    const shape = (b.shape ||= botShape(BB_THEMES[this.theme]))
    const due = Math.floor(shape.length * Math.min(1, (BUILD_S - this.left) / (BUILD_S * 0.75)))
    const s = this.s
    const bm = s.bm
    while ((b.built || 0) < due) {
      const [dx, dy, dz, type] = shape[b.built || 0]
      b.built = (b.built || 0) + 1
      const x = p.x + dx
      const y = BB_Y + 1 + dy
      const z = p.z + dz
      if (bm.getBlockAt(x, y, z)) continue
      bm._suppressUndoRecording = true
      bm.placeBlock(x, y, z, type, true)
      bm._suppressUndoRecording = false
      s._placed.set(bm._key(x, y, z), type)
      s._recordEdit(x, y, z, type)
    }
  }

  // My stars for the plot on show (keys 1-5 / the buttons).
  vote(stars) {
    if (this.kind !== 'buildBattle' || this.phase !== 'play' || this.sub !== 'vote') return
    const owner = this._voteOwner()
    if (!owner || owner === this.myId) return
    stars = Math.max(1, Math.min(5, Math.round(stars)))
    this.myVote = stars
    this._votedFor = owner
    if (this.runs) (this.votes[owner] ||= {})[this.myId] = stars
    else this.s.net?.queueHit(`v${owner}`, stars)
    this._renderVote()
  }

  // Where I am during Build Battle: on my plot to build, in front of
  // the plot on show to vote; off the edge, back on my plot.
  _bbPlace() {
    const s = this.s
    const tm = s.bm.tryMode
    if (!this.home || !tm?.active) return
    const want = this.phase === 'play' ? this.sub : ''
    const voteOwner = want === 'vote' ? this._voteOwner() : ''
    const key = `${this.round},${want},${voteOwner}`
    const fell = tm.pos.y < BB_Y - 6
    if (this._bbAt === key && !fell) return
    this._bbAt = key
    const mine = this.plots.get(this.myId)
    const n = want === 'vote' ? this.plots.get(voteOwner) : mine
    const p = this.plotAt(n ?? 0)
    const B = s.B
    const x = p.x + PLOT / 2
    const z = want === 'vote' ? p.z - 2 : p.z + PLOT / 2
    tm.pos.set(x, BB_Y + 1, z)
    tm.vel?.set(0, 0, 0)
    s.bm.camera.position.set(x * B, (BB_Y + 1 + 1.62) * B, z * B)
    if (want === 'vote') {
      s.bm._yaw = Math.PI
      s.bm._pitch = -0.25
    }
  }

  // The palette of blocks while building (my own bag comes back after).
  _bbBag() {
    const inv = this.s.inv
    if (!inv) return
    const building = this.kind === 'buildBattle' && this.phase === 'play' && this.sub === 'build'
    if (building && !this._savedBag) {
      this._savedBag = { hotbar: inv.hotbar.map((it) => (it ? { ...it } : null)), grid: inv.grid.map((it) => (it ? { ...it } : null)) }
      inv.hotbar.fill(null)
      inv.grid.fill(null)
      for (const id of BB_PALETTE) inv.add({ kind: 'block', id, n: BB_STACK })
      inv.select(0)
      this.s._message(t('bbStart', { theme: t(`bbTheme_${BB_THEMES[this.theme]}`), n: Math.round(BUILD_S / 60) }), 6)
    } else if (!building && this._savedBag) {
      this._restoreBag()
    }
    // Plenty of each, always.
    if (building) for (const it of inv.hotbar) if (it?.kind === 'block' && it.n < 8) it.n = BB_STACK
  }

  _restoreBag() {
    const inv = this.s.inv
    if (!inv || !this._savedBag) return
    inv.hotbar.splice(0, inv.hotbar.length, ...this._savedBag.hotbar)
    inv.grid.splice(0, inv.grid.length, ...this._savedBag.grid)
    this._savedBag = null
    inv.apply?.()
    inv.renderHotbar?.()
  }

  // The star buttons while voting.
  _renderVote() {
    const on = this.kind === 'buildBattle' && this.phase === 'play' && this.sub === 'vote'
    if (!on) {
      if (this._voteEl) {
        this._voteEl.remove()
        this._voteEl = null
        window.removeEventListener('keydown', this._voteKey, true)
      }
      return
    }
    if (!this._voteEl) {
      const el = document.createElement('div')
      el.id = 'bb-vote'
      const title = document.createElement('div')
      title.className = 'bb-vote-title'
      el.appendChild(title)
      const row = document.createElement('div')
      row.className = 'bb-vote-stars'
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = '★'
        b.dataset.n = String(i)
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          this.vote(i)
        })
        row.appendChild(b)
      }
      el.appendChild(row)
      document.body.appendChild(el)
      this._voteEl = el
      this._voteKey = (e) => {
        const m = /^(?:Digit|Numpad)([1-5])$/.exec(e.code)
        if (!m) return
        e.preventDefault()
        e.stopPropagation()
        this.vote(Number(m[1]))
      }
      window.addEventListener('keydown', this._voteKey, true)
    }
    const owner = this._voteOwner()
    if (this._votedFor !== owner) this.myVote = 0
    const mine = owner === this.myId
    this._voteEl.querySelector('.bb-vote-title').textContent = mine ? t('bbYourPlot') : t('bbVoteFor', { name: this._name(owner) })
    this._voteEl.classList.toggle('mine', mine)
    for (const b of this._voteEl.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.n) <= this.myVote)
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
    if (this.ext) return this.ext.botGoal?.(b, people) ?? null
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
    if (this.kind === 'paintWars') {
      // Somewhere in the arena that isn't my colour yet.
      if (!b.paintGoal || Math.hypot(b.paintGoal.x - b.x, b.paintGoal.z - b.z) < 1.5 || Math.random() < 0.004) {
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * PAINT_R * 0.9
        b.paintGoal = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r }
      }
      return b.paintGoal
    }
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
    if (this.kind === 'buildBattle' && this.home) {
      const n = this.plots.get(b.id)
      if (n === undefined) return
      const p = this.plotAt(n)
      const x = p.x + 1 + (b.n % 3) * 3
      const z = p.z - 0.8
      b.x = b.tx = x
      b.z = b.tz = z
      b.y = b.ty = BB_Y + 1
      b.tyaw = 0
      return
    }
    if (this.ext?.moveBot?.(b, dt)) return
    const goal = this._botGoal(b, people)
    // Bots stun enemies close by now and then (Flag and Hill).
    if (this.phase === 'play' && (this.kind === 'captureFlag' || this.kind === 'kingHill' || this.ext?.botsStun) && !this.stunned.has(b.id)) {
      b.shotIn -= dt
      if (b.shotIn <= 0) {
        b.shotIn = BOT_SHOT_EVERY[0] + Math.random() * (BOT_SHOT_EVERY[1] - BOT_SHOT_EVERY[0])
        const tm = this.teams.get(b.id)
        const target = people.find((p) => p.id !== b.id && (!tm || this.teams.get(p.id) !== tm) && Math.hypot(p.x - b.x, p.z - b.z) < BOT_SHOT_RANGE)
        if (target && Math.random() < 0.5) this.stun(target.id, b.id)
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
    if (this.ext?.markColor) return this.ext.markColor(id)
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
    if (this.kind === 'paintWars') this._drawPaint()
    this.ext?.draw?.()
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
    this._paintMesh = null
    this._paintDirty = true
    this.ext?.build?.()
    if (this.kind === 'paintWars') {
      // The arena's edge: a ring of little posts.
      const h = this.home
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2
        const x = h.x + Math.cos(a) * PAINT_R
        const z = h.z + Math.sin(a) * PAINT_R
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.2 * B, 1.2 * B, 0.2 * B), i % 2 ? lambert(TEAM_COLORS.r) : lambert(TEAM_COLORS.b))
        m.position.set(x * B, (this.s._groundUnder(x, h.y + 6, z) + 0.6) * B, z * B)
        this.arena.add(m)
      }
    } else if (this.kind === 'captureFlag') {
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
    this.ext?.events?.(was)
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
    if (this.ext) return this.ext.startText()
    if (this.kind === 'hideSeek') return t(this.seekers.has(this.myId) ? 'partyYouSeek' : 'partyYouHide', { n: HIDE_S })
    if (this.kind === 'captureFlag') return t('partyFlagStart', { team, n: CAPS_TO_WIN })
    if (this.kind === 'kingHill') return t('partyHillStart', { n: HILL_POINTS })
    if (this.kind === 'hotPotato') return t('partyPotatoStart')
    if (this.kind === 'zombieBowling') return t('partyBowlStart', { n: ROLLS })
    if (this.kind === 'paintWars') return t('partyPaintStart', { team })
    if (this.kind === 'buildBattle') return t('bbStart', { theme: t(`bbTheme_${BB_THEMES[this.theme]}`), n: Math.round(BUILD_S / 60) })
    return t('partySoccerStart', { team, n: GOALS_TO_WIN })
  }

  _won() {
    const w = this.winner
    const me = this.myId
    if (this.ext?.won) return this.ext.won()
    if (this.kind === 'hideSeek') return (w === 'h' && !this.seekers.has(me)) || (w === 's' && this.seekers.has(me))
    if (ID_SCORE_MODES.has(this.kind) || (this.ext && !this.ext.teams)) return w === me
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
    else if (this.ext?.winText) who = this.ext.winText(w)
    else if (this.kind === 'hideSeek') who = t(w === 's' ? 'partySeekersWin' : 'partyHidersWin')
    else if (this.kind === 'kingHill') who = t('partyKingWins', { name: this._name(w) })
    else if (ID_SCORE_MODES.has(this.kind) || (this.ext && !this.ext.teams)) who = t('partyPlayerWins', { name: this._name(w) })
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
    if (this.ext) mid = this.ext.hud()
    else if (this.kind === 'paintWars') {
      const [r, b] = this.paintCounts()
      const all = Math.max(1, r + b)
      mid = `${t('partyRed')} ${Math.round((r / all) * 100)}% - ${Math.round((b / all) * 100)}% ${t('partyBlue')}`
      if (this.myTeam) mid += ` · ${t('partyYourTeam', { team: t(this.myTeam === 'r' ? 'partyRed' : 'partyBlue') })}`
    } else if (this.kind === 'buildBattle') {
      const theme = t(`bbTheme_${BB_THEMES[this.theme] || 'house'}`)
      if (this.sub === 'vote') mid = t('bbHudVote', { theme, name: this._name(this._voteOwner() || ''), i: this.voteI + 1, n: this._plotOrder().length })
      else mid = t('bbHudBuild', { theme })
    } else if (this.kind === 'hideSeek') {
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
  shoot(ray, reach, wall = null, damage = 0) {
    if (this.phase !== 'play' || this.stunned.has(this.myId)) return false
    const B = this.s.B
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    if (this.ext?.shoot) return this.ext.shoot(ray, reach, wall, damage)
    if (this.kind === 'hotPotato' || this.kind === 'buildBattle') return false
    if (this.kind === 'paintWars') {
      // A splat where the shot lands on the ground.
      if (!wall || wall.t > reach) return false
      ray.at(wall.t + 0.01, hit)
      const x = hit.x / B
      const z = hit.z / B
      if (!this.inArena(Math.floor(x), Math.floor(z))) return false
      this.splat(x, z, this.myTeam)
      this._splatFx(x, hit.y / B, z, this.myTeam)
      if (!this.runs) this.s.net?.queueHit(`p${Math.floor(x)}_${Math.floor(z)}`, 0)
      return true
    }
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
    if (this.runs) this.stun(best.id, this.myId)
    else {
      this.s.net.queueHit(`s${best.id}`, 0)
      this.stunned.set(best.id, STUN_S)
    }
    return true
  }

  stun(id, by = '') {
    this.stunned.set(id, this.ext?.stunS ?? STUN_S)
    this._dropFlags(id)
    this.ext?.onStun?.(id, by)
  }

  // A guest's stun shot (BuildSurvival._applyRemoteHits).
  remoteHit(h) {
    const id = String(h.id)
    if (this.kind === 'paintWars' && id[0] === 'p') {
      const m = /^p(-?\d{1,6})_(-?\d{1,6})$/.exec(id)
      if (m) this.splat(Number(m[1]) + 0.5, Number(m[2]) + 0.5, this.teams.get(String(h.by)))
      return
    }
    if (this.kind === 'buildBattle' && id[0] === 'v') {
      const owner = id.slice(1)
      if (this.sub === 'vote' && owner === this._voteOwner() && h.by && h.by !== owner) (this.votes[owner] ||= {})[h.by] = Math.max(1, Math.min(5, Number(h.dmg) || 1))
      return
    }
    if (this.ext?.remoteHit) return this.ext.remoteHit(h)
    if (this.kind === 'captureFlag' || this.kind === 'kingHill' || this.ext?.botsStun) this.stun(id.slice(1), String(h.by || ''))
  }

  // A burst of paint drops where a shot landed.
  _splatFx(x, y, z, tm) {
    const s = this.s
    s._fx?.paint?.(x * s.B, (y + 0.3) * s.B, z * s.B, TEAM_COLORS[tm])
    try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
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
      pa: this.kind === 'paintWars' ? this._paintCode() : '',
      sb: this.sub,
      th: this.theme,
      vi: this.voteI,
      pl: Object.fromEntries([...this.plots].map(([id, n]) => [this._out(id), n])),
      x: this.ext?.snap?.() ?? null,
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
    if (this.kind === 'paintWars') this._paintFrom(d.pa || '')
    if (this.kind === 'buildBattle') {
      if (Array.isArray(d.h)) this._bbHome = this.home
      this.sub = ['build', 'vote'].includes(d.sb) ? d.sb : ''
      this.theme = Math.max(0, Math.min(BB_THEMES.length - 1, Number(d.th) || 0))
      this.voteI = Math.max(0, Number(d.vi) || 0)
      this.plots = new Map(Object.entries(d.pl || {}).filter(([id, n]) => ok(id) && Number.isInteger(n) && n >= 0 && n < PLOTS))
    }
    if (this.ext?.apply && d.x && typeof d.x === 'object') this.ext.apply(d.x)
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
    this.ext?.dispose?.()
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
    this._restoreBag()
    if (this._voteEl) {
      this._voteEl.remove()
      window.removeEventListener('keydown', this._voteKey, true)
    }
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

// A bot's build for a theme: [dx, dy, dz, block] inside a PLOT x PLOT plot,
// bottom up.
function botShape(theme) {
  const out = []
  const put = (x, y, z, type) => out.push([x, y, z, type])
  if (['tree', 'animal', 'monster'].includes(theme)) {
    for (let y = 0; y < 4; y++) put(4, y, 4, 'oaklog')
    for (let y = 3; y < 7; y++) for (let x = 2; x <= 6; x++) for (let z = 2; z <= 6; z++) {
      if (Math.hypot(x - 4, (y - 4.5) * 1.3, z - 4) < 2.6 && !(x === 4 && z === 4 && y < 4)) put(x, y, z, 'birchleaves')
    }
  } else if (['tower', 'rocket', 'statue'].includes(theme)) {
    for (let y = 0; y < 8; y++) for (let x = 3; x <= 5; x++) for (let z = 3; z <= 5; z++) if (x !== 4 || z !== 4 || y === 7) put(x, y, z, y === 7 ? 'sealantern' : 'stonebricks')
    for (const [x, z] of [[3, 3], [3, 5], [5, 3], [5, 5]]) put(x, 8, z, 'stonebricks')
  } else {
    for (let y = 0; y < 3; y++) for (let x = 2; x <= 6; x++) for (let z = 2; z <= 6; z++) {
      if (x !== 2 && x !== 6 && z !== 2 && z !== 6) continue
      put(x, y, z, x === 4 && z === 2 && y < 2 ? null : y === 1 && (x === 2 || x === 6) && z === 4 ? 'glass' : 'oak')
    }
    for (let k = 0; k < 3; k++) for (let x = 2 + k; x <= 6 - k; x++) for (let z = 2 + k; z <= 6 - k; z++) {
      if (k < 2 && x > 2 + k && x < 6 - k && z > 2 + k && z < 6 - k) continue
      put(x, 3 + k, z, 'terracotta')
    }
  }
  return out.filter((b) => b[3])
}
