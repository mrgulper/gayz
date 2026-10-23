// Drop-down menus on the homepage's bottom links (2026-10-23, Gaymi: like
// apple.com's menus, from a picture of its iPad menu). Pointing at How to
// Play, What's New, GayZ Features, Terms of Use or Privacy Policy opens a
// wide card above the links: the page's name in big letters, then each of
// its sections. Clicking the name opens the page; clicking a section opens
// it scrolled to that section. Links with no sections (Design a Skin,
// Gallery, Credits, Discord) keep working as plain links. Mouse only -
// touch screens have no pointing, so a tap still just opens the page.
import { HOWTOPLAY_STEPS } from './Game.js'
import { t } from './i18n.js'

const MENUS = [
  {
    link: 'nav-howtoplay-link',
    open: (game) => game._openHowToPlayPanel(),
    sections: () => HOWTOPLAY_STEPS.map((step) => t(step.headingKey)),
    target: (i) => document.querySelectorAll('#howtoplay-content h3')[i],
  },
  {
    link: 'nav-whatsnew-link',
    open: (game) => game._openWhatsNewPanel(),
    sections: () => [...document.querySelectorAll('#changelog-list .changelog-date')].slice(0, 6).map((el) => el.textContent),
    target: (i) => document.querySelectorAll('#changelog-list .changelog-entry')[i],
  },
  {
    link: 'nav-gayzfeatures-link',
    open: (game) => game._openFeaturesPanel(),
    sections: () => [...document.querySelectorAll('#features-content section.category')].map((s) => s.querySelector('h2')?.textContent || ''),
    target: (i) => document.querySelectorAll('#features-content section.category')[i],
  },
  {
    link: 'terms-btn',
    open: (game) => game._openTermsPanel(),
    sections: () => [...document.querySelectorAll('#terms-content h3')].map((h) => h.textContent),
    target: (i) => document.querySelectorAll('#terms-content h3')[i],
  },
  {
    link: 'nav-privacy-link',
    open: (game) => game._openPrivacyPanel(),
    sections: () => [...document.querySelectorAll('#privacy-content h3')].map((h) => h.textContent),
    target: (i) => document.querySelectorAll('#privacy-content h3')[i],
  },
]

const CLOSE_DELAY_MS = 180

export function bindFooterMenus(game) {
  const row = document.getElementById('menu-links-row')
  if (!row || !window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return
  const card = document.createElement('div')
  card.id = 'footer-menu'
  card.setAttribute('role', 'menu')
  card.innerHTML = '<button type="button" class="footer-menu-title"></button><div class="footer-menu-sections"></div>'
  const scrim = document.createElement('div')
  scrim.id = 'footer-menu-scrim'
  const host = document.getElementById('menu') || document.body
  host.appendChild(scrim)
  host.appendChild(card)
  const titleBtn = card.querySelector('.footer-menu-title')
  const list = card.querySelector('.footer-menu-sections')
  let current = null
  let closeTimer = 0

  const hide = () => {
    clearTimeout(closeTimer)
    card.classList.remove('open')
    scrim.classList.remove('open')
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
    // The page's sections exist once it's open (How to Play is built then).
    requestAnimationFrame(() => menu.target(i)?.scrollIntoView({ block: 'start' }))
  }
  const show = (menu) => {
    clearTimeout(closeTimer)
    if (current === menu) return
    current?.linkEl.classList.remove('footer-menu-on')
    current = menu
    menu.linkEl.classList.add('footer-menu-on')
    titleBtn.textContent = menu.linkEl.textContent.trim()
    list.replaceChildren(...menu.sections().map((label, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      b.textContent = label
      b.addEventListener('click', () => go(menu, i))
      return b
    }))
    // Sit just above the links row, whatever height the window is.
    card.style.bottom = `${Math.max(8, window.innerHeight - row.getBoundingClientRect().top + 6)}px`
    card.classList.add('open')
    scrim.classList.add('open')
  }

  for (const menu of MENUS) {
    menu.linkEl = document.getElementById(menu.link)
    // The link's own click handler opens the page; just close the card.
    menu.linkEl?.addEventListener('click', hide)
  }
  // One pointer watcher for the whole page: on a link with a menu -> show
  // it; on the card -> keep it; anywhere else -> close after a moment (at
  // once on a link without a menu).
  document.addEventListener('mouseover', (e) => {
    const linkEl = e.target.closest?.('#menu-links-row > *')
    const menu = linkEl && MENUS.find((m) => m.linkEl === linkEl)
    if (menu) show(menu)
    else if (linkEl) hide()
    else if (card.contains(e.target)) clearTimeout(closeTimer)
    else if (current) scheduleHide()
  })
  titleBtn.addEventListener('click', () => current && go(current))
  window.addEventListener('resize', hide)
}
