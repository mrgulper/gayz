// Sign-in with Discord and Steam (2026-10-23). Firebase has built-in
// buttons for Google and GitHub, but not for these, so
// /api/auth/<provider> does it itself: it sends the player to that site,
// checks who they are when they come back, and gives the browser a Firebase
// sign-in token for the account `<provider><their id>` (letters and digits
// only - api/_lib/servers.js's validId).
//
// Keys live in Vercel's environment variables, never in code:
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET  (discord.com/developers)
// Steam needs no key (OpenID 2.0; the name and picture come from the
// public profile page).

export const PROVIDERS = {
  discord: {
    env: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
    startUrl({ env, redirectUri, state }) {
      const q = new URLSearchParams({ response_type: 'code', client_id: env.DISCORD_CLIENT_ID, scope: 'identify', redirect_uri: redirectUri, state, prompt: 'none' })
      return `https://discord.com/oauth2/authorize?${q}`
    },
    async finish({ env, query, redirectUri, fetch }) {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: query.get('code') || '', redirect_uri: redirectUri }),
      })
      if (!tokenRes.ok) throw new AuthError('failed')
      const { access_token: accessToken } = await tokenRes.json()
      const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!userRes.ok) throw new AuthError('failed')
      const u = await userRes.json()
      return {
        id: String(u.id || ''),
        name: u.global_name || u.username || '',
        picture: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null,
      }
    },
  },
  steam: {
    env: [],
    startUrl({ redirectUri, state, origin }) {
      const returnTo = `${redirectUri}?state=${state}`
      const q = new URLSearchParams({
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': returnTo,
        'openid.realm': origin,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      })
      return `${STEAM_OPENID}?${q}`
    },
    async finish({ query, redirectUri, fetch }) {
      // Steam's answer is only trusted after Steam itself confirms it
      // (check_authentication) and it was meant for this site.
      if (query.get('openid.mode') !== 'id_res') throw new AuthError('cancelled')
      if (query.get('openid.op_endpoint') !== STEAM_OPENID) throw new AuthError('failed')
      if (!String(query.get('openid.return_to') || '').startsWith(`${redirectUri}?`)) throw new AuthError('failed')
      const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(query.get('openid.claimed_id') || '')
      if (!m || query.get('openid.identity') !== query.get('openid.claimed_id')) throw new AuthError('failed')
      const check = new URLSearchParams()
      for (const [k, v] of query) if (k.startsWith('openid.')) check.set(k, v)
      check.set('openid.mode', 'check_authentication')
      const res = await fetch(STEAM_OPENID, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: check })
      const text = res.ok ? await res.text() : ''
      if (!/^is_valid\s*:\s*true\s*$/m.test(text)) throw new AuthError('failed')
      const id = m[1]
      let name = ''
      let picture = null
      try {
        const xml = await (await fetch(`https://steamcommunity.com/profiles/${id}/?xml=1`)).text()
        name = xmlText(xml, 'steamID')
        picture = xmlText(xml, 'avatarFull') || null
      } catch { /* a private or slow profile just means no name/picture */ }
      return { id, name, picture }
    },
  },
}

const STEAM_OPENID = 'https://steamcommunity.com/openid/login'

export class AuthError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function xmlText(xml, tag) {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(xml)
  return m ? m[1].trim() : ''
}

// Did the provider send the player back here (vs. the first visit that
// starts sign-in)?
export function isCallback(provider, query) {
  return provider === 'steam' ? query.has('openid.mode') : query.has('code') || query.has('error')
}

export function missingKeys(provider, env) {
  return PROVIDERS[provider].env.filter((k) => !env[k])
}

export function firebaseUid(provider, id) {
  const uid = `${provider}${id}`
  if (!/^[A-Za-z0-9]{4,40}$/.test(uid)) throw new AuthError('failed')
  return uid
}

// Only what Firebase accepts: a short name and an https picture.
export function cleanProfile({ name, picture }) {
  const displayName = [...String(name || '')].filter((c) => c.charCodeAt(0) >= 32).join('').trim().slice(0, 60)
  const photoURL = typeof picture === 'string' && /^https:\/\/[^\s"'<>]+$/.test(picture) && picture.length < 1000 ? picture : null
  return { displayName: displayName || null, photoURL }
}

export function sameState(a, b) {
  return typeof a === 'string' && typeof b === 'string' && /^[0-9a-f]{32}$/.test(a) && a === b
}

// The page the sign-in window ends on: hands the token (or what went wrong)
// back to the game window, then closes itself. Both postMessage (to the
// window that opened it) and a BroadcastChannel (works even when a site's
// Cross-Origin-Opener-Policy cut the link to that window).
export function resultPage({ token = null, error = null, profile = null }) {
  const data = JSON.stringify({ type: 'gayz-auth', token, error, profile }).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GayZ</title></head>
<body style="margin:0;padding:48px 16px;background:#1b1b1b;color:#eee;font:16px system-ui,sans-serif;text-align:center">
<p id="m">${error ? 'Sign-in did not finish. You can close this window and try again.' : 'Signed in. You can close this window.'}</p>
<script>
(function () {
  var d = ${data}
  try { if (window.opener) window.opener.postMessage(d, location.origin) } catch (e) {}
  try { var c = new BroadcastChannel('gayz-auth'); c.postMessage(d); c.close() } catch (e) {}
  setTimeout(function () { window.close() }, 300)
})()
</script></body></html>`
}
