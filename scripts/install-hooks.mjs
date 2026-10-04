// npm install runs this (the "prepare" script): points git at the repo's
// own hooks in .githooks (the Patch Notes / GayZ Features check). Quietly
// does nothing where there's no git checkout (e.g. a deploy build).
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
} catch {
  // not a git checkout
}
