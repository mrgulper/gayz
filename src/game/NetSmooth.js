// Smoother players and zombies online (2026-11-13, Gaymi: "make the
// gameplay even smoother in both ping and movement"). A server sync only
// comes a few times a second, so things sent over it (other players, a
// guest's mirrored zombies) used to slide toward the last spot they were
// seen at and stop there until the next one: always a step behind, with a
// stop-start lurch. Now each new spot also gives a speed (from the last
// spot and the time between), and between syncs the target keeps going
// that way for up to AHEAD_S seconds, so they glide on instead.
//
// o: anything with tx/ty/tz (its target, set by the sync). setTarget()
// when a sync says where it is; ahead() once a frame before easing to it.

// How long past the last sync a target keeps moving on its own.
const AHEAD_S = 0.25
// Faster than this (blocks a second) is a teleport or respawn: no guessing.
const MAX_SPEED = 40

export function setTarget(o, x, y, z, now = performance.now()) {
  const had = o._netAt !== undefined && o._sx !== undefined
  const gap = had ? (now - o._netAt) / 1000 : 0
  let vx = 0
  let vz = 0
  if (had && gap > 0.02) {
    vx = (x - o._sx) / gap
    vz = (z - o._sz) / gap
    if (Math.hypot(vx, vz) > MAX_SPEED) vx = vz = 0
  }
  o._sx = x
  o._sz = z
  o._netAt = now
  o._vx = vx
  o._vz = vz
  o._ahead = 0
  o.tx = x
  o.ty = y
  o.tz = z
}

// Moves the target on along its speed (capped at AHEAD_S past the sync).
export function ahead(o, dt) {
  if (!o._vx && !o._vz) return
  const step = Math.max(0, Math.min(dt, AHEAD_S - (o._ahead || 0)))
  if (!step) return
  o._ahead = (o._ahead || 0) + step
  o.tx += o._vx * step
  o.tz += o._vz * step
}
