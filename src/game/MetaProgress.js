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
