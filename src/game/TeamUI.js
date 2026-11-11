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
import { loadCreatures, saveCreatures, stats, power, powerName, powerInfo, creatureName, creatureType, rarityName, creatureIconURL, tierColor, botTeam, packTeam, unpackTeam, TEAM_SIZE, POWERS, TRIGGERS, TRIGGER_LEVEL, TYPE_MULT, MAX_LEVEL, EVOLVE_AT, levelOf, xpProgress, triggerOf, hasTrigger, triggerName, triggerInfo, COMBOS, combosOf, comboName, comboInfo, SNACKS, SNACK_IDS, snackImg, snackName, snackInfo, feedSnack, SHINY_ODDS, SHINY_BOOST } from './Creatures.js'
import { TeamBattle } from './TeamBattle.js'
import { renderTournament, playTournament } from './TeamTournament.js'
import * as PackLeaders from './PackLeaders.js'
import { renderLeaders, startLeaderBattle, nextLeader, badgeInfo } from './PackLeaders.js'
import * as Gauntlet from './Gauntlet.js'
import { saveShopProgress, saveSettings } from './Game.js'
import { zombieName } from './ZombieNames.js'
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
  const lv = levelOf(c)
  const xp = xpProgress(c)
  const trig = triggerOf(c)
  const on = hasTrigger(c)
  const tip = `${powerName(c)}: ${powerInfo(c)}\n${on ? '' : `${t('teamTrigLocked', { n: TRIGGER_LEVEL, name: '' }).trim()} `}${triggerName(trig)}: ${triggerInfo(trig)}${c.sn ? `\n${snackName(c.sn)}: ${snackInfo(c.sn)}` : ''}`
  return `<button type="button" class="perk-option team-card${slot ? ' picked' : ''}${c.s ? ' shiny' : ''}" data-id="${c.id}" style="--tier: ${tierColor(c.r)}" title="${esc(tip)}">
    ${slot ? `<span class="team-card-slot">${slot}</span>` : ''}
    ${c.s ? `<span class="team-card-shiny" title="${esc(t('teamShiny'))}">✦</span>` : ''}
    ${c.sn ? snackImg(c.sn, 'team-card-snack') : ''}
    <span class="team-card-level">${esc(t('teamLevel', { n: lv }))}</span>
    <img src="${creatureIconURL(c)}" alt="" draggable="false" />
    <span class="team-card-name">${esc(creatureName(c))}</span>
    <span class="team-card-type">${esc(rarityName(c.r))} ${esc(creatureType(c))}</span>
    <span class="team-card-stats">${esc(t('teamStats', { hp: s.hp, atk: s.atk }))}</span>
    <span class="team-card-xp" title="${esc(xp.need ? `${xp.have} / ${xp.need} XP` : 'MAX')}"><span style="width: ${xp.need ? (xp.have / xp.need) * 100 : 100}%"></span></span>
    <span class="team-card-power">${esc(powerName(c))}</span>
    <span class="team-card-power trig${on ? '' : ' locked'}">${esc(on ? triggerName(trig) : t('teamTrigLocked', { n: TRIGGER_LEVEL, name: triggerName(trig) }))}</span>
  </button>`
}

// The "Powers & types" guide under the team (a <details>, so it opens with a
// tap on phones too - card tooltips don't show there).
function renderGuide() {
  const el = byId('team-guide')
  if (!el) return
  const cap = (id) => id[0].toUpperCase() + id.slice(1)
  const row = (name, info) => `<li><b>${esc(name)}</b> - ${esc(info)}</li>`
  el.innerHTML = `<summary>${esc(t('teamGuideTitle'))}</summary>
    <p>${esc(t('teamTypeChart', { n: Math.round((TYPE_MULT - 1) * 100) }))}</p>
    <p>${esc(t('teamLevelHow', { max: MAX_LEVEL, a: EVOLVE_AT[0], b: EVOLVE_AT[1], p: TRIGGER_LEVEL }))}</p>
    <h4>${esc(t('teamGuidePowers'))}</h4>
    <ul>${POWERS.map((id) => row(t(`teamPower${cap(id)}`), t(`teamPowerInfo${cap(id)}`))).join('')}</ul>
    <h4>${esc(t('teamGuideTriggers', { n: TRIGGER_LEVEL }))}</h4>
    <ul>${POWERS.map((id) => row(`${t(`teamPower${cap(id)}`)} → ${triggerName(TRIGGERS[id])}`, triggerInfo(TRIGGERS[id]))).join('')}</ul>
    <h4>${esc(t('teamGuideCombos'))}</h4>
    <ul>${COMBOS.map((k) => row(`${comboName(k.id)} (${k.at.join(' / ')})`, comboInfo(k.id, k.n.join(' / ')))).join('')}</ul>
    <h4>${esc(t('teamSnacksTitle'))}</h4>
    <ul>${SNACK_IDS.map((id) => row(snackName(id), snackInfo(id))).join('')}</ul>
    <p>${esc(t('teamShinyHow', { n: SHINY_ODDS, p: Math.round(SHINY_BOOST * 100) }))}</p>`
}

// The team's combos (Creatures.combosOf): every group it has at least one
// of, lit up when it's on. The bonus is written out (no tooltips on phones).
function renderCombos(picked) {
  const el = byId('team-combos')
  if (!el) return
  const list = combosOf(picked)
  el.innerHTML = list.length
    ? list.map((k) => {
      const first = COMBOS.find((o) => o.id === k.id).n[0]
      const count = k.next ? `${k.have}/${k.next}` : 'MAX'
      return `<div class="team-combo${k.step ? ' on' : ''}">
        <b>${esc(comboName(k.id))}${k.step ? ` ${'★'.repeat(k.step)}` : ''}</b>
        <span class="team-combo-count">${esc(count)}</span>
        <span class="team-combo-info">${esc(comboInfo(k.id, k.n || first))}</span>
      </div>`
    }).join('')
    : `<p class="team-combo-none">${esc(t('teamComboNone'))}</p>`
}

// The snack shop: pick one (it lights up), then tap a team card to feed it.
function renderSnacks(game) {
  const el = byId('team-snacks')
  if (!el) return
  const armed = game._teamSnack
  el.innerHTML = `<h3 class="team-section-title">${esc(t('teamSnacksTitle'))}</h3>
    <p class="team-snack-hint">${esc(armed ? t('teamSnackPick', { name: snackName(armed) }) : t('teamSnackHint'))}</p>
    <div class="team-snack-row">${SNACK_IDS.map((id) => `<button type="button" class="team-snack${armed === id ? ' armed' : ''}" data-snack="${id}" aria-pressed="${armed === id}">
      ${snackImg(id, 'team-snack-icon')}
      <b>${esc(snackName(id))}</b>
      <span class="team-snack-info">${esc(snackInfo(id))}</span>
      <span class="team-snack-cost">${esc(t('teamSnackCost', { n: SNACKS[id].cost }))}</span>
    </button>`).join('')}</div>`
}

// A team card tapped with a snack picked: feed it, if there are coins.
function feed(game, id) {
  const snack = game._teamSnack
  const data = loadCreatures()
  const c = data.list.find((o) => o.id === id)
  if (!c) return
  if (!data.team.includes(id)) return game._showHomepageToast(t('teamSnackNotOnTeam'))
  if (c.sn) return game._showHomepageToast(t('teamSnackHas', { name: creatureName(c) }))
  const cost = SNACKS[snack].cost
  if ((game.coins || 0) < cost) return game._showHomepageToast(t('teamSnackCoins', { n: cost }))
  if (feedSnack(id, snack) !== 'ok') return
  game.coins -= cost
  saveShopProgress(game)
  game._renderCurrencyBar?.()
  game._teamSnack = null
  game._showHomepageToast(t('teamSnackFed', { name: creatureName(c), snack: snackName(snack) }))
  renderTeamPanel(game)
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
    renderCombos(picked)
  }
  set('team-combos-title', t('teamCombosTitle'))
  renderSnacks(game)
  const grid = byId('team-grid')
  if (grid) {
    // Newest first.
    grid.innerHTML = [...data.list].reverse().map((c) => card(c, data.team.indexOf(c.id) + 1)).join('')
  }
  renderHomePetPicker(game, data)
  renderGuide()
  const empty = byId('team-empty')
  if (empty) empty.style.display = data.list.length ? 'none' : ''
  // The Weekly Team Tournament (TeamTournament.js).
  renderTournament(game)
  // Pack Leaders (PackLeaders.js).
  renderLeaders()
  // The Gauntlet (Gauntlet.js).
  Gauntlet.renderGauntlet(game)
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
    // 2D or 3D (Settings > Team Battle View; the battle's own button
    // changes it too, and it's remembered).
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

// The Homepage pet dropdown (HomePet.js): none, your Pet Zombie, or any
// creature you caught. 'auto' shows as the Pet Zombie when you have one.
// Reads PetZombie's save (KEY) here instead of importing PetZombie.js,
// which would pull the camp code into the homepage bundle.
function savedPetName() {
  try {
    const d = JSON.parse(localStorage.getItem('gayz-pet-zombie') || 'null')
    return d && Number.isInteger(d.name) && d.name >= 0 ? d.name : null
  } catch { return null }
}

function renderHomePetPicker(game, data) {
  const sel = byId('home-pet-select')
  if (!sel) return
  const label = byId('home-pet-label')
  if (label) label.textContent = t('homePetLabel')
  const pet = savedPetName()
  const opts = [['none', t('homePetNone')]]
  if (pet !== null) opts.push(['pet', t('homePetZombie', { name: zombieName(pet) })])
  for (const c of [...data.list].reverse()) opts.push([`c${c.id}`, `${c.s ? '✦ ' : ''}${creatureName(c)} (${rarityName(c.r)} ${creatureType(c)})`])
  sel.innerHTML = opts.map(([v, text]) => `<option value="${esc(v)}">${esc(text)}</option>`).join('')
  let v = game.settings.homePet || 'auto'
  if (v === 'auto') v = pet !== null ? 'pet' : 'none'
  sel.value = opts.some(([o]) => o === v) ? v : 'none'
}

export function bindTeamUI(game) {
  const page = byId('team-page')
  if (!page) return
  // For a battle started elsewhere (a Pack Leader met in a game).
  game._renderTeamPanel = () => renderTeamPanel(game)
  // The ladder, for the tests (tests/team.spec.js).
  game._packLeaders = { ...PackLeaders, power }
  game._gauntlet = { ...Gauntlet, power }
  // Drawn each time the Pets tab is looked at (a catch in a game changes it).
  byId('inventory-tab-pets')?.addEventListener('click', () => renderTeamPanel(game))
  page.addEventListener('click', (e) => {
    if (e.target.closest('#gauntlet') && Gauntlet.gauntletClick(game, e, () => renderTeamPanel(game))) return
    const sb = e.target.closest('.team-snack[data-snack]')
    if (sb) {
      game._teamSnack = game._teamSnack === sb.dataset.snack ? null : sb.dataset.snack
      renderTeamPanel(game)
      return
    }
    const lb = e.target.closest('.leader-badge[data-leader]')
    if (lb) {
      game._showHomepageToast(badgeInfo(Number(lb.dataset.leader)))
      return
    }
    const c = e.target.closest('.team-card[data-id]')
    if (!c) return
    if (game._teamSnack) feed(game, Number(c.dataset.id))
    else toggle(game, Number(c.dataset.id))
  })
  byId('home-pet-select')?.addEventListener('change', (e) => {
    game.settings.homePet = e.target.value
    saveSettings(game.settings)
    game._refreshHomePet?.()
  })
  byId('team-battle-btn')?.addEventListener('click', () => startTeamBattle(game))
  byId('tourney-btn')?.addEventListener('click', () => playTournament(game, renderTeamPanel))
  byId('leaders-btn')?.addEventListener('click', () => {
    const n = nextLeader()
    if (n >= 0) startLeaderBattle(game, n)
  })
}
