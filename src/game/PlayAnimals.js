// Animals out in the open world (2026-10-18, Gaymi: "make animals (pets)
// spawn naturally around the world", and picked all three of: peaceful
// wanderers, hunted for food, tamed as pets). Owned by BuildSurvival
// (`s.animals`), stepped from its update():
//
//   - animals that fit the biome (BIOME_ANIMALS: farm animals on the
//     plains, polar bears and penguins in the snow, camels in the desert,
//     giraffes on the savanna...) appear in small groups on dry land
//     around you (up to MAX_WILD at a time) and wander about, pausing to
//     stand; ones left far behind go, so new ones keep turning up ahead;
//   - shoot or hit one and it runs away; killed, it drops Meat (a little
//     spinning item you walk over, PlayDrops) - click with it held to heal;
//   - press Use (E) while looking at one to tame it: it gets a red collar,
//     follows you (catching up if left far behind), is never hurt by your
//     shots and never goes away until the game ends.
// Dinosaurs (DinoKinds.js, 2026-10-26) are rare - DINO_CHANCE of what
// turns up in their biomes; the meat-eaters among them chase and bite you
// (_hunt), and none can be tamed.
// Zombies leave animals alone. Blocky models made from boxes, sizes like
// the real animals (smaller than a player). Meshes only, never a light;
// geometries and materials are shared per kind and never flashed.
//
// On a server (2026-10-26, "they didn't see the same thing I had on my
// screen") the host runs the animals for everyone - spawning them around
// every player, a pet following whoever tamed it - and sends them with
// each sync (snapshot); everybody else just mirrors them (applySnapshot,
// updateMirror) and sends their shots and taming to the host (PlayNet).
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { t, STRINGS } from './i18n.js'
import { sampleLand, inCity } from './OpenWorld.js'
import { MORE_KINDS, MORE_BIOME_ANIMALS } from './AnimalKinds.js'
import { DINO_KINDS, DINO_BIOMES, DINO_CHANCE } from './DinoKinds.js'
import { luck, luckyWeights } from './Luck.js'
import { NEW_KINDS, NEW_BIOME_ANIMALS, RARITIES, rarityOf } from './NewAnimalKinds.js'
import { WILD_KINDS, WILD_BIOME_ANIMALS, WILD_TIERS, HUNTERS } from './WildAnimalKinds.js'
import { CREATURE_KINDS, CREATURE_BIOME_ANIMALS, CREATURE_TIERS } from './CreatureKinds.js'
import { addAnimalMeat } from './PlayInventory.js'

export const MAX_WILD = 12
// Animals a server's sync carries at most (api/_lib/servers.js MAX_ANIMALS).
export const MAX_SHARED = 24
// A kill whose last shot was mine this recently gives me the meat.
const MY_KILL_MS = 3000
const SPAWN_EVERY_S = 1.5
const SPAWN_MIN = 24 // blocks from you
const SPAWN_MAX = 56
const DESPAWN = 110
// Animals panic when a zombie comes close (2026-10-31, Gaymi's funny
// update: "chickens running in circles or a cow staring at zombies"):
// birds run round in circles flapping, cows freeze and stare at it, the
// rest bolt away zig-zagging and hopping. Zombies still leave them alone.
const PANIC_RANGE = 7 // blocks
const PANIC_LOOK_S = 0.4 // how often each one checks for zombies
const PANIC_S = 1.2 // keeps panicking this long after the last look
const CIRCLERS = new Set(['chicken', 'turkey', 'duck'])
const STARERS = new Set(['cow'])
const WALK = 1.1 // blocks per second
const RUN = 4
const FLEE_S = 4
const TAME_REACH = 4.5
const PET_NEAR = 3 // a pet stops this close to you
const PET_TELEPORT = 30
const DIE_S = 0.9
// Meat-eating dinosaurs (DinoKinds.js): chase a player this close (further
// once shot), bite when this close to their snout, this often.
const HUNT_RANGE = 24
const ANGRY_RANGE = 60
const ANGRY_S = 15
const BITE_REACH = 1.3
const BITE_EVERY_S = 1.4

// Body sizes in blocks: w (side to side), h (height), l (length), leg
// height; head size; colors; health; meat dropped. Optional: legs (2 or
// 4), legW, headAt ([y, z] of the head's middle), speed (x WALK/RUN),
// stripes (the body picture is striped, not patchy), and extras - more
// boxes on the 'body' (x, y, z from the feet) or the 'head' (from its
// middle), in a color or 'body' for the body's own picture.
const HORSE = { body: [0.7, 0.75, 1.5], leg: 0.9, head: [0.35, 0.4, 0.7], headAt: [1.95, 0.95], health: 60, meat: 2 }
const horseExtras = (mane) => [
  { on: 'body', size: [0.35, 0.7, 0.4], at: [0, 1.6, 0.6], color: 'body' },
  { on: 'body', size: [0.12, 0.75, 0.3], at: [0, 1.75, 0.5], color: mane },
  { on: 'body', size: [0.12, 0.6, 0.12], at: [0, 1.25, -0.8], color: mane },
]
const FOX = { body: [0.4, 0.38, 0.75], leg: 0.3, head: [0.38, 0.34, 0.34], headAt: [0.7, 0.5], health: 20, meat: 1 }
const foxExtras = (fur, tip) => [
  { on: 'head', size: [0.1, 0.14, 0.06], at: [-0.11, 0.22, -0.06], color: fur },
  { on: 'head', size: [0.1, 0.14, 0.06], at: [0.11, 0.22, -0.06], color: fur },
  { on: 'body', size: [0.18, 0.18, 0.5], at: [0, 0.55, -0.6], color: fur },
  { on: 'body', size: [0.19, 0.19, 0.12], at: [0, 0.55, -0.88], color: tip },
]
const pair = (on, size, [x, y, z], color) => [{ on, size, at: [-x, y, z], color }, { on, size, at: [x, y, z], color }]
const KINDS = {
  cow: { body: [0.9, 0.75, 1.4], leg: 0.55, head: [0.6, 0.6, 0.5], colors: { body: 0x5a3b26, spots: 0xf2eee6, head: 0x5a3b26, snout: 0xd8b49a, leg: 0x3a281a }, health: 50, meat: 2 },
  pig: { body: [0.75, 0.6, 1.0], leg: 0.35, head: [0.6, 0.55, 0.55], colors: { body: 0xeda3a3, spots: 0xe08f92, head: 0xeda3a3, snout: 0xd27a80, leg: 0xe08f92 }, health: 40, meat: 2 },
  sheep: { body: [0.85, 0.75, 1.2], leg: 0.5, head: [0.45, 0.5, 0.5], colors: { body: 0xeeeeea, spots: 0xdcdcd6, head: 0xc9b9a0, snout: 0xb8a68a, leg: 0xc9b9a0 }, health: 40, meat: 1 },
  chicken: { body: [0.4, 0.42, 0.5], leg: 0.3, legs: 2, legW: 0.07, head: [0.26, 0.34, 0.26], headAt: [0.7, 0.33], colors: { body: 0xf6f4ee, spots: 0xe8e4da, head: 0xf6f4ee, snout: 0xf0a020, leg: 0xf0a020 }, health: 20, meat: 1 },
  horse: { ...HORSE, colors: { body: 0x8a5a33, spots: 0x7a4e2c, head: 0x8a5a33, snout: 0x5e3e24, leg: 0x6b4528 }, extras: horseExtras(0x2b1d12) },
  zebra: { ...HORSE, stripes: true, colors: { body: 0xf2f2ee, spots: 0x1c1c1c, head: 0xf2f2ee, snout: 0x1c1c1c, leg: 0xe6e6e0 }, extras: horseExtras(0x1c1c1c) },
  deer: {
    body: [0.55, 0.6, 1.1], leg: 0.8, head: [0.35, 0.38, 0.45], headAt: [1.75, 0.68], health: 40, meat: 2,
    colors: { body: 0xa0703f, spots: 0xc9a57a, head: 0xa0703f, snout: 0x3a2a1e, leg: 0x7d5530 },
    extras: [
      { on: 'body', size: [0.25, 0.5, 0.3], at: [0, 1.45, 0.5], color: 'body' },
      ...pair('head', [0.06, 0.4, 0.06], [0.12, 0.38, -0.05], 0xd9c7a1),
      ...pair('head', [0.2, 0.06, 0.06], [0.2, 0.46, -0.05], 0xd9c7a1),
      { on: 'body', size: [0.12, 0.15, 0.1], at: [0, 1.3, -0.58], color: 0xf0e8dc },
    ],
  },
  rabbit: {
    body: [0.32, 0.3, 0.45], leg: 0.12, legW: 0.08, head: [0.26, 0.26, 0.26], headAt: [0.5, 0.25], health: 10, meat: 1, speed: 1.3,
    colors: { body: 0xb39a7c, spots: 0xd8c8b0, head: 0xb39a7c, snout: 0xe8b0b0, leg: 0xb39a7c },
    extras: [...pair('head', [0.07, 0.28, 0.05], [0.07, 0.25, -0.04], 0xb39a7c), { on: 'body', size: [0.12, 0.12, 0.1], at: [0, 0.32, -0.26], color: 0xf4f0ea }],
  },
  wolf: {
    body: [0.5, 0.5, 1.0], leg: 0.5, head: [0.45, 0.42, 0.4], headAt: [1.05, 0.62], health: 40, meat: 1,
    colors: { body: 0x8f8f8f, spots: 0xb5b5b5, head: 0x9a9a9a, snout: 0x5a5a5a, leg: 0x7d7d7d },
    extras: [...pair('head', [0.12, 0.15, 0.08], [0.12, 0.27, -0.08], 0x7d7d7d), { on: 'body', size: [0.12, 0.12, 0.5], at: [0, 0.85, -0.7], color: 0x8f8f8f }],
  },
  fox: { ...FOX, colors: { body: 0xd9762b, spots: 0xf2e6d8, head: 0xd9762b, snout: 0xf2e6d8, leg: 0x3a2a22 }, extras: foxExtras(0xd9762b, 0xf2e6d8) },
  arcticFox: { ...FOX, colors: { body: 0xeef2f5, spots: 0xd6dde3, head: 0xeef2f5, snout: 0xd6dde3, leg: 0xc8d0d8 }, extras: foxExtras(0xeef2f5, 0x3a3a3a) },
  polarBear: {
    body: [0.95, 0.9, 1.6], leg: 0.6, head: [0.55, 0.5, 0.55], headAt: [1.2, 0.98], health: 70, meat: 3, speed: 0.8,
    colors: { body: 0xf1efe6, spots: 0xe2ded0, head: 0xf1efe6, snout: 0xe2ded0, leg: 0xe2ded0 },
    extras: [...pair('head', [0.12, 0.12, 0.06], [0.2, 0.28, -0.1], 0xf1efe6), { on: 'head', size: [0.12, 0.08, 0.04], at: [0, -0.04, 0.4], color: 0x1e1e1e }],
  },
  penguin: {
    body: [0.45, 0.7, 0.4], leg: 0.12, legs: 2, legW: 0.1, head: [0.36, 0.3, 0.34], headAt: [0.98, 0.05], health: 15, meat: 1, speed: 0.6,
    colors: { body: 0x1d1f26, spots: 0x2a2d36, head: 0x1d1f26, snout: 0xf0a020, leg: 0xf0a020 },
    extras: [{ on: 'body', size: [0.32, 0.55, 0.05], at: [0, 0.45, 0.2], color: 0xf4f2ec }, ...pair('body', [0.06, 0.45, 0.25], [0.25, 0.5, 0], 0x1d1f26)],
  },
  goat: {
    body: [0.6, 0.6, 0.95], leg: 0.55, head: [0.35, 0.42, 0.42], headAt: [1.25, 0.6], health: 40, meat: 2,
    colors: { body: 0xe8e3d6, spots: 0xcfc7b4, head: 0xe8e3d6, snout: 0xcfc7b4, leg: 0xcfc7b4 },
    extras: [...pair('head', [0.08, 0.3, 0.08], [0.1, 0.32, -0.12], 0x8a7f6a), { on: 'head', size: [0.1, 0.18, 0.06], at: [0, -0.28, 0.18], color: 0xcfc7b4 }],
  },
  camel: {
    body: [0.75, 0.8, 1.6], leg: 1.0, head: [0.35, 0.35, 0.6], headAt: [2.2, 1.2], health: 60, meat: 2, speed: 0.9,
    colors: { body: 0xc9a063, spots: 0xb88f55, head: 0xc9a063, snout: 0xa67d48, leg: 0xb88f55 },
    extras: [
      { on: 'body', size: [0.3, 0.8, 0.35], at: [0, 1.85, 0.95], color: 'body' },
      { on: 'body', size: [0.5, 0.35, 0.45], at: [0, 1.95, 0.3], color: 'body' },
      { on: 'body', size: [0.5, 0.35, 0.45], at: [0, 1.95, -0.3], color: 'body' },
    ],
  },
  lizard: {
    body: [0.3, 0.16, 0.6], leg: 0.1, legW: 0.08, head: [0.22, 0.14, 0.25], headAt: [0.18, 0.4], health: 8, meat: 1, speed: 1.4,
    colors: { body: 0x7a8f3a, spots: 0x5e7030, head: 0x7a8f3a, snout: 0x6a7f30, leg: 0x5e7030 },
    extras: [{ on: 'body', size: [0.12, 0.1, 0.55], at: [0, 0.15, -0.56], color: 0x6a7f30 }],
  },
  giraffe: {
    body: [0.7, 0.8, 1.3], leg: 1.4, head: [0.3, 0.35, 0.55], headAt: [3.55, 0.95], health: 60, meat: 2, speed: 0.9,
    colors: { body: 0xe0b060, spots: 0x9a5f2a, head: 0xe0b060, snout: 0xc9984c, leg: 0xe0b060 },
    extras: [{ on: 'body', size: [0.3, 1.6, 0.3], at: [0, 2.85, 0.72], color: 'body' }, ...pair('head', [0.06, 0.15, 0.06], [0.08, 0.24, -0.12], 0x6a4020)],
  },
  panda: {
    body: [0.85, 0.75, 1.3], leg: 0.45, head: [0.55, 0.5, 0.5], headAt: [1.0, 0.82], health: 60, meat: 2, speed: 0.7,
    colors: { body: 0xf0efea, spots: 0xe4e3de, head: 0xf0efea, snout: 0xf0efea, leg: 0x1e1e1e },
    extras: [
      { on: 'body', size: [0.87, 0.77, 0.35], at: [0, 0.825, 0.35], color: 0x1e1e1e },
      ...pair('head', [0.14, 0.14, 0.08], [0.2, 0.28, -0.05], 0x1e1e1e),
      ...pair('head', [0.15, 0.15, 0.02], [0.165, 0.075, 0.255], 0x1e1e1e),
    ],
  },
  parrot: {
    body: [0.3, 0.4, 0.3], leg: 0.12, legs: 2, legW: 0.06, head: [0.24, 0.24, 0.24], headAt: [0.62, 0.1], health: 8, meat: 1,
    colors: { body: 0xd8262a, spots: 0xb81e22, head: 0xd8262a, snout: 0x3a3a3a, leg: 0x5a5a5a },
    extras: [...pair('body', [0.05, 0.32, 0.22], [0.17, 0.32, -0.02], 0x2a6fd0), { on: 'body', size: [0.12, 0.06, 0.3], at: [0, 0.22, -0.25], color: 0xf0c020 }],
  },
  frog: {
    body: [0.4, 0.22, 0.45], leg: 0.08, legW: 0.1, head: [0.38, 0.18, 0.25], headAt: [0.3, 0.26], health: 6, meat: 1,
    colors: { body: 0x5f9a3a, spots: 0x4a7d2c, head: 0x5f9a3a, snout: 0x4a7d2c, leg: 0x4a7d2c },
    extras: pair('head', [0.11, 0.1, 0.11], [0.12, 0.12, 0.02], 0x5f9a3a),
  },
  crab: {
    body: [0.55, 0.22, 0.4], leg: 0.15, legW: 0.06, head: [0.3, 0.1, 0.1], headAt: [0.32, 0.2], health: 8, meat: 1,
    colors: { body: 0xd4502a, spots: 0xb8401f, head: 0xd4502a, snout: 0xb8401f, leg: 0xb8401f },
    extras: pair('body', [0.14, 0.12, 0.18], [0.33, 0.25, 0.25], 0xd4502a),
  },
  turtle: {
    body: [0.7, 0.3, 0.8], leg: 0.12, head: [0.24, 0.2, 0.26], headAt: [0.25, 0.5], health: 30, meat: 1, speed: 0.4,
    colors: { body: 0x5a7a3a, spots: 0x3f5a28, head: 0x8fae5a, snout: 0x8fae5a, leg: 0x8fae5a },
    extras: [{ on: 'body', size: [0.55, 0.12, 0.65], at: [0, 0.48, 0], color: 0x4a6a30 }],
  },
}
// The rest of Gaymi's list (AnimalKinds.js), and health/meat from size
// for the ones that don't say.
Object.assign(KINDS, MORE_KINDS, NEW_KINDS, WILD_KINDS, CREATURE_KINDS, DINO_KINDS)
// Wolves and bears bite now (WildAnimalKinds.js).
for (const [id, h] of Object.entries(HUNTERS)) if (KINDS[id]) Object.assign(KINDS[id], { hunts: true }, h)
// Everything that attacks you looks it (2026-10-30, Gaymi: "animals that
// will just attack you make them look more scary"): darker fur, angry
// brows and a scar (faceTexture), fangs (snoutTexture and two boxes under
// the snout) and red eyes that glow in the dark (_build). Looks only -
// health and bites stay as they were.
const SCARY_DARK = 0.8
for (const k of Object.values(KINDS)) {
  if (!k.hunts) continue
  k.scary = true
  for (const part of ['body', 'spots', 'head', 'leg']) k.colors[part] = new THREE.Color(k.colors[part]).multiplyScalar(SCARY_DARK).getHex()
}
for (const k of Object.values(KINDS)) {
  const vol = k.body[0] * k.body[1] * k.body[2]
  if (k.health === undefined) k.health = Math.max(4, Math.min(70, Math.round(vol * 40) + 6))
  if (k.meat === undefined) k.meat = vol > 1 ? 2 : 1
}
// Every kind, in list order (the Map Editor's Animals list).
export const ANIMAL_IDS = Object.keys(KINDS)
// Which animals live in each biome, with how often each turns up
// (2026-10-23, Gaymi: a cow in the snowy mountains is wrong). Map 1's city
// and the plains get the farm animals; the open sea gets none.
const FARM = { cow: 3, pig: 2, sheep: 2, chicken: 2, horse: 1.5 }
export const BIOME_ANIMALS = {
  city: FARM,
  plains: FARM,
  forest: { pig: 2, chicken: 1, deer: 2, rabbit: 1, fox: 1 },
  birchForest: { deer: 2, rabbit: 2, chicken: 1 },
  darkForest: { wolf: 2, deer: 1 },
  cherryGrove: { rabbit: 2, sheep: 2, deer: 1 },
  taiga: { wolf: 2, fox: 2, deer: 1, rabbit: 1 },
  snowyTaiga: { wolf: 1, arcticFox: 2, polarBear: 1 },
  snowyPlains: { polarBear: 1, arcticFox: 2 },
  iceSpikes: { polarBear: 1, penguin: 2 },
  snowyBeach: { penguin: 3, polarBear: 1 },
  frozenOcean: { penguin: 2, polarBear: 1 },
  desert: { camel: 2, lizard: 2 },
  badlands: { lizard: 2, goat: 1 },
  savanna: { zebra: 2, giraffe: 2 },
  jungle: { parrot: 3, frog: 1 },
  bambooJungle: { panda: 3, parrot: 1 },
  swamp: { frog: 3, turtle: 1 },
  mangroveSwamp: { frog: 2, turtle: 2 },
  mushroomFields: { cow: 1, rabbit: 1 },
  mountains: { goat: 3, sheep: 1 },
  snowyPeaks: { goat: 2 },
  beach: { crab: 3, turtle: 2 },
  warmOcean: { turtle: 1, crab: 1 },
  river: { frog: 1 },
  ocean: {},
  deepOcean: {},
}
for (const [biome, ids] of [...Object.entries(MORE_BIOME_ANIMALS), ...Object.entries(NEW_BIOME_ANIMALS), ...Object.entries(WILD_BIOME_ANIMALS), ...Object.entries(CREATURE_BIOME_ANIMALS)]) {
  const table = BIOME_ANIMALS[biome] = { ...(BIOME_ANIMALS[biome] || {}) }
  for (const id of ids) table[id] = table[id] || 1
}
// The 170 newest animals' tiers (WildAnimalKinds.js).
const WILD_TIER_OF = {}
for (const tiers of [WILD_TIERS, CREATURE_TIERS]) for (const [tier, ids] of Object.entries(tiers)) for (const id of ids.split(' ')) WILD_TIER_OF[id] = tier
export const animalRarity = (kind) => WILD_TIER_OF[kind] || rarityOf(kind, KINDS[kind])
// Rarer animals turn up less often (NewAnimalKinds.js RARITIES).
for (const table of Object.values(BIOME_ANIMALS)) {
  for (const id in table) table[id] *= RARITIES[animalRarity(id)].spawn
}
export const animalNameKey = (kind) => `animal${kind[0].toUpperCase()}${kind.slice(1)}`
const nameKey = animalNameKey
// Every animal drops its own raw meat (2026-10-30, Gaymi: "every animal
// must have their own drop like a cow might drop beef"): an item per kind
// (PlayInventory.addAnimalMeat) - beef, pork, mutton, chicken, venison and
// rabbit by their real names, fish and birds as "Raw <animal>", the rest
// as "Raw <animal> Meat". The look: fish, poultry, bug or red meat.
const MEAT_NAMES = {
  invRawBeef: 'cow bull ox bison yak waterBuffalo muskox',
  invRawPork: 'pig boar warthog peccary babirusa',
  invRawMutton: 'sheep bighornSheep goat mountainGoat',
  invRawChicken: 'chicken rooster',
  invRawVenison: 'deer elk moose reindeer muntjac',
  invRawRabbit: 'rabbit hare',
}
const MEAT_KEY_OF = {}
for (const [key, ids] of Object.entries(MEAT_NAMES)) for (const id of ids.split(' ')) MEAT_KEY_OF[id] = key
// Two-legged but not birds.
const NOT_BIRDS = /monkey|ape$|gorilla|chimp|bonobo|orangutan|gibbon|baboon|mandrill|lemur|capuchin|marmoset|tamarin|colobus|gelada|tarsier|loris|ayeAye|kangaroo|wallaby|meerkat|yeti|sasquatch/i
const meatId = (kind) => `meat_${kind}`
for (const [kind, k] of Object.entries(KINDS)) {
  const bug = (k.legs === 6 || k.legs === 8) && !k.swim
  const bird = k.legs === 2 && !k.dino && !NOT_BIRDS.test(kind)
  const icon = k.swim ? 'fishMeat' : bug ? 'bugMeat' : bird ? 'poultry' : 'meat'
  addAnimalMeat(meatId(kind), { key: MEAT_KEY_OF[kind] || (k.swim || bird ? 'invRawOf' : 'invRawMeatOf'), animalKey: nameKey(kind), icon })
}
// Most placed animals in one map (BuildMode.animalSpots).
export const MAX_PLACED = 300

// A small side-on picture of an animal (the Map Editor's Animals list):
// its boxes seen from the left, drawn flat in their colours.
const _iconCache = new Map()
export function animalIconURL(kind) {
  if (_iconCache.has(kind)) return _iconCache.get(kind)
  const k = KINDS[kind]
  const S = 64
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const [, bh, bl] = k.body
  const [, hh, hl] = k.head
  const [headY, headZ] = k.headAt || [k.leg + bh * 0.75, bl / 2 + hl * 0.35]
  const boxes = [] // [zMin, zMax, yMin, yMax, color]
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
  const add = (z, y, l, h, color) => boxes.push([z - l / 2, z + l / 2, y - h / 2, y + h / 2, color])
  const legs = k.legs ?? 4
  if (legs) {
    const legW = k.legW || 0.1
    const zs = legs === 2 ? [0] : legs === 4 ? [-bl / 2 + legW, bl / 2 - legW] : [-bl * 0.35, 0, bl * 0.35]
    for (const z of zs) add(z, k.leg / 2, legW, k.leg, k.colors.leg)
  }
  add(0, k.leg + bh / 2, bl, bh, k.colors.body)
  for (const e of k.extras || []) {
    const off = e.on === 'head' ? [headZ, headY] : [0, 0]
    add(off[0] + e.at[2], off[1] + e.at[1], e.size[2], e.size[1], e.color === 'body' ? k.colors.body : e.color)
  }
  add(headZ, headY, hl, hh, k.colors.head)
  let z0 = Infinity; let z1 = -Infinity; let y0 = Infinity; let y1 = -Infinity
  for (const b of boxes) { z0 = Math.min(z0, b[0]); z1 = Math.max(z1, b[1]); y0 = Math.min(y0, b[2]); y1 = Math.max(y1, b[3]) }
  const scale = (S - 8) / Math.max(z1 - z0, y1 - y0)
  const ox = (S - (z1 - z0) * scale) / 2
  const oy = S - 4 - (S - 8 - (y1 - y0) * scale) / 2
  for (const [a, b, lo, hi, color] of boxes) {
    g.fillStyle = hex(color)
    // Facing right: the head (+z) on the right.
    g.fillRect(Math.round(ox + (a - z0) * scale), Math.round(oy - (hi - y0) * scale), Math.max(1, Math.round((b - a) * scale)), Math.max(1, Math.round((hi - lo) * scale)))
  }
  if (k.eyes !== false) {
    g.fillStyle = '#161616'
    const e = Math.max(2, Math.round(hh * scale * 0.18))
    g.fillRect(Math.round(ox + (headZ + hl * 0.25 - z0) * scale), Math.round(oy - (headY + hh * 0.2 - y0) * scale), e, e)
  }
  const url = c.toDataURL()
  _iconCache.set(kind, url)
  return url
}

// A 16x16 pixel texture: the base color with a few patches and every pixel
// a shade lighter or darker, so the boxes read as blocky fur/skin rather
// than flat plastic (was 8x8 and flat, 2026-10-26: "add more details").
function patchTexture(base, spots, seed, stripes = false) {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')
  paintFur(g, base, spots, seed, stripes)
  return pixelTexture(c)
}

function pixelTexture(c) {
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const css = (color) => `#${new THREE.Color(color).getHexString()}`
const shade = (color, f) => new THREE.Color(color).multiplyScalar(f)

function paintFur(g, base, spots, seed, stripes) {
  let r = seed
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = css(shade(base, 0.9 + rand() * 0.18 - y * 0.006))
      g.fillRect(x, y, 1, 1)
    }
  }
  g.fillStyle = css(spots)
  if (stripes) for (let x = 0; x < 16; x += 4) g.fillRect(x + (rand() < 0.5 ? 0 : 1), 0, 2, 16)
  else {
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(rand() * 15)
      const y = Math.floor(rand() * 15)
      g.fillRect(x, y, 2, 2)
      if (rand() < 0.6) g.fillRect(x + 1, y + 1, 2, 1)
    }
  }
}

// What colour the middle of an animal's eye is: amber for hunters, cats,
// birds of prey and goats; dark brown for the rest.
function irisOf(kind) {
  if (/cat|lion|tiger|leopard|cheetah|lynx|wolf|fox|owl|eagle|hawk|falcon|snake|croc|alligator|lizard|goat|frog|jaguar|panther|cougar|hyena/.test(kind)) return 0xd8a020
  if (/husky/.test(kind)) return 0x5aa0e0
  return 0x4a2e18
}

// The head's front: its fur with two proper eyes painted on - a white with
// a coloured middle, a dark pupil, a shine and a brow over it (Minecraft/
// Bloxd style), not a black dot.
function faceTexture(kind, k, seed) {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')
  g.scale(2, 2)
  paintFur(g, k.colors.head, k.colors.spots, seed, false)
  g.setTransform(1, 0, 0, 1, 0, 0)
  if (k.eyes === false) return pixelTexture(c)
  const [hw] = k.head
  const ew = hw > 0.6 ? 4 : hw > 0.3 ? 6 : 8 // eye width in pixels (of 32)
  const eh = Math.max(3, Math.round(ew * 0.8))
  const iris = k.scary ? 0xe0201a : irisOf(kind)
  const slit = /goat|sheep/.test(kind) || k.scary
  for (const side of [-1, 1]) {
    const cx = Math.round(16 + side * 9.6)
    const x = cx - ew / 2
    const y = 8
    g.fillStyle = css(shade(k.colors.head, 0.55)) // brow
    if (k.scary) {
      // Angry: the brow slopes down toward the nose, over the eye's top.
      for (let i = 0; i < ew + 2; i++) g.fillRect(x - 1 + i, y - 2 + Math.round(((side < 0 ? i : ew + 1 - i) / (ew + 1)) * 2), 1, 2)
    } else g.fillRect(x - 1, y - 2, ew + 2, 1)
    g.fillStyle = '#f2efe6' // white
    g.fillRect(x, y, ew, eh)
    g.fillStyle = css(iris)
    const iw = Math.max(2, Math.round(ew * 0.6))
    const ix = side < 0 ? x + ew - iw : x // looking forward and a little in
    g.fillRect(ix, y, iw, eh)
    g.fillStyle = '#111111'
    if (slit) g.fillRect(ix, y + Math.floor(eh / 2), iw, 1)
    else g.fillRect(ix + Math.floor(iw / 4), y + Math.floor(eh / 4), Math.max(1, Math.ceil(iw / 2)), Math.max(2, Math.ceil(eh / 2)))
    g.fillStyle = '#ffffff' // shine
    g.fillRect(ix + Math.floor(iw / 4), y + Math.floor(eh / 4), 1, 1)
    g.fillStyle = css(shade(k.colors.head, 0.7)) // lower lid
    g.fillRect(x, y + eh, ew, 1)
  }
  if (k.scary) {
    // An old scar down one side of the face.
    g.fillStyle = css(shade(k.colors.head, 1.6))
    for (let i = 0; i < 9; i++) g.fillRect(4 + Math.floor(i / 2), 4 + i * 2, 1, 2)
  }
  return pixelTexture(c)
}

// The snout's front: nostrils and a mouth.
function snoutTexture(k) {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')
  for (let y = 0; y < 16; y++) {
    g.fillStyle = css(shade(k.colors.snout, 1.04 - y * 0.012))
    g.fillRect(0, y, 16, 1)
  }
  const dark = css(shade(k.colors.snout, 0.35))
  g.fillStyle = dark
  g.fillRect(3, 3, 3, 3)
  g.fillRect(10, 3, 3, 3)
  g.fillRect(4, 11, 8, 1)
  g.fillRect(3, 10, 1, 1)
  g.fillRect(12, 10, 1, 1)
  g.fillRect(7, 8, 2, 3)
  if (k.scary) {
    // Bared teeth: a dark mouth full of white points, two big fangs.
    g.fillRect(2, 11, 12, 4)
    g.fillStyle = '#f2ecdc'
    for (let x = 3; x < 13; x += 2) g.fillRect(x, 11, 1, 2)
    g.fillRect(3, 11, 2, 4)
    g.fillRect(11, 11, 2, 4)
  }
  return pixelTexture(c)
}

// The name over every animal (2026-10-26, Gaymi: "add the animal's name
// above them", picked "always"): its name in white and its rarity under
// it in the rarity's colour, on a soft dark plate. One picture per name
// (and language), shared by every animal of that kind.
const TAG_W = 256
const TAG_H = 80
const _tagCache = new Map()
function tagMaterial(kind) {
  const name = t(nameKey(kind))
  const tier = animalRarity(kind)
  const label = t(`rarity${tier[0].toUpperCase()}${tier.slice(1)}`)
  const key = `${name}|${label}|${tier}`
  if (_tagCache.has(key)) return _tagCache.get(key)
  const c = document.createElement('canvas')
  c.width = TAG_W
  c.height = TAG_H
  const g = c.getContext('2d')
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 34px sans-serif'
  const w = Math.min(TAG_W - 4, Math.max(g.measureText(name).width, 90) + 28)
  g.fillStyle = 'rgba(0, 0, 0, 0.45)'
  g.beginPath()
  g.roundRect((TAG_W - w) / 2, 2, w, TAG_H - 4, 16)
  g.fill()
  g.lineWidth = 5
  g.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  g.fillStyle = '#ffffff'
  g.strokeText(name, TAG_W / 2, 27, TAG_W - 12)
  g.fillText(name, TAG_W / 2, 27, TAG_W - 12)
  g.font = 'bold 28px sans-serif'
  g.fillStyle = RARITIES[tier].color
  g.strokeText(label, TAG_W / 2, 60, TAG_W - 12)
  g.fillText(label, TAG_W / 2, 60, TAG_W - 12)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
  _tagCache.set(key, mat)
  return mat
}
// Tag size in blocks up close; further than TAG_NEAR it grows with the
// distance so it stays the same size on screen and readable.
const TAG_SIZE = 1.7
const TAG_NEAR = 10

export class PlayAnimals {
  // For tests.
  static BIOME_ANIMALS = BIOME_ANIMALS
  static KINDS = KINDS
  static NEW_KINDS = NEW_KINDS
  static WILD_KINDS = WILD_KINDS
  static HUNTERS = HUNTERS
  static rarityOf = animalRarity
  static STRINGS = STRINGS

  constructor(survival) {
    this.s = survival
    this.list = []
    this._spawnIn = 0
    this._parts = {}
    this._aid = 0
  }

  get _net() {
    const net = this.s.net
    return net && !net.closed ? net : null
  }

  get bm() {
    return this.s.bm
  }

  // Shared boxes and materials for one kind (made once per look). On the
  // In Real Life graphics level the boxes have rounded edges, so the
  // animals look softer and rounder (2026-10-26, Gaymi picked "minecraft/
  // bloxd style and rounder in real life").
  _kindParts(kind) {
    const round = this.bm?.game?.settings?.graphicsLevel === 'irl'
    const key = round ? `${kind}:round` : kind
    if (this._parts[key]) return this._parts[key]
    const k = KINDS[kind]
    const B = this.s.B
    const mat = (color, tex) => new THREE.MeshLambertMaterial({ color: tex ? 0xffffff : color, map: tex || null })
    const box = (w, h, l) => {
      const r = Math.min(w, h, l) * B * 0.28
      return round && r > 0.004 ? new RoundedBoxGeometry(w * B, h * B, l * B, 2, r) : new THREE.BoxGeometry(w * B, h * B, l * B)
    }
    const [bw, bh, bl] = k.body
    const [hw, hh, hl] = k.head
    const legW = k.legW || Math.min(0.25, bw * 0.3)
    const bodyMat = mat(k.colors.body, patchTexture(k.colors.body, k.colors.spots, kind.length * 97, k.stripes))
    const headMat = mat(k.colors.head, patchTexture(k.colors.head, k.colors.spots, kind.length * 131))
    const snoutMat = mat(k.colors.snout)
    const colorMats = new Map()
    // Hooves on long legs, paws (a darker shade of the leg) on short ones.
    const footH = Math.min(0.1, k.leg * 0.22)
    const p = {
      body: box(bw, bh, bl),
      head: box(hw, hh, hl),
      snout: box(hw * 0.55, hh * 0.35, 0.12),
      leg: box(legW, k.leg, legW),
      foot: box(legW * 1.12, footH, legW * 1.12),
      footH,
      collar: box(hw * 1.08, 0.08, hl * 0.5),
      bodyMat,
      // Box faces: +x, -x, +y, -y, front (+z), back.
      headMat: [headMat, headMat, headMat, headMat, mat(k.colors.head, faceTexture(kind, k, kind.length * 131)), headMat],
      snoutMat: [snoutMat, snoutMat, snoutMat, snoutMat, mat(k.colors.snout, snoutTexture(k)), snoutMat],
      legMat: mat(k.colors.leg, patchTexture(k.colors.leg, k.colors.leg, kind.length * 53)),
      footMat: mat(k.leg > 0.5 ? 0x2e2620 : shade(k.colors.leg, 0.6)),
      collarMat: mat(0xc0282a),
      // Scary ones: glowing red eyes (unlit, so they show in the dark) and fangs.
      eye: k.scary ? new THREE.BoxGeometry(hw * 0.13 * B, hh * 0.1 * B, 0.01 * B) : null,
      eyeMat: k.scary ? new THREE.MeshBasicMaterial({ color: 0xff2a1a }) : null,
      fang: k.scary ? box(hw * 0.07, hh * 0.22, hw * 0.07) : null,
      fangMat: k.scary ? mat(0xf2ecdc) : null,
      legW,
      // Extra boxes (ears, tails, necks, horns...), same order as k.extras.
      extras: (k.extras || []).map((e) => {
        if (e.color !== 'body' && !colorMats.has(e.color)) colorMats.set(e.color, mat(e.color, patchTexture(e.color, e.color, e.size.length * 71)))
        return { geo: box(...e.size), mat: e.color === 'body' ? bodyMat : colorMats.get(e.color) }
      }),
    }
    this._parts[key] = p
    return p
  }

  _build(kind) {
    const k = KINDS[kind]
    const p = this._kindParts(kind)
    const B = this.s.B
    const [bw, bh, bl] = k.body
    const [, hh, hl] = k.head
    const group = new THREE.Group()
    const body = new THREE.Mesh(p.body, p.bodyMat)
    body.position.y = (k.leg + bh / 2) * B
    group.add(body)
    // Head at the front (+z), a little above the body's middle.
    const head = new THREE.Group()
    const [headY, headZ] = k.headAt || [k.leg + bh * 0.75, bl / 2 + hl * 0.35]
    head.position.set(0, headY * B, headZ * B)
    head.add(new THREE.Mesh(p.head, p.headMat))
    const snout = new THREE.Mesh(p.snout, p.snoutMat)
    snout.position.set(0, -hh * 0.18 * B, (hl / 2 + 0.05) * B)
    head.add(snout)
    if (p.eye) {
      // Over the painted eyes (faceTexture puts them 0.3 of the way out).
      const hw = k.head[0]
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(p.eye, p.eyeMat)
        eye.position.set(side * hw * 0.3 * B, hh * 0.18 * B, (hl / 2 + 0.006) * B)
        head.add(eye)
        const fang = new THREE.Mesh(p.fang, p.fangMat)
        fang.position.set(side * hw * 0.17 * B, -hh * 0.42 * B, (hl / 2 + 0.06) * B)
        head.add(fang)
      }
    }
    const collar = new THREE.Mesh(p.collar, p.collarMat)
    collar.position.set(0, -hh * 0.5 * B, -hl * 0.15 * B)
    collar.visible = false
    head.add(collar)
    group.add(head)
    ;(k.extras || []).forEach((e, i) => {
      const m = new THREE.Mesh(p.extras[i].geo, p.extras[i].mat)
      m.position.set(e.at[0] * B, e.at[1] * B, e.at[2] * B)
      ;(e.on === 'head' ? head : group).add(m)
    })
    // Four legs (two for birds, six or eight for bugs, none for snakes and
    // sea animals), turning at the hip.
    const legs = []
    const n = k.legs ?? 4
    const spots = n === 2 ? [[-bw * 0.25, 0], [bw * 0.25, 0]]
      : n === 4 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [sx * (bw / 2 - p.legW / 2), sz * (bl / 2 - p.legW)])
        : Array.from({ length: n }, (_, i) => [(i % 2 ? 1 : -1) * (bw / 2 + p.legW), (Math.floor(i / 2) / (n / 2 - 1) - 0.5) * bl * 0.8])
    for (const [lx, lz] of spots) {
      const hip = new THREE.Group()
      hip.position.set(lx * B, k.leg * B, lz * B)
      const leg = new THREE.Mesh(p.leg, p.legMat)
      leg.position.y = (-k.leg / 2) * B
      hip.add(leg)
      if (k.leg > 0.05) {
        const foot = new THREE.Mesh(p.foot, p.footMat)
        foot.position.y = (-k.leg + p.footH / 2) * B
        hip.add(foot)
      }
      group.add(hip)
      legs.push(hip)
    }
    // The name tag, just over the highest part.
    let top = Math.max(k.leg + bh, headY + hh / 2)
    for (const e of k.extras || []) top = Math.max(top, (e.on === 'head' ? headY : 0) + e.at[1] + e.size[1] / 2)
    const tag = new THREE.Sprite(tagMaterial(kind))
    tag.center.set(0.5, 0)
    tag.position.y = (top + 0.25) * B
    tag.renderOrder = 5
    group.add(tag)
    return { group, head, legs, collar, tag }
  }

  // Keeps every name tag readable: same size on screen beyond TAG_NEAR,
  // and gone while the animal falls over.
  _sizeTags() {
    const cam = this.bm.camera?.position
    if (!cam) return
    const B = this.s.B
    for (const a of this.list) {
      if (!a.tag) continue
      a.tag.visible = !a.dying
      const d = Math.hypot(a.x * B - cam.x, a.y * B - cam.y, a.z * B - cam.z) / B
      const w = TAG_SIZE * Math.max(1, d / TAG_NEAR) * B
      a.tag.scale.set(w, w * (TAG_H / TAG_W), 1)
    }
  }

  // --- each frame ---

  // wild: false in the Map Editor - only the animals placed there move.
  update(dt, { wild: spawnWild = true } = {}) {
    const bm = this.bm
    const s = this.s
    const here = bm.tryMode.pos // spawning follows the camera too (spectating)
    const me = s.bodyPos()
    // On a server (as the host): around everyone, not just me.
    const others = this._net?.targets() || []
    const centers = [here, ...others]
    this._spawnIn -= dt
    const wild = this.list.filter((a) => !a.tamed && !a.dying && !a.placed)
    const most = others.length ? Math.min(MAX_SHARED - 4, MAX_WILD + others.length * 4) : MAX_WILD
    if (spawnWild && bm.world?.active && this._spawnIn <= 0 && wild.length < most) {
      this._spawnIn = SPAWN_EVERY_S
      this._spawnGroup(centers[Math.floor(Math.random() * centers.length)])
    }
    // Who the meat-eating dinosaurs can go for: me (playing, alive) and,
    // as a server's host, the other players.
    this._prey = s.active && !s.dead && !s.spectating ? [me, ...others] : others
    for (const a of [...this.list]) {
      if (a.dying) {
        a.dieT += dt
        a.group.rotation.z = Math.min(1, a.dieT / 0.35) * (Math.PI / 2)
        if (a.dieT > DIE_S) this._remove(a)
        continue
      }
      if (!a.tamed && !a.placed && centers.every((c) => Math.hypot(a.x - c.x, a.z - c.z) > DESPAWN)) {
        this._remove(a)
        continue
      }
      // Another player's pet follows them.
      const owner = a.owner && this._net?.players.get(a.owner)
      this._step(a, dt, owner?.seen ? owner : me)
    }
    this._sizeTags()
  }

  _step(a, dt, me) {
    const s = this.s
    const B = s.B
    let speed = 0
    let hunting
    const dx = me.x - a.x
    const dz = me.z - a.z
    const dist = Math.hypot(dx, dz)
    if (a.tamed) {
      if (dist > PET_TELEPORT) {
        // Left far behind: catches up at once, just behind you.
        a.x = me.x - (dx / dist) * 2
        a.z = me.z - (dz / dist) * 2
        a.y = s._groundUnder(a.x, me.y + 3, a.z)
      } else if (dist > PET_NEAR) {
        a.heading = Math.atan2(dx, dz)
        speed = dist > 8 ? RUN : WALK * 2
      }
    } else if (KINDS[a.kind].hunts && (hunting = this._hunt(a, dt))) {
      speed = hunting === 'chase' ? RUN : 0
    } else if (a.flee > 0) {
      a.flee -= dt
      a.heading = Math.atan2(-dx, -dz) + Math.sin(a.flee * 3) * 0.4
      speed = RUN
    } else if (!a.placed && this._panicking(a, dt)) {
      const z = a.scaredBy
      if (CIRCLERS.has(a.kind)) {
        a.heading += dt * 7
        speed = RUN * 0.8
      } else if (STARERS.has(a.kind)) a.heading = Math.atan2(z.x - a.x, z.z - a.z)
      else {
        a.heading = Math.atan2(a.x - z.x, a.z - z.z) + Math.sin(a.panic * 9) * 0.6
        speed = RUN
      }
    } else {
      a.think -= dt
      if (a.think <= 0) {
        a.think = 2 + Math.random() * 4
        a.walking = Math.random() < 0.6
        if (a.walking) a.heading = Math.random() * Math.PI * 2
      }
      if (a.walking) speed = WALK
    }
    const k = KINDS[a.kind]
    speed *= k.speed || 1
    if (k.swim) {
      this._swim(a, dt, speed)
      return
    }
    if (speed > 0) {
      const nx = a.x + Math.sin(a.heading) * speed * dt
      const nz = a.z + Math.cos(a.heading) * speed * dt
      const lift = k.fly || 0
      const ground = s._groundUnder(nx, a.y - lift + 1.1, nz)
      const wet = this.bm._cellIsLiquid(Math.floor(nx), Math.floor(ground + 0.01), Math.floor(nz))
      // Big dinosaurs step over a two-block wall.
      const step = k.leg > 1.5 ? 2.05 : 1.05
      if (ground > a.y - lift + step || (!lift && ground < a.y - 3) || (wet && !lift)) {
        // A wall, a drop or water: turn and try another way.
        a.heading += Math.PI * (0.5 + Math.random())
        a.think = Math.min(a.think, 0.5)
      } else {
        a.x = nx
        a.z = nz
        a.groundY = ground
      }
    } else a.groundY = s._groundUnder(a.x, a.y - (k.fly || 0) + 0.5, a.z)
    // Falls, or steps up onto the next block. Flyers hover above it,
    // bobbing.
    const goal = a.groundY + (k.fly ? k.fly + Math.sin(a.walk * 0.4 + a.seed) * 0.3 : 0)
    a.y += (goal - a.y) * Math.min(1, dt * (goal > a.y ? 14 : k.fly ? 3 : 8))
    a.walk += dt * speed * 5
    const swing = speed > 0 ? Math.sin(a.walk) * 0.7 : 0
    a.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 === (i < 2 ? 0 : 1) ? 1 : -1) * swing })
    // Turns smoothly toward where it's going; a hit makes it jolt.
    let turn = a.heading - a.group.rotation.y
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    a.group.rotation.y += turn * Math.min(1, dt * 8)
    a.hurt = Math.max(0, a.hurt - dt)
    a.group.rotation.x = -a.hurt * 1.2
    a.head.rotation.x = speed === 0 && !a.tamed ? Math.max(0, Math.sin(a.walk * 0.1 + a.seed)) * 0.5 : 0
    // A bite snaps the head down.
    if (a.biteT > 0) {
      a.biteT -= dt
      a.head.rotation.x = Math.sin(Math.max(0, a.biteT) / 0.25 * Math.PI) * 0.5
    }
    // Panicking ones hop as they run (a staring cow just stands there).
    const hop = a.panic > 0 && speed > 0 ? Math.abs(Math.sin(a.walk * 0.9)) * 0.3 : 0
    a.group.position.set(a.x * B, (a.y + hop) * B, a.z * B)
  }

  // Is a zombie close enough to panic this animal? Looks every
  // PANIC_LOOK_S, keeps a.scaredBy (that zombie) and a.panic (seconds
  // left). Wild animals only; dinosaurs that hunt never get here.
  _panicking(a, dt) {
    a.panic = Math.max(0, (a.panic || 0) - dt)
    a.panicLook = (a.panicLook || Math.random() * PANIC_LOOK_S) - dt
    if (a.panicLook <= 0) {
      a.panicLook = PANIC_LOOK_S
      let best = PANIC_RANGE
      for (const z of this.s.zombies || []) {
        if (z.health <= 0 || z.hidden || Math.abs(z.y - a.y) > 4) continue
        const d = Math.hypot(z.x - a.x, z.z - a.z)
        if (d < best) {
          best = d
          a.scaredBy = z
          a.panic = PANIC_S
        }
      }
    }
    return a.panic > 0 && !!a.scaredBy
  }

  // A meat-eating dinosaur: heads for the nearest player it can see and
  // bites when its snout is close. 'chase', 'bite' (close: stands and
  // snaps instead of pushing into you) or null (nobody near: it wanders).
  _hunt(a, dt) {
    const k = KINDS[a.kind]
    a.biteIn = Math.max(0, (a.biteIn || 0) - dt)
    a.angry = Math.max(0, (a.angry || 0) - dt)
    const range = a.angry > 0 ? ANGRY_RANGE : (k.huntRange ?? HUNT_RANGE)
    let prey = null
    let best = range
    for (const p of this._prey || []) {
      const d = Math.hypot(p.x - a.x, p.z - a.z)
      if (d < best && Math.abs(p.y - a.y) < 10) {
        best = d
        prey = p
      }
    }
    if (!prey) return null
    a.heading = Math.atan2(prey.x - a.x, prey.z - a.z)
    // Its snout: the front of its head.
    const [headY, headZ] = k.headAt || [k.leg + k.body[1] * 0.75, k.body[2] / 2 + k.head[2] * 0.35]
    const snout = headZ + k.head[2] / 2
    if (best < snout + BITE_REACH && prey.y < a.y + headY + 1 && a.biteIn <= 0) {
      a.biteIn = BITE_EVERY_S
      a.biteT = 0.25
      const s = this.s
      if (prey.remote) {
        if (!s.camp?.inside(prey.x, prey.z)) s.net?.queueHurt(prey.remote, k.bite)
      } else s._hurtPlayer(k.bite)
    }
    return best > snout + BITE_REACH * 0.5 ? 'chase' : 'bite'
  }

  // In water: no gravity, it only goes where there is still water (and
  // on land - placed there in the Map Editor - it just stays put).
  _swim(a, dt, speed) {
    const B = this.s.B
    const k = KINDS[a.kind]
    const mid = a.y + k.body[1] / 2
    if (speed > 0) {
      const nx = a.x + Math.sin(a.heading) * speed * dt
      const nz = a.z + Math.cos(a.heading) * speed * dt
      if (this.bm._cellIsLiquid(Math.floor(nx), Math.floor(mid), Math.floor(nz))) {
        a.x = nx
        a.z = nz
      } else {
        a.heading += Math.PI * (0.5 + Math.random())
        a.think = Math.min(a.think, 0.5)
      }
    }
    a.walk += dt * (speed + 0.5) * 3
    let turn = a.heading - a.group.rotation.y
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    a.group.rotation.y += turn * Math.min(1, dt * 4)
    a.hurt = Math.max(0, a.hurt - dt)
    a.group.rotation.x = -a.hurt * 1.2
    // A slow sway, like swimming.
    a.group.rotation.z = Math.sin(a.walk * 0.5) * 0.08
    a.group.position.set(a.x * B, (a.y + Math.sin(a.walk * 0.3 + a.seed) * 0.08) * B, a.z * B)
  }

  // The water at a column: { floor, top } (top = the water's surface), or
  // null if there's none there.
  _waterAt(x, z, fromY) {
    const floor = this.s._groundUnder(x, fromY, z)
    const fx = Math.floor(x)
    const fz = Math.floor(z)
    let y = Math.floor(floor + 0.01)
    if (!this.bm._cellIsLiquid(fx, y, fz)) return null
    while (this.bm._cellIsLiquid(fx, y, fz) && y < floor + 64) y++
    return { floor, top: y }
  }

  // Where a swimmer sits in some water: just under the surface, never
  // through the bottom (null if the water's too shallow for it).
  _swimY(kind, w) {
    const h = KINDS[kind].body[1]
    if (w.top - w.floor < Math.max(1, h * 0.8)) return null
    return Math.max(w.floor + 0.05, w.top - h - 0.3)
  }

  // Which kind turns up at a spot: one that lives in its biome (null on
  // the open sea). wet: only swimmers (the spot is water), else only the
  // ones that live on land.
  kindAt(x, z, wet = false) {
    const fx = Math.floor(x)
    const fz = Math.floor(z)
    const biome = inCity(fx, fz) ? 'city' : sampleLand(fx, fz).biome
    // Now and then (DINO_CHANCE) a dinosaur that lives here instead.
    const dinos = !wet && DINO_BIOMES[biome]
    // 10x luck after an impact (Luck.js): rarer ones far more often.
    if (dinos && Math.random() < DINO_CHANCE * luck.mult()) return dinos[Math.floor(Math.random() * dinos.length)]
    const all = luckyWeights(BIOME_ANIMALS[biome] || {}, animalRarity)
    const table = {}
    for (const id in all) if (!!KINDS[id].swim === wet) table[id] = all[id]
    const ids = Object.keys(table)
    let r = Math.random() * ids.reduce((sum, id) => sum + table[id], 0)
    for (const id of ids) {
      r -= table[id]
      if (r < 0) return id
    }
    return ids[0] || null
  }

  // A small group of one kind somewhere on dry land a way off.
  _spawnGroup(p) {
    const s = this.s
    const ang = Math.random() * Math.PI * 2
    const d = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN)
    const cx = p.x + Math.cos(ang) * d
    const cz = p.z + Math.sin(ang) * d
    const water = this._waterAt(cx, cz, p.y + 24)
    const kind = this.kindAt(cx, cz, !!water)
    if (!kind) return 0
    if (water) {
      // Fish and whales: one to three in the water there.
      let made = 0
      const n = 1 + Math.floor(Math.random() * 3)
      for (let i = 0; i < n; i++) {
        const x = cx + (Math.random() - 0.5) * 6
        const z = cz + (Math.random() - 0.5) * 6
        const w = this._waterAt(x, z, p.y + 24)
        const y = w && this._swimY(kind, w)
        if (y === null || y === undefined) continue
        this.spawn(kind, x, y, z)
        made++
      }
      return made
    }
    // Dinosaurs come alone.
    const n = KINDS[kind].dino ? 1 : 1 + Math.floor(Math.random() * 3)
    let made = 0
    for (let i = 0; i < n && this.list.length < MAX_WILD + 20; i++) {
      const x = cx + (Math.random() - 0.5) * 6
      const z = cz + (Math.random() - 0.5) * 6
      const y = s._groundUnder(x, p.y + 24, z)
      if (Math.abs(y - p.y) > 24) continue
      // Not in water, and room to stand.
      if (this.bm._cellIsLiquid(Math.floor(x), Math.floor(y + 0.01), Math.floor(z))) continue
      if (this.bm.getBlockAt(Math.floor(x), Math.floor(y + 0.01), Math.floor(z))) continue
      this.spawn(kind, x, y, z)
      made++
    }
    return made
  }

  // placed: one put down in the Map Editor (BuildMode.animalSpots) - it
  // never wanders off for good and comes back on every reset.
  spawn(kind, x, y, z, placed = false) {
    const k = KINDS[kind]
    const built = this._build(kind)
    const a = {
      kind, x, y, z, groundY: y, heading: Math.random() * Math.PI * 2, think: Math.random() * 2,
      walking: false, walk: 0, flee: 0, hurt: 0, health: k.health, tamed: false, dying: false, dieT: 0,
      seed: Math.random() * 6, placed, netId: `a${++this._aid}`, owner: null, ...built,
    }
    a.group.rotation.y = a.heading
    a.group.position.set(x * this.s.B, y * this.s.B, z * this.s.B)
    this.bm.scene.add(a.group)
    this.list.push(a)
    return a
  }

  _remove(a) {
    a.group.removeFromParent()
    const i = this.list.indexOf(a)
    if (i >= 0) this.list.splice(i, 1)
  }

  // --- shots, throws and taming ---

  _box(a, box) {
    const k = KINDS[a.kind]
    const B = this.s.B
    const half = Math.max(k.body[0], k.body[2]) / 2
    box.min.set((a.x - half) * B, a.y * B, (a.z - half) * B)
    const top = Math.max(k.leg + k.body[1], (k.headAt ? k.headAt[0] : k.leg + k.body[1] * 0.75) + k.head[1] / 2)
    box.max.set((a.x + half) * B, (a.y + top) * B, (a.z + half) * B)
    return box
  }

  // The nearest animal on a ray (world units), within maxDist.
  _onRay(ray, maxDist, { wildOnly = false } = {}) {
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    let best = null
    let bestD = maxDist
    for (const a of this.list) {
      if (a.dying || (wildOnly && a.tamed)) continue
      if (!ray.intersectBox(this._box(a, box), hit)) continue
      const d = hit.distanceTo(ray.origin)
      if (d < bestD) {
        bestD = d
        best = a
      }
    }
    this._rayDist = bestD
    return best
  }

  // A shot or a thrown knife: true if it hit an animal (pets are never hurt).
  // weaponId: the picture beside the damage number.
  hitRay(ray, maxDist, damage, weaponId = '') {
    const a = this._onRay(ray, maxDist, { wildOnly: true })
    if (!a) return false
    const k = KINDS[a.kind]
    this.s.damageNumbers?.show(a.x, a.y + k.leg + k.body[1], a.z, damage, weaponId)
    const net = this._net
    if (net && !net.isHost) {
      // The host's animal: it takes the hit there (and tells everyone).
      net.queueAnimalHit(a.netId, damage)
      a.hurt = 0.25
      a.myHitAt = performance.now()
      return true
    }
    this.damage(a, damage)
    return true
  }

  // by: on a server, the other player whose shot this was (they get the meat).
  damage(a, amount, by = null) {
    if (a.dying || a.tamed) return
    a.health -= amount
    a.hurt = 0.25
    // A meat-eating dinosaur gets angry instead of running.
    if (KINDS[a.kind].hunts) a.angry = ANGRY_S
    else a.flee = FLEE_S
    if (a.health > 0) return
    a.dying = true
    a.legs.forEach((leg) => { leg.rotation.x = 0 })
    // Meat pops out where it fell.
    if (!by) this._dropMeat(a)
  }

  _dropMeat(a) {
    for (let i = 0; i < KINDS[a.kind].meat; i++) this.s._drops?.spawnItem(meatId(a.kind), Math.floor(a.x), a.y, Math.floor(a.z))
  }

  // The Use key on an animal you're looking at: tamed.
  use() {
    const bm = this.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const a = this._onRay(bm._raycaster.ray, TAME_REACH * this.s.B, { wildOnly: true })
    // Dinosaurs can't be tamed.
    if (!a || KINDS[a.kind].dino) return false
    // On a server and not the host: the host tames it for me.
    const net = this._net
    if (net && !net.isHost) net.queueAnimalHit(a.netId, 0, true)
    a.tamed = true
    a.flee = 0
    a.collar.visible = true
    this.s._message(t('animalTamed', { name: t(nameKey(a.kind)) }))
    return true
  }

  // Everything goes, then the Map Editor's placed animals come back where
  // they were put (a new game, back to editing).
  clear() {
    this.clearAll()
    for (const spot of this.bm.animalSpots || []) this.placeAt(spot)
  }

  clearAll() {
    for (const a of [...this.list]) this._remove(a)
    this._spawnIn = 0
  }

  // A Map Editor spot { kind, x, y, z } (y: the ground under it). A
  // swimmer put in water goes just under the surface.
  placeAt(spot) {
    if (!KINDS[spot.kind]) return null
    let y = spot.y
    if (KINDS[spot.kind].swim) {
      const w = this._waterAt(spot.x, spot.z, spot.y + 2)
      const sy = w && this._swimY(spot.kind, w)
      if (sy !== null && sy !== undefined) y = sy
    }
    const a = this.spawn(spot.kind, spot.x, y, spot.z, true)
    a.spot = spot
    return a
  }

  // The animal the camera is looking at within reach (the Map Editor's
  // left-click takes a placed one away).
  aimed(reach) {
    const bm = this.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const a = this._onRay(bm._raycaster.ray, reach * this.s.B)
    return a ? { animal: a, dist: this._rayDist } : null
  }

  remove(a) {
    this._remove(a)
  }

  // --- servers (PlayNet.js) ---

  // The host: every animal, keyed by its id (pets and nearest first).
  snapshot() {
    const me = this.s.bodyPos()
    const order = [...this.list].sort((a, b) => (b.tamed - a.tamed) || (Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z)))
    const out = {}
    for (const a of order.slice(0, MAX_SHARED)) {
      out[a.netId] = { k: a.kind, x: +a.x.toFixed(2), y: +a.y.toFixed(2), z: +a.z.toFixed(2), h: +a.group.rotation.y.toFixed(2), hp: Math.round(a.health), t: a.tamed ? a.owner || 'h' : '', d: a.dying }
    }
    return out
  }

  // The host: another player's shot on (or taming of) one of my animals.
  remoteHit(h) {
    const a = this.list.find((o) => o.netId === h.id)
    if (!a || a.dying) return
    if (h.tame) {
      if (a.tamed) return
      a.tamed = true
      a.owner = h.by
      a.flee = 0
      a.collar.visible = true
      return
    }
    this.damage(a, Number(h.dmg) || 0, h.by)
  }

  // Not the host: the host's animals (made, moved, removed).
  applySnapshot(map) {
    const seen = new Set()
    for (const [id, d] of Object.entries(map)) {
      if (!KINDS[d.k]) continue
      seen.add(id)
      let a = this.list.find((o) => o.netId === id)
      if (a && a.kind !== d.k) {
        this._remove(a)
        a = null
      }
      if (!a) {
        a = this.spawn(d.k, d.x, d.y, d.z)
        a.netId = id
        a.group.rotation.y = d.h
      }
      a.mirror = true
      a.tx = d.x
      a.ty = d.y
      a.tz = d.z
      a.th = d.h
      if (d.hp < a.health) a.hurt = 0.25
      a.health = d.hp
      a.tamed = !!d.t
      a.collar.visible = !!d.t
      if (d.d && !a.dying) this._mirrorDies(a)
    }
    for (const a of [...this.list]) {
      if (seen.has(a.netId) || a.dying) continue
      // Gone from the host's list: died unseen (a kill of mine still gives
      // me the meat) or wandered off.
      if (a.myHitAt && performance.now() - a.myHitAt < MY_KILL_MS) this._dropMeat(a)
      this._remove(a)
    }
  }

  _mirrorDies(a) {
    a.dying = true
    a.legs.forEach((leg) => { leg.rotation.x = 0 })
    if (a.myHitAt && performance.now() - a.myHitAt < MY_KILL_MS) this._dropMeat(a)
  }

  // Not the host, each frame: slide the host's animals to where they are.
  updateMirror(dt) {
    const B = this.s.B
    const k = 1 - Math.exp(-10 * dt)
    for (const a of [...this.list]) {
      if (a.dying) {
        a.dieT += dt
        a.group.rotation.z = Math.min(1, a.dieT / 0.35) * (Math.PI / 2)
        if (a.dieT > DIE_S) this._remove(a)
        continue
      }
      if (a.tx === undefined) continue
      const ox = a.x
      const oz = a.z
      a.x += (a.tx - a.x) * k
      a.y += (a.ty - a.y) * k
      a.z += (a.tz - a.z) * k
      const speed = dt > 0 ? Math.hypot(a.x - ox, a.z - oz) / dt : 0
      a.walk += dt * speed * 5
      const swing = speed > 0.2 ? Math.sin(a.walk) * 0.7 : 0
      a.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 === (i < 2 ? 0 : 1) ? 1 : -1) * swing })
      let turn = (a.th || 0) - a.group.rotation.y
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      a.group.rotation.y += turn * k
      a.hurt = Math.max(0, a.hurt - dt)
      a.group.rotation.x = -a.hurt * 1.2
      a.group.position.set(a.x * B, a.y * B, a.z * B)
    }
    this._sizeTags()
  }

  // I just became the host: the animals I was mirroring are mine to run.
  takeOver() {
    for (const a of this.list) {
      a.mirror = false
      if (a.tx !== undefined) {
        a.x = a.tx
        a.y = a.ty
        a.z = a.tz
        a.groundY = a.ty
      }
      a.heading = a.group.rotation.y
      this._aid = Math.max(this._aid, Number(String(a.netId).slice(1)) || 0)
    }
  }
}
