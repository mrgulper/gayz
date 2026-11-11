// Pack Leaders (2026-11-11, Team Battle batch 3; Gaymi picked: all 26
// biomes, fought from the Pets tab AND met standing in their biome, a
// fixed ladder you unlock in order, a badge plus a bigger coin prize).
//
// One boss trainer per biome (LEADERS, easiest first), each with a team
// themed on its biome: the animals that live there (PlayAnimals'
// BIOME_ANIMALS, its dinosaurs from leader DINO_FROM on) and zombie kinds
// that fit (`z`). Leader i's team gets bigger, higher level and rarer down
// the ladder (leaderTeam). Beat the next one for its badge and
// leaderCoins(i) coins; the one after it unlocks. No rematches once beaten
// (Gaymi didn't pick them). A lost or left battle can be tried again.
//
// On the Pets tab (renderLeaders, under the Weekly Tournament): the next
// leader with their team, a Challenge button and all 26 badges. In a game
// the leaders stand in the open world (PackLeaderWorld.js).
//
// Saved in localStorage (LEADERS_KEY), so Cloud Save carries it.
import { loadCreatures, saveCreatures, creatureName, creatureIconURL, levelOf, power, TEAM_SIZE, MAX_LEVEL } from './Creatures.js'
import { TeamBattle } from './TeamBattle.js'
import { BIOME_ANIMALS, PlayAnimals } from './PlayAnimals.js'
import { DINO_BIOMES } from './DinoKinds.js'
import { ZOMBIE_TIER_IDS, NAME_COUNT } from './ZombieNames.js'
import { biomeName } from './OpenWorld.js'
import { saveShopProgress, saveSettings } from './Game.js'
import { t } from './i18n.js'

export const LEADERS_KEY = 'gayz-pack-leaders'
export const LOSS_COINS = 5
// First leader's prize, and how much more each next one pays.
export const FIRST_COINS = 100
export const MORE_COINS = 10
// Leaders from this one on bring one of their biome's dinosaurs...
const DINO_FROM = 8
// ...and from this one on, a boss zombie.
const BOSS_FROM = 22

// name: the same in every language (like zombies' first names).
// z: zombie / skeleton kinds (null = the plain zombie). color: the badge.
export const LEADERS = [
  { biome: 'plains', name: 'Hank', z: [null], color: '#7cc04a' },
  { biome: 'beach', name: 'Coral', z: ['crawler'], color: '#f0d890' },
  { biome: 'birchForest', name: 'Willow', z: ['skinny'], color: '#c8e0a0' },
  { biome: 'forest', name: 'Oakley', z: ['hunched'], color: '#3f8a3a' },
  { biome: 'river', name: 'Brook', z: ['drowned'], color: '#4a9ad8' },
  { biome: 'cherryGrove', name: 'Sakura', z: ['cherub', 'angel'], color: '#f4a8c8' },
  { biome: 'mushroomFields', name: 'Morel', z: ['blob', 'bloater'], color: '#a868b0' },
  { biome: 'swamp', name: 'Bog', z: ['lurker', 'blob'], color: '#5a7040' },
  { biome: 'savanna', name: 'Zuri', z: ['beast'], color: '#c8b048' },
  { biome: 'desert', name: 'Dune', z: ['minion', 'rogue'], color: '#e8c878' },
  { biome: 'taiga', name: 'Pine', z: ['hunched', 'beast'], color: '#2f6a50' },
  { biome: 'snowyPlains', name: 'Flurry', z: ['skinny', 'screamer'], color: '#e8f0f8' },
  { biome: 'snowyBeach', name: 'Pebble', z: ['crawler', 'drowned'], color: '#c8d8e0' },
  { biome: 'mangroveSwamp', name: 'Root', z: ['lurker', 'spider'], color: '#6a5a30' },
  { biome: 'jungle', name: 'Vine', z: ['spider', 'beast'], color: '#2a9a3a' },
  { biome: 'bambooJungle', name: 'Mei', z: ['spider', 'crawler'], color: '#8ac850' },
  { biome: 'badlands', name: 'Rusty', z: ['rogue', 'warrior'], color: '#c8603a' },
  { biome: 'darkForest', name: 'Raven', z: ['hellhound', 'imp', 'lurker'], color: '#2a3a2a' },
  { biome: 'mountains', name: 'Boulder', z: ['brute', 'warrior'], color: '#8a8a8a' },
  { biome: 'warmOcean', name: 'Marina', z: ['jelly', 'sharkman'], color: '#30c0c0' },
  { biome: 'ocean', name: 'Finn', z: ['drowned', 'sharkman', 'angler'], color: '#2a6ac8' },
  { biome: 'iceSpikes', name: 'Shard', z: ['seraph', 'mage'], color: '#a8e0f8' },
  { biome: 'snowyTaiga', name: 'Frost', z: ['hellhound', 'brute', 'screamer'], color: '#7aa0b8' },
  { biome: 'frozenOcean', name: 'Floe', z: ['angler', 'jelly', 'drowned'], color: '#6a90c8' },
  { biome: 'deepOcean', name: 'Abyss', z: ['angler', 'sharkman', 'jelly'], color: '#1a3070' },
  { biome: 'snowyPeaks', name: 'Summit', z: ['archangel', 'demon', 'fiend'], color: '#f8f8ff' },
]

export const leaderIndex = (biome) => LEADERS.findIndex((L) => L.biome === biome)
export const leaderCoins = (i) => FIRST_COINS + MORE_COINS * i
export const leaderTitle = (i) => t('leaderTitle', { name: LEADERS[i].name, biome: biomeName(LEADERS[i].biome) })

// The same text always gives the same number (a leader's zombies' names).
function hash(s) {
  let h = 7
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

// Leader i's team: 2 creatures for the first, TEAM_SIZE for the last;
// common up to mythic. Zombies and animals take turns. Its level (1-20) is
// then tuned so the team's power() lands near powerGoal(i) - a big
// dinosaur would otherwise make one leader much harder than the next one.
// (Worked out once per leader, kept in _teams.)
export const FIRST_POWER = 70
export const LAST_POWER = 3000
export const powerGoal = (i) => FIRST_POWER * (LAST_POWER / FIRST_POWER) ** (i / (LEADERS.length - 1))
const _teams = new Map()

export function leaderTeam(i) {
  if (!_teams.has(i)) _teams.set(i, tuneTeam(i))
  return _teams.get(i).map((c) => ({ ...c }))
}

function tuneTeam(i) {
  const goal = powerGoal(i)
  // Always stronger than the leader before.
  const prev = i > 0 ? power(leaderTeam(i - 1)) : 0
  const near = (team) => (power(team) > prev ? 0 : 1e9) + Math.abs(power(team) - goal)
  // Levels near the ladder's (1 to 20), rarity one step either way.
  const ladderL = 1 + Math.round((i * 19) / (LEADERS.length - 1))
  const ladderR = Math.floor((i * ZOMBIE_TIER_IDS.length) / LEADERS.length)
  let best = null
  for (const dino of [true, false]) {
    for (let ri = Math.max(0, ladderR - 1); ri <= Math.min(ZOMBIE_TIER_IDS.length - 1, ladderR + 1); ri++) {
      for (let l = Math.max(1, ladderL - 5); l <= Math.min(MAX_LEVEL, ladderL + 5); l++) {
        const team = buildTeam(i, l, ZOMBIE_TIER_IDS[ri], dino)
        if (!best || near(team) < near(best)) best = team
      }
    }
  }
  return best
}

function buildTeam(i, l, r, dino) {
  const L = LEADERS[i]
  const kinds = PlayAnimals.KINDS
  const size = Math.min(TEAM_SIZE, 2 + Math.round((i * 8) / (LEADERS.length - 1)))
  // The biome's most common animals first.
  const animals = Object.entries(BIOME_ANIMALS[L.biome] || {})
    .filter(([k]) => Object.hasOwn(kinds, k))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
    .slice(0, 4)
  const dinos = dino && i >= DINO_FROM ? (DINO_BIOMES[L.biome] || []).filter((k) => Object.hasOwn(kinds, k)).slice(0, 1) : []
  const wild = [...dinos, ...animals]
  const base = hash(L.biome)
  const zombie = (j, boss = false) => ({ t: 'z', k: L.z[j % L.z.length], r: boss ? ZOMBIE_TIER_IDS[ZOMBIE_TIER_IDS.length - 1] : r, n: (base + j * 37) % NAME_COUNT, b: boss, l })
  const team = []
  if (i >= BOSS_FROM) team.push(zombie(0, true))
  let zi = 0
  let ai = 0
  while (team.length < size) {
    // Water biomes with no animals are all zombies.
    if (wild.length && team.length % 2 === 0) team.push({ t: 'a', k: wild[ai++ % wild.length], r, l })
    else team.push(zombie(zi++))
  }
  return team
}

// { beaten: [biome ids] } - checked over, it came from localStorage.
export function loadLeaders() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(LEADERS_KEY) || 'null')
  } catch {
    d = null
  }
  const ids = new Set(LEADERS.map((L) => L.biome))
  const beaten = Array.isArray(d?.beaten) ? [...new Set(d.beaten.filter((b) => ids.has(b)))] : []
  return { beaten }
}

function saveLeaders(d) {
  try {
    localStorage.setItem(LEADERS_KEY, JSON.stringify(d))
  } catch {
    // Full storage: the badge just isn't kept.
  }
}

// The next leader to beat (-1 once every one is beaten).
export function nextLeader(d = loadLeaders()) {
  return LEADERS.findIndex((L) => !d.beaten.includes(L.biome))
}

// 'beaten' | 'next' | 'locked'
export function leaderStatus(i, d = loadLeaders()) {
  if (d.beaten.includes(LEADERS[i].biome)) return 'beaten'
  return nextLeader(d) === i ? 'next' : 'locked'
}

function myTeam() {
  const data = loadCreatures()
  return data.team.map((id) => data.list.find((c) => c.id === id)).filter(Boolean)
}

// A battle against leader i (only the next one can be fought).
// world: in a game (PackLeaderWorld.js) - no "next leader" button there.
// -> the battle, or null when it can't start (a toast/message says why).
export function startLeaderBattle(game, i, { world = false, say = null } = {}) {
  const tell = say || ((text) => game._showHomepageToast?.(text))
  if (game._teamBattle?.root) return null
  const team = myTeam()
  if (!team.length) {
    tell(t('teamNeedOne'))
    return null
  }
  const status = leaderStatus(i)
  if (status !== 'next') {
    tell(status === 'beaten' ? t('leaderAlreadyBeaten', { name: LEADERS[i].name }) : t('leaderLocked', { name: leaderTitle(nextLeader()) }))
    return null
  }
  game._teamBattle = new TeamBattle({
    mine: team,
    theirs: leaderTeam(i),
    foe: leaderTitle(i),
    ghost: false,
    onEnd: (won) => {
      if (won === null) return 0
      const data = loadCreatures()
      if (won) data.wins++
      else data.losses++
      saveCreatures(data)
      let reward = LOSS_COINS
      if (won) {
        const d = loadLeaders()
        if (!d.beaten.includes(LEADERS[i].biome)) d.beaten.push(LEADERS[i].biome)
        saveLeaders(d)
        reward = leaderCoins(i)
      }
      game.coins += reward
      saveShopProgress(game)
      game._renderCurrencyBar?.()
      game._renderTeamPanel?.()
      return reward
    },
    // Lost: try again. Won on the Pets tab: on to the next leader.
    againKey: (won) => (!won ? 'teamBattleAgain' : world || nextLeader() < 0 ? false : 'leaderNextBtn'),
    onAgain: () => {
      const n = nextLeader()
      if (n >= 0) startLeaderBattle(game, n, { world, say })
    },
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
const icon = (c) => `<img src="${creatureIconURL(c)}" alt="" draggable="false" />`

// The Pets tab's Pack Leaders section.
export function renderLeaders() {
  const d = loadLeaders()
  const n = nextLeader(d)
  const byId = (id) => document.getElementById(id)
  const set = (id, text) => { const el = byId(id); if (el) el.textContent = text }
  set('leaders-title', t('leadersTitle', { n: d.beaten.length, max: LEADERS.length }))
  set('leaders-status', n < 0 ? t('leadersAllDone') : t('leadersNext', { name: leaderTitle(n), coins: leaderCoins(n), biome: biomeName(LEADERS[n].biome) }))
  const next = byId('leaders-team')
  if (next) {
    next.innerHTML = n < 0 ? '' : leaderTeam(n).map((c) => `<span class="leader-mon" title="${esc(creatureName(c))}">${icon(c)}<b>${esc(t('teamLevel', { n: levelOf(c) }))}</b></span>`).join('')
    next.style.display = n < 0 ? 'none' : ''
  }
  const btn = byId('leaders-btn')
  if (btn) {
    btn.style.display = n < 0 ? 'none' : ''
    if (n >= 0) btn.textContent = t('leaderChallenge', { name: LEADERS[n].name })
    btn.disabled = !myTeam().length
  }
  const grid = byId('leaders-badges')
  if (grid) {
    grid.innerHTML = LEADERS.map((L, i) => {
      const st = leaderStatus(i, d)
      const face = st === 'locked' ? '<span class="leader-badge-q">?</span>' : icon(leaderTeam(i)[0])
      return `<button type="button" class="leader-badge ${st}" data-leader="${i}" style="--leader-color: ${L.color}" title="${esc(leaderTitle(i))}">${face}<span class="leader-badge-name">${esc(biomeName(L.biome))}</span></button>`
    }).join('')
  }
}

// A badge tapped: who it is and how you stand with them.
export function badgeInfo(i) {
  const st = leaderStatus(i)
  if (st === 'beaten') return t('leaderBadgeBeaten', { name: leaderTitle(i) })
  if (st === 'next') return t('leaderBadgeNext', { name: leaderTitle(i), biome: biomeName(LEADERS[i].biome) })
  return t('leaderLocked', { name: leaderTitle(nextLeader()) })
}
