// Tests for the small pure core modules: rng.js, util.js, tween.js, events.js and save.js
// (save.js is exercised with a fake localStorage, a throwing one, and none at all).

import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG, hashSeed } from '../src/core/rng.js';
import {
  clamp, clamp01, lerp, invLerp, remap, smoothstep, approach, damp, dist, angle, wrap, pickWeighted,
  formatNumber, formatDuration, uid,
} from '../src/core/util.js';
import { Ease, Tweener, Timers, wait } from '../src/core/tween.js';
import { Emitter } from '../src/core/events.js';
import {
  DEFAULT_SETTINGS, SAVE_KEY, SETTINGS_KEY, storage, loadSettings, saveSettings, validateSettings, sanitizeBindings, defaultSettings,
} from '../src/core/save.js';

// ------------------------------------------------------------------ rng

test('RNG: mulberry32 reference values and determinism', () => {
  const r = new RNG(1);
  assert.equal(r.next(), 0.6270739405881613);
  assert.equal(r.next(), 0.002735721180215478);
  const a = new RNG(12345);
  const b = new RNG(12345);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
  const c = new RNG(12346);
  assert.notDeepEqual(Array.from({ length: 50 }, () => c.next()), seqA);
  assert.equal(new RNG('seed').seed, hashSeed('seed'));
  assert.equal(new RNG('seed').next(), new RNG('seed').next());
  assert.equal(typeof new RNG().next(), 'number', 'default seed works');
});

test('RNG: int / float / chance / pick ranges', () => {
  const r = new RNG(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = r.int(0, 30);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 30);
    seen.add(v);
  }
  assert.equal(seen.size, 31, 'both bounds inclusive');
  assert.equal(r.int(5, 5), 5);
  const sw = r.int(10, 3);
  assert.ok(sw >= 3 && sw <= 10, 'swapped bounds');
  for (let i = 0; i < 500; i++) {
    const f = r.float(0.95, 1.05);
    assert.ok(f >= 0.95 && f < 1.05);
  }
  assert.equal(r.chance(0), false);
  assert.equal(r.chance(-1), false);
  assert.equal(r.chance(1), true);
  let hits = 0;
  for (let i = 0; i < 4000; i++) if (r.chance(0.25)) hits++;
  assert.ok(Math.abs(hits / 4000 - 0.25) < 0.03);
  assert.equal(r.pick([]), undefined);
  assert.equal(r.pick(['only']), 'only');
});

test('RNG: weighted, shuffle, shuffled, fork, state', () => {
  const r = new RNG(99);
  const items = [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }, { id: 'z', weight: 0 }];
  const counts = { a: 0, b: 0, z: 0 };
  for (let i = 0; i < 8000; i++) counts[r.weighted(items).id]++;
  assert.equal(counts.z, 0);
  assert.ok(Math.abs(counts.a / 8000 - 0.75) < 0.03);
  assert.equal(r.weighted([{ weight: 0 }]), undefined);
  assert.equal(r.weighted([]), undefined);
  assert.equal(r.weighted(['x', 'y'], (it) => (it === 'y' ? 1 : 0)), 'y');

  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const same = r.shuffle(arr);
  assert.equal(same, arr, 'in place');
  assert.deepEqual([...arr].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
  const src = [1, 2, 3, 4, 5];
  const copy = r.shuffled(src);
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.deepEqual([...copy].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(new RNG(3).shuffle([1, 2, 3, 4, 5, 6]), new RNG(3).shuffle([1, 2, 3, 4, 5, 6]));

  const p1 = new RNG(5);
  const p2 = new RNG(5);
  const f1 = p1.fork();
  const f2 = p2.fork();
  assert.equal(f1.next(), f2.next(), 'forks are deterministic');
  assert.equal(p1.next(), p2.next(), 'parents stay in lockstep');
  const parentNext = new RNG(5);
  parentNext.next();
  assert.notEqual(f1.next(), parentNext.next(), 'fork is an independent stream');

  const s = new RNG(42);
  s.next();
  const saved = s.state;
  const after = [s.next(), s.next(), s.next()];
  s.state = saved;
  assert.deepEqual([s.next(), s.next(), s.next()], after);
  const clone = new RNG(0);
  clone.state = saved;
  assert.equal(clone.next(), after[0]);
});

// ------------------------------------------------------------------ util

test('util math helpers', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
  assert.equal(clamp01(1.5), 1);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(invLerp(10, 20, 15), 0.5);
  assert.equal(invLerp(5, 5, 5), 0);
  assert.equal(remap(5, 0, 10, 100, 200), 150);
  assert.equal(smoothstep(0, 1, 0), 0);
  assert.equal(smoothstep(0, 1, 1), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(approach(0, 10, 3), 3);
  assert.equal(approach(9, 10, 3), 10);
  assert.equal(approach(10, 0, 4), 6);
  assert.equal(approach(1, 0, 4), 0);
  assert.equal(approach(5, 5, 1), 5);
  assert.ok(Math.abs(damp(0, 10, 1000, 16) - 10) < 1e-3);
  assert.equal(damp(0, 10, 5, 0), 0);
  assert.equal(dist(0, 0, 3, 4), 5);
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(angle(0, 0, 0, 10), Math.PI / 2);
  assert.equal(angle({ x: 0, y: 0 }, { x: -1, y: 0 }), Math.PI);
  assert.equal(wrap(370, 0, 360), 10);
  assert.equal(wrap(-10, 0, 360), 350);
  assert.equal(wrap(5, 3), 2);
  assert.equal(wrap(-1, 3), 2);
  assert.equal(wrap(4, 2, 2), 2);
});

test('util pickWeighted, formatting, uid', () => {
  const items = [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }];
  assert.equal(pickWeighted(items, undefined, () => 0).id, 'a');
  assert.equal(pickWeighted(items, undefined, () => 0.26).id, 'b');
  assert.equal(pickWeighted(items, undefined, () => 0.9999).id, 'b');
  assert.equal(pickWeighted([], undefined, () => 0.5), undefined);
  assert.equal(pickWeighted([{ weight: 0 }]), undefined);
  const r = new RNG(1);
  assert.ok(['a', 'b'].includes(pickWeighted(items, (i) => i.weight, () => r.next()).id));

  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(-12345.678, 1), '-12,345.7');
  assert.equal(formatNumber(0.4), '0');
  assert.equal(formatNumber(-0.2), '0');
  assert.equal(formatNumber(NaN), '—');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(3_725_000), '1:02:05');

  const ids = new Set(Array.from({ length: 100 }, () => uid('fx')));
  assert.equal(ids.size, 100);
  assert.match(uid('fx'), /^fx_[0-9a-z]+$/);
  assert.match(uid(), /^id_/);
});

// ------------------------------------------------------------------ tween

test('Ease functions map 0→0 and 1→1', () => {
  const names = ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'outBack', 'inBack', 'outElastic', 'outBounce', 'inExpo', 'outExpo'];
  for (const n of names) {
    assert.equal(typeof Ease[n], 'function', n);
    assert.ok(Math.abs(Ease[n](0)) < 1e-9, `${n}(0)`);
    assert.ok(Math.abs(Ease[n](1) - 1) < 1e-9, `${n}(1)`);
    const mid = Ease[n](0.5);
    assert.ok(Number.isFinite(mid), `${n}(0.5) finite`);
  }
  assert.ok(Ease.outBack(0.8) > 1, 'outBack overshoots');
  assert.ok(Ease.inBack(0.2) < 0, 'inBack anticipates');
  assert.equal(Ease.inOutQuad(0.5), 0.5);
});

test('Tweener: progress, delay, onDone, finished promise', async () => {
  const tw = new Tweener();
  const o = { x: 0, y: 10 };
  let done = 0;
  const h = tw.to(o, { x: 100, y: 0 }, 1000, Ease.linear, { delay: 200, onDone: () => done++ });
  tw.update(100);
  assert.equal(o.x, 0, 'still delayed');
  tw.update(200); // 100 of delay + 100 of tween
  assert.equal(o.x, 10);
  assert.equal(o.y, 9);
  tw.update(400);
  assert.equal(o.x, 50);
  tw.update(10000);
  assert.equal(o.x, 100);
  assert.equal(o.y, 0);
  assert.equal(done, 1);
  assert.equal(h.done, true);
  assert.equal(await h.finished, true);
  tw.update(100);
  assert.equal(done, 1, 'onDone fires once');
  assert.equal(tw.size, 0);

  const snap = { v: 3 };
  tw.to(snap, { v: 7 }, 0);
  tw.update(1);
  assert.equal(snap.v, 7, 'zero duration snaps');

  const named = { v: 0 };
  tw.to(named, { v: 1 }, 100, 'inQuad');
  tw.update(50);
  assert.equal(named.v, 0.25);
});

test('Tweener: cancel, clear, cancelTarget and property takeover', async () => {
  const tw = new Tweener();
  const o = { x: 0 };
  const h = tw.to(o, { x: 100 }, 100, Ease.linear);
  tw.update(50);
  tw.cancel(h);
  tw.update(50);
  assert.equal(o.x, 50);
  assert.equal(h.cancelled, true);
  assert.equal(await h.finished, false);

  const p = { x: 0, y: 0 };
  const first = tw.to(p, { x: 100, y: 100 }, 200, Ease.linear);
  tw.update(50);
  assert.equal(p.x, 25);
  const second = tw.to(p, { x: 0 }, 100, Ease.linear);
  tw.update(50);
  assert.equal(p.x, 25, 'newer tween owns x (from 50 → 0, halfway)');
  assert.equal(p.y, 50, 'older tween keeps y');
  tw.update(50);
  assert.equal(p.x, 0);
  assert.equal(p.y, 75);
  assert.equal(second.done, true);
  assert.equal(first.done, false);
  tw.update(100);
  assert.equal(p.x, 0, 'finished older tween no longer writes x');
  assert.equal(p.y, 100);
  assert.equal(first.done, true);

  const q = { a: 0 };
  const hq = tw.to(q, { a: 1 }, 100);
  tw.cancelTarget(q);
  assert.equal(hq.cancelled, true);
  tw.to(q, { a: 1 }, 100);
  tw.to({ b: 0 }, { b: 1 }, 100);
  tw.clear();
  assert.equal(tw.size, 0);
});

test('Timers: after, every, cancel, catch-up, chained timers, wait()', async () => {
  const tm = new Timers();
  const log = [];
  tm.after(100, () => log.push('a'));
  const id = tm.after(150, () => log.push('never'));
  tm.every(40, (n) => {
    log.push(`e${n}`);
    return n < 3;
  });
  tm.cancel(id);
  tm.update(99);
  assert.deepEqual(log, ['e1', 'e2']);
  tm.update(1);
  assert.deepEqual(log, ['e1', 'e2', 'a']);
  tm.update(1000);
  assert.deepEqual(log, ['e1', 'e2', 'a', 'e3'], 'every stops when fn returns false');
  assert.equal(tm.size, 0);

  const fast = new Timers();
  let n = 0;
  fast.every(10, () => {
    n++;
  });
  fast.update(50);
  assert.equal(n, 5, 'catches up within one large dt');

  const chain = new Timers();
  const times = [];
  chain.after(30, () => {
    times.push(chain.elapsed);
    chain.after(30, () => times.push(chain.elapsed));
  });
  chain.update(100);
  assert.deepEqual(times, [30, 60], 'chained timer measured from its due time');
  assert.equal(chain.elapsed, 100);

  const w = new Timers();
  let resolved = false;
  const pr = wait(w, 200).then(() => {
    resolved = true;
  });
  w.update(150);
  await Promise.resolve();
  assert.equal(resolved, false);
  w.update(60);
  await pr;
  assert.equal(resolved, true);

  const c = new Timers();
  c.after(10, () => assert.fail('cleared timer fired'));
  c.clear();
  c.update(100);
});

// ------------------------------------------------------------------ events

test('Emitter: on/off/once/emit, wildcard, error isolation', () => {
  const em = new Emitter();
  const got = [];
  const off = em.on('hit', (a, b) => got.push(['on', a, b]));
  em.once('hit', (a) => got.push(['once', a]));
  assert.equal(em.listenerCount('hit'), 2);
  assert.equal(em.emit('hit', 1, 2), true);
  em.emit('hit', 3, 4);
  assert.deepEqual(got, [['on', 1, 2], ['once', 1], ['on', 3, 4]]);
  off();
  assert.equal(em.emit('hit', 5), false);
  assert.equal(em.listenerCount('hit'), 0);

  const fn = () => got.push('x');
  em.once('evt', fn);
  em.off('evt', fn);
  em.emit('evt');
  assert.equal(got.includes('x'), false, 'off() removes once-listeners by original fn');

  const all = [];
  em.on('*', (evt, ...args) => all.push([evt, ...args]));
  em.emit('a', 1);
  em.emit('b');
  assert.deepEqual(all, [['a', 1], ['b']]);

  const origError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    let after = false;
    em.on('boom', () => {
      throw new Error('bad listener');
    });
    em.on('boom', () => {
      after = true;
    });
    em.emit('boom');
    assert.equal(after, true, 'later listeners still run');
    assert.equal(errors.length, 1);
  } finally {
    console.error = origError;
  }

  const same = new Emitter();
  let count = 0;
  const g = () => count++;
  same.on('e', g);
  same.once('e', g);
  same.emit('e');
  same.emit('e');
  assert.equal(count, 3, 'once entry removed without touching the persistent one');
  same.clear();
  assert.equal(same.listenerCount('e'), 0);
  assert.throws(() => same.on('e', 42), TypeError);
});

// ------------------------------------------------------------------ save

function withLocalStorage(value, fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true, enumerable: false });
  try {
    return fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
}

function fakeStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

test('save: keys and defaults', () => {
  assert.equal(SAVE_KEY, 'exp69.save.v1');
  assert.equal(SETTINGS_KEY, 'exp69.settings.v1');
  assert.deepEqual({ ...DEFAULT_SETTINGS }, {
    difficulty: 'expeditioner', assistCues: true, inputOffset: 0, masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0.55,
    screenShake: true, reducedFlashing: false, showTimingFeedback: false, bindings: null,
  });
  assert.deepEqual(defaultSettings(), { ...DEFAULT_SETTINGS });
});

test('save: works with no localStorage at all', () => {
  withLocalStorage(undefined, () => {
    assert.equal(storage.available, false);
    assert.equal(storage.get('k', 'fb'), 'fb');
    assert.equal(storage.set('k', 1), false);
    assert.equal(storage.remove('k'), false);
    assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS });
    assert.equal(saveSettings({ ...DEFAULT_SETTINGS }), false);
  });
});

test('save: round-trips settings through a fake localStorage', () => {
  const ls = fakeStorage();
  withLocalStorage(ls, () => {
    assert.equal(storage.available, true);
    assert.equal(storage.set('obj', { a: [1, 2] }), true);
    assert.deepEqual(storage.get('obj'), { a: [1, 2] });
    assert.equal(storage.get('missing', 7), 7);
    assert.equal(storage.remove('obj'), true);
    assert.equal(storage.get('obj'), null);

    const s = loadSettings();
    s.difficulty = 'veteran';
    s.inputOffset = 23.6;
    s.musicVolume = 0.2;
    s.bindings = { parry: ['KeyP'] };
    s.textSpeed = 'fast'; // extra keys from other modules survive
    assert.equal(saveSettings(s), true);
    const back = loadSettings();
    assert.equal(back.difficulty, 'veteran');
    assert.equal(back.inputOffset, 24);
    assert.equal(back.musicVolume, 0.2);
    assert.deepEqual(back.bindings, { parry: ['KeyP'] });
    assert.equal(back.textSpeed, 'fast');
    assert.ok(ls.map.has(SETTINGS_KEY));

    ls.setItem(SETTINGS_KEY, '{not json');
    assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS }, 'corrupt JSON → defaults');
  });
});

test('save: validation clamps and repairs bad values', () => {
  const v = validateSettings({
    difficulty: 'nightmare', assistCues: 'yes', inputOffset: 9999, masterVolume: 3, sfxVolume: -1, musicVolume: 'loud',
    screenShake: false, reducedFlashing: true, showTimingFeedback: 1,
    bindings: { parry: ['KeyP', 5, '', 'KeyP'], nonsense: ['KeyQ'], dodge: 'KeyQ' },
  });
  assert.equal(v.difficulty, 'expeditioner');
  assert.equal(v.assistCues, true);
  assert.equal(v.inputOffset, 250);
  assert.equal(v.masterVolume, 1);
  assert.equal(v.sfxVolume, 0);
  assert.equal(v.musicVolume, 0.55);
  assert.equal(v.screenShake, false);
  assert.equal(v.reducedFlashing, true);
  assert.equal(v.showTimingFeedback, false);
  assert.deepEqual(v.bindings, { parry: ['KeyP'] });
  assert.equal(validateSettings({ inputOffset: -9999 }).inputOffset, -250);
  assert.deepEqual(validateSettings(null), { ...DEFAULT_SETTINGS });
  assert.deepEqual(validateSettings([1, 2]), { ...DEFAULT_SETTINGS });
  assert.equal(sanitizeBindings({}), null);
  assert.equal(sanitizeBindings('x'), null);
});

test('save: a throwing localStorage never throws out of the API', () => {
  const evil = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  withLocalStorage(evil, () => {
    assert.equal(storage.get('k', 'fb'), 'fb');
    assert.equal(storage.set('k', 1), false);
    assert.equal(storage.remove('k'), false);
    assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS });
    assert.equal(saveSettings(DEFAULT_SETTINGS), false);
  });
  // a getter that throws on access (sandboxed iframes)
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('denied'); }, configurable: true });
  try {
    assert.equal(storage.available, false);
    assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS });
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
});
