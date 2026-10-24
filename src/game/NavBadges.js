// Right-column nav badges: a small circle with a number in it (how many
// quests are finished, friend requests are waiting...) instead of a plain
// dot (2026-10-24). The spans are the old .nav-badge-dot ones in index.html.

export function setNavBadge(el, n) {
  if (!el) return
  const count = Math.max(0, Math.floor(Number(n) || 0))
  el.textContent = count > 99 ? '99+' : String(count)
  el.style.display = count ? '' : 'none'
}
