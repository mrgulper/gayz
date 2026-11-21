// Guard against hover flicker (2026-11-20): when hovering something makes
// it slide or shrink, a mouse resting near its edge ends up outside it,
// the hover ends, it slides back under the mouse, the hover starts
// again... and it flickers. Growing (scale above 1) is fine, because the
// thing still covers where the mouse is. This fails `npm run lint` if a
// hover style slides (translate / top / left / margin) or shrinks
// (scale below 1) the hovered thing itself, or plays an animation that
// does. Move a child instead (see the emote wheel's .emote-look), or grow.
// A rule can opt out with a `hover-move-ok` comment inside it.
import fs from 'node:fs'
import path from 'node:path'

const files = []
;(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.css')) files.push(p)
  }
})('src')

const shrinks = (value) => [...value.matchAll(/scale[XY]?\(\s*([\d.]+)|(?:^|[\s;])scale\s*:\s*([\d.]+)/g)].some((m) => parseFloat(m[1] ?? m[2]) < 1)
const slides = (body) => /(^|[;\s{])(top|left|right|bottom|margin[a-z-]*|translate)\s*:/.test(body) || /transform\s*:[^;]*translate/.test(body)

const problems = []
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8')
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes('hover-move-ok') ? '/*hover-move-ok*/' : c.replace(/[^\n]/g, ' ')))
  // Keyframes that slide or shrink.
  const badFrames = new Set()
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    if (shrinks(m[2]) || /translate/.test(m[2])) badFrames.add(m[1])
  }
  for (const m of css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].trim()
    const body = m[2]
    if (body.includes('hover-move-ok')) continue
    // Only the hovered element itself (`a:hover`, not `a:hover .child`).
    const hovered = selectors.split(',').filter((s) => /(:hover|\.nav-hover|\.is-hot)(\)|:not\([^)]*\)|::?[\w-]+)?\s*$/.test(s.trim()) && !/:active/.test(s))
    if (!hovered.length) continue
    const anims = [...body.matchAll(/animation(?:-name)?\s*:([^;]*)/g)].flatMap((a) => a[1].match(/[\w-]+/g) || [])
    const why = slides(body) ? 'slides' : shrinks(body) ? 'shrinks' : anims.find((a) => badFrames.has(a)) ? `plays "${anims.find((a) => badFrames.has(a))}" which slides/shrinks` : ''
    if (!why) continue
    const line = css.slice(0, m.index + m[0].indexOf(m[1].trim())).split('\n').length
    problems.push(`${file}:${line}  ${hovered[0].trim()} ${why} on hover`)
  }
}
if (problems.length) {
  console.error('Hover flicker risk - hovering moves the thing away from the mouse:\n  ' + problems.join('\n  ') + '\nGrow it (scale >= 1) or move a child instead. See scripts/check-hover-moves.mjs.')
  process.exit(1)
}
console.log(`check-hover-moves: ${files.length} CSS files OK`)
