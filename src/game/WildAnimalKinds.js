// 170 more animals (2026-10-26, Gaymi: "add more animals ... make all
// animals you can possible think of like 100+ new animals", plus land,
// sea, cold and dangerous ones). Same blocky boxes and numbers as
// AnimalKinds.js (body [w, h, l], leg height, head [w, h, l], optional
// headAt [y, z], colors [body, spots, head, snout, leg], extras), but most
// are made from a body plan below (a cat, an antelope, a songbird, a fish...)
// scaled to the animal's real size and painted its colours, so 170 of them
// stay the same style without 110 hand-built shapes.
//
// hunts: attacks a player who comes within huntRange blocks and bites for
// `bite` (PlayAnimals._hunt, like the meat-eating dinosaurs) - shooting it
// makes it angry instead of running. HUNTERS also turns the wolves, bears
// and polar bears that were already in the game dangerous.
const pair = (on, size, [x, y, z], color) => [{ on, size, at: [-x, y, z], color }, { on, size, at: [x, y, z], color }]
const q = (body, leg, head, headAt, c, more = {}) => ({
  body, leg, head, ...(headAt ? { headAt } : {}),
  colors: { body: c[0], spots: c[1] ?? c[0], head: c[2] ?? c[0], snout: c[3] ?? c[1] ?? c[0], leg: c[4] ?? c[1] ?? c[0] },
  ...more,
})
// Extra boxes added onto a plan's own.
const plus = (spec, more = {}) => ({ ...spec, ...more, extras: [...(spec.extras || []), ...(more.extras || [])] })
const r2 = (n) => Math.round(n * 1000) / 1000
const S = (arr, s) => arr.map((n) => r2(n * s))

// --- body plans: s = size (1 = the plan's usual size) ---
// A cat: low body, round head, pointed ears, long tail.
const cat = (s, c, more) => plus(q(S([0.3, 0.3, 0.7], s), r2(0.28 * s), S([0.26, 0.24, 0.24], s), null, c, {
  speed: 1.2,
  extras: [...pair('head', S([0.07, 0.1, 0.04], s), S([0.08, 0.16, -0.04], s), c[0]), { on: 'body', size: S([0.07, 0.07, 0.5], s), at: S([0, 0.52, -0.55], s), color: 'body' }],
}), more)
// A dog / wolf: longer legs and snout, upright ears, bushy tail.
const dog = (s, c, more) => plus(q(S([0.34, 0.36, 0.78], s), r2(0.4 * s), S([0.28, 0.27, 0.34], s), S([0.95, 0.52], s), c, {
  speed: 1.25,
  extras: [...pair('head', S([0.08, 0.13, 0.05], s), S([0.09, 0.2, -0.06], s), c[0]), { on: 'body', size: S([0.1, 0.1, 0.38], s), at: S([0, 0.7, -0.55], s), color: 'body' }],
}), more)
// A weasel-like hunter: long low body, short legs, long tail.
const weasel = (s, c, more) => plus(q(S([0.14, 0.13, 0.5], s), r2(0.08 * s), S([0.13, 0.12, 0.16], s), null, c, {
  speed: 1.3,
  extras: [{ on: 'body', size: S([0.07, 0.07, 0.3], s), at: S([0, 0.16, -0.38], s), color: c[1] ?? 'body' }],
}), more)
// A small rodent: round, tiny legs, little ears.
const rodent = (s, c, more) => plus(q(S([0.14, 0.12, 0.22], s), r2(0.03 * s), S([0.11, 0.1, 0.1], s), null, c, {
  speed: 1,
  extras: pair('head', S([0.04, 0.05, 0.02], s), S([0.04, 0.07, -0.02], s), c[3] ?? c[0]),
}), more)
// A deer / antelope: slim body, long legs, neck up, horns.
const antelope = (s, c, horn = 0.35, more) => plus(q(S([0.38, 0.44, 0.9], s), r2(0.72 * s), S([0.2, 0.24, 0.32], s), S([1.42, 0.55], s), c, {
  speed: 1.5,
  extras: [
    { on: 'body', size: S([0.16, 0.36, 0.18], s), at: S([0, 1.22, 0.4], s), color: 'body' },
    ...(horn ? pair('head', S([0.04, horn, 0.04], s), S([0.06, 0.12 + horn / 2, -0.05], s), c[4] ?? 0x2a2420) : []),
    ...pair('head', S([0.08, 0.12, 0.04], s), S([0.12, 0.14, -0.06], s), c[0]),
  ],
}), more)
// A bear: big heavy body, round ears.
const bear = (s, c, more) => plus(q(S([0.7, 0.65, 1.2], s), r2(0.45 * s), S([0.42, 0.4, 0.42], s), S([0.95, 0.78], s), c, {
  speed: 0.85,
  extras: pair('head', S([0.1, 0.1, 0.05], s), S([0.15, 0.24, -0.08], s), c[0]),
}), more)
// A monkey: stands on two legs, long arms.
const monkey = (s, c, more) => plus(q(S([0.25, 0.35, 0.22], s), r2(0.3 * s), S([0.2, 0.2, 0.2], s), S([0.82, 0.08], s), c, {
  legs: 2, speed: 1.2,
  extras: [...pair('body', S([0.07, 0.48, 0.07], s), S([0.17, 0.42, 0.03], s), c[0]), { on: 'body', size: S([0.05, 0.05, 0.4], s), at: S([0, 0.4, -0.3], s), color: 'body' }],
}), more)
// A songbird: tiny, flies about, beak and tail.
const songbird = (s, c, more) => plus(q(S([0.12, 0.12, 0.18], s), r2(0.06 * s), S([0.1, 0.1, 0.1], s), S([0.25, 0.1], s), c, {
  legs: 2, legW: r2(0.025 * s), fly: 3, speed: 1.3,
  extras: [{ on: 'head', size: S([0.03, 0.03, 0.06], s), at: S([0, -0.01, 0.07], s), color: c[3] ?? 0x3a3a3a }, { on: 'body', size: S([0.08, 0.02, 0.14], s), at: S([0, 0.16, -0.15], s), color: c[1] ?? 'body' }],
}), more)
// A big bird that soars: wide wings.
const raptor = (s, c, more) => plus(q(S([0.22, 0.26, 0.36], s), r2(0.12 * s), S([0.14, 0.14, 0.16], s), S([0.5, 0.2], s), c, {
  legs: 2, legW: r2(0.04 * s), fly: 7, speed: 1.3,
  extras: [...pair('body', S([0.45, 0.04, 0.26], s), S([0.32, 0.32, 0], s), c[1] ?? 'body'), { on: 'head', size: S([0.05, 0.06, 0.07], s), at: S([0, -0.02, 0.1], s), color: c[3] ?? 0xe0b020 }],
}), more)
// A long-legged water bird: stilt legs, long neck and beak.
const wader = (s, c, more) => plus(q(S([0.24, 0.28, 0.45], s), r2(0.8 * s), S([0.12, 0.12, 0.16], s), S([1.6, 0.32], s), c, {
  legs: 2, legW: r2(0.04 * s),
  extras: [{ on: 'body', size: S([0.07, 0.5, 0.07], s), at: S([0, 1.32, 0.24], s), color: c[2] ?? 'body' }, { on: 'head', size: S([0.04, 0.04, 0.28], s), at: S([0, -0.02, 0.2], s), color: c[3] ?? 0xe0b020 }],
}), more)
// A ground bird: plump, short legs (pheasant, quail, grouse...).
const fowl = (s, c, more) => plus(q(S([0.3, 0.3, 0.42], s), r2(0.18 * s), S([0.14, 0.15, 0.15], s), S([0.62, 0.24], s), c, {
  legs: 2, legW: r2(0.04 * s),
  extras: [{ on: 'head', size: S([0.04, 0.04, 0.07], s), at: S([0, -0.02, 0.1], s), color: c[3] ?? 0xd8a040 }, { on: 'body', size: S([0.16, 0.08, 0.35], s), at: S([0, 0.42, -0.3], s), color: c[1] ?? 'body' }],
}), more)
// A lizard: flat, sprawled legs, long tail.
const lizard = (s, c, more) => plus(q(S([0.16, 0.1, 0.4], s), r2(0.06 * s), S([0.13, 0.08, 0.15], s), null, c, {
  speed: 0.9,
  extras: [{ on: 'body', size: S([0.08, 0.06, 0.45], s), at: S([0, 0.09, -0.4], s), color: 'body' }],
}), more)
// A snake.
const snake = (s, c, more) => plus(q(S([0.12, 0.1, 1.4], s), 0, S([0.14, 0.1, 0.18], s), null, c, { legs: 0, speed: 0.6 }), more)
// A frog.
const frog = (s, c, more) => plus(q(S([0.12, 0.08, 0.14], s), r2(0.04 * s), S([0.12, 0.07, 0.08], s), null, c, {
  speed: 0.8,
  extras: pair('head', S([0.04, 0.04, 0.04], s), S([0.04, 0.05, 0], s), c[1] ?? c[0]),
}), more)
// A turtle: shell on top.
const turtle = (s, c, more) => plus(q(S([0.4, 0.2, 0.5], s), r2(0.08 * s), S([0.12, 0.1, 0.14], s), null, c, {
  speed: 0.3,
  extras: [{ on: 'body', size: S([0.44, 0.14, 0.54], s), at: S([0, 0.32, 0], s), color: c[1] ?? 'body' }],
}), more)
// A fish: tall thin body, tail fin, back fin.
const fish = (s, c, more) => plus(q(S([0.12, 0.25, 0.45], s), 0, S([0.1, 0.18, 0.1], s), S([0.125, 0.25], s), c, {
  legs: 0, swim: true, speed: 0.8,
  extras: [{ on: 'body', size: S([0.03, 0.25, 0.12], s), at: S([0, 0.125, -0.28], s), color: c[1] ?? 'body' }, { on: 'body', size: S([0.02, 0.1, 0.16], s), at: S([0, 0.28, 0], s), color: c[1] ?? 'body' }],
}), more)
// A long fish (shark, marlin, barracuda): sleek, big fins.
const bigFish = (s, c, more) => plus(q(S([0.35, 0.4, 1.6], s), 0, S([0.3, 0.3, 0.3], s), S([0.2, 0.9], s), c, {
  legs: 0, swim: true, speed: 1,
  extras: [{ on: 'body', size: S([0.06, 0.4, 0.25], s), at: S([0, 0.55, 0.1], s), color: c[1] ?? 'body' }, { on: 'body', size: S([0.06, 0.5, 0.2], s), at: S([0, 0.2, -0.88], s), color: c[1] ?? 'body' }],
}), more)
// A whale or dolphin: huge, flat tail flukes.
const whale = (s, c, more) => plus(q(S([1.6, 1.5, 7], s), 0, S([1.4, 1.2, 1.0], s), S([0.75, 3.8], s), c, {
  legs: 0, swim: true, speed: 0.8, health: 200, meat: 6,
  extras: [{ on: 'body', size: S([2.6, 0.15, 1.0], s), at: S([0, 0.6, -3.8], s), color: 'body' }, { on: 'body', size: S([1.4, 0.3, 4], s), at: S([0, 0.12, 0.5], s), color: c[1] ?? 'body' }],
}), more)
// A seal: plump, flippers instead of legs.
const seal = (s, c, more) => plus(q(S([0.5, 0.45, 1.4], s), 0, S([0.32, 0.3, 0.32], s), S([0.4, 0.8], s), c, {
  legs: 0, speed: 0.5,
  extras: [...pair('body', S([0.2, 0.05, 0.25], s), S([0.3, 0.05, 0.35], s), c[1] ?? 'body'), { on: 'body', size: S([0.4, 0.06, 0.3], s), at: S([0, 0.05, -0.8], s), color: c[1] ?? 'body' }],
}), more)
// An insect: six thin legs.
const bug = (s, c, more) => plus(q(S([0.07, 0.05, 0.14], s), r2(0.03 * s), S([0.06, 0.05, 0.05], s), null, c, { legs: 6, legW: r2(0.012 * s), speed: 0.7 }), more)
// A flying insect: wings on top.
const flyer = (s, c, more) => plus(bug(s, c), {
  fly: 2, speed: 1.2,
  extras: pair('body', S([0.12, 0.01, 0.1], s), S([0.07, 0.07, 0], s), c[1] ?? 0xd8e0e8),
  ...more,
})

export const WILD_KINDS = {
  // --- cats ---
  bobcat: cat(1.4, [0xa8845a, 0x6a5038, 0xa8845a, 0xe8d8c0, 0x8a6a48]),
  ocelot: cat(1.3, [0xd8b060, 0x3a2a1e, 0xd8b060, 0xf0e0c0, 0xc8a050], { stripes: true }),
  serval: cat(1.5, [0xe0b860, 0x2a2018, 0xe0b860, 0xf2e8d0, 0xd8b058], { stripes: true, speed: 1.4 }),
  caracal: cat(1.6, [0xc08a50, 0x8a5a30, 0xc08a50, 0xf0e0c8, 0xb07a44], { extras: pair('head', [0.06, 0.22, 0.03], [0.13, 0.36, -0.06], 0x2a2018) }),
  wildcat: cat(1.15, [0x8a7a64, 0x4a3e30, 0x8a7a64, 0xe0c8b0, 0x6a5a48], { stripes: true }),
  sandCat: cat(0.9, [0xe0c890, 0xb8a070, 0xe0c890, 0xf0e4c8, 0xd0b880]),
  cloudedLeopard: cat(1.9, [0x9a8a6a, 0x3a3428, 0x9a8a6a, 0xe8dcc0, 0x8a7a5a], { stripes: true, hunts: true, bite: 10, huntRange: 9 }),
  // --- dogs and hunters ---
  manedWolf: dog(1.4, [0xc8582a, 0x1e1a18, 0xc8582a, 0x1e1a18, 0x1e1a18], { hunts: true, bite: 7, huntRange: 7 }),
  africanWildDog: dog(1.2, [0x8a6a40, 0x2a2420, 0xc8a050, 0x1e1a18, 0x5a4430], { stripes: true, hunts: true, bite: 8, huntRange: 10 }),
  dhole: dog(1.1, [0xb8582a, 0xe8d8c0, 0xb8582a, 0x2a2420, 0xa04a24], { hunts: true, bite: 7, huntRange: 9 }),
  raccoonDog: dog(0.9, [0x7a6a58, 0x2a2420, 0x8a7a68, 0xe8e0d0, 0x2a2420]),
  greyWolf: dog(1.5, [0x8a8a8e, 0x5a5a5e, 0x9a9a9e, 0xe8e8e8, 0x6a6a6e], { hunts: true, bite: 10, huntRange: 11 }),
  honeyBadger: weasel(2.2, [0x1e1c1c, 0xe8e8e4, 0x1e1c1c, 0x2a2626, 0x1e1c1c], { hunts: true, bite: 6, huntRange: 6, extras: [{ on: 'body', size: [0.32, 0.06, 1.0], at: [0, 0.48, 0], color: 0xe8e8e4 }] }),
  mongoose: weasel(1.3, [0x8a7a5a, 0x6a5a40, 0x8a7a5a, 0xc8a080, 0x6a5a40]),
  stoat: weasel(0.9, [0xb07a44, 0xf2eee6, 0xb07a44, 0xf2eee6, 0xb07a44]),
  mink: weasel(1.1, [0x3a2a1e, 0x2a1e16, 0x3a2a1e, 0xe8e0d0, 0x2a1e16]),
  marten: weasel(1.3, [0x6a4a2a, 0xe8c070, 0x6a4a2a, 0xe8c070, 0x4a3420]),
  civet: weasel(1.8, [0x9a9488, 0x2a2622, 0x9a9488, 0xf2eee6, 0x2a2622], { stripes: true }),
  coati: weasel(1.6, [0x9a6a3a, 0x5a3e24, 0x9a6a3a, 0xe8d8c0, 0x5a3e24], { stripes: true }),
  // --- rodents and small things ---
  chipmunk: rodent(1.1, [0xb07a44, 0x3a2a1e, 0xb07a44, 0xe8d0b0, 0xa06a3a], { stripes: true, speed: 1.4 }),
  prairieDog: rodent(1.6, [0xc8a070, 0xb08a5a, 0xc8a070, 0xe8d8c0, 0xa88050]),
  gerbil: rodent(0.8, [0xd8b080, 0xf2e8d8, 0xd8b080, 0xe8a0a0, 0xe8c8a0], { extras: [{ on: 'body', size: [0.02, 0.02, 0.2], at: [0, 0.06, -0.2], color: 0xd8b080 }] }),
  jerboa: rodent(0.9, [0xe0c090, 0xf2e8d8, 0xe0c090, 0xe8a0a0, 0xe0c090], { legs: 2, leg: 0.1, speed: 1.6, extras: [{ on: 'body', size: [0.02, 0.02, 0.3], at: [0, 0.14, -0.25], color: 0xe0c090 }, ...pair('head', [0.03, 0.1, 0.02], [0.04, 0.1, -0.02], 0xe0c090)] }),
  dormouse: rodent(0.8, [0xd89a50, 0xf2e8d8, 0xd89a50, 0x2a2420, 0xd89a50]),
  vole: rodent(0.8, [0x6a5040, 0x5a4434, 0x6a5040, 0x3a2a20, 0x5a4434]),
  shrew: rodent(0.6, [0x4a4038, 0x3a322a, 0x4a4038, 0xe8a0a0, 0x3a322a], { speed: 1.5 }),
  lemming: rodent(0.9, [0x8a6a40, 0xe8dcc0, 0x3a2a1e, 0xe8a0a0, 0x8a6a40]),
  muskrat: rodent(2, [0x5a3e28, 0x4a3220, 0x5a3e28, 0x2a1e16, 0x4a3220], { swim: true, extras: [{ on: 'body', size: [0.04, 0.04, 0.4], at: [0, 0.1, -0.45], color: 0x2a1e16 }] }),
  pika: rodent(1.1, [0x9a8a78, 0x7a6a58, 0x9a8a78, 0x2a2420, 0x7a6a58]),
  flyingSquirrel: rodent(1.3, [0x8a7a68, 0xf2eee6, 0x8a7a68, 0x2a2420, 0x8a7a68], { fly: 3, extras: pair('body', [0.12, 0.02, 0.22], [0.13, 0.12, 0], 0x8a7a68) }),
  echidna: rodent(2.6, [0x3a2e24, 0xd8c8a8, 0x3a2e24, 0x2a2420, 0x2a2420], { speed: 0.4, extras: [{ on: 'head', size: [0.04, 0.04, 0.2], at: [0, -0.02, 0.15], color: 0x2a2420 }] }),
  numbat: weasel(1.8, [0xa86a40, 0xf2eee6, 0xa86a40, 0x2a2420, 0x8a5434], { stripes: true }),
  sugarGlider: rodent(1, [0x9a9aa0, 0x2a2a2e, 0x9a9aa0, 0xf2eee6, 0x9a9aa0], { fly: 3, extras: pair('body', [0.12, 0.02, 0.2], [0.12, 0.1, 0], 0x9a9aa0) }),
  bilby: rodent(2, [0x9a9aa0, 0xf2eee6, 0x9a9aa0, 0xe8a0b0, 0x9a9aa0], { extras: pair('head', [0.05, 0.18, 0.03], [0.06, 0.14, -0.03], 0xe8b0c0) }),
  // --- monkeys and lemurs ---
  capuchin: monkey(0.9, [0x2a2018, 0xf0e0c8, 0xf0e0c8, 0xe8c8a8, 0x2a2018]),
  howlerMonkey: monkey(1.1, [0x2a1e16, 0x1e1610, 0x2a1e16, 0x2a1e16, 0x1e1610]),
  spiderMonkey: monkey(1.1, [0x3a2a1e, 0x2a1e16, 0x3a2a1e, 0xd8b898, 0x2a1e16], { speed: 1.4 }),
  marmoset: monkey(0.5, [0x8a8680, 0x2a2622, 0x8a8680, 0xf2eee6, 0x6a6660]),
  tamarin: monkey(0.55, [0x2a2420, 0xf2eee6, 0x2a2420, 0xf2eee6, 0x2a2420]),
  bonobo: monkey(1.6, [0x1e1a18, 0x2a2420, 0x1e1a18, 0x4a3a30, 0x1e1a18]),
  gelada: monkey(1.4, [0x8a6a48, 0xd03030, 0x8a6a48, 0x3a2a20, 0x6a5038]),
  colobus: monkey(1.2, [0x1e1c1c, 0xf2f2ee, 0x1e1c1c, 0xf2f2ee, 0x1e1c1c]),
  proboscisMonkey: monkey(1.4, [0xc8804a, 0xe8d8c0, 0xc8804a, 0xe8a080, 0x9a9488], { extras: [{ on: 'head', size: [0.08, 0.1, 0.08], at: [0, -0.02, 0.14], color: 0xe8a080 }] }),
  slowLoris: monkey(0.55, [0xc8a880, 0x6a4a30, 0xc8a880, 0xf2e8d8, 0xb09068], { speed: 0.3 }),
  tarsier: monkey(0.4, [0xa08868, 0x8a7458, 0xa08868, 0xe8d8c0, 0x8a7458]),
  ringTailedLemur: monkey(0.9, [0x9a9a9e, 0x1e1c1c, 0xf2f2ee, 0x1e1c1c, 0x9a9a9e], { stripes: true, extras: [{ on: 'body', size: [0.06, 0.06, 0.6], at: [0, 0.5, -0.4], color: 0x1e1c1c }] }),
  ayeAye: monkey(0.8, [0x2a2420, 0x4a3e34, 0x3a302a, 0xe8c070, 0x2a2420], { extras: pair('head', [0.08, 0.12, 0.03], [0.12, 0.08, -0.03], 0x2a2420) }),
  // --- hoofed animals ---
  kudu: antelope(1.5, [0x8a7a68, 0xf2eee6, 0x8a7a68, 0x2a2420, 0x6a5a48], 0.6, { stripes: true }),
  oryx: antelope(1.4, [0xe0d8c8, 0x1e1a18, 0xe0d8c8, 0x1e1a18, 0x1e1a18], 0.75),
  springbok: antelope(1, [0xc89050, 0xf2eee6, 0xf2eee6, 0x2a2420, 0xc89050], 0.3, { speed: 1.8 }),
  gerenuk: antelope(1.1, [0xb07a44, 0xe8d8c0, 0xb07a44, 0x2a2420, 0xb07a44], 0.25, { extras: [{ on: 'body', size: [0.12, 0.5, 0.12], at: [0, 1.6, 0.45], color: 'body' }] }),
  dikDik: antelope(0.5, [0x9a7a5a, 0xc8b098, 0x9a7a5a, 0x2a2420, 0x9a7a5a], 0.12, { speed: 1.7 }),
  eland: antelope(2, [0xb8905a, 0xf2eee6, 0xb8905a, 0x2a2420, 0x8a6a40], 0.4, { speed: 1, health: 70, meat: 3 }),
  bongo: antelope(1.5, [0xa04a24, 0xf2eee6, 0xa04a24, 0x2a2420, 0x6a3018], 0.55, { stripes: true }),
  nyala: antelope(1.3, [0x6a5a48, 0xf2eee6, 0x6a5a48, 0xe0b040, 0x4a3e30], 0.5, { stripes: true }),
  markhor: antelope(1.3, [0xb8a888, 0x7a6a50, 0xb8a888, 0x4a3e30, 0x7a6a50], 0.7),
  chamois: antelope(1, [0x8a6a48, 0xf2eee6, 0xf2eee6, 0x1e1a18, 0x6a5038], 0.2),
  mountainGoat: antelope(1.2, [0xf2f2ee, 0xe0e0dc, 0xf2f2ee, 0x1e1a18, 0xe0e0dc], 0.22),
  takin: antelope(1.6, [0xd8b060, 0x6a5038, 0x3a2e24, 0x1e1a18, 0x6a5038], 0.3, { speed: 0.9 }),
  saiga: antelope(1, [0xd8c8a0, 0xb8a880, 0xd8c8a0, 0xb8a070, 0xb8a880], 0.25, { extras: [{ on: 'head', size: [0.14, 0.14, 0.12], at: [0, -0.02, 0.16], color: 0xc8b890 }] }),
  pronghorn: antelope(1.2, [0xc8884a, 0xf2eee6, 0xf2eee6, 0x1e1a18, 0xc8884a], 0.3, { speed: 2 }),
  muntjac: antelope(0.7, [0xa86a3a, 0x8a5430, 0xa86a3a, 0x2a2420, 0x8a5430], 0.12),
  guanaco: antelope(1.3, [0xb88a5a, 0xf2eee6, 0x6a6460, 0x2a2420, 0xb88a5a], 0, { extras: [{ on: 'body', size: [0.16, 0.6, 0.18], at: [0, 1.5, 0.42], color: 'body' }] }),
  vicuna: antelope(1.1, [0xc89a60, 0xf2eee6, 0xc89a60, 0x2a2420, 0xc89a60], 0, { extras: [{ on: 'body', size: [0.16, 0.55, 0.18], at: [0, 1.25, 0.4], color: 'body' }] }),
  przewalskiHorse: antelope(1.8, [0xc8a070, 0x3a2e24, 0xc8a070, 0xe8dcc8, 0x3a2e24], 0, { speed: 1.5, extras: [{ on: 'body', size: [0.06, 0.2, 0.5], at: [0, 2.5, 0.65], color: 0x3a2e24 }] }),
  pygmyHippo: bear(0.9, [0x4a3e40, 0x3a3032, 0x4a3e40, 0xe0a8a8, 0x3a3032], { speed: 0.6 }),
  babirusa: bear(0.75, [0x8a7a72, 0x6a5a52, 0x8a7a72, 0xe0b0a0, 0x6a5a52], { extras: pair('head', [0.03, 0.2, 0.03], [0.1, 0.15, 0.1], 0xe8e0c8) }),
  peccary: bear(0.65, [0x4a4440, 0xe8e0d0, 0x4a4440, 0x3a3430, 0x3a3430]),
  // --- bears ---
  spectacledBear: bear(1.05, [0x1e1c1c, 0xf0dca8, 0x1e1c1c, 0xf0dca8, 0x1e1c1c], { hunts: true, bite: 10, huntRange: 7 }),
  slothBear: bear(1.05, [0x1e1c1c, 0xf2eee6, 0x1e1c1c, 0xd8c8b0, 0x1e1c1c], { hunts: true, bite: 11, huntRange: 7 }),
  grizzlyBear: bear(1.4, [0x7a5a3a, 0x9a7a52, 0x7a5a3a, 0x9a7a52, 0x5a4028], { hunts: true, bite: 18, huntRange: 10, health: 120, meat: 4 }),
  kodiakBear: bear(1.6, [0x5a3a22, 0x7a5232, 0x5a3a22, 0x8a6a4a, 0x4a2e1a], { hunts: true, bite: 22, huntRange: 10, health: 150, meat: 5 }),
  // --- other land animals ---
  hyrax: rodent(2.6, [0x8a7a68, 0x6a5a48, 0x8a7a68, 0x2a2420, 0x6a5a48], { speed: 0.8 }),
  elephantShrew: rodent(1.2, [0xb08a5a, 0xf2e8d8, 0xb08a5a, 0xe0a0a0, 0xb08a5a], { speed: 1.6, extras: [{ on: 'head', size: [0.02, 0.02, 0.12], at: [0, -0.02, 0.1], color: 0xe0a0a0 }] }),
  kinkajou: weasel(1.5, [0xc8904a, 0xa87a3a, 0xc8904a, 0x2a2420, 0xa87a3a]),
  binturong: weasel(2.4, [0x1e1c1c, 0x3a3432, 0x2a2626, 0xe8e0d0, 0x1e1c1c], { speed: 0.6 }),
  // --- birds ---
  robin: songbird(1, [0x6a5a48, 0xe06030, 0x6a5a48, 0xe0b020, 0x8a7a6a], { extras: [{ on: 'body', size: [0.1, 0.08, 0.02], at: [0, 0.12, 0.09], color: 0xe06030 }] }),
  sparrow: songbird(0.9, [0x8a6a48, 0x5a4430, 0x8a6a48, 0x3a3030, 0xb09070]),
  blueJay: songbird(1.2, [0x3a7ad0, 0xf2f2ee, 0x3a7ad0, 0x1e1e1e, 0x5a5a5a], { extras: [{ on: 'head', size: [0.04, 0.08, 0.04], at: [0, 0.08, -0.03], color: 0x3a7ad0 }] }),
  cardinal: songbird(1.1, [0xd02020, 0xa01818, 0xd02020, 0xf0a020, 0x8a5050], { extras: [{ on: 'head', size: [0.04, 0.08, 0.04], at: [0, 0.08, -0.03], color: 0xd02020 }] }),
  finch: songbird(0.8, [0xf0d020, 0x1e1e1e, 0xf0d020, 0xe8a060, 0xd8a070]),
  magpie: songbird(1.6, [0x16161c, 0xf2f2ee, 0x16161c, 0x2a2a2e, 0x2a2a2e], { extras: [{ on: 'body', size: [0.06, 0.02, 0.3], at: [0, 0.25, -0.3], color: 0x16161c }] }),
  kingfisher: songbird(1, [0x2090d0, 0xe07030, 0x2090d0, 0x1e1e1e, 0xe07030], { extras: [{ on: 'head', size: [0.03, 0.03, 0.12], at: [0, -0.01, 0.09], color: 0x1e1e1e }] }),
  swallow: songbird(1, [0x1e2a50, 0xf2eee6, 0x1e2a50, 0x1e1e1e, 0x1e1e1e], { speed: 1.8 }),
  hoopoe: songbird(1.3, [0xd89a60, 0x1e1e1e, 0xd89a60, 0x2a2a2a, 0x5a5a5a], { stripes: true, extras: [{ on: 'head', size: [0.03, 0.12, 0.1], at: [0, 0.1, -0.02], color: 0xd89a60 }] }),
  cockatoo: songbird(2, [0xf2f2ee, 0xe8e8e0, 0xf2f2ee, 0x2a2a2a, 0x5a5a5a], { extras: [{ on: 'head', size: [0.03, 0.14, 0.08], at: [0, 0.1, -0.03], color: 0xf0d020 }] }),
  lovebird: songbird(0.9, [0x40c040, 0xf06040, 0xf06040, 0xd02020, 0x8a8a8a]),
  budgie: songbird(0.9, [0x60d040, 0xf0e040, 0xf0e040, 0x8a6a40, 0x5a8ad0], { stripes: true }),
  kookaburra: songbird(2, [0xb09070, 0x5a4430, 0xf0e8d8, 0x2a2420, 0x8a7a6a]),
  hornbill: raptor(1.4, [0x1e1e1e, 0xf2f2ee, 0x1e1e1e, 0xf0b020, 0x3a3a3a], { fly: 6, extras: [{ on: 'head', size: [0.08, 0.12, 0.3], at: [0, 0.02, 0.2], color: 0xf0b020 }] }),
  quetzal: songbird(1.4, [0x20a060, 0xd02020, 0x20a060, 0xf0d020, 0x5a5a5a], { extras: [{ on: 'body', size: [0.04, 0.02, 0.6], at: [0, 0.15, -0.4], color: 0x20a060 }] }),
  stork: wader(1.1, [0xf2f2ee, 0x1e1e1e, 0xf2f2ee, 0xd04020, 0xd04020]),
  crane: wader(1.2, [0xd8dce0, 0x1e1e1e, 0xf2f2ee, 0x3a3a3a, 0x3a3a3a], { extras: [{ on: 'head', size: [0.06, 0.03, 0.06], at: [0, 0.07, 0], color: 0xd02020 }] }),
  ibis: wader(0.85, [0xe04030, 0xc03020, 0xe04030, 0x3a2a2a, 0xe04030]),
  spoonbill: wader(0.95, [0xf0a0c0, 0xe080a8, 0xf0a0c0, 0x8a8a7a, 0xe080a8], { extras: [{ on: 'head', size: [0.1, 0.02, 0.08], at: [0, -0.02, 0.32], color: 0x8a8a7a }] }),
  shoebill: wader(1.1, [0x7a8890, 0x5a6870, 0x7a8890, 0xc8b890, 0x3a3a3a], { extras: [{ on: 'head', size: [0.12, 0.1, 0.22], at: [0, -0.02, 0.16], color: 0xc8b890 }] }),
  albatross: raptor(1.6, [0xf2f2ee, 0x3a3a3e, 0xf2f2ee, 0xf0c8a0, 0xe0c0b0], { fly: 9 }),
  cormorant: songbird(3, [0x1e1e22, 0x2a2a30, 0x1e1e22, 0xe0b020, 0x1e1e22], { fly: 2, swim: true }),
  brownPelican: wader(0.9, [0x8a7a68, 0x5a4a3a, 0xf2eee6, 0xa08060, 0x3a3a3a], { extras: [{ on: 'head', size: [0.08, 0.1, 0.3], at: [0, -0.06, 0.22], color: 0xa08060 }] }),
  condor: raptor(2, [0x1e1e1e, 0x2a2a2a, 0xd0a090, 0xe0c0a0, 0x5a5a5a], { fly: 12, extras: [{ on: 'body', size: [0.3, 0.08, 0.12], at: [0, 0.55, 0.2], color: 0xf2f2ee }] }),
  kestrel: raptor(0.8, [0xb8704a, 0x3a2a20, 0x8a9aa8, 0xe0b020, 0xe0b020]),
  osprey: raptor(1.3, [0x3a2e26, 0xf2eee6, 0xf2eee6, 0x1e1e1e, 0xb0b0a8]),
  harpyEagle: raptor(1.5, [0x5a5a5e, 0xf2f2ee, 0x8a8a8e, 0x1e1e1e, 0xe0b020], { fly: 8, extras: [{ on: 'head', size: [0.06, 0.1, 0.04], at: [0, 0.1, -0.04], color: 0x3a3a3e }] }),
  secretaryBird: wader(1.1, [0xc8c8c4, 0x1e1e1e, 0xc8c8c4, 0xe06020, 0xe8d8c0], { extras: [{ on: 'head', size: [0.04, 0.16, 0.12], at: [0, 0.08, -0.06], color: 0x1e1e1e }] }),
  cassowary: plus(q([0.5, 0.5, 0.7], 0.9, [0.15, 0.15, 0.2], [1.9, 0.4], [0x16161c, 0x22222a, 0x3a70c0, 0xd02020, 0x5a5a5a]), { legs: 2, legW: 0.08, speed: 1.4, hunts: true, bite: 12, huntRange: 6, extras: [{ on: 'body', size: [0.12, 0.5, 0.12], at: [0, 1.55, 0.32], color: 0x3a70c0 }, { on: 'head', size: [0.06, 0.16, 0.14], at: [0, 0.12, 0], color: 0x8a6a40 }] }),
  rhea: plus(q([0.45, 0.45, 0.6], 0.8, [0.13, 0.13, 0.18], [1.7, 0.36], [0x8a8a86, 0x6a6a66, 0x8a8a86, 0xd8c8a0, 0x8a8a86]), { legs: 2, legW: 0.06, speed: 1.7, extras: [{ on: 'body', size: [0.1, 0.45, 0.1], at: [0, 1.4, 0.3], color: 0x8a8a86 }] }),
  pheasant: fowl(1.1, [0xb05a2a, 0x2a6040, 0x2a6040, 0xd8c8a0, 0x8a7a6a], { extras: [{ on: 'head', size: [0.08, 0.06, 0.04], at: [0, 0.02, 0.02], color: 0xd02020 }, { on: 'body', size: [0.06, 0.04, 0.5], at: [0, 0.42, -0.45], color: 0xb05a2a }] }),
  quail: fowl(0.6, [0x8a6a48, 0x5a4430, 0x8a6a48, 0x3a3030, 0xb09070], { extras: [{ on: 'head', size: [0.02, 0.08, 0.04], at: [0, 0.1, 0.02], color: 0x1e1e1e }] }),
  grouse: fowl(1, [0x7a6048, 0x4a3a2a, 0x7a6048, 0x3a3030, 0x8a7a6a]),
  ptarmigan: fowl(0.9, [0xf2f2ee, 0xe0e0dc, 0xf2f2ee, 0x1e1e1e, 0xf2f2ee]),
  dodo: fowl(1.9, [0x8a8a86, 0xf2eee6, 0x8a8a86, 0xc8b070, 0xd8c070], { speed: 0.5, extras: [{ on: 'head', size: [0.1, 0.1, 0.2], at: [0, -0.02, 0.16], color: 0xc8b070 }] }),
  loon: fowl(1.3, [0x1e1e22, 0xf2f2ee, 0x1e2a22, 0x1e1e1e, 0x1e1e22], { swim: true, stripes: true }),
  mandarinDuck: fowl(0.9, [0xb06030, 0x3a2a60, 0xf0a040, 0xd02020, 0xe0a040], { swim: true, extras: [{ on: 'body', size: [0.08, 0.1, 0.06], at: [0, 0.5, -0.05], color: 0xf0a040 }] }),
  // --- reptiles and frogs ---
  gilaMonster: lizard(2.4, [0xe07a3a, 0x1e1a18, 0xe07a3a, 0x1e1a18, 0x1e1a18], { stripes: true, speed: 0.4 }),
  frilledLizard: lizard(2.6, [0xa08a5a, 0x7a6a40, 0xa08a5a, 0xe06030, 0x7a6a40], { extras: [{ on: 'head', size: [0.5, 0.35, 0.04], at: [0, 0.05, -0.15], color: 0xe06030 }] }),
  monitorLizard: lizard(4.5, [0x5a5440, 0x3a3428, 0x5a5440, 0x3a3428, 0x3a3428], { stripes: true, hunts: true, bite: 8, huntRange: 6 }),
  basilisk: lizard(2, [0x3aa040, 0x2a8030, 0x3aa040, 0xf0e040, 0x2a8030], { speed: 1.6, extras: [{ on: 'body', size: [0.03, 0.18, 0.5], at: [0, 0.32, 0], color: 0x2a8030 }] }),
  gharial: lizard(10, [0x5a6a4a, 0x4a5a3a, 0x5a6a4a, 0x4a5a3a, 0x4a5a3a], { swim: true, hunts: true, bite: 14, huntRange: 6, speed: 0.6, extras: [{ on: 'head', size: [0.3, 0.2, 1.4], at: [0, -0.1, 1.2], color: 0x5a6a4a }] }),
  caiman: lizard(6, [0x4a5038, 0x3a4028, 0x4a5038, 0xd8c890, 0x3a4028], { swim: true, hunts: true, bite: 12, huntRange: 6, speed: 0.7 }),
  boa: snake(1.8, [0xa08a6a, 0x5a3e2a, 0xa08a6a, 0x8a6a48], { stripes: true, speed: 0.4 }),
  rattlesnake: snake(1, [0xb8a070, 0x5a4430, 0xb8a070, 0x8a7a5a], { stripes: true, hunts: true, bite: 9, huntRange: 4, extras: [{ on: 'body', size: [0.06, 0.06, 0.1], at: [0, 0.06, -0.75], color: 0xe8dcc0 }] }),
  anaconda: snake(3.4, [0x4a5a30, 0x1e2010, 0x4a5a30, 0x6a7a40], { stripes: true, swim: true, hunts: true, bite: 15, huntRange: 5, speed: 0.4, health: 70 }),
  seaSnake: snake(0.9, [0x3a70b0, 0x1e1e2a, 0x3a70b0, 0x1e1e2a], { stripes: true, swim: true }),
  treeFrog: frog(0.8, [0x40c040, 0xd02020, 0x40c040, 0xf0a020, 0x40c040]),
  poisonDartFrog: frog(0.5, [0x2080f0, 0x1e1e2a, 0x2080f0, 0x1e1e2a, 0x2080f0], { stripes: true }),
  bullfrog: frog(1.6, [0x5a7a3a, 0x3a5a28, 0x5a7a3a, 0xe8e0a0, 0x3a5a28]),
  tuatara: lizard(2.2, [0x6a7050, 0x4a5038, 0x6a7050, 0xe8dcc0, 0x4a5038], { speed: 0.3, extras: [{ on: 'body', size: [0.03, 0.08, 0.6], at: [0, 0.25, 0], color: 0xe8dcc0 }] }),
  snappingTurtle: turtle(1.3, [0x4a4a3a, 0x3a3a2a, 0x4a4a3a, 0x3a3a2a, 0x3a3a2a], { hunts: true, bite: 6, huntRange: 2 }),
  // --- sea ---
  mantaRay: plus(q([2.6, 0.2, 1.6], 0, [0.6, 0.2, 0.3], [0.1, 0.9], [0x1e2028, 0xf2f2ee, 0x1e2028, 0xf2f2ee]), { legs: 0, swim: true, speed: 0.6, extras: [{ on: 'body', size: [0.06, 0.06, 1.4], at: [0, 0.1, -1.4], color: 0x1e2028 }] }),
  humpbackWhale: whale(1.9, [0x2a3038, 0xe8e8e8, 0x2a3038, 0x2a3038], { health: 300, meat: 8 }),
  spermWhale: whale(2, [0x4a4a52, 0x5a5a62, 0x4a4a52, 0x4a4a52], { health: 320, meat: 8, extras: [{ on: 'head', size: [1.5, 1.4, 2.2], at: [0, 0.1, 0.8], color: 0x4a4a52 }] }),
  blueWhale: whale(3.2, [0x5a7090, 0x8aa0b8, 0x5a7090, 0x5a7090], { health: 500, meat: 12, speed: 0.6 }),
  seaOtter: seal(0.7, [0x5a3e28, 0xc8b090, 0xc8b090, 0x1e1a18], { swim: true, speed: 0.8 }),
  elephantSeal: seal(2.6, [0x7a6a5a, 0x5a4a3a, 0x7a6a5a, 0x5a4a3a], { health: 120, meat: 5, extras: [{ on: 'head', size: [0.2, 0.2, 0.3], at: [0, -0.05, 0.25], color: 0x5a4a3a }] }),
  leopardSeal: seal(2, [0x7a8088, 0x3a3e44, 0x7a8088, 0xe8e8e8], { stripes: true, swim: true, hunts: true, bite: 12, huntRange: 7 }),
  dugong: seal(1.8, [0x8a8a86, 0x7a7a76, 0x8a8a86, 0x6a6a66], { swim: true, speed: 0.4 }),
  anglerfish: fish(1.4, [0x3a302a, 0x2a2420, 0x3a302a, 0xe8e0c8], { extras: [{ on: 'head', size: [0.02, 0.2, 0.02], at: [0, 0.2, 0.05], color: 0x3a302a }, { on: 'head', size: [0.06, 0.06, 0.06], at: [0, 0.32, 0.1], color: 0xf8f8a0 }] }),
  barracuda: bigFish(0.8, [0x8a9aa8, 0x3a4a58, 0x8a9aa8, 0xe8e8e8], { speed: 1.4, hunts: true, bite: 6, huntRange: 5 }),
  marlin: bigFish(1.6, [0x2a4a8a, 0x5a8ad0, 0x2a4a8a, 0xe8e8e8], { speed: 1.6, extras: [{ on: 'head', size: [0.04, 0.04, 0.8], at: [0, 0, 0.5], color: 0x2a4a8a }] }),
  sunfish: fish(5, [0x8a9098, 0x6a7078, 0x8a9098, 0xe8e8e8], { speed: 0.3, health: 60 }),
  lionfish: fish(0.8, [0xe8d8c8, 0xc03020, 0xe8d8c8, 0xc03020], { stripes: true, speed: 0.5, extras: pair('body', [0.15, 0.2, 0.04], [0.1, 0.15, 0.05], 0xc03020) }),
  angelfish: fish(0.7, [0xf0d020, 0x2050c0, 0xf0d020, 0x2050c0], { stripes: true }),
  parrotfish: fish(1.2, [0x30c0a0, 0xe060a0, 0x30c0a0, 0xe8e0c8]),
  catfish: fish(1.6, [0x5a5048, 0x3a3430, 0x5a5048, 0xe0d0b8], { extras: pair('head', [0.02, 0.02, 0.2], [0.05, -0.05, 0.12], 0x3a3430) }),
  carp: fish(1.3, [0xa08a50, 0x7a6a3a, 0xa08a50, 0xe0c890]),
  koi: fish(1.1, [0xf2f2ee, 0xe05020, 0xf2f2ee, 0xe05020]),
  piranha: fish(0.6, [0x8a9098, 0xd03030, 0x8a9098, 0xd03030], { hunts: true, bite: 4, huntRange: 4, speed: 1.4 }),
  pike: bigFish(0.6, [0x5a7040, 0xc8c880, 0x5a7040, 0xe8e8e0], { stripes: true }),
  flounder: plus(q([0.4, 0.06, 0.5], 0, [0.15, 0.05, 0.1], [0.03, 0.28], [0xa08a6a, 0x7a6a4a]), { legs: 0, swim: true, speed: 0.4 }),
  whaleShark: bigFish(6, [0x3a5068, 0xe8e8e8, 0x3a5068, 0xe8e8e8], { speed: 0.5, health: 250, meat: 6, stripes: true }),
  tigerShark: bigFish(2.4, [0x6a7480, 0x3a4048, 0x6a7480, 0xe8ece8], { stripes: true, hunts: true, bite: 18, huntRange: 9, health: 110 }),
  greatWhiteShark: bigFish(3, [0x6a7a88, 0xe8ece8, 0x6a7a88, 0xe8ece8], { hunts: true, bite: 25, huntRange: 10, health: 150, meat: 4 }),
  sawfish: bigFish(2.2, [0x8a8070, 0x6a6050, 0x8a8070, 0xe0d8c8], { extras: [{ on: 'head', size: [0.3, 0.04, 1.2], at: [0, 0, 0.8], color: 0x8a8070 }] }),
  nautilus: fish(0.8, [0xf2e8d8, 0xb05a30, 0xf2e8d8, 0xe0a080], { stripes: true, speed: 0.3 }),
  cuttlefish: fish(1.2, [0xa08a7a, 0x6a5a4a, 0xa08a7a, 0xe8d8c8], { stripes: true, speed: 0.5 }),
  seaUrchin: plus(q([0.18, 0.12, 0.18], 0, [0.05, 0.05, 0.05], [0.06, 0.05], [0x3a1e48, 0x2a1438]), { legs: 0, swim: true, speed: 0.02, eyes: false }),
  hermitCrab: plus(q([0.12, 0.08, 0.12], 0.04, [0.08, 0.06, 0.06], null, [0xd06030, 0xb04a24]), { legs: 6, legW: 0.02, speed: 0.4, extras: [{ on: 'body', size: [0.16, 0.16, 0.18], at: [0, 0.16, -0.05], color: 0xd8c8a8 }] }),
  nudibranch: plus(q([0.06, 0.04, 0.2], 0, [0.05, 0.04, 0.05], null, [0x8a40d0, 0xf0a020]), { legs: 0, swim: true, speed: 0.1 }),
  // --- bugs (kept big enough to see) ---
  wasp: flyer(1.2, [0xf0c020, 0x1e1e1e, 0x1e1e1e], { stripes: true }),
  hornet: flyer(1.6, [0xb87a20, 0x3a2a1e, 0xb87a20], { stripes: true, hunts: true, bite: 3, huntRange: 4 }),
  stickInsect: bug(2.4, [0x7a8a4a, 0x5a6a3a, 0x7a8a4a], { speed: 0.2, extras: [{ on: 'body', size: [0.03, 0.03, 0.25], at: [0, 0.05, -0.2], color: 0x7a8a4a }] }),
  cicada: flyer(1.3, [0x3a5a3a, 0xd8e0e8, 0x3a5a3a]),
  tarantula: plus(bug(2.2, [0x3a2a20, 0xb05a30, 0x3a2a20]), { legs: 8, speed: 0.5 }),
  stagBeetle: bug(1.8, [0x3a1e14, 0x2a140c, 0x3a1e14], { extras: pair('head', [0.02, 0.02, 0.1], [0.03, 0, 0.06], 0x3a1e14) }),
  rhinoBeetle: bug(2, [0x5a3420, 0x3a2014, 0x5a3420], { extras: [{ on: 'head', size: [0.03, 0.1, 0.03], at: [0, 0.05, 0.03], color: 0x3a2014 }] }),
  glowworm: bug(1.2, [0x6a5a3a, 0xc8f080, 0x6a5a3a], { speed: 0.2, extras: [{ on: 'body', size: [0.07, 0.05, 0.06], at: [0, 0.04, -0.08], color: 0xd8ff90 }] }),
  millipede: plus(bug(1.6, [0x5a3020, 0x3a1e14, 0x5a3020]), { legs: 8, speed: 0.3, extras: [{ on: 'body', size: [0.1, 0.07, 0.4], at: [0, 0.06, -0.25], color: 0x5a3020 }] }),
  earthworm: plus(q([0.04, 0.04, 0.3], 0, [0.04, 0.04, 0.04], null, [0xd08a80, 0xc07a70]), { legs: 0, speed: 0.1, eyes: false }),
  slug: plus(q([0.08, 0.06, 0.25], 0, [0.07, 0.06, 0.07], [0.05, 0.14], [0x8a7a4a, 0x6a5a3a]), { legs: 0, speed: 0.05 }),
  waterStrider: plus(bug(1.4, [0x3a3a3a, 0x2a2a2a, 0x3a3a3a]), { legW: 0.01, swim: true }),
}

// The wolves and bears that were already in the game bite too (Gaymi
// ticked "Dangerous: wolf, bear").
export const HUNTERS = {
  wolf: { bite: 8, huntRange: 10 },
  bear: { bite: 15, huntRange: 9 },
  blackBear: { bite: 12, huntRange: 7 },
  polarBear: { bite: 18, huntRange: 10 },
}

// Where each lives (added to PlayAnimals' BIOME_ANIMALS).
export const WILD_BIOME_ANIMALS = {
  city: ['sparrow', 'robin', 'magpie'],
  plains: ['pheasant', 'quail', 'prairieDog', 'pronghorn', 'przewalskiHorse', 'sparrow', 'swallow', 'kestrel', 'vole', 'earthworm', 'wasp', 'bobcat'],
  forest: ['wildcat', 'chipmunk', 'dormouse', 'stoat', 'marten', 'grouse', 'robin', 'blueJay', 'cardinal', 'raccoonDog', 'grizzlyBear', 'stagBeetle', 'rhinoBeetle', 'slug', 'greyWolf', 'muntjac', 'hornet', 'glowworm'],
  birchForest: ['chipmunk', 'finch', 'hoopoe', 'shrew', 'dormouse'],
  darkForest: ['greyWolf', 'grizzlyBear', 'kodiakBear', 'glowworm', 'millipede'],
  cherryGrove: ['finch', 'lovebird', 'hoopoe', 'cicada'],
  taiga: ['greyWolf', 'grizzlyBear', 'mink', 'marten', 'lemming', 'grouse', 'osprey', 'kodiakBear'],
  snowyTaiga: ['ptarmigan', 'stoat', 'lemming', 'greyWolf'],
  snowyPlains: ['ptarmigan', 'lemming', 'saiga'],
  iceSpikes: ['ptarmigan'],
  desert: ['sandCat', 'gerbil', 'jerboa', 'gilaMonster', 'rattlesnake', 'oryx', 'tarantula', 'caracal', 'hyrax'],
  badlands: ['rattlesnake', 'gilaMonster', 'condor', 'pronghorn', 'tarantula', 'peccary'],
  savanna: ['serval', 'caracal', 'africanWildDog', 'mongoose', 'honeyBadger', 'kudu', 'springbok', 'gerenuk', 'dikDik', 'eland', 'secretaryBird', 'stork', 'hyrax', 'elephantShrew', 'kookaburra', 'monitorLizard', 'bilby'],
  jungle: ['ocelot', 'cloudedLeopard', 'kinkajou', 'binturong', 'capuchin', 'howlerMonkey', 'spiderMonkey', 'marmoset', 'tamarin', 'bonobo', 'colobus', 'slowLoris', 'tarsier', 'ringTailedLemur', 'ayeAye', 'bongo', 'quetzal', 'hornbill', 'cockatoo', 'harpyEagle', 'cassowary', 'basilisk', 'boa', 'treeFrog', 'poisonDartFrog', 'stickInsect', 'babirusa', 'civet', 'coati', 'spectacledBear', 'slothBear', 'pygmyHippo', 'sugarGlider', 'flyingSquirrel'],
  bambooJungle: ['dhole', 'proboscisMonkey', 'budgie', 'nyala', 'takin'],
  swamp: ['bullfrog', 'anaconda', 'caiman', 'muskrat', 'snappingTurtle', 'crane', 'ibis', 'spoonbill', 'shoebill', 'loon', 'mandarinDuck', 'waterStrider', 'tuatara'],
  mangroveSwamp: ['gharial', 'kingfisher', 'ibis', 'proboscisMonkey'],
  mountains: ['gelada', 'markhor', 'chamois', 'mountainGoat', 'pika', 'condor', 'harpyEagle', 'manedWolf', 'guanaco', 'vicuna', 'rhea', 'numbat', 'echidna', 'frilledLizard'],
  snowyPeaks: ['mountainGoat', 'pika', 'takin'],
  beach: ['hermitCrab', 'albatross', 'cormorant', 'brownPelican', 'dodo'],
  snowyBeach: ['elephantSeal', 'leopardSeal'],
  frozenOcean: ['leopardSeal', 'humpbackWhale', 'seaOtter'],
  ocean: ['mantaRay', 'humpbackWhale', 'spermWhale', 'barracuda', 'marlin', 'sunfish', 'tigerShark', 'greatWhiteShark', 'whaleShark', 'seaSnake', 'cuttlefish'],
  warmOcean: ['mantaRay', 'lionfish', 'angelfish', 'parrotfish', 'nautilus', 'seaUrchin', 'nudibranch', 'whaleShark', 'dugong', 'seaSnake'],
  deepOcean: ['blueWhale', 'spermWhale', 'anglerfish', 'greatWhiteShark', 'sawfish'],
  river: ['catfish', 'carp', 'koi', 'piranha', 'pike', 'flounder', 'muskrat', 'kingfisher', 'waterStrider', 'seaOtter'],
}

// How rare each is (NewAnimalKinds RARITIES); anything not listed is Common.
export const WILD_TIERS = {
  legendary: 'dodo blueWhale ayeAye cloudedLeopard whaleShark kodiakBear harpyEagle quetzal shoebill tuatara',
  epic: 'greatWhiteShark spermWhale humpbackWhale anglerfish sunfish manedWolf bonobo slowLoris tarsier proboscisMonkey bongo markhor saiga przewalskiHorse spectacledBear condor cassowary gharial anaconda mantaRay sawfish nautilus binturong',
  rare: 'serval caracal ocelot africanWildDog dhole honeyBadger greyWolf grizzlyBear slothBear numbat echidna sugarGlider bilby kudu oryx gerenuk eland nyala takin pronghorn guanaco vicuna pygmyHippo babirusa hornbill cockatoo kookaburra albatross secretaryBird osprey frilledLizard gilaMonster monitorLizard basilisk caiman poisonDartFrog leopardSeal elephantSeal dugong seaOtter tigerShark marlin barracuda lionfish ringTailedLemur colobus gelada howlerMonkey spiderMonkey tarantula stagBeetle rhinoBeetle',
  uncommon: 'bobcat wildcat sandCat raccoonDog mongoose stoat mink marten civet coati kinkajou chipmunk prairieDog jerboa flyingSquirrel pika capuchin marmoset tamarin springbok dikDik chamois mountainGoat muntjac peccary hyrax elephantShrew robin blueJay cardinal magpie kingfisher hoopoe lovebird budgie stork crane ibis spoonbill cormorant brownPelican kestrel rhea pheasant grouse ptarmigan loon mandarinDuck boa rattlesnake seaSnake treeFrog bullfrog snappingTurtle angelfish parrotfish koi piranha pike cuttlefish hornet stickInsect cicada glowworm',
}
