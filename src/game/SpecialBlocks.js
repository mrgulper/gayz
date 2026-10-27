// The special blocks (2026-10-27, Gaymi: "make the gayz game more blocks
// like special blocks like the bell ... give 100-200 new special blocks").
// Each one DOES something while you try or play the map - the effects
// live in BuildSpecials.js, keyed by `fx.kind`. This file is just the
// list: name, a one-line description (shown in the block picker), its
// picture (`look`, SpecialGlyphs.js) and its settings (`fx`).
//
// They join BLOCK_TYPES as game blocks: the picker's Special category,
// no slab/stairs, not broken or burned while playing (like the Loot
// Chest and Zombie Spawner). Names and descriptions are English, like
// every other block name. Built in batches - see docs/notes/special-blocks.md.

const D = { pattern: 'speckle', roughness: 0.85, metalness: 0, game: true, special: true }

export const SPECIAL_BLOCKS = [
  // ---- Batch 1: the starters ----
  {
    ...D, id: 'alarmbell', name: 'Alarm Bell', color: 0xc9a23a,
    desc: 'Use it to ring it: every zombie within 40 blocks runs to the bell for 15 seconds.',
    look: { base: 'metal', color: 0x4a4048, glyph: 'bell', glyphColor: 0xe8c14a },
    fx: { kind: 'lure', on: 'use', r: 40, time: 15, cd: 20, sound: 'bell' },
  },
  {
    ...D, id: 'zombierepeller', name: 'Zombie Repeller', color: 0x3aa6c9, emissive: 0x40c8ff, emissiveIntensity: 0.15,
    desc: 'Zombies can\'t come closer than 5 blocks to it.',
    look: { base: 'metal', color: 0x5a6670, glyph: 'shield', glyphColor: 0x58d0ff },
    fx: { kind: 'repel', r: 5 },
  },
  {
    ...D, id: 'baitblock', name: 'Bait Block', color: 0xb5452e,
    desc: 'Smells like meat: zombies within 14 blocks go for it instead of you.',
    look: { base: 'meat', color: 0xb5452e, glyph: 'meat', glyphColor: 0x8a2a1c },
    fx: { kind: 'lure', on: 'always', r: 14 },
  },
  {
    ...D, id: 'spikeblock', name: 'Spike Block', color: 0x8a8a90,
    desc: 'Hurts zombies standing on or against it (and you, if you stand on it while playing).',
    look: { base: 'metal', color: 0x55555c, glyph: 'cross', glyphColor: 0xb8b8c0, top: 'spikes' },
    fx: { kind: 'spikes', zdps: 25, pdps: 8 },
  },
  {
    ...D, id: 'reinforcedbarricade', name: 'Reinforced Barricade', color: 0x7a5a38,
    desc: 'A wall that can\'t be broken while playing. Zombies that bump into it get shoved back.',
    look: { base: 'wood', color: 0x8a6239, glyph: 'cross', glyphColor: 0x6a6a70 },
    fx: { kind: 'shove', r: 1.25, push: 6 },
  },
  {
    ...D, id: 'campfire', name: 'Campfire', color: 0xe07a2a, emissive: 0xff8a30, emissiveIntensity: 0.4,
    desc: 'Heals you 4 health a second while you stand within 3 blocks. Zombies that touch it catch fire.',
    look: { base: 'stone', color: 0x6a645e, glyph: 'flame', glyphColor: 0xf28a2a },
    fx: { kind: 'campfire', r: 3, heal: 4 },
  },
  {
    ...D, id: 'teleporterpad', name: 'Teleporter Pad', color: 0x9a5ae0, shape: 'pad', emissive: 0xb070ff, emissiveIntensity: 0.3,
    desc: 'Step on it to jump to the nearest other Teleporter Pad. Place two to link them.',
    look: { base: 'glow', color: 0x3a2a5a, glyph: 'portal', glyphColor: 0xc08aff },
    fx: { kind: 'teleport', cd: 1.5 },
  },
  {
    ...D, id: 'cropplot', name: 'Crop Plot', color: 0x6b4a30,
    desc: 'Use it to plant seeds; after 45 seconds use it again to harvest vegetables (eat them to heal).',
    look: { base: 'stone', color: 0x6b4a30, glyph: null, topBase: 'soil', topColor: 0x5a3c26, top: null },
    fx: { kind: 'crop', grow: 45, give: 'veggies', n: 2 },
  },
  {
    ...D, id: 'discoblock', name: 'Disco Block', color: 0xd05ac0, emissive: 0xffffff, emissiveIntensity: 0.12,
    desc: 'Flashes through rainbow colours while you try or play the map.',
    look: { base: 'disco', color: 0xffffff, glyph: null },
    fx: { kind: 'disco' },
  },
  {
    ...D, id: 'scoreboard', name: 'Scoreboard', color: 0x2a2a30,
    desc: 'Shows the wave and your kills above it while playing (your best wave on this map otherwise).',
    look: { base: 'metal', color: 0x2a2a30, glyph: 'board', glyphColor: 0x6ae06a },
    fx: { kind: 'score' },
  },

  // ---- Batch 2: sound and alerts ----
  {
    ...D, id: 'sirentower', name: 'Siren Tower', color: 0xd04040, emissive: 0xff3030, emissiveIntensity: 0.12,
    desc: 'Use it to wail: every zombie within 80 blocks heads to it for 25 seconds.',
    look: { base: 'metal', color: 0x8a2a2a, glyph: 'siren', glyphColor: 0xffd040 },
    fx: { kind: 'lure', on: 'use', r: 80, time: 25, cd: 60, sound: 'siren' },
  },
  {
    ...D, id: 'tripwirechime', name: 'Tripwire Chime', color: 0xb8a070,
    desc: 'Jingles and warns you when a zombie walks within 3 blocks of it.',
    look: { base: 'wood', color: 0x7a5a38, glyph: 'chime', glyphColor: 0xe8d070 },
    fx: { kind: 'tripwire', r: 3, cd: 4 },
  },
  {
    ...D, id: 'windchime', name: 'Wind Chime', color: 0x8ab0c0,
    desc: 'Tinkles softly when you\'re near it, and rattles a warning when zombies are within 12 blocks.',
    look: { base: 'wood', color: 0x9a7a52, glyph: 'chime', glyphColor: 0xa8d8f0 },
    fx: { kind: 'windchime', hear: 16, warn: 12 },
  },
  {
    ...D, id: 'doorbell', name: 'Doorbell', color: 0xd8c898,
    desc: 'Use it for a ding-dong - and the doors near it open for 3 seconds.',
    look: { base: 'stone', color: 0xc8b890, glyph: 'button', glyphColor: 0xe8c14a },
    fx: { kind: 'doorbell', open: 3, cd: 2 },
  },
  {
    ...D, id: 'megaphone', name: 'Megaphone Post', color: 0xe0e0e0,
    desc: 'Use it to shout HEY!: zombies within 25 blocks come to it for 8 seconds.',
    look: { base: 'metal', color: 0x6a6a72, glyph: 'megaphone', glyphColor: 0xf0f0f0 },
    fx: { kind: 'lure', on: 'use', r: 25, time: 8, cd: 15, sound: 'shout', label: 'specialHey' },
  },
  {
    ...D, id: 'radioblock', name: 'Radio', color: 0x5a4a3a,
    desc: 'Use it to switch between 3 stations and off. It plays music while you\'re near.',
    look: { base: 'wood', color: 0x6b4a30, glyph: 'radio', glyphColor: 0xd8c8a0 },
    fx: { kind: 'radio', stations: 3, every: 2.4, hear: 20 },
  },
  {
    ...D, id: 'echostone', name: 'Echo Stone', color: 0x8090a8,
    desc: 'Repeats your gunshots when you fire within 10 blocks - zombies within 20 go to the echo for 3 seconds.',
    look: { base: 'stone', color: 0x707888, glyph: 'waves', glyphColor: 0xb0c8ff },
    fx: { kind: 'echo', hear: 10, delay: 0.5, r: 20, time: 3 },
  },
  {
    ...D, id: 'silenceblock', name: 'Silence Block', color: 0x2a2a3a,
    desc: 'While you\'re within 6 blocks of it, zombies more than 12 blocks away can\'t hear you and stop chasing.',
    look: { base: 'stone', color: 0x34344a, glyph: 'mute', glyphColor: 0x9a9ac8 },
    fx: { kind: 'silence', r: 6, hear: 12 },
  },
  {
    ...D, id: 'hornblock', name: 'Horn Block', color: 0xe0b040,
    desc: 'Use it for a HONK that blows zombies within 8 blocks 5 blocks back.',
    look: { base: 'metal', color: 0x5a5a62, glyph: 'horn', glyphColor: 0xf0c040 },
    fx: { kind: 'horn', r: 8, push: 5, cd: 6 },
  },
  {
    ...D, id: 'pianoblock', name: 'Piano Block', color: 0xf0f0f0,
    desc: 'Plays a note when you step on it or use it. Each spot is a different note - put a row down to play a tune.',
    look: { base: 'piano', color: 0xf4f2ea, glyph: null },
    fx: { kind: 'piano' },
  },

  // ---- Batch 3: zombie control ----
  {
    ...D, id: 'garlicblock', name: 'Garlic Block', color: 0xece4d0,
    desc: 'Zombies within 3 blocks of it move at half speed.',
    look: { base: 'stone', color: 0xd8d0b8, glyph: 'garlic', glyphColor: 0xf4f0e4 },
    fx: { kind: 'zaura', r: 3, slow: 0.5, tint: 0xf0ecd0 },
  },
  {
    ...D, id: 'holylantern', name: 'Holy Lantern', color: 0xfff0a0, emissive: 0xfff0b0, emissiveIntensity: 0.45,
    desc: 'Zombies within 5 blocks of its light lose 6 health a second.',
    look: { base: 'glow', color: 0xf0d870, glyph: 'cross', glyphColor: 0xfffbe0 },
    fx: { kind: 'zaura', r: 5, dps: 6, tint: 0xfff0a0 },
  },
  {
    ...D, id: 'cageblock', name: 'Cage', color: 0x50505a,
    desc: 'Traps the first zombie that touches it for 6 seconds, then needs 10 seconds to reset.',
    look: { base: 'metal', color: 0x3a3a42, glyph: 'bars', glyphColor: 0x9a9aa8 },
    fx: { kind: 'trap', hold: 6, cd: 10 },
  },
  {
    ...D, id: 'zombiecounter', name: 'Zombie Counter', color: 0x2a3a2a,
    desc: 'Shows how many zombies are within 24 blocks of it, floating above it.',
    look: { base: 'metal', color: 0x2a3a2a, glyph: 'skull', glyphColor: 0x8af08a },
    fx: { kind: 'counter', r: 24 },
  },
  {
    ...D, id: 'fakeplayer', name: 'Fake Player', color: 0x5a7ab0,
    desc: 'A dummy that looks like a person: zombies within 20 blocks chase it instead of you.',
    look: { base: 'wood', color: 0x6a6a8a, glyph: 'person', glyphColor: 0xf0c8a0 },
    fx: { kind: 'lure', on: 'always', r: 20 },
  },
  {
    ...D, id: 'graveblock', name: 'Grave', color: 0x6a6a70,
    desc: 'At night, a zombie climbs out of it about every 30 seconds while you play (each one counts toward the wave).',
    look: { base: 'stone', color: 0x6a6a70, glyph: 'tomb', glyphColor: 0x9a9aa2, topBase: 'soil', topColor: 0x5a3c26, top: null },
    fx: { kind: 'grave', every: 30, cap: 28 },
  },
  {
    ...D, id: 'infectioncleanser', name: 'Infection Cleanser', color: 0x60e0b0, emissive: 0x60ffc0, emissiveIntensity: 0.2,
    desc: 'Use it to be fully protected from every hit for 8 seconds. Recharges in 90 seconds.',
    look: { base: 'glow', color: 0x2a8a6a, glyph: 'plus', glyphColor: 0xd0fff0 },
    fx: { kind: 'cleanser', time: 8, cd: 90 },
  },
  {
    ...D, id: 'wavebell', name: 'Wave Bell', color: 0xa07ad0,
    desc: 'Ring it between waves to start the next wave right away, for 10 bonus coins.',
    look: { base: 'metal', color: 0x4a3a5a, glyph: 'bell', glyphColor: 0xc8a0f0 },
    fx: { kind: 'wavebell', coins: 10, cd: 3 },
  },
  {
    ...D, id: 'cursedblock', name: 'Cursed Block', color: 0x5a1a4a, emissive: 0x9a2080, emissiveIntensity: 0.15,
    desc: 'Zombies that come within 8 blocks get half again as much health, but each one you kill pays 2 extra coins.',
    look: { base: 'stone', color: 0x3a1a34, glyph: 'skull', glyphColor: 0xd04ab0 },
    fx: { kind: 'zaura', r: 8, curse: 1.5, coins: 2, tint: 0xd04ab0 },
  },
  {
    ...D, id: 'timeslow', name: 'Time Slow Block', color: 0x4a7ad0, emissive: 0x6090ff, emissiveIntensity: 0.15,
    desc: 'Zombies within 7 blocks of it move at less than half speed.',
    look: { base: 'glow', color: 0x2a3a6a, glyph: 'clock', glyphColor: 0x9ac0ff },
    fx: { kind: 'zaura', r: 7, slow: 0.4, tint: 0x9ac0ff },
  },

  // ---- Batch 4: traps ----
  {
    ...D, id: 'beartrap', name: 'Bear Trap', color: 0x6a6a72, shape: 'pad',
    desc: 'A zombie that steps on it takes 20 damage and is held for 5 seconds. Resets after 8 seconds.',
    look: { base: 'metal', color: 0x5a5a62, glyph: 'jaws', glyphColor: 0xc8c8d0 },
    fx: { kind: 'trap', hold: 5, dmg: 20, cd: 8 },
  },
  {
    ...D, id: 'trapdoorpit', name: 'Trapdoor Pit', color: 0x7a5a38,
    desc: 'A zombie that walks onto it drops into the spikes underneath: 60 damage. Resets after 6 seconds.',
    look: { base: 'wood', color: 0x7a5a38, glyph: 'hatch', glyphColor: 0x4a3a2a },
    fx: { kind: 'trap', hold: 1.5, dmg: 60, cd: 6, sound: 'thud' },
  },
  {
    ...D, id: 'firetrap', name: 'Fire Trap', color: 0xc85a2a,
    desc: 'Sets any zombie that touches it on fire. Recharges in 4 seconds.',
    look: { base: 'stone', color: 0x5a4a44, glyph: 'flame', glyphColor: 0xff6a20 },
    fx: { kind: 'trap', burn: 6, cd: 4, sound: 'whoosh' },
  },
  {
    ...D, id: 'stickyfloor', name: 'Sticky Floor', color: 0xb0d040,
    desc: 'Zombies on or against it crawl at a third of their speed. You walk at half speed on it too.',
    look: { base: 'stone', color: 0x8aa83a, glyph: 'drip', glyphColor: 0xd8f070 },
    fx: { kind: 'sticky', zspeed: 0.3, pspeed: 0.5 },
  },
  {
    ...D, id: 'swingingblade', name: 'Swinging Blade', color: 0x9a9aa2,
    desc: 'A blade spins over it, hitting every zombie within 2 blocks for 30 damage once a second.',
    look: { base: 'metal', color: 0x4a4a52, glyph: 'blade', glyphColor: 0xd8dce4 },
    fx: { kind: 'blade', r: 2, dmg: 30, every: 1 },
  },
  {
    ...D, id: 'landmine', name: 'Mine', color: 0x4a5a3a, shape: 'pad',
    desc: 'Blows up when a zombie steps on it: 80 damage to every zombie within 3 blocks. Re-arms after 15 seconds.',
    look: { base: 'metal', color: 0x4a5a3a, glyph: 'mine', glyphColor: 0xd04030 },
    fx: { kind: 'trap', blast: 3, dmg: 80, cd: 15 },
  },
  {
    ...D, id: 'netlauncher', name: 'Net Launcher', color: 0xb0a070,
    desc: 'Fires a net at the nearest zombie within 8 blocks, holding it for 3 seconds. Reloads in 8 seconds.',
    look: { base: 'wood', color: 0x6b4a30, glyph: 'net', glyphColor: 0xe0d8b0 },
    fx: { kind: 'net', r: 8, hold: 3, cd: 8 },
  },
  {
    ...D, id: 'crumbleblock', name: 'Crumble Block', color: 0xa89878,
    desc: 'Falls away a moment after you stand on it, and comes back 5 seconds later.',
    look: { base: 'stone', color: 0xa89878, glyph: 'cracks', glyphColor: 0x6a5a44 },
    fx: { kind: 'crumble', after: 0.8, back: 5 },
  },
  {
    ...D, id: 'iceslick', name: 'Ice Slick', color: 0xb0e0ff,
    desc: 'Zombies on or against it slip and fall over every few seconds. It\'s slippery for you too.',
    look: { base: 'glow', color: 0x9ad0f0, glyph: null },
    fx: { kind: 'ice', every: 4, fall: 1.5, pgrip: 0.12 },
  },
  {
    ...D, id: 'flamejet', name: 'Flame Jet Floor', color: 0x8a4a2a,
    desc: 'Shoots flames for 1 second out of every 3: zombies on or against it catch fire, and standing on it then hurts you.',
    look: { base: 'metal', color: 0x4a3a34, glyph: 'grate', glyphColor: 0xff8a30 },
    fx: { kind: 'flamejet', every: 3, on: 1, burn: 5, pdps: 6 },
  },
]

export const SPECIAL_BY_ID = new Map(SPECIAL_BLOCKS.map((b) => [b.id, b]))
