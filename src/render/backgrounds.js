// Painterly battle backgrounds (shore, thicket, spire, summit + phase 2, training) and title key art.
// Static layers are painted once into offscreen canvases and composited with subtle camera parallax; a handful
// of elements animate every frame. When the output resolution changes (resize, rotation, DPR change) the cached
// layers keep drawing, stretched, and are repainted at the new scale in idle time once the size has settled —
// never synchronously inside a frame, and without evicting a prepared variant (e.g. the summit's phase 2).

import { ZONE_PALETTES, FONTS } from './palette.js';

/** Zone ids with a battle background. */
export const BATTLE_ZONES = ['shore', 'thicket', 'spire', 'summit', 'training'];
/** The floor band where actors stand (kept low-contrast and uncluttered in every zone). */
export const FLOOR_BAND = { top: 360, bottom: 640 };

const W = 1280;
const H = 720;
const PAD_X = 64;
const PAD_Y = 40;
const TAU = Math.PI * 2;
const CACHE_LIMIT = 2; // current zone + one more (phase-2 cross-fade, or the title behind a menu)
const REBUILD_SETTLE_MS = 600; // a scale change must hold this long before layers are repainted

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Draw a battle background in stage space (1280×720 logical units under the current transform).
 * Call it before the world camera transform and pass the camera for parallax.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} zoneId shore|thicket|spire|summit|training (unknown ids fall back to shore)
 * @param {number} [t=0] global ms clock for animation
 * @param {{camera?:{x?:number, y?:number, zoom?:number}, phase?:number}} [opts]
 *   camera: pan offset in px from the neutral framing ({x:0, y:0, zoom:1}); layers shift by a fraction of it.
 *   phase: boss phase index; ≥ 1 selects the phase-2 variant (summit). Fractions 0..1 cross-fade.
 */
export function drawBattleBackground(ctx, zoneId, t = 0, opts = {}) {
  let zone = zoneId;
  if (!BUILDERS[zone]) {
    warnOnce('zone' + zoneId, `[backgrounds] unknown zone "${zoneId}" — using shore`);
    zone = 'shore';
  }
  const cam = opts.camera || NEUTRAL_CAM;
  const S = resolveScale(ctx);
  const phase = clamp(Number(opts.phase) || 0, 0, 1);
  const hasPhase2 = zone === 'summit';
  try {
    if (!hasPhase2 || phase <= 0) {
      drawScene(ctx, getScene(zone, 0, S), t, cam);
    } else if (phase >= 1) {
      drawScene(ctx, getScene(zone, 1, S), t, cam);
    } else {
      drawScene(ctx, getScene(zone, 0, S), t, cam);
      ctx.save();
      ctx.globalAlpha *= phase;
      drawScene(ctx, getScene(zone, 1, S), t, cam);
      ctx.restore();
    }
  } catch (err) {
    warnOnce('draw' + zone, `[backgrounds] ${zone} failed: ${err && err.message}`);
    ctx.save();
    ctx.fillStyle = '#1b1828';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/**
 * Title-screen key art: the frozen Clockwork Sun over the sea, the Meridian Spire and the expedition ship.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} [t=0] global ms clock
 * @param {{parallax?:{x?:number, y?:number}}} [opts] optional pointer parallax (px offsets, ±40 is plenty)
 */
export function drawTitleBackground(ctx, t = 0, opts = {}) {
  const S = resolveScale(ctx);
  const p = opts.parallax || NEUTRAL_CAM;
  try {
    drawScene(ctx, getScene('title', 0, S), t, { x: -(p.x || 0) * 2, y: -(p.y || 0) * 2, zoom: 1 });
  } catch (err) {
    warnOnce('drawTitle', `[backgrounds] title failed: ${err && err.message}`);
    ctx.save();
    ctx.fillStyle = '#15100d';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/**
 * Paint a zone's static layers ahead of time (e.g. during the battle transition fade) to avoid a hitch.
 * @param {string} zoneId
 * @param {{phase?:number, scale?:number}} [o] scale = backing-store pixels per logical px (canvas.width / 1280)
 */
export function prepareBattleBackground(zoneId, { phase = 0, scale = 1 } = {}) {
  if (!BUILDERS[zoneId] || typeof document === 'undefined') return;
  const S = quantizeScale(scale);
  getScene(zoneId, zoneId === 'summit' && phase >= 1 ? 1 : 0, S, true);
}

/** Paint the title art ahead of time. */
export function prepareTitleBackground({ scale = 1 } = {}) {
  if (typeof document === 'undefined') return;
  getScene('title', 0, quantizeScale(scale), true);
}

/** Drop every cached layer (frees memory; they are repainted on next use). */
export function clearBackgroundCache() {
  sceneCache.clear();
  pendingRebuilds.clear();
}

// ---------------------------------------------------------------------------------------------
// Scene cache + compositor
// ---------------------------------------------------------------------------------------------

const NEUTRAL_CAM = { x: 0, y: 0, zoom: 1 };
const sceneCache = new Map();
const warned = new Set();
let fontListener = false;

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

let maxLayerScale = 1.5;

function quantizeScale(s) { return clamp(Math.round((Number(s) || 1) * 4) / 4, 0.5, maxLayerScale); }

/**
 * Background layer quality. Layers are painted at min(backing-store scale, maxScale) pixels per
 * logical px; painterly layers look fine (slightly softer, like depth of field) at 1.5 even on
 * retina screens, at roughly half the memory of 2. Changing it drops the cache.
 * @param {{maxScale?:number}} [o] 0.5 … 2 (default 1.5)
 */
export function setBackgroundQuality({ maxScale = 1.5 } = {}) {
  const v = clamp(Number(maxScale) || 1.5, 0.5, 2);
  if (v !== maxLayerScale) { maxLayerScale = v; sceneCache.clear(); }
}

function resolveScale(ctx) {
  const cw = ctx && ctx.canvas && ctx.canvas.width;
  return quantizeScale(cw ? cw / W : 1);
}

function fontsReady() {
  try {
    return typeof document === 'undefined' || !document.fonts || document.fonts.check(`600 20px ${FONTS.title}`);
  } catch { return true; }
}

function watchFonts() {
  if (fontListener || typeof document === 'undefined' || !document.fonts || !document.fonts.addEventListener) return;
  fontListener = true;
  document.fonts.addEventListener('loadingdone', () => {
    if (!fontsReady()) return;
    for (const [key, sc] of sceneCache) {
      if (sc.fontOk) continue;
      sc.stale = true; // numerals were baked with a fallback serif: repaint in idle time
      scheduleRebuild(key, sc.S);
    }
  });
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function buildScene(zone, phase, S) {
  watchFonts();
  const fontOk = fontsReady();
  const t0 = nowMs();
  const sc = { zone, phase, S, steps: BUILDERS[zone](S, phase), fontOk, stale: false, buildMs: 0 };
  sc.buildMs = nowMs() - t0;
  return sc;
}

/**
 * The cached scene for (zone, phase), keyed without the scale so a resize never evicts a prepared variant.
 * A scene cached at another scale is returned as is (it draws stretched); `sync` (prepare calls, which run at
 * calm moments) repaints it right away, otherwise a repaint is scheduled once the new scale has settled.
 */
function getScene(zone, phase, S, sync = false) {
  const key = `${zone}|${phase}`;
  if (!sync && S !== outputScale) reconcileScale(S);
  let sc = sceneCache.get(key);
  if (sc) {
    sceneCache.delete(key); // refresh LRU position
    sceneCache.set(key, sc);
    if (sc.S === S && !sc.stale) return sc;
    if (sync) {
      pendingRebuilds.delete(key);
      sc = buildScene(zone, phase, S);
      sceneCache.set(key, sc);
    } else if (sc.stale) {
      scheduleRebuild(key, S);
    }
    return sc;
  }
  sc = buildScene(zone, phase, S);
  sceneCache.set(key, sc);
  while (sceneCache.size > CACHE_LIMIT) sceneCache.delete(sceneCache.keys().next().value);
  return sc;
}

// Deferred repaints. A repaint costs 10–35 ms on a GPU (far more with software raster), so it must not land in
// the middle of an attack: battle scenes wait for a calm moment the battle announces with
// flushBackgroundRebuilds() (the HUD calls it when a command menu opens), with a long fallback; the title and
// cutscenes, where a hitch is harmless, repaint once the size has settled. One scene per slot.
const pendingRebuilds = new Map(); // key → { S, at } (at = when the target scale was last set)
const REBUILD_BATTLE_FALLBACK_MS = 12000;
let rebuildTimer = null;
let outputScale = null; // the layer scale draw calls last asked for

/**
 * The output scale changed (resize, rotation, DPR): every cached scene painted at another scale — a prepared
 * phase-2 variant included, so a later cross-fade finds it ready — gets a repaint; ones already right drop theirs.
 */
function reconcileScale(S) {
  outputScale = S;
  for (const [k, c] of sceneCache) {
    if (c.S !== S || c.stale) scheduleRebuild(k, S);
    else pendingRebuilds.delete(k);
  }
}

function scheduleRebuild(key, S) {
  const p = pendingRebuilds.get(key);
  if (!p || p.S !== S) pendingRebuilds.set(key, { S, at: nowMs() });
  armRebuildTimer(REBUILD_SETTLE_MS);
}

function armRebuildTimer(ms) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(onRebuildTimer, ms);
}

function onRebuildTimer() {
  rebuildTimer = null;
  const now = nowMs();
  for (const [key, p] of pendingRebuilds) {
    const settled = now - p.at >= REBUILD_SETTLE_MS;
    const battle = !key.startsWith('title|');
    if (settled && (!battle || now - p.at >= REBUILD_BATTLE_FALLBACK_MS)) {
      runRebuild(key, true);
      break;
    }
  }
  if (pendingRebuilds.size) armRebuildTimer(400);
}

/** Repaint one pending scene (in an idle slot when `idle`), keeping its LRU position. */
function runRebuild(key, idle) {
  const p = pendingRebuilds.get(key);
  if (!p) return;
  pendingRebuilds.delete(key);
  const work = () => {
    const sc = sceneCache.get(key);
    if (!sc || (sc.S === p.S && !sc.stale)) return;
    try {
      const built = buildScene(sc.zone, sc.phase, p.S);
      if (sceneCache.get(key) === sc) sceneCache.set(key, built);
    } catch (err) {
      warnOnce('rebuild' + key, `[backgrounds] repaint of ${key} failed: ${err && err.message}`);
    }
  };
  const ric = globalThis.requestIdleCallback;
  if (idle && typeof ric === 'function') ric(work, { timeout: 1000 });
  else work();
}

/**
 * Repaint background layers left at an old scale by a resize, now. Call it at a calm moment (a command menu
 * opening, a pause); it does at most `max` scenes whose new size has settled and returns how many still wait.
 * @param {{max?:number}} [o]
 * @returns {number}
 */
export function flushBackgroundRebuilds({ max = 1 } = {}) {
  const now = nowMs();
  let done = 0;
  // Most recently drawn first: the scene on screen before a prepared variant.
  for (const key of [...sceneCache.keys()].reverse()) {
    const p = pendingRebuilds.get(key);
    if (done >= max) break;
    if (!p || now - p.at < REBUILD_SETTLE_MS) continue;
    runRebuild(key, false);
    done += 1;
  }
  for (const key of pendingRebuilds.keys()) if (!sceneCache.has(key)) pendingRebuilds.delete(key);
  return pendingRebuilds.size;
}

/** Approximate bytes held by cached background layers (debug / perf readouts). */
export function backgroundMemory() {
  let bytes = 0;
  for (const sc of sceneCache.values()) for (const st of sc.steps) if (st.canvas) bytes += st.canvas.width * st.canvas.height * 4;
  return bytes;
}

/**
 * Several narrow layers that share one painter — for framing elements at the frame edges, so the
 * empty middle of the frame costs no memory. Returns the layers (push them all).
 */
function edgeLayers(S, depth, y0, y1, ranges, paint) {
  return ranges.map(([x0, x1]) => {
    const L = layer(S, depth, y0, y1, 1, x0, x1);
    paint(L.g);
    return L;
  });
}

/**
 * Build time (ms) of a cached scene, for perf readouts; null when not cached. `scale` is accepted for
 * compatibility: one scene per zone/phase is cached, at whatever scale it was last painted.
 */
export function backgroundBuildTime(zoneId, { phase = 0 } = {}) {
  const sc = sceneCache.get(`${zoneId}|${phase}`);
  return sc ? sc.buildMs : null;
}

/** Scale (backing px per logical px) the cached zone/phase scene is currently painted at; null when not cached. */
export function backgroundScale(zoneId, { phase = 0 } = {}) {
  const sc = sceneCache.get(`${zoneId}|${phase}`);
  return sc ? sc.S : null;
}

/**
 * Opacity the current scene is being composited at (captured from ctx.globalAlpha in drawScene).
 * Animated steps multiply every alpha they set by it, so cross-fades and caller fades stay coherent.
 */
let FADE = 1;

function drawScene(ctx, scene, t, cam) {
  const prevFade = FADE;
  FADE = ctx.globalAlpha;
  try {
    drawSteps(ctx, scene, t, cam);
  } finally {
    FADE = prevFade;
  }
}

function drawSteps(ctx, scene, t, cam) {
  const cx = Number(cam.x) || 0;
  const cy = Number(cam.y) || 0;
  const zoom = Number.isFinite(cam.zoom) ? cam.zoom : 1;
  for (const st of scene.steps) {
    const d = st.depth;
    const ox = clamp(-cx * d, -PAD_X + 2, PAD_X - 2);
    const oy = clamp(-cy * d, -PAD_Y + 2, PAD_Y - 2);
    const z = Math.max(1, 1 + (zoom - 1) * d);
    const moved = ox !== 0 || oy !== 0 || z !== 1;
    if (moved) {
      ctx.save();
      ctx.translate(W / 2 + ox, H / 2 + oy);
      ctx.scale(z, z);
      ctx.translate(-W / 2, -H / 2);
    }
    if (st.canvas) ctx.drawImage(st.canvas, st.x0, st.y0, st.w, st.h);
    else {
      ctx.save();
      st.draw(ctx, t);
      ctx.restore();
    }
    if (moved) ctx.restore();
  }
}

// ---------------------------------------------------------------------------------------------
// Utilities: RNG, colour, canvases
// ---------------------------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function makeRand(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.gauss = () => (r() + r() + r() + r() - 2) / 2;
  return r;
}

const rgbCache = new Map();
function rgb(c) {
  let v = rgbCache.get(c);
  if (v) return v;
  let h = String(c).replace('#', '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(c, v);
  return v;
}
function rgba(c, a) { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`; }
function hex([r, g, b]) { return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }
function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return hex([Math.round(lerp(A[0], B[0], t)), Math.round(lerp(A[1], B[1], t)), Math.round(lerp(A[2], B[2], t))]);
}
function shade(c, k) { return k < 0 ? mix(c, '#000000', -k) : mix(c, '#ffffff', k); }
function colorAt(stops, u) {
  if (u <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [o0, c0] = stops[i];
    const [o1, c1] = stops[i + 1];
    if (u <= o1) return mix(c0, c1, (u - o0) / Math.max(1e-6, o1 - o0));
  }
  return stops[stops.length - 1][1];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/**
 * A static layer covering logical x ∈ [x0, x1] (default: the whole padded width) and y ∈ [y0, y1],
 * painted with logical coords. `res` < 1 lowers the pixel density for soft content (skies, vignettes).
 */
function layer(S, depth, y0 = -PAD_Y, y1 = H + PAD_Y, res = 1, x0 = -PAD_X, x1 = W + PAD_X) {
  const w = x1 - x0;
  const h = y1 - y0;
  const sc = S * res;
  const canvas = makeCanvas(w * sc, h * sc);
  const g = canvas.getContext('2d');
  g.setTransform(sc, 0, 0, sc, -x0 * sc, -y0 * sc);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return { canvas, g, x0, y0, w, h, depth };
}

/**
 * The sun disc on its own small layer, so the animated corona can sit between the sky and the disc.
 * `extra(g)` paints things that pass in front of the disc (thin clouds, a spire...).
 */
function sunLayer(S, depth, sun, opts, extra = null, pad = 1.35) {
  const y0 = Math.max(-PAD_Y, sun.y - sun.r * pad), y1 = Math.min(H + PAD_Y, sun.y + sun.r * pad);
  const x0 = Math.max(-PAD_X, sun.x - sun.r * pad), x1 = Math.min(W + PAD_X, sun.x + sun.r * pad);
  const L = layer(S, depth, y0, y1, 1, x0, x1);
  clockSun(L.g, sun.x, sun.y, sun.r, { ...opts, glow: false });
  if (extra) extra(L.g);
  return L;
}

function anim(depth, draw) { return { depth, draw }; }

function vgrad(g, y0, y1, stops) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function blob(g, x, y, rx, ry, color, a, a1 = 0) {
  if (rx <= 0 || ry <= 0) return;
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, rgba(color, a));
  gr.addColorStop(1, rgba(color, a1));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, rx, 0, TAU);
  g.fill();
  g.restore();
}

/** Field of short brush strokes (the oil-paint texture). */
function strokes(g, r, { x, y, w, h, n, len = [20, 80], width = [1, 4], alpha = [0.1, 0.3], color, angle = 0, jitter = 0.12, curve = 0.12, where = null }) {
  for (let i = 0; i < n; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    if (where && !where(px, py, r)) continue;
    const L = r.range(len[0], len[1]);
    const a = angle + (r() - 0.5) * jitter;
    const col = typeof color === 'function' ? color(px, py, r) : Array.isArray(color) ? r.pick(color) : color;
    const cs = Math.cos(a), sn = Math.sin(a);
    const bend = (r() - 0.5) * L * curve;
    g.strokeStyle = rgba(col, r.range(alpha[0], alpha[1]));
    g.lineWidth = r.range(width[0], width[1]);
    g.beginPath();
    g.moveTo(px - (cs * L) / 2, py - (sn * L) / 2);
    g.quadraticCurveTo(px - sn * bend, py + cs * bend, px + (cs * L) / 2, py + (sn * L) / 2);
    g.stroke();
  }
}

/** Field of elliptical paint dabs. */
function dabs(g, r, { x, y, w, h, n, size = [2, 6], alpha = [0.2, 0.5], color, squash = 0.55, rot = 0, rotJ = 0.8, where = null }) {
  for (let i = 0; i < n; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    if (where && !where(px, py, r)) continue;
    const s = r.range(size[0], size[1]);
    const col = typeof color === 'function' ? color(px, py, r) : Array.isArray(color) ? r.pick(color) : color;
    g.fillStyle = rgba(col, r.range(alpha[0], alpha[1]));
    g.beginPath();
    g.ellipse(px, py, s, s * squash, rot + (r() - 0.5) * rotJ, 0, TAU);
    g.fill();
  }
}

function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/**
 * Stroke the edges of a polygon that face a light source (rim light). Closed polygons may wind either
 * way (the winding is detected); open polylines must run left → right with their mass below.
 */
function rimLight(g, pts, lx, ly, color, width = 2, alpha = 0.8, closed = true) {
  const n = pts.length;
  let sign = 1;
  if (closed) {
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % n];
      area += x0 * y1 - x1 * y0;
    }
    sign = area >= 0 ? 1 : -1;
  }
  g.lineWidth = width;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const ex = x1 - x0, ey = y1 - y0;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    const nx = (sign * ey) / len, ny = (-sign * ex) / len;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const dl = Math.hypot(lx - mx, ly - my) || 1;
    const dot = (nx * (lx - mx) + ny * (ly - my)) / dl;
    if (dot < 0.15) continue;
    g.strokeStyle = rgba(color, alpha * clamp((dot - 0.15) / 0.6, 0, 1));
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
}

/** Jagged ridge line points from x0 to x1. */
function ridge(r, x0, x1, heightAt, steps = 40, rough = 6) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = lerp(x0, x1, u);
    pts.push([x, heightAt(u, x) + (r() - 0.5) * rough]);
  }
  return pts;
}

let noiseTile = null;
function grain(g, x, y, w, h, alpha = 0.06) {
  if (!noiseTile) {
    noiseTile = makeCanvas(128, 128);
    const ng = noiseTile.getContext('2d');
    const img = ng.createImageData(128, 128);
    const r = makeRand(77);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.floor(r() * 110);
    }
    ng.putImageData(img, 0, 0);
  }
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = alpha;
  g.fillStyle = g.createPattern(noiseTile, 'repeat');
  g.fillRect(x, y, w, h);
  g.restore();
}

function stars(g, r, n, y0, y1, maxA = 0.8) {
  for (let i = 0; i < n; i++) {
    const x = r.range(-PAD_X, W + PAD_X);
    const y = lerp(y0, y1, Math.pow(r(), 1.6));
    const a = maxA * (1 - (y - y0) / (y1 - y0)) * r.range(0.3, 1);
    const s = r.range(0.5, 1.4);
    g.fillStyle = rgba('#fff4e0', a);
    g.beginPath();
    g.arc(x, y, s, 0, TAU);
    g.fill();
    if (r() < 0.08) {
      g.strokeStyle = rgba('#fff4e0', a * 0.6);
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x - 4, y); g.lineTo(x + 4, y);
      g.moveTo(x, y - 4); g.lineTo(x, y + 4);
      g.stroke();
    }
  }
}

/**
 * Brush-stroke cloud bank: a lobed soft mass plus many horizontal strokes, lit on the side facing the
 * light, with a bright broken rim along that edge. light: direction from the cloud toward the light
 * ({x:0, y:1} = sun below — dusk undersides; {x:0, y:-1} = sun above).
 */
function cloudBank(g, r, { x, y, w, h, body, lit, light = { x: 0, y: 1 }, alpha = 1, density = 1, rim = true, lobes = 5 }) {
  // lobed envelope: flatter on the lit side, billowing on the far side
  const ph = [r.range(0, TAU), r.range(0, TAU), r.range(0, TAU)];
  const taper = (u) => Math.pow(Math.max(0, 1 - (2 * u) * (2 * u)), 0.5);
  const bumps = (u) => 0.62 + 0.24 * Math.sin(u * lobes * 3.1 + ph[0]) + 0.14 * Math.sin(u * lobes * 7.3 + ph[1]);
  const side = light.y >= 0 ? 1 : -1; // +1: lit edge is the bottom
  const extentLit = (u) => h * 0.36 * taper(u);
  const extentFar = (u) => h * 0.64 * taper(u) * bumps(u);
  const edgeAt = (u, towardLight) => y + (towardLight ? side * extentLit(u) : -side * extentFar(u));
  // soft mass, sampled along the envelope
  const puffs = Math.max(6, Math.round(w / 22));
  for (let i = 0; i < puffs; i++) {
    const u = r.range(-0.49, 0.49);
    const top = edgeAt(u, false), bot = edgeAt(u, true);
    const cy = lerp(top, bot, r.range(0.3, 0.7));
    const ry = Math.abs(bot - top) * r.range(0.45, 0.7);
    if (ry < 1) continue;
    blob(g, x + u * w, cy, ry * r.range(1.6, 2.8), ry, body, 0.28 * alpha);
  }
  // strokes filling the envelope, colour graded toward the light
  const count = Math.round((w * h) / 42 * density);
  for (let i = 0; i < count; i++) {
    const u = r.range(-0.5, 0.5);
    const e = taper(u);
    if (e < 0.06) continue;
    const far = edgeAt(u, false), near = edgeAt(u, true);
    const v = r(); // 0 = far edge, 1 = lit edge
    const cy = lerp(far, near, v);
    const cx = x + u * w;
    const len = w * r.range(0.03, 0.16) * (0.4 + e);
    const lw = h * r.range(0.05, 0.16) * (0.5 + e * 0.5);
    const facing = clamp(v * 0.85 + u * light.x * 0.6 + 0.1, 0, 1);
    const k = Math.pow(facing, 2.4) * r.range(0.6, 1.05);
    const col = shade(mix(body, lit, clamp(k, 0, 1)), r.range(-0.07, 0.07));
    const edgeFade = clamp(v / 0.3, 0.2, 1) * clamp(e / 0.35, 0.3, 1);
    g.strokeStyle = rgba(col, r.range(0.18, 0.5) * alpha * edgeFade);
    g.lineWidth = lw * (0.6 + 0.4 * edgeFade);
    g.beginPath();
    g.moveTo(cx - len / 2, cy + r.range(-0.8, 0.8));
    g.quadraticCurveTo(cx, cy + r.range(-1.6, 1.6), cx + len / 2, cy + r.range(-0.8, 0.8));
    g.stroke();
  }
  if (!rim) return;
  // broken bright rim hugging the lit edge
  const rims = Math.round(w / 6);
  for (let i = 0; i < rims; i++) {
    const u = r.range(-0.47, 0.47);
    if (taper(u) < 0.1) continue;
    const cy = edgeAt(u, true) - side * r.range(0, 2.5);
    const cx = x + u * w;
    const len = w * r.range(0.02, 0.08);
    g.strokeStyle = rgba(shade(lit, r.range(0.1, 0.35)), r.range(0.35, 0.8) * alpha * (0.5 + 0.5 * clamp(0.5 + u * light.x, 0, 1)));
    g.lineWidth = r.range(0.8, 2.4);
    g.beginPath();
    g.moveTo(cx - len / 2, cy);
    g.quadraticCurveTo(cx, cy + side * r.range(-0.5, 1), cx + len / 2, cy + r.range(-0.5, 0.5));
    g.stroke();
  }
}

function gulls(g, pts, color = '#3a2838', s = 1) {
  g.strokeStyle = rgba(color, 0.75);
  g.lineWidth = 1.3 * s;
  for (const [x, y, k = 1] of pts) {
    const w = 7 * s * k;
    g.beginPath();
    g.moveTo(x - w, y - w * 0.25);
    g.quadraticCurveTo(x - w * 0.45, y - w * 0.55, x, y);
    g.quadraticCurveTo(x + w * 0.45, y - w * 0.55, x + w, y - w * 0.25);
    g.stroke();
  }
}

/** Soft radial darkening around the frame, painted at low resolution. */
function vignette(S, color = '#120c10', strength = 0.55, bottom = 0.35) {
  const L = layer(S, 0, -PAD_Y, H + PAD_Y, 0.4);
  const g = L.g;
  const gr = g.createRadialGradient(W / 2, H * 0.46, H * 0.36, W / 2, H * 0.5, W * 0.72);
  gr.addColorStop(0, rgba(color, 0));
  gr.addColorStop(0.65, rgba(color, strength * 0.45));
  gr.addColorStop(1, rgba(color, strength));
  g.fillStyle = gr;
  g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, H + PAD_Y * 2);
  if (bottom > 0) {
    g.fillStyle = vgrad(g, H * 0.78, H + PAD_Y, [[0, rgba(color, 0)], [1, rgba(color, bottom)]]);
    g.fillRect(-PAD_X, H * 0.78, W + PAD_X * 2, H * 0.22 + PAD_Y);
  }
  return L;
}

// ---------------------------------------------------------------------------------------------
// Shared motifs
// ---------------------------------------------------------------------------------------------

const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

/**
 * The Clockwork Sun: luminous disc engraved as a clock dial, hands stopped at 6:58.
 * detail 0..1 scales the engraving's visibility.
 */
function clockSun(g, cx, cy, r, { color = '#ffd79a', detail = 1, numerals = true, hands = true, crack = null, glow = true, edge = '#e89a4a' } = {}) {
  if (glow) {
    blob(g, cx, cy, r * 3.4, r * 3.4, color, 0.28);
    blob(g, cx, cy, r * 1.9, r * 1.9, '#fff1cc', 0.42);
  }
  const disc = g.createRadialGradient(cx - r * 0.18, cy - r * 0.2, r * 0.05, cx, cy, r);
  disc.addColorStop(0, '#fffdf4');
  disc.addColorStop(0.5, mix(color, '#fffaf0', 0.55));
  disc.addColorStop(0.88, color);
  disc.addColorStop(1, mix(color, edge, 0.55));
  g.fillStyle = disc;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.fill();
  if (detail <= 0) return;
  const ink = (a) => rgba('#8a4a1c', a * detail);
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.clip();
  // rings
  g.strokeStyle = ink(0.4);
  for (const [k, w] of [[0.955, 0.006], [0.915, 0.004], [0.77, 0.006], [0.735, 0.003], [0.3, 0.005], [0.26, 0.003]]) {
    g.lineWidth = Math.max(0.6, r * w);
    g.beginPath();
    g.arc(cx, cy, r * k, 0, TAU);
    g.stroke();
  }
  // minute ticks
  g.lineWidth = Math.max(0.5, r * 0.004);
  g.beginPath();
  for (let i = 0; i < 60; i++) {
    const a = (i * TAU) / 60;
    const r0 = r * 0.918, r1 = r * (i % 5 === 0 ? 0.975 : 0.952);
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
  }
  g.stroke();
  // numerals
  if (numerals) {
    g.fillStyle = ink(0.5);
    g.font = `600 ${Math.max(6, r * 0.105)}px ${FONTS.title}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12 - Math.PI / 2;
      g.save();
      g.translate(cx + Math.cos(a) * r * 0.843, cy + Math.sin(a) * r * 0.843);
      g.rotate(a + Math.PI / 2);
      g.fillText(ROMAN[i], 0, 0);
      g.restore();
    }
  }
  // filigree petals
  g.strokeStyle = ink(0.26);
  g.lineWidth = Math.max(0.5, r * 0.004);
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    const a1 = a + TAU / 24;
    const pr = r * 0.3, qr = r * 0.66;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr);
    g.quadraticCurveTo(cx + Math.cos(a1) * qr * 1.12, cy + Math.sin(a1) * qr * 1.12, cx + Math.cos(a + TAU / 12) * pr, cy + Math.sin(a + TAU / 12) * pr);
    g.stroke();
    g.beginPath();
    g.arc(cx + Math.cos(a1) * r * 0.62, cy + Math.sin(a1) * r * 0.62, r * 0.018, 0, TAU);
    g.stroke();
  }
  g.restore();
  // hands (6:58) — the time the Sun stopped
  if (hands) {
    const minuteA = (58 / 60) * TAU - Math.PI / 2;
    const hourA = ((6 + 58 / 60) / 12) * TAU - Math.PI / 2;
    clockHand(g, cx, cy, hourA, r * 0.5, r * 0.05, rgba('#6a3a14', 0.55 * detail + 0.1));
    clockHand(g, cx, cy, minuteA, r * 0.74, r * 0.036, rgba('#6a3a14', 0.55 * detail + 0.1));
    g.fillStyle = rgba('#6a3a14', 0.6 * detail + 0.1);
    g.beginPath();
    g.arc(cx, cy, r * 0.06, 0, TAU);
    g.fill();
    g.fillStyle = rgba('#fff4d8', 0.7);
    g.beginPath();
    g.arc(cx, cy, r * 0.025, 0, TAU);
    g.fill();
  }
  if (crack) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, r * 1.01, 0, TAU);
    g.clip();
    g.lineJoin = 'miter';
    g.strokeStyle = rgba('#5a2a10', 0.75);
    g.lineWidth = Math.max(1, r * 0.014);
    for (const path of crack) { strokePath(g, path); }
    g.globalCompositeOperation = 'lighter';
    g.shadowColor = 'rgba(255, 240, 200, 0.9)';
    g.shadowBlur = r * 0.05;
    g.strokeStyle = 'rgba(255, 248, 225, 0.95)';
    g.lineWidth = Math.max(0.8, r * 0.006);
    for (const path of crack) { strokePath(g, path); }
    g.restore();
  }
}

function strokePath(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
}

function clockHand(g, cx, cy, a, len, w, fill) {
  g.save();
  g.translate(cx, cy);
  g.rotate(a);
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(-len * 0.16, 0);
  g.lineTo(-len * 0.1, -w * 0.5);
  g.lineTo(len * 0.62, -w * 0.32);
  // spade tip
  g.quadraticCurveTo(len * 0.74, -w * 1.9, len * 0.84, -w * 0.4);
  g.lineTo(len, 0);
  g.lineTo(len * 0.84, w * 0.4);
  g.quadraticCurveTo(len * 0.74, w * 1.9, len * 0.62, w * 0.32);
  g.lineTo(-len * 0.1, w * 0.5);
  g.closePath();
  g.fill();
  g.restore();
}

/** Jagged crack paths across a disc. */
function crackPaths(r, cx, cy, rad, a0, a1, branches = 3) {
  const main = [];
  const p0 = [cx + Math.cos(a0) * rad * 1.02, cy + Math.sin(a0) * rad * 1.02];
  const p1 = [cx + Math.cos(a1) * rad * 1.02, cy + Math.sin(a1) * rad * 1.02];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const bend = Math.sin(Math.PI * u) * rad * 0.18;
    const nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0];
    const nl = Math.hypot(nx, ny) || 1;
    main.push([
      lerp(p0[0], p1[0], u) + (nx / nl) * bend + (r() - 0.5) * rad * 0.05,
      lerp(p0[1], p1[1], u) + (ny / nl) * bend + (r() - 0.5) * rad * 0.05,
    ]);
  }
  const paths = [main];
  for (let b = 0; b < branches; b++) {
    const start = main[r.int(3, steps - 3)];
    const ang = r.range(0, TAU);
    const len = rad * r.range(0.15, 0.4);
    const br = [start];
    for (let i = 1; i <= 5; i++) {
      const prev = br[br.length - 1];
      br.push([prev[0] + Math.cos(ang + (r() - 0.5) * 0.9) * len / 5, prev[1] + Math.sin(ang + (r() - 0.5) * 0.9) * len / 5]);
    }
    paths.push(br);
  }
  return paths;
}

const coronaCache = new Map();
const CORONA_INNER = 0.34; // fraction of the sprite radius where rays begin (the disc edge)

/** Low-resolution ray sprite: upscaling at draw time keeps every ray soft and painterly. */
function coronaSprite(color, rays, seed) {
  const key = `${color}|${rays}|${seed}`;
  let c = coronaCache.get(key);
  if (c) return c;
  const N = 192;
  c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const r = makeRand(seed);
  const R = N / 2;
  const inner = R * CORONA_INNER;
  g.translate(R, R);
  for (let i = 0; i < rays; i++) {
    const a = r() * TAU;
    const w0 = r.range(0.03, 0.09);
    const len = R * r.range(0.55, 1);
    const alpha = r.range(0.06, 0.26);
    const gr = g.createRadialGradient(0, 0, inner * 0.95, 0, 0, len);
    gr.addColorStop(0, rgba(color, alpha));
    gr.addColorStop(0.4, rgba(color, alpha * 0.45));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(Math.cos(a - w0) * inner, Math.sin(a - w0) * inner);
    g.lineTo(Math.cos(a - w0 * 0.35) * len, Math.sin(a - w0 * 0.35) * len);
    g.lineTo(Math.cos(a + w0 * 0.35) * len, Math.sin(a + w0 * 0.35) * len);
    g.lineTo(Math.cos(a + w0) * inner, Math.sin(a + w0) * inner);
    g.closePath();
    g.fill();
  }
  // a halo hugging the rim
  const halo = g.createRadialGradient(0, 0, inner * 0.9, 0, 0, inner * 1.9);
  halo.addColorStop(0, rgba(color, 0.35));
  halo.addColorStop(1, rgba(color, 0));
  g.fillStyle = halo;
  g.fillRect(-R, -R, N, N);
  coronaCache.set(key, c);
  return c;
}

/** Slowly turning soft rays around a sun (animated, additive). Draw it before the disc layer. */
function drawCorona(ctx, x, y, r, t, color, alpha = 0.4) {
  const a = coronaSprite(color, 38, 11);
  const b = coronaSprite(color, 24, 29);
  const size = (r / CORONA_INNER) * 2;
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.000015);
  ctx.globalAlpha = (alpha * (0.88 + 0.12 * Math.sin(t * 0.0007))) * FADE;
  ctx.drawImage(a, -size / 2, -size / 2, size, size);
  ctx.rotate(-t * 0.000037 + 0.9);
  ctx.globalAlpha = (alpha * 0.7 * (0.85 + 0.15 * Math.sin(t * 0.0009 + 1))) * FADE;
  ctx.drawImage(b, -size * 0.43, -size * 0.43, size * 0.86, size * 0.86);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = FADE;
}

const spriteCache = new Map();
function cachedSprite(key, w, h, paint) {
  let c = spriteCache.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    paint(c.getContext('2d'), w, h);
    spriteCache.set(key, c);
  }
  return c;
}

function glowSprite(color) {
  return cachedSprite('glow|' + color, 64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(mix(color, '#ffffff', 0.7), 1));
    gr.addColorStop(0.2, rgba(color, 0.75));
    gr.addColorStop(0.55, rgba(color, 0.2));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
}

function dashSprite(color) {
  return cachedSprite('dash|' + color, 64, 8, (g) => {
    const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, rgba(color, 0));
    gr.addColorStop(0.5, rgba(color, 1));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(32, 4, 32, 3, 0, 0, TAU);
    g.fill();
  });
}

/** Deterministic drifting motes (dust, pollen, embers, sea spray). */
function makeMotes(r, n, { x0 = -PAD_X, x1 = W + PAD_X, y0 = 0, y1 = H, vx = [-6, 6], vy = [-12, -4], size = [1, 2.4], colors, amp = 8 }) {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({
      x: r.range(x0, x1), y: r.range(y0, y1), vx: r.range(vx[0], vx[1]), vy: r.range(vy[0], vy[1]),
      s: r.range(size[0], size[1]), ph: r.range(0, TAU), f: r.range(0.0005, 0.0016), c: r.pick(colors), amp: r.range(amp * 0.4, amp),
    });
  }
  return { list, x0, x1, y0, y1 };
}

function drawMotes(ctx, st, t, alpha = 1) {
  const { list, x0, x1, y0, y1 } = st;
  const wX = x1 - x0, wY = y1 - y0;
  const sec = t / 1000;
  ctx.globalCompositeOperation = 'lighter';
  for (const m of list) {
    let x = m.x + m.vx * sec + Math.sin(t * m.f + m.ph) * m.amp;
    let y = m.y + m.vy * sec + Math.cos(t * m.f * 0.7 + m.ph) * m.amp * 0.5;
    x = x0 + (((x - x0) % wX) + wX) % wX;
    y = y0 + (((y - y0) % wY) + wY) % wY;
    const tw = 0.55 + 0.45 * Math.sin(t * m.f * 3 + m.ph * 2);
    const edge = Math.min(1, (y - y0) / 40, (y1 - y) / 40);
    ctx.globalAlpha = (alpha * tw * clamp(edge, 0, 1)) * FADE;
    const s = m.s * 4;
    ctx.drawImage(glowSprite(m.c), x - s, y - s, s * 2, s * 2);
  }
  ctx.globalAlpha = FADE;
  ctx.globalCompositeOperation = 'source-over';
}

/** Twinkling highlights on water: pre-placed points that flare briefly. */
function makeGlints(r, n, { cx, spread, y0, y1, color = '#fff2d0' }) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const v = Math.pow(r(), 1.3);
    const y = lerp(y0, y1, v);
    const sp = spread[0] + (spread[1] - spread[0]) * v;
    list.push({ x: cx + r.gauss() * sp, y, len: 6 + v * 26 * r.range(0.6, 1.3), ph: r.range(0, TAU), f: r.range(0.0012, 0.003), h: 1.5 + v * 2 });
  }
  return { list, color };
}

function drawGlints(ctx, st, t, alpha = 1) {
  const spr = dashSprite(st.color);
  ctx.globalCompositeOperation = 'lighter';
  for (const gl of st.list) {
    const s = Math.sin(t * gl.f + gl.ph);
    if (s <= 0.3) continue;
    const a = Math.pow((s - 0.3) / 0.7, 2) * alpha;
    ctx.globalAlpha = (a) * FADE;
    ctx.drawImage(spr, gl.x - gl.len / 2, gl.y - gl.h / 2, gl.len, gl.h);
  }
  ctx.globalAlpha = FADE;
  ctx.globalCompositeOperation = 'source-over';
}

function cogPath(g, cx, cy, rOuter, rInner, teeth) {
  const step = TAU / teeth;
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [[a - step * 0.5, rInner], [a - step * 0.24, rInner], [a - step * 0.15, rOuter], [a + step * 0.15, rOuter], [a + step * 0.24, rInner]];
    for (let j = 0; j < pts.length; j++) {
      const [ang, rr] = pts[j];
      const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
      if (i === 0 && j === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  }
  g.closePath();
}

/** Pre-rendered brass gear (rotated at draw time). */
function gearSprite(S, radius, teeth, { body = '#b8893b', dark = '#5a4020', light = '#f0cf7a', spokes = 6, haze = null } = {}) {
  const key = `gear|${S}|${radius}|${teeth}|${body}|${haze}`;
  const pad = 4;
  const size = (radius + pad) * 2;
  return cachedSprite(key, size * S, size * S, (g) => {
    g.scale(S, S);
    g.translate(radius + pad, radius + pad);
    cogPath(g, 0, 0, radius, radius * 0.87, teeth);
    const mg = g.createLinearGradient(-radius, -radius, radius, radius);
    mg.addColorStop(0, light);
    mg.addColorStop(0.35, body);
    mg.addColorStop(1, dark);
    g.fillStyle = mg;
    g.fill();
    g.lineWidth = Math.max(1, radius * 0.02);
    g.strokeStyle = rgba(dark, 0.9);
    g.stroke();
    // spoked windows
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const rIn = radius * 0.7, rHub = radius * 0.26;
    for (let i = 0; i < spokes; i++) {
      const a0 = (i / spokes) * TAU + 0.16;
      const a1 = ((i + 1) / spokes) * TAU - 0.16;
      g.beginPath();
      g.arc(0, 0, rIn, a0, a1);
      g.arc(0, 0, rHub, a1 - 0.05, a0 + 0.05, true);
      g.closePath();
      g.fill();
    }
    g.restore();
    // rim + hub details
    g.strokeStyle = rgba(light, 0.55);
    g.lineWidth = Math.max(1, radius * 0.025);
    g.beginPath();
    g.arc(0, 0, radius * 0.72, Math.PI * 1.05, Math.PI * 1.7);
    g.stroke();
    g.strokeStyle = rgba(dark, 0.8);
    g.lineWidth = Math.max(1, radius * 0.02);
    g.beginPath();
    g.arc(0, 0, rIn, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, rHub * 0.9, 0, TAU);
    g.fillStyle = mix(body, dark, 0.3);
    g.fill();
    g.stroke();
    g.fillStyle = light;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.beginPath();
      g.arc(Math.cos(a) * rHub * 0.6, Math.sin(a) * rHub * 0.6, Math.max(0.8, radius * 0.022), 0, TAU);
      g.fill();
    }
    if (haze) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = haze;
      g.fillRect(-radius - pad, -radius - pad, size, size);
    }
  });
}

function drawGear(ctx, spr, x, y, radius, angle) {
  const pad = 4;
  const size = (radius + pad) * 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(spr, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** Tapered lighthouse; `broken` snaps the top off with a jagged edge. */
function lighthouse(g, r, { x, base, h, w, broken = false, fill, band, rim, sunX }) {
  const top = base - h;
  const tw = w * 0.62;
  const pts = [[x - w / 2, base], [x - tw / 2, top + (broken ? 8 : 0)]];
  if (broken) {
    pts.push([x - tw * 0.22, top - 8], [x - tw * 0.05, top + 4], [x + tw * 0.14, top - 16], [x + tw * 0.3, top - 4], [x + tw / 2, top + 14]);
  } else {
    pts.push([x + tw / 2, top]);
  }
  pts.push([x + w / 2, base]);
  poly(g, pts);
  g.fillStyle = vgrad(g, top - 16, base, [[0, shade(fill, -0.15)], [1, shade(fill, 0.08)]]);
  g.fill();
  // stripes
  g.save();
  poly(g, pts);
  g.clip();
  g.fillStyle = rgba(band, 0.55);
  for (let k = 0; k < 3; k++) {
    const y = top + h * (0.22 + k * 0.28);
    g.fillRect(x - w, y, w * 2, h * 0.11);
  }
  // shadow side
  const lit = sunX > x ? 1 : -1;
  g.fillStyle = rgba('#140c14', 0.35);
  g.fillRect(lit > 0 ? x - w : x + tw * 0.1, top - 20, w * 0.9, h + 30);
  g.restore();
  // windows
  g.fillStyle = rgba('#140c14', 0.7);
  for (let k = 0; k < 3; k++) g.fillRect(x - 1.5, top + h * (0.35 + k * 0.2), 3, 5);
  if (!broken) {
    // gallery + dead lantern room catching the sun
    g.fillStyle = shade(fill, -0.25);
    g.fillRect(x - tw / 2 - 3, top - 3, tw + 6, 3);
    g.fillStyle = rgba('#ffd9a0', 0.55);
    g.fillRect(x - tw * 0.3, top - 11, tw * 0.6, 8);
    g.fillStyle = shade(fill, -0.3);
    poly(g, [[x - tw * 0.38, top - 11], [x, top - 20], [x + tw * 0.38, top - 11]]);
    g.fill();
  } else {
    // twisted railing and a dangling beam
    g.strokeStyle = rgba(shade(fill, -0.3), 0.9);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x + tw * 0.14, top - 14); g.lineTo(x + tw * 0.5, top - 26); g.lineTo(x + tw * 0.8, top - 22);
    g.moveTo(x - tw * 0.2, top - 6); g.lineTo(x - tw * 0.55, top - 14);
    g.stroke();
  }
  rimLight(g, pts, sunX, top - 60, rim, 1.6, 0.8);
}

/** Wood plank post (pilings / poles). */
function post(g, x, base, w, h, lean, fill, rim) {
  const pts = [[x - w / 2, base], [x - w / 2 + lean, base - h], [x + w / 2 + lean, base - h - 2], [x + w / 2, base]];
  poly(g, pts);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = rgba(rim, 0.55);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x + w / 2 - 1, base);
  g.lineTo(x + w / 2 + lean - 1, base - h);
  g.stroke();
}

/** Grass tuft: thin curved blades. */
function tuft(g, r, x, y, h, n, colors, tip = null, lean = 0) {
  for (let i = 0; i < n; i++) {
    const bx = x + r.range(-h * 0.35, h * 0.35);
    const bh = h * r.range(0.5, 1);
    const bend = r.range(-0.6, 0.6) + lean;
    g.strokeStyle = r.pick(colors);
    g.lineWidth = r.range(1, 2.4);
    g.beginPath();
    g.moveTo(bx, y);
    g.quadraticCurveTo(bx + bend * bh * 0.3, y - bh * 0.6, bx + bend * bh * 0.7, y - bh);
    g.stroke();
    if (tip && r() < 0.4) {
      g.strokeStyle = tip;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(bx + bend * bh * 0.45, y - bh * 0.78);
      g.lineTo(bx + bend * bh * 0.7, y - bh);
      g.stroke();
    }
  }
}

/** Dark rock mass with a warm rim from the light direction. */
function rockMass(g, r, { x, y, w, h, fill, rim, light = { x: 0.4, y: -1 }, n = 14 }) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    const rr = r.range(0.75, 1.05);
    pts.push([x + Math.cos(a) * w * 0.5 * rr, y + Math.sin(a) * h * rr]);
  }
  pts.push([x + w * 0.5, y + 40], [x - w * 0.5, y + 40]);
  poly(g, pts);
  g.fillStyle = vgrad(g, y - h, y + 20, [[0, shade(fill, 0.12)], [1, shade(fill, -0.35)]]);
  g.fill();
  // facets
  g.strokeStyle = rgba(shade(fill, -0.5), 0.5);
  g.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    const px = x + r.range(-w * 0.4, w * 0.4);
    g.beginPath();
    g.moveTo(px, y - h * r.range(0.4, 0.9));
    g.lineTo(px + r.range(-14, 14), y);
    g.stroke();
  }
  rimLight(g, pts.slice(0, n + 1), x + light.x * 900, y + light.y * 900, rim, 2.2, 0.85, false);
}

// ---------------------------------------------------------------------------------------------
// Zone: Brinegate Shore
// ---------------------------------------------------------------------------------------------

function buildShore(S) {
  const P = ZONE_PALETTES.shore;
  const r = makeRand(1101);
  const HZ = 300;
  const SH = 374;
  const SUN = { x: 640, y: 276, r: 84 };
  const steps = [];
  const skyStops = [[0, P.sky[0]], [0.42, P.sky[1]], [0.8, P.sky[2]], [1, P.sky[3]]];

  // --- sky ---
  const sky = layer(S, 0.02, -PAD_Y, HZ + 24);
  {
    const g = sky.g;
    g.fillStyle = vgrad(g, -PAD_Y, HZ, skyStops);
    g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 24 + PAD_Y);
    blob(g, -60, -30, 560, 320, '#15121f', 0.6);
    blob(g, W + 60, -30, 560, 320, '#15121f', 0.55);
    blob(g, SUN.x, HZ - 4, 820, 210, '#ffcf98', 0.5);
    blob(g, SUN.x, HZ, 380, 90, '#fff0c8', 0.55);
    strokes(g, r, {
      x: -PAD_X, y: -PAD_Y, w: W + PAD_X * 2, h: HZ + PAD_Y, n: 700, len: [50, 220], width: [2, 8], alpha: [0.05, 0.14],
      jitter: 0.06, curve: 0.05, color: (x, y) => shade(colorAt(skyStops, (y + PAD_Y) / (HZ + PAD_Y)), r.range(-0.14, 0.12)),
    });
    stars(g, r, 110, -PAD_Y, 150, 0.75);
    strokes(g, r, { x: 60, y: 40, w: 1160, h: 90, n: 70, len: [90, 280], width: [1, 3], alpha: [0.08, 0.2], color: ['#b0707a', '#8a5a70', '#c98a86', '#e0a090'], angle: -0.04, jitter: 0.06, curve: 0.2 });
    const lit = '#ffc79a';
    cloudBank(g, r, { x: 800, y: 112, w: 480, h: 34, body: '#4a3552', lit: '#e8a08a', alpha: 0.7, lobes: 7 });
    cloudBank(g, r, { x: 290, y: 168, w: 600, h: 58, body: '#553a58', lit, alpha: 0.95 });
    cloudBank(g, r, { x: 1020, y: 184, w: 680, h: 66, body: '#583c5a', lit: '#ffcf9f', lobes: 6 });
    cloudBank(g, r, { x: 80, y: 238, w: 460, h: 36, body: '#7a4f62', lit: '#ffd8a8', light: { x: 0.4, y: 1 } });
    cloudBank(g, r, { x: 1210, y: 248, w: 420, h: 34, body: '#7d5264', lit: '#ffd8a8', light: { x: -0.4, y: 1 } });
    cloudBank(g, r, { x: 470, y: 226, w: 260, h: 18, body: '#8a5a66', lit: '#ffe0b0', alpha: 0.8, light: { x: 0.6, y: 1 } });
    gulls(g, [[468, 150], [502, 138, 0.8], [529, 161, 0.9], [858, 118, 0.8], [884, 131, 0.7], [1012, 92, 0.6], [300, 110, 0.6]]);
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 24 + PAD_Y, 0.05);
  }
  steps.push(sky);
  steps.push(anim(0.02, (ctx, t) => drawCorona(ctx, SUN.x, SUN.y, SUN.r, t, '#ffe2a8', 0.55)));
  steps.push(sunLayer(S, 0.02, SUN, { color: P.sun, detail: 0.42, numerals: false }, (g) => {
    const rr = makeRand(1107);
    cloudBank(g, rr, { x: SUN.x - 30, y: SUN.y + 4, w: 230, h: 16, body: '#e8a07e', lit: '#fff2d6', light: { x: 0, y: -1 }, alpha: 0.8 });
    cloudBank(g, rr, { x: SUN.x + 50, y: SUN.y - 30, w: 140, h: 10, body: '#f0b08a', lit: '#fff6e0', light: { x: 0, y: -1 }, alpha: 0.55 });
  }));

  // --- sea + islands ---
  const far = layer(S, 0.06, 110, 404);
  {
    const g = far.g;
    g.fillStyle = vgrad(g, HZ - 2, 400, [[0, '#f3bd92'], [0.08, '#d9a08a'], [0.3, '#8a7c8e'], [0.58, '#4a6472'], [0.85, '#2e4e5e'], [1, '#44606a']]);
    g.fillRect(-PAD_X, HZ - 2, W + PAD_X * 2, 404 - HZ + 2);
    blob(g, SUN.x, HZ + 3, 500, 26, '#ffe2b0', 0.8);
    blob(g, SUN.x, HZ + 34, 240, 64, '#ffd9a8', 0.32);
    for (let i = 0; i < 820; i++) {
      const v = Math.pow(r(), 1.8);
      const y = HZ + 1 + v * 100;
      const len = (6 + v * 70) * r.range(0.5, 1.25);
      const col = v > 0.3
        ? r.pick(['#4f7f8c', '#2f5a6a', '#6a8a94', '#b88a8a', '#23485a', '#7a9aa0', '#9a8a9a'])
        : r.pick(['#f7c9a0', '#d9967e', '#a89aa8', '#b88a86', '#e8b8a0']);
      g.strokeStyle = rgba(col, r.range(0.18, 0.5));
      g.lineWidth = 0.8 + v * 2.6;
      const x = r.range(-PAD_X, W + PAD_X);
      g.beginPath();
      g.moveTo(x - len / 2, y);
      g.quadraticCurveTo(x, y - 0.6 - v, x + len / 2, y);
      g.stroke();
    }
    for (let i = 0; i < 340; i++) {
      const v = Math.pow(r(), 1.2);
      const y = HZ + 1 + v * 96;
      const x = SUN.x + r.gauss() * (16 + v * 140);
      const len = 3 + v * 28;
      g.strokeStyle = rgba(v < 0.4 ? '#fff4d8' : '#ffdcae', r.range(0.3, 0.85));
      g.lineWidth = 0.7 + v * 1.8;
      g.beginPath();
      g.moveTo(x - len / 2, y);
      g.lineTo(x + len / 2, y);
      g.stroke();
    }
    const farFill = '#8e5d64';
    const rimC = '#ffcf9a';
    // left headland with the broken lighthouse
    const left = ridge(r, -PAD_X, 390, (u) => {
      if (u < 0.12) return lerp(190, 208, u / 0.12);
      if (u < 0.6) return 208 + Math.sin(u * 20) * 3;
      return lerp(208, HZ + 1, Math.pow((u - 0.6) / 0.4, 0.75));
    }, 48, 5);
    const leftPoly = [[-PAD_X, HZ + 2], ...left, [390, HZ + 2]];
    poly(g, leftPoly);
    g.fillStyle = vgrad(g, 190, HZ, [[0, shade(farFill, -0.14)], [1, mix(farFill, '#e8a48a', 0.4)]]);
    g.fill();
    g.save();
    poly(g, leftPoly);
    g.clip();
    strokes(g, r, { x: -PAD_X, y: 196, w: 460, h: 104, n: 160, len: [10, 46], width: [1, 3.5], alpha: [0.08, 0.22], color: ['#6a4250', '#b07a78', '#9a6a6e', '#d8a08a'], angle: 0.5, jitter: 1 });
    g.restore();
    rimLight(g, left, SUN.x, SUN.y - 90, rimC, 2, 0.75, false);
    lighthouse(g, r, { x: 170, base: 210, h: 132, w: 38, broken: true, fill: '#7a4d58', band: '#5a3444', rim: rimC, sunX: SUN.x });
    // right rock stack with an intact, unlit lighthouse
    const right = ridge(r, 990, W + PAD_X, (u) => (u < 0.3 ? lerp(HZ + 1, 232, Math.pow(u / 0.3, 0.6)) : 232 - Math.sin(u * 9) * 5 - (u - 0.3) * 22), 38, 5);
    const rightPoly = [[990, HZ + 2], ...right, [W + PAD_X, HZ + 2]];
    poly(g, rightPoly);
    g.fillStyle = vgrad(g, 206, HZ, [[0, shade(farFill, -0.2)], [1, mix(farFill, '#e8a48a', 0.34)]]);
    g.fill();
    g.save();
    poly(g, rightPoly);
    g.clip();
    strokes(g, r, { x: 980, y: 206, w: 380, h: 96, n: 120, len: [10, 46], width: [1, 3.5], alpha: [0.08, 0.22], color: ['#6a4250', '#b07a78', '#9a6a6e'], angle: -0.5, jitter: 1 });
    g.restore();
    rimLight(g, right, SUN.x, SUN.y - 90, rimC, 2, 0.75, false);
    lighthouse(g, r, { x: 1150, base: 228, h: 84, w: 26, broken: false, fill: '#744a56', band: '#553242', rim: rimC, sunX: SUN.x });
    // islets
    for (const [ix, iw, ih] of [[520, 44, 4], [940, 34, 3], [300, 26, 2]]) {
      g.fillStyle = mix(farFill, '#e8a48a', 0.45);
      g.beginPath();
      g.ellipse(ix, HZ + 1, iw / 2, ih, 0, Math.PI, TAU);
      g.fill();
    }
    // a wrecked ship of an earlier expedition, listing on the horizon (hazy with distance)
    {
      const haze = mix(farFill, '#e8a48a', 0.38);
      const hazeDark = mix(farFill, '#e8a48a', 0.18);
      g.save();
      g.translate(846, HZ + 2);
      g.rotate(-0.12);
      // hull with a broken, gaping bow
      g.fillStyle = hazeDark;
      g.beginPath();
      g.moveTo(-66, 0);
      g.quadraticCurveTo(-70, -12, -60, -16);
      g.lineTo(18, -13);
      g.lineTo(26, -20); g.lineTo(32, -9); g.lineTo(40, -17); g.lineTo(46, -6);
      g.quadraticCurveTo(58, -4, 62, 0);
      g.closePath();
      g.fill();
      // exposed ribs where the planking gave way
      g.strokeStyle = hazeDark;
      g.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        const rx = 22 + i * 7;
        g.beginPath();
        g.moveTo(rx, -8);
        g.quadraticCurveTo(rx + 2, -18 - (i % 2) * 4, rx - 1, -24 - (i % 3) * 3);
        g.stroke();
      }
      // masts: one snapped, one leaning with its yard, rigging hanging slack
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(-34, -15); g.lineTo(-40, -74);
      g.moveTo(-54, -62); g.lineTo(-24, -58);
      g.moveTo(-4, -14); g.lineTo(6, -46); g.lineTo(4, -52);
      g.stroke();
      g.lineWidth = 0.8;
      g.strokeStyle = rgba(hazeDark, 0.85);
      g.beginPath();
      g.moveTo(-40, -74); g.quadraticCurveTo(-10, -40, 56, -3);
      g.moveTo(-40, -74); g.quadraticCurveTo(-58, -40, -64, -8);
      g.moveTo(-24, -58); g.quadraticCurveTo(-22, -40, -18, -30);
      g.moveTo(6, -46); g.quadraticCurveTo(24, -30, 44, -8);
      g.stroke();
      // a torn sail rag catching the last light
      g.fillStyle = rgba('#f4d4b4', 0.55);
      g.beginPath();
      g.moveTo(-52, -61); g.lineTo(-27, -57); g.lineTo(-30, -44); g.lineTo(-36, -48); g.lineTo(-42, -38); g.lineTo(-46, -46);
      g.closePath();
      g.fill();
      g.strokeStyle = rgba(rimC, 0.75);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-60, -16); g.lineTo(18, -13);
      g.moveTo(-40, -74); g.lineTo(-37, -40);
      g.stroke();
      g.restore();
      // its reflection, broken by the swell
      g.fillStyle = rgba(haze, 0.35);
      for (let k = 0; k < 6; k++) g.fillRect(790 + r.range(-6, 6), HZ + 4 + k * 4, 110 - k * 12, 1.6);
    }
    // reflections of the headlands
    g.save();
    g.globalAlpha = 0.26;
    g.translate(0, (HZ + 2) * 2);
    g.scale(1, -1);
    poly(g, leftPoly);
    g.fillStyle = '#6a4450';
    g.fill();
    poly(g, rightPoly);
    g.fill();
    g.restore();
    strokes(g, r, { x: -PAD_X, y: HZ + 4, w: W + PAD_X * 2, h: 62, n: 260, len: [10, 50], width: [1, 2], alpha: [0.15, 0.35], color: ['#e8a888', '#5f8791', '#c98d7c', '#8f8494'], jitter: 0.02, curve: 0.02, where: (x) => x < 390 || x > 990 });
    // shallows: lighter water hugging the beach
    g.fillStyle = vgrad(g, SH - 26, SH + 4, [[0, rgba('#9aa4a0', 0)], [1, rgba('#c0b8a8', 0.28)]]);
    g.fillRect(-PAD_X, SH - 26, W + PAD_X * 2, 30);
    grain(g, -PAD_X, 110, W + PAD_X * 2, 294, 0.05);
  }
  steps.push(far);
  const glints = makeGlints(makeRand(12), 80, { cx: SUN.x, spread: [10, 150], y0: HZ + 2, y1: SH - 8 });
  steps.push(anim(0.06, (ctx, t) => drawGlints(ctx, glints, t, 0.95)));

  // --- beach ---
  const ground = layer(S, 0.18, 340, H + PAD_Y);
  const shore = (x) => SH + Math.sin(x * 0.011) * 3 + Math.sin(x * 0.037 + 1) * 1.6;
  {
    const g = ground.g;
    g.beginPath();
    g.moveTo(-PAD_X, shore(-PAD_X));
    for (let x = -PAD_X; x <= W + PAD_X; x += 16) g.lineTo(x, shore(x));
    g.lineTo(W + PAD_X, H + PAD_Y);
    g.lineTo(-PAD_X, H + PAD_Y);
    g.closePath();
    g.fillStyle = vgrad(g, SH - 6, H + PAD_Y, [[0, '#8a7068'], [0.06, '#a8886e'], [0.15, '#d2aa80'], [0.38, '#c89c76'], [0.68, '#9c7462'], [1, '#4e3a3c']]);
    g.fill();
    // wet sand mirrors the sky and the sun
    strokes(g, r, { x: -PAD_X, y: SH, w: W + PAD_X * 2, h: 32, n: 300, len: [20, 100], width: [1, 3], alpha: [0.1, 0.28], color: ['#e9a88a', '#f3c98b', '#8f6f7a', '#fff0d0', '#b88a86'], jitter: 0.02, curve: 0.03 });
    blob(g, SUN.x, SH + 14, 120, 18, '#ffecc0', 0.65);
    strokes(g, r, { x: SUN.x - 80, y: SH + 2, w: 160, h: 34, n: 90, len: [6, 34], width: [1, 2.2], alpha: [0.3, 0.75], color: ['#fff2d6', '#ffe0b0'], jitter: 0.02 });
    // broad tonal passages: sunlit swathe, cool violet shadows in the dips
    blob(g, SUN.x, 460, 600, 110, '#ffd9a0', 0.2);
    for (const [x, y, rx, ry, c, a] of [
      [220, 470, 260, 60, '#d8b88a', 0.22], [1060, 450, 280, 56, '#d8b88a', 0.2], [640, 600, 420, 70, '#8a6a6a', 0.16],
      [120, 620, 300, 90, '#6a5060', 0.26], [1180, 610, 300, 90, '#6a5060', 0.26], [880, 540, 200, 40, '#e8c898', 0.14],
    ]) blob(g, x, y, rx, ry, c, a);
    blob(g, -80, 720, 560, 280, '#2b2340', 0.5);
    blob(g, W + 80, 720, 560, 280, '#2b2340', 0.5);
    // horizontal paint texture that follows the ground plane
    strokes(g, r, {
      x: -PAD_X, y: SH + 24, w: W + PAD_X * 2, h: H - SH, n: 900, len: [20, 90], width: [1.5, 5], alpha: [0.04, 0.1],
      color: ['#e8cfa0', '#8a6a4e', '#f3dcae', '#a07a60', '#c8a0a0'], jitter: 0.05, curve: 0.05,
    });
    dabs(g, r, { x: -PAD_X, y: SH + 20, w: W + PAD_X * 2, h: H - SH, n: 2600, size: [0.5, 1.8], alpha: [0.08, 0.22], color: ['#e8cfa0', '#7a5e46', '#f3dcae', '#8a6a4e'], squash: 0.7 });
    // wind ripples: faint in the floor band, clearer toward the frame
    for (let i = 0; i < 170; i++) {
      const x = r.range(-PAD_X, W + PAD_X);
      const y = r.range(SH + 30, H + 20);
      const inBand = y > 380 && y < 640 && x > 160 && x < 1120;
      const a = inBand ? 0.05 : 0.16;
      const len = r.range(30, 90) * (0.6 + (y - SH) / 400);
      g.lineWidth = 1.2;
      g.strokeStyle = rgba('#f6e2b8', a);
      g.beginPath();
      g.moveTo(x - len / 2, y);
      g.quadraticCurveTo(x, y - 3, x + len / 2, y);
      g.stroke();
      g.strokeStyle = rgba('#6a5040', a * 0.9);
      g.beginPath();
      g.moveTo(x - len / 2, y + 2);
      g.quadraticCurveTo(x, y - 1, x + len / 2, y + 2);
      g.stroke();
    }
    // tide pools holding the sky at the margins (clear of the actor columns): irregular, soft-edged
    for (const [x, y, rx, ry] of [[112, 506, 62, 8], [1176, 474, 70, 9], [1226, 566, 44, 6], [64, 600, 38, 5]]) {
      blob(g, x, y + 1, rx * 1.35, ry * 2.2, '#6a5048', 0.28);
      const lobes = [];
      for (let k = 0; k < 5; k++) lobes.push([x + r.range(-0.55, 0.55) * rx, y + r.range(-0.3, 0.3) * ry, rx * r.range(0.35, 0.6), ry * r.range(0.6, 1)]);
      g.save();
      g.beginPath();
      for (const [lx, ly, lrx, lry] of lobes) { g.moveTo(lx + lrx, ly); g.ellipse(lx, ly, lrx, lry, 0, 0, TAU); }
      g.clip();
      g.globalAlpha = 0.62;
      g.fillStyle = vgrad(g, y - ry * 1.2, y + ry * 1.2, [[0, '#7a5a70'], [0.5, '#d9937a'], [1, '#f3c98b']]);
      g.fillRect(x - rx * 1.2, y - ry * 1.5, rx * 2.4, ry * 3);
      g.globalAlpha = 1;
      strokes(g, r, { x: x - rx, y: y - ry, w: rx * 2, h: ry * 2, n: 10, len: [6, 22], width: [1, 1.8], alpha: [0.25, 0.6], color: ['#fff0d0', '#ffd9a8'], jitter: 0.02 });
      g.restore();
    }
    // the sun's path continues across the wet sand as broken glitter
    for (let i = 0; i < 70; i++) {
      const v = Math.pow(r(), 1.4);
      const y = SH + 8 + v * 70;
      const x = SUN.x + r.gauss() * (20 + v * 60);
      g.strokeStyle = rgba('#fff0d0', r.range(0.12, 0.4) * (1 - v));
      g.lineWidth = r.range(1, 2);
      g.beginPath();
      g.moveTo(x - 4 - v * 10, y);
      g.lineTo(x + 4 + v * 10, y);
      g.stroke();
    }
    // footprints of those who came before, fading toward the sea
    for (let i = 0; i < 26; i++) {
      const u = i / 25;
      const x = lerp(560, 700, u) + Math.sin(u * 5) * 26 + (i % 2 ? 7 : -7);
      const y = lerp(716, SH + 18, Math.pow(u, 0.85));
      const s = lerp(1.25, 0.45, u);
      g.fillStyle = rgba('#6a5040', 0.2 * (1 - u * 0.6));
      g.beginPath();
      g.ellipse(x, y, 4.2 * s, 2 * s, 0.25, 0, TAU);
      g.fill();
      g.fillStyle = rgba('#f0dcb0', 0.14 * (1 - u * 0.6));
      g.beginPath();
      g.ellipse(x + 1 * s, y - 1.6 * s, 4 * s, 1 * s, 0.25, 0, Math.PI, true);
      g.fill();
    }
    // foam lace at the waterline
    for (let k = 0; k < 4; k++) {
      g.strokeStyle = rgba('#fff6e6', 0.55 - k * 0.11);
      g.lineWidth = 2.2 - k * 0.4;
      g.beginPath();
      for (let x = -PAD_X; x <= W + PAD_X; x += 8) {
        const y = shore(x) - 2 + k * 3 + Math.sin(x * 0.05 + k * 2) * 1.2;
        if (x === -PAD_X) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    dabs(g, r, { x: -PAD_X, y: SH - 6, w: W + PAD_X * 2, h: 12, n: 420, size: [1, 3], alpha: [0.2, 0.5], color: '#fff6e6', squash: 0.4, rotJ: 0.2 });
    // old pier pilings receding into the water (far left, clear of the party)
    const pil = [[16, 452, 13, 112, 3], [58, 422, 11, 90, 2], [94, 402, 9, 70, 2], [122, 388, 7, 52, 1], [144, 378, 5, 38, 1]];
    for (const [x, b, w, h, lean] of pil) {
      g.fillStyle = rgba('#2a1c20', 0.25);
      g.beginPath();
      g.ellipse(x + 3, b + 2, w * 1.4, 3, 0, 0, TAU);
      g.fill();
      post(g, x, b, w, h, lean, '#3a2a2c', '#ffc79a');
    }
    g.strokeStyle = rgba('#3a2a2c', 0.9);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(10, 360); g.lineTo(150, 344);
    g.stroke();
    // shells and pebbles at the margins
    dabs(g, r, {
      x: -PAD_X, y: 400, w: W + PAD_X * 2, h: 340, n: 170, size: [1.5, 4], alpha: [0.5, 0.9], color: ['#f2e2c8', '#d9b89a', '#7a6a60', '#e8cbb0'], squash: 0.6,
      where: (x, y) => x < 170 || x > 1110 || y > 650,
    });
    grain(g, -PAD_X, 340, W + PAD_X * 2, H + PAD_Y - 340, 0.06);
  }
  steps.push(ground);
  steps.push(anim(0.18, (ctx, t) => {
    // the frozen tide still breathes a little at the waterline
    const k = Math.sin(t * 0.0007);
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 2; j++) {
      ctx.strokeStyle = rgba('#fff4e0', 0.22 - j * 0.08 + k * 0.05);
      ctx.lineWidth = 1.6 - j * 0.5;
      ctx.beginPath();
      for (let x = -PAD_X; x <= W + PAD_X; x += 16) {
        const y = shore(x) + 3 + k * 3 + j * 5 + Math.sin(x * 0.03 + t * 0.0005 + j) * 1.5;
        if (x === -PAD_X) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }));

  // --- foreground framing: rocks, dune grass, the broken boat ---
  const fore = layer(S, 0.3, 540, H + PAD_Y);
  {
    const g = fore.g;
    // low dunes along the bottom edge
    const dune = (x) => 700 - Math.sin(x * 0.006 + 1) * 12 - Math.sin(x * 0.017) * 5 - Math.pow(Math.abs(x - 640) / 640, 2) * 26;
    g.beginPath();
    g.moveTo(-PAD_X, H + PAD_Y);
    for (let x = -PAD_X; x <= W + PAD_X; x += 16) g.lineTo(x, dune(x));
    g.lineTo(W + PAD_X, H + PAD_Y);
    g.closePath();
    g.fillStyle = vgrad(g, 660, H + PAD_Y, [[0, '#9a7a60'], [0.4, '#6a5046'], [1, '#2e2226']]);
    g.fill();
    strokes(g, r, { x: -PAD_X, y: 680, w: W + PAD_X * 2, h: 80, n: 260, len: [16, 60], width: [1.5, 4], alpha: [0.08, 0.2], color: ['#c8a080', '#4a3432', '#e8c098'], jitter: 0.08, where: (x, y) => y > dune(x) + 3 });
    g.strokeStyle = rgba('#ffd9a8', 0.5);
    g.lineWidth = 1.6;
    g.beginPath();
    for (let x = -PAD_X; x <= W + PAD_X; x += 16) {
      if (x === -PAD_X) g.moveTo(x, dune(x)); else g.lineTo(x, dune(x));
    }
    g.stroke();
    // shells and a starfish on the dune crest
    dabs(g, r, { x: 360, y: 694, w: 560, h: 20, n: 26, size: [1.5, 3.5], alpha: [0.6, 0.95], color: ['#f2e2c8', '#e8cbb0', '#d9a88a'], squash: 0.6, where: (x, y) => Math.abs(y - dune(x) - 6) < 8 });
    g.save();
    g.translate(760, dune(760) + 8);
    g.rotate(0.3);
    g.fillStyle = '#d9836a';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const rr = i % 2 ? 2.6 : 7;
      if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.6); else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.6);
    }
    g.closePath();
    g.fill();
    g.restore();
    rockMass(g, r, { x: 34, y: 750, w: 330, h: 110, fill: '#2e2428', rim: '#f0b080', light: { x: 0.7, y: -1 } });
    rockMass(g, r, { x: 200, y: 758, w: 190, h: 60, fill: '#352a2c', rim: '#f0b080', light: { x: 0.7, y: -1 } });
    for (let i = 0; i < 22; i++) {
      const x = r.range(-40, 190);
      const y = r.range(660, 700);
      g.strokeStyle = rgba(r.pick(['#3a4a2a', '#4a3a22', '#2a3a2a', '#5a5030']), 0.9);
      g.lineWidth = r.range(1.5, 3.2);
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + r.range(-10, 10), y + 16, x + r.range(-14, 14), y + 30, x + r.range(-8, 8), y + r.range(36, 60));
      g.stroke();
    }
    for (let i = 0; i < 9; i++) tuft(g, r, r.range(-30, 330), r.range(700, 718), r.range(26, 46), 14, ['#8a7a48', '#a8904a', '#6a5a38', '#c0a060'], '#ffd9a0', 0.35);
    // half-buried anchor
    g.save();
    g.translate(300, 712);
    g.rotate(0.5);
    g.strokeStyle = '#3a2c2a';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, -46); g.lineTo(0, 10);
    g.moveTo(-18, -32); g.lineTo(18, -32);
    g.stroke();
    g.beginPath();
    g.arc(0, -52, 7, 0, TAU);
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = rgba('#ffc79a', 0.6);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(3, -44); g.lineTo(3, 8);
    g.stroke();
    g.restore();
    // broken rowboat, half buried (bottom right)
    g.save();
    g.translate(1176, 694);
    g.rotate(-0.12);
    g.scale(1.25, 1.25);
    g.fillStyle = '#3a2a24';
    g.beginPath();
    g.moveTo(-120, -10);
    g.quadraticCurveTo(0, 50, 130, -22);
    g.lineTo(118, -34);
    g.quadraticCurveTo(0, 20, -110, -24);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba('#6a4a38', 0.9);
    g.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.moveTo(-112 + k * 4, -18 + k * 5);
      g.quadraticCurveTo(0, 26 + k * 6, 122 - k * 4, -30 + k * 5);
      g.stroke();
    }
    g.strokeStyle = rgba('#ffc79a', 0.7);
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(-110, -24);
    g.quadraticCurveTo(0, 20, 118, -34);
    g.stroke();
    g.strokeStyle = '#2a1c18';
    g.lineWidth = 4;
    for (const [x, h] of [[-40, 30], [-10, 40], [22, 34]]) {
      g.beginPath();
      g.moveTo(x, 10);
      g.quadraticCurveTo(x + 6, -h * 0.6, x + 2, -h);
      g.stroke();
    }
    g.restore();
    // driftwood
    g.fillStyle = '#4a3a30';
    g.beginPath();
    g.moveTo(900, 716); g.quadraticCurveTo(980, 702, 1060, 710); g.lineTo(1062, 719); g.quadraticCurveTo(980, 715, 902, 724);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba('#e8b888', 0.6);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(904, 716); g.quadraticCurveTo(980, 702, 1058, 710);
    g.stroke();
    for (let i = 0; i < 8; i++) tuft(g, r, r.range(1040, 1330), r.range(700, 720), r.range(24, 44), 12, ['#8a7a48', '#a8904a', '#6a5a38', '#c0a060'], '#ffd9a0', -0.35);
    grain(g, -PAD_X, 540, W + PAD_X * 2, H + PAD_Y - 540, 0.07);
  }
  steps.push(fore);
  const spray = makeMotes(makeRand(13), 26, { y0: 150, y1: 700, vx: [4, 14], vy: [-8, -2], size: [0.8, 1.8], colors: ['#fff0d0', '#ffd9a8'] });
  steps.push(anim(0.3, (ctx, t) => drawMotes(ctx, spray, t, 0.55)));
  steps.push(vignette(S, '#140e18', 0.55, 0.3));
  return steps;
}

// ---------------------------------------------------------------------------------------------
// Zone: the Gilded Thicket
// ---------------------------------------------------------------------------------------------

function trunk(g, r, { x, base, top = -PAD_Y, w, lean = 0, fill, dark, rim, lightX, roots = true, knots = true }) {
  const h = base - top;
  const L = [], R = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const u = i / n; // 0 = base
    const y = base - h * u;
    const flare = roots ? Math.pow(1 - Math.min(1, u * 5), 2) * w * 0.55 : 0;
    const half = w * (0.5 - u * 0.12) + flare;
    const cx = x + lean * u * h * 0.1 + Math.sin(u * 5 + x) * w * 0.06;
    L.push([cx - half + (r() - 0.5) * 1.5, y]);
    R.push([cx + half + (r() - 0.5) * 1.5, y]);
  }
  const pts = [...L, ...R.reverse()];
  poly(g, pts);
  const lit = lightX > x ? 1 : -1;
  const gr = g.createLinearGradient(x - w, 0, x + w, 0);
  gr.addColorStop(0, lit > 0 ? dark : shade(fill, 0.08));
  gr.addColorStop(0.5, fill);
  gr.addColorStop(1, lit > 0 ? shade(fill, 0.08) : dark);
  g.fillStyle = gr;
  g.fill();
  // bark
  g.save();
  poly(g, pts);
  g.clip();
  strokes(g, r, { x: x - w * 1.2, y: top, w: w * 2.4, h, n: Math.round(h * w * 0.012), len: [14, 50], width: [1, 2.6], alpha: [0.12, 0.35], color: [dark, shade(fill, -0.3), shade(fill, 0.15)], angle: Math.PI / 2, jitter: 0.25, curve: 0.3 });
  if (knots) {
    for (let k = 0; k < 2; k++) {
      const ky = r.range(top + h * 0.2, base - h * 0.25);
      g.strokeStyle = rgba(dark, 0.6);
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(x + r.range(-w * 0.2, w * 0.2), ky, w * 0.14, w * 0.24, 0, 0, TAU);
      g.stroke();
    }
  }
  g.restore();
  // rim light along the lit side
  const side = lit > 0 ? R.slice().reverse() : L;
  g.strokeStyle = rgba(rim, 0.75);
  g.lineWidth = Math.max(1.2, w * 0.06);
  g.beginPath();
  g.moveTo(side[0][0], side[0][1]);
  for (let i = 1; i < side.length; i++) g.lineTo(side[i][0] - lit * 1, side[i][1]);
  g.stroke();
}

function foliage(g, r, { cx, cy, rx, ry, n, colors, lit, shadow, lightX, lightY, size = [4, 10], alpha = [0.5, 0.9] }) {
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    const d = Math.sqrt(r());
    const x = cx + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d;
    const dx = lightX - cx, dy = lightY - cy;
    const dl = Math.hypot(dx, dy) || 1;
    const facing = (Math.cos(a) * dx + Math.sin(a) * dy) / dl * d;
    let col = r.pick(colors);
    if (facing > 0.45 && r() < facing) col = lit;
    else if (facing < -0.3 && r() < -facing) col = shadow;
    const s = r.range(size[0], size[1]);
    g.fillStyle = rgba(col, r.range(alpha[0], alpha[1]));
    g.beginPath();
    g.ellipse(x, y, s, s * 0.5, r.range(-1.2, 1.2), 0, TAU);
    g.fill();
  }
}

/**
 * A soft light shaft from a top span (x ± w) to a bottom span (bx ± bw), faded across its width and
 * toward both ends. Painted at half resolution (it is pure soft light).
 */
function shaftSprite(S, x, w, bx, bw, y0, y1, color, peak) {
  const x0 = Math.min(x - w, bx - bw) - 40;
  const x1 = Math.max(x + w, bx + bw) + 40;
  const L = layer(S, 0, y0, y1, 0.35, x0, x1);
  const g = L.g;
  // soft profile across the shaft axis
  const ax = bx - x, ay = y1 - y0;
  const al = Math.hypot(ax, ay) || 1;
  const nx = -ay / al, ny = ax / al;
  const cx = (x + bx) / 2, cy = (y0 + y1) / 2;
  const hw = (w + bw) / 2;
  const across = g.createLinearGradient(cx - nx * hw * 1.25, cy - ny * hw * 1.25, cx + nx * hw * 1.25, cy + ny * hw * 1.25);
  across.addColorStop(0, rgba(color, 0));
  across.addColorStop(0.3, rgba(color, peak * 0.55));
  across.addColorStop(0.5, rgba(color, peak));
  across.addColorStop(0.7, rgba(color, peak * 0.55));
  across.addColorStop(1, rgba(color, 0));
  g.fillStyle = across;
  g.beginPath();
  g.moveTo(x - w * 1.3, y0);
  g.lineTo(x + w * 1.3, y0);
  g.lineTo(bx + bw * 1.3, y1);
  g.lineTo(bx - bw * 1.3, y1);
  g.closePath();
  g.fill();
  // fade in from the canopy and out before the floor's front edge
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = vgrad(g, y0, y1, [[0, 'rgba(0,0,0,0)'], [0.22, 'rgba(0,0,0,0.85)'], [0.6, 'rgba(0,0,0,1)'], [0.85, 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']]);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.globalCompositeOperation = 'source-over';
  return L;
}

/** A branch that tapers from `w0` to `w1` along a quadratic curve, with a thin rim on its upper edge. */
function taperedBranch(g, x0, y0, cx, cy, x1, y1, w0, w1, fill, rim) {
  const n = 16;
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    const px = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const py = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    const tx = 2 * mt * (cx - x0) + 2 * t * (x1 - cx);
    const ty = 2 * mt * (cy - y0) + 2 * t * (y1 - cy);
    const tl = Math.hypot(tx, ty) || 1;
    let nx = -ty / tl, ny = tx / tl;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const hw = lerp(w0, w1, t) / 2;
    top.push([px + nx * hw, py + ny * hw]);
    bot.push([px - nx * hw, py - ny * hw]);
  }
  poly(g, [...top, ...bot.reverse()]);
  g.fillStyle = fill;
  g.fill();
  if (rim) {
    g.strokeStyle = rgba(rim, 0.45);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(top[0][0], top[0][1]);
    for (const p of top) g.lineTo(p[0], p[1]);
    g.stroke();
  }
}

/** Big framing tree at the frame edge: flared roots, bark, branch arms, moss and a broken warm rim. */
function framingTree(g, r, { x, w, lightX, dir }) {
  const top = -PAD_Y;
  const base = H + PAD_Y;
  const L = [], R = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const u = i / n; // 0 = top
    const y = lerp(top, base, u);
    const flare = Math.pow(Math.max(0, (u - 0.72) / 0.28), 2.2) * w * 0.9;
    const half = w * 0.5 * (0.86 + u * 0.14) + flare;
    const cx = x + Math.sin(u * 3.2 + x * 0.01) * w * 0.12 * dir;
    L.push([cx - half - (dir < 0 ? flare * 0.3 : 0), y]);
    R.push([cx + half + (dir > 0 ? flare * 0.3 : 0), y]);
  }
  const pts = [...L, ...R.slice().reverse()];
  poly(g, pts);
  const gr = g.createLinearGradient(x - w, 0, x + w, 0);
  gr.addColorStop(0, dir > 0 ? '#140c06' : '#4a3620');
  gr.addColorStop(0.55, '#35261a');
  gr.addColorStop(1, dir > 0 ? '#4a3620' : '#140c06');
  g.fillStyle = gr;
  g.fill();
  g.save();
  poly(g, pts);
  g.clip();
  strokes(g, r, { x: x - w * 1.6, y: top, w: w * 3.2, h: base - top, n: 520, len: [18, 70], width: [1.5, 4], alpha: [0.12, 0.35], color: ['#140c06', '#5a4428', '#2a1c10', '#6a5030'], angle: Math.PI / 2, jitter: 0.2, curve: 0.35 });
  for (let k = 0; k < 4; k++) {
    const ky = r.range(120, 560);
    g.strokeStyle = rgba('#120a04', 0.6);
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(x + r.range(-w * 0.2, w * 0.2), ky, w * 0.1, w * 0.2, 0, 0, TAU);
    g.stroke();
  }
  // moss creeping up the shaded side
  dabs(g, r, { x: x - w, y: 300, w: w * 2, h: 440, n: 220, size: [2, 6], alpha: [0.25, 0.6], color: ['#5a6a28', '#7a8a38', '#3a4a18'], squash: 0.6, where: (px, py) => (px - x) * dir < -w * 0.05 && py > 360 + r() * 140 });
  g.restore();
  // broken rim light on the lit edge
  const edge = dir > 0 ? R : L;
  for (let i = 0; i < edge.length - 1; i++) {
    if (r() < 0.35) continue;
    g.strokeStyle = rgba('#ffd98a', r.range(0.25, 0.7));
    g.lineWidth = r.range(1.2, 3);
    g.beginPath();
    g.moveTo(edge[i][0] - dir * 1.5, edge[i][1]);
    g.lineTo(edge[i + 1][0] - dir * 1.5, edge[i + 1][1]);
    g.stroke();
  }
  // branch arms reaching into the canopy
  for (const [y0, len, lift] of [[46, 200, 80], [128, 140, 46]]) {
    const x0 = x + dir * w * 0.3;
    taperedBranch(g, x0, y0 + 50, x0 + dir * len * 0.2, y0 - lift * 1.1, x0 + dir * len, y0 - lift * 0.7, w * 0.3, 4, '#2e2014', '#ffd98a');
    taperedBranch(g, x0 + dir * len * 0.55, y0 - lift * 0.75, x0 + dir * len * 0.7, y0 - lift * 1.3, x0 + dir * len * 0.62, y0 - lift * 1.7, 9, 2, '#2e2014', '#ffd98a');
  }
  // roots gripping the floor
  for (let k = 0; k < 3; k++) {
    const y0 = r.range(640, 700);
    const len = r.range(60, 120);
    const thick = r.range(9, 16);
    const x0 = x + dir * w * 0.45;
    const ex = x0 + dir * len;
    const ey = y0 + r.range(30, 60);
    g.fillStyle = '#2a1e12';
    g.beginPath();
    g.moveTo(x0, y0 - thick);
    g.quadraticCurveTo(x0 + dir * len * 0.55, y0 - thick * 0.3, ex, ey);
    g.quadraticCurveTo(x0 + dir * len * 0.45, y0 + thick * 0.8, x0, y0 + thick * 1.4);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba('#ffd98a', 0.35);
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(x0, y0 - thick);
    g.quadraticCurveTo(x0 + dir * len * 0.55, y0 - thick * 0.3, ex, ey);
    g.stroke();
  }
}

function buildThicket(S) {
  const P = ZONE_PALETTES.thicket;
  const r = makeRand(2202);
  const HZ = 336;
  const SUN = { x: 700, y: 262 };
  const steps = [];
  const skyStops = [[0, P.sky[0]], [0.35, P.sky[1]], [0.72, P.sky[2]], [1, P.sky[3]]];

  // --- glowing sky behind the canopy ---
  const sky = layer(S, 0.02, -PAD_Y, HZ + 40, 0.6);
  {
    const g = sky.g;
    g.fillStyle = vgrad(g, -PAD_Y, HZ, skyStops);
    g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 40 + PAD_Y);
    blob(g, SUN.x, SUN.y, 640, 430, '#ffe7ae', 0.62);
    blob(g, SUN.x, SUN.y, 160, 140, '#fff8e2', 0.95);
    strokes(g, r, { x: -PAD_X, y: -PAD_Y, w: W + PAD_X * 2, h: HZ + PAD_Y, n: 300, len: [40, 160], width: [3, 9], alpha: [0.05, 0.12], color: (x, y) => shade(colorAt(skyStops, (y + PAD_Y) / (HZ + PAD_Y)), r.range(-0.1, 0.12)), jitter: 0.2 });
  }
  steps.push(sky);

  // --- distant hazy forest ---
  const far = layer(S, 0.05, -PAD_Y, HZ + 30);
  {
    const g = far.g;
    for (let i = 0; i < 30; i++) {
      const x = r.range(-PAD_X, W + PAD_X);
      const w = r.range(6, 22);
      const haze = clamp(1 - Math.abs(x - SUN.x) / 700, 0, 1);
      const col = mix('#8a6a3a', '#f3d9a0', 0.4 + haze * 0.5);
      g.fillStyle = rgba(col, r.range(0.25, 0.55) * (1 - haze * 0.5));
      const b = HZ + r.range(-6, 6);
      g.beginPath();
      g.moveTo(x - w / 2, b);
      g.lineTo(x - w * 0.35, -PAD_Y);
      g.lineTo(x + w * 0.35, -PAD_Y);
      g.lineTo(x + w / 2, b);
      g.closePath();
      g.fill();
    }
    foliage(g, r, { cx: 640, cy: 30, rx: 900, ry: 150, n: 1700, colors: ['#d9b860', '#e8cd80', '#c9a44a', '#f0d890'], lit: '#fff0b8', shadow: '#a88a4a', lightX: SUN.x, lightY: SUN.y, size: [6, 16], alpha: [0.25, 0.55] });
    // distant undergrowth where the far trees meet the floor
    for (let i = 0; i < 70; i++) {
      const x = r.range(-PAD_X, W + PAD_X);
      const haze = clamp(1 - Math.abs(x - SUN.x) / 700, 0, 1);
      blob(g, x, HZ - r.range(0, 8), r.range(30, 70), r.range(10, 22), mix('#9a7a3a', '#f0d898', 0.35 + haze * 0.4), 0.55);
    }
    blob(g, 640, HZ - 8, 1000, 70, '#f7dc9a', 0.55);
    blob(g, SUN.x, HZ - 40, 440, 130, '#fff0c4', 0.4);
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 30 + PAD_Y, 0.04);
  }
  steps.push(far);

  // --- mid trees: warm, mid-value trunks (kept away from the actor columns) ---
  const mid = layer(S, 0.11, -PAD_Y, HZ + 60);
  {
    const g = mid.g;
    const trunks = [
      { x: 150, w: 28, base: HZ + 14 }, { x: 508, w: 34, base: HZ + 18 }, { x: 602, w: 16, base: HZ + 8 },
      { x: 784, w: 28, base: HZ + 16 }, { x: 1168, w: 38, base: HZ + 20 },
    ];
    for (const tk of trunks) {
      const haze = clamp(1 - Math.abs(tk.x - SUN.x) / 600, 0, 1);
      trunk(g, r, { ...tk, lean: r.range(-0.3, 0.3), fill: mix('#6a5230', '#b8955a', haze * 0.45), dark: mix('#3a2c18', '#7a6038', haze * 0.4), rim: '#ffe6a0', lightX: SUN.x });
      for (let k = 0; k < 2; k++) {
        const by = r.range(40, 170);
        const dir = r() < 0.5 ? -1 : 1;
        const reach = r.range(90, 150);
        taperedBranch(g, tk.x, by + 40, tk.x + dir * reach * 0.25, by - 20, tk.x + dir * reach, by - r.range(30, 60), tk.w * 0.32, 2, mix('#5a4428', '#a8884a', haze * 0.4), '#ffe6a0');
      }
      // soft fog pooling at each trunk base
      blob(g, tk.x, tk.base - 6, tk.w * 3, 16, '#f7dca0', 0.45);
    }
    for (let i = 0; i < 13; i++) {
      foliage(g, r, {
        cx: r.range(-PAD_X, W + PAD_X), cy: r.range(-24, 110), rx: r.range(120, 230), ry: r.range(55, 100), n: 440,
        colors: P.foliage, lit: '#f8dc80', shadow: '#6a5020', lightX: SUN.x, lightY: SUN.y, size: [4, 11], alpha: [0.55, 0.95],
      });
    }
    // gilded leaves hanging frozen mid-air
    for (let i = 0; i < 160; i++) {
      const x = r.range(-PAD_X, W + PAD_X);
      const y = r.range(110, HZ - 20);
      const sz = r.range(2.5, 5);
      if (r() < 0.25) blob(g, x, y, sz * 4, sz * 4, '#ffe8a0', 0.25);
      g.fillStyle = rgba(r.pick(['#f0c850', '#e3c15b', '#d89a40', '#fff0a0']), r.range(0.55, 0.95));
      g.beginPath();
      g.ellipse(x, y, sz, sz * 0.45, r.range(0, Math.PI), 0, TAU);
      g.fill();
    }
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 60 + PAD_Y, 0.05);
  }
  steps.push(mid);

  // --- forest floor: a carpet of fallen gold ---
  const ground = layer(S, 0.18, HZ - 24, H + PAD_Y);
  {
    const g = ground.g;
    const edge = (x) => HZ + 4 + Math.sin(x * 0.02) * 3 + Math.sin(x * 0.051 + 2) * 2;
    g.beginPath();
    g.moveTo(-PAD_X, edge(-PAD_X));
    for (let x = -PAD_X; x <= W + PAD_X; x += 16) g.lineTo(x, edge(x));
    g.lineTo(W + PAD_X, H + PAD_Y);
    g.lineTo(-PAD_X, H + PAD_Y);
    g.closePath();
    g.fillStyle = vgrad(g, HZ, H + PAD_Y, [[0, '#d8b860'], [0.1, '#b89a48'], [0.32, '#8a7a36'], [0.62, '#5c5424'], [0.85, '#3a3416'], [1, '#1c1a0b']]);
    g.fill();
    // soft transition: fog and undergrowth along the far edge
    blob(g, 640, HZ + 8, 1000, 26, '#f7dca0', 0.55);
    for (let i = 0; i < 60; i++) {
      const x = r.range(-PAD_X, W + PAD_X);
      g.fillStyle = rgba(r.pick(['#a88a40', '#c9a44a', '#8a7030']), r.range(0.35, 0.6));
      g.beginPath();
      g.ellipse(x, edge(x) + 2, r.range(14, 36), r.range(4, 9), 0, Math.PI, TAU);
      g.fill();
    }
    // the clearing's pool of warm light and the shadowed margins
    blob(g, 640, 482, 640, 160, '#f7d88a', 0.3);
    blob(g, SUN.x, HZ + 34, 480, 50, '#fff0c0', 0.32);
    blob(g, -60, 640, 480, 320, '#15130a', 0.55);
    blob(g, W + 60, 640, 480, 320, '#15130a', 0.55);
    blob(g, 640, H + 20, 900, 120, '#1a1608', 0.45);
    const litter = ['#e3c15b', '#c9a43a', '#b0782a', '#8a6b24', '#d89a40', '#f0d070'];
    const inBand = (x, y) => y > 370 && y < 640 && x > 180 && x < 1100;
    // leaf litter, scaled with perspective (small near the far edge, larger toward the viewer)
    const litterPass = (n, alphaR, band) => {
      for (let i = 0; i < n; i++) {
        const x = r.range(-PAD_X, W + PAD_X);
        const y = HZ + 6 + Math.pow(r(), 0.9) * (H + PAD_Y - HZ - 6);
        if (band === 'out' && inBand(x, y)) continue;
        const persp = 0.35 + ((y - HZ) / (H - HZ)) * 1.2;
        const sz = r.range(1.6, 3.6) * persp;
        g.fillStyle = rgba(r.pick(litter), r.range(alphaR[0], alphaR[1]));
        g.beginPath();
        g.ellipse(x, y, sz, sz * r.range(0.35, 0.55), r.range(-0.6, 0.6), 0, TAU);
        g.fill();
      }
    };
    for (const [x, y, rx, ry, c, a] of [[300, 450, 260, 50, '#e8c870', 0.18], [960, 470, 280, 56, '#e8c870', 0.16], [640, 580, 380, 70, '#4a4218', 0.18], [180, 560, 200, 60, '#3a3414', 0.22], [1100, 560, 220, 60, '#3a3414', 0.22]]) blob(g, x, y, rx, ry, c, a);
    litterPass(2600, [0.1, 0.26], 'all');
    litterPass(3200, [0.35, 0.85], 'out');
    // dapples where the light shafts land
    for (const [x, y, w] of [[450, 470, 120], [690, 430, 96], [980, 520, 130], [300, 600, 76], [820, 610, 90]]) {
      blob(g, x, y, w, w * 0.2, '#fff2c0', 0.3);
      dabs(g, r, { x: x - w, y: y - w * 0.2, w: w * 2, h: w * 0.4, n: 30, size: [2, 4], alpha: [0.3, 0.6], color: '#fff0a8', squash: 0.4 });
    }
    // mossy stones at the margins
    for (const [x, y, w] of [[90, 646, 54], [1196, 630, 62], [1120, 704, 44], [230, 708, 40]]) {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI + (i / 10) * Math.PI;
        const rr = r.range(0.8, 1.05);
        pts.push([x + Math.cos(a) * w * rr, y + Math.sin(a) * w * 0.55 * rr]);
      }
      poly(g, [...pts, [x + w, y + 6], [x - w, y + 6]]);
      g.fillStyle = vgrad(g, y - w * 0.55, y + 6, [[0, '#5a5430'], [1, '#2a2612']]);
      g.fill();
      dabs(g, r, { x: x - w, y: y - w * 0.55, w: w * 2, h: w * 0.3, n: 40, size: [2, 5], alpha: [0.4, 0.8], color: ['#7a8a38', '#94a448', '#5a6a28'], squash: 0.5, where: (px, py) => Math.abs(px - x) < w * 0.8 && py < y - w * 0.25 });
      rimLight(g, pts, SUN.x, -200, '#ffe6a0', 1.6, 0.6, false);
    }
    grain(g, -PAD_X, HZ - 24, W + PAD_X * 2, H + PAD_Y - HZ + 24, 0.06);
  }
  steps.push(ground);

  // --- light shafts: pre-rendered soft wedges (across + along falloff), gently breathing ---
  const shafts = [
    { x: 860, w: 70, bx: 450, bw: 130, a: 0.85, ph: 0 },
    { x: 985, w: 50, bx: 690, bw: 110, a: 0.7, ph: 1.7 },
    { x: 1130, w: 90, bx: 960, bw: 170, a: 0.8, ph: 3.1 },
    { x: 720, w: 40, bx: 300, bw: 80, a: 0.55, ph: 4.4 },
  ].map((sh) => ({ ...sh, spr: shaftSprite(S, sh.x, sh.w * 1.3, sh.bx, sh.bw * 1.2, -PAD_Y, 650, '#fff2c0', 0.3) }));
  steps.push(anim(0.1, (ctx, t) => {
    ctx.globalCompositeOperation = 'lighter';
    for (const sh of shafts) {
      ctx.globalAlpha = (sh.a * (0.62 + 0.38 * Math.sin(t * 0.00045 + sh.ph))) * FADE;
      const L = sh.spr;
      ctx.drawImage(L.canvas, L.x0, L.y0, L.w, L.h);
    }
    ctx.globalAlpha = FADE;
    ctx.globalCompositeOperation = 'source-over';
  }));

  // --- foreground: framing trees, overhanging leaves, ferns (edge strips; the middle stays empty) ---
  const foreSeed = r.int(1, 1e9);
  steps.push(...edgeLayers(S, 0.3, -PAD_Y, H + PAD_Y, [[-PAD_X, 470], [800, W + PAD_X]], (g) => {
    const r = makeRand(foreSeed);
    framingTree(g, r, { x: -4, w: 104, lightX: SUN.x, dir: 1 });
    framingTree(g, r, { x: 1290, w: 118, lightX: SUN.x, dir: -1 });
    foliage(g, r, { cx: 90, cy: -34, rx: 360, ry: 120, n: 1100, colors: ['#8a6b24', '#6a5018', '#a8842c', '#c9a43a'], lit: '#f0d070', shadow: '#3a2c10', lightX: SUN.x, lightY: SUN.y, size: [5, 13], alpha: [0.7, 1] });
    foliage(g, r, { cx: 1210, cy: -44, rx: 400, ry: 130, n: 1200, colors: ['#8a6b24', '#6a5018', '#a8842c', '#c9a43a'], lit: '#f0d070', shadow: '#3a2c10', lightX: SUN.x, lightY: SUN.y, size: [5, 13], alpha: [0.7, 1] });
    // hanging golden vines
    for (const [x, len] of [[150, 170], [210, 110], [1080, 150], [1140, 210], [1190, 120]]) {
      g.strokeStyle = rgba('#5a4a1c', 0.9);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, 20);
      g.quadraticCurveTo(x + 10, 20 + len * 0.5, x - 4, 20 + len);
      g.stroke();
      for (let k = 0; k < len / 12; k++) {
        const u = k / (len / 12);
        const px = x + Math.sin(u * 3) * 6, py = 20 + u * len;
        g.fillStyle = rgba(r.pick(['#e3c15b', '#f0d070', '#c9a43a']), 0.9);
        g.beginPath();
        g.ellipse(px + (k % 2 ? 4 : -4), py, 4.5, 2, k % 2 ? 0.6 : -0.6, 0, TAU);
        g.fill();
      }
    }
    for (const [x, y, lean] of [[30, 724, 0.5], [120, 744, 0.3], [1180, 734, -0.4], [1262, 720, -0.5], [236, 756, 0.2], [1070, 758, -0.2]]) {
      for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 2 + lean + r.range(-0.9, 0.9);
        const len = r.range(56, 110);
        const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
        g.strokeStyle = rgba('#5a5020', 0.95);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo((x + ex) / 2 + 10, (y + ey) / 2 - 10, ex, ey);
        g.stroke();
        for (let j = 1; j < 9; j++) {
          const u = j / 9;
          const px = lerp(x, ex, u), py = lerp(y, ey, u) - Math.sin(u * Math.PI) * 8;
          g.fillStyle = rgba(r.pick(['#8a7a2c', '#a8923a', '#6a6020', '#c9a43a', '#e3c15b']), 0.92);
          for (const sd of [-1, 1]) {
            g.beginPath();
            g.ellipse(px + sd * 6 * (1 - u), py - 2, 7 * (1 - u * 0.6), 2.2, a + sd * 0.9, 0, TAU);
            g.fill();
          }
        }
      }
    }
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, H + PAD_Y * 2, 0.06);
  }));

  // --- drifting gilded leaves + pollen ---
  const lr = makeRand(23);
  const leaves = [];
  for (let i = 0; i < 26; i++) {
    leaves.push({ x: lr.range(-PAD_X, W + PAD_X), y: lr.range(-PAD_Y, H), vx: lr.range(-22, -8), vy: lr.range(14, 30), s: lr.range(4, 7), ph: lr.range(0, TAU), f: lr.range(0.0014, 0.003), c: lr.pick(['#f0c850', '#e3c15b', '#d89a40', '#ffe08a']) });
  }
  const pollen = makeMotes(makeRand(24), 40, { y0: 60, y1: 660, vx: [-6, 6], vy: [-10, -3], size: [0.8, 2], colors: ['#fff0b0', '#ffe08a'] });
  steps.push(anim(0.34, (ctx, t) => {
    const sec = t / 1000;
    const wX = W + PAD_X * 2, wY = H + PAD_Y * 2;
    for (const lf of leaves) {
      let x = lf.x + lf.vx * sec + Math.sin(t * lf.f + lf.ph) * 26;
      let y = lf.y + lf.vy * sec;
      x = -PAD_X + ((((x + PAD_X) % wX) + wX) % wX);
      y = -PAD_Y + ((((y + PAD_Y) % wY) + wY) % wY);
      const flip = Math.cos(t * lf.f * 2.2 + lf.ph);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * lf.f + lf.ph) * 1.2);
      ctx.scale(1, 0.25 + Math.abs(flip) * 0.75);
      ctx.fillStyle = flip > 0 ? lf.c : shade(lf.c, -0.25);
      ctx.beginPath();
      ctx.ellipse(0, 0, lf.s, lf.s * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba('#7a5a18', 0.6);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-lf.s, 0);
      ctx.lineTo(lf.s, 0);
      ctx.stroke();
      ctx.restore();
    }
    drawMotes(ctx, pollen, t, 0.75);
  }));
  steps.push(vignette(S, '#140f06', 0.6, 0.3));
  return steps;
}

// ---------------------------------------------------------------------------------------------
// Zone: the Meridian Spire (clockwork terrace)
// ---------------------------------------------------------------------------------------------

function archPath(g, cx, w, springY, bottomY) {
  g.moveTo(cx - w / 2, bottomY);
  g.lineTo(cx - w / 2, springY);
  g.arc(cx, springY, w / 2, Math.PI, 0);
  g.lineTo(cx + w / 2, bottomY);
  g.closePath();
}

function buildSpire(S) {
  const P = ZONE_PALETTES.spire;
  const r = makeRand(3303);
  const BAL = 296;
  const FLOOR = 338;
  const SUN = { x: 640, y: 200, r: 54 };
  const arches = [
    { x: 140, w: 170, sy: 150 }, { x: 390, w: 180, sy: 146 }, { x: 640, w: 204, sy: 140 },
    { x: 890, w: 180, sy: 146 }, { x: 1140, w: 170, sy: 150 },
  ];
  const steps = [];
  const skyStops = [[0, P.sky[0]], [0.4, P.sky[1]], [0.75, P.sky[2]], [1, P.sky[3]]];

  // --- sky seen through the arcade ---
  const sky = layer(S, 0.02, -PAD_Y, FLOOR + 10);
  {
    const g = sky.g;
    g.fillStyle = vgrad(g, -PAD_Y, 300, skyStops);
    g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, FLOOR + 10 + PAD_Y);
    stars(g, r, 120, -PAD_Y, 170, 0.8);
    blob(g, SUN.x, SUN.y + 40, 620, 200, '#f5c77e', 0.4);
    strokes(g, r, { x: -PAD_X, y: -PAD_Y, w: W + PAD_X * 2, h: 340, n: 300, len: [40, 160], width: [2, 6], alpha: [0.04, 0.1], color: (x, y) => shade(colorAt(skyStops, clamp((y + PAD_Y) / 340, 0, 1)), r.range(-0.1, 0.1)), jitter: 0.05 });
    // distant pinnacles of the Spire complex
    for (const [x, h, w] of [[380, 120, 14], [420, 76, 9], [880, 140, 16], [930, 90, 10], [700, 60, 7], [150, 100, 12], [1120, 110, 12]]) {
      const b = 282;
      g.fillStyle = rgba('#3a3448', 0.8);
      poly(g, [[x - w, b], [x - w * 0.55, b - h * 0.8], [x, b - h], [x + w * 0.55, b - h * 0.8], [x + w, b]]);
      g.fill();
      g.strokeStyle = rgba('#f0c890', 0.45);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, b - h); g.lineTo(x + w * 0.55, b - h * 0.8); g.lineTo(x + w, b);
      g.stroke();
      g.fillStyle = rgba('#ffd28a', 0.8);
      g.fillRect(x - 1, b - h * 0.55, 2, 3);
    }
    blob(g, SUN.x, SUN.y, SUN.r * 2.6, SUN.r * 2.6, '#ffe0a8', 0.35);
    blob(g, 640, 276, 900, 40, '#ffd9a0', 0.4);
    cloudBank(g, r, { x: 260, y: 270, w: 700, h: 40, body: '#5a4e66', lit: '#f0c890', light: { x: 0.4, y: -1 } });
    cloudBank(g, r, { x: 1010, y: 266, w: 720, h: 44, body: '#5a4e66', lit: '#f0c890', light: { x: -0.4, y: -1 } });
    cloudBank(g, r, { x: 640, y: 290, w: 1100, h: 34, body: '#6e6076', lit: '#ffdca0', light: { x: 0, y: -1 } });
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, FLOOR + 10 + PAD_Y, 0.04);
  }
  steps.push(sky);
  steps.push(anim(0.02, (ctx, t) => drawCorona(ctx, SUN.x, SUN.y, SUN.r, t, '#ffd89a', 0.4)));
  steps.push(sunLayer(S, 0.02, SUN, { color: P.sun, detail: 0.75, numerals: true }));

  // --- great gears of the tower exterior, seen through the side arches ---
  const farGearA = gearSprite(S, 150, 30, { body: '#6a5440', dark: '#2a2028', light: '#b89a70', spokes: 6, haze: 'rgba(60,56,90,0.35)' });
  const farGearB = gearSprite(S, 118, 24, { body: '#6a5440', dark: '#2a2028', light: '#b89a70', spokes: 5, haze: 'rgba(60,56,90,0.35)' });
  steps.push(anim(0.04, (ctx, t) => {
    drawGear(ctx, farGearA, 150, 70, 150, t * 0.00006);
    drawGear(ctx, farGearB, 1136, 96, 118, -t * 0.00006 * (150 / 118));
  }));

  // --- the arcade wall ---
  const wall = layer(S, 0.1, -PAD_Y, FLOOR + 12);
  {
    const g = wall.g;
    g.fillStyle = vgrad(g, -PAD_Y, FLOOR, [[0, '#231d27'], [0.45, '#3f342f'], [1, '#554539']]);
    g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, FLOOR + 12 + PAD_Y);
    // stone courses
    g.strokeStyle = rgba('#1a1418', 0.35);
    g.lineWidth = 1.2;
    for (let y = -PAD_Y + 20, row = 0; y < FLOOR; y += 36, row++) {
      g.beginPath();
      g.moveTo(-PAD_X, y);
      g.lineTo(W + PAD_X, y);
      g.stroke();
      for (let x = -PAD_X + (row % 2) * 40; x < W + PAD_X; x += 80) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 36);
        g.stroke();
      }
    }
    strokes(g, r, { x: -PAD_X, y: -PAD_Y, w: W + PAD_X * 2, h: FLOOR + PAD_Y, n: 700, len: [10, 50], width: [1, 4], alpha: [0.05, 0.14], color: ['#6a5a4a', '#2a2226', '#8a7058'], jitter: 0.3 });
    // cut the openings
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    for (const a of arches) archPath(g, a.x, a.w, a.sy, BAL + 40);
    g.fill();
    g.restore();
    // inner reveal (wall thickness), darker away from the sun, lit toward it
    for (const a of arches) {
      const lit = SUN.x > a.x ? 1 : SUN.x < a.x ? -1 : 0;
      g.save();
      g.beginPath();
      archPath(g, a.x, a.w, a.sy, BAL + 40);
      g.clip();
      g.fillStyle = rgba('#1c1620', 0.85);
      g.beginPath();
      archPath(g, a.x, a.w + 2, a.sy, BAL + 40);
      archPath(g, a.x + lit * 12, a.w - 20, a.sy + 4, BAL + 40);
      g.fill('evenodd');
      g.restore();
      // brass molding
      g.beginPath();
      g.moveTo(a.x - a.w / 2 - 6, BAL);
      g.lineTo(a.x - a.w / 2 - 6, a.sy);
      g.arc(a.x, a.sy, a.w / 2 + 6, Math.PI, 0);
      g.lineTo(a.x + a.w / 2 + 6, BAL);
      g.lineWidth = 9;
      g.strokeStyle = '#5a4222';
      g.stroke();
      g.lineWidth = 5;
      g.strokeStyle = vgrad(g, a.sy - a.w / 2, BAL, [[0, '#e8c16a'], [0.5, '#b8893b'], [1, '#6f5426']]);
      g.stroke();
      g.lineWidth = 1.2;
      g.strokeStyle = rgba('#fff0c0', 0.6);
      g.beginPath();
      g.arc(a.x, a.sy, a.w / 2 + 4, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      // keystone
      const ky = a.sy - a.w / 2 - 6;
      poly(g, [[a.x - 12, ky - 16], [a.x + 12, ky - 16], [a.x + 8, ky + 8], [a.x - 8, ky + 8]]);
      g.fillStyle = '#b8893b';
      g.fill();
      g.strokeStyle = '#5a4222';
      g.lineWidth = 1.5;
      g.stroke();
      g.beginPath();
      g.arc(a.x, ky - 4, 4.5, 0, TAU);
      g.fillStyle = '#f0cf7a';
      g.fill();
    }
    // pilasters between the arches
    const pil = [-10, 265, 515, 765, 1015, 1290];
    for (const x of pil) {
      g.fillStyle = vgrad(g, 0, BAL, [[0, '#3a302c'], [1, '#5a4a3e']]);
      g.fillRect(x - 16, 20, 32, BAL - 20);
      g.fillStyle = rgba('#1a1418', 0.45);
      g.fillRect(x + (x < SUN.x ? 6 : -16), 20, 10, BAL - 20);
      g.fillStyle = '#b8893b';
      g.fillRect(x - 20, 150, 40, 8);
      g.fillRect(x - 20, BAL - 12, 40, 8);
      g.fillStyle = rgba('#fff0c0', 0.35);
      g.fillRect(x - 20, 150, 40, 2);
    }
    // frieze with clock rosettes
    g.fillStyle = vgrad(g, -PAD_Y, 10, [[0, '#6f5426'], [1, '#b8893b']]);
    g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, 22 + PAD_Y);
    g.fillStyle = '#3a2a16';
    g.fillRect(-PAD_X, -18 + 30, W + PAD_X * 2, 3);
    for (let x = -30; x < W + PAD_X; x += 64) {
      g.beginPath();
      g.arc(x, -2, 8, 0, TAU);
      g.fillStyle = '#e8c16a';
      g.fill();
      g.strokeStyle = '#5a4222';
      g.lineWidth = 1.5;
      g.stroke();
      g.beginPath();
      g.moveTo(x, -2); g.lineTo(x, -8);
      g.moveTo(x, -2); g.lineTo(x + 4, 0);
      g.stroke();
    }
    // balustrade across the openings
    g.fillStyle = '#4a3a2c';
    g.fillRect(-PAD_X, BAL + 32, W + PAD_X * 2, FLOOR - BAL - 20);
    for (let x = -PAD_X + 6; x < W + PAD_X; x += 22) {
      g.fillStyle = '#3a2c22';
      g.beginPath();
      g.moveTo(x - 4, BAL + 34);
      g.quadraticCurveTo(x - 9, BAL + 22, x - 3, BAL + 12);
      g.lineTo(x + 3, BAL + 12);
      g.quadraticCurveTo(x + 9, BAL + 22, x + 4, BAL + 34);
      g.closePath();
      g.fill();
      g.strokeStyle = rgba('#f0c890', 0.35);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + (x < SUN.x ? 3 : -3), BAL + 13);
      g.quadraticCurveTo(x + (x < SUN.x ? 8 : -8), BAL + 22, x + (x < SUN.x ? 4 : -4), BAL + 33);
      g.stroke();
    }
    g.fillStyle = vgrad(g, BAL + 2, BAL + 12, [[0, '#e8c16a'], [1, '#6f5426']]);
    g.fillRect(-PAD_X, BAL + 2, W + PAD_X * 2, 10);
    g.fillStyle = rgba('#fff0c0', 0.5);
    g.fillRect(-PAD_X, BAL + 2, W + PAD_X * 2, 1.5);
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, FLOOR + 12 + PAD_Y, 0.06);
  }
  steps.push(wall);

  // --- wall gears meshing above the arches ---
  const gA = gearSprite(S, 62, 16, {});
  const gB = gearSprite(S, 42, 11, { body: '#a87a34' });
  steps.push(anim(0.1, (ctx, t) => {
    const w = t * 0.00022;
    drawGear(ctx, gA, 515, 44, 62, w);
    drawGear(ctx, gA, 765, 44, 62, w + 0.1);
    drawGear(ctx, gB, 640, -8, 42, -w * (62 / 42) + 0.14);
  }));

  // --- polished floor with the inlaid dial ---
  const floor = layer(S, 0.18, FLOOR - 6, H + PAD_Y);
  {
    const g = floor.g;
    g.fillStyle = vgrad(g, FLOOR, H + PAD_Y, [[0, '#8a765c'], [0.18, P.ground[0]], [0.6, '#4a3d31'], [1, '#1e1813']]);
    g.fillRect(-PAD_X, FLOOR - 6, W + PAD_X * 2, H + PAD_Y - FLOOR + 6);
    g.fillStyle = rgba('#2a2018', 0.9);
    g.fillRect(-PAD_X, FLOOR - 6, W + PAD_X * 2, 8);
    // light pools cast through the arches
    for (const a of arches) {
      const spread = (a.x - SUN.x) * 0.55;
      const gr = g.createLinearGradient(0, FLOOR, 0, 640);
      gr.addColorStop(0, rgba('#ffd9a0', 0.24));
      gr.addColorStop(1, rgba('#ffd9a0', 0));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(a.x - a.w * 0.42, FLOOR + 2);
      g.lineTo(a.x + a.w * 0.42, FLOOR + 2);
      g.lineTo(a.x + a.w * 0.7 + spread, 640);
      g.lineTo(a.x - a.w * 0.7 + spread, 640);
      g.closePath();
      g.fill();
    }
    // reflection of the sun in the polish
    blob(g, SUN.x, FLOOR + 30, 90, 36, '#ffe8c0', 0.32);
    blob(g, SUN.x, FLOOR + 110, 60, 110, '#ffe0b0', 0.14);
    // tile seams in perspective
    const VP = { x: 640, y: 190 };
    g.strokeStyle = rgba('#1e1812', 0.28);
    g.lineWidth = 1;
    for (let i = -18; i <= 18; i++) {
      const bx = 640 + i * 120;
      const t0 = (FLOOR - VP.y) / (H + PAD_Y - VP.y);
      g.beginPath();
      g.moveTo(lerp(VP.x, bx, t0), FLOOR);
      g.lineTo(bx, H + PAD_Y);
      g.stroke();
    }
    for (let k = 0; k < 12; k++) {
      const y = FLOOR + Math.pow(k / 11, 1.7) * (H + PAD_Y - FLOOR);
      g.beginPath();
      g.moveTo(-PAD_X, y);
      g.lineTo(W + PAD_X, y);
      g.stroke();
    }
    // inlaid brass dial
    const dc = { x: 640, y: 508 };
    g.strokeStyle = rgba('#d8a850', 0.34);
    for (const [rx, ry, lw] of [[540, 158, 3], [524, 152, 1.2], [440, 126, 1.5], [150, 42, 1.2], [60, 17, 1.5]]) {
      g.lineWidth = lw;
      g.beginPath();
      g.ellipse(dc.x, dc.y, rx, ry, 0, 0, TAU);
      g.stroke();
    }
    g.font = `600 22px ${FONTS.title}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12 - Math.PI / 2;
      const px = dc.x + Math.cos(a) * 482, py = dc.y + Math.sin(a) * 139;
      g.save();
      g.translate(px, py);
      g.scale(1, 0.34);
      g.fillStyle = rgba('#d8a850', 0.28);
      g.fillText(ROMAN[i], 0, 0);
      g.restore();
      const ix = dc.x + Math.cos(a) * 532, iy = dc.y + Math.sin(a) * 155;
      g.fillStyle = rgba('#e8c16a', 0.4);
      g.beginPath();
      g.ellipse(ix, iy, 5, 2, 0, 0, TAU);
      g.fill();
    }
    // stopped hands inlaid in the floor
    g.strokeStyle = rgba('#d8a850', 0.24);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(dc.x, dc.y);
    g.lineTo(dc.x + Math.cos(-Math.PI / 2 - 0.2) * 380, dc.y + Math.sin(-Math.PI / 2 - 0.2) * 110);
    g.moveTo(dc.x, dc.y);
    g.lineTo(dc.x + Math.cos(Math.PI * 0.72) * 250, dc.y + Math.sin(Math.PI * 0.72) * 72);
    g.stroke();
    dabs(g, r, { x: -PAD_X, y: FLOOR, w: W + PAD_X * 2, h: H + PAD_Y - FLOOR, n: 1200, size: [0.6, 2], alpha: [0.05, 0.15], color: ['#e8d0a8', '#2a2018'], squash: 0.6 });
    blob(g, -80, 640, 480, 300, '#120e10', 0.55);
    blob(g, W + 80, 640, 480, 300, '#120e10', 0.55);
    grain(g, -PAD_X, FLOOR - 6, W + PAD_X * 2, H + PAD_Y - FLOOR + 6, 0.05);
  }
  steps.push(floor);

  // --- light beams through the arches + dust in them ---
  const dust = makeMotes(makeRand(33), 44, { x0: 40, x1: 1240, y0: 150, y1: 620, vx: [-4, 4], vy: [-6, 2], size: [0.7, 1.6], colors: ['#fff0c8', '#ffe0a0'] });
  steps.push(anim(0.13, (ctx, t) => {
    ctx.globalCompositeOperation = 'lighter';
    arches.forEach((a, i) => {
      const k = 0.1 * (0.7 + 0.3 * Math.sin(t * 0.0004 + i * 1.3));
      const spread = (a.x - SUN.x) * 0.55;
      const gr = ctx.createLinearGradient(0, a.sy - 40, 0, 600);
      gr.addColorStop(0, rgba('#ffe2a8', 0));
      gr.addColorStop(0.4, rgba('#ffe2a8', k));
      gr.addColorStop(1, rgba('#ffe2a8', 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(a.x - a.w * 0.4, a.sy - 20);
      ctx.lineTo(a.x + a.w * 0.4, a.sy - 20);
      ctx.lineTo(a.x + a.w * 0.72 + spread, 600);
      ctx.lineTo(a.x - a.w * 0.72 + spread, 600);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
    drawMotes(ctx, dust, t, 0.7);
  }));

  // --- brass pillars framing the terrace (edge strips) ---
  steps.push(...edgeLayers(S, 0.3, -PAD_Y, H + PAD_Y, [[-PAD_X, 70], [1210, W + PAD_X]], (g) => {
    for (const [x0, x1, lit] of [[-PAD_X, 58, 1], [1222, W + PAD_X, -1]]) {
      const w = x1 - x0;
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(lit > 0 ? 0 : 1, '#1c140e');
      gr.addColorStop(0.55, '#5a4222');
      gr.addColorStop(lit > 0 ? 1 : 0, '#a87a34');
      g.fillStyle = gr;
      g.fillRect(x0, -PAD_Y, w, H + PAD_Y * 2);
      for (const y of [60, 250, 480, 660]) {
        g.fillStyle = vgrad(g, y, y + 18, [[0, '#e8c16a'], [1, '#6f5426']]);
        g.fillRect(x0, y, w, 18);
        g.fillStyle = '#3a2a16';
        for (let x = x0 + 8; x < x1; x += 16) {
          g.beginPath();
          g.arc(x, y + 9, 2.2, 0, TAU);
          g.fill();
        }
      }
      const px = lit > 0 ? x1 - 14 : x0 + 14;
      g.strokeStyle = '#3a2a16';
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(px, -PAD_Y);
      g.lineTo(px, H + PAD_Y);
      g.stroke();
      g.strokeStyle = rgba('#f0cf7a', 0.55);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px + lit * 2, -PAD_Y);
      g.lineTo(px + lit * 2, H + PAD_Y);
      g.stroke();
      g.strokeStyle = rgba(lit > 0 ? '#ffdc90' : '#b8893b', 0.7);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lit > 0 ? x1 : x0, -PAD_Y);
      g.lineTo(lit > 0 ? x1 : x0, H + PAD_Y);
      g.stroke();
    }
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, H + PAD_Y * 2, 0.06);
  }));
  const gC = gearSprite(S, 112, 22, { body: '#8a6630', dark: '#2a1c10', light: '#d8b060' });
  const gD = gearSprite(S, 88, 18, { body: '#8a6630', dark: '#2a1c10', light: '#d8b060' });
  steps.push(anim(0.3, (ctx, t) => {
    drawGear(ctx, gC, -6, 728, 112, t * 0.00016);
    drawGear(ctx, gD, 1290, 738, 88, -t * 0.00016 * (112 / 88));
  }));
  steps.push(vignette(S, '#0e0a10', 0.6, 0.35));
  return steps;
}

// ---------------------------------------------------------------------------------------------
// Zone: the Summit, under the cracked Clockwork Sun (phase 0) / Unwound (phase 1)
// ---------------------------------------------------------------------------------------------

/** A fluted stone column, snapped off with a jagged top; `lit` = +1 when the light comes from the right. */
function brokenColumn(g, r, { x, base, h, w, lit, stone = '#5a4a44', dark = '#1e1614', rim = '#ffd79a', trim = '#e0b458' }) {
  const top = base - h;
  const pts = [[x - w / 2, base - 16], [x - w / 2 + 2, top + 12]];
  const jag = 7;
  for (let i = 1; i < jag; i++) pts.push([x - w / 2 + (w * i) / jag, top + r.range(-12, 14) + (i % 2 ? -6 : 6)]);
  pts.push([x + w / 2 - 2, top + 18], [x + w / 2, base - 16]);
  poly(g, pts);
  const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  gr.addColorStop(lit > 0 ? 0 : 1, dark);
  gr.addColorStop(0.5, stone);
  gr.addColorStop(lit > 0 ? 1 : 0, shade(stone, 0.25));
  g.fillStyle = gr;
  g.fill();
  g.save();
  poly(g, pts);
  g.clip();
  for (let fx = x - w / 2 + 6; fx < x + w / 2 - 2; fx += 9) {
    g.strokeStyle = rgba(dark, 0.45);
    g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(fx, top - 20); g.lineTo(fx, base); g.stroke();
    g.strokeStyle = rgba(rim, 0.14);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(fx + 2.5, top - 20); g.lineTo(fx + 2.5, base); g.stroke();
  }
  // cracks and weathering
  strokes(g, r, { x: x - w / 2, y: top, w, h, n: Math.round(h / 6), len: [6, 22], width: [0.8, 2], alpha: [0.1, 0.3], color: [dark, shade(stone, 0.2)], angle: Math.PI / 2, jitter: 1.2 });
  g.restore();
  rimLight(g, pts, x + lit * 400, top - 500, rim, 2, 0.85);
  // plinth
  g.fillStyle = vgrad(g, base - 18, base, [[0, shade(stone, 0.1)], [1, dark]]);
  g.fillRect(x - w / 2 - 8, base - 18, w + 16, 18);
  g.fillStyle = rgba(trim, 0.75);
  g.fillRect(x - w / 2 - 8, base - 18, w + 16, 3);
}

function buildSummit(S, phase = 0) {
  const P = ZONE_PALETTES.summit;
  const r = makeRand(4404);
  const HZ = 344;
  const SUN = { x: 640, y: 112, r: 300 };
  const unwound = phase >= 1;
  const steps = [];
  const skyStops = unwound
    ? [[0, '#07060c'], [0.35, '#1d1030'], [0.72, '#5a2450'], [1, '#d0704a']]
    : [[0, P.sky[0]], [0.35, P.sky[1]], [0.75, P.sky[2]], [1, P.sky[3]]];
  const crack = crackPaths(makeRand(41), SUN.x, SUN.y, SUN.r, Math.PI * 1.1, Math.PI * 0.32, 4);
  const sunOpts = { color: unwound ? '#ffe6c8' : P.sun, detail: 1, numerals: true, crack, edge: unwound ? '#c86a5a' : '#e89a4a' };

  // --- the sky ---
  const sky = layer(S, 0.015, -PAD_Y, HZ + 30);
  {
    const g = sky.g;
    g.fillStyle = vgrad(g, -PAD_Y, HZ, skyStops);
    g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 30 + PAD_Y);
    stars(g, r, 170, -PAD_Y, 280, 0.85);
    blob(g, SUN.x, SUN.y + 60, 980, 400, unwound ? '#e07a5a' : '#f0b25a', 0.42);
    blob(g, SUN.x, SUN.y, SUN.r * 1.7, SUN.r * 1.5, '#fff0c8', 0.35);
    strokes(g, r, { x: -PAD_X, y: -PAD_Y, w: W + PAD_X * 2, h: HZ + PAD_Y, n: 460, len: [50, 220], width: [2, 8], alpha: [0.05, 0.13], color: (x, y) => shade(colorAt(skyStops, clamp((y + PAD_Y) / (HZ + PAD_Y), 0, 1)), r.range(-0.12, 0.12)), jitter: 0.08 });
    // smoky banks beneath the sun, lit from above by it
    const body = unwound ? '#3a2040' : '#4a2c3a';
    const lit = unwound ? '#ffa888' : '#ffc27a';
    cloudBank(g, r, { x: 150, y: 244, w: 560, h: 64, body, lit, light: { x: 0.6, y: -1 }, alpha: 0.9 });
    cloudBank(g, r, { x: 1130, y: 236, w: 560, h: 70, body, lit, light: { x: -0.6, y: -1 }, alpha: 0.9 });
    cloudBank(g, r, { x: 110, y: 150, w: 360, h: 30, body: shade(body, -0.2), lit, light: { x: 0.7, y: -0.6 }, alpha: 0.6 });
    cloudBank(g, r, { x: 1170, y: 136, w: 380, h: 30, body: shade(body, -0.2), lit, light: { x: -0.7, y: -0.6 }, alpha: 0.6 });
    if (unwound) clockSun(g, SUN.x, SUN.y, SUN.r, { ...sunOpts, glow: false });
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 30 + PAD_Y, 0.05);
  }
  if (unwound) {
    steps.push(shatterLayer(S, sky, { x: SUN.x + 30, y: SUN.y + 40 }));
  } else {
    steps.push(sky);
  }
  steps.push(anim(0.015, (ctx, t) => drawCorona(ctx, SUN.x, SUN.y, SUN.r, t, unwound ? '#ffd0b8' : '#ffe0a0', unwound ? 0.4 : 0.5)));
  if (!unwound) steps.push(sunLayer(S, 0.015, SUN, sunOpts, null, 1.05));
  steps.push(anim(0.015, (ctx, t) => {
    // light leaking through the crack pulses like a held breath
    ctx.globalCompositeOperation = 'lighter';
    const k = 0.35 + 0.25 * Math.sin(t * 0.0021) + 0.1 * Math.sin(t * 0.0057);
    ctx.lineJoin = 'miter';
    for (const [w, a] of [[18, 0.07], [8, 0.2], [2.5, 0.6]]) {
      ctx.strokeStyle = rgba('#fff2d0', a * k * 1.6);
      ctx.lineWidth = w;
      for (const path of crack) strokePath(ctx, path);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (unwound) drawHaloShards(ctx, SUN, t);
  }));

  // --- sea of clouds far below the summit ---
  const clouds = layer(S, 0.04, 230, HZ + 70);
  {
    const g = clouds.g;
    const body = unwound ? '#4a2848' : '#7a4e46';
    const lit = unwound ? '#ffb89a' : '#ffd79a';
    blob(g, 640, HZ - 14, 1000, 60, unwound ? '#f0907a' : '#ffd8a0', 0.5);
    for (let i = 0; i < 8; i++) {
      const y = lerp(296, HZ + 36, i / 7);
      for (let j = 0; j < 2; j++) {
        cloudBank(g, r, { x: r.range(-80, W + 80), y, w: r.range(520, 900), h: 20 + i * 5, body: mix(body, '#24161e', i / 10), lit, light: { x: 0, y: -1 }, alpha: 0.9, density: 0.8 });
      }
    }
    grain(g, -PAD_X, 230, W + PAD_X * 2, HZ + 70 - 230, 0.05);
  }
  steps.push(clouds);

  // --- the summit platform ---
  const plat = layer(S, 0.18, HZ - 210, H + PAD_Y);
  {
    const g = plat.g;
    const top = HZ + 2;
    const stone = unwound ? '#5a4250' : '#6a5446';
    brokenColumn(g, r, { x: 74, base: top + 8, h: 214, w: 62, lit: 1, stone, rim: unwound ? '#ffc8b0' : '#ffd79a' });
    brokenColumn(g, r, { x: 1204, base: top + 8, h: 160, w: 56, lit: -1, stone, rim: unwound ? '#ffc8b0' : '#ffd79a' });
    brokenColumn(g, r, { x: 1272, base: top + 8, h: 74, w: 36, lit: -1, stone, rim: unwound ? '#ffc8b0' : '#ffd79a' });
    // platform surface: a vast disc seen edge-on
    g.save();
    g.beginPath();
    g.ellipse(640, 760, 1200, 760 - top, 0, Math.PI, TAU);
    g.lineTo(W + PAD_X, H + PAD_Y);
    g.lineTo(-PAD_X, H + PAD_Y);
    g.closePath();
    g.fillStyle = vgrad(g, top, H + PAD_Y, [[0, unwound ? '#6a4a56' : '#8a6a52'], [0.14, unwound ? '#4a3440' : '#5e4a3e'], [0.55, '#2e2320'], [1, P.ground[1]]]);
    g.fill();
    g.clip();
    blob(g, 640, top + 28, 760, 96, unwound ? '#ffb8a0' : '#ffd79a', 0.3);
    const dc = { x: 640, y: 562 };
    // stone slabs: concentric courses with staggered radial joints (bevelled)
    const rings = [0.13, 0.3, 0.48, 0.72, 1, 1.32, 1.72];
    for (let k = 0; k < rings.length; k++) {
      const rx = 640 * rings[k], ry = 190 * rings[k];
      g.lineWidth = 1.4;
      g.strokeStyle = rgba('#140e0c', 0.45);
      g.beginPath(); g.ellipse(dc.x, dc.y, rx, ry, 0, 0, TAU); g.stroke();
      g.strokeStyle = rgba('#e8c8a0', 0.08);
      g.beginPath(); g.ellipse(dc.x, dc.y + 1.5, rx, ry, 0, 0, TAU); g.stroke();
      if (k === rings.length - 1) break;
      const nx = 10 + k * 5;
      const off = k % 2 ? 0.5 : 0;
      for (let j = 0; j < nx; j++) {
        const a = ((j + off) / nx) * TAU;
        const rx2 = 640 * rings[k + 1], ry2 = 190 * rings[k + 1];
        g.strokeStyle = rgba('#140e0c', 0.35);
        g.beginPath();
        g.moveTo(dc.x + Math.cos(a) * rx, dc.y + Math.sin(a) * ry);
        g.lineTo(dc.x + Math.cos(a) * rx2, dc.y + Math.sin(a) * ry2);
        g.stroke();
      }
    }
    // per-slab tone variation
    strokes(g, r, { x: -PAD_X, y: top + 6, w: W + PAD_X * 2, h: H + PAD_Y - top, n: 700, len: [30, 110], width: [3, 9], alpha: [0.025, 0.06], color: ['#e8c8a0', '#0e0a08', '#8a6a52'], jitter: 0.08, curve: 0.25 });
    // gold inlay: the dial ring with its numerals, the hour lines and the frozen gnomon shadow
    g.strokeStyle = rgba('#e0b458', 0.32);
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(dc.x, dc.y, 640, 190, 0, 0, TAU); g.stroke();
    g.lineWidth = 1;
    g.beginPath(); g.ellipse(dc.x, dc.y, 610, 181, 0, 0, TAU); g.stroke();
    g.font = `600 30px ${FONTS.title}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12 - Math.PI / 2;
      const px = dc.x + Math.cos(a) * 560, py = dc.y + Math.sin(a) * 166;
      g.save();
      g.translate(px, py);
      g.scale(1, 0.32);
      g.fillStyle = rgba('#e0b458', 0.3);
      g.fillText(ROMAN[i], 0, 0);
      g.restore();
    }
    g.lineWidth = 1;
    g.strokeStyle = rgba('#e0b458', 0.12);
    for (let i = 0; i < 24; i++) {
      const a = (i * TAU) / 24;
      g.beginPath();
      g.moveTo(dc.x + Math.cos(a) * 84, dc.y + Math.sin(a) * 25);
      g.lineTo(dc.x + Math.cos(a) * 470, dc.y + Math.sin(a) * 140);
      g.stroke();
    }
    g.strokeStyle = rgba('#e0b458', 0.3);
    g.lineWidth = 2;
    g.beginPath(); g.ellipse(dc.x, dc.y, 84, 25, 0, 0, TAU); g.stroke();
    g.fillStyle = rgba('#e0b458', 0.1);
    g.fill();
    g.fillStyle = rgba('#120c0a', 0.3);
    poly(g, [[dc.x - 6, dc.y], [dc.x + 6, dc.y], [dc.x - 430, dc.y + 172], [dc.x - 482, dc.y + 160]]);
    g.fill();
    if (unwound) {
      // fractures of stilled time radiating from the dial: long, elegant, glowing
      g.globalCompositeOperation = 'lighter';
      const fr = makeRand(4747);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + fr.range(-0.3, 0.3);
        let x = dc.x + Math.cos(a) * 90, y = dc.y + Math.sin(a) * 27;
        const pts = [[x, y]];
        for (let k = 0; k < 7; k++) {
          const aa = a + fr.range(-0.3, 0.3);
          x += Math.cos(aa) * fr.range(34, 62);
          y += Math.sin(aa) * fr.range(10, 20);
          pts.push([x, y]);
        }
        for (const [lw, al] of [[8, 0.05], [3.5, 0.12], [1.2, 0.42]]) {
          g.strokeStyle = rgba('#ffe6c0', al);
          g.lineWidth = lw;
          strokePath(g, pts);
        }
      }
      g.globalCompositeOperation = 'source-over';
    }
    dabs(g, r, { x: -PAD_X, y: top, w: W + PAD_X * 2, h: H + PAD_Y - top, n: 1400, size: [0.6, 2.2], alpha: [0.06, 0.16], color: ['#e8c8a0', '#140e0c'], squash: 0.6 });
    blob(g, -60, 690, 540, 300, '#0a0608', 0.62);
    blob(g, W + 60, 690, 540, 300, '#0a0608', 0.62);
    g.restore();
    // brass rim along the platform's far edge
    g.strokeStyle = rgba('#e0b458', 0.8);
    g.lineWidth = 2.2;
    g.beginPath();
    g.ellipse(640, 760, 1200, 760 - top, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.strokeStyle = rgba('#fff0c8', 0.45);
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(640, 761.5, 1200, 760 - top, 0, Math.PI * 1.3, Math.PI * 1.7);
    g.stroke();
    grain(g, -PAD_X, HZ - 210, W + PAD_X * 2, H + PAD_Y - HZ + 210, 0.06);
  }
  steps.push(plat);

  // --- rubble framing ---
  const fore = layer(S, 0.3, 560, H + PAD_Y);
  {
    const g = fore.g;
    const rim = unwound ? '#ffb8a0' : '#f0b25a';
    rockMass(g, r, { x: 20, y: 752, w: 290, h: 84, fill: '#2a2020', rim, light: { x: 0.5, y: -1 } });
    rockMass(g, r, { x: 1262, y: 756, w: 300, h: 90, fill: '#2a2020', rim, light: { x: -0.5, y: -1 } });
    // a fallen column drum on its side
    g.save();
    g.translate(1096, 716);
    g.rotate(-0.08);
    g.fillStyle = vgrad(g, -22, 22, [[0, '#5a4a42'], [1, '#221a16']]);
    g.fillRect(-64, -22, 128, 44);
    g.strokeStyle = rgba('#140e0c', 0.5);
    g.lineWidth = 2;
    for (let y = -16; y <= 16; y += 8) { g.beginPath(); g.moveTo(-64, y); g.lineTo(64, y); g.stroke(); }
    g.fillStyle = '#6a5a50';
    g.beginPath(); g.ellipse(-64, 0, 12, 22, 0, 0, TAU); g.fill();
    g.strokeStyle = rgba(rim, 0.6);
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-64, -22); g.lineTo(64, -22); g.stroke();
    g.restore();
    grain(g, -PAD_X, 560, W + PAD_X * 2, H + PAD_Y - 560, 0.07);
  }
  steps.push(fore);

  // --- embers rising from below the rim; phase 2 adds fracture streaks and drifting debris ---
  const embers = makeMotes(makeRand(44), 44, { y0: 120, y1: 720, vx: [-10, 10], vy: [-34, -14], size: [0.9, 2.2], colors: unwound ? ['#ffd0b0', '#ff9a7a', '#fff0e0'] : ['#ffc27a', '#ffe0a0', '#ff9a4a'], amp: 12 });
  const dr = makeRand(4848);
  const debris = [];
  for (let i = 0; i < 12; i++) debris.push({ x: dr.range(40, W - 40), y: dr.range(200, 700), s: dr.range(3, 9), vy: dr.range(-14, -5), ph: dr.range(0, TAU), rot: dr.range(-1, 1) });
  steps.push(anim(0.26, (ctx, t) => {
    drawMotes(ctx, embers, t, 0.85);
    if (!unwound) return;
    drawFractureStreaks(ctx, t);
    // stones lifting off the platform as time comes undone
    const sec = t / 1000;
    for (const d of debris) {
      const y = 720 - ((((720 - d.y) + -d.vy * sec) % 560) + 560) % 560;
      const x = d.x + Math.sin(t * 0.0008 + d.ph) * 10;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(d.rot + t * 0.0004 * d.rot);
      ctx.fillStyle = '#3a2c30';
      ctx.beginPath();
      ctx.moveTo(-d.s, -d.s * 0.4); ctx.lineTo(d.s * 0.2, -d.s * 0.8); ctx.lineTo(d.s, 0); ctx.lineTo(-d.s * 0.3, d.s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 220, 200, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }));
  steps.push(vignette(S, unwound ? '#0a0410' : '#0a0608', 0.62, 0.4));
  return steps;
}

/** Break a painted layer into radial shards around an impact point (phase-2 sky). */
function shatterLayer(S, src, impact) {
  const out = layer(S, src.depth, src.y0, src.y0 + src.h);
  const g = out.g;
  const r = makeRand(4141);
  // the void behind the sky
  g.fillStyle = '#07040c';
  g.fillRect(src.x0, src.y0, src.w, src.h);
  blob(g, impact.x, impact.y, 500, 400, '#5a2a70', 0.5);
  const spokes = 17;
  const angles = [];
  for (let i = 0; i < spokes; i++) angles.push((i / spokes) * TAU + r.range(-0.12, 0.12));
  const radii = [0, 70, 170, 320, 520, 1400];
  const V = angles.map((a) => radii.map((rad, k) => {
    const jr = k === 0 ? 0 : rad * r.range(0.9, 1.1);
    const ja = a + (k ? r.range(-0.05, 0.05) : 0);
    return [impact.x + Math.cos(ja) * jr, impact.y + Math.sin(ja) * jr];
  }));
  const cells = [];
  for (let i = 0; i < spokes; i++) {
    const j = (i + 1) % spokes;
    for (let k = 0; k < radii.length - 1; k++) {
      const pts = k === 0 ? [V[i][0], V[i][1], V[j][1]] : [V[i][k], V[i][k + 1], V[j][k + 1], V[j][k]];
      cells.push({ pts, k });
    }
  }
  for (const c of cells) {
    const cx = c.pts.reduce((a, p) => a + p[0], 0) / c.pts.length;
    const cy = c.pts.reduce((a, p) => a + p[1], 0) / c.pts.length;
    const dx = cx - impact.x, dy = cy - impact.y;
    const dl = Math.hypot(dx, dy) || 1;
    const push = 2 + c.k * 3.5 + r.range(0, 4);
    const ox = (dx / dl) * push + r.range(-2, 2), oy = (dy / dl) * push + r.range(-2, 2);
    g.save();
    poly(g, c.pts);
    g.clip();
    g.drawImage(src.canvas, src.x0 + ox, src.y0 + oy, src.w, src.h);
    const tint = r();
    if (tint < 0.3) { g.fillStyle = rgba('#8a5cc4', 0.16); g.fillRect(src.x0, src.y0, src.w, src.h); }
    else if (tint > 0.8) { g.fillStyle = rgba('#fff0d8', 0.08); g.fillRect(src.x0, src.y0, src.w, src.h); }
    g.restore();
  }
  // glowing fracture lines
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.shadowColor = 'rgba(255, 232, 200, 0.9)';
  g.shadowBlur = 6;
  for (const c of cells) {
    if (r() < 0.25) continue;
    g.strokeStyle = rgba(r() < 0.3 ? '#e0c8ff' : '#fff0d8', r.range(0.25, 0.7));
    g.lineWidth = r.range(0.8, 2);
    poly(g, c.pts);
    g.stroke();
  }
  g.restore();
  return out;
}

const HALO = (() => {
  const r = makeRand(4545);
  const list = [];
  for (let i = 0; i < 16; i++) list.push({ a: (i / 16) * TAU + r.range(-0.1, 0.1), span: r.range(0.14, 0.3), rad: r.range(1.04, 1.28), w: r.range(10, 22), sp: r.range(0.6, 1.4), ph: r.range(0, TAU) });
  return list;
})();

function drawHaloShards(ctx, SUN, t) {
  for (const s of HALO) {
    const a = s.a + t * 0.00005 * s.sp;
    const rr = SUN.r * s.rad + Math.sin(t * 0.0008 + s.ph) * 6;
    ctx.save();
    ctx.translate(SUN.x, SUN.y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.arc(0, 0, rr + s.w / 2, -s.span / 2, s.span / 2);
    ctx.arc(0, 0, rr - s.w / 2, s.span / 2 - 0.02, -s.span / 2 + 0.02, true);
    ctx.closePath();
    const gr = ctx.createLinearGradient(rr - s.w, 0, rr + s.w, 0);
    gr.addColorStop(0, '#b87a3a');
    gr.addColorStop(0.5, '#ffe6b0');
    gr.addColorStop(1, '#c88a4a');
    ctx.fillStyle = gr;
    ctx.globalAlpha = (0.9) * FADE;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,230,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = FADE;
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Time-fracture streaks: bright chromatic slashes that tear across the sky and vanish. */
function drawFractureStreaks(ctx, t) {
  const period = 1700;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let lane = 0; lane < 6; lane++) {
    const tt = t + lane * 397;
    const cycle = Math.floor(tt / period);
    const u = (tt % period) / period;
    if (u > 0.4) continue;
    const k = u / 0.4;
    const seed = cycle * 13 + lane * 101;
    const x0 = hash(seed) * W;
    const y0 = hash(seed + 1) * 320;
    const ang = -0.35 + hash(seed + 2) * 0.7 + (hash(seed + 3) < 0.5 ? 0 : Math.PI);
    const len = 180 + hash(seed + 4) * 320;
    const head = len * Math.min(1, k * 1.6);
    const tail = len * Math.max(0, k * 1.6 - 0.6);
    const a = Math.sin(Math.PI * k);
    const hx = x0 + Math.cos(ang) * head, hy = y0 + Math.sin(ang) * head;
    const tx = x0 + Math.cos(ang) * tail, ty = y0 + Math.sin(ang) * tail;
    for (const [col, off, w, al] of [['#ff6ad5', -2, 3, 0.45], ['#6ad5ff', 2, 3, 0.45], ['#fff6e8', 0, 1.6, 0.95]]) {
      ctx.strokeStyle = rgba(col, al * a);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(tx, ty + off);
      ctx.lineTo(hx, hy + off);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------------------------
// Zone: the training camp
// ---------------------------------------------------------------------------------------------

function tent(g, r, { x, base, w, h, canvas = '#d8c8a8', lit = '#f4e2c0', shade: dark = '#7a6a5a', lightX }) {
  const apex = [x, base - h];
  const left = [x - w / 2, base];
  const right = [x + w / 2, base];
  const litLeft = lightX < x;
  // two faces
  poly(g, [apex, left, [x - w * 0.08, base]]);
  g.fillStyle = litLeft ? lit : dark;
  g.fill();
  poly(g, [apex, [x - w * 0.08, base], right]);
  g.fillStyle = vgrad(g, base - h, base, [[0, litLeft ? mix(canvas, dark, 0.3) : lit], [1, litLeft ? mix(canvas, dark, 0.5) : canvas]]);
  g.fill();
  // doorway glowing warm from a lantern inside
  poly(g, [[x + w * 0.02, base - h * 0.52], [x - w * 0.1, base], [x + w * 0.18, base]]);
  g.fillStyle = '#3a2418';
  g.fill();
  blob(g, x + w * 0.03, base - h * 0.12, w * 0.18, h * 0.22, '#ffb860', 0.6);
  // seams + ropes
  g.strokeStyle = rgba('#5a4a3a', 0.5);
  g.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    g.beginPath();
    g.moveTo(apex[0], apex[1]);
    g.lineTo(lerp(left[0], right[0], k / 4), base);
    g.stroke();
  }
  g.strokeStyle = rgba('#3a2a1c', 0.8);
  g.beginPath();
  g.moveTo(apex[0], apex[1]); g.lineTo(x - w * 0.85, base + 2);
  g.moveTo(apex[0], apex[1]); g.lineTo(x + w * 0.85, base + 2);
  g.stroke();
  g.strokeStyle = '#4a3422';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(apex[0], apex[1] - 10); g.lineTo(apex[0], apex[1] + 4);
  g.stroke();
  g.strokeStyle = rgba('#fff0d0', 0.6);
  g.lineWidth = 1.5;
  g.beginPath();
  if (litLeft) { g.moveTo(apex[0], apex[1]); g.lineTo(left[0], left[1]); }
  else { g.moveTo(apex[0], apex[1]); g.lineTo(right[0], right[1]); }
  g.stroke();
}

function crate(g, x, y, w, h, lightLeft) {
  g.fillStyle = '#6a4a2c';
  g.fillRect(x, y - h, w, h);
  g.fillStyle = rgba(lightLeft ? '#ffd9a0' : '#1a1008', 0.3);
  g.fillRect(lightLeft ? x : x + w * 0.6, y - h, w * 0.4, h);
  g.strokeStyle = '#3a2614';
  g.lineWidth = 2;
  g.strokeRect(x + 1, y - h + 1, w - 2, h - 2);
  g.beginPath();
  g.moveTo(x + 2, y - h + 2); g.lineTo(x + w - 2, y - 2);
  g.stroke();
}

function catenary(x0, y0, x1, y1, sag, u) {
  return [lerp(x0, x1, u), lerp(y0, y1, u) + sag * 4 * u * (1 - u)];
}

function buildTraining(S) {
  const P = ZONE_PALETTES.training;
  const r = makeRand(5505);
  const HZ = 338;
  const SUN = { x: 230, y: 250, r: 46 };
  const steps = [];
  const skyStops = [[0, P.sky[0]], [0.4, P.sky[1]], [0.78, P.sky[2]], [1, P.sky[3]]];
  const rope = { x0: 172, y0: 118, x1: 1108, y1: 110, sag: 74 };
  const lanterns = [];
  for (let i = 0; i < 8; i++) {
    const u = 0.08 + (i / 7) * 0.84;
    const [x, y] = catenary(rope.x0, rope.y0, rope.x1, rope.y1, rope.sag, u);
    lanterns.push({ x, y, ph: i * 1.7 });
  }
  const FIRE = { x: 690, y: HZ + 12 };
  const FLAG = { x: 598, top: 96 };

  // --- evening sky ---
  const sky = layer(S, 0.02, -PAD_Y, HZ + 20);
  {
    const g = sky.g;
    g.fillStyle = vgrad(g, -PAD_Y, HZ, skyStops);
    g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 20 + PAD_Y);
    blob(g, SUN.x, SUN.y + 30, 640, 220, '#ffd9a0', 0.45);
    blob(g, SUN.x, SUN.y, 120, 110, '#fff2d8', 0.7);
    stars(g, r, 60, -PAD_Y, 110, 0.6);
    strokes(g, r, { x: -PAD_X, y: -PAD_Y, w: W + PAD_X * 2, h: HZ + PAD_Y, n: 420, len: [50, 200], width: [2, 7], alpha: [0.05, 0.12], color: (x, y) => shade(colorAt(skyStops, (y + PAD_Y) / (HZ + PAD_Y)), r.range(-0.12, 0.12)), jitter: 0.06 });
    cloudBank(g, r, { x: 540, y: 146, w: 560, h: 44, body: '#5e4858', lit: '#ffcf9a', light: { x: -0.7, y: 0.8 } });
    cloudBank(g, r, { x: 1030, y: 186, w: 640, h: 50, body: '#634c5c', lit: '#f5c090', light: { x: -0.9, y: 0.6 } });
    cloudBank(g, r, { x: 110, y: 200, w: 380, h: 26, body: '#8a6468', lit: '#fff0c8', light: { x: 0.3, y: 1 }, alpha: 0.75 });
    cloudBank(g, r, { x: 820, y: 90, w: 420, h: 24, body: '#4a3a4e', lit: '#e8a890', light: { x: -0.8, y: 0.7 }, alpha: 0.7 });
    gulls(g, [[760, 110, 0.7], [790, 100, 0.6], [812, 118, 0.5]]);
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 20 + PAD_Y, 0.05);
  }
  steps.push(sky);
  steps.push(anim(0.02, (ctx, t) => drawCorona(ctx, SUN.x, SUN.y, SUN.r, t, '#ffe6b8', 0.45)));
  steps.push(sunLayer(S, 0.02, SUN, { color: P.sun, detail: 0.35, numerals: false }));

  // --- hills and treeline ---
  const far = layer(S, 0.06, 150, HZ + 30);
  {
    const g = far.g;
    const hills = (base, amp, col, rimC, seed) => {
      const rr = makeRand(seed);
      const pts = ridge(rr, -PAD_X, W + PAD_X, (u) => base - Math.sin(u * 5 + seed) * amp - Math.sin(u * 13 + seed * 2) * amp * 0.3, 60, 3);
      poly(g, [[-PAD_X, HZ + 30], ...pts, [W + PAD_X, HZ + 30]]);
      g.fillStyle = col;
      g.fill();
      rimLight(g, pts, SUN.x, SUN.y - 200, rimC, 1.5, 0.6, false);
    };
    hills(270, 26, '#8a6a78', '#ffd0a0', 3);
    hills(300, 18, '#6a4e62', '#ffc890', 7);
    // pine treeline
    for (let x = -PAD_X; x < W + PAD_X; x += r.range(8, 16)) {
      const h = r.range(28, 70) * (0.7 + 0.3 * Math.sin(x * 0.01));
      const b = HZ + r.range(-4, 2);
      const w = h * r.range(0.28, 0.4);
      g.fillStyle = mix('#2e2530', '#4a3440', r() * 0.4);
      poly(g, [[x - w, b], [x, b - h], [x + w, b]]);
      g.fill();
      if (x < 640) {
        g.strokeStyle = rgba('#ffc890', 0.35);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, b - h);
        g.lineTo(x - w, b);
        g.stroke();
      }
    }
    blob(g, SUN.x + 100, HZ - 10, 500, 40, '#ffd9a0', 0.3);
    grain(g, -PAD_X, 150, W + PAD_X * 2, HZ + 30 - 150, 0.05);
  }
  steps.push(far);

  // --- the camp ---
  const camp = layer(S, 0.12, 40, HZ + 40);
  {
    const g = camp.g;
    tent(g, r, { x: 96, base: HZ + 10, w: 170, h: 118, lightX: SUN.x });
    tent(g, r, { x: 1180, base: HZ + 12, w: 190, h: 128, lightX: SUN.x });
    tent(g, r, { x: 1060, base: HZ + 4, w: 120, h: 80, lightX: SUN.x, canvas: '#c8b898', lit: '#e8d4b0', shade: '#6a5a4a' });
    crate(g, 190, HZ + 14, 34, 28, true);
    crate(g, 216, HZ + 14, 26, 20, true);
    crate(g, 980, HZ + 12, 30, 26, true);
    // barrels
    for (const [bx, by] of [[1000, HZ + 14], [236, HZ + 12]]) {
      g.fillStyle = '#5a3a24';
      g.beginPath();
      g.ellipse(bx, by - 16, 12, 17, 0, 0, TAU);
      g.fill();
      g.strokeStyle = '#2a1a10';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(bx - 12, by - 22); g.lineTo(bx + 12, by - 22);
      g.moveTo(bx - 12, by - 9); g.lineTo(bx + 12, by - 9);
      g.stroke();
    }
    // poles + lantern rope
    for (const [x, y] of [[rope.x0, rope.y0], [rope.x1, rope.y1]]) {
      g.fillStyle = '#3a2818';
      g.fillRect(x - 3, y - 6, 6, HZ + 12 - y);
      g.fillStyle = rgba('#ffd9a0', 0.5);
      g.fillRect(x - 3, y - 6, 1.5, HZ + 12 - y);
    }
    g.strokeStyle = rgba('#2a1c12', 0.9);
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const [x, y] = catenary(rope.x0, rope.y0, rope.x1, rope.y1, rope.sag, i / 40);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    for (const L of lanterns) {
      g.strokeStyle = '#2a1c12';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(L.x, L.y); g.lineTo(L.x, L.y + 8);
      g.stroke();
      g.fillStyle = '#6f5426';
      g.fillRect(L.x - 6, L.y + 8, 12, 3);
      g.fillStyle = '#ffd98a';
      g.fillRect(L.x - 5, L.y + 11, 10, 12);
      g.fillStyle = '#6f5426';
      g.fillRect(L.x - 6, L.y + 23, 12, 3);
      g.strokeStyle = rgba('#6f5426', 0.9);
      g.beginPath();
      g.moveTo(L.x, L.y + 11); g.lineTo(L.x, L.y + 23);
      g.stroke();
    }
    // flag pole
    g.fillStyle = '#3a2818';
    g.fillRect(FLAG.x - 2.5, FLAG.top, 5, HZ + 12 - FLAG.top);
    g.beginPath();
    g.arc(FLAG.x, FLAG.top - 2, 5, 0, TAU);
    g.fillStyle = '#e0b458';
    g.fill();
    // campfire stones and logs
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      g.fillStyle = mix('#5a4a44', '#8a7a70', r());
      g.beginPath();
      g.ellipse(FIRE.x + Math.cos(a) * 26, FIRE.y + Math.sin(a) * 6 + 2, 7, 5, 0, 0, TAU);
      g.fill();
    }
    g.strokeStyle = '#3a2414';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(FIRE.x - 18, FIRE.y + 2); g.lineTo(FIRE.x + 14, FIRE.y - 8);
    g.moveTo(FIRE.x + 18, FIRE.y + 2); g.lineTo(FIRE.x - 12, FIRE.y - 9);
    g.stroke();
    blob(g, FIRE.x, FIRE.y, 120, 30, '#ffb060', 0.35);
    // weapon stand beside the fire
    g.strokeStyle = '#3a2818';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(790, HZ + 12); g.lineTo(804, HZ - 36);
    g.moveTo(818, HZ + 12); g.lineTo(804, HZ - 36);
    g.stroke();
    g.strokeStyle = '#c8c0b0';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(796, HZ - 30); g.lineTo(830, HZ - 56);
    g.stroke();
    grain(g, -PAD_X, 40, W + PAD_X * 2, HZ, 0.05);
  }
  steps.push(camp);

  // --- trampled clearing ---
  const ground = layer(S, 0.18, HZ - 10, H + PAD_Y);
  {
    const g = ground.g;
    g.fillStyle = vgrad(g, HZ, H + PAD_Y, [[0, '#8a7a50'], [0.2, '#76663e'], [0.6, '#4e4428'], [1, '#221c10']]);
    g.fillRect(-PAD_X, HZ + 8, W + PAD_X * 2, H + PAD_Y - HZ);
    // the sparring clearing: trampled earth, painted with soft irregular dabs so it has no hard rim
    for (let i = 0; i < 260; i++) {
      const a = r() * TAU;
      const d = Math.sqrt(r()) * r.range(0.7, 1);
      const x = 640 + Math.cos(a) * 520 * d, y = 494 + Math.sin(a) * 148 * d;
      blob(g, x, y, r.range(50, 120), r.range(16, 36), r.pick(['#a08462', '#94785a', '#ac8e68']), r.range(0.12, 0.22));
    }
    strokes(g, r, { x: 140, y: 380, w: 1000, h: 230, n: 500, len: [20, 70], width: [2, 6], alpha: [0.04, 0.1], color: ['#c8a880', '#6a543c', '#b89a70'], jitter: 0.1, curve: 0.1, where: (x, y) => ((x - 640) / 520) ** 2 + ((y - 494) / 140) ** 2 < 1 });
    blob(g, FIRE.x, HZ + 40, 300, 60, '#ffb870', 0.22);
    blob(g, SUN.x, HZ + 40, 520, 60, '#ffd9a0', 0.2);
    const onDirt = (x, y) => ((x - 640) / 520) ** 2 + ((y - 494) / 146) ** 2 < 0.8 + 0.2 * Math.sin(x * 0.02);
    strokes(g, r, { x: -PAD_X, y: HZ + 8, w: W + PAD_X * 2, h: H - HZ + PAD_Y, n: 3000, len: [6, 16], width: [1, 2], alpha: [0.3, 0.7], color: ['#8a8a48', '#a89a50', '#6a6a38', '#c8b060', '#5a5a30'], angle: -Math.PI / 2, jitter: 0.8, curve: 0.3, where: (x, y) => !onDirt(x, y) || r() < 0.06 });
    dabs(g, r, { x: 40, y: HZ + 20, w: 1200, h: 340, n: 1600, size: [0.7, 2], alpha: [0.1, 0.25], color: ['#d8c0a0', '#5a4a38', '#8a7458'], squash: 0.6, where: onDirt });
    // a chalk sparring line, scuffed by practice
    for (let i = 0; i < 120; i++) {
      const a0 = (i / 120) * TAU;
      if (r() < 0.25) continue;
      const a1 = a0 + TAU / 140;
      g.strokeStyle = rgba('#efe4cc', r.range(0.08, 0.2));
      g.lineWidth = r.range(1.5, 3);
      g.beginPath();
      g.moveTo(640 + Math.cos(a0) * 470, 494 + Math.sin(a0) * 132);
      g.lineTo(640 + Math.cos(a1) * 470, 494 + Math.sin(a1) * 132);
      g.stroke();
    }
    blob(g, -60, 680, 480, 280, '#1a1410', 0.5);
    blob(g, W + 60, 680, 480, 280, '#1a1410', 0.5);
    grain(g, -PAD_X, HZ - 10, W + PAD_X * 2, H + PAD_Y - HZ + 10, 0.06);
  }
  steps.push(ground);

  // --- fire, lantern glows, pennant ---
  const sparks = makeMotes(makeRand(55), 18, { x0: FIRE.x - 40, x1: FIRE.x + 40, y0: HZ - 140, y1: HZ + 6, vx: [-6, 6], vy: [-40, -20], size: [0.8, 1.6], colors: ['#ffc070', '#ffe0a0'], amp: 6 });
  steps.push(anim(0.12, (ctx, t) => {
    ctx.globalCompositeOperation = 'lighter';
    for (const L of lanterns) {
      const f = 0.75 + 0.15 * Math.sin(t * 0.009 + L.ph) + 0.1 * Math.sin(t * 0.023 + L.ph * 2);
      const s = 34 * f;
      ctx.globalAlpha = (0.75 * f) * FADE;
      ctx.drawImage(glowSprite('#ffc070'), L.x - s, L.y + 17 - s, s * 2, s * 2);
    }
    // flames
    const fl = 0.85 + 0.15 * Math.sin(t * 0.017);
    ctx.globalAlpha = (0.8) * FADE;
    ctx.drawImage(glowSprite('#ff9a40'), FIRE.x - 70 * fl, FIRE.y - 50 - 40 * fl, 140 * fl, 110 * fl);
    for (let i = 0; i < 5; i++) {
      const ph = t * 0.012 + i * 1.3;
      const h = 30 + 12 * Math.sin(ph) + i * 3;
      const x = FIRE.x + (i - 2) * 6 + Math.sin(ph * 0.7) * 3;
      const w = 10 - Math.abs(i - 2) * 2;
      const gr = ctx.createLinearGradient(0, FIRE.y, 0, FIRE.y - h);
      gr.addColorStop(0, rgba('#fff0b0', 0.95));
      gr.addColorStop(0.4, rgba('#ffa040', 0.8));
      gr.addColorStop(1, rgba('#e2733b', 0));
      ctx.fillStyle = gr;
      ctx.globalAlpha = FADE;
      ctx.beginPath();
      ctx.moveTo(x - w, FIRE.y);
      ctx.quadraticCurveTo(x - w * 0.8, FIRE.y - h * 0.5, x + Math.sin(ph) * 4, FIRE.y - h);
      ctx.quadraticCurveTo(x + w * 0.8, FIRE.y - h * 0.5, x + w, FIRE.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = FADE;
    ctx.globalCompositeOperation = 'source-over';
    drawMotes(ctx, sparks, t, 0.9);
    // pennant with the expedition's sun
    const fy = FLAG.top + 4;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const wave = Math.sin(t * 0.004 - u * 5) * 5 * u;
      pts.push([FLAG.x + 3 + u * 96, fy + wave, fy + 46 - u * 30 + wave]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][2]);
    ctx.closePath();
    const gr = ctx.createLinearGradient(FLAG.x, 0, FLAG.x + 96, 0);
    gr.addColorStop(0, '#8a2420');
    gr.addColorStop(1, '#b8403a');
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.strokeStyle = rgba('#e0b458', 0.8);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const mid = pts[3];
    const cy = (mid[1] + mid[2]) / 2;
    ctx.fillStyle = '#e0b458';
    ctx.beginPath();
    ctx.arc(mid[0], cy, 8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#e0b458';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.moveTo(mid[0] + Math.cos(a) * 10, cy + Math.sin(a) * 10);
      ctx.lineTo(mid[0] + Math.cos(a) * 14, cy + Math.sin(a) * 14);
    }
    ctx.stroke();
  }));

  // --- foreground: weapon rack and a straw bale ---
  const fore = layer(S, 0.3, 520, H + PAD_Y);
  {
    const g = fore.g;
    // rack
    g.fillStyle = '#3a2616';
    g.fillRect(-20, 600, 150, 10);
    g.fillRect(-20, 660, 150, 10);
    g.fillRect(8, 580, 8, 150);
    g.fillRect(112, 580, 8, 150);
    g.strokeStyle = rgba('#ffd9a0', 0.45);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-20, 600); g.lineTo(130, 600);
    g.stroke();
    // saber, rapier and a spear resting on it
    const blade = (x0, y0, x1, y1, col, w) => {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    };
    blade(30, 720, 44, 540, '#d8d0c0', 3.5);
    blade(26, 690, 48, 690, '#b8893b', 4);
    blade(64, 720, 70, 548, '#e8e4dc', 2);
    g.strokeStyle = '#e0b458';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(66, 690, 7, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    blade(96, 730, 100, 520, '#5a3a24', 4);
    g.fillStyle = '#c8c0b0';
    poly(g, [[100, 520], [96, 540], [104, 540]]);
    g.fill();
    for (let i = 0; i < 5; i++) tuft(g, r, r.range(-40, 170), r.range(700, 724), r.range(24, 40), 12, ['#6a6a38', '#8a8a48', '#4a4a28'], '#ffd9a0', 0.3);
    // straw bale with a painted practice target
    g.fillStyle = '#b89a50';
    g.beginPath();
    g.moveTo(1130, 720); g.lineTo(1140, 640); g.lineTo(1300, 636); g.lineTo(1300, 724);
    g.closePath();
    g.fill();
    strokes(g, r, { x: 1134, y: 640, w: 170, h: 84, n: 160, len: [10, 30], width: [1, 2], alpha: [0.3, 0.6], color: ['#e8d080', '#8a7030', '#d8b860'], angle: 0, jitter: 0.6 });
    g.strokeStyle = '#6a4a20';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(1136, 668); g.lineTo(1300, 664);
    g.moveTo(1133, 700); g.lineTo(1300, 697);
    g.stroke();
    g.beginPath();
    g.arc(1214, 680, 24, 0, TAU);
    g.fillStyle = rgba('#f5eedf', 0.85);
    g.fill();
    g.beginPath();
    g.arc(1214, 680, 15, 0, TAU);
    g.fillStyle = '#a3302a';
    g.fill();
    g.beginPath();
    g.arc(1214, 680, 6, 0, TAU);
    g.fillStyle = '#f5eedf';
    g.fill();
    for (let i = 0; i < 4; i++) tuft(g, r, r.range(1120, 1330), r.range(710, 726), r.range(22, 36), 10, ['#6a6a38', '#8a8a48', '#4a4a28'], '#ffd9a0', -0.3);
    grain(g, -PAD_X, 520, W + PAD_X * 2, H + PAD_Y - 520, 0.07);
  }
  steps.push(fore);
  const flies = makeMotes(makeRand(56), 22, { y0: 260, y1: 700, vx: [-8, 8], vy: [-6, 6], size: [0.9, 1.8], colors: ['#fff0a0', '#e8ffa0'], amp: 18 });
  steps.push(anim(0.3, (ctx, t) => drawMotes(ctx, flies, t, 0.8)));
  steps.push(vignette(S, '#120c0c', 0.55, 0.3));
  return steps;
}

// ---------------------------------------------------------------------------------------------
// Title key art
// ---------------------------------------------------------------------------------------------

const SHIP_W = 520;
const SHIP_H = 310;
const SHIP_OX = 290; // waterline origin inside the sprite (wide left margin: the funnel plume trails that way)
const SHIP_OY = 262;

function shipSprite(S) {
  const key = `ship|${S}`;
  return cachedSprite(key, SHIP_W * S, SHIP_H * S, (g) => {
    g.scale(S, S);
    g.translate(SHIP_OX, SHIP_OY);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const hull = '#1c1522';
    const rim = '#ffc88a';
    const sailLit = '#f1e2c4';
    const sailMid = '#cdb89a';
    const sailDark = '#7c6a64';
    // smoke plume trailing back from the funnel (painted, soft)
    const r = makeRand(99);
    for (let i = 0; i < 14; i++) {
      const u = i / 13;
      blob(g, -40 - u * 150, -176 - u * 26 + Math.sin(u * 5) * 8, 20 + u * 26, 12 + u * 14, '#9a8a90', 0.29 - 0.25 * u * u);
    }
    // masts
    const masts = [{ x: -92, h: 196 }, { x: -6, h: 226 }, { x: 74, h: 186 }];
    g.strokeStyle = '#241a1c';
    for (const m of masts) {
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(m.x, -24);
      g.lineTo(m.x + 2, -24 - m.h);
      g.stroke();
    }
    // funnel
    g.fillStyle = '#231a1e';
    g.fillRect(-52, -104, 20, 80);
    g.fillStyle = '#8a2a24';
    g.fillRect(-52, -96, 20, 9);
    g.fillStyle = rgba(rim, 0.6);
    g.fillRect(-34, -104, 2, 80);
    // square sails, billowing slightly, lit on the sun side (right)
    for (const m of masts) {
      const tiers = m.h > 200 ? 3 : 3;
      for (let k = 0; k < tiers; k++) {
        const top = -24 - m.h + 16 + k * (m.h - 40) / tiers;
        const hgt = (m.h - 56) / tiers - 4;
        const w = 58 - k * -8 - (m === masts[2] ? 6 : 0);
        const x0 = m.x - w / 2, x1 = m.x + w / 2;
        g.beginPath();
        g.moveTo(x0, top);
        g.lineTo(x1, top);
        g.quadraticCurveTo(x1 + 8, top + hgt * 0.5, x1 + 2, top + hgt);
        g.lineTo(x0 + 2, top + hgt);
        g.quadraticCurveTo(x0 + 8, top + hgt * 0.5, x0, top);
        g.closePath();
        const gr = g.createLinearGradient(x0, 0, x1 + 8, 0);
        gr.addColorStop(0, sailDark);
        gr.addColorStop(0.55, sailMid);
        gr.addColorStop(1, sailLit);
        g.fillStyle = gr;
        g.fill();
        g.strokeStyle = rgba('#3a2a28', 0.5);
        g.lineWidth = 1;
        g.stroke();
        g.strokeStyle = rgba('#fff4dc', 0.85);
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x1, top);
        g.quadraticCurveTo(x1 + 8, top + hgt * 0.5, x1 + 2, top + hgt);
        g.stroke();
        // yard
        g.strokeStyle = '#241a1c';
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(x0 - 5, top);
        g.lineTo(x1 + 5, top);
        g.stroke();
      }
    }
    // jib sails to the bowsprit
    g.beginPath();
    g.moveTo(74, -200); g.lineTo(196, -58); g.lineTo(96, -52);
    g.closePath();
    const jg = g.createLinearGradient(80, 0, 190, 0);
    jg.addColorStop(0, sailMid);
    jg.addColorStop(1, sailLit);
    g.fillStyle = jg;
    g.fill();
    g.strokeStyle = rgba('#fff4dc', 0.8);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(74, -200); g.lineTo(196, -58);
    g.stroke();
    // rigging
    g.strokeStyle = rgba('#241a1c', 0.8);
    g.lineWidth = 0.8;
    g.beginPath();
    for (const m of masts) {
      g.moveTo(m.x + 2, -24 - m.h);
      g.lineTo(m.x - 40, -26);
      g.moveTo(m.x + 2, -24 - m.h);
      g.lineTo(m.x + 40, -30);
    }
    g.moveTo(-4, -250); g.lineTo(206, -60);
    g.moveTo(-90, -220); g.lineTo(-150, -44);
    g.stroke();
    // pennant
    g.fillStyle = '#a3302a';
    poly(g, [[-4, -250], [34, -244], [-4, -238]]);
    g.fill();
    // hull
    g.beginPath();
    g.moveTo(-150, -46);
    g.lineTo(-138, 2);
    g.quadraticCurveTo(0, 14, 132, 2);
    g.quadraticCurveTo(160, -12, 172, -34);
    g.quadraticCurveTo(40, -24, -150, -46);
    g.closePath();
    const hg = g.createLinearGradient(0, -46, 0, 10);
    hg.addColorStop(0, '#2c2230');
    hg.addColorStop(1, hull);
    g.fillStyle = hg;
    g.fill();
    // gold band and portholes
    g.strokeStyle = '#b8893b';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-146, -30);
    g.quadraticCurveTo(20, -14, 166, -26);
    g.stroke();
    for (let i = 0; i < 9; i++) {
      const x = -118 + i * 28;
      const y = -20 + Math.abs(x) * 0.02;
      g.fillStyle = rgba('#ffd28a', 0.9);
      g.beginPath();
      g.arc(x, y, 2.2, 0, TAU);
      g.fill();
    }
    // bow rim light facing the sun
    g.strokeStyle = rgba(rim, 0.9);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(40, -24);
    g.quadraticCurveTo(140, -24, 172, -34);
    g.quadraticCurveTo(160, -12, 132, 2);
    g.stroke();
    // bowsprit + stern lantern post
    g.strokeStyle = '#241a1c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(160, -30); g.lineTo(212, -56);
    g.moveTo(-146, -46); g.lineTo(-150, -62);
    g.stroke();
    // cabin at the stern
    g.fillStyle = '#261c26';
    g.fillRect(-136, -62, 46, 20);
    g.fillStyle = rgba('#ffd28a', 0.85);
    for (let i = 0; i < 3; i++) g.fillRect(-130 + i * 14, -56, 6, 6);
    // tiny figures on deck looking toward the sun
    g.fillStyle = '#16101a';
    for (const [x, h] of [[18, 12], [30, 13], [44, 11]]) {
      g.fillRect(x - 2, -24 - h, 4, h);
      g.beginPath();
      g.arc(x, -26 - h, 2.6, 0, TAU);
      g.fill();
    }
    void r;
  });
}

function buildTitle(S) {
  const r = makeRand(9909);
  const HZ = 468;
  const SUN = { x: 640, y: 282, r: 168 };
  const SHIP = { x: 350, y: 560, s: 0.92 };
  const steps = [];
  const skyStops = [[0, '#0f0c1c'], [0.28, '#2a2046'], [0.52, '#63395a'], [0.76, '#c9735a'], [0.9, '#efb07a'], [1, '#f7d49a']];

  // --- sky + sun ---
  const sky = layer(S, 0.02, -PAD_Y, HZ + 20);
  {
    const g = sky.g;
    g.fillStyle = vgrad(g, -PAD_Y, HZ, skyStops);
    g.fillRect(-PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 20 + PAD_Y);
    blob(g, SUN.x, SUN.y + 60, 900, 360, '#f0a070', 0.4);
    blob(g, -80, -40, 600, 360, '#0a0814', 0.6);
    blob(g, W + 80, -40, 600, 360, '#0a0814', 0.6);
    strokes(g, r, { x: -PAD_X, y: -PAD_Y, w: W + PAD_X * 2, h: HZ + PAD_Y, n: 700, len: [60, 240], width: [2, 9], alpha: [0.04, 0.12], color: (x, y) => shade(colorAt(skyStops, (y + PAD_Y) / (HZ + PAD_Y)), r.range(-0.12, 0.12)), jitter: 0.05, curve: 0.04 });
    stars(g, r, 180, -PAD_Y, 230, 0.8);
    // clouds lit toward the sun
    const toSun = (x, y) => { const dx = SUN.x - x, dy = SUN.y - y; const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
    for (const c of [
      { x: 150, y: 250, w: 560, h: 56, body: '#43294a', lit: '#f0a080' }, { x: 1130, y: 236, w: 600, h: 62, body: '#43294a', lit: '#f0a080' },
      { x: 300, y: 150, w: 460, h: 30, body: '#2e2038', lit: '#c8807a' }, { x: 990, y: 124, w: 500, h: 30, body: '#2e2038', lit: '#c8807a' },
    ]) cloudBank(g, r, { ...c, light: toSun(c.x, c.y), alpha: 0.95 });
    blob(g, SUN.x, SUN.y, SUN.r * 2.2, SUN.r * 2.2, '#ffe4b0', 0.3);
    gulls(g, [[420, 200, 0.9], [452, 188, 0.7], [470, 214, 0.8], [880, 170, 0.7], [906, 182, 0.6]], '#2a1c30', 1.2);
    grain(g, -PAD_X, -PAD_Y, W + PAD_X * 2, HZ + 20 + PAD_Y, 0.05);
  }
  steps.push(sky);
  steps.push(anim(0.02, (ctx, t) => drawCorona(ctx, SUN.x, SUN.y, SUN.r, t, '#ffe0a8', 0.55)));
  steps.push(sunLayer(S, 0.02, SUN, { color: '#ffd79a', detail: 0.95, numerals: true }));
  // low banks drifting in front of the disc
  const low = layer(S, 0.025, 300, HZ + 10);
  {
    const g = low.g;
    const rr = makeRand(9912);
    const toSun = (x, y) => { const dx = SUN.x - x, dy = SUN.y - y; const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
    cloudBank(g, rr, { x: 200, y: 366, w: 700, h: 48, body: '#6e3e56', lit: '#ffc890', light: toSun(200, 366), alpha: 0.95 });
    cloudBank(g, rr, { x: 1080, y: 358, w: 700, h: 52, body: '#6e3e56', lit: '#ffc890', light: toSun(1080, 358), alpha: 0.95 });
    cloudBank(g, rr, { x: 600, y: 402, w: 560, h: 18, body: '#e0906e', lit: '#fff0d0', light: { x: 0, y: -1 }, alpha: 0.85 });
    cloudBank(g, rr, { x: 740, y: 430, w: 660, h: 15, body: '#d0806a', lit: '#ffe0b0', light: { x: 0, y: -1 }, alpha: 0.8 });
    cloudBank(g, rr, { x: 470, y: 446, w: 420, h: 10, body: '#c87a66', lit: '#ffe0b0', light: { x: 0.4, y: -1 }, alpha: 0.7 });
  }
  steps.push(low);
  const tw = makeRand(91);
  const twinkles = [];
  for (let i = 0; i < 40; i++) twinkles.push({ x: tw.range(-PAD_X, W + PAD_X), y: Math.pow(tw(), 1.5) * 200 - 20, ph: tw.range(0, TAU), f: tw.range(0.001, 0.003), s: tw.range(4, 9) });
  steps.push(anim(0.02, (ctx, t) => {
    ctx.globalCompositeOperation = 'lighter';
    for (const s of twinkles) {
      const a = Math.pow(Math.max(0, Math.sin(t * s.f + s.ph)), 3);
      if (a < 0.02) continue;
      ctx.globalAlpha = (a * 0.8) * FADE;
      ctx.drawImage(glowSprite('#fff4e0'), s.x - s.s, s.y - s.s, s.s * 2, s.s * 2);
    }
    ctx.globalAlpha = FADE;
    ctx.globalCompositeOperation = 'source-over';
    // the second hand trembles against the stopped mechanism — it never advances
    const a = -Math.PI / 2 + 0.95 + Math.sin(t * 0.03) * 0.004 + (Math.sin(t * 0.0011) > 0.97 ? 0.012 : 0);
    ctx.save();
    ctx.translate(SUN.x, SUN.y);
    ctx.rotate(a);
    ctx.strokeStyle = 'rgba(120, 60, 20, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-SUN.r * 0.18, 0);
    ctx.lineTo(SUN.r * 0.86, 0);
    ctx.stroke();
    ctx.restore();
  }));

  // --- the Meridian Spire on the horizon + distant cliffs ---
  const far = layer(S, 0.05, 200, HZ + 30);
  {
    const g = far.g;
    const hazeA = '#8e5a64';
    for (const [x0, x1, peak, seed] of [[-PAD_X, 300, 436, 3], [1010, W + PAD_X, 430, 5], [860, 1010, 458, 8]]) {
      const rr = makeRand(seed);
      const pts = ridge(rr, x0, x1, (u) => HZ - Math.sin(u * Math.PI) * (HZ - peak) - Math.sin(u * 17) * 3, 30, 3);
      poly(g, [[x0, HZ + 2], ...pts, [x1, HZ + 2]]);
      g.fillStyle = vgrad(g, peak, HZ, [[0, shade(hazeA, -0.2)], [1, mix(hazeA, '#f0b080', 0.4)]]);
      g.fill();
      rimLight(g, pts, SUN.x, SUN.y, '#ffd0a0', 1.5, 0.7, false);
    }
    // the Meridian Spire: a slender Belle-Époque needle rising in front of the sun
    const sx = SUN.x;
    const spire = '#26182a';
    const tiers = [[HZ + 1, 22], [HZ - 34, 18], [HZ - 78, 13], [HZ - 120, 9.5], [HZ - 152, 6.5], [HZ - 176, 4], [HZ - 196, 2.2]];
    g.fillStyle = spire;
    g.beginPath();
    g.moveTo(sx - tiers[0][1] - 8, HZ + 2);
    for (const [y, w] of tiers) { g.lineTo(sx - w, y); g.lineTo(sx - w * 0.82, y - 6); }
    g.lineTo(sx, HZ - 238);
    for (let i = tiers.length - 1; i >= 0; i--) { const [y, w] = tiers[i]; g.lineTo(sx + w * 0.82, y - 6); g.lineTo(sx + w, y); }
    g.lineTo(sx + tiers[0][1] + 8, HZ + 2);
    g.closePath();
    g.fill();
    for (const [y, w] of tiers.slice(1, 6)) {
      g.fillStyle = spire;
      g.fillRect(sx - w - 4, y - 2, w * 2 + 8, 3);
      g.fillStyle = rgba('#ffe0b0', 0.55);
      g.fillRect(sx + w * 0.2, y - 2, w + 4, 1);
    }
    g.fillStyle = rgba('#ffd28a', 0.9);
    for (const [y, w] of tiers.slice(0, 5)) {
      g.fillRect(sx - 1, y - 16, 2, 3.5);
      if (w > 9) { g.fillRect(sx - w * 0.55, y - 12, 1.6, 3); g.fillRect(sx + w * 0.45, y - 12, 1.6, 3); }
    }
    g.strokeStyle = spire;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(sx - 60, HZ + 2); g.quadraticCurveTo(sx - 30, HZ - 36, sx - 16, HZ - 50);
    g.moveTo(sx + 60, HZ + 2); g.quadraticCurveTo(sx + 30, HZ - 36, sx + 16, HZ - 50);
    g.stroke();
    g.strokeStyle = rgba('#fff0c8', 0.75);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(sx, HZ - 238);
    for (const [y, w] of tiers.slice().reverse()) g.lineTo(sx + w * 0.82, y - 6);
    g.stroke();
    g.strokeStyle = rgba(spire, 0.95);
    g.lineWidth = 2.2;
    g.beginPath();
    g.ellipse(sx, HZ - 214, 11, 3.5, 0, 0, TAU);
    g.stroke();
    grain(g, -PAD_X, 200, W + PAD_X * 2, HZ + 30 - 200, 0.05);
  }
  steps.push(far);

  // --- the sea ---
  const sea = layer(S, 0.08, HZ - 4, H + PAD_Y);
  {
    const g = sea.g;
    g.fillStyle = vgrad(g, HZ - 2, H + PAD_Y, [[0, '#f7c890'], [0.06, '#d58a70'], [0.22, '#6e4a62'], [0.5, '#2c2a48'], [1, '#0c0e1a']]);
    g.fillRect(-PAD_X, HZ - 4, W + PAD_X * 2, H + PAD_Y - HZ + 4);
    blob(g, SUN.x, HZ + 4, 520, 24, '#ffe8c0', 0.8);
    for (let i = 0; i < 1100; i++) {
      const v = Math.pow(r(), 1.6);
      const y = HZ + 1 + v * (H + PAD_Y - HZ);
      const len = (8 + v * 110) * r.range(0.5, 1.3);
      const col = v < 0.2 ? r.pick(['#f7c9a0', '#d9967e', '#a86a70']) : r.pick(['#3a3a60', '#5a4a6a', '#1c1e34', '#8a5a6a', '#2a2c4a']);
      g.strokeStyle = rgba(col, r.range(0.25, 0.6));
      g.lineWidth = 0.8 + v * 3.5;
      const x = r.range(-PAD_X, W + PAD_X);
      g.beginPath();
      g.moveTo(x - len / 2, y);
      g.quadraticCurveTo(x, y - 0.8 - v * 2, x + len / 2, y);
      g.stroke();
    }
    // the sun's reflection column
    for (let i = 0; i < 520; i++) {
      const v = Math.pow(r(), 1.1);
      const y = HZ + 1 + v * (H + 20 - HZ);
      const x = SUN.x + r.gauss() * (26 + v * 170);
      const len = 4 + v * 44;
      g.strokeStyle = rgba(v < 0.3 ? '#fff4d8' : '#ffd8a0', r.range(0.25, 0.85) * (1 - v * 0.55));
      g.lineWidth = 0.8 + v * 2.4;
      g.beginPath();
      g.moveTo(x - len / 2, y);
      g.lineTo(x + len / 2, y);
      g.stroke();
    }
    // the Spire's dark reflection
    strokes(g, r, { x: SUN.x - 16, y: HZ + 2, w: 32, h: 120, n: 60, len: [8, 30], width: [1.5, 3.5], alpha: [0.3, 0.6], color: '#2a1a26', jitter: 0.03, curve: 0.05 });
    grain(g, -PAD_X, HZ - 4, W + PAD_X * 2, H + PAD_Y - HZ + 4, 0.05);
  }
  steps.push(sea);
  const glints = makeGlints(makeRand(92), 110, { cx: SUN.x, spread: [20, 200], y0: HZ + 2, y1: H - 10 });
  steps.push(anim(0.08, (ctx, t) => drawGlints(ctx, glints, t, 1)));

  // --- the expedition ship and its reflection ---
  const ship = shipSprite(S);
  steps.push(anim(0.12, (ctx, t) => {
    const bob = Math.sin(t * 0.0011) * 1.6;
    const roll = Math.sin(t * 0.0008 + 0.6) * 0.008;
    const k = SHIP.s;
    const sw = SHIP_W * k, sh = SHIP_H * k;
    const ox = SHIP_OX * k, oy = SHIP_OY * k;
    // reflection: mirrored about the waterline, cut into rippling slices that fade with depth
    const slices = 28;
    const reach = oy * 0.7;
    const sliceH = reach / slices;
    const srcSlice = (sliceH / k) * S;
    ctx.save();
    ctx.translate(0, SHIP.y + 3 + bob * 0.4);
    ctx.scale(1, -1);
    for (let i = 0; i < slices; i++) {
      const srcY = (SHIP_OY - ((i + 1) * sliceH) / k) * S;
      if (srcY < 0) break;
      const dx = Math.sin(t * 0.0022 + i * 0.7) * (0.6 + i * 0.22);
      ctx.globalAlpha = (0.36 * (1 - i / slices)) * FADE;
      ctx.drawImage(ship, 0, srcY, SHIP_W * S, srcSlice, SHIP.x - ox + dx, (i + 1) * sliceH * -1 + 0, sw, sliceH + 0.6);
    }
    ctx.restore();
    // wake
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255, 220, 180, 0.22)';
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(SHIP.x - 140 * SHIP.s - k * 40, SHIP.y + 4 + k * 5);
      ctx.quadraticCurveTo(SHIP.x - 40, SHIP.y + 8 + k * 3, SHIP.x + 150 * SHIP.s, SHIP.y + 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(SHIP.x, SHIP.y + bob);
    ctx.rotate(roll);
    ctx.drawImage(ship, -ox, -oy, sw, sh);
    ctx.restore();
    // lanterns
    ctx.globalCompositeOperation = 'lighter';
    const f = 0.8 + 0.2 * Math.sin(t * 0.008);
    for (const [lx, ly] of [[212, -56], [-150, -62]]) {
      const x = SHIP.x + lx * SHIP.s, y = SHIP.y + bob + ly * SHIP.s;
      ctx.globalAlpha = (0.85 * f) * FADE;
      ctx.drawImage(glowSprite('#ffc070'), x - 16, y - 16, 32, 32);
    }
    ctx.globalAlpha = FADE;
    ctx.globalCompositeOperation = 'source-over';
  }));

  // --- foreground rocks ---
  const fore = layer(S, 0.2, 560, H + PAD_Y);
  {
    const g = fore.g;
    rockMass(g, r, { x: 1210, y: 746, w: 320, h: 110, fill: '#18121c', rim: '#f0a878', light: { x: -0.7, y: -1 } });
    rockMass(g, r, { x: 1040, y: 760, w: 180, h: 46, fill: '#1c1420', rim: '#f0a878', light: { x: -0.7, y: -1 } });
    rockMass(g, r, { x: -20, y: 760, w: 200, h: 44, fill: '#18121c', rim: '#e89878', light: { x: 0.8, y: -1 } });
    grain(g, -PAD_X, 560, W + PAD_X * 2, H + PAD_Y - 560, 0.07);
  }
  steps.push(fore);
  const motes = makeMotes(makeRand(93), 60, { y0: 40, y1: 720, vx: [2, 10], vy: [-14, -4], size: [0.8, 2.2], colors: ['#ffe8c0', '#ffd08a', '#fff4e0'], amp: 14 });
  const pr = makeRand(94);
  const petals = [];
  for (let i = 0; i < 14; i++) petals.push({ x: pr.range(-PAD_X, W + PAD_X), y: pr.range(0, H), vx: pr.range(10, 26), vy: pr.range(6, 16), s: pr.range(3, 5), ph: pr.range(0, TAU), f: pr.range(0.001, 0.0024), c: pr.pick(['#d9837b', '#e0b458', '#f3dba0', '#a3302a']) });
  steps.push(anim(0.3, (ctx, t) => {
    drawMotes(ctx, motes, t, 0.7);
    const sec = t / 1000;
    const wX = W + PAD_X * 2, wY = H + PAD_Y * 2;
    for (const p of petals) {
      let x = p.x + p.vx * sec + Math.sin(t * p.f + p.ph) * 20;
      let y = p.y + p.vy * sec;
      x = -PAD_X + ((((x + PAD_X) % wX) + wX) % wX);
      y = -PAD_Y + ((((y + PAD_Y) % wY) + wY) % wY);
      const flip = Math.cos(t * p.f * 2.4 + p.ph);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * p.f + p.ph);
      ctx.scale(1, 0.3 + Math.abs(flip) * 0.7);
      ctx.globalAlpha = (0.8) * FADE;
      ctx.fillStyle = flip > 0 ? p.c : shade(p.c, -0.3);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = FADE;
  }));
  steps.push(vignette(S, '#08060e', 0.62, 0.45));
  return steps;
}

const BUILDERS = {
  shore: buildShore,
  thicket: buildThicket,
  spire: buildSpire,
  summit: buildSummit,
  training: buildTraining,
  title: buildTitle,
};
