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
  },
  {
    id: 'plating',
    titleKey: 'metaPlating',
    cost: 350,
  },
  {
    id: 'provisions',
    titleKey: 'metaProvisions',
    cost: 300,
  },
  {
    id: 'arsenal',
    titleKey: 'metaArsenal',
    cost: 300,
  },
  {
    id: 'veteran',
    titleKey: 'metaVeteran',
    cost: 250,
  },
  {
    id: 'endurance',
    titleKey: 'metaEndurance',
    cost: 300,
  },
  // Combat branch: marksman (root) -> deadeye (capstone).
  {
    id: 'marksman',
    titleKey: 'metaMarksman',
    cost: 450,
  },
  {
    id: 'deadeye',
    titleKey: 'metaDeadeye',
    cost: 550,
    requires: 'marksman',
  },
  // Utility branch: quickhands (root) -> stockpile (tier 2) -> masterscavenger (capstone).
  {
    id: 'quickhands',
    titleKey: 'metaQuickhands',
    cost: 400,
  },
  {
    id: 'stockpile',
    titleKey: 'metaStockpile',
    cost: 300,
    requires: 'quickhands',
  },
  {
    id: 'masterscavenger',
    titleKey: 'metaMasterScavenger',
    cost: 500,
    requires: 'stockpile',
  },
  {
    id: 'fortune',
    titleKey: 'metaFortune',
    cost: 250,
  },
  // Survival branch: vitality (root) -> ironwill (tier 2) -> juggernaut (capstone).
  {
    id: 'ironwill',
    titleKey: 'metaIronWill',
    cost: 350,
    requires: 'vitality',
  },
  {
    id: 'juggernaut',
    titleKey: 'metaJuggernaut',
    cost: 600,
    requires: 'ironwill',
  },
  // Base upgrades - standalone, safe-zone-themed picks rather than a
  // branching chain, since each is a flat one-time bonus to something the
  // safe zone already does (heal, guard, trader) rather than a stacking
  // player stat.
  {
    id: 'extraGuard',
    titleKey: 'metaExtraGuard',
    cost: 600,
  },
  {
    id: 'fortifiedRest',
    titleKey: 'metaFortifiedRest',
    cost: 350,
  },
  {
    id: 'traderDiscount',
    titleKey: 'metaTraderDiscount',
    cost: 400,
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
  },
  {
    id: 'coin_health',
    titleKey: 'coinShopHealth',
    cost: 300,
  },
  {
    id: 'companion_speed',
    titleKey: 'coinShopCompanionSpeed',
    cost: 550,
  },
  {
    id: 'companion_autorevive',
    titleKey: 'coinShopCompanionAutoRevive',
    cost: 650,
  },
  // Night Vision Goggles (batch 5 feature) - a one-time permanent unlock,
  // same shape as every other META_UPGRADES entry: apply() just sets a flag
  // Game.js reads elsewhere (see hasNightVision/_toggleNightVision), rather
  // than this file needing to know anything about the toggle/overlay itself.
  {
    id: 'night_vision',
    titleKey: 'coinShopNightVision',
    cost: 400,
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
  },
  {
    id: 'companion_marksman',
    titleKey: 'metaCompanionMarksman',
    cost: 450,
    requires: 'companion_vitality',
  },
  {
    id: 'companion_elite',
    titleKey: 'metaCompanionElite',
    cost: 650,
    requires: 'companion_marksman',
  },
  {
    id: 'coin_stamina',
    titleKey: 'coinShopStamina',
    cost: 300,
  },
  {
    id: 'akimbo',
    titleKey: 'coinShopAkimbo',
    cost: 750,
  },
  {
    id: 'akimbo_shotgun',
    titleKey: 'coinShopAkimboShotgun',
    cost: 800,
  },
  {
    id: 'turret',
    titleKey: 'coinShopTurret',
    cost: 600,
  },
  {
    id: 'turret_upgrade_1',
    titleKey: 'coinShopTurretUpgrade1',
    cost: 400,
  },
  {
    id: 'turret_upgrade_2',
    titleKey: 'coinShopTurretUpgrade2',
    cost: 550,
  },
  {
    id: 'turret_upgrade_3',
    titleKey: 'coinShopTurretUpgrade3',
    cost: 750,
  },
  {
    id: 'base_walls',
    titleKey: 'coinShopBaseWalls',
    cost: 850,
  },
  {
    id: 'watchtower',
    titleKey: 'coinShopWatchtower',
    cost: 700,
  },
  {
    id: 'farm_plot',
    titleKey: 'coinShopFarmPlot',
    cost: 650,
  },
  {
    id: 'ammo_press',
    titleKey: 'coinShopAmmoPress',
    cost: 700,
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
  },
  {
    id: 'cache_fortune',
    titleKey: 'coinShopCacheFortune',
    cost: 500,
    requiresLifetimeCoins: 250000,
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
