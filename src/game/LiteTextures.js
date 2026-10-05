// Lite Textures (Settings > Graphics, 2026-10-04): every picture loaded
// from a file (model textures, the ground and building walls) is redrawn
// at half its width and height, so it takes a quarter of the graphics
// memory - about 104 MB of the game's ~132 MB of textures becomes ~26 MB.
// Pictures the game draws itself at runtime (name tags, labels, the Map
// Editor's block atlas) are left alone, since some of them get redrawn
// later and swapping their canvas would freeze them.
//
// Turned on by the player, or automatically after the browser drops the
// game's graphics connection (Game.js's webglcontextlost handler) - with
// several 3D games open at once the graphics card runs out of room, and a
// smaller GayZ is less likely to be the one that gets dropped again.
//
// A texture's picture is shared by all its copies (three.js's Source), so
// each picture is shrunk once; the full-size one is kept so turning Lite
// off puts it back.
export const LITE_MIN_SIZE = 128 // smaller pictures aren't worth shrinking

const originals = new WeakMap() // Source -> its full-size picture

function isFilePicture(img) {
  return (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)
    || (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap)
}

function eachTexture(roots, fn) {
  const seen = new Set()
  for (const root of roots) {
    root?.traverse?.((o) => {
      for (const m of [].concat(o.material || [])) {
        for (const key in m) {
          const tex = m[key]
          if (tex && tex.isTexture && !seen.has(tex)) {
            seen.add(tex)
            fn(tex)
          }
        }
      }
    })
  }
}

// Shrinks every not-yet-shrunk file picture under these scenes/groups.
// Returns how many pictures were shrunk this time.
export function shrinkTextures(roots) {
  let count = 0
  eachTexture(roots, (tex) => {
    const source = tex.source
    if (!source || originals.has(source)) return
    const img = tex.image
    if (!img || !isFilePicture(img)) return
    const w = img.width
    const h = img.height
    if (w < LITE_MIN_SIZE && h < LITE_MIN_SIZE) return
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(w / 2))
    canvas.height = Math.max(1, Math.floor(h / 2))
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    originals.set(source, img)
    tex.image = canvas
    tex.needsUpdate = true
    count++
  })
  return count
}

// Puts the full-size pictures back.
export function restoreTextures(roots) {
  let count = 0
  eachTexture(roots, (tex) => {
    const source = tex.source
    const img = source && originals.get(source)
    if (!img) return
    originals.delete(source)
    tex.image = img
    tex.needsUpdate = true
    count++
  })
  return count
}
