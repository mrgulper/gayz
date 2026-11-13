// Hall of Fame (2026-11-13, Gaymi's "Hall of Fame editor", picked "both"
// places and "name + title, skin, date, trophy icon"): players the GayZ
// team honors, one card each. The team writes them with its own tools
// (api/_lib/admin.js saveHof); players read them through /api/live
// { action: 'hof' } in two places:
//   - the homepage's bottom "Hall of Fame" link (#hof-panel), and
//   - General's Hall of Fame tab (#general-page-halloffame).
// Cards are the homepage's own .home-x-card, so every theme styles them.
import { t } from './i18n.js'
import { _escapeHtml } from './Game.js'
import { skinFrontIconURL } from './InventorySkins.js'
import { DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'

// What each icon id (admin.js HOF_ICONS) shows: small drawn pictures
// (24 x 24), coloured the same in every theme.
const medal = (fill, edge) => `<path d="M7 2h4l1 6H9zM13 2h4l-2 6h-3z" fill="#c8323a"/><circle cx="12" cy="15" r="6.5" fill="${fill}" stroke="${edge}" stroke-width="1.5"/><path d="M12 11.5l1.1 2.2 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z" fill="${edge}"/>`
const ICON_SVG = {
  trophy: '<path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="#f2b822"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" fill="none" stroke="#f2b822" stroke-width="1.6"/><path d="M11 13h2v4h-2zM8 18h8v3H8z" fill="#c88a12"/>',
  gold: medal('#f2c230', '#9a6a08'),
  silver: medal('#d6dbe2', '#6b7480'),
  bronze: medal('#d48a4a', '#7a4318'),
  star: '<path d="M12 2l3 6.3 6.9.9-5 4.8 1.3 6.8L12 17.6 5.8 20.8l1.3-6.8-5-4.8 6.9-.9z" fill="#f6c431" stroke="#a87a08" stroke-width="1"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#f2b822" stroke="#9a6a08" stroke-width="1"/><circle cx="12" cy="15" r="1.6" fill="#d8203a"/>',
  skull: '<path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v4h10v-4c1.5-1 3-3 3-6a8 8 0 0 0-8-8z" fill="#ece8dc" stroke="#6b665a" stroke-width="1"/><circle cx="9" cy="11" r="2" fill="#2a2620"/><circle cx="15" cy="11" r="2" fill="#2a2620"/><path d="M10 17v3M12 17v3M14 17v3" stroke="#6b665a" stroke-width="1"/>',
  heart: '<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" fill="#e5324a"/>',
  fire: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z" fill="#f2702a"/><path d="M12 12c1 2 3 3 3 5a3 3 0 0 1-6 0c0-1.5 1-2.5 2-3 0 1 .5 1.5 1 1.5 0-1.2-.4-2.3 0-3.5z" fill="#ffd23a"/>',
  zombie: '<rect x="4" y="3" width="16" height="18" rx="2" fill="#6fae4a" stroke="#3d6a24" stroke-width="1"/><rect x="7" y="8" width="3.5" height="3.5" fill="#1e2a14"/><rect x="13.5" y="8" width="3.5" height="3.5" fill="#d8203a"/><path d="M8 16h8v2H8z" fill="#2a3a1c"/>',
}
export const HOF_ICONS = Object.keys(ICON_SVG)
const iconSvg = (id) => `<svg class="hof-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_SVG[id] || ICON_SVG.trophy}</svg>`
// Asked again after this long (opening it twice in a row costs one call).
const KEEP_MS = 5 * 60 * 1000

let cache = { at: 0, list: null }
let loading = null

async function fetchList() {
  if (cache.list && Date.now() - cache.at < KEEP_MS) return cache.list
  if (!loading) {
    loading = fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hof' }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http-${r.status}`))))
      .then((d) => {
        cache = { at: Date.now(), list: Array.isArray(d?.list) ? d.list : [] }
        return cache.list
      })
      .finally(() => { loading = null })
  }
  return loading
}

function dateText(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return ''
  const [y, m, d] = day.split('-').map(Number)
  try {
    return new Date(y, m - 1, d).toLocaleDateString(document.documentElement.lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return day
  }
}

function cardHtml(h) {
  const date = dateText(h.date)
  return `<div class="home-x-card hof-card">
    <img class="hof-skin" alt="" data-skin-index="${h._i}" />
    <div class="hof-text">
      <span class="home-x-tag">${iconSvg(h.icon)}${date ? _escapeHtml(date) : ''}</span>
      <span class="home-x-big hof-name">${_escapeHtml(h.name || '')}</span>
      ${h.title ? `<span class="hof-title">${_escapeHtml(h.title)}</span>` : ''}
    </div>
  </div>`
}

// Fills `box` with the cards (or a loading / empty / offline line).
export async function renderHallOfFame(box) {
  if (!box) return
  box.innerHTML = `<p class="hof-note">${_escapeHtml(t('hofLoading'))}</p>`
  let list
  try {
    list = await fetchList()
  } catch {
    box.innerHTML = `<p class="hof-note">${_escapeHtml(t('hofOffline'))}</p>`
    return
  }
  if (!list.length) {
    box.innerHTML = `<p class="hof-note">${_escapeHtml(t('hofEmpty'))}</p>`
    return
  }
  const shown = list.map((h, i) => ({ ...h, _i: i }))
  box.innerHTML = shown.map(cardHtml).join('')
  // Skins as flat front pictures (the Inventory's own card picture).
  for (const img of box.querySelectorAll('.hof-skin')) {
    const h = shown[Number(img.dataset.skinIndex)]
    const url = typeof h?.skin === 'string' && h.skin.startsWith('data:image/png') ? h.skin : DEFAULT_SKIN_DATA_URL
    skinFrontIconURL(url).then((src) => { if (src && img.isConnected) img.src = src })
  }
}

export function openHallOfFame(game) {
  game._closeAllMenuPanels()
  const panel = document.getElementById('hof-panel')
  if (!panel) return
  document.getElementById('hof-panel-title').textContent = t('hofTitle')
  document.getElementById('hof-panel-help').textContent = t('hofHelp')
  panel.style.display = 'flex'
  renderHallOfFame(document.getElementById('hof-panel-list'))
}

export function closeHallOfFame() {
  const panel = document.getElementById('hof-panel')
  if (panel) panel.style.display = 'none'
}

// Once, at startup.
export function bindHallOfFame(game) {
  document.getElementById('nav-halloffame-link')?.addEventListener('click', () => openHallOfFame(game))
  const panel = document.getElementById('hof-panel')
  panel?.addEventListener('click', (e) => {
    if (e.target === panel || e.target.closest('.panel-close-btn')) closeHallOfFame()
  })
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHallOfFame() })
  // General's tab fills itself when clicked.
  document.getElementById('general-tab-halloffame')?.addEventListener('click', () => {
    renderHallOfFame(document.getElementById('general-hof-list'))
  })
  game.__openHallOfFame = () => openHallOfFame(game)
}
