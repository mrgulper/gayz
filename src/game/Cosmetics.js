// Hats and capes (2026-10-31, Gaymi's funny update: "cosmetics: hats,
// capes and silly skins" - picked "unlock by playing"). Each one unlocks
// from what you've already done (career stats: level, zombies killed,
// games played, deaths) and is worn from Inventory > Hats & Capes. Your
// own body shows it in third person, and on a server everyone sees it
// (PlayNet state `hat` / `cape`). One hat and one cape at a time, kept in
// settings (cosmeticHat / cosmeticCape), so Cloud Save carries them.
//
// Built from boxes in the blocky body's own units (MenuAvatar3D: the head
// sits on y 22-30, the torso spans y 10-22 and is 4 deep), like the
// zombies' hats (FunnyZombies.js, which builds the hats).
import * as THREE from 'three'
import { makeHat, disposeHat, HAT_BOX_COLORS } from './FunnyZombies.js'
import { levelFromXp } from './Xp.js'
import { t } from './i18n.js'

// need: { level | kills | runs | deaths: n } - reach it to unlock.
export const COSMETICS = {
  propeller: { slot: 'hat', need: { runs: 3 } },
  party: { slot: 'hat', need: { level: 3 } },
  chicken: { slot: 'hat', need: { deaths: 25 } },
  cone: { slot: 'hat', need: { kills: 250 } },
  crown: { slot: 'hat', need: { level: 15 } },
  redCape: { slot: 'cape', need: { runs: 10 }, colors: [0xc8282e, 0xe0484c] },
  rainbowCape: { slot: 'cape', need: { level: 8 }, colors: [0xff5ca8, 0xffd23f, 0x7dff8a, 0x5cc8ff, 0xa98bff] },
  goldCape: { slot: 'cape', need: { kills: 1000 }, colors: [0xf2c94c, 0xd4a52c] },
}
export const COSMETIC_IDS = Object.keys(COSMETICS)

// How far along `career` (Game.careerStats) is toward each need.
function progress(career = {}) {
  return {
    level: levelFromXp(career.xp || 0).level,
    kills: career.totalKills || 0,
    runs: career.totalRuns || 0,
    deaths: career.totalDeaths || 0,
  }
}

export function isUnlocked(id, career) {
  const c = COSMETICS[id]
  if (!c) return false
  const have = progress(career)
  return Object.entries(c.need).every(([k, n]) => have[k] >= n)
}

// "Reach level 3", "Kill 250 zombies"... -> the unlock line.
export function needText(id) {
  const [k, n] = Object.entries(COSMETICS[id].need)[0]
  return t(`cosmeticNeed${k.charAt(0).toUpperCase()}${k.slice(1)}`, { n })
}

// Reasons to come back (2026-10-31): the locked hat or cape you're
// closest to, for the end-of-game card ("3 more games for the Red
// Cape!"). { id, kind, left, need } or null once everything's unlocked.
export function nextUnlock(career) {
  const have = progress(career)
  let best = null
  for (const id of COSMETIC_IDS) {
    if (isUnlocked(id, career)) continue
    const [kind, need] = Object.entries(COSMETICS[id].need)[0]
    const frac = have[kind] / need
    if (!best || frac > best.frac) best = { id, kind, need, left: need - have[kind], frac }
  }
  return best
}

export function nextUnlockText(u) {
  if (!u) return ''
  const key = `unlockSoon${u.kind.charAt(0).toUpperCase()}${u.kind.slice(1)}${u.left === 1 && u.kind !== 'level' ? 'One' : ''}`
  return t(key, { n: u.kind === 'level' ? u.need : u.left, name: cosmeticName(u.id) })
}

// The ones `after` has unlocked that `before` hadn't.
export function newlyUnlocked(before, after) {
  return COSMETIC_IDS.filter((id) => isUnlocked(id, after) && !isUnlocked(id, before))
}

export function cosmeticName(id) {
  return t(`cosmetic${id.charAt(0).toUpperCase()}${id.slice(1)}`)
}

// What a player wears, cleaned: an id that isn't a hat/cape (or not one
// of that slot) is nothing.
export function cleanWorn(id, slot) {
  return COSMETICS[id]?.slot === slot ? id : ''
}

// What I wear in a slot ('hat' / 'cape'): the one picked in Inventory,
// as long as it's really unlocked (a hand-edited save can't skip ahead).
export function myWorn(game, slot) {
  const id = cleanWorn(game?.settings?.[slot === 'hat' ? 'cosmeticHat' : 'cosmeticCape'], slot)
  return id && isUnlocked(id, game.careerStats) ? id : ''
}

let capeGeo = null
// A cape hanging off the shoulders, flaring back a little; stripes for
// one of more colours.
function makeCape(id) {
  const colors = COSMETICS[id]?.colors
  if (!colors) return null
  if (!capeGeo) {
    capeGeo = new THREE.BoxGeometry(8, 1, 0.6)
    capeGeo.translate(0, -0.5, 0)
  }
  const cape = new THREE.Group()
  cape.name = 'cosmeticCape'
  cape.position.set(0, 22, -2.4)
  cape.rotation.x = 0.18
  const rows = 14
  for (let i = 0; i < rows; i++) {
    const mesh = new THREE.Mesh(capeGeo, new THREE.MeshLambertMaterial({ color: colors[Math.floor((i / rows) * colors.length)] }))
    mesh.position.y = -i
    mesh.userData.shared = true
    cape.add(mesh)
  }
  return cape
}

// Puts `hat` and `cape` (ids, '' = none) on a blocky body, swapping out
// what it wore. Remembers them on the body (userData.worn) so calling
// it every frame with the same ones does nothing.
export function wearCosmetics(char, hat, cape) {
  if (!char) return
  const worn = char.userData.worn || (char.userData.worn = { hat: '', cape: '', hatObj: null, capeObj: null })
  hat = cleanWorn(hat, 'hat')
  cape = cleanWorn(cape, 'cape')
  if (worn.hat !== hat) {
    if (worn.hatObj) {
      char.remove(worn.hatObj)
      disposeHat(worn.hatObj)
    }
    worn.hatObj = hat ? makeHat(hat) : null
    if (worn.hatObj) char.add(worn.hatObj)
    worn.hat = hat
  }
  if (worn.cape !== cape) {
    if (worn.capeObj) {
      char.remove(worn.capeObj)
      disposeHat(worn.capeObj)
    }
    worn.capeObj = cape ? makeCape(cape) : null
    if (worn.capeObj) char.add(worn.capeObj)
    worn.cape = cape
  }
}

// A small flat picture of one (Inventory card): its boxes seen from the
// front, as a data URL.
const iconCache = new Map()
export function cosmeticIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id)
  const c = document.createElement('canvas')
  c.width = c.height = 48
  const g = c.getContext('2d')
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
  if (COSMETICS[id]?.slot === 'cape') {
    const colors = COSMETICS[id].colors
    colors.forEach((col, i) => {
      g.fillStyle = hex(col)
      g.fillRect(12, 6 + (i * 36) / colors.length, 24, 36 / colors.length + 1)
    })
    g.fillStyle = 'rgba(0,0,0,0.25)'
    g.fillRect(12, 6, 24, 3)
  } else {
    // Hat boxes: [w, h, d, y, colour, x] in body units, 3px each, sat on
    // a head-coloured block.
    g.fillStyle = '#c99a72'
    g.fillRect(12, 34, 24, 12)
    for (const [w, h, , y, col, x = 0] of HAT_BOX_COLORS(id)) {
      g.fillStyle = hex(col)
      g.fillRect(24 + (x - w / 2) * 3, 34 - (y + h / 2) * 3, w * 3, h * 3)
    }
  }
  const url = c.toDataURL()
  iconCache.set(id, url)
  return url
}
