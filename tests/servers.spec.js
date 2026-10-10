import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { fakeServerDb } from './fakeServerDb.js'
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
  let ra = await syncServer(db, { ...a, state: { x: 1, y: 1, z: 1 }, wave: 2, zombies: { z3: { x: 2, y: 1, z: 2, hp: 60, max: 100 } }, hurt: [{ to: b.playerId, amount: 12 }], credits: [{ to: b.playerId, boss: true }] }, t0 + 200)
  expect(ra.isHost).toBe(true)
  expect(ra.hits).toEqual([{ id: 'z3', dmg: 40, by: b.playerId }])
  expect(ra.players[b.playerId]).toMatchObject({ nick: 'Bo', x: 5, z: 6 })
  ra = await syncServer(db, { ...a }, t0 + 300)
  expect(ra.hits).toEqual([])

  // The guest sees the host's zombies and wave, and gets its bite and kill once.
  rb = await syncServer(db, { ...b, skinsFor: [a.playerId] }, t0 + 400)
  expect(rb.wave).toBe(2)
  expect(rb.zombies.z3).toMatchObject({ hp: 60 })
  expect(rb.hurt).toEqual([12])
  expect(rb.credits).toEqual([{ boss: true }])
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

test('servers: a full server turns new players away', async () => {
  const db = fakeServerDb()
  const a = await createServer(db, { nickname: 'Ann' }, 0)
  for (let i = 1; i < MAX_PLAYERS; i++) await joinServer(db, { serverId: a.serverId, nickname: `P${i}` }, i)
  await expect(joinServer(db, { serverId: a.serverId, nickname: 'Late' }, 50)).rejects.toMatchObject({ status: 409, code: 'full' })
  await expect(joinServer(db, { serverId: 'NOPE42', nickname: 'X' }, 50)).rejects.toMatchObject({ status: 404 })
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
  await b.evaluate(() => { window.__game.settings.nickname = 'Bo' })
  await b.evaluate(() => window.__game._openServerPanel())
  await expect(b.locator('#server-list .server-row')).toHaveCount(1)
  await expect(b.locator('#server-list')).toContainText('Night Shift')
  await expect(b.locator('#server-list')).toContainText('1 / 8')
  await b.click('#server-list .server-join-btn')
  await b.waitForFunction(() => window.__game.buildMode?.survival?.active && window.__game.buildMode.survival.net, null, { timeout: 60000 })
  await b.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))

  // Syncs by hand too, so the test doesn't wait on background frames.
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

  // The guest leaves: gone from the host's game and the list.
  await b.evaluate(() => window.__game.buildMode.survival.stop())
  await settle().catch(() => {})
  await sync(a)
  expect(await a.evaluate(() => window.__game.buildMode.survival.net.players.size)).toBe(0)
  const list = await listServers(db)
  expect(list).toEqual([expect.objectContaining({ name: 'Night Shift', players: 1 })])
  await a.close()
  await b.close()
})
