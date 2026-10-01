// Free Aim for Expedition 69 battles: a reticle driven by the mouse, arrow keys or the left stick (with a
// gentle magnet onto weak points), glowing and pulsing weak points on every enemy, and 1-AP shots that
// trace from the shooter's muzzle / gauntlet, hit-test weak points first and then bodies, and resolve
// through BattleModel (beginAction 'shot' → resolveHit → finishAction). Shots never end the turn.
// A tap or click only fires when it lands on (or near) an enemy; anywhere else it just moves the reticle.

import { getAnchors, getBounds, weakPointPositions } from '../render/sprites.js';
import { PALETTE, ELEMENT_COLORS } from '../render/palette.js';
import { clamp } from '../core/util.js';

const RETICLE_SPEED = 640; // px/s at full stick / key hold
const SHOT_COOLDOWN = 280; // ms between shots
const MAGNET_RANGE = 22; // px beyond a weak point's radius where the reticle is pulled in
const TAP_SLOP = 26; // px around an enemy's body where a tap or click still counts as aimed at it
const WEAK_LABELS = { crit: 'Critical', break: 'Break', shield: 'Shield Breaker' };

/**
 * One Free Aim session for one party member.
 * Host: { game, model, views, camera, fx, sfx(name, opts), playEvents(events, opts), worldTime, toast(text) }.
 */
export class FreeAim {
  /**
   * @param {object} host
   * @param {string} actorId
   */
  constructor(host, actorId) {
    this.host = host;
    this.actorId = actorId;
    this.view = host.views.get(actorId);
    this.x = 900;
    this.y = 360;
    this.active = true;
    this.hover = null;
    this.shots = 0;
    this._cooldown = 0;
    this._lastPointer = null;
    this._exitTimer = null;
    this._pulse = 0;
    this._pointerAim = false;
    this._tipShown = false;
    /** Model events held back for the scene (boss phase changes end the session and play before the next menu). */
    this.deferred = [];
    const first = host.model.living('enemy')[0];
    const fv = first ? host.views.get(first.id) : null;
    if (fv) {
      const a = fv.anchors();
      this.x = a.chest.x;
      this.y = a.chest.y;
    }
    const p = host.game.input.pointer;
    this._lastPointer = { x: p.x, y: p.y };
    if (this.view) {
      this.view.forced = null;
      this.view.play('aim', { loop: true, dur: 1200 });
    }
  }

  /** Living enemy views with their current weak points and bodies (world space). */
  targets() {
    const out = [];
    const now = this.host.worldTime;
    for (const c of this.host.model.living('enemy')) {
      const v = this.host.views.get(c.id);
      if (!v || v.dead) continue;
      const pose = v.pose(now);
      const effects = new Map((c.weakPoints ?? []).map((w) => [w.id, w.effect]));
      const weak = weakPointPositions(v.look, pose).map((w) => ({ ...w, effect: effects.get(w.id) ?? 'crit' }));
      out.push({ id: c.id, combatant: c, view: v, pose, weak, bounds: getBounds(v.look, pose) });
    }
    return out;
  }

  /**
   * What a shot at (x, y) would hit: weak points first, then bodies.
   * @returns {{targetId:string|null, weakPointId:string|null, effect:string|null, name:string|null}}
   */
  hitTest(x, y) {
    const tg = this.targets();
    let best = null;
    for (const t of tg) {
      for (const w of t.weak) {
        const d = Math.hypot(x - w.x, y - w.y);
        if (d <= w.r + 4 && (!best || d < best.d)) best = { d, targetId: t.id, weakPointId: w.id, effect: w.effect, name: t.combatant.name };
      }
    }
    if (best) return best;
    // Bodies: nearest box that contains the point (front-most = largest y).
    const inside = tg.filter((t) => x >= t.bounds.x && x <= t.bounds.x + t.bounds.w && y >= t.bounds.y && y <= t.bounds.y + t.bounds.h);
    inside.sort((a, b) => b.view.y - a.view.y);
    if (inside[0]) return { targetId: inside[0].id, weakPointId: null, effect: null, name: inside[0].combatant.name };
    return { targetId: null, weakPointId: null, effect: null, name: null };
  }

  /**
   * Per-frame input. Returns 'exit' when the player leaves Free Aim (cancel / out of AP), else null.
   * @param {number} dt real ms
   */
  update(dt) {
    if (!this.active) return 'exit';
    const { game, camera } = this.host;
    const input = game.input;
    this._pulse += dt;
    this._cooldown = Math.max(0, this._cooldown - dt);
    const actor = this.host.model.get(this.actorId);

    if (input.pressed('cancel')) {
      input.consume('cancel');
      this.host.sfx('ui_cancel');
      this.active = false;
      return 'exit';
    }

    // Mouse / touch: follow the pointer when it moves inside the stage.
    const p = input.pointer;
    const moved = this._lastPointer && (Math.abs(p.x - this._lastPointer.x) > 0.5 || Math.abs(p.y - this._lastPointer.y) > 0.5);
    this._lastPointer = { x: p.x, y: p.y };
    if ((moved || p.pressed) && p.inside && !p.overUI) {
      const w = camera.toWorld(p.x, p.y);
      this.x = w.x;
      this.y = w.y;
      this._pointerAim = true;
    }
    // Keys / stick.
    const ax = input.axis();
    const mag = Math.hypot(ax.x, ax.y);
    if (mag > 0.01) {
      this._pointerAim = false;
      const s = (RETICLE_SPEED * dt) / 1000;
      this.x += ax.x * s;
      this.y += ax.y * s;
    } else {
      // Aim assist: settle onto a nearby weak point when the reticle is idle.
      let pull = null;
      for (const t of this.targets()) {
        for (const w of t.weak) {
          const d = Math.hypot(this.x - w.x, this.y - w.y);
          if (d <= w.r + MAGNET_RANGE && (!pull || d < pull.d)) pull = { d, x: w.x, y: w.y };
        }
      }
      if (pull && !moved) {
        const k = 1 - Math.exp(-dt / 70);
        this.x += (pull.x - this.x) * k;
        this.y += (pull.y - this.y) * k;
      }
    }
    this.x = clamp(this.x, 20, 1260);
    this.y = clamp(this.y, 60, 660);
    this.hover = this.hitTest(this.x, this.y);

    // Fire: the confirm key shoots wherever the reticle is; a tap / click shoots only when it lands on or near an
    // enemy (snapping onto the weak point or body it meant), so a stray touch never burns AP.
    let fire = input.pressed('confirm');
    if (p.pressed && p.inside && !p.overUI) {
      const w = camera.toWorld(p.x, p.y);
      const aim = this.tapTarget(w.x, w.y);
      this.x = aim?.x ?? w.x;
      this.y = aim?.y ?? w.y;
      this.hover = this.hitTest(this.x, this.y);
      if (aim) fire = true;
      else if (!fire) this._openGroundTap();
    }
    if (fire && this._cooldown <= 0) {
      input.consume('confirm');
      if ((actor?.ap ?? 0) < 1) {
        this.host.sfx('ui_error');
        this.host.toast('Not enough AP');
      } else {
        this.fire();
      }
    }
    if (this.host.model.outcome()) {
      this.active = false;
      return 'exit';
    }
    if ((actor?.ap ?? 0) < 1 && this._cooldown <= 0) {
      this._exitTimer = (this._exitTimer ?? 650) - dt;
      if (this._exitTimer <= 0) {
        this.active = false;
        return 'exit';
      }
    }
    return null;
  }

  /**
   * Where a tap / click at world (x, y) should shoot: a weak point within its radius + MAGNET_RANGE, else the nearest
   * point of an enemy body within TAP_SLOP of the tap; null when the tap is on open ground.
   * @returns {{x:number, y:number, targetId:string}|null}
   */
  tapTarget(x, y) {
    const tg = this.targets();
    let best = null;
    for (const t of tg) {
      for (const w of t.weak) {
        const d = Math.hypot(x - w.x, y - w.y);
        if (d <= w.r + MAGNET_RANGE && (!best || d < best.d)) best = { d, x: w.x, y: w.y, targetId: t.id };
      }
    }
    if (best) return best;
    for (const t of tg) {
      const b = t.bounds;
      const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
      const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
      const d = Math.hypot(dx, dy);
      if (d > TAP_SLOP) continue;
      // Ties (overlapping bodies) go to the front-most enemy, as in hitTest.
      if (!best || d < best.d - 1e-6 || (Math.abs(d - best.d) < 1e-6 && t.view.y > best.y0)) {
        best = { d, y0: t.view.y, x: clamp(x, b.x + 2, b.x + b.w - 2), y: clamp(y, b.y + 2, b.y + b.h - 2), targetId: t.id };
      }
    }
    return best;
  }

  _openGroundTap() {
    if (this._tipShown) return;
    this._tipShown = true;
    const verb = this.host.game.input.lastDevice === 'touch' ? 'Tap' : 'Click';
    this.host.toast?.(`${verb} an enemy or a weak point to shoot`);
  }

  /** Aim at a world point (autopilot / tests). */
  aimAt(x, y) {
    this.x = x;
    this.y = y;
    this.hover = this.hitTest(x, y);
  }

  /** Fire one shot at the reticle. Returns the plan (or {error}). */
  fire() {
    const { model, fx } = this.host;
    const hit = this.hitTest(this.x, this.y);
    const plan = model.beginAction(this.actorId, {
      kind: 'shot', targetIds: hit.targetId ? [hit.targetId] : [], weakPointId: hit.weakPointId ?? undefined,
    });
    if (!plan || plan.error) {
      this.host.sfx('ui_error');
      this.host.toast(plan?.error ?? 'Cannot shoot');
      return plan;
    }
    this.shots += 1;
    this._cooldown = SHOT_COOLDOWN;
    const v = this.view;
    const now = this.host.worldTime;
    let from = { x: this.x - 200, y: this.y };
    if (v) {
      v.play('shoot', { variant: 'shoot', dur: 280, then: 'aim' });
      const a = v.anchors(now);
      from = a.cast ?? a.weapon;
    }
    const element = plan.element ?? 'physical';
    const col = ELEMENT_COLORS[element] ?? PALETTE.paleGold;
    fx.line(from.x, from.y, this.x, this.y, { color: col, width: element === 'lightning' ? 3 : 2.5, life: 200, jagged: element === 'lightning' ? 6 : 0 });
    fx.sparks(from.x, from.y, { color: PALETTE.paleGold, count: 7, speed: 260, spread: 0.9, angle: Math.atan2(this.y - from.y, this.x - from.x), life: 240, gravity: 200 });
    this.host.sfx('shot', { pan: (this.x - 640) / 900 });
    this.host.playEvents(plan.events, { source: this.actorId });
    const events = model.resolveHit(plan, 0, null);
    if (hit.weakPointId && events.some((e) => e.type === 'damage' || e.type === 'blocked' || e.type === 'shield')) {
      fx.ring(this.x, this.y, { r0: 6, r1: 60, life: 360, color: col, width: 3 });
      fx.burst(this.x, this.y, hit.effect === 'crit' ? 'crit' : hit.effect === 'break' ? 'break' : 'shield', { scale: 0.7, dir: 1 });
      fx.text(this.x, this.y - 34, WEAK_LABELS[hit.effect] ?? 'Weak point', { color: PALETTE.paleGold, size: 18, life: 800 });
    } else if (!hit.targetId) {
      fx.sparks(this.x, this.y, { color: PALETTE.parchment, count: 6, speed: 120, life: 300 });
      fx.text(this.x, this.y - 20, 'Miss', { color: PALETTE.parchment, size: 18, life: 600 });
    }
    this.host.playEvents(events, { source: this.actorId, at: { x: this.x, y: this.y } });
    const fin = model.finishAction(plan);
    const phases = fin.filter((e) => e.type === 'phase');
    this.host.playEvents(fin.filter((e) => e.type !== 'phase'), { source: this.actorId });
    if (phases.length) {
      // A boss phase change (and its story beat) must not interleave with whatever the player does next: end the
      // session and let the scene play it before the command menu reopens.
      this.deferred.push(...phases);
      this.active = false;
    }
    return plan;
  }

  /** HUD summary. */
  status() {
    const actor = this.host.model.get(this.actorId);
    const h = this.hover;
    const verb = this.host.game.input.lastDevice === 'touch' ? 'tap' : 'click';
    let aimText = this._pointerAim ? `Open ground — ${verb} an enemy to shoot` : 'Open ground — a shot here is wasted';
    if (h?.targetId) aimText = h.weakPointId ? `${h.name} · ${WEAK_LABELS[h.effect] ?? 'Weak point'} weak point` : `${h.name} · body`;
    return { name: actor?.name ?? '', ap: actor?.ap ?? 0, aimText, onWeak: !!h?.weakPointId, onTarget: !!h?.targetId };
  }

  /**
   * Draw weak points and the reticle (world space, inside the camera transform).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} t ms clock
   */
  render(ctx, t) {
    if (!this.active) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.008);
    ctx.save();
    // Weak points.
    for (const tg of this.targets()) {
      for (const w of tg.weak) {
        const col = w.effect === 'shield' ? PALETTE.shield : w.effect === 'break' ? PALETTE.breakBar : PALETTE.paleGold;
        const hovered = this.hover?.weakPointId === w.id && this.hover?.targetId === tg.id;
        const r = w.r * (hovered ? 1.25 : 1) + pulse * 3;
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, r * 2.2);
        g.addColorStop(0, hexA(col, 0.55 + pulse * 0.25));
        g.addColorStop(0.45, hexA(col, 0.22));
        g.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(w.x, w.y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = hexA(col, 0.95);
        ctx.lineWidth = hovered ? 3 : 2;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -t * 0.02;
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // Effect glyph (vector, so no symbol-font fallback is needed).
        effectGlyph(ctx, w.x, w.y, w.effect, hexA(col, 1));
      }
    }
    // Aim line from the shooter.
    const v = this.view;
    if (v) {
      const a = v.anchors(t);
      const from = a.cast ?? a.weapon;
      ctx.strokeStyle = 'rgba(243, 219, 160, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Reticle.
    const on = this.hover?.targetId;
    const weak = this.hover?.weakPointId;
    const col = weak ? PALETTE.paleGold : on ? PALETTE.ivory : 'rgba(245, 238, 223, 0.7)';
    const R = weak ? 16 : 20;
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = 'rgba(12, 8, 6, 0.75)';
    ctx.lineWidth = 5;
    reticlePath(ctx, R, t);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    reticlePath(ctx, R, t);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Clean up the shooter's pose. */
  exit() {
    this.active = false;
    if (this.view && this.host.model.get(this.actorId)?.alive) this.view.play('idle', { loop: true, dur: 1000 });
  }
}

/** Small vector glyph per weak-point effect: crit = 4-point star, break = cracked diamond, shield = rhombus in a ring. */
function effectGlyph(ctx, x, y, effect, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(12, 8, 6, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (effect === 'shield') {
    ctx.moveTo(0, -5.5); ctx.lineTo(4.5, 0); ctx.lineTo(0, 5.5); ctx.lineTo(-4.5, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else if (effect === 'break') {
    ctx.moveTo(0, -6.5); ctx.lineTo(5, 0); ctx.lineTo(0, 6.5); ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-1.5, -4); ctx.lineTo(1, -0.5); ctx.lineTo(-1, 1.5); ctx.lineTo(1.5, 4.5);
    ctx.strokeStyle = 'rgba(12, 8, 6, 0.9)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  } else {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const r = i % 2 ? 2.2 : 6.5;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
  ctx.restore();
}

function reticlePath(ctx, R, t) {
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  const rot = t * 0.0015;
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * Math.PI) / 2;
    ctx.moveTo(Math.cos(a) * (R - 6), Math.sin(a) * (R - 6));
    ctx.lineTo(Math.cos(a) * (R + 9), Math.sin(a) * (R + 9));
  }
}

function hexA(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(a, 0, 1)})`;
}

/** Anchor the shooter's muzzle (exported for the scene's autopilot). */
export function muzzleOf(view, t) {
  const a = getAnchors(view.look, view.pose(t));
  return a.cast ?? a.weapon;
}
