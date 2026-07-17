// Permanent, cross-run progression: a fraction of each run's points converts
// to "Legacy Points" on death (see Game.js's _onPlayerDeath), spent here on
// one-time permanent upgrades applied at the start of every future run.
const STORAGE_KEY = 'gayz-meta-progress'
export const DEATH_POINTS_CONVERSION = 0.2

export const META_UPGRADES = [
  {
    id: 'vitality',
    titleKey: 'metaVitality',
    cost: 40,
    apply: (game) => {
      game.playerState.maxHealth += 50
      game.playerState.health += 50
    },
  },
  {
    id: 'plating',
    titleKey: 'metaPlating',
    cost: 35,
    apply: (game) => {
      game.playerState.maxArmor += 25
    },
  },
  {
    id: 'provisions',
    titleKey: 'metaProvisions',
    cost: 30,
    apply: (game) => {
      game.inventory.addHealthPack(1)
      game.inventory.addArmorPack(1)
    },
  },
  {
    id: 'arsenal',
    titleKey: 'metaArsenal',
    cost: 30,
    apply: (game) => {
      game.inventory.addGrenade(1)
      game.inventory.addNoisemaker(1)
    },
  },
  {
    id: 'veteran',
    titleKey: 'metaVeteran',
    cost: 25,
    apply: (game) => {
      game.points += 20
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
