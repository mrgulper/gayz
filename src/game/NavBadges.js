// Right-column nav badges: how many quests are finished, friend requests are
// waiting... The spans are the old .nav-badge-dot ones in index.html. They
// are a small circle with the number (2026-10-24); pointing at the button
// swaps it for "Quests (3)" after the name (2026-10-30) - the label's
// data-badge (08-homepage.css). A button with two badges (Quests) shows
// their total there.

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
