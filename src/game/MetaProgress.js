// Permanent, cross-run progression: a fraction of each run's points converts
// to "Legacy Points" on death (see Game.js's _onPlayerDeath), spent here on
// one-time permanent upgrades applied at the start of every future run.
const STORAGE_KEY = 'gayz-meta-progress'
export const DEATH_POINTS_CONVERSION = 0.2

// Three branching chains (Survival, Utility, Combat) plus several
// standalone always-available picks - `requires` names another upgrade's id
// that must already be purchased before this one is buyable, so the tree
// reads as root -> tier2 -> capstone rather than a flat pick-anything list.
// See Game.js's _renderUpgradesOptions for how a missing requirement gets
// shown (locked, with the prerequisite's name) rather than just disabled.
export const META_UPGRADES = [
  {
    id: 'vitality',
    titleKey: 'metaVitality',
    cost: 400,
    apply: (game) => {
      game.playerState.maxHealth += 50
      game.playerState.health += 50
    },
  },
  {
    id: 'plating',
    titleKey: 'metaPlating',
    cost: 350,
    apply: (game) => {
      game.playerState.maxArmor += 25
    },
  },
  {
    id: 'provisions',
    titleKey: 'metaProvisions',
    cost: 300,
    apply: (game) => {
      game.inventory.addHealthPack(1)
      game.inventory.addArmorPack(1)
    },
  },
  {
    id: 'arsenal',
    titleKey: 'metaArsenal',
    cost: 300,
    apply: (game) => {
      game.inventory.addGrenade(1)
      game.inventory.addNoisemaker(1)
    },
  },
  {
    id: 'veteran',
    titleKey: 'metaVeteran',
    cost: 250,
    apply: (game) => {
      game.points += 20
    },
  },
  {
    id: 'endurance',
    titleKey: 'metaEndurance',
    cost: 300,
    apply: (game) => {
      game.player.maxStamina += 25
      game.player.stamina = game.player.maxStamina
    },
  },
  // Combat branch: marksman (root) -> deadeye (capstone).
  {
    id: 'marksman',
    titleKey: 'metaMarksman',
    cost: 450,
    apply: (game) => {
      game.weapons.damageMult += 0.1
    },
  },
  {
    id: 'deadeye',
    titleKey: 'metaDeadeye',
    cost: 550,
    requires: 'marksman',
    apply: (game) => {
      game.weapons.damageMult += 0.15
    },
  },
  // Utility branch: quickhands (root) -> stockpile (tier 2) -> masterscavenger (capstone).
  {
    id: 'quickhands',
    titleKey: 'metaQuickhands',
    cost: 400,
    apply: (game) => {
      game.weapons.boostReloadSpeed(0.8)
    },
  },
  {
    id: 'stockpile',
    titleKey: 'metaStockpile',
    cost: 300,
    requires: 'quickhands',
    apply: (game) => {
      game.inventory.addFuelCan(1)
      for (const w of game.weapons.weapons) {
        if (!w.melee) w.reserve += 2
      }
    },
  },
  {
    id: 'masterscavenger',
    titleKey: 'metaMasterScavenger',
    cost: 500,
    requires: 'stockpile',
    apply: (game) => {
      game.coins += 50
      game.inventory.addFuelCan(1)
    },
  },
  {
    id: 'fortune',
    titleKey: 'metaFortune',
    cost: 250,
    apply: (game) => {
      game.coins += 30
    },
  },
  // Survival branch: vitality (root) -> ironwill (tier 2) -> juggernaut (capstone).
  {
    id: 'ironwill',
    titleKey: 'metaIronWill',
    cost: 350,
    requires: 'vitality',
    apply: (game) => {
      game.playerState.maxHealth += 15
      game.playerState.health += 15
      game.playerState.maxArmor += 15
    },
  },
  {
    id: 'juggernaut',
    titleKey: 'metaJuggernaut',
    cost: 600,
    requires: 'ironwill',
    apply: (game) => {
      game.playerState.maxHealth += 30
      game.playerState.health += 30
      game.playerState.maxArmor += 20
    },
  },
  // Base upgrades - standalone, safe-zone-themed picks rather than a
  // branching chain, since each is a flat one-time bonus to something the
  // safe zone already does (heal, guard, trader) rather than a stacking
  // player stat.
  {
    id: 'extraGuard',
    titleKey: 'metaExtraGuard',
    cost: 600,
    apply: (game) => game._addExtraGuard(),
  },
  {
    id: 'fortifiedRest',
    titleKey: 'metaFortifiedRest',
    cost: 350,
    // Checked directly in Game.js's _updateSafeZoneHeal via
    // metaProgress.purchased.has('fortifiedRest') - a flat rate bonus reads
    // more naturally as a standing condition than a one-time apply() effect.
    apply: () => {},
  },
  {
    id: 'traderDiscount',
    titleKey: 'metaTraderDiscount',
    cost: 400,
    // Checked directly in Game.js's _traderPrice, same reasoning as
    // fortifiedRest above.
    apply: () => {},
  },
  // Moved from the Coin Shop's perks/base/legacy/weapons sections (see
  // CoinShop.js's own header comment) - same ids and apply() effects,
  // just re-priced in Legacy Points onto this panel's existing 250-600
  // scale instead of Coins' 500-5000 scale, roughly preserving relative
  // ordering. apply() no longer self-tracks ownership (the old
  // coinShopPurchased.add(id) calls are gone) since _applyMetaUpgrades
  // already re-applies every id in metaProgress.purchased generically -
  // that's what CoinShop's own items didn't have until now.
  {
    id: 'coin_damage',
    titleKey: 'coinShopDamage',
    cost: 500,
    apply: (game) => {
      game.weapons.damageMult += 0.1
    },
  },
  {
    id: 'coin_health',
    titleKey: 'coinShopHealth',
    cost: 300,
    apply: (game) => {
      game.playerState.maxHealth += 25
      game.playerState.heal(25)
      game._updateHealthHud()
    },
  },
  {
    id: 'companion_speed',
    titleKey: 'coinShopCompanionSpeed',
    cost: 550,
    // Also checked directly in Game.js's _rebuildCompanion (companion
    // objects get rebuilt mid-session, not just re-created on page load,
    // so the generic _applyMetaUpgrades pass alone isn't enough here).
    apply: (game) => {
      game.companion.equipSpeedBoost()
    },
  },
  {
    id: 'companion_autorevive',
    titleKey: 'coinShopCompanionAutoRevive',
    cost: 650,
    apply: (game) => {
      game.companion.equipAutoRevive()
    },
  },
  // Companion Perk Tree - a small requires-chained mini tree (root -> tier 2
  // -> capstone), same shape as the player's own Survival/Combat/Utility
  // chains above, just aimed at the companion. Also re-applied directly in
  // Game.js's _rebuildCompanion (a role swap builds a fresh Companion
  // instance mid-session, same reason companion_speed/companion_autorevive
  // already needed that second call site).
  {
    id: 'companion_vitality',
    titleKey: 'metaCompanionVitality',
    cost: 350,
    apply: (game) => {
      game.companion.equipVitalityBoost()
    },
  },
  {
    id: 'companion_marksman',
    titleKey: 'metaCompanionMarksman',
    cost: 450,
    requires: 'companion_vitality',
    apply: (game) => {
      game.companion.equipMarksman()
    },
  },
  {
    id: 'companion_elite',
    titleKey: 'metaCompanionElite',
    cost: 650,
    requires: 'companion_marksman',
    apply: (game) => {
      game.companion.equipElite()
    },
  },
  {
    id: 'coin_stamina',
    titleKey: 'coinShopStamina',
    cost: 300,
    apply: (game) => {
      game.player.maxStamina += 25
      game.player.stamina = game.player.maxStamina
    },
  },
  {
    id: 'akimbo',
    titleKey: 'coinShopAkimbo',
    cost: 750,
    apply: (game) => {
      game.weapons.setAkimbo(true)
    },
  },
  {
    id: 'akimbo_shotgun',
    titleKey: 'coinShopAkimboShotgun',
    cost: 800,
    apply: (game) => {
      game.weapons.setShotgunAkimbo(true)
    },
  },
  {
    id: 'turret',
    titleKey: 'coinShopTurret',
    cost: 600,
    apply: (game) => {
      game._buildAutoTurret()
    },
  },
  {
    id: 'turret_upgrade_1',
    titleKey: 'coinShopTurretUpgrade1',
    cost: 400,
    apply: (game) => {
      if (game.turret) game.turret.upgrade()
    },
  },
  {
    id: 'turret_upgrade_2',
    titleKey: 'coinShopTurretUpgrade2',
    cost: 550,
    apply: (game) => {
      if (game.turret) game.turret.upgrade()
    },
  },
  {
    id: 'turret_upgrade_3',
    titleKey: 'coinShopTurretUpgrade3',
    cost: 750,
    apply: (game) => {
      if (game.turret) game.turret.upgrade()
    },
  },
  {
    id: 'base_walls',
    titleKey: 'coinShopBaseWalls',
    cost: 850,
    apply: (game) => {
      game._buildBaseWalls()
    },
  },
  {
    id: 'watchtower',
    titleKey: 'coinShopWatchtower',
    cost: 700,
    apply: (game) => {
      game._buildWatchtower()
    },
  },
  {
    id: 'farm_plot',
    titleKey: 'coinShopFarmPlot',
    cost: 650,
    apply: (game) => {
      game._buildFarmPlot()
    },
  },
  {
    id: 'ammo_press',
    titleKey: 'coinShopAmmoPress',
    cost: 700,
    apply: (game) => {
      game._buildAmmoPress()
    },
  },
  // Veteran's Cache pair - kept their requiresLifetimeCoins gate (careerStats.
  // lifetimeCoinsEarned, a never-reset cumulative total) even though every
  // other field here uses `requires` (another upgrade's id) - see Game.js's
  // _renderUpgradesOptions for how this second, different kind of lock is
  // now handled there too.
  {
    id: 'cache_resolve',
    titleKey: 'coinShopCacheResolve',
    cost: 350,
    requiresLifetimeCoins: 100000,
    apply: (game) => {
      game.playerState.maxHealth += 15
      game.playerState.heal(15)
      game._updateHealthHud()
    },
  },
  {
    id: 'cache_fortune',
    titleKey: 'coinShopCacheFortune',
    cost: 500,
    requiresLifetimeCoins: 250000,
    apply: (game) => {
      game.weapons.damageMult += 0.08
    },
  },
]

export function loadMetaProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      // Falls back to the old pre-rename key so existing players' saved
      // total carries over once instead of silently resetting to 0.
      legacyPoints: parsed.legacyPoints ?? parsed.legacyScrap ?? 0,
      purchased: new Set(parsed.purchased || []),
      prestigeLevel: parsed.prestigeLevel ?? 0,
      // Prestige History Log (Profile panel) - {level, ts} per past
      // prestige, forward-only same as Achievements.js's unlockTimes (no
      // backfilled history for resets before this shipped).
      prestigeHistory: Array.isArray(parsed.prestigeHistory) ? parsed.prestigeHistory : [],
    }
  } catch {
    return { legacyPoints: 0, purchased: new Set(), prestigeLevel: 0, prestigeHistory: [] }
  }
}

export function saveMetaProgress(meta) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ legacyPoints: meta.legacyPoints, purchased: [...meta.purchased], prestigeLevel: meta.prestigeLevel, prestigeHistory: meta.prestigeHistory }))
  } catch {
    // Storage unavailable (e.g. private browsing) - progress just won't persist.
  }
}
