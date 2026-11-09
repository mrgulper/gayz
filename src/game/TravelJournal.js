// The travel journal on the map (2026-11-09, Gaymi's world-map list 2: "a
// skull where you died, a chest icon where you found loot, and your trail
// coloured by game day").
//
// World Map mode only, drawn on the flat map (not the globe) over the fog.
// - Trail: a point every TRAIL_STEP blocks you walk, coloured by the
//   journal's day. The day goes up each time the sky's day changes and
//   with each new game (a new trip), so every day gets its own colour.
//   A jump (fast travel, respawn) breaks the line instead of drawing
//   across the world.
// - Skull: where you died. Chest: where you opened a Loot Chest.
// Kept on this device (localStorage), saved a few seconds after a change,
// never every frame. The oldest go first past the caps.
const KEY = 'gayz-world-journal-v1'
const TRAIL_STEP = 12
const MAX_TRAIL = 6000
const MAX_MARKS = 60
const SAVE_AFTER_S = 8
// A gap this big between two points is a jump, not a walk.
const JUMP = TRAIL_STEP * 4
const LIM = 1e5

const int = (v) => (Number.isFinite(v) && Math.abs(v) < LIM ? Math.round(v) : null)

// A day's colour: hues spread round the wheel so neighbours differ.
export const dayColor = (day) => `hsl(${(day * 137) % 360}, 90%, 58%)`

class Journal {
  constructor() {
    this.trail = null // [x, z, day, break-before]
    this.skulls = []
    this.chests = []
    this.day = 1
    this._skyDay = null
    this._dirty = false
    this._saveIn = 0
    this._last = null
  }

  _load() {
    if (this.trail) return
    this.trail = []
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (raw && typeof raw === 'object') {
        this.day = Math.max(1, Math.min(1e6, Math.floor(Number(raw.day) || 1)))
        for (const part of String(raw.t || '').split(';')) {
          const [x, z, d, b] = part.split(',').map(Number)
          if (int(x) !== null && int(z) !== null && d >= 1 && d <= 1e6) this.trail.push([int(x), int(z), Math.floor(d), b ? 1 : 0])
        }
        const marks = (list) => (Array.isArray(list) ? list : []).map((m) => (Array.isArray(m) ? [int(m[0]), int(m[1])] : null)).filter((m) => m && m[0] !== null && m[1] !== null).slice(-MAX_MARKS)
        this.skulls = marks(raw.k)
        this.chests = marks(raw.c)
      }
    } catch {
      this.trail = []
    }
    this.trail = this.trail.slice(-MAX_TRAIL)
  }

  _changed() {
    if (!this._dirty) this._saveIn = SAVE_AFTER_S
    this._dirty = true
  }

  save() {
    if (!this._dirty || !this.trail) return
    this._dirty = false
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, day: this.day, t: this.trail.map((p) => p.join(',')).join(';'), k: this.skulls, c: this.chests }))
    } catch {
      // Storage full or blocked: the journal still shows this visit.
    }
  }

  // A new game is a new trip: a new day colour, and no line from where
  // the last one ended.
  newTrip() {
    this._load()
    this.day++
    this._skyDay = null
    this._last = null
    this._changed()
  }

  // Fast travel / respawn: the next point starts a new line.
  jumped() {
    this._last = null
  }

  // Each frame in World Map mode: your body (blocks) and the sky's day
  // number (null when the sky doesn't cycle).
  update(x, z, skyDay, dt) {
    this._load()
    if (skyDay !== null && skyDay !== this._skyDay) {
      if (this._skyDay !== null) {
        this.day++
        this._changed()
      }
      this._skyDay = skyDay
    }
    const last = this._last
    if (!last || Math.hypot(x - last[0], z - last[1]) >= TRAIL_STEP) {
      const brk = !last || Math.hypot(x - last[0], z - last[1]) > JUMP ? 1 : 0
      const p = [Math.round(x), Math.round(z), this.day, brk]
      this.trail.push(p)
      if (this.trail.length > MAX_TRAIL) this.trail.splice(0, this.trail.length - MAX_TRAIL)
      this._last = p
      this._changed()
    }
    if (this._dirty && (this._saveIn -= dt) <= 0) this.save()
  }

  died(x, z) {
    this._load()
    this.skulls.push([Math.round(x), Math.round(z)])
    if (this.skulls.length > MAX_MARKS) this.skulls.shift()
    this._last = null
    this._changed()
    this.save()
  }

  loot(x, z) {
    this._load()
    // The same chest again (or one right beside it) isn't a new mark.
    if (this.chests.some((c) => Math.abs(c[0] - x) < 3 && Math.abs(c[1] - z) < 3)) return
    this.chests.push([Math.round(x), Math.round(z)])
    if (this.chests.length > MAX_MARKS) this.chests.shift()
    this._changed()
  }

  // On the flat map: the view's top-left (ox, oz), width `span` blocks, k
  // canvas pixels a block, canvas size s.
  draw(ctx, ox, oz, span, k, s) {
    this._load()
    const pad = span * 0.05
    const inView = (x, z) => x > ox - pad && x < ox + span + pad && z > oz - pad && z < oz + span + pad
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Thin when zoomed far out, thicker close up.
    const w = Math.max(1.5, Math.min(4, s / 140))
    const tr = this.trail
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1]
      const b = tr[i]
      if (b[3] || (!inView(a[0], a[1]) && !inView(b[0], b[1]))) continue
      // Dark edge under the colour, so it shows on any ground.
      ctx.beginPath()
      ctx.moveTo((a[0] - ox) * k, (a[1] - oz) * k)
      ctx.lineTo((b[0] - ox) * k, (b[1] - oz) * k)
      ctx.strokeStyle = 'rgba(10, 8, 4, 0.55)'
      ctx.lineWidth = w + 2
      ctx.stroke()
      ctx.strokeStyle = dayColor(b[2])
      ctx.lineWidth = w
      ctx.stroke()
    }
    const r = Math.max(5, s / 48)
    for (const [x, z] of this.chests) if (inView(x, z)) drawChest(ctx, (x - ox) * k, (z - oz) * k, r)
    for (const [x, z] of this.skulls) if (inView(x, z)) drawSkull(ctx, (x - ox) * k, (z - oz) * k, r)
    ctx.restore()
  }
}

function drawSkull(ctx, x, y, r) {
  ctx.lineWidth = Math.max(1.2, r / 5)
  ctx.strokeStyle = '#1a1408'
  ctx.fillStyle = '#f2eee2'
  ctx.beginPath()
  ctx.arc(x, y - r * 0.15, r * 0.8, Math.PI, 0)
  ctx.lineTo(x + r * 0.8, y + r * 0.25)
  ctx.lineTo(x + r * 0.45, y + r * 0.35)
  ctx.lineTo(x + r * 0.45, y + r * 0.75)
  ctx.lineTo(x - r * 0.45, y + r * 0.75)
  ctx.lineTo(x - r * 0.45, y + r * 0.35)
  ctx.lineTo(x - r * 0.8, y + r * 0.25)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#1a1408'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(x + side * r * 0.32, y - r * 0.08, r * 0.22, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawChest(ctx, x, y, r) {
  ctx.lineWidth = Math.max(1.2, r / 5)
  ctx.strokeStyle = '#1a1408'
  ctx.fillStyle = '#9a5a24'
  ctx.fillRect(x - r * 0.85, y - r * 0.55, r * 1.7, r * 1.2)
  ctx.strokeRect(x - r * 0.85, y - r * 0.55, r * 1.7, r * 1.2)
  ctx.beginPath()
  ctx.moveTo(x - r * 0.85, y - r * 0.1)
  ctx.lineTo(x + r * 0.85, y - r * 0.1)
  ctx.stroke()
  ctx.fillStyle = '#ffcf3a'
  ctx.fillRect(x - r * 0.18, y - r * 0.25, r * 0.36, r * 0.36)
}

export const journal = new Journal()
// Leaving the page before the next save: keep the last few seconds too.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => journal.save())
