// Map editor block rendering, Minecraft/Kirka style (2026-09-29, "make the
// map editor blocks look like kirka.io and 60fps stable").
//
// Before: one InstancedMesh per block type, every cube drawn with all 6
// faces - the default 128x128 grass floor alone was 16,384 full cubes
// (~200k triangles, drawn a second time for the shadow map), almost all of
// them faces no camera could ever see because another block covered them.
//
// Now: the world is cut into CHUNK x CHUNK x CHUNK cell chunks, and each
// chunk is ONE mesh holding only the faces that touch air (or see-through
// blocks). Every block type's texture lives in one shared atlas, so a
// chunk is one draw call no matter how many block types it holds. Each
// face vertex gets Minecraft-style "smooth lighting" ambient occlusion
// (darker where blocks meet in a corner) baked into its vertex color -
// that, plus crisp pixel textures, is most of what makes a voxel game
// read as "high quality" rather than flat.
//
// Only plain cubes go through here. Shaped blocks (stairs/fence/ladder)
// keep BuildMode's per-type InstancedMesh path - they're rare, and they
// never hide a neighbor's face.
import * as THREE from 'three'

export const CHUNK = 16
// A chunk plus a one-cell ring on every side (see _build), and the mark
// for a cell of it not looked up yet.
const PAD = CHUNK + 2
const UNREAD = 0
// Time per frame spent rebuilding the open world's chunks (see flush()).
const LAZY_BUDGET_MS = 5
// A chunk mesh's numbers are only needed until the graphics card has its
// own copy - nothing reads them back (a change rebuilds the chunk), so the
// copy in memory is dropped right after upload. That kept about as much
// memory again as the meshes themselves (~45 MB in a Map 1 match). After a
// lost graphics connection, rebuildAll() makes them again from the blocks.
function dropAfterUpload() {
  this.array = null
}
// Only a mesh that's drawn gets uploaded, so a new chunk is drawn once
// even when it's behind you (frustumCulled off until then) - otherwise land
// you haven't looked at yet keeps its copy (~20 MB in a Map 1 match).
function cullAfterUpload() {
  this.array = null
  this.mesh.frustumCulled = true
  this.mesh = null
}
// A power-of-two SLOT with the tile repeated into half-tile padding: every
// mipmap level (down to one texel per slot) then only ever averages a
// block's own texture - no distant speckles bled in from the next tile.
// Tiles hold the 16x16 pixel textures at their own size (2026-10-17, clean
// and crisp like Kirka/bloxd instead of the blurry 64px HD ones): about 2 MB
// with mipmaps for ~311 textures.
const DEFAULT_TILE = 16
// Mip level bias for block textures: negative = sharper far away (a full
// -1 starts to shimmer on moving ground).
const SHARPEN = -0.6
// Cells across the roof-height grid BuildWeather keeps round you (its ROOF).
export const ROOF_GRID = 40
// Realistic look (uReal 0-1: Ultra half, In Real Life full - graphics
// levels, 2026-10-25, Gaymi: "make it more realistic as if you were irl
// playing it"): the pixel art is smoothed (four samples a pixel apart),
// the ground's colour drifts in big soft patches across the world
// like real grass, dirt and rock instead of one repeating tile, and the
// light is graded a little warmer and richer. 0 = the plain look, same
// program, just a number.
//
// Weather on the ground (2026-10-25, Gaymi: "when it rains, snows, or
// hails make the ground have some water and snow too"): uWet darkens
// what's out in the open and fills dips with puddles that mirror the sky,
// uSnow piles snow on top faces in growing patches, uIce scatters hail
// stones - BuildWeather raises and lowers them. Under a roof stays dry:
// the same roof-height grid that stops the rain indoors (uRoof).
// Also by graphics level: uBump lights the block pictures as bumpy
// (stone rough, bark ridged), uHaze fades far land into the sky's colour.
function sharpen(mat, fx, extra = null) {
  mat.onBeforeCompile = (shader) => {
    for (const k of ['real', 'block', 'wet', 'snow', 'ice', 'roof', 'roofOrigin', 'roofBase', 'sky', 'bump', 'haze']) {
      shader.uniforms[`u${k[0].toUpperCase()}${k.slice(1)}`] = fx[k]
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = objectNormal;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      uniform float uReal;
      uniform float uBlock;
      uniform float uWet;
      uniform float uSnow;
      uniform float uIce;
      uniform sampler2D uRoof;
      uniform vec2 uRoofOrigin;
      uniform float uRoofBase;
      uniform vec3 uSky;
      uniform float uBump;
      uniform float uHaze;
      varying vec3 vWPos;
      varying vec3 vWNorm;
      // 1 = open to the sky here, 0 = under a roof (wp in blocks).
      float openSky(vec3 wp, vec3 n) {
        vec2 cell = floor(wp.xz + n.xz * 0.5) - uRoofOrigin;
        if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= ${ROOF_GRID.toFixed(1)} || cell.y >= ${ROOF_GRID.toFixed(1)}) return 1.0;
        float top = texture2D(uRoof, (cell + 0.5) / ${ROOF_GRID.toFixed(1)}).r * 255.0;
        if (top < 0.5) return 1.0;
        return step(uRoofBase + top - 0.1, wp.y);
      }
      float realHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float realNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(realHash(i), realHash(i + vec3(1, 0, 0)), f.x), mix(realHash(i + vec3(0, 1, 0)), realHash(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(realHash(i + vec3(0, 0, 1)), realHash(i + vec3(1, 0, 1)), f.x), mix(realHash(i + vec3(0, 1, 1)), realHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
      vec4 texel = texture2D( map, vMapUv, ${SHARPEN.toFixed(2)} );
      if (uReal > 0.0) {
        vec2 tx = 1.0 / vec2(textureSize(map, 0));
        vec4 soft = (texture2D(map, vMapUv + vec2(-tx.x, -tx.y), ${SHARPEN.toFixed(2)}) + texture2D(map, vMapUv + vec2(tx.x, -tx.y), ${SHARPEN.toFixed(2)})
          + texture2D(map, vMapUv + vec2(-tx.x, tx.y), ${SHARPEN.toFixed(2)}) + texture2D(map, vMapUv + vec2(tx.x, tx.y), ${SHARPEN.toFixed(2)})) * 0.25;
        texel.rgb = mix(texel.rgb, soft.rgb, 0.85 * uReal);
        vec3 wp = vWPos / uBlock;
        float patches = realNoise(wp * 0.11) * 0.65 + realNoise(wp * 0.37) * 0.35;
        texel.rgb *= 1.0 + (patches - 0.5) * 0.3 * uReal;
      }
      diffuseColor *= texel;
    #endif
      float puddle = 0.0;
      if (uWet + uSnow + uIce > 0.0) {
        vec3 wp = vWPos / uBlock;
        float open = openSky(wp, vWNorm);
        float up = step(0.5, vWNorm.y) * open;
        float wet = uWet * open;
        diffuseColor.rgb *= 1.0 - 0.32 * wet * (0.6 + 0.4 * up);
        // Puddles: low, flat spots in big soft patches, growing as it rains.
        float pn = realNoise(vec3(wp.xz * 0.45, 3.0)) * 0.7 + realNoise(vec3(wp.xz * 1.7, 9.0)) * 0.3;
        puddle = up * smoothstep(0.78 - 0.3 * uWet, 0.86 - 0.3 * uWet, pn) * uWet;
        diffuseColor.rgb *= 1.0 - 0.35 * puddle;
        // Snow: patches that join up into a white blanket.
        float sn = realNoise(vec3(wp.xz * 1.3, 1.0)) * 0.6 + realNoise(vec3(wp.xz * 4.1, 5.0)) * 0.4;
        float cover = up * smoothstep(1.0 - uSnow * 1.15, 1.08 - uSnow * 1.15, sn);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.99) * (0.92 + 0.08 * sn), cover);
        // Hail: little ice stones lying about.
        float stone = realHash(floor(wp * vec3(9.0, 1.0, 9.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.92, 0.98), up * step(1.0 - uIce * 0.22, stone) * (1.0 - cover));
        puddle *= 1.0 - cover;
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      #ifdef USE_MAP
      if (uBump > 0.0) {
        // Height = how light the picture is; up close only (far away the
        // pixels are smaller than a screen pixel and would just shimmer).
        float bh = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        float near = 1.0 - smoothstep(10.0, 28.0, length(vViewPosition) / uBlock);
        vec2 dh = vec2(dFdx(bh), dFdy(bh)) * uBump * near * 6.0;
        vec3 sx = normalize(dFdx(-vViewPosition));
        vec3 sy = normalize(dFdy(-vViewPosition));
        vec3 r1 = cross(sy, normal);
        vec3 r2 = cross(normal, sx);
        float det = dot(sx, r1);
        normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
      }
      #endif`)
      .replace('#include <fog_fragment>', `if (uReal > 0.0) {
        vec3 c = gl_FragColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.0 + 0.18 * uReal);
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.35 * uReal);
        c *= mix(vec3(1.0), vec3(1.04, 1.01, 0.96), uReal);
        gl_FragColor.rgb = c;
      }
      vec3 skyOut = sRGBTransferOETF(vec4(uSky, 1.0)).rgb;
      if (puddle > 0.0) {
        // Puddles mirror the sky, most when looked at low across them.
        float fres = pow(1.0 - clamp(normalize(cameraPosition - vWPos).y, 0.0, 1.0), 2.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, skyOut, puddle * (0.25 + 0.55 * fres));
      }
      if (uHaze > 0.0) {
        float far = length(cameraPosition - vWPos) / uBlock;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, skyOut, uHaze * 0.5 * (1.0 - exp(-far * 0.012)));
      }
      #include <fog_fragment>`)
    extra?.(shader)
  }
  mat.customProgramCacheKey = () => (extra ? 'sharpen-moving-real-wet' : 'sharpen-real-wet')
}

// Moving the corners of a face (graphics levels, GraphicsLevels.js):
// leaves sway in the wind and water's surface rolls in waves on Ultra.
// Every corner moves by where it is in the world, so faces that share a
// corner stay joined. `uAmount` 0 = still (the other levels) - no extra
// programs, just a number.
function moving(uniforms, topOnly) {
  return (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmount;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uAmount > 0.0${topOnly ? ' && objectNormal.y > 0.5' : ''}) {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          ${topOnly
    ? 'transformed.y += (sin(uTime * 1.7 + wp.x * 1.3 + wp.z * 0.9) + sin(uTime * 1.1 - wp.z * 1.7)) * 0.5 * uAmount;'
    : 'transformed.x += sin(uTime * 1.6 + wp.x * 0.9 + wp.y * 0.6 + wp.z * 0.5) * uAmount;\n          transformed.z += cos(uTime * 1.3 + wp.z * 0.8 + wp.y * 0.5) * uAmount * 0.7;'}
        }`)
  }
}

// 6 faces: normal, 4 corners (cube-local 0/1, counter-clockwise seen from
// outside), texture v points up (+y) on the sides, -z on top/bottom.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.86 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.86 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.7 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.93 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.93 },
]
const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]]
// Water and lava get their own scrolling (animated) texture and a surface
// 2 pixels below the top of the cell, like Minecraft - unless the same
// liquid sits on top, so a column of water stays one continuous body.
const LIQUIDS = {
  water: { speed: 5, surface: 14 / 16 },
  lava: { speed: 1.5, surface: 14 / 16 },
}
// Vertex brightness by how many of the 3 neighbor cells around a corner
// are solid (0 = fully open ... 3 = tucked into a corner).
const AO_LEVELS = [1, 0.78, 0.6, 0.45]

// Glowing blocks (glowstone, lava, lanterns...) light the blocks around
// them by brightening vertex colors when a chunk is built - Minecraft's
// own "block light" idea - instead of real THREE.PointLights. Real lights
// cost every pixel on screen every frame, lit or not (measured ~35% of the
// editor's frame time for 6 of them, 2026-09-30); baked light costs
// nothing per frame. Light goes from the glowing block's center, fades out
// over GLOW_RADIUS blocks, and only reaches faces turned toward it.
const GLOW_RADIUS = 8
const GLOW_STRENGTH = 1.6

// Same stable per-block brightness wobble the instanced path used to roll
// with Math.random() - hashed from the position instead, so a chunk
// rebuild never makes blocks flicker to a new shade.
function tintAt(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return 0.9 + ((h >>> 0) % 1000) / 1000 * 0.16
}

export class BlockChunks {
  // types: BLOCK_TYPES. faces(type) -> { top, side, bottom } canvases.
  // hasAlpha(type) -> the texture carries its own transparency. getType(x,
  // y, z) -> type id or null.
  constructor(scene, { blockSize, types, faces, hasAlpha, getType, liquidHeight, maxAnisotropy = 4, tile = DEFAULT_TILE }) {
    const TILE = tile
    const PAD = TILE / 2
    const SLOT = TILE + PAD * 2
    this.scene = scene
    this.liquidHeight = liquidHeight || (() => LIQUIDS.water.surface)
    this.blockSize = blockSize
    this.getType = getType
    this.info = new Map()
    this.chunks = new Map() // "cx,cy,cz" -> { meshes: [] }
    this.dirty = new Set()
    this.lazy = new Set() // chunks to rebuild a few per frame, nearest first
    this._glow = new Map() // "x,y,z" -> { x, y, z, c: [r, g, b] }
    this._glowByChunk = new Map() // "cx,cy,cz" -> Set of glow entries

    const cube = types.filter((t) => !t.shape)
    const faceSets = cube.map((t) => faces(t))
    const unique = [...new Set(faceSets.flatMap((f) => [f.top, f.side, f.bottom]))]
    this._atlasFrom = { cube, faces }
    // 4096 wide (2048 for small tiles) x exactly as many rows as needed -
    // not rounded up to a power of two (WebGL2 mipmaps any size), which
    // would nearly double the memory.
    const atlasW = TILE >= 64 ? 4096 : 2048
    const perRow = atlasW / SLOT
    const atlasH = Math.ceil(unique.length / perRow) * SLOT
    const canvas = document.createElement('canvas')
    canvas.width = atlasW
    canvas.height = atlasH
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    const uvOf = new Map()
    // One slot per distinct picture.
    const draw = (src, ox, oy) => {
      // A small picture is scaled up crisp (pixel art), a big one down
      // smoothly.
      ctx.imageSmoothingEnabled = src.width > TILE
      ctx.save()
      ctx.beginPath()
      ctx.rect(ox - PAD, oy - PAD, SLOT, SLOT)
      ctx.clip()
      ctx.clearRect(ox - PAD, oy - PAD, SLOT, SLOT)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) ctx.drawImage(src, ox + dx * TILE, oy + dy * TILE, TILE, TILE)
      }
      ctx.restore()
    }
    // Every picture into its slot - again by redrawAtlas, after the
    // texture detail changes (the same blocks give the same slots).
    this._drawAtlas = (pictures) => pictures.forEach((src, i) => draw(src, (i % perRow) * SLOT + PAD, Math.floor(i / perRow) * SLOT + PAD))
    unique.forEach((src, i) => {
      const ox = (i % perRow) * SLOT + PAD
      const oy = Math.floor(i / perRow) * SLOT + PAD
      // Padding around each tile repeats the tile's own opposite edge, so
      // the smaller mipmap levels blend into matching colors instead of
      // bleeding a neighboring block's texture across the seam.
      draw(src, ox, oy)
      // Canvas y runs down, texture v runs up (flipY) - v0 is the bottom.
      const u0 = ox / atlasW
      const u1 = (ox + TILE) / atlasW
      const v1 = 1 - oy / atlasH
      const v0 = 1 - (oy + TILE) / atlasH
      uvOf.set(src, [u0, v0, u1, v1])
    })
    cube.forEach((t, i) => {
      const f = faceSets[i]
      const liquid = LIQUIDS[t.id] ? t.id : null
      this.info.set(t.id, {
        liquid,
        // Indexed like FACES: +x, -x, top, bottom, +z, -z.
        uvs: [uvOf.get(f.side), uvOf.get(f.side), uvOf.get(f.top), uvOf.get(f.bottom), uvOf.get(f.side), uvOf.get(f.side)],
        // Liquids never hide a neighbor's face (the lowered surface would
        // leave a gap) and never darken its corners. Neither does a block
        // drawn narrower than its cell (`inset`, e.g. bamboo).
        opaque: !t.transparent && !liquid && !t.inset,
        // Drawn with the solid blocks (not blended) even when it doesn't
        // hide its neighbors.
        solidDraw: !t.transparent && !liquid,
        // Fraction of the cell left empty on each of the 4 sides.
        inset: t.inset || 0,
        // Glass/leaves carry their own per-pixel alpha in the texture.
        alpha: hasAlpha(t) ? 1 : (t.opacity ?? 1),
        // Leaves' holes are fully see-through or fully solid, so they're
        // drawn cut out (alpha-tested, depth-writing) rather than blended -
        // blending every leaf face over whatever is behind it was the
        // most expensive thing in a tree-filled view on a phone.
        cutout: /leaves$/.test(t.id),
        glow: !!t.emissive,
      })
    })
    const tex = new THREE.CanvasTexture(canvas)
    // Crisp pixels up close (nearest), trilinear mipmaps + full anisotropy
    // far away so the floor doesn't shimmer toward the horizon. Safe with an atlas: the padded power-of-two slots above keep
    // every mip level inside a block's own texture.
    // Since 2026-10-23 ("blurry the further you look"): each mip level is
    // read with nearest pixels too, and one step sharper (SHARPEN), so far
    // blocks keep their pixels instead of smudging into flat colour.
    tex.minFilter = THREE.NearestMipmapLinearFilter
    tex.magFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = maxAnisotropy
    this.atlas = tex

    const liquidTex = (id) => {
      const t = types.find((b) => b.id === id)
      if (!t) return null
      const map = new THREE.CanvasTexture(faces(t).side)
      map.wrapS = map.wrapT = THREE.RepeatWrapping
      map.magFilter = THREE.NearestFilter
      map.minFilter = THREE.LinearMipmapLinearFilter
      map.colorSpace = THREE.SRGBColorSpace
      map.anisotropy = maxAnisotropy
      return map
    }
    const waterMap = liquidTex('water')
    const lavaMap = liquidTex('lava')
    // Sway and waves (moving); `shine` makes the water catch the sun.
    // wet/snow/ice and the roof grid are BuildWeather's (weather on the
    // ground); sky is BuildSky's colour for puddles, haze and water.
    this.fx = {
      time: { value: 0 }, sway: { value: 0 }, waves: { value: 0 }, real: { value: 0 }, block: { value: blockSize },
      wet: { value: 0 }, snow: { value: 0 }, ice: { value: 0 },
      roof: { value: null }, roofOrigin: { value: new THREE.Vector2(1e6, 1e6) }, roofBase: { value: 0 },
      sky: { value: new THREE.Color(0.6, 0.75, 0.95) }, bump: { value: 0 }, haze: { value: 0 }, reflect: { value: 0 },
    }
    this.materials = {
      water: new THREE.MeshPhongMaterial({ map: waterMap, vertexColors: true, transparent: true, depthWrite: false, specular: 0x000000, shininess: 70 }),
      lava: new THREE.MeshLambertMaterial({ map: lavaMap, vertexColors: true, emissive: 0xffffff, emissiveMap: lavaMap, emissiveIntensity: 0.85 }),
      solid: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }),
      glow: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 }),
      clear: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.02 }),
      cutout: new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.5 }),
    }
    for (const id of ['solid', 'glow', 'clear']) sharpen(this.materials[id], this.fx)
    sharpen(this.materials.cutout, this.fx, moving({ uTime: this.fx.time, uAmount: this.fx.sway }, false))
    const waves = moving({ uTime: this.fx.time, uAmount: this.fx.waves }, true)
    // Water mirrors the sky on the realistic levels (uReflect): most when
    // you look across it, hardly at all straight down - like a real lake.
    this.materials.water.onBeforeCompile = (shader) => {
      waves(shader)
      shader.uniforms.uSky = this.fx.sky
      shader.uniforms.uReflect = this.fx.reflect
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSky;\nuniform float uReflect;')
        .replace('#include <fog_fragment>', `if (uReflect > 0.0) {
          float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
          float m = uReflect * (0.15 + 0.75 * fres);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, sRGBTransferOETF(vec4(uSky, 1.0)).rgb, m);
          gl_FragColor.a = mix(gl_FragColor.a, 1.0, m * 0.6);
        }
        #include <fog_fragment>`)
    }
    this.materials.water.customProgramCacheKey = () => 'waves-sky'
  }

  // How much the leaves sway and the water rolls (world units) and how
  // much the water shines (0..1) - set from the graphics level.
  setEffects({ sway = 0, waves = 0, shine = 0, real = 0, bump = 0, haze = 0 } = {}) {
    this.fx.real.value = real
    this.fx.bump.value = bump
    this.fx.haze.value = haze
    this.fx.reflect.value = bump > 0 ? shine * 0.8 : 0
    this.fx.sway.value = sway * this.blockSize
    this.fx.waves.value = waves * this.blockSize
    this.materials.water.specular.setScalar(shine * 0.55)
  }

  // The block pictures changed (Settings > Graphics level): draw the new
  // ones into the same slots. The liquids keep theirs.
  redrawAtlas() {
    const { cube, faces } = this._atlasFrom
    const unique = [...new Set(cube.map((t) => faces(t)).flatMap((f) => [f.top, f.side, f.bottom]))]
    this._drawAtlas(unique)
    this.atlas.needsUpdate = true
  }

  // Liquid animation - steps one texture pixel at a time (Minecraft's own
  // animated textures move in whole-pixel frames, not a smooth slide).
  animate(timeSec) {
    this.fx.time.value = timeSec
    for (const [id, { speed }] of Object.entries(LIQUIDS)) {
      const map = this.materials[id]?.map
      if (map) map.offset.y = Math.floor(timeSec * speed) / 16
    }
  }

  // Adds (colorHex) or removes (null) the glow of a light-giving block at
  // cell (x, y, z), and rebuilds every chunk its light reaches.
  setGlow(x, y, z, colorHex) {
    const key = `${x},${y},${z}`
    const old = this._glow.get(key)
    if (!old && colorHex == null) return
    const ck = `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`
    if (old) {
      this._glow.delete(key)
      this._glowByChunk.get(ck)?.delete(old)
    }
    if (colorHex != null) {
      const entry = { x: x + 0.5, y: y + 0.5, z: z + 0.5, c: [((colorHex >> 16) & 255) / 255, ((colorHex >> 8) & 255) / 255, (colorHex & 255) / 255] }
      this._glow.set(key, entry)
      if (!this._glowByChunk.has(ck)) this._glowByChunk.set(ck, new Set())
      this._glowByChunk.get(ck).add(entry)
    }
    const r = GLOW_RADIUS
    for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) {
      for (let cy = Math.floor((y - r) / CHUNK); cy <= Math.floor((y + r) / CHUNK); cy++) {
        for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + r) / CHUNK); cz++) this.dirty.add(`${cx},${cy},${cz}`)
      }
    }
  }

  // Glow light [r, g, b] reaching a point (cell units) on a face with
  // normal n, or null when none does.
  // Glow sources that can reach a chunk (the 27 chunks around it, kept
  // only if within GLOW_RADIUS of its box) - gathered once per chunk build
  // instead of 27 map lookups for every corner of every face, which made
  // building Map 1's chunks take seconds when Play was pressed.
  _glowSourcesNear(cx, cy, cz) {
    if (this._glow.size === 0) return null
    const R = GLOW_RADIUS
    const lo = [cx * CHUNK - R, cy * CHUNK - R, cz * CHUNK - R]
    const hi = [(cx + 1) * CHUNK + R, (cy + 1) * CHUNK + R, (cz + 1) * CHUNK + R]
    const list = []
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const set = this._glowByChunk.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (!set) continue
          for (const s of set) {
            if (s.x >= lo[0] && s.x <= hi[0] && s.y >= lo[1] && s.y <= hi[1] && s.z >= lo[2] && s.z <= hi[2]) list.push(s)
          }
        }
      }
    }
    return list.length ? list : null
  }

  _glowAt(px, py, pz, n, sources = this._glowSourcesNear(Math.floor(px / CHUNK), Math.floor(py / CHUNK), Math.floor(pz / CHUNK))) {
    if (!sources) return null
    let r = 0
    let g = 0
    let b = 0
    const R = GLOW_RADIUS
    for (const s of sources) {
      const lx = s.x - px
      const ly = s.y - py
      const lz = s.z - pz
      const d = Math.sqrt(lx * lx + ly * ly + lz * lz)
      if (d >= R) continue
      const facing = d > 0 ? (n[0] * lx + n[1] * ly + n[2] * lz) / d : 1
      if (facing <= 0) continue
      const fall = 1 - d / R
      const k = fall * fall * (0.35 + 0.65 * facing) * GLOW_STRENGTH
      r += s.c[0] * k
      g += s.c[1] * k
      b += s.c[2] * k
    }
    if (r + g + b < 0.005) return null
    return [Math.min(r, 1.5), Math.min(g, 1.5), Math.min(b, 1.5)]
  }

  // Heights of a liquid cell's 4 top corners, indexed cornerX * 2 + cornerZ.
  _liquidCorners(x, y, z, type) {
    if (this.getType(x, y + 1, z) === type) return [1, 1, 1, 1]
    const out = [0, 0, 0, 0]
    for (let cx = 0; cx <= 1; cx++) {
      for (let cz = 0; cz <= 1; cz++) {
        let sum = 0
        let n = 0
        let full = false
        for (let i = -1; i <= 0 && !full; i++) {
          for (let j = -1; j <= 0; j++) {
            const nx = x + cx + i
            const nz = z + cz + j
            if (this.getType(nx, y, nz) !== type) continue
            if (this.getType(nx, y + 1, nz) === type) {
              full = true
              break
            }
            sum += this.liquidHeight(nx, y, nz)
            n++
          }
        }
        out[cx * 2 + cz] = full ? 1 : sum / n
      }
    }
    return out
  }

  isLiquid(type) {
    return !!this.info.get(type)?.liquid
  }

  isChunkType(type) {
    return this.info.has(type)
  }

  // Call after any block change at (x, y, z) - also marks the neighbor
  // chunk(s) when the cell sits on a chunk border, since their outer faces
  // and corner shading depend on it.
  markDirty(x, y, z) {
    const cx = Math.floor(x / CHUNK)
    const cy = Math.floor(y / CHUNK)
    const cz = Math.floor(z / CHUNK)
    const lx = x - cx * CHUNK
    const ly = y - cy * CHUNK
    const lz = z - cz * CHUNK
    for (const dx of [lx === 0 ? -1 : 0, 0, lx === CHUNK - 1 ? 1 : 0]) {
      for (const dy of [ly === 0 ? -1 : 0, 0, ly === CHUNK - 1 ? 1 : 0]) {
        for (const dz of [lz === 0 ? -1 : 0, 0, lz === CHUNK - 1 ? 1 : 0]) {
          this.dirty.add(`${cx + dx},${cy + dy},${cz + dz}`)
        }
      }
    }
  }

  // A chunk the open world grew or dropped land in (OpenWorld.js): rebuilt
  // soon, a few per frame, nearest the player first - not all at once.
  markLazy(key) {
    if (!this.dirty.has(key)) this.lazy.add(key)
  }

  // The open world dropped every block in this chunk.
  dropChunk(key) {
    this._disposeChunk(key)
    this.dirty.delete(key)
    this.lazy.delete(key)
  }

  // Rebuilds every dirty chunk. Cheap enough to run every frame: a normal
  // click dirties 1-4 chunks, and a full load is a one-off. Lazy chunks
  // (the open world's) get LAZY_BUDGET_MS per frame, nearest `focus` (x/z
  // in blocks) first.
  // Returns true if any chunk was rebuilt.
  flush(blocksByChunk, focus = null) {
    let built = false
    if (this.dirty.size) {
      for (const key of this.dirty) {
        this._build(key, blocksByChunk.get(key))
        this.lazy.delete(key)
      }
      this.dirty.clear()
      built = true
    }
    if (this.lazy.size) {
      const until = performance.now() + LAZY_BUDGET_MS
      const fx = focus ? focus.x / CHUNK : 0
      const fz = focus ? focus.z / CHUNK : 0
      const order = [...this.lazy].map((key) => {
        const [cx, , cz] = key.split(',').map(Number)
        return [(cx + 0.5 - fx) ** 2 + (cz + 0.5 - fz) ** 2, key]
      }).sort((a, b) => a[0] - b[0])
      for (const [, key] of order) {
        this._build(key, blocksByChunk.get(key))
        this.lazy.delete(key)
        built = true
        if (performance.now() > until) break
      }
    }
    return built
  }

  // Every built chunk again, on the next flush (their uploaded copies are
  // gone after a lost graphics connection - see dropAfterUpload).
  rebuildAll() {
    for (const key of this.chunks.keys()) this.dirty.add(key)
  }

  clear() {
    for (const key of [...this.chunks.keys()]) this._disposeChunk(key)
    this.dirty.clear()
    this.lazy.clear()
    this._glow.clear()
    this._glowByChunk.clear()
  }

  _disposeChunk(key) {
    const chunk = this.chunks.get(key)
    if (!chunk) return
    for (const mesh of chunk.meshes) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
    }
    this.chunks.delete(key)
  }

  // cells: Set of "x,y,z" keys inside this chunk (BuildMode's
  // _chunkCells).
  _build(key, cells) {
    this._disposeChunk(key)
    if (!cells || cells.size === 0) return
    const [cx, cy, cz] = key.split(',').map(Number)
    const bx = cx * CHUNK
    const by = cy * CHUNK
    const bz = cz * CHUNK
    const out = { solid: newBuffers(3), glow: newBuffers(3), cutout: newBuffers(3), clear: newBuffers(4), water: newBuffers(4), lava: newBuffers(3) }
    const glowSources = this._glowSourcesNear(cx, cy, cz)
    // Each cell of the chunk and the one-cell ring around it is looked up
    // at most once per build (2026-10-17 lag hunt): a visible face reads
    // its neighbor and 12 corner cells for shading, so the same cells were
    // fetched from the block map over and over while new land streamed in.
    const pad = this._pad || (this._pad = new Array(PAD * PAD * PAD))
    pad.fill(UNREAD)
    const typeAt = (x, y, z) => {
      const lx = x - bx + 1, ly = y - by + 1, lz = z - bz + 1
      if (lx < 0 || ly < 0 || lz < 0 || lx >= PAD || ly >= PAD || lz >= PAD) return this.getType(x, y, z)
      const i = (ly * PAD + lz) * PAD + lx
      let t = pad[i]
      if (t === UNREAD) pad[i] = t = this.getType(x, y, z) ?? null
      return t
    }
    const opaqueAt = (x, y, z) => {
      const t = typeAt(x, y, z)
      return !!t && !!this.info.get(t)?.opaque
    }
    for (const cell of cells) {
      const c1 = cell.indexOf(','), c2 = cell.indexOf(',', c1 + 1)
      const x = +cell.slice(0, c1), y = +cell.slice(c1 + 1, c2), z = +cell.slice(c2 + 1)
      const type = typeAt(x, y, z)
      const info = type && this.info.get(type)
      if (!info) continue
      const buf = info.liquid ? out[info.liquid] : info.solidDraw ? (info.glow ? out.glow : out.solid) : info.cutout ? out.cutout : out.clear
      const inset = info.inset
      const tint = info.liquid ? 1 : tintAt(x, y, z)
      // Liquid surfaces slope: each top corner is the average height of
      // the (up to 4) cells of the same liquid sharing it, and a corner
      // touching liquid with more of it on top is full - so flowing water
      // runs smoothly downhill from its source, like Minecraft.
      const cornerY = info.liquid ? this._liquidCorners(x, y, z, type) : null
      for (let fi = 0; fi < 6; fi++) {
        const face = FACES[fi]
        const [nx, ny, nz] = face.n
        const nType = typeAt(x + nx, y + ny, z + nz)
        // A narrow block's sides stand clear of its neighbors - always drawn.
        if (nType && !(inset && ny === 0)) {
          const nInfo = this.info.get(nType)
          // Hidden behind a solid cube, or glass against the same glass.
          if (nInfo && (nInfo.opaque || nType === type)) continue
        }
        let [u0, v0, u1, v1] = info.liquid ? [0, 0, 1, 1] : info.uvs[fi]
        if (inset) {
          // The texture is cropped to the narrower face, not squeezed.
          const du = (u1 - u0) * inset
          u0 += du
          u1 -= du
          if (ny !== 0) {
            const dv = (v1 - v0) * inset
            v0 += dv
            v1 -= dv
          }
        }
        const ao = [0, 0, 0, 0]
        for (let i = 0; i < 4; i++) {
          const c = face.c[i]
          // The two in-plane axes' step toward this corner, taken in the
          // air layer just outside the face.
          const ox = x + nx
          const oy = y + ny
          const oz = z + nz
          const sx = nx === 0 ? (c[0] ? 1 : -1) : 0
          const sy = ny === 0 ? (c[1] ? 1 : -1) : 0
          const sz = nz === 0 ? (c[2] ? 1 : -1) : 0
          let s1, s2
          if (nx !== 0) {
            s1 = opaqueAt(ox, oy + sy, oz)
            s2 = opaqueAt(ox, oy, oz + sz)
          } else if (ny !== 0) {
            s1 = opaqueAt(ox + sx, oy, oz)
            s2 = opaqueAt(ox, oy, oz + sz)
          } else {
            s1 = opaqueAt(ox + sx, oy, oz)
            s2 = opaqueAt(ox, oy + sy, oz)
          }
          const corner = opaqueAt(ox + sx, oy + sy, oz + sz)
          ao[i] = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (corner ? 1 : 0)
        }
        const base = buf.pos.length / 3
        for (let i = 0; i < 4; i++) {
          const c = face.c[i]
          const topY = cornerY ? cornerY[c[0] * 2 + c[2]] : 1
          const cx0 = inset ? inset + c[0] * (1 - 2 * inset) : c[0]
          const cz0 = inset ? inset + c[2] * (1 - 2 * inset) : c[2]
          buf.pos.push((x - bx + cx0) * this.blockSize, (y - by + (c[1] ? topY : 0)) * this.blockSize, (z - bz + cz0) * this.blockSize)
          buf.nrm.push(nx, ny, nz)
          buf.uv.push(CORNER_UV[i][0] ? u1 : u0, CORNER_UV[i][1] ? v1 : v0)
          const b = AO_LEVELS[ao[i]] * face.shade * tint
          const L = glowSources && this._glowAt(x + c[0], y + c[1] * topY, z + c[2], face.n, glowSources)
          const cr = L ? b * (1 + L[0]) : b
          const cg = L ? b * (1 + L[1]) : b
          const cb = L ? b * (1 + L[2]) : b
          if (buf.stride === 4) buf.col.push(cr, cg, cb, info.alpha)
          else buf.col.push(cr, cg, cb)
        }
        // Split the quad along the diagonal whose corners are shaded more
        // alike, or the corner darkening shows a visible crease.
        if (ao[0] + ao[2] > ao[1] + ao[3]) {
          buf.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base)
        } else {
          buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
        }
      }
    }
    const meshes = []
    for (const kind of ['solid', 'glow', 'cutout', 'clear', 'water', 'lava']) {
      const buf = out[kind]
      if (buf.idx.length === 0) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, buf.stride))
      geo.setIndex(buf.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(buf.idx, 1) : new THREE.Uint16BufferAttribute(buf.idx, 1))
      geo.computeBoundingSphere()
      const mesh = new THREE.Mesh(geo, this.materials[kind])
      for (const attr of Object.values(geo.attributes)) attr.onUpload(dropAfterUpload)
      geo.index.onUpload(cullAfterUpload)
      geo.index.mesh = mesh
      mesh.frustumCulled = false
      mesh.position.set(bx * this.blockSize, by * this.blockSize, bz * this.blockSize)
      mesh.castShadow = kind === 'solid' || kind === 'glow' || kind === 'cutout'
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      this.scene.add(mesh)
      meshes.push(mesh)
    }
    // Chunk middle in blocks, for cullTo().
    const chunk = { meshes, mx: bx + CHUNK / 2, mz: bz + CHUNK / 2, shown: true }
    this.chunks.set(key, chunk)
    if (this._cull) this._cullChunk(chunk)
  }

  // View distance: hides every chunk whose nearest edge is more than
  // `blocks` away (sideways) from x/z (in blocks), so far parts of a big
  // map cost nothing to draw - the scene's fog fades out what's left
  // before that edge. Infinity shows everything.
  cullTo(x, z, blocks) {
    const c = this._cull || (this._cull = {})
    const moved = c.x === undefined || Math.abs(c.x - x) >= 2 || Math.abs(c.z - z) >= 2 || c.blocks !== blocks
    if (!moved) return
    c.x = x
    c.z = z
    c.blocks = blocks
    for (const chunk of this.chunks.values()) this._cullChunk(chunk)
  }

  _cullChunk(chunk) {
    const c = this._cull
    // Nearest edge of the chunk's square, not its middle.
    const dx = Math.max(0, Math.abs(chunk.mx - c.x) - CHUNK / 2)
    const dz = Math.max(0, Math.abs(chunk.mz - c.z) - CHUNK / 2)
    const shown = dx * dx + dz * dz <= c.blocks * c.blocks
    if (shown === chunk.shown) return
    chunk.shown = shown
    for (const mesh of chunk.meshes) mesh.visible = shown
  }
}

function newBuffers(stride) {
  return { pos: [], nrm: [], uv: [], col: [], idx: [], stride }
}
