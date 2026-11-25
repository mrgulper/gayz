// What a Shop > More Skins skin costs (2026-11-25, Gaymi picked "mix by
// rarity"): Common, Uncommon and Rare cost coins (the Market's own
// MARKET_PRICES), Epic and up cost gems. Gem prices are a guess to start
// with, set next to GaygarX (Legendary, 500 gems).
import { MARKET_PRICES } from './MarketSkins.js'

export const SHOP_SKIN_GEM_PRICES = { epic: 250, legendary: 500, mythic: 1000 }

export function shopSkinCost(skin) {
  const gems = SHOP_SKIN_GEM_PRICES[skin?.rarity]
  if (gems) return { currency: 'gems', amount: gems }
  return { currency: 'coins', amount: MARKET_PRICES[skin?.rarity] || MARKET_PRICES.common }
}
