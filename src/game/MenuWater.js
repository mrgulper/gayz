// Moving water on the homepage road (2026-10-09, Gaymi: "can we also make
// the water on the road actually moving"). A canvas inside #menu-bg-photo
// (so it shares the photo's slow zoom/pan and the background mood filter)
// laid over the street with `mix-blend-mode: screen`. Only the water moves,
// never the road (2026-10-10, "the road is moving, just make the water
// move"): the photo itself stays still, and this canvas draws a soft,
// blurred copy of just the wet reflections (the bright sheen - the cobble
// edges are blurred away, so no stone ever shifts), a thin row at a time,
// each row nudged sideways and brightened by waves that travel down the
// road toward the viewer. Clipped to the street (FLOOR in MenuRain.js, the
// same shape the rain lands on), calm far up the road and stronger near
// the bottom, a little stronger while it's raining hard
// (rainState.intensity). The picture is whatever the photo's own CSS
// background is, so it follows the theme. Same rules as the rain: only
// draws while the homepage is on screen and the tab is visible, nothing
// under prefers-reduced-motion.
import { FLOOR, pictureBox, rainState } from './MenuRain.js'

// Height of each redrawn row (CSS px) - small enough that the waves look
// smooth, big enough to keep the draw calls down.
const ROW_PX = 2
// Sideways sway (CSS px) far up the road and at the very bottom.
const SWAY_FAR = 0.4
const SWAY_NEAR = 5
// Extra sway in a downpour (times the above).
const SWAY_RAIN = 0.6
// How fast the waves run down the road (radians/s) and how close together
// they are (radians per CSS px, scaled by perspective).
const FLOW_SPEED = 2.4
const WAVE_FREQ = 0.075
const MAX_PIXEL_RATIO = 1.5
// The reflections layer: blur (image px) that wipes out the cobble edges,
// the brightness range that counts as wet sheen, and how strongly the
// moving copy shows (calm / on a wave crest).
const SHEEN_BLUR = 5
const SHEEN_LOW = 0.3
const SHEEN_HIGH = 0.75
const SHEEN_ALPHA = 0.18
const SHEEN_CREST = 0.5
// How often to check whether the theme changed the photo.
const SOURCE_CHECK_MS = 1000

export function startMenuWater(canvas) {
  if (!canvas || !canvas.getContext) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const ctx = canvas.getContext('2d')
  const photo = canvas.parentElement
  if (!ctx || !photo) return

  let w = 0
  let h = 0
  let img = null
  let imgUrl = ''
  let lastCheck = -Infinity

  function checkSource(now) {
    if (now - lastCheck < SOURCE_CHECK_MS) return
    lastCheck = now
    const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(photo).backgroundImage || '')
    const url = m ? m[1] : ''
    if (url === imgUrl) return
    imgUrl = url
    img = null
    if (!url) return
    const next = new Image()
    next.onload = () => {
      if (imgUrl === url) img = makeSheen(next)
    }
    next.src = url
  }

  // A blurred copy of the photo that keeps only its bright, wet parts
  // (alpha from brightness), so moving it moves the water's shine and
  // nothing else.
  function makeSheen(src) {
    const c = document.createElement('canvas')
    c.width = src.naturalWidth
    c.height = src.naturalHeight
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return null
    g.filter = `blur(${SHEEN_BLUR}px)`
    g.drawImage(src, 0, 0)
    g.filter = 'none'
    const data = g.getImageData(0, 0, c.width, c.height)
    const px = data.data
    for (let i = 0; i < px.length; i += 4) {
      const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
      const k = Math.min(1, Math.max(0, (lum - SHEEN_LOW) / (SHEEN_HIGH - SHEEN_LOW)))
      px[i + 3] = Math.round(255 * k * k * (3 - 2 * k))
    }
    g.putImageData(data, 0, 0)
    return c
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  function frame(now) {
    requestAnimationFrame(frame)
    if (document.hidden || canvas.offsetParent === null) return
    if (canvas.clientWidth !== w || canvas.clientHeight !== h) resize()
    checkSource(now)
    if (!w || !h || !img) return

    const box = pictureBox(w, h)
    const horizonY = box.y + FLOOR.horizon * box.h
    const edgeY = box.y + FLOOR.edgeY * box.h
    const farL = box.x + FLOOR.left * box.w
    const farR = box.x + FLOOR.right * box.w
    const t = now / 1000
    const rain = 1 + SWAY_RAIN * rainState.intensity
    const scale = img.height / box.h

    ctx.clearRect(0, 0, w, h)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(0, edgeY)
    ctx.lineTo(farL, horizonY)
    ctx.lineTo(farR, horizonY)
    ctx.lineTo(w, edgeY)
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.clip()
    const top = Math.max(0, Math.floor(horizonY))
    for (let y = top; y < h; y += ROW_PX) {
      // 0 at the far end of the road, 1 at the bottom of the screen.
      const depth = Math.min(1, (y - horizonY) / Math.max(1, h - horizonY))
      // Waves bunch up in the distance and spread out up close.
      const phase = (y - horizonY) * WAVE_FREQ / (0.25 + depth) - t * FLOW_SPEED
      const sway = (SWAY_FAR + (SWAY_NEAR - SWAY_FAR) * depth * depth) * rain
      const dx = sway * (Math.sin(phase) + 0.45 * Math.sin(phase * 2.3 + t * 1.3 + y * 0.013))
      ctx.globalAlpha = SHEEN_ALPHA + (SHEEN_CREST - SHEEN_ALPHA) * (0.5 + 0.5 * Math.sin(phase)) * Math.min(1, depth * 2)
      const sy = (y - box.y) * scale
      ctx.drawImage(img, 0, sy, img.width, ROW_PX * scale, box.x + dx, y, box.w, ROW_PX)
    }
    ctx.restore()
  }

  resize()
  window.addEventListener('resize', resize)
  requestAnimationFrame(frame)
}
