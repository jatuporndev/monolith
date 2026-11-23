# MONOLITH — Echoes of the Colossus

A small cinematic adventure for the browser, built with Three.js. You climb ruins, cross a drowned causeway and scale a walking stone Colossus. The UI follows one rule: **less UI, more immersion**.

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # production build in dist/
npm test           # unit tests (health, settings, saves)
```

Dev shortcut: `http://localhost:5199/?play=0|1|2` skips the menus and drops you straight into a chapter. It only works in dev mode and never writes a save.

## Controls

| Action | Keyboard & mouse | Controller |
|---|---|---|
| Move | W A S D | Left stick |
| Camera | Mouse (click the game to capture the pointer) | Right stick |
| Jump / leap while climbing (hold to charge, release to spring) | Space | A |
| Sprint | Left Shift | B / L3 |
| Grip (hold) | Left mouse | RT / RB |
| Interact / examine / rest / strike (hold while striking to charge) | E | X |
| Pause | Esc / P | Start |
| Menus | Arrows / WASD, Enter, Esc, Q/E tabs, Del secondary | D-pad / stick, A, B, LB/RB, X |

Every keyboard binding can be changed in **Settings → Controls**.

## How the game communicates

- **No health bar, anywhere.** Health is internal (`src/game/health.js`). Hits that land close together stack up. Recovery begins after 6 s without damage and ramps up gradually. Your condition shows only through the screen, sound and the character's body:
  - **Injured:** slight desaturation and vignette, heavier breathing, a little slower.
  - **Critical:** edge blur and a heartbeat; stamina recovers more slowly.
  - **Near death:** darker edges, the world's sound muffles, weak breathing, a limp.
  - **Death:** a slow fade to a minimal screen with "Restart from Checkpoint" and "Return to Main Menu".
  - No red overlays, blood or numbers are used.
- **Climbing HUD:** a thin stamina ring appears beside the character only while gripping. It turns ochre and pulses when stamina is low, and jitters while the Colossus thrashes.
- **Colossus:** no boss bar and no markers. Moss and fur mean "climbable" — but its shin coat only holds on a foot it has just stamped into the ground, so stay close, jump the shockwave and take that leg. Its two sigils glow faintly, and only when you are near. It turns, stomps (watch the raised leg) and tries to shake you off. Its body is one sculpted, weathered stone skin over the rig. Hits have weight: you stagger, guard, get knocked down and climb back to your feet, and the screen (never a bar) tells you how hurt you are.
- **The Strider (Chapter IV):** a wild thing to be broken. It grazes and goes to the pool to drink; if it sees you it charges until a standing stone breaks its line of sight. Reach it unseen while it kneels at the water — when it lifts its head to look round, stand still or keep a stone between you — and take its breast mane. Ridden, it bolts: hold the front of its neck and press left/right to steer it into the stones — two aimed rams split the plate over its croup mark (and shatter the stone). Its first mark throws you off and drives it wild: double charges, until it stands winded, head down — the way back on.
- **The Warden, second half:** its crown is sealed until the back mark breaks. Then it walks to the old wall at the back of the basin and grinds its back against it — get up to the shoulders — and brings the wall down.
- **Music follows the fight:** tense on the ground, bright and rising once you are on a warden, swelling as you near a mark or draw the blade. Each stab hits harder: a flinch, then a thrash you must grip through, then the break — the world slows for a breath.
- **Between wardens:** when one falls, you sleep where you stand and wake on the plaza, where its stone effigy breaks apart and a thread of light leads toward the next.
- **Stab:** press Interact near a sigil to wind up, drive the blade in, then pull it free. Hold during the wind-up to charge: the blade glows and the arm trembles, and a full charge counts as two blows. Charging costs stamina and fires on its own before you would lose your grip. The impact freezes the action for a beat, punches the camera in with shake and a warm flash, bursts light from the sigil, layers the sound (edge, stone crunch, body thud, ring) and rumbles the controller. While you climb, the camera eases out to the open side of the body and frames the blow.
- **Prompts** appear only in context: Grab, Release, Examine, Rest, Strike.

## Language

English and Thai (`src/core/i18n.js`). On first launch, a picker appears before the title screen. Change it any time in **Settings → Accessibility → Language**; the interface rebuilds immediately. English source strings are the dictionary keys. Proper nouns are never translated: MONOLITH, Echoes of the Colossus, chapter titles, Echo, Colossus and Warden. Thai text uses the bundled Noto Sans Thai and Noto Serif Thai fonts.

## Architecture

```
src/
  core/      events (bus), settings, save system, input (kbd/mouse/gamepad), storage, utils
  game/      game.js (state machine + gameplay↔UI bridge), world, player, climb, colossus, strider,
             bossKit (shared fur/sigil/fx), effigies,
             camera, hazards, health, chapters, procedural textures, env* (look of the valley),
             character/ (skinned model, animator, cloth)
  render/    renderer + post-processing (condition shader, FXAA/SMAA/MSAA, motion blur)
  audio/     fully procedural Web Audio: wind, generative music, heartbeat/breath, SFX
  ui/        ui.js (screen stack, fades, input routing), core.js (FocusNav, Screen, glyphs),
             components.js (menu items, select/slider/toggle/keybind rows), hud.js,
             screens/ (title, main, pause, confirm, death, exit, settings, chapters,
             load/new slots, loading, credits)
  styles/ui.css   design tokens (colour, type, spacing, timing) + every component style
```

- The player is one skinned mesh on a 39-bone humanoid skeleton, built in code (`game/character/build.js`). `character/animator.js` drives it: blended state poses (ground, air, climb, death), two-bone IK that locks feet to the ground and hands and feet to climbing holds, springs for landing and stagger, and a Verlet cloak, scarf and hair tail (`character/cloth.js`).
- The environment look lives in `game/envShaders.js` (ground, stone, fog and sky shaders), `game/envScenery.js` (distant ruins, mountains, birds) and `render/envPost.js` (depth-based ambient occlusion).
- Gameplay never touches the DOM. It emits events on the bus, and the UI reads state through `Game`.
- All UI input goes through `ui:input` events (`nav`, `confirm`, `back`, `tab`, `secondary`, `start`, `any`). Keyboard, mouse and controller behave the same in every menu.
- Settings persist to `localStorage` and apply live: render scale, fullscreen, presets, shadows, AA, post, vegetation, VSync and FPS cap, the four volume buses, prompt device, sensitivities, inverts, vibration, deadzone, UI scale, subtitles (on/off, size, background, speaker names), camera shake, motion blur and screen-effect intensity.
- There are 3 save slots plus a cross-slot profile (unlocked and completed chapters). The game saves when you rest at a shrine and when a chapter starts.
- The game has no external assets. Textures, chapter and loading art (rendered from the live world at boot) and all audio are generated at runtime. Fonts are bundled locally (`@fontsource`).

## Notes

- Browsers cannot really disable VSync. With VSync **Off**, the game uses a timer-driven loop capped by the frame-rate limit.
- **Exit Game** tries `window.close()`. Browsers only allow that for script-opened tabs, so an exit screen is shown instead.
- Pointer lock is lost when you press Esc in the browser. The game treats that as a pause.

## 14. Boss overhaul per the warden-design skill (user request 2026-11-21)
See CHECKLIST.md §14.
