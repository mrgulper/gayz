import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Save export/import round-trip and malformed-file handling.
//
// Scope note: _applyImportedSaveData() (the real import path) clears
// localStorage, writes the new data, then calls window.location.reload()
// synchronously - CLAUDE.md documents this as unreliable to drive through
// a real reload inside page.evaluate() (a real reload firing mid-evaluate
// reliably throws "Execution context was destroyed" and can silently kill
// later checks in the same call). Rather than fight that, this test
// verifies the two safely-testable halves: export produces a real
// snapshot of current storage, and a malformed file is rejected before
// ever reaching the reload path (JSON.parse fails first, inside a
// try/catch, well before any reload could happen).
test('export snapshot matches current localStorage contents', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    const snapshot = g._snapshotLocalSave()
    const realKeys = Object.keys(localStorage)
    return {
      isObject: typeof snapshot === 'object' && snapshot !== null,
      hasSettingsKey: 'gayz-settings' in snapshot,
      keyCountMatches: Object.keys(snapshot).length === realKeys.length,
    }
  })

  expect(result.isObject).toBe(true)
  expect(result.hasSettingsKey).toBe(true)
  expect(result.keyCountMatches).toBe(true)
})

test('a malformed save file is rejected without crashing or reloading', async ({ page }) => {
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    const badFile = new File(['this is not valid json {{{'], 'bad-save.json', { type: 'application/json' })
    let threw = false
    try {
      await g._importSaveFile(badFile)
    } catch {
      threw = true
    }
    // Still on the same page / same window.__game instance means no
    // reload happened - a malformed file must fail before that path.
    return { threw, stillSameGame: window.__game === g }
  })

  expect(result.threw).toBe(false)
  expect(result.stillSameGame).toBe(true)
  expect(errors).toEqual([])
})
