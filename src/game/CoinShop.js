// Coin Shop items - bought with coins (see Game.js's _onZombieKilled),
// a currency separate from scrap that every kill guarantees some of,
// unlike scrap's 25%-chance drop. Each item tracks its own "already
// owned" check since the skin uses the shared ownedSkins state while the
// stat perks use their own one-time-purchase set.
export const COIN_SHOP_ITEMS = [
  {
    id: 'ember_skin',
    titleKey: 'coinShopEmberSkin',
    cost: 150,
    isOwned: (game) => game.ownedSkins.has('ember'),
    apply: (game) => {
      game.ownedSkins.add('ember')
      game.equippedSkin = 'ember'
      game.weapons.setWeaponSkin('pistol', 'ember')
    },
  },
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
