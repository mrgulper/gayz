// Permanent, cross-run progression: a fraction of each run's points converts
// to "Legacy Points" when a Map 1 run ends (ProgressUI's _recordRunEnd), spent here on
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
  {
    id: 'quickhands',
    titleKey: 'metaQuickhands',
    cost: 400,
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
  // Once Coin Shop perks (kept their ids so earlier purchases still count).
  {
    id: 'coin_damage',
    titleKey: 'metaCoinDamage',
    cost: 500,
  },
  {
    id: 'coin_health',
    titleKey: 'metaCoinHealth',
    cost: 300,
  },
  // More Zombie Survival upgrades (2026-10-10) - effects in PlayRules.js's
  // UPGRADE_PLAY. Chains: swiftfoot -> sprinter, scavenger -> treasureHunter,
  // ammoBelt -> bandolier, fortune -> warChest, fortifiedRest -> fieldMedic,
  // juggernaut -> lastStand.
  { id: 'swiftfoot', titleKey: 'metaSwiftfoot', cost: 350 },
  { id: 'sprinter', titleKey: 'metaSprinter', cost: 500, requires: 'swiftfoot' },
  { id: 'scavenger', titleKey: 'metaScavenger', cost: 400 },
  { id: 'treasureHunter', titleKey: 'metaTreasureHunter', cost: 550, requires: 'scavenger' },
  { id: 'warChest', titleKey: 'metaWarChest', cost: 400, requires: 'fortune' },
  { id: 'secondWind', titleKey: 'metaSecondWind', cost: 600 },
  { id: 'ammoBelt', titleKey: 'metaAmmoBelt', cost: 350 },
  { id: 'bandolier', titleKey: 'metaBandolier', cost: 500, requires: 'ammoBelt' },
  { id: 'headhunter', titleKey: 'metaHeadhunter', cost: 450 },
  { id: 'thickSkin', titleKey: 'metaThickSkin', cost: 450 },
  { id: 'fieldMedic', titleKey: 'metaFieldMedic', cost: 400, requires: 'fortifiedRest' },
  { id: 'lastStand', titleKey: 'metaLastStand', cost: 800, requires: 'juggernaut' },
  // Veteran's Cache pair - kept their requiresLifetimeCoins gate (careerStats.
  // lifetimeCoinsEarned, a never-reset cumulative total) even though every
  // other field here uses `requires` (another upgrade's id) - see Game.js's
  // _renderUpgradesOptions for how this second, different kind of lock is
  // now handled there too.
  {
    id: 'cache_resolve',
    titleKey: 'metaCacheResolve',
    cost: 350,
    requiresLifetimeCoins: 100000,
  },
  {
    id: 'cache_fortune',
    titleKey: 'metaCacheFortune',
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
