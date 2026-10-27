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
]

export const SPECIAL_BY_ID = new Map(SPECIAL_BLOCKS.map((b) => [b.id, b]))
