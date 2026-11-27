// Emotes (2026-10-31, Gaymi's funny update: "dance, wave or a flex
// pose"). Press the Emote key (Z, Settings > Controls) - or the smiley
// touch button on a phone - and a wheel of them opens round the middle of
// the screen (2026-11-01, Gaymi: "a circle where you can pick"); click /
// tap one, or press its number, and it plays for EMOTE_S seconds. The
// mouse is free while the wheel is up; Z or Escape closes it. Your own body shows
// it in third person (P), and on a server everyone sees it: the emote's
// id rides along with your position (PlayNet state `emote`).
//
// 2026-11-20 (Gaymi): emoting swings the camera round to the front so
// you see yourself (BuildTryMode.applyView), and walking keeps it going
// with walking legs (walkLegs) - the camera glides back while you move.
//
// Owned by BuildSurvival (`s.emotes`). poseEmote() is shared by your own
// body (BuildTryMode._updateBody) and other players' (PlayNet._drawPlayer).
//
// 2026-11-20 (Gaymi: "smoother and nicer, more pink, more emotes"): the
// wheel is a pink pie of slices now (SVG, opens and closes with a little
// pop), 14 emotes, your face changes while you emote (emoteFace below)
// and each one has a sound (Audio.playEmote), also heard from other
// players near you.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { HEAD_BIG, HEAD_Y } from './MenuAvatar3D.js'

// The first 10 are on keys 1-9 and 0 (keep their order); the rest are
// mouse / tap only.
export const EMOTES = ['dance', 'wave', 'flex', 'cheer', 'point', 'sit', 'kiss', 'vogue', 'hairflip', 'heart', 'clap', 'spin', 'laugh', 'cry']
export const EMOTE_S = 3.5
// Each slice's icon: a tiny blocky body striking the pose. Angles in
// degrees, 0 = hanging down, 180 = straight up, + = outward, - = across
// the body: [right arm, left arm, right leg, left leg, head tilt, extra].
const ICON_POSES = {
  dance: [160, 35, 18, -6, -8, 'notes'], wave: [150, 8, 0, 0, 6, 'lines'], flex: [95, 95, 6, 6, 0, ''],
  cheer: [168, 168, 10, 10, 0, 'stars'], point: [90, 5, 0, 0, 0, ''], sit: [25, 25, 0, 0, 0, 'sit'],
  kiss: [-150, 10, 0, 0, 8, 'heart'], vogue: [172, 55, 12, 0, -10, 'flash'], hairflip: [170, 25, 0, 6, 16, 'lines'],
  heart: [-40, -40, 0, 0, 0, 'chestheart'], clap: [-28, -28, 0, 0, 0, 'stars'], spin: [92, 92, 10, 10, 0, 'swirl'],
  laugh: [-18, -18, 8, 8, -10, 'ha'], cry: [-155, -155, 0, 0, 8, 'tears'],
}
const EXTRAS = {
  heart: '<path class="emote-pink" d="M7 -12c0-2 3-2 3 0c0-2 3-2 3 0c0 2-3 3.5-3 4.5c0-1-3-2.5-3-4.5z"/>',
  chestheart: '<path class="emote-pink" d="M-3 -1c0-2.4 3-2.4 3 0c0-2.4 3-2.4 3 0c0 2.4-3 4-3 5c0-1-3-2.6-3-5z"/>',
  lines: '<path class="emote-line" d="M-12 -12l-2.5 -1.5M-12.5 -8.5l-3 0M-12 -5l-2.5 1.5"/>',
  notes: '<path class="emote-pink" d="M10 -13v6.5a1.6 1.6 0 1 1 -1 -1.4v-5.1l3 -1v1z"/>',
  stars: '<path class="emote-pink" d="M-11 -12l1 2 2 1 -2 1 -1 2 -1 -2 -2 -1 2 -1zM11 -12l1 2 2 1 -2 1 -1 2 -1 -2 -2 -1 2 -1z"/>',
  flash: '<path class="emote-pink" d="M9 -14l-2.5 5h2.5l-2 5 5 -6.5h-2.5l2 -3.5z"/>',
  swirl: '<path class="emote-line" d="M-12 9a12 5 0 1 0 6 -4.2"/><path class="emote-pink" d="M-7.2 2.6l2.4 2.4-3.3 .9z"/>',
  ha: '<text class="emote-ha" x="10" y="-10">ha</text>',
  tears: '<path class="emote-tear" d="M-3 -6.5q-1 2 0 2.6q1 -.6 0 -2.6zM3 -6.5q-1 2 0 2.6q1 -.6 0 -2.6z"/>',
  sit: '',
}
// -> SVG markup of an emote's icon, centred on 0 0, about 30 units tall.
function iconSvg(id) {
  const [ar, al, lr, ll, tilt, extra] = ICON_POSES[id] || ICON_POSES.dance
  const sit = extra === 'sit'
  const legH = sit ? 3.5 : 8
  const top = sit ? -9 : -13
  const limb = (x, y, w, h, deg) => `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${h}" rx="0.6" transform="rotate(${deg} ${x} ${y})"/>`
  return `<g class="emote-fig" transform="translate(0 ${sit ? 3 : 0})">`
    + limb(-1.6, top + 14, 3, legH, lr) + limb(1.6, top + 14, 3, legH, -ll)
    + `<rect x="-3.2" y="${top + 6}" width="6.4" height="8.4" rx="0.6"/>`
    + limb(-4.4, top + 6.3, 2.6, 7.6, ar) + limb(4.4, top + 6.3, 2.6, 7.6, -al)
    + `<rect x="-3" y="${top}" width="6" height="6" rx="0.8" transform="rotate(${tilt} 0 ${top + 6})"/>`
    + `</g>${EXTRAS[extra] || ''}`
}
const BLEND_S = 0.22 // how long a body takes to ease into an emote

const lerp = (a, b, k) => a + (b - a) * k
const smooth = (k) => k * k * (3 - 2 * k)

// Poses a blocky body (MenuAvatar3D limbPivots) for an emote at time t
// (seconds). -> how far the body bobs up (body units), or null when
// `emote` isn't one (the caller poses it as usual). Called with '' when
// no emote is playing, so the face, head and spin go back to normal.
export function poseEmote(lp, emote, time) {
  if (!lp) return null
  const g = lp.armR.parent
  const ud = g.userData
  if (!EMOTES.includes(emote)) {
    endEmote(g)
    return null
  }
  // Eases in from standing instead of snapping (smoother).
  if (ud.emoteId !== emote) {
    endEmote(g)
    ud.emoteId = emote
    ud.emoteStart = time
    ud.spinBase = g.rotation.y
  }
  const age = Math.max(0, time - ud.emoteStart)
  const w = smooth(Math.min(1, age / BLEND_S))
  for (const k of ['armR', 'armL', 'legR', 'legL']) lp[k].rotation.set(0, 0, 0)
  const head = { x: 0, z: 0 }
  const bob = _pose(lp, emote, time, age, head, g)
  for (const k of ['armR', 'armL', 'legR', 'legL']) {
    const r = lp[k].rotation
    r.set(r.x * w, r.y * w, r.z * w)
  }
  _tiltHead(g, head.x * w, head.z * w)
  emoteFace(g, emote, time)
  return bob * w
}

function _pose(lp, emote, time, age, head, g) {
  const { armR, armL, legR, legL } = lp
  if (emote === 'dance') {
    const beat = time * 4.2
    // A smooth swap of arms instead of a hard flip.
    const up = smooth(Math.max(0, Math.min(1, 0.5 + Math.sin(beat * 0.5) * 2)))
    armR.rotation.x = lerp(-0.3, -Math.PI * 0.95, up)
    armL.rotation.x = lerp(-Math.PI * 0.95, -0.3, up)
    armR.rotation.z = lerp(-0.5, 0.35, up)
    armL.rotation.z = lerp(-0.35, 0.5, up)
    const step = Math.sin(beat) * 0.35
    legR.rotation.x = step
    legL.rotation.x = -step
    head.z = Math.sin(beat) * 0.12
    return Math.abs(Math.sin(beat)) * 1.2
  }
  if (emote === 'wave') {
    armR.rotation.x = -Math.PI * 0.85
    armR.rotation.z = 0.35 + Math.sin(time * 10) * 0.45
    head.z = 0.08
    return 0
  }
  if (emote === 'cheer') {
    armR.rotation.x = -Math.PI
    armL.rotation.x = -Math.PI
    armR.rotation.z = 0.25 + Math.sin(time * 12) * 0.15
    armL.rotation.z = -0.25 - Math.sin(time * 12) * 0.15
    head.x = -0.15
    return Math.abs(Math.sin(time * 6)) * 1.5
  }
  if (emote === 'point') {
    armR.rotation.x = -Math.PI / 2
    return 0
  }
  if (emote === 'sit') {
    // On the ground: the hips drop to the feet's level (poseSit).
    poseSit(lp)
    armR.rotation.x = -0.35
    armL.rotation.x = -0.35
    return -12
  }
  if (emote === 'kiss') {
    // Hand to the lips, then blown out to the world.
    const c = (age % 1.4) / 1.4
    const k = c < 0.45 ? 0 : smooth(Math.min(1, (c - 0.45) / 0.2))
    armR.rotation.x = lerp(-2.55, -1.45, k)
    armR.rotation.z = lerp(-0.5, 0.55, k)
    armL.rotation.z = -0.15
    head.z = lerp(0.12, -0.05, k)
    return k * 0.3
  }
  if (emote === 'vogue') {
    // Sharp runway shapes, snapping to a new one on the beat.
    const POSES = [[-3.0, 0.3, -0.2, -0.7, 0.18], [-1.7, -0.95, -1.7, 0.95, -0.1], [-0.2, 0.7, -3.0, -0.3, -0.18], [-2.3, 1.25, -2.3, -1.25, 0.1]]
    const n = Math.floor(age / 0.5)
    const a = POSES[(n + 3) % 4]
    const b = POSES[n % 4]
    const k = smooth(Math.min(1, (age % 0.5) / 0.12))
    armR.rotation.x = lerp(a[0], b[0], k)
    armR.rotation.z = lerp(a[1], b[1], k)
    armL.rotation.x = lerp(a[2], b[2], k)
    armL.rotation.z = lerp(a[3], b[3], k)
    head.z = lerp(a[4], b[4], k)
    legR.rotation.z = n % 2 ? 0.12 : 0
    legL.rotation.z = n % 2 ? 0 : -0.12
    return (1 - k) * 0.4
  }
  if (emote === 'hairflip') {
    // A hand flicks past the head, the head tosses, the other on the hip.
    const c = (age % 1.6) / 1.6
    const f = c < 0.25 ? smooth(c / 0.25) : 1 - smooth(Math.min(1, (c - 0.25) / 0.6))
    armR.rotation.x = lerp(-0.5, -2.9, f)
    armR.rotation.z = lerp(0.1, 0.75, f)
    armL.rotation.x = 0.15
    armL.rotation.z = -0.65
    head.z = lerp(-0.05, 0.4, f)
    head.x = lerp(0, -0.2, f)
    return 0
  }
  if (emote === 'heart') {
    // Both hands meet over the chest in a heart, swaying.
    const sway = Math.sin(time * 3) * 0.06
    armR.rotation.x = -1.95 + sway
    armL.rotation.x = -1.95 - sway
    armR.rotation.z = -0.55
    armL.rotation.z = 0.55
    head.z = Math.sin(time * 1.5) * 0.15
    return Math.abs(Math.sin(time * 2)) * 0.35
  }
  if (emote === 'clap') {
    const k = 0.5 + 0.5 * Math.sin(time * 16)
    armR.rotation.x = -1.35
    armL.rotation.x = -1.35
    armR.rotation.z = -0.1 - 0.4 * k
    armL.rotation.z = 0.1 + 0.4 * k
    return Math.abs(Math.sin(time * 4)) * 0.3
  }
  if (emote === 'spin') {
    // A twirl on the spot, arms out, faster as it goes.
    g.rotation.y = g.userData.spinBase + age * age * 1.4 + age * 4
    armR.rotation.z = 1.35
    armL.rotation.z = -1.35
    armR.rotation.x = -0.2
    armL.rotation.x = -0.2
    legR.rotation.z = 0.1
    legL.rotation.z = -0.1
    return Math.abs(Math.sin(time * 6)) * 0.5
  }
  if (emote === 'laugh') {
    // Holding the belly, shaking, head thrown back.
    const shake = Math.sin(time * 15)
    armR.rotation.x = -0.75
    armL.rotation.x = -0.75
    armR.rotation.z = -0.4
    armL.rotation.z = 0.4
    head.x = -0.2 + shake * 0.06
    return Math.abs(shake) * 0.6
  }
  if (emote === 'cry') {
    // Hands over the face, shoulders shaking.
    const sob = Math.sin(time * 11) * 0.08
    armR.rotation.x = -2.55 + sob
    armL.rotation.x = -2.55 - sob
    armR.rotation.z = -0.45
    armL.rotation.z = 0.45
    head.x = 0.22
    return Math.abs(Math.sin(time * 5.5)) * 0.2
  }
  // Flex: both arms up and out, a proud little bounce.
  armR.rotation.x = -Math.PI * 0.5
  armL.rotation.x = -Math.PI * 0.5
  armR.rotation.z = 1.3 + Math.sin(time * 6) * 0.12
  armL.rotation.z = -1.3 - Math.sin(time * 6) * 0.12
  head.x = -0.1
  return Math.abs(Math.sin(time * 3)) * 0.5
}

// Walking during an emote: the legs walk, the rest keeps emoting.
export function walkLegs(lp, swing) {
  lp.legR.rotation.set(swing, 0, 0)
  lp.legL.rotation.set(-swing, 0, 0)
}

// Puts a body's face, head and spin back to normal after an emote.
export function endEmote(g) {
  const ud = g?.userData
  if (!ud?.emoteId) return
  ud.emoteId = ''
  if (ud.spinBase !== undefined) g.rotation.y = ud.spinBase
  _tiltHead(g, 0, 0)
  if (ud.emoteFace) ud.emoteFace.pivot.visible = false
}

// ---------- Faces (Gaymi: "make the face change") ----------
// The skin's own face, with its eyes and mouth painted over by an
// expression while the emote plays: rows 2-7 of the 8x8 face (skins put
// their eyes anywhere from row 2 to 4), columns 1-6; the edges and the
// hair on top stay. e dark, w eye white, b blush, m mouth, r open mouth,
// t tear, k pink, . the skin's own colour.
const FACES = {
  smile: ['........', '.ww..ww.', '.we..ew.', '........', '.m....m.', '..mmmm..'],
  grin: ['........', '.ww..ww.', '.we..ew.', '........', '.mrrrrm.', '..mmmm..'],
  joy: ['........', '..e..e..', '.e.ee.e.', '.b....b.', '..mrrm..', '...mm...'],
  flex: ['.e....e.', '..e..e..', '.we..ew.', '........', '.mmmmmm.', '........'],
  kiss: ['........', '.ww.....', '.we.eee.', '.b....b.', '...kk...', '...kk...'],
  smug: ['........', '.ee..ee.', '.ew..ew.', '........', '.....mm.', '..mmm...'],
  heart: ['........', '.k.kk.k.', '..k..k..', '.b....b.', '.m....m.', '..mmmm..'],
  dizzy: ['.e.ee.e.', '..e..e..', '.e.ee.e.', '........', '...mm...', '...mm...'],
  laughA: ['........', '..e..e..', '.e.ee.e.', '.b....b.', '.mrrrrm.', '..mrrm..'],
  laughB: ['........', '..e..e..', '.e.ee.e.', '.b....b.', '..mrrm..', '...mm...'],
  cryA: ['..e..e..', '.e....e.', '.ee..ee.', '.t....t.', '..mmmm..', '.m....m.'],
  cryB: ['..e..e..', '.e....e.', '.ee..ee.', '........', '.tmmmmt.', '.m....m.'],
  calm: ['........', '........', '.ee..ee.', '........', '.m....m.', '..mmmm..'],
}
const FACE_INK = { e: '#24131f', w: '#ffffff', b: '#ff8fbf', m: '#4a1626', r: '#c2385c', t: '#5ec8ff', k: '#ff4f9a' }
function _faceFor(emote, time) {
  const flip = Math.floor(time * 4) % 2
  return {
    dance: flip ? 'joy' : 'grin', wave: 'grin', flex: 'flex', cheer: 'joy', point: 'smile', sit: 'calm',
    kiss: 'kiss', vogue: 'smug', hairflip: 'smug', heart: 'heart', clap: 'joy', spin: 'dizzy',
    laugh: flip ? 'laughA' : 'laughB', cry: flip ? 'cryA' : 'cryB',
  }[emote] || 'smile'
}

// The head and its hat shell (MenuAvatar3D.buildTexturedCharacter marks
// them isHead).
function _headParts(g) {
  const ud = g.userData
  if (!ud.emoteHead) ud.emoteHead = g.children.filter((c) => c.isMesh && c.userData.isHead)
  return ud.emoteHead
}

function _tiltHead(g, x, z) {
  const parts = _headParts(g)
  for (const m of parts) m.rotation.set(x, 0, z)
  const face = g.userData.emoteFace
  if (face) face.pivot.rotation.set(x, 0, z)
}

export function emoteFace(g, emote, time) {
  const ud = g.userData
  if (ud.emoteFace === undefined) ud.emoteFace = _makeFace(g)
  const face = ud.emoteFace
  if (!face) return
  const key = _faceFor(emote, time)
  let tex = face.cache.get(key)
  if (!tex) face.cache.set(key, tex = _paintFace(face, key))
  if (face.mesh.material.map !== tex) {
    face.mesh.material.map = tex
    face.mesh.material.needsUpdate = true
  }
  face.pivot.visible = true
}

// -> { pivot, mesh, src, sc, skin, cache } or null when the skin can't be
// read (a skin from another site, a body without a head).
function _makeFace(g) {
  try {
    const head = _headParts(g)[0]
    const src = head?.material?.map?.image
    if (!src || !src.getContext) return null
    const sc = Math.max(1, Math.round(src.width / 64))
    const ctx = src.getContext('2d', { willReadFrequently: true })
    const px = ctx.getImageData(8 * sc, 8 * sc, 8 * sc, 8 * sc).data
    // The skin colour: the commonest colour on the face.
    const count = new Map()
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = ((y * sc) * 8 * sc + x * sc) * 4
        if (px[i + 3] < 200) continue
        const c = `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`
        count.set(c, (count.get(c) || 0) + 1)
      }
    }
    const skin = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || '#e0ac8a'
    const mat = head.material.clone()
    mat.map = null
    mat.transparent = false
    mat.alphaTest = 0
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat)
    // Just in front of the (HEAD_BIG times bigger) head's face.
    mesh.position.z = 4.03 * HEAD_BIG
    mesh.scale.setScalar(HEAD_BIG)
    const pivot = new THREE.Group()
    pivot.position.y = HEAD_Y
    pivot.add(mesh)
    pivot.visible = false
    g.add(pivot)
    return { pivot, mesh, src, sc, skin, cache: new Map() }
  } catch {
    return null // a skin from another site can't be read
  }
}

function _paintFace(face, key) {
  const { src, sc, skin } = face
  const c = document.createElement('canvas')
  c.width = c.height = 8 * sc
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, 8 * sc, 8 * sc, 8 * sc, 8 * sc, 0, 0, 8 * sc, 8 * sc)
  FACES[key].forEach((row, r) => {
    for (let x = 1; x < 7; x++) {
      const ch = row[x]
      ctx.fillStyle = FACE_INK[ch] || skin
      ctx.fillRect(x * sc, (r + 2) * sc, sc, sc)
    }
  })
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = face.mesh.material.map?.colorSpace || THREE.SRGBColorSpace
  return tex
}

// An emote's sound: your own full volume, someone else's quieter the
// further off they are (dist in blocks), from their side (pan -1..1).
export function emoteSound(id, pan = 0, dist = 0) {
  const gain = Math.max(0, 1 - dist / 28)
  try { audioEngine.playEmote?.(id, pan, gain) } catch { /* no audio */ }
}

// Sitting in a vehicle (2026-11-01, Gaymi: "you should be sitting not
// standing"): both legs straight out in front. `eye` is how far above
// your feet the seat view is (blocks) -> how far to move the body (world
// units) so the hips land on the seat. Shared by your own body and the
// other players' (PlayNet `sit`).
const HIP_TO_EYE = 1.06 // blocks, on the standard 2-block body
const STAND_HIP = 0.75
export function poseSit(lp) {
  if (!lp) return
  lp.legR.rotation.set(-Math.PI / 2, 0, 0.08)
  lp.legL.rotation.set(-Math.PI / 2, 0, -0.08)
}
export function sitDrop(eye, B) {
  return (eye - HIP_TO_EYE - STAND_HIP) * B
}

export class Emotes {
  constructor(survival) {
    this.s = survival
    this.current = '' // the emote playing now ('' = none)
    this._left = 0
    this._wheel = null
    this._hovered = ''
    this._closing = 0
  }

  get open() {
    return !!this._wheel && !this._wheel.hidden && !this._wheel.classList.contains('closing')
  }

  // The Emote key / touch button: opens or closes the wheel.
  toggleBar() {
    if (this.open) return this.close()
    if (!this.s.active || this.s.dead) return
    this._ensureWheel()
    try { audioEngine.loadEmoteSounds?.() } catch { /* no audio */ }
    clearTimeout(this._closing)
    this._wheel.classList.remove('closing')
    this._wheel.hidden = false
    // Restarts the pop-in animation.
    this._wheel.classList.remove('opening')
    void this._wheel.offsetWidth
    this._wheel.classList.add('opening')
    this._hover('')
    // The real mouse, to click one. Keys you're holding stay held, so you
    // keep walking while you pick (2026-11-20, Gaymi: "you can keep doing
    // what you were doing").
    if (document.pointerLockElement) document.exitPointerLock()
  }

  close(relock = true) {
    if (!this.open) return
    // A quick fade out, then gone.
    const wheel = this._wheel
    wheel.classList.add('closing')
    clearTimeout(this._closing)
    this._closing = setTimeout(() => {
      wheel.hidden = true
      wheel.classList.remove('closing')
    }, 150)
    if (relock && !this.s.dead && this.s.active) {
      try { this.s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  // A number key while the wheel is open picks that emote (1-9, then 0
  // for the 10th). -> true if it was used (the hotbar leaves it alone).
  pick(code) {
    if (!this.open) return false
    const m = /^Digit([0-9])$/.exec(code)
    const id = m && EMOTES[m[1] === '0' ? 9 : Number(m[1]) - 1]
    if (!id) return false
    this.play(id)
    return true
  }

  play(id) {
    if (!EMOTES.includes(id) || !this.s.active || this.s.dead) return
    this.current = id
    this._left = EMOTE_S
    this.s.bingo?.note('emote')
    emoteSound(id)
    this.close()
  }

  // Ends it (it runs out, you die, or you sit in a seat). Walking no
  // longer stops it (2026-11-20): your legs walk and the rest keeps going.
  stop() {
    this.current = ''
    this._left = 0
  }

  update(dt) {
    if (this.current && this.s.dead) this.stop()
    // Selfie Cam (PlaySpectate): it keeps going until the selfie ends.
    if (this._left > 0 && !this.s.bm?.spectate?.selfie && (this._left -= dt) <= 0) this.stop()
    if (this.open && (this.s.dead || !this.s.active)) this.close(false)
  }

  clear() {
    this.stop()
    this.close(false)
  }

  // A pie of slices (SVG, viewBox -100..100): each slice an emoji, the
  // pointed-at one pink and nudged out, its name in the middle.
  _ensureWheel() {
    if (this._wheel) {
      this._label()
      return
    }
    const n = EMOTES.length
    const step = (Math.PI * 2) / n
    const R1 = 38 // inner edge
    const R2 = 96 // outer edge
    const pt = (r, a) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`
    const slices = EMOTES.map((id, i) => {
      const a0 = (i - 0.5) * step
      const a1 = (i + 0.5) * step
      const mid = i * step
      const d = `M${pt(R1, a0)} L${pt(R2, a0)} A${R2} ${R2} 0 0 1 ${pt(R2, a1)} L${pt(R1, a1)} A${R1} ${R1} 0 0 0 ${pt(R1, a0)}Z`
      const [ix, iy] = pt(63, mid).split(' ')
      const [kx, ky] = pt(87, mid).split(' ')
      const key = i < 10 ? `<text class="emote-key" x="${kx}" y="${ky}">${(i + 1) % 10}</text>` : ''
      return `<g class="emote-slice" data-emote="${id}" role="button" tabindex="0" style="--i:${i}; --dx:${(Math.sin(mid) * 4).toFixed(2)}px; --dy:${(-Math.cos(mid) * 4).toFixed(2)}px">`
        // The see-through .emote-hit is what the mouse points at, and it
        // never moves; only .emote-look slides out. When the whole slice
        // slid, a mouse near its edge was left pointing at nothing, so it
        // un-lit, slid back under the mouse, lit again... a flicker
        // (2026-11-20). Rule: what you hover must not move away.
        + `<path class="emote-hit" d="${d}"/><g class="emote-look"><path d="${d}"/><g class="emote-icon" transform="translate(${ix} ${iy}) scale(0.82)">${iconSvg(id)}</g>${key}</g></g>`
    }).join('')
    const wheel = document.createElement('div')
    wheel.id = 'emote-wheel'
    wheel.hidden = true
    wheel.innerHTML = `<div class="emote-ring"><svg viewBox="-100 -100 200 200">`
      + `<defs><radialGradient id="emote-pink" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse"><stop offset="0.38" stop-color="#ff86c2"/><stop offset="1" stop-color="#e2338a"/></radialGradient></defs>`
      + `${slices}</svg><div class="emote-mid"><svg class="emote-mid-icon" viewBox="-17 -17 34 34" aria-hidden="true"></svg><span></span></div></div>`
    wheel.addEventListener('click', (e) => {
      const slice = e.target.closest('[data-emote]')
      if (slice) this.play(slice.dataset.emote)
      // A click off the ring (or its middle) closes it.
      else this.close()
    })
    wheel.addEventListener('keydown', (e) => {
      const slice = e.target.closest?.('[data-emote]')
      if (slice && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        this.play(slice.dataset.emote)
      }
    })
    wheel.addEventListener('pointerover', (e) => this._hover(e.target.closest('[data-emote]')?.dataset.emote || ''))
    wheel.addEventListener('focusin', (e) => this._hover(e.target.closest?.('[data-emote]')?.dataset.emote || ''))
    document.body.appendChild(wheel)
    this._wheel = wheel
    this._label()
  }

  _name(id) {
    return t(`emote${id.charAt(0).toUpperCase()}${id.slice(1)}`)
  }

  // The middle says which one you're pointing at, with its icon.
  _hover(id) {
    if (!this._wheel) return
    if (id !== this._hovered) {
      this._wheel.querySelector('.is-hot')?.classList.remove('is-hot')
      if (id) this._wheel.querySelector(`[data-emote="${id}"]`)?.classList.add('is-hot')
      if (id) try { audioEngine.playUiHover?.() } catch { /* no audio */ }
      this._hovered = id
    }
    const mid = this._wheel.querySelector('.emote-mid')
    if (!mid) return
    mid.querySelector('.emote-mid-icon').innerHTML = id ? iconSvg(id) : ''
    mid.querySelector('span').textContent = id ? this._name(id) : t('actionEmote')
    mid.classList.toggle('has-icon', !!id)
  }

  _label() {
    for (const g of this._wheel.querySelectorAll('[data-emote]')) g.setAttribute('aria-label', this._name(g.dataset.emote))
    this._hovered = null
    this._hover('')
  }
}
