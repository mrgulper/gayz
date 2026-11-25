// Shop > Bundles (2026-11-25, shop plan batch 3; Gaymi picked 3 bundles,
// 30% off). Each bundle = one More Skins skin + a hat + a cape that only a
// bundle sells (Cosmetics.js, need.shop). Price = 30% off the parts you
// don't own yet, in the skin's own currency (coins or gems). Buying adds
// the skin to Inventory > Character, the hat and cape to game.shopCosmetics
// (shop save), and puts all three on. An owned bundle: click to wear it.
// Prices (Gaymi 2026-11-25: "way higher", coins 10k-50k, Dragon stays in
// gems): `price` is what the whole bundle costs; it's shown as 30% off a
// "worth" of price / 0.7. Already own the skin? Its own Shop price comes
// off that worth, and you pay 30% off what's left.
import { INVENTORY_SKINS, SKIN_RARITIES, _escapeHtml, skinFrontIconURL, saveSettings } from './Game.js'
import { SHOP_SKINS } from './ShopSkins.js'
import { shopSkinCost } from './ShopSkinPrices.js'
import { cosmeticIcon, cosmeticName } from './Cosmetics.js'
import { needsBuyConfirm } from './GameplayAssist.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const BUNDLE_DISCOUNT = 0.3
// price is in the skin's own currency (coins, or gems for the Dragon).
export const BUNDLES = [
  { id: 'winter', key: 'bundleWinter', skin: 'snowman', hat: 'santaHat', cape: 'snowCape', price: 10000 },
  { id: 'survivor', key: 'bundleSurvivor', skin: 'firefighter', hat: 'fireHelmet', cape: 'safetyCape', price: 25000 },
  { id: 'creatures', key: 'bundleCreatures', skin: 'dragon', hat: 'dragonHorns', cape: 'dragonCape', price: 1000 },
]

const skinOf = (b) => SHOP_SKINS.find((s) => s.id === b.skin)
const ownsSkin = (game, id) => (Number(game.charSkins?.[id]) || 0) > 0
const ownsPart = (game, id) => (Number(game.shopCosmetics?.[id]) || 0) > 0
const wallet = (game, currency) => (currency === 'gems' ? game.gems : game.coins) || 0
const roundTo = (n, step) => Math.max(step, Math.round(n / step) * step)

// { currency, full, amount }: full = what the parts you don't own yet are
// worth; amount = what you'd pay now (30% off that; 0 = all owned).
export function bundleCost(game, b) {
  const skinCost = shopSkinCost(skinOf(b))
  const currency = skinCost.currency
  const step = currency === 'gems' ? 5 : 50
  const worth = roundTo(b.price / (1 - BUNDLE_DISCOUNT), step)
  const skinWorth = Math.min(skinCost.amount, worth)
  let missing = 0
  if (!ownsSkin(game, b.skin)) missing += skinWorth
  if (!ownsPart(game, b.hat) || !ownsPart(game, b.cape)) missing += worth - skinWorth
  if (!missing) return { currency, full: 0, amount: 0 }
  const amount = missing === worth ? b.price : roundTo(missing * (1 - BUNDLE_DISCOUNT), step)
  return { currency, full: missing, amount }
}

function card(game, b) {
  const skin = skinOf(b)
  const rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
  const cost = bundleCost(game, b)
  const owned = cost.amount === 0
  const wearing = owned && game._equippedInventorySkinId?.() === b.skin
    && game.settings?.cosmeticHat === b.hat && game.settings?.cosmeticCape === b.cape
  const classes = ['inv-skin-card', 'shop-bundle-card']
  if (owned) classes.push('owned')
  else if (wallet(game, cost.currency) < cost.amount) classes.push('cant-afford')
  if (wearing) classes.push('equipped')
  const parts = [
    `<span class="shop-bundle-part"><img data-bundle-skin alt="" draggable="false" /><span>${_escapeHtml(skin.name)}</span></span>`,
    `<span class="shop-bundle-part"><img src="${cosmeticIcon(b.hat)}" alt="" draggable="false" /><span>${_escapeHtml(cosmeticName(b.hat))}</span></span>`,
    `<span class="shop-bundle-part"><img src="${cosmeticIcon(b.cape)}" alt="" draggable="false" /><span>${_escapeHtml(cosmeticName(b.cape))}</span></span>`,
  ].join('')
  const price = owned
    ? _escapeHtml(wearing ? t('shopMoreSkinsWearing') : t('bundleOwned'))
    : `<s class="market-card-was">${_escapeHtml(game._formatSkinPrice(cost.currency, cost.full))}</s> `
      + _escapeHtml(game._formatSkinPrice(cost.currency, cost.amount))
  return `<button type="button" class="${classes.join(' ')}" data-bundle="${b.id}" style="--rarity: ${rarity.color}">`
    + `<span class="shop-bundle-off">${_escapeHtml(t('bundleOff', { n: Math.round(BUNDLE_DISCOUNT * 100) }))}</span>`
    + `<span class="inv-skin-card-name">${_escapeHtml(t(b.key))}</span>`
    + `<span class="shop-bundle-parts">${parts}</span>`
    + `<span class="inv-skin-card-price">${price}</span>`
    + '</button>'
}

export function renderBundles(game) {
  const root = document.getElementById('shop-bundles')
  if (!root) return
  bind(game, root)
  const heading = document.getElementById('shop-bundles-heading')
  if (heading) heading.textContent = t('bundlesHeading')
  root.innerHTML = BUNDLES.map((b) => card(game, b)).join('')
  for (const b of BUNDLES) {
    skinFrontIconURL(skinOf(b).dataUrl).then((url) => {
      const img = root.querySelector(`[data-bundle="${b.id}"] [data-bundle-skin]`)
      if (img && url) img.src = url
    })
  }
}

function bind(game, root) {
  if (root.dataset.bound) return
  root.dataset.bound = '1'
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bundle]')
    if (btn) buyOrWearBundle(game, btn.dataset.bundle)
  })
}

async function wear(game, b) {
  if (INVENTORY_SKINS.some((s) => s.id === b.skin)) await game._equipInventorySkin(b.skin)
  game.settings.cosmeticHat = b.hat
  game.settings.cosmeticCape = b.cape
  saveSettings(game.settings)
}

export async function buyOrWearBundle(game, id) {
  const b = BUNDLES.find((x) => x.id === id)
  if (!b) return
  const cost = bundleCost(game, b)
  if (cost.amount === 0) {
    await wear(game, b)
    renderBundles(game)
    return
  }
  const have = wallet(game, cost.currency)
  if (have < cost.amount) {
    try { audioEngine.playUi?.('error') } catch { /* no audio */ }
    const need = Math.ceil(cost.amount - have).toLocaleString()
    game._showHomepageToast(cost.currency === 'gems' ? t('shopMoreSkinsNeedGems', { need }) : t('skinNeedCoins', { need }))
    return
  }
  const name = t(b.key)
  const ask = cost.currency === 'gems' || needsBuyConfirm(game.settings, cost.amount)
  if (ask && !window.confirm(t('shopMoreSkinsConfirm', { name, price: game._formatSkinPrice(cost.currency, cost.amount) }))) return
  if (cost.currency === 'gems') game.gems -= cost.amount
  else game.coins -= cost.amount
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  if (!game.shopCosmetics || typeof game.shopCosmetics !== 'object') game.shopCosmetics = {}
  if (!ownsSkin(game, b.skin)) game._addSkinToInventory(b.skin)
  for (const part of [b.hat, b.cape]) if (!ownsPart(game, part)) game.shopCosmetics[part] = 1
  game._afterTradeChange() // saves, refreshes the currency bar, Shop and Inventory
  await wear(game, b)
  renderBundles(game)
  game._showHomepageToast(t('bundleBoughtToast', { name }))
}
