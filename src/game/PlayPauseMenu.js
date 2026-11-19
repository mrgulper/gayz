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
//   Save Clip      - the last ~30 s of the game as a video file
//                    (ClipMaker.js, 2026-11-19; also the K key).
//   Clip Options   - Video or GIF, length 10/20/30 s or Custom, sound on
//                    or off, GIF size (2026-11-19): the buttons make way
//                    for rows of choices and Done, like Spray Paint.
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
import { gameTip } from './GameplayAssist.js'
import { inviteLink, makeGameJoinable, newServerId } from './ServerBrowser.js'
import { SPRAY_SIZE, SPRAY_COLORS, loadSpray, saveSpray, sprayCanvas } from './Sprays.js'
import { getKeyFor, keyLabel } from './Keybinds.js'
import { clipsSupported, CLIP_LENGTHS, CLIP_LEN_MIN, CLIP_LEN_MAX, CLIP_SPEEDS, CLIP_SPEED_MIN, CLIP_SPEED_MAX, CAM_LIMITS, cleanClipOptions } from './ClipMaker.js'
import { REPLAY_ANGLES } from './DeathReplay.js'

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
    // Spin ring games: the ring editor and bag (RingEditor.js).
    on('play-pause-ring-btn', () => {
      if (bm.menuOpen) bm.toggleMenu()
      bm.survival?.ringEditor?.open()
    })
    on('play-pause-spectate-btn', () => this.bm.spectate?.enter())
    on('play-pause-photo-btn', () => this.bm.spectate?.enter({ photo: true }))
    // Save Clip: the last ~30 s as a video file (ClipMaker.js).
    on('play-pause-clip-btn', () => this.bm.survival?.clips?.save())
    on('play-pause-clipopts-btn', () => this.openClipOptions())
    // Replay Clip (Batch 3): rewound and filmed from the Replay Camera.
    on('play-pause-replay-btn', () => this.bm.survival?.clips?.saveReplay())
    on('play-clip-done', () => this.closeClipOptions())
    this._bindClipOptions()
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
    if (!on && this._clipOpts) this.closeClipOptions()
    this.el.style.display = on ? 'flex' : 'none'
    // No pause screen in the clip (ClipMaker.js).
    this.bm.survival?.clips?.setPaused(on)
    if (on) this._refresh()
  }

  _refresh() {
    const s = this.bm.survival
    // Spin ring games have no guns to switch to (SpinRing.js).
    const weaponBtn = document.getElementById('play-pause-weapon-btn')
    if (weaponBtn) weaponBtn.style.display = s?.ring ? 'none' : ''
    const ringBtn = document.getElementById('play-pause-ring-btn')
    if (ringBtn) ringBtn.style.display = s?.ring ? '' : 'none'
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    set('play-pause-title', t('playPauseTitle'))
    set('play-pause-info', t('playPauseInfo', { wave: Math.max(1, s.wave), kills: s.kills }))
    set('play-pause-back-label', t('playPauseBack'))
    set('play-pause-settings-label', t('playPauseSettings'))
    set('play-pause-weapon-label', t('playPauseWeapon'))
    set('play-pause-ring-label', t('playPauseRing'))
    set('play-pause-spectate-label', t('playPauseSpectate'))
    set('play-pause-photo-label', t('playPausePhoto'))
    set('play-pause-clip-label', t('playPauseClip'))
    const clipBtn = document.getElementById('play-pause-clip-btn')
    if (clipBtn) clipBtn.style.display = clipsSupported() ? '' : 'none'
    set('play-pause-clipopts-label', t('playPauseClipOptions'))
    const clipOptsBtn = document.getElementById('play-pause-clipopts-btn')
    if (clipOptsBtn) clipOptsBtn.style.display = clipsSupported() ? '' : 'none'
    set('play-pause-replay-label', t('playPauseReplay'))
    // Solo games only: on a server the world can't be rewound.
    const replayBtn = document.getElementById('play-pause-replay-btn')
    const online = (s?.net && !s.net.closed) || (s?.lobby && !s.lobby.closed)
    if (replayBtn) replayBtn.style.display = clipsSupported() && !online ? '' : 'none'
    set('play-clip-hint', t('clipOptHint'))
    set('play-clip-done', t('sprayDone'))
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
    // A tip each time (Settings > Gameplay > Game Tips; GameplayAssist.js).
    set('play-pause-tip', gameTip(this.bm.game?.settings))
    set('play-pause-status', '')
    const save = document.getElementById('play-pause-save-btn')
    if (save) save.style.display = s.net ? 'none' : ''
    this._showInvite()
  }

  // --- Clip Options ---

  openClipOptions() {
    if (this._spray) this.closeSpray()
    const clips = this.bm.survival?.clips
    this._clipOpts = { ...(clips?.options || cleanClipOptions(null)) }
    // Custom: a length that isn't one of the buttons, or Custom tapped.
    this._clipCustom = !CLIP_LENGTHS.includes(this._clipOpts.len)
    this._speedCustom = !CLIP_SPEEDS.includes(this._clipOpts.speed)
    this._clipOpts.cam = { ...this._clipOpts.cam }
    document.getElementById('play-pause-buttons')?.setAttribute('hidden', '')
    document.getElementById('play-invite')?.setAttribute('hidden', '')
    const box = document.getElementById('play-clip')
    if (box) box.hidden = false
    this._drawClipOptions()
  }

  closeClipOptions() {
    if (!this._clipOpts) return
    this._readClipInputs()
    const clips = this.bm.survival?.clips
    const same = clips ? clips.setOptions(this._clipOpts) : true
    this._clipOpts = null
    document.getElementById('play-pause-buttons')?.removeAttribute('hidden')
    const box = document.getElementById('play-clip')
    if (box) box.hidden = true
    this._showInvite()
    const status = document.getElementById('play-pause-status')
    if (status && !same) status.textContent = t('clipOptSaved')
  }

  // What's typed in the Custom boxes (kept when a row redraws).
  _readClipInputs() {
    const o = this._clipOpts
    if (!o) return
    const len = document.getElementById('play-clip-custom')
    if (this._clipCustom && len) o.len = Number(len.value) || o.len
    const speed = document.getElementById('play-clip-speed-custom')
    if (this._speedCustom && speed) o.speed = Number(speed.value) || o.speed
  }

  // The rows: Type, Length (+ Custom box), Speed (+ Custom box), Sound
  // (full-speed videos) or GIF Size, Replay Camera (+ Custom sliders).
  _drawClipOptions() {
    const rows = document.getElementById('play-clip-rows')
    const o = this._clipOpts
    if (!rows || !o) return
    const chip = (opt, val, label, on) => `<button type="button" data-opt="${opt}" data-val="${val}" class="${on ? 'on' : ''}" aria-pressed="${on}">${label}</button>`
    const row = (label, chips, extra = '') => `<div class="play-clip-group"><span class="play-clip-label">${label}</span><div class="play-clip-row">${chips}</div>${extra}</div>`
    const lens = CLIP_LENGTHS.map((n) => chip('len', n, t('clipOptSeconds', { n }), !this._clipCustom && o.len === n)).join('') + chip('len', 'custom', t('clipOptCustom'), this._clipCustom)
    const custom = this._clipCustom ? `<label class="play-clip-custom-row"><input type="number" id="play-clip-custom" class="nickname-input" min="${CLIP_LEN_MIN}" max="${CLIP_LEN_MAX}" step="1" inputmode="numeric" value="${Math.round(o.len)}" /><span>${t('clipOptCustomHint', { min: CLIP_LEN_MIN, max: CLIP_LEN_MAX })}</span></label>` : ''
    const gif = o.type === 'gif'
    const slow = o.speed < 1
    const speeds = CLIP_SPEEDS.map((n) => chip('speed', n, t('clipOptSpeedX', { n }), !this._speedCustom && o.speed === n)).join('') + chip('speed', 'custom', t('clipOptCustom'), this._speedCustom)
    const speedCustom = this._speedCustom ? `<label class="play-clip-custom-row"><input type="number" id="play-clip-speed-custom" class="nickname-input" min="${CLIP_SPEED_MIN}" max="${CLIP_SPEED_MAX}" step="0.05" inputmode="decimal" value="${o.speed}" /><span>${t('clipOptSpeedHint', { min: CLIP_SPEED_MIN, max: CLIP_SPEED_MAX })}</span></label>` : ''
    const speedNote = slow && !gif ? `<p class="play-clip-note">${t('clipOptSlowNoSound')}</p>` : ''
    const angleKey = { circle: 'clipOptCamCircle', behind: 'clipOptCamBehind', top: 'clipOptCamTop', side: 'clipOptCamSide', custom: 'clipOptCustom' }
    const angles = REPLAY_ANGLES.map((a) => chip('angle', a, t(angleKey[a]), o.angle === a)).join('')
    const slider = (k, label) => `<label class="play-clip-slider"><span>${label}</span><input type="range" data-cam="${k}" min="${CAM_LIMITS[k][0]}" max="${CAM_LIMITS[k][1]}" step="${k === 'turn' ? 5 : 1}" value="${o.cam[k]}" /><b data-cam-val="${k}">${o.cam[k]}${k === 'turn' ? '°' : ''}</b></label>`
    const camCustom = o.angle === 'custom' ? `<div class="play-clip-sliders">${slider('dist', t('clipOptCamDist'))}${slider('height', t('clipOptCamHeight'))}${slider('turn', t('clipOptCamTurn'))}</div>` : ''
    rows.innerHTML =
      row(t('clipOptType'), chip('type', 'video', t('clipOptVideo'), !gif) + chip('type', 'gif', t('clipOptGif'), gif)) +
      row(t('clipOptLength'), lens, custom) +
      row(t('clipOptSpeed'), speeds, speedCustom + speedNote) +
      (gif ? row(t('clipOptGifSize'), chip('gifSize', 'small', t('clipOptSmall'), o.gifSize === 'small') + chip('gifSize', 'big', t('clipOptBig'), o.gifSize === 'big'), `<p class="play-clip-note">${t('clipOptGifNoSound')}</p>`) : slow ? '' : row(t('clipOptSound'), chip('sound', 'on', t('clipOptOn'), o.sound) + chip('sound', 'off', t('clipOptOff'), !o.sound))) +
      row(t('clipOptCamera'), angles, camCustom + `<p class="play-clip-note">${t('clipOptCamNote')}</p>`)
  }

  _bindClipOptions() {
    const rows = document.getElementById('play-clip-rows')
    rows?.addEventListener('click', (e) => {
      const btn = e.target.closest?.('button[data-opt]')
      const o = this._clipOpts
      if (!btn || !o) return
      const { opt, val } = btn.dataset
      // Keep whatever's typed in the Custom boxes when another row redraws.
      this._readClipInputs()
      if (opt === 'type') o.type = val
      else if (opt === 'angle') o.angle = val
      else if (opt === 'speed' && val === 'custom') this._speedCustom = true
      else if (opt === 'speed') {
        this._speedCustom = false
        o.speed = Number(val)
      }
      else if (opt === 'sound') o.sound = val === 'on'
      else if (opt === 'gifSize') o.gifSize = val
      else if (opt === 'len' && val === 'custom') {
        this._clipCustom = true
      } else if (opt === 'len') {
        this._clipCustom = false
        o.len = Number(val)
      }
      this._drawClipOptions()
      if (opt === 'len' && val === 'custom') document.getElementById('play-clip-custom')?.focus()
      if (opt === 'speed' && val === 'custom') document.getElementById('play-clip-speed-custom')?.focus()
    })
    // The Custom camera's sliders: their number follows as they move.
    rows?.addEventListener('input', (e) => {
      const k = e.target?.dataset?.cam
      const o = this._clipOpts
      if (!k || !o) return
      o.cam[k] = Number(e.target.value)
      const val = rows.querySelector(`[data-cam-val="${k}"]`)
      if (val) val.textContent = `${o.cam[k]}${k === 'turn' ? '°' : ''}`
    })
  }

  // --- Spray Paint ---

  openSpray() {
    if (this._clipOpts) this.closeClipOptions()
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
    if (el) el.textContent = t(ok ? 'playPauseSaved' : s.td ? 'tdNoSave' : 'playPauseSaveFailed', { n: Math.max(1, s.wave) })
    return ok
  }

  // The game stays paused while the picker is open (BuildSurvival.update
  // waits while _picking), except on a server, where the world goes on.
  switchWeapon() {
    const s = this.bm.survival
    if (!s?.active || s.dead || s.ring) return
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
