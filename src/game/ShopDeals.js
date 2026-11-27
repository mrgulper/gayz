// Shop > Daily Deals (2026-11-25, big shop plan batch 4; replaced the
// Coming Soon card). 3 things from anywhere in the Shop (ShopCatalog.js),
// each 20-50% off. New deals at midnight Los Angeles time. The day's order
// is the same for every player (seeded by the date); you get the first 3
// you don't own yet, remembered for the day so buying one doesn't swap in
// a new one. Buying puts it on / starts using it, like its own section.
import { _escapeHtml } from './Game.js'
import { shopCatalog, findItem, ownsItem, grantItem, useItem, itemImg, fillSkinImgs } from './ShopCatalog.js'
import { needsBuyConfirm } from './GameplayAssist.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const DEAL_COUNT = 3
export const DEAL_OFFS = [20, 25, 30, 35, 40, 45, 50]
const STORE_KEY = 'gayz-daily-deals'
const ZONE = 'America/Los_Angeles'

// 'YYYY-MM-DD' in Los Angeles. `now` is for tests.
export function dealDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
}

// ms until the next Los Angeles midnight.
export function msToNextDeals(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]))
  const into = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000
  return Math.max(1000, 86400000 - into)
}

function seeded(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1)
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61)
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296
  }
}

// The whole Shop in today's order (same for everyone).
function todaysOrder(day) {
  const rnd = seeded(`deals:${day}`)
  const list = shopCatalog().slice()
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

export const dealOff = (day, key) => DEAL_OFFS[Math.floor(seeded(`off:${day}:${key}`)() * DEAL_OFFS.length)]

export function dealPrice(it, off) {
  const step = it.currency === 'gems' ? 5 : 50
  return Math.max(step, Math.round((it.price * (100 - off)) / 100 / step) * step)
}

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch { return null }
}

// Today's deals: [{ it, off, price }].
export function todaysDeals(game, now = Date.now()) {
  const day = dealDay(now)
  const saved = readSaved()
  let keys = saved?.day === day && Array.isArray(saved.keys) ? saved.keys.filter((k) => findItem(k)) : null
  if (!keys || !keys.length) {
    keys = todaysOrder(day).filter((it) => !ownsItem(game, it)).slice(0, DEAL_COUNT).map((it) => it.key)
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ day, keys })) } catch { /* private mode */ }
  }
  return keys.map((key) => {
    const it = findItem(key)
    const off = dealOff(day, key)
    return { it, off, price: dealPrice(it, off) }
  })
}

const wallet = (game, currency) => (currency === 'gems' ? game.gems : game.coins) || 0

function timeLeftText(now = Date.now()) {
  const mins = Math.ceil(msToNextDeals(now) / 60000)
  return t('dealsNewIn', { h: Math.floor(mins / 60), m: mins % 60 })
}

function card(game, d) {
  const { it, off, price } = d
  const have = ownsItem(game, it)
  const classes = ['inv-skin-card', 'shop-effect-card', 'shop-deal-card']
  if (it.kind === 'skin') classes.push('shop-more-skin-card')
  if (have) classes.push('owned')
  else if (wallet(game, it.currency) < price) classes.push('cant-afford')
  const label = have
    ? _escapeHtml(t('dealBought'))
    : `<s class="market-card-was">${_escapeHtml(game._formatSkinPrice(it.currency, it.price))}</s> ${_escapeHtml(game._formatSkinPrice(it.currency, price))}`
  return `<button type="button" class="${classes.join(' ')}" data-deal="${it.key}" style="--rarity: ${it.color}">`
    + `<span class="shop-bundle-off">${_escapeHtml(t('bundleOff', { n: off }))}</span>`
    + `<span class="inv-skin-card-name">${_escapeHtml(it.name())}</span>`
    + itemImg(it)
    + `<span class="inv-skin-card-price">${label}</span>`
    + '</button>'
}

export function renderDailyDeals(game) {
  const root = document.getElementById('shop-deals')
  if (!root) return
  bind(game, root)
  const heading = document.getElementById('shop-deals-heading')
  if (heading) heading.textContent = t('dealsHeading')
  const timer = document.getElementById('shop-deals-timer')
  if (timer) timer.textContent = timeLeftText()
  root.innerHTML = todaysDeals(game).map((d) => card(game, d)).join('')
  fillSkinImgs(root)
  startTimer(game)
}

// Keeps "New deals in 3h 12m" ticking while the Shop is open, and swaps
// in the new deals at midnight.
let tick = null
function startTimer(game) {
  if (tick) return
  let day = dealDay()
  tick = setInterval(() => {
    const timer = document.getElementById('shop-deals-timer')
    if (!timer || !game.shopPanel || game.shopPanel.style.display === 'none') {
      clearInterval(tick)
      tick = null
      return
    }
    if (dealDay() !== day) {
      day = dealDay()
      renderDailyDeals(game)
    } else timer.textContent = timeLeftText()
  }, 30000)
}

function bind(game, root) {
  if (root.dataset.bound) return
  root.dataset.bound = '1'
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-deal]')
    if (btn) buyDeal(game, btn.dataset.deal)
  })
}

export async function buyDeal(game, key) {
  const d = todaysDeals(game).find((x) => x.it.key === key)
  if (!d) return
  const { it, price } = d
  if (ownsItem(game, it)) {
    await useItem(game, it)
    game._renderShopSkinState?.()
    return
  }
  const have = wallet(game, it.currency)
  if (have < price) {
    try { audioEngine.playUi?.('error') } catch { /* no audio */ }
    const need = Math.ceil(price - have).toLocaleString()
    game._showHomepageToast(it.currency === 'gems' ? t('shopMoreSkinsNeedGems', { need }) : t('skinNeedCoins', { need }))
    return
  }
  const name = it.name()
  const ask = it.currency === 'gems' || needsBuyConfirm(game.settings, price)
  if (ask && !window.confirm(t('shopMoreSkinsConfirm', { name, price: game._formatSkinPrice(it.currency, price) }))) return
  if (it.currency === 'gems') game.gems -= price
  else {
    game.coins -= price
    game._playStats?.countCoins?.('bankOut', 'deals', price)
  }
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  grantItem(game, it)
  await useItem(game, it)
  game._afterTradeChange() // saves, refreshes the currency bar and the whole Shop
  game._showHomepageToast(t('dealBoughtToast', { name }))
}
