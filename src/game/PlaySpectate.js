// Spectate, from the pause screen while playing a game (2026-10-17, Gaymi:
// "add a spectate feature in paused", picked "both"):
//
//   Free camera  - fly anywhere (WASD, Space up, Shift down, mouse to look,
//                  through walls). The game keeps going around you - waves,
//                  zombies, the land growing where you fly (2026-10-18,
//                  Gaymi: "it should feel like just in game but you're
//                  flying and can't get damaged") - and nothing can hurt
//                  you (`spectating` in BuildSurvival._hurtPlayer). You can
//                  still shoot.
//   Watch players - on a server, click (or press the Use key) to look
//                  through the next player's eyes; past the last one it's
//                  back to the free camera. The server's world keeps going,
//                  same as with the pause screen open.
//
// Photo Mode (2026-10-30, Gaymi: "pause, fly the camera around, hide the
// HUD, take a picture", saved to the device): the same free camera with
// `photo` on - every button and bar is hidden (body.play-photo), the gun
// isn't drawn, and alone the world stands still (BuildMode.update skips
// the game while `frozen`). A click, P or Enter, or the shutter button
// saves a PNG (BuildMode.render reads the picture straight after drawing
// it - the canvas keeps no copy).
//
// Filters and posting (2026-10-31, Gaymi's idea list: "add filters, then
// post the picture to your Gallery"): a row of PHOTO_FILTERS (colour
// matrices, so the live look - an SVG filter on the game's canvas - and
// the saved picture are the same), and once a photo's taken, Post to
// Gallery sends it (a smaller JPEG) to the Gallery's Photo section.
//
// Selfie Cam (2026-11-27, Gaymi: "a button in photo mode that turns the
// camera around to face my character, so I can pose with an emote"):
// the Selfie button (or F) puts you back where you stood, facing the way
// you looked, and the camera turns round to look at you. The mouse (or a
// finger drag) circles it around you, W / S (or the stick) brings it
// closer or farther, and the emote wheel (Z, or the Emote button) works -
// the emote keeps going until you leave the selfie. F again flies.
//
// Escape goes back to the pause screen and puts the camera back where you
// were. Owned by BuildMode (`bm.spectate`), driven from its update() and
// key/mouse handlers.
import * as THREE from 'three'
import { getKeyFor } from './Keybinds.js'
import { BOTTOM } from './Underground.js'
import { BLOCK_TYPES } from './BuildMode.js'
import { blockFaceCanvases } from './BlockTextures.js'
import { t } from './i18n.js'
import { postToGallery } from './GalleryUI.js'
import { PHOTO_FILTERS, filterDefs, applyFilter } from './PhotoFilters.js'
import { isOffline } from './Offline.js'
import { SKY_WEATHERS } from './BuildSky.js'
import { _censorText } from './Game.js'

const FLY_SPEED = 14 // blocks per second
const FAST_MULT = 2.5 // holding Ctrl
const EYE = 1.62 // blocks above a player's feet
// The bottom of the world (2026-10-18, Gaymi: "at 200 layer make it all
// bedrock"): flying down, the camera stops on the bedrock layer, and a
// bedrock floor is drawn there so it never looks out into the sky under
// the world. The rock is implicit (Underground.js) - only blocks someone
// can see are real - so the floor is one big flat picture of bedrock that
// follows the camera, not millions of blocks.
const FLOOR_SIZE = 1024 // blocks across
const MIN_EYE = BOTTOM + 0.4 // lowest the camera goes, in blocks

// A posted photo: a JPEG this wide at most, and under the Gallery's limit.
const POST_WIDTH = 960
const POST_MAX = 290000

// Selfie Cam: how far the camera is from you (blocks), where it aims (blocks
// above your feet - your chest), how fast W / S move it, and the little
// downward look it starts with.
const SELFIE_DIST = 3
const SELFIE_MIN = 1.2
const SELFIE_MAX = 8
const SELFIE_AIM = 1.25
const SELFIE_ZOOM = 4 // blocks per second
const SELFIE_PITCH = -0.12

// Zoom + tilt (2026-11-27, Gaymi picked "keys + sliders", in the selfie
// too, back to normal every time Photo Mode opens): zoom from a little
// wider than normal to 6x closer, tilt up to 45 degrees either way.
const ZOOM_MIN = 0.6
const ZOOM_MAX = 6
const ZOOM_WHEEL = 1.12 // each wheel notch zooms this much
const TILT_MAX = 45 // degrees
const TILT_SPEED = 40 // degrees per second, holding Q or E
// The Sky picker (2026-11-27, Gaymi): [id, time, weather, Blood Moon].
// Time 'now' keeps the time of day showing. Normal = the real sky,
// Custom = any time + any weather (the two menus under the row).
const PHOTO_SKIES = [
  ['normal'],
  ['day', 'day', 'clear'],
  ['sunset', 'sunset', 'clear'],
  ['night', 'night', 'clear'],
  ['bloodMoon', 'night', 'clear', true],
  ['fog', 'now', 'fog'],
  ['rain', 'now', 'mediumRain'],
  ['snow', 'now', 'mediumSnow'],
  ['thunderstorm', 'now', 'thunderstorm'],
  ['eclipse', 'day', 'eclipse'],
  ['custom'],
]
const SKY_TIME_CHOICES = ['now', 'day', 'sunset', 'night']
// (read when the menu's made: BuildSky.js may load after this file)
const skyWeatherChoices = () => SKY_WEATHERS.filter((w) => w !== 'random')

export class PlaySpectate {
  constructor(bm, blockSize) {
    this.bm = bm
    this.B = blockSize
    this.active = false
    this._watch = -1 // index into the server's players, -1 = free camera
    this._vel = new THREE.Vector3()
    this._saved = null
    this.photo = false
    this.filter = 'none'
    this.skyPick = 'normal'
    this.customSky = { time: 'now', weather: 'clear' }
    this._lastPhoto = null
    this.selfie = false
    this._selfieDist = SELFIE_DIST
    this.zoom = 1 // 1 = the normal view, 2 = twice as close
    this.tilt = 0 // degrees, + leans the picture to the right
    this.roll = 0 // the tilt in radians (BuildMode.update turns the camera by it)
    this._lensFov = null // the camera's normal field of view while zoomed
  }

  // Photo Mode alone stops the world; a server's game can't wait.
  get frozen() {
    const net = this.bm.survival?.net
    return this.active && this.photo && !(net && !net.closed)
  }

  _players() {
    const net = this.bm.survival?.net
    if (!net || net.closed) return []
    return [...net.players.values()].filter((p) => p.seen && !p.dead)
  }

  hasPlayers() {
    return this._players().length > 0
  }

  enter({ photo = false } = {}) {
    const bm = this.bm
    const s = bm.survival
    if (!s?.active || s.dead || this.active) return
    this.active = true
    this.photo = photo
    if (photo) {
      this._lensFov = bm.camera.fov
      this.resetLens()
      this._showPhotoUi(true)
    }
    this._watch = -1
    this._vel.set(0, 0, 0)
    // Out of the go-kart first (you leave your body behind).
    s.kart?.leave()
    s.vehicles?.leave(true)
    this._saved = { pos: bm.camera.position.clone(), yaw: bm._yaw, pitch: bm._pitch }
    s.spectating = true
    this._savedPos = bm.tryMode.pos.clone()
    bm.closeMenuQuietly()
    bm.tryMode.setAim(false)
    this._showFloor(true)
    // No banner over the view (2026-10-18, Gaymi: "remove the message in
    // spectating"): Escape or the phone's pause button still goes back.
    document.body.classList.add('play-spectating')
    try { bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
  }

  exit() {
    if (!this.active) return
    const bm = this.bm
    this._endSelfie()
    this.active = false
    bm.survival.spectating = false
    if (this._saved) {
      bm.camera.position.copy(this._saved.pos)
      bm._yaw = this._saved.yaw
      bm._pitch = this._saved.pitch
    }
    // Back where you were when you started spectating.
    if (this._savedPos) {
      bm.tryMode.pos.copy(this._savedPos)
      bm.tryMode.vel?.set(0, 0, 0)
    }
    this._showFloor(false)
    document.body.classList.remove('play-spectating')
    // The normal view again: no zoom, no tilt.
    this.resetLens()
    if (this._lensFov != null) {
      bm.camera.fov = this._lensFov
      bm.camera.updateProjectionMatrix()
      this._lensFov = null
    }
    this._pinch = null
    if (this.photo) this._showPhotoUi(false)
    this.photo = false
    this.setFilter('none')
    this.setSky('normal')
    this._lastPhoto = null
  }

  // The shutter and Exit buttons (the only things left on screen) and a
  // "Photo saved" flash.
  _showPhotoUi(on) {
    document.body.classList.toggle('play-photo', on)
    let ui = document.getElementById('play-photo-ui')
    if (on && !ui) {
      ui = document.createElement('div')
      ui.id = 'play-photo-ui'
      ui.innerHTML = `
        <div id="play-photo-flash"></div>
        <p id="play-photo-hint"></p>
        <p id="play-photo-saved" aria-live="polite"></p>
        <div id="play-photo-top">
          <div id="play-photo-filters" role="group"></div>
          <div id="play-photo-sky" role="group"><span id="play-photo-sky-label"></span></div>
          <div id="play-photo-sky-custom" hidden>
            <label><span data-sky-name="time"></span><select id="play-photo-sky-time">${SKY_TIME_CHOICES.map((id) => `<option value="${id}"></option>`).join('')}</select></label>
            <label><span data-sky-name="weather"></span><select id="play-photo-sky-weather">${skyWeatherChoices().map((id) => `<option value="${id}"></option>`).join('')}</select></label>
          </div>
        </div>
        <div id="play-photo-lens" role="group">
          <label class="pp-lens-row"><span class="pp-lens-name" data-lens-name="zoom"></span><input type="range" id="play-photo-zoom" min="0" max="100" step="1"><output id="play-photo-zoom-val"></output></label>
          <label class="pp-lens-row"><span class="pp-lens-name" data-lens-name="tilt"></span><input type="range" id="play-photo-tilt" min="-${TILT_MAX}" max="${TILT_MAX}" step="1"><output id="play-photo-tilt-val"></output></label>
          <button type="button" id="play-photo-lens-reset"></button>
        </div>
        <div id="play-photo-btns">
          <button type="button" id="play-photo-exit"></button>
          <button type="button" id="play-photo-post" hidden></button>
          <button type="button" id="play-photo-emote" hidden></button>
          <button type="button" id="play-photo-selfie" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><path d="M9 12a3 3 0 0 1 5.2-2"/><path d="M15 14a3 3 0 0 1-5.2 2"/><path d="M14.4 8.2v2h-2M9.6 17.8v-2h2"/></svg><span></span></button>
          <button type="button" id="play-photo-shutter"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/></svg></button>
        </div>`
      document.body.appendChild(ui)
      // Buttons don't reach the game underneath (no shot, no re-lock).
      const filters = ui.querySelector('#play-photo-filters')
      for (const [id] of PHOTO_FILTERS) {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.filter = id
        filters.appendChild(b)
      }
      filters.addEventListener('pointerdown', (e) => e.stopPropagation())
      filters.addEventListener('click', (e) => {
        e.stopPropagation()
        const b = e.target.closest('[data-filter]')
        if (b) this.setFilter(b.dataset.filter)
      })
      // The Sky picker's buttons and Custom's two menus.
      const sky = ui.querySelector('#play-photo-sky')
      for (const [id] of PHOTO_SKIES) {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.sky = id
        sky.appendChild(b)
      }
      for (const el of [sky, ui.querySelector('#play-photo-sky-custom')]) {
        for (const ev of ['pointerdown', 'click', 'touchstart', 'touchmove', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true })
      }
      sky.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sky]')
        if (b) this.setSky(b.dataset.sky)
      })
      ui.querySelector('#play-photo-sky-time').addEventListener('change', (e) => {
        this.customSky.time = e.target.value
        this.setSky('custom')
      })
      ui.querySelector('#play-photo-sky-weather').addEventListener('change', (e) => {
        this.customSky.weather = e.target.value
        this.setSky('custom')
      })
      for (const id of ['play-photo-exit', 'play-photo-shutter', 'play-photo-post', 'play-photo-selfie', 'play-photo-emote']) {
        ui.querySelector(`#${id}`).addEventListener('pointerdown', (e) => e.stopPropagation())
      }
      // The zoom and tilt sliders (and Reset): touches and clicks stay here.
      const lens = ui.querySelector('#play-photo-lens')
      for (const ev of ['pointerdown', 'click', 'touchstart', 'touchmove', 'wheel']) lens.addEventListener(ev, (e) => e.stopPropagation(), { passive: true })
      ui.querySelector('#play-photo-zoom').addEventListener('input', (e) => this.setZoom(this._zoomFromSlider(+e.target.value)))
      ui.querySelector('#play-photo-tilt').addEventListener('input', (e) => this.setTilt(+e.target.value))
      ui.querySelector('#play-photo-lens-reset').addEventListener('click', () => this.resetLens())
      // Phones: two fingers pinch to zoom.
      window.addEventListener('touchmove', (e) => this._onPinch(e), { passive: false, capture: true })
      const endPinch = (e) => { if (e.touches.length < 2) this._pinch = null }
      window.addEventListener('touchend', endPinch, { passive: true, capture: true })
      window.addEventListener('touchcancel', endPinch, { passive: true, capture: true })
      ui.querySelector('#play-photo-post').addEventListener('click', (e) => {
        e.stopPropagation()
        this.postPhoto()
      })
      ui.querySelector('#play-photo-selfie').addEventListener('click', (e) => {
        e.stopPropagation()
        this.setSelfie(!this.selfie)
      })
      ui.querySelector('#play-photo-emote').addEventListener('click', (e) => {
        e.stopPropagation()
        this.toggleEmotes()
      })
      ui.querySelector('#play-photo-shutter').addEventListener('click', (e) => {
        e.stopPropagation()
        this.snap()
      })
      ui.querySelector('#play-photo-exit').addEventListener('click', (e) => {
        e.stopPropagation()
        if (this.active) this.bm.toggleMenu()
      })
    }
    if (!ui) return
    ui.style.display = on ? '' : 'none'
    if (!on) return
    ui.querySelector('#play-photo-exit').textContent = t('photoModeExit')
    ui.querySelector('#play-photo-selfie span').textContent = t('photoModeSelfie')
    ui.querySelector('#play-photo-emote').textContent = t('actionEmote')
    this._selfieUi()
    ui.querySelector('#play-photo-shutter').setAttribute('aria-label', t('photoModeSnap'))
    ui.querySelector('#play-photo-shutter').title = t('photoModeSnap')
    const post = ui.querySelector('#play-photo-post')
    post.textContent = t('photoModePost')
    post.hidden = !this._lastPhoto
    for (const b of ui.querySelectorAll('[data-filter]')) {
      b.textContent = t(`photoFilter_${b.dataset.filter}`)
      b.classList.toggle('active', b.dataset.filter === this.filter)
    }
    ui.querySelector('#play-photo-sky-label').textContent = t('photoSkyLabel')
    for (const b of ui.querySelectorAll('[data-sky]')) b.textContent = t(`photoSky_${b.dataset.sky}`)
    ui.querySelector('[data-sky-name="time"]').textContent = t('photoSkyTime')
    ui.querySelector('[data-sky-name="weather"]').textContent = t('photoSkyWeather')
    for (const o of ui.querySelectorAll('#play-photo-sky-time option')) o.textContent = o.value === 'now' ? t('photoSkyNow') : t(`buildTime_${o.value}`)
    for (const o of ui.querySelectorAll('#play-photo-sky-weather option')) o.textContent = t(`buildWeather_${o.value}`)
    this._skyUi()
    ui.querySelector('[data-lens-name="zoom"]').textContent = t('photoModeZoom')
    ui.querySelector('[data-lens-name="tilt"]').textContent = t('photoModeTilt')
    ui.querySelector('#play-photo-lens-reset').textContent = t('photoModeLensReset')
    this._lensUi()
  }

  // Zoom + tilt. The zoom slider goes 0-100 evenly through the zoom
  // (so 1x to 2x is as far as 2x to 4x).
  _zoomFromSlider(v) {
    return ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v / 100)
  }

  _sliderFromZoom(z) {
    return (Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * 100
  }

  setZoom(z) {
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z || 1))
    // Close to 1x snaps to exactly normal, so it's easy to go back.
    if (Math.abs(this.zoom - 1) < 0.03) this.zoom = 1
    this._applyFov()
    this._lensUi()
  }

  setTilt(deg) {
    this.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, deg || 0))
    this.roll = THREE.MathUtils.degToRad(-this.tilt)
    this._lensUi()
  }

  resetLens() {
    this.zoom = 1
    this.tilt = 0
    this.roll = 0
    this._pinch = null
    this._applyFov()
    this._lensUi()
  }

  // The camera's field of view for the zoom: a real lens zoom (2x shows
  // half as much across), from the normal view Photo Mode opened with.
  _applyFov() {
    if (this._lensFov == null) return
    const cam = this.bm.camera
    const half = THREE.MathUtils.degToRad(this._lensFov) / 2
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / this.zoom))
    if (Math.abs(cam.fov - fov) > 0.001) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
  }

  // The sliders and their numbers follow the zoom and tilt.
  _lensUi() {
    const ui = document.getElementById('play-photo-ui')
    if (!ui) return
    const zoom = ui.querySelector('#play-photo-zoom')
    const tilt = ui.querySelector('#play-photo-tilt')
    if (document.activeElement !== zoom) zoom.value = String(Math.round(this._sliderFromZoom(this.zoom)))
    if (document.activeElement !== tilt) tilt.value = String(Math.round(this.tilt))
    ui.querySelector('#play-photo-zoom-val').textContent = `${this.zoom.toFixed(1)}x`
    ui.querySelector('#play-photo-tilt-val').textContent = `${Math.round(this.tilt)}°`
  }

  // BuildInput: the mouse wheel in Photo Mode zooms (up = closer).
  wheel(deltaY) {
    if (!this.photo || !deltaY) return
    this.setZoom(this.zoom * Math.pow(ZOOM_WHEEL, -deltaY / 100))
  }

  // Two fingers on the screen (not the move stick, not a button):
  // spreading them zooms in, pinching zooms out. Caught before the touch
  // controls (BuildTouch) see it, so the view doesn't also turn.
  _onPinch(e) {
    if (!this.active || !this.photo || e.touches.length < 2) return
    const touch = this.bm.touch
    const free = [...e.touches].filter((tch) => tch.identifier !== touch?._stick?.id && !tch.target?.closest?.('[data-tp], #play-photo-ui button, #play-photo-ui input, #emote-wheel, #ping-wheel'))
    if (free.length < 2) return
    const [a, b] = free
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    if (touch) touch._look = null
    e.stopPropagation()
    e.preventDefault()
    const p = this._pinch
    if (!p || p.a !== a.identifier || p.b !== b.identifier) {
      this._pinch = { a: a.identifier, b: b.identifier, d, zoom: this.zoom }
      return
    }
    if (p.d > 0) this.setZoom(p.zoom * (d / p.d))
  }

  // Q / E held: tilt left / right (every frame, both cameras).
  _updateLens(dt, keys) {
    let dir = 0
    if (keys.has('KeyQ')) dir -= 1
    if (keys.has('KeyE')) dir += 1
    if (dir) this.setTilt(this.tilt + dir * TILT_SPEED * dt)
  }

  // The Selfie button's look, the Emote button and the hint for the camera
  // you're using.
  _selfieUi() {
    const ui = document.getElementById('play-photo-ui')
    if (!ui) return
    ui.querySelector('#play-photo-hint').textContent = t(this.selfie ? 'photoModeSelfieHint' : 'photoModeHint')
    const b = ui.querySelector('#play-photo-selfie')
    b.classList.toggle('active', this.selfie)
    b.setAttribute('aria-pressed', String(this.selfie))
    ui.querySelector('#play-photo-emote').hidden = !this.selfie
  }

  // Selfie Cam on or off (the Selfie button, or F).
  setSelfie(on) {
    on = !!on
    if (!this.active || !this.photo || on === this.selfie) return
    const bm = this.bm
    const tm = bm.tryMode
    if (on) {
      // Where the free camera was, for flying on afterwards.
      this._freeCam = { pos: bm.camera.position.clone(), yaw: bm._yaw, pitch: bm._pitch }
      // You stand where you were when Photo Mode opened, facing the way
      // you were looking, and the camera looks back at your face.
      if (this._savedPos) tm.pos.copy(this._savedPos)
      tm.vel?.set(0, 0, 0)
      const yaw = this._saved?.yaw ?? bm._yaw
      tm.selfieYaw = yaw
      bm._yaw = yaw + Math.PI
      bm._pitch = SELFIE_PITCH
      this._selfieDist = SELFIE_DIST
      this._vel.set(0, 0, 0)
      this.selfie = true
    } else {
      this._endSelfie()
      const f = this._freeCam
      if (f) {
        bm.camera.position.copy(f.pos)
        bm._yaw = f.yaw
        bm._pitch = f.pitch
      }
      this._freeCam = null
      // Your body goes back out of sight (unless a third-person view is on).
      tm._updateBody(0)
    }
    this._selfieUi()
  }

  // Leaving the selfie (or Photo Mode): the emote stops, the wheel closes.
  _endSelfie() {
    if (!this.selfie) return
    this.selfie = false
    this.bm.tryMode.selfieYaw = null
    const em = this.bm.survival?.emotes
    em?.close(false)
    em?.stop()
  }

  // The Emote button (and the Emote key) while taking a selfie.
  toggleEmotes() {
    if (!this.selfie) return
    this.bm.survival?.emotes?.toggleBar()
  }

  // A filter for the photos (and the live view while in Photo Mode).
  setFilter(id) {
    this.filter = PHOTO_FILTERS.some(([f]) => f === id) ? id : 'none'
    if (this.filter !== 'none') filterDefs()
    const canvas = this.bm.renderer?.domElement
    if (canvas) canvas.style.filter = this.filter === 'none' ? '' : `url(#gz-photo-${this.filter})`
    for (const b of document.querySelectorAll('#play-photo-filters [data-filter]')) b.classList.toggle('active', b.dataset.filter === this.filter)
  }

  // The Sky picker: a sky for the shot (only on this screen), or Normal
  // for the real one. Photo Mode closing puts Normal back (exit()).
  setSky(id) {
    const pick = PHOTO_SKIES.find(([s]) => s === id) ? id : 'normal'
    this.skyPick = pick
    const sky = this.bm.sky
    if (sky) {
      if (pick === 'normal') sky.photoSkyEnd()
      else if (pick === 'custom') sky.photoSky(this.customSky.time, this.customSky.weather)
      else {
        const [, time, weather, blood] = PHOTO_SKIES.find(([s]) => s === pick)
        sky.photoSky(time, weather, !!blood)
      }
    }
    this._skyUi()
  }

  _skyUi() {
    const ui = document.getElementById('play-photo-ui')
    if (!ui) return
    for (const b of ui.querySelectorAll('[data-sky]')) {
      const on = b.dataset.sky === this.skyPick
      b.classList.toggle('active', on)
      b.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    ui.querySelector('#play-photo-sky-custom').hidden = this.skyPick !== 'custom'
    ui.querySelector('#play-photo-sky-time').value = this.customSky.time
    ui.querySelector('#play-photo-sky-weather').value = this.customSky.weather
  }

  // Post to Gallery: the last photo taken, to the Photo section.
  async postPhoto() {
    const shot = this._lastPhoto
    const game = this.bm.game
    if (!shot || !game || this._posting) return
    if (isOffline()) return this._note(t('needsInternet'))
    if (!game._cloudUid) return this._note(t('gallerySignIn'))
    if (document.pointerLockElement) document.exitPointerLock()
    const name = window.prompt(t('photoPostPrompt'), '')
    const title = _censorText((name || '').trim()).slice(0, 40)
    if (!title) return
    // A smaller JPEG, a little smaller again until it fits.
    let image = ''
    for (let w = Math.min(POST_WIDTH, shot.width); w >= 240 && !image; w = Math.round(w * 0.75)) {
      const c = document.createElement('canvas')
      c.width = w
      c.height = Math.round((shot.height * w) / shot.width)
      c.getContext('2d').drawImage(shot, 0, 0, c.width, c.height)
      const url = c.toDataURL('image/jpeg', 0.8)
      if (url.length <= POST_MAX) image = url
    }
    if (!image) return this._note(t('galleryPostFailed'))
    this._posting = true
    try {
      await postToGallery(game, { kind: 'photo', title, image })
      this._note(t('galleryPosted'))
    } catch {
      this._note(t('galleryPostFailed'))
    } finally {
      this._posting = false
    }
  }

  // A short note in the middle of the screen ("Photo saved!").
  _note(text) {
    const saved = document.getElementById('play-photo-saved')
    if (!saved) return
    saved.textContent = text
    saved.classList.remove('show')
    void saved.offsetWidth
    saved.classList.add('show')
  }

  // Takes the picture on the next frame drawn (BuildMode.render).
  snap() {
    if (!this.photo) return
    this.bm._photoPending = true
  }

  // BuildMode.render calls this with the picture it just drew.
  savePhoto(canvas) {
    // Local time, "2026-10-30-17-05-09".
    const d = new Date()
    const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join('-')
    try {
      // Copied now (the game's canvas is cleared after this frame), with
      // the filter baked in; kept for Post to Gallery.
      const shot = document.createElement('canvas')
      shot.width = canvas.width
      shot.height = canvas.height
      shot.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0)
      applyFilter(shot, PHOTO_FILTERS.find(([f]) => f === this.filter)?.[1])
      this._lastPhoto = shot
      const post = document.getElementById('play-photo-post')
      if (post) post.hidden = false
      shot.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `gayz-photo-${stamp}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      }, 'image/png')
    } catch {
      return
    }
    const flash = document.getElementById('play-photo-flash')
    if (flash) {
      flash.classList.remove('show')
      void flash.offsetWidth
      flash.classList.add('show')
    }
    this._note(t('photoModeSaved'))
  }

  _showFloor(on) {
    if (on && !this._floor) {
      const type = BLOCK_TYPES.find((b) => b.id === 'bedrock')
      const canvas = type && blockFaceCanvases(type)?.top
      if (!canvas) return
      const tex = new THREE.CanvasTexture(canvas)
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestMipmapLinearFilter
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(FLOOR_SIZE, FLOOR_SIZE)
      tex.colorSpace = THREE.SRGBColorSpace
      const B = this.B
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE * B, FLOOR_SIZE * B), new THREE.MeshLambertMaterial({ map: tex }))
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = BOTTOM * B
      mesh.name = 'spectate-bedrock-floor'
      this._floor = mesh
      this.bm.scene.add(mesh)
    }
    if (this._floor) this._floor.visible = on
  }

  // BuildMode: where the camera (and the spot it carries "me" at) was
  // before the game's frame, and putting them back after it.
  hold() {
    const bm = this.bm
    const k = this._keep || (this._keep = { cam: new THREE.Vector3(), pos: new THREE.Vector3(), yaw: 0, pitch: 0 })
    k.cam.copy(bm.camera.position)
    k.pos.copy(bm.tryMode.pos)
    k.yaw = bm._yaw
    k.pitch = bm._pitch
    return k
  }

  restore(k) {
    const bm = this.bm
    bm.camera.position.copy(k.cam)
    bm.tryMode.pos.copy(k.pos)
    bm.tryMode.vel?.set(0, 0, 0)
    bm._yaw = k.yaw
    bm._pitch = k.pitch
  }

  // dir: +1 next player, -1 previous; past either end is the free camera.
  cycle(dir) {
    const players = this._players()
    if (!players.length) {
      this._watch = -1
      return
    }
    const n = players.length + 1 // the free camera is one more stop
    this._watch = ((this._watch + 1 + dir) % n + n) % n - 1
  }

  // The Use key (E by default) watches the next player too.
  onKey(code) {
    if (code === getKeyFor('use')) this.cycle(1)
  }

  update(dt, keys) {
    const bm = this.bm
    const cam = bm.camera
    const B = this.B
    const players = this._players()
    if (this._watch >= players.length) this._watch = -1
    const p = this._watch >= 0 ? players[this._watch] : null
    if (p) {
      // Through their eyes: where they stand, the way they face.
      cam.position.set(p.x * B, (p.y + EYE) * B, p.z * B)
      bm._yaw = p.yaw
      bm._pitch = 0
      cam.rotation.set(0, 0, 0)
      cam.rotateY(bm._yaw)
      bm.tryMode._drawMap(performance.now(), p.x, p.z)
      return
    }
    if (this.photo) this._updateLens(dt, keys)
    if (this.selfie) return this._updateSelfie(dt, keys)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
    const dir = new THREE.Vector3()
    if (keys.has('KeyW')) dir.add(forward)
    if (keys.has('KeyS')) dir.sub(forward)
    if (keys.has('KeyD')) dir.add(right)
    if (keys.has('KeyA')) dir.sub(right)
    // Phones: the move stick (BuildTouch's bm._touchMove), jump = up and
    // crouch = down.
    const stick = bm._touchMove || bm._padMove
    if (stick) dir.addScaledVector(forward, stick.y).addScaledVector(right, stick.x)
    if (keys.has('Space') || keys.has(getKeyFor('jump'))) dir.y += 1
    if (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has(getKeyFor('crouch'))) dir.y -= 1
    if (dir.lengthSq() > 1) dir.normalize()
    const speed = FLY_SPEED * B * (keys.has('ControlLeft') ? FAST_MULT : 1)
    const k = 1 - Math.exp(-10 * dt)
    this._vel.lerp(dir.multiplyScalar(speed), k)
    cam.position.addScaledVector(this._vel, dt)
    // Never under the bedrock.
    if (cam.position.y < MIN_EYE * B) {
      cam.position.y = MIN_EYE * B
      if (this._vel.y < 0) this._vel.y = 0
    }
    // The floor stays under you, lined up with the blocks.
    if (this._floor) this._floor.position.set(Math.round(cam.position.x / B) * B, BOTTOM * B, Math.round(cam.position.z / B) * B)
    // You fly as yourself: the land grows, zombies chase and spawn, the
    // minimap and coordinates follow - all from where the camera is.
    const tm = bm.tryMode
    tm.pos.set(cam.position.x / B, cam.position.y / B - EYE, cam.position.z / B)
    tm.vel?.set(0, 0, 0)
    // And everything else works like playing: the gun (aim, recoil,
    // inspect), breaking blocks, the minimap, pressure plates under
    // zombies, the underwater look. (Photo Mode has no gun.)
    if (!this.photo) tm.updateHands(dt, keys)
    const s = bm.survival
    if (s?.active) bm.gadgets.updatePlates(s.zombieCells(), dt)
    bm.specials.update(dt, null)
    tm._drawMap(performance.now())
    tm._setUnderwater(tm._liquidAtEye(tm.pos))
  }

  // Selfie Cam: you stand still, the camera circles you. The mouse already
  // turned it (BuildMode.update sets its rotation from _yaw / _pitch);
  // here it moves back from your chest along the way it looks, stopping
  // short of a wall or the ground.
  _updateSelfie(dt, keys) {
    const bm = this.bm
    const cam = bm.camera
    const B = this.B
    const tm = bm.tryMode
    let zoom = 0
    if (keys.has('KeyW')) zoom -= 1
    if (keys.has('KeyS')) zoom += 1
    const stick = bm._touchMove || bm._padMove
    if (stick) zoom -= stick.y
    this._selfieDist = Math.max(SELFIE_MIN, Math.min(SELFIE_MAX, this._selfieDist + zoom * SELFIE_ZOOM * dt))
    const aim = this._aim || (this._aim = new THREE.Vector3())
    aim.set(tm.pos.x, tm.pos.y + SELFIE_AIM, tm.pos.z)
    const back = (this._back || (this._back = new THREE.Vector3())).set(0, 0, 1).applyQuaternion(cam.quaternion)
    let dist = this._selfieDist
    for (let d = 0.3; d <= this._selfieDist; d += 0.1) {
      if (bm._cellSolidTop(Math.floor(aim.x + back.x * d), Math.floor(aim.y + back.y * d), Math.floor(aim.z + back.z * d)) > 0) {
        dist = Math.max(0.3, d - 0.3)
        break
      }
    }
    cam.position.set((aim.x + back.x * dist) * B, (aim.y + back.y * dist) * B, (aim.z + back.z * dist) * B)
    tm.vel?.set(0, 0, 0)
    if (this._floor) this._floor.position.set(Math.round(cam.position.x / B) * B, BOTTOM * B, Math.round(cam.position.z / B) * B)
    // Your body, posing (Emotes.poseEmote) - the world may be frozen, so
    // it's moved here.
    tm._updateBody(dt)
    const s = bm.survival
    if (s?.active) bm.gadgets.updatePlates(s.zombieCells(), dt)
    bm.specials.update(dt, null)
    tm._drawMap(performance.now())
    tm._setUnderwater(false)
  }
}
