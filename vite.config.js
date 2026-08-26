import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

// Update-available check (see Game.js's _checkForUpdate) - a static file
// carrying the SAME hash baked into __BUILD_HASH__ below, computed once
// and used for both, so the embedded value a page loaded with and the
// value it can later fetch to compare against are guaranteed to agree.
// Emitted via writeBundle (after Vite/Rollup finishes writing dist/)
// rather than a static public/ file, since public/ files are copied
// as-is and can't contain a value that changes every build.
function writeVersionFilePlugin() {
  return {
    name: 'write-version-file',
    writeBundle(options) {
      writeFileSync(join(options.dir, 'version.json'), JSON.stringify({ hash: buildHash }))
    },
  }
}

export default {
  plugins: [writeVersionFilePlugin()],
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
}
