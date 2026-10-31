// Hover drop-down menus on the homepage (2026-10-23, Gaymi: like
// apple.com's menus, from a picture of its iPad menu). Pointing at a
// bottom link (How to Play, What's New, GayZ Features, Terms of Use,
// Privacy Policy), a right-column button (General, Store, Upgrades...),
// the profile card, Game Mode or Settings opens a card with that page's
// name in big letters and each of its tabs or sections. Clicking the name
// opens the page; clicking a tab/section opens it right there. Bottom
// links get a wide card above the row, the right column a card to its
// left, Game Mode and Settings one to their right (below left no room
// above the bottom links; since 2026-10-30 the bottom links' card is the
// same narrow list as the right column's). Buttons whose page has no tabs
// or sections (Market, Map Editor, Design a Skin...) and Play get none.
// Mouse only - touch screens have no pointing, so a tap still just opens
// the page.
import { HOWTOPLAY_STEPS } from './Game.js'
import { t } from './i18n.js'

const footer = (link, open, labels, target) => ({ link, place: 'footer', open, labels, target })

const FOOTER_MENUS = [
  footer('nav-howtoplay-link', (game) => game._openHowToPlayPanel(),
    () => HOWTOPLAY_STEPS.map((step) => t(step.headingKey)),
    (i) => document.querySelectorAll('#howtoplay-content h3')[i]),
  footer('nav-whatsnew-link', (game) => game._openWhatsNewPanel(),
    () => [...document.querySelectorAll('#changelog-list .changelog-date')].slice(0, 6).map((el) => el.textContent),
    (i) => document.querySelectorAll('#changelog-list .changelog-entry')[i]),
  footer('nav-gayzfeatures-link', (game) => game._openFeaturesPanel(),
    () => [...document.querySelectorAll('#features-content section.category')].map((s) => s.querySelector('h2')?.textContent || ''),
    (i) => document.querySelectorAll('#features-content section.category')[i]),
  footer('terms-btn', (game) => game._openTermsPanel(),
    () => [...document.querySelectorAll('#terms-content h3')].map((h) => h.textContent),
    (i) => document.querySelectorAll('#terms-content h3')[i]),
  footer('nav-privacy-link', (game) => game._openPrivacyPanel(),
    () => [...document.querySelectorAll('#privacy-content h3')].map((h) => h.textContent),
    (i) => document.querySelectorAll('#privacy-content h3')[i]),
]

// Homepage buttons: the button's own click opens its panel; `tabs` are
// clicked after that, `headings` scrolled to.
const PANEL_MENUS = [
  { link: 'menu-player-badge', panel: 'profile-panel', headings: 'h3' },
  { link: 'hub-btn', panel: 'clan-panel', tabs: '.general-tab' },
  { link: 'store-btn', panel: 'shop-panel', headings: 'h3.crate-section-heading' },
  { link: 'upgrades-btn', panel: 'upgrades-panel', tabs: '.upgrades-tab' },
  { link: 'server-btn', panel: 'server-panel', tabs: '.server-tab' },
  { link: 'friends-btn', panel: 'friends-panel', tabs: '.general-tab' },
  { link: 'quests-btn', panel: 'quests-panel', tabs: '.quest-tab' },
  { link: 'menu-inventory-btn', panel: 'menu-inventory-panel', tabs: '.inventory-tab' },
  { link: 'achievements-btn', panel: 'achievements-panel', tabs: '.achievements-mode-tab' },
  { link: 'gamemode-btn', panel: 'hub-panel', tabs: '.hub-tab', place: 'beside' },
  { link: 'settings-btn', panel: 'settings-panel', tabs: '.settings-tab', place: 'beside' },
  // Gallery's sections, like the other bottom links (2026-10-30).
  { link: 'nav-gallery-link', panel: 'gallery-panel', tabs: '.gallery-tab', place: 'footer' },
].map((m) => {
  const panel = () => document.getElementById(m.panel)
  // Tabs/sections the page shows right now (e.g. Friends' lists only
  // once signed in): nothing between it and the panel is hidden.
  const items = () => [...(panel()?.querySelectorAll(m.tabs || m.headings) || [])].filter((el) => {
    for (let p = el; p && p !== panel(); p = p.parentElement) if (p.hidden || p.style.display === 'none') return false
    return true
  })
  return {
    link: m.link,
    place: m.place || 'side',
    open: () => document.getElementById(m.link)?.click(),
    labels: () => items().map((el) => (el.querySelector('.gallery-tab-label') || el).textContent.trim().replace(/\s+/g, ' ')),
    target: (i) => items()[i],
    tabs: !!m.tabs,
  }
})

const MENUS = [...FOOTER_MENUS, ...PANEL_MENUS]
const CLOSE_DELAY_MS = 180

// While a page is open (Quests, Terms of Use...) pointing at a button does
// nothing - no card on top of the page, no dimming, the page stays open.
// Only a click opens the other page (2026-10-24, Gaymi).
const PAGE_PANELS = ['clan-panel', 'hub-panel', 'upgrades-panel', 'quests-panel', 'achievements-panel',
  'profile-panel', 'credits-panel', 'gallery-panel', 'levels-panel', 'terms-panel', 'privacy-panel',
  'features-panel', 'skindesigner-panel', 'market-panel', 'shop-panel', 'whatsnew-panel', 'howtoplay-panel',
  'friends-panel', 'other-profile-panel', 'menu-inventory-panel', 'server-panel', 'settings-panel', 'coming-soon-panel']
const pageOpen = () => PAGE_PANELS.some((id) => {
  const el = document.getElementById(id)
  return el && el.getClientRects().length > 0
})

export function bindHoverMenus(game) {
  const row = document.getElementById('menu-links-row')
  if (!row || !window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return
  const card = document.createElement('div')
  card.id = 'footer-menu'
  card.className = 'hover-menu'
  card.setAttribute('role', 'menu')
  card.innerHTML = '<button type="button" class="footer-menu-title"></button><div class="footer-menu-sections"></div>'
  const host = document.getElementById('menu') || document.body
  host.appendChild(card)
  const titleBtn = card.querySelector('.footer-menu-title')
  const list = card.querySelector('.footer-menu-sections')
  let current = null
  let closeTimer = 0

  const hide = () => {
    clearTimeout(closeTimer)
    card.classList.remove('open')
    current?.linkEl.classList.remove('footer-menu-on')
    current = null
  }
  const scheduleHide = () => {
    clearTimeout(closeTimer)
    closeTimer = setTimeout(hide, CLOSE_DELAY_MS)
  }
  const go = (menu, i) => {
    hide()
    menu.open(game)
    if (i === undefined) return
    // The page's tabs/sections are ready once it's open (How to Play is
    // built then).
    requestAnimationFrame(() => {
      const el = menu.target(i)
      if (!el) return
      if (menu.tabs) el.click()
      else el.scrollIntoView({ block: 'start' })
    })
  }
  const place = (menu) => {
    const r = menu.linkEl.getBoundingClientRect()
    card.style.top = card.style.bottom = card.style.left = card.style.right = ''
    if (menu.place === 'footer') {
      // Just above its link, whatever height the window is - the same
      // narrow card as the right column's since 2026-10-30 ("make
      // anything in the bottom line the section same as the right side"),
      // centred on the link but never off the screen.
      card.style.bottom = `${Math.max(8, window.innerHeight - r.top + 6)}px`
      const w = card.offsetWidth
      card.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`
    } else if (menu.place === 'side') {
      // To the left of the right column, level with the button but
      // never off the bottom of the screen.
      card.style.right = `${window.innerWidth - r.left + 12}px`
      card.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - card.offsetHeight - 8))}px`
    } else {
      // To the right of Game Mode / Settings, centred on it.
      card.style.left = `${r.right + 12}px`
      card.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - card.offsetHeight / 2, window.innerHeight - card.offsetHeight - 8))}px`
    }
  }
  const show = (menu) => {
    clearTimeout(closeTimer)
    if (current === menu) return
    const labels = menu.labels()
    if (!labels.length) { hide(); return }
    current?.linkEl.classList.remove('footer-menu-on')
    current = menu
    menu.linkEl.classList.add('footer-menu-on')
    // The button's own words (Settings is just a gear, the profile card
    // shows an ID, so those two are named here).
    titleBtn.textContent = menu.link === 'settings-btn' ? t('settingsTitle')
      : menu.link === 'menu-player-badge' ? t('profilePanelTitle')
        : (menu.linkEl.querySelector('span:not(.nav-badge-dot)') || menu.linkEl).textContent.trim().replace(/\s+/g, ' ')
    list.replaceChildren(...labels.map((label, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      b.textContent = label
      b.addEventListener('click', () => go(menu, i))
      return b
    }))
    card.dataset.place = menu.place
    card.classList.add('open')
    // No menu dims or blurs the page behind it (2026-10-25, Gaymi: "just
    // pointing it dont make it go dark").
    place(menu)
  }

  for (const menu of MENUS) {
    menu.linkEl = document.getElementById(menu.link)
    // The link's own click handler opens the page; just close the card.
    menu.linkEl?.addEventListener('click', hide)
  }
  // One pointer watcher for the whole page: on a button with a menu ->
  // show it; on the card -> keep it; on another homepage button -> close
  // at once; anywhere else -> close after a moment.
  document.addEventListener('mouseover', (e) => {
    if (card.contains(e.target)) { clearTimeout(closeTimer); return }
    const menu = MENUS.find((m) => m.linkEl && m.linkEl.contains(e.target))
    if (menu && pageOpen()) hide()
    else if (menu) show(menu)
    else if (e.target.closest?.('#menu-links-row > *, #menu-nav-buttons > button, #play-btn')) hide()
    else if (current) scheduleHide()
  })
  titleBtn.addEventListener('click', () => current && go(current))
  window.addEventListener('resize', hide)
}
