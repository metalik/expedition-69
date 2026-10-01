// Battle VFX for Expedition 69: pooled particles, floating combat text (laid out in lanes so numbers, words and
// QTE ratings never pile up), rings, slash arcs, tracers, ground shockwaves, projectiles, screen flash / shake /
// vignette / desaturation, brush-stroke banners, and the stateless painters for offensive QTE rings, defense
// assist cues, target markers and enemy bars (which fade while combat text passes over them).

import { PALETTE, ELEMENT_COLORS, HIT_TYPE_COLORS, QTE_COLORS, FONTS } from './palette.js';
import { iconCanvas } from './icons.js';

/** Every preset understood by {@link Effects#burst}. */
export const BURST_KINDS = [
  'hit', 'crit', 'parry', 'perfect', 'dodge', 'jump', 'heal', 'buff', 'debuff', 'fire', 'ice', 'lightning',
  'earth', 'light', 'dark', 'physical', 'break', 'ko', 'gradient', 'shield', 'counter', 'land',
  // additions (not in the spec list, available for flourish)
  'perfectDodge', 'glyph', 'surge',
];

/** Projectile kinds understood by {@link Effects#projectile}. */
export const PROJECTILE_KINDS = ['bolt', 'thorn', 'orb', 'glyph', 'bullet'];

const TAU = Math.PI * 2;
const STAGE_W = 1280;
const STAGE_H = 720;
const MAX_PARTICLES = 1600;
const WHITE = '#ffffff';
const INK = PALETTE.ink;

// ---------------------------------------------------------------------------------------------
// Small math / colour helpers
// ---------------------------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const outCubic = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const inQuad = (t) => t * t;
const outQuad = (t) => 1 - (1 - t) * (1 - t);
const outBack = (t, s = 1.70158) => { const c = t - 1; return c * c * ((s + 1) * c + s) + 1; };
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const rgbCache = new Map();
/** Parses '#rgb', '#rrggbb', 'rgb()' or 'rgba()' into [r, g, b] (cached). Unknown → white. */
function parseColor(c) {
  let v = rgbCache.get(c);
  if (v) return v;
  const s = String(c || '').trim();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((ch) => ch + ch).join('');
    const n = parseInt(h.slice(0, 6), 16);
    v = Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/i);
    v = m ? m[1].split(',').slice(0, 3).map((x) => clamp(Math.round(parseFloat(x) || 0), 0, 255)) : [255, 255, 255];
  }
  rgbCache.set(c, v);
  return v;
}
function rgba(c, a) { const [r, g, b] = parseColor(c); return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`; }
function toHex([r, g, b]) { return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }
/** Mix two colours; returns '#rrggbb' (stable keys for sprite caching). */
function mix(a, b, t) {
  const A = parseColor(a), B = parseColor(b);
  return toHex([Math.round(lerp(A[0], B[0], t)), Math.round(lerp(A[1], B[1], t)), Math.round(lerp(A[2], B[2], t))]);
}
const hsl = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return toHex([f(0), f(8), f(4)]);
};
const PRISM = [hsl(330, 95, 70), hsl(40, 95, 65), hsl(60, 95, 70), hsl(150, 80, 65), hsl(195, 95, 70), hsl(265, 90, 75)];

function font(weight, size, family = FONTS.title) { return `${weight} ${Math.round(size)}px ${family}`; }

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}
function safeCall(fn, arg) {
  if (typeof fn !== 'function') return;
  try { fn(arg); } catch (err) { console.error('[effects] callback failed', err); }
}

// ---------------------------------------------------------------------------------------------
// Sprite cache: small pre-rendered textures, one per (shape, colour)
// ---------------------------------------------------------------------------------------------

const spriteCache = new Map();

function sprite(shape, color) {
  const key = shape + '|' + color;
  let s = spriteCache.get(key);
  if (s === undefined) {
    try { s = buildSprite(shape, color); } catch (err) { warnOnce('sprite' + key, `[effects] sprite ${key} failed: ${err.message}`); s = null; }
    spriteCache.set(key, s);
  }
  return s;
}

function buildSprite(shape, color) {
  const hot = mix(color, WHITE, 0.72);
  switch (shape) {
    case 'glow': {
      const c = makeCanvas(64, 64); if (!c) return null;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(hot, 1));
      gr.addColorStop(0.16, rgba(mix(color, WHITE, 0.35), 0.9));
      gr.addColorStop(0.42, rgba(color, 0.36));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return c;
    }
    case 'soft': {
      const c = makeCanvas(64, 64); if (!c) return null;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(color, 0.7));
      gr.addColorStop(0.5, rgba(color, 0.28));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return c;
    }
    case 'smoke': {
      const c = makeCanvas(64, 64); if (!c) return null;
      const g = c.getContext('2d');
      const blobs = [[32, 32, 30, 0.5], [24, 28, 18, 0.35], [40, 36, 20, 0.35], [34, 24, 14, 0.3]];
      for (const [x, y, r, a] of blobs) {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(color, a));
        gr.addColorStop(1, rgba(color, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
      }
      return c;
    }
    case 'dot': {
      const c = makeCanvas(16, 16); if (!c) return null;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
      gr.addColorStop(0, rgba(hot, 1));
      gr.addColorStop(0.4, rgba(color, 0.95));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 16, 16);
      return c;
    }
    case 'streak': {
      // teardrop along +x, bright head at the right end
      const c = makeCanvas(128, 32); if (!c) return null;
      const g = c.getContext('2d');
      const tear = (h, headX) => {
        g.beginPath();
        g.moveTo(2, 16);
        g.quadraticCurveTo(headX * 0.6, 16 - h * 0.55, headX, 16 - h);
        g.arc(headX, 16, h, -Math.PI / 2, Math.PI / 2);
        g.quadraticCurveTo(headX * 0.6, 16 + h * 0.55, 2, 16);
        g.closePath();
      };
      let gr = g.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, rgba(color, 0));
      gr.addColorStop(0.55, rgba(color, 0.45));
      gr.addColorStop(1, rgba(color, 0.9));
      g.fillStyle = gr;
      g.shadowColor = rgba(color, 0.8);
      g.shadowBlur = 8;
      tear(9, 116);
      g.fill();
      g.shadowBlur = 0;
      gr = g.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, rgba(hot, 0));
      gr.addColorStop(0.6, rgba(hot, 0.7));
      gr.addColorStop(1, rgba(WHITE, 1));
      g.fillStyle = gr;
      tear(3.5, 118);
      g.fill();
      return c;
    }
    case 'flare': {
      // symmetric lens flare line (for anamorphic streaks / rays)
      const c = makeCanvas(128, 24); if (!c) return null;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 128, 0);
      gr.addColorStop(0, rgba(color, 0));
      gr.addColorStop(0.5, rgba(hot, 1));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, 12);
      g.quadraticCurveTo(64, 2, 128, 12);
      g.quadraticCurveTo(64, 22, 0, 12);
      g.fill();
      g.globalAlpha = 0.45;
      g.beginPath();
      g.moveTo(0, 12);
      g.quadraticCurveTo(64, -6, 128, 12);
      g.quadraticCurveTo(64, 30, 0, 12);
      g.fill();
      return c;
    }
    case 'star': {
      const c = makeCanvas(128, 128); if (!c) return null;
      const g = c.getContext('2d');
      const k = 4.5;
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, rgba(WHITE, 1));
      gr.addColorStop(0.18, rgba(hot, 0.95));
      gr.addColorStop(0.5, rgba(color, 0.55));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(64, 0);
      g.quadraticCurveTo(64 + k, 64 - k, 128, 64);
      g.quadraticCurveTo(64 + k, 64 + k, 64, 128);
      g.quadraticCurveTo(64 - k, 64 + k, 0, 64);
      g.quadraticCurveTo(64 - k, 64 - k, 64, 0);
      g.fill();
      const core = g.createRadialGradient(64, 64, 0, 64, 64, 26);
      core.addColorStop(0, rgba(WHITE, 1));
      core.addColorStop(0.35, rgba(hot, 0.6));
      core.addColorStop(1, rgba(color, 0));
      g.fillStyle = core;
      g.fillRect(0, 0, 128, 128);
      return c;
    }
    case 'shard': {
      const c = makeCanvas(32, 32); if (!c) return null;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(4, 2, 28, 30);
      gr.addColorStop(0, rgba(WHITE, 1));
      gr.addColorStop(0.4, rgba(hot, 0.95));
      gr.addColorStop(1, rgba(color, 0.75));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(16, 1); g.lineTo(29, 22); g.lineTo(13, 31); g.lineTo(4, 17);
      g.closePath();
      g.fill();
      g.strokeStyle = rgba(WHITE, 0.95);
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(16, 1); g.lineTo(29, 22); g.stroke();
      g.strokeStyle = rgba(color, 0.9);
      g.beginPath(); g.moveTo(16, 1); g.lineTo(15, 20); g.lineTo(29, 22); g.stroke();
      return c;
    }
    case 'petal': {
      const c = makeCanvas(32, 20); if (!c) return null;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 32, 20);
      gr.addColorStop(0, mix(color, WHITE, 0.35));
      gr.addColorStop(0.6, color);
      gr.addColorStop(1, mix(color, '#000000', 0.35));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(2, 11);
      g.bezierCurveTo(8, 1, 22, 0, 31, 8);
      g.bezierCurveTo(22, 19, 9, 20, 2, 11);
      g.fill();
      g.strokeStyle = rgba(mix(color, '#000000', 0.45), 0.55);
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(4, 11); g.quadraticCurveTo(16, 8, 29, 8); g.stroke();
      g.strokeStyle = rgba(WHITE, 0.45);
      g.beginPath(); g.moveTo(8, 6); g.quadraticCurveTo(18, 2, 27, 6); g.stroke();
      return c;
    }
    case 'rock': {
      const c = makeCanvas(24, 24); if (!c) return null;
      const g = c.getContext('2d');
      g.fillStyle = mix(color, '#000000', 0.25);
      g.beginPath();
      g.moveTo(5, 8); g.lineTo(13, 2); g.lineTo(21, 7); g.lineTo(22, 16); g.lineTo(13, 22); g.lineTo(3, 17);
      g.closePath();
      g.fill();
      g.fillStyle = mix(color, WHITE, 0.25);
      g.beginPath(); g.moveTo(13, 2); g.lineTo(21, 7); g.lineTo(15, 11); g.lineTo(8, 7); g.closePath(); g.fill();
      g.strokeStyle = rgba('#000000', 0.45);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(5, 8); g.lineTo(13, 2); g.lineTo(21, 7); g.lineTo(22, 16); g.lineTo(13, 22); g.lineTo(3, 17);
      g.closePath();
      g.stroke();
      return c;
    }
    case 'hex': {
      const c = makeCanvas(32, 32); if (!c) return null;
      const g = c.getContext('2d');
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        const x = 16 + Math.cos(a) * 13, y = 16 + Math.sin(a) * 13;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = rgba(color, 0.35);
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = rgba(hot, 1);
      g.shadowColor = rgba(color, 1);
      g.shadowBlur = 4;
      g.stroke();
      return c;
    }
    case 'plus': {
      const c = makeCanvas(24, 24); if (!c) return null;
      const g = c.getContext('2d');
      g.shadowColor = rgba(color, 1);
      g.shadowBlur = 5;
      g.strokeStyle = rgba(hot, 1);
      g.lineWidth = 3.5;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(12, 5); g.lineTo(12, 19); g.moveTo(5, 12); g.lineTo(19, 12); g.stroke();
      return c;
    }
    default: {
      if (shape.startsWith('glyph')) {
        const variant = parseInt(shape.slice(5), 10) || 0;
        const c = makeCanvas(32, 32); if (!c) return null;
        const g = c.getContext('2d');
        g.shadowColor = rgba(color, 1);
        g.shadowBlur = 5;
        g.strokeStyle = rgba(hot, 1);
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        if (variant === 0) { g.moveTo(16, 5); g.lineTo(26, 25); g.lineTo(6, 25); g.closePath(); g.moveTo(10, 18); g.lineTo(22, 18); }
        else if (variant === 1) { g.moveTo(16, 4); g.lineTo(27, 16); g.lineTo(16, 28); g.lineTo(5, 16); g.closePath(); g.moveTo(16, 4); g.lineTo(16, 28); }
        else if (variant === 2) { g.arc(16, 16, 10, 0, TAU); g.moveTo(12, 8); g.lineTo(19, 15); g.lineTo(13, 18); g.lineTo(20, 25); }
        else { g.arc(16, 16, 5, 0, TAU); for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6; g.moveTo(16 + Math.cos(a) * 8, 16 + Math.sin(a) * 8); g.lineTo(16 + Math.cos(a) * 13, 16 + Math.sin(a) * 13); } }
        g.stroke();
        return c;
      }
      return null;
    }
  }
}

// Brush textures for banners, cached by size bucket + colour.
const brushCache = new Map();
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function brushStroke(w, h, color) {
  const bw = Math.ceil(w / 40) * 40;
  const bh = Math.ceil(h / 8) * 8;
  const key = `${bw}|${bh}|${color}`;
  if (brushCache.has(key)) return brushCache.get(key);
  const S = 2;
  const c = makeCanvas(bw * S, bh * S);
  if (!c) return null;
  const g = c.getContext('2d');
  g.scale(S, S);
  const R = seeded(bw * 131 + bh * 7 + color.length * 977);
  const cy = bh / 2;
  g.lineCap = 'round';
  // 1. ragged solid body
  const top = [], bot = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = lerp(bw * 0.03, bw * 0.97, u);
    const taper = Math.pow(Math.sin(Math.PI * clamp(u * 1.05, 0, 1)), 0.35);
    top.push([x, cy - bh * 0.36 * taper - (R() - 0.5) * bh * 0.06]);
    bot.push([x, cy + bh * 0.34 * taper + (R() - 0.5) * bh * 0.08]);
  }
  g.beginPath();
  g.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) g.lineTo(top[i][0], top[i][1]);
  for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
  g.closePath();
  g.fillStyle = rgba(INK, 0.62);
  g.fill();
  // 2. bristle strokes (density higher toward the middle)
  for (let i = 0; i < 110; i++) {
    const off = (R() - 0.5) * (R() * 0.6 + 0.4);
    const y = cy + off * bh * 0.78;
    const edge = Math.abs(off) * 2;
    const x0 = bw * (0.01 + R() * 0.07 + edge * 0.05);
    const x1 = bw * (0.99 - R() * 0.1 - edge * 0.06);
    g.strokeStyle = rgba(INK, 0.1 + R() * 0.2);
    g.lineWidth = 1 + R() * bh * 0.07;
    g.beginPath();
    g.moveTo(x0, y + (R() - 0.5) * 3);
    g.bezierCurveTo(bw * 0.33, y + (R() - 0.5) * 5, bw * 0.66, y + (R() - 0.5) * 5, x1, y + (R() - 0.5) * 4);
    g.stroke();
  }
  // 3. coloured bristles hugging the edges (the accent paint dragged along with the ink)
  for (let i = 0; i < 34; i++) {
    const side = R() < 0.5 ? -1 : 1;
    const y = cy + side * bh * (0.24 + R() * 0.16);
    const x0 = bw * (0.04 + R() * 0.2);
    const x1 = bw * (0.6 + R() * 0.36);
    g.strokeStyle = rgba(color, 0.12 + R() * 0.3);
    g.lineWidth = 0.8 + R() * 2.4;
    g.beginPath();
    g.moveTo(x0, y);
    g.quadraticCurveTo((x0 + x1) / 2, y + (R() - 0.5) * 4, x1, y + (R() - 0.5) * 3);
    g.stroke();
  }
  // 4. dry-brush flecks at the tail
  for (let i = 0; i < 40; i++) {
    const x = bw * (0.86 + R() * 0.13);
    const y = cy + (R() - 0.5) * bh * 0.6;
    g.fillStyle = rgba(INK, 0.15 + R() * 0.35);
    g.fillRect(x, y, 2 + R() * 10, 1 + R() * 2);
  }
  const out = { canvas: c, w: bw, h: bh };
  brushCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

const SINK = {}; // absorbs field writes when the pool is full

// ---------------------------------------------------------------------------------------------
// Combat-text layout. Every floating number / text gets a box. A new one spawns at its natural spot and
// pushes the older texts of its column out of the way (they ease there), so the newest is always nearest
// the hit; texts that share an anchorId (one combatant) form one column even when their x differ a little.
// Painters publish two kinds of screen boxes for the current frame: `reserve` (the QTE rating word above a
// ring: new texts are lifted clear of it) and `cover` (text on screen: enemy bars fade underneath).
// ---------------------------------------------------------------------------------------------

const TEXT_GAP = 3; // px between stacked texts
const TEXT_TOP = 28; // a text pushed above this fades out early instead of leaving the screen
const LOOKAHEAD = [0, 120, 280, 450]; // ms samples: rises differ in speed, so check where boxes will be
const LAYOUT_TTL = 90; // ms a published box stays valid (a few frames)
const STACK_MAX = 3; // a text with this many newer texts of its kind stacked under it starts fading
const LAYOUT = { reserve: [], cover: [], ratings: [] };

function layoutPublish(list, x0, y0, x1, y1) {
  const t = nowMs();
  if (list.length > 48) {
    let keep = 0;
    for (const r of list) if (t - r.t <= LAYOUT_TTL) list[keep++] = r;
    list.length = keep;
  }
  list.push({ x0, y0, x1, y1, t });
}

function layoutFresh(list) {
  const t = nowMs();
  return list.filter((r) => t - r.t <= LAYOUT_TTL);
}

let measureCtx = null;
const widthCache = new Map();
function textWidth(fontStr, str, size) {
  const key = `${fontStr}|${str}`;
  let w = widthCache.get(key);
  if (w !== undefined) return w;
  if (measureCtx === null) {
    try { measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : false; } catch { measureCtx = false; }
  }
  if (measureCtx) {
    measureCtx.font = fontStr;
    w = measureCtx.measureText(str).width;
  } else {
    w = str.length * size * 0.62;
  }
  if (widthCache.size > 400) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

function textRise(n, age) { return n.rise * outCubic(Math.min(1, (age / n.life) * 1.25)); }
/** Centre y of a floating text `ahead` ms from now, at its target lift. */
function textCenter(n, ahead = 0) { return n.y - 14 - textRise(n, n.age + ahead) - n.liftTo; }
function textX(n) { return n.x + n.vx * (n.age / n.life); }

/** Same column: horizontally overlapping, or the same anchor and close enough to read as one stack. */
function textColumnMates(a, b) {
  const reach = (a.w + b.w) / 2 + (a.anchor != null && a.anchor === b.anchor ? 60 : 10);
  return Math.abs(textX(a) - textX(b)) < reach;
}

/** Lift change `a` needs to clear `b` over the lookahead: > 0 moves it up, < 0 down (it keeps its side of `b`). */
function textSeparation(a, b) {
  const aAbove = textCenter(a) <= textCenter(b);
  let need = 0;
  for (const dt of LOOKAHEAD) {
    if (a.age + dt >= a.life * 0.85 || b.age + dt >= b.life * 0.85) break;
    const ca = textCenter(a, dt), cb = textCenter(b, dt);
    need = Math.max(need, aAbove ? (ca + a.down) + TEXT_GAP - (cb - b.up) : (cb + b.down) + TEXT_GAP - (ca - a.up));
  }
  return need <= 0 ? 0 : aAbove ? need : -need;
}

/**
 * Battle effects manager. World-space effects render in {@link Effects#render} (call inside the camera
 * transform); screen-space effects (flash, vignette, banners) in {@link Effects#renderScreen}.
 */
export class Effects {
  /**
   * @param {{reducedFlashing?: boolean, screenShake?: boolean}} [opts]
   */
  constructor({ reducedFlashing = false, screenShake = true } = {}) {
    /** When true, flashes are capped (alpha ≤ 0.15) and slower, and flares are toned down. */
    this.reducedFlashing = !!reducedFlashing;
    /** When false, {@link Effects#shake} is ignored. */
    this.shakeEnabled = screenShake !== false;
    /** When true, renderScreen() applies the current desaturation itself (before flashes/banners). */
    this.autoDesaturate = false;
    this._live = [];
    this._free = [];
    this._numbers = [];
    this._rings = [];
    this._slashes = [];
    this._lines = [];
    this._waves = [];
    this._projectiles = [];
    this._flashes = [];
    this._shakes = [];
    this._vignettes = [];
    this._banners = [];
    this._desatPulses = [];
    this._desatTarget = 0;
    this._desatLevel = 0;
    this._desat = 0;
    this._shakeX = 0;
    this._shakeY = 0;
    this._clock = 0;
  }

  // ----- lifecycle -----------------------------------------------------------------------------

  /**
   * Advance every effect.
   * @param {number} dt world ms (may be scaled by hit-stop)
   * @param {number} [screenDt=dt] ms for screen-space effects (flash, shake, vignette, banners, desaturation)
   */
  update(dt, screenDt = dt) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    screenDt = Number.isFinite(screenDt) ? Math.max(0, screenDt) : dt;
    this._clock += dt;
    const s = dt / 1000;

    // particles
    const live = this._live;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      if (p.age >= p.life) {
        live[i] = live[live.length - 1];
        live.pop();
        p.spr = null;
        this._free.push(p);
        continue;
      }
      if (p.age < 0) continue;
      if (p.drag) { const k = Math.exp(-p.drag * s); p.vx *= k; p.vy *= k; }
      p.vy += p.grav * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.rot += p.vr * s;
    }

    tick(this._numbers, dt);
    const ease = 1 - Math.exp(-dt / 28);
    for (const n of this._numbers) n.lift += (n.liftTo - n.lift) * ease;
    tick(this._rings, dt);
    tick(this._slashes, dt);
    tick(this._lines, dt);

    // shockwaves
    for (let i = this._waves.length - 1; i >= 0; i--) {
      const w = this._waves[i];
      w.age += dt;
      const k = Math.min(1, w.age / w.travel);
      const cx = w.x + w.dir * w.dist * k;
      if (!w.arrived && w.age >= w.travel) {
        w.arrived = true;
        safeCall(w.onArrive, { x: w.x + w.dir * w.dist, y: w.y });
      }
      if (!w.arrived) {
        w.emit += dt;
        while (w.emit > 26) {
          w.emit -= 26;
          const d = this._spawn('smoke', w.dust, cx - w.dir * rand(0, 10), w.y - rand(0, 6), -w.dir * rand(20, 70), rand(-50, -15), rand(380, 620), rand(10, 16), rand(24, 34));
          d.add = false; d.a = 0.5; d.drag = 2;
          const sp = this._spawn('streak', w.color, cx, w.y - rand(0, 16), -w.dir * rand(40, 160), rand(-340, -160), rand(200, 320), 18, 18);
          sp.w = 3; sp.stretch = 0.06; sp.grav = 900; sp.a = 0.9;
        }
      }
      if (w.age >= w.life) this._waves.splice(i, 1);
    }

    // projectiles
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const pr = this._projectiles[i];
      pr.age += dt;
      const u = Math.min(1, pr.age / pr.duration);
      projPos(pr, u, pr.pos);
      pr.trail.unshift(pr.pos.x, pr.pos.y);
      if (pr.trail.length > 28) pr.trail.length = 28;
      pr.emit += dt;
      this._emitProjectile(pr);
      if (u >= 1) {
        this._projectiles.splice(i, 1);
        if (pr.impact) this.burst(pr.to.x, pr.to.y, pr.impact, { color: pr.color });
        safeCall(pr.onArrive, { x: pr.to.x, y: pr.to.y, kind: pr.kind });
      }
    }

    // screen space
    tick(this._flashes, screenDt);
    tick(this._vignettes, screenDt);
    tick(this._banners, screenDt);
    tick(this._desatPulses, screenDt);

    // shake (smooth pseudo-noise per shake, amplitudes combine)
    let sx = 0, sy = 0;
    for (let i = this._shakes.length - 1; i >= 0; i--) {
      const sh = this._shakes[i];
      sh.age += screenDt;
      if (sh.age >= sh.life) { this._shakes.splice(i, 1); continue; }
      const u = sh.age / sh.life;
      const amp = sh.i * (1 - u) * (1 - u);
      const a = sh.age;
      sx += amp * (Math.sin(a * 0.093 + sh.px) * 0.65 + Math.sin(a * 0.051 + sh.px * 1.7) * 0.35);
      sy += amp * (Math.sin(a * 0.087 + sh.py) * 0.65 + Math.sin(a * 0.043 + sh.py * 2.3) * 0.35);
    }
    this._shakeX = clamp(sx, -32, 32);
    this._shakeY = clamp(sy, -32, 32);

    // desaturation: persistent level eases toward its target; pulses ramp in / hold / release
    const rate = screenDt / 260;
    this._desatLevel += clamp(this._desatTarget - this._desatLevel, -rate, rate);
    let d = this._desatLevel;
    for (const p of this._desatPulses) {
      const u = p.age / p.life;
      const env = u < 0.12 ? u / 0.12 : u > 0.72 ? (1 - u) / 0.28 : 1;
      d = Math.max(d, p.amount * smoothstep(0, 1, env));
    }
    this._desat = clamp(d, 0, 1);
  }

  /** Removes every effect immediately (pending onArrive callbacks are dropped). */
  clear() {
    for (const p of this._live) { p.spr = null; this._free.push(p); }
    this._live.length = 0;
    for (const list of [this._numbers, this._rings, this._slashes, this._lines, this._waves, this._projectiles,
      this._flashes, this._shakes, this._vignettes, this._banners, this._desatPulses]) list.length = 0;
    this._desatTarget = 0;
    this._desatLevel = 0;
    this._desat = 0;
    this._shakeX = 0;
    this._shakeY = 0;
  }

  /** Number of live particles (debug / perf readouts). */
  get particleCount() { return this._live.length; }

  /** True while any world or screen effect is still playing. */
  get active() {
    return this._live.length + this._numbers.length + this._rings.length + this._slashes.length + this._lines.length +
      this._waves.length + this._projectiles.length + this._flashes.length + this._banners.length + this._vignettes.length > 0;
  }

  // ----- rendering -----------------------------------------------------------------------------

  /** Draw world-space effects (call inside the battle camera transform). */
  render(ctx) {
    ctx.save();
    const M = ctx.getTransform();

    // ground layer of shockwaves (soft trails on the floor)
    ctx.globalCompositeOperation = 'lighter';
    for (const w of this._waves) drawWaveTrail(ctx, w);

    // normal-blend particles (smoke, rocks, petals)
    ctx.globalCompositeOperation = 'source-over';
    this._renderParticles(ctx, M, false);

    // additive layer
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this._rings) drawRing(ctx, r);
    for (const sl of this._slashes) drawSlash(ctx, sl);
    for (const ln of this._lines) drawTracer(ctx, ln);
    for (const w of this._waves) drawWaveCrest(ctx, w);
    this._renderParticles(ctx, M, true);
    for (const pr of this._projectiles) drawProjectile(ctx, pr, this._clock);

    // combat text on top (and tell enemy bars where it is, so they can fade under it)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (const n of this._numbers) {
      if (drawNumber(ctx, n) < 0.15) continue;
      const cx = textX(n), cy = n.y - 14 - textRise(n, n.age) - n.lift;
      layoutPublish(LAYOUT.cover, cx - n.w / 2, cy - n.up, cx + n.w / 2, cy + n.down);
    }
    ctx.restore();
  }

  /** Draw screen-space effects (after the camera, in stage space). */
  renderScreen(ctx) {
    ctx.save();
    if (this.autoDesaturate && this._desat > 0.001) applyDesaturation(ctx, this._desat);
    for (const v of this._vignettes) drawVignette(ctx, v);
    for (const f of this._flashes) {
      const u = f.age / f.life;
      const env = f.soft ? Math.sin(Math.PI * u) : u < 0.08 ? u / 0.08 : Math.pow(1 - (u - 0.08) / 0.92, 2);
      const a = f.alpha * env;
      if (a <= 0.003) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillRect(-60, -60, STAGE_W + 120, STAGE_H + 120);
    }
    ctx.globalAlpha = 1;
    for (const b of this._banners) drawBanner(ctx, b);
    ctx.restore();
  }

  _renderParticles(ctx, M, additive) {
    const ma = M.a, mb = M.b, mc = M.c, md = M.d, me = M.e, mf = M.f;
    const live = this._live;
    let touched = false;
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      if (p.add !== additive || p.age < 0) continue;
      const u = p.age / p.life;
      let a = p.a * (u < p.fadeIn ? u / p.fadeIn : 1) * Math.pow(1 - u, p.fadePow);
      if (p.flick) a *= 1 - p.flick * (0.5 + 0.5 * Math.sin(p.age * p.flickF + p.ph));
      if (a <= 0.008) continue;
      const spr = p.spr || (p.spr = sprite(p.shape, p.color));
      if (!spr) continue;
      let x = p.x, y = p.y;
      if (p.wob) x += Math.sin(p.age * p.wobF + p.ph) * p.wob;
      let ang, sx, sy, ox, oy;
      if (p.shape === 'streak' || p.shape === 'flare') {
        let len;
        if (p.fixed) {
          ang = p.rot;
          len = lerp(p.s0, p.s1, outCubic(u));
        } else {
          ang = Math.atan2(p.vy, p.vx);
          len = clamp(Math.hypot(p.vx, p.vy) * p.stretch, p.s0 * 0.25, p.s0);
        }
        sx = len; sy = p.w * (p.fixed ? 1 - u * 0.5 : 1);
        ox = -len * p.anchor; oy = -sy / 2;
      } else {
        ang = p.rot;
        const size = lerp(p.s0, p.s1, p.easeSize ? outCubic(u) : u);
        sx = size * 2; sy = size * 2 * p.sy;
        if (p.flutter) sx *= Math.abs(Math.cos(p.age * p.flutter + p.ph)) * 0.8 + 0.2;
        ox = -sx / 2; oy = -sy / 2;
      }
      const cos = Math.cos(ang), sin = Math.sin(ang);
      ctx.setTransform(ma * cos + mc * sin, mb * cos + md * sin, mc * cos - ma * sin, md * cos - mb * sin,
        ma * x + mc * y + me, mb * x + md * y + mf);
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(spr, ox, oy, sx, sy);
      touched = true;
    }
    if (touched) { ctx.setTransform(M); ctx.globalAlpha = 1; }
  }

  // ----- particles -----------------------------------------------------------------------------

  _spawn(shape, color, x, y, vx, vy, life, s0, s1 = s0) {
    if (this._live.length >= MAX_PARTICLES) return SINK;
    const p = this._free.pop() || {};
    p.shape = shape; p.color = color; p.spr = null;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = Math.max(1, life); p.age = 0; p.s0 = s0; p.s1 = s1;
    p.grav = 0; p.drag = 0; p.rot = 0; p.vr = 0; p.a = 1; p.add = true;
    p.flick = 0; p.flickF = 0.03; p.wob = 0; p.wobF = 0.004; p.ph = Math.random() * TAU;
    p.w = 4; p.stretch = 0.05; p.anchor = 1; p.fixed = false; p.sy = 1; p.flutter = 0;
    p.fadeIn = 0.06; p.fadePow = 1; p.easeSize = false;
    this._live.push(p);
    return p;
  }

  /** Spray of `n` particles around (x, y). */
  _spray(x, y, shape, color, n, o = {}) {
    const {
      speed = [120, 360], life = [300, 600], size = [4, 8], end = 0.3, grav = 0, drag = 0, angle = 0, spread = TAU,
      add = true, a = 1, vr = 0, jitter = 0, fadePow = 1, flick = 0, flickF = 0.03, wob = 0, flutter = 0, delay = 0,
      easeSize = false, w = 4, stretch = 0.05, colors = null, rot = null,
    } = o;
    for (let i = 0; i < n; i++) {
      const ang = angle + (Math.random() - 0.5) * spread;
      const sp = rand(speed[0], speed[1]);
      const s0 = rand(size[0], size[1]);
      const col = colors ? colors[(Math.random() * colors.length) | 0] : color;
      const p = this._spawn(shape, col, x + (Math.random() - 0.5) * jitter, y + (Math.random() - 0.5) * jitter,
        Math.cos(ang) * sp, Math.sin(ang) * sp, rand(life[0], life[1]), s0, s0 * end);
      p.grav = grav; p.drag = drag; p.add = add; p.a = a; p.fadePow = fadePow; p.flick = flick; p.flickF = flickF; p.wob = wob;
      p.flutter = flutter; p.easeSize = easeSize; p.w = w; p.stretch = stretch;
      p.rot = rot === null ? Math.random() * TAU : rot;
      p.vr = vr ? rand(-vr, vr) : 0;
      if (delay) p.age = -(Array.isArray(delay) ? rand(delay[0], delay[1]) : delay);
    }
  }

  /** A single stationary sprite (flares, glows, stars). */
  _flare(x, y, shape, color, life, s0, s1, { rot = 0, a = 1, add = true, delay = 0, w = 16, anchor = 0.5, fadePow = 1.4, easeSize = true, vr = 0 } = {}) {
    const p = this._spawn(shape, color, x, y, 0, 0, life, s0, s1);
    p.fixed = true; p.rot = rot; p.a = a * (this.reducedFlashing ? 0.6 : 1); p.add = add; p.w = w; p.anchor = anchor;
    p.fadePow = fadePow; p.easeSize = easeSize; p.fadeIn = 0.02; p.vr = vr;
    if (delay) p.age = -delay;
    return p;
  }

  /**
   * Directed streak sparks.
   * @param {number} x
   * @param {number} y
   * @param {{color?:string, count?:number, speed?:number, spread?:number, angle?:number, life?:number, gravity?:number, width?:number}} [o]
   */
  sparks(x, y, { color = PALETTE.paleGold, count = 12, speed = 300, spread = TAU, angle = 0, life = 450, gravity = 600, width = 4 } = {}) {
    this._spray(x, y, 'streak', color, count, {
      speed: [speed * 0.4, speed], life: [life * 0.55, life], angle, spread, grav: gravity, drag: 2.2,
      w: width, stretch: 0.055, size: [24, 40], rot: 0,
    });
  }

  // ----- primitives ----------------------------------------------------------------------------

  /**
   * Expanding ring.
   * @param {number} x
   * @param {number} y
   * @param {{r0?:number, r1?:number, life?:number, color?:string, width?:number, squash?:number, delay?:number, alpha?:number}} [o]
   *   squash < 1 flattens it into a ground ripple.
   */
  ring(x, y, { r0 = 10, r1 = 80, life = 400, color = WHITE, width = 4, squash = 1, delay = 0, alpha = 1 } = {}) {
    this._rings.push({ x, y, r0, r1, life: Math.max(1, life), age: -delay, color, width, squash, alpha });
  }

  /**
   * Tapered crescent slash trail.
   * @param {number} x centre
   * @param {number} y centre
   * @param {{angle?:number, length?:number, color?:string, life?:number, width?:number, curve?:number, flip?:boolean, delay?:number}} [o]
   */
  slash(x, y, { angle = 0, length = 140, color = WHITE, life = 220, width = 10, curve = 0.4, flip = false, delay = 0 } = {}) {
    this._slashes.push({ x, y, angle, length, color, life: Math.max(1, life), width, curve, flip: flip ? -1 : 1, age: -delay });
  }

  /**
   * Straight (or jagged) tracer line.
   * @param {{color?:string, width?:number, life?:number, jagged?:number, delay?:number}} [o] jagged = zig-zag amplitude in px
   */
  line(x0, y0, x1, y1, { color = PALETTE.paleGold, width = 3, life = 160, jagged = 0, delay = 0 } = {}) {
    let pts;
    if (jagged > 0) {
      const n = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 18));
      const nx = -(y1 - y0), ny = x1 - x0;
      const nl = Math.hypot(nx, ny) || 1;
      pts = [x0, y0];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const off = (Math.random() - 0.5) * 2 * jagged * Math.sin(Math.PI * t);
        pts.push(lerp(x0, x1, t) + (nx / nl) * off, lerp(y0, y1, t) + (ny / nl) * off);
      }
      pts.push(x1, y1);
    } else {
      pts = [x0, y0, x1, y1];
    }
    this._lines.push({ pts, color, width, life: Math.max(1, life), age: -delay });
  }

  /**
   * Ground shockwave travelling horizontally from x to toX along the floor at y (jump attacks).
   * @param {number} x start
   * @param {number} y floor y
   * @param {{toX?:number, speed?:number, duration?:number, color?:string, life?:number, height?:number, onArrive?:Function}} [o]
   *   duration (ms to reach toX) overrides speed (px/s); onArrive fires when the crest reaches toX.
   */
  shockwave(x, y, { toX = x - 600, speed = 800, duration, color = HIT_TYPE_COLORS.jump, life, height = 58, onArrive } = {}) {
    const dist = Math.abs(toX - x);
    const travel = Math.max(16, duration != null ? duration : (dist / Math.max(1, speed)) * 1000);
    this._waves.push({
      x, y, dir: toX >= x ? 1 : -1, dist, travel, life: Math.max(travel + 60, life != null ? life : travel + 260),
      age: 0, color, dust: mix(color, PALETTE.parchment, 0.6), height, arrived: false, onArrive, emit: 0,
    });
    this._flare(x, y, 'soft', color, 260, 40, 90, { a: 0.8 });
  }

  /**
   * Projectile from → to. onArrive({x, y, kind}) fires on arrival (then it is removed).
   * @param {{from:{x:number,y:number}, to:{x:number,y:number}, duration?:number, kind?:string, color?:string, arc?:number, onArrive?:Function, impact?:string|false, size?:number}} o
   *   arc > 0 lifts the path upward by that many px at mid-flight; `impact` names a burst to play on arrival.
   * @returns {{cancel:Function}} handle
   */
  projectile({ from, to, duration = 420, kind = 'bolt', color, arc = 0, onArrive, impact = false, size = 1 } = {}) {
    if (!from || !to) { warnOnce('projArgs', '[effects] projectile needs from/to'); return { cancel() {} }; }
    if (!PROJECTILE_KINDS.includes(kind)) { warnOnce('proj' + kind, `[effects] unknown projectile kind "${kind}"`); kind = 'bolt'; }
    const defaults = { bolt: PALETTE.frost, thorn: PALETTE.leaf, orb: PALETTE.violet, glyph: PALETTE.paleGold, bullet: PALETTE.paleGold };
    const pr = {
      from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, duration: Math.max(16, duration), kind,
      color: color || defaults[kind], arc, onArrive, impact, size, age: 0, trail: [], pos: { x: from.x, y: from.y, a: 0 }, emit: 0,
      spin: Math.random() * TAU,
    };
    projPos(pr, 0, pr.pos);
    this._projectiles.push(pr);
    const list = this._projectiles;
    return { cancel() { const i = list.indexOf(pr); if (i >= 0) list.splice(i, 1); } };
  }

  _emitProjectile(pr) {
    const { x, y } = pr.pos;
    const every = pr.kind === 'bullet' ? 1e9 : pr.kind === 'thorn' ? 40 : 22;
    while (pr.emit > every) {
      pr.emit -= every;
      if (pr.kind === 'thorn') {
        const p = this._spawn('petal', Math.random() < 0.5 ? PALETTE.leaf : PALETTE.moss, x, y, rand(-40, 40), rand(-40, 40), rand(500, 800), rand(3, 5), 2);
        p.add = false; p.flutter = 0.02; p.vr = rand(-6, 6); p.grav = 120; p.a = 0.9;
      } else {
        const p = this._spawn(pr.kind === 'glyph' ? 'glyph' + ((Math.random() * 4) | 0) : 'dot', pr.color, x + rand(-4, 4), y + rand(-4, 4), rand(-30, 30), rand(-50, 10), rand(300, 520), rand(3, 6) * pr.size, 0.5);
        p.drag = 1.5;
        if (pr.kind === 'glyph') p.vr = rand(-2, 2);
      }
    }
  }

  // ----- floating text -------------------------------------------------------------------------

  /**
   * Floating combat number / label.
   * @param {number} x
   * @param {number} y
   * @param {number|string} value
   * @param {{kind?:'damage'|'crit'|'heal'|'ap'|'block'|'text', affinity?:'weak'|'resist'|'immune'|null, color?:string, size?:number,
   *   anchorId?:string}} [o] anchorId: the combatant it belongs to — its texts stack as one column
   */
  number(x, y, value, { kind = 'damage', affinity = null, color, size, anchorId = null } = {}) {
    const n = {
      kind: 'number', x, y, vx: rand(-14, 14), age: 0, life: 1150, rise: 46, pop: 1.55, rot: 0, crit: false, tag: null, tagColor: null,
      text: '', size: 34, weight: 700, stroke: INK, strokeW: 6, top: '#fffaf0', bottom: PALETTE.parchment, glow: null,
    };
    if (value == null || (typeof value === 'number' && !Number.isFinite(value))) { warnOnce('numVal', `[effects] number() got ${value}`); value = kind === 'block' ? 'BLOCKED' : '—'; }
    const num = typeof value === 'number' ? Math.round(value) : value;
    switch (kind) {
      case 'crit':
        n.crit = true; n.size = 50; n.weight = 900; n.life = 1400; n.rise = 54; n.pop = 2.1; n.rot = -0.07;
        n.text = String(num); n.top = '#fffbe8'; n.bottom = color ? mix(color, PALETTE.ember, 0.5) : PALETTE.breakBar;
        n.stroke = '#2a0806'; n.strokeW = 7; n.glow = PALETTE.ember; n.tag = 'CRITICAL'; n.tagColor = PALETTE.paleGold;
        break;
      case 'heal':
        n.text = typeof num === 'number' ? `+${num}` : String(num); n.top = '#e9ffd8'; n.bottom = color || PALETTE.hpGood;
        n.stroke = '#0e2410'; n.rise = 58; n.glow = PALETTE.hpGood;
        break;
      case 'ap':
        n.text = typeof num === 'number' ? `+${num} AP` : String(num); n.size = 24; n.top = '#fffbea'; n.bottom = color || PALETTE.gold;
        n.stroke = '#2a1a06'; n.strokeW = 5; n.rise = 40; n.life = 1000; n.pop = 1.4; n.glow = PALETTE.gold;
        break;
      case 'block':
        n.text = typeof value === 'string' ? value : 'BLOCKED'; n.size = 22; n.top = '#f2fbff'; n.bottom = color || PALETTE.shield;
        n.stroke = '#081826'; n.strokeW = 5; n.rise = 30; n.life = 950; n.pop = 1.3; n.glow = PALETTE.shield;
        break;
      case 'text':
        n.text = String(value); n.size = size || 26; n.top = '#fffaf0'; n.bottom = color || PALETTE.paleGold; n.strokeW = 5; n.rise = 36;
        break;
      default:
        n.text = String(num);
        if (color) { n.top = mix(color, WHITE, 0.8); n.bottom = mix(color, PALETTE.ivory, 0.35); }
    }
    if (size && kind !== 'text') n.size = size;
    if (kind === 'damage' || kind === 'crit') {
      if (affinity === 'weak') { n.tag = kind === 'crit' ? 'WEAK · CRITICAL' : 'WEAK'; n.tagColor = '#ff9a5a'; n.size *= 1.08; }
      else if (affinity === 'resist') { n.tag = 'RESIST'; n.tagColor = '#a8b8c8'; n.size *= 0.86; n.bottom = mix(n.bottom, '#8a8fb0', 0.5); }
      else if (affinity === 'immune') { n.text = 'IMMUNE'; n.tag = null; n.size = 24; n.top = '#e8e4dc'; n.bottom = '#9a948c'; n.crit = false; n.glow = null; }
    }
    n.y0 = y;
    n.font = font(n.weight, n.size);
    n.tagFont = font(700, Math.max(11, n.size * 0.32));
    this._admitText(n, anchorId);
    if (n.crit) this._flare(x, n.y - n.lift, 'star', PALETTE.paleGold, 260, 70, 20, { rot: 0.3, a: 0.8 });
  }

  /**
   * Floating text.
   * @param {{color?:string, size?:number, life?:number, rise?:number, font?:string, stroke?:boolean, anchorId?:string}} [o]
   *   font: a family list ('"Cormorant Garamond", serif') or a full CSS font ('italic 600 24px Georgia').
   *   anchorId: the combatant it belongs to — its texts stack as one column instead of overlapping.
   */
  text(x, y, str, { color = PALETTE.ivory, size = 28, life = 900, rise = 40, font: family, stroke = true, anchorId = null } = {}) {
    const f = family ? (/\d+px/.test(family) ? family : `700 ${size}px ${family}`) : font(700, size);
    this._admitText({
      kind: 'text', x, y, y0: y, vx: 0, age: 0, life: Math.max(1, life), rise, pop: 1.2, rot: 0, crit: false, tag: null,
      text: str == null ? '' : String(str), size, weight: 700, stroke: stroke ? INK : null, strokeW: Math.max(3, size * 0.16),
      top: mix(color, WHITE, 0.55), bottom: color, glow: null, font: f, tagFont: '',
    }, anchorId);
  }

  /**
   * Lane a new floating text: size its box, lift it clear of reserved boxes (QTE rating words), then push the
   * older texts of its column out of the way so nothing overlaps over the next half second.
   */
  _admitText(n, anchorId) {
    n.anchor = anchorId == null ? null : String(anchorId);
    const size = n.size;
    n.w = Math.max(textWidth(n.font, n.text, size), n.tag ? textWidth(n.tagFont, n.tag, size * 0.32) : 0) + 8;
    n.up = size * 0.5 + (n.tag ? size * 0.45 : 0);
    n.down = size * 0.44;
    n.lift = 0;
    n.liftTo = 0;
    const reserved = layoutFresh(LAYOUT.reserve);
    for (let pass = 0; pass < 3 && reserved.length; pass++) {
      let moved = false;
      for (const r of reserved) {
        if (n.x + n.w / 2 <= r.x0 || n.x - n.w / 2 >= r.x1) continue;
        for (const dt of LOOKAHEAD.slice(0, 2)) {
          const c = textCenter(n, dt);
          if (c + n.down + TEXT_GAP > r.y0 && c - n.up - TEXT_GAP < r.y1) {
            n.liftTo += c + n.down + TEXT_GAP - r.y0;
            moved = true;
            break;
          }
        }
      }
      if (!moved) break;
    }
    n.lift = n.liftTo;
    const list = this._numbers;
    list.push(n);
    // The same kind of word repeated at the same spot (timing feedback, "Too early" …) replaces its predecessor.
    if (n.kind === 'text') {
      for (const a of list) {
        if (a === n || a.kind !== 'text' || a.anchor !== n.anchor || a.size !== n.size) continue;
        if (a.text !== n.text && a.bottom !== n.bottom) continue;
        if (Math.abs(a.x - n.x) < 24 && Math.abs(a.y0 - n.y0) < 14) a.age = Math.max(a.age, a.life * 0.88);
      }
    }
    // Newest first: each text keeps its place and pushes the older ones it would collide with.
    for (const a of list) a.depth = 0;
    for (let i = list.length - 1; i > 0; i--) {
      const b = list[i];
      for (let j = i - 1; j >= 0; j--) {
        const a = list[j];
        if (a.age >= a.life * 0.95 || !textColumnMates(a, b)) continue;
        const push = textSeparation(a, b);
        if (push) {
          a.liftTo += push;
          if (a.age === 0) a.lift = a.liftTo; // spawned this frame and never drawn: no need to glide
        }
        if (a.kind === b.kind && textCenter(a) <= textCenter(b)) a.depth += 1;
        // No room above, or buried under a tall stack: bow out early instead of climbing off the screen.
        if (textCenter(a) - a.up < TEXT_TOP || a.depth >= STACK_MAX) a.age = Math.max(a.age, a.life * 0.72);
      }
    }
  }

  // ----- screen space --------------------------------------------------------------------------

  /** Full-screen flash. With reducedFlashing, alpha is capped at 0.15 and the pulse is slower and soft. */
  screenFlash(color = WHITE, life = 160, alpha = 0.6) {
    let soft = false;
    if (this.reducedFlashing) { alpha = Math.min(alpha, 0.15); life = Math.max(life * 2.2, 380); soft = true; }
    this._flashes.push({ color, life: Math.max(1, life), alpha, age: 0, soft });
  }

  /** Decaying camera shake; read the offset with {@link Effects#shakeOffset}. */
  shake(intensity = 6, life = 180) {
    if (!this.shakeEnabled || !(intensity > 0)) return;
    this._shakes.push({ i: intensity, life: Math.max(1, life), age: 0, px: Math.random() * 100, py: Math.random() * 100 });
  }

  /** Current shake offset in px (apply to the camera). */
  shakeOffset() { return { x: this._shakeX, y: this._shakeY }; }

  /** Edge vignette pulse (e.g. crimson when hurt, violet during gradient attacks). */
  vignette(color = PALETTE.crimson, life = 600, alpha = 0.5) {
    this._vignettes.push({ color, life: Math.max(1, life), alpha: this.reducedFlashing ? Math.min(alpha, 0.35) : alpha, age: 0 });
  }

  /**
   * Desaturation for the battle scene to apply (see {@link applyDesaturation}).
   * life > 0: a pulse that ramps in, holds and releases on its own. life ≤ 0: sets a persistent level
   * that eases toward `amount` (call desaturate(0) to release).
   */
  desaturate(amount = 1, life = 0) {
    const a = clamp(Number(amount) || 0, 0, 1);
    if (life > 0) this._desatPulses.push({ amount: a, life, age: 0 });
    else this._desatTarget = a;
  }

  /** Current desaturation 0..1. */
  get desaturation() { return this._desat; }

  /**
   * Big brush-stroke banner in screen space.
   * @param {string} text
   * @param {{sub?:string, color?:string, life?:number, style?:'impact'|'title'|'caption', y?:number, size?:number, slot?:string}} [o]
   *   impact (default): big, upper third (PARRY, BREAK!); title: huge, centred (VICTORY); caption: small, top (attack names).
   *   A new banner sends the previous banner of the same `slot` (default: the style name) into its exit.
   */
  banner(text, { sub = '', color = PALETTE.gold, life = 1400, style = 'impact', y, size, slot } = {}) {
    const st = BANNER_STYLES[style] || BANNER_STYLES.impact;
    const key = slot || st.slot;
    for (const b of this._banners) {
      if (b.key === key && b.life - b.age > 240) b.age = b.life - 240;
    }
    this._banners.push({
      text: String(text).toUpperCase(), sub: String(sub || ''), color, life: Math.max(500, life), age: 0,
      size: size || st.size, subSize: st.sub, y: y != null ? y : st.y, slot: st.slot, key, tilt: st.tilt,
    });
  }

  // ----- presets -------------------------------------------------------------------------------

  /**
   * Composite burst preset.
   * @param {number} x
   * @param {number} y
   * @param {string} kind see BURST_KINDS
   * @param {{scale?:number, color?:string, angle?:number, dir?:number, perfect?:boolean}} [opts]
   *   dir = ±1 sprays hit sparks along the attack's travel direction; angle overrides it.
   */
  burst(x, y, kind, opts = {}) {
    const fn = BURSTS[kind];
    if (!fn) {
      warnOnce('burst' + kind, `[effects] unknown burst kind "${kind}" — using "hit"`);
      BURSTS.hit(this, x, y, opts, opts.scale || 1);
      return;
    }
    try { fn(this, x, y, opts, opts.scale || 1); } catch (err) { warnOnce('burstErr' + kind, `[effects] burst ${kind} failed: ${err.message}`); }
  }
}

function tick(list, dt) {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    o.age += dt;
    if (o.age >= o.life) list.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Burst presets
// ---------------------------------------------------------------------------------------------

function dirAngle(o) {
  if (typeof o.angle === 'number') return o.angle;
  if (o.dir === -1) return Math.PI;
  if (o.dir === 1) return 0;
  return null;
}

const BURSTS = {
  hit(fx, x, y, o, s) {
    const col = o.color || PALETTE.paleGold;
    const ang = dirAngle(o);
    fx._flare(x, y, 'star', mix(col, WHITE, 0.4), 170, 100 * s, 26 * s, { rot: Math.random() * 0.6 });
    fx._flare(x, y, 'glow', col, 230, 64 * s, 20 * s, { a: 0.9 });
    fx._flare(x, y, 'flare', mix(col, WHITE, 0.5), 170, 190 * s, 80 * s, { w: 10 * s, rot: (ang ?? 0) * 0.15 });
    fx._spray(x, y, 'streak', mix(col, WHITE, 0.5), Math.round(18 * s), {
      speed: [300, 660], life: [200, 380], angle: ang ?? 0, spread: ang === null ? TAU : 2, grav: 900, drag: 2.5,
      w: 4.5, stretch: 0.06, size: [24, 40], rot: 0,
    });
    fx._spray(x, y, 'dot', col, Math.round(8 * s), { speed: [60, 200], life: [300, 520], size: [2.2, 3.8], grav: 300, drag: 2 });
    fx.ring(x, y, { r0: 8 * s, r1: 66 * s, life: 260, color: mix(col, WHITE, 0.5), width: 3.5 });
  },
  physical(fx, x, y, o, s) {
    const col = o.color || ELEMENT_COLORS.physical;
    BURSTS.hit(fx, x, y, { ...o, color: col }, s);
    const a = dirAngle(o) ?? 0;
    fx.slash(x, y, { angle: a - 0.8, length: 120 * s, width: 12 * s, color: col, life: 200, curve: 0.25 });
    fx.slash(x, y, { angle: a + 0.8, length: 110 * s, width: 10 * s, color: col, life: 200, curve: 0.25, delay: 40, flip: true });
  },
  crit(fx, x, y, o, s) {
    const col = o.color || PALETTE.breakBar;
    const ang = dirAngle(o);
    fx._flare(x, y, 'star', WHITE, 210, 150 * s, 40 * s, { rot: 0.2 });
    fx._flare(x, y, 'star', PALETTE.gold, 280, 100 * s, 30 * s, { rot: Math.PI / 4 + 0.2, delay: 20 });
    fx._flare(x, y, 'glow', PALETTE.ember, 260, 90 * s, 30 * s, { a: 0.9 });
    fx._flare(x, y, 'flare', PALETTE.paleGold, 220, 280 * s, 120 * s, { w: 14 * s });
    fx._spray(x, y, 'streak', PALETTE.paleGold, Math.round(16 * s), {
      speed: [380, 760], life: [220, 420], angle: ang ?? 0, spread: ang === null ? TAU : 2.2, grav: 900, drag: 2.2, w: 4.5, stretch: 0.06, size: [26, 44], rot: 0,
    });
    fx._spray(x, y, 'streak', col, Math.round(12 * s), { speed: [240, 520], life: [220, 400], grav: 900, drag: 2.2, w: 3.5, stretch: 0.06, size: [20, 34], rot: 0 });
    fx._spray(x, y, 'dot', PALETTE.ember, Math.round(10 * s), { speed: [40, 140], life: [500, 900], size: [2.5, 4], grav: -60, drag: 1.5, flick: 0.5, wob: 6 });
    fx.ring(x, y, { r0: 10 * s, r1: 90 * s, life: 260, color: WHITE, width: 5 });
    fx.ring(x, y, { r0: 20 * s, r1: 130 * s, life: 420, color: PALETTE.gold, width: 3, delay: 40 });
    const a = dirAngle(o) ?? 0;
    fx.slash(x, y, { angle: a - 0.75, length: 170 * s, width: 16 * s, color: PALETTE.crimson, life: 240, curve: 0.3 });
    fx.slash(x, y, { angle: a + 0.75, length: 160 * s, width: 13 * s, color: PALETTE.gold, life: 240, curve: 0.3, delay: 45, flip: true });
  },
  parry(fx, x, y, o, s) {
    const col = o.color || PALETTE.paleGold;
    // the starburst: two stars (8 points), a bloom, an anamorphic streak and a vertical glint
    fx._flare(x, y, 'star', WHITE, 280, 200 * s, 44 * s, { rot: 0 });
    fx._flare(x, y, 'star', PALETTE.gold, 340, 150 * s, 36 * s, { rot: Math.PI / 4, delay: 16 });
    fx._flare(x, y, 'glow', col, 300, 140 * s, 40 * s, { a: 1 });
    fx._flare(x, y, 'soft', PALETTE.gold, 480, 120 * s, 220 * s, { a: 0.5, fadePow: 2 });
    fx._flare(x, y, 'flare', WHITE, 260, 560 * s, 260 * s, { w: 20 * s });
    fx._flare(x, y, 'flare', col, 320, 220 * s, 90 * s, { rot: Math.PI / 2, w: 12 * s });
    fx.ring(x, y, { r0: 12 * s, r1: 110 * s, life: 300, color: WHITE, width: 7 });
    fx.ring(x, y, { r0: 24 * s, r1: 180 * s, life: 480, color: PALETTE.gold, width: 3.5, delay: 30 });
    fx.ring(x, y, { r0: 30 * s, r1: 230 * s, life: 620, color: PALETTE.paleGold, width: 1.5, delay: 70, alpha: 0.7 });
    const ang = dirAngle(o);
    fx._spray(x, y, 'streak', mix(col, WHITE, 0.5), Math.round(22 * s), {
      speed: [480, 980], life: [260, 480], angle: ang ?? 0, spread: ang === null ? TAU : 2.6, grav: 1200, drag: 2.4, w: 5, stretch: 0.06, size: [30, 52], rot: 0,
    });
    fx._spray(x, y, 'streak', PALETTE.gold, Math.round(16 * s), { speed: [300, 700], life: [240, 420], grav: 1100, drag: 2.2, w: 3.5, stretch: 0.06, size: [22, 38], rot: 0 });
    // lingering glints
    for (let i = 0; i < Math.round(8 * s); i++) {
      const a = Math.random() * TAU;
      const r = rand(20, 90) * s;
      const p = fx._flare(x + Math.cos(a) * r, y + Math.sin(a) * r, 'star', PALETTE.paleGold, rand(500, 900), rand(18, 30) * s, 4, { rot: 0, delay: rand(40, 200), a: 0.9 });
      p.vy = -rand(10, 40);
      p.fixed = true;
    }
    fx._spray(x, y, 'dot', PALETTE.paleGold, Math.round(12 * s), { speed: [40, 160], life: [600, 1000], size: [2, 3.5], grav: -40, drag: 1.6, flick: 0.6, flickF: 0.05 });
  },
  perfect(fx, x, y, o, s) {
    const col = o.color || QTE_COLORS.perfect;
    fx._flare(x, y, 'star', WHITE, 240, 120 * s, 24 * s, { rot: Math.PI / 8 });
    fx._flare(x, y, 'glow', col, 300, 70 * s, 20 * s);
    fx.ring(x, y, { r0: 20 * s, r1: 96 * s, life: 380, color: col, width: 4 });
    fx.ring(x, y, { r0: 10 * s, r1: 140 * s, life: 520, color: WHITE, width: 1.5, delay: 50 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const p = fx._spawn('star', col, x + Math.cos(a) * 30 * s, y + Math.sin(a) * 30 * s, Math.cos(a) * 120, Math.sin(a) * 120 - 40, rand(420, 700), rand(9, 14) * s, 2);
      p.drag = 3; p.fixed = true;
    }
    fx._spray(x, y, 'dot', col, 12, { speed: [30, 110], life: [600, 1000], size: [2, 3.5], grav: -80, drag: 1.2, flick: 0.5, wob: 5 });
  },
  dodge(fx, x, y, o, s) {
    if (o.perfect) { BURSTS.perfectDodge(fx, x, y, o, s); return; }
    const col = o.color || '#c8dcea';
    const d = o.dir === 1 ? 1 : -1; // direction the dodger moves
    // air whoosh: thin crescents trailing the sidestep
    for (let i = 0; i < 3; i++) {
      fx.slash(x - d * (10 + i * 16), y - 50 * s + i * 34 * s, { angle: d > 0 ? Math.PI : 0, length: (120 - i * 20) * s, width: 5 * s, color: col, life: 260 + i * 40, curve: 0.22, flip: i % 2 === 0, delay: i * 30 });
    }
    for (let i = 0; i < 4; i++) {
      const p = fx._spawn('flare', col, x - d * rand(10, 40), y + rand(-60, 30) * s, -d * rand(140, 260), 0, rand(220, 320), rand(70, 120) * s, rand(20, 40) * s);
      p.fixed = true; p.rot = 0; p.w = rand(3, 6); p.anchor = 0.5; p.a = 0.55;
    }
    fx._spray(x, y + 50 * s, 'smoke', PALETTE.parchment, 5, { speed: [40, 110], angle: d > 0 ? Math.PI : 0, spread: 0.8, life: [360, 560], size: [10, 16], end: 2.4, add: false, a: 0.4, drag: 2 });
  },
  perfectDodge(fx, x, y, o, s) {
    const d = o.dir === 1 ? 1 : -1;
    const cool = '#8fd0ff';
    // a tall ghostly afterimage where the dodger stood, smeared along the dodge
    const ghost = fx._flare(x - d * 18, y - 20 * s, 'soft', cool, 520, 44 * s, 56 * s, { a: 0.75, fadePow: 1.6 });
    ghost.sy = 2.4;
    ghost.vx = -d * 40;
    for (let i = 0; i < 4; i++) {
      const p = fx._spawn('flare', i === 1 ? WHITE : cool, x - d * (30 + i * 22), y - 64 * s + i * 34 * s, -d * 90, 0, 380 + i * 60, 320 * s, 160 * s);
      p.fixed = true; p.rot = 0; p.w = (i === 1 ? 10 : 20) * s; p.anchor = 0.5; p.a = i === 1 ? 0.95 : 0.65;
    }
    fx._flare(x, y, 'star', '#e6f6ff', 220, 110 * s, 20 * s, { rot: Math.PI / 4 });
    fx.ring(x, y + 64 * s, { r0: 10 * s, r1: 130 * s, life: 460, color: cool, width: 3.5, squash: 0.28 });
    fx._spray(x, y, 'dot', cool, Math.round(22 * s), { speed: [40, 200], angle: d > 0 ? Math.PI : 0, spread: 1.6, life: [500, 900], size: [2.2, 4], drag: 2, flick: 0.5, jitter: 90 * s });
    fx._spray(x, y, 'star', '#d8f0ff', 6, { speed: [10, 40], life: [400, 700], size: [9, 15], end: 0.1, jitter: 100 * s, delay: [0, 160] });
  },
  jump(fx, x, y, o, s) {
    const col = o.color || HIT_TYPE_COLORS.jump;
    fx._spray(x, y, 'smoke', PALETTE.parchment, Math.round(8 * s), { speed: [60, 160], angle: -Math.PI / 2, spread: Math.PI * 1.2, life: [420, 640], size: [10, 16], end: 2.4, add: false, a: 0.45, drag: 3, grav: -20 });
    fx.ring(x, y, { r0: 10 * s, r1: 96 * s, life: 380, color: col, width: 3.5, squash: 0.28 });
    for (let i = 0; i < 5; i++) {
      const p = fx._spawn('streak', col, x + rand(-34, 34) * s, y - rand(0, 20), 0, -rand(420, 700), rand(200, 320), 40, 40);
      p.w = 4; p.stretch = 0.07; p.drag = 3;
    }
    fx._spray(x, y, 'dot', col, 8, { speed: [80, 220], angle: -Math.PI / 2, spread: 1.4, life: [300, 520], size: [2, 3.5], grav: 500 });
  },
  land(fx, x, y, o, s) {
    fx._spray(x, y, 'smoke', o.color || PALETTE.parchment, Math.round(10 * s), { speed: [80, 220], angle: -Math.PI / 2, spread: Math.PI * 1.1, life: [420, 700], size: [10, 18], end: 2.6, add: false, a: 0.45, drag: 3.2 });
    fx.ring(x, y, { r0: 12 * s, r1: 120 * s, life: 400, color: PALETTE.parchment, width: 3, squash: 0.25, alpha: 0.7 });
    fx._spray(x, y, 'rock', '#8f6f52', Math.round(6 * s), { speed: [120, 280], angle: -Math.PI / 2, spread: 1.8, life: [380, 600], size: [2.5, 4.5], end: 1, grav: 1400, add: false, vr: 10 });
  },
  heal(fx, x, y, o, s) {
    const col = o.color || PALETTE.hpGood;
    fx._flare(x, y, 'soft', col, 600, 60 * s, 130 * s, { a: 0.55, fadePow: 1.6 });
    fx._spray(x, y + 30 * s, 'glow', col, Math.round(16 * s), { speed: [40, 130], angle: -Math.PI / 2, spread: 1.2, life: [700, 1100], size: [4, 8], end: 0.2, drag: 0.6, grav: -60, wob: 10, jitter: 70 * s });
    fx._spray(x, y + 20 * s, 'plus', '#c8ffb0', 6, { speed: [30, 90], angle: -Math.PI / 2, spread: 0.8, life: [800, 1100], size: [6, 9], end: 0.6, grav: -40, jitter: 80 * s, rot: 0, delay: [0, 250] });
    fx._spray(x, y, 'petal', PALETTE.leaf, 5, { speed: [40, 100], angle: -Math.PI / 2, spread: 1.6, life: [800, 1200], size: [4, 6], end: 0.8, add: false, flutter: 0.012, vr: 4, grav: -30, jitter: 50 * s });
    fx.ring(x, y + 60 * s, { r0: 20 * s, r1: 90 * s, life: 600, color: col, width: 3, squash: 0.3 });
  },
  buff(fx, x, y, o, s) {
    const col = o.color || PALETTE.gold;
    for (let i = 0; i < 9; i++) {
      const p = fx._spawn('streak', col, x + rand(-45, 45) * s, y + rand(-10, 70) * s, 0, -rand(160, 300), rand(420, 620), 50, 50);
      p.w = 3.5; p.stretch = 0.2; p.age = -rand(0, 220);
    }
    fx._spray(x, y + 20 * s, 'dot', col, 12, { speed: [30, 90], angle: -Math.PI / 2, spread: 1, life: [600, 1000], size: [2, 3.5], grav: -60, flick: 0.5, jitter: 80 * s });
    fx.ring(x, y + 64 * s, { r0: 70 * s, r1: 20 * s, life: 520, color: col, width: 3, squash: 0.3 });
    fx._flare(x, y - 40 * s, 'star', PALETTE.paleGold, 360, 40 * s, 8, { delay: 160 });
  },
  debuff(fx, x, y, o, s) {
    const col = o.color || '#9b6fd6';
    fx._flare(x, y - 10 * s, 'soft', col, 700, 70 * s, 110 * s, { a: 0.45, fadePow: 1.8 });
    for (let i = 0; i < 12; i++) {
      const p = fx._spawn('streak', col, x + rand(-50, 50) * s, y + rand(-80, 10) * s, 0, rand(140, 260), rand(420, 640), 50, 50);
      p.w = 3.5; p.stretch = 0.22; p.age = -rand(0, 240); p.a = 0.85;
    }
    fx._spray(x, y, 'smoke', '#2a1c33', 8, { speed: [20, 70], life: [800, 1200], size: [18, 28], end: 2, add: false, a: 0.6, grav: 24, jitter: 70 * s });
    fx._spray(x, y, 'dot', col, 16, { speed: [20, 80], angle: Math.PI / 2, spread: 1.2, life: [700, 1000], size: [2.2, 3.8], grav: 70, jitter: 90 * s, flick: 0.4 });
    fx.ring(x, y, { r0: 90 * s, r1: 14 * s, life: 460, color: col, width: 4 });
    fx.ring(x, y + 60 * s, { r0: 80 * s, r1: 20 * s, life: 560, color: col, width: 2.5, squash: 0.3, delay: 80 });
  },
  fire(fx, x, y, o, s) {
    const col = o.color || ELEMENT_COLORS.fire;
    fx._flare(x, y, 'star', '#ffd08a', 200, 110 * s, 24 * s, { rot: 0.4 });
    fx._flare(x, y, 'glow', '#ffd08a', 260, 100 * s, 40 * s);
    // flame tongues licking upward
    fx._spray(x, y, 'glow', col, Math.round(16 * s), { speed: [120, 360], angle: -Math.PI / 2, spread: 1.8, life: [380, 620], size: [14, 26], end: 0.25, grav: -200, drag: 2.6, colors: [col, PALETTE.ember, '#ffb347', '#ffd08a'], jitter: 24 * s });
    fx._spray(x, y, 'dot', '#ffb347', Math.round(28 * s), { speed: [80, 340], angle: -Math.PI / 2, spread: 2.8, life: [700, 1300], size: [2.6, 4.6], grav: -140, drag: 1.3, flick: 0.6, flickF: 0.05, wob: 9, colors: ['#ffb347', '#ffd08a', '#ff7a3a'] });
    fx._spray(x, y - 20 * s, 'smoke', '#5a4038', 5, { speed: [20, 70], angle: -Math.PI / 2, spread: 1, life: [800, 1200], size: [16, 26], end: 2.4, add: false, a: 0.3, grav: -80, delay: [80, 220] });
    fx.ring(x, y, { r0: 12 * s, r1: 90 * s, life: 340, color: PALETTE.ember, width: 4 });
    fx.sparks(x, y, { color: '#ffd08a', count: Math.round(12 * s), speed: 460, life: 380 });
  },
  ice(fx, x, y, o, s) {
    const col = o.color || ELEMENT_COLORS.ice;
    fx._flare(x, y, 'star', '#e6f7ff', 260, 130 * s, 30 * s, { rot: Math.PI / 6 });
    fx._flare(x, y, 'glow', col, 260, 80 * s, 30 * s, { a: 0.8 });
    fx._spray(x, y, 'shard', col, Math.round(16 * s), { speed: [220, 520], life: [520, 800], size: [6, 12], end: 0.6, grav: 500, drag: 1.8, vr: 12 });
    fx._spray(x, y, 'dot', '#f2fbff', 14, { speed: [20, 90], life: [700, 1100], size: [1.8, 3], grav: 40, wob: 8, jitter: 60 * s });
    fx._spray(x, y, 'smoke', '#cfeaf5', 4, { speed: [10, 40], life: [600, 900], size: [18, 26], end: 1.8, add: false, a: 0.3, jitter: 30 * s });
    fx.ring(x, y, { r0: 10 * s, r1: 96 * s, life: 340, color: '#e6f7ff', width: 3.5 });
  },
  lightning(fx, x, y, o, s) {
    const col = o.color || ELEMENT_COLORS.lightning;
    fx.line(x + rand(-50, 50), y - 300 * s, x, y, { color: col, width: 4.5, life: 200, jagged: 22 });
    fx.line(x + rand(-40, 40), y - 260 * s, x, y, { color: WHITE, width: 2, life: 150, jagged: 18, delay: 30 });
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * TAU;
      const r = rand(50, 110) * s;
      fx.line(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, { color: col, width: 2.5, life: 160, jagged: 10, delay: rand(0, 80) });
    }
    fx._flare(x, y, 'star', WHITE, 180, 150 * s, 30 * s, { rot: Math.random() });
    fx._flare(x, y, 'glow', col, 220, 90 * s, 30 * s);
    fx.sparks(x, y, { color: '#fffbd0', count: Math.round(20 * s), speed: 620, life: 320, gravity: 900, width: 3 });
    fx.ring(x, y, { r0: 10 * s, r1: 80 * s, life: 220, color: col, width: 3 });
  },
  earth(fx, x, y, o, s) {
    const col = o.color || ELEMENT_COLORS.earth;
    fx._spray(x, y, 'rock', col, Math.round(12 * s), { speed: [260, 600], angle: -Math.PI / 2, spread: 2.2, life: [600, 900], size: [3, 7], end: 1, grav: 1500, add: false, vr: 12 });
    fx._spray(x, y, 'smoke', mix(col, PALETTE.parchment, 0.4), Math.round(9 * s), { speed: [60, 200], life: [600, 900], size: [14, 22], end: 2.3, add: false, a: 0.5, drag: 2.6, grav: -20 });
    fx._flare(x, y, 'glow', '#ffd9a0', 200, 70 * s, 20 * s, { a: 0.7 });
    fx.ring(x, y + 30 * s, { r0: 20 * s, r1: 130 * s, life: 420, color: col, width: 5, squash: 0.35 });
    fx.sparks(x, y, { color: '#ffe0b0', count: 8, speed: 380, life: 300 });
  },
  light(fx, x, y, o, s) {
    const col = o.color || ELEMENT_COLORS.light;
    fx._flare(x, y, 'star', WHITE, 320, 190 * s, 40 * s, { rot: 0 });
    fx._flare(x, y, 'glow', col, 360, 130 * s, 40 * s);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + rand(-0.08, 0.08);
      const len = (i % 2 ? 110 : 170) * s;
      const p = fx._spawn('flare', col, x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5, 0, 0, 340, len * 0.4, len);
      p.fixed = true; p.rot = a; p.w = 10 * s; p.anchor = 0.5; p.a = 0.8; p.easeSize = true;
    }
    fx._spray(x, y, 'dot', PALETTE.paleGold, 16, { speed: [30, 120], life: [700, 1100], size: [2, 3.5], grav: -70, flick: 0.5, jitter: 60 * s });
    fx.ring(x, y, { r0: 16 * s, r1: 120 * s, life: 400, color: WHITE, width: 4 });
  },
  dark(fx, x, y, o, s) {
    const col = o.color || ELEMENT_COLORS.dark;
    // implosion then release
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * TAU;
      const r = rand(60, 110) * s;
      const p = fx._spawn('glow', i % 3 ? col : '#5a2d96', x + Math.cos(a) * r, y + Math.sin(a) * r, -Math.cos(a) * r * 3.2, -Math.sin(a) * r * 3.2, 300, rand(6, 11) * s, 2);
      p.a = 0.9;
    }
    fx._spray(x, y, 'smoke', '#1d1426', 6, { speed: [30, 90], life: [700, 1000], size: [18, 28], end: 2, add: false, a: 0.55, delay: 180 });
    fx.ring(x, y, { r0: 10 * s, r1: 110 * s, life: 380, color: col, width: 5, delay: 260 });
    fx._flare(x, y, 'star', '#e8d8ff', 240, 130 * s, 20 * s, { delay: 260, rot: 0.4 });
    fx._spray(x, y, 'streak', col, Math.round(14 * s), { speed: [300, 620], life: [240, 400], grav: 400, drag: 2, w: 4, stretch: 0.06, size: [24, 40], rot: 0, delay: 260 });
  },
  break(fx, x, y, o, s) {
    const col = o.color || PALETTE.breakBar;
    fx._flare(x, y, 'star', WHITE, 280, 210 * s, 44 * s, { rot: 0.15 });
    fx._flare(x, y, 'glow', col, 320, 150 * s, 50 * s);
    fx._flare(x, y, 'flare', WHITE, 280, 620 * s, 240 * s, { w: 22 * s });
    // cracks radiate first, then the glass lets go
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rand(-0.2, 0.2);
      const r = rand(70, 170) * s;
      fx.line(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, { color: i % 2 ? WHITE : col, width: 2.5, life: 320, jagged: 9 });
    }
    fx._spray(x, y, 'shard', mix(col, WHITE, 0.55), Math.round(26 * s), { speed: [260, 820], life: [700, 1100], size: [8, 20], end: 0.7, grav: 1300, drag: 1.2, vr: 14, delay: [30, 90] });
    fx._spray(x, y, 'shard', col, Math.round(12 * s), { speed: [160, 520], life: [700, 1000], size: [6, 12], end: 0.6, grav: 1200, drag: 1.2, vr: 14, delay: [30, 90] });
    fx.ring(x, y, { r0: 20 * s, r1: 210 * s, life: 460, color: col, width: 6 });
    fx.ring(x, y, { r0: 10 * s, r1: 130 * s, life: 300, color: WHITE, width: 4 });
    fx.sparks(x, y, { color: '#ffd28a', count: Math.round(22 * s), speed: 720, life: 420, gravity: 1100 });
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * TAU;
      const r = rand(30, 120) * s;
      fx._flare(x + Math.cos(a) * r, y + Math.sin(a) * r, 'star', PALETTE.paleGold, rand(500, 800), rand(16, 26) * s, 4, { delay: rand(80, 300) });
    }
  },
  ko(fx, x, y, o, s) {
    const col = o.color || PALETTE.gold;
    const petals = [col, PALETTE.parchment, PALETTE.rose, mix(col, PALETTE.ivory, 0.5)];
    fx._spray(x, y, 'petal', col, Math.round(30 * s), {
      speed: [40, 160], angle: -Math.PI / 2, spread: Math.PI * 1.4, life: [1300, 2100], size: [4, 7], end: 0.6, add: false,
      flutter: 0.012, vr: 5, grav: -50, drag: 1, wob: 14, jitter: 80 * s, colors: petals,
    });
    fx._spray(x, y, 'dot', PALETTE.paleGold, 16, { speed: [20, 80], angle: -Math.PI / 2, spread: 1.5, life: [900, 1500], size: [2, 3.5], grav: -60, flick: 0.5, jitter: 90 * s });
    fx._spray(x, y + 20 * s, 'smoke', '#4a4038', 8, { speed: [20, 60], angle: -Math.PI / 2, spread: 1.2, life: [1000, 1500], size: [18, 28], end: 2.2, add: false, a: 0.4, grav: -40, jitter: 60 * s });
    fx.ring(x, y, { r0: 30 * s, r1: 120 * s, life: 700, color: col, width: 2, alpha: 0.6 });
  },
  gradient(fx, x, y, o, s) {
    const col = o.color || HIT_TYPE_COLORS.gradient;
    fx._flare(x, y, 'star', WHITE, 320, 200 * s, 44 * s, { rot: 0.2 });
    fx._flare(x, y, 'star', col, 380, 160 * s, 36 * s, { rot: Math.PI / 4 + 0.2, delay: 20 });
    fx._flare(x, y, 'glow', col, 380, 150 * s, 50 * s);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      const len = rand(120, 220) * s;
      const p = fx._spawn('flare', PRISM[i % PRISM.length], x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5, 0, 0, 420, len * 0.3, len);
      p.fixed = true; p.rot = a; p.w = 9 * s; p.anchor = 0.5; p.a = 0.85; p.easeSize = true;
    }
    // chromatic ring split
    fx.ring(x, y, { r0: 14 * s, r1: 170 * s, life: 460, color: col, width: 6 });
    fx.ring(x, y, { r0: 10 * s, r1: 182 * s, life: 460, color: PRISM[0], width: 2, delay: 20 });
    fx.ring(x, y, { r0: 18 * s, r1: 158 * s, life: 460, color: PRISM[4], width: 2, delay: 20 });
    fx._spray(x, y, 'shard', col, Math.round(14 * s), { speed: [240, 620], life: [600, 900], size: [6, 13], end: 0.6, grav: 600, drag: 1.5, vr: 12, colors: PRISM });
    fx._spray(x, y, 'dot', col, 16, { speed: [40, 160], life: [700, 1100], size: [2, 4], drag: 1.4, flick: 0.5, colors: PRISM, jitter: 40 * s });
    fx._spray(x, y, 'petal', col, 10, { speed: [60, 180], life: [900, 1400], size: [4, 6], end: 0.6, add: false, flutter: 0.014, vr: 6, grav: -20, colors: ['#c77dff', '#8a5cc4', '#f0d0ff'] });
  },
  shield(fx, x, y, o, s) {
    const col = o.color || PALETTE.shield;
    fx._flare(x, y, 'star', '#eaf6ff', 220, 120 * s, 20 * s, { rot: Math.PI / 6 });
    fx._flare(x, y, 'glow', col, 260, 80 * s, 30 * s);
    fx._spray(x, y, 'hex', col, Math.round(14 * s), { speed: [160, 440], life: [600, 900], size: [6, 11], end: 0.5, grav: 700, drag: 1.4, vr: 8 });
    fx.ring(x, y, { r0: 20 * s, r1: 110 * s, life: 360, color: col, width: 4 });
    fx.sparks(x, y, { color: '#dff2ff', count: 12, speed: 460, life: 320 });
  },
  counter(fx, x, y, o, s) {
    const a = dirAngle(o) ?? 0;
    fx._flare(x, y, 'star', WHITE, 220, 160 * s, 30 * s, { rot: 0.3 });
    fx._flare(x, y, 'glow', PALETTE.crimson, 280, 110 * s, 30 * s);
    fx.slash(x, y, { angle: a - 0.7, length: 190 * s, width: 18 * s, color: PALETTE.crimson, life: 260, curve: 0.35 });
    fx.slash(x, y, { angle: a + 0.7, length: 180 * s, width: 15 * s, color: PALETTE.gold, life: 260, curve: 0.35, delay: 50, flip: true });
    fx.ring(x, y, { r0: 16 * s, r1: 130 * s, life: 380, color: PALETTE.gold, width: 4, delay: 40 });
    fx._spray(x, y, 'streak', PALETTE.paleGold, Math.round(14 * s), { speed: [360, 760], life: [220, 400], angle: a, spread: 2.4, grav: 900, drag: 2.2, w: 4, stretch: 0.06, size: [24, 40], rot: 0 });
    fx._spray(x, y, 'streak', '#ff7a6a', Math.round(10 * s), { speed: [260, 600], life: [220, 380], grav: 900, drag: 2.2, w: 3.5, stretch: 0.06, size: [20, 34], rot: 0 });
  },
  glyph(fx, x, y, o, s) {
    const col = o.color || PALETTE.paleGold;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const p = fx._spawn('glyph' + (i % 4), col, x + Math.cos(a) * 40 * s, y + Math.sin(a) * 40 * s, Math.cos(a + Math.PI / 2) * 90, Math.sin(a + Math.PI / 2) * 90 - 40, rand(600, 900), 9 * s, 5 * s);
      p.drag = 1.5; p.vr = rand(-2, 2);
    }
    fx.ring(x, y, { r0: 50 * s, r1: 18 * s, life: 420, color: col, width: 2.5 });
    fx._flare(x, y, 'glow', col, 380, 50 * s, 20 * s, { a: 0.7 });
  },
  surge(fx, x, y, o, s) {
    const col = o.color || '#bfe0ff';
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * TAU;
      const r = rand(30, 60) * s;
      fx.line(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, { color: col, width: 2, life: 140, jagged: 7, delay: i * 50 });
    }
    fx._flare(x, y, 'glow', col, 200, 40 * s, 14 * s, { a: 0.8 });
    fx.sparks(x, y, { color: col, count: 6, speed: 300, life: 240, width: 2.5 });
  },
};

// ---------------------------------------------------------------------------------------------
// World-space painters
// ---------------------------------------------------------------------------------------------

function drawRing(ctx, r) {
  if (r.age < 0) return;
  const u = r.age / r.life;
  const rad = lerp(r.r0, r.r1, outCubic(u));
  const a = Math.pow(1 - u, 1.4) * r.alpha;
  if (a <= 0.01 || rad <= 0) return;
  const w = Math.max(0.5, r.width * (1 - u * 0.65));
  ctx.beginPath();
  ctx.ellipse(r.x, r.y, rad, rad * r.squash, 0, 0, TAU);
  ctx.globalAlpha = a * 0.28;
  ctx.strokeStyle = r.color;
  ctx.lineWidth = w * 3.2;
  ctx.stroke();
  ctx.globalAlpha = a;
  ctx.strokeStyle = mix(r.color, WHITE, 0.4);
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const SLASH_N = 22;
const slashOuter = new Float32Array((SLASH_N + 1) * 2);
const slashInner = new Float32Array((SLASH_N + 1) * 2);

function drawSlash(ctx, sl) {
  if (sl.age < 0) return;
  const u = sl.age / sl.life;
  const head = outCubic(clamp(u / 0.42, 0, 1));
  const tail = inQuad(clamp((u - 0.1) / 0.9, 0, 1));
  if (head - tail < 0.01) return;
  const L = sl.length;
  const cy = -sl.curve * L * sl.flip;
  const alpha = 1 - smoothstep(0.55, 1, u);
  ctx.save();
  ctx.translate(sl.x, sl.y);
  ctx.rotate(sl.angle);
  const build = (scale, innerK) => {
    for (let i = 0; i <= SLASH_N; i++) {
      const v = i / SLASH_N;
      const t = tail + (head - tail) * v;
      const mt = 1 - t;
      const bx = mt * mt * (-L / 2) + t * t * (L / 2);
      const by = 2 * mt * t * cy;
      const tx = 2 * mt * (L / 2) + 2 * t * (L / 2);
      const ty = 2 * (1 - 2 * t) * cy;
      const tl = Math.hypot(tx, ty) || 1;
      // normal pointing toward the bulge (outer side of the crescent)
      let nx = -ty / tl, ny = tx / tl;
      if (ny * sl.flip > 0) { nx = -nx; ny = -ny; }
      const hw = sl.width * 0.5 * scale * Math.sin(Math.PI * Math.pow(v, 0.72)) * (1 - 0.3 * u);
      slashOuter[i * 2] = bx + nx * hw;
      slashOuter[i * 2 + 1] = by + ny * hw;
      slashInner[i * 2] = bx - nx * hw * innerK;
      slashInner[i * 2 + 1] = by - ny * hw * innerK;
    }
    ctx.beginPath();
    ctx.moveTo(slashOuter[0], slashOuter[1]);
    for (let i = 1; i <= SLASH_N; i++) ctx.lineTo(slashOuter[i * 2], slashOuter[i * 2 + 1]);
    for (let i = SLASH_N; i >= 0; i--) ctx.lineTo(slashInner[i * 2], slashInner[i * 2 + 1]);
    ctx.closePath();
  };
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle = sl.color;
  build(1.9, 0.6);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = mix(sl.color, WHITE, 0.25);
  build(1, 0.4);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = WHITE;
  build(0.38, 0.2);
  ctx.fill();
  ctx.restore();
}

function drawTracer(ctx, ln) {
  if (ln.age < 0) return;
  const u = ln.age / ln.life;
  const a = Math.pow(1 - u, 1.5);
  if (a <= 0.01) return;
  const p = ln.pts;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalAlpha = a * 0.3;
  ctx.strokeStyle = ln.color;
  ctx.lineWidth = ln.width * 3.5;
  ctx.stroke();
  ctx.globalAlpha = a;
  ctx.strokeStyle = mix(ln.color, WHITE, 0.55);
  ctx.lineWidth = Math.max(0.6, ln.width * (1 - u * 0.5));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function waveState(w) {
  const k = Math.min(1, w.age / w.travel);
  const cx = w.x + w.dir * w.dist * k;
  const fade = w.age < w.travel ? 1 : 1 - (w.age - w.travel) / Math.max(1, w.life - w.travel);
  return { cx, k, fade: clamp(fade, 0, 1) };
}

function drawWaveTrail(ctx, w) {
  const { cx, k, fade } = waveState(w);
  const tl = Math.min(w.dist * k + 20, 220);
  if (tl < 4 || fade <= 0) return;
  const x0 = cx - w.dir * tl;
  const gr = ctx.createLinearGradient(x0, 0, cx, 0);
  gr.addColorStop(0, rgba(w.color, 0));
  gr.addColorStop(0.8, rgba(w.color, 0.35 * fade));
  gr.addColorStop(1, rgba(mix(w.color, WHITE, 0.5), 0.75 * fade));
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.ellipse((x0 + cx) / 2, w.y, tl / 2, 9, 0, 0, TAU);
  ctx.fill();
}

function drawWaveCrest(ctx, w) {
  const { cx, fade } = waveState(w);
  if (fade <= 0.01) return;
  const d = w.dir;
  const wob = 0.9 + 0.1 * Math.sin(w.age * 0.04);
  const crest = (x, h, a, thick) => {
    const g = ctx.createLinearGradient(0, w.y, 0, w.y - h);
    g.addColorStop(0, rgba(mix(w.color, WHITE, 0.55), a));
    g.addColorStop(0.45, rgba(w.color, a * 0.7));
    g.addColorStop(1, rgba(w.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - d * thick, w.y + 2);
    ctx.quadraticCurveTo(x + d * thick * 1.4, w.y - h * 0.45, x + d * thick * 0.2, w.y - h);
    ctx.quadraticCurveTo(x - d * thick * 0.2, w.y - h * 0.45, x - d * thick * 2.2, w.y + 2);
    ctx.closePath();
    ctx.fill();
  };
  crest(cx - d * 30, w.height * 0.6 * wob, 0.45 * fade, 10);
  crest(cx, w.height * wob, 0.95 * fade, 14);
  const spr = sprite('soft', w.color);
  if (spr) {
    ctx.globalAlpha = 0.9 * fade;
    ctx.drawImage(spr, cx - 46, w.y - 16, 92, 32);
    ctx.globalAlpha = 1;
  }
}

function projPos(pr, u, out) {
  const { from, to, arc } = pr;
  out.x = lerp(from.x, to.x, u);
  out.y = lerp(from.y, to.y, u) - arc * 4 * u * (1 - u);
  const dx = to.x - from.x;
  const dy = to.y - from.y - arc * 4 * (1 - 2 * u);
  out.a = Math.atan2(dy, dx);
  return out;
}

function drawProjectile(ctx, pr, clock) {
  const { x, y, a } = pr.pos;
  const tr = pr.trail;
  const sz = pr.size;
  const col = pr.color;
  if (pr.kind === 'bullet') {
    const n = Math.min(tr.length, 10);
    const tx = tr[n - 2] ?? x, ty = tr[n - 1] ?? y;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = col;
    ctx.lineWidth = 7 * sz;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = mix(col, WHITE, 0.7);
    ctx.lineWidth = 2.4 * sz;
    ctx.stroke();
    const g = sprite('glow', col);
    if (g) ctx.drawImage(g, x - 12 * sz, y - 12 * sz, 24 * sz, 24 * sz);
    return;
  }
  // tapered trail for everything else
  const n = tr.length / 2;
  if (n > 2) {
    ctx.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      const k = 1 - i / n;
      ctx.globalAlpha = k * (pr.kind === 'thorn' ? 0.35 : 0.55);
      ctx.strokeStyle = col;
      ctx.lineWidth = (pr.kind === 'thorn' ? 3 : 10) * sz * k;
      ctx.beginPath();
      ctx.moveTo(tr[(i - 1) * 2], tr[(i - 1) * 2 + 1]);
      ctx.lineTo(tr[i * 2], tr[i * 2 + 1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (pr.kind === 'bolt') {
    const s = sprite('streak', col);
    const gl = sprite('glow', col);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    if (gl) ctx.drawImage(gl, -22 * sz, -22 * sz, 44 * sz, 44 * sz);
    if (s) ctx.drawImage(s, -64 * sz, -11 * sz, 72 * sz, 22 * sz);
    ctx.restore();
  } else if (pr.kind === 'orb') {
    const gl = sprite('glow', col);
    const pulse = 1 + 0.14 * Math.sin(clock * 0.03);
    if (gl) {
      ctx.drawImage(gl, x - 26 * sz * pulse, y - 26 * sz * pulse, 52 * sz * pulse, 52 * sz * pulse);
      ctx.drawImage(gl, x - 10 * sz, y - 10 * sz, 20 * sz, 20 * sz);
      const dot = sprite('dot', mix(col, WHITE, 0.4));
      for (let i = 0; i < 3; i++) {
        const ang = clock * 0.012 + (i * TAU) / 3;
        if (dot) ctx.drawImage(dot, x + Math.cos(ang) * 18 * sz - 4, y + Math.sin(ang) * 10 * sz - 4, 8, 8);
      }
    }
  } else if (pr.kind === 'glyph') {
    const gl = sprite('glow', col);
    const gy = sprite('glyph' + (Math.floor(pr.spin * 10) % 4), col);
    ctx.save();
    ctx.translate(x, y);
    if (gl) ctx.drawImage(gl, -24 * sz, -24 * sz, 48 * sz, 48 * sz);
    ctx.rotate(pr.spin + clock * 0.006);
    if (gy) ctx.drawImage(gy, -16 * sz, -16 * sz, 32 * sz, 32 * sz);
    ctx.strokeStyle = mix(col, WHITE, 0.3);
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, 17 * sz, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else if (pr.kind === 'thorn') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const gl = sprite('soft', col);
    if (gl) ctx.drawImage(gl, -30 * sz, -14 * sz, 50 * sz, 28 * sz);
    ctx.globalCompositeOperation = 'source-over';
    ctx.scale(sz, sz);
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-4, -2);
    ctx.lineTo(-16, -3);
    ctx.lineTo(-22, 0);
    ctx.lineTo(-16, 3);
    ctx.lineTo(-4, 2);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fillStyle = mix(col, '#1a1408', 0.55);
    ctx.fill();
    ctx.strokeStyle = mix(col, WHITE, 0.3);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

/** Draws one floating text; returns the alpha it was drawn at. */
function drawNumber(ctx, n) {
  const u = n.age / n.life;
  const popT = clamp(n.age / (n.crit ? 200 : 170), 0, 1);
  const scale = lerp(n.pop, 1, outBack(popT, n.crit ? 2.4 : 1.8));
  const x = textX(n);
  const y = n.y - 14 - textRise(n, n.age) - (n.lift || 0);
  const alpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
  if (alpha <= 0.01) return 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (n.rot) ctx.rotate(n.rot * (1 - popT * 0.4));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = n.font;
  if (n.crit) drawCritFlourish(ctx, n, popT);
  if (n.glow) {
    ctx.shadowColor = rgba(n.glow, 0.75);
    ctx.shadowBlur = n.crit ? 18 : 10;
  }
  if (n.stroke) {
    ctx.lineWidth = n.strokeW;
    ctx.strokeStyle = n.stroke;
    ctx.strokeText(n.text, 0, 0);
  }
  ctx.shadowBlur = 0;
  const gr = ctx.createLinearGradient(0, -n.size * 0.45, 0, n.size * 0.38);
  gr.addColorStop(0, n.top);
  gr.addColorStop(0.55, mix(n.top, n.bottom, 0.6));
  gr.addColorStop(1, n.bottom);
  ctx.fillStyle = gr;
  ctx.fillText(n.text, 0, 0);
  if (n.tag) {
    ctx.font = n.tagFont;
    const ty = -n.size * 0.66;
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.strokeText(n.tag, 0, ty);
    ctx.fillStyle = n.tagColor;
    ctx.fillText(n.tag, 0, ty);
  }
  ctx.restore();
  return alpha;
}

function drawCritFlourish(ctx, n, popT) {
  const w = ctx.measureText(n.text).width;
  const k = outCubic(popT);
  ctx.save();
  // crimson ink swoosh underlining the number
  ctx.globalAlpha *= 0.9;
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  const x0 = -w * 0.75, x1 = x0 + (w * 1.55) * k;
  ctx.moveTo(x0, n.size * 0.34);
  ctx.quadraticCurveTo((x0 + x1) / 2, n.size * 0.12, x1, n.size * 0.02);
  ctx.quadraticCurveTo((x0 + x1) / 2, n.size * 0.42, x0, n.size * 0.34);
  ctx.fill();
  // gold hairline flourish above
  ctx.strokeStyle = PALETTE.gold;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, -n.size * 0.5);
  ctx.quadraticCurveTo(0, -n.size * 0.36 - 6 * k, w * 0.55 * k, -n.size * 0.5);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Screen-space painters
// ---------------------------------------------------------------------------------------------

function drawVignette(ctx, v) {
  const u = v.age / v.life;
  const env = u < 0.15 ? outQuad(u / 0.15) : Math.pow(1 - (u - 0.15) / 0.85, 1.5);
  const a = v.alpha * env;
  if (a <= 0.005) return;
  const gr = ctx.createRadialGradient(STAGE_W / 2, STAGE_H / 2, STAGE_H * 0.3, STAGE_W / 2, STAGE_H / 2, STAGE_W * 0.62);
  gr.addColorStop(0, rgba(v.color, 0));
  gr.addColorStop(0.6, rgba(v.color, 0.35));
  gr.addColorStop(1, rgba(v.color, 1));
  ctx.globalAlpha = a;
  ctx.fillStyle = gr;
  ctx.fillRect(-60, -60, STAGE_W + 120, STAGE_H + 120);
  ctx.globalAlpha = 1;
}

const BANNER_STYLES = {
  impact: { size: 64, sub: 22, y: 196, slot: 'impact', tilt: -0.03 },
  title: { size: 104, sub: 30, y: 300, slot: 'title', tilt: -0.02 },
  caption: { size: 30, sub: 18, y: 84, slot: 'caption', tilt: 0 },
};

function drawBanner(ctx, b) {
  const t = b.age;
  const L = b.life;
  const exitT = clamp((t - (L - 280)) / 280, 0, 1);
  const size = b.size;
  ctx.save();
  ctx.font = font(900, size);
  const spacing = size * (b.slot === 'caption' ? 0.2 : 0.14);
  const chars = [...b.text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const textW = widths.reduce((a, w) => a + w, 0) + spacing * Math.max(0, chars.length - 1);
  const bandW = textW + size * (b.slot === 'caption' ? 2.4 : 2.2);
  const bandH = size * (b.slot === 'caption' ? 1.9 : 1.6);
  const cx = STAGE_W / 2 + exitT * 40;
  const cy = b.y;
  ctx.translate(cx, cy);
  ctx.rotate(b.tilt || 0);
  const alpha = 1 - exitT;
  // brush band: paints in from the left, wipes out to the right
  const brush = brushStroke(bandW, bandH, b.color);
  if (brush) {
    const reveal = outCubic(clamp(t / 230, 0, 1));
    const wipe = outCubic(exitT);
    const x0 = -bandW / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + bandW * wipe, -bandH, bandW * (reveal - wipe), bandH * 2);
    ctx.clip();
    ctx.globalAlpha = alpha * 0.95;
    ctx.drawImage(brush.canvas, x0, -bandH / 2, bandW, bandH);
    ctx.restore();
  }
  // glow behind the letters
  const glowA = alpha * clamp((t - 60) / 200, 0, 1) * (b.slot === 'caption' ? 0.3 : 0.55);
  if (glowA > 0.01) {
    const gl = sprite('soft', b.color);
    if (gl) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = glowA;
      ctx.drawImage(gl, -textW * 0.65, -size * 0.9, textW * 1.3, size * 1.8);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // letters drop in with a stagger
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const grad = ctx.createLinearGradient(0, -size * 0.42, 0, size * 0.4);
  grad.addColorStop(0, '#fffdf6');
  grad.addColorStop(0.45, mix(b.color, '#fffaf0', 0.55));
  grad.addColorStop(1, b.color);
  let x = -textW / 2;
  for (let i = 0; i < chars.length; i++) {
    const lt = clamp((t - 70 - i * 26) / 260, 0, 1);
    if (lt > 0 && chars[i] !== ' ') {
      const e = outBack(lt, 2);
      const la = Math.min(1, lt * 2.2) * alpha;
      ctx.save();
      ctx.globalAlpha = la;
      ctx.translate(x + widths[i] / 2, (1 - e) * -size * 0.3);
      const sc = lerp(1.35, 1, e);
      ctx.scale(sc, sc);
      ctx.lineWidth = Math.max(3, size * 0.1);
      ctx.strokeStyle = INK;
      ctx.strokeText(chars[i], -widths[i] / 2, 0);
      ctx.fillStyle = grad;
      ctx.fillText(chars[i], -widths[i] / 2, 0);
      ctx.restore();
    }
    x += widths[i] + spacing;
  }
  // light sheen sweeping across once
  const sheenT = (t - 300) / 420;
  if (sheenT > 0 && sheenT < 1 && b.slot !== 'caption') {
    const fl = sprite('flare', WHITE);
    if (fl) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.sin(Math.PI * sheenT) * 0.55 * alpha;
      ctx.save();
      ctx.translate(lerp(-textW * 0.6, textW * 0.6, sheenT), 0);
      ctx.rotate(Math.PI / 2 - 0.35);
      ctx.drawImage(fl, -size * 0.9, -6, size * 1.8, 12);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // subtitle
  if (b.sub) {
    const st = clamp((t - 260) / 300, 0, 1);
    if (st > 0) {
      ctx.globalAlpha = st * alpha * 0.95;
      ctx.font = `italic 600 ${b.subSize}px ${FONTS.body}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = rgba(INK, 0.85);
      const sy = bandH * 0.5 + b.subSize * 0.35 - (1 - outCubic(st)) * 8;
      ctx.strokeText(b.sub, 0, sy);
      ctx.fillStyle = PALETTE.ivory;
      ctx.fillText(b.sub, 0, sy);
    }
  }
  ctx.restore();
}

/**
 * Desaturate what has already been drawn (uses the 'saturation' blend mode; cheap, no ctx.filter).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} amount 0..1
 * @param {{x?:number, y?:number, w?:number, h?:number, tint?:string|null}} [o] tint adds a faint colour wash (e.g. violet)
 */
export function applyDesaturation(ctx, amount, { x = -60, y = -60, w = STAGE_W + 120, h = STAGE_H + 120, tint = null } = {}) {
  const a = clamp(Number(amount) || 0, 0, 1);
  if (a <= 0.001) return;
  ctx.save();
  ctx.globalCompositeOperation = 'saturation';
  ctx.globalAlpha = a;
  ctx.fillStyle = '#808080';
  ctx.fillRect(x, y, w, h);
  if (tint) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// QTE ring, defense cues, target marker, enemy bars (stateless painters)
// ---------------------------------------------------------------------------------------------

function labelPill(ctx, x, y, text, { color = PALETTE.ivory, size = 14, bg = 'rgba(16,12,10,0.82)', border = PALETTE.gold } = {}) {
  if (!text) return;
  ctx.save();
  ctx.font = font(700, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.max(size * 1.5, ctx.measureText(text).width + size * 0.9);
  const h = size * 1.45;
  ctx.beginPath();
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = rgba(border, 0.9);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + size * 0.05);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Stroke the current path as a glowing line. A thin dark underlay (normal blend) keeps additive
 * strokes readable over bright skies and sunlit floors.
 */
function glowStroke(ctx, color, width, alpha, glow = 3, under = true) {
  if (under) {
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha * 0.42;
    ctx.strokeStyle = 'rgb(10,6,4)';
    ctx.lineWidth = width + 3.5;
    ctx.stroke();
    ctx.globalCompositeOperation = op;
  }
  ctx.globalAlpha = alpha * 0.25;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * glow;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.stroke();
}

/**
 * Offensive QTE prompt: an outer ring shrinking onto a fixed inner ring; press when they meet.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {{progress?:number, radius?:number, color?:string, label?:string, rating?:'perfect'|'good'|'miss'|null, t?:number, ratingAge?:number, alpha?:number}} [o]
 *   progress 0 → 1 closes (1 = the hit moment; up to 1.25 fades past the target). When `rating` is set the
 *   judgement flourish is drawn instead, animated by `ratingAge` (ms since judged, ~520 ms total).
 */
export function drawQteRing(ctx, x, y, { progress = 0, radius = 90, color = WHITE, label = '', rating = null, t = 0, ratingAge = 160, alpha = 1 } = {}) {
  const rIn = Math.max(16, radius * 0.36);
  // Keep the rating word's slot (above the ring) free of combat text for as long as the ring is up.
  if (!rating || ratingAge < 520) layoutPublish(LAYOUT.reserve, x - 66, y - rIn - 20 - 30, x + 66, y - rIn - 20 + 13);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (rating) {
    drawRatingFlourish(ctx, x, y, rIn, rating, ratingAge, alpha);
    ctx.restore();
    return;
  }
  const p = clamp(Number(progress) || 0, 0, 1.25);
  const near = smoothstep(0.6, 1, Math.min(p, 1));
  const appear = smoothstep(0, 0.12, p);
  // contrast disc
  const disc = ctx.createRadialGradient(x, y, 0, x, y, rIn * 1.6);
  disc.addColorStop(0, 'rgba(12,8,6,0.5)');
  disc.addColorStop(1, 'rgba(12,8,6,0)');
  ctx.globalAlpha = alpha * appear;
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, rIn * 1.6, 0, TAU);
  ctx.fill();
  // fixed target ring (clockwork: double ring with 12 ticks)
  const targetCol = mix(PALETTE.gold, WHITE, near * 0.7);
  ctx.strokeStyle = targetCol;
  ctx.beginPath();
  ctx.arc(x, y, rIn, 0, TAU);
  glowStroke(ctx, targetCol, 2.4 + near * 1.6, alpha * appear, 3 + near * 2);
  ctx.globalAlpha = alpha * appear * 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, rIn - 5, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = alpha * appear * 0.85;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    const r0 = rIn + 3, r1 = rIn + (i % 3 === 0 ? 9 : 6);
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
  }
  ctx.stroke();
  // closing ring
  let r, ra = 1;
  if (p <= 1) r = lerp(radius, rIn, p);
  else { r = rIn * (1 - (p - 1) * 1.4); ra = 1 - (p - 1) / 0.25; }
  if (r > 1 && ra > 0) {
    const ringCol = mix(color, PALETTE.paleGold, near * 0.6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = ringCol;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    glowStroke(ctx, ringCol, 3 + near * 2.5, alpha * ra * appear, 3.5);
    ctx.restore();
    // four inward notches that turn with time: readable motion even at small sizes
    ctx.fillStyle = ringCol;
    ctx.globalAlpha = alpha * ra * appear;
    for (let i = 0; i < 4; i++) {
      const a = t * 0.0012 + (i * TAU) / 4;
      const cx = x + Math.cos(a) * r, cy = y + Math.sin(a) * r;
      const ix = -Math.cos(a), iy = -Math.sin(a);
      const px = -iy, py = ix;
      ctx.beginPath();
      ctx.moveTo(cx + ix * 9, cy + iy * 9);
      ctx.lineTo(cx + px * 5 - ix * 2, cy + py * 5 - iy * 2);
      ctx.lineTo(cx - px * 5 - ix * 2, cy - py * 5 - iy * 2);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (near > 0.05) {
    const gl = sprite('soft', PALETTE.paleGold);
    if (gl) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * near * 0.45;
      ctx.drawImage(gl, x - rIn * 1.5, y - rIn * 1.5, rIn * 3, rIn * 3);
      ctx.restore();
    }
  }
  ctx.globalAlpha = alpha * appear;
  if (label) labelPill(ctx, x, y, label, { size: Math.max(12, Math.min(16, rIn * 0.45)) });
  ctx.restore();
}

/**
 * True when a newer rating word was drawn at (about) the same ring a moment ago — rapid multi-hit strings put
 * several rings on one target, and only the latest verdict's word should be readable.
 */
function ratingSuperseded(x, y, age) {
  const t = nowMs();
  const marks = LAYOUT.ratings;
  let keep = 0;
  let newer = false;
  for (const m of marks) {
    if (t - m.t > 60) continue;
    marks[keep++] = m;
    if (Math.abs(m.x - x) < 40 && Math.abs(m.y - y) < 40 && m.age < age - 30) newer = true;
  }
  marks.length = keep;
  marks.push({ x, y, age, t });
  return newer;
}

function drawRatingFlourish(ctx, x, y, rIn, rating, age, alpha) {
  const col = QTE_COLORS[rating] || WHITE;
  const u = clamp(age / 520, 0, 1);
  if (u >= 1) return;
  const a = alpha * (1 - u * u);
  const wordAlpha = ratingSuperseded(x, y, age) ? a * 0.18 : a;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (rating === 'perfect') {
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, lerp(rIn, rIn * 2.3, outCubic(u)), 0, TAU);
    glowStroke(ctx, col, 6 * (1 - u) + 1, a, 3);
    ctx.globalAlpha = a;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i * TAU) / 8 + Math.PI / 8;
      const r0 = rIn * lerp(1.05, 1.5, outCubic(u)), r1 = rIn * lerp(1.5, 2.6, outCubic(u));
      ctx.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
      ctx.lineTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
    }
    ctx.stroke();
    const gl = sprite('glow', col);
    if (gl) {
      ctx.globalAlpha = a * Math.pow(1 - u, 2);
      ctx.drawImage(gl, x - rIn * 1.6, y - rIn * 1.6, rIn * 3.2, rIn * 3.2);
    }
  } else if (rating === 'good') {
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, lerp(rIn, rIn * 1.7, outCubic(u)), 0, TAU);
    glowStroke(ctx, col, 4 * (1 - u) + 1, a, 3);
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = col;
    ctx.globalAlpha = a * 0.8;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 6; i++) {
      const a0 = (i * TAU) / 6 + 0.12;
      const drop = u * 14 * (1 + (i % 3) * 0.4);
      ctx.beginPath();
      ctx.arc(x, y + drop, rIn, a0, a0 + TAU / 6 - 0.3);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.save();
  const word = rating === 'perfect' ? 'PERFECT' : rating === 'good' ? 'GOOD' : 'MISS';
  const size = rating === 'perfect' ? 22 : 19;
  ctx.font = font(700, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const pop = lerp(1.3, 1, outBack(clamp(u * 4, 0, 1)));
  const wy = y - rIn - 20 - outCubic(u) * 14;
  const ww = textWidth(ctx.font, word, size) * pop;
  if (wordAlpha > 0.2) layoutPublish(LAYOUT.cover, x - ww / 2, wy - size * 0.6, x + ww / 2, wy + size * 0.6);
  ctx.translate(x, wy);
  ctx.scale(pop, pop);
  ctx.globalAlpha = wordAlpha;
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.strokeText(word, 0, 0);
  ctx.fillStyle = col;
  ctx.fillText(word, 0, 0);
  ctx.restore();
}

/**
 * Defense assist cue for an incoming enemy hit. Each hit type has a distinct SHAPE (colour-blind safe):
 * normal = clean white ring · unparryable = spiked red ring · jump = gold ring + rising chevrons + ground
 * ripple · gradient = rotating violet prism diamond. `feint` draws as normal.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {{progress?:number, type?:string, label?:string, t?:number, radius?:number, alpha?:number, groundY?:number, locked?:boolean}} [o]
 *   progress 0 → 1 = impact (continues to 1.25 for the impact flare). groundY places the jump cue's floor
 *   ripple (default: just below the ring, about where the feet are when the cue sits on the chest).
 *   locked: draw the whiff-lockout state (greyed shape, a red ✕ and "Locked" in place of the key label).
 */
export function drawDefenseCue(ctx, x, y, { progress = 0, type = 'normal', label = '', t = 0, radius = 70, alpha = 1, groundY, locked = false } = {}) {
  const kind = type === 'unparryable' || type === 'jump' || type === 'gradient' ? type : 'normal';
  const isLocked = !!locked;
  if (isLocked) alpha *= 0.55;
  const col = isLocked ? mix(HIT_TYPE_COLORS[kind] || WHITE, '#8f8a86', 0.75) : HIT_TYPE_COLORS[kind] || WHITE;
  const p = clamp(Number(progress) || 0, 0, 1.25);
  const rIn = Math.max(12, radius * 0.3);
  const appear = smoothstep(0, 0.1, p);
  const near = smoothstep(0.65, 1, Math.min(1, p));
  const post = p > 1 ? (p - 1) / 0.25 : 0;
  const a = alpha * appear * (1 - post);
  if (a <= 0.01) return;
  const r = p <= 1 ? lerp(radius, rIn, p) : lerp(rIn, rIn * 1.8, outCubic(post));
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  const bright = mix(col, WHITE, 0.35 + near * 0.4);
  ctx.strokeStyle = bright;
  ctx.fillStyle = bright;

  if (kind === 'normal') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    glowStroke(ctx, bright, 3 + near * 2, a, 3.2);
    ctx.beginPath();
    ctx.arc(x, y, rIn, 0, TAU);
    glowStroke(ctx, bright, 2, a * 0.8, 2.5);
  } else if (kind === 'unparryable') {
    const spikes = 14;
    const rot = t * 0.0009;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const ang = rot + (i * Math.PI) / spikes;
      const rr = i % 2 === 0 ? r + Math.max(6, r * 0.2) : r;
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    glowStroke(ctx, bright, 3 + near * 2, a, 3);
    // danger aura
    const gl = sprite('soft', col);
    if (gl) {
      ctx.globalAlpha = a * (0.25 + 0.2 * Math.sin(t * 0.02));
      ctx.drawImage(gl, x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
    }
    ctx.beginPath();
    ctx.arc(x, y, rIn, 0, TAU);
    glowStroke(ctx, bright, 2.2, a * 0.85, 2.5);
    // "no parry" cross inside the inner ring
    ctx.globalAlpha = a * 0.9;
    ctx.lineWidth = 2.5;
    const k = rIn * 0.45;
    ctx.beginPath();
    ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k);
    ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
    ctx.stroke();
  } else if (kind === 'jump') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    glowStroke(ctx, bright, 3 + near * 2, a, 3);
    ctx.beginPath();
    ctx.arc(x, y, rIn, 0, TAU);
    glowStroke(ctx, bright, 2, a * 0.8, 2.5);
    // rising chevrons above the ring
    for (let i = 0; i < 3; i++) {
      const ph = ((t * 0.0016 + i / 3) % 1);
      const cy = y - rIn - 10 - ph * 40;
      const ca = a * Math.sin(Math.PI * ph);
      const w = 13;
      ctx.globalAlpha = ca;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - w, cy + 7);
      ctx.lineTo(x, cy - 5);
      ctx.lineTo(x + w, cy + 7);
      ctx.stroke();
    }
    // ground ripple
    const gy = groundY != null ? groundY : y + radius * 0.95;
    ctx.beginPath();
    ctx.ellipse(x, gy, r * 1.15, r * 0.24, 0, 0, TAU);
    glowStroke(ctx, bright, 2.5, a * 0.75, 3);
  } else {
    // gradient: prism diamond with chromatic split, slowly rotating
    const rot = Math.PI / 4 + t * 0.0012;
    const diamond = (rr, dx, dy, rr2 = rr) => {
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const ang = rot + (i * TAU) / 4;
        const R2 = i % 2 ? rr2 : rr;
        const px = x + dx + Math.cos(ang) * R2, py = y + dy + Math.sin(ang) * R2;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    const off = 2.5 + near * 2;
    ctx.globalAlpha = a * 0.8;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = PRISM[0];
    diamond(r * 1.12, -off, 0);
    ctx.stroke();
    ctx.strokeStyle = PRISM[4];
    diamond(r * 1.12, off, 0);
    ctx.stroke();
    ctx.strokeStyle = bright;
    diamond(r * 1.12, 0, 0);
    glowStroke(ctx, bright, 3.2 + near * 2, a, 3.2);
    const gl = sprite('soft', col);
    if (gl) {
      ctx.globalAlpha = a * 0.35;
      ctx.drawImage(gl, x - r, y - r, r * 2, r * 2);
    }
    diamond(rIn * 1.15, 0, 0);
    ctx.strokeStyle = bright;
    glowStroke(ctx, bright, 2.2, a * 0.9, 2.5);
    // corner sparkles
    const st = sprite('star', col);
    if (st) {
      for (let i = 0; i < 4; i++) {
        const ang = rot + (i * TAU) / 4;
        const s = 10 + 6 * Math.sin(t * 0.01 + i);
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(st, x + Math.cos(ang) * r * 1.12 - s, y + Math.sin(ang) * r * 1.12 - s, s * 2, s * 2);
      }
    }
  }
  // impact flare
  if (p >= 0.97) {
    const fl = sprite('glow', col);
    if (fl) {
      const k = clamp(1 - post, 0, 1);
      ctx.globalAlpha = alpha * k * 0.8;
      const s = rIn * (1.6 + post * 1.2);
      ctx.drawImage(fl, x - s, y - s, s * 2, s * 2);
    }
  }
  ctx.restore();
  if (isLocked) {
    // Whiff lockout: a red ✕ on the ring and "Locked" in place of the key label.
    const bx = x + rIn * 0.95, by = y - rIn * 0.95, br = 9;
    ctx.save();
    ctx.globalAlpha = Math.min(1, a / 0.55);
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, TAU);
    ctx.fillStyle = 'rgba(30,8,6,0.9)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ff8a76';
    ctx.stroke();
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 4, by - 4); ctx.lineTo(bx + 4, by + 4);
    ctx.moveTo(bx + 4, by - 4); ctx.lineTo(bx - 4, by + 4);
    ctx.stroke();
    labelPill(ctx, x, y + rIn + 16, 'Locked', { size: 13, color: '#ffd0c4', border: '#ff8a76' });
    ctx.restore();
  } else if (label) {
    ctx.save();
    ctx.globalAlpha = a;
    labelPill(ctx, x, y + rIn + 16, label, { size: 13, border: col });
    ctx.restore();
  }
}

/**
 * Animated target marker: a faceted gold arrowhead whose tip points at (x, y) (place it just above a head),
 * with filigree wings, descending echo chevrons and a turning diamond.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {{t?:number, color?:string, scale?:number, alpha?:number}} [o]
 */
export function drawTargetMarker(ctx, x, y, { t = 0, color = PALETTE.gold, scale = 1, alpha = 1 } = {}) {
  const bob = Math.sin(t * 0.006) * 4;
  const k = scale * 1.15;
  ctx.save();
  ctx.translate(x, y - 4 + bob);
  ctx.scale(k, k);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // glow
  const gl = sprite('soft', color);
  if (gl) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * (0.4 + 0.15 * Math.sin(t * 0.008));
    ctx.drawImage(gl, -32, -46, 64, 54);
    ctx.restore();
  }
  // echo chevrons sliding down toward the tip
  for (let i = 0; i < 2; i++) {
    const ph = ((t * 0.0011) + i * 0.5) % 1;
    ctx.save();
    ctx.globalAlpha = alpha * Math.sin(Math.PI * ph) * 0.7;
    ctx.translate(0, -44 + ph * 22);
    ctx.beginPath();
    ctx.moveTo(-9, -5); ctx.lineTo(0, 3); ctx.lineTo(9, -5);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = mix(color, WHITE, 0.3);
    ctx.stroke();
    ctx.restore();
  }
  // filigree wings
  ctx.strokeStyle = mix(color, WHITE, 0.15);
  ctx.lineWidth = 1.6;
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sd * 8, -14);
    ctx.quadraticCurveTo(sd * 22, -24, sd * 20, -12);
    ctx.quadraticCurveTo(sd * 18, -6, sd * 13, -9);
    ctx.stroke();
  }
  // faceted arrowhead
  const tip = () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(12, -17);
    ctx.lineTo(0, -12);
    ctx.lineTo(-12, -17);
    ctx.closePath();
  };
  tip();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.save();
  tip();
  ctx.clip();
  ctx.fillStyle = mix(color, WHITE, 0.55);
  ctx.fillRect(-14, -20, 14, 22);
  ctx.fillStyle = mix(color, '#6a4210', 0.25);
  ctx.fillRect(0, -20, 14, 22);
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(WHITE, 0.75);
  ctx.beginPath();
  ctx.moveTo(0, -1); ctx.lineTo(0, -11);
  ctx.stroke();
  // turning diamond crown
  ctx.translate(0, -27);
  ctx.scale(Math.cos(t * 0.004), 1);
  ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(4.5, 0); ctx.lineTo(0, 6); ctx.lineTo(-4.5, 0);
  ctx.closePath();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = mix(color, WHITE, 0.45);
  ctx.fill();
  ctx.restore();
}

// Delayed "ghost" damage chips, tracked per enemy key (id or name).
const barMemory = new Map();
const GHOST_DELAY = 420;

function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

/**
 * Compact enemy status block. (x, y) is the TOP-CENTRE of the block; returns its size.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {{hp:number, maxHp:number, breakValue?:number, breakMax?:number, shields?:number, broken?:boolean,
 *   statuses?:string[], name?:string, width?:number, id?:string, t?:number, boss?:boolean, alpha?:number, ghostHp?:number}} o
 *   `id` keys the delayed ghost chip (defaults to name); pass `t` (ms clock) for deterministic animation.
 *   The block fades to 30% while floating combat text (or a QTE rating word) drawn this frame overlaps it.
 * @returns {{w:number, h:number}}
 */
export function drawEnemyBars(ctx, x, y, o = {}) {
  const {
    hp = 0, maxHp = 1, breakValue = 0, breakMax = 100, shields = 0, broken = false, statuses = [], name = '',
    width = 140, id, boss = false, alpha = 1,
  } = o;
  const t = o.t != null ? o.t : nowMs();
  const w = boss ? Math.max(width, 260) : width;
  const hpRatio = clamp(maxHp > 0 ? hp / maxHp : 0, 0, 1);
  // ghost chip
  const key = id || name || `${Math.round(x)}`;
  let mem = barMemory.get(key);
  if (!mem) { mem = { hp: hpRatio, ghost: hpRatio, changed: -1e9, last: t, flash: -1e9, fade: 1 }; barMemory.set(key, mem); }
  const dt = clamp(t - mem.last, 0, 100);
  mem.last = t;
  if (hpRatio < mem.hp - 1e-6) { mem.changed = t; mem.flash = t; }
  if (hpRatio > mem.ghost) mem.ghost = hpRatio;
  mem.hp = hpRatio;
  if (t - mem.changed > GHOST_DELAY) mem.ghost = Math.max(hpRatio, mem.ghost - dt * 0.0011 - (mem.ghost - hpRatio) * dt * 0.004);
  const ghost = o.ghostHp != null ? clamp(o.ghostHp / maxHp, hpRatio, 1) : mem.ghost;
  if (barMemory.size > 64) {
    for (const [k, m] of barMemory) { if (t - m.last > 20000) barMemory.delete(k); }
  }

  const left = x - w / 2;
  const nameSize = boss ? 17 : 13;
  const hpH = boss ? 11 : 8;
  const brH = boss ? 6 : 5;
  const rowName = y + nameSize * 0.6;
  const hpY = y + nameSize + 5;
  const brY = hpY + hpH + 3;
  const stY = brY + brH + 5;

  // Fade out of the way while combat text (numbers, status words, QTE ratings) passes over the block.
  const blockBottom = (Array.isArray(o.statuses) && o.statuses.length ? stY + (boss ? 18 : 16) : brY + brH) + 2;
  let covered = false;
  for (const r of layoutFresh(LAYOUT.cover)) {
    if (r.x1 > left - 2 && r.x0 < left + w + 2 && r.y1 > y - 2 && r.y0 < blockBottom) { covered = true; break; }
  }
  mem.fade = (mem.fade ?? 1) + ((covered ? 0.3 : 1) - (mem.fade ?? 1)) * clamp(dt / (covered ? 36 : 180), 0, 1);

  ctx.save();
  ctx.globalAlpha = alpha * mem.fade;
  ctx.lineJoin = 'round';

  // --- name + shield pips ---
  const pipW = 10, pipGap = 3;
  const pipCount = Math.max(0, Math.round(shields));
  const drawnPips = pipCount > 6 ? 1 : pipCount;
  const pipsW = drawnPips ? drawnPips * (pipW + pipGap) + (pipCount > 6 ? 22 : 0) : 0;
  if (name) {
    const avail = w - pipsW - 4;
    let size = nameSize;
    ctx.font = font(700, size);
    const label = boss ? name.toUpperCase() : name;
    let tw = ctx.measureText(label).width;
    if (tw > avail && tw > 0) { size = Math.max(9, size * (avail / tw)); ctx.font = font(700, size); tw = ctx.measureText(label).width; }
    ctx.textBaseline = 'middle';
    ctx.textAlign = boss ? 'center' : 'left';
    const nx = boss ? x - pipsW / 2 : left;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = rgba(INK, 0.9);
    ctx.strokeText(label, nx, rowName);
    ctx.fillStyle = PALETTE.ivory;
    ctx.fillText(label, nx, rowName);
    if (boss) {
      ctx.strokeStyle = rgba(PALETTE.gold, 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nx - tw / 2 - 30, rowName); ctx.lineTo(nx - tw / 2 - 8, rowName);
      ctx.moveTo(nx + tw / 2 + 8, rowName); ctx.lineTo(nx + tw / 2 + 30, rowName);
      ctx.stroke();
    }
  }
  if (drawnPips) {
    let px = left + w - pipsW;
    for (let i = 0; i < drawnPips; i++) {
      shieldPip(ctx, px + pipW / 2, rowName, pipW);
      px += pipW + pipGap;
    }
    if (pipCount > 6) {
      ctx.font = font(700, 12);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.strokeText(`×${pipCount}`, px, rowName + 1);
      ctx.fillStyle = PALETTE.shield;
      ctx.fillText(`×${pipCount}`, px, rowName + 1);
    }
  }

  // --- HP bar ---
  barFrame(ctx, left, hpY, w, hpH);
  const inner = w - 2;
  if (ghost > hpRatio) {
    ctx.fillStyle = 'rgba(255, 236, 200, 0.85)';
    ctx.fillRect(left + 1 + inner * hpRatio, hpY + 1, inner * (ghost - hpRatio), hpH - 2);
  }
  if (hpRatio > 0) {
    const g = ctx.createLinearGradient(0, hpY, 0, hpY + hpH);
    g.addColorStop(0, '#f08a7a');
    g.addColorStop(0.45, '#c8403a');
    g.addColorStop(1, '#7a1a18');
    ctx.fillStyle = g;
    ctx.fillRect(left + 1, hpY + 1, inner * hpRatio, hpH - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(left + 1, hpY + 1, inner * hpRatio, 1.5);
    const fl = clamp(1 - (t - mem.flash) / 180, 0, 1);
    if (fl > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.6 * fl})`;
      ctx.fillRect(left + 1, hpY + 1, inner * hpRatio, hpH - 2);
    }
  }
  // quarter ticks
  ctx.fillStyle = 'rgba(16,12,10,0.55)';
  for (let i = 1; i < 4; i++) ctx.fillRect(left + (w * i) / 4, hpY + 1, 1, hpH - 2);

  // --- break bar ---
  const bMax = breakMax > 0 ? breakMax : 100;
  const bRatio = broken ? 1 : clamp(breakValue / bMax, 0, 1);
  barFrame(ctx, left, brY, w, brH);
  if (bRatio > 0) {
    const hot = !broken && bRatio >= 0.75;
    const pulse = broken ? 0.5 + 0.5 * Math.sin(t * 0.018) : hot ? 0.5 + 0.5 * Math.sin(t * 0.012) : 0;
    const g = ctx.createLinearGradient(0, brY, 0, brY + brH);
    g.addColorStop(0, broken ? mix('#ffe2a8', WHITE, pulse * 0.7) : '#ffd08a');
    g.addColorStop(1, broken ? mix(PALETTE.breakBar, '#ffffff', pulse * 0.4) : PALETTE.breakBar);
    ctx.fillStyle = g;
    ctx.fillRect(left + 1, brY + 1, inner * bRatio, brH - 2);
    if (hot || broken) {
      const gl = sprite('soft', PALETTE.breakBar);
      if (gl) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * mem.fade * (broken ? 0.4 + pulse * 0.5 : 0.18 + pulse * 0.32);
        ctx.drawImage(gl, left - 10, brY - 10, w * bRatio + 20, brH + 20);
        ctx.restore();
      }
    }
  }
  if (broken) {
    ctx.font = font(900, 11);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    const by = brY + brH / 2 + 0.5;
    ctx.strokeText('BROKEN', x, by);
    ctx.fillStyle = '#fff3d0';
    ctx.fillText('BROKEN', x, by);
  }

  // --- statuses ---
  let h = brY + brH - y;
  const list = Array.isArray(statuses) ? statuses : [];
  if (list.length) {
    const size = boss ? 18 : 16;
    let sx = left;
    for (const sid of list.slice(0, Math.floor(w / (size + 2)))) {
      const ic = iconCanvas('status', sid, size);
      if (ic) ctx.drawImage(ic, sx, stY, size, size);
      sx += size + 2;
    }
    h = stY + size - y;
  }
  ctx.restore();
  return { w, h };
}

function barFrame(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(12, 8, 6, 0.82)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.strokeStyle = 'rgba(224, 180, 88, 0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
}

function shieldPip(ctx, cx, cy, w) {
  const h = w * 1.18;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy - h * 0.3);
  ctx.lineTo(cx + w * 0.45, cy + h * 0.08);
  ctx.quadraticCurveTo(cx + w * 0.3, cy + h * 0.38, cx, cy + h / 2);
  ctx.quadraticCurveTo(cx - w * 0.3, cy + h * 0.38, cx - w * 0.45, cy + h * 0.08);
  ctx.lineTo(cx - w / 2, cy - h * 0.3);
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  g.addColorStop(0, '#e8f6ff');
  g.addColorStop(1, '#4f8fc8');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.stroke();
}

/** Resets the ghost-chip memory used by drawEnemyBars (call when a battle ends). */
export function resetEnemyBars() { barMemory.clear(); }
