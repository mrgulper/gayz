// Team Deathmatch (2026-11-16): Red against Blue in the Deathmatch arena.
// Built on PartyDeathmatch (same arena, health, endless ammo, kill feed,
// respawns, bots); plugs into PartyMode (PartyModes.js) as its `ext` with
// `teams` on, so PartyMode deals out the teams (even halves at the start,
// a newcomer to the smaller side) and the round's score is the two teams'
// kills.
//
// Gaymi's picks: 2v2 or 4v4 (or Custom, 1 to 4 a side - Game Mode >
// Deathmatch, settings.tdmSize), bots fill both teams and a joining player
// takes a bot's place; timer only (ROUND_S.teamDeathmatch, the team with
// more kills wins); no team damage (shots pass through teammates); teams
// picked automatically and kept even.
//
// Red spawns on the west half, Blue on the east, each at its own side's
// spawn point furthest from the other team. Everyone wears a team diamond
// (PartyMode._mark). The host picks the size (its own setting) and sends
// it with the round (`sz`), so everyone on a server plays the same size.
import { t } from './i18n.js'
import { PartyDeathmatch, DM_Y } from './PartyDeathmatch.js'

export const TDM_SIZES = [2, 4]
export const TDM_MIN = 1
export const TDM_MAX = 4
const DECK = 4
const COLORS = { r: 0xe8443a, b: 0x3a7be8 }
// Each team's spawn points: [x, z, floor height] round home.
const SIDE_SPAWNS = {
  r: [[-17, -17, 0], [-17, 17, 0], [-9, 0, 0], [-18.5, 0, DECK], [-13, -8, 0], [-13, 8, 0]],
  b: [[17, 17, 0], [17, -17, 0], [9, 0, 0], [18.5, 0, DECK], [13, 8, 0], [13, -8, 0]],
}

// A team size from a setting (1 to 4 a side, 4 if it's missing).
export function tdmSize(v) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= TDM_MIN ? Math.min(TDM_MAX, n) : TDM_MAX
}

export class PartyTeamDeathmatch extends PartyDeathmatch {
  constructor(pm) {
    super(pm)
    this.teams = true
    this.kills = {}
    this.size = tdmSize(pm.s?.bm?.game?.settings?.tdmSize)
  }

  get total() {
    return this.size * 2
  }

  _kills() {
    return this.kills
  }

  _teamOf(id) {
    return this.pm.teams.get(id) || ''
  }

  _foe(a, b) {
    if (a === b) return false
    const ta = this._teamOf(a)
    return !ta || ta !== this._teamOf(b)
  }

  _scored(by) {
    const tm = this._teamOf(by)
    if (tm) this.pm.score[tm] = (this.pm.score[tm] || 0) + 1
  }

  _count(people) {
    const n = { r: 0, b: 0 }
    for (const p of people) {
      const tm = this._teamOf(p.id)
      if (tm) n[tm]++
    }
    return n
  }

  // Bots fill both teams up to `size`; a player who joins takes a bot's
  // place on the bigger side, so the teams stay even.
  _fill(people) {
    const pm = this.pm
    const real = people.filter((p) => !p.bot).length
    const want = Math.max(0, this.total - real)
    let changed = false
    while (pm.bots.size > want) {
      const n = this._count(pm._people())
      const big = n.r > n.b ? 'r' : n.b > n.r ? 'b' : ''
      const bots = [...pm.bots.keys()]
      const id = bots.filter((b) => !big || this._teamOf(b) === big).pop() || bots.pop()
      pm._removeBot(id)
      changed = true
    }
    while (pm.bots.size < want) {
      pm._fillBots(pm.bots.size + 1)
      changed = true
    }
    if (changed) people = pm._people()
    // Anyone new (a bot just added) joins the smaller team.
    for (const p of people) if (!pm.teams.has(p.id)) pm.teams.set(p.id, pm._smallerTeam())
    return people
  }

  begin(people) {
    this.kills = {}
    super.begin(people)
    this.pm.score = { r: 0, b: 0 }
  }

  // My team's spawn point furthest from the other team.
  _spawnFor(id) {
    const tm = this._teamOf(id)
    if (!tm) return super._spawnFor(id)
    const foes = this.pm._people().filter((p) => this._foe(id, p.id) && this.hp.has(p.id))
    let best = null
    let bestD = -1
    for (const [sx, sz, sy] of SIDE_SPAWNS[tm]) {
      const a = this._abs(sx, sz)
      const d = foes.length ? Math.min(...foes.map((p) => Math.hypot(p.x - a.x - 0.5, p.z - a.z - 0.5))) : Math.random() * 10
      const score = d + Math.random() * 4
      if (score > bestD) {
        bestD = score
        best = { x: a.x + 0.5, y: DM_Y + 1 + sy, z: a.z + 0.5 }
      }
    }
    return best
  }

  markColor(id) {
    const tm = this._teamOf(id)
    return tm ? COLORS[tm] : null
  }

  // My team's players, best first, then the other team's.
  _boardRows() {
    const mine = this.pm.myTeam || 'r'
    const order = (id) => (this._teamOf(id) === mine ? 0 : 1)
    return Object.entries(this.kills)
      .map(([id, k]) => ({ id, k, d: this.deaths[id] || 0, cls: this._teamOf(id) ? `team-${this._teamOf(id)}` : '' }))
      .sort((a, b) => order(a.id) - order(b.id) || b.k - a.k || a.d - b.d)
  }

  _boardTitle() {
    const sc = this.pm.score
    return t('tdmBoardTitle', { r: sc.r || 0, b: sc.b || 0 })
  }

  winText(w) {
    return t('partyTeamWins', { team: t(w === 'r' ? 'partyRed' : 'partyBlue') })
  }

  startText() {
    const tm = this.pm.myTeam
    return t('tdmStart', { n: Math.round(this.pm.left / 60) || 5, size: this.size, team: t(tm === 'b' ? 'partyBlue' : 'partyRed') })
  }

  hud() {
    const pm = this.pm
    let out = `${t('partyRed')} ${pm.score.r || 0} - ${pm.score.b || 0} ${t('partyBlue')}`
    if (pm.myTeam) out += ` · ${t('partyYourTeam', { team: t(pm.myTeam === 'r' ? 'partyRed' : 'partyBlue') })}`
    return `${out} · ${t('dmHudKills', { n: this.kills[pm.myId] || 0 })}`
  }

  snap() {
    const out = (id) => this.pm._out(id)
    const ki = {}
    for (const [id, n] of Object.entries(this.kills)) ki[out(id)] = n
    return { ...super.snap(), ki, sz: this.size }
  }

  apply(d) {
    super.apply(d)
    const ok = (id) => /^(?:b\d{1,4}|[A-Za-z0-9]{4,40}|me)$/.test(id)
    if (d.ki && typeof d.ki === 'object') this.kills = Object.fromEntries(Object.entries(d.ki).filter(([id, n]) => ok(id) && Number.isFinite(n)))
    if (Number.isFinite(d.sz)) this.size = tdmSize(d.sz)
  }
}
