// Right-column nav badges: how many quests are finished, friend requests are
// waiting... The spans are the old .nav-badge-dot ones in index.html. They
// were a small circle with the number (2026-10-24); since 2026-10-30 the
// number is written after the button's name instead - "Quests (3)" - via
// the label's data-badge (08-homepage.css), and the circles stay hidden.
// A button with two badges (Quests) shows their total.

export function setNavBadge(el, n) {
  if (!el) return
  const count = Math.max(0, Math.floor(Number(n) || 0))
  el.textContent = count > 99 ? '99+' : String(count)
  el.dataset.count = String(count)
  el.style.display = count ? '' : 'none'
  const button = el.closest('#menu-nav-buttons button')
  const label = button?.querySelector('span:not(.nav-badge-dot)')
  if (!label) return
  let total = 0
  for (const badge of button.querySelectorAll('.nav-badge-dot')) {
    if (badge.style.display !== 'none') total += Number(badge.dataset.count) || 0
  }
  if (total) label.dataset.badge = ` (${total > 99 ? '99+' : total})`
  else delete label.dataset.badge
}
