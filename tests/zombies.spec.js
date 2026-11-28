// Zombies, creatures, animals and world events.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { zombieHat, zombieCape } from '../src/game/FunnyZombies.js'

// 2026-10-16: real animated 3D skeletons (SkeletonModels.js) join the
// waves - they rise, walk, take hits, are synced with their kind, and die
// with their own fall before sinking away.
test('skeletons rise, fight, sync and die', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(async () => { await window.__game._enterBuildMode({ map: 'map3', play: true }) })
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    if (document.getElementById('play-weapon-pick')?.style.display !== 'none') s._pickWeapon('rifle')
    s._toSpawn = 0
    s._breakTimer = 999
    const p = window.__game.buildMode.tryMode.pos
    let z = null
    for (let i = 0; i < 150 && !z?.skel; i++) {
      if (z) { s._removeZombie(z); s.zombies = s.zombies.filter((o) => o !== z) }
      z = s._makeZombie(500 + i, p.x, p.y, p.z - 6, 200, false, 'warrior')
      if (!z.skel) await new Promise((res) => setTimeout(res, 200))
    }
    const out = { skel: !!z.skel, rising: z.rise > 0, snap: s.zombieSnapshot()[`z${z.id}`] }
    for (let i = 0; i < 80; i++) s.update(1 / 30)
    out.risen = z.rise === 0
    out.anim = z.skel.playing
    s.damageZombie(z, 10)
    out.hitAnim = z.skel.playing
    s.damageZombie(z, 1000)
    out.alive = s.zombies.includes(z)
    out.corpses = s._boneCorpses?.length || 0
    // Bodies now stay up to a minute (2026-10-18).
    for (let i = 0; i < 1900; i++) s.update(1 / 30)
    out.corpsesAfter = s._boneCorpses?.length || 0
    return out
  })
  expect(r.skel).toBe(true)
  expect(r.rising).toBe(true)
  expect(r.snap).toMatchObject({ k: 'warrior' })
  expect(r.risen).toBe(true)
  expect(['walk', 'run', 'idle', 'attack']).toContain(r.anim)
  expect(r.hitAnim).toBe('hit')
  expect(r.alive).toBe(false)
  expect(r.corpses).toBe(1)
  expect(r.corpsesAfter).toBe(0)
})

test('new zombie kinds: sizes, the bloater bursts, spiders climb', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const B = bm._chunks.blockSize
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 30, 'zombiespawner')
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    const out = { heights: {} }
    // Height of a model in blocks (from its meshes' boxes).
    const heightOf = (group) => {
      group.updateMatrixWorld(true)
      let lo = Infinity
      let hi = -Infinity
      group.traverse((o) => {
        if (!o.isMesh) return
        o.geometry.computeBoundingBox()
        const bb = o.geometry.boundingBox
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          const v = o.localToWorld(bb.min.clone().set(x, y, z))
          lo = Math.min(lo, v.y)
          hi = Math.max(hi, v.y)
        }
      })
      return Math.round(((hi - lo) / B) * 100) / 100
    }
    for (const k of ['crawler', 'spider', 'brute', 'bloater', 'skinny']) {
      const z = s._makeZombie(900 + Object.keys(out.heights).length, 0.5, 1, 20.5, 100, false, k)
      z.monster.update(0, 0)
      out.heights[k] = heightOf(z.group)
      s._removeZombie(z)
    }
    // A bloater bursting right next to you hurts you and the zombie beside it.
    const p = bm.tryMode.pos
    s.health = 100
    const bl = s._makeZombie(990, p.x + 1, p.y, p.z, 10, false, 'bloater')
    const other = s._makeZombie(991, p.x + 1.5, p.y, p.z + 0.5, 1000, false, null)
    s.zombies.push(bl, other)
    const before = other.health
    s.damageZombie(bl, 50)
    out.burst = { hurtMe: s.health < 100, hurtOther: other.health < before, gone: !s.zombies.includes(bl) }
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    // A spider walks up a 4-high wall in its way.
    for (let y = 1; y < 5; y++) for (let x = -3; x <= 3; x++) bm.placeBlock(x, y, 10, 'stone')
    const sp = s._makeZombie(992, 0.5, 1, 14.5, 1000, false, 'spider')
    // Straight at you: no path round the wall (it's built a few ms at a
    // time, so how far it got depended on the machine) and no flanker brain.
    sp.role = 'rusher'
    const stepFlow = s._stepFlow
    s._stepFlow = () => {}
    s._flow = new Map()
    s._flowJob = null
    s.zombies.push(sp)
    s.health = 1e9
    let top = sp.y
    for (let i = 0; i < 200; i++) {
      bm.tryMode.update(0.05, new Set())
      s.update(0.05)
      top = Math.max(top, sp.y)
    }
    out.spiderTop = top
    s._stepFlow = stepFlow
    // ...but the camp's edge isn't a wall to climb (it used to carry a
    // spider up into the sky, 2026-10-26).
    s._removeZombie(sp)
    const realCamp = s.camp
    s.camp = { inside: (x, z, m = 0) => z < -20 + m, update() {}, checkQuests() {}, dispose() {}, quests: [], panelOpen: false }
    const sp2 = s._makeZombie(993, 0.5, 1, -17.5, 1000, false, 'spider')
    s.zombies = [sp2]
    bm.tryMode.pos.set(0.5, 1, -40.5)
    let top2 = sp2.y
    for (let i = 0; i < 200; i++) {
      s.update(0.05)
      top2 = Math.max(top2, sp2.y)
    }
    out.campTop = top2
    s.camp = realCamp
    s.stop()
    g._exitBuildMode()
    return out
  })
  // Standing ones are 2 blocks tall; the crawler and spider are low.
  for (const k of ['brute', 'bloater', 'skinny']) expect(Math.abs(r.heights[k] - 2), `${k} ${JSON.stringify(r.heights)}`).toBeLessThan(0.12)
  expect(r.heights.crawler).toBeLessThan(1)
  expect(r.heights.spider).toBeLessThan(1.2)
  expect(r.burst).toEqual({ hurtMe: true, hurtOther: true, gone: true })
  expect(r.spiderTop).toBeGreaterThan(4.5)
  expect(r.campTop).toBeLessThan(3)
})

// 2026-10-31: zombies with tricks (ZombieTricks.js) - a screamer calls
// the zombies round it, a lurker hides then pounces, a bloater's burst
// leaves a slime puddle that slows you.
test('zombie tricks: screamer calls, lurker hides and pounces, slime slows', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const B = bm._chunks.blockSize
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 30, 'zombiespawner')
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    const clear = () => {
      for (const z of [...s.zombies]) s._removeZombie(z)
      s.zombies = []
    }
    if (s._picking) s._pickWeapon('rifle')
    clear()
    s._toSpawn = 0
    s.health = 1e9
    const out = {}
    const p = bm.tryMode.pos
    // Both stand 2 blocks tall.
    for (const k of ['screamer', 'lurker']) {
      const z = s._makeZombie(950, 0.5, 1, 20.5, 100, false, k)
      z.monster.update(0, 0)
      z.group.updateMatrixWorld(true)
      let lo = Infinity
      let hi = -Infinity
      z.monster.root.traverse((o) => {
        if (!o.isMesh) return
        o.geometry.computeBoundingBox()
        const bb = o.geometry.boundingBox
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const zz of [bb.min.z, bb.max.z]) {
          const v = o.localToWorld(bb.min.clone().set(x, y, zz))
          lo = Math.min(lo, v.y)
          hi = Math.max(hi, v.y)
        }
      })
      out[`${k}Tall`] = Math.round(((hi - lo) / B) * 100) / 100
      clear()
    }
    // A screamer 10 blocks off spots you, stands still and screams: the
    // zombie 15 blocks past it is called, one 60 blocks away isn't.
    const sc = s._makeZombie(951, p.x, p.y, p.z + 10, 1000, false, 'screamer')
    const near = s._makeZombie(952, p.x + 3, p.y, p.z + 25, 1000, false, null)
    const far = s._makeZombie(953, p.x, p.y, p.z + 70, 1000, false, null)
    // (It waits a moment after appearing before its first scream.)
    for (let i = 0; i < 36; i++) s.update(0.05)
    out.scream = { yelling: sc.yell > 0, posed: sc.monster.screaming, near: near.called > 0, far: !(far.called > 0), snap: s.zombieSnapshot()[`z${sc.id}`].ys === 1 }
    clear()
    // A lurker 12 blocks off creeps hidden (faded, no name tag); close up
    // it leaps out.
    const lk = s._makeZombie(954, p.x, p.y, p.z + 12, 1000, false, 'lurker')
    for (let i = 0; i < 30; i++) s.update(0.05)
    s._sizeZombieTags()
    out.hidden = { hidden: lk.hidden, faded: lk.monster.materials[0].opacity < 0.5, tag: lk.tag.visible, snap: s.zombieSnapshot()[`z${lk.id}`].hd === 1 }
    lk.z = p.z + 2
    lk.x = p.x
    s.update(0.05)
    for (let i = 0; i < 20; i++) s.update(0.05)
    s._sizeZombieTags()
    out.pounced = { hidden: lk.hidden, seen: lk.monster.materials[0].opacity > 0.9 }
    clear()
    // A bloater bursting under you leaves slime: you're slowed, then it dries up.
    const bl = s._makeZombie(955, p.x + 0.5, p.y, p.z, 10, false, 'bloater')
    s.damageZombie(bl, 50)
    s.update(0.05)
    out.slime = { puddles: s.tricks._puddles.length, slow: s.tricks.slow }
    for (let i = 0; i < 100; i++) s.update(0.1)
    out.dried = { puddles: s.tricks._puddles.length, slow: s.tricks.slow }
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(Math.abs(r.screamerTall - 2), JSON.stringify(r)).toBeLessThan(0.12)
  expect(Math.abs(r.lurkerTall - 2), JSON.stringify(r)).toBeLessThan(0.12)
  expect(r.scream).toEqual({ yelling: true, posed: true, near: true, far: true, snap: true })
  expect(r.hidden).toEqual({ hidden: true, faded: true, tag: false, snap: true })
  expect(r.pounced).toEqual({ hidden: false, seen: true })
  expect(r.slime).toEqual({ puddles: 1, slow: 0.5 })
  expect(r.dried).toEqual({ puddles: 0, slow: 1 })
})

// 2026-10-31: traps - a shot Explosive Barrel blows up (and sets off the
// one next to it), and cleared waves hand out traps.
test('traps: explosive barrels chain, waves hand out traps', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 30, 'zombiespawner')
    bm.placeBlock(0, 1, 10, 'explosivebarrel')
    bm.placeBlock(2, 1, 10, 'explosivebarrel')
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s.health = 100
    const zb = s._makeZombie(960, 0.5, 1, 12.5, 500, false, null)
    const out = {}
    out.notBarrel = bm.specials.shootBlock(5, 1, 5)
    out.blew = bm.specials.shootBlock(0, 1, 10)
    out.zombieHurt = zb.health < 500
    out.bothGone = !bm.getBlockAt(0, 1, 10) && !bm.getBlockAt(2, 1, 10)
    out.meFine = s.health === 100
    const before = JSON.stringify(s.inv.hotbar) + JSON.stringify(s.inv.grid)
    out.msg = s._trapSupplies()
    out.gotTrap = JSON.stringify(s.inv.hotbar) + JSON.stringify(s.inv.grid) !== before
    s.stop()
    g._exitBuildMode()
    out.barrelBack = bm.getBlockAt(0, 1, 10) === 'explosivebarrel'
    return out
  })
  expect(r.notBarrel).toBe(false)
  expect(r.blew).toBe(true)
  expect(r.zombieHurt).toBe(true)
  expect(r.bothGone).toBe(true)
  expect(r.meFine).toBe(true)
  expect(r.gotTrap).toBe(true)
  expect(r.msg).toMatch(/Trap supplies: \d+ × /)
})

// 2026-10-31: world events - a supply drop's crate pays out, a horde walks
// past (until shot), a meteor makes mutants.
test('world events: supply crate, passing horde, mutant meteor', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 60, 'zombiespawner')
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    const clear = () => {
      for (const z of [...s.zombies]) s._removeZombie(z)
      s.zombies = []
    }
    clear()
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    s.wave = 3
    const out = {}
    const ev = s.events
    // Supply: the plane flies over, the crate lands, walking up opens it.
    out.supply = ev.start('supply')
    for (let i = 0; i < 300 && !ev._crate?.landed; i++) s.update(0.05)
    out.landed = !!ev._crate?.landed
    const coins = s.coins
    const ammo = s.reserve
    if (ev._crate) bm.tryMode.pos.set(ev._crate.x, ev._crate.y, ev._crate.z)
    s.update(0.05)
    out.opened = !ev._crate && s.coins > coins && s.reserve > ammo
    bm.tryMode.pos.set(0.5, 1, 0.5)
    for (let i = 0; i < 300 && ev._run; i++) s.update(0.05)
    // Horde: extra zombies that walk past and don't count toward the wave.
    out.horde = ev.start('horde')
    const horde = s.zombies.filter((z) => z.migrate)
    out.hordeSize = horde.length
    out.extra = horde.every((z) => z.extra)
    const z0 = horde[0]
    const d0 = Math.hypot(z0.x - 0.5, z0.z - 0.5)
    for (let i = 0; i < 20; i++) s.update(0.05)
    out.stillMigrating = !!z0.migrate
    s.damageZombie(z0, 1)
    s.update(0.05)
    out.shotOneChases = !z0.migrate && d0 > 0
    clear()
    ev._endRun()
    // Meteor: zombies near the impact turn mutant (bigger, tougher).
    out.meteor = ev.start('meteor')
    for (let i = 0; i < 100 && ev._run; i++) s.update(0.05)
    out.mutants = s.zombies.filter((z) => z.mutant).length
    const m = s.zombies.find((z) => z.mutant)
    out.mutantBig = !!m && m.group.scale.x > 1.2 && m.health > 100
    out.snap = !!m && s.zombieSnapshot()[`z${m.id}`].mu === 1
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r.supply).toBe(true)
  expect(r.landed).toBe(true)
  expect(r.opened).toBe(true)
  expect(r.horde).toBe(true)
  expect(r.hordeSize).toBeGreaterThanOrEqual(6)
  expect(r.extra).toBe(true)
  expect(r.stillMigrating).toBe(true)
  expect(r.shotOneChases).toBe(true)
  expect(r.meteor).toBe(true)
  expect(r.mutants).toBeGreaterThanOrEqual(3)
  expect(r.mutantBig).toBe(true)
  expect(r.snap).toBe(true)
})

// 2026-10-31: survivors - one appears on the highest spot near you,
// reaching them rescues them: the first follows you and shoots, the next
// gives a kill quest.
test('survivors: rooftop rescue, a helper who shoots, a kill quest', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 60, 'zombiespawner')
    for (let x = -35; x <= 35; x++) for (let z = -35; z <= 35; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    // A "building": a 5-high stone tower 20 blocks off.
    for (let y = 1; y <= 5; y++) for (let x = 19; x <= 21; x++) for (let z = -1; z <= 1; z++) bm.placeBlock(x, y, z, 'stone', true)
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    s.wave = 2
    const out = {}
    const sv = s.survivors
    // Keep trying until one lands on the tower (the spot is random).
    for (let i = 0; i < 30; i++) {
      sv.clear()
      s.events._endRun()
      s.events.start('survivor')
      if (sv.waiting && sv.waiting.y >= 6) break
    }
    out.onRoof = !!sv.waiting && sv.waiting.y >= 6
    const w = sv.waiting
    bm.tryMode.pos.set(w.x, w.y, w.z)
    s.update(0.05)
    out.joined = sv.helpers.length === 1 && !sv.waiting
    // The helper shoots a zombie near them.
    bm.tryMode.pos.set(0.5, 1, 0.5)
    for (let i = 0; i < 20; i++) s.update(0.05)
    const h = sv.helpers[0]
    const zb = s._makeZombie(980, h.x + 4, h.y, h.z, 1000, false, null)
    zb.speedMult = 0
    for (let i = 0; i < 30; i++) s.update(0.05)
    out.helperShot = zb.health < 1000
    // The next one gives a quest; kills count toward it.
    sv.spawn(bm.tryMode.pos)
    const w2 = sv.waiting
    bm.tryMode.pos.set(w2.x, w2.y, w2.z)
    s.update(0.05)
    out.quest = !!sv.quest && sv.helpers.length === 1
    const coins = s.coins
    const need = sv.quest?.need || 0
    for (let i = 0; i < need; i++) s._countKill(false)
    out.questDone = !sv.quest && s.coins > coins
    s.stop()
    out.cleared = sv.helpers.length === 0 && !sv.waiting
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({ onRoof: true, joined: true, helperShot: true, quest: true, questDone: true, cleared: true })
})

// 2026-10-26: 50 more animals, every animal with a rarity (6 tiers) and
// its name over it, rarer ones turning up less.
test('50 new animals, rarities and name tags', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    bm.placeBlock(0, 1, 0, 'playerstart', false, { facing: 0 })
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    const A = s.animals
    const P = A.constructor
    const K = P.KINDS
    const NEW_KINDS = P.NEW_KINDS
    const rarityOf = (id) => P.rarityOf(id)
    const STRINGS = P.STRINGS
    const animalNameKey = (id) => `animal${id[0].toUpperCase()}${id.slice(1)}`
    out.newCount = Object.keys(NEW_KINDS).length
    out.allIn = Object.keys(NEW_KINDS).every((id) => K[id])
    // Every new animal and rarity has its name in all four languages.
    out.unnamed = []
    for (const lang of ['en', 'zh', 'hi', 'es']) {
      for (const id of Object.keys(NEW_KINDS)) if (!STRINGS[lang][animalNameKey(id)]) out.unnamed.push(`${lang}:${id}`)
      for (const tier of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic']) if (!STRINGS[lang][`rarity${tier}`]) out.unnamed.push(`${lang}:${tier}`)
    }
    out.tiers = [...new Set(Object.keys(K).map((id) => rarityOf(id)))].sort()
    // Rarer animals turn up less: a legendary Black Panther far less often
    // than an epic Gorilla in the jungle.
    const jungle = A.constructor.BIOME_ANIMALS.jungle
    out.pantherVsGorilla = jungle.blackPanther / jungle.gorilla
    // Name tags: one over each animal, its name shown, readable far away.
    A.clearAll()
    const me = s.bodyPos()
    const a = A.spawn('okapi', me.x + 3, me.y, me.z)
    A.update(1 / 30, { wild: false })
    out.hasTag = !!a.tag && a.tag.visible && a.tag.parent === a.group
    const near = a.tag.scale.x
    a.x = me.x + 60
    A.update(1 / 30, { wild: false })
    out.farBigger = a.tag.scale.x > near * 2
    return out
  })
  expect(r.newCount).toBe(50)
  expect(r.allIn).toBe(true)
  expect(r.unnamed).toEqual([])
  expect(r.tiers).toEqual(['common', 'epic', 'legendary', 'mythic', 'rare', 'uncommon'])
  expect(r.pantherVsGorilla).toBeLessThan(0.5)
  expect(r.hasTag).toBe(true)
  expect(r.farBigger).toBe(true)
})

test('thin coral, sharp map tiles, free mouse on any panel, zombie names and 170 more animals', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    // Coral plants: swum through, count as water, drawn as crossed pictures.
    bm.placeBlock(3, 1, 3, 'tubecoral', false)
    out.coralSolid = bm._cellSolidTop(3, 1, 3)
    out.coralWet = bm._cellIsLiquid(3, 1, 3)
    out.coralPlant = !!bm._chunks.info.get('tubecoral')?.plant
    bm.placeBlock(0, 1, 0, 'playerstart', false, { facing: 0 })
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    // Every zombie gets a name and a rarity; rarer ones are tougher and
    // the server snapshot carries both.
    const z = s._makeZombie(77, 5, 1, 5, 100, false, null, { tier: 'legendary', name: 3 })
    out.zTag = !!z.tag && z.tier === 'legendary' && z.nameIdx === 3
    out.zFaster = z.speedMult > 1 && z.damageMult > 1
    const snap = s.zombieSnapshot().z77
    out.snap = [snap.rt, snap.nm]
    const before = s.coins
    s._countKill(false, null, 'legendary')
    out.legendaryCoins = s.coins - before
    // 170 more animals, all named in every language; wolves bite now.
    const P = s.animals.constructor
    out.wild = Object.keys(P.WILD_KINDS).length
    out.wildIn = Object.keys(P.WILD_KINDS).every((id) => P.KINDS[id])
    out.unnamed = []
    for (const lang of ['en', 'zh', 'hi', 'es']) for (const id of Object.keys(P.WILD_KINDS)) if (!P.STRINGS[lang][`animal${id[0].toUpperCase()}${id.slice(1)}`]) out.unnamed.push(`${lang}:${id}`)
    out.wolfHunts = !!P.KINDS.wolf.hunts
    // Any panel (Settings here) needs the mouse.
    out.noPanel = bm._anyClickScreenShown()
    g._toggleSettings(true)
    out.settingsNeedsMouse = bm.mouseScreenOpen()
    g._toggleSettings(false)
    s.stop()
    return out
  })
  expect(r.coralSolid).toBe(0)
  expect(r.coralWet).toBe(true)
  expect(r.coralPlant).toBe(true)
  expect(r.zTag).toBe(true)
  expect(r.zFaster).toBe(true)
  expect(r.snap).toEqual(['legendary', 3])
  expect(r.legendaryCoins).toBeGreaterThan(10)
  expect(r.wild).toBeGreaterThanOrEqual(100)
  expect(r.wildIn).toBe(true)
  expect(r.unnamed).toEqual([])
  expect(r.wolfHunts).toBe(true)
  expect(r.noPanel).toBe(false)
  expect(r.settingsNeedsMouse).toBe(true)
})

// 2026-10-30: zombies burn in clear sunshine (not in rain or at night),
// cave zombies are tougher and rarer, every animal drops its own meat,
// 30 more creatures, bigger meat-eating dinosaurs and scary attackers.
test('sun-burning zombies, cave zombies, own meat drops, new creatures, scary hunters', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    const sky = bm.sky
    const me = s.bodyPos()
    // Open sky over a zombie standing on a platform high up.
    const top = Math.floor(me.y) + 60
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) bm._placeBlockInner(Math.floor(me.x) + x, top - 1, Math.floor(me.z) + z, 'stone')
    const zb = s._makeZombie(9001, Math.floor(me.x) + 0.5, top, Math.floor(me.z) + 0.5, 100, false)
    const still = { x: zb.x, y: zb.y, z: zb.z, idle: true }
    const run = (weather, night) => {
      sky._now = weather
      sky.nightAmount = () => night
      zb.health = 100
      zb._sunIn = 0
      for (let i = 0; i < 20; i++) s._updateZombie(zb, 0.1, still, 0)
      return zb.health
    }
    out.sunny = run('clear', 0) < 95
    out.rain = run('lightRain', 0) === 100
    out.snow = run('mediumSnow', 0) === 100
    out.night = run('clear', 1) === 100
    // A roof over it: shade saves it.
    bm._placeBlockInner(Math.floor(zb.x), top + 4, Math.floor(zb.z), 'stone')
    out.shade = run('clear', 0) === 100
    s._removeZombie(zb)
    s.zombies = []
    // Cave zombies: below the ground, tougher and bite harder.
    const under = bm.world.under
    const cx = Math.floor(me.x) + 300
    const cz = Math.floor(me.z)
    const deep = under.bottomAt(cx, cz) - 20
    out.inCave = s._inCave(cx + 0.5, deep, cz + 0.5) && !s._inCave(cx + 0.5, top, cz + 0.5)
    let cave = null
    for (let i = 0; i < 60 && !cave; i++) if (s._spawnZombie([[cx, deep, cz]])) cave = s.zombies[s.zombies.length - 1]
    let open = null
    for (let i = 0; i < 60 && !open; i++) if (s._spawnZombie([[cx, top, cz]])) open = s.zombies[s.zombies.length - 1]
    out.caveTougher = cave?.cave === true && !!open && !open.cave
    let skipped = 0
    for (let i = 0; i < 200; i++) if (!s._spawnZombie([[cx, deep, cz]])) skipped++
    out.caveRarer = skipped > 60 && skipped < 160
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    // Every animal drops its own body part, named for it.
    const label = (kind) => s.inv._label({ kind: 'item', id: `meat_${kind}` })
    out.meats = ['cow', 'pig', 'elephant', 'chicken', 'deer', 'lion', 'shark', 'turtle', 'dragon'].map(label)
    const A = s.animals
    const K = A.constructor.KINDS
    out.allMeat = Object.keys(K).every((kind) => !label(kind).includes('{'))
    // 30 more creatures, all named in every language.
    const added = ['ox', 'rooster', 'mammoth', 'sabertooth', 'mantisShrimp', 'seaCucumber', 'frigatebird', 'blobfish', 'stonefish', 'leech', 'cockroach', 'termite', 'sponge', 'conch', 'queenAnt', 'soldierAnt', 'darkLadybug', 'dragon', 'unicorn', 'pegasus', 'griffin', 'phoenix', 'kraken', 'yeti', 'sasquatch', 'jackalope', 'cerberus', 'hydra', 'lakeMonster', 'manticore']
    out.creatures = added.filter((id) => K[id]).length
    out.yetiTall = Math.round((K.yeti.headAt[0] + K.yeti.head[1] / 2) * 10) / 10
    // Built, and an attacker has glowing red eyes and fangs.
    const dragon = A.spawn('dragon', me.x + 30, me.y, me.z)
    out.dragonEyes = dragon.head.children.filter((m) => m.material?.type === 'MeshBasicMaterial').length
    out.scary = K.wolf.scary === true && K.tRex.scary === true && !K.cow.scary && !K.unicorn.scary
    out.bigRex = K.tRex.body[0] > 4 && K.tRex.health >= 1600
    A.clearAll()
    return out
  })
  expect(r).toEqual({
    sunny: true, rain: true, snow: true, night: true, shade: true,
    inCave: true, caveTougher: true, caveRarer: true,
    meats: ['Cow Hoof', 'Pig Snout', 'Elephant Tusk', 'Chicken Wing', 'Deer Antler', 'Lion Mane', 'Shark Fin', 'Turtle Shell', 'Dragon Scale'],
    allMeat: true, creatures: 30, yetiTall: 2, dragonEyes: 2, scary: true, bigRex: true,
  })
})

// Gaymi's quick wins (2026-10-31): a Blood Moon doubles zombies and coins
// and turns the sky red; zombies wear the players' hats and capes; dying
// alone plays a slow-motion replay first (skippable), then the You Died
// card; Photo Mode's filters show live and go into the saved picture.
test('Blood Moon, zombie cosmetics, death replay and photo filters', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game._enterBuildMode({ play: true }))
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    for (let i = 0; i < 40 && !s.active; i++) await new Promise((res) => setTimeout(res, 250))
    s._pickWeapon('rifle')
    const out = {}
    s._startWave(3)
    const normal = s._toSpawn
    let c = s.coins
    s._earn(10)
    out.normalCoins = s.coins - c
    out.started = s.bloodMoon.start()
    out.doubled = s._toSpawn === normal * 2
    c = s.coins
    s._earn(10)
    out.bloodCoins = s.coins - c
    out.skyState = bm.sky.skyState().b
    for (let i = 0; i < 60; i++) bm.update(0.05)
    out.redEdge = document.body.classList.contains('play-blood-moon')
    // Dying alone: the replay first, then the card once it's skipped.
    for (let i = 0; i < 70; i++) s.update(0.05)
    s.health = 0
    s._die()
    out.replay = s.replay.active
    out.cardDuring = s._overEl.style.display
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    out.cardAfter = s._overEl.style.display
    out.replayAfter = s.replay.active
    // Photo filters.
    document.getElementById('build-play-again-btn').click()
    s._pickWeapon('rifle')
    bm.spectate.enter({ photo: true })
    bm.spectate.setFilter('bw')
    out.liveFilter = bm.renderer.domElement.style.filter
    bm.spectate.exit?.()
    return out
  })
  expect(r).toEqual({
    normalCoins: 10, started: true, doubled: true, bloodCoins: 20, skyState: 1, redEdge: true,
    replay: true, cardDuring: 'none', cardAfter: 'flex', replayAfter: false,
    liveFilter: 'url("#gz-photo-bw")',
  })
  // The players' own hats and capes turn up on zombies too.
  const ids = Array.from({ length: 400 }, (_, i) => i)
  expect(ids.some((i) => zombieHat(i) === 'propeller') && ids.some((i) => zombieHat(i) === 'chicken')).toBe(true)
  expect(ids.filter((i) => zombieCape(i)).length).toBeGreaterThan(0)
})

// Kill effects (KillEffects.js, 2026-11-25): my hit tags the zombie with my
// effect, it bursts when it dies, and the host's snapshot carries it so
// other screens burst it too.
test('Kill effects: a zombie I take down bursts, and the snapshot carries it', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    g.shopCosmetics = { pixelKill: 1 }
    g.settings.killEffect = 'pixelKill'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const p = s.bodyPos()
    const z = s._makeZombie(9101, p.x + 4, p.y, p.z, 100, false)
    s.damageZombie(z, 10)
    const tagged = z.kfx
    const snap = s.zombieSnapshot()[`z${z.id}`]?.fx
    const green = () => s._fx._sprites.filter((sp) => sp.material.color.getHex() === 0x39ff88 && sp.userData.life > 0 && sp.userData.t < sp.userData.life).length
    const before = green()
    s.damageZombie(z, 1000)
    const burst = green() - before
    // Not owned: no effect, even if picked.
    g.shopCosmetics = {}
    const z2 = s._makeZombie(9102, p.x + 4, p.y, p.z + 2, 100, false)
    s.damageZombie(z2, 10)
    const unowned = z2.kfx
    g._exitBuildMode()
    return { tagged, snap, burst, unowned }
  })
  expect(r.tagged).toBe('pixelKill')
  expect(r.snap).toBe('pixelKill')
  expect(r.burst).toBeGreaterThan(5)
  expect(r.unowned).toBe('')
})

// The Zombie Book (ZombieBook.js): a new kind pays coins once and shows up.
test('Zombie Book: meeting a new kind of zombie pays once and fills its page', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    localStorage.removeItem('gayz-zombie-book')
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const coins = g.coins
    const p = s.bodyPos()
    s._makeZombie(9001, p.x + 5, p.y, p.z, 50, false, 'brute')
    const out = { paid: g.coins - coins, msg: document.getElementById('build-play-msg')?.textContent || '' }
    const again = g.coins
    s._makeZombie(9002, p.x + 6, p.y, p.z, 50, false, 'brute')
    out.paidAgain = g.coins - again
    const book = JSON.parse(localStorage.getItem('gayz-zombie-book') || '{}')
    out.brute = !!book.brute
    out.met = Object.keys(book).length
    g._exitBuildMode()
    g._openMenuInventoryPanel()
    document.getElementById('inventory-tab-zombiebook').click()
    // Its 27 pictures are drawn on this device (ZombieBook.drawPictures) -
    // a test machine without a graphics card takes many seconds - and the
    // page fills them in when they're all done.
    for (let i = 0; i < 900 && document.querySelectorAll('#zombie-book-grid img').length < 27; i++) await new Promise((res) => setTimeout(res, 100))
    const card = document.querySelector('[data-book="brute"]')
    out.count = document.getElementById('zombie-book-count').textContent
    out.cards = document.querySelectorAll('#zombie-book-grid .zombie-book-card').length
    out.unmet = document.querySelectorAll('#zombie-book-grid .unmet').length
    out.bruteName = card?.querySelector('.team-card-name')?.textContent
    out.pics = document.querySelectorAll('#zombie-book-grid img').length
    return out
  })
  expect(r.paid).toBe(10)
  expect(r.paidAgain).toBe(0)
  expect(r.brute).toBe(true)
  expect(r.msg).toContain('Brute')
  expect(r.count).toBe(`Met ${r.met} of 27`)
  expect(r.cards).toBe(27)
  expect(r.unmet).toBe(27 - r.met)
  expect(r.bruteName).toBe('Brute')
  expect(r.pics).toBe(27)
})

// Nemesis Zombie (NemesisZombie.js): the zombie that kills you comes back
// next run with a red tag, levels up when it gets you again, and pays out
// (then is gone) when you beat it.
test('Nemesis: the zombie that kills you comes back stronger, beat it for coins', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game._enterBuildMode({ play: true }))
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const s = bm.survival
    for (let i = 0; i < 40 && !s.active; i++) await new Promise((res) => setTimeout(res, 250))
    s._pickWeapon('rifle')
    localStorage.removeItem('gayz-nemesis')
    localStorage.removeItem('gayz-nemesis-log')
    const out = {}
    const p = bm.tryMode.pos
    // Bitten by a named zombie, then dying: it becomes my Nemesis.
    const z = s._makeZombie(9001, p.x, p.y, p.z - 3, 50, false, null, { tier: 'rare', name: 42 })
    s._lastBiter = { nameIdx: z.nameIdx, tier: z.tier, nemesis: 0, at: performance.now() }
    s.health = 0
    s._die()
    s.replay.stop()
    out.saved = JSON.parse(localStorage.getItem('gayz-nemesis'))
    out.joke = document.getElementById('build-play-over-joke').textContent.includes('Nemesis')
    // Next run: from wave 2 it comes back, once.
    document.getElementById('build-play-again-btn').click()
    s._pickWeapon('rifle')
    s.nemesis.clear()
    s.wave = 1
    s.nemesis.update()
    out.earlyCame = s.nemesis.came
    s.wave = 2
    let nz = null
    for (let i = 0; i < 20 && !nz; i++) { s.nemesis.update(); nz = s.nemesis.zombie; if (!nz) s.nemesis.came = false }
    nz = nz || s.nemesis.spawnAt({ ...JSON.parse(localStorage.getItem('gayz-nemesis')), level: 1 }, p.x, p.y, p.z - 4)
    out.came = !!nz && s.zombies.includes(nz)
    out.sameName = nz.nameIdx === 42 && nz.tier === 'rare'
    out.tougher = nz.maxHealth > s._nemesisBaseHealth() * 2
    out.tagSwapped = nz.tag.material === s.nemesis._tagMat
    // Batch 2: wider (not taller), one scar per level, a taunt bubble.
    out.scars = nz.body?.getObjectByName('nemesisScars')?.children.length ?? -1
    out.wider = nz.body ? nz.body.scale.x > nz.body.scale.y * 1.05 : true
    out.taunt = !!s.nemesis.bubble && s.nemesis.bubble.parent === nz.group
    // Off-screen (behind me): the red edge arrow shows.
    s._ensureHud()
    const cam = bm.camera
    const fwd = new cam.position.constructor()
    cam.getWorldDirection(fwd)
    nz.x = cam.position.x / s.B - fwd.x * 6
    nz.z = cam.position.z / s.B - fwd.z * 6
    s.nemesis.update(0.016)
    out.arrow = document.getElementById('nemesis-arrow')?.style.display === ''
    // It gets me again: level 2.
    s._lastBiter = { nameIdx: nz.nameIdx, tier: nz.tier, nemesis: nz.nemesis, at: performance.now() }
    out.levelLine = s.nemesis.onDeath(s._lastBiter).includes('2')
    out.level = JSON.parse(localStorage.getItem('gayz-nemesis')).level
    // Beating it: coins, and it's gone for good.
    const c = s.coins
    s.damageZombie(nz, 1e9)
    out.paid = s.coins - c >= 100
    out.cleared = localStorage.getItem('gayz-nemesis')
    out.bubbleGone = !s.nemesis.bubble
    out.log = JSON.parse(localStorage.getItem('gayz-nemesis-log'))
    // The Zombie Book card: none now, with the beaten count.
    const tab = document.getElementById('inventory-tab-zombiebook')
    tab.click()
    const card = document.getElementById('zombie-book-nemesis')
    out.cardNone = card.classList.contains('none') && card.textContent.includes('1')
    localStorage.setItem('gayz-nemesis', JSON.stringify({ name: 42, tier: 'rare', level: 3, kills: 7 }))
    tab.click()
    out.cardShows = !card.classList.contains('none') && card.textContent.includes('7') && card.textContent.includes('300')
    localStorage.removeItem('gayz-nemesis')
    return out
  })
  expect(r).toEqual({
    saved: { name: 42, tier: 'rare', level: 1, kills: 1 }, joke: true, earlyCame: false,
    came: true, sameName: true, tougher: true, tagSwapped: true,
    scars: 1, wider: true, taunt: true, arrow: true,
    levelLine: true, level: 2, paid: true, cleared: null, bubbleGone: true,
    log: { beaten: 1, best: 1 }, cardNone: true, cardShows: true,
  })
  // Cloud Save carries both keys; two devices' beaten counts add up.
  const cm = await import('../src/game/CloudMerge.js')
  expect(cm.isSyncedKey('gayz-nemesis') && cm.isSyncedKey('gayz-nemesis-log')).toBe(true)
  const m = cm.mergeSaves({ 'gayz-nemesis-log': '{"beaten":1,"best":2}' }, { 'gayz-nemesis-log': '{"beaten":2,"best":2}' }, { 'gayz-nemesis-log': '{"beaten":3,"best":4}' }, true)
  expect(JSON.parse(m['gayz-nemesis-log'])).toEqual({ beaten: 4, best: 4 })
})

// Shrink Ray (ShrinkRay.js, 2026-11-27): a rare chest / crate find that
// zaps a zombie tiny and squeaky for a few seconds - it bites softer,
// takes double damage, walls stop the beam, bosses shrink less and for
// less time, and on a server the host's snapshot carries it (`sk`).
test('Shrink Ray: zaps zombies tiny, walls block it, bosses shrink less, synced', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 60, 'zombiespawner')
    for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    const clear = () => {
      for (const z of [...s.zombies]) s._removeZombie(z)
      s.zombies = []
    }
    clear()
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    const ray = s.shrinkRay
    const L = ray.lib
    const B = s.B
    const out = {}
    // Found in chests / crates only when you don't have one yet.
    out.rollsWhenMissing = ray.roll(s.inv, 1)
    s.inv.add({ kind: 'item', id: 'shrinkRay', n: 1 })
    out.notTwice = !ray.roll(s.inv, 1)
    // Aim straight at a zombie 8 blocks ahead and zap.
    const aim = (x, z) => {
      bm.camera.position.set(0.5 * B, 2.6 * B, 0.5 * B)
      bm.camera.lookAt(x * B, 1.9 * B, z * B)
      bm.camera.updateMatrixWorld()
      ray._nextAt = 0
    }
    const z1 = s._extraZombie(0.5, 1, 8.5, null)
    z1.x = 0.5
    z1.z = 8.5
    aim(0.5, 8.5)
    out.zapped = ray.zap()
    out.shrunkTime = z1.shrunk
    out.size = z1.size
    out.battery = ray.battery
    out.snap = s.zombieSnapshot()[`z${z1.id}`].sk === 1
    for (let i = 0; i < 10; i++) ray.update(0.05)
    out.lookTiny = z1.group.scale.x < 0.5
    // Takes double damage while tiny.
    const hp = z1.health
    s.damageZombie(z1, 10)
    out.hurt = Math.round(hp - z1.health)
    // Wears off, back to full size.
    for (let i = 0; i < 160; i++) ray.update(0.05)
    out.grewBack = !(z1.shrunk > 0) && z1.size === 1 && Math.abs(z1.group.scale.x - 1) < 0.01 && z1.shrinkBase === undefined
    // A wall in the way stops the beam.
    for (let y = 1; y <= 4; y++) for (let x = -2; x <= 2; x++) bm.placeBlock(x, y, 4, 'cobblestone')
    z1.x = 0.5
    z1.z = 8.5
    aim(0.5, 8.5)
    ray.zap()
    out.wallBlocks = !(z1.shrunk > 0)
    // A boss: only BOSS_SIZE, for BOSS_S.
    clear()
    const z2 = s._extraZombie(5.5, 1, -6.5, null)
    z2.boss = true
    ray.shrink(z2)
    out.boss = z2.shrunk === L.BOSS_S && z2.shrinkK === L.BOSS_SIZE
    // A guest's zap reaches the host as a hit.
    const z3 = s._extraZombie(-5.5, 1, -6.5, null)
    s._applyRemoteHits([{ id: `z${z3.id}`, dmg: 0, shrink: true }])
    out.remote = z3.shrunk === L.SHRINK_S
    // Another player's copy follows the host's snapshot.
    const z4 = s._extraZombie(-8.5, 1, -8.5, null)
    ray.fromSnapshot(z4, true)
    const lookOn = z4.shrunk > 0 && z4.shrinkLook
    for (let i = 0; i < 200; i++) ray.update(0.05)
    const stays = z4.shrunk > 0
    ray.fromSnapshot(z4, false)
    out.look = lookOn && stays && !(z4.shrunk > 0)
    // An empty battery: no zap until it recharges.
    ray.battery = 0.5
    ray._nextAt = 0
    out.empty = !ray.zap()
    ray.update(L.RECHARGE_S)
    out.recharged = ray.battery >= 1
    s.stop()
    g._exitBuildMode()
    return { out, L }
  })
  const { out, L } = r
  expect(out.rollsWhenMissing).toBe(true)
  expect(out.notTwice).toBe(true)
  expect(out.zapped).toBe(true)
  expect(out.shrunkTime).toBe(L.SHRINK_S)
  expect(out.size).toBeCloseTo(L.SHRINK_SIZE, 3)
  expect(out.battery).toBeCloseTo(L.BATTERY - 1, 3)
  expect(out.snap).toBe(true)
  expect(out.lookTiny).toBe(true)
  expect(out.hurt).toBe(10 * L.SHRUNK_HURT)
  expect(out.grewBack).toBe(true)
  expect(out.wallBlocks).toBe(true)
  expect(out.boss).toBe(true)
  expect(out.remote).toBe(true)
  expect(out.look).toBe(true)
  expect(out.empty).toBe(true)
  expect(out.recharged).toBe(true)
})
