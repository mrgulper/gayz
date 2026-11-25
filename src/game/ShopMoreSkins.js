// Shop > More Skins (2026-11-25, Gaymi: "design more skins"). Replaced the
// "More Skins" Coming Soon card. Three sets (Winter, Survivor Jobs,
// Creatures) of four skins each, drawn by scripts/make-shop-skins.mjs
// (ShopSkins.js). Click a card to buy it (coins for Common-Rare, gems for
// Epic and up - ShopSkinPrices.js); it goes into Inventory > Character
// like a Market skin (charSkins) and you wear it right away. Click an
// owned one to wear it again.
import { INVENTORY_SKINS, SKIN_RARITIES, _escapeHtml, skinFrontIconURL } from './Game.js'
import { SHOP_SKINS } from './ShopSkins.js'
import { shopSkinCost } from './ShopSkinPrices.js'
import { needsBuyConfirm } from './GameplayAssist.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

const SETS = [
  { id: 'winter', key: 'shopSkinSetWinter' },
  { id: 'survivor', key: 'shopSkinSetSurvivor' },
  { id: 'creatures', key: 'shopSkinSetCreatures' },
  // Second wave (2026-11-25, Gaymi: "way more skins"): 8 more sets of 4.
  { id: 'pirates', key: 'shopSkinSetPirates' },
  { id: 'space', key: 'shopSkinSetSpace' },
  { id: 'food', key: 'shopSkinSetFood' },
  { id: 'sports', key: 'shopSkinSetSports' },
  { id: 'royalty', key: 'shopSkinSetRoyalty' },
  { id: 'ninja', key: 'shopSkinSetNinja' },
  { id: 'robots', key: 'shopSkinSetRobots' },
  { id: 'spooky', key: 'shopSkinSetSpooky' },
]

// Which set the filter buttons show ('all' = every set). Not saved: the
// Shop opens on All each time.
let shownSet = 'all'

const owned = (game, id) => Math.max(0, Math.floor(Number(game.charSkins?.[id]) || 0))
const wallet = (game, currency) => (currency === 'gems' ? game.gems : game.coins) || 0

function card(game, skin, wearing) {
  const rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
  const cost = shopSkinCost(skin)
  const have = owned(game, skin.id) > 0
  const classes = ['inv-skin-card', 'shop-more-skin-card']
  if (have) classes.push('owned')
  else if (wallet(game, cost.currency) < cost.amount) classes.push('cant-afford')
  if (wearing === skin.id) classes.push('equipped')
  const label = wearing === skin.id ? t('shopMoreSkinsWearing') : have ? t('shopMoreSkinsOwned') : game._formatSkinPrice(cost.currency, cost.amount)
  return `<button type="button" class="${classes.join(' ')}" data-shop-skin="${skin.id}" style="--rarity: ${rarity.color}" title="${_escapeHtml(`${skin.name} - ${t(rarity.key)}`)}">`
    + `<span class="inv-skin-card-name">${_escapeHtml(skin.name)}</span>`
    + '<img class="inv-skin-card-img" alt="" draggable="false" />'
    + `<span class="inv-skin-card-price">${_escapeHtml(label)}</span>`
    + '</button>'
}

export function renderMoreSkins(game) {
  const root = document.getElementById('shop-more-skins')
  if (!root) return
  bind(game, root)
  const heading = document.getElementById('shop-more-skins-heading')
  if (heading) heading.textContent = t('shopMoreSkinsHeading')
  const wearing = game._equippedInventorySkinId?.()
  const chip = (id, label) => `<button type="button" class="shop-skin-set-chip${shownSet === id ? ' active' : ''}" data-skin-set="${id}">${_escapeHtml(label)}</button>`
  const chips = `<div class="shop-skin-set-chips">${chip('all', t('shopSkinSetAll'))}${SETS.map((set) => chip(set.id, t(set.key))).join('')}</div>`
  root.innerHTML = chips + SETS.filter((set) => shownSet === 'all' || shownSet === set.id).map((set) => {
    const skins = SHOP_SKINS.filter((s) => s.set === set.id)
    return `<h4 class="shop-more-skins-set">${_escapeHtml(t(set.key))}</h4>`
      + `<div class="shop-more-skins-grid">${skins.map((s) => card(game, s, wearing)).join('')}</div>`
  }).join('')
  for (const skin of SHOP_SKINS) {
    if (!root.querySelector(`[data-shop-skin="${skin.id}"]`)) continue
    skinFrontIconURL(skin.dataUrl).then((url) => {
      const img = root.querySelector(`[data-shop-skin="${skin.id}"] .inv-skin-card-img`)
      if (img && url) img.src = url
    })
  }
}

function bind(game, root) {
  if (root.dataset.bound) return
  root.dataset.bound = '1'
  root.addEventListener('click', (e) => {
    const setBtn = e.target.closest('[data-skin-set]')
    if (setBtn) {
      shownSet = setBtn.dataset.skinSet
      renderMoreSkins(game)
      return
    }
    const btn = e.target.closest('[data-shop-skin]')
    if (btn) buyOrWear(game, btn.dataset.shopSkin)
  })
}

export async function buyOrWear(game, id) {
  const skin = SHOP_SKINS.find((s) => s.id === id)
  if (!skin) return
  if (owned(game, id) > 0) {
    await game._equipInventorySkin(id)
    renderMoreSkins(game)
    return
  }
  const cost = shopSkinCost(skin)
  const have = wallet(game, cost.currency)
  if (have < cost.amount) {
    try { audioEngine.playUi?.('error') } catch { /* no audio */ }
    const need = Math.ceil(cost.amount - have).toLocaleString()
    game._showHomepageToast(cost.currency === 'gems' ? t('shopMoreSkinsNeedGems', { need }) : t('skinNeedCoins', { need }))
    return
  }
  // Gems are rarer, so always ask; coins follow Settings > Confirm Purchases.
  const ask = cost.currency === 'gems' || needsBuyConfirm(game.settings, cost.amount)
  if (ask && !window.confirm(t('shopMoreSkinsConfirm', { name: skin.name, price: game._formatSkinPrice(cost.currency, cost.amount) }))) return
  if (cost.currency === 'gems') game.gems -= cost.amount
  else game.coins -= cost.amount
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  game._addSkinToInventory(id)
  game._afterTradeChange() // saves, refreshes the currency bar and Inventory
  if (INVENTORY_SKINS.some((s) => s.id === id)) await game._equipInventorySkin(id)
  renderMoreSkins(game)
  game._showHomepageToast(t('skinBoughtToast', { name: skin.name }))
}
