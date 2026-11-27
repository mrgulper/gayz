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
import { loadCreatures, saveCreatures, stats, power, powerName, powerInfo, creatureName, creatureType, rarityName, creatureIconURL, tierColor, botTeam, packTeam, unpackTeam, TEAM_SIZE, POWERS, TRIGGERS, TRIGGER_LEVEL, TYPE_MULT, MAX_LEVEL, EVOLVE_AT, levelOf, xpProgress, triggerOf, hasTrigger, triggerName, triggerInfo, COMBOS, combosOf, comboName, comboInfo, SNACKS, SNACK_IDS, snackImg, snackName, snackInfo, feedSnack, SHINY_ODDS, SHINY_BOOST, kindName, kindNote, renameCreature, setNickFilter, NICK_MAX, ITEM_IDS, itemImg, itemName, itemInfo, holdItem, takeItem, MAX_CREATURES, EGG_MAX } from './Creatures.js'
import { TeamBattle, playReplay, HAZARD_IDS, HAZARD_EVERY, hazardName, hazardInfo, CHEER_IDS, cheerName, cheerInfo } from './TeamBattle.js'
import { renderTournament, playTournament } from './TeamTournament.js'
import * as PackLeaders from './PackLeaders.js'
import { renderLeaders, startLeaderBattle, nextLeader, badgeInfo } from './PackLeaders.js'
import * as Gauntlet from './Gauntlet.js'
import * as PetEggs from './PetEggs.js'
import * as PetShop from './PetShop.js'
import { renderFriendBattle, bindFriendBattle } from './FriendBattle.js'
import { renderPetTrade, bindPetTrade } from './PetTrade.js'
import { bindReplays, renderReplays } from './PetReplays.js'
import * as Weekly from './WeeklyChallenge.js'
import { bindPetBook, renderPetBook, updateBook, bookTest } from './PetBook.js'
import * as ReplayStore from './ReplayStore.js'
import * as PetRank from './PetRank.js'
import { bindReorder } from './Reorder.js'
import { saveShopProgress, saveSettings, _censorText } from './Game.js'
import { zombieName } from './ZombieNames.js'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import * as PetRaid from './PetRaid.js'

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
  const note = kindNote(c)
  const tip = `${c.nm ? `${c.nm} - ${kindName(c)}\n` : ''}${powerName(c)}: ${powerInfo(c)}\n${on ? '' : `${t('teamTrigLocked', { n: TRIGGER_LEVEL, name: '' }).trim()} `}${triggerName(trig)}: ${triggerInfo(trig)}${c.sn ? `\n${snackName(c.sn)}: ${snackInfo(c.sn)}` : ''}${c.hi ? `\n${itemName(c.hi)}: ${itemInfo(c.hi)}` : ''}`
  return `<button type="button" class="perk-option team-card${slot ? ' picked' : ''}${c.s ? ' shiny' : ''}" data-id="${c.id}" style="--tier: ${tierColor(c.r)}" title="${esc(tip)}">
    ${slot ? `<span class="team-card-slot">${slot}</span>` : ''}
    ${c.s ? `<span class="team-card-shiny" title="${esc(t('teamShiny'))}">✦</span>` : ''}
    ${c.sn ? snackImg(c.sn, 'team-card-snack') : ''}
    ${c.hi ? itemImg(c.hi, 'team-card-item') : ''}
    <span class="team-card-level">${esc(t('teamLevel', { n: lv }))}</span>
    <img src="${creatureIconURL(c)}" alt="" draggable="false" />
    <span class="team-card-name">${esc(creatureName(c))}</span>
    ${note ? `<span class="team-card-kind">${esc(note)}</span>` : ''}
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
    <h4>${esc(t('teamGuideShop'))}</h4>
    <ul>${POWERS.map((id) => row(`${t(`teamPower${cap(id)}`)} → ${Gauntlet.shopPowerName(Gauntlet.SHOP_POWERS[id])}`, Gauntlet.shopPowerInfo(Gauntlet.SHOP_POWERS[id]))).join('')}</ul>
    <h4>${esc(t('teamGuideCombos'))}</h4>
    <ul>${COMBOS.map((k) => row(`${comboName(k.id)} (${k.at.join(' / ')})`, comboInfo(k.id, k.n.join(' / ')))).join('')}</ul>
    <h4>${esc(t('teamSnacksTitle'))}</h4>
    <ul>${SNACK_IDS.map((id) => row(snackName(id), snackInfo(id))).join('')}</ul>
    <h4>${esc(t('itemsTitle'))}</h4>
    <ul>${ITEM_IDS.map((id) => row(itemName(id), itemInfo(id))).join('')}</ul>
    <h4>${esc(t('hazardTitle'))}</h4>
    <p>${esc(t('hazardHow', { n: HAZARD_EVERY }))}</p>
    <ul>${HAZARD_IDS.map((id) => row(hazardName(id), hazardInfo(id))).join('')}</ul>
    <h4>${esc(t('cheerTitle'))}</h4>
    <p>${esc(t('cheerHow'))}</p>
    <ul>${CHEER_IDS.map((id) => row(cheerName(id), cheerInfo(id))).join('')}</ul>
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

// Held items (Batch D, 2026-11-23): the bag of items found. Pick one (it
// lights up), then tap any creature to give it; what it held goes back in
// the bag. "Take an item off", then a creature, puts its item back.
// game._teamItem: null, an item id, or 'off'.
function renderItems(game) {
  const el = byId('team-items')
  if (!el) return
  const bag = loadCreatures().items
  let armed = game._teamItem
  if (armed && armed !== 'off' && !bag[armed]) armed = game._teamItem = null
  const have = ITEM_IDS.filter((id) => bag[id])
  const hint = armed === 'off' ? t('itemOffPick') : armed ? t('itemPick', { name: itemName(armed) }) : t('itemHint')
  el.innerHTML = `<h3 class="team-section-title">${esc(t('itemsTitle'))}</h3>
    <p class="team-snack-hint">${esc(hint)}</p>
    <div class="team-snack-row">${have.map((id) => `<button type="button" class="team-snack${armed === id ? ' armed' : ''}" data-item="${id}" aria-pressed="${armed === id}">
      ${itemImg(id, 'team-snack-icon')}
      <b>${esc(itemName(id))}</b>
      <span class="team-snack-info">${esc(itemInfo(id))}</span>
      <span class="team-item-count">x${bag[id]}</span>
    </button>`).join('')}
    <button type="button" class="team-snack team-rename-btn${armed === 'off' ? ' armed' : ''}" data-item="off" aria-pressed="${armed === 'off'}">${esc(t('itemOffBtn'))}</button></div>
    ${have.length ? '' : `<p class="team-item-none">${esc(t('itemNone'))}</p>`}`
}

// Pet eggs (Batch F, 2026-11-23, PetEggs.js): found in Loot Chests, the
// first EGG_WARM warm up as you walk. Tap a waiting egg to warm it
// instead; tap a ready one (no room when it was due) to hatch it.
function renderEggs() {
  const el = byId('team-eggs')
  if (!el) return
  const eggs = loadCreatures().eggs
  const cards = eggs.map((e, i) => {
    const need = PetEggs.eggNeed(e.r)
    const ready = e.d >= need
    const warm = PetEggs.isWarm(i)
    const state = ready ? t('eggReady') : warm ? t('eggWarming') : t('eggWaiting')
    return `<button type="button" class="team-snack team-egg${warm ? ' warm' : ''}${ready ? ' armed' : ''}" data-egg="${i}" style="--tier: ${tierColor(e.r)}">
      <img class="team-snack-icon" src="${PetEggs.eggIconURL(e.r)}" alt="" draggable="false" />
      <b>${esc(PetEggs.eggName(e.r))}</b>
      <span class="team-egg-bar"><span style="width: ${Math.round(100 * Math.min(1, e.d / need))}%"></span></span>
      <span class="team-snack-info">${esc(t('eggWalked', { d: e.d, n: need }))}</span>
      <span class="team-item-count">${esc(state)}</span>
    </button>`
  }).join('')
  el.innerHTML = `<h3 class="team-section-title">${esc(t('eggsTitle', { n: eggs.length, max: EGG_MAX }))}</h3>
    <p class="team-snack-hint">${esc(t('eggsHint', { n: PetEggs.EGG_WARM }))}</p>
    ${eggs.length ? `<div class="team-snack-row">${cards}</div>` : `<p class="team-item-none">${esc(t('eggsNone'))}</p>`}`
}

// An egg tapped.
function eggClick(game, i) {
  const e = loadCreatures().eggs[i]
  if (!e) return
  if (e.d >= PetEggs.eggNeed(e.r)) {
    const res = PetEggs.hatchEgg(i)
    if (res === 'full') game._showHomepageToast(t('eggFull', { n: MAX_CREATURES }))
    else if (typeof res === 'object') game._showHomepageToast(PetEggs.hatchText({ r: e.r, c: res }))
  } else if (PetEggs.isWarm(i)) {
    game._showHomepageToast(t('eggWalkMore', { n: PetEggs.eggNeed(e.r) - e.d }))
  } else if (PetEggs.warmEgg(i)) game._showHomepageToast(t('eggNowWarm', { egg: PetEggs.eggName(e.r) }))
  renderTeamPanel(game)
}

// A card tapped with an item picked (or "take off").
function giveOrTake(game, id) {
  const item = game._teamItem
  const c = loadCreatures().list.find((o) => o.id === id)
  if (!c) return
  if (item === 'off') {
    const was = takeItem(id)
    game._showHomepageToast(was ? t('itemTookOff', { name: creatureName(c), item: itemName(was) }) : t('itemNoneHeld', { name: creatureName(c) }))
  } else {
    const res = holdItem(id, item)
    if (res === 'same') return game._showHomepageToast(t('itemSame', { name: creatureName(c) }))
    if (res !== 'ok') return
    game._showHomepageToast(t('itemGiven', { name: creatureName(c), item: itemName(item) }))
  }
  game._teamItem = null
  renderTeamPanel(game)
}

// Nicknames (2026-11-23): "Rename a creature", tap any card, type a name.
// game._teamRename: null, 'pick' (waiting for a card) or the creature's id
// (its name box is open).
function renderRename(game) {
  const el = byId('team-rename')
  if (!el) return
  let st = game._teamRename
  const c = typeof st === 'number' ? loadCreatures().list.find((o) => o.id === st) : null
  if (typeof st === 'number' && !c) st = game._teamRename = null
  const title = `<h3 class="team-section-title">${esc(t('teamRenameTitle'))}</h3>`
  if (c) {
    el.innerHTML = `${title}
      <p class="team-snack-hint">${esc(t('teamRenameFor', { name: kindName(c) }))}</p>
      <div class="team-rename-box">
        <input type="text" id="team-rename-input" maxlength="${NICK_MAX}" value="${esc(c.nm || '')}" placeholder="${esc(kindName(c))}" autocomplete="off" spellcheck="false" aria-label="${esc(t('teamRenameTitle'))}" />
        <label class="team-rename-kind"><input type="checkbox" id="team-rename-kind"${c.nk ? ' checked' : ''} /> ${esc(t('teamRenameShowKind'))}</label>
        <div class="team-rename-btns">
          <button type="button" class="team-snack team-rename-btn" data-rename="save">${esc(t('teamRenameSave'))}</button>
          ${c.nm ? `<button type="button" class="team-snack team-rename-btn" data-rename="clear">${esc(t('teamRenameClear'))}</button>` : ''}
          <button type="button" class="team-snack team-rename-btn" data-rename="cancel">${esc(t('teamRenameCancel'))}</button>
        </div>
      </div>`
    return
  }
  el.innerHTML = `${title}
    <p class="team-snack-hint">${esc(t(st === 'pick' ? 'teamRenamePick' : 'teamRenameHint'))}</p>
    <div class="team-snack-row"><button type="button" class="team-snack team-rename-btn${st === 'pick' ? ' armed' : ''}" data-rename="arm" aria-pressed="${st === 'pick'}">${esc(t('teamRenameBtn'))}</button></div>`
}

function renameAction(game, what) {
  const id = game._teamRename
  if (what === 'arm') {
    game._teamRename = id === 'pick' ? null : 'pick'
    game._teamSnack = null
    game._teamItem = null
  } else if (what === 'cancel') {
    game._teamRename = null
  } else if (typeof id === 'number' && (what === 'save' || what === 'clear')) {
    const name = what === 'clear' ? '' : (byId('team-rename-input')?.value || '')
    const c = renameCreature(id, name, !!byId('team-rename-kind')?.checked)
    game._teamRename = null
    if (c) game._showHomepageToast(c.nm ? t('teamRenamed', { name: c.nm }) : t('teamRenameCleared', { name: kindName(c) }))
  }
  renderTeamPanel(game)
}

// A card tapped while "Rename a creature" is on: open its name box.
function pickToRename(game, id) {
  game._teamRename = id
  renderTeamPanel(game)
  const input = byId('team-rename-input')
  if (input) {
    input.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    input.focus({ preventScroll: true })
    input.select()
  }
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
  game._playStats?.countCoins?.('bankOut', 'pets', cost)
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
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
  // Trophies + rank badge (PetRank.js, Batch M).
  PetRank.renderRankLine()
  set('team-picked-title', t('teamPickedTitle', { n: data.team.length, max: TEAM_SIZE }))
  set('team-order-hint', data.team.length > 1 ? t('teamOrderHint') : '')
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
  renderItems(game)
  renderEggs()
  renderFriendBattle(game)
  renderPetTrade()
  renderRename(game)
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
  // The Weekly Challenge (WeeklyChallenge.js).
  Weekly.renderWeekly()
  // The co-op Boss Raid (PetRaid.js).
  PetRaid.renderRaid()
  // The Gauntlet (Gauntlet.js).
  Gauntlet.renderGauntlet(game)
  // The daily Pet Shop (PetShop.js).
  PetShop.renderPetShop(game)
  // Replays (PetReplays.js): the list, when it's open.
  renderReplays()
  // Collection book (PetBook.js, Batch K): when it's open.
  renderPetBook(game)
  const btn = byId('team-battle-btn')
  if (btn && !game._teamFinding) {
    btn.textContent = t('teamBattleBtn')
    btn.disabled = !data.team.length
  }
}

// The Pets panel (its own homepage button since 2026-11-25; was
// Inventory > Pets). Drawn each time it opens (a catch in a game changes it).
export function openTeamPanel(game) {
  game._closeAllMenuPanels()
  const panel = byId('pets-panel')
  if (!panel) return
  panel.style.display = 'flex'
  renderTeamPanel(game)
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
      // Trophies for the leaderboard (PetRank.js, Batch M): only this
      // Battle button counts.
      const tr = PetRank.applyTrophies(d, won, power(team), power(theirs))
      saveCreatures(d)
      PetRank.pushTrophies(game)
      const reward = won ? WIN_COINS : LOSS_COINS
      game.coins += reward
      game._playStats?.countCoins?.('bankIn', 'pets', reward)
      saveShopProgress(game)
      game._renderCurrencyBar?.()
      renderTeamPanel(game)
      return { coins: reward, tr: tr.delta, rank: tr.rank ? PetRank.rankName(tr.rank) : null }
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
  // Nicknames other players typed go through the chat bad-word swap too.
  setNickFilter(_censorText)
  // For a battle started elsewhere (a Pack Leader met in a game).
  game._renderTeamPanel = () => renderTeamPanel(game)
  // The ladder, for the tests (tests/team.spec.js).
  game._packLeaders = { ...PackLeaders, power }
  game._gauntlet = { ...Gauntlet, power }
  game._petShop = PetShop
  game._weekly = { ...Weekly, power }
  game._petRaid = { ...PetRaid }
  bindFriendBattle(game)
  // Pet trading (PetTrade.js, Batch N): its window draws pets like here.
  bindPetTrade(game, { card })
  // Replays (PetReplays.js, Batch J): a replay is the battle that's up.
  TeamBattle.track = (b) => { game._teamBattle = b }
  bindReplays(game)
  bindPetBook(game)
  // The pet battle leaderboard (PetRank.js, Batch M).
  PetRank.bindPetRank(game)
  game._petRank = PetRank
  game._replays = { ...ReplayStore, TeamBattle, playReplay }
  game._creatures = { packTeam, unpackTeam, loadCreatures, saveCreatures }
  // The Collection book, for the tests (tests/team.spec.js).
  game._petBook = { updateBook, renderPetBook, ...bookTest }
  // The homepage Pets button; clicking the dark backdrop closes the panel.
  byId('pets-btn')?.addEventListener('click', () => {
    game._lastPanelOpener = () => openTeamPanel(game)
    openTeamPanel(game)
  })
  const petsPanel = byId('pets-panel')
  petsPanel?.addEventListener('click', (e) => { if (e.target === petsPanel) game._closeAllMenuPanels() })
  // Drag to reorder (Reorder.js): the picked team, and the Gauntlet team.
  bindReorder(page, game, {
    selector: '#team-slots .team-card[data-id]',
    index: (el) => [...el.parentElement.querySelectorAll('.team-card[data-id]')].indexOf(el),
    onMove: (from, to) => {
      const data = loadCreatures()
      if (!data.team[from] || to >= data.team.length) return
      data.team.splice(to, 0, data.team.splice(from, 1)[0])
      saveCreatures(data)
      renderTeamPanel(game)
    },
  })
  bindReorder(page, game, {
    selector: '#gauntlet-team [data-gt-sell]',
    index: (el) => Number(el.dataset.gtSell),
    onMove: (from, to) => {
      Gauntlet.moveTeam(from, to)
      renderTeamPanel(game)
    },
  })
  // Shop > Pets (Pet Shop + eggs) is handled by the same click code.
  const onClick = (e) => {
    if (game._teamDragged) return
    if (e.target.closest('#pet-shop') && PetShop.petShopClick(game, e, () => renderTeamPanel(game))) return
    if (e.target.closest('#gauntlet') && Gauntlet.gauntletClick(game, e, () => renderTeamPanel(game))) return
    const rb = e.target.closest('[data-rename]')
    if (rb) {
      renameAction(game, rb.dataset.rename)
      return
    }
    const sb = e.target.closest('.team-snack[data-snack]')
    if (sb) {
      game._teamSnack = game._teamSnack === sb.dataset.snack ? null : sb.dataset.snack
      if (game._teamSnack) game._teamRename = game._teamItem = null
      renderTeamPanel(game)
      return
    }
    const ib = e.target.closest('.team-snack[data-item]')
    if (ib) {
      game._teamItem = game._teamItem === ib.dataset.item ? null : ib.dataset.item
      if (game._teamItem) game._teamRename = game._teamSnack = null
      renderTeamPanel(game)
      return
    }
    const eb = e.target.closest('.team-egg[data-egg]')
    if (eb) {
      eggClick(game, Number(eb.dataset.egg))
      return
    }
    const lb = e.target.closest('.leader-badge[data-leader]')
    if (lb) {
      game._showHomepageToast(badgeInfo(Number(lb.dataset.leader)))
      return
    }
    const c = e.target.closest('.team-card[data-id]')
    if (!c) return
    if (game._teamRename === 'pick') pickToRename(game, Number(c.dataset.id))
    else if (game._teamItem) giveOrTake(game, Number(c.dataset.id))
    else if (game._teamSnack) feed(game, Number(c.dataset.id))
    else toggle(game, Number(c.dataset.id))
  }
  page.addEventListener('click', onClick)
  byId('shop-pets')?.addEventListener('click', onClick)
  // In the name box: Enter saves, Escape closes.
  page.addEventListener('keydown', (e) => {
    if (e.target.id !== 'team-rename-input') return
    if (e.key === 'Enter') { e.preventDefault(); renameAction(game, 'save') }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renameAction(game, 'cancel') }
  })
  byId('home-pet-select')?.addEventListener('change', (e) => {
    game.settings.homePet = e.target.value
    saveSettings(game.settings)
    game._refreshHomePet?.()
  })
  byId('team-battle-btn')?.addEventListener('click', () => startTeamBattle(game))
  byId('tourney-btn')?.addEventListener('click', () => playTournament(game, renderTeamPanel))
  // Weekly Challenge: the section is redrawn, so listen on the box.
  byId('weekly-challenge')?.addEventListener('click', (e) => {
    if (e.target.closest('#weekly-btn')) Weekly.startWeekly(game)
  })
  // Boss Raid with the helper bot (the friend list is FriendBattle.js's).
  byId('pet-raid-body')?.addEventListener('click', (e) => {
    if (e.target.closest('#raid-solo-btn')) PetRaid.startSoloRaid(game)
  })
  byId('leaders-btn')?.addEventListener('click', () => {
    const n = nextLeader()
    if (n >= 0) startLeaderBattle(game, n)
  })
}
