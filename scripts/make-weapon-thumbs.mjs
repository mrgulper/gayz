// Draws every weapon's side-view picture once and saves them as
// public/images/weapon-thumbs/<id>.png, plus src/game/weaponThumbs.js
// (the list of saved ids). The game shows these files instead of drawing
// the pictures on the player's device - drawing them froze a slow device
// for up to a second the first time it pressed Play (2026-10-17 lag hunt).
//
// Run again whenever a weapon model changes or a weapon is added:
//   npm run build && npx vite preview --port 4173   (in another terminal)
//   node scripts/make-weapon-thumbs.mjs [http://localhost:4173]
/* global window, FileReader */
import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const url = process.argv[2] || 'http://localhost:4173'
const outDir = path.resolve('public/images/weapon-thumbs')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(url)
await page.waitForFunction(() => !!window.__game && Object.keys(window.__game.weapons?.viewmodels || {}).length > 0, null, { timeout: 180000 })
const pics = await page.evaluate(async () => {
  const out = await window.__game._weaponThumbnails()
  const res = {}
  for (const [id, u] of Object.entries(out)) {
    const b = await (await fetch(u)).blob()
    res[id] = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b) })
  }
  return res
})
await browser.close()
fs.mkdirSync(outDir, { recursive: true })
const ids = Object.keys(pics).sort()
for (const id of ids) fs.writeFileSync(path.join(outDir, id + '.png'), Buffer.from(pics[id], 'base64'))
const version = Date.now().toString(36)
fs.writeFileSync('src/game/weaponThumbs.js', `// Made by scripts/make-weapon-thumbs.mjs - don't edit by hand.
// Weapons with a ready-made picture in public/images/weapon-thumbs/.
export const WEAPON_THUMB_IDS = ${JSON.stringify(ids)}
// Changes every time the pictures are made again, so browsers fetch the new ones.
export const WEAPON_THUMBS_VERSION = '${version}'
`)
console.log('Saved', ids.length, 'weapon pictures:', ids.join(', '))
