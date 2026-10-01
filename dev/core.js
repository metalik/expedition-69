// Engine / input / QTE test bench for Expedition 69 (dev/core.html).
// Boots the real Game on the same DOM as index.html and exercises live input state, the timestamped
// press log, a transparent overlay scene (pause/resume with a result), fades, error isolation,
// Scene.mountUI, and a DefenseTracker metronome that judges parry/dodge/jump/counter presses.
//
// Keys: E/J parry · Q/K/Shift dodge · Space/I jump · F/L counter · O overlay · T fade · B throw once
//       V difficulty · N next pattern · -/= calibration · P autopilot
// URL:  ?pattern=N (fix one pattern) &difficulty=story|expeditioner|veteran &cal=ms &autopilot=1
//       &overlay=1 (open the overlay at start) &throw=1 (throw once in update at start)
// Automation: window.__bench.{state(), upcoming(), restart(delayMs, patternIndex)} and window.__game.

import { Game, Scene, STAGE_W } from '../src/core/engine.js';
import { ACTIONS } from '../src/core/input.js';
import {
  DefenseTracker, DEFENSE_ACTIONS, DIFFICULTY, VALID_DEFENSES, claimZone, describeOffset, perfectAction, OUTCOME_LABELS, isAvoided,
} from '../src/battle/qte.js';
import { PALETTE, FONTS, HIT_TYPE_COLORS } from '../src/render/palette.js';
import { Tweener, Timers, Ease } from '../src/core/tween.js';
import { clamp, formatNumber } from '../src/core/util.js';

/** Fake enemy attacks (hit times are attack-local ms). */
export const PATTERNS = [
  { name: 'Single strike', hits: [{ t: 900, type: 'normal' }] },
  { name: 'Triplet · 180 ms', hits: [{ t: 900, type: 'normal' }, { t: 1080, type: 'normal' }, { t: 1260, type: 'normal' }] },
  { name: 'Crimson swing (unparryable)', hits: [{ t: 1000, type: 'unparryable' }] },
  { name: 'Shockwave (jump)', hits: [{ t: 1000, type: 'jump' }] },
  { name: 'Feint, then strike', hits: [{ t: 800, type: 'feint' }, { t: 1350, type: 'normal' }] },
  { name: 'Prism attack', hits: [{ t: 1100, type: 'gradient' }] },
  { name: 'Syncopated mix', hits: [{ t: 800, type: 'normal' }, { t: 1150, type: 'jump' }, { t: 1330, type: 'normal' }, { t: 1700, type: 'unparryable' }] },
];

const DIFF_IDS = Object.keys(DIFFICULTY);
const ACTION_COLORS = { parry: '#f3dba0', dodge: '#9fd3ff', jump: '#ffcc33', gradient: '#c77dff' };
const ROW_LABEL = { parry: 'PARRY', dodge: 'DODGE', jump: 'JUMP', gradient: 'COUNTER' };
const OUTCOME_COLORS = { parry: '#fff3c2', dodge: '#9fd3ff', perfectDodge: '#c9f0ff', jump: '#ffcc33', gradient: '#d9a8ff', hit: '#ff6a55' };
const REASON_COLORS = { claim: '#f5eedf', whiff: '#e2733b', locked: '#7a706a', debounce: '#5a524c', ignored: '#5a524c' };

const LANE = {
  x0: 40, x1: 1240, nowX: 420, pxPerMs: 0.42, panelY: 452, cueY: 534, bandTop: 548, bandBottom: 632, labelY: 650,
  rowY: { parry: 562, dodge: 582, jump: 602, gradient: 622 }, rowH: 13,
};

// ------------------------------------------------------------------ drawing helpers

function panel(ctx, x, y, w, h, title) {
  ctx.save();
  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = 'rgba(224, 180, 88, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  if (title) {
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `700 13px ${FONTS.title}`;
    ctx.textBaseline = 'top';
    ctx.letterSpacing = '3px';
    ctx.fillText(title, x + 16, y + 12);
    ctx.letterSpacing = '0px';
    ctx.strokeStyle = 'rgba(224, 180, 88, 0.25)';
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 33);
    ctx.lineTo(x + w - 16, y + 33);
    ctx.stroke();
  }
  ctx.restore();
}

function text(ctx, str, x, y, { size = 16, color = PALETTE.ivory, font = FONTS.body, weight = 500, align = 'left', base = 'alphabetic', alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function cue(ctx, x, y, type, t, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const color = HIT_TYPE_COLORS[type] ?? '#fff';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  const r = 11;
  if (type === 'gradient') {
    ctx.beginPath();
    ctx.moveTo(x, y - r - 2);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r + 2);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.stroke();
  } else if (type === 'unparryable') {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + t * 0.002;
      const rr = i % 2 ? r : r + 5;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.stroke();
  } else if (type === 'jump') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 2);
    ctx.lineTo(x, y - 5);
    ctx.lineTo(x + 6, y + 2);
    ctx.stroke();
  } else {
    if (type === 'feint') ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ bench scene

class BenchScene extends Scene {
  enter(params) {
    const p = params ?? {};
    this.tweens = new Tweener();
    this.timers = new Timers();
    this.difficulty = DIFF_IDS.includes(p.difficulty) ? p.difficulty : this.game.settings.difficulty;
    this.calibration = Number.isFinite(p.calibration) ? p.calibration : this.game.settings.inputOffset;
    this.fixedPattern = Number.isInteger(p.pattern);
    this.patternIndex = this.fixedPattern ? clamp(p.pattern, 0, PATTERNS.length - 1) : 0;
    this.autopilot = !!p.autopilot;
    this.throwNext = !!p.throwOnce;
    this.judgements = [];
    this.tally = { parry: 0, dodge: 0, perfectDodge: 0, jump: 0, gradient: 0, hit: 0 };
    this.popups = [];
    this.flash = {};
    this.attackCount = 0;
    this.fadeCount = 0;
    this.overlayResult = null;
    this.pausedAt = null;
    this.autoRelease = [];
    this.helpEl = this.mountUI(this._buildHelp());
    this._startAttack(this.game.time + 700);
  }

  _buildHelp() {
    const el = document.createElement('div');
    el.setAttribute('data-bench', 'help');
    Object.assign(el.style, {
      position: 'absolute', left: '560px', top: '14px', width: '696px', padding: '8px 14px',
      font: `500 14px/1.45 ${FONTS.body}`, color: PALETTE.parchment, background: 'rgba(16,12,10,0.6)',
      border: '1px solid rgba(224,180,88,0.35)', borderRadius: '8px', boxSizing: 'border-box',
    });
    const k = (s) => `<b style="color:${PALETTE.gold};font-family:${FONTS.title};font-size:12px;letter-spacing:1px">${s}</b>`;
    el.innerHTML = `${k('E/J')} parry · ${k('Q/K/SHIFT')} dodge · ${k('SPACE/I')} jump · ${k('F/L')} counter<br>`
      + `${k('O')} overlay · ${k('T')} fade · ${k('B')} throw · ${k('V')} difficulty · ${k('N')} pattern · ${k('− / =')} calibration · ${k('P')} autopilot`
      + '<div style="position:absolute;right:10px;top:6px;font-size:11px;opacity:.55;font-style:italic">DOM via Scene.mountUI</div>';
    return el;
  }

  _startAttack(startReal) {
    this.pattern = PATTERNS[this.patternIndex % PATTERNS.length];
    this.attackStart = startReal;
    this.attackCount += 1;
    this.tracker = new DefenseTracker({ hits: this.pattern.hits, difficulty: this.difficulty, calibration: this.calibration });
    this.windows = this.tracker.windows;
    this.pressMarks = [];
    this.autoPressed = new Set();
    this.lastHitT = Math.max(...this.pattern.hits.map((h) => h.t));
  }

  /** Restart with an attack starting `delayMs` from now; returns absolute hit times. */
  restart(delayMs = 600, patternIndex = null) {
    if (Number.isInteger(patternIndex)) {
      this.patternIndex = clamp(patternIndex, 0, PATTERNS.length - 1);
      this.fixedPattern = true;
    }
    this._startAttack(this.game.time + delayMs);
    return this.upcoming();
  }

  upcoming() {
    return {
      now: performance.now(),
      pattern: this.pattern.name,
      attackStart: this.attackStart,
      hits: this.tracker.hits.map((h) => ({ index: h.index, type: h.type, t: this.attackStart + h.t, resolved: !!this.tracker.results[h.index] })),
    };
  }

  pause() {
    this.pausedAt = this.game.time;
  }

  resume(result) {
    this.overlayResult = result ?? null;
    this.pausedAt = null;
    this._startAttack(this.game.time + 600); // the metronome was frozen: begin a fresh attack
  }

  update(dt) {
    const game = this.game;
    const input = game.input;
    const now = game.time;
    this.tweens.update(dt);
    this.timers.update(dt);

    if (this.throwNext) {
      this.throwNext = false;
      throw new Error('Deliberate update error (B) — logged once, loop keeps running');
    }

    for (const a of ACTIONS) if (input.pressed(a)) this.flash[a] = now;
    for (const a of this.autoRelease) input.virtualRelease(a);
    this.autoRelease = [];

    if (input.keyPressed('KeyO')) {
      game.scenes.push('overlay', { openedAt: now });
      return;
    }
    if (input.keyPressed('KeyT')) {
      game.fade(260, () => {
        this.fadeCount += 1;
      }, 260);
    }
    if (input.keyPressed('KeyB')) this.throwNext = true;
    if (input.keyPressed('KeyP')) this.autopilot = !this.autopilot;
    let restart = false;
    if (input.keyPressed('KeyV')) {
      this.difficulty = DIFF_IDS[(DIFF_IDS.indexOf(this.difficulty) + 1) % DIFF_IDS.length];
      restart = true;
    }
    if (input.keyPressed('KeyN')) {
      this.patternIndex = (this.patternIndex + 1) % PATTERNS.length;
      restart = true;
    }
    if (input.keyPressed('Minus') || input.keyPressed('NumpadSubtract')) {
      this.calibration = clamp(this.calibration - 5, -250, 250);
      restart = true;
    }
    if (input.keyPressed('Equal') || input.keyPressed('NumpadAdd')) {
      this.calibration = clamp(this.calibration + 5, -250, 250);
      restart = true;
    }
    if (restart) this._startAttack(now + 600);

    // Autopilot: press the perfect action exactly when the hit lands (virtual buttons → press log).
    if (this.autopilot) {
      for (const h of this.tracker.hits) {
        const action = perfectAction(h.type);
        if (!action || this.autoPressed.has(h.index)) continue;
        if (now >= this.attackStart + h.t - 2 + this.calibration) {
          this.autoPressed.add(h.index);
          input.virtualPress(action, 'virtual');
          this.autoRelease.push(action);
        }
      }
    }

    // Feed this frame's presses (exact event timestamps) into the judge, then advance it.
    for (const p of input.framePresses(DEFENSE_ACTIONS)) {
      const local = p.t - this.attackStart;
      const r = this.tracker.press(p.action, local);
      this.pressMarks.push({ local, action: p.action, reason: r.reason, source: p.source });
    }
    for (const res of this.tracker.update(now - this.attackStart)) this._resolved(res);

    const localNow = now - this.attackStart;
    if (this.tracker.isDone() && localNow > this.lastHitT + 900) {
      if (!this.fixedPattern) this.patternIndex = (this.patternIndex + 1) % PATTERNS.length;
      this._startAttack(now + 350);
    }
    this.popups = this.popups.filter((p) => now - p.t0 < 1100);
  }

  _resolved(res) {
    const hit = this.tracker.hits[res.hitIndex];
    const j = {
      attack: this.attackCount,
      hitIndex: res.hitIndex,
      type: hit.type,
      outcome: res.outcome,
      offset: res.offset,
      action: res.action,
      feedback: describeOffset(res.offset),
      at: this.game.time,
    };
    this.judgements.push(j);
    if (this.judgements.length > 60) this.judgements.shift();
    this.tally[res.outcome] = (this.tally[res.outcome] ?? 0) + 1;
    const popup = { text: OUTCOME_LABELS[res.outcome].toUpperCase(), sub: j.feedback || (res.action ? '' : 'no defence'), color: OUTCOME_COLORS[res.outcome], t0: this.game.time, scale: 0.6 };
    this.tweens.to(popup, { scale: 1 }, 260, Ease.outBack);
    this.popups.push(popup);
  }

  render(ctx) {
    const game = this.game;
    const now = game.time;
    const localNow = (this.pausedAt ?? now) - this.attackStart;

    // backdrop
    const g = ctx.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, PALETTE.night);
    g.addColorStop(0.55, PALETTE.dusk);
    g.addColorStop(1, PALETTE.plum);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STAGE_W, 720);
    const sun = ctx.createRadialGradient(1100, 700, 20, 1100, 700, 520);
    sun.addColorStop(0, 'rgba(255, 215, 154, 0.35)');
    sun.addColorStop(1, 'rgba(255, 215, 154, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, STAGE_W, 720);

    text(ctx, 'EXPEDITION 69', 28, 44, { size: 30, color: PALETTE.gold, font: FONTS.title, weight: 900 });
    text(ctx, `Core bench · ${game.fps.toFixed(0)} fps · frame ${formatNumber(game.frame)} · scale ${game.scale.toFixed(3)} · ${game.pixelRatio.toFixed(2)} px/px · ${game.input.lastDevice}`,
      30, 70, { size: 15, color: PALETTE.parchment, alpha: 0.85 });

    this._renderInput(ctx, now);
    this._renderStatus(ctx);
    this._renderLog(ctx, now);
    this._renderLane(ctx, now, localNow);
  }

  _renderInput(ctx, now) {
    const input = this.game.input;
    panel(ctx, 24, 90, 380, 350, 'INPUT');
    ACTIONS.forEach((a, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 40 + col * 178;
      const y = 136 + row * 40;
      const down = input.isDown(a);
      const flash = clamp(1 - (now - (this.flash[a] ?? -1e9)) / 220, 0, 1);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, 166, 32, 16);
      ctx.fillStyle = down ? 'rgba(224, 180, 88, 0.85)' : 'rgba(245, 238, 223, 0.07)';
      ctx.fill();
      if (flash > 0) {
        ctx.strokeStyle = `rgba(255, 243, 194, ${flash})`;
        ctx.lineWidth = 2 + flash * 3;
        ctx.stroke();
      }
      ctx.restore();
      text(ctx, a.toUpperCase(), x + 14, y + 21, { size: 12, font: FONTS.title, weight: 700, color: down ? PALETTE.ink : PALETTE.ivory });
      text(ctx, input.keyLabel(a), x + 152, y + 21, { size: 15, align: 'right', weight: 600, color: down ? PALETTE.inkSoft : PALETTE.paleGold });
    });
    // axis
    const ax = input.axis();
    const cx = 80;
    const cy = 400;
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 238, 223, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.arc(cx + ax.x * 34, cy + ax.y * 34, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const ptr = input.pointer;
    text(ctx, `axis ${ax.x.toFixed(2)}, ${ax.y.toFixed(2)}`, 130, 392, { size: 15 });
    text(ctx, `pointer ${ptr.x.toFixed(0)}, ${ptr.y.toFixed(0)} ${ptr.down ? '● down' : ''}${ptr.overUI ? ' (UI)' : ''}`, 130, 414, { size: 15 });
    if (ptr.inside) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 243, 194, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ptr.x - 10, ptr.y);
      ctx.lineTo(ptr.x + 10, ptr.y);
      ctx.moveTo(ptr.x, ptr.y - 10);
      ctx.lineTo(ptr.x, ptr.y + 10);
      ctx.stroke();
      ctx.restore();
    }
  }

  _renderStatus(ctx) {
    const game = this.game;
    panel(ctx, 424, 90, 432, 350, 'ENGINE & JUDGE');
    const w = this.windows;
    const lines = [
      ['Scene stack', game.scenes.names().join(' › ')],
      ['Overlay result', this.overlayResult ? `closed after ${Math.round(this.overlayResult.closedAfterMs)} ms` : '—'],
      ['Caught errors', game.errors.length ? `${game.errors.length} · ${game.errors.at(-1).message.slice(0, 34)}…` : 'none'],
      ['Fades run', String(this.fadeCount)],
      ['Pattern', `${this.patternIndex + 1}/${PATTERNS.length} · ${this.pattern.name}`],
      ['Difficulty', `${DIFFICULTY[this.difficulty].name} (×${DIFFICULTY[this.difficulty].windowScale})`],
      ['Calibration', `${this.calibration > 0 ? '+' : ''}${this.calibration} ms`],
      ['Autopilot', this.autopilot ? 'ON (virtual presses)' : 'off'],
      ['Parry', `−${w.parry.pre} / +${w.parry.post} ms`],
      ['Dodge', `−${w.dodge.pre} / +${w.dodge.post} (perfect −${w.perfectDodge.pre} / +${w.perfectDodge.post})`],
      ['Jump · Counter', `−${w.jump.pre} / +${w.jump.post} · −${w.gradient.pre} / +${w.gradient.post}`],
    ];
    lines.forEach(([k, v], i) => {
      const y = 146 + i * 26.5;
      text(ctx, k, 444, y, { size: 12, font: FONTS.title, weight: 700, color: PALETTE.gold });
      text(ctx, v, 580, y, { size: 16 });
    });
  }

  _renderLog(ctx, now) {
    const input = this.game.input;
    panel(ctx, 876, 90, 380, 350, 'PRESS LOG');
    const entries = input.pressLog.slice(-13).reverse();
    if (!entries.length) text(ctx, 'Press any bound key…', 896, 150, { size: 16, color: PALETTE.parchment, alpha: 0.6 });
    entries.forEach((p, i) => {
      const y = 148 + i * 22;
      const age = now - p.t;
      const alpha = clamp(1 - age / 3000, 0.25, 1);
      text(ctx, `${p.t.toFixed(1)}`, 896, y, { size: 14, font: 'ui-monospace, Menlo, monospace', color: PALETTE.paleGold, alpha });
      text(ctx, p.action, 1000, y, { size: 15, weight: 600, color: ACTION_COLORS[p.action] ?? PALETTE.ivory, alpha });
      text(ctx, `${p.source}${p.code ? ` · ${p.code}` : ''}`, 1090, y, { size: 14, color: PALETTE.parchment, alpha: alpha * 0.8 });
    });
  }

  _renderLane(ctx, now, localNow) {
    const L = LANE;
    panel(ctx, 24, L.panelY, 1232, 706 - L.panelY, null);
    const xOf = (local) => L.nowX + (local - localNow) * L.pxPerMs;
    const bandH = L.bandBottom - L.bandTop;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x0 + 80, L.panelY, L.x1 - L.x0 - 80, 706 - L.panelY);
    ctx.clip();

    for (const a of DEFENSE_ACTIONS) {
      ctx.fillStyle = 'rgba(245, 238, 223, 0.05)';
      ctx.fillRect(L.x0 + 80, L.rowY[a] - L.rowH / 2, L.x1 - L.x0 - 80, L.rowH);
    }
    const lockedUntil = this.tracker.lockedUntil;
    if (lockedUntil > localNow) {
      ctx.fillStyle = 'rgba(226, 115, 59, 0.28)';
      ctx.fillRect(xOf(localNow), L.bandTop, (lockedUntil - localNow) * L.pxPerMs, bandH);
      text(ctx, 'LOCKED', xOf(localNow) + 6, L.bandTop - 4, { size: 11, font: FONTS.title, weight: 700, color: PALETTE.ember });
    }
    for (const h of this.tracker.hits) {
      const x = xOf(h.t);
      if (x < -200 || x > 1500) continue;
      const res = this.tracker.results[h.index];
      const alpha = res ? 0.45 : 1;
      const zone = claimZone(h.type, this.windows);
      ctx.fillStyle = h.type === 'feint' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(xOf(h.t - zone.pre), L.bandTop, (zone.pre + zone.post) * L.pxPerMs, bandH);
      for (const a of VALID_DEFENSES[h.type]) {
        const w = this.windows[a];
        ctx.fillStyle = ACTION_COLORS[a];
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillRect(xOf(h.t - w.pre), L.rowY[a] - L.rowH / 2, (w.pre + w.post) * L.pxPerMs, L.rowH);
        if (a === 'dodge') {
          const p = this.windows.perfectDodge;
          ctx.globalAlpha = alpha * 0.9;
          ctx.fillRect(xOf(h.t - p.pre), L.rowY.dodge - L.rowH / 2, (p.pre + p.post) * L.pxPerMs, L.rowH);
        }
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = HIT_TYPE_COLORS[h.type];
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      if (h.type === 'feint') ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, L.bandTop);
      ctx.lineTo(x, L.bandBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      cue(ctx, x, L.cueY, h.type, now, alpha);
      if (res) text(ctx, OUTCOME_LABELS[res.outcome], x, L.labelY, { size: 13, align: 'center', weight: 700, color: OUTCOME_COLORS[res.outcome] });
      else text(ctx, h.type, x, L.labelY, { size: 13, align: 'center', color: PALETTE.parchment, alpha: 0.8 });
    }
    for (const m of this.pressMarks) {
      ctx.save();
      ctx.translate(xOf(m.local), L.rowY[m.action]);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = REASON_COLORS[m.reason] ?? '#fff';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }
    ctx.restore();

    for (const a of DEFENSE_ACTIONS) text(ctx, ROW_LABEL[a], L.x0 + 4, L.rowY[a] + 4, { size: 11, font: FONTS.title, weight: 700, color: ACTION_COLORS[a] });
    ctx.save();
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.nowX, L.cueY - 14);
    ctx.lineTo(L.nowX, L.bandBottom + 2);
    ctx.stroke();
    ctx.restore();
    text(ctx, 'NOW', L.nowX, L.cueY - 20, { size: 11, align: 'center', font: FONTS.title, weight: 700, color: PALETTE.gold });
    text(ctx, `${this.pattern.name.toUpperCase()} · ATTACK ${this.attackCount}`, 44, L.panelY + 30, { size: 13, font: FONTS.title, weight: 700, color: PALETTE.gold });

    for (const p of this.popups) {
      const age = now - p.t0;
      const a = clamp(1 - (age - 500) / 600, 0, 1);
      ctx.save();
      ctx.translate(760, L.panelY + 42);
      ctx.scale(p.scale, p.scale);
      text(ctx, p.text, 0, 0, { size: 30, font: FONTS.title, weight: 900, color: p.color, alpha: a, align: 'center' });
      if (p.sub) text(ctx, p.sub, 0, 22, { size: 17, color: PALETTE.ivory, alpha: a, align: 'center' });
      ctx.restore();
    }

    const t = this.tally;
    text(ctx, `Parry ${t.parry} · Dodge ${t.dodge} · Perfect dodge ${t.perfectDodge} · Jump ${t.jump} · Counter ${t.gradient} · Hit ${t.hit}`,
      44, 678, { size: 17, weight: 600, color: PALETTE.paleGold });
    const recent = this.judgements.slice(-3).reverse().map((j) => `${j.type} → ${OUTCOME_LABELS[j.outcome]}${j.feedback ? ` (${j.feedback})` : ''}`);
    text(ctx, recent.join('   ·   ') || 'Waiting for the first hit…', 44, 698, { size: 15, color: PALETTE.parchment, alpha: 0.85 });
    const avoided = this.judgements.filter((j) => isAvoided(j.outcome)).length;
    text(ctx, `${avoided}/${this.judgements.length} avoided`, 1236, 678, { size: 15, align: 'right', color: PALETTE.parchment });
  }
}

// ------------------------------------------------------------------ transparent overlay scene

class OverlayScene extends Scene {
  constructor(game) {
    super(game);
    this.transparent = true;
  }

  enter(params) {
    this.openedAt = params?.openedAt ?? this.game.time;
    this.appear = { a: 0 };
    this.tweens = new Tweener();
    this.tweens.to(this.appear, { a: 1 }, 220, Ease.outCubic);
    const el = document.createElement('div');
    el.setAttribute('data-bench', 'overlay');
    Object.assign(el.style, {
      position: 'absolute', left: '400px', top: '412px', width: '480px', textAlign: 'center',
      font: `italic 500 16px/1.3 ${FONTS.body}`, color: PALETTE.paleGold, pointerEvents: 'none',
    });
    el.textContent = 'This DOM node was mounted by the overlay and disappears when it pops.';
    this.mountUI(el);
  }

  update(dt) {
    this.tweens.update(dt);
    const input = this.game.input;
    if (input.pressed('cancel') || input.keyPressed('KeyO')) {
      this.game.scenes.pop({ closedAfterMs: this.game.time - this.openedAt });
    }
  }

  render(ctx) {
    const a = this.appear.a;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8, 5, 3, 0.55)';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.translate(640, 330);
    ctx.scale(0.94 + 0.06 * a, 0.94 + 0.06 * a);
    panel(ctx, -260, -120, 520, 240, 'TRANSPARENT OVERLAY');
    text(ctx, 'The bench beneath keeps rendering', 0, -38, { size: 22, align: 'center', weight: 600 });
    text(ctx, 'but is paused: only the top scene updates.', 0, -10, { size: 22, align: 'center', weight: 600 });
    text(ctx, `Open for ${((this.game.time - this.openedAt) / 1000).toFixed(1)} s`, 0, 26, { size: 18, align: 'center', color: PALETTE.parchment });
    text(ctx, `Press ${this.game.input.keyLabel('cancel')} or O to pop → resume(result)`, 0, 58, { size: 17, align: 'center', color: PALETTE.gold });
    ctx.restore();
  }
}

// ------------------------------------------------------------------ boot

function boot() {
  const game = new Game({
    canvas: document.getElementById('game'),
    uiRoot: document.getElementById('ui'),
    stageEl: document.getElementById('stage'),
    fadeEl: document.getElementById('fade'),
  });
  window.__game = game;
  game.registerScene('bench', BenchScene).registerScene('overlay', OverlayScene);

  const q = game.params;
  const num = (k) => (q.has(k) && q.get(k) !== '' && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const pattern = num('pattern');
  game.scenes.push('bench', {
    pattern: Number.isInteger(pattern) ? pattern : undefined,
    difficulty: q.get('difficulty') ?? undefined,
    calibration: num('cal'),
    autopilot: q.get('autopilot') === '1',
    throwOnce: q.get('throw') === '1',
  });
  if (q.get('overlay') === '1') game.scenes.push('overlay', { openedAt: game.time });

  window.__bench = {
    get scene() {
      return game.scenes.get('bench');
    },
    state() {
      const b = game.scenes.get('bench');
      return {
        attack: b.attackCount,
        pattern: b.pattern.name,
        patternIndex: b.patternIndex,
        difficulty: b.difficulty,
        calibration: b.calibration,
        autopilot: b.autopilot,
        judgements: b.judgements.slice(-20),
        tally: { ...b.tally },
        pressMarks: b.pressMarks.map((m) => ({ ...m })),
        pressLog: game.input.pressLog.map((p) => ({ action: p.action, t: p.t, source: p.source, code: p.code })),
        overlayResult: b.overlayResult,
        fadeCount: b.fadeCount,
        scenes: game.scenes.names(),
        errors: game.errors.map((e) => `${e.scene}/${e.phase}: ${e.message}`),
        uncaught: [...window.__errors],
        frame: game.frame,
        fps: game.fps,
        lastDevice: game.input.lastDevice,
        lockedUntil: b.tracker.lockedUntil,
        uiNodes: [...game.uiRoot.querySelectorAll('[data-bench]')].map((n) => n.getAttribute('data-bench')),
        fadeOpacity: Number(getComputedStyle(game.fadeEl).opacity),
      };
    },
    upcoming: () => game.scenes.get('bench').upcoming(),
    restart: (delayMs, patternIndex) => game.scenes.get('bench').restart(delayMs, patternIndex),
  };

  game.start();
}

try {
  boot();
} catch (err) {
  window.__showError?.(err?.stack ?? String(err));
  throw err;
}
