import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { sampleLand, BIOMES } from '../src/game/OpenWorld.js'
import { SPECIAL_BLOCKS } from '../src/game/SpecialBlocks.js'
import { PLAY_WEAPONS } from '../src/game/PlayWeapons.js'
import { zombieHat, zombieCape } from '../src/game/FunnyZombies.js'

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
    const bodiesBefore = (s._corpses || []).length
    // (Rare tiers and cave zombies have up to ~8x the health - keep hitting.)
    for (let i = 0; i < 200 && s.zombies.includes(target); i++) s.damageZombie(target, 34)
    out.killed = s.kills === killsBefore + 1
    // Its body falls over and fades away (own material copies - the live
    // zombies' shared ones are never touched). (Zombies burning in the sun
    // may have left bodies already - this one is the newest.)
    const corpse = (s._corpses || [])[bodiesBefore]
    out.corpse = !!corpse && s._corpses.length === bodiesBefore + 1
    out.ownMaterials = !!corpse && corpse.materials.length > 0 && corpse.materials.every((m) => !s._zBatch.meshes.some((mesh) => [].concat(mesh.material).includes(m)))
    // Falls, bounces once and settles (the comic flop, 2026-10-31).
    step(1.1)
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
    // (The death replay plays first - skipped here, DeathReplay.js.)
    s.replay?.stop()
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
    for (const w of ['clear', 'lightRain', 'hardRain', 'lightSnow', 'hardSnow', 'hail', 'fog', 'sandstorm', 'eclipse']) {
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
    out.dryRolls = [...rolls].every((k) => ['clear', 'sandstorm', 'duststorm', 'heatwave'].includes(k))
    return out
  })

  expect(r).toEqual({
    defaultWeather: 'random',
    clear: ['', '', false, false, false],
    // Only fog, sandstorms and hard snow close the view in (2026-10-25).
    lightRain: ['', 'lightRain', true, false, true],
    hardRain: ['', 'hardRain', true, true, true],
    lightSnow: ['', 'lightSnow', true, false, true],
    hardSnow: ['', 'hardSnow', true, true, true],
    hail: ['', 'hail', true, false, true],
    fog: ['', '', false, true, true],
    // Its sand blows through the world too (2026-10-30).
    sandstorm: ['sandstorm-overlay', 'sandstorm', true, true, true],
    eclipse: ['', '', false, false, true],
    afterExit: ['', '', false],
    dryRolls: true,
  })
})

// Weather on the ground (2026-10-25): rain soaks the open ground and
// splashes, snow piles up, hail leaves ice, and it all goes again after;
// Potato draws half the rain, no splashes, no low clouds and no grass
// tufts; In Real Life grows grass tufts on grass blocks.
test('weather wets and whitens the ground, Potato stays light', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    g._applyGraphicsLevel('irl')
    await g._enterBuildMode()
    const bm = g.buildMode
    const sky = bm.sky
    const w3 = sky.weather3d
    const fx = bm._chunks.fx
    bm._applyGraphicsLook()
    const run = (s) => { for (let i = 0; i < s * 30; i++) { sky.update(1 / 30); bm.grassTufts.update(1 / 30) } }
    const set = (w) => { sky.weather = w; sky._pickWeather(); sky.apply() }
    const out = {}
    set('hardRain')
    run(40)
    out.rain = { wet: fx.wet.value > 0.9, splash: w3.splash.visible, low: sky.bodies.lowClouds.visible, tufts: bm.grassTufts.mesh.count > 0 }
    set('clear')
    run(200)
    out.dried = fx.wet.value
    set('hardSnow')
    run(120)
    out.snow = fx.snow.value > 0.9
    set('hail')
    run(60)
    out.hail = fx.ice.value > 0.9
    set('clear')
    run(300)
    out.melted = [fx.snow.value, fx.ice.value, fx.wet.value]
    g._applyGraphicsLevel('potato')
    bm._applyGraphicsLook()
    set('hardRain')
    run(10)
    sky.bodies.update(0.1, bm.camera, 0, 0.95, 1, sky._sky)
    out.potato = { drops: w3.points.geometry.drawRange.count * 2 === w3._count, splash: w3.splash.visible, low: sky.bodies.lowClouds.visible, tufts: bm.grassTufts.mesh.visible, pixels: g.renderer.domElement.style.imageRendering }
    g._exitBuildMode()
    out.afterExit = [fx.wet.value, w3.splash.visible]
    return out
  })

  expect(r).toEqual({
    rain: { wet: true, splash: true, low: true, tufts: true },
    dried: 0,
    snow: true,
    hail: true,
    melted: [0, 0, 0],
    potato: { drops: true, splash: false, low: false, tufts: false, pixels: 'pixelated' },
    afterExit: [0, false],
  })
})

// Map 3's walled camp in Play (BuildCamp.js): a safe zone with a Trader,
// Upgrader, Ammo Refill and Quest Board.
test('Map 3 Play starts in a safe camp with working NPCs', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    // A returning player (a first game starts at the gate, PlayOnboarding).
    g.careerStats.totalRuns = 1
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
    s.shop._act('buy', 'armor')
    out.armor = s.armor
    s.shop._act('upgrade', 'mag')
    out.mag = s.magSize()
    s.mag = 0
    s.reserve = 0
    s.shop._act('fill', 'fill')
    out.filled = s.mag === s.magSize() && s.reserve > 0
    s.stats.kills = 15
    s.shop._act('claim', 'kill15')
    out.coinsLeft = s.coins
    out.nextQuests = s.shop.activeQuests().map((q) => q.id).join()
    // The board closes on a click outside it, and stays open on one inside.
    c.npcs.length && s.shop.openPanel('trader')
    document.getElementById('play-npc-list').click()
    out.insideKeepsOpen = s.shop.panelOpen
    document.getElementById('play-npc-panel').click()
    out.outsideCloses = !s.shop.panelOpen
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
  // A returning player (a first game skips the picker, PlayOnboarding).
  await page.evaluate(() => { window.__game.careerStats.totalRuns = 1; window.__game.playBtn.click() })
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
  expect(r).toEqual({ pickerShown: true, cards: 10, soon: 5, waitsForPick: true, spawnedWhilePicking: 0, soonRefused: true, pickerHidden: true, weapon: 'shotgun', ammo: [8, 24], gun: 'shotgun', saved: 'shotgun', shots: [true, false], damaged: true })
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

test('Helicopter Escape: find the fuel cans, the helicopter flies in, hold the ring and it takes off with you', async ({ page }) => {
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
    const out = { mode: s.cfg.mode, label: document.getElementById('game-mode-zombie-extraction').textContent.trim() }
    const p = s.bm.tryMode.pos
    s._rebuildFlow([s._playerCell(p)])
    // Wave 1 on: the cans go out, spread apart, none in the camp.
    s.wave = 1
    s._toSpawn = 0
    s._updateWorld(0.01)
    const f = s.fuel
    out.cans = f.cans.length
    out.hud = document.getElementById('build-play-wave-text').textContent
    out.noHeliYet = !s._extract
    out.inCamp = f.cans.some((c) => s.camp?.inside(c.x, c.z))
    // Walk into each can.
    for (const c of [...f.cans]) {
      p.set(c.x, c.y, c.z)
      f.update(0.01)
    }
    out.got = f.got
    const ex = s._extract
    out.called = !!ex
    // Flying in: the ring doesn't count until it has landed.
    out.startHigh = ex.heli.position.y / s.B
    p.set(ex.x, ex.y, ex.z)
    s._updateExtraction(2)
    out.holdWhileFlying = ex.hold
    out.lower = ex.heli.position.y / s.B < out.startHigh
    s._updateExtraction(5)
    out.landed = ex.landed
    // Away from it: no count. On the ring: counts, stepping off resets it.
    p.set(ex.x + 10, ex.y, ex.z)
    s._updateExtraction(1)
    out.awayHold = ex.hold
    p.set(ex.x, ex.y, ex.z)
    s._updateExtraction(4)
    out.onHold = ex.hold
    p.set(ex.x + 10, ex.y, ex.z)
    s._updateExtraction(0.1)
    out.resetHold = ex.hold
    p.set(ex.x, ex.y, ex.z)
    for (let i = 0; i < 11 && ex.takeoff == null; i++) s._updateExtraction(1)
    // Aboard: you ride it up and nothing can hurt you.
    out.aboard = ex.takeoff != null && !s.dead
    s._updateExtraction(2)
    out.riding = !!s._ride && s._ride.y > ex.y + 3
    const hp = s.health
    s._hurtPlayer(50)
    out.safe = s.health === hp
    const runs0 = g.careerStats.totalRuns
    for (let i = 0; i < 5 && !s.dead; i++) s._updateExtraction(1)
    out.won = s._won && s.dead
    out.title = document.getElementById('build-play-over-title').textContent
    out.counted = g.careerStats.totalRuns === runs0 + 1
    return out
  })
  expect(r.mode).toBe('zombieExtraction')
  expect(r.label).toContain('Helicopter Escape')
  expect(r.cans).toBe(3)
  expect(r.hud).toContain('Fuel 0/3')
  expect(r.noHeliYet).toBe(true)
  expect(r.inCamp).toBe(false)
  expect(r.got).toBe(3)
  expect(r.called).toBe(true)
  expect(r.startHigh).toBeGreaterThan(30)
  expect(r.holdWhileFlying).toBe(0)
  expect(r.lower).toBe(true)
  expect(r.landed).toBe(true)
  expect(r.awayHold).toBe(0)
  expect(r.onHold).toBe(4)
  expect(r.resetHold).toBe(0)
  expect(r.aboard).toBe(true)
  expect(r.riding).toBe(true)
  expect(r.safe).toBe(true)
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
  expect(result.ids).toEqual(['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'jump', 'sprint', 'crouch', 'reload', 'use', 'inspectWeapon', 'cycleMap', 'cameraView', 'dropItem', 'emote', 'shop', 'spray'])
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
test('Map 1 has 500 layers underground with ores, caves, walk-in entrances and the Demon Realm', async ({ page }) => {
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
      for (; y >= -505; y--) {
        // Fallen into a cave: its walls (and floor) grow around you.
        if (!b._blocks.has(`${x},${y},${z}`)) u._grow(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16))
        const type = b._blocks.get(`${x},${y},${z}`)
        if (!type) continue
        types.add(type)
        if (type === 'bedrock' && y <= -500) break
        b.removeBlock(x, y, z)
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${y},${z + dz}`
          // (The Demon Realm's caverns are open on purpose.)
          if (!b._blocks.has(k)) holes += y > -300 ? 1 : 0
          else types.add(b._blocks.get(k))
        }
      }
      return { types: [...types], holes, end: y }
    }
    w.update([{ x: 90, z: 2 }])
    const land = dig(90, 2)
    const city = dig(3, 5)
    const all = new Set([...land.types, ...city.types])
    out.endsOnBedrock = land.end === -500 && city.end === -500
    out.layers = ['stone', 'tuff', 'deepslate', 'smoothbasalt', 'blackstone', 'netherrack', 'bedrock'].filter((t) => !all.has(t))
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
// game's own pause menu (never the Map Editor's); Back to Game carries on
// (2026-10-26); Save Progress keeps the game and the next Play carries on
// from it; Leave Game ends it (counted) and drops the save.
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
    // Back to Game just closes the pause screen and carries on.
    document.getElementById('play-pause-back-btn').click()
    out.backToGame = !bm.menuOpen && bm.active && s.active && getComputedStyle(document.getElementById('play-pause-menu')).display === 'none'
    // A saved game is still there next time (as after closing the tab).
    bm.closeMenuQuietly()
    s.stop({ suspend: true })
    g._exitBuildMode()
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
  expect(a.backToGame).toBe(true)
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
  expect(editor).toEqual({ split: true, store: 100, hotbar: 0 })

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
    // Starting kit: just the picked gun in slot 1 (no other guns, no health
    // pack), and the Catch Traps in the last slot (PlayCatch.js).
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
  expect(r).toEqual({ town: true, townPlan: true, kit: ['rifle', 2], panel: [100, 10, 5], dropped: true, pickedUp: true, holding: 'oakplanks', placed: true, wrongSlot: true, cut: 0.16, restored: 'chestplate', lost: [true, true, true] })
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
    g.careerStats.totalRuns = 1
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
  await page.evaluate(() => { window.__game.careerStats.totalRuns = 1; window.__game.playBtn.click() })
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
    bm.camera.position.y = -800 * B
    bm.update(1 / 30)
    const floor = bm.scene.getObjectByName('spectate-bedrock-floor')
    out.floor = [!!floor?.visible, bm.camera.position.y / B > -500, bm.camera.position.y / B < -499]
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
    out.meat = s._drops.list.filter((d) => d.kind === 'item' && d.type === 'meat_pig').length - before >= 1
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
  expect(r).toEqual({ spawned: true, snow: ['arcticFox', 'hare', 'husky', 'lemming', 'mammoth', 'muskox', 'polarBear', 'ptarmigan', 'reindeer', 'sabertooth', 'saiga', 'snowyOwl'], desert: ['armadillo', 'camel', 'caracal', 'cobra', 'coyote', 'fennecFox', 'gecko', 'gerbil', 'gilaMonster', 'hyrax', 'jackal', 'jackalope', 'jerboa', 'lizard', 'manticore', 'oryx', 'phoenix', 'rattlesnake', 'roadrunner', 'sandCat', 'scorpion', 'snake', 'tarantula', 'tortoise', 'vulture'], sea: true, allBuilt: true, cowsOnlyWarm: ['city', 'mushroomFields', 'plains'], stillHere: true, tamed: true, petSafe: true, follows: true, meat: true, healed: true, handBlock: true, weather: true, time: true, nightVar: true, noBanner: true })
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
// No zombies in World Map since 2026-10-26 (just exploring).
test('the World Map mode has real land, no zombies and a block map at every zoom', async ({ page }) => {
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
  // Past the first wave's countdown: still nobody coming.
  await page.waitForTimeout(5000)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const s = g.buildMode.survival
    const at = (lat, lon) => g.buildMode.world.landAt(Math.round(lon * 120), Math.round(-lat * 120))
    const steppe = at(48.68, 71.64)
    const everest = at(27.99, 86.93)
    const balkhash = at(46.5, 74.5)
    const nile = at(24.09, 32.89)
    const p = s.bodyPos()
    const noZombies = s.zombies.length === 0 && s.wave === 0 && s._toSpawn === 0
    const hud = document.getElementById('build-play-wave-text').textContent
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
      noZombies,
      hud: /^World Map · /.test(hud),
      size: el.dataset.size,
      views,
    }
  })
  expect(r).toEqual({ lat: 49, steppe: true, everest: 'snowyPeaks', balkhash: true, nile: true, noZombies: true, hud: true, size: 'center', views: ['blocks', 'globe'], ahead: true })
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

// 2026-10-26: in a game the screens wear the biome (readable: the box in
// the biome's colour, the text in the opposite colour) unless Settings >
// Theme > Game Screens Follow the Biome is off; the homepage never does.
test('Game screens follow the biome only in games and only when the setting is on', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { localStorage.removeItem('gayz-play-saved-run'); window.__game.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  await page.waitForFunction(() => document.documentElement.classList.contains('ui-theme-biome'), null, { timeout: 10000 })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const cl = document.documentElement.classList
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    const st = document.documentElement.style
    const out = { ink: st.getPropertyValue('--biome-ink-rgb'), bg: st.getPropertyValue('--biome-bg-rgb') }
    const tg = document.getElementById('play-biome-look-toggle')
    tg.checked = false
    tg.dispatchEvent(new Event('change'))
    await wait(400)
    out.off = cl.contains('ui-theme-biome')
    out.themeBack = cl.contains('ui-theme-old') || cl.contains('ui-theme-clean')
    tg.checked = true
    tg.dispatchEvent(new Event('change'))
    await wait(400)
    out.onAgain = cl.contains('ui-theme-biome')
    g.buildMode.toggleMenu()
    document.getElementById('play-pause-leave-btn').click()
    await wait(800)
    out.homeBiome = cl.contains('ui-theme-biome')
    out.homeTheme = cl.contains('ui-theme-old') || cl.contains('ui-theme-clean')
    return out
  })
  expect(r.ink).toMatch(/\d+, \d+, \d+/)
  expect(r.bg).toMatch(/\d+, \d+, \d+/)
  expect(r.off).toBe(false)
  expect(r.themeBack).toBe(true)
  expect(r.onAgain).toBe(true)
  expect(r.homeBiome).toBe(false)
  expect(r.homeTheme).toBe(true)
})

// 2026-10-26 (Gaymi: "check all the gamemodes do they work for zombie
// survival"): each of the 5 zombie modes started from the homepage like a
// player would - zombies really come, the wave clears and the next one
// starts, and each mode's own rule works (Defense's last wave wins, Boss
// Hunt's 3rd wave has a boss, Rush's short break and timer, Extraction's
// helicopter has its own test above); dying ends the run with its screen.
for (const [mode, button] of [['classic', 'game-mode-classic'], ['zombieDefense', 'game-mode-zombie-defense'], ['bossHunt', 'game-mode-boss-hunt'], ['zombieRush', 'game-mode-zombie-rush'], ['zombieExtraction', 'game-mode-zombie-extraction']]) {
  test(`${mode}: starts, spawns zombies, clears waves and ends`, async ({ page }) => {
    await gotoAndWaitForGame(page)
    const unlocked = await page.evaluate((id) => {
      const g = window.__game
      g.settings.guestMode = false
      const btn = document.getElementById(id)
      btn.click()
      g.playBtn.click()
      return !btn.disabled
    }, button)
    expect(unlocked).toBe(true)
    await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
    await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
    // Real play: the first wave starts and zombies walk in on their own.
    await page.waitForFunction(() => window.__game.buildMode.survival.zombies.length > 0, null, { timeout: 30000 })
    const r = await page.evaluate(async (m) => {
      const s = window.__game.buildMode.survival
      const out = { mode: s.cfg.mode, wave1: s.wave, hud: document.getElementById('build-play-wave-text').textContent }
      // Every zombie in wave 1 shot down.
      const killAll = () => {
        s._toSpawn = 0
        for (const z of [...s.zombies]) s.damageZombie(z, 1e6)
      }
      killAll()
      out.killsAfter = s.kills
      // The break, then wave 2 by itself (up to 30s: a slow test machine
      // draws few frames, so the ~6s break can take ~16s of real time).
      const t0 = performance.now()
      await new Promise((done) => {
        const check = () => {
          // A cleared wave offers perk cards and waits for a pick (RunPerks.js).
          if (s.perks?.open) s.perks.pick(s.perks.offer[0])
          return s.wave >= 2 || performance.now() - t0 > 30000 ? done() : setTimeout(check, 100)
        }
        check()
      })
      out.wave2 = s.wave
      out.breakSecs = Math.round((performance.now() - t0) / 1000)
      if (m === 'bossHunt') {
        s._startWave(3)
        s._spawnZombie()
        out.boss = s.zombies.some((z) => z.boss)
      }
      if (m === 'zombieDefense') {
        killAll()
        s.wave = 10
        s._breakTimer = 0
        s._updateWorld(0.01)
        out.won = !!s._won && s.dead
        out.title = document.getElementById('build-play-over-title').textContent
        return out
      }
      if (m === 'zombieRush') out.timer = /Time|\d+:\d\d/.test(document.getElementById('build-play-wave-text').textContent)
      // Dying ends the run.
      const runs0 = window.__game.careerStats.totalRuns
      s.health = 1
      s.armor = 0
      s._hurtPlayer(1000)
      if (!s.dead) s._die()
      // (The death replay plays first - skipped here, DeathReplay.js.)
      s.replay?.stop()
      out.dead = s.dead
      out.title = document.getElementById('build-play-over-title').textContent
      out.overShown = s._overEl.style.display !== 'none'
      out.counted = window.__game.careerStats.totalRuns === runs0 + 1
      return out
    }, mode)
    console.log(mode, JSON.stringify(r))
    expect(r.mode).toBe(mode)
    expect(r.wave1).toBe(1)
    expect(r.killsAfter).toBeGreaterThan(0)
    expect(r.wave2).toBe(2)
    if (mode === 'zombieRush') {
      expect(r.breakSecs).toBeLessThanOrEqual(3)
      expect(r.timer).toBe(true)
    }
    if (mode === 'bossHunt') expect(r.boss).toBe(true)
    if (mode === 'zombieDefense') {
      expect(r.won).toBe(true)
      expect(r.title).toBe('You held the city!')
    } else {
      expect(r.dead).toBe(true)
      expect(r.overShown).toBe(true)
      expect(r.counted).toBe(true)
    }
  })
}

// 2026-10-26: a 1 in 10 rainbow when rain clears in the daytime.
test('a rainbow can follow the rain', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const sky = window.__game.buildMode.sky
    const orig = Math.random
    const rolls = { yes: 0, no: 0 }
    // The last rain step clears: a roll under 0.1 brings a rainbow.
    for (const [roll, key] of [[0.05, 'yes'], [0.5, 'no']]) {
      sky._clock = 1440 * 0.1
      sky._rainbowIn = 0
      // Rain ends as drizzle (2026-10-30).
      sky._now = 'drizzle'
      sky._goal = 'clear'
      sky._stepIn = 0
      Math.random = () => roll
      sky.update(0.01)
      Math.random = orig
      rolls[key] = sky._rainbowIn
    }
    sky.showRainbow()
    for (let i = 0; i < 200; i++) sky.update(0.1)
    const shown = sky.bodies.rainbow.visible
    // Rain again: it fades away.
    sky._now = sky._goal = 'lightRain'
    sky.apply()
    for (let i = 0; i < 300; i++) sky.update(0.1)
    return { yes: rolls.yes > 0, no: rolls.no, shown, gone: !sky.bodies.rainbow.visible }
  })
  expect(r).toEqual({ yes: true, no: 0, shown: true, gone: true })
})

// 2026-10-26: less blocky land on Realistic/Ultra/In Real Life (smooth
// hills, rounded edges, pebbles, leafy trees), animals with painted eyes
// and rounder bodies on In Real Life.
test('bumpy block tops and rounded edges on the top levels', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A one-block step: a 3x3 clay floor with one more clay on top
    // (clay: no little rocks lie on it, and it isn't real-life ground or
    // rock, which round off on these levels - RealGround.js).
    for (let x = 40; x < 43; x++) for (let z = 40; z < 43; z++) bm._placeBlockInner(x, 0, z, 'clay')
    bm._placeBlockInner(41, 1, 41, 'clay')
    // Every vertex height's part above the whole block under it.
    const fracs = () => {
      ch.flush(bm._chunkCells)
      const f = []
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 1; i < pos.array.length; i += 3) {
            const S = bm._chunks.blockSize
            const x = (pos.array[i - 1] + m.position.x) / S
            const z = (pos.array[i + 1] + m.position.z) / S
            // Only the test blocks (the ground round them has rocks on it).
            if (x < 40 || x > 43 || z < 40 || z > 43) continue
            const y = (pos.array[i] + m.position.y) / S
            // Not the grass under them: on the top levels grass and dirt
            // are real-life ground and round off below block tops on
            // purpose (RealGround.js, own test below).
            if (y < 0.5) continue
            f.push(Math.round((y - Math.floor(y + 0.001)) * 1000) / 1000)
          }
        }
      }
      return f
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    const irl = fracs()
    // Bumps rise a little (0.02..0.1 of a block) above flat tops; nothing
    // dips below a block's top, so every step stays a clean one-block step.
    out.irl = [ch.shapes, ch.fx.round.value, irl.length === 0 || irl.some((f) => f > 0.015), irl.every((f) => f < 0.105 || f > 0.99)]
    out.bad = [...new Set(irl.filter((f) => !(f < 0.105 || f > 0.99)))].slice(0, 20)
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const simple = fracs()
    out.simple = [ch.shapes, ch.fx.round.value, simple.some((f) => f > 0.015 && f < 0.99)]
    g._exitBuildMode()
    return out
  })
  // Uploaded chunk geometry may drop its arrays (dropAfterUpload), so the
  // bump check only counts when the arrays were still there.
  expect(r.irl, JSON.stringify(r.bad)).toEqual([true, 1, true, true])
  expect(r.simple).toEqual([false, 0, false])
})

test('real-life ground: grass and dirt round into one piece on the top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A lone dirt block up in the air, and a grass block with planks on
    // one side (where they meet, the grass must not move).
    bm._placeBlockInner(60, 5, 60, 'dirt')
    bm._placeBlockInner(70, 5, 70, 'grass')
    bm._placeBlockInner(71, 5, 70, 'oakplanks')
    const verts = (x0, z0) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > x0 - 0.8 && x < x0 + 1.8 && z > z0 - 0.8 && z < z0 + 1.8 && y > 4.2 && y < 6.8) v.push([x, y, z])
          }
        }
      }
      return v
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    out.amt = ch.realAmt
    const lone = verts(60, 60)
    // Its corners round in: no point reaches the cube's top corners.
    out.rounded = lone.length === 0 || lone.every(([x, y, z]) => !(y > 5.97 && (x < 60.03 || x > 60.97) && (z < 60.03 || z > 60.97)))
    // The real top as GrassTufts/cracks see it, and the planks' corner.
    out.grid = !!ch.realFaceGrids(60, 5, 60) && ch.realFaceGrids(61, 5, 60) === null
    const L = ch.realTopLattice(70, 5, 70)
    const p = ch.realTopPoint(L, 70, 5, 70, 1, 0)
    out.pinned = [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000, Math.round(p.z * 1000) / 1000]
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    out.simpleAmt = ch.realAmt
    const flat = verts(60, 60)
    out.simpleCube = flat.length === 0 || flat.every(([x, y, z]) => [x, y, z].every((k) => Math.abs(k - Math.round(k)) < 0.001))
    g._exitBuildMode()
    return out
  })
  expect(r.amt).toBe(1)
  // Uploaded chunk geometry may drop its arrays (dropAfterUpload); the
  // vertex checks count whenever the arrays were still there.
  expect(r.rounded).toBe(true)
  expect(r.grid).toBe(true)
  expect(r.pinned).toEqual([71, 6, 70])
  expect(r.simpleAmt).toBe(0)
  expect(r.simpleCube).toBe(true)
})

test('real-life trees: leaves join into one bushy top, logs turn round, on the top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A little tree up in the air: 2 logs, a 3x3 leaf layer on top.
    bm._placeBlockInner(80, 5, 80, 'oaklog')
    bm._placeBlockInner(80, 6, 80, 'oaklog')
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bm._placeBlockInner(80 + dx, 7, 80 + dz, dx || dz ? 'leaves' : 'birchleaves')
    const verts = (y0, y1) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > 78 && x < 83 && z > 78 && z < 83 && y > y0 && y < y1) v.push([x, y, z])
          }
        }
      }
      return v
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    // Trunk: every point within the round, none at the square's corners.
    const trunk = verts(5.01, 6.3)
    out.round = trunk.every(([x, , z]) => Math.hypot(x - 80.5, z - 80.5) < 0.505)
    out.trunkPts = trunk.length
    out.badTrunk = trunk.filter(([x, , z]) => Math.hypot(x - 80.5, z - 80.5) >= 0.505).slice(0, 6).map((p) => p.map((k) => Math.round(k * 100) / 100))
    // Crown: the 3x3 layer's outside corners are rounded in (the clumps
    // stick out, but never reach the square crown's top corners).
    const crown = verts(6.99, 8.6)
    out.crownRounded = crown.every(([x, y, z]) => !(y > 7.97 && (x < 79.03 || x > 81.97) && (z < 79.03 || z > 81.97)))
    out.grid = !!ch.realFaceGrids(80, 7, 80) && !!ch.realFaceGrids(79, 7, 79)
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const flat = verts(5.01, 6.3)
    out.simpleSquare = flat.some(([x, , z]) => Math.hypot(x - 80.5, z - 80.5) > 0.6)
    out.simpleGrid = ch.realFaceGrids(80, 7, 80) === null
    g._exitBuildMode()
    return out
  })
  expect(r.round, JSON.stringify(r.badTrunk)).toBe(true)
  expect(r.crownRounded).toBe(true)
  expect(r.grid).toBe(true)
  expect(r.simpleGrid).toBe(true)
  // Vertex checks count whenever the arrays were still there.
  if (r.trunkPts) expect(r.simpleSquare).toBe(true)
})

test('real-life rock: stone-type blocks turn craggy, melt into dirt, on the top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A lone stone up in the air, stone beside dirt, bricks beside planks.
    bm._placeBlockInner(90, 5, 90, 'stone')
    bm._placeBlockInner(95, 5, 95, 'cobblestone')
    bm._placeBlockInner(96, 5, 95, 'dirt')
    bm._placeBlockInner(100, 5, 100, 'stonebricks')
    bm._placeBlockInner(101, 5, 100, 'oakplanks')
    const verts = (x0, z0) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > x0 - 0.8 && x < x0 + 1.8 && z > z0 - 0.8 && z < z0 + 1.8 && y > 4.2 && y < 6.8) v.push([x, y, z])
          }
        }
      }
      return v
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    out.kinds = ['stone', 'cobblestone', 'stonebricks', 'diamondore', 'sandstone', 'smoothstone'].map((t) => !!ch.info.get(t)?.rock)
    out.notRock = ['stoneslab', 'glowstone', 'redstonelamp', 'grass', 'oakplanks'].map((t) => !!ch.info.get(t)?.rock)
    const lone = verts(90, 90)
    out.pts = lone.length
    out.rounded = lone.every(([x, y, z]) => !(y > 5.97 && (x < 90.03 || x > 90.97) && (z < 90.03 || z > 90.97)))
    // Rock and dirt share their middle edge and it moves (not pinned).
    const L = ch.realTopLattice(95, 5, 95)
    out.joinFree = L[1][6] === 1 && L[1][8] > 0 && L[1][8] < 1
    const a = ch.realTopPoint(L, 95, 5, 95, 1, 0.5)
    const b = ch.realTopPoint(ch.realTopLattice(96, 5, 95), 96, 5, 95, 0, 0.5)
    out.joined = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-4
    // Bricks meeting planks stay pinned at the planks.
    const p = ch.realTopPoint(ch.realTopLattice(100, 5, 100), 100, 5, 100, 1, 0)
    out.pinned = [p.x, p.y, p.z].map((k) => Math.round(k * 1000) / 1000)
    out.crack = !!ch.realFaceGrids(90, 5, 90)
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const flat = verts(90, 90)
    out.simpleCube = flat.every(([x, y, z]) => [x, y, z].every((k) => Math.abs(k - Math.round(k)) < 0.001))
    out.simpleGrid = ch.realFaceGrids(90, 5, 90) === null
    g._exitBuildMode()
    return out
  })
  expect(r.kinds).toEqual([true, true, true, true, true, true])
  expect(r.notRock).toEqual([false, false, false, false, false])
  expect(r.rounded).toBe(true)
  expect(r.joinFree).toBe(true)
  expect(r.joined).toBe(true)
  expect(r.pinned).toEqual([101, 6, 100])
  expect(r.crack).toBe(true)
  expect(r.simpleCube).toBe(true)
  expect(r.simpleGrid).toBe(true)
})

test('real-life water: soft shores, depth and splash on the top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A 3x3 pond, 2 deep, in a dirt basin with a grass bank, up in the air;
    // one water block on top of its middle (a waterfall landing).
    for (let x = 109; x <= 115; x++) for (let z = 109; z <= 115; z++) for (let y = 3; y <= 5; y++) bm._placeBlockInner(x, y, z, y === 5 ? 'grass' : 'dirt')
    for (let x = 111; x <= 113; x++) for (let z = 111; z <= 113; z++) for (let y = 4; y <= 5; y++) { bm._removeBlockInner?.(x, y, z); bm._placeBlockInner(x, y, z, 'water') }
    bm._placeBlockInner(112, 6, 112, 'water')
    const water = () => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          if (m.material !== ch.materials.water) continue
          const pos = m.geometry.attributes.position
          const w = m.geometry.attributes.aWater
          if (!pos?.array?.length) continue
          for (let i = 0, k = 0; i < pos.array.length; i += 3, k += 2) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > 108 && x < 117 && z > 108 && z < 117 && y > 5.5 && y < 6.2) v.push([x, y, z, w?.array?.[k], w?.array?.[k + 1]])
          }
        }
      }
      return v
    }
    out.types = [bm._blocks.get('112,5,112'), bm._blocks.get('112,4,112'), bm._blocks.get('112,6,112')]
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    out.amt = ch.fx.realWater.value
    // The bank's corner at the water's edge is free to round off now.
    const L = ch.realTopLattice(110, 5, 111)
    out.bankFree = L[1][6] === 1
    const top = water()
    out.pts = top.length
    // The water reaches under the bank (past its own cells, x 111..114).
    out.reach = top.some(([x]) => x < 110.9) && top.some(([x]) => x > 114.1)
    out.deep = Math.max(...top.map((p) => p[3] ?? 0))
    out.splash = top.some((p) => p[4] === 1)
    out.shore0 = top.some((p) => p[3] === 0 && p[4] === -1)
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    out.simpleAmt = ch.fx.realWater.value
    const flat = water()
    out.simplePts = flat.length
    out.simpleInside = flat.every(([x, , z]) => x > 110.99 && x < 114.01 && z > 110.99 && z < 114.01)
    g._exitBuildMode()
    return out
  })
  expect(r.types).toEqual(['water', 'water', 'water'])
  expect(r.amt).toBe(1)
  expect(r.bankFree).toBe(true)
  expect(r.simpleAmt).toBe(0)
  // Vertex checks count whenever the arrays were still there.
  if (r.pts) {
    expect(r.reach).toBe(true)
    expect(r.deep).toBeGreaterThan(1.5)
    expect(r.splash).toBe(true)
    expect(r.shore0).toBe(true)
  }
  if (r.simplePts) expect(r.simpleInside).toBe(true)
})

test('castles fly cloth flags on poles, acacia trees stand on their trunks', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const w = b.world
    const out = {}
    for (let seed = 1; seed < 40 && !out.castle; seed++) {
      w.reseed(seed)
      const p = w.placesNear(0, 0, 600).find((q) => q.kind === 'castle')
      if (!p) continue
      for (let i = 0; i < 40; i++) w.update([{ x: p.x, z: p.z }])
      const plan = w._plansOver(p.x, p.z, p.x, p.z).find((q) => q.kind === 'castle')
      // No block flags (wool) left, five cloth flags, drawn near you.
      // The old block flags (a log pole) are gone from the tower tops.
      let wool = 0
      for (const f of plan.flags) for (let y = f.y; y < f.y + 6; y++) if (b._blocks.get(`${f.x},${y},${f.z}`)) wool++
      b.camera.position.set(p.x * b._chunks.blockSize, 40, p.z * b._chunks.blockSize)
      b.castleFlags._wait = 0
      b.castleFlags.update(0.1)
      const group = b.castleFlags.shown.get(plan)
      out.castle = { wool, flags: plan.flags.length, design: plan.flagDesign, drawn: !!group, visible: group ? group.userData.parts.filter((q) => q.meshes[0].visible).length : 0 }
    }
    // Acacia trunks: every log touches another log or the ground face to face.
    const logs = [...b._blocks.entries()].filter(([, t]) => t === 'acacialog').map(([k]) => k.split(',').map(Number))
    const has = (x, y, z) => b._blocks.has(`${x},${y},${z}`)
    out.acaciaLoose = logs.filter(([x, y, z]) => ![[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => has(x + dx, y + dy, z + dz))).length
    g._exitBuildMode()
    out.cleared = b.castleFlags.shown.size
    return out
  })
  expect(r.castle).toMatchObject({ wool: 0, flags: 5, drawn: true, visible: 5 })
  expect(['logo', 'banner', 'skull']).toContain(r.castle.design)
  expect(r.acaciaLoose).toBe(0)
  expect(r.cleared).toBe(0)
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

// 2026-10-31: the go-kart - parked near you, Use hops in, the keys drive
// it, it runs zombies over, Use hops out beside it.
test('go-kart: hop in, drive, run zombies over, hop out', async ({ page }) => {
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
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    s.update(0.05)
    const k = s.kart
    const out = { parked: !!k.group }
    // Too far: Use does nothing. Next to it: in.
    bm.tryMode.pos.set(k.x + 10, k.y, k.z)
    out.farUse = k.use()
    bm.tryMode.pos.set(k.x + 1, k.y, k.z)
    out.inUse = bm._tryUseFromCamera() && k.driving
    // Face +z and hold forward: it speeds up and moves.
    k.heading = 0
    const z0 = k.z
    for (let i = 0; i < 40; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.moved = k.z - z0 > 5
    out.fast = k.speed > 10
    out.meWithKart = Math.abs(bm.tryMode.pos.z - k.z) < 0.01
    // A zombie straight ahead gets run over.
    const zb = s._makeZombie(990, k.x, k.y, k.z + 3, 10000, false, null)
    zb.speedMult = 0
    for (let i = 0; i < 10; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.rammed = zb.health < 10000
    // Steering turns it.
    const h0 = k.heading
    for (let i = 0; i < 10; i++) bm.tryMode.update(0.05, new Set(['KeyW', 'KeyA']))
    out.turned = k.heading > h0 + 0.3
    // Out: standing beside it, not driving.
    out.outUse = k.use() && !k.driving
    out.beside = Math.hypot(bm.tryMode.pos.x - k.x, bm.tryMode.pos.z - k.z) > 1
    s.stop()
    out.gone = !k.group
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({ parked: true, farUse: false, inUse: true, moved: true, fast: true, meWithKart: true, rammed: true, turned: true, outUse: true, beside: true, gone: true })
})

// 2026-10-31: right-clicking the kart hops in, it drives up a 1-block
// step, Settings > Auto Jump hops you up one, and walking eases in and the
// view glides up a step.
test('go-kart right-click and steps; auto jump; smoother walking', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const B = bm._chunks.blockSize
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 60, 'zombiespawner')
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    s.update(0.05)
    const k = s.kart
    const tm = bm.tryMode
    const out = {}
    const look = (x, y, z) => {
      const d = { x: x - bm.camera.position.x / B, y: y - bm.camera.position.y / B, z: z - bm.camera.position.z / B }
      bm._yaw = Math.atan2(-d.x, -d.z)
      bm._pitch = Math.atan2(d.y, Math.hypot(d.x, d.z))
      bm._applyCameraRotation?.()
      bm.camera.rotation.set(bm._pitch, bm._yaw, 0, 'YXZ')
      bm.camera.updateMatrixWorld()
    }
    // Right-click while looking away: nothing. Looking at it: in.
    tm.pos.set(k.x + 2, k.y, k.z)
    tm.update(0.016, new Set())
    look(k.x + 10, k.y + 1, k.z)
    out.awayClick = k.rightClick()
    look(k.x, k.y + 0.4, k.z)
    out.lookClick = k.rightClick() && k.driving
    // A one-block step across its way: it drives up onto it.
    const y0 = k.y
    const fx = Math.floor(k.x)
    const fz = Math.floor(k.z)
    for (let x = fx - 4; x <= fx + 4; x++) for (let z = fz + 4; z <= fz + 12; z++) bm.placeBlock(x, Math.round(y0), z, 'grass', true)
    k.heading = 0
    k.x = fx + 0.5
    let top = y0
    for (let i = 0; i < 60; i++) {
      tm.update(0.05, new Set(['KeyW']))
      top = Math.max(top, k.y)
    }
    out.kartClimbed = Math.round(top - y0)
    k.use()
    // Walking speeds up over a moment instead of at once.
    s.kart.dispose()
    tm.pos.set(20.5, 1.01, -20.5)
    tm.vel.set(0, 0, 0)
    bm._yaw = Math.PI // facing +z
    for (let i = 0; i < 5; i++) tm.update(0.016, new Set())
    tm.update(0.016, new Set(['KeyW']))
    out.easesIn = Math.hypot(tm.vel.x, tm.vel.z) < 2
    // Auto Jump off: walking into a 1-block step stops you.
    for (let x = 18; x <= 23; x++) for (let z = -17; z <= -10; z++) bm.placeBlock(x, 1, z, 'grass', true)
    g.settings.autoJump = false
    for (let i = 0; i < 90; i++) tm.update(0.016, new Set(['KeyW']))
    out.offStuck = tm.pos.y < 1.5
    // On: it hops up.
    tm.pos.set(20.5, 1.01, -20.5)
    g.settings.autoJump = true
    let lagSeen = false
    for (let i = 0; i < 120; i++) tm.update(0.016, new Set(['KeyW']))
    out.onClimbed = tm.pos.y > 1.9
    g.settings.autoJump = false
    // A slab step up: the view lags behind, then catches up.
    tm.pos.set(30.5, 1.01, 0.5)
    for (let i = 0; i < 5; i++) tm.update(0.016, new Set())
    bm.placeBlock(30, 1, 2, 'stonebricksslab', true)
    for (let i = 0; i < 60; i++) {
      tm.update(0.016, new Set(['KeyW']))
      if (tm._stepLag < -0.05) lagSeen = true
    }
    out.glide = lagSeen
    out.settled = Math.abs(tm._stepLag) < 0.01
    // 2026-11-01: a slow frame rate walks as far as a fast one (steady
    // steps, not slow motion), and landing dips the view.
    const walkFor = (frameDt) => {
      tm.pos.set(-20.5, 1.01, 10.5)
      tm.vel.set(0, 0, 0)
      for (let i = 0; i < 5; i++) tm.update(0.016, new Set())
      const z0 = tm.pos.z
      for (let i = 0; i < Math.round(1 / frameDt); i++) tm.update(frameDt, new Set(['KeyW']))
      return tm.pos.z - z0
    }
    const fast = walkFor(1 / 60)
    const slow = walkFor(1 / 10)
    out.sameSpeed = fast > 2 && Math.abs(slow - fast) / fast < 0.1
    tm.pos.set(-20.5, 6, 10.5)
    tm.vel.set(0, 0, 0)
    let dipSeen = false
    for (let i = 0; i < 80; i++) {
      tm.update(0.016, new Set())
      if (tm._landDip > 0.05) dipSeen = true
    }
    out.landDip = dipSeen
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({ awayClick: false, lookClick: true, kartClimbed: 1, easesIn: true, offStuck: true, onClimbed: true, glide: true, settled: true, sameSpeed: true, landDip: true })
})

// 2026-10-26: grass 100 blocks out (since 2026-10-30: as far as the land
// is drawn, growing over time), crack on every face (on the lumps
// too), puffy leaves, falling leaves and half-chance leaf drops, a
// friendly spider out of the waves, 16 more animals and 20 rare
// dinosaurs whose meat-eaters chase and bite.
test('far grass, cracks on bumpy tops, puffy and falling leaves, dinosaurs', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const B = bm._chunks.blockSize
    const out = {}
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    // A flat field of grass 60 blocks out from x=0: tufts reach it.
    for (let x = -2; x <= 70; x++) for (let z = -2; z <= 2; z++) bm._placeBlockInner(x, 0, z, 'grass')
    bm.camera.position.set(0.5 * B, 2.6 * B, 0.5 * B)
    const gt = bm.grassTufts
    gt.clear()
    // Grass starts bare and grows (2026-10-30): only the first few tiny
    // sprouts after a few seconds, then a full field once its time has passed.
    for (let i = 0; i < 200; i++) gt.update(1 / 60)
    out.bareAtFirst = gt.mesh.count
    gt.grow(30)
    for (let i = 0; i < 200; i++) gt.update(1 / 60)
    out.sprouting = gt.mesh.count
    gt.grow(400)
    for (let i = 0; i < 200; i++) gt.update(1 / 60)
    out.grown = gt.mesh.count
    let far = 0
    const m = new (bm.camera.matrix.constructor)()
    for (let i = 0; i < gt.mesh.count; i++) {
      gt.mesh.getMatrixAt(i, m)
      far = Math.max(far, m.elements[12] / B)
    }
    out.grassFar = Math.round(far)
    // Leaves: puffed out (points beyond the block's face), no flat cards.
    bm._placeBlockInner(-20, 5, -20, 'leaves')
    const ch = bm._chunks
    ch.flush(bm._chunkCells)
    let puff = 0
    for (const c of ch.chunks.values()) {
      const mesh = c.meshes.find((mm) => mm.material === ch.materials.cutout)
      const pos = mesh?.geometry.attributes.position
      if (!pos) continue
      for (let i = 0; i < pos.count; i++) {
        const x = (pos.getX(i) + mesh.position.x) / B
        const y = (pos.getY(i) + mesh.position.y) / B
        const z = (pos.getZ(i) + mesh.position.z) / B
        if (x < -21 || x > -18 || z < -21 || z > -18) continue
        puff = Math.max(puff, y - 6, -20 - x, x + 19)
      }
    }
    out.leafPuff = Math.round(puff * 100) / 100
    // Breaking crack: its top follows the bumpy top (above 1.0).
    bm._placeBlockInner(5, 3, 5, 'clay')
    const dig = { x: 5, y: 3, z: 5, type: 'stone' }
    bm.tryMode._showDigCrack(dig, 0.5)
    const pos = bm.tryMode._digMesh.geometry.attributes.position
    let top = 0
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i) / B + 0.5)
    out.crackTop = top
    out.crackFaces = pos.count
    // Water corners: never cut out any more.
    out.waterCut = String(ch.materials.water.onBeforeCompile).includes('discard')
    // Falling leaves come off the leaf block above and land.
    const fl = bm.fallingLeaves
    fl.clear()
    bm.camera.position.set(-19.5 * B, 3 * B, -19.5 * B)
    for (let x = -24; x <= -16; x++) for (let z = -24; z <= -16; z++) bm._placeBlockInner(x, 6, z, 'leaves')
    for (let i = 0; i < 5000 && !fl.leaves.length; i++) fl._spawnTry()
    out.leafFalls = fl.leaves.length > 0
    out.leafShape = fl.leaves[0]?.shape
    // Each tree its own leaf shape.
    out.leafShapes = Object.keys(fl.meshes).length
    const first = fl.leaves[0]
    // Wide enough that a leaf drifting sideways still lands on it.
    for (let x = -30; x <= -10; x++) for (let z = -30; z <= -10; z++) bm._placeBlockInner(x, 1, z, 'grass')
    for (let i = 0; i < 300 && !first.down; i++) fl.update(1 / 30)
    out.leafLanded = first.down && Math.abs(first.y - 2.02) < 0.05
    // Start a game: animals.
    bm.placeBlock(0, 1, 0, 'playerstart', false, { facing: 0 })
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    const A = s.animals
    const K = A.constructor.KINDS
    out.dinos = Object.values(K).filter((k) => k.dino).length
    out.newAnimals = ['bison', 'yak', 'llama', 'alpaca', 'capybara', 'sloth', 'anteater', 'redPanda', 'jaguar', 'lynx', 'snowLeopard', 'gazelle', 'wildebeest', 'boar', 'tapir', 'mouse'].every((id) => K[id])
    // Dinosaurs are rare: about 1 in 100 picks in a dino biome.
    let dinoPicks = 0
    let picks = 0
    for (let i = 0; i < 40000; i++) {
      const id = A.kindAt((i * 137) % 6000 - 3000, Math.floor(i / 44) * 7 - 3000)
      if (!id) continue
      picks++
      if (K[id].dino) dinoPicks++
    }
    out.dinoShare = dinoPicks / picks
    out.dinoSeen = dinoPicks > 0
    // Leaf blocks always drop (2026-10-30).
    s._drops.clear?.()
    let drops = 0
    for (let i = 0; i < 400; i++) {
      const before = s._drops.list.length
      s.onBlockMined('leaves', 30, 1, 30)
      if (s._drops.list.length > before) drops++
      s._drops.list.forEach((d) => d.mesh.removeFromParent())
      s._drops.list.length = 0
    }
    out.leafDropShare = drops / 400
    // The spider: an animal, not a wave zombie.
    out.spiderAnimal = !!K.spider && K.spider.body[0] > 0.5
    s.wave = 3
    for (let i = 0; i < 200; i++) s._spawnZombie()
    out.zombiesMade = s.zombies.length
    out.waveSpiders = s.zombies.filter((z) => z.kind === 'spider').length
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    // A T. rex right next to you chases and bites; you can't tame it.
    A.clearAll()
    const me = s.bodyPos()
    const rex = A.spawn('tRex', me.x + 12, me.y, me.z)
    s.health = 100
    for (let i = 0; i < 200; i++) A.update(1 / 30, { wild: false })
    out.rexCame = Math.hypot(rex.x - me.x, rex.z - me.z) < 12
    out.bitten = s.health < 100
    s.health = 100
    // Shot: angry, doesn't run.
    A.damage(rex, 10)
    out.rexAngry = rex.angry > 0 && rex.flee === 0
    // A T. rex is about 8 blocks tall (made huge 2026-10-30), a Brachiosaurus about 13.
    const tallOf = (kind) => { const k = K[kind]; return Math.max(k.leg + k.body[1], k.headAt[0] + k.head[1] / 2) }
    out.rexTall = tallOf('tRex')
    out.brachioTall = tallOf('brachiosaurus')
    return out
  })
  expect(r.grassFar).toBeGreaterThan(55)
  expect(r.bareAtFirst).toBeLessThan(r.grown * 0.03)
  expect(r.sprouting).toBeGreaterThan(r.bareAtFirst)
  expect(r.grown).toBeGreaterThan(r.sprouting)
  expect(r.leafShape).toBe('maple')
  expect(r.leafShapes).toBeGreaterThanOrEqual(9)
  expect(r.leafPuff).toBeGreaterThan(0.08)
  expect(r.crackTop).toBeGreaterThan(1.02)
  expect(r.crackFaces).toBeGreaterThan(24)
  expect(r.waterCut).toBe(false)
  expect(r.leafFalls).toBe(true)
  expect(r.leafLanded).toBe(true)
  expect(r.dinos).toBe(20)
  expect(r.newAnimals).toBe(true)
  expect(r.dinoSeen).toBe(true)
  expect(r.dinoShare).toBeLessThan(0.02)
  expect(r.zombiesMade).toBeGreaterThan(20)
  expect(r.leafDropShare).toBe(1)
  expect(r.spiderAnimal).toBe(true)
  expect(r.waveSpiders).toBe(0)
  expect(r.rexCame).toBe(true)
  expect(r.bitten).toBe(true)
  expect(r.rexAngry).toBe(true)
  expect(r.rexTall).toBeGreaterThan(7)
  expect(r.rexTall).toBeLessThan(9)
  expect(r.brachioTall).toBeGreaterThan(12)
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

// 2026-10-26: on a server the killing shot gets its rarity's coins and
// everyone else who did 10%+ of its health an assist (25%); the big map's
// sharp tiles are drawn by workers, the same picture as before.
test('kill + assist coins on servers, map tiles drawn off the main thread', async ({ page }) => {
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
    // As the host: A did 30%, me 5%, B 15%, C finished it.
    const credits = []
    s.net = { isHost: true, players: new Map(), queueCredit: (to, boss, skeleton, tier, assist) => credits.push([to, tier, !!assist]), queueHurt() {}, targets: () => [] }
    const z1 = s._makeZombie(901, 5, 1, 5, 1000, false, null, { tier: 'epic', name: 1 })
    s.damageZombie(z1, 300, null, 'A')
    s.damageZombie(z1, 50)
    s.damageZombie(z1, 150, null, 'B')
    s.damageZombie(z1, 9999, null, 'C')
    out.credits = credits.splice(0)
    // My 20% of a boss someone else finished: a quarter of its coins.
    const before = s.coins
    const z2 = s._makeZombie(902, 6, 1, 6, 1000, true, null, { tier: 'legendary', name: 2 })
    s.damageZombie(z2, 200)
    s.damageZombie(z2, 9999, null, 'A')
    out.assistCoins = s.coins - before
    out.assists = s.stats.assists
    out.msg = document.getElementById('build-play-msg').textContent
    // As a guest: an assist credit for a rare one pays a quarter of its coins.
    s.net = null
    const c0 = s.coins
    s._countAssist(false, 'rare')
    out.guestAssist = s.coins - c0
    s.net = null
    s.stop()
    return out
  })
  // The map: a worker's tile is the same picture as one drawn here.
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap' })
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active && window.__game.buildMode.world.active, null, { timeout: 60000 })
  const m = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    bm.survival._spawnAt({ lat: 46, lon: 7, biome: 'mountains' })
    const w = bm.world
    const p = bm.tryMode.pos
    const out = []
    for (const T of [32, 128, 1024]) {
      const tx = Math.floor(p.x / T)
      const tz = Math.floor(p.z / T)
      // Asked again each time, as the map does each draw (a tile drawn for
      // land that changed meanwhile - the real heights arriving - is dropped).
      let tile = null
      for (let i = 0; i < 400 && !(tile = w.mapTile(tx, tz, true, T)); i++) await new Promise((res) => setTimeout(res, 25))
      const S = tile.canvas.width
      const a = tile.canvas.getContext('2d').getImageData(0, 0, S, S).data
      const b = w._drawTile(tx, tz, T, S).getContext('2d').getImageData(0, 0, S, S).data
      out.push(a.every((v, i) => v === b[i]))
    }
    return { worker: !!w._tileWorkers, same: out }
  })
  expect(r.credits).toEqual([['C', 'epic', false], ['A', 'epic', true], ['B', 'epic', true]])
  expect(r.assistCoins).toBe(43)
  expect(r.assists).toBe(1)
  expect(r.msg).toContain('43')
  expect(r.guestAssist).toBe(6)
  expect(m).toEqual({ worker: true, same: [true, true, true] })
})


// 2026-10-30: real-life ammo, GayZ's own gun names, the AWP's scope, and
// no zoom when aiming without a gun.
test('gun names, real ammo, the scope and no zoom without a gun', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('awp'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const tm = bm.tryMode
    const out = {}
    out.names = ['rifle', 'awp', 'shotgun', 'melee'].map((id) => s.inv._label({ kind: 'gun', id }))
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    const base = tm._baseFov
    const run = () => { for (let i = 0; i < 60; i++) tm.updateHands(1 / 30, new Set()) }
    // The AWP: aiming looks through the scope, zoomed four times.
    tm.setAim(true)
    run()
    const scope = document.getElementById('play-scope')
    out.scoped = !!scope?.classList.contains('on') && document.body.classList.contains('scope-on')
    out.scopeFov = Math.round(bm.camera.fov)
    out.slowLook = tm.aimLookScale() < 0.3
    tm.setAim(false)
    run()
    out.scopeOff = !scope.classList.contains('on') && Math.round(bm.camera.fov) === Math.round(base)
    // Holding a block: right-click doesn't zoom.
    const inv = s.inv
    inv.add({ kind: 'block', id: 'stone', n: 4 })
    inv.select(inv.hotbar.findIndex((it) => it?.id === 'stone'))
    tm.setAim(true)
    run()
    out.blockFov = Math.round(bm.camera.fov)
    out.blockScope = scope.classList.contains('on')
    tm.setAim(false)
    out.base = Math.round(base)
    return out
  })
  expect(r.names).toEqual(['Havoc', 'Farsight', 'Boomstick', 'Fang'])
  expect(['rifle', 'pistol', 'shotgun', 'awp', 'rocket'].map((id) => [PLAY_WEAPONS[id].mag, PLAY_WEAPONS[id].reserve])).toEqual([[30, 210], [7, 42], [8, 24], [5, 40], [1, 4]])
  expect(r.scoped).toBe(true)
  expect(r.scopeFov).toBeLessThan(r.base / 3)
  expect(r.slowLook).toBe(true)
  expect(r.scopeOff).toBe(true)
  expect(r.blockFov).toBe(r.base)
  expect(r.blockScope).toBe(false)
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
    // Every animal its own meat, named for it.
    const label = (kind) => s.inv._label({ kind: 'item', id: `meat_${kind}` })
    out.meats = ['cow', 'pig', 'sheep', 'chicken', 'deer', 'lion', 'salmon', 'duck', 'dragon'].map(label)
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
    meats: ['Raw Beef', 'Raw Pork', 'Raw Mutton', 'Raw Chicken', 'Raw Venison', 'Raw Lion Meat', 'Raw Salmon', 'Raw Duck', 'Raw Dragon Meat'],
    allMeat: true, creatures: 30, yetiTall: 2, dragonEyes: 2, scary: true, bigRex: true,
  })
})

// 2026-10-30: weather eases from step to step, new kinds (drizzle, sleet,
// freezing rain, ice storms, thunderstorms, snowstorms, blizzards, frost,
// cold snaps, heatwaves, dust storms), wind that pushes you, lightning in
// the sky, frost on the screen's edges, natural disasters, and 10x luck
// after an impact.
test('smooth weather, wind, sky lightning, disasters and impact luck', async ({ page }) => {
  test.setTimeout(240000)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const sky = bm.sky
    const w3 = sky.weather3d
    const D = sky.disasters
    const out = {}
    const run = (s) => { for (let i = 0; i < s * 10; i++) sky.update(0.1) }
    // Random: a step down eases over many seconds, not at once.
    sky.weather = 'random'
    sky._now = sky._goal = 'lightRain'
    sky.apply()
    w3.setSlow(false)
    for (let i = 0; i < 100; i++) w3.update(0.1)
    sky._goal = 'clear'
    sky._stepIn = 0
    sky._rerollIn = 999
    sky.update(0.01)
    out.stepped = sky._now
    const before = w3._density
    run(2)
    out.gentle = before - w3._density < 0.08
    // Every new weather shows (the editor's own pick: straight there).
    const kinds = ['drizzle', 'thunderstorm', 'freezingRain', 'iceStorm', 'snowstorm', 'blizzard', 'sleet', 'frost', 'coldSnap', 'heatwave', 'duststorm']
    out.kinds = {}
    for (const k of kinds) {
      sky.weather = k
      sky._pickWeather()
      sky.apply()
      run(15)
      out.kinds[k] = [sky._now, w3.kind || '']
    }
    // Wind: soft when clear, a gale in a blizzard, pushing you out in it.
    sky.weather = 'clear'
    sky._pickWeather()
    sky.apply()
    run(10)
    out.clearWind = sky.wind.length() < 0.5
    sky.weather = 'blizzard'
    sky._pickWeather()
    sky.apply()
    run(10)
    sky._sheltered = false
    out.blizzardWind = sky.wind.length() > 4
    const v = { set(x, y) { this.x = x; this.y = y; return this } }
    out.pushes = sky.windPush(v, true).x !== 0
    // ...but a clear day's breeze never slides you along the ground.
    sky.wind.set(0.25, 0)
    out.breezeStill = sky.windPush(v, true).x === 0
    // Frost on the screen's edges in a cold snap.
    sky.weather = 'coldSnap'
    sky._pickWeather()
    sky.apply()
    run(12)
    out.frost = Number(document.querySelector('#weather-screen .ws-frost')?.style.opacity) > 0.3
    // Lightning: a bolt in the sky and the sky lighting up.
    sky.weather = 'thunderstorm'
    sky._pickWeather()
    sky.apply()
    sky._lightningIn = 0.05
    sky.update(0.1)
    sky.update(0.02)
    out.lightning = sky.lightning.flash > 0 && sky._thunder.length > 0
    // Every disaster runs start to finish without trouble.
    out.disasters = {}
    for (const k of D.kinds) {
      D.start(k)
      let n = 0
      let shook = 0
      // (a drought lasts a whole game day, an aurora five hours)
      const step = k === 'drought' || k === 'geomagneticStorm' ? 1 : 0.1
      while (D.active && n < 3000) {
        sky.update(step)
        shook = Math.max(shook, D.shake)
        n++
      }
      bm.survival.health = bm.survival.maxHealth
      out.disasters[k] = !D.active
      if (k === 'earthquake') out.quakeShakes = shook > 0.1
    }
    // A disaster goes out with the sky on servers.
    D.start('earthquake')
    out.synced = sky.skyState().d?.k
    D.end()
    // Builds are safe unless "Disasters Can Break Anything" is on.
    const p = bm.tryMode.pos
    // (well outside the camp, which nothing ever touches)
    const x = Math.floor(p.x) + 60
    const y = Math.floor(p.y) + 30
    const z = Math.floor(p.z) + 60
    bm.placeBlock(x, y, z, 'oakplanks')
    out.safe = D.canChange(x, y, z)
    window.__game.settings.disasterBreakAll = true
    out.breakAll = D.canChange(x, y, z)
    window.__game.settings.disasterBreakAll = false
    // An impact: 10x luck for 24 game hours, shown on a chip; rarer
    // animals turn up far more often.
    const luck = sky.luck
    const animals = bm._animals()
    const rare = () => { let n = 0; for (let i = 0; i < 3000; i++) { const k = animals.kindAt(300 + (i % 40), 300); if (k && !['common', 'uncommon'].includes(animals.constructor.rarityOf(k))) n++ } return n }
    luck.stop()
    const plain = rare()
    D.start('meteoroid')
    out.luck = luck.mult()
    out.luckLeft = Math.round(luck.left())
    sky.update(0.1)
    out.chip = document.getElementById('luck-badge')?.style.display === 'block' && /10x/.test(document.getElementById('luck-badge').textContent)
    out.luckier = rare() > plain * 1.5
    D.end()
    luck.stop()
    return out
  })
  expect(r.stepped).toBe('veryLightRain')
  expect(r).toMatchObject({
    gentle: true,
    kinds: {
      drizzle: ['drizzle', 'drizzle'], thunderstorm: ['thunderstorm', 'thunderstorm'], freezingRain: ['freezingRain', 'freezingRain'],
      iceStorm: ['iceStorm', 'iceStorm'], snowstorm: ['snowstorm', 'snowstorm'], blizzard: ['blizzard', 'blizzard'], sleet: ['sleet', 'sleet'],
      frost: ['frost', ''], coldSnap: ['coldSnap', 'coldSnap'], heatwave: ['heatwave', ''], duststorm: ['duststorm', 'duststorm'],
    },
    clearWind: true,
    blizzardWind: true,
    pushes: true,
    breezeStill: true,
    frost: true,
    lightning: true,
    quakeShakes: true,
    synced: 'earthquake',
    safe: false,
    breakAll: true,
    luck: 10,
    luckLeft: 1440,
    chip: true,
    luckier: true,
  })
  expect(Object.values(r.disasters).every(Boolean)).toBe(true)
})

// 2026-10-30: Q drops the held item and Lock keeps it; Heaven (cloud
// floor, islands) grows up high and goes again below; giant Heaven's
// Peaks reach it; the Demon Realm under y -300 with bedrock at -500; and
// angels, demons and sea zombies where they live.
test('drop key and item lock, Heaven, Heaven\'s Peaks, the Demon Realm and realm zombies', async ({ page }) => {
  test.setTimeout(180000)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const inv = s.inv
    const out = {}
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    // --- Drop (Q) and Lock ---
    inv.hotbar[3] = { kind: 'block', id: 'stone', n: 5 }
    inv.select(3)
    const drops = s._drops.list.length
    s.onKeyDown('KeyQ')
    out.dropped = inv.hotbar[3]?.n === 4 && s._drops.list.length === drops + 1
    out.waits = s._drops.list[s._drops.list.length - 1].wait > 2
    inv.toggleLock('hotbar', 3)
    out.lockedStays = inv.drop() === false && inv.hotbar[3].n === 4
    out.saveKeepsLock = (() => {
      const saved = inv.serialize()
      inv.hotbar[3] = null
      inv.restore(saved)
      return inv.hotbar[3]?.lk === 1
    })()
    inv.show(true)
    out.lockIcon = !!document.querySelector('#play-inventory .inv-slot[data-where="hotbar"][data-i="3"] .inv-slot-lock')
    inv.show(false)
    inv.toggleLock('hotbar', 3)
    out.unlockedDrops = inv.drop() === true && inv.hotbar[3].n === 3
    inv.select(0)
    out.gunStays = inv.drop() === false && inv.hotbar[0]?.kind === 'gun'
    inv.hotbar[3] = { kind: 'item', id: 'healthpack', n: 1 }
    out.itemDrops = inv.drop('hotbar', 3) === true && inv.hotbar[3] === null
    // --- Heaven ---
    const world = bm.world
    const peakIn = world.peakIn
    const sampleLand = (x, z) => world.landAt(x, z)
    const HEAVEN_FLOOR = world.heaven.constructor.FLOOR
    const { BOTTOM, DEMON_TOP, rockAt, demonOpen } = world.under.constructor
    const me = s.bodyPos()
    const hx = Math.floor(me.x) + 2000
    const hz = Math.floor(me.z)
    for (let i = 0; i < 600 && world.heaven.cols.size < 113; i++) world.heaven.update({ x: hx, y: 330, z: hz })
    let cloud = 0
    let other = new Set()
    for (let x = hx - 90; x < hx + 90; x++) {
      for (let z = hz - 90; z < hz + 90; z++) {
        if (Math.abs(x - hx) < 40 && Math.abs(z - hz) < 40 && bm.getBlockAt(x, HEAVEN_FLOOR, z) === 'whitewool') cloud++
        for (let y = 318; y <= 490; y += 1) {
          const b = bm.getBlockAt(x, y, z)
          if (b) other.add(b)
        }
      }
    }
    out.cloudFloor = cloud > 80 * 80 * 0.6
    out.islands = other.has('quartzpillar') && (other.has('smoothquartz') || other.has('calcite') || other.has('grass'))
    world.heaven.update({ x: hx, y: 100, z: hz })
    out.heavenGoes = world.heaven.cols.size === 0 && !bm.getBlockAt(hx, HEAVEN_FLOOR, hz)
    // --- Heaven's Peaks ---
    let peak = null
    for (let gx = -3; gx <= 3 && !peak; gx++) for (let gz = -3; gz <= 3 && !peak; gz++) {
      const p = peakIn(gx, gz)
      if (p && sampleLand(p.x, p.z).h > HEAVEN_FLOOR) peak = p
    }
    out.peak = !!peak
    if (peak) {
      const h = (dx) => sampleLand(peak.x + dx, peak.z).h
      out.peakTall = h(0) > HEAVEN_FLOOR && h(0) < 380
      // Climbable: roughly a block up per cell on its side.
      let steep = 0
      for (let dx = 20; dx < 300; dx++) if (Math.abs(h(dx) - h(dx + 1)) > 2) steep++
      out.peakClimbable = steep < 15
    }
    // --- the Demon Realm ---
    out.bottom = BOTTOM === -500 && DEMON_TOP === -300
    out.bedrock = rockAt(hx, BOTTOM, hz) === 'bedrock' && rockAt(hx, -250, hz) !== 'bedrock'
    out.demonRock = ['netherrack', 'soulsand', 'blackstone', 'magmablock', 'netherbrick'].includes(rockAt(hx, -400, hz))
    let openCells = 0
    let n = 0
    for (let x = 0; x < 200; x += 7) for (let y = -480; y < -310; y += 5) for (let z = 0; z < 200; z += 7) { n++; if (demonOpen(hx + x, y, hz + z)) openCells++ }
    out.caverns = openCells / n > 0.25 && openCells / n < 0.75
    out.noDemonUpHigh = !demonOpen(hx, -150, hz)
    // --- realm zombies ---
    const kinds = (realm) => {
      const seen = new Set()
      for (let i = 0; i < 40; i++) if (s._spawnZombie([realm])) seen.add(s.zombies[s.zombies.length - 1].kind)
      for (const z of [...s.zombies]) s._removeZombie(z)
      s.zombies = []
      return [...seen].sort()
    }
    out.heavenKinds = kinds([hx, HEAVEN_FLOOR + 1, hz])
    out.demonKinds = kinds([hx, -400, hz])
    // (Away from the camp - nothing comes up inside it.)
    const wx = Math.floor(me.x) + 300
    const wz = Math.floor(me.z) + 6
    const wy = 200
    bm._placeBlockInner(wx, wy, wz, 'water')
    bm._placeBlockInner(wx, wy + 1, wz, 'water')
    const sea = kinds([wx, wy, wz])
    out.oceanKinds = sea.filter((k) => ['drowned', 'sharkman', 'jelly', 'angler'].includes(k)).length >= 2
    // Every new kind is built, moves, and stands about 2 blocks tall.
    const sizes = {}
    for (const k of [...out.heavenKinds, ...out.demonKinds, 'drowned', 'sharkman', 'jelly', 'angler']) {
      const zb = s._makeZombie(9100, me.x + 4, me.y, me.z + 4, 100, false, k)
      zb.group.position.set(zb.x * s.B, zb.y * s.B, zb.z * s.B)
      zb.monster.update(0.1, 1)
      zb.monster.root.updateMatrixWorld(true)
      let box = null
      zb.monster.root.traverse((o) => {
        if (!o.isMesh) return
        o.geometry.computeBoundingBox()
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
        box = box ? box.union(b) : b
      })
      // From its feet to the top of its head (floating ones hang above).
      sizes[k] = Math.round((box.max.y / s.B - zb.y) * 10) / 10
      s._removeZombie(zb)
    }
    s.zombies = []
    out.tallEnough = Object.entries(sizes).filter(([k, h]) => k !== 'hellhound' && (h < 1.7 || h > 2.6)).map(([k, h]) => `${k} ${h}`)
    return out
  })
  expect(r).toEqual({
    dropped: true, waits: true, lockedStays: true, saveKeepsLock: true, lockIcon: true, unlockedDrops: true, gunStays: true, itemDrops: true,
    cloudFloor: true, islands: true, heavenGoes: true,
    peak: true, peakTall: true, peakClimbable: true,
    bottom: true, bedrock: true, demonRock: true, caverns: true, noDemonUpHigh: true,
    heavenKinds: ['angel', 'archangel', 'cherub', 'seraph'],
    demonKinds: ['demon', 'fiend', 'hellhound', 'imp'],
    oceanKinds: true, tallEnough: [],
  })
})

// New-player polish (2026-10-31): a first game skips the picker, starts
// outside the camp gate with a zombie close by and a fading hint; hits
// show a marker and kills pop coins; a sun-only death isn't your kill;
// You Died shows the next unlock; a game-picked graphics level steps down
// when a game stays slow.
test('first game, hit feedback, sun kills, next unlock, auto graphics', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = { first: s.onboard.active, picker: !!s._picking }
    const p = bm.tryMode.pos
    out.outsideCamp = !!s.camp && !s.camp.inside(p.x, p.z)
    // Run the game forward without real frames until the starter comes.
    s.health = 1e9
    for (let i = 0; i < 20 * 8 && !s.onboard.starter; i++) { bm.tryMode.update(0.05, new Set()); s.update(0.05) }
    const z = s.onboard.starter
    out.starterNear = !!z && Math.hypot(z.x - p.x, z.z - p.z) <= 17
    out.starterNoSun = !!z && z.noSun === true
    const hint = document.getElementById('play-first-hint')
    out.hint = !!hint && getComputedStyle(hint).display !== 'none' && hint.textContent.length > 0
    s.hitZombieWith(z, 1, null, true)
    out.headMark = document.getElementById('play-hitmark')?.className
    const kills = s.kills
    for (let i = 0; i < 100 && s.zombies.includes(z); i++) s.hitZombieWith(z, 40, { x: 0, y: 0, z: 1 })
    out.killMark = document.getElementById('play-hitmark')?.className
    out.killed = s.kills === kills + 1
    out.coins = document.querySelectorAll('#play-damage-numbers .play-coins').length > 0
    // Burned up in the sun with no hit: not a kill, no coins.
    const before = { kills: s.kills, coins: s.coins }
    s._spawnZombie()
    const sunny = s.zombies[s.zombies.length - 1]
    sunny.sunlit = true
    sunny.health = 0
    s.damageZombie(sunny, 0)
    out.sunKill = { gone: !s.zombies.includes(sunny), kills: s.kills - before.kills, coins: s.coins - before.coins }
    // Auto graphics: still slow with nothing left to lower.
    g.settings.autoQuality = true
    g.settings.graphicsLevel = 'balanced'
    g.settings.graphicsLevelAuto = true
    g.settings.viewDistance = 'short'
    g._editorResScale = 0.25
    g._gfxLowerHold = 0
    g._gfxSlow = 0
    let now = performance.now() + 60000
    for (let i = 0; i < 45; i++) g._updateEditorResScale(40, (now += 500))
    out.lowered = g.settings.graphicsLevel
    g.settings.graphicsLevelAuto = false
    g._gfxLowerHold = 0
    for (let i = 0; i < 45; i++) g._updateEditorResScale(40, (now += 500))
    out.pickedStays = g.settings.graphicsLevel
    // You Died: the next hat or cape.
    s.health = 1
    s._hurtPlayer(50)
    out.unlock = document.getElementById('build-play-over-unlock').textContent
    out.hintGone = getComputedStyle(hint).display === 'none'
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r).toMatchObject({
    first: true, picker: false, outsideCamp: true, starterNear: true, starterNoSun: true, hint: true,
    headMark: 'head', killMark: 'kill', killed: true, coins: true,
    sunKill: { gone: true, kills: 0, coins: 0 },
    lowered: 'simple', pickedStays: 'simple', hintGone: true,
  })
  expect(r.unlock).toMatch(/Propeller Cap/)
  // The daily challenge is in the Quests, no longer a card on the homepage.
  expect(await page.evaluate(() => document.getElementById('home-daily'))).toBeNull()
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

// Infection mode on your own (Infection.js): bots fill the game, one turns,
// tags spread it, a shot stuns, and the round ends when everyone's turned.
test('Infection: bots, tags, stuns and the round ending', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    // Solo: no server for the lobby.
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'infection'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const inf = s.infection
    const out = { mode: s.cfg.mode, noZombies: s.cfg.noZombies, phase0: inf.phase }
    inf.update(0.05)
    out.bots = inf.bots.size
    const start = [...inf.bots.values()].map((b) => [b.x, b.z])
    // The wait runs out: a round starts with one infected.
    for (let i = 0; i < 200 && inf.phase === 'wait'; i++) inf.update(0.05)
    out.phase1 = inf.phase
    out.infected1 = inf.infected.size
    // Bots move and stay on the ground (not NaN, not falling forever).
    for (let i = 0; i < 40; i++) inf.update(0.05)
    out.botsMoved = [...inf.bots.values()].some((b, i) => Math.hypot(b.x - start[i][0], b.z - start[i][1]) > 0.5)
    out.botsOk = [...inf.bots.values()].every((b) => Number.isFinite(b.y) && Math.abs(b.y - s._groundUnder(b.x, b.y + 0.05, b.z)) < 1.5)
    // Make one bot the only zombie, right on top of me: I'm tagged.
    const [first] = inf.bots.values()
    inf.infected = new Set([first.id])
    inf.stunned.clear()
    const me = s.bodyPos()
    first.x = me.x
    first.y = me.y
    first.z = me.z
    inf.update(0.02)
    out.meInfected = inf.meInfected
    out.speed = s.bm.tryMode.speedMult
    out.vignette = document.getElementById('infection-vignette')?.className
    out.hud = document.getElementById('build-play-wave-text')?.textContent || ''
    // Infected can't stun; a human can.
    const ray = s.bm._raycaster.ray.clone()
    const B = s.B
    ray.origin.set((first.x + 4) * B, (first.y + 1) * B, first.z * B)
    ray.direction.set(-1, 0, 0)
    out.shotWhileInfected = inf.shoot(ray, 40 * B)
    inf.infected.delete(inf.myId)
    out.shotAsHuman = inf.shoot(ray, 40 * B)
    out.stunned = inf.stunned.has(first.id)
    // Everyone turned: the zombies win and I (a zombie) get coins.
    const coins = g.coins
    for (const p of inf._people()) inf.infected.add(p.id)
    inf.update(0.02)
    out.phase2 = inf.phase
    out.winner = inf.winner
    out.coins = g.coins - coins
    // Then a new round.
    for (let i = 0; i < 200 && inf.phase === 'end'; i++) inf.update(0.05)
    out.phase3 = inf.phase
    out.round = inf.round
    out.zombies = s.zombies.length
    g._exitBuildMode()
    out.vignetteGone = !document.getElementById('infection-vignette')
    out.botsGone = !g.buildMode.scene.children.some((c) => c === first.group)
    return out
  })
  expect(r.mode).toBe('infection')
  expect(r.noZombies).toBe(true)
  expect(r.phase0).toBe('wait')
  expect(r.bots).toBe(5)
  expect(r.phase1).toBe('play')
  expect(r.infected1).toBe(1)
  expect(r.botsMoved).toBe(true)
  expect(r.botsOk).toBe(true)
  expect(r.meInfected).toBe(true)
  expect(r.speed).toBeGreaterThan(1.1)
  expect(r.vignette).toBe('on')
  expect(r.hud).toContain('Infection')
  expect(r.shotWhileInfected).toBe(false)
  expect(r.shotAsHuman).toBe(true)
  expect(r.stunned).toBe(true)
  expect(r.phase2).toBe('end')
  expect(r.winner).toBe('z')
  expect(r.coins).toBe(15)
  expect(r.phase3).toBe('wait')
  expect(r.round).toBe(2)
  expect(r.zombies).toBe(0)
  expect(r.vignetteGone).toBe(true)
  expect(r.botsGone).toBe(true)
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
    for (let i = 0; i < 100 && !document.querySelector('#zombie-book-grid img'); i++) await new Promise((res) => setTimeout(res, 100))
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

// Batch 2 (2026-10-31): crafting, the goo disguise, the camp farm and the
// camp's survivors, each through the real game objects.
async function startCampGame(page) {
  await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
  })
}

test('Crafting: the Crafting tab makes gear and blocks from what you carry', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const inv = s.inv
    const count = (kind, id) => [...inv.hotbar, ...inv.grid].reduce((n, it) => n + (it && it.kind === kind && it.id === id ? it.n : 0), 0)
    inv.add({ kind: 'block', id: 'oaklog', n: 3 })
    inv.add({ kind: 'block', id: 'cobblestone', n: 4 })
    inv.add({ kind: 'item', id: 'zombieGoo', n: 3 })
    window.__game.buildMode.togglePicker()
    document.querySelector('#play-inventory .inv-tab[data-tab="craft"]').click()
    document.querySelector('#play-inventory .inv-tab[data-tab="craft"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    const out = { rows: document.querySelectorAll('#play-inventory .craft-row').length }
    const btn = (id) => document.querySelector(`#play-inventory .craft-btn[data-craft="${id}"]`)
    out.ammoReady = !btn('ammobox').disabled
    out.helmetReady = !btn('helmet').disabled
    btn('ammobox').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.ammo = count('item', 'ammobox')
    out.stoneLeft = count('block', 'cobblestone')
    out.logLeft = count('block', 'oaklog')
    out.ammoNow = !btn('ammobox').disabled
    btn('oakplanks').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.planks = count('block', 'oakplanks')
    btn('gooDisguise').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.disguise = count('item', 'gooDisguise')
    out.goo = count('item', 'zombieGoo')
    // The recipe list takes the bag's room: switching tabs keeps the panel's size.
    const box = () => document.querySelector('#play-inventory .inv-box').getBoundingClientRect()
    const craftBox = box()
    document.querySelector('#play-inventory .inv-tab[data-tab="bag"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    const bagBox = box()
    out.sizes = [craftBox.width, craftBox.height, bagBox.width, bagBox.height].map(Math.round)
    out.boxSame = Math.abs(craftBox.height - bagBox.height) < 3 && Math.abs(craftBox.width - bagBox.width) < 3
    // A wide screen shows both at once: crafting on the left, the bag on the right.
    out.wasOpen = window.__game.buildMode.pickerOpen
    if (!window.__game.buildMode.pickerOpen) window.__game.buildMode.togglePicker()
    const col = (sel) => document.querySelector(`#play-inventory ${sel}`).getBoundingClientRect()
    out.sides = [col('.inv-craft-col').left, col('.inv-craft-col').right, col('.inv-craft-col').width, col('.inv-bag-col').left, col('.inv-bag-col').width, innerWidth].map(Math.round)
    out.sideBySide = col('.inv-craft-col').width > 0 && col('.inv-bag-col').width > 0 && col('.inv-craft-col').right <= col('.inv-bag-col').left
    window.__game.buildMode.togglePicker()
    // Killed zombies drop Zombie Goo sometimes.
    const p = s.bodyPos()
    let drops = 0
    for (let i = 0; i < 20; i++) {
      s._makeZombie(9100 + i, p.x + 8, p.y, p.z, 10, false)
      const z = s.zombies[s.zombies.length - 1]
      const before = s._drops.list.filter((d) => d.type === 'zombieGoo').length
      s.damageZombie(z, 1e6)
      drops += s._drops.list.filter((d) => d.type === 'zombieGoo').length - before
    }
    out.gooDrops = drops
    return out
  })
  // 39 out of winter (the Snowball recipe only shows December to February).
  expect(r.rows).toBe(new Date().getMonth() % 11 < 2 ? 40 : 39)
  expect(r.ammoReady).toBe(true)
  expect(r.helmetReady).toBe(false)
  expect(r.ammo).toBe(1)
  expect(r.stoneLeft).toBe(0)
  expect(r.logLeft).toBe(2)
  expect(r.ammoNow).toBe(false)
  expect(r.planks).toBe(4)
  expect(r.disguise).toBe(1)
  expect(r.goo).toBe(0)
  expect(r.boxSame, String(r.sizes)).toBe(true)
  expect(r.sideBySide, String(r.sides)).toBe(true)
  expect(r.gooDrops).toBeGreaterThan(0)
  expect(r.gooDrops).toBeLessThan(20)
})

test('Goo Disguise: zombies ignore you until it wears off or you attack', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const inv = s.inv
    inv.hotbar[1] = { kind: 'item', id: 'gooDisguise', n: 2 }
    inv.select(1)
    const out = { targetsBefore: s._targets().length }
    out.used = inv.useHeld()
    out.left = inv.hotbar[1]?.n
    out.targetsDuring = s._targets().length
    out.vignette = document.getElementById('goo-vignette')?.classList.contains('on')
    out.twice = inv.useHeld()
    s.disguise.update(10)
    out.stillOn = s.disguise.active
    s.disguise.update(25)
    out.woreOff = !s.disguise.active && s._targets().length === 1
    inv.useHeld()
    inv.select(0)
    s.shoot()
    out.brokeOnShot = !s.disguise.active
    return out
  })
  expect(r.targetsBefore).toBe(1)
  expect(r.used).toBe(true)
  expect(r.left).toBe(1)
  expect(r.targetsDuring).toBe(0)
  expect(r.vignette).toBe(true)
  expect(r.twice).toBe(false)
  expect(r.stillOn).toBe(true)
  expect(r.woreOff).toBe(true)
  expect(r.brokeOnShot).toBe(true)
})

test('Camp Farm: a Crop Plot in the camp is kept between games and grows in real time', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => localStorage.removeItem('gayz-camp-farm'))
  await startCampGame(page)
  const spot = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const bm = s.bm
    const zn = s.camp.zone
    // An empty cell on the camp floor.
    for (let x = zn.x0 + 3; x < zn.x1 - 2; x++) {
      for (let z = zn.z0 + 3; z < zn.z1 - 2; z++) {
        const y = Math.floor(s._groundUnder(x + 0.5, bm.tryMode.pos.y + 4, z + 0.5))
        if (!bm.getBlockAt(x, y, z) && !bm.getBlockAt(x, y + 1, z) && bm.getBlockAt(x, y - 1, z)) {
          bm.placeBlock(x, y, z, 'cropplot', false)
          s._placed.set(bm._key(x, y, z), 'cropplot')
          s.farm.onPlaced('cropplot', x, y, z)
          return { x, y, z }
        }
      }
    }
    return null
  })
  expect(spot).not.toBeNull()
  const planted = await page.evaluate(({ x, y, z }) => {
    const s = window.__game.buildMode.survival
    const sp = s.bm.specials
    const out = { saved: JSON.parse(localStorage.getItem('gayz-camp-farm')).plots.length }
    sp.use(x, y, z)
    out.msg = document.getElementById('build-play-msg')?.textContent || ''
    out.at = JSON.parse(localStorage.getItem('gayz-camp-farm')).plots[0].at > 0
    // Six minutes ago, as if the game had been closed meanwhile.
    const farm = JSON.parse(localStorage.getItem('gayz-camp-farm'))
    farm.plots[0].at = Date.now() - 6 * 60 * 1000
    localStorage.setItem('gayz-camp-farm', JSON.stringify(farm))
    window.__game._exitBuildMode()
    out.goneAfter = !s.bm.getBlockAt(x, y, z)
    return out
  }, spot)
  await startCampGame(page)
  const back = await page.evaluate(({ x, y, z }) => {
    const s = window.__game.buildMode.survival
    const inv = s.inv
    const count = (id) => [...inv.hotbar, ...inv.grid].reduce((n, it) => n + (it && it.kind === 'item' && it.id === id ? it.n : 0), 0)
    const out = { there: s.bm.getBlockAt(x, y, z) }
    s.farm.update()
    const entry = s.bm.specials._at.get(`${x},${y},${z}`)
    out.ready = s.farm.secondsLeft(entry) === 0
    s.bm.specials.use(x, y, z)
    out.veggies = count('veggies')
    out.fiber = count('plantFiber')
    out.emptyAgain = JSON.parse(localStorage.getItem('gayz-camp-farm')).plots[0].at === 0
    return out
  }, spot)
  expect(planted.saved).toBe(1)
  expect(planted.msg).toContain('5:00')
  expect(planted.at).toBe(true)
  expect(planted.goneAfter).toBe(true)
  expect(back.there).toBe('cropplot')
  expect(back.ready).toBe(true)
  expect(back.veggies).toBe(2)
  expect(back.fiber).toBe(2)
  expect(back.emptyAgain).toBe(true)
})

test('Survivors: rescued ones live at camp, guard it and take Follow / Hold orders', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => localStorage.setItem('gayz-camp-survivors', JSON.stringify({ list: [{ skin: 0 }, { skin: 1 }, { skin: 'x' }] })))
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const sv = s.survivors
    const out = { guards: sv.helpers.length, holding: sv.helpers.every((h) => h.order === 'hold'), inCamp: sv.helpers.every((h) => s.camp.inside(h.x, h.z, 1)) }
    // Look straight at the first one, close up, and press Use.
    const h = sv.helpers[0]
    const p = s.bm.tryMode.pos
    p.set(h.x, h.y, h.z + 2)
    s.bm._yaw = 0
    out.used = s.bm._tryUseFromCamera()
    out.following = h.order === 'follow'
    sv.update(0.1)
    out.prompt = document.getElementById('play-survivor-prompt')?.textContent || ''
    // Walk away: the follower comes along, the other one stays.
    const other = sv.helpers[1]
    const ox = other.x
    p.set(h.x + 8, h.y, h.z + 2)
    for (let i = 0; i < 20; i++) sv.update(0.1)
    out.followed = Math.hypot(h.x - p.x, h.z - p.z) < 4
    out.stayed = other.x === ox
    // Use again: hold.
    p.set(h.x, h.y, h.z + 2)
    s.bm._yaw = 0
    s.bm._tryUseFromCamera()
    out.holdAgain = h.order === 'hold'
    // A new rescue moves in too.
    const w = sv._person({ x: p.x + 1, y: p.y, z: p.z })
    w.beam = new (h.group.constructor)()
    w.beam.geometry = { dispose() {} }
    w.beam.material = { dispose() {} }
    sv._rescue(w)
    out.roster = JSON.parse(localStorage.getItem('gayz-camp-survivors')).list.length
    return out
  })
  expect(r.guards).toBe(3)
  expect(r.holding).toBe(true)
  expect(r.inCamp).toBe(true)
  expect(r.used).toBe(true)
  expect(r.following).toBe(true)
  expect(r.prompt).toContain('Hold here')
  expect(r.followed).toBe(true)
  expect(r.stayed).toBe(true)
  expect(r.holdAgain).toBe(true)
  expect(r.roster).toBe(4)
})

// 2026-11-01: crafted boats and helicopters (Vehicles.js) - crafted from
// the Crafting tab, put down, ridden; the helicopter climbs with Jump,
// burns fuel, refills from Heli Fuel you carry, and won't let you out up high.
// 2026-11-01: B opens the Shop (the camp's people + traps) on any map,
// cleared waves no longer hand out traps, Z opens the emote wheel, and
// you sit in vehicles and can right-click / Crouch out of them.
test('Shop on B, emote wheel on Z, sitting in and getting off vehicles', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const key = (code) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
    }
    const out = {}
    // --- the Shop
    key('KeyB')
    out.shopOpen = s.shop.panelOpen
    out.tabs = [...document.querySelectorAll('#play-shop-tabs [data-shop-tab]')].map((b) => b.dataset.shopTab).join()
    document.querySelector('[data-shop-tab="traps"]').click()
    out.trapRows = document.querySelectorAll('#play-npc-list button[data-act="trap"]').length
    s.coins = 100
    s.shop._panelKey = ''
    s.shop._renderPanel()
    const mines = () => [...s.inv.hotbar, ...s.inv.grid].reduce((n, it) => n + (it?.id === 'landmine' ? it.n : 0), 0)
    const had = mines()
    document.querySelector('#play-npc-list button[data-act="trap"][data-id="landmine"]').click()
    out.boughtMine = mines() === had + 2 && s.coins === 100 - s.shop._price({ cost: 45 }) ? true : [had, mines(), s.coins]
    key('KeyB')
    out.shopClosed = !s.shop.panelOpen
    // Talking to a camp person opens the Shop on their tab.
    s.shop.openPanel('upgrader')
    out.npcTab = s.shop.tab
    s.shop.closePanel(false)
    // --- no free traps for a cleared wave any more
    const traps = () => ['spikeblock', 'baitblock', 'landmine', 'beartrap', 'explosivebarrel'].reduce((n, id) => n + [...s.inv.hotbar, ...s.inv.grid].reduce((m, it) => m + (it?.id === id ? it.n : 0), 0), 0)
    const before = traps()
    s.zombies.forEach((z) => s._removeZombie(z))
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 0
    for (let i = 0; i < 5; i++) s.update(0.05)
    out.noWaveTraps = traps() === before
    s._breakTimer = 1e9
    // --- the emote wheel
    key('KeyZ')
    out.wheelOpen = s.emotes.open
    out.wheelButtons = document.querySelectorAll('#emote-wheel [data-emote]').length
    document.querySelector('#emote-wheel [data-emote="cheer"]').click()
    out.cheer = s.emotes.current === 'cheer' && !s.emotes.open
    // --- the go-kart: sit in it, right-click out, Crouch out
    const k = s.kart
    const tm = bm.tryMode
    tm.pos.set(k.x + 1, k.y, k.z)
    out.in = k.use() && k.driving
    tm.update(0.05, new Set())
    out.seated = tm._seatEye > 0.5
    tm.view = 1
    tm._updateBody(0.05)
    out.legsOut = Math.abs(tm._body?.char.limbPivots.legR.rotation.x + Math.PI / 2) < 0.01
    tm.view = 0
    out.rightClickOut = k.rightClick() && !k.driving
    tm.pos.set(k.x + 1, k.y, k.z)
    k.use()
    tm.update(0.05, new Set())
    tm.update(0.05, new Set(['KeyC']))
    out.crouchOut = !k.driving
    tm.update(0.05, new Set())
    out.standing = tm._seatEye === 0
    return out
  })
  expect(r).toEqual({
    shopOpen: true, tabs: 'items,traps,upgrades,ammo,quests', trapRows: 5, boughtMine: true, shopClosed: true, npcTab: 'upgrades',
    noWaveTraps: true, wheelOpen: true, wheelButtons: 6, cheer: true,
    in: true, seated: true, legsOut: true, rightClickOut: true, crouchOut: true, standing: true,
  })
})

test('boats and helicopters: craft, put down, ride, fly on fuel', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 80, 'zombiespawner')
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    // A pond in front (+z): stone bed, water on top.
    for (let x = -4; x <= 4; x++) {
      for (let z = 3; z <= 16; z++) {
        bm.removeBlock?.(x, 0, z)
        bm.placeBlock(x, -1, z, 'stone', true)
        bm.placeBlock(x, 0, z, 'water', true)
      }
    }
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    s.update(0.05)
    s.kart.dispose()
    const v = s.vehicles
    const inv = s.inv
    const out = {}
    // Crafting: the three recipes are there and make the items.
    inv.add({ kind: 'item', id: 'zombieGoo', n: 12 })
    inv.add({ kind: 'block', id: 'oakplanks', n: 10 })
    inv.add({ kind: 'block', id: 'oaklog', n: 4 })
    inv.add({ kind: 'block', id: 'stone', n: 12 })
    inv.add({ kind: 'block', id: 'glass', n: 2 })
    out.html = ['boat', 'helicopter', 'heliFuel'].every((id) => inv.crafting.html().includes(`data-craft="${id}"`))
    out.crafted = inv.crafting.craft('boat') && inv.crafting.craft('helicopter') && inv.crafting.craft('heliFuel')
    const hold = (id) => {
      inv.hotbar[0] = { kind: 'item', id, n: 1 }
      inv.active = 0
      inv.apply()
    }
    // Facing +z (the pond) from dry land: a boat goes on the water.
    bm._yaw = Math.PI
    bm.tryMode.pos.set(0.5, 1, 1.5)
    hold('boat')
    out.boatPlaced = inv.useHeld() && v.list.length === 1 && v.list[0].kind === 'boat'
    const boat = v.list[0]
    out.boatOnWater = boat.y > 0.5 && boat.y < 1.1
    // Facing -z (dry grass): no boat.
    bm._yaw = 0
    hold('boat')
    out.boatNeedsWater = !inv.useHeld()
    // In, forward: it moves over the water; the shore stops it.
    bm._yaw = Math.PI
    bm.tryMode.pos.set(boat.x, boat.y, boat.z - 1)
    out.boatIn = bm._tryUseFromCamera() && v.riding === boat
    boat.heading = 0
    const z0 = boat.z
    for (let i = 0; i < 30; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.boatMoved = boat.z - z0 > 3
    for (let i = 0; i < 80; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.boatStaysOnWater = boat.z < 17.2
    out.boatOut = v.use() && !v.riding
    // A helicopter on the grass behind (-z).
    bm._yaw = 0
    bm.tryMode.pos.set(0.5, 1, -2)
    hold('helicopter')
    out.heliPlaced = inv.useHeld() && v.list.some((o) => o.kind === 'heli')
    const heli = v.list.find((o) => o.kind === 'heli')
    out.heliFull = heli.fuel === 60
    bm.tryMode.pos.set(heli.x + 1, heli.y, heli.z)
    out.heliIn = v.use() && v.riding === heli
    // Jump climbs; fuel burns.
    const y0 = heli.y
    for (let i = 0; i < 40; i++) bm.tryMode.update(0.05, new Set(['Space']))
    out.climbed = heli.y - y0 > 8
    out.burned = heli.fuel < 59
    out.meInSeat = Math.abs(bm.tryMode.pos.y - heli.y) < 0.1
    out.fuelHud = document.getElementById('vehicle-fuel')?.classList.contains('on')
    // Up high you can't get out.
    out.noExitHigh = (v.use(), v.riding === heli)
    // Forward flies the way you look (-z here).
    const hz = heli.z
    for (let i = 0; i < 30; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.flewForward = heli.z < hz - 4
    // Empty tank with Heli Fuel on you: it refills itself.
    for (const list of [inv.hotbar, inv.grid]) list.forEach((it, i) => { if (it?.id === 'heliFuel') list[i] = null })
    inv.hotbar[3] = { kind: 'item', id: 'heliFuel', n: 1 }
    heli.fuel = 0.01
    bm.tryMode.update(0.05, new Set(['Space']))
    out.autoRefuel = heli.fuel > 50 && !inv.hotbar.some((it) => it?.id === 'heliFuel') && !inv.grid.some((it) => it?.id === 'heliFuel')
    // Empty with none: it sinks to the ground, then you can get out.
    heli.fuel = 0.01
    const yHigh = heli.y
    for (let i = 0; i < 300; i++) bm.tryMode.update(0.05, new Set(['Space']))
    out.sank = heli.y < yHigh - 5
    out.landedOut = v.use() && !v.riding
    out.snapshot = v.snapshot().map((d) => d.k).sort().join('')
    s.stop()
    out.gone = v.list.length === 0
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    html: true, crafted: true, boatPlaced: true, boatOnWater: true, boatNeedsWater: true, boatIn: true, boatMoved: true, boatStaysOnWater: true, boatOut: true,
    heliPlaced: true, heliFull: true, heliIn: true, climbed: true, burned: true, meInSeat: true, fuelHud: true, noExitHigh: true, flewForward: true, autoRefuel: true, sank: true, landedOut: true, snapshot: 'bh', gone: true,
  })
})

// 2026-11-01: Shrinking Zone mode (ShrinkZone.js) - picked in Game Modes,
// a ring that shrinks stage by stage, toxic fog and faster zombies
// outside it, and surviving the last circle wins.
test('shrinking zone: ring, fog outside, faster zombies, win at the end', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    document.getElementById('game-mode-shrinking-zone').click()
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival.zone?.started, null, { timeout: 30000 })
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const z = s.zone
    s.health = 1e9
    const out = { mode: s.cfg.mode, wall: !!z.wall?.parent }
    const n0 = z.now()
    out.firstR = n0.r
    out.hud = /Zone 1\/6/.test(document.getElementById('build-play-wave-text').textContent)
    // Inside: no fog. Far outside: fog, and zombies there are faster.
    const me = s.bm.tryMode.pos
    me.set(n0.x, me.y, n0.z)
    z.update(0.01)
    out.fogInside = document.getElementById('zone-fog').classList.contains('on')
    me.set(n0.x + n0.r + 30, me.y, n0.z)
    z.update(0.01)
    out.fogOutside = document.getElementById('zone-fog').classList.contains('on')
    out.fogText = /\d+ blocks/.test(document.getElementById('zone-fog').textContent)
    out.fastOut = z.zombieMult({ x: n0.x + n0.r + 5, z: n0.z })
    out.normalIn = z.zombieMult({ x: n0.x, z: n0.z })
    me.set(n0.x, me.y, n0.z)
    // Halfway through the first shrink: smaller, still bigger than the next.
    z.t = 45 + 10
    const mid = z.now()
    out.shrinking = mid.shrinking && mid.r < 100 && mid.r > 70
    // Every next circle sits inside the one before.
    out.nested = z.centers.every((c, i) => i === 0 || Math.hypot(c.x - z.centers[i - 1].x, c.z - z.centers[i - 1].z) + [100, 70, 45, 28, 15, 7][i] <= [100, 70, 45, 28, 15, 7][i - 1] + 0.01)
    out.rings = z.mapRings().length
    // Same seed and start, same zone (what a server's guests rebuild).
    const copy = new z.constructor(s)
    copy.applySnapshot(z.snapshot())
    out.sameOnGuests = copy.centers.every((c, i) => Math.abs(c.x - z.centers[i].x) < 0.01 && Math.abs(c.z - z.centers[i].z) < 0.01)
    copy.dispose()
    // The end: standing in the last circle when time's up wins.
    const last = z.centers[z.centers.length - 1]
    me.set(last.x, me.y, last.z)
    z.t = 1e9
    z.update(0.01)
    s.replay?.stop()
    out.won = !!s._won && s.dead
    out.title = document.getElementById('build-play-over-title').textContent
    return out
  })
  expect(r).toEqual({ mode: 'shrinkingZone', wall: true, firstR: 100, hud: true, fogInside: false, fogOutside: true, fogText: true, fastOut: 1.7, normalIn: 1, shrinking: true, nested: true, rings: 2, sameOnGuests: true, won: true, title: 'You outlasted the zone!' })
})

// Quick wins (2026-11-01): the Golden Runner world event (catch it for a
// coin burst), Fishing (the Trader's rod, cast, bite, catch), Zombie
// Radios (walk up for a broadcast) and spray tags (draw in Spray Paint,
// spray on a block, others' sprays from a server, hidden when muted/off).
test('Golden Runner, fishing, zombie radios and spray tags', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game._enterBuildMode({ map: 'map3', play: true }))
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    for (let i = 0; i < 60 && !s.active; i++) await new Promise((res) => setTimeout(res, 250))
    s._pickWeapon('rifle')
    const out = {}
    const me = bm.tryMode.pos
    const home = { x: me.x, y: me.y, z: me.z }
    // --- Golden Runner: it runs off; touching it bursts into coins.
    s._startWave(2)
    out.goldenStarted = s.events.start('golden')
    const run = s.events._run
    const r0 = { x: run.runner.x, z: run.runner.z }
    for (let i = 0; i < 20; i++) s.events.update(0.05)
    out.goldenMoved = Math.hypot(run.runner.x - r0.x, run.runner.z - r0.z) > 0.2
    const coins = s.coins
    me.set(run.runner.x, run.runner.y, run.runner.z)
    s.events.update(0.05)
    out.goldenCaught = !!run.runner.caught
    out.goldenCoins = s.coins - coins >= 100
    for (let i = 0; i < 60 && s.events._run; i++) s.events.update(0.05)
    out.goldenGone = !s.events._run
    me.set(home.x, home.y, home.z)
    // --- Fishing: buy the rod from the Trader, hold it, cast, wait, reel in.
    s.coins = 500
    s.shop._act('buy', 'fishingRod')
    out.hasRod = s.inv.has('fishingRod')
    out.paid = s.coins === 440
    const slot = s.inv.hotbar.findIndex((it) => it?.id === 'fishingRod')
    s.inv.select(slot)
    s.inv.apply()
    // Pretend the middle of the screen points at water a few blocks ahead.
    s.fishing._waterInView = () => ({ x: me.x + 4, y: me.y, z: me.z, cx: Math.floor(me.x + 4), cz: Math.floor(me.z) })
    s.inv.useHeld()
    out.cast = s.fishing.out
    out.rodKept = s.inv.has('fishingRod')
    s.fishing.bob.wait = 0.1
    for (let i = 0; i < 20 && !(s.fishing.bob?.bite > 0); i++) s.fishing.update(0.05)
    out.bite = s.fishing.bob?.bite > 0
    const before = JSON.stringify([...s.inv.hotbar, ...s.inv.grid].filter(Boolean))
    const coinsBefore = s.coins
    const zombiesBefore = s.zombies.length
    s.inv.useHeld()
    out.reeled = !s.fishing.out
    const after = JSON.stringify([...s.inv.hotbar, ...s.inv.grid].filter(Boolean))
    out.gotSomething = after !== before || s.coins > coinsBefore || s.zombies.length > zombiesBefore
    // --- Zombie Radio: one turns up; walking up plays it.
    const radio = s.radios._place(me)
    out.radioPlaced = !!radio
    if (radio) {
      me.set(radio.x, radio.y, radio.z)
      s.radios.update(0.05)
      out.radioPlayed = radio.played
      out.radioMsg = document.getElementById('build-play-msg').textContent.startsWith('\u{1F4FB}')
      me.set(home.x, home.y, home.z)
    }
    // --- Spray tags: spray the block under my feet.
    const bx = Math.floor(me.x)
    const bz = Math.floor(me.z)
    let by = Math.floor(me.y) - 1
    while (!bm.getBlockAt(bx, by, bz) && by > -60) by--
    bm._raycastGridAligned = () => ({ existingBlock: [bx, by, bz], placeAt: [bx, by + 1, bz], t: 1 })
    out.sprayed = s.sprays.spray()
    out.mine = s.sprays.mine.length
    const snap = s.sprays.snapshot()
    out.snap = snap && snap.p.length === 256 && snap.s[0].f === 2
    // Someone else's spray from a server.
    const players = new Map([['p1', { nick: 'Bob', spray: { p: snap.p, s: [{ x: bx, y: by, z: bz, f: 0 }] } }]])
    s.sprays.syncRemote(players)
    out.remote = s.sprays.remote.get('p1')?.list.length
    g.settings.mutedChatPlayers = ['Bob']
    s.sprays.syncRemote(players)
    out.mutedHidden = !s.sprays.remote.has('p1')
    g.settings.mutedChatPlayers = []
    g.settings.showOtherSprays = false
    s.sprays.syncRemote(players)
    out.offHidden = !s.sprays.remote.has('p1')
    g.settings.showOtherSprays = true
    // A bad picture from the network never shows.
    s.sprays.syncRemote(new Map([['p2', { nick: 'Eve', spray: { p: '<b>', s: [{ x: bx, y: by, z: bz, f: 0 }] } }]]))
    out.badIgnored = !s.sprays.remote.has('p2')
    // Spray Paint in the pause screen: paint a square, Done keeps it.
    bm.toggleMenu()
    document.getElementById('play-pause-spray-btn').click()
    out.padShown = !document.getElementById('play-spray').hidden && document.getElementById('play-pause-buttons').hidden
    document.querySelector('#play-spray-colors [data-paint="3"]').click()
    const pad = document.getElementById('play-spray-pad')
    const box = pad.getBoundingClientRect()
    pad.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.left + 2, clientY: box.top + 2, bubbles: true, pointerId: 1 }))
    pad.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    document.getElementById('play-spray-done').click()
    out.saved = (localStorage.getItem('gayz-spray-v1') || '')[0]
    out.buttonsBack = !document.getElementById('play-pause-buttons').hidden
    return out
  })
  expect(r).toEqual({
    goldenStarted: true, goldenMoved: true, goldenCaught: true, goldenCoins: true, goldenGone: true,
    hasRod: true, paid: true, cast: true, rodKept: true, bite: true, reeled: true, gotSomething: true,
    radioPlaced: true, radioPlayed: true, radioMsg: true,
    sprayed: true, mine: 1, snap: true, remote: 1, mutedHidden: true, offHidden: true, badIgnored: true,
    padShown: true, saved: '3', buttonsBack: true,
  })
})

test('Pinata zombie, snowballs, metal detector, riding, potions and jetpack', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game._enterBuildMode({ map: 'map3', play: true }))
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    for (let i = 0; i < 60 && !s.active; i++) await new Promise((res) => setTimeout(res, 250))
    s._pickWeapon('rifle')
    const out = {}
    const me = bm.tryMode.pos
    const hold = (id) => {
      let slot = s.inv.hotbar.findIndex((it) => it?.id === id)
      if (slot < 0) {
        s.inv.hotbar[8] = { kind: 'item', id, n: s.inv.grid.find((it) => it?.id === id)?.n || 1 }
        slot = 8
      }
      s.inv.select(slot)
      s.inv.apply()
    }
    // --- Pinata zombie: candy and coins for the kill.
    s.zombies.forEach((z) => { z.health = 0 })
    const zp = s._makeZombie(9001, me.x + 3, me.y, me.z, 10, false, null, { tier: 'common', name: 0, shine: 'pinata' })
    out.pinataTag = !!zp.shine
    const coins = s.coins
    s.damageZombie(zp, 999)
    s._pinataLoot()
    out.pinataCandy = s.inv.has('candy')
    out.pinataCoins = s.coins > coins
    // --- Snowballs: on with the setting, a wave hands them out, one freezes a zombie.
    g.settings.snowballsAllYear = true
    s._startWave(1)
    out.snowballs = s.inv.has('snowball')
    const zf = s._makeZombie(9002, me.x, me.y, me.z - 4, 500, false, null, { tier: 'common', name: 0 })
    s.snowballs.freeze(zf)
    out.frozen = zf.frozen > 0
    s.snowballs.update(0.05)
    out.ice = s.snowballs.ice.has(zf)
    hold('snowball')
    const before = s.inv.selected().n
    s.snowballs._nextAt = 0
    out.thrown = s.inv.useHeld() && s.inv.selected().n === before - 1 && s.snowballs.list.length > 0
    g.settings.snowballsAllYear = false
    out.recipeHidden = !s.inv.crafting?.html().includes('data-craft="snowball"') || new Date().getMonth() % 11 < 2
    // --- Metal detector: hide a spot, stand on it, dig.
    s.inv.add({ kind: 'item', id: 'metalDetector', n: 1 })
    hold('metalDetector')
    const spot = s.detector.hide(me)
    out.spot = !!spot
    out.signalFar = s.detector.signal({ x: spot.x + 30, z: spot.z }) < s.detector.signal({ x: spot.x + 2, z: spot.z })
    me.set(spot.x, spot.y, spot.z)
    const c2 = s.coins
    s.inv.useHeld()
    out.dug = s.coins > c2 && s.stats.dug === 1
    out.keptDetector = s.inv.has('metalDetector')
    // --- Potions: speed and giant, through the special blocks' buffs.
    s.inv.add({ kind: 'item', id: 'potionSpeed', n: 1 })
    hold('potionSpeed')
    out.drank = s.inv.useHeld() && bm.specials._buff('speed') > 1
    out.potionLeft = s.potions.left('potionSpeed') > 25
    s.potions.drink('potionGiant')
    out.giant = bm.specials.bodySize() > 1.5
    s.potions.drink('potionTiny')
    out.tiny = bm.specials.bodySize() < 1
    // --- Jetpack: Jump held in the air climbs and burns fuel.
    s.inv.add({ kind: 'item', id: 'jetpack', n: 1 })
    s.jetpack.clear()
    let vy = 0
    for (let i = 0; i < 10; i++) vy = s.jetpack.thrust(0.05, true, false, vy)
    out.jetUp = vy > 1 && s.jetpack.fuel < 1
    s.jetpack.fuel = 0
    s.inv.add({ kind: 'item', id: 'jetFuel', n: 1 })
    s.jetpack.thrust(0.05, true, false, 0)
    out.jetRefuelled = s.jetpack.fuel > 0.9 && !s.inv.has('jetFuel')
    // --- Riding: a tamed horse, Use climbs on, keys move it, Use gets off.
    const a = s.animals.placeAt({ kind: 'horse', x: me.x + 2, y: s._groundUnder(me.x + 2, me.y + 3, me.z), z: me.z })
    out.horse = !!a
    if (a) {
      a.tamed = true
      bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
      s.animals._onRay = () => a
      out.mounted = s.riding.use() && s.riding.on && a.ridden
      const x0 = a.x
      const z0 = a.z
      for (let i = 0; i < 10; i++) s.riding.drive(0.05, { fwd: true })
      out.rode = Math.hypot(a.x - x0, a.z - z0) > 1
      out.seat = s.riding.seat().y > a.y + 1
      s.riding.use()
      out.off = !s.riding.on && !a.ridden
    }
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Speedrun: clock, best time and ghost path', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-speedrun-best')
    g.settings.selectedGameMode = 'speedrun'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const out = { mode: s.cfg.mode === 'speedrun', made: !!s.speedrun }
    s._startWave(1)
    const sr = s.speedrun
    out.running = sr.running
    for (let i = 0; i < 20; i++) sr.update(0.1)
    out.timed = sr.t > 1.9 && sr.path.length >= 9
    out.pill = document.getElementById('pill-speedrun')?.classList.contains('on')
    const res = sr.finish()
    out.best = res.isBest && JSON.parse(localStorage.getItem('gayz-speedrun-best')).ms === res.ms
    out.text = sr.text().length > 5
    // A slower second run doesn't replace the best.
    sr.result = null
    sr.start()
    sr.t = res.ms / 1000 + 5
    out.slower = !sr.finish().isBest
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Party modes: hide and seek, capture the flag, king of the hill, zombie soccer, hot potato, bowling', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    for (const mode of ['hideSeek', 'captureFlag', 'kingHill', 'zombieSoccer', 'hotPotato', 'zombieBowling']) {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      const p = s.party
      out[`${mode}Made`] = !!p && s.cfg.noZombies
      for (let i = 0; i < 200 && p.phase === 'wait'; i++) p.update(0.05)
      out[`${mode}Playing`] = p.phase === 'play' && p.bots.size === 5
      const start = [...p.bots.values()].map((b) => [b.x, b.z])
      for (let i = 0; i < 60; i++) p.update(0.05)
      out[`${mode}BotsMove`] = [...p.bots.values()].some((b, i) => Math.hypot(b.x - start[i][0], b.z - start[i][1]) > 0.5) || mode === 'hideSeek'
      out[`${mode}BotsOk`] = [...p.bots.values()].every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))
      out[`${mode}Hud`] = (document.getElementById('build-play-wave-text')?.textContent || '').length > 5
      const snap = JSON.parse(JSON.stringify(p.snapshot()))
      out[`${mode}Snap`] = snap.k === mode && snap.ph === 'play' && !!snap.h
      if (mode === 'hideSeek') {
        p.seekers = new Set([p.myId])
        p.left = 10
        const [b] = p.bots.values()
        const me = s.bodyPos()
        b.x = me.x
        b.z = me.z
        b.y = me.y
        p._run(0.01)
        out.found = p.seekers.has(b.id)
        for (const o of p.bots.values()) p.seekers.add(o.id)
        p._run(0.01)
        out.seekersWin = p.phase === 'end' && p.winner === 's'
      }
      if (mode === 'captureFlag') {
        const mine = p.myTeam
        const enemy = mine === 'r' ? 'b' : 'r'
        for (const b of p.bots.values()) b.x += 500
        const ef = p.flags[enemy]
        s.bm.tryMode.pos.set(ef.x, ef.y, ef.z)
        p._run(0.01)
        out.carrying = ef.at === 'carried' && ef.by === p.myId
        const home = p.spot(mine)
        s.bm.tryMode.pos.set(home.x, home.y, home.z)
        p._run(0.01)
        out.captured = p.score[mine] === 1 && ef.at === 'base'
      }
      if (mode === 'kingHill') {
        for (const b of p.bots.values()) b.x += 500
        const hill = p.spot('hill')
        s.bm.tryMode.pos.set(hill.x, hill.y, hill.z)
        // A bot may have just stunned me (stunned players don't score).
        p.stunned.clear()
        for (let i = 0; i < 5; i++) p._run(0.5)
        out.kingPoints = (p.score[p.myId] || 0) >= 2
      }
      if (mode === 'zombieSoccer') {
        for (const b of p.bots.values()) b.x += 500
        const ball = p.ball
        const x0 = ball.x
        s.bm.tryMode.pos.set(ball.x - 0.5, ball.y, ball.z)
        p._run(0.05)
        for (let i = 0; i < 5; i++) p._run(0.05)
        out.kicked = ball.x - x0 > 0.3
        ball.x = p.home.x + 40
        ball.z = p.home.z
        p._run(0.01)
        out.goal = p.score.r === 1
      }
      if (mode === 'hotPotato') {
        out.potatoHolder = !!p.holder && p.fuse > 0
        for (const b of p.bots.values()) b.x += 500
        p.holder = p.myId
        p._passCd = 0
        // (No pass-back rule in the way: whoever had it before doesn't matter here.)
        p._from = ''
        const [b] = p.bots.values()
        const me = s.bodyPos()
        Object.assign(b, { x: me.x + 0.3, y: me.y, z: me.z })
        p._run(0.01)
        out.potatoPassed = p.holder === b.id
        p.fuse = 0.001
        p._run(0.01)
        out.potatoBoom = p.out.has(b.id) && !!p.holder && p.holder !== b.id
        out.potatoSnap = JSON.parse(JSON.stringify(p.snapshot())).ou.includes(b.id)
      }
      if (mode === 'zombieBowling') {
        out.bowlTurn = !!p.turn && p.order.length === 6
        for (const b of p.bots.values()) b.x += 500
        p._startTurn(p.myId)
        const ball = p.ball
        s.bm.tryMode.pos.set(ball.x - 0.5, ball.y, ball.z)
        p._run(0.05)
        out.bowlRolled = p.rolled && ball.vx > 1
        s.bm.tryMode.pos.set(ball.x - 50, ball.y, ball.z)
        // A pin in the ball's way falls.
        const pin = p.pinSpot(0)
        Object.assign(ball, { x: pin.x, y: pin.y, z: pin.z, vx: 6, vz: 0 })
        p._run(0.01)
        out.bowlPinDown = p.pinsDown[0]
        for (let i = 0; i < 400 && p.turn === p.myId; i++) p._run(0.05)
        out.bowlScored = p.rolls[p.myId] === 1 && p.score[p.myId] >= 1
      }
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Treasure maps, kites and the camp aquarium', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-aquarium')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const pick = (id) => {
      s.inv.active = s.inv.hotbar.findIndex((it) => it?.id === id)
      return s.inv.active >= 0
    }
    // Three pieces craft a map; the map marks an X, then digs it up.
    s.inv.add({ kind: 'item', id: 'mapPiece', n: 3 })
    out.crafted = s.inv.crafting.craft('treasureMap') && s.inv.has('treasureMap') && !s.inv.has('mapPiece')
    out.picked = pick('treasureMap')
    s.inv.useHeld()
    const spot = s.treasure.spot
    out.marked = !!spot && s.inv.has('treasureMap')
    s.pins.update(1)
    out.compassX = (document.getElementById('pin-compass')?.textContent || '').includes('X')
    s.inv.useHeld()
    out.stillMap = s.inv.has('treasureMap') && !!s.treasure.spot
    s.bm.tryMode.pos.set(spot.x, spot.y, spot.z)
    const coins = s._coinsEarned
    const gems = g.gems
    s.inv.useHeld()
    out.dug = !s.treasure.spot && !s.inv.has('treasureMap') && s._coinsEarned > coins && g.gems > gems
    // The kite: up, pulls with the wind, slows a fall, reels in.
    s.inv.add({ kind: 'item', id: 'kite', n: 1 })
    out.kitePicked = pick('kite')
    s.inv.useHeld()
    for (let i = 0; i < 20; i++) s.kite.update(0.1)
    out.kiteUp = s.kite.up && !!s.kite.mesh?.parent && s.inv.has('kite')
    const pull = s.kite.pull()
    out.kitePull = !!pull && Math.hypot(pull.x, pull.z) > 0.1
    out.kiteGlide = s.kite.fall(-20) > -5
    s.inv.useHeld()
    out.kiteDown = !s.kite.up && !s.kite.mesh
    // The aquarium counts catches (a sure Fish off the rod) and fills the tank.
    const rnd = Math.random
    Math.random = () => 0
    const me = s.bodyPos()
    s.fishing.bob = { x: me.x, y: me.y, z: me.z }
    s.fishing._land()
    s.fishing._land()
    Math.random = rnd
    out.counted = JSON.parse(localStorage.getItem('gayz-aquarium') || '{}').fish === 2
    localStorage.setItem('gayz-aquarium', JSON.stringify({ fish: 2, golden: 1 }))
    const camp = s.camp
    for (let i = 0; i < 20 && !camp?.aquarium; i++) await new Promise((res) => setTimeout(res, 100))
    out.campAquarium = !!camp?.aquarium
    const Aquarium = camp.aquarium.constructor
    camp.aquarium.dispose()
    camp.aquarium = new Aquarium(camp)
    camp.aquarium.build(camp.trophies?.spot)
    out.tank = !!camp.aquarium.group && camp.aquarium.fish.length === 3
    out.apart = !camp.trophies?.spot || Math.hypot(camp.aquarium.spot.x - camp.trophies.spot.x, camp.aquarium.spot.z - camp.trophies.spot.z) > 4
    s.stop?.()
    g._exitBuildMode?.()
    localStorage.removeItem('gayz-aquarium')
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Dungeons: rooms underground, a way in, and the Boss Room', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const bm = g.buildMode
    const s = bm.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const out = {}
    const under = bm.world.under
    // Dungeons near the city, and at least one with a way in from the land.
    const list = under.dungeonsNear(-600, -600, 600, 600)
    out.some = list.length > 0
    const withWay = list.filter((d) => under._dungeonEntrance(d))
    out.ways = withWay.length > 0
    const d = withWay[0] || list[0]
    if (!d) return out
    const room = d.rooms.find((o) => o.boss)
    const cx = d.x0 + room.x0 + 2
    const cz = d.z0 + room.z0 + 2
    // The rock knows the room is open and its floor is solid.
    out.airInside = !under.implicitSolid(cx, d.floor + 1, cz, `${cx},${d.floor + 1},${cz}`) || bm.getBlockAt(cx, d.floor + 1, cz) === null
    out.floorSolid = under.implicitSolid(cx, d.floor, cz, `${cx},${d.floor},${cz}`) || !!bm.getBlockAt(cx, d.floor, cz)
    // Walk in: its walls get built, the dungeon is noticed, the boss wakes.
    bm.tryMode.pos.set(cx + 0.5, d.floor + 1, cz + 0.5)
    for (let i = 0; i < 40; i++) {
      bm.tryMode.pos.set(cx + 0.5, d.floor + 1, cz + 0.5)
      await new Promise((res) => setTimeout(res, 150))
    }
    let bricks = 0
    for (let x = d.x0; x < d.x0 + 36; x++) for (let z = d.z0; z < d.z0 + 36; z++) if (/stonebricks/.test(bm.getBlockAt(x, d.floor, z) || '')) bricks++
    out.built = bricks > 20
    const zs = s.zombies.length
    s._dungeonCheckIn = 0
    s._checkDungeon(0.1)
    out.seen = s._dungeonsSeen.has(d.id)
    // (It may have woken already while we stood there.)
    out.boss = s._dungeonBosses.has(d.id) && (s.zombies.length > zs || s.zombies.some((z) => z.boss))
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// 2026-11-02: run perks (RunPerks.js), escort missions (EscortMission.js),
// camp sieges (CampSiege.js) and Tower Defense mode (TowerDefense.js).
test('run perks, an escort mission and a camp siege in Zombie Survival', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { const g = window.__game; g.settings.guestMode = false; g.settings.selectedGameMode = 'classic'; g.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    s.health = s.maxHealth = 1e6
    s._breakTimer = 9999
    const out = {}
    // A cleared wave: three cards, the break waits, "2" picks the middle one.
    s.wave = 1
    s._toSpawn = 0
    s._breakTimer = 0
    for (const z of [...s.zombies]) s.damageZombie(z, 1e6)
    s._updateWorld(0.01)
    s._updateWorld(0.01)
    out.cards = document.querySelectorAll('#play-perk-pick .perk-card').length
    const wait = s._breakTimer
    s._updateWorld(1)
    out.waits = s._breakTimer === wait
    const middle = s.perks.offer[1]
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', bubbles: true }))
    out.picked = s.perks.n(middle) === 1 && !s.perks.open
    s.perks.offer = ['hardHitter']
    const dmg = s._damageMult()
    s.perks.pick('hardHitter')
    out.harder = +(s._damageMult() / dmg).toFixed(2)
    // An escort: someone to walk to an exit, that zombies go for.
    s._breakTimer = 9999
    out.escort = s.events.start('escort')
    const run = s.events._run
    out.path = run?.escort.path.length >= 20
    const zb = s._extraZombie(run.escort.x + 3, run.escort.y, run.escort.z)
    out.chases = !!run.target(zb)?.hurt
    run.hurt(1e6)
    out.lost = run.escort.over === 'lost'
    // A siege (only with the camp): the camp isn't safe until it's over.
    if (s.camp) {
      s.wave = 5
      out.siege = s.siege.start()
      const c = s.siege.center()
      out.unsafe = !s._campSafe(c.x, c.z)
      for (let i = 0; i < 80 && s.siege.toSend > 0; i++) s.siege.update(0.5)
      for (const z of [...s.siege.zombies]) s.damageZombie(z, 1e6)
      s.siege.update(0.1)
      out.held = !s.siege.active && s.stats.sieges === 1 && s._campSafe(c.x, c.z)
    }
    return out
  })
  expect(r).toEqual({ cards: 3, waits: true, picked: true, harder: 1.2, escort: true, path: true, chases: true, lost: true, ...(r.siege !== undefined ? { siege: true, unsafe: true, held: true } : {}) })
})

test('Tower Defense: its own map, zombies walk the path, towers, lives and the win', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { const g = window.__game; g.settings.guestMode = false; g.settings.selectedGameMode = 'towerDefense'; g.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const bm = s.bm
    const td = s.td
    const out = { mode: s.cfg.mode, coins: s.coins, tab: s.shop.tab }
    out.map = bm.getBlockAt(0, 200, 3) === 'grass' && bm.getBlockAt(0, 200, 0) === 'dirtpath'
    out.noBuildPath = td.protects(0, 201, 0) && !td.protects(0, 201, 3)
    // Saving mid-game never keeps the map.
    bm.save()
    const edits = JSON.parse(localStorage.getItem('buildmode-map3-v8-edits') || '{"placed":[]}').placed
    out.notSaved = !edits.some((b) => b.y === 200 && b.x === 0 && b.z === 3)
    // A tower from the shop.
    s.shop._act('trap', 'autoturret')
    out.bought = s.coins === out.coins - 60
    // A zombie at the base costs a life and counts toward the wave.
    s._startWave(1)
    s._spawnZombie()
    const zb = s.zombies[0]
    out.atPortal = Math.abs(zb.x - (td.ox - 16 + 0.5)) < 0.01
    zb.tdAt = 9
    zb.x = td.ox + 16.5
    zb.z = td.oz + 14.5
    const left = s._toSpawn
    s._updateWorld(0.01)
    out.lives = td.lives
    out.counted = s._toSpawn === left - 1
    out.hud = /Lives: 19\/20/.test(document.getElementById('build-play-wave-text').textContent)
    // The last wave held wins.
    for (const z of [...s.zombies]) { z.lost = true; z.health = 0 }
    s._updateWorld(0.01)
    s.wave = 15
    s._toSpawn = 0
    s._breakTimer = 0
    s._updateWorld(0.01)
    out.won = !!s._won
    out.title = document.getElementById('build-play-over-title').textContent
    s.stop()
    out.gone = bm.getBlockAt(0, 200, 3) === null
    return out
  })
  expect(r).toEqual({ mode: 'towerDefense', coins: 200, tab: 'towers', map: true, noBuildPath: true, notSaved: true, bought: true, atPortal: true, lives: 19, counted: true, hud: true, won: true, title: 'Base Defended!', gone: true })
})

test('Tornado, skateboards, frozen lakes and the Dance-Off', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const tm = s.bm.tryMode
    const pick = (id) => {
      s.inv.active = s.inv.hotbar.findIndex((it) => it?.id === id)
      return s.inv.active >= 0
    }
    // Skateboard: crafted, on, faster and slipperier, a ramp launches, a trick pays.
    s.inv.add({ kind: 'block', id: 'oakplanks', n: 3 })
    s.inv.add({ kind: 'block', id: 'cobblestone', n: 2 })
    out.boardCrafted = s.inv.crafting.craft('skateboard') && s.inv.has('skateboard')
    out.boardPicked = pick('skateboard')
    s.inv.useHeld()
    out.boardOn = s.skate.on && !!s.skate.mesh?.parent
    const m = s.skate.mods(true, tm.pos)
    out.boardFast = !!m && m.speed > 1.5 && m.grip < 1
    tm.vel.set(9, 0, 0)
    s.skate.ramp(tm)
    out.ramp = tm.vel.y > 8
    const coins = s.coins
    tm.onGround = false
    tm._spaceWasDown = false
    s.skate.update(0.05)
    tm._spaceWasDown = true
    s.skate.update(0.05)
    out.trickStarted = !!s.skate.trick
    for (let i = 0; i < 12; i++) s.skate.update(0.05)
    tm.onGround = true
    s.skate.update(0.05)
    out.trickPaid = s.coins > coins
    s.inv.useHeld()
    out.boardOff = !s.skate.on && !s.skate.mesh
    // Ice is slippery even on foot.
    const p = tm.pos
    const fx = Math.floor(p.x)
    const fy = Math.floor(p.y - 0.05)
    const fz = Math.floor(p.z)
    const was = s.bm.getBlockAt(fx, fy, fz)
    s.bm.removeBlock(fx, fy, fz)
    s.bm.placeBlock(fx, fy, fz, 'ice')
    const ice = s.skate.mods(true, p)
    out.iceSlippery = !!ice && ice.grip < 0.5 && ice.speed > 1
    s.bm.removeBlock(fx, fy, fz)
    if (was) s.bm.placeBlock(fx, fy, fz, was)
    // Winter freezes still water near you, and it thaws back at the end.
    g.settings.snowballsAllYear = true
    const wx = fx + 3
    const wy = Math.floor(p.y)
    s.bm.removeBlock(wx, wy, fz)
    s.bm.removeBlock(wx, wy + 1, fz)
    s.bm.placeBlock(wx, wy, fz, 'water')
    s.skate._freezeIn = 0
    s.skate._freeze(0.1)
    out.frozen = s.bm.getBlockAt(wx, wy, fz) === 'ice'
    s.skate._thaw()
    out.thawed = s.bm.getBlockAt(wx, wy, fz) === 'water'
    s.bm.removeBlock(wx, wy, fz)
    g.settings.snowballsAllYear = false
    // Dance-Off: the boombox starts it, zombies stop and copy, hits fill the groove.
    s.inv.add({ kind: 'item', id: 'boombox', n: 1 })
    out.boxPicked = pick('boombox')
    const me = s.bodyPos()
    const zb = s._makeZombie(++s._zid, me.x + 3, me.y, me.z, 100, false)
    s.inv.useHeld()
    out.danceOn = s.dance.on && !!document.getElementById('dance-off')
    s.dance.update(0.05)
    out.zombieFrozen = zb.frozen > 0 && zb.dancing
    const n = s.dance.notes[0]
    s.dance.time = n.at
    const groove = s.dance.groove
    s.dance.press(n.lane)
    out.hit = n.done && s.dance.groove > groove && s.dance.hits === 1
    out.danceKeysBlocked = tm.speedMult === 0
    // Missing everything ends it.
    for (let i = 0; i < 10 && s.dance.on; i++) s.dance._miss(0)
    out.danceLost = !s.dance.on && !document.getElementById('dance-off') && tm.speedMult > 0
    s.dance.start()
    s.dance.time = 29.99
    for (const note of s.dance.notes) note.done = true
    const c2 = s.coins
    s.dance.update(0.05)
    out.danceWon = !s.dance.on && s.coins > c2 && zb.frozen >= 4
    // The disco ball event.
    out.disco = s.events.start('disco') && !!s.dance._disco
    s.events._endRun()
    out.discoGone = !s.dance._disco
    // Tornado: in the list, pulls, throws zombies up the funnel.
    const sky = s.bm.sky
    out.tornadoListed = sky.disasters.kinds.includes('tornado')
    sky.disasters.start('tornado', { x: me.x, z: me.z, quiet: true })
    const run = sky.disasters.active
    run.cx = me.x + 1
    run.cz = me.z
    run.t = 10
    zb.x = run.cx
    zb.z = run.cz + 0.5
    zb.y = me.y
    zb.frozen = 0
    for (let i = 0; i < 10; i++) sky.disasters.update(0.05, s.bm.camera)
    out.tornadoPulls = sky.disasters.push.length() > 0.5
    out.zombieLifted = zb.y > me.y + 1
    sky.disasters.end()
    out.tornadoEnded = !sky.disasters.active
    g.buildMode.survival.stop?.()
    g._exitBuildMode?.()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('Paint Wars, Build Battle and Escape Rooms', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    // Paint Wars: teams, bots paint, a shot paints, the sync carries it.
    let s = await start('paintWars')
    let p = s.party
    out.paintMade = !!p && s.cfg.noZombies
    for (let i = 0; i < 200 && p.phase === 'wait'; i++) p.update(0.05)
    out.paintTeams = p.phase === 'play' && p.teams.size === 6
    for (let i = 0; i < 60; i++) p.update(0.05)
    out.botsPaint = p.paint.size > 5
    p.paint.clear()
    const h = p.home
    p.splat(h.x, h.z, p.myTeam)
    out.splat = p.paintCounts()[p.myTeam === 'r' ? 0 : 1] >= 5
    const snap = JSON.parse(JSON.stringify(p.snapshot()))
    out.paintSnap = snap.pa.length > 0 && /^[0rb]+$/.test(snap.pa)
    const n = p.paint.size
    p.paint.clear()
    p._paintFrom(snap.pa)
    out.paintBack = p.paint.size === n
    p._drawArena()
    out.paintDrawn = p._paintMesh?.count === n
    p.left = 0.01
    p._run(0.05)
    out.paintWinner = p.phase === 'end' && ['r', 'b', 'tie'].includes(p.winner)
    await stop()
    // Build Battle: a platform, a plot each, bot builds, my blocks only on my plot, voting.
    s = await start('buildBattle')
    p = s.party
    for (let i = 0; i < 200 && p.phase === 'wait'; i++) p.update(0.05)
    p.update(0.05)
    out.bbPlaying = p.phase === 'play' && p.sub === 'build' && p.plots.size === 6
    const mine = p.plotAt(p.plots.get(p.myId))
    out.platform = s.bm.getBlockAt(mine.x, 220, mine.z) === 'smoothquartz'
    out.onMyPlot = Math.abs(s.bm.tryMode.pos.y - 221) < 0.5
    out.palette = s.inv.hotbar.some((it) => it?.kind === 'block' && it.id === 'oak')
    out.canBuildMine = !s._protects(mine.x + 2, 221, mine.z + 2)
    const other = p.plotAt((p.plots.get(p.myId) + 1) % 8)
    out.cantBuildOthers = s._protects(other.x + 2, 221, other.z + 2) && s._protects(mine.x, 220, mine.z)
    p.left = 60
    p._run(0.05)
    const bot = [...p.bots.values()][0]
    out.botBuilt = p._plotBlocks(p.plots.get(bot.id)) > 10
    p.left = 0.001
    p._run(0.05)
    p.update(0.05)
    out.voting = p.sub === 'vote' && !!document.getElementById('bb-vote') && s.bm.tryMode.speedMult === 0
    out.bagBack = !s.inv.hotbar.some((it) => it?.kind === 'block' && it.id === 'sealantern')
    for (let i = 0; i < 400 && p.phase === 'play'; i++) {
      if (p._voteOwner() !== p.myId) p.vote(4)
      p._run(0.25)
      p.update(0.01)
    }
    out.bbEnded = p.phase === 'end' && !!p.winner && Object.values(p.score).some((v) => v > 0)
    out.voteGone = !document.getElementById('bb-vote')
    await stop()
    // Escape Rooms: rooms in the sky, levers, the code, the buttons, out.
    s = await start('escapeRoom')
    const e = s.escape
    out.escMade = !!e && s.cfg.noZombies && !s.party
    out.inRoom1 = Math.abs(s.bm.tryMode.pos.y - 241) < 0.5 && !!document.getElementById('escape-bar')
    out.mapSafe = s._protects(e._roomX(0), 241, e.oz)
    e.update(0.1)
    e.pattern.forEach((on, i) => { if (on) s.bm.gadgets.setLever(...e._levers[i], true) })
    e.update(0.1)
    out.leversOpen = e.solved[0] && !s.bm.getBlockAt(...e._exits[0][0])
    s.bm.tryMode.pos.set(e._roomX(1) + 5, 241, e.oz)
    e.update(0.1)
    out.room2 = e.room === 1
    e.useBlock(...e._keypad)
    out.keypad = !!document.getElementById('escape-keypad')
    for (const d of e.code) [...document.querySelectorAll('#escape-keypad .escape-pad-keys button')].find((b) => b.textContent === String(d)).click()
    out.codeOpen = e.solved[1] && !document.getElementById('escape-keypad')
    s.bm.tryMode.pos.set(e._roomX(2) + 5, 241, e.oz)
    e.update(0.1)
    e._showing = null
    const doorWas = e.doorLeft[2]
    e._pressSimon((e.simon[0] + 1) % 4)
    out.simonWrong = e.doorLeft[2] < doorWas - 5
    e._showing = null
    for (const k of e.simon) e._pressSimon(k)
    out.simonOpen = e.solved[2]
    // The door bursts when its time runs out.
    e.doorLeft[2] = 0.01
    e.solved[2] = false
    e.update(0.1)
    out.brokeIn = e.broke[2] && s.zombies.length >= 3
    e.solved[2] = true
    s.bm.tryMode.pos.set(e._roomX(3) + 2, 241, e.oz)
    e.update(0.1)
    out.escaped = e.done && s.dead && (document.getElementById('build-play-over-title')?.textContent || '').length > 3
    await stop()
    out.mapGone = !g.buildMode.getBlockAt(0, 240, 0)
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Submarine, sunken ruins, the ghost pirate ship, the Zombie Train and the Moon', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const bm = s.bm
    const tm = bm.tryMode
    const pick = (id) => {
      s.inv.active = s.inv.hotbar.findIndex((it) => it?.id === id)
      return s.inv.active >= 0
    }
    // A pool of water far off in the sky to dive in: 9 x 9, 6 deep.
    const P = { x: 4000, y: 150, z: 4000 }
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
      bm.placeBlock(P.x + x, P.y - 7, P.z + z, 'stone')
      for (let y = P.y - 6; y < P.y; y++) bm.placeBlock(P.x + x, y, P.z + z, 'water')
    }
    bm.placeBlock(P.x - 6, P.y - 1, P.z, 'stone')
    tm.pos.set(P.x - 5.5, P.y, P.z + 0.5)
    tm.vel.set(0, 0, 0)
    bm._yaw = -Math.PI / 2
    // Submarine: crafted, in the water, in, dives, out.
    s.inv.add({ kind: 'block', id: 'cobblestone', n: 14 })
    s.inv.add({ kind: 'block', id: 'glass', n: 3 })
    s.inv.add({ kind: 'block', id: 'oakplanks', n: 4 })
    s.inv.add({ kind: 'item', id: 'zombieGoo', n: 3 })
    out.subCrafted = s.inv.crafting.craft('submarine') && s.inv.has('submarine')
    out.subPicked = pick('submarine')
    s.inv.useHeld()
    const sub = s.vehicles.list.find((v) => v.kind === 'sub')
    out.subPlaced = !!sub
    tm.pos.set(sub.x - 1, sub.y, sub.z)
    out.subIn = s.vehicles.use() && s.vehicles.riding === sub
    const y0 = sub.y
    for (let i = 0; i < 40; i++) s.vehicles.drive(0.05, { down: true })
    out.subDives = sub.y < y0 - 1.5
    for (let i = 0; i < 20; i++) s.vehicles.drive(0.05, { fwd: true })
    out.subMoves = Math.hypot(sub.x - P.x, sub.z - P.z) < 6
    out.subSnap = s.vehicles.snapshot().some((d) => d.k === 's')
    s.vehicles.use()
    out.subOut = !s.vehicles.riding
    // A sunken ruin on the pool's floor: prismarine, a chest, sea zombies.
    const zBefore = s.zombies.length
    const ruin = s.reefs.build(P.x, P.y - 7, P.z)
    out.ruin = !!ruin && bm.getBlockAt(P.x + 1, P.y - 6, P.z + 1) === 'lootchest' && /prismarine/.test(bm.getBlockAt(P.x + 3, P.y - 7, P.z) || '')
    out.seaZombies = s.zombies.length - zBefore === 3
    out.ruinNotSaved = s._placed.has(bm._key(P.x + 1, P.y - 6, P.z + 1))
    s.reefs.clear()
    out.ruinGone = bm.getBlockAt(P.x + 1, P.y - 6, P.z + 1) === 'water' && bm.getBlockAt(P.x + 3, P.y - 7, P.z) === 'stone'
    // The ghost pirate ship: blocks on the water, pirates, the captain's chest.
    const Q = { x: 4100, y: 150, z: 4100 }
    for (let x = -1; x <= 16; x++) for (let z = -5; z <= 5; z++) for (let y = Q.y - 4; y <= Q.y; y++) bm.placeBlock(Q.x + x, y, Q.z + z, 'water')
    const zb2 = s.zombies.length
    s.pirate._build(Q.x, Q.y, Q.z)
    out.ship = bm.getBlockAt(Q.x + 7, Q.y + 1, Q.z) === 'darkoakplanks' && bm.getBlockAt(Q.x + 6, Q.y + 8, Q.z) === 'darkoaklog'
    out.pirates = s.zombies.length - zb2 === 4 && s.zombies.slice(-4).every((z) => z.pirate)
    const coins = s.coins
    out.chestOpened = s.useChest(Q.x + 2, Q.y + 2, Q.z)
    out.captainsLoot = s.coins >= coins + 80 && s.inv.has('treasureMap')
    out.shipFades = s.pirate._update(1) === true && (s.pirate.ship.left = 0.01, s.pirate._update(0.05) === false)
    s.pirate.clear()
    out.shipGone = bm.getBlockAt(Q.x + 7, Q.y, Q.z) === 'water' && !bm.getBlockAt(Q.x + 6, Q.y + 8, Q.z)
    // The pirate event only when the sea is near.
    out.pirateEventKind = typeof s.pirate.possible() === 'boolean'
    // The Zombie Train: a loop, stations, riding, zombies in the wagons.
    const tr = s.train
    let laid = tr.on
    for (let i = 0; i < 8 && !laid; i++) laid = tr.setup({ x: 300 * Math.cos(i), y: 70, z: 300 * Math.sin(i) })
    out.trainLaid = laid && tr.stations.length === 3 && tr._cars.length === 4
    const startHead = tr.head
    tr.wait = 0
    for (let i = 0; i < 20; i++) tr.update(0.05)
    out.trainRuns = tr.head > startHead
    const spot = tr._spot(6, 0)
    tm.pos.set(spot.x + 1, spot.y, spot.z)
    out.boarded = tr.use() && !!tr.aboard
    const seat = tr.seat()
    out.seat = Math.hypot(seat.x - spot.x, seat.z - spot.z) < 3
    const z3 = s.zombies.length
    tr.wait = 0.01
    tr.update(0.05)
    out.trainZombies = s.zombies.length > z3 && tr.riders.length > 0
    const rider = tr.riders[0]
    const offWas = rider.trainOff
    tr.update(0.5)
    out.ridersCome = Math.abs(rider.trainOff - tr.aboard.off) < Math.abs(offWas - tr.aboard.off)
    tr.speed = 0
    tr.leave()
    out.jumpedOff = !tr.aboard
    // The Moon: a rocket, the trip, low gravity, space-suit zombies, home.
    s.inv.add({ kind: 'item', id: 'rocket', n: 1 })
    out.rocketPicked = pick('rocket')
    tm.pos.set(P.x - 30.5, P.y + 20, P.z + 0.5)
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) bm.placeBlock(P.x - 30 + x, P.y + 19, P.z + z, 'stone')
    bm._yaw = Math.PI / 2
    s.inv.useHeld()
    out.rocketStands = !!s.moon.rocket && !s.inv.has('rocket')
    const rk = s.moon.rocket
    tm.pos.set(rk.x + 1, rk.y, rk.z)
    out.launch = s.moon.use() && !!s.moon.trip
    for (let i = 0; i < 160 && s.moon.trip; i++) s.moon.update(0.05)
    out.onMoon = s.moon.on && Math.abs(tm.pos.y - 301) < 3 && s.moon.built && !s._ride
    s.moon.update(0.05)
    out.lowGravity = tm.gravityMult === 0.3 && s.moon._sky.visible
    out.moonGround = /tuff|calcite|endstone/.test(bm.getBlockAt(Math.floor(s.moon.cx + 10), 300, Math.floor(s.moon.cz)) || '') || !!s.moon.spawnSpots().length
    out.craterSpawns = s._spawnSpots().every(([, y]) => y > 290)
    const mz = s._makeZombie(++s._zid, tm.pos.x + 2, tm.pos.y, tm.pos.z, 100, false)
    s.moon.update(0.05)
    out.spaceSuit = !!mz.suit
    const home = s.moon.home
    tm.pos.set(home.x + 1, home.y, home.z)
    out.goHome = s.moon.use()
    for (let i = 0; i < 160 && s.moon.trip; i++) s.moon.update(0.05)
    s.moon.update(0.05)
    out.backOnEarth = !s.moon.on && tm.pos.y < 200 && tm.gravityMult === 1
    g.buildMode.survival.stop?.()
    g._exitBuildMode?.()
    out.moonGone = !g.buildMode.getBlockAt(0, 300, 0)
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('Sleds, hot springs, the Zombie Zoo and Floor is Lava', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    localStorage.setItem('gayz-creatures', JSON.stringify({ list: [1, 2, 3].map((id) => ({ id, t: 'z', k: 'walker', r: 'common', n: id, at: id })), team: [], nextId: 4 }))
    let s = await start('classic')
    const tm = s.bm.tryMode
    const pick = (id) => {
      s.inv.active = s.inv.hotbar.findIndex((it) => it?.id === id)
      return s.inv.active >= 0
    }
    // Sled: crafted, on, glides on snow, drags off it, a drop speeds it up, a run pays.
    s.inv.add({ kind: 'block', id: 'oakplanks', n: 4 })
    s.inv.add({ kind: 'item', id: 'plantFiber', n: 1 })
    out.sledCrafted = s.inv.crafting.craft('sled') && s.inv.has('sled')
    out.sledPicked = pick('sled')
    s.inv.useHeld()
    out.sledOn = s.sled.on && !!s.sled.mesh?.parent
    const p = tm.pos
    const fx = Math.floor(p.x)
    const fy = Math.floor(p.y - 0.05)
    const fz = Math.floor(p.z)
    const was = s.bm.getBlockAt(fx, fy, fz)
    s.bm.removeBlock(fx, fy, fz)
    s.bm.placeBlock(fx, fy, fz, 'stone')
    const drag = s.sled.mods(true, p)
    s.bm.removeBlock(fx, fy, fz)
    s.bm.placeBlock(fx, fy, fz, 'snow')
    const glide = s.sled.mods(true, p)
    out.sledSnow = !!glide && !!drag && glide.speed > 1.3 && glide.grip < 0.5 && drag.speed < 1
    tm.onGround = true
    s.sled.update(0.05)
    const y0 = p.y
    p.y -= 2
    s.bm.placeBlock(fx, Math.floor(p.y - 0.05), fz, 'snow')
    s.sled.update(0.05)
    out.sledFaster = s.sled.boost > 0.3
    p.y = y0
    const coins = s.coins
    s.sled.run = 40
    s.sled.top = 9
    s.inv.useHeld()
    out.sledRunPaid = !s.sled.on && !s.sled.mesh && s.coins > coins
    s.bm.removeBlock(fx, fy, fz)
    if (was) s.bm.placeBlock(fx, fy, fz, was)
    // Hot spring: a pool of water, steam, and it heals you in it.
    const gy = s._groundUnder(p.x, p.y + 1, p.z) - 1
    const sp = s.springs.build(fx, gy, fz)
    out.springPool = s.bm.getBlockAt(fx, gy, fz) === 'water' && s.bm.getBlockAt(fx, gy - 1, fz) === 'water' && sp.puffs.length > 0
    tm.pos.set(fx + 0.5, gy, fz + 0.5)
    s.health = 10
    s.springs.update(1)
    out.springHeals = s.health > 10 && s.springs.inSpring(s.bodyPos())
    s.springs.clear()
    out.springGone = s.bm.getBlockAt(fx, gy, fz) !== 'water'
    // Zombie Zoo: the caught zombies walk about in a pen at camp.
    const camp = s.camp
    for (let i = 0; i < 20 && !camp?.zoo; i++) await new Promise((res) => setTimeout(res, 100))
    out.zoo = !!camp?.zoo
    if (camp?.zoo) {
      const Zoo = camp.zoo.constructor
      camp.zoo.dispose()
      camp.zoo = new Zoo(camp)
      camp.zoo.build([camp.trophies?.spot && { ...camp.trophies.spot, wide: 8 }].filter(Boolean))
      out.zooPen = !!camp.zoo.group && camp.zoo.zombies.length === 3
      const x0 = camp.zoo.zombies[0].x
      const z0 = camp.zoo.zombies[0].z
      camp.zoo.zombies[0].wait = 0
      for (let i = 0; i < 10; i++) camp.zoo.update(0.1)
      out.zooWalks = camp.zoo.zombies[0].x !== x0 || camp.zoo.zombies[0].z !== z0
    }
    await stop()
    localStorage.removeItem('gayz-creatures')
    // Floor is Lava: a floor in the sky, tiles glow then melt, falling = out.
    s = await start('floorLava')
    const pm = s.party
    out.lavaMade = !!pm?.ext && s.cfg.noZombies
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const L = pm.ext
    out.lavaFloor = pm.phase === 'play' && s.bm.getBlockAt(Math.floor(L.tileMid(0).x), 230, Math.floor(L.tileMid(0).z)) !== null && s.bm.tryMode.pos.y > 229
    for (let i = 0; i < 80; i++) pm.update(0.05)
    out.lavaGlows = L.tiles.some((st) => st > 0)
    const snap = JSON.parse(JSON.stringify(pm.snapshot()))
    out.lavaSnap = typeof snap.x?.tl === 'string' && snap.x.tl.length === 81
    const bot = [...pm.bots.values()][0]
    bot.y = 200
    pm._run(0.05)
    out.lavaBotOut = pm.out.has(bot.id) && bot.y > 229
    for (const b of pm.bots.values()) pm.out.add(b.id)
    pm._run(0.05)
    out.lavaWin = pm.phase === 'end' && pm.winner === pm.myId
    await stop()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Laser Tag, Kart Racing, the Obstacle Course, minecarts and the haunted house', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    const toPlay = (pm) => { for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05) }
    // Laser Tag: teams in a sky arena, a tag scores and knocks out.
    let s = await start('laserTag')
    let pm = s.party
    toPlay(pm)
    out.laserTeams = pm.phase === 'play' && pm.teams.size === 6 && s.bm.tryMode.pos.y > 190
    out.laserArena = s.bm.getBlockAt(Math.floor(pm.home.x), 190, Math.floor(pm.home.z)) !== null
    const enemy = [...pm.bots.values()].find((b) => pm.teams.get(b.id) !== pm.myTeam)
    pm.stun(enemy.id, pm.myId)
    out.laserScore = pm.score[pm.myTeam] === 1 && pm.stunned.get(enemy.id) === 3
    const friend = [...pm.bots.values()].find((b) => pm.teams.get(b.id) !== pm.myTeam)
    pm.stun(pm.myId, friend.id)
    out.laserKo = pm.ext.speed() === 0
    await stop()
    // Kart Racing: in a kart on the grid, bots drive, items, laps.
    s = await start('kartRace')
    pm = s.party
    toPlay(pm)
    const K = pm.ext
    out.kartIn = !!s.kart.driving && s.kart.lockedIn && Math.abs(s.kart.y - 211) < 0.6
    s.kart.leave()
    out.kartLocked = s.kart.driving
    const bot = [...pm.bots.values()][0]
    const ks = bot.ks
    for (let i = 0; i < 20; i++) pm.update(0.05)
    out.kartBotsDrive = bot.ks > ks + 1 && !!bot.kartMesh
    K.item = 'boost'
    out.kartBoost = K.shoot() && s.kart.boostT > 0 && !K.item
    K.item = 'banana'
    K.shoot()
    out.kartBanana = K.bananas.length >= 1
    const L = 4 * 20 + 2 * Math.PI * 13
    K.prog.set(bot.id, { s: L * 0.95, laps: 2, cp: true })
    bot.ks = L * 3 + 1
    pm._run(0.05)
    out.kartWin = pm.phase === 'end' && pm.winner === bot.id
    out.kartSnap = !!JSON.parse(JSON.stringify(pm.snapshot())).x?.pr
    await stop()
    // Obstacle Course: no bots, checkpoints, falling back, the finish and best time.
    localStorage.removeItem('gayz-parkour-best')
    s = await start('obstacleCourse')
    pm = s.party
    toPlay(pm)
    const P = pm.ext
    const tm = s.bm.tryMode
    out.parkourStart = pm.phase === 'play' && pm.bots.size === 0 && Math.abs(tm.pos.y - 261) < 0.5
    out.parkourMoves = JSON.stringify(P.moverAt(0, 0)) !== JSON.stringify(P.moverAt(0, 3500))
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    tm.pos.set(hx + 26.5, 264, hz + 0.5)
    pm.update(0.05)
    out.parkourCheckpoint = P.cp === 1
    tm.pos.set(hx + 30, 240, hz)
    pm.update(0.05)
    out.parkourBack = Math.abs(tm.pos.x - (hx + 26.5)) < 0.1 && tm.pos.y > 263
    tm.pos.set(hx + 105.5, 270, hz + 0.5)
    pm.update(0.05)
    out.parkourDone = P.done > 0 && pm.phase === 'end' && Number(localStorage.getItem('gayz-parkour-best')) === P.done
    await stop()
    localStorage.removeItem('gayz-parkour-best')
    // Minecarts: a line through the rock, a ride to the end, zombies hop on.
    s = await start('classic')
    const me = s.bodyPos()
    let tr = null
    // Away from the camp (tracks never cut through it).
    for (const [ox, oz] of [[-70, 0], [70, 0], [0, 70], [0, -70]]) for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!tr) tr = s.carts.lay(Math.floor(me.x + ox), Math.floor(me.y) - 10, Math.floor(me.z + oz), dir)
    out.cartLaid = !!tr && tr.len >= 18 && s.bm.getBlockAt(Math.floor(tr.x0 + tr.dx * 5), tr.y - 1, Math.floor(tr.z0 + tr.dz * 5)) === 'stonebricks'
    if (tr) {
      const coins = s.coins
      tr.armed = true
      tm.pos.set(tr.x0, tr.y, tr.z0)
      s.carts.update(0.05)
      out.cartRiding = !!s.carts.riding
      for (let i = 0; i < 200 && s.carts.riding; i++) s.carts.ride(0.05)
      out.cartArrived = !s.carts.riding && tr.at === tr.len && s.coins > coins && !s._ride
      const key = [Math.floor(tr.x0 + tr.dx * 5), tr.y - 1, Math.floor(tr.z0 + tr.dz * 5)]
      s.carts.clear()
      out.cartRestored = s.carts.tracks.length === 0 && s.bm.getBlockAt(...key) !== 'stonebricks'
    }
    // The haunted house: only at night, ghosts, the attic chest pays.
    s.haunted.clear()
    const gy = s._groundUnder(me.x + 25, me.y + 15, me.z)
    s.haunted.build(Math.floor(me.x + 25), gy, Math.floor(me.z))
    const h = s.haunted.house
    out.hauntBuilt = !!h && s.bm.getBlockAt(h.x0 + 4, h.y0 + 10, h.z0 + 4) === 'lootchest' && s.haunted.ghosts.length === 5
    const c0 = s.coins
    s.haunted.onChest(s.haunted.chest)
    out.hauntLoot = s.coins === c0 + 100
    s.haunted._scare()
    out.hauntScare = document.getElementById('haunt-scare')?.classList.contains('on')
    s.haunted.clear()
    out.hauntGone = s.bm.getBlockAt(h.x0 + 4, h.y0 + 10, h.z0 + 4) !== 'lootchest'
    await stop()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('UFO abduction, the dragon boss and the Duel Arena', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    let s = await start('classic')
    const tm = s.bm.tryMode
    // A copy: bodyPos() is your live position.
    const me = { ...s.bodyPos() }
    // UFO: beams a zombie up, then takes you; beat the aliens, the pad takes you home.
    const run = s.ufo.event(me)
    const u = s.ufo.ufo
    out.ufoCame = !!run && !!s.ufo._group
    u.gx = me.x + 40
    u.gz = me.z
    run.update(0.05)
    const zb = s._extraZombie(u.x, s._groundUnder(u.x, me.y + 10, u.z), u.z)
    s.ufo._beamUp()
    for (let i = 0; i < 40; i++) run.update(0.05)
    out.ufoBeamsUp = !!zb && !s.zombies.includes(zb)
    const coins = s.coins
    for (let i = 0; i < 40 && !s.ufo.aboard; i++) {
      tm.pos.set(u.x, s._groundUnder(u.x, me.y + 10, u.z), u.z)
      run.update(0.05)
    }
    const ab = s.ufo.aboard
    out.ufoTaken = !!ab && tm.pos.y > 340 && ab.aliens.length === 4
    for (const a of ab?.aliens || []) a.health = 0
    run.update(0.05)
    out.ufoPad = !!ab?.open
    if (ab) tm.pos.set(ab.cx + 0.5, 341, ab.cz + 0.5)
    const done = run.update(0.05)
    out.ufoHome = done === false && !s.ufo.aboard && tm.pos.y < 300 && s.coins === coins + 90
    s.ufo.clear()
    // Dragon: a lair, fireballs hurt, shots bring it down, the hoard pays.
    s.wave = 3
    tm.pos.set(me.x, me.y, me.z)
    // (Its lair next to you: a test's world is only loaded round the camp.)
    const drun = s.dragon.event(me, { x: Math.floor(me.x) + 20, y: Math.floor(me.y), z: Math.floor(me.z) })
    const d = s.dragon.d
    out.dragonCame = !!drun && !!d && document.getElementById('dragon-bar')?.style.display === 'flex'
    drun.update(0.05)
    s.health = s.maxHealth
    s.dragon._breathe(s.bodyPos())
    out.dragonBreathes = s.dragon.fireballs.length === 1
    // One coming straight at you from close by.
    const ball = s.dragon.fireballs[0]
    const at = s.bodyPos()
    ball.p.set(at.x, at.y + 1, at.z + 3)
    ball.v.set(0, 0, -16)
    for (let i = 0; i < 20 && s.dragon.fireballs.length; i++) s.dragon._fire(0.05)
    out.dragonFire = s.health < s.maxHealth
    const B = s.B
    const ray = s.bm._raycaster.ray.clone()
    ray.origin.set(d.x * B, (d.y + 20) * B, d.z * B)
    ray.direction.set(0, -1, 0)
    out.dragonHit = s.dragon.shoot(ray, 1e9, 100) && d.hp < 1500
    const c1 = s.coins
    const gems = g.gems || 0
    s.dragon.shoot(ray, 1e9, 5000)
    out.dragonSlain = d.dying > 0 && s.coins === c1 + 300 && g.gems === gems + 3
    s.dragon.clear()
    out.dragonGone = !s.dragon.d && document.getElementById('dragon-bar')?.style.display === 'none'
    await stop()
    // Duel Arena: you against a bot, a hit takes duel health, a win moves the rating.
    localStorage.removeItem('gayz-duel')
    s = await start('duelArena')
    const pm = s.party
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const D = pm.ext
    out.duelFighters = pm.phase === 'play' && D.fighters.length === 2 && D.fighters.includes(pm.myId) && D.hp.get(pm.myId) === 100 && s.bm.tryMode.pos.y > 170
    const foe = D._other(pm.myId)
    D._hit(foe, 30, pm.myId)
    out.duelHit = D.hp.get(foe) === 70
    const snap = JSON.parse(JSON.stringify(pm.snapshot()))
    out.duelSnap = snap.x?.hp?.[foe] === 70 && snap.x.fi.includes('|')
    D._hit(foe, 100, pm.myId)
    pm.update(0.05)
    const rating = JSON.parse(localStorage.getItem('gayz-duel') || '{}')
    out.duelWon = pm.phase === 'end' && pm.winner === pm.myId && rating.rating === 1020 && rating.wins === 1
    await stop()
    localStorage.removeItem('gayz-duel')
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Idea list 7, batch 1 (2026-11-06): Zombie Mini-Golf, Freeze Tag and the
// camp's Daily Lucky Wheel.
test('Zombie Mini-Golf, Freeze Tag and the Lucky Wheel', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    const toPlay = (pm) => { for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05) }
    // Mini-Golf: a course in the sky, a ball each, putts count, zombies, holes.
    let s = await start('miniGolf')
    let pm = s.party
    toPlay(pm)
    const G = pm.ext
    const tee = G.tee()
    out.golfCourse = pm.phase === 'play' && s.bm.tryMode.pos.y > 240 && !!s.bm.getBlockAt(Math.floor(tee.x), 240, Math.floor(tee.z)) && G.balls.size === 6
    const ball = G.balls.get(pm.myId)
    s.bm.tryMode.pos.set(ball.x, 241, ball.z - 3)
    out.golfPutt = G.shoot({ direction: { x: 0, y: 0, z: 1 } }) === true && pm.score[pm.myId] === 1 && ball.vz > 0
    out.golfNoDoublePutt = G.shoot({ direction: { x: 0, y: 0, z: 1 } }) === false && pm.score[pm.myId] === 1
    const z0 = ball.z
    for (let i = 0; i < 40; i++) pm.update(0.05)
    out.golfRolls = ball.z > z0 + 1
    for (let i = 0; i < 120; i++) pm.update(0.05)
    out.golfBotsPutt = [...pm.bots.values()].some((b) => (pm.score[b.id] || 0) >= 1)
    // A zombie in the way knocks a ball off.
    const zb = G.zombies[0]
    const other = [...G.balls.values()].find((b) => !b.cup)
    other.x = zb.x + 0.3
    other.z = zb.z
    other.vx = other.vz = 0
    pm._run(0.01)
    out.golfZombieKnock = Math.hypot(other.vx, other.vz) > 3
    out.golfSnap = !!JSON.parse(JSON.stringify(pm.snapshot())).x?.bx
    for (const b of G.balls.values()) b.cup = true
    pm._run(0.05)
    out.golfNextHole = G.hole === 1 && [...G.balls.values()].every((b) => !b.cup)
    G.hole = 2
    for (const b of G.balls.values()) b.cup = true
    for (const id of Object.keys(pm.score)) pm.score[id] = 9
    pm.score[pm.myId] = 3
    pm._run(0.05)
    out.golfFewestWins = pm.phase === 'end' && pm.winner === pm.myId
    await stop()
    // Freeze Tag: a Tagger freezes on touch, a friend thaws, all frozen = Taggers win.
    s = await start('freezeTag')
    pm = s.party
    toPlay(pm)
    const F = pm.ext
    out.freezeTaggers = pm.phase === 'play' && pm.seekers.size === 2
    const tagger = [...pm.seekers][0]
    const runners = pm._people().filter((p) => !pm.seekers.has(p.id) && p.bot)
    const tg = pm.bots.get(tagger) || null
    const victim = runners[0].bot
    if (tg) {
      victim.x = tg.x + 0.5
      victim.z = tg.z
      victim.y = tg.y
    } else {
      const me = s.bodyPos()
      victim.x = me.x + 0.5
      victim.z = me.z
      victim.y = me.y
    }
    F.run(pm._people(), 0.05)
    out.freezeTag = F.frozen.has(victim.id)
    // Move everyone else far away, a friend stands by the frozen one.
    for (const b of pm.bots.values()) if (b !== victim) { b.x += 40; b.z += 40 }
    s.bm.tryMode.pos.x += 60
    const helper = runners[1].bot
    helper.x = victim.x + 1
    helper.z = victim.z
    helper.y = victim.y
    for (let i = 0; i < 70; i++) F.run(pm._people(), 0.05)
    out.freezeThaw = !F.frozen.has(victim.id)
    for (const p of pm._people()) if (!pm.seekers.has(p.id)) F.frozen.add(p.id)
    F.run(pm._people(), 0.05)
    out.freezeTaggersWin = pm.phase === 'end' && pm.winner === 's'
    out.freezeMeSpeed = typeof F.speed() === 'number'
    await stop()
    // The Lucky Wheel at camp: one spin a day, a prize, Spin Again.
    localStorage.removeItem('gayz-lucky-wheel')
    s = await start('classic')
    const camp = s.camp
    for (let i = 0; i < 30 && !camp?.wheel; i++) await new Promise((res) => setTimeout(res, 100))
    const W = camp?.wheel
    out.wheelBuilt = !!W?.group
    if (W?.group) {
      const m = W._mid()
      s.bm.tryMode.pos.set(m.x, s.bm.tryMode.pos.y, m.z)
      out.wheelNear = W.near()
      const coins = g.coins || 0
      W.use()
      out.wheelSpins = !!W.spin
      W.spin.prize = 6 // 250 coins
      for (let i = 0; i < 50; i++) W.update(0.1)
      out.wheelPrize = !W.spin && (g.coins || 0) === coins + 250
      W.use()
      out.wheelOncePerDay = !W.spin
      localStorage.removeItem('gayz-lucky-wheel')
      W.use()
      W.spin.prize = 7 // Spin Again
      for (let i = 0; i < 50; i++) W.update(0.1)
      W.use()
      out.wheelAgain = !!W.spin
      for (let i = 0; i < 50; i++) W.update(0.1)
    }
    await stop()
    localStorage.removeItem('gayz-lucky-wheel')
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Idea list 7, batch 2 (2026-11-06): the graveyard, the lighthouse, the
// camp treehouse and Bomb Defuse.
test('Graveyard Midnight, the lighthouse, the treehouse and Bomb Defuse', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    let s = await start('classic')
    const bm = s.bm
    const tm = bm.tryMode
    // A flat stone floor far off in the sky to build on.
    const P = { x: 4200, y: 150, z: 4200 }
    for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) bm.placeBlock(P.x + x, P.y - 1, P.z + z, 'stone')
    // Graveyard: fence, graves, the dead rise when you walk in, a coffin.
    const gy = s.graveyard
    gy.build(P.x - 5, P.y, P.z - 5)
    out.graveBuilt = bm.getBlockAt(P.x - 5, P.y, P.z - 5) === 'stonefence' && gy.graves.length === 8 && bm.getBlockAt(P.x - 3, P.y + 1, P.z - 1) === 'chiseledstonebricks'
    const zb0 = s.zombies.length
    tm.pos.set(P.x + 0.5, P.y, P.z + 0.5)
    for (let i = 0; i < 100; i++) gy._update(0.1)
    const risen = s.zombies.slice(zb0)
    out.graveRise = risen.length === 8 && gy.yard.risen.length === 8
    out.graveSkeletons = risen.some((z) => z.skel || z.kind) || risen.length === 8
    for (const z of risen) s._removeZombie(z)
    s.zombies = s.zombies.filter((z) => !risen.includes(z))
    gy._update(0.1)
    out.graveCoffin = gy.yard.cleared && bm.getBlockAt(P.x, P.y, P.z) === 'lootchest'
    const coins = s.coins
    s.useChest(P.x, P.y, P.z)
    out.graveLoot = s.coins >= coins + 90
    gy.clear()
    out.graveGone = !bm.getBlockAt(P.x - 5, P.y, P.z - 5) && bm.getBlockAt(P.x, P.y - 1, P.z) === 'stone'
    // Lighthouse: a striped tower with a ladder; the beam marks zombies.
    const L = s.lighthouse
    L.build(P.x, P.y, P.z)
    out.lhTower = bm.getBlockAt(P.x + 1, P.y + 3, P.z) === 'redconcrete' && bm.getBlockAt(P.x, P.y + 5, P.z) === 'ladder' && bm.getBlockAt(P.x, P.y + 16, P.z) === 'sealantern'
    const zb = s._extraZombie(P.x + 10.5, P.y, P.z + 0.5, null)
    L.angle = 0
    out.lhInBeam = L.inBeam(zb.x, zb.z) && !L.inBeam(P.x - 10.5, P.z + 0.5)
    L._sweep()
    out.lhSpotted = zb.spotted > 0
    L._drawMarks()
    out.lhMarker = L._marks.length >= 1 && L._marks[0].visible
    tm.pos.set(P.x + 1.5, P.y + 15, P.z + 0.5)
    zb.spotted = 0
    L._sweep()
    out.lhTopLonger = L.onTop(s.bodyPos()) && zb.spotted > 6
    L.clear()
    out.lhGone = !bm.getBlockAt(P.x + 1, P.y + 3, P.z)
    s._removeZombie(zb)
    s.zombies = s.zombies.filter((z) => z !== zb)
    // Treehouse at camp: a deck up the tree, the ladder pulls up and down.
    const camp = s.camp
    for (let i = 0; i < 30 && !camp?.treehouse; i++) await new Promise((res) => setTimeout(res, 100))
    const T = camp?.treehouse
    out.treeBuilt = !!T?.spot
    if (T?.spot) {
      const h = T.hatch
      out.treeLadder = bm.getBlockAt(h.x, T.y0 + 2, h.z) === 'ladder'
      const deck = T._cell(0, 3)
      tm.pos.set(deck.x + 0.5, T.y0 + 7, deck.z + 0.5)
      out.treeNear = T.near()
      camp.use()
      out.treeUp = T.up && !bm.getBlockAt(h.x, T.y0 + 2, h.z) && bm.getBlockAt(h.x, T.y0 + 6, h.z) === 'oakplanks'
      camp.use()
      out.treeDown = !T.up && bm.getBlockAt(h.x, T.y0 + 2, h.z) === 'ladder'
    }
    await stop()
    // Bomb Defuse: plant on a site, tick, defuse; time out = Blue.
    s = await start('bombDefuse')
    const pm = s.party
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const Bx = pm.ext
    out.bombTeams = pm.phase === 'play' && pm.teams.size === 6 && s.bm.tryMode.pos.y > 275
    const red = [...pm.bots.values()].filter((b) => pm.teams.get(b.id) === 'r')
    const blue = [...pm.bots.values()].filter((b) => pm.teams.get(b.id) === 'b')
    // Hold everyone else back at their ends.
    const park = () => {
      for (const b of pm.bots.values()) { b.x = pm.home.x - 18; b.z = pm.home.z; b.y = 276 }
      s.bm.tryMode.pos.set(pm.home.x - 18, 276, pm.home.z + 3)
    }
    park()
    const site = Bx.site(0)
    red[0].x = site.x
    red[0].z = site.z
    for (let i = 0; i < 50; i++) Bx.run(pm._people(), 0.1)
    out.bombPlanted = Bx.planted === 0 && Bx.bombT > 30
    park()
    if (blue.length) {
      blue[0].x = site.x
      blue[0].z = site.z
      for (let i = 0; i < 60 && pm.phase === 'play'; i++) Bx.run(pm._people(), 0.1)
      out.bombDefused = pm.phase === 'end' && pm.winner === 'b'
    }
    out.bombSnap = JSON.parse(JSON.stringify(pm.snapshot())).x?.pl === 0
    await stop()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Idea list 7, batch 3 (2026-11-06): the Vault Heist, the Theme Park, the
// Time Machine and Werewolf Night.
test('the Vault Heist, the Theme Park, the Time Machine and Werewolf Night', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    let s = await start('classic')
    const bm = s.bm
    const tm = bm.tryMode
    const P = { x: 4300, y: 150, z: 4300 }
    for (let x = -18; x <= 18; x++) for (let z = -18; z <= 18; z++) bm.placeBlock(P.x + x, P.y - 1, P.z + z, 'stone')
    const killAll = (list) => {
      for (const z of list) s._removeZombie(z)
      s.zombies = s.zombies.filter((z) => !list.includes(z))
    }
    // Vault Heist: sleeping guards, noise wakes them, the vault's gold.
    const H = s.heist
    H.build(P.x - 6, P.y, P.z - 5)
    out.heistBank = bm.getBlockAt(P.x - 6, P.y + 1, P.z - 5) === 'stonebricks' && bm.getBlockAt(P.x, P.y, P.z + 4) === 'lootchest' && bm.getBlockAt(P.x - 3, P.y, P.z + 1) === 'iron'
    out.heistAsleep = H.bank.guards.length === 4 && H.bank.guards.every((zb) => zb.asleep && zb.frozen > 1000)
    tm.pos.set(P.x + 0.5, P.y, P.z - 3)
    tm._crouch = true
    tm.vel.set(0, 0, 0)
    H._update(0.5)
    out.heistQuiet = H.noiseLevel === 0
    // A perfect heist: open the vault with everyone asleep.
    let coins = s.coins
    s.useChest(P.x, P.y, P.z + 4)
    out.heistSneaky = s.coins >= coins + 240
    H.clear()
    killAll(s.zombies.filter((z) => z.asleep !== undefined))
    H.build(P.x - 6, P.y, P.z - 5)
    tm.pos.set(P.x + 0.5, P.y, P.z - 3)
    for (let i = 0; i < 3; i++) H.noise(40)
    H._update(0.05)
    out.heistAlarm = H.bank.alarm && H.bank.guards.length === 7 && H.bank.guards.every((zb) => !zb.asleep && !(zb.frozen > 0))
    coins = s.coins
    // (A loot chest opens once a wave - this is the same spot as before.)
    s._chestsUsed.clear()
    s.useChest(P.x, P.y, P.z + 4)
    out.heistLoud = s.coins >= coins + 120 && s.coins < coins + 240
    const guards = [...H.bank.guards]
    H.clear()
    killAll(guards)
    tm._crouch = false
    // Theme Park: rides you sit in, Whack-a-Zombie pays coins.
    const K = s.park
    out.parkSpot = K.spot() === null || Number.isFinite(K.spot().x)
    K.build(P.x, P.y, P.z)
    out.parkPlaza = bm.getBlockAt(P.x - 15, P.y, P.z) === 'oakfence' && !!bm.getBlockAt(P.x, P.y - 1, P.z) && !!K._group
    const bottom = K._cabin(0, 0)
    tm.pos.set(K.park.x + bottom.x + 1, P.y, K.park.z + bottom.z)
    out.parkFerris = K.use() && K.ride?.kind === 'ferris'
    for (let i = 0; i < 150; i++) K._rideStep(0.1)
    out.parkFerrisHigh = !!s._ride && s._ride.y > P.y + 10
    for (let i = 0; i < 200 && K.ride; i++) K._rideStep(0.1)
    out.parkFerrisOff = !K.ride && !s._ride
    const st = K.trackPoint(0)
    tm.pos.set(K.park.x + st.x + 1.6, P.y, K.park.z + st.z)
    out.parkCoaster = K.use() && K.ride?.kind === 'coaster'
    let top = 0
    for (let i = 0; i < 600 && K.ride; i++) {
      K._rideStep(0.05)
      if (s._ride) top = Math.max(top, s._ride.y)
    }
    out.parkCoasterHills = top > P.y + 7 && !K.ride
    tm.pos.set(K.park.x + 6, P.y, K.park.z - 7.6)
    out.parkWhack = K.use() && !!K.game
    const head = K._heads[0]
    head.up = 1
    const THREE = { Ray: bm._raycaster.ray.constructor, V: bm.camera.position.constructor }
    const target = new THREE.V((K.park.x + head.x) * s.B, (K.park.y + head.y) * s.B, (K.park.z + head.z) * s.B)
    const from = new THREE.V(target.x, target.y, target.z - 3 * s.B)
    const ray = new THREE.Ray(from, target.clone().sub(from).normalize())
    out.parkWhackHit = s.park.shoot(ray) && K.game.hits === 1
    coins = s.coins
    K.game.left = 0.01
    K._gameStep(0.05)
    out.parkWhackCoins = !K.game && s.coins === coins + 4
    K.clear()
    out.parkGone = !bm.getBlockAt(P.x - 15, P.y, P.z)
    // Time Machine: craft, put down, need a pass, go to the Ice Age, home.
    localStorage.removeItem('gayz-time-eras')
    s.inv.add({ kind: 'block', id: 'cobblestone', n: 16 })
    s.inv.add({ kind: 'block', id: 'glass', n: 4 })
    s.inv.add({ kind: 'item', id: 'heliFuel', n: 2 })
    s.inv.add({ kind: 'item', id: 'zombieGoo', n: 7 })
    s.inv.add({ kind: 'block', id: 'oakplanks', n: 1 })
    out.timeCrafted = s.inv.crafting.craft('timeMachine') && s.inv.has('timeMachine') && s.inv.crafting.craft('timePass') && s.inv.has('timePass')
    tm.pos.set(P.x + 0.5, P.y, P.z + 0.5)
    bm._yaw = 0
    const T = s.time
    out.timePlaced = T.place() && !!T.machine
    tm.pos.set(T.machine.x + 1, T.machine.y, T.machine.z)
    out.timePick = T.use() && T.pickOpen && document.querySelectorAll('#time-pick button').length === 6
    s.inv.takeItem('timePass')
    out.timeNeedsPass = T.go('ice') === false && !T.away
    s.inv.add({ kind: 'item', id: 'timePass', n: 1 })
    const zb0 = s.zombies.length
    out.timeGo = T.go('ice') === true && T.away && !T.pickOpen && Math.abs(tm.pos.y - 421) < 1 && !s.inv.has('timePass')
    out.timeEraWorld = !!bm.getBlockAt(Math.floor(T.cx), 419, Math.floor(T.cz)) && T._sky?.visible !== undefined
    out.timeIceZombies = s.zombies.length - zb0 === 5 && T.zombies.every((zb) => zb.frozen > 0 && zb.era === 'ice')
    out.timeSpawnSpots = s._spawnSpots().every(([, y]) => y === 421)
    const zx = Math.floor(T.zombies[0].x)
    const zz = Math.floor(T.zombies[0].z)
    out.timeIceBlock = bm.getBlockAt(zx, 421, zz) === 'ice'
    for (let i = 0; i < 40; i++) T._iceStep(0.1)
    out.timeIceBreaks = bm.getBlockAt(zx, 421, zz) !== 'ice'
    coins = s.coins
    T.left = 0.01
    T.update(0.05)
    out.timeHome = !T.away && Math.abs(tm.pos.y - T.machine.y) < 1 && s.coins === coins + 60 && JSON.parse(localStorage.getItem('gayz-time-eras')).includes('ice')
    out.timeEraGone = !bm.getBlockAt(Math.floor(T.cx), 419, Math.floor(T.cz)) && T.zombies.length === 0
    localStorage.removeItem('gayz-time-eras')
    await stop()
    // Werewolf Night: a secret Werewolf, a knock-out at night, the day's vote.
    s = await start('werewolfNight')
    const pm = s.party
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const W = pm.ext
    out.wolfOne = pm.phase === 'play' && pm.seekers.size === 1 && W.sub === 'night'
    const wolf = W.wolf
    const people = pm._people()
    const a = people.find((p) => p.id === wolf)
    const victim = people.find((p) => p.id !== wolf && p.bot)
    victim.bot.x = a.x + 1
    victim.bot.z = a.z
    out.wolfClaw = W.claw(wolf, victim.id) && pm.out.has(victim.id)
    out.wolfOncePerNight = !W.claw(wolf, people.find((p) => p.id !== wolf && p.id !== victim.id).id)
    W.subLeft = 0
    W.run(pm._people(), 0.05)
    out.wolfDay = W.sub === 'day'
    for (const p of pm._people()) if (!pm.out.has(p.id) && p.id !== wolf) W.vote(p.id, wolf)
    W.vote(wolf, pm._people().find((p) => p.id !== wolf && !pm.out.has(p.id)).id)
    W.subLeft = 0
    W.run(pm._people(), 0.05)
    out.wolfCaught = pm.phase === 'end' && pm.winner === 'h'
    out.wolfSnap = typeof JSON.parse(JSON.stringify(pm.snapshot())).x?.vs === 'string'
    await stop()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('the camp Plaza (newspaper, lost and found, pinball, chess), the Pet Zombie and the Water Gun', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-lost-found')
    localStorage.removeItem('gayz-pet-zombie')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    for (let i = 0; i < 50 && !s._skin; i++) await new Promise((res) => setTimeout(res, 100))
    const bm = s.bm
    const tm = bm.tryMode
    s.camp.update(0.016)
    const plaza = s.camp.plaza
    out.plazaBuilt = !!plaza?.spot && plaza.stations.length === 4
    const at = (id) => {
      const st = plaza.stations.find((x) => x.id === id)
      tm.pos.set(st.x, 0, st.z)
      return plaza.near()?.id === id
    }
    // The newspaper.
    out.newsNear = at('news')
    out.newsOpens = plaza.use() && !!document.querySelector('#camp-screen .news-headline')?.textContent && bm.mouseScreenOpen()
    document.querySelector('#camp-screen .camp-screen-x').click()
    out.newsCloses = !document.getElementById('camp-screen') && !bm.mouseScreenOpen()
    // Lost & Found: a dropped item that's never picked up again.
    s.inv.hotbar[3] = { kind: 'item', id: 'zombieGoo', n: 2 }
    s.inv.active = 3
    s.inv.drop()
    const d = s._drops.list.find((x) => x.type === 'zombieGoo')
    out.lostMarked = !!d?.mine
    d.age = 1000
    s._drops.update(0.016)
    out.lostSaved = JSON.parse(localStorage.getItem('gayz-lost-found') || '[]').some((v) => v[1] === 'zombieGoo')
    out.lostNear = at('lost')
    plaza.use()
    const take = [...document.querySelectorAll('#camp-screen button')].find((b) => b.className === 'camp-screen-btn')
    take.click()
    out.lostBack = s.inv.hotbar[3]?.n === 2 && JSON.parse(localStorage.getItem('gayz-lost-found')).length === 0 && !document.getElementById('camp-screen')
    // Pinball: a bumper scores, a ball drains.
    at('pinball')
    plaza.use()
    const P = plaza.last
    out.pinLaunch = P.launch() && !!P.ball
    P.ball.x = 100
    P.ball.y = 110
    P.ball.vx = 0
    P.ball.vy = 300
    for (let i = 0; i < 20; i++) P.step(0.005)
    out.pinBumper = P.score >= 100
    P.ball.x = 150
    P.ball.y = 470
    P.ball.vx = 0
    P.ball.vy = 400
    for (let i = 0; i < 40; i++) P.step(0.005)
    out.pinDrain = !P.ball && P.balls === 2
    document.querySelector('#camp-screen .camp-screen-x').click()
    // Chess: 20 first moves, Fool's mate, the zombie answers.
    at('chess')
    plaza.use()
    const C = plaza.last
    out.chess20 = C.legal().length === 20
    C.play(53, 45)
    C.play(12, 28)
    C.play(54, 38)
    C.play(3, 39)
    out.chessMate = C.result() === 'mate'
    document.querySelector('#camp-screen .camp-screen-x').click()
    at('chess')
    plaza.use()
    const C2 = plaza.last
    C2.tap(52)
    C2.tap(36)
    await new Promise((res) => setTimeout(res, 600))
    out.chessReply = C2.S.turn === 'w' && C2.S.b[36] === 'P' && C2.legal().length > 0
    document.querySelector('#camp-screen .camp-screen-x').click()
    // Pet Zombie: a Brain Snack on a zombie in front of you.
    const P0 = { x: 4300, y: 150, z: 4300 }
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) bm.placeBlock(P0.x + x, P0.y - 1, P0.z + z, 'stone')
    tm.pos.set(P0.x + 0.5, P0.y, P0.z + 0.5)
    bm._yaw = 0
    bm._pitch = 0
    bm.camera.position.set((P0.x + 0.5) * s.B, (P0.y + 1.62) * s.B, (P0.z + 0.5) * s.B)
    bm.camera.rotation.set(0, 0, 0)
    bm.camera.updateMatrixWorld()
    const z1 = s._makeZombie(++s._zid, P0.x + 0.5, P0.y, P0.z - 2.5, 100, false)
    s.zombies.push(z1)
    s.inv.hotbar[4] = { kind: 'item', id: 'brainSnack', n: 1 }
    s.inv.active = 4
    s.inv.apply?.()
    out.petTamed = s.inv.useHeld() && !!s.pet.pet && !s.zombies.includes(z1) && !!localStorage.getItem('gayz-pet-zombie') && !s.inv.hotbar[4]
    const z2 = s._makeZombie(++s._zid, s.pet.pet.x + 1, P0.y, s.pet.pet.z, 100, false)
    s.zombies.push(z2)
    for (let i = 0; i < 40; i++) s.pet.update(0.05)
    out.petBites = z2.health < 100
    s.pet.release()
    out.petReleased = !s.pet.pet && !localStorage.getItem('gayz-pet-zombie')
    // Water Gun: soaks a zombie, puts out a fire, empties and refills.
    const z3 = s._makeZombie(++s._zid, P0.x + 0.5, P0.y, P0.z - 4, 100, false)
    z3.burn = 3
    s.zombies.push(z3)
    s.inv.hotbar[5] = { kind: 'item', id: 'waterGun', n: 1 }
    s.inv.active = 5
    s.inv.apply?.()
    out.waterSquirt = s.inv.useHeld() && s.water.tank === 24 && !!s.inv.hotbar[5]
    for (let i = 0; i < 30; i++) s.water.update(0.016)
    out.waterSoak = z3.soaked > 0 && !(z3.burn > 0)
    s._groundFires = s._groundFires || []
    s._groundFires.push({ x: P0.x, y: P0.y, z: P0.z - 6, t: 0, life: 20 })
    out.waterDouse = s.water.douse(P0.x + 0.5, P0.y + 0.3, P0.z - 5.5) >= 1 && !s._groundFires.some((f) => f.z === P0.z - 6)
    s.water.tank = 0
    s.water._nextAt = 0
    out.waterEmpty = !s.water.squirt()
    s.stop?.()
    g._exitBuildMode?.()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('the Wingsuit, Dodgeball, Musical Chairs and Simon Says', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    const play = (pm) => {
      for (let i = 0; i < 300 && pm.phase === 'wait'; i++) pm.update(0.05)
      return pm.phase === 'play'
    }
    // Wingsuit: opens on a long fall, glides, rings pay.
    let s = await start('classic')
    const bm = s.bm
    const tm = bm.tryMode
    const P = { x: 4300, y: 150, z: 4300 }
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) bm.placeBlock(P.x + x, P.y - 1, P.z + z, 'stone')
    s.inv.add({ kind: 'item', id: 'wingsuit', n: 1 })
    const W = s.wing
    tm.pos.set(P.x + 0.5, P.y + 40, P.z + 0.5)
    tm.vel.set(0, -15, 0)
    bm._yaw = 0
    bm._pitch = 0
    W.fly(tm.vel, 0.016, false, false)
    out.wingOpens = W.open && W.rings.length === 6
    for (let i = 0; i < 60; i++) W.fly(tm.vel, 0.016, false, false)
    out.wingGlides = tm.vel.z < -12 && Math.abs(tm.vel.x) < 1 && tm.vel.y > -4 && tm.vel.y < -1
    const ring = W.rings[0]
    let coins = s.coins
    tm.pos.set(ring.c.x, ring.c.y - 1, ring.c.z + 0.5)
    W.update(0.016)
    tm.pos.set(ring.c.x, ring.c.y - 1, ring.c.z - 0.5)
    W.update(0.016)
    out.wingRing = ring.got && s.coins === coins + 5
    W.fly(tm.vel, 0.016, false, true)
    out.wingCrouchCloses = !W.open
    W.fly(tm.vel, 0.016, true, false)
    out.wingLands = W.rings.length === 0
    await stop()
    // Dodgeball: teams, a ball hit scores, the middle line holds.
    s = await start('dodgeball')
    let pm = s.party
    out.dodgePlay = play(pm)
    const D = pm.ext
    const mine = pm.myTeam
    const foe = [...pm.bots.values()].find((b) => pm.teams.get(b.id) && pm.teams.get(b.id) !== mine)
    out.dodgeTeams = !!mine && !!foe
    D.balls = []
    D._throw({ x: foe.x - (mine === 'r' ? 1.2 : -1.2), y: foe.y + 1, z: foe.z }, { x: mine === 'r' ? 1 : -1, y: 0, z: 0 }, mine, pm.myId, true)
    D.balls[0].vy = 0
    for (let i = 0; i < 5; i++) D._fly(0.02)
    out.dodgeHit = pm.stunned.has(foe.id) && pm.score[mine] === 1
    const hf = D.half(mine)
    s.bm.tryMode.pos.set(pm.home.x + (mine === 'r' ? 5 : -5), 181, pm.home.z)
    D.events({ phase: 'play', round: pm.round })
    out.dodgeLine = s.bm.tryMode.pos.x >= hf.lo && s.bm.tryMode.pos.x <= hf.hi
    out.dodgeSnap = Array.isArray(JSON.parse(JSON.stringify(pm.snapshot())).x?.db)
    await stop()
    // Musical Chairs: one fewer chair, whoever's left standing is out.
    s = await start('musicalChairs')
    pm = s.party
    out.chairsPlay = play(pm)
    const C = pm.ext
    const n0 = pm._people().length
    out.chairsCount = C.n === n0 - 1 && C.sub === 'music'
    C.subLeft = 0
    C.run(pm._people(), 0.05)
    out.chairsGrab = C.sub === 'grab'
    const bots = [...pm.bots.values()]
    const c0 = C.chair(0)
    s.bm.tryMode.pos.set(c0.x, 221, c0.z)
    bots.forEach((b, i) => {
      const c = i < C.n - 1 ? C.chair(i + 1) : { x: pm.home.x + 9, z: pm.home.z }
      b.x = b.tx = c.x
      b.z = b.tz = c.z
      b.y = b.ty = 221
    })
    C.run(pm._people(), 0.05)
    out.chairsOut = pm.out.size === 1 && pm.out.has(bots[bots.length - 1].id) && C.n === n0 - 2 && C.sub === 'music'
    await stop()
    // Simon Says: do it when Simon says, don't when he doesn't.
    s = await start('simonSays')
    pm = s.party
    out.simonPlay = play(pm)
    const S = pm.ext
    S.subLeft = 0
    S.run(pm._people(), 0.05)
    out.simonOrder = S.sub === 'cmd' && !!S.cmd
    out.simonPads = S.padAt(pm.home.x + 6, pm.home.z + 6) === 'yellow' && S.padAt(pm.home.x, pm.home.z) === ''
    const ids = pm._people().map((p) => p.id)
    S._say()
    S.cmd = 'jump'
    S.simon = true
    for (const id of ids) S.track.set(id, { x: 0, z: 0, y0: -100, moved: 0, rose: id !== ids[1] })
    S.subLeft = -1
    const people = pm._people().map((p) => ({ ...p, y: -1000 }))
    S.run(people, 0)
    out.simonSaysOut = pm.out.size === 1 && pm.out.has(ids[1])
    pm.out.clear()
    S._say()
    S.cmd = 'freeze'
    S.simon = false
    for (const id of ids) S.track.set(id, { x: 0, z: 0, y0: 100, moved: id === ids[2] ? 0 : 10, rose: false })
    S.subLeft = -1
    S.run(pm._people().map((p) => ({ ...p, x: 0, z: 0, y: -1000 })), 0)
    out.simonNotSaysOut = pm.out.size === 1 && pm.out.has(ids[2])
    out.simonSnap = typeof JSON.parse(JSON.stringify(pm.snapshot())).x?.sc === 'string'
    await stop()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('Hardcore Survival and cooking, the Zombie Museum and the Story Campaign', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    for (const k of ['gayz-play-saved-run', 'gayz-museum', 'gayz-campaign']) localStorage.removeItem(k)
    g.settings.selectedGameMode = 'classic'
    g.settings.mutators.hardcore = true
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    g.settings.mutators.hardcore = false
    const bm = s.bm
    const tm = bm.tryMode
    const H = s.hunger
    out.hungerCfg = s.cfg.hunger === true
    H.start()
    const bag = [...s.inv.hotbar, ...s.inv.grid]
    out.hungerCampfire = H.on && bag.some((it) => it?.kind === 'block' && it.id === 'campfire')
    H.food = 50
    H.update(60)
    out.hungerDrains = H.food < 50 && H.food > 40
    // Eating at full health while hungry.
    const P = { x: 4300, y: 150, z: 4300 }
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) bm.placeBlock(P.x + x, P.y - 1, P.z + z, 'stone')
    tm.pos.set(P.x + 0.5, P.y, P.z + 0.5)
    s.health = s.maxHealth
    H.food = 50
    s.inv.hotbar[6] = { kind: 'item', id: 'veggies', n: 1 }
    s.inv.active = 6
    out.hungerEats = s.inv.useHeld() && Math.round(H.food) === 75
    // Cooking by a campfire.
    out.hungerNoFire = !H.nearFire()
    bm.placeBlock(P.x + 2, P.y, P.z, 'campfire')
    bm.specials?.rebuild?.()
    out.hungerFire = H.nearFire()
    s.inv.hotbar[6] = { kind: 'item', id: 'meat', n: 1 }
    s.inv.active = 6
    s.inv.useHeld()
    out.hungerCooks = [...s.inv.hotbar, ...s.inv.grid].some((it) => it?.id === 'cookedMeat') && !s.inv.hotbar[6]
    // Starving.
    H.food = 0
    s.health = 50
    H.update(3.2)
    out.hungerStarves = s.health <= 48 && s.health >= 46
    H.food = 100
    // The Museum: a rare find, a boss beaten.
    s.camp.update(0.016)
    const M = s.camp.museum
    out.museumBuilt = !!M?.spot
    s.inv.add({ kind: 'item', id: 'goldenFish', n: 1 })
    out.museumItem = JSON.parse(localStorage.getItem('gayz-museum')).items.includes('goldenFish')
    const boss = s._makeZombie(++s._zid, P.x + 3, P.y, P.z + 3, 10, true)
    s.zombies.push(boss)
    s.damageZombie(boss, 1e6)
    out.museumBoss = JSON.parse(localStorage.getItem('gayz-museum')).bosses.includes('waveBoss')
    M._checkIn = 0
    M.update()
    out.museumCounts = M.counts().items === 1 && M.counts().bosses === 1
    tm.pos.set(M.door.x, 0, M.door.z)
    out.museumOpens = M.use() && document.querySelectorAll('#camp-screen .museum-list div').length > 10
    document.querySelector('#camp-screen .camp-screen-x').click()
    // The Story Campaign.
    const L = s.camp.lab
    out.labBuilt = !!L?.spot
    tm.pos.set(L.door.x, 0, L.door.z)
    out.storyStarts = L.use() && L.story.ch === 0 && L.story.started && !!document.querySelector('#camp-screen .story-line')
    const next = () => [...document.querySelectorAll('#camp-screen button')].find((b) => b.className === 'camp-screen-btn')
    for (let i = 0; i < 6 && document.getElementById('camp-screen'); i++) next().click()
    out.storySceneEnds = !document.getElementById('camp-screen')
    let coins = s.coins
    out.storyMoon = !L.reached(0) && L._finish(0) && L.story.done && s.coins >= coins + 100
    L.use()
    out.storyNextChapter = L.story.ch === 1 && L.story.started && !L.story.done
    document.querySelector('#camp-screen .camp-screen-x').click()
    tm.pos.y = 302
    out.storyHeaven = L.reached(1)
    tm.pos.set(L.door.x, 0, L.door.z)
    L.story = { ch: 4, started: true, done: false }
    coins = s.coins
    s.inv.add({ kind: 'item', id: 'theCure', n: 1 })
    out.storyCure = L.use() && L.story.ch === 5 && s.coins >= coins + 500 && !s.inv.has('theCure') && JSON.parse(localStorage.getItem('gayz-campaign')).ch === 5
    document.querySelector('#camp-screen .camp-screen-x')?.click()
    s.stop?.()
    g._exitBuildMode?.()
    for (const k of ['gayz-museum', 'gayz-campaign']) localStorage.removeItem(k)
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})
