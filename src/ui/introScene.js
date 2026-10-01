// Opening cinematic (registry 'intro'): STORY.intro slides over painterly animated canvas compositions (the frozen
// Clockwork Sun, the paused shore, Gloam silhouettes, drifting journals, the three heroes, the landing), with
// word-by-word text reveal, confirm to advance, hold cancel to skip, then reset('world', {arrival:true}).
// Exports CinematicScene, the slideshow base the ending reuses.

import { UIScene, el, HoldGauge } from './widgets.js';
import { escapeHtml, roman, wordSpans, keyCapHtml } from './text.js';
import { STORY } from '../data/story.js';
import { drawTitleBackground, drawBattleBackground, prepareBattleBackground } from '../render/backgrounds.js';
import { drawActor } from '../render/sprites.js';

const XFADE = 1100;

/** Deterministic pseudo-random in [0,1) for particle layouts. */
export function hash01(i, k = 0) {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Cinematic letterbox + bottom legibility gradient, drawn over any art. */
export function drawCineOverlay(ctx, { bars = 1, bottom = 0.78 } = {}) {
  ctx.save();
  const g = ctx.createLinearGradient(0, 360, 0, 720);
  g.addColorStop(0, 'rgba(6,4,6,0)');
  g.addColorStop(0.55, `rgba(6,4,6,${bottom * 0.6})`);
  g.addColorStop(1, `rgba(4,3,4,${bottom})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 360, 1280, 360);
  const v = ctx.createRadialGradient(640, 320, 300, 640, 360, 820);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 1280, 720);
  if (bars > 0) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1280, 44 * bars);
    ctx.fillRect(0, 720 - 30 * bars, 1280, 30 * bars);
  }
  ctx.restore();
}

/** Glowing motes (additive), positions derived from time so they need no update step. */
export function drawMotes(ctx, t, { count = 40, color = [255, 222, 160], rise = 12, drift = 8, alpha = 0.6, seed = 0, size = 2.2, area = [0, 0, 1280, 720] } = {}) {
  const [ax, ay, aw, ah] = area;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const h1 = hash01(i + seed, 1);
    const h2 = hash01(i + seed, 2);
    const h3 = hash01(i + seed, 3);
    const x = ax + ((h1 * aw + (t / 1000) * drift * (0.5 + h3)) % aw + aw) % aw;
    const y = ay + ((h2 * ah - (t / 1000) * rise * (0.6 + h3)) % ah + ah) % ah;
    const a = alpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 700 + i * 1.7)));
    const r = (0.6 + h3) * size;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${a})`);
    g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  }
  ctx.restore();
}

/** Slow Ken-Burns zoom around a focal point. */
export function withZoom(ctx, fx, fy, k, draw) {
  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(k, k);
  ctx.translate(-fx, -fy);
  draw();
  ctx.restore();
}

/** Full-screen colour wash with a blend mode. */
export function wash(ctx, color, alpha, mode = 'source-over') {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.restore();
}

function drawPages(ctx, t, alpha) {
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const sp = 18 + hash01(i, 4) * 30;
    const x = ((hash01(i, 1) * 1500 + (t / 1000) * sp) % 1500) - 110;
    const y = 180 + hash01(i, 2) * 300 + Math.sin(t / 1600 + i) * 18;
    const rot = Math.sin(t / 2100 + i * 2) * 0.35 + (hash01(i, 3) - 0.5);
    const s = 0.7 + hash01(i, 5) * 0.6;
    ctx.save();
    ctx.globalAlpha = alpha * (0.55 + hash01(i, 6) * 0.4);
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(s, s * (0.75 + 0.25 * Math.cos(t / 900 + i)));
    const g = ctx.createLinearGradient(-38, -26, 38, 26);
    g.addColorStop(0, '#f4e8cc');
    g.addColorStop(1, '#cdb88c');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(255, 210, 140, 0.35)';
    ctx.shadowBlur = 12;
    ctx.fillRect(-38, -26, 76, 52);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(80, 50, 30, 0.45)';
    ctx.lineWidth = 1.2;
    for (let l = 0; l < 6; l++) {
      ctx.beginPath();
      ctx.moveTo(-30, -16 + l * 7);
      ctx.lineTo(-30 + 50 + hash01(i * 7 + l, 8) * 10, -16 + l * 7);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Intro compositions: (ctx, t local ms, T global ms) for each STORY.intro slide. */
const INTRO_ART = [
  // I — Veyra: the Clockwork Sun, slow push-in
  (ctx, t, T) => {
    withZoom(ctx, 640, 290, 1 + Math.min(1, t / 14000) * 0.07, () => drawTitleBackground(ctx, T, { parallax: { x: -t / 900, y: 0 } }));
    drawMotes(ctx, T, { count: 30, alpha: 0.5 });
  },
  // II — The Endless Dusk: the paused shore
  (ctx, t, T) => {
    drawBattleBackground(ctx, 'shore', T, { camera: { x: -50 + t / 180, y: -8, zoom: 1.04 } });
    wash(ctx, '#ffb070', 0.14, 'soft-light');
    drawMotes(ctx, T, { count: 46, alpha: 0.55, rise: 5, drift: 3, seed: 11 });
  },
  // III — The Gloam: silhouettes gathering in violet dusk
  (ctx, t, T) => {
    drawBattleBackground(ctx, 'spire', T, { camera: { x: 30 - t / 250, y: 0, zoom: 1.03 } });
    wash(ctx, '#2a1640', 0.55, 'multiply');
    wash(ctx, '#8a5cc4', 0.16, 'screen');
    const figures = [
      ['driftling', 200, 395, 1.0, 1], ['mime', 400, 430, 0.95, 1], ['sentinel', 880, 440, 0.95, -1],
      ['hourwraith', 1060, 400, 0.95, -1], ['coghound', 1170, 445, 0.9, -1],
    ];
    figures.forEach(([look, x, y, s, f], i) => {
      const a = Math.max(0, Math.min(1, (t - 400 - i * 420) / 1400));
      if (a <= 0) return;
      drawActor(ctx, look, { x, y, scale: s, facing: f, anim: 'idle', t: T + i * 400, tint: { color: '#120a1c', amount: 0.86 }, alpha: a * 0.95, shadow: false });
    });
    drawMotes(ctx, T, { count: 36, color: [200, 160, 255], alpha: 0.5, rise: 16, seed: 23 });
  },
  // IV — The Expeditions: pages drifting on a tide that does not move
  (ctx, t, T) => {
    withZoom(ctx, 400, 470, 1.22 + Math.min(1, t / 14000) * 0.05, () => drawTitleBackground(ctx, T, { parallax: { x: 10, y: 4 } }));
    wash(ctx, '#1a1030', 0.35, 'multiply');
    drawPages(ctx, T, Math.min(1, t / 1500));
    drawMotes(ctx, T, { count: 24, alpha: 0.45, seed: 31 });
  },
  // V — Expedition 69: the three, lit by the frozen dusk
  (ctx, t, T) => {
    drawBattleBackground(ctx, 'training', T, { camera: { x: 0, y: 0, zoom: 1.05 } });
    wash(ctx, '#140c10', 0.45, 'multiply');
    const g = ctx.createRadialGradient(640, 500, 40, 640, 470, 520);
    g.addColorStop(0, 'rgba(255, 205, 140, 0.4)');
    g.addColorStop(1, 'rgba(255, 170, 90, 0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.restore();
    const party = [['nyra', 500, 405, 0], ['gideon', 640, 420, 350], ['sable', 780, 410, 700]];
    for (const [look, x, y, d] of party) {
      const a = Math.max(0, Math.min(1, (t - 200 - d) / 900));
      drawActor(ctx, look, { x, y: y + (1 - a) * 12, scale: 1.15, facing: 1, anim: 'idle', t: T + d, alpha: a });
    }
    drawMotes(ctx, T, { count: 30, alpha: 0.5, seed: 41, area: [300, 200, 680, 450] });
  },
  // VI — Brinegate Shore: landing
  (ctx, t, T) => {
    drawBattleBackground(ctx, 'shore', T, { camera: { x: 40 - t / 300, y: 0, zoom: 1.02 } });
    const walk = Math.min(1, t / 9000);
    const baseX = -40 + walk * 420;
    [['gideon', 0, 402], ['nyra', -95, 392], ['sable', -185, 410]].forEach(([look, dx, y], i) => {
      drawActor(ctx, look, { x: baseX + dx, y, scale: 0.85, facing: 1, anim: walk < 1 ? 'walk' : 'idle', t: T + i * 170 });
    });
    drawMotes(ctx, T, { count: 30, alpha: 0.5, seed: 53, rise: 4 });
  },
];

/**
 * Slideshow base: DOM text per slide (numeral, title, word-by-word body), canvas art per slide with cross-fades,
 * confirm to reveal/advance, hold cancel to skip. Subclasses set `slides`, `art`, and implement finish().
 */
export class CinematicScene extends UIScene {
  constructor(game) {
    super(game);
    this.slides = [];
    this.art = [];
    this.index = -1;
    this.slideT = 0;
    this.prev = null;
    this.done = false;
    this.zones = [];
  }

  /** Build DOM; call from enter() after setting slides/art. */
  setupSlides(className = '') {
    const root = this.mountRoot(`cine-screen ${className}`.trim());
    this.textHost = el('div', { class: 'cine-text' });
    this.progressEl = el('div', { class: 'cine-progress' });
    this.hold = new HoldGauge(this.game, { action: 'cancel', ms: 900, label: 'Hold to skip', tapLabel: 'Skip' });
    const skip = el('div', { class: 'cine-skip-btn' }, this.hold.el);
    skip.addEventListener('mousedown', (e) => e.preventDefault());
    skip.addEventListener('click', () => this.skip());
    this.nextEl = el('div', { class: 'cine-next', html: `${keyCapHtml(this.game, 'confirm')}<span>Continue</span>` });
    const foot = el('div', { class: 'cine-foot' }, this.progressEl, el('div', { style: 'display:flex;gap:30px;align-items:center' }, this.nextEl, skip));
    root.append(this.textHost, foot);
    root.addEventListener('mousedown', (e) => e.preventDefault());
    root.addEventListener('click', (e) => {
      if (e.target.closest('.cine-skip-btn')) return;
      this.advance();
    });
    root.style.pointerEvents = 'auto';
    this.show(0);
  }

  onDeviceChange() {
    super.onDeviceChange();
    this.hold?.relabel();
  }

  show(i) {
    if (i >= this.slides.length) {
      this.finishSlides();
      return;
    }
    if (this.index >= 0) this.prev = { index: this.index, t: this.slideT, at: this.game.time };
    this.index = i;
    this.slideT = 0;
    const s = this.slides[i];
    const { html, count } = wordSpans(s.text ?? '');
    const old = this.textHost.firstElementChild;
    if (old) {
      old.style.transition = 'opacity .35s';
      old.style.opacity = '0';
      setTimeout(() => old.remove(), 360);
    }
    const block = el('div', { class: 'cine-block', style: 'display:flex;flex-direction:column;align-items:center' });
    block.innerHTML = `<div class="cine-num">${roman(i + 1)}</div>
      ${s.title ? `<div class="cine-title">${escapeHtml(s.title)}</div><div class="rule cine-rule"></div>` : ''}
      <div class="cine-body">${html}</div>`;
    this.textHost.appendChild(block);
    this.root.classList.remove('is-revealed', 'is-complete');
    this.revealMs = 750 + count * 55 + 700;
    this.progressEl.innerHTML = this.slides.map((_, k) => `<i class="${k < i ? 'on' : k === i ? 'now' : ''}"></i>`).join('');
    // warm the next slide's background
    const z = this.zones[i + 1];
    if (z) this.later(900, () => {
      try {
        prepareBattleBackground(z, { scale: this.game.pixelRatio });
      } catch {
        /* optional */
      }
    });
  }

  advance() {
    if (this.done) return;
    if (this.slideT < this.revealMs) {
      this.root.classList.add('is-revealed');
      this.slideT = this.revealMs;
      this.root.classList.add('is-complete');
      return;
    }
    this.sfx('ui_move', { volume: 0.5, pitch: 0.8 });
    this.show(this.index + 1);
  }

  skip() {
    if (this.done) return;
    this.sfx('ui_cancel');
    this.finishSlides(true);
  }

  /** Called after the last slide (or on skip). */
  finishSlides() {}

  drawSlide(ctx, index, t, alpha) {
    const fn = this.art[index];
    if (!fn) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    try {
      fn(ctx, t, this.game.time);
    } catch (err) {
      console.warn('[cinematic] art failed', err);
    }
    ctx.restore();
  }

  update(dt) {
    this.time += dt;
    if (this.done) return;
    this.slideT += dt;
    if (this.slideT >= this.revealMs) this.root.classList.add('is-complete');
    if (this.hold.update(dt)) {
      this.skip();
      return;
    }
    const input = this.game.input;
    if (input.pressed('confirm') || input.pressed('qte')) {
      input.consume(['confirm', 'qte', 'jump']);
      this.advance();
    }
  }

  render(ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1280, 720);
    if (this.index < 0) return;
    const now = this.game.time;
    if (this.prev) {
      const k = Math.min(1, (now - this.prev.at) / XFADE);
      if (k >= 1) this.prev = null;
      else {
        this.drawSlide(ctx, this.prev.index, this.prev.t + (now - this.prev.at), 1);
        this.drawSlide(ctx, this.index, this.slideT, k * k * (3 - 2 * k));
        drawCineOverlay(ctx);
        return;
      }
    }
    this.drawSlide(ctx, this.index, this.slideT, Math.min(1, this.slideT / 900 + (this.index > 0 ? 1 : 0)));
    drawCineOverlay(ctx);
  }
}

export class IntroScene extends CinematicScene {
  enter() {
    this.slides = Array.isArray(STORY.intro) && STORY.intro.length ? STORY.intro : [{ title: 'Expedition 69', text: 'The Sun has stopped. Sixty-eight expeditions have failed.' }];
    this.art = this.slides.map((_, i) => INTRO_ART[i % INTRO_ART.length]);
    this.zones = [null, 'shore', 'spire', null, 'training', 'shore'];
    this.game.audio?.playMusic?.('title', { fade: 1500 });
    this.setupSlides('intro-screen');
  }

  finishSlides() {
    if (this.done) return;
    this.done = true;
    this.focus.clear();
    const game = this.game;
    game.audio?.stopMusic?.({ fade: 1200 });
    game.fade(1000, () => game.scenes.reset('world', { arrival: true }), 900);
  }
}

