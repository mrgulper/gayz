import { execSync } from 'node:child_process'

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

export default {
  define: {
    __BUILD_HASH__: JSON.stringify(gitShortHash()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
}
