import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

test('entering Build Mode shows a scene with a ground plane, exiting returns to the homepage', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const enteredActive = g.buildMode.active
    // The ground is now a real, breakable block layer (see
    // _ensureGroundLayer), not a standalone mesh - check for an actual
    // ground block instead of the removed `ground` property.
    const hasGround = g.buildMode.getBlockAt(0, -1, 0) !== null
    const menuHiddenWhileActive = getComputedStyle(g.menu).display === 'none'
    g._exitBuildMode()
    const exitedActive = g.buildMode.active
    const menuVisibleAfterExit = getComputedStyle(g.menu).display !== 'none'
    return { enteredActive, hasGround, menuHiddenWhileActive, exitedActive, menuVisibleAfterExit }
  })

  expect(result.enteredActive).toBe(true)
  expect(result.hasGround).toBe(true)
  expect(result.menuHiddenWhileActive).toBe(true)
  expect(result.exitedActive).toBe(false)
  expect(result.menuVisibleAfterExit).toBe(true)
})

test('free-fly movement moves the camera in Build Mode', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const before = g.buildMode.camera.position.clone()
    g.buildMode._keys.add('KeyW')
    g.buildMode.update(0.5)
    g.buildMode._keys.delete('KeyW')
    const after = g.buildMode.camera.position.clone()
    g._exitBuildMode()
    return { moved: before.distanceTo(after) > 0.1 }
  })

  expect(result.moved).toBe(true)
})

// Plain cubes are drawn by chunk meshes (BlockChunks.js) - one mesh per
// 16x16x16 chunk holding only visible faces. faceCount sums the quads in
// the chunk that holds cell (0..15, 0..15, 0..15).
test('placing and removing a block updates both the chunk mesh and the internal map', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const faceCount = () => {
      bm.render()
      const chunk = bm._chunks.chunks.get('0,0,0')
      return chunk ? chunk.meshes.reduce((n, m) => n + m.geometry.index.count / 6, 0) : 0
    }
    const before = faceCount()
    bm.placeBlock(2, 0, 3, 'brick')
    const afterPlace = { atBlock: bm.getBlockAt(2, 0, 3), faces: faceCount() }
    bm.removeBlock(2, 0, 3)
    const afterRemove = { atBlock: bm.getBlockAt(2, 0, 3), faces: faceCount() }
    g._exitBuildMode()
    return { before, afterPlace, afterRemove }
  })

  expect(result.afterPlace.atBlock).toBe('brick')
  // A lone block on the ground shows 5 faces (its bottom touches grass).
  expect(result.afterPlace.faces).toBe(result.before + 5)
  expect(result.afterRemove.atBlock).toBe(null)
  expect(result.afterRemove.faces).toBe(result.before)
})

test('removing one block does not remove a different still-placed block of the same type', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const faceCount = () => {
      bm.render()
      const chunk = bm._chunks.chunks.get('0,0,0')
      return chunk ? chunk.meshes.reduce((n, m) => n + m.geometry.index.count / 6, 0) : 0
    }
    const before = faceCount()
    bm.placeBlock(0, 0, 0, 'stone')
    bm.placeBlock(1, 0, 0, 'stone')
    bm.placeBlock(2, 0, 0, 'stone')
    bm.removeBlock(1, 0, 0) // remove the middle one
    const remaining = {
      first: bm.getBlockAt(0, 0, 0),
      removed: bm.getBlockAt(1, 0, 0),
      third: bm.getBlockAt(2, 0, 0),
      addedFaces: faceCount() - before,
    }
    g._exitBuildMode()
    return remaining
  })

  expect(result.first).toBe('stone')
  expect(result.removed).toBe(null)
  expect(result.third).toBe('stone')
  // Two separate lone blocks: 5 visible faces each.
  expect(result.addedFaces).toBe(10)
})

test('Tab opens the picker, clicking a swatch changes the selected block type', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const beforeType = g.buildMode.selectedType
    g.buildMode.togglePicker()
    const openAfterToggle = g.buildMode.pickerOpen
    const swatches = document.querySelectorAll('.build-picker-swatch')
    swatches[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const afterClickType = g.buildMode.selectedType
    const closedAfterClick = g.buildMode.pickerOpen
    g._exitBuildMode()
    return { beforeType, openAfterToggle, afterClickType, closedAfterClick, swatchCount: swatches.length }
  })

  expect(result.openAfterToggle).toBe(true)
  expect(result.swatchCount).toBe(814)
  expect(result.afterClickType).not.toBe(result.beforeType)
  expect(result.closedAfterClick).toBe(false)
})

// Doors are two blocks tall, open/close on right-click (toggleDoor), let
// you through only while open, and keep their facing/open state in saves.
test('doors place both halves, open and close, and save their state', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    bm.placeBlock(5, 3, 5, 'oakdoor', false, { facing: 1, open: false })
    const halves = [bm.getBlockAt(5, 3, 5), bm.getBlockAt(5, 4, 5)]
    const blockedClosed = bm._blockedAt(2.275, 1.575, 2.275)
    bm.toggleDoor(5, 4, 5)
    const openedFromTop = bm.isDoorOpenAt(5, 3, 5)
    const blockedOpen = bm._blockedAt(2.275, 1.575, 2.275)
    const saved = bm._snapshot().blocks.filter((b) => b.x === 5 && b.y >= 0 && b.z === 5)
    bm.removeBlock(5, 4, 5)
    const afterBreak = [bm.getBlockAt(5, 3, 5), bm.getBlockAt(5, 4, 5)]
    bm.undo()
    const afterUndo = [bm.getBlockAt(5, 4, 5), bm.isDoorOpenAt(5, 4, 5)]
    g._exitBuildMode()
    return { halves, blockedClosed, openedFromTop, blockedOpen, saved, afterBreak, afterUndo }
  })

  expect(result.halves).toEqual(['oakdoor', 'oakdoortop'])
  expect(result.blockedClosed).toBe(true)
  expect(result.openedFromTop).toBe(true)
  expect(result.blockedOpen).toBe(false)
  expect(result.saved).toEqual([{ x: 5, y: 3, z: 5, type: 'oakdoor', facing: 1, open: true }])
  expect(result.afterBreak).toEqual([null, null])
  expect(result.afterUndo).toEqual(['oakdoortop', true])
})

test('old saves load TNT as C4', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    bm._applyParsedData({ blocks: [{ x: 7, y: 0, z: 7, type: 'tnt' }, { x: 8, y: 0, z: 7, type: 'tntslab' }], hotbar: ['tnt', null, null, null, null, null, null, null, null, null] })
    const out = { block: bm.getBlockAt(7, 0, 7), slab: bm.getBlockAt(8, 0, 7), hotbar0: bm.hotbar[0] }
    g._exitBuildMode()
    return out
  })

  expect(result).toEqual({ block: 'c4', slab: 'c4slab', hotbar0: 'c4' })
})

test('a saved build reloads correctly in a fresh BuildMode instance', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    g.buildMode.placeBlock(5, 0, 5, 'metal')
    g.buildMode.placeBlock(6, 0, 5, 'glass')
    g.buildMode.save()
    g._exitBuildMode()

    // Fresh instance reading the same localStorage key, same technique
    // this project's own settings-persistence tests already use.
    g.buildMode = new g.buildMode.constructor(g.renderer)
    g.buildMode.load()
    return {
      metal: g.buildMode.getBlockAt(5, 0, 5),
      glass: g.buildMode.getBlockAt(6, 0, 5),
    }
  })

  expect(result.metal).toBe('metal')
  expect(result.glass).toBe('glass')
})

test('malformed save data does not crash Build Mode - starts with just the default ground instead', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))

  const result = await page.evaluate(async () => {
    localStorage.setItem('gayz-build-mode', 'not valid json {{{')
    const g = window.__game
    await g._enterBuildMode()
    // No player-built blocks survive a malformed save, but the ground
    // layer (see _ensureGroundLayer) still backfills every cell - a full
    // GROUND_SIZE x GROUND_SIZE (128x128) layer, none of it player-placed.
    const blockCount = g.buildMode._blocks.size
    g._exitBuildMode()
    return { blockCount }
  })

  expect(result.blockCount).toBe(128 * 128)
  expect(errors).toEqual([])
})

test('re-entering Build Mode multiple times does not accumulate duplicate movement listeners', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    // Enter/exit 3 times before the real measurement - if listeners were
    // leaking, this is where duplicates would build up.
    for (let i = 0; i < 3; i++) {
      await g._enterBuildMode()
      g._exitBuildMode()
    }
    await g._enterBuildMode()
    const before = g.buildMode.camera.position.clone()
    g.buildMode._keys.add('KeyW')
    g.buildMode.update(0.5)
    g.buildMode._keys.delete('KeyW')
    const after = g.buildMode.camera.position.clone()
    g._exitBuildMode()
    return { distanceMoved: before.distanceTo(after) }
  })

  // update(dt) is called exactly once here regardless of prior enter/exit
  // cycles, so distance moved must match a single un-duplicated call -
  // FLY_SPEED (8) * dt (0.5) = 4, not some multiple of it.
  expect(result.distanceMoved).toBeGreaterThan(3.9)
  expect(result.distanceMoved).toBeLessThan(4.1)
})

// Fill, Replace and the shape tools (BuildTools.js) - each whole action is
// one Undo.
test('fill, replace and shape tools build the right cells and undo in one step', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const tools = bm.tools
    const count = (type) => [...bm._blocks.values()].filter((t) => t === type).length
    const out = {}
    out.fill = tools.apply('fill', [0, 0, 0], [2, 1, 3], 'stone')
    out.stoneAfterFill = count('stone')
    bm.undo()
    out.stoneAfterUndo = count('stone')
    bm.redo()
    out.stoneAfterRedo = count('stone')
    out.replace = tools.apply('replace', [0, 0, 0], [1, 1, 1], 'brick', 'stone')
    out.brick = count('brick')
    bm.undo()
    out.brickAfterUndo = count('brick')
    out.stoneBack = count('stone')
    bm.undo()
    out.wall = tools.apply('wall', [10, 0, 10], [14, 2, 10], 'oakplanks')
    out.floor = tools.apply('floor', [20, 0, 20], [22, 5, 21], 'cobblestone')
    out.box = tools.apply('box', [30, 0, 30], [32, 2, 32], 'glass')
    out.circle = tools.cells('circle', [0, 5, 0], [4, 5, 0]).every(([x, y, z]) => y === 5 && Math.abs(Math.hypot(x, z) - 4) < 0.5)
    out.ballHollow = !tools.cells('ball', [0, 20, 0], [0, 23, 0]).some(([x, y, z]) => x === 0 && y === 20 && z === 0)
    out.tooBig = tools.cells('fill', [0, 0, 0], [100, 100, 100])
    bm._clipboard = { blocks: [{ dx: 0, dy: 0, dz: 0, type: 'oakstairs', state: { facing: 0 } }, { dx: 2, dy: 0, dz: 0, type: 'stone' }], width: 3, height: 1, depth: 1 }
    tools.rotateClipboard()
    out.rotated = JSON.stringify(bm._clipboard.blocks.map((b) => [b.dx, b.dz, b.state?.facing ?? null])) + ` ${bm._clipboard.width}x${bm._clipboard.depth}`
    g._exitBuildMode()
    return out
  })

  expect(r.fill).toBe(24)
  expect(r.stoneAfterUndo).toBe(r.stoneAfterFill - 24)
  expect(r.stoneAfterRedo).toBe(r.stoneAfterFill)
  expect(r.replace).toBe(8)
  expect(r.brick).toBe(8)
  expect(r.brickAfterUndo).toBe(0)
  expect(r.stoneBack).toBe(r.stoneAfterFill)
  expect(r.wall).toBe(15)
  expect(r.floor).toBe(6)
  expect(r.box).toBe(26)
  expect(r.circle).toBe(true)
  expect(r.ballHollow).toBe(true)
  expect(r.tooBig).toBe(null)
  expect(r.rotated).toBe('[[0,0,3],[0,2,null]] 1x3')
})

// Levers open nearby doors, signs keep their words in a save, and the new
// game blocks (BuildGadgets.js) come back facing the same way.
test('levers, pressure plates and signs work and are saved', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    bm.placeBlock(0, 0, 5, 'oakdoor', false, { facing: 0 })
    bm.placeBlock(3, 0, 3, 'lever', false, { facing: 1 })
    bm.placeBlock(-3, 0, 3, 'pressureplate')
    bm.placeBlock(2, 0, 0, 'sign', false, { facing: 3, text: 'Hello  there' })
    bm.placeBlock(4, 0, 0, 'lootchest', false, { facing: 2 })
    const out = { closed: bm.isDoorOpenAt(0, 0, 5) }
    bm.gadgets.use(3, 0, 3, true)
    out.leverOpens = bm.isDoorOpenAt(0, 0, 5)
    bm.gadgets.use(3, 0, 3, true)
    out.leverCloses = !bm.isDoorOpenAt(0, 0, 5)
    bm.gadgets.updatePlates([[-3, 0, 3]], 0.1)
    out.plateOpens = bm.isDoorOpenAt(0, 0, 5)
    bm.gadgets.updatePlates([], 5)
    out.plateCloses = !bm.isDoorOpenAt(0, 0, 5)
    bm.gadgets.setLever(3, 0, 3, true)
    const saved = bm._decodeSlot(bm._encodeSlot(bm._snapshot())).blocks
    out.sign = saved.find((b) => b.type === 'sign')
    out.lever = saved.find((b) => b.type === 'lever')
    out.chest = saved.find((b) => b.type === 'lootchest')
    out.signMesh = bm.gadgets._signMeshes.size
    bm.removeBlock(2, 0, 0)
    out.signMeshAfterRemove = bm.gadgets._signMeshes.size
    bm.undo()
    out.signBackText = bm.gadgets.signText.get('2,0,0')
    out.special = ['playerstart', 'zombiespawner', 'lootchest', 'lever', 'pressureplate', 'sign'].every((id) => bm.constructor.blockShape(id))
    g._exitBuildMode()
    return out
  })

  expect(r.closed).toBe(false)
  expect(r.leverOpens).toBe(true)
  expect(r.leverCloses).toBe(true)
  expect(r.plateOpens).toBe(true)
  expect(r.plateCloses).toBe(true)
  expect(r.sign).toMatchObject({ facing: 3, text: 'Hello  there' })
  expect(r.lever).toMatchObject({ facing: 1, open: true })
  expect(r.chest).toMatchObject({ facing: 2 })
  expect(r.signMesh).toBe(1)
  expect(r.signMeshAfterRemove).toBe(0)
  expect(r.signBackText).toBe('Hello  there')
  expect(r.special).toBe(true)
})

// Play (BuildSurvival.js): waves spawn at the Zombie Spawner, zombies find
// a way round a wall to you, shots kill them, chests give loot once.
test('Play mode spawns zombie waves that reach you and can be shot', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 14, 'zombiespawner')
    bm.placeBlock(2, 0, 1, 'lootchest', false, { facing: 0 })
    // A wall between the spawner and you, with a gap at one end.
    for (let x = -6; x <= 4; x++) for (let y = 0; y < 3; y++) bm.placeBlock(x, y, 7, 'stone')
    s.start()
    // The zombie skin is painted and loaded in the background.
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    const out = { started: s.active && bm.tryMode.active }
    out.startCell = [Math.floor(bm.tryMode.pos.x), Math.floor(bm.tryMode.pos.z)]
    // Run the game forward without real frames.
    const step = (secs) => { for (let i = 0; i < secs * 20; i++) { bm.tryMode.update(0.05, new Set()); s.update(0.05) } }
    step(4)
    out.wave = s.wave
    out.spawned = s.zombies.length
    out.spawnNearSpawner = s.zombies.every((z) => Math.abs(z.z - 14.5) < 2.5)
    s.health = 1e9
    step(14)
    const p = bm.tryMode.pos
    out.closest = Math.min(...s.zombies.map((z) => Math.hypot(z.x - p.x, z.z - p.z)))
    out.wentRound = s.zombies.some((z) => z.z < 7)
    // Shoot the one in front.
    const target = s.zombies[0]
    const killsBefore = s.kills
    for (let i = 0; i < 10 && s.zombies.includes(target); i++) s.damageZombie(target, 34)
    out.killed = s.kills === killsBefore + 1
    out.mag = s.mag
    out.fired = s.tryFire() && s.mag === out.mag - 1
    const reserve = s.reserve
    out.chest = s.useChest(2, 0, 1) && s.reserve === reserve + 60
    out.chestOnce = s.useChest(2, 0, 1) && s.reserve === reserve + 60
    s.health = 5
    s._hurtPlayer(10)
    out.dead = s.dead && document.getElementById('build-play-over').style.display === 'flex'
    s.stop()
    out.stopped = !s.active && !bm.tryMode.active && s.zombies.length === 0
    g._exitBuildMode()
    return out
  })

  expect(r.started).toBe(true)
  expect(r.startCell).toEqual([0, 0])
  expect(r.wave).toBe(1)
  expect(r.spawned).toBeGreaterThan(0)
  expect(r.spawnNearSpawner).toBe(true)
  expect(r.wentRound).toBe(true)
  expect(r.closest).toBeLessThan(2)
  expect(r.killed).toBe(true)
  expect(r.fired).toBe(true)
  expect(r.chest).toBe(true)
  expect(r.chestOnce).toBe(true)
  expect(r.dead).toBe(true)
  expect(r.stopped).toBe(true)
})

// Share codes, Community Maps and Build Together (BuildShare.js /
// BuildTogether.js) against an in-memory fake of their Firestore calls.
test('sharing a map by code, liking it, and building together', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    Object.defineProperty(g, '_cloudUid', { get: () => 'me', set: () => {}, configurable: true })
    const maps = new Map()
    const rooms = new Map()
    const edits = []
    const editSubs = []
    let n = 0
    const fake = {
      shareMap: async (uid, nickname, name, base, data, blockCount) => {
        const code = `ABC${100 + maps.size}`
        maps.set(code, { name, creatorUid: uid, creatorNickname: nickname, base, data, blockCount, createdAt: Date.now(), likes: 0, plays: 0 })
        return { ok: true, code }
      },
      fetchSharedMap: async (code) => (maps.has(code) ? { ...maps.get(code), code } : null),
      fetchSharedMaps: async () => [...maps].map(([code, m]) => ({ ...m, code, data: undefined })),
      fetchCommunityBuilds: async () => [],
      likeSharedMap: async (code) => { const m = maps.get(code); if (m.liked) return false; m.liked = true; m.likes++; return true },
      countSharedMapPlay: async (code) => { maps.get(code).plays++ },
      deleteSharedMap: async (code) => { maps.delete(code) },
      reportSharedMap: async () => {},
      createBuildRoom: async (uid, hostName, name, base, data) => { rooms.set('ROOM01', { hostUid: uid, hostName, name, base, data }); return { ok: true, code: 'ROOM01' } },
      fetchBuildRoom: async (code) => rooms.get(code) || null,
      sendBuildRoomEdit: async (code, uid, name, ops) => {
        const e = { id: `e${n++}`, uid, name, ops, at: Date.now() }
        edits.push(e)
        for (const cb of editSubs) cb([e])
      },
      subscribeBuildRoomEdits: (code, cb) => { editSubs.push(cb); return () => {} },
      setBuildRoomPlayer: async () => {},
      removeBuildRoomPlayer: async () => {},
      subscribeBuildRoomPlayers: (code, cb) => { cb([{ uid: 'friend', name: 'Pal', x: 1, y: 1, z: 1, yaw: 0, at: Date.now() }]); return () => {} },
    }
    g.__mapShareBackendForTests = fake
    g.__buildRoomBackendForTests = fake
    window.prompt = () => 'My Fort'
    await g._enterBuildMode()
    const bm = g.buildMode
    const out = {}
    bm.placeBlock(5, 0, 5, 'brick')
    bm.placeBlock(6, 0, 5, 'sign', false, { facing: 1, text: 'Hi friends' })
    const code = await bm.share.shareCurrent()
    out.code = code
    out.bannerCode = document.getElementById('community-maps-shared-code').textContent
    await bm.share.refresh()
    out.listed = document.querySelectorAll('.community-map-row').length
    bm.share.close()
    // Someone else opens it by code: it lands in the Shared Map slot.
    const before = bm.activeSlot
    await bm.share.openCode(code.toLowerCase(), false)
    out.slot = bm.activeSlot
    out.ownSlotUntouched = before !== 'shared'
    out.brick = bm.getBlockAt(5, 0, 5)
    out.signText = bm.gadgets.signText.get('6,0,5')
    out.badCode = await bm.share.openCode('nope', false)
    await bm.share.openCode(code, true)
    out.playing = bm.survival.active
    out.plays = maps.get(code).plays
    bm.survival.stop()
    out.likedOnce = (await fake.likeSharedMap(code)) && !(await fake.likeSharedMap(code))

    // Build together: host a room, make changes, a friend's changes arrive.
    await bm.together.host()
    out.inRoom = bm.together.active && bm.together.code === 'ROOM01'
    out.others = bm.together._others.size
    bm.tools.apply('floor', [0, 3, 0], [2, 3, 1], 'glass')
    bm.removeBlock(5, 0, 5)
    bm.undo()
    bm.together._flush()
    const sent = edits.filter((e) => e.uid === 'me').flatMap((e) => JSON.parse(e.ops))
    out.sentPlaces = sent.filter((o) => o[0] === 'p' && o[4] === 'glass').length
    out.sentRemoveAndBack = sent.some((o) => o[0] === 'r' && o[1] === 5) && sent.some((o) => o[0] === 'p' && o[4] === 'brick')
    const undoDepth = bm._undoStack.length
    await fake.sendBuildRoomEdit('ROOM01', 'friend', 'Pal', JSON.stringify([['p', 9, 0, 9, 'gold'], ['p', 9, 1, 9, 'notablock'], ['r', 6, 0, 5], ['p', 1e9, 0, 0, 'stone']]))
    out.friendBlock = bm.getBlockAt(9, 0, 9)
    out.badTypeIgnored = !bm.getBlockAt(9, 1, 9)
    out.friendRemoved = !bm.getBlockAt(6, 0, 5)
    out.notInUndo = bm._undoStack.length === undoDepth
    out.notEchoed = !edits.some((e) => e.uid === 'me' && e.ops.includes('"gold"'))
    await bm.together.leave()
    out.left = !bm.together.active && bm.together._others.size === 0
    g._exitBuildMode()
    return out
  })

  expect(r.code).toMatch(/^[A-Z0-9]{6}$/)
  expect(r.bannerCode).toBe(r.code)
  expect(r.listed).toBe(1)
  expect(r.slot).toBe('shared')
  expect(r.ownSlotUntouched).toBe(true)
  expect(r.brick).toBe('brick')
  expect(r.signText).toBe('Hi friends')
  expect(r.badCode).toBe(false)
  expect(r.playing).toBe(true)
  expect(r.plays).toBe(1)
  expect(r.likedOnce).toBe(true)
  expect(r.inRoom).toBe(true)
  expect(r.others).toBe(1)
  expect(r.sentPlaces).toBe(6)
  expect(r.sentRemoveAndBack).toBe(true)
  expect(r.friendBlock).toBe('gold')
  expect(r.badTypeIgnored).toBe(true)
  expect(r.friendRemoved).toBe(true)
  expect(r.notInUndo).toBe(true)
  expect(r.notEchoed).toBe(true)
  expect(r.left).toBe(true)
})

// The editor's weather is Map 1's own overlays (BuildSky.js), shown only
// while the editor is open.
test('Map Editor weather uses Map 1\'s rain, snow and sandstorm', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const sky = g.buildMode.sky
    const shown = () => ['rain-overlay', 'rain-overlay-hard', 'snow-overlay', 'snow-overlay-hard', 'sandstorm-overlay'].filter((id) => document.getElementById(id).style.display === 'block')
    const out = {}
    for (const w of ['clear', 'lightRain', 'hardRain', 'lightSnow', 'hardSnow', 'sandstorm']) {
      sky.weather = w
      sky._pickWeather()
      sky.apply()
      out[w] = shown().join()
    }
    out.particles = document.querySelectorAll('#rain-overlay-hard .rain-particle').length
    g._exitBuildMode()
    out.afterExit = shown().join()
    return out
  })

  expect(r).toEqual({ clear: '', lightRain: 'rain-overlay', hardRain: 'rain-overlay-hard', lightSnow: 'snow-overlay', hardSnow: 'snow-overlay-hard', sandstorm: 'sandstorm-overlay', particles: 160, afterExit: '' })
})

// Map 3's walled camp in Play (BuildCamp.js): a safe zone with a Trader,
// Upgrader, Ammo Refill and Quest Board.
test('Map 3 Play starts in a safe camp with working NPCs', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    const c = s.camp
    const p = g.buildMode.tryMode.pos
    const out = { camp: !!c, startsInside: !!c && c.inside(p.x, p.z), npcs: c ? c.npcs.map((n) => n.id).sort().join() : '' }
    // Zombies can't step into the camp, and can't hurt you there.
    out.wall = s._zombieHits(c.zone.cx + 0.5, 0, c.zone.cz + 0.5)
    const hp = s.health
    s._hurtPlayer(30)
    out.safe = s.health === hp
    s.coins = 1000
    c._act('buy', 'armor')
    out.armor = s.armor
    c._act('upgrade', 'mag')
    out.mag = s.magSize()
    s.mag = 0
    s.reserve = 0
    c._act('fill', 'fill')
    out.filled = s.mag === s.magSize() && s.reserve > 0
    s.stats.kills = 15
    c._act('claim', 'kill15')
    out.coinsLeft = s.coins
    out.nextQuests = c.activeQuests().map((q) => q.id).join()
    // The board closes on a click outside it, and stays open on one inside.
    c.openPanel('trader')
    document.getElementById('play-npc-list').click()
    out.insideKeepsOpen = c.panelOpen
    document.getElementById('play-npc-panel').click()
    out.outsideCloses = !c.panelOpen
    s.stop()
    out.cleaned = !s.camp
    g._exitBuildMode()
    return out
  })

  expect(r.camp).toBe(true)
  expect(r.startsInside).toBe(true)
  expect(r.npcs).toBe('ammo,quest,trader,upgrader')
  expect(r.wall).toBe(true)
  expect(r.safe).toBe(true)
  expect(r.armor).toBe(50)
  expect(r.mag).toBe(40)
  expect(r.filled).toBe(true)
  expect(r.coinsLeft).toBe(1000 - 75 - 90 + 100)
  expect(r.nextQuests).toBe('chest3,head10,wave5')
  expect(r.insideKeepsOpen).toBe(true)
  expect(r.outsideCloses).toBe(true)
  expect(r.cleaned).toBe(true)
})

// The same camp NPCs also stand in Map 3's camp in the Map Editor (just to
// look at - no panels), and step aside for Play's own camp.
test('Map 3 camp NPCs show in the Map Editor too', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    const out = { npcs: b._campDisplay ? b._campDisplay.npcs.map((n) => n.id).sort().join() : '' }
    // The camp's wall has exactly one way in: the three-wide main gate.
    const { map } = b._map3Base()
    const z = map.safeZone
    const solid = new Set(map.blocks.filter((k) => k.y >= 0 && k.y <= 1).map((k) => `${k.x},${k.y},${k.z}`))
    let gaps = 0
    for (let x = z.x0; x <= z.x1; x++) for (let zz = z.z0; zz <= z.z1; zz++) {
      if (x !== z.x0 && x !== z.x1 && zz !== z.z0 && zz !== z.z1) continue
      if (!solid.has(`${x},0,${zz}`) || !solid.has(`${x},1,${zz}`)) gaps++
    }
    out.wallGaps = gaps
    // The NPCs' skins (made in Design a Skin) have loaded.
    for (let i = 0; i < 40 && b._campDisplay.npcs.some((n) => !n.body); i++) await new Promise((res) => setTimeout(res, 250))
    out.bodies = b._campDisplay.npcs.filter((n) => n.body).length
    b.survival.start()
    b.update(0.016)
    out.duringPlay = !!b._campDisplay
    out.playCamp = !!b.survival.camp
    b.survival.stop()
    b.update(0.016)
    out.back = !!b._campDisplay
    g._exitBuildMode()
    out.afterExit = !!b._campDisplay
    return out
  })

  expect(r).toEqual({ npcs: 'ammo,quest,trader,upgrader', wallGaps: 3, bodies: 4, duringPlay: false, playCamp: true, back: true, afterExit: false })
})

// The homepage Play button starts the block city's zombie waves - the old
// Map 1 city is gone and the block city is Map 1 now (internal slot 'map3').
// Its run uses the Game Mode panel's picks and the Upgrades bought
// (PlayRules.js), and a finished run is recorded (stats, Legacy Points).
test('Play starts the block city (Map 1) zombie waves', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.difficulty = 'hard'
    g.settings.loadout = 'tank'
    g.settings.selectedGameMode = 'bossHunt'
    g.settings.mutators.glassHouse = true
    g.metaProgress.purchased.add('vitality')
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const s = g.buildMode.survival
    const before = { runs: g.careerStats.totalRuns, legacy: g.metaProgress.legacyPoints }
    const out = {
      slot: g.buildMode.activeSlot,
      shown: ['upgrades-btn', 'quests-btn', 'server-btn'].every((id) => getComputedStyle(document.getElementById(id)).display !== 'none'),
      maps: [...document.querySelectorAll('#map-select-grid [data-map]')].map((b) => b.dataset.map).join(),
      // Tank: 135, + Vitality's 50.
      maxHealth: s.maxHealth,
      mode: s.cfg.mode,
      bossEvery: s.cfg.bossEvery,
      // Glass House doubles damage both ways.
      glass: s.cfg.damageMult === 2 && s.cfg.zombieDamageMult === 2 * 1.4,
    }
    s.kills = 10
    s.wave = 3
    s.health = 0
    s._die()
    out.runs = g.careerStats.totalRuns - before.runs
    // (10 kills x 10 + 2 waves x 50) x 0.2
    out.legacy = g.metaProgress.legacyPoints - before.legacy
    return out
  })
  expect(r).toEqual({ slot: 'map3', shown: true, maps: 'map3,map2', maxHealth: 185, mode: 'bossHunt', bossEvery: 3, glass: true, runs: 1, legacy: 40 })
})

// A homepage run opens the weapon picker first (2026-10-09, "make the
// weapons choosable, pickable at the start when joining a game"): nothing
// spawns until a gun is picked, and the gun's own stats take over.
test('a Map 1 run starts with the weapon picker and uses the picked gun', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const s = g.buildMode.survival
    const pick = document.getElementById('play-weapon-pick')
    const out = {
      pickerShown: getComputedStyle(pick).display !== 'none',
      cards: pick.querySelectorAll('[data-play-weapon]').length,
      waitsForPick: s._picking === true,
    }
    // Nothing spawns while the picker is open.
    s.update(0.5)
    out.spawnedWhilePicking = s.zombies.length + s._toSpawn
    pick.querySelector('[data-play-weapon="shotgun"]').click()
    out.pickerHidden = getComputedStyle(pick).display === 'none'
    out.weapon = s.weaponId
    out.ammo = [s.mag, s.reserve]
    out.gun = g.buildMode.tryMode._gunId
    out.saved = g.settings.playWeapon
    // Its fire rate: a second shot straight after the first is refused.
    out.shots = [s.tryFire(), s.tryFire()]
    // A zombie three blocks straight ahead takes the pellets.
    const B = s.B
    const cam = g.buildMode.camera
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    dir.y = 0
    dir.normalize()
    const fake = { x: cam.position.x / B + dir.x * 3, y: cam.position.y / B - 1.4, z: cam.position.z / B + dir.z * 3, size: 1, health: 100000, vx: 0, vz: 0 }
    s.zombies.push(fake)
    g.buildMode._pitch = 0
    s._nextShotAt = 0
    s.shoot()
    out.damaged = fake.health < 100000
    s.zombies = s.zombies.filter((z) => z !== fake)
    return out
  })
  expect(r).toEqual({ pickerShown: true, cards: 15, waitsForPick: true, spawnedWhilePicking: 0, pickerHidden: true, weapon: 'shotgun', ammo: [6, 42], gun: 'shotgun', saved: 'shotgun', shots: [true, false], damaged: true })
})

test('View Distance hides far chunks and zombies are drawn in one batch', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    window.__game.settings.viewDistance = 'short'
    window.__game.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  // A homepage run opens the weapon picker first.
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  // The zombie skin loads a moment after Play starts.
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    bm.render()
    const chunks = [...bm._chunks.chunks.values()]
    const short = chunks.filter((c) => c.shown).length
    const fogFar = bm.scene.fog.far
    g.settings.viewDistance = 'max'
    bm.render()
    const max = chunks.filter((c) => c.shown).length
    // A few zombies: their bodies are instanced, not one mesh each.
    s._toSpawn = 3
    for (let i = 0; i < 300 && s.zombies.length < 3; i++) { s._spawnTimer = 0; bm.update(1 / 30) }
    bm.render()
    const batch = s._zBatch
    return {
      short,
      max,
      fogFar,
      zombies: s.zombies.length,
      batched: !!batch && batch.meshes.every((m) => m.count === s.zombies.length),
      ownMeshesHidden: s.zombies.every((z) => z.parts.every((p) => !p.visible)),
    }
  })
  expect(r.short).toBeGreaterThan(0)
  expect(r.short).toBeLessThan(r.max)
  expect(r.fogFar).toBeLessThan(100)
  expect(r.zombies).toBe(3)
  expect(r.batched).toBe(true)
  expect(r.ownMeshesHidden).toBe(true)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('Map 1 shows touch controls that move, look and use the buttons', async ({ page }) => {
    await gotoAndWaitForGame(page)
    await page.evaluate(() => window.__game.playBtn.click())
    await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
    await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
    await page.waitForFunction(() => getComputedStyle(document.getElementById('touch-play') || document.body).display === 'block', null, { timeout: 30000 })
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    const center = (sel) => page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, sel)
    // Look: drag on the right half.
    const yaw0 = await page.evaluate(() => window.__game.buildMode._yaw)
    await touch('touchStart', [{ x: 500, y: 200, id: 1 }])
    await touch('touchMove', [{ x: 560, y: 200, id: 1 }])
    await touch('touchEnd', [])
    // Move: the stick on the left half, pushed forward.
    await touch('touchStart', [{ x: 150, y: 250, id: 2 }])
    await touch('touchMove', [{ x: 150, y: 220, id: 2 }])
    const stick = await page.evaluate(() => window.__game.buildMode._touchMove)
    await touch('touchEnd', [])
    // Reload and Pause buttons.
    const reload = await center('.tp-reload')
    await page.evaluate(() => { window.__game.buildMode.survival.mag = 5 })
    await touch('touchStart', [{ x: reload.x, y: reload.y, id: 3 }])
    await touch('touchEnd', [])
    const reloading = await page.evaluate(() => window.__game.buildMode.survival._reloadLeft > 0)
    const pause = await center('.tp-pause')
    await touch('touchStart', [{ x: pause.x, y: pause.y, id: 4 }])
    await touch('touchEnd', [])
    const r = await page.evaluate(() => ({
      yaw: window.__game.buildMode._yaw,
      paused: window.__game.buildMode.menuOpen,
      hidden: getComputedStyle(document.getElementById('touch-play')).display === 'none',
      noWords: [...document.querySelectorAll('#touch-play .tp-btn')].every((b) => b.textContent.trim() === '' && b.querySelector('svg')),
    }))
    expect(r.yaw).not.toBe(yaw0)
    expect(stick?.y).toBeGreaterThan(0)
    expect(reloading).toBe(true)
    expect(r.paused).toBe(true)
    expect(r.hidden).toBe(true)
    expect(r.noWords).toBe(true)
  })
})

test('Zombie Extraction: the helicopter lands after its waves and holding the ring wins', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    document.getElementById('game-mode-zombie-extraction').click()
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const s = g.buildMode.survival
    s._pickWeapon('rifle')
    const out = { mode: s.cfg.mode, unlocked: !document.getElementById('game-mode-zombie-extraction').disabled }
    // Wave 5 just cleared: the helicopter comes down somewhere reachable.
    const p = s.bm.tryMode.pos
    s._rebuildFlow([s._playerCell(p)])
    s.wave = 5
    s._toSpawn = 0
    for (const z of [...s.zombies]) { s._removeZombie(z); s.zombies = s.zombies.filter((o) => o !== z) }
    s._breakTimer = 0
    s._updateWorld(0.01)
    const ex = s._extract
    out.placed = !!ex
    out.hud = document.getElementById('build-play-wave').textContent
    // Away from it: no count. On the ring: counts, stepping off resets it.
    s._updateExtraction(1)
    out.awayHold = ex.hold
    p.set(ex.x, ex.y, ex.z)
    s._updateExtraction(4)
    out.onHold = ex.hold
    p.set(ex.x + 10, ex.y, ex.z)
    s._updateExtraction(0.1)
    out.resetHold = ex.hold
    p.set(ex.x, ex.y, ex.z)
    const runs0 = g.careerStats.totalRuns
    for (let i = 0; i < 12 && !s.dead; i++) s._updateExtraction(1)
    out.won = s._won && s.dead
    out.title = document.getElementById('build-play-over-title').textContent
    out.counted = g.careerStats.totalRuns === runs0 + 1
    return out
  })
  expect(r.mode).toBe('zombieExtraction')
  expect(r.unlocked).toBe(true)
  expect(r.placed).toBe(true)
  expect(r.hud).toContain('Helicopter')
  expect(r.awayHold).toBe(0)
  expect(r.onHold).toBe(4)
  expect(r.resetHold).toBe(0)
  expect(r.won).toBe(true)
  expect(r.title).toBe('You got out!')
  expect(r.counted).toBe(true)
})

test('right-click aims down the sights and the Inspect key turns the gun', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    s._pickWeapon('rifle')
    const tm = bm.tryMode
    const frames = (n) => { for (let i = 0; i < n; i++) tm.update(0.05, bm._keys) }
    frames(10)
    const out = { fov0: bm.camera.fov, gunX0: tm._gun.position.x }
    tm.setAim(true)
    frames(20)
    out.aim = tm.aimAmount
    out.fovAim = bm.camera.fov
    out.gunXAim = tm._gun.position.x
    // Right-click no longer uses things in Try Map; E still does.
    let used = 0
    const orig = bm._tryUseFromCamera
    bm._tryUseFromCamera = () => { used++ }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }))
    bm._tryUseFromCamera = orig
    out.used = used
    tm.setAim(false)
    frames(20)
    out.aimBack = tm.aimAmount
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true }))
    frames(8)
    out.inspectTurn = tm._gun.rotation.y
    frames(60)
    out.inspectDone = tm._gun.rotation.y
    return out
  })
  expect(r.aim).toBeGreaterThan(0.95)
  expect(r.fovAim).toBeLessThan(r.fov0 - 15)
  expect(Math.abs(r.gunXAim)).toBeLessThan(0.03)
  expect(r.gunX0).toBeGreaterThan(0.2)
  expect(r.used).toBe(1)
  expect(r.aimBack).toBeLessThan(0.05)
  expect(r.inspectTurn).toBeGreaterThan(0.6)
  expect(Math.abs(r.inspectDone)).toBeLessThan(0.01)
})
