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
//   Invite Friends - a link friends open to join you (2026-10-18). A solo
//                    game becomes a server first, keeping its world
//                    (ServerBrowser.makeGameJoinable).
//   Save Progress  - saves the run and keeps playing.
//   Leave Game     - ends the run for good (it's counted, nothing is kept)
//                    and goes to the homepage.
// On a server there's nothing to save: Save Progress is hidden and Back to
// Menu just leaves, like Leave Game.
import { t } from './i18n.js'
import { inviteLink, makeGameJoinable, newServerId } from './ServerBrowser.js'

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
    on('play-pause-invite-btn', () => this.invite())
    on('play-invite-copy', () => this.copyInvite())
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
    set('play-pause-invite-label', t('playPauseInvite'))
    set('play-invite-copy', t('playInviteCopy'))
    set('play-invite-hint', t('playInviteHint'))
    set('play-pause-save-label', t('playPauseSave'))
    set('play-pause-leave-label', t('playPauseLeave'))
    set('play-pause-hint', t('playPauseHint'))
    set('play-pause-status', '')
    const save = document.getElementById('play-pause-save-btn')
    if (save) save.style.display = s.net ? 'none' : ''
    this._showInvite()
  }

  // The link box, once this game has a server (or is getting one: the
  // link shows straight away, made from the id it will have).
  _showInvite(id = null) {
    const s = this.bm.survival
    const box = document.getElementById('play-invite')
    const link = document.getElementById('play-invite-link')
    const serverId = s?.net && !s.net.closed ? s.net.serverId : id
    if (box) box.hidden = !serverId
    if (serverId && link) link.value = inviteLink(serverId)
  }

  // The link is there the moment you click (2026-10-18, Gaymi: "when
  // clicking it it should already have the ready instead of waiting a few
  // seconds"); the server is made in the background with that same id.
  async invite() {
    const s = this.bm.survival
    const status = document.getElementById('play-pause-status')
    if (!s?.active) return
    if (s.net && !s.net.closed) {
      this._showInvite()
      this.copyInvite()
      return
    }
    if (this._inviting) return
    this._inviting = true
    const id = newServerId()
    this._showInvite(id)
    this.copyInvite()
    const save = document.getElementById('play-pause-save-btn')
    if (save) save.style.display = 'none'
    try {
      const net = await makeGameJoinable(this.bm.game, s, id)
      // Rarely the id was taken and the server got another one.
      if (net.serverId !== id) {
        this._showInvite()
        this.copyInvite()
      }
    } catch {
      this._showInvite(null)
      if (save) save.style.display = ''
      if (status) status.textContent = t('playInviteFailed')
    } finally {
      this._inviting = false
    }
  }

  copyInvite() {
    const link = document.getElementById('play-invite-link')
    const status = document.getElementById('play-pause-status')
    if (!link?.value) return
    link.select()
    const done = () => { if (status) status.textContent = t('playInviteCopied') }
    try {
      navigator.clipboard.writeText(link.value).then(done, () => { document.execCommand?.('copy'); done() })
    } catch {
      done()
    }
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
