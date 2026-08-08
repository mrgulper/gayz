import { defineConfig } from '@playwright/test'

// Tests run against a real production build (`vite preview`), not the dev
// server - this project has no staging environment, so "does the actual
// bundled output work" is the only meaningful signal before a deploy.
// `webServer` builds fresh and starts preview automatically; CI and local
// runs both just need `npm test`.
export default defineConfig({
  testDir: './tests',
  // A single Game() construction alone measures 30-45s in this environment
  // (WebGL context + full asset load, see the workers note below) - tests
  // that do a real page.reload() construct it twice, so 60s isn't enough
  // headroom for those. 120s covers two full constructions plus margin.
  timeout: 120000,
  fullyParallel: false,
  // Each test constructs a real Game() - a full WebGL context + asset load.
  // Playwright defaults to one browser process per worker, and multiple of
  // these constructing at once (across parallel workers) is measured as far
  // slower than one at a time in this environment (see CLAUDE.md's
  // "Two full Game instances... constructing simultaneously" gotcha) -
  // slow enough to blow past the 60s per-test timeout. One worker avoids it.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
