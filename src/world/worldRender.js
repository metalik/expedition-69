// Painterly procedural rendering for Expedition 69's exploration maps: per-zone terrain textures, organic
// (shore/thicket) or architectural (spire/summit) terrain pre-rendered into chunked offscreen canvases,
// animated underlays (paused sea, sky-void with drifting clouds and far gears) painted only where the terrain
// lets them show, water glints, y-sorted tall sprites (trees, bushes, pillars, machinery), landmark props,
// drifting particles, light shafts, the frozen sun glow, colour grading and a soft vignette (cached layers).
// A `lowQuality` budget keeps software-rasterised canvases smooth. Import-safe in Node (no DOM until used).

import { TILE, TILE_TYPES } from './tilemap.js';
import { ZONE_PALETTES, PALETTE, FONTS } from '../render/palette.js';

// ═══════════════════════════════════════════════════════════════════════════ kit

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Integer hash → [0,1). */
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Seeded PRNG (mulberry32) → () => [0,1). */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0,1). */
export function vnoise(x, y, s = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, s);
  const b = hash2(x0 + 1, y0, s);
  const c = hash2(x0, y0 + 1, s);
  const d = hash2(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const _rgb = new Map();
/** '#rrggbb' | '#rgb' | 'rgb(a)()' → [r,g,b]. */
export function rgbOf(c) {
  let v = _rgb.get(c);
  if (v) return v;
  let r = 255;
  let g = 255;
  let b = 255;
  if (typeof c === 'string' && c[0] === '#') {
    if (c.length === 4) {
      r = parseInt(c[1] + c[1], 16);
      g = parseInt(c[2] + c[2], 16);
      b = parseInt(c[3] + c[3], 16);
    } else {
      r = parseInt(c.slice(1, 3), 16);
      g = parseInt(c.slice(3, 5), 16);
      b = parseInt(c.slice(5, 7), 16);
    }
  } else if (typeof c === 'string') {
    const m = c.match(/[\d.]+/g);
    if (m && m.length >= 3) {
      r = +m[0];
      g = +m[1];
      b = +m[2];
    }
  }
  v = [r || 0, g || 0, b || 0];
  if (_rgb.size > 4000) _rgb.clear();
  _rgb.set(c, v);
  return v;
}
const hx = (n) => {
  const v = clamp(Math.round(n), 0, 255);
  return (v < 16 ? '0' : '') + v.toString(16);
};
/** Colour with alpha → 'rgba()'. */
export function rgba(c, a) {
  const [r, g, b] = rgbOf(c);
  return `rgba(${r | 0},${g | 0},${b | 0},${Math.round(clamp(a, 0, 1) * 1000) / 1000})`;
}
/** Linear mix of two colours → hex. */
export function mix(a, b, t) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  const k = clamp(t, 0, 1);
  return '#' + hx(lerp(A[0], B[0], k)) + hx(lerp(A[1], B[1], k)) + hx(lerp(A[2], B[2], k));
}
const WARM = '#fff0cf';
const COOL = '#2a1830';
/** Lighten toward warm light (k>0) or darken toward violet shadow (k<0). */
export function shade(c, k) {
  return k >= 0 ? mix(c, WARM, k) : mix(c, COOL, -k);
}
/** Jitter a colour's lightness/warmth a little (painterly variety). */
export function vary(c, r, amt = 0.12) {
  const k = (r - 0.5) * 2 * amt;
  return shade(c, k);
}

/** Create a canvas (DOM canvas preferred so drawImage/patterns work everywhere). */
export function makeCanvas(w, h) {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  return null;
}

/** Filled ellipse (a brush dab). */
export function dab(ctx, x, y, rx, ry, rot, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  ctx.fill();
}

/** Tapered brush stroke from (x,y) along angle a. */
export function brush(ctx, x, y, len, w, a, color) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const nx = -s * w * 0.5;
  const ny = c * w * 0.5;
  const ex = x + c * len;
  const ey = y + s * len;
  const mx = (x + ex) / 2;
  const my = (y + ey) / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx + nx, my + ny, ex, ey);
  ctx.quadraticCurveTo(mx - nx, my - ny, x, y);
  ctx.fill();
}

const _glow = new Map();
/** Cached radial glow sprite (128px). */
export function glowSprite(color) {
  let s = _glow.get(color);
  if (s !== undefined) return s;
  s = makeCanvas(128, 128);
  if (s) {
    const g = s.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(color, 1));
    gr.addColorStop(0.2, rgba(color, 0.55));
    gr.addColorStop(0.5, rgba(color, 0.16));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  _glow.set(color, s);
  return s;
}

/** Additive soft glow. */
export function glow(ctx, x, y, r, color, a = 1) {
  if (a <= 0.003 || r <= 0.5) return;
  const s = glowSprite(color);
  if (!s) return;
  const pc = ctx.globalCompositeOperation;
  const pa = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pa * clamp(a, 0, 1);
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = pa;
  ctx.globalCompositeOperation = pc;
}

let _shadow = null;
/** Soft elliptical contact shadow. */
export function softShadow(ctx, x, y, rx, ry, a = 0.5) {
  if (!_shadow) {
    _shadow = makeCanvas(128, 64);
    if (_shadow) {
      const g = _shadow.getContext('2d');
      g.save();
      g.scale(1, 0.5);
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(24,12,26,0.75)');
      gr.addColorStop(0.5, 'rgba(24,12,26,0.4)');
      gr.addColorStop(1, 'rgba(24,12,26,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      g.restore();
    }
  }
  if (!_shadow) return;
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = pa * a;
  ctx.drawImage(_shadow, x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = pa;
}

/** Four-point sparkle star. */
export function sparkle(ctx, x, y, r, color, a = 1, rot = 0) {
  if (a <= 0.01) return;
  const pa = ctx.globalAlpha;
  const pc = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pa * a;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = rot + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.22;
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = pa;
  ctx.globalCompositeOperation = pc;
}

let _warned = new Set();
function warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn(`[world] ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════════════ zone styles

/**
 * Per-zone look: which texture paints each stack level and overlay, colours for raised masses, decoration
 * sets, tree species, atmosphere. `organic` zones blend terrain with jittered blobs; architectural ones use
 * crisp tile edges with trims and floating-platform faces.
 */
export const ZONE_STYLES = {
  shore: {
    organic: true,
    underlay: 'sea',
    levels: { 1: 'shallows', 2: 'wetsand', 3: 'sand', 4: 'dunegrass' },
    overlays: { path: 'sandpath', flowers: 'thrift', stone: 'limestone', planks: 'planks', bridge: 'planks' },
    raised: {
      cliff: { top: 'basalt', face: ['#7a6470', '#43343f', '#1e1622'], rim: '#e8b898', columns: 9 },
      ruin: { top: 'ruinlime', face: ['#b5a282', '#7e6b55', '#4e4038'], rim: '#f5dcae', vines: ['#6a7a44', '#8a9a58', '#b0a860'] },
    },
    tree: 'pine',
    bush: 'buckthorn',
    rock: ['#8a7a80', '#5a4a58', '#e6c7a8'],
    deco: 'shore',
    particles: 'spray',
    grade: ['#ffcf9a', '#4a2a5a'],
    sun: { x: 1.02, y: -0.08, r: 780, color: '#ffc98a', a: 0.34 },
    shafts: 2,
  },
  thicket: {
    organic: true,
    underlay: 'pond',
    levels: { 1: 'streambed', 2: 'moss', 3: 'leaflitter', 4: 'goldgrass' },
    overlays: { path: 'dirt', flowers: 'wildflowers', stone: 'mossstone', planks: 'planks', bridge: 'planks' },
    raised: {
      cliff: { top: 'mossrock', face: ['#7a6040', '#4a3626', '#261a16'], rim: '#f1d38a' },
      ruin: { top: 'ruinmoss', face: ['#8a8466', '#57523e', '#2e2a22'], rim: '#f1d38a', vines: ['#c9a43a', '#e3c15b', '#8a8a30', '#b07a2e'] },
    },
    tree: 'gilt',
    bush: 'giltbush',
    // Canopy calming (readability): tone mixed over the sprite by level — 1 beside a walkable tile, 2 deeper in.
    calm: { 1: { tone: '#8a7448', a: 0.2 }, 2: { tone: '#4a3a22', a: 0.4 } },
    // Warm light laid over the trodden paths so they read as the way through.
    pathLight: 0.16,
    rock: ['#8a7e62', '#54483a', '#f1d38a'],
    deco: 'thicket',
    particles: 'leaves',
    grade: ['#ffd98a', '#3a2a40'],
    sun: { x: 0.92, y: -0.12, r: 820, color: '#ffe0a0', a: 0.3 },
    shafts: 5,
  },
  spire: {
    organic: false,
    underlay: 'void',
    levels: { 1: 'brass', 2: 'brass', 3: 'brass', 4: 'brass' },
    overlays: { path: 'runner', flowers: 'brass', stone: 'terrace', planks: 'girder', bridge: 'girder', gear: 'gearfloor', stairs: 'stairs', dial: 'terrace' },
    raised: {
      wall: { top: 'brasswall', face: ['#8a6a34', '#553e1e', '#2a1e12'], rim: '#f0c96a' },
      cliff: { top: 'terrace', face: ['#7a6c60', '#4a4038', '#241e1c'], rim: '#e8c890' },
      ruin: { top: 'terrace', face: ['#7a6c60', '#4a4038', '#241e1c'], rim: '#e8c890' },
    },
    platformFace: ['#6f5426', '#3e2c16', '#1c140c'],
    trim: '#e8c16a',
    tree: 'pillar',
    bush: 'pipes',
    rock: ['#8a6a3a', '#4a3620', '#f0c96a'],
    deco: 'spire',
    particles: 'gears',
    grade: ['#f5c77e', '#1e2040'],
    sun: { x: 0.85, y: -0.2, r: 760, color: '#f5c77e', a: 0.28 },
    shafts: 3,
  },
  summit: {
    organic: false,
    underlay: 'void',
    levels: { 1: 'marble', 2: 'marble', 3: 'marble', 4: 'marble' },
    overlays: { path: 'runner', flowers: 'marble', stone: 'marble', planks: 'girder', bridge: 'girder', gear: 'gearfloor', stairs: 'stairs', dial: 'dialfloor' },
    raised: {
      wall: { top: 'marble', face: ['#8a6e58', '#4e3a30', '#241816'], rim: '#ffe0a0' },
      cliff: { top: 'marble', face: ['#8a6e58', '#4e3a30', '#241816'], rim: '#ffe0a0' },
      ruin: { top: 'marble', face: ['#8a6e58', '#4e3a30', '#241816'], rim: '#ffe0a0' },
    },
    platformFace: ['#6e5646', '#3a2a24', '#160e0c'],
    trim: '#f0c060',
    tree: 'column',
    bush: 'brazier',
    rock: ['#7a6258', '#40302a', '#ffe0a0'],
    deco: 'summit',
    particles: 'embers',
    grade: ['#ffd08a', '#200f24'],
    sun: { x: 0.5, y: -0.55, r: 900, color: '#fff0c0', a: 0.42 },
    shafts: 6,
  },
};

// ═══════════════════════════════════════════════════════════════════════════ textures

const TEX = 256; // logical texture size (tileable)

/** Draw fn(ctx, x, y) at x,y and its wrapped copies near the texture edges. */
function wrapDraw(size, x, y, r, fn) {
  const xs = [x];
  const ys = [y];
  if (x < r) xs.push(x + size);
  if (x > size - r) xs.push(x - size);
  if (y < r) ys.push(y + size);
  if (y > size - r) ys.push(y - size);
  for (const X of xs) for (const Y of ys) fn(X, Y);
}

/** Soft colour blotches (large-scale variation), tileable. */
function blotches(ctx, R, size, n, colors, rMin, rMax, aMax) {
  for (let i = 0; i < n; i++) {
    const x = R() * size;
    const y = R() * size;
    const r = lerp(rMin, rMax, R());
    const col = colors[(R() * colors.length) | 0];
    const a = aMax * (0.4 + 0.6 * R());
    wrapDraw(size, x, y, r, (X, Y) => {
      const gr = ctx.createRadialGradient(X, Y, 0, X, Y, r);
      gr.addColorStop(0, rgba(col, a));
      gr.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(X - r, Y - r, r * 2, r * 2);
    });
  }
}

/** Many short oriented strokes, tileable. */
function strokes(ctx, R, size, n, colors, { len = [4, 10], w = [1, 2.4], ang = 0, spread = 0.5, alpha = [0.25, 0.6] } = {}) {
  for (let i = 0; i < n; i++) {
    const x = R() * size;
    const y = R() * size;
    const L = lerp(len[0], len[1], R());
    const Wd = lerp(w[0], w[1], R());
    const a = ang + (R() - 0.5) * spread * 2;
    const col = rgba(colors[(R() * colors.length) | 0], lerp(alpha[0], alpha[1], R()));
    wrapDraw(size, x, y, L + 2, (X, Y) => brush(ctx, X, Y, L, Wd, a, col));
  }
}

/** Small dots/specks, tileable. */
function specks(ctx, R, size, n, colors, rMin, rMax, alpha = 0.7) {
  for (let i = 0; i < n; i++) {
    const x = R() * size;
    const y = R() * size;
    const r = lerp(rMin, rMax, R());
    const col = rgba(colors[(R() * colors.length) | 0], alpha * (0.5 + 0.5 * R()));
    wrapDraw(size, x, y, r + 1, (X, Y) => dab(ctx, X, Y, r, r * (0.6 + R() * 0.4), R() * TAU, col));
  }
}

/** Leaves (pointed ovals) — used for leaf litter and golden grass. */
function leafDabs(ctx, R, size, n, colors, sMin, sMax, alpha = 0.9) {
  for (let i = 0; i < n; i++) {
    const x = R() * size;
    const y = R() * size;
    const s = lerp(sMin, sMax, R());
    const rot = R() * TAU;
    const col = colors[(R() * colors.length) | 0];
    const a = alpha * (0.6 + 0.4 * R());
    wrapDraw(size, x, y, s + 2, (X, Y) => {
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(rot);
      ctx.fillStyle = rgba(col, a);
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(0, -s * 0.55, s, 0);
      ctx.quadraticCurveTo(0, s * 0.55, -s, 0);
      ctx.fill();
      ctx.strokeStyle = rgba(shade(col, -0.35), a * 0.5);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, 0);
      ctx.lineTo(s * 0.8, 0);
      ctx.stroke();
      ctx.restore();
    });
  }
}

/** Grass blades (upward strokes). */
function blades(ctx, R, size, n, colors, hMin, hMax, alpha = 0.8) {
  for (let i = 0; i < n; i++) {
    const x = R() * size;
    const y = R() * size;
    const h = lerp(hMin, hMax, R());
    const a = -Math.PI / 2 + (R() - 0.5) * 0.9;
    const col = rgba(colors[(R() * colors.length) | 0], alpha * (0.55 + 0.45 * R()));
    wrapDraw(size, x, y, h + 2, (X, Y) => brush(ctx, X, Y, h, 1.4 + R() * 1.2, a, col));
  }
}

/** Rectangular plate pattern (brass / marble / terrace). */
function plates(ctx, R, size, cell, base, seam, hi, { rivets = null, jitter = 0.08, inset = 1.2 } = {}) {
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const k = R();
      ctx.fillStyle = vary(base, k, jitter);
      ctx.fillRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
      // bevel: light top-right, dark bottom-left
      ctx.fillStyle = rgba(hi, 0.35);
      ctx.fillRect(x + inset, y + inset, cell - inset * 2, 1.2);
      ctx.fillRect(x + cell - inset - 1.2, y + inset, 1.2, cell - inset * 2);
      ctx.fillStyle = rgba(seam, 0.45);
      ctx.fillRect(x + inset, y + cell - inset - 1.2, cell - inset * 2, 1.2);
      ctx.fillRect(x + inset, y + inset, 1.2, cell - inset * 2);
      if (rivets) {
        for (const [rx, ry] of [[4, 4], [cell - 4, 4], [4, cell - 4], [cell - 4, cell - 4]]) {
          dab(ctx, x + rx, y + ry, 1.4, 1.4, 0, rivets);
          dab(ctx, x + rx + 0.4, y + ry - 0.4, 0.6, 0.6, 0, rgba(hi, 0.8));
        }
      }
    }
  }
}

/**
 * Tileable painterly textures by id. Each returns a canvas TEX×q px painted in logical 256 px units.
 * @type {Record<string, (ctx:CanvasRenderingContext2D, R:()=>number, S:number)=>void>}
 */
const TEXTURES = {
  // ---- shore
  shallows(ctx, R, S) {
    ctx.fillStyle = '#7fb3a4';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 14, ['#9cc8b0', '#5e9d98', '#b9c9a0', '#4f8f92'], 30, 90, 0.5);
    specks(ctx, R, S, 90, ['#d8cfa6', '#c2b890', '#6aa39c'], 0.6, 2.2, 0.5);
    // caustic net
    for (let i = 0; i < 26; i++) {
      const x = R() * S;
      const y = R() * S;
      const L = 18 + R() * 30;
      const a = R() * TAU;
      wrapDraw(S, x, y, L + 4, (X, Y) => {
        ctx.strokeStyle = rgba('#e8f6e4', 0.18 + R() * 0.12);
        ctx.lineWidth = 0.8 + R() * 0.8;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.bezierCurveTo(X + Math.cos(a) * L * 0.3 + 6, Y + Math.sin(a) * L * 0.3 - 5, X + Math.cos(a) * L * 0.7 - 5, Y + Math.sin(a) * L * 0.7 + 6, X + Math.cos(a) * L, Y + Math.sin(a) * L);
        ctx.stroke();
      });
    }
    strokes(ctx, R, S, 60, ['#f3e8c8', '#bfe4d6'], { len: [6, 16], w: [0.8, 1.6], ang: -0.08, spread: 0.12, alpha: [0.12, 0.3] });
  },
  wetsand(ctx, R, S) {
    ctx.fillStyle = '#b39170';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 14, ['#a07e62', '#c49f7c', '#8f7260', '#caa184'], 30, 80, 0.5);
    strokes(ctx, R, S, 70, ['#e7b394', '#d99a86', '#f0cfa8'], { len: [10, 30], w: [0.8, 2], ang: -0.05, spread: 0.1, alpha: [0.12, 0.32] });
    specks(ctx, R, S, 120, ['#7e6450', '#d7bf9c', '#efe1c8'], 0.5, 1.6, 0.5);
  },
  sand(ctx, R, S) {
    ctx.fillStyle = '#d8b88a';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 18, ['#e6cc9c', '#c9a676', '#dcb493', '#cfae7a', '#e9c7a0'], 30, 100, 0.55);
    // wind ripples
    for (let i = 0; i < 34; i++) {
      const x = R() * S;
      const y = R() * S;
      const L = 20 + R() * 40;
      wrapDraw(S, x, y, L + 2, (X, Y) => {
        ctx.strokeStyle = rgba(R() < 0.5 ? '#f0dbb2' : '#b99569', 0.22 + R() * 0.16);
        ctx.lineWidth = 0.9 + R() * 0.6;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.quadraticCurveTo(X + L / 2, Y - 3 - R() * 3, X + L, Y + (R() - 0.5) * 3);
        ctx.stroke();
      });
    }
    strokes(ctx, R, S, 160, ['#f2dcb0', '#c49f6e', '#e0c095'], { len: [3, 8], w: [0.8, 1.8], ang: -0.35, spread: 0.3, alpha: [0.25, 0.55] });
    specks(ctx, R, S, 150, ['#b08d62', '#f6ead4', '#e8b8a6', '#9f8466'], 0.4, 1.3, 0.6);
  },
  dunegrass(ctx, R, S) {
    ctx.fillStyle = '#b3a06a';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 16, ['#c9b47a', '#9a915a', '#d7c08a', '#8a8450'], 28, 80, 0.55);
    blades(ctx, R, S, 520, ['#8a864a', '#a8a25c', '#6f6c3a', '#c9bd78', '#e2d08c'], 4, 10, 0.85);
    specks(ctx, R, S, 60, ['#e7cfa0', '#7a7440'], 0.5, 1.4, 0.5);
  },
  sandpath(ctx, R, S) {
    ctx.fillStyle = '#c29f76';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 14, ['#b08e68', '#d0ae86', '#b89670', '#a68462'], 24, 70, 0.5);
    // footprints and cart ruts
    for (let i = 0; i < 26; i++) {
      const x = R() * S;
      const y = R() * S;
      wrapDraw(S, x, y, 6, (X, Y) => dab(ctx, X, Y, 2.6, 1.6, 0.3 + R() * 0.4, rgba('#9c7a58', 0.32)));
    }
    strokes(ctx, R, S, 90, ['#ead2ac', '#b08e68'], { len: [4, 12], w: [0.8, 1.6], ang: 0.05, spread: 0.3, alpha: [0.2, 0.4] });
    specks(ctx, R, S, 70, ['#8a6c50', '#f3e6cc', '#a89078'], 0.6, 1.8, 0.55);
  },
  thrift(ctx, R, S) {
    TEXTURES.dunegrass(ctx, R, S);
  },
  limestone(ctx, R, S) {
    ctx.fillStyle = '#b8a888';
    ctx.fillRect(0, 0, S, S);
    // irregular flagstones
    const cell = 32;
    for (let y = 0; y < S; y += cell) {
      const off = (y / cell) % 2 ? cell / 2 : 0;
      for (let x = -cell; x < S; x += cell) {
        const X = x + off;
        const w = cell - 2.5;
        const col = vary('#cdbd9d', R(), 0.1);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(X + 1.2, y + 1.2, w, cell - 2.5, 3);
        ctx.fill();
        ctx.fillStyle = rgba('#fff3d6', 0.22);
        ctx.fillRect(X + 3, y + 2, w - 5, 1.4);
        ctx.fillStyle = rgba('#6e5c48', 0.25);
        ctx.fillRect(X + 2, y + cell - 3, w - 3, 1.4);
      }
    }
    blotches(ctx, R, S, 10, ['#8f8a64', '#a09070', '#d9c7a4'], 20, 60, 0.35);
    strokes(ctx, R, S, 40, ['#6e5c48'], { len: [4, 12], w: [0.5, 1], ang: 0.6, spread: 1.4, alpha: [0.2, 0.4] });
    specks(ctx, R, S, 60, ['#7a8a50', '#d8c9a0'], 0.6, 2, 0.4);
  },
  ruinlime(ctx, R, S) {
    // broken wall-tops: rough limestone blocks, sand in the cracks, tufts of dune grass
    ctx.fillStyle = '#8a7a62';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      const x = R() * S;
      const y = R() * S;
      const w = 14 + R() * 20;
      const h = 9 + R() * 12;
      const col = vary('#d2c2a0', R(), 0.14);
      wrapDraw(S, x, y, w, (X, Y) => {
        ctx.fillStyle = rgba('#5a4a3a', 0.6);
        ctx.beginPath();
        ctx.roundRect(X - w / 2 - 1, Y - h / 2 + 1.5, w, h, 3);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(X - w / 2, Y - h / 2, w, h, 3);
        ctx.fill();
        ctx.fillStyle = rgba('#fff4dc', 0.35);
        ctx.fillRect(X - w / 2 + 2, Y - h / 2 + 1, w - 4, 1.4);
      });
    }
    blades(ctx, R, S, 120, ['#8a864a', '#a8a25c', '#c9bd78'], 3, 7, 0.8);
  },
  ruinmoss(ctx, R, S) {
    // wall-tops of the old chapel: dark mossy rubble under golden leaves
    ctx.fillStyle = '#3e3a26';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      const x = R() * S;
      const y = R() * S;
      const w = 14 + R() * 20;
      const h = 9 + R() * 12;
      const col = vary('#8a8466', R(), 0.16);
      wrapDraw(S, x, y, w, (X, Y) => {
        ctx.fillStyle = rgba('#1e1a10', 0.6);
        ctx.beginPath();
        ctx.roundRect(X - w / 2 - 1, Y - h / 2 + 1.5, w, h, 3);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(X - w / 2, Y - h / 2, w, h, 3);
        ctx.fill();
        ctx.fillStyle = rgba('#fff0c8', 0.22);
        ctx.fillRect(X - w / 2 + 2, Y - h / 2 + 1, w - 4, 1.3);
      });
    }
    blotches(ctx, R, S, 18, ['#6a7a2c', '#8a8a30', '#4e5a22'], 14, 40, 0.7);
    leafDabs(ctx, R, S, 160, ['#c9a43a', '#e3c15b', '#b07a2e', '#f0d278'], 2.6, 4.8, 0.92);
  },
  planks(ctx, R, S) {
    ctx.fillStyle = '#6a4e36';
    ctx.fillRect(0, 0, S, S);
    const pw = 10;
    for (let x = 0; x < S; x += pw) {
      const col = vary('#8e6c4a', R(), 0.14);
      ctx.fillStyle = col;
      ctx.fillRect(x + 0.8, 0, pw - 1.6, S);
      strokes(ctx, R, S, 0, [col]);
      for (let k = 0; k < 6; k++) {
        const y = R() * S;
        ctx.fillStyle = rgba('#3e2a1c', 0.3);
        ctx.fillRect(x + 1 + R() * (pw - 3), y, 0.8, 8 + R() * 20);
      }
      ctx.fillStyle = rgba('#e0c49a', 0.2);
      ctx.fillRect(x + pw - 2.4, 0, 1, S);
    }
  },
  basalt(ctx, R, S) {
    ctx.fillStyle = '#2e2430';
    ctx.fillRect(0, 0, S, S);
    // hexagonal basalt column tops (tileable 6 × 8 grid, squashed for the top-down view), each column at
    // its own height: some stand proud and catch the light, some are sunken in violet shade
    const cols = 6;
    const rows = 8;
    const dx = S / cols;
    const dy = S / rows;
    for (let j = -1; j <= rows; j++) {
      for (let i = -1; i <= cols; i++) {
        const cx = (i + (j % 2 ? 0.5 : 0)) * dx + (R() - 0.5) * 3;
        const cy = j * dy + (R() - 0.5) * 3;
        const h = R();
        const r = dx * (0.52 + R() * 0.06);
        const lift = h > 0.8 ? 0.95 : h < 0.15 ? 0.05 : 0.35 + R() * 0.3;
        const base = mix('#4a3e4c', '#9a8888', lift * 0.85);
        const rot = (R() - 0.5) * 0.12;
        wrapDraw(S, cx, cy, r + 3, (X, Y) => {
          const pts = [];
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3 + rot;
            const kk = 0.86 + R() * 0.1;
            pts.push([X + Math.cos(a) * r * kk, Y + Math.sin(a) * r * 0.74 * kk]);
          }
          ctx.beginPath();
          pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.closePath();
          ctx.fillStyle = base;
          ctx.fill();
          ctx.save();
          ctx.clip();
          const gr = ctx.createLinearGradient(X + r, Y - r, X - r, Y + r);
          gr.addColorStop(0, rgba('#ffe2c0', 0.22 + lift * 0.2));
          gr.addColorStop(0.5, rgba('#ffe2c0', 0));
          gr.addColorStop(1, rgba('#1a1020', 0.3));
          ctx.fillStyle = gr;
          ctx.fillRect(X - r, Y - r, r * 2, r * 2);
          if (R() < 0.4) brush(ctx, X - r * 0.4, Y + (R() - 0.5) * r * 0.5, r * 0.8, 0.8, (R() - 0.5) * 1.2, rgba('#1a1020', 0.45));
          if (R() < 0.35) dab(ctx, X + (R() - 0.5) * r, Y + (R() - 0.5) * r * 0.5, r * 0.3, r * 0.18, R(), rgba(R() < 0.5 ? '#8a9a58' : '#c0a860', 0.45));
          ctx.restore();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = rgba('#f0cfae', 0.3 + lift * 0.3);
          ctx.beginPath();
          ctx.moveTo(pts[3][0], pts[3][1]);
          ctx.lineTo(pts[4][0], pts[4][1]);
          ctx.lineTo(pts[5][0], pts[5][1]);
          ctx.lineTo(pts[0][0], pts[0][1]);
          ctx.stroke();
          ctx.strokeStyle = rgba('#140c14', 0.6);
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.lineTo(pts[1][0], pts[1][1]);
          ctx.lineTo(pts[2][0], pts[2][1]);
          ctx.lineTo(pts[3][0], pts[3][1]);
          ctx.stroke();
        });
      }
    }
    specks(ctx, R, S, 50, ['#c9b890', '#2a2028', '#8a9a60'], 0.6, 1.8, 0.5);
    blades(ctx, R, S, 40, ['#7c7a44', '#a09a58', '#c9b870'], 3, 6, 0.7);
  },
  // ---- thicket
  streambed(ctx, R, S) {
    ctx.fillStyle = '#5a6a48';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 12, ['#6e7a52', '#4a5a40', '#8a8a58'], 24, 70, 0.5);
    specks(ctx, R, S, 90, ['#a09a70', '#3e4a34', '#c9b870'], 0.8, 2.6, 0.6);
  },
  moss(ctx, R, S) {
    ctx.fillStyle = '#4c4a26';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 16, ['#5e5c2e', '#3e3c20', '#6a6232', '#43422a'], 24, 70, 0.6);
    specks(ctx, R, S, 240, ['#6e6e34', '#7c7a3c', '#2e2c18', '#8a8a44'], 0.8, 2.2, 0.55);
    leafDabs(ctx, R, S, 40, ['#b08a30', '#8a5a26', '#c9a43a'], 2.5, 4.5, 0.7);
  },
  leaflitter(ctx, R, S) {
    ctx.fillStyle = '#4e3f22';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 16, ['#5e4c28', '#3e3018', '#6a5a2c', '#584020'], 24, 80, 0.6);
    leafDabs(ctx, R, S, 520, ['#c9a43a', '#e3c15b', '#b07a2e', '#8a4a24', '#d9b54a', '#6f5a2a', '#a8742a', '#f0d278'], 2.6, 5.4, 0.92);
    specks(ctx, R, S, 60, ['#2a200e', '#f6e2a0'], 0.5, 1.2, 0.5);
  },
  goldgrass(ctx, R, S) {
    ctx.fillStyle = '#716a2c';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 16, ['#857c34', '#5c5624', '#9a8c3c', '#6a6a2e'], 24, 80, 0.55);
    blades(ctx, R, S, 620, ['#a39a44', '#cdb95a', '#5c5a26', '#e6cf72', '#8a8438'], 4, 10, 0.85);
    leafDabs(ctx, R, S, 50, ['#e3c15b', '#c9a43a', '#b07a2e'], 2.4, 4, 0.85);
  },
  dirt(ctx, R, S) {
    ctx.fillStyle = '#8c6c42';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 14, ['#9a7a4c', '#7a5c38', '#a8885a'], 24, 70, 0.55);
    strokes(ctx, R, S, 90, ['#b8966a', '#6a4e30'], { len: [4, 10], w: [1, 2], ang: 0.1, spread: 0.7, alpha: [0.25, 0.5] });
    specks(ctx, R, S, 80, ['#5e4428', '#d8c098', '#a89070'], 0.7, 2.2, 0.6);
    leafDabs(ctx, R, S, 26, ['#c9a43a', '#b07a2e', '#e3c15b'], 2.4, 4.2, 0.8);
  },
  wildflowers(ctx, R, S) {
    TEXTURES.goldgrass(ctx, R, S);
  },
  mossstone(ctx, R, S) {
    ctx.fillStyle = '#5e5a44';
    ctx.fillRect(0, 0, S, S);
    const cell = 32;
    for (let y = 0; y < S; y += cell) {
      const off = (y / cell) % 2 ? cell / 2 : 0;
      for (let x = -cell; x < S; x += cell) {
        const X = x + off;
        ctx.fillStyle = vary('#8a846a', R(), 0.14);
        ctx.beginPath();
        ctx.roundRect(X + 1.4, y + 1.4, cell - 2.8, cell - 2.8, 4);
        ctx.fill();
        ctx.fillStyle = rgba('#fff0c8', 0.14);
        ctx.fillRect(X + 3, y + 2.2, cell - 7, 1.3);
      }
    }
    blotches(ctx, R, S, 16, ['#5a6028', '#4a5020', '#7a7a34', '#3a3a20'], 16, 60, 0.55);
    specks(ctx, R, S, 90, ['#7a8038', '#5c6428', '#a0a050'], 0.8, 2.6, 0.55);
    leafDabs(ctx, R, S, 90, ['#c9a43a', '#e3c15b', '#b07a2e', '#8a4a24'], 2.4, 4.6, 0.85);
  },
  mossrock(ctx, R, S) {
    ctx.fillStyle = '#76643e';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, R, S, 16, ['#8a7446', '#5e5030', '#6a6a30', '#9a8a50'], 20, 70, 0.6);
    strokes(ctx, R, S, 180, ['#a08a58', '#4e4028', '#c0a868'], { len: [4, 12], w: [1, 3], ang: -0.6, spread: 0.4, alpha: [0.25, 0.5] });
    blades(ctx, R, S, 160, ['#8a8a3c', '#a8a044', '#5e5c2a', '#d4c05a'], 3, 7, 0.75);
  },
  // ---- spire / summit
  brass(ctx, R, S) {
    ctx.fillStyle = '#5e4822';
    ctx.fillRect(0, 0, S, S);
    plates(ctx, R, S, 64, '#80622e', '#2e2210', '#e8c16a', { rivets: '#4a3818', jitter: 0.07 });
    // engraved arcs
    for (let i = 0; i < 10; i++) {
      const x = R() * S;
      const y = R() * S;
      const r = 14 + R() * 40;
      wrapDraw(S, x, y, r + 2, (X, Y) => {
        ctx.strokeStyle = rgba('#3e2e14', 0.28);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(X, Y, r, R() * TAU, R() * TAU + 1.4);
        ctx.stroke();
        ctx.strokeStyle = rgba('#f0cf7a', 0.12);
        ctx.beginPath();
        ctx.arc(X + 0.8, Y - 0.8, r, 0.3, 1.5);
        ctx.stroke();
      });
    }
    blotches(ctx, R, S, 12, ['#4f8a78', '#3c6a5c'], 10, 36, 0.18); // verdigris
    blotches(ctx, R, S, 10, ['#f0cf7a', '#2a1c0c'], 20, 60, 0.12);
    strokes(ctx, R, S, 70, ['#f3d890', '#3a2a12'], { len: [6, 16], w: [0.5, 1], ang: 0.4, spread: 0.3, alpha: [0.1, 0.25] });
  },
  terrace(ctx, R, S) {
    // warm sandstone slabs of the Spire's terraces, laid in staggered courses with brass inlay lines
    ctx.fillStyle = '#4a3c32';
    ctx.fillRect(0, 0, S, S);
    const rowH = 32;
    for (let y = 0; y < S; y += rowH) {
      const off = (y / rowH) % 2 ? 32 : 0;
      for (let x = -64; x < S; x += 64) {
        const X = x + off;
        const col = vary('#9a8a74', R(), 0.1);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(X + 1.2, y + 1.2, 61.6, rowH - 2.4, 2.5);
        ctx.fill();
        const gr = ctx.createLinearGradient(X + 60, y, X, y + rowH);
        gr.addColorStop(0, 'rgba(255,236,200,0.22)');
        gr.addColorStop(1, 'rgba(40,24,30,0.18)');
        ctx.fillStyle = gr;
        ctx.fillRect(X + 1.2, y + 1.2, 61.6, rowH - 2.4);
        if (R() < 0.3) {
          // engraved clock-ring motif on some slabs
          ctx.strokeStyle = rgba('#3e3026', 0.35);
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.arc(X + 32, y + rowH / 2, 9, 0, TAU);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(X + 32, y + rowH / 2);
          ctx.lineTo(X + 32, y + rowH / 2 - 7);
          ctx.moveTo(X + 32, y + rowH / 2);
          ctx.lineTo(X + 37, y + rowH / 2 + 2);
          ctx.stroke();
        }
        if (R() < 0.35) brush(ctx, X + 6 + R() * 40, y + 6 + R() * 18, 10 + R() * 16, 0.8, (R() - 0.5) * 1.4, rgba('#3e3026', 0.4)); // crack
      }
      // brass inlay along every other course
      if ((y / rowH) % 4 === 1) {
        ctx.fillStyle = rgba('#e8c16a', 0.55);
        ctx.fillRect(0, y - 1, S, 1.6);
        ctx.fillStyle = rgba('#5a4220', 0.5);
        ctx.fillRect(0, y + 0.6, S, 0.8);
      }
    }
    blotches(ctx, R, S, 10, ['#6a5a50', '#b8a080', '#f0cf7a'], 20, 60, 0.18);
    specks(ctx, R, S, 70, ['#40342e', '#d8c8b0'], 0.5, 1.4, 0.45);
  },
  runner(ctx, R, S) {
    ctx.fillStyle = '#5a2a2a';
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) {
      ctx.fillStyle = rgba(y % 32 ? '#7a3a32' : '#6a3030', 0.8);
      ctx.fillRect(0, y, S, 14);
    }
    strokes(ctx, R, S, 80, ['#c9985a', '#3a1818'], { len: [4, 10], w: [0.6, 1.4], ang: 0, spread: 0.3, alpha: [0.2, 0.4] });
  },
  girder(ctx, R, S) {
    ctx.fillStyle = '#6e5228';
    ctx.fillRect(0, 0, S, S);
    plates(ctx, R, S, 32, '#8e6c34', '#2a1c0c', '#f0c96a', { rivets: '#3e2c14', jitter: 0.06 });
  },
  gearfloor(ctx, R, S) {
    TEXTURES.brass(ctx, R, S);
  },
  stairs(ctx, R, S) {
    ctx.fillStyle = '#4a3c30';
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 10) {
      ctx.fillStyle = vary('#8a7a66', R(), 0.08);
      ctx.fillRect(0, y, S, 7);
      ctx.fillStyle = rgba('#fff0d0', 0.25);
      ctx.fillRect(0, y, S, 1.2);
    }
  },
  brasswall(ctx, R, S) {
    ctx.fillStyle = '#6a5026';
    ctx.fillRect(0, 0, S, S);
    plates(ctx, R, S, 32, '#8a6a32', '#2e2210', '#f0cf7a', { rivets: '#3e2c14', jitter: 0.08 });
    blotches(ctx, R, S, 10, ['#4f8a78'], 8, 26, 0.2);
  },
  marble(ctx, R, S) {
    ctx.fillStyle = '#6a5a52';
    ctx.fillRect(0, 0, S, S);
    plates(ctx, R, S, 64, '#9a8878', '#2e221e', '#ffe8c0', { jitter: 0.06, inset: 1 });
    // veins
    for (let i = 0; i < 16; i++) {
      const x = R() * S;
      const y = R() * S;
      const L = 30 + R() * 60;
      wrapDraw(S, x, y, L, (X, Y) => {
        ctx.strokeStyle = rgba(R() < 0.6 ? '#4a3a34' : '#f0d8b0', 0.2);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.bezierCurveTo(X + L * 0.3, Y + 10, X + L * 0.6, Y - 12, X + L, Y + 4);
        ctx.stroke();
      });
    }
    blotches(ctx, R, S, 10, ['#f0c060', '#2a1a18'], 20, 60, 0.12);
  },
  dialfloor(ctx, R, S) {
    TEXTURES.marble(ctx, R, S);
  },
};

const _texCache = new Map();
/**
 * Tileable texture canvas for an id at quality q (cached).
 * @returns {HTMLCanvasElement|null}
 */
export function texture(id, q = 1) {
  const key = `${id}@${q}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const size = Math.round(TEX * q);
  const c = makeCanvas(size, size);
  if (c) {
    const ctx = c.getContext('2d');
    ctx.scale(size / TEX, size / TEX);
    const fn = TEXTURES[id] ?? TEXTURES.sand;
    if (!TEXTURES[id]) warnOnce(`unknown texture "${id}"`);
    let seed = 0;
    for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
    fn(ctx, rng(seed ^ 0x5eed), TEX);
  }
  _texCache.set(key, c);
  return c;
}

/** Pattern for a texture, scaled so one texel = 1/q logical px. */
function patternFor(ctx, id, q) {
  const c = texture(id, q);
  if (!c) return '#888';
  const p = ctx.createPattern(c, 'repeat');
  if (p && typeof p.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
    p.setTransform(new DOMMatrix().scale(1 / q));
  }
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════ terrain chunks

/** Chunk edge length in tiles. */
export const CHUNK = 16;
/** Terrain field samples per tile (contour resolution TILE/SUB px). */
const SUB = 4;

const LEVEL_SHADOW = { 2: 0.1, 3: 0.14, 4: 0.18 };
/** Contour threshold of the organic terrain fills. */
const ORGANIC_TH = 0.25;
/** Opaque base laid under fully covered tiles (matches each zone's underlay so seams stay invisible). */
const COVER_BASE = { sea: '#2c6a74', pond: '#23413a' };

/**
 * Pre-renders and draws one map's terrain.
 */
export class WorldRenderer {
  /**
   * @param {import('./tilemap.js').TileMap} map
   * @param {string} zone
   * @param {{quality?:number, props?:object[], pixelRatio?:number}} [opts] quality = chunk/texture resolution;
   *   pixelRatio = device px per stage px of the target canvas
   */
  constructor(map, zone, { quality = 1, props = [], pixelRatio = 1 } = {}) {
    this.map = map;
    this.zone = zone;
    this.style = ZONE_STYLES[zone] ?? ZONE_STYLES.shore;
    this.pal = ZONE_PALETTES[zone] ?? ZONE_PALETTES.shore;
    this.q = clamp(quality, 0.75, 1.5);
    this.props = props;
    /** Backing pixels per logical pixel of the target canvas (sprites snap to whole device pixels). */
    this.pixelRatio = pixelRatio > 0 ? pixelRatio : 1;
    /** Cheaper per-frame drawing for software-rasterised canvases (no underlay glints, no canopy sway). */
    this.lowQuality = false;
    this.cols = Math.ceil(map.w / CHUNK);
    this.rows = Math.ceil(map.h / CHUNK);
    this.chunks = new Array(this.cols * this.rows).fill(null);
    this.buildMs = 0;
    this._waterTiles = null;
    this._tall = null;
    this._under = null;
    this._fx = null;
    this._cover = null;
    this._rectCache = { key: '', world: [], screen: [] };
    this._scanTiles();
  }

  /**
   * Collect water tiles (for glints) and tall tiles (trees, pillars…) once. Tall tiles that nothing can ever
   * stand behind (no walkable tile in the 5×5 block above/beside them) are baked into the terrain chunks;
   * the rest stay y-sorted sprites so the party can walk behind them.
   */
  _scanTiles() {
    const { map } = this;
    const water = [];
    const tall = [];
    const baked = [];
    const canHide = (x, y) => {
      for (let dy = -4; dy <= 0; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          if (map.isWalkableTerrain(x + dx, y + dy)) return true;
        }
      }
      return false;
    };
    // Calmer canopy away from where the party walks (SPEC §5 readability): 1 = beside a walkable tile, 2 = deeper.
    const calmLevel = (x, y) => {
      if (!this.style.calm) return 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && map.isWalkableTerrain(x + dx, y + dy)) return 1;
      }
      return 2;
    };
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.tileAt(x, y);
        if (t.water) water.push(x, y, t.walk ? 1 : 0);
        if (t.tall) {
          const h = hash2(x, y, 77);
          const d = {
            tx: x,
            ty: y,
            kind: t.id,
            variant: Math.floor(h * 4),
            jx: (hash2(x, y, 78) - 0.5) * 10,
            jy: (hash2(x, y, 79) - 0.5) * 6,
            flip: hash2(x, y, 80) < 0.5,
            calm: t.id === 'tree' || t.id === 'bush' ? calmLevel(x, y) : 0,
          };
          if (canHide(x, y)) tall.push(d);
          else baked.push(d);
        }
      }
    }
    this._waterTiles = water;
    this._tall = tall;
    this._baked = baked;
    this._gears = this._findGears();
    this._tallByChunk = new Map();
    for (const t of tall) {
      const k = Math.floor(t.ty / CHUNK) * this.cols + Math.floor(t.tx / CHUNK);
      if (!this._tallByChunk.has(k)) this._tallByChunk.set(k, []);
      this._tallByChunk.get(k).push(t);
    }
  }

  /**
   * Group gear-floor tiles into clusters; each cluster becomes one or more big meshing gears laid into the
   * floor (their recesses are baked, the gears themselves turn every frame).
   */
  _findGears() {
    const { map } = this;
    const seen = new Uint8Array(map.w * map.h);
    const out = [];
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (seen[y * map.w + x] || map.typeAt(x, y) !== 'gear') continue;
        let x0 = x;
        let x1 = x;
        let y0 = y;
        let y1 = y;
        const stack = [[x, y]];
        seen[y * map.w + x] = 1;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          x0 = Math.min(x0, cx);
          x1 = Math.max(x1, cx);
          y0 = Math.min(y0, cy);
          y1 = Math.max(y1, cy);
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + ox;
            const ny = cy + oy;
            if (!map.inBounds(nx, ny) || seen[ny * map.w + nx] || map.typeAt(nx, ny) !== 'gear') continue;
            seen[ny * map.w + nx] = 1;
            stack.push([nx, ny]);
          }
        }
        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;
        const short = Math.min(w, h);
        const n = Math.max(1, Math.round(Math.max(w, h) / short));
        const r = (short * TILE) / 2 - 3;
        for (let i = 0; i < n; i++) {
          const along = (i + 0.5) / n;
          out.push({
            x: w >= h ? (x0 + along * w) * TILE : (x0 + w / 2) * TILE,
            y: w >= h ? (y0 + h / 2) * TILE : (y0 + along * h) * TILE,
            r: n > 1 ? Math.min(r, ((Math.max(w, h) * TILE) / n) / 2 - 1) : r,
            dir: i % 2 ? -1 : 1,
            phase: hash2(x0, y0, i) * TAU,
          });
        }
      }
    }
    return out;
  }

  /** Big turning gears set into gear floors (world transform applied). */
  drawLiveFloor(ctx, cam, t, vw = 1280, vh = 720) {
    const gears = this._gears;
    if (!gears || !gears.length) return;
    for (const g of gears) {
      if (g.x + g.r < cam.x || g.x - g.r > cam.x + vw || g.y + g.r < cam.y || g.y - g.r > cam.y + vh) continue;
      const spr = gearSprite(Math.round(g.r));
      if (!spr) continue;
      const ang = g.phase + g.dir * t * (0.012 / g.r);
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(ang);
      ctx.drawImage(spr, -g.r - 2, -g.r - 2, g.r * 2 + 4, g.r * 2 + 4);
      ctx.restore();
      // fixed lighting over the turning gear (top-right warm, bottom-left violet)
      ctx.save();
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, TAU);
      ctx.clip();
      const lg = ctx.createLinearGradient(g.x + g.r, g.y - g.r, g.x - g.r, g.y + g.r);
      lg.addColorStop(0, 'rgba(255,236,190,0.28)');
      lg.addColorStop(0.5, 'rgba(255,236,190,0)');
      lg.addColorStop(1, 'rgba(30,16,40,0.3)');
      ctx.fillStyle = lg;
      ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
      ctx.restore();
    }
  }

  /** Build every chunk now (call during a fade). Returns ms spent. */
  buildAll() {
    const t0 = now();
    for (let cy = 0; cy < this.rows; cy++) for (let cx = 0; cx < this.cols; cx++) this._chunk(cx, cy);
    this.buildMs = now() - t0;
    return this.buildMs;
  }

  _chunk(cx, cy) {
    const i = cy * this.cols + cx;
    if (this.chunks[i]) return this.chunks[i];
    let c = null;
    try {
      c = this._buildChunk(cx, cy);
    } catch (err) {
      warnOnce(`chunk build failed: ${err?.message ?? err}`);
      console.error(err);
    }
    this.chunks[i] = c;
    return c;
  }

  /** Free the offscreen canvases. */
  dispose() {
    for (const c of this.chunks) {
      if (c) {
        c.width = 1;
        c.height = 1;
      }
    }
    this.chunks.fill(null);
  }

  // ─────────────────────────────────────────────────── chunk painting

  _buildChunk(cx, cy) {
    const { map, q, style } = this;
    const px = CHUNK * TILE;
    const c = makeCanvas(px * q, px * q);
    if (!c) return null;
    const ctx = c.getContext('2d');
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    ctx.setTransform(q, 0, 0, q, -x0 * TILE * q, -y0 * TILE * q);
    const M = 2; // margin tiles (blobs overlap across chunk edges)
    const area = { x0: x0 - M, y0: y0 - M, x1: Math.min(map.w - 1, x0 + CHUNK + M - 1), y1: Math.min(map.h - 1, y0 + CHUNK + M - 1) };
    area.x0 = Math.max(0, area.x0);
    area.y0 = Math.max(0, area.y0);

    // opaque base under covered tiles: the underlay is skipped there (see _coverMask)
    const cover = this._coverMask();
    const base = this._rectPath({ x0, y0, x1: Math.min(map.w, x0 + CHUNK) - 1, y1: Math.min(map.h, y0 + CHUNK) - 1 }, (x, y) => cover[y * map.w + x] === 1, 0.5);
    if (base) this._fillPath(ctx, base, COVER_BASE[style.underlay] ?? this.pal.sky?.[1] ?? '#2a2030');

    if (style.organic) this._paintOrganic(ctx, area);
    else this._paintArchitectural(ctx, area);
    this._paintOverlays(ctx, area);
    this._paintRaised(ctx, area);
    this._paintRocks(ctx, area);
    this._paintDeco(ctx, area);
    this._paintTallShadows(ctx, area);
    this._paintPropShadows(ctx, area);
    this._paintGrade(ctx, area, cx, cy);
    this._paintBaked(ctx, cx, cy);
    return c;
  }

  /**
   * Smooth scalar field over the whole map, sampled every TILE/SUB px at tile-corner resolution: a
   * normalised kernel blur of per-tile values plus a little value noise (organic wobble). Cached by key.
   * @param {string} key
   * @param {(tx:number, ty:number)=>number} valueFn per-tile value 0..1
   * @param {{radius?:number, noise?:number, seed?:number}} [o]
   */
  _field(key, valueFn, { radius = 1.4, noise = 0.1, seed = 1 } = {}) {
    if (!this._fields) this._fields = new Map();
    if (this._fields.has(key)) return this._fields.get(key);
    const { map } = this;
    const w = map.w;
    const h = map.h;
    const vals = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) vals[y * w + x] = valueFn(x, y);
    const SW = w * SUB + 1;
    const SH = h * SUB + 1;
    const f = new Float32Array(SW * SH);
    const R = radius;
    const R2 = R * R;
    for (let j = 0; j < SH; j++) {
      const sy = j / SUB;
      const ty0 = Math.floor(sy - R - 0.5);
      const ty1 = Math.ceil(sy + R - 0.5);
      for (let i = 0; i < SW; i++) {
        const sx = i / SUB;
        const tx0 = Math.floor(sx - R - 0.5);
        const tx1 = Math.ceil(sx + R - 0.5);
        let sum = 0;
        let ws = 0;
        for (let ty = ty0; ty <= ty1; ty++) {
          const dy = sy - (ty + 0.5);
          const cy = ty < 0 ? 0 : ty >= h ? h - 1 : ty;
          for (let tx = tx0; tx <= tx1; tx++) {
            const dx = sx - (tx + 0.5);
            const d2 = dx * dx + dy * dy;
            if (d2 >= R2) continue;
            const k = 1 - Math.sqrt(d2) / R;
            const wt = k * k;
            const cx = tx < 0 ? 0 : tx >= w ? w - 1 : tx;
            sum += vals[cy * w + cx] * wt;
            ws += wt;
          }
        }
        let v = ws > 0 ? sum / ws : 0;
        if (noise) v += (vnoise(sx * 0.9, sy * 0.9, seed) - 0.5) * noise + (vnoise(sx * 2.3, sy * 2.3, seed + 9) - 0.5) * noise * 0.5;
        f[j * SW + i] = v;
      }
    }
    const field = { f, SW, SH };
    this._fields.set(key, field);
    return field;
  }

  /**
   * Region where field > th, as a Path2D, over the chunk area (marching squares; interior runs merged).
   * @returns {Path2D|null}
   */
  _contour(field, th, area) {
    const { f, SW } = field;
    const cs = TILE / SUB;
    const i0 = area.x0 * SUB;
    const i1 = (area.x1 + 1) * SUB;
    const j0 = area.y0 * SUB;
    const j1 = (area.y1 + 1) * SUB;
    const p = new Path2D();
    let any = false;
    const lerpT = (a, b) => (th - a) / (b - a);
    for (let j = j0; j < j1; j++) {
      let run = -1;
      const y = j * cs;
      for (let i = i0; i <= i1; i++) {
        let full = false;
        let a = 0;
        let b = 0;
        let c = 0;
        let d = 0;
        if (i < i1) {
          a = f[j * SW + i];
          b = f[j * SW + i + 1];
          c = f[(j + 1) * SW + i + 1];
          d = f[(j + 1) * SW + i];
          full = a > th && b > th && c > th && d > th;
        }
        if (full) {
          if (run < 0) run = i;
          continue;
        }
        if (run >= 0) {
          p.rect(run * cs - 0.25, y - 0.25, (i - run) * cs + 0.5, cs + 0.5);
          any = true;
          run = -1;
        }
        if (i >= i1) break;
        const ia = a > th;
        const ib = b > th;
        const ic = c > th;
        const id = d > th;
        if (!ia && !ib && !ic && !id) continue;
        const x = i * cs;
        // walk TL → TR → BR → BL, emitting inside corners and edge crossings
        const pts = [];
        if (ia) pts.push(x, y);
        if (ia !== ib) pts.push(x + cs * lerpT(a, b), y);
        if (ib) pts.push(x + cs, y);
        if (ib !== ic) pts.push(x + cs, y + cs * lerpT(b, c));
        if (ic) pts.push(x + cs, y + cs);
        if (ic !== id) pts.push(x + cs * (1 - lerpT(c, d)), y + cs);
        if (id) pts.push(x, y + cs);
        if (id !== ia) pts.push(x, y + cs * (1 - lerpT(d, a)));
        if (pts.length < 6) continue;
        // expand very slightly from the cell centre to hide anti-aliasing seams between cells
        const mx = x + cs / 2;
        const my = y + cs / 2;
        for (let k = 0; k < pts.length; k += 2) {
          const px = pts[k] + (pts[k] - mx) * 0.03;
          const py = pts[k + 1] + (pts[k + 1] - my) * 0.03;
          if (k === 0) p.moveTo(px, py);
          else p.lineTo(px, py);
        }
        p.closePath();
        any = true;
      }
    }
    return any ? p : null;
  }

  /** Organic region for tiles matching a predicate (smooth contour). */
  _region(key, area, pred, th = 0.4, o = {}) {
    const field = this._field(key, (x, y) => (pred(x, y) ? 1 : 0), o);
    return this._contour(field, th, area);
  }

  /** Path of (slightly expanded) tile rects for tiles matching pred. */
  _rectPath(area, pred, grow = 0.5) {
    const p = new Path2D();
    let any = false;
    for (let ty = area.y0; ty <= area.y1; ty++) {
      let run = -1;
      for (let tx = area.x0; tx <= area.x1 + 1; tx++) {
        const on = tx <= area.x1 && pred(tx, ty);
        if (on && run < 0) run = tx;
        if (!on && run >= 0) {
          p.rect(run * TILE - grow, ty * TILE - grow, (tx - run) * TILE + grow * 2, TILE + grow * 2);
          any = true;
          run = -1;
        }
      }
    }
    return any ? p : null;
  }

  _fillPath(ctx, path, fill, dx = 0, dy = 0, alpha = 1) {
    if (!path) return;
    ctx.save();
    if (dx || dy) ctx.translate(dx, dy);
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fill(path);
    ctx.restore();
  }

  /** Smoothed stack-level field for organic terrain level L (shared by painting and the underlay cover mask). */
  _levelField(L) {
    const { map } = this;
    return this._field(`lv${L}`, (x, y) => clamp((map.levelAt(x, y) - L + 1) / 2, 0, 1), { radius: 1.45, noise: 0.14, seed: 11 + L * 7 });
  }

  /**
   * Per-tile mask of where the terrain chunks are fully opaque, so the animated underlay (sea, pond, sky) is only
   * painted where it can show through. Organic zones: every contour sample of the tile is inside the level-1 fill;
   * architectural zones: solid floor. `_buildChunk` lays an opaque base under covered tiles, so anti-aliased seams
   * between contour cells never reveal the empty canvas.
   * @returns {Uint8Array} 1 = covered
   */
  _coverMask() {
    if (this._cover) return this._cover;
    const { map, style } = this;
    const cover = new Uint8Array(map.w * map.h);
    if (style.organic) {
      const { f, SW } = this._levelField(1);
      const TH = ORGANIC_TH + 0.03;
      for (let ty = 0; ty < map.h; ty++) {
        for (let tx = 0; tx < map.w; tx++) {
          let inside = true;
          for (let j = ty * SUB; j <= (ty + 1) * SUB && inside; j++) {
            for (let i = tx * SUB; i <= (tx + 1) * SUB; i++) {
              if (!(f[j * SW + i] > TH)) {
                inside = false;
                break;
              }
            }
          }
          if (inside) cover[ty * map.w + tx] = 1;
        }
      }
    } else {
      for (let ty = 0; ty < map.h; ty++) {
        for (let tx = 0; tx < map.w; tx++) if (map.levelAt(tx, ty) >= 1 && !map.tileAt(tx, ty).abyss) cover[ty * map.w + tx] = 1;
      }
    }
    this._cover = cover;
    return cover;
  }

  _paintOrganic(ctx, area) {
    const { style, q } = this;
    const TH = ORGANIC_TH;
    for (let L = 1; L <= 4; L++) {
      const texId = style.levels[L];
      if (!texId) continue;
      const field = this._levelField(L);
      const path = this._contour(field, TH, area);
      if (!path) continue;
      if (L === 1) {
        // soft feathered edge into the water underlay
        const fc = this.zone === 'thicket' ? '#3e5e48' : '#6aaaa4';
        this._fillPath(ctx, this._contour(field, TH - 0.14, area), fc, 0, 0, 0.22);
        this._fillPath(ctx, this._contour(field, TH - 0.08, area), fc, 0, 0, 0.3);
        this._fillPath(ctx, this._contour(field, TH - 0.03, area), fc, 0, 0, 0.4);
      } else {
        this._fillPath(ctx, path, 'rgba(40,20,40,1)', -2, 3, LEVEL_SHADOW[L] ?? 0.12);
      }
      if (L === 2 && this.zone === 'shore') {
        // pale wet line where the sand meets the shallows
        this._fillPath(ctx, this._contour(field, TH - 0.05, area), '#f6f0e2', 0, 0, 0.5);
      }
      // sunlit rim on the top-right of each rise, then the terrain itself
      if (L >= 3) this._fillPath(ctx, path, 'rgba(255,232,190,1)', 1.3, -1.3, 0.5);
      this._fillPath(ctx, path, patternFor(ctx, texId, q));
    }
  }

  _paintArchitectural(ctx, area) {
    const { map, style, q } = this;
    const solidFloor = (x, y) => map.levelAt(x, y) >= 1 && !map.tileAt(x, y).abyss;
    const floor = this._rectPath(area, solidFloor, 0.5);
    if (!floor) return;
    // floating-platform face over the void (bands darken downward)
    const [f0, f1, f2] = style.platformFace;
    const FH = 34;
    for (let k = FH; k >= 2; k -= 4) {
      const t = k / FH;
      this._fillPath(ctx, floor, t < 0.5 ? mix(f0, f1, t * 2) : mix(f1, f2, (t - 0.5) * 2), 0, k);
    }
    // deep drop shadow under the face
    this._fillPath(ctx, floor, 'rgba(10,6,20,1)', -10, FH + 16, 0.22);
    this._fillPath(ctx, floor, patternFor(ctx, style.levels[3], q));
    // trims along void edges
    this._edgeTrims(ctx, area, solidFloor);
  }

  /** Brass/gold rims (with rivets) along floor edges that face the void. */
  _edgeTrims(ctx, area, solidFloor) {
    const { map, style } = this;
    const trim = style.trim ?? '#e0b458';
    for (let ty = area.y0; ty <= area.y1; ty++) {
      for (let tx = area.x0; tx <= area.x1; tx++) {
        if (!solidFloor(tx, ty)) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        const open = (ox, oy) => map.inBounds(tx + ox, ty + oy) ? !solidFloor(tx + ox, ty + oy) : true;
        ctx.save();
        if (open(0, 1)) {
          ctx.fillStyle = shade(trim, -0.35);
          ctx.fillRect(x, y + TILE - 5, TILE, 5);
          ctx.fillStyle = trim;
          ctx.fillRect(x, y + TILE - 5, TILE, 1.6);
          for (let k = 6; k < TILE; k += 12) dab(ctx, x + k, y + TILE - 2.6, 1.2, 1.2, 0, shade(trim, 0.4));
        }
        if (open(0, -1)) {
          ctx.fillStyle = shade(trim, -0.2);
          ctx.fillRect(x, y, TILE, 3.5);
          ctx.fillStyle = shade(trim, 0.35);
          ctx.fillRect(x, y, TILE, 1.2);
        }
        if (open(-1, 0)) {
          ctx.fillStyle = shade(trim, -0.3);
          ctx.fillRect(x, y, 3.5, TILE);
        }
        if (open(1, 0)) {
          ctx.fillStyle = shade(trim, 0.1);
          ctx.fillRect(x + TILE - 3.5, y, 3.5, TILE);
          ctx.fillStyle = shade(trim, 0.5);
          ctx.fillRect(x + TILE - 1.4, y, 1.4, TILE);
        }
        ctx.restore();
      }
    }
  }

  _paintOverlays(ctx, area) {
    const { map, style, q } = this;
    const is = (id) => (x, y) => map.typeAt(x, y) === id;
    const ov = style.overlays;
    // paths
    if (style.organic) {
      const pf = this._field('path', (x, y) => (map.typeAt(x, y) === 'path' ? 1 : 0), { radius: 1.3, noise: 0.18, seed: 41 });
      // soft worn verge, then the trodden track (feathered: several slightly smaller contours)
      this._fillPath(ctx, this._contour(pf, 0.24, area), 'rgba(70,40,24,1)', 0, 0, 0.07);
      this._fillPath(ctx, this._contour(pf, 0.3, area), 'rgba(70,40,24,1)', 0, 0, 0.08);
      const pat = patternFor(ctx, ov.path, q);
      this._fillPath(ctx, this._contour(pf, 0.36, area), pat, 0, 0, 0.45);
      this._fillPath(ctx, this._contour(pf, 0.42, area), pat, 0, 0, 0.7);
      const core = this._contour(pf, 0.5, area);
      this._fillPath(ctx, core, pat);
      if (style.pathLight) {
        this._fillPath(ctx, this._contour(pf, 0.42, area), 'rgba(255,228,170,1)', 0, 0, style.pathLight * 0.5);
        this._fillPath(ctx, core, 'rgba(255,232,180,1)', 0, 0, style.pathLight);
      }
    } else {
      const path = this._rectPath(area, is('path'), 0);
      if (path) {
        this._fillPath(ctx, path, patternFor(ctx, ov.path, q));
        this._fillPath(ctx, path, 'rgba(240,200,110,1)', 0, 0, 0.06);
      }
    }
    // stone floors
    const stone = this._rectPath(area, is('stone'), 0.5);
    if (stone) {
      this._fillPath(ctx, stone, 'rgba(40,24,20,1)', -1.5, 2.5, 0.25);
      this._fillPath(ctx, stone, patternFor(ctx, ov.stone, q));
    }
    // decks (planks / bridges)
    for (let ty = area.y0; ty <= area.y1; ty++) {
      for (let tx = area.x0; tx <= area.x1; tx++) {
        const t = map.typeAt(tx, ty);
        if (t === 'planks' || t === 'bridge') this._deck(ctx, tx, ty, t, ov[t] ?? 'planks');
        else if (t === 'stairs') this._stairs(ctx, tx, ty);
        else if (t === 'gear') this._gearTile(ctx, tx, ty);
        else if (t === 'flowers') this._flowers(ctx, tx, ty);
      }
    }
    this._gearRecesses(ctx, area);
  }

  _deck(ctx, tx, ty, type, tex) {
    const { map, q } = this;
    const deck = (x, y) => TILE_TYPES[map.typeAt(x, y)].deck || (map.tileAt(x, y).walk && !map.tileAt(x, y).water && map.levelAt(x, y) >= 2);
    const horiz = deck(tx - 1, ty) || deck(tx + 1, ty);
    const vert = deck(tx, ty - 1) || deck(tx, ty + 1);
    const H = horiz && !(vert && !horiz);
    const x = tx * TILE;
    const y = ty * TILE;
    const arch = !this.style.organic;
    ctx.save();
    if (arch) {
      // gear bridge: girder with gear-tooth edges
      const w = TILE;
      ctx.fillStyle = 'rgba(10,6,16,0.35)';
      ctx.fillRect(x - 6, y + 14, w + 4, TILE);
      ctx.fillStyle = patternFor(ctx, tex, q);
      if (H) ctx.fillRect(x - 0.5, y + 5, w + 1, TILE - 10);
      else ctx.fillRect(x + 5, y - 0.5, TILE - 10, TILE + 1);
      ctx.fillStyle = '#3e2c14';
      const teeth = (sx, sy, horizontal) => {
        for (let k = 0; k < 4; k++) {
          if (horizontal) ctx.fillRect(sx + k * 10 + 2, sy, 6, 4);
          else ctx.fillRect(sx, sy + k * 10 + 2, 4, 6);
        }
      };
      if (H) {
        teeth(x, y + 1, true);
        teeth(x, y + TILE - 5, true);
        ctx.fillStyle = '#e8c16a';
        ctx.fillRect(x, y + 5, TILE, 1.2);
        ctx.fillStyle = '#2a1c0c';
        ctx.fillRect(x, y + TILE - 6, TILE, 1.4);
      } else {
        teeth(x + 1, y, false);
        teeth(x + TILE - 5, y, false);
        ctx.fillStyle = '#e8c16a';
        ctx.fillRect(x + TILE - 6, y, 1.2, TILE);
        ctx.fillStyle = '#2a1c0c';
        ctx.fillRect(x + 5, y, 1.4, TILE);
      }
      ctx.restore();
      return;
    }
    // wooden boardwalk / bridge
    const inset = type === 'bridge' ? 4 : 6;
    ctx.fillStyle = 'rgba(20,12,24,0.35)';
    if (H) ctx.fillRect(x - 3, y + inset + 5, TILE + 2, TILE - inset * 2);
    else ctx.fillRect(x + inset - 4, y + 3, TILE - inset * 2, TILE + 2);
    // posts
    ctx.fillStyle = '#3a281c';
    if (H) {
      if (tx % 2 === 0) {
        ctx.fillRect(x + 2, y + inset - 3, 4, TILE - inset * 2 + 8);
      }
    } else if (ty % 2 === 0) ctx.fillRect(x + inset - 3, y + 2, TILE - inset * 2 + 6, 4);
    ctx.translate(x + TILE / 2, y + TILE / 2);
    if (!H) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = patternFor(ctx, tex, q);
    ctx.fillRect(-TILE / 2 - 0.5, -TILE / 2 + inset, TILE + 1, TILE - inset * 2);
    // plank seams across the walking direction
    for (let k = -TILE / 2; k < TILE / 2; k += 8) {
      ctx.fillStyle = rgba('#2e1e14', 0.45);
      ctx.fillRect(k, -TILE / 2 + inset, 1, TILE - inset * 2);
      ctx.fillStyle = rgba('#e6c89a', 0.18);
      ctx.fillRect(k + 1, -TILE / 2 + inset, 1, TILE - inset * 2);
    }
    ctx.fillStyle = rgba('#f0d8a8', 0.3);
    ctx.fillRect(-TILE / 2, -TILE / 2 + inset, TILE, 1.4);
    ctx.fillStyle = rgba('#20140c', 0.5);
    ctx.fillRect(-TILE / 2, TILE / 2 - inset - 1.4, TILE, 1.4);
    if (type === 'bridge') {
      // rails
      ctx.fillStyle = '#4a3222';
      ctx.fillRect(-TILE / 2, -TILE / 2 + inset - 3, TILE, 3);
      ctx.fillRect(-TILE / 2, TILE / 2 - inset, TILE, 3);
      ctx.fillStyle = rgba('#e0c090', 0.4);
      ctx.fillRect(-TILE / 2, -TILE / 2 + inset - 3, TILE, 1);
    }
    ctx.restore();
  }

  _stairs(ctx, tx, ty) {
    const x = tx * TILE;
    const y = ty * TILE;
    ctx.save();
    ctx.fillStyle = patternFor(ctx, 'stairs', this.q);
    ctx.fillRect(x - 0.5, y - 0.5, TILE + 1, TILE + 1);
    ctx.fillStyle = 'rgba(20,10,20,0.25)';
    ctx.fillRect(x, y, 3, TILE);
    ctx.fillRect(x + TILE - 3, y, 3, TILE);
    ctx.restore();
  }

  _gearTile(ctx, tx, ty) {
    ctx.save();
    ctx.fillStyle = patternFor(ctx, 'brass', this.q);
    ctx.fillRect(tx * TILE - 0.5, ty * TILE - 0.5, TILE + 1, TILE + 1);
    ctx.restore();
  }

  /** Recesses under the turning floor gears. */
  _gearRecesses(ctx, area) {
    for (const g of this._gears ?? []) {
      if (g.x + g.r < area.x0 * TILE || g.x - g.r > (area.x1 + 1) * TILE || g.y + g.r < area.y0 * TILE || g.y - g.r > (area.y1 + 1) * TILE) continue;
      ctx.save();
      ctx.fillStyle = '#1c1208';
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r + 3, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#e8c16a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r + 4.5, -2.2, 0.4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,10,4,0.8)';
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r + 4.5, 0.4, 3.9);
      ctx.stroke();
      ctx.restore();
    }
  }

  _flowers(ctx, tx, ty) {
    const R = rng((tx * 7919 + ty * 104729) ^ 0xf10e);
    const cols = this.zone === 'shore' ? ['#f2b6c4', '#e98aa0', '#fbe0e6', '#d86a88'] : ['#f5eedf', '#e3c15b', '#c7a0e8', '#f09a6a', '#fff3c2'];
    const n = 7 + Math.floor(R() * 6);
    for (let i = 0; i < n; i++) {
      const x = tx * TILE + 4 + R() * (TILE - 8);
      const y = ty * TILE + 4 + R() * (TILE - 8);
      const col = cols[(R() * cols.length) | 0];
      brush(ctx, x, y + 3, 5 + R() * 3, 1.2, -Math.PI / 2 + (R() - 0.5) * 0.6, rgba('#5a6a30', 0.7));
      const r = 1.6 + R() * 1.6;
      dab(ctx, x, y, r, r * 0.9, 0, col);
      dab(ctx, x + r * 0.3, y - r * 0.3, r * 0.45, r * 0.4, 0, rgba('#fff8ea', 0.7));
    }
  }

  _paintRaised(ctx, area) {
    const { map, style, q } = this;
    for (const [kind, cfg] of Object.entries(style.raised)) {
      const pred = (x, y) => map.typeAt(x, y) === kind;
      const fh = TILE_TYPES[kind].faceH ?? 20;
      const grow = style.organic ? null : 0.5;
      const top = style.organic && kind === 'cliff'
        ? this._region(`raised:${kind}`, area, pred, 0.34, { radius: 1.3, noise: 0.2, seed: 53 })
        : this._rectPath(area, pred, grow ?? 0.5);
      if (!top) continue;
      // long shadow toward the lower-left
      this._fillPath(ctx, top, 'rgba(30,14,34,1)', -9, fh + 8, 0.2);
      this._fillPath(ctx, top, 'rgba(30,14,34,1)', -4, fh + 3, 0.2);
      // face: bands from light (top) to dark (bottom), then texture strokes
      const [c0, c1, c2] = cfg.face;
      for (let k = fh; k >= 1; k -= 2) {
        const t = k / fh;
        this._fillPath(ctx, top, t < 0.5 ? mix(c0, c1, t * 2) : mix(c1, c2, (t - 0.5) * 2), 0, k);
      }
      // vertical strata / basalt columns on the faces
      ctx.save();
      ctx.beginPath();
      const clip = new Path2D();
      clip.addPath(top, new DOMMatrix().translate(0, fh));
      ctx.clip(clip);
      const R = rng(area.x0 * 31 + area.y0 * 17 + kind.length);
      for (let ty = area.y0; ty <= area.y1; ty++) {
        for (let tx = area.x0; tx <= area.x1; tx++) {
          if (!pred(tx, ty) || pred(tx, ty + 1)) continue;
          if (cfg.columns) {
            for (let x = tx * TILE; x < (tx + 1) * TILE; x += cfg.columns) {
              const k = R();
              ctx.fillStyle = rgba(k < 0.5 ? shade(c0, 0.18) : c2, 0.28 + k * 0.2);
              ctx.fillRect(x, ty * TILE + TILE * 0.3, cfg.columns * 0.45, fh + TILE * 0.9);
              ctx.fillStyle = rgba('#140c14', 0.35);
              ctx.fillRect(x + cfg.columns - 1.2, ty * TILE + TILE * 0.3, 1.2, fh + TILE * 0.9);
            }
          } else {
            for (let k = 0; k < 7; k++) {
              const x = tx * TILE + R() * TILE;
              const y = ty * TILE + TILE * 0.5 + R() * fh;
              brush(ctx, x, y, 6 + R() * fh * 0.8, 1.2 + R() * 1.6, Math.PI / 2 + (R() - 0.5) * 0.2, rgba(R() < 0.5 ? c2 : shade(c0, 0.25), 0.35));
            }
          }
        }
      }
      ctx.restore();
      if (cfg.vines) this._faceVines(ctx, area, pred, fh, cfg.vines);
      // top surface with a sunlit rim (top-right)
      this._fillPath(ctx, top, cfg.rim, 1.5, -1.5);
      this._fillPath(ctx, top, patternFor(ctx, cfg.top, q));
      this._fillPath(ctx, top, 'rgba(255,240,210,1)', 0, 0, 0.05);
      if (kind === 'wall' && !style.organic) this._wallDetails(ctx, area, pred);
    }
  }

  /** Ivy and creepers hanging over the south faces of ruins. */
  _faceVines(ctx, area, pred, fh, cols) {
    for (let ty = area.y0; ty <= area.y1; ty++) {
      for (let tx = area.x0; tx <= area.x1; tx++) {
        if (!pred(tx, ty) || pred(tx, ty + 1)) continue;
        const R = rng((tx * 7907) ^ (ty * 104729) ^ 0x1717);
        const strands = 1 + Math.floor(R() * 3);
        for (let k = 0; k < strands; k++) {
          const x = tx * TILE + 4 + R() * (TILE - 8);
          const len = fh * (0.4 + R() * 0.8);
          const y0 = ty * TILE + TILE - 2;
          for (let j = 0; j < len; j += 3) {
            const col = cols[(R() * cols.length) | 0];
            dab(ctx, x + Math.sin(j * 0.4 + k) * 2, y0 + j, 2.4 + R() * 1.4, 1.6, R() * TAU, rgba(col, 0.9));
          }
        }
      }
    }
  }

  _wallDetails(ctx, area, pred) {
    const R = rng(area.x0 * 7 + area.y0 * 13 + 99);
    for (let ty = area.y0; ty <= area.y1; ty++) {
      for (let tx = area.x0; tx <= area.x1; tx++) {
        if (!pred(tx, ty)) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        // pipes along the top
        if (R() < 0.35) {
          ctx.fillStyle = '#3e2c14';
          ctx.fillRect(x, y + 12, TILE, 7);
          ctx.fillStyle = '#b8893b';
          ctx.fillRect(x, y + 12, TILE, 5);
          ctx.fillStyle = 'rgba(255,230,160,0.5)';
          ctx.fillRect(x, y + 12.5, TILE, 1.2);
        }
        // faces: glowing porthole windows
        if (!pred(tx, ty + 1) && R() < 0.4) {
          const wx = x + TILE / 2;
          const wy = y + TILE + 16;
          dab(ctx, wx, wy, 6, 6, 0, '#2a1c0c');
          dab(ctx, wx, wy, 4.5, 4.5, 0, '#f5c77e');
          dab(ctx, wx - 1, wy - 1, 2, 2, 0, '#fff0c0');
        }
      }
    }
  }

  _paintRocks(ctx, area) {
    const { map, style } = this;
    const [base, dark, light] = style.rock;
    for (let ty = area.y0; ty <= area.y1; ty++) {
      for (let tx = area.x0; tx <= area.x1; tx++) {
        if (map.typeAt(tx, ty) !== 'rock') continue;
        const R = rng((tx * 92821 + ty * 68917) ^ 0x70c4);
        const cx = (tx + 0.5) * TILE + (R() - 0.5) * 6;
        const cy = (ty + 0.62) * TILE;
        const n = 2 + Math.floor(R() * 2);
        softShadow(ctx, cx - 6, cy + 6, 26, 10, 0.6);
        for (let i = 0; i < n; i++) {
          const rx = (i === 0 ? 15 : 8 + R() * 5) * (0.9 + R() * 0.25);
          const ry = rx * (0.72 + R() * 0.2);
          const ox = i === 0 ? 0 : (R() - 0.5) * 26;
          const oy = i === 0 ? 0 : 4 + R() * 6;
          rockShape(ctx, cx + ox, cy + oy - ry * 0.4, rx, ry, R, base, dark, light);
        }
      }
    }
  }

  _paintDeco(ctx, area) {
    const { map } = this;
    const deco = DECO[this.style.deco];
    if (!deco) return;
    for (let ty = area.y0; ty <= area.y1; ty++) {
      for (let tx = area.x0; tx <= area.x1; tx++) {
        const t = map.typeAt(tx, ty);
        const R = rng((tx * 73856093) ^ (ty * 19349663) ^ 0xdec0);
        deco(ctx, tx, ty, t, R, map);
      }
    }
  }

  _paintTallShadows(ctx, area) {
    for (const list of [this._tall, this._baked]) {
      for (const t of list) {
        if (t.tx < area.x0 || t.tx > area.x1 || t.ty < area.y0 || t.ty > area.y1) continue;
        const bx = (t.tx + 0.5) * TILE + t.jx;
        const by = (t.ty + 0.85) * TILE + t.jy;
        if (t.kind === 'tree') {
          softShadow(ctx, bx - 22, by + 2, 42, 20, 0.5);
          softShadow(ctx, bx - 4, by, 18, 7, 0.55);
        } else if (t.kind === 'pillar' || t.kind === 'machine') {
          softShadow(ctx, bx - 26, by + 6, 34, 12, 0.45);
          softShadow(ctx, bx, by, 18, 7, 0.5);
        } else softShadow(ctx, bx - 6, by, 20, 8, 0.45);
      }
    }
  }

  _paintPropShadows(ctx, area) {
    for (const p of this.props) {
      const fn = PROP_SHADOWS[p.kind];
      if (!fn) continue;
      if (p.x < area.x0 - 6 || p.x > area.x1 + 6 || p.y < area.y0 - 6 || p.y > area.y1 + 6) continue;
      fn(ctx, (p.x + 0.5) * TILE, (p.y + 1) * TILE, p);
    }
  }

  /** Tall tiles nobody can walk behind, painted straight into the chunk (sorted north → south). */
  _paintBaked(ctx, cx, cy) {
    const x0 = cx * CHUNK - 3;
    const x1 = (cx + 1) * CHUNK + 3;
    const y0 = cy * CHUNK - 1;
    const y1 = (cy + 1) * CHUNK + 6;
    const list = this._baked.filter((t) => t.tx >= x0 && t.tx < x1 && t.ty >= y0 && t.ty < y1);
    list.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
    for (const t of list) {
      this.drawTall(ctx, { x: (t.tx + 0.5) * TILE + t.jx, y: (t.ty + 0.85) * TILE + t.jy, tall: t, baked: true }, 0);
    }
  }

  /** Large-scale warm/cool colour variation (a global, deterministic blotch field — seamless across chunks). */
  _paintGrade(ctx, area, cx, cy) {
    const cell = 240;
    const x0 = cx * CHUNK * TILE;
    const y0 = cy * CHUNK * TILE;
    const S = CHUNK * TILE;
    const maxR = 330;
    const cols = this.style.grade;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (let gy = Math.floor((y0 - maxR) / cell); gy <= Math.floor((y0 + S + maxR) / cell); gy++) {
      for (let gx = Math.floor((x0 - maxR) / cell); gx <= Math.floor((x0 + S + maxR) / cell); gx++) {
        const x = (gx + hash2(gx, gy, 201)) * cell;
        const y = (gy + hash2(gx, gy, 202)) * cell;
        const r = 130 + hash2(gx, gy, 203) * 200;
        if (x + r < x0 || x - r > x0 + S || y + r < y0 || y - r > y0 + S) continue;
        const col = hash2(gx, gy, 204) < 0.55 ? cols[0] : cols[1];
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(col, 0.07 + hash2(gx, gy, 205) * 0.07));
        gr.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  // ─────────────────────────────────────────────────── per-frame drawing

  /**
   * Animated base layer under the (transparent where level 0) terrain. Stage space; cam = view top-left. Only the
   * parts of the view the terrain does not cover are painted (full-screen passes were most of the frame on
   * software-rasterised canvases).
   */
  drawUnderlay(ctx, cam, t, vw = 1280, vh = 720) {
    const kind = this.style.underlay;
    if (!this._under) this._under = buildUnderlay(kind, this.zone, this.q);
    const rects = this.underlayRects(cam, vw, vh);
    if (!rects.length) return;
    drawUnderlay(ctx, this._under, kind, cam, t, this.zone, rects, { low: this.lowQuality, k: this.pixelRatio, vw, vh });
  }

  /**
   * Stage-space rects [x, y, w, h, …] (flat) where the underlay can show: uncovered tiles in view (row runs merged
   * downwards while the span repeats) plus anything outside the map. Cached per visible tile window.
   * @returns {number[]}
   */
  underlayRects(cam, vw = 1280, vh = 720) {
    const { map } = this;
    const cover = this._coverMask();
    const tx0 = Math.floor(cam.x / TILE);
    const ty0 = Math.floor(cam.y / TILE);
    const tx1 = Math.floor((cam.x + vw - 0.001) / TILE);
    const ty1 = Math.floor((cam.y + vh - 0.001) / TILE);
    const C = this._rectCache;
    const key = `${tx0},${ty0},${tx1},${ty1}`;
    if (C.key !== key) {
      C.key = key;
      const out = [];
      let open = [];
      const covered = (x, y) => map.inBounds(x, y) && cover[y * map.w + x] === 1;
      for (let ty = ty0; ty <= ty1 + 1; ty++) {
        const runs = [];
        if (ty <= ty1) {
          let a = null; // (tile -1 is a valid run start when the view overhangs the map)
          for (let tx = tx0; tx <= tx1 + 1; tx++) {
            const need = tx <= tx1 && !covered(tx, ty);
            if (need && a === null) a = tx;
            else if (!need && a !== null) {
              runs.push([a, tx]);
              a = null;
            }
          }
        }
        const next = [];
        for (const r of runs) {
          const o = open.find((q) => q[0] === r[0] && q[1] === r[1]);
          if (o) {
            o[3] = ty + 1;
            next.push(o);
          } else next.push([r[0], r[1], ty, ty + 1]);
        }
        for (const o of open) if (!next.includes(o)) out.push(o);
        open = next;
      }
      C.world = out.map(([a, b, y0, y1]) => [a * TILE, y0 * TILE, (b - a) * TILE, (y1 - y0) * TILE]);
    }
    // 1 px of overlap into the covered neighbours (hidden under the opaque chunks) so no seam shows at odd DPRs
    const s = C.screen;
    s.length = 0;
    for (const [x, y, w, h] of C.world) {
      const x0 = Math.max(0, Math.floor(x - cam.x - 1));
      const y0 = Math.max(0, Math.floor(y - cam.y - 1));
      const x1 = Math.min(vw, Math.ceil(x + w - cam.x + 1));
      const y1 = Math.min(vh, Math.ceil(y + h - cam.y + 1));
      if (x1 > x0 && y1 > y0) s.push(x0, y0, x1 - x0, y1 - y0);
    }
    return s;
  }

  /** Draw the pre-rendered terrain chunks visible in the view (world transform already applied). */
  drawGround(ctx, cam, vw = 1280, vh = 720) {
    const S = CHUNK * TILE;
    const c0 = Math.max(0, Math.floor(cam.x / S));
    const c1 = Math.min(this.cols - 1, Math.floor((cam.x + vw) / S));
    const r0 = Math.max(0, Math.floor(cam.y / S));
    const r1 = Math.min(this.rows - 1, Math.floor((cam.y + vh) / S));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = this._chunk(cx, cy);
        if (c) ctx.drawImage(c, cx * S, cy * S, S, S);
      }
    }
  }

  /** Twinkling light glints on visible water tiles (world transform applied). */
  drawWaterFx(ctx, cam, t, vw = 1280, vh = 720) {
    const w = this._waterTiles;
    if (!w || !w.length) return;
    const x0 = cam.x / TILE - 1;
    const x1 = (cam.x + vw) / TILE + 1;
    const y0 = cam.y / TILE - 1;
    const y1 = (cam.y + vh) / TILE + 1;
    const warm = this.zone === 'thicket' ? '#ffe7a0' : '#fff1d6';
    for (let i = 0; i < w.length; i += 3) {
      const tx = w[i];
      const ty = w[i + 1];
      if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
      const h = hash2(tx, ty, 3);
      if (h > 0.5) continue;
      const per = 2600 + h * 3000;
      const ph = ((t + h * 9000) % per) / per;
      const a = Math.sin(ph * Math.PI) ** 3;
      if (a < 0.05) continue;
      const x = (tx + hash2(tx, ty, 4)) * TILE;
      const y = (ty + hash2(tx, ty, 5)) * TILE;
      const L = 5 + h * 14;
      ctx.fillStyle = rgba(warm, 0.55 * a);
      ctx.fillRect(x - L / 2, y, L, 1.4);
      if (h < 0.025) sparkle(ctx, x, y, 2.5 + 2.5 * a, warm, 0.55 * a, 0);
    }
  }

  /**
   * Visible tall tiles as y-sorted drawables {y, x, draw(ctx, t, hidePlayer)}.
   * @param {{x:number,y:number}} cam
   * @param {object[]} out
   */
  collectTall(cam, out, vw = 1280, vh = 720) {
    const S = CHUNK * TILE;
    const c0 = Math.max(0, Math.floor((cam.x - 80) / S));
    const c1 = Math.min(this.cols - 1, Math.floor((cam.x + vw + 80) / S));
    const r0 = Math.max(0, Math.floor((cam.y - 40) / S));
    const r1 = Math.min(this.rows - 1, Math.floor((cam.y + vh + 200) / S));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const list = this._tallByChunk.get(cy * this.cols + cx);
        if (!list) continue;
        for (const t of list) {
          const bx = (t.tx + 0.5) * TILE + t.jx;
          const by = (t.ty + 0.85) * TILE + t.jy;
          if (bx < cam.x - 90 || bx > cam.x + vw + 90 || by < cam.y - 20 || by > cam.y + vh + 190) continue;
          out.push({ y: by, x: bx, tall: t, kind: 'tall' });
        }
      }
    }
  }

  /**
   * Draw one tall tile drawable. alpha < 1 when the player is hidden behind it. Without sway the sprite lands on
   * whole device pixels, which lets software rasterisers blit it instead of resampling (≈10× cheaper in the
   * Thicket's ~280 visible trees); the gentle canopy sway is kept for full quality.
   */
  drawTall(ctx, d, t, alpha = 1) {
    const T = d.tall;
    const spr = tallSprite(this.zone, this.style, T.kind, T.variant, this.q, T.flip, T.calm);
    if (!spr) return;
    const sway = T.kind === 'tree' && !d.baked && !this.lowQuality ? Math.sin(t * 0.0009 + T.tx * 0.7 + T.ty * 0.3) * 0.012 : 0;
    const pa = ctx.globalAlpha;
    if (alpha < 1) ctx.globalAlpha = pa * alpha;
    if (sway) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.transform(1, 0, sway, 1, 0, 0);
      ctx.drawImage(spr.canvas, -spr.ax, -spr.ay, spr.w, spr.h);
      ctx.restore();
    } else {
      const k = this.pixelRatio;
      ctx.drawImage(spr.canvas, Math.round((d.x - spr.ax) * k) / k, Math.round((d.y - spr.ay) * k) / k, spr.w, spr.h);
    }
    ctx.globalAlpha = pa;
  }

  /** Canopy bounds (world px) of a tall drawable, for hiding the player behind it. */
  tallBounds(d) {
    const T = d.tall;
    const spr = tallSprite(this.zone, this.style, T.kind, T.variant, this.q, T.flip, T.calm);
    if (!spr) return null;
    return { x0: d.x - spr.ax, y0: d.y - spr.ay, x1: d.x - spr.ax + spr.w, y1: d.y - spr.ay + spr.h * 0.8 };
  }
}

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

const _gearSprites = new Map();
/** A detailed brass floor gear of radius r (unlit; lighting is applied live). */
function gearSprite(r) {
  if (_gearSprites.has(r)) return _gearSprites.get(r);
  const q = 1.5;
  const S = (r + 2) * 2;
  const c = makeCanvas(S * q, S * q);
  if (c) {
    const g = c.getContext('2d');
    g.scale(q, q);
    g.translate(S / 2, S / 2);
    const teeth = Math.max(10, Math.round(r / 5.5));
    g.fillStyle = '#6f5426';
    gearPath(g, 0, 0, r, r - 7, teeth, 0);
    g.fill();
    g.fillStyle = '#9a7a3c';
    gearPath(g, 0, 0, r - 1.5, r - 8, teeth, 0);
    g.fill();
    // rim, web and spokes
    g.fillStyle = '#b8893b';
    g.beginPath();
    g.arc(0, 0, r - 9, 0, TAU);
    g.fill();
    g.fillStyle = '#3a2810';
    g.beginPath();
    g.arc(0, 0, r - 14, 0, TAU);
    g.fill();
    const spokes = r > 60 ? 8 : 6;
    for (let i = 0; i < spokes; i++) {
      g.save();
      g.rotate((i / spokes) * TAU);
      g.fillStyle = '#a8823a';
      g.beginPath();
      g.moveTo(-r * 0.07, 0);
      g.lineTo(-r * 0.05, -(r - 14));
      g.lineTo(r * 0.05, -(r - 14));
      g.lineTo(r * 0.07, 0);
      g.fill();
      g.fillStyle = 'rgba(255,230,160,0.35)';
      g.fillRect(r * 0.02, -(r - 15), 1.4, r - 16);
      g.restore();
    }
    // engraved rings on the web
    g.strokeStyle = 'rgba(40,26,10,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, r - 11.5, 0, TAU);
    g.stroke();
    // hub
    g.fillStyle = '#6f5426';
    g.beginPath();
    g.arc(0, 0, r * 0.22, 0, TAU);
    g.fill();
    g.fillStyle = '#d8a850';
    g.beginPath();
    g.arc(0, 0, r * 0.16, 0, TAU);
    g.fill();
    g.fillStyle = '#3a2810';
    g.beginPath();
    g.arc(0, 0, r * 0.06, 0, TAU);
    g.fill();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      dab(g, Math.cos(a) * r * 0.19, Math.sin(a) * r * 0.19, 1.4, 1.4, 0, '#fff0c0');
    }
    // scuffs
    const R = rng(r * 13);
    for (let i = 0; i < 18; i++) brush(g, (R() - 0.5) * r * 1.4, (R() - 0.5) * r * 1.4, 6 + R() * 10, 0.8, R() * TAU, rgba(R() < 0.5 ? '#fff0c0' : '#2a1c0c', 0.18));
  }
  _gearSprites.set(r, c);
  return c;
}

/** Gear outline path (teeth n) centred at x,y. */
export function gearPath(ctx, x, y, r, rIn, n, rot = 0) {
  ctx.beginPath();
  const steps = n * 4;
  for (let i = 0; i <= steps; i++) {
    const a = rot + (i / steps) * TAU;
    const tooth = i % 4 === 0 || i % 4 === 1;
    const rr = tooth ? r : rIn;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** A shaded boulder. */
export function rockShape(ctx, x, y, rx, ry, R, base, dark, light) {
  ctx.save();
  ctx.translate(x, y);
  const pts = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 0.82 + R() * 0.3;
    pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k * (Math.sin(a) > 0 ? 0.8 : 1.05)]);
  }
  const poly = () => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  };
  poly();
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.save();
  poly();
  ctx.clip();
  const gr = ctx.createLinearGradient(rx * 0.7, -ry, -rx * 0.6, ry);
  gr.addColorStop(0, light);
  gr.addColorStop(0.35, base);
  gr.addColorStop(1, dark);
  ctx.fillStyle = gr;
  ctx.fillRect(-rx * 1.4, -ry * 1.4, rx * 2.8, ry * 2.8);
  for (let i = 0; i < 5; i++) {
    brush(ctx, (R() - 0.6) * rx, (R() - 0.5) * ry, rx * (0.3 + R() * 0.5), 1.2 + R() * 1.5, -0.5 + (R() - 0.5) * 0.5, rgba(R() < 0.5 ? light : dark, 0.35));
  }
  ctx.restore();
  ctx.strokeStyle = rgba(dark, 0.6);
  ctx.lineWidth = 0.8;
  poly();
  ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════ decorations

const DECO = {
  shore(ctx, tx, ty, t, R, map) {
    const x = tx * TILE;
    const y = ty * TILE;
    if (t === 'ground' || t === 'wet') {
      const r = R();
      if (r < 0.1) {
        // shell
        const sx = x + 6 + R() * 28;
        const sy = y + 6 + R() * 28;
        const col = R() < 0.5 ? '#f6e8d8' : '#f0c2b0';
        dab(ctx, sx + 1, sy + 1.5, 3.4, 2.4, 0.3, 'rgba(90,60,50,0.25)');
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(sx - 3, sy + 2);
        ctx.quadraticCurveTo(sx, sy - 4, sx + 3, sy + 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba('#b08878', 0.7);
        ctx.lineWidth = 0.5;
        for (let k = -2; k <= 2; k += 1) {
          ctx.beginPath();
          ctx.moveTo(sx, sy + 2);
          ctx.lineTo(sx + k * 1.2, sy - 2);
          ctx.stroke();
        }
      } else if (r < 0.16) {
        // pebbles
        for (let k = 0; k < 3; k++) dab(ctx, x + R() * TILE, y + R() * TILE, 1.5 + R() * 2, 1.2 + R() * 1.5, R(), vary('#8a7a70', R(), 0.2));
      } else if (r < 0.2 && t === 'wet') {
        // seaweed strands
        const sx = x + R() * TILE;
        const sy = y + R() * TILE;
        for (let k = 0; k < 4; k++) brush(ctx, sx, sy, 8 + R() * 8, 1.4, R() * TAU, rgba('#4a5a34', 0.6));
      } else if (r < 0.215 && t === 'wet') {
        // starfish
        const sx = x + 8 + R() * 24;
        const sy = y + 8 + R() * 24;
        ctx.fillStyle = '#e0763a';
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * TAU + R() * 0.1;
          const rr = k % 2 ? 1.6 : 4.8;
          ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      } else if (r < 0.235 && t === 'ground') {
        // driftwood
        const sx = x + R() * TILE;
        const sy = y + R() * TILE;
        const a = (R() - 0.5) * 1.2;
        brush(ctx, sx - 1, sy + 2, 20 + R() * 12, 4.5, a, 'rgba(60,40,40,0.25)');
        brush(ctx, sx, sy, 20 + R() * 12, 4, a, '#8e7a6a');
        brush(ctx, sx + 1, sy - 0.6, 16, 1.2, a, rgba('#f3e2c8', 0.6));
      }
    } else if (t === 'grass' || t === 'flowers') {
      if (R() < 0.35) {
        const sx = x + R() * TILE;
        const sy = y + R() * TILE;
        for (let k = 0; k < 9; k++) brush(ctx, sx + (R() - 0.5) * 8, sy, 7 + R() * 9, 1.6, -Math.PI / 2 + (R() - 0.5) * 1.1, rgba(R() < 0.5 ? '#7a7a3a' : '#d8c47a', 0.85));
      }
    }
  },
  thicket(ctx, tx, ty, t, R) {
    const x = tx * TILE;
    const y = ty * TILE;
    if (t === 'ground' || t === 'grass' || t === 'wet') {
      const r = R();
      if (r < 0.05) {
        // mushrooms
        const n = 1 + Math.floor(R() * 3);
        for (let k = 0; k < n; k++) {
          const sx = x + 8 + R() * 24;
          const sy = y + 10 + R() * 24;
          const s = 2.4 + R() * 2.5;
          ctx.fillStyle = '#efe4c8';
          ctx.fillRect(sx - 0.8, sy - s, 1.6, s + 1);
          const cap = R() < 0.6 ? '#c0432e' : '#e3b04a';
          dab(ctx, sx, sy - s, s * 1.1, s * 0.6, 0, cap);
          dab(ctx, sx - s * 0.3, sy - s * 1.15, s * 0.3, s * 0.2, 0, rgba('#fff4dc', 0.8));
        }
      } else if (r < 0.1) {
        // fern
        const sx = x + R() * TILE;
        const sy = y + R() * TILE;
        for (let k = 0; k < 5; k++) {
          const a = -Math.PI / 2 + (k - 2) * 0.45;
          brush(ctx, sx, sy, 10 + R() * 6, 3, a, rgba(R() < 0.5 ? '#8a8a34' : '#b89a38', 0.8));
        }
      } else if (r < 0.16) {
        // twigs
        const sx = x + R() * TILE;
        const sy = y + R() * TILE;
        brush(ctx, sx, sy, 12 + R() * 10, 1.6, R() * TAU, rgba('#3a2a18', 0.7));
      } else if (r < 0.22 && t === 'ground') {
        // extra bright leaves
        for (let k = 0; k < 4; k++) {
          const sx = x + R() * TILE;
          const sy = y + R() * TILE;
          dab(ctx, sx, sy, 3.5, 1.8, R() * TAU, R() < 0.5 ? '#f0d278' : '#e39a3a');
        }
      }
    } else if (t === 'path' && R() < 0.12) {
      dab(ctx, x + R() * TILE, y + R() * TILE, 2.5, 1.8, 0, vary('#8a7a66', R(), 0.2));
    } else if (t === 'stone') {
      // moss creeping over the flagstones, drifts of golden leaves in the joints
      if (R() < 0.45) {
        const mx = x + R() * TILE;
        const my = y + R() * TILE;
        const gr = ctx.createRadialGradient(mx, my, 0, mx, my, 16 + R() * 14);
        gr.addColorStop(0, 'rgba(90,100,40,0.55)');
        gr.addColorStop(1, 'rgba(90,100,40,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(mx - 30, my - 30, 60, 60);
      }
      const n = 3 + Math.floor(R() * 7);
      for (let k = 0; k < n; k++) dab(ctx, x + R() * TILE, y + R() * TILE, 3, 1.6, R() * TAU, rgba(['#c9a43a', '#e3c15b', '#b07a2e', '#8a4a24'][(R() * 4) | 0], 0.9));
    }
  },
  spire(ctx, tx, ty, t, R, map) {
    const x = tx * TILE;
    const y = ty * TILE;
    if (t === 'ground') {
      const r = R();
      if (r < 0.05) {
        // floor grate
        ctx.fillStyle = '#2a1e10';
        ctx.fillRect(x + 8, y + 8, 24, 24);
        ctx.fillStyle = '#b8893b';
        for (let k = 0; k < 5; k++) ctx.fillRect(x + 9, y + 10 + k * 4.4, 22, 1.6);
        dab(ctx, x + 20, y + 20, 14, 14, 0, 'rgba(255,200,120,0.06)');
      } else if (r < 0.09) {
        // small loose cog
        ctx.fillStyle = '#6a4e24';
        gearPath(ctx, x + 10 + R() * 20, y + 10 + R() * 20, 5, 3.8, 7, R() * TAU);
        ctx.fill();
      } else if (r < 0.13) {
        // oil stain
        dab(ctx, x + R() * TILE, y + R() * TILE, 7 + R() * 6, 4 + R() * 3, R(), 'rgba(20,12,6,0.25)');
      }
    }
  },
  summit(ctx, tx, ty, t, R) {
    const x = tx * TILE;
    const y = ty * TILE;
    if (t === 'ground' || t === 'stone') {
      const r = R();
      if (r < 0.07) {
        // hairline crack
        ctx.strokeStyle = 'rgba(40,24,20,0.45)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        let px = x + R() * TILE;
        let py = y + R() * TILE;
        ctx.moveTo(px, py);
        for (let k = 0; k < 4; k++) {
          px += (R() - 0.5) * 14;
          py += (R() - 0.5) * 14;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      } else if (r < 0.1) {
        // fallen clock hand
        brush(ctx, x + R() * 20, y + R() * 30, 18, 2.4, R() * TAU, '#b8893b');
      }
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════ underlays

function buildUnderlay(kind, zone, q) {
  const out = {};
  if (kind === 'sea' || kind === 'pond') {
    const S = 512;
    const c = makeCanvas(S * q, S * q);
    if (c) {
      const g = c.getContext('2d');
      g.scale(q, q);
      const R = rng(kind === 'sea' ? 404 : 505);
      const base = kind === 'sea' ? '#2c6a74' : '#23413a';
      g.fillStyle = base;
      g.fillRect(0, 0, S, S);
      blotches(g, R, S, 22, kind === 'sea' ? ['#347a82', '#1f5460', '#3f8a8e', '#285e6a'] : ['#2d5046', '#1a302a', '#3a5a40'], 60, 160, 0.6);
      strokes(g, R, S, 260, kind === 'sea' ? ['#4f9aa0', '#1a4a56', '#6fb2b0'] : ['#3a6a50', '#16281f', '#5a7a48'], { len: [14, 40], w: [1.2, 3.5], ang: -0.04, spread: 0.08, alpha: [0.18, 0.4] });
      strokes(g, R, S, 70, kind === 'sea' ? ['#f0b890', '#e9a0a0', '#ffe0b0'] : ['#e8c060', '#f0d890'], { len: [10, 30], w: [0.8, 1.8], ang: -0.04, spread: 0.06, alpha: [0.1, 0.3] });
      out.base = c;
    }
    const L = makeCanvas(256 * q, 256 * q);
    if (L) {
      const g = L.getContext('2d');
      g.scale(q, q);
      const R = rng(kind === 'sea' ? 77 : 78);
      strokes(g, R, 256, 50, ['#fff4dc', '#dff5f0'], { len: [8, 22], w: [0.8, 1.6], ang: -0.03, spread: 0.05, alpha: [0.18, 0.4] });
      out.glint = L;
    }
    out.S = 512;
  } else {
    // sky-void: dusk gradient (screen space) + tileable clouds + far gear silhouettes. The clouds are kept at the
    // terrain resolution so, with the pattern snapped to whole pixels, they blit without resampling.
    const S = 1024;
    const c = makeCanvas(S * q, 512 * q);
    if (c) {
      const g = c.getContext('2d');
      g.scale(q, q);
      const R = rng(zone === 'summit' ? 91 : 92);
      for (let i = 0; i < 38; i++) {
        const x = R() * S;
        const y = R() * 512;
        const r = 50 + R() * 140;
        const col = R() < 0.5 ? (zone === 'summit' ? '#f0b25a' : '#d3a877') : (zone === 'summit' ? '#8a4a3a' : '#7a6a7a');
        wrapDraw(S, x, y, r, (X, Y) => {
          for (let k = 0; k < 4; k++) {
            const gx = X + (R() - 0.5) * r;
            const gy = Y + (R() - 0.5) * r * 0.3;
            const rr = r * (0.4 + R() * 0.5);
            const gr = g.createRadialGradient(gx, gy, 0, gx, gy, rr);
            gr.addColorStop(0, rgba(col, 0.28));
            gr.addColorStop(1, rgba(col, 0));
            g.fillStyle = gr;
            g.save();
            g.translate(gx, gy);
            g.scale(1, 0.4);
            g.translate(-gx, -gy);
            g.fillRect(gx - rr, gy - rr, rr * 2, rr * 2);
            g.restore();
          }
        });
      }
      out.clouds = c;
    }
    out.S = S;
  }
  return out;
}

/** Set a pattern's transform to translate(tx, ty) · scale(k) without allocating a DOMMatrix. */
function patXform(p, tx, ty, k, M) {
  if (!p || typeof p.setTransform !== 'function') return;
  M.a = k;
  M.d = k;
  M.e = tx;
  M.f = ty;
  p.setTransform(M);
}

/** Cached radial glow sprite with a custom falloff (for big screen-space light pools). */
const _pools = new Map();
function lightPool(color, stops) {
  const key = color + stops.join(',');
  if (_pools.has(key)) return _pools.get(key);
  const c = makeCanvas(256, 256);
  if (c) {
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach((a, i) => gr.addColorStop(i / (stops.length - 1), rgba(color, a)));
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  }
  _pools.set(key, c);
  return c;
}

/** Clip to the union of a flat [x, y, w, h, …] rect list (overlaps are fine: a union never paints twice). */
function clipRects(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < r.length; i += 4) ctx.rect(r[i], r[i + 1], r[i + 2], r[i + 3]);
  ctx.clip();
}

/** Round a stage coordinate to a whole device pixel (k = device px per stage px) so textures blit unresampled. */
const snapTo = (v, k) => Math.round(v * k) / k;

/** The frozen sun's warm reflection on the sea, pre-rendered in stage space (it never moves on screen). */
function seaReflection(U, vw, vh) {
  if (U.pool !== undefined) return U.pool;
  U.pool = makeCanvas(vw, vh);
  if (U.pool) {
    const g = U.pool.getContext('2d');
    const gr = g.createRadialGradient(1180, -60, 0, 1180, -60, 820);
    [0.35, 0.18, 0.06, 0].forEach((a, i, arr) => gr.addColorStop(i / (arr.length - 1), rgba('#ffc88c', a)));
    g.fillStyle = gr;
    g.fillRect(0, 0, vw, vh);
  }
  return U.pool;
}

/**
 * Paint the animated underlay, clipped to the given stage-space rects (the parts of the view it can show through).
 * @param {number[]} rects flat [x, y, w, h, …] (see WorldRenderer.underlayRects)
 * @param {{low?:boolean, k?:number, vw?:number, vh?:number}} o  low = software-raster budget (no glints);
 *   k = device px per stage px (texture offsets snap to it)
 */
function drawUnderlay(ctx, U, kind, cam, t, zone, rects, o = {}) {
  ctx.save();
  clipRects(ctx, rects);
  paintUnderlay(ctx, U, kind, cam, t, zone, o);
  ctx.restore();
}

/** The underlay's layers over the whole view (the caller clips). */
function paintUnderlay(ctx, U, kind, cam, t, zone, { low = false, k = 1, vw = 1280, vh = 720 } = {}) {
  const M = U.M ?? (U.M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  if (kind === 'sea' || kind === 'pond') {
    if (!U.base) {
      ctx.fillStyle = '#2c6a74';
      ctx.fillRect(0, 0, vw, vh);
      return;
    }
    if (U.ctx !== ctx) {
      U.ctx = ctx;
      U.pBase = ctx.createPattern(U.base, 'repeat');
      U.pGlint = U.glint ? ctx.createPattern(U.glint, 'repeat') : null;
    }
    const q = U.base.width / U.S;
    const drift = t * 0.004; // the sea is paused… almost
    patXform(U.pBase, snapTo(-cam.x + drift, k), snapTo(-cam.y, k), 1 / q, M);
    ctx.fillStyle = U.pBase;
    ctx.fillRect(0, 0, vw, vh);
    if (U.pGlint && !low) {
      const q2 = U.glint.width / 256;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let n = 0; n < 2; n++) {
        const ph = t * (n ? 0.00021 : 0.00013) + n * 2;
        ctx.globalAlpha = 0.18 + 0.14 * Math.sin(ph * 6.28);
        patXform(U.pGlint, snapTo(-cam.x + (n ? -t * 0.006 : t * 0.005) + n * 90, k), snapTo(-cam.y + n * 40, k), 1 / q2, M);
        ctx.fillStyle = U.pGlint;
        ctx.fillRect(0, 0, vw, vh);
      }
      ctx.restore();
    }
    // warm reflection of the frozen sun
    if (kind === 'sea') {
      const pool = seaReflection(U, vw, vh);
      if (pool) ctx.drawImage(pool, 0, 0, vw, vh);
    }
    return;
  }
  // sky void
  const pal = ZONE_PALETTES[zone] ?? ZONE_PALETTES.spire;
  const sky = pal.sky;
  if (!U.skyGrad || U.ctx !== ctx) {
    U.ctx = ctx;
    const gr = ctx.createLinearGradient(0, 0, 0, 720);
    gr.addColorStop(0, sky[3]);
    gr.addColorStop(0.35, sky[2]);
    gr.addColorStop(0.75, sky[1]);
    gr.addColorStop(1, sky[0]);
    U.skyGrad = gr;
    U.pClouds = U.clouds ? ctx.createPattern(U.clouds, 'repeat') : null;
  }
  ctx.fillStyle = U.skyGrad;
  ctx.fillRect(0, 0, vw, vh);
  // far gears turning in the abyss (parallax 0.12)
  ctx.save();
  const px = -cam.x * 0.12;
  const py = -cam.y * 0.12;
  const gears = zone === 'summit'
    ? [[200, 520, 220, 0.00004], [1100, 260, 300, -0.00003]]
    : [[160, 200, 180, 0.00006], [900, 560, 260, -0.00004], [1300, 120, 140, 0.00008], [520, 780, 200, 0.00005]];
  const far0 = rgba(sky[0], 0.5);
  const far1 = rgba(sky[1], 0.7);
  const far2 = rgba(sky[0], 0.6);
  for (const [gx, gy, r, sp] of gears) {
    const x = ((gx + px) % 1600 + 1600) % 1600 - 160;
    const y = ((gy + py) % 1000 + 1000) % 1000 - 140;
    ctx.fillStyle = far0;
    gearPath(ctx, x, y, r, r * 0.86, 18, t * sp);
    ctx.fill();
    ctx.fillStyle = far1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, TAU);
    ctx.fill();
    ctx.fillStyle = far2;
    for (let n = 0; n < 6; n++) {
      const a = t * sp + (n / 6) * TAU;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillRect(-r * 0.08, 0, r * 0.16, r * 0.8);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(x, y, r * 0.18, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  // cloud layers (parallax 0.3 and 0.55, slowly drifting)
  if (U.pClouds) {
    const q = U.clouds.width / U.S;
    for (let n = 0; n < 2; n++) {
      const par = n ? 0.55 : 0.3;
      const drift = t * (n ? 0.012 : 0.006);
      patXform(U.pClouds, snapTo(-cam.x * par + drift + n * 300, k), snapTo(-cam.y * par + n * 170, k), 1 / q, M);
      ctx.globalAlpha = n ? 0.9 : 0.7;
      ctx.fillStyle = U.pClouds;
      ctx.fillRect(0, 0, vw, vh);
    }
    ctx.globalAlpha = 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════════ tall sprites

const _tallCache = new Map();

/**
 * Pre-rendered sprite for a tall tile kind/variant: {canvas, w, h, ax, ay} (logical px). Mirrored copies are
 * painted up front (a mirrored draw resamples every pixel) and zones with `style.calm` get toned-down canopies by
 * calm level (1 beside the paths, 2 deeper in the wood).
 */
function tallSprite(zone, style, kind, variant, q, flip = false, calm = 0) {
  const species = kind === 'tree' ? style.tree : kind === 'bush' ? style.bush : kind === 'pillar' ? (zone === 'summit' ? 'column' : 'clockpillar') : 'machine';
  const tone = calm ? style.calm?.[calm] : null;
  const key = `${species}:${variant}:${q}:${flip ? 1 : 0}:${tone ? calm : 0}`;
  if (_tallCache.has(key)) return _tallCache.get(key);
  const painter = TALL_PAINTERS[species];
  let spr = null;
  if (painter) {
    const { w, h, ax, ay } = painter.box;
    const c = makeCanvas(w * q, h * q);
    if (c) {
      const g = c.getContext('2d');
      g.scale(q, q);
      if (flip) {
        g.translate(w - ax, ay);
        g.scale(-1, 1);
      } else g.translate(ax, ay);
      painter.draw(g, rng(variant * 7919 + species.length * 131 + 17), variant);
      if (tone) {
        // mix toward a muted tone (alpha preserved): lower contrast and saturation, the path reads first
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-atop';
        g.globalAlpha = tone.a;
        g.fillStyle = tone.tone;
        g.fillRect(0, 0, c.width, c.height);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
      spr = { canvas: c, w, h, ax: flip ? w - ax : ax, ay };
    }
  } else warnOnce(`no painter for tall "${species}"`);
  _tallCache.set(key, spr);
  return spr;
}

/** Leafy canopy made of many dabs, lit from the top-right. */
function canopy(g, R, cx, cy, rx, ry, cols, n = 90, leafS = [5, 10]) {
  const [dark, mid, light, rim] = cols;
  // shadow mass
  for (let i = 0; i < 16; i++) {
    const a = R() * TAU;
    const d = Math.sqrt(R());
    dab(g, cx + Math.cos(a) * rx * d * 0.8, cy + Math.sin(a) * ry * d * 0.8 + ry * 0.12, rx * 0.4, ry * 0.36, R(), dark);
  }
  for (let i = 0; i < n; i++) {
    const a = R() * TAU;
    const d = Math.sqrt(R());
    const x = cx + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d;
    // light from top-right: points up-right get lighter
    const lit = clamp(((x - cx) / rx) * 0.45 - ((y - cy) / ry) * 0.6 + 0.35 + (R() - 0.5) * 0.35, 0, 1);
    const col = lit > 0.72 ? light : lit > 0.36 ? mid : dark;
    const s = lerp(leafS[0], leafS[1], R());
    dab(g, x, y, s, s * (0.6 + R() * 0.3), R() * TAU, vary(col, R(), 0.1));
  }
  // rim highlights
  for (let i = 0; i < n * 0.28; i++) {
    const a = -Math.PI * 0.5 + (R() - 0.2) * 1.5;
    const d = 0.75 + R() * 0.25;
    const x = cx + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d;
    dab(g, x, y, leafS[0] * 0.7, leafS[0] * 0.45, R() * TAU, rgba(rim, 0.85));
  }
}

const TALL_PAINTERS = {
  pine: {
    box: { w: 120, h: 150, ax: 60, ay: 138 },
    draw(g, R, v) {
      // wind-bent coastal pine, leaning away from the sea (east)
      const lean = 10 + v * 3;
      g.strokeStyle = '#3e2a22';
      g.lineCap = 'round';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(-4, -40, lean, -78);
      g.stroke();
      g.strokeStyle = '#6a4a3a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(2, -4);
      g.quadraticCurveTo(-1, -40, lean + 2, -76);
      g.stroke();
      const cols = ['#23393a', '#35524c', '#6a7e5e', '#e0c080'];
      canopy(g, R, lean - 18, -84, 30, 16, cols, 60, [5, 9]);
      canopy(g, R, lean + 14, -100, 32, 17, cols, 64, [5, 9]);
      canopy(g, R, lean - 6, -118, 24, 13, cols, 48, [4, 8]);
    },
  },
  buckthorn: {
    box: { w: 70, h: 60, ax: 35, ay: 52 },
    draw(g, R) {
      canopy(g, R, 0, -18, 24, 15, ['#4e5a3e', '#7d8a60', '#b8b88a', '#f0d8a0'], 70, [3, 6]);
      for (let i = 0; i < 14; i++) dab(g, (R() - 0.5) * 36, -18 + (R() - 0.5) * 20, 1.8, 1.8, 0, R() < 0.5 ? '#e0873a' : '#f0a24a');
    },
  },
  gilt: {
    box: { w: 150, h: 160, ax: 75, ay: 148 },
    draw(g, R, v) {
      // golden broadleaf: short sturdy trunk, roots and a luminous canopy (≈3 tiles tall)
      g.fillStyle = '#35241a';
      g.beginPath();
      g.moveTo(-8, 0);
      g.quadraticCurveTo(-6, -34, -5, -62);
      g.lineTo(6, -62);
      g.quadraticCurveTo(7, -34, 9, 0);
      g.quadraticCurveTo(0, 4, -8, 0);
      g.fill();
      g.fillStyle = '#5e4232';
      g.fillRect(3, -58, 2.5, 56);
      for (const s2 of [-1, 1]) brush(g, 0, -2, 14, 4.5, s2 > 0 ? 0.25 : Math.PI - 0.25, '#35241a');
      g.strokeStyle = '#35241a';
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(-2, -48);
      g.quadraticCurveTo(-16, -62, -28, -70);
      g.moveTo(2, -52);
      g.quadraticCurveTo(18, -64, 26, -74);
      g.stroke();
      const palettes = [
        ['#7a5220', '#c9a43a', '#f1d38a', '#fff3c2'],
        ['#6a4418', '#b8862e', '#e8c15b', '#fff0b0'],
        ['#5a3014', '#a8602a', '#e0944e', '#ffd8a0'],
        ['#4a4818', '#8a8a2e', '#cfc25a', '#fff3c2'],
      ];
      const cols = palettes[v % palettes.length];
      canopy(g, R, -22, -80, 36, 25, cols, 100, [5, 9]);
      canopy(g, R, 24, -86, 38, 26, cols, 100, [5, 9]);
      canopy(g, R, 0, -110, 40, 26, cols, 110, [5, 9.5]);
      for (let i = 0; i < 8; i++) dab(g, (R() - 0.5) * 100, -40 - R() * 30, 2.6, 1.4, R() * TAU, rgba(cols[2], 0.85));
    },
  },
  giltbush: {
    box: { w: 80, h: 64, ax: 40, ay: 54 },
    draw(g, R, v) {
      const cols = v % 2 ? ['#6a4418', '#b8862e', '#e8c15b', '#fff0b0'] : ['#5a4a1c', '#9a8a30', '#d6c460', '#fff3c2'];
      canopy(g, R, 0, -20, 28, 17, cols, 80, [3.5, 6.5]);
    },
  },
  clockpillar: {
    box: { w: 70, h: 190, ax: 35, ay: 178 },
    draw(g, R, v) {
      // brass column with a clock face
      const w = 22;
      const H = 150;
      const gr = g.createLinearGradient(-w, 0, w, 0);
      gr.addColorStop(0, '#3e2c14');
      gr.addColorStop(0.45, '#8a6a32');
      gr.addColorStop(0.75, '#e8c16a');
      gr.addColorStop(1, '#6f5426');
      g.fillStyle = gr;
      g.fillRect(-w / 2 - 6, -12, w + 12, 12);
      g.fillRect(-w / 2, -H, w, H - 10);
      g.fillRect(-w / 2 - 5, -H - 10, w + 10, 12);
      g.fillStyle = 'rgba(40,28,10,0.5)';
      for (let k = -H + 10; k < -16; k += 22) g.fillRect(-w / 2, k, w, 2);
      // clock face
      const cy = -H + 34;
      dab(g, 0, cy, 13, 13, 0, '#2a1c0c');
      dab(g, 0, cy, 11, 11, 0, '#f3e6c8');
      g.strokeStyle = '#2a1c0c';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(0, cy);
      g.lineTo(0, cy - 8);
      g.moveTo(0, cy);
      g.lineTo(6, cy + 3);
      g.stroke();
      if (v % 2) {
        g.fillStyle = '#e8c16a';
        gearPath(g, 0, -H - 22, 13, 10, 10, v);
        g.fill();
        dab(g, 0, -H - 22, 4, 4, 0, '#3e2c14');
      }
    },
  },
  column: {
    box: { w: 80, h: 200, ax: 40, ay: 186 },
    draw(g, R, v) {
      const w = 26;
      const H = v % 3 === 0 ? 110 : 160;
      const gr = g.createLinearGradient(-w, 0, w, 0);
      gr.addColorStop(0, '#4e3a30');
      gr.addColorStop(0.5, '#a08c7a');
      gr.addColorStop(0.8, '#ffe8c0');
      gr.addColorStop(1, '#7a6458');
      g.fillStyle = gr;
      g.fillRect(-w / 2 - 7, -14, w + 14, 14);
      g.fillRect(-w / 2, -H, w, H - 12);
      g.fillStyle = 'rgba(50,34,28,0.35)';
      for (let k = -w / 2 + 5; k < w / 2; k += 6) g.fillRect(k, -H, 1.5, H - 14);
      if (v % 3 === 0) {
        // broken top
        g.fillStyle = '#5a463a';
        g.beginPath();
        g.moveTo(-w / 2, -H);
        g.lineTo(-w / 4, -H - 12);
        g.lineTo(0, -H - 4);
        g.lineTo(w / 3, -H - 16);
        g.lineTo(w / 2, -H);
        g.fill();
      } else {
        g.fillStyle = gr;
        g.fillRect(-w / 2 - 6, -H - 12, w + 12, 12);
        g.fillStyle = '#f0c060';
        g.fillRect(-w / 2 - 6, -H - 12, w + 12, 2);
      }
    },
  },
  pipes: {
    box: { w: 70, h: 90, ax: 35, ay: 80 },
    draw(g, R) {
      for (let k = -1; k <= 1; k++) {
        const x = k * 12;
        const h = 50 + R() * 26;
        const gr = g.createLinearGradient(x - 5, 0, x + 5, 0);
        gr.addColorStop(0, '#4a3418');
        gr.addColorStop(0.6, '#d0a050');
        gr.addColorStop(1, '#6a4e24');
        g.fillStyle = gr;
        g.fillRect(x - 5, -h, 10, h);
        g.fillStyle = '#3e2c14';
        g.fillRect(x - 6.5, -h, 13, 4);
        g.fillRect(x - 6.5, -h * 0.5, 13, 3);
      }
      dab(g, 0, -40, 9, 9, 0, '#8a6a32');
      dab(g, 0, -40, 6, 6, 0, '#f5c77e');
    },
  },
  brazier: {
    box: { w: 60, h: 80, ax: 30, ay: 70 },
    draw(g) {
      g.fillStyle = '#3e2c20';
      g.fillRect(-3, -40, 6, 40);
      g.fillStyle = '#b8893b';
      g.beginPath();
      g.moveTo(-14, -46);
      g.lineTo(14, -46);
      g.lineTo(8, -36);
      g.lineTo(-8, -36);
      g.fill();
      g.fillRect(-10, -2, 20, 3);
    },
  },
  machine: {
    box: { w: 90, h: 120, ax: 45, ay: 106 },
    draw(g, R, v) {
      const gr = g.createLinearGradient(-36, 0, 36, 0);
      gr.addColorStop(0, '#3a2a14');
      gr.addColorStop(0.7, '#8a6a32');
      gr.addColorStop(1, '#5a4220');
      g.fillStyle = gr;
      g.fillRect(-34, -70, 68, 70);
      g.fillStyle = '#2a1e10';
      g.fillRect(-30, -66, 60, 40);
      g.fillStyle = '#b8893b';
      gearPath(g, -10, -48, 16, 12.5, 12, v);
      g.fill();
      g.fillStyle = '#e8c16a';
      gearPath(g, 14, -38, 11, 8.5, 9, -v);
      g.fill();
      dab(g, -10, -48, 4, 4, 0, '#3a2a14');
      dab(g, 14, -38, 3, 3, 0, '#3a2a14');
      g.fillStyle = '#6f5426';
      g.fillRect(-36, -76, 72, 8);
      g.fillStyle = '#f0c96a';
      g.fillRect(-36, -76, 72, 1.6);
      // chimney
      g.fillStyle = '#4a3418';
      g.fillRect(18, -98, 10, 24);
      g.fillStyle = '#e8c16a';
      g.fillRect(16, -100, 14, 3);
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════ prop shadows (ground layer)

const PROP_SHADOWS = {
  lighthouse(ctx, x, y) {
    softShadow(ctx, x - 70, y + 4, 90, 22, 0.5);
    softShadow(ctx, x, y - 4, 30, 12, 0.6);
  },
  wreck(ctx, x, y, p) {
    softShadow(ctx, x - 30, y - 6, (p.w ?? 4) * 22, 26, 0.55);
  },
  tent(ctx, x, y) {
    softShadow(ctx, x - 16, y - 6, 56, 18, 0.55);
  },
  wagon(ctx, x, y) {
    softShadow(ctx, x - 16, y - 4, 70, 20, 0.55);
  },
  stall(ctx, x, y) {
    softShadow(ctx, x - 12, y - 6, 60, 18, 0.5);
  },
  statue(ctx, x, y) {
    softShadow(ctx, x - 30, y - 4, 44, 14, 0.5);
  },
  arch(ctx, x, y) {
    softShadow(ctx, x - 24, y - 6, 80, 16, 0.45);
  },
  geartower(ctx, x, y) {
    softShadow(ctx, x - 40, y - 4, 70, 20, 0.5);
  },
  crates(ctx, x, y) {
    softShadow(ctx, x - 6, y - 8, 30, 12, 0.5);
  },
  lifeboat(ctx, x, y) {
    softShadow(ctx, x - 6, y - 10, 50, 16, 0.5);
  },
  rowboat(ctx, x, y) {
    softShadow(ctx, x - 6, y - 10, 46, 14, 0.5);
  },
};

// ═══════════════════════════════════════════════════════════════════════════ atmosphere

/** Soft light-shaft sprite: bright core along its length, fading at the sides and the far end. */
function beamSprite() {
  const c = makeCanvas(64, 256);
  if (!c) return null;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    const along = Math.pow(1 - y / 255, 1.6) * smooth(0, 30, y);
    for (let x = 0; x < 64; x++) {
      const across = Math.pow(Math.sin((x / 63) * Math.PI), 2.2);
      const v = along * across;
      const i = (y * 64 + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 226;
      img.data[i + 2] = 170;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Screen-space atmosphere: drifting particles (world-anchored), light shafts, the frozen sun glow,
 * colour grade and vignette.
 */
export class Atmosphere {
  constructor(zone) {
    this.zone = zone;
    this.style = ZONE_STYLES[zone] ?? ZONE_STYLES.shore;
    this.parts = [];
    this._grade = null;
    this._light = null;
    this._shade = null;
    const n = { spray: 34, leaves: 80, gears: 50, embers: 70 }[this.style.particles] ?? 40;
    for (let i = 0; i < n; i++) this.parts.push(this._spawn(true));
  }

  _spawn(init) {
    const R = Math.random;
    const kind = this.style.particles;
    const p = { x: R() * 1400 - 60, y: R() * 840 - 60, z: 0.6 + R() * 0.8, ph: R() * TAU, s: 1, rot: R() * TAU, vr: (R() - 0.5) * 0.001, kind };
    if (kind === 'leaves') {
      p.s = 3 + R() * 3.5;
      p.col = ['#f1d38a', '#e3c15b', '#c9a43a', '#e8a45b', '#fff3c2'][(R() * 5) | 0];
      p.vx = (R() - 0.5) * 0.004;
      p.vy = 0.0015 + R() * 0.003; // "falling" — but only just
      p.hover = R() < 0.55; // hangs mid-fall, never landing
    } else if (kind === 'spray') {
      p.s = 0.7 + R() * 1.4;
      p.col = R() < 0.5 ? '#fff0d8' : '#ffe0b0';
      p.vx = 0.002 + R() * 0.004;
      p.vy = -0.001 * R();
    } else if (kind === 'gears') {
      p.s = 0.8 + R() * 1.6;
      p.col = R() < 0.6 ? '#ffd88a' : '#fff3c2';
      p.vx = (R() - 0.5) * 0.006;
      p.vy = -0.004 - R() * 0.006;
      p.cog = R() < 0.12;
    } else {
      p.s = 1 + R() * 2;
      p.col = R() < 0.5 ? '#ffc870' : '#fff0c0';
      p.vx = (R() - 0.5) * 0.008;
      p.vy = -0.006 - R() * 0.01;
    }
    return p;
  }

  update(dt) {
    for (const p of this.parts) {
      p.ph += dt * 0.0015;
      p.rot += p.vr * dt;
      if (p.kind === 'leaves' && p.hover) continue;
      p.x += p.vx * dt * 10;
      p.y += p.vy * dt * 10;
    }
  }

  /**
   * Particles are world-anchored with parallax by depth z; drawn in stage space.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number}} cam
   * @param {number} t ms
   */
  drawParticles(ctx, cam, t) {
    const W = 1400;
    const H = 840;
    for (const p of this.parts) {
      let x = (((p.x - cam.x * p.z) % W) + W) % W - 60;
      let y = (((p.y - cam.y * p.z) % H) + H) % H - 60;
      const bob = Math.sin(p.ph) * 3;
      if (p.kind === 'leaves') {
        const tilt = Math.sin(p.ph * 0.7) * 0.6;
        ctx.save();
        ctx.translate(x + Math.sin(p.ph * 0.5) * 4, y + bob);
        ctx.rotate(p.rot + tilt);
        ctx.scale(1, 0.5 + 0.5 * Math.abs(Math.sin(p.ph * 0.8)));
        ctx.fillStyle = rgba(p.col, 0.85 * Math.min(1, p.z));
        ctx.beginPath();
        ctx.moveTo(-p.s, 0);
        ctx.quadraticCurveTo(0, -p.s * 0.6, p.s, 0);
        ctx.quadraticCurveTo(0, p.s * 0.6, -p.s, 0);
        ctx.fill();
        ctx.restore();
        if (p.z > 1.1) glow(ctx, x, y + bob, p.s * 2.2, p.col, 0.12);
      } else if (p.kind === 'gears' && p.cog) {
        ctx.fillStyle = rgba('#e8c16a', 0.5);
        gearPath(ctx, x, y + bob, 3.2 * p.z, 2.4 * p.z, 7, t * 0.002 + p.ph);
        ctx.fill();
      } else {
        const tw = 0.55 + 0.45 * Math.sin(p.ph * 2.3 + t * 0.002);
        glow(ctx, x, y + bob, p.s * 4 * p.z, p.col, 0.35 * tw);
        dab(ctx, x, y + bob, p.s * p.z * 0.6, p.s * p.z * 0.6, 0, rgba(p.col, 0.7 * tw));
      }
    }
  }

  /**
   * Light shafts, sun glow, haze, colour grade and vignette (stage space). The slow light (shafts + sun glow) is
   * composited into a half-resolution cache refreshed a few times a second and the static haze + vignette into one
   * layer, so a frame pays for two or three full-screen blends instead of eight (the light pass alone was ~13 ms on
   * software-rasterised canvases). `low` also folds the soft-light grade (the costliest blend there) into those
   * two layers as a warm additive wash and a violet shadow.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} t ms
   * @param {{reduced?:boolean, low?:boolean}} [o]
   */
  drawLight(ctx, t, { reduced = false, low = false } = {}) {
    const L = this._lightLayer(t, reduced, low);
    if (L) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(L, 0, 0, 1280, 720);
      ctx.restore();
    }
    if (!low) {
      // colour grade: warm top-right, violet shadows bottom-left
      const G = this._gradeLayer();
      if (G) {
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = 0.55;
        ctx.drawImage(G, 0, 0, 1280, 720);
        ctx.restore();
      }
    }
    const V = this._shadeLayer(low);
    if (V) ctx.drawImage(V, 0, 0, 1280, 720);
  }

  /** Half-resolution additive layer: light shafts falling from the sun and the sun's glow (+ the warm grade when low). */
  _lightLayer(t, reduced, low) {
    const LW = 640;
    const LH = 360;
    if (!this._light) this._light = { c: makeCanvas(LW, LH), t: -Infinity, key: '' };
    const C = this._light;
    if (!C.c) return null;
    const key = `${reduced}|${low}`;
    if (key === C.key && t >= C.t && t - C.t < (low ? 1000 : 250)) return C.c;
    C.key = key;
    C.t = t;
    const g = C.c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, LW, LH);
    g.setTransform(LW / 1280, 0, 0, LH / 720, 0, 0);
    g.globalCompositeOperation = 'lighter';
    const st = this.style;
    const sun = st.sun;
    const sx = sun.x * 1280;
    const sy = sun.y * 720;
    if (!this._beam) this._beam = beamSprite();
    if (this._beam) {
      const n = st.shafts ?? 3;
      for (let i = 0; i < n; i++) {
        const spread = n > 1 ? i / (n - 1) : 0.5;
        const ang = Math.atan2(720 - sy, -300 - sx) + (spread - 0.5) * 0.9 + Math.sin(t * 0.00011 + i * 1.7) * 0.03;
        const width = 90 + ((i * 53) % 110);
        g.save();
        g.translate(sx, sy);
        g.rotate(ang - Math.PI / 2);
        g.globalAlpha = (0.1 + 0.07 * Math.sin(t * 0.00037 + i * 2.1)) * (reduced ? 0.7 : 1);
        g.drawImage(this._beam, -width / 2, 0, width, 1500);
        g.restore();
      }
    }
    g.globalAlpha = 1;
    // the frozen sun's glow
    const r = sun.r * (1 + 0.03 * Math.sin(t * 0.0008));
    const pool = lightPool(sun.color, [sun.a, sun.a * 0.62, sun.a * 0.35, sun.a * 0.14, sun.a * 0.04, 0]);
    if (pool) g.drawImage(pool, sx - r, sy - r, r * 2, r * 2);
    if (low) {
      // stand-in for the soft-light grade's warm half (≈ its effect on mid-tones)
      const lg = g.createLinearGradient(1280, 0, 0, 720);
      lg.addColorStop(0, rgba(st.grade[0], 0.07));
      lg.addColorStop(0.5, rgba(st.grade[0], 0));
      g.fillStyle = lg;
      g.fillRect(0, 0, 1280, 720);
    }
    g.globalCompositeOperation = 'source-over';
    return C.c;
  }

  /** Soft-light grade source, stage-sized so the blend needs no resampling. */
  _gradeLayer() {
    if (this._grade !== null) return this._grade;
    const st = this.style;
    this._grade = makeCanvas(1280, 720);
    if (this._grade) {
      const g = this._grade.getContext('2d');
      const lg = g.createLinearGradient(1280, 0, 0, 720);
      lg.addColorStop(0, rgba(st.grade[0], 0.5));
      lg.addColorStop(0.5, rgba(st.grade[0], 0));
      lg.addColorStop(0.55, rgba(st.grade[1], 0));
      lg.addColorStop(1, rgba(st.grade[1], 0.7));
      g.fillStyle = lg;
      g.fillRect(0, 0, 1280, 720);
    }
    return this._grade;
  }

  /**
   * Static stage-sized layer: distance haze in the zone's fog colour (thickest toward the far, top edge), the
   * soft vignette and, when low, the grade's violet shadow half.
   */
  _shadeLayer(low) {
    const key = low ? 'low' : 'high';
    if (!this._shade) this._shade = {};
    if (this._shade[key] !== undefined) return this._shade[key];
    const c = makeCanvas(1280, 720);
    this._shade[key] = c;
    if (!c) return null;
    const g = c.getContext('2d');
    const fogCol = (ZONE_PALETTES[this.zone] ?? ZONE_PALETTES.shore).fog;
    if (fogCol) {
      const lg = g.createLinearGradient(0, 0, 0, 720);
      lg.addColorStop(0, fogCol);
      lg.addColorStop(0.45, fogCol.replace(/[\d.]+\)$/, '0.04)'));
      lg.addColorStop(1, fogCol.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = lg;
      g.fillRect(0, 0, 1280, 720);
    }
    if (low) {
      const lg = g.createLinearGradient(1280, 0, 0, 720);
      lg.addColorStop(0.55, 'rgba(55,11,77,0)');
      lg.addColorStop(1, 'rgba(55,11,77,0.16)');
      g.fillStyle = lg;
      g.fillRect(0, 0, 1280, 720);
    }
    const rg = g.createRadialGradient(640, 340, 240, 640, 360, 840);
    rg.addColorStop(0, 'rgba(20,10,24,0)');
    rg.addColorStop(0.6, 'rgba(20,10,24,0.18)');
    rg.addColorStop(1, 'rgba(14,6,18,0.62)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 1280, 720);
    return c;
  }
}

export { FONTS, PALETTE };

// ═══════════════════════════════════════════════════════════════════════════ props

/** Painted campfire flame (animated). */
export function flame(ctx, x, y, s, t) {
  if (s <= 0.5) return;
  const layers = [['#b8321e', 1], ['#f07a3a', 0.78], ['#ffd27a', 0.5], ['#fff4d0', 0.26]];
  for (const [col, k] of layers) {
    const w = s * k;
    const h = s * 2.3 * k * (1 + 0.12 * Math.sin(t * 0.017 + k * 5));
    const sway = Math.sin(t * 0.009 + k * 3) * w * 0.25;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x - w * 0.9, y - h * 0.55, x + sway, y - h);
    ctx.quadraticCurveTo(x + w * 0.9, y - h * 0.55, x + w, y);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.0012 + i / 3) % 1;
    sparkle(ctx, x + Math.sin(i * 7 + t * 0.003) * s * 0.8, y - s * 2 - ph * s * 3, 1.6, '#ffd27a', 1 - ph, 0);
  }
}

const _propCache = new Map();
const PQ = 2; // props are small: paint them at 2× for crisp retina output

function propSprite(kind, variant = 0, w = 1) {
  const key = `${kind}:${variant}:${w}`;
  if (_propCache.has(key)) return _propCache.get(key);
  const P = PROP_PAINTERS[kind];
  let spr = null;
  if (P) {
    const box = typeof P.box === 'function' ? P.box(w) : P.box;
    const c = makeCanvas(box.w * PQ, box.h * PQ);
    if (c) {
      const g = c.getContext('2d');
      g.scale(PQ, PQ);
      g.translate(box.ax, box.ay);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      P.paint(g, rng(kind.length * 997 + variant * 131 + w * 17), variant, w);
      spr = { canvas: c, ...box };
    }
  }
  _propCache.set(key, spr);
  return spr;
}

/**
 * Draw a landmark prop anchored at (x, y) = bottom-centre of its anchor tile.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} def prop entity {kind, variant?, w?, flip?}
 */
export function drawProp(ctx, def, x, y, t, player) {
  const P = PROP_PAINTERS[def.kind];
  if (!P) {
    warnOnce(`unknown prop "${def.kind}"`);
    return;
  }
  const spr = propSprite(def.kind, def.variant ?? 0, def.w ?? 1);
  let alpha = 1;
  if (P.fade && player && spr) {
    const b = propBounds(def, x, y);
    if (b && player.y < y - 4 && player.x > b.x0 + 6 && player.x < b.x1 - 6 && player.y > b.y0 && player.y < b.y1 + 8) alpha = 0.5;
  }
  if (spr) {
    ctx.save();
    ctx.translate(x, y);
    if (def.flip) ctx.scale(-1, 1);
    if (alpha < 1) ctx.globalAlpha *= alpha;
    ctx.drawImage(spr.canvas, -spr.ax, -spr.ay, spr.w, spr.h);
    ctx.restore();
  }
  if (P.live) P.live(ctx, x, y, t, def);
}

/** World-space bounds of a prop sprite. */
export function propBounds(def, x, y) {
  const P = PROP_PAINTERS[def.kind];
  if (!P) return null;
  const box = typeof P.box === 'function' ? P.box(def.w ?? 1) : P.box;
  return { x0: x - box.ax, y0: y - box.ay, x1: x - box.ax + box.w, y1: y - box.ay + box.h };
}

function lightGrad(g, x0, x1, dark, mid, light) {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, dark);
  gr.addColorStop(0.55, mid);
  gr.addColorStop(1, light);
  return gr;
}

const PROP_PAINTERS = {
  lighthouse: {
    box: { w: 120, h: 250, ax: 60, ay: 236 },
    fade: true,
    paint(g, R, v) {
      // rocky plinth
      for (let i = 0; i < 6; i++) rockShape(g, (R() - 0.5) * 60, -6 - R() * 8, 14 + R() * 10, 9 + R() * 6, R, '#7a6a70', '#43343f', '#e8c6a8');
      const H = v ? 120 : 160;
      const b0 = 24;
      const b1 = 16;
      // tower body with stripes
      const band = (y0, y1, col) => {
        const w0 = lerp(b0, b1, -y0 / 170);
        const w1 = lerp(b0, b1, -y1 / 170);
        g.fillStyle = lightGrad(g, -b0, b0, shade(col, -0.45), col, shade(col, 0.35));
        g.beginPath();
        g.moveTo(-w0, y0);
        g.lineTo(-w1, y1);
        g.lineTo(w1, y1);
        g.lineTo(w0, y0);
        g.closePath();
        g.fill();
      };
      const n = v ? 3 : 4;
      for (let i = 0; i < n; i++) {
        const y0 = -14 - (i * (H - 14)) / n;
        const y1 = -14 - ((i + 1) * (H - 14)) / n;
        band(y0, y1, i % 2 ? '#a3302a' : '#e9e0cc');
      }
      // weathering streaks
      for (let i = 0; i < 26; i++) brush(g, (R() - 0.5) * 34, -20 - R() * (H - 30), 6 + R() * 16, 1.2, Math.PI / 2, rgba(R() < 0.6 ? '#4a3a34' : '#fff4dc', 0.25));
      // door & windows
      g.fillStyle = '#2a1c16';
      g.beginPath();
      g.roundRect(-6, -34, 12, 20, [6, 6, 0, 0]);
      g.fill();
      for (let k = 1; k < 3; k++) {
        g.fillStyle = '#1e1412';
        g.fillRect(-3, -40 - k * 38, 6, 9);
        g.fillStyle = 'rgba(255,210,140,0.35)';
        g.fillRect(-1.5, -38.5 - k * 38, 3, 6);
      }
      const top = -H;
      const wt = lerp(b0, b1, H / 170);
      if (!v) {
        // gallery + broken lantern room
        g.fillStyle = '#2a2024';
        g.fillRect(-wt - 6, top - 4, wt * 2 + 12, 5);
        g.strokeStyle = '#2a2024';
        g.lineWidth = 1.4;
        for (let k = -wt - 5; k <= wt + 5; k += 5) {
          g.beginPath();
          g.moveTo(k, top - 4);
          g.lineTo(k, top - 12);
          g.stroke();
        }
        g.beginPath();
        g.moveTo(-wt - 6, top - 12);
        g.lineTo(wt + 6, top - 12);
        g.stroke();
        // bent iron frame of the lantern room
        g.strokeStyle = '#3a2e30';
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(-10, top - 4);
        g.lineTo(-12, top - 30);
        g.lineTo(-2, top - 40);
        g.moveTo(10, top - 4);
        g.lineTo(13, top - 22);
        g.lineTo(20, top - 26);
        g.moveTo(0, top - 4);
        g.lineTo(2, top - 34);
        g.stroke();
        // glass shards
        for (let i = 0; i < 6; i++) {
          g.fillStyle = rgba('#bfe8f0', 0.55);
          const sx = (R() - 0.5) * 22;
          const sy = top - 8 - R() * 24;
          g.beginPath();
          g.moveTo(sx, sy);
          g.lineTo(sx + 3 + R() * 3, sy - 5 - R() * 5);
          g.lineTo(sx + 5, sy + 1);
          g.fill();
        }
      } else {
        // snapped top: jagged masonry
        g.fillStyle = '#e9e0cc';
        g.beginPath();
        g.moveTo(-wt, top);
        g.lineTo(-wt + 6, top - 12);
        g.lineTo(-2, top - 4);
        g.lineTo(5, top - 16);
        g.lineTo(wt, top - 2);
        g.lineTo(wt, top + 2);
        g.lineTo(-wt, top + 2);
        g.fill();
        // fallen blocks at the foot
        for (let i = 0; i < 5; i++) {
          g.fillStyle = i % 2 ? '#a3302a' : '#d9d0bc';
          g.save();
          g.translate(24 + R() * 24, -4 - R() * 8);
          g.rotate(R() * 1.2);
          g.fillRect(-6, -4, 12, 8);
          g.restore();
        }
      }
      // sunlit rim
      g.strokeStyle = 'rgba(255,236,200,0.55)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(b0 - 1, -14);
      g.lineTo(wt - 1, top + 2);
      g.stroke();
    },
    live(ctx, x, y, t, def) {
      if (!def.variant) {
        // a faint, stubborn ember of light still in the broken lamp
        const a = 0.25 + 0.12 * Math.sin(t * 0.0021);
        glow(ctx, x, y - 196, 60, '#ffd08a', a);
      }
    },
  },
  wreck: {
    box: (w) => ({ w: w * 40 + 60, h: 150, ax: (w * 40 + 60) / 2, ay: 124 }),
    paint(g, R, v, w) {
      const L = w * 40;
      // hull lying on its side, bow up to the right
      g.save();
      g.rotate(-0.06);
      const hull = new Path2D();
      hull.moveTo(-L / 2, -6);
      hull.quadraticCurveTo(-L / 2 - 10, -40, -L / 2 + 14, -58);
      hull.lineTo(L / 2 - 20, -62);
      hull.quadraticCurveTo(L / 2 + 16, -60, L / 2 + 10, -30);
      hull.quadraticCurveTo(L / 2, -4, L / 2 - 30, 0);
      hull.closePath();
      g.fillStyle = '#3a2820';
      g.fill(hull);
      g.save();
      g.clip(hull);
      for (let k = -70; k < 10; k += 7) {
        g.fillStyle = vary('#6a4a36', R(), 0.18);
        g.fillRect(-L / 2 - 20, k, L + 40, 6);
      }
      // missing planks show ribs
      for (let i = 0; i < 5; i++) {
        const hx = -L / 2 + 20 + R() * (L - 40);
        const hy = -50 + R() * 34;
        g.fillStyle = '#1a100c';
        g.beginPath();
        g.ellipse(hx, hy, 10 + R() * 12, 6 + R() * 5, 0, 0, TAU);
        g.fill();
        g.strokeStyle = '#6a4a36';
        g.lineWidth = 2.5;
        for (let k = -2; k <= 2; k++) {
          g.beginPath();
          g.moveTo(hx + k * 6, hy - 8);
          g.lineTo(hx + k * 6, hy + 8);
          g.stroke();
        }
      }
      // barnacles and algae along the waterline
      for (let i = 0; i < 40; i++) dab(g, -L / 2 + R() * L, -6 - R() * 16, 1.6 + R() * 2, 1.4 + R() * 1.6, 0, R() < 0.5 ? '#d8d0c0' : '#4a6a50');
      const lg = g.createLinearGradient(0, -70, 0, 0);
      lg.addColorStop(0, 'rgba(255,220,170,0.25)');
      lg.addColorStop(0.5, 'rgba(0,0,0,0)');
      lg.addColorStop(1, 'rgba(30,14,30,0.45)');
      g.fillStyle = lg;
      g.fillRect(-L, -80, L * 2, 90);
      g.restore();
      g.strokeStyle = 'rgba(21,14,12,0.6)';
      g.lineWidth = 1.2;
      g.stroke(hull);
      g.restore();
      // broken mast with a torn sail
      g.strokeStyle = '#4a3222';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(-L * 0.1, -56);
      g.lineTo(L * 0.18, -112);
      g.stroke();
      g.strokeStyle = '#6a4a36';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-L * 0.1 + 2, -56);
      g.lineTo(L * 0.18 + 2, -112);
      g.stroke();
      g.fillStyle = rgba('#e0d4bc', 0.85);
      g.beginPath();
      g.moveTo(L * 0.14, -104);
      g.quadraticCurveTo(L * 0.3, -96, L * 0.36, -70);
      g.lineTo(L * 0.26, -78);
      g.lineTo(L * 0.2, -66);
      g.quadraticCurveTo(L * 0.12, -80, L * 0.1, -90);
      g.closePath();
      g.fill();
      // rope
      g.strokeStyle = 'rgba(200,180,140,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(L * 0.18, -112);
      g.quadraticCurveTo(L * 0.34, -80, L / 2 - 8, -56);
      g.stroke();
    },
  },
  rowboat: {
    box: { w: 100, h: 60, ax: 50, ay: 44 },
    paint(g, R, v) {
      const old = v === 1;
      const body = old ? '#7a7068' : '#e9e0cc';
      const stripe = old ? '#5a4a44' : '#a3302a';
      g.save();
      g.rotate(-0.12);
      g.fillStyle = shade(body, -0.5);
      g.beginPath();
      g.ellipse(0, -12, 40, 14, 0, 0, TAU);
      g.fill();
      g.fillStyle = body;
      g.beginPath();
      g.ellipse(0, -14, 38, 12, 0, 0, TAU);
      g.fill();
      g.fillStyle = shade(old ? '#4a3a30' : '#6a4a36', -0.1);
      g.beginPath();
      g.ellipse(0, -15, 33, 8.5, 0, 0, TAU);
      g.fill();
      g.fillStyle = stripe;
      g.fillRect(-36, -14, 72, 2.4);
      for (const k of [-14, 6]) {
        g.fillStyle = old ? '#5a4a3a' : '#8a6a4a';
        g.fillRect(k, -22, 5, 15);
      }
      if (!old) {
        g.strokeStyle = '#8a6a4a';
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(-6, -18);
        g.lineTo(30, 2);
        g.stroke();
        g.fillStyle = '#e0b458';
        g.font = `700 8px ${FONTS.title}`;
        g.fillText('69', 22, -18);
      } else {
        // biscuit tin under the thwart
        g.fillStyle = '#8a5a3a';
        g.fillRect(-4, -18, 8, 5);
        g.fillStyle = rgba('#e0b458', 0.8);
        g.fillRect(-4, -18, 8, 1);
        for (let i = 0; i < 10; i++) dab(g, (R() - 0.5) * 60, -10 - R() * 8, 2, 1.5, 0, '#5a6a44');
      }
      g.restore();
    },
  },
  tent: {
    box: { w: 110, h: 90, ax: 55, ay: 76 },
    paint(g) {
      // guy ropes
      g.strokeStyle = 'rgba(80,60,40,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-8, -58);
      g.lineTo(-50, -2);
      g.moveTo(8, -58);
      g.lineTo(50, -2);
      g.stroke();
      // canvas
      g.fillStyle = '#b8a078';
      g.beginPath();
      g.moveTo(-40, 0);
      g.lineTo(-4, -62);
      g.lineTo(4, -62);
      g.lineTo(40, 0);
      g.closePath();
      g.fill();
      g.fillStyle = lightGrad(g, -40, 40, '#7a6448', '#c9b088', '#f0dcb0');
      g.beginPath();
      g.moveTo(-36, 0);
      g.lineTo(0, -60);
      g.lineTo(36, 0);
      g.closePath();
      g.fill();
      // open flap with lamplight inside
      g.fillStyle = '#2a1a12';
      g.beginPath();
      g.moveTo(-12, 0);
      g.lineTo(0, -38);
      g.lineTo(12, 0);
      g.closePath();
      g.fill();
      const gl = g.createRadialGradient(0, -6, 1, 0, -6, 16);
      gl.addColorStop(0, 'rgba(255,200,120,0.85)');
      gl.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gl;
      g.fillRect(-14, -30, 28, 30);
      g.fillStyle = '#d8c8a0';
      g.beginPath();
      g.moveTo(0, -38);
      g.lineTo(16, 0);
      g.lineTo(9, 0);
      g.closePath();
      g.fill();
      // patches & seams
      g.fillStyle = '#a3302a';
      g.fillRect(-26, -16, 8, 7);
      g.strokeStyle = 'rgba(90,70,50,0.45)';
      g.beginPath();
      g.moveTo(-18, -30);
      g.lineTo(-30, -2);
      g.stroke();
      // pole top pennant
      g.strokeStyle = '#3a281e';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -60);
      g.lineTo(0, -72);
      g.stroke();
      g.fillStyle = '#e0b458';
      g.beginPath();
      g.moveTo(0, -72);
      g.lineTo(10, -68);
      g.lineTo(0, -65);
      g.fill();
    },
  },
  campfire: {
    box: { w: 60, h: 30, ax: 30, ay: 22 },
    paint(g, R) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        dab(g, Math.cos(a) * 14, -6 + Math.sin(a) * 6, 4, 3, a, mix('#6a5a56', '#a89888', R()));
      }
      brush(g, -12, -2, 24, 4, -0.2, '#4a3222');
      brush(g, 12, -2, -24, 4, 0.2, '#5a3a28');
      dab(g, 0, -5, 9, 4, 0, '#2a140c');
    },
    live(ctx, x, y, t) {
      const fl = 0.8 + 0.2 * Math.sin(t * 0.021) * Math.sin(t * 0.013);
      glow(ctx, x, y - 30, 110 * fl, '#ff9a4a', 0.28);
      flame(ctx, x, y - 16, 10, t);
    },
  },
  crates: {
    box: { w: 70, h: 60, ax: 35, ay: 50 },
    paint(g, R, v) {
      const crate = (x, y, s) => {
        g.fillStyle = '#5a3e28';
        g.fillRect(x - s / 2, y - s, s, s);
        g.fillStyle = lightGrad(g, x - s / 2, x + s / 2, '#6a4a30', '#9a7250', '#c29a70');
        g.fillRect(x - s / 2 + 1.5, y - s + 1.5, s - 3, s - 3);
        g.strokeStyle = '#4a3020';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - s / 2 + 2, y - s + 2);
        g.lineTo(x + s / 2 - 2, y - 2);
        g.stroke();
        g.fillStyle = 'rgba(255,230,190,0.3)';
        g.fillRect(x - s / 2 + 2, y - s + 2, s - 4, 1.4);
      };
      crate(-10, 0, 22);
      crate(12, 0, 18);
      crate(-4, -22, 16);
      if (v !== 1) {
        // barrel
        g.fillStyle = lightGrad(g, 16, 34, '#4a3020', '#8a6040', '#b88a60');
        g.beginPath();
        g.ellipse(26, -12, 9, 13, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#3a3030';
        g.fillRect(17, -18, 18, 2);
        g.fillRect(17, -7, 18, 2);
      }
    },
  },
  lantern: {
    box: { w: 40, h: 110, ax: 20, ay: 104 },
    paint(g) {
      g.fillStyle = '#2a2024';
      g.fillRect(-2.5, -86, 5, 86);
      g.fillRect(-7, -4, 14, 4);
      g.fillStyle = 'rgba(255,230,190,0.35)';
      g.fillRect(0.5, -86, 1.2, 82);
      g.strokeStyle = '#2a2024';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -86);
      g.quadraticCurveTo(10, -92, 12, -84);
      g.stroke();
      g.fillStyle = '#2a2024';
      g.fillRect(6, -84, 12, 14);
      g.fillStyle = '#ffd27a';
      g.fillRect(8, -82, 8, 10);
      g.fillStyle = '#2a2024';
      g.beginPath();
      g.moveTo(5, -84);
      g.lineTo(12, -90);
      g.lineTo(19, -84);
      g.fill();
    },
    live(ctx, x, y, t) {
      const fl = 0.85 + 0.15 * Math.sin(t * 0.017) * Math.sin(t * 0.006);
      glow(ctx, x + 12, y - 77, 60 * fl, '#ffb45a', 0.45);
      glow(ctx, x + 12, y - 77, 12, '#fff0c0', 0.8);
    },
  },
  anchor: {
    box: { w: 90, h: 90, ax: 45, ay: 74 },
    paint(g) {
      g.save();
      g.rotate(0.35);
      g.strokeStyle = '#3a2a26';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(0, -60);
      g.lineTo(0, 0);
      g.moveTo(-22, -10);
      g.quadraticCurveTo(0, 12, 22, -10);
      g.moveTo(-14, -50);
      g.lineTo(14, -50);
      g.stroke();
      g.strokeStyle = '#8a5a3a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(1.5, -60);
      g.lineTo(1.5, -2);
      g.stroke();
      g.strokeStyle = '#3a2a26';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, -66, 6, 0, TAU);
      g.stroke();
      g.restore();
      // half-buried in sand
      g.fillStyle = '#d0b084';
      g.beginPath();
      g.ellipse(4, 0, 26, 7, 0, 0, TAU);
      g.fill();
    },
  },
  frozen_wave: {
    box: { w: 520, h: 250, ax: 260, ay: 170 },
    paint(g, R) {
      // a great wave curling overhead, stopped mid-fall
      const body = new Path2D();
      body.moveTo(-250, 60);
      body.bezierCurveTo(-180, 20, -120, -70, -10, -130);
      body.bezierCurveTo(90, -170, 190, -150, 230, -100);
      body.bezierCurveTo(250, -70, 220, -40, 190, -52);
      body.bezierCurveTo(170, -60, 175, -85, 150, -90);
      body.bezierCurveTo(90, -100, 40, -50, 20, 10);
      body.bezierCurveTo(10, 40, 60, 60, 120, 70);
      body.lineTo(-250, 70);
      body.closePath();
      const gr = g.createLinearGradient(-200, 60, 120, -150);
      gr.addColorStop(0, 'rgba(34,90,100,0.9)');
      gr.addColorStop(0.45, 'rgba(70,150,150,0.92)');
      gr.addColorStop(0.8, 'rgba(150,215,205,0.95)');
      gr.addColorStop(1, 'rgba(230,248,240,0.95)');
      g.fillStyle = gr;
      g.fill(body);
      g.save();
      g.clip(body);
      // translucent light through the lip
      const lg = g.createRadialGradient(150, -100, 5, 150, -100, 120);
      lg.addColorStop(0, 'rgba(255,240,210,0.55)');
      lg.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = lg;
      g.fillRect(0, -200, 300, 250);
      for (let i = 0; i < 60; i++) {
        const x = -220 + R() * 420;
        const y = -130 + R() * 190;
        brush(g, x, y, 20 + R() * 40, 1.5 + R() * 2.5, -0.5 - R() * 0.4, rgba(R() < 0.5 ? '#bfeee4' : '#1e5a64', 0.3));
      }
      g.restore();
      // foam crest
      for (let i = 0; i < 70; i++) {
        const u = R();
        const x = lerp(-60, 225, u);
        const y = -130 - Math.sin(u * Math.PI) * 24 + (R() - 0.5) * 14 + u * 30;
        dab(g, x, y, 4 + R() * 7, 3 + R() * 4, R(), rgba('#f6fbf6', 0.7 + R() * 0.3));
      }
      // suspended spray
      for (let i = 0; i < 90; i++) {
        const x = 60 + R() * 200;
        const y = -170 + R() * 150;
        dab(g, x, y, 0.8 + R() * 1.6, 0.8 + R() * 1.6, 0, rgba('#ffffff', 0.5 + R() * 0.5));
      }
      // the swell melts back into the paused sea (no hard base line)
      g.save();
      g.globalCompositeOperation = 'destination-out';
      const fade = g.createLinearGradient(0, -10, 0, 80);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = fade;
      g.fillRect(-270, -10, 540, 90);
      const side = g.createLinearGradient(-260, 0, -120, 0);
      side.addColorStop(0, 'rgba(0,0,0,1)');
      side.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = side;
      g.fillRect(-270, -200, 150, 290);
      g.restore();
    },
    live(ctx, x, y, t) {
      for (let i = 0; i < 8; i++) {
        const ph = (t * 0.0003 + i * 0.13) % 1;
        sparkle(ctx, x + 60 + ((i * 53) % 190), y - 170 + ((i * 37) % 130), 3, '#ffffff', Math.sin(ph * Math.PI) * 0.8, 0);
      }
    },
  },
  stall: {
    box: { w: 120, h: 110, ax: 60, ay: 92 },
    paint(g, R, v) {
      const stripeA = v === 2 ? '#4a3a2a' : '#a3302a';
      const stripeB = v === 2 ? '#b8893b' : '#efe4cc';
      // poles
      g.fillStyle = '#3a281e';
      g.fillRect(-44, -76, 4, 76);
      g.fillRect(40, -76, 4, 76);
      // table with goods
      g.fillStyle = '#5a3e28';
      g.fillRect(-42, -26, 84, 6);
      g.fillStyle = '#4a3020';
      g.fillRect(-38, -20, 4, 20);
      g.fillRect(34, -20, 4, 20);
      const goods = ['#9fd9f0', '#e0b458', '#c77dff', '#d6453d', '#8fcf6b', '#f3dba0'];
      for (let i = 0; i < 9; i++) {
        const gx = -36 + i * 9;
        const col = goods[i % goods.length];
        if (i % 3 === 0) {
          g.fillStyle = col;
          g.fillRect(gx, -36, 5, 10);
          g.fillRect(gx + 1.5, -39, 2, 3);
        } else dab(g, gx + 3, -30, 3.4, 3.4, 0, col);
      }
      // awning
      g.save();
      g.beginPath();
      g.moveTo(-54, -70);
      g.lineTo(54, -70);
      g.lineTo(48, -90);
      g.lineTo(-48, -90);
      g.closePath();
      g.clip();
      for (let k = -60; k < 60; k += 12) {
        g.fillStyle = (k / 12) % 2 ? stripeA : stripeB;
        g.fillRect(k, -92, 12, 24);
      }
      g.fillStyle = 'rgba(40,20,20,0.25)';
      g.fillRect(-60, -76, 120, 6);
      g.restore();
      for (let k = -54; k < 54; k += 12) {
        g.fillStyle = (Math.floor((k + 60) / 12) % 2) ? stripeA : stripeB;
        g.beginPath();
        g.moveTo(k, -70);
        g.quadraticCurveTo(k + 6, -62, k + 12, -70);
        g.fill();
      }
    },
    live(ctx, x, y, t) {
      glow(ctx, x - 28, y - 30, 14, '#9fd9f0', 0.3 + 0.1 * Math.sin(t * 0.003));
      glow(ctx, x + 4, y - 30, 12, '#c77dff', 0.3 + 0.1 * Math.sin(t * 0.0037));
    },
  },
  signpost: {
    box: { w: 70, h: 80, ax: 35, ay: 72 },
    paint(g) {
      g.fillStyle = '#4a3222';
      g.fillRect(-2.5, -64, 5, 64);
      g.fillStyle = '#8a6a4a';
      g.beginPath();
      g.moveTo(-2, -60);
      g.lineTo(24, -60);
      g.lineTo(30, -54);
      g.lineTo(24, -48);
      g.lineTo(-2, -48);
      g.fill();
      g.beginPath();
      g.moveTo(2, -44);
      g.lineTo(-24, -44);
      g.lineTo(-30, -38);
      g.lineTo(-24, -32);
      g.lineTo(2, -32);
      g.fill();
      g.fillStyle = 'rgba(40,24,16,0.55)';
      g.fillRect(4, -55, 16, 1.4);
      g.fillRect(-22, -39, 18, 1.4);
    },
  },
  wagon: {
    box: { w: 150, h: 120, ax: 75, ay: 100 },
    paint(g) {
      // wheels (back)
      const wheel = (x, r) => {
        g.strokeStyle = '#3a281e';
        g.lineWidth = 3.4;
        g.beginPath();
        g.arc(x, -r, r, 0, TAU);
        g.stroke();
        g.lineWidth = 1.6;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          g.beginPath();
          g.moveTo(x, -r);
          g.lineTo(x + Math.cos(a) * r, -r + Math.sin(a) * r);
          g.stroke();
        }
        dab(g, x, -r, 3, 3, 0, '#c9a052');
      };
      // body
      g.fillStyle = lightGrad(g, -60, 60, '#1e3a4a', '#2e6a78', '#4a8a94');
      g.beginPath();
      g.roundRect(-56, -78, 112, 56, 6);
      g.fill();
      // roof
      g.fillStyle = '#6a2a3a';
      g.beginPath();
      g.moveTo(-62, -76);
      g.quadraticCurveTo(0, -112, 62, -76);
      g.lineTo(62, -72);
      g.quadraticCurveTo(0, -104, -62, -72);
      g.closePath();
      g.fill();
      g.fillStyle = '#8a3a4a';
      g.beginPath();
      g.moveTo(-58, -76);
      g.quadraticCurveTo(0, -108, 58, -76);
      g.closePath();
      g.fill();
      // gilded trim and painted stars
      g.strokeStyle = '#e0b458';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(-52, -74, 104, 48, 4);
      g.stroke();
      for (let i = 0; i < 6; i++) sparkle(g, -40 + i * 16, -60 + (i % 2) * 14, 4, '#f3dba0', 0.9, 0);
      // door + window
      g.fillStyle = '#1a2a30';
      g.beginPath();
      g.roundRect(18, -68, 18, 40, [9, 9, 0, 0]);
      g.fill();
      g.fillStyle = '#ffd27a';
      g.beginPath();
      g.arc(-20, -52, 9, 0, TAU);
      g.fill();
      g.strokeStyle = '#e0b458';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(-20, -52, 9, 0, TAU);
      g.moveTo(-29, -52);
      g.lineTo(-11, -52);
      g.moveTo(-20, -61);
      g.lineTo(-20, -43);
      g.stroke();
      // steps
      g.fillStyle = '#5a3e28';
      g.fillRect(20, -22, 14, 4);
      g.fillRect(22, -12, 12, 4);
      wheel(-36, 16);
      wheel(40, 16);
    },
    live(ctx, x, y, t) {
      glow(ctx, x - 20, y - 52, 34, '#ffc070', 0.35 + 0.08 * Math.sin(t * 0.004));
    },
  },
  arch: {
    box: { w: 140, h: 150, ax: 70, ay: 136 },
    fade: true,
    paint(g, R) {
      const stone = (x, y, w, h, c) => {
        g.fillStyle = shade(c, -0.35);
        g.fillRect(x - 1, y + 1, w, h);
        g.fillStyle = c;
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,240,210,0.3)';
        g.fillRect(x, y, w, 1.4);
      };
      for (let k = 0; k < 8; k++) {
        stone(-56, -14 - k * 13, 20, 12, vary('#9a9272', R(), 0.1));
        if (k < 5) stone(36, -14 - k * 13, 20, 12, vary('#9a9272', R(), 0.1));
      }
      // arc (left intact, right broken)
      for (let i = 0; i <= 7; i++) {
        const a = Math.PI + (i / 10) * Math.PI;
        const x = Math.cos(a) * 46;
        const y = -112 + Math.sin(a) * 30;
        g.save();
        g.translate(x, y);
        g.rotate(a + Math.PI / 2);
        stone(-8, -6, 16, 12, vary('#a8a080', R(), 0.1));
        g.restore();
      }
      // gold ivy
      for (let i = 0; i < 70; i++) {
        const u = R();
        const x = -46 + (R() - 0.5) * 18;
        const y = -20 - u * 110;
        dab(g, x, y, 2.6, 1.6, R() * TAU, R() < 0.6 ? '#c9a43a' : '#e3c15b');
      }
      for (let i = 0; i < 30; i++) dab(g, (R() - 0.5) * 80 - 10, -130 + R() * 20, 2.6, 1.6, R() * TAU, '#e3c15b');
      // fallen stones
      for (let i = 0; i < 4; i++) stone(20 + R() * 30, -8 - R() * 6, 14, 9, '#8a8468');
    },
  },
  statue: {
    box: { w: 80, h: 150, ax: 40, ay: 138 },
    fade: true,
    paint(g, R) {
      // plinth
      g.fillStyle = lightGrad(g, -24, 24, '#4e4838', '#8a8468', '#c8c0a0');
      g.fillRect(-22, -30, 44, 30);
      g.fillStyle = '#b0a888';
      g.fillRect(-25, -34, 50, 5);
      // explorer figure with a raised spyglass, weathered stone
      const st = '#a8a08a';
      g.fillStyle = lightGrad(g, -14, 14, shade(st, -0.4), st, shade(st, 0.3));
      g.beginPath();
      g.moveTo(-10, -34);
      g.lineTo(-13, -80);
      g.quadraticCurveTo(0, -92, 13, -80);
      g.lineTo(10, -34);
      g.closePath();
      g.fill();
      dab(g, 0, -98, 8, 9, 0, st);
      dab(g, 2, -101, 8.6, 3, 0, shade(st, -0.2));
      g.strokeStyle = st;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(10, -76);
      g.lineTo(20, -100);
      g.stroke();
      g.fillStyle = shade(st, -0.2);
      g.fillRect(16, -118, 6, 18);
      // moss + leaves settled on the shoulders
      for (let i = 0; i < 26; i++) dab(g, (R() - 0.5) * 28, -80 - R() * 26, 2.2, 1.4, R() * TAU, R() < 0.5 ? '#c9a43a' : '#6a6a30');
    },
  },
  log: {
    box: { w: 110, h: 50, ax: 55, ay: 38 },
    paint(g, R) {
      g.save();
      g.rotate(-0.08);
      g.fillStyle = lightGrad(g, 0, 0, '#3a2a1c', '#5a4028', '#7a5a38');
      const gr = g.createLinearGradient(0, -24, 0, 0);
      gr.addColorStop(0, '#7a5a38');
      gr.addColorStop(1, '#3a2a1c');
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(-48, -22, 96, 20, 9);
      g.fill();
      dab(g, 46, -12, 7, 10, 0, '#a07a50');
      dab(g, 46, -12, 4, 6, 0, '#c9a070');
      for (let i = 0; i < 30; i++) dab(g, -40 + R() * 80, -20 + R() * 6, 2.4, 1.4, R(), R() < 0.5 ? '#6a6a30' : '#c9a43a');
      g.restore();
    },
  },
  bellframe: {
    box: { w: 90, h: 120, ax: 45, ay: 108 },
    paint(g) {
      g.fillStyle = '#4a3222';
      g.fillRect(-34, -96, 6, 96);
      g.fillRect(28, -96, 6, 96);
      g.fillRect(-40, -100, 80, 7);
      g.fillStyle = lightGrad(g, -16, 16, '#5a3818', '#b87333', '#f0b070');
      g.beginPath();
      g.moveTo(-6, -92);
      g.quadraticCurveTo(-8, -76, -16, -58);
      g.lineTo(16, -58);
      g.quadraticCurveTo(8, -76, 6, -92);
      g.closePath();
      g.fill();
      dab(g, 0, -56, 16, 3, 0, '#8a5020');
    },
  },
  geartower: {
    box: { w: 150, h: 200, ax: 75, ay: 186 },
    fade: true,
    paint(g) {
      g.fillStyle = lightGrad(g, -56, 56, '#2a1e10', '#6f5426', '#b8893b');
      g.fillRect(-50, -170, 12, 170);
      g.fillRect(38, -170, 12, 170);
      g.fillRect(-56, -176, 112, 10);
      g.fillRect(-56, -8, 112, 8);
      g.fillStyle = '#e8c16a';
      g.fillRect(-56, -176, 112, 1.6);
    },
    live(ctx, x, y, t) {
      const gear = (gx, gy, r, n, sp, col) => {
        ctx.fillStyle = shade(col, -0.45);
        gearPath(ctx, x + gx + 1.5, y + gy + 2, r, r * 0.8, n, t * sp);
        ctx.fill();
        ctx.fillStyle = col;
        gearPath(ctx, x + gx, y + gy, r, r * 0.8, n, t * sp);
        ctx.fill();
        ctx.fillStyle = shade(col, -0.35);
        ctx.beginPath();
        ctx.arc(x + gx, y + gy, r * 0.45, 0, TAU);
        ctx.fill();
        ctx.fillStyle = shade(col, 0.4);
        ctx.beginPath();
        ctx.arc(x + gx - 1, y + gy - 1, r * 0.16, 0, TAU);
        ctx.fill();
      };
      gear(-8, -120, 34, 16, 0.0006, '#b8893b');
      gear(22, -70, 24, 12, -0.00085, '#d0a050');
      gear(-18, -48, 18, 10, 0.0011, '#8a6a32');
    },
  },
  clock: {
    box: { w: 80, h: 170, ax: 40, ay: 158 },
    fade: true,
    paint(g) {
      g.fillStyle = lightGrad(g, -18, 18, '#2a1e10', '#6f5426', '#c9a052');
      g.fillRect(-7, -110, 14, 110);
      g.fillRect(-16, -8, 32, 8);
      dab(g, 0, -128, 30, 30, 0, '#3e2c14');
      dab(g, 0, -128, 26, 26, 0, '#f3e6c8');
      g.strokeStyle = '#3e2c14';
      g.lineWidth = 1.6;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a) * 21, -128 + Math.sin(a) * 21);
        g.lineTo(Math.cos(a) * 24, -128 + Math.sin(a) * 24);
        g.stroke();
      }
    },
    live(ctx, x, y, t) {
      // twenty to seven, forever (the minute hand trembles, but never moves on)
      const cy = y - 128;
      const tremble = Math.sin(t * 0.03) * 0.02;
      const hourA = -Math.PI / 2 + ((6 + 40 / 60) / 12) * TAU;
      const minA = -Math.PI / 2 + (40 / 60) * TAU + tremble;
      ctx.strokeStyle = '#2a1c0c';
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.lineTo(x + Math.cos(hourA) * 13, cy + Math.sin(hourA) * 13);
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.lineTo(x + Math.cos(minA) * 20, cy + Math.sin(minA) * 20);
      ctx.stroke();
      dab(ctx, x, cy, 2, 2, 0, '#e0b458');
    },
  },
  bench: {
    box: { w: 110, h: 90, ax: 55, ay: 76 },
    paint(g, R) {
      g.fillStyle = '#4a3222';
      g.fillRect(-44, -30, 88, 8);
      g.fillRect(-40, -22, 5, 22);
      g.fillRect(35, -22, 5, 22);
      g.fillStyle = '#6a4a2e';
      g.fillRect(-44, -32, 88, 3);
      // tools, springs, a half-built little sun
      for (let i = 0; i < 6; i++) {
        g.fillStyle = '#b8893b';
        gearPath(g, -30 + i * 11, -38, 4 + (i % 3), 3 + (i % 3) * 0.8, 7, i);
        g.fill();
      }
      dab(g, 26, -42, 9, 9, 0, '#e0b458');
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        brush(g, 26 + Math.cos(a) * 10, -42 + Math.sin(a) * 10, 4, 1.4, a, '#e0b458');
      }
      // lamp arm
      g.strokeStyle = '#2a1c0c';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-36, -32);
      g.lineTo(-40, -64);
      g.lineTo(-24, -70);
      g.stroke();
      g.fillStyle = '#3e2c14';
      g.beginPath();
      g.moveTo(-30, -72);
      g.lineTo(-18, -72);
      g.lineTo(-20, -64);
      g.lineTo(-28, -64);
      g.fill();
    },
    live(ctx, x, y, t) {
      glow(ctx, x - 24, y - 62, 40, '#ffd08a', 0.4);
      glow(ctx, x + 26, y - 42, 18, '#ffe0a0', 0.3 + 0.15 * Math.sin(t * 0.004));
    },
  },
  steamvent: {
    box: { w: 50, h: 20, ax: 25, ay: 14 },
    paint(g) {
      g.fillStyle = '#2a1e10';
      g.fillRect(-14, -10, 28, 12);
      g.fillStyle = '#8a6a32';
      for (let k = 0; k < 4; k++) g.fillRect(-13, -9 + k * 3, 26, 1.4);
    },
    live(ctx, x, y, t) {
      const cyc = (t % 3400) / 3400;
      for (let i = 0; i < 7; i++) {
        const u = (cyc * 1.6 + i / 7) % 1;
        const a = Math.sin(u * Math.PI) * (cyc < 0.55 ? 0.45 : 0.18);
        const r = 6 + u * 22;
        const g = ctx.createRadialGradient(x, y - 8 - u * 70, 0, x, y - 8 - u * 70, r);
        g.addColorStop(0, `rgba(245,235,220,${a})`);
        g.addColorStop(1, 'rgba(245,235,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r + Math.sin(i + u * 3) * 6, y - 8 - u * 70 - r, r * 2, r * 2);
      }
    },
  },
  dial: {
    box: (w) => ({ w: w * 80 + 20, h: w * 56 + 20, ax: w * 40 + 10, ay: w * 28 + 10 }),
    paint(g, R, v, w) {
      // the great sundial floor of the Summit (w = radius in tiles), seen in shallow perspective
      const rx = w * 40;
      const ry = w * 28;
      const ring = (r, col, lw) => {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        g.ellipse(0, 0, rx * r, ry * r, 0, 0, TAU);
        g.stroke();
      };
      const fill = g.createRadialGradient(0, 0, 10, 0, 0, rx);
      fill.addColorStop(0, 'rgba(255,220,150,0.28)');
      fill.addColorStop(1, 'rgba(120,80,50,0.12)');
      g.fillStyle = fill;
      g.beginPath();
      g.ellipse(0, 0, rx, ry, 0, 0, TAU);
      g.fill();
      ring(1, 'rgba(240,192,96,0.8)', 3);
      ring(0.93, 'rgba(240,192,96,0.45)', 1.4);
      ring(0.58, 'rgba(240,192,96,0.55)', 2);
      ring(0.22, 'rgba(240,192,96,0.65)', 2);
      const nums = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
      g.fillStyle = 'rgba(255,230,170,0.85)';
      g.font = `700 ${Math.round(12 + w)}px ${FONTS.title}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i / 12) * TAU;
        g.fillText(nums[i], Math.cos(a) * rx * 0.76, Math.sin(a) * ry * 0.76);
        g.strokeStyle = 'rgba(240,192,96,0.7)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * rx * 0.93, Math.sin(a) * ry * 0.93);
        g.lineTo(Math.cos(a) * rx, Math.sin(a) * ry);
        g.stroke();
      }
      // the hands: twenty to seven
      const hand = (a, len, wd) => {
        g.strokeStyle = 'rgba(240,192,96,0.85)';
        g.lineWidth = wd;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * rx * len, Math.sin(a) * ry * len);
        g.stroke();
      };
      hand(-Math.PI / 2 + ((6 + 40 / 60) / 12) * TAU, 0.45, 6);
      hand(-Math.PI / 2 + (40 / 60) * TAU, 0.7, 3.5);
    },
    live(ctx, x, y, t) {
      const a = 0.18 + 0.1 * Math.sin(t * 0.0012);
      glow(ctx, x, y, 140, '#ffd98a', a);
    },
  },
  banners: {
    box: { w: 60, h: 150, ax: 30, ay: 140 },
    paint(g, R, v) {
      const cols = [['#a3302a', '#e0b458'], ['#2e6a78', '#f3dba0'], ['#5a2a4a', '#e8c878'], ['#6a6a30', '#fff3c2']][v % 4];
      g.fillStyle = '#3a281e';
      g.fillRect(-2, -130, 4, 130);
      dab(g, 0, -132, 3, 3, 0, '#e0b458');
      g.fillStyle = cols[0];
      g.beginPath();
      g.moveTo(2, -126);
      g.lineTo(26, -122);
      g.lineTo(20, -100);
      g.lineTo(26, -80);
      g.lineTo(2, -84);
      g.closePath();
      g.fill();
      g.fillStyle = cols[1];
      g.font = `700 10px ${FONTS.title}`;
      g.fillText(String(20 + ((v * 17) % 48)), 6, -100);
    },
  },
};
