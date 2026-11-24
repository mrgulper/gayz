// Weekly Challenge (2026-11-24, pet battles round 4, Batch L; Gaymi
// picked: a ladder of 5 bot battles, rules rotate through one-kind weeks,
// a random team, everyone level 1 and twists; prize = coins + a held item
// + a badge; its own section on the Pets tab, works offline).
//
// One rule a week (RULES[weekId % RULES.length], the same Monday-to-Sunday
// UTC weeks as the Weekly Tournament). Win WEEK_STEPS battles in a row
// against bots that follow the same rule, each a bit stronger
// (STEP_POWER x my team's power). Lose = try that battle again, as often
// as you like. Each win pays STEP_COINS; the last one also WEEK_COINS, a
// random held item and a badge for that week (BADGES_KEPT kept).
//
// My team for the week (weeklyTeam): one-kind weeks = my strongest pets of
// that kind, loaner pets (common, level 1, no XP) fill the gaps so no
// week is ever unplayable; Lucky Dip = a random team made from the week
// (the same for everyone); every other week = my picked team (first
// TEAM_MAX, or 3). The rule is then put on both teams (applyRule): level 1,
// common, no snacks / items. Copies keep the real id, so XP still goes to
// my real pets. Numbers are a guess.
//
// Saved in localStorage (WEEKLY_KEY), so Cloud Save carries it.
import { loadCreatures, saveCreatures, creatureName, creatureIconURL, levelOf, power, bookKinds, bookGroup, rollItem, giveItem } from './Creatures.js'
import { TeamBattle, HAZARD_IDS } from './TeamBattle.js'
import { weekId, weekStart } from './TeamTournament.js'
import { ZOMBIE_TIER_IDS, NAME_COUNT } from './ZombieNames.js'
import { saveShopProgress, saveSettings } from './Game.js'
import { t } from './i18n.js'

export const WEEKLY_KEY = 'gayz-weekly-challenge'
export const WEEK_STEPS = 5
export const STEP_POWER = [0.75, 0.9, 1, 1.1, 1.25]
export const STEP_COINS = 25
export const LOSS_COINS = 5
export const WEEK_COINS = 500
export const TEAM_MAX = 5
export const TRIO = 3
export const BADGES_KEPT = 20

// kind: a one-kind week (bookGroup). Mixed so two kind weeks never touch.
export const RULES = [
  { id: 'skeleton', kind: 'skeleton', color: '#e8e4d8' },
  { id: 'level1', color: '#7cc04a' },
  { id: 'random', color: '#c878e8' },
  { id: 'animal', kind: 'animal', color: '#c8a048' },
  { id: 'bare', color: '#a0a0a8' },
  { id: 'zombie', kind: 'zombie', color: '#5aa040' },
  { id: 'trio', color: '#4a9ad8' },
  { id: 'hazard', color: '#e8603a' },
  { id: 'dino', kind: 'dino', color: '#3f8a3a' },
  { id: 'common', color: '#d8d8d8' },
]
const RULE_IDS = RULES.map((r) => r.id)
const capId = (id) => id[0].toUpperCase() + id.slice(1)

export function ruleOf(week = weekId()) {
  return RULES[((week % RULES.length) + RULES.length) % RULES.length]
}
export const ruleName = (id) => t(`weeklyRule${capId(id)}`)
export const ruleInfo = (id) => t(`weeklyRuleInfo${capId(id)}`, { n: TRIO })

// The same seed always gives the same dice (a week's bots, Lucky Dip team).
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// { week, step (battles won this week), badges: [{ week, rule }] } - checked
// over, it came from localStorage. A new week starts again at step 0.
export function loadWeekly() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(WEEKLY_KEY) || 'null')
  } catch {
    d = null
  }
  const week = weekId()
  const out = { week, step: 0, badges: [] }
  if (!d || typeof d !== 'object') return out
  if (d.week === week && Number.isInteger(d.step)) out.step = Math.max(0, Math.min(WEEK_STEPS, d.step))
  out.badges = (Array.isArray(d.badges) ? d.badges : [])
    .filter((b) => b && Number.isInteger(b.week) && RULE_IDS.includes(b.rule))
    .slice(-BADGES_KEPT)
    .map((b) => ({ week: b.week, rule: b.rule }))
  return out
}

function saveWeekly(d) {
  try {
    localStorage.setItem(WEEKLY_KEY, JSON.stringify({ week: d.week, step: d.step, badges: d.badges }))
  } catch {
    // Full storage: not kept.
  }
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)]
const kindsOf = (group) => bookKinds().filter((c) => (group ? bookGroup(c) === group : bookGroup(c) !== 'dino'))
// A pet of kind c (from bookKinds), rarity r, level l.
function make(c, r, l, rand) {
  return c.t === 'a' ? { t: 'a', k: c.k, r, l } : { t: 'z', k: c.k, r, n: Math.floor(rand() * NAME_COUNT), b: false, l }
}

// The rule put on a team: copies, so my saved pets never change.
export function applyRule(rule, team) {
  return team.map((c) => {
    const o = { ...c }
    if (rule.id === 'level1') {
      o.l = 1
      delete o.x
    }
    if (rule.id === 'common') o.r = 'common'
    if (rule.id === 'bare') {
      delete o.sn
      delete o.hi
    }
    return o
  })
}

function pickedTeam() {
  const data = loadCreatures()
  return data.team.map((id) => data.list.find((c) => c.id === id)).filter(Boolean)
}

// My team for this week, before the rule is put on it.
export function weeklyTeam(rule = ruleOf(), week = weekId()) {
  if (rule.id === 'random') {
    const rand = seeded(week * 977 + 13)
    const pool = kindsOf(null)
    return Array.from({ length: TEAM_MAX }, () => make(pick(pool, rand), ZOMBIE_TIER_IDS[Math.floor(rand() * 3)], 1 + Math.floor(rand() * 8), rand))
  }
  if (rule.kind) {
    const mine = loadCreatures().list
      .filter((c) => bookGroup(c) === rule.kind)
      .sort((a, b) => power([b]) - power([a]))
      .slice(0, TEAM_MAX)
    const rand = seeded(week * 977 + 29)
    const pool = kindsOf(rule.kind)
    while (mine.length < TEAM_MAX) mine.push({ ...make(pick(pool, rand), 'common', 1, rand), loan: true })
    return mine
  }
  return pickedTeam().slice(0, rule.id === 'trio' ? TRIO : TEAM_MAX)
}

// Bot `step`'s team: kinds from the week's dice, rarity + level tuned so its
// power lands near target (and it follows the rule).
export function foeTeam(rule, week, step, target, size) {
  const rand = seeded(week * 131 + step * 7 + 1)
  const pool = kindsOf(rule.kind || null)
  const kinds = Array.from({ length: size }, () => pick(pool, rand))
  const names = kinds.map(() => Math.floor(rand() * NAME_COUNT))
  const rarities = rule.id === 'common' ? ['common'] : ZOMBIE_TIER_IDS
  const levels = rule.id === 'level1' ? [1] : Array.from({ length: 20 }, (_, i) => i + 1)
  let best = null
  for (const r of rarities) {
    for (const l of levels) {
      const team = kinds.map((c, i) => (c.t === 'a' ? { t: 'a', k: c.k, r, l } : { t: 'z', k: c.k, r, n: names[i], b: false, l }))
      const diff = Math.abs(power(team) - target)
      if (!best || diff < best.diff) best = { team, diff }
    }
  }
  return best.team
}

// The battle the button starts now (no battle once the week is done).
export function startWeekly(game) {
  const tell = (text) => game._showHomepageToast?.(text)
  if (game._teamBattle?.root) return null
  const d = loadWeekly()
  if (d.step >= WEEK_STEPS) return null
  const rule = ruleOf(d.week)
  const base = weeklyTeam(rule, d.week)
  if (!base.length) {
    tell(t('teamNeedOne'))
    return null
  }
  const mine = applyRule(rule, base)
  const step = d.step
  const theirs = applyRule(rule, foeTeam(rule, d.week, step, power(mine) * STEP_POWER[step], mine.length))
  const hazard = rule.id === 'hazard' ? HAZARD_IDS[(d.week + step) % HAZARD_IDS.length] : undefined
  const week = d.week
  game._teamBattle = new TeamBattle({
    mine,
    theirs,
    foe: t('weeklyFoe', { n: step + 1, max: WEEK_STEPS }),
    ghost: false,
    hazard,
    onEnd: (won) => {
      if (won === null) return 0
      const data = loadCreatures()
      if (won) data.wins++
      else data.losses++
      saveCreatures(data)
      let reward = LOSS_COINS
      let item = null
      // A new week started mid-battle: that win doesn't count for the new one.
      const now = loadWeekly()
      if (won && now.week === week && now.step === step) {
        reward = STEP_COINS
        now.step++
        if (now.step >= WEEK_STEPS) {
          reward += WEEK_COINS
          item = rollItem()
          giveItem(item)
          now.badges = [...now.badges.filter((b) => b.week !== week), { week, rule: rule.id }].slice(-BADGES_KEPT)
        }
        saveWeekly(now)
      }
      game.coins += reward
      saveShopProgress(game)
      game._renderCurrencyBar?.()
      game._renderTeamPanel?.()
      return item ? { coins: reward, item } : reward
    },
    againKey: (won) => (!won ? 'teamBattleAgain' : loadWeekly().step < WEEK_STEPS ? 'weeklyNextBtn' : false),
    onAgain: () => startWeekly(game),
    view: game.settings?.battleView === '2d' ? '2d' : '3d',
    onView: (v) => {
      if (!game.settings) return
      game.settings.battleView = v
      saveSettings(game.settings)
      const sel = document.getElementById('battle-view-select')
      if (sel) sel.value = v
    },
  })
  game._teamBattle.open()
  return game._teamBattle
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// The Pets tab's Weekly Challenge section.
export function renderWeekly() {
  const box = document.getElementById('weekly-challenge')
  if (!box) return
  const d = loadWeekly()
  const rule = ruleOf(d.week)
  const done = d.step >= WEEK_STEPS
  const team = applyRule(rule, weeklyTeam(rule, d.week))
  const mon = (c) => {
    const tip = c.loan ? `${creatureName(c)} (${t('weeklyLoaner')})` : creatureName(c)
    return `<span class="leader-mon${c.loan ? ' weekly-loan' : ''}" title="${esc(tip)}"><img src="${creatureIconURL(c)}" alt="" draggable="false" /><b>${esc(t('teamLevel', { n: levelOf(c) }))}</b></span>`
  }
  const dots = Array.from({ length: WEEK_STEPS }, (_, i) => `<span class="weekly-dot${i < d.step ? ' won' : i === d.step ? ' next' : ''}"></span>`).join('')
  const badges = d.badges.slice().reverse().map((b) => `<span class="weekly-badge" style="--weekly-color: ${RULES.find((r) => r.id === b.rule).color}">★ ${esc(t('weeklyBadge', { rule: ruleName(b.rule), date: weekStart(b.week) }))}</span>`).join('')
  const status = done
    ? t('weeklyDone', { date: weekStart(d.week + 1) })
    : `${ruleInfo(rule.id)} ${t('weeklyHow', { n: WEEK_STEPS, coins: WEEK_COINS })}`
  box.style.setProperty('--weekly-color', rule.color)
  box.innerHTML = `
    <h3 class="team-section-title">${esc(t('weeklyTitle', { rule: ruleName(rule.id) }))}</h3>
    <p class="menu-best-stats weekly-status">${esc(status)}</p>
    <div class="weekly-dots" title="${esc(t('weeklyStep', { n: d.step, max: WEEK_STEPS }))}">${dots}</div>
    ${team.length ? `<p class="weekly-team-label">${esc(t('weeklyYourTeam'))}</p><div class="weekly-team">${team.map(mon).join('')}</div>` : ''}
    <button type="button" id="weekly-btn" class="team-battle-btn"${done || !team.length ? ' disabled' : ''}>${esc(done ? t('weeklyNextWeek') : t('weeklyFight', { n: d.step + 1, max: WEEK_STEPS }))}</button>
    ${badges ? `<div class="weekly-badges">${badges}</div>` : ''}`
}
