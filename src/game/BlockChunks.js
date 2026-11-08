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
import { REAL_GROUND, REAL_LEAVES, REAL_LOG, REAL_ROCK, NOT_ROCK, REC, AIR, REAL, PIN_SOLID, lookOf, kindOfLook, PIN_OTHER, LEAF_LOOK, K_LEAF, latticeAt, realPoint, realTint, rockTint, logRadius } from './RealGround.js'

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
// playing it"): the pixels stay sharp but get a fine grain inside them up
// close, like real stone, dirt and wood (2026-10-26, Gaymi: "the texture
// got better but it gets kinda blurry" - they used to be smoothed by
// averaging four samples a pixel apart), the corners where blocks meet
// shade deeper, the ground's colour drifts in big soft patches across the world
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
// uGrade (the finishing colour) and uAo (corner shade) used to be part of
// uReal; split out 2026-10-26 so the cheaper levels get some of them too.
// uSpec: the sun glinting off blocks, mostly off wet ground and puddles -
// added straight to the sun's light after its shadow, so shaded spots
// never glint.
// Faster too (same day): the big soft colour patches are worked out per
// corner (vPatch) instead of per pixel - they're far bigger than a block -
// and the fine grain is skipped beyond where you could see it.
const NOISE_GLSL = `float realHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float realNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(realHash(i), realHash(i + vec3(1, 0, 0)), f.x), mix(realHash(i + vec3(0, 1, 0)), realHash(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(realHash(i + vec3(0, 0, 1)), realHash(i + vec3(1, 0, 1)), f.x), mix(realHash(i + vec3(0, 1, 1)), realHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }`
function sharpen(mat, fx, extra = null) {
  mat.onBeforeCompile = (shader) => {
    for (const k of ['real', 'block', 'wet', 'snow', 'ice', 'roof', 'roofOrigin', 'roofBase', 'sky', 'bump', 'haze', 'grade', 'ao', 'spec', 'round']) {
      shader.uniforms[`u${k[0].toUpperCase()}${k.slice(1)}`] = fx[k]
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
      varying vec3 vWPos;
      varying vec3 vWNorm;
      varying float vPatch;
      attribute float aEdge;
      varying float vEdge;
      uniform float uReal;
      uniform float uBlock;
      ${NOISE_GLSL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWNorm = objectNormal;
      vEdge = aEdge;
      vPatch = 0.5;
      if (uReal > 0.0) {
        vec3 pw = vWPos / uBlock;
        vPatch = realNoise(pw * 0.11) * 0.65 + realNoise(pw * 0.37) * 0.35;
      }`)
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
      uniform float uGrade;
      uniform float uAo;
      uniform float uSpec;
      uniform float uRound;
      varying vec3 vWPos;
      varying vec3 vWNorm;
      varying float vPatch;
      varying float vEdge;
      // How far (0..1) a face edge bends round, by the distance f (in
      // blocks) to it and whether that edge is an outside corner.
      float roundEdge(float f, float m, float bitv) {
        return step(0.5, mod(floor(m / bitv), 2.0)) * (1.0 - smoothstep(0.0, 0.16, f));
      }
      // 1 = open to the sky here, 0 = under a roof (wp in blocks).
      float openCell(vec2 cell, float y) {
        cell -= uRoofOrigin;
        if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= ${ROOF_GRID.toFixed(1)} || cell.y >= ${ROOF_GRID.toFixed(1)}) return 1.0;
        float top = texture2D(uRoof, (cell + 0.5) / ${ROOF_GRID.toFixed(1)}).r * 255.0;
        if (top < 0.5) return 1.0;
        return step(uRoofBase + top - 0.1, y);
      }
      // Blended over the 4 nearest cells, so wet ground and puddles end in
      // soft rounded shapes, not square block corners (2026-10-26, Gaymi).
      float openSky(vec3 wp, vec3 n) {
        vec2 p = wp.xz + n.xz * 0.5 - 0.5;
        vec2 c = floor(p);
        vec2 f = smoothstep(0.0, 1.0, fract(p));
        float o = mix(mix(openCell(c, wp.y), openCell(c + vec2(1.0, 0.0), wp.y), f.x),
          mix(openCell(c + vec2(0.0, 1.0), wp.y), openCell(c + vec2(1.0), wp.y), f.x), f.y);
        return smoothstep(0.3, 0.7, o);
      }
      ${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
      vec4 texel = texture2D( map, vMapUv, ${SHARPEN.toFixed(2)} );
      if (uReal > 0.0) {
        vec3 wp = vWPos / uBlock;
        // Grain finer than a pixel, up close only (far off it would shimmer).
        float grainNear = 1.0 - smoothstep(6.0, 22.0, length(vViewPosition) / uBlock);
        if (grainNear > 0.0) {
          float grain = realNoise(wp * 47.0) * 0.6 + realNoise(wp * 13.0) * 0.4;
          texel.rgb *= 1.0 + (grain - 0.5) * 0.2 * uReal * grainNear;
        }
        texel.rgb *= 1.0 + (vPatch - 0.5) * 0.3 * uReal;
      }
      diffuseColor *= texel;
    #endif
      #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
      if (uAo > 0.0) {
        // Deeper shade in corners and under overhangs (the corner shading
        // the mesher puts in the vertex colours, taken further).
        float shadeV = clamp(max(vColor.r, max(vColor.g, vColor.b)), 0.0, 1.0);
        diffuseColor.rgb *= mix(1.0, shadeV, uAo);
      }
      #endif
      float puddle = 0.0;
      float wetNow = 0.0;
      if (uWet + uSnow + uIce > 0.0) {
        vec3 wp = vWPos / uBlock;
        float open = openSky(wp, vWNorm);
        float up = step(0.5, vWNorm.y) * open;
        float wet = uWet * open;
        wetNow = wet;
        diffuseColor.rgb *= 1.0 - 0.32 * wet * (0.6 + 0.4 * up);
        // Puddles: low, flat spots in big soft patches, growing as it rains.
        float pn = realNoise(vec3(wp.xz * 0.45, 3.0)) * 0.7 + realNoise(vec3(wp.xz * 1.7, 9.0)) * 0.3;
        puddle = up * smoothstep(0.78 - 0.3 * uWet, 0.86 - 0.3 * uWet, pn) * uWet;
        diffuseColor.rgb *= 1.0 - 0.35 * puddle;
        // Snow: patches that join up into a white blanket.
        float sn = realNoise(vec3(wp.xz * 1.3, 1.0)) * 0.6 + realNoise(vec3(wp.xz * 4.1, 5.0)) * 0.4;
        float cover = up * smoothstep(1.0 - uSnow * 1.15, 1.08 - uSnow * 1.15, sn);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.99) * (0.92 + 0.08 * sn), cover);
        // Hail: little round ice stones lying about, each a different
        // size, with a lighter top.
        vec2 hc = wp.xz * 9.0;
        vec3 hcell = vec3(floor(hc), floor(wp.y));
        float stone = realHash(hcell);
        vec2 hat = vec2(realHash(hcell + 7.0), realHash(hcell + 13.0)) * 0.5 + 0.25;
        float hd = length(fract(hc) - hat) / (0.16 + 0.18 * realHash(hcell + 3.0));
        float pellet = up * step(1.0 - uIce * 0.22, stone) * (1.0 - smoothstep(0.75, 1.0, hd)) * (1.0 - cover);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.9, 0.97) + 0.08 * (1.0 - hd), pellet);
        puddle *= 1.0 - cover;
        wetNow *= 1.0 - cover;
      }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
      if (uSpec > 0.0) {
        // directLight is the sun here, already dimmed by its shadow.
        vec3 hv = normalize(directLight.direction + geometryViewDir);
        float nh = max(dot(geometryNormal, hv), 0.0);
        // vEdge below 0: the block's own gloss (real-life wet mud).
        float glossy = clamp(wetNow * 0.7 + puddle + max(-vEdge, 0.0), 0.0, 1.0);
        float sp = pow(nh, mix(20.0, 160.0, glossy)) * mix(0.07, 1.5, glossy);
        #ifdef USE_MAP
        // Real-life snow (sixth batch) sparkles: a light picture with snow's
        // little gloss (0.08..0.3 on aEdge) gets tiny glints that blink on
        // and off as you move, up close only.
        float own = max(-vEdge, 0.0);
        float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        float snowy = smoothstep(0.06, 0.12, own) * (1.0 - smoothstep(0.3, 0.4, own)) * smoothstep(0.62, 0.8, lum);
        if (snowy > 0.0) {
          vec3 gc = floor(vWPos / uBlock * 26.0);
          vec3 vq = floor(normalize(vViewPosition) * 9.0);
          float glint = step(0.96, realHash(gc)) * step(0.55, realHash(gc + vq * 3.1));
          float near = 1.0 - smoothstep(6.0, 20.0, length(vViewPosition) / uBlock);
          sp += glint * snowy * near * 2.5;
        }
        #endif
        reflectedLight.directDiffuse += directLight.color * sp * uSpec * step(0.0, dot(geometryNormal, directLight.direction));
      }
      #endif`)
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
        // Capped so a sharp pixel edge doesn't flash as a thin white dash
        // (2026-10-26, Gaymi's rain screenshots).
        dh = clamp(dh, vec2(-0.12), vec2(0.12));
        normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
      }
      #endif
      if (uRound > 0.0 && vEdge > 0.5) {
        // Rounded block edges (2026-10-26, Gaymi: "make the blocks not all
        // so blocky"): near an outside edge the face's light bends round
        // the corner, like a worn, rounded block. vEdge says which of the
        // face's 4 edges are outside corners (BlockChunks._build).
        vec3 wp = vWPos / uBlock;
        vec3 an = abs(vWNorm);
        vec3 ax = an.x > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 bx = an.z > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
        float fa = fract(dot(wp, ax));
        float fb = fract(dot(wp, bx));
        vec3 bend = ax * (roundEdge(1.0 - fa, vEdge, 2.0) - roundEdge(fa, vEdge, 1.0))
          + bx * (roundEdge(1.0 - fb, vEdge, 8.0) - roundEdge(fb, vEdge, 4.0));
        normal = normalize(normal + (viewMatrix * vec4(bend, 0.0)).xyz * uRound * 1.3);
        diffuseColor.rgb *= 1.0 - 0.1 * uRound * length(bend);
      }`)
      .replace('#include <fog_fragment>', `if (uGrade > 0.0) {
        vec3 c = gl_FragColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.0 + 0.18 * uGrade);
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.35 * uGrade);
        c *= mix(vec3(1.0), vec3(1.04, 1.01, 0.96), uGrade);
        // Bright spots roll off softly instead of clipping flat white
        // (sun glints, snow), like a camera - the top levels only.
        float over = max(0.0, uGrade - 0.6) * 2.5;
        c = mix(c, c / (1.0 + max(c - 0.8, 0.0) * 1.5), over);
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
// How far real-life water reaches under a solid bank (blocks), so it
// always meets the bank's rounded-off edge.
const SHORE_REACH = 0.45

// Less blocky land (2026-10-26, Gaymi: "make the blocks not all so blocky
// ... make them have more possible shapes", on Realistic, Ultra and In
// Real Life). Only the drawing changes - every block is still a full cube
// to walk on, dig and build with.
//  - Bumpy tops: the top of every solid block is a gently lumpy 3x3 patch
//    whose edges stay at the block's own height, so you can always tell
//    one block from the next and see where to jump or dig. (Smooth hills
//    that ran blocks together into ramps were dropped the same day -
//    Gaymi: "you cant really tell what block it is".)
//  - Rounded edges: outside edges catch the light as if rounded (the
//    uRound shader part, aEdge says which edges).
//  - Extra shapes: little stones lying on the ground and leaves sticking
//    out of the sides of trees.
const NATURAL = /^(grass|dirt|sand|snow|stone|gravel|mud|clay|moss|mycelium|podzol|coarsedirt|redsand|granite|andesite|diorite|deepslate|tuff|calcite|netherrack|endstone|soulsand|soulsoil|crimsonnylium|warpednylium|terracotta|packedmud)$/
// How high the lumps inside a bumpy top rise above its edges (blocks).
// Inside points sit at least ~0.23 from each other and ~0.28 from the
// edge, so the steepest bit stays under 20 degrees (tan 20 = 0.36):
// 0.08 / 0.23 and 0.1 / 0.28 are both about 0.35.
// The steepest a bump gets (degrees) - GayZ Features shows it.
export const BUMP_MAX_DEGREES = 20
const BUMP_MIN = 0.02
const BUMP_RANGE = 0.08
const PEBBLE_ON = /^(grass|dirt|sand|gravel|mud|coarsedirt|podzol|redsand|snow|moss)$/
// Real ground whose top picture (grass, fungus, needles) runs down a
// one-block step instead of showing the bare side (_realCell).
const GRASSY_TOP = /^(grass|mycelium|podzol|crimsonnylium|warpednylium)$/

// A stable 0..1 number for a cell (and a salt), for where the extra
// shapes go.
function hash01(x, y, z, salt) {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (salt * 2654435761)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

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
    // The atlas at `scale` x its size (In Real Life's 64x64 pictures,
    // 2026-10-26): same layout, so every block's texture coordinates stay
    // the same and nothing has to be rebuilt - only the pictures redrawn.
    const makeCanvas = (scale) => {
      const c = document.createElement('canvas')
      c.width = atlasW * scale
      c.height = atlasH * scale
      return c
    }
    let canvas = makeCanvas(1)
    let ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    let scale = 1
    const uvOf = new Map()
    // One slot per distinct picture.
    const draw = (src, ox, oy) => {
      const t = TILE * scale
      ox *= scale
      oy *= scale
      // A small picture is scaled up crisp (pixel art), a big one down
      // smoothly.
      ctx.imageSmoothingEnabled = src.width > t
      ctx.save()
      ctx.beginPath()
      ctx.rect(ox - PAD * scale, oy - PAD * scale, SLOT * scale, SLOT * scale)
      ctx.clip()
      ctx.clearRect(ox - PAD * scale, oy - PAD * scale, SLOT * scale, SLOT * scale)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) ctx.drawImage(src, ox + dx * t, oy + dy * t, t, t)
      }
      ctx.restore()
    }
    // Every picture into its slot - again by redrawAtlas, after the
    // texture detail changes (the same blocks give the same slots).
    this._drawAtlas = (pictures, wantScale = 1) => {
      if (wantScale !== scale) {
        scale = wantScale
        canvas = makeCanvas(scale)
        ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        if (this.atlas) {
          this.atlas.dispose()
          this.atlas.image = canvas
        }
      }
      pictures.forEach((src, i) => draw(src, (i % perRow) * SLOT + PAD, Math.floor(i / perRow) * SLOT + PAD))
    }
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
    this.shapes = false
    // Real-life ground strength (RealGround.js, 0 = plain blocks).
    this.realAmt = 0
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
        cutout: /leaves$/.test(t.id) || !!t.plant,
        // Coral/seagrass: two crossed pictures, not a cube (_plant).
        plant: !!t.plant,
        glow: !!t.emissive,
        // Ground that smooths into hills (NATURAL).
        natural: NATURAL.test(t.id) && !t.transparent && !liquid && !t.inset,
        // Drawn as real-life ground on the top levels (RealGround.js).
        // Plain ice is see-through but still joins (sixth batch): drawn
        // with the see-through blocks, its own alpha kept.
        real: (REAL_GROUND.test(t.id) || (REAL_ROCK.test(t.id) && !NOT_ROCK.test(t.id) && !t.emissive)) && (!t.transparent || t.id === 'ice') && !liquid && !t.inset,
        // Real ground with the rock look (RealGround.js, third batch).
        rock: lookOf(t.id) === 'rock' && !t.emissive,
        // Its real-ground look ('dirt', 'rock', 'sand', 'gravel', 'mud'...)
        // and that look's kind code for the corner points (_kindOf).
        look: lookOf(t.id),
        lookKind: kindOfLook(t.emissive ? 'dirt' : lookOf(t.id)),
        // Joined into one bushy treetop / drawn as a round trunk on the
        // top levels (RealGround.js, second batch).
        leaf: REAL_LEAVES.test(t.id) && !liquid && !t.plant,
        log: REAL_LOG.test(t.id) && !t.transparent && !liquid && !t.inset,
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
    if (unique.some((u) => u.width >= 64)) this.redrawAtlas()

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
      grade: { value: 0 }, ao: { value: 0 }, spec: { value: 0 }, round: { value: 0 },
      realWater: { value: 0 },
    }
    this.materials = {
      water: new THREE.MeshPhongMaterial({ map: waterMap, vertexColors: true, transparent: true, depthWrite: false, specular: 0x000000, shininess: 140 }),
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
      shader.uniforms.uBlock = this.fx.block
      shader.uniforms.uRealWater = this.fx.realWater
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nattribute vec2 aWater;\nvarying float vShore;\nvarying vec2 vCell;\nvarying float vTop;\nvarying vec2 vWater;\nvarying float vWy;\nvarying vec2 vSwell;\nuniform float uRealWater;\nuniform float uBlock;')
        .replace('#include <project_vertex>', `
        // Real-life water (2026-11-08, top 3 levels): a long, slow swell
        // rolls across the whole surface on top of the small waves, and
        // its slope (vSwell) tips the light so the swells catch the sun.
        vSwell = vec2(0.0);
        if (uRealWater > 0.0 && uAmount > 0.0 && objectNormal.y > 0.5 && aWater.y < -0.5) {
          // The edge reaching under a bank stays put (no small waves
          // either), so a wave never lifts the water over the bank.
          vec4 wq = modelMatrix * vec4(transformed, 1.0);
          transformed.y -= (sin(uTime * 1.7 + wq.x * 1.3 + wq.z * 0.9) + sin(uTime * 1.1 - wq.z * 1.7)) * 0.5 * uAmount;
        } else if (uRealWater > 0.0 && uAmount > 0.0 && objectNormal.y > 0.5) {
          vec2 q = (modelMatrix * vec4(transformed, 1.0)).xz / uBlock;
          float a1 = dot(q, vec2(0.8, 0.6)) * 0.55 + uTime * 0.9;
          float a2 = dot(q, vec2(-0.45, 0.9)) * 0.8 + uTime * 1.25;
          // Calmer near the shore (shallow corners), full swell out deep.
          float amp = uAmount * uRealWater * (aWater.x >= 0.0 ? clamp(aWater.x * 1.2, 0.25, 1.0) : 1.0);
          transformed.y += (sin(a1) * 0.6 + sin(a2) * 0.4) * amp;
          vSwell = (vec2(0.8, 0.6) * (0.55 * 0.6) * cos(a1) + vec2(-0.45, 0.9) * (0.8 * 0.4) * cos(a2)) * amp / uBlock;
        }
        #include <project_vertex>
        vWater = vec2(aWater.x, max(aWater.y, 0.0));
        vWy = (modelMatrix * vec4(transformed, 1.0)).y / uBlock;
        vShore = objectNormal.y > 0.5 ? aEdge : 0.0;
        vTop = objectNormal.y > 0.5 ? 1.0 : 0.0;
        vCell = (modelMatrix * vec4(position, 1.0)).xz;`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        uniform vec3 uSky;
        uniform float uReflect;
        uniform float uBlock;
        uniform float uTime;
        uniform float uRealWater;
        varying float vShore;
        varying vec2 vCell;
        varying float vTop;
        varying vec2 vWater;
        varying float vWy;
        varying vec2 vSwell;
        // Real-looking water (2026-10-26, Gaymi: "make water texture more
        // clear and clean ... looks so fake"): on Balanced and up the
        // surface is no longer the striped block picture repeated per
        // block - it's one smooth body of water with small rolling
        // ripples worked out from where it is in the world (so no square
        // seams between blocks). ripple() -> (height, slope x, slope z).
        vec3 ripple(vec2 p, float t) {
          vec3 r = vec3(0.0);
          vec2 d[4];
          d[0] = vec2(0.8, 0.6); d[1] = vec2(-0.5, 0.86); d[2] = vec2(0.96, -0.28); d[3] = vec2(-0.3, -0.95);
          float k[4];
          k[0] = 1.3; k[1] = 2.1; k[2] = 3.7; k[3] = 5.3;
          for (int i = 0; i < 4; i++) {
            float a = 0.5 / k[i];
            float ph = dot(d[i], p) * k[i] + t * (1.0 + 0.35 * float(i));
            r.x += sin(ph) * a;
            r.yz += d[i] * cos(ph) * a * k[i];
          }
          return r;
        }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uReflect > 0.0 && vTop > 0.5) {
          // Tilt the surface by the ripples' slope, so the sun glints off
          // the wave sides and the sky mirror wobbles.
          vec3 tilt = vec3(-wr.y, 0.0, -wr.z) * 0.16 + vec3(-vSwell.x, 0.0, -vSwell.y) * 3.0;
          normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz);
        }`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        vec3 wr = uReflect > 0.0 ? ripple(vCell / uBlock, uTime) : vec3(0.0);
        if (uReflect > 0.0) {
          // Clean colour: deep blue-green in the troughs, lighter on the
          // crests, and see-through enough to make out the bottom.
          float crest = clamp(wr.x * 0.9 + 0.5, 0.0, 1.0);
          vec3 deep = vec3(0.0, 0.2, 0.45);
          vec3 light = vec3(0.04, 0.48, 0.66);
          diffuseColor.rgb = mix(deep, light, crest * vTop + (1.0 - vTop) * 0.4) * max(vColor.r, max(vColor.g, vColor.b)) * 1.15;
          diffuseColor.a = vTop > 0.5 ? 0.7 + 0.08 * crest : 0.72;
          float lit = max(vColor.r, max(vColor.g, vColor.b)) * 1.15;
          if (uRealWater > 0.0 && vTop > 0.5 && vWater.x >= 0.0) {
            // Real-life water: clear green shallows you see the bottom
            // through, fading into dark blue deeps (vWater.x: depth in
            // blocks at this point)...
            float dep = sqrt(clamp(vWater.x / 5.0, 0.0, 1.0));
            vec3 col = mix(vec3(0.1, 0.52, 0.48), vec3(0.0, 0.1, 0.32), dep);
            diffuseColor.rgb = mix(col, col * 1.3 + 0.04, crest * 0.6) * lit;
            diffuseColor.a = mix(0.3, 0.9, dep) + 0.05 * crest;
            // ...a ragged line of foam where it runs shallow at the shore...
            vec2 c = vCell / uBlock;
            float fn = 0.5 + 0.5 * sin(c.x * 9.0 + wr.x * 6.0 + uTime * 1.3) * sin(c.y * 8.0 - uTime * 1.1);
            float foam = (1.0 - smoothstep(0.02, 0.09 + 0.08 * fn, vWater.x)) * 0.7;
            // ...and white, churning splash where a waterfall lands.
            float spl = vWater.y * (0.6 + 0.4 * sin(uTime * 7.0 + c.x * 13.0) * sin(uTime * 5.0 - c.y * 11.0));
            foam = max(foam, spl * 0.9);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 0.98) * max(lit, 0.6), foam);
            diffuseColor.a = max(diffuseColor.a, foam * 0.92);
          } else if (uRealWater > 0.0 && vTop < 0.5) {
            // Water running down a drop is a waterfall: pale streaks
            // pouring downward.
            float u = (vCell.x + vCell.y) / uBlock;
            float st = 0.5 + 0.5 * sin(u * 21.0 + sin(u * 5.0) * 3.0);
            float fl = fract(vWy * 0.7 + uTime * 1.8 + st * 0.6);
            float streak = smoothstep(0.55, 0.95, st) * (0.35 + 0.65 * smoothstep(0.1, 0.6, fl) * (1.0 - smoothstep(0.75, 1.0, fl)));
            diffuseColor.rgb = mix(vec3(0.08, 0.4, 0.58) * lit, vec3(0.9, 0.95, 1.0) * max(lit, 0.6), streak * 0.75);
            diffuseColor.a = 0.78 + 0.16 * streak;
          }
        }
        if (vShore > 0.5 && uRealWater <= 0.0) {
          // Where the shore turns a corner, the water's corner is a curve
          // (aEdge bits: 1/2 = shore at -x/+x, 4/8 = at -z/+z). Outside the
          // curve the water stays (cutting it out left an empty hole in
          // the corner - 2026-10-26, Gaymi: "you cant see them in the
          // corner") but turns shallow and sandy, with a line of foam
          // along the curve, so the shore still looks round.
          vec2 f = fract(vCell / uBlock + 0.0001);
          float m = floor(vShore + 0.5);
          float sx = f.x < 0.5 ? step(0.5, mod(m, 2.0)) : step(0.5, mod(floor(m / 2.0), 2.0));
          float sz = f.y < 0.5 ? step(0.5, mod(floor(m / 4.0), 2.0)) : step(0.5, mod(floor(m / 8.0), 2.0));
          vec2 d = 0.5 - abs(f - 0.5);
          float r = length(max(vec2(0.5) - d, 0.0));
          float corner = sx * sz;
          float shallow = corner * smoothstep(0.47, 0.56, r);
          float foam = corner * (1.0 - smoothstep(0.0, 0.035, abs(r - 0.5)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.48), shallow * 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.97), foam * 0.6);
          diffuseColor.a = max(diffuseColor.a, shallow * 0.85);
        }`)
        .replace('#include <fog_fragment>', `if (uReflect > 0.0) {
          float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          float m = uReflect * (0.05 + 0.6 * fres);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, sRGBTransferOETF(vec4(uSky, 1.0)).rgb, m);
          gl_FragColor.a = mix(gl_FragColor.a, 1.0, m * 0.6);
          if (uRealWater > 0.0 && vTop > 0.5) {
            // Sparkles: tiny points of sunlight twinkling on the waves.
            vec2 c = vCell / uBlock;
            float tw = sin(dot(c, vec2(12.9, 7.3)) + uTime * 3.1 + wr.x * 8.0) * sin(dot(c, vec2(-8.1, 14.7)) - uTime * 2.3);
            gl_FragColor.rgb += vec3(smoothstep(0.975, 1.0, tw) * (0.2 + 0.8 * fres) * 0.6 * uRealWater);
          }
        }
        #include <fog_fragment>`)
    }
    this.materials.water.customProgramCacheKey = () => 'waves-sky-ripples-real'
    // Real-life lava (sixth batch, top 3 levels, Gaymi's pick "like the
    // water batch"): a dark, cooled crust drifting slowly across the
    // surface, broken by bright glowing cracks and the odd open molten
    // patch; fully crusted where it runs shallow at the edge, churning
    // bright where a lava fall lands, and the falls themselves pour in
    // glowing streaks. Worked out from the world position, so it runs on
    // across blocks with no seams. Plain lava picture on the other levels.
    this.materials.lava.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.fx.time
      shader.uniforms.uBlock = this.fx.block
      shader.uniforms.uRealWater = this.fx.realWater
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aWater;\nvarying vec2 vWater;\nvarying float vTop;\nvarying vec3 vLp;\nuniform float uBlock;')
        .replace('#include <project_vertex>', `#include <project_vertex>
        vWater = aWater;
        vTop = objectNormal.y > 0.5 ? 1.0 : 0.0;
        vLp = (modelMatrix * vec4(transformed, 1.0)).xyz / uBlock;`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uRealWater;
        varying vec2 vWater;
        varying float vTop;
        varying vec3 vLp;
        ${NOISE_GLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uRealWater > 0.0) {
          // Shade only (the glow of nearby lights would light the crust up).
          float lit = min(max(vColor.r, max(vColor.g, vColor.b)), 1.0);
          float t = uTime;
          float crustF;
          float heat;
          float tone;
          if (vTop > 0.5) {
            // The crust drifts slowly one way.
            vec2 q = vLp.xz + vec2(t * 0.05, t * 0.03);
            float n1 = realNoise(vec3(q * 0.9, 1.0));
            float n2 = realNoise(vec3(q * 2.3, 4.0 + t * 0.02));
            float n = n1 * 0.65 + n2 * 0.35;
            // Cracks: thin lines where the noise crosses its middle, plus a
            // finer network of smaller ones.
            float crack = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.5));
            crack = max(crack, (1.0 - smoothstep(0.0, 0.04, abs(realNoise(vec3(q * 4.5, 7.0)) - 0.5))) * 0.75);
            float open = smoothstep(0.66, 0.78, realNoise(vec3(q * 0.35, 9.0)));
            // Shallow edge (vWater.x: depth in blocks; -1 = plain top).
            float shore = vWater.x >= 0.0 ? 1.0 - smoothstep(0.05, 0.4, vWater.x) : 0.0;
            crustF = clamp((1.0 - open) * (1.0 - crack) + shore * crack * 0.7, 0.0, 1.0);
            // Where a lava fall lands it churns open and bright.
            float spl = max(vWater.y, 0.0) * (0.65 + 0.35 * sin(t * 5.0 + vLp.x * 9.0) * sin(t * 4.0 - vLp.z * 8.0));
            crustF *= 1.0 - spl;
            heat = max(crack, spl);
            tone = n2;
          } else {
            // A lava fall: glowing streaks pouring downward, with dark
            // lumps of crust carried down in them.
            float u = vLp.x + vLp.z;
            float st = 0.5 + 0.5 * sin(u * 9.0 + sin(u * 3.0) * 2.0);
            float fl = realNoise(vec3(u * 3.0, vLp.y * 1.4 + t * 1.3, 2.0));
            crustF = smoothstep(0.6, 0.78, fl) * 0.75;
            heat = st * 0.6;
            tone = fl;
          }
          float pulse = 0.88 + 0.12 * sin(t * 1.3 + tone * 9.0);
          vec3 hot = mix(vec3(1.0, 0.3, 0.03), vec3(1.0, 0.7, 0.2), heat) * pulse;
          vec3 crustCol = vec3(0.014, 0.008, 0.007) * (0.6 + 0.8 * tone);
          // The glow is its own light (emissive), so the sun doesn't wash
          // the hot parts out to white.
          diffuseColor.rgb = mix(hot * 0.12, crustCol, crustF) * lit;
          // The crust still glows a dull red from the heat under it.
          totalEmissiveRadiance = mix(hot * 0.9, vec3(0.035, 0.006, 0.0), crustF);
        }`)
    }
    this.materials.lava.customProgramCacheKey = () => 'lava-real'
  }

  // How much the leaves sway and the water rolls (world units) and how
  // much the water shines (0..1) - set from the graphics level. hazeScale:
  // how much of the far haze the weather lets through (0 on a clear day).
  setEffects({ sway = 0, waves = 0, shine = 0, real = 0, bump = 0, haze = 0, grade = 0, ao = 0, spec = 0, round = 0, realShape = 0 } = {}, hazeScale = 1) {
    // Real-life ground changes the chunks' shapes too: rebuild on a change.
    if (realShape !== this.realAmt) {
      this.realAmt = realShape
      this.rebuildAll()
    }
    this.fx.round.value = round
    this.fx.realWater.value = realShape
    // Smooth hills, pebbles and leafy edges change the chunks' shapes, so
    // turning them on or off rebuilds every chunk once.
    const shapes = round > 0
    if (shapes !== this.shapes) {
      this.shapes = shapes
      this.rebuildAll()
    }
    this.fx.real.value = real
    this.fx.grade.value = grade
    this.fx.ao.value = ao
    this.fx.spec.value = spec
    this.fx.bump.value = bump
    this.fx.haze.value = haze * hazeScale
    this.fx.reflect.value = shine * (0.8 + 0.2 * real)
    this.fx.sway.value = sway * this.blockSize
    this.fx.waves.value = waves * this.blockSize
    this.materials.water.specular.setScalar(shine * 0.9)
  }

  // The block pictures changed (Settings > Graphics level): draw the new
  // ones into the same slots. The liquids keep theirs.
  redrawAtlas() {
    const { cube, faces } = this._atlasFrom
    const unique = [...new Set(cube.map((t) => faces(t)).flatMap((f) => [f.top, f.side, f.bottom]))]
    // 64x64 pictures (In Real Life) get a double-size atlas and smooth
    // close-up filtering, so they look like real surfaces, not pixels.
    const big = unique.some((u) => u.width >= 64)
    this._drawAtlas(unique, big ? 2 : 1)
    this.atlas.magFilter = big ? THREE.LinearFilter : THREE.NearestFilter
    this.atlas.minFilter = big ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter
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
  // in blocks) first. share (0..1) shrinks that slice on a slow device
  // (BuildMode.workShare).
  // Returns true if any chunk was rebuilt.
  flush(blocksByChunk, focus = null, share = 1) {
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
      const until = performance.now() + LAZY_BUDGET_MS * share
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
  // The lumpy top of block x, y, z as _lumpyTop draws it: 16 [u, v, h]
  // points (4 x 4, row by row in z), or null if its top is flat. Used to
  // lay the breaking crack over the lumps (BuildTryMode).
  lumpyTopPoints(x, y, z) {
    if (!this.shapes) return null
    // A round trunk's top is its flat cut end.
    if (this.realAmt > 0 && this.info.get(this.getType(x, y, z))?.log) return null
    if (this.realAmt > 0 && this.info.get(this.getType(x, y, z))?.real) {
      const L = this.realTopLattice(x, y, z)
      const pts = []
      const pt = {}
      for (let j = 0; j <= 3; j++) {
        for (let i = 0; i <= 3; i++) {
          this.realTopPoint(L, x, y, z, i / 3, j / 3, pt)
          pts.push([pt.x - x, pt.z - z, pt.y - y])
        }
      }
      return pts
    }
    const info = this.info.get(this.getType(x, y, z))
    if (!info || !info.opaque || info.inset || info.liquid) return null
    const above = this.getType(x, y + 1, z)
    if (above && this.info.get(above)?.opaque) return null
    const N = 3
    const pts = []
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        let u = i / N
        let v = j / N
        let h = 1
        if (i > 0 && i < N && j > 0 && j < N) {
          u += (hash01(x * N + i, y, z * N + j, 21) - 0.5) * 0.1
          v += (hash01(x * N + i, y, z * N + j, 22) - 0.5) * 0.1
          h += BUMP_MIN + hash01(x * N + i, y, z * N + j, 23) * BUMP_RANGE
        }
        pts.push([u, v, h])
      }
    }
    return pts
  }

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
    const shapes = this.shapes
    // Real-life ground (RealGround.js): each corner point's move, worked
    // out once per build (17^3 corners in a chunk).
    const realAmt = this.realAmt
    let latAt = null
    let leafLatAt = null
    if (realAmt > 0) {
      latAt = this._latticeFn('ground', (x, y, z) => this._kindOf(typeAt(x, y, z)), bx, by, bz, realAmt)
      // Treetops get their own corner points: leaves (and the logs
      // inside them) are the "ground" there, everything else pins.
      leafLatAt = this._latticeFn('leaf', (x, y, z) => this._leafKindOf(typeAt(x, y, z)), bx, by, bz, realAmt, K_LEAF)
    }
    // Round trunks leave the corners of their cell empty, so a block
    // next to one still draws its face there (no hole to look through).
    const hides = (nInfo) => nInfo.opaque && !(realAmt > 0 && nInfo.log)
    // Bumpy blocks (2026-10-26, Gaymi: "you cant really tell what block
    // it is ... make them slightly bumpy ... no more then 20 degrees"):
    // every natural top keeps its edges at the block's own height, so each
    // block and every one-block step stays easy to see; only the inside
    // of the top rises in gentle lumps (see _lumpyTop).
    const cornerH = () => 1
    const stoneUv = this.info.get('cobblestone')?.uvs[2] || this.info.get('stone')?.uvs[2]
    for (const cell of cells) {
      const c1 = cell.indexOf(','), c2 = cell.indexOf(',', c1 + 1)
      const x = +cell.slice(0, c1), y = +cell.slice(c1 + 1, c2), z = +cell.slice(c2 + 1)
      const type = typeAt(x, y, z)
      const info = type && this.info.get(type)
      if (!info) continue
      const buf = info.liquid ? out[info.liquid] : info.solidDraw ? (info.glow ? out.glow : out.solid) : info.cutout ? out.cutout : out.clear
      if (info.plant) {
        // On real ground, sat on its rolling top instead of the cube's.
        const lift = latAt && this.info.get(typeAt(x, y - 1, z))?.real ? this._realTopAt(x, y - 1, z, 0.5, 0.5, latAt).y - y : 0
        this._plant(buf, x, y, z, bx, by, bz, info.uvs[0], tintAt(x, y, z), glowSources, lift)
        continue
      }
      const inset = info.inset
      const tint = info.liquid ? 1 : tintAt(x, y, z)
      // Liquid surfaces slope: each top corner is the average height of
      // the (up to 4) cells of the same liquid sharing it, and a corner
      // touching liquid with more of it on top is full - so flowing water
      // runs smoothly downhill from its source, like Minecraft.
      const cornerY = info.liquid ? this._liquidCorners(x, y, z, type) : null
      if (latAt && info.real) {
        this._realCell(info.solidDraw ? out.solid : out.clear, x, y, z, bx, by, bz, info, type, typeAt, latAt, glowSources, stoneUv)
        continue
      }
      if (leafLatAt && info.leaf) {
        this._realLeafCell(buf, x, y, z, bx, by, bz, info, typeAt, leafLatAt, glowSources)
        continue
      }
      if (realAmt > 0 && info.log) {
        this._realLog(buf, x, y, z, bx, by, bz, info, typeAt, glowSources)
        continue
      }
      const smooth = shapes && info.opaque && !inset && !info.liquid && !opaqueAt(x, y + 1, z)
      if (smooth && info.natural && PEBBLE_ON.test(type) && hash01(x, y, z, 1) < 0.07 && stoneUv) this._pebble(out.solid, x - bx, y - by, z - bz, x, y, z, cornerH, stoneUv)
      for (let fi = 0; fi < 6; fi++) {
        const face = FACES[fi]
        const [nx, ny, nz] = face.n
        const nType = typeAt(x + nx, y + ny, z + nz)
        // A narrow block's sides stand clear of its neighbors - always drawn.
        if (nType && !(inset && ny === 0)) {
          const nInfo = this.info.get(nType)
          // Hidden behind a solid cube, or glass against the same glass.
          if (nInfo && (hides(nInfo) || nType === type)) continue
          // Coral/seagrass stand in sea water: no water wall round them.
          if (info.liquid === 'water' && nInfo?.plant) continue
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
        // Which of this face's 4 edges are outside corners (rounded): bit
        // 1/2 = toward -/+ its first axis (y for x faces, else x), 4/8 =
        // its second (y for z faces, else z) - see the shader's uRound.
        let edge = 0
        if (shapes && !(smooth && ny === 1) && !info.liquid && !inset) {
          const A = nx !== 0 ? [0, 1, 0] : [1, 0, 0]
          const Bv = nz !== 0 ? [0, 1, 0] : [0, 0, 1]
          if (!opaqueAt(x - A[0], y - A[1], z - A[2])) edge |= 1
          if (!opaqueAt(x + A[0], y + A[1], z + A[2])) edge |= 2
          if (!opaqueAt(x - Bv[0], y - Bv[1], z - Bv[2])) edge |= 4
          if (!opaqueAt(x + Bv[0], y + Bv[1], z + Bv[2])) edge |= 8
        }
        // Water's top rounds off where the shore turns a corner (2026-10-26,
        // Gaymi: "never make the water square") - same bits, the water
        // shader cuts the corner into a curve.
        if (info.liquid === 'water' && ny === 1) {
          if (opaqueAt(x - 1, y, z)) edge |= 1
          if (opaqueAt(x + 1, y, z)) edge |= 2
          if (opaqueAt(x, y, z - 1)) edge |= 4
          if (opaqueAt(x, y, z + 1)) edge |= 8
        }
        if (shapes && info.cutout) {
          this._leafPuff(buf, x, y, z, bx, by, bz, face, [u0, v0, u1, v1], ao.map((a) => AO_LEVELS[a] * face.shade * tint))
          continue
        }
        if (realAmt > 0 && info.liquid && ny === 1) {
          this._realWaterTop(buf, x, y, z, bx, by, bz, type, cornerY, edge, glowSources, typeAt)
          continue
        }
        if (smooth && ny === 1) {
          this._lumpyTop(buf, x, y, z, bx, by, bz, cornerH, [u0, v0, u1, v1], ao.map((a) => AO_LEVELS[a] * face.shade * tint), info.alpha, glowSources)
          continue
        }
        const base = buf.pos.length / 3
        for (let i = 0; i < 4; i++) {
          const c = face.c[i]
          const topY = cornerY ? cornerY[c[0] * 2 + c[2]] : 1
          const cx0 = inset ? inset + c[0] * (1 - 2 * inset) : c[0]
          const cz0 = inset ? inset + c[2] * (1 - 2 * inset) : c[2]
          buf.pos.push((x - bx + cx0) * this.blockSize, (y - by + (c[1] ? topY : 0)) * this.blockSize, (z - bz + cz0) * this.blockSize)
          buf.nrm.push(nx, ny, nz)
          buf.edge.push(edge)
          buf.uv.push(CORNER_UV[i][0] ? u1 : u0, CORNER_UV[i][1] ? v1 : v0)
          const b = AO_LEVELS[ao[i]] * face.shade * tint
          const L = glowSources && this._glowAt(x + c[0], y + c[1] * topY, z + c[2], face.n, glowSources)
          const cr = L ? b * (1 + L[0]) : b
          const cg = L ? b * (1 + L[1]) : b
          const cb = L ? b * (1 + L[2]) : b
          if (buf.stride === 4) buf.col.push(cr, cg, cb, info.alpha)
          else buf.col.push(cr, cg, cb)
          // Water's depth and splash (only the real-life top uses them).
          if (buf === out.water || buf === out.lava) buf.wat.push(-1, 0)
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
      if (shapes || kind === 'water') geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(buf.edge, 1))
      if (kind === 'water' || kind === 'lava') geo.setAttribute('aWater', new THREE.Float32BufferAttribute(buf.wat, 2))
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

  // The top of smooth ground as a lumpy 3x3 patch instead of one flat
  // quad (2026-10-26, Gaymi: "dont just use simple triangles use more
  // irregular shapes"). The edges run straight between the corners, so
  // they meet the next block's patch and side faces exactly; only the
  // inside points move - up/down and a little sideways - by a fixed
  // random amount per cell. Light (ao: the 4 corners' shade) and the
  // slope's normal blend across the patch.
  _lumpyTop(buf, x, y, z, bx, by, bz, cornerH, [u0, v0, u1, v1], shade, alpha, glowSources) {
    const N = 3
    const h00 = cornerH(x, z, y)
    const h10 = cornerH(x + 1, z, y)
    const h01 = cornerH(x, z + 1, y)
    const h11 = cornerH(x + 1, z + 1, y)
    // Slope normal at a corner, from the corners around it.
    const cn = (X, Z) => [(cornerH(X - 1, Z, y) - cornerH(X + 1, Z, y)) / 2, (cornerH(X, Z - 1, y) - cornerH(X, Z + 1, y)) / 2]
    const n00 = cn(x, z)
    const n10 = cn(x + 1, z)
    const n01 = cn(x, z + 1)
    const n11 = cn(x + 1, z + 1)
    // shade[] follows FACES[2].c: (0,1), (1,1), (1,0), (0,0) in (x, z).
    const s00 = shade[3]
    const s10 = shade[2]
    const s01 = shade[0]
    const s11 = shade[1]
    const lerp2 = (a, b, c, d, u, v) => (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
    // Block light from lanterns etc. at each corner (as on flat faces).
    const glow = (cx, cz, h) => (glowSources && this._glowAt(x + cx, y + h, z + cz, [0, 1, 0], glowSources)) || [0, 0, 0]
    const g00 = glow(0, 0, h00)
    const g10 = glow(1, 0, h10)
    const g01 = glow(0, 1, h01)
    const g11 = glow(1, 1, h11)
    const H = []
    const base = buf.pos.length / 3
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        let u = i / N
        let v = j / N
        const inside = i > 0 && i < N && j > 0 && j < N
        let bump = 0
        if (inside) {
          u += (hash01(x * N + i, y, z * N + j, 21) - 0.5) * 0.1
          v += (hash01(x * N + i, y, z * N + j, 22) - 0.5) * 0.1
          bump = BUMP_MIN + hash01(x * N + i, y, z * N + j, 23) * BUMP_RANGE
        }
        const h = lerp2(h00, h10, h01, h11, u, v) + bump
        H.push(h)
        buf.pos.push((x - bx + u) * this.blockSize, (y - by + h) * this.blockSize, (z - bz + v) * this.blockSize)
        buf.uv.push(u0 + (u1 - u0) * u, v1 - (v1 - v0) * v)
        buf.edge.push(0)
        const b = lerp2(s00, s10, s01, s11, u, v)
        const L = (k) => b * (1 + lerp2(g00[k], g10[k], g01[k], g11[k], u, v))
        if (buf.stride === 4) buf.col.push(L(0), L(1), L(2), alpha)
        else buf.col.push(L(0), L(1), L(2))
      }
    }
    // Normals: the slope's, tipped by the lumps around each point.
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const u = i / N
        const v = j / N
        let gx = lerp2(n00[0], n10[0], n01[0], n11[0], u, v)
        let gz = lerp2(n00[1], n10[1], n01[1], n11[1], u, v)
        if (i > 0 && i < N && j > 0 && j < N) {
          const flat = (ii, jj) => lerp2(h00, h10, h01, h11, ii / N, jj / N)
          const at = (ii, jj) => H[jj * (N + 1) + ii] - flat(ii, jj)
          gx -= (at(i + 1, j) - at(i - 1, j)) * N / 2
          gz -= (at(i, j + 1) - at(i, j - 1)) * N / 2
        }
        const l = Math.hypot(gx, 1, gz)
        buf.nrm.push(gx / l, 1 / l, gz / l)
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i
        const b = a + 1
        const c = a + N + 1
        const d = c + 1
        // Up-facing winding (x right, z toward you); the diagonal flips
        // from square to square so no straight crease runs across.
        if ((i + j) % 2) buf.idx.push(a, c, d, a, d, b)
        else buf.idx.push(a, c, b, b, c, d)
      }
    }
  }

  // What a block is to real ground round it (RealGround.js kinds).
  // Anything this class doesn't draw (shaped blocks like slabs) pins it.
  _kindOf(t) {
    if (!t) return AIR
    const info = this.info.get(t)
    if (!info) return PIN_OTHER
    if (info.plant) return AIR
    // Water doesn't hold the ground's corners (fourth batch): banks and
    // lake beds round off and roll under it like real shores.
    if (info.liquid === 'water') return AIR
    // Nor does lava (sixth batch): its banks round off under it too.
    if (info.liquid === 'lava') return AIR
    if (info.real) return info.lookKind
    return info.opaque ? PIN_SOLID : PIN_OTHER
  }

  // What a block is to a treetop round it: leaves and logs are the
  // treetop, air and plants are air, anything else pins its corners.
  _leafKindOf(t) {
    if (!t) return AIR
    const info = this.info.get(t)
    if (!info) return PIN_OTHER
    if (info.plant) return AIR
    if (info.leaf || info.log) return REAL
    return info.opaque ? PIN_SOLID : PIN_OTHER
  }

  // Corner-point lookup for one chunk build: each of the chunk's 17^3
  // corners worked out once (slot: which cache - ground or treetop).
  _latticeFn(slot, kind, bx, by, bz, amt, kRound) {
    const L = CHUNK + 1
    const c = (this._lat || (this._lat = {}))[slot] || (this._lat[slot] = (() => {
      const buf = new Float32Array(L * L * L * REC)
      return { views: Array.from({ length: L * L * L }, (_, i) => buf.subarray(i * REC, i * REC + REC)), done: new Uint8Array(L * L * L) }
    })())
    c.done.fill(0)
    return (X, Y, Z) => {
      const lx = X - bx, ly = Y - by, lz = Z - bz
      if (lx < 0 || ly < 0 || lz < 0 || lx > CHUNK || ly > CHUNK || lz > CHUNK) return latticeAt(kind, X, Y, Z, amt, new Float32Array(REC), 0, kRound)
      const i = (ly * L + lz) * L + lx
      const v = c.views[i]
      if (!c.done[i]) {
        latticeAt(kind, X, Y, Z, amt, v, 0, kRound)
        c.done[i] = 1
      }
      return v
    }
  }

  // A corner point's record outside a chunk build (cracks, grass tufts).
  _latOutside(X, Y, Z) {
    return latticeAt((a, b, c) => this._kindOf(this.getType(a, b, c)), X, Y, Z, this.realAmt, new Float32Array(REC))
  }

  _leafLatOutside(X, Y, Z) {
    return latticeAt((a, b, c) => this._leafKindOf(this.getType(a, b, c)), X, Y, Z, this.realAmt, new Float32Array(REC), 0, K_LEAF)
  }

  // A point on the real top of cell x, y, z at (u along x, v along z),
  // in world blocks. latAt: the corner records to use.
  _realTopAt(x, y, z, u, v, latAt, out = {}) {
    const c = FACES[2].c
    const P = c.map((k) => [x + k[0], y + k[1], z + k[2]])
    const L = P.map((p) => latAt(p[0], p[1], p[2]))
    return realPoint(P, L, u, 1 - v, FACES[2].n, this.realAmt, out)
  }

  // The 4 corner records of real ground's top at x, y, z (null if it
  // isn't drawn as real ground) - GrassTufts keeps these for the tufts
  // near you and asks realTopPoint() where each one sits.
  realTopLattice(x, y, z) {
    if (!(this.realAmt > 0) || !this.info.get(this.getType(x, y, z))?.real) return null
    return FACES[2].c.map((k) => this._latOutside(x + k[0], y + k[1], z + k[2]))
  }

  realTopPoint(L, x, y, z, u, v, out = {}) {
    const P = FACES[2].c.map((k) => [x + k[0], y + k[1], z + k[2]])
    return realPoint(P, L, u, 1 - v, FACES[2].n, this.realAmt, out)
  }

  // Real ground's 6 faces as drawn: per face 16 [x, y, z] points inside
  // the cell (4 x 4, the face's own (s, t) order, outward winding), or
  // null if x, y, z isn't drawn as real ground. Lays the breaking crack
  // over the real shape (BuildTryMode).
  realFaceGrids(x, y, z) {
    const info = this.realAmt > 0 && this.info.get(this.getType(x, y, z))
    if (!info || !(info.real || info.leaf)) return null
    const leaf = !info.real
    const cache = new Map()
    const latAt = (X, Y, Z) => {
      const k = `${X},${Y},${Z}`
      if (!cache.has(k)) cache.set(k, leaf ? this._leafLatOutside(X, Y, Z) : this._latOutside(X, Y, Z))
      return cache.get(k)
    }
    const pt = {}
    return FACES.map((face) => {
      const P = face.c.map((c) => [x + c[0], y + c[1], z + c[2]])
      const L = P.map((p) => latAt(p[0], p[1], p[2]))
      const pts = []
      for (let j = 0; j <= 3; j++) {
        for (let i = 0; i <= 3; i++) {
          realPoint(P, L, i / 3, j / 3, face.n, this.realAmt, pt, leaf ? LEAF_LOOK : undefined)
          pts.push([pt.x - x, pt.y - y, pt.z - z])
        }
      }
      return pts
    })
  }

  // Real-life water's top (fourth batch, top 3 levels) - and lava's
  // (sixth batch: the same soft edges, depth and falls; its own shader
  // turns them into crust, cracks and glowing splashes). Like the plain
  // top, plus: where the shore is solid it reaches SHORE_REACH under the
  // bank, so the water meets the rounded-off bank instead of stopping at
  // the old square edge; every corner carries how deep the water is there
  // (the shader fades clear green shallows into dark blue deeps and puts
  // foam where it gets shallow at the shore) and whether a waterfall
  // lands next to it (splash foam).
  _realWaterTop(buf, x, y, z, bx, by, bz, type, cornerY, edge, glowSources, typeAt) {
    const S = this.blockSize
    const R = SHORE_REACH
    const solidAt = (a, b, c) => {
      const t = typeAt(a, b, c)
      return !!t && !!this.info.get(t)?.opaque
    }
    // How deep the water column at (cx, y, cz) is, in blocks (0 if no water).
    const colDepth = (cx, cz) => {
      if (typeAt(cx, y, cz) !== type) return 0
      let d = this.liquidHeight(cx, y, cz)
      for (let k = 1; k < 8 && typeAt(cx, y - k, cz) === type; k++) d++
      return d
    }
    const dep = [0, 0, 0, 0]
    const spl = [0, 0, 0, 0]
    for (let cx = 0; cx <= 1; cx++) {
      for (let cz = 0; cz <= 1; cz++) {
        let sum = 0, fall = 0
        for (let i = -1; i <= 0; i++) {
          for (let j = -1; j <= 0; j++) {
            sum += colDepth(x + cx + i, z + cz + j)
            if (typeAt(x + cx + i, y + 1, z + cz + j) === type) fall = 1
          }
        }
        dep[cx * 2 + cz] = sum / 4
        spl[cx * 2 + cz] = fall
      }
    }
    const xs = [solidAt(x - 1, y, z) ? -R : null, 0, 1, solidAt(x + 1, y, z) ? 1 + R : null].filter((v) => v !== null)
    const zs = [solidAt(x, y, z - 1) ? -R : null, 0, 1, solidAt(x, y, z + 1) ? 1 + R : null].filter((v) => v !== null)
    const alpha = this.info.get(type).alpha
    const base = buf.pos.length / 3
    for (const vz of zs) {
      for (const vx of xs) {
        const cx = vx <= 0 ? 0 : 1
        const cz = vz <= 0 ? 0 : 1
        const inside = vx >= 0 && vx <= 1 && vz >= 0 && vz <= 1
        const h = cornerY[cx * 2 + cz]
        // Under the bank the water dips a little, out of sight.
        buf.pos.push((x - bx + vx) * S, (y - by + h - (inside ? 0 : 0.06)) * S, (z - bz + vz) * S)
        buf.nrm.push(0, 1, 0)
        buf.edge.push(edge)
        buf.uv.push(vx, 1 - vz)
        const L = glowSources && this._glowAt(x + cx, y + h, z + cz, FACES[2].n, glowSources)
        buf.col.push(L ? 1 + L[0] : 1, L ? 1 + L[1] : 1, L ? 1 + L[2] : 1)
        if (buf.stride === 4) buf.col.push(alpha)
        // (depth, splash); splash -1 marks the edge reaching under a bank.
        buf.wat.push(inside ? dep[cx * 2 + cz] : 0, inside ? spl[cx * 2 + cz] : -1)
      }
    }
    const W = xs.length
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = base + j * W + i
        const b = a + 1
        const c = a + W
        const d = c + 1
        // Up-facing winding (x right, z toward you).
        buf.idx.push(a, c, d, a, d, b)
      }
    }
  }

  // One real-ground block (RealGround.js): each showing face as a 3x3
  // grid whose points all move the shared way, so the faces join into
  // one rounded, lumpy piece of land. Lit by its rounded shape, not the
  // cube face's, and shaded in soft patches, not per block.
  _realCell(buf, x, y, z, bx, by, bz, info, type, typeAt, latAt, glowSources, stoneUv) {
    const N = 3
    const S = this.blockSize
    const amt = this.realAmt
    const pt = this._rp || (this._rp = {})
    const P = this._rP || (this._rP = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]])
    const L = [null, null, null, null]
    const G = [null, null, null, null]
    const aboveInfo = this.info.get(typeAt(x, y + 1, z))
    // A pebble now and then, sat on the rolling top.
    if (PEBBLE_ON.test(type) && !aboveInfo?.opaque && stoneUv) {
      const cornerH = (X, Z) => this._realTopAt(x, y, z, X - x, Z - z, latAt).y - y
      // Gravel: small stones poking out of most blocks (Gaymi's pick),
      // up to 3 each; everything else now and then.
      const gravel = info.look === 'gravel'
      for (let k = 0; k < (gravel ? 3 : 1); k++) {
        if (hash01(x, y, z, 1 + k * 40) < (gravel ? 0.45 : 0.07)) this._pebble(buf, x - bx, y - by, z - bz, x, y, z, cornerH, stoneUv, k * 40)
      }
    }
    for (let fi = 0; fi < 6; fi++) {
      const face = FACES[fi]
      const [nx, ny, nz] = face.n
      const nType = typeAt(x + nx, y + ny, z + nz)
      if (nType) {
        const nInfo = this.info.get(nType)
        if (nInfo && ((nInfo.opaque && !nInfo.log) || nType === type)) continue
      }
      for (let i = 0; i < 4; i++) {
        const c = face.c[i]
        P[i][0] = x + c[0]
        P[i][1] = y + c[1]
        P[i][2] = z + c[2]
        L[i] = latAt(P[i][0], P[i][1], P[i][2])
        G[i] = glowSources ? this._glowAt(P[i][0], P[i][1], P[i][2], face.n, glowSources) : null
      }
      // A grass side that's only a short step (ground right below the
      // cell in front of it) is a grassy slope in real life, not a dirt
      // wall: it gets the grass top picture. Taller drops stay dirt.
      const slope = ny === 0 && GRASSY_TOP.test(type) && this._kindOf(typeAt(x + nx, y - 1, z + nz)) !== AIR
      const [u0, v0, u1, v1] = slope ? info.uvs[2] : info.uvs[fi]
      // Tops turned a random quarter per block, so the grass picture
      // doesn't repeat in rows.
      const turn = ny === 1 ? Math.floor(hash01(x, y, z, 31) * 4) : 0
      const base = buf.pos.length / 3
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const s = i / N
          const t = j / N
          realPoint(P, L, s, t, face.n, amt, pt)
          buf.pos.push((pt.x - bx) * S, (pt.y - by) * S, (pt.z - bz) * S)
          buf.nrm.push(pt.nx, pt.ny, pt.nz)
          // Below 0 = how glossy (wet mud), read by the sun-glint shader.
          buf.edge.push(-pt.gloss)
          const tu = turn === 0 ? s : turn === 1 ? 1 - t : turn === 2 ? 1 - s : t
          const tv = turn === 0 ? t : turn === 1 ? s : turn === 2 ? 1 - t : 1 - s
          buf.uv.push(u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tv)
          const b = pt.ao * pt.shade * (pt.rock > 0 ? rockTint(pt.x, pt.y, pt.z, pt.rock, pt.grain) : realTint(pt.x, pt.y, pt.z))
          let r = b, g = b, bl = b
          if (glowSources) {
            const W = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t]
            let lr = 0, lg = 0, lb = 0
            for (let k = 0; k < 4; k++) {
              if (!G[k]) continue
              lr += W[k] * G[k][0]
              lg += W[k] * G[k][1]
              lb += W[k] * G[k][2]
            }
            r *= 1 + lr
            g *= 1 + lg
            bl *= 1 + lb
          }
          if (buf.stride === 4) buf.col.push(r, g, bl, info.alpha)
          else buf.col.push(r, g, bl)
        }
      }
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = base + j * (N + 1) + i
          const b = a + 1
          const c = a + N + 1
          const d = c + 1
          // Diagonal flips square to square, so no straight crease shows.
          if ((i + j) % 2) buf.idx.push(a, b, c, b, d, c)
          else buf.idx.push(a, b, d, a, d, c)
        }
      }
    }
  }

  // One leaf block on the top levels (RealGround.js, second batch): only
  // the treetop's outside is drawn (faces against other leaves, of any
  // kind, are skipped), each face a 3x3 grid on the treetop's own corner
  // points - so all the leaf blocks of a tree round off into one soft,
  // lumpy crown - plus a leaf clump or two poking out past the surface so
  // the outline looks ragged like a real tree, not a smooth balloon.
  _realLeafCell(buf, x, y, z, bx, by, bz, info, typeAt, latAt, glowSources) {
    const N = 3
    const S = this.blockSize
    const amt = this.realAmt
    const pt = this._lp || (this._lp = {})
    const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
    const L = [null, null, null, null]
    const G = [null, null, null, null]
    for (let fi = 0; fi < 6; fi++) {
      const face = FACES[fi]
      const [nx, ny, nz] = face.n
      const nType = typeAt(x + nx, y + ny, z + nz)
      if (nType) {
        const nInfo = this.info.get(nType)
        if (nInfo && (nInfo.leaf || (nInfo.opaque && !nInfo.log))) continue
      }
      for (let i = 0; i < 4; i++) {
        const c = face.c[i]
        P[i][0] = x + c[0]
        P[i][1] = y + c[1]
        P[i][2] = z + c[2]
        L[i] = latAt(P[i][0], P[i][1], P[i][2])
        G[i] = glowSources ? this._glowAt(P[i][0], P[i][1], P[i][2], face.n, glowSources) : null
      }
      const light = (s, t, b) => {
        if (!glowSources) return [b, b, b]
        const W = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t]
        let lr = 0, lg = 0, lb = 0
        for (let k = 0; k < 4; k++) {
          if (!G[k]) continue
          lr += W[k] * G[k][0]
          lg += W[k] * G[k][1]
          lb += W[k] * G[k][2]
        }
        return [b * (1 + lr), b * (1 + lg), b * (1 + lb)]
      }
      const [u0, v0, u1, v1] = info.uvs[fi]
      // Turned a random quarter, so the leaf picture doesn't repeat in rows.
      const turn = Math.floor(hash01(x, y, z, 31 + fi) * 4)
      const base = buf.pos.length / 3
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const s = i / N
          const t = j / N
          realPoint(P, L, s, t, face.n, amt, pt, LEAF_LOOK)
          buf.pos.push((pt.x - bx) * S, (pt.y - by) * S, (pt.z - bz) * S)
          buf.nrm.push(pt.nx, pt.ny, pt.nz)
          buf.edge.push(0)
          const tu = turn === 0 ? s : turn === 1 ? 1 - t : turn === 2 ? 1 - s : t
          const tv = turn === 0 ? t : turn === 1 ? s : turn === 2 ? 1 - t : 1 - s
          buf.uv.push(u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tv)
          const [r, g, bl] = light(s, t, pt.ao * pt.shade * realTint(pt.x, pt.y, pt.z))
          if (buf.stride === 4) buf.col.push(r, g, bl, 1)
          else buf.col.push(r, g, bl)
        }
      }
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = base + j * (N + 1) + i
          const b = a + 1
          const c = a + N + 1
          const d = c + 1
          if ((i + j) % 2) buf.idx.push(a, b, c, b, d, c)
          else buf.idx.push(a, b, d, a, d, c)
        }
      }
      // Leaf clumps: 1-2 per face, each two small leafy cards crossed and
      // tipped out from the surface (drawn from both sides, lit like the
      // crown under them so they don't show dark backs).
      const clumps = 1 + (hash01(x, y, z, 60 + fi) < 0.45 ? 1 : 0)
      for (let k = 0; k < clumps; k++) {
        const s = 0.2 + hash01(x * 3 + k, y, z, 61 + fi) * 0.6
        const t = 0.2 + hash01(x, y * 3 + k, z, 67 + fi) * 0.6
        realPoint(P, L, s, t, face.n, amt, pt, LEAF_LOOK)
        const n = [pt.nx, pt.ny, pt.nz]
        // Two directions along the surface.
        const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
        const t1 = norm3(cross3(n, ref))
        const t2 = cross3(n, t1)
        const a = hash01(x, y * 7 + k, z, 73 + fi) * Math.PI
        const size = (0.42 + hash01(x * 5 + k, y, z, 79 + fi) * 0.2) * amt
        const [r, g, bl] = light(s, t, pt.ao * pt.shade * realTint(pt.x, pt.y, pt.z) * 1.05)
        for (let q = 0; q < 2; q++) {
          const aa = a + q * Math.PI / 2
          const d = [t1[0] * Math.cos(aa) + t2[0] * Math.sin(aa), t1[1] * Math.cos(aa) + t2[1] * Math.sin(aa), t1[2] * Math.cos(aa) + t2[2] * Math.sin(aa)]
          const side = cross3(n, d)
          // Leaning out: mostly away from the crown, a bit to one side.
          const lean = hash01(x + q, y, z * 7 + k, 83 + fi) < 0.5 ? -0.55 : 0.55
          const e = norm3([n[0] + side[0] * lean, n[1] + side[1] * lean, n[2] + side[2] * lean])
          const o = [pt.x - n[0] * 0.08, pt.y - n[1] * 0.08, pt.z - n[2] * 0.08]
          const corners = [
            [o[0] - d[0] * size / 2, o[1] - d[1] * size / 2, o[2] - d[2] * size / 2, u0, v0],
            [o[0] + d[0] * size / 2, o[1] + d[1] * size / 2, o[2] + d[2] * size / 2, u1, v0],
            [o[0] + d[0] * size / 2 + e[0] * size, o[1] + d[1] * size / 2 + e[1] * size, o[2] + d[2] * size / 2 + e[2] * size, u1, v1],
            [o[0] - d[0] * size / 2 + e[0] * size, o[1] - d[1] * size / 2 + e[1] * size, o[2] - d[2] * size / 2 + e[2] * size, u0, v1],
          ]
          const cb = buf.pos.length / 3
          for (const [px, py, pz, uu, vv] of corners) {
            buf.pos.push((px - bx) * S, (py - by) * S, (pz - bz) * S)
            buf.nrm.push(n[0], n[1], n[2])
            buf.edge.push(0)
            buf.uv.push(uu, vv)
            if (buf.stride === 4) buf.col.push(r, g, bl, 1)
            else buf.col.push(r, g, bl)
          }
          buf.idx.push(cb, cb + 1, cb + 2, cb, cb + 2, cb + 3, cb, cb + 2, cb + 1, cb, cb + 3, cb + 2)
        }
      }
    }
  }

  // One log on the top levels (RealGround.js, second batch): a round,
  // bark-bumpy trunk nearly the block's width instead of a square post
  // (still a whole block to walk into and dig). Logs stacked on each
  // other run on as one trunk; a cut end shows the rings picture. Logs
  // side by side each stay round, like a log cabin.
  _realLog(buf, x, y, z, bx, by, bz, info, typeAt, glowSources) {
    const S = this.blockSize
    const amt = this.realAmt
    const SEG = 3 // per quarter, 12 round
    const ROWS = 2
    const cx = x + 0.5, cz = z + 0.5
    const nInfo = (dx, dy, dz) => {
      const t = typeAt(x + dx, y + dy, z + dz)
      return t ? this.info.get(t) : null
    }
    const solidNotLog = (i) => !!i && i.opaque && !i.log
    const above = nInfo(0, 1, 0), below = nInfo(0, -1, 0)
    // Shut in on every side by solid blocks: nothing of it can be seen.
    let open = false
    for (let dz = -1; dz <= 1 && !open; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dz) && !solidNotLog(nInfo(dx, 0, dz))) { open = true; break }
      }
    }
    const tint = tintAt(x, y, z)
    const col = (b, px, py, pz, n) => {
      if (glowSources) {
        const G = this._glowAt(px, py, pz, n, glowSources)
        if (G) return [b * (1 + G[0]), b * (1 + G[1]), b * (1 + G[2])]
      }
      return [b, b, b]
    }
    const push = (px, py, pz, n, u, v, c) => {
      buf.pos.push((px - bx) * S, (py - by) * S, (pz - bz) * S)
      buf.nrm.push(n[0], n[1], n[2])
      buf.edge.push(0)
      buf.uv.push(u, v)
      if (buf.stride === 4) buf.col.push(c[0], c[1], c[2], 1)
      else buf.col.push(c[0], c[1], c[2])
    }
    // Sitting on the ground: the foot of the trunk a little darker.
    const footDark = below && !below.log && below.opaque
    if (open) {
      for (let q = 0; q < 4; q++) {
        // Each quarter faces one side and shows that side's picture once.
        const [u0, v0, u1, v1] = info.uvs[[0, 4, 1, 5][q]]
        const base = buf.pos.length / 3
        for (let j = 0; j <= ROWS; j++) {
          const py = y + j / ROWS
          for (let i = 0; i <= SEG; i++) {
            const a = (q - 0.5 + i / SEG) * Math.PI / 2
            const r = logRadius(a, py, cx, cz, amt)
            const n = [Math.cos(a), 0, Math.sin(a)]
            const px = cx + n[0] * r, pz = cz + n[2] * r
            let b = (0.86 * Math.abs(n[0]) + 0.93 * Math.abs(n[2])) / (Math.abs(n[0]) + Math.abs(n[2])) * tint
            if (footDark && j === 0) b *= 0.75
            push(px, py, pz, n, u0 + (u1 - u0) * (1 - i / SEG), v0 + (v1 - v0) * (j / ROWS), col(b, px, py, pz, n))
          }
        }
        for (let j = 0; j < ROWS; j++) {
          for (let i = 0; i < SEG; i++) {
            const a = base + j * (SEG + 1) + i
            const b = a + 1
            const c = a + SEG + 1
            const d = c + 1
            // Angle runs counterclockwise from above, so this winding faces out.
            buf.idx.push(a, c, d, a, d, b)
          }
        }
      }
    }
    // Cut ends: where no log carries on above/below and nothing solid covers it.
    for (const up of [1, 0]) {
      const nb = up ? above : below
      if (nb && (nb.log || nb.opaque)) continue
      const [u0, v0, u1, v1] = info.uvs[up ? 2 : 3]
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2
      const py = y + up
      const n = [0, up ? 1 : -1, 0]
      const b = (up ? 1 : 0.7) * tint
      const c = col(b, cx, py, cz, n)
      const base = buf.pos.length / 3
      push(cx, py, cz, n, uc, vc, c)
      const RING = SEG * 4
      for (let i = 0; i < RING; i++) {
        const a = (i / RING - 0.125) * Math.PI * 2
        const r = logRadius(a, py, cx, cz, amt)
        push(cx + Math.cos(a) * r, py, cz + Math.sin(a) * r, n, uc + Math.cos(a) * r * (u1 - u0), vc - Math.sin(a) * r * (v1 - v0), c)
      }
      for (let i = 0; i < RING; i++) {
        const p = base + 1 + i, p2 = base + 1 + (i + 1) % RING
        if (up) buf.idx.push(base, p2, p)
        else buf.idx.push(base, p, p2)
      }
    }
  }

  // A little lumpy stone lying on a ground block's top (lx/ly/lz: the
  // cell in chunk space, x/y/z: in the world), sat on the smooth slope:
  // a ring of 6 points on the ground, a smaller turned ring above and a
  // peak, each pushed about at random, drawn with flat facets
  // (2026-10-26, Gaymi: lumpy pebbles instead of little boxes).
  _pebble(buf, lx, ly, lz, x, y, z, cornerH, uv, salt = 0) {
    const px = 0.2 + hash01(x, y, z, 7 + salt) * 0.6
    const pz = 0.2 + hash01(x, y, z, 8 + salt) * 0.6
    const h00 = cornerH(x, z, y)
    const h10 = cornerH(x + 1, z, y)
    const h01 = cornerH(x, z + 1, y)
    const h11 = cornerH(x + 1, z + 1, y)
    const gy = h00 * (1 - px) * (1 - pz) + h10 * px * (1 - pz) + h01 * (1 - px) * pz + h11 * px * pz
    const r = 0.05 + hash01(x, y, z, 9 + salt) * 0.06
    const stretch = 0.7 + hash01(x, y, z, 10 + salt) * 0.6
    const h = r * (0.9 + hash01(x, y, z, 12 + salt) * 0.6)
    const cx = lx + px
    const cz = lz + pz
    const y0 = ly + gy - h * 0.25
    const turn = hash01(x, y, z, 13 + salt) * Math.PI * 2
    const SIDES = 6
    const ring = (k, rad, yy, twist) => {
      const pts = []
      for (let i = 0; i < SIDES; i++) {
        const a = turn + twist + (i / SIDES) * Math.PI * 2
        const rr = rad * (0.75 + hash01(x * 7 + i, y + k, z, 14 + salt) * 0.5)
        pts.push([cx + Math.cos(a) * rr * stretch, yy + (hash01(x, y + k, z * 7 + i, 15 + salt) - 0.5) * h * 0.25, cz + Math.sin(a) * rr])
      }
      return pts
    }
    const low = ring(0, r, y0, 0)
    const mid = ring(1, r * 0.72, y0 + h * 0.65, Math.PI / SIDES)
    const peak = [cx + (hash01(x, y, z, 16 + salt) - 0.5) * r * 0.5, y0 + h, cz + (hash01(x, y, z, 17 + salt) - 0.5) * r * 0.5]
    const centre = [cx, y0 + h * 0.4, cz]
    const [u0, v0, u1, v1] = uv
    const du = (u1 - u0) * 0.3
    const dv = (v1 - v0) * 0.3
    const b = 0.78 + hash01(x, y, z, 11 + salt) * 0.2
    const tri = (A, B, C) => {
      let n = cross3(sub3(B, A), sub3(C, A))
      // Point it outward (away from the stone's middle).
      const mid3 = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3]
      if (dot3(n, sub3(mid3, centre)) < 0) {
        const t = B
        B = C
        C = t
        n = [-n[0], -n[1], -n[2]]
      }
      const l = Math.hypot(n[0], n[1], n[2]) || 1
      const base = buf.pos.length / 3
      for (const [P, uu, vv] of [[A, 0, 0], [B, 1, 0], [C, 0.5, 1]]) {
        buf.pos.push(P[0] * this.blockSize, P[1] * this.blockSize, P[2] * this.blockSize)
        buf.nrm.push(n[0] / l, n[1] / l, n[2] / l)
        buf.uv.push(u0 + du * uu, v0 + dv * vv)
        const s = b * (0.75 + 0.25 * Math.max(0, n[1] / l))
        if (buf.stride === 4) buf.col.push(s, s, s, 1)
        else buf.col.push(s, s, s)
        buf.edge.push(0)
      }
      buf.idx.push(base, base + 1, base + 2)
    }
    for (let i = 0; i < SIDES; i++) {
      const i2 = (i + 1) % SIDES
      tri(low[i], low[i2], mid[i])
      tri(mid[i], low[i2], mid[i2])
      tri(mid[i], mid[i2], peak)
    }
  }

  // A plant (coral, seagrass): two pictures crossed corner to corner
  // through the cell, each drawn from both sides, a little off-centre and
  // turned per cell so a patch doesn't look stamped out.
  _plant(buf, x, y, z, bx, by, bz, uv, tint, glowSources, lift = 0) {
    const [u0, v0, u1, v1] = uv
    const s = this.blockSize
    const ox = (hash01(x, y, z, 3) - 0.5) * 0.3
    const oz = (hash01(x, y, z, 4) - 0.5) * 0.3
    const turn = hash01(x, y, z, 5) * Math.PI * 0.5
    const L = glowSources && this._glowAt(x + 0.5, y + 0.5, z + 0.5, [0, 1, 0], glowSources)
    const b = tint * 0.95
    const col = L ? [b * (1 + L[0]), b * (1 + L[1]), b * (1 + L[2])] : [b, b, b]
    for (let k = 0; k < 2; k++) {
      const a = turn + Math.PI / 4 + k * Math.PI / 2
      const dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5
      const nx = -dz * 2, nz = dx * 2
      for (const side of [1, -1]) {
        const base = buf.pos.length / 3
        const ends = side === 1 ? [[-1, 0], [1, 0], [1, 1], [-1, 1]] : [[1, 0], [-1, 0], [-1, 1], [1, 1]]
        for (let i = 0; i < 4; i++) {
          const [e, up] = ends[i]
          buf.pos.push((x - bx + 0.5 + ox + dx * e) * s, (y - by + up + lift) * s, (z - bz + 0.5 + oz + dz * e) * s)
          // Lit from above more than from the side, like leaves.
          buf.nrm.push(nx * side * 0.5, 0.85, nz * side * 0.5)
          buf.edge.push(0)
          buf.uv.push(e * side > 0 ? u1 : u0, up ? v1 : v0)
          if (buf.stride === 4) buf.col.push(col[0], col[1], col[2], 1)
          else buf.col.push(col[0], col[1], col[2])
        }
        buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
  }
  // A leaf block's face on the rounded levels: puffed out in the middle
  // like a pillow, with a few small lumps, so a tree looks round and bumpy
  // from every side. (It used to get a flat leafy card held out from the
  // face, which looked like a second flat layer from behind - 2026-10-26,
  // Gaymi: "make the leaves slightly round and bumpy".) The edges stay on
  // the block, so leaf blocks next to each other still meet.
  _leafPuff(buf, x, y, z, bx, by, bz, face, [u0, v0, u1, v1], shade) {
    const N = 3
    const PUFF = 0.14
    const [nx, ny, nz] = face.n
    const [c0, c1, , c3] = face.c
    const es = sub3(c1, c0)
    const et = sub3(c3, c0)
    const lerp2 = (a, b, c, d, s, t) => (a * (1 - s) + b * s) * (1 - t) + (d * (1 - s) + c * s) * t
    const base = buf.pos.length / 3
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const s = i / N
        const t = j / N
        const inside = i > 0 && i < N && j > 0 && j < N
        const lump = inside ? (hash01(x * 7 + i + nx, y * 7 + j + ny, z * 7 + nz, 31) - 0.5) * 0.08 : 0
        const h = PUFF * Math.sin(Math.PI * s) * Math.sin(Math.PI * t) + lump
        const px = c0[0] + es[0] * s + et[0] * t + nx * h
        const py = c0[1] + es[1] * s + et[1] * t + ny * h
        const pz = c0[2] + es[2] * s + et[2] * t + nz * h
        buf.pos.push((x - bx + px) * this.blockSize, (y - by + py) * this.blockSize, (z - bz + pz) * this.blockSize)
        // Tipped toward the slope of the puff.
        const ds = PUFF * Math.PI * Math.cos(Math.PI * s) * Math.sin(Math.PI * t)
        const dt = PUFF * Math.PI * Math.sin(Math.PI * s) * Math.cos(Math.PI * t)
        const gx = nx - es[0] * ds - et[0] * dt
        const gy = ny - es[1] * ds - et[1] * dt
        const gz = nz - es[2] * ds - et[2] * dt
        const l = Math.hypot(gx, gy, gz)
        buf.nrm.push(gx / l, gy / l, gz / l)
        buf.edge.push(0)
        buf.uv.push(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t)
        const b = lerp2(shade[0], shade[1], shade[2], shade[3], s, t)
        if (buf.stride === 4) buf.col.push(b, b, b, 1)
        else buf.col.push(b, b, b)
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i
        buf.idx.push(a, a + 1, a + N + 2, a, a + N + 2, a + N + 1)
      }
    }
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
  return { pos: [], nrm: [], uv: [], col: [], idx: [], edge: [], wat: [], stride }
}

// Small 3D vector helpers (pebbles, leaf puffs).
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
