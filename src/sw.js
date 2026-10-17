// GayZ's service worker: playing with no internet (2026-10-17, Gaymi: "if
// their offline with no internet they can play fully and do everything thats
// single player like design a skin everything offline").
//
// Not part of the Vite bundle: vite.config.js's offline plugin copies this
// file to dist/sw.js after every build, filling in BUILD (the build id and
// every file the game can need - the fonts and Design a Skin's three.js are
// served from the game itself too). main.js registers it (Offline.js).
//
// - Install: every file goes into this build's cache, so after one online
//   visit the whole game opens and plays with no internet.
// - Pages (navigations): the network first, so an online player always gets
//   the newest version; offline (or after NAV_TIMEOUT_MS), the saved page.
//   Any panel URL (/settings, /market...) falls back to the saved homepage,
//   like vercel.json's catch-all rewrite.
// - Everything else: the saved copy first, else the network (and saved).
// - /api/* and version.json always go to the network.
// - The newest build takes over straight away; the build before it is kept,
//   so a tab still running it can load its lazy parts (the Map Editor...).

const BUILD = /* build */ { version: 'dev', files: [] }
const CACHE = `gayz-${BUILD.version}`
const NAV_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // A few at a time; one missing file never stops the rest.
    for (let i = 0; i < BUILD.files.length; i += 8) {
      await Promise.all(BUILD.files.slice(i, i + 8).map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})))
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter((n) => n.startsWith('gayz-') && n !== CACHE).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    // Keep the newest older build only.
    for (const name of old.slice(0, -1)) await caches.delete(name)
    await self.clients.claim()
  })())
})

// This build's cache first, then the build before it.
async function fromCache(request) {
  const opts = { ignoreVary: true }
  const own = await (await caches.open(CACHE)).match(request, opts)
  if (own) return own
  const names = (await caches.keys()).filter((n) => n.startsWith('gayz-') && n !== CACHE).sort().reverse()
  for (const name of names) {
    const hit = await (await caches.open(name)).match(request, opts)
    if (hit) return hit
  }
  return null
}

async function page(request) {
  try {
    return await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NAV_TIMEOUT_MS)),
    ])
  } catch {
    const url = new URL(request.url)
    return (await fromCache(new Request(url.origin + url.pathname))) || (await fromCache(new Request(url.origin + '/index.html'))) || (await fromCache(new Request(url.origin + '/'))) || Response.error()
  }
}

async function asset(request) {
  const hit = await fromCache(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) {
    const copy = res.clone()
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Other sites (Firebase...) are online-only - left alone.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/version.json' || url.pathname === '/sw.js') return
  event.respondWith(request.mode === 'navigate' ? page(request) : asset(request))
})
