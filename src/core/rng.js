// Deterministic seeded RNG (mulberry32) for battle logic, AI and progression.
// Pure: no clocks are read at import time; the seed defaults to Date.now() only when constructed.

/**
 * Hash any string to a 32-bit unsigned seed (FNV-1a).
 * @param {string} str
 * @returns {number}
 */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function toSeed(seed) {
  if (typeof seed === 'string') return hashSeed(seed);
  const n = Number(seed);
  if (!Number.isFinite(n)) return Date.now() >>> 0;
  return Math.floor(n) >>> 0;
}

/** Seeded pseudo-random generator (mulberry32). Identical seeds give identical sequences. */
export class RNG {
  /**
   * @param {number|string} [seed]  uint32 (or string, hashed); defaults to Date.now() at call time
   */
  constructor(seed) {
    /** The seed this generator was created with (uint32). */
    this.seed = toSeed(seed === undefined ? Date.now() : seed);
    this._s = this.seed;
  }

  /** Internal 32-bit state; assign a previously read value to restore the exact sequence. */
  get state() {
    return this._s >>> 0;
  }

  set state(v) {
    this._s = toSeed(v);
  }

  /** @returns {number} float in [0, 1) */
  next() {
    this._s = (this._s + 0x6d2b79f5) >>> 0;
    let t = this._s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Integer in [min, max] (inclusive; arguments may be given in either order).
   * @param {number} min
   * @param {number} max
   */
  int(min, max) {
    let lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    if (hi < lo) lo = hi;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /**
   * Float in [min, max).
   * @param {number} min
   * @param {number} max
   */
  float(min, max) {
    return min + this.next() * (max - min);
  }

  /**
   * True with probability p (p ≤ 0 never, p ≥ 1 always).
   * @param {number} p
   */
  chance(p) {
    if (!(p > 0)) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /**
   * Uniformly pick one element (undefined for an empty array).
   * @template T
   * @param {T[]} arr
   * @returns {T|undefined}
   */
  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * Weighted pick. Items with non-positive / non-finite weight are never chosen.
   * @template T
   * @param {T[]} items
   * @param {(item:T, index:number) => number} [weightFn] defaults to item.weight (or 1)
   * @returns {T|undefined} undefined when nothing has positive weight
   */
  weighted(items, weightFn = (it) => (it && Number.isFinite(it.weight) ? it.weight : 1)) {
    if (!items || items.length === 0) return undefined;
    const weights = items.map((it, i) => {
      const w = Number(weightFn(it, i));
      return Number.isFinite(w) && w > 0 ? w : 0;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      if (weights[i] <= 0) continue;
      r -= weights[i];
      if (r < 0) return items[i];
    }
    for (let i = items.length - 1; i >= 0; i--) if (weights[i] > 0) return items[i];
    return undefined;
  }

  /**
   * Fisher–Yates shuffle IN PLACE; returns the same array.
   * @template T
   * @param {T[]} arr
   * @returns {T[]}
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Shuffled copy (the input is left untouched).
   * @template T
   * @param {T[]} arr
   * @returns {T[]}
   */
  shuffled(arr) {
    return this.shuffle([...arr]);
  }

  /**
   * Independent child generator seeded from this one (advances this generator by one step).
   * @returns {RNG}
   */
  fork() {
    return new RNG(Math.floor(this.next() * 4294967296));
  }
}
