// More creatures (2026-10-30, Gaymi: "add every single animal that florr.io
// and super auto pets has if we have an animal ... already dont do anything",
// then picked "real + fantasy creatures"). Only the ones the game didn't
// have yet: real animals (bugs, sea life, an ox, a rooster, a mammoth, a
// sabre-tooth...) and made-up ones (dragon, unicorn, kraken...). Same
// blocky body plans as WildAnimalKinds.js, scaled to size and painted.
// Standing two-legged ones (yeti, sasquatch) are 2 blocks tall, like
// every standing mob. hunts / bite / huntRange: attacks like the wolves
// (PlayAnimals._hunt), and gets the scary look.
import { PLANS } from './WildAnimalKinds.js'

const { q, pair, plus, cat, dog, rodent, monkey, raptor, fowl, lizard, snake, fish, bug } = PLANS
const GOLD = 0xe8c040
const BONE = 0xe8e0c8
// A horse-shaped body (unicorn, pegasus).
const horse = (c, more) => plus(q([0.7, 0.75, 1.5], 0.9, [0.35, 0.4, 0.7], [1.95, 0.95], c, {
  speed: 1.3,
  extras: [{ on: 'body', size: [0.32, 0.6, 0.38], at: [0, 1.75, 0.62], color: 'body' }, { on: 'body', size: [0.1, 0.55, 0.12], at: [0, 1.5, -0.8], color: c[1] }],
}), more)
// Big feathered or leathery wings, one each side.
const wings = (w, l, y, color) => pair('body', [w, 0.08, l], [w / 2 + 0.2, y, 0], color)

export const CREATURE_KINDS = {
  // --- real animals ---
  ox: q([1.0, 0.95, 1.7], 0.6, [0.6, 0.6, 0.55], null, [0x6a4a30, 0x5a3e28, 0x6a4a30, 0xd0b090, 0x4a3420], { health: 70, meat: 3, speed: 0.8, extras: pair('head', [0.35, 0.1, 0.1], [0.4, 0.28, -0.05], BONE) }),
  rooster: fowl(1.4, [0xb8502a, 0x2a5a3a, 0xd8a050, 0xe0b020, 0xe0b020], { extras: [{ on: 'head', size: [0.04, 0.12, 0.14], at: [0, 0.14, 0], color: 0xd02020 }, { on: 'head', size: [0.04, 0.1, 0.04], at: [0, -0.13, 0.08], color: 0xd02020 }] }),
  mammoth: q([2.2, 2.2, 3.2], 1.6, [1.3, 1.3, 1.0], [3.5, 1.9], [0x5a3a22, 0x4a2e1a, 0x5a3a22, 0x4a2e1a, 0x4a2e1a], {
    legW: 0.6, speed: 0.6, health: 200, meat: 6,
    extras: [{ on: 'head', size: [0.32, 1.5, 0.32], at: [0, -0.9, 0.55], color: 0x4a2e1a }, ...pair('head', [0.14, 0.14, 1.1], [0.42, -0.6, 0.8], BONE), ...pair('head', [0.14, 0.6, 0.14], [0.42, -0.2, 1.35], BONE), { on: 'body', size: [1.6, 0.6, 1.2], at: [0, 4.0, 0.9], color: 0x4a2e1a }],
  }),
  sabertooth: cat(2.6, [0xb88a4a, 0x8a6a3a, 0xb88a4a, 0xe8d8b8, 0x8a6a3a], { hunts: true, bite: 16, huntRange: 10, health: 110, meat: 3, extras: pair('head', [0.05, 0.32, 0.05], [0.12, -0.42, 0.28], BONE) }),
  mantisShrimp: fish(1.2, [0x2aa87a, 0xe0402a, 0x3a70d0, 0xe0b020], { hunts: true, bite: 5, huntRange: 3, extras: pair('head', [0.03, 0.03, 0.12], [0.05, -0.05, 0.12], 0xe0402a) }),
  seaCucumber: snake(0.4, [0x5a3a2a, 0x3a2418, 0x5a3a2a, 0x3a2418], { swim: true, speed: 0.2, eyes: false }),
  frigatebird: raptor(1.4, [0x1e1e22, 0x2a2a2e, 0x1e1e22, 0x8a8a8a], { extras: [{ on: 'body', size: [0.2, 0.18, 0.16], at: [0, 0.3, 0.3], color: 0xd02020 }] }),
  blobfish: fish(1.2, [0xe8a8a8, 0xd89090, 0xe8a8a8, 0xd08080], { speed: 0.3, extras: [{ on: 'head', size: [0.06, 0.08, 0.06], at: [0, 0, 0.08], color: 0xd08080 }] }),
  stonefish: fish(1.1, [0x6a5a4a, 0x4a3a2a, 0x6a5a4a, 0x8a6a4a], { stripes: true, speed: 0.3 }),
  leech: snake(0.3, [0x2a2418, 0x4a3a1a, 0x2a2418, 0x3a2a1a], { hunts: true, bite: 2, huntRange: 3, speed: 0.5, eyes: false }),
  cockroach: bug(2.4, [0x5a2e1a, 0x3a1e10, 0x3a1e10, 0x3a1e10, 0x3a1e10], { speed: 1.4, extras: pair('head', [0.01, 0.01, 0.25], [0.03, 0.03, 0.15], 0x3a1e10) }),
  termite: bug(1.4, [0xe8d8b8, 0xd0c0a0, 0x8a4a1a, 0x6a3a10, 0xd0c0a0]),
  sponge: q([0.4, 0.5, 0.4], 0, [0.05, 0.05, 0.05], [0.25, 0.18], [0xe0c040, 0xc8a030], { legs: 0, swim: true, speed: 0.01, eyes: false }),
  conch: q([0.3, 0.25, 0.45], 0, [0.12, 0.1, 0.12], null, [0xe8c8a8, 0xd8a080, 0xc8a080, 0xe89090], { legs: 0, speed: 0.15, extras: [{ on: 'body', size: [0.26, 0.22, 0.3], at: [0, 0.35, -0.05], color: 0xf0d8c0 }] }),
  queenAnt: bug(5, [0x2a1a14, 0x1e140e, 0x2a1a14, 0x1e140e, 0x1e140e], { health: 60, meat: 2, speed: 0.5, extras: pair('body', [0.6, 0.01, 0.5], [0.35, 0.3, -0.1], 0xd8e0e8) }),
  soldierAnt: bug(3.2, [0x6a1e14, 0x3a1e14, 0x3a1e14, 0x3a1e14, 0x3a1e14], { hunts: true, bite: 3, huntRange: 5, speed: 1.1, extras: pair('head', [0.03, 0.03, 0.1], [0.05, -0.03, 0.1], 0x1e140e) }),
  darkLadybug: bug(3, [0x4a1418, 0x1a1a1a, 0x1a1a1a, 0x1a1a1a, 0x1a1a1a], { eyes: false, speed: 0.4, extras: [...pair('body', [0.06, 0.02, 0.06], [0.06, 0.25, 0.05], 0x1a1a1a), ...pair('body', [0.06, 0.02, 0.06], [0.06, 0.25, -0.12], 0x1a1a1a)] }),
  // --- made-up creatures ---
  dragon: q([1.6, 1.4, 3.4], 1.2, [0.9, 0.8, 1.3], [3.0, 2.5], [0x8a1e1a, 0x5a1410, 0x8a1e1a, 0xe8c060, 0x5a1410], {
    legW: 0.45, health: 600, meat: 6, speed: 1.1, hunts: true, bite: 30, huntRange: 16,
    extras: [...wings(3.2, 1.8, 2.7, 0x5a1410), { on: 'body', size: [0.7, 1.4, 0.8], at: [0, 2.5, 1.8], color: 'body' }, { on: 'body', size: [0.9, 0.8, 2.4], at: [0, 1.8, -2.8], color: 'body' }, { on: 'body', size: [0.5, 0.5, 2.0], at: [0, 1.6, -4.8], color: 'body' }, ...pair('head', [0.12, 0.6, 0.12], [0.3, 0.6, -0.3], BONE), ...[-1.2, -0.3, 0.6].map((z) => ({ on: 'body', size: [0.12, 0.45, 0.4], at: [0, 2.8, z], color: 0xe8c060 }))],
  }),
  unicorn: horse([0xf6f4f8, 0xd8b8f0, 0xf6f4f8, 0xf0c8d8, 0xe8e0f0], { extras: [{ on: 'head', size: [0.08, 0.55, 0.08], at: [0, 0.42, 0.18], color: GOLD }] }),
  pegasus: horse([0xf2f2f6, 0xd8e0f0, 0xf2f2f6, 0xe0d0d8, 0xe0e4ec], { extras: wings(1.8, 0.9, 1.75, 0xffffff) }),
  griffin: q([0.8, 0.8, 1.6], 0.7, [0.45, 0.45, 0.5], [1.65, 1.0], [0xc8963c, 0xb88430, 0xf2f0ea, GOLD, 0xb88430], { speed: 1.2, health: 90, meat: 3, extras: [...wings(1.8, 0.9, 1.5, 0x8a6a3a), { on: 'head', size: [0.14, 0.16, 0.22], at: [0, -0.06, 0.32], color: GOLD }, { on: 'body', size: [0.1, 0.1, 0.7], at: [0, 1.3, -1.1], color: 'body' }] }),
  phoenix: raptor(2.4, [0xe0501a, 0xf0b020, 0xe06a1a, 0xf0d040], { extras: [{ on: 'body', size: [0.12, 0.5, 0.9], at: [0, 0.4, -0.9], color: 0xf0b020 }, { on: 'head', size: [0.04, 0.2, 0.15], at: [0, 0.2, -0.05], color: 0xf0d040 }] }),
  kraken: q([2.6, 2.4, 2.6], 0, [0.4, 0.4, 0.3], [1.4, 1.35], [0x6a2a5a, 0x4a1a40, 0x6a2a5a, 0x4a1a40], {
    legs: 0, swim: true, speed: 0.6, health: 400, meat: 6, hunts: true, bite: 25, huntRange: 12,
    extras: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ on: 'body', size: [0.35, 2.2, 0.35], at: [Math.round(Math.sin(i * 0.785) * 1.1 * 100) / 100, -0.8, Math.round(Math.cos(i * 0.785) * 1.1 * 100) / 100], color: 0x4a1a40 })),
  }),
  yeti: monkey(2.15, [0xeef2f6, 0xd8e0e8, 0x8aa0b8, 0x6a7a8a, 0xeef2f6], { hunts: true, bite: 18, huntRange: 10, health: 200, meat: 4, speed: 1 }),
  sasquatch: monkey(2.15, [0x5a3a22, 0x4a2e1a, 0x6a4a30, 0x3a2a1a, 0x4a2e1a], { health: 180, meat: 4, speed: 1 }),
  jackalope: rodent(2.6, [0xb09070, 0x8a7050, 0xb09070, 0xf0e8d8], { speed: 1.5, extras: [...pair('head', [0.03, 0.22, 0.03], [0.07, 0.24, -0.03], 0xc8b48a), ...pair('head', [0.1, 0.03, 0.03], [0.11, 0.3, -0.03], 0xc8b48a)] }),
  cerberus: dog(2.2, [0x1e1a1a, 0x2e2626, 0x1e1a1a, 0x8a2a2a, 0x1e1a1a], { hunts: true, bite: 20, huntRange: 12, health: 220, meat: 4, extras: pair('body', [0.5, 0.48, 0.6], [0.55, 1.6, 1.0], 0x1e1a1a) }),
  hydra: lizard(8, [0x2a5a3a, 0x1e4028, 0x2a5a3a, 0x1e4028, 0x1e4028], {
    hunts: true, bite: 22, huntRange: 10, health: 350, meat: 5, swim: false,
    extras: [-0.45, 0.45].flatMap((x) => [{ on: 'body', size: [0.25, 1.4, 0.25], at: [x, 1.2, 1.5], color: 'body' }, { on: 'body', size: [0.45, 0.35, 0.6], at: [x, 1.95, 1.75], color: 'body' }]),
  }),
  lakeMonster: q([1.4, 1.0, 3.0], 0, [0.5, 0.45, 0.7], [3.6, 2.6], [0x3a5a4a, 0x2a4a3a, 0x3a5a4a, 0x2a4a3a], { legs: 0, swim: true, speed: 0.5, health: 250, meat: 5, extras: [{ on: 'body', size: [0.45, 3.0, 0.45], at: [0, 2.1, 2.1], color: 'body' }, ...pair('body', [0.8, 0.1, 0.6], [0.9, 0.3, 0.8], 0x2a4a3a), { on: 'body', size: [0.5, 0.4, 1.4], at: [0, 0.4, -2.1], color: 'body' }] }),
  manticore: cat(2.6, [0xc8603a, 0x8a3a20, 0xc8603a, 0xe8c090, 0x8a3a20], { hunts: true, bite: 18, huntRange: 11, health: 180, meat: 4, extras: [{ on: 'body', size: [0.16, 1.0, 0.16], at: [0, 1.6, -1.2], color: 0x3a2018 }, { on: 'body', size: [0.2, 0.3, 0.4], at: [0, 2.15, -1.0], color: 0x1e1010 }, ...wings(1.4, 0.7, 1.3, 0x8a3a20)] }),
}

// Where each lives (added to PlayAnimals' BIOME_ANIMALS).
export const CREATURE_BIOME_ANIMALS = {
  plains: ['ox', 'rooster', 'unicorn', 'jackalope', 'pegasus'],
  city: ['rooster', 'cockroach'],
  forest: ['termite', 'queenAnt', 'soldierAnt', 'darkLadybug', 'sasquatch'],
  darkForest: ['cerberus', 'sasquatch', 'darkLadybug'],
  taiga: ['sasquatch'],
  snowyTaiga: ['yeti', 'mammoth'],
  snowyPlains: ['mammoth', 'sabertooth'],
  snowyPeaks: ['yeti'],
  iceSpikes: ['yeti'],
  cherryGrove: ['unicorn', 'pegasus'],
  desert: ['jackalope', 'manticore', 'phoenix'],
  badlands: ['dragon', 'cerberus', 'phoenix'],
  savanna: ['termite', 'manticore', 'sabertooth'],
  jungle: ['soldierAnt', 'cockroach', 'leech'],
  swamp: ['leech', 'hydra'],
  mangroveSwamp: ['leech', 'hydra'],
  mountains: ['dragon', 'griffin', 'pegasus'],
  beach: ['conch', 'frigatebird'],
  warmOcean: ['mantisShrimp', 'seaCucumber', 'sponge', 'stonefish', 'conch'],
  ocean: ['kraken', 'lakeMonster', 'sponge'],
  deepOcean: ['kraken', 'blobfish'],
}

// How rare each is (NewAnimalKinds RARITIES); anything not listed is Common.
export const CREATURE_TIERS = {
  legendary: 'dragon unicorn pegasus griffin phoenix kraken yeti sasquatch cerberus hydra lakeMonster manticore mammoth sabertooth',
  epic: 'jackalope mantisShrimp blobfish queenAnt',
  rare: 'frigatebird stonefish soldierAnt darkLadybug',
  uncommon: 'ox rooster seaCucumber sponge conch leech termite',
}
