// Silly tips (2026-10-31, Gaymi: "make gayz more funny based"): one on the
// pause menu each time it opens, and one in the middle of the screen a
// few seconds into a game. Family-friendly on purpose.
//
// i18n: sillyTip1..N, each a whole line starting "Tip:".
import { t } from './i18n.js'

export const SILLY_TIP_COUNT = 16

export function sillyTip() {
  return t(`sillyTip${1 + Math.floor(Math.random() * SILLY_TIP_COUNT)}`)
}
