// Graphics levels (2026-10-24, Gaymi: "simpler to very complex realistic
// graphics like the game tells what type of device you using weak or
// strong and give you the graphics that fits you but you can also switch").
// Settings > Graphics shows a picture card per level; the first time the
// game runs it picks one from the device (detectGraphicsLevel) and after
// that only the player changes it.
//
// A level sets the Graphics tab's own options (view distance, shadows) and
// the look only levels decide (textureDetail, realistic light, shining
// water, waves, swaying leaves) - BuildMode reads graphicsLook() every
// frame, so a change shows at once.

// Potato and In Real Life added 2026-10-25 (Gaymi: "make new graphics and
// name it In real life ... also make a lower poly gameplay that could fit
// very bad devices name it you give the name but its quality is lower then
// simple"). In Real Life is never picked automatically.
export const GRAPHICS_LEVELS = ['potato', 'simple', 'balanced', 'detailed', 'realistic', 'ultra', 'irl']

// detail: 1 = the plain 16x16 block pictures, 2 = the detailed 32x32 ones.
// realLight: warm sunlight, cool bluish shade and shadows that follow you.
// sway / waves: how far (blocks) leaves and the water's surface move.
// shine: how much the water catches the sun (0..1).
// real: the realistic look in the block shader (BlockChunks sharpen(), 0..1).
// res: the Resolution slider (%) the level sets - Potato draws fewer pixels.
// lite: Potato's extra savings - half the rain/snow, no splashes or low
// rain clouds, and the few pixels shown as crisp squares, not a blur.
// bump: blocks lit as bumpy (stone rough, bark ridged) from their own
// pictures (0..1). haze: far land fades into the sky's colour, like real
// air (0..1). tufts: little 3D grass plants on grass blocks near you (0..1,
// how many) - all three 2026-10-25, Gaymi: "more shapes more everything to
// make it look like in real life". motes: dust floating in the sunlight
// round you (AirMotes.js, 0..1, 2026-10-26). In Real Life also never drops
// below one pixel per screen pixel when it gets slow (PlayEntryUI
// _updateEditorResScale) - Gaymi found it blurry.
// Every level upgraded and pulled further apart (2026-10-26, Gaymi:
// "make them all have a big upgrade make them good fps and higher quality
// ... make the real life even better", and "bigger gap so they dont look
// like the same thing"). Each step up now adds something you can see:
// grade: the finishing colour (richer, a soft film curve) - cheap, so even
// Simple gets a little. ao: how deep the shade in corners and under
// overhangs goes. spec: the sun glinting off blocks - strongest on wet
// ground and puddles after rain. soft: how soft shadow edges are (the
// shadow map's blur radius, in its pixels).
// round: less blocky land on the top three levels (2026-10-26, Gaymi: "make
// the blocks not all so blocky"): smooth hills, rounded block edges,
// pebbles and leaves sticking out of trees (BlockChunks NATURAL); the
// number is how round the edges look (0..1).
export const LEVEL_LOOK = {
  // Potato went from 60% to 40% of the pixels (2026-10-25, Gaymi's
  // friends had 22 FPS on an old PC: "make the current potato graphics
  // even lower pixels for less lag").
  potato: { detail: 1, view: 'short', shadows: false, shadowQuality: 'low', realLight: false, sway: 0, waves: 0, shine: 0, res: 40, lite: true },
  simple: { detail: 1, view: 'short', shadows: false, shadowQuality: 'low', realLight: false, sway: 0, waves: 0, shine: 0, grade: 0.25, ao: 0.15 },
  balanced: { detail: 1, view: 'medium', shadows: false, shadowQuality: 'low', realLight: false, sway: 0.03, waves: 0, shine: 0.2, grade: 0.4, ao: 0.25 },
  detailed: { detail: 2, view: 'far', shadows: true, shadowQuality: 'low', realLight: false, sway: 0.04, waves: 0, shine: 0.4, bump: 0.25, tufts: 0.25, grade: 0.55, ao: 0.35, soft: 1 },
  realistic: { detail: 2, view: 'far', shadows: true, shadowQuality: 'medium', realLight: true, sway: 0.05, waves: 0.03, shine: 0.7, real: 0.3, bump: 0.5, haze: 0.3, tufts: 0.5, grade: 0.7, ao: 0.45, spec: 0.35, soft: 1.5, round: 0.5 },
  ultra: { detail: 2, view: 'max', shadows: true, shadowQuality: 'high', realLight: true, sway: 0.07, waves: 0.06, shine: 1, real: 0.6, bump: 0.75, haze: 0.6, tufts: 0.8, motes: 0.4, grade: 0.85, ao: 0.55, spec: 0.6, soft: 2, round: 0.75 },
  irl: { detail: 2, view: 'max', shadows: true, shadowQuality: 'high', realLight: true, sway: 0.09, waves: 0.1, shine: 1, real: 1, bump: 1, haze: 1, tufts: 1, motes: 1, grade: 1, ao: 0.75, spec: 1, soft: 3, round: 1 },
}

export function graphicsLook(settings) {
  return LEVEL_LOOK[settings?.graphicsLevel] || LEVEL_LOOK.detailed
}

// The level that fits this device, from what the browser tells a page:
// the graphics chip's name, the CPU core count, the memory (Chrome only,
// rounded) and whether it's a touch screen. A best guess - the player can
// always pick another.
export function detectGraphicsLevel(gpu = '', env = {}) {
  const name = String(gpu).toLowerCase()
  const cores = env.cores ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4)
  const memory = env.memory ?? (typeof navigator !== 'undefined' ? navigator.deviceMemory || 8 : 8)
  const touch = env.touch ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  // Drawn by the CPU (graphics acceleration off): as light as possible.
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(name)) return 'potato'
  if (cores <= 2 || memory <= 1) return 'potato'
  if (touch) {
    if (cores <= 4 || memory <= 3 || /mali-4|mali-t|adreno \(tm\) [1-5]\d\d\b|powervr/.test(name)) return 'simple'
    // Recent iPads and iPhones (Apple GPU) and flagship Android phones.
    if (/apple/.test(name) && cores >= 6) return 'detailed'
    return 'balanced'
  }
  // Big graphics cards and Apple's Pro/Max/Ultra chips: everything.
  if (/rtx|radeon rx [5-9]\d{3}|rx [67]\d{3}|apple m\d (pro|max|ultra)/.test(name)) return 'ultra'
  if (/apple m\d|gtx|radeon rx|radeon pro|arc a\d/.test(name)) return cores >= 8 ? 'realistic' : 'detailed'
  // Older built-in Intel graphics, small laptops.
  if (/intel.*(hd|uhd) graphics|intel\(r\) (hd|uhd)/.test(name) || cores <= 4 || memory <= 4) return 'balanced'
  return 'detailed'
}
