// Tests for src/core/scene.js (Scene + SceneManager, also re-exported by engine.js): lifecycle order,
// pause/resume(result), replace/reset, transparent visibility, UI mounting and error isolation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, SceneManager } from '../src/core/scene.js';
import * as engine from '../src/core/engine.js';

function fakeUiRoot() {
  const children = [];
  return {
    children,
    appendChild(el) {
      children.push(el);
      el.parentNode = this;
      return el;
    },
    removeChild(el) {
      const i = children.indexOf(el);
      if (i >= 0) children.splice(i, 1);
    },
  };
}

function fakeEl(name) {
  return {
    name,
    parentNode: null,
    remove() {
      this.parentNode?.removeChild(this);
      this.parentNode = null;
    },
  };
}

function setup() {
  const log = [];
  const errors = [];
  const game = {
    uiRoot: fakeUiRoot(),
    reportError: (scene, phase, err) => errors.push([scene.name, phase, err.message]),
    events: { emit: (evt, data) => log.push([`event:${evt}`, data.op, data.name]) },
  };
  const make = (tag, { transparent = false } = {}) => class extends Scene {
    constructor(g) {
      super(g);
      this.transparent = transparent;
    }

    enter(p) { log.push([tag, 'enter', p]); }

    exit() { log.push([tag, 'exit']); }

    pause() { log.push([tag, 'pause']); }

    resume(r) { log.push([tag, 'resume', r]); }
  };
  const sm = new SceneManager(game);
  game.scenes = sm;
  sm.register('world', make('world'));
  sm.register('battle', make('battle'));
  sm.register('pause', make('pause', { transparent: true }));
  sm.register('dialogue', make('dialogue', { transparent: true }));
  return { sm, log, errors, game };
}

const lifecycle = (log) => log.filter((e) => !String(e[0]).startsWith('event:'));

test('engine.js re-exports the scene API and stage constants', () => {
  assert.equal(engine.Scene, Scene);
  assert.equal(engine.SceneManager, SceneManager);
  assert.equal(engine.STAGE_W, 1280);
  assert.equal(engine.STAGE_H, 720);
  assert.equal(typeof engine.Game, 'function');
});

test('push pauses the top, pop exits and resumes with the result', () => {
  const { sm, log } = setup();
  const w = sm.push('world', { zone: 'shore' });
  assert.equal(w.name, 'world');
  assert.equal(sm.top, w);
  const b = sm.push('battle');
  assert.equal(sm.top, b);
  assert.equal(sm.has('world'), true);
  assert.equal(sm.has('battle'), true);
  const popped = sm.pop({ outcome: 'victory' });
  assert.equal(popped, b);
  assert.equal(sm.top, w);
  assert.equal(sm.has('battle'), false);
  assert.deepEqual(lifecycle(log), [
    ['world', 'enter', { zone: 'shore' }],
    ['world', 'pause'],
    ['battle', 'enter', {}],
    ['battle', 'exit'],
    ['world', 'resume', { outcome: 'victory' }],
  ]);
  assert.ok(log.some((e) => e[0] === 'event:scene' && e[1] === 'pop'));
  assert.equal(sm.pop(), w);
  assert.equal(sm.pop(), undefined, 'popping an empty stack is a no-op');
  assert.equal(sm.top, null);
});

test('replace swaps the top without resuming the scene below; reset clears everything', () => {
  const { sm, log } = setup();
  sm.push('world');
  sm.push('pause');
  log.length = 0;
  sm.replace('dialogue', { id: 'x' });
  assert.deepEqual(sm.names(), ['world', 'dialogue']);
  assert.deepEqual(lifecycle(log), [['pause', 'exit'], ['dialogue', 'enter', { id: 'x' }]]);
  log.length = 0;
  sm.reset('battle', { encounterId: 'e' });
  assert.deepEqual(sm.names(), ['battle']);
  assert.deepEqual(lifecycle(log), [['dialogue', 'exit'], ['world', 'exit'], ['battle', 'enter', { encounterId: 'e' }]]);
  assert.equal(sm.size, 1);
});

test('unknown scenes throw without disturbing the stack', () => {
  const { sm } = setup();
  sm.push('world');
  assert.throws(() => sm.push('nope'), /Unknown scene "nope"/);
  assert.throws(() => sm.replace('nope'), /Unknown scene/);
  assert.throws(() => sm.reset('nope'), /Unknown scene/);
  assert.deepEqual(sm.names(), ['world']);
  assert.throws(() => sm.register('', Scene), TypeError);
  assert.throws(() => sm.register('x', null), TypeError);
});

test('visible(): render from the lowest scene that every scene above it lets through', () => {
  const { sm } = setup();
  assert.deepEqual(sm.visible(), []);
  sm.push('world');
  assert.deepEqual(sm.visible().map((s) => s.name), ['world']);
  sm.push('pause');
  sm.push('dialogue');
  assert.deepEqual(sm.visible().map((s) => s.name), ['world', 'pause', 'dialogue']);
  sm.push('battle');
  assert.deepEqual(sm.visible().map((s) => s.name), ['battle'], 'opaque top hides everything below');
  sm.push('pause');
  assert.deepEqual(sm.visible().map((s) => s.name), ['battle', 'pause']);
  assert.equal(sm.get('pause'), sm.top, 'get returns the topmost instance');
  assert.equal(sm.stack.length, 5);
  sm.stack.pop();
  assert.equal(sm.size, 5, 'stack getter returns a copy');
});

test('mountUI appends to the UI root and unmountUI runs after exit', () => {
  const { sm, game } = setup();
  const order = [];
  class Menu extends Scene {
    enter() {
      this.el = this.mountUI(fakeEl('menu'));
      this.mountUI(fakeEl('tooltip'));
    }

    exit() {
      order.push(`exit with ${game.uiRoot.children.length} mounted`);
    }
  }
  sm.register('menu', Menu);
  const m = sm.push('menu');
  assert.deepEqual(game.uiRoot.children.map((c) => c.name), ['menu', 'tooltip']);
  assert.equal(m.el.name, 'menu');
  sm.pop();
  assert.deepEqual(order, ['exit with 2 mounted']);
  assert.equal(game.uiRoot.children.length, 0);
  assert.equal(m._ui.length, 0);
});

test('lifecycle hooks are error-isolated and reported', () => {
  const { sm, errors } = setup();
  class Broken extends Scene {
    enter() { throw new Error('enter boom'); }

    exit() { throw new Error('exit boom'); }
  }
  sm.register('broken', Broken);
  sm.push('world');
  const b = sm.push('broken');
  assert.equal(sm.top, b, 'scene stays on the stack even if enter threw');
  sm.pop('r');
  assert.equal(sm.top.name, 'world');
  assert.deepEqual(errors, [['broken', 'enter', 'enter boom'], ['broken', 'exit', 'exit boom']]);
});

test('Scene defaults', () => {
  const game = { uiRoot: fakeUiRoot(), scenes: null };
  const s = new Scene(game);
  assert.equal(s.game, game);
  assert.equal(s.transparent, false);
  assert.deepEqual(s._ui, []);
  s.enter({});
  s.update(16);
  s.render({});
  s.pause();
  s.resume();
  s.exit();
  s.unmountUI();
  assert.equal(s.isTop, false);
});

// ------------------------------------------------------------------ Game loop vs page visibility (fake DOM)

function fakeDom() {
  const listeners = new Map();
  const on = (map) => (type, fn) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  };
  const el = (id) => ({
    id,
    style: {},
    children: [],
    parentElement: null,
    classList: { contains: () => false },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    clientWidth: 1280,
    clientHeight: 720,
  });
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const body = el('body');
  const viewport = el('viewport');
  const stage = el('stage');
  const canvas = { ...el('game'), width: 1280, height: 720, getContext: () => ctx };
  viewport.parentElement = body;
  stage.parentElement = viewport;
  canvas.parentElement = stage;
  const ui = el('ui');
  const fade = el('fade');
  const byId = { game: canvas, stage, ui, fade, viewport };
  const docListeners = new Map();
  const document = {
    body,
    visibilityState: 'visible',
    getElementById: (id) => byId[id] ?? null,
    createElement: (tag) => el(tag),
    addEventListener: on(docListeners),
    fire(type) { for (const fn of docListeners.get(type) ?? []) fn({ type }); },
  };
  const window = { addEventListener: on(listeners), removeEventListener() {}, innerWidth: 1280, innerHeight: 720, performance: globalThis.performance };
  return { document, window };
}

test('Game: a hidden page runs no frames, reports how long it was away and returns without a giant dt', () => {
  const dom = fakeDom();
  const saved = { document: globalThis.document, window: globalThis.window, now: globalThis.performance.now };
  let clock = 1000;
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.performance.now = () => clock;
  try {
    const game = new engine.Game({});
    const calls = [];
    game.audio = { suspend: () => calls.push('suspend'), resumeCtx: () => calls.push('resume') };
    const seen = [];
    game.events.on('visibility', (visible, info) => seen.push([visible, info]));
    const frames = [];
    game.scenes.register('probe', class extends Scene { update(dt) { frames.push(dt); } });
    game.scenes.push('probe');
    game.running = true;
    globalThis.requestAnimationFrame = () => 1;
    game._tick(1000);
    game._tick(1016);
    assert.deepEqual(frames.map(Math.round), [17, 16]);
    game.input.virtualPress('parry');
    clock = 1020;
    dom.document.visibilityState = 'hidden';
    dom.document.fire('visibilitychange');
    assert.equal(game.hidden, true);
    assert.equal(game.input.isDown('parry'), false, 'held input is released when the page hides');
    assert.deepEqual(seen[0], [false, { at: 1020, hiddenMs: 0 }]);
    game._tick(1033);
    game._tick(9000);
    assert.equal(frames.length, 2, 'no frame runs while hidden');
    clock = 13020;
    dom.document.visibilityState = 'visible';
    dom.document.fire('visibilitychange');
    assert.deepEqual(seen[1], [true, { at: 13020, hiddenMs: 12000 }]);
    assert.equal(game.hiddenTotal, 12000);
    assert.equal(game.hiddenAt, null);
    assert.deepEqual(calls, ['suspend', 'resume']);
    game._tick(13030);
    assert.equal(frames.length, 3);
    assert.ok(frames[2] < 20, `first frame back has a normal dt (got ${frames[2]})`);
    assert.equal(game.time, 13030);
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.performance.now = saved.now;
    delete globalThis.requestAnimationFrame;
  }
});
