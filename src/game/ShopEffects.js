// Shop > Kill Effects (2026-11-25, shop plan batch 4, KillEffects.js).
// One card each: click to buy (coins; Settings > Confirm Purchases asks
// first on big buys) and it's used right away. An owned one: click to use
// it, click again to stop. Inventory > Hats & Capes has the same picker.
import { _escapeHtml, saveSettings } from './Game.js'
import { ownsShopCosmetic } from './Cosmetics.js'
import { KILL_EFFECTS, KILL_EFFECT_IDS, killEffectName, killEffectIcon } from './KillEffects.js'
import { needsBuyConfirm } from './GameplayAssist.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

function card(game, id) {
  const price = KILL_EFFECTS[id].price
  const have = ownsShopCosmetic(id)
  const using = have && game.settings?.killEffect === id
  const classes = ['inv-skin-card', 'shop-effect-card']
  if (have) classes.push('owned')
  else if ((game.coins || 0) < price) classes.push('cant-afford')
  if (using) classes.push('equipped')
  const label = using ? t('killFxUsing') : have ? t('killFxOwned') : game._formatSkinPrice('coins', price)
  return `<button type="button" class="${classes.join(' ')}" data-kill-effect="${id}" style="--rarity: #a98bff">`
    + `<span class="inv-skin-card-name">${_escapeHtml(killEffectName(id))}</span>`
    + `<img class="shop-effect-img" src="${killEffectIcon(id)}" alt="" draggable="false" />`
    + `<span class="inv-skin-card-price">${_escapeHtml(label)}</span>`
    + '</button>'
}

export function renderShopEffects(game) {
  const root = document.getElementById('shop-effects')
  if (!root) return
  bind(game, root)
  const heading = document.getElementById('shop-effects-heading')
  if (heading) heading.textContent = t('killFxHeading')
  root.innerHTML = KILL_EFFECT_IDS.map((id) => card(game, id)).join('')
}

function bind(game, root) {
  if (root.dataset.bound) return
  root.dataset.bound = '1'
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kill-effect]')
    if (btn) buyOrUseKillEffect(game, btn.dataset.killEffect)
  })
}

// Use (or stop using) an owned one.
export function toggleKillEffect(game, id) {
  game.settings.killEffect = game.settings.killEffect === id ? '' : id
  saveSettings(game.settings)
}

export function buyOrUseKillEffect(game, id) {
  if (!KILL_EFFECTS[id]) return
  if (ownsShopCosmetic(id)) {
    toggleKillEffect(game, id)
    renderShopEffects(game)
    return
  }
  const price = KILL_EFFECTS[id].price
  const have = game.coins || 0
  if (have < price) {
    try { audioEngine.playUi?.('error') } catch { /* no audio */ }
    game._showHomepageToast(t('skinNeedCoins', { need: Math.ceil(price - have).toLocaleString() }))
    return
  }
  const name = killEffectName(id)
  if (needsBuyConfirm(game.settings, price) && !window.confirm(t('shopMoreSkinsConfirm', { name, price: game._formatSkinPrice('coins', price) }))) return
  game.coins -= price
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  if (!game.shopCosmetics || typeof game.shopCosmetics !== 'object') game.shopCosmetics = {}
  game.shopCosmetics[id] = 1
  game.settings.killEffect = id
  saveSettings(game.settings)
  game._afterTradeChange() // saves, refreshes the currency bar and Shop
  renderShopEffects(game)
  game._showHomepageToast(t('killFxBoughtToast', { name }))
}
