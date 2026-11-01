import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { fakeServerDb } from './fakeServerDb.js'
import { PROVIDERS, isCallback, missingKeys, firebaseUid, cleanProfile, sameState, resultPage, siteOrigin } from '../api/_lib/oauth.js'
import { createServer, joinServer, listServers, syncServer, leaveServer, MAX_PLAYERS, STALE_MS, JOIN_GRACE_MS } from '../api/_lib/servers.js'

// The servers' own rules (api/_lib/servers.js), on an in-memory database.
test('servers: create, join, sync, host hand-over, leave', async () => {
  const db = fakeServerDb()
  const t0 = 1_000_000
  const a = await createServer(db, { name: 'Night <b>Shift</b>', nickname: 'Ann' }, t0)
  expect(a.host).toBe(a.playerId)
  let list = await listServers(db, t0)
  expect(list).toEqual([expect.objectContaining({ id: a.serverId, name: 'Night bShift/b', players: 1, max: MAX_PLAYERS })])

  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, t0 + 10)
  expect(b.host).toBe(a.playerId)
  // A wrong token can't speak for a player.
  await expect(syncServer(db, { serverId: a.serverId, playerId: b.playerId, token: 'nope' }, t0 + 20)).rejects.toMatchObject({ status: 403 })

  // The guest's shot reaches the host once.
  let rb = await syncServer(db, { ...b, state: { x: 5, y: 1, z: 6 }, hits: [{ id: 'z3', dmg: 40 }] }, t0 + 100)
  expect(rb.isHost).toBe(false)
  let ra = await syncServer(db, { ...a, state: { x: 1, y: 1, z: 1 }, wave: 2, zombies: { z3: { x: 2, y: 1, z: 2, hp: 60, max: 100 }, z4: { x: 3, y: 1, z: 3, hp: 40, max: 40, k: 'warrior' }, z5: { x: 3, y: 1, z: 4, hp: 40, max: 40, k: '<img>' } }, hurt: [{ to: b.playerId, amount: 12 }], credits: [{ to: b.playerId, boss: true }, { to: b.playerId, skeleton: 'mage' }, { to: b.playerId, skeleton: '<img>' }, { to: b.playerId, tier: 'mythic' }, { to: b.playerId, tier: 'epic', assist: true }, { to: b.playerId, tier: '<img>' }] }, t0 + 200)
  expect(ra.isHost).toBe(true)
  expect(ra.hits).toEqual([{ id: 'z3', dmg: 40, by: b.playerId }])
  expect(ra.players[b.playerId]).toMatchObject({ nick: 'Bo', x: 5, z: 6 })
  ra = await syncServer(db, { ...a }, t0 + 300)
  expect(ra.hits).toEqual([])

  // The guest sees the host's zombies and wave, and gets its bite and kill once.
  rb = await syncServer(db, { ...b, skinsFor: [a.playerId] }, t0 + 400)
  expect(rb.wave).toBe(2)
  expect(rb.zombies.z3).toMatchObject({ hp: 60 })
  // A skeleton keeps its kind; anything else is dropped.
  expect(rb.zombies.z4.k).toBe('warrior')
  expect(rb.zombies.z5.k).toBeUndefined()
  expect(rb.zombies.z3.k).toBeUndefined()
  expect(rb.hurt).toEqual([12])
  // Each kill once; a skeleton kill keeps its kind (for the skeleton
  // achievements) and a kill its rarity (for its coins), an assist says so,
  // anything else is dropped.
  expect(rb.credits).toHaveLength(6)
  expect(rb.credits).toEqual(expect.arrayContaining([{ boss: true }, { boss: false, skeleton: 'mage' }, { boss: false }, { boss: false, tier: 'mythic' }, { boss: false, tier: 'epic', assist: true }]))
  expect(rb.credits.filter((c) => !c.skeleton && !c.tier && !c.boss)).toHaveLength(2)
  expect(rb.skins).toEqual({ [a.playerId]: null })
  rb = await syncServer(db, { ...b }, t0 + 500)
  expect(rb.hurt).toEqual([])

  // The host goes quiet: the guest takes over.
  rb = await syncServer(db, { ...b }, t0 + 500 + STALE_MS)
  // (Ann last synced at t0 + 300, so she's gone by now.)
  expect(rb.isHost).toBe(true)
  expect(rb.players).toEqual({})
  // Last one out closes the server.
  await leaveServer(db, { ...b }, t0 + 600 + STALE_MS)
  list = await listServers(db, t0 + 700 + STALE_MS)
  expect(list).toEqual([])
  expect(db.root.servers || {}).toEqual({})
  expect(db.root.serverSecrets || {}).toEqual({})
})

// Sign-in with Discord and Steam (api/_lib/oauth.js): only answers
// the site itself vouches for, meant for this site, are believed.
test('auth: Discord/Steam sign-in checks', async () => {
  const origin = 'https://gayz.vercel.app'
  const state = 'a'.repeat(32)
  expect(missingKeys('discord', {})).toEqual(['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'])
  expect(missingKeys('steam', {})).toEqual([])
  expect(sameState(state, state)).toBe(true)
  expect(sameState(state, 'b'.repeat(32))).toBe(false)
  expect(sameState(null, null)).toBe(false)
  expect(firebaseUid('steam', '76561198000000000')).toBe('steam76561198000000000')
  expect(() => firebaseUid('discord', '../x')).toThrow()
  expect(cleanProfile({ name: '  Ann\u0007 ', picture: 'javascript:alert(1)' })).toEqual({ displayName: 'Ann', photoURL: null })
  const discordUrl = new URL(PROVIDERS.discord.startUrl({ env: { DISCORD_CLIENT_ID: 'id1' }, redirectUri: `${origin}/api/auth/discord`, state }))
  expect(discordUrl.searchParams.get('state')).toBe(state)
  expect(discordUrl.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/discord`)
  expect(isCallback('discord', new URLSearchParams('code=x&state=y'))).toBe(true)
  expect(isCallback('discord', new URLSearchParams(''))).toBe(false)

  // Steam: a real-looking answer is checked with Steam before it counts.
  const redirectUri = `${origin}/api/auth/steam`
  const id = 'https://steamcommunity.com/openid/id/76561198000000000'
  const answer = (over = {}) => new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': id, 'openid.identity': id, 'openid.return_to': `${redirectUri}?state=${state}`, 'openid.sig': 'sig', state, ...over,
  })
  const fakeFetch = (valid) => async (url, opts) => {
    if (opts?.method === 'POST') return { ok: true, text: async () => `ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n` }
    return { ok: true, text: async () => '<profile><steamID><![CDATA[Gabe]]></steamID><avatarFull><![CDATA[https://avatars.example/a.jpg]]></avatarFull></profile>' }
  }
  await expect(PROVIDERS.steam.finish({ query: answer(), redirectUri, fetch: fakeFetch(true) })).resolves.toEqual({ id: '76561198000000000', name: 'Gabe', picture: 'https://avatars.example/a.jpg' })
  await expect(PROVIDERS.steam.finish({ query: answer(), redirectUri, fetch: fakeFetch(false) })).rejects.toMatchObject({ code: 'failed' })
  await expect(PROVIDERS.steam.finish({ query: answer({ 'openid.return_to': 'https://evil.example/api/auth/steam?state=x' }), redirectUri, fetch: fakeFetch(true) })).rejects.toMatchObject({ code: 'failed' })
  await expect(PROVIDERS.steam.finish({ query: answer({ 'openid.op_endpoint': 'https://evil.example/openid' }), redirectUri, fetch: fakeFetch(true) })).rejects.toMatchObject({ code: 'failed' })
  // An answer made out to this site but for another sign-in's state.
  await expect(PROVIDERS.steam.finish({ query: answer({ 'openid.return_to': `${redirectUri}?state=${'c'.repeat(32)}` }), redirectUri, fetch: fakeFetch(true) })).rejects.toMatchObject({ code: 'failed' })
  // The site's own address never comes from a faked Host header (2026-10-30).
  const env = { VERCEL_URL: 'gayz-abc123.vercel.app', PUBLIC_ORIGIN: 'https://play.example' }
  expect(siteOrigin({ host: 'gayz.vercel.app' }, {})).toBe('https://gayz.vercel.app')
  expect(siteOrigin({ host: 'evil.example' }, env)).toBe('https://gayz.vercel.app')
  expect(siteOrigin({ host: 'gayz.vercel.app', 'x-forwarded-host': 'evil.example' }, env)).toBe('https://gayz.vercel.app')
  expect(siteOrigin({ 'x-forwarded-host': 'gayz-abc123.vercel.app' }, env)).toBe('https://gayz-abc123.vercel.app')
  expect(siteOrigin({ host: 'PLAY.example' }, env)).toBe('https://play.example')
  await expect(PROVIDERS.steam.finish({ query: answer({ 'openid.mode': 'cancel' }), redirectUri, fetch: fakeFetch(true) })).rejects.toMatchObject({ code: 'cancelled' })

  // The page that hands the token back can't be broken out of.
  expect(resultPage({ token: '</script><script>alert(1)</script>' })).not.toContain('</script><script>alert')
})

// 2026-10-26 ("they didn't see the same thing I had on my screen"): the
// host's sky and animals, everyone's blocks and chat bubbles are shared; a
// solo game ready for friends is a hidden server (joined by its link only).
test('servers: the same world for everyone - sky, animals, blocks, bubbles', async () => {
  const db = fakeServerDb()
  const t0 = 2_000_000
  const a = await createServer(db, { nickname: 'Ann', hidden: true }, t0)
  // Hidden: not in the list, but its link still joins it.
  expect(await listServers(db, t0)).toEqual([])
  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, t0 + 10)

  // The host's blocks from before Bo joined, then its sky, animals and a
  // monster zombie (kept, not turned into a plain zombie).
  await syncServer(db, { ...a, edits: [{ x: 1, y: 2, z: 3, b: 'oakplanks' }, { x: 4, y: 5, z: 6, b: '' }, { x: 7, y: 8, z: 9, b: '<img>' }] }, t0 + 20)
  await syncServer(db, { ...a, sky: { c: 512.5, n: 'hardRain', g: 'clear', r: 0 }, animals: { a1: { k: 'cow', x: 3, y: 1, z: 4, h: 1, hp: 50, t: '', d: false }, bad: { k: 'cow' }, a2: { k: '<b>' } }, zombies: { z1: { x: 1, y: 1, z: 1, hp: 10, max: 10, k: 'blob' } }, say: { n: 1, text: 'hi <there>' } }, t0 + 30)
  let rb = await syncServer(db, { ...b, editsAfter: 0 }, t0 + 40)
  expect(rb.edits).toEqual(expect.arrayContaining([{ x: 1, y: 2, z: 3, b: 'oakplanks' }, { x: 4, y: 5, z: 6, b: '' }, { x: 7, y: 8, z: 9, b: '' }]))
  expect(rb.edits).toHaveLength(3)
  expect(rb.sky).toEqual({ c: 512.5, n: 'hardRain', g: 'clear', r: 0 })
  expect(Object.keys(rb.animals)).toEqual(['a1'])
  expect(rb.animals.a1).toMatchObject({ k: 'cow', hp: 50 })
  expect(rb.zombies.z1.k).toBe('blob')
  expect(rb.players[a.playerId].say).toEqual({ n: 1, text: 'hi there', age: 10 })

  // Only new edits next time; mine never come back to me; the latest wins.
  rb = await syncServer(db, { ...b, editsAfter: rb.editSeq, edits: [{ x: 1, y: 2, z: 3, b: '' }], hits: [{ id: 'a1', dmg: 20 }, { id: 'a1', dmg: 0, tame: true }, { id: 'q1', dmg: 5 }] }, t0 + 50)
  expect(rb.edits).toEqual([])
  const ra = await syncServer(db, { ...a, editsAfter: 3 }, t0 + 60)
  expect(ra.edits).toEqual([{ x: 1, y: 2, z: 3, b: '' }])
  // Bo's shot and taming reach the host's animal.
  expect(ra.hits).toEqual(expect.arrayContaining([{ id: 'a1', dmg: 20, by: b.playerId }, { id: 'a1', dmg: 0, by: b.playerId, tame: true }]))
  expect(ra.hits).toHaveLength(2)
})

test('servers: a full server turns new players away', async () => {
  const db = fakeServerDb()
  const a = await createServer(db, { nickname: 'Ann' }, 0)
  for (let i = 1; i < MAX_PLAYERS; i++) await joinServer(db, { serverId: a.serverId, nickname: `P${i}` }, i)
  await expect(joinServer(db, { serverId: a.serverId, nickname: 'Late' }, 50)).rejects.toMatchObject({ status: 409, code: 'full' })
  await expect(joinServer(db, { serverId: 'NOPE42', nickname: 'X' }, 50)).rejects.toMatchObject({ status: 404 })
})

test('servers: a server everyone dropped out of opens again under its id', async () => {
  const db = fakeServerDb()
  const a = await createServer(db, { nickname: 'Ann', skin: 'data:image/png;base64,AAAA' }, 0)
  // Someone still in it: the id is taken.
  const taken = await createServer(db, { nickname: 'Bo', id: a.serverId }, 10)
  expect(taken.serverId).not.toBe(a.serverId)
  // Nobody left: the dropped player opens it again, and joining works.
  const later = JOIN_GRACE_MS + STALE_MS
  await expect(joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, later)).rejects.toMatchObject({ code: 'gone' })
  const again = await createServer(db, { nickname: 'Ann', id: a.serverId }, later)
  expect(again.serverId).toBe(a.serverId)
  expect(Object.keys(db.root.serverSecrets[a.serverId])).toEqual([again.playerId])
  expect(db.root.serverSkins?.[a.serverId]).toBeUndefined()
  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, later + 10)
  expect(Object.keys((await syncServer(db, { ...again }, later + 20)).players)).toEqual([b.playerId])
})

test('servers: a host in a hidden tab hands the zombies to someone playing', async () => {
  const db = fakeServerDb()
  const a = await createServer(db, { nickname: 'Ann' }, 0)
  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, 10)
  await syncServer(db, { ...a, state: { away: true } }, 20)
  // Someone else away too: nothing changes.
  expect((await syncServer(db, { ...b, state: { away: true } }, 30)).isHost).toBe(false)
  expect((await syncServer(db, { ...b, state: { away: false } }, 40)).isHost).toBe(true)
  expect((await syncServer(db, { ...a, state: { away: false } }, 50)).isHost).toBe(false)
})

test('servers: a player still loading the map is not dropped', async () => {
  const db = fakeServerDb()
  const a = await createServer(db, { nickname: 'Ann' }, 0)
  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, 10)
  // No sync from Bo yet, but well inside the grace period.
  expect(Object.keys((await syncServer(db, { ...a }, STALE_MS + 1000)).players)).toEqual([b.playerId])
  // Past it: gone.
  expect((await syncServer(db, { ...a }, JOIN_GRACE_MS + 1000)).players).toEqual({})
})

const serverIdOf = (db) => Object.keys(db.root.servers)[0]

// Two real games on one server: the list, joining, seeing each other, the
// host's zombie mirrored to the guest, the guest's shot killing it (and
// the kill counted for the guest), a bite reaching the guest, leaving.
// Both pages talk to the servers' real rules on one in-memory database.
test('two players play Map 1 together on a server', async ({ browser }) => {
  test.setTimeout(240000)
  const db = fakeServerDb()
  const fns = { list: () => listServers(db), create: (b) => createServer(db, b), join: (b) => joinServer(db, b), leave: (b) => leaveServer(db, b), sync: (b) => syncServer(db, b) }
  const open = async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.exposeFunction('__srv', async (name, body) => {
      try {
        return { ok: await fns[name](body) }
      } catch (err) {
        return { err: err.code || 'server' }
      }
    })
    // Every address the page writes, to check joining never shows /map-editor.
    await page.addInitScript(() => {
      window.__urls = []
      for (const k of ['pushState', 'replaceState']) {
        const f = history[k].bind(history)
        history[k] = (st, ti, u) => { window.__urls.push(String(u)); return f(st, ti, u) }
      }
    })
    await gotoAndWaitForGame(page)
    await page.evaluate(() => {
      const call = async (name, body) => {
        const r = await window.__srv(name, body)
        if (r.err) throw Object.assign(new Error(r.err), { code: r.err })
        return r.ok
      }
      window.__game.__serversBackendForTests = {
        list: () => call('list'), create: (b) => call('create', b), join: (b) => call('join', b), leave: (b) => call('leave', b), sync: (b) => call('sync', b),
      }
    })
    return page
  }

  const a = await open()
  await a.evaluate(() => { window.__game.settings.nickname = 'Ann' })
  await a.evaluate(() => window.__game._openServerPanel())
  await expect(a.locator('#server-list')).toContainText('No servers yet')
  await a.fill('#server-create-name', 'Night Shift')
  await a.click('#server-create-btn')
  await a.waitForFunction(() => window.__game.buildMode?.survival?.active && window.__game.buildMode.survival.net, null, { timeout: 60000 })
  await a.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))

  const b = await open()
  // Building the second page's game can starve the first page's timers for
  // longer than STALE_MS in one headless browser, and the list below would
  // then delete Ann's server as empty - sync her by hand first.
  await a.evaluate(() => window.__game.buildMode.survival.net._sync())
  await b.evaluate(() => { window.__game.settings.nickname = 'Bo' })
  await b.evaluate(() => window.__game._openServerPanel())
  await expect(b.locator('#server-list .server-row')).toHaveCount(1)
  await expect(b.locator('#server-list')).toContainText('Night Shift')
  await expect(b.locator('#server-list')).toContainText('1 / 8')
  await b.click('#server-list .server-join-btn')
  await b.waitForFunction(() => window.__game.buildMode?.survival?.active && window.__game.buildMode.survival.net, null, { timeout: 60000 })
  await b.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))

  // Syncs by hand too, so the test doesn't wait on background frames.
  // Making and joining a server never shows /map-editor in the address bar.
  for (const pg of [a, b]) expect(await pg.evaluate(() => window.__urls.filter((u) => u.includes('map-editor')))).toEqual([])
  const sync = (page) => page.evaluate(() => window.__game.buildMode.survival.net._sync())
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await sync(a)
      await sync(b)
    }
  }
  await settle()
  const seen = await Promise.all([a, b].map((p) => p.evaluate(() => {
    const n = window.__game.buildMode.survival.net
    return { host: n.isHost, others: [...n.players.values()].map((p) => p.nick) }
  })))
  expect(seen[0]).toEqual({ host: true, others: ['Bo'] })
  expect(seen[1]).toEqual({ host: false, others: ['Ann'] })

  // Each sees the other holding the weapon they picked (2026-10-11), and
  // the chat says who joined - but not for players already there.
  await a.waitForFunction(() => [...window.__game.buildMode.survival.net.players.values()][0]?.gunId === 'rifle', null, { timeout: 20000 })
  await b.waitForFunction(() => [...window.__game.buildMode.survival.net.players.values()][0]?.gunId === 'rifle', null, { timeout: 20000 })
  expect(await a.evaluate(() => [...window.__game.buildMode.survival.net.players.values()][0].gun.parent === [...window.__game.buildMode.survival.net.players.values()][0].body.limbPivots.armR)).toBe(true)
  await expect(a.locator('#chat-messages .chat-system-row')).toHaveText(['Bo joined the game'])
  await expect(b.locator('#chat-messages .chat-system-row')).toHaveCount(0)

  // The host's zombie shows up for the guest.
  const zid = await a.evaluate(() => {
    const s = window.__game.buildMode.survival
    s._toSpawn = 0
    s._breakTimer = 999
    for (const z of [...s.zombies]) { s._removeZombie(z); s.zombies = s.zombies.filter((o) => o !== z) }
    const p = s.bm.tryMode.pos
    return s._makeZombie(++s._zid, p.x + 3, p.y, p.z + 3, 100, false).id
  })
  await settle()
  expect(await b.evaluate(() => window.__game.buildMode.survival.zombies.map((z) => z.id))).toEqual([zid])

  // The guest's shot kills it: gone for both, the kill is the guest's.
  await b.evaluate((id) => window.__game.buildMode.survival.net.queueHit(`z${id}`, 500), zid)
  await settle()
  const afterKill = await Promise.all([a, b].map((p) => p.evaluate(() => {
    const s = window.__game.buildMode.survival
    return { zombies: s.zombies.length, kills: s.kills }
  })))
  expect(afterKill[0]).toEqual({ zombies: 0, kills: 0 })
  expect(afterKill[1]).toEqual({ zombies: 0, kills: 1 })

  // Both see the same world (2026-10-26): the host's sky and a monster
  // zombie's kind...
  const zid2 = await a.evaluate(() => {
    const s = window.__game.buildMode.survival
    const sky = s.bm.sky
    sky._now = sky._goal = 'hardRain'
    sky._clock = 777
    sky.apply()
    const p = s.bm.tryMode.pos
    return s._makeZombie(++s._zid, p.x + 4, p.y, p.z + 4, 100, false, 'blob').id
  })
  await settle()
  const guestSky = await b.evaluate((id) => {
    const s = window.__game.buildMode.survival
    return { now: s.bm.sky._now, clock: Math.round(s.bm.sky._clock), kind: s.zombies.find((z) => z.id === id)?.kind }
  }, zid2)
  expect(guestSky.now).toBe('hardRain')
  expect(Math.abs(guestSky.clock - 777)).toBeLessThan(5)
  expect(guestSky.kind).toBe('blob')
  // ...the guest's hit shows a damage number where it landed...
  const dmgShown = await b.evaluate((id) => {
    const s = window.__game.buildMode.survival
    s.hitZombieWith(s.zombies.find((z) => z.id === id), 37, null)
    return [...document.querySelectorAll('#play-damage-numbers .play-dmg span')].map((el) => el.textContent)
  }, zid2)
  expect(dmgShown).toContain('37')
  // ...blocks placed and broken by either of them...
  const spot = await a.evaluate(() => {
    const s = window.__game.buildMode.survival
    const p = s.bm.tryMode.pos
    const x = Math.floor(p.x) + 2
    const z = Math.floor(p.z) + 2
    let y = Math.floor(p.y) + 3
    while (s.bm.getBlockAt(x, y, z)) y++
    s.bm.placeBlock(x, y, z, 'oakplanks', false)
    s._placed.set(s.bm._key(x, y, z), 'oakplanks')
    s._recordEdit(x, y, z, 'oakplanks')
    return { x, y, z }
  })
  await settle()
  expect(await b.evaluate(({ x, y, z }) => window.__game.buildMode.getBlockAt(x, y, z), spot)).toBe('oakplanks')
  await b.evaluate(({ x, y, z }) => {
    const s = window.__game.buildMode.survival
    s.bm.tryMode.breakBlock(x, y, z)
    s.onBlockMined('oakplanks', x, y, z)
  }, spot)
  await settle()
  expect(await a.evaluate(({ x, y, z }) => window.__game.buildMode.getBlockAt(x, y, z) || '', spot)).toBe('')
  // ...the host's animals, which the guest can hit...
  const cowId = await a.evaluate(() => {
    const s = window.__game.buildMode.survival
    const p = s.bm.tryMode.pos
    return s.animals.spawn('cow', p.x + 5, p.y, p.z + 5).netId
  })
  await settle()
  expect(await b.evaluate((id) => window.__game.buildMode.survival.animals.list.find((an) => an.netId === id)?.kind, cowId)).toBe('cow')
  await b.evaluate((id) => window.__game.buildMode.survival.net.queueAnimalHit(id, 999), cowId)
  await settle()
  // Dying, or already gone once it fell over.
  expect(await a.evaluate((id) => {
    const an = window.__game.buildMode.survival.animals.list.find((o) => o.netId === id)
    return !an || an.dying
  }, cowId)).toBe(true)
  // ...a block in the guest's hand, and what the guest says in chat over
  // their head (and over their own body).
  await b.evaluate(() => {
    const s = window.__game.buildMode.survival
    s.holding = { kind: 'block', id: 'oakplanks' }
    s.onChatSent('hello there')
  })
  await settle()
  await a.waitForFunction(() => {
    const p = [...window.__game.buildMode.survival.net.players.values()][0]
    return p?.blockId === 'oakplanks' && !!p.bubble && !p.gun
  }, null, { timeout: 20000 })
  expect(await b.evaluate(() => !!window.__game.buildMode.survival._ownBubble)).toBe(true)
  await b.evaluate(() => { window.__game.buildMode.survival.holding = null })

  // A bite on the guest reaches the guest.
  await b.evaluate(() => {
    const s = window.__game.buildMode.survival
    window.__bites = []
    s._hurtPlayer = (n) => window.__bites.push(n)
  })
  const bPid = await b.evaluate(() => window.__game.buildMode.survival.net.playerId)
  await a.evaluate((pid) => window.__game.buildMode.survival.net.queueHurt(pid, 9), bPid)
  await settle()
  expect(await b.evaluate(() => window.__bites)).toEqual([9])

  // The guest gets dropped (a few seconds of lag and the host's syncs
  // count them as gone, 2026-10-26): they get back into the same server
  // on their own instead of carrying on alone.
  delete db.root.servers[serverIdOf(db)].players[bPid]
  delete db.root.serverSecrets[serverIdOf(db)][bPid]
  await b.waitForFunction((old) => window.__game.buildMode.survival.net?.playerId !== old, bPid, { timeout: 20000 })
  await settle()
  expect(await b.evaluate(() => window.__game.buildMode.survival.net.serverId)).toBe(serverIdOf(db))
  expect(await a.evaluate(() => [...window.__game.buildMode.survival.net.players.values()].map((p) => p.nick))).toEqual(['Bo'])
  expect(await b.evaluate(() => [...window.__game.buildMode.survival.net.players.values()].map((p) => p.nick))).toEqual(['Ann'])
  await expect(b.locator('#chat-messages .chat-system-row')).toHaveText(['Reconnected to the server.'])

  // The guest leaves: gone from the host's game and the list.
  await b.evaluate(() => window.__game.buildMode.survival.stop())
  await settle().catch(() => {})
  await sync(a)
  expect(await a.evaluate(() => window.__game.buildMode.survival.net.players.size)).toBe(0)
  // (Seen leaving and coming back when dropped, in either order.)
  const rows = a.locator('#chat-messages .chat-system-row')
  await expect(rows).toHaveCount(4)
  await expect(rows.first()).toHaveText('Bo joined the game')
  await expect(rows.last()).toHaveText('Bo left the game')
  const list = await listServers(db)
  expect(list).toEqual([expect.objectContaining({ name: 'Night Shift', players: 1 })])
  await a.close()
  await b.close()
})

// Invite Friends (2026-10-18): a solo World Map game becomes a server from
// the pause menu, its link is shown, and a friend opening the link joins
// the same world (same land, Earth) and starts where the host did.
test('Invite Friends makes a solo game joinable and the link joins it', async ({ browser }) => {
  test.setTimeout(240000)
  const db = fakeServerDb()
  const fns = { list: () => listServers(db), create: (b) => createServer(db, b), join: (b) => joinServer(db, b), leave: (b) => leaveServer(db, b), sync: (b) => syncServer(db, b) }
  const open = async (path = '/') => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.exposeFunction('__srv', async (name, body) => {
      try {
        return { ok: await fns[name](body) }
      } catch (err) {
        return { err: err.code || 'server' }
      }
    })
    await page.addInitScript(() => {
      const call = async (name, body) => {
        const r = await window.__srv(name, body)
        if (r.err) throw Object.assign(new Error(r.err), { code: r.err })
        return r.ok
      }
      window.__serversBackendForTests = { list: () => call('list'), create: (b) => call('create', b), join: (b) => call('join', b), leave: (b) => call('leave', b), sync: (b) => call('sync', b) }
    })
    await gotoAndWaitForGame(page, path)
    return page
  }

  const a = await open()
  await a.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap'; window.__game.playBtn.click() })
  await a.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const host = await a.evaluate(() => {
    const s = window.__game.buildMode.survival
    s._spawnAt({ lat: 48.85, lon: 2.35, biome: 'plains', country: 'France', city: 'Paris' })
    s._pickWeapon('rifle')
    const p = s.bm.tryMode.pos
    return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) }
  })
  await a.waitForFunction(() => window.__game.buildMode.survival.lobby && location.search.startsWith('?join='), null, { timeout: 20000 })
  const lobbySearch = await a.evaluate(() => location.search)
  expect(await a.evaluate(() => !window.__game.buildMode.survival.net)).toBe(true)
  await a.keyboard.press('Escape')
  await a.waitForFunction(() => document.getElementById('play-pause-menu')?.style.display === 'flex', null, { timeout: 10000 })
  await expect(a.locator('#play-pause-invite-btn')).toBeVisible()
  // Still the link with the pause menu open.
  expect(await a.evaluate(() => location.search)).toBe(lobbySearch)
  await a.click('#play-pause-invite-btn')
  await expect(a.locator('#play-invite')).toBeVisible()
  const link = await a.inputValue('#play-invite-link')
  expect(link).toMatch(/\/\?join=[A-Z0-9]{6}$/)
  // The address bar was already the invite link before Invite Friends was
  // clicked (the game is a hidden server from the start, 2026-10-26).
  expect(new URL(link).search).toBe(lobbySearch)
  expect(await a.evaluate(() => !!window.__game.buildMode.survival.net?.isHost)).toBe(true)
  await expect(a.locator('#play-pause-save-btn')).toBeHidden()

  const b = await open(new URL(link).pathname + new URL(link).search)
  await a.evaluate(() => window.__game.buildMode.survival.net._sync())
  await b.waitForFunction(() => window.__game.buildMode?.survival?.active && window.__game.buildMode.survival.net, null, { timeout: 60000 })
  const guest = await b.evaluate(() => {
    const s = window.__game.buildMode.survival
    const p = s.bm.tryMode.pos
    return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), url: location.search, host: s.net.isHost }
  })
  expect(guest.host).toBe(false)
  // On the server the address bar is its invite link (not /map-editor).
  expect(guest.url).toBe(new URL(link).search)
  expect(await a.evaluate(() => location.pathname + location.search)).toBe(new URL(link).pathname + new URL(link).search)
  // Same spot on the same land (the same ground height there).
  expect([guest.x, guest.y, guest.z]).toEqual([host.x, host.y, host.z])
})

// 2026-10-19 (Gaymi's friend was "muted for spamming" just trying to chat):
// presses that send nothing - here, not signed in - never count as spam.
test('chat: presses that send nothing never mute you', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const muted = await page.evaluate(async () => {
    const g = window.__game
    g._cloudUid = null
    for (let i = 0; i < 12; i++) {
      g.chatInput.value = 'hello ' + i
      g.chatInputRow.requestSubmit()
      await new Promise((r) => setTimeout(r, 10))
    }
    return { until: g._chatMutedUntil, notice: getComputedStyle(g.chatMutedNotice).display }
  })
  expect(muted.until).toBe(0)
  expect(muted.notice).toBe('none')
})

test('servers: a guest\'s Catch Trap goes to the host and the answer comes back', async () => {
  const db = fakeServerDb()
  const t0 = 3_000_000
  const a = await createServer(db, { nickname: 'Ann' }, t0)
  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, t0 + 10)
  // Bo's trap hits the host's zombie: it reaches the host marked as a catch.
  await syncServer(db, { ...b, hits: [{ id: 'z7', dmg: 0, catch: true }, { id: 'a2', dmg: 999, catch: 'yes' }] }, t0 + 20)
  let ra = await syncServer(db, { ...a }, t0 + 30)
  expect(ra.hits).toEqual(expect.arrayContaining([{ id: 'z7', dmg: 0, by: b.playerId, catch: true }, { id: 'a2', dmg: 999, by: b.playerId }]))
  // The host's answers reach only Bo, cleaned.
  ra = await syncServer(db, { ...a, catches: [
    { to: b.playerId, ok: true, t: 'z', k: 'brute', r: 'epic', n: 12, b: true },
    { to: b.playerId, ok: false, t: 'a', k: 'polarBear', r: 'rare' },
    { to: b.playerId, ok: true, t: 'a', k: '<img>', r: '<b>', n: -4 },
    { to: b.playerId, ok: true, t: 'x' },
    { to: a.playerId, ok: true, t: 'z' },
  ] }, t0 + 40)
  expect(ra.caught).toEqual([])
  const rb = await syncServer(db, { ...b }, t0 + 50)
  expect(rb.caught).toEqual(expect.arrayContaining([
    { ok: true, t: 'z', k: 'brute', r: 'epic', n: 12, b: true },
    { ok: false, t: 'a', k: 'polarBear', r: 'rare', n: 0, b: false },
    { ok: true, t: 'a', k: '', r: 'common', n: 0, b: false },
    { ok: false },
  ]))
  expect(rb.caught).toHaveLength(4)
  expect((await syncServer(db, { ...b }, t0 + 60)).caught).toEqual([])
})

// Infection mode (Infection.js): the server keeps the host's round and
// passes guests' stun shots on.
test('servers: Infection rounds and stun shots go through the server', async () => {
  const db = fakeServerDb()
  const t0 = 1_000_000
  const a = await createServer(db, { nickname: 'Ann', mode: 'infection' }, t0)
  expect(a.mode).toBe('infection')
  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, t0 + 10)
  expect(b.mode).toBe('infection')
  await syncServer(db, { ...b, hits: [{ id: `s${a.playerId}`, dmg: 0 }, { id: 's<b>', dmg: 0 }] }, t0 + 20)
  const ra = await syncServer(db, { ...a, inf: { ph: 'play', t: 99.5, r: 2, w: '', ids: [a.playerId, 'b1', '<img>'], st: { b1: 2 }, bots: { b1: { x: 1, y: 2, z: 3, h: 0.5, n: 1 }, bad: { x: 1 } } } }, t0 + 30)
  expect(ra.hits).toEqual([{ id: `s${a.playerId}`, dmg: 0, by: b.playerId }])
  const rb = await syncServer(db, { ...b }, t0 + 40)
  expect(rb.inf).toEqual({ ph: 'play', t: 99.5, r: 2, w: '', ids: [a.playerId, 'b1'], st: { b1: 2 }, bots: { b1: { x: 1, y: 2, z: 3, h: 0.5, n: 1 } } })
  // A Zombie Survival server takes no stun shots and no round.
  const c = await createServer(db, { nickname: 'Cy' }, t0)
  const d = await joinServer(db, { serverId: c.serverId, nickname: 'Di' }, t0 + 10)
  await syncServer(db, { ...d, hits: [{ id: `s${c.playerId}`, dmg: 0 }] }, t0 + 20)
  const rc = await syncServer(db, { ...c, inf: { ph: 'play' } }, t0 + 30)
  expect(rc.hits).toEqual([])
  expect((await syncServer(db, { ...d }, t0 + 40)).inf).toBeUndefined()
})

test('Infection: a friend joins by link, gets tagged and stuns the zombie', async ({ browser }) => {
  test.setTimeout(240000)
  const db = fakeServerDb()
  const fns = { list: () => listServers(db), create: (b) => createServer(db, b), join: (b) => joinServer(db, b), leave: (b) => leaveServer(db, b), sync: (b) => syncServer(db, b) }
  const open = async (path = '/') => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.exposeFunction('__srv', async (name, body) => {
      try {
        return { ok: await fns[name](body) }
      } catch (err) {
        return { err: err.code || 'server' }
      }
    })
    await page.addInitScript(() => {
      const call = async (name, body) => {
        const r = await window.__srv(name, body)
        if (r.err) throw Object.assign(new Error(r.err), { code: r.err })
        return r.ok
      }
      window.__serversBackendForTests = { list: () => call('list'), create: (b) => call('create', b), join: (b) => call('join', b), leave: (b) => call('leave', b), sync: (b) => call('sync', b) }
    })
    await gotoAndWaitForGame(page, path)
    return page
  }

  const a = await open()
  await a.evaluate(() => { window.__game.settings.selectedGameMode = 'infection'; window.__game.playBtn.click() })
  await a.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await a.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await a.waitForFunction(() => window.__game.buildMode.survival.lobby && location.search.startsWith('?join='), null, { timeout: 20000 })
  const search = await a.evaluate(() => location.search)
  const b = await open(`/${search}`)
  await a.evaluate(() => window.__game.buildMode.survival.lobby?._sync() || window.__game.buildMode.survival.net?._sync())
  await b.waitForFunction(() => window.__game.buildMode?.survival?.active && window.__game.buildMode.survival.net, null, { timeout: 60000 })
  await b.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  const sync = (page) => page.evaluate(() => window.__game.buildMode.survival.net._sync())
  await sync(b)
  await a.evaluate(() => window.__game.buildMode.survival.lobby?._sync() || window.__game.buildMode.survival.net._sync())
  await sync(b)
  const guest = await b.evaluate(() => {
    const s = window.__game.buildMode.survival
    return { mode: s.cfg.mode, noZombies: s.cfg.noZombies, inf: !!s.infection, netMode: s.net.mode, host: s.net.isHost }
  })
  expect(guest).toEqual({ mode: 'infection', noZombies: true, inf: true, netMode: 'infection', host: false })
  // Bo walks off a little, out of reach.
  await b.evaluate(() => { window.__game.buildMode.survival.bm.tryMode.pos.x += 15 })
  await sync(b)
  await a.evaluate(() => window.__game.buildMode.survival.net._sync())

  // The host starts a round with itself as the first zombie.
  const hostId = await a.evaluate(() => {
    const s = window.__game.buildMode.survival
    const inf = s.infection
    inf.update(0.05)
    inf._begin(inf._people())
    // The first zombie is held for a head start.
    const held = [...inf.infected].every((id) => inf.stunned.has(id))
    inf.infected = new Set([inf.myId])
    inf.stunned.clear()
    inf.update(0.05)
    return held && inf.myId
  })
  await a.evaluate(() => window.__game.buildMode.survival.net._sync())
  await sync(b)
  const seen = await b.evaluate(() => {
    const inf = window.__game.buildMode.survival.infection
    inf.update(0.05)
    return { phase: inf.phase, ids: [...inf.infected], bots: inf.bots.size, me: inf.meInfected, hud: inf.hudText() }
  })
  expect(hostId).toBeTruthy()
  expect(seen.phase).toBe('play')
  expect(seen.ids).toContain(hostId)
  expect(seen.ids).not.toContain(await b.evaluate(() => window.__game.buildMode.survival.net.playerId))
  // Bots fill the rest of the TOTAL (6) spots.
  expect(seen.bots).toBe(4)
  expect(seen.me).toBe(false)
  expect(seen.hud).toContain('Infection')

  // Bo shoots Ann: the stun reaches the host.
  await b.evaluate((id) => {
    const s = window.__game.buildMode.survival
    const p = s.net.players.get(id)
    const B = s.B
    const ray = s.bm._raycaster.ray.clone()
    ray.origin.set((p.tx + 3) * B, (p.ty + 1) * B, p.tz * B)
    ray.direction.set(-1, 0, 0)
    window.__stunned = s.infection.shoot(ray, 50 * B)
  }, hostId)
  expect(await b.evaluate(() => window.__stunned)).toBe(true)
  await sync(b)
  await a.evaluate(() => window.__game.buildMode.survival.net._sync())
  expect(await a.evaluate(() => window.__game.buildMode.survival.infection.stunned.has(window.__game.buildMode.survival.infection.myId))).toBe(true)

  // Stunned, Ann can't tag; once it wears off, touching Bo turns him.
  const guestId = await b.evaluate(() => window.__game.buildMode.survival.net.playerId)
  const tagged = await a.evaluate((id) => {
    const s = window.__game.buildMode.survival
    const inf = s.infection
    const p = s.net.players.get(id)
    s.bm.tryMode.pos.set(p.tx, p.ty, p.tz)
    inf.update(0.05)
    const whileStunned = inf.infected.has(id)
    inf.stunned.clear()
    inf.update(0.05)
    return { whileStunned, after: inf.infected.has(id) }
  }, guestId)
  expect(tagged).toEqual({ whileStunned: false, after: true })
  await a.evaluate(() => window.__game.buildMode.survival.net._sync())
  await sync(b)
  expect(await b.evaluate(() => { const inf = window.__game.buildMode.survival.infection; inf.update(0.05); return inf.meInfected })).toBe(true)
  // Ann looks like a zombie on Bo's screen.
  await b.waitForFunction((id) => {
    const s = window.__game.buildMode.survival
    s.infection.update(0.05)
    const p = s.net.players.get(id)
    return p?.zbody?.visible && p.body && !p.body.visible
  }, hostId, { timeout: 20000 })
})

// 2026-11-01: Shrinking Zone servers share the host's zone, and everyone's
// boats and helicopters go out with their state (ShrinkZone.js, Vehicles.js).
test('servers: the zone and vehicles go through the server', async () => {
  const db = fakeServerDb()
  const t0 = 1_000_000
  const a = await createServer(db, { nickname: 'Ann', mode: 'zone' }, t0)
  expect(a.mode).toBe('zone')
  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, t0 + 10)
  await syncServer(db, { ...a, zone: { x: 1.5, z: -2, y: 4, s: 1234, t: 30.5 }, state: { x: 1, y: 1, z: 1, veh: [{ k: 'h', x: 1, y: 9, z: 2, h: 0.5, r: 1 }, { k: '<b>', x: 1 }, { k: 'b', x: 3, y: 1, z: 4, h: 0, r: 0 }] } }, t0 + 20)
  const rb = await syncServer(db, { ...b }, t0 + 30)
  expect(rb.zone).toEqual({ x: 1.5, z: -2, y: 4, s: 1234, t: 30.5 })
  expect(rb.players[a.playerId].veh).toEqual([{ k: 'h', x: 1, y: 9, z: 2, h: 0.5, r: 1 }, { k: 'b', x: 3, y: 1, z: 4, h: 0, r: 0 }])
  // A guest can't set the zone; a Zombie Survival server keeps none.
  await syncServer(db, { ...b, zone: { x: 99, z: 99, y: 0, s: 1, t: 0 } }, t0 + 40)
  expect((await syncServer(db, { ...b }, t0 + 50)).zone.s).toBe(1234)
  const c = await createServer(db, { nickname: 'Cy' }, t0)
  const d = await joinServer(db, { serverId: c.serverId, nickname: 'Di' }, t0 + 10)
  await syncServer(db, { ...c, zone: { x: 1, z: 1, y: 1, s: 5, t: 1 } }, t0 + 20)
  expect((await syncServer(db, { ...d }, t0 + 30)).zone).toBeUndefined()
})

test('Shrinking Zone: a friend joins, gets the same zone and sees my helicopter', async ({ browser }) => {
  test.setTimeout(240000)
  const db = fakeServerDb()
  const fns = { list: () => listServers(db), create: (b) => createServer(db, b), join: (b) => joinServer(db, b), leave: (b) => leaveServer(db, b), sync: (b) => syncServer(db, b) }
  const open = async (path = '/') => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.exposeFunction('__srv', async (name, body) => {
      try {
        return { ok: await fns[name](body) }
      } catch (err) {
        return { err: err.code || 'server' }
      }
    })
    await page.addInitScript(() => {
      const call = async (name, body) => {
        const r = await window.__srv(name, body)
        if (r.err) throw Object.assign(new Error(r.err), { code: r.err })
        return r.ok
      }
      window.__serversBackendForTests = { list: () => call('list'), create: (b) => call('create', b), join: (b) => call('join', b), leave: (b) => call('leave', b), sync: (b) => call('sync', b) }
    })
    await gotoAndWaitForGame(page, path)
    return page
  }
  const a = await open()
  await a.evaluate(() => { window.__game.settings.selectedGameMode = 'shrinkingZone'; window.__game.playBtn.click() })
  await a.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await a.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await a.waitForFunction(() => window.__game.buildMode.survival.lobby && location.search.startsWith('?join='), null, { timeout: 20000 })
  await a.waitForFunction(() => window.__game.buildMode.survival.zone?.started, null, { timeout: 20000 })
  const search = await a.evaluate(() => location.search)
  const b = await open(`/${search}`)
  await a.evaluate(() => window.__game.buildMode.survival.lobby?._sync() || window.__game.buildMode.survival.net?._sync())
  await b.waitForFunction(() => window.__game.buildMode?.survival?.active && window.__game.buildMode.survival.net, null, { timeout: 60000 })
  await b.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  const sync = (page) => page.evaluate(() => window.__game.buildMode.survival.net._sync())
  // The host puts a helicopter down (straight into the list - where it
  // lands doesn't matter here) and both sync.
  await a.evaluate(() => {
    const s = window.__game.buildMode.survival
    const p = s.bm.tryMode.pos
    const v = s.vehicles
    v.list.push({ id: 99, kind: 'heli', x: p.x + 3, y: p.y + 5, z: p.z, heading: 1, speed: 0, side: 0, vy: 0, fuel: 60, rotor: 1, group: new (s.bm.scene.constructor)() })
  })
  await sync(b)
  await a.evaluate(() => window.__game.buildMode.survival.net._sync())
  await sync(b)
  const host = await a.evaluate(() => {
    const z = window.__game.buildMode.survival.zone
    return { seed: z.seed, c: z.centers.map((c) => [Math.round(c.x * 10), Math.round(c.z * 10)]) }
  })
  const guest = await b.evaluate(() => {
    const s = window.__game.buildMode.survival
    for (let i = 0; i < 5; i++) s.net.update(0.1)
    const other = [...s.net.players.values()][0]
    return { mode: s.cfg.mode, netMode: s.net.mode, seed: s.zone?.seed, c: s.zone?.centers.map((c) => [Math.round(c.x * 10), Math.round(c.z * 10)]), wall: !!s.zone?.wall?.parent, veh: other?.veh?.map((d) => d.k), drawn: other?.vehicles?.length === 1 && !!other.vehicles[0].group.parent && !!other.vehicles[0].group.userData.rotor }
  })
  expect(guest).toEqual({ mode: 'shrinkingZone', netMode: 'zone', seed: host.seed, c: host.c, wall: true, veh: ['h'], drawn: true })
})
