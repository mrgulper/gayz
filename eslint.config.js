import js from '@eslint/js'
import globals from 'globals'

// Deliberately narrow to the colorful-pictograph emoji blocks (emoticons,
// symbols & pictographs, transport, supplemental symbols) - the actual
// thing CLAUDE.md's convention bans (its own example: a badge using '🩸').
// General BMP symbol blocks (arrows, dingbats, misc symbols) are excluded
// on purpose: this codebase already uses plain monochrome glyphs like
// star/checkmark/arrows for real UI (prestige badges, list-reorder
// buttons, completion marks) that read as text, not emoji, and aren't
// what the convention is about.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}]/u

// Enforces this project's existing "no-emoji UI" convention (documented in
// CLAUDE.md's menu-redesign notes: emoji were tried for achievement badges
// and reverted in favor of plain colored swatches) - previously prose-only,
// now a real lint check instead of relying on remembering to grep for it.
const noEmojiUi = {
  rules: {
    'no-emoji': {
      meta: { type: 'problem', messages: { emoji: 'Emoji are not used in this project\'s UI - use plain text/swatches/icons instead (see CLAUDE.md).' } },
      create(context) {
        function check(node, raw) {
          if (EMOJI_RE.test(raw)) context.report({ node, messageId: 'emoji' })
        }
        return {
          Literal(node) {
            if (typeof node.value === 'string') check(node, node.value)
          },
          TemplateElement(node) {
            check(node, node.value.raw)
          },
        }
      },
    },
  },
}

export default [
  js.configs.recommended,
  {
    // index.html is deliberately excluded - it isn't JavaScript, so linting
    // it with a JS parser would just produce syntax-error noise, not a real
    // emoji check. This covers the actual UI-facing source (src/**/*.js,
    // including i18n.js).
    files: ['src/**/*.js'],
    plugins: { local: noEmojiUi },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Vite `define()` build-time constants (see vite.config.js) - real
        // globals at runtime, not undeclared variables.
        __BUILD_HASH__: 'readonly',
        __BUILD_DATE__: 'readonly',
      },
    },
    rules: {
      'local/no-emoji': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'],
  },
]
