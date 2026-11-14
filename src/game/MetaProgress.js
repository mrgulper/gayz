// Permanent, cross-run progression: a fraction of each run's points converts
// to "Legacy Points" when a Map 1 run ends (ProgressUI's _recordRunEnd), spent here on
// one-time permanent upgrades applied at the start of every future run.
const STORAGE_KEY = 'gayz-meta-progress'
export const DEATH_POINTS_CONVERSION = 0.2
// The skill tree's Legacy upgrade: this much more Points per game.
export const LEGACY_BOOST = 0.1

// The skill tree (2026-11-14, Batch 4b): five branches, each growing from
// one root. `requires` names the upgrade that must be bought first (the
// line drawn into this one), `branch` its colour/column, and `fork` a
// pick-one-of-two group - buying one locks the others in that group until
// a Respec. ProgressUI.js draws it twice: as branch columns and as one big
// draggable map. Effects: PlayRules.js UPGRADE_PLAY (numbers) and
// TreeSkills.js (everything that reacts to kills, bites, waves...).
// requiresLifetimeCoins (careerStats.lifetimeCoinsEarned) is a second,
// different lock kept from the old Coin Shop's Veteran's Cache pair.
export const TREE_BRANCHES = ['survival', 'combat', 'speed', 'loot', 'gear']

const u = (id, titleKey, branch, cost, requires, extra) => ({ id, titleKey, branch, cost, ...(requires ? { requires } : {}), ...extra })

export const META_UPGRADES = [
  // --- Survival ---
  u('vitality', 'metaVitality', 'survival', 400),
  u('plating', 'metaPlating', 'survival', 350, 'vitality'),
  u('kevlar', 'metaKevlar', 'survival', 500, 'plating'),
  u('armorRefill', 'metaArmorRefill', 'survival', 900, 'kevlar'),
  u('thickSkin', 'metaThickSkin', 'survival', 450, 'plating'),
  u('hardenedHide', 'metaHardenedHide', 'survival', 650, 'thickSkin'),
  u('shrugOff', 'metaShrugOff', 'survival', 1000, 'hardenedHide'),
  u('ironwill', 'metaIronWill', 'survival', 350, 'vitality'),
  u('juggernaut', 'metaJuggernaut', 'survival', 600, 'ironwill'),
  u('lastStand', 'metaLastStand', 'survival', 800, 'juggernaut'),
  u('notToday', 'metaNotToday', 'survival', 1500, 'lastStand'),
  u('tank', 'metaTank', 'survival', 1100, 'juggernaut', { fork: 'survivalFork' }),
  u('regenerator', 'metaRegenerator', 'survival', 1100, 'juggernaut', { fork: 'survivalFork' }),
  u('coin_health', 'metaCoinHealth', 'survival', 300, 'ironwill'),
  u('bigHeart', 'metaBigHeart', 'survival', 700, 'coin_health'),
  u('secondWind', 'metaSecondWind', 'survival', 600, 'vitality'),
  u('patchUp', 'metaPatchUp', 'survival', 800, 'secondWind'),
  u('ironGut', 'metaIronGut', 'survival', 500, 'secondWind'),
  u('cache_resolve', 'metaCacheResolve', 'survival', 350, 'vitality', { requiresLifetimeCoins: 100000 }),
  // --- Combat ---
  u('marksman', 'metaMarksman', 'combat', 450),
  u('deadeye', 'metaDeadeye', 'combat', 550, 'marksman'),
  u('berserker', 'metaBerserker', 'combat', 750, 'deadeye'),
  u('giantKiller', 'metaGiantKiller', 'combat', 1000, 'berserker'),
  u('finisher', 'metaFinisher', 'combat', 900, 'deadeye'),
  u('firstStrike', 'metaFirstStrike', 'combat', 700, 'deadeye'),
  u('headhunter', 'metaHeadhunter', 'combat', 450, 'marksman'),
  u('sharpEye', 'metaSharpEye', 'combat', 650, 'headhunter'),
  u('closeQuarters', 'metaCloseQuarters', 'combat', 1100, 'sharpEye', { fork: 'rangeFork' }),
  u('longShot', 'metaLongShot', 'combat', 1100, 'sharpEye', { fork: 'rangeFork' }),
  u('onARoll', 'metaOnARoll', 'combat', 900, 'headhunter'),
  u('coin_damage', 'metaCoinDamage', 'combat', 500, 'marksman'),
  u('brawler', 'metaBrawler', 'combat', 700, 'coin_damage'),
  u('cache_fortune', 'metaCacheFortune', 'combat', 500, 'coin_damage', { requiresLifetimeCoins: 250000 }),
  u('quickhands', 'metaQuickhands', 'combat', 400, 'marksman'),
  u('speedLoader', 'metaSpeedLoader', 'combat', 550, 'quickhands'),
  u('lastRounds', 'metaLastRounds', 'combat', 900, 'speedLoader'),
  u('extendedMags', 'metaExtendedMags', 'combat', 700, 'quickhands'),
  u('recycler', 'metaRecycler', 'combat', 1100, 'extendedMags'),
  // --- Speed ---
  u('swiftfoot', 'metaSwiftfoot', 'speed', 350),
  u('sprinter', 'metaSprinter', 'speed', 500, 'swiftfoot'),
  u('marathoner', 'metaMarathoner', 'speed', 650, 'sprinter'),
  u('fleetFoot', 'metaFleetFoot', 'speed', 900, 'marathoner'),
  u('hitAndRun', 'metaHitAndRun', 'speed', 900, 'sprinter', { fork: 'speedFork' }),
  u('secondBreath', 'metaSecondBreath', 'speed', 900, 'sprinter', { fork: 'speedFork' }),
  u('adrenaline', 'metaAdrenaline', 'speed', 600, 'swiftfoot'),
  u('dodgeStep', 'metaDodgeStep', 'speed', 1100, 'adrenaline'),
  u('breakRunner', 'metaBreakRunner', 'speed', 450, 'swiftfoot'),
  // --- Loot ---
  u('fortune', 'metaFortune', 'loot', 250),
  u('warChest', 'metaWarChest', 'loot', 400, 'fortune'),
  u('bankroll', 'metaBankroll', 'loot', 600, 'warChest'),
  u('starterPack', 'metaStarterPack', 'loot', 900, 'bankroll'),
  u('interest', 'metaInterest', 'loot', 1000, 'warChest', { fork: 'lootFork' }),
  u('streakCash', 'metaStreakCash', 'loot', 1000, 'warChest', { fork: 'lootFork' }),
  u('wavePay', 'metaWavePay', 'loot', 500, 'fortune'),
  u('legacyBoost', 'metaLegacyBoost', 'loot', 1500, 'wavePay'),
  u('scavenger', 'metaScavenger', 'loot', 400, 'fortune'),
  u('treasureHunter', 'metaTreasureHunter', 'loot', 550, 'scavenger'),
  u('goldRush', 'metaGoldRush', 'loot', 700, 'treasureHunter'),
  u('goldenTouch', 'metaGoldenTouch', 'loot', 900, 'goldRush'),
  u('bossBounty', 'metaBossBounty', 'loot', 800, 'treasureHunter'),
  u('luckyChest', 'metaLuckyChest', 'loot', 500, 'scavenger'),
  u('tipJar', 'metaTipJar', 'loot', 700, 'luckyChest'),
  u('traderDiscount', 'metaTraderDiscount', 'loot', 400, 'fortune'),
  u('haggler', 'metaHaggler', 'loot', 600, 'traderDiscount'),
  u('bargainHunter', 'metaBargainHunter', 'loot', 900, 'haggler'),
  // --- Gear ---
  u('ammoBelt', 'metaAmmoBelt', 'gear', 350),
  u('bandolier', 'metaBandolier', 'gear', 500, 'ammoBelt'),
  u('ammoHoarder', 'metaAmmoHoarder', 'gear', 650, 'bandolier'),
  u('bottomless', 'metaBottomless', 'gear', 900, 'ammoHoarder'),
  u('restock', 'metaRestock', 'gear', 800, 'bandolier'),
  u('scrounger', 'metaScrounger', 'gear', 500, 'ammoBelt'),
  u('fortifiedRest', 'metaFortifiedRest', 'gear', 350, 'ammoBelt'),
  u('fieldMedic', 'metaFieldMedic', 'gear', 400, 'fortifiedRest'),
  u('quickPatch', 'metaQuickPatch', 'gear', 700, 'fieldMedic'),
  u('packedLunch', 'metaPackedLunch', 'gear', 500, 'fortifiedRest'),
  u('trapKit', 'metaTrapKit', 'gear', 600, 'fortifiedRest'),
]

const BY_ID = new Map(META_UPGRADES.map((x) => [x.id, x]))
export function metaUpgrade(id) {
  return BY_ID.get(id)
}

// What one tree spot is right now, for the given saved progress:
// 'owned', 'fork' (its fork partner is owned), 'locked' (the one before
// it isn't), 'lifetime' (not enough lifetime coins), 'poor' or 'buy'.
export function upgradeState(meta, lifetimeCoins, up) {
  const has = (id) => meta.purchased.has(id)
  if (has(up.id)) return 'owned'
  if (up.fork && META_UPGRADES.some((o) => o.fork === up.fork && o.id !== up.id && has(o.id))) return 'fork'
  if (up.requires && !has(up.requires)) return 'locked'
  if (up.requiresLifetimeCoins && !(Number(lifetimeCoins) >= up.requiresLifetimeCoins)) return 'lifetime'
  return meta.legacyPoints >= up.cost ? 'buy' : 'poor'
}

// How many can be owned at once: one per fork group.
export function maxOwnable(list = META_UPGRADES) {
  const forks = new Set()
  let n = 0
  for (const x of list) {
    if (!x.fork) n++
    else if (!forks.has(x.fork)) {
      forks.add(x.fork)
      n++
    }
  }
  return n
}

// The Points every upgrade bought before the skill tree cost, given back
// once (Gaymi's pick, 2026-11-14: "refund everyone"). Old purchases stay in
// the save's `purchased` list untouched and the tree lives in `tree`, so a
// device still on the old version (Cloud Save merges lists by union) can't
// bring them back into the tree; `refunded` remembers which ids were
// already paid back so nothing is refunded twice.
function refundOldPurchases(parsed) {
  const old = Array.isArray(parsed.purchased) ? parsed.purchased : []
  const refunded = new Set(Array.isArray(parsed.refunded) ? parsed.refunded : [])
  let points = 0
  for (const id of old) {
    if (refunded.has(id)) continue
    refunded.add(id)
    points += BY_ID.get(id)?.cost || 0
  }
  return { points, refunded }
}

export function loadMetaProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const refund = refundOldPurchases(parsed)
    const meta = {
      // Falls back to the old pre-rename key so existing players' saved
      // total carries over once instead of silently resetting to 0.
      legacyPoints: (Number(parsed.legacyPoints ?? parsed.legacyScrap) || 0) + refund.points,
      // The skill tree's purchases (the old list is only read for the
      // one-time refund above).
      purchased: new Set((Array.isArray(parsed.tree) ? parsed.tree : []).filter((id) => BY_ID.has(id))),
      oldPurchased: Array.isArray(parsed.purchased) ? parsed.purchased : [],
      refunded: refund.refunded,
      // Points just given back this load (Game.js shows a message once).
      refundedNow: refund.points,
      prestigeLevel: parsed.prestigeLevel ?? 0,
      // Prestige History Log (Profile panel) - {level, ts} per past
      // prestige, forward-only same as Achievements.js's unlockTimes (no
      // backfilled history for resets before this shipped).
      prestigeHistory: Array.isArray(parsed.prestigeHistory) ? parsed.prestigeHistory : [],
    }
    if (refund.points) saveMetaProgress(meta)
    return meta
  } catch {
    return { legacyPoints: 0, purchased: new Set(), oldPurchased: [], refunded: new Set(), refundedNow: 0, prestigeLevel: 0, prestigeHistory: [] }
  }
}

export function saveMetaProgress(meta) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ legacyPoints: meta.legacyPoints, tree: [...meta.purchased], purchased: meta.oldPurchased || [], refunded: [...(meta.refunded || [])], prestigeLevel: meta.prestigeLevel, prestigeHistory: meta.prestigeHistory }))
  } catch {
    // Storage unavailable (e.g. private browsing) - progress just won't persist.
  }
}
