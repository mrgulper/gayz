// Standalone block-placing creative sandbox - explicitly NOT connected to
// zombie survival gameplay (see docs/superpowers/specs/2026-08-08-build-mode-design.md).
// Reuses Game.js's existing renderer/canvas rather than a second WebGL
// context - only the scene/camera passed to render() changes.
import { screenOpen as campScreenOpen } from './CampScreen.js'
import { OWNER_KEY } from './OwnerPowers.js'
import { FIXED_KEYS, getKeyFor, keyLabel, keysFor } from './Keybinds.js'
import { controlsTick, lookBy, startUse, endUse } from './ControlSettings.js'
import { toggleHideHud } from './HudSettings.js'
import * as THREE from 'three'
import { grassOn, drawZombieOutlines } from './GraphicsSettings.js'
import { setHomePaused } from './LiteHome.js'
import { BlockChunks, CHUNK } from './BlockChunks.js'
import { setTextureDetail } from './BlockTextures.js'
import { graphicsLook } from './GraphicsLevels.js'
import { GrassTufts } from './GrassTufts.js'
import { CastleFlags } from './CastleFlags.js'
import { AirMotes } from './AirMotes.js'
import { FallingLeaves } from './FallingLeaves.js'
import { blockFaceCanvases, textureHasAlpha } from './BlockTextures.js'
import { t } from './i18n.js'
import { BuildTryMode } from './BuildTryMode.js'
import { LiquidFlow } from './LiquidFlow.js'
import { OpenWorld, inCity as cityCell } from './OpenWorld.js'
import { DEMON_TOP } from './Underground.js'
import { HEAVEN_FLOOR } from './HeavenRealm.js'
import { BuildTools } from './BuildTools.js'
import { PlaySpectate } from './PlaySpectate.js'
import { BuildSky } from './BuildSky.js'
import { BuildTouch } from './BuildTouch.js'
import { BuildGadgets } from './BuildGadgets.js'
import { BuildSpecials } from './BuildSpecials.js'
import { BLOCK_TYPES, VALID_TYPE_IDS, BLOCK_BY_ID } from './BlockTypes.js'
import { SHAPED_TEXTURE_FROM, _canvasTexture, _shapedBlockTextures, _blockIcon } from './BlockArt.js'
import { BLOCK_SIZE, DOOR_THICKNESS, LADDER_SIDES, LADDER_INSET, CUSTOM_BLOCK_GEOMETRY, FACED_SHAPES } from './BlockShapes.js'
import { addSaveMethods, MAP3_SLOT, SHARED_INFO_KEY, SAVE_SLOT_COUNT } from './BuildSaves.js'
export { BLOCK_TYPES }
import { BuildSurvival } from './BuildSurvival.js'
import { PlayPauseMenu } from './PlayPauseMenu.js'
import { BuildCamp } from './BuildCamp.js'
import { BuildShare } from './BuildShare.js'
import { BuildTogether } from './BuildTogether.js'
import { biomeBarLook } from './BiomeBar.js'
import { setBiomeTheme } from './CleanTheme.js'
import { PlayAnimals, ANIMAL_IDS, MAX_PLACED, animalIconURL, animalNameKey } from './PlayAnimals.js'

// GROUND_SIZE is a CELL count (not world units) - bumped up from 64, then
// 76, as BLOCK_SIZE shrank each time, so the buildable footprint's actual
// physical size (GROUND_SIZE * BLOCK_SIZE) stays close to what it was
// before rather than shrinking just because each cell got smaller.
const GROUND_SIZE = 128
// Couch Co-op: a knocked-down Player 1 holds no keys.
const NO_KEYS = new Set()
// The sun's shadows follow you in steps of this many blocks (_placeSun).
const SUN_SNAP = 16
// Down from 1, then 0.85, then 0.5 - still read as too large up close in
// first person even at 0.5, per direct follow-up feedback, so this went
// smaller again rather than assuming the previous pass had already solved
// it. GROUND_SIZE deliberately isn't scaled up to compensate this time
// (unlike every previous BLOCK_SIZE cut) - doing so would need
// MAX_INSTANCES_PER_TYPE raised too (GROUND_SIZE^2 cells must fit under it),
// which multiplies GPU memory reserved per block type across all 71 types;
// a smaller total buildable footprint is the safer tradeoff than that.
// BLOCK_SIZE (0.35) now lives in BlockShapes.js.
const FLY_SPEED = 8
// Movement used to snap straight to full speed the instant a key went down
// and stop dead the instant it came up - velocity damps toward the target
// speed instead (THREE.MathUtils.damp), giving a real accelerate-then-coast
// feel rather than an on/off toggle.
const FLY_ACCEL_LERP_SPEED = 8
const LOOK_SENSITIVITY = 0.0022
// Underground the fog turns this colour, from the ground's bottom down to
// CAVE_FOG_DEPTH cells below it, and comes this close (blocks).
const CAVE_FOG_COLOR = new THREE.Color(0x1b1d22)
const CAVE_FOG_DEPTH = 6
const CAVE_FOG_NEAR = 6
const CAVE_FOG_FAR = 48
// The Demon Realm (Underground.js, below DEMON_TOP): dark red fog, and the
// sky (sun, moon, clouds) hidden - only rock and fire down there. Heaven
// (HeavenRealm.js): a soft warm-white haze.
const DEMON_FOG_COLOR = new THREE.Color(0x2e0806)
const DEMON_FOG_NEAR = 6
const DEMON_FOG_FAR = 46
const HEAVEN_FOG_COLOR = new THREE.Color(0xfffaf0)
// Brighter Caves & Demon Realm: up to this much more light, the fog this
// much further away, and its colour lifted towards a soft grey.
const DARK_BOOST_LIGHT = 0.9
const DARK_BOOST_FOG = 1.2
const DARK_BOOST_FOG_COLOR = new THREE.Color(0x6a6660)
const HEAVEN_FOG_MIX = 0.7
// View distance (Settings > Graphics), in blocks: chunks further away
// than this aren't drawn and fog fades out what's left before that edge
// (BlockChunks.cullTo). Auto starts at Max on a computer and Medium on a
// phone/tablet, and Auto Quality moves it down a step at a time when the
// game is still slow at its lowest resolution (Game._updateEditorResScale).
export const VIEW_DISTANCES = { short: 48, medium: 80, far: 128, max: Infinity }
export const VIEW_STEPS = ['short', 'medium', 'far', 'max']
// Fog starts this share of the way out - only the last stretch before the
// edge, so far land stays clear (2026-10-23, Gaymi: "100% clear"; at 0.6
// everything past the middle distance looked hazy).
const FOG_START = 0.88
const FOG_CLEAR_START = 0.97
// A phone or tablet (no mouse): starts on a shorter view distance and
// skips anisotropic filtering.
const TOUCH_DEVICE = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches
// Raised from 4096, then 8192, alongside each BLOCK_SIZE/GROUND_SIZE bump -
// a single GROUND_SIZE x GROUND_SIZE ground layer (128*128=16384 cells) now
// needs more headroom on its own than the old cap allowed, with zero left
// over to actually build anything above it.
const MAX_INSTANCES_PER_TYPE = 20000
// Undo/Redo history depth (see _recordUndo) - one entry per individual
// block change, not per tool-action, so this is generous enough to cover a
// long editing streak without the stack growing unbounded over a whole
// session.
const UNDO_STACK_LIMIT = 200

// Anything that needs the real mouse while playing (_anyClickScreenShown):
// every panel, any pop-up dialog. Looked for every SCREEN_CHECK_MS.
const CLICK_SCREEN_SELECTOR = '.panel-box, dialog[open], [role="dialog"], [aria-modal="true"]'
const SCREEN_CHECK_MS = 150
// Edits are saved this long after the last change (and on leaving the
// page), not only on Exit/Save - closing the tab used to lose the build.
const AUTOSAVE_DELAY_MS = 1500
// The pause screen's Shortcuts box - every one of these really works.
// Trying the map: how far away (in blocks) a door can be opened from.
const TRY_REACH_BLOCKS = 5
const LIQUID_TYPES = new Set(['water', 'lava'])
// Walking keys (Settings > Controls) whose browser default (scrolling the
// page on Space/arrows) is blocked while trying the map.
const TRY_MOVE_ACTIONS = ['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'jump', 'sprint', 'crouch']
const MENU_SHORTCUTS = [
  [['T'], 'buildModeTryBtn'],
  // Rebindable (Settings > Controls), so their keys are looked up when the
  // list is drawn.
  [() => [keyLabel(getKeyFor('sprint')), keyLabel(getKeyFor('moveForward'))], 'buildMenuRun'],
  [() => [keyLabel(getKeyFor('crouch'))], 'buildMenuCrouch'],
  [() => [keyLabel(getKeyFor('use'))], 'buildMenuUseDoor'],
  [() => [keyLabel(getKeyFor('inspectWeapon'))], 'buildMenuInspect'],
  [() => [keyLabel(getKeyFor('cycleMap'))], 'buildMenuMapSize'],
  [() => [keyLabel(getKeyFor('cameraView'))], 'buildMenuCameraView'],
  [['Ctrl', 'Z'], 'buildModeUndoBtn'],
  [['Ctrl', 'Y'], 'buildModeRedoBtn'],
  [['Ctrl', 'S'], 'buildModeSaveBtn'],
  [() => [keyLabel(FIXED_KEYS.buildMirror)], 'buildModeMirrorBtn'],
  [['L'], 'buildModeLineBtn'],
  [['C'], 'buildModeCopyBtn'],
  [['P'], 'buildModePasteBtn'],
  [['Q'], 'buildModeRotateBtn'],
  [['F'], 'buildModeFillBtn'],
  [['R'], 'buildModeReplaceBtn'],
  [['G'], 'buildModeShapeBtn'],
  [['Tab'], 'buildMenuBlockPicker'],
]
// Pause-screen tips; `code` is what each one describes (see HOWTOPLAY_STEPS
// in Game.js - scripts/check-docs.mjs asks for a re-read when it changes).
const MENU_TIPS = [
  { key: 'buildTip8', code: 'toggleTryMode' },
  { key: 'buildTip1', code: 'toggleMirror' },
  { key: 'buildTip2', code: 'ZOOM_FOV' },
  { key: 'buildTip3', code: 'togglePicker' },
  { key: 'buildTip4', code: '_hopUp' },
  { key: 'buildTip5', code: 'toggleDoor' },
  { key: 'buildTip6', code: '_onWheel' },
  { key: 'buildTip7', code: '_scheduleAutosave' },
  { key: 'buildTip9', code: 'AREA_TOOLS' },
  { key: 'buildTip10', code: 'SHAPE_TOOLS' },
  { key: 'buildTip11', code: 'rotateClipboard' },
  { key: 'buildTip12', code: 'SKY_WEATHERS' },
  { key: 'buildTip13', code: 'waveSize' },
  { key: 'buildTip14', code: 'LINK_RANGE' },
  { key: 'buildTip15', code: 'SIGN_MAX_CHARS' },
  { key: 'buildTip16', code: 'makeShareCode' },
  { key: 'buildTip17', code: 'OPS_PER_EDIT' },
  { key: 'buildTip18', code: 'COIN_PER_KILL' },
]
const MENU_TIP_KEYS = MENU_TIPS.map((tip) => tip.key)
// Held with V (see update()'s zoomTarget) - narrows the FOV for a "look
// further" zoomed view rather than a real render-distance change, same
// convention as a scope/binoculars. FOV_LERP_SPEED controls how quickly
// it eases toward whichever target is active, same THREE.MathUtils.damp
// technique/units as FLY_ACCEL_LERP_SPEED below.
const ZOOM_FOV = 20
const NORMAL_FOV = 75
const FOV_LERP_SPEED = 10
// Free-fly still has no gravity (see spec's "why this shape" section) -
// this radius only stops the camera from passing through a placed block,
// treating the camera as a small sphere rather than a zero-size point.
const COLLISION_RADIUS = 0.35
// Minecraft-style hotbar key mapping - Digit1-9 are slots 0-8, Digit0 is
// slot 9 (the 10th slot), matching the real keyboard row's left-to-right
// order rather than numeric value.
const DIGIT_KEY_TO_HOTBAR_INDEX = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
  Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9,
}

const PICKER_TYPES = BLOCK_TYPES.filter((b) => !b.hidden)
// Special blocks (_blockCategory) lead the picker's list.
const PICKER_TYPES_SORTED = [...PICKER_TYPES.filter((b) => _blockCategory(b) === 'special'), ...PICKER_TYPES.filter((b) => _blockCategory(b) !== 'special')]
// The Map Editor Tab panel's 10 x 10 block storage (_renderPickerSide;
// was 6 x 6 until 2026-10-24). Older saves keep their first 36 blocks.
const EDITOR_STORE_SIZE = 100
const EDITOR_STORE_KEY = 'buildmode-block-store'
const _isDoorType = (type) => { const shape = BLOCK_BY_ID.get(type)?.shape; return shape === 'door' || shape === 'doortop' }
// Light-giving blocks (lava, glowstone, jack o'lantern...) - every block
// type with an emissive color. They light their surroundings through
// baked vertex light in the chunk meshes (BlockChunks.setGlow), not real
// THREE.PointLights: the editor has no point lights at all (2026-09-30 -
// the old 6 always-on light proxies cost ~35% of every frame).
const LIGHT_BLOCK_COLORS = new Map(BLOCK_TYPES.filter((bt) => bt.emissive).map((bt) => [bt.id, bt.emissive]))

// The picker's block-type dropdown (2026-10-03). Special is first - just
// the Invisible Block for now - and its blocks lead the All list too.
const PICKER_CATEGORIES = [
  ['special', 'Special'],
  ['wood', 'Wood'],
  ['stone', 'Stone'],
  ['ore', 'Ores & Metals'],
  ['nature', 'Dirt & Nature'],
  ['glass', 'Glass'],
  ['color', 'Wool & Concrete'],
  ['terracotta', 'Terracotta'],
  ['nether', 'Nether & End'],
  ['light', 'Light & Liquids'],
  ['slab', 'Slabs'],
  ['stairs', 'Stairs'],
  ['parts', 'Doors, Fences & Ladders'],
  ['other', 'Other'],
  // Not blocks: animals to put down (placingAnimal, 2026-10-24).
  ['animals', 'Animals'],
]
// BuildMode.breakSeconds: seconds to break a block while playing, by its
// picker category, with a few blocks picked out by name first.
const BREAK_SECONDS = { glass: 0.35, light: 0.5, nature: 0.6, color: 0.8, wood: 1.2, other: 1, terracotta: 1.6, stone: 2.2, nether: 2.4, ore: 3 }
const BREAK_SECONDS_BY_ID = [
  [/bedrock/, 10],
  [/obsidian|debris/, 7],
  [/leaves$|flower|fern|vine/, 0.25],
  [/^snow|wool$/, 0.5],
  [/concrete$/, 1.6],
  [/^c4$|^tnt$/, 0.5],
]
function _blockCategory(bt) {
  if (bt.shape === 'invisible' || bt.game) return 'special'
  if (bt.shape === 'slab') return 'slab'
  if (bt.shape === 'stairs') return 'stairs'
  if (bt.shape) return 'parts'
  const id = bt.id
  if (/water|lava|lamp|lantern|froglight|glowstone|shroomlight/.test(id)) return 'light'
  if (/glass/.test(id)) return 'glass'
  if (/terracotta/.test(id)) return 'terracotta'
  if (/wool$|concrete$/.test(id)) return 'color'
  if (/nether|soul|crimson|warped|basalt|blackstone|magma|endstone|purpur|obsidian|quartz|lodestone/.test(id)) return 'nether'
  if (/ore$|^raw|^(diamond|emerald|lapis|redstone|coal|copper)block$|^gold$|^iron$|^metal$|copper|netherite|debris|amethyst/.test(id)) return 'ore'
  if (/leaves$/.test(id)) return 'nature'
  if (/planks|log$|stem$|^wood$|bookshelf|craftingtable|barrel|crate|noteblock|jukebox|bamboo|timberframe/.test(id)) return 'wood'
  if (/grass|dirt|mud|sand$|^sand$|gravel|clay|moss|leaves|thatch|snow|ice$|cactus|pumpkin|melon|hay|mushroom|mycelium|podzol|kelp|coral|sponge|honey|slime|sculk|dripstone|bone|nylium/.test(id)) return 'nature'
  if (/c4|target/.test(id)) return 'other'
  return 'stone'
}


// Every placed block, "x,y,z" -> type id - plus the same blocks under a
// number made from x, y and z (2026-10-17 lag hunt). Looking a block up by
// its "x,y,z" text built a new string every time, and zombie pathfinding
// and chunk meshing do that hundreds of thousands of times a second (the
// biggest game-code cost walking into new land or in a big wave, plus the
// garbage it left). Use at(x, y, z) for lookups; the text keys stay for
// everything else (saves, chunk cell sets, undo).
const CELL_SPAN = 2 ** 21
const CELL_HALF = 2 ** 20
function cellNumber(x, y, z) {
  return ((x + CELL_HALF) * CELL_SPAN + (z + CELL_HALF)) * 1024 + (y + 512)
}
function cellNumberOfKey(key) {
  const a = key.indexOf(','), b = key.indexOf(',', a + 1)
  return cellNumber(+key.slice(0, a), +key.slice(a + 1, b), +key.slice(b + 1))
}
export class BlockMap extends Map {
  constructor() {
    super()
    this._byNumber = new Map()
  }
  set(key, type) {
    super.set(key, type)
    this._byNumber.set(cellNumberOfKey(key), type)
    return this
  }
  // set() when x, y, z are already known (skips reading them back out of the key).
  setAt(key, x, y, z, type) {
    super.set(key, type)
    this._byNumber.set(cellNumber(x, y, z), type)
  }
  delete(key) {
    if (!super.delete(key)) return false
    this._byNumber.delete(cellNumberOfKey(key))
    return true
  }
  clear() {
    super.clear()
    this._byNumber.clear()
  }
  at(x, y, z) {
    // Whole numbers only - anything else can't be a block cell.
    if ((x | 0) !== x || (y | 0) !== y || (z | 0) !== z) return undefined
    return this._byNumber.get(cellNumber(x, y, z))
  }
}

export class BuildMode {
  // Read by tests/docs.spec.js, which presses every listed key for real.
  static MENU_SHORTCUTS = MENU_SHORTCUTS

  // Plain full blocks a Random Block can turn into (no liquids, no
  // working blocks, nothing hidden).
  static randomBlockPool() {
    return PICKER_TYPES.filter((b) => !b.shape && !b.game && !b.plant && !b.inset && !LIQUID_TYPES.has(b.id) && b.id !== 'c4').map((b) => b.id)
  }

  static blockShape(type) {
    return BLOCK_BY_ID.get(type)?.shape
  }

  // A block's map color (0xRRGGBB), for the open world's minimap.
  static blockColor(type) {
    return BLOCK_BY_ID.get(type)?.color
  }

  // Every block's colour, { id: colour } (the map's tile worker, OpenWorld).
  static blockColorTable() {
    const out = {}
    for (const [id, b] of BLOCK_BY_ID) if (b.color !== undefined) out[id] = b.color
    return out
  }

  // A block id a player could have placed (not a door's hidden top half).
  // Settings > Controls: Field of View (the old Map 1's setting, 75 by default).
  // The view distance in blocks right now (see VIEW_DISTANCES).
  // Performance Mode sees one step nearer (2026-11-09) - fewer far chunks
  // loaded and drawn, the biggest saving after shadows.
  viewDistance() {
    const pick = this.game?.settings?.viewDistance || 'auto'
    let key = pick !== 'auto' ? pick : this._autoView || this.autoViewStart()
    const at = VIEW_STEPS.indexOf(key)
    if (this.game?.settings?.performanceMode && at > 0) key = VIEW_STEPS[at - 1]
    return VIEW_DISTANCES[key] ?? Infinity
  }

  autoViewStart() {
    return TOUCH_DEVICE ? 'medium' : 'max'
  }

  // Auto Quality's other lever: one step nearer (-1) or further (+1),
  // never past where Auto starts. Returns true if it changed.
  stepAutoView(dir) {
    if ((this.game?.settings?.viewDistance || 'auto') !== 'auto') return false
    const start = VIEW_STEPS.indexOf(this.autoViewStart())
    const now = VIEW_STEPS.indexOf(this._autoView || this.autoViewStart())
    const next = Math.max(0, Math.min(start, now + dir))
    if (next === now) return false
    this._autoView = VIEW_STEPS[next]
    return true
  }

  _applyViewDistance() {
    // The open world only grows so far: the fog ends before its edge.
    const blocks = this.world.active ? Math.min(this.viewDistance(), this.world.radius() - 8) : this.viewDistance()
    const fog = this.scene.fog
    if (this.scene.background?.isColor) fog.color.copy(this.scene.background)
    // Rain, snow and sandstorms bring the fog in (BuildSky.fogFactor).
    const weather = this.sky?.fogFactor ?? 1
    if (Number.isFinite(blocks)) {
      // On a clear day only the last few blocks before the edge fade.
      const start = FOG_START + (FOG_CLEAR_START - FOG_START) * (this.sky?.clearness ?? 0)
      fog.near = blocks * start * BLOCK_SIZE * weather * weather
      fog.far = blocks * BLOCK_SIZE * weather
    } else if (weather < 0.999) {
      fog.near = 20 * BLOCK_SIZE * weather
      fog.far = 140 * BLOCK_SIZE * weather
    } else {
      fog.near = 1e5
      fog.far = 1e6
    }
    const p = this.camera.position
    // Settings > Controls > Brighter Caves & Demon Realm (2026-10-30): how
    // deep in the dark you are (0-1), to lift the light and push the fog
    // back by.
    let dark = 0
    // Down in the rock (Underground.js) the fog is dark and close, not the
    // sky's colour - a far tunnel would read as a hole otherwise.
    if (this.world.active) {
      const x = Math.floor(p.x / BLOCK_SIZE)
      const z = Math.floor(p.z / BLOCK_SIZE)
      const depth = this.world.under.bottomAt(x, z) - p.y / BLOCK_SIZE
      if (depth > 0) {
        const k = Math.min(1, depth / CAVE_FOG_DEPTH)
        dark = k
        fog.color.lerp(CAVE_FOG_COLOR, k)
        fog.near += (CAVE_FOG_NEAR * BLOCK_SIZE - fog.near) * k
        fog.far += (Math.min(fog.far, CAVE_FOG_FAR * BLOCK_SIZE) - fog.far) * k
      }
      const y = p.y / BLOCK_SIZE
      const demon = Math.min(1, Math.max(0, (DEMON_TOP + 4 - y) / 12))
      if (demon > 0) {
        fog.color.lerp(DEMON_FOG_COLOR, demon)
        fog.near += (DEMON_FOG_NEAR * BLOCK_SIZE - fog.near) * demon
        fog.far += (DEMON_FOG_FAR * BLOCK_SIZE - fog.far) * demon
        // (The sky works its colour out again every frame.)
        if (this.scene.background?.isColor) this.scene.background.lerp(DEMON_FOG_COLOR, demon)
      }
      dark = Math.max(dark, demon)
      if (dark > 0 && this.game?.settings?.darkAreaBoost) {
        fog.far *= 1 + DARK_BOOST_FOG * dark
        fog.color.lerp(DARK_BOOST_FOG_COLOR, 0.35 * dark)
      } else dark = 0
      const heaven = Math.min(1, Math.max(0, (y - (HEAVEN_FLOOR - 40)) / 40))
      if (heaven > 0) fog.color.lerp(HEAVEN_FOG_COLOR, heaven * HEAVEN_FOG_MIX)
      const hideSky = demon > 0.5
      if (hideSky !== !!this._skyHiddenDeep) {
        this._skyHiddenDeep = hideSky
        this.sky?.bodies?.show(!hideSky)
      }
    }
    // The renderer's exposure is shared with the homepage, so it goes back
    // the moment you're out of the dark (or the setting is off).
    if (this._baseExposure === undefined) this._baseExposure = this.renderer.toneMappingExposure
    this.renderer.toneMappingExposure = this._baseExposure * (1 + DARK_BOOST_LIGHT * dark)
    this._chunks.cullTo(p.x / BLOCK_SIZE, p.z / BLOCK_SIZE, blocks)
  }

  _normalFov() {
    return this.game?.settings?.fov || NORMAL_FOV
  }

  static isBlockType(id) {
    return VALID_TYPE_IDS.has(id) && !BLOCK_BY_ID.get(id).hidden
  }

  constructor(renderer, game) {
    this.game = game
    this.renderer = renderer
    this.active = false

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87ceeb)
    // Always present (adding/removing fog later would recompile every
    // material); render() keeps its color on the sky and its distance on
    // the view distance.
    this.scene.fog = new THREE.Fog(0x87ceeb, 1e5, 1e6)

    // Bright, even daylight (2026-09-29, Kirka-style pass) - at 1.2/1.0
    // a flat-lit top face came out at about 60% of its texture color, so
    // every block read dark and muddy. Sides/bottoms get their darker
    // Minecraft-style shading from BlockChunks' per-face shade instead.
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 2.0)
    this.scene.add(hemiLight)
    this._hemiLight = hemiLight
    const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.5)
    sunLight.position.set(20, 30, 10)
    // Real cast shadows (not just per-face lighting) are what actually
    // reads as "3D" from a distance - a flat-shaded cube and a shadowed
    // one look very different even with the same geometry.
    sunLight.castShadow = true
    // Graphics > Shadow Quality picks the shadow map size (Game.js
    // _applyShadowQuality changes it live).
    const shadowSize = { low: 512, medium: 1024, high: 2048 }[game?.settings?.shadowQuality] || 1024
    sunLight.shadow.mapSize.set(shadowSize, shadowSize)
    this.sunLight = sunLight
    // GROUND_SIZE is a cell count, not world units (see its own comment) -
    // the shadow frustum needs to cover the ground's actual physical size.
    const shadowSpan = (GROUND_SIZE * BLOCK_SIZE) / 2 + 8
    sunLight.shadow.camera.left = -shadowSpan
    sunLight.shadow.camera.right = shadowSpan
    sunLight.shadow.camera.top = shadowSpan
    sunLight.shadow.camera.bottom = -shadowSpan
    sunLight.shadow.camera.near = 1
    sunLight.shadow.camera.far = 100
    // Without a bias, faces at a low angle to the sun shadowed themselves
    // (shadow acne) and read as near-black.
    sunLight.shadow.bias = -0.0005
    sunLight.shadow.normalBias = 0.03
    this.scene.add(sunLight)
    this._sunLight = sunLight

    this.camera = new THREE.PerspectiveCamera(this._normalFov(), window.innerWidth / window.innerHeight, 0.1, 500)
    // Standing eye height (1.7, matching PlayerController's real-game eye
    // height) rather than floating well above it - the old y=5 spawn made
    // 1-unit blocks read as small/distant the instant Build Mode opened,
    // since everything was seen from a bird's-eye vantage before the
    // player had a chance to fly down to a natural scale reference.
    this.camera.position.set(0, 1.7, 10)

    // Free-fly input state - WASD + Space/Shift for up/down, mouse look
    // while pointer-locked. No gravity, no collision (see spec's "why this
    // shape" section).
    this._keys = new Set()
    this._velocity = new THREE.Vector3()
    this._yaw = 0
    this._pitch = 0
    // preventDefault on the movement keys specifically - Space's browser
    // default is "scroll the page down a viewport height", which was never
    // suppressed here. It fired right alongside the camera's own upward
    // movement, so the page (with the canvas inside it) could visibly
    // scroll out from under the camera - easy to misread as "falling" when
    // flying high enough that the drop is dramatic, and confusing to
    // recover from since a second Space press scrolls further rather than
    // undoing the first.
    const MOVEMENT_KEY_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'])
    // Double-tap Space hops the camera straight up exactly one block -
    // instant, not a held/continuous ascend (a hands-free continuous-fly
    // toggle was tried here first and explicitly asked to be removed: it
    // kept climbing until double-tapped again, which read as "flying away"
    // rather than a quick vertical nudge). Each Space press within
    // DOUBLE_TAP_WINDOW_MS of the previous one triggers the hop; a slow,
    // isolated tap never does, same detection window as before.
    const DOUBLE_TAP_WINDOW_MS = 300
    this._lastSpaceTapAt = 0
    this._onKeyDown = (e) => {
      // Without this, typing a block name into the picker's search box
      // (see _pickerSearchInput) both flew the camera around on every W/A/
      // S/D keystroke and silently ate the character itself, since
      // preventDefault() on a movement key stops the input from ever
      // receiving it - this guard was needed even before the search box
      // existed (the picker's Tab-toggle key handling never blocked
      // movement input while open), the search box just made it obvious.
      // The Drop key with a game's inventory open: the item under the pointer.
      if (this.pickerOpen && this.survival.active && this.survival.inv?.open && e.code === getKeyFor('dropItem') && !e.repeat) {
        this.survival.inv.dropHovered()
        return
      }
      if (this.pickerOpen) return
      // Typing in a text box over the game (Settings from the pause
      // screen) doesn't move you or press game keys.
      if (e.target?.closest?.('input, textarea, select')) return
      // The owner's menu (OwnerPowers.js): its key or Escape closes it,
      // and no game keys while it's open.
      const ownerPanel = this.survival?.ownerPanel
      if (ownerPanel && !e.repeat && (e.code === OWNER_KEY || (ownerPanel.open && e.code === 'Escape'))) {
        e.preventDefault()
        ownerPanel.toggle()
        return
      }
      if (ownerPanel?.open) return
      // (Not while playing a game from the homepage - that would drop you
      // into the Map Editor.)
      if (e.code === FIXED_KEYS.buildTry && !e.repeat && !e.ctrlKey && !e.metaKey && !this.gameMenu.forGame) {
        this.toggleTryMode()
        return
      }
      // While trying the map, keys move the player (see BuildTryMode) -
      // the building tools stay off.
      // Spectating works like playing (2026-10-18, Gaymi: "every feature
      // that works regularly in game should work in spectating"): reload,
      // Use (doors, chests - or the next player on a server), inspect and
      // the map key all still work while flying.
      if (this.spectate.active) {
        // The Shop (PlayShop.js) is open: only its own key closes it here.
        if (this.survival.shop?.panelOpen) {
          if (e.code === getKeyFor('shop') && !e.repeat) this.survival.shop.closePanel()
          return
        }
        // The ring editor (RingEditor.js) is open: its key or Escape closes it.
        if (this.survival.ringEditor?.isOpen) {
          if ((e.code === getKeyFor('ringBag') || e.code === 'Escape') && !e.repeat) this.survival.ringEditor.close()
          return
        }
        if (!e.repeat && this.spectate.photo) {
          if (e.code === 'KeyP' || e.code === 'Enter') this.spectate.snap()
        } else if (!e.repeat) {
          if (e.code === getKeyFor('use') && this.spectate.hasPlayers()) this.spectate.onKey(e.code)
          else if (e.code === getKeyFor('use')) startUse(this)
          if (this.survival.active) this.survival.onKeyDown(e.code)
          if (e.code === getKeyFor('inspectWeapon')) this.tryMode.inspect()
          if (e.code === getKeyFor('cycleMap')) this.tryMode.cycleMap()
          if (e.code === getKeyFor('hideHud')) toggleHideHud(this.game)
        }
        if (e.code === getKeyFor('hideHud')) e.preventDefault()
        this._keys.add(e.code)
        if (MOVEMENT_KEY_CODES.has(e.code) || TRY_MOVE_ACTIONS.some((a) => keysFor(a).includes(e.code))) e.preventDefault()
        return
      }
      if (this.tryMode.active) {
        // The Shop (PlayShop.js) is open: only its own key closes it here.
        if (this.survival.shop?.panelOpen) {
          if (e.code === getKeyFor('shop') && !e.repeat) this.survival.shop.closePanel()
          return
        }
        // The ring editor (RingEditor.js) is open: its key or Escape closes it.
        if (this.survival.ringEditor?.isOpen) {
          if ((e.code === getKeyFor('ringBag') || e.code === 'Escape') && !e.repeat) this.survival.ringEditor.close()
          return
        }
        if (this.survival.active && !e.repeat) this.survival.onKeyDown(e.code)
        // Settings > Controls > Hold to Interact: maybe after a hold.
        if (e.code === getKeyFor('use') && !e.repeat) startUse(this)
        if (e.code === getKeyFor('autoRun') && !e.repeat) this.tryMode.toggleAutoRun()
        if (e.code === getKeyFor('inspectWeapon') && !e.repeat) this.tryMode.inspect()
        if (e.code === getKeyFor('cycleMap') && !e.repeat) this.tryMode.cycleMap()
        if (e.code === getKeyFor('cameraView') && !e.repeat) this.tryMode.cycleView()
        // Hide HUD (F1, which would open the browser's help without preventDefault).
        if (e.code === getKeyFor('hideHud')) {
          e.preventDefault()
          if (!e.repeat && this.survival.active) toggleHideHud(this.game)
        }
        this._keys.add(e.code)
        if (MOVEMENT_KEY_CODES.has(e.code) || TRY_MOVE_ACTIONS.some((a) => keysFor(a).includes(e.code))) e.preventDefault()
        return
      }
      // Ctrl/Cmd shortcuts (shown in the Escape menu's Shortcuts box).
      if ((e.ctrlKey || e.metaKey) && !e.repeat) {
        if (e.code === 'KeyZ') {
          e.preventDefault()
          if (e.shiftKey) this.redo()
          else this.undo()
          return
        }
        if (e.code === 'KeyY') {
          e.preventDefault()
          this.redo()
          return
        }
        if (e.code === 'KeyS') {
          e.preventDefault()
          this.save()
          this.game?._showHomepageToast?.(t('buildMenuSavedToast'))
          if (this.menuOpen) this._refreshMenuInfo()
          return
        }
        return
      }
      if (e.code === FIXED_KEYS.buildMirror && !e.repeat) {
        this.toggleMirror()
        return
      }
      if (e.code === 'KeyL' && !e.repeat) {
        this.toggleLineTool()
        return
      }
      if (e.code === 'KeyC' && !e.repeat) {
        this.toggleCopyTool()
        return
      }
      if (e.code === 'KeyP' && !e.repeat) {
        this.pasteClipboard()
        return
      }
      if (!e.repeat && (e.code === FIXED_KEYS.buildFill || e.code === FIXED_KEYS.buildReplace)) {
        this.tools.setMode(e.code === FIXED_KEYS.buildFill ? 'fill' : 'replace')
        return
      }
      if (e.code === FIXED_KEYS.buildShape && !e.repeat) {
        this.tools.cycleShape()
        return
      }
      if (e.code === FIXED_KEYS.buildRotate && !e.repeat) {
        this.tools.rotateClipboard()
        return
      }
      if (e.code === 'Space' && !e.repeat) {
        const now = performance.now()
        if (now - this._lastSpaceTapAt < DOUBLE_TAP_WINDOW_MS) this._hopUp()
        this._lastSpaceTapAt = now
      }
      // "V" for a zoomed-in "look further" view (narrows FOV, doesn't
      // change render distance) - hold to zoom in, release to smoothly
      // return to normal, same feel as a scope. No special-case handling
      // needed here beyond the generic _keys.add(e.code) below - update()
      // reads _keys.has('KeyV') every frame and damps the FOV toward
      // whichever target that implies, the same way it already damps
      // movement velocity toward its own target.
      this._keys.add(e.code)
      if (MOVEMENT_KEY_CODES.has(e.code)) e.preventDefault()
    }
    this._onKeyUp = (e) => {
      this._keys.delete(e.code)
      if (e.code === getKeyFor('use')) endUse(this)
    }
    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return
      // Settings > Controls: Mouse Sensitivity and Invert Look.
      // Aiming down the sights turns the view slower, like zooming in
      // (much slower through a scope; not at all without a gun).
      const sens = LOOK_SENSITIVITY * ((this.game?.settings?.sensitivity ?? 100) / 100) * this.tryMode.aimLookScale()
      // Mouse Smoothing (ControlSettings.lookBy) may spread it over frames.
      lookBy(this, -e.movementX * sens, -e.movementY * sens * (this.game?.settings?.invertY ? -1 : 1))
    }

    // One InstancedMesh per block type (not one Mesh per block) - keeps the
    // scene graph at a fixed 9 objects regardless of how many blocks are
    // placed, avoiding this project's own documented CPU-bound-on-scene-
    // graph-traversal bottleneck (see docs/PERFORMANCE.md).
    // Hotbar starts empty (10 nulls) rather than pre-filled with the first
    // 10 BLOCK_TYPES - you choose what goes in it (see _assignToActiveSlot),
    // same as a fresh Minecraft creative hotbar. selectedType stays null
    // until a slot with something in it is actually selected.
    this.hotbar = new Array(10).fill(null)
    this.activeHotbarIndex = 0
    this.selectedType = null
    this._blocks = new BlockMap() // "x,y,z" -> type id (see BlockMap)
    // Invisible Blocks' own shadows (see _rebuildInvisibleShadows).
    this._invisibleKeys = new Set()
    this._invisShadowDirty = false
    this._invisShadowMesh = null
    this._doorState = new Map() // "x,y,z" (both halves) -> { facing: 0-3, open }
    this._boundsDirty = new Set() // shaped meshes a bulk fill added to (_flushBounds)
    this._stairFacing = new Map() // "x,y,z" -> 0-3, the side the high step faces (0 +z, 1 +x, 2 -z, 3 -x)
    // Undo/Redo - every real placeBlock()/removeBlock() call (not a no-op
    // on an already-occupied/already-empty cell) pushes one entry here,
    // regardless of which tool triggered it (a single click, Mirror's
    // second placement, Line Tool's drag, Paste's whole clipboard) - see
    // both methods' own recording line. A tool that changes many cells at
    // once (paste, line, fill, shapes, mirrored clicks) wraps them in
    // _undoGroupDo, so one Undo takes the whole action back (2026-10-04 -
    // before, a pasted house needed one Undo per block).
    this._undoStack = []
    this._redoStack = []
    // Sidesteps undo()/redo() calling back into placeBlock()/removeBlock()
    // to apply the reversal, which would otherwise record ANOTHER undo
    // entry for the reversal itself.
    this._suppressUndoRecording = false
    // Multiple save slots (see switchSlot) - which of SAVE_SLOT_COUNT slots
    // is currently loaded/being edited. Not persisted itself (always opens
    // back on slot 0) - keeping it simple rather than adding a second
    // "remember last slot" storage key for a minor convenience.
    this.activeSlot = 0
    this._autosaveTimer = null
    this._onPageHide = () => {
      if (this.active && (document.visibilityState === 'hidden' || !document.visibilityState)) this.save()
    }
    // Mirror mode (see toggleMirror/_mirrorX) - off by default. Mirrors
    // across world x=0, the same plane the free-fly camera spawns facing
    // down (see the constructor's camera.position), so it lines up with
    // where a player naturally starts building.
    this.mirrorMode = false
    // Line tool (see toggleLineTool/_lineToolClick) - place-only (right-
    // click), two clicks per line: first sets the start point, second sets
    // the end point and fills every cell between them. Left-click removal
    // is untouched (still single-block) - a line-remove mode would double
    // the interaction surface for a much rarer use case.
    this.lineToolMode = false
    this._lineStart = null
    // Copy/Paste (see toggleCopyTool/_copyToolClick/pasteClipboard) - same
    // two-click flow as the line tool, but marking opposite corners of a
    // box instead of two ends of a line. Mutually exclusive with the line
    // tool (see toggleLineTool/toggleCopyTool) so right-click always has
    // one unambiguous meaning. Paste (P key) works independently of
    // whether copy tool mode is currently on, as long as something's been
    // copied.
    this.copyToolMode = false
    this._copyStart = null
    this._clipboard = null
    // Plain cubes are drawn by chunk meshes (see BlockChunks.js) - only
    // their visible faces, one draw call per chunk. The per-type
    // InstancedMesh path below is kept just for shaped blocks.
    // The graphics level's block pictures (plain or detailed) before the
    // atlas is drawn; render() follows later changes (_applyGraphicsLook).
    setTextureDetail(graphicsLook(game?.settings).detail)
    this._chunks = new BlockChunks(this.scene, {
      blockSize: BLOCK_SIZE,
      types: BLOCK_TYPES,
      // 8x keeps far ground sharp (2026-10-18, "very blurry"); much
      // cheaper on weak GPUs - and phones/tablets skip it (anisotropic
      // filtering is one of the slowest things for an old phone's GPU).
      // 16x on a computer and 2x on a phone since 2026-10-23 ("blurry the
      // further you look").
      maxAnisotropy: Math.min(TOUCH_DEVICE ? 2 : 16, renderer.capabilities.getMaxAnisotropy()),
      faces: blockFaceCanvases,
      // The 32x32 block pictures at their own size (drawn crisp, BlockChunks).
      tile: 32,
      hasAlpha: textureHasAlpha,
      getType: (x, y, z) => this._blocks.at(x, y, z),
      liquidHeight: (x, y, z) => this.liquids.heightAt(x, y, z),
    })
    this._chunkCells = new Map() // "cx,cy,cz" -> Set of "x,y,z" cube cells in that chunk
    this._instancedMeshes = {}
    this._instanceKeyByIndex = {} // type id -> array mapping instance index -> "x,y,z" key, for swap-remove
    const blockGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE)
    // Computed once, not per texture - same value for every block type,
    // and querying the renderer's actual capability (rather than a
    // hardcoded guess) means this is correct on any GPU, including one
    // that only supports less than a typical desktop's 16x.
    const maxAnisotropy = TOUCH_DEVICE ? 1 : Math.min(4, renderer.capabilities.getMaxAnisotropy())
    // Shaped blocks' meshes (stairs/fences/ladder/slabs) are created the
    // first time one is placed (see _shapedMesh) - with a slab for every
    // block there are ~190 shaped types, and reserving a full-size
    // InstancedMesh for each up front would hold ~270 MB of GPU memory for
    // blocks most maps never use.
    this._blockGeo = blockGeo
    this._maxAnisotropy = maxAnisotropy

    // Mirror-plane visual (see toggleMirror) - a large, thin, translucent
    // panel at world x=0 so the mirror line is actually visible while
    // building, not just an invisible rule. Hidden until mirror mode is
    // switched on.
    const mirrorPlaneGeo = new THREE.PlaneGeometry(GROUND_SIZE * BLOCK_SIZE, 60)
    const mirrorPlaneMat = new THREE.MeshBasicMaterial({ color: 0x5be3ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    this._mirrorPlaneMesh = new THREE.Mesh(mirrorPlaneGeo, mirrorPlaneMat)
    this._mirrorPlaneMesh.rotation.y = Math.PI / 2
    this._mirrorPlaneMesh.position.set(0, 20, 0)
    this._mirrorPlaneMesh.visible = false
    this.scene.add(this._mirrorPlaneMesh)

    // Line tool's pending-start marker - a wireframe outline around the
    // first-clicked cell, visible while waiting for the second click so the
    // start point isn't invisible/easy to forget about.
    const lineMarkerGeo = new THREE.BoxGeometry(BLOCK_SIZE * 1.05, BLOCK_SIZE * 1.05, BLOCK_SIZE * 1.05)
    this._lineMarkerMesh = new THREE.LineSegments(new THREE.EdgesGeometry(lineMarkerGeo), new THREE.LineBasicMaterial({ color: 0xffcf5c }))
    this._lineMarkerMesh.visible = false
    this.scene.add(this._lineMarkerMesh)

    this._raycaster = new THREE.Raycaster()
    // Try Map (BuildTryMode.js): walk the map in first person with a gun.
    this.tryMode = new BuildTryMode(this, BLOCK_SIZE)
    // Bumped on every block change, so the minimap knows to redraw.
    this._mapVersion = 0
    this.liquids = new LiquidFlow(this)
    this.world = new OpenWorld(this)
    // Fill, Replace and the shape tools (BuildTools.js).
    this.tools = new BuildTools(this, BLOCK_SIZE)
    // Levers, pressure plates, signs, chests (BuildGadgets.js).
    this.gadgets = new BuildGadgets(this, BLOCK_SIZE)
    this.specials = new BuildSpecials(this, BLOCK_SIZE)
    // Play: zombie waves on your own map (BuildSurvival.js).
    this.survival = new BuildSurvival(this, BLOCK_SIZE)
    // Touch controls for walking/playing on a phone (BuildTouch.js).
    this.touch = new BuildTouch(this)
    // Share codes + Community Maps, and building live with friends.
    this.share = new BuildShare(this)
    this.together = new BuildTogether(this, BLOCK_SIZE)
    this.sharedInfo = null
    try {
      this.sharedInfo = JSON.parse(localStorage.getItem(SHARED_INFO_KEY) || 'null')
    } catch {
      // Not opened one yet.
    }
    document.getElementById('build-mode-together-btn')?.addEventListener('click', () => this.together.openPanel())
    document.getElementById('build-mode-play-btn')?.addEventListener('click', () => {
      if (this.survival.active) this.survival.stop()
      else this.survival.start()
    })
    // Time of day and weather (BuildSky.js).
    this.sky = new BuildSky(this, BLOCK_SIZE)
    // 3D grass on grass blocks on the realistic levels (GrassTufts.js).
    this.grassTufts = new GrassTufts(this, BLOCK_SIZE)
    // Cloth flags over the open world's castles (CastleFlags.js).
    this.castleFlags = new CastleFlags(this, BLOCK_SIZE)
    // Dust floating in sunlight on In Real Life (AirMotes.js).
    this.airMotes = new AirMotes(this, BLOCK_SIZE)
    // Leaves drifting down from trees (FallingLeaves.js).
    this.fallingLeaves = new FallingLeaves(this, BLOCK_SIZE)
    this.spectate = new PlaySpectate(this, BLOCK_SIZE)
    // A dot in the middle of the screen to aim with while trying the map.
    this._tryCrosshairEl = document.createElement('div')
    this._tryCrosshairEl.id = 'build-try-crosshair'
    this._tryCrosshairEl.style.display = 'none'
    document.body.appendChild(this._tryCrosshairEl)
    this._onPointerDown = (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) {
        if (this.mouseScreenOpen()) return
        // Cursor is free (Build Mode no longer auto-locks the instant you
        // enter, see Game.js's _enterBuildMode - it was disorienting to
        // have the mouse captured before you'd even gotten oriented).
        // Clicking into the viewport re-acquires it instead of placing/
        // removing a block, so this first click is never mistaken for a
        // build action.
        try { this.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available in this environment */ }
        return
      }
      // Trying the map: clicks shoot (and, held on a block, break it -
      // BuildTryMode._updateDigging); nothing gets built.
      // Spectating: on a server a click watches the next player; alone it
      // shoots like normal.
      // Photo Mode: a click takes the picture (once the mouse is locked).
      if (this.spectate.active && this.spectate.photo) {
        if (e.button === 0 && document.pointerLockElement === this.renderer.domElement) this.spectate.snap()
        return
      }
      if (this.spectate.active && this.spectate.hasPlayers() && e.button === 0) {
        this.spectate.cycle(1)
        return
      }
      if (this.tryMode.active) {
        if (e.button === 0) {
          // Held down, an automatic gun keeps firing (BuildSurvival.update).
          this._fireHeld = true
          this.tryMode.fire()
        }
        // Right-click aims down the sights while it's held and stops when
        // it's let go (2026-10-17, Gaymi: "if you stop clicking right
        // click it stops aiming") - doors, chests and NPCs are on the Use
        // key (E).
        // Holding a block from the inventory: right-click places it.
        // Right-clicking the go-kart hops in (GoKart.js).
        else if (e.button === 2 && this.survival?.active && (this.survival.kart?.rightClick() || this.survival.vehicles?.rightClick())) return
        else if (e.button === 2 && this.survival?.holding?.kind === 'block') this.survival.placeHeldBlock()
        // Spin ring games (SpinRing.js): held right-click pulls the ring in
        // tight (left click spreads it - _fireHeld).
        else if (e.button === 2 && this.survival?.active && this.survival.ring) this._ringPull = true
        else if (e.button === 2) this.tryMode.setAim(true)
        return
      }
      if (e.button === 2) {
        if (this.tools.mode) this.tools.click()
        else if (this.lineToolMode) this._lineToolClick()
        else if (this.copyToolMode) this._copyToolClick()
        else this._placeFromCamera()
      } else if (e.button === 0) this._removeFromCamera()
    }
    this._onContextMenu = (e) => { if (this.active) e.preventDefault() }

    // Tab picker overlay - a plain DOM grid (not part of the 3D scene) of
    // every block type, toggled with Tab. The search input is built once
    // and never touched by innerHTML rebuilds (only the grid below it is)
    // so typing doesn't lose focus/cursor position on every keystroke.
    this.pickerOpen = false
    // Animals put down in this map (_setAnimalSpots) and the one picked to
    // put down next.
    this.animalSpots = []
    this.placingAnimal = null
    this._pickerEl = document.getElementById('build-picker')
    if (this._pickerEl) {
      this._pickerEl.innerHTML = ''
      // Search bar and a block-type dropdown side by side, inside the
      // picker's frame (the same oval search bar as everywhere else).
      const toolbar = document.createElement('div')
      toolbar.className = 'build-picker-toolbar'
      this._pickerSearchInput = document.createElement('input')
      this._pickerSearchInput.type = 'text'
      this._pickerSearchInput.className = 'nickname-input search-bar build-picker-search'
      this._pickerSearchInput.placeholder = 'Search blocks...'
      this._pickerSearchInput.addEventListener('click', (e) => e.stopPropagation())
      this._pickerSearchInput.addEventListener('input', () => this._renderPickerGrid())
      toolbar.appendChild(this._pickerSearchInput)
      this._pickerCategorySelect = document.createElement('select')
      this._pickerCategorySelect.className = 'nickname-input build-picker-category'
      for (const [value, label] of [['all', 'All blocks'], ...PICKER_CATEGORIES]) {
        const opt = document.createElement('option')
        opt.value = value
        opt.textContent = label
        this._pickerCategorySelect.appendChild(opt)
      }
      this._pickerCategorySelect.addEventListener('click', (e) => e.stopPropagation())
      this._pickerCategorySelect.addEventListener('change', () => this._renderPickerGrid())
      toolbar.appendChild(this._pickerCategorySelect)
      this._pickerEl.appendChild(toolbar)
      this._pickerGridEl = document.createElement('div')
      this._pickerGridEl.className = 'build-picker-grid'
      this._pickerEl.appendChild(this._pickerGridEl)
    }
    // The grid is drawn when the picker opens (togglePicker), not here -
    // drawing its ~400 block icons while BuildMode was being made in the
    // background was a hitch on whatever the player clicked meanwhile.

    // Always-on-screen quick-select bar (Minecraft-style, Digit1-9/0) - 10
    // slots you assign yourself from the Tab picker (see
    // _assignToActiveSlot), not pre-filled.
    this._hotbarEl = document.getElementById('build-hotbar')
    this._renderHotbar()

    // Save-slot picker (see switchSlot) - a small always-visible row of
    // SAVE_SLOT_COUNT buttons, not tucked inside a menu, since switching
    // slots is meant to be a quick one-click action mid-build.
    this._slotsEl = document.getElementById('build-slots')
    this._renderSlots()

    // Mirror toggle button (see toggleMirror) - the N key does the same
    // thing, this is just the discoverable/clickable equivalent.
    this._mirrorBtnEl = document.getElementById('build-mode-mirror-btn')
    if (this._mirrorBtnEl) this._mirrorBtnEl.addEventListener('click', () => this.toggleMirror())

    // Line tool toggle button (see toggleLineTool) - the L key does the
    // same thing.
    this._lineToolBtnEl = document.getElementById('build-mode-line-btn')
    if (this._lineToolBtnEl) this._lineToolBtnEl.addEventListener('click', () => this.toggleLineTool())

    // Copy tool + Paste buttons (see toggleCopyTool/pasteClipboard) - C and
    // P keys do the same things.
    this._copyToolBtnEl = document.getElementById('build-mode-copy-btn')
    if (this._copyToolBtnEl) this._copyToolBtnEl.addEventListener('click', () => this.toggleCopyTool())
    this._pasteBtnEl = document.getElementById('build-mode-paste-btn')
    if (this._pasteBtnEl) this._pasteBtnEl.addEventListener('click', () => this.pasteClipboard())
    document.getElementById('build-mode-rotate-btn')?.addEventListener('click', () => this.tools.rotateClipboard())
    document.getElementById('build-mode-fill-btn')?.addEventListener('click', () => this.tools.setMode('fill'))
    document.getElementById('build-mode-replace-btn')?.addEventListener('click', () => this.tools.setMode('replace'))
    document.getElementById('build-mode-shape-btn')?.addEventListener('click', () => this.tools.cycleShape())

    // Undo/Redo buttons (see undo()/redo() and _updateUndoRedoButtons) -
    // disabled whenever their stack is empty rather than a silent no-op.
    this._undoBtnEl = document.getElementById('build-mode-undo-btn')
    if (this._undoBtnEl) this._undoBtnEl.addEventListener('click', () => this.undo())
    this._redoBtnEl = document.getElementById('build-mode-redo-btn')
    if (this._redoBtnEl) this._redoBtnEl.addEventListener('click', () => this.redo())
    this._updateUndoRedoButtons()

    // Reset Map - confirms first (same window.confirm convention as
    // Import/Download, both of which also replace the current build with
    // no way back), then wipes to a bare ground layer, matching
    // importMapFile's own clear-then-repopulate-ground-then-save sequence.
    this._resetBtnEl = document.getElementById('build-mode-reset-btn')
    if (this._resetBtnEl) {
      this._resetBtnEl.addEventListener('click', () => {
        if (!window.confirm(t(this.activeSlot === MAP3_SLOT ? 'buildResetMap3Confirm' : 'buildResetConfirm'))) return
        this.clearAllBlocks()
        // Map 3 resets back to the generated city, a slot to bare ground.
        if (this.activeSlot === MAP3_SLOT) this._applyMap3({ removed: [], placed: [] })
        else this._ensureGroundLayer()
        this.save()
      })
    }

    // Action menu (Exit/Save/Export/Import/Mirror/Line/Copy/Paste) - see
    // toggleMenu, opened with Escape.
    this.menuOpen = false
    this._menuEl = document.getElementById('build-menu')
    // ...and the pause screen while playing a game from the homepage.
    this.gameMenu = new PlayPauseMenu(this)
    document.getElementById('build-mode-try-btn')?.addEventListener('click', () => this.toggleTryMode())
    document.getElementById('build-menu-close')?.addEventListener('click', () => {
      if (this.menuOpen) this.toggleMenu()
    })


    this._onKeyDownHotbar = (e) => {
      // Same reasoning as _onKeyDown's guard - without it, typing a digit
      // while searching the picker (e.g. "TNT" has none, but plenty of
      // names could) would also switch the active hotbar slot underneath.
      if (this.pickerOpen) return
      const digitIndex = DIGIT_KEY_TO_HOTBAR_INDEX[e.code]
      if (digitIndex === undefined) return
      // With the emote bar open, 1-3 pick an emote instead (Emotes.js).
      if (this.survival?.active && this.survival.emotes?.pick(e.code)) return
      if (this.survival?.active && this.survival.inv) this.survival.inv.select(digitIndex)
      else this._selectHotbarSlot(digitIndex)
    }

    // Mouse wheel / trackpad scroll steps through the hotbar like
    // Minecraft (down = next slot). Trackpads send many small deltas, so
    // they're added up and one slot moves per ~one wheel notch.
    this._wheelAccum = 0
    this._onWheel = (e) => {
      if (!this.active || this.pickerOpen || this.menuOpen) return
      if (e.target?.closest?.('#build-picker, #build-menu, #community-maps-panel, #build-together-panel, #build-try-map')) return
      this._wheelAccum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const steps = Math.trunc(this._wheelAccum / 60)
      if (!steps) return
      this._wheelAccum -= steps * 60
      const dir = Math.sign(steps) * (this.game?.settings?.invertScrollWeaponSwitch ? -1 : 1)
      if (this.survival?.active && this.survival.inv) {
        const inv = this.survival.inv
        inv.select((((inv.active + dir) % 10) + 10) % 10)
        return
      }
      const next = (((this.activeHotbarIndex + dir) % 10) + 10) % 10
      this._selectHotbarSlot(next)
    }

    this._onKeyDownPicker = (e) => {
      // The emote wheel is up (Emotes.js): Escape closes it.
      if (e.code === 'Escape' && this.survival?.emotes?.open) {
        this.survival.emotes.close()
        return
      }
      // An NPC's shop is open: Escape closes it, nothing else happens.
      if (this.survival?.shop?.panelOpen) {
        if (e.code === 'Escape') this.survival.shop.closePanel()
        return
      }
      if (this.survival?.ringEditor?.isOpen) {
        if (e.code === 'Escape' || e.code === getKeyFor('ringBag')) this.survival.ringEditor.close()
        return
      }
      if (e.code === 'Tab') {
        e.preventDefault()
        this.togglePicker()
      } else if (e.code === 'Escape' && this.pickerOpen) {
        this.togglePicker()
      } else if (e.code === 'Escape' && this.gameMenu.settingsOpen) {
        // Settings over the game's pause screen: back to the pause screen
        // (unless Escape was cancelling a key change in it).
        if (!e.defaultPrevented) this.gameMenu.closeSettings()
      } else if (e.code === 'Escape') {
        // Opens/closes the action menu (see toggleMenu) - which also
        // releases/reacquires pointer lock as part of that, so this
        // replaces what used to be a bare exitPointerLock() call here.
        this.toggleMenu()
      }
    }

    // Click anywhere outside the picker's own grid to close it - the
    // picker has no backdrop element of its own (it's just the centered
    // grid, position:fixed with nothing behind it), so this listens on
    // document and checks the click target instead of adding one.
    this._onPickerBackdropClick = (e) => {
      if (!this.pickerOpen || !this._pickerEl) return
      if (!this._pickerEl.contains(e.target)) this.togglePicker()
    }
  }

  // slot: open on this slot (a number, or 'map3'); omitted keeps the
  // slot from last time this session.
  enter({ slot } = {}) {
    // The scene keeps the last build between visits; a different slot has
    // to start from an empty scene, or the old build mixes into it.
    if (slot !== undefined && slot !== this.activeSlot) {
      this.clearAllBlocks()
      this.activeSlot = slot
    }
    this.active = true
    setHomePaused(true)
    window.addEventListener('pagehide', this._onPageHide)
    document.addEventListener('visibilitychange', this._onPageHide)
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('keydown', this._onKeyDownPicker)
    window.addEventListener('keydown', this._onKeyDownHotbar)
    window.addEventListener('wheel', this._onWheel, { passive: true })
    this._wheelAccum = 0
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown)
    // A screen you click on (Choose Your Weapon, You Died...) never keeps
    // the mouse captured (2026-10-26, Gaymi: "i cant actually move my mouse
    // to pick"). A capture asked for just before the screen opened (Play
    // Again, a click into the view) only lands after its exitPointerLock()
    // already ran, so whenever the mouse gets caught, check again here.
    this._onLockChange = () => {
      if (document.pointerLockElement === this.renderer.domElement && this.mouseScreenOpen()) {
        try { document.exitPointerLock() } catch { /* not available */ }
      }
    }
    document.addEventListener('pointerlockchange', this._onLockChange)
    this._onScreenClick = () => {
      if (!this._mouseFreedForScreen) return
      if (!this.tryMode?.active || this.mouseScreenOpen() || this.spectate?.active) return
      this._mouseFreedForScreen = false
      if (document.pointerLockElement === this.renderer.domElement) return
      try { this.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available in this environment */ }
    }
    document.addEventListener('click', this._onScreenClick)
    this._onPointerUp = (e) => {
      if (e.button === 0) this._fireHeld = false
      if (e.button === 2) this._ringPull = false
      if (e.button === 2 && this.tryMode?.active) this.tryMode.setAim(false)
    }
    window.addEventListener('pointerup', this._onPointerUp)
    window.addEventListener('contextmenu', this._onContextMenu)
    document.addEventListener('click', this._onPickerBackdropClick)
    if (this._hotbarEl) this._hotbarEl.style.display = 'flex'
    if (this._slotsEl) this._slotsEl.style.display = 'grid'
    // The aiming dot shows while building too, not just in Try Map.
    this._tryCrosshairEl.style.display = 'block'
    // #build-menu (Exit/Save/Export/Import/Mirror/Line/Copy/Paste) starts
    // closed - see toggleMenu, opened with Escape rather than sitting on
    // screen the whole time.
    this.menuOpen = false
    if (this._menuEl) this._menuEl.style.display = 'none'
    this.gameMenu.show(false)
    this.load()
    this._renderSlots()
    this.sky.onEnter()
  }

  exit() {
    // Leaving from deep in a cave: no extra light left on the homepage.
    if (this._baseExposure !== undefined) this.renderer.toneMappingExposure = this._baseExposure
    if (this.tryMode.active) this.toggleTryMode()
    this.together.leave()
    this.sky.onExit()
    this._campDisplay?.dispose()
    this._campDisplay = null
    this.castleFlags.clear()
    this.share.close()
    this.together.closePanel()
    this.save()
    this._saveSlotThumb()
    this.active = false
    // The homepage always wears the theme (2026-10-26, Gaymi: "after leaving
    // game the homepage should not change with biome"). TopBar only switches
    // the biome look while a game is drawn, so it is switched off here.
    setBiomeTheme(false, this.game?.settings)
    setHomePaused(false)
    this.touch.update(0)
    this.tryMode.drawBuildMap(0, false)
    window.removeEventListener('pagehide', this._onPageHide)
    document.removeEventListener('visibilitychange', this._onPageHide)
    this._keys.clear()
    // Mirror resets off on exit - a returning player starting a fresh
    // session shouldn't be surprised by a toggle they don't remember
    // leaving on.
    if (this.mirrorMode) this.toggleMirror()
    if (this.lineToolMode) this.toggleLineTool()
    if (this.copyToolMode) this.toggleCopyTool()
    this.tools.off()
    this.tools.refreshHint()
    // No toggle state to reset any more (V is a held key, read live from
    // _keys in update()) - just snap the FOV back in case V happened to
    // be held mid-zoom when Build Mode was exited.
    if (this.camera.fov !== this._normalFov()) {
      this.camera.fov = this._normalFov()
      this.camera.updateProjectionMatrix()
    }
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('keydown', this._onKeyDownPicker)
    window.removeEventListener('keydown', this._onKeyDownHotbar)
    window.removeEventListener('wheel', this._onWheel)
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown)
    document.removeEventListener('pointerlockchange', this._onLockChange)
    document.removeEventListener('click', this._onScreenClick)
    window.removeEventListener('pointerup', this._onPointerUp)
    this._fireHeld = false
    window.removeEventListener('contextmenu', this._onContextMenu)
    document.removeEventListener('click', this._onPickerBackdropClick)
    this.pickerOpen = false
    if (this._pickerEl) this._pickerEl.style.display = 'none'
    if (this._hotbarEl) this._hotbarEl.style.display = 'none'
    if (this._slotsEl) this._slotsEl.style.display = 'none'
    this._tryCrosshairEl.style.display = 'none'
    this.menuOpen = false
    if (this._menuEl) this._menuEl.style.display = 'none'
    this.gameMenu.show(false)
    if (this._hotbarEl) this._hotbarEl.style.visibility = ''
    if (this.game?.fpsEl) this.game.fpsEl.style.visibility = ''
  }

  // Map 3's camp NPCs stand there while you build too (2026-10-05); Play
  // brings its own working ones (BuildSurvival's camp), so this set steps
  // aside while Play is on.
  _updateCampDisplay(dt) {
    const want = this.active && this.activeSlot === MAP3_SLOT && !this.survival.active
    if (want && !this._campDisplay) {
      const zone = this._map3Base().map.safeZone
      if (zone) this._campDisplay = new BuildCamp(null, zone, BLOCK_SIZE, { display: true, buildMode: this })
    } else if (!want && this._campDisplay) {
      this._campDisplay.dispose()
      this._campDisplay = null
    }
    this._campDisplay?.update(dt)
  }

  // --- Try Map support (BuildTryMode's collision asks these) ---
  // How far in from each side a narrow block (bamboo...) stands: 0 for any
  // other block.
  _cellInset(x, y, z) {
    const type = this.getBlockAt(x, y, z)
    return (type && BLOCK_BY_ID.get(type)?.inset) || 0
  }

  // How much of a cell, from its bottom, is solid to walk into: 0 for air,
  // water/lava, ladders and open doors, half for slabs and stairs, else 1.
  _cellSolidTop(x, y, z) {
    const type = this.getBlockAt(x, y, z)
    if (!type) return 0
    if (this._chunks.isLiquid(type)) return 0
    const shape = BLOCK_BY_ID.get(type)?.shape
    if (shape === 'ladder') return 0
    // Coral and seagrass: swum through.
    if (BLOCK_BY_ID.get(type)?.plant) return 0
    if (shape === 'door' || shape === 'doortop') {
      const bottomY = shape === 'doortop' ? y - 1 : y
      return this.isDoorOpenAt(x, bottomY, z) ? 0 : 1
    }
    if (shape === 'slab' || shape === 'stairs') return 0.5
    // Plates, levers and signs are walked over / through; a chest is
    // nearly a full block.
    if (shape === 'pad' || shape === 'lever' || shape === 'sign') return 0
    if (shape === 'chest') return 0.875
    return 1
  }

  // A top-down picture of the map, one pixel per column, for Try Map's
  // minimap: the color of the highest block in each column, darker the
  // lower it sits, so streets, roofs and walls read like a real map.
  _buildTopDownMap() {
    const half = GROUND_SIZE / 2
    const top = new Map()
    // With the open world around Map 1 only the city's own cells are read
    // (the land around it is drawn from its noise, OpenWorld.mapTile, and
    // shows through where this picture is left clear).
    const cityChunks = half / CHUNK
    const entries = this.world.active
      ? (function* (chunkCells, blocks) {
        for (const [ck, cells] of chunkCells) {
          const [cx, , cz] = ck.split(',').map(Number)
          if (cx < -cityChunks || cx >= cityChunks || cz < -cityChunks || cz >= cityChunks) continue
          for (const key of cells) yield [key, blocks.get(key)]
        }
      })(this._chunkCells, this._blocks)
      : this._blocks
    for (const [key, type] of entries) {
      const def = BLOCK_BY_ID.get(type)
      if (!def || def.shape === 'invisible' || def.hidden) continue
      const [x, y, z] = key.split(',').map(Number)
      if (x < -half || x >= half || z < -half || z >= half) continue
      if (this.world.active && !cityCell(x, z)) continue
      const ck = (x + half) * GROUND_SIZE + (z + half)
      const cur = top.get(ck)
      if (!cur || y > cur.y) top.set(ck, { y, color: def.color })
    }
    const canvas = document.createElement('canvas')
    canvas.width = GROUND_SIZE
    canvas.height = GROUND_SIZE
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(GROUND_SIZE, GROUND_SIZE)
    for (let i = 0; i < GROUND_SIZE * GROUND_SIZE; i++) {
      const cell = top.get(i)
      const px = Math.floor(i / GROUND_SIZE)
      const pz = i % GROUND_SIZE
      const o = (pz * GROUND_SIZE + px) * 4
      if (!cell) {
        // Past the city's outline the land's own picture shows through.
        img.data[o + 3] = this.world.active && !cityCell(px - half, pz - half) ? 0 : 255
        continue
      }
      const shade = 0.62 + 0.38 * Math.min(1, Math.max(0, (cell.y + 1) / 16))
      img.data[o] = ((cell.color >> 16) & 255) * shade
      img.data[o + 1] = ((cell.color >> 8) & 255) * shade
      img.data[o + 2] = (cell.color & 255) * shade
      img.data[o + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }

  _cellIsStairs(x, y, z) {
    const type = this.getBlockAt(x, y, z)
    return !!type && BLOCK_BY_ID.get(type)?.shape === 'stairs'
  }

  // Trying the map: right-click or E opens/closes the door you're looking
  // at, within arm's reach - and never swings one shut onto yourself.
  _tryUseFromCamera() {
    // Off someone else's vehicle (RemoteRides.js).
    if (this.survival?.active && this.survival.passenger?.on && this.survival.passenger.use()) return true
    // Hop in or out of the go-kart (GoKart.js).
    if (this.survival?.active && this.survival.vehicles?.riding && this.survival.vehicles.use()) return true
    // On or off a tamed animal (AnimalRiding.js).
    if (this.survival?.active && this.survival.riding?.use()) return true
    if (this.survival?.active && this.survival.kart?.use()) return true
    // ...or a boat / helicopter (Vehicles.js).
    if (this.survival?.active && this.survival.vehicles?.use()) return true
    // ...or on board another player's, as a passenger (RemoteRides.js).
    if (this.survival?.active && this.survival.passenger?.use()) return true
    // Into the Zombie Train, or a rocket to the Moon (ZombieTrain.js, MoonTrip.js).
    if (this.survival?.active && this.survival.train?.use()) return true
    if (this.survival?.active && this.survival.moon?.use()) return true
    // The Time Machine and the Theme Park's rides (TimeMachine.js, ThemePark.js).
    if (this.survival?.active && this.survival.time?.use()) return true
    if (this.survival?.active && this.survival.park?.use()) return true
    // Cooking and serving at the Zombie Diner (ZombieDiner.js).
    if (this.survival?.active && this.survival.diner?.use()) return true
    // Battle a Pack Leader standing next to you (PackLeaderWorld.js).
    if (this.survival?.active && this.survival.leaders?.use()) return true
    // Playing on Map 3: talk to the camp NPC you're looking at.
    if (this.survival?.camp?.use()) return true
    // Give a rescued survivor an order: follow me / hold here (Survivors.js).
    if (this.survival?.active && this.survival.survivors?.use()) return true
    // Tame the animal you're looking at (PlayAnimals.js).
    if (this.survival?.active && this.survival.animals?.use()) return true
    // Pick up drops lying near you (when Auto Pick-Up is off, PlayDrops.js).
    if (this.survival?.active && this.survival._drops?.pickUpNear()) return true
    this.camera.updateMatrixWorld()
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (!hit) return false
    const [x, y, z] = hit.existingBlock
    const c = this.camera.position
    const reach = TRY_REACH_BLOCKS * BLOCK_SIZE
    if (Math.hypot((x + 0.5) * BLOCK_SIZE - c.x, (y + 0.5) * BLOCK_SIZE - c.y, (z + 0.5) * BLOCK_SIZE - c.z) > reach) return false
    // Escape Rooms' keypad and buttons (EscapeRooms.js).
    if (this.survival?.active && this.survival.escape?.useBlock(x, y, z)) return true
    if (this.gadgets.use(x, y, z, true)) return true
    if (this.specials.use(x, y, z)) return true
    if (this.survival?.useChest(x, y, z)) return true
    if (!this.toggleDoor(x, y, z)) return false
    if (this.tryMode.overlapsSolid()) this.toggleDoor(x, y, z)
    return true
  }

  _cellIsLiquid(x, y, z) {
    const type = this.getBlockAt(x, y, z)
    // Coral and seagrass stand in sea water, so you swim through them.
    return !!type && (this._chunks.isLiquid(type) || !!BLOCK_BY_ID.get(type)?.plant)
  }

  // Coral/seagrass (`plant` blocks): see-through, swum through.
  isPlantBlock(type) {
    return !!type && !!BLOCK_BY_ID.get(type)?.plant
  }

  // How many seconds holding the button on a block takes to break it while
  // playing (2026-10-17, Gaymi: "stone should take longer to break compared
  // to wood"), by what it's made of. Slabs, stairs, fences and doors break
  // like the block they're cut from. The game's own blocks (Player Start,
  // spawners, chests, levers...) and liquids don't break.
  // Wooden blocks (planks, logs, crates, hay, bookshelves, wooden doors,
  // fences, slabs and stairs) and leaves catch fire from the Flamethrower and burn
  // away (BuildSurvival's fires, 2026-10-17).
  isFlammable(type) {
    let def = type && BLOCK_BY_ID.get(type)
    if (!def || def.game || def.shape === 'doortop') return false
    if (def.shape) def = BLOCK_BY_ID.get(SHAPED_TEXTURE_FROM[def.id] || def.slabOf || def.stairsOf) || def
    return ['wood', 'log', 'spine', 'leaves'].includes(def.pattern)
  }

  // For the game's inventory (PlayInventory.js): a block's picture, name,
  // and whether an id is a real block.
  blockIcon(id) {
    const bt = BLOCK_BY_ID.get(id)
    return bt ? _blockIcon(bt) : ''
  }

  blockName(id) {
    return BLOCK_BY_ID.get(id)?.name || id
  }

  isBlockType(id) {
    return BLOCK_BY_ID.has(id)
  }

  blockTypeOf(id) {
    return BLOCK_BY_ID.get(id) || null
  }

  // The top bar's biome picture where you are (BiomeBar.js).
  biomeBarLook() {
    const p = this.tryMode?.active ? this.tryMode.pos : null
    return p ? biomeBarLook(this, p.x, p.z) : null
  }

  // Leaves and logs - fire races through a tree (BuildSurvival's fires).
  isTreeBlock(type) {
    const def = type && BLOCK_BY_ID.get(type)
    return !!def && (def.pattern === 'leaves' || def.pattern === 'log')
  }

  breakSeconds(type) {
    let def = type && BLOCK_BY_ID.get(type)
    if (!def || def.game || def.shape === 'invisible' || LIQUID_TYPES.has(type)) return Infinity
    if (def.shape) {
      const from = BLOCK_BY_ID.get(SHAPED_TEXTURE_FROM[def.id] || def.slabOf || def.stairsOf)
      if (from) def = from
      else if (/door|ladder|fence|trapdoor|sign/.test(def.shape + def.id)) return BREAK_SECONDS.wood
    }
    for (const [re, sec] of BREAK_SECONDS_BY_ID) if (re.test(def.id)) return sec
    return BREAK_SECONDS[_blockCategory(def)] ?? BREAK_SECONDS.stone
  }

  shapeOf(type) {
    return BLOCK_BY_ID.get(type)?.shape || null
  }

  // A block's door / facing state, so a block broken while playing comes
  // back the same way round (BuildTryMode._restoreWindows).
  _blockStateOf(x, y, z) {
    const key = this._key(x, y, z)
    const shape = BLOCK_BY_ID.get(this._blocks.get(key))?.shape
    if (shape === 'door' && this._doorState.has(key)) return { ...this._doorState.get(key) }
    if (FACED_SHAPES.has(shape) && this._stairFacing.has(key)) return this.gadgets.stateOf(key)
    return null
  }

  // Glass blocks (clear, stained, tinted) - the windows Try Map's shots
  // crack and break. Honey/slime look like glass but aren't windows.
  _isWindowType(type) {
    const def = type && BLOCK_BY_ID.get(type)
    return !!def && !def.shape && def.pattern === 'glass' && def.id.includes('glass')
  }

  // Geometry + material(s) for the block shown in the player's hand while
  // building (BuildTryMode.drawHand): a cube textured like the block, or a
  // shaped block's own mesh parts. Cached per type; shared, never disposed.
  // A real block id (a server's shared blocks are checked against this).
  knowsBlock(type) {
    return BLOCK_BY_ID.has(type)
  }

  _heldBlockParts(type) {
    if (!this._heldParts) this._heldParts = new Map()
    if (this._heldParts.has(type)) return this._heldParts.get(type)
    const bt = BLOCK_BY_ID.get(type)
    let parts = null
    if (bt?.shape === 'door') {
      // The whole door (both halves of its texture) at 0.8 x 1.6 blocks,
      // centered and turned to face you, so it reads as a door in the
      // hand - the placed bottom half (pushed to its cell's edge) looked
      // like a big plank sticking out sideways (2026-10-04 report).
      const mesh = this._instancedMeshes[type] || this._shapedMesh(type)
      if (mesh) {
        const geometry = new THREE.BoxGeometry(BLOCK_SIZE * 0.8, BLOCK_SIZE * 1.6, DOOR_THICKNESS)
        parts = { geometry, material: mesh.material, turn: -0.55 }
      }
    } else if (bt?.shape) {
      const mesh = this._instancedMeshes[type] || this._shapedMesh(type)
      if (mesh) parts = { geometry: mesh.geometry, material: mesh.material }
    } else if (bt) {
      const faces = blockFaceCanvases(bt)
      // Leaves (and other see-through textures) keep their holes.
      const cut = textureHasAlpha(bt)
      const make = (canvas) => new THREE.MeshLambertMaterial({
        map: _canvasTexture(canvas),
        transparent: !!bt.transparent,
        opacity: bt.opacity ?? 1,
        alphaTest: bt.transparent ? 0.02 : cut ? 0.5 : 0,
        side: cut ? THREE.DoubleSide : THREE.FrontSide,
        emissive: bt.emissive ?? 0x000000,
        emissiveIntensity: bt.emissiveIntensity ?? 0,
      })
      const side = make(faces.side)
      const top = faces.top === faces.side ? side : make(faces.top)
      const bottom = faces.bottom === faces.side ? side : faces.bottom === faces.top ? top : make(faces.bottom)
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
      parts = { geometry: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE), material: [side, side, top, bottom, side, side] }
    }
    this._heldParts.set(type, parts)
    return parts
  }

  _blockColor(type) {
    return BLOCK_BY_ID.get(type)?.color ?? 0xffffff
  }

  _cellIsLadder(x, y, z) {
    return BLOCK_BY_ID.get(this.getBlockAt(x, y, z))?.shape === 'ladder'
  }

  // T, or the pause screen's Try Map button: walk the map as a player
  // holding your gun, then back to flying and building.
  toggleTryMode() {
    if (this.menuOpen) this.toggleMenu()
    if (this.pickerOpen) this.togglePicker()
    this._keys.clear()
    this._velocity.set(0, 0, 0)
    if (this.tryMode.active) {
      if (this.survival.active) this.survival.stop({ leaveTry: false })
      this.tryMode.exit()
      this._renderHotbar()
    } else {
      if (this.lineToolMode) this.toggleLineTool()
      if (this.copyToolMode) this.toggleCopyTool()
      this.tools.off()
      this.tryMode.enter()
      this._tryCrosshairEl.style.display = 'block'
      // The hotbar stays, empty: nothing is built while trying.
      this._renderHotbar()
    }
    this.tools.refreshHint()
    const btnLabel = document.getElementById('build-mode-try-btn-label')
    if (btnLabel) btnLabel.textContent = t(this.tryMode.active ? 'buildModeStopTryBtn' : 'buildModeTryBtn')
  }

  // Invisible Blocks draw nothing, except a faint ghost while the player
  // holds one - otherwise there'd be no way to find them to break them.
  _updateInvisibleGhost() {
    const mat = this._invisibleMaterial
    if (!mat) return
    mat.colorWrite = this.selectedType === 'invisible'
  }

  // Tab picker swatch click - assigns that block to whichever hotbar slot
  // is currently active (see _selectHotbarSlot) and equips it immediately,
  // same as picking an item up in Minecraft's creative inventory drops it
  // straight into your held hand.
  _assignToActiveSlot(id) {
    this._stopPlacingAnimal()
    // A special block says what it does (phones have no hover tooltip).
    const desc = BLOCK_BY_ID.get(id)?.desc
    if (desc) this.game?._showHomepageToast?.(`${BLOCK_BY_ID.get(id).name}: ${desc}`)
    this.hotbar[this.activeHotbarIndex] = id
    this.selectedType = id
    this._updateInvisibleGhost()
    this._renderHotbar()
  }

  // Hotbar slot click or Digit1-9/0 - makes that slot the active one and
  // equips whatever's in it (or nothing, if the slot is still empty).
  _stopPlacingAnimal() {
    if (!this.placingAnimal) return
    this.placingAnimal = null
    this.tools.refreshHint()
  }

  _selectHotbarSlot(index) {
    this._stopPlacingAnimal()
    this.activeHotbarIndex = index
    this.selectedType = this.hotbar[index]
    this._updateInvisibleGhost()
    this._renderHotbar()
  }

  _key(x, y, z) {
    return `${x},${y},${z}`
  }

  get blockCount() {
    return this._blocks.size
  }

  getBlockAt(x, y, z) {
    return this._blocks.at(x, y, z) ?? null
  }

  // skipBoundsUpdate lets a bulk caller (_ensureGroundLayer, the saved-
  // build loader in _applyParsedData) defer the bounding-sphere recompute
  // below until after their whole loop finishes, instead of paying for it
  // on every single block. computeBoundingSphere() scans ALL of a mesh's
  // current instances every time it's called, so calling it once per
  // placement while filling the 128x128 (16,384-cell) ground layer was
  // roughly triangular-number-many instance visits - the real cause of
  // Build Mode taking ~10 real seconds to open. A plain single placeBlock()
  // call (the player clicking to place one block) still updates its bounds
  // immediately, same as before - only bulk fills opt out.

  // The InstancedMesh for a shaped block type, created on first use and
  // grown (doubled, up to MAX_INSTANCES_PER_TYPE) when full. null if the
  // type is unknown or already at the cap.
  _shapedMesh(type) {
    let mesh = this._instancedMeshes[type]
    if (mesh && mesh.count < mesh.instanceMatrix.count) return mesh
    if (mesh && mesh.instanceMatrix.count >= MAX_INSTANCES_PER_TYPE) return null
    const bt = BLOCK_TYPES.find((b) => b.id === type)
    if (!bt || !bt.shape) return null
    let material = mesh?.material
    if (!material && bt.shape === 'invisible') {
      // Draws no color (still casts a shadow - shadows use the shape, not
      // the color) unless you're holding it (_updateInvisibleGhost).
      material = this._invisibleMaterial = new THREE.MeshBasicMaterial({
        color: 0xbfe6ff,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        colorWrite: this.selectedType === 'invisible',
      })
    }
    if (!material) {
      const tex = _shapedBlockTextures(bt)
      for (const t of new Set([tex.top, tex.side, tex.bottom, tex.front].filter(Boolean))) t.anisotropy = this._maxAnisotropy
      // Lambert (like the chunk meshes) - cheaper per pixel than the
      // physically-based Standard material, same look for flat blocks.
      const make = (map) => new THREE.MeshLambertMaterial({
        map,
        transparent: !!bt.transparent,
        opacity: bt.opacity ?? 1,
        alphaTest: bt.transparent ? 0.02 : bt.door || bt.shape === 'cage' ? 0.5 : 0,
        side: bt.shape === 'cage' ? THREE.DoubleSide : THREE.FrontSide,
        emissive: bt.emissive ?? 0x000000,
        emissiveIntensity: bt.emissiveIntensity ?? 0,
      })
      const side = make(tex.side)
      // BoxGeometry face order: +x, -x, +y (top), -y (bottom), +z, -z.
      // A chest's latch (its front) is on -z, which faces you.
      material = (bt.shape === 'slab' || bt.shape === 'pad' || bt.shape === 'chest') && !bt.geo
        ? [side, side, tex.top === tex.side ? side : make(tex.top), tex.bottom === tex.side ? side : make(tex.bottom), side, bt.shape === 'chest' && tex.front !== tex.side ? make(tex.front) : side]
        : side
    }
    const capacity = mesh ? Math.min(mesh.instanceMatrix.count * 2, MAX_INSTANCES_PER_TYPE) : 256
    const geo = CUSTOM_BLOCK_GEOMETRY[bt.geo || bt.shape] || this._blockGeo
    const grown = new THREE.InstancedMesh(geo, material, capacity)
    grown.count = 0
    grown.castShadow = true
    grown.receiveShadow = true
    if (mesh) {
      // Copy the existing instances across, then retire the old mesh
      // (geometry/material are shared, so only the instance buffers go).
      grown.instanceMatrix.array.set(mesh.instanceMatrix.array)
      if (mesh.instanceColor) {
        grown.setColorAt(0, new THREE.Color(1, 1, 1))
        grown.instanceColor.array.set(mesh.instanceColor.array)
      }
      grown.count = mesh.count
      grown.instanceMatrix.needsUpdate = true
      if (grown.instanceColor) grown.instanceColor.needsUpdate = true
      grown.computeBoundingSphere()
      this.scene.remove(mesh)
      mesh.dispose()
    } else {
      this._instanceKeyByIndex[type] = []
    }
    this.scene.add(grown)
    this._instancedMeshes[type] = grown
    return grown
  }

  _chunkKeyOf(x, y, z) {
    return `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`
  }

  // state: a door's { facing, open } (from a save/undo entry) - a new door
  // faces away from the camera.
  // Every placement/removal also tells the liquid flow (LiquidFlow.js), so
  // water and lava react: flow into a gap, get blocked, dry up. A block
  // placed into flowing water replaces it.
  placeBlock(x, y, z, type, skipBoundsUpdate = false, state = null) {
    // A Random Block turns into a random block as you place it.
    if (type === 'randomblock' && !skipBoundsUpdate) type = this.specials.randomType()
    const key = this._key(x, y, z)
    this._mapVersion++
    if (this.liquids?.isFlow(key) && this._blocks.has(key)) {
      this.liquids.levels.delete(key)
      const was = this._suppressUndoRecording
      this._suppressUndoRecording = true
      this._removeBlockInner(x, y, z)
      this._suppressUndoRecording = was
    }
    // A door's top half needs the cell above free of flowing liquid too.
    const aboveKey = this._key(x, y + 1, z)
    if (BLOCK_BY_ID.get(type)?.shape === 'door' && this.liquids?.isFlow(aboveKey)) this.removeBlock(x, y + 1, z)
    const before = this._blocks.get(key)
    this._placeBlockInner(x, y, z, type, skipBoundsUpdate, state)
    this.specials.onPlace(key, x, y, z, this._blocks.get(key))
    if (this._blocks.get(key) !== before) this.world?.touched(x, y, z, key, false)
    if (this.liquids && this._blocks.get(key) !== before && (!skipBoundsUpdate || LIQUID_TYPES.has(type))) this.liquids.changed(x, y, z)
  }

  removeBlock(x, y, z) {
    const key = this._key(x, y, z)
    if (!this._blocks.has(key)) return
    this._mapVersion++
    this.world?.touched(x, y, z, key, true)
    this.liquids?.levels.delete(key)
    this._removeBlockInner(x, y, z)
    this.liquids?.changed(x, y, z)
  }

  // The open world's land (OpenWorld.js): plain chunk blocks put straight
  // in, with no undo, liquid flow, lights or ladder checks - its chunks
  // are rebuilt a few at a time (BlockChunks.markLazy).
  _setTerrainBlock(key, x, y, z, type) {
    this._blocks.setAt(key, x, y, z, type)
    const ck = this._chunkKeyOf(x, y, z)
    let cells = this._chunkCells.get(ck)
    if (!cells) this._chunkCells.set(ck, (cells = new Set()))
    cells.add(key)
  }

  _dropTerrainBlock(key) {
    if (!this._blocks.delete(key)) return
    const [x, y, z] = key.split(',').map(Number)
    const ck = this._chunkKeyOf(x, y, z)
    const cells = this._chunkCells.get(ck)
    if (!cells) return
    cells.delete(key)
    if (cells.size === 0) {
      this._chunkCells.delete(ck)
      this._chunks.dropChunk(ck)
    } else {
      this._chunks.markLazy(ck)
    }
  }

  _placeBlockInner(x, y, z, type, skipBoundsUpdate = false, state = null) {
    const key = this._key(x, y, z)
    if (this._blocks.has(key)) return
    // Any change can move where an Invisible Block's shadow lands.
    if (this._invisibleKeys.size || type === 'invisible') this._invisShadowDirty = true
    if (type === 'invisible') this._invisibleKeys.add(key)
    const shape = BLOCK_BY_ID.get(type)?.shape
    // A door's top half only ever comes with its bottom half (below).
    if (shape === 'doortop' && !this._placingDoorTop) return
    if (shape === 'door') {
      if (this._blocks.has(this._key(x, y + 1, z))) return
      const doorState = {
        facing: Number.isInteger(state?.facing) && state.facing >= 0 && state.facing <= 3 ? state.facing : this._doorFacingFromCamera(),
        open: !!state?.open,
      }
      this._doorState.set(key, doorState)
      this._doorState.set(this._key(x, y + 1, z), doorState)
    }
    if (this._chunks.isChunkType(type)) {
      if (!skipBoundsUpdate && !this._suppressUndoRecording) this._recordUndo({ action: 'place', x, y, z, type })
      this._blocks.setAt(key, x, y, z, type)
      const ck = this._chunkKeyOf(x, y, z)
      let cells = this._chunkCells.get(ck)
      if (!cells) this._chunkCells.set(ck, (cells = new Set()))
      cells.add(key)
      this._chunks.markDirty(x, y, z)
      this._attachBlockLight(key, x, y, z, type)
      if (!skipBoundsUpdate) this._refreshLaddersAround(x, y, z)
      return
    }
    const mesh = this._shapedMesh(type)
    if (!mesh) return
    // Bulk fills (_ensureGroundLayer/_applyParsedData) already pass
    // skipBoundsUpdate=true for every call in the loop - reusing that same
    // signal here means loading/importing a build never floods the undo
    // stack with thousands of individual entries, while every real
    // interactive placement (a plain skipBoundsUpdate=false call) still
    // gets recorded.
    const index = mesh.count
    // x/y/z are integer grid cell indices (unaffected by BLOCK_SIZE - saved
    // builds, _blocks' sparse map keys, and every raycast/collision cell
    // lookup all stay in this same cell-index space); only the WORLD
    // position of that cell's center needs the *BLOCK_SIZE conversion.
    if (FACED_SHAPES.has(shape)) {
      const f = state?.facing
      // Loaded stairs with no facing saved are the old fixed ones (0).
      this._stairFacing.set(key, Number.isInteger(f) && f >= 0 && f <= 3 ? f : skipBoundsUpdate ? 0 : this._stairFacingFromCamera())
      this.gadgets.onPlace(key, x, y, z, type, state)
    }
    // Recorded once the block knows which way it faces, so redo puts it
    // back the same way.
    if (!skipBoundsUpdate && !this._suppressUndoRecording) {
      this._recordUndo({ action: 'place', x, y, z, type, ...(shape === 'door' ? { state: { ...this._doorState.get(key) } } : FACED_SHAPES.has(shape) ? { state: this.gadgets.stateOf(key) } : {}) })
    }
    const matrix = this._doorState.has(key) ? this._doorMatrix(x, y, z, this._doorState.get(key))
      : shape === 'ladder' ? this._ladderMatrix(x, y, z)
        : FACED_SHAPES.has(shape) ? this.gadgets.matrixAt(key, x, y, z, shape, type)
        : new THREE.Matrix4().makeTranslation((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE)
    mesh.setMatrixAt(index, matrix)
    // Slight per-instance brightness variation (±12%) - every block of a
    // type otherwise shares one exact texture, which reads as an obviously
    // tiled/repeated pattern once several sit side by side. This is the
    // same trick real voxel-building games use to break that up cheaply,
    // without needing a second texture variant per block type.
    const tint = 0.88 + Math.random() * 0.24
    mesh.setColorAt(index, new THREE.Color(tint, tint, tint))
    mesh.count++
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // InstancedMesh's frustum-culling bounding sphere isn't recomputed
    // automatically as instances are added/moved - left stale, blocks
    // would flicker in and out of view depending on camera angle,
    // independent of whether they're actually on-screen.
    // A bulk fill still gets its bounds fixed - once, just before the next
    // drawing (_flushBounds). Left stale, a shaped block built far from
    // the mesh's old bounds was culled: a Deathmatch map's stairs showed
    // as the plain blocks under them until something else refreshed them
    // (2026-11-16, Gaymi: "the stairs go in to stairs").
    if (!skipBoundsUpdate) mesh.computeBoundingSphere()
    else this._boundsDirty.add(mesh)
    this._blocks.setAt(key, x, y, z, type)
    this._instanceKeyByIndex[type][index] = key
    // A shaped block doesn't hide its neighbors' faces, but it does change
    // their corner shading lookups - cheap to refresh.
    this._chunks.markDirty(x, y, z)
    this._attachBlockLight(key, x, y, z, type)
    if (shape === 'door') {
      this._placingDoorTop = true
      this.placeBlock(x, y + 1, z, `${type}top`, true)
      this._placingDoorTop = false
      const top = this._instancedMeshes[`${type}top`]
      if (!skipBoundsUpdate) top?.computeBoundingSphere()
      else if (top) this._boundsDirty.add(top)
    }
  }

  // Door facing k puts the closed panel on the cell's edge nearest the
  // camera: 0 = -z, 1 = -x, 2 = +z, 3 = +x (the -z panel turned k*90deg).
  // Stairs climb the way you're looking, like Minecraft: the high step
  // goes on the far side (facing 0 = +z, 1 = +x, 2 = -z, 3 = -x).
  // Shaped meshes a bulk fill (skipBoundsUpdate) added to get their
  // bounds once, before drawing - not once a block.
  _flushBounds() {
    if (!this._boundsDirty.size) return
    for (const mesh of this._boundsDirty) mesh.computeBoundingSphere()
    this._boundsDirty.clear()
  }

  _stairFacingFromCamera() {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    if (Math.abs(dir.x) > Math.abs(dir.z)) return dir.x > 0 ? 1 : 3
    return dir.z > 0 ? 0 : 2
  }

  // 2-wide blocks (a Train Track, `twoWide`): the cell paired with
  // (x, y, z) for facing f. Pairs are fixed by the grid - across the
  // track, an even cell and the odd one after it - so a pair is always
  // found again from the cells alone (saves, servers, undo keep only
  // type and facing). Facing 0/2 runs along z (pairs across x), 1/3
  // along x (pairs across z).
  twoWideCell(x, y, z, f) {
    return f % 2 === 0 ? [x ^ 1, y, z] : [x, y, z ^ 1]
  }

  // The other half of the 2-wide block at (x, y, z), or null: the same
  // type in its pair cell, laid the same way along.
  twoWideMate(x, y, z) {
    const type = this._blocks.get(this._key(x, y, z))
    if (!BLOCK_BY_ID.get(type)?.twoWide) return null
    const f = this._stairFacing.get(this._key(x, y, z)) || 0
    const [mx, my, mz] = this.twoWideCell(x, y, z, f)
    const mk = this._key(mx, my, mz)
    if (this._blocks.get(mk) !== type || (this._stairFacing.get(mk) || 0) % 2 !== f % 2) return null
    return [mx, my, mz]
  }

  // Puts a 2-wide block's second half beside the one just placed at
  // (x, y, z), facing the same way, if that cell is free.
  _placeTwoWideMate(x, y, z, type) {
    if (!BLOCK_BY_ID.get(type)?.twoWide || this._blocks.get(this._key(x, y, z)) !== type) return
    const f = this._stairFacing.get(this._key(x, y, z)) || 0
    const [mx, my, mz] = this.twoWideCell(x, y, z, f)
    if (this._blocks.has(this._key(mx, my, mz)) || this._wouldOverlapCamera(mx, my, mz)) return
    this.placeBlock(mx, my, mz, type, false, { facing: f })
  }

  _doorFacingFromCamera() {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    // The edge nearest the camera is opposite to where it looks.
    if (Math.abs(dir.x) > Math.abs(dir.z)) return dir.x > 0 ? 1 : 3
    return dir.z > 0 ? 0 : 2
  }

  // An open door swings a quarter turn, onto the neighboring edge.
  _doorMatrix(x, y, z, state) {
    const turn = ((state.facing + (state.open ? 1 : 0)) % 4) * (Math.PI / 2)
    const m = new THREE.Matrix4().makeRotationY(turn)
    m.setPosition((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE)
    return m
  }

  // A ladder hangs flat against the solid block beside it (Minecraft-
  // style), not in the middle of its cell - which read as a pole standing
  // in the room (2026-10-02 report). No wall at all: it stays centered.
  _ladderMatrix(x, y, z) {
    const m = new THREE.Matrix4()
    const side = LADDER_SIDES.find(([ox, oz]) => {
      const type = this.getBlockAt(x + ox, y, z + oz)
      return type && BLOCK_BY_ID.get(type)?.shape !== 'ladder' && this._cellSolidTop(x + ox, y, z + oz) === 1
    })
    if (side && side[0]) m.makeRotationY(Math.PI / 2)
    const shift = (0.5 - LADDER_INSET) * BLOCK_SIZE
    m.setPosition((x + 0.5 + (side ? side[0] : 0) * (shift / BLOCK_SIZE)) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5 + (side ? side[1] : 0) * (shift / BLOCK_SIZE)) * BLOCK_SIZE)
    return m
  }

  _refreshLadderAt(x, y, z) {
    const key = this._key(x, y, z)
    const mesh = this._instancedMeshes.ladder
    if (!mesh || this._blocks.get(key) !== 'ladder') return
    const index = this._instanceKeyByIndex.ladder.indexOf(key)
    if (index < 0) return
    mesh.setMatrixAt(index, this._ladderMatrix(x, y, z))
    mesh.instanceMatrix.needsUpdate = true
  }

  _refreshAllLadders() {
    const mesh = this._instancedMeshes.ladder
    const keys = this._instanceKeyByIndex.ladder
    if (!mesh || !keys) return
    keys.forEach((key, index) => {
      const [x, y, z] = key.split(',').map(Number)
      mesh.setMatrixAt(index, this._ladderMatrix(x, y, z))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }

  // A block placed or broken next to a ladder can change which wall it
  // hangs on.
  _refreshLaddersAround(x, y, z) {
    if (!this._instancedMeshes.ladder) return
    for (const [ox, oz] of LADDER_SIDES) this._refreshLadderAt(x + ox, y, z + oz)
  }

  // Opens/closes the door at (x, y, z) - either half.
  toggleDoor(x, y, z) {
    const type = this.getBlockAt(x, y, z)
    if (!_isDoorType(type)) return false
    const bottomY = BLOCK_BY_ID.get(type).shape === 'doortop' ? y - 1 : y
    const state = this._doorState.get(this._key(x, bottomY, z))
    if (!state) return false
    state.open = !state.open
    for (const cy of [bottomY, bottomY + 1]) {
      const key = this._key(x, cy, z)
      const cellType = this._blocks.get(key)
      const mesh = cellType && this._instancedMeshes[cellType]
      const index = mesh ? this._instanceKeyByIndex[cellType].indexOf(key) : -1
      if (index < 0) continue
      mesh.setMatrixAt(index, this._doorMatrix(x, cy, z, state))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    this._shadowsDirty = true
    this._scheduleAutosave()
    this.together?.record(['d', x, bottomY, z, state.open])
    return true
  }

  isDoorOpenAt(x, y, z) {
    return !!this._doorState.get(this._key(x, y, z))?.open
  }

  _attachBlockLight(key, x, y, z, type) {
    const lightColor = LIGHT_BLOCK_COLORS.get(type)
    if (lightColor !== undefined) this._chunks.setGlow(x, y, z, lightColor)
  }

  _removeBlockInner(x, y, z) {
    const key = this._key(x, y, z)
    const type = this._blocks.get(key)
    if (!type) return
    if (this._invisibleKeys.size) this._invisShadowDirty = true
    this._invisibleKeys.delete(key)
    const shape = BLOCK_BY_ID.get(type)?.shape
    // Breaking either half of a door breaks the whole door (recorded as
    // the bottom half, which brings its top back on undo).
    if (shape === 'doortop' && !this._removingDoorTop && this._blocks.get(this._key(x, y - 1, z)) === BLOCK_BY_ID.get(type).doorBottom) {
      this.removeBlock(x, y - 1, z)
      return
    }
    if (!this._suppressUndoRecording && !this._removingDoorTop) {
      this._recordUndo({ action: 'remove', x, y, z, type, ...(shape === 'door' && this._doorState.has(key) ? { state: { ...this._doorState.get(key) } } : FACED_SHAPES.has(shape) && this._stairFacing.has(key) ? { state: this.gadgets.stateOf(key) } : {}) })
    }
    if (shape === 'door' || shape === 'doortop') this._doorState.delete(key)
    this._stairFacing.delete(key)
    this.gadgets.onRemove(key)
    this.specials.onRemove(key)
    if (shape === 'door' && this._blocks.get(this._key(x, y + 1, z)) === `${type}top`) {
      this._removingDoorTop = true
      this.removeBlock(x, y + 1, z)
      this._removingDoorTop = false
    }
    if (this._chunks.isChunkType(type)) {
      this._blocks.delete(key)
      this._chunkCells.get(this._chunkKeyOf(x, y, z))?.delete(key)
      this._chunks.markDirty(x, y, z)
      this._releaseBlockLight(key)
      this._refreshLaddersAround(x, y, z)
      return
    }
    const mesh = this._instancedMeshes[type]
    const keys = this._instanceKeyByIndex[type]
    const removedIndex = keys.indexOf(key)
    const lastIndex = mesh.count - 1
    if (removedIndex !== lastIndex) {
      // Swap-remove: move the last instance's transform (and its per-
      // instance tint color, see placeBlock) into the removed slot, then
      // shrink count - InstancedMesh has no native "delete at index",
      // this is the standard technique.
      const lastMatrix = new THREE.Matrix4()
      mesh.getMatrixAt(lastIndex, lastMatrix)
      mesh.setMatrixAt(removedIndex, lastMatrix)
      if (mesh.instanceColor) {
        const lastColor = new THREE.Color()
        mesh.getColorAt(lastIndex, lastColor)
        mesh.setColorAt(removedIndex, lastColor)
      }
      keys[removedIndex] = keys[lastIndex]
    }
    keys.pop()
    mesh.count--
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    this._blocks.delete(key)
    this._chunks.markDirty(x, y, z)
    this._releaseBlockLight(key)
  }

  _releaseBlockLight(key) {
    const [x, y, z] = key.split(',').map(Number)
    this._chunks.setGlow(x, y, z, null)
  }

  // Undo/Redo - see the constructor's own comment on _undoStack/_redoStack
  // and the recording lines inside placeBlock()/removeBlock() above.
  _recordUndo(entry) {
    // Building together: every real cell change goes to the room too
    // (a finished group's cells were already sent one by one).
    if (entry.action !== 'group') this.together?.recordEntry(entry, true)
    // Inside a multi-block tool action (fill, shapes, paste, line...),
    // every cell change joins one entry, so one Undo takes back the lot.
    if (this._undoGroup) {
      this._undoGroup.push(entry)
      return
    }
    this._undoStack.push(entry)
    if (this._undoStack.length > UNDO_STACK_LIMIT) this._undoStack.shift()
    // A fresh action invalidates whatever was previously undone - same
    // standard undo/redo semantics as any text editor.
    this._redoStack.length = 0
    this._updateUndoRedoButtons()
    this._scheduleAutosave()
  }

  _scheduleAutosave() {
    clearTimeout(this._autosaveTimer)
    this._autosaveTimer = setTimeout(() => {
      this._autosaveTimer = null
      if (this.active) this.save()
    }, AUTOSAVE_DELAY_MS)
  }

  // Runs fn() with every cell change it makes recorded as one undo entry.
  _undoGroupDo(fn) {
    const outer = this._undoGroup
    const group = outer || []
    this._undoGroup = group
    let result
    try {
      result = fn()
    } finally {
      this._undoGroup = outer
    }
    if (!outer && group.length) this._recordUndo(group.length === 1 ? group[0] : { action: 'group', entries: group })
    return result
  }

  // Applies (forward) or takes back (!forward) one undo entry.
  _applyUndoEntry(entry, forward) {
    if (entry.action === 'group') {
      const list = forward ? entry.entries : [...entry.entries].reverse()
      for (const e of list) this._applyUndoEntry(e, forward)
      return
    }
    if ((entry.action === 'place') === forward) this.placeBlock(entry.x, entry.y, entry.z, entry.type, false, entry.state)
    else this.removeBlock(entry.x, entry.y, entry.z)
  }

  undo() {
    const entry = this._undoStack.pop()
    if (!entry) return
    this._suppressUndoRecording = true
    this._applyUndoEntry(entry, false)
    this._suppressUndoRecording = false
    this.together?.recordEntry(entry, false)
    this._redoStack.push(entry)
    this._updateUndoRedoButtons()
    this._scheduleAutosave()
  }

  redo() {
    const entry = this._redoStack.pop()
    if (!entry) return
    this._suppressUndoRecording = true
    this._applyUndoEntry(entry, true)
    this._suppressUndoRecording = false
    this.together?.recordEntry(entry, true)
    this._undoStack.push(entry)
    this._updateUndoRedoButtons()
    this._scheduleAutosave()
  }

  _updateUndoRedoButtons() {
    if (this._undoBtnEl) this._undoBtnEl.disabled = this._undoStack.length === 0
    if (this._redoBtnEl) this._redoBtnEl.disabled = this._redoStack.length === 0
  }

  _placeFromCamera() {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (!hit) return
    if (this.placingAnimal) {
      this._placeAnimal(hit)
      return
    }
    // Right-clicking a door opens/closes it instead of placing against it
    // (a lever flips, a sign asks for new words).
    if (this.toggleDoor(...hit.existingBlock)) return
    if (this.gadgets.use(...hit.existingBlock, false)) return
    const [px, py, pz] = hit.placeAt
    if (this._wouldOverlapCamera(px, py, pz)) return
    if (BLOCK_BY_ID.get(this.selectedType)?.shape === 'door' && this._wouldOverlapCamera(px, py + 1, pz)) return
    // A new sign asks what to write on it first (Cancel places nothing).
    let state = null
    if (this.selectedType === 'sign') {
      const text = window.prompt(t('buildSignPrompt'), '')
      if (text === null) return
      state = { facing: this._stairFacingFromCamera(), text }
    }
    // A 2-wide block needs its pair cell free too.
    if (BLOCK_BY_ID.get(this.selectedType)?.twoWide) {
      const [mx, my, mz] = this.twoWideCell(px, py, pz, this._stairFacingFromCamera())
      if (this._blocks.has(this._key(mx, my, mz)) || this._wouldOverlapCamera(mx, my, mz)) return
    }
    this._undoGroupDo(() => {
      this.placeBlock(px, py, pz, this.selectedType, false, state)
      this._placeTwoWideMate(px, py, pz, this.selectedType)
      if (this.mirrorMode) {
        this.placeBlock(this._mirrorX(px), py, pz, this.selectedType, false, state)
        this._placeTwoWideMate(this._mirrorX(px), py, pz, this.selectedType)
      }
    })
    this.tryMode.swingHand()
  }

  // Same 8-corner COLLISION_RADIUS-sphere technique _blockedAt uses for
  // movement collision below, just checking the camera's OWN current
  // position against the cell about to be placed into instead of an
  // existing block - without this, placing a block right where you're
  // standing (e.g. aiming down/behind yourself in a tight space) left you
  // visibly clipped/stuck inside it afterward.
  // Also checks the exact center position, not just the 8 corners - if
  // COLLISION_RADIUS happens to equal (or exceed) BLOCK_SIZE, a camera
  // sitting exactly on a cell boundary (e.g. the default spawn at x=0) has
  // its corner offsets land a full cell over on either side, jumping clean
  // over its own actual cell and missing it entirely. Caught via the
  // default spawn position itself in testing, not a contrived case.
  _wouldOverlapCamera(x, y, z) {
    const pos = this.camera.position
    if (Math.floor(pos.x / BLOCK_SIZE) === x && Math.floor(pos.y / BLOCK_SIZE) === y && Math.floor(pos.z / BLOCK_SIZE) === z) return true
    const r = COLLISION_RADIUS
    for (const ox of [-r, r]) {
      for (const oy of [-r, r]) {
        for (const oz of [-r, r]) {
          if (Math.floor((pos.x + ox) / BLOCK_SIZE) === x && Math.floor((pos.y + oy) / BLOCK_SIZE) === y && Math.floor((pos.z + oz) / BLOCK_SIZE) === z) return true
        }
      }
    }
    return false
  }

  _removeFromCamera() {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (this._removeAimedAnimal(hit)) return
    if (!hit || !hit.existingBlock) return
    const [rx, ry, rz] = hit.existingBlock
    // Both halves of a 2-wide block go together.
    const gone = (x, y, z) => {
      const mate = this.twoWideMate(x, y, z)
      this.removeBlock(x, y, z)
      if (mate) this.removeBlock(...mate)
    }
    this._undoGroupDo(() => {
      gone(rx, ry, rz)
      if (this.mirrorMode) gone(this._mirrorX(rx), ry, rz)
    })
    this.tryMode.swingHand()
  }

  // Steps a ray forward in fixed small increments and checks the sparse
  // block map at each grid cell - simpler and more robust for a uniform
  // grid than THREE's mesh-based raycasting against InstancedMesh (which
  // needs per-instance bounding data this project doesn't otherwise need).
  // No special ground-plane case anymore - the ground is just blocks now
  // (see _ensureGroundLayer), so a real one at y=-1 hits this same
  // getBlockAt check like everything else, and is breakable/removable the
  // same way; aiming through a dug-out hole just keeps stepping until it
  // finds something else or runs out of maxDist.
  // skip: block types the ray goes straight through (bullets through a
  // Murder Hole, SHOOT_THROUGH).
  _raycastGridAligned(skip = null) {
    const origin = this._raycaster.ray.origin
    const dir = this._raycaster.ray.direction
    const maxDist = 40
    const step = 0.1
    let prevCell = null
    for (let t = 0; t < maxDist; t += step) {
      const px = origin.x + dir.x * t
      const py = origin.y + dir.y * t
      const pz = origin.z + dir.z * t
      // World position -> cell index (see placeBlock's own comment on the
      // same conversion the other direction).
      const cell = [Math.floor(px / BLOCK_SIZE), Math.floor(py / BLOCK_SIZE), Math.floor(pz / BLOCK_SIZE)]
      // Flowing water/lava can't be aimed at - you build straight through it.
      const type = this.getBlockAt(cell[0], cell[1], cell[2])
      if (type && !skip?.has(type) && !this.liquids.isFlow(this._key(cell[0], cell[1], cell[2]))) {
        return { placeAt: prevCell || cell, existingBlock: cell, t }
      }
      prevCell = cell
    }
    return null
  }

  // Click a block here to put it in the currently active hotbar slot (see
  // _assignToActiveSlot) - this is the "inventory" you assign the hotbar
  // from, it doesn't select blocks directly itself. Called on every open -
  // resets the search box back to empty each time, same "fresh state per
  // open" the search input's own event listener doesn't otherwise reset.
  _renderPicker() {
    if (this._pickerSearchInput) this._pickerSearchInput.value = ''
    this._renderPickerGrid()
    this._renderPickerSide()
  }

  // Map Editor Tab panel, half and half (2026-10-18, Gaymi's picture): the
  // blocks on the left, and on the right your hotbar plus a 10 x 10 block
  // storage (remembered on this device, EDITOR_STORE_KEY). Drag a block
  // from the left onto a hotbar or storage slot, drag between slots to
  // move/swap, click a hotbar slot to make it the active one, click a
  // stored block to put it in the active hotbar slot.
  // Exactly half and half, no hotbar row (the one at the bottom of the
  // screen is enough) and bigger storage slots (2026-10-30, Gaymi: "make
  // the blocks you can pick and your inventory 50/50 ... remove the hotbar
  // in inventory not needed ... make the inventory 10x10 slightly bigger").
  _renderPickerSide() {
    const picker = this._pickerEl
    if (!picker) return
    if (!this._pickerSideEl) {
      const left = document.createElement('div')
      left.className = 'build-picker-left'
      while (picker.firstChild) left.appendChild(picker.firstChild)
      const right = document.createElement('div')
      right.className = 'build-picker-right'
      picker.append(left, right)
      picker.classList.add('split')
      this._pickerSideEl = right
      try {
        const saved = JSON.parse(localStorage.getItem(EDITOR_STORE_KEY) || '[]')
        this._editorStore = Array.from({ length: EDITOR_STORE_SIZE }, (_, i) => (BLOCK_BY_ID.has(saved[i]) ? saved[i] : null))
      } catch {
        this._editorStore = new Array(EDITOR_STORE_SIZE).fill(null)
      }
      this._bindPickerDrag()
    }
    const slot = (id, where, i, active) => {
      const bt = id && BLOCK_BY_ID.get(id)
      const icon = bt ? ` style="background-image:url(${_blockIcon(bt)})"` : ''
      const title = bt ? ` title="${bt.name.replace(/"/g, '&quot;')}"` : ''
      return `<div class="bp-slot${active ? ' active' : ''}" data-where="${where}" data-i="${i}"${icon}${title}></div>`
    }
    this._pickerSideEl.innerHTML = `<div class="bp-title">${t('editorPickerStorage')}</div>
      <div class="bp-store">${this._editorStore.map((id, i) => slot(id, 'store', i, false)).join('')}</div>`
  }

  _saveEditorStore() {
    try {
      localStorage.setItem(EDITOR_STORE_KEY, JSON.stringify(this._editorStore))
    } catch {
      // Storage full - it just won't be remembered.
    }
  }

  // Drag from the block grid (or a right-side slot) onto a right-side slot.
  _bindPickerDrag() {
    const picker = this._pickerEl
    let drag = null
    const listOf = (where) => (where === 'hotbar' ? this.hotbar : this._editorStore)
    picker.addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.build-picker-item')
      const slot = e.target.closest('.bp-slot')
      let id = null
      if (item) id = item.dataset.blockId
      else if (slot) id = listOf(slot.dataset.where)[Number(slot.dataset.i)]
      if (!id) {
        if (slot?.dataset.where === 'hotbar') {
          this._selectHotbarSlot(Number(slot.dataset.i))
          this._renderPickerSide()
        }
        return
      }
      drag = { id, from: slot ? { where: slot.dataset.where, i: Number(slot.dataset.i) } : null, x: e.clientX, y: e.clientY, moved: false, ghost: null, item }
    })
    window.addEventListener('pointermove', (e) => {
      if (!drag) return
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return
      if (!drag.moved) {
        drag.moved = true
        drag.ghost = document.createElement('div')
        drag.ghost.className = 'inv-ghost'
        drag.ghost.innerHTML = `<img src="${_blockIcon(BLOCK_BY_ID.get(drag.id))}" alt="">`
        document.body.appendChild(drag.ghost)
      }
      drag.ghost.style.left = `${e.clientX}px`
      drag.ghost.style.top = `${e.clientY}px`
    })
    window.addEventListener('pointerup', (e) => {
      const d = drag
      drag = null
      if (!d) return
      d.ghost?.remove()
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#build-picker .bp-slot')
      if (!d.moved) {
        // A click: a block on the left equips it (as before); a stored
        // block goes into the active hotbar slot; a hotbar slot is picked.
        if (d.item) {
          // (The block's own click listener equips it.)
        } else if (d.from?.where === 'store') {
          this._assignToActiveSlot(d.id)
          this._renderPickerSide()
        } else if (d.from?.where === 'hotbar') {
          this._selectHotbarSlot(d.from.i)
          this._renderPickerSide()
        }
        return
      }
      if (!target) return
      const to = listOf(target.dataset.where)
      const ti = Number(target.dataset.i)
      if (d.from) {
        const from = listOf(d.from.where)
        ;[from[d.from.i], to[ti]] = [to[ti], from[d.from.i]]
      } else to[ti] = d.id
      this.selectedType = this.hotbar[this.activeHotbarIndex]
      this._updateInvisibleGhost()
      this._saveEditorStore()
      this._renderHotbar()
      this._renderPickerSide()
    })
  }

  // Just the swatch grid, filtered by the search box's current value -
  // split out from _renderPicker so typing doesn't rebuild (and lose focus
  // on) the search input itself, only the grid below it.
  _renderPickerGrid() {
    if (!this._pickerGridEl) return
    this._pickerGridEl.innerHTML = ''
    const query = (this._pickerSearchInput?.value || '').trim().toLowerCase()
    const category = this._pickerCategorySelect?.value || 'all'
    if (category === 'animals') {
      this._renderAnimalGrid(query)
      return
    }
    const matches = PICKER_TYPES_SORTED.filter((bt) => (category === 'all' || _blockCategory(bt) === category) && (!query || bt.name.toLowerCase().includes(query)))
    for (const { id, name, desc } of matches) {
      const item = document.createElement('div')
      item.className = 'build-picker-item'
      // Special blocks say what they do.
      item.title = desc ? `${name} - ${desc}` : name
      const swatch = document.createElement('div')
      swatch.className = 'build-picker-swatch' + (id === this.selectedType ? ' selected' : '')
      // Minecraft-inventory-style 3D block icon (BlockTextures.js), with
      // the flat color underneath while it loads.
      swatch.style.backgroundColor = 'transparent'
      swatch.style.backgroundImage = `url(${_blockIcon(BLOCK_TYPES.find((b) => b.id === id))})`
      const label = document.createElement('span')
      label.className = 'build-picker-label'
      label.textContent = name
      item.appendChild(swatch)
      item.appendChild(label)
      // Clicking equips it; dragging it onto a right-hand slot puts it
      // there instead (_bindPickerDrag).
      item.dataset.blockId = id
      item.addEventListener('click', () => {
        this._assignToActiveSlot(id)
        this.togglePicker()
      })
      this._pickerGridEl.appendChild(item)
    }
    if (matches.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'build-picker-empty'
      empty.textContent = 'No blocks match.'
      this._pickerGridEl.appendChild(empty)
    }
  }

  // The picker's Animals list: click one, then right-click in the world to
  // put it down (it walks about there, in the editor and in Play).
  _renderAnimalGrid(query) {
    const matches = ANIMAL_IDS.map((id) => ({ id, name: t(animalNameKey(id)) }))
      .filter((a) => !query || a.name.toLowerCase().includes(query))
    for (const { id, name } of matches) {
      const item = document.createElement('div')
      item.className = 'build-picker-item build-picker-animal'
      item.title = name
      const swatch = document.createElement('div')
      swatch.className = 'build-picker-swatch' + (id === this.placingAnimal ? ' selected' : '')
      swatch.style.backgroundColor = 'transparent'
      swatch.style.backgroundImage = `url(${animalIconURL(id)})`
      const label = document.createElement('span')
      label.className = 'build-picker-label'
      label.textContent = name
      item.append(swatch, label)
      item.dataset.animalId = id
      item.addEventListener('click', () => {
        this.placingAnimal = id
        this.tools.refreshHint()
        this.togglePicker()
      })
      this._pickerGridEl.appendChild(item)
    }
    if (!matches.length) {
      const empty = document.createElement('p')
      empty.className = 'build-picker-empty'
      empty.textContent = t('editorNoAnimals')
      this._pickerGridEl.appendChild(empty)
    }
  }

  // The animals stepping about (BuildSurvival owns them while playing).
  _animals() {
    return this.survival.animals || (this.survival.animals = new PlayAnimals(this.survival))
  }

  // Map Editor animals: { kind, x, y, z } each, saved with the map. From a
  // save, a share code or a file, so checked like any untrusted data.
  _setAnimalSpots(list) {
    const ok = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6
    this.animalSpots = (Array.isArray(list) ? list : [])
      .filter((s) => s && ANIMAL_IDS.includes(s.kind) && ok(s.x) && ok(s.y) && ok(s.z))
      .slice(0, MAX_PLACED)
      .map((s) => ({ kind: s.kind, x: s.x, y: s.y, z: s.z }))
    this._animals().clear()
  }

  // Right-click with an animal picked: it's put down on the block aimed at.
  _placeAnimal(hit) {
    if ((this.animalSpots || []).length >= MAX_PLACED) return
    const [px, py, pz] = hit.placeAt
    const round = (n) => Math.round(n * 100) / 100
    const put = (x) => {
      const spot = { kind: this.placingAnimal, x: round(x + 0.5), y: py, z: round(pz + 0.5) }
      this.animalSpots.push(spot)
      this._animals().placeAt(spot)
    }
    if (!this.animalSpots) this.animalSpots = []
    put(px)
    if (this.mirrorMode) put(this._mirrorX(px))
    this._scheduleAutosave()
    this.tryMode.swingHand()
  }

  // Left-click on a placed animal (nearer than any block): it goes.
  _removeAimedAnimal(hit) {
    const aim = this._animals().aimed(40 / BLOCK_SIZE)
    if (!aim || !aim.animal.placed) return false
    if (hit?.existingBlock) {
      const [x, y, z] = hit.existingBlock
      const blockDist = this.camera.position.distanceTo(new THREE.Vector3((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE))
      if (blockDist < aim.dist) return false
    }
    const i = this.animalSpots.indexOf(aim.animal.spot)
    if (i >= 0) this.animalSpots.splice(i, 1)
    this._animals().remove(aim.animal)
    this._scheduleAutosave()
    this.tryMode.swingHand()
    return true
  }

  // 10 slots, empty until assigned from the picker above - see
  // DIGIT_KEY_TO_HOTBAR_INDEX for the matching Digit1-9/0 key handling.
  _renderHotbar() {
    if (!this._hotbarEl) return
    // A game shows the inventory's hotbar.
    if (this.survival?.active && this.survival.inv) {
      this.survival.inv.renderHotbar()
      return
    }
    this._hotbarEl.innerHTML = ''
    // Try Map shows the same hotbar with nothing in it.
    const empty = this.tryMode.active
    this.hotbar.forEach((id, i) => {
      const bt = id && !empty ? BLOCK_TYPES.find((b) => b.id === id) : null
      const slot = document.createElement('div')
      slot.className = 'build-hotbar-slot' + (i === this.activeHotbarIndex ? ' selected' : '')
      slot.title = bt ? bt.name : ''
      if (bt) slot.style.backgroundImage = `url(${_blockIcon(bt)})`
      const num = document.createElement('span')
      num.className = 'build-hotbar-slot-num'
      num.textContent = i === 9 ? '0' : String(i + 1)
      slot.appendChild(num)
      slot.addEventListener('click', () => this._selectHotbarSlot(i))
      this._hotbarEl.appendChild(slot)
    })
  }

  // Small "1 / 2 / 3" row - the active slot is highlighted, a slot with
  // something saved in it gets a filled dot so it's clear at a glance
  // which slots actually have a build before clicking into one.
  _renderSlots() {
    if (!this._slotsEl) return
    this._slotsEl.innerHTML = ''
    for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
      const has = this._slotExists(i)
      const btn = document.createElement('button')
      btn.className = 'build-slot-btn' + (i === this.activeSlot ? ' active' : '')
      btn.title = has ? `Slot ${i + 1} (has a build)` : `Slot ${i + 1} (empty)`
      const num = document.createElement('span')
      num.className = 'build-slot-num'
      num.textContent = String(i + 1)
      btn.appendChild(num)
      const thumb = has && this._slotThumb(i)
      if (thumb) {
        btn.classList.add('has-thumb')
        btn.style.backgroundImage = `url(${thumb})`
      }
      if (has) {
        const dot = document.createElement('span')
        dot.className = 'build-slot-dot'
        btn.appendChild(dot)
      }
      btn.addEventListener('click', () => {
        this.switchSlot(i)
        this._renderSlots()
      })
      this._slotsEl.appendChild(btn)
    }
    const map3Btn = document.createElement('button')
    map3Btn.className = 'build-slot-btn build-slot-map3' + (this.activeSlot === MAP3_SLOT ? ' active' : '')
    map3Btn.title = t('buildMap3SlotTitle')
    map3Btn.textContent = t('buildMap3Slot')
    const map3Thumb = this._slotThumb(MAP3_SLOT)
    if (map3Thumb) {
      map3Btn.classList.add('has-thumb')
      map3Btn.style.backgroundImage = `url(${map3Thumb})`
    }
    map3Btn.addEventListener('click', () => {
      this.switchSlot(MAP3_SLOT)
      this._renderSlots()
    })
    this._slotsEl.appendChild(map3Btn)
    if (this.menuOpen) {
      this._refreshMenuInfo()
      // A switched-to map's blocks are meshed on the next frame.
      requestAnimationFrame(() => this._captureMenuPreview())
    }
  }

  // N key or toolbar button - see mirrorMode's own comment for why x=0.
  // Was M until 2026-10-24: M opens the map everywhere else, so pressing it
  // out of habit turned on a see-through wall nobody recognised. A toast
  // now says what happened either way.
  toggleMirror() {
    this.mirrorMode = !this.mirrorMode
    if (this._mirrorPlaneMesh) this._mirrorPlaneMesh.visible = this.mirrorMode
    if (this._mirrorBtnEl) this._mirrorBtnEl.classList.toggle('active', this.mirrorMode)
    this.game?._showHomepageToast?.(t(this.mirrorMode ? 'buildMirrorOnToast' : 'buildMirrorOffToast'))
  }

  // World x cell index -> its mirrored cell index across x=0. A cell at
  // index x spans world space [x*BLOCK_SIZE, (x+1)*BLOCK_SIZE) - reflecting
  // that span across 0 gives [(-x-1)*BLOCK_SIZE, -x*BLOCK_SIZE), i.e. cell
  // index -x-1. Never equal to x for an integer x, so mirroring never
  // collides with the original cell.
  _mirrorX(x) {
    return -x - 1
  }

  // L key or toolbar button. Clears any pending start point on toggle
  // (both on and off) - a half-finished line from before a toggle-off/on
  // cycle would otherwise silently resume, confusing the very next click.
  toggleLineTool() {
    this.lineToolMode = !this.lineToolMode
    this._lineStart = null
    if (this._lineMarkerMesh) this._lineMarkerMesh.visible = false
    if (this._lineToolBtnEl) this._lineToolBtnEl.classList.toggle('active', this.lineToolMode)
    // Mutually exclusive with copy tool (see its own comment) - turning
    // line tool on while copy tool was active would otherwise leave two
    // different two-click flows both listening to the same right-click.
    if (this.lineToolMode && this.copyToolMode) this.toggleCopyTool()
    if (this.lineToolMode) this.tools?.off()
    this.tools?.refreshHint()
  }

  // First right-click while lineToolMode is on sets the start point;
  // the second fills every cell on the straight line between start and
  // end (inclusive) with the selected block.
  _lineToolClick() {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (!hit) return
    const [x, y, z] = hit.placeAt
    if (this._wouldOverlapCamera(x, y, z)) return
    if (!this._lineStart) {
      this._lineStart = [x, y, z]
      if (this._lineMarkerMesh) {
        this._lineMarkerMesh.position.set((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE)
        this._lineMarkerMesh.visible = true
      }
      this.tools.refreshHint()
      return
    }
    const [sx, sy, sz] = this._lineStart
    this._undoGroupDo(() => {
      for (const [cx, cy, cz] of this._lineCells(sx, sy, sz, x, y, z)) {
        this.placeBlock(cx, cy, cz, this.selectedType)
        if (this.mirrorMode) this.placeBlock(this._mirrorX(cx), cy, cz, this.selectedType)
      }
    })
    this._lineStart = null
    if (this._lineMarkerMesh) this._lineMarkerMesh.visible = false
    this.tools.refreshHint()
  }

  // Every integer cell from (x0,y0,z0) to (x1,y1,z1) inclusive, stepped
  // along the longest axis and rounded to the nearest cell each step - not
  // a true Bresenham line, but a simple, well-understood approach that
  // produces a visually contiguous line, which is all a building tool
  // needs. De-duplicated (see `seen`) since two different steps can round
  // to the same cell on a shallow line.
  _lineCells(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0
    const dy = y1 - y0
    const dz = z1 - z0
    const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1)
    const seen = new Set()
    const cells = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const cx = Math.round(x0 + dx * t)
      const cy = Math.round(y0 + dy * t)
      const cz = Math.round(z0 + dz * t)
      const key = this._key(cx, cy, cz)
      if (seen.has(key)) continue
      seen.add(key)
      cells.push([cx, cy, cz])
    }
    return cells
  }

  // C key or toolbar button. Clears any pending first corner on toggle,
  // same reasoning as toggleLineTool.
  toggleCopyTool() {
    this.copyToolMode = !this.copyToolMode
    this._copyStart = null
    if (this._lineMarkerMesh) this._lineMarkerMesh.visible = false
    if (this._copyToolBtnEl) this._copyToolBtnEl.classList.toggle('active', this.copyToolMode)
    if (this.copyToolMode && this.lineToolMode) this.toggleLineTool()
    if (this.copyToolMode) this.tools?.off()
    this.tools?.refreshHint()
  }

  // First right-click while copyToolMode is on marks one corner; the
  // second marks the opposite corner and copies every placed block inside
  // that axis-aligned box into this._clipboard, as offsets from the box's
  // minimum corner (so pasteClipboard can re-anchor it anywhere).
  _copyToolClick() {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    // Copying reads existing blocks, so this targets whatever cell was
    // actually hit (existingBlock), not the adjacent empty one placeAt
    // would give - the corner you aim at should be a real block, not the
    // air next to it.
    if (!hit || !hit.existingBlock) return
    const [x, y, z] = hit.existingBlock
    if (!this._copyStart) {
      this._copyStart = [x, y, z]
      if (this._lineMarkerMesh) {
        this._lineMarkerMesh.position.set((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE)
        this._lineMarkerMesh.visible = true
      }
      this.tools.refreshHint()
      return
    }
    const [sx, sy, sz] = this._copyStart
    const minX = Math.min(sx, x), maxX = Math.max(sx, x)
    const minY = Math.min(sy, y), maxY = Math.max(sy, y)
    const minZ = Math.min(sz, z), maxZ = Math.max(sz, z)
    const blocks = []
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const type = this.getBlockAt(cx, cy, cz)
          if (!type || this.liquids.isFlow(this._key(cx, cy, cz))) continue
          const key = this._key(cx, cy, cz)
          // Stairs and doors keep which way they face (and Q turns it).
          const state = this._stairFacing.has(key) ? this.gadgets.stateOf(key) : this._doorState.has(key) ? { ...this._doorState.get(key) } : undefined
          blocks.push({ dx: cx - minX, dy: cy - minY, dz: cz - minZ, type, state })
        }
      }
    }
    this._clipboard = { blocks, width: maxX - minX + 1, height: maxY - minY + 1, depth: maxZ - minZ + 1 }
    this._copyStart = null
    if (this._lineMarkerMesh) this._lineMarkerMesh.visible = false
    this.tools.refreshHint()
    return this._clipboard.blocks.length
  }

  // P key or toolbar button - stamps the copied selection with its minimum
  // corner at the currently-aimed empty cell. A no-op if nothing's been
  // copied yet, or nothing's currently aimed at.
  pasteClipboard() {
    if (!this._clipboard || this._clipboard.blocks.length === 0) return 0
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (!hit) return 0
    const [ox, oy, oz] = hit.placeAt
    this._undoGroupDo(() => {
      for (const { dx, dy, dz, type, state } of this._clipboard.blocks) {
        const px = ox + dx, py = oy + dy, pz = oz + dz
        this.placeBlock(px, py, pz, type, false, state)
        if (this.mirrorMode) this.placeBlock(this._mirrorX(px), py, pz, type, false, state)
      }
    })
    return this._clipboard.blocks.length
  }

  togglePicker() {
    this.pickerOpen = !this.pickerOpen
    // In a game Tab opens the inventory (PlayInventory.js), not the blocks.
    const game = this.survival?.active && this.survival.inv
    if (game) {
      this.survival.inv.show(this.pickerOpen)
      if (this._pickerEl) this._pickerEl.style.display = 'none'
    } else if (this._pickerEl) this._pickerEl.style.display = this.pickerOpen ? 'flex' : 'none'
    // Avoid the picker grid and the action menu both showing at once (Tab
    // while the menu's open) - closing the menu here rather than blocking
    // Tab keeps Tab's behavior consistent regardless of what else is open.
    if (this.pickerOpen && this.menuOpen) this.toggleMenu()
    if (this.pickerOpen) {
      // Stop any movement already in progress from a key held down right as
      // the picker opened - _onKeyDown itself now ignores new keys while
      // pickerOpen, but a key pressed just before this toggle already made
      // it into the set.
      this._keys.clear()
      if (!game) this._renderPicker()
      // Real cursor isn't usable until pointer lock actually releases (see
      // the exitPointerLock() call right below) - focusing before that
      // resolves is a silent no-op in some browsers.
      if (!game) setTimeout(() => this._pickerSearchInput?.focus(), 0)
    }
    if (document.pointerLockElement === this.renderer.domElement && this.pickerOpen) {
      document.exitPointerLock()
    } else if (!this.pickerOpen) {
      // See _enterBuildMode's own comment on why this is guarded - fails
      // in headless/programmatically-triggered contexts, harmless to swallow.
      try {
        this.renderer.domElement.requestPointerLock()?.catch(() => {})
      } catch {
        // Not available in this environment.
      }
    }
  }

  // True while a screen that needs the real mouse is up: the pause menu,
  // the inventory, Choose Your Weapon, You Died, the spawn map, a trader,
  // Share or Play Together, or the big map.
  mouseScreenOpen() {
    if (this.menuOpen || this.pickerOpen || this.share?.isOpen || this.together?.isOpen) return true
    if (this.survival?.leaders?.battling) return true
    if (this.survival?.ownerPanel?.open) return true
    if (this.survival?.shop?.panelOpen || this.survival?.ringEditor?.isOpen || this.survival?.emotes?.open || this.survival?.time?.pickOpen || campScreenOpen() || this.tryMode?._mapInteractive?.()) return true
    if (['play-weapon-pick', 'play-perk-pick', 'build-play-over', 'spawn-map'].some((id) => {
      const el = document.getElementById(id)
      return !!el && el.style.display !== 'none' && el.style.display !== ''
    })) return true
    return this._anyClickScreenShown()
  }

  // Any panel or pop-up on screen at all (2026-10-26, Gaymi: "fixing the
  // mouse disappear in gameplay for somethings that need mouse ... from
  // the root cause"). The list above only knew the screens it was told
  // about, so a new one - Settings opened over a game - kept the mouse
  // hidden. Every panel in the game is a `.panel-box`, and pop-ups are
  // dialogs, so whatever opens next is caught too.
  _anyClickScreenShown() {
    for (const el of document.querySelectorAll(CLICK_SCREEN_SELECTOR)) {
      if (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.offsetParent !== null) return true
    }
    return false
  }

  // Called every frame while playing: a screen that needs the mouse lets
  // it go (checked a few times a second - it reads the page), and once
  // every such screen is closed again the next click catches it back
  // (_onScreenClick), so aiming carries on without an extra click.
  _freeMouseForScreens(now) {
    if (now - (this._screenCheckAt || 0) < SCREEN_CHECK_MS) return
    this._screenCheckAt = now
    if (document.pointerLockElement !== this.renderer.domElement || !this.mouseScreenOpen()) return
    this._fireHeld = false
    this._mouseFreedForScreen = true
    try { document.exitPointerLock() } catch { /* not available */ }
  }

  // Escape - opens/closes the action menu (Exit/Save/Export/Import/Mirror/
  // Line/Copy/Paste), which sits hidden the rest of the time instead of
  // permanently on screen. Same pointer-lock release/reacquire dance as
  // togglePicker, since the menu's buttons need a real usable cursor too.
  // Playing a game from the homepage, it's the game's own pause screen
  // instead (PlayPauseMenu) - the Map Editor's is only for making maps.
  toggleMenu() {
    // Spectating (PlaySpectate.js): Escape / the phone's pause button go
    // back to the pause screen.
    if (this.spectate?.active) {
      this.spectate.exit()
      this.menuOpen = false
    }
    this.menuOpen = !this.menuOpen
    const inGame = this.gameMenu.forGame
    if (this.menuOpen) {
      this.tryMode.setAim(false)
      this._fireHeld = false
      if (!inGame) {
        this._captureMenuPreview()
        this._menuTip = (this._menuTip ?? Math.floor(Math.random() * MENU_TIP_KEYS.length) - 1) + 1
        this._refreshMenuInfo()
      }
    }
    if (this._menuEl) this._menuEl.style.display = this.menuOpen && !inGame ? 'flex' : 'none'
    this.gameMenu.show(this.menuOpen && inGame)
    // The pause screen covers the whole view: the hotbar and fps readout
    // hide behind it (the readout would sit on the title).
    if (this._hotbarEl) this._hotbarEl.style.visibility = this.menuOpen ? 'hidden' : ''
    if (this.game?.fpsEl) this.game.fpsEl.style.visibility = this.menuOpen ? 'hidden' : ''
    if (this.menuOpen && this.pickerOpen) this.togglePicker()
    if (document.pointerLockElement === this.renderer.domElement && this.menuOpen) {
      document.exitPointerLock()
    } else if (!this.menuOpen) {
      try {
        this.renderer.domElement.requestPointerLock()?.catch(() => {})
      } catch {
        // Not available in this environment.
      }
    }
  }

  // Closes the pause screen without taking the mouse back (leaving the
  // game from it).
  closeMenuQuietly() {
    this.menuOpen = false
    if (this._menuEl) this._menuEl.style.display = 'none'
    this.gameMenu.show(false)
    if (this._hotbarEl) this._hotbarEl.style.visibility = ''
    if (this.game?.fpsEl) this.game.fpsEl.style.visibility = ''
  }

  // A picture of the map as it is right now, for the preview card - read
  // straight after a render, while the frame is still in the canvas.
  _captureMenuPreview() {
    try {
      this.render()
      const img = document.getElementById('build-menu-preview')
      if (img) img.src = this.renderer.domElement.toDataURL('image/jpeg', 0.7)
      this._saveSlotThumb(false)
    } catch {
      // No picture this time - the card just shows its frame.
    }
  }

  // Fills in the pause screen's preview card, Quick Info, Shortcuts and Tip.
  _refreshMenuInfo() {
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    const name = this._slotName()
    const ago = this._savedAgoText(this._savedAtFor(this.activeSlot))
    set('build-menu-map-name', name)
    set('build-menu-map-saved', `${t('buildMenuLastSaved')}: ${ago}`)
    set('build-menu-info-map', name)
    set('build-menu-info-saved', ago)
    set('build-menu-info-blocks', this._blocks.size.toLocaleString())
    set('build-menu-editing', t('buildMenuEditing', { name }))
    set('build-menu-tip', t(MENU_TIP_KEYS[(this._menuTip || 0) % MENU_TIP_KEYS.length]))
    this.sky.refreshButtons()
    this.tools._syncButtons()
    const list = document.getElementById('build-menu-shortcuts')
    if (list) {
      list.innerHTML = ''
      for (const [keys, labelKey] of MENU_SHORTCUTS) {
        const row = document.createElement('div')
        row.className = 'build-menu-shortcut'
        const keyWrap = document.createElement('span')
        keyWrap.className = 'build-menu-keys'
        ;(typeof keys === 'function' ? keys() : keys).forEach((k, i) => {
          if (i) keyWrap.append('+')
          const kbd = document.createElement('kbd')
          kbd.textContent = k
          keyWrap.append(kbd)
        })
        const label = document.createElement('span')
        label.textContent = t(labelKey)
        row.append(keyWrap, label)
        list.append(row)
      }
    }
  }

  // How much of its usual time per frame growing and building new land
  // may take (0.35..1). A slow device (frameMs from Game's fps readout)
  // gets smaller slices, so walking into new land stutters less - it just
  // fills in a little later (2026-11-01, Gaymi: "less lag for weaker
  // devices"). Potato never takes more than 60%.
  workShare() {
    const ms = this.frameMs || 0
    let share = ms > 18 ? Math.max(0.35, 18 / ms) : 1
    if (this.game?.settings?.graphicsLevel === 'potato') share = Math.min(share, 0.6)
    return share
  }

  // Grows the open world around you (or the flying camera) and every
  // other player on a server (OpenWorld.js).
  _updateWorld() {
    if (!this.world.active) return
    const points = [this.tryMode.active ? this.tryMode.pos : { x: this.camera.position.x / BLOCK_SIZE, y: this.camera.position.y / BLOCK_SIZE, z: this.camera.position.z / BLOCK_SIZE }]
    const net = this.survival?.active && this.survival.net
    if (net && !net.closed) for (const p of net.targets()) points.push(p)
    // Couch Co-op's Player 2: they can be far from Player 1 while one of
    // them is on the Moon or in an era (Batch 5c).
    const couch = this.survival?.active && this.survival.couch
    if (couch?.joined) points.push(couch.p2)
    // A bug in the land must never stop the game's frame loop.
    try {
      this.world.update(points, this.workShare())
    } catch (err) {
      if (!this._worldError) console.error('Open world:', err)
      this._worldError = true
    }
  }

  update(dt) {
    this.gameMenu.update()
    if (this.tryMode.active) this._freeMouseForScreens(performance.now())
    // Hold-V zoom - damped toward its target the same way movement
    // velocity is below, instead of an instant snap, so both zooming in
    // and the release back to normal ease smoothly rather than jump-cutting.
    // While trying/playing the map BuildTryMode.update owns the view's
    // FOV (sprint, aiming and its own deeper zoom).
    const zoomTarget = this._keys.has(FIXED_KEYS.buildZoom) ? ZOOM_FOV : this._normalFov()
    if (!this.tryMode.active && Math.abs(this.camera.fov - zoomTarget) > 0.01) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, zoomTarget, FOV_LERP_SPEED, dt)
      this.camera.updateProjectionMatrix()
    }

    // Controller, mouse smoothing, hold-to-interact (ControlSettings.js).
    controlsTick(this, dt)
    this.camera.rotation.set(0, 0, 0)
    this.camera.rotateY(this._yaw)
    this.camera.rotateX(this._pitch)
    this.liquids.update(dt)
    this._updateWorld()
    this.sky.update(dt)
    this.grassTufts.update(dt)
    this.castleFlags.update(dt)
    this.airMotes.update(dt)
    this.fallingLeaves.update(dt)
    this.together.update(dt)
    this._updateCampDisplay(dt)
    this.touch.update(dt)
    // Animals put down in the editor walk about (in a game BuildSurvival
    // steps them, wild ones too).
    if (!this.survival.active) this._animals().update(dt, { wild: false })
    // Spectating from the pause screen (PlaySpectate.js): the camera is
    // its own, the player stands still.
    if (this.spectate.active) {
      this.spectate.update(dt, this._keys)
      // Photo Mode alone: everything holds still for the picture.
      if (!this.spectate.frozen) {
        // The game can't move the spectating camera (2026-11-16, Gaymi:
        // "when spectating it just keep glitching"): a mode's respawn,
        // kill cam or fall check used to pull it back every frame and the
        // free camera pulled it away again. Whatever the game does to
        // the camera or "me" this frame is undone - the camera is yours.
        const keep = this.spectate.hold()
        this.survival.update(dt)
        if (this.spectate.active) this.spectate.restore(keep)
      }
      return
    }
    if (this.tryMode.active) {
      // Knocked down in Couch Co-op (CouchCoop.js): no walking until revived.
      this.tryMode.update(dt, this.survival.couch?.p1Down ? NO_KEYS : this._keys)
      this.survival.update(dt)
      return
    }

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const inputDir = new THREE.Vector3()
    if (this._keys.has('KeyW')) inputDir.add(forward)
    if (this._keys.has('KeyS')) inputDir.sub(forward)
    if (this._keys.has('KeyD')) inputDir.add(right)
    if (this._keys.has('KeyA')) inputDir.sub(right)
    if (this._keys.has('Space')) inputDir.y += 1
    if (this._keys.has('ShiftLeft')) inputDir.y -= 1
    if (inputDir.lengthSq() > 0) inputDir.normalize()
    const targetVelocity = inputDir.multiplyScalar(FLY_SPEED)
    this._velocity.x = THREE.MathUtils.damp(this._velocity.x, targetVelocity.x, FLY_ACCEL_LERP_SPEED, dt)
    this._velocity.y = THREE.MathUtils.damp(this._velocity.y, targetVelocity.y, FLY_ACCEL_LERP_SPEED, dt)
    this._velocity.z = THREE.MathUtils.damp(this._velocity.z, targetVelocity.z, FLY_ACCEL_LERP_SPEED, dt)
    if (this._velocity.lengthSq() > 0.0001) {
      // Spectator-style (2026-10-02): the camera flies straight through
      // blocks. With collision, re-entering a map with the camera inside a
      // building (Map 3 is full of them) left it stuck there for good.
      this.camera.position.addScaledVector(this._velocity, dt)
    }
  }

  // Instant one-block vertical hop (double-tap Space) - a no-op if a solid
  // block sits directly overhead, same collision check the normal frame-by-
  // frame movement uses, just applied as a single teleport-sized step
  // instead of accumulated over several frames of held input.
  _hopUp() {
    this.camera.position.y += BLOCK_SIZE
  }

  // Treats the camera as a small sphere (COLLISION_RADIUS), not a point, so
  // it can't tuck its center right up against a block's face - checks the
  // grid cell at each of the 8 corners of that sphere's bounding box, since
  // near a cell boundary the sphere can overlap the neighboring cell too.
  _blockedAt(x, y, z) {
    const r = COLLISION_RADIUS
    for (const ox of [-r, r]) {
      for (const oy of [-r, r]) {
        for (const oz of [-r, r]) {
          // World position -> cell index (see placeBlock's own comment).
          // Water and lava don't block movement - you can fly/swim through
          // them, like Minecraft.
          // Open doors don't either.
          const cx = Math.floor((x + ox) / BLOCK_SIZE)
          const cy = Math.floor((y + oy) / BLOCK_SIZE)
          const cz = Math.floor((z + oz) / BLOCK_SIZE)
          const t = this.getBlockAt(cx, cy, cz)
          if (t && !this._chunks.isLiquid(t) && !this.isDoorOpenAt(cx, cy, cz)) return true
        }
      }
    }
    return false
  }

  // Invisible Blocks draw nothing, so without the Shadows setting (off by
  // default) there would be no way to see one at all. Each gets a soft
  // dark square on the top of the first block below it - a shadow cast
  // straight down. With real shadows on, the sun's own shadow shows them
  // instead and these are hidden (see render()).
  _rebuildInvisibleShadows() {
    this._invisShadowDirty = false
    const targets = new Set()
    for (const key of this._invisibleKeys) {
      const [x, y, z] = key.split(',').map(Number)
      for (let by = y - 1; by >= y - 96; by--) {
        const t = this._blocks.get(this._key(x, by, z))
        if (t && t !== 'invisible') {
          targets.add(this._key(x, by, z))
          break
        }
      }
    }
    let mesh = this._invisShadowMesh
    if (!mesh || mesh.instanceMatrix.count < targets.size) {
      if (mesh) {
        this.scene.remove(mesh)
        mesh.dispose()
      }
      const geo = new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE)
      geo.rotateX(-Math.PI / 2)
      const mat = mesh?.material || new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      mesh = new THREE.InstancedMesh(geo, mat, Math.max(64, targets.size * 2))
      mesh.frustumCulled = false
      this.scene.add(mesh)
      this._invisShadowMesh = mesh
    }
    const m = new THREE.Matrix4()
    let i = 0
    for (const key of targets) {
      const [x, y, z] = key.split(',').map(Number)
      m.makeTranslation((x + 0.5) * BLOCK_SIZE, (y + 1) * BLOCK_SIZE + 0.002, (z + 0.5) * BLOCK_SIZE)
      mesh.setMatrixAt(i++, m)
    }
    mesh.count = i
    mesh.instanceMatrix.needsUpdate = true
  }

  // Settings > Graphics level (GraphicsLevels.js), every frame - cheap
  // unless something changed: the block pictures (atlas redrawn, icons
  // redrawn), leaves, water and, with realistic light, the sun following
  // you so shadows fall everywhere, not just round the city.
  _applyGraphicsLook() {
    const look = graphicsLook(this.game?.settings)
    this.look = look
    if (setTextureDetail(look.detail)) {
      this._chunks.redrawAtlas()
      this._renderHotbar?.()
    }
    this._chunks.setEffects(look, 1 - (this.sky?.clearness ?? 1))
    this.sky?.weather3d?.setLite(!!look.lite)
    this.grassTufts?.setAmount(grassOn() ? look.tufts || 0 : 0)
    this.airMotes?.setAmount(look.motes || 0)
    this.fallingLeaves?.setAmount(look.lite ? 0 : 1)
    // Softer shadow edges on the higher levels, like real sunlight
    // (just how wide the shadow map is sampled - no redraw needed).
    if (this._sunLight) this._sunLight.shadow.radius = look.soft || 1
    // Potato's few pixels stretched up as crisp squares instead of a blur
    // (Performance Mode is lite too, but keeps the normal smooth picture).
    const crisp = !!(look.crisp ?? look.lite)
    if (this._liteWas !== crisp) {
      this._liteWas = crisp
      this.renderer.domElement.style.imageRendering = crisp ? 'pixelated' : ''
    }
    // Shadows switched on or off while playing: every material is built
    // again for it - otherwise the land went missing after turning them
    // off (a level change or the Shadows checkbox).
    const shadows = this.renderer.shadowMap.enabled
    if (this._shadowsWere !== undefined && this._shadowsWere !== shadows) {
      this.scene.traverse((o) => {
        for (const m of [].concat(o.material || [])) m.needsUpdate = true
      })
      this._shadowsDirty = true
    }
    this._shadowsWere = shadows
    this._placeSun()
  }

  // The sun's light sits at its offset from the spot you're near (snapped
  // to SUN_SNAP blocks, so the shadows don't crawl as you walk) - the
  // shadow map only covers SHADOW_SPAN around that spot.
  _placeSun() {
    const sun = this._sunLight
    if (!sun) return
    const off = this._sunOffset || [20, 30, 10]
    const p = this.tryMode.active ? this.tryMode.pos : { x: this.camera.position.x / BLOCK_SIZE, z: this.camera.position.z / BLOCK_SIZE }
    const cx = this.renderer.shadowMap.enabled ? Math.round(p.x / SUN_SNAP) * SUN_SNAP * BLOCK_SIZE : 0
    const cz = this.renderer.shadowMap.enabled ? Math.round(p.z / SUN_SNAP) * SUN_SNAP * BLOCK_SIZE : 0
    if (sun.target.position.x === cx && sun.target.position.z === cz && sun.position.y === off[1] && this._sunAt === off) return
    this._sunAt = off
    sun.target.position.set(cx, 0, cz)
    sun.target.updateMatrixWorld()
    sun.position.set(cx + off[0], off[1], cz + off[2])
    this._shadowsDirty = true
  }

  // Couch Co-op (CouchCoop.js) splits the screen: this frame's normal
  // drawing goes on the left half, Player 2's view on the right.
  render() {
    const couch = this.survival?.active && !this.survival.dead && this.tryMode.active && !this.game?.__testNoDraw ? this.survival.couch : null
    if (couch?.active) couch.drawFrame(this.renderer, () => this._renderFrame())
    else this._renderFrame()
  }

  _renderFrame() {
    // Chunk meshes are rebuilt here, once per frame, however many blocks
    // changed since the last one (a paste or a load touches thousands).
    const focus = this.tryMode.active ? this.tryMode.pos : { x: this.camera.position.x / BLOCK_SIZE, z: this.camera.position.z / BLOCK_SIZE }
    if (this._chunks.flush(this._chunkCells, focus, this.workShare())) this._shadowsDirty = true
    this.tools.update()
    if (this._invisShadowDirty) this._rebuildInvisibleShadows()
    if (this._invisShadowMesh) this._invisShadowMesh.visible = !this.renderer.shadowMap.enabled
    this._applyGraphicsLook()
    this._chunks.animate(performance.now() / 1000)
    this._applyViewDistance()
    if (this.survival?.active) this.survival.drawZombies()
    // The survival game's filmic tone mapping darkens and over-saturates
    // flat block colors (grey stone rendered near-black) - blocks keep
    // their real texture colors here, like Minecraft/Kirka.
    const toneMapping = this.renderer.toneMapping
    this.renderer.toneMapping = THREE.NoToneMapping
    // The game's renderer doesn't auto-reset its stats (see Game.js), so
    // reset around this one render to read this frame's draw calls for
    // the fps readout.
    // Shadows (when the Shadows setting is on) only change when blocks do -
    // the sun never moves here - so the shadow map is redrawn only then,
    // instead of drawing every block a second time every frame.
    // Tests only (game.__testNoDraw): everything above still runs - chunks,
    // zombies, the look - but nothing is sent to the graphics card. A test
    // machine without one draws ~2 frames a second, and a test with two
    // players' games open at once spent minutes on pictures nobody checks.
    if (this.game?.__testNoDraw) return
    const shadowMap = this.renderer.shadowMap
    const shadowAutoUpdate = shadowMap.autoUpdate
    shadowMap.autoUpdate = false
    if (this._shadowsDirty !== false) {
      shadowMap.needsUpdate = true
      this._shadowsDirty = false
    }
    this._flushBounds()
    this.renderer.info.reset()
    // Third person: the camera steps out for this drawing only (and a
    // death replay circles your body - DeathReplay.js).
    const restoreView = this.survival?.replay?.applyView(this.camera) || this.tryMode.applyView()
    // An earthquake (or an impact) shakes the view (Disasters.js).
    const restoreShake = this.sky.disasters?.beforeRender(this.camera)
    this.renderer.render(this.scene, this.camera)
    // Settings > Graphics > Zombie Outline: zombies behind walls (solo).
    drawZombieOutlines(this)
    restoreShake?.()
    restoreView?.()
    this.lastDrawCalls = this.renderer.info.render.calls
    shadowMap.autoUpdate = shadowAutoUpdate
    this.renderer.toneMapping = toneMapping
    // Photo Mode: just the world, saved straight after it's drawn.
    if (this.spectate?.photo) {
      if (this._photoPending) {
        this._photoPending = false
        this.spectate.savePhoto(this.renderer.domElement)
      }
      return
    }
    // A block held from the game's inventory is drawn in the hand instead.
    const held = this.tryMode.active && this.survival?.active ? this.survival.holding : null
    if (this.survival?.replay?.active) {
      // A death replay: no hand.
    } else if (held?.kind === 'block') this.tryMode.drawHand(this.renderer, held.id, true)
    // An animal's drop (or one being eaten): its little 3D model (HeldFood.js).
    else if (this.tryMode.active && this.survival?.active && this.tryMode.drawFood(this.renderer, held?.kind === 'item' ? held.id : null)) {
      // drawn
    } else if (this.tryMode.active && !held) this.tryMode.drawGun(this.renderer)
    else if (!this.menuOpen && !this.pickerOpen && !this._noHand) this.tryMode.drawHand(this.renderer, this.selectedType)
    // The minimap shows while building too (Try Map draws its own).
    if (!this.tryMode.active) this.tryMode.drawBuildMap(performance.now(), this.active && !this.menuOpen && !this.pickerOpen)
  }
}

// Saving, loading and the save slots (BuildSaves.js).
addSaveMethods(BuildMode)
