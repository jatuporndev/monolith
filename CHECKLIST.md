# MONOLITH — Work Checklist

Source spec: `New Text Document.txt`. Project folder was empty → build the Three.js game + full UI from scratch.
Note: the spec mentions an uploaded reference screenshot, but no image exists in the project; direction is taken from the written description (small spaced type, warm whites, left-aligned list over a live, calm world scene).

## 0. Setup
- [x] Vite + three + fonts (local @fontsource), project structure (core / game / render / audio / ui)
- [x] Design tokens (colors, type scale, spacing, timing) in one CSS file

## 1. Core systems
- [x] EventBus
- [x] Game state machine (boot → menu → loading → playing ⇄ paused → dead → credits)
- [x] Settings store (persisted, defaults, apply hooks)
- [x] Save system (3 slots + autosave, chapter progress, playtime, timestamp)
- [x] Input: keyboard, mouse (pointer lock), gamepad, rebinding, device auto-detect for prompt glyphs

## 2. Game world (preserve-able, separate from UI)
- [x] World: terrain, ruins, moss walls, statues, vegetation, fog, sky, sunlight, distant colossus silhouette
- [x] Player: third-person movement, sprint, jump, fall damage, breathing/impairment hooks
- [x] Camera: orbit follow, sensitivity, invert, shake (scaled by setting)
- [x] Colossus: walks, shakes, attacks (stomp/swipe), grip zones, weak points, defeat
- [x] Climbing: grip, climb surfaces, stamina drain/recover, shake-off, fall
- [x] Interactables: examine, use (checkpoint shrine), climb ledges, grab/release
- [x] Hazards: falling rocks / crush, fall heights
- [x] Chapters (3) as spawn points + world states

## 3. Invisible health (NO HP UI anywhere)
- [x] Internal health + damage accumulation window, delayed gradual recovery, death
- [x] States: healthy / injured / critical / near-death → desat, vignette, blur, breathing, heartbeat, movement & stamina impairment, muffled audio
- [x] Death: cinematic fade, minimal screen, restart checkpoint / main menu
- [x] Unit tests for health logic

## 4. Rendering / audio
- [x] Post FX: condition shader (desat/vignette/blur), FXAA/SMAA, motion blur, intensity setting
- [x] Procedural audio: wind ambient, music drone, UI ticks, heartbeat, breathing, impacts, colossus, lowpass muffling; 4 volume buses

## 5. UI screens & components
- [x] Main menu (Continue, New Game, Chapters, Load Game, Settings, Credits, Exit) over live world scene
- [x] Menu list component: keyboard/mouse/controller nav, subtle selection, fades
- [x] Pause menu (Resume, Restart from Checkpoint, Settings, Return to Main Menu)
- [x] Settings: Graphics / Audio / Controls / Accessibility — every control functional
- [x] Chapter select (art, progress, completed, current)
- [x] Load game (slots, chapter, playtime, last saved, continue)
- [x] Save notification (subtle)
- [x] Loading screen (art, lore fragment, minimal progress)
- [x] Credits (slow scroll)
- [x] HUD: contextual prompts, climbing stamina (thin), grip feedback, low-stamina warning
- [x] Subtitles (for accessibility settings)
- [x] Confirm dialog (overwrite / quit)
- [x] Exit game behavior in browser

## 6. Testing & polish loop
- [x] Build passes, unit tests pass
- [x] Run in browser; test every screen and button
- [x] Gameplay: walk, climb, stamina, damage states, death, restart, pause
- [x] Responsive: small / large viewports, UI scale
- [~] Controller nav — implemented (Gamepad API, standard mapping) but NOT tested: no physical controller was available
- [x] Fix bugs, refine spacing/typography/animation; repeat
- [x] README with controls + architecture

## Verification log (2026-11-21, Chrome)
- Unit tests 10/10, production build OK.
- Tested in the browser: title → main menu → New Game → loading → play (real key presses); settings tabs, presets, rebinding + Esc cancel, back; chapters; load slots; pause; death → restart from checkpoint; credits.
- Gameplay (driven by scripted input): walk; climb moss wall + mantle; sprint-jump the causeway gap; rockfall spawns; Colossus wakes, climb shin→thigh→hips→back→shoulders, shake-off throws a tired player, strike both sigils → collapse → credits.
- Damage stages show as desaturation/vignette/blur (no red, no numbers).
- Responsive at 390px and 900×520 (fixed title overflow at phone width).

## Known limits / next ideas
- The Colossus and character are low-poly primitives; art could be upgraded with real models.
- ~450 draw calls at Ultra; merging static ruin blocks would cut that further.
- Automated runs had Chrome throttling requestAnimationFrame in a background window, so FPS was not measured on screen; renderer CPU cost is ~4 ms per frame.

## 7. Round 2 (user request 2026-11-21)
- [x] Player character model: rounded torso, head + hair + scarf + hood, knees/elbows, hands, boots, flowing cloak
- [x] Colossus model: rounded/chiselled stone forms, better fur, face/eye glow, cracks, details
- [x] Grass: soft curved clumps instead of spikes (blade bend, width, up-normals, base→tip colour)
- [x] Environment: fuller tree canopies, bushes/ferns, flowers, scattered rocks
- [x] i18n: Thai / English; all UI strings through t(); proper nouns stay English (MONOLITH, chapter names, Colossus…)
- [x] Thai font (Noto Sans/Serif Thai) bundled locally
- [x] Settings → Language selector (applies live)
- [x] First launch: language picker before title/menu
- [x] Test in browser: both languages, picker, models, grass; build + tests

Verification (2026-11-21, Chrome): build OK, tests 10/10. Checked visually: new player model (knees/elbows, cloak ripple, scarf), Colossus (sculpted stone, horns, glowing eyes, faint veins, shaggy fur), grass clumps + wildflowers, trees/bushes/rocks. First launch shows the language picker → Thai → title/menu in Thai; Settings → Accessibility → Language switches live both ways and keeps the open tab; loading, subtitles, prompts, chapter card, pause, death, chapters, slots (Thai dates), credits all translated; proper nouns stay English. Ultra: ~2.9 ms/frame, ~3M tris.

## 8. Stab feel (user request 2026-11-21)
- [x] Wind-up → optional charge (hold) → thrust aimed at the sigil → embed → pull-out, with torso twist/lean
- [x] Impact: hit-stop, camera punch + shake + roll kick, warm screen flash, sigil light-spark burst, layered audio, rumble
- [x] Charged stab = 2 hits; blade glows while charging; charge auto-releases before stamina empties
- [x] Fur cleared around the back sigil; camera assist keeps the camera outside the Colossus while climbing
- [x] Verified in Chrome: quick stab (1 hit) by real key press; charged stab (2 hits), frames captured at charge and impact

## 9. Character and environment overhaul (user request 2026-11-21)
- [x] Player replaced by a skinned, rigged humanoid (39 bones, ~10k vertices, fingers and thumbs, layered clothing, sheathed blade)
- [x] Animator: run/walk gait with foot locking, start/stop/turn-in-place steps, jump, fall, landing, hard-landing recovery, injured gait, death, climbing with hand/foot holds, shake-dangle, lunge, mantle, strike
- [x] Secondary motion: Verlet cloak and scarf with body collision, sprung hair tail, breathing, weight shift
- [x] Camera: closer framing, look-ahead, soft trailing behind travel, eased collision, sprint FOV
- [x] Environment: terrain/stone shaders, masonry detail, vegetation variety and gusts, height fog, sky, AO, distant scenery
- [x] Gameplay tuning that changed: climb speed 1.7 → 1.45 m/s (stamina per metre kept), falls over 4.2 m briefly lock movement while the character recovers
- [~] Not checked: controller input, frame rate on screen (automation throttles the tab; a forced tick costs ~4.3 ms at 224 draw calls / 3.3M triangles), AO under MSAA

Verification (2026-11-21, Chrome, scripted input): build OK, tests 10/10. Viewed as frame sequences in the game: idle, run, stop, turn in place, jump, fall, hard landing and recovery, injured run, death, wall climb, Colossus climb, shake, crawl on a top surface, charged strike, menu scene.

## 10. Boss fur and climbing leap (user request 2026-11-21)
- [x] Climbing jump is now a charged leap: hold Jump to coil, release to spring along the surface with real speed and deceleration (tap ≈ 0.4 m, full charge ≈ 1.3 m up / 2.5 m sideways); past the edge of a hold the body leaves the surface and can re-grab in the air
- [x] Coil, flight and catch poses for the leap
- [x] Colossus fur: narrower irregular locks with ragged tips, sway in the wind, trail behind the body on a spring, whip during a thrash, jolt on each footfall
- [x] Colossus motion: head tracks the player while hunting, trunk counter-sways with the stride, forearms trail, the thrash is slower and larger
- Verified in Chrome with scripted input (leap distances measured, frame sequences viewed); build OK, tests 10/10. Not played by hand.

## 11. Follow-up on the open points (user request 2026-11-21)
- [x] Fur silhouette: locks spill past every edge (crest, sides, hem), the hide underneath is pillowed, top surfaces carry short standing tufts (the crown sigil keeps a clearing), locks are lit the same from both sides
- [x] Leaps on the Colossus: leg → thigh → hips → back → shoulders by leaping, and thigh ↔ thigh across the gap as a real jump through the air. A leap leaves the surface only when a hold can be reached, and is aimed at it; on top surfaces it never launches off the edge
- [x] Leap aim survives letting go of the stick just before the button; downward leaps shortened
- [x] Thrash checked: hanging through a full warn + shake cycle costs 22 stamina, no damage, grip kept — the stamina formula is unchanged, the larger motion is visual only
- [x] Controller: exercised with a simulated standard-mapping gamepad (walk, jump, grip, climb, charged leap, release, menu navigation events). A physical pad was still not available


## 12. Second warden and the interlude (user request 2026-11-21)
- [x] Chapter IV "The Strider of the High Meadow": a level meadow west of the plaza, reached through a new breach in the plaza's west wall, ringed by 7 standing stones (colliders; a struck stone leans a little further)
- [x] The Strider: a four-legged armoured ram. Unlike the Warden it cannot be climbed from the ground — stone legs, no fur below the chest. It charges (paw-scrape telegraph, homing only at the start), tramples, kicks behind, hooks its horns at anyone close in front. Horns into a standing stone → stunned and kneeling for 8.5 s, chest mane in reach. Ridden, it gallops in loops and bucks. Sigils on the nape and the croup; it dies rolling onto its side
- [x] Plaza effigies: stone likenesses carved from each warden's own body on plinths beside the path
- [x] After a warden falls: Echo's line → the climber lies down and sleeps → fade → wakes on the plaza → camera to the effigy, which breaks apart → a thread of light-motes drifts from the rubble toward the next warden → chapter card, control returns. After the last warden: both effigies are rubble, Echo's closing lines, credits. Confirm/Back skips ahead
- [x] Active boss is per chapter (`CHAPTERS[i].boss`, `WARDENS` in chapters.js); earlier wardens load already fallen, their effigies as rubble
- [x] Echo hints for the Strider (35 s / 80 s without a stun), a line on the first stun; all new lines in Thai
- [x] Sounds: strider bray, snort, hoof clops; sleep pose (curled on one side)
- Verified in Chrome with a scripted bot: lure → stun → climb neck → nape → ride through bucks → croup → death roll → interlude → credits; and Chapter III victory → interlude → Chapter IV with motes. Fixes found by the bot: stun re-triggering on the same stone, a 0.7 m gap between withers and back (added a saddle patch), trample reach, a safe spot under its head, softer trample/kick damage. Build OK, tests 10/10. Not played by hand.

## 13. Fixes from play (user report 2026-11-21)
- [x] No sound with the `?play=` shortcut: audio only started from the title screen's "press any key". Now any click/key starts or resumes it, and a mood chosen before that is applied when it starts
- [x] Fell through the Strider's back on letting go: stepping off only counts at the true rim (not at the hole around a sigil); letting go on top of a giant tumbles over its side clear of the body (roll softens the landing); the Strider's barrel is solid
- [x] Breach rubble and fallen-effigy rubble could be walked through: bigger pieces are solid now; the breach keeps a pebble-only lane through the gap
- [x] Breaking the Strider's first mark: it rears and bucks, the rider is thrown clear and cannot catch hold until landing (the Warden is unchanged)
- Verified in Chrome with scripted input. Build OK, tests 10/10.

## 14. Boss overhaul per the warden-design skill (user request 2026-11-21)
- [x] Adaptive music: new `ride` mood when on a warden (pad opens and lifts, quick plucks); an intensity layer (drone + filter) rises near an open mark and while drawing a strike
- [x] Escalating stab reaction on both wardens: hit 1 flinch, hit 2 thrash (needs grip), hit 3 break with slow motion (~0.9 s), camera punch, flash and rumble
- [x] Strider rework ("a wild horse to be broken", replaces the SotC-like stun-on-stone): graze → drink at a new pool; sees in a front cone / hears close by, louder when sprinting; standing stones block its sight and it calms after losing you. Mount from the breast mane while it kneels to drink → rears → bolts (avoids stones on its own). Rider on the front of the neck steers with left/right; aimed rams crack the stone (2nd shatters it) and the croup plate (2 rams expose the croup mark). Unridden charges only knock stones askew
- [x] Strider phase 2 after the first mark: rider thrown, eyes flare, faster charges in pairs, after 3 charges it stands winded 8 s (breast mane in reach) — the way back on; bucks every ~5 s
- [x] Warden phase 2: crown sealed (dark, can't be struck) until the back mark breaks; then it walks to a new ruined wall at the back of the basin, backs into it and grinds: a rider on the back fur is hurt then scraped off, the shoulders are safe; the wall falls and becomes low rubble. Wall/stones reset on retry, fallen in later chapters
- [x] Echo lines for each turning point (spotted, mounted, plate cracked/broken, winded, sealed crown, grind, wall down), all in Thai; hints rewritten
- [x] Fixed: static box colliders were rotated the opposite way from their meshes (all rotated colliders now match what you see)
- Verified in Chrome with scripted bots (not played by hand): stealth mount at the pool, steering + 2 aimed rams → plate broken, nape → throw (0 grabs mid-air) → phase 2 → winded after 3 charges → remount → croup → dying; Warden: crown sealed → back broken → walk/turn/back/grind → rider crushed then thrown → wall down. Build OK, tests 10/10.
- Not yet tuned by hand: steering feel (turn rate 1.3 rad/s), how easy it is to stay unseen, fall damage after being scraped off the Warden (~45).

## 15. Fair playtest of both wardens (user rule 2026-11-21)
- Played input-only with player bots (`scripts/fairwarden.js`, `scripts/fairstrider.js`): keys + camera only, no teleports/state writes.
- Warden: passed (best run 1 death, ~5 min game time; earlier runs 2–5 deaths). Hardest: stamina from shin to back mark.
- Strider: passed, 0 deaths, ~6 min game time. Hardest: getting from the withers onto the neck to the nape (~2 min).
- Real bugs found and fixed: "Grab" prompt showed at 1.9 m but grabbing needs 1.15 m (prompt now honest); Strider drink lasted 9 s (too short to walk in) → 24 s + Echo cue; withers↔neck gap made the nape unreachable while galloping (withers split, neck mane extended, `climb.reach` for the moving neck); Warden had no rest spot below the back mark (added a fur ledge on the hips — slightly easier, by design rule); all rotated box colliders were mirrored.

## 16. Colossus quality & game feel overhaul (2026-11-21)
- [x] Damage reactions (`player.damage`): tiers light/medium/heavy/critical from damage + low condition; directional torso recoil and guard; stagger with carried push; knockdown (supine or prone, by hit direction) → lie → sit/push-up → kneel → rise, control returns late in the get-up; knocked flying by pushes. No HP bar: vignette/desaturation/heartbeat/muffle unchanged, plus a temporary ear-ring muffle on heavy hits
- [x] Camera: directional hit spring + roll (`cam.hit`), scaled by the existing camera-shake accessibility slider; hit-stop on heavy hits
- [x] Sound: procedural grunts (hurt, heavy hurt, grip strain, slipping grip), body fall, get-up
- [x] Grip struggle (animator): stamina-dependent spring stiffness; light shake = tuck in and clench; violent = hauled out, hips twist, legs kick and brace; at low stamina in a violent shake hands slip one at a time (IK lets go, arm flails, regrips) with sound — readable before you fall
- [x] Impact FX (`impactFx.js`): pooled dust + grit for knockdowns, hard landings and every giant footfall
- [x] Sculpted bodies (`sculpt.js`): SDF of soft primitives bound to the rig → surface nets → one SkinnedMesh with smooth joints; weathering (noise, cracks, cell seams), cavity darkening, stains, moss on top faces and creases, triplanar grain + glowing veins. Warden (~57k tris): heavy humanoid, sockets, brow, horns, fingers, shin guards. Strider (~42k tris): grey grazer, deep chest, arched neck, shell scutes, fine bare legs; its croup plate is a separate sculpt that still breaks away
- [x] Warden walk: weight rolls onto the planted leg, planted knee gives, slow breathing
- [x] Grass is pressed aside around the wanderer and the feet of the warden being fought (`world.setPushers`)
- [x] Fixed: effigies cloned the skinned body, so the statues followed the living warden's bones (rendered as a dark "camo" pattern over the real body). Effigies now carve a plain rest-pose mesh
- Fair playtests after the overhaul (input-only bots): Warden 3 runs — deaths 4 / 0 / 2, ~6¼ / 1½ / 4¾ min; every death was being scraped off during the wall grind (existing mechanic), none from the new knockdowns. Strider 1 run — 0 deaths, ~3½ min. Build OK, tests 10/10.
- Not done: no detailed per-finger grip anchors on the sculpted stone (climbing still happens on fur patches); grass push limited to 6 bodies.

## 17. Creature redesign: living wardens (2026-11-21)
- [x] Both wardens redesigned as living animals with separate identities (design notes + reference sheets in `docs/creatures/`): the Mourner (umber leather, bone mask, broken horn, scar, shoulder spurs, gold coat, amber eyes) and the Tarn Runner (teal scales with barring, ivory scutes and blaze, swept horns, dewlap and beard, silver mane, ice eyes)
- [x] Skin: `hideTexture('wrinkle' | 'scale')` + bump from the grain in `sculptMaterial`; per-vertex markings via a `paint` hook (blotches, dust, saddle, barring)
- [x] Jaw joints, blinking eyes, breathing ribs/flanks; habits: the Mourner lifts its face and lows, the Runner tosses its horns
- [x] Coat answers the climber (`FurTouch`): locks pressed and parted under hands, feet and body, a furrow that springs back; locks are wavy and each idles on its own beat
- [x] Sculpt build 20 s → ~1.5 s per warden (coarse grid of nearby primitives; one gradient per vertex)
- Rig, climb patches, marks and fight logic unchanged. Fair playtests after the redesign: Strider 0 deaths ~5 min; Warden 3 deaths ~6¼ min (falls during the wall grind / thrash). Build OK, tests 10/10.
- Not done: painted concept art (no image generator; sheets are in-game renders); new skeletons / new attacks; run and stumble cycles are the existing ones; player-in-frame scale shot for the Runner.

## 18. Fur seating, giant-scale sound, weighted reactions (2026-11-22)
- [x] Fur grows from the body on both wardens: every fur patch now has a matching swell in the sculpted body under it; the old patch box is kept only as the unseen climbing surface (no more slabs between coat and body)
- [x] Sound: every boss sound is positioned (fades with distance, pans to its side; `audio.setListener`, `boss.snd`). New: `giantStep`, `giantLift`, `giantStomp`, `giantCollapse`, `giantCreak`, `giantBreath`, `giantSwing`, `striderBreath`, `striderLand`. Old low-only effects (step, impact, rumble, shake, rock hit, hoof, groan) gained 100 Hz–2 kHz layers and debris so they carry on small speakers
- [x] Footfalls jolt the camera by distance and raise dust for every step (Strider walking included)
- [x] Warden motion: stomp winds up through the whole body (rears back, arms out, throws its weight down, sinks, hauls upright); hurt reaction (arches, head back, right hand gropes for the wound); stagger on the second cut of a mark and when the wall falls (knee gives, mass drops and is caught, with step sound and dust); shoulders and head lead a turn; shifts weight from leg to leg when standing; breath and joint creaks are audible
- [x] Strider motion: hurt (head flung up, quarters sink), stumble onto its knees after a ram, heavy landing after rearing, audible breath that quickens with speed
- [x] Labelled design sheets in `docs/creatures/` (front / side / rear / three-quarter / head / surface / scale / back)
- Fair playtests after these changes: Warden won, 2 deaths, ~4½ min; Strider won, 0 deaths, ~5⅓ min. Sounds were checked for errors and spectrum in the browser, not by ear.
- Not done: painted concept art (no image generator available); new skeletons or new attack types.

## 19. The Warden's rest shelf (2026-11-22)
- Question from the user: "the rest spot in the middle of the back — I can't stand on it". It is not mid-back: it sits over the hips, below the back fur. It did work (letting go there kept you on and refilled stamina), but it was a thin 0.5 × 1.2 m strip lost in the fur, and the character stayed on all fours, so it never looked like standing.
- [x] Shelf now 6 × 2 m, growing out of a sculpted ridge of pelvic bone (clearly visible from below and behind)
- [x] Letting go on any broad top (this shelf, shoulders, crown) now rises into an upright braced stance (knees soft, arms loose, head looking around); moving or a thrash drops back to all fours. Player rig and other animations unchanged
- [x] Route checked: hips/thigh fur → shelf → (facing the back) back fur → shoulders
- Fair playtest: Warden won, 1 death, ~2¾ min; the bot rested on the shelf ~24 s in total. The bigger shelf makes resting there easier to reach — that is its purpose, said plainly.

## 20. Catching mid-fall, landing on tops, the Warden's hide fold (2026-11-22)
- User: "can't grab while falling" and "the Warden still clips through the rest spot; the model looks like a ledge stuck on for no reason".
- [x] Mid-fall catch: reach 1.5 m (was 1.15), a hold level with or a little below the chest counts. The faster the fall, the more stamina the jolt costs; too fast and the hand is torn off (sound + slip) and you keep trying lower. Arms recover stamina while airborne (20/s). Still no catching after the first sigil throw (`thrown`) — rule unchanged.
- [x] Falling onto any sky-facing top of a giant (shelf, shoulders, crown) now lands on it instead of passing through (`Player.landOnGiant`); fall damage still applies.
- [x] The shelf is no longer a stuck-on slab of fur: it is a sculpted roll of folded hide across the hunched lower back, mossy on top, tapering into the flanks, with a crease beneath. The climb box is invisible.
- Fair playtests: Warden won 0 deaths ~2 min; Strider won 0 deaths ~7 min. The air catch makes falls more forgiving — that is the point of the request, said plainly.

## 21. Fold parted for a climb gap; no stamina in the air (2026-11-22)
- User: "still climbs through the Warden's rest spot — leave a gap to climb up" and "stamina must not refill mid-air, only on the ground".
- [x] Stamina no longer recovers while airborne (removed `regenAir`). Ground and resting on a top are unchanged.
- [x] The fold is parted down the spine into two coat-draped rolls on the haunches (patches 11/12). The hips fur is now a 2.6 m strip up the middle through the gap (patch 0); thin haunch fur under each roll (13/14) carries a climber from the thighs across to the gap. Climbing straight up a thigh stops under the overhang; go sideways to the gap, up, then step sideways onto either roll to stand.
- [x] Checked: no climb path passes inside a roll (point-in-ellipsoid count 0 over every route tried).
- Fair bot taught to sidestep toward the gap when blocked under the overhang (what a player sees and does).
- Fair playtests: Warden won, 1 death (fall during the wall grind), ~4 min; Strider won, 0 deaths, ~5 min.
