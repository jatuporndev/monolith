import { t, setLang } from '../core/i18n.js';
import * as THREE from 'three';
import { bus } from '../core/events.js';
import { Settings } from '../core/settings.js';
import { SaveSystem } from '../core/save.js';
import { Input } from '../core/input.js';
import { clamp, smoothstep, wait } from '../core/util.js';
import { AudioEngine } from '../audio/audio.js';
import { Renderer } from '../render/renderer.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Colossus } from './colossus.js';
import { Strider } from './strider.js';
import { Effigies } from './effigies.js';
import { CameraRig } from './camera.js';
import { RockFall } from './hazards.js';
import { ImpactFx } from './impactFx.js';
import { FurTouch } from './bossKit.js';
import { CHAPTERS, MENU_VIEW, WARDENS } from './chapters.js';
import { UI } from '../ui/ui.js';
import { LanguageScreen, TitleScreen, MainMenu, PauseMenu, ConfirmDialog, DeathScreen, ExitScreen } from '../ui/screens/menus.js';
import { SettingsScreen } from '../ui/screens/settings.js';
import { ChaptersScreen, LoadScreen } from '../ui/screens/saves.js';
import { LoadingScreen, CreditsScreen } from '../ui/screens/cinematic.js';

/**
 * Orchestrates game states and bridges gameplay ↔ UI.
 * States: boot → title/menu → loading → playing ⇄ paused → dying → dead → credits
 */
export class Game {
  constructor() {
    this.bus = bus;
    this.settings = new Settings(bus);
    this.saves = new SaveSystem(bus);
    this.state = 'boot';
    this.chapter = 0; this.slot = null; this.playtime = 0;
    this.time = 0; this.chapterArt = {};
    setLang(this.settings.get('language') || 'en');
  }

  async boot(status) {
    const step = async (label) => { status(t(label)); await wait(16); };
    await step('Preparing renderer');
    this.renderer = new Renderer(bus, this.settings, document.body);
    this.input = new Input(bus, this.settings, this.renderer.canvas);
    this.audio = new AudioEngine(bus, this.settings);
    await step('Raising the valley');
    this.world = new World(this.settings, bus);
    this.renderer.setScene(this.world.scene);
    await step('Waking the stone');
    this.player = new Player(this.world, bus, this.audio);
    this.world.scene.add(this.player.root);
    this.colossus = new Colossus(this.world, bus, this.audio);
    this.strider = new Strider(this.world, bus, this.audio);
    this.bosses = { warden: this.colossus, strider: this.strider };
    // stone likenesses on the plaza, carved from each warden standing at full height
    this.colossus.reset('dormant'); this.colossus.poseDormant(0); this.strider.standPose();
    this.effigies = new Effigies(this.world, this.audio);
    for (const w of WARDENS) this.effigies.add({ id: w.id, boss: this.bosses[w.id], ...w.effigy });
    this.strider.reset('dormant');
    this.hazards = new RockFall(this.world, bus, this.audio);
    this.cam = new CameraRig(this.renderer.camera, this.world, this.settings, bus);
    this.impact = new ImpactFx(this.world.scene);
    await step('Composing interface');
    this.ui = new UI(this);
    this.buildScreens();
    this.wireEvents();
    await step('Painting the chapters');
    this.renderChapterArt();
    await step('Compiling shaders');
    this.setupMenuScene();
    this.renderer.renderer.compile(this.world.scene, this.renderer.camera);
    this.startLoop();
    this.state = 'menu';
    this.ui.hud.show(false);
    this.ui.open(this.settings.get('language') ? 'title' : 'language');
  }

  buildScreens() {
    const u = this.ui;
    u.register('language', new LanguageScreen(u));
    u.register('title', new TitleScreen(u));
    u.register('main', new MainMenu(u));
    u.register('pause', new PauseMenu(u));
    u.register('confirm', new ConfirmDialog(u));
    u.register('death', new DeathScreen(u));
    u.register('exit', new ExitScreen(u));
    u.register('settings', new SettingsScreen(u));
    u.register('chapters', new ChaptersScreen(u));
    u.register('load', new LoadScreen(u));
    u.register('loading', new LoadingScreen(u));
    u.register('credits', new CreditsScreen(u));
  }

  /** Language changed: rebuild every screen in the new language and restore the open stack. */
  relocalize() {
    const u = this.ui;
    const names = u.stack.map((sc) => Object.keys(u.screens).find((k) => u.screens[k] === sc));
    const tab = u.screens.settings?.tabIndex ?? 0;
    for (const sc of Object.values(u.screens)) sc.el.remove();
    u.stack = []; u.screens = {};
    this.buildScreens();
    u.screens.settings.tabIndex = tab; u.screens.settings.renderTabs();
    for (const n of names) {
      const sc = u.screens[n]; if (!sc) continue;
      if (u.top && !sc.overlay) u.top.cover();
      u.stack.push(sc); sc.enter();
    }
    u.hud.relocalize();
  }

  /** The warden fought in the current chapter, if any. */
  get boss() { const id = CHAPTERS[this.chapter]?.boss; return id ? this.bosses[id] : null; }
  get wardenInfo() { return WARDENS.find((w) => w.chapter === this.chapter) || null; }
  /** Every warden not being fought still breathes (or lies where it fell). */
  updateIdleBosses(dt, t, except) {
    for (const b of Object.values(this.bosses)) if (b !== except) b.update(dt, t, this.player, false);
  }

  // ---------------------------------------------------------------- events
  wireEvents() {
    // the stab lands: freeze a beat, punch the camera in, flash warm light, rumble the pad
    bus.on('player:strikeImpact', ({ hit, power, pos }) => {
      if (!hit) { this.cam.punch(0.15, 0.08); return; }
      const heavy = power > 1;
      this.hitStop = heavy ? 0.16 : 0.09;
      this.cam.punch(heavy ? 0.9 : 0.5, heavy ? 0.62 : 0.42);
      this.renderer.fx.flash = heavy ? 1 : 0.6;
      this.input.rumble(heavy ? 1 : 0.7, heavy ? 320 : 180);
    });
    bus.on('settings:changed', ({ key, value }) => { if (key === 'language') { setLang(value); this.relocalize(); } });
    bus.on('game:pauseRequest', () => { if (this.state === 'playing') this.pause(); });
    bus.on('input:pointerlock', (locked) => {
      // browsers swallow Esc while the pointer is locked: losing the lock means "pause"
      if (!locked && this.state === 'playing' && !this.ignoreUnlock) this.pause();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    document.addEventListener('fullscreenchange', () => { this.settings.set('displayMode', this.isFullscreen() ? 'fullscreen' : 'windowed'); this.ui.refreshRows(); });
    bus.on('world:interact', (it) => this.interact(it));
    // a blow on the wanderer: graded by tier — the camera is shoved the way the blow travelled, heavy ones
    // freeze a beat and ring the ears; the condition (vignette, colour, heartbeat) follows the hidden health
    bus.on('player:hit', ({ amount, source, tier = 1, dir }) => {
      if (source === 'fall') { this.cam.addTrauma(clamp(amount / 40, 0.25, 0.9)); return; }
      this.cam.hit(dir, [0.25, 0.45, 0.75, 1][tier]);
      this.cam.addTrauma([0.18, 0.32, 0.55, 0.8][tier]);
      this.input.rumble(clamp(0.3 + tier * 0.25, 0.3, 1), 160 + tier * 90);
      if (tier >= 2) { this.hitStop = Math.max(this.hitStop || 0, 0.05 + tier * 0.025); this.audio.ring(tier >= 3 ? 1 : 0.6); }
      this.audio.play('impact', { vol: clamp(0.35 + tier * 0.22, 0.4, 1.1) });
      this.renderer.fx.flash = Math.max(this.renderer.fx.flash || 0, tier >= 3 ? 0.35 : 0);
    });
    // a giant's weight on the ground: dust rolls out from every heavy step, grit jumps on the hardest
    bus.on('colossus:footfall', ({ pos, strength = 1 }) => {
      if (this.state !== 'playing' && this.state !== 'ending' && this.state !== 'dying') return;
      this.impact.dust(pos, clamp(strength * 1.3, 0.3, 3)); if (strength > 0.8) this.impact.debris(pos, strength * 0.7);
      // the ground carries every step to the wanderer's feet: a jolt that grows as the giant nears
      const near = clamp(1 - pos.distanceTo(this.player.pos) / 75, 0, 1), k = strength * near * near;
      if (k > 0.03 && this.state === 'playing') { bus.emit('camera:shake', { amount: Math.min(0.55, k * 0.3), duration: 0.5 }); this.cam.hit?.(new THREE.Vector3(0, -1, 0), Math.min(0.5, k * 0.25)); }
    });
    bus.on('player:knockdown', ({ pos, crit }) => {
      this.impact.dust(pos, crit ? 0.7 : 0.45); this.impact.debris(pos, crit ? 0.7 : 0.4);
      this.cam.hit(new THREE.Vector3(0, -1, 0), crit ? 0.7 : 0.45);
    });
    bus.on('player:landed', ({ fall }) => { if (fall > 2.5) { this.impact.dust(this.player.pos, clamp(fall / 14, 0.15, 0.6)); this.cam.hit(new THREE.Vector3(0, -1, 0), clamp(fall / 20, 0.1, 0.4)); } });
    bus.on('player:died', ({ source }) => this.onDeath(source));
    bus.on('player:release', () => {
      const boss = this.boss;
      if (this.state === 'playing' && boss && boss.state === 'shaking' && this.lastOnColossus && !this.player.thrown) {
        // thrown off by the thrashing giant
        const p = this.player;
        const out = new THREE.Vector3(p.pos.x - boss.root.position.x, 0, p.pos.z - boss.root.position.z).normalize();
        p.vel.addScaledVector(out, 5).setY(Math.max(p.vel.y, 3));
        p.damage(8, 'thrown');
      }
    });
    bus.on('player:gripLost', () => this.audio.play('uiError'));
    bus.on('colossus:awaken', () => {
      this.audio.setMood('encounter');
      this.bossHint = { t: 0, stage: 0, solved: false, said: {} };
      for (const e of this.effigies.list) this.effigies.setMotes(e, false);   // the thread has done its work
      const w = this.wardenInfo;
      if (w) this.ui.hud.say([{ speaker: 'Echo', text: w.lines.awaken }]);
    });
    bus.on('colossus:sigilBroken', ({ remaining }) => {
      const boss = this.boss, w = this.wardenInfo; if (!boss || !w) return;
      // a warden that rears when marked throws its rider: they fall, and cannot catch hold on the way down
      const p = this.player;
      if (remaining > 0 && boss.throwOnSigil && p.onColossus) {
        const c = boss.root.position, out = new THREE.Vector3(p.pos.x - c.x, 0, p.pos.z - c.z);
        const side = new THREE.Vector3(Math.cos(boss.yaw ?? 0), 0, -Math.sin(boss.yaw ?? 0));   // off over a flank
        out.copy(side.multiplyScalar(Math.sign(out.dot(side)) || 1));
        p.throwOff(out);
        this.cam.addTrauma(0.5);
      }
      // the break itself: the world slows for a breath, the camera is struck, the light flares
      this.slowMo = 0.9; this.cam.punch(1.1, 0.7); this.cam.addTrauma(0.45); this.renderer.fx.flash = 1;
      this.input.rumble(1, 500);
      const left = boss.weakPoints.find((x) => !x.destroyed);
      if (left) this.ui.hud.say([{ speaker: 'Echo', text: w.lines.sigil[left.id] }], { interrupt: true });
    });
    // a warden's turning points: Echo speaks once per encounter; finding the way on ends the nudging
    const event = (name, key, solves = false, again = false) => bus.on(name, () => {
      const h = this.bossHint, w = this.wardenInfo; if (!h || !w?.lines.events?.[key]) return;
      if (solves) h.solved = true;
      if (h.said[key] && !again) return;
      h.said[key] = true;
      this.ui.hud.say([{ speaker: 'Echo', text: w.lines.events[key] }], { interrupt: true });
    });
    event('strider:spotted', 'spotted');
    event('strider:staggered', 'staggered');
    event('strider:drinking', 'drinking');
    event('strider:mounted', 'mounted', true);
    bus.on('strider:ram', ({ ridden }) => { if (ridden) { this.cam.addTrauma(0.6); this.input.rumble(1, 350); } });
    event('strider:plateCracked', 'ram');
    event('strider:armourBroken', 'armour', true, true);
    event('strider:winded', 'winded');
    event('warden:sealed', 'sealed');
    event('warden:rub', 'rub');
    event('warden:wallDown', 'wall');
    bus.on('warden:wallDown', () => { this.cam.addTrauma(0.8); this.input.rumble(1, 900); });
    bus.on('ui:input', (e) => { if (this.state === 'interlude' && (e.type === 'confirm' || e.type === 'back')) this.skipInterlude = true; });
    bus.on('colossus:dying', () => { this.player.immune = 30; this.audio.setMood('silence'); });
    bus.on('colossus:defeated', () => this.onVictory());
    bus.on('colossus:footfall', ({ pos, strength }) => {
      const d = pos.distanceTo(this.player.pos);
      if (this.state === 'playing') this.input.rumble(clamp(strength * (1 - d / 60), 0, 1) * 0.5, 180);
    });
  }

  // ---------------------------------------------------------------- menu scene & art
  setupMenuScene() {
    this.player.spawn(new THREE.Vector3(1.4, this.world.causeway.deckTop, 101), Math.PI * 0.95);
    this.player.root.visible = true;
    this.player.sleepTarget = null;
    for (const b of Object.values(this.bosses)) b.reset('dormant');
    for (const w of WARDENS) this.effigies.setState(w.id, 'standing');
    this.cam.setCinematic(MENU_VIEW.pos, MENU_VIEW.look, 1, true);
    this.world.followSun(new THREE.Vector3(0, 0, 80));
  }

  renderChapterArt() {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2400);
    this.player.root.visible = false;
    this.colossus.poseDormant(0); this.strider.poseDormant(0);
    this.world.update(0, 3, new THREE.Vector3(0, 0, 150));
    for (const c of CHAPTERS) {
      cam.position.copy(c.art.pos); cam.lookAt(c.art.look);
      this.world.followSun(c.art.look);
      this.chapterArt[c.id] = this.renderer.snapshot(cam, 960, 540);
    }
    cam.position.copy(MENU_VIEW.pos); cam.lookAt(MENU_VIEW.look);
    this.world.followSun(new THREE.Vector3(0, 0, 80));
    this.menuArt = this.renderer.snapshot(cam, 960, 540);
    this.player.root.visible = true;
  }

  // ---------------------------------------------------------------- loop
  startLoop() {
    this.last = performance.now();
    const frame = () => {
      const now = performance.now();
      const limit = this.settings.get('frameLimit');
      const minDt = limit ? 1000 / limit : 0;
      const elapsed = now - this.last;
      if (elapsed >= minDt - 1.5) {
        this.last = now;
        this.tick(Math.min(elapsed / 1000, 1 / 20));
      }
      if (this.settings.get('vsync')) requestAnimationFrame(frame);
      else setTimeout(frame, Math.max(0, minDt - (performance.now() - this.last) - 1));
    };
    requestAnimationFrame(frame);
  }

  tick(dt) {
    this.time += dt;
    const t = this.time;
    this.input.update(dt);
    this.audio.update(dt);
    const p = this.player, f = this.renderer.fx;

    // hit-stop: gameplay nearly freezes for a beat while camera, audio and effects keep running
    let sim = dt;
    if (this.hitStop > 0) { this.hitStop -= dt; sim = dt * 0.05; }
    else if (this.slowMo > 0) { this.slowMo -= dt; sim = dt * (this.slowMo > 0.2 ? 0.3 : 1 - 3.5 * this.slowMo); }
    f.flash = Math.max(0, (f.flash || 0) - dt * 3.2);

    if (this.state === 'playing') {
      this.playtime += dt;
      const look = this.input.look(dt);
      const boss = this.boss;
      p.update(sim, this.input, this.cam.yaw, boss);
      this.lastOnColossus = p.onColossus;
      if (boss) boss.update(sim, t, p, true);
      this.updateIdleBosses(sim, t, boss);
      this.hazards.update(sim, p, this.chapter === 1);
      this.cam.update(dt, look, p, boss);
      { const cm = this.cam.camera; cm.updateMatrixWorld(); const e = cm.matrixWorld.elements; this.audio.setListener(cm.position, { x: e[0], z: e[2] }); }
      if (boss && p.onColossus && boss.shakeIntensity > 0.2) { this.cam.rumble(0.25 + boss.shakeIntensity * 0.3); this.input.rumble(boss.shakeIntensity * 0.4, 100); }
      this.updateMusic(boss, p);
      this.updateContact(boss, p);
      this.checkProgress();
      this.climbHint(dt);
      this.wardenHint(dt);
      // HUD
      const hud = this.ui.hud;
      hud.setPrompt(p.state === 'dead' ? null : p.prompt);
      hud.setClimb({ visible: p.gripping || p.stamina < p.t.staminaMax - 0.5, stamina: p.stamina / p.t.staminaMax, gripping: p.gripping, shaking: !!boss && p.onColossus && boss.shakeIntensity > 0.5 });
      hud.setLockHint(!this.input.locked && this.input.promptDevice() !== 'pad');
      this.world.followSun(p.pos);
      this.world.update(dt, t, p.pos);
    } else if (this.state === 'menu' || this.state === 'credits') {
      // the menu backdrop: a slow, breathing camera over the living valley
      const d = MENU_VIEW.drift;
      const k = Math.sin(t * 0.045);
      this.cam.setCinematic(MENU_VIEW.pos.clone().addScaledVector(d, k), MENU_VIEW.look.clone().add(new THREE.Vector3(Math.sin(t * 0.03) * 2, 0, 0)), 0.6);
      this.cam.update(dt, { yaw: 0, pitch: 0 }, p, null);
      this.updateIdleBosses(dt, t, null);
      p.syncModel(dt);
      this.world.update(dt, t, MENU_VIEW.pos);
    } else if (this.state === 'dying') {
      const boss = this.boss;
      if (boss) boss.update(dt, t, p, true);
      this.updateIdleBosses(dt, t, boss);
      p.update(dt, this.input, this.cam.yaw, null);
      this.cam.update(dt, { yaw: dt * 0.15, pitch: 0 }, p, null);
      this.world.update(dt, t, p.pos);
    } else if (this.state === 'ending' || this.state === 'interlude') {
      const boss = this.state === 'ending' ? this.endBoss : null;
      if (boss) boss.update(dt, t, p, true);
      this.updateIdleBosses(dt, t, boss);
      p.update(dt, this.input, this.cam.yaw, boss);
      this.cam.update(dt, { yaw: 0, pitch: 0 }, p, boss);
      this.world.followSun(p.pos);
      this.world.update(dt, t, p.pos);
    }
    this.effigies.update(dt, t, p.pos);
    this.impact.update(dt, (x, z) => this.world.heightAt(x, z));

    // invisible health → screen, body and sound
    const live = this.state === 'playing' || this.state === 'dying' || this.state === 'paused' || this.state === 'ending';
    const c = live ? p.health.smoothed : 0;
    const k = Math.min(1, dt * 3);
    const beat = Math.pow(Math.max(0, Math.sin(t * (2.2 + c * 3))), 8) * smoothstep(0.45, 1, c);
    f.desat += (smoothstep(0.18, 0.92, c) * 0.85 - f.desat) * k;
    f.vignette += (smoothstep(0.15, 0.95, c) * 0.9 - f.vignette) * k;
    f.blur += (smoothstep(0.42, 0.95, c) * 1.8 - f.blur) * k;
    f.dark += (smoothstep(0.75, 1, c) * 0.22 - f.dark) * k;
    f.pulse = (live ? p.health.hitPulse : 0) + beat * 0.6;
    if (this.state === 'dying') { f.desat = Math.min(1, f.desat + dt * 0.3); f.blur += dt * 0.5; }
    this.audio.setBody(c, live ? p.exertion : 0, live ? smoothstep(0.7, 1, c) + (this.state === 'dying' ? 0.5 : 0) : 0);

    this.renderer.render(dt, t);
  }

  /** Bodies that part the grass this frame: the wanderer, and the feet of the warden being fought. */
  updateContact(boss, p) {
    const list = [{ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: 1.1 }], v = this._cv || (this._cv = new THREE.Vector3());
    if (boss) {
      const feet = boss.legs?.[0]?.hoof ? boss.legs.map((l) => l.hoof) : boss.feet || [];
      const r = boss.legs?.[0]?.hoof ? 2.8 : 5;
      for (const f of feet) { f.getWorldPosition(v); list.push({ x: v.x, y: v.y, z: v.z, r }); }
    }
    this.world.setPushers(list);
    // the coat answers the climber: pressed under hands and feet, a furrow behind the body
    for (const b of Object.values(this.bosses || {})) {
      if (!b.furU) continue;
      const tch = b.furTouch || (b.furTouch = new FurTouch(b.furU, b.root));
      const on = b === boss && p.state === 'climb' && p.rig?.limbs;
      if (on) { v.copy(p.rig.vpos); v.y += 0.95; }
      tch.update(0.016, on ? p.rig.limbs.map((l) => l.world) : null, v);
    }
  }

  // ---------------------------------------------------------------- progression
  /**
   * Chapter I teaches climbing by itself; if the player is still wandering after a while (or is pawing at the
   * vines by the gate), Echo points at the moss, then says it plainly. The moss breathes a faint glow from the
   * first hint until it is first gripped.
   */
  climbHint(dt) {
    const h = this.hint, p = this.player, moss = this.world.mat.moss;
    if (this.chapter !== 0 || h.done) {
      if (moss.emissiveIntensity > 0) moss.emissiveIntensity = Math.max(0, moss.emissiveIntensity - dt * 0.5);
      return;
    }
    if (p.state === 'climb') { h.done = true; return; }
    h.t += dt;
    // near the north wall but nowhere near the moss: looking for a way up in the wrong place
    const lost = p.pos.z < 137 && Math.abs(p.pos.x - 10) > 4.5;
    h.lost = lost ? h.lost + dt : 0;
    if (h.stage === 0 && (h.t > 40 || h.lost > 5)) {
      h.stage = 1; h.t2 = 0;
      this.ui.hud.say([{ speaker: 'Echo', text: 'Not the vines. The moss beside the fallen gate — there the stone is soft.' }], { interrupt: true });
    } else if (h.stage === 1 && (h.t2 += dt) > 40) {
      h.stage = 2;
      this.ui.hud.say([{ speaker: '', text: 'Walk up to the green moss on the north wall, right of the gate, and hold Grab to climb.' }], { interrupt: true });
    }
    if (h.stage > 0) { moss.emissive.setHex(0x6a7a2a); moss.emissiveIntensity = 0.18 + 0.14 * Math.sin(this.time * 2.2); }
  }

  checkProgress() {
    const p = this.player;
    if (p.state !== 'ground') return;
    // passing a shrine counts as resting at it, so no-one gets stranded in an earlier chapter
    if (this.chapter === 0 && p.pos.z < 113) this.restAt(this.world.interactables.find((i) => i.id === 'shrine1'), true);
    if (this.chapter === 1 && p.pos.z < 9 && Math.abs(p.pos.x) < 20) this.restAt(this.world.interactables.find((i) => i.id === 'shrine2'), true);
  }

  interact(it) {
    if (it.kind === 'examine') { this.ui.hud.say(it.lines, { interrupt: true }); return; }
    if (it.kind === 'shrine') this.restAt(it, false);
  }

  restAt(it, passive) {
    if (!it) return;
    const advancing = this.chapter < it.chapterCompleted;
    if (!it.lit) { it.lit = true; this.audio.play('checkpoint'); }
    // resting starts recovery right away (still gradual)
    const h = this.player.health; h.sinceHit = Math.max(h.sinceHit, h.t.recoveryDelay + h.t.recoveryRamp);
    if (advancing) {
      this.saves.complete(this.chapter);
      this.chapter = it.chapterCompleted;
      const c = CHAPTERS[this.chapter];
      this.ui.hud.chapterCard(c.numeral, c.title);
      this.ui.hud.say(c.intro, { interrupt: true });
      this.save();
    } else if (!passive) {
      this.ui.hud.say([{ speaker: '', text: 'The flame is warm. You rest a while.' }], { interrupt: true });
      this.save();
    }
  }

  save() {
    if (this.slot == null) return;
    const toast = this.ui.hud.toast(t('Saving'), { spinner: true });
    this.saves.write(this.slot, { chapter: this.chapter, playtime: this.playtime, completed: [...this.saves.profile.completed] });
    setTimeout(() => { toast.done(t('Progress saved')); this.audio.play('save'); }, 900);
  }

  // ---------------------------------------------------------------- menu actions
  continueGame() { const l = this.saves.latest(); if (l) this.loadSlot(l.slot); }
  requestNewGame() {
    if (!this.saves.hasAny()) this.startNew(0, 0);
    else this.ui.open('load', { mode: 'new', chapter: 0 });
  }
  requestChapter(id) { this.ui.open('load', { mode: 'new', chapter: id }); }
  startNew(slot, chapter) {
    this.slot = slot; this.playtime = 0;
    this.saves.write(slot, { chapter, playtime: 0, completed: this.saves.profile.completed.filter((c) => c < chapter) });
    this.loadChapter(chapter);
  }
  loadSlot(slot) {
    const s = this.saves.read(slot); if (!s) return;
    this.slot = slot; this.playtime = s.playtime || 0;
    this.saves.profile.lastSlot = slot; this.saves.persistProfile();
    this.loadChapter(s.chapter);
  }
  showCredits(onDone) {
    const fromMenu = this.state === 'menu';
    this.ui.fade(1, 700).then(() => {
      this.state = fromMenu ? 'menu' : 'credits';
      this.audio.setMood('credits');
      this.ui.open('credits', { art: this.menuArt, onDone: onDone || (() => this.ui.fade(1, 700).then(() => { this.ui.reset('main'); this.audio.setMood('menu'); this.ui.fade(0, 900); })) });
      this.ui.fade(0, 1200);
    });
  }
  exitGame() {
    this.ui.fade(1, 900).then(() => {
      this.audio.setMood('silence');
      try { window.close(); } catch { /* not allowed for user-opened tabs */ }
      this.ui.reset('exit');
      this.ui.fade(0, 900);
    });
  }
  isFullscreen() { return !!document.fullscreenElement; }
  setDisplayMode(v) {
    try {
      if (v === 'fullscreen' && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => this.ui.hud.toast(t('Fullscreen was blocked by the browser')));
      if (v === 'windowed' && document.fullscreenElement) document.exitFullscreen?.();
    } catch { /* ignore */ }
    this.settings.set('displayMode', v);
  }

  // ---------------------------------------------------------------- chapter loading
  prepareChapter(id) {
    this.chapter = id;
    this.hint = { t: 0, t2: 0, lost: 0, stage: 0, done: false };
    const c = CHAPTERS[id];
    for (const it of this.world.interactables) if (it.kind === 'shrine') it.lit = it.chapterCompleted <= id;
    this.setWorldForChapter(id);
    this.hazards.reset();
    this.player.spawn(c.spawn.pos.clone().setY(this.world.groundAt(c.spawn.pos.x, c.spawn.pos.z, 50)), c.spawn.yaw);
    this.player.root.visible = true;
    this.cam.snapBehind(this.player.pos, c.spawn.camYaw);
    this.world.followSun(this.player.pos);
  }

  async loadChapter(id) {
    const c = CHAPTERS[id];
    this.state = 'loading';
    this.input.setMode('ui');
    await this.ui.fade(1, 700);
    this.audio.setMood('silence');
    this.audio.setBodyActive(false);
    this.ui.hud.show(false); this.ui.hud.clearSubs(); this.ui.hud.hideChapterCard();
    const ls = this.ui.reset('loading', { chapter: c, art: this.chapterArt[id] });
    await this.ui.fade(0, 900);
    const t0 = performance.now();
    ls.setProgress(0.15); await wait(250);
    this.prepareChapter(id); ls.setProgress(0.45); await wait(250);
    this.renderer.renderer.compile(this.world.scene, this.renderer.camera); ls.setProgress(0.7); await wait(250);
    // render a few frames hidden behind the loading screen so the first visible frame is warm
    ls.setProgress(0.9);
    const remaining = 2600 - (performance.now() - t0);
    if (remaining > 0) await wait(remaining);
    ls.setProgress(1);
    await wait(350);
    await ls.waitForPlayer();
    await this.enterPlay(true);
  }

  async enterPlay(intro) {
    await this.ui.fade(1, 800);
    this.ui.reset(null);
    this.state = 'playing';
    this.cam.mode = 'follow';
    this.ignoreUnlock = true;
    this.input.setMode('game');
    setTimeout(() => { this.ignoreUnlock = false; }, 400);
    this.ui.hud.show(true);
    this.audio.setMood(CHAPTERS[this.chapter].music);
    this.audio.setBodyActive(true);
    this.audio.suspendWorld(false);
    await this.ui.fade(0, 1500);
    if (intro) {
      const c = CHAPTERS[this.chapter];
      this.ui.hud.chapterCard(c.numeral, c.title);
      setTimeout(() => { if (this.state === 'playing') this.ui.hud.say(c.intro); }, 1800);
    }
  }

  // ---------------------------------------------------------------- pause / death
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ignoreUnlock = true;
    this.input.setMode('ui');
    this.ignoreUnlock = false;
    this.ui.hud.show(false);
    this.audio.suspendWorld(true);
    this.audio.setBodyActive(false);
    this.ui.reset('pause');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.ui.sfx('uiBack');
    this.ui.reset(null);
    this.state = 'playing';
    this.ignoreUnlock = true;
    this.input.setMode('game');
    setTimeout(() => { this.ignoreUnlock = false; }, 400);
    this.ui.hud.show(true);
    this.audio.suspendWorld(false);
    this.audio.setBodyActive(true);
  }

  onDeath(source) {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.input.setMode('ui');
    this.ui.hud.show(false); this.ui.hud.clearSubs();
    this.audio.play('death');
    this.audio.setMood('silence');
    this.cam.mode = 'follow';
    setTimeout(async () => {
      await this.ui.fade(1, 2200);
      this.state = 'dead';
      this.audio.setBodyActive(false);
      this.ui.reset('death', { source });
      await this.ui.fade(0, 600);
    }, 1600);
  }

  async restartCheckpoint() {
    this.state = 'loading';
    this.input.setMode('ui');
    await this.ui.fade(1, 900);
    this.ui.reset(null);
    this.ui.hud.clearSubs();
    this.renderer.fx.desat = this.renderer.fx.blur = this.renderer.fx.vignette = 0;
    this.prepareChapter(this.chapter);
    await wait(400);
    await this.enterPlay(false);
  }

  async toMainMenu() {
    this.state = 'loading';
    this.input.setMode('ui');
    await this.ui.fade(1, 900);
    this.ui.hud.show(false); this.ui.hud.clearSubs(); this.ui.hud.hideChapterCard();
    this.audio.setBodyActive(false); this.audio.suspendWorld(false);
    this.setupMenuScene();
    this.state = 'menu';
    this.ui.reset('main');
    this.audio.setMood('menu');
    await this.ui.fade(0, 1200);
  }

  // ---------------------------------------------------------------- wardens across chapters
  /** Which wardens still stand, which effigies are rubble, where the motes lead — all from the chapter. */
  setWorldForChapter(id) {
    for (const w of WARDENS) {
      const boss = this.bosses[w.id];
      if (w.chapter < id) boss.setDefeated(); else boss.reset('dormant');
      this.effigies.setState(w.id, w.chapter < id ? 'fallen' : 'standing');
    }
    // the most recently fallen effigy points the way to the warden still waiting
    const next = WARDENS.find((w) => w.chapter === id), prev = WARDENS.filter((w) => w.chapter < id).pop();
    if (next && prev) this.effigies.setMotes(this.effigies.get(prev.id), true, this.bosses[next.id].home.clone().setY(this.world.heightAt(this.bosses[next.id].home.x, this.bosses[next.id].home.z)));
    this.bossHint = null; this.endBoss = null;
  }

  /**
   * The score follows the fight: tense below the giant, rising and bright once on it, swelling as the
   * climber closes on a mark or draws a blade back to strike.
   */
  updateMusic(boss, p) {
    if (!boss || !boss.awakened || !boss.alive) { this.audio.setIntensity?.(0); return; }
    this.audio.setMood(p.onColossus ? 'ride' : 'encounter');
    let k = 0;
    if (p.onColossus) {
      for (const wp of boss.weakPoints) {
        if (wp.destroyed || wp.sealed) continue;
        wp.mesh.getWorldPosition(this._wp || (this._wp = new THREE.Vector3()));
        k = Math.max(k, 1 - smoothstep(2.5, 9, this._wp.distanceTo(p.pos)));
      }
      if (p.strike.phase !== 'none') k = Math.max(k, 0.7 + 0.3 * (p.strike.charge || 0));
    }
    this.audio.setIntensity(k);
  }

  /** Echo nudges a player who hasn't found how to bring the Strider down. */
  wardenHint(dt) {
    const h = this.bossHint, boss = this.boss, w = this.wardenInfo;
    if (!h || !boss || !w || !w.lines.hint || !boss.alive || h.solved) return;
    h.t += dt;
    if (h.stage === 0 && h.t > 35) { h.stage = 1; this.ui.hud.say([{ speaker: 'Echo', text: w.lines.hint[0] }], { interrupt: true }); }
    else if (h.stage === 1 && h.t > 80) { h.stage = 2; this.ui.hud.say([{ speaker: '', text: w.lines.hint[1] }], { interrupt: true }); }
  }

  async onVictory() {
    const boss = this.boss, w = this.wardenInfo;
    this.endBoss = boss;
    this.state = 'ending';
    this.ui.hud.show(false);
    this.saves.complete(this.chapter);
    for (const e of this.effigies.list) this.effigies.setMotes(e, false);
    await wait(2500);
    this.ui.hud.say([{ speaker: 'Echo', text: w.lines.victory }], { interrupt: true });
    await wait(4500);
    await this.interlude(w, WARDENS.find((x) => x.chapter === this.chapter + 1));
  }

  /** Wait that a skip (Confirm / Back) cuts short. */
  iwait(ms) {
    return new Promise((res) => {
      const t0 = performance.now();
      const tick = () => { if (this.skipInterlude || performance.now() - t0 >= ms) res(); else setTimeout(tick, 40); };
      tick();
    });
  }

  /**
   * After a warden falls: the climber lies down where they stand and sleeps; wakes on the plaza between the
   * effigies; watches the fallen warden's effigy break apart; and, if another waits, sets out after the
   * thread of motes. Confirm or Back skips ahead.
   */
  async interlude(w, next) {
    const p = this.player;
    this.skipInterlude = false;
    for (let i = 0; i < 80 && p.state !== 'ground' && p.state !== 'dead'; i++) await wait(100);  // let them land first
    this.state = 'interlude';
    this.input.setMode('ui');
    this.ui.hud.clearSubs();
    // ---- sleep where they stand
    p.vel.set(0, 0, 0); p.state = 'cinematic'; p.sleepTarget = 1;
    // watch them lie down from the side away from the fallen warden, so its body doesn't fill the frame
    const side = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const fallen = this.endBoss?.root.position;
    if (fallen && side.dot(new THREE.Vector3(fallen.x - p.pos.x, 0, fallen.z - p.pos.z)) > 0) side.negate();
    this.cam.setCinematic(p.pos.clone().addScaledVector(side, 3.4).add(new THREE.Vector3(0, 1.5, 0)), p.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 0.5);
    this.audio.setMood('silence');
    await this.iwait(4200);
    this.renderer.fx.vignette = 0.5;
    await this.ui.fade(1, this.skipInterlude ? 250 : 2600);
    this.audio.setBodyActive(false);
    await this.iwait(1400);

    // ---- wake on the plaza, between the effigies
    const final = !next;
    this.chapter = final ? this.chapter : next.chapter;
    this.setWorldForChapter(final ? this.chapter + 1 : this.chapter);   // after the last, every warden lies fallen
    this.effigies.setState(w.id, 'standing');                            // ...but this one breaks before their eyes
    for (const e of this.effigies.list) this.effigies.setMotes(e, false);
    this.hazards.reset();
    const sp = CHAPTERS[3].spawn;
    p.spawn(sp.pos.clone().setY(this.world.groundAt(sp.pos.x, sp.pos.z, 50)), sp.yaw);
    p.state = 'cinematic'; p.sleepTarget = 1; p.rig.dead = 1;
    const eff = this.effigies.get(w.id);
    const effPos = new THREE.Vector3(eff.x, eff.top + 1.2, eff.z);
    const camA = new THREE.Vector3(-eff.x * 0.55, 2.0, p.pos.z + 6.5);
    this.cam.setCinematic(camA, p.pos.clone().lerp(effPos, 0.45).setY(1.0), 1, true);
    this.world.followSun(p.pos);
    this.renderer.fx.vignette = 0;
    this.ui.fade(0, this.skipInterlude ? 250 : 3000);
    await this.iwait(3400);
    p.sleepTarget = 0; p.recover = { t: 0, dur: 2.2, hold: 0.45, sev: 1 };
    await this.iwait(2400);
    // ---- the effigy breaks
    this.cam.setCinematic(new THREE.Vector3(-eff.x * 0.2, 2.4, eff.z + 7.5), effPos, 0.9);
    await this.iwait(1100);
    const nextBoss = next ? this.bosses[next.id] : null;
    this.effigies.crumble(w.id, nextBoss ? nextBoss.home.clone().setY(this.world.heightAt(nextBoss.home.x, nextBoss.home.z)) : null);
    this.cam.addTrauma(0.3);
    await this.iwait(3600);

    if (!final) {
      // follow the motes west, over the wall, toward the meadow
      this.cam.setCinematic(new THREE.Vector3(eff.x + 4, 3.2, eff.z + 4), new THREE.Vector3(-40, 9, 160), 0.5);
      await this.iwait(3000);
      this.finishInterlude();
      return;
    }
    this.ui.hud.say([{ speaker: 'Echo', text: 'Both have fallen. Nothing walks the valley now but you.' }, { speaker: 'Echo', text: 'Rest. The stone will remember for you.' }], { interrupt: true });
    await this.iwait(8500);
    await this.ui.fade(1, 3000);
    this.ui.hud.clearSubs();
    p.sleepTarget = null;
    this.state = 'credits';
    this.audio.setMood('credits');
    this.setupMenuScene();
    this.ui.reset('credits', { art: this.chapterArt[3], onDone: () => this.toMainMenu() });
    await this.ui.fade(0, 1500);
  }

  finishInterlude() {
    const p = this.player, c = CHAPTERS[this.chapter];
    if (this.skipInterlude) { p.rig.dead = 0; p.recover = null; }
    p.sleepTarget = null; p.state = 'ground';
    this.cam.snapBehind(p.pos, c.spawn.camYaw);
    this.state = 'playing';
    this.ignoreUnlock = true;
    this.input.setMode('game');
    setTimeout(() => { this.ignoreUnlock = false; }, 400);
    this.ui.hud.show(true);
    this.audio.setMood(c.music);
    this.audio.setBodyActive(true);
    this.ui.hud.chapterCard(c.numeral, c.title);
    setTimeout(() => { if (this.state === 'playing') this.ui.hud.say(c.intro); }, 1800);
    this.saves.unlock(this.chapter);
    this.save();
  }
}
