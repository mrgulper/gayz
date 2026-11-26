// Map Editor: building, tools, saves, sharing.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { SPECIAL_BLOCKS } from '../src/game/SpecialBlocks.js'

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

test('the game clock keeps ticking in the map (a slow homepage frame never sets the game speed)', async ({ page }) => {
  await gotoAndWaitForGame(page)
  // 2026-10-12: the clock was only updated on the homepage, so the map kept
  // reusing the last homepage frame's step - on a laggy phone homepage
  // (0.1s frames) the game ran several times too fast.
  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    // THREE.Timer keeps its step in ms; getDelta() returns seconds.
    g.timer._delta = 77.7
    const frames = []
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      frames.push(g.timer.getDelta())
    }
    g._exitBuildMode()
    return frames
  })
  expect(result.some((d) => d !== 0.0777)).toBe(true)
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
  // + the special blocks, which grow batch by batch (SpecialBlocks.js).
  expect(result.swatchCount).toBe(867 + SPECIAL_BLOCKS.length)
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
    // layer (see _ensureGroundLayer) still backfills every cell - a
    // PLAIN_GROUND x PLAIN_GROUND (32x32) platform, none of it player-placed.
    const blockCount = g.buildMode._blocks.size
    g._exitBuildMode()
    return { blockCount }
  })

  expect(result.blockCount).toBe(32 * 32)
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

// 2026-10-16 polish: bamboo is a thin stalk you can walk past, the new
// blocks are there (with slabs and stairs, but none for the thin ones), and
// the minimap has florr.io's three sizes with limits on dragging/zooming.
test('thin bamboo, new blocks and the three map sizes', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const isType = (id) => b.constructor.isBlockType(id)
    const out = {
      newBlocks: ['stonebricks', 'timberframe', 'thatch', 'roofshingles', 'dirtpath', 'paperlantern', 'bamboo', 'cherryleaves', 'stonebricksslab', 'thatchstairs'].every(isType),
      noThinSlabs: !isType('bambooslab') && !isType('bambooleavesstairs'),
    }
    // Bamboo: drawn narrower than its cell, and only its middle blocks you.
    b.placeBlock(0, 60, 0, 'bamboo')
    // Built but not drawn yet: a drawn chunk lets go of its numbers
    // (BlockChunks dropAfterUpload).
    b._chunks.flush(b._chunkCells)
    const xs = new Set()
    for (const m of b._chunks.chunks.get(b._chunkKeyOf(0, 60, 0))?.meshes || []) {
      const p = m.geometry.attributes.position
      for (let i = 0; i < p.count; i++) xs.add(Math.round((p.getX(i) / 0.35) * 100) / 100)
    }
    out.thin = Math.min(...xs) > 0.3 && Math.max(...xs) < 0.7
    const tm = b.tryMode
    out.blocksMiddle = tm._hits(0.5, 60, 0.5, 1.8)
    out.walkPastEdge = !tm._hits(0.05 - 0.3 + 0.0, 60, 0.5, 1.8)
    // The minimap's three sizes.
    b.toggleTryMode()
    const spans = []
    for (let i = 0; i < 3; i++) {
      spans.push([tm._mapEl.dataset.size, tm._mapSpan()])
      tm.cycleMap()
    }
    out.spans = spans
    while (tm._mapEl.dataset.size !== 'center') tm.cycleMap()
    tm._mapPan.x = 1e6
    tm._clampMapPan()
    // No dragging limit either (2026-10-19).
    out.panFree = tm._mapPan.x === 1e6
    // No zoom limit (2026-10-19): far past the old 48..960 cells.
    for (let i = 0; i < 30; i++) tm.zoomMap(2)
    out.zoomOutFar = tm._mapSpan() > 1e6
    for (let i = 0; i < 60; i++) tm.zoomMap(0.5)
    out.zoomInFar = tm._mapSpan() < 1
    // Bigger than the 2nd size, in the middle of the screen.
    const centerBox = tm._mapEl.getBoundingClientRect()
    tm.cycleMap()
    tm.cycleMap()
    const bigBox = tm._mapEl.getBoundingClientRect()
    out.centerBigger = centerBox.width > bigBox.width + 50 && Math.abs(centerBox.left + centerBox.width / 2 - innerWidth / 2) < 2
    while (tm._mapEl.dataset.size !== 'center') tm.cycleMap()
    tm.cycleMap()
    b.toggleTryMode()
    g._exitBuildMode()
    return out
  })
  expect(r.newBlocks).toBe(true)
  expect(r.noThinSlabs).toBe(true)
  expect(r.thin).toBe(true)
  expect(r.blocksMiddle).toBe(true)
  expect(r.walkPastEdge).toBe(true)
  expect(r.spans).toEqual([['normal', 96], ['big', 640], ['center', 640]])
  expect(r.panFree).toBe(true)
  expect(r.zoomOutFar).toBe(true)
  expect(r.zoomInFar).toBe(true)
  expect(r.centerBigger).toBe(true)
})

// 2026-10-17: block textures are clean, crisp pixel art (the blurry HD pass
// is gone), drawn with nearest filtering. Since 2026-10-24 each face is
// smoothed up to 32px with a fine grain and a soft rim (detailFace).
test('block textures are clean and crisp', async ({ page }) => {
  await gotoAndWaitForGame(page)
  // The Detailed graphics level (the test browser draws in software, so
  // it would get Simple's plain pictures).
  await page.evaluate(async () => {
    window.__game._applyGraphicsLevel('detailed')
    await window.__game._enterBuildMode({ map: 'map2' })
  })
  const r = await page.evaluate(() => {
    const chunks = window.__game.buildMode._chunks
    const img = chunks.atlas.image
    const ctx = img.getContext('2d', { willReadFrequently: true })
    const colors = {}
    for (const id of ['stone', 'cobblestone', 'oakplanks', 'dirt', 'bricks', 'sand']) {
      const uv = chunks.info.get(id)?.uvs?.[0]
      if (!uv) continue
      const x = Math.round(uv[0] * img.width)
      const y = Math.round((1 - uv[3]) * img.height)
      const d = ctx.getImageData(x, y, 32, 32).data
      const seen = new Set()
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      colors[id] = seen.size
    }
    return { colors, crisp: chunks.atlas.magFilter === 1003, width: img.width, tile: Math.round((chunks.info.get('stone').uvs[0][2] - chunks.info.get('stone').uvs[0][0]) * img.width) }
  })
  // Crisp (never blurred), 32x32 since 2026-10-24 with a fine grain and
  // soft rim on every block, so each picture has more than a few colours.
  expect(r.crisp).toBe(true)
  expect(r.width).toBe(2048)
  expect(r.tile).toBe(32)
  expect(Object.keys(r.colors).length).toBeGreaterThanOrEqual(5)
  for (const n of Object.values(r.colors)) expect(n).toBeGreaterThan(4)
})

// Memory (2026-10-19): a drawn block chunk lets go of its own copy of its
// mesh (the graphics card has one), and after a lost graphics connection
// every chunk is made again from the blocks instead of re-sent. The
// homepage's rain/water canvases are emptied while a map is open.
test('block chunks free their copy once drawn and come back after a lost graphics connection', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3', play: true })
    const b = g.buildMode
    const frames = (n) => new Promise((done) => { let i = 0; const step = () => (++i >= n ? done() : requestAnimationFrame(step)); requestAnimationFrame(step) })
    await frames(30)
    const drawn = () => [...b._chunks.chunks.values()].flatMap((c) => c.meshes).filter((m) => m.visible && !m.geometry.attributes.position.array)
    // Even land behind you (never in view yet) lets go of its copy.
    const kept = [...b._chunks.chunks.values()].flatMap((c) => c.meshes).filter((m) => m.visible && m.geometry.attributes.position.array).length
    const out = { kept, freed: drawn().length, homeCanvases: ['menu-bg-rain', 'menu-bg-water'].map((id) => document.getElementById(id)?.width ?? 0) }
    const lose = g.renderer.getContext().getExtension('WEBGL_lose_context')
    lose.loseContext()
    await new Promise((done) => setTimeout(done, 300))
    lose.restoreContext()
    await new Promise((done) => setTimeout(done, 300))
    // three.js's own reconnect leaves one error behind before anything
    // is drawn - cleared here, so only drawing the rebuilt chunks counts.
    g.renderer.getContext().getError()
    await frames(30)
    out.rebuilt = [...b._chunks.chunks.values()].flatMap((c) => c.meshes).length
    g.renderer.info.autoReset = false
    g.renderer.info.reset()
    await frames(5)
    out.triangles = g.renderer.info.render.triangles
    g.renderer.info.autoReset = true
    out.glError = g.renderer.getContext().getError()
    g._exitBuildMode()
    await frames(20)
    out.homeBack = ['menu-bg-rain', 'menu-bg-water'].map((id) => document.getElementById(id)?.width ?? 0)
    return out
  })
  expect(r.freed).toBeGreaterThan(10)
  expect(r.kept).toBe(0)
  expect(r.homeCanvases).toEqual([0, 0])
  expect(r.rebuilt).toBeGreaterThan(10)
  expect(r.triangles).toBeGreaterThan(1000)
  expect(r.glError).toBe(0)
  expect(r.homeBack.every((w) => w > 0)).toBe(true)
})

// 2026-10-24: the Map Editor button asks Worlds or Plain; Plain is a 32x32
// platform in the void (2026-11-16, was endless grass) - you can build out
// into it, and falling off puts you back; the Tab panel's storage is 10 x 10; animals
// from the picker's Animals list are put down with right-click, walk about,
// come off with left-click and are saved with the map.
test('Map Editor: Worlds/Plain choice, void platform, 10x10 storage, placed animals', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.click('#build-mode-btn')
  await expect(page.locator('#editor-pick-dialog')).toBeVisible()
  await expect(page.locator('#editor-pick-worlds-name')).toHaveText('Worlds')
  await page.click('#editor-pick-plain')
  await page.waitForFunction(() => window.__game.buildMode?.active, null, { timeout: 60000 })
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const out = {}
    out.slot = bm.activeSlot
    bm.camera.position.set(300 * 0.35, 4 * 0.35, 300 * 0.35)
    for (let i = 0; i < 400; i++) bm._updateWorld()
    // Nothing grows far out: void.
    out.far = bm.getBlockAt(300, -1, 300)
    // The platform: 32 x 32 round the middle, void just past it.
    out.platform = [bm.getBlockAt(-16, -1, -16), bm.getBlockAt(15, -1, 15), bm.getBlockAt(16, -1, 0), bm.getBlockAt(0, -1, -17)]
    // You can build out into the void.
    bm.placeBlock(40, -1, 40, 'stone')
    out.builtOut = bm.getBlockAt(40, -1, 40)
    bm.removeBlock(40, -1, 40)
    // Walk off the edge in Try Map: back at the start soon after.
    bm.toggleTryMode()
    const tm = bm.tryMode
    tm.pos.set(30.5, 1, 30.5)
    tm.vel.set(0, 0, 0)
    let back = false
    for (let i = 0; i < 400 && !back; i++) {
      tm.update(0.05, new Set())
      back = Math.abs(tm.pos.x - 30.5) > 5
    }
    out.fellBack = back && tm.pos.y > -5
    bm.toggleTryMode()
    bm.togglePicker()
    out.storage = document.querySelectorAll('#build-picker .bp-store .bp-slot').length
    bm._pickerCategorySelect.value = 'animals'
    bm._renderPickerGrid()
    out.animalsListed = document.querySelectorAll('#build-picker .build-picker-animal').length
    document.querySelector('#build-picker .build-picker-animal[data-animal-id="lion"]').click()
    out.placing = bm.placingAnimal
    bm.camera.position.set(0, 4 * 0.35, 0)
    bm._yaw = 0
    bm._pitch = -0.4
    bm.update(1 / 60)
    bm.camera.updateMatrixWorld()
    bm._placeFromCamera()
    out.spots = bm.animalSpots.map((s) => s.kind)
    const lion = bm.survival.animals.list.find((a) => a.kind === 'lion')
    const start = [lion.x, lion.z]
    lion.walking = true
    lion.think = 5
    for (let i = 0; i < 60; i++) bm.update(1 / 30)
    out.walked = Math.hypot(lion.x - start[0], lion.z - start[1]) > 0.2
    bm.save()
    bm.clearAllBlocks()
    bm.load()
    out.reloaded = bm.animalSpots.map((s) => s.kind)
    // Left-click on it takes it away.
    const again = bm.survival.animals.list.find((a) => a.kind === 'lion')
    const B = 0.35
    const dx = again.x * B - bm.camera.position.x
    const dz = again.z * B - bm.camera.position.z
    const dy = (again.y + 0.8) * B - bm.camera.position.y
    bm._yaw = Math.atan2(-dx, -dz)
    bm._pitch = Math.atan2(dy, Math.hypot(dx, dz))
    bm.update(1 / 60)
    bm.camera.updateMatrixWorld()
    bm._removeFromCamera()
    out.removed = bm.animalSpots.length === 0 && !bm.survival.animals.list.some((a) => a.kind === 'lion')
    return out
  })
  expect(r.slot).not.toBe('map3')
  expect(r.far ?? null).toBe(null)
  expect(r.platform.map((b) => b ?? null)).toEqual(['grass', 'grass', null, null])
  expect(r.builtOut).toBe('stone')
  expect(r.fellBack).toBe(true)
  expect(r.storage).toBe(100)
  expect(r.animalsListed).toBeGreaterThan(130)
  expect(r.placing).toBe('lion')
  expect(r.spots).toEqual(['lion'])
  expect(r.walked).toBe(true)
  expect(r.reloaded).toEqual(['lion'])
  expect(r.removed).toBe(true)
})

// 2026-11-25: Plain maps saved with the old 128x128 ground load as the
// new 32x32 platform (centered), dropping anything built outside it, and
// are saved again that way. A new map's few blocks in the void stay.
test('old 128x128 Plain map loads cut down to 32x32', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map2' })
    const bm = g.buildMode
    const blocks = []
    for (let x = -64; x < 64; x++) for (let z = -64; z < 64; z++) blocks.push({ x, y: -1, z, type: 'grass' })
    blocks.push({ x: 0, y: 0, z: 0, type: 'stone' }, { x: 40, y: 0, z: 40, type: 'stone' })
    bm._writeSlot(1, { blocks, hotbar: bm.hotbar, animals: [{ kind: 'pig', x: 0.5, y: 0, z: 0.5 }, { kind: 'pig', x: 50.5, y: 0, z: 0.5 }] })
    // A new map with a small bridge out into the void.
    bm._writeSlot(2, { blocks: [{ x: 0, y: -1, z: 0, type: 'grass' }, { x: 30, y: -1, z: 0, type: 'stone' }], hotbar: bm.hotbar })
    bm.switchSlot(1)
    const old = {
      inside: !!bm.getBlockAt(15, -1, -16), center: !!bm.getBlockAt(0, 0, 0),
      outside: !!bm.getBlockAt(16, -1, 0) || !!bm.getBlockAt(40, 0, 40),
      saved: bm._slotData(1).blocks.length, animals: bm.animalSpots.length,
    }
    bm.switchSlot(2)
    const fresh = { bridge: !!bm.getBlockAt(30, -1, 0) }
    g._exitBuildMode()
    return { old, fresh }
  })
  expect(r.old).toEqual({ inside: true, center: true, outside: false, saved: 32 * 32 + 1, animals: 1 })
  expect(r.fresh.bridge).toBe(true)
})
