// Inventory > Hats & Capes (2026-10-31, Cosmetics.js): every hat and cape,
// unlocked ones to wear (click again to take it off), locked ones saying
// what unlocks them. Drawn each time the tab is looked at.
import { COSMETIC_IDS, COSMETICS, WORN_SETTING, isUnlocked, needText, cosmeticName, cosmeticIcon } from './Cosmetics.js'
import { saveSettings } from './Game.js'
import { t } from './i18n.js'
import { ownsShopCosmetic } from './Cosmetics.js'
import { EFFECT_KINDS, toggleEffect } from './ShopEffects.js'

const byId = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const WORN_KEY = WORN_SETTING

function card(game, id) {
  const slot = COSMETICS[id].slot
  const open = isUnlocked(id, game.careerStats)
  const worn = game.settings[WORN_KEY[slot]] === id
  const line = !open ? needText(id) : worn ? t('cosmeticWorn') : t('cosmeticWear')
  return `<button type="button" class="perk-option team-card${worn ? ' picked' : ''}${open ? '' : ' locked'}" data-cosmetic="${id}"${open ? '' : ' aria-disabled="true"'}>
    <img src="${cosmeticIcon(id)}" alt="" draggable="false" />
    <span class="team-card-name">${esc(cosmeticName(id))}</span>
    <span class="team-card-type">${esc(line)}</span>
  </button>`
}

// Kill effects and walk trails (ShopEffects.js): bought in the Shop, used
// from here too.
function effectCard(game, kind, id) {
  const K = EFFECT_KINDS[kind]
  const open = ownsShopCosmetic(id)
  const used = game.settings[K.setting] === id
  const line = !open ? t('killFxBuyInShop') : used ? t('killFxUsing') : t('killFxUse')
  return `<button type="button" class="perk-option team-card${used ? ' picked' : ''}${open ? '' : ' locked'}" data-effect="${id}"${open ? '' : ' aria-disabled="true"'}>
    <img src="${K.icon(id)}" alt="" draggable="false" />
    <span class="team-card-name">${esc(K.name(id))}</span>
    <span class="team-card-type">${esc(line)}</span>
  </button>`
}

export function renderCosmetics(game) {
  const page = byId('cosmetics-page')
  if (!page) return
  const set = (id, text) => {
    const el = byId(id)
    if (el) el.textContent = text
  }
  set('cosmetics-hats-title', t('cosmeticHatsTitle'))
  set('cosmetics-capes-title', t('cosmeticCapesTitle'))
  set('cosmetics-backs-title', t('cosmeticBacksTitle'))
  set('cosmetics-kills-title', t('killFxHeading'))
  set('cosmetics-trails-title', t('trailHeading'))
  set('cosmetics-jumps-title', t('jumpFxHeading'))
  set('cosmetics-deaths-title', t('deathFxHeading'))
  set('cosmetics-gunskins-title', t('gunSkinHeading'))
  set('cosmetics-pethats-title', t('petHatHeading'))
  set('cosmetics-petpaints-title', t('petPaintHeading'))
  set('cosmetics-ridepaints-title', t('ridePaintHeading'))
  set('cosmetics-how', t('cosmeticHow'))
  byId('cosmetics-hats').innerHTML = COSMETIC_IDS.filter((id) => COSMETICS[id].slot === 'hat').map((id) => card(game, id)).join('')
  byId('cosmetics-capes').innerHTML = COSMETIC_IDS.filter((id) => COSMETICS[id].slot === 'cape').map((id) => card(game, id)).join('')
  const backs = byId('cosmetics-backs')
  if (backs) backs.innerHTML = COSMETIC_IDS.filter((id) => COSMETICS[id].slot === 'back').map((id) => card(game, id)).join('')
  for (const [kind, rowId] of [['kill', 'cosmetics-kills'], ['trail', 'cosmetics-trails'], ['jump', 'cosmetics-jumps'], ['death', 'cosmetics-deaths'], ['gun', 'cosmetics-gunskins'], ['petHat', 'cosmetics-pethats'], ['petPaint', 'cosmetics-petpaints'], ['ridePaint', 'cosmetics-ridepaints']]) {
    const row = byId(rowId)
    if (row) row.innerHTML = EFFECT_KINDS[kind].ids.map((id) => effectCard(game, kind, id)).join('')
  }
}

export function bindCosmeticsUI(game) {
  const page = byId('cosmetics-page')
  if (!page) return
  byId('inventory-tab-cosmetics')?.addEventListener('click', () => renderCosmetics(game))
  page.addEventListener('click', (e) => {
    const k = e.target.closest('[data-effect]')
    if (k) {
      if (ownsShopCosmetic(k.dataset.effect)) toggleEffect(game, k.dataset.effect)
      renderCosmetics(game)
      return
    }
    const c = e.target.closest('[data-cosmetic]')
    if (!c) return
    const id = c.dataset.cosmetic
    if (!isUnlocked(id, game.careerStats)) return
    const key = WORN_KEY[COSMETICS[id].slot]
    game.settings[key] = game.settings[key] === id ? '' : id
    saveSettings(game.settings)
    renderCosmetics(game)
  })
}
