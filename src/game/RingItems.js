// The spin ring's items (2026-11-15, Batch 2 of the spin ring plan): 10
// original items, each in the 6 rarities the skins use (common -> mythic).
// A rarer copy of an item is the same item, only stronger: more damage,
// more healing, a stronger effect, and it grows back a little faster.
//
// An item in the bag or the ring is written "id:rarity" (e.g. "brick:rare").
// The bag (gayz-ring-bag) is { "id:rarity": count } and the ring
// (gayz-ring-loadout) is a list of ringSlots() of those (or '' for an empty
// slot). Both are gayz-* keys, so Cloud Save carries them like coins and
// skins; the bag's counts add up across devices (CloudMerge ADDITIVE_KEYS).
// The three common starters (brick, saw blade, bandage) are always yours,
// one of each, without being in the bag.
import * as THREE from 'three'
import { SKIN_RARITIES } from './InventorySkins.js'

// Batch 3: everyone has 3 slots; more (up to 10) are bought with Points in
// the Shop's Ring tab and kept forever (gayz-meta-progress ringSlotsBought).
export const RING_SLOTS = 3
export const MAX_SLOTS = 10
const META_KEY = 'gayz-meta-progress'
// Points for slot 4, 5, ... 10.
export const SLOT_COSTS = [500, 1000, 2000, 3500, 5500, 8000, 12000]
export const RARITIES = Object.keys(SKIN_RARITIES) // common ... mythic
export const BAG_KEY = 'gayz-ring-bag'
export const LOADOUT_KEY = 'gayz-ring-loadout'

// Base (common) numbers. damage = per touch; reload = seconds to grow back
// (bite = seconds between bites on the same zombie, for items that never
// break); heal = health per Bandage; slow = seconds a zombie stays slowed;
// zap = zombies the Battery's jolt jumps to; blast = Firecracker's radius
// (blocks); guard = damage the Shield Plate soaks up; pull = how far away
// (blocks) the Magnet pulls dropped items in from; thorns = damage back to a
// zombie that bites you while the Cactus is in your ring.
export const RING_ITEMS = {
  brick: { nameKey: 'ringItemBrick', aboutKey: 'ringItemBrickAbout', damage: 25, reload: 0.8, breaks: true },
  sawblade: { nameKey: 'ringItemSaw', aboutKey: 'ringItemSawAbout', damage: 12, bite: 0.35 },
  bandage: { nameKey: 'ringItemBandage', aboutKey: 'ringItemBandageAbout', heal: 15, reload: 5 },
  icecube: { nameKey: 'ringItemIce', aboutKey: 'ringItemIceAbout', damage: 6, reload: 1.2, breaks: true, slow: 2 },
  battery: { nameKey: 'ringItemBattery', aboutKey: 'ringItemBatteryAbout', damage: 10, reload: 1.6, breaks: true, zap: 2 },
  shield: { nameKey: 'ringItemShield', aboutKey: 'ringItemShieldAbout', guard: 20, reload: 6 },
  firecracker: { nameKey: 'ringItemFirecracker', aboutKey: 'ringItemFirecrackerAbout', damage: 15, reload: 2.5, breaks: true, blast: 2.5 },
  magnet: { nameKey: 'ringItemMagnet', aboutKey: 'ringItemMagnetAbout', pull: 6 },
  cactus: { nameKey: 'ringItemCactus', aboutKey: 'ringItemCactusAbout', damage: 5, bite: 0.5, thorns: 6 },
}
export const ITEM_IDS = Object.keys(RING_ITEMS)
export const STARTERS = ['brick:common', 'sawblade:common', 'bandage:common']

// Each rarity step: x1.5 power, 6% faster grow-back.
const POWER_STEP = 1.5
const RELOAD_STEP = 0.06

export function rarityIndex(r) {
  return Math.max(0, RARITIES.indexOf(r))
}

export function parseKey(key) {
  const [id, rarity] = String(key || '').split(':')
  if (!RING_ITEMS[id] || !RARITIES.includes(rarity)) return null
  return { id, rarity }
}

// An item's numbers at a rarity.
export function itemStats(id, rarity) {
  const base = RING_ITEMS[id]
  const i = rarityIndex(rarity)
  const power = POWER_STEP ** i
  const out = { ...base, rarity, id }
  for (const f of ['damage', 'heal', 'guard', 'thorns']) if (base[f]) out[f] = Math.round(base[f] * power)
  if (base.reload) out.reload = +(base.reload * (1 - RELOAD_STEP * i)).toFixed(2)
  if (base.bite) out.bite = +(base.bite * (1 - RELOAD_STEP * i)).toFixed(2)
  if (base.slow) out.slow = +(base.slow * (1 + 0.3 * i)).toFixed(1)
  if (base.zap) out.zap = base.zap + Math.floor(i / 2)
  if (base.blast) out.blast = +(base.blast * (1 + 0.12 * i)).toFixed(1)
  if (base.pull) out.pull = base.pull + i * 1.5
  return out
}

// --- which rarity a zombie drops ---

// Every zombie drops one item (Gaymi: "each zombie must drop something").
// Out of 1000: mostly Common, Mythic one in a thousand.
const DROP_WEIGHTS = [600, 250, 100, 40, 9, 1]

// tier: the zombie's own rarity (ZombieNames.js) - a rarer zombie drops at
// least one step below its own; a boss drops two steps up, Rare at least.
export function rollDrop(boss = false, tier = 'common', rand = Math.random) {
  let roll = rand() * 1000
  let i = 0
  while (i < DROP_WEIGHTS.length - 1 && roll >= DROP_WEIGHTS[i]) roll -= DROP_WEIGHTS[i++]
  i = Math.max(i, rarityIndex(tier) - 1)
  if (boss) i = Math.max(2, i + 2)
  i = Math.min(RARITIES.length - 1, i)
  const id = ITEM_IDS[Math.floor(rand() * ITEM_IDS.length) % ITEM_IDS.length]
  return `${id}:${RARITIES[i]}`
}

// --- the bag ---

export function loadBag() {
  let bag = {}
  try {
    const raw = JSON.parse(localStorage.getItem(BAG_KEY) || '{}')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, n] of Object.entries(raw)) if (parseKey(k) && Number.isFinite(n) && n > 0) bag[k] = Math.min(99999, Math.floor(n))
    }
  } catch { bag = {} }
  return bag
}

export function saveBag(bag) {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)) } catch { /* storage full or blocked */ }
}

export function addToBag(key, n = 1) {
  if (!parseKey(key)) return false
  const bag = loadBag()
  bag[key] = (bag[key] || 0) + n
  saveBag(bag)
  return true
}

// How many of an item you have: the bag's, plus the free starter.
export function owned(key, bag = loadBag()) {
  return (bag[key] || 0) + (STARTERS.includes(key) ? 1 : 0)
}

// Everything you own, rarest first, then in item order.
export function ownedList(bag = loadBag()) {
  const keys = new Set([...STARTERS, ...Object.keys(bag)])
  return [...keys].filter((k) => parseKey(k) && owned(k, bag) > 0).sort((a, b) => {
    const pa = parseKey(a)
    const pb = parseKey(b)
    return rarityIndex(pb.rarity) - rarityIndex(pa.rarity) || ITEM_IDS.indexOf(pa.id) - ITEM_IDS.indexOf(pb.id)
  })
}

// The ring you picked: every slot something you own (no more copies of an
// item than you have); a broken or missing save gives the starters.
export function loadLoadout(bag = loadBag()) {
  let list
  try {
    list = JSON.parse(localStorage.getItem(LOADOUT_KEY) || 'null')
  } catch { list = null }
  if (!Array.isArray(list)) return STARTERS.slice()
  return fitLoadout(list, bag)
}

export function fitLoadout(list, bag = loadBag()) {
  const used = {}
  const out = []
  for (let i = 0; i < ringSlots(); i++) {
    const k = typeof list[i] === 'string' ? list[i] : ''
    if (k && parseKey(k) && (used[k] || 0) < owned(k, bag)) {
      used[k] = (used[k] || 0) + 1
      out.push(k)
    } else out.push('')
  }
  return out
}

export function saveLoadout(list) {
  try { localStorage.setItem(LOADOUT_KEY, JSON.stringify(list)) } catch { /* storage full or blocked */ }
}

// --- ring slots (Batch 3) ---

// How many slots your ring has right now (3 to 10).
export function ringSlots() {
  let bought
  try { bought = Math.floor(Number(JSON.parse(localStorage.getItem(META_KEY) || '{}').ringSlotsBought) || 0) } catch { bought = 0 }
  return Math.max(RING_SLOTS, Math.min(MAX_SLOTS, RING_SLOTS + bought))
}

// Points for the next slot (undefined once you have all 10).
export function nextSlotCost(slots = ringSlots()) {
  return SLOT_COSTS[slots - RING_SLOTS]
}

// --- merging (Batch 3): 5 of the same item -> 1 of the next rarity ---

export const MERGE_N = 5

export function nextRarity(rarity) {
  return RARITIES[rarityIndex(rarity) + 1] || null
}

// How many merges the bag has for an item (the free starter copy never
// counts - only copies in the bag).
export function mergesAvailable(key, bag = loadBag()) {
  const p = parseKey(key)
  if (!p || !nextRarity(p.rarity)) return 0
  return Math.floor((bag[key] || 0) / MERGE_N)
}

// Merges up to `times` (Infinity = all). Always works (Gaymi's pick).
// Returns { made, key } - how many of which item came out.
export function mergeItem(key, times = 1) {
  const p = parseKey(key)
  const bag = loadBag()
  const n = Math.min(times, mergesAvailable(key, bag))
  if (!p || n <= 0) return { made: 0, key: '' }
  const up = `${p.id}:${nextRarity(p.rarity)}`
  bag[key] -= n * MERGE_N
  if (bag[key] <= 0) delete bag[key]
  bag[up] = (bag[up] || 0) + n
  saveBag(bag)
  return { made: n, key: up }
}

// --- the Shop's ring items (Batch 3, paid in Points) ---

// Points for one item at each rarity: x4 a step (a merge takes 5, so
// buying the rarer one straight away is a little cheaper).
export const SHOP_PRICES = [40, 160, 640, 2560, 10240, 40960]
// Common, Uncommon and Rare are always for sale. Epic and up only some
// days (Gaymi: "make higher rarities rarer"): each item's Epic is in stock
// 40% of days, Legendary 15%, Mythic 4% - and only one each that day.
const DAILY_CHANCE = [1, 1, 1, 0.4, 0.15, 0.04]
export const ALWAYS_STOCKED = 3
const SHOP_DAY_KEY = 'gayz-ring-shop'
// The Mystery Box: one random item, rarer ones less often (out of 1000).
export const BOX_COST = 350
const BOX_WEIGHTS = [550, 280, 120, 40, 9, 1]

export function shopPrice(rarity) {
  return SHOP_PRICES[rarityIndex(rarity)]
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A steady 0-1 number from a text (same day + item = same answer).
function hash01(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0) % 100000) / 100000
}

function boughtToday(day = todayKey()) {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOP_DAY_KEY) || '{}')
    if (raw?.day === day && Array.isArray(raw.bought)) return raw.bought.filter((k) => typeof k === 'string')
  } catch { /* broken save: nothing bought */ }
  return []
}

// 'always' (buy as many as you like), 'today' (one left today),
// 'sold' (bought today) or 'none' (not in stock today).
export function stockOf(key, day = todayKey()) {
  const p = parseKey(key)
  if (!p) return 'none'
  const i = rarityIndex(p.rarity)
  if (i < ALWAYS_STOCKED) return 'always'
  if (hash01(`${day}|${key}`) >= DAILY_CHANCE[i]) return 'none'
  return boughtToday(day).includes(key) ? 'sold' : 'today'
}

// Marks a rare-stock item bought for today.
export function markBought(key, day = todayKey()) {
  const list = boughtToday(day)
  if (!list.includes(key)) list.push(key)
  try { localStorage.setItem(SHOP_DAY_KEY, JSON.stringify({ day, bought: list })) } catch { /* storage blocked */ }
}

export function rollBox(rand = Math.random) {
  let roll = rand() * 1000
  let i = 0
  while (i < BOX_WEIGHTS.length - 1 && roll >= BOX_WEIGHTS[i]) roll -= BOX_WEIGHTS[i++]
  const id = ITEM_IDS[Math.floor(rand() * ITEM_IDS.length) % ITEM_IDS.length]
  return `${id}:${RARITIES[i]}`
}

// --- pictures (drawn here, not copied from anywhere) ---

export const ICONS = {
  brick: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="9" rx="1" fill="#b5523b" stroke="#5a2418" stroke-width="1.4"/><path d="M3 12.5h18M9 8v4.5M15 12.5V17" stroke="#7a3322" stroke-width="1.2"/></svg>',
  sawblade: '<svg viewBox="0 0 24 24"><path d="M12 2l2 3 3.5-.8.5 3.5 3.2 1.6-1.6 3.2 1.6 3.2-3.2 1.6-.5 3.5-3.5-.8-2 3-2-3-3.5.8-.5-3.5L2.8 16.2l1.6-3.2-1.6-3.2L6 8.2l.5-3.5L10 5.5z" fill="#c7ccd2" stroke="#4d545c" stroke-width="1"/><circle cx="12" cy="12" r="2.6" fill="#4d545c"/></svg>',
  bandage: '<svg viewBox="0 0 24 24"><rect x="2.5" y="8" width="19" height="8" rx="4" fill="#f4ead8" stroke="#8c7a5c" stroke-width="1.2"/><rect x="9" y="8" width="6" height="8" fill="#e9d6b4"/><path d="M12 9.6v4.8M9.6 12h4.8" stroke="#d63b3b" stroke-width="1.8"/></svg>',
  icecube: '<svg viewBox="0 0 24 24"><path d="M5 8l7-4 7 4v8l-7 4-7-4z" fill="#bfe9ff" stroke="#4a8db5" stroke-width="1.3"/><path d="M5 8l7 4 7-4M12 12v8" stroke="#4a8db5" stroke-width="1"/><path d="M8 9.2l2 1.1" stroke="#fff" stroke-width="1.3"/></svg>',
  battery: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="15" height="10" rx="1.5" fill="#2f3a44" stroke="#151b20" stroke-width="1.2"/><rect x="19" y="10" width="2" height="4" fill="#151b20"/><rect x="4.6" y="7.6" width="5" height="8.8" fill="#e8c23a"/><path d="M13 8.5l-2.5 4h3l-2 3.5" stroke="#ffe873" stroke-width="1.4" fill="none"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" fill="#8f9aa6" stroke="#3c444d" stroke-width="1.3"/><path d="M12 5.5v13M7 9.5h10" stroke="#5d6772" stroke-width="1.2"/><circle cx="12" cy="9.5" r="1.4" fill="#d6dbe0"/></svg>',
  firecracker: '<svg viewBox="0 0 24 24"><rect x="7" y="8" width="8" height="13" rx="1" fill="#d93a2b" stroke="#6e1a12" stroke-width="1.2"/><path d="M7 12h8M7 16h8" stroke="#f2c14e" stroke-width="1.3"/><path d="M11 8c0-2 1.5-3 3-3.5" stroke="#5a4630" stroke-width="1.2" fill="none"/><circle cx="15.5" cy="4" r="1.7" fill="#ffb02e"/></svg>',
  magnet: '<svg viewBox="0 0 24 24"><path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z" fill="#d23b3b" stroke="#5c1414" stroke-width="1.2"/><rect x="6" y="4" width="4" height="3" fill="#d6dbe0"/><rect x="14" y="4" width="4" height="3" fill="#d6dbe0"/></svg>',
  cactus: '<svg viewBox="0 0 24 24"><path d="M10 21V5a2 2 0 014 0v16z" fill="#4b9a3c" stroke="#1f4a17" stroke-width="1.2"/><path d="M10 13H7a2 2 0 01-2-2V8h2.4v2.6H10M14 11h3V7h2.4v4a2.4 2.4 0 01-2.4 2.4h-3" fill="#4b9a3c" stroke="#1f4a17" stroke-width="1.1"/><path d="M9 7.5l-1-.5M15 9l1-.5M9 16l-1 .3M15 17.5l1-.3" stroke="#eaf5c8" stroke-width="0.9"/></svg>',
}

// --- 3D look, made from boxes like the rest of GayZ ---

export function makeItemMesh(id, B) {
  const g = new THREE.Group()
  const lam = (color) => new THREE.MeshLambertMaterial({ color })
  const box = (w, h, d, color, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), lam(color))
    m.position.set(x * B, y * B, z * B)
    g.add(m)
    return m
  }
  if (id === 'brick') {
    box(0.46, 0.22, 0.24, 0xb5523b)
  } else if (id === 'sawblade') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.26 * B, 0.26 * B, 0.05 * B, 12), lam(0xc7ccd2)))
    const toothGeo = new THREE.BoxGeometry(0.08 * B, 0.05 * B, 0.08 * B)
    const toothMat = lam(0x8d949c)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const tooth = new THREE.Mesh(toothGeo, toothMat)
      tooth.position.set(Math.cos(a) * 0.29 * B, 0, Math.sin(a) * 0.29 * B)
      tooth.rotation.y = -a + Math.PI / 4
      g.add(tooth)
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07 * B, 0.07 * B, 0.07 * B, 8), lam(0x4d545c)))
  } else if (id === 'bandage') {
    box(0.42, 0.16, 0.2, 0xf4ead8)
    box(0.03, 0.17, 0.12, 0xd63b3b, 0, 0.005)
    box(0.12, 0.17, 0.03, 0xd63b3b, 0, 0.005)
  } else if (id === 'icecube') {
    const m = box(0.3, 0.3, 0.3, 0xbfe9ff)
    m.material.transparent = true
    m.material.opacity = 0.85
    box(0.08, 0.08, 0.02, 0xffffff, -0.06, 0.07, 0.16)
  } else if (id === 'battery') {
    box(0.4, 0.2, 0.2, 0x2f3a44)
    box(0.12, 0.21, 0.21, 0xe8c23a, -0.14)
    box(0.05, 0.08, 0.08, 0x151b20, 0.22)
  } else if (id === 'shield') {
    box(0.06, 0.4, 0.34, 0x8f9aa6)
    box(0.07, 0.4, 0.05, 0x5d6772)
    box(0.07, 0.05, 0.34, 0x5d6772, 0, 0.06)
  } else if (id === 'firecracker') {
    box(0.16, 0.36, 0.16, 0xd93a2b)
    box(0.17, 0.04, 0.17, 0xf2c14e, 0, 0.06)
    box(0.17, 0.04, 0.17, 0xf2c14e, 0, -0.08)
    box(0.03, 0.1, 0.03, 0x5a4630, 0, 0.23)
  } else if (id === 'magnet') {
    box(0.1, 0.28, 0.12, 0xd23b3b, -0.13, 0.02)
    box(0.1, 0.28, 0.12, 0xd23b3b, 0.13, 0.02)
    box(0.36, 0.1, 0.12, 0xd23b3b, 0, -0.14)
    box(0.1, 0.07, 0.12, 0xd6dbe0, -0.13, 0.19)
    box(0.1, 0.07, 0.12, 0xd6dbe0, 0.13, 0.19)
  } else if (id === 'cactus') {
    box(0.14, 0.42, 0.14, 0x4b9a3c)
    box(0.12, 0.08, 0.1, 0x4b9a3c, -0.12, 0)
    box(0.08, 0.16, 0.1, 0x4b9a3c, -0.18, 0.08)
    box(0.12, 0.08, 0.1, 0x4b9a3c, 0.12, 0.06)
    box(0.08, 0.14, 0.1, 0x4b9a3c, 0.18, 0.13)
  }
  return g
}

// A thin band in the rarity's colour under an item (ring and ground), so a
// rare one is easy to spot.
export function rarityBand(rarity, B, size = 0.28) {
  const color = new THREE.Color(SKIN_RARITIES[rarity]?.color || '#9aa0a6')
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(size * 0.75 * B, size * B, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

export function rarityColor(rarity) {
  return SKIN_RARITIES[rarity]?.color || '#9aa0a6'
}

export function rarityNameKey(rarity) {
  return SKIN_RARITIES[rarity]?.key || 'skinRarityCommon'
}
