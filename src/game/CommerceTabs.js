// Commerce (2026-11-25, Gaymi: "combine the shop and market together and
// name it as Commerce"). One nav button (#store-btn, now labelled
// Commerce) opens the Shop; a Shop / Market tab row at the top of both
// panels switches between them. The Shop's ~30 sections are grouped into
// 4 tabs; each section's heading decides its group, and everything after
// a heading (up to the next one) goes with it.
// No internet: Offline.js's click guard stops the Market tab first.

const GROUP_BY_HEADING = {
  'shop-deals-heading': 'deals',
  'shop-crate-section-heading': 'deals',
  'shop-more-skins-heading': 'looks',
  'shop-bundles-heading': 'looks',
  'shop-hats-heading': 'looks',
  'shop-capes-heading': 'looks',
  'shop-backs-heading': 'looks',
  'shop-gunskins-heading': 'looks',
  'shop-effects-heading': 'fx',
  'shop-trails-heading': 'fx',
  'shop-jumps-heading': 'fx',
  'shop-deaths-heading': 'fx',
  'shop-killsounds-heading': 'fx',
  'shop-hitsounds-heading': 'fx',
  'shop-jumpsounds-heading': 'fx',
  'shop-stepsounds-heading': 'fx',
  'shop-pets-heading': 'profile',
  'shop-pethats-heading': 'profile',
  'shop-petpaints-heading': 'profile',
  'shop-ridepaints-heading': 'profile',
  'shop-namestyles-heading': 'profile',
  'shop-chatbubbles-heading': 'profile',
  'shop-frames-heading': 'profile',
  'shop-identity-heading': 'profile',
}

// Which group each section belongs to (the Daily Deals head sits before
// any heading, so the first group is Deals).
function _tagSections() {
  const box = document.querySelector('#shop-panel .general-section-empty')
  if (!box) return []
  let group = 'deals'
  const kids = [...box.children]
  for (const el of kids) {
    if (el.id && GROUP_BY_HEADING[el.id]) group = GROUP_BY_HEADING[el.id]
    el.dataset.shopGroup = group
  }
  return kids
}

export function showShopGroup(group) {
  const kids = document.querySelectorAll('#shop-panel .general-section-empty > [data-shop-group]')
  for (const el of kids) el.classList.toggle('shop-group-off', el.dataset.shopGroup !== group)
  for (const tab of document.querySelectorAll('.shop-group-tab')) tab.classList.toggle('active', tab.dataset.shopGroup === group)
  const scroller = document.querySelector('#shop-panel .panel-fixed-content')
  if (scroller) scroller.scrollTop = 0
}

// The scroll area gets the panel's height minus the tab rows' real height
// (they wrap onto more lines on a phone), so the panel never grows.
export function fitCommerceTabs() {
  for (const id of ['shop-panel', 'market-panel']) {
    const panel = document.getElementById(id)
    if (!panel || panel.style.display === 'none' || !panel.getClientRects().length) continue
    let h = 0
    for (const row of panel.querySelectorAll('.commerce-tabs')) {
      const cs = getComputedStyle(row)
      h += row.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
    }
    panel.style.setProperty('--commerce-tabs-h', `${h}px`)
  }
}

export function bindCommerceTabs(game) {
  window.addEventListener('resize', fitCommerceTabs)
  _tagSections()
  showShopGroup('deals')
  for (const tab of document.querySelectorAll('.shop-group-tab')) {
    tab.addEventListener('click', () => showShopGroup(tab.dataset.shopGroup))
  }
  for (const tab of document.querySelectorAll('.commerce-tab[data-commerce]')) {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('active')) return
      // Locked for brand-new players (data-unlock="5", hidden by CSS).
      if (getComputedStyle(tab).display === 'none') return
      if (tab.dataset.commerce === 'market') {
        game._openMarketPanel()
      } else {
        game._openShopPanel()
      }
    })
  }
}
