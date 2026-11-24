// Caught creatures and your battle team (2026-10-31, Gaymi's own idea:
// "catch zombies and animals, build a team, battle other players' ghost
// teams"; picked "weaken, then throw a trap" and "you control one
// creature"). Catching happens in a game (PlayCatch.js); the Team page on
// Inventory's Pets tab (TeamUI.js) picks up to TEAM_SIZE of them, and a battle
// (TeamBattle.js) puts them against another player's saved team.
//
// Saved in localStorage (CREATURES_KEY), so Cloud Save carries it like the
// rest of the save. A creature is { id, t: 'z' | 'a', k: kind, r: tier,
// n: name number (zombies), b: boss, at: when caught, x: battle XP,
// s: shiny (2026-11-11, only when true), sn: snack for the next battle
// (only my own), hi: held item (2026-11-23, ITEMS) }. The save's items:
// { id: count } held items found but not being held; eggs: [{ r, d }]
// eggs found, d = blocks walked (PetEggs.js, 2026-11-23). A
// ghost team's creatures carry l: level instead of x. Its battle stats
// come from what it was in the game (stats()), never stored, so a balance
// change reaches creatures already caught.
import { PlayAnimals, animalNameKey, animalIconURL } from './PlayAnimals.js'
import { ZOMBIE_TIERS, ZOMBIE_TIER_IDS, zombieName, tierColor, NAME_COUNT } from './ZombieNames.js'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { SKELETON_KINDS } from './SkeletonModels.js'
import { t } from './i18n.js'

export const CREATURES_KEY = 'gayz-creatures'
export const MAX_CREATURES = 200
// Eggs kept at once (PetEggs.js: EGG_WARM warming + the rest waiting).
export const EGG_MAX = 13
// Gaymi (2026-10-31): "make it 10 slots" (was 3).
export const TEAM_SIZE = 10

// Zombies: the game's zombie, times its kind's and tier's numbers.
const ZOMBIE_BASE = { hp: 110, atk: 13, speed: 2.6 }
const BOSS = { hp: 1.8, atk: 1.4 }
// Animals: their game health stretched to a zombie's range (4-70 -> 50-160).
const ANIMAL_HP = (h) => 44 + h * 1.65
const ANIMAL_SPEED = 3.1
const DINO = { hp: 1.5, atk: 1.3 }

const KINDS = () => PlayAnimals.KINDS

function blank() {
  // fw / fl: friend battles won and lost (Batch G), their own record.
  // book / bp: the Collection book (Batch K) - every kind ever caught and
  // the milestone prizes already paid (BOOK_MILESTONES).
  // tr / tw: battle trophies (PetRank.js, Batch M) - all-time, and this
  // week's { w: week, n: trophies won this week }.
  return { list: [], team: [], wins: 0, losses: 0, fw: 0, fl: 0, tr: 0, tw: null, nextId: 1, items: {}, eggs: [], book: {}, bp: [] }
}

// Never trusted (it came from localStorage, maybe a shared save file).
export function loadCreatures() {
  let data
  try {
    data = JSON.parse(localStorage.getItem(CREATURES_KEY) || 'null')
  } catch {
    data = null
  }
  const out = blank()
  if (!data || typeof data !== 'object') return out
  const list = Array.isArray(data.list) ? data.list : []
  for (const c of list.slice(0, MAX_CREATURES)) {
    const clean = cleanCreature(c)
    if (clean && Number.isInteger(c.id) && c.id > 0) out.list.push({ ...clean, id: c.id })
  }
  const ids = new Set(out.list.map((c) => c.id))
  out.team = (Array.isArray(data.team) ? data.team : []).filter((id) => ids.has(id)).slice(0, TEAM_SIZE)
  out.team = [...new Set(out.team)]
  out.wins = Number.isInteger(data.wins) && data.wins >= 0 ? data.wins : 0
  out.losses = Number.isInteger(data.losses) && data.losses >= 0 ? data.losses : 0
  out.fw = Number.isInteger(data.fw) && data.fw >= 0 ? data.fw : 0
  out.fl = Number.isInteger(data.fl) && data.fl >= 0 ? data.fl : 0
  out.tr = Number.isInteger(data.tr) && data.tr >= 0 ? Math.min(data.tr, 1000000) : 0
  const tw = data.tw
  out.tw = tw && Number.isInteger(tw.w) && Number.isInteger(tw.n) && tw.n >= 0 ? { w: tw.w, n: Math.min(tw.n, 1000000) } : null
  out.nextId = Math.max(1, ...out.list.map((c) => c.id + 1), Number.isInteger(data.nextId) ? data.nextId : 1)
  // Held items in the bag (Batch D).
  if (data.items && typeof data.items === 'object') {
    for (const id of ITEM_IDS) {
      const n = data.items[id]
      if (Number.isInteger(n) && n > 0) out.items[id] = Math.min(ITEM_MAX, n)
    }
  }
  // Eggs (Batch F): a rarity and blocks walked so far.
  if (Array.isArray(data.eggs)) {
    for (const e of data.eggs.slice(0, EGG_MAX)) {
      if (!e || !ZOMBIE_TIER_IDS.includes(e.r)) continue
      const d = Number.isFinite(e.d) && e.d > 0 ? Math.min(Math.floor(e.d), 100000) : 0
      out.eggs.push({ r: e.r, d })
    }
  }
  // Collection book (Batch K).
  out.book = cleanBook(data.book)
  if (Array.isArray(data.bp)) out.bp = BOOK_MILESTONES.filter((m) => data.bp.includes(m))
  return out
}

export function saveCreatures(data) {
  try {
    localStorage.setItem(CREATURES_KEY, JSON.stringify(data))
  } catch {
    // Full storage: the catch just isn't kept.
  }
}

// One creature's fields checked (a ghost team from another player too):
// null when it isn't a real zombie or animal.
export function cleanCreature(c) {
  if (!c || typeof c !== 'object') return null
  const r = ZOMBIE_TIER_IDS.includes(c.r) ? c.r : 'common'
  // Levels (2026-11-11): XP for my own, a plain level for a ghost team's.
  const grow = {}
  if (Number.isInteger(c.x) && c.x > 0) grow.x = Math.min(c.x, MAX_XP)
  else if (Number.isInteger(c.l) && c.l > 1) grow.l = Math.min(c.l, MAX_LEVEL)
  // Shiny and snack (2026-11-11).
  if (c.s === true || c.s === 1) grow.s = true
  if (typeof c.sn === 'string' && Object.hasOwn(SNACKS, c.sn)) grow.sn = c.sn
  // Held item (2026-11-23): stays on, other players' teams carry theirs.
  if (typeof c.hi === 'string' && Object.hasOwn(ITEMS, c.hi)) grow.hi = c.hi
  // Nickname (2026-11-23): up to NICK_MAX letters, bad words swapped
  // (setNickFilter). nk: also show what kind it is under the name.
  const nm = cleanNick(c.nm)
  if (nm) {
    grow.nm = nm
    if (c.nk === true) grow.nk = true
  }
  if (c.t === 'a') {
    if (typeof c.k !== 'string' || !Object.hasOwn(KINDS(), c.k)) return null
    return { t: 'a', k: c.k, r, at: Number.isFinite(c.at) ? c.at : 0, ...grow }
  }
  if (c.t !== 'z') return null
  const k = typeof c.k === 'string' && (Object.hasOwn(MONSTER_KINDS, c.k) || Object.hasOwn(SKELETON_KINDS, c.k)) ? c.k : null
  const n = Number.isInteger(c.n) && c.n >= 0 && c.n < NAME_COUNT ? c.n : 0
  return { t: 'z', k, r, n, b: !!c.b, at: Number.isFinite(c.at) ? c.at : 0, ...grow }
}

// --- Levels and evolution (2026-11-11, Gaymi picked: max level 20, up one
// rarity at levels 10 and 20, a second power at level 5) ---

export const MAX_LEVEL = 20
export const EVOLVE_AT = [10, 20]
export const TRIGGER_LEVEL = 5
export const LEVEL_BOOST = 0.04 // +4% health and attack per level past 1
export const WIN_XP = 30
export const LOSS_XP = 12
// XP to go from level L to L+1.
export const xpToNext = (L) => 40 + 20 * (L - 1)
const XP_AT = [0, 0] // XP_AT[L]: total XP to reach level L
for (let L = 2; L <= MAX_LEVEL; L++) XP_AT[L] = XP_AT[L - 1] + xpToNext(L - 1)
export const MAX_XP = XP_AT[MAX_LEVEL]

export function levelOf(c) {
  if (Number.isInteger(c.x)) {
    let L = 1
    while (L < MAX_LEVEL && c.x >= XP_AT[L + 1]) L++
    return L
  }
  return Number.isInteger(c.l) && c.l >= 1 ? Math.min(c.l, MAX_LEVEL) : 1
}

// { have, need } towards the next level (need 0 at the top).
export function xpProgress(c) {
  const L = levelOf(c)
  if (L >= MAX_LEVEL) return { have: 0, need: 0 }
  return { have: (c.x || 0) - XP_AT[L], need: xpToNext(L) }
}

// After a finished battle: every creature on my team (by id) gets XP,
// levels up and maybe evolves. Returns what happened, for the result box:
// [{ kind: 'level' | 'evolve' | 'trigger', c, n }] (n: level or rarity).
export function giveTeamXP(ids, won) {
  const data = loadCreatures()
  const gain = won ? WIN_XP : LOSS_XP
  const news = []
  for (const id of ids) {
    const c = data.list.find((o) => o.id === id)
    if (!c) continue
    const before = levelOf(c)
    c.x = Math.min(MAX_XP, (c.x || 0) + gain)
    const after = levelOf(c)
    if (after === before) continue
    news.push({ kind: 'level', c, n: after })
    if (before < TRIGGER_LEVEL && after >= TRIGGER_LEVEL) news.push({ kind: 'trigger', c, n: triggerOf(c) })
    for (const at of EVOLVE_AT) {
      const i = ZOMBIE_TIER_IDS.indexOf(c.r)
      if (before < at && after >= at && i < ZOMBIE_TIER_IDS.length - 1) {
        c.r = ZOMBIE_TIER_IDS[i + 1]
        news.push({ kind: 'evolve', c, n: c.r })
      }
    }
  }
  saveCreatures(data)
  return { gain, news }
}

// --- Types (2026-11-11): Zombies beat Animals, Animals beat Skeletons,
// Skeletons beat Zombies, for TYPE_MULT damage ---

export const TYPE_MULT = 1.3
const BEATS = { zombie: 'animal', animal: 'skeleton', skeleton: 'zombie' }
export function typeOf(c) {
  if (c.t === 'a') return 'animal'
  return SKELETON_KINDS[c.k] ? 'skeleton' : 'zombie'
}
export const beats = (a, b) => BEATS[typeOf(a)] === typeOf(b)

// --- Shiny catches (2026-11-11, Gaymi picked a small boost): 1 in
// SHINY_ODDS catches is a recolour with a sparkle and SHINY_BOOST more
// health and attack. Rolled on the catcher's own side when it's added. ---

export const SHINY_ODDS = 200
export const SHINY_BOOST = 0.05
// The recolour: a hue turn (CSS filter for pictures, HSL shift for 3D).
export const SHINY_HUE = 150
export const SHINY_FILTER = `hue-rotate(${SHINY_HUE}deg) saturate(1.4)`

// Adds a catch: the creature as kept (shiny or not), or false when there's
// no room left.
// odds: 1 in this many is shiny (an egg's are better - PetEggs.js).
export function addCreature(c, rand = Math.random, odds = SHINY_ODDS) {
  const data = loadCreatures()
  if (data.list.length >= MAX_CREATURES) return false
  const clean = cleanCreature({ ...c, s: rand() < 1 / odds, sn: null, x: 0, l: 0, at: Date.now() })
  if (!clean) return false
  const kept = { ...clean, id: data.nextId++ }
  data.list.push(kept)
  noteCatch(data.book, kept)
  // The first ones caught fill the team by themselves.
  if (data.team.length < TEAM_SIZE) data.team.push(kept.id)
  saveCreatures(data)
  return kept
}

// Pet trading (PetTrade.js, Batch N 2026-11-24): my pets with these ids
// leave (and the team), the friend's arrive as they were (level, shiny,
// held item, nickname; never a snack) with new ids, and fill the
// Collection book like a catch. Changes data; returns the new arrivals.
export function swapCreatures(data, giveIds, gets) {
  const give = new Set(giveIds)
  data.list = data.list.filter((c) => !give.has(c.id))
  data.team = data.team.filter((id) => !give.has(id))
  const got = []
  for (const raw of Array.isArray(gets) ? gets.slice(0, 3) : []) {
    const clean = cleanCreature(raw)
    if (!clean) continue
    delete clean.sn
    const kept = { ...clean, id: data.nextId++ }
    data.list.push(kept)
    noteCatch(data.book, kept)
    got.push(kept)
  }
  return got
}

// --- Collection book (pet battles round 4, Batch K, 2026-11-24; Gaymi
// picked a grid, page = basics + my record + where to find it, coins at
// milestones, pets already owned count). One page per kind: every animal
// kind, the plain zombie, every monster and skeleton kind (a boss counts
// for its kind). book: { 'a:cow' / 'z:' / 'z:mage': { n: caught, f: first
// caught, lv: best level, s: got a shiny } }. Kept even if the pet isn't.
// PetBook.js shows it. ---

// Share of the book caught -> coins, paid once each (a guess).
export const BOOK_MILESTONES = [25, 50, 75, 100]
export const BOOK_PRIZES = { 25: 150, 50: 400, 75: 800, 100: 2000 }
const BOOK_N_MAX = 999999

export const bookKey = (c) => `${c.t}:${c.k || ''}`
// Every page, in book order: zombies, skeletons, animals, dinosaurs.
export function bookKinds() {
  const K = KINDS()
  const animals = Object.keys(K)
  return [
    { t: 'z', k: null },
    ...Object.keys(MONSTER_KINDS).map((k) => ({ t: 'z', k })),
    ...Object.keys(SKELETON_KINDS).map((k) => ({ t: 'z', k })),
    ...animals.filter((k) => !K[k].dino).map((k) => ({ t: 'a', k })),
    ...animals.filter((k) => K[k].dino).map((k) => ({ t: 'a', k })),
  ]
}
export function bookGroup(c) {
  if (c.t === 'a') return KINDS()[c.k]?.dino ? 'dino' : 'animal'
  return SKELETON_KINDS[c.k] ? 'skeleton' : 'zombie'
}

function cleanBook(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
  for (const c of bookKinds()) {
    const e = raw[bookKey(c)]
    if (!e || typeof e !== 'object') continue
    const n = Math.min(BOOK_N_MAX, Math.floor(num(e.n)))
    if (!n) continue
    const lv = Math.min(MAX_LEVEL, Math.max(1, Math.floor(num(e.lv)) || 1))
    out[bookKey(c)] = { n, f: num(e.f), lv, ...(e.s === true ? { s: true } : {}) }
  }
  return out
}

function noteCatch(book, c) {
  const key = bookKey(c)
  const e = book[key] || (book[key] = { n: 0, f: 0, lv: 1 })
  e.n = Math.min(BOOK_N_MAX, e.n + 1)
  if (c.at > 0 && (!e.f || c.at < e.f)) e.f = c.at
  e.lv = Math.max(e.lv || 1, levelOf(c))
  if (c.s) e.s = true
}

// Brings the book up to date with the pets I have now (ones caught before
// the book, levels gained since). Returns true when something changed.
export function syncBook(data) {
  const have = {}
  for (const c of data.list) {
    const key = bookKey(c)
    have[key] = (have[key] || 0) + 1
  }
  const before = JSON.stringify(data.book)
  for (const c of data.list) {
    const key = bookKey(c)
    const e = data.book[key] || (data.book[key] = { n: 0, f: 0, lv: 1 })
    e.n = Math.max(e.n, have[key])
    if (c.at > 0 && (!e.f || c.at < e.f)) e.f = c.at
    e.lv = Math.max(e.lv || 1, levelOf(c))
    if (c.s) e.s = true
  }
  return JSON.stringify(data.book) !== before
}

// Milestones reached but not paid yet (and marks them paid in data).
export function claimBookPrizes(data) {
  const total = bookKinds().length
  const pct = (Object.keys(data.book).length / total) * 100
  const due = BOOK_MILESTONES.filter((m) => pct >= m && !data.bp.includes(m))
  data.bp.push(...due)
  return due
}

// --- Snacks (2026-11-11, Gaymi picked 4 snacks, any number per team):
// bought with coins on the Team page, fed to one creature on the team,
// eaten in its next battle. What each does is in TeamBattle.js. ---

export const SNACKS = {
  steak: { cost: 50, n: 25 }, // +25% attack
  bandage: { cost: 80, n: 50 }, // gets back up once at 50% health
  candy: { cost: 40, n: 20 }, // +20% speed
  cookie: { cost: 60, n: 0 }, // the first hit on it does nothing
}
// Their pictures: 10x10 pixel art, like the zombie faces (no emoji in the UI).
const SNACK_PIX = {
  steak: { c: { r: '#b8323a', d: '#7a1e24', f: '#f2e6d0', w: '#ffffff' }, rows: [
    '..........', '...rrrr...', '..rrrrrr..', '.rrdrrrrr.', '.rrrrfrrr.', '.rrrrrrdr.', '..rrrrrrww', '...rrrr.ww', '..........', '..........'] },
  bandage: { c: { b: '#e8c8a0', p: '#f8f0e8', o: '#b89870' }, rows: [
    '.......bb.', '......bbbb', '.....bbbbo', '....bppbo.', '...bppbb..', '..bppbb...', '.bbbbb....','bbbbo.....', '.bbo......', '..........'] },
  candy: { c: { k: '#ff5aa8', s: '#ffffff', e: '#c83a80' }, rows: [
    '..........', '..........', 'e........e', 'ee.kkkk.ee', 'eekkskskee', 'eeksksskee', 'ee.kkkk.ee', 'e........e', '..........', '..........'] },
  cookie: { c: { t: '#d8a058', o: '#a8743a', d: '#4a2a14', s: '#6ac8ff' }, rows: [
    '..ssssss..', '.sttttttts', 'stttdtttts', 'sttttttdts', 'stdtttttts', 'sttttdttts', 'stttttttds', 'stdttttts.', '.stttttts.', '..ssssss..'] },
}
const _snackIcons = new Map()
export const snackIconURL = (id) => pixelIconURL(id, SNACK_PIX[id])
// Any 10x10 pixel-art picture ({ c: colours, rows }) as an image URL,
// made once per id (Gauntlet.js fruit use it too).
export function pixelIconURL(id, pix) {
  if (_snackIcons.has(id)) return _snackIcons.get(id)
  const cv = document.createElement('canvas')
  cv.width = cv.height = 10
  const g = cv.getContext('2d')
  pix.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    g.fillStyle = pix.c[ch]
    g.fillRect(x, y, 1, 1)
  }))
  const url = cv.toDataURL()
  _snackIcons.set(id, url)
  return url
}
export const snackImg = (id, cls) => `<img class="${cls}" src="${snackIconURL(id)}" alt="" draggable="false" />`
export const SNACK_IDS = Object.keys(SNACKS)
export const snackName = (id) => t(`snack${cap(id)}`)
export const snackInfo = (id) => t(`snackInfo${cap(id)}`, { n: SNACKS[id].n })

// Feeds a snack to creature id. 'ok' | 'has' (already has one) | 'gone'.
export function feedSnack(id, snack) {
  const data = loadCreatures()
  const c = data.list.find((o) => o.id === id)
  if (!c || !SNACKS[snack]) return 'gone'
  if (c.sn) return 'has'
  c.sn = snack
  saveCreatures(data)
  return 'ok'
}

// A battle started: these creatures (ids) eat their snacks.
export function eatSnacks(ids) {
  const data = loadCreatures()
  let ate = false
  for (const c of data.list) {
    if (c.sn && ids.includes(c.id)) {
      delete c.sn
      ate = true
    }
  }
  if (ate) saveCreatures(data)
}

// --- Held items (Batch D, 2026-11-23; Gaymi picked 10 items, random
// drops, other players' teams keep theirs, Gauntlet sells them for gold).
// One per creature, never used up. Found by winning Pack Leader and
// tournament battles (rollItem); kept in the save's bag (data.items) until
// a creature holds one. What each does is in TeamBattle.js; n is its
// number (%, or seconds for the horn). w: how often it drops (bigger =
// more often). The numbers are a guess. ---

export const ITEMS = {
  fang: { n: 10, w: 3 }, // Fang Necklace: +n% attack
  feather: { n: 15, w: 3 }, // Swift Feather: +n% speed
  helmet: { n: 15, w: 3 }, // Iron Helmet: takes n% less
  charm: { n: 3, w: 3 }, // Healing Charm: heals n% of its health every 4s
  collar: { n: 20, w: 2 }, // Spiked Collar: whoever hits it takes n% back
  claws: { n: 15, w: 2 }, // Sharp Claws: +n% chance of a big hit
  tooth: { n: 15, w: 2 }, // Vampire Tooth: heals n% of the damage it does
  bone: { n: 0, w: 1 }, // Lucky Bone: once a battle, dodges the hit that would knock it out
  horn: { n: 2, w: 1 }, // Stun Horn: its first hit stuns for n seconds
  totem: { n: 30, w: 1 }, // Spirit Totem: gets back up once with n% health
}
export const ITEM_IDS = Object.keys(ITEMS)
export const ITEM_MAX = 99
// Their pictures: 10x10 pixel art, like the snacks.
const ITEM_PIX = {
  fang: { c: { s: '#8a6a3a', w: '#f4f0e0', d: '#c8c0a8' }, rows: [
    's........s', '.s......s.', '..ssssss..', '..w.ww.w..', '..w.ww.w..', '..d.wd.d..', '.....d....', '..........', '..........', '..........'] },
  feather: { c: { b: '#5ab8f0', l: '#a8e0ff', d: '#2a78b0', q: '#f0f0f0' }, rows: [
    '.......bb.', '......blbb', '.....blbbd', '....blbbd.', '...blbbd..', '..blbbd...', '.blbbd....', '.qbd......', 'q.........', '..........'] },
  helmet: { c: { g: '#9aa4b0', l: '#d0d8e0', d: '#5a6470', k: '#2a2a2a' }, rows: [
    '..........', '...gggg...', '..glllgg..', '.gglggggg.', '.gggggggd.', '.gddddddd.', '.gkkgkkgd.', '.gk.g.kgd.', '.gg.g.ggd.', '..........'] },
  charm: { c: { r: '#e83a5a', l: '#ff9ab0', d: '#a01e3a', s: '#c8a040' }, rows: [
    '....ss....', '...s..s...', '....ss....', '.rr....rr.', 'rlrr..rrrd', 'rlrrrrrrrd', '.rrrrrrrd.', '..rrrrrd..', '...rrrd...', '....dd....'] },
  collar: { c: { b: '#6a3a1a', l: '#9a5a2a', s: '#d0d8e0', g: '#f0c040' }, rows: [
    '..........', '..s.s.s...', '.bbbbbbbb.', 'blllllllbb', 'bb......bb', 'bb......bb', 'bbb....bbb', '.bbbgbbbb.', '....gg....', '..........'] },
  claws: { c: { w: '#f0ece0', d: '#a8a090', b: '#5a3a2a' }, rows: [
    '.w..w..w..', '.ww.ww.ww.', '..w..w..w.', '..wd.wd.wd', '..bb.bb.bb', '..bbbbbbbb', '..bbbbbbb.', '...bbbbb..', '..........', '..........'] },
  tooth: { c: { w: '#f4f0f0', d: '#c8c0c0', r: '#c81e2a' }, rows: [
    '..........', '.wwwwwwww.', '.wwwwwwwd.', '.wwwwwwwd.', '..ww..wd..', '..ww..wd..', '..wr..wd..', '..r...r...', '..r.......', '..........'] },
  bone: { c: { w: '#f4ecd8', d: '#c8b890', g: '#7ad070' }, rows: [
    'g.........', '.ww....ww.', 'wwww..wwwd', '.wwwwwwwd.', '..wwwwwd..', '.wwwwwwwd.', 'wwwd..wwwd', '.wd....wd.', '.........g', '..........'] },
  horn: { c: { h: '#e8d8a8', d: '#a88a50', b: '#6a4a2a' }, rows: [
    '..........', '........hh', '......hhhd', '....hhhhd.', '..hhhhdd..', '.bhhhd....', 'bbbhd.....', 'bbbd......', '.bb.......', '..........'] },
  totem: { c: { t: '#3a9a7a', l: '#7ad0b0', d: '#1e5a4a', y: '#f0d040', k: '#1a1a1a' }, rows: [
    '...tttt...', '..tllttt..', '..tykkyt..', '..tttttd..', '..tkkkkd..', '.ttttttdd.', '..tyttyd..', '..ttttdd..', '..tddddd..', '..........'] },
}
export const itemIconURL = (id) => pixelIconURL(`item-${id}`, ITEM_PIX[id])
export const itemImg = (id, cls) => `<img class="${cls}" src="${itemIconURL(id)}" alt="" draggable="false" />`
export const itemName = (id) => t(`item${cap(id)}`)
export const itemInfo = (id) => t(`itemInfo${cap(id)}`, { n: ITEMS[id].n })

// A random held item, the common ones more often.
export function rollItem(rand = Math.random) {
  const total = ITEM_IDS.reduce((n, id) => n + ITEMS[id].w, 0)
  let r = rand() * total
  for (const id of ITEM_IDS) {
    r -= ITEMS[id].w
    if (r < 0) return id
  }
  return ITEM_IDS[0]
}

// Drop chances (a guess): a Pack Leader beaten, a tournament round won.
// The tournament's champion always gets one.
export const ITEM_DROP = { leader: 0.5, round: 0.3 }

// Rolls a drop at this chance: the item found (now in the bag), or null.
export function dropItem(chance, rand = Math.random) {
  if (rand() >= chance) return null
  const id = rollItem(rand)
  giveItem(id)
  return id
}

// A held item found: into the bag.
export function giveItem(id) {
  if (!ITEMS[id]) return
  const data = loadCreatures()
  data.items[id] = Math.min(ITEM_MAX, (data.items[id] || 0) + 1)
  saveCreatures(data)
}

// Creature id holds item (from the bag); what it held goes back in the
// bag. 'ok' | 'none' (none left) | 'same' | 'gone'.
export function holdItem(id, item) {
  const data = loadCreatures()
  const c = data.list.find((o) => o.id === id)
  if (!c || !ITEMS[item]) return 'gone'
  if (c.hi === item) return 'same'
  if (!data.items[item]) return 'none'
  data.items[item]--
  if (!data.items[item]) delete data.items[item]
  if (c.hi) data.items[c.hi] = Math.min(ITEM_MAX, (data.items[c.hi] || 0) + 1)
  c.hi = item
  saveCreatures(data)
  return 'ok'
}

// Creature id's item back into the bag. -> the item, or null.
export function takeItem(id) {
  const data = loadCreatures()
  const c = data.list.find((o) => o.id === id)
  if (!c?.hi) return null
  const item = c.hi
  data.items[item] = Math.min(ITEM_MAX, (data.items[item] || 0) + 1)
  delete c.hi
  saveCreatures(data)
  return item
}

// --- Team combos (2026-11-11, Gaymi picked tiers): enough of one group
// on a team gives that group's members a bonus, bigger at each step.
// A creature can be in more than one group (a dinosaur is an Animal too).
// n: the bonus in % at each step. ---

const kindOf = (c) => (c.t === 'a' ? KINDS()[c.k] || {} : {})
// Flyers float over the arena's floor hazards (TeamBattle, Batch E).
export const flies = (c) => !!kindOf(c).fly
export const COMBOS = [
  { id: 'zombie', has: (c) => typeOf(c) === 'zombie', at: [3, 5, 7], n: [8, 16, 25] }, // health
  { id: 'skeleton', has: (c) => typeOf(c) === 'skeleton', at: [3, 5, 7], n: [10, 20, 30] }, // speed
  { id: 'animal', has: (c) => c.t === 'a', at: [3, 5, 7], n: [8, 16, 25] }, // attack
  { id: 'dino', has: (c) => !!kindOf(c).dino, at: [2, 4], n: [10, 20] }, // take less damage
  { id: 'flyer', has: (c) => !!kindOf(c).fly, at: [2, 4], n: [10, 20] }, // dodge
  { id: 'boss', has: (c) => !!c.b, at: [2, 3], n: [8, 15] }, // health and attack
]
export const comboName = (id) => t(`teamCombo${cap(id)}`)
export const comboInfo = (id, n) => t(`teamComboInfo${cap(id)}`, { n })

// Every group with at least one member on the team: [{ id, have, step
// (0 = not on yet), next (how many for the next step, or 0), n (the
// bonus now, %) }], the ones that are on first.
export function combosOf(team) {
  const out = []
  for (const k of COMBOS) {
    const have = team.filter(k.has).length
    if (!have) continue
    const step = k.at.filter((a) => have >= a).length
    out.push({ id: k.id, have, step, next: k.at[step] || 0, n: step ? k.n[step - 1] : 0, members: k.has })
  }
  return out.sort((a, b) => (b.step > 0) - (a.step > 0) || b.have - a.have)
}

export function creatureCount() {
  return loadCreatures().list.length
}

// Battle numbers: hp, atk (a hit), speed (blocks a second), reach (blocks)
// and rate (seconds between hits).
export function stats(c) {
  const s = baseStats(c)
  const grow = (1 + LEVEL_BOOST * (levelOf(c) - 1)) * (c.s ? 1 + SHINY_BOOST : 1)
  // bh / ba: health and attack from Gauntlet fruit (2026-11-23), only on a
  // Gauntlet run's own creatures (cleanCreature drops them everywhere else).
  const bonus = (v) => (Number.isInteger(v) && v > 0 ? v : 0)
  return { ...s, hp: Math.round(s.hp * grow) + bonus(c.bh), atk: Math.round(s.atk * grow) + bonus(c.ba) }
}

function baseStats(c) {
  const tier = ZOMBIE_TIERS[c.r] || ZOMBIE_TIERS.common
  if (c.t === 'a') {
    const k = KINDS()[c.k]
    const dino = k.dino ? DINO : { hp: 1, atk: 1 }
    const atk = (k.hunts ? 10 + (k.bite || 8) : 7 + k.health / 9) * dino.atk * tier.damage
    const size = Math.max(k.body[0], k.body[2])
    return {
      hp: Math.round(ANIMAL_HP(k.health) * dino.hp * tier.hp),
      atk: Math.round(atk),
      speed: ANIMAL_SPEED * tier.speed * (size > 2.5 ? 0.8 : 1),
      reach: Math.max(1.3, size * 0.6 + 0.6),
      rate: 1.1,
    }
  }
  const kind = MONSTER_KINDS[c.k] || SKELETON_KINDS[c.k] || { hp: 1, speed: 1, damage: 1 }
  const boss = c.b ? BOSS : { hp: 1, atk: 1 }
  return {
    hp: Math.round(ZOMBIE_BASE.hp * kind.hp * tier.hp * boss.hp),
    atk: Math.round(ZOMBIE_BASE.atk * kind.damage * tier.damage * boss.atk),
    speed: ZOMBIE_BASE.speed * Math.min(1.5, kind.speed) * tier.speed,
    reach: 1.4,
    rate: 1.2,
  }
}

// Special powers (2026-10-31, Gaymi: battles fight by themselves, with
// "special powers"). Every creature has one, from what it is - so a
// balance change reaches creatures already caught, like stats(). What
// each does is in TeamBattle.js; names and descriptions are i18n
// teamPower<Id> / teamPowerInfo<Id>.
export const POWERS = ['horde', 'bones', 'rage', 'stomp', 'pounce', 'roar', 'hide', 'heal']
export function powerOf(c) {
  if (c.t === 'a') {
    const k = KINDS()[c.k]
    if (k.dino) return 'roar'
    if (k.hunts) return 'pounce'
    if (Math.max(k.body[0], k.body[2]) > 2.2 || k.health >= 40) return 'hide'
    return 'heal'
  }
  if (c.b) return 'stomp'
  if (SKELETON_KINDS[c.k]) return 'bones'
  if (MONSTER_KINDS[c.k]) return 'rage'
  return 'horde'
}

export function powerName(c) {
  const id = powerOf(c)
  return t(`teamPower${id[0].toUpperCase()}${id.slice(1)}`)
}

export function powerInfo(c) {
  const id = powerOf(c)
  return t(`teamPowerInfo${id[0].toUpperCase()}${id.slice(1)}`)
}

// Trigger powers (2026-11-11): a second power, unlocked at TRIGGER_LEVEL,
// that goes off when something happens - the battle starts, it faints, a
// friend faints, it gets low. One for each first power. What each does is
// in TeamBattle.js; i18n teamTrig<Id> / teamTrigInfo<Id>.
export const TRIGGERS = { horde: 'groan', bones: 'gift', rage: 'revenge', stomp: 'quake', pounce: 'second', roar: 'cry', hide: 'guard', heal: 'mend' }
export const triggerOf = (c) => TRIGGERS[powerOf(c)]
export const hasTrigger = (c) => levelOf(c) >= TRIGGER_LEVEL
const cap = (id) => id[0].toUpperCase() + id.slice(1)
export const triggerName = (id) => t(`teamTrig${cap(id)}`)
export const triggerInfo = (id) => t(`teamTrigInfo${cap(id)}`)

// How strong a whole team is (for matching ghost teams fairly).
export function power(team) {
  return Math.round(team.reduce((sum, c) => {
    const s = stats(c)
    return sum + Math.sqrt(s.hp * s.atk / s.rate)
  }, 0))
}

// --- Nicknames (2026-11-23, Gaymi picked: everyone sees them, up to 50
// letters, each creature picks if its kind shows too) ---

export const NICK_MAX = 50
// The chat bad-word swap, handed in by TeamUI (Game.js's _censorText) so
// this file doesn't pull in Game.js. Ghost teams go through it too.
let _nickFilter = (s) => s
export function setNickFilter(fn) {
  if (typeof fn === 'function') _nickFilter = fn
}
// A typed nickname made safe: no control characters, single spaces,
// bad words swapped, at most NICK_MAX letters. '' = no nickname.
export function cleanNick(s) {
  if (typeof s !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const plain = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim()
  if (!plain) return ''
  return Array.from(String(_nickFilter(plain) || '')).slice(0, NICK_MAX).join('').trim()
}

// Its nickname if it has one, else what it is ("Rotten Rick", "Cow").
export function creatureName(c) {
  if (c.nm) return c.nm
  return kindName(c)
}

// What it is, ignoring any nickname.
export function kindName(c) {
  if (c.t === 'a') return t(animalNameKey(c.k))
  return zombieName(c.n)
}

// The small "what it is" line under a nickname - '' when it shouldn't show.
export function kindNote(c) {
  return c.nm && c.nk ? kindName(c) : ''
}

// For tight spots (a 3D name tag): cut with "..." past max letters.
export function shortName(c, max = 20) {
  const a = Array.from(creatureName(c))
  return a.length > max ? `${a.slice(0, max - 1).join('').trim()}…` : a.join('')
}

// Give one of my creatures a nickname (or clear it with ''). Returns the
// saved creature, or null when there's no creature with that id.
export function renameCreature(id, name, showKind) {
  const data = loadCreatures()
  const c = data.list.find((o) => o.id === id)
  if (!c) return null
  const nm = cleanNick(name)
  if (nm) {
    c.nm = nm
    if (showKind) c.nk = true
    else delete c.nk
  } else {
    delete c.nm
    delete c.nk
  }
  saveCreatures(data)
  return c
}

// What it is, for the card under its name ("Zombie", "Boss Zombie", "Cow").
export function creatureType(c) {
  if (c.t === 'a') return t('teamTypeAnimal')
  if (SKELETON_KINDS[c.k] && !c.b) return t('teamTypeSkeleton')
  return t(c.b ? 'teamTypeBoss' : 'teamTypeZombie')
}

export function rarityName(r) {
  return t(`rarity${r[0].toUpperCase()}${r.slice(1)}`)
}

export { tierColor }

// A small picture: the animal's own (PlayAnimals), or a blocky zombie face.
const _zIcons = new Map()
export function creatureIconURL(c) {
  if (c.t === 'a') return animalIconURL(c.k)
  const key = `${c.k || ''}:${c.b ? 1 : 0}`
  if (_zIcons.has(key)) return _zIcons.get(key)
  const S = 16
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')
  const skin = SKELETON_KINDS[c.k] ? '#e8e0c8' : MONSTER_KINDS[c.k] ? '#7a9a4a' : '#5f9a52'
  const rows = [
    '................',
    '..hhhhhhhhhhhh..',
    '..hsssssssssss..',
    '..ssssssssssss..',
    '..ssssssssssss..',
    '..sseesssseess..',
    '..sseesssseess..',
    '..ssssssssssss..',
    '..sssssddsssss..',
    '..ssssssssssss..',
    '..ssmmmmmmmmss..',
    '..ssmwmmwmmmss..',
    '..ssssssssssss..',
    '..ssssssssssss..',
    '................',
    '................',
  ]
  const col = { h: c.b ? '#c0282a' : '#3a2a1a', s: skin, e: '#151515', d: '#2a3a20', m: '#3a1010', w: '#f2ecdc' }
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    g.fillStyle = col[ch]
    g.fillRect(x, y, 1, 1)
  }))
  const url = cv.toDataURL()
  _zIcons.set(key, url)
  return url
}

// --- teams to battle when nobody else's ghost team can be found ---

const BOT_ANIMALS = ['wolf', 'bear', 'boar', 'fox', 'horse', 'cow', 'polarBear', 'camel', 'lion', 'tiger', 'crocodile', 'gorilla']
const BOT_ZOMBIES = [null, null, null, 'hunched', 'beast', 'skinny', 'brute', 'crawler']

// A made-up team about as strong as mine (target: power()), as many as
// mine (size).
export function botTeam(target, size = TEAM_SIZE, rand = Math.random) {
  const kinds = BOT_ANIMALS.filter((k) => Object.hasOwn(KINDS(), k))
  const pick = (list) => list[Math.floor(rand() * list.length)]
  let best = null
  for (let i = 0; i < 12; i++) {
    const team = []
    for (let j = 0; j < Math.max(1, Math.min(TEAM_SIZE, size)); j++) {
      const r = ZOMBIE_TIER_IDS[Math.min(ZOMBIE_TIER_IDS.length - 1, Math.floor(rand() * rand() * 4))]
      team.push(rand() < 0.5 && kinds.length
        ? { t: 'a', k: pick(kinds), r }
        : { t: 'z', k: pick(BOT_ZOMBIES), r, n: Math.floor(rand() * NAME_COUNT), b: false })
    }
    const diff = Math.abs(power(team) - target)
    if (!best || diff < best.diff) best = { team, diff }
  }
  return best.team
}

// The short form sent to Firestore for a ghost team (ghostTeams/{uid}).
export function packTeam(team) {
  return team.map((c) => {
    const L = levelOf(c)
    const out = c.t === 'a' ? { t: 'a', k: c.k, r: c.r } : { t: 'z', k: c.k || '', r: c.r, n: c.n, b: !!c.b }
    if (L > 1) out.l = L
    if (c.s) out.s = true
    if (c.hi) out.hi = c.hi
    if (c.nm) {
      out.nm = c.nm
      if (c.nk) out.nk = true
    }
    return out
  })
}

export function unpackTeam(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, TEAM_SIZE).map((c) => cleanCreature(c && c.t === 'z' && c.k === '' ? { ...c, k: null } : c)).filter(Boolean)
    // Snacks are only ever my own (Gaymi, 2026-11-11).
    .map(({ sn: _sn, ...c }) => c)
}
