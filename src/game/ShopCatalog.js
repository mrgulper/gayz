// Everything the Shop sells one at a time, as one list (2026-11-25, big
// shop plan batch 4). Daily Deals (ShopDeals.js) and Crate Spin
// (CrateSpin.js) both pick from it. Each item:
//   { key, kind, id, name, color, currency, price, icon(), skinUrl }
// kind 'skin' = More Skins (owned in charSkins), 'cosmetic' = hats, capes,
// back items (shopCosmetics), 'effect' = kill effects, walk trails, gun
// skins (shopCosmetics). Bundle-only hats/capes are left out.
import { SKIN_RARITIES, INVENTORY_SKINS, saveSettings, skinFrontIconURL } from './Game.js'
import { SHOP_SKINS } from './ShopSkins.js'
import { shopSkinCost } from './ShopSkinPrices.js'
import { COSMETICS, WORN_SETTING, cosmeticName, cosmeticIcon } from './Cosmetics.js'
import { SHOP_COSMETIC_IDS } from './ShopCosmetics.js'
import { EFFECT_KINDS } from './ShopEffects.js'

// What 1 gem is worth in coins, to compare prices across the two (a guess:
// GaygarX's 500 gems sits near the 50k-coin items).
export const GEM_IN_COINS = 100

let cache = null
export function shopCatalog() {
  if (cache) return cache
  const items = []
  for (const s of SHOP_SKINS) {
    const cost = shopSkinCost(s)
    items.push({
      key: `skin:${s.id}`, kind: 'skin', id: s.id, name: () => s.name,
      color: (SKIN_RARITIES[s.rarity] || SKIN_RARITIES.common).color,
      currency: cost.currency, price: cost.amount, skinUrl: s.dataUrl, icon: () => '',
    })
  }
  const slotColor = { hat: '#ff5ca8', cape: '#f2c94c', back: '#7dff8a' }
  for (const id of SHOP_COSMETIC_IDS) {
    const c = COSMETICS[id]
    items.push({
      key: `cosmetic:${id}`, kind: 'cosmetic', id, name: () => cosmeticName(id),
      color: slotColor[c.slot] || '#ccc', currency: c.price[0], price: c.price[1], icon: () => cosmeticIcon(id),
    })
  }
  for (const K of Object.values(EFFECT_KINDS)) {
    for (const id of K.ids) {
      items.push({
        key: `effect:${id}`, kind: 'effect', id, name: () => K.name(id),
        color: K.color, currency: 'coins', price: K.items[id].price, icon: () => K.icon(id),
      })
    }
  }
  cache = items
  return items
}

export const findItem = (key) => shopCatalog().find((it) => it.key === key) || null
// Price in coins, so gem items can be compared with coin ones.
export const coinValue = (it) => (it.currency === 'gems' ? it.price * GEM_IN_COINS : it.price)

export function ownsItem(game, it) {
  const bag = it.kind === 'skin' ? game.charSkins : game.shopCosmetics
  return (Number(bag?.[it.id]) || 0) > 0
}

// Adds it to what you own (no money changes hands here). The caller saves.
export function grantItem(game, it) {
  if (it.kind === 'skin') {
    game._addSkinToInventory(it.id)
    return
  }
  if (!game.shopCosmetics || typeof game.shopCosmetics !== 'object') game.shopCosmetics = {}
  game.shopCosmetics[it.id] = 1
}

// Puts it on / starts using it, like buying it from its own Shop section.
export async function useItem(game, it) {
  if (it.kind === 'skin') {
    if (INVENTORY_SKINS.some((s) => s.id === it.id)) await game._equipInventorySkin(it.id)
    return
  }
  if (it.kind === 'cosmetic') game.settings[WORN_SETTING[COSMETICS[it.id].slot]] = it.id
  else {
    const K = Object.values(EFFECT_KINDS).find((k) => k.items[it.id])
    if (K) game.settings[K.setting] = it.id
  }
  saveSettings(game.settings)
}

// Fills an <img> with the item's picture (skins are drawn later).
export function itemImg(it, cls = '') {
  const c = it.kind === 'skin' ? 'inv-skin-card-img' : 'shop-effect-img'
  return `<img class="${c}${cls ? ` ${cls}` : ''}" data-item-img="${it.key}" alt="" draggable="false"${it.kind === 'skin' ? '' : ` src="${it.icon()}"`} />`
}
export function fillSkinImgs(root) {
  for (const img of root.querySelectorAll('img[data-item-img^="skin:"]')) {
    const it = findItem(img.dataset.itemImg)
    if (it) skinFrontIconURL(it.skinUrl).then((url) => { if (url) img.src = url })
  }
}
