// Right-column nav badges: how many quests are finished, friend requests are
// waiting... The spans are the old .nav-badge-dot ones in index.html. They
// are a small circle with the number (2026-10-24). Pointing at the button
// changes nothing (2026-10-31; the "Quests (3)" hover swap is gone).

export function setNavBadge(el, n) {
  if (!el) return
  const count = Math.max(0, Math.floor(Number(n) || 0))
  el.textContent = count > 99 ? '99+' : String(count)
  el.dataset.count = String(count)
  el.style.display = count ? '' : 'none'
}
