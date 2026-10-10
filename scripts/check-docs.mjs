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
// Hand-written sentences can't be checked by a script, but they can be tied
// to the code they describe: every GayZ Features entry carries
// data-code="identifiers", and How to Play steps (HOWTOPLAY_STEPS, Game.js)
// and Map Editor tips (MENU_TIPS, BuildMode.js) a `code: '...'` field. When
// a change touches a line using one of those identifiers, that text has to
// be edited in the same change or confirmed as still right with
// [reread: <entry title or text key>] in the commit message. An identifier
// that no longer exists anywhere in src/ fails too (the feature it describes
// was removed or renamed).
//
// Usage:
//   node scripts/check-docs.mjs --commit-msg <file>   (git commit-msg hook)
//   node scripts/check-docs.mjs --range <base>..<head> (CI, a whole PR)
//   node scripts/check-docs.mjs --page                 (the checks that don't need a diff, working tree)
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
  /AK-47/g, /Glock 18/g, /M1911/g, /MP5-SD/g, /\bC4\b/g, /64x64/g, /\bMap [13]\b/g, /\b3D\b/g,
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
// Case-insensitive word, but key letters stay case-sensitive (so "needs a
// key" or "Hit a 30-kill streak" don't count - only a capital letter/digit).
const ci = (w) => w.split('').map((c) => (/[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c.replace('-', '\\-'))).join('')
const KEY_VERBS = ['press', 'hold', 'tap', 'hit', 'push', 'use', 'click', 'double-tap', 'pulsa', 'pulse', 'presiona', 'mantén', 'usa', 'toca'].map(ci).join('|')
const K = '[A-Z0-9]'
const NOT_WORD = '(?![A-Za-z0-9])'
const TYPED_KEY_PATTERNS = [
  /\*\*\s*(?:[A-Z0-9]|WASD|W A S D|TAB)\s*\*\*/,
  new RegExp(`\\b(?:${KEY_VERBS})\\s+(?:${ci('the')}\\s+|${ci('la tecla')}\\s+)?\\*{0,2}${K}${NOT_WORD}`),
  new RegExp(`(?<![A-Za-z0-9'])${K}\\*{0,2}\\s+(?:${ci('key')}|${ci('button')})\\b`),
  new RegExp(`\\b(?:${ci('key')}|${ci('tecla')})\\s+\\*{0,2}${K}${NOT_WORD}`),
  // (index 4) bracketed keys - text only, code is full of x[0] and f(1).
  new RegExp(`\\[${K}\\]|<kbd>[^<]{1,6}</kbd>|\\(${K}\\)`),
  new RegExp(`(?:按住?|点按|键)\\s*\\*{0,2}${K}${NOT_WORD}|${K}\\*{0,2}\\s*键`),
  new RegExp(`(?<![A-Za-z0-9])${K}\\*{0,2}\\s*(?:कुंजी|बटन)?\\s*दबा`),
]

async function typedKeys() {
  const { STRINGS } = await import(pathToFileURL(`${process.cwd()}/src/game/i18n.js`).href)
  const { ACTIONS, FIXED_KEYS } = await import(pathToFileURL(`${process.cwd()}/src/game/Keybinds.js`).href)
  const knownKeys = new Set(['move', ...ACTIONS.map((a) => a.id), ...Object.keys(FIXED_KEYS)])
  const unknown = []
  for (const [lang, dict] of Object.entries(STRINGS)) {
    for (const [key, value] of Object.entries(dict)) {
      if (typeof value !== 'string') continue
      for (const m of value.matchAll(/\{key:(\w+)\}/g)) if (!knownKeys.has(m[1])) unknown.push(`${lang}.${key} uses {key:${m[1]}}, which isn't an action in Keybinds.js (ACTIONS or FIXED_KEYS) - it would show as raw text.`)
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
        if (TYPED_KEY_PATTERNS.some((re, n) => n !== 4 && re.test(m[2]))) inCode.push(`src/${file}:${i + 1} has a key typed into player text ("${m[2].slice(0, 50)}"). Move it to i18n.js with {key:<action id>}.`)
      }
    })
  }
  return [...unknown, ...inCode, ...found.map((k) => `${k} (src/game/i18n.js) has a key typed into it. Write {key:<action id>} instead (e.g. **{key:interact}**, {key:healthPack}) so it shows the player's real key.`)]
}

const norm = (t) => t.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase()

// Every hand-written text tied to code: {label, ids, lines? (index.html
// line range), textKey? (i18n key)}.
function linkedTexts(indexContent, read) {
  const out = []
  const lines = indexContent.split('\n')
  const end = lines.findIndex((l) => l.includes('end features-main'))
  lines.forEach((line, i) => {
    const m = line.match(/<div class="feature[^"]*" data-code="([^"]*)">/)
    if (!m) return
    let next = lines.findIndex((l, j) => j > i && /<div class="feature[\s"]|<\/section>/.test(l))
    if (next < 0 || next > end) next = end
    const h3 = lines.slice(i, next).join(' ').match(/<h3>(.*?)<\/h3>/)
    const label = (h3 ? h3[1] : '').replace(/<span data-feature-count="[^"]*">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '').replace('▸', '').replace(/&amp;/g, '&').trim()
    out.push({ label, ids: m[1].split(/\s+/).filter(Boolean), lines: [i + 1, next] })
  })
  for (const file of ['src/game/Game.js', 'src/game/BuildMode.js']) {
    for (const m of read(file).matchAll(/\{ key: '(\w+)'(?:, headingKey: '\w+')?, code: '([^']*)' \}/g)) {
      out.push({ label: m[1], ids: m[2].split(/\s+/).filter(Boolean), textKey: m[1] })
    }
  }
  return out
}

// Content lines a -U0 diff adds or removes, minus comments and the link
// declarations themselves.
function changedCode(diff) {
  return diff.split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1))
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/code: '|data-code="/.test(l))
}

function linkProblems({ indexContent, indexTouched, srcDiff, i18nDiff, message, read, srcText }) {
  const problems = []
  const texts = linkedTexts(indexContent, read)
  const featuresStart = indexContent.split('\n').findIndex((l) => l.includes('id="features-main"'))
  const comingSoon = indexContent.split('\n').findIndex((l) => l.includes('id="coming-soon"'))
  // Every live GayZ Features entry must be tied to code.
  indexContent.split('\n').forEach((l, i) => {
    if (i > featuresStart && i < comingSoon && /<div class="feature[\s"]/.test(l) && !/data-code="[^"]+"/.test(l)) {
      problems.push(`GayZ Features entry at index.html:${i + 1} has no data-code="..." - list the functions/constants it describes, so changes to them ask for it to be re-read.`)
    }
  })
  for (const t of texts) {
    for (const id of t.ids) {
      if (!new RegExp(`\\b${id}\\b`).test(srcText)) problems.push(`"${t.label}" is tied to ${id}, which no longer exists in src/. Check the text still describes the game, then update its code link.`)
    }
  }
  const code = changedCode(srcDiff)
  const i18nChanged = changedCode(i18nDiff).join('\n')
  const reread = new Set([...message.matchAll(/\[reread:\s*([^\]]+)\]/gi)].map((m) => norm(m[1])))
  for (const t of texts) {
    const hit = t.ids.find((id) => code.some((l) => new RegExp(`\\b${id}\\b`).test(l)))
    if (!hit) continue
    const edited = t.lines ? indexTouched.some((n) => n >= t.lines[0] && n <= t.lines[1]) : new RegExp(`^\\s*${t.textKey}:`, 'm').test(i18nChanged)
    if (edited || reread.has(norm(t.label))) continue
    const where = t.lines ? `GayZ Features entry "${t.label}" (index.html:${t.lines[0]})` : `${t.textKey} (src/game/i18n.js)`
    problems.push(`This change touches ${hit}, which ${where} describes. Re-read it: fix it if it's now wrong, or confirm it with [reread: ${t.label}] in the commit message.`)
  }
  return problems
}

function check({ files, indexDiff, indexContent, message, srcDiff = '', i18nDiff = '', read, srcText = '' }) {
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
  problems.push(...linkProblems({ indexContent, indexTouched: touched, srcDiff, i18nDiff, message, read, srcText }))
  return problems
}

// All of src/ as one string, for "does this identifier still exist".
function workingSrcText() {
  return readdirSync('src', { recursive: true }).filter((f) => /\.js$/.test(f)).map((f) => readFileSync(`src/${f}`, 'utf8')).join('\n')
}

function fromCommitMsg(msgFile) {
  // Merges bring in other commits' changes, which were checked on their own.
  if (existsSync('.git/MERGE_HEAD')) return []
  const message = readFileSync(msgFile, 'utf8')
  const files = git('diff', '--cached', '--name-only').split('\n').filter(Boolean)
  let indexContent = ''
  try { indexContent = git('show', ':index.html') } catch { /* no index.html staged or tracked */ }
  return check({
    files,
    indexDiff: git('diff', '--cached', '-U0', '--', 'index.html'),
    indexContent,
    message,
    srcDiff: git('diff', '--cached', '-U0', '--', 'src', ':!src/game/i18n.js'),
    i18nDiff: git('diff', '--cached', '-U0', '--', 'src/game/i18n.js'),
    read: (f) => { try { return git('show', `:${f}`) } catch { return '' } },
    srcText: workingSrcText(),
  })
}

function fromRange(range) {
  const files = git('diff', '--name-only', range).split('\n').filter(Boolean)
  const head = range.split(/\.{2,3}/).pop() || 'HEAD'
  return check({
    files,
    indexDiff: git('diff', '-U0', range, '--', 'index.html'),
    indexContent: git('show', `${head}:index.html`),
    message: git('log', '--format=%B', range.replace('...', '..')),
    srcDiff: git('diff', '-U0', range, '--', 'src', ':!src/game/i18n.js'),
    i18nDiff: git('diff', '-U0', range, '--', 'src/game/i18n.js'),
    read: (f) => { try { return git('show', `${head}:${f}`) } catch { return '' } },
    srcText: workingSrcText(),
  })
}

const [mode, arg] = process.argv.slice(2)
const keyProblems = await typedKeys()
const problems = mode === '--commit-msg' ? fromCommitMsg(arg)
  : mode === '--range' ? fromRange(arg)
  : mode === '--page' ? check({ files: ['index.html'], indexDiff: '@@ -1 +1 @@', indexContent: readFileSync('index.html', 'utf8'), message: '[no-notes: page check only] [no-features: page check only]', read: (f) => readFileSync(f, 'utf8'), srcText: workingSrcText() })
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
