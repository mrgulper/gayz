import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

test('entering Build Mode shows a scene with a ground plane, exiting returns to the homepage', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._enterBuildMode()
    const enteredActive = g.buildMode.active
    const hasGround = !!g.buildMode.ground
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
    g._enterBuildMode()
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

test('placing and removing a block updates both the InstancedMesh and the internal map', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._enterBuildMode()
    g.buildMode.placeBlock(2, 0, 3, 'brick')
    const afterPlace = {
      atBlock: g.buildMode.getBlockAt(2, 0, 3),
      meshCount: g.buildMode._instancedMeshes.brick.count,
    }
    g.buildMode.removeBlock(2, 0, 3)
    const afterRemove = {
      atBlock: g.buildMode.getBlockAt(2, 0, 3),
      meshCount: g.buildMode._instancedMeshes.brick.count,
    }
    g._exitBuildMode()
    return { afterPlace, afterRemove }
  })

  expect(result.afterPlace.atBlock).toBe('brick')
  expect(result.afterPlace.meshCount).toBe(1)
  expect(result.afterRemove.atBlock).toBe(null)
  expect(result.afterRemove.meshCount).toBe(0)
})

test('removing one block does not remove a different still-placed block of the same type (swap-remove correctness)', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._enterBuildMode()
    g.buildMode.placeBlock(0, 0, 0, 'stone')
    g.buildMode.placeBlock(1, 0, 0, 'stone')
    g.buildMode.placeBlock(2, 0, 0, 'stone')
    g.buildMode.removeBlock(1, 0, 0) // remove the middle one
    const remaining = {
      first: g.buildMode.getBlockAt(0, 0, 0),
      removed: g.buildMode.getBlockAt(1, 0, 0),
      third: g.buildMode.getBlockAt(2, 0, 0),
      meshCount: g.buildMode._instancedMeshes.stone.count,
    }
    g._exitBuildMode()
    return remaining
  })

  expect(result.first).toBe('stone')
  expect(result.removed).toBe(null)
  expect(result.third).toBe('stone')
  expect(result.meshCount).toBe(2)
})

test('Tab opens the picker, clicking a swatch changes the selected block type', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    g._enterBuildMode()
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
  expect(result.swatchCount).toBe(9)
  expect(result.afterClickType).not.toBe(result.beforeType)
  expect(result.closedAfterClick).toBe(false)
})

test('a saved build reloads correctly in a fresh BuildMode instance', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    g._enterBuildMode()
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

test('malformed save data does not crash Build Mode - starts empty instead', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))

  const result = await page.evaluate(() => {
    localStorage.setItem('gayz-build-mode', 'not valid json {{{')
    const g = window.__game
    g._enterBuildMode()
    const blockCount = g.buildMode._blocks.size
    g._exitBuildMode()
    return { blockCount }
  })

  expect(result.blockCount).toBe(0)
  expect(errors).toEqual([])
})

test('re-entering Build Mode multiple times does not accumulate duplicate movement listeners', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    // Enter/exit 3 times before the real measurement - if listeners were
    // leaking, this is where duplicates would build up.
    for (let i = 0; i < 3; i++) {
      g._enterBuildMode()
      g._exitBuildMode()
    }
    g._enterBuildMode()
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
