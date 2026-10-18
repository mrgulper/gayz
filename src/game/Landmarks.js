// Real landmarks for the spawn map (2026-10-18, Gaymi: "the world map with
// countries and make real buildings that are there in the world of that
// country"). Spawning from the map in one of these countries builds its
// landmark out of blocks a short walk from where you start, facing you.
// Simple block versions, not exact copies - full cubes only (open-world
// terrain can't hold slabs, stairs or fences).
//
// Each builder gets the plan's Builder `b` (WorldStructures.js) and
// { H, cx, cz }: H(x, z).h is the ground height. pad() levels a footprint
// on a solid base so nothing floats, and returns the first free y on top.

import { earthAt } from './WorldStructures.js'

export const LANDMARKS = {
  France: { kind: 'eiffel', key: 'landmarkEiffel' },
  'United States of America': { kind: 'liberty', key: 'landmarkLiberty' },
  'United Kingdom': { kind: 'bigben', key: 'landmarkBigBen' },
  Italy: { kind: 'colosseum', key: 'landmarkColosseum' },
  China: { kind: 'greatwall', key: 'landmarkGreatWall' },
  India: { kind: 'tajmahal', key: 'landmarkTajMahal' },
  Japan: { kind: 'pagoda', key: 'landmarkPagoda' },
  Brazil: { kind: 'christ', key: 'landmarkChrist' },
  Australia: { kind: 'opera', key: 'landmarkOpera' },
  Russia: { kind: 'stbasil', key: 'landmarkStBasil' },
  Greece: { kind: 'parthenon', key: 'landmarkParthenon' },
  Mexico: { kind: 'chichen', key: 'landmarkChichen' },
  Egypt: { kind: 'giza', key: 'landmarkGiza' },
  Germany: { kind: 'brandenburg', key: 'landmarkBrandenburg' },
  Netherlands: { kind: 'windmill', key: 'landmarkWindmill' },
  Canada: { kind: 'cntower', key: 'landmarkCnTower' },
  'United Arab Emirates': { kind: 'burj', key: 'landmarkBurj' },
}

// How far each landmark reaches from its middle (for placing it clear of you).
export const LANDMARK_REACH = { eiffel: 16, liberty: 6, bigben: 5, colosseum: 24, greatwall: 42, tajmahal: 14, pagoda: 9, christ: 10, opera: 18, stbasil: 9, parthenon: 14, chichen: 17, giza: 34, brandenburg: 12, windmill: 11, cntower: 7, burj: 6 }

// The raised ground is natural rock and earth (earthAt); only its top
// layer is the landmark's own paving (type).
function pad(b, H, cx, cz, rx, rz, type) {
  let top = -Infinity
  for (let x = cx - rx; x <= cx + rx; x++) for (let z = cz - rz; z <= cz + rz; z++) top = Math.max(top, H(x, z).h)
  for (let x = cx - rx; x <= cx + rx; x++) {
    for (let z = cz - rz; z <= cz + rz; z++) for (let y = H(x, z).h + 1; y <= top; y++) b.set(x, y, z, y === top ? type : earthAt(x, y, z, top))
  }
  return top + 1
}

// A filled (or hollow) square ring of half size r at height y.
function square(b, cx, cz, r, y, type, hollow = false) {
  for (let x = cx - r; x <= cx + r; x++) {
    for (let z = cz - r; z <= cz + r; z++) {
      if (hollow && Math.abs(x - cx) < r && Math.abs(z - cz) < r) continue
      b.set(x, y, z, type)
    }
  }
}

function disc(b, cx, cz, r, y, type, hollowR = -1) {
  for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      const d = Math.hypot(x - cx, z - cz)
      if (d <= r && d > hollowR) b.set(x, y, z, type)
    }
  }
}

function dome(b, cx, cy, cz, r, type) {
  for (let y = 0; y <= r; y++) disc(b, cx, cz, Math.sqrt(Math.max(0, r * r - y * y)), cy + y, type)
}

const BUILDERS = {
  eiffel(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 15, 15, 'smoothstone')
    const T = 'brownterracotta'
    const top = 56
    for (let y = 0; y < top; y++) {
      const w = Math.round(14 * Math.pow(1 - y / top, 1.7)) + 1
      if (y < 22) {
        // Four legs leaning in.
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) b.set(cx + sx * (w - k), base + y, cz + sz * (w - j), T)
        }
      } else if (y % 3 === 0) square(b, cx, cz, w, base + y, T, true)
      else for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.set(cx + sx * w, base + y, cz + sz * w, T)
      // The two decks.
      if (y === 10 || y === 22) square(b, cx, cz, w + 1, base + y, T, true)
      if (y === 10) square(b, cx, cz, w - 1, base + y, T, true)
    }
    for (let y = top; y < top + 6; y++) b.set(cx, base + y, cz, 'iron')
    b.set(cx, base + top + 6, cz, 'glowstone')
  },

  liberty(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 6, 6, 'smoothstone')
    for (let y = 0; y < 9; y++) square(b, cx, cz, y < 2 ? 6 : 4, base + y, y < 2 ? 'stonebricks' : 'smoothstone')
    const s = base + 9
    const C = 'oxidizedcopper'
    for (let y = 0; y < 6; y++) square(b, cx, cz, 2, s + y, C) // robe
    for (let y = 6; y < 16; y++) square(b, cx, cz, 1, s + y, C) // body
    square(b, cx, cz, 1, s + 16, C)
    square(b, cx, cz, 1, s + 17, C) // head
    for (const [dx, dz] of [[0, -2], [2, 0], [-2, 0], [1, -2], [-1, -2]]) b.set(cx + dx, s + 18, cz + dz, C) // crown
    for (let y = 11; y < 22; y++) b.set(cx + 2, s + y, cz, C) // raised arm
    b.set(cx + 2, s + 22, cz, 'gold')
    b.set(cx + 2, s + 23, cz, 'glowstone') // the torch
    for (let y = 9; y < 13; y++) b.set(cx - 2, s + y, cz - 1, C) // the tablet
  },

  bigben(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 4, 4, 'stonebricks')
    for (let y = 0; y < 34; y++) square(b, cx, cz, 3, base + y, y % 6 === 5 ? 'smoothsandstone' : 'cutsandstone', true)
    // A clock face on every side.
    for (let y = 26; y <= 30; y++) {
      for (let k = -2; k <= 2; k++) {
        const edge = Math.abs(k) === 2 || y === 26 || y === 30
        const t = edge ? 'gold' : 'quartz'
        b.set(cx + k, base + y, cz - 4, t)
        b.set(cx + k, base + y, cz + 4, t)
        b.set(cx - 4, base + y, cz + k, t)
        b.set(cx + 4, base + y, cz + k, t)
      }
    }
    for (const [x, z] of [[cx, cz - 4], [cx, cz + 4], [cx - 4, cz], [cx + 4, cz]]) {
      b.set(x, base + 28, z, 'blackconcrete')
      b.set(x, base + 29, z, 'blackconcrete')
    }
    for (let k = 0; k < 9; k++) square(b, cx, cz, Math.max(0, 3 - Math.floor(k / 2)), base + 34 + k, 'blackstone')
    b.set(cx, base + 43, cz, 'gold')
  },

  colosseum(b, { H, cx, cz }) {
    const RX = 22
    const RZ = 17
    const base = pad(b, H, cx, cz, RX, RZ, 'sandstone')
    for (let x = cx - RX; x <= cx + RX; x++) {
      for (let z = cz - RZ; z <= cz + RZ; z++) {
        const e = Math.hypot((x - cx) / RX, (z - cz) / RZ)
        if (e > 1) continue
        if (e > 0.78) {
          // The outer wall: three tiers of arches.
          const outer = e > 0.92
          for (let y = 0; y < 15; y++) {
            const tier = y % 5
            const arch = outer && tier >= 1 && tier <= 3 && (Math.round(Math.atan2(z - cz, x - cx) * 9) % 2 === 0)
            if (!arch) b.set(x, base + y, z, y % 5 === 0 ? 'smoothsandstone' : 'sandstone')
          }
        } else if (e > 0.55) {
          // Stepped seating inside.
          const h = Math.round((e - 0.55) / 0.23 * 9)
          for (let y = 0; y <= h; y++) b.set(x, base + y, z, 'smoothsandstone')
        } else b.set(x, base - 1, z, 'sand')
      }
    }
  },

  greatwall(b, { H, cx, cz }) {
    for (let d = -40; d <= 40; d++) {
      const zc = Math.round(cz + Math.sin(d / 9) * 5)
      const x = cx + d
      const tower = Math.abs(d % 20) <= 2
      const half = tower ? 3 : 1
      let g = -Infinity
      for (let w = -half; w <= half; w++) g = Math.max(g, H(x, zc + w).h)
      const top = g + (tower ? 10 : 6)
      for (let w = -half - (tower ? 0 : 0); w <= half; w++) {
        const z = zc + w
        for (let y = H(x, z).h + 1; y <= top; y++) b.set(x, y, z, 'stonebricks')
        // Battlements on the outer edges.
        if (Math.abs(w) === half && (d % 2 === 0 || tower)) b.set(x, top + 1, z, 'stonebricks')
      }
    }
  },

  tajmahal(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 13, 13, 'marble')
    for (let y = 0; y < 2; y++) square(b, cx, cz, 13, base + y, 'marble')
    const f = base + 2
    for (let y = 0; y < 11; y++) square(b, cx, cz, 7, f + y, 'marble', true)
    // Big arched doorways on every side.
    for (let y = 0; y < 7; y++) for (let k = -2; k <= 2; k++) {
      if (y === 6 && Math.abs(k) === 2) continue
      b.clear(cx + k, f + y, cz - 7)
      b.clear(cx + k, f + y, cz + 7)
      b.clear(cx - 7, f + y, cz + k)
      b.clear(cx + 7, f + y, cz + k)
    }
    square(b, cx, cz, 7, f + 11, 'quartz')
    for (let y = 12; y < 14; y++) disc(b, cx, cz, 4, f + y, 'marble')
    dome(b, cx, f + 14, cz, 6, 'marble')
    b.set(cx, f + 21, cz, 'gold')
    b.set(cx, f + 22, cz, 'gold')
    for (const [dx, dz] of [[-11, -11], [-11, 11], [11, -11], [11, 11]]) {
      for (let y = 0; y < 18; y++) disc(b, cx + dx, cz + dz, 1.2, f + y, y % 6 === 5 ? 'quartz' : 'quartzpillar')
      dome(b, cx + dx, f + 18, cz + dz, 1.5, 'marble')
    }
  },

  pagoda(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 8, 8, 'stonebricks')
    let y = base
    for (let tier = 0; tier < 5; tier++) {
      const r = 5 - tier
      for (let k = 0; k < 3; k++) square(b, cx, cz, r, y + k, k === 1 && tier > 0 ? 'darkoakplanks' : 'redconcrete', true)
      y += 3
      square(b, cx, cz, r + 2, y, 'blackconcrete')
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) b.set(cx + sx * (r + 2), y + 1, cz + sz * (r + 2), 'blackconcrete')
      y += 1
    }
    for (let k = 0; k < 5; k++) b.set(cx, y + k, cz, 'gold')
  },

  christ(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 9, 9, 'stone')
    for (let y = 0; y < 8; y++) disc(b, cx, cz, 9 - y, base + y, y < 5 ? 'stone' : 'mossycobblestone')
    const p = base + 8
    for (let y = 0; y < 4; y++) square(b, cx, cz, 2, p + y, 'smoothstone')
    const s = p + 4
    const W = 'calcite'
    for (let y = 0; y < 14; y++) for (let k = -1; k <= 1; k++) b.set(cx + k, s + y, cz, W)
    for (let k = -9; k <= 9; k++) b.set(cx + k, s + 11, cz, W) // the open arms
    for (let k = -6; k <= 6; k++) b.set(cx + k, s + 10, cz, W)
    for (let y = 14; y < 17; y++) b.set(cx, s + y, cz, W) // the head
  },

  opera(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 18, 9, 'smoothstone')
    for (let x = cx - 18; x <= cx + 18; x++) for (let z = cz - 9; z <= cz + 9; z++) b.set(x, base, z, 'smoothstone')
    // White shells, big to small, all leaning the same way.
    for (const [ox, L, Hs] of [[-12, 9, 14], [-3, 8, 12], [5, 7, 10], [12, 5, 7]]) {
      for (let u = 0; u <= L; u++) {
        const h = Math.round(Hs * Math.sqrt(1 - (u / L) * (u / L)))
        const w = Math.max(1, Math.round(6 * (1 - u / (L + 2))))
        for (let y = 1; y <= h; y++) {
          for (const sz of [-w, w]) b.set(cx + ox + u, base + y, cz + sz, y % 4 === 0 ? 'whiteterracotta' : 'whiteconcrete')
          if (y === h) for (let k = -w; k <= w; k++) b.set(cx + ox + u, base + y, cz + k, 'whiteconcrete')
        }
      }
    }
  },

  stbasil(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 9, 9, 'redconcrete')
    const tower = (x, z, r, h, colors) => {
      for (let y = 0; y < h; y++) disc(b, x, z, r, base + y, y % 4 === 3 ? 'whiteconcrete' : 'redconcrete')
      // An onion dome in stripes.
      for (let y = 0; y <= 4; y++) {
        const rr = (r + 0.8) * Math.sin(((y + 1) / 6) * Math.PI)
        disc(b, x, z, Math.max(0.5, rr), base + h + y, colors[y % colors.length])
      }
      b.set(x, base + h + 5, z, 'gold')
      b.set(x, base + h + 6, z, 'gold')
    }
    tower(cx, cz, 2.5, 20, ['gold', 'yellowconcrete'])
    tower(cx - 6, cz, 1.6, 12, ['greenconcrete', 'yellowconcrete'])
    tower(cx + 6, cz, 1.6, 12, ['blueconcrete', 'whiteconcrete'])
    tower(cx, cz - 6, 1.6, 12, ['redwool', 'greenconcrete'])
    tower(cx, cz + 6, 1.6, 12, ['purpleconcrete', 'yellowconcrete'])
  },

  parthenon(b, { H, cx, cz }) {
    const RX = 13
    const RZ = 7
    const base = pad(b, H, cx, cz, RX, RZ, 'marble')
    for (let k = 0; k < 3; k++) for (let x = cx - RX + k; x <= cx + RX - k; x++) for (let z = cz - RZ + k; z <= cz + RZ - k; z++) b.set(x, base + k, z, 'marble')
    const f = base + 3
    for (let x = cx - RX + 3; x <= cx + RX - 3; x += 2) {
      for (const z of [cz - RZ + 3, cz + RZ - 3]) for (let y = 0; y < 9; y++) b.set(x, f + y, z, 'quartzpillar')
    }
    for (let z = cz - RZ + 3; z <= cz + RZ - 3; z += 2) {
      for (const x of [cx - RX + 3, cx + RX - 3]) for (let y = 0; y < 9; y++) b.set(x, f + y, z, 'quartzpillar')
    }
    for (let y = 9; y < 11; y++) for (let x = cx - RX + 3; x <= cx + RX - 3; x++) for (let z = cz - RZ + 3; z <= cz + RZ - 3; z++) b.set(x, f + y, z, 'marble')
    // The pediment roof.
    for (let k = 0; k <= 4; k++) for (let x = cx - RX + 3; x <= cx + RX - 3; x++) for (let z = cz - RZ + 3 + k; z <= cz + RZ - 3 - k; z++) b.set(x, f + 11 + k, z, 'smoothquartz')
  },

  chichen(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 16, 16, 'stonebricks')
    for (let tier = 0; tier < 9; tier++) {
      const r = 16 - Math.round(tier * 1.4)
      for (let k = 0; k < 2; k++) square(b, cx, cz, r, base + tier * 2 + k, k ? 'polishedandesite' : 'stonebricks')
    }
    // Stairs up the middle of every side.
    for (let s = 0; s < 18; s++) {
      const r = 16 - Math.round(s * 0.7)
      for (let w = -2; w <= 2; w++) {
        for (const [x, z] of [[cx + w, cz - r], [cx + w, cz + r], [cx - r, cz + w], [cx + r, cz + w]]) b.set(x, base + s, z, 'smoothstone')
      }
    }
    const top = base + 18
    for (let y = 0; y < 5; y++) square(b, cx, cz, 3, top + y, 'stonebricks', y < 4)
    for (let y = 0; y < 3; y++) b.clear(cx, top + y, cz - 3)
    square(b, cx, cz, 3, top + 5, 'chiseledstonebricks')
  },

  giza(b, { H, cx, cz }) {
    const pyr = (x0, z0, R, cap) => {
      const base = pad(b, H, x0, z0, R, R, 'sandstone')
      for (let k = 0; k <= R; k++) square(b, x0, z0, R - k, base + k, k === R && cap ? 'gold' : k % 2 ? 'smoothsandstone' : 'sandstone')
    }
    pyr(cx, cz, 18, true)
    pyr(cx + 24, cz + 14, 13, false)
    pyr(cx + 38, cz + 24, 8, false)
    // The Sphinx, lying in front.
    const sx = cx - 22
    const sz = cz + 4
    const base = pad(b, H, sx, sz, 7, 3, 'sandstone')
    for (let x = sx - 7; x <= sx + 5; x++) for (let z = sz - 2; z <= sz + 2; z++) for (let y = 0; y < 3; y++) b.set(x, base + y, z, 'sandstone')
    for (let x = sx + 3; x <= sx + 7; x++) for (const z of [sz - 2, sz + 2]) b.set(x, base, z, 'sandstone') // paws
    for (let y = 3; y < 7; y++) for (let z = sz - 1; z <= sz + 1; z++) for (let x = sx + 3; x <= sx + 5; x++) b.set(x, base + y, z, y === 6 ? 'smoothsandstone' : 'sandstone')
    b.set(sx + 6, base + 5, sz, 'sandstone')
  },

  brandenburg(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 11, 3, 'smoothsandstone')
    for (let x = cx - 11; x <= cx + 11; x++) for (let z = cz - 3; z <= cz + 3; z++) b.set(x, base, z, 'smoothsandstone')
    for (let i = 0; i < 6; i++) {
      const x = cx - 10 + i * 4
      for (const z of [cz - 2, cz + 2]) for (let y = 1; y < 11; y++) b.set(x, base + y, z, 'quartzpillar')
    }
    for (let y = 11; y < 14; y++) for (let x = cx - 11; x <= cx + 11; x++) for (let z = cz - 3; z <= cz + 3; z++) b.set(x, base + y, z, y === 13 ? 'smoothsandstone' : 'sandstone')
    // The chariot on top.
    for (let x = cx - 2; x <= cx + 2; x++) for (let y = 14; y < 16; y++) b.set(x, base + y, cz, 'oxidizedcopper')
    b.set(cx, base + 16, cz, 'oxidizedcopper')
  },

  windmill(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 5, 5, 'stonebricks')
    for (let y = 0; y < 14; y++) disc(b, cx, cz, 4 - y * 0.15, base + y, y < 3 ? 'brick' : 'darkoakplanks', 2.5 - y * 0.15)
    for (let y = 0; y < 3; y++) b.clear(cx, base + y, cz - 4)
    dome(b, cx, base + 14, cz, 3, 'spruceplanks')
    // Four sails on the front.
    const hubY = base + 12
    const hz = cz - 5
    for (let k = 1; k <= 10; k++) {
      for (const [dx, dy] of [[k, 0], [-k, 0], [0, k], [0, -k]]) {
        b.set(cx + dx, hubY + dy, hz, 'oakplanks')
        if (k > 2) b.set(cx + dx + (dy ? 1 : 0), hubY + dy + (dx ? 1 : 0), hz, 'whitewool')
      }
    }
    b.set(cx, hubY, hz, 'darkoaklog')
  },

  cntower(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 6, 6, 'concrete')
    for (let y = 0; y < 6; y++) square(b, cx, cz, 4 - Math.floor(y / 2), base + y, 'concrete')
    for (let y = 6; y < 60; y++) square(b, cx, cz, 1, base + y, 'concrete')
    for (let y = 44; y < 49; y++) disc(b, cx, cz, y === 46 ? 6 : 5, base + y, y === 46 ? 'lightbluestainedglass' : 'grayconcrete')
    for (let y = 60; y < 76; y++) b.set(cx, base + y, cz, 'iron')
    b.set(cx, base + 76, cz, 'redstonelamp')
  },

  burj(b, { H, cx, cz }) {
    const base = pad(b, H, cx, cz, 6, 6, 'smoothstone')
    const tiers = [[6, 14], [5, 28], [4, 42], [3, 56], [2, 68], [1, 80]]
    let y0 = 0
    for (const [r, top] of tiers) {
      for (let y = y0; y < top; y++) square(b, cx, cz, r, base + y, y % 4 === 0 ? 'iron' : 'lightbluestainedglass', r > 1)
      y0 = top
    }
    for (let y = 80; y < 92; y++) b.set(cx, base + y, cz, 'iron')
  },
}

// Builds landmark `kind` into the Builder; false if there's no such kind.
export function buildLandmark(kind, b, ctx) {
  const fn = BUILDERS[kind]
  if (!fn) return false
  fn(b, ctx)
  return true
}
