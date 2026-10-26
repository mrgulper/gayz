// Dinosaurs (2026-10-26, Gaymi: "add more animals but this time its
// dinosaurs ... make them very rare only 1% spawn on their biome make them
// based on minecraft/bloxd style mainly gayz current animals style").
// Same blocky boxes and numbers as AnimalKinds.js (body [w, h, l], leg
// height, head [w, h, l], headAt [y, z], colors [body, spots, head,
// snout, leg], extras), real-ish sizes in blocks (1 block = 1 m): a
// T. rex is about 4 blocks tall, a Brachiosaurus about 13, a
// Compsognathus the size of a chicken.
//
// hunts: a meat-eater - it chases the nearest player it sees within
// HUNT_RANGE and bites for `bite` damage (PlayAnimals._step); shooting it
// makes it angrier, not run. The plant-eaters wander and run like the
// other animals. Dinosaurs can't be tamed.
const pair = (on, size, [x, y, z], color) => [{ on, size, at: [-x, y, z], color }, { on, size, at: [x, y, z], color }]
const q = (body, leg, head, headAt, c, more = {}) => ({
  body, leg, head, headAt,
  colors: { body: c[0], spots: c[1] ?? c[0], head: c[2] ?? c[0], snout: c[3] ?? c[1] ?? c[0], leg: c[4] ?? c[1] ?? c[0] },
  dino: true,
  ...more,
})
const biped = (more) => ({ legs: 2, ...more })
// A tail sticking out behind, hip high, tapering in two boxes.
const tail = (w, h, l, y, z, color = 'body') => [
  { on: 'body', size: [w, h, l * 0.55], at: [0, y, z - l * 0.27], color },
  { on: 'body', size: [w * 0.6, h * 0.6, l * 0.5], at: [0, y - h * 0.1, z - l * 0.78], color },
]
const BONE = 0xe8e0c8

export const DINO_KINDS = {
  // --- meat-eaters ---
  tRex: q([2.2, 2.2, 4.4], 2.0, [1.3, 1.3, 1.9], [4.1, 3.2], [0x5a6b3a, 0x46552c, 0x5a6b3a, 0xd8d0b0, 0x46552c], biped({
    legW: 0.75, health: 800, meat: 8, speed: 1.15, hunts: true, bite: 35,
    extras: [{ on: 'body', size: [1.2, 1.4, 1.0], at: [0, 3.6, 2.4], color: 'body' }, ...pair('body', [0.2, 0.55, 0.2], [0.55, 2.9, 2.0], 0x46552c), ...tail(1.3, 1.1, 6, 3.2, -2.2)],
  })),
  giganotosaurus: q([2.2, 2.4, 5], 2.6, [1.1, 1.4, 2.3], [4.7, 3.6], [0x7a5a3a, 0x5a4028, 0x7a5a3a, 0xd8d0b0, 0x5a4028], biped({
    legW: 0.75, health: 900, meat: 9, speed: 1.2, hunts: true, bite: 40,
    extras: [{ on: 'body', size: [1.1, 1.4, 1.1], at: [0, 4.2, 2.8], color: 'body' }, ...pair('body', [0.2, 0.6, 0.2], [0.55, 3.4, 2.3], 0x5a4028), ...tail(1.3, 1.2, 7, 3.9, -2.5)],
  })),
  spinosaurus: q([2, 2, 5], 2.6, [0.9, 0.9, 2.5], [4.3, 3.7], [0x4a5a5a, 0x3a4646, 0x4a5a5a, 0xd8d0b0, 0x3a4646], biped({
    legW: 0.65, health: 900, meat: 8, speed: 1.05, hunts: true, bite: 38,
    extras: [{ on: 'body', size: [0.2, 2.4, 3.6], at: [0, 5.8, 0], color: 0xb0503a }, { on: 'body', size: [0.9, 1.0, 1.0], at: [0, 4.1, 2.8], color: 'body' }, ...pair('body', [0.25, 0.7, 0.25], [0.55, 3.4, 2.1], 0x3a4646), ...tail(1.1, 1.0, 6.5, 3.8, -2.5)],
  })),
  allosaurus: q([1.6, 1.7, 3.6], 2.0, [0.9, 1.0, 1.4], [3.6, 2.5], [0x8a6a3a, 0x6a4a2a, 0x8a6a3a, 0xd8d0b0, 0x6a4a2a], biped({
    legW: 0.55, health: 500, meat: 6, speed: 1.3, hunts: true, bite: 25,
    extras: [...pair('head', [0.15, 0.2, 0.25], [0.3, 0.6, 0.2], 0xb04a2a), { on: 'body', size: [0.8, 1.0, 0.8], at: [0, 3.2, 1.9], color: 'body' }, ...tail(0.9, 0.9, 4.6, 2.8, -1.8)],
  })),
  carnotaurus: q([1.2, 1.4, 3.0], 1.8, [0.7, 0.8, 1.0], [3.2, 2.0], [0x9a4a3a, 0x7a3428, 0x9a4a3a, 0xd8d0b0, 0x7a3428], biped({
    legW: 0.4, health: 300, meat: 4, speed: 1.5, hunts: true, bite: 22,
    extras: [...pair('head', [0.14, 0.4, 0.14], [0.3, 0.55, -0.15], BONE), ...tail(0.7, 0.7, 4, 2.4, -1.5)],
  })),
  megalosaurus: q([1.1, 1.3, 2.8], 1.6, [0.6, 0.75, 1.1], [2.9, 2.0], [0x6a5a3a, 0x52442a, 0x6a5a3a, 0xd8d0b0, 0x52442a], biped({
    legW: 0.38, health: 260, meat: 4, speed: 1.3, hunts: true, bite: 20,
    extras: tail(0.6, 0.6, 3.6, 2.2, -1.4),
  })),
  dilophosaurus: q([0.8, 0.9, 2.2], 1.3, [0.45, 0.5, 0.9], [2.4, 1.6], [0x8a8a3a, 0x5a6a2a, 0x8a8a3a, 0xd8d0b0, 0x5a6a2a], biped({
    legW: 0.28, health: 160, meat: 3, speed: 1.4, hunts: true, bite: 15,
    extras: [...pair('head', [0.06, 0.35, 0.7], [0.13, 0.38, -0.05], 0xc0402a), ...tail(0.4, 0.4, 2.8, 1.7, -1.1)],
  })),
  velociraptor: q([0.35, 0.4, 0.8], 0.45, [0.2, 0.22, 0.4], [0.95, 0.6], [0x8a5a30, 0x6a4020, 0x8a5a30, 0xd8d0b0, 0x4a3018], biped({
    legW: 0.1, health: 40, meat: 1, speed: 1.6, hunts: true, bite: 8,
    extras: [...pair('body', [0.06, 0.06, 0.2], [0.18, 0.75, 0.3], 0x6a4020), ...tail(0.14, 0.14, 1.1, 0.75, -0.4)],
  })),
  compsognathus: q([0.15, 0.15, 0.35], 0.2, [0.1, 0.1, 0.15], [0.42, 0.25], [0x7a8a4a, 0x5a6a3a, 0x7a8a4a, 0x5a6a3a, 0x5a6a3a], biped({
    legW: 0.04, health: 8, meat: 1, speed: 1.5, hunts: true, bite: 3,
    extras: tail(0.06, 0.06, 0.45, 0.31, -0.17),
  })),
  // --- plant-eaters ---
  triceratops: q([2.2, 1.9, 4.2], 1.1, [1.6, 1.4, 1.6], [2.0, 2.7], [0x7a6a4a, 0x5e5038, 0x7a6a4a, 0x5e5038, 0x5e5038], {
    legW: 0.6, health: 500, meat: 6, speed: 0.8,
    extras: [{ on: 'head', size: [2.4, 2.0, 0.3], at: [0, 0.6, -0.65], color: 0x9a6a3a }, ...pair('head', [0.18, 0.18, 1.1], [0.45, 0.55, 0.8], BONE), { on: 'head', size: [0.16, 0.35, 0.16], at: [0, 0.05, 1.0], color: BONE }, ...tail(0.8, 0.7, 2.6, 2.1, -2.1)],
  }),
  stegosaurus: q([1.8, 1.8, 4.0], 1.2, [0.5, 0.5, 0.8], [1.3, 2.3], [0x6a7a4a, 0x52603a, 0x6a7a4a, 0x52603a, 0x52603a], {
    legW: 0.5, health: 450, meat: 5, speed: 0.7,
    extras: [-1.4, -0.5, 0.4, 1.3].map((z, i) => ({ on: 'body', size: [0.15, 0.7 + (i % 2) * 0.3, 0.7], at: [0, 3.3 + (i % 2) * 0.15, z], color: 0xc06a3a }))
      .concat(tail(0.6, 0.5, 3.2, 2.2, -2.0), pair('body', [0.1, 0.1, 0.8], [0.25, 2.2, -4.4], BONE)),
  }),
  ankylosaurus: q([2.2, 1.1, 4.4], 0.6, [1.0, 0.7, 1.0], [1.1, 2.6], [0x6a6050, 0x4a4238, 0x6a6050, 0x4a4238, 0x4a4238], {
    legW: 0.5, health: 600, meat: 6, speed: 0.6,
    extras: [{ on: 'body', size: [2.4, 0.3, 4.2], at: [0, 1.8, 0], color: 0x4a4238 }, ...tail(0.5, 0.4, 2.8, 1.2, -2.2), { on: 'body', size: [1.0, 0.6, 0.7], at: [0, 1.15, -4.8], color: 0x4a4238 }],
  }),
  brachiosaurus: q([3.5, 4, 7], 4.5, [1.2, 1.1, 2.0], [13.2, 4.6], [0x7a8a7a, 0x5e6e5e, 0x7a8a7a, 0x5e6e5e, 0x5e6e5e], {
    legW: 1.0, health: 1500, meat: 12, speed: 0.6,
    extras: [{ on: 'body', size: [1.2, 5.5, 1.3], at: [0, 10.2, 3.8], color: 'body' }, ...tail(1.3, 1.2, 6, 7.2, -3.5)],
  }),
  diplodocus: q([3, 3, 6], 3.5, [0.8, 0.7, 1.3], [5.9, 9.8], [0x8a8060, 0x6a6248, 0x8a8060, 0x6a6248, 0x6a6248], {
    legW: 0.8, health: 1200, meat: 10, speed: 0.6,
    extras: [{ on: 'body', size: [0.9, 0.9, 6.4], at: [0, 5.7, 6.1], color: 'body' }, ...tail(0.8, 0.8, 11, 5.4, -3)],
  }),
  apatosaurus: q([3.4, 3.4, 6.5], 3.6, [1.0, 0.8, 1.4], [8.8, 8.4], [0x6a6a5a, 0x50503e, 0x6a6a5a, 0x50503e, 0x50503e], {
    legW: 0.95, health: 1300, meat: 11, speed: 0.55,
    extras: [{ on: 'body', size: [1.3, 1.3, 3.2], at: [0, 6.4, 4.4], color: 'body' }, { on: 'body', size: [1.1, 1.6, 2.6], at: [0, 7.6, 6.8], color: 'body' }, ...tail(1.0, 1.0, 9.5, 5.6, -3.2)],
  }),
  brontosaurus: q([3.2, 3.2, 6.2], 3.6, [0.9, 0.8, 1.3], [9.6, 7.6], [0x7a6a50, 0x5e503a, 0x7a6a50, 0x5e503a, 0x5e503a], {
    legW: 0.9, health: 1250, meat: 11, speed: 0.6,
    extras: [{ on: 'body', size: [1.1, 2.0, 2.4], at: [0, 7.0, 4.0], color: 'body' }, { on: 'body', size: [1.0, 2.0, 2.0], at: [0, 8.6, 6.0], color: 'body' }, ...tail(0.9, 0.9, 9, 5.5, -3.1)],
  }),
  parasaurolophus: q([1.6, 1.6, 3.5], 1.8, [0.6, 0.7, 1.1], [3.7, 2.25], [0x5a7a8a, 0x3e5a6a, 0x5a7a8a, 0xd0c8a0, 0x3e5a6a], biped({
    legW: 0.5, health: 350, meat: 4, speed: 1.0,
    extras: [{ on: 'head', size: [0.25, 0.25, 1.6], at: [0, 0.55, -0.9], color: 0xb04a3a }, ...tail(0.7, 0.7, 3.5, 2.7, -1.6)],
  })),
  iguanodon: q([1.6, 1.8, 3.6], 2.0, [0.6, 0.7, 1.1], [4.0, 2.4], [0x6a7a5a, 0x50603e, 0x6a7a5a, 0x50603e, 0x50603e], biped({
    legW: 0.55, health: 400, meat: 5, speed: 0.9,
    extras: [...pair('body', [0.2, 0.9, 0.2], [0.75, 2.8, 1.5], 0x50603e), ...pair('body', [0.08, 0.2, 0.08], [0.75, 2.3, 1.62], BONE), ...tail(0.7, 0.7, 3.6, 2.9, -1.7)],
  })),
  pachycephalosaurus: q([0.8, 0.9, 1.8], 1.0, [0.6, 0.7, 0.6], [2.0, 1.25], [0x7a6a5a, 0x5e503e, 0x8a7a5a, 0x5e503e, 0x5e503e], biped({
    legW: 0.26, health: 120, meat: 2, speed: 1.1,
    extras: [{ on: 'head', size: [0.66, 0.35, 0.62], at: [0, 0.45, -0.02], color: 0xd0b890 }, ...tail(0.3, 0.3, 1.8, 1.5, -0.8)],
  })),
  pteranodon: q([0.5, 0.5, 1.2], 0.3, [0.3, 0.35, 1.2], [0.95, 0.95], [0x9a7a6a, 0x7a5a4a, 0x9a7a6a, 0xd0b060, 0x7a5a4a], biped({
    legW: 0.08, health: 30, meat: 1, speed: 1.3, fly: 9,
    extras: [{ on: 'head', size: [0.1, 0.4, 0.9], at: [0, 0.25, -0.6], color: 0xc05a3a }, ...pair('body', [2.6, 0.08, 1.0], [1.5, 0.75, 0], 0x7a5a4a)],
  })),
}

// Where each dinosaur lives. Only DINO_CHANCE of the animals that turn up
// in one of these biomes is a dinosaur (one of the biome's, picked
// evenly), and it comes alone.
export const DINO_CHANCE = 0.01
export const DINO_BIOMES = {
  plains: ['tRex', 'triceratops', 'stegosaurus', 'diplodocus', 'brontosaurus'],
  forest: ['tRex', 'stegosaurus', 'ankylosaurus', 'allosaurus', 'parasaurolophus', 'iguanodon', 'megalosaurus'],
  birchForest: ['iguanodon', 'parasaurolophus'],
  darkForest: ['megalosaurus', 'allosaurus'],
  taiga: ['allosaurus', 'ankylosaurus'],
  savanna: ['tRex', 'triceratops', 'brachiosaurus', 'diplodocus', 'carnotaurus', 'giganotosaurus'],
  jungle: ['brachiosaurus', 'apatosaurus', 'brontosaurus', 'dilophosaurus', 'giganotosaurus', 'compsognathus'],
  bambooJungle: ['dilophosaurus', 'compsognathus'],
  swamp: ['spinosaurus', 'apatosaurus', 'parasaurolophus'],
  mangroveSwamp: ['spinosaurus'],
  desert: ['velociraptor', 'carnotaurus', 'compsognathus'],
  badlands: ['velociraptor', 'ankylosaurus', 'pachycephalosaurus'],
  mountains: ['pachycephalosaurus', 'pteranodon'],
  beach: ['pteranodon', 'compsognathus', 'spinosaurus'],
}
