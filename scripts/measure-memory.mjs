// Measures the game's memory in a real Map 1 match (production build on
// :4173, e.g. `npm run build && npm run preview -- --port 4173`).
// `node scripts/measure-memory.mjs` prints JS heap + GPU buffer estimates
// on the homepage, in a match, and after walking out into the open world.
import { chromium } from '@playwright/test'

const URL = process.env.URL || 'http://localhost:4173/'
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const cdp = await page.context().newCDPSession(page)
await cdp.send('Performance.enable')
await page.goto(URL)
for (let i = 0; i < 120 && !(await page.evaluate(() => !!window.__game)); i++) await page.waitForTimeout(500)

async function sample(label) {
  await page.evaluate(() => { window.gc?.(); window.gc?.() })
  const { metrics } = await cdp.send('Performance.getMetrics')
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  const extra = await page.evaluate(() => {
    const g = window.__game
    const b = g.buildMode
    let gpu = 0, meshes = 0
    const seen = new Set()
    const scene = b?.scene || g.scene
    scene?.traverse?.((o) => {
      const geo = o.geometry
      if (!geo || seen.has(geo)) return
      seen.add(geo); meshes++
      // Counted from the attribute's size, not its array (block chunks
      // drop their arrays once uploaded - BlockChunks dropAfterUpload).
      const bytes = (a) => a.count * a.itemSize * (a.array ? a.array.BYTES_PER_ELEMENT : a.count > 65535 ? 4 : a.itemSize === 1 ? 2 : 4)
      for (const a of Object.values(geo.attributes || {})) gpu += bytes(a)
      if (geo.index) gpu += bytes(geo.index)
    })
    return {
      blocks: b?._blocks?.size,
      chunkCells: b?._chunkCells?.size,
      columns: b?.world?.columns?.size,
      terrainKeys: b?.world?.terrainKeys?.size,
      geometries: meshes,
      geometryMB: Math.round(gpu / 1048576),
      textures: (b?.renderer || g.renderer)?.info?.memory?.textures,
    }
  })
  console.log(label.padEnd(22), 'heapMB', Math.round(m.JSHeapUsedSize / 1048576), JSON.stringify(extra))
}

await sample('homepage')
await page.evaluate(async () => { await window.__game._enterBuildMode({ map: 'map3', play: true }) })
await page.waitForTimeout(8000)
await sample('match start')
await page.evaluate(() => {
  const w = window.__game.buildMode.world
  for (let i = 0; i < 40; i++) w.update([{ x: 0, z: 0 }])
})
await sample('match settled')
await page.evaluate(() => {
  const w = window.__game.buildMode.world
  for (const [x, z] of [[200, 0], [400, 0], [400, 300], [100, 500]]) for (let i = 0; i < 60; i++) w.update([{ x, z }])
})
await sample('after walking far')
// Running for a minute without forcing cleanup, like a real player idling:
// JS heap in use (incl. not-yet-collected garbage) and every Chromium
// process's resident memory, by type.
const { execSync } = await import('node:child_process')
function procs() {
  const out = execSync('ps -axo rss=,command=').toString().split('\n').filter((l) => /chrom/i.test(l) && /playwright|ms-playwright/.test(l))
  const by = {}
  for (const l of out) {
    const rss = +l.trim().split(/\s+/)[0]
    const type = (l.match(/--type=([a-z-]+)/) || [, 'browser'])[1]
    const util = (l.match(/--utility-sub-type=([\w.]+)/) || [])[1]
    const k = util ? 'util:' + util.split('.').pop() : type
    by[k] = (by[k] || 0) + Math.round(rss / 1024)
  }
  return by
}
await page.evaluate(() => { const w = window.__game.buildMode.world; for (let i = 0; i < 60; i++) w.update([{ x: 0, z: 0 }]) })
for (let t = 0; t <= 60; t += 15) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  console.log(`idle ${t}s`.padEnd(22), 'heapUsed', Math.round(m.JSHeapUsedSize / 1048576), 'heapTotal', Math.round(m.JSHeapTotalSize / 1048576), 'procsMB', JSON.stringify(procs()))
  if (t < 60) await page.waitForTimeout(15000)
}
await browser.close()
