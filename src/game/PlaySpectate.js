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
// Escape goes back to the pause screen and puts the camera back where you
// were. Owned by BuildMode (`bm.spectate`), driven from its update() and
// key/mouse handlers.
import * as THREE from 'three'
import { getKeyFor } from './Keybinds.js'
import { BOTTOM } from './Underground.js'
import { BLOCK_TYPES } from './BuildMode.js'
import { blockFaceCanvases } from './BlockTextures.js'
import { t } from './i18n.js'

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

export class PlaySpectate {
  constructor(bm, blockSize) {
    this.bm = bm
    this.B = blockSize
    this.active = false
    this._watch = -1 // index into the server's players, -1 = free camera
    this._vel = new THREE.Vector3()
    this._saved = null
    this.photo = false
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
    if (photo) this._showPhotoUi(true)
    this._watch = -1
    this._vel.set(0, 0, 0)
    // Out of the go-kart first (you leave your body behind).
    s.kart?.leave()
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
    if (this.photo) this._showPhotoUi(false)
    this.photo = false
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
        <div id="play-photo-btns">
          <button type="button" id="play-photo-exit"></button>
          <button type="button" id="play-photo-shutter"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/></svg></button>
        </div>`
      document.body.appendChild(ui)
      // Buttons don't reach the game underneath (no shot, no re-lock).
      for (const id of ['play-photo-exit', 'play-photo-shutter']) {
        ui.querySelector(`#${id}`).addEventListener('pointerdown', (e) => e.stopPropagation())
      }
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
    ui.querySelector('#play-photo-hint').textContent = t('photoModeHint')
    ui.querySelector('#play-photo-exit').textContent = t('photoModeExit')
    ui.querySelector('#play-photo-shutter').setAttribute('aria-label', t('photoModeSnap'))
    ui.querySelector('#play-photo-shutter').title = t('photoModeSnap')
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
      canvas.toBlob((blob) => {
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
    const saved = document.getElementById('play-photo-saved')
    if (saved) {
      saved.textContent = t('photoModeSaved')
      saved.classList.remove('show')
      void saved.offsetWidth
      saved.classList.add('show')
    }
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
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
    const dir = new THREE.Vector3()
    if (keys.has('KeyW')) dir.add(forward)
    if (keys.has('KeyS')) dir.sub(forward)
    if (keys.has('KeyD')) dir.add(right)
    if (keys.has('KeyA')) dir.sub(right)
    // Phones: the move stick (BuildTouch's bm._touchMove), jump = up and
    // crouch = down.
    const stick = bm._touchMove
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
}
