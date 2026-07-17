// Coin Shop items - bought with coins (see Game.js's _onZombieKilled), a
// currency separate from points that every kill guarantees some of, unlike
// points' 25%-chance drop.
//
// Two shapes of item:
// - Skins (the `skin` field set): equip-toggle rather than one-time-owned -
//   buying one equips it immediately, and once owned it can be re-equipped
//   for free any time (see Game.js's _renderCoinShopOptions). Used to be a
//   separate Skins panel/currency (in-run points); folded in here so every
//   cosmetic lives in one shop, all priced in coins.
// - Stat perks (the `isOwned`/`apply` pair): a permanent one-time purchase
//   tracked in game.coinShopPurchased.
export const COIN_SHOP_ITEMS = [
  { id: 'skin_ember', titleKey: 'coinShopEmberSkin', cost: 150, skin: 'ember' },
  { id: 'skin_gold', titleKey: 'skinGold', cost: 120, skin: 'gold' },
  { id: 'skin_crimson', titleKey: 'skinCrimson', cost: 120, skin: 'crimson' },
  { id: 'skin_cobalt', titleKey: 'skinCobalt', cost: 120, skin: 'cobalt' },
  { id: 'skin_obsidian', titleKey: 'skinObsidian', cost: 120, skin: 'obsidian' },
  {
    id: 'coin_damage',
    titleKey: 'coinShopDamage',
    cost: 200,
    isOwned: (game) => game.coinShopPurchased.has('coin_damage'),
    apply: (game) => {
      game.coinShopPurchased.add('coin_damage')
      game.weapons.damageMult += 0.1
    },
  },
  {
    id: 'coin_health',
    titleKey: 'coinShopHealth',
    cost: 150,
    isOwned: (game) => game.coinShopPurchased.has('coin_health'),
    apply: (game) => {
      game.coinShopPurchased.add('coin_health')
      game.playerState.maxHealth += 25
      game.playerState.heal(25)
      game._updateHealthHud()
    },
  },
  {
    id: 'coin_stamina',
    titleKey: 'coinShopStamina',
    cost: 100,
    isOwned: (game) => game.coinShopPurchased.has('coin_stamina'),
    apply: (game) => {
      game.coinShopPurchased.add('coin_stamina')
      game.player.maxStamina += 25
      game.player.stamina = game.player.maxStamina
    },
  },
]
