// The Collection book on the Pets tab (pet battles round 4, Batch K,
// 2026-11-24). Gaymi picked: a grid of every creature kind in groups, tap
// one to open its page; a kind not caught yet is a dark shape with "???"
// and where to find it; a caught one's page has the basics (picture, name,
// type, power, health / attack), my record (how many caught, first caught,
// best level, shiny) and where it lives; coins at 25 / 50 / 75 / 100%
// (Creatures.BOOK_PRIZES). Pets caught before the book count (syncBook).
// What's kept is in Creatures.js ("Collection book").
import { loadCreatures, saveCreatures, addCreature, bookKinds, bookKey, bookGroup, syncBook, claimBookPrizes, BOOK_PRIZES, BOOK_MILESTONES, stats, powerName, powerInfo, creatureType, rarityName, creatureIconURL, tierColor } from './Creatures.js'
import { PlayAnimals, BIOME_ANIMALS, animalRarity, animalNameKey } from './PlayAnimals.js'
import { DINO_BIOMES } from './DinoKinds.js'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { biomeName } from './OpenWorld.js'
import { bookPictures } from './ZombieBook.js'
import { saveShopProgress } from './Game.js'
import { t } from './i18n.js'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const BOOK_GROUPS = ['all', 'zombie', 'skeleton', 'animal', 'dino']
const WHERE_MAX = 4

const state = { group: 'all', search: '', open: null }
// For the tests (tests/team.spec.js, via game._petBook).
export const bookTest = { addCreature, bookKinds, BOOK_PRIZES, state }

// A stand-in creature for a page: an animal at its own rarity, a zombie
// as a common one.
function sample(c) {
  return c.t === 'a' ? { t: 'a', k: c.k, r: animalRarity(c.k) } : { t: 'z', k: c.k, r: 'common', n: 0, b: false }
}

export function pageName(c) {
  if (c.t === 'a') return t(animalNameKey(c.k))
  return t(`book_${c.k || 'zombie'}`)
}

// Which biomes an animal lives in (dinosaurs too: rare there).
let _where = null
function animalBiomes() {
  if (_where) return _where
  _where = {}
  const add = (biome, k) => {
    if (!biomeName(biome)) return
    const list = _where[k] || (_where[k] = [])
    if (!list.includes(biome)) list.push(biome)
  }
  for (const [biome, table] of Object.entries(BIOME_ANIMALS)) for (const k of Object.keys(table)) add(biome, k)
  for (const [biome, ids] of Object.entries(DINO_BIOMES)) for (const k of ids) add(biome, k)
  return _where
}

export function whereText(c) {
  if (c.t === 'a') {
    const list = animalBiomes()[c.k] || []
    if (!list.length) return t('petBookWhereEggs')
    const names = list.slice(0, WHERE_MAX).map(biomeName)
    const more = list.length > WHERE_MAX ? ` ${t('petBookWhereMore', { n: list.length - WHERE_MAX })}` : ''
    return `${names.join(', ')}${more}${PlayAnimals.KINDS[c.k]?.dino ? ` ${t('petBookWhereRare')}` : ''}`
  }
  const realm = MONSTER_KINDS[c.k]?.realm
  if (realm) return t(`bookRealm_${realm}`)
  if (MONSTER_KINDS[c.k]?.waves === false) return t('petBookWhereEggs')
  return t('petBookWhereAny')
}

// Zombie and skeleton kinds use the Zombie Book's 3D pictures (drawn once,
// ZombieBook.bookPictures); the small pixel face until they're ready.
let _zpics = null
function pic(c, cls = '') {
  const z = c.t === 'z' && _zpics?.[c.k || 'zombie']
  return `<img class="${cls}${z ? ' pet-book-3d' : ''}" src="${z || creatureIconURL(sample(c))}" alt="" draggable="false" />`
}

function when(ms) {
  if (!ms) return '?'
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return '?'
  }
}

function card(c, e) {
  const key = bookKey(c)
  const s = sample(c)
  return `<button type="button" class="perk-option team-card pet-book-card${e ? '' : ' unmet'}${state.open === key ? ' picked' : ''}" data-book-key="${esc(key)}" style="--tier: ${e ? tierColor(s.r) : 'transparent'}">
    ${e?.s ? '<span class="team-card-shiny">✦</span>' : ''}
    ${pic(c)}
    <span class="team-card-name">${esc(e ? pageName(c) : '???')}</span>
  </button>`
}

function page(c, e) {
  const s = sample(c)
  const where = `<p class="pet-book-where"><b>${esc(t('petBookWhere'))}</b> ${esc(whereText(c))}</p>`
  if (!e) {
    return `${pic(c, 'pet-book-pic unmet')}
      <div class="pet-book-info">
        <h4>???</h4>
        <p>${esc(t('petBookNotCaught'))}</p>
        ${where}
      </div>`
  }
  const st = stats(s)
  return `${pic(c, 'pet-book-pic')}
    <div class="pet-book-info">
      <h4>${esc(pageName(c))}${e.s ? ' <span class="pet-book-shiny">✦</span>' : ''}</h4>
      <p>${esc(c.t === 'a' ? `${rarityName(s.r)} ${creatureType(s)}` : creatureType(s))} · ${esc(t('teamStats', { hp: st.hp, atk: st.atk }))}</p>
      <p title="${esc(powerInfo(s))}"><b>${esc(powerName(s))}</b> - ${esc(powerInfo(s))}</p>
      <p>${esc(t('petBookRecord', { n: e.n, lv: e.lv, date: when(e.f) }))}${e.s ? ` · ${esc(t('petBookShinyGot'))}` : ''}</p>
      ${where}
    </div>`
}

// Brings the book up to date and pays any milestone reached.
// Returns { data, paid } (paid: coins just given).
export function updateBook(game) {
  const data = loadCreatures()
  const changed = syncBook(data)
  const due = claimBookPrizes(data)
  if (changed || due.length) saveCreatures(data)
  let paid = 0
  for (const m of due) paid += BOOK_PRIZES[m]
  if (paid && game) {
    game.coins = (game.coins || 0) + paid
    saveShopProgress(game)
    game._renderCurrencyBar?.()
    game._showHomepageToast?.(t('petBookPrize', { p: due[due.length - 1], n: paid }))
  }
  return { data, paid }
}

export function renderPetBook(game) {
  const box = $('pet-book')
  if (!box || box.hidden) return
  if (!_zpics) {
    bookPictures().then((p) => {
      if (_zpics) return
      _zpics = p
      if (!box.hidden && box.offsetParent) renderPetBook(game)
    }).catch(() => {})
  }
  const { data } = updateBook(game)
  const all = bookKinds()
  const caught = all.filter((c) => data.book[bookKey(c)]).length
  const pct = Math.floor((caught / all.length) * 100)
  const next = BOOK_MILESTONES.find((m) => !data.bp.includes(m))
  const head = $('pet-book-count')
  if (head) {
    head.innerHTML = `<span>${esc(t('petBookCount', { n: caught, max: all.length, p: pct }))}</span>
      <span class="pet-book-bar"><span style="width: ${pct}%"></span></span>
      <span class="pet-book-next">${esc(next ? t('petBookNext', { p: next, n: BOOK_PRIZES[next] }) : t('petBookDone'))}</span>`
  }
  const open = state.open && all.find((c) => bookKey(c) === state.open)
  const pg = $('pet-book-page')
  if (pg) {
    pg.classList.toggle('empty', !open)
    pg.innerHTML = open ? page(open, data.book[state.open]) : `<p class="team-snack-hint">${esc(t('petBookTap'))}</p>`
  }
  for (const b of box.querySelectorAll('[data-book-group]')) b.classList.toggle('open', b.dataset.bookGroup === state.group)
  const q = state.search.trim().toLowerCase()
  const shown = all.filter((c) => {
    if (state.group !== 'all' && bookGroup(c) !== state.group) return false
    if (!q) return true
    // Searching finds caught kinds by name (not caught ones stay a secret).
    return !!data.book[bookKey(c)] && pageName(c).toLowerCase().includes(q)
  })
  const grid = $('pet-book-grid')
  if (grid) {
    const top = grid.scrollTop
    grid.innerHTML = shown.length
      ? shown.map((c) => card(c, data.book[bookKey(c)])).join('')
      : `<p class="team-snack-hint">${esc(t('petBookNone'))}</p>`
    grid.scrollTop = top
  }
}

export function bindPetBook(game) {
  if (game._petBookBound) return
  game._petBookBound = true
  const btn = $('pet-book-btn')
  const box = $('pet-book')
  if (!btn || !box) return
  btn.textContent = t('petBookBtn')
  const search = $('pet-book-search')
  if (search) search.placeholder = t('petBookSearch')
  for (const b of box.querySelectorAll('[data-book-group]')) b.textContent = t(`petBookGroup_${b.dataset.bookGroup}`)
  btn.addEventListener('click', () => {
    box.hidden = !box.hidden
    btn.classList.toggle('open', !box.hidden)
    renderPetBook(game)
  })
  box.addEventListener('click', (e) => {
    const g = e.target.closest('[data-book-group]')
    if (g) {
      state.group = g.dataset.bookGroup
      renderPetBook(game)
      return
    }
    const c = e.target.closest('[data-book-key]')
    if (c) {
      state.open = state.open === c.dataset.bookKey ? null : c.dataset.bookKey
      renderPetBook(game)
    }
  })
  search?.addEventListener('input', () => {
    state.search = search.value
    renderPetBook(game)
  })
}
