// Small math / formatting helpers shared by every module.
// Pure: no DOM, no clocks at import time.

/** Clamp v into [min, max]. */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** Clamp v into [0, 1]. */
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Linear interpolation a → b by t (unclamped). */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Inverse lerp: where v sits between a and b (0 when a === b; unclamped). */
export function invLerp(a, b, v) {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Map v from [a0, a1] to [b0, b1] (unclamped). */
export function remap(v, a0, a1, b0, b1) {
  return lerp(b0, b1, invLerp(a0, a1, v));
}

/** Hermite smoothstep of x between edges e0 and e1, result in [0, 1]. */
export function smoothstep(e0, e1, x) {
  const t = clamp01(invLerp(e0, e1, x));
  return t * t * (3 - 2 * t);
}

/** Move cur towards target by at most delta (never overshoots). */
export function approach(cur, target, delta) {
  const d = Math.abs(delta);
  if (cur < target) return Math.min(cur + d, target);
  if (cur > target) return Math.max(cur - d, target);
  return target;
}

/**
 * Frame-rate independent exponential smoothing towards target.
 * @param {number} cur
 * @param {number} target
 * @param {number} lambda  responsiveness per second (higher = snappier)
 * @param {number} dtMs    frame time in ms
 */
export function damp(cur, target, lambda, dtMs) {
  return lerp(cur, target, 1 - Math.exp(-lambda * (dtMs / 1000)));
}

/**
 * Distance between two points: dist(x0, y0, x1, y1) or dist({x,y}, {x,y}).
 * @returns {number}
 */
export function dist(a, b, c, d) {
  if (typeof a === 'object' && a !== null) return Math.hypot(b.x - a.x, b.y - a.y);
  return Math.hypot(c - a, d - b);
}

/**
 * Angle (radians, atan2 convention, y down) from the first point to the second:
 * angle(x0, y0, x1, y1) or angle({x,y}, {x,y}).
 * @returns {number}
 */
export function angle(a, b, c, d) {
  if (typeof a === 'object' && a !== null) return Math.atan2(b.y - a.y, b.x - a.x);
  return Math.atan2(d - b, c - a);
}

/**
 * Wrap v into the half-open range [min, max): wrap(v, min, max), or wrap(v, max) for [0, max).
 * @returns {number}
 */
export function wrap(v, min, max) {
  if (max === undefined) {
    max = min;
    min = 0;
  }
  const span = max - min;
  if (span === 0) return min;
  return ((((v - min) % span) + span) % span) + min;
}

/**
 * Weighted random pick using any [0,1) source (Math.random by default; pass rng.next.bind(rng)
 * for determinism). Non-positive weights are never picked.
 * @template T
 * @param {T[]} items
 * @param {(item:T, index:number) => number} [weightFn] defaults to item.weight (or 1)
 * @param {() => number} [rand]
 * @returns {T|undefined}
 */
export function pickWeighted(items, weightFn = (it) => (it && Number.isFinite(it.weight) ? it.weight : 1), rand = Math.random) {
  if (!items || items.length === 0) return undefined;
  const weights = items.map((it, i) => {
    const w = Number(weightFn(it, i));
    return Number.isFinite(w) && w > 0 ? w : 0;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return undefined;
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    if (weights[i] <= 0) continue;
    r -= weights[i];
    if (r < 0) return items[i];
  }
  for (let i = items.length - 1; i >= 0; i--) if (weights[i] > 0) return items[i];
  return undefined;
}

/**
 * Format a number for display with thousands separators: 12345.6 → "12,346"; decimals optional.
 * @param {number} n
 * @param {number} [decimals=0]
 * @returns {string}
 */
export function formatNumber(n, decimals = 0) {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(Math.max(0, Math.min(6, decimals | 0)));
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg && Number(fixed) !== 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/**
 * Format milliseconds as m:ss (or h:mm:ss for an hour or more), for play time displays.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

let uidCounter = 0;
/**
 * Process-unique id: uid('fx') → "fx_1", "fx_2", ...
 * @param {string} [prefix='id']
 * @returns {string}
 */
export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}_${uidCounter.toString(36)}`;
}
