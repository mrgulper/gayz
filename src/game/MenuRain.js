// Homepage rain (2026-10-09, Gaymi: "make it rain in the GayZ style but
// it must be realistic"). Replaces a repeating CSS stripe pattern, which
// read as hatching rather than rain. Drawn on #menu-bg-rain (a canvas over
// the background photo, under the menu):
// - three depth layers: far drops are short, thin, faint and slower; near
//   ones are long, brighter and fast - so the rain has depth instead of
//   one flat sheet;
// - one slanted wind for every drop, drifting slowly and with the odd
//   gust;
// - near drops end in a splash on the wet street (lower part of the
//   picture): a flat ripple that spreads and fades, plus a couple of tiny
//   droplets thrown up.
// Only draws while the homepage is actually on screen (the canvas has no
// layout box when #menu is hidden for the Map Editor/Play, or the Weather
// Particles setting hides it) and the tab is visible; nothing at all
// under prefers-reduced-motion. Reduce Homepage Background Effects
// (body.reduce-bg-effects) halves the drops.

// Drops per 1000x1000 CSS px of window, per depth layer (far, mid, near).
const LAYER_DENSITY = [140, 90, 45]
const LAYERS = [
  { speed: [520, 680], len: [7, 11], width: 0.6, alpha: 0.16 },
  { speed: [820, 1050], len: [13, 19], width: 0.9, alpha: 0.24 },
  { speed: [1250, 1550], len: [22, 34], width: 1.3, alpha: 0.34 },
]
// Wind as horizontal px per px fallen (negative leans left, like the
// photo's rain).
const WIND_BASE = -0.17
const WIND_DRIFT = 0.05
const GUST_CHANCE_PER_S = 0.08
// Splashes land on the street - the lower part of the picture.
const GROUND_FROM = 0.68
const MAX_SPLASHES = 70
const SPLASH_LIFE_S = 0.45
// The canvas never draws more pixels than this per CSS pixel (rain is
// soft; full Retina resolution would only cost frame time).
const MAX_PIXEL_RATIO = 1.5

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
  let ratio = 1
  let drops = []
  const splashes = []
  let wind = WIND_BASE
  let gust = 0
  let last = performance.now()
  let reduced = false

  function newDrop(layer, anywhere) {
    const L = LAYERS[layer]
    return {
      layer,
      x: rand(-0.1 * w, 1.25 * w),
      y: anywhere ? rand(-h, h) : rand(-0.25 * h, -10),
      speed: rand(L.speed[0], L.speed[1]),
      len: rand(L.len[0], L.len[1]),
      // Where a near drop hits the street.
      groundY: layer === 2 ? rand(GROUND_FROM * h, h) : h + 40,
    }
  }

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    reduced = document.body.classList.contains('reduce-bg-effects')
    const area = (w * h) / 1e6
    drops = []
    LAYER_DENSITY.forEach((density, layer) => {
      const count = Math.round(density * area * (reduced ? 0.5 : 1))
      for (let i = 0; i < count; i++) drops.push(newDrop(layer, true))
    })
  }

  function splash(x, y) {
    if (splashes.length >= MAX_SPLASHES) return
    splashes.push({
      x,
      y,
      age: 0,
      size: rand(3, 7),
      bits: [0, 1].map(() => ({ vx: rand(-40, 40), vy: rand(-90, -50) })),
    })
  }

  function frame(now) {
    requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    // Not on screen (homepage hidden, setting off) or tab hidden: skip.
    if (document.hidden || canvas.offsetParent === null) return
    if (canvas.clientWidth !== w || canvas.clientHeight !== h) resize()
    if (!w || !h) return

    // Wind: a slow drift plus the odd gust that dies away.
    if (Math.random() < GUST_CHANCE_PER_S * dt) gust = rand(-0.12, 0.06)
    gust *= Math.pow(0.35, dt)
    wind = WIND_BASE + WIND_DRIFT * Math.sin(now / 4300) + gust

    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'round'

    // One path per layer - three strokes a frame, however many drops.
    for (let layer = 0; layer < LAYERS.length; layer++) {
      const L = LAYERS[layer]
      ctx.beginPath()
      for (const d of drops) {
        if (d.layer !== layer) continue
        const fall = d.speed * dt
        d.y += fall
        d.x += fall * wind
        if (d.y >= d.groundY) {
          if (layer === 2) splash(d.x, d.groundY)
          Object.assign(d, newDrop(layer, false))
          continue
        }
        if (d.y > h + d.len || d.x < -0.2 * w || d.x > 1.3 * w) {
          Object.assign(d, newDrop(layer, false))
          continue
        }
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x - d.len * wind, d.y - d.len)
      }
      ctx.strokeStyle = `rgba(206, 214, 222, ${L.alpha})`
      ctx.lineWidth = L.width
      ctx.stroke()
    }

    // Splashes: a flat ripple ring spreading out, and two tiny droplets.
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]
      s.age += dt
      const t = s.age / SPLASH_LIFE_S
      if (t >= 1) {
        splashes.splice(i, 1)
        continue
      }
      const fade = 1 - t
      ctx.strokeStyle = `rgba(214, 220, 228, ${0.32 * fade})`
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.ellipse(s.x, s.y, s.size * (0.4 + t * 1.6), s.size * (0.12 + t * 0.4), 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = `rgba(220, 226, 232, ${0.45 * fade})`
      for (const b of s.bits) {
        const bx = s.x + b.vx * s.age
        const by = s.y + b.vy * s.age + 260 * s.age * s.age
        if (by <= s.y) ctx.fillRect(bx, by, 1.2, 1.2)
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
