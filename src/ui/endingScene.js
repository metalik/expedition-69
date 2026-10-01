// Ending (registry 'ending'): STORY.ending slides — the hand moves, sunset, the first night, the ones who stayed,
// morning — then a credits roll under a sky that turns from stars to dawn, the expedition's records, and a final
// card before returning to the title. Hold confirm to hurry the credits; hold cancel to skip.

import { CinematicScene, drawMotes, hash01, wash, withZoom, drawCineOverlay } from './introScene.js';
import { el, HoldGauge, anyInputPressed, clickable } from './widgets.js';
import { escapeHtml, formatInt, formatPlayTime } from './text.js';
import { STORY } from '../data/story.js';
import { drawTitleBackground, drawBattleBackground } from '../render/backgrounds.js';
import { saveGame } from '../game/gameState.js';

function drawStars(ctx, t, alpha, count = 160) {
  if (alpha <= 0) return;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = hash01(i, 11) * 1280;
    const y = hash01(i, 12) * 470;
    const tw = 0.5 + 0.5 * Math.sin(t / (500 + hash01(i, 13) * 900) + i);
    const r = 0.5 + hash01(i, 14) * 1.5;
    ctx.globalAlpha = alpha * (0.3 + 0.7 * tw) * (1 - y / 620);
    ctx.fillStyle = hash01(i, 15) > 0.85 ? '#ffe8c0' : '#f2f0ff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function mix(a, b, k) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * k));
}

/** Night sky that brightens into dawn: stars fade, a sun disc rises over a graded sea with a sun path. */
function nightSky(ctx, t, dawn = 0) {
  const k = Math.max(0, Math.min(1, dawn));
  const horizon = 600;
  const top = mix([5, 5, 16], [38, 36, 84], k);
  const mid = mix([14, 12, 34], [150, 96, 128], k);
  const low = mix([28, 22, 48], [255, 196, 150], k);
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, `rgb(${top})`);
  g.addColorStop(0.62, `rgb(${mid})`);
  g.addColorStop(1, `rgb(${low})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, horizon);
  drawStars(ctx, t, 1 - k * 1.2);
  const sunY = horizon + 40 - k * 110;
  if (k > 0) {
    ctx.save();
    const glow = ctx.createRadialGradient(640, sunY, 20, 640, sunY, 560);
    glow.addColorStop(0, `rgba(255, 226, 170, ${0.55 * k})`);
    glow.addColorStop(0.35, `rgba(255, 170, 130, ${0.22 * k})`);
    glow.addColorStop(1, 'rgba(255, 150, 120, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1280, horizon);
    ctx.beginPath();
    ctx.rect(0, 0, 1280, horizon);
    ctx.clip();
    const disc = ctx.createRadialGradient(640, sunY - 10, 4, 640, sunY, 64);
    disc.addColorStop(0, `rgba(255, 246, 214, ${k})`);
    disc.addColorStop(0.8, `rgba(255, 206, 128, ${k})`);
    disc.addColorStop(1, 'rgba(255, 200, 140, 0)');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(640, sunY, 64, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // graded sea with a path of light under the sun
  const sea = ctx.createLinearGradient(0, horizon, 0, 720);
  sea.addColorStop(0, `rgb(${mix([20, 18, 40], [150, 104, 120], k)})`);
  sea.addColorStop(1, `rgb(${mix([6, 6, 14], [40, 30, 52], k)})`);
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, 1280, 720 - horizon);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) {
    const y = horizon + 6 + hash01(i, 3) ** 1.4 * 110;
    const spread = 30 + (y - horizon) * 1.6;
    const x = 640 + (hash01(i, 4) - 0.5) * spread * 2 + Math.sin(t / 900 + i) * 6;
    const w = 12 + hash01(i, 5) * 40;
    ctx.globalAlpha = (0.15 + 0.5 * k) * (1 - (y - horizon) / 140);
    ctx.fillStyle = k > 0.15 ? '#ffe2b0' : '#9fa4d8';
    ctx.fillRect(x - w / 2, y, w, 1.4);
  }
  ctx.restore();
  ctx.fillStyle = `rgba(255, 230, 190, ${0.25 + k * 0.4})`;
  ctx.fillRect(0, horizon, 1280, 1);
}

const ENDING_ART = [
  // I — The Hand Moves: the Unwound summit settles
  (ctx, t, T) => {
    drawBattleBackground(ctx, 'summit', T, { phase: Math.max(0, 1 - t / 7000), camera: { x: 0, y: -10, zoom: 1.04 } });
    drawMotes(ctx, T, { count: 40, color: [255, 236, 190], alpha: 0.55, rise: 20, seed: 7 });
  },
  // II — Sunset: the dusk finally deepens
  (ctx, t, T) => {
    const k = Math.min(1, t / 12000);
    withZoom(ctx, 640, 300, 1.02 + k * 0.04, () => drawTitleBackground(ctx, T, { parallax: { x: 0, y: -k * 12 } }));
    wash(ctx, '#b0304a', 0.18 + k * 0.2, 'multiply');
    wash(ctx, '#3a1a5a', k * 0.45, 'multiply');
  },
  // III — Night: the first stars
  (ctx, t, T) => {
    nightSky(ctx, T, 0);
    drawMotes(ctx, T, { count: 16, color: [200, 210, 255], alpha: 0.3, rise: 3, seed: 3 });
  },
  // IV — The Ones Who Stayed: lights thinning into the dark
  (ctx, t, T) => {
    drawBattleBackground(ctx, 'summit', T, { camera: { x: 0, y: 0, zoom: 1.02 } });
    wash(ctx, '#0c0818', 0.62, 'multiply');
    drawStars(ctx, T, 0.8, 90);
    drawMotes(ctx, T + t, { count: 70, color: [255, 240, 210], alpha: 0.6, rise: 26, drift: 2, size: 2.6, seed: 17, area: [80, 180, 1120, 520] });
  },
  // V — Morning
  (ctx, t, T) => {
    const k = Math.min(1, t / 9000);
    drawBattleBackground(ctx, 'shore', T, { camera: { x: 0, y: -k * 16, zoom: 1.03 } });
    wash(ctx, '#ffc0a0', 0.22 + k * 0.15, 'screen');
    wash(ctx, '#fff0d8', k * 0.12, 'soft-light');
    drawMotes(ctx, T, { count: 30, alpha: 0.45, seed: 29 });
  },
  // VI — Expedition 69: a new boat, a fresh journal
  (ctx, t, T) => {
    withZoom(ctx, 400, 470, 1.14 - Math.min(1, t / 14000) * 0.08, () => drawTitleBackground(ctx, T, { parallax: { x: 6, y: 0 } }));
    wash(ctx, '#ffd8b0', 0.28, 'screen');
    drawMotes(ctx, T, { count: 30, alpha: 0.5, seed: 37 });
  },
];

const CREDITS_MS = 46000;

export class EndingScene extends CinematicScene {
  enter() {
    this.slides = Array.isArray(STORY.ending) && STORY.ending.length ? STORY.ending : [{ title: 'Morning', text: 'The Sun rose.' }];
    this.art = this.slides.map((_, i) => ENDING_ART[i % ENDING_ART.length]);
    this.zones = ['summit', null, null, 'summit', 'shore', null];
    this.phase = 'slides';
    this.game.audio?.playMusic?.('ending', { fade: 2000 });
    const st = this.game.state;
    if (st?.world) {
      st.world.story = st.world.story ?? {};
      st.world.story.ending_seen = true;
      saveGame(st);
    }
    this.setupSlides('ending-screen');
  }

  finishSlides(skipped = false) {
    if (this.phase !== 'slides') {
      if (skipped) this.toTitle();
      return;
    }
    this.phase = 'credits';
    this.creditsT = 0;
    this.textHost.innerHTML = '';
    this.root.classList.remove('is-complete');
    this.root.querySelector('.cine-foot').style.display = 'none';
    this.roll = el('div', { class: 'credits-roll', html: this.creditsHtml() });
    this.root.appendChild(this.roll);
    this.final = el('div', { class: 'ending-final', html: `
      <div class="ef-title">Expedition 69</div>
      <div class="ef-sub">“Day 1. The Sun rose. We are coming home.”</div>
      <div class="ef-press">Press any key</div>` });
    this.root.appendChild(this.final);
    this.creditHold = new HoldGauge(this.game, { action: 'cancel', ms: 900, label: 'Hold to skip', tapLabel: 'Skip' });
    const skip = el('div', { class: 'credits-skip' }, this.creditHold.el);
    clickable(skip, () => {
      if (this.phase === 'credits') this.creditsT = CREDITS_MS;
    });
    this.root.appendChild(skip);
  }

  onDeviceChange() {
    super.onDeviceChange();
    this.creditHold?.relabel();
  }

  creditsHtml() {
    const st = this.game.state?.stats ?? {};
    const stat = (label, v) => `<span>${escapeHtml(label)}</span><b>${v}</b>`;
    return `<div style="height:760px"></div>
      <div class="cr-logo">EXPEDITION 69</div>
      <div class="cr-tag">A tale of the endless dusk</div>
      <h4>The Expedition</h4>
      <p>Gideon Marchal<small>the Vanguard, captain of the Brinegate watch</small></p>
      <p>Nyra Solace<small>the Glyphwright, archivist of the Veyran Lyceum</small></p>
      <p>Sable Arden<small>the Duellist, daughter of the sixty-eighth</small></p>
      <h4>Those Who Waited</h4>
      <p>Aurèle Vantine, the Stillkeeper</p><p>Lise, who asked to see the sunset</p>
      <p>Pellam Quist · Drillmaster Hesper · the Lamplighter</p><p>The Cartographer · the Apprentice</p>
      <p>and the crews of sixty-eight expeditions</p>
      <h4>Design, Writing &amp; Code</h4><p>The Expedition 69 Workshop</p>
      <h4>Art</h4><p>Painted procedurally, stroke by stroke, on canvas</p>
      <h4>Music &amp; Sound</h4><p>Synthesized live in your browser with WebAudio</p>
      <h4>Typefaces</h4><p>Cinzel by Natanael Gama</p><p>Cormorant Garamond by Christian Thalmann</p>
      <h4>Inspiration</h4><p>An original game.<small>Its combat mechanics are inspired by <i>Clair Obscur: Expedition 33</i>; all names, characters, story, art, audio and code are original.</small></p>
      <h4>Your Expedition</h4>
      <div class="cr-stats">
        ${stat('Time on the road', formatPlayTime(st.playTimeMs ?? 0))}
        ${stat('Battles won', formatInt(st.victories ?? 0))}
        ${stat('Parries', formatInt(st.parries ?? 0))}
        ${stat('Perfect dodges', formatInt(st.perfectDodges ?? 0))}
        ${stat('Perfect strikes', formatInt(st.perfects ?? 0))}
        ${stat('Prism counters', formatInt(st.gradientCounters ?? 0))}
        ${stat('Times fallen', formatInt(st.deaths ?? 0))}
      </div>
      <div class="cr-end">Thank you for playing</div>
      <div class="cr-quote">Somewhere in Veyra, someone has stopped painting SEVENTY on the prow of a boat.</div>
      <div style="height:420px"></div>`;
  }

  toTitle() {
    if (this.leaving) return;
    this.leaving = true;
    this.done = true;
    const game = this.game;
    game.audio?.stopMusic?.({ fade: 1600 });
    game.fade(1400, () => game.scenes.reset('title', {}), 1000);
  }

  update(dt) {
    if (this.phase === 'slides') {
      super.update(dt);
      return;
    }
    this.time += dt;
    if (this.leaving) return;
    const input = this.game.input;
    if (this.phase === 'credits') {
      const fast = input.isDown('confirm') || input.isDown('qte');
      this.creditsT += dt * (fast ? 5 : 1);
      if (this.creditHold.update(dt)) this.creditsT = CREDITS_MS;
      const h = this.roll.offsetHeight || 3000;
      const k = Math.min(1, this.creditsT / CREDITS_MS);
      this.roll.style.transform = `translateY(${-k * (h - 200)}px)`;
      if (k >= 1) {
        this.phase = 'final';
        this.finalT = 0;
        this.final.classList.add('is-visible');
        this.creditHold.el.style.opacity = '0';
        this.roll.style.opacity = '0';
        this.roll.style.transition = 'opacity 1s';
      }
      return;
    }
    if (this.phase === 'final') {
      this.finalT += dt;
      if (this.finalT > 1600 && anyInputPressed(input)) {
        input.consume();
        this.sfx('ui_confirm');
        this.toTitle();
      }
    }
  }

  render(ctx) {
    if (this.phase === 'slides') {
      super.render(ctx);
      return;
    }
    const k = this.phase === 'final' ? 1 : Math.min(1, (this.creditsT ?? 0) / CREDITS_MS);
    nightSky(ctx, this.game.time, Math.max(0, Math.min(0.85, (k - 0.25) / 0.7)));
    drawMotes(ctx, this.game.time, { count: 20, alpha: 0.35, seed: 61 });
    drawCineOverlay(ctx, { bars: 0, bottom: 0.3 });
    if (this.phase === 'final') {
      const a = Math.min(1, (this.finalT ?? 0) / 1400) * 0.45;
      const v = ctx.createRadialGradient(640, 330, 40, 640, 330, 520);
      v.addColorStop(0, `rgba(12, 8, 20, ${a})`);
      v.addColorStop(1, 'rgba(12, 8, 20, 0)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, 1280, 720);
    }
  }
}
