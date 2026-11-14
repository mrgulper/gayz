// Two background sound cues for walking around the world, checked about
// ten times a second from BuildTryMode.update (2026-11-14):
// - Indoors: any solid block over your head (within ROOF_REACH blocks)
//   dulls the wind - buildings, sewers, the subway and roofs players build.
//   Audio.updateAmbientZone does the smooth fade.
// - Horde direction: a quiet rumble that grows with how many zombies are
//   near and leans left/right toward the nearest one. Kept subtle and on
//   the ambient bed, so it never covers other sounds.
//   Audio.updateZombiePresence does the fade.
import { audioEngine } from './Audio.js'

const TICK = 0.1 // seconds between checks
const ROOF_REACH = 12 // blocks above your head that still count as a roof
const HORDE_RANGE = 28 // blocks - zombies further away don't add rumble
const HORDE_FULL = 8 // this many close zombies = full (still quiet) rumble

export function isUnderRoof(bm, x, y, z) {
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  const from = Math.floor(y) + 2 // just above head height (players are 2 tall)
  for (let cy = from; cy < from + ROOF_REACH; cy++) {
    if (bm._cellSolidTop(cx, cy, cz) > 0) return true
  }
  return false
}

// intensity 0-1 and pan -1 (left) .. 1 (right) toward the nearest zombie.
export function hordeCue(zombies, x, z, yaw) {
  let near = 0
  let best = Infinity
  let bx = 0
  let bz = 0
  for (const zb of zombies || []) {
    const dx = zb.x - x
    const dz = zb.z - z
    const d = Math.hypot(dx, dz)
    if (d > HORDE_RANGE) continue
    near += 1 - d / HORDE_RANGE // closer ones count more
    if (d < best) { best = d; bx = dx; bz = dz }
  }
  if (!near) return { intensity: 0, pan: 0 }
  // The camera's right-hand direction for this yaw (same maths as walking).
  const rx = Math.cos(yaw)
  const rz = -Math.sin(yaw)
  const pan = best > 0.01 ? (bx * rx + bz * rz) / best : 0
  return { intensity: Math.min(1, near / HORDE_FULL), pan }
}

export function tickAmbientCues(tm, dt) {
  tm._cueT = (tm._cueT || 0) - dt
  if (tm._cueT > 0) return
  tm._cueT = TICK
  const p = tm.pos
  try {
    audioEngine.updateAmbientZone(isUnderRoof(tm.bm, p.x, p.y, p.z))
    const sv = tm.bm.survival
    const cue = sv?.active ? hordeCue(sv.zombies, p.x, p.z, tm.bm._yaw) : { intensity: 0, pan: 0 }
    // Subtle (Gaymi's pick): at most 60% of the boost, and the Zombie
    // sounds slider turns it down with the moans.
    audioEngine.updateZombiePresence(cue.intensity * 0.6 * (audioEngine.zombieVolume ?? 1), cue.pan)
  } catch { /* no audio */ }
}

// Leaving the world: back to open-air wind and no rumble.
export function resetAmbientCues(tm) {
  tm._cueT = 0
  try {
    audioEngine.resetAmbientCues?.()
  } catch { /* no audio */ }
}
