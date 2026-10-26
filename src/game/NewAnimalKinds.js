// 50 more animals (2026-10-26, Gaymi: "make 50 more animals not currently
// in the game yet also add the animal's name above them and make them all
// have rarities"). Same blocky boxes and numbers as AnimalKinds.js (body
// [w, h, l], leg height, head [w, h, l], optional headAt [y, z], colors
// [body, spots, head, snout, leg], extras), real sizes in blocks.
const pair = (on, size, [x, y, z], color) => [{ on, size, at: [-x, y, z], color }, { on, size, at: [x, y, z], color }]
const q = (body, leg, head, headAt, c, more = {}) => ({
  body, leg, head, ...(headAt ? { headAt } : {}),
  colors: { body: c[0], spots: c[1] ?? c[0], head: c[2] ?? c[0], snout: c[3] ?? c[1] ?? c[0], leg: c[4] ?? c[1] ?? c[0] },
  ...more,
})
const sea = (more) => ({ legs: 0, swim: true, ...more })
const bird = (more) => ({ legs: 2, legW: 0.05, ...more })

export const NEW_KINDS = {
  // --- pets and farm ---
  hamster: q([0.14, 0.12, 0.18], 0.03, [0.12, 0.11, 0.1], null, [0xd8a060, 0xf2e8d8, 0xd8a060, 0xe8a0a0, 0xe8c0a0], { speed: 0.8 }),
  guineaPig: q([0.2, 0.15, 0.3], 0.04, [0.16, 0.14, 0.14], null, [0x8a5a30, 0xf2eee6, 0x8a5a30, 0xe0a0a0, 0xe0a0a0], { speed: 0.7 }),
  ferret: q([0.12, 0.12, 0.5], 0.08, [0.12, 0.11, 0.16], null, [0xc8b090, 0x5a4632, 0xf0e8dc, 0x3a2a1e, 0x5a4632], { speed: 1.3, extras: [{ on: 'body', size: [0.07, 0.07, 0.25], at: [0, 0.15, -0.35], color: 0x5a4632 }] }),
  rat: q([0.12, 0.11, 0.22], 0.03, [0.1, 0.09, 0.1], null, [0x5a5450, 0x4a4440, 0x5a5450, 0xe8a0a0, 0xe8a0a0], { speed: 1.1, extras: [{ on: 'body', size: [0.02, 0.02, 0.25], at: [0, 0.06, -0.22], color: 0xe8a0a0 }] }),
  mole: q([0.15, 0.12, 0.25], 0.03, [0.1, 0.09, 0.1], null, [0x2a2420, 0x1e1a18, 0x2a2420, 0xe8a0b0, 0xe8a0b0], { speed: 0.5, eyes: false }),
  bull: q([1.0, 0.9, 1.6], 0.6, [0.6, 0.6, 0.55], null, [0x3a2a22, 0x2a1e18, 0x3a2a22, 0x8a6a5a, 0x2a1e18], { speed: 1.1, health: 80, meat: 3, extras: [...pair('head', [0.3, 0.08, 0.08], [0.38, 0.25, -0.1], 0xe8e0c8), ...pair('head', [0.08, 0.18, 0.08], [0.5, 0.35, -0.1], 0xe8e0c8)] }),
  pony: q([0.55, 0.55, 1.1], 0.55, [0.3, 0.32, 0.5], [1.4, 0.72], [0xd8c8a8, 0xc8b898, 0xd8c8a8, 0x8a7a6a, 0xc8b898], { extras: [{ on: 'body', size: [0.28, 0.5, 0.32], at: [0, 1.2, 0.45], color: 'body' }, { on: 'body', size: [0.1, 0.55, 0.25], at: [0, 1.32, 0.38], color: 0xf2f2ee }, { on: 'body', size: [0.1, 0.45, 0.1], at: [0, 0.95, -0.6], color: 0xf2f2ee }] }),
  mule: q([0.6, 0.65, 1.25], 0.75, [0.32, 0.38, 0.6], [1.7, 0.85], [0x6a4a32, 0x5a3e28, 0x6a4a32, 0xc8b8a0, 0x4a3424], { extras: [{ on: 'body', size: [0.3, 0.6, 0.35], at: [0, 1.35, 0.55], color: 'body' }, ...pair('head', [0.08, 0.32, 0.06], [0.09, 0.32, -0.15], 0x6a4a32)] }),
  husky: q([0.45, 0.45, 0.95], 0.5, [0.38, 0.36, 0.36], [1.05, 0.6], [0x7a7f88, 0xf2f2ee, 0x7a7f88, 0xf2f2ee, 0xf2f2ee], { extras: [...pair('head', [0.1, 0.16, 0.06], [0.12, 0.25, -0.08], 0x7a7f88), { on: 'body', size: [0.14, 0.14, 0.45], at: [0, 0.95, -0.6], color: 0x7a7f88 }] }),
  // --- wild dogs and cats ---
  dingo: q([0.4, 0.42, 0.85], 0.45, [0.32, 0.3, 0.34], [0.95, 0.55], [0xd09050, 0xf0dcc0, 0xd09050, 0xf0dcc0, 0xf0dcc0], { extras: [...pair('head', [0.09, 0.14, 0.05], [0.1, 0.22, -0.06], 0xd09050), { on: 'body', size: [0.1, 0.1, 0.4], at: [0, 0.8, -0.55], color: 'body' }] }),
  jackal: q([0.32, 0.36, 0.7], 0.42, [0.26, 0.26, 0.32], [0.85, 0.45], [0xa8804a, 0x3a3028, 0xa8804a, 0xe8dcc0, 0xa8804a], { speed: 1.3, extras: [...pair('head', [0.08, 0.16, 0.05], [0.09, 0.2, -0.06], 0xa8804a), { on: 'body', size: [0.1, 0.1, 0.35], at: [0, 0.7, -0.45], color: 0x3a3028 }] }),
  fennecFox: q([0.25, 0.24, 0.45], 0.2, [0.22, 0.2, 0.22], null, [0xf0d8a8, 0xf8f0e0, 0xf0d8a8, 0x2a2420, 0xf0d8a8], { speed: 1.4, extras: [...pair('head', [0.12, 0.24, 0.04], [0.1, 0.2, -0.04], 0xf0d8a8), { on: 'body', size: [0.14, 0.14, 0.35], at: [0, 0.4, -0.38], color: 0xf0d8a8 }] }),
  cougar: q([0.5, 0.55, 1.3], 0.5, [0.36, 0.32, 0.34], null, [0xb88a5a, 0xe8d8c0, 0xb88a5a, 0xe8d8c0, 0xb88a5a], { speed: 1.3, extras: [{ on: 'body', size: [0.1, 0.1, 0.8], at: [0, 0.8, -0.95], color: 'body' }] }),
  blackPanther: q([0.5, 0.55, 1.3], 0.5, [0.36, 0.32, 0.34], null, [0x1a1a1e, 0x26262a, 0x1a1a1e, 0x2a2a2e, 0x1a1a1e], { speed: 1.4, extras: [{ on: 'body', size: [0.1, 0.1, 0.8], at: [0, 0.8, -0.95], color: 'body' }] }),
  // --- savanna, jungle and far away ---
  okapi: q([0.55, 0.65, 1.3], 0.85, [0.3, 0.35, 0.5], [1.95, 0.8], [0x4a2a22, 0xf2eee6, 0x6a4a3a, 0x2a1e18, 0xf2eee6], { stripes: true, extras: [{ on: 'body', size: [0.28, 0.5, 0.32], at: [0, 1.7, 0.55], color: 0x4a2a22 }, ...pair('head', [0.08, 0.16, 0.05], [0.12, 0.22, -0.1], 0x4a2a22)] }),
  impala: q([0.32, 0.42, 0.85], 0.65, [0.2, 0.24, 0.32], [1.35, 0.52], [0xb8784a, 0xf2eee6, 0xb8784a, 0x2a2420, 0xb8784a], { speed: 1.6, extras: pair('head', [0.04, 0.45, 0.04], [0.06, 0.35, -0.05], 0x2a2420) }),
  waterBuffalo: q([1.0, 0.9, 1.8], 0.6, [0.5, 0.55, 0.6], null, [0x2e2c2c, 0x242222, 0x2e2c2c, 0x3a3838, 0x242222], { speed: 0.8, health: 90, meat: 3, extras: pair('head', [0.5, 0.12, 0.12], [0.42, 0.25, -0.1], 0x5a5048) }),
  aardvark: q([0.45, 0.45, 0.9], 0.3, [0.22, 0.22, 0.5], [0.75, 0.7], [0xb89a88, 0xa08878, 0xb89a88, 0xe0b0a0, 0xa08878], { speed: 0.7, extras: [...pair('head', [0.07, 0.3, 0.05], [0.08, 0.25, -0.15], 0xb89a88), { on: 'body', size: [0.14, 0.14, 0.5], at: [0, 0.55, -0.65], color: 'body' }] }),
  pangolin: q([0.35, 0.3, 0.7], 0.12, [0.16, 0.16, 0.25], null, [0x8a6a48, 0x5a4430, 0x8a6a48, 0x5a4430, 0x5a4430], { stripes: true, speed: 0.5, extras: [{ on: 'body', size: [0.22, 0.2, 0.6], at: [0, 0.22, -0.6], color: 'body' }] }),
  mandrill: q([0.4, 0.45, 0.75], 0.45, [0.3, 0.3, 0.34], null, [0x5a5a3a, 0x4a4a2e, 0x5a5a3a, 0xd03030, 0x4a4a2e], { extras: [...pair('head', [0.04, 0.18, 0.18], [0.13, -0.05, 0.1], 0x3a60c0), { on: 'body', size: [0.07, 0.2, 0.07], at: [0, 0.95, -0.4], color: 'body' }] }),
  gibbon: q([0.25, 0.35, 0.22], 0.3, [0.2, 0.2, 0.2], [0.82, 0.08], [0x3a2e26, 0x2a2018, 0x3a2e26, 0xd8c0a0, 0x3a2e26], { legs: 2, speed: 1.3, extras: pair('body', [0.08, 0.75, 0.08], [0.17, 0.35, 0.03], 0x3a2e26) }),
  tasmanianDevil: q([0.3, 0.3, 0.55], 0.18, [0.3, 0.26, 0.28], null, [0x1e1c1c, 0xf2f2ee, 0x1e1c1c, 0xe08a8a, 0x1e1c1c], { speed: 1.1, extras: [{ on: 'body', size: [0.32, 0.08, 0.1], at: [0, 0.38, 0.2], color: 0xf2f2ee }, ...pair('head', [0.08, 0.08, 0.04], [0.12, 0.15, -0.04], 0xe08a8a)] }),
  quokka: q([0.25, 0.3, 0.4], 0.15, [0.2, 0.2, 0.2], [0.52, 0.25], [0x8a6a50, 0x7a5a40, 0x8a6a50, 0x2a2420, 0x7a5a40], { legs: 2, legW: 0.08, speed: 0.9, extras: [...pair('head', [0.06, 0.07, 0.04], [0.08, 0.12, -0.04], 0x7a5a40), { on: 'body', size: [0.07, 0.07, 0.3], at: [0, 0.2, -0.3], color: 'body' }] }),
  sunBear: q([0.6, 0.55, 1.0], 0.35, [0.38, 0.34, 0.36], null, [0x1e1c1c, 0xf0b040, 0x1e1c1c, 0xc8a070, 0x1e1c1c], { speed: 0.9, extras: [{ on: 'body', size: [0.4, 0.15, 0.04], at: [0, 0.75, 0.51], color: 0xf0b040 }, ...pair('head', [0.08, 0.08, 0.04], [0.13, 0.18, -0.06], 0x1e1c1c)] }),
  blackBear: q([0.8, 0.75, 1.4], 0.5, [0.48, 0.44, 0.46], null, [0x1e1c1c, 0x2a2626, 0x1e1c1c, 0xb89a78, 0x2a2626], { speed: 0.85, extras: pair('head', [0.12, 0.12, 0.06], [0.17, 0.26, -0.1], 0x1e1c1c) }),
  // --- hills, snow and woods ---
  ibex: q([0.55, 0.6, 1.0], 0.6, [0.3, 0.36, 0.4], [1.35, 0.62], [0x9a7a58, 0x7a5e40, 0x9a7a58, 0x5a4430, 0x7a5e40], { extras: pair('head', [0.07, 0.6, 0.07], [0.09, 0.4, -0.2], 0x5a4a38) }),
  bighornSheep: q([0.6, 0.62, 1.05], 0.55, [0.32, 0.38, 0.42], [1.35, 0.65], [0x8a6a4a, 0xf0e8d8, 0x8a6a4a, 0xf0e8d8, 0x7a5a3a], { extras: pair('head', [0.12, 0.3, 0.3], [0.22, 0.12, -0.05], 0xb8a080) }),
  hare: q([0.3, 0.3, 0.5], 0.18, [0.24, 0.24, 0.26], [0.58, 0.28], [0x9a7a58, 0xd8c8b0, 0x9a7a58, 0xe0b0b0, 0x9a7a58], { speed: 1.6, extras: pair('head', [0.07, 0.34, 0.05], [0.07, 0.3, -0.04], 0x9a7a58) }),
  marmot: q([0.32, 0.28, 0.5], 0.1, [0.24, 0.22, 0.24], null, [0x8a6a40, 0x6a4e2c, 0x8a6a40, 0xd8c8a8, 0x5a4228], { speed: 0.7, extras: [{ on: 'body', size: [0.12, 0.1, 0.25], at: [0, 0.22, -0.35], color: 0x5a4228 }] }),
  wolverine: q([0.4, 0.35, 0.8], 0.25, [0.3, 0.26, 0.3], null, [0x3a2a1e, 0xb08a5a, 0x3a2a1e, 0x2a1e18, 0x2a1e18], { speed: 1.1, health: 45, extras: [{ on: 'body', size: [0.42, 0.08, 0.7], at: [0, 0.52, -0.02], color: 0xb08a5a }, { on: 'body', size: [0.14, 0.14, 0.3], at: [0, 0.45, -0.52], color: 0x3a2a1e }] }),
  bat: q([0.14, 0.16, 0.12], 0.04, [0.12, 0.12, 0.12], [0.25, 0.07], [0x2a2420, 0x1e1a18, 0x2a2420, 0x2a2420, 0x1e1a18], bird({ fly: 4, speed: 1.4, extras: [...pair('body', [0.35, 0.03, 0.18], [0.24, 0.17, 0], 0x3a302a), ...pair('head', [0.04, 0.08, 0.03], [0.04, 0.09, 0], 0x2a2420)] })),
  // --- birds ---
  raven: q([0.22, 0.25, 0.4], 0.15, [0.15, 0.15, 0.18], [0.48, 0.22], [0x16161c, 0x22222a, 0x16161c, 0x2a2a2e, 0x2a2a2e], bird({ extras: [{ on: 'body', size: [0.18, 0.04, 0.2], at: [0, 0.3, -0.28], color: 0x16161c }] })),
  toucan: q([0.22, 0.3, 0.3], 0.12, [0.17, 0.17, 0.17], [0.5, 0.15], [0x16161c, 0xf2f2ee, 0x16161c, 0xf08a20, 0x5a80c0], bird({ extras: [{ on: 'head', size: [0.09, 0.11, 0.3], at: [0, -0.01, 0.22], color: 0xf08a20 }, { on: 'body', size: [0.16, 0.14, 0.04], at: [0, 0.32, 0.15], color: 0xf8e070 }] })),
  macaw: q([0.24, 0.38, 0.3], 0.12, [0.2, 0.2, 0.2], [0.6, 0.12], [0x2a6fd0, 0xf0c020, 0x2a6fd0, 0x2a2a2a, 0x5a5a5a], bird({ extras: [{ on: 'body', size: [0.1, 0.05, 0.5], at: [0, 0.22, -0.4], color: 0x2a6fd0 }, { on: 'body', size: [0.2, 0.2, 0.04], at: [0, 0.32, 0.15], color: 0xf0c020 }] })),
  kiwi: q([0.3, 0.28, 0.35], 0.15, [0.14, 0.14, 0.14], [0.38, 0.2], [0x6a5038, 0x5a4430, 0x6a5038, 0xd8c8a0, 0xd8c8a0], bird({ legW: 0.06, speed: 0.8, extras: [{ on: 'head', size: [0.03, 0.03, 0.25], at: [0, -0.03, 0.18], color: 0xd8c8a0 }] })),
  puffin: q([0.22, 0.3, 0.25], 0.08, [0.17, 0.17, 0.17], [0.45, 0.1], [0x16161c, 0xf2f2ee, 0xf2f2ee, 0xf06020, 0xf06020], bird({ extras: [{ on: 'body', size: [0.18, 0.24, 0.04], at: [0, 0.22, 0.12], color: 0xf2f2ee }, { on: 'head', size: [0.17, 0.06, 0.17], at: [0, 0.07, 0], color: 0x16161c }] })),
  vulture: q([0.4, 0.45, 0.55], 0.25, [0.16, 0.18, 0.22], [0.9, 0.3], [0x3a2e26, 0x2a2018, 0xe0b0a0, 0xd8c8a0, 0x8a8a8a], bird({ fly: 8, extras: [...pair('body', [0.7, 0.05, 0.4], [0.5, 0.55, 0], 0x2a2018), { on: 'body', size: [0.3, 0.1, 0.15], at: [0, 0.7, 0.25], color: 0xf0eee8 }] })),
  heron: q([0.22, 0.3, 0.45], 0.85, [0.12, 0.13, 0.18], [1.65, 0.35], [0x8a9098, 0x6a7078, 0xf0f0ee, 0xe0b020, 0xa89060], bird({ extras: [{ on: 'body', size: [0.07, 0.55, 0.07], at: [0, 1.35, 0.25], color: 0xd8dce0 }] })),
  roadrunner: q([0.16, 0.2, 0.4], 0.25, [0.13, 0.14, 0.16], [0.55, 0.25], [0x7a6a50, 0x4a3e2e, 0x7a6a50, 0x3a3a3a, 0x7a7a7a], bird({ speed: 1.8, extras: [{ on: 'body', size: [0.06, 0.06, 0.4], at: [0, 0.42, -0.35], color: 0x4a3e2e }, { on: 'head', size: [0.03, 0.1, 0.08], at: [0, 0.1, -0.03], color: 0x4a3e2e }] })),
  // --- water ---
  orca: q([1.6, 1.6, 7], 0, [1.4, 1.2, 1.0], [0.9, 3.8], [0x16161c, 0xf2f2ee, 0x16161c, 0x16161c], sea({ speed: 0.9, health: 180, meat: 5, extras: [{ on: 'body', size: [0.2, 1.6, 0.8], at: [0, 2.2, 0], color: 0x16161c }, { on: 'body', size: [1.5, 0.4, 4], at: [0, 0.15, 0.6], color: 0xf2f2ee }, { on: 'body', size: [2.4, 0.15, 1.0], at: [0, 0.6, -3.8], color: 0x16161c }] })),
  hammerheadShark: q([0.7, 0.8, 3.2], 0, [1.3, 0.3, 0.4], [0.45, 1.8], [0x7a8490, 0x6a7480, 0x7a8490, 0xe8ece8], sea({ speed: 1.1, health: 80, meat: 3, extras: [{ on: 'body', size: [0.12, 0.75, 0.5], at: [0, 1.1, 0.3], color: 0x6a7480 }, { on: 'body', size: [0.12, 0.8, 0.35], at: [0, 0.5, -1.75], color: 0x6a7480 }] })),
  pufferfish: q([0.3, 0.3, 0.32], 0, [0.1, 0.1, 0.06], [0.17, 0.18], [0xe8d070, 0xa89040], sea({ speed: 0.4, extras: [{ on: 'body', size: [0.34, 0.04, 0.36], at: [0, 0.17, 0], color: 0xa89040 }, { on: 'body', size: [0.15, 0.15, 0.06], at: [0, 0.15, -0.19], color: 0xe8d070 }] })),
  axolotl: q([0.14, 0.1, 0.28], 0.04, [0.16, 0.1, 0.12], null, [0xf0a8c0, 0xe890b0, 0xf0a8c0, 0xe890b0, 0xf0a8c0], { swim: true, speed: 0.6, extras: [...pair('head', [0.04, 0.12, 0.03], [0.1, 0.04, -0.03], 0xd8507a), { on: 'body', size: [0.03, 0.08, 0.2], at: [0, 0.1, -0.2], color: 0xe890b0 }] }),
  crayfish: q([0.12, 0.08, 0.3], 0.04, [0.08, 0.06, 0.08], null, [0x8a3a2a, 0x6a2a1e], { legs: 6, legW: 0.03, extras: pair('body', [0.06, 0.05, 0.14], [0.09, 0.08, 0.24], 0x8a3a2a) }),
  // --- reptiles ---
  tortoise: q([0.6, 0.35, 0.7], 0.12, [0.18, 0.16, 0.2], [0.25, 0.45], [0x6a5a3a, 0x4a3e26, 0x8a8a6a, 0x8a8a6a, 0x8a8a6a], { speed: 0.2, health: 40, extras: [{ on: 'body', size: [0.52, 0.18, 0.6], at: [0, 0.55, 0], color: 0x5a4a2e }] }),
  cobra: q([0.14, 0.14, 1.5], 0, [0.16, 0.12, 0.2], [0.55, 0.8], [0x3a3020, 0x5a4a30, 0x3a3020, 0xd8c890], { legs: 0, extras: [{ on: 'body', size: [0.13, 0.45, 0.13], at: [0, 0.3, 0.7], color: 'body' }, { on: 'head', size: [0.36, 0.3, 0.04], at: [0, -0.15, -0.1], color: 0x5a4a30 }] }),
  python: q([0.25, 0.2, 2.6], 0, [0.2, 0.14, 0.28], null, [0x8a7a4a, 0x4a3e26, 0x8a7a4a, 0x6a5a38], { legs: 0, speed: 0.4, health: 40 }),
  // --- bugs (kept big enough to see) ---
  firefly: q([0.08, 0.06, 0.14], 0.02, [0.06, 0.06, 0.05], null, [0x2a2420, 0xf0f080, 0x2a2420], { legs: 6, legW: 0.015, fly: 2, extras: [{ on: 'body', size: [0.07, 0.05, 0.06], at: [0, 0.04, -0.08], color: 0xf8f8a0 }, ...pair('body', [0.08, 0.01, 0.1], [0.05, 0.08, 0], 0xd8e0e8)] }),
  snail: q([0.12, 0.08, 0.3], 0, [0.08, 0.08, 0.08], [0.08, 0.16], [0x9a8a6a, 0x8a7a5a, 0x9a8a6a], { legs: 0, speed: 0.05, extras: [{ on: 'body', size: [0.16, 0.2, 0.2], at: [0, 0.17, -0.03], color: 0x8a5a30 }, ...pair('head', [0.015, 0.08, 0.015], [0.025, 0.07, 0], 0x9a8a6a)] }),
  mantis: q([0.06, 0.06, 0.3], 0.1, [0.07, 0.06, 0.06], [0.3, 0.2], [0x6ab040, 0x5a9a30, 0x6ab040], { legW: 0.015, extras: [{ on: 'body', size: [0.04, 0.18, 0.04], at: [0, 0.22, 0.12], color: 0x6ab040 }, ...pair('body', [0.02, 0.02, 0.12], [0.04, 0.25, 0.18], 0x5a9a30)] }),
}

// Where each lives (added to PlayAnimals' BIOME_ANIMALS like AnimalKinds').
export const NEW_BIOME_ANIMALS = {
  city: ['rat', 'raven'],
  plains: ['bull', 'pony', 'mule', 'hare', 'hamster', 'guineaPig'],
  forest: ['ferret', 'mole', 'blackBear', 'firefly', 'snail', 'mantis', 'raven', 'bat', 'kiwi'],
  birchForest: ['hare', 'snail', 'firefly'],
  darkForest: ['bat', 'blackPanther', 'raven'],
  cherryGrove: ['firefly', 'mantis'],
  taiga: ['wolverine', 'blackBear'],
  snowyTaiga: ['husky', 'wolverine'],
  snowyPlains: ['husky', 'hare'],
  desert: ['fennecFox', 'jackal', 'roadrunner', 'cobra', 'tortoise', 'vulture'],
  badlands: ['cougar', 'bighornSheep', 'roadrunner', 'vulture'],
  savanna: ['impala', 'waterBuffalo', 'aardvark', 'pangolin', 'jackal', 'dingo', 'quokka', 'tasmanianDevil', 'vulture'],
  jungle: ['okapi', 'mandrill', 'gibbon', 'toucan', 'macaw', 'python', 'blackPanther', 'sunBear'],
  bambooJungle: ['gibbon', 'sunBear'],
  swamp: ['python', 'heron', 'axolotl', 'crayfish'],
  mangroveSwamp: ['heron', 'crayfish'],
  mountains: ['ibex', 'marmot', 'bighornSheep', 'cougar'],
  snowyPeaks: ['ibex'],
  beach: ['puffin'],
  snowyBeach: ['puffin'],
  frozenOcean: ['orca'],
  ocean: ['orca', 'hammerheadShark', 'pufferfish'],
  warmOcean: ['hammerheadShark', 'pufferfish'],
  deepOcean: ['orca'],
  river: ['axolotl', 'crayfish', 'heron'],
}

// Rarity (2026-10-26, Gaymi picked 6 tiers including Mythic): how rare
// the animal is in real life. Every dinosaur is Mythic; an animal not
// listed is Common. `spawn` scales how often it turns up in its biome
// (Mythic dinosaurs keep their own DINO_CHANCE); `color` is its name
// tag's colour.
export const RARITIES = {
  common: { spawn: 1, color: '#d6d6d6' },
  uncommon: { spawn: 0.7, color: '#5fd35f' },
  rare: { spawn: 0.4, color: '#4aa3ff' },
  epic: { spawn: 0.18, color: '#b45cff' },
  legendary: { spawn: 0.07, color: '#ffb020' },
  mythic: { spawn: 1, color: '#ff4d6d' },
}
const TIERS = {
  legendary: 'blackPanther snowLeopard okapi narwhal komodoDragon axolotl panda platypus tasmanianDevil whale belugaWhale',
  epic: 'tiger redPanda gorilla orangutan cheetah polarBear orca hammerheadShark pangolin quokka kiwi wolverine elephant rhino snowyOwl peacock manatee seaTurtle jaguar lynx chinchilla macaw toucan mandrill sunBear chameleon seahorse octopus eagle flamingo',
  rare: 'lion leopard giraffe zebra hippo crocodile alligator shark dolphin koala kangaroo sloth anteater tapir gibbon bison moose walrus arcticFox fennecFox cougar ibex bighornSheep aardvark puffin vulture cobra python ostrich emu stingray swordfish falcon hawk owl wolf bear blackBear firefly mantis waterBuffalo lemur meerkat wombat otter beaver hummingbird pelican scorpion',
  uncommon: 'fox deer goat camel horse donkey mule pony bull turkey husky dingo jackal hyena warthog baboon monkey chimpanzee gazelle impala wildebeest boar elk reindeer muskox yak llama alpaca capybara coyote armadillo badger hedgehog porcupine skunk opossum raccoon weasel ferret hare marmot parrot penguin turtle tortoise seal seaLion jellyfish squid eel lobster iguana salamander newt woodpecker swan goose roadrunner raven bat hamster guineaPig mole ladybug dragonfly heron',
}
const TIER_OF = {}
for (const [tier, ids] of Object.entries(TIERS)) for (const id of ids.split(' ')) TIER_OF[id] = tier
export function rarityOf(kind, k) {
  return k?.dino ? 'mythic' : TIER_OF[kind] || 'common'
}
