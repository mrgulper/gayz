// Keeps the two hand-written player pages in step with the game.
//
// Patch Notes (#changelog-list) and GayZ Features (#features-main) are plain
// HTML in index.html - nothing generates them from the code, so they only
// change when someone remembers. They silently fell behind for days
// (2026-10-04). This check makes it impossible to forget: any change to the
// game (src/, public/, index.html) must also edit Patch Notes and GayZ
// Features, or say in its commit message why it doesn't need to:
//
//   [no-notes]     nothing a player would notice (refactor, tests, comments)
//   [no-features]  no feature was added, removed or changed (bug fix, look)
//
// Put the markers in the commit body, not the title - titles are the
// player-facing patch-note line posted to Discord.
//
// Usage:
//   node scripts/check-docs.mjs --commit-msg <file>   (git commit-msg hook)
//   node scripts/check-docs.mjs --range <base>..<head> (CI, a whole PR)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const GAME_PATH = /^(src\/|public\/|index\.html$)/

// [start, end] line numbers (1-based) of the element that opens on the line
// containing `marker`, ending at the line containing `endMarker`.
function lineRange(lines, marker, endMarker) {
  const start = lines.findIndex((l) => l.includes(marker))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.includes(endMarker))
  return [start + 1, (end < 0 ? lines.length : end) + 1]
}

// New-file line numbers touched by a unified diff (-U0) of index.html.
function touchedLines(diff) {
  const out = []
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    // A pure deletion (count 0) still edits the page right there.
    if (count === 0) out.push(start)
    for (let i = 0; i < count; i++) out.push(start + i)
  }
  return out
}

function check({ files, indexDiff, indexContent, message }) {
  if (!files.some((f) => GAME_PATH.test(f))) return []
  const lines = indexContent.split('\n')
  const notes = lineRange(lines, 'id="changelog-list"', 'end changelog-list')
  const features = lineRange(lines, 'id="features-main"', 'end features-main')
  const touched = touchedLines(indexDiff)
  const inRange = (r) => r && touched.some((n) => n >= r[0] && n <= r[1])
  const problems = []
  if (!inRange(notes) && !/\[no-notes\]/i.test(message)) {
    problems.push('Patch Notes were not updated. Add a line to the newest entry in #changelog-list (index.html), or put [no-notes] in the commit message if players won\'t notice this change.')
  }
  if (!inRange(features) && !/\[no-features\]/i.test(message)) {
    problems.push('GayZ Features was not updated. Add or fix the entry in #features-main (index.html), or put [no-features] in the commit message if no feature was added, removed or changed.')
  }
  return problems
}

function fromCommitMsg(msgFile) {
  // Merges bring in other commits' changes, which were checked on their own.
  if (existsSync('.git/MERGE_HEAD')) return []
  const message = readFileSync(msgFile, 'utf8')
  const files = git('diff', '--cached', '--name-only').split('\n').filter(Boolean)
  let indexContent = ''
  try { indexContent = git('show', ':index.html') } catch { /* no index.html staged or tracked */ }
  return check({ files, indexDiff: git('diff', '--cached', '-U0', '--', 'index.html'), indexContent, message })
}

function fromRange(range) {
  const files = git('diff', '--name-only', range).split('\n').filter(Boolean)
  const head = range.split(/\.{2,3}/).pop() || 'HEAD'
  return check({
    files,
    indexDiff: git('diff', '-U0', range, '--', 'index.html'),
    indexContent: git('show', `${head}:index.html`),
    message: git('log', '--format=%B', range.replace('...', '..')),
  })
}

const [mode, arg] = process.argv.slice(2)
const problems = mode === '--commit-msg' ? fromCommitMsg(arg) : mode === '--range' ? fromRange(arg) : null
if (problems === null) {
  console.error('usage: check-docs.mjs --commit-msg <file> | --range <base>..<head>')
  process.exit(2)
}
if (problems.length) {
  console.error('\nThis change touches the game but not the player pages:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('')
  process.exit(1)
}
