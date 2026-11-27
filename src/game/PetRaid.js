// Co-op boss raid (pet battles round 4, Batch O, 2026-11-24). Plan:
// docs/notes/team-battle-batches.md.
//
// Gaymi's answers: a new giant boss each week (BOSSES, by weekId, each with
// its own special); prize = coins + XP for the pets + a held item + a badge
// per boss beaten; the prize pays once a day (fight as often as you like);
// no friend online = raid with a helper bot team.
//
// The raid itself is a TeamBattle with `raid` set: everyone on the 'mine'
// side (my first RAID_TEAM pets + my friend's or the helper bot's), one
// giant boss on the other. Its numbers come from the whole raid team
// (bossFor), so a raid is about as hard with a bot as with a friend. With a
// friend it's live, like a friend battle (FriendBattle.js, Firestore
// petRaids/{id} - same invite as petDuels, plus boss = the week): both
// screens run the same fight, both friends are on the same side and share
// one cheer meter.
//
// Saved in localStorage (RAID_KEY): { day (UTC day of the last prize),
// badges { bossId: times beaten for a prize } }. Numbers are a guess.
export { stats } from './Creatures.js'
import { loadCreatures, stats, rollItem, giveItem, creatureIconURL, levelOf, creatureName, power } from './Creatures.js'
import { TeamBattle } from './TeamBattle.js'
import { weekId, weekStart } from './TeamTournament.js'
import { foeTeam } from './WeeklyChallenge.js'
import { saveShopProgress, saveSettings } from './Game.js'
import { t } from './i18n.js'

export const RAID_KEY = 'gayz-pet-raid'
export const RAID_TEAM = 5 // each player brings their first 5 picked pets
export const BOSS_HP = 1.6 // the boss's health = the whole raid team's health x this
export const BOSS_ATK = 1.7 // its attack = the raid team's average attack x this
export const RAID_COINS = 300
export const DAY_MS = 24 * 60 * 60 * 1000

// One boss a week (BOSSES[weekId % length]). c: the creature it looks like;
// big: how much bigger it's drawn; special: TeamBattle BOSS_SPECIALS;
// minion: what Summon brings in; hp: its own health x (else BOSS_HP),
// tuned so a matched team wins most raids without cheering (a guess).
export const BOSSES = [
  { id: 'king', c: { t: 'z', k: null, r: 'mythic', n: 0, b: true }, big: 2.4, special: 'slam', color: '#5aa040' },
  { id: 'rex', c: { t: 'a', k: 'tRex', r: 'mythic' }, big: 1.5, hp: 1.8, special: 'quake', color: '#8a6a3a' },
  { id: 'bones', c: { t: 'z', k: 'warrior', r: 'mythic', n: 0, b: true }, big: 2.4, hp: 2.1, special: 'rain', color: '#d8d4c4' },
  { id: 'spider', c: { t: 'z', k: 'spider', r: 'mythic', n: 0, b: true }, big: 2, hp: 1.15, special: 'summon', minion: { t: 'z', k: 'spider', r: 'common', n: 0, b: false }, color: '#8a3ad8' },
  { id: 'blob', c: { t: 'z', k: 'blob', r: 'mythic', n: 0, b: true }, big: 2.2, special: 'regen', color: '#3ab8a0' },
]
const BOSS_IDS = BOSSES.map((b) => b.id)
const capId = (id) => id[0].toUpperCase() + id.slice(1)
export const bossName = (id) => t(`raidBoss${capId(id)}`)
export const bossInfo = (id) => t(`raidBossInfo${capId(id)}`)

export function bossOf(week = weekId()) {
  return BOSSES[((week % BOSSES.length) + BOSSES.length) % BOSSES.length]
}

export const today = (now = Date.now()) => Math.floor(now / DAY_MS)

export function loadRaid() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(RAID_KEY) || 'null')
  } catch {
    d = null
  }
  const out = { day: -1, badges: {} }
  if (!d || typeof d !== 'object') return out
  if (Number.isInteger(d.day)) out.day = d.day
  if (d.badges && typeof d.badges === 'object') {
    for (const id of BOSS_IDS) if (Number.isInteger(d.badges[id]) && d.badges[id] > 0) out.badges[id] = Math.min(9999, d.badges[id])
  }
  return out
}

function saveRaid(d) {
  try {
    localStorage.setItem(RAID_KEY, JSON.stringify({ day: d.day, badges: d.badges }))
  } catch {
    // Full storage: not kept.
  }
}

export const prizeReady = (now = Date.now()) => loadRaid().day !== today(now)

// My raid team: the first RAID_TEAM picked pets.
export function raidTeam() {
  const data = loadCreatures()
  return data.team.map((id) => data.list.find((c) => c.id === id)).filter(Boolean).slice(0, RAID_TEAM)
}

// The boss TeamBattle fights, sized to the whole raid team (both players').
export function bossFor(team, week = weekId()) {
  const b = bossOf(week)
  const list = team.map((c) => stats(c))
  const hp = list.reduce((s, x) => s + x.hp, 0) || 100
  const atk = list.reduce((s, x) => s + x.atk, 0) / (list.length || 1) || 10
  const own = stats(b.c)
  const c = { ...b.c, nm: bossName(b.id), nk: true }
  return {
    id: b.id,
    c,
    big: b.big,
    special: b.special,
    minion: b.minion || { t: 'z', k: null, r: 'common', n: 0, b: false },
    s: { ...own, hp: Math.round(hp * (b.hp || BOSS_HP)), atk: Math.round(atk * BOSS_ATK), speed: own.speed * 0.75, rate: 1.4, reach: own.reach + 0.6 },
  }
}

// The helper bot's team (no friend): about as strong as mine, the same size.
export function helperTeam(mine, week = weekId()) {
  return foeTeam({ id: 'raid' }, week, 77, power(mine), mine.length).map((c) => ({ ...c, loan: true }))
}

// The end of a raid: the prize (once a day) for a win. Returns what
// TeamBattle shows: { coins, item, news, text }.
export function raidEnd(game, won, bossId) {
  if (won === null) return 0
  if (!won) return { coins: 0, text: t('raidLost') }
  const d = loadRaid()
  if (d.day === today()) return { coins: 0, text: t('raidPrizeDone') }
  d.day = today()
  d.badges[bossId] = (d.badges[bossId] || 0) + 1
  saveRaid(d)
  const item = rollItem()
  giveItem(item)
  game.coins += RAID_COINS
  game._playStats?.countCoins?.('bankIn', 'pets', RAID_COINS)
  saveShopProgress(game)
  game._renderCurrencyBar?.()
  game._renderTeamPanel?.()
  return { coins: RAID_COINS, item, news: [t('raidBadgeWon', { boss: bossName(bossId) })], text: t('teamBattleReward', { n: RAID_COINS }) }
}

function viewOpts(game) {
  return {
    view: game.settings?.battleView === '2d' ? '2d' : '3d',
    onView: (v) => {
      if (!game.settings) return
      game.settings.battleView = v
      saveSettings(game.settings)
      const sel = document.getElementById('battle-view-select')
      if (sel) sel.value = v
    },
  }
}

// A raid battle (solo or live). mine: everyone on my side; extra: TeamBattle
// options (live, onCheer, onClose).
export function openRaid(game, mine, week, extra = {}) {
  if (game._teamBattle?.root) game._teamBattle.close()
  const raid = bossFor(mine, week)
  const battle = new TeamBattle({
    mine,
    theirs: [raid.c],
    foe: bossName(raid.id),
    ghost: false,
    hazard: null,
    raid,
    onEnd: (won) => raidEnd(game, won, raid.id),
    againKey: () => (extra.live ? false : 'raidAgain'),
    onAgain: () => startSoloRaid(game),
    ...viewOpts(game),
    ...extra,
  })
  game._teamBattle = battle
  battle.open()
  return battle
}

// No friend: raid with a helper bot team.
export function startSoloRaid(game) {
  if (game._teamBattle?.root) return null
  const mine = raidTeam()
  if (!mine.length) {
    game._showHomepageToast?.(t('teamNeedOne'))
    return null
  }
  const week = weekId()
  return openRaid(game, [...mine, ...helperTeam(mine, week)], week)
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// The Pets tab's Boss Raid section (#pet-raid-body; the friend list under
// it is FriendBattle.js's).
export function renderRaid() {
  const box = document.getElementById('pet-raid-body')
  if (!box) return
  const week = weekId()
  const b = bossOf(week)
  const d = loadRaid()
  const team = raidTeam()
  const ready = d.day !== today()
  const mon = (c) => `<span class="leader-mon" title="${esc(creatureName(c))}"><img src="${creatureIconURL(c)}" alt="" draggable="false" /><b>${esc(t('teamLevel', { n: levelOf(c) }))}</b></span>`
  const badges = BOSSES.filter((x) => d.badges[x.id]).map((x) => `<span class="weekly-badge raid-badge" style="--weekly-color: ${x.color}">★ ${esc(t('raidBadge', { boss: bossName(x.id), n: d.badges[x.id] }))}</span>`).join('')
  document.getElementById('pet-raid')?.style.setProperty('--weekly-color', b.color)
  box.innerHTML = `
    <h3 class="team-section-title">${esc(t('raidTitle', { boss: bossName(b.id) }))}</h3>
    <div class="raid-boss"><img src="${creatureIconURL(b.c)}" alt="" draggable="false" /></div>
    <p class="menu-best-stats weekly-status">${esc(`${bossInfo(b.id)} ${t('raidHow', { n: RAID_TEAM, coins: RAID_COINS })}`)}</p>
    <p class="menu-best-stats raid-prize">${esc(ready ? t('raidPrizeReady') : t('raidPrizeTomorrow'))} ${esc(t('raidNewBoss', { date: weekStart(week + 1) }))}</p>
    ${team.length ? `<p class="weekly-team-label">${esc(t('raidYourTeam', { n: RAID_TEAM }))}</p><div class="weekly-team">${team.map(mon).join('')}</div>` : ''}
    <div class="raid-btns">
      <button type="button" id="raid-solo-btn" class="team-battle-btn"${team.length ? '' : ' disabled'}>${esc(t('raidSoloBtn'))}</button>
    </div>
    ${badges ? `<div class="weekly-badges">${badges}</div>` : ''}`
  const fb = document.getElementById('raid-friend-btn')
  if (fb) {
    fb.textContent = t('raidFriendBtn')
    fb.disabled = !team.length
  }
}
