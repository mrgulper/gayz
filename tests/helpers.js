// Shared test helpers. `page.waitForFunction(() => window.__game)` has been
// observed reporting a timeout that ignores its own override on this
// project (see CLAUDE.md) - a poll loop is the reliable alternative.
export async function waitForGame(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.evaluate(() => !!window.__game)) return
    await page.waitForTimeout(500)
  }
  throw new Error('window.__game did not appear within ' + timeoutMs + 'ms')
}

// The #asset-loader overlay waits for real GPU-warmup frames before hiding
// itself, which can take a long time in a slow/headless environment and
// isn't the thing any test here is actually about - force it hidden once
// window.__game exists.
export async function hideAssetLoader(page) {
  await page.evaluate(() => {
    const loader = document.getElementById('asset-loader')
    if (loader) loader.style.display = 'none'
  })
}

export async function gotoAndWaitForGame(page, path = '/') {
  await page.goto(path)
  await waitForGame(page)
  await hideAssetLoader(page)
}
