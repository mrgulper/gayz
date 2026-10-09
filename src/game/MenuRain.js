// Homepage rain (2026-10-09). First version: "make it rain in the GayZ
// style but it must be realistic". Second, from Gaymi's screenshot: "make
// the rain only on the floor, rain hard and softly as time goes, not all
// softly at once, straight not sideways, more detailed when dropping, don't
// just use lines". Drawn on #menu-bg-rain (a canvas over the background
// photo, under the menu):
// - drops only come down onto the street: every drop picks a landing spot
//   on the floor of the photo (FLOOR, in fractions of the picture, mapped
//   through the same `cover` / `center 35%` sizing the CSS uses) and is
//   only seen for the last stretch of its fall, so the rain sits on the
//   floor instead of streaking over the sky and buildings;
// - perspective: drops landing far up the street are smaller, fainter,
//   slower and fall a shorter way than ones landing near the bottom;
// - straight down, no wind;
// - the strength wanders between a drizzle and a downpour (INTENSITY_*),
//   easing from one to the next every so often;
// - each drop is a pre-drawn picture (a round, lit head with a tapered,
//   fading tail - `dropSprite`), not a plain line, and lands in a splash:
//   a little crown, droplets thrown out in arcs, and a ripple ring that
//   spreads and fades.
// Only draws while the homepage is actually on screen (the canvas has no
// layout box when #menu is hidden for the Map Editor/Play, or the Weather
// Particles setting hides it) and the tab is visible; nothing at all
// under prefers-reduced-motion. Reduce Homepage Background Effects
// (body.reduce-bg-effects) halves the drops.

// The street in both background photos (menu-art/old-menu-bg.webp and
// menu-bg-city.webp share the same framing), as fractions of the picture:
// the far end of the road at HORIZON, widening out to the bottom corners
// from EDGE_Y at the left/right edges.
const PICTURE_ASPECT = 1280 / 774
const PICTURE_POS_Y = 0.35 // background-position: center 35%
const FLOOR = { horizon: 0.665, left: 0.46, right: 0.57, edgeY: 0.79 }

// Drops falling at once per 1000x1000 CSS px of floor at full strength.
const MAX_DENSITY = 900
// Strength wanders between these (0-1 of MAX_DENSITY), a new target every
// INTENSITY_HOLD seconds, eased over INTENSITY_EASE seconds.
const INTENSITY_MIN = 0.12
const INTENSITY_MAX = 1
const INTENSITY_HOLD = [7, 18]
const INTENSITY_EASE = 4
// Fall speed (CSS px/s) and the visible fall (share of screen height) for
// a drop landing at the very bottom; farther drops scale down.
const SPEED = [1100, 1500]
const FALL_SHARE = 0.26
const MAX_SPLASHES = 160
const SPLASH_LIFE_S = 0.5
// The canvas never draws more pixels than this per CSS pixel.
const MAX_PIXEL_RATIO = 1.5

function rand(a, b) {
  return a + Math.random() * (b - a)
}

// One raindrop in motion, drawn once and stretched per drop: a bright round
// head at the bottom with a highlight, and a tail that tapers and fades
// upward (what a falling drop looks like to the eye).
function dropSprite() {
  const W = 12
  const H = 96
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const headR = W * 0.32
  const headY = H - headR - 1
  const tail = g.createLinearGradient(0, 0, 0, headY)
  tail.addColorStop(0, 'rgba(200, 210, 222, 0)')
  tail.addColorStop(0.55, 'rgba(205, 214, 226, 0.22)')
  tail.addColorStop(1, 'rgba(225, 232, 240, 0.7)')
  g.fillStyle = tail
  g.beginPath()
  g.moveTo(W / 2, 0)
  g.quadraticCurveTo(W / 2 + headR * 0.9, headY * 0.7, W / 2 + headR, headY)
  g.arc(W / 2, headY, headR, 0, Math.PI)
  g.quadraticCurveTo(W / 2 - headR * 0.9, headY * 0.7, W / 2, 0)
  g.fill()
  const head = g.createRadialGradient(W / 2 - headR * 0.3, headY - headR * 0.2, 0, W / 2, headY, headR * 1.2)
  head.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
  head.addColorStop(0.45, 'rgba(225, 233, 242, 0.75)')
  head.addColorStop(1, 'rgba(150, 165, 182, 0)')
  g.fillStyle = head
  g.beginPath()
  g.arc(W / 2, headY, headR * 1.2, 0, Math.PI * 2)
  g.fill()
  return { canvas: c, w: W, h: H }
}

export function startMenuRain(canvas) {
  if (!canvas || !canvas.getContext) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const sprite = dropSprite()

  let w = 0
  let h = 0
  let drops = []
  const splashes = []
  let reduced = false
  let last = performance.now()
  // Floor in screen space.
  let horizonY = 0
  let edgeY = 0
  let farL = 0
  let farR = 0
  let intensity = rand(0.3, 0.7)
  let target = intensity
  let from = intensity
  let easeT = 1
  let nextChange = rand(INTENSITY_HOLD[0], INTENSITY_HOLD[1])

  // Picture fraction -> screen px, like `background-size: cover;
  // background-position: center 35%`.
  function mapPicture() {
    let pw = w
    let ph = w / PICTURE_ASPECT
    if (ph < h) {
      ph = h
      pw = h * PICTURE_ASPECT
    }
    const ox = (w - pw) / 2
    const oy = (h - ph) * PICTURE_POS_Y
    horizonY = oy + FLOOR.horizon * ph
    edgeY = oy + FLOOR.edgeY * ph
    farL = ox + FLOOR.left * pw
    farR = ox + FLOOR.right * pw
  }

  // Left/right edge of the floor at a given screen height.
  function floorSpan(y) {
    if (y >= edgeY) return [0, w]
    const t = (y - horizonY) / Math.max(1, edgeY - horizonY)
    return [farL * (1 - t), farR + (w - farR) * t]
  }

  function newDrop(anywhere) {
    // More drops land near the viewer than far up the street.
    const depth = Math.sqrt(Math.random())
    const landY = horizonY + 2 + depth * (h - horizonY - 2)
    const [l, r] = floorSpan(landY)
    const s = 0.12 + 0.88 * depth
    const fall = FALL_SHARE * h * s + 4
    const d = {
      x: rand(l, r),
      landY,
      s,
      fall,
      speed: rand(SPEED[0], SPEED[1]) * (0.35 + 0.65 * s),
      y: 0,
      len: (16 + 30 * s) * rand(0.85, 1.15),
    }
    d.y = landY - fall * (anywhere ? Math.random() : rand(1, 1.6))
    return d
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    reduced = document.body.classList.contains('reduce-bg-effects')
    mapPicture()
    const floorArea = Math.max(0, h - horizonY) * w * 0.8
    const count = Math.round((MAX_DENSITY * floorArea) / 1e6 * (reduced ? 0.5 : 1))
    drops = []
    for (let i = 0; i < count; i++) drops.push(newDrop(true))
  }

  function splash(d) {
    if (splashes.length >= MAX_SPLASHES) return
    const s = d.s
    splashes.push({
      x: d.x,
      y: d.landY,
      s,
      age: 0,
      bits: Array.from({ length: s > 0.45 ? 4 : 2 }, () => ({
        vx: rand(-55, 55) * s,
        vy: rand(-120, -60) * s,
        r: rand(0.6, 1.1) * (0.5 + s),
      })),
    })
  }

  function updateIntensity(dt) {
    nextChange -= dt
    if (nextChange <= 0) {
      from = intensity
      // Swing to the other side often, so it really goes soft <-> hard.
      target =
        intensity > 0.55
          ? rand(INTENSITY_MIN, 0.45)
          : Math.random() < 0.7
            ? rand(0.6, INTENSITY_MAX)
            : rand(INTENSITY_MIN, 0.5)
      easeT = 0
      nextChange = rand(INTENSITY_HOLD[0], INTENSITY_HOLD[1])
    }
    if (easeT < 1) {
      easeT = Math.min(1, easeT + dt / INTENSITY_EASE)
      const e = easeT * easeT * (3 - 2 * easeT)
      intensity = from + (target - from) * e
    }
  }

  function frame(now) {
    requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    // Not on screen (homepage hidden, setting off) or tab hidden: skip.
    if (document.hidden || canvas.offsetParent === null) return
    if (canvas.clientWidth !== w || canvas.clientHeight !== h) resize()
    if (!w || !h) return
    updateIntensity(dt)

    ctx.clearRect(0, 0, w, h)
    // Only the first `active` drops fall; the rest wait above their spot,
    // so the rain thins out and fills in smoothly as the strength changes.
    const active = Math.round(drops.length * intensity)
    // Heavy rain falls a little faster.
    const speedMult = 0.85 + 0.3 * intensity
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]
      if (i >= active && d.y < d.landY - d.fall) continue
      d.y += d.speed * speedMult * dt
      if (d.y >= d.landY) {
        splash(d)
        Object.assign(d, newDrop(false))
        continue
      }
      const top = d.landY - d.fall
      if (d.y < top) continue
      // Fade in at the top of the visible fall, full near the ground.
      const fadeIn = Math.min(1, (d.y - top) / (d.fall * 0.3))
      ctx.globalAlpha = (0.3 + 0.55 * d.s) * fadeIn
      const dw = sprite.w * (0.18 + 0.32 * d.s)
      const dh = Math.min(d.len, d.y - top + 4)
      ctx.drawImage(sprite.canvas, d.x - dw / 2, d.y - dh, dw, dh)
    }
    ctx.globalAlpha = 1

    // Splashes: a small crown, droplets thrown out in arcs, a ripple ring.
    for (let i = splashes.length - 1; i >= 0; i--) {
      const sp = splashes[i]
      sp.age += dt
      const t = sp.age / SPLASH_LIFE_S
      if (t >= 1) {
        splashes.splice(i, 1)
        continue
      }
      const fade = 1 - t
      const size = 2 + 7 * sp.s
      // Ripple: two rings, the second a little behind.
      ctx.lineWidth = 0.5 + 0.5 * sp.s
      for (const lag of [0, 0.35]) {
        const rt = t - lag
        if (rt <= 0) continue
        ctx.strokeStyle = `rgba(214, 222, 232, ${0.4 * (1 - rt) * fade})`
        ctx.beginPath()
        ctx.ellipse(sp.x, sp.y, size * (0.3 + rt * 1.7), size * (0.09 + rt * 0.45), 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      // Crown: a quick upward flick for the first moment.
      if (t < 0.25) {
        const ct = t / 0.25
        const ch = size * 0.9 * Math.sin(ct * Math.PI)
        ctx.strokeStyle = `rgba(232, 238, 245, ${0.55 * (1 - ct)})`
        ctx.lineWidth = 0.6 + 0.4 * sp.s
        ctx.beginPath()
        ctx.moveTo(sp.x - size * 0.35, sp.y)
        ctx.quadraticCurveTo(sp.x - size * 0.45, sp.y - ch, sp.x - size * 0.6, sp.y - ch * 0.8)
        ctx.moveTo(sp.x + size * 0.35, sp.y)
        ctx.quadraticCurveTo(sp.x + size * 0.45, sp.y - ch, sp.x + size * 0.6, sp.y - ch * 0.8)
        ctx.moveTo(sp.x, sp.y)
        ctx.lineTo(sp.x, sp.y - ch * 1.1)
        ctx.stroke()
      }
      // Droplets thrown out and falling back.
      ctx.fillStyle = `rgba(228, 234, 242, ${0.7 * fade})`
      for (const b of sp.bits) {
        const bx = sp.x + b.vx * sp.age
        const by = sp.y + b.vy * sp.age + 420 * sp.s * sp.age * sp.age
        if (by > sp.y) continue
        ctx.beginPath()
        ctx.arc(bx, by, b.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  resize()
  window.addEventListener('resize', resize)
  // Reduce Homepage Background Effects can be toggled while running.
  new MutationObserver(() => {
    if (document.body.classList.contains('reduce-bg-effects') !== reduced) resize()
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  requestAnimationFrame(frame)
}
