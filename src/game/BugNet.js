// Bug Net and Bug Book (2026-11-27, Gaymi's six ideas, batch 4: "catch the
// flying insects and fill a Bug Book, like the Zombie Book / Pet Book").
//
// Gaymi's answers: the net is both bought (Shop > Items, NET_COST) and
// crafted (PlayCrafting RECIPES); it catches every bug (BUG_IDS - flying
// ones and ground ones, not the big friendly spider or sea life); a caught
// bug goes in your bag as a Bug Jar of its kind (`jar_<kind>`), sold at the
// Shop (B > Items > Sell Bug Jars) for JAR_PRICE coins by how rare it is;
// the Bug Book pays homepage coins at 25 / 50 / 75 / 100% (BOOK_PRIZES).
//
// Hold the net and click (or the phone's use button): the nearest bug in
// front of you within REACH blocks is caught - no roll, bugs are easy, but
// you have to get close. A pet is never caught. On a server only the host
// runs the animals, so a guest's net says so (bugNetHostOnly).
//
// What's kept on this device (KEY): { n: { kind: how many caught }, f: {
// kind: first caught (ms) }, bp: [milestones paid] }. Written only on a
// catch. The book's page is Inventory > Bug Book (renderBugBook).
// Numbers are a guess.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { ITEMS, ICON_PIXELS } from './PlayInventory.js'
import { PlayAnimals, animalRarity, animalNameKey, animalIconURL } from './PlayAnimals.js'
import { saveShopProgress } from './Game.js'
import { whereText } from './PetBook.js'

export const KEY = 'gayz-bug-book'
export const NET_COST = 45
export const REACH = 3.5 // blocks
const AIM_DOT = 0.75 // how straight ahead it must be (1 = dead centre)
const SWING_GAP_MS = 450
export const BOOK_MILESTONES = [25, 50, 75, 100]
export const BOOK_PRIZES = { 25: 100, 50: 250, 75: 500, 100: 1200 }
// A jar sells for this many in-game coins, by the bug's rarity.
export const JAR_PRICE = { common: 8, uncommon: 15, rare: 30, epic: 60, legendary: 120, mythic: 200 }

// Every bug the net can catch (the ones this game has; flying first).
const BUG_LIST = 'butterfly bee moth mosquito fly dragonfly firefly wasp hornet cicada ant beetle ladybug grasshopper cricket caterpillar mantis scorpion centipede stickInsect tarantula stagBeetle rhinoBeetle glowworm millipede waterStrider cockroach termite queenAnt soldierAnt darkLadybug'
export const BUG_IDS = BUG_LIST.split(' ').filter((k) => PlayAnimals.KINDS[k])
const IS_BUG = new Set(BUG_IDS)
export const isBug = (kind) => IS_BUG.has(kind)

export const jarId = (kind) => `jar_${kind}`
export const jarKind = (id) => (typeof id === 'string' && id.startsWith('jar_') && IS_BUG.has(id.slice(4)) ? id.slice(4) : null)
export const jarPrice = (kind) => JAR_PRICE[animalRarity(kind)] ?? JAR_PRICE.common
export const bugName = (kind) => t(animalNameKey(kind))

// The net and a jar for every bug, in the bag (PlayInventory ITEMS).
// A jar is glass with the bug's colour inside (z/x pixels, tinted).
ICON_PIXELS.bugNet = ['......wwwww.....', '.....w.w.w.w....', '....w.w.w.w.w...', '....ww.w.w.ww...', '....w.w.w.w.w...', '.....w.w.w.w....', '......wwwww.....', '.......k........', '.......k........', '......k.........', '......k.........', '.....k..........', '.....k..........', '....k...........']
ICON_PIXELS.bugJar = ['................', '.....kkkkkk.....', '.....kkkkkk.....', '....#cccccc#....', '...#cc....cc#...', '...#c......c#...', '...#c..zz..c#...', '...#c.zxxz.c#...', '...#c..zz..c#...', '...#c......c#...', '...#cc....cc#...', '....########....']
ITEMS.bugNet = { key: 'invBugNet', bugNet: true }
for (const kind of BUG_IDS) {
  ITEMS[jarId(kind)] = { key: 'invBugJar', animalKey: animalNameKey(kind), icon: 'bugJar', tint: PlayAnimals.KINDS[kind].colors?.body ?? 0x6a5a3a, bugJar: true }
}

// --- the book ---

export function loadBugBook() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    d = {}
  }
  const out = { n: {}, f: {}, bp: [] }
  if (!d || typeof d !== 'object') return out
  for (const k of BUG_IDS) {
    const n = Math.floor(Number(d.n?.[k]) || 0)
    if (n > 0) {
      out.n[k] = Math.min(99999, n)
      const f = Number(d.f?.[k])
      if (Number.isFinite(f) && f > 0) out.f[k] = f
    }
  }
  if (Array.isArray(d.bp)) out.bp = BOOK_MILESTONES.filter((m) => d.bp.includes(m))
  return out
}

function saveBugBook(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch { /* not kept */ }
}

export const bookPct = (d) => Math.floor((BUG_IDS.filter((k) => d.n[k]).length / BUG_IDS.length) * 100)

// A bug caught: counted in the book. -> { first, paid, milestone }.
// Milestone coins are the homepage's (game.coins), like the Pet Book's.
export function recordBug(kind, game, now = Date.now()) {
  const d = loadBugBook()
  const first = !d.n[kind]
  d.n[kind] = (d.n[kind] || 0) + 1
  if (first) d.f[kind] = now
  const pct = bookPct(d)
  const due = BOOK_MILESTONES.filter((m) => pct >= m && !d.bp.includes(m))
  d.bp.push(...due)
  saveBugBook(d)
  let paid = 0
  for (const m of due) paid += BOOK_PRIZES[m]
  if (paid && game) {
    game.coins = (game.coins || 0) + paid
    game._playStats?.countCoins?.('bankIn', 'bugs', paid)
    saveShopProgress(game)
    game._renderCurrencyBar?.()
  }
  return { first, paid, milestone: due[due.length - 1] || 0 }
}

// --- the net, in a game (BuildSurvival `s.bugNet`) ---

export class BugNet {
  constructor(survival) {
    this.s = survival
    this._nextAt = 0
    // For the tests (tests/camp.spec.js).
    this.lib = bugTest
  }

  // The nearest bug in front of me within reach (not a pet).
  target() {
    const s = this.s
    const list = s.animals?.list || []
    const cam = s.bm.camera
    cam.updateMatrixWorld()
    const B = s.B
    const ex = cam.position.x / B
    const ey = cam.position.y / B
    const ez = cam.position.z / B
    const e = cam.matrixWorld.elements
    // The camera looks down its -Z.
    const dx = -e[8]
    const dy = -e[9]
    const dz = -e[10]
    const len = Math.hypot(dx, dy, dz) || 1
    const me = s.bodyPos()
    let best = null
    let bestD = Infinity
    for (const a of list) {
      if (!isBug(a.kind) || a.tamed || a.dying || a.petOf) continue
      const ox = a.x - ex
      const oy = a.y + 0.15 - ey
      const oz = a.z - ez
      const d = Math.hypot(ox, oy, oz)
      if (d > REACH + 1.5 || d < 0.001) continue
      // Close by your feet counts too (bugs on the ground are tiny).
      const flat = Math.hypot(a.x - me.x, a.z - me.z)
      if (flat > REACH) continue
      const dot = (ox * dx + oy * dy + oz * dz) / (d * len)
      const flatDot = (ox * dx + oz * dz) / ((Math.hypot(ox, oz) || 1) * (Math.hypot(dx, dz) || 1))
      if (dot < AIM_DOT && !(flat < 1.6 && flatDot > 0.5)) continue
      if (d < bestD) {
        best = a
        bestD = d
      }
    }
    return best
  }

  // Clicked with the net held. -> true (the net is never used up).
  use() {
    const s = this.s
    const now = performance.now()
    if (now < this._nextAt) return true
    this._nextAt = now + SWING_GAP_MS
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
    if (s.net && !s.net.isHost) {
      s._message(t('bugNetHostOnly'), 3)
      return true
    }
    const a = this.target()
    if (!a) {
      s._message(t('bugNetMiss'), 2)
      return true
    }
    return this.catch(a)
  }

  catch(a) {
    const s = this.s
    const kind = a.kind
    if (s.inv?.add({ kind: 'item', id: jarId(kind), n: 1 })) {
      s._message(t('invFull'))
      return true
    }
    s.animals.remove(a)
    try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
    const game = s.bm?.game
    const r = recordBug(kind, game)
    const name = bugName(kind)
    let text = r.first ? t('bugNetNewPage', { name }) : t('bugNetCaught', { name })
    if (r.paid) text += ` ${t('bugBookPrize', { p: r.milestone, n: r.paid })}`
    s._message(text, r.first || r.paid ? 4 : 2)
    s._renderHud?.()
    return true
  }
}

// Every Bug Jar in the bag: { count, coins }.
export function jarsIn(inv) {
  let count = 0
  let coins = 0
  for (const list of [inv?.grid || [], inv?.hotbar || []]) {
    for (const it of list) {
      const k = it?.kind === 'item' && !it.lk ? jarKind(it.id) : null
      if (!k) continue
      count += it.n
      coins += it.n * jarPrice(k)
    }
  }
  return { count, coins }
}

// Sells every (unlocked) Bug Jar for in-game coins. -> coins got.
export function sellJars(s) {
  const inv = s.inv
  if (!inv) return 0
  let coins = 0
  for (const list of [inv.grid, inv.hotbar]) {
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      const k = it?.kind === 'item' && !it.lk ? jarKind(it.id) : null
      if (!k) continue
      coins += it.n * jarPrice(k)
      list[i] = null
    }
  }
  if (!coins) return 0
  inv.apply?.()
  inv.renderHotbar?.()
  if (inv.open) inv.render?.()
  const before = s._coinsEarned
  s._earn(coins, 'bugs')
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  return s._coinsEarned - before
}

// --- Inventory > Bug Book (the homepage) ---

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const rarityKey = (r) => `rarity${r[0].toUpperCase()}${r.slice(1)}`

export function renderBugBook() {
  const page = $('bug-book-page')
  if (!page) return
  const d = loadBugBook()
  const caught = BUG_IDS.filter((k) => d.n[k]).length
  const pct = bookPct(d)
  const next = BOOK_MILESTONES.find((m) => !d.bp.includes(m))
  const how = $('bug-book-how')
  if (how) how.textContent = t('bugBookHow')
  const head = $('bug-book-count')
  if (head) {
    head.innerHTML = `<span>${esc(t('bugBookCount', { n: caught, max: BUG_IDS.length, p: pct }))}</span>
      <span class="pet-book-bar"><span style="width: ${pct}%"></span></span>
      <span class="pet-book-next">${esc(next ? t('bugBookNext', { p: next, n: BOOK_PRIZES[next] }) : t('bugBookDone'))}</span>`
  }
  const grid = $('bug-book-grid')
  if (!grid) return
  grid.innerHTML = BUG_IDS.map((k) => {
    const n = d.n[k] || 0
    const where = whereText({ t: 'a', k })
    const sub = n ? `${t(rarityKey(animalRarity(k)))} · ${t('bugBookCaught', { n })}` : where
    return `<div class="perk-option team-card bug-book-card${n ? '' : ' unmet'}" data-bug="${esc(k)}" title="${esc(n ? `${bugName(k)} - ${where}` : where)}">
      <img src="${animalIconURL(k)}" alt="" draggable="false" />
      <span class="team-card-name">${esc(n ? bugName(k) : '???')}</span>
      <span class="team-card-type">${esc(sub)}</span>
    </div>`
  }).join('')
}

export function bindBugBookUI() {
  $('inventory-tab-bugbook')?.addEventListener('click', () => renderBugBook())
}

// For the tests (tests/camp.spec.js).
export const bugTest = { BUG_IDS, KEY, recordBug, loadBugBook, jarsIn, sellJars, jarId, jarPrice, BOOK_PRIZES, renderBugBook }
