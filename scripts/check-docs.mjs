// Keeps the hand-written player text in step with the game.
//
// Patch Notes (#changelog-list) are plain HTML in index.html - nothing
// generates them from the code, so they only change when someone remembers.
// They silently fell behind for days (2026-10-04). This check makes it
// impossible to forget: any change to the game (src/, public/, index.html)
// must also edit Patch Notes, or say in its commit message why it doesn't
// need to:
//
//   [no-notes: <why>]     nothing a player would notice (refactor, tests)
//
// (The full features list moved out of the game on 2026-11-15; a leftover
// [no-features: ...] marker in a commit message is simply ignored.)
//
// The reason is required (a bare [no-notes] fails): it makes skipping a
// written decision someone can read back and question, not a reflex. A
// script can't judge whether the reason - or the page text - is right;
// that part is still a person's call.
//
// Put the markers in the commit body, not the title - titles are the
// player-facing patch-note line posted to Discord.
//
// Hand-written sentences can't be checked by a script, but they can be tied
// to the code they describe: How to Play steps (HOWTOPLAY_STEPS, Game.js)
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

const MARKER_REASON = (name) => new RegExp(`\\[${name}:\\s*[^\\]\\s][^\\]]{7,}\\]`, 'i')

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
    if (!/\.js$/.test(file) || /i18n(\.js$|\/)/.test(file)) continue
    const lines = readFileSync(`src/${file}`, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return
      for (const m of line.matchAll(/(['"`])((?:(?!\1).)*)\1/g)) {
        if (TYPED_KEY_PATTERNS.some((re, n) => n !== 4 && re.test(m[2]))) inCode.push(`src/${file}:${i + 1} has a key typed into player text ("${m[2].slice(0, 50)}"). Move it to src/game/i18n/ with {key:<action id>}.`)
      }
    })
  }
  return [...unknown, ...inCode, ...found.map((k) => `${k} (src/game/i18n/) has a key typed into it. Write {key:<action id>} instead (e.g. **{key:interact}**, {key:healthPack}) so it shows the player's real key.`)]
}

const norm = (t) => t.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase()

// Every hand-written text tied to code: {label, ids, textKey (i18n key)}.
function linkedTexts(read) {
  const out = []
  for (const file of ['src/game/Game.js', 'src/game/BuildMode.js']) {
    for (const m of read(file).matchAll(/\{ key: '(\w+)'(?:, headingKey: '\w+')?, code: '([^']*)' \}/g)) {
      out.push({ label: m[1], ids: m[2].split(/\s+/).filter(Boolean), textKey: m[1] })
    }
  }
  return out
}

// Content lines a -U0 diff adds or removes, minus comments and the link
// declarations themselves.
// A line that is removed in one place and added back unchanged somewhere
// else (code moved into another file - only `this` -> `game` and the
// indentation differ) is a move, not a change, so it's left out.
function changedCode(diff) {
  const lines = diff.split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .filter((l) => !/^.\s*(\/\/|\*|\/\*)/.test(l) && !/code: '|data-code="/.test(l))
  // Import lines, a declaration only gaining `export`, and a one-line
  // stand-in that hands a method on to its new module change nothing a
  // player sees either.
  const lines2 = lines.filter((l) => !/^.\s*import\b/.test(l) && !/^\+\s+(async )?\w+\([^)]*\) \{ return \w+\.\w+\(this(, [^)]*)?\) \}$/.test(l))
  lines.length = 0
  lines.push(...lines2)
  const moved = (l) => l.slice(1).trim().replace(/^export\s+/, '').replace(/^(async\s+)?function\s+(\w+)\(_?game(,\s*)?/, '$1$2(').replace(/\bthis\b/g, 'game')
  const removed = new Map()
  for (const l of lines) if (l[0] === '-') removed.set(moved(l), (removed.get(moved(l)) || 0) + 1)
  const out = []
  for (const l of lines) {
    if (l[0] !== '+') continue
    const k = moved(l)
    if (removed.get(k)) removed.set(k, removed.get(k) - 1)
    else out.push(l.slice(1))
  }
  for (const l of lines) {
    if (l[0] !== '-') continue
    const k = moved(l)
    if (removed.get(k)) {
      removed.set(k, removed.get(k) - 1)
      out.push(l.slice(1))
    }
  }
  return out
}

function linkProblems({ srcDiff, i18nDiff, message, read, srcText }) {
  const problems = []
  const texts = linkedTexts(read)
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
    const edited = new RegExp(`^\\s*${t.textKey}:`, 'm').test(i18nChanged)
    if (edited || reread.has(norm(t.label))) continue
    const where = `${t.textKey} (src/game/i18n/)`
    problems.push(`This change touches ${hit}, which ${where} describes. Re-read it: fix it if it's now wrong, or confirm it with [reread: ${t.label}] in the commit message.`)
  }
  return problems
}

function check({ files, indexDiff, indexContent, message, srcDiff = '', i18nDiff = '', read, srcText = '' }) {
  if (!files.some((f) => GAME_PATH.test(f))) return []
  const problems = []
  if (/\[no-notes\]/i.test(message)) problems.push('[no-notes] needs a reason now, e.g. [no-notes: only tests changed].')
  const lines = indexContent.split('\n')
  const notes = lineRange(lines, 'id="changelog-list"', 'end changelog-list')
  const touched = touchedLines(indexDiff)
  const inRange = (r) => r && touched.some((n) => n >= r[0] && n <= r[1])
  if (!inRange(notes) && !MARKER_REASON('no-notes').test(message)) {
    problems.push('Patch Notes were not updated. Add a line to the newest entry in #changelog-list (index.html), or put [no-notes: <why>] in the commit message if players won\'t notice this change.')
  }
  problems.push(...linkProblems({ srcDiff, i18nDiff, message, read, srcText }))
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
    srcDiff: git('diff', '--cached', '-U0', '--', 'src', ':!src/game/i18n.js', ':!src/game/i18n'),
    i18nDiff: git('diff', '--cached', '-U0', '--', 'src/game/i18n.js', 'src/game/i18n'),
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
    srcDiff: git('diff', '-U0', range, '--', 'src', ':!src/game/i18n.js', ':!src/game/i18n'),
    i18nDiff: git('diff', '-U0', range, '--', 'src/game/i18n.js', 'src/game/i18n'),
    read: (f) => { try { return git('show', `${head}:${f}`) } catch { return '' } },
    srcText: workingSrcText(),
  })
}

const [mode, arg] = process.argv.slice(2)
const keyProblems = await typedKeys()
const problems = mode === '--commit-msg' ? fromCommitMsg(arg)
  : mode === '--range' ? fromRange(arg)
  : mode === '--page' ? check({ files: ['index.html'], indexDiff: '@@ -1 +1 @@', indexContent: readFileSync('index.html', 'utf8'), message: '[no-notes: page check only]', read: (f) => readFileSync(f, 'utf8'), srcText: workingSrcText() })
  : null
if (problems !== null) problems.push(...keyProblems)
if (problems === null) {
  console.error('usage: check-docs.mjs --commit-msg <file> | --range <base>..<head> | --page')
  process.exit(2)
}
if (problems.length) {
  console.error('\nPlayer-text check failed (Patch Notes / in-game text):\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('')
  process.exit(1)
}
