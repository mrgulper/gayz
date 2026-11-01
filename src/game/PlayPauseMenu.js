// The pause screen while playing a game from the homepage (2026-10-17,
// Gaymi: "when pressing escape ... redesign one with back to menu,
// settings, save progress, and leave game when playing in game dont make
// that map editor pop up thats only for when making maps"). Escape opens it
// through BuildMode.toggleMenu, which pauses the game the same way as
// before; the Map Editor's own pause screen (#build-menu) is only for
// making maps (and the editor's own Try Map / Play).
//
//   Back to Game   - closes the pause screen and carries on playing
//                    (2026-10-26, Gaymi: "change the back to menu to back
//                    to game just goes back to game because back to menu is
//                    same as leave game"; it used to save and go home).
//   Settings       - the Settings panel over the game, then back here.
//   Switch Weapon  - the weapon picker (2026-10-17); picking a gun goes
//                    straight back to the game. Each gun keeps its own
//                    ammo (BuildSurvival._pickWeapon).
//   Spectate       - a free camera, or other players' eyes on a server
//                    (PlaySpectate.js, 2026-10-17); Escape comes back.
//   Photo Mode     - the free camera with every button and bar hidden,
//                    the world frozen (alone - a server keeps going) and a
//                    click / P / the shutter button saving a picture
//                    (PlaySpectate.js, 2026-10-30).
//   Spray Paint    - draw your 16 x 16 spray tag (Sprays.js, 2026-11-01):
//                    the buttons make way for a drawing pad, a row of
//                    paints (the first is the eraser), Clear and Done.
//                    Done (or closing the pause screen) keeps it.
//   Invite Friends - a link friends open to join you (2026-10-18). A solo
//                    game becomes a server first, keeping its world
//                    (ServerBrowser.makeGameJoinable).
//   Save Progress  - saves the run and keeps playing.
//   Leave Game     - ends the run for good (it's counted, nothing is kept)
//                    and goes to the homepage.
// On a server there's nothing to save: Save Progress is hidden.
import { t } from './i18n.js'
import { sillyTip } from './SillyTips.js'
import { inviteLink, makeGameJoinable, newServerId } from './ServerBrowser.js'
import { SPRAY_SIZE, SPRAY_COLORS, loadSpray, saveSpray, sprayCanvas } from './Sprays.js'
import { getKeyFor, keyLabel } from './Keybinds.js'

export class PlayPauseMenu {
  constructor(bm) {
    this.bm = bm
    this.el = document.getElementById('play-pause-menu')
    this._fromSettings = false
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn)
    on('play-pause-close', () => {
      if (bm.menuOpen) bm.toggleMenu()
    })
    on('play-pause-back-btn', () => {
      if (bm.menuOpen) bm.toggleMenu()
    })
    on('play-pause-settings-btn', () => this.openSettings())
    on('play-pause-weapon-btn', () => this.switchWeapon())
    on('play-pause-spectate-btn', () => this.bm.spectate?.enter())
    on('play-pause-photo-btn', () => this.bm.spectate?.enter({ photo: true }))
    on('play-pause-spray-btn', () => this.openSpray())
    on('play-spray-done', () => this.closeSpray())
    on('play-spray-clear', () => {
      this._spray = '0'.repeat(SPRAY_SIZE * SPRAY_SIZE)
      this._drawSpray()
    })
    this._bindSprayPad()
    on('play-pause-invite-btn', () => this.invite())
    on('play-invite-copy', () => this.copyInvite())
    on('play-pause-save-btn', () => this.saveProgress())
    on('play-pause-leave-btn', () => this._leave())
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
    if (!on && this._spray) this.closeSpray()
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
    set('play-pause-photo-label', t('playPausePhoto'))
    set('play-pause-spray-label', t('playPauseSpray'))
    set('play-spray-clear', t('sprayClear'))
    set('play-spray-done', t('sprayDone'))
    set('play-spray-hint', t('sprayHint', { key: keyLabel(getKeyFor('spray')) }))
    set('play-pause-invite-label', t('playPauseInvite'))
    set('play-invite-copy', t('playInviteCopy'))
    set('play-invite-hint', t('playInviteHint'))
    set('play-pause-save-label', t('playPauseSave'))
    set('play-pause-leave-label', t('playPauseLeave'))
    set('play-pause-hint', t('playPauseHint'))
    // A silly tip each time (SillyTips.js).
    set('play-pause-tip', sillyTip())
    set('play-pause-status', '')
    const save = document.getElementById('play-pause-save-btn')
    if (save) save.style.display = s.net ? 'none' : ''
    this._showInvite()
  }

  // --- Spray Paint ---

  openSpray() {
    this._spray = loadSpray()
    this._paint = this._paint || 3
    const buttons = document.getElementById('play-pause-buttons')
    const box = document.getElementById('play-spray')
    if (buttons) buttons.hidden = true
    if (box) box.hidden = false
    document.getElementById('play-invite')?.setAttribute('hidden', '')
    const colors = document.getElementById('play-spray-colors')
    if (colors && !colors.childElementCount) {
      // Built once: fixed colours, no outside text.
      colors.innerHTML = SPRAY_COLORS.map((c, i) => `<button type="button" data-paint="${i}" class="${i ? '' : 'play-spray-eraser'}" style="${c ? `background:${c}` : ''}" aria-label="${i ? c : 'Eraser'}"></button>`).join('')
      colors.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-paint]')
        if (!btn) return
        this._paint = Number(btn.dataset.paint)
        this._markPaint()
      })
    }
    const eraser = colors?.querySelector('.play-spray-eraser')
    if (eraser) eraser.setAttribute('aria-label', t('sprayEraser'))
    this._markPaint()
    this._drawSpray()
  }

  closeSpray() {
    if (this._spray) {
      saveSpray(this._spray)
      this.bm.survival?.sprays?.setPicture(this._spray)
    }
    this._spray = null
    const buttons = document.getElementById('play-pause-buttons')
    const box = document.getElementById('play-spray')
    if (buttons) buttons.hidden = false
    if (box) box.hidden = true
    this._showInvite()
  }

  _markPaint() {
    for (const btn of document.querySelectorAll('#play-spray-colors [data-paint]')) btn.classList.toggle('on', Number(btn.dataset.paint) === this._paint)
  }

  _drawSpray() {
    const pad = document.getElementById('play-spray-pad')
    if (pad && this._spray) sprayCanvas(this._spray, 16, pad)
  }

  // Click or drag (mouse or finger) to paint squares.
  _bindSprayPad() {
    const pad = document.getElementById('play-spray-pad')
    if (!pad) return
    let down = false
    const paintAt = (e) => {
      if (!this._spray) return
      const r = pad.getBoundingClientRect()
      const x = Math.floor(((e.clientX - r.left) / r.width) * SPRAY_SIZE)
      const y = Math.floor(((e.clientY - r.top) / r.height) * SPRAY_SIZE)
      if (x < 0 || y < 0 || x >= SPRAY_SIZE || y >= SPRAY_SIZE) return
      const i = y * SPRAY_SIZE + x
      const c = this._paint.toString(16)
      if (this._spray[i] === c) return
      this._spray = this._spray.slice(0, i) + c + this._spray.slice(i + 1)
      this._drawSpray()
    }
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      down = true
      try { pad.setPointerCapture?.(e.pointerId) } catch { /* not a live pointer */ }
      paintAt(e)
    })
    pad.addEventListener('pointermove', (e) => { if (down) paintAt(e) })
    const up = () => { down = false }
    pad.addEventListener('pointerup', up)
    pad.addEventListener('pointercancel', up)
  }

  // The link box, once this game has a server (or is getting one: the
  // link shows straight away, made from the id it will have).
  _showInvite(id = null) {
    const s = this.bm.survival
    const box = document.getElementById('play-invite')
    const link = document.getElementById('play-invite-link')
    const net = s?.net && !s.net.closed ? s.net : s?.lobby && !s.lobby.closed ? s.lobby : null
    const serverId = net ? net.serverId : id
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
    // Ready for friends since it started: the same link, now a server game.
    if (s.lobby && !s.lobby.closed) {
      await makeGameJoinable(this.bm.game, s)
      const save = document.getElementById('play-pause-save-btn')
      if (save) save.style.display = 'none'
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
    // Settings wrote its own address; put the server's invite link back.
    const s = this.bm.survival
    const net = s?.net && !s.net.closed ? s.net : s?.lobby
    if (net && !net.closed) net._showInAddressBar()
    if (this.bm.menuOpen) this.show(true)
  }

  _leave() {
    const bm = this.bm
    bm.closeMenuQuietly()
    bm.survival.stop()
    bm.game?._exitBuildMode?.()
  }
}
