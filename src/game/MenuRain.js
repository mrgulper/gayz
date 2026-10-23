// Homepage rain (2026-10-09). First version: "make it rain in the GayZ
// style but it must be realistic". Second, from Gaymi's screenshot: "make
// the rain only on the floor, rain hard and softly as time goes, not all
// softly at once, straight not sideways, more detailed when dropping, don't
// just use lines". Drawn on #menu-bg-rain (a canvas over the background
// photo, under the menu):
// - drops fall from the very top of the page and land on the street: every
//   drop picks a landing spot on the floor of the photo (FLOOR, in
//   fractions of the picture, mapped through the same `cover` /
//   `center 35%` sizing the CSS uses) and splashes there, never on the sky
//   or the buildings (Gaymi, third pass: "make it rain from the very top of
//   the gayz page" - the second pass only drew the last stretch of each
//   fall, so the rain seemed to start halfway down the screen);
// - perspective: drops landing far up the street are smaller, fainter and
//   slower than ones landing near the bottom;
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

import { LITE_HOME, startWhenLight, onHomeFrame, onHomePause } from './LiteHome.js'

// The street in the Old theme's background photo (menu-art/old-menu-bg.webp),
// as fractions of the picture:
// the far end of the road at HORIZON, widening out to the bottom corners
// from EDGE_Y at the left/right edges.
export const PICTURE_ASPECT = 1280 / 774
export const PICTURE_POS_Y = 0.35 // background-position: center 35%
export const FLOOR = { horizon: 0.665, left: 0.46, right: 0.57, edgeY: 0.79 }

// The picture's box on a w x h screen, like `background-size: cover;
// background-position: center 35%`.
export function pictureBox(w, h) {
  let pw = w
  let ph = w / PICTURE_ASPECT
  if (ph < h) {
    ph = h
    pw = h * PICTURE_ASPECT
  }
  return { x: (w - pw) / 2, y: (h - ph) * PICTURE_POS_Y, w: pw, h: ph }
}

// How hard it's raining right now (0-1), for the moving water on the
// road (MenuWater.js).
export const rainState = { intensity: 0.5 }

// Rain redrawn (2026-10-18, Gaymi: "the rain feels cheap and kinda bad and
// the homepage is pretty laggy"): instead of hundreds of separately drawn
// drop pictures and splash shapes every frame, the drops are thin streaks
// in three depth layers (far: short, faint, slow; near: long, brighter,
// fast), each layer drawn as two batched strokes - a faint tail and a
// brighter drop head at the bottom (still straight down and not "just
// lines", as asked before); splashes are small ripple rings batched the
// same way; a
// soft mist lies over the street and thickens in heavy rain. A handful of
// draw calls a frame instead of ~1000.
const MAX_DENSITY = 170
const LAYERS = [
  { share: 0.5, len: [10, 18], width: 0.7, alpha: 0.16, speed: [700, 900] },
  { share: 0.33, len: [18, 32], width: 1, alpha: 0.24, speed: [1000, 1250] },
  { share: 0.17, len: [34, 60], width: 1.4, alpha: 0.32, speed: [1350, 1650] },
]
const INTENSITY_MIN = 0.15
const INTENSITY_MAX = 1
const INTENSITY_HOLD = [7, 18]
const INTENSITY_EASE = 4
const MAX_SPLASHES = 70
const SPLASH_LIFE_S = 0.45
const MAX_PIXEL_RATIO = 1
const LITE_DROPS = 0.55

function rand(a, b) {
  return a + Math.random() * (b - a)
}

export function startMenuRain(canvas) {
  if (!canvas || !canvas.getContext) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  let w = 0
  let h = 0
  let drops = []
  const splashes = []
  let reduced = false
  let last = performance.now()
  let horizonY = 0
  let edgeY = 0
  let farL = 0
  let farR = 0
  let intensity = rand(0.3, 0.7)
  let target = intensity
  let from = intensity
  let easeT = 1
  let nextChange = rand(INTENSITY_HOLD[0], INTENSITY_HOLD[1])
  let mist = null

  function mapPicture() {
    const box = pictureBox(w, h)
    horizonY = box.y + FLOOR.horizon * box.h
    edgeY = box.y + FLOOR.edgeY * box.h
    farL = box.x + FLOOR.left * box.w
    farR = box.x + FLOOR.right * box.w
  }

  function floorSpan(y) {
    if (y >= edgeY) return [0, w]
    const t = (y - horizonY) / Math.max(1, edgeY - horizonY)
    return [farL * (1 - t), farR + (w - farR) * t]
  }

  function newDrop(layer, anywhere) {
    const L = LAYERS[layer]
    // Near drops land low on the street, far ones high up it.
    const depth = (layer + Math.random()) / LAYERS.length
    const landY = horizonY + 2 + depth * (h - horizonY - 2)
    const [l, r] = floorSpan(landY)
    const x = rand(l, r)
    return {
      layer,
      landX: x,
      landY,
      len: rand(L.len[0], L.len[1]),
      speed: rand(L.speed[0], L.speed[1]),
      y: anywhere ? rand(-0.3 * h, landY) : -rand(0, 0.6 * h),
    }
  }

  function resize() {
    const ratio = LITE_HOME ? 1 : Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    reduced = document.body.classList.contains('reduce-bg-effects')
    mapPicture()
    const count = Math.round(((MAX_DENSITY * w * h) / 1e6) * (reduced ? 0.5 : 1) * (LITE_HOME ? LITE_DROPS : 1))
    drops = []
    LAYERS.forEach((L, layer) => {
      for (let i = 0; i < Math.round(count * L.share); i++) drops.push(newDrop(layer, true))
    })
    // Drops are shuffled so the "active" share thins every layer evenly.
    for (let i = drops.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[drops[i], drops[j]] = [drops[j], drops[i]]
    }
    // The street mist: a soft band over the floor, drawn once.
    mist = ctx.createLinearGradient(0, horizonY - 0.06 * h, 0, h)
    mist.addColorStop(0, 'rgba(190, 200, 212, 0)')
    mist.addColorStop(0.35, 'rgba(190, 200, 212, 0.10)')
    mist.addColorStop(1, 'rgba(170, 180, 194, 0.04)')
  }

  function updateIntensity(dt) {
    nextChange -= dt
    if (nextChange <= 0) {
      from = intensity
      target = intensity > 0.55 ? rand(INTENSITY_MIN, 0.45) : Math.random() < 0.7 ? rand(0.6, INTENSITY_MAX) : rand(INTENSITY_MIN, 0.5)
      easeT = 0
      nextChange = rand(INTENSITY_HOLD[0], INTENSITY_HOLD[1])
    }
    if (easeT < 1) {
      easeT = Math.min(1, easeT + dt / INTENSITY_EASE)
      const e = easeT * easeT * (3 - 2 * easeT)
      intensity = from + (target - from) * e
    }
    rainState.intensity = intensity
  }

  function frame(now, due) {
    if (!due) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (document.hidden || canvas.offsetParent === null) return
    if (canvas.clientWidth !== w || canvas.clientHeight !== h) resize()
    if (!w || !h) return
    updateIntensity(dt)
    ctx.clearRect(0, 0, w, h)
    // Mist over the street, thicker in a downpour.
    ctx.globalAlpha = 0.35 + 0.65 * intensity
    ctx.fillStyle = mist
    ctx.fillRect(0, horizonY - 0.06 * h, w, h)
    ctx.globalAlpha = 1
    const active = Math.round(drops.length * intensity)
    const speedMult = 0.85 + 0.3 * intensity
    // Two paths per depth layer: tails, then heads.
    ctx.lineCap = 'round'
    for (let layer = 0; layer < LAYERS.length; layer++) {
      const L = LAYERS[layer]
      const layerHeads = layer === 0 ? null : new Path2D()
      ctx.beginPath()
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i]
        if (d.layer !== layer) continue
        if (i >= active && d.y < 0) continue
        d.y += d.speed * speedMult * dt
        if (d.y >= d.landY) {
          if (splashes.length < MAX_SPLASHES && layer > 0) splashes.push({ x: d.landX, y: d.landY, s: layer / 2, age: 0 })
          Object.assign(d, newDrop(layer, false))
          continue
        }
        if (d.y < 0) continue
        const x = d.landX
        ctx.moveTo(x, d.y - d.len * 0.2)
        ctx.lineTo(x, d.y - d.len)
        if (layerHeads) {
          layerHeads.moveTo(x, d.y)
          layerHeads.lineTo(x, d.y - d.len * 0.22)
        }
      }
      ctx.strokeStyle = `rgba(205, 214, 226, ${L.alpha * (0.75 + 0.25 * intensity)})`
      ctx.lineWidth = L.width
      ctx.stroke()
      if (layerHeads) {
        ctx.strokeStyle = `rgba(238, 243, 250, ${Math.min(0.85, L.alpha * 2.4)})`
        ctx.lineWidth = L.width + 0.6
        ctx.stroke(layerHeads)
      }
    }
    // Ripples: one path for the young ones, one for the old.
    for (const [lo, hi, a] of [[0, 0.5, 0.32], [0.5, 1, 0.14]]) {
      ctx.beginPath()
      for (let i = splashes.length - 1; i >= 0; i--) {
        const sp = splashes[i]
        if (lo === 0) sp.age += dt
        const t = sp.age / SPLASH_LIFE_S
        if (t >= 1) {
          splashes.splice(i, 1)
          continue
        }
        if (t < lo || t >= hi) continue
        const size = 2.5 + 6 * sp.s
        const rx = size * (0.3 + t * 1.6)
        ctx.moveTo(sp.x + rx, sp.y)
        ctx.ellipse(sp.x, sp.y, rx, rx * 0.26, 0, 0, Math.PI * 2)
      }
      ctx.strokeStyle = `rgba(220, 228, 238, ${a})`
      ctx.lineWidth = 0.8
      ctx.stroke()
    }
  }

  resize()
  window.addEventListener('resize', resize)
  // Homepage paused (a match, the Map Editor): a full-screen canvas nobody
  // sees is ~5 MB, so it's emptied; the first frame back resizes it.
  onHomePause(() => {
    canvas.width = canvas.height = 0
    w = h = -1
  })
  new MutationObserver(() => {
    if (document.body.classList.contains('reduce-bg-effects') !== reduced) resize()
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  startWhenLight(() => {
    last = performance.now()
    onHomeFrame(frame)
  })
}
