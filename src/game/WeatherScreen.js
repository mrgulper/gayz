// What extreme weather does to your view (2026-10-30, Gaymi: "Heatwaves
// and extreme cold snaps/wind chills only in extremely bad weather for
// these weathers add effects like warm or cold could add frost to the edge
// of the player screen"). Owned by BuildSky; one layer over the game view
// (under the HUD), clicks pass through.
//
// - frost: ice crystals growing in from the screen's edges and corners, a
//   cold blue tint at the rim (cold snaps, blizzards, ice storms).
// - heat: a warm glow and a shimmering haze over the lower half, like air
//   over hot ground (heatwaves, droughts, close to a fire or a volcano).
// - gas: the view goes grey-green and dark at the edges - breathing the
//   gas from a lake's eruption (Disasters.js).
// - smoke: a brown-orange haze when a fire is close.
// Each eases in and out; the frost picture is drawn once, the first time
// it's needed.

const EASE = 0.5 // per second
const KEYS = ['frost', 'heat', 'gas', 'smoke']

// Frost crystals: from points along the edges, feathery branches that
// split at 60 degrees (like real ice) a few times, growing inward - thick
// at the rim, thinning out, leaving the middle of the view clear. All the
// strokes of one size go in one path (drawing them one by one was slow).
function drawFrost(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.lineCap = 'round'
  const k = w / 1280 // sizes are for a 1280-wide picture
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()]
  const branch = (x, y, ang, len, depth) => {
    if (depth <= 0 || len < 2) return
    const steps = 3
    let px = x
    let py = y
    for (let i = 0; i < steps; i++) {
      const a = ang + (Math.random() - 0.5) * 0.3
      const nx = px + Math.cos(a) * (len / steps)
      const ny = py + Math.sin(a) * (len / steps)
      paths[depth - 1].moveTo(px, py)
      paths[depth - 1].lineTo(nx, ny)
      if (Math.random() < 0.4) branch(nx, ny, a + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 3, len * 0.4, depth - 1)
      px = nx
      py = ny
    }
    if (Math.random() < 0.6) branch(px, py, ang + (Math.random() - 0.5) * 0.6, len * 0.55, depth - 1)
  }
  for (let i = 0; i < 110; i++) {
    const side = i % 4
    const t = Math.random()
    const x = side === 0 ? 0 : side === 1 ? w : t * w
    const y = side === 2 ? 0 : side === 3 ? h : t * h
    // Pointing inward; longer in the corners, where frost grows thickest.
    const inward = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2
    const corner = Math.min(t, 1 - t) < 0.18 ? 1.5 : 1
    branch(x, y, inward + (Math.random() - 0.5) * 1.2, (30 + Math.random() * 70) * corner * k, 5)
  }
  for (let d = 0; d < 5; d++) {
    g.strokeStyle = `rgba(235, 246, 255, ${0.18 + 0.12 * d})`
    g.lineWidth = (0.5 + d * 0.45) * k * 2
    g.stroke(paths[d])
  }
  // A soft frosted rim under the crystals.
  const rim = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.55)
  rim.addColorStop(0, 'rgba(220, 238, 255, 0)')
  rim.addColorStop(0.7, 'rgba(220, 238, 255, 0.1)')
  rim.addColorStop(1, 'rgba(225, 242, 255, 0.5)')
  g.globalCompositeOperation = 'destination-over'
  g.fillStyle = rim
  g.fillRect(0, 0, w, h)
  // Clear the middle so you can still see (an oval, the screen's shape).
  g.globalCompositeOperation = 'destination-out'
  g.save()
  g.translate(w / 2, h / 2)
  g.scale(w / h, 1)
  const hole = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.5)
  hole.addColorStop(0, 'rgba(0, 0, 0, 1)')
  hole.addColorStop(0.6, 'rgba(0, 0, 0, 1)')
  hole.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = hole
  g.fillRect(-h, -h, h * 2, h * 2)
  g.restore()
  return c
}

export class WeatherScreen {
  constructor() {
    this.goal = { frost: 0, heat: 0, gas: 0, smoke: 0 }
    this.now = { frost: 0, heat: 0, gas: 0, smoke: 0 }
    this._el = null
  }

  _ensure() {
    if (this._el) return
    const el = document.createElement('div')
    el.id = 'weather-screen'
    el.setAttribute('aria-hidden', 'true')
    el.innerHTML = KEYS.map((k) => `<div class="ws-${k}"></div>`).join('')
    document.body.appendChild(el)
    this._el = el
    this._layers = {}
    for (const k of KEYS) this._layers[k] = el.querySelector(`.ws-${k}`)
  }

  set(goal) {
    for (const k of KEYS) this.goal[k] = Math.max(0, Math.min(1, goal[k] || 0))
  }

  update(dt, on) {
    let any = false
    for (const k of KEYS) {
      const goal = on ? this.goal[k] : 0
      this.now[k] += (goal - this.now[k]) * Math.min(1, dt * EASE)
      if (this.now[k] < 0.004 && goal === 0) this.now[k] = 0
      if (this.now[k] > 0) any = true
    }
    if (!any && !this._el) return
    this._ensure()
    if (this.now.frost > 0 && !this._frostDrawn) {
      // Drawn small and stretched (it's soft anyway) and shown as the
      // canvas itself - a big picture was a noticeable hitch on phones.
      this._frostDrawn = true
      const pic = drawFrost(640, 400)
      pic.className = 'ws-frost-pic'
      this._layers.frost.appendChild(pic)
    }
    this._el.style.display = any ? 'block' : 'none'
    for (const k of KEYS) {
      const v = this.now[k].toFixed(3)
      if (this._layers[k].dataset.v !== v) {
        this._layers[k].dataset.v = v
        this._layers[k].style.opacity = v
      }
    }
  }

  clear() {
    for (const k of KEYS) this.goal[k] = this.now[k] = 0
    if (this._el) this._el.style.display = 'none'
  }
}
