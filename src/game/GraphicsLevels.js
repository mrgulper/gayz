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

export const GRAPHICS_LEVELS = ['simple', 'balanced', 'detailed', 'realistic', 'ultra']

// detail: 1 = the plain 16x16 block pictures, 2 = the detailed 32x32 ones.
// realLight: warm sunlight, cool bluish shade and shadows that follow you.
// sway / waves: how far (blocks) leaves and the water's surface move.
// shine: how much the water catches the sun (0..1).
export const LEVEL_LOOK = {
  simple: { detail: 1, view: 'short', shadows: false, shadowQuality: 'low', realLight: false, sway: 0, waves: 0, shine: 0 },
  balanced: { detail: 1, view: 'medium', shadows: false, shadowQuality: 'low', realLight: false, sway: 0, waves: 0, shine: 0 },
  detailed: { detail: 2, view: 'far', shadows: false, shadowQuality: 'medium', realLight: false, sway: 0, waves: 0, shine: 0.25 },
  realistic: { detail: 2, view: 'far', shadows: true, shadowQuality: 'medium', realLight: true, sway: 0.04, waves: 0, shine: 0.6 },
  ultra: { detail: 2, view: 'max', shadows: true, shadowQuality: 'high', realLight: true, sway: 0.06, waves: 0.06, shine: 1 },
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
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(name)) return 'simple'
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
