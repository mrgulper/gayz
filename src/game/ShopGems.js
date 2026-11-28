// Shop > Gems tab (2026-11-28, Gaymi: "make the gems price in the store
// right now just the panel no money yet but put the real price").
// Shows the gem packs with their real-money prices, plus a Custom amount
// card. Nothing can be bought yet: every button says Coming Soon and only
// shows a toast. No payment code lives here on purpose.
import { _escapeHtml } from './Game.js'
import { t } from './i18n.js'

// Prices in US dollars. Bigger packs give bonus gems.
export const GEM_PACKS = [
  { gems: 100, usd: 0.99, bonus: 0 },
  { gems: 550, usd: 4.99, bonus: 10 },
  { gems: 1200, usd: 9.99, bonus: 20 },
  { gems: 2600, usd: 19.99, bonus: 30 },
]
export const CUSTOM_MIN = 100
export const CUSTOM_MAX = 10000
// Custom amounts cost the starter rate (99 cents per 100 gems), no bonus.
export function customGemPrice(gems) {
  const n = Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, Math.floor(Number(gems) || 0)))
  return Math.round(n * 0.99) / 100
}

const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const GEM_ICON = '<svg class="shop-soon-icon" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M7 3.5h10l5 5.5-10 11.5L2 9z" fill="url(#shop-gem-body)" stroke="#6e0018" stroke-width="0.9" stroke-linejoin="round"/>'
  + '<path d="M7 3.5l2.2 5.5h5.6L17 3.5z" fill="#ffb3c2" opacity="0.85"/><path d="M9.2 9L12 20.5 14.8 9z" fill="#ff4d6d"/></svg>'

function packCard(p, i) {
  const text = p.bonus ? t('gemsBonus', { n: p.bonus }) : t('gemsStarter')
  return `<div class="shop-soon-card shop-identity-card shop-gem-card" style="--soon-color: #ff4d6d">`
    + GEM_ICON
    + `<span class="shop-soon-name">${_escapeHtml(t('gemsPackName', { n: p.gems.toLocaleString() }))}</span>`
    + `<span class="shop-soon-text">${_escapeHtml(text)}</span>`
    + `<div class="shop-price-tag shop-identity-price shop-gem-price">${_escapeHtml(usd(p.usd))}</div>`
    + `<button type="button" class="shop-identity-buy-btn shop-gem-soon-btn" data-gem-pack="${i}">${_escapeHtml(t('gemsSoonBtn'))}</button>`
    + '</div>'
}

function customCard() {
  return '<div class="shop-soon-card shop-identity-card shop-gem-card" style="--soon-color: #ffc53d">'
    + GEM_ICON
    + `<span class="shop-soon-name">${_escapeHtml(t('gemsCustomName'))}</span>`
    + `<span class="shop-soon-text">${_escapeHtml(t('gemsCustomText', { min: CUSTOM_MIN.toLocaleString(), max: CUSTOM_MAX.toLocaleString() }))}</span>`
    + `<div class="shop-price-tag shop-identity-price shop-gem-price" id="shop-gem-custom-price">${_escapeHtml(usd(customGemPrice(CUSTOM_MIN)))}</div>`
    + `<input type="number" id="shop-gem-custom-input" class="nickname-input shop-identity-input" min="${CUSTOM_MIN}" max="${CUSTOM_MAX}" step="10" value="${CUSTOM_MIN}" placeholder="${_escapeHtml(t('gemsCustomPlaceholder'))}" inputmode="numeric" />`
    + `<button type="button" class="shop-identity-buy-btn shop-gem-soon-btn" data-gem-pack="custom">${_escapeHtml(t('gemsSoonBtn'))}</button>`
    + '</div>'
}

export function renderGemPacks(game) {
  const root = document.getElementById('shop-gems')
  if (!root) return
  const heading = document.getElementById('shop-gems-heading')
  if (heading) heading.textContent = t('gemsHeading')
  const note = document.getElementById('shop-gems-note')
  if (note) note.textContent = t('gemsNote')
  const typed = document.getElementById('shop-gem-custom-input')?.value
  root.innerHTML = GEM_PACKS.map(packCard).join('') + customCard()
  const input = document.getElementById('shop-gem-custom-input')
  if (input && typed) input.value = typed
  updateCustomPrice()
  bind(game, root)
}

function updateCustomPrice() {
  const input = document.getElementById('shop-gem-custom-input')
  const price = document.getElementById('shop-gem-custom-price')
  if (input && price) price.textContent = usd(customGemPrice(input.value))
}

function bind(game, root) {
  if (root.dataset.bound) return
  root.dataset.bound = '1'
  root.addEventListener('input', (e) => {
    if (e.target.id === 'shop-gem-custom-input') updateCustomPrice()
  })
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-gem-pack]')) game._showHomepageToast?.(t('gemsSoonToast'))
  })
}
