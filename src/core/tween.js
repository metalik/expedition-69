// Easing curves, a property Tweener, frame-driven Timers and an awaitable wait() helper.
// Everything advances only when update(dt) is called (dt in ms), so scenes control time
// (hit-stop, pause) simply by what they pass in. Pure: safe in Node.

const PI = Math.PI;
const c1 = 1.70158;
const c3 = c1 + 1;

/** Easing functions mapping t ∈ [0,1] → eased progress (0 → 0, 1 → 1). */
export const Ease = Object.freeze({
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  inBack: (t) => c3 * t * t * t - c1 * t * t,
  outElastic: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * PI) / 3)) + 1;
  },
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  inExpo: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
});

function resolveEase(ease) {
  if (typeof ease === 'function') return ease;
  if (typeof ease === 'string' && Ease[ease]) return Ease[ease];
  return Ease.outQuad;
}

/**
 * @typedef {object} TweenHandle
 * @property {object} target
 * @property {boolean} done       true once finished or cancelled
 * @property {boolean} cancelled
 * @property {Promise<boolean>} finished  resolves true when completed, false when cancelled
 */

/**
 * Tweens numeric properties of plain objects. Start values are captured when the tween begins
 * (after its delay); a newer tween on the same object property takes that property over.
 */
export class Tweener {
  constructor() {
    this._tweens = [];
  }

  /** Number of active (incl. delayed) tweens. */
  get size() {
    return this._tweens.length;
  }

  /**
   * Tween `obj`'s numeric props to the given values.
   * @param {object} obj
   * @param {Record<string, number>} props  target values
   * @param {number} ms                     duration (≤ 0 → snaps on start)
   * @param {Function|string} [ease=Ease.outQuad]
   * @param {{delay?:number, onDone?:Function, onUpdate?:Function}} [opts]
   * @returns {TweenHandle}
   */
  to(obj, props, ms, ease = Ease.outQuad, { delay = 0, onDone = null, onUpdate = null } = {}) {
    let resolveFinished;
    const finished = new Promise((r) => {
      resolveFinished = r;
    });
    const handle = {
      target: obj,
      done: false,
      cancelled: false,
      finished,
      _props: { ...props },
      _from: null,
      _ms: Math.max(0, Number(ms) || 0),
      _delay: Math.max(0, Number(delay) || 0),
      _elapsed: 0,
      _ease: resolveEase(ease),
      _onDone: onDone,
      _onUpdate: onUpdate,
      _resolve: resolveFinished,
    };
    this._tweens.push(handle);
    return handle;
  }

  /**
   * Advance all tweens.
   * @param {number} dt ms
   */
  update(dt) {
    if (!(dt > 0) || this._tweens.length === 0) return;
    const active = [...this._tweens];
    for (const tw of active) {
      if (tw.done) continue;
      let step = dt;
      if (tw._delay > 0) {
        if (step < tw._delay) {
          tw._delay -= step;
          continue;
        }
        step -= tw._delay;
        tw._delay = 0;
      }
      if (!tw._from) this._start(tw);
      tw._elapsed += step;
      const p = tw._ms <= 0 ? 1 : Math.min(1, tw._elapsed / tw._ms);
      const e = p >= 1 ? 1 : tw._ease(p);
      for (const key of Object.keys(tw._props)) {
        const from = tw._from[key];
        tw.target[key] = from + (tw._props[key] - from) * e;
      }
      if (tw._onUpdate) tw._onUpdate(p, tw.target);
      if (p >= 1) this._finish(tw, true);
    }
    this._tweens = this._tweens.filter((t) => !t.done);
  }

  /**
   * Cancel a tween (the object keeps its current values).
   * @param {TweenHandle} handle
   */
  cancel(handle) {
    if (!handle || handle.done) return;
    this._finish(handle, false);
    this._tweens = this._tweens.filter((t) => t !== handle);
  }

  /** Cancel every tween targeting obj. */
  cancelTarget(obj) {
    for (const tw of this._tweens) if (tw.target === obj && !tw.done) this._finish(tw, false);
    this._tweens = this._tweens.filter((t) => !t.done);
  }

  /** Cancel everything. */
  clear() {
    for (const tw of this._tweens) if (!tw.done) this._finish(tw, false);
    this._tweens = [];
  }

  _start(tw) {
    tw._from = {};
    for (const key of Object.keys(tw._props)) {
      const v = Number(tw.target[key]);
      tw._from[key] = Number.isFinite(v) ? v : 0;
    }
    // A newer tween takes over properties another running tween on the same object is animating.
    for (const other of this._tweens) {
      if (other === tw || other.done || other.target !== tw.target || !other._from) continue;
      for (const key of Object.keys(tw._props)) delete other._props[key];
      if (Object.keys(other._props).length === 0) this._finish(other, false);
    }
  }

  _finish(tw, completed) {
    tw.done = true;
    tw.cancelled = !completed;
    if (completed && tw._onDone) {
      try {
        tw._onDone(tw.target);
      } catch (err) {
        console.error('[tween] onDone threw:', err);
      }
    }
    tw._resolve(completed);
  }
}

/**
 * Frame-driven timers (advance only through update(dt)).
 * Callbacks may schedule or cancel timers; a timer created inside a callback is measured from that
 * callback's due time, so chains stay exact even when one update spans several firings.
 */
export class Timers {
  constructor() {
    this._timers = new Map();
    this._nextId = 1;
    /** Total ms advanced so far. */
    this.elapsed = 0;
  }

  /** Number of pending timers. */
  get size() {
    return this._timers.size;
  }

  /**
   * Run fn once after ms.
   * @param {number} ms
   * @param {Function} fn
   * @returns {number} id
   */
  after(ms, fn) {
    const id = this._nextId++;
    this._timers.set(id, { id, at: this.elapsed + Math.max(0, Number(ms) || 0), every: 0, fn, count: 0 });
    return id;
  }

  /**
   * Run fn every ms (first call after ms). fn(count) returning false stops the timer.
   * @param {number} ms
   * @param {Function} fn
   * @returns {number} id
   */
  every(ms, fn) {
    const period = Math.max(1, Number(ms) || 0);
    const id = this._nextId++;
    this._timers.set(id, { id, at: this.elapsed + period, every: period, fn, count: 0 });
    return id;
  }

  /** @param {number} id */
  cancel(id) {
    this._timers.delete(id);
  }

  /**
   * Advance time and fire due timers in due-time order.
   * @param {number} dt ms
   */
  update(dt) {
    if (!(dt > 0)) return;
    const target = this.elapsed + dt;
    // Fire in chronological order, including repeated firings of short intervals within one dt.
    for (let guard = 0; guard < 10000; guard++) {
      let next = null;
      for (const t of this._timers.values()) if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
      if (!next) break;
      this.elapsed = Math.max(this.elapsed, next.at);
      next.count += 1;
      const keep = next.every > 0;
      if (keep) next.at += next.every;
      else this._timers.delete(next.id);
      let ret;
      try {
        ret = next.fn(next.count);
      } catch (err) {
        console.error('[timers] callback threw:', err);
      }
      if (keep && ret === false) this._timers.delete(next.id);
    }
    this.elapsed = target;
  }

  /** Cancel every timer. */
  clear() {
    this._timers.clear();
  }
}

/**
 * Promise that resolves after `timers` has advanced by ms (resolves on the next update when ms ≤ 0).
 * If the timers are cleared first, the promise never resolves (choreography simply stops).
 * @param {Timers} timers
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function wait(timers, ms) {
  return new Promise((resolve) => {
    timers.after(ms, () => resolve());
  });
}
