// The bar along the very top of the screen in the Map Editor and Map 1
// (2026-10-17): GayZ | game mode | FPS | ms | x y z | chip + CPU cores
// (2026-10-18, "write the cpu of the device after the coordinates"). It takes
// the place of the green debug line there - that line is still written
// (Game.js) and shows as this bar's FPS tooltip, but is hidden in-game.
import { t } from './i18n.js'

const MODE_KEYS = {
  classic: 'topBarModeClassic',
  zombieDefense: 'topBarModeZombieDefense',
  bossHunt: 'topBarModeBossHunt',
  zombieRush: 'topBarModeZombieRush',
  zombieExtraction: 'topBarModeZombieExtraction',
  worldMap: 'topBarModeWorldMap',
}
// Coordinates and the mode are refreshed this often (ms), not every frame.
const REFRESH_MS = 100

// A short name for the graphics chip from WebGL's renderer string, e.g.
// "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" ->
// "Apple M2", "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 ...)" ->
// "Intel UHD Graphics 620".
export function chipName(gpu) {
  if (!gpu || gpu === 'unknown') return ''
  let s = String(gpu)
  const angle = /^ANGLE \((.*)\)$/.exec(s)
  if (angle) {
    const parts = angle[1].split(', ')
    s = parts[1] || parts[0]
  }
  s = s.replace(/^ANGLE \S+ Renderer: /, '')
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\s+(Direct3D|D3D|vs_|ps_|OpenGL|Metal|Vulkan|\(0x).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > 28 ? `${s.slice(0, 27)}…` : s
}

export class TopBar {
  constructor(game) {
    this.game = game
    const el = document.createElement('div')
    el.id = 'top-bar'
    el.innerHTML = `
      <span class="top-bar-part top-bar-name">GayZ</span>
      <span class="top-bar-part" id="top-bar-mode"></span>
      <span class="top-bar-part" id="top-bar-fps"><span class="top-bar-label">FPS</span> <span id="top-bar-fps-n">--</span></span>
      <span class="top-bar-part" id="top-bar-ms"><span class="top-bar-label">MS</span> <span id="top-bar-ms-n">--</span></span>
      <span class="top-bar-part" id="top-bar-xyz"></span>
      <span class="top-bar-part" id="top-bar-chip"></span>`
    document.body.appendChild(el)
    this.el = el
    this._mode = el.querySelector('#top-bar-mode')
    this._fpsPart = el.querySelector('#top-bar-fps')
    this._fps = el.querySelector('#top-bar-fps-n')
    this._ms = el.querySelector('#top-bar-ms-n')
    this._chip = el.querySelector('#top-bar-chip')
    this._chipFrom = null
    this._xyz = el.querySelector('#top-bar-xyz')
    this._at = 0
    this._text = { mode: '', xyz: '' }
  }

  // Every half second from Game.js's fps count: frames per second, how
  // long a frame takes (ms), and the device's graphics chip (2026-10-17,
  // Gaymi: "add the ms beside the fps also the cpu the device is using
  // like before" - the old green line showed the same chip name).
  setFps(fps, detail, ms, gpu) {
    this._fps.textContent = String(fps)
    this._fpsPart.title = detail || ''
    if (ms !== undefined) this._ms.textContent = String(ms)
    if (gpu !== this._chipFrom) {
      this._chipFrom = gpu
      // Browsers only tell a page the graphics chip's name and how many CPU
      // cores there are - never the CPU's own model. On Apple chips (M1-M4)
      // the CPU and graphics are the same chip, so the name is the CPU's too.
      const name = chipName(gpu)
      const cores = navigator.hardwareConcurrency
      const text = [name, cores ? t('topBarCores', { n: cores }) : ''].filter(Boolean).join(' · ')
      this._chip.textContent = text
      this._chip.style.display = text ? '' : 'none'
      this._chip.title = gpu || ''
    }
  }

  // Every frame in the Map Editor / Map 1 (cheap: only writes when a
  // shown value changed, at most every REFRESH_MS).
  update(now) {
    const game = this.game
    const bm = game.buildMode
    const show = !!bm?.active && !bm.menuOpen
    this.el.style.display = show ? 'flex' : 'none'
    if (!show || now - this._at < REFRESH_MS) return
    this._at = now
    const s = game.settings || {}
    const perf = s.hudFpsCounter === false || s.streamSafeMode ? 'none' : ''
    this._fpsPart.style.display = perf
    this._ms.parentElement.style.display = perf
    if (this._chip.textContent) this._chip.style.display = perf
    const play = bm.survival?.active
    const mode = play ? t(MODE_KEYS[bm.survival.cfg?.mode] || 'topBarModeClassic') : bm.tryMode?.active ? t('topBarModeTry') : t('topBarModeEditor')
    if (mode !== this._text.mode) this._mode.textContent = this._text.mode = mode
    const B = bm.tryMode?.B || 1
    const p = bm.tryMode?.active ? bm.tryMode.pos : bm.camera ? { x: bm.camera.position.x / B, y: bm.camera.position.y / B, z: bm.camera.position.z / B } : null
    // (+ 0 turns -0 into 0, so it never reads "-0.00".)
    const n = (v) => (Math.round(v * 100) / 100 + 0).toFixed(2)
    const xyz = p ? `${n(p.x)}  ${n(p.y)}  ${n(p.z)}` : ''
    if (xyz !== this._text.xyz) this._xyz.textContent = this._text.xyz = xyz
  }

  hide() {
    this.el.style.display = 'none'
  }
}
