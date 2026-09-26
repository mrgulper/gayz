import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import legacy from '@vitejs/plugin-legacy'

// Build version/hash for Credits (see _buildVersionLine) - short commit
// hash + build date, both computed once at build time. Falls back to
// 'dev' if git isn't available (e.g. a source zip with no .git folder)
// rather than failing the whole build over a Credits nicety.
function gitShortHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

const buildHash = gitShortHash()

// Update-available check (see Game.js's _checkForUpdate) - deliberately
// NOT the git hash above: confirmed via a real production deploy that
// `vercel --prod`'s upload doesn't carry .git along (gitShortHash() falls
// back to the literal string 'dev' there), which would make __BUILD_HASH__
// 'dev' on every single deploy - permanently indistinguishable from any
// other deploy. A build timestamp has no dependency on git at all and is
// trivially unique every time `vite build` actually runs, which is exactly
// the property this check needs (it only cares "is this a different build
// than what's currently loaded," not anything about the repo). Baked into
// __BUILD_ID__ below and mirrored into version.json - one value computed
// once, used both places, so they can never drift apart.
const buildId = Date.now()

// Emitted via writeBundle (after Vite/Rollup finishes writing dist/)
// rather than a static public/ file, since public/ files are copied
// as-is and can't contain a value that changes every build.
function writeVersionFilePlugin() {
  return {
    name: 'write-version-file',
    writeBundle(options) {
      writeFileSync(join(options.dir, 'version.json'), JSON.stringify({ id: buildId }))
    },
  }
}

export default {
  // Real report (2026-09-26): on an old Chromebook/phone, the main bundle
  // (<script type="module">, plus real optional-chaining/nullish-coalescing
  // syntax throughout Game.js) never ran at all - a browser too old for ES
  // modules just silently skips that script tag per spec, so the menu
  // painted (plain HTML/CSS) but nothing worked. This plugin builds a
  // SECOND, more-compatible bundle (transpiled + polyfilled) alongside the
  // normal one, loaded via a <script nomodule> fallback the modern browser
  // ignores - doesn't touch any game logic, purely a build-output change.
  plugins: [writeVersionFilePlugin(), legacy()],
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __BUILD_ID__: JSON.stringify(buildId),
  },
}
