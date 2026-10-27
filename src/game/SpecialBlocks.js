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
]

export const SPECIAL_BY_ID = new Map(SPECIAL_BLOCKS.map((b) => [b.id, b]))
