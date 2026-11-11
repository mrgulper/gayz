// The Gauntlet (2026-11-11, team battle batch 4). A run of its own on the
// Team page (Inventory > Pets, TeamUI.js), separate from the creatures
// you've caught - they're never used or changed.
//
// Gaymi picked: coins only as the prize, 3 lives, a shop where you can buy,
// sell and reroll, and both bots and real players to fight.
//
// A run: every round you get ROUND_GOLD gold (leftovers kept) and a shop of
// SHOP_SIZE random creatures at PRICE gold each. Buy them onto your
// Gauntlet team (slots() grows from 3 to MAX_SLOTS over the run), sell one
// for half back, or REROLL for new choices. 3 copies of the same creature
// at the same stars merge into one with a star more: stars are levels
// (STAR_LEVEL), so a merge also evolves it one rarity up, and 2 stars
// unlock its level 5 trigger power - the same rules as caught creatures.
// Then a normal team battle (TeamBattle.js, no XP). Win WINS_NEEDED before
// LIVES losses. Every win pays WIN_COINS real coins, the last one DONE_COINS
// more.
//
// The other team: another player's Gauntlet team saved at the same battle
// number (gauntletTeams in Firestore, CloudSync.fetchGauntletTeams), or a
// bot that played the same shop for as many rounds (botRun). Starting a
// battle while signed in saves your team for others to meet. Leaving a
// battle before it ends is no win and no loss: you meet the same team again.
//
// Saved in localStorage (GAUNTLET_KEY), so Cloud Save carries it.
import * as CloudSync from './CloudSync.js'
import { cleanCreature, stats, creatureName, creatureType, rarityName, creatureIconURL, tierColor, packTeam, unpackTeam, powerName, levelOf } from './Creatures.js'
import { PlayAnimals } from './PlayAnimals.js'
import { ZOMBIE_TIER_IDS, NAME_COUNT } from './ZombieNames.js'
import { TeamBattle } from './TeamBattle.js'
import { saveShopProgress, saveSettings } from './Game.js'
import { t } from './i18n.js'

export const GAUNTLET_KEY = 'gayz-gauntlet'
export const WINS_NEEDED = 10
export const LIVES = 3
export const ROUND_GOLD = 10
export const PRICE = 3
export const REROLL = 1
export const SHOP_SIZE = 5
export const MAX_SLOTS = 7
export const MAX_STARS = 3
// Stars -> level: 1 star is level 1, 2 stars level 10, 3 stars level 20.
export const STAR_LEVEL = [1, 10, 20]
export const WIN_COINS = 15
export const DONE_COINS = 100
// A kind on your team turns up in the shop more often (easier merges).
const OWNED_ODDS = 0.35
const FIND_TIMEOUT_MS = 4000
// Other players' teams are fetched once and kept this long (fewer reads).
const CACHE_MS = 10 * 60 * 1000

// What the shop sells. Dinosaurs only from battle DINO_FROM.
const POOL = [
  { t: 'z', k: null }, { t: 'z', k: 'hunched' }, { t: 'z', k: 'brute' }, { t: 'z', k: 'beast' }, { t: 'z', k: 'crawler' },
  { t: 'z', k: 'minion' }, { t: 'z', k: 'rogue' }, { t: 'z', k: 'warrior' }, { t: 'z', k: 'mage' },
  { t: 'a', k: 'wolf' }, { t: 'a', k: 'bear' }, { t: 'a', k: 'boar' }, { t: 'a', k: 'lion' }, { t: 'a', k: 'crocodile' },
  { t: 'a', k: 'eagle' }, { t: 'a', k: 'bat' },
  { t: 'a', k: 'velociraptor', dino: true }, { t: 'a', k: 'triceratops', dino: true },
]
export const DINO_FROM = 5

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const byId = (id) => document.getElementById(id)

// Team slots at battle b: 3, 3, 4, 4, 5, 5, 6, 6, 7...
export const slots = (b) => Math.min(MAX_SLOTS, 3 + Math.floor((b - 1) / 2))
export const starsOf = (c) => (levelOf(c) >= STAR_LEVEL[2] ? 3 : levelOf(c) >= STAR_LEVEL[1] ? 2 : 1)
export const sellPrice = (c) => Math.floor((PRICE * 3 ** (starsOf(c) - 1)) / 2)
const sameKey = (c) => `${c.t}:${c.k || ''}:${starsOf(c)}`

function poolFor(b) {
  const kinds = PlayAnimals.KINDS
  return POOL.filter((p) => (p.t === 'z' || Object.hasOwn(kinds, p.k)) && (!p.dino || b >= DINO_FROM))
}

// One creature for the shop: a random kind (or one already on the team),
// rarer ones possible later in the run.
function offer(b, team, rand) {
  let base
  if (team.length && rand() < OWNED_ODDS) {
    const c = team[Math.floor(rand() * team.length)]
    base = { t: c.t, k: c.k }
  } else {
    const pool = poolFor(b)
    base = pool[Math.floor(rand() * pool.length)]
  }
  const top = Math.min(4, Math.floor((b - 1) / 2))
  const r = ZOMBIE_TIER_IDS[Math.floor(rand() * rand() * (top + 1))]
  return base.t === 'a'
    ? { t: 'a', k: base.k, r }
    : { t: 'z', k: base.k, r, n: Math.floor(rand() * NAME_COUNT), b: false }
}

export function rollShop(b, team, rand = Math.random) {
  return Array.from({ length: SHOP_SIZE }, () => offer(b, team, rand))
}

// Merges every 3 of a kind (same stars) into one with a star more, again
// and again (a merge can make a third 2-star). Its rarity: the best of the
// three, one step up. -> the merged creatures (for the message).
export function mergeAll(team) {
  const made = []
  for (;;) {
    const groups = new Map()
    team.forEach((c, i) => {
      if (starsOf(c) >= MAX_STARS) return
      const k = sameKey(c)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(i)
    })
    const three = [...groups.values()].find((g) => g.length >= 3)
    if (!three) return made
    const picked = three.slice(0, 3).map((i) => team[i])
    const best = Math.max(...picked.map((c) => ZOMBIE_TIER_IDS.indexOf(c.r)))
    const merged = { ...picked[0], r: ZOMBIE_TIER_IDS[Math.min(ZOMBIE_TIER_IDS.length - 1, best + 1)], l: STAR_LEVEL[starsOf(picked[0])] }
    for (const i of three.slice(0, 3).reverse()) team.splice(i, 1)
    team.splice(Math.min(three[0], team.length), 0, merged)
    made.push(merged)
  }
}

// Can c join the team? Room for it, or it makes a 3 of a kind (a merge
// that frees room).
export function canAdd(team, c, b) {
  if (team.length < slots(b)) return true
  return team.filter((o) => sameKey(o) === sameKey(c)).length >= 2
}

// A made-up rival: plays the same shop as well as it can for b rounds.
export function botRun(b, rand = Math.random) {
  const team = []
  let gold = 0
  for (let r = 1; r <= b; r++) {
    gold += ROUND_GOLD
    let shop = rollShop(r, team, rand)
    let rerolls = 0
    for (;;) {
      // A merge first, then anything while there's room.
      let i = shop.findIndex((c) => c && team.length >= slots(r) && canAdd(team, c, r))
      if (i < 0) i = shop.findIndex((c) => c && team.filter((o) => sameKey(o) === sameKey(c)).length === 2)
      if (i < 0 && team.length < slots(r)) i = shop.findIndex(Boolean)
      if (i >= 0 && gold >= PRICE) {
        gold -= PRICE
        team.push(shop[i])
        shop[i] = null
        mergeAll(team)
        continue
      }
      if (gold >= PRICE + REROLL && rerolls < 3) {
        gold -= REROLL
        rerolls++
        shop = rollShop(r, team, rand)
        continue
      }
      break
    }
  }
  return team
}

// --- saved state ---

function blankSave() {
  return { run: null, best: 0, runs: 0, done: 0, last: null }
}

const cleanList = (list, max) => (Array.isArray(list) ? list : []).slice(0, max)
  .map((c) => (c ? cleanCreature(c) : null))
  .map((c) => (c ? (({ sn: _sn, x: _x, s: _s, at: _at, ...o }) => o)(c) : null))

// Never trusted (localStorage, maybe a shared save file).
export function loadGauntlet() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(GAUNTLET_KEY) || 'null')
  } catch {
    d = null
  }
  const out = blankSave()
  if (!d || typeof d !== 'object') return out
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null)
  out.best = int(d.best, 0, WINS_NEEDED) ?? 0
  out.runs = int(d.runs, 0, 1e9) ?? 0
  out.done = int(d.done, 0, 1e9) ?? 0
  if (d.last && typeof d.last === 'object') {
    const w = int(d.last.wins, 0, WINS_NEEDED)
    if (w !== null) out.last = { wins: w }
  }
  const r = d.run
  if (r && typeof r === 'object') {
    const wins = int(r.wins, 0, WINS_NEEDED - 1)
    const lives = int(r.lives, 1, LIVES)
    const battle = int(r.battle, 1, WINS_NEEDED + LIVES)
    if (wins !== null && lives !== null && battle !== null) {
      const team = cleanList(r.team, MAX_SLOTS).filter(Boolean)
      const shop = cleanList(r.shop, SHOP_SIZE)
      while (shop.length < SHOP_SIZE) shop.push(null)
      let foe = null
      if (r.foe && typeof r.foe === 'object') {
        const ft = unpackTeam(r.foe.team)
        const name = typeof r.foe.name === 'string' ? r.foe.name.slice(0, 24) : ''
        if (ft.length) foe = { name, bot: !!r.foe.bot, team: ft }
      }
      out.run = { battle, wins, lives, gold: int(r.gold, 0, 9999) ?? 0, team, shop, foe }
    }
  }
  return out
}

function saveGauntlet(d) {
  const run = d.run && {
    ...d.run,
    foe: d.run.foe && { name: d.run.foe.name, bot: d.run.foe.bot, team: packTeam(d.run.foe.team) },
  }
  try {
    localStorage.setItem(GAUNTLET_KEY, JSON.stringify({ ...d, run }))
  } catch {
    // Full storage: not kept.
  }
}

// --- the other team ---

let _cache = null // { at, rows }

async function playerRows(game) {
  if (!navigator.onLine || !CloudSync.isConfigured()) return []
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.rows
  const rows = await CloudSync.fetchGauntletTeams(game._cloudUid).catch(() => null)
  if (!rows) return []
  _cache = { at: Date.now(), rows }
  return rows
}

// Another player's team at the same battle, else a bot. Saves mine first
// (signed in only).
async function findFoe(game, run) {
  const work = (async () => {
    const uid = game._cloudUid
    if (uid && navigator.onLine && CloudSync.isConfigured()) {
      const nickname = (game.settings?.nickname || '').trim().slice(0, 24) || t('teamDefaultNick')
      CloudSync.saveGauntletTeam(uid, { nickname, team: packTeam(run.team), round: run.battle, wins: run.wins }).catch(() => {})
    }
    const rows = (await playerRows(game))
      .filter((r) => r.round === run.battle && typeof r.nickname === 'string' && r.nickname.trim())
      .map((r) => ({ name: r.nickname.trim().slice(0, 24), bot: false, team: unpackTeam(r.team).slice(0, MAX_SLOTS) }))
      .filter((r) => r.team.length)
    return rows.length ? rows[Math.floor(Math.random() * rows.length)] : null
  })()
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), FIND_TIMEOUT_MS))
  const found = await Promise.race([work, timeout]).catch(() => null)
  return found || { name: t('gauntletBotName', { n: run.battle }), bot: true, team: botRun(run.battle) }
}

// --- actions (the buttons) ---

export function startRun() {
  const d = loadGauntlet()
  d.run = { battle: 1, wins: 0, lives: LIVES, gold: ROUND_GOLD, team: [], shop: rollShop(1, []), foe: null }
  d.runs++
  saveGauntlet(d)
  return d.run
}

// -> '' when it worked, else the i18n key of why not.
export function buy(i) {
  const d = loadGauntlet()
  const run = d.run
  const c = run?.shop[i]
  if (!c) return 'gauntletGone'
  if (run.gold < PRICE) return 'gauntletNoGold'
  if (!canAdd(run.team, c, run.battle)) return 'gauntletFull'
  run.gold -= PRICE
  run.team.push(c)
  run.shop[i] = null
  const made = mergeAll(run.team)
  run.foe = null
  saveGauntlet(d)
  return made.length ? { merged: made[made.length - 1] } : ''
}

export function sell(i) {
  const d = loadGauntlet()
  const run = d.run
  const c = run?.team[i]
  if (!c) return 0
  run.team.splice(i, 1)
  const back = sellPrice(c)
  run.gold += back
  run.foe = null
  saveGauntlet(d)
  return back
}

export function reroll() {
  const d = loadGauntlet()
  const run = d.run
  if (!run) return 'gauntletGone'
  if (run.gold < REROLL) return 'gauntletNoGold'
  run.gold -= REROLL
  run.shop = rollShop(run.battle, run.team)
  saveGauntlet(d)
  return ''
}

export function giveUp() {
  const d = loadGauntlet()
  if (!d.run) return
  d.last = { wins: d.run.wins }
  d.best = Math.max(d.best, d.run.wins)
  d.run = null
  saveGauntlet(d)
}

// A battle finished (won: true / false). -> the coins it paid.
export function finishBattle(won) {
  const d = loadGauntlet()
  const run = d.run
  if (!run) return 0
  let reward = 0
  if (won) {
    run.wins++
    reward = WIN_COINS + (run.wins >= WINS_NEEDED ? DONE_COINS : 0)
  } else run.lives--
  run.battle++
  run.foe = null
  if (run.wins >= WINS_NEEDED || run.lives <= 0) {
    d.last = { wins: run.wins }
    d.best = Math.max(d.best, run.wins)
    if (run.wins >= WINS_NEEDED) d.done++
    d.run = null
  } else {
    run.gold += ROUND_GOLD
    run.shop = rollShop(run.battle, run.team)
  }
  saveGauntlet(d)
  return reward
}

// --- the Team page section ---

function card(c, { price, sellFor, i, kind }) {
  const s = stats(c)
  const stars = starsOf(c)
  const label = kind === 'buy' ? t('gauntletPrice', { n: price }) : t('gauntletSell', { n: sellFor })
  return `<button type="button" class="perk-option team-card gt-card" data-gt-${kind}="${i}" style="--tier: ${tierColor(c.r)}" title="${esc(`${powerName(c)} · ${label}`)}">
    <span class="team-card-level gt-stars" aria-label="${esc(t('gauntletStars', { n: stars }))}">${'★'.repeat(stars)}</span>
    <img src="${creatureIconURL(c)}" alt="" draggable="false" />
    <span class="team-card-name">${esc(creatureName(c))}</span>
    <span class="team-card-type">${esc(rarityName(c.r))} ${esc(creatureType(c))}</span>
    <span class="team-card-stats">${esc(t('teamStats', { hp: s.hp, atk: s.atk }))}</span>
    <span class="team-card-power">${esc(powerName(c))}</span>
    <span class="gt-price">${esc(label)}</span>
  </button>`
}

export function renderGauntlet(game) {
  const d = loadGauntlet()
  const run = d.run
  const set = (id, text) => { const el = byId(id); if (el) el.textContent = text }
  set('gauntlet-title', t('gauntletTitle'))
  const box = byId('gauntlet-run')
  const btn = byId('gauntlet-btn')
  if (!run) {
    const parts = [t('gauntletHow', { wins: WINS_NEEDED, lives: LIVES, coins: WIN_COINS, done: DONE_COINS })]
    if (d.last) parts.push(t('gauntletLast', { n: d.last.wins, max: WINS_NEEDED }))
    if (d.runs) parts.push(t('gauntletBest', { n: d.best, max: WINS_NEEDED, done: d.done }))
    set('gauntlet-status', parts.join(' '))
    if (box) box.innerHTML = ''
    if (btn) {
      btn.textContent = t('gauntletStart')
      btn.disabled = false
    }
    return
  }
  const hearts = '♥'.repeat(run.lives) + '♡'.repeat(LIVES - run.lives)
  set('gauntlet-status', t('gauntletState', { b: run.battle, w: run.wins, max: WINS_NEEDED, hearts, gold: run.gold }))
  if (box) {
    const room = slots(run.battle)
    const mine = run.team.map((c, i) => card(c, { sellFor: sellPrice(c), i, kind: 'sell' })).join('')
      + Array.from({ length: Math.max(0, room - run.team.length) }, () => `<div class="team-card empty"><span>${esc(t('teamEmptySlot'))}</span></div>`).join('')
    const shop = run.shop.map((c, i) => (c ? card(c, { price: PRICE, i, kind: 'buy' }) : `<div class="team-card empty gt-sold"><span>${esc(t('gauntletSoldSlot'))}</span></div>`)).join('')
    box.innerHTML = `
      <h4 class="gt-sub">${esc(t('gauntletTeamTitle', { n: run.team.length, max: room }))}</h4>
      <p class="gt-hint">${esc(t('gauntletTeamHint'))}</p>
      <div class="team-cards gt-row">${mine}</div>
      <h4 class="gt-sub">${esc(t('gauntletShopTitle'))}</h4>
      <p class="gt-hint">${esc(t('gauntletShopHint', { n: PRICE }))}</p>
      <div class="team-cards gt-row">${shop}</div>
      <div class="gt-actions">
        <button type="button" class="gt-btn" id="gauntlet-reroll"${run.gold < REROLL ? ' disabled' : ''}>${esc(t('gauntletReroll', { n: REROLL }))}</button>
        <button type="button" class="gt-btn" id="gauntlet-quit">${esc(t(game._gauntletQuitArmed ? 'gauntletQuitSure' : 'gauntletQuit'))}</button>
      </div>`
  }
  if (btn && !game._gauntletBusy) {
    btn.textContent = t('gauntletFight', { b: run.battle })
    btn.disabled = !run.team.length
  }
}

async function fight(game, rerender) {
  if (game._gauntletBusy || game._teamBattle?.root) return
  const d = loadGauntlet()
  const run = d.run
  if (!run?.team.length) return game._showHomepageToast(t('gauntletNeedOne'))
  if (!run.foe) {
    game._gauntletBusy = true
    const btn = byId('gauntlet-btn')
    if (btn) {
      btn.disabled = true
      btn.textContent = t('teamFinding')
    }
    const foe = await findFoe(game, run)
    game._gauntletBusy = false
    const dd = loadGauntlet()
    if (!dd.run || dd.run.battle !== run.battle) return rerender()
    dd.run.foe = foe
    saveGauntlet(dd)
    run.foe = foe
    rerender()
  }
  const b = run.battle
  game._teamBattle = new TeamBattle({
    mine: run.team,
    theirs: run.foe.team,
    foe: `${t('gauntletBattleN', { b })}: ${run.foe.bot ? run.foe.name : t('teamGhostName', { name: run.foe.name })}`,
    ghost: !run.foe.bot,
    xp: false,
    onEnd: (won) => {
      if (won === null) {
        rerender()
        return 0
      }
      const now = loadGauntlet().run
      if (!now || now.battle !== b) return 0
      const reward = finishBattle(won)
      if (reward) {
        game.coins += reward
        saveShopProgress(game)
        game._renderCurrencyBar?.()
      }
      rerender()
      return reward
    },
    againKey: () => false,
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

// Clicks inside the Gauntlet section. -> true when it was one of ours.
export function gauntletClick(game, e, rerender) {
  const toast = (key, vars) => game._showHomepageToast(t(key, vars))
  const b = e.target.closest('[data-gt-buy]')
  if (b) {
    const res = buy(Number(b.dataset.gtBuy))
    if (typeof res === 'string' && res) toast(res, { n: PRICE })
    else if (res?.merged) toast('gauntletMerged', { name: creatureName(res.merged), n: starsOf(res.merged) })
    rerender()
    return true
  }
  const s = e.target.closest('[data-gt-sell]')
  if (s) {
    const n = sell(Number(s.dataset.gtSell))
    if (n) toast('gauntletSoldFor', { n })
    rerender()
    return true
  }
  const id = e.target.closest('button')?.id
  if (id === 'gauntlet-reroll') {
    const res = reroll()
    if (res) toast(res, { n: REROLL })
    rerender()
    return true
  }
  if (id === 'gauntlet-quit') {
    // Two taps: the first asks "sure?" for a few seconds.
    if (!game._gauntletQuitArmed) {
      game._gauntletQuitArmed = true
      clearTimeout(game._gauntletQuitTimer)
      game._gauntletQuitTimer = setTimeout(() => {
        game._gauntletQuitArmed = false
        rerender()
      }, 3000)
    } else {
      game._gauntletQuitArmed = false
      giveUp()
    }
    rerender()
    return true
  }
  if (id === 'gauntlet-btn') {
    if (!loadGauntlet().run) {
      startRun()
      rerender()
    } else fight(game, rerender)
    return true
  }
  return false
}

