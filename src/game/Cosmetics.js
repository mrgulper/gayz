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
import { BODY_WIDE, HEAD_BIG, HEAD_TOP_Y } from './MenuAvatar3D.js'
import { t } from './i18n.js'
import { ownedWorldGoalRewards } from './WorldGoal.js'
import { makeBack, placeBack, drawBackIcon } from './BackItems.js'

// need: { level | kills | runs | deaths: n } - reach it to unlock.
// need: { worldGoal: id } - a World Goal reward (WorldGoal.js, 2026-11-19):
// help the world finish that weekly goal, then claim it on the homepage.
export const COSMETICS = {
  propeller: { slot: 'hat', need: { runs: 3 } },
  party: { slot: 'hat', need: { level: 3 } },
  chicken: { slot: 'hat', need: { deaths: 25 } },
  cone: { slot: 'hat', need: { kills: 250 } },
  crown: { slot: 'hat', need: { level: 15 } },
  redCape: { slot: 'cape', need: { runs: 10 }, colors: [0xc8282e, 0xe0484c] },
  rainbowCape: { slot: 'cape', need: { level: 8 }, colors: [0xff5ca8, 0xffd23f, 0x7dff8a, 0x5cc8ff, 0xa98bff] },
  goldCape: { slot: 'cape', need: { kills: 1000 }, colors: [0xf2c94c, 0xd4a52c] },
  hunterHat: { slot: 'hat', need: { worldGoal: 'kills' } },
  nightCape: { slot: 'cape', need: { worldGoal: 'nights' }, colors: [0x141a3a, 0x1f2a5c, 0xf2e27a, 0x1f2a5c, 0x141a3a] },
  targetHat: { slot: 'hat', need: { worldGoal: 'headshots' } },
  bossCape: { slot: 'cape', need: { worldGoal: 'bosses' }, colors: [0x2a0f3a, 0x6a1f8a, 0xb43cff] },
  coinHat: { slot: 'hat', need: { worldGoal: 'coins' } },
  bladeCape: { slot: 'cape', need: { worldGoal: 'knifeKills' }, colors: [0x8a929c, 0xc8d0d8, 0x5a626c] },
  // need: { shop: bundleId } - only from a Shop bundle (ShopBundles.js,
  // 2026-11-25). Owned ones live in the save's shopCosmetics.
  santaHat: { slot: 'hat', need: { shop: 'winter' } },
  snowCape: { slot: 'cape', need: { shop: 'winter' }, colors: [0xffffff, 0xcfe8ff, 0xffffff, 0x9fd0ff, 0xffffff] },
  fireHelmet: { slot: 'hat', need: { shop: 'survivor' } },
  safetyCape: { slot: 'cape', need: { shop: 'survivor' }, colors: [0xff7a1a, 0xffe14d, 0xff7a1a, 0xffe14d, 0xff7a1a] },
  dragonHorns: { slot: 'hat', need: { shop: 'creatures' } },
  dragonCape: { slot: 'cape', need: { shop: 'creatures' }, colors: [0x1f6a2a, 0x2e8a3a, 0x7a1a1a, 0xb82a1a] },
  // need: { shop: 'buy' } - sold one by one in Shop > Hats / Capes / Back
  // Items (ShopCosmetics.js, 2026-11-25). price: [currency, amount]; coins
  // for the plain ones, gems for the fancy ones (prices are a guess).
  beanie: { slot: 'hat', need: { shop: 'buy' }, price: ['coins', 10000] },
  chefHat: { slot: 'hat', need: { shop: 'buy' }, price: ['coins', 10000] },
  bunnyEars: { slot: 'hat', need: { shop: 'buy' }, price: ['coins', 15000] },
  headphones: { slot: 'hat', need: { shop: 'buy' }, price: ['coins', 15000] },
  cowboyHat: { slot: 'hat', need: { shop: 'buy' }, price: ['coins', 25000] },
  pirateHat: { slot: 'hat', need: { shop: 'buy' }, price: ['coins', 25000] },
  topHat: { slot: 'hat', need: { shop: 'buy' }, price: ['coins', 25000] },
  vikingHelmet: { slot: 'hat', need: { shop: 'buy' }, price: ['coins', 50000] },
  wizardHat: { slot: 'hat', need: { shop: 'buy' }, price: ['gems', 250] },
  halo: { slot: 'hat', need: { shop: 'buy' }, price: ['gems', 500] },
  zebraCape: { slot: 'cape', need: { shop: 'buy' }, price: ['coins', 10000], colors: [0x1a1a1a, 0xffffff, 0x1a1a1a, 0xffffff, 0x1a1a1a, 0xffffff, 0x1a1a1a] },
  toxicCape: { slot: 'cape', need: { shop: 'buy' }, price: ['coins', 15000], colors: [0x2a3a0a, 0x5a8a1a, 0x9aff3a, 0x5a8a1a, 0x2a3a0a] },
  iceCape: { slot: 'cape', need: { shop: 'buy' }, price: ['coins', 25000], colors: [0xffffff, 0xcfe8ff, 0x9fd0ff, 0x5cc8ff, 0x2a8ad8] },
  flameCape: { slot: 'cape', need: { shop: 'buy' }, price: ['coins', 50000], colors: [0xffe14d, 0xffa31a, 0xff5a1a, 0xd0202a, 0x7a0f14] },
  royalCape: { slot: 'cape', need: { shop: 'buy' }, price: ['gems', 250], colors: [0x6a1f8a, 0x6a1f8a, 0xf2c94c, 0x6a1f8a, 0x4a0f6a] },
  galaxyCape: { slot: 'cape', need: { shop: 'buy' }, price: ['gems', 500], colors: [0x0a0a2a, 0x2a1a5a, 0x5a2a9a, 0xff5ca8, 0x2a1a5a, 0x0a0a2a] },
  // Back items (BackItems.js): wings and backpacks, their own slot.
  survivalPack: { slot: 'back', need: { shop: 'buy' }, price: ['coins', 15000] },
  teddyPack: { slot: 'back', need: { shop: 'buy' }, price: ['coins', 25000] },
  guitar: { slot: 'back', need: { shop: 'buy' }, price: ['coins', 25000] },
  jetpack: { slot: 'back', need: { shop: 'buy' }, price: ['coins', 50000] },
  butterflyWings: { slot: 'back', need: { shop: 'buy' }, price: ['coins', 50000] },
  batWings: { slot: 'back', need: { shop: 'buy' }, price: ['gems', 250] },
  angelWings: { slot: 'back', need: { shop: 'buy' }, price: ['gems', 500] },
  dragonWings: { slot: 'back', need: { shop: 'buy' }, price: ['gems', 1000] },
}
export const COSMETIC_IDS = Object.keys(COSMETICS)

// Hats and capes bought in Shop > Bundles: game.shopCosmetics, { id: count },
// kept in the shop save next to charSkins. Game hands itself over at start;
// read live, so a replaced object (Cloud Save restore, tests) still counts.
let shopGame = null
export function setShopCosmetics(game) { shopGame = game }
export const ownsShopCosmetic = (id) => (Number(shopGame?.shopCosmetics?.[id]) || 0) > 0

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
  if (c.need.worldGoal) return ownedWorldGoalRewards(career).has(id)
  if (c.need.shop) return ownsShopCosmetic(id)
  const have = progress(career)
  return Object.entries(c.need).every(([k, n]) => have[k] >= n)
}

// "Reach level 3", "Kill 250 zombies"... -> the unlock line.
export function needText(id) {
  const [k, n] = Object.entries(COSMETICS[id].need)[0]
  if (k === 'worldGoal') return t('cosmeticNeedWorldGoal')
  if (k === 'shop') return t(n === 'buy' ? 'killFxBuyInShop' : 'cosmeticNeedBundle')
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
    if (kind === 'worldGoal' || kind === 'shop') continue // not earned by playing more
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

// The ones `after` has unlocked that `before` hadn't (by playing - a
// Shop buy isn't an unlock).
export function newlyUnlocked(before, after) {
  return COSMETIC_IDS.filter((id) => !COSMETICS[id].need.shop && isUnlocked(id, after) && !isUnlocked(id, before))
}

export function cosmeticName(id) {
  return t(`cosmetic${id.charAt(0).toUpperCase()}${id.slice(1)}`)
}

// What a player wears, cleaned: an id that isn't a hat/cape (or not one
// of that slot) is nothing.
export function cleanWorn(id, slot) {
  return COSMETICS[id]?.slot === slot ? id : ''
}

// The setting that holds what's worn in each slot.
export const WORN_SETTING = { hat: 'cosmeticHat', cape: 'cosmeticCape', back: 'cosmeticBack' }

// What I wear in a slot ('hat' / 'cape' / 'back'): the one picked in
// Inventory, as long as it's really unlocked (a hand-edited save can't
// skip ahead).
export function myWorn(game, slot) {
  const id = cleanWorn(game?.settings?.[WORN_SETTING[slot]], slot)
  return id && isUnlocked(id, game.careerStats) ? id : ''
}

let capeGeo = null
// A cape hanging off the shoulders, flaring back a little; stripes for
// one of more colours. (Zombies wear them too - BuildSurvival.)
export function makeCape(id) {
  const colors = COSMETICS[id]?.colors
  if (!colors) return null
  if (!capeGeo) {
    capeGeo = new THREE.BoxGeometry(BODY_WIDE * 8, 1, 0.6)
    capeGeo.translate(0, -0.5, 0)
  }
  const cape = new THREE.Group()
  cape.name = 'cosmeticCape'
  // Just behind the (widened) body's back.
  cape.position.set(0, 22, -BODY_WIDE * 2 - 0.4)
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

// Puts `hat`, `cape` and `back` (ids, '' = none) on a blocky body,
// swapping out what it wore. Remembers them on the body (userData.worn)
// so calling it every frame with the same ones does nothing.
export function wearCosmetics(char, hat, cape, back = '') {
  if (!char) return
  const worn = char.userData.worn || (char.userData.worn = { hat: '', cape: '', back: '', hatObj: null, capeObj: null, backObj: null })
  hat = cleanWorn(hat, 'hat')
  cape = cleanWorn(cape, 'cape')
  back = cleanWorn(back, 'back')
  const capeWas = worn.cape
  if (worn.hat !== hat) {
    if (worn.hatObj) {
      char.remove(worn.hatObj)
      disposeHat(worn.hatObj)
    }
    worn.hatObj = hat ? makeHat(hat) : null
    if (worn.hatObj) {
      // Sized and placed for the player's bigger head (MenuAvatar3D).
      worn.hatObj.scale.multiplyScalar(HEAD_BIG)
      worn.hatObj.position.y = HEAD_TOP_Y
      char.add(worn.hatObj)
    }
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
  if ((worn.back || '') !== back) {
    if (worn.backObj) {
      char.remove(worn.backObj)
      disposeHat(worn.backObj)
    }
    worn.backObj = back ? makeBack(back) : null
    if (worn.backObj) {
      placeBack(worn.backObj, back, !!cape)
      char.add(worn.backObj)
    }
    worn.back = back
  } else if (worn.backObj && !!capeWas !== !!cape) placeBack(worn.backObj, back, !!cape)
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
  if (COSMETICS[id]?.slot === 'back') {
    drawBackIcon(g, id)
  } else if (COSMETICS[id]?.slot === 'cape') {
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
