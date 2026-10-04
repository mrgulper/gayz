// Keeps the two hand-written player pages in step with the game.
//
// Patch Notes (#changelog-list) and GayZ Features (#features-main) are plain
// HTML in index.html - nothing generates them from the code, so they only
// change when someone remembers. They silently fell behind for days
// (2026-10-04). This check makes it impossible to forget: any change to the
// game (src/, public/, index.html) must also edit Patch Notes and GayZ
// Features, or say in its commit message why it doesn't need to:
//
//   [no-notes: <why>]     nothing a player would notice (refactor, tests)
//   [no-features: <why>]  no feature was added, removed or changed
//
// The reason is required (a bare [no-notes] fails): it makes skipping a
// written decision someone can read back and question, not a reflex. A
// script can't judge whether the reason - or the page text - is right;
// that part is still a person's call.
//
// Put the markers in the commit body, not the title - titles are the
// player-facing patch-note line posted to Discord.
//
// It also fails on any number typed straight into GayZ Features: counts and
// numbers there go in <span data-feature-count|data-feature-value="key">,
// filled from the game's own constants by Game.js's _featureCounts() /
// _featureValues(), so they can't go stale ("15 firearms" when there were 14).
// Numbers that are part of a name (AK-47, Map 3) are in ALLOWED_NUMBERS.
//
// Usage:
//   node scripts/check-docs.mjs --commit-msg <file>   (git commit-msg hook)
//   node scripts/check-docs.mjs --range <base>..<head> (CI, a whole PR)
//   node scripts/check-docs.mjs --page                 (just the typed-number check, working tree)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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

// Numbers that belong to a name or a fixed fact, not a count that can drift.
const ALLOWED_NUMBERS = [
  /AK-47/g, /Glock 18/g, /M1911/g, /\bC4\b/g, /64x64/g, /\bMap [13]\b/g, /\b3D\b/g,
  /\b2x\b/g, /\b1 HP\b/g, /1–10/g, /1–3/g, /4–0/g, /\b16x16\b/g,
]

const MARKER_REASON = (name) => new RegExp(`\\[${name}:\\s*[^\\]\\s][^\\]]{7,}\\]`, 'i')

// Every digit left in #features-main once the generated spans, tags and
// allowed names are taken out - each one is a hand-typed number.
function typedNumbers(indexContent) {
  const start = indexContent.indexOf('id="features-main"')
  const end = indexContent.indexOf('end features-main')
  if (start < 0 || end < 0) return []
  let text = indexContent.slice(start, end)
    .replace(/<span data-feature-(?:count|value)="[^"]*">[^<]*<\/span>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
  for (const re of ALLOWED_NUMBERS) text = text.replace(re, '')
  const found = []
  for (const m of text.matchAll(/[^.\n]{0,40}\d[^.\n]{0,30}/g)) found.push(m[0].replace(/\s+/g, ' ').trim())
  return found
}

// In-game text names keys as {key:interact} / {key:healthPack} (filled
// from the player's real bindings - see i18n.js), never as a typed letter:
// "press H to use" kept showing for days after Health Packs moved to hotbar
// slot 4 (2026-10-04). These spot a key typed into en/zh/hi/es text.
const TYPED_KEY_PATTERNS = [
  /\*\*\s*(?:[A-Z0-9]|WASD|W A S D|TAB)\s*\*\*/,
  /\b(?:[Pp]ress|[Hh]old|[Tt]ap|[Pp]ulsa|[Mm]antén|[Pp]resiona)\s+[A-Z0-9](?![A-Za-z0-9])/,
  /按住?\s*[A-Z0-9](?![A-Za-z0-9])/,
  /(?<![A-Za-z0-9])[A-Z0-9]\s*दबा/,
  /\((?:[A-Z])\)/,
]

async function typedKeys() {
  const { STRINGS } = await import(pathToFileURL(`${process.cwd()}/src/game/i18n.js`).href)
  const { ACTIONS, HOTBAR_ITEM_SLOTS, FIXED_KEYS } = await import(pathToFileURL(`${process.cwd()}/src/game/Keybinds.js`).href)
  const knownKeys = new Set(['move', ...ACTIONS.map((a) => a.id), ...HOTBAR_ITEM_SLOTS.map((s) => s.id), ...Object.keys(FIXED_KEYS)])
  const unknown = []
  for (const [lang, dict] of Object.entries(STRINGS)) {
    for (const [key, value] of Object.entries(dict)) {
      if (typeof value !== 'string') continue
      for (const m of value.matchAll(/\{key:(\w+)\}/g)) if (!knownKeys.has(m[1])) unknown.push(`${lang}.${key} uses {key:${m[1]}}, which isn't an action in Keybinds.js (ACTIONS, HOTBAR_ITEM_SLOTS or FIXED_KEYS) - it would show as raw text.`)
    }
  }
  const found = []
  for (const lang of ['en', 'zh', 'hi', 'es']) {
    for (const [key, value] of Object.entries(STRINGS[lang] || {})) {
      if (typeof value !== 'string') continue
      const text = value.replace(/\{key:\w+\}/g, '')
      if (TYPED_KEY_PATTERNS.some((re) => re.test(text))) found.push(`${lang}.${key}`)
    }
  }
  // The same thing typed straight into code instead of i18n.js ("DOWNED -
  // Press F" on the companion's tag, the ammo guide's name).
  const inCode = []
  for (const file of readdirSync('src', { recursive: true })) {
    if (!/\.js$/.test(file) || /i18n\.js$/.test(file)) continue
    const lines = readFileSync(`src/${file}`, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return
      for (const m of line.matchAll(/(['"`])((?:(?!\1).)*)\1/g)) {
        if (TYPED_KEY_PATTERNS.some((re) => re.test(m[2]))) inCode.push(`src/${file}:${i + 1} has a key typed into player text ("${m[2].slice(0, 50)}"). Move it to i18n.js with {key:<action id>}.`)
      }
    })
  }
  return [...unknown, ...inCode, ...found.map((k) => `${k} (src/game/i18n.js) has a key typed into it. Write {key:<action id>} instead (e.g. **{key:interact}**, {key:healthPack}) so it shows the player's real key.`)]
}

function check({ files, indexDiff, indexContent, message }) {
  if (!files.some((f) => GAME_PATH.test(f))) return []
  const problems = typedNumbers(indexContent).map((t) => `GayZ Features has a typed number in "${t}". Wrap it in <span data-feature-value="key">, add that key to _featureValues() in Game.js, or add it to ALLOWED_NUMBERS here if it's part of a name.`)
  for (const name of ['no-notes', 'no-features']) {
    if (new RegExp(`\\[${name}\\]`, 'i').test(message)) problems.push(`[${name}] needs a reason now, e.g. [${name}: only tests changed].`)
  }
  const lines = indexContent.split('\n')
  const notes = lineRange(lines, 'id="changelog-list"', 'end changelog-list')
  const features = lineRange(lines, 'id="features-main"', 'end features-main')
  const touched = touchedLines(indexDiff)
  const inRange = (r) => r && touched.some((n) => n >= r[0] && n <= r[1])
  if (!inRange(notes) && !MARKER_REASON('no-notes').test(message)) {
    problems.push('Patch Notes were not updated. Add a line to the newest entry in #changelog-list (index.html), or put [no-notes: <why>] in the commit message if players won\'t notice this change.')
  }
  if (!inRange(features) && !MARKER_REASON('no-features').test(message)) {
    problems.push('GayZ Features was not updated. Add or fix the entry in #features-main (index.html), or put [no-features: <why>] in the commit message if no feature was added, removed or changed.')
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
const keyProblems = await typedKeys()
const problems = mode === '--commit-msg' ? fromCommitMsg(arg)
  : mode === '--range' ? fromRange(arg)
  : mode === '--page' ? check({ files: ['index.html'], indexDiff: '@@ -1 +1 @@', indexContent: readFileSync('index.html', 'utf8'), message: '[no-notes: page check only] [no-features: page check only]' })
  : null
if (problems !== null) problems.push(...keyProblems)
if (problems === null) {
  console.error('usage: check-docs.mjs --commit-msg <file> | --range <base>..<head> | --page')
  process.exit(2)
}
if (problems.length) {
  console.error('\nPlayer-text check failed (Patch Notes / GayZ Features / in-game text):\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('')
  process.exit(1)
}
