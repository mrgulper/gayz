# GayZ — 3D Asset Overhaul: Research + Implementation Plan (Handoff)

Written 2026-07-19. This is a **complete handoff**: the researcher is not continuing the work. Everything needed to execute is in this file — no outside context required.

**What this is:** a fully-researched, decision-ready plan to replace the game's ~75 procedural primitive-built models with real 3D assets, at **zero cost** (hard constraint: no new paid subscriptions — free tiers, open-source, CC0 libraries only).

**How it was researched:** two deep-research rounds (209 web agents; 50 claims put through 3-vote adversarial verification panels — a claim survives only if independent verifiers fail to refute it against primary sources) plus a full codebase inventory. Every factual claim below carries a confidence label:

- **(a)** = verified against multiple/primary sources, survived adversarial refutation
- **(b)** = single-source, not independently confirmed
- **(c)** = unverified/plausible — test before relying on it

All licensing evidence is vendor pages dated Mar–Jun 2026. **Re-verify licensing at ship time** — Meshy/Tripo terms change frequently.

---

## 0. TL;DR — the three decisions

| Decision | Call | Why |
|---|---|---|
| **Art style** | **Stylized low-poly** (flat-color / Kenney-compatible) | Only style the free ecosystem sustains across ~75 assets; matches the 13 Kenney building GLBs already shipped; light in browser. Realistic PBR is reachable per-asset but not consistently across 75 free generations, and would clash with everything kept. |
| **Character animation** | **Real skeletal animation — yes, free** | Solved without AI: CC0 rigged zombies (Quaternius) + CC0 retargetable animation library (zombie walk/attack confirmed) + Mixamo (Adobe license explicitly permits commercial games, verified (a)). Replaces the procedural sine-wave limbs. |
| **Pipeline** | **Hybrid, 3 lanes** | CC0 packs = characters/props/buildings backbone. Claude-scripted Blender = 13 weapon viewmodels. Free AI generation (TRELLIS.2 HF demo / Meshy free) = hero one-offs ONLY (rate-limited). |

**Hardware note (a):** the dev machine this was researched on has an AMD Radeon 840M iGPU (shared memory, no CUDA) — **all local AI 3D generation is off the table** on it. Every AI path below is hosted/free-tier. If you have a 24 GB+ NVIDIA card, TRELLIS.2 local becomes viable (see §2.2).

---

## 1. Current state — complete asset inventory (from codebase, 2026-07-19)

Almost every visual object is a `THREE.Group` of `BoxGeometry`/`CylinderGeometry`/`SphereGeometry`/etc. primitives with `MeshStandardMaterial`. The ONLY loaded model files are 13 `building-*.glb` (Kenney City Kit Commercial 2.1, CC0) in `public/models/buildings/`. Canvas-drawn `CanvasTexture`s handle signage/screens/decals; the only committed image texture is `ground-asphalt.png` (+ the GLBs' `colormap.png`).

**Scale reference (world units ≈ meters):** player eye height 1.7; humanoid NPCs ~1.6–1.8 tall; base zombie ~2.0 tall at `scale:1` (hips y=1.0, head ~1.95, healthbar 2.05). Zombie world height = 2.0 × type `scale`. Weapon viewmodels ~0.2–0.6 units at FPS-hand scale.

### 1.1 Characters (all procedural, all animated)

**Zombies — one shared builder, feature-flagged.** `Zombie.js` `_buildBody()` (~lines 186–520) + `_buildLimb()` (522–564). **All 16 types in `ZombieTypes.js` share this single builder** — they differ only by palette (`skinTones`/`clothesTones`), `scale`, and boolean flags that add/remove parts. They are separate-limb rigged figures (~50–70 primitives each), NOT blobs: hips group, jittered torso, spine ridges, cloth strips, wounds, ribs, full head (skull/cheeks/ears/hair/eye sockets/emissive eyes/hinged jaw/teeth/blood drips), hood, 2 arms + 2 legs each shoulder→upper→elbow(joint)→lower with claws/boots.

**Procedural animation** (`_animate()` ~956–1038): sine leg-swing, knee bend, arm sway + attack lunge, hip bob, body sway, head twitch, breathing scale, per-type gland pulsing. Plus: death (fall + sink), ambush pop-up (y-scale lerp), boss telegraph (shake + red eyes), hit-flash (white emissive), elite gold tint, night corruption tint. Crawler has a distinct arm-drag cycle.

**The 16 types collapse to 7 distinct silhouettes** — this is the key fact that makes the overhaul tractable:

| Silhouette | Flag | Extra geometry | Types using it | Scale / world height |
|---|---|---|---|---|
| Base humanoid | (none) | standard rig + hood/hair | shambler(1.0), runner(0.9), brute(1.55), colossus(2.4), sewer_dweller(0.95), screamer_swarmer(1.0) | ~1.8–4.8 |
| Crawler | `crawler` | hips lowered/rotated 0.95 rad, short legs, drag anim | crawler(0.82) | ~1.3 crawling |
| Ranged/belly | `ranged` | emissive green belly sphere (throbs) | spitter(1.0), spitter_bomber(1.05) | ~2.0 |
| Screamer | `screams` | emissive purple throat sphere | screamer(1.05), screamer_swarmer(1.0) | ~2.1 |
| Bloater | `explodes` | large emissive bloat sphere, no ribs | exploder(1.2) | ~2.4 |
| Patient Zero | `feedsOnLight` | purple vein sphere (emissive scales w/ enrage) | patient_zero(1.9) | ~3.8 |
| Titan | `dinosaur` | elongated flat skull, tiny arms, 5-segment tail, no hood/hair/ears | titan(3.4) | ~6.8 |

**Other characters:**
- **Companion** (`Companion.js` `_buildBody()` 176–230): blocky humanoid ~9 prims, 3 role variants (ranged/melee/medic via weapon prop + jacket color), optional vest/rig gear meshes. NO procedural walk — translate + turn only. ~1.6 tall. Canvas name-tag sprite.
- **Rival Scavenger** (`RivalScavenger.js` 39–82): dark hooded raider, black mask + 2 emissive red eyes, ~9 prims. No walk anim. ~1.63 tall.
- **Rescue Survivor** (`RescueSurvivor.js` 17–45): kneeling trapped NPC, 5 prims + pulsing amber signal sphere. ~0.85 tall kneeling.
- **Player Body** (`PlayerBody.js` 17–43): third-person-only, 6 prims, static (documented no walk cycle). ~1.6 tall.

### 1.2 Weapon viewmodels (`Viewmodels.js`) — 8 slots, 11 held models + shared hand rig

**Shared hand rig** — `buildHand()` (42–72): palm + wrist + knuckles + 4 two-segment curling fingers with nails + thumb, ~15 prims/hand, attached per-weapon via `attachHandToGrip`. Guns get 1–2 hands.

| Model | Builder / lines | In-game name | Notes |
|---|---|---|---|
| Pistol | `buildPistol` 111–136 | M1911 | skin-tintable slide |
| Glock 18 | `buildGlock18` 435–470 | Glock 18 | machine pistol, ext mag |
| Rifle | `buildRifle` 172–211 | AK-47 | wood stock, 2 hands |
| Shotgun | `buildShotgun` 474–516 | Weatie | pump cylinder |
| AWP | `buildAwp` 520–568 | AWP | emissive scope lens |
| Minigun | `buildMinigun(Model)` 374–431 | Minigun | rotating 6-barrel cluster (animated); bare model doubles as world pickup |
| UV Lamp | `buildUvLamp(Model)` 144–170 | UV Lamp | emissive UV lens (intensity 2.4); doubles as pickup |
| Knife | `buildQuickMeleeKnifeModel` 218–262 | Knife | also quick-melee off-hand |
| Bat | `buildBatModel` 264–284 | Bat | |
| Machete | `buildMacheteModel` 286–315 | Machete | |
| UV Baton | `buildUvBatonModel` 317–342 | UV Baton | emissive tip |

The 4 melee models are pre-built in one group by `buildMelee()` (346–370); one `visible` at a time via `setMeleeVariant`. **Cosmetic skins** (`SKIN_TINTS` 91–99: gold/crimson/cobalt/obsidian/ember) tint only the main body/slide material via `skinMaterial()` — **new models must keep one designated tintable material per weapon or the skin shop breaks.** Muzzle flash: `WeaponSystem.js` line ~189, cone + point light. Viewmodel bob/sway/recoil is driven by `WeaponSystem` on the group — swap geometry inside the group and the feel is preserved.

### 1.3 Pickups (~15, floating/rotating/emissive — `Pickups.js` `buildVisual()` 32–202)

Health pack (emissive cross), ammo crate, armor octahedron, battery, noisemaker, fuel can, grenade, scope, extended mag, audio log, vault key (+ beacon), melee pickup variants (lying-down bat/machete/UV baton), minigun/UV-lamp pickups (bare viewmodels ×1.6 + beacons). Plus XP gem (`XpGems.js`: cyan octahedron 0.14, spins/bobs, drops every kill).

### 1.4 World props (~22)

Supply chest w/ canvas-stenciled lid + LED latches (`Chests.js` 70–181), Vault safe w/ gold dial (194–256), explosive barrel (`World.js` 580–608, cloned emissive mat — see §7 gotchas), generator (612–647), trader stall (652–715), ammo refill station w/ canvas screen (721–782), safe-zone beacon (859–867), practice targets ×3 (894–938), trophy wall (946–989), barricade windows (`BarricadeWindows.js` 34–61: frame + 5 toggle-visibility planks), streetlights ×4 (2104–2133), park trees ×8 (498–520), benches ×2, debris clusters ×15, subway train car (1157–1168), subway kiosks (1193–1247, 1852–1868), lore terminals ×2 (1560–1590, 1811–1841), airdrop crate (`Game.js` 3961–3979), deployable barricade (1787–1809), trap disc (1816–1830), rubble (1870–1903), KOTH/extraction ring markers (818/835).

### 1.5 Structures

13 Kenney GLBs loaded once (`preloadBuildingModels` 1924–1937 → `_modelCache`), `.clone(true)` per instance, per-axis scaled + tinted (`MODEL_TINTS` ×4) via `addModelBuilding` (1950–1985). Procedural fallback building w/ canvas grime facade (2013–2075) only if a GLB fails. ~14 procedural structure types: enterable skyscrapers ×3, fire escapes + rooftops, elevated lookout rooms, stair flights (reused everywhere), sewer, subway platform, underground station (2 levels), subway connectors/junctions, VIREO facility corridor, perimeter barricade, safe-zone compound.

### 1.6 FX (keep procedural — do NOT convert)

Muzzle flash, spit/grenade/molotov/C4/EMP projectiles, explosion/shockwave spheres, fire zones, orbiting blades, homing shots, damage aura ring, chain lightning (`Game.js`/`AutoWeapons.js`), decals (`Decals.js`, canvas, capped 60), ivy/street markings/ground. Emissive primitives read perfectly as FX; meshes add nothing.

**Totals: ~75 distinct visual objects. High-value targets: 1 zombie rig (7 silhouettes), 11 weapon viewmodels + hand rig, 4–5 NPC bodies, ~15 props/pickups, buildings (swap-ready GLBs).**

---

## 2. Research findings — tool landscape with verdicts

### 2.1 CC0 / free asset libraries — the backbone ✅ SHIP

- **Quaternius Animated Zombie Pack** (a) — quaternius.com/packs/animatedzombie.html. CC0, explicitly free for commercial. Atlas-textured zombie, many animations. **FBX/OBJ/Blend only — no GLB on the page (verified: zero gltf/glb occurrences in page HTML)** → needs one Blender→GLB export step. One model, dates from 2018. A possible direct-GLB via its poly.pizza listing (poly.pizza/m/jkrEvQZb8J) couldn't be verified (fetch timeout) (c).
- **Quaternius Universal Animation Library 2** (a) — quaternius.itch.io/universal-animation-library-2. CC0, commercial OK, actively updated (v2.1 July 2026). Universal humanoid rig, retarget-ready (UE/Godot/Unity — works for any humanoid). **ZOMBIE_WALK_FWD and ZOMBIE_SCRATCH confirmed in the free tier** (verified from raw page HTML). $14.99 one-time unlocks .BLEND source — NOT needed for a GLB pipeline. ⚠️ Verifiers conflicted on whether free tier = full 130+ set or a 42-animation subset, and a free zombie DEATH clip was NOT confirmed — **download the free zip and inspect before committing** (the gap-filler is Mixamo's zombie death, §2.3).
- **Quaternius Ultimate Animated Character Pack** (b) — quaternius.com/packs/ultimatedanimatedcharacter.html. 52 animated characters, CC0, FBX/OBJ/Blend. Source pool for Companion/Rival/Survivor/PlayerBody.
- **KayKit Skeletons** (a) — kaylousberg.itch.io/kaykit-skeletons + GitHub mirror (KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) with an actual CC0 LICENSE.txt. 4 fully rigged/textured/animated undead (Warrior, Rogue, Mage, Minion), 90+ animations, **ships .GLTF directly — zero conversion**. 2 more ($7.95 one-time): Skeleton Golem, Necromancer. Skeletons, not zombies — aesthetic judgment call.
- **LOWPO: Undead** (b) — standout7.itch.io/lowpo-undead. Free tier: 3 rigged low-poly undead (Skeleton, Zombie, Ghoul); premium adds Wight/Plague/Wraith/Lich. Check its exact license on download.
- **Sketchfab "PolyArt zombies with animations" by Denys Almaral** (b) — 10 low-poly rigged zombies with 10 animations, "totally free" per listing. **Verify the specific Sketchfab license on download** (Sketchfab free ≠ always CC0).
- **Kenney** (already shipped, CC0) — extend with more Kenney city/prop packs for the 750×750 map expansion. kenney.nl.

### 2.2 Free AI 3D generators

- **Microsoft TRELLIS.2-4B** ✅ best free AI option (a, all from primary sources — HF model card, GitHub repo, HF Space code):
  - MIT license, model AND code, **no geographic exclusions**. Commercial use permitted. (Only deps nvdiffrast/nvdiffrec carry separate terms.)
  - Image-to-3D ONLY (pipeline class `Trellis2ImageTo3DPipeline`, no text-to-3D). 4B params.
  - Outputs GLB with PBR channels (Base Color, Roughness, Metallic, Opacity; OPAQUE mode default; demo embeds WebP textures) — directly Three.js-usable.
  - **Local requires 24 GB+ NVIDIA (tested A100/H100, Linux-only).** The circulating "community-optimized to 8 GB" claim was **REFUTED** — no official support; only third-party forks, unvetted. Speed figures (3 s @512³, 17 s @1024³, 60 s @1536³) are H100 numbers.
  - **Free hosted demo exists:** huggingface.co/spaces/microsoft/TRELLIS.2 on ZeroGPU — generation and GLB-extraction each get a 120 s GPU window per call; free-account daily ZeroGPU quota is the real limit. Fine for hero one-offs, not for 75 assets.
  - Output is a dense generative mesh → needs decimation/retopo (§4 Phase 7) and is unrigged (rig via Mixamo/AccuRig if a character).
- **Meshy free tier** ⚠️ usable with attribution (a — ToS §3.2 updated Mar 2026, help center Jun 2026, pricing page):
  - $0 plan: 100 credits/mo auto-reset; Text-to-3D, Image-to-3D, AI Texturing, AND auto-rig+animate all included ("every account includes 100 free credits each month to rig and animate").
  - **Free outputs are CC BY 4.0 — commercial shipping allowed WITH attribution.** Exact required line: “Model created with Meshy – CC BY 4.0 License” (put it in the game's credits screen). Paid users own outputs outright.
  - Real limits: ~10 model downloads/month, Meshy-5 models only (Meshy 6 paywalled), low queue priority, no top-ups. Assets shared to Meshy's community become CC0. ⚠️ Whether free downloads include GLB format went UNVERIFIED (1-2 vote) — test with one asset before planning around it. Free animation presets ~20 vs 600+ paid (b, Meshy blog).
- **Tripo free tier** ❌ DEAD END (a): FAQ verbatim: free-tier models canNOT be used in commercial games — learning/prototyping/portfolio only; ToS reserves commercial-exploitation rights over free outputs. (A "CC BY 4.0 public models" loophole appears on the pricing page but the binding ToS contradicts it — legally risky, don't build on it.) Its rigging tech is excellent (built on open-sourced **UniRig**, SIGGRAPH 2025, github.com/VAST-AI-Research/UniRig — accepts OBJ/FBX/GLB, exports rigged GLB) but that only matters on paid plans. Refuted along the way: "300 free credits/mo" (0-3), "AI skinning weights included" (0-3). UniRig itself is open-source and "may be a free local rigging alternative" per the research (c — local hardware requirements unverified; as an AI model it very likely wants an NVIDIA GPU).
- **Hunyuan3D-2.1 (Tencent)** ❌ not recommended for this project: genuinely strong PBR output (a — albedo/metallic/roughness, Disney BRDF, glTF export; the tech is real, verified against the arXiv paper + repo), BUT: 10 GB VRAM shape-only / 21 GB texture / **29 GB full pipeline** (a — README verbatim; beyond every mainstream consumer GPU except a 32 GB RTX 5090; a real RTX 4090 24 GB hang report exists). A **free hosted HF Space demo exists** (no VRAM needed) — the research's own synthesis allowed it for "occasional hero assets if the territory-license risk is accepted." License (b — 2-1 vote, medium confidence): Tencent Community License, commercial use of outputs permitted and "Tencent claims no rights in Outputs," BUT territory **excludes the EU, UK, and South Korea** + 1M MAU cap + non-compete. Whether *distributing generated outputs* (vs. the model) to EU/UK/KR players breaches the territory clause is **genuinely legally ambiguous and unresolved** — for a globally-served browser game that ambiguity is why this plan avoids it, not a proven prohibition. "Fully open-source, free local" framing was REFUTED 0-3. (Community low-VRAM builds exist — GGUF quants, Hunyuan3D-2GP, `--low_vram_mode` — with speed/quality/setup costs, same license.)
- **Anything World "Animate Anything"** ⚠️ backstop only (a, + one independent review): auto-rigs+animates uploads (browser/Blender/Maya/Unreal), live as of Jul 2026, but free tier ≈ 20 credits/mo ≈ ~3 rig jobs, and independent accuracy ~75–85% on simple gaits with stiffness/clipping on complex motion (b).
- **TripoSR / Stable Fast 3D**: 2026 status went unverified in both rounds (c). Both are older/lighter open models — likely below the quality bar TRELLIS.2 sets; not load-bearing for this plan.

### 2.3 Rigging & animation — free path ✅

- **Mixamo (Adobe)** (a): free with any Adobe ID, NO Creative Cloud subscription required (Adobe FAQ, 2-0). **License explicitly permits royalty-free use of characters AND animations in commercial projects including video games (3-0, Adobe's own FAQ)** — this covers shipping zombie walk/attack/death clips in this game. Caveats: humanoid-biped only; product is unmaintained (a June 2025 backend outage made the rounds; site was back per May 2026 report (b)) — **treat it as end-of-life: download and archive every clip you might ever want, immediately** (it has a famous zombie set: walk/attack/death/idle/scream).
- **Quaternius UAL2** (a) — see §2.1; primary animation source, CC0.
- **AccuRig 2.0 (Reallusion)** (c): free auto-rigging tool, surfaced via CGChannel but round-2 verification didn't complete. Worth 15 minutes of checking as a Mixamo alternative for auto-rigging custom meshes.
- **Meshy auto-rig** (a) — included in free 100 credits/mo; AI fallback for rigging one-off custom characters.
- **Three.js side**: `THREE.AnimationMixer` plays GLB clips natively; already available (three ^0.185.1 in package.json).

### 2.4 OpenArt (the unlimited image subscription) — images only

- **No mesh generation.** Its 3D-ish feature, "OpenArt Worlds," generates navigable 3D *environments* exported as **Gaussian splats** — not GLB meshes, not usable as game assets (a). (One unverified claim said splat/mesh export is still roadmap (c) — either way, not a mesh pipeline.)
- **Consistent-character feature** (a): create a character from a reference image/prompt/preset, reuse identity across generations. No promised multi-angle accuracy.
- A rumored **"Multi View" feature (9 camera angles from one image)** went UNVERIFIED (c) — verification agents died on a usage limit. **Test it directly in the OpenArt UI in 2 minutes** — if real, it's the ideal bridge: character sheet → clean angles → TRELLIS.2/Meshy image-to-3D.
- Pricing-page facts (a): "unlimited" generation exists only on the top **Wonder plan ($175.2/seat/month at 27% off)** and covers two named models (Seedream 5.0 Pro, Nano Banana 2 Lite); no Flux/SDXL named on the pricing page; a previously-cited hosted ComfyUI "Flux Consistent Character Sheet" workflow URL is dead (redirects home as of 2026-07-19). If the existing subscription is a lower tier, "unlimited" may not actually apply — worth checking which plan it is.
- **Role in this pipeline:** unlimited concept art, orthographic reference sheets for the weapons lane, texture/atlas source images, style-guide imagery. Nothing else.

### 2.5 Claude-scripted Blender (weapons lane) — unverified quality ceiling, test-first

- Blender is free, runs fine on CPU for modeling/scripting/export (no GPU needed for this).
- **blender-mcp** (ahujasid/blender-mcp) claims (c — verification killed by usage limit): LLM controls Blender live — create/modify objects, materials, scene inspection, arbitrary Python execution; bridges to Poly Haven/Sketchfab assets and external AI generators. Alternative that needs no MCP at all: **Claude Code writes a .py file, run `blender --background --python script.py`** — headless, scriptable, repeatable. This is the recommended mode (deterministic, version-controllable scripts, works in CI).
- No practitioner evidence surfaced either way on hard-surface quality of LLM-scripted modeling. Reason it's still the right lane for weapons: guns are boxes/cylinders/bevels/booleans — the *best case* for scripted geometry; the existing viewmodels were already "modeled in code," so this lane is an upgrade of the same idea with real bevels, better proportions (from OpenArt refs), and baked palette textures. **Phase 1 includes a quality gate before committing.**

### 2.6 Web optimization path (practitioner-grade knowledge; not adversarially verified — standard, low-risk)

- **gltf-transform** (CLI, free): `prune`, `dedup`, `weld`, `simplify` (meshoptimizer), `meshopt` compression, `ktx2`/BasisU texture compression. The one glTF toolchain needed.
- **meshopt vs Draco**: meshopt = much faster decode, compresses animation data too, needs `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`. Draco = better raw geometry ratio, slower decode, geometry-only. **Pick meshopt** (animated characters + many small files + fast load).
- **KTX2/BasisU**: GPU-compressed textures, Three.js `KTX2Loader` support is mature. Use for any texture ≥512px.
- **Budgets** (b, practitioner sources: <100 draw calls; 1k–5k tris mobile / 5k–30k desktop per asset): for this game — zombies 3–8k tris, weapons 2–6k (first-person closeups justify more), props 300–2k, buildings as-is (Kenney is already low-poly). Use `InstancedMesh`/shared geometry for repeated props (streetlights, trees, debris) — the 750×750 map expansion (WIP at HEAD) makes draw-call discipline load-bearing.

### 2.7 Refuted claims — do NOT build on these

| Refuted claim | Vote |
|---|---|
| "Hunyuan3D-2.1 is fully open-source, free to run locally" | 0-3 (license + VRAM wall) |
| "TRELLIS.2 community-optimized to 8 GB VRAM" (as an official/supported thing) | contradicted by primary sources |
| "Tripo free tier gives 300 credits/mo" | 0-3 |
| "Tripo auto-rig includes AI skinning weights" | 0-3 |
| "Meshy free tier downloads in GLB/FBX/OBJ/USDZ/STL/Blend" | 1-2 — unproven, test it |
| "OpenArt pricing lists no 3D capability at all" | 0-3 (Worlds exists — but exports splats, still not game-usable) |
| "OpenArt's AI Character page has no multi-view/turnaround capability" | 1-2 — weakly refuted; consistent with Multi View possibly existing, see §2.4 |
| "OpenArt consistent-character per-plan caps (Essential ~13 / Advanced ~40 / Infinite ~80 / Wonder ~353)" | 1-2 — treat caps as unknown |

(Note: the TRELLIS "8 GB" row above is not from the refuted lists — it's contradicted directly by the primary-source confirmed claims. Formal refuted-claim count across both rounds: 7.)

---

## 3. The pipeline — three lanes

```
LANE 1 · CHARACTERS (zombies, NPCs)
  Quaternius/KayKit CC0 rigged FBX/GLTF
    → Blender (Claude-scripted): variants (scale/palette/prop swaps per silhouette),
      retarget UAL2 + Mixamo clips, rename/merge animation clips
    → gltf-transform (meshopt + KTX2 + prune)
    → GLB → Zombie.js / Companion.js / etc. (THREE.AnimationMixer)

LANE 2 · WEAPONS (11 viewmodels + hands)
  OpenArt: orthographic side/top reference renders per gun (unlimited)
    → Claude writes Blender Python (headless): hard-surface modeling,
      bevels/booleans, bake flat-color palette texture, keep 1 tintable material
    → gltf-transform
    → GLB → Viewmodels.js (bob/sway/recoil code unchanged — swap group internals)

LANE 3 · HERO ONE-OFFS (titan boss, vault, set-pieces — sparingly)
  OpenArt: single clean concept render, neutral background
    → TRELLIS.2 free HF Space (MIT, PBR GLB out, daily quota)
      [or Meshy free credits, with CC BY credit line;
       Hunyuan3D-2.1 HF demo also exists but carries the §2.2 license ambiguity]
    → Blender decimate/cleanup → gltf-transform → GLB
```

**Props/pickups**: CC0 packs first (Kenney/Quaternius/Poly Pizza cover crates, barrels, furniture, street props), Lane 2 scripting for the bespoke ones (vault, trader stall, ammo station, trophy wall). **Buildings**: keep Kenney, add more Kenney packs for the 750-map. **FX**: keep procedural, don't touch.

---

## 4. Implementation plan (phased, each with acceptance check)

Standing project rules apply: every completed phase → commit → push → `npx vercel --prod --yes`. Verification = Playwright driving real game methods via `page.evaluate()` (no test suite exists; see CLAUDE.md quirks).

### Phase 0 — Archive & tooling (half a day; do the downloads NOW even if the rest waits)
1. Download and commit-to-a-private-archive (not the repo — large binaries): Quaternius Animated Zombie, UAL2 free zip, Ultimate Animated Character Pack, KayKit Skeletons, LOWPO Undead free tier. **Inspect UAL2 zip: settles the free-tier animation count + whether a zombie death clip exists.**
2. **Mixamo: create Adobe ID, download the full zombie set (walk/attack/death/idle/scream + hit reactions) as FBX (with skin + without), plus a T-pose character. Mixamo is unmaintained — archive before it disappears.** License permits commercial games (verified).
3. Install Blender (free): `winget install BlenderFoundation.Blender`. Install gltf-transform: `npm i -g @gltf-transform/cli`.
4. Check OpenArt for the "Multi View" feature (2 min). If real → it feeds Lane 3.
5. (Optional, 15 min) Check AccuRig 2.0 free status as a Mixamo-alternative auto-rigger.

**Acceptance:** all packs on disk; UAL2 contents documented; Mixamo zombie set archived.

### Phase 1 — One zombie end-to-end (the go/no-go proof, ~1 week)
1. Blender (Claude-scripted): import Quaternius zombie, retarget one Mixamo/UAL2 walk clip onto it, export GLB with named clips (`walk`, `attack`, `death`, `idle`).
2. Wire into `Zombie.js` behind a flag (e.g. `USE_GLB_ZOMBIES`): load via GLTFLoader (extend the `_modelCache` pattern from `World.js` `preloadBuildingModels`), **clone skinned meshes with `SkeletonUtils.clone()` — plain `.clone(true)` breaks skeleton bindings**, drive `AnimationMixer` from the existing state machine (walk/attack/death states already exist in `_animate()`).
3. Keep the shader-level effects working on the new mesh: hit-flash (white emissive), elite gold tint, night tint — traverse materials and **`.clone()` materials per instance** (recurring bug class, see §5).
4. Playwright: spawn both procedural and GLB zombie side by side, screenshot, verify kill/death/anim states via real methods.
5. **Go/no-go:** looks better + performs (no fps drop with 30 spawned) → commit the lane. Doesn't → stop, reassess with only days lost.

**Acceptance:** a GLB zombie walks, attacks, dies, hit-flashes, and tints in the real game, spawned via `ZombieManager`, ≥30 concurrent at 60 fps desktop.

### Phase 2 — All zombies (7 silhouettes, ~2–3 weeks)
- One base rigged zombie → Blender script generates the 7 silhouettes: scale factors from §1.1 table; crawler = re-posed variant (drop hips, retarget crawl clip — Mixamo has zombie crawl); belly/throat/bloat/vein emissive spheres = attach-to-bone props (keep them procedural spheres parented to spine/head bones — they're FX, they already work); titan = separate model (KayKit/LOWPO candidate or Lane 3 hero generation).
- 16 stat types keep working via palette tinting on cloned materials (same as today's `skinTones` idea, applied to texture tint or material color).
- Boss telegraphs, ambush pop-up, night tint: all whole-group transforms/material effects — carry over unchanged.
- `hittableMeshes` must list the new skinned meshes (WeaponSystem raycast; `userData.zombie` flags on hit targets — see CLAUDE.md "New hittable-object categories").

**Acceptance:** all 16 types spawn with correct silhouette/scale/tint; boss fights, ambush, crawler, spitter/screamer/bloater behaviors visually intact; Playwright sweep over each type.

### Phase 3 — NPCs (~1 week)
- Companion (3 role variants = gear/prop swaps + palette), Rival (dark palette + red emissive eyes as bone-parented props), Survivor (kneel pose from an idle-kneel clip), PlayerBody (any humanoid + walk clip — this *adds* the walk cycle the procedural body never had).
- Source: Quaternius Ultimate Animated Character Pack (52 to choose from) or KayKit.
- Companion/Rival currently have NO walk animation — adding real walk clips is a visible upgrade. Their movement code (translate + turn) doesn't change; the mixer just plays `walk` when velocity > 0.

**Acceptance:** companion follows/fights/downs, rival strafes/shoots, survivor rescue flow, third-person body — all in-game via Playwright + eyeball.

### Phase 4 — Weapons lane (~2–3 weeks, can run parallel to 2/3)
- Per gun: OpenArt ortho refs → Claude writes `blender --background --python make_ak47.py` → hard-surface mesh, flat-color palette texture (bake), **one designated tintable material** (preserves `SKIN_TINTS` shop skins), muzzle-flash anchor empty, grip empties where `attachHandToGrip` expects hands.
- Hands: model once (or take CC0 first-person arms), reuse across all guns — mirrors today's `buildHand()` sharing.
- Minigun barrel cluster must stay a separately-addressable spinning node; UV weapons keep their emissive lens materials.
- Swap inside each builder's returned group so `WeaponSystem` bob/sway/recoil/`currentIndex` logic is untouched.
- Quality gate after the first gun (pistol): if scripted-Blender quality disappoints after 2–3 iterations, fallback = Meshy free image-to-3D from the same OpenArt refs (CC BY credit line) at ~2 guns/month pace, or CC0 weapon packs (Kenney Blaster Kit is sci-fi; check Quaternius/OpenGameArt for ballistic-weapon packs).

**Acceptance:** all 11 held models replaced; skins tint; minigun spins; reload/recoil/ADS feel unchanged; pickup variants match.

### Phase 5 — Props & pickups (~1–2 weeks)
- CC0-pack pass first (Kenney city/props: barrels, crates, benches, streetlights, trees, debris, train car). Bespoke via Lane 2 scripts: chest (keep lid hinge + LED nodes), vault (door pivot + dial), trader stall, ammo station (keep canvas screen plane), trophy wall (medallion grid stays procedural-lit), kiosks, terminals (keep canvas CRT planes).
- Pickups: simple + emissive reads well — replace only where a pack item clearly beats the primitive (fuel can, grenade, audio log); keep beacons/rings procedural.
- Repeated props → `InstancedMesh` or shared cloned geometry (750-map draw-call discipline).

**Acceptance:** interactables still interact (chest opens, vault unlocks, trader/ammo prompts, barricade planks toggle); fps unchanged with full map.

### Phase 6 — Buildings & the 750×750 map (ties into the WIP at HEAD)
- HEAD commit (`666b83e`) is mid-expansion: ground 750×750 but `buildingLayout()` still covers ~80×80, no culling. New-asset work should land **with or after** the distance-culling system that commit's message calls for — more GLBs without culling compounds the perf debt.
- Extend the Kenney set (more City Kit packs, suburban/industrial/commercial kits — all CC0) for new zones; reuse `addModelBuilding`'s cache/clone/tint pipeline as-is.
- Interiors/tunnels stay procedural (they're layout, not models).

**Acceptance:** new zones populated; 60 fps desktop with culling on; build size delta measured.

### Phase 7 — Optimization pass (a few days)
- `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress ktx2` across `public/models/`; wire `MeshoptDecoder` + `KTX2Loader` into the loaders (one-time change next to the existing GLTFLoader in World.js).
- Budget audit: total models payload target < ~15 MB compressed; per-asset tri budgets §2.6; draw-call count via `renderer.info` in a Playwright check.
- Keep the Vite build baseline documented (was: 1,019 kB JS / 268 kB gz, 57 modules — pre-overhaul).

**Acceptance:** load time comparable to pre-overhaul (±2 s on cold load), 60 fps in the busiest scripted scenario (horde night + boss + effects).

---

## 5. Codebase gotchas that WILL bite this work (from project CLAUDE.md + inventory)

1. **Shared-material mutation** — the #1 recurring bug class. Any flash/tint/recolor effect needs `.clone()`d materials per instance. GLB loading makes this worse: GLTFLoader shares materials across clones by default. Traverse + clone on every instance spawn.
2. **`SkeletonUtils.clone()` for skinned meshes** — `three/examples/jsm/utils/SkeletonUtils.js`. Plain `.clone(true)` silently breaks bone bindings on skinned characters.
3. **Rotated-mesh AABB inflation** — colliders for new props must be explicit axis-aligned boxes from known dims, never `Box3.setFromObject()` on rotated meshes.
4. **`WeaponSystem.current` is a getter off `currentIndex`** — assigning `weapons.current = X` is a silent no-op.
5. **Safe-zone offsets** — anything placed in the safe zone positions relative to `SAFE_ZONE_X/Z` (World.js module constants), never absolute coords.
6. **`buildingLayout()` is deterministic** — new building placement must respect `EXCLUDED_BUILDING_IDXS` and can be root-caused arithmetically.
7. **Hittables** — `WeaponSystem._fire()` raycasts against `hittableMeshes` and checks `userData.<flag>`. New character meshes must populate both or they're unshootable. Test stubs need `hittableMeshes: []`.
8. **Playwright quirks** — no real Pointer Lock headless (set `gameStarted` directly); `THREE` not global in bundle (clone existing vectors); repositioned meshes need `updateWorldMatrix(true, false)` before raycasts; timing-sensitive assertions inside ONE `evaluate()`; `window.__game` is the entry point (`waitForFunction`).
9. **i18n** — new UI strings go in the English block of `src/game/i18n.js` only (other languages intentionally not synced).
10. **Attribution bookkeeping** — follow the `public/models/buildings/CREDITS.txt` precedent: every new pack gets a CREDITS entry (CC0 needs none legally, but keep provenance); any Meshy asset requires the visible CC BY line in an in-game credits screen.

---

## 6. Open questions the next dev should close (cheap tests, in order)

1. **UAL2 free zip contents** — full 130+ set or 42 subset? Zombie death clip present? (Phase 0.1 settles it; Mixamo covers any gap.)
2. **OpenArt "Multi View"** — real or not? (2-minute UI check; only affects Lane 3 convenience.)
3. **Meshy free download formats** — GLB included? (One test asset; only matters if Lane 2 fallback triggers.)
4. **Quaternius zombie via poly.pizza** — direct GLB download? (Would skip one Blender step.)
5. **Claude-scripted Blender quality on the pistol** — the Phase 4 quality gate; the only genuinely unproven lane in the plan.
6. **AccuRig 2.0** — free auto-rig status (only matters for custom/AI-generated characters).

---

## 7. Source register (primary sources verified against, July 2026)

- Quaternius: quaternius.com/packs/animatedzombie.html · quaternius.itch.io/universal-animation-library-2 · quaternius.com/packs/ultimatedanimatedcharacter.html
- KayKit: kaylousberg.itch.io/kaykit-skeletons · github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0
- Mixamo license: helpx.adobe.com/creative-cloud/faq/mixamo-faq.html
- TRELLIS.2: huggingface.co/microsoft/TRELLIS.2-4B · github.com/microsoft/TRELLIS.2 · huggingface.co/spaces/microsoft/TRELLIS.2
- Meshy: meshy.ai/pricing · meshy.ai/terms-of-use (§3.2) · help.meshy.ai articles 9992001, 10137554 · meshy.ai/features/ai-animation-generator
- Tripo: tripo3d.ai/game-development/3d-assets-license-game-development · tripo3d.ai/features/ai-auto-rigging · github.com/VAST-AI-Research/UniRig
- Hunyuan3D-2.1: github.com/tencent-hunyuan/hunyuan3d-2.1 (README + LICENSE) · arxiv.org/pdf/2506.15442
- Anything World: everythinguniver.se/animate-anything
- OpenArt: openart.ai/features/ai-character · openart.ai/feature/openart-worlds · openart.ai/pricing
- Optimization: gltf-transform.dev · utsubo.com/blog/threejs-best-practices-100-tips (budgets, (b))
- Free packs (secondary): standout7.itch.io/lowpo-undead · sketchfab.com "PolyArt zombies" (Denys Almaral) · kenney.nl · poly.pizza

---

*Research method: 2 rounds of fan-out web search → source fetch → claim extraction → 3-vote adversarial verification (refute-oriented), 209 agents total, 50 claims verified, 7 refuted, 13 verification votes across 5 claims lost to a usage limit (those claims are marked (c) above). Codebase inventory from direct source reading, same date.*
