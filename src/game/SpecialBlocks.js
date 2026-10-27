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

  // ---- Batch 5: defence ----
  {
    ...D, id: 'smokebomb', name: 'Smoke Bomb Block', color: 0x7a7a80,
    desc: 'Use it for a cloud of smoke 5 blocks wide for 10 seconds: zombies outside it can\'t see you inside it. Recharges in 30 seconds.',
    look: { base: 'metal', color: 0x4a4a50, glyph: 'cloud', glyphColor: 0xc8c8d0 },
    fx: { kind: 'smoke', r: 5, time: 10, cd: 30 },
  },
  {
    ...D, id: 'soundtrap', name: 'Sound Trap', color: 0x8a6a3a,
    desc: 'Makes noises that pull zombies within 16 blocks to it - the first to reach it is caged for 4 seconds.',
    look: { base: 'wood', color: 0x6a4a2a, glyph: 'waves', glyphColor: 0xf0c060 },
    fx: { kind: 'lure', on: 'always', r: 16, trap: true, hold: 4, cd: 6 },
  },
  {
    ...D, id: 'shieldgen', name: 'Shield Generator', color: 0x3a8ad0, emissive: 0x60b8ff, emissiveIntensity: 0.2,
    desc: 'Use it for a bubble 4 blocks wide that zombies can\'t get into for 12 seconds. Recharges in 60 seconds.',
    look: { base: 'glow', color: 0x24466a, glyph: 'shield', glyphColor: 0x80d0ff },
    fx: { kind: 'shieldgen', r: 4, time: 12, cd: 60 },
  },
  {
    ...D, id: 'barbedwire', name: 'Barbed Wire', color: 0x8a8a8a,
    desc: 'Zombies pushing past it slow down and lose 5 health a second.',
    look: { base: 'wood', color: 0x5a4a3a, glyph: 'wire', glyphColor: 0xb0b0b8 },
    fx: { kind: 'wire', zspeed: 0.6, zdps: 5 },
  },
  {
    ...D, id: 'sandbag', name: 'Sandbag', color: 0xc8b080,
    desc: 'Crouch right next to it and zombies\' hits do 40% less damage to you.',
    look: { base: 'stone', color: 0xb8a070, glyph: 'sacks', glyphColor: 0x5a4424 },
    fx: { kind: 'sandbag', r: 1.6, mult: 0.6 },
  },
  {
    ...D, id: 'watchtower', name: 'Watchtower Base', color: 0x8a6a48,
    desc: 'Stack blocks on top of it, then use it to climb straight up to the top of the stack.',
    look: { base: 'wood', color: 0x7a5a38, glyph: 'arrowup', glyphColor: 0xf0d8a0 },
    fx: { kind: 'watchtower', cd: 1 },
  },
  {
    ...D, id: 'oilpot', name: 'Boiling Oil Pot', color: 0x3a3a3a,
    desc: 'Use it to tip boiling oil: zombies within 4 blocks at or below it take 60 damage and catch fire. Refills in 20 seconds.',
    look: { base: 'metal', color: 0x2e2e32, glyph: 'pot', glyphColor: 0xe0a030 },
    fx: { kind: 'oilpot', r: 4, dmg: 60, burn: 4, cd: 20 },
  },
  {
    ...D, id: 'cannonblock', name: 'Cannon', color: 0x3a3a40,
    desc: 'Stand behind it and use it: it fires away from you, hitting every zombie along 24 blocks for 100 damage. Reloads in 8 seconds.',
    look: { base: 'metal', color: 0x3a3a40, glyph: 'cannon', glyphColor: 0x9a9aa2 },
    fx: { kind: 'cannon', range: 24, width: 1.2, dmg: 100, cd: 8 },
  },
  {
    ...D, id: 'catapult', name: 'Catapult', color: 0x8a6a40,
    desc: 'Stand behind it and use it: it throws a boulder 20 blocks away that hits zombies within 3 blocks of where it lands for 80 damage. Reloads in 12 seconds.',
    look: { base: 'wood', color: 0x8a6a40, glyph: 'boulder', glyphColor: 0x8a8a8a },
    fx: { kind: 'catapult', range: 20, blast: 3, dmg: 80, cd: 12 },
  },
  {
    ...D, id: 'murderhole', name: 'Murder Hole', color: 0x6a6a6a,
    desc: 'A wall with a slit: zombies can\'t get through it, but your bullets fly straight through.',
    look: { base: 'stone', color: 0x707070, glyph: 'slit', glyphColor: 0x1a1a1a },
    fx: { kind: 'murderhole', shootThrough: true },
  },

  // ---- Batch 6: power ----
  // Power reaches blocks within 8 blocks of anything that's on (a lever
  // that's on and a pressed plate count too); doors near a power block
  // open while it's on.
  {
    ...D, id: 'generator', name: 'Generator', color: 0x5a6a3a,
    desc: 'Use it to switch it on or off. While on it powers machines within 8 blocks and opens the doors near it.',
    look: { base: 'metal', color: 0x4a5a32, glyph: 'bolt', glyphColor: 0xffe040 },
    fx: { kind: 'power', src: 'generator' },
  },
  {
    ...D, id: 'solarpanel', name: 'Solar Panel', color: 0x2a4a8a,
    desc: 'Gives power during the day (not at night).',
    look: { base: 'metal', color: 0x8a8a92, glyph: null, topBase: 'glow', topColor: 0x24448a, top: 'grid' , glyphColor: 0x8ab0ff },
    fx: { kind: 'power', src: 'solar' },
  },
  {
    ...D, id: 'wireblock', name: 'Wire', color: 0xc85a2a,
    desc: 'Carries power: a wire touching power (or a powered wire) is powered too. Lay a line of them to reach far machines.',
    look: { base: 'stone', color: 0x4a4a4a, glyph: 'wireline', glyphColor: 0xe07030 },
    fx: { kind: 'power', src: 'wire' },
  },
  {
    ...D, id: 'battery', name: 'Battery', color: 0x3a8a4a,
    desc: 'Charges from power near it and keeps giving power for 30 seconds after that power goes off.',
    look: { base: 'metal', color: 0x2a2a30, glyph: 'battery', glyphColor: 0x60d070 },
    fx: { kind: 'power', src: 'battery', hold: 30 },
  },
  {
    ...D, id: 'buttonblock', name: 'Button', color: 0xb03a3a,
    desc: 'Use it for a 1.5-second burst of power (opens nearby doors for a moment).',
    look: { base: 'stone', color: 0x8a8a8a, glyph: 'button', glyphColor: 0xd04040 },
    fx: { kind: 'power', src: 'button', pulse: 1.5 },
  },
  {
    ...D, id: 'timerblock', name: 'Timer', color: 0x8a7a3a,
    desc: 'Gives a 1-second burst of power every 5 seconds, on its own.',
    look: { base: 'metal', color: 0x5a5244, glyph: 'clock', glyphColor: 0xf0d070 },
    fx: { kind: 'power', src: 'timer', every: 5, pulse: 1 },
  },
  {
    ...D, id: 'motionsensor', name: 'Motion Sensor', color: 0x3a3a4a,
    desc: 'Gives power while you or a zombie are within 5 blocks of it.',
    look: { base: 'metal', color: 0x34343e, glyph: 'eye', glyphColor: 0xff5050 },
    fx: { kind: 'power', src: 'motion', r: 5 },
  },
  {
    ...D, id: 'lightsensor', name: 'Light Sensor', color: 0x6a5a9a,
    desc: 'Gives power at night (great for lights and night traps).',
    look: { base: 'metal', color: 0x3a3450, glyph: 'moon', glyphColor: 0xe8e0a0 },
    fx: { kind: 'power', src: 'light' },
  },
  {
    ...D, id: 'logicgate', name: 'Logic Gate', color: 0x2a5a5a,
    desc: 'Use it to switch between AND (on when 2+ power sources are near), OR (on with any) and NOT (on when none are).',
    look: { base: 'metal', color: 0x24444a, glyph: 'gate', glyphColor: 0x70e0d0 },
    fx: { kind: 'power', src: 'gate' },
  },
  {
    ...D, id: 'arrowshooter', name: 'Arrow Shooter', color: 0x7a6a50,
    desc: 'Needs power: shoots the nearest zombie it can see within 12 blocks once a second, for 15 damage.',
    look: { base: 'stone', color: 0x6a645a, glyph: 'arrow', glyphColor: 0xd8c890 },
    fx: { kind: 'arrows', r: 12, every: 1, dmg: 15 },
  },

  // ---- Batch 7: machines ----
  {
    ...D, id: 'electricfence', name: 'Electric Fence', color: 0x5a7aa0,
    desc: 'Needs power: zombies that touch it take 20 damage and are thrown 2 blocks back (once a second each).',
    look: { base: 'metal', color: 0x3a4a5a, glyph: 'bolt', glyphColor: 0x80c8ff },
    fx: { kind: 'efence', dmg: 20, push: 2, every: 1 },
  },
  {
    ...D, id: 'autoturret', name: 'Auto Turret', color: 0x4a4a52,
    desc: 'Shoots the nearest zombie it can see within 14 blocks twice a second (12 damage). Starts with 20 shots; use it to load 30 more from your ammo.',
    look: { base: 'metal', color: 0x3a3a42, glyph: 'crosshair', glyphColor: 0xffd060 },
    fx: { kind: 'turret', r: 14, every: 0.5, dmg: 12, start: 20, load: 30 },
  },
  {
    ...D, id: 'searchlight', name: 'Searchlight', color: 0xf0e8a0, emissive: 0xfff0b0, emissiveIntensity: 0.3,
    desc: 'Needs power: a beam sweeps round it, and zombies within 16 blocks take 25% more damage.',
    look: { base: 'metal', color: 0x5a5a62, glyph: 'sun', glyphColor: 0xfff0a0 },
    fx: { kind: 'searchlight', r: 16 },
  },
  {
    ...D, id: 'repairstation', name: 'Repair Station', color: 0x4a8a4a,
    desc: 'Puts back blocks broken within 8 blocks of it, one every 2 seconds, while you try or play the map.',
    look: { base: 'metal', color: 0x2e4a2e, glyph: 'wrench', glyphColor: 0x90f090 },
    fx: { kind: 'repair', r: 8, every: 2 },
  },
  {
    ...D, id: 'gateblock', name: 'Gate', color: 0x6a5a48,
    desc: 'Use it to open the whole gate (all the Gate blocks joined to it) for 5 seconds - or power it to keep it open.',
    look: { base: 'wood', color: 0x5a4632, glyph: 'bars', glyphColor: 0x8a8a92 },
    fx: { kind: 'gate', open: 5 },
  },
  {
    ...D, id: 'piston', name: 'Piston', color: 0x9a8a6a,
    desc: 'When its power comes on, it kicks zombies within 3 blocks 4 blocks away (and bumps you, if you\'re right next to it).',
    look: { base: 'wood', color: 0x8a7650, glyph: 'arrowup', glyphColor: 0x9a9aa2, topBase: 'metal', topColor: 0x8a8a92, top: null },
    fx: { kind: 'piston', r: 3, push: 4 },
  },
  {
    ...D, id: 'stickypiston', name: 'Sticky Piston', color: 0x7a9a5a,
    desc: 'When its power comes on, it yanks zombies within 6 blocks in toward it.',
    look: { base: 'wood', color: 0x8a7650, glyph: 'arrowup', glyphColor: 0x9ad070, topBase: 'jelly', topColor: 0x7ac050, top: null },
    fx: { kind: 'piston', r: 6, push: 6, pull: true },
  },
  {
    ...D, id: 'conveyorbelt', name: 'Conveyor Belt', color: 0x3a3a3a, shape: 'pad',
    desc: 'Carries you and zombies standing on it along the way it faces (the way you face when you place it).',
    look: { base: 'metal', color: 0x2a2a2e, glyph: 'chevron', glyphColor: 0xe0c040 },
    fx: { kind: 'conveyor', speed: 3 },
  },
  {
    ...D, id: 'fanpusher', name: 'Fan Pusher', color: 0x7a8a9a,
    desc: 'Needs power: blows zombies away until they\'re 6 blocks from it.',
    look: { base: 'metal', color: 0x4a5462, glyph: 'fan', glyphColor: 0xd0e0f0 },
    fx: { kind: 'fan', r: 6, push: 6, power: true },
  },
  {
    ...D, id: 'magnetblock', name: 'Magnet', color: 0xc03a3a,
    desc: 'Stand next to it and dropped items within 16 blocks of it fly to you.',
    look: { base: 'metal', color: 0x5a5a62, glyph: 'magnet', glyphColor: 0xd04040 },
    fx: { kind: 'magnet', r: 16, near: 3 },
  },

  // ---- Batch 8: healing and boosts ----
  {
    ...D, id: 'medstation', name: 'Med Station', color: 0xe8e8e8,
    desc: 'Use it to heal to full health. Refills in 90 seconds.',
    look: { base: 'metal', color: 0xe0e0e0, glyph: 'plus', glyphColor: 0xd03030 },
    fx: { kind: 'heal', full: true, cd: 90 },
  },
  {
    ...D, id: 'bedblock', name: 'Bed', color: 0xb03a3a,
    desc: 'Use it to sleep there: the next time you die in this game, you wake up on the bed with half your health instead (once).',
    look: { base: 'wood', color: 0x7a5a38, glyph: 'bed', glyphColor: 0xd04040, topBase: 'glow', topColor: 0xc83a3a, top: 'pillow' },
    fx: { kind: 'bed' },
  },
  {
    ...D, id: 'bandagebox', name: 'Bandage Box', color: 0xf0f0e8,
    desc: 'Use it to take a free Health Pack. One a minute.',
    look: { base: 'wood', color: 0xd8d0c0, glyph: 'plus', glyphColor: 0x3aa0e0 },
    fx: { kind: 'give', id: 'healthpack', key: 'invHealthPack', n: 1, cd: 60 },
  },
  {
    ...D, id: 'speedpad', name: 'Speed Pad', color: 0x30c0e0, shape: 'pad', emissive: 0x60e0ff, emissiveIntensity: 0.25,
    desc: 'Step on it to run almost twice as fast for 4 seconds.',
    look: { base: 'glow', color: 0x1a5a6a, glyph: 'chevron', glyphColor: 0x80f0ff },
    fx: { kind: 'boost', speed: 1.8, time: 4 },
  },
  {
    ...D, id: 'jumppad', name: 'Jump Pad', color: 0x70e040, shape: 'pad', emissive: 0x90ff60, emissiveIntensity: 0.25,
    desc: 'Step on it to be launched high into the air (about 4 blocks).',
    look: { base: 'glow', color: 0x2a5a1a, glyph: 'arrowup', glyphColor: 0xa0ff70 },
    fx: { kind: 'boost', jump: 16 },
  },
  {
    ...D, id: 'strengthtotem', name: 'Strength Totem', color: 0xc05030,
    desc: 'Use it for 30 seconds of 50% more damage. Recharges in 90 seconds.',
    look: { base: 'stone', color: 0x6a3a2a, glyph: 'fist', glyphColor: 0xff8050 },
    fx: { kind: 'buff', buff: 'damage', mult: 1.5, time: 30, cd: 90 },
  },
  {
    ...D, id: 'coffeemachine', name: 'Coffee Machine', color: 0x5a3a2a,
    desc: 'Use it for a coffee: 30% faster running for 20 seconds. Brews again in 60 seconds.',
    look: { base: 'metal', color: 0x3a3030, glyph: 'cup', glyphColor: 0xe8d8c0 },
    fx: { kind: 'buff', buff: 'speed', mult: 1.3, time: 20, cd: 60 },
  },
  {
    ...D, id: 'waterwell', name: 'Water Well', color: 0x5a7aa0,
    desc: 'Use it for a drink that heals 15 health. Every 20 seconds.',
    look: { base: 'stone', color: 0x7a7a80, glyph: 'drop', glyphColor: 0x5ab0f0, topBase: 'glow', topColor: 0x2a5a9a, top: null },
    fx: { kind: 'heal', heal: 15, cd: 20 },
  },
  {
    ...D, id: 'saunastone', name: 'Sauna Stone', color: 0x8a6a5a, emissive: 0xff7040, emissiveIntensity: 0.1,
    desc: 'Sit within 3 blocks of it to build up armor, up to 10 points (armor soaks up hits before your health).',
    look: { base: 'stone', color: 0x6a5a52, glyph: 'steam', glyphColor: 0xf0f0f0 },
    fx: { kind: 'sauna', r: 3, rate: 0.35, max: 10 },
  },
  {
    ...D, id: 'luckyclover', name: 'Lucky Clover Block', color: 0x40b050,
    desc: 'While you\'re within 8 blocks of it, every zombie you kill pays 2 extra coins.',
    look: { base: 'stone', color: 0x2e6a34, glyph: 'clover', glyphColor: 0x70e070 },
    fx: { kind: 'clover', r: 8, coins: 2 },
  },

  // ---- Batch 9: getting around ----
  {
    ...D, id: 'fanblock', name: 'Fan Block', color: 0x9ab0c0,
    desc: 'Blows you and zombies away from it, out to 4 blocks. No power needed.',
    look: { base: 'metal', color: 0x6a7a88, glyph: 'fan', glyphColor: 0xf0f8ff },
    fx: { kind: 'fan', r: 4, push: 3, you: true },
  },
  {
    ...D, id: 'elevatorblock', name: 'Elevator', color: 0x8a8a96,
    desc: 'Use it to go up to the next Elevator straight above it (or down, if there\'s none above).',
    look: { base: 'metal', color: 0x5a5a66, glyph: 'updown', glyphColor: 0xf0e060 },
    fx: { kind: 'elevator' },
  },
  {
    ...D, id: 'ziplinepost', name: 'Zipline Post', color: 0x8a6a48,
    desc: 'Use it to slide along a line to the nearest other Zipline Post within 40 blocks.',
    look: { base: 'wood', color: 0x7a5a38, glyph: 'zipline', glyphColor: 0xc8c8d0 },
    fx: { kind: 'zipline', r: 40, speed: 14 },
  },
  {
    ...D, id: 'bounceblock', name: 'Bounce Block', color: 0x70d0a0,
    desc: 'Bounces you back up when you land on it - the higher you fall from, the higher you go.',
    look: { base: 'jelly', color: 0x4ab080, glyph: 'arrowup', glyphColor: 0xc0ffe0 },
    fx: { kind: 'bounce', min: 11, keep: 0.9 },
  },
  {
    ...D, id: 'slideblock', name: 'Slide Block', color: 0xa0c8f0,
    desc: 'Super slippery and fast to run on.',
    look: { base: 'glow', color: 0x7aa8d8, glyph: 'chevron', glyphColor: 0xe0f0ff },
    fx: { kind: 'slide', pspeed: 1.4, pgrip: 0.15 },
  },
  {
    ...D, id: 'ropeanchor', name: 'Rope Anchor', color: 0xb08a50,
    desc: 'Put it at a ledge and use it to climb down the rope to the ground below.',
    look: { base: 'stone', color: 0x7a7a7a, glyph: 'rope', glyphColor: 0xd8b070 },
    fx: { kind: 'rope' },
  },
  {
    ...D, id: 'railtrack', name: 'Rail Track', color: 0x7a6a5a, shape: 'pad',
    desc: 'Carries you along at a run, the way it faces. Lay a line of them (turn them to make corners).',
    look: { base: 'wood', color: 0x5a4632, glyph: 'rails', glyphColor: 0xa0a0a8 },
    fx: { kind: 'conveyor', speed: 6, noZombies: true },
  },
  {
    ...D, id: 'launchcannon', name: 'Launch Cannon', color: 0xd06030,
    desc: 'Use it to be fired through the air the way you\'re looking.',
    look: { base: 'metal', color: 0x6a3a2a, glyph: 'cannon', glyphColor: 0xffb060 },
    fx: { kind: 'launcher', speed: 18, up: 13 },
  },
  {
    ...D, id: 'windtunnel', name: 'Wind Tunnel', color: 0xc0e0f0,
    desc: 'Floats you up the 8 blocks above it. Step off the side to come down.',
    look: { base: 'metal', color: 0x8aa0b0, glyph: 'grate', glyphColor: 0xe8f8ff, top: 'fan' },
    fx: { kind: 'tunnel', h: 8, lift: 6 },
  },
  {
    ...D, id: 'speedrail', name: 'Speed Rail', color: 0xd0a030, shape: 'pad',
    desc: 'A fast Rail Track: carries you along at nearly twice its speed.',
    look: { base: 'metal', color: 0x4a4038, glyph: 'rails', glyphColor: 0xf0c040 },
    fx: { kind: 'conveyor', speed: 10, noZombies: true },
  },

  // ---- Batch 10: travel extras and storage ----
  {
    ...D, id: 'boatdock', name: 'Boat Dock', color: 0x8a6a48,
    desc: 'Use it to take a boat: for 60 seconds you move through water twice as fast.',
    look: { base: 'wood', color: 0x7a5a38, glyph: 'boat', glyphColor: 0xe0d0b0 },
    fx: { kind: 'boat', mult: 2.9, time: 60, cd: 5 },
  },
  {
    ...D, id: 'checkpointflag', name: 'Checkpoint Flag', color: 0xe0c040,
    desc: 'Step on it (or use it): if you fall off the map, you come back here instead of at the start. Great for parkour.',
    look: { base: 'stone', color: 0x8a8a8a, glyph: 'flag', glyphColor: 0xe8c040 },
    fx: { kind: 'checkpoint' },
  },
  {
    ...D, id: 'portalblock', name: 'Portal', color: 0x30c0a0, emissive: 0x40ffd0, emissiveIntensity: 0.3,
    desc: 'Step on it to be sent to a random other Portal on this map.',
    look: { base: 'glow', color: 0x1a4a40, glyph: 'portal', glyphColor: 0x60f0c0 },
    fx: { kind: 'portal', cd: 2 },
  },
  {
    ...D, id: 'lockerblock', name: 'Locker', color: 0x6a7a8a,
    desc: 'Use it holding an item or blocks to put them away; use it with empty hands (or a gun) to take them back. Holds 1 stack for this game.',
    look: { base: 'metal', color: 0x5a6a7a, glyph: 'lock', glyphColor: 0xe0c040 },
    fx: { kind: 'store', slots: 1 },
  },
  {
    ...D, id: 'sharedchest', name: 'Shared Chest', color: 0x9a7040,
    desc: 'Like a Locker but holds 5 stacks; with empty hands you take out the last one put in.',
    look: { base: 'wood', color: 0x9a7040, glyph: 'chest', glyphColor: 0x5a3a20 },
    fx: { kind: 'store', slots: 5 },
  },
  {
    ...D, id: 'weaponrack', name: 'Weapon Rack', color: 0x6a4a30,
    desc: 'Use it while playing to swap to a different gun.',
    look: { base: 'wood', color: 0x5a4028, glyph: 'gun', glyphColor: 0x9a9aa2 },
    fx: { kind: 'weaponrack' },
  },
  {
    ...D, id: 'ammobox', name: 'Ammo Box', color: 0x5d6b3a,
    desc: 'Use it for a full magazine of extra ammo. Refills every 30 seconds.',
    look: { base: 'metal', color: 0x4d5b2a, glyph: 'bullets', glyphColor: 0xe8c14a },
    fx: { kind: 'ammo', mags: 1, cd: 30 },
  },
  {
    ...D, id: 'workbenchupgrade', name: 'Workbench Upgrade', color: 0x9a7a50,
    desc: 'Use it to spend 25 coins on 10% more damage for this game (up to 3 times).',
    look: { base: 'wood', color: 0x8a6a40, glyph: 'wrench', glyphColor: 0xe0e0e8 },
    fx: { kind: 'bench', cost: 25, max: 3 },
  },
  {
    ...D, id: 'recycler', name: 'Recycler', color: 0x4a8a5a,
    desc: 'Use it while holding blocks to turn them into coins: 1 coin for every 4 blocks.',
    look: { base: 'metal', color: 0x3a6a4a, glyph: 'recycle', glyphColor: 0x90f0a0 },
    fx: { kind: 'recycler', per: 4 },
  },
  {
    ...D, id: 'fridgeblock', name: 'Fridge', color: 0xe8eef0,
    desc: 'Use it to take out a piece of Meat. Restocks every 90 seconds.',
    look: { base: 'metal', color: 0xe0e6ea, glyph: 'fridge', glyphColor: 0x8a9aa8 },
    fx: { kind: 'give', id: 'meat', key: 'invMeat', n: 1, cd: 90 },
  },
]

export const SPECIAL_BY_ID = new Map(SPECIAL_BLOCKS.map((b) => [b.id, b]))
// Blocks your bullets fly through (BuildSurvival.shoot).
export const SHOOT_THROUGH = new Set(SPECIAL_BLOCKS.filter((b) => b.fx.shootThrough).map((b) => b.id))
