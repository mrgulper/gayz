# Visual Identity Redesign: Neon Decay + Found Footage

## Context

GayZ has accumulated a lot of gameplay systems (perks, trader, companion, screamer, vehicle, tunnel, infection, day/night...) but no strong visual identity — it currently reads as a fairly generic realistic-ish city block. This is phase 1 of a broader "make the game more creative/unique" effort; two more phases (a narrative/mystery layer, and a core-loop twist) are planned separately and are explicitly out of scope here.

The chosen direction, picked from mockups: **Neon Decay** (the world's own art direction — a magenta/cyan-lit decayed city at night) shot through a **Found Footage** camera treatment (grain, scanlines, vignette, REC indicator + timestamp, subtle handheld wobble). Always-on, replacing the current look entirely (not a toggle).

## Scope

Two independent pieces:

### 1. World reskin (real 3D changes)
- `DayNightCycle.js`: shift the NIGHT lighting preset's fog/background/hemisphere/sun colors toward magenta-purple tones instead of the current blue-gray. DAY preset can stay closer to as-is, or shift subtly — night is when the game is mostly played and where the identity matters most.
- `World.js`: add a handful of neon sign/light fixtures (magenta + cyan emissive planes/point lights) scattered along the avenue and on building faces, reusing the existing `flickerLights` pattern where it makes sense.
- `Zombie.js`: retint skin/clothes tones slightly sicklier/cooler to read well under magenta/cyan lighting.
- `style.css`: shift HUD accent colors (currently green-based: `#b6e6a1` etc.) toward the cyan/magenta palette. Must re-check this against the existing colorblind-mode palette (`Accessibility.js`/`Zombie.js` health bar colors) so the two don't clash or reintroduce a hard-to-distinguish pair - colorblind mode's blue/orange bars already avoid red/green and read fine against a purple/cyan backdrop, so no color logic changes expected, just a visual pass to confirm.

### 2. Found-footage camera overlay (screen-space, not 3D)
New DOM overlay sitting on top of the `<canvas>` (same layer approach as `#damage-flash`), doing:
- Scanline pattern (repeating CSS gradient)
- Animated grain (a small tiled noise texture, animated position, low opacity)
- Vignette (radial box-shadow, matches the mockup)
- REC indicator + live timestamp (counts up from run start, reusing the existing run-timer value already computed for the death-screen stats)
- Subtle procedural camera wobble: a tiny sinusoidal offset applied to the camera's rotation each frame (separate from mouse-look), small enough not to interfere with aiming

This is intentionally a CSS/DOM effect rather than a WebGL post-processing shader pass — real camcorder grain/scanlines are screen-space artifacts in reality too, so this is both simpler to build and more "correct" than faking it as 3D geometry, with no added GPU/render-pipeline risk.

## Out of scope (this phase)
- Narrative/mystery content (separate future design)
- Core-loop changes (separate future design)
- A settings toggle to disable the effect (explicitly always-on per user decision)
- Redesigning non-HUD UI screens (menu/settings panel backgrounds) beyond accent-color updates — full menu art pass not included

## Testing
Since this is a visual/frontend change, verification happens by running the dev server and looking at it in a real browser (`/run` or manual `npm run dev`) — screenshots plus a short look at day/night transition, HUD legibility, and the found-footage overlay at normal gameplay speed. Automated build (`npm run build`) confirms no syntax errors but can't confirm the look is right.
