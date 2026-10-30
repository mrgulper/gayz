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
// split and split again, growing inward - thick at the rim, thinning out.
function drawFrost(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.lineCap = 'round'
  const branch = (x, y, ang, len, width, depth) => {
    if (depth <= 0 || len < 3) return
    const steps = 4
    let px = x
    let py = y
    for (let i = 0; i < steps; i++) {
      const a = ang + (Math.random() - 0.5) * 0.35
      const nx = px + Math.cos(a) * (len / steps)
      const ny = py + Math.sin(a) * (len / steps)
      g.strokeStyle = `rgba(235, 246, 255, ${0.16 + 0.1 * depth})`
      g.lineWidth = width
      g.beginPath()
      g.moveTo(px, py)
      g.lineTo(nx, ny)
      g.stroke()
      // Ice grows at 60 degrees: side shoots both ways.
      if (Math.random() < 0.55) branch(nx, ny, a + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 3, len * 0.45, width * 0.7, depth - 1)
      px = nx
      py = ny
    }
    branch(px, py, ang + (Math.random() - 0.5) * 0.7, len * 0.6, width * 0.75, depth - 1)
  }
  const edgeSeeds = 150
  for (let i = 0; i < edgeSeeds; i++) {
    const side = i % 4
    const t = Math.random()
    const x = side === 0 ? 0 : side === 1 ? w : t * w
    const y = side === 2 ? 0 : side === 3 ? h : t * h
    // Pointing inward (more toward the corners where it's thickest).
    const inward = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2
    const corner = Math.min(t, 1 - t) < 0.18 ? 1.6 : 1
    branch(x, y, inward + (Math.random() - 0.5) * 1.3, (40 + Math.random() * 90) * corner, 2.2, 5)
  }
  // A soft frosted rim under the crystals.
  const rim = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) * 0.55)
  rim.addColorStop(0, 'rgba(220, 238, 255, 0)')
  rim.addColorStop(0.7, 'rgba(220, 238, 255, 0.12)')
  rim.addColorStop(1, 'rgba(225, 242, 255, 0.55)')
  g.globalCompositeOperation = 'destination-over'
  g.fillStyle = rim
  g.fillRect(0, 0, w, h)
  // Clear the middle so you can still see.
  g.globalCompositeOperation = 'destination-out'
  const hole = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.55)
  hole.addColorStop(0, 'rgba(0, 0, 0, 1)')
  hole.addColorStop(0.55, 'rgba(0, 0, 0, 0.85)')
  hole.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.fillStyle = hole
  g.fillRect(0, 0, w, h)
  return c.toDataURL('image/png')
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
      this._frostDrawn = true
      this._layers.frost.style.backgroundImage = `url(${drawFrost(1280, 800)})`
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
