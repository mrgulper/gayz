// Shop items - bought with coins (see Game.js's _onZombieKilled), a
// currency separate from points that every kill guarantees some of, unlike
// points' 25%-chance drop.
//
// Every weapon unlocks by default now (see WeaponSystem.js) and is picked
// per-run from the Play-button weapon picker instead of bought here - guns
// are no longer a purchasable item shape in this list.
//
// Purely cosmetic now (outfits + hats) - equip-toggle purchase shape:
// buying one equips it immediately, and once owned it can be re-equipped
// for free any time. Weapon skins were removed outright (not moved) and
// every non-cosmetic item that used to live here (perks/base/legacy/
// weapons-upgrade sections) moved to the Upgrades panel, priced in Legacy
// Points instead of Coins - see MetaProgress.js's META_UPGRADES, same ids,
// same apply() effects, just re-priced onto that panel's existing cost
// scale rather than kept in Coins.
export const COIN_SHOP_ITEMS = [
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
  { id: 'outfit_obsidian', titleKey: 'outfitObsidian', cost: 900, section: 'outfits', outfit: 'obsidian', outfitColor: 0x18181a },
  { id: 'outfit_arctic', titleKey: 'outfitArctic', cost: 900, section: 'outfits', outfit: 'arctic', outfitColor: 0xd8dce0 },
  { id: 'outfit_ember', titleKey: 'outfitEmber', cost: 900, section: 'outfits', outfit: 'ember', outfitColor: 0xb8541a },
  // Cosmetic hats (see PlayerBody.setHat) - same equip-toggle purchase
  // shape as outfits above, bone-parented to the GLB's Head bone instead of
  // tinting an existing material slot.
  { id: 'hat_cap', titleKey: 'hatCap', cost: 600, section: 'hats', hat: 'cap', hatColor: 0x2a2f3a },
  { id: 'hat_beanie', titleKey: 'hatBeanie', cost: 600, section: 'hats', hat: 'beanie', hatColor: 0x7a2f2f },
  { id: 'hat_helmet', titleKey: 'hatHelmet', cost: 1000, section: 'hats', hat: 'helmet', hatColor: 0x4a4842 },
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
  { id: 'ricochet', titleKey: 'attachRicochet', cost: 4500 },
  { id: 'armorpierce', titleKey: 'attachArmorPierce', cost: 4000 },
  { id: 'precision', titleKey: 'attachPrecision', cost: 3500 },
  // Electric Rounds - chain-stuns the nearest other zombie in range instead
  // of dealing bounce damage, distinct utility from Ricochet's damage-spread.
  { id: 'electric', titleKey: 'attachElectric', cost: 4000 },
  // Acid Rounds - a damage-taken debuff (see Zombie.corrode) rather than a
  // damage-over-time tick, distinct from Incendiary's burn.
  { id: 'acid', titleKey: 'attachAcid', cost: 4000 },
  // Cryo Rounds (batch 10 feature) - a full immobilize (see Zombie.freeze),
  // distinct from Electric's chain-stun (hits a NEIGHBOR, not the target)
  // and from every damage-modifying attachment above - pure crowd control.
  { id: 'cryo', titleKey: 'attachCryo', cost: 4000 },
]
