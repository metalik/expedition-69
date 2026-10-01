// Battle choreography for Expedition 69: per-combatant animation views (ActorView), the battle layout,
// and the two timed runners that drive real-time QTE sequences — EnemyAttackRun (approach, telegraphs,
// wind-ups ending exactly on each hit's impact, projectiles / shockwaves / beams / novas, DefenseTracker
// judging) and PartyActionRun (dash / cast / shoot, offensive QTE rings closing on each hit, OffenseTracker).
// Runner poses are pure functions of attack-local time, so hit-stop and slow motion (which slow the
// battle clock) keep animation, effects and judging in perfect lockstep.

import { DefenseTracker, OffenseTracker, perfectAction } from './qte.js';
import { getAnchors, getBounds, lookHeight } from '../render/sprites.js';
import { ELEMENT_COLORS, HIT_TYPE_COLORS, PALETTE } from '../render/palette.js';
import { clamp, lerp } from '../core/util.js';
import { Ease } from '../core/tween.js';

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

/** Party feet positions p0..p2 (SPEC §3.2). */
export const PARTY_SLOTS = Object.freeze([
  Object.freeze({ x: 390, y: 470 }), Object.freeze({ x: 265, y: 565 }), Object.freeze({ x: 250, y: 385 }),
]);
/** Enemy feet positions e0..e2. */
export const ENEMY_SLOTS = Object.freeze([
  Object.freeze({ x: 905, y: 470 }), Object.freeze({ x: 1045, y: 380 }), Object.freeze({ x: 1050, y: 575 }),
]);
/** A lone boss stands here. */
export const BOSS_SLOT = Object.freeze({ x: 960, y: 500 });

/** Enemy melee approach time (ms) — the bestiary's melee timelines assume it (first hit t ≥ 850). */
export const ENEMY_APPROACH_MS = 450;
/** Party melee dash time (ms). */
export const PARTY_DASH_MS = 400;
/**
 * Offensive QTE ring lead (ms): every ring appears this long before its hit and closes on it, so all rings shrink
 * at the same speed (later rings of a fast skill overlap the earlier ones instead of closing faster).
 */
export const QTE_RING_LEAD = 480;
/** Assist cue lead (ms) before each enemy hit (feints included — they look like normal hits). */
export const ASSIST_CUE_LEAD = 550;
/** A feint's cue is drawn as a normal one and shatters this long before the feint's T (ms), before its bait zone. */
export const FEINT_CUE_BREAK = 250;
/** How long a shattered feint cue takes to fade out (ms). */
export const FEINT_SHATTER_MS = 180;
/** Shortest follow-through an enemy strike keeps when the next wind-up needs the time (ms). */
export const MIN_FOLLOW_MS = 30;
/** A wind-up is never shown shorter than this unless the data declares a shorter one (ms). */
export const MIN_VISIBLE_WINDUP = 200;
/**
 * Default lead of the Prism telegraph swell (ms): its climax (the cut) lands on the hit's T. The battle scene passes
 * the value measured from the SFX envelope (audio.js SFX_INFO.telegraph_gradient.climax).
 */
export const GRADIENT_SWELL_LEAD = 580;

// Melee staging (stage px). The floor band is FLOOR_BAND 360–640 in backgrounds.js; attackers stay just inside it.
const MELEE_BITE = 8; // how far a weapon tip sinks past the target's body front at contact
const LANE_MIN_Y = 372;
const LANE_MAX_Y = 634;
/** Lanes (feet y offsets) an attacker may take in front of its target, towards the camera; the own lane first. */
const LANE_DROPS = [0, 20, 40, 60, 80];
/** Share of a bystander's body an attacker may cover before that party member makes room. */
const BYSTANDER_OVERLAP = 0.06;
/** Farthest a bystander steps aside (px); beyond that it fades back instead. */
const BYSTANDER_MAX_STEP = 170;
const BYSTANDER_OUT_MS = 380;
const BYSTANDER_BACK_MS = 320;

/** Party skill anims that dash into melee range. */
export const PARTY_MELEE_ANIMS = new Set(['slash', 'thrust', 'flurry', 'heavy', 'leap', 'spin']);
/** Enemy hit anims whose effect travels (launched early so it arrives exactly at the hit time). */
const TRAVEL_ANIMS = new Set(['bolt', 'wave']);

/** Sprite aura per enemy hit type (feints look like normal hits). */
export const HIT_AURA = Object.freeze({ normal: 'white', feint: 'white', unparryable: 'red', jump: 'gold', gradient: 'gradient' });

/**
 * Home (feet) position of a combatant.
 * @param {'party'|'enemy'} side
 * @param {number} slot
 * @param {{loneBoss?:boolean}} [opts]
 */
export function slotPosition(side, slot, { loneBoss = false } = {}) {
  if (side === 'party') return { ...(PARTY_SLOTS[slot] ?? PARTY_SLOTS[0]) };
  if (loneBoss) return { ...BOSS_SLOT };
  return { ...(ENEMY_SLOTS[slot] ?? ENEMY_SLOTS[0]) };
}

/** Projectile kind + colour for an element (enemy and party ranged hits). */
export function projectileFor(element, { glyph = false } = {}) {
  const color = ELEMENT_COLORS[element] ?? PALETTE.paleGold;
  if (glyph) return { kind: 'glyph', color };
  switch (element) {
    case 'lightning': return { kind: 'bolt', color };
    case 'earth': return { kind: 'thorn', color: PALETTE.leaf };
    case 'light': return { kind: 'glyph', color };
    case 'physical': return { kind: 'bullet', color: PALETTE.paleGold };
    case 'fire':
    case 'ice':
    case 'dark':
    default: return { kind: 'orb', color };
  }
}

const EASES = Ease;

// ---------------------------------------------------------------------------------------------
// ActorView — one drawable combatant with a small animation state machine
// ---------------------------------------------------------------------------------------------

/**
 * Visual state of one combatant. Anim p is derived from the battle's world clock, so hit-stop slows every
 * view in step. A runner may force a pose for a frame via `forced` ({anim, variant, p}).
 */
export class ActorView {
  /**
   * @param {{id:string, look:string, side:'party'|'enemy', home:{x:number,y:number}, facing?:number, scale?:number, seed?:number}} o
   */
  constructor({ id, look, side, home, facing, scale = 1, seed = 0 }) {
    this.id = id;
    this.look = look;
    this.side = side;
    this.home = { x: home.x, y: home.y };
    this.x = home.x;
    this.y = home.y;
    this.baseFacing = facing ?? (side === 'party' ? 1 : -1);
    this.facing = this.baseFacing;
    this.scale = scale;
    this.seed = seed;
    this.height = lookHeight(look) * scale;
    this.now = 0;
    this.anim = 'idle';
    this.variant = null;
    this._t0 = 0;
    this._dur = 1;
    this._p0 = 0;
    this._p1 = 1;
    this._loop = false;
    this._hold = false;
    this._then = 'idle';
    this._ease = null;
    this.flash = 0;
    this.alpha = 1;
    this.aura = null;
    this.tint = null;
    this.broken = false;
    this.phase = 0;
    this.mechanic = null;
    this.offX = 0;
    this.offY = 0;
    this._vx = 0;
    this._move = null;
    this.forced = null;
    this.dead = false;
    this.hidden = false;
    /** Vivid actors are drawn after the gradient desaturation pass (the source of a gradient attack). */
    this.vivid = false;
  }

  /**
   * Start an animation.
   * @param {string} anim
   * @param {{variant?:string|null, dur?:number, p0?:number, p1?:number, loop?:boolean, hold?:boolean, then?:string, ease?:string}} [o]
   */
  play(anim, { variant = null, dur = 400, p0 = 0, p1 = 1, loop = false, hold = false, then = 'idle', ease = null } = {}) {
    this.anim = anim;
    this.variant = variant;
    this._t0 = this.now;
    this._dur = Math.max(1, dur);
    this._p0 = p0;
    this._p1 = p1;
    this._loop = loop;
    this._hold = hold;
    this._then = then;
    this._ease = ease ? EASES[ease] ?? null : null;
    return this;
  }

  /** Current anim progress 0..1 (before easing to p range). */
  get animU() {
    return clamp((this.now - this._t0) / this._dur, 0, 1);
  }

  /** True once a non-looping, non-held anim has run its course. */
  get animDone() {
    return !this._loop && this.now - this._t0 >= this._dur;
  }

  /**
   * Glide to a position.
   * @param {number} x
   * @param {number} y
   * @param {number} dur ms
   * @param {string} [ease='outQuad']
   */
  moveTo(x, y, dur, ease = 'inOutQuad') {
    this._move = { fx: this.x, fy: this.y, tx: x, ty: y, t0: this.now, dur: Math.max(1, dur), ease: EASES[ease] ?? EASES.inOutQuad };
    return this;
  }

  /** True while a moveTo is running. */
  get moving() {
    return !!this._move;
  }

  /** Snap back home (position, facing). */
  goHome() {
    this._move = null;
    this.x = this.home.x;
    this.y = this.home.y;
    this.facing = this.baseFacing;
  }

  /** Knockback impulse along x (px/s), springs back to 0. */
  kick(vx) {
    this._vx += vx;
  }

  /** @param {number} now world ms  @param {number} dt world ms */
  update(now, dt) {
    this.now = now;
    const d = Math.max(0, Math.min(dt, 100));
    if (this._move) {
      const m = this._move;
      const u = clamp((now - m.t0) / m.dur, 0, 1);
      const e = m.ease(u);
      this.x = lerp(m.fx, m.tx, e);
      this.y = lerp(m.fy, m.ty, e);
      if (u >= 1) this._move = null;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - d / 220);
    // Damped spring for knockback offsets.
    if (this._vx !== 0 || this.offX !== 0) {
      const s = d / 1000;
      this._vx += (-this.offX * 180 - this._vx * 18) * s;
      this.offX += this._vx * s;
      if (Math.abs(this.offX) < 0.05 && Math.abs(this._vx) < 1) {
        this.offX = 0;
        this._vx = 0;
      }
    }
    if (!this._loop && !this._hold && this.anim !== 'idle' && now - this._t0 >= this._dur) {
      if (this.anim === 'ko') return;
      this.play(this._then || 'idle', { loop: true, dur: 1000 });
    }
  }

  /** Pose object for drawActor at world time `now`. */
  pose(now = this.now) {
    let anim = this.anim;
    let variant = this.variant;
    let p;
    if (this.forced) {
      anim = this.forced.anim;
      variant = this.forced.variant ?? null;
      p = clamp(this.forced.p ?? 0, 0, 1);
    } else if (this._loop) {
      p = (((now - this._t0) / this._dur) % 1 + 1) % 1;
    } else {
      let u = clamp((now - this._t0) / this._dur, 0, 1);
      if (this._ease) u = this._ease(u);
      p = this._p0 + (this._p1 - this._p0) * u;
    }
    return {
      x: this.x + this.offX,
      y: this.y + this.offY,
      scale: this.scale,
      facing: this.facing,
      anim,
      variant,
      p,
      t: now,
      flash: this.flash,
      tint: this.tint,
      alpha: this.alpha,
      aura: this.aura,
      broken: this.broken,
      phase: this.phase,
      mechanic: this.mechanic,
      seed: this.seed,
    };
  }

  /** Anchors at the current pose. */
  anchors(now = this.now) {
    return getAnchors(this.look, this.pose(now));
  }

  /** Body bounds at the current pose. */
  bounds(now = this.now) {
    return getBounds(this.look, this.pose(now));
  }

  /** Neutral-pose anchors at home (stable positions for UI: markers, bars). */
  homeAnchors() {
    return getAnchors(this.look, { x: this.home.x, y: this.home.y, scale: this.scale, facing: this.baseFacing, anim: 'idle', t: 0, seed: this.seed });
  }
}

/** Half body width of a view (for melee spacing). */
export function halfWidth(view) {
  try {
    const b = getBounds(view.look, { x: 0, y: 0, scale: view.scale, facing: 1, anim: 'idle', t: 0 });
    return clamp(b.w / 2, 24, 150);
  } catch {
    return 50;
  }
}

/** Idle body box of a view with its feet at (x, y) (defaults to its home). */
function bodyBox(view, x = view.home.x, y = view.home.y) {
  try {
    return getBounds(view.look, { x, y, scale: view.scale, facing: view.baseFacing, anim: 'idle', t: 0, seed: view.seed });
  } catch {
    const w = halfWidth(view);
    return { x: x - w, y: y - view.height, w: w * 2, h: view.height };
  }
}

function boxUnion(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function boxOverlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const boxShift = (b, dx, dy) => ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
const boxArea = (b) => Math.max(1, b.w * b.h);

/**
 * Melee strike geometry of one attack variant, relative to the attacker's feet: how far ahead of the feet the
 * weapon tip is at contact (strike p = 0), the tip's height, and the body box over the wind-up and the strike.
 * @param {ActorView} view
 * @param {string|null} variant
 * @returns {{reach:number, tipY:number, box:{x:number,y:number,w:number,h:number}}}
 */
export function strikeGeometry(view, variant) {
  const base = { x: 0, y: 0, scale: view.scale, facing: view.baseFacing, t: 0, seed: view.seed, variant };
  try {
    const tip = getAnchors(view.look, { ...base, anim: 'strike', p: 0 }).tip;
    let box = getBounds(view.look, { ...base, anim: 'idle' });
    for (const [anim, p] of [['windup', 0.5], ['windup', 1], ['strike', 0]]) box = boxUnion(box, getBounds(view.look, { ...base, anim, p }));
    return { reach: Math.max(0, tip.x * view.baseFacing), tipY: tip.y, box };
  } catch {
    const w = halfWidth(view);
    return { reach: w * 1.4 + 70, tipY: -view.height * 0.5, box: { x: -w, y: -view.height, w: w * 2, h: view.height } };
  }
}

// ---------------------------------------------------------------------------------------------
// Enemy attack runner
// ---------------------------------------------------------------------------------------------

/**
 * Runs one enemy action's hit timeline. The host (the battle scene) provides:
 *   views: Map<id, ActorView>, fx: Effects, sfx(name, opts), hitStop(ms), autopilot() → {defense},
 *   onDefensePress(run, action, verdict, localT), onDefenseResolved(run, res), onRunEvent(run, kind, hit, seg)
 * Run events (kind): 'telegraph' (wind-up start), 'swell' (Prism hits: timed so the telegraph swell's climax lands on
 * T), 'feintBreak' (a feint's cue shatters, FEINT_CUE_BREAK before its T), 'release' (projectile / wave launch),
 * 'impact' (T: the moment of contact, whether or not the hit is resolved yet).
 * Timeline: local ms from the action's t = 0 (see update(localNow)).
 */
export class EnemyAttackRun {
  /**
   * @param {object} host
   * @param {object} plan EnemyPlan
   * @param {{difficulty?:string, calibration?:number, rng?:()=>number, swellLead?:number}} [opts]
   */
  constructor(host, plan, { difficulty = 'expeditioner', calibration = 0, rng = Math.random, swellLead = GRADIENT_SWELL_LEAD } = {}) {
    this.host = host;
    this.plan = plan;
    this.rng = rng;
    this.attacker = host.views.get(plan.actorId);
    this.hits = plan.hits ?? [];
    this.melee = plan.approach === 'melee' && this.hits.length > 0;
    this.calibration = Number(calibration) || 0;
    // Run events fire on the first frame at or after their time (up to a frame late at 60 Hz): aim the swell half a
    // frame early so its climax lands within about ±8 ms of T.
    this.swellLead = Math.max(0, Number(swellLead) || 0) + 8;
    this.tracker = new DefenseTracker({ hits: this.hits.map((h) => ({ t: h.t, type: h.type })), difficulty, calibration: this.calibration });
    this.resolved = this.hits.map(() => null); // {outcome, offset, at}
    this.fired = this.hits.map(() => ({ tele: false, swell: false, shatter: false, release: false, impact: false, auto: false }));
    this.now = 0;
    this.done = false;
    this.cutAt = null;
    this.defenders = new Set();
    /** Last whiff lockout: {from, until, action, ids} in run-local ms (set by the host). */
    this.lock = null;
    this._autoPlan = this.hits.map(() => null);
    this._computeGeometry();
    this._computeSchedule();
    this._planBystanders();
  }

  _targetViews(hit) {
    return (hit?.targetIds ?? []).map((id) => this.host.views.get(id)).filter(Boolean);
  }

  _alive(id) {
    return this.host.model?.get?.(id)?.alive !== false;
  }

  /**
   * Melee staging. Each hit gets its own contact point from the weapon's real reach (the strike pose's tip, not the
   * torso width): the tip bites MELEE_BITE px into the target's body front. A single target is attacked in its own
   * lane or a lane in front of it, whichever keeps the attacker off the other party members (and the tip off the
   * target's head); sweeps and multi-target attacks stop in front of the formation. Big weapons strike from afar.
   */
  _computeGeometry() {
    const a = this.attacker;
    const home = a ? { ...a.home } : { x: 900, y: 470 };
    this.home = home;
    this.contact = { ...home };
    this.contacts = this.hits.map(() => ({ ...home }));
    this.attackerBox = null;
    this.stagedTargetId = null;
    if (!this.melee || !a) return;
    const ids = [...new Set(this.hits.flatMap((h) => h.targetIds ?? []))];
    const single = ids.length === 1 && this.plan.attack?.target !== 'all';
    const party = [...this.host.views.values()].filter((v) => v.side !== a.side && this._alive(v.id) && !v.dead);
    const cache = new Map();
    const geomOf = (variant) => {
      if (!cache.has(variant)) cache.set(variant, strikeGeometry(a, variant));
      return cache.get(variant);
    };
    const tv = single ? this.host.views.get(ids[0]) : null;
    this.stagedTargetId = tv?.id ?? null;
    // The body the tips must reach: the single target's, or the front-most member of the formation.
    const struck = tv ?? (party.length ? party : ids.map((id) => this.host.views.get(id)).filter(Boolean))
      .reduce((f, v) => (!f || bodyBox(v).x + bodyBox(v).w > bodyBox(f).x + bodyBox(f).w ? v : f), null);
    if (!struck) return;
    const tb = bodyBox(struck);
    const others = tv ? party.filter((v) => v !== tv).map((v) => bodyBox(v)) : [];
    for (let i = 0; i < this.hits.length; i++) {
      const g = geomOf(this.hits[i].anim ?? this.plan.anim ?? null);
      // Feet x that puts the tip MELEE_BITE px into the struck body, but never lets the attacker walk through it.
      const x = clamp(Math.max(tb.x + tb.w + g.reach - MELEE_BITE, tb.x - g.box.x), 300, Math.max(300, home.x));
      let best = { x, y: 476, cost: Infinity };
      if (tv) {
        for (const drop of LANE_DROPS) {
          const y = clamp(tv.home.y + 1 + drop, LANE_MIN_Y, LANE_MAX_Y);
          const box = boxShift(g.box, x, y);
          let cost = drop / 200;
          for (const ob of others) cost += (boxOverlap(box, ob) / boxArea(ob)) * 10;
          cost += Math.max(0, tb.y + 12 - (y + g.tipY)) / 60; // a tip sailing over the target's head reads as a miss
          if (cost < best.cost - 1e-6) best = { x, y, cost };
        }
      }
      this.contacts[i] = { x: best.x, y: best.y };
      const box = boxShift(g.box, best.x, best.y);
      this.attackerBox = this.attackerBox ? boxUnion(this.attackerBox, box) : box;
    }
    this.contact = { ...this.contacts[0] };
  }

  /**
   * Bystanders: non-target party members an attacker would still cover make room — a short step to the nearest
   * clear spot (never onto another party member), or, when no spot is close enough, a fade while the attack plays.
   */
  _planBystanders() {
    this.bystanders = [];
    const a = this.attacker;
    if (!this.melee || !a || !this.attackerBox || !this.stagedTargetId) return;
    const A = this.attackerBox;
    const party = [...this.host.views.values()].filter((v) => v.side !== a.side && this._alive(v.id) && !v.dead);
    for (const v of party) {
      if (v.id === this.stagedTargetId) continue;
      const b = bodyBox(v);
      if (boxOverlap(A, b) / boxArea(b) <= BYSTANDER_OVERLAP) continue;
      const rest = party.filter((o) => o !== v).map((o) => bodyBox(o));
      let best = null;
      for (let dx = -BYSTANDER_MAX_STEP; dx <= BYSTANDER_MAX_STEP; dx += 10) {
        for (let dy = -110; dy <= 110; dy += 10) {
          const y = v.home.y + dy;
          if (y < LANE_MIN_Y || y > LANE_MAX_Y) continue;
          // Stepping back (away from the enemy) or up/down the lanes reads as making room; forward reads as a charge.
          const cost = Math.hypot(dx * (dx * v.baseFacing > 0 ? 1.8 : 1), dy * 1.15);
          if (cost > BYSTANDER_MAX_STEP || (best && cost >= best.cost)) continue;
          const nb = boxShift(b, dx, dy);
          if (boxOverlap(nb, A) / boxArea(nb) > BYSTANDER_OVERLAP) continue;
          if (rest.some((r) => boxOverlap(nb, r) / boxArea(nb) > 0.02)) continue;
          best = { dx, dy, cost };
        }
      }
      this.bystanders.push(best ? { view: v, dx: best.dx, dy: best.dy, dim: false } : { view: v, dx: 0, dy: 0, dim: true });
    }
    const lastReal = [...this.seg].reverse().find((s) => s.h.type !== 'feint') ?? this.seg[this.seg.length - 1];
    this._bystanderBackAt = lastReal ? lastReal.h.t + Math.min(lastReal.follow, 160) + 60 : ENEMY_APPROACH_MS;
  }

  /** Attacker feet position at local time `now` (melee): the approach, then a glide between per-hit contacts. */
  _positionAt(now) {
    if (now < ENEMY_APPROACH_MS) {
      const u = Ease.outQuad(clamp(now / ENEMY_APPROACH_MS, 0, 1));
      return { x: lerp(this.home.x, this.contacts[0].x, u), y: lerp(this.home.y, this.contacts[0].y, u) };
    }
    let k = 0;
    while (k + 1 < this.seg.length && now >= this.seg[k + 1].windStart) k += 1;
    const to = this.contacts[this.seg[k]?.i ?? 0] ?? this.contact;
    const from = k > 0 ? this.contacts[this.seg[k - 1].i] : to;
    if (from === to || (from.x === to.x && from.y === to.y)) return to;
    const s = this.seg[k];
    const u = Ease.inOutQuad(clamp((now - s.windStart) / Math.max(1, Math.min(160, (s.release - s.windStart) * 0.5)), 0, 1));
    return { x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u) };
  }

  /**
   * Hit timing: each wind-up ends exactly on its release (T, or T − travel for projectiles and waves). A wind-up
   * shows its declared length, taking time from the previous strike's follow-through (down to MIN_FOLLOW_MS) when a
   * rapid follow-up needs it; a travelling hit released right after the previous one flies faster instead of
   * losing its wind-up. No wind-up ever starts before the previous hit's release.
   */
  _computeSchedule() {
    const seg = [];
    let prevRelease = null;
    for (let i = 0; i < this.hits.length; i++) {
      const h = this.hits[i];
      const windup = Math.max(80, Number(h.windup) || 350);
      let travel = 0;
      if (TRAVEL_ANIMS.has(h.anim) && h.type !== 'feint') {
        // A feinted bolt or wave is never loosed, so only real ones travel.
        const from = this.melee ? this.contacts[i] ?? this.contact : this.home;
        const tv = this._targetViews(h)[0];
        const dist = tv ? Math.abs(from.x - tv.home.x) : 500;
        if (h.anim === 'wave') travel = clamp((dist / 1300) * 1000, 140, Math.min(480, windup * 0.85));
        else travel = clamp((dist / 1700) * 1000, 130, Math.min(420, windup * 0.8));
      }
      let release = h.t - travel;
      const windAnim = travel ? Math.max(150, windup - travel) : windup;
      const floor = prevRelease !== null ? prevRelease + MIN_FOLLOW_MS : (this.melee ? ENEMY_APPROACH_MS : 0);
      const need = Math.min(windAnim, MIN_VISIBLE_WINDUP);
      let windStart = Math.max(floor, release - windAnim);
      if (travel && release - windStart < need) {
        const minTravel = h.anim === 'wave' ? 140 : 130;
        const later = Math.min(h.t - minTravel, windStart + need);
        if (later > release) {
          release = later;
          travel = h.t - release;
        }
      }
      windStart = Math.min(windStart, release - 1);
      seg.push({ i, h, travel, release, windStart, follow: 340 });
      prevRelease = release;
    }
    for (let k = 0; k < seg.length; k++) {
      const next = seg[k + 1];
      seg[k].follow = next ? clamp(next.windStart - seg[k].release, 0, 340) : 340;
    }
    this.seg = seg;
    const last = seg[seg.length - 1];
    const lastEnd = last ? Math.max(last.h.t, last.release + last.follow) : 900;
    this.endT = Math.max(Number(this.plan.duration) || 0, lastEnd + 260, this.hits.length ? 0 : 1100);
  }

  /** Target positions of every hit (for markers). */
  get targetIds() {
    return [...new Set(this.hits.flatMap((h) => h.targetIds ?? []))];
  }

  /**
   * Feed a defensive press.
   * @param {string} action
   * @param {number} localT press time (attack-local ms, not calibrated)
   */
  press(action, localT) {
    if (this.done || this.cutAt !== null) return null;
    const verdict = this.tracker.press(action, localT);
    if (verdict.accepted) this.host.onDefensePress(this, action, verdict, localT);
    return verdict;
  }

  /** Index of the hit a press at this moment would most likely be about (for the defender animation). */
  focusHit(verdict) {
    if (verdict && verdict.claimedHit >= 0) return verdict.claimedHit;
    const n = this.tracker.nextHitIndex();
    if (n >= 0) return n;
    return Math.max(0, this.hits.length - 1);
  }

  _autopilot(now) {
    const ap = this.host.autopilot?.() ?? null;
    const mode = ap?.defense;
    if (!mode || mode === 'none') return;
    for (let i = 0; i < this.hits.length; i++) {
      const h = this.hits[i];
      const f = this.fired[i];
      if (f.auto || h.type === 'feint' || this.resolved[i]) continue;
      let plan = this._autoPlan[i];
      if (!plan) {
        const best = perfectAction(h.type);
        if (mode === 'random') {
          const r = this.rng();
          if (r < 0.5) plan = { action: best, offset: -8 };
          else if (r < 0.7) plan = { action: 'dodge', offset: -20 };
          else if (r < 0.85) plan = { action: null };
          else plan = { action: best, offset: -170 }; // early → hit (or whiff)
        } else plan = { action: best, offset: 0 };
        this._autoPlan[i] = plan;
      }
      if (!plan.action) {
        f.auto = true;
        continue;
      }
      const at = h.t + plan.offset;
      if (now >= at - 1) {
        f.auto = true;
        // Exact timestamp through the same judging path a real press takes.
        this.press(plan.action, at + this.calibration);
      }
    }
  }

  /**
   * Advance to local time `now` (ms since t = 0).
   * @param {number} now
   */
  update(now) {
    if (this.done) return;
    this.now = now;
    const host = this.host;
    if (this.cutAt === null) this._autopilot(now);

    // Judge.
    if (this.cutAt === null) {
      for (const r of this.tracker.update(now)) {
        this.resolved[r.hitIndex] = { outcome: r.outcome, offset: r.offset, action: r.action, at: now };
        host.onDefenseResolved(this, r);
        if (this.done) return;
      }
    }

    // Timeline visuals.
    for (const s of this.seg) {
      const f = this.fired[s.i];
      if (this.cutAt !== null) break;
      if (!f.tele && now >= s.windStart) {
        f.tele = true;
        host.onRunEvent(this, 'telegraph', s.h, s);
      }
      // The Prism swell rises into a sharp cut: start it so the cut lands on T, even if that precedes the wind-up.
      if (s.h.type === 'gradient' && !f.swell && now >= Math.max(0, s.h.t - this.swellLead)) {
        f.swell = true;
        host.onRunEvent(this, 'swell', s.h, s);
      }
      if (s.h.type === 'feint' && !f.shatter && now >= s.h.t - FEINT_CUE_BREAK) {
        f.shatter = true;
        host.onRunEvent(this, 'feintBreak', s.h, s);
      }
      if (!f.release && now >= s.release) {
        f.release = true;
        host.onRunEvent(this, 'release', s.h, s);
      }
      if (!f.impact && now >= s.h.t) {
        f.impact = true;
        host.onRunEvent(this, 'impact', s.h, s);
      }
    }

    this._pose(now);

    // Early end: attacker down or nobody left to hit.
    if (this.cutAt === null) {
      const attackerModel = host.model?.get(this.plan.actorId);
      const pending = this.hits.filter((h, i) => h.type !== 'feint' && !this.resolved[i]);
      const noTargets = pending.length > 0 && pending.every((h) => !(h.targetIds ?? []).some((id) => host.model?.get(id)?.alive));
      if (!attackerModel?.alive || noTargets || host.model?.outcome?.()) this.cutAt = now;
    }

    const judged = this.tracker.isDone();
    if (this.cutAt !== null ? now >= this.cutAt + 380 : judged && now >= this.endT) this._finish();
  }

  _finish() {
    this.done = true;
    if (this.attacker) {
      this.attacker.forced = null;
      this.attacker.aura = null;
      this.attacker.vivid = false;
    }
    this.releaseBystanders();
  }

  /** Put every bystander back on its slot (idempotent; the host also calls it when it tears the run down). */
  releaseBystanders() {
    for (const b of this.bystanders ?? []) {
      const v = b.view;
      if (b.moved) {
        v.x = v.home.x;
        v.y = v.home.y;
        v.facing = v.baseFacing;
        if (v.forced?.anim === 'walk') v.forced = null;
      }
      if (b.dim) v.alpha = 1;
      b.moved = false;
    }
  }

  _poseBystanders(now) {
    if (!this.bystanders?.length) return;
    const backAt = this.cutAt !== null ? Math.min(this._bystanderBackAt, this.cutAt + 60) : this._bystanderBackAt;
    const out = clamp(now / BYSTANDER_OUT_MS, 0, 1);
    const back = clamp((now - backAt) / BYSTANDER_BACK_MS, 0, 1);
    const u = Ease.inOutQuad(out) * (1 - Ease.inOutQuad(back));
    for (const b of this.bystanders) {
      const v = b.view;
      if (!this._alive(v.id)) continue;
      if (b.dim) {
        v.alpha = lerp(1, 0.42, u);
        continue;
      }
      v.x = v.home.x + b.dx * u;
      v.y = v.home.y + b.dy * u;
      b.moved = u > 0;
      const moving = (out > 0 && out < 1) || (back > 0 && back < 1);
      if (moving) {
        // Walk to the spot facing the way they go, then turn back to face the fight.
        const dir = (out < 1 ? b.dx : -b.dx) * v.baseFacing;
        v.facing = Math.abs(b.dx) > 12 && dir < 0 ? -v.baseFacing : v.baseFacing;
        if (!v.forced || v.forced.anim === 'walk') v.forced = { anim: 'walk', p: 0 };
      } else {
        v.facing = v.baseFacing;
        if (v.forced?.anim === 'walk') v.forced = null;
      }
    }
  }

  _pose(now) {
    this._poseBystanders(now);
    const a = this.attacker;
    if (!a || a.dead) return;
    const model = this.host.model?.get(this.plan.actorId);
    if (!model?.alive) {
      a.forced = null;
      a.aura = null;
      a.vivid = false;
      return;
    }
    // Position.
    if (this.melee) {
      const p = this._positionAt(now);
      a.x = p.x;
      a.y = p.y;
      if (now < ENEMY_APPROACH_MS) {
        a.forced = { anim: 'run', p: 0 };
        a.aura = null;
        return;
      }
    }
    if (this.cutAt !== null) {
      a.forced = { anim: 'recover', variant: this.plan.anim, p: clamp((now - this.cutAt) / 300, 0, 1) };
      a.aura = null;
      a.vivid = false;
      return;
    }
    if (!this.seg.length) {
      // Non-damaging action: a single cast.
      const u = clamp((now - 150) / 760, 0, 1);
      a.forced = now < 150 ? { anim: 'idle', p: 0 } : u < 1 ? { anim: 'cast', variant: 'cast', p: u } : { anim: 'idle', p: 0 };
      a.aura = null;
      return;
    }
    let forced = { anim: 'idle', p: 0 };
    let aura = null;
    let vivid = false;
    for (let k = 0; k < this.seg.length; k++) {
      const s = this.seg[k];
      const h = s.h;
      const feint = h.type === 'feint';
      const auraFrom = Math.max(s.windStart, h.t - 600);
      if (now >= auraFrom && now <= h.t + 90) {
        aura = HIT_AURA[h.type] ?? 'white';
        if (h.type === 'gradient') vivid = true;
      }
      if (now < s.windStart) {
        if (k > 0) {
          const prev = this.seg[k - 1];
          const since = now - (prev.release + prev.follow);
          if (since >= 0) forced = { anim: 'recover', variant: prev.h.anim, p: clamp(since / Math.max(120, s.windStart - (prev.release + prev.follow)), 0, 1) };
        }
        break;
      }
      if (now < s.release) {
        const u = clamp((now - s.windStart) / Math.max(1, s.release - s.windStart), 0, 1);
        forced = { anim: 'windup', variant: h.anim, p: feint ? u * 0.8 : u };
        break;
      }
      if (now < s.release + s.follow) {
        const u = clamp((now - s.release) / s.follow, 0, 1);
        forced = feint ? { anim: 'windup', variant: h.anim, p: 0.8 * (1 - Ease.outQuad(u)) } : { anim: 'strike', variant: h.anim, p: u };
        break;
      }
      if (k === this.seg.length - 1) {
        const since = now - (s.release + s.follow);
        forced = since < 320 ? { anim: 'recover', variant: h.anim, p: clamp(since / 320, 0, 1) } : { anim: 'idle', p: 0 };
      }
    }
    a.forced = forced;
    a.aura = aura;
    a.vivid = vivid;
  }

  /**
   * Assist cues to draw now, farthest from impact first (so the next hit's cue is drawn on top):
   * [{targetId, hitIndex, type, progress, primary, claimed, shatter, view}]. `primary` marks, per target, the next
   * hit still waiting for a press — the only cue that should carry a key label. A feint's cue is reported as a
   * normal one until FEINT_CUE_BREAK before its T, then `shatter` runs 0 → 1 while it breaks apart and fades.
   * @param {number} now local ms
   */
  cues(now) {
    const out = [];
    if (this.cutAt !== null) return out;
    const claims = this.tracker.claims ?? [];
    const labelled = new Set();
    for (let i = 0; i < this.hits.length; i++) {
      const h = this.hits[i];
      if (this.resolved[i]) continue;
      const dt = h.t - now;
      if (dt > ASSIST_CUE_LEAD) continue;
      const feint = h.type === 'feint';
      let shatter = 0;
      let progress = 1 - dt / ASSIST_CUE_LEAD;
      if (feint) {
        const since = FEINT_CUE_BREAK - dt;
        if (since >= FEINT_SHATTER_MS) continue;
        if (since >= 0) {
          shatter = Math.max(1e-3, since / FEINT_SHATTER_MS);
          progress = 1 - FEINT_CUE_BREAK / ASSIST_CUE_LEAD;
        }
      } else if (dt < -150) continue;
      const claimed = !feint && !!claims[i];
      for (const tv of this._targetViews(h)) {
        if (!this.host.model?.get(tv.id)?.alive) continue;
        const primary = !claimed && !shatter && !labelled.has(tv.id);
        if (primary) labelled.add(tv.id);
        out.push({ targetId: tv.id, hitIndex: i, type: feint ? 'normal' : h.type, progress, primary, claimed, shatter, view: tv });
      }
    }
    return out.sort((a, b) => a.progress - b.progress || b.hitIndex - a.hitIndex);
  }

  /** Charge / aim telegraphs for beams and novas in their wind-up: [{kind, hit, u, seg}]. */
  charges(now) {
    const out = [];
    if (this.cutAt !== null) return out;
    for (const s of this.seg) {
      const h = s.h;
      if (h.type === 'feint') continue;
      if (now < s.windStart || now > h.t) continue;
      if (h.anim === 'beam' || h.anim === 'nova' || h.anim === 'cast') {
        out.push({ kind: h.anim === 'beam' ? 'beam' : 'nova', hit: h, u: clamp((now - s.windStart) / Math.max(1, h.t - s.windStart), 0, 1), seg: s });
      }
    }
    return out;
  }

  /**
   * Force-finish (watchdog, for genuine stalls only): the run ends and hits still unresolved are voided — they deal no
   * damage and count for nothing — so a stall never penalises the player.
   * @returns {number[]} indices of the voided hits
   */
  abort() {
    if (this.done) return [];
    const voided = [];
    for (let i = 0; i < this.hits.length; i++) {
      if (this.hits[i].type === 'feint' || this.resolved[i]) continue;
      this.resolved[i] = { outcome: null, offset: null, action: null, at: this.now, voided: true };
      voided.push(i);
    }
    this._finish();
    return voided;
  }

  /**
   * The locked-out press that most plausibly aimed at hit i (a whiff within 400 ms of its T), for feedback on a hit
   * that resolved unclaimed although the player pressed: {action, offset} (offset calibrated, + = late) or null.
   * @param {number} i
   */
  whiffNear(i) {
    const h = this.hits[i];
    if (!h) return null;
    let best = null;
    for (const p of this.tracker.pressHistory ?? []) {
      if (p.reason !== 'whiff' || p.feintHit !== undefined) continue;
      const offset = p.t - this.calibration - h.t;
      if (Math.abs(offset) <= 400 && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { action: p.action, offset };
    }
    return best;
  }

  /**
   * The real (non-feint) hit nearest to a press at local time t (calibrated), with the signed offset (+ = late).
   * @param {number} t raw local press time
   * @returns {{index:number, offset:number}|null}
   */
  nearestHit(t) {
    const tc = t - this.calibration;
    let best = null;
    this.hits.forEach((h, index) => {
      if (h.type === 'feint') return;
      const offset = tc - h.t;
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { index, offset };
    });
    return best;
  }
}

// ---------------------------------------------------------------------------------------------
// Party action runner
// ---------------------------------------------------------------------------------------------

/** How a party action is staged. */
export function actionStyle(plan, actorKey) {
  if (!plan) return 'support';
  if (plan.kind === 'item') return 'item';
  if (plan.kind === 'flee') return 'flee';
  const anim = plan.anim;
  const hasHits = (plan.hits?.length ?? 0) > 0;
  if (plan.kind === 'gradient' || anim === 'gradient') return actorKey === 'nyra' ? 'ranged' : 'melee';
  if (PARTY_MELEE_ANIMS.has(anim)) return hasHits ? 'melee' : 'support';
  if (anim === 'shoot') return hasHits ? 'shoot' : 'support';
  if (anim === 'cast') return hasHits ? 'ranged' : 'support';
  return hasHits ? 'ranged' : 'support';
}

/**
 * Runs one party action's hit timeline (approach, rings, resolution). The host provides:
 *   views, model, fx, sfx(), hitStop(ms), autopilot() → {offense}, onPartyHit(run, hitIndex, rating, offset),
 *   onPartyRelease(run, hitIndex, seg)
 * finishAction / return-to-slot are staged by the host after `hitsDone`.
 */
export class PartyActionRun {
  /**
   * @param {object} host
   * @param {object} plan ActionPlan
   * @param {{difficulty?:string, calibration?:number, style?:string}} [opts]
   */
  constructor(host, plan, { difficulty = 'expeditioner', calibration = 0, style } = {}) {
    this.host = host;
    this.plan = plan;
    this.actor = host.views.get(plan.actorId);
    this.actorKey = host.model?.get(plan.actorId)?.key ?? '';
    this.style = style ?? actionStyle(plan, this.actorKey);
    this.hits = plan.hits ?? [];
    this.calibration = Number(calibration) || 0;
    this.now = 0;
    this.hitsDone = false;
    this.skipped = this.hits.map(() => false);
    this.resolved = this.hits.map(() => null); // {rating, offset, at}
    this._released = this.hits.map(() => false);
    this._autoPressed = this.hits.map(() => false);
    this._computeGeometry();
    this._computeSchedule();
    const prompts = [];
    this.promptHit = [];
    this.hitPrompt = this.hits.map(() => -1);
    this.hits.forEach((h, i) => {
      if (!h.qte) return;
      this.hitPrompt[i] = prompts.length;
      this.promptHit.push(i);
      prompts.push({ t: this.T[i] });
    });
    this.tracker = new OffenseTracker({ prompts, difficulty, calibration: this.calibration });
  }

  _computeGeometry() {
    const a = this.actor;
    this.home = a ? { ...a.home } : { x: 390, y: 470 };
    this.contact = { ...this.home };
    if (this.style !== 'melee' || !a) return;
    const tids = [...new Set(this.hits.flatMap((h) => h.targetIds ?? []))];
    const tvs = tids.map((id) => this.host.views.get(id)).filter(Boolean);
    if (!tvs.length) return;
    if (tvs.length === 1) {
      const tv = tvs[0];
      this.contact = { x: tv.home.x - (halfWidth(tv) * 1.3 + halfWidth(a) + 44), y: tv.home.y + 1 };
    } else {
      const minX = Math.min(...tvs.map((v) => v.home.x - halfWidth(v)));
      const avgY = tvs.reduce((s, v) => s + v.home.y, 0) / tvs.length;
      this.contact = { x: minX - halfWidth(a) - 40, y: clamp(avgY, 400, 560) };
    }
    this.contact.x = clamp(this.contact.x, this.home.x + 40, 1000);
  }

  _computeSchedule() {
    const n = this.hits.length;
    const style = this.style;
    const approach = style === 'melee' ? PARTY_DASH_MS : 0;
    this.approach = approach;
    const T = [];
    for (let i = 0; i < n; i++) {
      const h = this.hits[i];
      const gap = Math.max(160, Number(h.gap) || 380);
      if (i === 0) {
        const base = style === 'melee' ? approach + gap : style === 'shoot' ? 260 + gap * 0.6 : 240 + gap;
        T.push(h.qte ? Math.max(base, QTE_RING_LEAD + 90) : Math.max(style === 'melee' ? approach + Math.min(gap, 240) : 380, 200));
      } else T.push(T[i - 1] + gap);
    }
    this.T = T;
    // One lead for every ring: rings close at one speed, so a ring's size always tells the time left to its hit.
    this.ringStart = T.map((t) => t - QTE_RING_LEAD);
    // Actor pose segments.
    this.segs = T.map((t, i) => {
      const prevEnd = i === 0 ? approach : T[i - 1] + 90;
      const wind = clamp(t - prevEnd, 70, 300);
      const next = T[i + 1];
      const follow = clamp((next !== undefined ? next - clamp(next - t - 90, 70, 300) : t + 320) - t, 80, 320);
      return { t, windStart: t - wind, follow };
    });
    // Ranged: projectiles launched so they land on T.
    this.travel = style === 'shoot' ? 80 : 230;
    this.lastT = n ? T[n - 1] : style === 'support' || style === 'item' ? 700 : 300;
    this.endT = this.lastT + (n ? 300 : 0);
  }

  /** Feed a qte press (action-local ms). */
  press(localT) {
    if (this.hitsDone) return null;
    return this.tracker.press(localT);
  }

  _autopilot(now) {
    const mode = this.host.autopilot?.()?.offense;
    if (mode !== 'perfect') return;
    for (let i = 0; i < this.hits.length; i++) {
      if (!this.hits[i].qte || this._autoPressed[i] || this.skipped[i]) continue;
      if (now >= this.T[i] - 1) {
        this._autoPressed[i] = true;
        this.tracker.press(this.T[i] + this.calibration);
      }
    }
  }

  /** Mark every remaining hit whose (non-random) targets are all down as skipped. */
  pruneDeadTargets() {
    const model = this.host.model;
    let cutAny = false;
    for (let i = 0; i < this.hits.length; i++) {
      if (this.resolved[i] || this.skipped[i]) continue;
      const h = this.hits[i];
      if (h.random && model?.living?.('enemy')?.length) continue;
      if (!(h.targetIds ?? []).some((id) => model?.get(id)?.alive)) {
        this.skipped[i] = true;
        cutAny = true;
      }
    }
    if (model?.outcome?.()) {
      for (let i = 0; i < this.hits.length; i++) if (!this.resolved[i]) this.skipped[i] = true;
      cutAny = true;
    }
    return cutAny;
  }

  /** @param {number} now action-local ms */
  update(now) {
    if (this.hitsDone) return;
    this.now = now;
    const host = this.host;
    this._autopilot(now);

    // Support / item: one release at the cast's peak (p 0.8 of the 700 ms cast).
    if ((this.style === 'support' || this.style === 'item') && !this._supportReleased && now >= 560) {
      this._supportReleased = true;
      host.onPartyRelease(this, -1);
    }
    // Ranged releases.
    for (let i = 0; i < this.hits.length; i++) {
      if (this._released[i] || this.skipped[i]) continue;
      const releaseAt = this.style === 'melee' ? this.T[i] : this.T[i] - this.travel;
      if (now >= releaseAt) {
        this._released[i] = true;
        host.onPartyRelease(this, i);
      }
    }

    // Offense judging.
    for (const r of this.tracker.update(now)) {
      const i = this.promptHit[r.promptIndex];
      if (i === undefined || this.resolved[i] || this.skipped[i]) continue;
      this.resolved[i] = { rating: r.rating, offset: r.offset, at: now };
      host.onPartyHit(this, i, r.rating, r.offset);
    }
    // Non-QTE hits land exactly on time.
    for (let i = 0; i < this.hits.length; i++) {
      if (this.hits[i].qte || this.resolved[i] || this.skipped[i]) continue;
      if (now >= this.T[i]) {
        this.resolved[i] = { rating: null, offset: null, at: now };
        host.onPartyHit(this, i, null, null);
      }
    }
    this.pruneDeadTargets();

    this._pose(now);

    const allDone = this.hits.every((_, i) => this.resolved[i] || this.skipped[i]);
    const lastResolvedAt = Math.max(0, ...this.resolved.filter(Boolean).map((r) => r.at));
    if (allDone && now >= Math.min(this.endT, lastResolvedAt + 300) && (this.hits.length || now >= this.endT)) {
      this.hitsDone = true;
    }
  }

  _pose(now) {
    const a = this.actor;
    if (!a) return;
    const style = this.style;
    const variant = this.plan.anim === 'gradient' ? 'gradient' : this.plan.anim;
    if (style === 'melee') {
      if (now < this.approach) {
        const u = Ease.inOutQuad(clamp(now / this.approach, 0, 1));
        a.x = lerp(this.home.x, this.contact.x, u);
        a.y = lerp(this.home.y, this.contact.y, u);
        a.forced = { anim: 'run', p: 0 };
        return;
      }
      a.x = this.contact.x;
      a.y = this.contact.y;
      a.forced = this._segPose(now, variant);
      return;
    }
    if (style === 'shoot') {
      let f = { anim: 'aim', p: 0 };
      for (let i = 0; i < this.hits.length; i++) {
        const at = this.T[i] - this.travel;
        if (now >= at && now < at + 260) f = { anim: 'shoot', variant: 'shoot', p: clamp((now - at) / 260, 0, 1) };
      }
      const lastShot = this.T[this.T.length - 1] - this.travel;
      if (now > lastShot + 420) f = { anim: 'idle', p: 0 };
      a.forced = f;
      return;
    }
    if (style === 'support' || style === 'item') {
      const u = clamp(now / 700, 0, 1);
      a.forced = u < 1 ? { anim: 'cast', variant: style === 'item' ? 'buff' : this.plan.anim, p: u } : { anim: 'idle', p: 0 };
      return;
    }
    // ranged cast: each hit's cast releases (p 0.8) exactly at the projectile launch.
    const D = 430;
    let f = { anim: 'idle', p: 0 };
    for (let i = 0; i < this.hits.length; i++) {
      const launch = this.T[i] - this.travel;
      const start = launch - 0.8 * D;
      if (now >= start && now < start + D) f = { anim: 'cast', variant: variant === 'gradient' ? 'gradient' : 'cast', p: clamp((now - start) / D, 0, 1) };
    }
    if (this.hits.length && now < this.T[0] - this.travel - 0.8 * D) {
      const u = clamp(now / Math.max(1, this.T[0] - this.travel - 0.8 * D), 0, 1);
      f = { anim: 'cast', variant: variant === 'gradient' ? 'gradient' : 'cast', p: u * 0.35 };
    }
    a.forced = f;
  }

  _segPose(now, variant) {
    const segs = this.segs;
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      if (this.skipped[k] && !this.resolved[k]) continue;
      if (now < s.windStart) {
        if (k > 0) {
          const prev = segs[k - 1];
          const since = now - (prev.t + prev.follow);
          if (since >= 0) return { anim: 'recover', variant, p: clamp(since / Math.max(80, s.windStart - prev.t - prev.follow), 0, 1) };
          return { anim: 'strike', variant, p: clamp((now - prev.t) / prev.follow, 0, 1) };
        }
        return { anim: 'windup', variant, p: 0 };
      }
      if (now < s.t) return { anim: 'windup', variant, p: clamp((now - s.windStart) / Math.max(1, s.t - s.windStart), 0, 1) };
      if (now < s.t + s.follow) return { anim: 'strike', variant, p: clamp((now - s.t) / s.follow, 0, 1) };
    }
    // After the last (resolved) hit.
    const doneIdx = segs.reduce((m, s, k) => (this.resolved[k] ? k : m), -1);
    const s = segs[Math.max(0, doneIdx)] ?? { t: 0, follow: 1 };
    const since = now - (s.t + s.follow);
    return since < 300 ? { anim: 'recover', variant, p: clamp(since / 300, 0, 1) } : { anim: 'idle', p: 0 };
  }

  /**
   * QTE rings to draw now: [{hitIndex, progress, rating, ratingAge, targetId, primary, busy}]. Rings overlap when hits
   * are closer than QTE_RING_LEAD; `primary` marks the next ring to press on (the one to label and draw on top), and
   * `busy` marks a rating flourish that has a newer ring closing over it (draw it faded).
   * @param {number} now action-local ms
   */
  rings(now) {
    const out = [];
    let primaryTaken = false;
    for (let i = 0; i < this.hits.length; i++) {
      const h = this.hits[i];
      if (!h.qte) continue;
      const res = this.resolved[i];
      if (res) {
        const age = now - res.at;
        if (age < 560) out.push({ hitIndex: i, progress: 1, rating: res.rating, ratingAge: age, targetId: this._ringTarget(h), primary: false, busy: false });
        continue;
      }
      if (this.skipped[i]) continue;
      const s = this.ringStart[i];
      if (now < s) continue;
      out.push({
        hitIndex: i, progress: clamp((now - s) / Math.max(1, this.T[i] - s), 0, 1.25), rating: null, ratingAge: 0,
        targetId: this._ringTarget(h), primary: !primaryTaken, busy: false,
      });
      primaryTaken = true;
    }
    if (primaryTaken) for (const r of out) if (r.rating) r.busy = true;
    return out;
  }

  /**
   * Force-finish (watchdog, for genuine stalls only): every hit still pending lands unrated (a QTE 'miss', the base
   * multiplier) instead of being dropped, so the AP already spent always buys the skill's damage.
   */
  abort() {
    if (this.hitsDone) return;
    for (let i = 0; i < this.hits.length; i++) {
      if (this.resolved[i] || this.skipped[i]) continue;
      const rating = this.hits[i].qte ? 'miss' : null;
      this.resolved[i] = { rating, offset: null, at: this.now };
      this.host.onPartyHit(this, i, rating, null);
    }
    this.hitsDone = true;
  }

  _ringTarget(h) {
    const ids = h.targetIds ?? [];
    return ids.find((id) => this.host.model?.get(id)?.alive) ?? ids[0] ?? null;
  }

  /** Release actor control. */
  release() {
    if (this.actor) this.actor.forced = null;
  }
}

/** Colour of an enemy hit type (for cue-adjacent text). */
export function hitTypeColor(type) {
  return HIT_TYPE_COLORS[type] ?? '#ffffff';
}
