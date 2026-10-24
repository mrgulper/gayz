import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { sampleLand, BIOMES } from '../src/game/OpenWorld.js'

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
  expect(result.swatchCount).toBe(861)
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
    // Where each zombie appears (checked there, not after it has had time
    // to walk off - that made the check depend on the machine's speed).
    const spawnedAt = []
    const make = s._makeZombie.bind(s)
    s._makeZombie = (...args) => {
      const z = make(...args)
      spawnedAt.push(z.z)
      return z
    }
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
    out.spawnNearSpawner = spawnedAt.length > 0 && spawnedAt.every((z) => Math.abs(z - 14.5) < 1.5)
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
    // Its body falls over and fades away (own material copies - the live
    // zombies' shared ones are never touched).
    const corpse = (s._corpses || [])[0]
    out.corpse = !!corpse && s._corpses.length === 1
    out.ownMaterials = !!corpse && corpse.materials.length > 0 && corpse.materials.every((m) => !s._zBatch.meshes.some((mesh) => [].concat(mesh.material).includes(m)))
    step(0.5)
    out.fell = !!corpse && Math.abs(corpse.group.rotation.x - Math.PI / 2) < 0.01
    // Bodies lie for 40 s, then fade over the rest of a minute (2026-10-18).
    s._updateCorpses(45)
    out.fading = !!corpse && corpse.materials[0].opacity > 0 && corpse.materials[0].opacity < 1
    s._updateCorpses(16)
    out.corpseGone = (s._corpses || []).length === 0
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
  expect(r.corpse).toBe(true)
  expect(r.ownMaterials).toBe(true)
  expect(r.fell).toBe(true)
  expect(r.fading).toBe(true)
  expect(r.corpseGone).toBe(true)
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

// The editor's weather (BuildSky.js): rain and snow fall in the 3D world
// (BuildWeather.js) instead of the old screen overlays - only the
// sandstorm haze is still an overlay - the sky greys, the light dims and
// the fog comes in, and it's all gone once the editor closes. Random is
// the default and fits the biome (no snow in the desert).
test('Map Editor weather falls in the world and fits the biome', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const sky = g.buildMode.sky
    const w3 = sky.weather3d
    const shown = () => ['rain-overlay', 'rain-overlay-hard', 'snow-overlay', 'snow-overlay-hard', 'sandstorm-overlay'].filter((id) => document.getElementById(id).style.display === 'block')
    const out = { defaultWeather: sky.weather }
    for (const w of ['clear', 'lightRain', 'hardRain', 'lightSnow', 'hardSnow', 'sandstorm']) {
      sky.weather = w
      sky._pickWeather()
      sky.apply()
      // Long enough for the old weather to fade out and the new one in.
      for (let i = 0; i < 400; i++) sky.update(1 / 30)
      out[w] = [shown().join(), w3.kind || '', w3.points.visible, sky.fogFactor < 0.99, sky._light < 0.99]
    }
    g._exitBuildMode()
    out.afterExit = [shown().join(), w3.kind || '', w3.points.visible]
    // Snow while standing somewhere dry re-rolls to weather a dry place can have.
    sky._climateAt = () => 'dry'
    const rolls = new Set()
    sky.weather = 'random'
    for (let i = 0; i < 40; i++) {
      sky._pickWeather()
      rolls.add(sky._now)
    }
    out.dryRolls = [...rolls].every((k) => k === 'clear' || k === 'sandstorm')
    return out
  })

  expect(r).toEqual({
    defaultWeather: 'random',
    clear: ['', '', false, false, false],
    lightRain: ['', 'lightRain', true, true, true],
    hardRain: ['', 'hardRain', true, true, true],
    lightSnow: ['', 'lightSnow', true, true, true],
    hardSnow: ['', 'hardSnow', true, true, true],
    sandstorm: ['sandstorm-overlay', '', false, true, true],
    afterExit: ['', '', false],
    dryRolls: true,
  })
})

// Map 3's walled camp in Play (BuildCamp.js): a safe zone with a Trader,
// Upgrader, Ammo Refill and Quest Board.
test('Map 3 Play starts in a safe camp with working NPCs', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3', play: true })
    // Play fades to black while Map 1 loads and back in once it's drawn.
    const fade = document.getElementById('play-fade')
    const cleared = () => !!fade && !fade.classList.contains('on') && fade.style.display === 'none'
    for (let i = 0; i < 100 && !cleared(); i++) await new Promise((res) => setTimeout(res, 100))
    const faded = cleared()
    const s = g.buildMode.survival
    const c = s.camp
    const p = g.buildMode.tryMode.pos
    const out = { faded, camp: !!c, startsInside: !!c && c.inside(p.x, p.z), npcs: c ? c.npcs.map((n) => n.id).sort().join() : '' }
    // Zombies can't step into the camp, and can't hurt you there.
    out.wall = s._zombieHits(c.zone.cx + 0.5, 0, c.zone.cz + 0.5)
    // The last row along the far (+x/+z) walls is camp too - zombies used
    // to spawn there (inside() shrank those sides when given a margin).
    const zn = c.zone
    out.farRows = [[zn.x1 - 0.5, zn.cz + 0.5], [zn.cx + 0.5, zn.z1 - 0.5], [zn.x1 - 0.5, zn.z1 - 0.5]]
      .every(([x, z]) => c.inside(x, z, 1) && s._zombieHits(x, 0, z))
    if (document.getElementById('play-weapon-pick')?.style.display !== 'none') s._pickWeapon('rifle')
    s.wave = 6
    s._breakTimer = 999
    for (let i = 0; i < 60; i++) s._spawnZombie()
    let inCamp = 0
    for (let f = 0; f < 240; f++) {
      s.health = 100
      s.update(1 / 30)
      inCamp += s.zombies.filter((z) => c.inside(z.x, z.z)).length
    }
    out.inCamp = inCamp
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

  expect(r.faded).toBe(true)
  expect(r.camp).toBe(true)
  expect(r.startsInside).toBe(true)
  expect(r.npcs).toBe('ammo,quest,trader,upgrader')
  expect(r.wall).toBe(true)
  expect(r.farRows).toBe(true)
  expect(r.inCamp).toBe(0)
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
      // 100, + Vitality's 50.
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
  expect(r).toEqual({ slot: 'map3', shown: true, maps: 'map3', maxHealth: 150, mode: 'bossHunt', bossEvery: 3, glass: true, runs: 1, legacy: 40 })
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
      // Coming Soon guns (COMING_SOON_WEAPONS) are shown but can't be picked.
      cards: pick.querySelectorAll('[data-play-weapon]').length,
      soon: pick.querySelectorAll('.pwp-soon[disabled]').length,
      waitsForPick: s._picking === true,
    }
    // Nothing spawns while the picker is open.
    s.update(0.5)
    out.spawnedWhilePicking = s.zombies.length + s._toSpawn
    s._pickWeapon('minigun')
    out.soonRefused = s._picking === true
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
  expect(r).toEqual({ pickerShown: true, cards: 10, soon: 5, waitsForPick: true, spawnedWhilePicking: 0, soonRefused: true, pickerHidden: true, weapon: 'shotgun', ammo: [6, 42], gun: 'shotgun', saved: 'shotgun', shots: [true, false], damaged: true })
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

// Settings > Controls only lists what Map 1 uses, and changing a key there
// really changes it in the game (Try Map used to read W/A/S/D directly).
test('Settings > Controls keys drive walking in Map 1', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const result = await page.evaluate(async () => {
    const g = window.__game
    g._renderControlsGrid()
    const ids = [...g.controlsGrid.querySelectorAll('.control-key-btn')].map((b) => b.dataset.action)
    const rebind = (action, code) => {
      g.controlsGrid.querySelector(`[data-action="${action}"]`).click()
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
    }
    rebind('moveForward', 'KeyI')
    await g._enterBuildMode()
    const bm = g.buildMode
    bm.toggleTryMode()
    const speedWith = (code) => {
      bm._keys.clear()
      bm.tryMode.vel.set(0, 0, 0)
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
      for (let i = 0; i < 20; i++) bm.tryMode.update(0.05, bm._keys)
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
      return Math.hypot(bm.tryMode.vel.x, bm.tryMode.vel.z)
    }
    const withW = speedWith('KeyW')
    const withI = speedWith('KeyI')
    const withArrow = speedWith('ArrowUp')
    bm.toggleTryMode()
    g._exitBuildMode()
    rebind('moveForward', 'KeyW')
    return { ids, withW, withI, withArrow }
  })
  expect(result.ids).toEqual(['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'jump', 'sprint', 'crouch', 'reload', 'use', 'inspectWeapon', 'cycleMap', 'cameraView'])
  expect(result.withW).toBeLessThan(0.01)
  expect(result.withI).toBeGreaterThan(2)
  expect(result.withArrow).toBeGreaterThan(2)
})

// Windows crack and break in more than one way (2026-10-12): five crack
// pictures, four ways of shattering, several shard shapes.
test('windows crack and shatter in different ways', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const tm = bm.tryMode
    // Every crack picture is its own.
    const pics = new Set()
    for (let look = 0; look < 5; look++) {
      const img = tm._crackTexture(look).image
      pics.add(img.getContext('2d').getImageData(0, 0, 16, 16).data.join(','))
    }
    // Cracked windows with different looks are all drawn.
    for (let i = 0; i < 5; i++) {
      bm.placeBlock(i, 1, 4, 'glass')
      tm._cracked.set(bm._key(i, 1, 4), { x: i, y: 1, z: 4, look: i })
    }
    tm._rebuildCracks()
    const crackMeshes = tm._crackMeshes.length
    // Each way of shattering, by its shard count and sizes.
    const looks = new Map()
    for (let k = 0; k < 4; k++) {
      tm._clearShards()
      tm._spawnShards(0, 1, 4, 'glass', k)
      looks.set(tm._lastBreakLook, { n: tm._shards.length, shapes: new Set(tm._shards.map((s) => s.mesh.geometry.uuid)).size })
    }
    tm.forgetWindows()
    g._exitBuildMode()
    return { pics: pics.size, crackMeshes, looks: [...looks.entries()] }
  })
  expect(r.pics).toBe(5)
  expect(r.crackMeshes).toBe(5)
  expect(r.looks.map(([name]) => name).sort()).toEqual(['blast', 'burst', 'chunks', 'collapse'])
  expect(new Set(r.looks.map(([, v]) => v.n)).size).toBeGreaterThan(2)
  expect(r.looks.every(([, v]) => v.shapes >= 2)).toBe(true)
})

// Map 1's open world (OpenWorld.js): land grows around the city out of
// seeded noise (a new seed every game, shared on a server), the roads leave
// through open gates, nothing out there is saved, and every biome is
// somewhere out there.
test('Map 1 has an open world with biomes around it', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const w = b.world
    const out = { active: w.active, gates: w._paths.size > 0 }
    // Grow the land just outside the east gate.
    w.update([{ x: 90, z: 2 }])
    out.columns = w.columns.size
    const surface = (x, z) => {
      for (let y = 80; y > -40; y--) if (b._blocks.has(`${x},${y},${z}`)) return [y, b._blocks.get(`${x},${y},${z}`)]
      return null
    }
    out.landOutside = !!surface(90, 2)
    // A road leaves the city at each gate and carries on as a track.
    const gate = b._map3Base().map.gates.find((gt) => gt.x > 40)
    const tx = Math.floor(gate.x + 0.5 + gate.dx * 8)
    const tz = Math.floor(gate.z + 0.5 + gate.dz * 8)
    w.update([{ x: tx, z: tz }])
    // A frayed edge may keep the land's own top, so look across the track.
    out.trackOutside = [-2, -1, 0, 1, 2].some((w) => ['dirtpath', 'gravel', 'coarsedirt', 'spruceplanks'].includes(surface(tx + Math.round(gate.dz * w), tz - Math.round(gate.dx * w))?.[1]))
    // The city isn't a square any more (CityShape.js): its corners are
    // land, grown in the city's own chunk columns, and no land is ever
    // grown on a city cell.
    w.update([{ x: -60, z: -60 }])
    out.cornerIsLand = !b._map3Base().map.blocks.some((bl) => bl.x === -62 && bl.z === -62) && w.isTerrain(`-62,${surface(-62, -62)?.[0]},-62`)
    // (Cave walls under the city are terrain too - Underground.js - so only
    // the surface counts.)
    out.noLandInCity = ![...w.terrainKeys].some((k) => { const [x, y, z] = k.split(',').map(Number); return y >= -1 && x >= -64 && x < 64 && z >= -64 && z < 64 && b._map3Base().map.blocks.some((bl) => bl.x === x && bl.z === z) })
    out.cityIrregular = b._map3Base().map.blocks.every((bl) => bl.x > -64 && bl.x < 63 && bl.z > -64 && bl.z < 63)
    // The land is never saved...
    const snap = b._snapshot().blocks
    out.landNotSaved = !snap.some((k) => k.x > 70)
    // ...and neither is anything changed out there (the land is new next game).
    const [y] = surface(90, 2)
    b.removeBlock(90, y, 2)
    b.placeBlock(91, y + 1, 2, 'brick')
    const diff = b._map3Diff()
    out.outsideNotSaved = !diff.removed.some((k) => +k.split(',')[0] > 63) && !diff.placed.some((k) => k.x > 63)
    // The same seed grows the same land (everyone on a server), another one
    // different land, and the brick out there is gone with the old land.
    w.reseed(1234)
    w.update([{ x: 90, z: 2 }])
    const first = []
    for (let x = 66; x < 110; x += 5) first.push(JSON.stringify(surface(x, 9)))
    out.brickGone = b._blocks.get(`91,${y + 1},2`) !== 'brick'
    w.reseed(1234)
    w.update([{ x: 90, z: 2 }])
    const again = []
    for (let x = 66; x < 110; x += 5) again.push(JSON.stringify(surface(x, 9)))
    out.sameLand = first.join() === again.join()
    w.reseed(98765)
    w.update([{ x: 90, z: 2 }])
    const other = []
    for (let x = 66; x < 110; x += 5) other.push(JSON.stringify(surface(x, 9)))
    out.newLand = other.join() !== first.join()
    out.cityKept = !!surface(0, 0)
    // Far columns are dropped again once you leave.
    w.update([{ x: 1500, z: 1500 }])
    for (let i = 0; i < 30; i++) w.update([{ x: 1500, z: 1500 }])
    out.dropped = !w.columns.has('5,0')
    // The biome under you shows by the minimap.
    b.toggleTryMode()
    b.tryMode.pos.set(1500.5, 60, 1500.5)
    b.tryMode._mapDrawAt = 0
    b.tryMode._drawMap(performance.now() + 1e6, 1500.5, 1500.5)
    out.biomeShown = document.getElementById('build-try-biome')?.textContent || ''
    // You can walk out of the old 128x128 square.
    b.tryMode.update(0.016, new Set())
    out.notClamped = b.tryMode.pos.x > 100
    // The big map in the middle frees the mouse and can be dragged and zoomed.
    const tm = b.tryMode
    while (tm._mapEl.dataset.size !== 'center') tm.cycleMap()
    out.mapInteractive = tm._mapEl.classList.contains('interactive') && !!document.getElementById('build-try-map-hint').textContent
    const c = tm._mapCanvas
    const box = c.getBoundingClientRect()
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.left + 100, clientY: box.top + 100, bubbles: true, pointerId: 1 }))
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + 160, clientY: box.top + 100, bubbles: true, pointerId: 1 }))
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: box.left + 160, clientY: box.top + 100, bubbles: true, pointerId: 1 }))
    out.panned = tm._mapPan.x < 0
    tm._mapEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    out.zoomedOut = tm._mapZoom > tm._mapOpenZoom()
    tm._mapDrawAt = 0
    tm._drawMap(performance.now() + 2e6, 1500.5, 1500.5)
    tm.cycleMap()
    out.mapBack = !tm._mapEl.classList.contains('interactive') && tm._mapZoom === 1 && tm._mapPan.x === 0
    b.toggleTryMode()
    g._exitBuildMode()
    return out
  })

  expect(r.mapInteractive).toBe(true)
  expect(r.panned).toBe(true)
  expect(r.zoomedOut).toBe(true)
  expect(r.mapBack).toBe(true)
  expect(r.active).toBe(true)
  expect(r.gates).toBe(true)
  expect(r.columns).toBeGreaterThan(0)
  expect(r.landOutside).toBe(true)
  expect(r.trackOutside).toBe(true)
  expect(r.cornerIsLand).toBe(true)
  expect(r.noLandInCity).toBe(true)
  expect(r.cityIrregular).toBe(true)
  expect(r.landNotSaved).toBe(true)
  expect(r.outsideNotSaved).toBe(true)
  expect(r.brickGone).toBe(true)
  expect(r.sameLand).toBe(true)
  expect(r.newLand).toBe(true)
  expect(r.cityKept).toBe(true)
  expect(r.dropped).toBe(true)
  expect(r.biomeShown.length).toBeGreaterThan(0)
  expect(r.notClamped).toBe(true)

})

// Villages, castles and bridges out in the land (WorldStructures.js): they
// grow with the land around them, say their name under the minimap, and
// trees keep clear of them.
test('the open world has villages, castles and bridges', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const w = b.world
    const out = {}
    for (let seed = 1; seed < 40 && Object.keys(out).length < 4; seed++) {
      w.reseed(seed)
      for (const p of w.placesNear(0, 0, 500)) {
        if (out[p.kind]) continue
        const plan = w._plansOver(p.x, p.z, p.x, p.z).find((q) => q.kind === p.kind)
        w.update([{ x: p.x, z: p.z }])
        for (let i = 0; i < 40; i++) w.update([{ x: p.x, z: p.z }])
        // Every block of its column under the player is in the world.
        const list = plan.byColumn.get(`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`) || []
        let placed = 0
        for (let i = 0; i < list.length; i += 4) if (b._blocks.get(`${list[i]},${list[i + 1]},${list[i + 2]}`) === list[i + 3]) placed++
        out[p.kind] = { blocks: list.length / 4, placed, name: w.placeName(p.x, p.z), tree: w._claimed(p.x, p.z) }
      }
    }
    g._exitBuildMode()
    return out
  })
  expect(Object.keys(r).sort()).toEqual(['bridge', 'castle', 'pyramid', 'village'])
  for (const [kind, v] of Object.entries(r)) {
    expect(v.placed, kind).toBe(v.blocks)
    expect(v.name.length, kind).toBeGreaterThan(0)
    expect(v.tree, kind).toBe(true)
  }
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

// All 26 biomes are out there, within a long walk of the city.
test('Map 1 has 200 layers underground with ores, caves and walk-in entrances', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const w = b.world
    const u = w.under
    w.reseed(4242)
    const out = {}
    // A shaft dug straight down always has walls (the rock appears as
    // you dig), passes through different layers and ends on bedrock.
    const dig = (x, z) => {
      const types = new Set()
      let holes = 0
      let y = 60
      while (y > -1 && !b._blocks.has(`${x},${y},${z}`)) y--
      for (; y >= -205; y--) {
        // Fallen into a cave: its walls (and floor) grow around you.
        if (!b._blocks.has(`${x},${y},${z}`)) u._grow(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16))
        const type = b._blocks.get(`${x},${y},${z}`)
        if (!type) continue
        types.add(type)
        if (type === 'bedrock' && y <= -200) break
        b.removeBlock(x, y, z)
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${y},${z + dz}`
          if (!b._blocks.has(k)) holes++
          else types.add(b._blocks.get(k))
        }
      }
      return { types: [...types], holes, end: y }
    }
    w.update([{ x: 90, z: 2 }])
    const land = dig(90, 2)
    const city = dig(3, 5)
    const all = new Set([...land.types, ...city.types])
    out.endsOnBedrock = land.end === -200 && city.end === -200
    out.layers = ['stone', 'tuff', 'deepslate', 'smoothbasalt', 'blackstone', 'bedrock'].filter((t) => !all.has(t))
    out.ore = [...all].some((t) => /ore$/.test(t))
    // (A cave crossing the shaft is a real opening, not a hole.)
    out.fewHoles = land.holes + city.holes < 40
    // Nothing dug or revealed there is saved with the map.
    out.notSaved = !b._snapshot().blocks.some((bl) => bl.y < -3)
    // Caves: walls grow around you underground.
    for (let i = 0; i < 300; i++) w.update([{ x: 100, y: -60, z: 20 }])
    let walls = 0
    for (const rec of u.chunks.values()) walls += rec.keys.length
    out.caveWalls = walls > 0
    let open = 0
    for (let i = 0; i < 3000; i++) {
      const x = 80 + (i % 40)
      const y = -30 - ((i * 7) % 120)
      const z = (i * 13) % 60
      if (!u.implicitSolid(x, y, z, `${x},${y},${z}`)) open++
    }
    out.caves = open > 30
    // ...but never under the city's ground until well below it.
    let cityCut = 0
    for (let x = -30; x <= 30; x += 3) for (let z = -30; z <= 30; z += 3) for (let y = -15; y <= -2; y++) {
      if (u.bottomAt(x, z) === -1 && !u.implicitSolid(x, y, z, `${x},${y},${z}`) && !w.removed.has(`${x},${y},${z}`) && !(x === 3 && z === 5)) cityCut++
    }
    out.cityCut = cityCut
    // Entrances: a mouth open to the sky out in the land, away from the
    // city and every village, castle and bridge, sloping down into rock.
    const ents = []
    for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++) { const e = u._entrance(gx, gz); if (e) ents.push(e) }
    out.entrances = ents.length
    const e = ents[0]
    w.update([{ x: e.sx, z: e.sz }])
    out.mouthOpen = !b._blocks.has(`${e.sx},${e.sy - 1},${e.sz}`)
    out.awayFromPlaces = ents.every((en) => !w._plansOver(en.x0, en.z0, en.x1, en.z1).length && u.bottomAt(en.sx, en.sz) !== -1)
    const mx = Math.floor(e.sx + e.dx * 0.6)
    const my = Math.floor(e.sy + e.dy * 0.6)
    const mz = Math.floor(e.sz + e.dz * 0.6)
    w.update([{ x: mx, z: mz }])
    let floor = null
    for (let y = my; y > my - 5; y--) if (b._blocks.has(`${mx},${y},${mz}`)) { floor = y; break }
    out.tunnelHasFloor = floor !== null
    // The bar along the top: GayZ | mode | FPS | x y z.
    await new Promise((res) => setTimeout(res, 400))
    const bar = document.getElementById('top-bar')
    out.bar = bar && getComputedStyle(bar).display !== 'none' ? bar.innerText.replace(/\s+/g, ' ') : ''
    out.debugLineHidden = getComputedStyle(document.getElementById('fps-counter')).display === 'none'
    return out
  })
  expect(r.endsOnBedrock).toBe(true)
  expect(r.layers).toEqual([])
  expect(r.ore).toBe(true)
  expect(r.fewHoles).toBe(true)
  expect(r.notSaved).toBe(true)
  expect(r.caveWalls).toBe(true)
  expect(r.caves).toBe(true)
  expect(r.cityCut).toBe(0)
  expect(r.entrances).toBeGreaterThan(0)
  expect(r.mouthOpen).toBe(true)
  expect(r.awayFromPlaces).toBe(true)
  expect(r.tunnelHasFloor).toBe(true)
  expect(r.bar).toMatch(/^GayZ Map Editor FPS \S+ MS \S+ -?\d+\.\d\d -?\d+\.\d\d -?\d+\.\d\d( .+)?$/)
  expect(r.debugLineHidden).toBe(true)
})

test('every open world biome is within reach of Map 1', () => {
  const found = new Set()
  for (let r = 80; r < 2600; r += 8) {
    for (let a = 0; a < 360; a += 2) {
      found.add(sampleLand(Math.round(Math.cos((a * Math.PI) / 180) * r), Math.round(Math.sin((a * Math.PI) / 180) * r)).biome)
    }
  }
  expect([...found].sort()).toEqual(Object.keys(BIOMES).sort())
})

// Water you can get out of (2026-10-12): Space + walking into a ledge one
// block above the water springs you out; a body killed in the air drops to
// the ground.
test('you can climb out of water onto a ledge, and bodies drop to the ground', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const b = g.buildMode
    // A pool high in the air: stone floor, one block of water, a ledge two blocks high.
    for (let x = 36; x <= 46; x++) for (let z = 36; z <= 44; z++) b.placeBlock(x, 29, z, 'stone')
    for (let x = 36; x <= 41; x++) for (let z = 36; z <= 44; z++) b.placeBlock(x, 30, z, 'water')
    for (let x = 42; x <= 46; x++) for (let z = 36; z <= 44; z++) { b.placeBlock(x, 30, z, 'stone'); b.placeBlock(x, 31, z, 'stone') }
    b.liquids.update(0)
    b.toggleTryMode()
    const tm = b.tryMode
    tm.pos.set(39.5, 30, 40.5)
    tm.vel.set(0, 0, 0)
    b._yaw = -Math.PI / 2
    b._pitch = 0
    const keys = new Set(['KeyW', 'Space'])
    for (let i = 0; i < 100 && tm.pos.x < 43; i++) tm.update(1 / 60, keys)
    // Let go and land on the ledge.
    for (let i = 0; i < 60; i++) tm.update(1 / 60, new Set())
    const out = { x: tm.pos.x, y: tm.pos.y }
    b.toggleTryMode()
    // A body left in the air falls onto the stone.
    const s = b.survival
    const B = s.B
    const ground = s._groundUnder(44.5, 40, 40.5)
    const fake = { group: { rotation: { x: 0 }, position: { y: 40 * B } }, materials: [], arms: [], armFrom: [], t: 0, lift: 0, baseY: 40 * B, groundY: ground * B, vy: 0 }
    s._corpses = [fake]
    for (let i = 0; i < 120; i++) s._updateCorpses(1 / 60)
    out.ground = ground
    out.bodyY = fake.group.position.y / B
    g._exitBuildMode()
    return out
  })
  expect(r.x).toBeGreaterThan(42)
  expect(r.y).toBeGreaterThanOrEqual(31.99)
  expect(r.ground).toBe(32)
  expect(r.bodyY).toBeCloseTo(32, 1)
})

// One server connection per page: starting another game on a server leaves
// the first one, so it can't keep sending your spot under an old id (a copy
// of you following you around, 2026-10-12).
test('a new server game closes the old connection', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const left = []
    g.__serversBackendForTests = {
      sync: async () => ({ host: 'a', isHost: true, wave: 1, players: {}, skins: {}, zombies: {}, hurt: [], credits: [], hits: [] }),
      leave: async (auth) => { left.push(auth.playerId); return {} },
    }
    await g._enterBuildMode({ map: 'map3', play: true, server: { serverId: 'S1', playerId: 'a', token: 't', host: 'a', name: 'x' } })
    const first = g.buildMode.survival.net
    g._exitBuildMode()
    await g._enterBuildMode({ map: 'map3', play: true, server: { serverId: 'S1', playerId: 'b', token: 't', host: 'b', name: 'x' } })
    const second = g.buildMode.survival.net
    // Even a stray second connection made while one is open closes it.
    const Net = second.constructor
    const third = new Net(g, { serverId: 'S1', playerId: 'c', token: 't', host: 'c', name: 'x' })
    const out = { firstClosed: first.closed, secondClosed: second.closed, thirdOpen: !third.closed, left: left.join() }
    third.leave()
    g._exitBuildMode()
    return out
  })
  expect(r.firstClosed).toBe(true)
  expect(r.secondClosed).toBe(true)
  expect(r.thirdOpen).toBe(true)
  expect(r.left).toBe('a,b')
})

// The camera key (P) cycles first person -> third person behind -> in
// front, like bloxd.io; the camera only steps out for the drawing.
test('the camera key switches between first and third person', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.toggleTryMode()
    const tm = b.tryMode
    for (let i = 0; i < 40 && !tm._armSkin; i++) await new Promise((res) => setTimeout(res, 100))
    const out = { views: [] }
    const press = (code) => document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
    for (let i = 0; i < 3; i++) {
      press('KeyP')
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyP', bubbles: true }))
      b.update(0.016)
      const before = b.camera.position.clone()
      const restore = tm.applyView()
      const moved = b.camera.position.distanceTo(before)
      restore?.()
      out.views.push({ view: tm.view, bodyShown: !!tm._body?.group.visible, moved: moved > 0.05, back: b.camera.position.distanceTo(before) < 1e-6 })
    }
    // No aiming in third person.
    tm.cycleView()
    tm.setAim(true)
    out.aimInThird = tm.aiming
    b.toggleTryMode()
    g._exitBuildMode()
    return out
  })
  expect(r.views.map((v) => v.view)).toEqual([1, 2, 0])
  expect(r.views.map((v) => v.bodyShown)).toEqual([true, true, false])
  expect(r.views.map((v) => v.moved)).toEqual([true, true, false])
  expect(r.views.every((v) => v.back)).toBe(true)
  expect(r.aimInThird).toBe(false)
})

// 2026-10-17: block textures are clean, crisp pixel art like Kirka/bloxd
// (the blurry HD pass is gone): 16px tiles drawn with nearest filtering, and
// every painted face cut down to a few flat colours (cleanPixels).
test('block textures are clean and crisp', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(async () => { await window.__game._enterBuildMode({ map: 'map2' }) })
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
      const d = ctx.getImageData(x, y, 16, 16).data
      const seen = new Set()
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      colors[id] = seen.size
    }
    return { colors, crisp: chunks.atlas.magFilter === 1003, width: img.width }
  })
  expect(r.crisp).toBe(true)
  expect(r.width).toBe(2048)
  expect(Object.keys(r.colors).length).toBeGreaterThanOrEqual(5)
  for (const n of Object.values(r.colors)) expect(n).toBeLessThanOrEqual(4)
})

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

// 2026-10-17: right-click aims only while held, the zoom key zooms much
// further while playing, and holding fire on a block breaks it after its
// material's time (stone slower than wood); broken blocks come back.
test('hold right-click to aim, the zoom key zooms far, blocks break by material', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(async () => { localStorage.removeItem('gayz-play-saved-run'); await window.__game._enterBuildMode({ map: 'map3', play: true }) })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const tm = bm.tryMode
    const s = bm.survival
    if (document.getElementById('play-weapon-pick')?.style.display !== 'none') s._pickWeapon('rifle')
    s._toSpawn = 0
    s._breakTimer = 999
    const out = {}
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => bm.renderer.domElement })
    bm.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }))
    out.held = tm.aiming
    window.dispatchEvent(new PointerEvent('pointerup', { button: 2, bubbles: true }))
    out.released = tm.aiming
    delete document.pointerLockElement
    bm._keys.add('KeyV')
    for (let i = 0; i < 40; i++) tm.update(0.05, bm._keys)
    out.zoomFov = bm.camera.fov
    bm._keys.delete('KeyV')
    for (let i = 0; i < 40; i++) tm.update(0.05, bm._keys)
    out.backFov = bm.camera.fov
    out.times = Object.fromEntries(['oakplanks', 'stone', 'dirt', 'leaves', 'obsidian', 'oakslab', 'lootchest', 'water'].map((id) => [id, bm.breakSeconds(id)]))
    // Dig a plank and a stone block placed right in front of the eye.
    const B = tm.B
    const px = Math.floor(tm.pos.x)
    const py = Math.floor(tm.pos.y) + 2
    const pz = Math.floor(tm.pos.z)
    const dig = (type) => {
      bm.removeBlock(px, py, pz - 2)
      bm.placeBlock(px, py, pz - 2, type)
      bm.camera.rotation.set(0, 0, 0)
      bm._fireHeld = true
      let t = 0
      while (bm.getBlockAt(px, py, pz - 2) === type && t < 20) {
        bm.camera.position.set((px + 0.5) * B, (py + 0.5) * B, (pz + 0.5) * B)
        bm.camera.updateMatrixWorld()
        tm._updateDigging(0.05)
        t += 0.05
      }
      bm._fireHeld = false
      tm._updateDigging(0.05)
      return t
    }
    out.plank = dig('oakplanks')
    out.stone = dig('stone')
    out.brokenSaved = bm._snapshot().blocks.some((b) => b.x === px && b.y === py && b.z === pz - 2)
    bm.toggleTryMode()
    out.back = bm.getBlockAt(px, py, pz - 2)
    return out
  })
  expect(r.held).toBe(true)
  expect(r.released).toBe(false)
  expect(r.zoomFov).toBeLessThan(15)
  expect(r.backFov).toBeGreaterThan(60)
  expect(r.times.stone).toBeGreaterThan(r.times.oakplanks)
  expect(r.times.oakplanks).toBeGreaterThan(r.times.dirt)
  expect(r.times.dirt).toBeGreaterThan(r.times.leaves)
  expect(r.times.obsidian).toBeGreaterThan(r.times.stone)
  expect(r.times.oakslab).toBe(r.times.oakplanks)
  expect(r.times.lootchest).toBe(Infinity)
  expect(r.times.water).toBe(Infinity)
  expect(Math.abs(r.plank - r.times.oakplanks)).toBeLessThan(0.11)
  expect(Math.abs(r.stone - r.times.stone)).toBeLessThan(0.11)
  expect(r.brokenSaved).toBe(true)
  expect(r.back).toBe('stone')
})

// 2026-10-17: Escape while playing a game from the homepage opens the
// game's own pause menu (never the Map Editor's); Save Progress / Back to
// Menu keep the game and the next Play carries on from it; Leave Game ends
// it (counted) and drops the save.
test("Escape while playing opens the game's pause menu; saved games carry on", async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { localStorage.removeItem('gayz-play-saved-run'); window.__game.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  const a = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    s._pickWeapon('shotgun')
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }))
    const out = { stillPlaying: s.active && bm.tryMode.active }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    out.paused = bm.menuOpen
    out.game = getComputedStyle(document.getElementById('play-pause-menu')).display
    out.editor = getComputedStyle(document.getElementById('build-menu')).display
    document.getElementById('play-pause-settings-btn').click()
    out.settings = g.settingsOpen && document.getElementById('play-pause-menu').style.display === 'none'
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    out.backFromSettings = !g.settingsOpen && document.getElementById('play-pause-menu').style.display === 'flex'
    s.wave = 4
    s.kills = 23
    s.coins = 77
    s.upgrades = { damage: 2 }
    out.runs0 = g.careerStats.totalRuns
    document.getElementById('play-pause-save-btn').click()
    out.saveText = document.getElementById('play-pause-status').textContent
    document.getElementById('play-pause-back-btn').click()
    await new Promise((res) => setTimeout(res, 300))
    out.home = !bm.active
    out.counted = g.careerStats.totalRuns - out.runs0
    out.saved = !!localStorage.getItem('gayz-play-saved-run')
    return out
  })
  expect(a.stillPlaying).toBe(true)
  expect(a.paused).toBe(true)
  expect(a.game).toBe('flex')
  expect(a.editor).toBe('none')
  expect(a.settings).toBe(true)
  expect(a.backFromSettings).toBe(true)
  expect(a.saveText.length).toBeGreaterThan(0)
  expect(a.home).toBe(true)
  expect(a.counted).toBe(0)
  expect(a.saved).toBe(true)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  const b = await page.evaluate(async () => {
    const g = window.__game
    const s = g.buildMode.survival
    const out = { wave: s.wave, kills: s.kills, coins: s.coins, damage: s.upgrades.damage, weapon: s.weaponId, picking: !!s._picking }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    const runs0 = g.careerStats.totalRuns
    document.getElementById('play-pause-leave-btn').click()
    await new Promise((res) => setTimeout(res, 300))
    out.home = !g.buildMode.active
    out.counted = g.careerStats.totalRuns - runs0
    out.saved = !!localStorage.getItem('gayz-play-saved-run')
    return out
  })
  expect(b).toEqual({ wave: 3, kills: 23, coins: 77, damage: 2, weapon: 'shotgun', picking: false, home: true, counted: 1, saved: false })
})

// The gun's kick is a spring (BuildTryMode._kick/_updateKick): it eases back
// over a few frames and glides home instead of snapping, and a shot leaves
// a muzzle flash and smoke (GunFx.js). Zombies get brains
// (BuildSurvival._zombieBrain): rushers, flankers that curve out to a side
// (alternating sides), lungers that sprint when close.
test('smooth gun kick with flash and smoke; zombies get brains', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const tm = bm.tryMode
    if (document.getElementById('play-weapon-pick')?.style.display !== 'none') s._pickWeapon('rifle')
    const out = {}
    tm._recoil = 0
    tm._kickVel = 0
    s._nextShotAt = 0
    tm.fire()
    const curve = []
    for (let i = 0; i < 30; i++) {
      tm._updateKick(1 / 60)
      curve.push(tm._recoil)
    }
    const peak = curve.indexOf(Math.max(...curve))
    out.eases = curve[0] < curve[peak] && peak >= 2
    out.home = Math.abs(curve[29]) < 0.05
    out.muzzle = !!tm._muzzle && !!tm._fx && tm._fx.flash.visible
    tm._fx.update(0.1)
    out.smoke = tm._fx._smoke.some((p) => p.visible)
    tm._fx.update(1)
    out.smokeGone = tm._fx._smoke.every((p) => !p.visible) && !tm._fx.flash.visible
    // Brains: every zombie gets a role, sides alternate, far flankers curve.
    const player = { x: 12, y: 0, z: 0 }
    const zombies = Array.from({ length: 30 }, () => ({ x: 0, y: 0, z: 0 }))
    for (const zb of zombies) s._zombieBrain(zb, 0.5, player)
    const roles = new Set(zombies.map((z) => z.role))
    out.roles = ['rusher', 'flanker', 'lunger'].filter((k) => roles.has(k)).length >= 2
    out.sides = new Set(zombies.map((z) => z.side)).size === 2
    out.flankersCurve = zombies.filter((z) => z.role === 'flanker').every((z) => z.flank > 0) && roles.has('flanker')
    out.rushersStraight = zombies.filter((z) => z.role === 'rusher').every((z) => z.flank === 0)
    return out
  })
  expect(r).toEqual({ eases: true, home: true, muzzle: true, smoke: true, smokeGone: true, roles: true, sides: true, flankersCurve: true, rushersStraight: true })
})

// 2026-10-17: the pause menu's Switch Weapon (each gun keeps its own ammo)
// and the special guns' powers - Crossbow/AWP go through zombies, the
// Tomahawk hits several, the Flamethrower sets them burning (and burning
// hurts), the Void Ripper slows them, and launchers explode with a
// fireball.
test('Switch Weapon in the pause menu and the special guns\' powers', async ({ page }) => {
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
    s.mag = 7
    bm.toggleMenu()
    document.getElementById('play-pause-weapon-btn').click()
    const pick = document.getElementById('play-weapon-pick')
    out.picker = [getComputedStyle(pick).display !== 'none', bm.menuOpen, s._picking]
    s._pickWeapon('flamethrower')
    out.flame = [s.weaponId, s.mag, bm.tryMode._gunId]
    bm.toggleMenu()
    document.getElementById('play-pause-weapon-btn').click()
    s._pickWeapon('rifle')
    out.rifleKept = s.mag
    // Fake zombies in a line straight ahead.
    const B = s.B
    const cam = bm.camera
    bm._pitch = 0
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    dir.y = 0
    dir.normalize()
    const mk = (dist, side = 0) => ({ x: cam.position.x / B + dir.x * dist - dir.z * side, y: cam.position.y / B - 1.4, z: cam.position.z / B + dir.z * dist + dir.x * side, size: 1, health: 100000, vx: 0, vz: 0 })
    const shot = (weapon, fakes) => {
      s.weaponId = weapon
      s.mag = s.magSize()
      s._nextShotAt = 0
      const real = s.zombies
      s.zombies = fakes
      cam.updateMatrixWorld()
      s.shoot()
      s.zombies = real
      return fakes.map((f) => (f.health < 100000 ? 1 : 0)).join('')
    }
    out.rifle = shot('rifle', [mk(3), mk(4), mk(5)])
    out.crossbow = shot('crossbow', [mk(3), mk(4), mk(5), mk(6)])
    out.awp = shot('awp', [mk(3), mk(4), mk(5), mk(6), mk(7)])
    out.tomahawk = shot('tomahawk', [mk(1.5), mk(1.8, 0.6), mk(2, -0.6), mk(2.2, 0.3)])
    const burning = mk(3)
    shot('flamethrower', [burning])
    out.burn = burning.burn
    const slowed = mk(3)
    shot('voidripper', [slowed])
    out.slow = slowed.slow
    const fx = () => s._fx._sprites.filter((p) => p.userData.t < p.userData.life).length
    s._fx.clear()
    shot('launcher', [mk(5)])
    out.fireball = fx() > 0
    s.weaponId = 'rifle'
    s.mag = s.magSize()
    return out
  })
  expect(r).toEqual({
    picker: [true, false, true], flame: ['flamethrower', 100, 'flamethrower'], rifleKept: 7,
    rifle: '100', crossbow: '1110', awp: '11110', tomahawk: '1110', burn: 3, slow: 2, fireball: true,
  })
})

// 2026-10-17 (second batch): Spectate from the pause screen freezes the
// game and gives back the camera; the Flamethrower shows fuel and sets
// wood on fire, which spreads and burns away (and comes back after the
// game); games run the day-night cycle with sun, moon and clouds.
test('Spectate, fuel, burning wood and the day-night sky', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('flamethrower'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    out.sky = [bm.sky.time, bm.sky.weather, bm.sky.bodies.clouds.visible]
    out.fuel = !!document.querySelector('#build-play-ammo .fuel-bar')
    // Spectate: frozen, camera free, Escape (toggleMenu) comes back.
    const before = bm.camera.position.clone()
    bm.toggleMenu()
    document.getElementById('play-pause-spectate-btn').click()
    out.spectating = [bm.spectate.active, s.spectating, bm.menuOpen]
    // The game keeps going while spectating and nothing can hurt you.
    const hp = s.health
    s._hurtPlayer(50)
    out.noHurt = s.health === hp
    bm._keys.add('KeyW')
    for (let i = 0; i < 20; i++) bm.update(1 / 30)
    bm._keys.delete('KeyW')
    out.flew = bm.camera.position.distanceTo(before) > 1
    bm.toggleMenu()
    out.back = [bm.spectate.active, s.spectating, bm.menuOpen, bm.camera.position.distanceTo(before) < 0.01]
    bm.toggleMenu()
    // Burning wood: a plank wall next to a plank, set alight, burns away.
    const p = bm.tryMode.pos
    const x = Math.floor(p.x) + 3
    const y = Math.floor(p.y) + 5
    const z = Math.floor(p.z)
    bm.placeBlock(x, y, z, 'oakplanks', false)
    bm.placeBlock(x + 1, y, z, 'oakplanks', false)
    bm.placeBlock(x, y + 1, z, 'stone', false)
    out.lit = s.ignite(x, y, z)
    out.stoneLit = s.ignite(x, y + 1, z)
    for (let i = 0; i < 400; i++) s._updateFires(1 / 30)
    out.burnt = bm.getBlockAt(x, y, z) === null || bm.getBlockAt(x, y, z) === undefined
    out.stoneStays = bm.getBlockAt(x, y + 1, z) === 'stone'
    out.restorable = bm.tryMode.brokenWindows().some((b) => b.x === x && b.y === y && b.z === z)
    return out
  })
  expect(r).toEqual({
    sky: ['cycle', 'random', true], fuel: true, spectating: [true, true, false], noHurt: true, flew: true,
    back: [false, false, true, true], lit: true, stoneLit: false, burnt: true, stoneStays: true, restorable: true,
  })
})

// 2026-10-17 (third batch): the spawn map before a solo game (a real
// Earth place picks the biome you start in), no world edge, pyramids in
// deserts, underground cities, and ms + the graphics chip in the top bar.
test('spawn map, endless world, pyramids, underground cities and the top bar', async ({ page }) => {
  // The pure parts, straight from the source.
  const { earthBiome, findSpawn } = await import('../src/game/SpawnMap.js')
  expect([earthBiome(23, 10), earthBiome(-3, -60), earthBiome(-80, 0), earthBiome(0, -140)]).toEqual(['desert', 'jungle', 'snowyPlains', 'deepOcean'])
  expect(['desert', 'badlands', 'savanna']).toContain(findSpawn(23, 10, 'desert')?.biome)
  const { WORLD_LIMIT } = await import('../src/game/OpenWorld.js')
  expect(WORLD_LIMIT).toBe(Infinity)
  const { citiesOver, cityCell } = await import('../src/game/UnderCity.js')
  const c = citiesOver(-2000, -2000, 2000, 2000)[0]
  expect(!!c).toBe(true)
  expect(cityCell(c, c.x, c.floor + 9, c.z)).toBe('sealantern')
  expect(cityCell(c, c.x + 1, c.floor + 4, c.z + 4)).toBe(null)

  await gotoAndWaitForGame(page)
  // The spawn map is the World Map game mode's (2026-10-18).
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap' })
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    const map = document.getElementById('spawn-map')
    out.mapFirst = [getComputedStyle(map).display, s._picking]
    out.spawned = s._spawnAt({ lat: 23, lon: 10, biome: 'desert' })
    const p = bm.tryMode.pos
    out.standsOnLand = !!bm.getBlockAt(Math.floor(p.x), Math.round(p.y) - 1, Math.floor(p.z))
    // Choosing the weapon closes the map (as the camp if nothing was picked).
    s._pickWeapon('rifle')
    out.mapClosed = getComputedStyle(map).display === 'none' && !s._picking
    // M twice: the big map in the middle opens as the block map and stays
    // it zoomed in (2026-10-23; zooming out to the atlas and globe is in
    // the real-land test at the end).
    const tm = bm.tryMode
    tm.cycleMap()
    tm.cycleMap()
    tm._drawMap(performance.now() + 1000)
    const atlas = tm._mapEl.classList.contains('atlas')
    for (let i = 0; i < 20; i++) tm.zoomMap(0.7)
    tm._drawMap(performance.now() + 2000)
    out.atlas = [atlas, tm._mapEl.classList.contains('atlas')]
    tm.cycleMap()
    // A pyramid somewhere in the deserts.
    let pyramid = null
    for (let gx = -60; gx < 60 && !pyramid; gx++) for (let gz = -60; gz < 60 && !pyramid; gz++) {
      const pl = bm.world._plan(gx, gz)
      if (pl?.kind === 'pyramid') pyramid = pl
    }
    out.pyramid = !!pyramid && [...pyramid.top.values()].some((t) => t.type === 'gold')
    out.topBar = ['top-bar-fps', 'top-bar-ms', 'top-bar-chip'].every((id) => !!document.getElementById(id))
    out.credits = !document.getElementById('credits-weapons-list') && !document.querySelector('.credits-tab')
    return out
  })
  expect(r).toEqual({ mapFirst: ['block', true], spawned: true, standsOnLand: true, mapClosed: true, atlas: [false, false], pyramid: true, topBar: true, credits: true })
})

// 2026-10-18: countries and landmarks on the spawn map, Spawn Randomly,
// waves that need a number of kills with zombies from anywhere, bodies
// that fade in a minute (or burn away), and fire that goes out in water
// and rain but races through trees.
test('countries, landmarks, kill-count waves, fading bodies and fire rules', async ({ page }) => {
  const { earthCountry, randomLandPick } = await import('../src/game/SpawnMap.js')
  expect([earthCountry(48.8, 2.3), earthCountry(40.7, -100), earthCountry(-23, 135), earthCountry(0, -140)]).toEqual(['France', 'United States of America', 'Australia', ''])
  const rp = randomLandPick()
  expect(['ocean', 'deepOcean', 'frozenOcean', 'warmOcean']).not.toContain(rp.biome)

  await gotoAndWaitForGame(page)
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap' })
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const first = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    out.randomBtn = !!document.getElementById('spawn-map-random')
    // France: spawning builds the Eiffel Tower ahead.
    out.spawned = s._spawnAt({ lat: 48.8, lon: 2.3, biome: 'forest', country: 'France' })
    out.landmark = bm.world._landmarks.length === 1 && bm.world._landmarks[0].nameKey === 'landmarkEiffel'
    s._pickWeapon('rifle')
    return out
  })
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate((out) => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    // A wave needs kills, not an empty map: zombies stay, kills count down.
    s._breakTimer = 0
    s._startWave(1)
    const need = s._toSpawn
    const pp = bm.tryMode.pos
    for (let i = 0; i < 5; i++) s._makeZombie(++s._zid, pp.x + 3 + i, pp.y, pp.z + 3, 100, false)
    const z = s.zombies[0]
    s.damageZombie(z, 1e9)
    out.wave = [need >= 9, s._toSpawn === need - 1, s.zombies.length >= 4]
    // Bodies: still there after 30 s, gone after a minute; burning ones go fast.
    const c = s._corpses?.[s._corpses.length - 1]
    s._updateCorpses(30)
    out.corpse30 = s._corpses.includes(c)
    s._updateCorpses(31)
    out.corpse61 = !s._corpses.includes(c)
    s.damageZombie(s.zombies[0], 1e9)
    const c2 = s._corpses[s._corpses.length - 1]
    c2.burnLeft = 3
    s._updateCorpses(1)
    s._updateCorpses(2.5)
    out.burntBody = !s._corpses.includes(c2)
    // Fire: leaves burn, water stops it, rain on open sky stops it.
    const p = bm.tryMode.pos
    const x = Math.floor(p.x) + 4
    const y = Math.floor(p.y) + 8
    const zz = Math.floor(p.z)
    bm.placeBlock(x, y, zz, 'leaves', false)
    bm.placeBlock(x + 3, y, zz, 'oakplanks', false)
    bm.placeBlock(x + 4, y, zz, 'water', false)
    bm.sky._now = 'clear'
    out.leavesLit = s.ignite(x, y, zz)
    out.wetNotLit = s.ignite(x + 3, y, zz) === false
    bm.sky._now = 'hardRain'
    for (let i = 0; i < 20; i++) s._updateFires(0.1)
    out.rainedOut = !s._fires.has(`${x},${y},${zz}`) && bm.getBlockAt(x, y, zz) === 'leaves'
    bm.sky._now = 'clear'
    return out
  }, first)
  expect(r).toEqual({ randomBtn: true, spawned: true, landmark: true, wave: [true, true, true], corpse30: true, corpse61: true, burntBody: true, leavesLit: true, wetNotLit: true, rainedOut: true })
})

// 2026-10-18 (second batch): the game's inventory (Tab), the Map Editor's
// half-and-half Tab panel, real-city towns, and zombies lost far away or
// falling out of the world no longer count as kills.
test('inventory, editor block storage, city towns and lost zombies', async ({ page }) => {
  const { cityNear } = await import('../src/game/Towns.js')
  expect(cityNear(48.9, 2.4)?.name).toBe('Paris')
  expect(cityNear(0, -140)).toBe(null)

  await gotoAndWaitForGame(page)
  const editor = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    g.buildMode.togglePicker()
    const out = { split: document.getElementById('build-picker').classList.contains('split'), store: document.querySelectorAll('#build-picker .bp-store .bp-slot').length, hotbar: document.querySelectorAll('#build-picker .bp-hotbar .bp-slot').length }
    g.buildMode.togglePicker()
    g._exitBuildMode()
    return out
  })
  expect(editor).toEqual({ split: true, store: 100, hotbar: 10 })

  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const first = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const out = {}
    out.town = s._spawnAt({ lat: 40.7, lon: -74, biome: 'plains', country: 'United States of America', city: 'New York' })
    out.townPlan = window.__game.buildMode.world._landmarks.some((p) => p.kind === 'town' && p.placeName === 'New York')
    s._pickWeapon('rifle')
    return out
  })
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate((out) => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const inv = s.inv
    // Starting kit: just the picked gun in slot 1 (no other guns, no health pack).
    out.kit = [inv.hotbar[0]?.id, inv.grid.filter(Boolean).length + inv.hotbar.filter(Boolean).length]
    // Tab opens the inventory panel with 100 + 10 + 5 slots.
    bm.togglePicker()
    out.panel = [document.querySelectorAll('#play-inventory .inv-grid .inv-slot').length, document.querySelectorAll('#play-inventory .inv-hotbar .inv-slot').length, document.querySelectorAll('#play-inventory .inv-armor .inv-slot').length]
    bm.togglePicker()
    // A broken block pops out and is picked up when you're near; a held
    // block is placed and the stack drops.
    const pp = bm.tryMode.pos
    s.onBlockMined('oakplanks', Math.floor(pp.x), Math.floor(pp.y), Math.floor(pp.z))
    out.dropped = s._drops.list.length === 1
    for (let i = 0; i < 40; i++) s._drops.update(1 / 20)
    out.pickedUp = s._drops.list.length === 0
    const slot = inv.hotbar.findIndex((it) => it?.id === 'oakplanks')
    inv.select(slot)
    out.holding = s.holding?.id
    // Look down at the ground nearby (a few directions, in case something
    // is in the way) and place it.
    let placed = false
    for (const yaw of [0, 1.6, 3.2, 4.7]) {
      for (const pitch of [-1.3, -0.9, -0.6]) {
        if (placed) break
        bm._yaw = yaw
        bm._pitch = pitch
        for (let i = 0; i < 3; i++) bm.update(1 / 30)
        placed = s.placeHeldBlock()
      }
    }
    out.placed = placed && !inv.hotbar[slot]
    // Armor in its slot cuts damage.
    inv.add({ kind: 'item', id: 'chestplate', n: 1 })
    const ci = inv.hotbar.findIndex((it) => it?.id === 'chestplate')
    out.wrongSlot = inv.moveItem('hotbar', ci, 'armor', 0) === false
    inv.moveItem('hotbar', ci, 'armor', 1)
    out.cut = +inv.damageCut().toFixed(2)
    // Saved and restored.
    const saved = JSON.parse(JSON.stringify(inv.serialize()))
    inv.reset('pistol')
    inv.restore(saved)
    out.restored = inv.armor[1]?.id
    // A zombie that falls out of the world isn't a kill.
    inv.select(0)
    const kills = s.kills
    const left = s._toSpawn = 5
    const p = bm.tryMode.pos
    s._makeZombie(++s._zid, p.x + 3, p.y, p.z, 100, false)
    const z = s.zombies[s.zombies.length - 1]
    z.lost = true
    s.damageZombie(z, 1e9)
    out.lost = [s.kills === kills, s._toSpawn === left, !s.zombies.includes(z)]
    return out
  }, first)
  expect(r).toEqual({ town: true, townPlan: true, kit: ['rifle', 1], panel: [100, 10, 5], dropped: true, pickedUp: true, holding: 'oakplanks', placed: true, wrongSlot: true, cut: 0.16, restored: 'chestplate', lost: [true, true, true] })
})

// 2026-10-18 (third batch): World Map is its own game mode - the land
// follows the real Earth and the map only shows there; Classic starts in
// the camp with no map; towns aren't square.
test('World Map mode follows the real Earth; Classic skips the map', async ({ page }) => {
  const { setEarthWorld, sampleLand } = await import('../src/game/OpenWorld.js')
  setEarthWorld(true)
  const sea = (lat, lon) => sampleLand(Math.round(lon * 120), Math.round(-lat * 120)).h < -4
  // Mid-Atlantic and mid-Pacific are sea; inland Africa, Brazil, Siberia are land.
  expect([sea(30, -40), sea(0, -150), sea(10, 20), sea(-10, -55), sea(62, 100)]).toEqual([true, true, false, false, false])
  expect(['desert', 'badlands', 'savanna']).toContain(sampleLand(Math.round(25 * 120), Math.round(-23 * 120)).biome)
  setEarthWorld(false)

  await gotoAndWaitForGame(page)
  const classic = await page.evaluate(async () => {
    const g = window.__game
    g.settings.selectedGameMode = 'classic'
    g.playBtn.click()
    for (let i = 0; i < 300 && !g.buildMode?.survival?.active; i++) await new Promise((r) => setTimeout(r, 200))
    const out = { map: document.getElementById('spawn-map')?.style.display === 'block', picker: document.getElementById('play-weapon-pick')?.style.display === 'flex' }
    g.buildMode.survival._pickWeapon('rifle')
    g.buildMode.survival.stop()
    g._exitBuildMode()
    return out
  })
  expect(classic).toEqual({ map: false, picker: true })
  await page.waitForTimeout(1000)
  const world = await page.evaluate(async () => {
    const g = window.__game
    g.settings.selectedGameMode = 'worldMap'
    g.playBtn.click()
    for (let i = 0; i < 300 && !g.buildMode?.survival?.active; i++) await new Promise((r) => setTimeout(r, 200))
    const s = g.buildMode.survival
    const out = { map: document.getElementById('spawn-map')?.style.display === 'block', camp: !!document.getElementById('spawn-map-camp'), mode: s.cfg.mode }
    s._spawnAt({ lat: 48.85, lon: 2.35, biome: 'forest', country: 'France', city: 'Paris' })
    const town = g.buildMode.world._landmarks.find((p) => p.kind === 'town')
    // Not a square: the corners of its box are empty.
    out.notSquare = !!town && ![...town.top.keys()].some((k) => { const [x, z] = k.split(',').map(Number); return x <= town.x0 + 2 && z <= town.z0 + 2 })
    s._pickWeapon('rifle')
    return out
  })
  expect(world).toEqual({ map: true, camp: false, mode: 'worldMap', notSquare: true })
})

// 2026-10-18: spectating, zombies go for where you left (not the camera),
// game keys still work, the camera stops on a bedrock floor at the bottom;
// the Knife thrown while aiming flies and hits; the inventory shows one
// picture while dragging and only the chosen hotbar slot has a dark box.
test('Spectate keeps zombies off the camera, bedrock floor, thrown knife, inventory drag', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const B = s.B
    const out = {}
    const start = bm.tryMode.pos.clone()
    bm.toggleMenu()
    document.getElementById('play-pause-spectate-btn').click()
    bm._keys.add('KeyW')
    bm._keys.add('Space')
    for (let i = 0; i < 30; i++) bm.update(1 / 30)
    bm._keys.clear()
    const me = s._targets()[0]
    out.targetStays = Math.hypot(me.x - start.x, me.y - start.y, me.z - start.z) < 0.01
    out.cameraMoved = bm.tryMode.pos.distanceTo(start) > 3
    // Reload works while flying.
    s.mag = 1
    bm._onKeyDown({ code: 'KeyR', repeat: false, target: document.body, preventDefault() {} })
    out.reloading = s._reloadLeft > 0
    s._reloadLeft = 0
    // Down to the bottom: stops on the bedrock floor.
    bm.camera.position.y = -400 * B
    bm.update(1 / 30)
    const floor = bm.scene.getObjectByName('spectate-bedrock-floor')
    out.floor = [!!floor?.visible, bm.camera.position.y / B > -200, bm.camera.position.y / B < -199]
    bm.toggleMenu()
    out.floorHidden = !floor.visible
    bm.toggleMenu()
    // Thrown knife: aim, click, it flies and hits a zombie ahead.
    s.weaponId = 'melee'
    s._nextShotAt = 0
    bm._pitch = 0
    bm.update(1 / 60)
    const cam = bm.camera
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    const fake = { x: cam.position.x / B + dir.x * 4, y: cam.position.y / B - 1.4, z: cam.position.z / B + dir.z * 4, size: 1, health: 1000 }
    const real = s.zombies
    const realDamage = s.damageZombie
    s.zombies = [fake]
    s.damageZombie = (z, a) => { z.health -= a }
    bm.tryMode.aiming = true
    bm.tryMode.fire()
    out.thrown = s.throws.list.length
    out.handEmpty = bm.tryMode._gun ? !bm.tryMode._gun.visible : true
    for (let i = 0; i < 30; i++) s.throws.update(1 / 60)
    out.hit = fake.health < 1000
    s.zombies = real
    s.damageZombie = realDamage
    bm.tryMode.aiming = false
    // Inventory: drag hides the picture in the slot it left.
    s.inv.hotbar[0] = { kind: 'gun', id: 'rifle', n: 1 }
    s.inv.select(1)
    bm.togglePicker()
    const slot = document.querySelector('#play-inventory .inv-hotbar .inv-slot[data-i="0"]')
    const rect = slot.getBoundingClientRect()
    slot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5 }))
    out.oneImage = [document.querySelectorAll('.inv-ghost').length, getComputedStyle(slot.querySelector('img')).visibility]
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 0 }))
    const head = document.querySelector('#play-inventory .inv-head b').getBoundingClientRect()
    const box = document.querySelector('#play-inventory .inv-box').getBoundingClientRect()
    out.titleCentered = Math.abs(head.x + head.width / 2 - (box.x + box.width / 2)) < 4
    bm.togglePicker()
    const slots = [...document.querySelectorAll('#build-hotbar .build-hotbar-slot')]
    out.hotbarBoxes = slots.map((el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' ? 1 : 0).join('')
    out.barBg = getComputedStyle(document.getElementById('build-hotbar')).backgroundColor
    return out
  })
  expect(r).toEqual({
    targetStays: true, cameraMoved: true, reloading: true, floor: [true, true, true], floorHidden: true,
    thrown: 1, handEmpty: true, hit: true, oneImage: [1, 'hidden'], titleCentered: true,
    hotbarBoxes: '0000000000', barBg: 'rgba(0, 0, 0, 0)',
  })
})

// 2026-10-18 (second batch): bridges stand clear of the water, so a
// player fits under them.
test('bridges are high enough over the water to walk under', async () => {
  const { sampleLand, hash2, SEA, cityDistance, setWorldSeed, setEarthWorld } = await import('../src/game/OpenWorld.js')
  const { planStructure } = await import('../src/game/WorldStructures.js')
  setEarthWorld(false)
  let bridges = 0
  let low = 0
  for (const seed of [11, 222, 3333]) {
    setWorldSeed(seed)
    for (let gx = -6; gx <= 6; gx++) {
      for (let gz = -6; gz <= 6; gz++) {
        const plan = planStructure(gx, gz, { land: sampleLand, hash: hash2, sea: SEA, cityDistance, chunk: 16 })
        if (!plan || plan.kind !== 'bridge') continue
        bridges++
        // Over water, every block of the bridge is either a whole pier
        // column (down to the bed) or 3+ blocks above the water.
        const cols = new Map()
        for (const list of plan.byColumn.values()) {
          for (let i = 0; i < list.length; i += 4) {
            const k = `${list[i]},${list[i + 2]}`
            if (!cols.has(k)) cols.set(k, [])
            cols.get(k).push(list[i + 1])
          }
        }
        for (const [k, ys] of cols) {
          const [x, z] = k.split(',').map(Number)
          const bed = sampleLand(x, z).h
          if (bed >= SEA) continue
          const pier = ys.includes(bed + 1)
          if (!pier && Math.min(...ys) <= SEA + 3) low++
        }
      }
    }
  }
  expect(bridges).toBeGreaterThan(0)
  expect(low).toBe(0)
})

// 2026-10-18 (second batch): animals wander, die to shots and drop meat
// that heals, can be tamed with Use and then follow you; a block from the
// inventory shows in your hand; the top bar shows the weather and time;
// spectating has no banner; the What's New card reaches the profile card's
// bottom and fades when you click elsewhere.
test('animals, held blocks, sky top bar, no spectate banner, What\'s New card', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await gotoAndWaitForGame(page)
  const card = await page.evaluate(() => {
    const g = window.__game
    const banner = g.updateAvailableBanner
    g.updateAvailableChangelog.innerHTML = document.querySelector('#changelog-list .changelog-entry').outerHTML
    banner.classList.remove('fading')
    banner.style.display = 'flex'
    g._scheduleUpdateBannerFade()
    window.dispatchEvent(new Event('resize'))
    const b = banner.getBoundingClientRect()
    const p = document.getElementById('menu-player-badge').getBoundingClientRect()
    const out = { reaches: Math.abs(b.bottom - p.bottom) < 2 }
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.fading = banner.classList.contains('fading')
    return out
  })
  expect(card).toEqual({ reaches: true, fading: true })
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const B = s.B
    const out = {}
    const A = s.animals
    // Natural spawning around you.
    for (let i = 0; i < 40; i++) A.update(0.5)
    out.spawned = A.list.length > 0
    // Each animal only in a biome that fits it (2026-10-23): no cows in the
    // snow, polar bears in the snow, camels in the desert, none at sea.
    const T = A.constructor.BIOME_ANIMALS
    out.snow = Object.keys(T.snowyPlains).sort()
    out.desert = Object.keys(T.desert).sort()
    // Since 2026-10-24 the sea has its own animals, and all of them swim.
    out.sea = Object.keys(T.ocean).length > 0 && Object.keys(T.ocean).every((k) => A.constructor.KINDS[k].swim)
    out.allBuilt = Object.values(T).every((t) => Object.keys(t).every((k) => A.constructor.KINDS[k]))
    out.cowsOnlyWarm = Object.entries(T).filter(([, t]) => t.cow).map(([b]) => b).sort()
    // One right in front of you: shot, it dies and drops meat.
    A.clear()
    bm._pitch = -0.25
    bm.update(1 / 60)
    const cam = bm.camera
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    const tp = bm.tryMode.pos
    const ax = tp.x + dir.x * 3
    const az = tp.z + dir.z * 3
    const cow = A.spawn('cow', ax, s._groundUnder(ax, tp.y + 2, az), az)
    const start = [cow.x, cow.z]
    for (let i = 0; i < 60; i++) A._step(cow, 1 / 30, s.bodyPos())
    out.stillHere = Math.hypot(cow.x - start[0], cow.z - start[1]) < 6
    // Taming: Use on it.
    cow.x = ax
    cow.z = az
    cow.group.position.set(ax * B, cow.y * B, az * B)
    cow.group.updateMatrixWorld()
    out.tamed = A.use() && cow.tamed && cow.collar.visible
    // A pet isn't hurt by your shots and follows you.
    A.damage(cow, 999)
    out.petSafe = !cow.dying
    cow.x += 12
    for (let i = 0; i < 120; i++) A._step(cow, 1 / 30, s.bodyPos())
    out.follows = Math.hypot(cow.x - s.bodyPos().x, cow.z - s.bodyPos().z) < 6
    // A wild pig shot dies and drops meat.
    const pig = A.spawn('pig', ax, cow.y, az)
    const before = s._drops.list.length
    A.damage(pig, 999)
    out.meat = s._drops.list.filter((d) => d.kind === 'item' && d.type === 'meat').length - before >= 1
    // Picked up and eaten: heals.
    s.inv.add({ kind: 'item', id: 'meat', n: 1 })
    const slot = s.inv.hotbar.findIndex((it) => it?.id === 'meat')
    s.inv.select(slot)
    s.health = 50
    s.inv.useHeld()
    out.healed = s.health === 75
    // A block from the inventory is drawn in the hand.
    s.inv.hotbar[5] = { kind: 'block', id: 'leaves', n: 3 }
    s.inv.select(5)
    bm.render()
    out.handBlock = bm.tryMode._handType === 'leaves'
    // The top bar: weather and time.
    window.__game._topBar.update(performance.now() + 1000)
    out.weather = document.getElementById('top-bar-weather').textContent.length > 2
    out.time = /\d/.test(document.getElementById('top-bar-time').textContent)
    out.nightVar = document.getElementById('top-bar').style.getPropertyValue('--tb-night') !== ''
    // Spectating: no banner.
    s.inv.select(0)
    bm.toggleMenu()
    document.getElementById('play-pause-spectate-btn').click()
    out.noBanner = !document.getElementById('play-spectate-bar')
    bm.toggleMenu()
    return out
  })
  expect(r).toEqual({ spawned: true, snow: ['arcticFox', 'muskox', 'polarBear', 'reindeer', 'snowyOwl'], desert: ['armadillo', 'camel', 'coyote', 'gecko', 'lizard', 'scorpion', 'snake'], sea: true, allBuilt: true, cowsOnlyWarm: ['city', 'mushroomFields', 'plains'], stillHere: true, tamed: true, petSafe: true, follows: true, meat: true, healed: true, handBlock: true, weather: true, time: true, nightVar: true, noBanner: true })
})

// The spawn map's countries -> states/provinces -> cities (2026-10-18):
// Canada shows its provinces and territories, Ontario its cities, and
// Spawn Here starts you in the picked city's town.
test('the spawn map goes from a country to its provinces and cities', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap'; window.__game.playBtn.click() })
  await page.waitForFunction(() => document.getElementById('spawn-map')?.style.display === 'block', null, { timeout: 60000 })
  const clickAt = async (lat, lon) => {
    const [x, y] = await page.evaluate(([la, lo]) => document.getElementById('spawn-map')._clientAt(la, lo), [lat, lon])
    await page.mouse.click(x, y)
  }
  await clickAt(56, -100)
  await expect(page.locator('#spawn-map-hint')).toContainText('Canada')
  await expect(page.locator('#spawn-map-back')).toBeVisible()
  await page.waitForTimeout(600)
  await clickAt(50, -86)
  await expect(page.locator('#spawn-map-hint')).toContainText('Ontario')
  await expect(page.locator('#spawn-map-list button')).toContainText(['Ottawa', 'Toronto'])
  await page.locator('#spawn-map-list button', { hasText: 'Toronto' }).click()
  await expect(page.locator('#spawn-map-info')).toContainText('Toronto')
  await page.click('#spawn-map-go')
  await page.waitForFunction(() => document.getElementById('spawn-map').style.display === 'none', null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const p = s.bm.tryMode.pos
    return { lat: Math.round(-p.z / 120), lon: Math.round(p.x / 120), town: !!s.bm.world._landmarks.find((l) => l.kind === 'town') }
  })
  expect(r).toEqual({ lat: 44, lon: -79, town: true })
  // The map's label: country · province · city (EarthPlaces.placeNameAt).
  await page.waitForFunction(() => document.getElementById('build-try-biome')?.textContent === 'Canada · Ontario · Toronto', null, { timeout: 20000 })
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

// The World Map mode's real land (2026-10-23): real heights, lakes and
// rivers (EarthTerrain.js) - no snow on Kazakhstan's steppe, snow on
// Everest, water in Lake Balkhash and the Nile. Zombies never appear
// closer than 30 blocks (out here too - path cells used to wrap past
// 2048). M's middle map is the block map (never the atlas), drawn ahead,
// and turns into the globe when zoomed far out (2026-10-24).
test('the World Map mode has real land, far zombie spawns and a block map at every zoom', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap'; window.__game.playBtn.click() })
  await page.waitForFunction(() => document.getElementById('spawn-map')?.style.display === 'block', null, { timeout: 60000 })
  const clickAt = async (lat, lon) => {
    const [x, y] = await page.evaluate(([la, lo]) => document.getElementById('spawn-map')._clientAt(la, lo), [lat, lon])
    await page.mouse.click(x, y)
    await page.waitForTimeout(700)
  }
  await clickAt(48, 68)
  await clickAt(48.7, 71.6)
  await page.locator('#spawn-map-list button', { hasText: 'Atasu' }).click()
  await page.click('#spawn-map-go')
  await page.waitForFunction(() => document.getElementById('spawn-map').style.display === 'none', null, { timeout: 30000 })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const s = g.buildMode.survival
    const at = (lat, lon) => g.buildMode.world.landAt(Math.round(lon * 120), Math.round(-lat * 120))
    const steppe = at(48.68, 71.64)
    const everest = at(27.99, 86.93)
    const balkhash = at(46.5, 74.5)
    const nile = at(24.09, 32.89)
    const p = s.bodyPos()
    s._rebuildFlow([[Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]])
    const dists = []
    const orig = s._makeZombie.bind(s)
    s._makeZombie = function (id, x, y, z, ...rest) { dists.push(Math.hypot(p.x - x, p.z - z)); return orig(id, x, y, z, ...rest) }
    for (let i = 0; i < 20; i++) s._spawnZombie()
    s._makeZombie = orig
    const tm = g.buildMode.tryMode
    const el = document.getElementById('build-try-map')
    tm.cycleMap()
    tm.cycleMap()
    const frame = () => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)))
    await frame()
    const views = []
    const look = () => (el.classList.contains('globe') ? 'globe' : el.classList.contains('atlas') ? 'atlas' : 'blocks')
    views.push(look())
    for (let i = 0; i < 30; i++) {
      tm.zoomMap(1.25)
      await frame()
      if (views.at(-1) !== look()) views.push(look())
    }
    // Drawn ahead in the background: the biggest tiles around you are there.
    const world = g.buildMode.world
    const ahead = await new Promise((done) => {
      const t0 = performance.now()
      const check = () => (world._prewarm?.i > 200 || performance.now() - t0 > 20000 ? done(world._prewarm?.i > 200) : setTimeout(check, 100))
      check()
    })
    return {
      ahead,
      lat: Math.round(-p.z / 120),
      steppe: steppe.biome !== 'snowyPeaks' && steppe.biome !== 'snowyPlains' && steppe.h >= steppe.w,
      everest: everest.biome,
      balkhash: balkhash.h < balkhash.w,
      nile: nile.h < nile.w,
      spawned: dists.length,
      closest: Math.min(...dists) >= 30,
      size: el.dataset.size,
      views,
    }
  })
  expect(r).toEqual({ lat: 49, steppe: true, everest: 'snowyPeaks', balkhash: true, nile: true, spawned: 20, closest: true, size: 'center', views: ['blocks', 'globe'], ahead: true })
})

// 2026-10-24: the Map Editor button asks Worlds or Plain; Plain is endless
// flat grass (never saved); the Tab panel's storage is 10 x 10; animals
// from the picker's Animals list are put down with right-click, walk about,
// come off with left-click and are saved with the map.
test('Map Editor: Worlds/Plain choice, endless grass, 10x10 storage, placed animals', async ({ page }) => {
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
    // Grass far outside the slot's own 128 x 128 ground, never saved.
    out.farGrass = bm.getBlockAt(300, -1, 300)
    out.notSaved = !bm._snapshot().blocks.some((b) => b.x === 300 && b.z === 300)
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
  expect(r.farGrass).toBe('grass')
  expect(r.notSaved).toBe(true)
  expect(r.storage).toBe(100)
  expect(r.animalsListed).toBeGreaterThan(130)
  expect(r.placing).toBe('lion')
  expect(r.spots).toEqual(['lion'])
  expect(r.walked).toBe(true)
  expect(r.reloaded).toEqual(['lion'])
  expect(r.removed).toBe(true)
})
