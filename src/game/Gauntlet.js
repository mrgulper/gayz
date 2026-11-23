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
// Shop upgrade (2026-11-23, Gaymi: "more like" auto-battler shop games):
// - Shop tiers: kinds come in 5 tiers (POOL), a new tier every 2 battles
//   (shopTier). Rarer rarities still turn up later, like before.
// - Food: FOOD_SLOTS foods in the shop too (FOODS). Fruit adds health
//   (bh) and attack (ba) to one creature for the rest of the run; Berries
//   feed the whole team; the 4 snacks (Creatures.SNACKS) work for the next
//   battle only. Tap a food, then tap a team creature.
// - Freeze: a frozen shop slot stays through rerolls and the next battle.
// - Drag a team creature to move it (Reorder.js): first ones stand front.
// Bots spend their leftover gold on fruit too. Fruit isn't sent with a
// team saved for other players (packTeam), so their copy is a bit weaker.
//
// Saved in localStorage (GAUNTLET_KEY), so Cloud Save carries it.
import * as CloudSync from './CloudSync.js'
import { cleanCreature, stats, creatureName, creatureType, rarityName, creatureIconURL, tierColor, packTeam, unpackTeam, powerName, levelOf, snackName, snackInfo, snackImg, pixelIconURL } from './Creatures.js'
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

// What the shop sells, in tiers (weakest first; 2026-11-23). Tier n
// turns up from battle 2n - 1 (shopTier).
const POOL = [
  // Sorted by power (health x attack) as common ones, 2026-11-23.
  { t: 'a', k: 'bat', tier: 1 }, { t: 'a', k: 'eagle', tier: 1 }, { t: 'a', k: 'boar', tier: 1 }, { t: 'z', k: 'minion', tier: 1 }, { t: 'z', k: 'beast', tier: 1 },
  { t: 'z', k: 'crawler', tier: 2 }, { t: 'z', k: 'rogue', tier: 2 }, { t: 'a', k: 'lion', tier: 2 }, { t: 'z', k: null, tier: 2 },
  { t: 'z', k: 'mage', tier: 3 }, { t: 'a', k: 'wolf', tier: 3 }, { t: 'z', k: 'hunched', tier: 3 },
  { t: 'a', k: 'crocodile', tier: 4 }, { t: 'z', k: 'warrior', tier: 4 }, { t: 'a', k: 'bear', tier: 4 }, { t: 'a', k: 'velociraptor', tier: 4 },
  { t: 'z', k: 'brute', tier: 5 }, { t: 'a', k: 'triceratops', tier: 5 },
]
export const MAX_TIER = 5
export const shopTier = (b) => Math.min(MAX_TIER, 1 + Math.floor((b - 1) / 2))

// Food (2026-11-23, Gaymi: "buffs like apples"). hp / atk: added for the
// rest of the run; all: the whole team; snack: a Creatures.SNACKS one,
// for the next battle only. tier: from which shop tier it turns up.
export const FOOD_SLOTS = 2
export const FOODS = {
  apple: { cost: 3, tier: 1, hp: 15 },
  honey: { cost: 3, tier: 1, atk: 3 },
  steak: { cost: 3, tier: 1, snack: true },
  candy: { cost: 2, tier: 1, snack: true },
  pear: { cost: 3, tier: 2, hp: 10, atk: 2 },
  cookie: { cost: 3, tier: 2, snack: true },
  berries: { cost: 4, tier: 3, hp: 6, atk: 1, all: true },
  bandage: { cost: 3, tier: 3, snack: true },
  melon: { cost: 4, tier: 4, hp: 40 },
}
export const FOOD_IDS = Object.keys(FOODS)
// Most fruit one creature can hold (a merge adds the three together).
export const MAX_BH = 400
export const MAX_BA = 80
// 10x10 pixel-art fruit (no emoji in the UI); snacks use Creatures' own.
const FRUIT_PIX = {
  apple: { c: { r: '#d8323a', d: '#9a1e24', w: '#ffb0b0', s: '#5a3a1a', l: '#4caf50' }, rows: [
    '....s.l...', '....sll...', '..rrsrrr..', '.rwrrrrrr.', '.rwrrrrrr.', '.rrrrrrrd.', '.rrrrrrrd.', '..rrrrrd..', '...rr.d...', '..........'] },
  honey: { c: { j: '#f2b630', d: '#c8861a', l: '#ffe08a', w: '#e8e0d0', b: '#8a6a3a' }, rows: [
    '...bbbb...', '..wwwwww..', '...jjjj...', '..jjjjjj..', '.jjljjjjj.', '.jjljjjjd.', '.jjjjjjjd.', '.jjjjjjjd.', '..jjjjdd..', '..........'] },
  pear: { c: { g: '#b8d040', d: '#7a9a20', w: '#e8f0a0', s: '#5a3a1a', l: '#4caf50' }, rows: [
    '....sl....', '....s.....', '...ggg....', '...gwgg...', '..ggwggg..', '.gggggggd.', '.gggggggd.', '.ggggggdd.', '..ggggdd..', '..........'] },
  berries: { c: { p: '#6a3ac8', d: '#3a1a7a', w: '#b8a0ff', l: '#4caf50' }, rows: [
    '...ll.....', '..ppl.pp..', '.pwpppwpp.', '.pppdpppd.', '..pd.ppd..', '...pp.....', '..pwpp....', '..pppd....', '...dd.....', '..........'] },
  melon: { c: { g: '#2e8a3a', l: '#7ac850', r: '#e8404a', w: '#ffb0b0', k: '#1a1a1a' }, rows: [
    '..........', '..........', 'g........g', 'gl......lg', 'glrrrrrrlg', '.glrkrrklg', '.glrrwrrl.', '..glrrrlg.', '...gllll..', '....gggg..'] },
}
export const foodImg = (id, cls) => (FOODS[id]?.snack ? snackImg(id, cls) : `<img class="${cls}" src="${pixelIconURL(`fruit-${id}`, FRUIT_PIX[id])}" alt="" draggable="false" />`)
export const foodName = (id) => (FOODS[id].snack ? snackName(id) : t(`gtFood${id[0].toUpperCase()}${id.slice(1)}`))
export function foodInfo(id) {
  const f = FOODS[id]
  if (f.snack) return `${snackInfo(id)} ${t('gtFoodOneBattle')}`
  return t(f.all ? 'gtFoodInfoAll' : 'gtFoodInfo', { hp: f.hp || 0, atk: f.atk || 0 })
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const byId = (id) => document.getElementById(id)

// Team slots at battle b: 3, 3, 4, 4, 5, 5, 6, 6, 7...
export const slots = (b) => Math.min(MAX_SLOTS, 3 + Math.floor((b - 1) / 2))
export const starsOf = (c) => (levelOf(c) >= STAR_LEVEL[2] ? 3 : levelOf(c) >= STAR_LEVEL[1] ? 2 : 1)
export const sellPrice = (c) => Math.floor((PRICE * 3 ** (starsOf(c) - 1)) / 2)
const sameKey = (c) => `${c.t}:${c.k || ''}:${starsOf(c)}`

function poolFor(b) {
  const kinds = PlayAnimals.KINDS
  return POOL.filter((p) => (p.t === 'z' || Object.hasOwn(kinds, p.k)) && p.tier <= shopTier(b))
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

// keep: the old shop, and which slots of it are frozen (they stay).
export function rollShop(b, team, rand = Math.random, keep = null, frozen = []) {
  return Array.from({ length: SHOP_SIZE }, (_, i) => (frozen[i] && keep?.[i] ? keep[i] : offer(b, team, rand)))
}

export function rollFood(b, rand = Math.random, keep = null, frozen = []) {
  const ids = FOOD_IDS.filter((id) => FOODS[id].tier <= shopTier(b))
  return Array.from({ length: FOOD_SLOTS }, (_, i) => (frozen[i] && keep?.[i] ? keep[i] : ids[Math.floor(rand() * ids.length)]))
}

// Feeds food id to creature c (a fruit: for good; a snack: next battle).
// -> '' when it worked, else the i18n key of why not.
function feedOne(c, id) {
  const f = FOODS[id]
  if (f.snack) {
    if (c.sn) return 'gtFoodHasSnack'
    c.sn = id
    return ''
  }
  if ((c.bh || 0) >= MAX_BH && (c.ba || 0) >= MAX_BA) return 'gtFoodFull'
  if (f.hp) c.bh = Math.min(MAX_BH, (c.bh || 0) + f.hp)
  if (f.atk) c.ba = Math.min(MAX_BA, (c.ba || 0) + f.atk)
  return ''
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
    // Fruit eaten by any of the three carries over (added together); a
    // snack waiting on any of them too.
    const sum = (key, max) => Math.min(max, picked.reduce((n, c) => n + (c[key] || 0), 0))
    if (sum('bh', MAX_BH)) merged.bh = sum('bh', MAX_BH)
    else delete merged.bh
    if (sum('ba', MAX_BA)) merged.ba = sum('ba', MAX_BA)
    else delete merged.ba
    const sn = picked.find((c) => c.sn)?.sn
    if (sn) merged.sn = sn
    else delete merged.sn
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
    // Leftover gold on fruit for a random creature (2026-11-23).
    const fruit = FOOD_IDS.filter((id) => !FOODS[id].snack && FOODS[id].tier <= shopTier(r))
    while (team.length && fruit.length) {
      const id = fruit[Math.floor(rand() * fruit.length)]
      if (gold < FOODS[id].cost) break
      gold -= FOODS[id].cost
      if (FOODS[id].all) team.forEach((c) => feedOne(c, id))
      else feedOne(team[Math.floor(rand() * team.length)], id)
    }
  }
  return team
}

// --- saved state ---

function blankSave() {
  return { run: null, best: 0, runs: 0, done: 0, last: null }
}

// Fruit (bh / ba) and a waiting snack (sn) only on the team (keepFood).
const cleanList = (list, max, keepFood = false) => (Array.isArray(list) ? list : []).slice(0, max)
  .map((c) => {
    const o = c ? cleanCreature(c) : null
    if (!o) return null
    const sn = o.sn
    const out = { ...o }
    for (const k of ['sn', 'x', 's', 'at']) delete out[k]
    if (!keepFood) return out
    if (sn && FOODS[sn]?.snack) out.sn = sn
    if (Number.isInteger(c.bh) && c.bh > 0) out.bh = Math.min(MAX_BH, c.bh)
    if (Number.isInteger(c.ba) && c.ba > 0) out.ba = Math.min(MAX_BA, c.ba)
    return out
  })
const cleanFlags = (v, n) => Array.from({ length: n }, (_, i) => Array.isArray(v) && v[i] === true)

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
      const team = cleanList(r.team, MAX_SLOTS, true).filter(Boolean)
      const shop = cleanList(r.shop, SHOP_SIZE)
      while (shop.length < SHOP_SIZE) shop.push(null)
      // Food and frozen slots (2026-11-23); an older save rolls food now.
      const food = Array.isArray(r.food)
        ? Array.from({ length: FOOD_SLOTS }, (_, i) => (Object.hasOwn(FOODS, r.food[i]) ? r.food[i] : null))
        : rollFood(battle)
      const frozen = { s: cleanFlags(r.frozen?.s, SHOP_SIZE), f: cleanFlags(r.frozen?.f, FOOD_SLOTS) }
      let foe = null
      if (r.foe && typeof r.foe === 'object') {
        const ft = unpackTeam(r.foe.team)
        const name = typeof r.foe.name === 'string' ? r.foe.name.slice(0, 24) : ''
        if (ft.length) foe = { name, bot: !!r.foe.bot, team: ft }
      }
      out.run = { battle, wins, lives, gold: int(r.gold, 0, 9999) ?? 0, team, shop, food, frozen, foe }
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

const blankFrozen = () => ({ s: Array(SHOP_SIZE).fill(false), f: Array(FOOD_SLOTS).fill(false) })

export function startRun() {
  const d = loadGauntlet()
  d.run = { battle: 1, wins: 0, lives: LIVES, gold: ROUND_GOLD, team: [], shop: rollShop(1, []), food: rollFood(1), frozen: blankFrozen(), foe: null }
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
  run.frozen.s[i] = false
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
  run.shop = rollShop(run.battle, run.team, Math.random, run.shop, run.frozen.s)
  run.food = rollFood(run.battle, Math.random, run.food, run.frozen.f)
  saveGauntlet(d)
  return ''
}

// Freeze / unfreeze a shop slot: kind 's' (creatures) or 'f' (food).
export function toggleFreeze(kind, i) {
  const d = loadGauntlet()
  const run = d.run
  const list = kind === 'f' ? run?.food : run?.shop
  if (!list?.[i]) return
  run.frozen[kind][i] = !run.frozen[kind][i]
  saveGauntlet(d)
}

// Buys food slot i for team creature t (-1: a whole-team food).
// -> '' when it worked, else the i18n key of why not.
export function buyFood(i, ti) {
  const d = loadGauntlet()
  const run = d.run
  const id = run?.food[i]
  if (!id) return 'gauntletGone'
  const f = FOODS[id]
  if (run.gold < f.cost) return 'gauntletNoGold'
  if (!run.team.length) return 'gtFoodNoTeam'
  let why = ''
  if (f.all) run.team.forEach((c) => feedOne(c, id))
  else {
    const c = run.team[ti]
    if (!c) return 'gauntletGone'
    why = feedOne(c, id)
  }
  if (why) return why
  run.gold -= f.cost
  run.food[i] = null
  run.frozen.f[i] = false
  run.foe = null
  saveGauntlet(d)
  return ''
}

// Moves team creature from -> to (drag to reorder).
export function moveTeam(from, to) {
  const d = loadGauntlet()
  const team = d.run?.team
  if (!team?.[from] || to < 0 || to >= team.length || from === to) return
  team.splice(to, 0, team.splice(from, 1)[0])
  saveGauntlet(d)
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
    run.shop = rollShop(run.battle, run.team, Math.random, run.shop, run.frozen.s)
    run.food = rollFood(run.battle, Math.random, run.food, run.frozen.f)
  }
  saveGauntlet(d)
  return reward
}

// --- the Team page section ---

function card(c, { price, sellFor, i, kind, feeding, frozen }) {
  const s = stats(c)
  const stars = starsOf(c)
  const label = kind === 'buy' ? t('gauntletPrice', { n: price }) : feeding ? t('gtFoodFeedHere') : t('gauntletSell', { n: sellFor })
  const fruit = c.bh || c.ba ? `<span class="gt-fruit">${esc(t('gtFoodBonus', { hp: c.bh || 0, atk: c.ba || 0 }))}</span>` : ''
  return `<button type="button" class="perk-option team-card gt-card${feeding ? ' gt-feed' : ''}${frozen ? ' gt-frozen' : ''}" data-gt-${kind}="${i}" style="--tier: ${tierColor(c.r)}" title="${esc(`${powerName(c)} · ${label}`)}">
    <span class="team-card-level gt-stars" aria-label="${esc(t('gauntletStars', { n: stars }))}">${'★'.repeat(stars)}</span>
    ${c.sn ? snackImg(c.sn, 'team-card-snack') : ''}
    <img src="${creatureIconURL(c)}" alt="" draggable="false" />
    <span class="team-card-name">${esc(creatureName(c))}</span>
    <span class="team-card-type">${esc(rarityName(c.r))} ${esc(creatureType(c))}</span>
    <span class="team-card-stats">${esc(t('teamStats', { hp: s.hp, atk: s.atk }))}</span>
    ${fruit}
    <span class="team-card-power">${esc(powerName(c))}</span>
    <span class="gt-price">${esc(label)}</span>
  </button>`
}

// A shop slot: the card with a Freeze button under it.
const freezeBtn = (kind, i, on) => `<button type="button" class="gt-btn gt-freeze${on ? ' on' : ''}" data-gt-freeze="${kind}${i}" aria-pressed="${on}">${esc(t(on ? 'gtFrozen' : 'gtFreeze'))}</button>`

function foodCard(id, i, { armed, frozen }) {
  const f = FOODS[id]
  return `<div class="gt-slot"><button type="button" class="team-snack gt-food${armed ? ' armed' : ''}${frozen ? ' gt-frozen' : ''}" data-gt-food="${i}" aria-pressed="${armed}">
      ${foodImg(id, 'team-snack-icon')}
      <b>${esc(foodName(id))}</b>
      <span class="team-snack-info">${esc(foodInfo(id))}</span>
      <span class="team-snack-cost">${esc(t('gauntletPrice', { n: f.cost }))}</span>
    </button>${freezeBtn('f', i, frozen)}</div>`
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
    // A picked food (tap it, then a team creature) - not a whole-team one.
    const armed = Number.isInteger(game._gtFood) && run.food[game._gtFood] ? game._gtFood : null
    if (armed === null) game._gtFood = null
    const mine = run.team.map((c, i) => card(c, { sellFor: sellPrice(c), i, kind: 'sell', feeding: armed !== null })).join('')
      + Array.from({ length: Math.max(0, room - run.team.length) }, () => `<div class="team-card empty"><span>${esc(t('teamEmptySlot'))}</span></div>`).join('')
    const sold = `<div class="team-card empty gt-sold"><span>${esc(t('gauntletSoldSlot'))}</span></div>`
    const shop = run.shop.map((c, i) => (c ? `<div class="gt-slot">${card(c, { price: PRICE, i, kind: 'buy', frozen: run.frozen.s[i] })}${freezeBtn('s', i, run.frozen.s[i])}</div>` : sold)).join('')
    const food = run.food.map((id, i) => (id ? foodCard(id, i, { armed: armed === i, frozen: run.frozen.f[i] }) : `<div class="team-snack empty gt-sold"><span>${esc(t('gauntletSoldSlot'))}</span></div>`)).join('')
    const tier = shopTier(run.battle)
    box.innerHTML = `
      <h4 class="gt-sub">${esc(t('gauntletTeamTitle', { n: run.team.length, max: room }))}</h4>
      <p class="gt-hint">${esc(armed !== null ? t('gtFoodPick', { name: foodName(run.food[armed]) }) : t('gauntletTeamHint'))}</p>
      <div class="team-cards gt-row" id="gauntlet-team">${mine}</div>
      <h4 class="gt-sub">${esc(t('gauntletShopTitle'))} · ${esc(t('gtShopTier', { n: tier, max: MAX_TIER }))}</h4>
      <p class="gt-hint">${esc(t('gauntletShopHint', { n: PRICE }))} ${esc(tier < MAX_TIER ? t('gtTierNext', { b: tier * 2 + 1 }) : '')}</p>
      <div class="team-cards gt-row">${shop}</div>
      <h4 class="gt-sub">${esc(t('gtFoodTitle'))}</h4>
      <p class="gt-hint">${esc(t('gtFoodHint'))}</p>
      <div class="team-snack-row gt-row">${food}</div>
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
  // Snacks are eaten as the battle starts, even if it's left (like the
  // Team page's): the battle gets them, the save loses them.
  const mine = run.team.map((c) => ({ ...c }))
  if (mine.some((c) => c.sn)) {
    const dd = loadGauntlet()
    if (dd.run) {
      dd.run.team.forEach((c) => delete c.sn)
      saveGauntlet(dd)
    }
  }
  game._gtFood = null
  game._teamBattle = new TeamBattle({
    mine,
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
  if (game._teamDragged) return true // a drag just ended (Reorder.js), not a tap
  const fz = e.target.closest('[data-gt-freeze]')
  if (fz) {
    toggleFreeze(fz.dataset.gtFreeze[0], Number(fz.dataset.gtFreeze.slice(1)))
    rerender()
    return true
  }
  const fd = e.target.closest('[data-gt-food]')
  if (fd) {
    const i = Number(fd.dataset.gtFood)
    const id = loadGauntlet().run?.food[i]
    if (id && FOODS[id].all) {
      // Whole-team food: bought straight away.
      const res = buyFood(i, -1)
      if (res) toast(res, { n: FOODS[id].cost })
      else toast('gtFoodAte', { food: foodName(id) })
      game._gtFood = null
    } else game._gtFood = game._gtFood === i ? null : i
    rerender()
    return true
  }
  const s0 = e.target.closest('[data-gt-sell]')
  if (s0 && Number.isInteger(game._gtFood)) {
    const id = loadGauntlet().run?.food[game._gtFood]
    const res = buyFood(game._gtFood, Number(s0.dataset.gtSell))
    if (res) toast(res, { n: id ? FOODS[id].cost : 0 })
    else {
      toast('gtFoodFed', { name: creatureName(loadGauntlet().run.team[Number(s0.dataset.gtSell)]), food: foodName(id) })
      game._gtFood = null
    }
    rerender()
    return true
  }
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

