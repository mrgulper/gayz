// Settings > Graphics > Effects (ideas 39-50 of the 2026-11-11 settings
// list, docs/notes/ui-and-menu/settings-ideas-todo.md). The rows
// come from MoreSettingsList.js; this file is what they do:
//   - small readers the game asks every time it needs one (shakeScale,
//     particleKeep, grassOn, cloudsOn, weatherOn, handFov), so a change
//     shows at once, with nothing to undo;
//   - blood (bleed): a splash of drops on a hit - green goo for zombies,
//     red for animals and you (Gaymi's pick), all goo, or none;
//   - the zombie outline behind walls (drawZombieOutlines, from
//     BuildMode.render): solo games only, so nobody gets wall vision on a
//     server;
//   - gamma / saturation / sharpen: added to the canvas's CSS filter
//     (SettingsUI._applyGraphicsFilters reads graphicsFilterCss);
//   - Battery Saver: 30 fps and 75% resolution; Auto turns it on by
//     itself when the battery is at 20% or less and not charging, with a
//     message saying so.
import * as THREE from 'three'
import { t } from './i18n.js'

let game = null
const S = () => game?.settings

export function bindGraphicsSettings(g) {
  game = g
  watchBattery()
}

// ---------- the readers ----------

// Screen Shake: 0 = none, 1 = normal, 2 = double.
export function shakeScale() {
  const v = Number(S()?.screenShake)
  return Number.isFinite(v) ? v / 100 : 1
}

// Particle Amount: the share of effect particles that are made.
const KEEP = { low: 0.3, medium: 0.6, high: 1 }
export function particleKeep() {
  const keep = KEEP[S()?.particleAmount] ?? 1
  return batteryActive() ? Math.min(keep, KEEP.medium) : keep
}

export const grassOn = () => S()?.grassTufts !== false
export const cloudsOn = () => S()?.cloudsEnabled !== false
export const weatherOn = () => S()?.weatherEffects !== false

// Hand / Weapon FOV (degrees, how wide the hand-and-gun picture is).
export function handFov() {
  const v = Number(S()?.handFov)
  return Number.isFinite(v) && v > 0 ? v : 70
}

// ---------- blood ----------

const GOO = 0x6fbf3a
const RED = 0x9c1010
const BLEED_GAP = 0.15 // seconds: the most often one thing bleeds

// kind: 'zombie' or 'red' (animals, you). null = no blood.
export function bloodColor(kind) {
  const style = S()?.bloodStyle || 'normal'
  if (style === 'off') return null
  if (style === 'goo') return GOO
  return kind === 'zombie' ? GOO : RED
}

// thing: anything that can remember when it last bled (a zombie, an
// animal, the survival game for you); x, y, z in blocks; size 0..1+.
export function bleed(fx, thing, kind, x, y, z, size = 1) {
  if (!fx || !thing) return
  const color = bloodColor(kind)
  if (color == null) return
  const now = performance.now() / 1000
  if (thing._bledAt && now - thing._bledAt < BLEED_GAP) return
  thing._bledAt = now
  fx.blood(x * fx.B, y * fx.B, z * fx.B, color, size)
}

// ---------- the zombie outline ----------

const OUTLINE_LAYER = 7
const OUTLINE_RANGE = 48 // blocks
const OUTLINE_CHECK = 0.2 // seconds between line-of-sight checks
let outlineMat = null
let checkIn = 0
let lastCheck = 0
const hidden = new Set()

export function outlineAllowed(s) {
  return !!(S()?.zombieOutline && s?.active && !s.net && s.bm?.tryMode?.active)
}

// Is there a block between the camera (world units) and a spot (blocks)?
function blocked(bm, from, x, y, z) {
  const dx = x - from.x
  const dy = y - from.y
  const dz = z - from.z
  const len = Math.hypot(dx, dy, dz)
  const steps = Math.floor(len / 0.5)
  for (let i = 2; i < steps - 1; i++) {
    const k = i / steps
    if (bm.getBlockAt(Math.floor(from.x + dx * k), Math.floor(from.y + dy * k), Math.floor(from.z + dz * k))) return true
  }
  return false
}

function setLayer(z, on) {
  z.group?.traverse((o) => {
    if (!o.isMesh) return
    if (on) o.layers.enable(OUTLINE_LAYER)
    else o.layers.disable(OUTLINE_LAYER)
  })
}

// Called right after the world is drawn (same camera, shake and all):
// zombies hidden behind blocks are drawn again on top as a see-through
// red shape. A zombie in plain view gets none.
export function drawZombieOutlines(bm) {
  const s = bm.survival
  if (!outlineAllowed(s)) {
    if (hidden.size) hidden.clear()
    return
  }
  const cam = bm.camera
  const B = s.B
  const now = performance.now() / 1000
  checkIn -= Math.min(0.1, now - lastCheck)
  lastCheck = now
  if (checkIn <= 0) {
    checkIn = OUTLINE_CHECK
    hidden.clear()
    const from = { x: cam.position.x / B, y: cam.position.y / B, z: cam.position.z / B }
    for (const z of s.zombies) {
      if (!z.group || z.health <= 0) continue
      if (Math.hypot(z.x - from.x, z.z - from.z) > OUTLINE_RANGE) continue
      const h = s.zombieHeight * (z.size || 1) * (z.tall || 1)
      // Hidden only if both its head and its middle are behind something.
      if (blocked(bm, from, z.x, z.y + h * 0.85, z.z) && blocked(bm, from, z.x, z.y + h * 0.45, z.z)) hidden.add(z)
    }
  }
  if (!hidden.size) return
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, fog: false })
  }
  const list = [...hidden].filter((z) => s.zombies.includes(z))
  for (const z of list) setLayer(z, true)
  const r = bm.renderer
  const scene = bm.scene
  const bg = scene.background
  const over = scene.overrideMaterial
  const mask = cam.layers.mask
  const autoClear = r.autoClear
  scene.background = null
  scene.overrideMaterial = outlineMat
  cam.layers.set(OUTLINE_LAYER)
  r.autoClear = false
  try {
    r.render(scene, cam)
  } finally {
    r.autoClear = autoClear
    cam.layers.mask = mask
    scene.overrideMaterial = over
    scene.background = bg
    for (const z of list) setLayer(z, false)
  }
}

// ---------- gamma / saturation / sharpen ----------

let svgFilter = null

function ensureSvgFilter() {
  if (svgFilter) return svgFilter
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.position = 'absolute'
  svg.innerHTML = '<filter id="gfx-post" color-interpolation-filters="sRGB">'
    + '<feComponentTransfer id="gfx-post-gamma"><feFuncR type="gamma" amplitude="1" exponent="1" offset="0"/><feFuncG type="gamma" amplitude="1" exponent="1" offset="0"/><feFuncB type="gamma" amplitude="1" exponent="1" offset="0"/></feComponentTransfer>'
    + '<feConvolveMatrix id="gfx-post-sharpen" order="3" kernelMatrix="0 0 0 0 1 0 0 0 0" preserveAlpha="true"/>'
    + '</filter>'
  document.body.appendChild(svg)
  svgFilter = svg
  return svg
}

// The extra part of the canvas's CSS filter ('' at the defaults, so the
// browser skips the filter pass).
export function graphicsFilterCss(set) {
  const gamma = Number(set?.gamma ?? 100)
  const sat = Number(set?.saturation ?? 100)
  const sharp = Number(set?.sharpen ?? 0)
  const parts = []
  if (sat !== 100) parts.push(`saturate(${sat}%)`)
  if (gamma !== 100 || sharp > 0) {
    const svg = ensureSvgFilter()
    // Gamma above 100% lifts the darks: out = in ^ (1 / gamma).
    const exp = String(100 / Math.max(10, gamma))
    for (const f of svg.querySelectorAll('#gfx-post-gamma > *')) f.setAttribute('exponent', exp)
    const k = (sharp / 100) * 0.6
    svg.querySelector('#gfx-post-sharpen').setAttribute('kernelMatrix', `0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0`)
    parts.push('url(#gfx-post)')
  }
  return parts.join(' ')
}

// ---------- Battery Saver ----------

const SAVER_FPS = 30
const SAVER_RES = 0.75
const LOW_BATTERY = 0.2
let battery = null
let autoOn = false

export function batteryActive() {
  const mode = S()?.batterySaver
  if (mode === 'on') return true
  return mode === 'auto' && autoOn
}

// The FPS cap to use (ms per frame, 0 = none): the Graphics tab's own
// cap, or 30 while Battery Saver is on, whichever is lower.
export function fpsCapMs(g = game) {
  const cap = Number(g?.settings?.fpsCap) || 0
  const own = cap > 0 ? 1000 / cap : 0
  return batteryActive() ? Math.max(own, 1000 / SAVER_FPS) : own
}

export const batteryResScale = () => (batteryActive() ? SAVER_RES : 1)

// Battery Saver changed (or Auto just switched): cap + resolution again.
export function applyBatterySaver(g = game) {
  if (!g) return
  g._fpsCapMinFrameMs = fpsCapMs(g)
  g._applyRenderScale?.()
}

function checkBattery() {
  if (!battery) return
  const low = !battery.charging && battery.level <= LOW_BATTERY
  if (low === autoOn) return
  autoOn = low
  applyBatterySaver()
  if (low && S()?.batterySaver === 'auto') {
    game?._showHomepageToast?.(t('batterySaverAutoOn', { n: Math.round(battery.level * 100) }))
  }
}

function watchBattery() {
  if (battery || typeof navigator === 'undefined' || !navigator.getBattery) return
  navigator.getBattery().then((b) => {
    battery = b
    b.addEventListener('levelchange', checkBattery)
    b.addEventListener('chargingchange', checkBattery)
    checkBattery()
  }).catch(() => { /* this browser doesn't say */ })
}

// Tests: pretend the battery is at `level` (0..1).
export function _testBattery(level, charging = false) {
  battery = { level, charging }
  checkBattery()
}
