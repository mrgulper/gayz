// The Weekly Team Tournament (2026-11-02, Gaymi's idea list 4: "Your
// creature team goes through a bracket against other players' ghost teams
// ... and the top teams get a badge" - Gaymi picked "same as now": every
// round is a normal team battle, TeamBattle.js). On the Team page
// (Inventory > Pets, TeamUI.js), under the Battle button.
//
// Each week (Monday to Sunday, UTC - weekId) you can enter once. Entering
// makes your bracket of 8: you and 7 other teams, picked once and kept for
// the week - other players' ghost teams (CloudSync.fetchGhostTeams) about as
// strong as yours, topped up with made-up Wild Teams when there aren't
// enough (offline, few players). Three rounds: Quarterfinal, Semifinal,
// Final. The other matches play out by themselves (the stronger team
// usually wins, simMatch). Lose a round and you're out until next week;
// leave a battle before it ends and you can play that round again.
//
// Every round won: ROUND_COINS. Winning the Final: CHAMP_COINS more and a
// gold Champion badge for that week; losing the Final: a silver Finalist
// badge. The badges stay on the Team page (BADGES_KEPT). Saved in
// localStorage (TOURNEY_KEY), so Cloud Save carries it.
import * as CloudSync from './CloudSync.js'
import { loadCreatures, power, botTeam, packTeam, unpackTeam } from './Creatures.js'
import { TeamBattle } from './TeamBattle.js'
import { saveShopProgress, saveSettings } from './Game.js'
import { t } from './i18n.js'

export const TOURNEY_KEY = 'gayz-tournament'
export const SIZE = 8
export const ROUNDS = 3
export const ROUND_COINS = 40
export const CHAMP_COINS = 200
export const BADGES_KEPT = 20
const FIND_TIMEOUT_MS = 5000
const WEEK_MS = 7 * 24 * 3600 * 1000
// A Monday (UTC): week 0.
const WEEK_ZERO = Date.UTC(2024, 0, 1)

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const byId = (id) => document.getElementById(id)

export function weekId(now = Date.now()) {
  return Math.floor((now - WEEK_ZERO) / WEEK_MS)
}

// The Monday a week starts on, as a short date.
function weekStart(week) {
  return new Date(WEEK_ZERO + week * WEEK_MS).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Who wins a match the player isn't in: the stronger team, most of the time.
export function simMatch(a, b, rand = Math.random) {
  const pa = Math.max(1, power(a.team)) ** 2
  const pb = Math.max(1, power(b.team)) ** 2
  return rand() < pa / (pa + pb) ? a : b
}

// The saved state, checked over (it came from localStorage).
export function loadTourney() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(TOURNEY_KEY) || 'null')
  } catch {
    d = null
  }
  const out = { cur: null, badges: [] }
  if (!d || typeof d !== 'object') return out
  out.badges = (Array.isArray(d.badges) ? d.badges : [])
    .filter((b) => b && Number.isInteger(b.week) && (b.place === 'champion' || b.place === 'finalist'))
    .slice(-BADGES_KEPT)
    .map((b) => ({ week: b.week, place: b.place }))
  const c = d.cur
  if (c && typeof c === 'object' && Number.isInteger(c.week) && Array.isArray(c.entrants) && c.entrants.length === SIZE) {
    const entrants = c.entrants.map((e, i) => ({
      name: i === 0 ? '' : typeof e?.name === 'string' ? e.name.slice(0, 24) : '',
      team: i === 0 ? [] : unpackTeam(e?.team),
      packed: i === 0 ? null : e?.team,
      bot: !!e?.bot,
    }))
    if (entrants.slice(1).every((e) => e.name && e.team.length)) {
      const wins = (Array.isArray(c.wins) ? c.wins : []).slice(0, ROUNDS).map((r) => (Array.isArray(r) ? r.filter((i) => Number.isInteger(i) && i >= 0 && i < SIZE) : []))
      out.cur = { week: c.week, entrants, wins, out: !!c.out, place: ['champion', 'finalist', 'top4', 'top8'].includes(c.place) ? c.place : '' }
    }
  }
  return out
}

function saveTourney(d) {
  const cur = d.cur && {
    week: d.cur.week,
    entrants: d.cur.entrants.map((e, i) => (i === 0 ? { me: true } : { name: e.name, team: e.packed, bot: e.bot })),
    wins: d.cur.wins,
    out: d.cur.out,
    place: d.cur.place,
  }
  try {
    localStorage.setItem(TOURNEY_KEY, JSON.stringify({ cur, badges: d.badges }))
  } catch {
    // Full storage: not kept.
  }
}

// The slots still in after `round` rounds (round 0 = everyone).
function alive(cur, round) {
  if (round === 0) return [...Array(SIZE).keys()]
  return cur.wins[round - 1] || []
}

// This week's bracket, or null if I haven't entered this week.
function thisWeek(d) {
  return d.cur && d.cur.week === weekId() ? d.cur : null
}

// The round I'm on (0..2), or ROUNDS when it's over.
function myRound(cur) {
  if (cur.out || cur.place) return ROUNDS
  return cur.wins.length
}

// My opponent's slot in the round I'm on.
function opponent(cur) {
  const r = myRound(cur)
  if (r >= ROUNDS) return -1
  const list = alive(cur, r)
  return list[list.indexOf(0) ^ 1]
}

// The rest of the round plays out: every other pair's winner.
function settleRound(cur, iWon) {
  const r = myRound(cur)
  const list = alive(cur, r)
  const won = []
  for (let i = 0; i < list.length; i += 2) {
    const a = list[i]
    const b = list[i + 1]
    if (a === 0 || b === 0) won.push(iWon ? 0 : a === 0 ? b : a)
    else won.push(simMatch(cur.entrants[a], cur.entrants[b]) === cur.entrants[a] ? a : b)
  }
  cur.wins.push(won)
}

// The 7 other teams: ghost teams close to my power, then Wild Teams.
async function makeEntrants(game, team) {
  const mine = power(team)
  let ghosts = []
  if (navigator.onLine && CloudSync.isConfigured()) {
    const work = CloudSync.fetchGhostTeams(game._cloudUid).then((rows) => rows
      .map((r) => ({ name: typeof r.nickname === 'string' ? r.nickname.trim().slice(0, 24) : '', team: unpackTeam(r.team), packed: r.team, bot: false }))
      .filter((r) => r.name && r.team.length)
      .sort((a, b) => Math.abs(power(a.team) - mine) - Math.abs(power(b.team) - mine))
      .slice(0, SIZE - 1)).catch(() => [])
    ghosts = await Promise.race([work, new Promise((resolve) => setTimeout(() => resolve([]), FIND_TIMEOUT_MS))])
  }
  const out = [{ name: '', team: [], packed: null, bot: false }, ...ghosts]
  let n = 1
  while (out.length < SIZE) {
    const tm = botTeam(Math.round(mine * (0.8 + Math.random() * 0.35)), team.length)
    out.push({ name: t('tourneyBotName', { n: n++ }), team: tm, packed: packTeam(tm), bot: true })
  }
  // Everyone but me in a random order.
  const rest = out.slice(1).sort(() => Math.random() - 0.5)
  return [out[0], ...rest]
}

function myTeam() {
  const data = loadCreatures()
  return data.team.map((id) => data.list.find((c) => c.id === id)).filter(Boolean)
}

const ROUND_KEYS = ['tourneyQuarter', 'tourneySemi', 'tourneyFinal']

export function renderTournament(game) {
  const d = loadTourney()
  const cur = thisWeek(d)
  const week = weekId()
  const set = (id, text) => { const el = byId(id); if (el) el.textContent = text }
  set('tourney-title', t('tourneyTitle', { date: weekStart(week) }))
  const btn = byId('tourney-btn')
  const bracket = byId('tourney-bracket')
  let status
  if (!cur) {
    status = t('tourneyHow', { n: ROUND_COINS, c: CHAMP_COINS })
    if (btn && !game._tourneyBusy) {
      btn.textContent = t('tourneyEnter')
      btn.disabled = !myTeam().length
    }
  } else {
    const r = myRound(cur)
    if (cur.place === 'champion') status = t('tourneyChampion')
    else if (cur.place) status = t(`tourneyOut_${cur.place}`)
    else status = t('tourneyNext', { round: t(ROUND_KEYS[r]), name: cur.entrants[opponent(cur)].name })
    if (btn && !game._tourneyBusy) {
      btn.textContent = r < ROUNDS ? t('tourneyPlay', { round: t(ROUND_KEYS[r]) }) : t('tourneyNextWeek')
      btn.disabled = r >= ROUNDS || !myTeam().length
    }
  }
  set('tourney-status', status)
  if (bracket) {
    // Three columns: who's in each round, me highlighted, losers faded.
    bracket.innerHTML = !cur ? '' : [0, 1, 2, 3].map((round) => {
      const list = round === 0 ? alive(cur, 0) : cur.wins[round - 1]
      const label = round < ROUNDS ? t(ROUND_KEYS[round]) : t('tourneyWinner')
      const names = list ? list.map((i) => {
        const lost = round < ROUNDS && cur.wins[round] && !cur.wins[round].includes(i)
        const name = i === 0 ? t('tourneyYou') : cur.entrants[i].name
        return `<li class="${i === 0 ? 'me' : ''}${lost ? ' lost' : ''}">${esc(name)}</li>`
      }).join('') : `<li class="tbd">${esc(t('tourneyTbd'))}</li>`
      return `<div class="tourney-col"><b>${esc(label)}</b><ul>${names}</ul></div>`
    }).join('')
    bracket.style.display = cur ? '' : 'none'
  }
  const badges = byId('tourney-badges')
  if (badges) {
    badges.innerHTML = [...d.badges].reverse().map((b) => `<span class="tourney-badge ${b.place}" title="${esc(t(`tourneyBadge_${b.place}`))}">${esc(t(`tourneyBadge_${b.place}`))} · ${esc(weekStart(b.week))}</span>`).join('')
    badges.style.display = d.badges.length ? '' : 'none'
  }
}

// The button: enter this week's tournament, or play my next round.
export async function playTournament(game, renderTeam) {
  if (game._tourneyBusy || game._teamBattle?.root) return
  const team = myTeam()
  if (!team.length) {
    game._showHomepageToast(t('teamNeedOne'))
    return
  }
  const d = loadTourney()
  let cur = thisWeek(d)
  if (!cur) {
    game._tourneyBusy = true
    const btn = byId('tourney-btn')
    if (btn) {
      btn.disabled = true
      btn.textContent = t('teamFinding')
    }
    const entrants = await makeEntrants(game, team).catch(() => null)
    game._tourneyBusy = false
    if (!entrants) return renderTournament(game)
    cur = { week: weekId(), entrants, wins: [], out: false, place: '' }
    d.cur = cur
    saveTourney(d)
  }
  const r = myRound(cur)
  if (r >= ROUNDS) return renderTournament(game)
  const foe = cur.entrants[opponent(cur)]
  game._teamBattle = new TeamBattle({
    mine: team,
    theirs: foe.team,
    foe: `${t(ROUND_KEYS[r])}: ${foe.bot ? foe.name : t('teamGhostName', { name: foe.name })}`,
    ghost: !foe.bot,
    onEnd: (won) => {
      if (won === null) return 0
      const dd = loadTourney()
      const c = thisWeek(dd)
      if (!c || myRound(c) !== r) return 0
      settleRound(c, won)
      let reward = won ? ROUND_COINS : 0
      if (!won) {
        c.out = true
        c.place = r === 2 ? 'finalist' : r === 1 ? 'top4' : 'top8'
      } else if (r === ROUNDS - 1) {
        c.place = 'champion'
        reward += CHAMP_COINS
      }
      if (c.place === 'champion' || c.place === 'finalist') dd.badges = [...dd.badges, { week: c.week, place: c.place }].slice(-BADGES_KEPT)
      saveTourney(dd)
      if (reward) {
        game.coins += reward
        saveShopProgress(game)
        game._renderCurrencyBar?.()
      }
      renderTeam?.(game)
      return reward
    },
    onAgain: () => playTournament(game, renderTeam),
    // "Next Round" after a win that isn't the Final, else back to the bracket.
    againKey: (won) => (won && r < ROUNDS - 1 ? 'tourneyNextRound' : 'tourneyBackBtn'),
    view: game.settings?.battleView === '2d' ? '2d' : '3d',
    onView: (v) => {
      if (!game.settings) return
      game.settings.battleView = v
      saveSettings(game.settings)
      const sel = byId('battle-view-select')
      if (sel) sel.value = v
    },
  })
  game._teamBattle.open()
}
