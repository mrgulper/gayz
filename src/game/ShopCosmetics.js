// Shop > Hats, Capes and Back Items (2026-11-25, big shop plan batch 3).
// The Cosmetics.js entries with need.shop === 'buy', one card each, in
// coins or gems (price: [currency, amount]). Click to buy (gems always
// ask first; coins ask on big buys, Settings > Confirm Purchases) and it's
// worn right away. An owned one: click to wear it, click again to take it
// off. Inventory > Cosmetics has the same pickers (CosmeticsUI.js).
import { _escapeHtml, saveSettings } from './Game.js'
import { COSMETICS, COSMETIC_IDS, WORN_SETTING, ownsShopCosmetic, cosmeticName, cosmeticIcon } from './Cosmetics.js'
import { needsBuyConfirm } from './GameplayAssist.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

// Each slot's Shop section and its words.
const SECTIONS = {
  hat: { root: 'shop-hats', heading: 'shop-hats-heading', headingKey: 'shopHatsHeading', color: '#ff5ca8' },
  cape: { root: 'shop-capes', heading: 'shop-capes-heading', headingKey: 'shopCapesHeading', color: '#f2c94c' },
  back: { root: 'shop-backs', heading: 'shop-backs-heading', headingKey: 'shopBacksHeading', color: '#7dff8a' },
}

export const SHOP_COSMETIC_IDS = COSMETIC_IDS.filter((id) => COSMETICS[id].need.shop === 'buy')
const wallet = (game, currency) => (currency === 'gems' ? game.gems : game.coins) || 0

function card(game, id) {
  const c = COSMETICS[id]
  const [currency, price] = c.price
  const have = ownsShopCosmetic(id)
  const wearing = have && game.settings?.[WORN_SETTING[c.slot]] === id
  const classes = ['inv-skin-card', 'shop-effect-card', 'shop-cosmetic-card']
  if (have) classes.push('owned')
  else if (wallet(game, currency) < price) classes.push('cant-afford')
  if (wearing) classes.push('equipped')
  const label = wearing ? t('cosmeticWorn') : have ? t('shopCosmeticOwned') : game._formatSkinPrice(currency, price)
  return `<button type="button" class="${classes.join(' ')}" data-shop-cosmetic="${id}" style="--rarity: ${SECTIONS[c.slot].color}">`
    + `<span class="inv-skin-card-name">${_escapeHtml(cosmeticName(id))}</span>`
    + `<img class="shop-effect-img" src="${cosmeticIcon(id)}" alt="" draggable="false" />`
    + `<span class="inv-skin-card-price">${_escapeHtml(label)}</span>`
    + '</button>'
}

export function renderShopCosmetics(game) {
  for (const [slot, S] of Object.entries(SECTIONS)) {
    const root = document.getElementById(S.root)
    if (!root) continue
    bind(game, root)
    const heading = document.getElementById(S.heading)
    if (heading) heading.textContent = t(S.headingKey)
    root.innerHTML = SHOP_COSMETIC_IDS.filter((id) => COSMETICS[id].slot === slot).map((id) => card(game, id)).join('')
  }
}

function bind(game, root) {
  if (root.dataset.bound) return
  root.dataset.bound = '1'
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shop-cosmetic]')
    if (btn) buyOrWearCosmetic(game, btn.dataset.shopCosmetic)
  })
}

function wear(game, id, on) {
  const key = WORN_SETTING[COSMETICS[id].slot]
  game.settings[key] = on ? id : ''
  saveSettings(game.settings)
}

export function buyOrWearCosmetic(game, id) {
  const c = COSMETICS[id]
  if (!c || c.need.shop !== 'buy') return
  if (ownsShopCosmetic(id)) {
    wear(game, id, game.settings[WORN_SETTING[c.slot]] !== id)
    renderShopCosmetics(game)
    return
  }
  const [currency, price] = c.price
  const have = wallet(game, currency)
  if (have < price) {
    try { audioEngine.playUi?.('error') } catch { /* no audio */ }
    const need = Math.ceil(price - have).toLocaleString()
    game._showHomepageToast(currency === 'gems' ? t('shopMoreSkinsNeedGems', { need }) : t('skinNeedCoins', { need }))
    return
  }
  const name = cosmeticName(id)
  const ask = currency === 'gems' || needsBuyConfirm(game.settings, price)
  if (ask && !window.confirm(t('shopMoreSkinsConfirm', { name, price: game._formatSkinPrice(currency, price) }))) return
  if (currency === 'gems') game.gems -= price
  else {
    game.coins -= price
    game._playStats?.countCoins?.('bankOut', 'cosmetics', price)
  }
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  if (!game.shopCosmetics || typeof game.shopCosmetics !== 'object') game.shopCosmetics = {}
  game.shopCosmetics[id] = 1
  wear(game, id, true)
  game._afterTradeChange() // saves, refreshes the currency bar and Shop
  renderShopCosmetics(game)
  game._showHomepageToast(t('shopCosmeticBoughtToast', { name }))
}
