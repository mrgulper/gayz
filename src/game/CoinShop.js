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
  {
    id: 'gun_flamethrower',
    titleKey: 'weaponFlamethrower',
    cost: 30000,
    section: 'guns',
    gun: 'flamethrower',
  },
  {
    id: 'gun_rocket',
    titleKey: 'weaponRocket',
    cost: 45000,
    section: 'guns',
    gun: 'rocket',
  },
  {
    id: 'gun_crossbow',
    titleKey: 'weaponCrossbow',
    cost: 15000,
    section: 'guns',
    gun: 'crossbow',
  },
  {
    id: 'gun_launcher',
    titleKey: 'weaponLauncher',
    cost: 38000,
    section: 'guns',
    gun: 'launcher',
  },
  {
    id: 'gun_suppressedsmg',
    titleKey: 'weaponSuppressedSmg',
    cost: 22000,
    section: 'guns',
    gun: 'suppressedsmg',
  },
  { id: 'skin_ember', titleKey: 'coinShopEmberSkin', cost: 1500, section: 'skins', skin: 'ember' },
  { id: 'skin_gold', titleKey: 'skinGold', cost: 1200, section: 'skins', skin: 'gold' },
  { id: 'skin_crimson', titleKey: 'skinCrimson', cost: 1200, section: 'skins', skin: 'crimson' },
  { id: 'skin_cobalt', titleKey: 'skinCobalt', cost: 1200, section: 'skins', skin: 'cobalt' },
  { id: 'skin_obsidian', titleKey: 'skinObsidian', cost: 1200, section: 'skins', skin: 'obsidian' },
  // Player outfit colors (see PlayerBody.setOutfit) - same equip-toggle
  // purchase shape as skins above, just tinting the third-person body's
  // jacket instead of a weapon. Third-person-only (no first-person body
  // mesh exists at all - see PlayerBody.js's own doc comment), so this is
  // purely a cosmetic seen in photo mode/by other viewers, same as skins
  // are purely visual on the gun itself.
  { id: 'outfit_crimson', titleKey: 'outfitCrimson', cost: 800, section: 'outfits', outfit: 'crimson', outfitColor: 0x7a2f2f },
  { id: 'outfit_olive', titleKey: 'outfitOlive', cost: 800, section: 'outfits', outfit: 'olive', outfitColor: 0x4a5230 },
  { id: 'outfit_slate', titleKey: 'outfitSlate', cost: 800, section: 'outfits', outfit: 'slate', outfitColor: 0x2e343a },
  { id: 'outfit_desert', titleKey: 'outfitDesert', cost: 800, section: 'outfits', outfit: 'desert', outfitColor: 0xac8a4a },
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
  // Companion speed - unlike the per-run Trader purchases (training/vest/
  // rig, see Game.js's SHOP_ITEMS), this is a one-time Coin Shop buy that
  // permanently speeds up every future run's companion, same persistence
  // model as every other 'perks' entry here.
  {
    id: 'companion_speed',
    titleKey: 'coinShopCompanionSpeed',
    cost: 2500,
    section: 'perks',
    isOwned: (game) => game.coinShopPurchased.has('companion_speed'),
    apply: (game) => {
      game.coinShopPurchased.add('companion_speed')
      game.companion.equipSpeedBoost()
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
  // Akimbo - a permanent pistol-only upgrade (see WeaponSystem.setAkimbo):
  // halves fire interval (twin pistols alternating) in exchange for no
  // scope benefit ever applying to the pistol again, plus a distinct
  // "akimbo" skin so the tradeoff reads as visible, not just a stat change.
  {
    id: 'akimbo',
    titleKey: 'coinShopAkimbo',
    cost: 4000,
    section: 'weapons',
    isOwned: (game) => game.coinShopPurchased.has('akimbo'),
    apply: (game) => {
      game.coinShopPurchased.add('akimbo')
      game.weapons.setAkimbo(true)
    },
  },
  // Base building: a permanent auto-firing turret at the safe zone (see
  // Turret.js) - own 'base' section since it's neither a stat perk nor a
  // gun/skin. apply() builds the actual world object rather than just
  // flipping a flag; Game.js's _applyCoinShopPerks() (mirrors
  // _applyMetaUpgrades' own reasoning) re-calls apply() for every already-
  // owned 'base'/'perks' item on every fresh page load, so the turret gets
  // rebuilt each session exactly like the stat perks get re-applied.
  {
    id: 'turret',
    titleKey: 'coinShopTurret',
    cost: 3000,
    section: 'base',
    isOwned: (game) => game.coinShopPurchased.has('turret'),
    apply: (game) => {
      game.coinShopPurchased.add('turret')
      game._buildAutoTurret()
    },
  },
  // Sandbag perimeter around the safe zone - same 'base' persistence model
  // as the turret above, but its actual effect is a Zones.js density
  // reduction (see Game.js's _buildBaseWalls) rather than a new firing prop.
  {
    id: 'base_walls',
    titleKey: 'coinShopBaseWalls',
    cost: 5000,
    section: 'base',
    isOwned: (game) => game.coinShopPurchased.has('base_walls'),
    apply: (game) => {
      game.coinShopPurchased.add('base_walls')
      game._buildBaseWalls()
    },
  },
]

// Permanent, per-gun attachments (Game.js's Weapons section renders one
// small button per type per owned gun) - distinct from the Trader's in-run
// points-bought scope/extended-mag crafting (see WEAPON_SHOP in Game.js and
// WeaponSystem.attachScope/addMagBonus): these apply once to a specific gun
// and persist across every future run (see shopProgress.attachments and
// WeaponSystem.applyAttachment). Melee is excluded (no ammo/scope/sound to
// attach to).
export const ATTACHMENT_TYPES = [
  { id: 'scope', titleKey: 'attachScope', cost: 3000 },
  { id: 'extmag', titleKey: 'attachExtMag', cost: 2500 },
  { id: 'suppressor', titleKey: 'attachSuppressor', cost: 3500 },
  { id: 'laser', titleKey: 'attachLaser', cost: 2000 },
  { id: 'incendiary', titleKey: 'attachIncendiary', cost: 4000 },
]
