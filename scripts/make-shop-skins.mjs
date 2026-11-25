// Draws the Shop > More Skins skins (2026-11-25) as 64x64 Minecraft-format
// PNGs and writes them into src/game/ShopSkins.js as data URLs.
//   node scripts/make-shop-skins.mjs            -> rewrites ShopSkins.js
//   node scripts/make-shop-skins.mjs <out.png>  -> also a preview sheet
// Each skin is pixel art in letters: every letter is a colour from that
// skin's palette. Faces not drawn get filled from the front (see paint()).
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { SKINS_2 } from './shop-skins-sets-2.mjs'

// ---------- the skins ----------
const R12 = (s) => Array(12).fill(s)
const SKINS = [
  // ===== Winter =====
  {
    id: 'snowman', name: 'Snowman', rarity: 'common', set: 'winter',
    pal: { w: '#f4f8fb', W: '#cfe0ee', K: '#1d1d22', k: '#34343c', O: '#f08a24', R: '#d42a35', r: '#a81e28', t: '#6b4423' },
    head: ['KKKKKKKK', 'kkkkkkkk', 'wwwwwwww', 'wkkwwkkw', 'wwwOOOww', 'wkwwwwkw', 'wwkkkkww', 'wwwwwwww'],
    headBack: 'KkwwwwwW',
    body: ['RRRRRRRR', 'RRRRRRRR', 'RRwwwwww', 'RRwkkwww', 'Rrwwwwww', 'wwwwwwww', 'wwwkkwww', 'wwwwwwww', 'wwwwwwww', 'wwwkkwww', 'wwwwwwww', 'WWWWWWWW'],
    bodyBack: ['RRRRRRRR', 'RRRRRRRR', ...Array(9).fill('wwwwwwww'), 'WWWWWWWW'],
    arm: [...Array(10).fill('tttt'), 'RRRR', 'RRRR'],
    leg: [...Array(9).fill('wwww'), 'WWWW', 'WWWW', 'WWWW'],
  },
  {
    id: 'gingerbread', name: 'Gingerbread', rarity: 'uncommon', set: 'winter',
    pal: { g: '#b26a2e', w: '#fbf3e6', k: '#3a1f0f', p: '#f08aa0', R: '#e23b4a', G: '#3dbb5a', Y: '#f5c33b' },
    head: ['wgwgwgwg', 'gggggggg', 'gggggggg', 'ggkggkgg', 'gpggggpg', 'gwggggwg', 'ggwwwwgg', 'gggggggg'],
    headBack: 'wggggggg',
    body: ['gggggggg', 'wgwgwgwg', 'gggggggg', 'gggRRggg', 'gggggggg', 'gggGGggg', 'gggggggg', 'gggYYggg', 'gggggggg', 'gggggggg', 'wgwgwgwg', 'gggggggg'],
    arm: [...Array(8).fill('gggg'), 'wgwg', 'gggg', 'gggg', 'gggg'],
    leg: [...Array(8).fill('gggg'), 'wgwg', 'gggg', 'gggg', 'gggg'],
  },
  {
    id: 'elf', name: 'Elf', rarity: 'uncommon', set: 'winter',
    pal: { G: '#2f9e44', g: '#1f7a31', W: '#f6f6f6', R: '#d42a35', s: '#f2c7a5', h: '#d9742b', k: '#2a2a2a', p: '#f29aa8', m: '#b8454f', Y: '#f2c94c', K: '#3a2618', D: '#1b5e2b' },
    head: ['GGGGGGGG', 'GGGGGGGG', 'WWWWWWWW', 'hssssssh', 'hskssksh', 'spssssps', 'sssmmsss', 'ssssssss'],
    headTop: ['GGGGGGGG', 'GGGGGGGG', 'GGGGGGGG', 'GGGYYGGG', 'GGGYYGGG', 'GGGGGGGG', 'GGGGGGGG', 'GGGGGGGG'],
    headBack: 'GGWhhhhh',
    body: ['RWRWRWRW', 'GGGGGGGG', 'GGGGGGGG', 'GGGYYGGG', 'GGGGGGGG', 'GGGYYGGG', 'KKKYYKKK', 'GGGGGGGG', 'GGGGGGGG', 'GGGGGGGG', 'GGGGGGGG', 'gGgGgGgG'],
    arm: [...Array(10).fill('GGGG'), 'WWWW', 'ssss'],
    leg: ['RRRR', 'RRRR', 'WWWW', 'WWWW', 'RRRR', 'RRRR', 'WWWW', 'WWWW', 'RRRR', 'RRRR', 'DDDD', 'DDDD'],
  },
  {
    id: 'icegolem', name: 'Ice Golem', rarity: 'epic', set: 'winter', noise: 0.09,
    pal: { I: '#bfe8ff', i: '#9fd6f5', c: '#4a8fc4', E: '#3df2ff', e: '#ffffff', D: '#6fb2df' },
    head: ['IiIIiIIi', 'iIIIIIiI', 'cccIIccc', 'IEEiiEEI', 'iIIIIIIi', 'IIicIiII', 'IcIcIcIi', 'iIIIIIII'],
    headBack: 'IiIIiIiI',
    body: ['IIIIIIII', 'IiIIIIiI', 'IIcIIiII', 'IIIEEIII', 'IIEeeEII', 'IIIEEIII', 'IcIIIIiI', 'IIcIIIII', 'IiIcIIII', 'IIIIcIiI', 'iIIIIIII', 'IIIiIIII'],
    bodyBack: ['IIIIIIII', 'IiIIcIiI', 'IIcIIiII', 'IIIcIIII', 'IiIIcIIi', 'IIIIIcII', 'IcIIIIiI', 'IIcIIIII', 'IiIcIIII', 'IIIIcIiI', 'iIIIIIII', 'IIIiIIII'],
    arm: ['IiII', 'IIIi', 'IcII', 'IIcI', 'iIII', 'IIIi', 'IcII', 'IIIc', 'iIII', 'IIiI', 'DDDD', 'DcDD'],
    leg: ['IIiI', 'IcII', 'IIIi', 'iIcI', 'IIII', 'IiIc', 'IIII', 'cIIi', 'IIII', 'IiII', 'DDDD', 'DDcD'],
  },
  // ===== Survivor jobs =====
  {
    id: 'lumberjack', name: 'Lumberjack', rarity: 'common', set: 'survivor',
    pal: { N: '#4d5560', n: '#3c434c', h: '#5a3a22', s: '#e8b48f', k: '#2a2a2a', b: '#6b4226', m: '#4a2a18', R: '#c0282d', K: '#25171a', J: '#3b5f9a', j: '#2f4d80', T: '#5a3a20' },
    head: ['NNNNNNNN', 'nNnNnNnN', 'hssssssh', 'ssksskss', 'ssssssss', 'bbbbbbbb', 'bbbmmbbb', 'bbbbbbbb'],
    headBack: 'Nnhhhhhh',
    plaid: { a: 'R', b: 'K' },
    body: ['??bbbb??', '???bb???', ...Array(10).fill('????????')],
    bodyBack: R12('????????'),
    arm: [...Array(11).fill('????'), 'ssss'],
    leg: [...Array(9).fill('JJJJ').map((r, i) => (i % 3 === 1 ? 'JjJJ' : r)), 'TTTT', 'TTTT', 'TTTT'],
  },
  {
    id: 'medic', name: 'Medic', rarity: 'uncommon', set: 'survivor',
    pal: { T: '#2bb3a3', W: '#f7f9fa', g: '#cfd6db', p: '#dfe5e9', R: '#e03a3a', M: '#a8d8f0', s: '#e5b391', h: '#3a2a1e', k: '#2a2a2a', B: '#4a8fe0' },
    head: ['TTTTTTTT', 'TTTTTTTT', 'hssssssh', 'ssksskss', 'ssssssss', 'MMMMMMMM', 'MMMMMMMM', 'sMMMMMMs'],
    headBack: 'TThhhMhh',
    body: ['WWWTTWWW', 'WWWTTWWW', 'WWWWWRWW', 'WWWWRRRW', 'WWWWWRWW', 'WWWgWWWW', 'WWWgWWWW', 'WWWgWWWW', 'WpWgWWpW', 'WWWgWWWW', 'WWWgWWWW', 'WWWgWWWW'],
    bodyBack: R12('WWWWWWWW'),
    arm: [...Array(10).fill('WWWW'), 'BBBB', 'BBBB'],
    leg: [...Array(10).fill('TTTT'), 'WWWW', 'WWWW'],
  },
  {
    id: 'firefighter', name: 'Firefighter', rarity: 'rare', set: 'survivor',
    pal: { R: '#d1262b', r: '#9e1a1f', Y: '#d9f23a', V: '#d8dde2', C: '#c9a65a', K: '#1f1f22', s: '#e2ad88', S: '#7a7a7a', m: '#9a4a4a', k: '#2a2a2a', G: '#f2c94c' },
    head: ['RRRRRRRR', 'RRRGGRRR', 'rrrrrrrr', 'ssksskss', 'ssssssss', 'sssssSss', 'sssmmsss', 'ssssssss'],
    headBack: 'RRrrrrrr',
    body: ['CCCCCCCC', 'CCCKCCCC', 'CCCKCCCC', 'YYYYYYYY', 'VVVVVVVV', 'YYYYYYYY', 'CCCKCCCC', 'CCCKCCCC', 'YYYYYYYY', 'VVVVVVVV', 'YYYYYYYY', 'CCCKCCCC'],
    bodyBack: ['CCCCCCCC', 'CCCCCCCC', 'CCCCCCCC', 'YYYYYYYY', 'VVVVVVVV', 'YYYYYYYY', 'CCCCCCCC', 'CCCCCCCC', 'YYYYYYYY', 'VVVVVVVV', 'YYYYYYYY', 'CCCCCCCC'],
    arm: ['CCCC', 'CCCC', 'CCCC', 'CCCC', 'CCCC', 'CCCC', 'YYYY', 'VVVV', 'YYYY', 'CCCC', 'KKKK', 'KKKK'],
    leg: ['CCCC', 'CCCC', 'CCCC', 'CCCC', 'CCCC', 'YYYY', 'VVVV', 'YYYY', 'CCCC', 'KKKK', 'KKKK', 'KKKK'],
  },
  {
    id: 'hazmat', name: 'Hazmat Suit', rarity: 'rare', set: 'survivor',
    pal: { Y: '#f2d024', y: '#c9a812', G: '#24352a', g: '#4f7a5a', K: '#1e1e1e', k: '#5a5a5a' },
    head: ['YYYYYYYY', 'YYYYYYYY', 'YGGGGGGY', 'YGgGGGGY', 'YGGGGGGY', 'YYYKKYYY', 'YYKkkKYY', 'YYYKKYYY'],
    headBack: 'YYYYYYYY',
    body: ['YYYYYYYY', 'YYYyYYYY', 'YYyKKyYY', 'YyKYYKyY', 'YKYKKYKY', 'YyKYYKyY', 'YYyKKyYY', 'YYYyYYYY', 'KKKKKKKK', 'YYYyYYYY', 'YYYyYYYY', 'YYYyYYYY'],
    bodyBack: [...Array(8).fill('YYYYYYYY'), 'KKKKKKKK', 'YYYYYYYY', 'YYYYYYYY', 'YYYYYYYY'],
    arm: [...Array(8).fill('YYYY'), 'KKKK', 'YYYY', 'KKKK', 'KKKK'],
    leg: [...Array(7).fill('YYYY'), 'KKKK', 'YYYY', 'YYYY', 'KKKK', 'KKKK'],
  },
  // ===== Creatures =====
  {
    id: 'frog', name: 'Frog', rarity: 'common', set: 'creatures',
    pal: { G: '#4caf50', g: '#2e7d32', L: '#c5e1a5', W: '#ffffff', k: '#1a1a1a', m: '#7a2a2a', p: '#f48fb1' },
    head: ['GGGGGGGG', 'WWGGGGWW', 'WkGGGGkW', 'GGGGGGGG', 'GpGGGGpG', 'gGGGGGGg', 'gmmmmmmg', 'GGLLLLGG'],
    headBack: 'GGGgGGGG',
    body: ['GGGGGGGG', 'GLLLLLLG', 'GLLLLLLG', 'GLLLLLLG', 'GLLLLLLG', 'GLLLLLLG', 'GLLLLLLG', 'GLLLLLLG', 'GLLLLLLG', 'GLLLLLLG', 'GGLLLLGG', 'GGGGGGGG'],
    bodyBack: ['GGGGGGGG', 'GgGGGGGG', 'GGGGGgGG', 'GGGGGGGG', 'GGgGGGGG', 'GGGGGGgG', 'GGGGGGGG', 'GgGGgGGG', 'GGGGGGGG', 'GGGGGGgG', 'GGgGGGGG', 'GGGGGGGG'],
    arm: [...Array(11).fill('GGGG').map((r, i) => (i === 4 ? 'GgGG' : r)), 'LLLL'],
    leg: [...Array(10).fill('GGGG').map((r, i) => (i === 3 ? 'GGgG' : r)), 'gggg', 'gggg'],
  },
  {
    id: 'bee', name: 'Bee', rarity: 'uncommon', set: 'creatures',
    pal: { Y: '#f6c90e', K: '#232323', W: '#cfeaff', w: '#ffffff', p: '#f6a04d' },
    head: ['YYYYYYYY', 'YYYYYYYY', 'YwKYYwKY', 'YKKYYKKY', 'YYYYYYYY', 'YpYYYYpY', 'YYKYYKYY', 'YYYKKYYY'],
    headTop: ['YYYYYYYY', 'YYYYYYYY', 'YYYYYYYY', 'YYYYYYYY', 'YYYYYYYY', 'YYKYYKYY', 'YYKYYKYY', 'YYYYYYYY'],
    headBack: 'YYYYYYYY',
    body: ['YYYYYYYY', 'YYYYYYYY', 'KKKKKKKK', 'KKKKKKKK', 'YYYYYYYY', 'YYYYYYYY', 'KKKKKKKK', 'KKKKKKKK', 'YYYYYYYY', 'YYYYYYYY', 'KKKKKKKK', 'KKKKKKKK'],
    bodyBack: ['YYYYYYYY', 'WWYYYYWW', 'WWWKKWWW', 'WWWKKWWW', 'YWWYYWWY', 'YYWYYWYY', 'KKKKKKKK', 'KKKKKKKK', 'YYYYYYYY', 'YYYYYYYY', 'KKKKKKKK', 'KKKKKKKK'],
    arm: R12('KKKK'),
    leg: R12('KKKK'),
  },
  {
    id: 'lavagolem', name: 'Lava Golem', rarity: 'epic', set: 'creatures', noise: 0.1,
    pal: { B: '#2b2523', b: '#3a322e', L: '#ff6a00', l: '#ffb300', Y: '#fff07a' },
    head: ['BbBBbBBB', 'BBLBBBbB', 'BBBLBBBB', 'BlYBBYlB', 'BBBBLBBB', 'bBBBBLBB', 'BLlLlLlB', 'BBBBBbBB'],
    headBack: 'BbBBBbBB',
    body: ['BBBBBBBB', 'BbBLBBBB', 'BBBBLBbB', 'BBLlLBBB', 'BLlYlLBB', 'BBLlLBBB', 'BBBLBBbB', 'BbBBLBBB', 'BBBBBLBB', 'BBLBBBLB', 'BLBBbBBL', 'BBBBBBBB'],
    bodyBack: ['BBBBBBBB', 'BbBBBLBB', 'BBLBBBbB', 'BBBLBBBB', 'BbBBLBBB', 'BBBBBLBB', 'BBLBBBbB', 'BbBLBBBB', 'BBBBLBBB', 'BLBBBBLB', 'BBLBbBBB', 'BBBBBBBB'],
    arm: ['BBLB', 'BBBL', 'BbBB', 'LBBB', 'BLBB', 'BBBB', 'BBLB', 'BLBB', 'BBBB', 'bBLB', 'LLlL', 'lYlL'],
    leg: ['BBBB', 'BLBB', 'BBLB', 'BBBB', 'bBBL', 'BBBB', 'BLBB', 'BBLB', 'BBBB', 'BBBb', 'BBBB', 'bBBb'],
  },
  {
    id: 'dragon', name: 'Dragon', rarity: 'legendary', set: 'creatures', noise: 0.08,
    pal: { R: '#b3202a', r: '#821620', D: '#5e0f16', G: '#f2b632', g: '#c98d1e', Y: '#ffe14d', k: '#1a0a0a', W: '#f4f0e6', H: '#e8dcc0' },
    head: ['HRRRRRRH', 'RRrRRrRR', 'rRRRRRRr', 'RYkRRkYR', 'RRRRRRRR', 'RRDRRDRR', 'RWDDDDWR', 'rRRRRRRr'],
    headTop: ['HHRRRRHH', 'HRRRRRRH', 'RRrRRrRR', 'RRRHHRRR', 'RRRHHRRR', 'RRrRRrRR', 'RRRRRRRR', 'RRRHHRRR'],
    headBack: 'RRrRRrRr',
    body: ['RRRRRRRR', 'RRGGGGRR', 'RRggggRR', 'RRGGGGRR', 'RRggggRR', 'RRGGGGRR', 'RRggggRR', 'RRGGGGRR', 'RRggggRR', 'RRGGGGRR', 'RRggggRR', 'RRRRRRRR'],
    bodyBack: ['RRRHHRRR', 'DDrRRrDD', 'DDDRRDDD', 'DDrHHrDD', 'DDDRRDDD', 'rDDRRDDr', 'DDDHHDDD', 'RDDRRDDR', 'RRDRRDRR', 'RRRHHRRR', 'RRRRRRRR', 'RRRRRRRR'],
    arm: ['RRRR', 'rRRr', 'RRRR', 'RrRR', 'RRRR', 'rRRr', 'RRRR', 'RRrR', 'RRRR', 'rRRr', 'RRRR', 'HRHR'],
    leg: ['RRRR', 'RrRR', 'RRRR', 'rRRr', 'RRRR', 'RRrR', 'RRRR', 'rRRr', 'RRRR', 'RRRR', 'rRRr', 'HRRH'],
  },
]

SKINS.push(...SKINS_2.map((s) => ({ ...s, steps: 3 })))

// Every grid must be the right size (a short row would draw see-through holes).
for (const s of SKINS) {
  const want = { head: [8, 8], headTop: [8, 8], body: [12, 8], bodyBack: [12, 8], arm: [12, 4], leg: [12, 4] }
  for (const [k, [h, w]] of Object.entries(want)) {
    if (!s[k]) continue
    if (s[k].length !== h || s[k].some((r) => r.length !== w)) throw new Error(`${s.id}.${k}: needs ${h} rows of ${w}`)
  }
  if (s.headBack && s.headBack.length !== 8) throw new Error(`${s.id}.headBack: needs 8 letters`)
}

// ---------- drawing ----------
const W = 64
const H = 64
function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) }
function seedRand(str) {
  let s = 2166136261
  for (const ch of str) s = Math.imul(s ^ ch.charCodeAt(0), 16777619)
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296
}

function makeSkin(skin) {
  const px = new Uint8Array(W * H * 4) // all see-through to start (the outer layers stay empty)
  const rand = seedRand(skin.id)
  const amp = skin.noise ?? 0.05
  const colorAt = (ch, x, y) => {
    if (ch === '?') ch = ((Math.floor(x / 2) + Math.floor(y / 2)) % 2) ? skin.plaid.b : skin.plaid.a
    const c = skin.pal[ch]
    if (!c) throw new Error(`${skin.id}: no colour for "${ch}"`)
    return hex(c)
  }
  // Draws a w x h face at (ox, oy); `at(x, y)` gives the letter.
  const face = (ox, oy, w, h, at) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = at(x, y)
      const [r, g, b] = colorAt(ch, ox + x, oy + y)
      // `steps` (second-wave skins): only a few shade levels instead of any
      // shade - looks the same, but the picture packs ~3x smaller.
      const n = rand() * 2 - 1
      const f = 1 + (skin.steps ? Math.round(n * (skin.steps - 1) / 2) / ((skin.steps - 1) / 2) : n) * amp
      const i = ((oy + y) * W + ox + x) * 4
      px[i] = Math.min(255, Math.round(r * f))
      px[i + 1] = Math.min(255, Math.round(g * f))
      px[i + 2] = Math.min(255, Math.round(b * f))
      px[i + 3] = 255
    }
  }
  // A Minecraft box: top, bottom, right, front, left, back around (ox, oy).
  const box = (ox, oy, w, h, d, f) => {
    face(ox + d, oy, w, d, f.top)
    face(ox + d + w, oy, w, d, f.bottom)
    face(ox, oy + d, d, h, f.right)
    face(ox + d, oy + d, w, h, f.front)
    face(ox + d + w, oy + d, d, h, f.left)
    face(ox + 2 * d + w, oy + d, w, h, f.back)
  }
  const rows = (r) => (x, y) => r[y][x]
  const col0 = (r) => (x, y) => r[y][0]
  // Head 8x8x8 at (0,0)
  const hb = skin.headBack || skin.head.map((r) => r[0]).join('')
  box(0, 0, 8, 8, 8, {
    top: skin.headTop ? rows(skin.headTop) : () => skin.head[0][0],
    bottom: () => skin.head[7][1],
    right: col0(skin.head),
    left: (x, y) => skin.head[y][7],
    front: rows(skin.head),
    back: (x, y) => hb[y],
  })
  // Body 8x12x4 at (16,16)
  const back = skin.bodyBack || skin.body.map((r) => r[0].repeat(8))
  box(16, 16, 8, 12, 4, {
    top: (x) => skin.body[0][x],
    bottom: (x) => skin.body[11][x],
    right: (x, y) => skin.body[y][0],
    left: (x, y) => skin.body[y][7],
    front: rows(skin.body),
    back: rows(back),
  })
  // Arms and legs: 4x12x4, same picture on every side.
  const limb = (r) => ({ top: (x) => r[0][x], bottom: (x) => r[11][x], right: rows(r), front: rows(r), left: rows(r), back: rows(r) })
  box(40, 16, 4, 12, 4, limb(skin.arm)) // right arm
  box(32, 48, 4, 12, 4, limb(skin.arm)) // left arm
  box(0, 16, 4, 12, 4, limb(skin.leg)) // right leg
  box(16, 48, 4, 12, 4, limb(skin.leg)) // left leg
  return px
}

// ---------- PNG ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
function png(px, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ---------- output ----------
const made = SKINS.map((s) => ({ s, px: makeSkin(s) }))
const lines = made.map(({ s, px }) =>
  `  { id: '${s.id}', name: '${s.name}', rarity: '${s.rarity}', set: '${s.set}', dataUrl: 'data:image/png;base64,${png(px, W, H).toString('base64')}' },`)
writeFileSync(new URL('../src/game/ShopSkins.js', import.meta.url), `// Shop > More Skins (2026-11-25): 11 sets of 4 (Winter, Survivor, Creatures,
// Pirates, Space, Food, Sports, Royalty, Ninja, Robots, Spooky).
// MADE BY scripts/make-shop-skins.mjs - change the drawings there and run
// it again; don't edit the data URLs by hand. They join MARKET_SKINS
// (MarketSkins.js), so Inventory, trades and gifts know them too.
// Price: Common to Rare in coins (MARKET_PRICES), Epic and up in gems
// (SHOP_SKIN_GEM_PRICES) - see shopSkinPrice().
export const SHOP_SKINS = [
${lines.join('\n')}
]
`)
console.log(`wrote ${made.length} skins`)

// Optional preview sheet: flat front (left) and back (right) of each, 8x.
const out = process.argv[2]
if (out) {
  const S = 8
  const cellW = 34
  const cellH = 34
  const cols = 4
  const sheetW = cols * cellW * S
  const sheetH = Math.ceil(made.length / cols) * cellH * S
  const sheet = new Uint8Array(sheetW * sheetH * 4).fill(235)
  const put = (px, sx, sy, w, h, dx, dy) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((sy + y) * W + sx + x) * 4
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
        const j = (((dy + y) * S + a) * sheetW + (dx + x) * S + b) * 4
        sheet[j] = px[i]; sheet[j + 1] = px[i + 1]; sheet[j + 2] = px[i + 2]; sheet[j + 3] = 255
      }
    }
  }
  made.forEach(({ px }, n) => {
    const ox = (n % cols) * cellW + 1
    const oy = Math.floor(n / cols) * cellH + 1
    // front
    put(px, 8, 8, 8, 8, ox + 4, oy); put(px, 20, 20, 8, 12, ox + 4, oy + 8)
    put(px, 44, 20, 4, 12, ox, oy + 8); put(px, 36, 52, 4, 12, ox + 12, oy + 8)
    put(px, 4, 20, 4, 12, ox + 4, oy + 20); put(px, 20, 52, 4, 12, ox + 8, oy + 20)
    // back
    const bx = ox + 17
    put(px, 24, 8, 8, 8, bx + 4, oy); put(px, 32, 20, 8, 12, bx + 4, oy + 8)
    put(px, 52, 20, 4, 12, bx, oy + 8); put(px, 44, 52, 4, 12, bx + 12, oy + 8)
    put(px, 12, 20, 4, 12, bx + 4, oy + 20); put(px, 28, 52, 4, 12, bx + 8, oy + 20)
  })
  writeFileSync(out, png(sheet, sheetW, sheetH))
  console.log('preview', out)
}
