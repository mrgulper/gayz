// Crate Spin (2026-11-25, big shop plan batch 4; replaced the Coming Soon
// card and turned the Wood / Ice / Golden crates on). Opening a crate
// rolls a prize, gives it straight away (closing early loses nothing),
// then a reel of prizes slides past and stops on it.
// - Shop > Crates: the price button buys one and opens it; clicking the
//   rest of the card buys several to keep (Inventory > Crates).
// - Inventory > Crates: Open uses one you own.
// Prizes: something from the Shop (ShopCatalog.js) or coins. A better
// crate holds pricier things and bigger coin piles. Already own the item?
// You get a quarter of its worth in coins instead. Odds and coin amounts
// are a guess.
import { CRATE_TIERS, CRATE_ICON_SVG, CRATE_TIER_COLORS, _escapeHtml, saveShopProgress } from './Game.js'
import { shopCatalog, coinValue, ownsItem, grantItem, itemImg, fillSkinImgs } from './ShopCatalog.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

// itemChance: how often the prize is an item (else coins). maxItem: the
// priciest item (in coins) this crate can hold. coins: [amount, weight].
export const CRATE_PRIZES = {
  wood: { itemChance: 0.3, maxItem: 25000, coins: [[1000, 30], [2500, 30], [4000, 20], [7500, 12], [12000, 8]] },
  ice: { itemChance: 0.35, maxItem: 75000, coins: [[5000, 30], [10000, 28], [18000, 20], [30000, 14], [50000, 8]] },
  golden: { itemChance: 0.4, maxItem: Infinity, coins: [[15000, 30], [30000, 28], [50000, 20], [80000, 14], [150000, 8]] },
}
export const DUPLICATE_SHARE = 0.25
const REEL_TILES = 44
const PRIZE_TILE = 37
const SPIN_MS = 5200

const tierName = (tier) => t(`crateTier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`)
export const crateItems = (tier) => shopCatalog().filter((it) => coinValue(it) <= CRATE_PRIZES[tier].maxItem)

function pickWeighted(list, weightOf, rnd) {
  const total = list.reduce((s, x) => s + weightOf(x), 0)
  let r = rnd() * total
  for (const x of list) {
    r -= weightOf(x)
    if (r <= 0) return x
  }
  return list[list.length - 1]
}

// One prize: { type: 'item', it } or { type: 'coins', amount }. Cheaper
// items come up more often (weight 1 / square root of the price).
export function rollPrize(tier, rnd = Math.random) {
  const P = CRATE_PRIZES[tier]
  const items = crateItems(tier)
  if (items.length && rnd() < P.itemChance) {
    return { type: 'item', it: pickWeighted(items, (it) => 1 / Math.sqrt(coinValue(it)), rnd) }
  }
  const [amount] = pickWeighted(P.coins, (c) => c[1], rnd)
  return { type: 'coins', amount }
}

// Gives the prize. Returns what really happened: { ...prize, dupCoins }.
export function givePrize(game, prize) {
  if (prize.type === 'coins') {
    game.coins += prize.amount
    game._playStats?.countCoins?.('bankIn', 'crates', prize.amount)
    return prize
  }
  if (ownsItem(game, prize.it)) {
    const dupCoins = Math.max(50, Math.round((coinValue(prize.it) * DUPLICATE_SHARE) / 50) * 50)
    game.coins += dupCoins
    game._playStats?.countCoins?.('bankIn', 'crates', dupCoins)
    return { ...prize, dupCoins }
  }
  grantItem(game, prize.it)
  return prize
}

let coinSvg = ''
function coinIcon() {
  if (!coinSvg) coinSvg = document.querySelector('#crate-purchase-confirm-btn .currency-icon')?.outerHTML || ''
  return coinSvg
}

function tile(prize) {
  if (prize.type === 'coins') {
    return `<div class="inv-skin-card crate-spin-tile crate-spin-coins" style="--rarity: #e8c14a">${coinIcon()}`
      + `<span class="inv-skin-card-name">${prize.amount.toLocaleString()}</span></div>`
  }
  const it = prize.it
  return `<div class="inv-skin-card crate-spin-tile" style="--rarity: ${it.color}">${itemImg(it, 'crate-spin-img')}`
    + `<span class="inv-skin-card-name">${_escapeHtml(it.name())}</span></div>`
}

const els = () => ({
  modal: document.getElementById('crate-spin-modal'),
  box: document.getElementById('crate-spin-box'),
  title: document.getElementById('crate-spin-title'),
  win: document.getElementById('crate-spin-window'),
  strip: document.getElementById('crate-spin-strip'),
  result: document.getElementById('crate-spin-result'),
  again: document.getElementById('crate-spin-again-btn'),
  close: document.getElementById('crate-spin-close-btn'),
})

let spinning = null // { finish } while the reel moves
let lastTier = ''

// What "Open Another" does now: use one you own, else buy one.
function againLabel(game, tier) {
  if ((game.crateStock[tier] || 0) > 0) return t('crateSpinAgainOwned', { n: game.crateStock[tier] })
  return t('crateSpinAgainBuy', { price: game._formatSkinPrice('coins', CRATE_TIERS[tier].cost) })
}

function resultText(got) {
  if (got.type === 'coins') return t('crateSpinWonCoins', { n: got.amount.toLocaleString() })
  if (got.dupCoins) return t('crateSpinWonDup', { name: got.it.name(), n: got.dupCoins.toLocaleString() })
  return t('crateSpinWonItem', { name: got.it.name() })
}

// Shows the reel for `tier` stopping on `got` (already given).
function showReel(game, tier, got) {
  const E = els()
  if (!E.modal) return
  bindModal(game)
  lastTier = tier
  E.box.style.setProperty('--crate-tier-color', CRATE_TIER_COLORS[tier] || '#e3c23c')
  E.title.innerHTML = `${CRATE_ICON_SVG[tier] || ''}<span>${_escapeHtml(t('crateSpinTitle', { name: tierName(tier) }))}</span>`
  E.result.textContent = ''
  E.result.classList.remove('show')
  E.again.hidden = true
  E.close.hidden = true
  const tiles = []
  for (let i = 0; i < REEL_TILES; i++) tiles.push(i === PRIZE_TILE ? got : rollPrize(tier))
  E.strip.style.transition = 'none'
  E.strip.style.transform = 'translateX(0px)'
  E.strip.innerHTML = tiles.map(tile).join('')
  fillSkinImgs(E.strip)
  E.modal.style.display = 'flex'
  const prizeEl = E.strip.children[PRIZE_TILE]
  const jitter = (Math.random() - 0.5) * prizeEl.offsetWidth * 0.6
  const target = prizeEl.offsetLeft + prizeEl.offsetWidth / 2 - E.win.clientWidth / 2 + jitter
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const ms = reduced ? 300 : SPIN_MS
  try { audioEngine.playUi?.('unbox') } catch { /* no audio */ }
  let done = false
  const finish = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    spinning = null
    E.strip.style.transition = 'none'
    E.strip.style.transform = `translateX(${-target}px)`
    prizeEl.classList.add('won')
    E.result.textContent = resultText(got)
    E.result.classList.add('show')
    E.again.textContent = againLabel(game, tier)
    E.again.disabled = (game.crateStock[tier] || 0) <= 0 && game.coins < CRATE_TIERS[tier].cost
    E.again.hidden = false
    E.close.hidden = false
    try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
    game._showHomepageToast(E.result.textContent)
  }
  // Two frames so the start position paints before the slide begins.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (done) return
    E.strip.style.transition = `transform ${ms}ms cubic-bezier(0.08, 0.6, 0.12, 1)`
    E.strip.style.transform = `translateX(${-target}px)`
  }))
  const timer = setTimeout(finish, ms + 80)
  spinning = { finish }
}

function afterChange(game) {
  saveShopProgress(game)
  game._renderCurrencyBar()
  game._renderCrateTiers()
  game._renderShopSkinState?.()
  if (game.menuInventoryPanel?.style.display !== 'none') game._renderInventorySkins?.()
}

function openNow(game, tier) {
  const got = givePrize(game, rollPrize(tier))
  afterChange(game)
  showReel(game, tier, got)
  return got
}

// Shop's price button: pay for one crate and open it.
export function buyAndSpin(game, tier) {
  const cfg = CRATE_TIERS[tier]
  if (!cfg || spinning) return null
  if (game.coins < cfg.cost) {
    try { audioEngine.playUi?.('error') } catch { /* no audio */ }
    game._showHomepageToast(t('crateNotEnoughCoins'))
    return null
  }
  game.coins -= cfg.cost
  game._playStats?.countCoins?.('bankOut', 'crates', cfg.cost)
  return openNow(game, tier)
}

// Inventory's Open: use one you own.
export function spinOwned(game, tier) {
  if (!CRATE_TIERS[tier] || spinning || (game.crateStock[tier] || 0) <= 0) return null
  game.crateStock[tier] -= 1
  return openNow(game, tier)
}

export function closeSpin() {
  spinning?.finish()
  const m = document.getElementById('crate-spin-modal')
  if (m) m.style.display = 'none'
}

function bindModal(game) {
  const E = els()
  if (E.modal.dataset.bound) return
  E.modal.dataset.bound = '1'
  // Click the reel while it moves to skip to the end.
  E.win.addEventListener('click', () => spinning?.finish())
  E.close.addEventListener('click', closeSpin)
  E.again.addEventListener('click', () => {
    if (spinning) return
    if ((game.crateStock[lastTier] || 0) > 0) spinOwned(game, lastTier)
    else buyAndSpin(game, lastTier)
  })
}

// Inventory > Crates' Open buttons.
export function bindInventoryCrates(game) {
  for (const btn of document.querySelectorAll('#inventory-page-crates .crate-open-btn[data-crate-tier]')) {
    btn.addEventListener('click', () => { if (!btn.disabled) spinOwned(game, btn.dataset.crateTier) })
  }
}
