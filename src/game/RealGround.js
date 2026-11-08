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
export const REAL_GROUND = /^(grass|dirt)$/

// How far corners round off (blocks, at full strength).
const K_ROUND = 0.85
// Bumps along the surface's facing direction, and the sideways wobble
// that keeps outlines from being straight lines (blocks).
const A_BUMP = 0.13
const A_JIT = 0.12
// The wobble moves points up and down less than sideways, so flat ground
// stays close to where you stand.
const JIT_Y = 0.4

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

// The rolling bumps, -1..1: a broad swell plus finer lumps.
function bumpAt(x, y, z) {
  return (vnoise(x * 0.7, y * 0.7, z * 0.7, 41) * 0.65 + vnoise(x * 1.9, y * 1.9, z * 1.9, 42) * 0.35) * 2 - 1
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

// One lattice point (X, Y, Z: a corner where up to 8 cells meet) into
// out[o..o+7]: the rounding move (x, y, z), the ground's facing direction
// there (x, y, z), w (1 = free to move, 0 = pinned) and corner shade.
// kind(x, y, z) -> AIR / REAL / PIN_SOLID / PIN_OTHER.
export function latticeAt(kind, X, Y, Z, amt, out, o = 0) {
  let n = 0, solid = 0, pinned = false
  let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0
  for (let dy = -1; dy <= 0; dy++) {
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const k = kind(X + dx, Y + dy, Z + dz)
        const cx = dx + 0.5, cy = dy + 0.5, cz = dz + 0.5
        if (k === REAL) {
          n++
          sx += cx; sy += cy; sz += cz
        } else {
          if (k !== AIR) pinned = true
          ax += cx; ay += cy; az += cz
        }
        if (k === REAL || k === PIN_SOLID) solid++
      }
    }
  }
  // Corner shade: the more solid round it, the more tucked in (dark).
  out[o + 7] = solid <= 4 ? 1 : solid === 5 ? 0.84 : solid === 6 ? 0.68 : 0.55
  if (pinned || n === 0 || n === 8) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = out[o + 4] = out[o + 5] = out[o + 6] = 0
    return out
  }
  sx /= n; sy /= n; sz /= n
  const na = 8 - n
  ax /= na; ay /= na; az /= na
  // Toward the ground's middle on an outside corner (rounds it off),
  // toward the air on an inside one (fills it in), nothing on flat ground.
  const k = K_ROUND * amt
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
export function realPoint(P, L, s, t, fn, amt, out) {
  const W0 = (1 - s) * (1 - t), W1 = s * (1 - t), W2 = s * t, W3 = (1 - s) * t
  let px = 0, py = 0, pz = 0, mx = 0, my = 0, mz = 0, nx = 0, ny = 0, nz = 0, w = 0, ao = 0
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
  }
  let nl = Math.hypot(nx, ny, nz)
  if (nl < 1e-6) { nx = fn[0]; ny = fn[1]; nz = fn[2] } else { nx /= nl; ny /= nl; nz /= nl }
  const k = w * amt
  let x = px + mx, y = py + my, z = pz + mz
  if (k > 0) {
    const b = bumpAt(px, py, pz)
    const jx = vnoise(px * 0.5, py * 0.5, pz * 0.5, 43) * 2 - 1
    const jy = (vnoise(px * 0.5, py * 0.5, pz * 0.5, 44) * 2 - 1) * JIT_Y
    const jz = vnoise(px * 0.5, py * 0.5, pz * 0.5, 45) * 2 - 1
    x += k * (A_BUMP * b * nx + A_JIT * jx)
    y += k * (A_BUMP * b * ny + A_JIT * jy)
    z += k * (A_BUMP * b * nz + A_JIT * jz)
    // The bumps tip the surface: lean the facing direction away from
    // where they rise (only the part along the surface).
    const e = 0.08
    const gx = (bumpAt(px + e, py, pz) - b) / e
    const gy = (bumpAt(px, py + e, pz) - b) / e
    const gz = (bumpAt(px, py, pz + e) - b) / e
    const gd = gx * nx + gy * ny + gz * nz
    const f = k * A_BUMP
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
  return out
}
