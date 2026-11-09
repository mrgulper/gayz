// Real-life ground (2026-11-08, Gaymi: "make every block like grass or
// leaves real everything as of in real life not just big blocky blocks").
// On the Realistic, Ultra and In Real Life graphics levels (GraphicsLevels
// `realShape`, 0..1 = how strong) grass and dirt stop being cubes and are
// drawn as one soft, lumpy piece of land: outside edges and corners round
// off, inside corners fill in, and the whole surface rolls in gentle bumps
// that run across blocks instead of stopping at each one. Only the drawing
// changes - every block is still a full cube to walk on, dig and build
// with ("looks real, steps underneath"), and the map editor still works
// with plain blocks on lower levels.
//
// How it stays one piece with no cracks: every corner point where blocks
// meet (a "lattice point") gets one move, worked out only from the 8
// blocks around it, and the bumps come from a smooth noise of the world
// position - so two faces that share a corner or an edge always move it
// the same way. A corner touching anything that isn't grass, dirt, air or
// a plant (a plank, a torch, water, a log...) doesn't move, so real
// ground always meets other blocks exactly.

// Blocks drawn as real ground. First batch: grass + dirt (Gaymi's pick).
// Fifth batch (2026-11-08): the rest of the soft ground joins the same
// land - sand, gravel, mud, clay, moss, podzol, nylium... - each with its
// own look (LOOK_OF below), melting into the grass, dirt and rock round it.
// Sixth batch (2026-11-08): snow (soft rounded drifts) and ice (smooth,
// glassy rounded slabs - plain ice stays see-through) join it too.
export const REAL_GROUND = /^(grass|dirt|sand|redsand|soulsand|gravel|mud|clay|packedmud|moss|mycelium|podzol|coarsedirt|rooteddirt|dirtpath|soulsoil|crimsonnylium|warpednylium|terracotta|snow|ice|packedice|blueice)$/
// Second batch (2026-11-08): leaves join into one bushy treetop (same
// corner-point idea as the ground, with bigger bumps and leaf clumps
// poking out - BlockChunks._realLeafCell), and logs are drawn as round,
// bark-bumpy trunks (BlockChunks._realLog). Every leaf and log kind.
export const REAL_LEAVES = /leaves$/
// Seventh batch (2026-11-08): crimson and warped stems are trunks too.
export const REAL_LOG = /(log|stem)$/
// Seventh batch: round things inside a whole block, drawn like logs
// (corners look empty, you still bump the full cube). Cactus and hay
// bales stack into one column like trunks; pumpkins and melons are each
// their own round fruit.
const ROUND_OF = { cactus: 'cactus', haybale: 'hay', pumpkin: 'pumpkin', melon: 'melon' }
// Which round shape a block is drawn as ('log', 'cactus', 'hay',
// 'pumpkin', 'melon'), or null for none.
export function roundOf(id) {
  if (ROUND_OF[id]) return ROUND_OF[id]
  return REAL_LOG.test(id) ? 'log' : null
}
// Seventh batch: soft bumpy blobs that join each other like a treetop
// (mushroom caps, nether/warped wart, coral blocks, sculk) - the treetop
// shape without the leaf clumps.
export const REAL_BLOB = /^(redmushroomblock|brownmushroomblock|netherwartblock|warpedwartblock|tubecoralblock|braincoralblock|bubblecoralblock|firecoralblock|horncoralblock|sculk)$/
// Seventh batch: rocky blocks whose names don't say so get the rock look
// too - glowing ones (magma, glowstone) keep their glow.
export const REAL_EXTRA_ROCK = /^(amethystblock|magmablock|glowstone|ancientdebris|rawironblock|rawgoldblock|rawcopperblock)$/
// Third batch (2026-11-08, Gaymi picked "every stone-ish block"): rock,
// cobble, ores, bricks, polished and smooth stone, sandstone... all join
// the real ground (they melt into grass and dirt where they touch) but
// get their own look - a mix of craggy ledges and smooth boulders that
// drifts across the land (rockAt). Shaped pieces (slabs, stairs, walls,
// fences...) and glowing blocks stay as they are.
export const REAL_ROCK = /(stone|cobble|granite|andesite|diorite|deepslate|tuff|calcite|basalt|bedrock|netherrack|marble|obsidian)|ore$/
// Gadget stones keep their cube so they're easy to spot.
export const NOT_ROCK = /(slab|stairs|fence|wall|button|plate|lamp|door|block)$|^(echostone|weatherstone|saunastone)$/
// The real ground's looks besides plain earth (grass, dirt, moss...).
// Each has a kind code (4 + its place here) and a record slot (8 + its
// place) holding how much of the ground round a corner has that look.
//  rock: craggy ledges and smooth boulders (third batch).
//  sand: gentle wind ripples on a smooth swell (Gaymi: "gentle rippled
//    dunes, smoother than dirt").
//  gravel: lumpy, small stones poking out.
//  mud: flat, soft and a bit shiny wet.
//  snow: soft rounded drifts, smoother than dirt, slightly sparkly
//    (sixth batch).
//  ice: smooth, glassy rounded slabs with hardly any bumps (sixth batch).
export const LOOKS = ['rock', 'sand', 'gravel', 'mud', 'snow', 'ice']
const LOOK_OF = { sand: 'sand', redsand: 'sand', soulsand: 'sand', gravel: 'gravel', mud: 'mud', clay: 'mud', terracotta: 'rock', snow: 'snow', ice: 'ice', packedice: 'ice', blueice: 'ice' }
// Which look a real-ground block has ('dirt' = plain earth).
export function lookOf(id) {
  if (LOOK_OF[id]) return LOOK_OF[id]
  if (REAL_EXTRA_ROCK.test(id)) return 'rock'
  if (REAL_ROCK.test(id) && !NOT_ROCK.test(id) && !REAL_GROUND.test(id)) return 'rock'
  return 'dirt'
}
// Floats per lattice point record (see latticeAt).
export const REC = 8 + LOOKS.length

// How far corners round off (blocks, at full strength).
const K_ROUND = 0.85
// Bumps along the surface's facing direction, and the sideways wobble
// that keeps outlines from being straight lines (blocks).
const A_BUMP = 0.13
const A_JIT = 0.12
// The wobble moves points up and down less than sideways, so flat ground
// stays close to where you stand.
const JIT_Y = 0.4
// The ground's look, and the treetops': rounder corners, bigger lumps
// and more wobble (leaves are fluffy, not packed earth).
export const GROUND_LOOK = { bump: A_BUMP, jit: A_JIT, jitY: JIT_Y }
export const LEAF_LOOK = { bump: 0.2, jit: 0.15, jitY: 0.8 }
export const K_LEAF = 1

function hash3(x, y, z, s) {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (s * 2654435761)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Smooth value noise, 0..1, the same everywhere for the same point.
function vnoise(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  let fx = x - ix, fy = y - iy, fz = z - iz
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  fz = fz * fz * (3 - 2 * fz)
  const a = hash3(ix, iy, iz, s), b = hash3(ix + 1, iy, iz, s)
  const c = hash3(ix, iy + 1, iz, s), d = hash3(ix + 1, iy + 1, iz, s)
  const e = hash3(ix, iy, iz + 1, s), f = hash3(ix + 1, iy, iz + 1, s)
  const g = hash3(ix, iy + 1, iz + 1, s), h = hash3(ix + 1, iy + 1, iz + 1, s)
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx
  const ef = e + (f - e) * fx, gh = g + (h - g) * fx
  const lo = ab + (cd - ab) * fy, hi = ef + (gh - ef) * fy
  return lo + (hi - lo) * fz
}

// vnoise plus its slope (how fast it changes along x, y, z), worked out
// from the same 8 corner values - one call instead of 4 for lighting.
// Returns the value; the slope lands in D[0..2].
const D = [0, 0, 0]
function vnoiseD(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const tx = x - ix, ty = y - iy, tz = z - iz
  const fx = tx * tx * (3 - 2 * tx), fy = ty * ty * (3 - 2 * ty), fz = tz * tz * (3 - 2 * tz)
  const dx = 6 * tx * (1 - tx), dy = 6 * ty * (1 - ty), dz = 6 * tz * (1 - tz)
  const a = hash3(ix, iy, iz, s), b = hash3(ix + 1, iy, iz, s)
  const c = hash3(ix, iy + 1, iz, s), d = hash3(ix + 1, iy + 1, iz, s)
  const e = hash3(ix, iy, iz + 1, s), f = hash3(ix + 1, iy, iz + 1, s)
  const g = hash3(ix, iy + 1, iz + 1, s), h = hash3(ix + 1, iy + 1, iz + 1, s)
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx
  const ef = e + (f - e) * fx, gh = g + (h - g) * fx
  const lo = ab + (cd - ab) * fy, hi = ef + (gh - ef) * fy
  // Slopes of each blend, then carried up the same way.
  const dab = (b - a) * dx, dcd = (d - c) * dx, def = (f - e) * dx, dgh = (h - g) * dx
  const dlo = dab + (dcd - dab) * fy, dhi = def + (dgh - def) * fy
  D[0] = dlo + (dhi - dlo) * fz
  D[1] = ((cd - ab) + ((gh - ef) - (cd - ab)) * fz) * dy
  D[2] = (hi - lo) * dz
  return lo + (hi - lo) * fz
}


// Brightness drifting in soft patches (instead of each block its own
// shade, which would show the block grid).
export function realTint(x, y, z) {
  return 0.9 + vnoise(x * 0.18, y * 0.18, z * 0.18, 47) * 0.16
}

// What a cell is to the ground around it: 0 air (or a plant), 1 real
// ground, 2 any other solid block, 3 any other non-solid thing (glass,
// water, a torch...). 2 and 3 pin the corners round them in place.
export const AIR = 0, REAL = 1, PIN_SOLID = 2, PIN_OTHER = 3
// Rock: real ground with the rock look (counts as REAL for the shape).
// The other looks follow on (SAND = 5...): kindOfLook().
export const ROCK = 4
export function kindOfLook(look) {
  const i = LOOKS.indexOf(look)
  return i < 0 ? REAL : 4 + i
}
// How much less each look's corners round off than dirt (rock keeps an
// edge; snow rounds a little more; ice keeps a slab's softened edge).
const LOOK_ROUND = [0.3, 0, 0.05, 0, -0.12, 0.2]

// One lattice point (X, Y, Z: a corner where up to 8 cells meet) into
// out[o..o+8]: the rounding move (x, y, z), the ground's facing direction
// there (x, y, z), w (1 = free to move, 0 = pinned), corner shade and how
// much of the ground round it is rock (0..1).
// kind(x, y, z) -> AIR / REAL / ROCK / PIN_SOLID / PIN_OTHER.
export function latticeAt(kind, X, Y, Z, amt, out, o = 0, kRound = K_ROUND) {
  let n = 0, solid = 0, pinned = false
  for (let i = 8; i < REC; i++) out[o + i] = 0
  let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0
  for (let dy = -1; dy <= 0; dy++) {
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const k = kind(X + dx, Y + dy, Z + dz)
        const cx = dx + 0.5, cy = dy + 0.5, cz = dz + 0.5
        if (k === REAL || k >= ROCK) {
          n++
          if (k >= ROCK) out[o + 4 + k]++
          sx += cx; sy += cy; sz += cz
        } else {
          if (k !== AIR) pinned = true
          ax += cx; ay += cy; az += cz
        }
        if (k === REAL || k >= ROCK || k === PIN_SOLID) solid++
      }
    }
  }
  // Corner shade: the more solid round it, the more tucked in (dark).
  out[o + 7] = solid <= 4 ? 1 : solid === 5 ? 0.84 : solid === 6 ? 0.68 : 0.55
  let round = 1
  for (let i = 0; i < LOOKS.length; i++) {
    const f = n ? out[o + 8 + i] / n : 0
    out[o + 8 + i] = f
    round -= LOOK_ROUND[i] * f
  }
  if (pinned || n === 0 || n === 8) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = out[o + 4] = out[o + 5] = out[o + 6] = 0
    return out
  }
  sx /= n; sy /= n; sz /= n
  const na = 8 - n
  ax /= na; ay /= na; az /= na
  // Toward the ground's middle on an outside corner (rounds it off),
  // toward the air on an inside one (fills it in), nothing on flat ground.
  const k = kRound * amt * round
  out[o] = (sx + ax) * k
  out[o + 1] = (sy + ay) * k
  out[o + 2] = (sz + az) * k
  let nx = ax - sx, ny = ay - sy, nz = az - sz
  const l = Math.hypot(nx, ny, nz)
  if (l < 1e-6) { nx = 0; ny = 1; nz = 0 } else { nx /= l; ny /= l; nz /= l }
  out[o + 3] = nx
  out[o + 4] = ny
  out[o + 5] = nz
  out[o + 6] = 1
  return out
}

// How light a face looks by which way it faces (the cube faces' own
// shades: top 1, sides 0.86 / 0.93, bottom 0.7), blended for slopes.
function shadeOf(nx, ny, nz) {
  const ax = Math.abs(nx), az = Math.abs(nz), ay = Math.abs(ny)
  const s = ax + ay + az || 1
  return (ax * 0.86 + az * 0.93 + ay * (ny > 0 ? 1 : 0.7)) / s
}

// One point on a real-ground face. P: the face's 4 corners (world
// blocks, [x, y, z] each) in the order (s, t) = (0,0), (1,0), (1,1),
// (0,1); L: their lattice records (Float32Arrays from latticeAt); fn: the
// cube face's own direction. Fills out: x, y, z, nx, ny, nz, ao, shade.
export function realPoint(P, L, s, t, fn, amt, out, look = GROUND_LOOK) {
  const { bump: aBump, jit: aJit, jitY } = look
  const W0 = (1 - s) * (1 - t), W1 = s * (1 - t), W2 = s * t, W3 = (1 - s) * t
  let px = 0, py = 0, pz = 0, mx = 0, my = 0, mz = 0, nx = 0, ny = 0, nz = 0, w = 0, ao = 0, rf = 0
  let sand = 0, grav = 0, mud = 0, snow = 0, ice = 0
  for (let k = 0; k < 4; k++) {
    const Wk = k === 0 ? W0 : k === 1 ? W1 : k === 2 ? W2 : W3
    const p = P[k], l = L[k]
    px += Wk * p[0]; py += Wk * p[1]; pz += Wk * p[2]
    mx += Wk * l[0]; my += Wk * l[1]; mz += Wk * l[2]
    const lw = l[6]
    nx += Wk * (lw * l[3] + (1 - lw) * fn[0])
    ny += Wk * (lw * l[4] + (1 - lw) * fn[1])
    nz += Wk * (lw * l[5] + (1 - lw) * fn[2])
    w += Wk * lw
    ao += Wk * l[7]
    if (l.length > 8) {
      rf += Wk * l[8]
      sand += Wk * l[9]
      grav += Wk * l[10]
      mud += Wk * l[11]
      snow += Wk * l[12]
      ice += Wk * l[13]
    }
  }
  const soft = sand + grav + mud + snow + ice
  let nl = Math.hypot(nx, ny, nz)
  if (nl < 1e-6) { nx = fn[0]; ny = fn[1]; nz = fn[2] } else { nx /= nl; ny /= nl; nz /= nl }
  const k = w * amt
  let x = px + mx, y = py + my, z = pz + mz
  if (k > 0) {
    let amp, b, gx, gy, gz
    if (soft < 0.001) {
      amp = aBump * (1 + ROCK_BUMP * rf)
      b = rf > 0.001 ? mixedD(px, py, pz, rf) : bumpD(px, py, pz)
      gx = G[0]; gy = G[1]; gz = G[2]
    } else {
      // Soft ground (fifth batch): each look's own bumps, already at its
      // own size, mixed by how much of it is round this point.
      amp = aBump
      b = 0; gx = 0; gy = 0; gz = 0
      const dirt = 1 - rf - soft
      if (dirt > 0.001) {
        const v = bumpD(px, py, pz)
        b += dirt * v; gx += dirt * G[0]; gy += dirt * G[1]; gz += dirt * G[2]
      }
      if (rf > 0.001) {
        const v = rockD(px, py, pz), m = rf * (1 + ROCK_BUMP)
        b += m * v; gx += m * G[0]; gy += m * G[1]; gz += m * G[2]
      }
      if (sand > 0.001) {
        const v = sandD(px, py, pz, ny), m = sand * SAND_BUMP
        b += m * v; gx += m * G[0]; gy += m * G[1]; gz += m * G[2]
      }
      if (grav > 0.001) {
        const v = gravelD(px, py, pz), m = grav * GRAVEL_BUMP
        b += m * v; gx += m * G[0]; gy += m * G[1]; gz += m * G[2]
      }
      if (mud + snow + ice > 0.001) {
        // Mud, snow and ice share one broad, slow swell (snow's is the
        // biggest - drifts; ice hardly rises at all - glassy slabs).
        const v = vnoiseD(px * 0.32, py * 0.32, pz * 0.32, 63) * 2 - 1
        const m = mud * MUD_BUMP + snow * SNOW_BUMP + ice * ICE_BUMP
        b += m * v; gx += m * D[0] * 0.64; gy += m * D[1] * 0.64; gz += m * D[2] * 0.64
      }
    }
    // Smooth looks wobble less sideways too.
    const jit = 1 - 0.4 * (sand + snow) - 0.5 * mud - 0.85 * ice
    let jx, jy, jz
    if (rf > 0.001) {
      // Rock (lots of it underground): one noise's slope makes all three
      // wobbles, a third of the work.
      vnoiseD(px * 0.5, py * 0.5, pz * 0.5, 46)
      jx = Math.max(-1, Math.min(1, D[0] * 0.6))
      jy = Math.max(-1, Math.min(1, D[1] * 0.6)) * jitY
      jz = Math.max(-1, Math.min(1, D[2] * 0.6))
    } else {
      jx = vnoise(px * 0.5, py * 0.5, pz * 0.5, 43) * 2 - 1
      jy = (vnoise(px * 0.5, py * 0.5, pz * 0.5, 44) * 2 - 1) * jitY
      jz = vnoise(px * 0.5, py * 0.5, pz * 0.5, 45) * 2 - 1
    }
    x += k * (amp * b * nx + aJit * jit * jx)
    y += k * (amp * b * ny + aJit * jit * jy)
    z += k * (amp * b * nz + aJit * jit * jz)
    // The bumps tip the surface: lean the facing direction away from
    // where they rise (only the part along the surface).
    const gd = gx * nx + gy * ny + gz * nz
    const f = k * amp
    nx -= f * (gx - gd * nx)
    ny -= f * (gy - gd * ny)
    nz -= f * (gz - gd * nz)
    nl = Math.hypot(nx, ny, nz)
    nx /= nl; ny /= nl; nz /= nl
  }
  out.x = x; out.y = y; out.z = z
  out.nx = nx; out.ny = ny; out.nz = nz
  out.ao = ao
  out.shade = shadeOf(nx, ny, nz)
  out.rock = rf
  out.grain = rf > 0.001 && k > 0 ? GRAIN : 0.5
  // How glossy (0..1): wet mud shines, snow glints a little (and
  // sparkles - the solid shader's glitter keys on a light picture with
  // this little gloss), ice shines like glass.
  out.gloss = mud * 0.55 + snow * 0.15 + ice * 0.9
  out.gravel = grav
  return out
}

// Rock's surface, -1..1 (Gaymi: "a bit of both craggy and smooth
// boulders"): a slow drift (seed 50) decides where the rock is craggy -
// stepped ledges plus sharp ridges, like a broken cliff - and where it's
// a smooth, rounder boulder. Both only depend on the world position.
const ROCK_BUMP = 0.6
// Each of these returns the height and leaves its slope in G.
const G = [0, 0, 0]
// The rock's grain at the last point (0..1), reused for its shading.
let GRAIN = 0.5
// The ground's rolling bumps, -1..1: a broad swell plus finer lumps.
function bumpD(x, y, z) {
  const a = vnoiseD(x * 0.7, y * 0.7, z * 0.7, 41)
  const a0 = D[0] * 0.7 * 0.65, a1 = D[1] * 0.7 * 0.65, a2 = D[2] * 0.7 * 0.65
  const b = vnoiseD(x * 1.9, y * 1.9, z * 1.9, 42)
  G[0] = 2 * (a0 + D[0] * 1.9 * 0.35)
  G[1] = 2 * (a1 + D[1] * 1.9 * 0.35)
  G[2] = 2 * (a2 + D[2] * 1.9 * 0.35)
  return (a * 0.65 + b * 0.35) * 2 - 1
}
function rockD(x, y, z) {
  const bo = vnoiseD(x * 0.55, y * 0.55, z * 0.55, 53)
  const bx = D[0] * 0.55, by = D[1] * 0.55, bz = D[2] * 0.55
  const c = vnoiseD(x * 0.23 + 7, y * 0.23, z * 0.23, 50)
  if (c <= 0.38) {
    GRAIN = bo
    G[0] = 2 * bx; G[1] = 2 * by; G[2] = 2 * bz
    return bo * 2 - 1
  }
  const steep = c < 0.62 ? 0.23 / 0.24 : 0
  const cx = D[0] * steep, cy = D[1] * steep, cz = D[2] * steep
  const crag = c >= 0.62 ? 1 : (c - 0.38) / 0.24
  // Ledges: the noise rounded into 3 steps with short, steep risers.
  const q = vnoiseD(x * 1.1, y * 1.1, z * 1.1, 51) * 3
  const f = q - Math.floor(q)
  const rise = f > 0.4 && f < 0.6 ? (3 * 1.1) / (0.2 * 3) : 0
  const lx = D[0] * rise, ly = D[1] * rise, lz = D[2] * rise
  const ledge = (Math.floor(q) + (f < 0.4 ? 0 : f > 0.6 ? 1 : (f - 0.4) / 0.2)) / 3
  const n = vnoiseD(x * 2.3, y * 2.3, z * 2.3, 52)
  GRAIN = bo + (n - bo) * crag
  const sg = n > 0.5 ? -2 * 2.3 : 2 * 2.3
  const sharp = ledge * 0.65 + (1 - Math.abs(n * 2 - 1)) * 0.35
  const sx = lx * 0.65 + D[0] * sg * 0.35, sy = ly * 0.65 + D[1] * sg * 0.35, sz = lz * 0.65 + D[2] * sg * 0.35
  const diff = sharp - bo
  G[0] = 2 * (bx + (sx - bx) * crag + diff * cx)
  G[1] = 2 * (by + (sy - by) * crag + diff * cy)
  G[2] = 2 * (bz + (sz - bz) * crag + diff * cz)
  return (bo + diff * crag) * 2 - 1
}

// The soft looks' sizes, against dirt's bumps (1).
const SAND_BUMP = 0.75
const GRAVEL_BUMP = 1.1
const MUD_BUMP = 0.35
const SNOW_BUMP = 1
const ICE_BUMP = 0.15
// Sand (-1..1): a slow, low swell plus wind ripples about 1.5 blocks
// apart, bent by a slow noise so they curve like real dunes. Ripples
// only on what faces up (ny), sand walls just get the swell.
function sandD(x, y, z, ny) {
  const sw = vnoiseD(x * 0.3, y * 0.3, z * 0.3, 60)
  const s0 = D[0] * 0.3, s1 = D[1] * 0.3, s2 = D[2] * 0.3
  const wv = vnoiseD(x * 0.21, y * 0.21, z * 0.21, 61) * 3
  const w0 = D[0] * 0.63, w1 = D[1] * 0.63, w2 = D[2] * 0.63
  const ph = (x * 0.55 + z * 0.35 + wv) * Math.PI * 2
  // Wind ripples rise slowly and drop off steeper on the far side.
  const sn = Math.sin(ph), cs = Math.cos(ph)
  const r = sn + 0.25 * Math.sin(2 * ph)
  const dr = (cs + 0.5 * Math.cos(2 * ph)) * Math.PI * 2
  const up = ny > 0 ? ny : 0
  const ra = 0.45 * up
  G[0] = 2 * 0.55 * s0 + ra * dr * (0.55 + w0)
  G[1] = 2 * 0.55 * s1 + ra * dr * w1
  G[2] = 2 * 0.55 * s2 + ra * dr * (0.35 + w2)
  return 0.55 * (sw * 2 - 1) + ra * r / 1.25
}
// Gravel (-1..1): busy lumps about half a block across, on a gentle
// swell - with the small stones BlockChunks scatters on top.
function gravelD(x, y, z) {
  const a = vnoiseD(x * 1.5, y * 1.5, z * 1.5, 62)
  const a0 = D[0] * 1.5, a1 = D[1] * 1.5, a2 = D[2] * 1.5
  const c = vnoiseD(x * 0.6, y * 0.6, z * 0.6, 64)
  G[0] = 2 * (0.7 * a0 + 0.3 * D[0] * 0.6)
  G[1] = 2 * (0.7 * a1 + 0.3 * D[1] * 0.6)
  G[2] = 2 * (0.7 * a2 + 0.3 * D[2] * 0.6)
  return (a * 0.7 + c * 0.3) * 2 - 1
}

// Where rock meets dirt, the two looks blend by how much rock is round
// each corner (rf), so the land runs on from one into the other.
function mixedD(x, y, z, rf) {
  const r = rockD(x, y, z)
  if (rf >= 0.999) return r
  const r0 = G[0], r1 = G[1], r2 = G[2]
  const b = bumpD(x, y, z)
  G[0] += (r0 - G[0]) * rf
  G[1] += (r1 - G[1]) * rf
  G[2] += (r2 - G[2]) * rf
  return b + (r - b) * rf
}

// Brightness for rock: the soft patches plus the rock's own grain -
// darker in the crags' cracks, lighter on worn ridges (rf: how much rock,
// grain: realPoint's out.grain).
export function rockTint(x, y, z, rf, grain) {
  const t = realTint(x, y, z)
  if (!(rf > 0)) return t
  return t * (1 - rf * 0.12 + rf * grain * 0.24)
}

// A round trunk's radius at angle a (radians) and height y, for the log
// standing in column x, z: nearly the whole block wide, with soft bark
// bumps that run on smoothly from one log to the one stacked on it (they
// depend on the world height, not the block's).
export function logRadius(a, y, x, z, amt) {
  const ca = Math.cos(a), sa = Math.sin(a)
  const bark = vnoise(x * 3.1 + ca * 1.6, y * 2.2, z * 3.1 + sa * 1.6, 48) * 0.7 +
    vnoise(x * 5.3 + ca * 4, y * 6, z * 5.3 + sa * 4, 49) * 0.3
  return 0.5 - amt * (0.015 + bark * 0.035)
}

// How far out a round block's side sits at angle a and height t (0 =
// its bottom, 1 = its top) - seventh batch. Logs use logRadius instead.
//  cactus: a slimmer column with 8 soft ribs.
//  hay: a fat, slightly fuzzy bale.
//  pumpkin: squat, 8 deep ribs, pinched in at the top and bottom.
//  melon: a fat round ball, a little flattened.
export function roundRadius(shape, a, t, x, y, z, amt) {
  const s = 1 - amt * 0.5 // how much it shrinks from a full cube's edge
  if (shape === 'cactus') return (0.5 - amt * 0.08) * (1 - amt * 0.05 * (1 - Math.abs(Math.cos(a * 4))))
  if (shape === 'hay') return 0.5 - amt * (0.03 + vnoise(x * 4 + Math.cos(a) * 3, y * 5 + t * 5, z * 4 + Math.sin(a) * 3, 47) * 0.03)
  const bulge = Math.sin(Math.PI * (0.06 + 0.88 * t))
  if (shape === 'pumpkin') {
    const rib = 1 - amt * 0.1 * (1 - Math.abs(Math.cos(a * 4)))
    return 0.5 * (s + (1 - s) * 0.05 + (1 - s) * 0.95 * Math.pow(bulge, 0.6)) * rib * (1 - amt * 0.04)
  }
  // melon
  return 0.5 * (s + (1 - s) * Math.pow(bulge, 0.5)) * (1 - amt * 0.03)
}

// How tall a round block is drawn (blocks): pumpkins sit a bit squat.
export function roundHeight(shape, amt) {
  if (shape === 'pumpkin') return 1 - amt * 0.12
  if (shape === 'melon') return 1 - amt * 0.05
  return 1
}

// Round shapes that run on into the same shape stacked above/below.
export const ROUND_STACKS = { log: true, cactus: true, hay: true }

// Eighth batch (2026-11-08): wood builds - planks, wood, bookshelves,
// barrels, crates, crafting tables, timber frame, thatch and roof/slate
// shingles. The man-made rule (Gaymi's option A, "one solid wall"):
// faces stay perfectly flat and straight so builds line up, blocks of
// the build join with no seams, and only the outside edges of the whole
// build get a slight soft bevel (BlockChunks._realWoodFace). Where wood
// touches anything else (stone, glass, a slab...) the line stays sharp.
// The wood's colour drifts across the planks (woodTint) instead of every
// block being the same shade, and thatch is shaggy with straw poking out.
export const REAL_WOOD = /^([a-z]*planks|wood|bookshelf|barrel|crate|craftingtable|timberframe|thatch|roofshingles|slateshingles)$/
// How far in from a cube edge the bevel starts (blocks, at full
// strength). One size for every wood block, so their edges line up.
export const WOOD_BEVEL = 0.14

// Wood colour drifting in long soft patches (a little lighter / darker,
// warmer / cooler) - [r, g, b] multipliers, the same at the same spot.
const WT = [1, 1, 1]
export function woodTint(x, y, z) {
  const v = vnoise(x * 0.21, y * 0.21, z * 0.21, 90)
  const w = vnoise(x * 0.13 + 5, y * 0.13, z * 0.13, 91) - 0.5
  const br = 0.91 + v * 0.14
  WT[0] = br * (1 + w * 0.08)
  WT[1] = br
  WT[2] = br * (1 - w * 0.14)
  return WT
}

// Ninth batch (2026-11-08): stone and metal builds, same "one solid
// wall" rule as wood. Bricks, quartz, purpur, prismarine, concrete,
// coloured/glazed terracotta, plaster and asphalt bevel a little less
// than wood; metal and gem blocks (iron, gold, copper, netherite,
// diamond/emerald/lapis/coal/redstone blocks) have sharper edges and
// shine. Blocks already drawn as rock (stone bricks, sandstone...) and
// plain terracotta (soft ground) keep their real-ground look.
export const REAL_STONE_BUILD = /^([a-z]*bricks?|[a-z]*quartz|quartzpillar|purpurblock|purpurpillar|[a-z]*prismarine|[a-z]*concrete|[a-z]+terracotta|plaster|asphalt)$/
export const REAL_METAL_BUILD = /^(metal|iron|gold|[a-z]*copper|copperblock|netherite|diamondblock|emeraldblock|lapisblock|coalblock|redstoneblock)$/
// Which man-made family a block id belongs to ('wood' | 'stone' |
// 'metal'), or null. Only blocks of the same family join into one wall.
export function buildOf(id) {
  if (REAL_WOOD.test(id)) return 'wood'
  if (REAL_METAL_BUILD.test(id)) return 'metal'
  if (REAL_STONE_BUILD.test(id)) return 'stone'
  return null
}
// Bevel size per family (blocks, at full strength): metal/gems sharpest.
export const BUILD_BEVEL = { wood: WOOD_BEVEL, stone: 0.11, metal: 0.05 }
// How shiny a build block is (the sun-glint shader's own gloss; kept
// above snow's sparkle range 0.06..0.4). Glazed terracotta is glazed.
export function buildGloss(id, fam) {
  if (fam === 'metal') return id === 'coalblock' ? 0.45 : 0.7
  if (id === 'glazedterracotta') return 0.5
  return 0
}

// Colour drift for stone/metal builds: a little lighter or darker in
// long soft patches (weathering), no warm/cool shift. Metal drifts less.
export function buildTint(fam, x, y, z) {
  if (fam === 'wood') return woodTint(x, y, z)
  const v = vnoise(x * 0.19, y * 0.19, z * 0.19, 93)
  const br = fam === 'metal' ? 0.96 + v * 0.06 : 0.93 + v * 0.1
  WT[0] = WT[1] = WT[2] = br
  return WT
}

// How shaggy thatch is at a point (0..1), for its straw lumps.
export function shag(x, y, z) {
  return vnoise(x * 2.7, y * 2.7, z * 2.7, 92)
}
