// "Try Map" in the Map Editor: walk around the map you're building in first
// person, holding your gun, with gravity and real collision - then press T
// (or the pause screen's button) to go straight back to flying and
// building. Owned by BuildMode (`buildMode.tryMode`); BuildMode.update()
// hands movement over to update() here while it's on, and render() draws
// the gun on top with drawGun().
//
// Sizes are Minecraft's, in blocks: the body is 0.6 wide and 1.8 tall
// (so it fits through a one-block gap and a two-block-tall doorway), eyes
// at 1.62, steps up half a block (slabs) on its own - and a whole block
// onto stairs, so staircases just walk up - and jumps a little over one
// block. Ladders are climbed, water and lava slow you down and let you
// swim up, open doors let you through.
//
// The feel is bloxd.io's (asked for by name, then "exactly like" it):
// its own speeds - walk 4 blocks/s, run 7 (Shift + W), crouch 2 (C, Ctrl
// or Caps Lock; crouching also keeps you from walking off an edge; all
// rebindable in Settings > Controls, see Keybinds.js) -
// and its bunny hop: jump again right as you land and each hop in a row
// is faster (+15%, +22.5%, +30%), lost as soon as you stay on the ground.
// Movement starts and stops almost instantly, steers well in the air, a
// short grace window still lets you jump just after walking off a ledge,
// a jump pressed a moment before landing still counts, holding Space keeps
// hopping (and counts as a bunny hop), running widens the view a little,
// and there's almost no head bob.
//
// Shooting a window (any glass block) cracks it; the second shot breaks
// it and later shots fly through the hole. Broken windows come back when
// you stop trying the map and are never saved.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { audioEngine } from './Audio.js'
import { addGunLights, cloneViewmodel } from './Viewmodels.js'
import { heldAction, FIXED_KEYS } from './Keybinds.js'
import { WORLD_LIMIT, sampleLand, biomeName, inCity, isEarthWorld } from './OpenWorld.js'
import { EarthGlobe } from './EarthGlobe.js'
import { EARTH_DEG } from './EarthGrid.js'
import { placeNameAt } from './EarthPlaces.js'
import { t } from './i18n.js'
import { holdWeapon, poseArms } from './HeldWeapon.js'
import { GunFx } from './GunFx.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { PLAY_WEAPONS } from './PlayWeapons.js'
import { BOTTOM } from './Underground.js'
import { KART_EYE } from './GoKart.js'

const HALF_WIDTH = 0.3
// How bright the gun in your hands is lit, against its picture's light
// (Viewmodels.addGunLights).
const HAND_LIGHT = 0.85
// Cells across the minimap out in Map 1's open world, per size (like
// florr.io, 2026-10-16): the corner map shows just the part around you,
// one M press pops up a much wider view, the next one is the big map in
// the middle you can drag and zoom (MAP_WORLD_SPAN times its zoom).
const MAP_WORLD_SPAN = 160
const MAP_SPAN_FOR = { normal: 96, big: 640 }
// Camera views (the camera key, P - like bloxd.io): first person, third
// person from behind, third person from the front. The camera sits up to
// VIEW_DIST blocks away, nearer when a wall is in the way.
const VIEWS = ['first', 'back', 'front']
const VIEW_DIST = 4
// ...and from behind, this much higher (blocks) - over your head.
const VIEW_RISE = 0.6
// Milliseconds per minimap draw spent on detailed open-world tiles (twice
// that on the big map).
const MAP_TILE_BUDGET_MS = 3
// ...and while the big map is being dragged or zoomed, so it never lags
// (2026-10-19, Gaymi: "when moving the map a direction it will lag") - the
// quick stand-in tiles fill the gaps until it stops.
const MAP_MOVING_BUDGET_MS = 1
// Villages/castles are only planned for the map when it shows this few
// cells across or fewer (further out they're too small to see).
const MAP_PLAN_MAX_SPAN = 2000
// The big map zooms in and out with no real limit (2026-10-19, Gaymi:
// "no zoom limit you can zoom big in and out"); MAP_ZOOM_SAFE only keeps
// the numbers from breaking (0.0001x to a million times).
const MAP_ZOOM_SAFE = [1e-4, 1e6]
// Time per draw for the quick stand-in tiles; past it a tile is one flat
// colour until the next draw.
const MAP_COARSE_BUDGET_MS = 3
// The World Map mode's big map stays the block map at every zoom
// (2026-10-24, Gaymi: "it goes from regular to map mode dont make it go to
// map mode") - no flat atlas. Zoomed out past GLOBE_FROM blocks across it
// turns into a globe (EarthGlobe.js; 2026-10-24, "when keep going too much
// make it go to the circle world map"); zoom stops at GLOBE_MOST (200
// degrees, the whole globe).
const GLOBE_FROM = 70 * EARTH_DEG
const GLOBE_MOST = 200 * EARTH_DEG
// One wheel step zooms by at most this much (2026-10-24, "when scrolling
// goes out and in slower") - smaller trackpad steps zoom less.
const MAP_WHEEL_MAX = 1.1
const MAP_WHEEL_RATE = 0.001
const HEIGHT = 1.8
const EYE = 1.62
const CROUCH_HEIGHT = 1.5
const CROUCH_EYE = 1.27
const WALK = 4 // blocks per second (bloxd.io's)
const SPRINT = 7 // Shift + W
const CROUCH = 2
// Bunny hop: a fresh jump within this long of landing keeps the chain
// going; each link speeds you up (bloxd.io's numbers).
const BHOP_WINDOW = 0.12
const BHOP_MULT = [1, 1.15, 1.225, 1.3]
const GROUND_GRIP = 26 // how fast speed follows the keys on the ground
const AIR_GRIP = 11 // ...and in the air (bloxd steers well mid-jump)
const GRAVITY = 30
const JUMP = 8.8 // ~1.3 blocks high
// Swimming: Space rises this fast, letting go sinks no faster than
// SWIM_SINK, and pushing against a wall with your chest (SWIM_CHEST above
// your feet) out of the water springs you out - about 1.6 blocks up.
const SWIM_UP = 4.5
const SWIM_SINK = 2.5
const SWIM_CHEST = 0.9
const SWIM_EXIT = 9.8
const COYOTE = 0.1 // seconds after leaving a ledge you can still jump
const JUMP_BUFFER = 0.15 // a jump pressed this early before landing counts
const STEP_UP = 0.55
const STAIR_STEP = 1.05
const CLIMB = 3.4
const MAX_FALL = 60
const SPRINT_FOV = 8 // degrees added while sprinting
// Kirka-style blocky arms holding the gun, made from the player's own
// skin: each runs from a shoulder off the bottom of the screen to its hand
// spot on the gun (_findHandSpots; positions relative to GUN_OFFSET).
// ARM_PX is the size of one skin pixel across the arm (made wider
// 2026-10-03 - "looks too skinny").
// Shoulders moved in front of the eye and the arms made a little slimmer
// (2026-10-26, Gaymi: "dont just use simple dots ... idk what it is but make
// it more detailed") - starting behind the eye, each arm was cut by the
// near edge of the view into a big flat yellow-green wedge at the bottom
// of the screen. Now you see forearms coming up from below, with a fist
// and a sleeve cuff (buildArms).
const ARM_SHOULDERS = {
  armR: [0.12, -0.42, 0.16],
  armL: [-0.4, -0.46, 0.1],
}
const ARM_PX = 0.03
// Building: both arms (from the skin, as wide as Try Map's) reaching up
// from the bottom of the screen to hold the selected block between them,
// a little right of the middle (camera space). The hands sit right on the
// block's sides (2026-10-03: "looks like not even touching").
const HAND_BLOCK_POS = [0.12, -0.16, -0.64]
const HAND_BLOCK_SIZE = 0.18
const HAND_ARM = [
  { limb: 'armR', shoulder: [0.42, -0.72, -0.34], hand: [0.21, -0.2, -0.64] },
  { limb: 'armL', shoulder: [-0.18, -0.72, -0.34], hand: [0.03, -0.2, -0.64] },
]
const SWING_TIME = 0.25 // seconds
// Map sizes M cycles through (Try Map's own minimap, top-right square):
// normal, big, big in the middle of the screen (as big as the 2nd size).
// The map held in both hands was taken out again (2026-10-19, Gaymi).
const MAP_SIZES = ['normal', 'big', 'center']
const NEAR = 0.012 // camera near plane while trying (world units; a block is 0.35)
// Glass shards flying out of a broken window.
const SHARDS_PER_WINDOW = 14
const SHARD_LIFE = 1.4
// Every window cracks and breaks its own way (2026-10-12, "make more looks
// for when the glass breaks"): one of CRACK_LOOKS crack pictures, and one
// of these ways of falling apart. count is times SHARDS_PER_WINDOW; out/up
// are the push away from you and upward, spread the random scatter, sizes
// how big the pieces are, spin how fast they tumble.
const CRACK_LOOKS = 5
// Breaking a block cracks it a different way each time (2026-10-18, Gaymi:
// "making when breaking a block not always the same way to break like
// windows ... the look when breaking should look different each time"):
// one of DIG_LOOKS crack patterns, turned a random way, growing over
// DIG_STAGES steps as it gets closer to breaking, then one of BREAK_LOOKS
// ways of bursting apart.
const DIG_LOOKS = 10
const DIG_STAGES = 6
// Breaking blocks while playing (_updateDigging): how near (blocks) a block
// has to be.
const DIG_REACH = 5
const BREAK_LOOKS = [
  { name: 'burst', count: 1, out: 2, up: 2.5, spread: 2.5, sizes: [1, 1.3], spin: 12 },
  { name: 'collapse', count: 1.2, out: 0.5, up: 0.4, spread: 1, sizes: [0.9, 1.4], spin: 6 },
  { name: 'blast', count: 1.8, out: 3.6, up: 2, spread: 4, sizes: [0.5, 0.8], spin: 18 },
  { name: 'chunks', count: 0.5, out: 1.4, up: 1.6, spread: 1.6, sizes: [1.6, 2.4], spin: 5 },
]
// Same spot on screen the game holds its gun (WeaponSystem's VIEWMODEL_BASE).
const GUN_OFFSET = new THREE.Vector3(0.26, -0.22, -0.5)
// Aiming down the sights (held right-click, 2026-10-10): the gun comes in
// to the middle of the screen and the view zooms in by AIM_ZOOM degrees.
// Like bloxd.io, the gun is lined up per model (_findHandSpots) so you look
// along its top from behind: its back sits AIM_BACK (+ AIM_BACK_PER_LEN of
// its length, so pistols come closer) in front of the eye, and its highest
// point at the muzzle end sits just under the crosshair (AIM_DROP = tan of
// the angle below it). A fixed spot put every gun's back almost on the
// camera, so it stretched from the bottom of the screen up to the crosshair.
const AIM_OFFSET = new THREE.Vector3(0, -0.06, -0.45)
const AIM_BACK = 0.22
const AIM_BACK_PER_LEN = -0.3
const AIM_DROP = 0.012
// ...and then the whole gun a little higher, so the crosshair sits inside
// the sights / scope instead of on their top edge (2026-10-10, "move them a
// bit higher to fully have the gun aim").
const AIM_SIGHT_RISE = 0.02
// Guns with no sights to look down - the Minigun's big back housing filled
// the screen held up to the eye - are held this far out instead.
const AIM_BACK_FOR = { minigun: 0.28 }
// Guns held a little lower when aiming (the M1911 sat a bit high,
// 2026-10-13).
const AIM_LOWER_FOR = { pistol: 0.01 }
// The top share of a gun's height whose middle the crosshair lines up with.
const TOP_BAND = 0.18
const AIM_ZOOM = 22
// Held V while playing (2026-10-17, Gaymi: "make it zoom inn further"): the
// view narrows to this many degrees - deeper than the editor's ZOOM_FOV.
const PLAY_ZOOM_FOV = 9
const AIM_SPEED = 14
// Scoped guns (PLAY_WEAPONS `scope`, 2026-10-30, Gaymi: "for the awp when
// aiming make it like ... aiming based"): aiming puts your eye to the
// scope - a round lens with a reticle fills the screen, the gun drops out
// of sight and the view zooms in `scope` times. The look turns slower to
// match.
const scopeOf = (id) => PLAY_WEAPONS[id]?.scope || 0
// How far into aiming (0..1) the scope takes over from the gun.
const SCOPE_AT = 0.8
// The gun's kick (2026-10-17, Gaymi: "make it like smoother when shooting
// ... the gun goes back and front very fast, make it more like kirka"). It
// used to jump straight to full kick on every shot and slide back in a
// straight line - on a fast gun that's a jitter. Now each shot pushes a
// spring (RECOIL_SPRING stiffness, RECOIL_DAMP damping - a little under
// critical, so it settles with a soft ease and no wobble): the gun eases
// back, tips up and rolls a touch, then glides home, and rapid fire just
// holds it a little back instead of shaking. RECOIL_KICK is per gun -
// heavy guns kick harder, bullet hoses softer per shot.
const RECOIL_SPRING = 260
const RECOIL_DAMP = 27
const RECOIL_MAX = 1.4
const RECOIL_KICK = { pistol: 26, revolver: 34, rifle: 20, suppressedsmg: 14, minigun: 11, gpmg: 13, shotgun: 38, awp: 40, rocket: 42, launcher: 38, crossbow: 22, flamethrower: 6, voidripper: 22 }
const RECOIL_KICK_DEFAULT = 22
// No flash or smoke from these (no gunpowder).
const NO_MUZZLE_FX = new Set(['crossbow', 'flamethrower', 'melee', 'tomahawk'])
// The Void Ripper's muzzle flash is purple.
const VOID_FLASH = 0xc58bff
// Inspect Weapon (X by default): the gun turns to show its side at an
// angle, holds there, and turns back - seconds for each part.
const INSPECT_IN = 0.3
const INSPECT_HOLD = 1.3
const INSPECT_OUT = 0.35

export class BuildTryMode {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.active = false
    this.pos = new THREE.Vector3() // feet, in blocks
    this.vel = new THREE.Vector3() // blocks per second
    this.onGround = false
    this._bob = 0
    this._recoil = 0
    this._kickVel = 0
    this._kickRoll = 0
    this._muzzle = null
    this._fx = null
    this.aiming = false
    this.aimAmount = 0
    this._inspectT = -1
    this._spawn = new THREE.Vector3()
    this._gunScene = null
    this._gunCamera = null
    this._gun = null
    this._gunId = null
    this._coyote = 0
    this._jumpBuffer = 0
    this._spaceWasDown = false
    this._groundTime = 0
    this._hopChain = 0
    this._landedFromJump = false
    this._jumpedAt = false
    this._crouch = false
    this._height = HEIGHT
    this._eye = EYE
    this._baseFov = null
    this._arms = null
    this._armsUrl = null
    this._mapMode = 0
    this.view = 0
    this._mapPan = { x: 0, z: 0 }
    this._mapZoom = 1
    this._mapEl = null
    this._mapCanvas = null
    this._mapImage = null
    this._mapDrawAt = 0
    this._cracked = new Map() // cell key -> { x, y, z }
    this._broken = new Map() // cell key -> { x, y, z, type, state, terrain }
    this._dig = null // the block being broken: { key, x, y, z, type, need, t }
    this._crackMeshes = []
    this._crackMaterials = []
    this._shards = []
    this._shardGeometries = null
    this._shardMaterials = new Map()
    this._underwater = null
    this._underwaterEl = null
    this._baseNear = null
  }

  // --- Minimap (top-right square; M makes it big, then big in the middle) ---
  _ensureMapEl() {
    if (this._mapEl) return
    this._mapEl = document.createElement('div')
    this._mapEl.id = 'build-try-map'
    this._mapEl.style.display = 'none'
    this._mapCanvas = document.createElement('canvas')
    this._mapEl.appendChild(this._mapCanvas)
    this._mapHintEl = document.createElement('div')
    this._mapHintEl.id = 'build-try-map-hint'
    this._mapEl.appendChild(this._mapHintEl)
    // Phones have no M key (2026-10-23): tapping the corner map makes it
    // bigger, and the middle one has a close button.
    this._mapCloseEl = document.createElement('button')
    this._mapCloseEl.id = 'build-try-map-close'
    this._mapCloseEl.type = 'button'
    this._mapCloseEl.textContent = '✕'
    this._mapCloseEl.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this._mapInteractive()) this.cycleMap()
    })
    this._mapEl.appendChild(this._mapCloseEl)
    this._mapEl.addEventListener('click', () => {
      if (this.active && !this._mapInteractive() && document.body.classList.contains('touch-play-on')) this.cycleMap()
    })
    document.body.appendChild(this._mapEl)
    window.addEventListener('resize', () => { if (this._mapEl.style.display !== 'none') this._applyMapMode() })
    // The big map in the middle can be moved around (2026-10-12, Gaymi:
    // "make it moveable so you can see further"): drag to look around,
    // scroll to zoom out and in, double-click to come back to you.
    // Two fingers pinch to zoom on a phone.
    let drag = null
    const fingers = new Map()
    let pinch = 0
    const spread = () => {
      const [a, b] = [...fingers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    this._mapCanvas.addEventListener('pointerdown', (e) => {
      if (!this._mapInteractive()) return
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (fingers.size === 2) pinch = spread()
      drag = { x: e.clientX, y: e.clientY }
      this._mapCanvas.setPointerCapture?.(e.pointerId)
      this._mapEl.classList.add('dragging')
    })
    this._mapCanvas.addEventListener('pointermove', (e) => {
      if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (fingers.size >= 2) {
        const d = spread()
        if (pinch > 0 && d > 0) this.zoomMap(pinch / d)
        pinch = d
        return
      }
      if (!drag) return
      const cellsPerPx = this._mapSpan() / this._mapCanvas.clientWidth
      this._mapPan.x -= (e.clientX - drag.x) * cellsPerPx
      this._mapPan.z -= (e.clientY - drag.y) * cellsPerPx
      this._clampMapPan()
      drag = { x: e.clientX, y: e.clientY }
      this._mapDrawAt = 0
    })
    const endDrag = (e) => {
      fingers.delete(e.pointerId)
      pinch = 0
      const left = [...fingers.values()][0]
      drag = left ? { x: left.x, y: left.y } : null
      if (!drag) this._mapEl.classList.remove('dragging')
    }
    this._mapCanvas.addEventListener('pointerup', endDrag)
    this._mapCanvas.addEventListener('pointercancel', endDrag)
    this._mapCanvas.addEventListener('dblclick', () => {
      this._mapPan = { x: 0, z: 0 }
      this._mapZoom = this._mapOpenZoom()
      this._mapDrawAt = 0
    })
    this._mapEl.addEventListener('wheel', (e) => {
      if (!this._mapInteractive()) return
      e.preventDefault()
      const step = Math.min(Math.log(MAP_WHEEL_MAX), Math.abs(e.deltaY) * MAP_WHEEL_RATE)
      this.zoomMap(Math.exp(e.deltaY > 0 ? step : -step))
    }, { passive: false })
  }

  // The big map in the middle opens showing as much as the 2nd size
  // (2026-10-19, Gaymi: "should be like the second image") - in the World
  // Map mode too, zooming out from there to the atlas and the globe.
  _mapOpenZoom() {
    if (!this.bm.world?.active) return 1
    return MAP_SPAN_FOR.big / MAP_WORLD_SPAN
  }

  _mapInteractive() {
    return this.active && MAP_SIZES[this._mapMode] === 'center'
  }

  // The big map always has the mouse free (2026-10-13, "when I press M the
  // mouse should pop up") - let go of it again if anything caught it.
  _freeMouseForMap() {
    if (this._mapInteractive() && document.pointerLockElement) {
      try { document.exitPointerLock() } catch { /* not available */ }
    }
  }

  // Cells across the map right now (the open world's window, or the
  // whole 128x128 map), times the zoom.
  _mapSpan() {
    if (this.bm.world?.active) {
      const fixed = this.active ? MAP_SPAN_FOR[MAP_SIZES[this._mapMode]] : MAP_SPAN_FOR.normal
      return fixed || MAP_WORLD_SPAN * this._mapZoom
    }
    return (this._mapImage?.width || 128) * this._mapZoom
  }

  zoomMap(factor) {
    // The World Map mode stops once the whole globe is in view.
    const most = this.bm.world?.active && isEarthWorld() ? GLOBE_MOST / MAP_WORLD_SPAN : MAP_ZOOM_SAFE[1]
    this._mapZoom = Math.min(most, Math.max(MAP_ZOOM_SAFE[0], this._mapZoom * factor))
    this._mapDrawAt = 0
    this._mapMovedAt = performance.now()
  }

  // The big map can be dragged as far as you like (2026-10-19, Gaymi: "no
  // moving limit").
  _clampMapPan() {
    // The globe stops at 80 degrees north and south.
    if (this.bm.world?.active && isEarthWorld()) this._mapPan.z = Math.max(-80 * EARTH_DEG - this.pos.z, Math.min(80 * EARTH_DEG - this.pos.z, this._mapPan.z))
    this._mapDrawAt = 0
    this._mapMovedAt = performance.now()
  }

  // The World Map mode's whole-Earth picture (OpenWorld.earthPicture) for
  // the view starting at block (ox, oz), k canvas pixels a block - again
  // past longitude 180, since the Earth goes round.
  _drawEarthPicture(ctx, canvas, ox, oz, k, span) {
    const per = canvas.width / (360 * EARTH_DEG) // picture pixels a block
    const world = 360 * EARTH_DEG
    const west = -180 * EARTH_DEG
    const north = -90 * EARTH_DEG
    for (let x0 = west + Math.floor((ox - west) / world) * world; x0 < ox + span; x0 += world) {
      ctx.drawImage(canvas, (x0 - ox) * k, (north - oz) * k, world * k, (canvas.height / per) * k)
    }
  }

  // Out in Map 1's open world, the biome you're in (and the place, in a
  // village/castle/bridge) shows under the map.
  _showBiome(x, z) {
    if (!this._biomeEl) {
      this._biomeEl = document.createElement('div')
      this._biomeEl.id = 'build-try-biome'
      this._mapEl.appendChild(this._biomeEl)
    }
    const cx = Math.floor(x)
    const cz = Math.floor(z)
    // The World Map mode: "Country · Province · City" (EarthPlaces.js).
    const earth = x !== null && this.bm.world?.active && isEarthWorld() && !inCity(cx, cz) ? placeNameAt(-z / EARTH_DEG, x / EARTH_DEG) : ''
    if (earth) {
      if (this._biomeEl.textContent !== earth) this._biomeEl.textContent = earth
      this._biomeEl.style.display = ''
      return
    }
    const biome = x === null || inCity(cx, cz) ? '' : biomeName(sampleLand(cx, cz).biome)
    // Inside a village, castle or bridge (WorldStructures.js) it says so too.
    const place = biome ? this.bm.world?.placeName(cx, cz) : ''
    const name = place ? `${place} · ${biome}` : biome
    if (this._biomeEl.textContent !== name) this._biomeEl.textContent = name
    this._biomeEl.style.display = name ? '' : 'none'
  }

  cycleMap() {
    this._mapMode = (this._mapMode + 1) % MAP_SIZES.length
    this._applyMapMode()
  }

  // While building the map is always the small corner one (M is Mirror
  // there); Try Map brings back the size picked with M.
  _applyMapMode() {
    if (!this._mapEl) return
    this._mapEl.dataset.size = this.active ? MAP_SIZES[this._mapMode] : 'normal'
    // The big map frees the mouse so it can be dragged; closing it puts
    // the view back on you and catches the mouse again.
    const interactive = this._mapInteractive()
    if (interactive !== this._mapEl.classList.contains('interactive')) {
      this._mapEl.classList.toggle('interactive', interactive)
      this._mapPan = { x: 0, z: 0 }
      // The World Map mode's big map opens as a real-world atlas.
      this._mapZoom = interactive ? this._mapOpenZoom() : 1
      const canvas = this.bm.renderer.domElement
      try {
        if (interactive) document.exitPointerLock()
        else if (this.active && !this.bm.menuOpen) canvas.requestPointerLock()?.catch(() => {})
      } catch {
        // No pointer lock here (tests).
      }
    }
    const touch = document.body.classList.contains('touch-play-on')
    this._mapHintEl.textContent = interactive ? t(touch ? 'mapDragHintTouch' : 'mapDragHint') : ''
    this._mapCloseEl.setAttribute('aria-label', t('mapCloseBtn'))
    // Drawn at the size it's shown, so the blocks stay crisp.
    const px = Math.max(1, Math.round(this._mapEl.clientWidth * Math.min(window.devicePixelRatio || 1, 2)))
    this._mapCanvas.width = px
    this._mapCanvas.height = px
    this._mapDrawAt = 0
    this._mapVersion = -1
    this._mapBuiltAt = 0
  }

  // Building (not trying): the same minimap, following the flying camera.
  // The picture is redrawn from the blocks at most every 1.5s after an
  // edit (it reads every block, so not every frame).
  drawBuildMap(now, visible) {
    this._ensureMapEl()
    if (!visible) {
      this._mapEl.style.display = 'none'
      return
    }
    if (this._mapEl.style.display === 'none') {
      this._mapEl.style.display = 'block'
      this._applyMapMode()
    }
    if (!this._mapImage || (this._mapVersion !== this.bm._mapVersion && now - this._mapBuiltAt > 1500)) {
      this._mapImage = this.bm._buildTopDownMap()
      this._mapVersion = this.bm._mapVersion
      this._mapBuiltAt = now
      this._mapDrawAt = 0
    }
    const cam = this.bm.camera.position
    this._drawMap(now, cam.x / this.B, cam.z / this.B)
  }

  _drawMap(now, x = this.pos.x, z = this.pos.z) {
    // Redrawn every frame while the big map is being dragged or zoomed (it
    // used to keep to ~16 a second, which felt laggy), else ~16 a second.
    const moving = this._mapInteractive() && (this._mapEl.classList.contains('dragging') || now - (this._mapMovedAt || 0) < 300)
    if (!this._mapImage || (!moving && now - this._mapDrawAt < 60)) return
    this._mapDrawAt = now
    const c = this._mapCanvas
    const ctx = c.getContext('2d')
    const s = c.width
    const cells = this._mapImage.width
    ctx.imageSmoothingEnabled = false
    // Map cell (cx, cz) -> canvas: the whole city, or - with Map 1's open
    // world - a window of the land around you, you in the middle.
    this._freeMouseForMap()
    const world = this.bm.world?.active ? this.bm.world : null
    const moved = this._mapZoom !== 1 || this._mapPan.x || this._mapPan.z
    const windowed = world || moved
    const span = windowed ? this._mapSpan() : cells
    const ox = windowed ? (world ? x : 0) + this._mapPan.x - span / 2 : -cells / 2
    const oz = windowed ? (world ? z : 0) + this._mapPan.z - span / 2 : -cells / 2
    const k = s / span
    // The World Map mode's big map zoomed far out: the globe.
    const earth = !!world && isEarthWorld()
    const pic = earth ? world.earthPicture() : null
    const globeView = earth && this._mapInteractive() && span > GLOBE_FROM
    // Solid, not see-through: the world behind showed through as blocks.
    if (earth !== this._mapEl.classList.contains('earth')) this._mapEl.classList.toggle('earth', earth)
    if (globeView !== this._mapEl.classList.contains('globe')) {
      this._mapEl.classList.toggle('globe', globeView)
      if (globeView && !this._globe) this._globe = new EarthGlobe(this._mapEl)
      this._globe?.show(globeView)
    }
    if (!world && windowed) {
      ctx.fillStyle = '#1d2a1a'
      ctx.fillRect(0, 0, s, s)
      ctx.drawImage(this._mapImage, (-cells / 2 - ox) * k, (-cells / 2 - oz) * k, cells * k, cells * k)
      this._showBiome(null)
    } else if (globeView) {
      // The map's middle faces you; you're the arrow on it.
      this._globe.setPicture(pic)
      const yawNow = this.bm._yaw
      this._globe.draw(s, -(oz + span / 2) / EARTH_DEG, (ox + span / 2) / EARTH_DEG, span / EARTH_DEG, { lat: -z / EARTH_DEG, lon: x / EARTH_DEG, ang: Math.atan2(-Math.cos(yawNow), -Math.sin(yawNow)) })
      this._showBiome(x, z)
      // Spinning/zooming: keep drawing every frame.
      if (moving) this._mapDrawAt = 0
      return
    } else if (world) {
      ctx.fillStyle = '#1d2a1a'
      ctx.fillRect(0, 0, s, s)
      // The World Map mode: the whole-Earth picture underneath, so tiles
      // not drawn yet show the right land (just less sharp) instead of
      // squares filling in.
      if (pic) this._drawEarthPicture(ctx, pic.canvas, ox, oz, k, span)
      // Tiles grow with the view (32 cells, 64, 128...), so a zoomed-out map
      // still needs only about a hundred of them.
      world.prewarmMap(x, z, earth ? GLOBE_FROM : GLOBE_MOST)
      let T = 32
      while (span / T > 10) T *= 2
      // Detailed tiles (1024 noise reads each) are drawn a few milliseconds'
      // worth per draw, nearest the middle first; until a tile's turn comes
      // a quick coarse one stands in (made within its own small budget -
      // past it, one flat colour), so nothing shows as a dark gap.
      const until = performance.now() + (moving ? MAP_MOVING_BUDGET_MS : this._mapInteractive() ? MAP_TILE_BUDGET_MS * 2 : MAP_TILE_BUDGET_MS)
      const coarseUntil = until + MAP_COARSE_BUDGET_MS
      // The villages/castles/bridges in view get planned, one per draw -
      // never mid-drag (one castle takes ~10ms) or zoomed far out.
      if (MAP_SIZES[this._mapMode] !== 'normal' && !moving && span <= MAP_PLAN_MAX_SPAN) world.prefetchPlansAround(ox + span / 2, oz + span / 2, span / 2)
      const tiles = []
      for (let tx = Math.floor(ox / T); tx <= Math.floor((ox + span) / T); tx++) {
        for (let tz = Math.floor(oz / T); tz <= Math.floor((oz + span) / T); tz++) {
          tiles.push([((tx + 0.5) * T - ox - span / 2) ** 2 + ((tz + 0.5) * T - oz - span / 2) ** 2, tx, tz])
        }
      }
      tiles.sort((a, b) => a[0] - b[0])
      let missing = false
      // Land drawn smooth, like a real map (OpenWorld._drawTile).
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      for (const [, tx, tz] of tiles) {
        // A sharp tile is up to 128x128 samples (~15 ms): drawn by the
        // map's tile workers (OpenWorld._requestTile), asked for at any
        // time. Without them none is drawn here mid-drag/zoom - the
        // stand-ins below are already sharp enough.
        const tile = world.mapTile(tx, tz, world.tilesOffThread() || (performance.now() < until && (!moving || T <= 64)), T)
        if (!tile) missing = true
        // Not drawn yet: the smaller tiles inside it (zooming out), else a
        // bigger, already drawn tile's piece (zooming in - the map is drawn
        // ahead at every zoom when the game starts, OpenWorld.prewarmMap),
        // so zooming never shows it loading.
        const kids = tile ? null : world.mapTileChildren(tx, tz, T)
        if (kids) {
          for (const [cv, fx, fz, f] of kids) ctx.drawImage(cv, (tx * T + fx * T - ox) * k, (tz * T + fz * T - oz) * k, f * T * k + 0.5, f * T * k + 0.5)
          continue
        }
        const part = tile ? null : world.mapTilePart(tx, tz, T)
        // The Earth picture underneath is already as sharp as a stand-in.
        if (!tile && !part && pic) continue
        const img = tile ? tile.canvas : part ? null : world.mapTileCoarse(tx, tz, T, performance.now() < coarseUntil)
        if (part) ctx.drawImage(part.canvas, part.sx, part.sy, part.sw, part.sw, (tx * T - ox) * k, (tz * T - oz) * k, T * k + 0.5, T * k + 0.5)
        else if (img) ctx.drawImage(img, (tx * T - ox) * k, (tz * T - oz) * k, T * k + 0.5, T * k + 0.5)
        else {
          const color = world._cellColor(tx * T + T / 2, tz * T + T / 2)
          ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
          ctx.fillRect((tx * T - ox) * k, (tz * T - oz) * k, T * k + 0.5, T * k + 0.5)
        }
      }
      // Not all drawn yet: come back next frame instead of waiting out
      // the usual redraw gap.
      if (missing) this._mapDrawAt = 0
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this._mapImage, (-cells / 2 - ox) * k, (-cells / 2 - oz) * k, cells * k, cells * k)
      this._showBiome(x, z)
    } else {
      ctx.drawImage(this._mapImage, 0, 0, s, s)
      this._showBiome(null)
    }
    // Zombie Extraction's helicopter: a pulsing red ring.
    const ex = this.bm.survival?._extract
    if (ex) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180)
      ctx.beginPath()
      ctx.arc((ex.x - ox) * k, (ex.z - oz) * k, Math.max(4, s / 40) * (1 + pulse * 0.5), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(230, 60, 40, 0.85)'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = Math.max(1.5, s / 120)
      ctx.fill()
      ctx.stroke()
    }
    // Where you are, and which way you're looking.
    const px = (x - ox) * k
    const pz = (z - oz) * k
    const yaw = this.bm._yaw
    const ang = Math.atan2(-Math.cos(yaw), -Math.sin(yaw))
    const r = Math.max(5, s / 34)
    ctx.save()
    ctx.translate(px, pz)
    ctx.rotate(ang)
    ctx.beginPath()
    ctx.moveTo(r * 1.4, 0)
    ctx.lineTo(-r, r * 0.85)
    ctx.lineTo(-r * 0.45, 0)
    ctx.lineTo(-r, -r * 0.85)
    ctx.closePath()
    ctx.fillStyle = '#ffde5c'
    ctx.strokeStyle = '#1a1408'
    ctx.lineWidth = Math.max(1.5, r / 4)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  // --- Collision, in block units ---
  // Every block cell the body's box overlaps, checked against how much of
  // that cell is solid (a slab is the bottom half, most blocks all of it).
  // zombie: a zombie's body (Ghost Blocks stop zombies but not you).
  _hits(x, y, z, height = this._height, zombie = false) {
    const x0 = Math.floor(x - HALF_WIDTH + 1e-4)
    const x1 = Math.floor(x + HALF_WIDTH - 1e-4)
    const z0 = Math.floor(z - HALF_WIDTH + 1e-4)
    const z1 = Math.floor(z + HALF_WIDTH - 1e-4)
    const y0 = Math.floor(y + 1e-4)
    const y1 = Math.floor(y + height - 1e-4)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = y0; cy <= y1; cy++) {
          const top = this.bm._cellSolidTop(cx, cy, cz)
          if (!(top > 0 && y < cy + top - 1e-4 && y + height > cy + 1e-4)) continue
          if (!zombie && this.bm._blocks.at(cx, cy, cz) === 'ghostblock') continue
          // A narrow block (bamboo) only blocks its own thin middle.
          const inset = this.bm._cellInset(cx, cy, cz)
          if (inset && (x + HALF_WIDTH <= cx + inset || x - HALF_WIDTH >= cx + 1 - inset || z + HALF_WIDTH <= cz + inset || z - HALF_WIDTH >= cz + 1 - inset)) continue
          return true
        }
      }
    }
    return false
  }

  _touching(x, y, z, test) {
    const x0 = Math.floor(x - HALF_WIDTH)
    const x1 = Math.floor(x + HALF_WIDTH)
    const z0 = Math.floor(z - HALF_WIDTH)
    const z1 = Math.floor(z + HALF_WIDTH)
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      for (let cy = Math.floor(y); cy <= Math.floor(y + this._height - 0.01); cy++) if (test(cx, cy, cz)) return true
    }
    return false
  }

  // Moves along one axis, stopping flush against whatever's in the way.
  _moveAxis(p, axis, amount) {
    if (!amount) return false
    const tryAt = (d) => {
      const q = { x: p.x, y: p.y, z: p.z }
      q[axis] += d
      return this._hits(q.x, q.y, q.z) ? null : q
    }
    const full = tryAt(amount)
    if (full) {
      p[axis] = full[axis]
      return false
    }
    // Blocked: close the gap in a few halving steps.
    let lo = 0
    let hi = amount
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2
      if (tryAt(mid)) lo = mid
      else hi = mid
    }
    p[axis] += lo
    return true
  }

  enter() {
    const B = this.B
    const cam = this.bm.camera
    // Start where the camera is; if that's inside a block, rise until free.
    this._crouch = false
    this._height = HEIGHT
    this._eye = EYE
    const p = { x: cam.position.x / B, y: cam.position.y / B - EYE, z: cam.position.z / B }
    for (let i = 0; i < 200 && this._hits(p.x, p.y, p.z); i++) p.y += 1
    this.pos.set(p.x, p.y, p.z)
    this._spawn.copy(this.pos)
    this.vel.set(0, 0, 0)
    this.onGround = false
    this._coyote = 0
    this._jumpBuffer = 0
    this._hopChain = 0
    this._groundTime = 0
    this._baseFov = cam.fov
    // The flying camera's near plane (0.1) is a third of a block: walking
    // right up to a wall let the view cut into it and see through. The
    // body keeps the eyes 0.3 blocks from any wall, so a much nearer plane
    // never clips.
    this._baseNear = cam.near
    cam.near = NEAR
    cam.updateProjectionMatrix()
    this._flyPos = cam.position.clone()
    this.active = true
    this._showGun()
    this._ensureMapEl()
    this._mapImage = this.bm._buildTopDownMap()
    this._mapVersion = this.bm._mapVersion
    this._mapBuiltAt = performance.now()
    this._mapEl.style.display = 'block'
    this._applyMapMode()
    this.bm.specials.start()
  }

  exit() {
    this.active = false
    this.view = 0
    if (this._body) this._body.group.visible = false
    this.aiming = false
    this.aimAmount = 0
    this._updateScope()
    this._inspectT = -1
    this.bm.gadgets.releasePlates()
    this.bm.specials.stop()
    this._restoreWindows()
    if (this._mapEl) this._mapEl.style.display = 'none'
    if (this._baseFov !== null) {
      this.bm.camera.fov = this._baseFov
      this._baseFov = null
    }
    if (this._baseNear != null) {
      this.bm.camera.near = this._baseNear
      this._baseNear = null
    }
    this.bm.camera.updateProjectionMatrix()
    this._setUnderwater(null)
    if (this._gun) this._gun.visible = false
    this._fx?.clear()
    this._recoil = this._kickVel = this._kickRoll = 0
  }

  update(dt, keys) {
    dt = Math.min(dt, 1 / 30)
    const B = this.B
    const p = { x: this.pos.x, y: this.pos.y, z: this.pos.z }
    const cam = this.bm.camera
    const yaw = this.bm._yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    let mx = 0
    let mz = 0
    // Settings > Controls (Keybinds.js) - W/A/S/D by default.
    const fwd = heldAction(keys, 'moveForward')
    const back = heldAction(keys, 'moveBack')
    const left = heldAction(keys, 'moveLeft')
    const right = heldAction(keys, 'moveRight')
    if (fwd) { mx += fx; mz += fz }
    if (back) { mx -= fx; mz -= fz }
    if (right) { mx -= fz; mz += fx }
    if (left) { mx += fz; mz -= fx }
    // Phone stick (BuildTouch): the same directions, but any amount.
    const stick = this.bm._touchMove
    if (stick) {
      mx += fx * stick.y - fz * stick.x
      mz += fz * stick.y + fx * stick.x
    }
    // Driving the go-kart (GoKart.js): the keys drive it, you sit in it -
    // no walking or jumping; looking round, shooting and the rest go on.
    const kart = this.bm.survival?.active ? this.bm.survival.kart : null
    if (kart?.driving) {
      kart.drive(dt, { fwd, back, left, right, stick })
      this.vel.set(0, 0, 0)
      this.onGround = true
      this.pos.set(kart.x, kart.y + 0.01, kart.z)
      cam.position.set(kart.x * B, (kart.y + KART_EYE) * B, kart.z * B)
      this.updateHands(dt, keys, false, false)
      this.bm.specials.update(dt, this.pos)
      this._drawMap(performance.now())
      return
    }
    const len = Math.hypot(mx, mz)
    // A stick pushed only part way walks slower (keys are all or nothing).
    const amount = stick && !fwd && !back && !left && !right ? Math.min(1, len) : 1
    // Crouch while a crouch key is held - standing back up waits until
    // there's room overhead.
    const crouchHeld = heldAction(keys, 'crouch')
    if (crouchHeld !== this._crouch && (crouchHeld || !this._hits(p.x, p.y, p.z, HEIGHT))) {
      this._crouch = crouchHeld
      this._height = crouchHeld ? CROUCH_HEIGHT : HEIGHT
    }
    const crouch = this._crouch
    // Shrunk by a Shrink Pad: a smaller body fits through 1-block gaps.
    const size = this.bm.specials.bodySize()
    this._height = (crouch ? CROUCH_HEIGHT : HEIGHT) * Math.min(1, size)
    // Run: Shift while walking forward (bloxd.io's Shift + W).
    // Settings > Controls > Sprint: Tap to Sprint (2026-10-30) - one press
    // turns running on until you stop going forward or press it again
    // (it can be pressed just before walking off).
    const sprintKey = heldAction(keys, 'sprint')
    let sprintWanted = sprintKey
    if (this.bm.game?.settings?.sprintMode === 'toggle') {
      if (sprintKey && !this._sprintKeyWas) this._sprintOn = !this._sprintOn
      // Letting go of forward (or pressing back) ends the run.
      if ((this._fwdWas && !fwd) || back) this._sprintOn = false
      sprintWanted = !!this._sprintOn
    }
    this._sprintKeyWas = sprintKey
    this._fwdWas = fwd
    const sprint = !crouch && ((sprintWanted && fwd && !back) || !!stick?.run)
    const inLiquid = this._touching(p.x, p.y, p.z, (x, y, z) => this.bm._cellIsLiquid(x, y, z))
    const onLadder = this._touching(p.x, p.y, p.z, (x, y, z) => this.bm._cellIsLadder(x, y, z))
    // Staying on the ground past the hop window ends a bunny-hop chain.
    if (this.onGround) {
      this._groundTime += dt
      if (this._groundTime > BHOP_WINDOW) this._hopChain = 0
    }
    // speedMult: Map 1's Choose Class (Runner/Tank, set by BuildSurvival).
    // Special blocks underfoot (sticky floor, speed pads...) change it too.
    let speed = (crouch ? CROUCH : sprint ? SPRINT : WALK) * (this.speedMult ?? 1) * this.bm.specials.speedMult
    speed *= BHOP_MULT[this._hopChain]
    // Slower in water - unless you took a boat from a Boat Dock.
    if (inLiquid) speed *= 0.7 * (this.bm.specials._buff('boat') || 1)
    // Wading through flood water (Disasters.js).
    speed *= this.bm.sky?.disasters?.slow ?? 1
    // Standing in a bloater's slime puddle (ZombieTricks.js).
    speed *= this.bm.survival?.tricks?.slow ?? 1
    const want = len ? (speed * amount) / len : 0
    // Freezing rain glazes the ground: you slide about (BuildWeather.glaze).
    const glaze = this.onGround ? this.bm.sky?.weather3d?.glaze() || 0 : 0
    const grip = (this.onGround ? GROUND_GRIP : AIR_GRIP) * this.bm.specials.gripMult * (1 - glaze * 0.75)
    // The wind (stronger in worse weather) and a disaster's push - a
    // flood's current, an avalanche, a shockwave - carry you along a
    // little (2026-10-30, Gaymi: "wind effects that could blow you
    // slightly"). Not in water, on a ladder, or while spectating.
    const push = this.bm.sky && !inLiquid && !onLadder && !this.bm.spectate?.active ? this.bm.sky.windPush(this._push || (this._push = new THREE.Vector2()), this.onGround) : null
    this.vel.x = THREE.MathUtils.damp(this.vel.x, mx * want + (push?.x || 0), grip, dt)
    this.vel.z = THREE.MathUtils.damp(this.vel.z, mz * want + (push?.y || 0), grip, dt)

    // Jump timing: coyote time after leaving the ground, a buffered press
    // just before landing, and holding Space hops again on every landing.
    const spaceDown = heldAction(keys, 'jump')
    if (spaceDown && !this._spaceWasDown) this._jumpBuffer = JUMP_BUFFER
    this._spaceWasDown = spaceDown
    this._coyote = this.onGround ? COYOTE : Math.max(0, this._coyote - dt)
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt)

    if (onLadder) {
      const up = fwd || spaceDown || (stick?.y ?? 0) > 0.3
      const down = back || (stick?.y ?? 0) < -0.3
      this.vel.y = up ? CLIMB : down ? -CLIMB : -1
    } else if (inLiquid) {
      // Freer water (2026-10-12, Gaymi: "you can't jump in water and you're
      // kinda trapped if there's a higher block"): Space swims up faster,
      // jumps off the bottom, and pressed against a wall with your chest
      // out of the water it springs you up onto a ledge as high as
      // SWIM_EXIT_HEIGHT, like climbing out of a pool. A jump's speed eases
      // off instead of being cut.
      const chestOut = !this.bm._cellIsLiquid(Math.floor(p.x), Math.floor(p.y + SWIM_CHEST), Math.floor(p.z))
      if (spaceDown && this._pushingWall && chestOut) this.vel.y = Math.max(this.vel.y, SWIM_EXIT)
      else if (this._jumpBuffer > 0 && this.onGround) {
        this.vel.y = JUMP
        this._jumpBuffer = 0
      }
      if (spaceDown) this.vel.y = Math.max(SWIM_UP, this.vel.y - GRAVITY * 0.6 * dt)
      else this.vel.y = Math.max(this.vel.y - GRAVITY * (this.vel.y > 0 ? 0.6 : 0.2) * dt, -SWIM_SINK)
    } else {
      // Holding Space keeps hopping: jumps again the moment you land.
      if ((this._jumpBuffer > 0 || (spaceDown && this.onGround)) && this._coyote > 0) {
        // Jumping again right as you land (a press just before, or Space
        // held down) adds a link to the bunny-hop chain; a late one doesn't.
        const timed = this.onGround && this._groundTime <= BHOP_WINDOW && this._landedFromJump
        this._hopChain = timed ? Math.min(BHOP_MULT.length - 1, this._hopChain + 1) : 0
        this._landedFromJump = false
        this._jumpedAt = true
        this.vel.y = JUMP
        this._jumpBuffer = 0
        this._coyote = 0
        this.onGround = false
      }
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -MAX_FALL)
    }

    // Horizontal moves, stepping up onto a slab (or a stair) on the way.
    const stairs = (x, y, z) => this.bm._cellIsStairs(x, y, z)
    this._pushingWall = false
    for (const axis of ['x', 'z']) {
      const amount = this.vel[axis] * dt
      if (!amount) continue
      const before = p[axis]
      const blocked = this._moveAxis(p, axis, amount)
      // Crouching on the ground never walks you off an edge (anything
      // deeper than a step).
      if (crouch && this.onGround && !onLadder && !inLiquid && !this._hits(p.x, p.y - STEP_UP - 0.05, p.z)) {
        p[axis] = before
        this.vel[axis] = 0
        continue
      }
      if (blocked && (this.onGround || onLadder)) {
        const ahead = { x: p.x, y: p.y, z: p.z }
        ahead[axis] += Math.sign(amount) * 0.05
        const heights = this._touching(ahead.x, ahead.y, ahead.z, stairs) ? [STEP_UP, STAIR_STEP] : [STEP_UP]
        let didStep = false
        for (const h of heights) {
          const q = { x: p.x, y: p.y + h, z: p.z }
          q[axis] = before
          if (this._hits(q.x, q.y, q.z)) continue
          const stepped = { ...q }
          this._moveAxis(stepped, axis, amount)
          if (Math.abs(stepped[axis] - before) > Math.abs(p[axis] - before) + 1e-3) {
            // Settle back down onto what we stepped up on.
            this._moveAxis(stepped, 'y', -h)
            Object.assign(p, stepped)
            didStep = true
            break
          }
        }
        if (didStep) continue
      }
      if (blocked) {
        this.vel[axis] = 0
        this._pushingWall = true
      }
    }
    const falling = this.vel.y <= 0
    const hitY = this._moveAxis(p, 'y', this.vel.y * dt)
    const wasOnGround = this.onGround
    this.onGround = hitY && falling
    if (this.onGround && !wasOnGround) {
      this._groundTime = 0
      this._landedFromJump = !!this._jumpedAt
      this._jumpedAt = false
    }
    if (hitY) this.vel.y = 0

    // Never off the map: held inside the 128x128 ground (or, on Map 1 with
    // its open world, inside the world's far limit), and anyone who still
    // falls out (dug through the bottom) comes back to where they started.
    const half = this.bm.world?.active ? WORLD_LIMIT : 64
    p.x = Math.max(-half + HALF_WIDTH, Math.min(half - HALF_WIDTH, p.x))
    p.z = Math.max(-half + HALF_WIDTH, Math.min(half - HALF_WIDTH, p.z))
    if (p.y < BOTTOM - 16) {
      Object.assign(p, { x: this._spawn.x, y: this._spawn.y, z: this._spawn.z })
      this.vel.set(0, 0, 0)
    }
    this.pos.set(p.x, p.y, p.z)

    // Camera at eye height, with only a faint bob while walking, and the
    // view widening a little while sprinting.
    const moving = this.onGround && Math.hypot(this.vel.x, this.vel.z) > 0.5
    this._bob += moving ? dt * (sprint ? 13 : 9) : 0
    const bob = moving ? Math.sin(this._bob) * 0.015 : 0
    this._eye = THREE.MathUtils.damp(this._eye, (crouch ? CROUCH_EYE : EYE) * size, 18, dt)
    cam.position.set(p.x * B, (p.y + this._eye + bob) * B, p.z * B)
    this.updateHands(dt, keys, moving, sprint)
    // Pressure plates under you (and under zombies while playing).
    const play = this.bm.survival
    this.bm.gadgets.updatePlates([[Math.floor(p.x), Math.floor(p.y + 0.01), Math.floor(p.z)], ...(play?.active ? play.zombieCells() : [])], dt)
    // Special blocks you stand on, near or touch (BuildSpecials.js).
    this.bm.specials.update(dt, p)
    this._drawMap(performance.now())
    this._setUnderwater(this._liquidAtEye(p))
  }

  // Everything after moving: zoom, the gun (aim, recoil, inspect), digging,
  // shards and the body. Spectating (PlaySpectate.js) runs it too, so the
  // gun, aiming and breaking blocks work while flying (2026-10-18, Gaymi:
  // "every feature that works regularly in game should work in spectating").
  updateHands(dt, keys, moving = false, sprint = false) {
    dt = Math.min(dt, 1 / 30)
    const cam = this.bm.camera
    if (this._baseFov !== null) {
      const zoom = keys?.has(FIXED_KEYS.buildZoom)
      // Only a gun zooms when you aim (2026-10-30, Gaymi: "if not holding
      // gun and right clicking don't make the screen zoom in") - a block,
      // an item or the knife (aimed to throw) keeps the normal view.
      const aimZoom = !this.aimZooms() ? 0 : scopeOf(this._gunId) ? this._baseFov * (1 - 1 / scopeOf(this._gunId)) : AIM_ZOOM
      const target = zoom ? PLAY_ZOOM_FOV : this._baseFov + (sprint && !this.aiming ? SPRINT_FOV : 0) - aimZoom * this.aimAmount
      const fov = THREE.MathUtils.damp(cam.fov, target, 10, dt)
      if (Math.abs(fov - cam.fov) > 0.01) {
        cam.fov = fov
        cam.updateProjectionMatrix()
      }
    }
    this._updateKick(dt)
    this._fx?.update(dt)
    this._updateDigging(dt)
    this.aimAmount = THREE.MathUtils.damp(this.aimAmount, this.aiming ? 1 : 0, AIM_SPEED, dt)
    if (this.aimAmount < 0.001) this.aimAmount = 0
    this._updateScope()
    const inspect = this._inspectWeight(dt)
    if (this._gun) {
      const a = this.aimAmount
      const sway = 1 - a * 0.85
      const base = this._aimPose || (this._aimPose = new THREE.Vector3())
      base.copy(GUN_OFFSET).lerp(this._aimOffset || AIM_OFFSET, a)
      this._gun.position.set(
        base.x + Math.cos(this._bob * 0.5) * (moving ? 0.008 : 0) * sway - inspect * 0.05,
        base.y + Math.abs(Math.sin(this._bob * 0.5)) * (moving ? -0.012 : 0) * sway + inspect * 0.05,
        base.z + this._recoil * 0.045 * (1 - a * 0.5) + inspect * 0.03,
      )
      this._gun.position.y += this._recoil * 0.012 * (1 - a * 0.6)
      // Looking through the scope: the gun and hands drop out of sight.
      if (this._scoped) this._gun.position.y -= 1
      // Inspecting turns the gun's side toward you and tips it a little.
      this._gun.rotation.set(this._recoil * 0.13 * (1 - a * 0.6) + inspect * 0.12, inspect * 0.75, inspect * 0.32 + this._kickRoll * (1 - a * 0.7))
    }
    this._updateShards(dt)
    this._updateBody(dt)
  }

  // Which liquid (if any) the eyes are in - below a flowing cell's surface,
  // not just inside its cell.
  _liquidAtEye(p) {
    const ey = p.y + this._eye
    const cx = Math.floor(p.x)
    const cy = Math.floor(ey)
    const cz = Math.floor(p.z)
    const type = this.bm.getBlockAt(cx, cy, cz)
    // Coral and seagrass grow in sea water.
    if (this.bm.isPlantBlock(type)) return 'water'
    if (type !== 'water' && type !== 'lava') return null
    const full = this.bm.getBlockAt(cx, cy + 1, cz) === type
    return full || ey - cy < this.bm.liquids.heightAt(cx, cy, cz) ? type : null
  }

  // Head under water tints the screen blue (bloxd.io's look), lava orange.
  _setUnderwater(kind) {
    if (kind === this._underwater) return
    this._underwater = kind
    if (!this._underwaterEl) {
      if (!kind) return
      this._underwaterEl = document.createElement('div')
      this._underwaterEl.id = 'build-try-underwater'
      document.body.appendChild(this._underwaterEl)
    }
    this._underwaterEl.className = kind || ''
    this._underwaterEl.style.display = kind ? 'block' : 'none'
  }

  // Left click while trying: the gun kicks and fires. Shots crack and
  // break windows (see _shootWindow); holding the button on a block
  // breaks it (_updateDigging).
  fire() {
    // Playing (BuildSurvival): the gun needs ammo, and zombies are hit
    // before windows.
    const play = this.bm.survival
    if (play?.active && (play.dead || !play.tryFire())) return
    this._kick()
    this._inspectT = -1
    audioEngine.playShot(this._gunId)
    if (play?.active && play.shoot()) return
    this._shootWindow()
  }

  // One shot's push on the kick spring, plus the flash and smoke.
  _kick() {
    const id = this._gunId
    this._kickVel += (RECOIL_KICK[id] ?? RECOIL_KICK_DEFAULT) * (0.9 + Math.random() * 0.2)
    this._kickRoll += (Math.random() - 0.5) * 0.06
    if (this._gun?.visible && this._gunScene && (id === 'flamethrower' || !NO_MUZZLE_FX.has(id))) {
      if (!this._fx) this._fx = new GunFx(this._gunScene)
      if (id === 'flamethrower') this._fx.flame(this._gun, this._muzzle)
      else this._fx.fire(this._gun, this._muzzle, this.aimAmount > 0.5, id === 'voidripper' ? VOID_FLASH : null)
    }
  }

  // The kick spring (see RECOIL_SPRING) - small fixed steps, so it stays
  // smooth and stable at any frame rate.
  _updateKick(dt) {
    const steps = Math.ceil(dt / 0.008)
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      this._kickVel += (-RECOIL_SPRING * this._recoil - RECOIL_DAMP * this._kickVel) * h
      this._recoil += this._kickVel * h
    }
    if (this._recoil > RECOIL_MAX) {
      this._recoil = RECOIL_MAX
      this._kickVel = Math.min(0, this._kickVel)
    } else if (this._recoil < -0.15) {
      this._recoil = -0.15
      this._kickVel = Math.max(0, this._kickVel)
    }
    this._kickRoll = THREE.MathUtils.damp(this._kickRoll, 0, 9, dt)
  }

  // True when aiming should zoom: a gun (not the knife or tomahawk, not a
  // block or item) is in your hand.
  aimZooms() {
    return !!this._gun?.visible && !/melee|knife|tomahawk/i.test(this._gunId || '')
  }

  // A gun with a scope is in your hand.
  hasScope() {
    return !!scopeOf(this._gunId) && this.aimZooms()
  }

  // Mouse look speed while aiming: a bit slower down the sights, much
  // slower through a scope (it turns as fast on screen as without zoom).
  aimLookScale() {
    if (!this.aimZooms()) return 1
    const scope = scopeOf(this._gunId)
    return 1 - (scope ? 1 - 1 / scope : 0.45) * this.aimAmount
  }

  // The scope picture over the screen (#play-scope), shown once aiming is
  // most of the way in with a scoped gun.
  _updateScope() {
    const on = this.aimAmount > SCOPE_AT && this.hasScope() && this.active && !this.view
    if (on === !!this._scoped) return
    this._scoped = on
    if (on && !this._scopeEl) {
      const el = (this._scopeEl = document.createElement('div'))
      el.id = 'play-scope'
      el.setAttribute('aria-hidden', 'true')
      el.innerHTML = '<div class="scope-lens"><i class="scope-h"></i><i class="scope-v"></i><i class="scope-dots"></i><b class="scope-dot"></b></div>'
      document.body.appendChild(el)
    }
    if (this._scopeEl) this._scopeEl.classList.toggle('on', on)
    document.body.classList.toggle('scope-on', on)
  }

  // Held right-click: aim down the sights (stops any inspect) - only in
  // first person.
  setAim(on) {
    this.aiming = !!on && this.active && !this.view
    if (this.aiming) this._inspectT = -1
  }

  // The camera key: first person -> third person behind -> third person in
  // front -> first person (2026-10-13, Gaymi: "like how bloxd has it").
  cycleView() {
    if (!this.active) return
    this.view = ((this.view || 0) + 1) % VIEWS.length
    this._applyMapMode()
    if (this.view) {
      this.aiming = false
      this._inspectT = -1
    }
  }

  // Your own body, seen in the third-person views: your skin, holding the
  // gun you have, walking with you.
  _updateBody(dt) {
    const show = this.active && !!this.view && !!this._armSkin
    if (show && (!this._body || this._bodySkin !== this._armSkin)) this._buildBody()
    if (!this._body) return
    this._body.group.visible = show
    if (!show) return
    const B = this.B
    const body = this._body
    const p = this.pos
    body.group.position.set(p.x * B, p.y * B, p.z * B)
    body.group.rotation.y = this.bm._yaw + Math.PI
    // Lower while crouching.
    body.char.position.y = body.lift - (this._crouch ? (HEIGHT - CROUCH_HEIGHT) * B * 0.5 : 0)
    const lp = body.char.limbPivots
    const speed = Math.hypot(this.vel.x, this.vel.z)
    body.walk += dt * speed * 3.2
    const swing = Math.sin(body.walk) * Math.min(1, speed / 2) * 0.7
    if (lp) {
      lp.legR.rotation.x = swing
      lp.legL.rotation.x = -swing
      const id = this._gunId || ''
      if (body.gunId !== id) {
        const held = holdWeapon(this.bm.game, body.char, id, body.gun)
        body.gun = held.gun
        body.melee = held.melee
        body.gunId = id
      }
      poseArms(lp, { holding: !!body.gun, melee: body.melee, firing: this._recoil > 0.05, swing })
    }
  }

  _buildBody() {
    this._disposeBody()
    const B = this.B
    const char = buildTexturedCharacter(this._armSkin)
    const sc = (MOB_HEIGHT * B) / 32
    char.scale.setScalar(sc)
    char.position.y = 2 * sc
    const group = new THREE.Group()
    group.add(char)
    this.bm.scene.add(group)
    this._body = { group, char, lift: 2 * sc, walk: 0, gun: null, gunId: null, melee: false }
    this._bodySkin = this._armSkin
  }

  _disposeBody() {
    const body = this._body
    if (!body) return
    this._body = null
    // The held weapon shares the game's own geometry - never disposed.
    body.gun?.parent?.remove(body.gun)
    this.bm.scene.remove(body.group)
    body.group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry?.dispose?.()
      for (const m of [].concat(o.material)) m?.dispose?.()
    })
  }

  // Third person: moves the camera out to its spot for this frame's
  // drawing only (BuildMode.render) - everything else (shooting, using
  // doors) still works from your eyes. Returns how to put it back.
  applyView() {
    if (!this.active || !this.view) return null
    const cam = this.bm.camera
    const B = this.B
    const eye = cam.position.clone()
    const quat = cam.quaternion.clone()
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat)
    const sign = this.view === 1 ? -1 : 1
    // Stop short of the first solid block between your head and the spot.
    let dist = VIEW_DIST
    for (let d = 0.3; d <= VIEW_DIST; d += 0.1) {
      const x = eye.x / B + dir.x * d * sign
      const y = eye.y / B + dir.y * d * sign
      const z = eye.z / B + dir.z * d * sign
      if (this.bm._cellSolidTop(Math.floor(x), Math.floor(y), Math.floor(z)) > 0) {
        dist = Math.max(0.3, d - 0.3)
        break
      }
    }
    cam.position.copy(eye).addScaledVector(dir, dist * sign * B)
    // From behind, a little higher, so you look over your own head.
    if (this.view === 1) cam.position.addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(quat), VIEW_RISE * Math.min(1, dist / VIEW_DIST) * B)
    if (this.view === 2) cam.lookAt(eye)
    cam.updateMatrixWorld()
    return () => {
      cam.position.copy(eye)
      cam.quaternion.copy(quat)
      cam.updateMatrixWorld()
    }
  }

  // Inspect Weapon: turn the gun to look at it (not while aiming).
  inspect() {
    if (!this.active || this.aiming || !this._gun?.visible) return
    this._inspectT = 0
  }

  // 0 (held normally) .. 1 (turned to show it), eased in, held, eased out.
  _inspectWeight(dt) {
    if (this._inspectT < 0) return 0
    this._inspectT += dt
    const t = this._inspectT
    const ease = (x) => x * x * (3 - 2 * x)
    if (t < INSPECT_IN) return ease(t / INSPECT_IN)
    if (t < INSPECT_IN + INSPECT_HOLD) return 1
    if (t < INSPECT_IN + INSPECT_HOLD + INSPECT_OUT) return ease(1 - (t - INSPECT_IN - INSPECT_HOLD) / INSPECT_OUT)
    this._inspectT = -1
    return 0
  }

  // --- Windows: the first shot cracks a glass block, the second breaks it,
  // and after that shots go through the hole. Only for this try - exit()
  // puts every broken window back, and saves always count them as there
  // (BuildMode._snapshot reads brokenWindows()). ---
  _shootWindow() {
    const bm = this.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const hit = bm._raycastGridAligned()
    if (!hit) return
    const [x, y, z] = hit.existingBlock
    const type = bm.getBlockAt(x, y, z)
    if (!bm._isWindowType(type)) return
    const key = bm._key(x, y, z)
    if (!this._cracked.has(key)) {
      this._cracked.set(key, { x, y, z, look: Math.floor(Math.random() * CRACK_LOOKS) })
      this._rebuildCracks()
      audioEngine.playGlassCrack()
      return
    }
    this._cracked.delete(key)
    this._rebuildCracks()
    this._broken.set(key, { x, y, z, type })
    bm._suppressUndoRecording = true
    bm.removeBlock(x, y, z)
    bm._suppressUndoRecording = false
    this._spawnShards(x, y, z, type)
    audioEngine.playGlassBreak()
    // On a server the others see it broken too.
    if (bm.survival?.active) bm.survival._recordEdit(x, y, z, '')
  }

  // Everything broken this try except the open world's land (saves never
  // hold that - it grows back from its seed).
  brokenWindows() {
    return [...this._broken.values()].filter((b) => !b.terrain)
  }

  // The scene was cleared (another slot loaded, map reset): nothing to
  // put back any more.
  forgetWindows() {
    this._stopDig()
    this._broken.clear()
    this._cracked.clear()
    this._rebuildCracks()
    this._clearShards()
  }

  _restoreWindows() {
    const bm = this.bm
    bm._suppressUndoRecording = true
    for (const [key, b] of this._broken) {
      if (bm.getBlockAt(b.x, b.y, b.z)) continue
      bm.placeBlock(b.x, b.y, b.z, b.type, false, b.state)
      // The open world's own land goes back to being land.
      if (b.terrain && bm.world) {
        bm.world.removed.delete(key)
        bm.world.terrainKeys.add(key)
      }
    }
    bm._suppressUndoRecording = false
    this.forgetWindows()
  }

  // --- Breaking blocks while playing (2026-10-17, Gaymi: "make them all
  // breakable but with speed like how long the blocks should break like
  // stone should take longer to break compared to wood"): hold the fire
  // button on a block within DIG_REACH and it cracks, then breaks after
  // BuildMode.breakSeconds of holding. Looking at another block starts
  // over. Like the windows, only for this try: exit() puts them back. ---
  _updateDigging(dt) {
    const bm = this.bm
    const play = bm.survival
    const busy = !this.active || !bm._fireHeld || bm.menuOpen || bm.gameMenuOpen || (play?.active && (play.dead || play._picking))
    const hit = busy ? null : this._digTarget()
    if (!hit) {
      this._stopDig()
      return
    }
    if (this._dig?.key !== hit.key || this._dig.type !== hit.type) this._dig = { ...hit, t: 0 }
    this._dig.t += dt
    if (this._dig.t >= this._dig.need) {
      this.breakBlock(hit.x, hit.y, hit.z)
      // In a game, what you break goes into your inventory.
      if (play?.active) play.onBlockMined(hit.type, hit.x, hit.y, hit.z)
      this._stopDig()
      return
    }
    this._showDigCrack(this._dig, this._dig.t / this._dig.need)
  }

  // The block under the crosshair, if it's near enough and can break.
  _digTarget() {
    const bm = this.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const hit = bm._raycastGridAligned()
    if (!hit) return null
    let [x, y, z] = hit.existingBlock
    const B = this.B
    const c = bm.camera.position
    if (Math.hypot((x + 0.5) * B - c.x, (y + 0.5) * B - c.y, (z + 0.5) * B - c.z) > DIG_REACH * B) return null
    // A door's top half breaks the whole door, from its bottom half.
    if (bm.shapeOf(bm.getBlockAt(x, y, z)) === 'doortop') y -= 1
    const type = bm.getBlockAt(x, y, z)
    const need = bm.breakSeconds(type)
    if (!Number.isFinite(need)) return null
    return { key: bm._key(x, y, z), x, y, z, type, need }
  }

  breakBlock(x, y, z) {
    const bm = this.bm
    const type = bm.getBlockAt(x, y, z)
    if (!type) return
    const key = bm._key(x, y, z)
    if (this._cracked.delete(key)) this._rebuildCracks()
    this._broken.set(key, { x, y, z, type, state: bm._blockStateOf(x, y, z), terrain: !!bm.world?.isTerrain(key) })
    bm._suppressUndoRecording = true
    bm.removeBlock(x, y, z)
    bm._suppressUndoRecording = false
    const glass = bm._isWindowType(type)
    this._spawnShards(x, y, z, type, glass ? null : Math.floor(Math.random() * BREAK_LOOKS.length))
    if (glass) audioEngine.playGlassBreak()
    else audioEngine.playFootstep(false, bm.breakSeconds(type) < 1 ? 'grass' : 'default')
  }

  // Another player broke it (a server's shared blocks): gone here too, and
  // put back at the end like my own - no sound or bits flying.
  breakQuietly(x, y, z) {
    const bm = this.bm
    const type = bm.getBlockAt(x, y, z)
    if (!type) return
    const key = bm._key(x, y, z)
    if (this._cracked.delete(key)) this._rebuildCracks()
    if (!this._broken.has(key)) this._broken.set(key, { x, y, z, type, state: bm._blockStateOf(x, y, z), terrain: !!bm.world?.isTerrain(key) })
    const was = bm._suppressUndoRecording
    bm._suppressUndoRecording = true
    bm.removeBlock(x, y, z)
    bm._suppressUndoRecording = was
  }

  // The crack on the block being broken: this dig's own pattern (picked
  // when it starts), spreading out from its impact point as it gets closer.
  _showDigCrack(dig, progress) {
    const bm = this.bm
    const B = this.B
    if (!this._digMesh) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.01, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      this._digMesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
      this._digMesh.renderOrder = 2
    }
    if (dig.look === undefined) {
      dig.look = Math.floor(Math.random() * DIG_LOOKS)
      this._digMesh.geometry.dispose()
      this._digMesh.geometry = this._digCrackShape(dig)
    }
    const stage = Math.min(DIG_STAGES, 1 + Math.floor(progress * DIG_STAGES))
    const map = this._digCrackTexture(dig.look, stage, bm._isWindowType(dig.type))
    if (this._digMesh.material.map !== map) {
      this._digMesh.material.map = map
      this._digMesh.material.needsUpdate = true
    }
    if (!this._digMesh.parent) bm.scene.add(this._digMesh)
    this._digMesh.position.set((dig.x + 0.5) * B, (dig.y + 0.5) * B, (dig.z + 0.5) * B)
    this._digMesh.material.opacity = 0.55 + 0.45 * progress
    this._digMesh.visible = true
  }

  // The crack's shape: the block's 6 faces a hair outside it, each with
  // the picture turned a random way. On the bumpy graphics levels the top
  // follows the block's lumps - a flat box top sat under them, so only
  // the sides showed the crack (2026-10-26, Gaymi: "only 1 side breaks
  // not all sides").
  _digCrackShape(dig) {
    const B = this.B
    const e = 0.006
    const lumps = this.bm._chunks?.lumpyTopPoints?.(dig.x, dig.y, dig.z)
    const pos = []
    const uv = []
    const idx = []
    const turnUv = (u, v, t) => (t === 0 ? [u, v] : t === 1 ? [1 - v, u] : t === 2 ? [1 - u, 1 - v] : [v, 1 - u])
    // Each face: a grid of (n+1)^2 points from point(i/n, j/n).
    const face = (n, point) => {
      const t = Math.floor(Math.random() * 4)
      const base = pos.length / 3
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          const [x, y, z, u, v] = point(i, j)
          pos.push((x - 0.5) * B, (y - 0.5) * B, (z - 0.5) * B)
          uv.push(...turnUv(u, v, t))
        }
      }
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = base + j * (n + 1) + i
          idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1)
        }
      }
    }
    const lo = -e
    const hi = 1 + e
    // Outward-facing winding: for each, (i, j) runs so a x b points out.
    face(1, (i, j) => [hi, lo + j * (hi - lo), hi - i * (hi - lo), i, j]) // +x
    face(1, (i, j) => [lo, lo + j * (hi - lo), lo + i * (hi - lo), i, j]) // -x
    face(1, (i, j) => [lo + i * (hi - lo), lo, lo + j * (hi - lo), i, j]) // -y
    face(1, (i, j) => [lo + i * (hi - lo), lo + j * (hi - lo), hi, i, j]) // +z
    face(1, (i, j) => [hi - i * (hi - lo), lo + j * (hi - lo), lo, i, j]) // -z
    if (lumps) face(3, (i, j) => { const [u, v, h] = lumps[(3 - j) * 4 + i]; return [u, h + e, v, i / 3, j / 3] }) // +y, lumpy
    else face(1, (i, j) => [lo + i * (hi - lo), hi, hi - j * (hi - lo), i, j]) // +y
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    return geo
  }

  // Dig cracks: look (pattern), stage (how far grown), dark lines on solid
  // blocks or white on glass. Tiny pictures, made once each.
  _digCrackTexture(look, stage, glass) {
    this._digTextures = this._digTextures || new Map()
    const key = `${look}:${stage}:${glass ? 1 : 0}`
    if (!this._digTextures.has(key)) this._digTextures.set(key, this._crackTexture(100 + look, stage / DIG_STAGES, glass ? null : ['rgba(18,14,10,0.9)', 'rgba(255,255,255,0.18)']))
    return this._digTextures.get(key)
  }

  _stopDig() {
    this._dig = null
    if (this._digMesh) this._digMesh.visible = false
  }

  // Pixel-art cracks, drawn once each: CRACK_LOOKS different ones - an
  // impact point somewhere near the middle, 4-7 cracks running out from
  // it with kinks and branches, and on some a spider web of rings.
  // amount (0-1): how much of it is drawn, nearest the impact point first;
  // colors: [line, edge] (white lines with a dark edge for glass).
  _crackTexture(look, amount = 1, colors = null) {
    const [lineColor, edgeColor] = colors || ['rgba(255,255,255,0.95)', 'rgba(40,50,60,0.45)']
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const ctx = c.getContext('2d')
    let seed = 1013 + look * 7919
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    const dot = (px, py, color) => {
      if (px < 0 || py < 0 || px > 15 || py > 15) return
      ctx.fillStyle = color
      ctx.fillRect(px, py, 1, 1)
    }
    // Lines are collected first, then drawn nearest the impact point first.
    const segs = []
    const line = (x0, y0, x1, y1) => segs.push([x0, y0, x1, y1])
    const cx = 5 + rand() * 6
    const cy = 5 + rand() * 6
    const arms = 4 + Math.floor(rand() * 4)
    const armPoints = []
    for (let i = 0; i < arms; i++) {
      let ang = (i / arms) * Math.PI * 2 + (rand() - 0.5) * 0.8
      let x = cx
      let y = cy
      const pts = []
      while (x >= 0 && x <= 15 && y >= 0 && y <= 15) {
        const step = 1.5 + rand() * 2
        const nx = x + Math.cos(ang) * step
        const ny = y + Math.sin(ang) * step
        line(x, y, nx, ny)
        pts.push([nx, ny])
        // A side branch now and then.
        if (rand() < 0.22) {
          const ba = ang + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.5)
          line(nx, ny, nx + Math.cos(ba) * (2 + rand() * 2), ny + Math.sin(ba) * (2 + rand() * 2))
        }
        x = nx
        y = ny
        ang += (rand() - 0.5) * 0.6
      }
      armPoints.push(pts)
    }
    // A spider web: rings joining neighbouring cracks.
    if (look % 2 === 1) {
      for (const ring of [1, 2]) {
        for (let i = 0; i < arms; i++) {
          const p = armPoints[i][ring]
          const q = armPoints[(i + 1) % arms][ring]
          if (p && q && rand() < 0.8) line(p[0], p[1], q[0], q[1])
        }
      }
    }
    segs.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy))
    for (const [x0, y0, x1, y1] of segs.slice(0, Math.ceil(segs.length * amount))) {
      const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
      for (let j = 0; j <= n; j++) {
        const px = Math.round(x0 + ((x1 - x0) * j) / n)
        const py = Math.round(y0 + ((y1 - y0) * j) / n)
        dot(px + 1, py, edgeColor)
        dot(px, py, lineColor)
      }
    }
    dot(Math.round(cx), Math.round(cy), lineColor)
    const tex = new THREE.CanvasTexture(c)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // Cracked windows get a crack drawn on every face (one InstancedMesh,
  // a hair bigger than the block so it shows on top).
  _rebuildCracks() {
    const bm = this.bm
    for (const mesh of this._crackMeshes || []) {
      bm.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.dispose()
    }
    this._crackMeshes = []
    if (!this._cracked.size) return
    this._crackMaterials = this._crackMaterials || []
    const B = this.B
    const size = B * 1.01
    const byLook = new Map()
    for (const c of this._cracked.values()) {
      const look = c.look || 0
      if (!byLook.has(look)) byLook.set(look, [])
      byLook.get(look).push(c)
    }
    const m = new THREE.Matrix4()
    for (const [look, cells] of byLook) {
      if (!this._crackMaterials[look]) {
        this._crackMaterials[look] = new THREE.MeshBasicMaterial({ map: this._crackTexture(look), transparent: true, alphaTest: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      }
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), this._crackMaterials[look], cells.length)
      cells.forEach(({ x, y, z }, i) => {
        m.makeTranslation((x + 0.5) * B, (y + 0.5) * B, (z + 0.5) * B)
        mesh.setMatrixAt(i, m)
      })
      mesh.renderOrder = 2
      bm.scene.add(mesh)
      this._crackMeshes.push(mesh)
    }
  }

  // Shard shapes: a square, a thin sliver, a triangle and a small chip.
  _shardShapes() {
    if (this._shardGeometries) return this._shardGeometries
    const B = this.B
    const tri = new THREE.CylinderGeometry(B * 0.1, B * 0.1, B * 0.02, 3)
    tri.rotateX(Math.PI / 2)
    this._shardGeometries = [
      new THREE.BoxGeometry(B * 0.14, B * 0.14, B * 0.02),
      new THREE.BoxGeometry(B * 0.05, B * 0.24, B * 0.02),
      tri,
      new THREE.BoxGeometry(B * 0.07, B * 0.06, B * 0.02),
    ]
    return this._shardGeometries
  }

  // lookIndex: which BREAK_LOOKS (random when left out).
  _spawnShards(x, y, z, type, lookIndex = null) {
    const B = this.B
    const scene = this.bm.scene
    const shapes = this._shardShapes()
    let mats = this._shardMaterials.get(type)
    if (!mats) {
      const color = this.bm._blockColor(type)
      // The glass's own colour, plus a paler glint for a few pieces (solid
      // blocks broken while playing: their colour and a darker one).
      const glass = this.bm._isWindowType(type)
      mats = glass ? [
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.6), transparent: true, opacity: 0.9 }),
      ] : [
        new THREE.MeshBasicMaterial({ color }),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.7) }),
      ]
      this._shardMaterials.set(type, mats)
    }
    const look = BREAK_LOOKS[lookIndex ?? Math.floor(Math.random() * BREAK_LOOKS.length)]
    this._lastBreakLook = look.name
    // Flying away from the shooter.
    const cam = this.bm.camera.position
    const cx = (x + 0.5) * B
    const cy = (y + 0.5) * B
    const cz = (z + 0.5) * B
    const away = new THREE.Vector3(cx - cam.x, 0, cz - cam.z).normalize()
    const n = Math.round(SHARDS_PER_WINDOW * look.count)
    for (let i = 0; i < n; i++) {
      const shard = new THREE.Mesh(shapes[Math.floor(Math.random() * shapes.length)], mats[Math.random() < 0.2 ? 1 : 0])
      shard.position.set(cx + (Math.random() - 0.5) * B * 0.8, cy + (Math.random() - 0.5) * B * 0.8, cz + (Math.random() - 0.5) * B * 0.8)
      shard.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
      const size = look.sizes[0] + Math.random() * (look.sizes[1] - look.sizes[0])
      scene.add(shard)
      this._shards.push({
        mesh: shard,
        size,
        vel: new THREE.Vector3(
          away.x * look.out + (Math.random() - 0.5) * look.spread,
          Math.random() * look.up,
          away.z * look.out + (Math.random() - 0.5) * look.spread,
        ).multiplyScalar(B),
        spin: new THREE.Vector3(Math.random() * look.spin, Math.random() * look.spin, Math.random() * look.spin),
        life: SHARD_LIFE * (0.7 + Math.random() * 0.3),
      })
      shard.scale.setScalar(size)
    }
  }

  _updateShards(dt) {
    if (!this._shards.length) return
    const g = GRAVITY * 0.6 * this.B
    this._shards = this._shards.filter((s) => {
      s.life -= dt
      if (s.life <= 0) {
        this.bm.scene.remove(s.mesh)
        return false
      }
      s.vel.y -= g * dt
      s.mesh.position.addScaledVector(s.vel, dt)
      s.mesh.rotation.x += s.spin.x * dt
      s.mesh.rotation.y += s.spin.y * dt
      s.mesh.scale.setScalar((s.size || 1) * Math.min(1, s.life * 3))
      return true
    })
  }

  _clearShards() {
    for (const s of this._shards) this.bm.scene.remove(s.mesh)
    this._shards = []
  }

  // Whether the body overlaps a solid cell right now (BuildMode checks
  // this so a door never swings shut onto the player).
  overlapsSolid() {
    return this._hits(this.pos.x, this.pos.y, this.pos.z)
  }

  // --- The gun, drawn on top of the world in its own little scene, so it
  // never pokes into a wall you're standing against. ---
  _ensureGunScene() {
    if (this._gunScene) return
    this._gunScene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(this.bm.renderer)
    this._gunScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    // The same light as the guns' pictures (Viewmodels.addGunLights).
    addGunLights(this._gunScene, [1, 2, 1], [-1.5, 1, -2], HAND_LIGHT)
    this._gunCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10)
  }

  _showGun() {
    const weapons = this.bm.game?.weapons
    if (!weapons?.viewmodels) return
    // Playing: the gun picked for this run (BuildSurvival's picker).
    // Otherwise the first gun in the player's hotbar (not the knife), else
    // the rifle.
    const play = this.bm.survival
    const hotbar = this.bm.game?.settings?.hotbar || []
    const gunIds = hotbar.filter((wid) => wid && weapons.viewmodels[wid] && !/melee|knife|tomahawk/i.test(wid))
    const picked = play?.active && weapons.viewmodels[play.weaponId] ? play.weaponId : null
    const id = picked || gunIds[0] || (weapons.viewmodels.rifle ? 'rifle' : weapons.current?.id)
    const source = id && weapons.viewmodels[id]
    if (!source) return
    this._ensureGunScene()
    if (this._gunId !== id) {
      if (this._gun) this._gunScene.remove(this._gun)
      // A copy of the game's own gun model (geometry/materials shared).
      const gun = cloneViewmodel(source)
      gun.visible = true
      this._gun = new THREE.Group()
      this._gun.add(gun)
      this._gunScene.add(this._gun)
      this._gunId = id
      this._armSpots = this._findHandSpots(gun)
      this._rebuildArms()
    }
    this._gun.visible = true
    this._loadArms()
  }

  // The middle of the barrel's tip, in the gun group's space: the centre of
  // the vertices in the front 4% of the gun (every gun points along -z).
  _findMuzzle(gun, exact) {
    const front = exact.min.z + (exact.max.z - exact.min.z) * 0.04
    const tip = new THREE.Box3()
    const v = new THREE.Vector3()
    gun.traverse((o) => {
      const pos = o.isMesh && o.geometry.attributes.position
      if (!pos) return
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i)
        if (o.isSkinnedMesh) o.applyBoneTransform(i, v)
        v.applyMatrix4(o.matrixWorld)
        if (v.z <= front) tip.expandByPoint(v)
      }
    })
    if (tip.isEmpty()) return new THREE.Vector3((exact.min.x + exact.max.x) / 2, exact.max.y - (exact.max.y - exact.min.y) * 0.3, exact.min.z)
    return tip.getCenter(new THREE.Vector3()).setZ(exact.min.z)
  }

  // Where the two hands go on this gun, in the gun group's space, from the
  // gun's own size (every gun points along -z): the right hand on the grip
  // near the back, the left hand under the barrel halfway along.
  _findHandSpots(gun) {
    const g = this._gun
    g.position.set(0, 0, 0)
    g.rotation.set(0, 0, 0)
    g.updateMatrixWorld(true)
    const box = new THREE.Box3()
    const corner = new THREE.Vector3()
    gun.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.computeBoundingBox()
      const bb = o.geometry.boundingBox
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        box.expandByPoint(corner.set(x, y, z).applyMatrix4(o.matrixWorld))
      }
    })
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.03, -0.1, -0.6), new THREE.Vector3(0.03, 0.1, 0.05))
    const size = box.getSize(new THREE.Vector3())
    const cx = (box.min.x + box.max.x) / 2
    const grip = new THREE.Vector3(cx, box.min.y + size.y * 0.25, box.max.z - size.z * 0.12)
    const fore = new THREE.Vector3(cx, box.min.y + size.y * 0.35, box.max.z - size.z * 0.5)
    // Aiming needs the gun's real top, measured from its vertices - the
    // corners of a turned part's own box (above) can sit well above it.
    const exact = new THREE.Box3().setFromObject(gun, true)
    const len = exact.max.z - exact.min.z
    const back = AIM_BACK_FOR[this._gunId] ?? AIM_BACK + AIM_BACK_PER_LEN * len
    // Centred on the gun's top line (its sights), not its whole box - a
    // charging handle or a magazine sticking out to one side used to pull
    // the AK off the middle (2026-10-13, "the aim feels wrong, not in the
    // middle").
    const sightX = this._topLineX(gun, exact) ?? (exact.min.x + exact.max.x) / 2
    this._muzzle = this._findMuzzle(gun, exact)
    this._aimOffset = new THREE.Vector3(-sightX, -exact.max.y - (back + len) * AIM_DROP + AIM_SIGHT_RISE - (AIM_LOWER_FOR[this._gunId] || 0), -back - exact.max.z)
    return [
      { limb: 'armR', shoulder: ARM_SHOULDERS.armR, hand: grip.toArray() },
      { limb: 'armL', shoulder: ARM_SHOULDERS.armL, hand: fore.toArray() },
    ]
  }

  // Middle (x) of the gun's top band - the top TOP_BAND of its height,
  // where the sights and top rib are - in the gun group's space.
  _topLineX(gun, exact) {
    const cut = exact.max.y - (exact.max.y - exact.min.y) * TOP_BAND
    let lo = Infinity
    let hi = -Infinity
    const v = new THREE.Vector3()
    gun.updateMatrixWorld(true)
    gun.traverse((o) => {
      const pos = o.isMesh && o.geometry?.attributes?.position
      if (!pos) return
      const step = Math.max(1, Math.floor(pos.count / 4000))
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
        if (v.y < cut) continue
        if (v.x < lo) lo = v.x
        if (v.x > hi) hi = v.x
      }
    })
    return lo <= hi ? (lo + hi) / 2 : null
  }

  // Loads the equipped skin (once per skin) and builds the arms from it.
  _loadArms() {
    const url = this.bm.game?.settings?.customSkinDataUrl || DEFAULT_SKIN_DATA_URL
    if (this._armsUrl === url) return
    this._armsUrl = url
    loadSkinTexture(url).then((skin) => {
      if (this._armsUrl !== url) return
      this._armSkin = skin
      this._rebuildArms()
    }).catch(() => {
      // Unreadable skin - the gun is shown without arms.
    })
  }

  // Arms reaching from the bottom of the screen to this gun's hand spots.
  _rebuildArms() {
    if (!this._armSkin || !this._gun || !this._armSpots) return
    this._disposeArms()
    this._arms = buildArms(this._armSkin, this._armSpots)
    this._gun.add(this._arms)
  }

  _disposeArms() {
    if (!this._arms) return
    disposeArms(this._arms)
    this._arms = null
  }

  // --- Building (not trying): the right arm holding the selected block in
  // the corner, swinging on every place/break.
  // Drawn in the same on-top scene as Try Map's gun. ---
  swingHand() {
    this._swingT = 0
  }

  // inPlay: a block held from a game's inventory (2026-10-18, Gaymi: "I'm
  // holding a leaf but I can't see it") - without it this returned while
  // playing, so no held block was ever drawn.
  drawHand(renderer, type, inPlay = false) {
    if (this.active && !inPlay) return
    this._ensureGunScene()
    if (this._gun) this._gun.visible = false
    if (!this._hand) {
      this._hand = new THREE.Group()
      this._handHeld = new THREE.Group()
      this._handHeld.position.set(...HAND_BLOCK_POS)
      this._handHeld.rotation.set(0.12, 0.72, 0)
      this._hand.add(this._handHeld)
      this._gunScene.add(this._hand)
    }
    this._loadHandArm()
    if (type !== this._handType) {
      this._handType = type
      this._setHeldBlock(type)
    }
    // Swing: down and in toward the middle of the screen, then back.
    const now = performance.now()
    const dt = Math.min(0.05, (now - (this._handAt || now)) / 1000)
    this._handAt = now
    let swing = 0
    if (this._swingT !== null && this._swingT !== undefined) {
      this._swingT += dt / SWING_TIME
      if (this._swingT >= 1) this._swingT = null
      else swing = Math.sin(this._swingT * Math.PI)
    }
    this._hand.rotation.set(-swing * 0.55, swing * 0.35, 0)
    this._hand.position.set(-swing * 0.06, -swing * 0.03, 0)
    this._hand.visible = true
    this._renderOnTop(renderer)
    this._hand.visible = false
  }

  _setHeldBlock(type) {
    for (const child of [...this._handHeld.children]) {
      this._handHeld.remove(child)
      for (const m of [].concat(child.material)) m.dispose()
    }
    const parts = type && this.bm._heldBlockParts(type)
    if (!parts) return
    // Own copies of the block's materials, toned for the bright scene
    // (the textures themselves are shared, never disposed here).
    const toned = [].concat(parts.material).map((m) => {
      const c = m.clone()
      c.color?.multiplyScalar(0.62)
      if (c.emissive && c.emissiveIntensity) c.emissiveIntensity *= 0.7
      return c
    })
    const mesh = new THREE.Mesh(parts.geometry, Array.isArray(parts.material) ? toned : toned[0])
    mesh.scale.setScalar(HAND_BLOCK_SIZE / this.B)
    if (parts.turn) mesh.rotation.y = parts.turn
    mesh.frustumCulled = false
    this._handHeld.add(mesh)
  }


  _loadHandArm() {
    const url = this.bm.game?.settings?.customSkinDataUrl || DEFAULT_SKIN_DATA_URL
    if (this._handArmUrl === url) return
    this._handArmUrl = url
    loadSkinTexture(url).then((skin) => {
      if (this._handArmUrl !== url || !this._hand) return
      if (this._handArm) disposeArms(this._handArm)
      this._handArm = buildArms(skin, HAND_ARM)
      this._hand.add(this._handArm)
    }).catch(() => {
      // Unreadable skin - the block is shown without the arm.
    })
  }

  _renderOnTop(renderer) {
    const cam = this.bm.camera
    this._gunCamera.aspect = cam.aspect
    // Portrait phones (2026-10-27): at 70 degrees tall the view is only a
    // sliver wide, so the gun sat off the right edge and the arm filled
    // the corner as a big wedge - keep it at least as wide as a square
    // screen's view instead.
    this._gunCamera.fov = cam.aspect >= 1 ? 70 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) / cam.aspect))
    this._gunCamera.updateProjectionMatrix()
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.clearDepth()
    // Drawn without the world's film-like tone mapping, like the gun's own
    // picture (InventoryUI._weaponThumbnails) - ACES greyed its colours.
    const toneMapping = renderer.toneMapping
    renderer.toneMapping = THREE.NoToneMapping
    renderer.render(this._gunScene, this._gunCamera)
    renderer.toneMapping = toneMapping
    renderer.autoClear = autoClear
  }

  drawGun(renderer) {
    if (!this.active || this.view || !this._gun?.visible) return
    if (this._hand) this._hand.visible = false
    this._renderOnTop(renderer)
  }
}

// Blocky arms from a skin: each limb stretched from its shoulder (off the
// bottom of the screen) to its hand, matte and toned down for the on-top
// scene's bright lights (made for shiny metal) - otherwise the skin washes
// out to near white.
function buildArms(skin, list) {
  const character = buildTexturedCharacter(skin)
  const arms = new THREE.Group()
  const up = new THREE.Vector3(0, -1, 0)
  for (const { limb, shoulder, hand } of list) {
    const pivot = character.limbPivots[limb]
    pivot.position.set(0, 0, 0)
    const from = new THREE.Vector3(...shoulder)
    const dir = new THREE.Vector3(...hand).sub(from)
    const arm = new THREE.Group()
    arm.position.copy(from)
    arm.quaternion.setFromUnitVectors(up, dir.clone().normalize())
    // The limb hangs 12 skin pixels down from its pivot: stretch it to
    // reach the hand, keep its width.
    arm.scale.set(ARM_PX, dir.length() / 12, ARM_PX)
    arm.add(pivot)
    arms.add(arm)
    arms.add(armDetails(skin, limb, from, dir))
  }
  arms.traverse((o) => {
    if (!o.isMesh || o.userData.armDetail) return
    o.frustumCulled = false
    const old = o.material
    o.material = new THREE.MeshLambertMaterial({ map: old.map, color: 0x747474, alphaTest: old.alphaTest, transparent: old.transparent, side: old.side })
    old.dispose()
  })
  return arms
}

// One skin pixel's colour (64-wide layout units), or null.
function skinPixel(skin, u, v) {
  try {
    const img = skin.texture.image
    const k = skin.scale || 1
    const d = img.getContext('2d', { willReadFrequently: true }).getImageData(Math.floor((u + 0.5) * k), Math.floor((v + 0.5) * k), 1, 1).data
    return d[3] > 20 ? new THREE.Color(`rgb(${d[0]}, ${d[1]}, ${d[2]})`) : null
  } catch {
    return null
  }
}

// A fist round the grip and a sleeve cuff a third of the way up, coloured
// from the skin's own hand (the arm's bottom face) and sleeve, with
// knuckles - the arm used to just end flat at the gun.
function armDetails(skin, limb, from, dir) {
  const left = limb === 'armL' && skin.height > 32
  const hand = skinPixel(skin, left ? 41 : 49, left ? 49 : 17) || new THREE.Color(0xc89a74)
  const sleeve = skinPixel(skin, left ? 37 : 45, left ? 53 : 21) || hand.clone()
  const g = new THREE.Group()
  g.position.copy(from)
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize())
  const w = ARM_PX * 4
  const len = dir.length()
  const part = (size, y, color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.5) }))
    m.position.y = y
    m.frustumCulled = false
    m.userData.armDetail = true
    g.add(m)
    return m
  }
  part([w * 1.22, w * 0.95, w * 1.22], -len + w * 0.35, hand)
  // Knuckles: a darker ridge across the front of the fist.
  part([w * 1.26, w * 0.22, w * 0.3], -len + w * 0.55, hand.clone().multiplyScalar(0.8)).position.z = w * 0.5
  part([w * 1.12, w * 0.32, w * 1.12], -len * 0.62, sleeve.clone().multiplyScalar(0.85))
  return g
}

function disposeArms(arms) {
  arms.parent?.remove(arms)
  arms.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}
