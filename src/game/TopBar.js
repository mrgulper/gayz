// The bar along the very top of the screen in the Map Editor and Map 1
// (2026-10-17, bloxd.io's look): GayZ | game mode | FPS | x y z. It takes
// the place of the green debug line there - that line is still written
// (Game.js) and shows as this bar's FPS tooltip, but is hidden in-game.
import { t } from './i18n.js'

const MODE_KEYS = {
  classic: 'topBarModeClassic',
  zombieDefense: 'topBarModeZombieDefense',
  bossHunt: 'topBarModeBossHunt',
  zombieRush: 'topBarModeZombieRush',
  zombieExtraction: 'topBarModeZombieExtraction',
}
// Coordinates and the mode are refreshed this often (ms), not every frame.
const REFRESH_MS = 100

export class TopBar {
  constructor(game) {
    this.game = game
    const el = document.createElement('div')
    el.id = 'top-bar'
    el.innerHTML = `
      <span class="top-bar-part top-bar-name">GayZ</span>
      <span class="top-bar-part" id="top-bar-mode"></span>
      <span class="top-bar-part" id="top-bar-fps"><span class="top-bar-label">FPS</span> <span id="top-bar-fps-n">--</span></span>
      <span class="top-bar-part" id="top-bar-xyz"></span>`
    document.body.appendChild(el)
    this.el = el
    this._mode = el.querySelector('#top-bar-mode')
    this._fpsPart = el.querySelector('#top-bar-fps')
    this._fps = el.querySelector('#top-bar-fps-n')
    this._xyz = el.querySelector('#top-bar-xyz')
    this._at = 0
    this._text = { mode: '', xyz: '' }
  }

  // Every half second from Game.js's fps count.
  setFps(fps, detail) {
    this._fps.textContent = String(fps)
    this._fpsPart.title = detail || ''
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
    this._fpsPart.style.display = s.hudFpsCounter === false || s.streamSafeMode ? 'none' : ''
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
