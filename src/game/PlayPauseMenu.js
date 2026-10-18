// The pause screen while playing a game from the homepage (2026-10-17,
// Gaymi: "when pressing escape ... redesign one with back to menu,
// settings, save progress, and leave game when playing in game dont make
// that map editor pop up thats only for when making maps"). Escape opens it
// through BuildMode.toggleMenu, which pauses the game the same way as
// before; the Map Editor's own pause screen (#build-menu) is only for
// making maps (and the editor's own Try Map / Play).
//
//   Back to Menu   - saves the run (BuildSurvival.saveRun) and goes to the
//                    homepage; the next Play carries on from it.
//   Settings       - the Settings panel over the game, then back here.
//   Switch Weapon  - the weapon picker (2026-10-17); picking a gun goes
//                    straight back to the game. Each gun keeps its own
//                    ammo (BuildSurvival._pickWeapon).
//   Spectate       - a free camera, or other players' eyes on a server
//                    (PlaySpectate.js, 2026-10-17); Escape comes back.
//   Save Progress  - saves the run and keeps playing.
//   Leave Game     - ends the run for good (it's counted, nothing is kept)
//                    and goes to the homepage.
// On a server there's nothing to save: Save Progress is hidden and Back to
// Menu just leaves, like Leave Game.
import { t } from './i18n.js'

export class PlayPauseMenu {
  constructor(bm) {
    this.bm = bm
    this.el = document.getElementById('play-pause-menu')
    this._fromSettings = false
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn)
    on('play-pause-close', () => {
      if (bm.menuOpen) bm.toggleMenu()
    })
    on('play-pause-back-btn', () => this._leave(true))
    on('play-pause-settings-btn', () => this.openSettings())
    on('play-pause-weapon-btn', () => this.switchWeapon())
    on('play-pause-spectate-btn', () => this.bm.spectate?.enter())
    on('play-pause-save-btn', () => this.saveProgress())
    on('play-pause-leave-btn', () => this._leave(false))
  }

  // A game from the homepage is being played, so Escape opens this
  // instead of the Map Editor's pause screen.
  get forGame() {
    const s = this.bm.survival
    return !!(s?.active && s.fromMenu)
  }

  get settingsOpen() {
    return this._fromSettings
  }

  show(on) {
    if (!this.el) return
    this.el.style.display = on ? 'flex' : 'none'
    if (on) this._refresh()
  }

  _refresh() {
    const s = this.bm.survival
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    set('play-pause-title', t('playPauseTitle'))
    set('play-pause-info', t('playPauseInfo', { wave: Math.max(1, s.wave), kills: s.kills }))
    set('play-pause-back-label', t('playPauseBack'))
    set('play-pause-settings-label', t('playPauseSettings'))
    set('play-pause-weapon-label', t('playPauseWeapon'))
    set('play-pause-spectate-label', t('playPauseSpectate'))
    set('play-pause-save-label', t('playPauseSave'))
    set('play-pause-leave-label', t('playPauseLeave'))
    set('play-pause-hint', t('playPauseHint'))
    set('play-pause-status', '')
    const save = document.getElementById('play-pause-save-btn')
    if (save) save.style.display = s.net ? 'none' : ''
  }

  saveProgress() {
    const s = this.bm.survival
    const ok = s.saveRun()
    const el = document.getElementById('play-pause-status')
    if (el) el.textContent = t(ok ? 'playPauseSaved' : 'playPauseSaveFailed', { n: Math.max(1, s.wave) })
    return ok
  }

  // The game stays paused while the picker is open (BuildSurvival.update
  // waits while _picking), except on a server, where the world goes on.
  switchWeapon() {
    const s = this.bm.survival
    if (!s?.active || s.dead) return
    this.bm.closeMenuQuietly()
    s._openWeaponPicker(true)
  }

  openSettings() {
    const game = this.bm.game
    if (!game?._toggleSettings) return
    this.show(false)
    this._fromSettings = true
    game._toggleSettings(true)
  }

  closeSettings() {
    this.bm.game?._toggleSettings?.(false)
    this.update()
  }

  // Every frame (BuildMode.update): once Settings is closed, back to this
  // menu.
  update() {
    if (!this._fromSettings || this.bm.game?.settingsOpen) return
    this._fromSettings = false
    if (this.bm.menuOpen) this.show(true)
  }

  _leave(keep) {
    const bm = this.bm
    const s = bm.survival
    const saved = keep && s.saveRun()
    bm.closeMenuQuietly()
    s.stop({ suspend: saved })
    bm.game?._exitBuildMode?.()
  }
}
