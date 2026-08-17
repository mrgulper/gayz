// Standalone block-placing creative sandbox - explicitly NOT connected to
// zombie survival gameplay (see docs/superpowers/specs/2026-08-08-build-mode-design.md).
// Reuses Game.js's existing renderer/canvas rather than a second WebGL
// context - only the scene/camera passed to render() changes.
import * as THREE from 'three'

// GROUND_SIZE is a CELL count (not world units) - bumped up from 64, then
// 76, as BLOCK_SIZE shrank each time, so the buildable footprint's actual
// physical size (GROUND_SIZE * BLOCK_SIZE) stays close to what it was
// before rather than shrinking just because each cell got smaller.
const GROUND_SIZE = 128
// Down from 1, then 0.85, then 0.5 - still read as too large up close in
// first person even at 0.5, per direct follow-up feedback, so this went
// smaller again rather than assuming the previous pass had already solved
// it. GROUND_SIZE deliberately isn't scaled up to compensate this time
// (unlike every previous BLOCK_SIZE cut) - doing so would need
// MAX_INSTANCES_PER_TYPE raised too (GROUND_SIZE^2 cells must fit under it),
// which multiplies GPU memory reserved per block type across all 71 types;
// a smaller total buildable footprint is the safer tradeoff than that.
const BLOCK_SIZE = 0.35
const FLY_SPEED = 8
// Movement used to snap straight to full speed the instant a key went down
// and stop dead the instant it came up - velocity damps toward the target
// speed instead (same THREE.MathUtils.damp technique WeaponSystem.js uses
// for its own aim/sprint smoothing), giving a real accelerate-then-coast
// feel rather than an on/off toggle.
const FLY_ACCEL_LERP_SPEED = 8
const LOOK_SENSITIVITY = 0.0022
// Raised from 4096, then 8192, alongside each BLOCK_SIZE/GROUND_SIZE bump -
// a single GROUND_SIZE x GROUND_SIZE ground layer (128*128=16384 cells) now
// needs more headroom on its own than the old cap allowed, with zero left
// over to actually build anything above it.
const MAX_INSTANCES_PER_TYPE = 20000
const SAVE_KEY = 'gayz-build-mode'
// Multiple save slots (see switchSlot/save/load) - was a single fixed key
// (v1's deliberately-scoped-down "one save slot" design). SAVE_SLOTS_KEY
// holds an array of SAVE_SLOT_COUNT entries (null = empty slot, or a
// snapshot object); SAVE_KEY itself is kept only as a one-time migration
// source (see _loadSlots) so a build saved before slots existed isn't lost.
const SAVE_SLOTS_KEY = 'gayz-build-mode-slots'
const SAVE_SLOT_COUNT = 3
// Undo/Redo (see _pushUndoChange/undo/redo) - capped so a very long build
// session doesn't grow the history array without bound.
const MAX_UNDO_STEPS = 100
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
// The ground layer sits one cell below the walkable surface (y=0) - a
// block "at y" occupies the space from y to y+1, so a block at y=-1 has
// its top face flush with y=0, matching where the old static ground mesh's
// top surface used to sit.
const GROUND_LAYER_Y = -1
const GROUND_BLOCK_TYPE = 'grass'
// Minecraft-style hotbar key mapping - Digit1-9 are slots 0-8, Digit0 is
// slot 9 (the 10th slot), matching the real keyboard row's left-to-right
// order rather than numeric value.
const DIGIT_KEY_TO_HOTBAR_INDEX = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
  Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9,
}

export const BLOCK_TYPES = [
  { id: 'concrete', name: 'Concrete', color: 0x9a9a92, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'brick', name: 'Brick', color: 0xa8503a, pattern: 'brick', roughness: 0.85, metalness: 0 },
  { id: 'wood', name: 'Wood', color: 0x8a5a34, pattern: 'wood', roughness: 0.7, metalness: 0 },
  { id: 'metal', name: 'Metal', color: 0xb0b8bd, pattern: 'metal', roughness: 0.35, metalness: 0.7 },
  { id: 'grass', name: 'Grass', color: 0x5fa84a, pattern: 'speckle', roughness: 1, metalness: 0 },
  { id: 'dirt', name: 'Dirt', color: 0x6b4a30, pattern: 'speckle', roughness: 1, metalness: 0 },
  { id: 'glass', name: 'Glass', color: 0xaee0e8, pattern: 'glass', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55 },
  { id: 'asphalt', name: 'Asphalt', color: 0x3a3a3c, pattern: 'speckle', roughness: 0.95, metalness: 0 },
  { id: 'stone', name: 'Stone Brick', color: 0x808078, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'sand', name: 'Sand', color: 0xd9c48f, pattern: 'speckle', roughness: 1, metalness: 0 },
  { id: 'snow', name: 'Snow', color: 0xf0f0f5, pattern: 'speckle', roughness: 0.95, metalness: 0 },
  { id: 'planks', name: 'Planks', color: 0xb98a52, pattern: 'wood', roughness: 0.6, metalness: 0 },
  { id: 'gold', name: 'Gold', color: 0xf4c430, pattern: 'metal', roughness: 0.2, metalness: 1 },
  { id: 'obsidian', name: 'Obsidian', color: 0x1c1024, pattern: 'speckle', roughness: 0.3, metalness: 0.1 },
  { id: 'water', name: 'Water', color: 0x3a7bd5, pattern: 'glass', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.6 },
  { id: 'ice', name: 'Ice', color: 0xaee4f0, pattern: 'glass', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.7 },
  { id: 'leaves', name: 'Leaves', color: 0x3f7d3a, pattern: 'speckle', roughness: 1, metalness: 0, transparent: true, opacity: 0.88 },
  { id: 'lava', name: 'Lava', color: 0xff5a1f, pattern: 'speckle', roughness: 0.8, metalness: 0, emissive: 0xff3300, emissiveIntensity: 0.9 },
  { id: 'granite', name: 'Granite', color: 0x8a5a52, pattern: 'speckle', roughness: 0.85, metalness: 0 },
  { id: 'marble', name: 'Marble', color: 0xe4e0da, pattern: 'brick', roughness: 0.3, metalness: 0 },
  { id: 'copper', name: 'Copper', color: 0xc17a4a, pattern: 'metal', roughness: 0.3, metalness: 0.85 },
  { id: 'iron', name: 'Iron', color: 0xd8d8d2, pattern: 'metal', roughness: 0.4, metalness: 0.9 },
  { id: 'clay', name: 'Clay', color: 0xb5654a, pattern: 'speckle', roughness: 0.95, metalness: 0 },
  { id: 'moss', name: 'Moss', color: 0x3d6b32, pattern: 'speckle', roughness: 1, metalness: 0 },
  // Most-common-blocks pass (matched against Minecraft's own most-placed
  // types) - fills real gaps the original 24 left, like there being no log/
  // wool pattern at all, and several blocks players expect (cobblestone,
  // TNT, ore blocks) missing entirely.
  { id: 'cobblestone', name: 'Cobblestone', color: 0x7d7d7d, pattern: 'speckle', roughness: 0.95, metalness: 0 },
  { id: 'oaklog', name: 'Oak Log', color: 0x6b4423, pattern: 'log', roughness: 0.8, metalness: 0 },
  { id: 'bookshelf', name: 'Bookshelf', color: 0x8a6239, pattern: 'wood', roughness: 0.75, metalness: 0 },
  { id: 'wool', name: 'Wool', color: 0xe8e4d8, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'netherrack', name: 'Netherrack', color: 0x723232, pattern: 'speckle', roughness: 1, metalness: 0 },
  { id: 'diamondblock', name: 'Diamond Block', color: 0x5fd4d4, pattern: 'metal', roughness: 0.15, metalness: 0.9 },
  { id: 'redstoneblock', name: 'Redstone Block', color: 0xa61b1b, pattern: 'metal', roughness: 0.3, metalness: 0.6, emissive: 0x8a0000, emissiveIntensity: 0.4 },
  { id: 'coalblock', name: 'Coal Block', color: 0x1c1c1c, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'pumpkin', name: 'Pumpkin', color: 0xd9761a, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'tnt', name: 'TNT', color: 0xc23b22, pattern: 'stripe', roughness: 0.85, metalness: 0 },
  { id: 'quartz', name: 'Quartz Block', color: 0xe8e4dc, pattern: 'brick', roughness: 0.4, metalness: 0 },
  { id: 'andesite', name: 'Andesite', color: 0x888888, pattern: 'speckle', roughness: 0.85, metalness: 0 },
  // Second common-blocks pass.
  { id: 'ironore', name: 'Iron Ore', color: 0x8a8570, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'goldore', name: 'Gold Ore', color: 0x9c8a4a, pattern: 'speckle', roughness: 0.85, metalness: 0 },
  { id: 'diamondore', name: 'Diamond Ore', color: 0x7ba8a0, pattern: 'speckle', roughness: 0.85, metalness: 0 },
  { id: 'coalore', name: 'Coal Ore', color: 0x3a3a38, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'emeraldblock', name: 'Emerald Block', color: 0x1a9850, pattern: 'metal', roughness: 0.2, metalness: 0.8 },
  { id: 'lapisblock', name: 'Lapis Block', color: 0x1f4d9c, pattern: 'metal', roughness: 0.25, metalness: 0.75 },
  { id: 'bedrock', name: 'Bedrock', color: 0x2a2a2a, pattern: 'speckle', roughness: 1, metalness: 0 },
  { id: 'endstone', name: 'End Stone', color: 0xdcd7a0, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'sandstone', name: 'Sandstone', color: 0xc9b183, pattern: 'brick', roughness: 0.85, metalness: 0 },
  { id: 'cactus', name: 'Cactus', color: 0x3f8f3a, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'netherbrick', name: 'Nether Bricks', color: 0x35181c, pattern: 'brick', roughness: 0.8, metalness: 0 },
  { id: 'haybale', name: 'Hay Bale', color: 0xd4b03c, pattern: 'wood', roughness: 0.9, metalness: 0 },
  // Third pass - fills in stone variants (polished/smooth finishes, extra
  // natural terrain blocks) and a set of dyed concrete/wool colors, the
  // two categories most requested-but-missing after the first two passes.
  { id: 'gravel', name: 'Gravel', color: 0x8f8f88, pattern: 'speckle', roughness: 1, metalness: 0 },
  { id: 'mud', name: 'Mud', color: 0x4a3728, pattern: 'speckle', roughness: 1, metalness: 0 },
  { id: 'deepslate', name: 'Deepslate', color: 0x3a3a40, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'blackstone', name: 'Blackstone', color: 0x2b2530, pattern: 'speckle', roughness: 0.85, metalness: 0 },
  { id: 'diorite', name: 'Diorite', color: 0xd0d0d0, pattern: 'speckle', roughness: 0.85, metalness: 0 },
  { id: 'polishedgranite', name: 'Polished Granite', color: 0x9c5548, pattern: 'metal', roughness: 0.4, metalness: 0.05 },
  { id: 'polishedandesite', name: 'Polished Andesite', color: 0x9a9a9a, pattern: 'metal', roughness: 0.4, metalness: 0.05 },
  { id: 'smoothstone', name: 'Smooth Stone', color: 0xa8a8a0, pattern: 'metal', roughness: 0.5, metalness: 0 },
  { id: 'prismarine', name: 'Prismarine', color: 0x4f9e94, pattern: 'metal', roughness: 0.35, metalness: 0.2 },
  { id: 'sealantern', name: 'Sea Lantern', color: 0xc8e8e0, pattern: 'metal', roughness: 0.3, metalness: 0.1, emissive: 0xa0e8d8, emissiveIntensity: 0.5 },
  { id: 'amethystblock', name: 'Amethyst Block', color: 0x9a5fd4, pattern: 'metal', roughness: 0.25, metalness: 0.3 },
  { id: 'honeyblock', name: 'Honey Block', color: 0xe8a723, pattern: 'glass', roughness: 0.2, metalness: 0, transparent: true, opacity: 0.85 },
  { id: 'slimeblock', name: 'Slime Block', color: 0x6fcc3f, pattern: 'glass', roughness: 0.25, metalness: 0, transparent: true, opacity: 0.75 },
  { id: 'purpurblock', name: 'Purpur Block', color: 0xa374b5, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'terracotta', name: 'Terracotta', color: 0x9c5232, pattern: 'brick', roughness: 0.85, metalness: 0 },
  { id: 'redconcrete', name: 'Red Concrete', color: 0xa32424, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'blueconcrete', name: 'Blue Concrete', color: 0x2451a3, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'yellowconcrete', name: 'Yellow Concrete', color: 0xd4c020, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'greenconcrete', name: 'Green Concrete', color: 0x3f7d3a, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'blackconcrete', name: 'Black Concrete', color: 0x1c1c1e, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'whiteconcrete', name: 'White Concrete', color: 0xe8e8e4, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'redwool', name: 'Red Wool', color: 0xa8382a, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'bluewool', name: 'Blue Wool', color: 0x2c4fa0, pattern: 'wool', roughness: 1, metalness: 0 },
  // Fourth pass - rounds out wool to a full dyed set (only red/blue existed
  // before), adds a few stained-glass colors alongside honey/slime's
  // existing transparent 'glass' pattern, and 3 wood plank tones plus 2
  // more metal-pattern ore/alloy blocks.
  { id: 'yellowwool', name: 'Yellow Wool', color: 0xd4c020, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'greenwool', name: 'Green Wool', color: 0x3f7d3a, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'blackwool', name: 'Black Wool', color: 0x1c1c1e, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'whitewool', name: 'White Wool', color: 0xe8e8e4, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'purplewool', name: 'Purple Wool', color: 0x7a3fa8, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'orangewool', name: 'Orange Wool', color: 0xd47a28, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'pinkwool', name: 'Pink Wool', color: 0xe89ab8, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'cyanwool', name: 'Cyan Wool', color: 0x2a9c9c, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'graywool', name: 'Gray Wool', color: 0x5c5c5c, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'brownwool', name: 'Brown Wool', color: 0x6b4a2c, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'limewool', name: 'Lime Wool', color: 0x7dd42a, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'bluestainedglass', name: 'Blue Stained Glass', color: 0x3a6fc8, pattern: 'glass', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 },
  { id: 'greenstainedglass', name: 'Green Stained Glass', color: 0x3f9c4a, pattern: 'glass', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 },
  { id: 'redstainedglass', name: 'Red Stained Glass', color: 0xc03a3a, pattern: 'glass', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 },
  { id: 'oakplanks', name: 'Oak Planks', color: 0xb4864a, pattern: 'wood', roughness: 0.85, metalness: 0 },
  { id: 'spruceplanks', name: 'Spruce Planks', color: 0x6b4a2c, pattern: 'wood', roughness: 0.85, metalness: 0 },
  { id: 'birchplanks', name: 'Birch Planks', color: 0xd8c898, pattern: 'wood', roughness: 0.85, metalness: 0 },
  { id: 'copperblock', name: 'Copper Block', color: 0xb87043, pattern: 'metal', roughness: 0.35, metalness: 0.7 },
  { id: 'netherite', name: 'Netherite Block', color: 0x3c3438, pattern: 'metal', roughness: 0.3, metalness: 0.6 },
  // Fifth pass - rounds concrete and wool out to the full 16-color dyed
  // set (only 6 and 13 of 16 existed respectively), a few more stained-
  // glass colors, more wood/log variants, a handful of natural stone
  // types, and some glowing/decorative specials that were missing.
  { id: 'orangeconcrete', name: 'Orange Concrete', color: 0xd87a1a, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'magentaconcrete', name: 'Magenta Concrete', color: 0xb44ac2, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'lightblueconcrete', name: 'Light Blue Concrete', color: 0x6bb9d9, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'limeconcrete', name: 'Lime Concrete', color: 0x7cc82a, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'pinkconcrete', name: 'Pink Concrete', color: 0xe08fab, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'grayconcrete', name: 'Gray Concrete', color: 0x4a4a4e, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'lightgrayconcrete', name: 'Light Gray Concrete', color: 0x9a9a96, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'cyanconcrete', name: 'Cyan Concrete', color: 0x1a7f8c, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'purpleconcrete', name: 'Purple Concrete', color: 0x7a2fa8, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'brownconcrete', name: 'Brown Concrete', color: 0x5a3a24, pattern: 'speckle', roughness: 0.8, metalness: 0 },
  { id: 'magentawool', name: 'Magenta Wool', color: 0xc74ebd, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'lightbluewool', name: 'Light Blue Wool', color: 0x6cb0d6, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'lightgraywool', name: 'Light Gray Wool', color: 0x9d9d97, pattern: 'wool', roughness: 1, metalness: 0 },
  { id: 'yellowstainedglass', name: 'Yellow Stained Glass', color: 0xd4c020, pattern: 'glass', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 },
  { id: 'purplestainedglass', name: 'Purple Stained Glass', color: 0x7a3fa8, pattern: 'glass', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 },
  { id: 'blackstainedglass', name: 'Black Stained Glass', color: 0x2a2a2c, pattern: 'glass', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 },
  { id: 'whitestainedglass', name: 'White Stained Glass', color: 0xe8e8e4, pattern: 'glass', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 },
  { id: 'darkoakplanks', name: 'Dark Oak Planks', color: 0x4a3524, pattern: 'wood', roughness: 0.85, metalness: 0 },
  { id: 'jungleplanks', name: 'Jungle Planks', color: 0xb5895a, pattern: 'wood', roughness: 0.85, metalness: 0 },
  { id: 'acaciaplanks', name: 'Acacia Planks', color: 0xb85a3a, pattern: 'wood', roughness: 0.85, metalness: 0 },
  { id: 'sprucelog', name: 'Spruce Log', color: 0x4a3324, pattern: 'log', roughness: 0.8, metalness: 0 },
  { id: 'birchlog', name: 'Birch Log', color: 0xd8cba8, pattern: 'log', roughness: 0.8, metalness: 0 },
  { id: 'basalt', name: 'Basalt', color: 0x4a4a4e, pattern: 'speckle', roughness: 0.85, metalness: 0 },
  { id: 'tuff', name: 'Tuff', color: 0x6a6a5e, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'calcite', name: 'Calcite', color: 0xe0dcd0, pattern: 'speckle', roughness: 0.7, metalness: 0 },
  { id: 'mossycobblestone', name: 'Mossy Cobblestone', color: 0x6a7d5a, pattern: 'speckle', roughness: 0.95, metalness: 0 },
  { id: 'mossystonebricks', name: 'Mossy Stone Bricks', color: 0x6a7d5a, pattern: 'brick', roughness: 0.9, metalness: 0 },
  { id: 'glowstone', name: 'Glowstone', color: 0xe8c060, pattern: 'metal', roughness: 0.5, metalness: 0, emissive: 0xe8a020, emissiveIntensity: 0.7 },
  { id: 'magmablock', name: 'Magma Block', color: 0xc23a1f, pattern: 'speckle', roughness: 0.8, metalness: 0, emissive: 0xff4400, emissiveIntensity: 0.6 },
  { id: 'cryingobsidian', name: 'Crying Obsidian', color: 0x2f1440, pattern: 'speckle', roughness: 0.3, metalness: 0.1, emissive: 0x9a2fd4, emissiveIntensity: 0.5 },
  { id: 'boneblock', name: 'Bone Block', color: 0xe8e0c8, pattern: 'stripe', roughness: 0.7, metalness: 0 },
  { id: 'spongeblock', name: 'Sponge', color: 0xc9c024, pattern: 'speckle', roughness: 0.9, metalness: 0 },
  { id: 'jackolantern', name: "Jack o'Lantern", color: 0xd9761a, pattern: 'speckle', roughness: 0.8, metalness: 0, emissive: 0xff8800, emissiveIntensity: 0.6 },
]
const VALID_TYPE_IDS = new Set(BLOCK_TYPES.map((b) => b.id))
// Real point lights on glowing blocks (see placeBlock/removeBlock) - every
// block whose material already has an emissive color (lava, glowstone,
// jack o'lantern, etc.) previously only glowed on its own face; it never
// actually lit up the blocks around it. Derived from BLOCK_TYPES' own
// emissive field rather than a separate hardcoded id list, so any future
// glowing block type picks this up automatically. Capped at
// MAX_ACTIVE_LIGHTS - real THREE.PointLights are real render cost, unlike
// the InstancedMesh blocks themselves; past the cap, a placed glow block
// still looks lit (its own emissive material), it just stops casting light
// onto its neighbors.
const LIGHT_BLOCK_COLORS = new Map(BLOCK_TYPES.filter((bt) => bt.emissive).map((bt) => [bt.id, bt.emissive]))
const MAX_ACTIVE_LIGHTS = 40
const LIGHT_INTENSITY = 1.4
const LIGHT_DISTANCE = 6

// Flat MeshStandardMaterial colors read as plain painted planes rather than
// distinct blocks once several sit side by side - real Minecraft-style
// building games sell "3D block" via a per-face texture (grain/speckle/
// mortar lines) plus a darker edge border, not geometry. Baked once per
// type into a small canvas at construction time, not per-instance (all
// instances of a type share one InstancedMesh material/texture).
function _shade(base, delta) {
  return base.clone().offsetHSL(0, 0, delta)
}
function _rgb(c) {
  return `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`
}
// Two size classes - fine dust (most of the count) plus a handful of
// larger chunks - reads as real aggregate/rock texture rather than a
// uniform noise field, which is what a single speck size produced no
// matter how many were added. This is the most-reused pattern (roughly
// half of BLOCK_TYPES), so it carries most of the "does this look like a
// real material or a painted plane" impression.
function _drawSpeckle(ctx, base, size) {
  for (let i = 0; i < 150; i++) {
    const c = _shade(base, (Math.random() - 0.5) * 0.22)
    ctx.fillStyle = `rgb(${_rgb(c)})`
    const s = 1 + Math.random() * 2.4
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s)
  }
  for (let i = 0; i < 16; i++) {
    const c = _shade(base, (Math.random() - 0.5) * 0.32)
    ctx.fillStyle = `rgb(${_rgb(c)})`
    const s = 3 + Math.random() * 5
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s)
  }
}
function _drawBrick(ctx, base, size) {
  const mortar = _shade(base, 0.3)
  ctx.strokeStyle = `rgb(${_rgb(mortar)})`
  ctx.lineWidth = 2
  const rows = 4
  const rowH = size / rows
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * rowH); ctx.lineTo(size, r * rowH); ctx.stroke()
  }
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : size / 4
    for (let x = offset; x <= size; x += size / 2) {
      ctx.beginPath(); ctx.moveTo(x, r * rowH); ctx.lineTo(x, (r + 1) * rowH); ctx.stroke()
    }
  }
}
function _drawWood(ctx, base, size) {
  const planks = 4
  const plankW = size / planks
  for (let p = 0; p < planks; p++) {
    const shade = _shade(base, (Math.random() - 0.5) * 0.1)
    ctx.fillStyle = `rgb(${_rgb(shade)})`
    ctx.fillRect(p * plankW, 0, plankW, size)
  }
  const grain = _shade(base, -0.2)
  ctx.strokeStyle = `rgba(${_rgb(grain)},0.5)`
  ctx.lineWidth = 1
  for (let p = 1; p < planks; p++) {
    ctx.beginPath(); ctx.moveTo(p * plankW, 0); ctx.lineTo(p * plankW, size); ctx.stroke()
  }
  for (let i = 0; i < 10; i++) {
    const y = Math.random() * size
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (Math.random() - 0.5) * 4); ctx.stroke()
  }
}
function _drawMetal(ctx, base, size) {
  const line = _shade(base, -0.25)
  ctx.strokeStyle = `rgb(${_rgb(line)})`
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)
  ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke()
  const rivet = _shade(base, 0.35)
  ctx.fillStyle = `rgb(${_rgb(rivet)})`
  const pad = 4
  for (const [x, y] of [[pad, pad], [size - pad, pad], [pad, size - pad], [size - pad, size - pad]]) {
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill()
  }
}
function _drawGlass(ctx, base, size) {
  const line = _shade(base, -0.3)
  ctx.strokeStyle = `rgba(${_rgb(line)},0.8)`
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke()
  const shine = _shade(base, 0.4)
  ctx.fillStyle = `rgba(${_rgb(shine)},0.5)`
  ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(size / 2 - 2, 3); ctx.lineTo(3, size / 2 - 2); ctx.closePath(); ctx.fill()
}
// Concentric bark rings - the signature "log" tell (Oak Log etc.), distinct
// from the plank-strip look _drawWood already covers.
function _drawLog(ctx, base, size) {
  const dark = _shade(base, -0.28)
  ctx.strokeStyle = `rgba(${_rgb(dark)},0.55)`
  ctx.lineWidth = 1.5
  const cx = size / 2
  const cy = size / 2
  for (let r = size * 0.1; r < size * 0.55; r += size * 0.09) {
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * (0.85 + Math.random() * 0.15), 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  const bark = _shade(base, -0.4)
  ctx.strokeStyle = `rgba(${_rgb(bark)},0.4)`
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)
}
// Fine woven cross-hatch - Wool's tell, distinct from every hard-surface
// pattern above.
function _drawWool(ctx, base, size) {
  const step = size / 8
  for (let i = 0; i <= 8; i++) {
    const shade = _shade(base, (Math.random() - 0.5) * 0.08)
    ctx.strokeStyle = `rgba(${_rgb(shade)},0.35)`
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke()
  }
}
// Alternating bands - TNT's tell.
function _drawStripe(ctx, base, size) {
  const alt = _shade(base, base.getHSL({}).l > 0.5 ? -0.55 : 0.55)
  const bands = 3
  const bandH = size / bands
  for (let b = 0; b < bands; b++) {
    if (b % 2 === 1) {
      ctx.fillStyle = `rgb(${_rgb(alt)})`
      ctx.fillRect(0, b * bandH, size, bandH)
    }
  }
}
const PATTERN_DRAWERS = { speckle: _drawSpeckle, brick: _drawBrick, wood: _drawWood, metal: _drawMetal, glass: _drawGlass, log: _drawLog, wool: _drawWool, stripe: _drawStripe }

// Fine per-pixel grain, applied over the finished pattern before the AO/
// sheen passes below - every pattern drawer above fills with flat solid
// colors (fillRect/stroke), which reads as an obviously computer-generated
// flat plane up close in first person. A subtle per-texel brightness jitter
// is the same cheap trick real material textures use to fake surface
// micro-detail without needing an actual bump/normal map. Skipped for
// glass-pattern blocks - grain on a transparent pane reads as dirty rather
// than textured, and blurs the sharp cross-mullion lines _drawGlass relies on.
function _addGrain(ctx, size, pattern) {
  if (pattern === 'glass') return
  const imgData = ctx.getImageData(0, 0, size, size)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const jitter = (Math.random() - 0.5) * 14
    d[i] = Math.max(0, Math.min(255, d[i] + jitter))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + jitter))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + jitter))
  }
  ctx.putImageData(imgData, 0, 0)
}

function _makeBlockTexture(colorHex, pattern) {
  // 256, up from 192 (128 before that, 96 before that, 64 before that, 32
  // originally) - NearestFilter magnification means every texel is a
  // visibly hard-edged square up close, so each bump buys back some
  // sharpness at the same viewing distance while still keeping the
  // intentional pixel-art look (not switching to LinearFilter, which would
  // blur the pattern edges away). The pattern drawers themselves
  // (_drawSpeckle etc.) work in proportional "size" units, not fixed pixel
  // counts, so they scale up automatically with this - no per-pattern
  // changes needed.
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const base = new THREE.Color(colorHex)
  ctx.fillStyle = `rgb(${_rgb(base)})`
  ctx.fillRect(0, 0, size, size)
  const draw = PATTERN_DRAWERS[pattern]
  if (draw) draw(ctx, base, size)
  _addGrain(ctx, size, pattern)

  // Soft ambient-occlusion vignette - real surfaces catch less light right
  // at their own edges/corners than dead center; without this every
  // pattern above reads as a flat painted plane no matter how much detail
  // it has. Lightened from 0.28 to 0.18 (and pulled the inner radius out
  // to 0.35) - the stronger version was muddying the pattern detail
  // underneath it instead of just grounding the block's edges.
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.75)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.18)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, size, size)

  // Faint directional sheen (upper-left, roughly matching the scene's own
  // sun position) instead of flat, uniform brightness across the whole face.
  const highlight = ctx.createLinearGradient(0, 0, size, size)
  highlight.addColorStop(0, 'rgba(255,255,255,0.14)')
  highlight.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = highlight
  ctx.fillRect(0, 0, size, size)

  const edge = _shade(base, -0.32)
  ctx.strokeStyle = `rgba(${_rgb(edge)},0.6)`
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class BuildMode {
  constructor(renderer) {
    this.renderer = renderer
    this.active = false

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87ceeb)

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2)
    this.scene.add(hemiLight)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.0)
    sunLight.position.set(20, 30, 10)
    // Real cast shadows (not just per-face lighting) are what actually
    // reads as "3D" from a distance - a flat-shaded cube and a shadowed
    // one look very different even with the same geometry.
    sunLight.castShadow = true
    sunLight.shadow.mapSize.set(1024, 1024)
    // GROUND_SIZE is a cell count, not world units (see its own comment) -
    // the shadow frustum needs to cover the ground's actual physical size.
    const shadowSpan = (GROUND_SIZE * BLOCK_SIZE) / 2 + 8
    sunLight.shadow.camera.left = -shadowSpan
    sunLight.shadow.camera.right = shadowSpan
    sunLight.shadow.camera.top = shadowSpan
    sunLight.shadow.camera.bottom = -shadowSpan
    sunLight.shadow.camera.near = 1
    sunLight.shadow.camera.far = 100
    this.scene.add(sunLight)

    this.camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.1, 500)
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
      if (this.pickerOpen) return
      // Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo - the two common bindings
      // for the same action across editors, both wired here rather than
      // picking one.
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.repeat) {
        e.preventDefault()
        if (e.shiftKey) this.redo()
        else this.undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY' && !e.repeat) {
        e.preventDefault()
        this.redo()
        return
      }
      if (e.code === 'KeyM' && !e.repeat) {
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
    this._onKeyUp = (e) => this._keys.delete(e.code)
    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return
      this._yaw -= e.movementX * LOOK_SENSITIVITY
      this._pitch -= e.movementY * LOOK_SENSITIVITY
      this._pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this._pitch))
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
    this._blocks = new Map() // "x,y,z" -> type id
    this._blockLights = new Map() // "x,y,z" -> THREE.PointLight, see LIGHT_BLOCK_COLORS
    // Undo/Redo - each undo-stack entry is a batch (array) of individual
    // {x, y, z, beforeType, afterType} changes, so a single user action
    // (one click, or a whole line/mirror/paste batch) undoes/redoes as one
    // step rather than one block at a time. See _beginBatch/_endBatch.
    this._undoStack = []
    this._redoStack = []
    this._pendingBatch = null
    // Multiple save slots (see switchSlot) - which of SAVE_SLOT_COUNT slots
    // is currently loaded/being edited. Not persisted itself (always opens
    // back on slot 0) - keeping it simple rather than adding a second
    // "remember last slot" storage key for a minor convenience.
    this.activeSlot = 0
    // Mirror mode (see toggleMirror/_mirrorX) - off by default. Mirrors
    // across world x=0, the same plane the free-fly camera spawns facing
    // down (see the constructor's camera.position), so it lines up with
    // where a player naturally starts building.
    this.mirrorMode = false
    // Line tool (see toggleLineTool/_lineToolClick) - place-only (right-
    // click), two clicks per line: first sets the start point, second sets
    // the end point and fills every cell between them in one undo step.
    // Left-click removal is untouched (still single-block) - a line-remove
    // mode would double the interaction surface for a much rarer use case.
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
    this._instancedMeshes = {}
    this._instanceKeyByIndex = {} // type id -> array mapping instance index -> "x,y,z" key, for swap-remove
    const blockGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE)
    for (const bt of BLOCK_TYPES) {
      const material = new THREE.MeshStandardMaterial({
        map: _makeBlockTexture(bt.color, bt.pattern),
        roughness: bt.roughness,
        metalness: bt.metalness,
        transparent: !!bt.transparent,
        opacity: bt.opacity ?? 1,
        emissive: bt.emissive ?? 0x000000,
        emissiveIntensity: bt.emissiveIntensity ?? 0,
      })
      const mesh = new THREE.InstancedMesh(blockGeo, material, MAX_INSTANCES_PER_TYPE)
      mesh.count = 0
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
      this._instancedMeshes[bt.id] = mesh
      this._instanceKeyByIndex[bt.id] = []
    }

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
    this._onPointerDown = (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) {
        // Cursor is free (Build Mode no longer auto-locks the instant you
        // enter, see Game.js's _enterBuildMode - it was disorienting to
        // have the mouse captured before you'd even gotten oriented).
        // Clicking into the viewport re-acquires it instead of placing/
        // removing a block, so this first click is never mistaken for a
        // build action.
        try { this.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available in this environment */ }
        return
      }
      if (e.button === 2) {
        if (this.lineToolMode) this._lineToolClick()
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
    this._pickerEl = document.getElementById('build-picker')
    if (this._pickerEl) {
      this._pickerEl.innerHTML = ''
      this._pickerSearchInput = document.createElement('input')
      this._pickerSearchInput.type = 'text'
      this._pickerSearchInput.className = 'build-picker-search'
      this._pickerSearchInput.placeholder = 'Search blocks...'
      this._pickerSearchInput.addEventListener('click', (e) => e.stopPropagation())
      this._pickerSearchInput.addEventListener('input', () => this._renderPickerGrid())
      this._pickerEl.appendChild(this._pickerSearchInput)
      this._pickerGridEl = document.createElement('div')
      this._pickerGridEl.className = 'build-picker-grid'
      this._pickerEl.appendChild(this._pickerGridEl)
    }
    this._renderPicker()

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

    // Mirror toggle button (see toggleMirror) - the M key does the same
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

    this._onKeyDownHotbar = (e) => {
      // Same reasoning as _onKeyDown's guard - without it, typing a digit
      // while searching the picker (e.g. "TNT" has none, but plenty of
      // names could) would also switch the active hotbar slot underneath.
      if (this.pickerOpen) return
      const digitIndex = DIGIT_KEY_TO_HOTBAR_INDEX[e.code]
      if (digitIndex === undefined) return
      this._selectHotbarSlot(digitIndex)
    }

    this._onKeyDownPicker = (e) => {
      if (e.code === 'Tab') {
        e.preventDefault()
        this.togglePicker()
      } else if (e.code === 'Escape' && this.pickerOpen) {
        this.togglePicker()
      } else if (e.code === 'Escape' && document.pointerLockElement === this.renderer.domElement) {
        // Picker already handles its own Escape-to-close above - this is
        // the OTHER case, actively pointer-locked with the picker closed,
        // where there was previously no way to get the cursor back except
        // opening the picker first. Click anywhere in the viewport (see
        // _onPointerDown) re-acquires it.
        document.exitPointerLock()
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

  enter() {
    this.active = true
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('keydown', this._onKeyDownPicker)
    window.addEventListener('keydown', this._onKeyDownHotbar)
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('contextmenu', this._onContextMenu)
    document.addEventListener('click', this._onPickerBackdropClick)
    if (this._hotbarEl) this._hotbarEl.style.display = 'flex'
    if (this._slotsEl) this._slotsEl.style.display = 'flex'
    if (this._mirrorBtnEl) this._mirrorBtnEl.style.display = 'block'
    if (this._lineToolBtnEl) this._lineToolBtnEl.style.display = 'block'
    if (this._copyToolBtnEl) this._copyToolBtnEl.style.display = 'block'
    if (this._pasteBtnEl) this._pasteBtnEl.style.display = 'block'
    this.load()
    this._renderSlots()
  }

  exit() {
    this.save()
    this.active = false
    this._keys.clear()
    // Mirror resets off on exit - a returning player starting a fresh
    // session shouldn't be surprised by a toggle they don't remember
    // leaving on.
    if (this.mirrorMode) this.toggleMirror()
    if (this.lineToolMode) this.toggleLineTool()
    if (this.copyToolMode) this.toggleCopyTool()
    // No toggle state to reset any more (V is a held key, read live from
    // _keys in update()) - just snap the FOV back in case V happened to
    // be held mid-zoom when Build Mode was exited.
    if (this.camera.fov !== NORMAL_FOV) {
      this.camera.fov = NORMAL_FOV
      this.camera.updateProjectionMatrix()
    }
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('keydown', this._onKeyDownPicker)
    window.removeEventListener('keydown', this._onKeyDownHotbar)
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('contextmenu', this._onContextMenu)
    document.removeEventListener('click', this._onPickerBackdropClick)
    this.pickerOpen = false
    if (this._pickerEl) this._pickerEl.style.display = 'none'
    if (this._hotbarEl) this._hotbarEl.style.display = 'none'
    if (this._slotsEl) this._slotsEl.style.display = 'none'
    if (this._mirrorBtnEl) this._mirrorBtnEl.style.display = 'none'
    if (this._lineToolBtnEl) this._lineToolBtnEl.style.display = 'none'
    if (this._copyToolBtnEl) this._copyToolBtnEl.style.display = 'none'
    if (this._pasteBtnEl) this._pasteBtnEl.style.display = 'none'
  }

  // Tab picker swatch click - assigns that block to whichever hotbar slot
  // is currently active (see _selectHotbarSlot) and equips it immediately,
  // same as picking an item up in Minecraft's creative inventory drops it
  // straight into your held hand.
  _assignToActiveSlot(id) {
    this.hotbar[this.activeHotbarIndex] = id
    this.selectedType = id
    this._renderHotbar()
  }

  // Hotbar slot click or Digit1-9/0 - makes that slot the active one and
  // equips whatever's in it (or nothing, if the slot is still empty).
  _selectHotbarSlot(index) {
    this.activeHotbarIndex = index
    this.selectedType = this.hotbar[index]
    this._renderHotbar()
  }

  _key(x, y, z) {
    return `${x},${y},${z}`
  }

  getBlockAt(x, y, z) {
    return this._blocks.get(this._key(x, y, z)) ?? null
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
  placeBlock(x, y, z, type, skipBoundsUpdate = false) {
    const key = this._key(x, y, z)
    if (this._blocks.has(key)) return
    const mesh = this._instancedMeshes[type]
    if (!mesh || mesh.count >= MAX_INSTANCES_PER_TYPE) return
    const index = mesh.count
    // x/y/z are integer grid cell indices (unaffected by BLOCK_SIZE - saved
    // builds, _blocks' sparse map keys, and every raycast/collision cell
    // lookup all stay in this same cell-index space); only the WORLD
    // position of that cell's center needs the *BLOCK_SIZE conversion.
    const matrix = new THREE.Matrix4().makeTranslation((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE)
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
    if (!skipBoundsUpdate) mesh.computeBoundingSphere()
    this._blocks.set(key, type)
    this._instanceKeyByIndex[type][index] = key

    const lightColor = LIGHT_BLOCK_COLORS.get(type)
    if (lightColor !== undefined && this._blockLights.size < MAX_ACTIVE_LIGHTS) {
      const light = new THREE.PointLight(lightColor, LIGHT_INTENSITY, LIGHT_DISTANCE)
      light.position.set((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE)
      this.scene.add(light)
      this._blockLights.set(key, light)
    }
  }

  removeBlock(x, y, z) {
    const key = this._key(x, y, z)
    const type = this._blocks.get(key)
    if (!type) return
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

    const light = this._blockLights.get(key)
    if (light) {
      this.scene.remove(light)
      light.dispose()
      this._blockLights.delete(key)
    }
  }

  // Records one cell's change for undo/redo - called by the *Undoable
  // wrappers below, never by placeBlock/removeBlock directly (bulk callers
  // like load()/_ensureGroundLayer()/_applyParsedData() deliberately don't
  // touch undo history; undoing back through a whole freshly-loaded build
  // one cell at a time would be meaningless). Outside a batch, every change
  // becomes its own single-entry undo step; during a batch (see
  // _beginBatch), changes accumulate and become one step together.
  _pushUndoChange(x, y, z, beforeType, afterType) {
    if (beforeType === afterType) return
    if (this._pendingBatch) {
      this._pendingBatch.push({ x, y, z, beforeType, afterType })
      return
    }
    this._undoStack.push([{ x, y, z, beforeType, afterType }])
    if (this._undoStack.length > MAX_UNDO_STEPS) this._undoStack.shift()
    // Any new action invalidates whatever redo history existed - same
    // standard undo/redo convention every editor uses.
    this._redoStack.length = 0
  }

  // Groups every _pushUndoChange call between _beginBatch/_endBatch into
  // one undo step - used by the line tool and mirror mode so dragging a
  // whole wall (or placing one block that mirrors to a second cell) undoes
  // in a single Ctrl+Z, not once per individual cell touched.
  _beginBatch() {
    this._pendingBatch = []
  }

  _endBatch() {
    const batch = this._pendingBatch
    this._pendingBatch = null
    if (!batch || batch.length === 0) return
    this._undoStack.push(batch)
    if (this._undoStack.length > MAX_UNDO_STEPS) this._undoStack.shift()
    this._redoStack.length = 0
  }

  // placeBlock/removeBlock already no-op on an occupied/empty cell
  // respectively, so beforeType is read here (rather than trusted from the
  // caller) to know whether the raw call actually did anything - avoids
  // recording a phantom no-op change.
  _placeBlockUndoable(x, y, z, type) {
    const before = this.getBlockAt(x, y, z)
    if (before !== null) return
    this.placeBlock(x, y, z, type)
    this._pushUndoChange(x, y, z, null, type)
  }

  _removeBlockUndoable(x, y, z) {
    const before = this.getBlockAt(x, y, z)
    if (before === null) return
    this.removeBlock(x, y, z)
    this._pushUndoChange(x, y, z, before, null)
  }

  // Ctrl+Z - reverses the most recent batch, most-recent-cell-first within
  // it (matters if a batch ever touches the same cell twice; reversing in
  // the opposite order changes were made keeps every intermediate state
  // consistent). Returns whether there was anything to undo, so the caller
  // can skip showing a toast for a no-op press.
  undo() {
    const batch = this._undoStack.pop()
    if (!batch) return false
    for (let i = batch.length - 1; i >= 0; i--) {
      const { x, y, z, beforeType } = batch[i]
      if (beforeType === null) this.removeBlock(x, y, z)
      else this.placeBlock(x, y, z, beforeType)
    }
    this._redoStack.push(batch)
    return true
  }

  // Ctrl+Y / Ctrl+Shift+Z - replays a previously-undone batch forward,
  // original order this time.
  redo() {
    const batch = this._redoStack.pop()
    if (!batch) return false
    for (const { x, y, z, afterType } of batch) {
      if (afterType === null) this.removeBlock(x, y, z)
      else this.placeBlock(x, y, z, afterType)
    }
    this._undoStack.push(batch)
    return true
  }

  _placeFromCamera() {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (!hit) return
    const [px, py, pz] = hit.placeAt
    if (this._wouldOverlapCamera(px, py, pz)) return
    if (this.mirrorMode) {
      this._beginBatch()
      this._placeBlockUndoable(px, py, pz, this.selectedType)
      this._placeBlockUndoable(this._mirrorX(px), py, pz, this.selectedType)
      this._endBatch()
    } else {
      this._placeBlockUndoable(px, py, pz, this.selectedType)
    }
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
    if (!hit || !hit.existingBlock) return
    const [rx, ry, rz] = hit.existingBlock
    if (this.mirrorMode) {
      this._beginBatch()
      this._removeBlockUndoable(rx, ry, rz)
      this._removeBlockUndoable(this._mirrorX(rx), ry, rz)
      this._endBatch()
    } else {
      this._removeBlockUndoable(rx, ry, rz)
    }
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
  _raycastGridAligned() {
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
      if (this.getBlockAt(cell[0], cell[1], cell[2])) {
        return { placeAt: prevCell || cell, existingBlock: cell }
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
  }

  // Just the swatch grid, filtered by the search box's current value -
  // split out from _renderPicker so typing doesn't rebuild (and lose focus
  // on) the search input itself, only the grid below it.
  _renderPickerGrid() {
    if (!this._pickerGridEl) return
    this._pickerGridEl.innerHTML = ''
    const query = (this._pickerSearchInput?.value || '').trim().toLowerCase()
    const matches = query ? BLOCK_TYPES.filter((bt) => bt.name.toLowerCase().includes(query)) : BLOCK_TYPES
    for (const { id, name, color } of matches) {
      const item = document.createElement('div')
      item.className = 'build-picker-item'
      item.title = name
      const swatch = document.createElement('div')
      swatch.className = 'build-picker-swatch' + (id === this.selectedType ? ' selected' : '')
      swatch.style.background = `#${color.toString(16).padStart(6, '0')}`
      const label = document.createElement('span')
      label.className = 'build-picker-label'
      label.textContent = name
      item.appendChild(swatch)
      item.appendChild(label)
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

  // 10 slots, empty until assigned from the picker above - see
  // DIGIT_KEY_TO_HOTBAR_INDEX for the matching Digit1-9/0 key handling.
  _renderHotbar() {
    if (!this._hotbarEl) return
    this._hotbarEl.innerHTML = ''
    this.hotbar.forEach((id, i) => {
      const bt = id ? BLOCK_TYPES.find((b) => b.id === id) : null
      const slot = document.createElement('div')
      slot.className = 'build-hotbar-slot' + (i === this.activeHotbarIndex ? ' selected' : '')
      slot.title = bt ? bt.name : ''
      if (bt) slot.style.background = `#${bt.color.toString(16).padStart(6, '0')}`
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
    const slots = this._loadSlots()
    for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
      const btn = document.createElement('button')
      btn.className = 'build-slot-btn' + (i === this.activeSlot ? ' active' : '')
      btn.title = slots[i] ? `Slot ${i + 1} (has a build)` : `Slot ${i + 1} (empty)`
      btn.textContent = String(i + 1)
      if (slots[i]) {
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
  }

  // M key or toolbar button - see mirrorMode's own comment for why x=0.
  toggleMirror() {
    this.mirrorMode = !this.mirrorMode
    if (this._mirrorPlaneMesh) this._mirrorPlaneMesh.visible = this.mirrorMode
    if (this._mirrorBtnEl) this._mirrorBtnEl.classList.toggle('active', this.mirrorMode)
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
  }

  // First right-click while lineToolMode is on sets the start point;
  // the second fills every cell on the straight line between start and
  // end (inclusive) with the selected block, as one undo step.
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
      return
    }
    const [sx, sy, sz] = this._lineStart
    this._beginBatch()
    for (const [cx, cy, cz] of this._lineCells(sx, sy, sz, x, y, z)) {
      this._placeBlockUndoable(cx, cy, cz, this.selectedType)
      if (this.mirrorMode) this._placeBlockUndoable(this._mirrorX(cx), cy, cz, this.selectedType)
    }
    this._endBatch()
    this._lineStart = null
    if (this._lineMarkerMesh) this._lineMarkerMesh.visible = false
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
          if (type) blocks.push({ dx: cx - minX, dy: cy - minY, dz: cz - minZ, type })
        }
      }
    }
    this._clipboard = { blocks, width: maxX - minX + 1, height: maxY - minY + 1, depth: maxZ - minZ + 1 }
    this._copyStart = null
    if (this._lineMarkerMesh) this._lineMarkerMesh.visible = false
    return this._clipboard.blocks.length
  }

  // P key or toolbar button - stamps the copied selection with its minimum
  // corner at the currently-aimed empty cell, as one undo step. A no-op if
  // nothing's been copied yet, or nothing's currently aimed at.
  pasteClipboard() {
    if (!this._clipboard || this._clipboard.blocks.length === 0) return 0
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (!hit) return 0
    const [ox, oy, oz] = hit.placeAt
    this._beginBatch()
    for (const { dx, dy, dz, type } of this._clipboard.blocks) {
      const px = ox + dx, py = oy + dy, pz = oz + dz
      this._placeBlockUndoable(px, py, pz, type)
      if (this.mirrorMode) this._placeBlockUndoable(this._mirrorX(px), py, pz, type)
    }
    this._endBatch()
    return this._clipboard.blocks.length
  }

  togglePicker() {
    this.pickerOpen = !this.pickerOpen
    if (this._pickerEl) this._pickerEl.style.display = this.pickerOpen ? 'flex' : 'none'
    if (this.pickerOpen) {
      // Stop any movement already in progress from a key held down right as
      // the picker opened - _onKeyDown itself now ignores new keys while
      // pickerOpen, but a key pressed just before this toggle already made
      // it into the set.
      this._keys.clear()
      this._renderPicker()
      // Real cursor isn't usable until pointer lock actually releases (see
      // the exitPointerLock() call right below) - focusing before that
      // resolves is a silent no-op in some browsers.
      setTimeout(() => this._pickerSearchInput?.focus(), 0)
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

  // Reads the slots array from storage, migrating a pre-slots single save
  // (the old SAVE_KEY) into slot 0 the first time this ever runs after
  // slots were introduced - a build made before this feature existed
  // should still be there, not silently lost.
  _loadSlots() {
    try {
      const raw = localStorage.getItem(SAVE_SLOTS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const slots = parsed.slice(0, SAVE_SLOT_COUNT)
          while (slots.length < SAVE_SLOT_COUNT) slots.push(null)
          return slots
        }
      }
    } catch {
      // Malformed - fall through to a fresh empty set of slots below.
    }
    const slots = new Array(SAVE_SLOT_COUNT).fill(null)
    try {
      const legacyRaw = localStorage.getItem(SAVE_KEY)
      if (legacyRaw) slots[0] = JSON.parse(legacyRaw)
    } catch {
      // Malformed legacy save - start slot 0 empty too rather than crash.
    }
    return slots
  }

  _saveSlots(slots) {
    try {
      localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots))
    } catch {
      // Storage unavailable (e.g. private browsing) - build just won't persist.
    }
  }

  save() {
    const slots = this._loadSlots()
    slots[this.activeSlot] = this._snapshot()
    this._saveSlots(slots)
  }

  // Switches to a different slot: saves the current build into whichever
  // slot is active now (so work in progress is never silently lost by
  // switching away from it), then loads the target slot's data into a
  // freshly-cleared scene. No-op if already on that slot.
  switchSlot(index) {
    if (index === this.activeSlot || index < 0 || index >= SAVE_SLOT_COUNT) return
    this.save()
    this.clearAllBlocks()
    this.activeSlot = index
    const slots = this._loadSlots()
    this._applyParsedData(slots[index])
    this._ensureGroundLayer()
  }

  // Shared by save() (local persistence) and exportMap() (downloadable
  // file) - one source of truth for "what does a saved build contain."
  _snapshot() {
    const blocks = []
    for (const [key, type] of this._blocks) {
      const [x, y, z] = key.split(',').map(Number)
      blocks.push({ x, y, z, type })
    }
    return { blocks, hotbar: this.hotbar }
  }

  load() {
    const slots = this._loadSlots()
    this._applyParsedData(slots[this.activeSlot])
    this._ensureGroundLayer()
  }

  // Shared by load() (local storage, called on entering Build Mode with an
  // already-empty scene) and importMapFile() (an uploaded file, called
  // into a scene that may already have a build in it - the caller clears
  // first, see clearAllBlocks). Save format used to be a bare array of
  // block entries, before the hotbar existed - keep reading those the same
  // way rather than silently dropping every build saved before that change.
  _applyParsedData(parsed) {
    if (!parsed) return
    const blocks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.blocks) ? parsed.blocks : null
    if (blocks) {
      // Same bulk-fill deferral as _ensureGroundLayer - a saved build can
      // touch many different block types, so track which meshes actually
      // received a placement and recompute bounds once per type afterward,
      // rather than once per block placed.
      const touchedTypes = new Set()
      for (const entry of blocks) {
        if (!entry || typeof entry !== 'object') continue
        const { x, y, z, type } = entry
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
        if (!VALID_TYPE_IDS.has(type)) continue
        this.placeBlock(Math.trunc(x), Math.trunc(y), Math.trunc(z), type, true)
        touchedTypes.add(type)
      }
      for (const type of touchedTypes) {
        const mesh = this._instancedMeshes[type]
        if (mesh) mesh.computeBoundingSphere()
      }
    }
    const hotbar = parsed?.hotbar
    if (Array.isArray(hotbar) && hotbar.length === 10) {
      this.hotbar = hotbar.map((id) => (id === null || VALID_TYPE_IDS.has(id) ? id : null))
      this._renderHotbar()
    }
  }

  // Downloads the current build (same shape save() writes to localStorage)
  // as a JSON file, matching Game.js's own _exportSave() Blob-download
  // pattern for the main survival-game save.
  exportMap() {
    const data = this._snapshot()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const link = document.createElement('a')
    link.download = `gayz-build-${Date.now()}.json`
    link.href = URL.createObjectURL(blob)
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  // Wipes every currently-placed block (including the ground layer) back
  // to a truly empty InstancedMesh/sparse-map state - needed before
  // importing a file into a scene that may already have a build in it,
  // since placeBlock only ever adds (see its own occupied-cell no-op).
  clearAllBlocks() {
    for (const type in this._instancedMeshes) {
      const mesh = this._instancedMeshes[type]
      mesh.count = 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this._instanceKeyByIndex[type] = []
    }
    this._blocks.clear()
    for (const light of this._blockLights.values()) {
      this.scene.remove(light)
      light.dispose()
    }
    this._blockLights.clear()
    // Old undo/redo history refers to cells from whatever build just got
    // wiped - keeping it around would let Ctrl+Z resurrect blocks from a
    // build that (from the player's perspective) no longer exists.
    this._undoStack.length = 0
    this._redoStack.length = 0
  }

  // Returns true on a successful import (caller shows its own toast/error
  // UI) - unlike the main game's save import, this doesn't need a page
  // reload: Build Mode's own scene/sparse-map is the only place this data
  // lives, so re-populating it directly is enough.
  async importMapFile(file) {
    if (!file) return false
    let parsed
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      return false
    }
    const blocks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.blocks) ? parsed.blocks : null
    if (!blocks) return false
    this.clearAllBlocks()
    this._applyParsedData(parsed)
    this._ensureGroundLayer()
    this.save()
    return true
  }

  // Backfills any still-empty ground-level (y=GROUND_LAYER_Y) cell across
  // the whole GROUND_SIZE x GROUND_SIZE footprint with grass - runs after
  // loading (or failing to load) a save, so a fresh Build Mode always
  // starts with real, breakable ground instead of nothing, while never
  // overwriting a cell the player (or a saved build) already explicitly
  // placed something in - placeBlock already no-ops on an occupied cell,
  // so this is just "call it for every cell and let that guard do the work."
  _ensureGroundLayer() {
    const half = GROUND_SIZE / 2
    for (let x = -half; x < half; x++) {
      for (let z = -half; z < half; z++) {
        this.placeBlock(x, GROUND_LAYER_Y, z, GROUND_BLOCK_TYPE, true)
      }
    }
    // One bounds recompute for the whole fill instead of one per cell (see
    // placeBlock's skipBoundsUpdate comment) - this single call is what
    // actually collapses the ~10 second stall down to instant.
    const groundMesh = this._instancedMeshes[GROUND_BLOCK_TYPE]
    if (groundMesh) groundMesh.computeBoundingSphere()
  }

  update(dt) {
    // Hold-V zoom - damped toward its target the same way movement
    // velocity is below, instead of an instant snap, so both zooming in
    // and the release back to normal ease smoothly rather than jump-cutting.
    const zoomTarget = this._keys.has('KeyV') ? ZOOM_FOV : NORMAL_FOV
    if (Math.abs(this.camera.fov - zoomTarget) > 0.01) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, zoomTarget, FOV_LERP_SPEED, dt)
      this.camera.updateProjectionMatrix()
    }

    this.camera.rotation.set(0, 0, 0)
    this.camera.rotateY(this._yaw)
    this.camera.rotateX(this._pitch)

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
      const move = this._velocity.clone().multiplyScalar(dt)
      // Axis-separated: resolve x, then y, then z independently rather than
      // rejecting the whole move when any part of it hits a block - this is
      // what lets the camera slide along a wall instead of stopping dead
      // the moment it grazes one. Zeroing the blocked axis's velocity (not
      // just skipping that frame's position update) keeps it from silently
      // building up speed while pressed against a wall.
      const pos = this.camera.position
      if (!this._blockedAt(pos.x + move.x, pos.y, pos.z)) pos.x += move.x
      else this._velocity.x = 0
      if (!this._blockedAt(pos.x, pos.y + move.y, pos.z)) pos.y += move.y
      else this._velocity.y = 0
      if (!this._blockedAt(pos.x, pos.y, pos.z + move.z)) pos.z += move.z
      else this._velocity.z = 0
    }
    // No separate floor clamp needed anymore - the ground is now a real,
    // breakable block layer (see _ensureGroundLayer), so _blockedAt above
    // already stops the camera at solid ground the same way it stops it at
    // any other placed block, and correctly lets it fly on through wherever
    // that layer has been dug out.
  }

  // Instant one-block vertical hop (double-tap Space) - a no-op if a solid
  // block sits directly overhead, same collision check the normal frame-by-
  // frame movement uses, just applied as a single teleport-sized step
  // instead of accumulated over several frames of held input.
  _hopUp() {
    const pos = this.camera.position
    if (!this._blockedAt(pos.x, pos.y + BLOCK_SIZE, pos.z)) pos.y += BLOCK_SIZE
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
          if (this.getBlockAt(Math.floor((x + ox) / BLOCK_SIZE), Math.floor((y + oy) / BLOCK_SIZE), Math.floor((z + oz) / BLOCK_SIZE))) return true
        }
      }
    }
    return false
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
