// Game-wide fixes for two kinds of 3D flicker (2026-11-20, Gaymi: "fix
// this from the root cause and make this not happen again"). Imported
// once, first thing, by main.js - every scene and every future mesh or
// shader gets them without having to remember anything.
//
// 1. Things popping in and out. Three.js skips drawing anything whose
//    bounds are off-screen, but it measures those bounds ONCE and never
//    again. Anything that later moves its blocks/instances (an
//    InstancedMesh after setMatrixAt, a mesh whose points are rewritten)
//    kept its old bounds, so it vanished whenever the OLD spot left the
//    screen. That was fixed one object at a time (BuildMode's shaped
//    blocks, Deathmatch stairs, lots of `frustumCulled = false`); now the
//    check notices any change and re-measures, for every object.
//
// 2. Shimmering stripes where two surfaces sit very close (skin layers,
//    cracks, sprays, trim on blocks). The play camera's near plane is
//    tiny (0.012, so walls never cut open), which leaves the depth buffer
//    too coarse to tell close surfaces apart a few blocks away. The main
//    renderer now uses a logarithmic depth buffer (Game.js), which is
//    sharp at every distance. Built-in materials handle that themselves;
//    our own ShaderMaterials (sky, rain, disasters...) get the same depth
//    code added below automatically, so they keep hiding behind walls.
import * as THREE from 'three'

// --- 1. Bounds that follow changes ---------------------------------------
const seen = new WeakMap()

// A cheap "has it changed?" fingerprint: the version numbers three.js
// bumps on every needsUpdate, plus the instance count.
function fingerprint(object) {
  if (object.isInstancedMesh) return `${object.count}|${object.instanceMatrix.version}|${object.geometry.attributes.position?.version}`
  const pos = object.geometry?.attributes?.position
  return pos ? `${pos.version}|${pos.count}` : ''
}

const intersectsObject = THREE.Frustum.prototype.intersectsObject
THREE.Frustum.prototype.intersectsObject = function (object) {
  const geometry = object.geometry
  if (geometry) {
    const now = fingerprint(object)
    const owner = object.isInstancedMesh ? object : geometry
    const before = seen.get(owner)
    if (before !== undefined && before !== now) {
      if (object.isInstancedMesh) {
        object.boundingSphere = null
        object.boundingBox = null
      } else {
        geometry.boundingSphere = null
        geometry.boundingBox = null
      }
    }
    // Also catches a swapped-in position attribute (a new object).
    if (before !== now) seen.set(owner, now)
  }
  return intersectsObject.call(this, object)
}

// --- 2. Our own shaders join the sharper depth -----------------------------
const VERT_PARS = `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
varying float vFragDepth;
varying float vIsPerspective;
#endif
`
const VERT_BODY = `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
vFragDepth = 1.0 + gl_Position.w;
vIsPerspective = projectionMatrix[2][3] == -1.0 ? 1.0 : 0.0;
#endif
`
const MAIN = /void\s+main\s*\(\s*(void)?\s*\)\s*\{/

// -> the shader with the depth code added, or unchanged when it already
// has it (or isn't shaped the way we expect - then it keeps working as
// before, just without the sharper depth).
export function addLogDepth(vertexShader, fragmentShader) {
  let v = vertexShader
  let f = fragmentShader
  if (!/logdepthbuf|vFragDepth/.test(v) && MAIN.test(v)) {
    const end = v.lastIndexOf('}')
    v = VERT_PARS + v.slice(0, end) + VERT_BODY + v.slice(end)
  }
  if (!/logdepthbuf|gl_FragDepth|vFragDepth/.test(f) && MAIN.test(f)) {
    // First thing in main, so an early `return`/`discard` can't skip it.
    f = '#include <logdepthbuf_pars_fragment>\n' + f.replace(MAIN, (m) => `${m}\n#include <logdepthbuf_fragment>\n`)
  }
  return [v, f]
}

const own = THREE.ShaderMaterial.prototype
const original = own.onBeforeCompile
own.onBeforeCompile = function (shader, renderer) {
  if (!this.isRawShaderMaterial) [shader.vertexShader, shader.fragmentShader] = addLogDepth(shader.vertexShader, shader.fragmentShader)
  return original.call(this, shader, renderer)
}

// For the tests (world.spec.js), which run on the built game and can't
// import three.js themselves.
if (typeof window !== 'undefined') window.__three = THREE
