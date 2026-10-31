// Inventory > Hats & Capes (2026-10-31, Cosmetics.js): every hat and cape,
// unlocked ones to wear (click again to take it off), locked ones saying
// what unlocks them. Drawn each time the tab is looked at.
import { COSMETIC_IDS, COSMETICS, isUnlocked, needText, cosmeticName, cosmeticIcon } from './Cosmetics.js'
import { saveSettings } from './Game.js'
import { t } from './i18n.js'

const byId = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const WORN_KEY = { hat: 'cosmeticHat', cape: 'cosmeticCape' }

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

export function renderCosmetics(game) {
  const page = byId('cosmetics-page')
  if (!page) return
  const set = (id, text) => {
    const el = byId(id)
    if (el) el.textContent = text
  }
  set('cosmetics-hats-title', t('cosmeticHatsTitle'))
  set('cosmetics-capes-title', t('cosmeticCapesTitle'))
  set('cosmetics-how', t('cosmeticHow'))
  byId('cosmetics-hats').innerHTML = COSMETIC_IDS.filter((id) => COSMETICS[id].slot === 'hat').map((id) => card(game, id)).join('')
  byId('cosmetics-capes').innerHTML = COSMETIC_IDS.filter((id) => COSMETICS[id].slot === 'cape').map((id) => card(game, id)).join('')
}

export function bindCosmeticsUI(game) {
  const page = byId('cosmetics-page')
  if (!page) return
  byId('inventory-tab-cosmetics')?.addEventListener('click', () => renderCosmetics(game))
  page.addEventListener('click', (e) => {
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
