// Procedural HUD icons for Expedition 69: statuses, elements, items, battle mechanics and defense cue shapes.
// Every icon is painted once on a supersampled canvas and cached; DOM users get a dataURL
// (an SVG wrapper with the right intrinsic size), canvas users get the bitmap via iconCanvas().
// No DOM access happens at import time, so this module is safe to import anywhere.

import { PALETTE, ELEMENT_COLORS, STATUS_COLORS, HIT_TYPE_COLORS } from './palette.js';

/** All status ids that have a dedicated icon (closed list from the spec, §3.2). */
export const STATUS_ICON_IDS = ['burn', 'chill', 'mark', 'powerful', 'shell', 'haste', 'slow', 'weakened', 'defenseless', 'stun', 'regen', 'silence'];
/** Statuses that are beneficial for the bearer (drawn on a round badge; harmful ones use a square badge). */
export const POSITIVE_STATUSES = new Set(['powerful', 'shell', 'haste', 'regen']);
/** Element ids that have an icon. */
export const ELEMENT_ICON_IDS = ['physical', 'fire', 'ice', 'lightning', 'earth', 'light', 'dark'];
/** Item / upgrade ids that have an icon. `shard` is a generic upgrade shard. */
export const ITEM_ICON_IDS = ['tincture', 'tonic', 'draught', 'tincture_shard', 'tonic_shard', 'draught_shard', 'shard'];
/** Mechanic / HUD keys that have an icon. */
export const MECHANIC_ICON_KEYS = ['surge', 'glyph_fire', 'glyph_ice', 'glyph_storm', 'glyph_earth', 'glyph_light', 'stance_neutral', 'stance_assault', 'stance_guard', 'stance_virtuoso', 'ap', 'gradient', 'glint', 'relic', 'echo'];
/** Enemy hit types with a cue-shape miniature (same shapes as drawDefenseCue; `feint` draws as normal). */
export const CUE_ICON_IDS = ['normal', 'unparryable', 'jump', 'gradient'];

const TAU = Math.PI * 2;
/** Supersampling factor: icons stay crisp on scaled / high-DPI stages. */
const RES = 3;
const INK = '#120c09';
const OUTLINE = 'rgba(10, 6, 4, 0.9)';

const canvasCache = new Map();
const urlCache = new Map();
const warned = new Set();

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Status icon as a cached dataURL (usable as `<img src>` or CSS background).
 * @param {string} id status id (see STATUS_ICON_IDS)
 * @param {number} [size=20] CSS pixel size (the image's intrinsic size)
 * @returns {string} dataURL ('' outside a browser)
 */
export function statusIcon(id, size = 20) { return iconUrl('status', id, size); }

/**
 * Element icon as a cached dataURL.
 * @param {string} el element id (physical|fire|ice|lightning|earth|light|dark)
 * @param {number} [size=20]
 * @returns {string}
 */
export function elementIcon(el, size = 20) { return iconUrl('element', el, size); }

/**
 * Item icon as a cached dataURL (tincture, tonic, draught, *_shard, shard).
 * @param {string} id
 * @param {number} [size=20]
 * @returns {string}
 */
export function itemIcon(id, size = 20) { return iconUrl('item', id, size); }

/**
 * Mechanic / HUD icon as a cached dataURL (see MECHANIC_ICON_KEYS).
 * @param {string} key
 * @param {number} [size=20]
 * @returns {string}
 */
export function mechanicIcon(key, size = 20) { return iconUrl('mechanic', key, size); }

/**
 * Defense cue shape as a cached dataURL: clean white ring (normal), spiked red ring (unparryable),
 * gold chevron ring over a ground wave (jump), violet prism (gradient). Unknown types draw as normal.
 * @param {string} type enemy hit type (see CUE_ICON_IDS)
 * @param {number} [size=20]
 * @returns {string}
 */
export function cueIcon(type, size = 20) { return iconUrl('cue', CUE_ICON_IDS.includes(type) ? type : 'normal', size); }

/**
 * The cached supersampled bitmap behind an icon, for drawing on a canvas:
 * `ctx.drawImage(iconCanvas('status', 'burn', 16), x, y, 16, 16)`.
 * @param {'status'|'element'|'item'|'mechanic'|'cue'} kind
 * @param {string} id
 * @param {number} [size=20] logical size the icon will be drawn at
 * @returns {HTMLCanvasElement|null} null outside a browser
 */
export function iconCanvas(kind, id, size = 20) {
  if (typeof document === 'undefined') return null;
  const s = Math.max(8, Math.round(size));
  const key = `${kind}:${id}:${s}`;
  let c = canvasCache.get(key);
  if (!c) {
    c = paintIcon(kind, id, s);
    canvasCache.set(key, c);
  }
  return c;
}

/** Drops every cached icon (e.g. after a settings change that should repaint). */
export function clearIconCache() { canvasCache.clear(); urlCache.clear(); }

// ---------------------------------------------------------------------------------------------
// Caching / encoding
// ---------------------------------------------------------------------------------------------

function iconUrl(kind, id, size) {
  if (typeof document === 'undefined') return '';
  const s = Math.max(8, Math.round(size));
  const key = `${kind}:${id}:${s}`;
  let url = urlCache.get(key);
  if (url) return url;
  const c = iconCanvas(kind, id, s);
  try {
    const png = c.toDataURL('image/png');
    // Wrap the supersampled PNG in an SVG so the image's intrinsic size is `size` CSS px,
    // while still carrying RES× pixels for crisp rendering on scaled / retina stages.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><image width="${s}" height="${s}" href="${png}" xlink:href="${png}"/></svg>`;
    url = 'data:image/svg+xml;base64,' + btoa(svg);
  } catch (err) {
    warnOnce(`encode:${key}`, `[icons] could not encode icon ${key}: ${err && err.message}`);
    url = '';
  }
  urlCache.set(key, url);
  return url;
}

function paintIcon(kind, id, size) {
  const px = size * RES;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d');
  g.scale(px / 100, px / 100); // all painters work in a 100 × 100 box
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const table = PAINTERS[kind];
  const painter = table && table[id];
  if (!painter) {
    warnOnce(`${kind}:${id}`, `[icons] unknown ${kind} icon "${id}" — drawing fallback`);
    paintFallback(g);
    return c;
  }
  try {
    painter(g);
  } catch (err) {
    warnOnce(`paint:${kind}:${id}`, `[icons] failed to paint ${kind} "${id}": ${err && err.message}`);
    g.clearRect(0, 0, 100, 100);
    paintFallback(g);
  }
  return c;
}

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

// ---------------------------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------------------------

function hexRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
/** k in [-1, 1]: negative darkens toward black, positive lightens toward white. */
function shade(hex, k) {
  const [r, g, b] = hexRgb(hex);
  const f = (ch) => Math.round(k < 0 ? ch * (1 + k) : ch + (255 - ch) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// ---------------------------------------------------------------------------------------------
// Drawing primitives (100-unit box)
// ---------------------------------------------------------------------------------------------

function shapePath(g, shape, inset = 0) {
  g.beginPath();
  if (shape === 'circle') {
    g.arc(50, 50, 46 - inset, 0, TAU);
  } else if (shape === 'hex') {
    const r = 47 - inset;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 6;
      const x = 50 + Math.cos(a) * r;
      const y = 50 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  } else {
    const o = 5 + inset;
    roundRectPath(g, o, o, 100 - o * 2, 100 - o * 2, Math.max(4, 20 - inset * 0.6));
  }
}

function roundRectPath(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Dark painted badge with a coloured rim. */
function badge(g, shape, color, { rim = color, glow = 0.55 } = {}) {
  // dark separation ring (reads on any background)
  shapePath(g, shape, 0);
  g.fillStyle = OUTLINE;
  g.fill();
  // body
  shapePath(g, shape, 3);
  const body = g.createLinearGradient(0, 8, 0, 94);
  body.addColorStop(0, shade(color, -0.52));
  body.addColorStop(0.55, shade(color, -0.78));
  body.addColorStop(1, INK);
  g.fillStyle = body;
  g.fill();
  // inner glow from the top-right (the frozen sun is always up and to the right)
  g.save();
  shapePath(g, shape, 3);
  g.clip();
  const hl = g.createRadialGradient(64, 26, 2, 64, 26, 58);
  hl.addColorStop(0, rgba(color, glow * 0.55));
  hl.addColorStop(1, rgba(color, 0));
  g.fillStyle = hl;
  g.fillRect(0, 0, 100, 100);
  g.restore();
  // rim
  shapePath(g, shape, 5);
  g.lineWidth = 5;
  g.strokeStyle = rim;
  g.stroke();
  shapePath(g, shape, 8.5);
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255, 246, 225, 0.22)';
  g.stroke();
}

function glyphGradient(g, color, y0 = 18, y1 = 84) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, shade(color, 0.62));
  gr.addColorStop(0.5, shade(color, 0.18));
  gr.addColorStop(1, color);
  return gr;
}

/** Fill the current path with a dark outline underneath. */
function inked(g, fill, outline = 8) {
  g.lineWidth = outline;
  g.strokeStyle = OUTLINE;
  g.stroke();
  g.fillStyle = fill;
  g.fill();
}

/** Stroke the current path twice: dark outline, then the colour. */
function strokedLine(g, color, width = 7, outline = 6) {
  g.lineWidth = width + outline;
  g.strokeStyle = OUTLINE;
  g.stroke();
  g.lineWidth = width;
  g.strokeStyle = color;
  g.stroke();
}

function poly(g, pts, close = true) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  if (close) g.closePath();
}

function sparkle(g, x, y, r, color = '#fffaf0') {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.closePath();
  g.lineWidth = 3;
  g.strokeStyle = OUTLINE;
  g.stroke();
  g.fillStyle = color;
  g.fill();
}

/** Arc from a0 to a1 that passes through angle `via` (chooses the direction). */
function arcVia(g, x, y, r, a0, a1, via) {
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  const sweepCw = norm(a1 - a0);
  const cw = norm(via - a0) <= sweepCw;
  g.arc(x, y, r, a0, a1, !cw);
}

/** Path of circle (cx, cy, r) minus circle (cx+ox, cy+oy, r2). */
function crescentPath(g, cx, cy, r, ox, oy, r2) {
  const d = Math.hypot(ox, oy);
  const a = (r * r - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r * r - a * a));
  const mx = cx + (a * ox) / d;
  const my = cy + (a * oy) / d;
  const p1x = mx + (h * oy) / d, p1y = my - (h * ox) / d;
  const p2x = mx - (h * oy) / d, p2y = my + (h * ox) / d;
  const away = Math.atan2(-oy, -ox);
  const ix = cx + ox, iy = cy + oy;
  g.beginPath();
  arcVia(g, cx, cy, r, Math.atan2(p1y - cy, p1x - cx), Math.atan2(p2y - cy, p2x - cx), away);
  arcVia(g, ix, iy, r2, Math.atan2(p2y - iy, p2x - ix), Math.atan2(p1y - iy, p1x - ix), away);
  g.closePath();
}

function flamePath(g, s = 1, ox = 0, oy = 0) {
  const X = (v) => 50 + (v - 50) * s + ox;
  const Y = (v) => 50 + (v - 50) * s + oy;
  g.beginPath();
  g.moveTo(X(51), Y(13));
  g.bezierCurveTo(X(58), Y(30), X(76), Y(38), X(73), Y(60));
  g.bezierCurveTo(X(71), Y(76), X(61), Y(86), X(50), Y(86));
  g.bezierCurveTo(X(38), Y(86), X(27), Y(76), X(28), Y(61));
  g.bezierCurveTo(X(29), Y(49), X(35), Y(43), X(39), Y(35));
  g.bezierCurveTo(X(41), Y(44), X(43), Y(49), X(47), Y(51));
  g.bezierCurveTo(X(43), Y(39), X(45), Y(25), X(51), Y(13));
  g.closePath();
}

function flame(g, outer, inner) {
  flamePath(g);
  inked(g, glyphGradient(g, outer, 14, 86), 8);
  g.beginPath();
  g.moveTo(50, 47);
  g.bezierCurveTo(56, 56, 63, 62, 61, 71);
  g.bezierCurveTo(60, 78, 55, 81, 50, 81);
  g.bezierCurveTo(44, 81, 40, 77, 40, 71);
  g.bezierCurveTo(40, 63, 46, 58, 50, 47);
  g.closePath();
  g.fillStyle = inner;
  g.fill();
}

function shieldPath(g, s = 1, ox = 0, oy = 0) {
  const X = (v) => 50 + (v - 50) * s + ox;
  const Y = (v) => 50 + (v - 50) * s + oy;
  g.beginPath();
  g.moveTo(X(50), Y(15));
  g.lineTo(X(77), Y(25));
  g.lineTo(X(76), Y(50));
  g.bezierCurveTo(X(75), Y(67), X(64), Y(78), X(50), Y(87));
  g.bezierCurveTo(X(36), Y(78), X(25), Y(67), X(24), Y(50));
  g.lineTo(X(23), Y(25));
  g.closePath();
}

/** Upright sword centred horizontally at cx; tip at `top`, pommel near `bottom`. */
function swordPath(g, cx = 50, top = 14, bottom = 84, bw = 7) {
  const guardY = top + (bottom - top) * 0.66;
  g.beginPath();
  g.moveTo(cx, top);
  g.lineTo(cx + bw, top + 10);
  g.lineTo(cx + bw, guardY);
  g.lineTo(cx + bw + 11, guardY);
  g.lineTo(cx + bw + 11, guardY + 6);
  g.lineTo(cx + 3.5, guardY + 6);
  g.lineTo(cx + 3.5, bottom - 5);
  g.lineTo(cx + 6, bottom);
  g.lineTo(cx - 6, bottom);
  g.lineTo(cx - 3.5, bottom - 5);
  g.lineTo(cx - 3.5, guardY + 6);
  g.lineTo(cx - bw - 11, guardY + 6);
  g.lineTo(cx - bw - 11, guardY);
  g.lineTo(cx - bw, guardY);
  g.lineTo(cx - bw, top + 10);
  g.closePath();
}

/** Rapier (thin blade, swept cup hilt) drawn along +y from (0,0) in local space, length L. */
function rapier(g, L, color) {
  // blade
  g.beginPath();
  g.moveTo(0, -L * 0.5);
  g.lineTo(2.2, -L * 0.5 + 6);
  g.lineTo(2.2, L * 0.2);
  g.lineTo(-2.2, L * 0.2);
  g.lineTo(-2.2, -L * 0.5 + 6);
  g.closePath();
  inked(g, glyphGradient(g, color, -L * 0.5, L * 0.2), 6);
  // swept hilt: cup + quillon
  g.beginPath();
  g.arc(0, L * 0.24, 8, Math.PI * 1.05, Math.PI * 1.95, true);
  strokedLine(g, PALETTE.gold, 4.5, 4);
  g.beginPath();
  g.moveTo(-13, L * 0.22);
  g.lineTo(13, L * 0.22);
  strokedLine(g, PALETTE.gold, 4.5, 4);
  // grip + pommel
  g.beginPath();
  g.moveTo(0, L * 0.25);
  g.lineTo(0, L * 0.42);
  strokedLine(g, '#5a3a24', 5, 4);
  g.beginPath();
  g.arc(0, L * 0.46, 4.5, 0, TAU);
  inked(g, PALETTE.gold, 4);
}

function starPath(g, cx, cy, points, rOuter, rInner, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

function paintFallback(g) {
  badge(g, 'circle', '#8a8fb0');
  g.font = '700 54px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = OUTLINE;
  g.strokeText('?', 50, 54);
  g.fillStyle = '#f5eedf';
  g.fillText('?', 50, 54);
}

// ---------------------------------------------------------------------------------------------
// Status icons
// ---------------------------------------------------------------------------------------------

function statusBadge(g, id) {
  const col = STATUS_COLORS[id] || '#cccccc';
  const positive = POSITIVE_STATUSES.has(id);
  badge(g, positive ? 'circle' : 'square', col, { rim: positive ? PALETTE.gold : shade(col, -0.2) });
  return col;
}

const STATUS_PAINTERS = {
  burn(g) {
    const c = statusBadge(g, 'burn');
    flame(g, c, '#ffe39a');
  },
  chill(g) {
    const c = statusBadge(g, 'chill');
    const col = shade(c, 0.45);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 2;
      const dx = Math.cos(a) * 31, dy = Math.sin(a) * 31;
      g.beginPath();
      g.moveTo(50 - dx, 50 - dy);
      g.lineTo(50 + dx, 50 + dy);
      strokedLine(g, col, 6, 6);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 2;
      const bx = 50 + Math.cos(a) * 20, by = 50 + Math.sin(a) * 20;
      for (const s of [-1, 1]) {
        const b = a + s * 0.75;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(b) * 10, by + Math.sin(b) * 10);
        strokedLine(g, col, 4.5, 5);
      }
    }
    g.beginPath();
    g.arc(50, 50, 5, 0, TAU);
    inked(g, '#ffffff', 4);
  },
  mark(g) {
    const c = statusBadge(g, 'mark');
    const col = shade(c, 0.3);
    g.beginPath();
    g.arc(50, 50, 21, 0, TAU);
    strokedLine(g, col, 6, 6);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.beginPath();
      g.moveTo(50 + Math.cos(a) * 12, 50 + Math.sin(a) * 12);
      g.lineTo(50 + Math.cos(a) * 34, 50 + Math.sin(a) * 34);
      strokedLine(g, col, 5.5, 6);
    }
    g.beginPath();
    g.arc(50, 50, 5.5, 0, TAU);
    inked(g, '#ffffff', 4);
  },
  powerful(g) {
    const c = statusBadge(g, 'powerful');
    swordPath(g, 46, 15, 84, 6.5);
    inked(g, glyphGradient(g, c), 7);
    poly(g, [72, 20, 83, 36, 61, 36]);
    inked(g, '#fff3c2', 6);
  },
  shell(g) {
    const c = statusBadge(g, 'shell');
    shieldPath(g, 0.95);
    inked(g, glyphGradient(g, c), 8);
    shieldPath(g, 0.62, 0, -1);
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.stroke();
  },
  haste(g) {
    const c = statusBadge(g, 'haste');
    const col = shade(c, 0.3);
    for (const ox of [-12, 10]) {
      g.beginPath();
      g.moveTo(34 + ox, 26);
      g.lineTo(56 + ox, 50);
      g.lineTo(34 + ox, 74);
      strokedLine(g, col, 10, 6);
    }
  },
  slow(g) {
    const c = statusBadge(g, 'slow');
    const col = shade(c, 0.55);
    poly(g, [31, 21, 69, 21, 52, 50, 69, 79, 31, 79, 48, 50]);
    inked(g, 'rgba(255,255,255,0.14)', 7);
    g.lineWidth = 4;
    g.strokeStyle = col;
    g.stroke();
    // sand
    poly(g, [38, 79, 62, 79, 50, 64]);
    g.fillStyle = PALETTE.paleGold;
    g.fill();
    poly(g, [40, 30, 60, 30, 50, 44]);
    g.fillStyle = PALETTE.paleGold;
    g.fill();
    for (const y of [18, 82]) {
      g.beginPath();
      g.moveTo(26, y);
      g.lineTo(74, y);
      strokedLine(g, col, 6, 5);
    }
  },
  weakened(g) {
    const c = statusBadge(g, 'weakened');
    const fill = glyphGradient(g, c);
    // broken blade (lower half) + hilt
    g.beginPath();
    g.moveTo(40, 45);
    g.lineTo(48, 41);
    g.lineTo(52, 46);
    g.lineTo(56, 42);
    g.lineTo(56, 61);
    g.lineTo(67, 61);
    g.lineTo(67, 67);
    g.lineTo(53.5, 67);
    g.lineTo(53.5, 79);
    g.lineTo(56, 84);
    g.lineTo(44, 84);
    g.lineTo(46.5, 79);
    g.lineTo(46.5, 67);
    g.lineTo(33, 67);
    g.lineTo(33, 61);
    g.lineTo(44, 61);
    g.lineTo(44, 47);
    g.closePath();
    inked(g, fill, 7);
    // snapped tip, tumbling
    g.save();
    g.translate(38, 27);
    g.rotate(-0.5);
    poly(g, [0, -13, 6, -4, 5, 9, -5, 9, -6, -4]);
    inked(g, fill, 6);
    g.restore();
    poly(g, [64, 22, 82, 22, 73, 36]);
    inked(g, '#ffd0e0', 6);
  },
  defenseless(g) {
    const c = statusBadge(g, 'defenseless');
    const fill = glyphGradient(g, c);
    g.save();
    g.translate(-3, 1);
    g.beginPath();
    g.moveTo(50, 15); g.lineTo(23, 25); g.lineTo(24, 50);
    g.bezierCurveTo(25, 67, 36, 78, 50, 87);
    g.lineTo(46, 66); g.lineTo(53, 52); g.lineTo(44, 37); g.closePath();
    inked(g, fill, 7);
    g.restore();
    g.save();
    g.translate(4, -1);
    g.beginPath();
    g.moveTo(52, 15); g.lineTo(77, 25); g.lineTo(76, 50);
    g.bezierCurveTo(75, 67, 64, 78, 52, 87);
    g.lineTo(55, 66); g.lineTo(60, 52); g.lineTo(51, 38); g.closePath();
    inked(g, fill, 7);
    g.restore();
  },
  stun(g) {
    const c = statusBadge(g, 'stun');
    const col = shade(c, 0.35);
    g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const th = (i / 64) * Math.PI * 3.4;
      const r = 3 + th * 5.2;
      const x = 48 + Math.cos(th) * r;
      const y = 54 + Math.sin(th) * r * 0.82;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    strokedLine(g, col, 6, 6);
    starPath(g, 74, 26, 5, 11, 4.5);
    inked(g, '#fff7c8', 5);
  },
  regen(g) {
    const c = statusBadge(g, 'regen');
    g.beginPath();
    g.moveTo(26, 76);
    g.bezierCurveTo(22, 46, 42, 22, 76, 20);
    g.bezierCurveTo(78, 52, 58, 76, 26, 76);
    g.closePath();
    inked(g, glyphGradient(g, c), 8);
    g.beginPath();
    g.moveTo(28, 74);
    g.quadraticCurveTo(48, 50, 66, 30);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(20,60,35,0.8)';
    g.stroke();
    // plus
    g.beginPath();
    g.moveTo(70, 56); g.lineTo(70, 82);
    g.moveTo(57, 69); g.lineTo(83, 69);
    strokedLine(g, '#ffffff', 7, 6);
  },
  silence(g) {
    const c = statusBadge(g, 'silence');
    g.beginPath();
    roundRectPath(g, 22, 22, 56, 40, 13);
    inked(g, glyphGradient(g, c, 22, 62), 8);
    poly(g, [34, 58, 28, 78, 50, 60]);
    inked(g, glyphGradient(g, c, 22, 62), 7);
    // three dots of speech, then the strike-through
    g.fillStyle = shade(c, -0.6);
    for (const x of [37, 50, 63]) { g.beginPath(); g.arc(x, 42, 4, 0, TAU); g.fill(); }
    g.beginPath();
    g.moveTo(20, 82);
    g.lineTo(80, 18);
    strokedLine(g, '#ff6a5a', 7, 7);
  },
};

// ---------------------------------------------------------------------------------------------
// Element icons (round badges)
// ---------------------------------------------------------------------------------------------

function elementBadge(g, el) {
  const col = ELEMENT_COLORS[el] || '#cccccc';
  badge(g, 'circle', col, { glow: 0.8 });
  return col;
}

const ELEMENT_PAINTERS = {
  physical(g) {
    const c = elementBadge(g, 'physical');
    for (const a of [-0.72, 0.72]) {
      g.save();
      g.translate(50, 52);
      g.rotate(a);
      g.translate(-50, -50);
      swordPath(g, 50, 16, 82, 5);
      inked(g, glyphGradient(g, c), 6);
      g.restore();
    }
  },
  fire(g) {
    const c = elementBadge(g, 'fire');
    flame(g, c, '#ffe7a0');
  },
  ice(g) {
    const c = elementBadge(g, 'ice');
    const fill = glyphGradient(g, shade(c, 0.1));
    const crystal = (cx, cy, h, w, rot) => {
      g.save();
      g.translate(cx, cy);
      g.rotate(rot);
      poly(g, [0, -h, w, -h * 0.25, w * 0.7, h * 0.7, 0, h, -w * 0.7, h * 0.7, -w, -h * 0.25]);
      inked(g, fill, 6);
      g.beginPath();
      g.moveTo(0, -h + 4);
      g.lineTo(0, h - 4);
      g.lineWidth = 2.5;
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.stroke();
      g.restore();
    };
    crystal(33, 58, 17, 8, -0.55);
    crystal(67, 58, 17, 8, 0.55);
    crystal(50, 48, 30, 11, 0);
  },
  lightning(g) {
    const c = elementBadge(g, 'lightning');
    poly(g, [60, 12, 29, 54, 47, 54, 38, 88, 72, 42, 54, 42, 65, 12]);
    inked(g, glyphGradient(g, c), 8);
  },
  earth(g) {
    const c = elementBadge(g, 'earth');
    poly(g, [16, 76, 36, 42, 46, 53, 61, 25, 84, 76]);
    inked(g, glyphGradient(g, c, 25, 76), 8);
    g.beginPath();
    g.moveTo(61, 25); g.lineTo(56, 44); g.lineTo(62, 56); g.lineTo(57, 76);
    g.moveTo(36, 42); g.lineTo(33, 60);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(40,24,10,0.85)';
    g.stroke();
    g.beginPath();
    g.moveTo(61, 25); g.lineTo(70, 43); g.lineTo(66, 47); g.lineTo(61, 38);
    g.closePath();
    g.fillStyle = 'rgba(255,245,215,0.6)';
    g.fill();
  },
  light(g) {
    const c = elementBadge(g, 'light');
    starPath(g, 50, 50, 4, 38, 9, -Math.PI / 2);
    inked(g, glyphGradient(g, c), 7);
    starPath(g, 50, 50, 4, 24, 7, -Math.PI / 4);
    inked(g, '#ffffff', 5);
    g.beginPath();
    g.arc(50, 50, 7, 0, TAU);
    g.fillStyle = '#ffffff';
    g.fill();
  },
  dark(g) {
    const c = elementBadge(g, 'dark');
    crescentPath(g, 47, 53, 30, 13, -10, 25);
    inked(g, glyphGradient(g, c, 22, 84), 8);
    sparkle(g, 67, 33, 9, '#e8d8ff');
  },
};

// ---------------------------------------------------------------------------------------------
// Item icons (glassware on a hexagonal badge)
// ---------------------------------------------------------------------------------------------

const ITEM_TINTS = {
  tincture: { liquid: '#d9435a', light: '#ff9a9a', rim: '#d9837b' },
  tonic: { liquid: '#3fa6a0', light: '#a8f0e0', rim: '#7fe0c8' },
  draught: { liquid: '#e0a53a', light: '#fff0a8', rim: PALETTE.gold },
  shard: { liquid: PALETTE.gold, light: '#fff3c2', rim: PALETTE.gold },
};

function glassBody(g, liquid, light, clipPath, level) {
  // glass body
  clipPath();
  inked(g, 'rgba(245, 238, 223, 0.16)', 8);
  // liquid
  g.save();
  clipPath();
  g.clip();
  const lg = g.createLinearGradient(0, level, 0, 92);
  lg.addColorStop(0, light);
  lg.addColorStop(0.35, liquid);
  lg.addColorStop(1, shade(liquid, -0.45));
  g.fillStyle = lg;
  g.fillRect(0, level, 100, 100 - level);
  g.beginPath();
  g.ellipse(50, level, 30, 3.2, 0, 0, TAU);
  g.fillStyle = rgba('#ffffff', 0.45);
  g.fill();
  g.restore();
  // outline + highlight
  clipPath();
  g.lineWidth = 3.2;
  g.strokeStyle = 'rgba(250, 244, 230, 0.9)';
  g.stroke();
}

function cork(g, x, y, w, h) {
  g.beginPath();
  roundRectPath(g, x, y, w, h, 3);
  inked(g, '#9a6a3c', 5);
  g.beginPath();
  g.moveTo(x + 3, y + h * 0.45);
  g.lineTo(x + w - 3, y + h * 0.45);
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(40,20,8,0.6)';
  g.stroke();
}

function shardGlyph(g, tint) {
  poly(g, [50, 11, 67, 38, 60, 88, 39, 84, 33, 37]);
  const fill = g.createLinearGradient(30, 10, 70, 88);
  fill.addColorStop(0, tint.light);
  fill.addColorStop(0.5, tint.liquid);
  fill.addColorStop(1, shade(tint.liquid, -0.5));
  inked(g, fill, 8);
  // facets
  g.beginPath();
  g.moveTo(50, 11); g.lineTo(52, 50); g.lineTo(60, 88);
  g.moveTo(33, 37); g.lineTo(52, 50); g.lineTo(67, 38);
  g.moveTo(52, 50); g.lineTo(39, 84);
  g.lineWidth = 2.2;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.stroke();
  poly(g, [50, 11, 52, 50, 33, 37]);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fill();
  sparkle(g, 72, 22, 9);
}

const ITEM_PAINTERS = {
  tincture(g) {
    const t = ITEM_TINTS.tincture;
    badge(g, 'hex', t.rim);
    const body = () => {
      g.beginPath();
      g.moveTo(44, 30);
      g.lineTo(44, 40);
      g.arc(50, 62, 25, -Math.PI / 2 - 0.25, -Math.PI / 2 + 0.25 + TAU, false);
      g.lineTo(56, 30);
      g.closePath();
    };
    glassBody(g, t.liquid, t.light, body, 55);
    cork(g, 41, 20, 18, 12);
    g.beginPath();
    g.arc(50, 62, 18, Math.PI * 1.1, Math.PI * 1.45);
    g.lineWidth = 3.5;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.stroke();
  },
  tonic(g) {
    const t = ITEM_TINTS.tonic;
    badge(g, 'hex', t.rim);
    const body = () => {
      g.beginPath();
      roundRectPath(g, 37, 34, 26, 52, 10);
    };
    glassBody(g, t.liquid, t.light, body, 50);
    cork(g, 40, 25, 20, 11);
    // feather rising from the cork
    g.beginPath();
    g.moveTo(52, 26);
    g.bezierCurveTo(56, 14, 68, 8, 80, 10);
    g.bezierCurveTo(76, 20, 66, 26, 52, 26);
    g.closePath();
    inked(g, glyphGradient(g, '#f5eedf', 8, 26), 5);
    g.beginPath();
    g.moveTo(52, 26);
    g.quadraticCurveTo(64, 16, 78, 11);
    g.lineWidth = 1.6;
    g.strokeStyle = 'rgba(120,90,40,0.8)';
    g.stroke();
    g.beginPath();
    g.moveTo(43, 44);
    g.lineTo(43, 74);
    g.lineWidth = 3.5;
    g.strokeStyle = 'rgba(255,255,255,0.65)';
    g.stroke();
  },
  draught(g) {
    const t = ITEM_TINTS.draught;
    badge(g, 'hex', t.rim);
    const body = () => {
      g.beginPath();
      g.moveTo(45, 24);
      g.lineTo(45, 36);
      g.quadraticCurveTo(31, 42, 31, 54);
      g.lineTo(31, 80);
      g.quadraticCurveTo(31, 87, 38, 87);
      g.lineTo(62, 87);
      g.quadraticCurveTo(69, 87, 69, 80);
      g.lineTo(69, 54);
      g.quadraticCurveTo(69, 42, 55, 36);
      g.lineTo(55, 24);
      g.closePath();
    };
    glassBody(g, t.liquid, t.light, body, 50);
    cork(g, 42, 15, 16, 11);
    // AP diamond emblem
    poly(g, [50, 57, 58, 68, 50, 79, 42, 68]);
    inked(g, '#fff6d0', 4);
    g.beginPath();
    g.moveTo(36, 50);
    g.lineTo(36, 78);
    g.lineWidth = 3.5;
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.stroke();
  },
  tincture_shard(g) { badge(g, 'hex', ITEM_TINTS.tincture.rim); shardGlyph(g, ITEM_TINTS.tincture); },
  tonic_shard(g) { badge(g, 'hex', ITEM_TINTS.tonic.rim); shardGlyph(g, ITEM_TINTS.tonic); },
  draught_shard(g) { badge(g, 'hex', ITEM_TINTS.draught.rim); shardGlyph(g, ITEM_TINTS.draught); },
  shard(g) { badge(g, 'hex', ITEM_TINTS.shard.rim); shardGlyph(g, ITEM_TINTS.shard); },
};

// ---------------------------------------------------------------------------------------------
// Mechanic icons
// ---------------------------------------------------------------------------------------------

function cogPath(g, cx, cy, rOuter, rInner, teeth) {
  g.beginPath();
  const step = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [a - step * 0.5, rInner], [a - step * 0.22, rInner], [a - step * 0.14, rOuter],
      [a + step * 0.14, rOuter], [a + step * 0.22, rInner],
    ];
    for (let j = 0; j < pts.length; j++) {
      const [ang, r] = pts[j];
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i === 0 && j === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  }
  g.closePath();
}

const GLYPH_RUNES = {
  fire: { el: 'fire', draw(g) { poly(g, [50, 24, 73, 70, 27, 70]); g.moveTo(35, 54); g.lineTo(65, 54); } },
  ice: { el: 'ice', draw(g) { poly(g, [50, 22, 72, 50, 50, 78, 28, 50]); g.moveTo(50, 22); g.lineTo(50, 78); } },
  storm: { el: 'lightning', draw(g) { g.beginPath(); g.arc(50, 50, 24, 0, TAU); g.moveTo(40, 30); g.lineTo(56, 46); g.lineTo(44, 54); g.lineTo(60, 70); } },
  earth: { el: 'earth', draw(g) { g.beginPath(); g.rect(29, 29, 42, 42); g.moveTo(29, 50); g.lineTo(71, 50); g.moveTo(50, 50); g.lineTo(50, 71); } },
  light: {
    el: 'light',
    draw(g) {
      g.beginPath();
      g.arc(50, 50, 12, 0, TAU);
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        g.moveTo(50 + Math.cos(a) * 19, 50 + Math.sin(a) * 19);
        g.lineTo(50 + Math.cos(a) * (i % 2 ? 26 : 31), 50 + Math.sin(a) * (i % 2 ? 26 : 31));
      }
    },
  },
};

function glyphIcon(g, key) {
  const rune = GLYPH_RUNES[key];
  const col = ELEMENT_COLORS[rune.el];
  badge(g, 'hex', col, { glow: 0.9 });
  // soft inner glow behind the rune
  const gl = g.createRadialGradient(50, 50, 2, 50, 50, 34);
  gl.addColorStop(0, rgba(col, 0.55));
  gl.addColorStop(1, rgba(col, 0));
  g.fillStyle = gl;
  g.fillRect(10, 10, 80, 80);
  rune.draw(g);
  strokedLine(g, shade(col, 0.5), 6, 6);
}

function stanceIcon(g, stance) {
  const colors = {
    neutral: '#b9b2a6',
    assault: '#d8483a',
    guard: '#7fb4e0',
    virtuoso: PALETTE.gold,
  };
  const col = colors[stance];
  badge(g, 'circle', col, { rim: stance === 'virtuoso' ? PALETTE.crimson : col, glow: 0.8 });
  if (stance === 'neutral') {
    g.save(); g.translate(50, 52); rapier(g, 68, '#f5eedf'); g.restore();
  } else if (stance === 'assault') {
    for (const ox of [0, 12]) {
      g.beginPath();
      g.moveTo(24 + ox, 60); g.lineTo(34 + ox, 70); g.lineTo(24 + ox, 80);
      strokedLine(g, '#ff9a6a', 5, 5);
    }
    g.save(); g.translate(54, 48); g.rotate(Math.PI / 4); rapier(g, 72, '#fff0e0'); g.restore();
  } else if (stance === 'guard') {
    // the rapier crossing behind a steel heater shield
    g.save(); g.translate(50, 50); g.rotate(-Math.PI / 4); rapier(g, 78, '#f5eedf'); g.restore();
    shieldPath(g, 0.62, -1, 4);
    inked(g, glyphGradient(g, col, 26, 80), 7);
    shieldPath(g, 0.4, -1, 3);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.stroke();
    g.beginPath();
    g.moveTo(49, 34); g.lineTo(49, 70);
    g.lineWidth = 2.5;
    g.strokeStyle = rgba('#1c3048', 0.7);
    g.stroke();
  } else {
    // virtuoso: the rapier crowned by a star, framed by a laurel
    g.beginPath();
    g.arc(50, 56, 30, Math.PI * 0.62, Math.PI * 1.05);
    g.moveTo(50 + Math.cos(Math.PI * 0.38) * 30, 56 + Math.sin(Math.PI * 0.38) * 30);
    g.arc(50, 56, 30, Math.PI * 0.38, -Math.PI * 0.05, true);
    strokedLine(g, '#e9c46a', 4, 4);
    g.save(); g.translate(50, 58); rapier(g, 58, '#fff6e0'); g.restore();
    starPath(g, 50, 21, 5, 11, 4.6);
    inked(g, '#fff3c2', 5);
  }
}

const MECHANIC_PAINTERS = {
  surge(g) {
    badge(g, 'circle', '#6fa8e8', { rim: PALETTE.brass, glow: 0.9 });
    cogPath(g, 50, 50, 36, 30, 12);
    g.arc(50, 50, 19, 0, TAU, true);
    inked(g, glyphGradient(g, PALETTE.brass, 14, 86), 6);
    poly(g, [56, 22, 36, 54, 49, 54, 43, 79, 66, 45, 53, 45, 61, 22]);
    inked(g, glyphGradient(g, '#bfe0ff', 22, 79), 6);
  },
  glyph_fire(g) { glyphIcon(g, 'fire'); },
  glyph_ice(g) { glyphIcon(g, 'ice'); },
  glyph_storm(g) { glyphIcon(g, 'storm'); },
  glyph_earth(g) { glyphIcon(g, 'earth'); },
  glyph_light(g) { glyphIcon(g, 'light'); },
  stance_neutral(g) { stanceIcon(g, 'neutral'); },
  stance_assault(g) { stanceIcon(g, 'assault'); },
  stance_guard(g) { stanceIcon(g, 'guard'); },
  stance_virtuoso(g) { stanceIcon(g, 'virtuoso'); },
  ap(g) {
    // a faceted gold gem — no badge, so it reads as a "pip"
    const glow = g.createRadialGradient(50, 50, 4, 50, 50, 48);
    glow.addColorStop(0, rgba(PALETTE.ap, 0.55));
    glow.addColorStop(1, rgba(PALETTE.ap, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, 100, 100);
    poly(g, [50, 8, 82, 50, 50, 92, 18, 50]);
    const fill = g.createLinearGradient(20, 10, 80, 90);
    fill.addColorStop(0, '#fffbe6');
    fill.addColorStop(0.45, PALETTE.ap);
    fill.addColorStop(1, PALETTE.brass);
    inked(g, fill, 9);
    poly(g, [50, 8, 50, 50, 18, 50]);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fill();
    poly(g, [50, 92, 50, 50, 82, 50]);
    g.fillStyle = 'rgba(120,70,20,0.35)';
    g.fill();
    poly(g, [50, 26, 65, 50, 50, 74, 35, 50]);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.stroke();
  },
  gradient(g) {
    badge(g, 'circle', PALETTE.violet, { glow: 1 });
    // prismatic rays leaving the prism
    const rays = ['#ff6a8a', '#ffc45a', '#f4f06a', '#7fe0a8', '#6ad5ff', '#b58cff'];
    rays.forEach((c, i) => {
      g.beginPath();
      g.moveTo(58, 52);
      g.lineTo(86, 38 + i * 6);
      g.lineWidth = 4;
      g.strokeStyle = c;
      g.stroke();
    });
    poly(g, [44, 18, 72, 74, 16, 74]);
    const fill = g.createLinearGradient(16, 18, 72, 74);
    fill.addColorStop(0, '#f2e6ff');
    fill.addColorStop(0.5, '#c77dff');
    fill.addColorStop(1, '#5a2d96');
    inked(g, fill, 7);
    poly(g, [44, 18, 44, 74, 16, 74]);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fill();
    g.beginPath();
    g.moveTo(12, 56);
    g.lineTo(38, 52);
    g.lineWidth = 3.5;
    g.strokeStyle = '#ffffff';
    g.stroke();
  },
  glint(g) {
    g.beginPath();
    g.arc(50, 50, 40, 0, TAU);
    const fill = g.createLinearGradient(20, 12, 80, 90);
    fill.addColorStop(0, '#fff3c2');
    fill.addColorStop(0.5, PALETTE.gold);
    fill.addColorStop(1, '#8a5a1c');
    inked(g, fill, 9);
    g.beginPath();
    g.arc(50, 50, 31, 0, TAU);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(110, 66, 20, 0.75)';
    g.stroke();
    // engraved sun
    g.beginPath();
    g.arc(50, 50, 10, 0, TAU);
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      g.moveTo(50 + Math.cos(a) * 14, 50 + Math.sin(a) * 14);
      g.lineTo(50 + Math.cos(a) * (i % 2 ? 20 : 24), 50 + Math.sin(a) * (i % 2 ? 20 : 24));
    }
    g.lineWidth = 3.4;
    g.strokeStyle = 'rgba(110, 60, 18, 0.9)';
    g.stroke();
    g.beginPath();
    g.arc(50, 50, 38, Math.PI * 1.1, Math.PI * 1.5);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.65)';
    g.stroke();
  },
  relic(g) {
    badge(g, 'circle', PALETTE.crimson, { rim: PALETTE.gold, glow: 0.7 });
    g.beginPath();
    g.arc(50, 22, 7, 0, TAU);
    strokedLine(g, PALETTE.paleGold, 3.5, 4);
    g.beginPath();
    g.arc(50, 56, 25, 0, TAU);
    inked(g, glyphGradient(g, PALETTE.gold, 31, 81), 7);
    starPath(g, 50, 56, 8, 20, 15, 0);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(110,66,20,0.7)';
    g.stroke();
    g.beginPath();
    g.arc(50, 56, 10, 0, TAU);
    const gem = g.createRadialGradient(46, 52, 1, 50, 56, 11);
    gem.addColorStop(0, '#ffb0a8');
    gem.addColorStop(0.5, '#d9433a');
    gem.addColorStop(1, '#6a1410');
    inked(g, gem, 4);
  },
  echo(g) {
    const col = '#9ad0e8';
    badge(g, 'circle', '#6a5aa8', { rim: '#b8a0e8', glow: 0.9 });
    for (let i = 0; i < 3; i++) {
      const r = 26 + i * 8;
      g.beginPath();
      g.arc(50, 52, r, -0.6, 0.6);
      g.moveTo(50 + Math.cos(Math.PI - 0.6) * r, 52 + Math.sin(Math.PI - 0.6) * r);
      g.arc(50, 52, r, Math.PI - 0.6, Math.PI + 0.6);
      g.lineWidth = 3.5;
      g.strokeStyle = rgba(col, 0.85 - i * 0.22);
      g.stroke();
    }
    g.beginPath();
    g.arc(50, 52, 17, 0, TAU);
    inked(g, 'rgba(200, 230, 255, 0.28)', 6);
    g.lineWidth = 3;
    g.strokeStyle = '#e6f4ff';
    g.stroke();
    g.beginPath();
    g.arc(50, 30, 5, 0, TAU);
    g.lineWidth = 3;
    g.strokeStyle = '#e6f4ff';
    g.stroke();
    starPath(g, 50, 52, 4, 9, 3.5);
    g.fillStyle = '#ffffff';
    g.fill();
  },
};

// ---------------------------------------------------------------------------------------------
// Defense cue shapes (legend rows, touch buttons): miniatures of drawDefenseCue's colour-blind-safe
// shapes — clean ring (parry), spiked ring (dodge-only), chevron ring + ground wave (jump), prism (counter).
// ---------------------------------------------------------------------------------------------

/** Soft coloured halo behind a cue miniature (reads on dark panels without a badge). */
function cueHalo(g, color, cx = 50, cy = 50, r = 50) {
  const halo = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
  halo.addColorStop(0, rgba(color, 0.32));
  halo.addColorStop(1, rgba(color, 0));
  g.fillStyle = halo;
  g.fillRect(0, 0, 100, 100);
}

function cueRing(g, cx, cy, r, color, width) {
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  strokedLine(g, color, width, 5);
}

const CUE_PAINTERS = {
  normal(g) {
    const col = HIT_TYPE_COLORS.normal;
    cueHalo(g, '#fff4d8');
    cueRing(g, 50, 50, 38, col, 7);
    cueRing(g, 50, 50, 15, col, 5);
  },
  unparryable(g) {
    const col = HIT_TYPE_COLORS.unparryable;
    cueHalo(g, col);
    const spikes = 12;
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / spikes;
      const r = i % 2 === 0 ? 46 : 34;
      const x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    strokedLine(g, shade(col, 0.2), 6, 5);
    // "no parry" cross
    g.beginPath();
    g.moveTo(40, 40); g.lineTo(60, 60);
    g.moveTo(60, 40); g.lineTo(40, 60);
    strokedLine(g, '#ffe4de', 5, 4);
  },
  jump(g) {
    const col = HIT_TYPE_COLORS.jump;
    cueHalo(g, col, 50, 56);
    // ground wave
    g.beginPath();
    g.ellipse(50, 88, 40, 8, 0, 0, TAU);
    strokedLine(g, shade(col, -0.1), 4.5, 4);
    cueRing(g, 50, 54, 26, col, 6);
    // rising chevron
    poly(g, [36, 24, 50, 10, 64, 24], false);
    strokedLine(g, shade(col, 0.35), 6, 5);
  },
  gradient(g) {
    const col = HIT_TYPE_COLORS.gradient;
    cueHalo(g, col);
    const diamond = (r, dx) => poly(g, [50 + dx, 50 - r, 50 + dx + r, 50, 50 + dx, 50 + r, 50 + dx - r, 50]);
    // chromatic split (prism) under the main stroke
    diamond(40, -4);
    g.lineWidth = 4;
    g.strokeStyle = '#ff6ab4';
    g.stroke();
    diamond(40, 4);
    g.strokeStyle = '#6ad5ff';
    g.stroke();
    diamond(40, 0);
    strokedLine(g, shade(col, 0.3), 6, 4);
    diamond(15, 0);
    strokedLine(g, '#f2e6ff', 4.5, 4);
  },
};

const PAINTERS = {
  status: STATUS_PAINTERS,
  element: ELEMENT_PAINTERS,
  item: ITEM_PAINTERS,
  mechanic: MECHANIC_PAINTERS,
  cue: CUE_PAINTERS,
};
