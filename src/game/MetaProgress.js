// Permanent, cross-run progression: a fraction of each run's points converts
// to "Legacy Points" on death (see Game.js's _onPlayerDeath), spent here on
// one-time permanent upgrades applied at the start of every future run.
const STORAGE_KEY = 'gayz-meta-progress'
export const DEATH_POINTS_CONVERSION = 0.2

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
  {
    id: 'marksman',
    titleKey: 'metaMarksman',
    cost: 450,
    apply: (game) => {
      game.weapons.damageMult += 0.1
    },
  },
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
    apply: (game) => {
      game.inventory.addFuelCan(1)
      for (const w of game.weapons.weapons) {
        if (!w.melee) w.reserve += 2
      }
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
  {
    id: 'ironwill',
    titleKey: 'metaIronWill',
    cost: 350,
    apply: (game) => {
      game.playerState.maxHealth += 15
      game.playerState.health += 15
      game.playerState.maxArmor += 15
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
    }
  } catch {
    return { legacyPoints: 0, purchased: new Set() }
  }
}

export function saveMetaProgress(meta) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ legacyPoints: meta.legacyPoints, purchased: [...meta.purchased] }))
  } catch {
    // Storage unavailable (e.g. private browsing) - progress just won't persist.
  }
}
