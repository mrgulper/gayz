// Stat/visual configs for each zombie archetype. Weighted random spawn mix
// lives here too so tuning difficulty is a one-file job.

export const ZOMBIE_TYPES = {
  // packSize: this many spawn together in a small cluster (see
  // ZombieManager._spawnRandom's packmate loop) instead of alone - reuses
  // the same humanoid body-builder as every other type (an accepted
  // visual simplification, same precedent as the Flamethrower/Rocket
  // Launcher's viewmodel fallback), scaled way down and re-tinted so
  // packmates read as a distinct fast-and-small threat rather than a
  // shrunk shambler.
  feral_dog: {
    id: 'feral_dog',
    label: 'Feral Pack',
    lore: "Whatever's left of the neighborhood strays runs in threes now.",
    weight: 2,
    health: 20,
    speedMin: 5.0,
    speedMax: 6.0,
    damageMin: 12,
    damageMax: 20,
    scale: 0.55,
    ranged: false,
    packSize: 3,
    meleeRange: 1.1,
    attackCooldown: 0.5,
    skinTones: [0x5c4a38, 0x4a3c2c, 0x3a2e20],
    clothesTones: [0x1c1712, 0x191510],
  },
  feral_child: {
    id: 'feral_child',
    label: 'Feral Child',
    lore: "Small enough to fit where you can't follow. Fast enough that it doesn't need to.",
    weight: 2,
    health: 25,
    speedMin: 3.2,
    speedMax: 4.2,
    damageMin: 18,
    damageMax: 28,
    scale: 0.62,
    ranged: false,
    meleeRange: 1.2,
    attackCooldown: 0.7,
    skinTones: [0x4f5a44, 0x455038, 0x3d4830],
    clothesTones: [0x24281e, 0x1e221a],
  },
  shambler: {
    id: 'shambler',
    label: 'Shambler',
    lore: "The most common casualty of VIREO's rollout - slow, but they don't stop.",
    weight: 3,
    health: 60,
    speedMin: 1.4,
    speedMax: 2.6,
    damageMin: 35,
    damageMax: 55,
    scale: 1,
    ranged: false,
    meleeRange: 1.5,
    attackCooldown: 1.0,
    skinTones: [0x4a5539, 0x445033, 0x505a3c, 0x3d4a3f, 0x565040],
    clothesTones: [0x2a2a24, 0x27271f, 0x24241c, 0x2c2c26],
  },
  runner: {
    id: 'runner',
    label: 'Runner',
    lore: "Whatever's left of its nervous system still remembers how to sprint.",
    weight: 4,
    health: 32,
    speedMin: 4.0,
    speedMax: 5.2,
    damageMin: 25,
    damageMax: 40,
    scale: 0.9,
    ranged: false,
    meleeRange: 1.4,
    attackCooldown: 0.85,
    skinTones: [0x5c4a3a, 0x644f3d, 0x554236],
    clothesTones: [0x22201c, 0x282520],
  },
  brute: {
    id: 'brute',
    label: 'Brute',
    lore: 'Some kind of adrenal overdose. Hits like a truck.',
    weight: 2,
    health: 175,
    speedMin: 0.7,
    speedMax: 0.95,
    damageMin: 65,
    damageMax: 95,
    scale: 1.55,
    ranged: false,
    meleeRange: 2.1,
    attackCooldown: 1.4,
    skinTones: [0x3a3228, 0x342d24, 0x3d3529],
    clothesTones: [0x14120e, 0x181510],
  },
  spitter: {
    id: 'spitter',
    label: 'Spitter',
    lore: 'Keeps its distance and spits up whatever is left of its stomach lining.',
    weight: 3,
    health: 42,
    speedMin: 0.9,
    speedMax: 1.3,
    damageMin: 38,
    damageMax: 55,
    scale: 1.0,
    ranged: true,
    engageRange: 15,
    retreatRange: 7,
    spitCooldown: 2.1,
    spitTravelSpeed: 13,
    skinTones: [0x5a4a3a, 0x63533f, 0x4f4234],
    clothesTones: [0x201a14, 0x241d16],
  },
  crawler: {
    id: 'crawler',
    label: 'Crawler',
    lore: 'Lost the use of its legs. Found something faster instead.',
    weight: 3,
    health: 38,
    speedMin: 2.7,
    speedMax: 3.7,
    damageMin: 30,
    damageMax: 48,
    scale: 0.82,
    ranged: false,
    crawler: true,
    meleeRange: 1.3,
    attackCooldown: 0.8,
    skinTones: [0x4a5540, 0x424c38, 0x505c45],
    clothesTones: [0x0f1611, 0x131c15],
  },
  burrower: {
    id: 'burrower',
    label: 'Burrower',
    lore: "Went under the rubble instead of over it. You won't hear it coming - it's already close.",
    weight: 2,
    health: 45,
    speedMin: 2.2,
    speedMax: 3.0,
    damageMin: 32,
    damageMax: 50,
    scale: 0.95,
    ranged: false,
    // See ZombieManager._spawnRandom - forces isAmbush and swaps in a much
    // tighter BURROWER_RADIUS_MIN/MAX than the normal ambush range, so this
    // type always pops up right on top of the player instead of just
    // sometimes doing the standard dormant-hide-and-wait other melee types
    // already roll for.
    burrower: true,
    meleeRange: 1.4,
    attackCooldown: 0.9,
    skinTones: [0x4a3d2e, 0x453828, 0x4f4132],
    clothesTones: [0x231c12, 0x1e1810],
  },
  exploder: {
    id: 'exploder',
    label: 'Bloater',
    lore: "Don't shoot it up close. Don't shoot it at all if you can help it.",
    weight: 2,
    health: 55,
    speedMin: 1.6,
    speedMax: 2.3,
    damageMin: 0,
    damageMax: 0,
    scale: 1.2,
    ranged: false,
    explodes: true,
    meleeRange: 2.3,
    attackCooldown: 999,
    explodeRadius: 4.5,
    explodeDamageMin: 60,
    explodeDamageMax: 145,
    skinTones: [0x4a6a52, 0x4f6d55, 0x436047],
    clothesTones: [0x152018, 0x18251a],
  },
  shielded: {
    id: 'shielded',
    label: 'Riot Corpse',
    lore: "Whatever it's wearing still holds. Bullets won't get through it - your knife will.",
    weight: 2,
    health: 65,
    speedMin: 1.1,
    speedMax: 1.7,
    damageMin: 40,
    damageMax: 58,
    scale: 1.1,
    ranged: false,
    // See Zombie.js's onHit/shieldHealth - a separate pool that absorbs
    // every non-melee hit until depleted, at which point it behaves like
    // any other melee type. Melee bypasses it entirely, every time.
    shielded: true,
    shieldHealth: 90,
    meleeRange: 1.6,
    attackCooldown: 1.1,
    skinTones: [0x3a3d42, 0x35383d, 0x40434a],
    clothesTones: [0x1c1e22, 0x202226],
  },
  screamer: {
    id: 'screamer',
    label: 'Screamer',
    lore: "Its scream isn't pain. It's a dinner bell.",
    weight: 2,
    health: 50,
    speedMin: 2.0,
    speedMax: 2.8,
    damageMin: 20,
    damageMax: 32,
    scale: 1.05,
    ranged: false,
    meleeRange: 1.6,
    attackCooldown: 1.1,
    // Screams on a cooldown regardless of engagement range: instantly wakes
    // every dormant (ambush) zombie in radius and briefly speeds up every
    // alive zombie in radius. See Zombie._updateScream / ZombieManager's
    // scream handling.
    screams: true,
    screamCooldown: 6.5,
    screamRadius: 15,
    screamEnrageMs: 4000,
    screamEnrageMult: 1.6,
    skinTones: [0x5c4a5e, 0x544255, 0x635066],
    clothesTones: [0x1c1620, 0x201924],
  },
  // Ranged + explode-on-death hybrid: fights like a spitter, but detonates
  // like a bloater once it dies - see Zombie.js's onHit (explodeOnDeath)
  // and _explode, which it reuses via the same explodeRadius/damage config.
  spitter_bomber: {
    id: 'spitter_bomber',
    label: 'Bomber Spitter',
    lore: "It stopped digesting a while ago. Now it just... stores things.",
    weight: 1,
    health: 48,
    speedMin: 0.9,
    speedMax: 1.3,
    damageMin: 30,
    damageMax: 45,
    scale: 1.05,
    ranged: true,
    engageRange: 14,
    retreatRange: 6,
    spitCooldown: 2.4,
    spitTravelSpeed: 12,
    explodeOnDeath: true,
    explodeRadius: 4,
    explodeDamageMin: 50,
    explodeDamageMax: 120,
    skinTones: [0x4a6a30, 0x527228, 0x466024],
    clothesTones: [0x101a08, 0x14200a],
  },
  // Screamer + summon-on-death hybrid - see ZombieManager's death handling
  // (summonOnDeath/summonType) for the shambler burst it releases.
  screamer_swarmer: {
    id: 'screamer_swarmer',
    label: 'Swarmer',
    lore: "Its scream calls them in. Its death lets them out.",
    weight: 1,
    health: 55,
    speedMin: 2.0,
    speedMax: 2.8,
    damageMin: 18,
    damageMax: 28,
    scale: 1.0,
    ranged: false,
    meleeRange: 1.5,
    attackCooldown: 1.1,
    screams: true,
    screamCooldown: 7,
    screamRadius: 14,
    screamEnrageMs: 3500,
    screamEnrageMult: 1.5,
    summonOnDeath: 2,
    summonType: 'shambler',
    skinTones: [0x6e4a5e, 0x654258, 0x724f66],
    clothesTones: [0x22141c, 0x261620],
  },
  // Boss: weight 0 means it never enters the normal random-spawn pool -
  // ZombieManager force-spawns exactly one every few nights instead.
  colossus: {
    id: 'colossus',
    label: 'Colossus',
    lore: 'Whatever they were testing scaled up. Way up.',
    weight: 0,
    health: 900,
    speedMin: 0.55,
    speedMax: 0.75,
    damageMin: 90,
    damageMax: 140,
    scale: 2.4,
    ranged: false,
    meleeRange: 2.8,
    attackCooldown: 1.8,
    skinTones: [0x1a2530, 0x16202a, 0x1c2732],
    clothesTones: [0x0a0d10, 0x0d1013],
  },
  // Native to the sewer biome (see World.js's buildSewer) - just added to
  // the normal weighted pool with a small weight rather than a dedicated
  // spawn-zone system, so it can turn up anywhere, not only down there.
  sewer_dweller: {
    id: 'sewer_dweller',
    label: 'Sewer Dweller',
    lore: 'Never saw the outbreak on the surface. Never needed to.',
    weight: 1.5,
    health: 45,
    speedMin: 3.2,
    speedMax: 4.4,
    damageMin: 30,
    damageMax: 46,
    scale: 0.95,
    ranged: false,
    meleeRange: 1.4,
    attackCooldown: 0.75,
    skinTones: [0x3a4a2a, 0x334020, 0x2e3a1c],
    clothesTones: [0x141a10, 0x181f12],
  },
  // Releases a lingering toxic gas hazard zone on death (see Game.js's
  // _onZombieKilled -> _spawnHazardZone('gas', ...), the same hazard-zone
  // system the gas/EMP night-event zones already use) - distinct from
  // exploder/spitter_bomber's INSTANT burst-radius damage: this is area
  // denial that lingers and ticks over time, punishing fighting it in a
  // tight corridor rather than punishing getting close when it dies.
  fester: {
    id: 'fester',
    label: 'Fester',
    lore: "It's not the bite you have to worry about. It's what's still inside it when it stops moving.",
    weight: 1.5,
    health: 65,
    speedMin: 1.2,
    speedMax: 1.8,
    damageMin: 30,
    damageMax: 45,
    scale: 1.15,
    ranged: false,
    meleeRange: 1.6,
    attackCooldown: 1.2,
    gasOnDeath: true,
    skinTones: [0x8a9c3a, 0x7d8e30, 0x94a844],
    clothesTones: [0x3a3a18, 0x333312, 0x363612],
  },
  // Closes fast once in range rather than covering it all at normal walk
  // speed - see Zombie.js's leaps handling in _updateMelee.
  leaper: {
    id: 'leaper',
    label: 'Leaper',
    lore: 'It stopped bothering to close the last few meters on foot.',
    weight: 2.5,
    health: 40,
    speedMin: 1.6,
    speedMax: 2.2,
    damageMin: 28,
    damageMax: 42,
    scale: 0.95,
    ranged: false,
    leaps: true,
    leapRange: 6,
    leapCooldown: 3.5,
    meleeRange: 1.4,
    attackCooldown: 0.9,
    skinTones: [0x4a4030, 0x423a2a, 0x504636],
    clothesTones: [0x1a1610, 0x1e1913],
  },
  // Heals over time unless it's currently on fire - see Zombie.js's
  // regenerates handling right alongside _tickIgnite.
  regenerator: {
    id: 'regenerator',
    label: 'Regenerator',
    lore: "Whatever's keeping it standing keeps stitching it back together too. Burn it before it catches up.",
    weight: 2,
    health: 70,
    speedMin: 1.1,
    speedMax: 1.5,
    damageMin: 26,
    damageMax: 40,
    scale: 1.05,
    ranged: false,
    regenerates: true,
    regenPerSec: 4,
    meleeRange: 1.5,
    attackCooldown: 1.0,
    skinTones: [0x5a3a3a, 0x4e3232, 0x633f3f],
    clothesTones: [0x1c1010, 0x201212],
  },
  // Mostly-transparent until the player closes to revealRadius - see
  // Zombie.js's stealthy handling (per-frame opacity ramp).
  stalker: {
    id: 'stalker',
    label: 'Stalker',
    lore: "You won't see it until it wants you to.",
    weight: 2,
    health: 36,
    speedMin: 1.4,
    speedMax: 1.9,
    damageMin: 30,
    damageMax: 46,
    scale: 0.92,
    ranged: false,
    stealthy: true,
    revealRadius: 9,
    meleeRange: 1.4,
    attackCooldown: 0.95,
    skinTones: [0x33363a, 0x2c2f33, 0x3a3d42],
    clothesTones: [0x121315, 0x161719],
  },
  // Drops a damaging puddle on a cooldown while alive and moving - distinct
  // from Fester's one-shot gasOnDeath - see Zombie.js's leavesTrail (onTrail
  // callback, mirrors screams/onScream) and Game.js's 'acid' hazard zone.
  acid_trail: {
    id: 'acid_trail',
    label: 'Seeper',
    lore: "It doesn't need to catch you. Just needs you to keep standing where it's already been.",
    weight: 1.5,
    health: 48,
    speedMin: 0.9,
    speedMax: 1.3,
    damageMin: 24,
    damageMax: 36,
    scale: 1.0,
    ranged: false,
    leavesTrail: true,
    trailIntervalMs: 1800,
    meleeRange: 1.5,
    attackCooldown: 1.1,
    skinTones: [0x4a5a2a, 0x3e4c22, 0x546432],
    clothesTones: [0x141a0c, 0x181f0e],
  },
  // Ranged, but its spit pulls the player toward it instead of dealing
  // damage - see ZombieManager's projectile 'pull' effect.
  anchor: {
    id: 'anchor',
    label: 'Anchor',
    lore: "It gave up chasing. Now it just makes sure you can't leave either.",
    weight: 1.5,
    health: 55,
    speedMin: 0.8,
    speedMax: 1.1,
    damageMin: 8,
    damageMax: 14,
    scale: 1.1,
    ranged: true,
    pullsPlayer: true,
    engageRange: 14,
    retreatRange: 6,
    spitCooldown: 3.2,
    spitTravelSpeed: 10,
    skinTones: [0x3a3a44, 0x33333c, 0x40404a],
    clothesTones: [0x121218, 0x16161c],
  },
  // Takes bonus damage from everything, and detonates into damaging
  // shrapnel specifically when the finishing blow is melee - see Zombie.js's
  // fragile/shatterOnMelee handling (reuses the exploder's own burst path).
  brittle: {
    id: 'brittle',
    label: 'Brittle',
    lore: 'Dry as kindling. Shatter it up close and step back.',
    weight: 2,
    health: 30,
    speedMin: 1.3,
    speedMax: 1.8,
    damageMin: 22,
    damageMax: 34,
    scale: 0.98,
    ranged: false,
    fragile: true,
    fragileDamageMult: 1.6,
    shatterOnMelee: true,
    explodeRadius: 4,
    explodeDamageMin: 30,
    explodeDamageMax: 60,
    meleeRange: 1.4,
    attackCooldown: 0.9,
    skinTones: [0x8c8272, 0x7d7466, 0x968c7c],
    clothesTones: [0x2a251c, 0x2e2820],
  },
  // Ranged, but its spit disorients (screen shake/vignette) instead of
  // dealing real damage - see ZombieManager's projectile 'disorient' effect.
  siren: {
    id: 'siren',
    label: 'Siren',
    lore: 'The sound gets in before it does. By then your aim is already gone.',
    weight: 1.5,
    health: 45,
    speedMin: 0.9,
    speedMax: 1.2,
    damageMin: 6,
    damageMax: 10,
    scale: 1.0,
    ranged: true,
    disorients: true,
    engageRange: 16,
    retreatRange: 8,
    spitCooldown: 4.5,
    spitTravelSpeed: 16,
    skinTones: [0x5a4058, 0x4e364c, 0x634764],
    clothesTones: [0x1a1219, 0x1e141d],
  },
  // Ignores Dead Silence's aggro-radius reduction entirely (see Perks.js) -
  // see ZombieManager's ignoresStealth handling in the wandering-horde check.
  bloodhound: {
    id: 'bloodhound',
    label: 'Bloodhound',
    lore: "Dead Silence doesn't mean dead scent.",
    weight: 2,
    health: 34,
    speedMin: 2.6,
    speedMax: 3.4,
    damageMin: 24,
    damageMax: 36,
    scale: 0.88,
    ranged: false,
    ignoresStealth: true,
    meleeRange: 1.3,
    attackCooldown: 0.8,
    skinTones: [0x463c30, 0x3c3328, 0x4f4438],
    clothesTones: [0x171310, 0x1b1712],
  },
  // Ranged, but its spit plants a slowing web patch on the ground instead of
  // dealing damage - see ZombieManager's projectile 'web' effect and Game.js's
  // 'web' hazard zone (PlayerController's webSlowMult).
  webber: {
    id: 'webber',
    label: 'Webber',
    lore: "It doesn't want to eat you where you're standing. It wants you to still be there in ten seconds.",
    weight: 1.5,
    health: 44,
    speedMin: 1.0,
    speedMax: 1.4,
    damageMin: 5,
    damageMax: 8,
    scale: 0.95,
    ranged: true,
    plantsWeb: true,
    engageRange: 13,
    retreatRange: 7,
    spitCooldown: 3.8,
    spitTravelSpeed: 11,
    skinTones: [0x40453a, 0x383c32, 0x484e42],
    clothesTones: [0x14170f, 0x181b12],
  },
  // Heals itself off a fraction of every successful hit it lands - see
  // Zombie.js's lifesteal handling right alongside _updateMelee's onAttack.
  vampire: {
    id: 'vampire',
    label: 'Vampire',
    lore: 'Feeding is the only thing it still does on purpose.',
    weight: 2,
    health: 55,
    speedMin: 1.3,
    speedMax: 1.8,
    damageMin: 26,
    damageMax: 38,
    scale: 1.0,
    ranged: false,
    lifesteal: true,
    lifestealFraction: 0.5,
    meleeRange: 1.5,
    attackCooldown: 1.0,
    skinTones: [0x4a1c1c, 0x3e1616, 0x542020],
    clothesTones: [0x160808, 0x1a0a0a],
  },
  // Second boss-night type, alternating with colossus (see ZombieManager's
  // _spawnBoss and bossRushSpawnCount) - the slot patient_zero used to fill
  // before it was removed. Ties directly to Stage 11's toxic sewer level:
  // addType points _spawnBossAdds at sewer_dweller instead of the default
  // shambler, so its reinforcements read as "it's the source of the ones
  // down there" rather than generic boss-adds. No special rig (no dinosaur-
  // style flag) - same procedural humanoid body every non-titan zombie
  // already uses, just bigger and recolored, same as colossus itself.
  broodmother: {
    id: 'broodmother',
    label: 'Broodmother',
    lore: 'Every sewer dweller down there came from somewhere. This is the somewhere.',
    weight: 0,
    health: 1000,
    speedMin: 0.45,
    speedMax: 0.6,
    damageMin: 70,
    damageMax: 100,
    scale: 2.5,
    ranged: false,
    meleeRange: 2.6,
    attackCooldown: 2,
    addType: 'sewer_dweller',
    skinTones: [0x3a5a1a, 0x2e4a16, 0x445a2a],
    clothesTones: [0x141a10, 0x1a2010],
  },
  // Rare roaming threat, distinct from the night-scheduled bosses above -
  // see ZombieManager's _maybeSpawnTitan, which rolls a random chance on
  // its own timer rather than a fixed night number, so it can catch the
  // player off guard mid-run instead of always being anticipated. Reptilian
  // build (see Zombie.js's cfg.dinosaur branches: tiny arms, a tail, an
  // elongated jaw, no hood/hair) instead of the usual humanoid rig.
  titan: {
    id: 'titan',
    label: 'Dinosaur',
    lore: "VIREO stopped documenting after this one. There's only the one entry: DO NOT REPEAT.",
    weight: 0,
    health: 1400,
    speedMin: 1.1,
    speedMax: 1.3,
    damageMin: 110,
    damageMax: 160,
    scale: 3.4,
    ranged: false,
    meleeRange: 3.2,
    attackCooldown: 1.6,
    dinosaur: true,
    skinTones: [0x3a4a1e, 0x2e3a18, 0x445222],
    clothesTones: [0x1f2a10, 0x263012],
  },
}

// Phase 3 of multiplayer (docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md)
// plus Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md,
// which added shielded/screamer/stalker/burrower) - these types are shared
// across a session; everything else (ranged attackers, anything that
// explodes/gasses on death, scream-summoners like screamer_swarmer, and
// every boss tier) stays an independent per-player fight for now. See
// those specs' "Scope for this phase" sections for the reasoning behind
// each exclusion.
export const SHARED_ZOMBIE_TYPE_IDS = new Set([
  'feral_dog', 'feral_child', 'shambler', 'runner', 'brute',
  'crawler', 'sewer_dweller', 'leaper', 'regenerator', 'bloodhound', 'vampire',
  'shielded', 'screamer', 'stalker', 'burrower',
])

// Cached once at module load rather than rebuilt (Object.values + reduce)
// on every single call - this runs once per zombie spawn, which during a
// horde/wandering-horde burst can be many times in one frame.
const ZOMBIE_TYPE_ENTRIES = Object.values(ZOMBIE_TYPES)
const ZOMBIE_TYPE_BASE_WEIGHT_TOTAL = ZOMBIE_TYPE_ENTRIES.reduce((sum, t) => sum + t.weight, 0)

// featuredId/featuredMult (see the Featured Enemy mutator, ZombieManager's
// featuredEnemyId) - both default to a no-op so every existing call site
// (just calling pickZombieType() with no args) rolls exactly as before.
export function pickZombieType(featuredId = null, featuredMult = 1) {
  let total = ZOMBIE_TYPE_BASE_WEIGHT_TOTAL
  if (featuredId !== null && featuredMult !== 1) {
    const featured = ZOMBIE_TYPES[featuredId]
    if (featured) total += featured.weight * (featuredMult - 1)
  }
  let roll = Math.random() * total
  for (const t of ZOMBIE_TYPE_ENTRIES) {
    roll -= t.id === featuredId ? t.weight * featuredMult : t.weight
    if (roll <= 0) return t
  }
  return ZOMBIE_TYPE_ENTRIES[0]
}
