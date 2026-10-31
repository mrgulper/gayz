// The Team page (2026-10-31): every zombie and animal you've caught
// (Creatures.js), the up-to-TEAM_SIZE picked for battles, your wins and
// losses, and the Battle button (TeamBattle.js). It's Inventory's Pets tab
// (#team-page; Gaymi, same day: "move the teams into inventory") - it used
// to be its own panel behind a homepage Team button.
//
// A battle's other team is another player's ghost team (ghostTeams in
// Firestore, CloudSync.fetchGhostTeams) about as strong as yours; when
// none can be had (offline, nobody else yet) it's a made-up Wild Team.
// Starting a battle while signed in saves your own team as a ghost team
// for others to fight.
import * as CloudSync from './CloudSync.js'
import { loadCreatures, saveCreatures, stats, power, creatureName, creatureType, rarityName, creatureIconURL, tierColor, botTeam, packTeam, unpackTeam, TEAM_SIZE } from './Creatures.js'
import { TeamBattle } from './TeamBattle.js'
import { saveShopProgress } from './Game.js'
import { t } from './i18n.js'

export const WIN_COINS = 30
export const LOSS_COINS = 5
const FIND_TIMEOUT_MS = 4000
// Teams within this many of the closest power get picked from at random.
const CLOSEST = 5

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const byId = (id) => document.getElementById(id)

function card(c, slot = 0) {
  const s = stats(c)
  return `<button type="button" class="perk-option team-card${slot ? ' picked' : ''}" data-id="${c.id}" style="--tier: ${tierColor(c.r)}">
    ${slot ? `<span class="team-card-slot">${slot}</span>` : ''}
    <img src="${creatureIconURL(c)}" alt="" draggable="false" />
    <span class="team-card-name">${esc(creatureName(c))}</span>
    <span class="team-card-type">${esc(rarityName(c.r))} ${esc(creatureType(c))}</span>
    <span class="team-card-stats">${esc(t('teamStats', { hp: s.hp, atk: s.atk }))}</span>
  </button>`
}

export function renderTeamPanel(game) {
  const data = loadCreatures()
  const set = (id, text) => { const el = byId(id); if (el) el.textContent = text }
  set('team-record', t('teamRecord', { w: data.wins, l: data.losses }))
  set('team-picked-title', t('teamPickedTitle', { n: data.team.length, max: TEAM_SIZE }))
  set('team-caught-title', t('teamCaughtTitle', { n: data.list.length }))
  set('team-how', t('teamHow'))
  const slots = byId('team-slots')
  if (slots) {
    const picked = data.team.map((id) => data.list.find((c) => c.id === id)).filter(Boolean)
    slots.innerHTML = picked.map((c, i) => card(c, i + 1)).join('')
      + Array.from({ length: TEAM_SIZE - picked.length }, () => `<div class="team-card empty"><span>${esc(t('teamEmptySlot'))}</span></div>`).join('')
  }
  const grid = byId('team-grid')
  if (grid) {
    // Newest first.
    grid.innerHTML = [...data.list].reverse().map((c) => card(c, data.team.indexOf(c.id) + 1)).join('')
  }
  const empty = byId('team-empty')
  if (empty) empty.style.display = data.list.length ? 'none' : ''
  const btn = byId('team-battle-btn')
  if (btn && !game._teamFinding) {
    btn.textContent = t('teamBattleBtn')
    btn.disabled = !data.team.length
  }
}

// Inventory, on the Pets tab.
export function openTeamPanel(game) {
  game._openMenuInventoryPanel()
  byId('inventory-tab-pets')?.click()
}

// A card clicked: on the team, or off it.
function toggle(game, id) {
  const data = loadCreatures()
  const i = data.team.indexOf(id)
  if (i >= 0) data.team.splice(i, 1)
  else if (data.team.length >= TEAM_SIZE) {
    game._showHomepageToast(t('teamFull', { n: TEAM_SIZE }))
    return
  } else data.team.push(id)
  saveCreatures(data)
  renderTeamPanel(game)
}

// Somebody else's team about as strong as mine, or null.
async function findGhost(game, team) {
  if (!navigator.onLine || !CloudSync.isConfigured()) return null
  const uid = game._cloudUid
  const mine = power(team)
  const work = (async () => {
    if (uid) {
      const nickname = (game.settings?.nickname || '').trim().slice(0, 24) || t('teamDefaultNick')
      await CloudSync.saveGhostTeam(uid, { nickname, team: packTeam(team), power: mine, wins: loadCreatures().wins }).catch(() => {})
    }
    const rows = await CloudSync.fetchGhostTeams(uid)
    const teams = rows
      .map((r) => ({ name: typeof r.nickname === 'string' ? r.nickname.slice(0, 24) : '', team: unpackTeam(r.team) }))
      .filter((r) => r.name && r.team.length)
      .sort((a, b) => Math.abs(power(a.team) - mine) - Math.abs(power(b.team) - mine))
      .slice(0, CLOSEST)
    return teams.length ? teams[Math.floor(Math.random() * teams.length)] : null
  })()
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), FIND_TIMEOUT_MS))
  return Promise.race([work.catch(() => null), timeout])
}

export async function startTeamBattle(game) {
  if (game._teamFinding) return
  const data = loadCreatures()
  const team = data.team.map((id) => data.list.find((c) => c.id === id)).filter(Boolean)
  if (!team.length) {
    game._showHomepageToast(t('teamNeedOne'))
    return
  }
  const btn = byId('team-battle-btn')
  game._teamFinding = true
  if (btn) {
    btn.disabled = true
    btn.textContent = t('teamFinding')
  }
  const ghost = await findGhost(game, team).catch(() => null)
  game._teamFinding = false
  renderTeamPanel(game)
  const foe = ghost ? t('teamGhostName', { name: ghost.name }) : t('teamBotName')
  const theirs = ghost ? ghost.team : botTeam(power(team), team.length)
  game._teamBattle = new TeamBattle({
    mine: team,
    theirs,
    foe,
    ghost: !!ghost,
    onEnd: (won) => {
      if (won === null) return 0
      const d = loadCreatures()
      if (won) d.wins++
      else d.losses++
      saveCreatures(d)
      const reward = won ? WIN_COINS : LOSS_COINS
      game.coins += reward
      saveShopProgress(game)
      game._renderCurrencyBar?.()
      renderTeamPanel(game)
      return reward
    },
    onAgain: () => startTeamBattle(game),
  })
  game._teamBattle.open()
}

export function bindTeamUI(game) {
  const page = byId('team-page')
  if (!page) return
  // Drawn each time the Pets tab is looked at (a catch in a game changes it).
  byId('inventory-tab-pets')?.addEventListener('click', () => renderTeamPanel(game))
  page.addEventListener('click', (e) => {
    const c = e.target.closest('.team-card[data-id]')
    if (c) toggle(game, Number(c.dataset.id))
  })
  byId('team-battle-btn')?.addEventListener('click', () => startTeamBattle(game))
}
