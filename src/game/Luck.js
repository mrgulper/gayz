// Luck (2026-10-30, Gaymi: impact events "give you 10x luck for the next
// 24 hours you will see rarer animals and zombies" - picked impacts only,
// for 24 game hours). While it lasts, anything Rare or rarer is
// LUCK_MULT times as likely (Uncommon about 3x, luckFor): wild animals (PlayAnimals.kindAt, dinosaurs
// too) and zombie rarity tiers (ZombieNames.rollZombieTier). A chip under
// the wave chip shows it with the game time left.
//
// Counted in game time (BuildSky runs it: one game hour is a real minute),
// so 24 game hours is 24 real minutes of play. Not saved - it's for this
// game.
import { t } from './i18n.js'

export const LUCK_MULT = 10
export const LUCK_SECONDS = 1440 // 24 game hours

let left = 0
let el = null

export const luck = {
  // How much likelier anything rare is right now (1 = normal).
  mult() {
    return left > 0 ? LUCK_MULT : 1
  },
  left() {
    return left
  },
  start(seconds = LUCK_SECONDS) {
    left = Math.max(left, seconds)
  },
  stop() {
    left = 0
    if (el) el.style.display = 'none'
  },
  // shown: in a game (the chip hides in the editor and menus).
  update(dt, shown) {
    if (left > 0) left = Math.max(0, left - dt)
    if (!el && left <= 0) return
    if (!el) {
      el = document.createElement('div')
      el.id = 'luck-badge'
      document.body.appendChild(el)
    }
    const on = shown && left > 0
    el.style.display = on ? 'block' : 'none'
    if (!on) return
    // Game hours and minutes left (1 real second = 1 game minute).
    const mins = Math.ceil(left)
    const text = t('luckBadge', { n: LUCK_MULT, time: `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` })
    if (el.textContent === text) return
    el.textContent = text
    // Just under the wave chip, wherever the screen size puts it (about
    // once a second, when the time changes).
    const wave = document.getElementById('build-play-wave')?.getBoundingClientRect()
    if (wave?.height) {
      el.style.top = `${Math.round(wave.bottom + 6)}px`
      el.style.left = `${Math.round(wave.left)}px`
    }
  },
}

// How much more likely a tier is with luck on: Rare and up the full
// LUCK_MULT, Uncommon a little (so the boost goes to the rare ones, not
// just away from Common).
export function luckFor(tier, m = luck.mult()) {
  if (m === 1 || tier === 'common') return 1
  return tier === 'uncommon' ? Math.sqrt(m) : m
}

// A weighted pick table with each entry's weight times its tier's luck
// (tierOf(id) -> its rarity).
export function luckyWeights(table, tierOf) {
  const m = luck.mult()
  if (m === 1) return table
  const out = {}
  for (const id in table) out[id] = table[id] * luckFor(tierOf(id), m)
  return out
}
