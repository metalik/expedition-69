// Tests for src/core/input.js using a fake window: keyboard edges and the press log, timestamp
// handling, preventDefault rules, blur, bindings, labels, virtual buttons, gamepad polling, pointer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, ACTIONS, DEFAULT_BINDINGS, PRESS_LOG_MS, codeLabel } from '../src/core/input.js';

function fakeWindow() {
  const handlers = new Map();
  const clock = { now: 1000 };
  const pads = [];
  const win = {
    handlers,
    clock,
    pads,
    performance: { now: () => clock.now },
    navigator: { getGamepads: () => pads },
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      handlers.set(type, (handlers.get(type) ?? []).filter((f) => f !== fn));
    },
    fire(type, props = {}) {
      const ev = { defaultPrevented: false, cancelable: true, preventDefault() { this.defaultPrevented = true; }, ...props };
      for (const fn of handlers.get(type) ?? []) fn(ev);
      return ev;
    },
  };
  return win;
}

const key = (win, type, code, extra = {}) => win.fire(type, { code, key: '', repeat: false, timeStamp: win.clock.now, target: null, ...extra });

function makePad({ buttons = [], axes = [0, 0, 0, 0] } = {}) {
  const b = Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 }));
  return { connected: true, mapping: 'standard', id: 'Test Pad', buttons: b, axes };
}

test('actions and default bindings match the spec', () => {
  assert.deepEqual(ACTIONS, ['up', 'down', 'left', 'right', 'confirm', 'cancel', 'menu', 'parry', 'dodge', 'jump', 'gradient', 'qte']);
  assert.deepEqual(DEFAULT_BINDINGS.parry, ['KeyE', 'KeyJ', 'pad:5', 'pad:2']);
  assert.deepEqual(DEFAULT_BINDINGS.dodge, ['KeyQ', 'KeyK', 'ShiftLeft', 'ShiftRight', 'pad:4', 'pad:1']);
  assert.deepEqual(DEFAULT_BINDINGS.jump, ['Space', 'KeyI', 'pad:0']);
  assert.deepEqual(DEFAULT_BINDINGS.gradient, ['KeyF', 'KeyL', 'pad:3']);
  assert.deepEqual(DEFAULT_BINDINGS.qte, ['Space', 'Enter', 'KeyE', 'KeyJ', 'pad:0', 'pad:2', 'pad:5']);
  assert.deepEqual(DEFAULT_BINDINGS.confirm, ['Enter', 'Space', 'KeyZ', 'pad:0']);
  assert.deepEqual(DEFAULT_BINDINGS.cancel, ['Escape', 'Backspace', 'KeyX', 'pad:1']);
  assert.deepEqual(DEFAULT_BINDINGS.menu, ['Escape', 'Tab', 'pad:9']);
  assert.equal(PRESS_LOG_MS, 3000);
});

test('headless construction (no window) still supports virtual input', () => {
  const input = new Input(null);
  input.beginFrame(0);
  assert.equal(input.isDown('confirm'), false);
  input.virtualPress('confirm');
  input.beginFrame(16);
  assert.equal(input.pressed('confirm'), true);
});

test('keyboard press: log entries for every mapped action, edges per frame, release', () => {
  const win = fakeWindow();
  const input = new Input(win);
  win.clock.now = 1234.5;
  key(win, 'keydown', 'KeyE', { timeStamp: 1230.25 });
  assert.deepEqual(input.pressLog.map((p) => [p.action, p.t, p.source]), [['parry', 1230.25, 'keyboard'], ['qte', 1230.25, 'keyboard']]);
  assert.equal(input.pressed('parry'), false, 'edges publish at beginFrame');
  input.beginFrame(1240);
  assert.equal(input.pressed('parry'), true);
  assert.equal(input.pressed('qte'), true);
  assert.equal(input.pressed('dodge'), false);
  assert.equal(input.isDown('parry'), true);
  assert.equal(input.anyPressed(['dodge', 'parry']), 'parry');
  input.endFrame();
  assert.equal(input.pressed('parry'), false);
  input.beginFrame(1256);
  assert.equal(input.pressed('parry'), false, 'edge lasts one frame');
  assert.equal(input.isDown('parry'), true);
  key(win, 'keyup', 'KeyE');
  input.beginFrame(1272);
  assert.equal(input.released('parry'), true);
  assert.equal(input.isDown('parry'), false);
  assert.equal(input.lastDevice, 'keyboard');
});

test('Space maps to confirm, jump and qte; auto-repeat is ignored', () => {
  const win = fakeWindow();
  const input = new Input(win);
  key(win, 'keydown', 'Space');
  key(win, 'keydown', 'Space', { repeat: true });
  key(win, 'keydown', 'Space'); // OS re-sent keydown for a held key
  assert.deepEqual(input.pressLog.map((p) => p.action), ['confirm', 'jump', 'qte']);
});

test('a tap between frames is not lost (pressed and released in the same frame)', () => {
  const win = fakeWindow();
  const input = new Input(win);
  input.beginFrame(1000);
  key(win, 'keydown', 'KeyQ');
  key(win, 'keyup', 'KeyQ');
  input.beginFrame(1016);
  assert.equal(input.pressed('dodge'), true);
  assert.equal(input.released('dodge'), true);
  assert.equal(input.isDown('dodge'), false);
});

test('timestamps: event.timeStamp on the performance clock; epoch / zero stamps fall back', () => {
  const win = fakeWindow();
  const input = new Input(win);
  win.clock.now = 5000;
  key(win, 'keydown', 'KeyE', { timeStamp: 4990.125 });
  assert.equal(input.pressLog.at(-1).t, 4990.125);
  key(win, 'keydown', 'KeyQ', { timeStamp: 1_727_000_000_000 });
  assert.equal(input.pressLog.at(-1).t, 5000, 'epoch-based timeStamp → performance.now()');
  key(win, 'keydown', 'KeyF', { timeStamp: 0 });
  assert.equal(input.pressLog.at(-1).t, 5000);
  input.virtualPress('jump');
  assert.equal(input.pressLog.at(-1).t, 5000);
  assert.equal(input.pressLog.at(-1).source, 'touch');
});

test('press log: pressesSince (strict, chronological), framePresses (exactly once), pruning', () => {
  const win = fakeWindow();
  const input = new Input(win);
  input.beginFrame(1000);
  key(win, 'keydown', 'KeyE', { timeStamp: 1005 });
  key(win, 'keyup', 'KeyE');
  key(win, 'keydown', 'KeyQ', { timeStamp: 1003 });
  input.beginFrame(1016);
  const fp = input.framePresses(['parry', 'dodge']);
  assert.deepEqual(fp.map((p) => [p.action, p.t]), [['dodge', 1003], ['parry', 1005]], 'sorted by time');
  assert.equal(input.framePresses().length, 3, 'unfiltered includes qte');
  key(win, 'keydown', 'KeyF', { timeStamp: 1020 });
  input.beginFrame(1032);
  assert.deepEqual(input.framePresses().map((p) => p.action), ['gradient'], 'previous frame presses not repeated');
  input.beginFrame(1048);
  assert.deepEqual(input.framePresses(), []);
  assert.deepEqual(input.pressesSince(1003).map((p) => p.action), ['parry', 'qte', 'gradient'], 'strictly after t');
  assert.deepEqual(input.pressesSince(0, ['dodge']).map((p) => p.t), [1003]);
  const seq = input.lastSeq;
  key(win, 'keydown', 'KeyJ', { timeStamp: 1050 });
  assert.deepEqual(input.pressesAfter(seq).map((p) => p.action), ['parry', 'qte']);
  input.beginFrame(1003 + PRESS_LOG_MS + 1);
  assert.ok(input.pressLog.every((p) => p.t >= 1004), 'entries older than 3 s dropped');
  assert.equal(input.pressLog.some((p) => p.action === 'dodge'), false);
});

test('preventDefault for Space/arrows/Tab/Backspace/Escape but not other keys or text inputs', () => {
  const win = fakeWindow();
  const input = new Input(win);
  for (const code of ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace', 'Escape']) {
    assert.equal(key(win, 'keydown', code).defaultPrevented, true, code);
    key(win, 'keyup', code);
  }
  assert.equal(key(win, 'keydown', 'KeyE').defaultPrevented, false);
  const textInput = { tagName: 'INPUT', type: 'text' };
  const before = input.pressLog.length;
  const ev = key(win, 'keydown', 'Space', { target: textInput });
  assert.equal(ev.defaultPrevented, false, 'typing a space in a text field works');
  assert.equal(input.pressLog.length, before, 'and does not trigger game actions');
  key(win, 'keydown', 'Escape', { target: { tagName: 'TEXTAREA' } });
  assert.equal(input.pressLog.at(-1).code, 'Escape', 'Escape still reaches the game from text fields');
  const button = { tagName: 'BUTTON' };
  key(win, 'keyup', 'Space');
  assert.equal(key(win, 'keydown', 'Space', { target: button }).defaultPrevented, true);
});

test('ctrl/meta shortcuts pass through; releasing Cmd releases everything (macOS keyup quirk)', () => {
  const win = fakeWindow();
  const input = new Input(win);
  const before = input.pressLog.length;
  key(win, 'keydown', 'KeyR', { metaKey: true });
  key(win, 'keydown', 'KeyE', { ctrlKey: true });
  assert.equal(input.pressLog.length, before);
  key(win, 'keydown', 'KeyW');
  input.beginFrame(1000);
  assert.equal(input.isDown('up'), true);
  key(win, 'keyup', 'MetaLeft');
  input.beginFrame(1016);
  assert.equal(input.isDown('up'), false);
  assert.equal(input.released('up'), true);
});

test('window blur clears held keys and virtual buttons', () => {
  const win = fakeWindow();
  const input = new Input(win);
  key(win, 'keydown', 'KeyD');
  input.virtualPress('parry');
  input.beginFrame(1000);
  assert.equal(input.isDown('right'), true);
  assert.equal(input.isDown('parry'), true);
  win.fire('blur');
  input.beginFrame(1016);
  assert.equal(input.isDown('right'), false);
  assert.equal(input.isDown('parry'), false);
  assert.equal(input.released('right'), true);
  assert.equal(input.released('parry'), true);
});

test('custom bindings merge over defaults', () => {
  const win = fakeWindow();
  const input = new Input(win);
  input.setBindings({ parry: ['KeyP'], bogus: ['KeyZ'], dodge: 'nope' });
  assert.deepEqual(input.bindings.parry, ['KeyP']);
  assert.deepEqual(input.bindings.dodge, [...DEFAULT_BINDINGS.dodge]);
  key(win, 'keydown', 'KeyE');
  assert.deepEqual(input.pressLog.map((p) => p.action), ['qte'], 'KeyE no longer parries but still strikes');
  key(win, 'keydown', 'KeyP');
  assert.equal(input.pressLog.at(-1).action, 'parry');
  assert.equal(input.keyLabel('parry', 'keyboard'), 'P');
  assert.deepEqual(input.actionsFor('Space'), ['confirm', 'jump', 'qte']);
  input.setBindings(null);
  assert.deepEqual(input.bindings.parry, [...DEFAULT_BINDINGS.parry]);
});

test('keyLabel per device', () => {
  const input = new Input(null);
  const kb = Object.fromEntries(['parry', 'dodge', 'jump', 'gradient', 'confirm', 'cancel', 'qte', 'up'].map((a) => [a, input.keyLabel(a, 'keyboard')]));
  assert.deepEqual(kb, { parry: 'E', dodge: 'Q', jump: 'Space', gradient: 'F', confirm: 'Enter', cancel: 'Esc', qte: 'Space', up: '↑' });
  const pad = Object.fromEntries(['parry', 'dodge', 'jump', 'gradient', 'confirm', 'cancel', 'menu'].map((a) => [a, input.keyLabel(a, 'gamepad')]));
  assert.deepEqual(pad, { parry: 'RB', dodge: 'LB', jump: 'A', gradient: 'Y', confirm: 'A', cancel: 'B', menu: 'Menu' });
  assert.equal(input.keyLabel('parry', 'touch'), 'Parry');
  assert.equal(input.keyLabel('parry'), 'E', 'defaults to lastDevice (keyboard)');
  assert.deepEqual(input.keyLabels('dodge', 'keyboard'), ['Q', 'K', 'Shift']);
  assert.equal(codeLabel('Digit7'), '7');
  assert.equal(codeLabel('pad:12'), 'D-Pad ↑');
  assert.equal(codeLabel('Backquote'), '`');
});

test('virtual buttons: press/release edges, counting, device', () => {
  const input = new Input(null);
  const devices = [];
  input.events.on('device', (d) => devices.push(d));
  input.virtualPress('dodge');
  input.virtualPress('dodge');
  input.beginFrame(10);
  assert.equal(input.pressed('dodge'), true);
  assert.equal(input.lastDevice, 'touch');
  assert.deepEqual(devices, ['touch']);
  input.virtualRelease('dodge');
  input.beginFrame(20);
  assert.equal(input.isDown('dodge'), true, 'still held by the second touch');
  input.virtualRelease('dodge');
  input.beginFrame(30);
  assert.equal(input.released('dodge'), true);
  assert.equal(input.isDown('dodge'), false);
  const orig = console.warn;
  console.warn = () => {};
  try {
    input.virtualPress('nonsense');
  } finally {
    console.warn = orig;
  }
  assert.equal(input.pressLog.length, 2);
});

test('virtualPress accepts an explicit event timestamp; anyKeyPressed sees unbound keys', () => {
  const win = fakeWindow();
  const input = new Input(win);
  win.clock.now = 5000;
  input.virtualPress('parry', 'touch', 4925);
  assert.equal(input.pressLog.at(-1).t, 4925, 'the finger-down time is logged, not the handler time');
  input.virtualRelease('parry');
  input.virtualPress('parry', 'touch', 99999);
  assert.equal(input.pressLog.at(-1).t, 5000, 'implausible stamps fall back to performance.now()');
  input.virtualRelease('parry');
  input.beginFrame(5001);
  input.endFrame();
  input.beginFrame(5002);
  assert.equal(input.anyKeyPressed(), false);
  key(win, 'keydown', 'KeyP');
  input.beginFrame(5016);
  assert.equal(input.anyKeyPressed(), true, 'an unbound key still counts for "press any key"');
  assert.equal(input.anyPressed(), null);
  input.endFrame();
  assert.equal(input.anyKeyPressed(), false);
});

test('gamepad: polled buttons log with t = frame time; stick axis with deadzone and digital directions', () => {
  const win = fakeWindow();
  const input = new Input(win);
  win.pads.push(makePad({ buttons: [5] }));
  input.beginFrame(2000);
  assert.equal(input.pressed('parry'), true);
  assert.equal(input.pressed('qte'), true);
  assert.equal(input.lastDevice, 'gamepad');
  assert.deepEqual(input.pressLog.map((p) => [p.action, p.t, p.source]), [['parry', 2000, 'gamepad'], ['qte', 2000, 'gamepad']]);
  assert.deepEqual(input.framePresses().map((p) => p.action), ['parry', 'qte'], 'pad presses belong to the frame that polled them');
  input.endFrame();
  input.beginFrame(2016);
  assert.equal(input.pressed('parry'), false);
  assert.equal(input.isDown('parry'), true);
  win.pads[0] = makePad({ buttons: [] });
  input.beginFrame(2032);
  assert.equal(input.released('parry'), true);

  win.pads[0] = makePad({ axes: [0.1, 0.1, 0, 0] });
  input.beginFrame(2048);
  assert.deepEqual(input.axis(), { x: 0, y: 0 }, 'inside deadzone');
  win.pads[0] = makePad({ axes: [1, 0, 0, 0] });
  input.beginFrame(2064);
  const a = input.axis();
  assert.ok(Math.abs(a.x - 1) < 1e-9 && a.y === 0);
  assert.equal(input.isDown('right'), true, 'stick drives digital directions');
  assert.equal(input.pressed('right'), true);
  win.pads[0] = makePad({ axes: [0.4, 0, 0, 0] });
  input.beginFrame(2080);
  assert.equal(input.isDown('right'), true, 'hysteresis keeps it held above 0.35');
  const mid = input.axis();
  assert.ok(mid.x > 0 && mid.x < 1);
  win.pads[0] = makePad({ axes: [0.3, 0, 0, 0] });
  input.beginFrame(2096);
  assert.equal(input.isDown('right'), false);
  win.pads[0] = null;
  input.beginFrame(2112);
  assert.deepEqual(input.axis(), { x: 0, y: 0 });
});

test('axis from keys is normalised on diagonals', () => {
  const win = fakeWindow();
  const input = new Input(win);
  key(win, 'keydown', 'KeyD');
  key(win, 'keydown', 'KeyW');
  input.beginFrame(1000);
  const a = input.axis();
  assert.ok(Math.abs(Math.hypot(a.x, a.y) - 1) < 1e-9);
  assert.ok(a.x > 0 && a.y < 0);
});

test('enabled / block(): nothing is logged or reported while inactive', () => {
  const win = fakeWindow();
  const input = new Input(win);
  input.enabled = false;
  key(win, 'keydown', 'KeyE');
  input.beginFrame(1000);
  assert.equal(input.pressLog.length, 0);
  assert.equal(input.isDown('parry'), false);
  input.enabled = true;
  input.beginFrame(1016);
  assert.equal(input.isDown('parry'), true, 'held state was still tracked');
  assert.equal(input.pressed('parry'), false);
  key(win, 'keyup', 'KeyE');
  input.block();
  input.block();
  key(win, 'keydown', 'KeyQ');
  input.unblock();
  assert.equal(input.blocked, true);
  input.unblock();
  assert.equal(input.blocked, false);
  assert.equal(input.pressLog.length, 0);
});

test('pointer: stage mapping, edges, touch device', () => {
  const win = fakeWindow();
  const input = new Input(win);
  input.setStageRect({ left: 100, top: 50, width: 640, height: 360 }, 0.5);
  win.fire('pointermove', { clientX: 740, clientY: 410, isPrimary: true, pointerType: 'mouse' });
  assert.equal(input.pointer.x, 1280);
  assert.equal(input.pointer.y, 720);
  assert.equal(input.pointer.inside, true);
  win.fire('pointerdown', { clientX: 150, clientY: 100, isPrimary: true, pointerType: 'touch', button: 0, timeStamp: 1000 });
  input.beginFrame(1000);
  assert.deepEqual([input.pointer.x, input.pointer.y, input.pointer.down, input.pointer.pressed], [100, 100, true, true]);
  assert.equal(input.lastDevice, 'touch');
  input.endFrame();
  assert.equal(input.pointer.pressed, false);
  win.fire('pointerup', { clientX: 150, clientY: 100, isPrimary: true, pointerType: 'touch' });
  input.beginFrame(1016);
  assert.equal(input.pointer.released, true);
  assert.equal(input.pointer.down, false);
  win.fire('pointermove', { clientX: 0, clientY: 0, isPrimary: true });
  assert.equal(input.pointer.inside, false);
  assert.deepEqual(input.toStage(420, 230), { x: 640, y: 360 });
});

test('pressedRepeat and consume', () => {
  const win = fakeWindow();
  const input = new Input(win);
  input.beginFrame(1000);
  key(win, 'keydown', 'ArrowDown', { timeStamp: 1000 });
  input.beginFrame(1016);
  assert.equal(input.pressedRepeat('down'), true, 'first frame');
  const fired = [];
  for (let t = 1032; t <= 1700; t += 16) {
    input.beginFrame(t);
    if (input.pressedRepeat('down')) fired.push(t);
  }
  assert.ok(fired.length >= 3, 'repeats after the delay');
  assert.ok(fired[0] >= 1380, 'not before the 380 ms delay');
  key(win, 'keydown', 'KeyE');
  input.beginFrame(1800);
  input.consume('parry');
  assert.equal(input.pressed('parry'), false);
  assert.equal(input.pressed('qte'), true);
  input.consume();
  assert.equal(input.pressed('qte'), false);
});

test('raw key queries and detach', () => {
  const win = fakeWindow();
  const input = new Input(win);
  key(win, 'keydown', 'KeyB');
  input.beginFrame(1000);
  assert.equal(input.keyPressed('KeyB'), true);
  assert.equal(input.keyDown('KeyB'), true);
  input.beginFrame(1016);
  assert.equal(input.keyPressed('KeyB'), false);
  input.detach();
  key(win, 'keydown', 'KeyE');
  assert.equal(input.pressLog.length, 0);
});

test('on-screen Back / Pause taps (virtualPress then virtualRelease in one event) reach the next frame', () => {
  const win = fakeWindow();
  const input = new Input(win);
  win.clock.now = 2000;
  input.beginFrame(2000);
  // The HUD's buttons press and release inside one pointer event, before the frame that reads them.
  input.virtualPress('cancel', 'touch', 1995);
  input.virtualRelease('cancel');
  input.beginFrame(2016);
  assert.equal(input.pressed('cancel'), true, 'the tap is not lost');
  assert.equal(input.released('cancel'), true);
  assert.equal(input.pressed('menu'), false, 'a virtual Back is cancel only (Escape is the key that maps to both)');
  assert.equal(input.isDown('cancel'), false);
  assert.equal(input.lastDevice, 'touch');
  assert.equal(input.pressLog.at(-1).t, 1995);
  input.consume(['cancel', 'menu']);
  assert.equal(input.pressed('cancel'), false, 'consumed like a key press');
  input.endFrame();
  input.virtualPress('menu', 'touch', 2020);
  input.virtualRelease('menu');
  input.beginFrame(2032);
  assert.equal(input.pressed('menu'), true);
  assert.equal(input.pressed('cancel'), false);
  assert.equal(input.keyLabel('cancel', 'touch'), 'Back');
  assert.equal(input.keyLabel('menu', 'touch'), 'Menu');
  // Escape on a keyboard is both, so scenes that honour either work with any of the three sources.
  key(win, 'keydown', 'Escape');
  input.beginFrame(2048);
  assert.equal(input.pressed('cancel') && input.pressed('menu'), true);
});
