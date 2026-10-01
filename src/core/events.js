// Minimal synchronous event emitter used by the engine, input and game modules.
// Pure: safe to import in Node. Listener errors are caught and logged so one bad listener
// cannot break the others (or the frame loop).

/**
 * Tiny pub/sub. Listeners run synchronously in registration order; a listener registered for '*'
 * receives every event as (eventName, ...args).
 */
export class Emitter {
  constructor() {
    /** @type {Map<string, Array<{fn:Function, once:boolean, orig:Function}>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} evt
   * @param {Function} fn
   * @returns {() => void} unsubscribe function
   */
  on(evt, fn) {
    return this._add(evt, fn, false);
  }

  /**
   * Subscribe for a single emission.
   * @param {string} evt
   * @param {Function} fn
   * @returns {() => void} unsubscribe function
   */
  once(evt, fn) {
    return this._add(evt, fn, true);
  }

  /**
   * Unsubscribe a listener (works for listeners added with on() or once()).
   * @param {string} evt
   * @param {Function} fn
   */
  off(evt, fn) {
    const list = this._listeners.get(evt);
    if (!list) return;
    const i = list.findIndex((l) => l.orig === fn);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this._listeners.delete(evt);
  }

  /**
   * Emit an event synchronously.
   * @param {string} evt
   * @param {...any} args
   * @returns {boolean} true if at least one listener ran
   */
  emit(evt, ...args) {
    let ran = false;
    const list = this._listeners.get(evt);
    if (list) {
      for (const l of [...list]) {
        if (l.once) this._remove(evt, l);
        this._call(evt, l.fn, args);
        ran = true;
      }
    }
    if (evt !== '*') {
      const all = this._listeners.get('*');
      if (all) {
        for (const l of [...all]) {
          if (l.once) this._remove('*', l);
          this._call(evt, l.fn, [evt, ...args]);
          ran = true;
        }
      }
    }
    return ran;
  }

  /**
   * Number of listeners for an event.
   * @param {string} evt
   */
  listenerCount(evt) {
    return this._listeners.get(evt)?.length ?? 0;
  }

  /**
   * Remove all listeners of one event, or of every event when called without arguments.
   * @param {string} [evt]
   */
  clear(evt) {
    if (evt === undefined) this._listeners.clear();
    else this._listeners.delete(evt);
  }

  _add(evt, fn, once) {
    if (typeof fn !== 'function') throw new TypeError(`Emitter listener for "${evt}" must be a function`);
    let list = this._listeners.get(evt);
    if (!list) {
      list = [];
      this._listeners.set(evt, list);
    }
    const entry = { fn, once, orig: fn };
    list.push(entry);
    return () => this._remove(evt, entry);
  }

  _remove(evt, entry) {
    const list = this._listeners.get(evt);
    if (!list) return;
    const i = list.indexOf(entry);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this._listeners.delete(evt);
  }

  _call(evt, fn, args) {
    try {
      fn(...args);
    } catch (err) {
      console.error(`[events] listener for "${evt}" threw:`, err);
    }
  }
}
