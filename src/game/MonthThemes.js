// Picture themes (2026-11-11, Gaymi: "make it automaticly switch monthly
// the number=month"). Twelve looks, one per month, each with Gaymi's own
// picture behind the homepage, fixed colours that match it and its own
// letters on every text - the same recipe as Sakura Dream (2026-11-07),
// which is April's entry here. Settings > Theme > Monthly (uiTheme:
// 'monthly') shows the current month's look and changes by itself when
// the month does; Sakura Dream (uiTheme: 'sakura') is April's look all
// year. All built on Simple's styling (html.ui-theme-clean), so only
// colour, picture and font change, never size or place.
//
// Each look is a set of CSS variables put on <html>: Simple's --clean-*
// colours plus --pic-font/--pic-weight (the letters), --pic-line (box
// edges), --pic-glow (the picked card's glow) and --pic-text-glow (the
// soft halo that keeps words readable over the busy picture). index.html's
// first-paint script reads them back from PICTURE_VARS_KEY.

import { holidayDate } from './LiveConfig.js'

export const PICTURE_VARS_KEY = 'gayz-picture-themes'

// [id, i18n key, picture, preview, font, weight, dark?, colours]
// colours: page, ink, panel, surface, hover, card, line, glow
const T = (id, nameKey, image, preview, font, weight, c) => ({ id, nameKey, image, preview, font, weight, ...c })

export const MONTH_THEMES = [
  T('frostbound', 'monthTheme1', '/images/month-01-frostbound.webp', '/images/month-01-frostbound-preview.jpg', "'Cinzel', serif", 700,
    { page: '#1b1f4a', ink: [220, 236, 255], panel: 'rgb(30, 36, 84)', surface: 'rgb(40, 48, 104)', hover: 'rgb(56, 66, 132)', card: 'rgba(24, 30, 72, 0.88)', line: 'rgba(140, 200, 255, 0.4)', glow: '120, 200, 255', halo: 'rgba(10, 14, 40, 0.95)' }),
  T('sweetheart', 'monthTheme2', '/images/month-02-sweetheart.webp', '/images/month-02-sweetheart-preview.jpg', "'Fredoka', sans-serif", 600,
    { page: '#ffd6dc', ink: [140, 20, 48], panel: 'rgb(255, 238, 241)', surface: 'rgb(255, 224, 230)', hover: 'rgb(255, 200, 210)', card: 'rgba(255, 240, 243, 0.92)', line: 'rgba(220, 60, 100, 0.32)', glow: '232, 64, 110', halo: 'rgba(255, 242, 245, 0.95)' }),
  T('emerald', 'monthTheme3', '/images/month-03-emerald.webp', '/images/month-03-emerald-preview.jpg', "'Uncial Antiqua', serif", 400,
    { page: '#0f3a2a', ink: [222, 248, 214], panel: 'rgb(20, 72, 52)', surface: 'rgb(26, 86, 62)', hover: 'rgb(36, 108, 78)', card: 'rgba(14, 58, 42, 0.88)', line: 'rgba(120, 230, 150, 0.38)', glow: '80, 220, 130', halo: 'rgba(4, 24, 16, 0.95)' }),
  // April = Sakura Dream (same pinks as before, Gaymi's new picture).
  T('sakura', 'optUiThemeSakura', '/images/sakura-dream.webp', '/images/theme-preview-sakura.jpg', "'Luckiest Guy', 'Bebas Neue', sans-serif", 400,
    { page: '#ffd3e6', ink: [122, 36, 92], panel: 'rgb(255, 236, 244)', surface: 'rgb(255, 222, 236)', hover: 'rgb(253, 200, 224)', card: 'rgba(255, 242, 248, 0.92)', line: 'rgba(214, 92, 150, 0.32)', glow: '236, 112, 170', halo: 'rgba(255, 244, 250, 0.95)' }),
  T('garden', 'monthTheme5', '/images/month-05-garden.webp', '/images/month-05-garden-preview.jpg', "'Mystery Quest', serif", 400,
    { page: '#dff3d8', ink: [30, 80, 40], panel: 'rgb(240, 250, 236)', surface: 'rgb(226, 244, 218)', hover: 'rgb(204, 234, 194)', card: 'rgba(242, 251, 238, 0.92)', line: 'rgba(70, 150, 80, 0.35)', glow: '90, 180, 110', halo: 'rgba(246, 255, 242, 0.95)' }),
  T('azure', 'monthTheme6', '/images/month-06-azure.webp', '/images/month-06-azure-preview.jpg', "'Comfortaa', sans-serif", 700,
    { page: '#d4ecff', ink: [14, 62, 120], panel: 'rgb(236, 247, 255)', surface: 'rgb(220, 239, 255)', hover: 'rgb(192, 224, 252)', card: 'rgba(240, 249, 255, 0.92)', line: 'rgba(40, 130, 210, 0.35)', glow: '40, 150, 230', halo: 'rgba(244, 251, 255, 0.95)' }),
  T('tropical', 'monthTheme7', '/images/month-07-tropical.webp', '/images/month-07-tropical-preview.jpg', "'Lilita One', sans-serif", 400,
    { page: '#ffe7c2', ink: [0, 92, 96], panel: 'rgb(255, 246, 230)', surface: 'rgb(255, 236, 206)', hover: 'rgb(255, 220, 170)', card: 'rgba(255, 248, 234, 0.92)', line: 'rgba(0, 150, 150, 0.35)', glow: '255, 150, 60', halo: 'rgba(255, 250, 238, 0.95)' }),
  T('golden', 'monthTheme8', '/images/month-08-golden.webp', '/images/month-08-golden-preview.jpg', "'Marcellus SC', serif", 400,
    { page: '#fbe7a8', ink: [104, 58, 6], panel: 'rgb(255, 246, 214)', surface: 'rgb(253, 236, 180)', hover: 'rgb(248, 220, 140)', card: 'rgba(255, 248, 222, 0.92)', line: 'rgba(200, 150, 30, 0.4)', glow: '232, 180, 40', halo: 'rgba(255, 250, 228, 0.95)' }),
  T('autumn', 'monthTheme9', '/images/month-09-autumn.webp', '/images/month-09-autumn-preview.jpg', "'Fondamento', serif", 400,
    { page: '#3a1e0e', ink: [255, 226, 180], panel: 'rgb(72, 38, 18)', surface: 'rgb(88, 48, 22)', hover: 'rgb(112, 62, 28)', card: 'rgba(58, 30, 14, 0.88)', line: 'rgba(255, 150, 60, 0.4)', glow: '255, 140, 40', halo: 'rgba(30, 14, 4, 0.95)' }),
  T('bloodmoon', 'monthTheme10', '/images/month-10-bloodmoon.webp', '/images/month-10-bloodmoon-preview.jpg', "'Creepster', cursive", 400,
    { page: '#1e0507', ink: [255, 214, 200], panel: 'rgb(48, 10, 12)', surface: 'rgb(64, 14, 16)', hover: 'rgb(92, 20, 22)', card: 'rgba(36, 6, 8, 0.9)', line: 'rgba(230, 40, 40, 0.45)', glow: '230, 40, 40', halo: 'rgba(14, 0, 2, 0.95)' }),
  T('amberfrost', 'monthTheme11', '/images/month-11-amberfrost.webp', '/images/month-11-amberfrost-preview.jpg', "'Yeseva One', serif", 400,
    { page: '#2b2622', ink: [255, 228, 190], panel: 'rgb(52, 46, 40)', surface: 'rgb(64, 56, 48)', hover: 'rgb(84, 72, 60)', card: 'rgba(40, 35, 30, 0.88)', line: 'rgba(240, 170, 80, 0.4)', glow: '240, 170, 80', halo: 'rgba(16, 12, 8, 0.95)' }),
  T('wonderland', 'monthTheme12', '/images/month-12-wonderland.webp', '/images/month-12-wonderland-preview.jpg', "'Mountains of Christmas', serif", 700,
    { page: '#eef4fb', ink: [150, 20, 30], panel: 'rgb(250, 252, 255)', surface: 'rgb(236, 242, 250)', hover: 'rgb(218, 228, 242)', card: 'rgba(250, 252, 255, 0.92)', line: 'rgba(190, 40, 50, 0.32)', glow: '200, 40, 50', halo: 'rgba(255, 255, 255, 0.95)' }),
]

export const SAKURA_INDEX = 3

// 0 = January ... 11 = December, on the player's own clock (or inside the
// Console's Holiday switch's season while it's on, LiveConfig.js).
export function monthIndex(date = holidayDate()) {
  return date.getMonth()
}

// The look a theme setting shows right now, or null for Old/Simple.
export function pictureThemeFor(theme, date = holidayDate()) {
  if (theme === 'sakura') return MONTH_THEMES[SAKURA_INDEX]
  if (theme === 'monthly') return MONTH_THEMES[monthIndex(date)]
  return null
}

// The CSS variables one look puts on <html> (all but --clean-check, which
// CleanTheme.js adds since it needs Simple's colour maths).
export function pictureVars(p) {
  const ink = p.ink.join(', ')
  return {
    '--clean-bg': p.page,
    '--clean-fg': `rgb(${ink})`,
    '--clean-fg-rgb': ink,
    '--clean-panel': p.panel,
    '--clean-surface': p.surface,
    '--clean-hover': p.hover,
    '--clean-page': p.page,
    '--clean-card': p.card,
    '--clean-card-fg': `rgb(${ink})`,
    '--clean-bg-image': `url("${p.image}")`,
    '--pic-font': p.font,
    '--pic-weight': String(p.weight),
    '--pic-line': p.line,
    '--pic-glow': p.glow,
    '--pic-text-glow': p.halo,
  }
}
