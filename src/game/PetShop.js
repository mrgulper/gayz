// The daily Pet Shop (2026-11-23, Gaymi: "add pets for sale when you on
// the pet screen zombies anything"; picked a daily shop for coins). A
// section on Inventory's Pets tab (TeamUI.js): SIZE creatures a day -
// zombies, skeletons, monsters and animals - the same for the whole day
// (picked from the date), new ones at midnight. Bought ones join your
// caught creatures (Creatures.addCreature, so a shiny is possible).
// Rarer costs more (PRICES).
//
// Which ones you bought today: localStorage SHOP_KEY ({ day, bought }),
// so Cloud Save carries it.
import { addCreature, stats, creatureName, creatureType, rarityName, creatureIconURL, tierColor, powerName, MAX_CREATURES, loadCreatures } from './Creatures.js'
import { PlayAnimals } from './PlayAnimals.js'
import { ZOMBIE_TIERS, ZOMBIE_TIER_IDS, NAME_COUNT } from './ZombieNames.js'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { SKELETON_KINDS } from './SkeletonModels.js'
import { saveShopProgress } from './Game.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const SHOP_KEY = 'gayz-pet-shop'
export const SIZE = 4
// Coins by rarity. A guess to start with (a team battle win pays 30).
export const PRICES = { common: 60, uncommon: 120, rare: 250, epic: 500, legendary: 1000, mythic: 2000 }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const byId = (id) => document.getElementById(id)

// Today on this device ("2026-11-23").
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

// The same random numbers all day (a seed made from the date).
function seeded(text) {
  let h = 1779033703
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353)
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1)
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61)
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296
  }
}

// What's for sale on day. Rarity as often as in the game (ZOMBIE_TIERS
// chance), so a legendary is a rare treat.
export function stock(day = today()) {
  const rand = seeded(`pet-shop-${day}`)
  const kinds = [
    ...[null, ...Object.keys(MONSTER_KINDS), ...Object.keys(SKELETON_KINDS)].map((k) => ({ t: 'z', k })),
    ...Object.keys(PlayAnimals.KINDS).map((k) => ({ t: 'a', k })),
  ]
  const pickRarity = () => {
    let roll = rand()
    for (const id of ZOMBIE_TIER_IDS) {
      roll -= ZOMBIE_TIERS[id].chance
      if (roll < 0) return id
    }
    return 'common'
  }
  return Array.from({ length: SIZE }, () => {
    const base = kinds[Math.floor(rand() * kinds.length)]
    const r = pickRarity()
    return base.t === 'a' ? { t: 'a', k: base.k, r } : { t: 'z', k: base.k, r, n: Math.floor(rand() * NAME_COUNT), b: false }
  })
}

// Bought today (indexes into stock()). Never trusted.
export function boughtToday(day = today()) {
  try {
    const d = JSON.parse(localStorage.getItem(SHOP_KEY) || 'null')
    if (!d || d.day !== day || !Array.isArray(d.bought)) return []
    return d.bought.filter((i) => Number.isInteger(i) && i >= 0 && i < SIZE)
  } catch {
    return []
  }
}

// -> the creature kept, or the i18n key of why not.
export function buy(game, i, day = today()) {
  const c = stock(day)[i]
  if (!c) return 'petShopGone'
  const bought = boughtToday(day)
  if (bought.includes(i)) return 'petShopGone'
  const price = PRICES[c.r] || PRICES.common
  if ((game.coins || 0) < price) return 'petShopCoins'
  if (loadCreatures().list.length >= MAX_CREATURES) return 'petShopFull'
  const kept = addCreature(c)
  if (!kept) return 'petShopFull'
  game.coins -= price
  saveShopProgress(game)
  game._renderCurrencyBar?.()
  try {
    localStorage.setItem(SHOP_KEY, JSON.stringify({ day, bought: [...bought, i] }))
  } catch { /* full storage */ }
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  return kept
}

export function renderPetShop(game) {
  const box = byId('pet-shop')
  if (!box) return
  const day = today()
  const bought = boughtToday(day)
  const cards = stock(day).map((c, i) => {
    if (bought.includes(i)) return `<div class="team-card empty"><span>${esc(t('petShopBought'))}</span></div>`
    const s = stats(c)
    const price = PRICES[c.r] || PRICES.common
    const short = (game.coins || 0) < price
    return `<button type="button" class="perk-option team-card ps-card${short ? ' ps-short' : ''}" data-ps-buy="${i}" style="--tier: ${tierColor(c.r)}" title="${esc(powerName(c))}">
      <img src="${creatureIconURL(c)}" alt="" draggable="false" />
      <span class="team-card-name">${esc(creatureName(c))}</span>
      <span class="team-card-type">${esc(rarityName(c.r))} ${esc(creatureType(c))}</span>
      <span class="team-card-stats">${esc(t('teamStats', { hp: s.hp, atk: s.atk }))}</span>
      <span class="team-card-power">${esc(powerName(c))}</span>
      <span class="ps-price">${esc(t('petShopPrice', { n: price }))}</span>
    </button>`
  }).join('')
  box.innerHTML = `<h3 class="team-section-title">${esc(t('petShopTitle'))}</h3>
    <p class="team-snack-hint">${esc(t('petShopHint'))}</p>
    <div class="team-cards">${cards}</div>`
}

// Clicks inside the Pet Shop. -> true when it was one of ours.
export function petShopClick(game, e, rerender) {
  const b = e.target.closest('[data-ps-buy]')
  if (!b) return false
  const res = buy(game, Number(b.dataset.psBuy))
  if (typeof res === 'string') {
    const c = stock()[Number(b.dataset.psBuy)]
    game._showHomepageToast(t(res, { n: c ? PRICES[c.r] : 0, max: MAX_CREATURES }))
  } else game._showHomepageToast(t('petShopGot', { name: creatureName(res) }))
  rerender()
  return true
}
