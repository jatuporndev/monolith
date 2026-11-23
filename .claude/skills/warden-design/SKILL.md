---
name: warden-design
description: Design, build, improve or test a boss ("warden") in MONOLITH. Use when adding a new warden or chapter boss, when a boss fight feels repetitive / like a loop / not exciting, when changing how a boss is mounted, climbed, struck or defeated, or when bot-testing a boss fight in Chrome. Covers the design rules (every warden unique, no copying Shadow of the Colossus), the code contract a boss must satisfy, arena/effigy/interlude wiring, climb-geometry pitfalls, and the scripted test harness.
---

# Warden design for MONOLITH

A warden fight is a **puzzle you solve on a moving creature**, not a health bar. The player should
discover *how to get on*, then fight its body as a place that changes under them. If a fight can be
described as "do X, then repeat X", it is not finished.

## 1. Hard rules

1. **Every warden is unique.** No two may share their way-in, their weak-point layout, or their main
   defence. Before designing, list the existing wardens (`WARDENS` in `src/game/chapters.js`) and
   their mechanics (table in §6) and make sure the new one differs on all three axes.
2. **Do not recreate a Shadow of the Colossus colossus.** Learn its *principles* (`references/sotc-principles.md`),
   never its specific creature + mechanic pairings. That file lists the pairings that are off-limits.
   (The Strider's old "lure its charge into a stone → it kneels" was too close to SotC's bulls and was
   replaced by the stealth mount + steering below.)
3. **Proper nouns stay English** (warden names, chapter titles, Echo). Every new spoken line gets a
   Thai entry in `src/core/i18n.js`.
4. **Finish with a fair playtest (user rule, 2026-11-21).** After any warden work, play the whole fight
   start to finish as a player would before calling it done — see §8. No cheating, and don't tune it easier
   just so the test passes.
5. Don't break the gameplay random stream: in `world.js` never add or reorder `this.rnd()` calls; use
   `this.drnd` or a fresh `mulberry32(seed)` for anything new.

## 2. Design checklist (answer all before writing code)

- **Way in** — what must the player figure out to get a hold? It should use the arena, the warden's
  own force, or a trick (bait, hide, steer). Walking up and grabbing fur is only acceptable for the first warden.
- **Body as a level** — where are the rest spots, the dangerous stretches, the gaps that need a leap?
- **Marks** — how many, and **what each break causes**: a new phase, a mark revealed elsewhere,
  the warden changing posture so a new route opens, the rider thrown, the arena changing. A break that
  only lowers a counter is a bug in the design.
- **Escalation** — each phase changes what the player must *do* (a new verb), not just speed/damage.
- **Readable threats** — every attack has a telegraph (pose + sound ≥ 0.8 s) and a counter.
- **Set pieces** — at least one moment that happens once: something collapses, it leaves the arena,
  a stone topples, it dives/leaps.
- **Feedback** — stab reaction grows per hit (set `flinch`/`flinchAmt` in `strike()`: 0.25 → 0.7, break
  gets slow-mo in game.js). Music is automatic: `game.updateMusic` picks `encounter`/`ride` and raises
  intensity near any mark that is not `destroyed` or `sealed`.
- **Fairness** — player has a place to recover on the ground and on the body; a fall from a throw or
  tumble lands soft (`player.tumble` / `player.thrown` scale fall height by 0.7).

## 3. Code contract (what game/player/camera expect)

Template: `src/game/strider.js` (newest, cleanest). Shared parts: `src/game/bossKit.js`
(`furUniforms`, `strandMaterial` — needs a unique `seed`/cache key per boss, `furPatch`, `FurLag`,
`makeSigil`, `BossFx`).

Required members: `root`, `climbables[]`, `weakPoints[]` (`{id, hits, destroyed, mesh, mat, light, flash}`),
`state`, `alive`, `awakened`, `home`, `shakeIntensity`, `yaw` (used for throw direction).
Required methods: `update(dt, t, player, active)`, `reset(mode)`, `setDefeated()` (silent — no events,
no sounds), `poseDormant(t)`, `weakPointNear(p, r)`, `strike(wp, power)`, `pushOut(p, r)`,
`focusPoint(out)`. Optional: `standPose()` (pose for its effigy), `throwOnSigil = true`.

Events (bus): `colossus:awaken`, `colossus:struck`, `colossus:sigilBroken {id, remaining}`,
`colossus:dying`, `colossus:defeated`, `colossus:footfall`, `colossus:shakeWarn`, `colossus:shake`,
`colossus:stompWindup`, plus boss-specific ones (e.g. `strider:stunned`).
States the game reads: `'shaking'` (release = thrown), `'dying'`, `'dead'`.

## 4. Wiring a new warden

1. `chapters.js`: add a `CHAPTERS` entry (`boss: '<id>'`, spawn on the plaza, `art`, `intro`, `lore`)
   and a `WARDENS` entry (`effigy {x,z,yaw,scale,plinth}`, `lines {awaken, sigil{<wpId>}, victory, hint?[2]}`).
2. `game.js`: construct it and add to `this.bosses`; carve its effigy (call a standing pose first).
   Everything else (active boss per chapter, earlier wardens loaded as fallen, effigy states, motes,
   sleep → wake → crumble interlude, credits after the last) is already generic.
3. `world.js`: build the arena (flatten in `terrainHeight`, exclude from `vegetationSpot` and the bush/rock
   loop via an `inX()` helper), expose `world.arenaN`, keep a clear walking lane wherever rubble is solid.
4. `audio.js`: give it its own voice (call, effort/snort, footfall) — never reuse the Warden's groan.
5. `i18n.js`: Thai for every line. README + CHECKLIST: add a section.

## 5. Climb-geometry pitfalls (all hit before)

- A move between patches only succeeds if the next patch is within ~0.6–0.75 m of the step point
  (`bestClimbStep`). Height steps ≥ 0.7 m between top patches strand the player — add a sloped bridge patch.
- Top patches (`normal.y > 0.7`, non-static) allow standing without grip. Letting go there tumbles the
  player over the side; stepping off only counts at the true rim (not at a hole around a sigil).
- Fur patches are narrower than the stone body: give the body a solid hull in `pushOut` (local-space box,
  push through the nearer flank) or falling players pass through it.
- Big rubble needs colliders; tilted `block()`s get none automatically — add a shrunk upright one.
- Things that only stun when "hit" must require real approach (distance run + heading into the target),
  or they re-trigger instantly on the next frame.

## 6. Existing wardens

| Warden | Chapter | Way in | Marks | Defence / twist |
|---|---|---|---|---|
| Warden (`colossus.js`) | III (id 2) | shin coat in reach can be grabbed any time, but a swinging leg flings the climber (per-patch `climb.sway` → counts as shaking); bait a stamp and the stuck foot (3.2 s) is the still moment — jump the shockwave, take the leg | back, then crown (sealed until back breaks) | stomps, swipes, shakes; back mark → walks to the basin wall and grinds the rider off its back (shoulders safe) → wall falls |
| Strider (`strider.js`) | IV (id 3) | unseen, while it kneels to drink at the pool → breast mane (stones block its sight; it lifts its head twice to look back — freeze) | nape, then croup under a plate | charge/trample, kick, toss; ridden it bolts — steer from the front of the neck into stones, 2 aimed rams split the plate; nape → rider thrown, enraged double charges, winded after 3 → remount |

Marks can be `sealed` (not struck, dark, skipped by music). Boss-specific events used for Echo lines:
`strider:spotted|mounted|plateCracked|armourBroken|winded`, `warden:sealed|rub|wallDown` (lines in
`WARDENS[].lines.events`). Steering hook: player calls `boss.reins(att, mv)` while climbing.

Shared fight framing (game.js, generic for any warden): first-sight camera sequence on `colossus:awaken`
(uses `boss.head`), wide collapse shot on `colossus:dying` (uses `focusPoint`, slow-mo when `boss.fallen`
turns true), aftermath with a "Rest" interactable by the body, grit shed from struck/broken marks.
Tops: the player walks upright on any top face (normal.y > 0.7) without grip; a shake or a steep tilt makes them stagger and slide until they grip. Make the places to stand broad and unbroken.
Look: skins use `hideTexture('weathered')`, muted palettes — old stone, not coloured scales.

## 7. Testing with the bot (Chrome, dev server on http://127.0.0.1:5199)

Scripts in `scripts/` (paste into the page, or store in `localStorage` under the same key and `(0,eval)(localStorage.key)`):

- `dbgsrc.js` — installs `window.bot`. **It replaces `game.tick`: after loading it, the game advances only
  through `bot.frame(render)`** (real-time waits such as the interlude still run on timers, so pump
  frames with `setInterval(() => bot.frame(true), 33)` while waiting). `bot.hold(code)` / `bot.up(code)`
  take key *codes*: use `game.input.settings.get('bindings')[action]` (e.g. grip → `Mouse0`).
  Press edges are generated by `bot.frame`, so don't write `input.keys` directly.
  `bot.on()/bot.L()/bot.info()` are Warden-specific (patch names, colossus-local coords).
- `dbgfight.js` — OUTDATED (written for the old stun mechanic). For the reworked Strider, script it
  directly: park the player > 48 m away until `strider.state === 'drink'`, place them 1 m in front of
  `chestFur` (local (0,-2.4,1)) and hold grip; set `player.att` onto `neckFur` local z ≈ 1.6 and hold
  left/right to steer. Keep `game.input.mode === 'game'` (a death opens the UI and blocks input).
- `dbgai.js` — Warden climbing bot (`bot.ai()` per frame).
- `fairwarden.js` / `fairstrider.js` — input-only player bots for §8 (`await play(sec)` / `await splay(sec)`).
  They run the game synchronously, so start them inside a `setTimeout` and poll a window variable.
- `dbgclimb.js` — visual checks only: `grabPatch(i)` attaches to climbable i, `sideShots(name, frames)` snaps the climber.
- Bodies are sculpted with `src/game/sculpt.js` (`new Sculpt(root)`, `.ell/.cone/.box(bone, …)`, `.build()`):
  primitives are bound to rig groups and become one SkinnedMesh. Anything that clones a boss (effigies) must
  turn the skin into a plain Mesh, or the clone follows the live bones.
- Fur must grow from the body: `sculptBody` adds a box primitive under every climbable patch and hides the patch
  box (it stays as the climbing surface). Call `sculptBody` after all patches exist.
- Boss sounds go through `this.snd(name, opts)` (positioned). Giant-scale effects need a layer around 100 Hz–2 kHz,
  not only sub-bass, or they vanish on small speakers. Design notes and sheets: `docs/creatures/`.
- `dbgshot.js` — `snap(name)` posts the canvas to a local receiver; `view(px,py,pz,lx,ly,lz)` sets a cinematic camera.
  CDP screenshots time out on the game tab, so start the receiver
  (`scripts/shotsrv.py <outDir>`, listens on 127.0.0.1:5301) and read the JPEGs.

Shortcuts: `?play=N` starts chapter N directly (dev only). Expose `window.__game`.
Typical checks for a warden: wakes in its arena only; way-in works and can't trigger itself; can climb
from way-in to every mark; each mark's consequence fires; death → `colossus:defeated` → interlude → next
chapter (or credits); `?play=<next>` loads it already fallen with the effigy as rubble. Then
`npx vite build` and `npx vitest run`. Report what was only bot-tested, not hand-played.

## 8. Fair playtest — required after every warden change (user rule)

Debug scripts (teleporting, setting `att`/`state`/`hp`, calling `strike()`) are fine for finding bugs, but
they **do not count as done**. Every boss change ends with a full run played the way a player plays:

- From the chapter start (`?play=N`, fresh load), through the way in, every mark, every phase, to
  `colossus:defeated`.
- **Input only**: `bot.hold/up` on bound keys (move, sprint, jump, grip, interact, left/right) and the
  camera yaw/pitch, as mouse look would. No writing to `player.pos/vel/att/state/hp/stamina/immune`, no
  calling boss methods, no changing boss state or timers, no `reset`, no skipping time other than playing it.
- The player bot may only *see* what a player sees: positions of things on screen, the boss's visible
  pose/animation and HUD/Echo text. Don't read hidden values (timers, `notices()`, `hidden()`, cooldowns)
  to decide when to act.
- Deaths count: if the player dies, retry from the checkpoint like a player and report how many tries.
- **Don't make it easier to pass.** If the fair run fails, first fix bugs or unclear communication
  (telegraphs, Echo lines, readable poses). Lowering damage, widening windows or slowing the boss is only
  for a design reason, said plainly to the user — never just to get the test through.
- Report the result honestly: passed or not, time taken, deaths, which step was hardest, and anything that
  felt unfair or unclear.
