// Shop items - bought with coins (see Game.js's _onZombieKilled), a
// currency separate from points that every kill guarantees some of, unlike
// points' 25%-chance drop.
//
// Every item has a `section` ('guns' | 'skins' | 'perks') so Game.js's
// _renderCoinShopOptions can group them under their own headers instead of
// one flat list, plus one of three purchase shapes:
// - Guns (the `gun` field set): a one-time unlock via WeaponSystem's own
//   `unlocked` flag on that weapon - owned check reads it directly rather
//   than duplicating a second "do I own this" set.
// - Skins (the `skin` field set): equip-toggle rather than one-time-owned -
//   buying one equips it immediately, and once owned it can be re-equipped
//   for free any time. Used to be a separate Skins panel/currency (in-run
//   points); folded in here so every cosmetic lives in one shop.
// - Stat perks (the `isOwned`/`apply` pair): a permanent one-time purchase
//   tracked in game.coinShopPurchased.
export const COIN_SHOP_ITEMS = [
  {
    id: 'gun_shotgun',
    titleKey: 'weaponShotgun',
    cost: 25000,
    section: 'guns',
    gun: 'shotgun',
  },
  {
    id: 'gun_glock18',
    titleKey: 'weaponGlock18',
    cost: 20000,
    section: 'guns',
    gun: 'glock18',
  },
  {
    id: 'gun_awp',
    titleKey: 'weaponAwp',
    cost: 35000,
    section: 'guns',
    gun: 'awp',
  },
  {
    id: 'gun_minigun',
    titleKey: 'weaponMinigun',
    cost: 50000,
    section: 'guns',
    gun: 'minigun',
    onUnlock: (game) => game.achievements.unlock('minigun_unlocked'),
  },
  { id: 'skin_ember', titleKey: 'coinShopEmberSkin', cost: 1500, section: 'skins', skin: 'ember' },
  { id: 'skin_gold', titleKey: 'skinGold', cost: 1200, section: 'skins', skin: 'gold' },
  { id: 'skin_crimson', titleKey: 'skinCrimson', cost: 1200, section: 'skins', skin: 'crimson' },
  { id: 'skin_cobalt', titleKey: 'skinCobalt', cost: 1200, section: 'skins', skin: 'cobalt' },
  { id: 'skin_obsidian', titleKey: 'skinObsidian', cost: 1200, section: 'skins', skin: 'obsidian' },
  {
    id: 'coin_damage',
    titleKey: 'coinShopDamage',
    cost: 2000,
    section: 'perks',
    isOwned: (game) => game.coinShopPurchased.has('coin_damage'),
    apply: (game) => {
      game.coinShopPurchased.add('coin_damage')
      game.weapons.damageMult += 0.1
    },
  },
  {
    id: 'coin_health',
    titleKey: 'coinShopHealth',
    cost: 1500,
    section: 'perks',
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
    cost: 1000,
    section: 'perks',
    isOwned: (game) => game.coinShopPurchased.has('coin_stamina'),
    apply: (game) => {
      game.coinShopPurchased.add('coin_stamina')
      game.player.maxStamina += 25
      game.player.stamina = game.player.maxStamina
    },
  },
]
