// Playing with no internet (2026-10-17, Gaymi: "if their offline with no
// internet they can play fully and do everything thats single player like
// design a skin everything offline"). The service worker (src/sw.js) keeps
// the whole game on the device after one online visit; this side keeps the
// online-only parts from hanging or failing quietly with no connection:
// their buttons are dimmed and say they need internet instead of opening,
// and going offline / back online is announced. Everything single player
// (Play, the Map Editor, Design a Skin, Inventory, Settings, Upgrades,
// Quests, Achievements...) needs nothing from the network.
import { t } from './i18n.js'

// Buttons and links whose whole job needs the network: Global (servers +
// chat), Friends, Clans, the Market, the Gallery, signing in, Cloud Save,
// and the Map Editor's Share Map / Community Maps / Post to Gallery / Build
// Together.
export const ONLINE_ONLY = [
  '#server-btn', '#friends-btn', '#hub-btn', '#market-btn', '#nav-gallery-link', '#inv-skin-menu-market',
  '#profile-login-btn', '#profile-gate-login-btn', '#auth-login-google-btn', '#auth-signup-google-btn',
  '#friends-signin-btn', '#server-chat-signin-btn', '#clan-signin-btn', '#cloudsave-signin-btn', '#cloudsave-sync-now-btn', '#quick-cloud-btn',
  '#chat-send-btn', '#server-chat-send-btn',
  '#build-mode-publish-btn', '#build-mode-browse-btn', '#build-mode-gallery-btn', '#build-mode-together-btn',
  '#play-pause-invite-btn',
].join(', ')

// navigator.onLine alone isn't enough: on Wi-Fi with no internet (and in
// some browsers with the network cut) it still says online. So the game
// also asks the server for version.json now and then (the service worker
// never answers that one from its saved copy); a request that can't reach
// the server at all means offline. A server error (404, 500) still counts
// as online.
let unreachable = false
const PROBE_TIMEOUT_MS = 8000
const PROBE_EVERY_MS = 30000

export function isOffline() {
  return navigator.onLine === false || unreachable
}

async function probe() {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), PROBE_TIMEOUT_MS)
  try {
    await fetch('/version.json', { cache: 'no-store', signal: stop.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// True (and says so) when there's no internet for this.
export function blockedOffline(game) {
  if (!isOffline()) return false
  game?._showHomepageToast?.(t('needsInternet'))
  return true
}

export function installOfflineGuards(game) {
  const mark = () => document.documentElement.classList.toggle('is-offline', isOffline())
  mark()
  // Capture phase: runs before the button's own handler, which never sees
  // the click.
  document.addEventListener('click', (e) => {
    if (!isOffline() || !e.target?.closest?.(ONLINE_ONLY)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    blockedOffline(game)
  }, true)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !isOffline() || !e.target?.matches?.('#chat-input, #server-chat-input')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    blockedOffline(game)
  }, true)
  // Announces only real changes (offline -> online or back).
  let was = isOffline()
  const changed = () => {
    mark()
    const now = isOffline()
    if (now !== was) game._showHomepageToast(t(now ? 'offlineNow' : 'backOnline'))
    was = now
  }
  let checking = false
  const check = async () => {
    if (checking || navigator.onLine === false) return
    checking = true
    try {
      unreachable = !(await probe())
    } finally {
      checking = false
    }
    changed()
  }
  window.addEventListener('offline', changed)
  window.addEventListener('online', () => {
    unreachable = false
    changed()
    check()
  })
  window.addEventListener('focus', check)
  // While cut off, keep checking so coming back is noticed.
  setInterval(() => { if (unreachable) check() }, PROBE_EVERY_MS)
  if (isOffline()) game._showHomepageToast(t('offlineNow'))
  check()
}

// Keeps the game on the device for playing offline (src/sw.js). Not in
// development (Vite's dev server), and not in automated test browsers
// unless a test asks for it - it would fetch the whole game in each one.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  try {
    if (navigator.webdriver && !localStorage.getItem('gayz-sw-in-tests')) return
  } catch {
    return
  }
  const go = () => navigator.serviceWorker.register('/sw.js').catch(() => {})
  if (document.readyState === 'complete') go()
  else window.addEventListener('load', go, { once: true })
}
