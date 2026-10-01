// Procedural painterly sprite system for Expedition 69: shared painting kit, humanoid / quadruped
// rigs, keyframed animation library, compositing (flash, tint, aura, alpha, broken) and the public
// API (drawActor, anchors, bounds, weak points, portraits). Looks live in ./looks/*.js.

import { PALETTE } from './palette.js';
import { definePartyLooks } from './looks/party.js';
import { defineShoreLooks } from './looks/shore.js';
import { defineThicketLooks } from './looks/thicket.js';
import { defineSpireLooks } from './looks/spire.js';
import { defineSummitLooks } from './looks/summit.js';
import { defineTrainingLooks } from './looks/training.js';

// ---------------------------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------------------------

/** Every drawable look id (3 party members + all enemies from SPEC §3.7). */
export const LOOK_IDS = [
  'gideon', 'nyra', 'sable',
  'driftling', 'shellguard', 'tidecaller', 'wreck_warden',
  'thornstag', 'mime', 'bloomwitch', 'bellwether',
  'coghound', 'sentinel', 'hourwraith',
  'stillkeeper', 'dummy',
];

/** Animation ids understood by drawActor. */
export const ANIM_IDS = ['idle', 'run', 'walk', 'windup', 'strike', 'recover', 'hurt', 'dodge', 'parry',
  'jump', 'cast', 'shoot', 'aim', 'guard', 'ko', 'victory'];

/** Party skill animation variants (SPEC §3.7). */
export const PARTY_VARIANTS = ['slash', 'thrust', 'flurry', 'heavy', 'leap', 'spin', 'cast', 'buff', 'heal', 'shoot', 'gradient'];

/** Enemy attack animation variants (SPEC §3.7). */
export const ENEMY_VARIANTS = ['slash', 'thrust', 'slam', 'bite', 'spin', 'charge', 'bolt', 'wave', 'beam', 'nova', 'cast'];

/** Aura telegraph colours (outline + glow) keyed by pose.aura. */
export const AURA_COLORS = { red: '#ff3b2f', gold: '#ffc83a', gradient: '#c77dff', white: '#ffffff' };

// ---------------------------------------------------------------------------------------------
// Math, easing, hashing
// ---------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const D = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Deterministic hash → [0,1). */
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

const EASE = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => { const u = t - 1; return u * u * u + 1; },
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  outBack: (t) => { const c = 1.70158; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; },
  inBack: (t) => { const c = 1.70158; return (c + 1) * t * t * t - c * t * t; },
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  hold: () => 0,
};

// ---------------------------------------------------------------------------------------------
// Colour helpers (cached; painterly: shadows lean violet, highlights lean warm gold)
// ---------------------------------------------------------------------------------------------

const SHADOW_RGB = [34, 22, 44];
const LIGHT_RGB = [255, 242, 212];
const _rgb = new Map();
const _cache = new Map();

function rgbOf(c) {
  let v = _rgb.get(c);
  if (v) return v;
  let r = 255, g = 255, b = 255;
  if (typeof c === 'string' && c[0] === '#') {
    if (c.length === 4) {
      r = parseInt(c[1] + c[1], 16); g = parseInt(c[2] + c[2], 16); b = parseInt(c[3] + c[3], 16);
    } else {
      r = parseInt(c.slice(1, 3), 16); g = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16);
    }
  } else if (typeof c === 'string') {
    const m = c.match(/[\d.]+/g);
    if (m && m.length >= 3) { r = +m[0]; g = +m[1]; b = +m[2]; }
  }
  v = [r || 0, g || 0, b || 0];
  _rgb.set(c, v);
  return v;
}
const h2 = (n) => { const v = clamp(Math.round(n), 0, 255); return (v < 16 ? '0' : '') + v.toString(16); };
function cacheGet(key, make) {
  let v = _cache.get(key);
  if (v === undefined) {
    if (_cache.size > 6000) _cache.clear();
    v = make();
    _cache.set(key, v);
  }
  return v;
}
/** Lighten (k>0, toward warm light) or darken (k<0, toward violet shadow) a colour. */
function shade(c, k) {
  if (!k) return c;
  const kk = Math.round(k * 100) / 100;
  return cacheGet('s' + c + kk, () => {
    const [r, g, b] = rgbOf(c);
    const T = kk < 0 ? SHADOW_RGB : LIGHT_RGB;
    const a = Math.min(1, Math.abs(kk));
    return '#' + h2(r + (T[0] - r) * a) + h2(g + (T[1] - g) * a) + h2(b + (T[2] - b) * a);
  });
}
/** CSS rgba() string for a colour with alpha. */
function rgba(c, a) {
  const aa = Math.round(clamp(a, 0, 1) * 100) / 100;
  return cacheGet('a' + c + aa, () => { const [r, g, b] = rgbOf(c); return `rgba(${r | 0},${g | 0},${b | 0},${aa})`; });
}
/** Linear mix of two colours → hex. */
function mix(a, b, t) {
  const tt = Math.round(clamp(t, 0, 1) * 100) / 100;
  if (tt <= 0) return a;
  if (tt >= 1) return b;
  return cacheGet('m' + a + b + tt, () => {
    const A = rgbOf(a), B = rgbOf(b);
    return '#' + h2(lerp(A[0], B[0], tt)) + h2(lerp(A[1], B[1], tt)) + h2(lerp(A[2], B[2], tt));
  });
}
/** HSL → hex (used for prismatic gradient effects). */
function hsl(hh, s, l) {
  const key = 'h' + Math.round(hh) + '|' + Math.round(s * 100) + '|' + Math.round(l * 100);
  return cacheGet(key, () => {
    const h = (((hh % 360) + 360) % 360) / 360;
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return '#' + h2(f(0) * 255) + h2(f(8) * 255) + h2(f(4) * 255);
  });
}

// ---------------------------------------------------------------------------------------------
// Offscreen resources (created lazily; never touches the DOM at import time)
// ---------------------------------------------------------------------------------------------

function makeCanvas(w, h, preferDom = false) {
  if (typeof document !== 'undefined' && document.createElement && (preferDom || typeof OffscreenCanvas === 'undefined')) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

const _glowSprites = new Map();
function glowSprite(color) {
  let s = _glowSprites.get(color);
  if (s !== undefined) return s;
  s = makeCanvas(128, 128);
  if (s) {
    const g = s.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(color, 1));
    gr.addColorStop(0.18, rgba(color, 0.62));
    gr.addColorStop(0.45, rgba(color, 0.2));
    gr.addColorStop(0.75, rgba(color, 0.05));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  _glowSprites.set(color, s);
  return s;
}

let _shadowSprite;
function shadowSprite() {
  if (_shadowSprite !== undefined) return _shadowSprite;
  _shadowSprite = makeCanvas(128, 64);
  if (_shadowSprite) {
    const g = _shadowSprite.getContext('2d');
    g.save();
    g.scale(1, 0.5);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(10,6,4,0.62)');
    gr.addColorStop(0.55, 'rgba(10,6,4,0.36)');
    gr.addColorStop(1, 'rgba(10,6,4,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    g.restore();
  }
  return _shadowSprite;
}

// ---------------------------------------------------------------------------------------------
// Painting kit (shared by every look). Paths are built by the caller; paint() shades them.
// Light comes from screen top-right; st.lx/st.ly hold its direction in the current local frame.
// ---------------------------------------------------------------------------------------------

const INK = 'rgba(21,14,12,0.6)';
const RIM = '#ffe9bf';

function setLight(st, ang) {
  if (!ang) { st.lx = st.blx; st.ly = st.bly; return; }
  const c = Math.cos(-ang), s = Math.sin(-ang);
  st.lx = st.blx * c - st.bly * s;
  st.ly = st.blx * s + st.bly * c;
}
/** Enter a translated + rotated local frame (keeps lighting world-consistent). */
function frame(ctx, st, x, y, ang = 0, sx = 1, sy = 1) {
  ctx.save();
  ctx.translate(x, y);
  if (ang) ctx.rotate(ang);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  st._fa.push(st._ang);
  st._ang += ang;
  setLight(st, st._ang);
  if (sx < 0) st.lx = -st.lx;
  if (sy < 0) st.ly = -st.ly;
}
function unframe(ctx, st) {
  ctx.restore();
  st._ang = st._fa.length ? st._fa.pop() : 0;
  setLight(st, st._ang);
}

/** Linear light gradient across a shape centred at (cx,cy) with radius r. */
function lit(ctx, c, cx, cy, r, st, k0 = -0.42, k1 = 0.3) {
  const g = ctx.createLinearGradient(cx - st.lx * r, cy - st.ly * r, cx + st.lx * r, cy + st.ly * r);
  g.addColorStop(0, shade(c, k0));
  g.addColorStop(0.52, c);
  g.addColorStop(1, shade(c, k1));
  return g;
}
/** Radial "sphere" light gradient (heads, orbs, shells). */
function litR(ctx, c, cx, cy, r, st, k0 = -0.45, k1 = 0.34) {
  const g = ctx.createRadialGradient(cx + st.lx * r * 0.45, cy + st.ly * r * 0.45, r * 0.08, cx, cy, r * 1.08);
  g.addColorStop(0, shade(c, k1));
  g.addColorStop(0.45, c);
  g.addColorStop(1, shade(c, k0));
  return g;
}
/** Stroke the current path with a rim light that only shows on the lit side. */
function rim(ctx, cx, cy, r, st, a = 0.8, w = 1, color = RIM) {
  const g = ctx.createLinearGradient(cx, cy, cx + st.lx * r, cy + st.ly * r);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.5, rgba(color, 0));
  g.addColorStop(1, rgba(color, a));
  ctx.strokeStyle = g;
  ctx.lineWidth = st.olw * 1.1 * w;
  ctx.stroke();
}
/** Outline → lit fill → rim for the current path. */
function paint(ctx, c, cx, cy, r, st, ol = 1, rimA = 0.75, k0 = -0.42, k1 = 0.3) {
  if (st.ghost) { ctx.fillStyle = c; ctx.fill(); return; }
  if (ol > 0) { ctx.lineWidth = st.olw * 2 * ol; ctx.strokeStyle = st.ink; ctx.stroke(); }
  ctx.fillStyle = lit(ctx, c, cx, cy, r, st, k0, k1);
  ctx.fill();
  if (rimA > 0) rim(ctx, cx, cy, r, st, rimA);
}
/** paint() for long thin shapes along the axis (x0,y0)→(x1,y1): shading runs across the axis. */
function paintAxis(ctx, c, x0, y0, x1, y1, r, st, ol = 1, rimA = 0.75, k0 = -0.42, k1 = 0.32) {
  if (st.ghost) { ctx.fillStyle = c; ctx.fill(); return; }
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
  let nx = -dy / d, ny = dx / d;
  if (nx * st.lx + ny * st.ly < 0) { nx = -nx; ny = -ny; }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  if (ol > 0) { ctx.lineWidth = st.olw * 2 * ol; ctx.strokeStyle = st.ink; ctx.stroke(); }
  const g = ctx.createLinearGradient(mx - nx * r, my - ny * r, mx + nx * r, my + ny * r);
  g.addColorStop(0, shade(c, k0));
  g.addColorStop(0.55, c);
  g.addColorStop(1, shade(c, k1));
  ctx.fillStyle = g;
  ctx.fill();
  if (rimA > 0) {
    const g2 = ctx.createLinearGradient(mx, my, mx + nx * r, my + ny * r);
    g2.addColorStop(0, rgba(RIM, 0));
    g2.addColorStop(0.5, rgba(RIM, 0));
    g2.addColorStop(1, rgba(RIM, rimA));
    ctx.strokeStyle = g2;
    ctx.lineWidth = st.olw * 1.1;
    ctx.stroke();
  }
}
/** Same as paint() with a spherical radial gradient. */
function paintR(ctx, c, cx, cy, r, st, ol = 1, rimA = 0.75, k0 = -0.45, k1 = 0.34) {
  if (st.ghost) { ctx.fillStyle = c; ctx.fill(); return; }
  if (ol > 0) { ctx.lineWidth = st.olw * 2 * ol; ctx.strokeStyle = st.ink; ctx.stroke(); }
  ctx.fillStyle = litR(ctx, c, cx, cy, r, st, k0, k1);
  ctx.fill();
  if (rimA > 0) rim(ctx, cx, cy, r, st, rimA);
}
/** Flat fill (optionally with alpha). */
function fill(ctx, c, a = 1) { ctx.fillStyle = a < 1 ? rgba(c, a) : c; ctx.fill(); }
/** Simple stroke of the current path. */
function stroke(ctx, c, w, a = 1, cap = 'round') {
  ctx.strokeStyle = a < 1 ? rgba(c, a) : c;
  ctx.lineWidth = w;
  ctx.lineCap = cap;
  ctx.stroke();
}
/** Tapered capsule path between two points. */
function capsule(ctx, x0, y0, x1, y1, r0, r1) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.arc(x0, y0, r0, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(x1, y1, r1, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
}
/** Cylindrically shaded limb segment. */
function limb(ctx, x0, y0, x1, y1, r0, r1, c, st, ol = 1, rimA = 0.7) {
  capsule(ctx, x0, y0, x1, y1, r0, r1);
  if (st.ghost) { ctx.fillStyle = c; ctx.fill(); return; }
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
  let nx = -dy / d, ny = dx / d;
  if (nx * st.lx + ny * st.ly < 0) { nx = -nx; ny = -ny; }
  const r = Math.max(r0, r1);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  if (ol > 0) { ctx.lineWidth = st.olw * 2 * ol; ctx.strokeStyle = st.ink; ctx.stroke(); }
  const g = ctx.createLinearGradient(mx - nx * r, my - ny * r, mx + nx * r, my + ny * r);
  g.addColorStop(0, shade(c, -0.45));
  g.addColorStop(0.55, c);
  g.addColorStop(1, shade(c, 0.26));
  ctx.fillStyle = g;
  ctx.fill();
  if (rimA > 0) {
    const g2 = ctx.createLinearGradient(mx, my, mx + nx * r, my + ny * r);
    g2.addColorStop(0, rgba(RIM, 0));
    g2.addColorStop(0.55, rgba(RIM, 0));
    g2.addColorStop(1, rgba(RIM, rimA));
    ctx.strokeStyle = g2;
    ctx.lineWidth = st.olw * 1.1;
    ctx.stroke();
  }
}
function ell(ctx, cx, cy, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); }
function circ(ctx, cx, cy, r) { ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.01, r), 0, TAU); }
/** Polygon path from a flat coordinate list; `close` defaults to true. */
function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (close) ctx.closePath();
}
/** Smooth closed blob through points (quadratic midpoints). */
function blob(ctx, pts) {
  const n = pts.length / 2;
  ctx.beginPath();
  const mx0 = (pts[0] + pts[(n - 1) * 2]) / 2, my0 = (pts[1] + pts[(n - 1) * 2 + 1]) / 2;
  ctx.moveTo(mx0, my0);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    const j = ((i + 1) % n) * 2;
    ctx.quadraticCurveTo(x, y, (x + pts[j]) / 2, (y + pts[j + 1]) / 2);
  }
  ctx.closePath();
}
/** Line path. */
function line(ctx, x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
/** Quadratic curve path. */
function curve(ctx, x0, y0, cx, cy, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); }

/** Additive soft glow (cached sprite). */
function glow(ctx, x, y, r, color, a = 1) {
  if (a <= 0.003 || r <= 0.5) return;
  const s = glowSprite(color);
  if (!s) return;
  const pa = ctx.globalAlpha, pc = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pa * Math.min(1, a);
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = pa;
  ctx.globalCompositeOperation = pc;
}
/** Soft, normally-blended puff (smoke, mist, dust) using the cached radial sprite. */
function puff(ctx, x, y, r, color, a = 1) {
  if (a <= 0.003 || r <= 0.5) return;
  const s = glowSprite(color);
  if (!s) return;
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = pa * Math.min(1, a);
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = pa;
}
/** Additive four-point star glint. */
function star(ctx, x, y, r, color, a = 1, rot = 0) {
  if (a <= 0.003 || r <= 0.5) return;
  const pa = ctx.globalAlpha, pc = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pa * Math.min(1, a);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = rot + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.16;
    const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = pa;
  ctx.globalCompositeOperation = pc;
  glow(ctx, x, y, r * 0.9, color, a * 0.8);
}
/** Jagged additive lightning arc from (x0,y0) to (x1,y1). `seed` changes the shape. */
function bolt(ctx, x0, y0, x1, y1, seed, color, w = 1.6, jag = 0.22, a = 1) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d, ny = dx / d;
  const segs = 6;
  const pc = ctx.globalCompositeOperation, pa = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pa * a;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i < segs; i++) {
    const u = i / segs;
    const off = (hash(seed * 13.1 + i * 7.7) - 0.5) * 2 * jag * d * Math.sin(u * Math.PI);
    ctx.lineTo(x0 + dx * u + nx * off, y0 + dy * u + ny * off);
  }
  ctx.lineTo(x1, y1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(color, 0.35);
  ctx.lineWidth = w * 3.2;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.globalAlpha = pa;
  ctx.globalCompositeOperation = pc;
}
/** Branching crack lines around (cx,cy). */
function cracks(ctx, cx, cy, r, seed, color, w = 1.4, a = 1, glowC = null) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let k = 0; k < 4; k++) {
    let ang = hash(seed + k * 3.3) * TAU;
    let x = cx, y = cy;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const n = 4;
    for (let i = 0; i < n; i++) {
      ang += (hash(seed + k * 9.1 + i) - 0.5) * 1.3;
      const len = r * (0.22 + hash(seed * 2 + k + i * 1.7) * 0.2);
      x += Math.cos(ang) * len; y += Math.sin(ang) * len;
      ctx.lineTo(x, y);
    }
    if (glowC) { ctx.strokeStyle = rgba(glowC, 0.45 * a); ctx.lineWidth = w * 3; ctx.stroke(); }
    ctx.strokeStyle = rgba(color, a);
    ctx.lineWidth = w;
    ctx.stroke();
  }
}
/** Rising / orbiting additive motes (deterministic in t). */
function motes(ctx, cx, cy, spread, rise, n, t, color, size = 2, a = 1, seed = 0) {
  for (let i = 0; i < n; i++) {
    const h = hash(seed + i * 17.3);
    const life = 1400 + h * 900;
    const u = ((t + h * life) % life) / life;
    const x = cx + (hash(seed + i * 5.1) - 0.5) * spread + Math.sin(u * 6 + i) * spread * 0.08;
    const y = cy - u * rise;
    glow(ctx, x, y, size * (2.4 - u), color, a * Math.sin(u * Math.PI));
  }
}
/** Soft ellipse ground shadow. */
function groundShadow(ctx, x, y, rx, ry, a = 1) {
  const s = shadowSprite();
  if (!s || a <= 0.01) return;
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = pa * a;
  ctx.drawImage(s, x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = pa;
}
/**
 * Cached part bitmap. Renders draw(g, st) once into an offscreen canvas at the current device
 * resolution (bucketed) and blits it afterwards. The part's local origin sits at (ax, ay) inside a
 * bw×bh box (local units). `id` must encode every visual input of the part (look, part, state).
 */
const _sprites = new Map();
function sprite(ctx, st, id, bw, bh, ax, ay, draw) {
  if (st.portrait || !(st.R > 0)) { draw(ctx, st); return; }
  const Rq = Math.max(0.25, Math.ceil(st.R * 4 - 0.15) / 4);
  const key = id + '|' + (st.blx >= 0 ? 1 : 0) + '|' + Rq;
  let e = _sprites.get(key);
  if (!e) {
    const cw = Math.ceil(bw * Rq) + 4, chh = Math.ceil(bh * Rq) + 4;
    const c = makeCanvas(cw, chh);
    if (!c) { draw(ctx, st); return; }
    const g = c.getContext('2d');
    g.setTransform(Rq, 0, 0, Rq, ax * Rq + 2, ay * Rq + 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const lx = st.lx, ly = st.ly, fa = st._fa, an = st._ang, gh = st.ghost;
    st._fa = []; st._ang = 0; st.ghost = false;
    setLight(st, 0);
    try { draw(g, st); } finally { st.lx = lx; st.ly = ly; st._fa = fa; st._ang = an; st.ghost = gh; }
    e = { c, ox: ax + 2 / Rq, oy: ay + 2 / Rq, w: cw / Rq, h: chh / Rq };
    if (_sprites.size > 400) _sprites.delete(_sprites.keys().next().value);
    _sprites.set(key, e);
  }
  ctx.drawImage(e.c, -e.ox, -e.oy, e.w, e.h);
}

/** Point helpers. */
const dirX = (a) => Math.cos(a);
const dirY = (a) => Math.sin(a);

/**
 * Boot / foot shape at the ankle (ax, ay), toe toward +x. `hgt` is the ankle height (sole sits at
 * ay + hgt). `lift` = sole clearance above the ground in px; tilts the toes down when airborne.
 */
function foot(ctx, ax, ay, len, hgt, c, st, lift = 0, ol = 1) {
  const ang = clamp(lift / 18, 0, 1) * 0.5;
  frame(ctx, st, ax, ay, ang);
  ctx.beginPath();
  ctx.moveTo(-hgt * 0.75, -hgt * 0.9);
  ctx.quadraticCurveTo(-hgt * 1.15, hgt * 0.95, -hgt * 0.45, hgt);
  ctx.lineTo(len * 0.9, hgt);
  ctx.quadraticCurveTo(len * 1.1, hgt * 0.95, len * 1.02, hgt * 0.15);
  ctx.quadraticCurveTo(len * 0.62, -hgt * 0.6, hgt * 0.55, -hgt * 1.05);
  ctx.closePath();
  paint(ctx, c, len * 0.3, 0, len * 0.6, st, ol, 0.6);
  unframe(ctx, st);
}
/**
 * Tapered strip path along a centre polyline `pts` (flat [x0,y0,x1,y1,...]); width goes w0 → w1.
 * Used for ribbons, tentacles, smoke tails and cloth streamers.
 */
function strip(ctx, pts, w0, w1) {
  const n = pts.length / 2;
  if (n < 2) return;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    const dx = pts[i1 * 2] - pts[i0 * 2], dy = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
    const d = Math.hypot(dx, dy) || 1;
    const w = lerp(w0, w1, i / (n - 1)) / 2;
    const nx = -dy / d * w, ny = dx / d * w;
    L.push(pts[i * 2] + nx, pts[i * 2 + 1] + ny);
    R.push(pts[i * 2] - nx, pts[i * 2 + 1] - ny);
  }
  ctx.beginPath();
  ctx.moveTo(L[0], L[1]);
  for (let i = 1; i < n; i++) {
    const mx = (L[(i - 1) * 2] + L[i * 2]) / 2, my = (L[(i - 1) * 2 + 1] + L[i * 2 + 1]) / 2;
    ctx.quadraticCurveTo(L[(i - 1) * 2], L[(i - 1) * 2 + 1], mx, my);
  }
  ctx.lineTo(L[(n - 1) * 2], L[(n - 1) * 2 + 1]);
  ctx.lineTo(R[(n - 1) * 2], R[(n - 1) * 2 + 1]);
  for (let i = n - 2; i >= 0; i--) {
    const mx = (R[(i + 1) * 2] + R[i * 2]) / 2, my = (R[(i + 1) * 2 + 1] + R[i * 2 + 1]) / 2;
    ctx.quadraticCurveTo(R[(i + 1) * 2], R[(i + 1) * 2 + 1], mx, my);
  }
  ctx.lineTo(R[0], R[1]);
  ctx.closePath();
}
/** Smooth open polyline path through points (for strokes). */
function polyline(ctx, pts) {
  const n = pts.length / 2;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i * 2] + pts[i * 2 + 2]) / 2, my = (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2;
    ctx.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], mx, my);
  }
  ctx.lineTo(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
}
/**
 * Big armoured mitt at the end of a forearm e→h (used by the giants). `k` scales the ~22 px mitt;
 * `cuffC` draws a cuff band at the wrist when given.
 */
function mitt(ctx, e, h, st, c, k = 1, cuffC = null) {
  const a = Math.atan2(h.y - e.y, h.x - e.x);
  frame(ctx, st, h.x, h.y, a, k, k);
  ctx.beginPath();
  ctx.moveTo(-6, -15); ctx.quadraticCurveTo(14, -18, 22, -6); ctx.quadraticCurveTo(26, 4, 20, 12); ctx.quadraticCurveTo(8, 17, -6, 14); ctx.closePath();
  paint(ctx, c, 8, 0, 18, st, 1.2, 0.8);
  for (let i = 0; i < 3; i++) { curve(ctx, 12 + i * 3, -13 + i * 2, 18 + i * 2, -2, 12 + i * 3, 11 - i); stroke(ctx, shade(c, -0.35), 1.6, 0.6); }
  ell(ctx, 4, -14, 7, 5, -0.4); paint(ctx, shade(c, 0.05), 4, -14, 7, st, 1, 0.6);
  if (cuffC) { ctx.beginPath(); ctx.rect(-10, -15, 6, 30); paintAxis(ctx, cuffC, -10, 0, -4, 0, 8, st, 0.8, 0.4); }
  unframe(ctx, st);
}
/** Round hand / fist. */
function hand(ctx, x, y, r, c, st, ol = 1) { circ(ctx, x, y, r); paintR(ctx, c, x, y, r, st, ol, 0.6); }
/** Mechanic state helper: returns the mechanic object if its type matches. */
function mech(st, type) { const m = st.mechanic; return m && m.type === type ? m : null; }
/** Sole clearance of a humanoid ankle point (0 when planted). */
function liftOf(J, ay, ankle) { return Math.max(0, -(ay + ankle)); }
/** Point along segment a→b at u, written into o. */
function along(o, ax, ay, bx, by, u) { o.x = ax + (bx - ax) * u; o.y = ay + (by - ay) * u; return o; }

// ---------------------------------------------------------------------------------------------
// Animation machinery: field lists, pose books → keyframe tracks, evaluation
// ---------------------------------------------------------------------------------------------

function fieldIndex(fields) { const o = {}; fields.forEach((f, i) => { o[f] = i; }); return o; }

/** Resolve a partial pose (object) into a full Float64Array over `base`. */
function resolvePose(look, pose, base = look._ready) {
  const v = new Float64Array(base);
  if (pose) {
    for (const k in pose) {
      const i = look.fi[k];
      if (i !== undefined && typeof pose[k] === 'number') v[i] = pose[k];
    }
  }
  return v;
}
function lerpArr(a, b, t) { const v = new Float64Array(a.length); for (let i = 0; i < a.length; i++) v[i] = a[i] + (b[i] - a[i]) * t; return v; }
function withFields(look, arr, over) { const v = new Float64Array(arr); for (const k in over) { const i = look.fi[k]; if (i !== undefined) v[i] = over[k]; } return v; }
/** Push a pose further away from `ref` (anticipation deepening during holds). */
function extrapolate(look, a, ref, k) {
  const v = new Float64Array(a);
  for (let i = 0; i < v.length; i++) if (!look.noExtrap.has(look.fields[i])) v[i] = a[i] + (a[i] - ref[i]) * k;
  return v;
}
const key = (p, v, e = 'inOutQuad') => ({ p, v, e: EASE[e] || EASE.inOutQuad });

function evalTrack(track, p, out) {
  const n = track.length;
  if (n === 1 || p <= track[0].p) { out.set(track[0].v); return; }
  if (p >= track[n - 1].p) { out.set(track[n - 1].v); return; }
  let i = 1;
  while (i < n - 1 && track[i].p < p) i++;
  const a = track[i - 1], b = track[i];
  const u = b.e((p - a.p) / (b.p - a.p || 1));
  const av = a.v, bv = b.v;
  for (let j = 0; j < out.length; j++) out[j] = av[j] + (bv[j] - av[j]) * u;
}

/** Build (and cache) the keyframe track for anim/variant from the look's pose book. */
function getTrack(look, anim, variant) {
  const k = anim + '|' + (variant || '');
  let tr = look._tracks.get(k);
  if (!tr) {
    tr = buildTrack(look, anim, variant);
    look._tracks.set(k, tr);
  }
  return tr;
}

function variantDef(look, variant) {
  const V = look.book.variants;
  if (variant && V[variant]) return V[variant];
  const alias = look.variantAlias && look.variantAlias[variant];
  if (alias && V[alias]) return V[alias];
  return V[look.defaultVariant] || V.slash || V[Object.keys(V)[0]];
}

function variantPoses(look, V) {
  const R = look._ready;
  const A = resolvePose(look, V.a);
  const C = resolvePose(look, V.c);
  const F = resolvePose(look, V.f || V.c);
  const fi = look.fi;
  if (V.gather) {
    A[fi.ch] = V.a.ch ?? 0.75; C[fi.ch] = V.c.ch ?? 0.2; C[fi.rel] = V.c.rel ?? 1;
    F[fi.ch] = (V.f && V.f.ch) ?? 0; F[fi.rel] = (V.f && V.f.rel) ?? 0;
  }
  const A2 = extrapolate(look, A, R, V.deepen ?? 0.12);
  if (V.gather) A2[fi.ch] = 1;
  const S = lerpArr(F, R, 0.18);
  S[fi.rel] = 0; S[fi.ch] = 0;
  return { R, A, A2, C, F, S };
}

function mkKeys(look, list) {
  return list.map(([p, pose, e]) => key(p, pose instanceof Float64Array ? pose : resolvePose(look, pose), e));
}

function buildTrack(look, anim, variant) {
  const B = look.book;
  const R = look._ready;
  const fi = look.fi;
  const P = (pose) => resolvePose(look, pose);
  if (B.tracks && B.tracks[anim]) {
    const t = B.tracks[anim];
    const list = Array.isArray(t) ? t : (t[variant] || t.default);
    if (list) return mkKeys(look, list);
  }
  switch (anim) {
    case 'guard': { const G = P(B.guard); return [key(0, R), key(0.25, G, 'outCubic'), key(1, G)]; }
    case 'parry': {
      const Pa = P(B.parry);
      const Pf = withFields(look, Pa, { rel: 1 });
      return [key(0, R), key(0.09, Pf, 'outQuad'), key(0.38, Pa, 'linear'), key(1, R, 'inOutQuad')];
    }
    case 'dodge': {
      const Dd = P(B.dodge);
      const D2 = lerpArr(Dd, R, 0.18);
      return [key(0, R), key(0.26, Dd, 'outCubic'), key(0.58, D2, 'linear'), key(1, R, 'inOutQuad')];
    }
    case 'hurt': {
      const H = P(B.hurt);
      return [key(0, lerpArr(R, H, 0.72)), key(0.12, H, 'outQuad'), key(0.35, lerpArr(H, R, 0.2)), key(1, R, 'inOutQuad')];
    }
    case 'jump': {
      const J = B.jump;
      return [key(0, R), key(0.14, P(J.crouch), 'outQuad'), key(0.26, P(J.up), 'outQuad'), key(0.52, P(J.tuck), 'inOutQuad'),
        key(0.8, P(J.up), 'inOutQuad'), key(0.9, P(J.land), 'outQuad'), key(1, R, 'inOutQuad')];
    }
    case 'cast': {
      const G = withFields(look, P(B.cast.g), { ch: 0.7 });
      const G2 = withFields(look, extrapolate(look, G, R, 0.1), { ch: 1 });
      const Rl = withFields(look, P(B.cast.r), { rel: 1, ch: 0.2 });
      const Rf = withFields(look, P(B.cast.r), { rel: 0, ch: 0 });
      return [key(0, R), key(0.35, G, 'outCubic'), key(0.72, G2), key(0.8, Rl, 'inCubic'), key(1, Rf, 'outQuad')];
    }
    case 'aim': { const A = P(look.shootHand === 'far' ? B.aimFar : B.aimNear); return [key(0, A)]; }
    case 'shoot': {
      const A = P(look.shootHand === 'far' ? B.aimFar : B.aimNear);
      const Rc = recoilPose(look, A);
      return [key(0, Rc), key(0.28, A, 'outQuad'), key(1, A)];
    }
    case 'ko': {
      const H = P(B.hurt), Ka = P(B.ko.a), Kb = P(B.ko.b);
      return [key(0, H), key(0.3, Ka, 'inOutQuad'), key(0.62, Kb, 'inOutCubic'), key(1, Kb)];
    }
    case 'victory': { const V = P(B.victory); return [key(0, R), key(0.32, V, 'outBack'), key(1, V)]; }
    case 'windup': case 'strike': case 'recover': return buildVariantTrack(look, anim, variant);
    case 'idle': default: return [key(0, R)];
  }
}

function recoilPose(look, A) {
  const fi = look.fi;
  const v = new Float64Array(A);
  if (look.rig === 'humanoid') {
    if (look.shootHand === 'far') { v[fi.fhy] -= 0.16; v[fi.fhx] -= 0.06; v[fi.w2] -= 0.35; } else { v[fi.nhy] -= 0.16; v[fi.nhx] -= 0.06; v[fi.w] -= 0.35; }
    v[fi.lean] -= 0.07; v[fi.hd] -= 0.06; v[fi.rx] -= 0.03;
  } else if (fi.hd !== undefined) { v[fi.hd] -= 0.2; }
  v[fi.rel] = 1;
  return v;
}

function buildVariantTrack(look, anim, variant) {
  const V = variantDef(look, variant);
  const fi = look.fi;
  if (V.shoot) {
    const A = resolvePose(look, look.shootHand === 'far' ? look.book.aimFar : look.book.aimNear);
    const R = look._ready;
    const Rc = recoilPose(look, A);
    if (anim === 'windup') return [key(0, R), key(0.55, A, 'outCubic'), key(0.97, A), key(1, Rc, 'linear')];
    if (anim === 'strike') return [key(0, Rc), key(0.3, A, 'outQuad'), key(1, A)];
    return [key(0, A), key(1, R, 'inOutCubic')];
  }
  const { R, A, A2, C, F, S } = variantPoses(look, V);
  if (anim === 'windup') {
    if (V.windup) return mkKeys(look, V.windup.map(([p, pose, e]) => [p, pose === 'A' ? A : pose === 'A2' ? A2 : pose === 'C' ? C : pose === 'R' ? R : pose, e]));
    return [key(0, R), key(0.42, A, 'outCubic'), key(0.86, A2, 'inOutQuad'), key(1, C, V.snap || 'inCubic')];
  }
  if (anim === 'strike') {
    if (V.strike) return mkKeys(look, V.strike.map(([p, pose, e]) => [p, pose === 'C' ? C : pose === 'F' ? F : pose === 'S' ? S : pose, e]));
    if (V.sustain) {
      const Cs = withFields(look, C, { rel: 0.75, ch: 0.6 });
      return [key(0, C), key(0.15, Cs, 'outQuad'), key(0.72, Cs, 'linear'), key(1, F, 'inOutQuad')];
    }
    return [key(0, C), key(0.3, F, 'outCubic'), key(1, S, 'inOutQuad')];
  }
  // recover
  const from = V.recoverFrom === 'F' ? F : S;
  const f2 = new Float64Array(from); f2[fi.rel] = 0; f2[fi.ch] = 0;
  return [key(0, f2), key(1, R, 'inOutCubic')];
}

// ---------------------------------------------------------------------------------------------
// Humanoid rig
// ---------------------------------------------------------------------------------------------
// Pose fields (normalised so one library fits every proportion):
//   rx, ry      root (hip) offset in leg-length units (ry > 0 crouches)
//   lean, hd    torso lean (rad, + forward) and head tilt offset
//   nhx/nhy     near-hand target relative to near shoulder (arm-length units, actor space)
//   fhx/fhy     far-hand target relative to far shoulder
//   nfx/nfy     near foot (leg units; x from origin, y height above ground); ffx/ffy far foot
//   w, w2       weapon angle (absolute, rad, 0 = forward) and secondary item angle
//   ne, fe      elbow bend sign;  two = far hand grips the weapon (0..1)
//   sx          horizontal body scale (spins);  ch/rel = charge glow / release flash
//   cape        cloth flare;  ja = jaw/mouth open;  air = vertical lift (leg units);  ex = look extra

const HUMAN_FIELDS = ['rx', 'ry', 'lean', 'hd', 'nhx', 'nhy', 'fhx', 'fhy', 'nfx', 'nfy', 'ffx', 'ffy',
  'w', 'w2', 'ne', 'fe', 'two', 'sx', 'ch', 'rel', 'cape', 'ja', 'air', 'ex'];
const HI = fieldIndex(HUMAN_FIELDS);
const HUMAN_NOEX = new Set(['ne', 'fe', 'two', 'sx', 'ch', 'rel', 'ja', 'air', 'ex', 'nfy', 'ffy']);

const HUMAN_READY = { rx: 0, ry: 0.05, lean: 0.06, hd: 0, nhx: 0.3, nhy: 0.62, fhx: 0.4, fhy: 0.45, nfx: -0.2, nfy: 0, ffx: 0.26, ffy: 0,
  w: -60 * D, w2: 0, ne: 1, fe: 1, two: 0, sx: 1, ch: 0, rel: 0, cape: 0, ja: 0, air: 0, ex: 0 };

const HUMAN_BOOK = {
  guard: { ry: 0.12, lean: 0.0, hd: 0.05, nhx: 0.42, nhy: 0.22, w: -100 * D, fhx: 0.55, fhy: 0.1, nfx: -0.3, ffx: 0.3 },
  parry: { rx: -0.04, ry: 0.13, lean: -0.06, hd: -0.04, nhx: 0.6, nhy: 0.02, w: -112 * D, fhx: 0.32, fhy: 0.34, nfx: -0.34, ffx: 0.24 },
  dodge: { rx: -0.38, ry: 0.15, lean: -0.36, hd: -0.2, nhx: -0.12, nhy: 0.62, w: -18 * D, fhx: 0.22, fhy: 0.5, nfx: -0.62, ffx: -0.06, ffy: 0.07, cape: 1 },
  hurt: { rx: -0.12, ry: 0.12, lean: -0.34, hd: -0.42, nhx: -0.22, nhy: 0.55, w: -8 * D, fhx: -0.04, fhy: 0.28, nfx: -0.3, ffx: 0.16, cape: 0.8 },
  cast: {
    g: { nhx: 0.3, nhy: -0.55, w: -85 * D, fhx: 0.55, fhy: 0.05, lean: -0.06, ry: 0.08 },
    r: { nhx: 0.82, nhy: -0.25, w: -35 * D, fhx: 0.85, fhy: -0.05, lean: 0.12, rx: 0.05 },
  },
  aimFar: { fhx: 0.97, fhy: -0.04, nhx: 0.14, nhy: 0.78, w: 100 * D, lean: 0.0, hd: 0.02, nfx: -0.26, ffx: 0.28, ry: 0.07, w2: 0 },
  aimNear: { nhx: 0.97, nhy: -0.04, w: -2 * D, fhx: 0.25, fhy: 0.55, lean: 0.0, hd: 0.02, nfx: -0.26, ffx: 0.28, ry: 0.07 },
  ko: {
    a: { ry: 0.4, lean: 0.45, hd: 0.45, nhx: 0.3, nhy: 0.85, w: 120 * D, fhx: 0.35, fhy: 0.8, nfx: -0.45, ffx: 0.28 },
    b: { ry: 0.5, lean: 0.64, hd: 0.62, nhx: 0.46, nhy: 0.8, w: 168 * D, fhx: 0.5, fhy: 0.9, nfx: -0.52, nfy: 0, ffx: 0.3, ffy: 0 },
  },
  victory: { nhx: 0.25, nhy: -0.9, w: -95 * D, fhx: 0.4, fhy: 0.5, lean: -0.08, hd: -0.15, ry: 0.02 },
  jump: {
    crouch: { ry: 0.3, lean: 0.28, nhx: 0.15, nhy: 0.75, fhx: 0.2, fhy: 0.65, nfx: -0.18, ffx: 0.22 },
    up: { ry: 0.0, lean: 0.04, nhx: 0.32, nhy: -0.2, fhx: 0.45, fhy: -0.3, nfx: -0.12, nfy: 0.02, ffx: 0.14, ffy: 0.05 },
    tuck: { ry: 0.24, lean: 0.14, hd: 0.05, nhx: 0.45, nhy: 0.32, fhx: 0.5, fhy: 0.22, nfx: -0.12, nfy: 0.34, ffx: 0.2, ffy: 0.3 },
    land: { ry: 0.32, lean: 0.3, nhx: 0.3, nhy: 0.7, fhx: 0.42, fhy: 0.55, nfx: -0.25, ffx: 0.28 },
  },
  carry: { nhx: 0.2, nhy: 0.66, w: -125 * D, fhx: 0.3, fhy: 0.55 },
  variants: {
    slash: {
      a: { rx: -0.06, ry: 0.12, lean: -0.2, hd: -0.05, nhx: -0.28, nhy: -0.62, w: -150 * D, fhx: 0.55, fhy: 0.08, nfx: -0.34, ffx: 0.3, cape: 0.3 },
      c: { rx: 0.2, ry: 0.17, lean: 0.38, hd: 0.1, nhx: 0.85, nhy: 0.3, w: 25 * D, fhx: -0.2, fhy: 0.55, nfx: -0.42, ffx: 0.52, cape: 0.8 },
      f: { rx: 0.22, ry: 0.15, lean: 0.42, hd: 0.08, nhx: 0.4, nhy: 0.82, w: 105 * D, fhx: -0.25, fhy: 0.5, nfx: -0.42, ffx: 0.52, cape: 0.4 },
    },
    thrust: {
      a: { rx: -0.14, ry: 0.15, lean: -0.1, nhx: -0.42, nhy: 0.28, w: -4 * D, fhx: 0.55, fhy: -0.08, nfx: -0.36, ffx: 0.2, cape: 0.2 },
      c: { rx: 0.3, ry: 0.21, lean: 0.28, hd: 0.06, nhx: 1.0, nhy: 0.03, w: 0, fhx: -0.6, fhy: 0.2, nfx: -0.42, ffx: 0.64, cape: 1 },
      f: { rx: 0.32, ry: 0.2, lean: 0.3, nhx: 0.92, nhy: 0.1, w: 6 * D, fhx: -0.55, fhy: 0.25, nfx: -0.42, ffx: 0.64, cape: 0.6 },
    },
    flurry: {
      a: { rx: -0.08, ry: 0.14, lean: -0.05, nhx: -0.3, nhy: 0.25, w: -6 * D, fhx: 0.5, fhy: 0.0, nfx: -0.34, ffx: 0.24 },
      c: { rx: 0.22, ry: 0.18, lean: 0.24, nhx: 0.98, nhy: 0.0, w: -4 * D, fhx: -0.45, fhy: 0.25, nfx: -0.4, ffx: 0.55, cape: 0.8 },
      f: { rx: 0.2, ry: 0.17, lean: 0.22, nhx: 0.85, nhy: 0.15, w: 10 * D, fhx: -0.4, fhy: 0.3, nfx: -0.4, ffx: 0.55, cape: 0.4 },
      strike: [
        [0, 'C'],
        [0.13, { rx: 0.14, ry: 0.17, lean: 0.14, nhx: 0.35, nhy: 0.2, w: -12 * D, fhx: -0.4, fhy: 0.25, nfx: -0.4, ffx: 0.52, cape: 0.5 }, 'outQuad'],
        [0.26, { rx: 0.24, ry: 0.19, lean: 0.26, nhx: 1.0, nhy: -0.12, w: -12 * D, fhx: -0.45, fhy: 0.22, nfx: -0.4, ffx: 0.56, cape: 0.9 }, 'inQuad'],
        [0.4, { rx: 0.15, ry: 0.17, lean: 0.14, nhx: 0.38, nhy: 0.1, w: 4 * D, fhx: -0.4, fhy: 0.25, nfx: -0.4, ffx: 0.52, cape: 0.5 }, 'outQuad'],
        [0.54, { rx: 0.25, ry: 0.2, lean: 0.28, nhx: 1.0, nhy: 0.14, w: 8 * D, fhx: -0.46, fhy: 0.24, nfx: -0.4, ffx: 0.57, cape: 0.9 }, 'inQuad'],
        [0.68, { rx: 0.16, ry: 0.17, lean: 0.16, nhx: 0.4, nhy: 0.05, w: -6 * D, fhx: -0.4, fhy: 0.25, nfx: -0.4, ffx: 0.52, cape: 0.5 }, 'outQuad'],
        [0.8, 'C', 'inQuad'],
        [1, 'S', 'inOutQuad'],
      ],
    },
    heavy: {
      a: { rx: -0.1, ry: 0.0, lean: -0.3, hd: -0.15, nhx: -0.05, nhy: -0.98, w: -125 * D, two: 1, fhx: 0.1, fhy: -0.9, nfx: -0.3, ffx: 0.28, ffy: 0.04 },
      c: { rx: 0.2, ry: 0.33, lean: 0.55, hd: 0.22, nhx: 0.8, nhy: 0.55, w: 50 * D, two: 1, nfx: -0.45, ffx: 0.55, cape: 0.9 },
      f: { rx: 0.2, ry: 0.35, lean: 0.58, hd: 0.25, nhx: 0.62, nhy: 0.8, w: 80 * D, two: 1, nfx: -0.45, ffx: 0.55, cape: 0.4 },
    },
    leap: {
      a: { rx: 0.1, air: 1.05, ry: 0.12, lean: -0.1, hd: -0.1, nhx: -0.05, nhy: -0.95, w: -120 * D, two: 1, fhx: 0.1, fhy: -0.9, nfx: -0.12, nfy: 0.25, ffx: 0.3, ffy: 0.35, cape: 1 },
      c: { rx: 0.35, air: 0.18, ry: 0.2, lean: 0.5, hd: 0.2, nhx: 0.8, nhy: 0.5, w: 55 * D, two: 1, nfx: -0.1, nfy: 0.1, ffx: 0.55, ffy: 0.05, cape: 1 },
      f: { rx: 0.35, air: 0, ry: 0.36, lean: 0.55, hd: 0.22, nhx: 0.7, nhy: 0.78, w: 78 * D, two: 1, nfx: -0.25, nfy: 0, ffx: 0.6, ffy: 0, cape: 0.5 },
      windup: [
        [0, 'R'],
        [0.3, { ry: 0.34, lean: 0.36, hd: 0.05, nhx: 0.1, nhy: 0.72, w: 150 * D, fhx: 0.3, fhy: 0.6, nfx: -0.3, ffx: 0.3, cape: 0.2 }, 'outCubic'],
        [0.55, { rx: 0.05, air: 0.85, ry: 0.05, lean: 0.05, nhx: 0.05, nhy: -0.7, w: -100 * D, two: 1, fhx: 0.2, fhy: -0.6, nfx: -0.2, nfy: 0.12, ffx: 0.25, ffy: 0.25, cape: 1 }, 'outQuad'],
        [0.82, 'A', 'outQuad'],
        [1, 'C', 'inCubic'],
      ],
      strike: [[0, 'C'], [0.16, 'F', 'outQuad'], [1, 'S', 'inOutQuad']],
    },
    spin: {
      a: { rx: -0.05, ry: 0.2, lean: 0.12, hd: 0.12, nhx: -0.55, nhy: 0.3, w: 175 * D, fhx: 0.45, fhy: 0.3, nfx: -0.3, ffx: 0.3 },
      c: { rx: 0.15, ry: 0.16, lean: 0.2, nhx: 0.92, nhy: 0.28, w: 12 * D, fhx: -0.4, fhy: 0.3, nfx: -0.35, ffx: 0.42, cape: 1 },
      f: { rx: 0.15, ry: 0.15, lean: 0.12, nhx: 0.5, nhy: 0.7, w: 95 * D, fhx: -0.3, fhy: 0.4, nfx: -0.35, ffx: 0.42, cape: 0.5 },
      windup: [
        [0, 'R'], [0.42, 'A', 'outCubic'], [0.8, 'A2', 'inOutQuad'],
        [0.9, { rx: 0.08, ry: 0.18, lean: 0.16, nhx: 0.9, nhy: 0.3, w: 12 * D, fhx: -0.4, fhy: 0.3, nfx: -0.33, ffx: 0.38, sx: -1, cape: 1 }, 'linear'],
        [1, 'C', 'linear'],
      ],
      strike: [
        [0, 'C'],
        [0.11, { rx: 0.18, ry: 0.16, lean: 0.2, nhx: 0.92, nhy: 0.3, w: 14 * D, fhx: -0.4, fhy: 0.3, nfx: -0.35, ffx: 0.42, sx: -1, cape: 1 }, 'linear'],
        [0.22, { rx: 0.2, ry: 0.16, lean: 0.2, nhx: 0.92, nhy: 0.28, w: 12 * D, fhx: -0.4, fhy: 0.3, nfx: -0.35, ffx: 0.42, sx: 1, cape: 1 }, 'linear'],
        [0.45, 'F', 'outCubic'],
        [1, 'S', 'inOutQuad'],
      ],
    },
    cast: {
      a: { nhx: 0.2, nhy: -0.92, w: -90 * D, fhx: 0.45, fhy: 0.18, lean: -0.1, hd: -0.12, ry: 0.08 },
      c: { nhx: 0.88, nhy: -0.22, w: -22 * D, fhx: 0.2, fhy: 0.4, lean: 0.15, rx: 0.05 },
      f: { nhx: 0.82, nhy: -0.1, w: -10 * D, fhx: 0.25, fhy: 0.45, lean: 0.12, rx: 0.05 },
      gather: true,
    },
    buff: {
      a: { nhx: 0.25, nhy: 0.05, w: -90 * D, fhx: 0.28, fhy: 0.18, ry: 0.12, lean: 0.06, hd: 0.1 },
      c: { nhx: 0.3, nhy: -0.92, w: -92 * D, fhx: 0.55, fhy: -0.7, lean: -0.14, hd: -0.25, ry: 0.0 },
      f: { nhx: 0.3, nhy: -0.85, w: -92 * D, fhx: 0.5, fhy: -0.55, lean: -0.1, hd: -0.2 },
      gather: true,
    },
    heal: {
      a: { nhx: 0.42, nhy: 0.35, w: -80 * D, fhx: 0.5, fhy: 0.3, lean: 0.12, hd: 0.2, ry: 0.1 },
      c: { nhx: 0.55, nhy: -0.45, w: -70 * D, fhx: 0.72, fhy: -0.38, lean: -0.08, hd: -0.15 },
      f: { nhx: 0.52, nhy: -0.35, w: -72 * D, fhx: 0.68, fhy: -0.3, lean: -0.06, hd: -0.12 },
      gather: true,
    },
    shoot: { shoot: true, a: {}, c: {} },
    gradient: {
      a: { rx: -0.08, ry: 0.3, lean: 0.22, hd: 0.05, nhx: -0.72, nhy: 0.3, w: 172 * D, fhx: 0.72, fhy: 0.0, nfx: -0.45, ffx: 0.35, cape: 0.6 },
      c: { rx: 0.42, ry: 0.25, lean: 0.45, hd: 0.1, nhx: 0.97, nhy: 0.15, w: 10 * D, fhx: -0.5, fhy: 0.35, nfx: -0.5, ffx: 0.7, cape: 1 },
      f: { rx: 0.42, ry: 0.26, lean: 0.5, hd: 0.12, nhx: 0.5, nhy: 0.78, w: 110 * D, fhx: -0.45, fhy: 0.4, nfx: -0.5, ffx: 0.7, cape: 0.5 },
      gather: true,
    },
    slam: {
      a: { rx: -0.05, ry: -0.04, lean: -0.26, hd: -0.22, nhx: 0.0, nhy: -1.0, w: -112 * D, two: 1, fhx: 0.1, fhy: -0.95, nfx: -0.28, ffx: 0.25, ffy: 0.06 },
      c: { rx: 0.12, ry: 0.36, lean: 0.56, hd: 0.25, nhx: 0.72, nhy: 0.72, w: 72 * D, two: 1, nfx: -0.4, ffx: 0.45, cape: 0.9 },
      f: { rx: 0.12, ry: 0.38, lean: 0.6, hd: 0.28, nhx: 0.68, nhy: 0.82, w: 82 * D, two: 1, nfx: -0.4, ffx: 0.45, cape: 0.4 },
    },
    bite: {
      a: { rx: -0.12, ry: 0.08, lean: -0.32, hd: -0.45, ja: 1, nhx: -0.2, nhy: 0.35, w: -30 * D, fhx: 0.05, fhy: 0.35, nfx: -0.34, ffx: 0.22 },
      c: { rx: 0.28, ry: 0.15, lean: 0.6, hd: 0.3, ja: 0, nhx: 0.55, nhy: 0.5, w: 10 * D, fhx: 0.65, fhy: 0.45, nfx: -0.4, ffx: 0.55, cape: 1 },
      f: { rx: 0.28, ry: 0.15, lean: 0.55, hd: 0.2, ja: 0.15, nhx: 0.5, nhy: 0.55, w: 20 * D, fhx: 0.6, fhy: 0.5, nfx: -0.4, ffx: 0.55, cape: 0.5 },
    },
    charge: {
      a: { rx: -0.16, ry: 0.32, lean: 0.58, hd: -0.15, nhx: 0.1, nhy: 0.62, w: 8 * D, fhx: 0.3, fhy: 0.45, nfx: -0.56, ffx: 0.24, cape: 0.5 },
      c: { rx: 0.42, ry: 0.16, lean: 0.62, hd: -0.05, nhx: 0.72, nhy: 0.22, w: 0, fhx: 0.25, fhy: 0.3, nfx: -0.5, nfy: 0.1, ffx: 0.62, ffy: 0.03, cape: 1 },
      f: { rx: 0.38, ry: 0.18, lean: 0.45, nhx: 0.6, nhy: 0.35, w: 10 * D, fhx: 0.3, fhy: 0.35, nfx: -0.45, ffx: 0.55, cape: 0.6 },
    },
    bolt: {
      a: { rx: -0.08, ry: 0.1, lean: -0.14, hd: -0.05, nhx: -0.38, nhy: -0.4, w: -120 * D, fhx: 0.62, fhy: 0.0, nfx: -0.3, ffx: 0.28 },
      c: { rx: 0.1, ry: 0.12, lean: 0.22, hd: 0.05, nhx: 0.95, nhy: -0.1, w: -8 * D, fhx: -0.2, fhy: 0.45, nfx: -0.34, ffx: 0.4 },
      f: { rx: 0.1, ry: 0.12, lean: 0.2, nhx: 0.85, nhy: 0.05, w: 5 * D, fhx: -0.1, fhy: 0.5, nfx: -0.34, ffx: 0.4 },
      gather: true,
    },
    wave: {
      a: { ry: -0.02, lean: -0.2, hd: -0.15, nhx: 0.08, nhy: -0.95, w: -100 * D, two: 1, fhx: 0.25, fhy: -0.9, nfx: -0.25, ffx: 0.22, ffy: 0.3 },
      c: { ry: 0.32, lean: 0.45, hd: 0.2, nhx: 0.62, nhy: 0.78, w: 82 * D, two: 1, fhx: 0.65, fhy: 0.78, nfx: -0.32, ffx: 0.36, ffy: 0 },
      f: { ry: 0.33, lean: 0.47, hd: 0.22, nhx: 0.6, nhy: 0.82, w: 85 * D, two: 1, fhx: 0.62, fhy: 0.8, nfx: -0.32, ffx: 0.36 },
      gather: true,
    },
    beam: {
      a: { rx: -0.05, ry: 0.14, lean: -0.06, nhx: 0.25, nhy: 0.28, w: -40 * D, fhx: 0.3, fhy: 0.25, nfx: -0.32, ffx: 0.3 },
      c: { rx: 0.08, ry: 0.14, lean: 0.22, nhx: 0.95, nhy: 0.0, w: -5 * D, fhx: 1.0, fhy: -0.02, nfx: -0.36, ffx: 0.38 },
      f: { rx: 0.06, ry: 0.13, lean: 0.18, nhx: 0.9, nhy: 0.06, w: -3 * D, fhx: 0.92, fhy: 0.05, nfx: -0.36, ffx: 0.38 },
      gather: true, sustain: true,
    },
    nova: {
      a: { ry: 0.26, lean: 0.35, hd: 0.35, nhx: 0.15, nhy: 0.35, w: -60 * D, fhx: 0.1, fhy: 0.3, nfx: -0.26, ffx: 0.22 },
      c: { ry: -0.02, lean: -0.24, hd: -0.3, nhx: -0.55, nhy: -0.6, w: -140 * D, fhx: 0.75, fhy: -0.62, nfx: -0.32, ffx: 0.34 },
      f: { ry: 0.0, lean: -0.2, hd: -0.25, nhx: -0.5, nhy: -0.5, w: -135 * D, fhx: 0.7, fhy: -0.55, nfx: -0.32, ffx: 0.34 },
      gather: true,
    },
  },
};

/** Deep-merge a look's book overrides over a base book (pose objects merge field-wise). */
function mergeBook(base, over) {
  const out = {};
  for (const k in base) {
    if (k === 'variants') continue;
    const b = base[k], o = over[k];
    if (o === undefined) { out[k] = b; continue; }
    if (b && typeof b === 'object' && !Array.isArray(b) && Object.values(b).some((v) => v && typeof v === 'object')) {
      out[k] = {};
      for (const kk in b) out[k][kk] = { ...b[kk], ...(o[kk] || {}) };
      for (const kk in o) if (!(kk in out[k])) out[k][kk] = o[kk];
    } else out[k] = { ...b, ...o };
  }
  for (const k in over) if (!(k in out) && k !== 'variants') out[k] = over[k];
  out.variants = {};
  const bv = base.variants || {}, ov = over.variants || {};
  for (const v of new Set([...Object.keys(bv), ...Object.keys(ov)])) {
    const b = bv[v] || {}, o = ov[v] || {};
    out.variants[v] = { ...b, ...o, a: { ...(b.a || {}), ...(o.a || {}) }, c: { ...(b.c || {}), ...(o.c || {}) }, f: { ...(b.f || b.c || {}), ...(o.f || {}) } };
    if (o.replace) out.variants[v] = { ...o };
  }
  return out;
}

function pt() { return { x: 0, y: 0 }; }
function newHumanJ() {
  return { hip: pt(), neck: pt(), head: pt(), sN: pt(), eN: pt(), hN: pt(), sF: pt(), eF: pt(), hF: pt(),
    pN: pt(), kN: pt(), fN: pt(), pF: pt(), kF: pt(), fF: pt(), tip: pt(),
    lean: 0, headA: 0, w: 0, w2: 0, sx: 1, ch: 0, rel: 0, cape: 0, ja: 0, ex: 0, two: 0, air: 0, rootX: 0, P: null };
}

const _ik = { jx: 0, jy: 0, ex: 0, ey: 0 };
/** Two-bone IK: joint from a toward b with lengths l1/l2; sign picks the bend side. */
function ik(ax, ay, bx, by, l1, l2, sign) {
  let dx = bx - ax, dy = by - ay;
  let d = Math.hypot(dx, dy);
  const maxd = (l1 + l2) * 0.999;
  if (d < 1e-4) { dx = 0; dy = 1; d = 1e-4; }
  if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; }
  const mind = Math.abs(l1 - l2) + 0.5;
  if (d < mind) { dx *= mind / d; dy *= mind / d; d = mind; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  const s = clamp(sign, -1, 1);
  _ik.jx = ax + ux * a - uy * hh * s;
  _ik.jy = ay + uy * a + ux * hh * s;
  _ik.ex = ax + dx;
  _ik.ey = ay + dy;
  return _ik;
}

function solveHuman(look, P, J) {
  const b = look.body;
  const L = b.L, A = b.A;
  const air = P[HI.air] * L;
  const hx = P[HI.rx] * L, hy = -b.hipH + P[HI.ry] * L - air;
  J.P = P;
  J.air = air;
  J.rootX = hx;
  J.hip.x = hx; J.hip.y = hy;
  const lean = P[HI.lean];
  J.lean = lean;
  const ux = Math.sin(lean), uy = -Math.cos(lean);
  const nx = Math.cos(lean), ny = Math.sin(lean);
  J.neck.x = hx + ux * b.torso; J.neck.y = hy + uy * b.torso;
  const na = lean * 0.7 + P[HI.hd] * 0.35;
  const hr = b.neck + b.headR * 0.85;
  J.head.x = J.neck.x + Math.sin(na) * hr;
  J.head.y = J.neck.y - Math.cos(na) * hr;
  J.headA = lean * 0.45 + P[HI.hd];
  const sbx = J.neck.x - ux * b.shDrop, sby = J.neck.y - uy * b.shDrop;
  J.sN.x = sbx + nx * b.shN; J.sN.y = sby + ny * b.shN;
  J.sF.x = sbx + nx * b.shF; J.sF.y = sby + ny * b.shF;
  // near arm
  let r = ik(J.sN.x, J.sN.y, J.sN.x + P[HI.nhx] * A, J.sN.y + P[HI.nhy] * A, b.upper, b.fore, P[HI.ne]);
  J.eN.x = r.jx; J.eN.y = r.jy; J.hN.x = r.ex; J.hN.y = r.ey;
  let w = P[HI.w];
  // floor constraint: weapons never pass through the ground (reach = full weapon length incl. heads)
  const reach = b.wreach || b.wlen;
  if (Math.sin(w) * reach + J.hN.y > -2 && J.hN.y < -4) {
    const v = clamp((-2 - J.hN.y) / reach, -1, 1);
    const a = Math.asin(v);
    w = Math.cos(w) >= 0 ? a : Math.PI - a;
  }
  J.w = w; J.w2 = P[HI.w2];
  J.tip.x = J.hN.x + Math.cos(w) * b.wlen; J.tip.y = J.hN.y + Math.sin(w) * b.wlen;
  // far arm (optionally gripping the weapon)
  let tx = J.sF.x + P[HI.fhx] * A, ty = J.sF.y + P[HI.fhy] * A;
  const two = P[HI.two] * (look.twoHand || 0);
  J.two = two;
  if (two > 0.001) {
    const gx = J.hN.x + Math.cos(w) * b.grip, gy = J.hN.y + Math.sin(w) * b.grip;
    tx = lerp(tx, gx, two); ty = lerp(ty, gy, two);
  }
  r = ik(J.sF.x, J.sF.y, tx, ty, b.upper, b.fore, P[HI.fe]);
  J.eF.x = r.jx; J.eF.y = r.jy; J.hF.x = r.ex; J.hF.y = r.ey;
  // legs
  J.pN.x = hx + nx * b.hipN; J.pN.y = hy + ny * b.hipN;
  J.pF.x = hx + nx * b.hipF; J.pF.y = hy + ny * b.hipF;
  r = ik(J.pN.x, J.pN.y, P[HI.nfx] * L, -P[HI.nfy] * L - b.ankle - air, b.thigh, b.shin, -1);
  J.kN.x = r.jx; J.kN.y = r.jy; J.fN.x = r.ex; J.fN.y = r.ey;
  r = ik(J.pF.x, J.pF.y, P[HI.ffx] * L, -P[HI.ffy] * L - b.ankle - air, b.thigh, b.shin, -1);
  J.kF.x = r.jx; J.kF.y = r.jy; J.fF.x = r.ex; J.fF.y = r.ey;
  J.sx = P[HI.sx]; J.ch = P[HI.ch]; J.rel = P[HI.rel]; J.cape = P[HI.cape]; J.ja = P[HI.ja]; J.ex = P[HI.ex];
}

function humanLocomotion(look, P, run, phase) {
  P.set(look._carry);
  const a = phase * TAU;
  const s = Math.sin(a), c = Math.cos(a);
  const S = run ? 0.54 : 0.32, Hh = run ? 0.42 : 0.15;
  P[HI.lean] += run ? 0.3 : 0.06;
  P[HI.ry] = (run ? 0.12 : 0.05) + (run ? 0.07 : 0.025) * Math.cos(2 * a);
  P[HI.air] += run ? 0.05 * Math.max(0, -Math.cos(2 * a)) : 0;
  P[HI.rx] = run ? 0.04 : 0;
  P[HI.nfx] = S * s + 0.03; P[HI.nfy] = Hh * Math.pow(Math.max(0, c), 1.3);
  P[HI.ffx] = -S * s + 0.03; P[HI.ffy] = Hh * Math.pow(Math.max(0, -c), 1.3);
  const sw = look.armSwing * (run ? 1 : 0.6);
  P[HI.nhx] += -sw * s; P[HI.nhy] += -Math.abs(s) * sw * 0.2;
  P[HI.fhx] += sw * s; P[HI.fhy] += -Math.abs(s) * sw * 0.2;
  P[HI.w] += 0.1 * s;
  P[HI.hd] += run ? -0.12 : 0;
  P[HI.cape] = run ? 0.75 + 0.2 * Math.sin(2 * a) : 0.2 + 0.1 * Math.sin(2 * a);
  P[HI.ex] = phase;
}

function humanBreathe(look, P, st, amt) {
  const b = Math.sin(st.t * (TAU / 2900) + st.seed);
  P[HI.ry] += 0.009 * b * amt;
  P[HI.nhy] += 0.014 * b * amt;
  P[HI.fhy] += 0.016 * b * amt;
  P[HI.lean] += 0.012 * b * amt;
  P[HI.w] += 0.025 * b * amt;
  if (look.floating) P[HI.air] += (0.05 + 0.04 * Math.sin(st.t * (TAU / 2300) + st.seed)) * Math.max(amt, 0.6);
}
function humanTremble(look, P, st, k) {
  const j = Math.sin(st.t * 0.083 + st.seed) * k, j2 = Math.sin(st.t * 0.061 + 1.3 + st.seed) * k;
  P[HI.rx] += j * 0.01; P[HI.w] += j2 * 0.04; P[HI.nhy] += j * 0.015; P[HI.fhy] += j2 * 0.015;
}
function humanSlump(look, P) { P[HI.ry] += 0.07; P[HI.lean] += 0.16; P[HI.hd] += 0.3; P[HI.nhy] += 0.12; P[HI.fhy] += 0.12; P[HI.w] += 0.4; }

function humanAnchors(look, J, o) {
  const b = look.body;
  o.head.x = J.head.x; o.head.y = J.head.y;
  o.chest.x = lerp(J.hip.x, J.neck.x, 0.66); o.chest.y = lerp(J.hip.y, J.neck.y, 0.66);
  const f = look.weaponFocus;
  o.weapon.x = J.hN.x + Math.cos(J.w) * b.wlen * f; o.weapon.y = J.hN.y + Math.sin(J.w) * b.wlen * f;
  o.feet.x = (J.fN.x + J.fF.x) / 2; o.feet.y = Math.max(J.fN.y, J.fF.y) + b.ankle;
  o.top.x = J.head.x; o.top.y = J.head.y - b.headR - (look.topExtra || 0);
  o.center.x = lerp(J.hip.x, J.neck.x, 0.4); o.center.y = lerp(J.hip.y, J.neck.y, 0.4);
  o.tip.x = J.tip.x; o.tip.y = J.tip.y;
}
function humanBounds(look, J, o) {
  const b = look.body;
  const bw = b.bw;
  const x0 = Math.min(J.hip.x, J.neck.x, J.head.x) - bw, x1 = Math.max(J.hip.x, J.neck.x, J.head.x) + bw;
  o[0] = x0; o[1] = J.head.y - b.headR - (look.topExtra || 0) * 0.6; o[2] = x1; o[3] = Math.max(J.fN.y, J.fF.y) + b.ankle;
}
function humanExtent(look, J, o) {
  const pad = look.pad ?? Math.max(24, look.body.headR * 2.4);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pts = [J.hip, J.neck, J.head, J.hN, J.hF, J.eN, J.eF, J.kN, J.kF, J.fN, J.fF, J.tip];
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  const b = look.body;
  const tail = b.wtail || 0;
  const bx = J.hN.x - Math.cos(J.w) * tail, by = J.hN.y - Math.sin(J.w) * tail;
  x0 = Math.min(x0, bx); x1 = Math.max(x1, bx); y0 = Math.min(y0, by); y1 = Math.max(y1, by);
  o[0] = x0 - pad; o[1] = y0 - pad - (look.topExtra || 0); o[2] = x1 + pad; o[3] = y1 + pad * 0.5;
}

// ---------------------------------------------------------------------------------------------
// Quadruped rig (thornstag, coghound)
// ---------------------------------------------------------------------------------------------
// Fields: bx/by body offset (leg units, by>0 lowers), bp body pitch (+ = front down), nk neck angle
// offset, hd head angle offset, ja jaw open, f?x/f?y feet (fn front-near, ff front-far, bn back-near,
// bf back-far; x relative to each leg's neutral, y height above ground), tl tail, ch/rel fx, air, sx, ex.

const QUAD_FIELDS = ['bx', 'by', 'bp', 'nk', 'hd', 'ja', 'fnx', 'fny', 'ffx', 'ffy', 'bnx', 'bny', 'bfx', 'bfy', 'tl', 'ch', 'rel', 'air', 'sx', 'ex'];
const QI = fieldIndex(QUAD_FIELDS);
const QUAD_NOEX = new Set(['ja', 'ch', 'rel', 'air', 'sx', 'ex', 'fny', 'ffy', 'bny', 'bfy']);
const QUAD_READY = { bx: 0, by: 0.02, bp: 0, nk: 0, hd: 0, ja: 0, fnx: 0.04, fny: 0, ffx: -0.06, ffy: 0, bnx: -0.04, bny: 0, bfx: 0.06, bfy: 0, tl: 0, ch: 0, rel: 0, air: 0, sx: 1, ex: 0 };
const QUAD_BOOK = {
  guard: { by: 0.14, bp: 0.12, nk: 0.35, hd: 0.3, fnx: 0.18, ffx: 0.1, bnx: -0.12, bfx: -0.05 },
  parry: { bx: -0.06, by: 0.12, bp: 0.1, nk: 0.45, hd: 0.35, fnx: 0.2, ffx: 0.12, bnx: -0.14, bfx: -0.06 },
  dodge: { bx: -0.45, by: 0.05, bp: -0.12, nk: -0.25, hd: -0.2, fnx: -0.2, fny: 0.2, ffx: -0.3, ffy: 0.12, bnx: -0.5, bfx: -0.42, tl: 0.5 },
  hurt: { bx: -0.14, by: 0.08, bp: -0.1, nk: -0.4, hd: -0.3, ja: 0.5, fnx: 0.08, fny: 0.08, ffx: -0.04, bnx: -0.12, bfx: -0.06, tl: 0.6 },
  cast: { g: { by: -0.02, bp: -0.12, nk: -0.35, hd: -0.25, ja: 0.3, fnx: 0.05, fny: 0.12 }, r: { by: 0.05, bp: 0.08, nk: 0.15, hd: 0.1, ja: 0.8, fnx: 0.15 } },
  aimFar: { bp: 0.02, nk: 0.1, hd: 0.05, ja: 0.2 },
  aimNear: { bp: 0.02, nk: 0.1, hd: 0.05, ja: 0.2 },
  ko: { a: { by: 0.3, bp: 0.1, nk: 0.5, hd: 0.4, fnx: 0.2, ffx: 0.1, bnx: -0.2 }, b: { by: 0.62, bp: 0.02, nk: 0.9, hd: 0.5, ja: 0.2, fnx: 0.4, fny: 0.02, ffx: 0.3, bnx: -0.35, bfx: -0.25, tl: -0.5 } },
  victory: { by: -0.05, bp: -0.22, nk: -0.5, hd: -0.35, ja: 0.6, fnx: 0.1, fny: 0.25, tl: 0.8 },
  jump: {
    crouch: { by: 0.22, bp: 0.05, nk: 0.2, fnx: 0.12, bnx: -0.1 },
    up: { by: -0.05, bp: -0.15, nk: -0.2, fnx: 0.3, fny: 0.3, ffx: 0.25, ffy: 0.25, bnx: -0.3, bny: 0.1, bfx: -0.25, bfy: 0.1, tl: 0.6 },
    tuck: { by: 0.05, bp: 0.0, nk: -0.05, fnx: 0.1, fny: 0.35, ffx: 0.05, ffy: 0.3, bnx: -0.05, bny: 0.3, bfx: 0.0, bfy: 0.3, tl: 0.4 },
    land: { by: 0.2, bp: 0.12, nk: 0.25, fnx: 0.12, ffx: 0.05, bnx: -0.1, bfx: -0.02 },
  },
  carry: {},
  variants: {
    slash: {
      a: { bx: -0.08, by: 0.04, bp: -0.1, nk: -0.55, hd: -0.45, fnx: 0.0, fny: 0.12, bnx: -0.1 },
      c: { bx: 0.22, by: 0.1, bp: 0.16, nk: 0.55, hd: 0.5, fnx: 0.3, ffx: 0.15, bnx: 0.05, bfx: 0.1 },
      f: { bx: 0.24, by: 0.1, bp: 0.14, nk: 0.7, hd: 0.6, fnx: 0.3, ffx: 0.15, bnx: 0.05, bfx: 0.1 },
    },
    thrust: {
      a: { bx: -0.2, by: 0.12, bp: 0.06, nk: -0.2, hd: 0.1, fnx: -0.05, bnx: -0.25, bfx: -0.2 },
      c: { bx: 0.35, by: 0.1, bp: 0.14, nk: 0.45, hd: 0.45, fnx: 0.35, ffx: 0.25, bnx: 0.15, bfx: 0.2 },
      f: { bx: 0.38, by: 0.1, bp: 0.12, nk: 0.4, hd: 0.4, fnx: 0.38, ffx: 0.28, bnx: 0.15, bfx: 0.2 },
    },
    charge: {
      a: { bx: -0.2, by: 0.22, bp: 0.18, nk: 0.55, hd: 0.45, fnx: 0.1, ffx: 0.0, bnx: -0.3, bfx: -0.25, tl: 0.4 },
      c: { bx: 0.45, by: 0.08, bp: 0.12, nk: 0.5, hd: 0.45, fnx: 0.45, fny: 0.1, ffx: 0.3, bnx: 0.1, bfx: 0.25, bfy: 0.12, tl: 0.8 },
      f: { bx: 0.42, by: 0.1, bp: 0.08, nk: 0.35, hd: 0.3, fnx: 0.4, ffx: 0.3, bnx: 0.15, bfx: 0.25, tl: 0.5 },
    },
    bite: {
      a: { bx: -0.12, by: 0.02, bp: -0.14, nk: -0.6, hd: -0.5, ja: 1, fnx: 0.0, fny: 0.1, bnx: -0.12 },
      c: { bx: 0.3, by: 0.08, bp: 0.14, nk: 0.35, hd: 0.25, ja: 0, fnx: 0.3, ffx: 0.2, bnx: 0.05, bfx: 0.12 },
      f: { bx: 0.3, by: 0.08, bp: 0.12, nk: 0.3, hd: 0.2, ja: 0.2, fnx: 0.3, ffx: 0.2, bnx: 0.05, bfx: 0.12 },
    },
    slam: {
      a: { bx: -0.12, by: -0.1, bp: -0.55, nk: -0.3, hd: -0.2, fnx: 0.15, fny: 0.55, ffx: 0.05, ffy: 0.45, bnx: -0.05, bfx: 0.02, tl: 0.6 },
      c: { bx: 0.12, by: 0.16, bp: 0.14, nk: 0.4, hd: 0.3, fnx: 0.3, ffx: 0.2, bnx: 0.0, bfx: 0.05 },
      f: { bx: 0.12, by: 0.18, bp: 0.14, nk: 0.45, hd: 0.35, fnx: 0.3, ffx: 0.2, bnx: 0.0, bfx: 0.05 },
    },
    spin: {
      a: { bx: -0.06, by: 0.14, bp: 0.05, nk: -0.3, hd: -0.2, fnx: -0.05, bnx: -0.1, tl: 0.7 },
      c: { bx: 0.15, by: 0.08, bp: 0.05, nk: 0.35, hd: 0.3, fnx: 0.2, ffx: 0.1, bnx: 0.0, tl: -0.6 },
      f: { bx: 0.15, by: 0.08, bp: 0.02, nk: 0.2, hd: 0.15, fnx: 0.2, ffx: 0.1, tl: -0.3 },
      windup: [[0, 'R'], [0.42, 'A', 'outCubic'], [0.8, 'A2'], [0.9, { bx: 0.05, by: 0.1, bp: 0.05, nk: 0.35, hd: 0.3, fnx: 0.15, sx: -1, tl: -0.6 }, 'linear'], [1, 'C', 'linear']],
    },
    bolt: {
      a: { bx: -0.08, by: 0.0, bp: -0.15, nk: -0.45, hd: -0.35, ja: 0.7, fnx: 0.05, fny: 0.1 },
      c: { bx: 0.08, by: 0.06, bp: 0.08, nk: 0.15, hd: 0.1, ja: 1, fnx: 0.18, ffx: 0.08 },
      f: { bx: 0.06, by: 0.06, bp: 0.05, nk: 0.1, hd: 0.05, ja: 0.4, fnx: 0.15 },
      gather: true,
    },
    wave: {
      a: { bx: -0.1, by: -0.08, bp: -0.5, nk: -0.35, hd: -0.2, fnx: 0.12, fny: 0.5, ffx: 0.02, ffy: 0.42, tl: 0.5 },
      c: { bx: 0.08, by: 0.2, bp: 0.16, nk: 0.45, hd: 0.3, fnx: 0.25, ffx: 0.15 },
      f: { bx: 0.08, by: 0.2, bp: 0.15, nk: 0.45, hd: 0.3, fnx: 0.25, ffx: 0.15 },
      gather: true,
    },
    beam: {
      a: { bx: -0.1, by: 0.08, bp: -0.05, nk: -0.25, hd: -0.2, ja: 0.4 },
      c: { bx: 0.05, by: 0.1, bp: 0.08, nk: 0.1, hd: 0.05, ja: 1, fnx: 0.15 },
      f: { bx: 0.05, by: 0.1, bp: 0.08, nk: 0.1, hd: 0.05, ja: 0.9, fnx: 0.15 },
      gather: true, sustain: true,
    },
    nova: {
      a: { by: 0.22, bp: 0.12, nk: 0.5, hd: 0.4, fnx: 0.12, ffx: 0.02, bnx: -0.08 },
      c: { by: -0.06, bp: -0.3, nk: -0.55, hd: -0.4, ja: 1, fnx: 0.1, fny: 0.3, tl: 0.8 },
      f: { by: -0.02, bp: -0.2, nk: -0.45, hd: -0.3, ja: 0.6, fnx: 0.1, fny: 0.15 },
      gather: true,
    },
    cast: {
      a: { by: -0.02, bp: -0.16, nk: -0.45, hd: -0.3, ja: 0.2, fnx: 0.05, fny: 0.12 },
      c: { by: 0.06, bp: 0.1, nk: 0.2, hd: 0.15, ja: 0.8, fnx: 0.18 },
      f: { by: 0.05, bp: 0.06, nk: 0.1, hd: 0.08, ja: 0.3, fnx: 0.15 },
      gather: true,
    },
  },
};
QUAD_BOOK.variants.heavy = QUAD_BOOK.variants.slam;
QUAD_BOOK.variants.flurry = QUAD_BOOK.variants.bite;
QUAD_BOOK.variants.leap = QUAD_BOOK.variants.charge;
QUAD_BOOK.variants.buff = QUAD_BOOK.variants.cast;
QUAD_BOOK.variants.heal = QUAD_BOOK.variants.cast;
QUAD_BOOK.variants.gradient = QUAD_BOOK.variants.nova;
QUAD_BOOK.variants.shoot = QUAD_BOOK.variants.bolt;

function newQuadJ() {
  return { body: pt(), sh: pt(), hp: pt(), nb: pt(), nt: pt(), head: pt(), snout: pt(), tail: pt(), tailTip: pt(),
    fnS: pt(), fnK: pt(), fnF: pt(), ffS: pt(), ffK: pt(), ffF: pt(), bnS: pt(), bnK: pt(), bnH: pt(), bnF: pt(),
    bfS: pt(), bfK: pt(), bfH: pt(), bfF: pt(), bp: 0, na: 0, ha: 0, ja: 0, ch: 0, rel: 0, sx: 1, air: 0, tl: 0, ex: 0, rootX: 0, P: null };
}

function solveQuad(look, P, J) {
  const b = look.body;
  const L = b.L;
  const air = P[QI.air] * L;
  J.P = P; J.air = air;
  const cx = P[QI.bx] * L, cy = -b.standH + P[QI.by] * L - air;
  J.rootX = cx;
  J.body.x = cx; J.body.y = cy;
  const bp = P[QI.bp];
  J.bp = bp;
  const ca = Math.cos(bp), sa = Math.sin(bp);
  const half = b.bodyLen / 2;
  J.sh.x = cx + ca * half; J.sh.y = cy + sa * half;
  J.hp.x = cx - ca * half; J.hp.y = cy - sa * half;
  // neck
  J.nb.x = J.sh.x + ca * b.neckOff - sa * -b.neckUp; J.nb.y = J.sh.y + sa * b.neckOff + ca * -b.neckUp;
  const na = b.neckAng + bp + P[QI.nk];
  J.na = na;
  J.nt.x = J.nb.x + Math.cos(na) * b.neckLen; J.nt.y = J.nb.y + Math.sin(na) * b.neckLen;
  const ha = b.headAng + na * 0.35 + P[QI.hd];
  J.ha = ha;
  J.head.x = J.nt.x; J.head.y = J.nt.y;
  J.snout.x = J.nt.x + Math.cos(ha) * b.headLen; J.snout.y = J.nt.y + Math.sin(ha) * b.headLen;
  // tail
  const ta = Math.PI + bp - 0.5 + P[QI.tl] * 0.9;
  J.tl = P[QI.tl];
  J.tail.x = J.hp.x - ca * 4; J.tail.y = J.hp.y - sa * 4 - b.tailUp;
  J.tailTip.x = J.tail.x + Math.cos(ta) * b.tailLen; J.tailTip.y = J.tail.y + Math.sin(ta) * b.tailLen;
  // legs: shoulders/hips sit below the body line
  const dropx = -sa * b.legDrop, dropy = ca * b.legDrop;
  J.fnS.x = J.sh.x + dropx + b.legSpread; J.fnS.y = J.sh.y + dropy;
  J.ffS.x = J.sh.x + dropx - b.legSpread; J.ffS.y = J.sh.y + dropy;
  J.bnS.x = J.hp.x + dropx + b.legSpread; J.bnS.y = J.hp.y + dropy;
  J.bfS.x = J.hp.x + dropx - b.legSpread; J.bfS.y = J.hp.y + dropy;
  const g = -b.hoof - air;
  const fx0 = b.bodyLen / 2, bx0 = -b.bodyLen / 2;
  let r = ik(J.fnS.x, J.fnS.y, fx0 + P[QI.fnx] * L, g - P[QI.fny] * L, b.fu, b.fl, 1);
  J.fnK.x = r.jx; J.fnK.y = r.jy; J.fnF.x = r.ex; J.fnF.y = r.ey;
  r = ik(J.ffS.x, J.ffS.y, fx0 + P[QI.ffx] * L, g - P[QI.ffy] * L, b.fu, b.fl, 1);
  J.ffK.x = r.jx; J.ffK.y = r.jy; J.ffF.x = r.ex; J.ffF.y = r.ey;
  // hind legs: hoof → hock (cannon) → IK hip→stifle→hock
  const hind = (S, K, H, F, x, y) => {
    F.x = x; F.y = y;
    H.x = x - b.cannon * 0.28; H.y = y - b.cannon;
    const rr = ik(S.x, S.y, H.x, H.y, b.bu, b.bl, -1);
    K.x = rr.jx; K.y = rr.jy; H.x = rr.ex; H.y = rr.ey;
  };
  hind(J.bnS, J.bnK, J.bnH, J.bnF, bx0 + P[QI.bnx] * L, g - P[QI.bny] * L);
  hind(J.bfS, J.bfK, J.bfH, J.bfF, bx0 + P[QI.bfx] * L, g - P[QI.bfy] * L);
  J.ja = P[QI.ja]; J.ch = P[QI.ch]; J.rel = P[QI.rel]; J.sx = P[QI.sx]; J.ex = P[QI.ex];
}

function quadLocomotion(look, P, run, phase) {
  P.set(look._carry);
  const a = phase * TAU;
  const S = run ? 0.42 : 0.24, Hh = run ? 0.26 : 0.14;
  const leg = (xi, yi, off, base) => {
    const ph = a + off * TAU;
    P[xi] = base + S * Math.sin(ph);
    P[yi] = Hh * Math.pow(Math.max(0, Math.cos(ph)), 1.4);
  };
  if (run) {
    leg(QI.fnx, QI.fny, 0, 0.04); leg(QI.ffx, QI.ffy, 0.12, -0.02);
    leg(QI.bnx, QI.bny, 0.5, -0.02); leg(QI.bfx, QI.bfy, 0.62, 0.04);
    P[QI.bp] = 0.07 * Math.sin(a + 0.8);
    P[QI.by] = 0.06 - 0.06 * Math.sin(2 * a);
    P[QI.nk] = 0.12 * Math.sin(a + 1.6) + 0.12;
    P[QI.tl] = 0.4 + 0.2 * Math.sin(a);
  } else {
    leg(QI.fnx, QI.fny, 0, 0.04); leg(QI.ffx, QI.ffy, 0.5, -0.02);
    leg(QI.bnx, QI.bny, 0.75, -0.02); leg(QI.bfx, QI.bfy, 0.25, 0.04);
    P[QI.by] = 0.02 + 0.015 * Math.cos(2 * a);
    P[QI.nk] = 0.05 * Math.sin(2 * a);
    P[QI.tl] = 0.1 * Math.sin(a);
  }
  P[QI.ex] = phase;
}
function quadBreathe(look, P, st, amt) {
  const b = Math.sin(st.t * (TAU / 3100) + st.seed);
  P[QI.by] += 0.012 * b * amt;
  P[QI.nk] += 0.03 * b * amt;
  P[QI.hd] += 0.03 * Math.sin(st.t * (TAU / 4200) + st.seed) * amt;
  P[QI.tl] += 0.15 * Math.sin(st.t * (TAU / 1700) + st.seed) * amt;
}
function quadTremble(look, P, st, k) { const j = Math.sin(st.t * 0.083 + st.seed) * k; P[QI.bx] += j * 0.012; P[QI.hd] += j * 0.04; }
function quadSlump(look, P) { P[QI.by] += 0.1; P[QI.nk] += 0.35; P[QI.hd] += 0.25; }

function quadAnchors(look, J, o) {
  const b = look.body;
  o.head.x = lerp(J.head.x, J.snout.x, 0.35); o.head.y = lerp(J.head.y, J.snout.y, 0.35) - 4;
  o.chest.x = lerp(J.body.x, J.sh.x, 0.75); o.chest.y = lerp(J.body.y, J.sh.y, 0.75) + b.legDrop * 0.2;
  o.weapon.x = J.snout.x; o.weapon.y = J.snout.y;
  o.feet.x = J.body.x; o.feet.y = Math.max(J.fnF.y, J.bnF.y) + b.hoof;
  o.top.x = J.head.x; o.top.y = Math.min(J.head.y, J.body.y) - (look.topExtra || 20);
  o.center.x = J.body.x; o.center.y = J.body.y + 4;
  o.tip.x = J.snout.x; o.tip.y = J.snout.y;
}
function quadBounds(look, J, o) {
  const b = look.body;
  o[0] = Math.min(J.hp.x, J.sh.x) - b.bodyR * 1.1;
  o[2] = Math.max(J.snout.x, J.sh.x + b.bodyR);
  o[1] = Math.min(J.body.y - b.bodyR, J.head.y - b.headR - 4);
  o[3] = Math.max(J.fnF.y, J.bnF.y) + b.hoof;
}
function quadExtent(look, J, o) {
  const pad = look.pad ?? 40;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of [J.body, J.sh, J.hp, J.head, J.snout, J.tailTip, J.fnF, J.ffF, J.bnF, J.bfF, J.nt]) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  o[0] = x0 - pad; o[1] = y0 - pad - (look.topExtra || 0); o[2] = x1 + pad; o[3] = y1 + pad * 0.5;
}

// ---------------------------------------------------------------------------------------------
// Look factories (handed to looks/*.js as part of the kit)
// ---------------------------------------------------------------------------------------------

function finishLook(look) {
  look.fi = fieldIndex(look.fields);
  look._ready = new Float64Array(look.fields.length);
  const rd = look.readyBase;
  look.fields.forEach((f, i) => { look._ready[i] = typeof rd[f] === 'number' ? rd[f] : 0; });
  look._ready = resolvePose(look, look.book.ready || {}, look._ready);
  look._carry = resolvePose(look, look.book.carry || {});
  look._tracks = new Map();
  look.P = new Float64Array(look.fields.length);
  look.P2 = new Float64Array(look.fields.length);
  look.J = look.newJ();
  look.J2 = look.newJ();
  look._portraits = new Map();
  return look;
}

/** Create a humanoid look (see HUMAN_FIELDS). */
function humanoid(def) {
  const look = Object.assign({
    rig: 'humanoid', kind: 'enemy', twoHand: 0, shootHand: 'near', armSwing: 0.32, weaponFocus: 0.72,
    olScale: 1, fxScale: 1, magic: '#fff3c2', trail: true, floating: false, jumpH: 1.3, defaultVariant: 'slash',
  }, def);
  const b = look.body;
  b.L = b.thigh + b.shin; b.A = b.upper + b.fore;
  b.hipH = b.hipH ?? b.L * 0.965; b.ankle = b.ankle ?? 5;
  b.shDrop = b.shDrop ?? 5; b.shN = b.shN ?? -4; b.shF = b.shF ?? 5; b.hipN = b.hipN ?? -3; b.hipF = b.hipF ?? 3;
  b.grip = b.grip ?? 14; b.bw = b.bw ?? 24;
  look.fields = HUMAN_FIELDS; look.noExtrap = HUMAN_NOEX; look.readyBase = HUMAN_READY;
  look.book = mergeBook(HUMAN_BOOK, def.book || {});
  look.newJ = newHumanJ; look.solve = solveHuman; look.locomotion = def.locomotion || humanLocomotion;
  look.breathe = def.breathe || humanBreathe; look.tremble = humanTremble; look.slump = humanSlump;
  look.anchorsFn = def.anchors || humanAnchors; look.boundsFn = def.bounds || humanBounds; look.extentFn = def.extent || humanExtent;
  look.castPoint = def.castPoint || ((J, o) => { o.x = J.tip.x; o.y = J.tip.y; });
  look.parryPoint = def.parryPoint || ((J, o) => { o.x = J.hN.x + Math.cos(J.w) * b.wlen * 0.45; o.y = J.hN.y + Math.sin(J.w) * b.wlen * 0.45; });
  look.trailPts = def.trailPts || ((J, o) => { o[0] = J.tip.x; o[1] = J.tip.y; o[2] = J.hN.x + Math.cos(J.w) * b.wlen * 0.62; o[3] = J.hN.y + Math.sin(J.w) * b.wlen * 0.62; });
  look.shadowRx = look.shadowRx ?? b.L * 0.55;
  return finishLook(look);
}

/** Create a quadruped look (see QUAD_FIELDS). */
function quadruped(def) {
  const look = Object.assign({
    rig: 'quad', kind: 'enemy', shootHand: 'near', fxScale: 1, magic: '#fff3c2', trail: false, floating: false, jumpH: 1.1, defaultVariant: 'charge',
    armSwing: 0, olScale: 1,
  }, def);
  const b = look.body;
  b.L = b.L ?? (b.fu + b.fl);
  b.hoof = b.hoof ?? 4;
  look.fields = QUAD_FIELDS; look.noExtrap = QUAD_NOEX; look.readyBase = QUAD_READY;
  look.book = mergeBook(QUAD_BOOK, def.book || {});
  look.newJ = newQuadJ; look.solve = solveQuad; look.locomotion = def.locomotion || quadLocomotion;
  look.breathe = def.breathe || quadBreathe; look.tremble = quadTremble; look.slump = quadSlump;
  look.anchorsFn = def.anchors || quadAnchors; look.boundsFn = def.bounds || quadBounds; look.extentFn = def.extent || quadExtent;
  look.castPoint = def.castPoint || ((J, o) => { o.x = J.snout.x; o.y = J.snout.y; });
  look.parryPoint = def.parryPoint || ((J, o) => { o.x = J.head.x; o.y = J.head.y; });
  look.trailPts = def.trailPts || null;
  look.shadowRx = look.shadowRx ?? b.bodyLen * 0.75;
  return finishLook(look);
}

/**
 * Create a look with a custom rig. def must provide: fields, ready (full default pose object),
 * book (same shape as HUMAN_BOOK: guard, parry, dodge, hurt, cast{g,r}, aimNear/aimFar, ko{a,b},
 * victory, jump{crouch,up,tuck,land}, carry, variants), newJ(), solve(look,P,J), anchors, bounds, extent.
 */
function custom(def) {
  const look = Object.assign({ rig: 'custom', kind: 'enemy', shootHand: 'near', fxScale: 1, magic: '#fff3c2', trail: false, floating: false,
    jumpH: 1, defaultVariant: 'slash', olScale: 1 }, def);
  look.readyBase = def.ready;
  look.noExtrap = new Set(def.noExtrap || ['ch', 'rel', 'sx', 'air', 'ex']);
  const bk = def.book || {};
  look.book = {
    guard: {}, parry: {}, dodge: {}, hurt: {}, aimNear: {}, aimFar: {}, victory: {}, carry: {},
    ...bk,
    cast: { g: {}, r: {}, ...(bk.cast || {}) },
    ko: { a: {}, b: {}, ...(bk.ko || {}) },
    jump: { crouch: {}, up: {}, tuck: {}, land: {}, ...(bk.jump || {}) },
    variants: bk.variants || { slash: { a: {}, c: {}, f: {} } },
  };
  look.anchorsFn = def.anchors; look.boundsFn = def.bounds; look.extentFn = def.extent;
  look.breathe = def.breathe || (() => {}); look.tremble = def.tremble || (() => {}); look.slump = def.slump || (() => {});
  look.locomotion = def.locomotion;
  look.castPoint = def.castPoint || ((J, o) => { o.x = 0; o.y = -look.height * 0.6; });
  look.parryPoint = def.parryPoint || look.castPoint;
  look.trailPts = def.trailPts || null;
  return finishLook(look);
}

/** The kit object passed to every looks/*.js factory. */
const KIT = {
  D, TAU, clamp, lerp, smooth, hash, EASE,
  shade, rgba, mix, hsl,
  lit, litR, rim, paint, paintR, paintAxis, fill, stroke, capsule, limb, ell, circ, poly, blob, line, curve,
  glow, puff, star, bolt, cracks, motes, groundShadow, frame, unframe, setLight, dirX, dirY, foot, hand, mech, liftOf, along, sprite, strip, polyline, mitt,
  humanoid, quadruped, custom, HI, QI, INK, RIM, PALETTE, ik, pt,
};

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

let _looks = null;
const _warned = new Set();
function warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  if (typeof console !== 'undefined') console.warn('[sprites] ' + msg);
}
function registry() {
  if (_looks) return _looks;
  _looks = Object.create(null);
  const groups = [definePartyLooks, defineShoreLooks, defineThicketLooks, defineSpireLooks, defineSummitLooks, defineTrainingLooks];
  for (const g of groups) {
    try {
      Object.assign(_looks, g(KIT));
    } catch (e) {
      warnOnce('failed to define looks: ' + (e && e.message));
      if (typeof console !== 'undefined') console.error(e);
    }
  }
  return _looks;
}
function getLook(id) {
  const reg = registry();
  const l = reg[id];
  if (!l) { warnOnce('unknown look "' + id + '"'); return reg.dummy || null; }
  return l;
}

/** Internal look object (rig, body, colours) — handy for tools and debug views. */
export function getLookInfo(lookId) {
  const l = registry()[lookId];
  if (!l) return null;
  return { id: l.id, name: l.name, kind: l.kind, rig: l.rig, height: l.height, weakPoints: (l.weak || []).map((w) => w.id), magic: l.magic };
}

// ---------------------------------------------------------------------------------------------
// Pose normalisation, evaluation
// ---------------------------------------------------------------------------------------------

const ANIM_SET = new Set(ANIM_IDS);
const GATHER_COLORS = { heal: '#a8f0b0', buff: '#ffd36b', gradient: '#d9a6ff' };

function makeState() {
  return { x: 0, y: 0, scale: 1, facing: 1, anim: 'idle', variant: null, p: 0, t: 0, flash: 0, tint: null, tintAmt: 0.5, alpha: 1,
    aura: null, broken: false, phase: 0, mechanic: null, shadow: true, seed: 0, lx: 0.6, ly: -0.8, blx: 0.6, bly: -0.8,
    olw: 1, ink: INK, look: null, _fa: [], _ang: 0, _sxm: false, kind: 'enemy', ghost: false, portrait: false, R: 1 };
}
const ST = makeState();

function normalize(st, look, pose) {
  pose = pose || {};
  st.x = +pose.x || 0;
  st.y = +pose.y || 0;
  st.scale = pose.scale > 0 ? +pose.scale : 1;
  st.facing = pose.facing < 0 ? -1 : 1;
  let anim = pose.anim || 'idle';
  if (!ANIM_SET.has(anim)) { warnOnce('unknown anim "' + anim + '"'); anim = 'idle'; }
  st.anim = anim;
  st.variant = pose.variant || null;
  st.p = clamp(+pose.p || 0, 0, 1);
  st.t = +pose.t || 0;
  st.flash = clamp(+pose.flash || 0, 0, 1);
  if (pose.tint && typeof pose.tint === 'object') { st.tint = pose.tint.color || null; st.tintAmt = clamp(pose.tint.amount ?? 0.5, 0, 1); } else { st.tint = pose.tint || null; st.tintAmt = 0.5; }
  st.alpha = pose.alpha === undefined ? 1 : clamp(+pose.alpha, 0, 1);
  st.aura = pose.aura && AURA_COLORS[pose.aura] ? pose.aura : null;
  st.broken = !!pose.broken;
  st.phase = +pose.phase || 0;
  st.mechanic = pose.mechanic || null;
  st.shadow = pose.shadow !== false;
  st.seed = pose.seed !== undefined ? +pose.seed : Math.round(st.y) * 0.731 + (look ? look.id.length * 1.37 : 0);
  st.blx = 0.6 * st.facing; st.bly = -0.8;
  st.lx = st.blx; st.ly = st.bly;
  st._fa.length = 0; st._ang = 0; st._sxm = false;
  st.look = look;
  st.kind = look ? look.kind : 'enemy';
  st.olw = look ? 1.05 * look.olScale : 1;
  st.ink = INK;
  st.ghost = false;
  st.portrait = false;
  st.R = st.scale;
  return st;
}

function jumpArc(p) {
  if (p <= 0.2 || p >= 0.86) return 0;
  const u = (p - 0.2) / 0.66;
  return 4 * u * (1 - u);
}
function runPhase(st, anim) { const period = anim === 'run' ? 560 : 980; return (((st.t / period) + st.p) % 1 + 1) % 1; }

/** Evaluate the look's pose parameters for the state into P (optionally at a different p). */
function evaluate(look, st, P, pOverride) {
  const anim = st.anim;
  const p = pOverride === undefined ? st.p : clamp(pOverride, 0, 1);
  if (anim === 'run' || anim === 'walk') {
    if (look.locomotion) look.locomotion(look, P, anim === 'run', runPhase(st, anim), st);
    else evalTrack(getTrack(look, 'idle', null), 0, P);
  } else {
    evalTrack(getTrack(look, anim, st.variant), p, P);
  }
  const fi = look.fi;
  if (anim === 'jump' && fi.air !== undefined) P[fi.air] += jumpArc(p) * look.jumpH;
  let amt;
  switch (anim) {
    case 'idle': case 'victory': amt = 1; break;
    case 'guard': case 'aim': amt = 0.6; break;
    case 'run': case 'walk': case 'jump': case 'ko': amt = 0; break;
    default: amt = 0.35;
  }
  if (look.floating && amt === 0 && anim !== 'ko') amt = 0.5;
  if (amt > 0) look.breathe(look, P, st, amt);
  if (anim === 'windup' && p > 0.4 && p < 0.9) look.tremble(look, P, st, (st.kind === 'enemy' ? 1 : 0.4) * smooth(0.4, 0.6, p));
  if (st.broken && anim !== 'ko') look.slump(look, P, st);
}

// ---------------------------------------------------------------------------------------------
// Generic effect layers (drawn in the actor's local frame)
// ---------------------------------------------------------------------------------------------

const _pt = { x: 0, y: 0 };
const _trail = new Float64Array(4);
const TRAIL_VARIANTS = new Set(['slash', 'thrust', 'flurry', 'heavy', 'leap', 'spin', 'gradient', 'slam', 'charge', 'bite']);

function fxColor(look, st) {
  if (st.variant && GATHER_COLORS[st.variant] && st.kind === 'party') return GATHER_COLORS[st.variant];
  if (st.variant === 'gradient') return GATHER_COLORS.gradient;
  return look.magic;
}

function drawCharge(ctx, look, J, st) {
  const ch = J.ch, rel = J.rel;
  if (ch < 0.01 && rel < 0.01) return;
  look.castPoint(J, _pt);
  const x = _pt.x, y = _pt.y;
  const s = look.fxScale;
  let c = fxColor(look, st);
  if (st.variant === 'gradient') c = hsl((st.t * 0.25) % 360, 0.85, 0.72);
  if (ch > 0.01) {
    const fl = 0.85 + 0.15 * Math.sin(st.t * 0.05 + st.seed);
    glow(ctx, x, y, (10 + 30 * ch) * s * fl, c, 0.35 + 0.55 * ch);
    glow(ctx, x, y, (4 + 9 * ch) * s, '#ffffff', 0.5 * ch);
    // converging motes
    for (let i = 0; i < 6; i++) {
      const u = ((st.t / 520) + i / 6) % 1;
      const ang = i * 1.9 + st.t * 0.002;
      const rr = (1 - u) * (34 + 20 * ch) * s;
      glow(ctx, x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, (2 + 2 * ch) * s, c, ch * Math.sin(u * Math.PI));
    }
  }
  if (rel > 0.01) {
    star(ctx, x, y, (18 + 30 * rel) * s, '#ffffff', rel, st.t * 0.002);
    glow(ctx, x, y, 46 * rel * s, c, rel * 0.8);
  }
}

function drawParryFlash(ctx, look, J, st) {
  if (st.anim !== 'parry' || J.rel < 0.02) return;
  look.parryPoint(J, _pt);
  const s = look.fxScale;
  star(ctx, _pt.x, _pt.y, 34 * J.rel * s, '#ffffff', J.rel, 0.3);
  glow(ctx, _pt.x, _pt.y, 40 * J.rel * s, '#bfe6ff', J.rel * 0.7);
}

function drawTrail(ctx, look, st) {
  if (!look.trail || !look.trailPts) return;
  const anim = st.anim, v = st.variant || look.defaultVariant;
  if (!TRAIL_VARIANTS.has(v)) return;
  let from, to;
  if (anim === 'windup') { if (st.p < 0.87) return; from = 0.86; to = st.p; }
  else if (anim === 'strike') { if (st.p > 0.42) return; from = Math.max(0, st.p - 0.22); to = st.p; }
  else return;
  const n = 7;
  const P2 = look.P2, J2 = look.J2;
  const outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const pp = lerp(from, to, i / n);
    evaluate(look, st, P2, pp);
    look.solve(look, P2, J2);
    if (Math.abs(J2.sx) < 0.98) return;
    look.trailPts(J2, _trail);
    outer.push(_trail[0], _trail[1]);
    inner.push(_trail[2], _trail[3]);
  }
  let fade = anim === 'strike' ? 1 - st.p / 0.42 : 1;
  if (fade <= 0.02) return;
  const color = look.trailColor || '#fff4d8';
  const pc = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const u = (i + 1) / n;
    const a = u * u * 0.42 * fade;
    ctx.beginPath();
    ctx.moveTo(outer[i * 2], outer[i * 2 + 1]);
    ctx.lineTo(outer[i * 2 + 2], outer[i * 2 + 3]);
    ctx.lineTo(inner[i * 2 + 2], inner[i * 2 + 3]);
    ctx.lineTo(inner[i * 2], inner[i * 2 + 1]);
    ctx.closePath();
    ctx.fillStyle = rgba(color, a);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(outer[0], outer[1]);
  for (let i = 1; i <= n; i++) ctx.lineTo(outer[i * 2], outer[i * 2 + 1]);
  ctx.strokeStyle = rgba('#ffffff', 0.7 * fade);
  ctx.lineWidth = 2 * st.olw;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.globalCompositeOperation = pc;
}

function drawSpinSwoosh(ctx, look, J, st) {
  if (Math.abs(J.sx) > 0.97) return;
  const pc = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  const cx = J.rootX, cy = look.rig === 'humanoid' ? lerp(J.hip.y, J.neck.y, 0.3) : -look.height * 0.45;
  const rx = look.height * 0.42, ry = look.height * 0.12;
  const a = 1 - Math.abs(J.sx);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + i * 4, rx * (1 - i * 0.1), ry, 0, Math.PI * 0.05, Math.PI * 0.95 + i * 0.1);
    ctx.strokeStyle = rgba(look.trailColor || '#fff4d8', (0.5 - i * 0.14) * a);
    ctx.lineWidth = (5 - i) * st.olw;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = pc;
}

function drawDodgeSmear(ctx, look, J, st) {
  if (st.anim !== 'dodge' || st.p < 0.04 || st.p > 0.5) return;
  const a = Math.sin(((st.p - 0.04) / 0.46) * Math.PI);
  const h = look.height;
  const pc = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const y = -h * (0.25 + i * 0.17);
    const x = J.rootX + h * 0.12;
    const len = h * (0.35 + hash(i * 3.1) * 0.25);
    const g = ctx.createLinearGradient(x, y, x + len, y);
    g.addColorStop(0, rgba('#fff2dc', 0.4 * a));
    g.addColorStop(1, rgba('#fff2dc', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - 1.5);
    ctx.lineTo(x + len, y);
    ctx.lineTo(x, y + 1.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = pc;
}

function drawBrokenFx(ctx, look, J, st, anc) {
  const h = look.height;
  const t = st.t;
  const cx = anc.top.x, cy = anc.top.y - h * 0.04;
  // orbiting sparks / cogs of daze
  for (let i = 0; i < 4; i++) {
    const a = t * 0.004 + (i * TAU) / 4;
    const x = cx + Math.cos(a) * h * 0.13, y = cy + Math.sin(a) * h * 0.035;
    star(ctx, x, y, 3 + h * 0.018, '#ffd27a', 0.8, a);
  }
  // spark spits from the chest cracks
  for (let i = 0; i < 3; i++) {
    const u = ((t / 380) + i / 3) % 1;
    const ang = -1.2 + hash(Math.floor(t / 380) * 3 + i) * 2.4;
    const r = u * h * 0.2;
    glow(ctx, anc.chest.x + Math.cos(ang) * r, anc.chest.y + Math.sin(ang) * r - u * 10, 3 + 3 * (1 - u), '#ffb347', 1 - u);
  }
}

// ---------------------------------------------------------------------------------------------
// Drawing core
// ---------------------------------------------------------------------------------------------

const ANC = { head: pt(), chest: pt(), weapon: pt(), feet: pt(), top: pt(), center: pt(), tip: pt() };
const EXT = new Float64Array(4);
const BND = new Float64Array(4);

/** Draw the look's body + generic fx in local coordinates (origin at feet, facing right). */
function drawLocal(ctx, look, J, st, withFx = true) {
  const sx = J.sx;
  const spin = Math.abs(sx - 1) > 0.001;
  if (spin) {
    ctx.save();
    ctx.translate(J.rootX, 0);
    ctx.scale(Math.abs(sx) < 0.05 ? (sx < 0 ? -0.05 : 0.05) : sx, 1);
    ctx.translate(-J.rootX, 0);
    if (sx < 0) { st._sxm = true; st.blx = -st.blx; setLight(st, 0); }
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  look.draw(ctx, J, st, KIT);
  if (spin) {
    ctx.restore();
    if (st._sxm) { st._sxm = false; st.blx = -st.blx; setLight(st, 0); }
  }
  if (withFx) {
    drawTrail(ctx, look, st);
    drawSpinSwoosh(ctx, look, J, st);
    drawCharge(ctx, look, J, st);
    drawParryFlash(ctx, look, J, st);
  }
}

// scratch composite canvases
let _cA = null, _cB = null;
function scratch(which, w, h) {
  let c = which === 0 ? _cA : _cB;
  if (!c) {
    c = makeCanvas(Math.max(64, w), Math.max(64, h));
    if (!c) return null;
    if (which === 0) _cA = c; else _cB = c;
  }
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, Math.ceil(w / 64) * 64);
    c.height = Math.max(c.height, Math.ceil(h / 64) * 64);
  }
  return c;
}

function deviceScale(ctx) {
  if (typeof ctx.getTransform !== 'function') return 1;
  const m = ctx.getTransform();
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

function auraColorFor(st) {
  if (st.aura === 'gradient') return hsl((st.t * 0.3) % 360, 0.9, 0.7);
  return AURA_COLORS[st.aura];
}

function drawShadowFor(ctx, look, J, st) {
  if (!st.shadow) return;
  const rx = look.shadowRx * st.scale;
  let lift = J.air > 0 ? J.air : 0;
  if (look.floating) lift += look.hover || 0;
  const k = clamp(1 - lift / (look.height * 1.1), 0.35, 1);
  let a = st.alpha * (0.35 + 0.65 * k);
  if (st.anim === 'ko' && st.kind === 'enemy') a *= 1 - smooth(0.55, 1, st.p);
  const sxw = st.x + J.rootX * st.facing * st.scale;
  groundShadow(ctx, sxw, st.y, rx * k, rx * 0.26 * k, a);
}

function actorTransform(ctx, st) {
  ctx.translate(st.x, st.y);
  ctx.scale(st.facing * st.scale, st.scale);
}

/**
 * Draw a look at a pose. See SPEC §4.10 for the pose shape. Extras: pose.seed (per-actor phase
 * offset), pose.tint may be a colour string or { color, amount }.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} lookId
 * @param {object} pose
 */
export function drawActor(ctx, lookId, pose) {
  const look = getLook(lookId);
  if (!look || !ctx) return;
  const st = normalize(ST, look, pose);
  let alpha = st.alpha;
  let koFade = 1;
  if (st.anim === 'ko') koFade = st.kind === 'enemy' ? 1 - smooth(0.55, 1, st.p) : 1;
  alpha *= koFade;
  if (alpha <= 0.004) return;
  const P = look.P, J = look.J;
  st.R = clamp(deviceScale(ctx) * st.scale, 0.1, 4);
  try {
    evaluate(look, st, P);
    look.solve(look, P, J);
    drawShadowFor(ctx, look, J, st);

    // dodge afterimage
    if (st.anim === 'dodge' && st.p > 0.05 && st.p < 0.5) {
      const P2 = look.P2, J2 = look.J2;
      evaluate(look, st, P2, st.p - 0.1);
      look.solve(look, P2, J2);
      ctx.save();
      ctx.globalAlpha *= 0.3 * alpha * Math.sin(((st.p - 0.05) / 0.45) * Math.PI);
      actorTransform(ctx, st);
      st.ghost = true;
      drawLocal(ctx, look, J2, st, false);
      st.ghost = false;
      ctx.restore();
      // restore main solve (P2/J2 were scratch)
    }

    const koDark = st.anim === 'ko' && st.kind === 'party' ? smooth(0.2, 0.8, st.p) * 0.3 : 0;
    const needComp = st.flash > 0.004 || st.tint || alpha < 0.995 || st.aura || st.broken || koDark > 0;
    let composited = false;
    if (needComp) composited = drawComposite(ctx, look, J, st, alpha, koDark);
    if (!composited) {
      ctx.save();
      if (alpha < 0.995) ctx.globalAlpha *= alpha;
      actorTransform(ctx, st);
      drawLocal(ctx, look, J, st, false);
      ctx.restore();
    }
    // fx layers above the body (unaffected by flash/tint)
    ctx.save();
    if (alpha < 0.995) ctx.globalAlpha *= alpha;
    actorTransform(ctx, st);
    drawTrail(ctx, look, st);
    drawSpinSwoosh(ctx, look, J, st);
    drawCharge(ctx, look, J, st);
    drawParryFlash(ctx, look, J, st);
    drawDodgeSmear(ctx, look, J, st);
    if (st.aura) drawAuraFx(ctx, look, J, st);
    if (st.broken) { look.anchorsFn(look, J, ANC); drawBrokenFx(ctx, look, J, st, ANC); }
    if (st.anim === 'ko' && st.kind === 'enemy' && st.p > 0.4) drawDissolve(ctx, look, J, st);
    ctx.restore();
  } catch (e) {
    warnOnce('draw failed for ' + lookId + ': ' + (e && e.message));
  }
}

function drawDissolve(ctx, look, J, st) {
  const u = smooth(0.4, 1, st.p);
  const h = look.height;
  for (let i = 0; i < 14; i++) {
    const hh = hash(i * 7.7 + 1);
    const x = J.rootX + (hh - 0.5) * h * 0.6;
    const y = -h * (0.1 + hash(i * 3.3) * 0.7) - u * h * 0.35 * (0.5 + hh);
    glow(ctx, x, y, 3 + hh * 4, look.magic || '#ffe6b0', Math.sin(u * Math.PI) * 0.9);
  }
}

function drawAuraFx(ctx, look, J, st) {
  const c = auraColorFor(st);
  const pulse = 0.65 + 0.35 * Math.sin(st.t * 0.012);
  look.anchorsFn(look, J, ANC);
  const h = look.height;
  glow(ctx, ANC.weapon.x, ANC.weapon.y, h * 0.22 * pulse, c, 0.55);
  glow(ctx, ANC.chest.x, ANC.chest.y, h * 0.45, c, 0.18 * pulse);
  if (st.aura === 'red') {
    motes(ctx, J.rootX, -h * 0.1, h * 0.5, h * 0.7, 9, st.t, '#ff5a3a', 2.6, 0.9, st.seed);
  } else if (st.aura === 'gold') {
    const pc = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const u = ((st.t / 700) + i / 2) % 1;
      ctx.beginPath();
      ctx.ellipse(J.rootX, -2, h * (0.2 + u * 0.35), h * (0.05 + u * 0.08), 0, 0, TAU);
      ctx.strokeStyle = rgba('#ffd24a', 0.6 * (1 - u));
      ctx.lineWidth = 3 * st.olw;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = pc;
    motes(ctx, J.rootX, -h * 0.05, h * 0.5, h * 0.4, 7, st.t, '#ffd24a', 2.2, 0.8, st.seed + 3);
  } else if (st.aura === 'gradient') {
    for (let i = 0; i < 6; i++) {
      const a = st.t * 0.0025 + (i * TAU) / 6;
      const x = ANC.center.x + Math.cos(a) * h * 0.38, y = ANC.center.y + Math.sin(a) * h * 0.22;
      star(ctx, x, y, 5 + h * 0.02, hsl(i * 60 + st.t * 0.2, 0.9, 0.75), 0.75, a);
    }
  } else {
    star(ctx, ANC.weapon.x, ANC.weapon.y, h * 0.1 * pulse, '#ffffff', 0.8, st.t * 0.004);
  }
}

/** Offscreen composite: flash / tint / alpha / aura outline / broken cracks. Returns false if unavailable. */
function drawComposite(ctx, look, J, st, alpha, koDark) {
  look.extentFn(look, J, EXT);
  const R = clamp(deviceScale(ctx) * st.scale, 0.1, 4);
  const x0 = EXT[0], y0 = EXT[1];
  const pw = Math.ceil((EXT[2] - EXT[0]) * R) + 2, ph = Math.ceil((EXT[3] - EXT[1]) * R) + 2;
  if (pw <= 2 || ph <= 2 || pw > 2400 || ph > 2400) return false;
  const A = scratch(0, pw, ph);
  if (!A) return false;
  const a = A.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalCompositeOperation = 'source-over';
  a.globalAlpha = 1;
  a.clearRect(0, 0, pw + 2, ph + 2);
  a.setTransform(R, 0, 0, R, -x0 * R, -y0 * R);
  drawLocal(a, look, J, st, false);
  if (st.broken) {
    a.globalCompositeOperation = 'source-atop';
    look.anchorsFn(look, J, ANC);
    const h = look.height;
    cracks(a, ANC.chest.x, ANC.chest.y, h * 0.32, 17.3, '#2a140c', 1.6 * st.olw, 0.9, '#ffb347');
    cracks(a, ANC.head.x, ANC.head.y, h * 0.16, 5.1, '#2a140c', 1.2 * st.olw, 0.8, '#ffb347');
  }
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalCompositeOperation = 'source-atop';
  if (st.tint) {
    a.globalAlpha = st.tintAmt;
    a.fillStyle = st.tint;
    a.fillRect(0, 0, pw, ph);
  }
  if (koDark > 0) {
    a.globalAlpha = koDark;
    a.fillStyle = '#1a1020';
    a.fillRect(0, 0, pw, ph);
  }
  if (st.flash > 0.004) {
    a.globalAlpha = st.flash;
    a.fillStyle = '#ffffff';
    a.fillRect(0, 0, pw, ph);
  }
  a.globalAlpha = 1;
  a.globalCompositeOperation = 'source-over';

  ctx.save();
  actorTransform(ctx, st);
  const iw = pw / R, ih = ph / R;
  if (st.aura) {
    const B = scratch(1, pw, ph);
    if (B) {
      const b = B.getContext('2d');
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'source-over';
      b.globalAlpha = 1;
      b.clearRect(0, 0, pw + 2, ph + 2);
      b.drawImage(A, 0, 0, pw, ph, 0, 0, pw, ph);
      b.globalCompositeOperation = 'source-in';
      if (st.aura === 'gradient') {
        const g = b.createLinearGradient(0, 0, pw, ph);
        const hh = (st.t * 0.3) % 360;
        g.addColorStop(0, hsl(hh, 0.9, 0.7)); g.addColorStop(0.5, hsl(hh + 120, 0.9, 0.72)); g.addColorStop(1, hsl(hh + 240, 0.9, 0.7));
        b.fillStyle = g;
      } else b.fillStyle = AURA_COLORS[st.aura];
      b.fillRect(0, 0, pw, ph);
      b.globalCompositeOperation = 'source-over';
      const pulse = 0.6 + 0.4 * Math.sin(st.t * 0.012);
      const o = (2.4 + 1.4 * pulse) / R;
      const pc = ctx.globalCompositeOperation, pa = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = pa * alpha * 0.5 * (0.7 + 0.3 * pulse);
      for (let i = 0; i < 4; i++) {
        const an = (i * TAU) / 4 + Math.PI / 4;
        ctx.drawImage(B, 0, 0, pw, ph, x0 + Math.cos(an) * o, y0 + Math.sin(an) * o, iw, ih);
      }
      // soft outer halo: the silhouette scaled up around its centre
      const k = 1 + (6 / R) / Math.max(iw, ih) * 2;
      const cxm = x0 + iw / 2, cym = y0 + ih / 2;
      ctx.globalAlpha = pa * alpha * 0.22 * pulse;
      ctx.drawImage(B, 0, 0, pw, ph, cxm - (iw * k) / 2, cym - (ih * k) / 2, iw * k, ih * k);
      ctx.globalCompositeOperation = pc;
      ctx.globalAlpha = pa;
    }
  }
  if (alpha < 0.995) ctx.globalAlpha *= alpha;
  ctx.drawImage(A, 0, 0, pw, ph, x0, y0, iw, ih);
  ctx.restore();
  return true;
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

const QST = makeState();
function solveFor(look, pose) {
  const st = normalize(QST, look, pose);
  evaluate(look, st, look.P2, undefined);
  look.solve(look, look.P2, look.J2);
  return st;
}
function toWorld(st, J, lx, ly) {
  let x = lx;
  const sx = J.sx;
  if (Math.abs(sx - 1) > 0.001) x = J.rootX + (lx - J.rootX) * sx;
  return { x: st.x + x * st.facing * st.scale, y: st.y + ly * st.scale };
}

/**
 * World-space anchor points for effects and choreography.
 * @returns {{head:{x,y}, chest:{x,y}, weapon:{x,y}, feet:{x,y}, top:{x,y}, center:{x,y}, tip:{x,y}, cast:{x,y}}}
 */
export function getAnchors(lookId, pose) {
  const look = getLook(lookId);
  if (!look) { const z = { x: pose?.x || 0, y: pose?.y || 0 }; return { head: z, chest: z, weapon: z, feet: z, top: z, center: z, tip: z, cast: z }; }
  const st = solveFor(look, pose);
  const J = look.J2;
  look.anchorsFn(look, J, ANC);
  look.castPoint(J, _pt);
  const cx = _pt.x, cy = _pt.y;
  return {
    head: toWorld(st, J, ANC.head.x, ANC.head.y),
    chest: toWorld(st, J, ANC.chest.x, ANC.chest.y),
    weapon: toWorld(st, J, ANC.weapon.x, ANC.weapon.y),
    feet: toWorld(st, J, ANC.feet.x, ANC.feet.y),
    top: toWorld(st, J, ANC.top.x, ANC.top.y),
    center: toWorld(st, J, ANC.center.x, ANC.center.y),
    tip: toWorld(st, J, ANC.tip.x, ANC.tip.y),
    cast: toWorld(st, J, cx, cy),
  };
}

/** Body hit box in world coordinates (for free aim). */
export function getBounds(lookId, pose) {
  const look = getLook(lookId);
  if (!look) return { x: (pose?.x || 0) - 30, y: (pose?.y || 0) - 120, w: 60, h: 120 };
  const st = solveFor(look, pose);
  look.boundsFn(look, look.J2, BND);
  const a = toWorld(st, look.J2, BND[0], BND[1]);
  const b = toWorld(st, look.J2, BND[2], BND[3]);
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Weak point circles in world coordinates, ids per SPEC §3.7. */
export function weakPointPositions(lookId, pose) {
  const look = getLook(lookId);
  if (!look || !look.weak) return [];
  const st = solveFor(look, pose);
  const J = look.J2;
  const out = [];
  for (const w of look.weak) {
    w.at(J, _pt, st);
    const p = toWorld(st, J, _pt.x, _pt.y);
    out.push({ id: w.id, x: p.x, y: p.y, r: w.r * st.scale });
  }
  return out;
}

/** Nominal height in px at scale 1. */
export function lookHeight(lookId) {
  const l = registry()[lookId];
  return l ? l.height : 150;
}

// ---------------------------------------------------------------------------------------------
// Portraits
// ---------------------------------------------------------------------------------------------

const PST = makeState();
/**
 * Cached bust portrait (circle with painterly background) for HUD, turn order and dialogue.
 * Party faces right, enemies face left. Returns null when no DOM is available.
 * @param {string} lookId
 * @param {number} [size=64]
 * @returns {HTMLCanvasElement|null}
 */
export function renderPortrait(lookId, size = 64) {
  const look = getLook(lookId);
  if (!look) return null;
  size = Math.max(8, Math.round(size));
  const k = size;
  const cached = look._portraits.get(k);
  if (cached) return cached;
  const c = makeCanvas(size, size, true);
  if (!c) return null;
  const g = c.getContext('2d');
  const pr = look.portrait || { x: 0, y: 6, r: look.height * 0.2, bg: ['#5a4a3a', '#1c1512'] };
  const S = size, R = S / 2;
  // background disc
  const bg = g.createRadialGradient(R * 0.8, R * 0.7, R * 0.1, R, R, R);
  bg.addColorStop(0, pr.bg[0]);
  bg.addColorStop(1, pr.bg[1]);
  g.fillStyle = bg;
  g.beginPath(); g.arc(R, R, R - 0.5, 0, TAU); g.fill();
  // brush strokes
  g.save();
  g.beginPath(); g.arc(R, R, R - 0.5, 0, TAU); g.clip();
  for (let i = 0; i < 7; i++) {
    const hh = hash(i * 9.1 + look.id.length);
    g.beginPath();
    g.arc(R + (hh - 0.5) * R * 0.6, R + (hash(i * 4.2) - 0.5) * R * 0.6, R * (0.45 + hh * 0.5), hh * TAU, hh * TAU + 1.2 + hh);
    g.strokeStyle = rgba(i % 2 ? pr.bg[0] : '#fff1d0', 0.07 + hh * 0.07);
    g.lineWidth = R * (0.12 + hh * 0.18);
    g.lineCap = 'round';
    g.stroke();
  }
  glow(g, R * 1.35, R * 0.55, R * 0.9, '#ffd9a0', 0.25);
  // actor
  const facing = look.kind === 'party' ? 1 : -1;
  const st = normalize(PST, look, { x: 0, y: 0, anim: 'idle', p: 0, t: pr.t || 600, facing, seed: 0, mechanic: pr.mechanic || null });
  st.portrait = true;
  const zoom = R / pr.r;
  st.olw = Math.max(0.5, 0.9 / Math.sqrt(zoom)) * look.olScale;
  evaluate(look, st, look.P2);
  look.solve(look, look.P2, look.J2);
  look.anchorsFn(look, look.J2, ANC);
  const px = pr.abs ? pr.x : ANC.head.x + (pr.x || 0), py = pr.abs ? pr.y : ANC.head.y + (pr.y || 0);
  g.translate(R, R);
  g.scale(zoom * facing, zoom);
  g.translate(-px, -py);
  drawLocal(g, look, look.J2, st, true);
  g.restore();
  // vignette + rim
  const vg = g.createRadialGradient(R, R, R * 0.55, R, R, R);
  vg.addColorStop(0, 'rgba(10,6,8,0)');
  vg.addColorStop(1, 'rgba(10,6,8,0.55)');
  g.fillStyle = vg;
  g.beginPath(); g.arc(R, R, R - 0.5, 0, TAU); g.fill();
  g.beginPath(); g.arc(R, R, R - Math.max(0.8, S * 0.02), 0, TAU);
  g.strokeStyle = rgba(PALETTE.gold, 0.85);
  g.lineWidth = Math.max(1, S * 0.03);
  g.stroke();
  look._portraits.set(k, c);
  return c;
}

const _portraitUrls = new Map();
/** Data-URL version of renderPortrait (for <img> in the DOM HUD); cached. */
export function portraitDataURL(lookId, size = 64) {
  const k = lookId + '|' + size;
  if (_portraitUrls.has(k)) return _portraitUrls.get(k);
  const c = renderPortrait(lookId, size);
  let url = '';
  try { url = c && c.toDataURL ? c.toDataURL('image/png') : ''; } catch { url = ''; }
  _portraitUrls.set(k, url);
  return url;
}

/** Variants that telegraph by gathering light (useful for choreography decisions). */
export function isGatherVariant(lookId, variant) {
  const look = registry()[lookId];
  if (!look) return false;
  const V = variantDef(look, variant);
  return !!(V && V.gather);
}
