// The battle scene of Expedition 69 (registry 'battle'): builds a BattleModel from the real data modules and
// runs the whole fight — intro flourish, CTB turn loop, party command menus / targeting / skill execution with
// offensive QTE rings, Free Aim, enemy turns with real-time defensive QTEs (parry / dodge / jump / gradient
// counter) judged by DefenseTracker through an AttackClock-backed battle clock (hit-stop and slow motion never
// distort judging), counters, boss phases, hints, practice tools, pause overlay, victory results and defeat.

import { Scene } from '../core/scene.js';
import { RNG } from '../core/rng.js';
import { clamp } from '../core/util.js';
import { AttackClock, DEFENSE_ACTIONS, DIFFICULTY, describeOffset, OUTCOME_LABELS, VALID_DEFENSES, perfectAction } from './qte.js';
import { BattleModel } from './model.js';
import { STATUS_DEFS } from './status.js';
import { ENEMIES } from '../data/enemies.js';
import { ENCOUNTERS } from '../data/encounters.js';
import { SKILLS } from '../data/skills.js';
import { ITEMS } from '../data/items.js';
import { CHARACTERS } from '../data/characters.js';
import { RELICS } from '../data/relics.js';
import { STORY, fillTokens } from '../data/story.js';
import { touchWording } from '../ui/text.js';
import { SFX_INFO } from '../core/audio.js';
import { toBattleParty, applyBattleResult, createNewGame } from '../game/gameState.js';
import { xpToNext, MAX_LEVEL } from '../game/progression.js';
import { drawActor } from '../render/sprites.js';
import {
  Effects, drawQteRing, drawDefenseCue, drawTargetMarker, drawEnemyBars, applyDesaturation, resetEnemyBars,
} from '../render/effects.js';
import { drawBattleBackground, prepareBattleBackground } from '../render/backgrounds.js';
import { PALETTE, ELEMENT_COLORS, HIT_TYPE_COLORS, STATUS_COLORS } from '../render/palette.js';
import { elementIcon, itemIcon, mechanicIcon } from '../render/icons.js';
import { BattleCamera } from './camera.js';
import {
  ActorView, EnemyAttackRun, PartyActionRun, slotPosition, halfWidth, projectileFor, actionStyle, PARTY_DASH_MS,
  GRADIENT_SWELL_LEAD,
} from './choreo.js';
import { FreeAim } from './freeAim.js';
import { BattleHud, keyCaps } from './hud.js';

const DATA = Object.freeze({ ENEMIES, SKILLS, ITEMS, CHARACTERS, DIFFICULTY });

/** Hit-stop lengths (real ms) — SPEC §3.2 feel. The *Rapid lengths apply inside a steady rhythm (see RHYTHM_GAP). */
const HITSTOP = Object.freeze({ parry: 70, parryRapid: 35, gradient: 150, gradientRapid: 90, perfect: 50, crit: 40, break: 120 });
const HITSTOP_SCALE = 0.05;
/** A defended hit followed by another within this gap (world ms) gets the short hit-stop so the rhythm holds. */
const RHYTHM_GAP = Object.freeze({ parry: 420, gradient: 600 });
/** How long a boss's phase banner stays up (ms); the phase dialogue opens once it has played out. */
const PHASE_BANNER_MS = 2600;
/** Watchdog margins (battle ms past a run's scheduled end) — battle time stops while hidden, paused or in a modal. */
const ENEMY_WATCHDOG_MS = 7500;
const PARTY_WATCHDOG_MS = 9000;
/** Default jump (SPEC feel): 560 ms from the crouch (p 0.15) to rest; airborne while 0.2 < p < 0.86 (sprites.js). */
const JUMP = Object.freeze({ dur: 560, p0: 0.15, airFrom: 0.2, airTo: 0.86, landP: 0.762 });
const JUMP_RATE = (1 - JUMP.p0) / JUMP.dur;
/** Friendly names of the defense actions (touch buttons use the same words). */
const DEFENSE_NAMES = Object.freeze({ parry: 'Parry', dodge: 'Dodge', jump: 'Jump', gradient: 'Counter' });
/** Lead (ms) that lands the Prism telegraph swell's climax on the hit, from the SFX's measured envelope. */
const SWELL_LEAD = Number.isFinite(SFX_INFO?.telegraph_gradient?.climax) ? SFX_INFO.telegraph_gradient.climax * 1000 : GRADIENT_SWELL_LEAD;

const HINT_TITLES = {
  firstTurn: 'Your Turn', ap: 'Action Points', skills: 'Skills', qte: 'Timed Hits', parry: 'Parry', dodge: 'Dodge',
  jump: 'Jump', unparryable: 'Unparryable Strikes', gradientHit: 'Prism Attacks', counter: 'Counterattacks',
  freeAim: 'Free Aim', shields: 'Shields', break: 'Break', gradientMeter: 'The Prism Gauge', stances: "Sable's Stances",
  glyphs: "Nyra's Glyphs", surge: "Gideon's Surge",
};

const OUTCOME_TEXT = {
  parry: { text: 'PARRY', color: PALETTE.paleGold, size: 30 },
  perfectDodge: { text: 'PERFECT DODGE', color: '#c9f0ff', size: 24 },
  dodge: { text: 'DODGE', color: '#dff3ff', size: 22 },
  jump: { text: 'JUMP', color: HIT_TYPE_COLORS.jump, size: 24 },
  gradient: { text: 'COUNTER', color: '#e3c2ff', size: 28 },
};

const ELEMENT_SFX = new Set(['fire', 'ice', 'lightning', 'earth', 'light', 'dark']);
const PARTY_TARGETS = new Set(['ally', 'allAllies', 'self', 'deadAlly']);
const ENEMY_TARGETS = new Set(['enemy', 'allEnemies', 'randomEnemies']);

function burstKindFor(element) {
  return ELEMENT_SFX.has(element) ? element : 'physical';
}

/**
 * The battle scene. Params (SPEC §4.11): { encounterId?, enemies, zone, ambush, boss, practice, tutorial, spawnId?,
 * onEnd(result), state? (a temporary GameState, e.g. training from the title), seed? }.
 * Result: { outcome:'victory'|'defeat'|'fled', summary, rewards }.
 */
export class BattleScene extends Scene {
  constructor(game) {
    super(game);
    this.transparent = false;
    this.model = null;
    this.alive = false;
  }

  // ================================================================ lifecycle

  enter(params = {}) {
    const game = this.game;
    this.params = params;
    this.alive = true;
    this.encounter = params.encounterId ? ENCOUNTERS[params.encounterId] ?? null : null;
    const enemyList = Array.isArray(params.enemies) && params.enemies.length ? params.enemies : this.encounter?.enemies ?? ['dummy'];
    this.enemyList = enemyList;
    const firstEnemy = ENEMIES[typeof enemyList[0] === 'string' ? enemyList[0] : enemyList[0]?.id];
    this.zone = params.zone || this.encounter?.zone || firstEnemy?.zone || 'shore';
    this.practice = !!(params.practice ?? (params.encounterId === 'training_dummy'));
    this.tutorial = !!(params.tutorial ?? this.encounter?.tutorial);
    const bossFlag = params.boss ?? this.encounter?.boss;
    this.boss = !!(bossFlag || enemyList.some((e) => ENEMIES[typeof e === 'string' ? e : e?.id]?.boss));
    this.ambush = params.ambush === 'party' || params.ambush === 'enemy' ? params.ambush : null;
    this.state = params.state || game.state || null;
    if (!this.state) this.state = createNewGame({ seed: 69 });
    this.settings = game.settings ?? {};
    this.difficulty = DIFFICULTY[this.settings.difficulty] ? this.settings.difficulty : 'expeditioner';
    const seed = Number.isFinite(Number(params.seed)) && params.seed !== null && params.seed !== '' ? Number(params.seed)
      : ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
    this.seed = seed;
    this.rng = new RNG(seed);
    this.auxRng = new RNG((seed ^ 0x5bd1e995) >>> 0);

    this.model = new BattleModel({
      party: toBattleParty(this.state),
      enemies: enemyList,
      rng: this.rng,
      difficulty: this.difficulty,
      ambush: this.ambush,
      practice: this.practice,
      data: DATA,
      boss: this.boss,
      tutorial: this.tutorial,
      items: this.state.items,
    });
    const colorOf = (key) => CHARACTERS[key]?.color ?? PALETTE.gold;
    for (const m of this.model.party) m.color = colorOf(m.key);

    // Views.
    this.views = new Map();
    const loneBoss = this.model.enemies.length === 1 && this.model.enemies[0].boss;
    this.model.combatants.forEach((c, i) => {
      const home = slotPosition(c.side, c.slot, { loneBoss: loneBoss && c.side === 'enemy' });
      const v = new ActorView({ id: c.id, look: c.look, side: c.side, home, scale: c.side === 'enemy' ? c.scale ?? 1 : 1, seed: i * 17.3 + 3 });
      v.mechanic = c.mechanic;
      v._lastMech = c.mechanic ? JSON.stringify(c.mechanic) : null;
      if (!c.alive) v.play('ko', { dur: 1, p0: 1, p1: 1, hold: true });
      const ha = v.homeAnchors();
      v.barY = ha.top.y - 24;
      v.headY = ha.head.y;
      this.views.set(c.id, v);
    });

    // Rendering + timing.
    this.fx = new Effects({ reducedFlashing: !!this.settings.reducedFlashing, screenShake: this.settings.screenShake !== false });
    this.camera = new BattleCamera();
    this.clock = new AttackClock(game.time, { scale: 1, localStart: 0 });
    this._clockScale = 1;
    this.baseScale = 1;
    this.worldTime = 0;
    this.worldDt = 0;
    this._lastReal = game.time;
    this._hitStopUntil = -Infinity;
    this._timers = [];
    this._polls = [];
    this.bgPhase = 0;
    this._bgPhaseTarget = 0;
    this._ringRuns = [];
    this._waveLanes = [];
    this.enemyRun = null;
    this.partyRun = null;
    this.freeAimCtl = null;
    this.menu = null;
    this.modal = null;
    this.mode = 'intro';
    this.currentId = null;
    this.partyTurnCount = 0;
    this.enemyAttackCount = 0;
    this.attackTargets = null;
    this.practiceChoice = null;
    this.practiceLog = [];
    this.sessionHints = new Set();
    this.knownAff = {};
    this.lastRoot = {};
    this.lastEnemyTarget = null;
    this._errors = 0;
    this._finished = false;
    this._lastTele = -1e9;
    this._pendingDialogue = null;
    this._hiddenFreeze = false;
    this._lockSent = null;
    this.perf = { frames: 0, update: 0, render: 0, worst: 0, avgFrame: 16.7 };
    resetEnemyBars();

    // HUD.
    this.hud = new BattleHud(game, {
      onMenuClick: (i) => this._menuClick(i),
      onMenuHover: (i) => this._menuHover(i),
      onListClick: (i) => this._listClick(i),
      onListHover: (i) => this._listHover(i),
      onHintClose: () => this._closeModal('hint'),
      onPauseClick: (i) => this._pauseClick(i),
      onPauseHover: (i) => this._pauseHover(i),
      onResultsClose: () => this._closeModal('results'),
      onTouch: (action, down, stamp) => {
        if (!down) {
          game.input.virtualRelease(action);
          return;
        }
        // The pointer event's own timeStamp is when the finger landed, which is what the timing judge should see
        // (virtualPress falls back to "now" when the stamp is missing or implausible).
        const now = globalThis.performance?.now?.() ?? 0;
        const ok = Number.isFinite(stamp) && stamp > 0 && stamp <= now && now - stamp < 250;
        game.input.virtualPress(action, 'touch', ok ? stamp : undefined);
      },
      onPracticeCycle: (d) => this._cyclePractice(d),
    });
    // The battle is a full-screen scene: DOM left mounted by the scene underneath (e.g. a world HUD) must not
    // show through. Hide what is there now; overlays pushed later (dialogue, settings) stack above the HUD.
    this._hiddenUi = [];
    for (const el of [...(game.uiRoot?.children ?? [])]) {
      // The shared toast host belongs to no scene (UI toasts raised from an overlay above the battle use it).
      if (el.classList?.contains('toasts')) continue;
      if (el.style && el.style.visibility !== 'hidden') {
        this._hiddenUi.push([el, el.style.visibility]);
        el.style.visibility = 'hidden';
      }
    }
    this.hud.mount(this);
    this.hud.showFrame(false);
    // A hidden page freezes the battle clock at the last frame (nothing lands or times out while the player is away);
    // a device switch re-renders the menus' help lines (touch gets tap wording instead of key caps).
    this._offVisibility = game.events?.on?.('visibility', (visible) => this._onVisibility(visible)) ?? null;
    this._offDevice = game.input?.events?.on?.('device', () => this._onDeviceChange()) ?? null;

    // Background + music.
    try {
      prepareBattleBackground(this.zone, { scale: (game.canvas?.width ?? 1280) / 1280 });
      if (this.zone === 'summit' && this.model.enemies.some((e) => e.phases?.length)) {
        prepareBattleBackground(this.zone, { scale: (game.canvas?.width ?? 1280) / 1280, phase: 1 });
      }
    } catch (err) {
      console.warn('[battle] background prepare failed', err);
    }
    const hasFinal = this.model.enemies.some((e) => e.key === 'stillkeeper');
    this.music = this.encounter?.music || (this.practice ? 'training' : hasFinal ? 'final' : this.boss ? 'boss' : 'battle');
    this._audio((a) => a.playMusic(this.music, { fade: 400 }));

    if (this.practice) {
      const dummy = this.model.enemies[0];
      this.practiceAttacks = dummy ? Object.keys(dummy.attacks ?? {}) : [];
    }

    // Debug handle for tools / benches.
    this.debug = {
      scene: this,
      upcomingHits: () => this._debugUpcomingHits(),
      state: () => this._debugState(),
    };
    try { if (game.debug) game.debug.battle = this.debug; } catch { /* ignore */ }

    this._flow = this._main().catch((err) => this._crash(err));
  }

  exit() {
    this.alive = false;
    this._timers = [];
    this._polls = [];
    try { this._offVisibility?.(); } catch { /* ignore */ }
    try { this._offDevice?.(); } catch { /* ignore */ }
    this._offVisibility = null;
    this._offDevice = null;
    this.enemyRun?.releaseBystanders?.();
    this.hud?.destroy();
    for (const [el, vis] of this._hiddenUi ?? []) {
      try { el.style.visibility = vis; } catch { /* element gone */ }
    }
    this._hiddenUi = [];
    try {
      if (this.game.debug?.battle === this.debug) delete this.game.debug.battle;
    } catch { /* ignore */ }
    for (const a of DEFENSE_ACTIONS) this.game.input?.virtualRelease?.(a);
  }

  pause() {
    this._setClockScale(0);
    this._pausedByScene = true;
  }

  resume() {
    this._pausedByScene = false;
    this._lastReal = this.game.time;
    this.settings = this.game.settings ?? this.settings;
    this._setClockScale(this._wantScale());
    this.hud?.refreshLabels();
    if (this._pendingDialogue) {
      const r = this._pendingDialogue;
      this._pendingDialogue = null;
      r();
    }
  }

  // ================================================================ clock & tasks

  /**
   * Battle-clock speed wanted at real time `realT`: 0 while the scene is covered, a modal is up or the page is hidden,
   * the hit-stop crawl while a hit-stop runs, otherwise the base speed (the tutorial's slow motion).
   */
  _wantScale(realT = this.game.time) {
    if (this._pausedByScene || this._hiddenFreeze) return 0;
    if (this.modal && this.modal.kind !== 'results') return 0;
    if (realT < this._hitStopUntil) return HITSTOP_SCALE * this.baseScale;
    return this.baseScale;
  }

  _setClockScale(s, realAt = this.game.time) {
    if (s === this._clockScale) return;
    this.clock.setScale(s, realAt);
    this._clockScale = s;
  }

  _tickClock() {
    const now = this.game.time;
    const gap = now - this._lastReal;
    if (gap > 250) {
      // Long stall (debugger, a throttled background tab that never reported 'hidden'): don't let the clock leap.
      const s = this._clockScale;
      this.clock.setScale(0, this._lastReal + 17);
      this.clock.setScale(s, now);
    }
    this._lastReal = now;
    // A hit-stop ends at its exact real time, not on the first frame after it, so its length (and every rhythm it
    // sits in) is the same at any frame rate.
    const hs = HITSTOP_SCALE * this.baseScale;
    if (this._clockScale === hs && now >= this._hitStopUntil) this._setClockScale(this._wantScale(this._hitStopUntil), this._hitStopUntil);
    this._setClockScale(this._wantScale());
    const w = this.clock.toLocal(now);
    this.worldDt = Math.max(0, Math.min(100, w - this.worldTime));
    this.worldTime = w;
  }

  _onVisibility(visible) {
    if (!this.alive) return;
    if (!visible) {
      // Freeze at the last rendered frame: while the page is away no hit lands, no watchdog runs and no lockout ends.
      this._hiddenFreeze = true;
      this._setClockScale(0);
    } else {
      this._hiddenFreeze = false; // the next frame restores the speed from its own timestamp
    }
  }

  /** World time of a real (performance.now) timestamp. */
  worldAt(realT) {
    return this.clock.toLocal(realT);
  }

  /** Rebase the clock between turns so its segment list stays short. */
  _rebaseClock() {
    const w = this.worldTime;
    this.clock = new AttackClock(this.game.time, { scale: this._clockScale, localStart: w });
  }

  hitStop(ms) {
    if (!(ms > 0)) return;
    this._hitStopUntil = Math.max(this._hitStopUntil, this.game.time + ms);
    this._setClockScale(this._wantScale());
  }

  _wait(ms) {
    return new Promise((res) => this._timers.push({ at: this.worldTime + Math.max(0, ms), res, real: false }));
  }

  _waitReal(ms) {
    return new Promise((res) => this._timers.push({ at: this.game.time + Math.max(0, ms), res, real: true }));
  }

  _after(ms, fn) {
    this._timers.push({ at: this.worldTime + Math.max(0, ms), res: fn, real: false });
  }

  /**
   * Resolve (with true) once fn() is truthy, or with false after `timeoutWorld` ms of battle time. Watchdogs use
   * battle time so a hidden tab, a pause, a hint or a story dialogue never counts towards them.
   */
  _until(fn, timeoutWorld = Infinity) {
    return new Promise((res) => this._polls.push({ fn, res, deadline: this.worldTime + timeoutWorld }));
  }

  _tickTasks() {
    if (this._timers.length) {
      const due = [];
      this._timers = this._timers.filter((t) => {
        const ok = t.real ? this.game.time >= t.at : this.worldTime >= t.at;
        if (ok) due.push(t);
        return !ok;
      });
      for (const t of due) {
        try { t.res(); } catch (err) { this.game.reportError(this, 'battle timer', err); }
      }
    }
    if (this._polls.length) {
      const due = [];
      this._polls = this._polls.filter((p) => {
        let ok = false;
        try { ok = !!p.fn(); } catch (err) { this.game.reportError(this, 'battle poll', err); ok = true; }
        const timeout = this.worldTime >= p.deadline;
        if (ok || timeout) due.push({ p, ok });
        return !(ok || timeout);
      });
      for (const { p, ok } of due) p.res(ok);
    }
  }

  // ================================================================ helpers

  _audio(fn) {
    const a = this.game.audio;
    if (!a) return;
    try { fn(a); } catch (err) { console.warn('[battle] audio call failed', err); }
  }

  sfx(name, opts = {}) {
    this._audio((a) => a.play(name, opts));
  }

  _pan(x) {
    return clamp(((x - 640) / 640) * 0.6, -0.8, 0.8);
  }

  autopilot() {
    const ap = this.game.debug?.autopilot;
    return ap && typeof ap === 'object' ? ap : null;
  }

  get calibration() {
    return Number(this.game.settings?.inputOffset) || 0;
  }

  _label(action) {
    return this.game.input?.keyLabel?.(action) ?? action;
  }

  _cueLabel(type) {
    const L = (a) => this._label(a);
    if (type === 'unparryable') return L('dodge');
    if (type === 'jump') return L('jump');
    if (type === 'gradient') return L('gradient');
    return `${L('parry')} · ${L('dodge')}`;
  }

  _hintSeen(key) {
    return !!(this.state?.world?.hintsSeen?.[key]) || this.sessionHints.has(key);
  }

  _markHint(key) {
    this.sessionHints.add(key);
    const w = this.state?.world;
    if (w) {
      if (!w.hintsSeen || typeof w.hintsSeen !== 'object') w.hintsSeen = {};
      w.hintsSeen[key] = true;
    }
  }

  _viewAnchors(id) {
    const v = this.views.get(id);
    return v ? v.anchors(this.worldTime) : null;
  }

  _feedback() {
    return !!(this.settings?.showTimingFeedback || this.practice);
  }

  // ================================================================ main flow

  async _main() {
    await this._intro();
    let guard = 0;
    while (this.alive && !this.model.outcome() && guard++ < 5000) {
      try {
        await this._turn();
      } catch (err) {
        this._recover(err);
      }
    }
    if (!this.alive) return;
    await this._conclude();
  }

  _recover(err) {
    this._errors += 1;
    this.game.reportError(this, 'battle turn', err);
    this.enemyRun?.releaseBystanders?.();
    this.enemyRun = null;
    this.partyRun?.release();
    this.partyRun = null;
    this.freeAimCtl = null;
    this.menu = null;
    this.hud.hideMenu();
    this.hud.hideList();
    this.hud.hideTarget();
    this.hud.setInfo(null);
    this.hud.setFreeAim(null);
    for (const v of this.views.values()) {
      v.forced = null;
      v.aura = null;
      v.vivid = false;
      if (this.model.get(v.id)?.alive) v.goHome();
    }
    this.fx.desaturate(0);
    try {
      if (this.model.turn.actorId && !this.model.turn.ended) this.model.endTurn(this.model.turn.actorId);
    } catch { /* ignore */ }
    if (this._errors > 8 && !this.model.outcome()) this.model.endBattle('fled');
  }

  _crash(err) {
    this.game.reportError(this, 'battle flow', err);
    if (!this.alive || this._finished) return;
    try {
      if (!this.model.outcome()) this.model.endBattle('fled');
    } catch { /* ignore */ }
    this._finish({ outcome: this.model?.outcome?.() ?? 'fled', summary: this.model?.summary?.() ?? null, rewards: null });
  }

  async _intro() {
    this.mode = 'intro';
    const cam = this.camera;
    cam.snap(820, 330, 1.18);
    cam.focus(640, 360, 1, 1300);
    this.sfx('encounter');
    let i = 0;
    for (const v of this.views.values()) {
      if (v.side === 'enemy') {
        v.alpha = 0;
        v.fadeIn = { t0: this.worldTime + 120 + i * 150, dur: 650 };
        i += 1;
      } else if (this.model.get(v.id)?.alive) {
        v.x = v.home.x - 190;
        v.play('run', { loop: true, dur: 560 });
        v.moveTo(v.home.x, v.home.y, 720 + v.home.y * 0.25, 'outQuad');
      }
    }
    await this._wait(360);
    const enemyNames = [...new Set(this.model.enemies.map((e) => e.baseName ?? e.name))].join(' · ');
    if (this.ambush === 'party') {
      this.fx.banner('First Strike!', { sub: 'The expedition seizes the initiative', color: PALETTE.gold, life: 1700 });
    } else if (this.ambush === 'enemy') {
      this.fx.banner('Ambushed!', { sub: 'The Gloam strikes first', color: '#e0553d', life: 1700 });
      this.fx.vignette(PALETTE.crimson, 900, 0.45);
    } else if (this.boss) {
      const b = this.model.enemies.find((e) => e.boss) ?? this.model.enemies[0];
      this.fx.banner(b?.name ?? 'Boss', { sub: STORY.zoneTitles?.[this.zone] ?? '', style: 'title', color: PALETTE.paleGold, life: 2200 });
    } else if (this.practice) {
      this.fx.banner('Practice Bout', { sub: 'Nobody can fall here', style: 'caption', life: 1800 });
    } else {
      this.fx.banner(this.encounter?.name ?? enemyNames, { sub: enemyNames !== this.encounter?.name ? enemyNames : '', style: 'caption', life: 1800 });
    }
    await this._wait(this.boss ? 1350 : 950);
    for (const v of this.views.values()) if (v.side === 'party' && this.model.get(v.id)?.alive) {
      v.goHome();
      v.play('idle', { loop: true, dur: 1000 });
    }
    this.hud.showFrame(true);
    await this._playEvents(this.model.startEvents, { silentAp: true });
    await this._wait(180);
  }

  async _turn() {
    this._rebaseClock();
    const t = this.model.nextTurn();
    if (t.over || !t.actorId) return;
    this.currentId = t.actorId;
    await this._playEvents(t.events, { turnStart: true });
    if (t.skipped) {
      await this._wait(t.reason === 'ko' ? 500 : 750);
      this.currentId = null;
      return;
    }
    if (this.model.outcome()) return;
    const actor = this.model.get(t.actorId);
    if (actor.side === 'party') await this._partyTurn(actor);
    else await this._enemyTurn(actor);
    if (!this.alive) return;
    if (!this.model.outcome()) {
      const ev = this.model.endTurn(t.actorId);
      await this._playEvents(ev);
    }
    this.currentId = null;
  }

  // ================================================================ party turn

  async _partyTurn(actor) {
    this.partyTurnCount += 1;
    this.turnCtx = { actorId: actor.id, autoAimed: false };
    this.camera.focus(632, 356, 1.02, 700);
    this.sfx('menu_open', { volume: 0.6 });
    for (let loop = 0; loop < 200 && this.alive; loop++) {
      if (this.model.outcome() || !actor.alive) return;
      await this._menuHints(actor);
      if (!this.alive) return;
      const choice = await this._openMenu(actor);
      if (!this.alive || !choice) return;
      if (choice.kind === 'freeAim') {
        await this._freeAim(actor, choice);
        continue;
      }
      if (choice.kind === 'practiceAttack') {
        await this._practiceAttack(actor);
        continue;
      }
      if (choice.kind === 'leavePractice') {
        this.model.endBattle('victory');
        return;
      }
      const plan = this.model.beginAction(actor.id, choice.action);
      if (!plan || plan.error) {
        this.hud.toast(plan?.error ?? 'That cannot be done');
        this.sfx('ui_error');
        continue;
      }
      await this._executePlan(actor, plan);
      if (plan.endsTurn || this.model.outcome()) return;
    }
  }

  async _menuHints(actor) {
    const m = this.model;
    const enemies = m.living('enemy');
    const seen = (k) => this._hintSeen(k);
    let key = null;
    if (!seen('firstTurn')) key = 'firstTurn';
    else if (!seen('ap') && this.partyTurnCount >= 2) key = 'ap';
    else if (!seen('skills') && this.partyTurnCount >= 3 && m.getCommands(actor.id).skills.some((s) => s.usable)) key = 'skills';
    else if (!seen('shields') && enemies.some((e) => e.shields > 0)) key = 'shields';
    else if (!seen('gradientMeter') && m.gradientCharges() >= 1) key = 'gradientMeter';
    else if (!seen('break') && enemies.some((e) => e.broken || (e.breakMax > 0 && e.breakValue >= e.breakMax * 0.4))) key = 'break';
    else if (actor.key === 'gideon' && !seen('surge') && this.partyTurnCount >= 2) key = 'surge';
    else if (actor.key === 'nyra' && !seen('glyphs') && this.partyTurnCount >= 2) key = 'glyphs';
    else if (actor.key === 'sable' && !seen('stances') && this.partyTurnCount >= 2) key = 'stances';
    else if (!seen('freeAim') && this.partyTurnCount >= 4 && enemies.some((e) => e.weakPoints?.length) && actor.ap >= 1) key = 'freeAim';
    if (key) await this._hint(key);
  }

  async _executePlan(actor, plan) {
    const view = this.views.get(actor.id);
    this.mode = 'action';
    this.hud.setInfo(null);
    await this._playEvents(plan.events, { source: actor.id, silentAp: true });
    if (plan.kind === 'flee') {
      await this._flee(plan);
      return;
    }
    const style = actionStyle(plan, actor.key);
    if (plan.hits.some((h) => h.qte) && !this._hintSeen('qte')) await this._hint('qte');
    const gradient = plan.kind === 'gradient';
    if (gradient) {
      this.fx.desaturate(0.72);
      this.fx.vignette(PALETTE.violet, 2200, 0.55);
      this.fx.banner(plan.name, { sub: `${actor.name.split(' ')[0]} · Prism Skill`, color: '#d9b0ff', life: 1600 });
      this.sfx('gradient_skill');
      view.vivid = true;
      this.fx.burst(view.x, view.y - 70, 'gradient', { scale: 1.2 });
      await this._wait(520);
    } else if (plan.kind === 'skill') {
      this.fx.banner(plan.name, { style: 'caption', sub: actor.name.split(' ')[0], life: 1500 });
    } else if (plan.kind === 'item') {
      this.fx.banner(plan.name, { style: 'caption', life: 1200 });
    }
    // Camera.
    const tv = this.views.get(plan.targetIds[0]);
    if (tv && tv !== view) {
      const zoom = gradient ? 1.16 : style === 'melee' ? 1.08 : 1.04;
      this.camera.focusBetween(view.home, tv.home, zoom, 520, style === 'melee' ? 0.7 : 0.5);
    }
    const run = new PartyActionRun(this, plan, { difficulty: this.difficulty, calibration: this.calibration, style });
    run.t0 = this.worldTime;
    this.partyRun = run;
    this._ringRuns.push(run);
    view.forced = null;
    this.hud.showTouch(this._touchMode() && plan.hits.some((h) => h.qte) ? 'qte' : null);
    const ok = await this._until(() => run.hitsDone || !this.alive, run.endT + PARTY_WATCHDOG_MS);
    if (!ok && this.alive) {
      // A genuine stall (battle time ran well past the action): land what is left unrated rather than drop it.
      console.warn('[battle] party action watchdog fired after', Math.round(this.worldTime - run.t0), 'ms of battle time');
      run.abort();
    }
    this.partyRun = null;
    this.hud.showTouch(null);
    if (!this.alive) return;
    // Post effects.
    const fin = this.model.finishAction(plan);
    const phases = fin.filter((e) => e.type === 'phase');
    await this._playEvents(fin.filter((e) => e.type !== 'phase'), { source: actor.id, targets: plan.targetIds });
    run.release();
    if (style === 'melee' && actor.alive) await this._returnHome(view);
    else if (actor.alive) view.play('idle', { loop: true, dur: 1000 });
    if (gradient) {
      this.fx.desaturate(0);
      view.vivid = false;
    }
    if (phases.length) await this._playEvents(phases);
    this.camera.reset(700);
    await this._wait(plan.kind === 'shot' ? 0 : 260);
  }

  // ---------------------------------------------------------------- party action callbacks (PartyActionRun host)

  onPartyRelease(run, i) {
    const plan = run.plan;
    const view = run.actor;
    if (!view) return;
    const a = view.anchors(this.worldTime);
    const style = run.style;
    if (i < 0) {
      // Support skill / item: light travels to each ally (or blooms on the caster).
      const from = a.cast ?? a.weapon;
      const heal = (plan.effects ?? []).some((e) => e.type === 'heal' || e.type === 'revive');
      const col = plan.kind === 'item' ? PALETTE.paleGold : heal ? PALETTE.hpGood : ELEMENT_COLORS[plan.element] ?? PALETTE.paleGold;
      for (const id of plan.targetIds ?? []) {
        const tv = this.views.get(id);
        if (!tv) continue;
        const ta = tv.anchors(this.worldTime);
        if (tv === view) this.fx.burst(ta.chest.x, ta.chest.y, heal ? 'heal' : 'buff', { scale: 0.9 });
        else this.fx.projectile({ from, to: ta.chest, duration: 200, kind: plan.kind === 'item' ? 'orb' : 'glyph', color: col, arc: 60, size: 0.9 });
      }
      this.sfx(plan.kind === 'item' ? 'ui_confirm' : heal ? 'heal' : 'buff', { volume: 0.5 });
      return;
    }
    const hit = plan.hits[i];
    if (style === 'melee') {
      // Melee releases at T, the moment of contact: the slash lands now even if the rating (and with it the
      // damage number and the hurt reaction) only comes once the QTE window closes.
      this.sfx('swing', { volume: 0.55, pitch: 0.95 + this.auxRng.next() * 0.1, pan: this._pan(a.weapon.x) });
      const tv = this.views.get(hit.targetIds?.find((id) => this.model.get(id)?.alive) ?? hit.targetIds?.[0]);
      if (tv) {
        const ta = tv.anchors(this.worldTime);
        const col = ELEMENT_COLORS[hit.element] ?? '#ffffff';
        this.fx.slash(ta.chest.x - 8, ta.chest.y, { angle: -0.5 + this.auxRng.next() * 0.3 + (i % 2 ? 0.9 : 0), length: 130, color: col, life: 200, width: 9, flip: i % 2 === 1 });
      }
      return;
    }
    const from = a.cast ?? a.weapon;
    const glyph = run.actorKey === 'nyra';
    for (const id of hit.targetIds ?? []) {
      const tv = this.views.get(id);
      if (!tv || !this.model.get(id)?.alive) continue;
      const ta = tv.anchors(this.worldTime);
      const pk = style === 'shoot' ? { kind: 'bullet', color: PALETTE.paleGold } : projectileFor(hit.element, { glyph: glyph && hit.element !== 'lightning' });
      this.fx.projectile({
        from, to: ta.chest, duration: run.travel, kind: pk.kind, color: pk.color, arc: style === 'shoot' ? 0 : 26, size: plan.kind === 'gradient' ? 1.4 : 1,
        // It lands on T: a splash marks the contact before the rating resolves the damage.
        onArrive: ({ x, y }) => this.fx.sparks(x, y, { color: pk.color, count: 7, speed: 200, life: 220, gravity: 240, width: 3 }),
      });
      if (style === 'shoot') {
        this.fx.line(from.x, from.y, ta.chest.x, ta.chest.y, { color: PALETTE.paleGold, width: 2, life: 120 });
        this.sfx('shot', { volume: 0.7, pan: this._pan(from.x) });
      }
    }
    if (style !== 'shoot') this.sfx(ELEMENT_SFX.has(hit.element) ? hit.element : 'swing', { volume: 0.45, pan: this._pan(from.x) });
  }

  onPartyHit(run, i, rating, offset) {
    const plan = run.plan;
    const hit = plan.hits[i];
    const events = this.model.resolveHit(plan, i, rating);
    if (hit.qte) {
      const tId = run._ringTarget(hit);
      const ta = tId ? this._viewAnchors(tId) : null;
      if (rating === 'perfect') {
        this.sfx('qte_perfect');
        this.hitStop(HITSTOP.perfect);
        this.camera.punch(0.03);
        if (ta) this.fx.burst(ta.chest.x, ta.chest.y, 'perfect', { scale: 0.8 });
      } else if (rating === 'good') this.sfx('qte_good');
      else this.sfx('qte_miss', { volume: 0.7 });
      if (ta && this._feedback() && Number.isFinite(offset)) {
        this.fx.text(ta.chest.x, ta.chest.y + 66, describeOffset(offset), { size: 15, color: PALETTE.parchment, life: 900, rise: 18 });
      }
    }
    this._playEvents(events, { source: plan.actorId, hit });
    if (this.model.outcome()) run.pruneDeadTargets();
  }

  // ---------------------------------------------------------------- free aim

  async _freeAim(actor, choice) {
    if (!this._hintSeen('freeAim')) await this._hint('freeAim');
    if (!this.alive) return;
    this.mode = 'freeaim';
    const ctl = new FreeAim({
      game: this.game, model: this.model, views: this.views, camera: this.camera, fx: this.fx,
      sfx: (n, o) => this.sfx(n, o), playEvents: (e, o) => this._playEvents(e, o), toast: (t) => this.hud.toast(t),
      get worldTime() { return this._scene.worldTime; }, _scene: this,
    }, actor.id);
    this.freeAimCtl = ctl;
    this.camera.focus(820, 330, 1.08, 600);
    if (choice.auto) {
      this.turnCtx.autoAimed = true;
      await this._wait(320);
      const pick = this._autoWeakPoint();
      if (pick) ctl.aimAt(pick.x, pick.y);
      await this._wait(360);
      if (this.alive && ctl.active && actor.ap >= 1) ctl.fire();
      await this._wait(520);
      ctl.active = false;
    } else {
      await this._until(() => !ctl.active || !this.alive);
    }
    ctl.exit();
    this.freeAimCtl = null;
    this.hud.setFreeAim(null);
    this.camera.reset(600);
    // A shot that crossed a boss phase ended the session; its story beat plays now, before the next command, so it
    // never lands in the middle of an action.
    if (ctl.deferred.length && this.alive) await this._playEvents(ctl.deferred.splice(0));
    this.mode = 'menu';
    await this._wait(120);
  }

  _autoWeakPoint() {
    const ctl = this.freeAimCtl;
    if (!ctl) return null;
    let best = null;
    for (const t of ctl.targets()) {
      for (const w of t.weak) {
        let score = w.effect === 'crit' ? 2 : w.effect === 'break' ? 1.5 : 1;
        if (w.effect === 'shield' && t.combatant.shields > 0) score = 3;
        score += (1 - t.combatant.hp / t.combatant.stats.maxHp) * 0.5;
        if (!best || score > best.score) best = { score, x: w.x, y: w.y };
      }
    }
    return best;
  }

  // ================================================================ enemy turn

  async _enemyTurn(enemy) {
    let plan;
    if (this.practice && this.practiceChoice && enemy.key === 'dummy') plan = this._planForced(enemy.id, this.practiceChoice);
    else plan = this.model.planEnemyAction(enemy.id);
    await this._playEvents(plan.events);
    if (plan.error || this.model.outcome() || !enemy.alive) return;
    await this._runEnemyPlan(plan);
  }

  /**
   * Plan one specific attack (practice drills, tooling). Every pool the AI could read is narrowed to it — the base
   * pool and each phase's (planEnemyAction may even enter a new phase first) — then restored untouched.
   */
  _planForced(enemyId, attackId) {
    const e = this.model.get(enemyId);
    if (!e || !e.attacks?.[attackId]) return this.model.planEnemyAction(enemyId);
    const { pool, phases } = e;
    const last = { ...e.lastUsed };
    e.pool = [attackId];
    if (Array.isArray(phases)) e.phases = phases.map((ph) => ({ ...ph, pool: [attackId] }));
    e.lastUsed = {};
    let plan;
    try {
      plan = this.model.planEnemyAction(enemyId);
    } finally {
      e.pool = pool;
      if (Array.isArray(phases)) e.phases = phases;
      e.lastUsed = { ...last, [attackId]: e.turnsTaken };
    }
    return plan;
  }

  async _practiceAttack(actor) {
    const dummy = this.model.living('enemy')[0];
    if (!dummy) return;
    const plan = this.practiceChoice ? this._planForced(dummy.id, this.practiceChoice) : this.model.planEnemyAction(dummy.id);
    if (plan.error) return;
    // Aim single / multi attacks at whoever asked for the drill.
    if (plan.attack?.target !== 'all') {
      for (const h of plan.hits) h.targetIds = [actor.id];
      plan.targetIds = [actor.id];
    }
    await this._runEnemyPlan(plan);
    this.mode = 'menu';
  }

  async _runEnemyPlan(plan) {
    const attacker = this.views.get(plan.actorId);
    const enemy = this.model.get(plan.actorId);
    this.mode = 'enemy';
    this.enemyAttackCount += 1;
    this.attackTargets = plan.targetIds?.length ? [...plan.targetIds] : null;
    this.hud.showLegend(plan.hits.length > 0);
    this.hud.showTouch(this._touchMode() && plan.hits.length ? 'defense' : null);
    const dur = Math.max(1400, Math.min(3400, (plan.duration ?? 1500) + 400));
    this.fx.banner(plan.name, { style: 'caption', sub: enemy?.name ?? '', life: dur, color: plan.hits.some((h) => h.type === 'gradient') ? '#d9b0ff' : PALETTE.gold });
    // Hints for new hit types, before the clock starts.
    if (plan.hits.length) {
      const types = new Set(plan.hits.map((h) => h.type));
      const queue = [];
      if (types.has('gradient') && !this._hintSeen('gradientHit')) queue.push('gradientHit');
      if (types.has('unparryable') && !this._hintSeen('unparryable')) queue.push('unparryable');
      if (types.has('jump') && !this._hintSeen('jump')) queue.push('jump');
      if (types.has('normal') && !this._hintSeen('parry')) queue.push('parry');
      else if (types.has('normal') && !this._hintSeen('dodge') && this.enemyAttackCount >= 2) queue.push('dodge');
      for (const k of queue.slice(0, 2)) await this._hint(k);
      if (!this.alive) return;
    }
    const tv = this.views.get(plan.targetIds?.[0]);
    if (attacker && tv) this.camera.focusBetween(attacker.home, tv.home, 1.05, 700, 0.42);
    else this.camera.reset(600);
    await this._wait(plan.hits.length ? 420 : 200);
    if (!this.alive) return;
    const slow = this.tutorial && !this._tutorialSlowDone && plan.hits.length > 0;
    if (slow) {
      this._tutorialSlowDone = true;
      this.baseScale = 0.6;
      this._setClockScale(this._wantScale());
    }
    const run = new EnemyAttackRun(this, plan, {
      difficulty: this.difficulty, calibration: this.calibration, rng: () => this.auxRng.next(), swellLead: SWELL_LEAD,
    });
    run.t0 = this.worldTime;
    run.log = [];
    this.enemyRun = run;
    this._lockSent = null;
    const ok = await this._until(() => run.done || !this.alive, run.endT + ENEMY_WATCHDOG_MS);
    if (!ok && this.alive && !run.done) {
      // A genuine stall only: battle time stops while the page is hidden, paused or in a dialogue. Whatever is left
      // is voided (no damage), never forced through as unanswered hits.
      const voided = run.abort();
      console.warn('[battle] enemy attack watchdog fired after', Math.round(this.worldTime - run.t0), 'ms of battle time; voided hits', voided);
    }
    run.releaseBystanders();
    this.enemyRun = null;
    this.attackTargets = null;
    if (slow) {
      this.baseScale = 1;
      this._setClockScale(this._wantScale());
    }
    this.hud.showLegend(false);
    this.hud.showTouch(null);
    this.hud.setLegendLocked(false);
    this.fx.desaturate(0);
    if (!this.alive) return;
    if (this.practice) {
      this.practiceLog = run.log.slice(-6);
    }
    // Counters.
    if (!this.model.outcome()) {
      const counters = this.model.resolveCounters(plan);
      for (let k = 0; k < counters.length && this.alive; k++) await this._animateCounter(counters[k], run, k === 0);
      if (counters.length && !this._hintSeen('counter')) {
        await this._wait(250);
        await this._hint('counter');
      }
      // The tutorial teaches the safer option right after the first real attack.
      if (this.tutorial && plan.hits.some((h) => h.type === 'normal') && !this._hintSeen('dodge')) {
        await this._wait(200);
        await this._hint('dodge');
      }
    }
    if (!this.alive) return;
    // Return and finish.
    if (run.melee && attacker && enemy?.alive) await this._returnHome(attacker, 420);
    else if (attacker && enemy?.alive) {
      attacker.forced = null;
      attacker.play('idle', { loop: true, dur: 1000 });
    }
    const fin = this.model.finishEnemyAction(plan);
    await this._playEvents(fin, { source: plan.actorId, targets: plan.targetIds });
    if (!plan.hits.length && fin.length) await this._wait(420);
    this.camera.reset(700);
    await this._wait(220);
  }

  async _animateCounter(c, run, first) {
    const mv = this.views.get(c.counterId);
    const ev = this.views.get(c.targetId);
    const member = this.model.get(c.counterId);
    if (!mv || !ev || !member) return;
    if (first) {
      this.fx.banner('Counter!', { color: '#ff8a70', life: 1100 });
      this.sfx('counter');
    }
    const reach = halfWidth(ev) + halfWidth(mv) + 30;
    const tx = ev.x - reach;
    const far = Math.abs(mv.x - tx) > 80;
    const variant = member.basicAttack?.anim === 'cast' ? 'slash' : member.basicAttack?.anim ?? 'slash';
    if (far) {
      mv.facing = 1;
      mv.play('run', { loop: true, dur: 560 });
      mv.moveTo(tx, ev.y + 1, PARTY_DASH_MS * 0.7, 'inOutQuad');
      await this._wait(PARTY_DASH_MS * 0.7);
    }
    mv.play('windup', { variant, dur: 150 });
    await this._wait(150);
    mv.play('strike', { variant, dur: 320 });
    const ea = ev.anchors(this.worldTime);
    this.fx.slash(ea.chest.x, ea.chest.y, { angle: -0.6, length: 150, color: '#ffb08a', width: 11, life: 220 });
    this.fx.burst(ea.chest.x, ea.chest.y, 'counter', { dir: 1 });
    this._playEvents(c.events.filter((e) => e.type !== 'counter'), { source: c.counterId });
    await this._wait(330);
    if (far && member.alive) await this._returnHome(mv, 340);
    else if (member.alive) mv.play('idle', { loop: true, dur: 1000 });
  }

  // ---------------------------------------------------------------- enemy run callbacks (EnemyAttackRun host)

  onDefensePress(run, action, verdict, localT) {
    const hi = run.focusHit(verdict);
    const hit = run.hits[hi];
    const defenders = [];
    for (const id of hit?.targetIds ?? []) {
      const v = this.views.get(id);
      if (!v || !this.model.get(id)?.alive) continue;
      defenders.push(v);
      this._startDefenseAnim(v, action);
    }
    if (verdict.reason === 'whiff') this._defenseWhiff(run, action, verdict, localT, defenders);
  }

  /**
   * A press that claimed nothing locks defense input (qte.js LOCKOUT). Always say so where the player is looking —
   * "Too early — locked" (or late / feint) over the defender, a lockout ring on them, the touch buttons greyed — and
   * keep the millisecond readout behind the timing-feedback setting.
   */
  _defenseWhiff(run, action, verdict, localT, defenders) {
    const feint = verdict.feintHit !== undefined;
    const near = run.nearestHit(localT);
    const late = !feint && near && near.offset > 0;
    const until = verdict.lockedUntil ?? localT;
    run.lock = { from: localT, until, action, ids: defenders.map((v) => v.id) };
    this._sendLockout(run, true);
    this.sfx('whiff', { volume: 0.45 });
    const v = defenders[0];
    if (v) {
      const a = v.anchors(this.worldTime);
      const life = Math.max(600, until - localT + 260);
      const label = feint ? 'Feint — locked' : late ? 'Too late — locked' : 'Too early — locked';
      this.fx.text(a.head.x, a.head.y - 34, label, { size: 16, color: '#ffb3a0', life, rise: 12, anchorId: v.id });
      if (this._feedback() && near && !feint) {
        this.fx.text(a.head.x, a.head.y - 14, describeOffset(near.offset), { size: 14, color: PALETTE.parchment, life, rise: 12, anchorId: v.id });
      }
    }
    const when = feint ? 'baited' : late ? 'late' : 'early';
    run.log?.push({ label: `Press · ${OUTCOME_LABELS[action] ?? action}`, outcome: feint ? 'Baited' : 'Whiff', ok: false, timing: `${when} · locked out` });
    // A late press can arrive after its hit already resolved unanswered: correct that hit's "no press" entry.
    const missed = late && Math.abs(near.offset) <= 400 ? run.unanswered?.get(near.index) : null;
    if (missed) missed.timing = `${describeOffset(near.offset)} · too late`;
  }

  /**
   * Tell the HUD until when (performance.now clock) defense input is locked, so the touch buttons grey out. The
   * lockout runs on the battle clock, so the real deadline is re-sent when hit-stop or a pause stretches it.
   */
  _sendLockout(run, force = false) {
    const lock = run.lock;
    if (!lock) return;
    const scale = this._clockScale;
    if (!(scale > 0)) return; // frozen (paused / hidden): re-sent once the clock runs again
    const local = this.worldTime - run.t0;
    const until = this.game.time + Math.max(0, lock.until - local) / scale;
    const sent = this._lockSent;
    if (!force && sent && sent.run === run && (until === sent.until || Math.abs(until - sent.until) < 25)) return;
    this._lockSent = { run, until };
    this.hud.setDefenseLockout?.(until, lock.action);
  }

  _startDefenseAnim(v, action) {
    v.forced = null;
    switch (action) {
      case 'parry':
        v.play('parry', { dur: 400, p0: 0.02 });
        break;
      case 'dodge':
        v.play('dodge', { dur: 420, p0: 0.08 });
        v.kick(-300);
        this.sfx('dodge', { volume: 0.75, pan: this._pan(v.x) });
        break;
      case 'jump': {
        // Jumping again while still airborne (shockwave rolls) carries on from the current height — rising again
        // from the mirrored point of the arc — instead of snapping back to the crouch on the ground.
        let p0 = JUMP.p0;
        if (v.anim === 'jump') {
          const p = v.pose(this.worldTime).p;
          if (p > JUMP.airFrom && p < JUMP.airTo) p0 = Math.min(p, JUMP.airFrom + JUMP.airTo - p);
        }
        v.play('jump', { dur: (1 - p0) / JUMP_RATE, p0 });
        this.sfx('jump', { pan: this._pan(v.x) });
        if (p0 === JUMP.p0) this.fx.burst(v.x, v.y, 'jump', { scale: 0.6 });
        const token = (v._jumpToken = (v._jumpToken ?? 0) + 1);
        this._after(Math.max(0, (JUMP.landP - p0) / JUMP_RATE), () => {
          if (v._jumpToken !== token) return;
          this.sfx('land', { volume: 0.7, pan: this._pan(v.x) });
          this.fx.burst(v.x, v.y, 'land', { scale: 0.6 });
        });
        break;
      }
      case 'gradient':
        v.play('parry', { dur: 440, p0: 0.02 });
        v.flash = 0.45;
        break;
      default:
        break;
    }
  }

  onDefenseResolved(run, r) {
    const hit = run.hits[r.hitIndex];
    if (!hit) return;
    const plan = run.plan;
    const livingTargets = (hit.targetIds ?? []).filter((id) => this.model.get(id)?.alive);
    const events = this.model.resolveEnemyHit(plan, r.hitIndex, r.outcome);
    const outcome = plan.outcomes?.[r.hitIndex] ?? r.outcome;
    const attackerV = this.views.get(plan.actorId);
    const label = `Hit ${r.hitIndex + 1} · ${hit.type === 'normal' ? 'strike' : hit.type}`;
    // What the player did about it: the claim's offset, or — for a hit that went unclaimed although they pressed —
    // the locked-out press that missed it ("75 ms late · locked out"), rather than "no press".
    const whiff = Number.isFinite(r.offset) || r.action ? null : run.whiffNear?.(r.hitIndex);
    const timing = Number.isFinite(r.offset) ? describeOffset(r.offset) : whiff ? `${describeOffset(whiff.offset)} · locked out` : 'no press';
    // Right timing, wrong move (parrying an unparryable, dodging a shockwave …): name the move that works.
    const wrongMove = outcome === 'hit' && r.action && !(VALID_DEFENSES[hit.type] ?? []).includes(r.action)
      ? `Can't ${DEFENSE_NAMES[r.action]?.toLowerCase() ?? r.action} — ${DEFENSE_NAMES[perfectAction(hit.type)] ?? 'Dodge'}!` : null;
    const entry = { label, outcome: OUTCOME_LABELS[outcome] ?? outcome, ok: outcome !== 'hit', timing: wrongMove ? `${timing} · wrong move` : timing };
    run.log?.push(entry);
    if (!whiff && !Number.isFinite(r.offset) && !r.action) (run.unanswered ??= new Map()).set(r.hitIndex, entry);
    if (!livingTargets.length) return;
    const nextGap = Math.min(Infinity, ...run.hits.filter((h, k) => k > r.hitIndex && h.type !== 'feint').map((h) => h.t - hit.t));
    for (const id of livingTargets) {
      const v = this.views.get(id);
      if (!v) continue;
      const a = v.anchors(this.worldTime);
      const txt = OUTCOME_TEXT[outcome];
      switch (outcome) {
        case 'parry': {
          const px = (a.weapon.x + a.chest.x) / 2 + 18;
          this.fx.burst(px, a.weapon.y, 'parry', { dir: -1 });
          if (!this.fx.reducedFlashing) this.fx.screenFlash(PALETTE.paleGold, 90, 0.16);
          this.camera.punch(0.022, 200);
          if (attackerV && run.melee) attackerV.kick(260);
          break;
        }
        case 'perfectDodge':
          this.fx.burst(a.chest.x, a.chest.y, 'dodge', { perfect: true, dir: -1 });
          break;
        case 'dodge':
          this.fx.burst(a.chest.x, a.chest.y, 'dodge', { dir: -1 });
          break;
        case 'jump':
          this.fx.ring(v.x, v.y, { r0: 10, r1: 70, life: 380, color: HIT_TYPE_COLORS.jump, width: 3, squash: 0.3 });
          break;
        case 'gradient':
          this.fx.burst(a.chest.x, a.chest.y, 'gradient', { scale: 1.1 });
          if (attackerV) {
            const ea = attackerV.anchors(this.worldTime);
            this.fx.line(a.weapon.x, a.weapon.y, ea.chest.x, ea.chest.y, { color: '#d9a8ff', width: 5, life: 260, jagged: 8 });
            this.fx.slash(ea.chest.x, ea.chest.y, { angle: -0.4, length: 170, color: '#c77dff', width: 12, life: 260 });
          }
          break;
        default:
          this.fx.vignette(PALETTE.crimson, 520, 0.34);
          break;
      }
      // Rapid bursts: lift each new outcome label above the previous one on the same defender.
      const stack = this.worldTime - (v._outcomeAt ?? -1e9) < 420 ? (v._outcomeStack ?? 0) + 1 : 0;
      v._outcomeAt = this.worldTime;
      v._outcomeStack = Math.min(stack, 3);
      const lift = v._outcomeStack * 24;
      if (txt) this.fx.text(a.head.x, a.head.y - 46 - lift, txt.text, { size: txt.size, color: txt.color, life: 820, rise: 30, anchorId: v.id });
      if (wrongMove) this.fx.text(a.head.x, a.head.y - 46 - lift, wrongMove, { size: 17, color: '#ffb3a0', life: 1100, rise: 24, anchorId: v.id });
      if (this._feedback()) {
        this.fx.text(a.head.x, a.head.y - 20 - lift, timing, { size: 15, color: outcome === 'hit' ? '#ffb3a0' : PALETTE.parchment, life: 900, rise: 30, anchorId: v.id });
      }
    }
    switch (outcome) {
      case 'parry':
        this.sfx('parry', { pan: this._pan(this.views.get(livingTargets[0])?.x ?? 400) });
        this.hitStop(nextGap < RHYTHM_GAP.parry ? HITSTOP.parryRapid : HITSTOP.parry);
        break;
      case 'perfectDodge':
        this.sfx('perfect_dodge');
        break;
      case 'gradient':
        this.sfx('gradient_counter');
        this.hitStop(nextGap < RHYTHM_GAP.gradient ? HITSTOP.gradientRapid : HITSTOP.gradient);
        this.fx.banner('Counter!', { color: '#c77dff', life: 1000 });
        break;
      default:
        break;
    }
    this._playEvents(events.filter((e) => e.type !== 'defend'), { source: plan.actorId, hit, enemyHit: true });
  }

  onRunEvent(run, kind, hit, seg) {
    const attacker = run.attacker;
    if (!attacker || !this.model.get(run.plan.actorId)?.alive) return;
    const now = this.worldTime;
    if (kind === 'swell') {
      // Timed by the run so the swell's cut lands exactly on the Prism hit.
      this.sfx('telegraph_gradient', { volume: 0.85, pan: this._pan(attacker.x) });
      return;
    }
    if (kind === 'feintBreak') {
      this._shatterFeintCue(run, hit);
      return;
    }
    if (kind === 'telegraph') {
      const nameByType = { unparryable: 'telegraph_red', jump: 'telegraph_gold' };
      const name = nameByType[hit.type] ?? 'telegraph';
      // The Prism telegraph is the timed swell above; its wind-up start is told by the desaturation.
      if (hit.type !== 'gradient' && (now - this._lastTele > 150 || hit.type !== 'normal')) {
        this._lastTele = now;
        this.sfx(name, { volume: hit.type === 'normal' || hit.type === 'feint' ? 0.55 : 0.85, pan: this._pan(attacker.x) });
      }
      if (hit.type === 'gradient') {
        const lead = Math.max(400, hit.t - seg.windStart);
        this.fx.desaturate(0.85, lead + 420);
        this.fx.vignette(PALETTE.violet, lead + 500, 0.5);
      } else if (hit.type === 'unparryable') {
        this.fx.vignette('#ff3b2f', Math.max(400, hit.t - seg.windStart) + 200, 0.22);
      }
      return;
    }
    const a = attacker.anchors(now);
    const from = a.cast ?? a.weapon;
    if (kind === 'release') {
      if (hit.type === 'feint') return;
      if (hit.anim === 'bolt') {
        for (const id of hit.targetIds ?? []) {
          const tv = this.views.get(id);
          if (!tv) continue;
          const ta = tv.anchors(now);
          const pk = projectileFor(hit.element);
          const col = hit.type === 'unparryable' ? '#ff6a55' : hit.type === 'gradient' ? '#d9a8ff' : pk.color;
          this.fx.projectile({ from, to: ta.chest, duration: Math.max(40, hit.t - seg.release), kind: pk.kind, color: col, arc: 18, size: 1.15 });
        }
        this.sfx(ELEMENT_SFX.has(hit.element) ? hit.element : 'swing', { volume: 0.5, pan: this._pan(from.x) });
      } else if (hit.anim === 'wave') {
        const seen = new Set();
        for (const id of hit.targetIds ?? []) {
          const tv = this.views.get(id);
          if (!tv) continue;
          const key = Math.round(tv.home.y);
          if (seen.has(key)) continue;
          seen.add(key);
          const travel = Math.max(40, hit.t - seg.release);
          this.fx.shockwave(attacker.x - 20, tv.home.y, { toX: tv.home.x, duration: travel, color: HIT_TYPE_COLORS.jump });
          // While the wave rolls, actors standing in front of its lane are drawn over it (depth order).
          this._waveLanes.push({ y: tv.home.y, until: this.worldTime + travel + 320 });
        }
        this.fx.shake(3, 160);
        this.sfx('earth', { volume: 0.5, pan: this._pan(attacker.x) });
      } else if (!['beam', 'nova', 'cast'].includes(hit.anim)) {
        this.sfx('swing', { volume: 0.5, pitch: 0.85, pan: this._pan(attacker.x) });
      }
      return;
    }
    if (kind === 'impact') {
      if (hit.type === 'feint') return;
      const col = hit.type === 'gradient' ? '#d9a8ff' : hit.type === 'unparryable' ? '#ff6a55' : ELEMENT_COLORS[hit.element] ?? '#ffffff';
      // Contact happens at T whether or not the hit is judged yet (an unclaimed one resolves at T + post): show the
      // weapon or projectile arriving now; the damage, hurt reaction and outcome follow at the resolution.
      if (!run.resolved[hit.index]) this._contactFlash(run, hit, col);
      if (hit.anim === 'beam') {
        for (const id of hit.targetIds ?? []) {
          const tv = this.views.get(id);
          if (!tv) continue;
          const ta = tv.anchors(now);
          this.fx.line(from.x, from.y, ta.chest.x, ta.chest.y, { color: col, width: 16, life: 260 });
          this.fx.line(from.x, from.y, ta.chest.x, ta.chest.y, { color: '#ffffff', width: 5, life: 200 });
        }
        this.sfx(hit.element === 'dark' || hit.type === 'gradient' ? 'dark' : 'light', { volume: 0.6 });
      } else if (hit.anim === 'nova' || hit.anim === 'cast') {
        for (const id of hit.targetIds ?? []) {
          const tv = this.views.get(id);
          if (!tv) continue;
          this.fx.ring(tv.x, tv.home.y, { r0: 20, r1: 110, life: 420, color: col, width: 5, squash: 0.34 });
          this.fx.ring(tv.x, tv.home.y - 70, { r0: 10, r1: 90, life: 360, color: col, width: 3 });
        }
        this.sfx(ELEMENT_SFX.has(hit.element) ? hit.element : 'light', { volume: 0.55 });
      }
    }
  }

  /** A weapon streak (melee) or a small splash (bolts) on each living target at the moment of contact. */
  _contactFlash(run, hit, color) {
    const melee = !['beam', 'nova', 'cast', 'wave', 'bolt'].includes(hit.anim);
    if (!melee && hit.anim !== 'bolt') return;
    for (const id of hit.targetIds ?? []) {
      const tv = this.views.get(id);
      if (!tv || !this.model.get(id)?.alive) continue;
      const ta = tv.anchors(this.worldTime);
      if (melee) {
        this.fx.slash(ta.chest.x + 6, ta.chest.y - 4, { angle: 2.5 + this.auxRng.next() * 0.5, length: 92, color, life: 150, width: 6, flip: hit.index % 2 === 1 });
      }
      this.fx.sparks(ta.chest.x + 10, ta.chest.y, { color, count: melee ? 6 : 9, speed: 220, spread: 1.6, angle: Math.PI, life: 220, gravity: 280, width: 3 });
    }
  }

  /** A feint's cue breaks apart before the bait zone opens (FEINT_CUE_BREAK): cue-watchers learn to hold. */
  _shatterFeintCue(run, hit) {
    if (this.settings?.assistCues === false) return;
    for (const id of hit.targetIds ?? []) {
      const tv = this.views.get(id);
      if (!tv || !this.model.get(id)?.alive) continue;
      const a = tv.anchors(this.worldTime);
      this.fx.sparks(a.chest.x, a.chest.y, { color: '#f4efe6', count: 16, speed: 260, life: 340, gravity: 360, width: 3 });
      this.fx.ring(a.chest.x, a.chest.y, { r0: 36, r1: 78, life: 220, color: '#f4efe6', width: 2, alpha: 0.7 });
    }
  }

  // ================================================================ event animation

  /**
   * Animate model events (state is already applied). Returns once blocking events (phase changes) are done.
   * @param {object[]} events
   * @param {object} [ctx]
   */
  async _playEvents(events, ctx = {}) {
    if (!events?.length) return;
    const blockers = [];
    for (const e of events) {
      try {
        this._animateEvent(e, ctx, blockers);
      } catch (err) {
        this.game.reportError(this, `event ${e?.type}`, err);
      }
    }
    for (const b of blockers) await b();
  }

  _animateEvent(e, ctx, blockers) {
    const fx = this.fx;
    const v = e.targetId ? this.views.get(e.targetId) : null;
    const c = e.targetId ? this.model.get(e.targetId) : null;
    switch (e.type) {
      case 'damage': {
        if (!v || !c) return;
        const a = v.anchors(this.worldTime);
        const heavy = e.amount >= c.stats.maxHp * 0.18;
        const col = e.riposte ? '#c77dff' : ELEMENT_COLORS[e.element];
        if (e.affinity) this._learnAffinity(c, e.element, e.affinity);
        if (e.kind === 'status') {
          fx.number(a.chest.x, a.head.y - 10, e.amount, { kind: 'damage', color: STATUS_COLORS.burn });
          fx.burst(a.chest.x, a.chest.y, 'fire', { scale: 0.6 });
          v.flash = 0.6;
          this.sfx('fire', { volume: 0.5 });
          return;
        }
        // Alternate sides of the body so multi-hit chains don't pile onto one spot (or the enemy bars).
        this._numSide = -(this._numSide || 1);
        const nx = a.chest.x + this._numSide * (22 + this.auxRng.next() * 18);
        const ny = Math.min(a.chest.y - 34, a.head.y + 26) - this.auxRng.next() * 12;
        fx.number(nx, ny, e.amount, { kind: e.crit ? 'crit' : 'damage', affinity: e.affinity, color: col });
        if (e.amount > 0) {
          fx.burst(a.chest.x, a.chest.y, e.crit ? 'crit' : burstKindFor(e.element), { dir: v.side === 'enemy' ? 1 : -1, scale: heavy ? 1.2 : 1 });
          v.flash = 1;
          if (!v.forced && c.alive) v.play('hurt', { dur: 360 });
          v.kick((v.side === 'enemy' ? 1 : -1) * (e.crit || heavy ? 330 : 200));
          this.sfx(e.crit ? 'crit' : heavy ? 'hit_heavy' : 'hit', { pitch: 0.94 + this.auxRng.next() * 0.12, pan: this._pan(a.chest.x) });
          if (ELEMENT_SFX.has(e.element)) this.sfx(e.element, { volume: 0.6, pan: this._pan(a.chest.x) });
          if (v.side === 'party') {
            this.sfx('hurt', { volume: 0.8 });
            fx.shake(heavy ? 10 : 6, heavy ? 240 : 180);
          } else if (e.crit) {
            fx.shake(5, 150);
          }
          if (e.crit) {
            this.hitStop(HITSTOP.crit);
            this.camera.punch(0.04);
          }
        }
        return;
      }
      case 'blocked': {
        if (!v) return;
        const a = v.anchors(this.worldTime);
        fx.number(a.chest.x, a.head.y - 6, 'BLOCKED', { kind: 'block' });
        fx.burst(a.chest.x, a.chest.y, 'shield', { dir: 1 });
        v.kick(120);
        this.sfx('block', { pan: this._pan(a.chest.x) });
        return;
      }
      case 'heal': {
        if (!v || !(e.amount > 0)) return;
        const a = v.anchors(this.worldTime);
        fx.number(a.chest.x, a.head.y - 10, e.amount, { kind: 'heal' });
        fx.burst(a.chest.x, a.chest.y, 'heal');
        this.sfx('heal', { volume: 0.8 });
        return;
      }
      case 'status': {
        if (!v) return;
        const def = STATUS_DEFS[e.status];
        const a = v.anchors(this.worldTime);
        fx.burst(a.chest.x, a.chest.y, def?.positive ? 'buff' : 'debuff', { scale: 0.8 });
        fx.text(a.head.x, a.head.y - 44, def?.name ?? e.status, { size: 17, color: STATUS_COLORS[e.status] ?? PALETTE.parchment, life: 900, rise: 22, anchorId: v.id });
        this.sfx(def?.positive ? 'buff' : 'debuff', { volume: 0.6 });
        return;
      }
      case 'ap': {
        if (!v || !(e.delta > 0) || ctx.silentAp) return;
        const aa = v.anchors(this.worldTime);
        fx.number(aa.chest.x + 58, aa.chest.y - 4, e.delta, { kind: 'ap' });
        return;
      }
      case 'gradient': {
        if (e.delta > 0 && Math.floor((e.value - e.delta) / 100) < e.charges) {
          this.sfx('gradient_ready');
          fx.screenFlash('#c77dff', 180, 0.12);
        }
        return;
      }
      case 'shield': {
        if (!v) return;
        const a = v.anchors(this.worldTime);
        if (e.delta > 0) {
          fx.burst(a.chest.x, a.chest.y, 'shield', { scale: 1.2 });
          fx.text(a.head.x, a.head.y - 40, `+${e.delta} Shield${e.delta > 1 ? 's' : ''}`, { size: 18, color: PALETTE.shield, life: 900, anchorId: v.id });
          this.sfx('shield_restore');
        } else if (e.shieldsAfter === 0) {
          fx.text(a.head.x, a.head.y - 40, 'Shields Shattered', { size: 18, color: PALETTE.shield, life: 900, anchorId: v.id });
        }
        return;
      }
      case 'broken': {
        if (!v) return;
        const a = v.anchors(this.worldTime);
        fx.burst(a.chest.x, a.chest.y, 'break', { scale: 1.2 });
        fx.banner('Break!', { color: PALETTE.breakBar, sub: c?.name ?? '', life: 1300 });
        fx.shake(12, 300);
        this.hitStop(HITSTOP.break);
        this.camera.punch(0.05, 320);
        this.sfx('break');
        return;
      }
      case 'recover': {
        if (!v) return;
        const a = v.anchors(this.worldTime);
        fx.text(a.head.x, a.head.y - 40, 'Recovered', { size: 18, color: PALETTE.parchment, life: 900, anchorId: v.id });
        return;
      }
      case 'ko': {
        if (!v) return;
        const a = v.anchors(this.worldTime);
        v.forced = null;
        v.aura = null;
        v.vivid = false;
        v.play('ko', { dur: v.side === 'enemy' ? 1150 : 800, hold: true });
        fx.burst(a.chest.x, a.chest.y, 'ko', { color: v.side === 'enemy' ? PALETTE.paleGold : PALETTE.crimson });
        this.sfx('ko', { pan: this._pan(a.chest.x) });
        if (v.side === 'party') fx.vignette(PALETTE.crimson, 800, 0.5);
        return;
      }
      case 'revive': {
        if (!v) return;
        const a = v.anchors(this.worldTime);
        v.play('idle', { loop: true, dur: 1000 });
        v.goHome();
        fx.burst(a.chest.x, a.chest.y, 'heal', { scale: 1.3 });
        fx.text(a.head.x, a.head.y - 40, 'Revived', { size: 20, color: PALETTE.hpGood, life: 1000, anchorId: v.id });
        this.sfx('revive');
        return;
      }
      case 'mechanic': {
        if (!v) return;
        const m = e.mechanic;
        const prev = v._lastMech;
        v._lastMech = m ? JSON.stringify(m) : null;
        if (!m || !prev) return;
        const a = v.anchors(this.worldTime);
        if (m.type === 'surge' && m.value >= 10 && !prev.includes('"value":10')) {
          fx.burst(a.weapon.x, a.weapon.y, 'surge', { scale: 1 });
          fx.text(a.head.x, a.head.y - 50, 'Surge Full', { size: 17, color: '#bfe3ff', life: 900, anchorId: v.id });
        } else if (m.type === 'glyphs') {
          const pl = JSON.parse(prev).list ?? [];
          if (m.list.length > pl.length || m.list.join() !== pl.join()) fx.burst(a.cast?.x ?? a.chest.x, a.cast?.y ?? a.chest.y, 'glyph', { scale: 0.7 });
        } else if (m.type === 'stance' && !prev.includes(`"${m.value}"`)) {
          const names = { neutral: 'Neutral', assault: 'Assault', guard: 'Guard', virtuoso: 'Bravura' };
          const cols = { neutral: PALETTE.parchment, assault: '#ffb38a', guard: '#9fd3ff', virtuoso: '#ffe08a' };
          fx.text(a.head.x, a.head.y - 50, `${names[m.value] ?? m.value} Stance`, { size: 17, color: cols[m.value] ?? PALETTE.parchment, life: 900, anchorId: v.id });
          if (m.value === 'virtuoso') fx.burst(a.chest.x, a.chest.y, 'perfect', { scale: 0.8 });
        }
        return;
      }
      case 'skip': {
        if (!v) return;
        const a = v.anchors(this.worldTime);
        fx.text(a.head.x, a.head.y - 40, e.reason === 'broken' ? 'Broken — turn lost' : 'Stunned', { size: 20, color: STATUS_COLORS.stun, life: 1000, anchorId: v.id });
        this.sfx('debuff', { volume: 0.5 });
        return;
      }
      case 'text': {
        if (!v) return;
        const a = v.anchors(this.worldTime);
        // Resist / immune notices name the status they stopped, in its colour ("Burn resisted", "Immune to Stun").
        const def = e.status ? STATUS_DEFS[e.status] : null;
        const text = !def ? e.text : e.text === 'Immune' ? `Immune to ${def.name}` : e.text === 'Resisted' ? `${def.name} resisted` : e.text;
        fx.text(a.head.x, a.head.y - 44, text, { size: 18, color: def ? STATUS_COLORS[e.status] ?? PALETTE.paleGold : PALETTE.paleGold, life: 900, anchorId: v.id });
        return;
      }
      case 'statusTick': {
        if (!v || e.status !== 'regen') return;
        return;
      }
      case 'phase':
        blockers.push(() => this._phase(e));
        return;
      default:
    }
  }

  _learnAffinity(c, element, affinity) {
    if (c.side !== 'enemy') return;
    const k = c.key;
    if (!this.knownAff[k]) this.knownAff[k] = {};
    this.knownAff[k][element] = affinity;
  }

  async _phase(e) {
    const enemy = this.model.get(e.targetId);
    const v = this.views.get(e.targetId);
    if (!enemy) return;
    if (v) v.phase = e.phaseIndex;
    this.fx.screenFlash(PALETTE.paleGold, 320, 0.7);
    this.fx.shake(10, 480);
    this.camera.punch(0.06, 500);
    this.sfx('phase');
    const text = String(e.text ?? '');
    const parts = text.split(/\s+[—–-]\s+/);
    if (parts.length > 1 && parts[0].length <= 18) this.fx.banner(parts[0], { sub: parts.slice(1).join(' — '), color: PALETTE.paleGold, life: PHASE_BANNER_MS });
    else this.fx.banner(enemy.name, { sub: text, color: PALETTE.paleGold, life: PHASE_BANNER_MS });
    if (this.zone === 'summit' && enemy.key === 'stillkeeper') this._bgPhaseTarget = 1;
    if (v) {
      const a = v.anchors(this.worldTime);
      this.fx.burst(a.chest.x, a.chest.y, 'gradient', { scale: 1.6 });
      this.fx.ring(a.center.x, a.center.y, { r0: 30, r1: 260, life: 700, color: PALETTE.paleGold, width: 6 });
    }
    const id = `${enemy.key}_phase2`;
    // Unattended autopilot runs skip the story beat unless they opt in with autopilot.dialogues (the e2e driver
    // advances dialogues itself).
    const ap = this.autopilot();
    const auto = ap?.commands === 'auto' && !ap?.dialogues;
    const talk = !!STORY.dialogues?.[id] && !!this.game.scenes.isRegistered?.('dialogue') && !auto;
    // The phase dialogue docks at the top of the stage, where the banner is, and the battle (its effects included)
    // stands still under a dialogue: let the banner play out first, or it would hang half-faded behind the text.
    await this._wait(talk ? PHASE_BANNER_MS + 60 : 1200);
    if (talk && this.alive) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        this._pendingDialogue = finish;
        try {
          this.game.scenes.push('dialogue', { id, onDone: finish });
        } catch (err) {
          this.game.reportError(this, 'phase dialogue', err);
          finish();
        }
      });
      this._pendingDialogue = null;
    }
    await this._wait(300);
  }

  // ================================================================ hints / modals

  async _hint(key) {
    const text = STORY.hints?.[key];
    if (!text || this._hintSeen(key) || !this.alive) return;
    this._markHint(key);
    // A touch screen has buttons, not keys: "press {parry}" reads "tap [Parry]" and "press {confirm}" "tap it".
    const touch = this.game.input?.lastDevice === 'touch';
    const caps = touch ? touchWording(text, this.game, (a) => `[[${a}]]`) : fillTokens(text, (a) => `[[${a}]]`);
    const html = keyCaps(caps, (a) => this._label(a));
    await new Promise((resolve) => {
      this.modal = { kind: 'hint', key, t0: this.game.time, resolve };
      this._setClockScale(this._wantScale());
      this.hud.showHint({ title: HINT_TITLES[key] ?? 'Field Notes', html });
      this.sfx('menu_open', { volume: 0.5 });
    });
    this.hud.hideHint();
    await this._waitReal(140);
  }

  _closeModal(kind) {
    const m = this.modal;
    if (!m || m.kind !== kind) return;
    if (kind === 'results' && !m.ready) return;
    this.modal = null;
    this._setClockScale(this._wantScale());
    this.sfx('ui_confirm', { volume: 0.6 });
    m.resolve?.();
  }

  _handleModal() {
    const m = this.modal;
    if (!m) return false;
    const input = this.game.input;
    const auto = this.autopilot()?.commands === 'auto';
    if (m.kind === 'hint') {
      if (input.pressed('confirm') || input.pressed('cancel') || input.pressed('menu') || (auto && this.game.time - m.t0 > 420)) {
        input.consume();
        this._closeModal('hint');
      }
      return true;
    }
    if (m.kind === 'results') {
      if (m.ready && (input.pressed('confirm') || input.pressed('cancel') || input.pressed('menu') || (auto && this.game.time - m.readyAt > 700))) {
        input.consume();
        this._closeModal('results');
      }
      return true;
    }
    if (m.kind === 'pause') {
      this._pauseInput(m);
      return true;
    }
    return true;
  }

  _openPause() {
    if (this.modal) return;
    const canFlee = this.model.fleeAllowed && this.menu && !this.model.outcome();
    const items = [
      { id: 'resume', label: 'Resume' },
      { id: 'settings', label: 'Settings', disabled: !this.game.scenes.isRegistered?.('settings') },
      { id: 'flee', label: 'Flee', disabled: !canFlee },
      { id: 'quit', label: 'Quit to Title', disabled: !this.game.scenes.isRegistered?.('title') },
    ];
    this.modal = { kind: 'pause', items, index: 0, confirm: false };
    this._setClockScale(this._wantScale());
    this.sfx('menu_open');
    this.hud.hideMenu();
    this._showPause();
  }

  _showPause() {
    const m = this.modal;
    if (m.confirm) {
      this.hud.showPause({ title: 'Quit to Title?', sub: 'Progress since your last save will be lost.', items: [{ label: 'Quit to Title' }, { label: 'Keep Fighting' }], index: m.index });
    } else {
      const sub = this.practice ? 'Practice bout' : this.boss ? 'There is no escape from this battle' : '';
      this.hud.showPause({ title: 'Paused', sub, items: m.items, index: m.index });
    }
  }

  _pauseInput(m) {
    const input = this.game.input;
    const n = m.confirm ? 2 : m.items.length;
    if (input.pressedRepeat('down')) {
      m.index = (m.index + 1) % n;
      this.hud.setPauseIndex(m.index);
      this.sfx('ui_move');
    } else if (input.pressedRepeat('up')) {
      m.index = (m.index + n - 1) % n;
      this.hud.setPauseIndex(m.index);
      this.sfx('ui_move');
    } else if (input.pressed('confirm')) {
      input.consume();
      this._pauseClick(m.index);
    } else if (input.pressed('cancel') || input.pressed('menu')) {
      input.consume();
      if (m.confirm) {
        m.confirm = false;
        m.index = 3;
        this._showPause();
      } else this._closePause();
      this.sfx('ui_cancel');
    }
  }

  _pauseHover(i) {
    const m = this.modal;
    if (!m || m.kind !== 'pause' || m.index === i) return;
    m.index = i;
    this.hud.setPauseIndex(i);
    this.sfx('ui_move', { volume: 0.5 });
  }

  _pauseClick(i) {
    const m = this.modal;
    if (!m || m.kind !== 'pause') return;
    m.index = i;
    if (m.confirm) {
      if (i === 0) {
        this._closePause();
        this.sfx('ui_confirm');
        this.alive = false;
        this.game.scenes.reset('title');
      } else {
        m.confirm = false;
        m.index = 3;
        this._showPause();
      }
      return;
    }
    const it = m.items[i];
    if (!it || it.disabled) {
      this.sfx('ui_error');
      return;
    }
    this.sfx('ui_confirm');
    if (it.id === 'resume') this._closePause();
    else if (it.id === 'settings') {
      this._closePause();
      this.game.scenes.push('settings', { from: 'battle' });
    } else if (it.id === 'flee') {
      this._closePause();
      if (this.menu) this._menuResolve({ action: { kind: 'flee' } });
    } else if (it.id === 'quit') {
      m.confirm = true;
      m.index = 1;
      this._showPause();
    }
  }

  _closePause() {
    if (this.modal?.kind !== 'pause') return;
    this.modal = null;
    this.hud.hidePause();
    this._setClockScale(this._wantScale());
    if (this.menu?.level === 'root') this._menuShowRoot();
  }

  // ================================================================ command menu

  _openMenu(actor) {
    this.mode = 'menu';
    return new Promise((resolve) => {
      this.menu = {
        actorId: actor.id, level: 'root', rootIndex: this.lastRoot[actor.id] ?? 0, listKind: null, rows: [], listIndex: 0,
        target: null, resolve, openedAt: this.worldTime, autoAt: this.worldTime + 300,
      };
      this._menuShowRoot();
    });
  }

  _menuResolve(choice) {
    const m = this.menu;
    if (!m) return;
    this.menu = null;
    this.hud.hideMenu();
    this.hud.hideList();
    this.hud.hideTarget();
    this.hud.setInfo(null);
    m.resolve(choice);
  }

  _rootItems(actor) {
    const cmds = this.model.getCommands(actor.id);
    const skillsUsable = cmds.skills.filter((s) => s.usable).length;
    const itemsLeft = cmds.items.reduce((s, it) => s + it.count, 0);
    const g = cmds.gradient[0];
    // Skills is only enterable when something in it can be used: a list of greyed-out rows is a dead end (and on
    // touch there would be nothing to tap).
    const skillsReason = !cmds.skills.length ? 'No skills learned'
      : actor.statuses.some((s) => s.id === 'silence') ? 'Silenced — skills are sealed'
        : cmds.skills.some((s) => s.reason === 'Not enough AP') ? 'Not enough AP for any skill' : 'No skill can be used right now';
    const items = [
      { id: 'attack', label: 'Attack', iconSrc: elementIcon(actor.basicAttack?.element ?? 'physical', 20), hint: '+1 AP', disabled: !cmds.attack.usable, reason: cmds.attack.reason, note: `${cmds.attack.name} — free, earns 1 AP` },
      { id: 'skills', label: 'Skills', iconSrc: mechanicIcon('ap', 20), hint: `${skillsUsable}/${cmds.skills.length}`, disabled: skillsUsable === 0, reason: skillsReason, note: skillsUsable ? '' : skillsReason },
      { id: 'freeAim', label: 'Free Aim', icon: '◎', hint: '1 AP', disabled: !cmds.freeAim.usable, reason: cmds.freeAim.reason, note: 'Shoot weak points — does not end the turn' },
      { id: 'items', label: 'Items', iconSrc: itemIcon('tincture', 22), hint: `${itemsLeft}`, disabled: !cmds.items.some((it) => it.usable), reason: itemsLeft ? 'No valid targets' : 'No items left' },
      { id: 'gradient', label: 'Prism', iconSrc: mechanicIcon('gradient', 20), hint: `${this.model.gradientCharges()}×`, disabled: !g?.usable, reason: g?.reason ?? 'No Prism skill', note: g ? g.name : '' },
    ];
    if (this.practice) {
      items.push({ id: 'practice', label: 'Drill', icon: '◈', hint: '', note: 'The mannequin attacks you right now — no turn spent' });
      items.push({ id: 'leave', label: 'Leave', icon: '↩', note: 'End the practice bout' });
    } else {
      items.push({ id: 'flee', label: 'Flee', icon: '↩', disabled: !cmds.flee.usable, reason: cmds.flee.reason, note: 'Always succeeds' });
    }
    return items;
  }

  _menuShowRoot() {
    const m = this.menu;
    const actor = this.model.get(m.actorId);
    m.level = 'root';
    m.rootItems = this._rootItems(actor);
    m.rootIndex = clamp(m.rootIndex, 0, m.rootItems.length - 1);
    this.hud.hideList();
    this.hud.hideTarget();
    this.hud.setInfo(null);
    this.hud.showMenu({ title: actor.name.split(' ')[0], sub: `${actor.ap} AP`, items: m.rootItems, index: m.rootIndex });
    this.camera.focus(632, 356, 1.02, 700);
  }

  _menuShowList(kind) {
    const m = this.menu;
    const actor = this.model.get(m.actorId);
    const cmds = this.model.getCommands(actor.id);
    let rows = [];
    let title = '';
    if (kind === 'skills') {
      title = 'Skills';
      rows = cmds.skills.map((s) => {
        const def = SKILLS[s.id] ?? {};
        const tag = def.surge === 'consume' ? 'Surge' : def.consumeAllGlyphs ? 'Codex' : def.consumeGlyph ? 'Sigil' : (def.effects ?? []).some((e) => e.type === 'stance') ? 'Stance' : null;
        return { id: s.id, name: s.name, iconSrc: elementIcon(s.element, 20), cost: s.ap, costKind: 'ap', tag, short: def.short ?? '', desc: def.desc ?? s.desc, disabled: !s.usable, reason: s.reason, ap: s.ap, target: s.target };
      });
    } else if (kind === 'items') {
      title = 'Items';
      rows = cmds.items.map((it) => ({ id: it.id, name: it.name, iconSrc: itemIcon(it.id, 22), cost: `${it.count}/${it.max}`, costKind: 'count', desc: it.desc, disabled: !it.usable, reason: it.reason, target: it.target === 'deadAlly' ? 'deadAlly' : 'ally' }));
    } else {
      title = 'Prism';
      rows = cmds.gradient.map((g) => {
        const def = SKILLS[g.id] ?? {};
        return { id: g.id, name: g.name, iconSrc: elementIcon(g.element, 20), cost: 1, costKind: 'charge', short: def.short ?? '', desc: def.desc ?? g.desc, disabled: !g.usable, reason: g.reason, target: g.target };
      });
    }
    m.level = 'list';
    m.listKind = kind;
    m.rows = rows;
    m.listIndex = clamp(m.listKind === kind ? m.listIndex : 0, 0, Math.max(0, rows.length - 1));
    const firstUsable = rows.findIndex((r) => !r.disabled);
    if (rows[m.listIndex]?.disabled && firstUsable >= 0) m.listIndex = firstUsable;
    this.hud.hideMenu();
    this.hud.hideTarget();
    this.hud.showList({ title, sub: kind === 'gradient' ? `${this.model.gradientCharges()} charge${this.model.gradientCharges() === 1 ? '' : 's'}` : `${actor.ap} AP`, rows, index: m.listIndex });
    this.hud.setInfo(this._listHelp(kind));
  }

  /** Help line under a command list: key caps, or tap wording on touch (the HUD adds its own Back button there). */
  _listHelp(kind) {
    if (this._touchMode()) return `Tap ${kind === 'items' ? 'an item' : kind === 'gradient' ? 'a Prism skill' : 'a skill'} to choose it · Back to return`;
    return `[[up]][[down]] choose · [[confirm]] select · [[cancel]] back`;
  }

  /** Re-render the open command panel's help after a device switch (key caps ↔ tap wording). */
  _onDeviceChange() {
    const m = this.menu;
    if (!this.alive || !m || this.modal) return;
    if (m.level === 'list') this.hud.setInfo(this._listHelp(m.listKind));
    else if (m.level === 'target' && m.target) this._menuTargetInfo();
  }

  _menuShowTarget(action, targetType, returnTo) {
    const m = this.menu;
    const actor = this.model.get(m.actorId);
    let ids = this.model.getValidTargets(actor.id, action);
    if (!ids.length) {
      this.hud.toast('No valid targets');
      this.sfx('ui_error');
      return;
    }
    const multi = ['allEnemies', 'allAllies', 'randomEnemies'].includes(targetType) || targetType === 'self';
    if (targetType === 'self') ids = [actor.id];
    const byX = [...ids].sort((a, b) => this.views.get(a).home.x - this.views.get(b).home.x || this.views.get(a).home.y - this.views.get(b).home.y);
    const byY = [...ids].sort((a, b) => this.views.get(a).home.y - this.views.get(b).home.y);
    let index = 0;
    const onEnemies = ENEMY_TARGETS.has(targetType);
    if (onEnemies && this.lastEnemyTarget && byY.includes(this.lastEnemyTarget)) index = byY.indexOf(this.lastEnemyTarget);
    else if (!onEnemies && targetType !== 'deadAlly') {
      // Heals: start on the most hurt ally.
      const wants = action.kind === 'item' || (SKILLS[action.id]?.effects ?? []).some((e) => e.type === 'heal');
      if (wants) {
        let best = 0;
        byY.forEach((id, i) => {
          const c = this.model.get(id);
          const b = this.model.get(byY[best]);
          if (c.hp / c.stats.maxHp < b.hp / b.stats.maxHp) best = i;
        });
        index = best;
      } else if (byY.includes(actor.id) && targetType === 'ally') index = byY.indexOf(actor.id);
    }
    m.level = 'target';
    m.target = { action, targetType, ids: byY, byX, index, multi, returnTo, onEnemies };
    this.hud.hideMenu();
    this.hud.hideList();
    this._menuTargetInfo();
    this._targetCamera();
  }

  /** Gentle lean toward the highlighted target (never enough to slide enemies under the menus). */
  _targetCamera() {
    const t = this.menu?.target;
    if (!t) return;
    const ids = t.multi ? t.ids : [t.ids[t.index]];
    const vs = ids.map((id) => this.views.get(id)).filter(Boolean);
    if (!vs.length) return;
    const x = vs.reduce((s, v) => s + v.home.x, 0) / vs.length;
    this.camera.focus(640 + (x - 640) * 0.14, 352, 1.03, 520);
  }

  _menuTargetInfo() {
    const m = this.menu;
    const t = m.target;
    const actor = this.model.get(m.actorId);
    const name = t.action.kind === 'attack' ? actor.basicAttack?.name ?? 'Attack'
      : t.action.kind === 'item' ? ITEMS[t.action.id]?.name ?? t.action.id
        : SKILLS[t.action.id]?.name ?? t.action.id;
    const touch = this._touchMode();
    const help = touch ? `Tap ${t.multi ? 'any target' : 'a target'} to confirm · Back to return`
      : t.multi ? `[[confirm]] confirm · [[cancel]] back` : `[[left]][[right]] choose target · [[confirm]] confirm · [[cancel]] back`;
    if (t.multi) {
      const multiName = t.targetType === 'self' ? `${actor.name.split(' ')[0]} (self)` : t.targetType === 'randomEnemies' ? 'Random enemies' : t.onEnemies ? 'All enemies' : 'All allies';
      this.hud.showTarget({ multi: multiName, sub: name, side: t.onEnemies ? 'enemy' : 'party', help });
    } else {
      const c = this.model.get(t.ids[t.index]);
      this.hud.showTarget(this._targetInfo(c, name, help));
    }
    this.hud.setInfo(`${name} — ${touch ? 'tap' : 'choose'} ${t.multi ? 'to confirm' : 'a target'}`);
  }

  _targetInfo(c, actionName, help) {
    const info = {
      name: c.name, sub: `${actionName}${c.side === 'enemy' ? ` · Lv ${c.level}` : ''}`, hp: c.hp, maxHp: c.stats.maxHp,
      shields: c.shields, breakValue: c.breakValue, breakMax: c.breakMax, broken: c.broken, statuses: c.statuses,
      side: c.side, help, known: true, affinities: null,
    };
    if (c.side === 'enemy') {
      const known = !!this.state?.world?.bestiary?.[c.key];
      const learned = this.knownAff[c.key] ?? {};
      const aff = { weak: [], resist: [], immune: [] };
      for (const [el, mult] of Object.entries(c.affinities ?? {})) {
        const kind = mult === 0 ? 'immune' : mult > 1 ? 'weak' : mult < 1 ? 'resist' : null;
        if (!kind) continue;
        if (known || learned[el]) aff[kind].push(el);
      }
      info.affinities = aff;
      info.known = known;
    }
    return info;
  }

  /** The currently highlighted skill's AP cost (for the card's AP pip preview). */
  _menuCostPreview() {
    const m = this.menu;
    if (!m) return 0;
    if (m.level === 'list' && m.listKind === 'skills') return m.rows[m.listIndex]?.ap ?? 0;
    if (m.level === 'target' && m.target?.action?.kind === 'skill') return SKILLS[m.target.action.id]?.ap ?? 0;
    if (m.level === 'root' && m.rootItems?.[m.rootIndex]?.id === 'freeAim') return 1;
    return 0;
  }

  _menuUpdate() {
    const m = this.menu;
    if (!m || this.modal) return;
    const input = this.game.input;
    const actor = this.model.get(m.actorId);
    if (!actor?.alive) {
      this._menuResolve(null);
      return;
    }
    // Autopilot.
    const ap = this.autopilot();
    if (ap?.commands === 'auto') {
      if (this.worldTime >= m.autoAt) this._menuResolve(this._autoChoose(actor));
      return;
    }
    if (m.level === 'root') {
      const n = m.rootItems.length;
      if (input.pressedRepeat('down')) this._menuMove(1, n);
      else if (input.pressedRepeat('up')) this._menuMove(-1, n);
      else if (this.practice && (input.pressed('left') || input.pressed('right'))) this._cyclePractice(input.pressed('left') ? -1 : 1);
      else if (input.pressed('confirm')) {
        input.consume('confirm');
        this._menuConfirmRoot();
      } else if (input.pressed('cancel') || input.pressed('menu')) {
        const leave = this.practice && input.pressed('cancel');
        input.consume(['cancel', 'menu']);
        if (leave) {
          this.sfx('ui_cancel');
          this._menuResolve({ kind: 'leavePractice' });
        } else this._openPause();
      }
      return;
    }
    if (m.level === 'list') {
      const n = m.rows.length;
      if (input.pressedRepeat('down') && n) {
        m.listIndex = (m.listIndex + 1) % n;
        this.hud.setListIndex(m.listIndex);
        this.sfx('ui_move');
      } else if (input.pressedRepeat('up') && n) {
        m.listIndex = (m.listIndex + n - 1) % n;
        this.hud.setListIndex(m.listIndex);
        this.sfx('ui_move');
      } else if (input.pressed('confirm')) {
        input.consume('confirm');
        this._menuConfirmList();
      } else if (input.pressed('cancel')) {
        input.consume(['cancel', 'menu']);
        this.sfx('ui_cancel');
        this._menuShowRoot();
      } else if (input.pressed('menu')) {
        // Menu alone (Tab, Start, the touch Pause button) pauses from anywhere in the command menus; Escape is both
        // cancel and menu, and cancel wins.
        input.consume(['cancel', 'menu']);
        this._openPause();
      }
      return;
    }
    if (m.level === 'target') {
      const t = m.target;
      if (!t.multi) {
        let d = 0;
        let list = t.ids;
        if (input.pressedRepeat('right')) { d = 1; list = t.byX; }
        else if (input.pressedRepeat('left')) { d = -1; list = t.byX; }
        else if (input.pressedRepeat('down')) d = 1;
        else if (input.pressedRepeat('up')) d = -1;
        if (d) {
          const cur = t.ids[t.index];
          const j = (list.indexOf(cur) + d + list.length) % list.length;
          t.index = t.ids.indexOf(list[j]);
          this.sfx('ui_move');
          this._menuTargetInfo();
          this._targetCamera();
        }
        // Mouse hover / click on the canvas.
        const p = input.pointer;
        if (p.inside && !p.overUI) {
          const w = this.camera.toWorld(p.x, p.y);
          const hitId = this._pickAt(w.x, w.y, t.ids);
          if (hitId && hitId !== t.ids[t.index] && (p.pressed || this._pointerMoved())) {
            t.index = t.ids.indexOf(hitId);
            this.sfx('ui_move', { volume: 0.5 });
            this._menuTargetInfo();
            this._targetCamera();
          }
          if (p.pressed && hitId) {
            this._menuConfirmTarget();
            return;
          }
        }
      } else {
        const p = input.pointer;
        if (p.pressed && p.inside && !p.overUI) {
          const w = this.camera.toWorld(p.x, p.y);
          if (this._pickAt(w.x, w.y, t.ids)) {
            this._menuConfirmTarget();
            return;
          }
        }
      }
      if (input.pressed('confirm')) {
        input.consume('confirm');
        this._menuConfirmTarget();
      } else if (input.pressed('cancel')) {
        input.consume(['cancel', 'menu']);
        this.sfx('ui_cancel');
        if (t.returnTo === 'root') this._menuShowRoot();
        else this._menuShowList(t.returnTo);
      } else if (input.pressed('menu')) {
        input.consume(['cancel', 'menu']);
        this._openPause();
      }
    }
  }

  _pointerMoved() {
    const p = this.game.input.pointer;
    const last = this._lastPointer;
    this._lastPointer = { x: p.x, y: p.y };
    return !last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5;
  }

  _pickAt(x, y, ids) {
    let best = null;
    for (const id of ids) {
      const v = this.views.get(id);
      if (!v) continue;
      const b = v.bounds(this.worldTime);
      const pad = 16;
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) {
        if (!best || v.y > best.y) best = v;
      }
    }
    return best?.id ?? null;
  }

  _menuMove(d, n) {
    const m = this.menu;
    m.rootIndex = (m.rootIndex + d + n) % n;
    this.lastRoot[m.actorId] = m.rootIndex;
    this.hud.setMenuIndex(m.rootIndex);
    this.sfx('ui_move');
  }

  _menuHover(i) {
    const m = this.menu;
    if (!m || m.level !== 'root' || m.rootIndex === i || this.modal) return;
    m.rootIndex = i;
    this.lastRoot[m.actorId] = i;
    this.hud.setMenuIndex(i);
    this.sfx('ui_move', { volume: 0.4 });
  }

  _menuClick(i) {
    const m = this.menu;
    if (!m || m.level !== 'root' || this.modal) return;
    m.rootIndex = i;
    this.hud.setMenuIndex(i);
    this._menuConfirmRoot();
  }

  _listHover(i) {
    const m = this.menu;
    if (!m || m.level !== 'list' || m.listIndex === i || this.modal) return;
    m.listIndex = i;
    this.hud.setListIndex(i);
    this.sfx('ui_move', { volume: 0.4 });
  }

  _listClick(i) {
    const m = this.menu;
    if (!m || m.level !== 'list' || this.modal) return;
    m.listIndex = i;
    this.hud.setListIndex(i);
    this._menuConfirmList();
  }

  _menuConfirmRoot() {
    const m = this.menu;
    const it = m.rootItems[m.rootIndex];
    this.lastRoot[m.actorId] = m.rootIndex;
    if (!it) return;
    if (it.disabled) {
      this.sfx('ui_error');
      this.hud.toast(it.reason ?? 'Unavailable');
      return;
    }
    this.sfx('ui_confirm');
    switch (it.id) {
      case 'attack':
        this._menuShowTarget({ kind: 'attack' }, 'enemy', 'root');
        break;
      case 'skills':
        this._menuShowList('skills');
        break;
      case 'items':
        this._menuShowList('items');
        break;
      case 'gradient':
        this._menuShowList('gradient');
        break;
      case 'freeAim':
        this._menuResolve({ kind: 'freeAim' });
        break;
      case 'flee':
        this._menuResolve({ action: { kind: 'flee' } });
        break;
      case 'practice':
        this._menuResolve({ kind: 'practiceAttack' });
        break;
      case 'leave':
        this._menuResolve({ kind: 'leavePractice' });
        break;
      default:
    }
  }

  _menuConfirmList() {
    const m = this.menu;
    const row = m.rows[m.listIndex];
    if (!row) return;
    if (row.disabled) {
      this.sfx('ui_error');
      this.hud.toast(row.reason ?? 'Unavailable');
      return;
    }
    this.sfx('ui_confirm');
    const kind = m.listKind === 'items' ? 'item' : m.listKind === 'gradient' ? 'gradient' : 'skill';
    this._menuShowTarget({ kind, id: row.id }, row.target ?? 'enemy', m.listKind);
  }

  _menuConfirmTarget() {
    const m = this.menu;
    const t = m.target;
    if (!t) return;
    const targetIds = t.multi ? [...t.ids] : [t.ids[t.index]];
    if (t.onEnemies && !t.multi) this.lastEnemyTarget = targetIds[0];
    this.sfx('ui_confirm');
    this._menuResolve({ action: { ...t.action, targetIds } });
  }

  _cyclePractice(d) {
    if (!this.practice || !this.practiceAttacks?.length) return;
    const list = [null, ...this.practiceAttacks];
    const i = list.indexOf(this.practiceChoice);
    this.practiceChoice = list[(i + d + list.length) % list.length];
    this.sfx('ui_move');
  }

  // ================================================================ autopilot commands

  _autoChoose(actor) {
    const m = this.model;
    const cmds = m.getCommands(actor.id);
    const enemies = m.living('enemy');
    if (!enemies.length) return { action: { kind: 'attack' } };
    const focus = [...enemies].sort((a, b) => a.hp - b.hp)[0];
    const bossE = enemies.find((e) => e.boss);
    if (this.practice && this.partyTurnCount > 30) return { kind: 'leavePractice' };
    // Revive the fallen.
    const dead = m.party.filter((p) => !p.alive);
    if (dead.length) {
      const rek = cmds.skills.find((s) => s.usable && SKILLS[s.id]?.target === 'deadAlly');
      if (rek) return { action: { kind: 'skill', id: rek.id, targetIds: [dead[0].id] } };
      const tonic = cmds.items.find((i) => i.usable && ITEMS[i.id]?.target === 'deadAlly');
      if (tonic) return { action: { kind: 'item', id: tonic.id, targetIds: [dead[0].id] } };
    }
    // Heal the badly hurt.
    const hurt = m.party.filter((p) => p.alive && p.hp / p.stats.maxHp < 0.42).sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp)[0];
    if (hurt) {
      const heal = cmds.skills.find((s) => s.usable && PARTY_TARGETS.has(SKILLS[s.id]?.target) && (SKILLS[s.id]?.effects ?? []).some((e) => e.type === 'heal'));
      if (heal) {
        const def = SKILLS[heal.id];
        const tid = def.target === 'self' ? actor.id : hurt.id;
        return { action: { kind: 'skill', id: heal.id, targetIds: [tid] } };
      }
      if (hurt.hp / hurt.stats.maxHp < 0.3) {
        const tin = cmds.items.find((i) => i.usable && ITEMS[i.id]?.target === 'ally' && (ITEMS[i.id]?.effects ?? []).some((e) => e.type === 'heal'));
        if (tin) return { action: { kind: 'item', id: tin.id, targetIds: [hurt.id] } };
      }
    }
    // Gradient skill when charged.
    const g = cmds.gradient.find((x) => x.usable);
    if (g) return { action: { kind: 'gradient', id: g.id, targetIds: [(bossE ?? focus).id] } };
    // One Free Aim shot per turn now and then (exercises weak points).
    if (!this.turnCtx?.autoAimed && actor.ap >= 5 && cmds.freeAim.usable && this.auxRng.next() < 0.35) return { kind: 'freeAim', auto: true };
    // Best affordable damaging skill.
    let best = null;
    for (const s of cmds.skills) {
      if (!s.usable) continue;
      const def = SKILLS[s.id];
      if (!def?.hits?.length || !ENEMY_TARGETS.has(def.target)) continue;
      const n = def.target === 'allEnemies' ? enemies.length : 1;
      let power = def.hits.reduce((a, h) => a + (h.power ?? 1), 0) * n;
      if (def.surge === 'consume') power *= 1 + 0.2 * (actor.mechanic?.value ?? 0);
      if (def.consumeAllGlyphs) power += (actor.mechanic?.list?.length ?? 0) * (def.consumeAllGlyphs.extraHitPower ?? 1);
      const score = power + def.ap * 0.1;
      if (!best || score > best.score) best = { id: s.id, score };
    }
    if (best) return { action: { kind: 'skill', id: best.id, targetIds: [focus.id] } };
    return { action: { kind: 'attack', targetIds: [focus.id] } };
  }

  // ================================================================ movement helpers

  async _returnHome(view, ms = PARTY_DASH_MS) {
    if (!view) return;
    view.forced = null;
    const d = Math.hypot(view.x - view.home.x, view.y - view.home.y);
    if (d < 6) {
      view.goHome();
      view.play('idle', { loop: true, dur: 1000 });
      return;
    }
    view.facing = -view.baseFacing;
    view.play('run', { loop: true, dur: 560 });
    view.moveTo(view.home.x, view.home.y, ms, 'inOutQuad');
    await this._wait(ms);
    view.goHome();
    view.play('idle', { loop: true, dur: 1000 });
  }

  async _flee(plan) {
    this.model.finishAction(plan);
    this.sfx('dodge');
    this.fx.banner('Retreat!', { style: 'caption', sub: 'The expedition withdraws', life: 1400 });
    let k = 0;
    for (const v of this.views.values()) {
      if (v.side !== 'party' || !this.model.get(v.id)?.alive) continue;
      v.facing = -1;
      v.play('run', { loop: true, dur: 480 });
      v.moveTo(-180, v.y, 760 + k * 90, 'inQuad');
      k += 1;
    }
    this.camera.focus(520, 360, 1.02, 900);
    await this._wait(1000);
  }

  _touchMode() {
    const input = this.game.input;
    if (input?.lastDevice === 'touch') return true;
    try {
      return !!globalThis.matchMedia?.('(pointer: coarse)')?.matches && !globalThis.matchMedia?.('(pointer: fine)')?.matches;
    } catch {
      return false;
    }
  }

  // ================================================================ conclusion

  async _conclude() {
    const outcome = this.model.outcome() ?? 'fled';
    this.mode = 'end';
    this.menu = null;
    this.hud.hideMenu();
    this.hud.hideList();
    this.hud.hideTarget();
    this.hud.setInfo(null);
    this.hud.showLegend(false);
    this.hud.setPractice(null);
    if (outcome === 'victory') await this._victory();
    else if (outcome === 'defeat') await this._defeat();
    else await this._fled();
  }

  _recordBestiary() {
    const w = this.state?.world;
    if (!w) return;
    if (!w.bestiary || typeof w.bestiary !== 'object') w.bestiary = {};
    for (const e of this.model.enemies) w.bestiary[e.key] = true;
  }

  _resultOpts() {
    const opts = {};
    if (this.params.spawnId) opts.spawnId = this.params.spawnId;
    if (this.boss) {
      const b = this.model.enemies.find((e) => e.boss);
      opts.bossId = this.params.bossId ?? this.params.spawnId ?? b?.key;
    }
    return opts;
  }

  async _victory() {
    const summary = this.model.summary();
    for (const v of this.views.values()) {
      if (v.side === 'party' && this.model.get(v.id)?.alive) {
        v.forced = null;
        v.goHome();
        v.play('victory', { loop: true, dur: 1600 });
      }
    }
    this.fx.desaturate(0);
    this._audio((a) => a.playMusic('victory', { fade: 300 }));
    this.sfx('victory');
    this.fx.banner(this.practice ? 'Well Drilled' : 'Victory', { style: 'title', life: 2100, sub: this.practice ? 'Practice complete' : '', color: PALETTE.paleGold });
    this.camera.focus(420, 380, 1.1, 1200);
    const before = (this.state?.party ?? []).map((m) => ({ id: m.id, level: m.level, xp: m.xp }));
    this._recordBestiary();
    let rewards = null;
    if (!this.practice) {
      try {
        rewards = applyBattleResult(this.state, summary, this._resultOpts());
      } catch (err) {
        this.game.reportError(this, 'applyBattleResult', err);
      }
    }
    await this._wait(this.practice ? 1600 : 2150);
    if (!this.alive) return;
    if (!this.practice && rewards) await this._showResults(summary, rewards, before);
    this._finish({ outcome: 'victory', summary, rewards });
  }

  async _showResults(summary, rewards, before) {
    const members = (this.state?.party ?? []).map((m) => {
      const b = before.find((x) => x.id === m.id) ?? { level: m.level, xp: 0 };
      const ups = rewards.levelUps.filter((u) => u.id === m.id);
      const attr = ups.reduce((s, u) => s + (u.attrPoints ?? 0), 0);
      const sp = ups.reduce((s, u) => s + (u.sp ?? 0), 0);
      const skills = rewards.newSkillsAvailable.filter((s) => s.id === m.id).map((s) => SKILLS[s.skillId]?.name ?? s.skillId);
      const gains = [];
      if (ups.length) gains.push(`Level ${m.level}`);
      if (attr) gains.push(`+${attr} attribute points`);
      if (sp) gains.push(`+${sp} SP`);
      if (skills.length) gains.push(`New skill${skills.length > 1 ? 's' : ''}: ${skills.join(', ')}`);
      const ch = CHARACTERS[m.id];
      return {
        id: m.id, name: ch?.name ?? m.id, look: ch?.look ?? m.id, color: ch?.color, level0: b.level, xp0: b.xp,
        gained: rewards.xpByMember?.[m.id] ?? rewards.xpGained ?? 0, gains: gains.join(' · '),
        needFor: (lv) => (lv >= MAX_LEVEL ? 0 : xpToNext(lv)), maxLevel: MAX_LEVEL,
      };
    });
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const loot = [];
    if (rewards.glint) loot.push({ iconSrc: mechanicIcon('glint', 20), html: `<b>+${rewards.glint}</b> Glint` });
    for (const id of rewards.drops ?? []) loot.push({ iconSrc: mechanicIcon('relic', 20), html: `New relic · <b>${esc(RELICS[id]?.name ?? id)}</b>` });
    for (const c of rewards.converted ?? []) loot.push({ iconSrc: mechanicIcon('glint', 20), html: `Duplicate ${esc(RELICS[c.id]?.name ?? c.id)} → <b>+${c.glint}</b> Glint` });
    for (const id of rewards.mastered ?? []) loot.push({ iconSrc: mechanicIcon('echo', 20), html: `Mastered · <b>${esc(RELICS[id]?.name ?? id)}</b> — its Echo can now be equipped` });
    const st = summary.stats ?? {};
    const bits = [];
    if (st.parries) bits.push(`${st.parries} parr${st.parries === 1 ? 'y' : 'ies'}`);
    if (st.perfectDodges) bits.push(`${st.perfectDodges} perfect dodge${st.perfectDodges === 1 ? '' : 's'}`);
    if (st.jumps) bits.push(`${st.jumps} jump${st.jumps === 1 ? '' : 's'}`);
    if (st.gradientCounters) bits.push(`${st.gradientCounters} Prism Counter${st.gradientCounters === 1 ? '' : 's'}`);
    if (st.counters) bits.push(`${st.counters} counter${st.counters === 1 ? '' : 's'}`);
    if (st.perfects) bits.push(`${st.perfects} perfect strike${st.perfects === 1 ? '' : 's'}`);
    bits.push(`${st.rounds ?? summary.stats?.rounds ?? 1} round${(st.rounds ?? 1) === 1 ? '' : 's'}`);
    this.hud.showResults({
      title: 'Victory', sub: this.encounter?.name ?? [...new Set(this.model.enemies.map((e) => e.baseName ?? e.name))].join(' · '),
      members, loot, stats: bits.join(' · '),
    });
    this.modal = { kind: 'results', ready: false, resolve: null };
    const done = new Promise((res) => { this.modal.resolve = res; });
    const t0 = this.game.time;
    const DUR = 1500;
    let leveled = new Set();
    await this._until(() => {
      const u = clamp((this.game.time - t0 - 250) / DUR, 0, 1);
      this.hud.setResultsProgress(u);
      // Level-up chimes as bars cross thresholds.
      for (const mm of members) {
        const ups = rewards.levelUps.filter((x) => x.id === mm.id).length;
        if (ups && !leveled.has(mm.id) && u > 0.45) {
          leveled.add(mm.id);
          this.sfx('level_up');
        }
      }
      return u >= 1 || !this.alive;
    });
    if (rewards.glint) this.sfx('coin');
    if (this.modal?.kind === 'results') {
      this.modal.ready = true;
      this.modal.readyAt = this.game.time;
      this.hud.setResultsReady(true);
    }
    await done;
    this.hud.hideResults();
    await this._waitReal(160);
  }

  async _defeat() {
    const summary = this.model.summary();
    this.baseScale = 0.4;
    this._setClockScale(this._wantScale());
    this.fx.desaturate(0.8);
    this.fx.vignette(PALETTE.crimson, 2600, 0.6);
    this.camera.focus(340, 420, 1.12, 1600);
    this._audio((a) => a.playMusic('gameover', { fade: 600 }));
    this.sfx('defeat');
    await this._wait(420);
    this.fx.banner('The Expedition Falters', { style: 'title', size: 66, color: '#e8826f', sub: 'Sixty-nine is not the last number', life: 3200 });
    await this._wait(1250);
    this._recordBestiary();
    let rewards = null;
    try {
      rewards = applyBattleResult(this.state, summary, this._resultOpts());
    } catch (err) {
      this.game.reportError(this, 'applyBattleResult', err);
    }
    this.baseScale = 1;
    this._setClockScale(this._wantScale());
    await this._waitReal(900);
    this._finish({ outcome: 'defeat', summary, rewards });
  }

  async _fled() {
    const summary = this.model.summary();
    this._recordBestiary();
    let rewards = null;
    try {
      rewards = applyBattleResult(this.state, summary, this._resultOpts());
    } catch (err) {
      this.game.reportError(this, 'applyBattleResult', err);
    }
    await this._waitReal(250);
    this._finish({ outcome: 'fled', summary, rewards });
  }

  _finish(result) {
    if (this._finished) return;
    this._finished = true;
    this.lastResult = result;
    const scenes = this.game.scenes;
    try {
      if (scenes.top === this) scenes.pop(result);
      else if (scenes.has?.(this.name)) {
        // Something sits above the battle (should not happen): unwind to it.
        while (scenes.top && scenes.top !== this) scenes.pop();
        if (scenes.top === this) scenes.pop(result);
      }
    } catch (err) {
      this.game.reportError(this, 'battle exit', err);
    }
    try {
      this.params.onEnd?.(result);
    } catch (err) {
      this.game.reportError(this, 'battle onEnd', err);
    }
  }

  // ================================================================ frame

  update(dt) {
    if (!this.model) return;
    const t0 = globalThis.performance?.now?.() ?? 0;
    this._tickClock();
    const s = this.game.settings ?? {};
    this.settings = s;
    this.fx.reducedFlashing = !!s.reducedFlashing;
    this.fx.shakeEnabled = s.screenShake !== false;

    const modal = this._handleModal();
    if (!modal) {
      if (this.freeAimCtl?.active) {
        const input = this.game.input;
        if (input.pressed('menu') && !input.pressed('cancel')) {
          input.consume(['cancel', 'menu']);
          this._openPause();
        } else {
          this.freeAimCtl.update(dt);
          this.hud.setFreeAim(this.freeAimCtl.active ? this.freeAimCtl.status() : null);
        }
      }
      if (this.menu) this._menuUpdate();
    }
    if (this.enemyRun) this._updateEnemyRun();
    if (this.partyRun) this._updatePartyRun();

    // Views.
    const w = this.worldTime;
    const wdt = this.worldDt;
    for (const c of this.model.combatants) {
      const v = this.views.get(c.id);
      if (!v) continue;
      if (v.fadeIn) {
        v.alpha = clamp((w - v.fadeIn.t0) / v.fadeIn.dur, 0, 1);
        if (v.alpha >= 1) v.fadeIn = null;
      }
      v.broken = c.side === 'enemy' && !!c.broken;
      v.phase = c.phaseIndex ?? 0;
      v.mechanic = c.mechanic;
      const chill = c.statuses?.some((st) => st.id === 'chill');
      v.tint = chill ? { color: '#9fd9f0', amount: 0.3 } : null;
      v.update(w, wdt);
      if (v.side === 'enemy' && v.anim === 'ko' && v.animDone && !c.alive) v.dead = true;
      if (v.side === 'enemy' && c.alive && v.dead) v.dead = false;
    }
    this.fx.update(wdt, dt);
    this.camera.update(this._clockScale === 0 ? 0 : Math.max(wdt, dt * 0.35));
    if (this.bgPhase !== this._bgPhaseTarget) {
      this.bgPhase = this._bgPhaseTarget > this.bgPhase ? Math.min(this._bgPhaseTarget, this.bgPhase + wdt / 1600) : this._bgPhaseTarget;
    }
    this._ringRuns = this._ringRuns.filter((r) => r === this.partyRun || this.worldTime - r.t0 < r.endT + 900);

    this._tickTasks();
    this._syncHud();
    const t1 = globalThis.performance?.now?.() ?? 0;
    this.perf.update = this.perf.update * 0.9 + (t1 - t0) * 0.1;
  }

  _updateEnemyRun() {
    const run = this.enemyRun;
    const input = this.game.input;
    for (const p of input.framePresses(DEFENSE_ACTIONS)) run.press(p.action, this.worldAt(p.t) - run.t0);
    const local = this.worldTime - run.t0;
    run.update(local);
    const locked = run.tracker.isLocked(local);
    this.hud.setLegendLocked(locked);
    if (locked) this._sendLockout(run);
  }

  _updatePartyRun() {
    const run = this.partyRun;
    const input = this.game.input;
    for (const p of input.framePresses(['qte'])) {
      const localT = this.worldAt(p.t) - run.t0;
      const r = run.press(localT);
      if (r?.reason === 'whiff') {
        this.sfx('whiff', { volume: 0.6 });
        if (this._feedback()) {
          // Signed against the nearest prompt: a press after it is late, not early.
          const tc = localT - run.calibration;
          let near = -1;
          run.T.forEach((t, i) => {
            if (run.hits[i]?.qte && (near < 0 || Math.abs(t - tc) < Math.abs(run.T[near] - tc))) near = i;
          });
          const tv = this.views.get((near >= 0 ? run._ringTarget(run.hits[near]) : null) ?? run.plan.targetIds?.[0]);
          if (tv) {
            const a = tv.anchors(this.worldTime);
            const text = near >= 0 && tc > run.T[near] ? 'Too late' : 'Too early';
            this.fx.text(a.head.x, a.head.y - 60, text, { size: 15, color: '#ffb3a0', life: 600, rise: 16, anchorId: tv.id });
          }
        }
      }
    }
    run.update(this.worldTime - run.t0);
  }

  _syncHud() {
    const m = this.model;
    const hud = this.hud;
    const ids = m.turn.actorId && !m.turn.ended ? [m.turn.actorId, ...m.peekTurnOrder(7)] : m.peekTurnOrder(8);
    hud.syncTurnOrder(ids, m);
    const activeId = this.currentId && m.get(this.currentId)?.side === 'party' ? this.currentId : null;
    const aimed = this.menu?.level === 'target' && !this.menu.target.onEnemies
      ? (this.menu.target.multi ? this.menu.target.ids : [this.menu.target.ids[this.menu.target.index]]) : [];
    hud.syncParty(m, { activeId, aimedIds: aimed, costAp: this._menuCostPreview() });
    hud.syncGradient(m.gradient);
    if (this.menu?.level === 'root') {
      const actor = m.get(this.menu.actorId);
      if (actor && this._changedKey('menuAp', `${actor.id}:${actor.ap}:${m.gradient}`)) this._menuShowRoot();
    }
    if (this.practice && this.mode !== 'end') {
      const id = this.practiceChoice;
      const atk = id ? m.enemies[0]?.attacks?.[id] : null;
      hud.setPractice({
        attackName: atk ? atk.name : 'Random attack', attackDesc: atk?.desc ?? 'The mannequin picks for itself.',
        log: this.practiceLog, canCycle: true,
      });
    }
  }

  _changedKey(k, v) {
    if (!this._keys) this._keys = new Map();
    if (this._keys.get(k) === v) return false;
    this._keys.set(k, v);
    return true;
  }

  // ================================================================ rendering

  render(ctx) {
    if (!this.model) return;
    const t0 = globalThis.performance?.now?.() ?? 0;
    const t = this.worldTime;
    const fx = this.fx;
    const cam = this.camera;
    drawBattleBackground(ctx, this.zone, t, { camera: cam.offset, phase: this.bgPhase });
    const shake = fx.shakeOffset();
    const views = [...this.views.values()].filter((v) => !v.dead && !v.hidden).sort((a, b) => a.y - b.y);

    ctx.save();
    cam.apply(ctx, shake);
    this._renderGround(ctx, t);
    for (const v of views) if (!v.vivid) drawActor(ctx, v.look, v.pose(t));
    ctx.restore();

    if (fx.desaturation > 0.002) applyDesaturation(ctx, fx.desaturation, { tint: PALETTE.violet });

    ctx.save();
    cam.apply(ctx, shake);
    for (const v of views) if (v.vivid) drawActor(ctx, v.look, v.pose(t));
    fx.render(ctx);
    // Depth fix for ground shockwaves: party members in front of a rolling wave's lane go over it.
    this._waveLanes = this._waveLanes.filter((l) => l.until > t);
    if (this._waveLanes.length) {
      const laneY = Math.min(...this._waveLanes.map((l) => l.y));
      for (const v of views) if (!v.vivid && v.side === 'party' && v.y > laneY + 20) drawActor(ctx, v.look, v.pose(t));
    }
    this._renderWorldUi(ctx, t);
    ctx.restore();

    this._renderBossBar(ctx);
    fx.renderScreen(ctx);
    const t1 = globalThis.performance?.now?.() ?? 0;
    const p = this.perf;
    p.render = p.render * 0.9 + (t1 - t0) * 0.1;
    p.frames += 1;
    const frameMs = p.update + p.render;
    p.worst = Math.max(p.worst * 0.995, t1 - t0);
    p.avgFrame = p.avgFrame * 0.95 + (this.game.dt || 16.7) * 0.05;
    p.cost = frameMs;
  }

  _renderGround(ctx, t) {
    // Active party member: a soft gold ring on the floor.
    const id = this.currentId;
    const c = id ? this.model.get(id) : null;
    if (c?.side === 'party' && this.menu) {
      const v = this.views.get(id);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.005);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(243, 219, 160, ${0.35 + pulse * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(v.x, v.y + 2, 58 + pulse * 5, 15 + pulse * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Nova / cast ground runes under targets during wind-ups.
    const run = this.enemyRun;
    if (!run) return;
    const local = t - run.t0;
    for (const ch of run.charges(local)) {
      if (ch.kind !== 'nova') continue;
      const col = ch.hit.type === 'gradient' ? '#c77dff' : ch.hit.type === 'unparryable' ? '#ff4a3d' : ELEMENT_COLORS[ch.hit.element] ?? '#ffffff';
      for (const id2 of ch.hit.targetIds ?? []) {
        const v = this.views.get(id2);
        if (!v || !this.model.get(id2)?.alive) continue;
        ctx.save();
        ctx.translate(v.x, v.home.y + 2);
        ctx.scale(1, 0.32);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexA(col, 0.25 + ch.u * 0.55);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 78, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 6;
        ctx.strokeStyle = hexA(col, 0.6 + ch.u * 0.35);
        ctx.beginPath();
        ctx.arc(0, 0, 78, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ch.u);
        ctx.stroke();
        ctx.fillStyle = hexA(col, 0.08 + ch.u * 0.16);
        ctx.beginPath();
        ctx.arc(0, 0, 78 * ch.u, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  _renderWorldUi(ctx, t) {
    const m = this.model;
    const now = this.game.time;
    // Enemy bars.
    for (const c of m.enemies) {
      const v = this.views.get(c.id);
      if (!v || !c.alive || v.dead || c.boss) continue;
      const targeted = this.menu?.level === 'target' && this.menu.target.onEnemies && (this.menu.target.multi || this.menu.target.ids[this.menu.target.index] === c.id);
      // Bars stay at the slot; they fade while the enemy is off attacking.
      const away = clamp(Math.hypot(v.x - v.home.x, v.y - v.home.y) / 90, 0, 1);
      if (away >= 0.99) continue;
      drawEnemyBars(ctx, v.home.x, v.barY, {
        hp: c.hp, maxHp: c.stats.maxHp, breakValue: c.breakValue, breakMax: c.breakMax, shields: c.shields, broken: c.broken,
        statuses: (c.statuses ?? []).map((s) => s.id), name: c.name, width: 140, id: c.id, t: now, alpha: v.alpha * (1 - away) * (targeted || !this.menu ? 1 : 0.88),
      });
    }
    // Target markers (party targeting).
    if (this.menu?.level === 'target') {
      const tg = this.menu.target;
      const ids = tg.multi ? tg.ids : [tg.ids[tg.index]];
      for (const id of ids) {
        const v = this.views.get(id);
        if (!v) continue;
        const c = m.get(id);
        const y = c.side === 'enemy' && !c.boss ? v.barY - 12 : v.headY - 26;
        drawTargetMarker(ctx, v.x, y, { t: now, color: c.side === 'enemy' ? PALETTE.gold : '#9fe0ff' });
      }
    }
    // Enemy attack: who is being targeted (announce + approach).
    const run = this.enemyRun;
    if (this.attackTargets && (!run || t - run.t0 < 700)) {
      for (const id of this.attackTargets) {
        const v = this.views.get(id);
        if (!v || !m.get(id)?.alive) continue;
        drawTargetMarker(ctx, v.x, v.headY - 30, { t: now, color: '#ff6a55', scale: 0.85 });
      }
    }
    if (run) {
      const local = t - run.t0;
      // Beam aim lines.
      const attacker = run.attacker;
      for (const ch of run.charges(local)) {
        if (ch.kind !== 'beam' || !attacker) continue;
        const a = attacker.anchors(t);
        const from = a.cast ?? a.weapon;
        const col = ch.hit.type === 'gradient' ? '#d9a8ff' : ch.hit.type === 'unparryable' ? '#ff6a55' : '#ffffff';
        for (const id of ch.hit.targetIds ?? []) {
          const v = this.views.get(id);
          if (!v) continue;
          const ta = v.anchors(t);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = hexA(col, 0.1 + ch.u * 0.45);
          ctx.lineWidth = 1 + ch.u * 3;
          ctx.setLineDash([10, 8]);
          ctx.lineDashOffset = -t * 0.12;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(ta.chest.x, ta.chest.y);
          ctx.stroke();
          ctx.restore();
        }
      }
      const locked = run.lock && run.tracker.isLocked(local) ? run.lock : null;
      // Assist cues: farthest from impact first, so the hit about to land is drawn on top; only the next hit waiting
      // for a press carries a key label (a later hit's cue stays small, faint and unlabelled until then).
      if (this.settings?.assistCues !== false) {
        for (const cue of run.cues(local)) {
          const a = cue.view.anchors(t);
          const dim = locked?.ids.includes(cue.targetId) ? 0.4 : 1;
          const alpha = (cue.shatter ? 1 - cue.shatter : cue.primary ? 1 : 0.5) * dim;
          drawDefenseCue(ctx, a.chest.x, a.chest.y, {
            progress: cue.progress, type: cue.type, label: cue.primary ? this._cueLabel(cue.type) : '', t: now,
            radius: 72 * (1 + (cue.shatter ?? 0) * 0.35), alpha, groundY: cue.view.home.y,
          });
        }
      }
      if (locked) this._drawLockout(ctx, locked, local);
    }
    // Offensive QTE rings: every ring closes at the same speed, so fast skills overlap them. Rating flourishes go
    // faint under a newer ring, later rings stay faint and unlabelled, and the next ring to press on is drawn last.
    for (const r of this._ringRuns) {
      const local = t - r.t0;
      const rings = r.rings(local).sort((x, y) => (x.rating ? 0 : x.primary ? 2 : 1) - (y.rating ? 0 : y.primary ? 2 : 1));
      for (const ring of rings) {
        const v = ring.targetId ? this.views.get(ring.targetId) : null;
        if (!v) continue;
        const a = v.anchors(t);
        drawQteRing(ctx, a.chest.x, a.chest.y, {
          progress: ring.progress, radius: 92, label: ring.primary ? this._label('qte') : '', rating: ring.rating, ratingAge: ring.ratingAge, t: now,
          color: r.plan.kind === 'gradient' ? '#e6ccff' : '#ffffff', alpha: ring.rating ? (ring.busy ? 0.4 : 1) : ring.primary ? 1 : 0.55,
        });
      }
    }
    // Free aim.
    this.freeAimCtl?.render(ctx, t);
  }

  /** Lockout marker on the locked-out defender: a grey ring that drains as the lockout runs out, with a cross. */
  _drawLockout(ctx, lock, local) {
    const total = Math.max(1, lock.until - lock.from);
    const left = clamp((lock.until - local) / total, 0, 1);
    for (const id of lock.ids) {
      const v = this.views.get(id);
      if (!v || !this.model.get(id)?.alive) continue;
      const a = v.anchors(this.worldTime);
      const x = a.chest.x;
      const y = a.chest.y;
      const r = 17;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.fillStyle = 'rgba(16, 12, 10, 0.62)';
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(190, 182, 170, 0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(236, 226, 210, 0.95)';
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.stroke();
      ctx.strokeStyle = '#ffb3a0';
      ctx.lineWidth = 3.2;
      const k = 6.5;
      ctx.beginPath();
      ctx.moveTo(x - k, y - k);
      ctx.lineTo(x + k, y + k);
      ctx.moveTo(x + k, y - k);
      ctx.lineTo(x - k, y + k);
      ctx.stroke();
      ctx.restore();
    }
  }

  _renderBossBar(ctx) {
    const boss = this.model.enemies.find((e) => e.boss && e.alive);
    if (!boss) return;
    const v = this.views.get(boss.id);
    drawEnemyBars(ctx, 1010, 22, {
      hp: boss.hp, maxHp: boss.stats.maxHp, breakValue: boss.breakValue, breakMax: boss.breakMax, shields: boss.shields,
      broken: boss.broken, statuses: (boss.statuses ?? []).map((s) => s.id), name: boss.name, width: 440, boss: true, id: boss.id,
      t: this.game.time, alpha: v?.alpha ?? 1,
    });
  }

  // ================================================================ debug

  /**
   * End the fight as a victory right now (game.debug.winBattle): the model is ended and whatever the turn loop is
   * waiting on (command menu, free aim, a hint) is released so the loop reaches the results immediately.
   * @returns {boolean}
   */
  debugWin() {
    if (!this.model || this._finished || !this.alive) return false;
    if (!this.model.outcome()) this.model.endBattle('victory');
    if (this.modal?.kind === 'pause') this._closePause();
    if (this.modal?.kind === 'hint') this._closeModal('hint');
    if (this.freeAimCtl) this.freeAimCtl.active = false;
    if (this.menu) this._menuResolve(null);
    return true;
  }

  _debugUpcomingHits() {
    const run = this.enemyRun;
    if (!run) return null;
    const local = this.worldTime - run.t0;
    const scale = this._clockScale || 1;
    return {
      name: run.plan.name, local, scale, realNow: this.game.time,
      hits: run.hits.map((h, i) => ({
        index: i, t: h.t, type: h.type, targets: h.targetIds, resolved: run.resolved[i]?.outcome ?? null, offset: run.resolved[i]?.offset ?? null,
        realIn: (h.t - local) / scale,
      })),
    };
  }

  _debugState() {
    return {
      mode: this.mode, current: this.currentId, menu: this.menu ? { level: this.menu.level, list: this.menu.listKind } : null,
      modal: this.modal?.kind ?? null, hint: this.modal?.key ?? null, baseScale: this.baseScale, enemyRun: !!this.enemyRun, partyRun: !!this.partyRun, freeAim: !!this.freeAimCtl,
      outcome: this.model.outcome(), round: this.model.round, turn: this.model.turn.number, gradient: this.model.gradient,
      party: this.model.party.map((p) => ({ id: p.id, key: p.key, hp: p.hp, ap: p.ap, alive: p.alive })),
      enemies: this.model.enemies.map((e) => ({ id: e.id, key: e.key, hp: e.hp, alive: e.alive, phase: e.phaseIndex, shields: e.shields, broken: e.broken })),
      perf: { ...this.perf }, stats: { ...this.model.stats }, finished: this._finished, errors: this._errors,
    };
  }
}

function hexA(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(a, 0, 1)})`;
}
