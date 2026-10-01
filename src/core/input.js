// Unified input for Expedition 69: keyboard (event.code), pointer/touch, Gamepad API (standard mapping,
// polled) and virtual on-screen buttons, mapped to game actions with per-frame edges and a
// high-resolution press log (performance.now clock) that the QTE judges consume.
// Import-safe in Node: nothing touches window/document until an Input is constructed with a window.

import { Emitter } from './events.js';

/** Every game action. */
export const ACTIONS = Object.freeze(['up', 'down', 'left', 'right', 'confirm', 'cancel', 'menu', 'parry', 'dodge', 'jump', 'gradient', 'qte']);

/** Default bindings: KeyboardEvent.code values and `pad:N` standard-mapping gamepad buttons. */
export const DEFAULT_BINDINGS = Object.freeze({
  up: Object.freeze(['ArrowUp', 'KeyW', 'pad:12']),
  down: Object.freeze(['ArrowDown', 'KeyS', 'pad:13']),
  left: Object.freeze(['ArrowLeft', 'KeyA', 'pad:14']),
  right: Object.freeze(['ArrowRight', 'KeyD', 'pad:15']),
  confirm: Object.freeze(['Enter', 'Space', 'KeyZ', 'pad:0']),
  cancel: Object.freeze(['Escape', 'Backspace', 'KeyX', 'pad:1']),
  menu: Object.freeze(['Escape', 'Tab', 'pad:9']),
  parry: Object.freeze(['KeyE', 'KeyJ', 'pad:5', 'pad:2']),
  dodge: Object.freeze(['KeyQ', 'KeyK', 'ShiftLeft', 'ShiftRight', 'pad:4', 'pad:1']),
  jump: Object.freeze(['Space', 'KeyI', 'pad:0']),
  gradient: Object.freeze(['KeyF', 'KeyL', 'pad:3']),
  qte: Object.freeze(['Space', 'Enter', 'KeyE', 'KeyJ', 'pad:0', 'pad:2', 'pad:5']),
});

/** Friendly action names (used for touch labels and settings screens). */
export const ACTION_LABELS = Object.freeze({
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  confirm: 'Confirm',
  cancel: 'Back',
  menu: 'Menu',
  parry: 'Parry',
  dodge: 'Dodge',
  jump: 'Jump',
  gradient: 'Counter',
  qte: 'Strike',
});

/** How long the press log keeps entries (ms). */
export const PRESS_LOG_MS = 3000;
/** Radial deadzone of the left stick. */
export const STICK_DEADZONE = 0.25;

// The left stick always drives the four directions (with hysteresis) in addition to the d-pad.
const STICK_CODES = Object.freeze({ up: 'pad:ls-up', down: 'pad:ls-down', left: 'pad:ls-left', right: 'pad:ls-right' });
const STICK_ON = 0.5;
const STICK_OFF = 0.35;

// Keys whose browser default (scrolling, focus moves, history back, stop-loading/escape handling) must not fire
// during play. Escape is included: its default action in Chrome (stop / exit-pointer-lock handling) was measured
// to halve the frame rate of a running rAF loop in headless Chrome and to stall long CDP sessions.
const PREVENT_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace', 'Escape']);
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'number', 'url', 'tel', 'date', 'datetime-local', 'month', 'time', 'week']);

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-Pad ↑', 'D-Pad ↓', 'D-Pad ←', 'D-Pad →', 'Home'];
const CODE_NAMES = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Cmd', MetaRight: 'Cmd', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', Quote: "'",
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', CapsLock: 'Caps', Delete: 'Del', Insert: 'Ins',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  'pad:ls-up': 'LS ↑', 'pad:ls-down': 'LS ↓', 'pad:ls-left': 'LS ←', 'pad:ls-right': 'LS →',
};
const KEY_TO_CODE = { ' ': 'Space', Enter: 'Enter', Escape: 'Escape', Esc: 'Escape', Backspace: 'Backspace', Tab: 'Tab', Shift: 'ShiftLeft', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };

/**
 * Display label for a binding code: "KeyE" → "E", "Space" → "Space", "pad:5" → "RB".
 * @param {string} code
 * @returns {string}
 */
export function codeLabel(code) {
  if (typeof code !== 'string' || !code) return '?';
  if (Object.hasOwn(CODE_NAMES, code)) return CODE_NAMES[code];
  let m = /^pad:(\d+)$/.exec(code);
  if (m) return PAD_NAMES[Number(m[1])] ?? `Button ${m[1]}`;
  m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

function codeFromEvent(e) {
  if (typeof e.code === 'string' && e.code) return e.code;
  const k = e.key;
  if (typeof k !== 'string' || !k) return '';
  if (Object.hasOwn(KEY_TO_CODE, k)) return KEY_TO_CODE[k];
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^\d$/.test(k)) return `Digit${k}`;
  return '';
}

/**
 * Game input hub. The engine calls beginFrame(now) before and endFrame() after every scene update;
 * scenes read held state / edges, and QTE code reads the timestamped press log.
 */
export class Input {
  /**
   * @param {Window|null} [win]  window to listen on (null → headless: only virtual input works)
   */
  constructor(win = (typeof window !== 'undefined' ? window : null)) {
    /** Master switch: when false nothing reads as held or pressed and no presses are logged. */
    this.enabled = true;
    /**
     * Timestamped physical presses: one entry per action a press maps to, kept for PRESS_LOG_MS.
     * @type {Array<{action:string, t:number, source:'keyboard'|'gamepad'|'touch'|'virtual', seq:number, code:string|null}>}
     */
    this.pressLog = [];
    /** Pointer in stage coordinates; pressed/released are per-frame edges. */
    this.pointer = { x: 0, y: 0, down: false, pressed: false, released: false, inside: false, type: 'mouse', button: 0, overUI: false, target: null, t: 0 };
    /** @type {'keyboard'|'gamepad'|'touch'} */
    this.lastDevice = 'keyboard';
    /** Emits 'device' (newDevice), 'press' (logEntry), 'gamepad' ({connected, id}). */
    this.events = new Emitter();
    /** Time passed to the latest beginFrame(). */
    this.now = 0;
    /** Optional #ui element; used to flag pointer events that land on DOM UI (pointer.overUI). */
    this.uiRoot = null;

    this.win = win;
    this._perf = win?.performance ?? globalThis.performance ?? null;
    this._blockDepth = 0;
    this._bindings = {};
    this._actionCodes = new Map();
    this._codeActions = new Map();
    this._codesDown = new Set();
    this._keyboardDown = new Set();
    this._padDown = new Set();
    this._virtualDown = new Map();
    this._downSince = new Map();
    this._pendingPressed = new Set();
    this._pendingReleased = new Set();
    this._pendingCodes = new Set();
    this._framePressed = new Set();
    this._frameReleased = new Set();
    this._frameCodes = new Set();
    this._pointerPending = { pressed: false, released: false };
    this._stick = { x: 0, y: 0 };
    this._seq = 0;
    this._frameSeqStart = 0;
    this._frameSeqEnd = 0;
    this._prevNow = 0;
    this._rect = { left: 0, top: 0, width: 1280, height: 720 };
    this._scale = 1;
    this._warned = new Set();
    this._listeners = [];

    this.setBindings(null);
    if (win && typeof win.addEventListener === 'function') this.attach();
  }

  // ---------------------------------------------------------------- bindings

  /**
   * Replace bindings: defaults with each action in `map` overriding its default list.
   * @param {Record<string, string[]>|null} map
   */
  setBindings(map) {
    const b = {};
    for (const a of ACTIONS) b[a] = [...DEFAULT_BINDINGS[a]];
    if (map && typeof map === 'object') {
      for (const [a, codes] of Object.entries(map)) {
        if (!ACTIONS.includes(a) || !Array.isArray(codes)) continue;
        b[a] = [...new Set(codes.filter((c) => typeof c === 'string' && c.length > 0))];
      }
    }
    this._bindings = b;
    this._actionCodes.clear();
    this._codeActions.clear();
    for (const a of ACTIONS) {
      const codes = [...b[a]];
      if (STICK_CODES[a]) codes.push(STICK_CODES[a]);
      this._actionCodes.set(a, codes);
      for (const c of codes) {
        if (!this._codeActions.has(c)) this._codeActions.set(c, []);
        this._codeActions.get(c).push(a);
      }
    }
  }

  /** Copy of the active bindings {action: [codes]}. */
  get bindings() {
    const out = {};
    for (const a of ACTIONS) out[a] = [...this._bindings[a]];
    return out;
  }

  /** Actions a code is bound to. */
  actionsFor(code) {
    return [...(this._codeActions.get(code) ?? [])];
  }

  // ---------------------------------------------------------------- frame

  /**
   * Start a frame: poll gamepads, publish the input edges gathered since the last frame, prune the log.
   * @param {number} [now] performance.now() timestamp of this frame
   */
  beginFrame(now = this._perfNow()) {
    this._prevNow = this.now;
    this.now = now;
    this._pollGamepads(now);

    this._framePressed.clear();
    this._frameReleased.clear();
    this._frameCodes.clear();
    for (const a of this._pendingPressed) this._framePressed.add(a);
    for (const a of this._pendingReleased) this._frameReleased.add(a);
    for (const c of this._pendingCodes) this._frameCodes.add(c);
    this._pendingPressed.clear();
    this._pendingReleased.clear();
    this._pendingCodes.clear();

    this.pointer.pressed = this._pointerPending.pressed;
    this.pointer.released = this._pointerPending.released;
    this._pointerPending.pressed = false;
    this._pointerPending.released = false;

    this._frameSeqStart = this._frameSeqEnd;
    this._frameSeqEnd = this._seq;

    // Entries are in arrival (seq) order but not strictly time order (gamepad presses carry the
    // frame time), so compact in place instead of trimming the front.
    const cutoff = now - PRESS_LOG_MS;
    const log = this.pressLog;
    let keep = 0;
    for (let i = 0; i < log.length; i++) if (log[i].t >= cutoff) log[keep++] = log[i];
    log.length = keep;
  }

  /** End a frame: clear per-frame edges. */
  endFrame() {
    this._framePressed.clear();
    this._frameReleased.clear();
    this._frameCodes.clear();
    this.pointer.pressed = false;
    this.pointer.released = false;
  }

  // ---------------------------------------------------------------- queries

  /** True while any binding of the action (or a virtual button) is held. */
  isDown(action) {
    return this._active() && this._held(action);
  }

  /** True on the frame the action was pressed (edge since the last frame). */
  pressed(action) {
    return this._active() && this._framePressed.has(action);
  }

  /** True on the frame the action was fully released. */
  released(action) {
    return this._active() && this._frameReleased.has(action);
  }

  /**
   * First action of the list pressed this frame, or null.
   * @param {string[]} [actions=ACTIONS]
   * @returns {string|null}
   */
  anyPressed(actions = ACTIONS) {
    if (!this._active()) return null;
    for (const a of actions) if (this._framePressed.has(a)) return a;
    return null;
  }

  /**
   * True when any physical key or gamepad button went down this frame, bound to an action or not
   * (for "press any key" gates).
   */
  anyKeyPressed() {
    return this._active() && this._frameCodes.size > 0;
  }

  /**
   * Menu-style auto-repeat: true on the press frame, then every `interval` ms after `delay` while held.
   * @param {string} action
   * @param {number} [delay=380]
   * @param {number} [interval=90]
   */
  pressedRepeat(action, delay = 380, interval = 90) {
    if (!this._active()) return false;
    if (this._framePressed.has(action)) return true;
    if (!this._held(action)) return false;
    const since = this._downSince.get(action);
    if (since === undefined) return false;
    const d = this.now - since;
    if (d < delay) return false;
    const prev = this._prevNow - since;
    const n = Math.floor((d - delay) / interval);
    const pn = prev >= delay ? Math.floor((prev - delay) / interval) : -1;
    return n > pn;
  }

  /**
   * Swallow this frame's press edge(s) so later readers in the same frame don't react again.
   * @param {string|string[]} [actions] all actions when omitted
   */
  consume(actions) {
    if (actions === undefined) this._framePressed.clear();
    else for (const a of [].concat(actions)) this._framePressed.delete(a);
  }

  /** True while a raw code (e.g. 'KeyB', 'pad:3') is held — for dev/debug keys. */
  keyDown(code) {
    return this._active() && this._codesDown.has(code);
  }

  /** True on the frame a raw code was pressed — for dev/debug keys. */
  keyPressed(code) {
    return this._active() && this._frameCodes.has(code);
  }

  /**
   * Log entries with t > `t` (optionally filtered by action), chronological.
   * @param {number} t
   * @param {string[]} [actions]
   */
  pressesSince(t, actions) {
    const out = this.pressLog.filter((p) => p.t > t && (!actions || actions.includes(p.action)));
    return out.sort((a, b) => a.t - b.t || a.seq - b.seq);
  }

  /**
   * Log entries that arrived since the previous frame (each physical press appears in exactly one
   * frame's batch — the recommended way to feed QTE trackers), chronological.
   * @param {string[]} [actions]
   */
  framePresses(actions) {
    const out = [];
    for (let i = this.pressLog.length - 1; i >= 0; i--) {
      const p = this.pressLog[i];
      if (p.seq <= this._frameSeqStart) break;
      if (p.seq <= this._frameSeqEnd && (!actions || actions.includes(p.action))) out.push(p);
    }
    return out.sort((a, b) => a.t - b.t || a.seq - b.seq);
  }

  /** Sequence number of the newest log entry (use with pressesAfter for custom cursors). */
  get lastSeq() {
    return this._seq;
  }

  /** Log entries with seq > `seq`, chronological. */
  pressesAfter(seq, actions) {
    const out = this.pressLog.filter((p) => p.seq > seq && (!actions || actions.includes(p.action)));
    return out.sort((a, b) => a.t - b.t || a.seq - b.seq);
  }

  /**
   * Movement vector from the left stick (radial deadzone) or digital directions; length ≤ 1.
   * @returns {{x:number, y:number}}
   */
  axis() {
    if (!this._active()) return { x: 0, y: 0 };
    const { x: sx, y: sy } = this._stick;
    const m = Math.hypot(sx, sy);
    if (m > STICK_DEADZONE) {
      const k = Math.min(1, (m - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / m;
      return { x: sx * k, y: sy * k };
    }
    let x = 0;
    let y = 0;
    if (this._held('right')) x += 1;
    if (this._held('left')) x -= 1;
    if (this._held('down')) y += 1;
    if (this._held('up')) y -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /**
   * Label of the first binding of an action for a device, e.g. "E", "Space", "RB"; on touch the
   * action's friendly name.
   * @param {string} action
   * @param {'keyboard'|'gamepad'|'touch'} [device=this.lastDevice]
   * @returns {string}
   */
  keyLabel(action, device = this.lastDevice) {
    const codes = this._bindings[action];
    if (!codes) return ACTION_LABELS[action] ?? String(action);
    if (device === 'touch') return ACTION_LABELS[action] ?? action;
    const wantPad = device === 'gamepad';
    const code = codes.find((c) => c.startsWith('pad:') === wantPad) ?? codes[0];
    return code ? codeLabel(code) : (ACTION_LABELS[action] ?? action);
  }

  /** Labels of every binding of an action for a device ('keyboard' or 'gamepad'). */
  keyLabels(action, device = this.lastDevice) {
    const wantPad = device === 'gamepad';
    return [...new Set((this._bindings[action] ?? []).filter((c) => c.startsWith('pad:') === wantPad).map(codeLabel))];
  }

  // ---------------------------------------------------------------- virtual / touch

  /**
   * Press an action from an on-screen button.
   * @param {string} action
   * @param {'touch'|'virtual'} [source='touch']
   * @param {number} [t] press time on the performance.now() clock — pass the pointer event's timeStamp so a
   *   touch parry is judged when the finger landed, not when the handler ran (defaults to performance.now())
   */
  virtualPress(action, source = 'touch', t) {
    if (!ACTIONS.includes(action)) {
      this._warnOnce(`virtual:${action}`, `virtualPress: unknown action "${action}"`);
      return;
    }
    this._virtualDown.set(action, (this._virtualDown.get(action) ?? 0) + 1);
    if (source === 'touch') this._setDevice('touch');
    if (!this._active()) return;
    const now = this._perfNow();
    const stamp = Number.isFinite(t) && t > 0 && t <= now + 1000 ? t : now;
    this._pressAction(action, stamp, source, null);
  }

  /** Release an action pressed with virtualPress. */
  virtualRelease(action) {
    const n = this._virtualDown.get(action) ?? 0;
    if (n <= 0) return;
    if (n === 1) this._virtualDown.delete(action);
    else this._virtualDown.set(action, n - 1);
    if (!this._held(action)) this._markReleased(action);
  }

  /**
   * Tell the input where the (scaled) stage sits on screen, for pointer mapping.
   * @param {{left:number, top:number, width?:number, height?:number}} rect  client-space rect of the stage
   * @param {number} scale  CSS scale of the 1280×720 stage
   */
  setStageRect(rect, scale) {
    if (rect) this._rect = { left: rect.left ?? 0, top: rect.top ?? 0, width: rect.width ?? 1280 * scale, height: rect.height ?? 720 * scale };
    if (Number.isFinite(scale) && scale > 0) this._scale = scale;
  }

  /** Convert client (viewport) coordinates to stage coordinates. */
  toStage(clientX, clientY) {
    return { x: (clientX - this._rect.left) / this._scale, y: (clientY - this._rect.top) / this._scale };
  }

  /** Temporarily suppress input (nestable); used by the engine during fades. */
  block() {
    this._blockDepth += 1;
  }

  /** Undo one block(). */
  unblock() {
    this._blockDepth = Math.max(0, this._blockDepth - 1);
  }

  /** True while blocked by block(). */
  get blocked() {
    return this._blockDepth > 0;
  }

  /** Release everything held (keyboard, virtual buttons, pointer) — e.g. on blur / tab hide. */
  clear() {
    for (const code of [...this._keyboardDown]) this._releaseCode(code, true);
    for (const a of [...this._virtualDown.keys()]) {
      this._virtualDown.delete(a);
      if (!this._held(a)) this._markReleased(a);
    }
    if (this.pointer.down) {
      this.pointer.down = false;
      this._pointerPending.released = true;
    }
  }

  // ---------------------------------------------------------------- DOM wiring

  /** Start listening to the window (called by the constructor). */
  attach() {
    if (this._listeners.length || !this.win) return;
    const on = (type, fn, opts) => {
      this.win.addEventListener(type, fn, opts);
      this._listeners.push([type, fn, opts]);
    };
    on('keydown', (e) => this._onKeyDown(e), { passive: false });
    on('keyup', (e) => this._onKeyUp(e), { passive: false });
    on('pointerdown', (e) => this._onPointerDown(e), { passive: true });
    on('pointermove', (e) => this._onPointerMove(e), { passive: true });
    on('pointerup', (e) => this._onPointerUp(e), { passive: true });
    on('pointercancel', (e) => this._onPointerUp(e), { passive: true });
    on('blur', () => this.clear());
    on('gamepadconnected', (e) => this.events.emit('gamepad', { connected: true, id: e?.gamepad?.id ?? '' }));
    on('gamepaddisconnected', (e) => this.events.emit('gamepad', { connected: false, id: e?.gamepad?.id ?? '' }));
  }

  /** Stop listening to the window. */
  detach() {
    for (const [type, fn, opts] of this._listeners) this.win?.removeEventListener(type, fn, opts);
    this._listeners = [];
  }

  _onKeyDown(e) {
    const code = codeFromEvent(e);
    if (!code) return;
    if (this._isTextEntry(e.target) && code !== 'Escape') return;
    if (e.ctrlKey || e.metaKey) return; // browser / OS shortcuts pass through untouched
    if (PREVENT_CODES.has(code) && !this._isTextEntry(e.target) && typeof e.preventDefault === 'function') e.preventDefault();
    if (e.repeat || this._keyboardDown.has(code)) return;
    this._keyboardDown.add(code);
    this._codesDown.add(code);
    this._setDevice('keyboard');
    this._pressCode(code, this._eventTime(e), 'keyboard');
  }

  _onKeyUp(e) {
    const code = codeFromEvent(e);
    if (!code) return;
    if (PREVENT_CODES.has(code) && !this._isTextEntry(e.target) && typeof e.preventDefault === 'function') e.preventDefault();
    // macOS swallows keyup for keys released while Cmd is held: release everything with Cmd.
    if (code === 'MetaLeft' || code === 'MetaRight') {
      for (const c of [...this._keyboardDown]) this._releaseCode(c, true);
      return;
    }
    this._releaseCode(code, true);
  }

  _onPointerDown(e) {
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    this._setDevice(touch ? 'touch' : 'keyboard');
    if (e.isPrimary === false) return;
    this._movePointer(e);
    this.pointer.down = true;
    this.pointer.button = e.button ?? 0;
    this.pointer.type = e.pointerType || 'mouse';
    this.pointer.target = e.target ?? null;
    this.pointer.overUI = this._isOverUI(e.target);
    this.pointer.t = this._eventTime(e);
    this._pointerPending.pressed = true;
  }

  _onPointerMove(e) {
    if (e.isPrimary === false) return;
    this._movePointer(e);
  }

  _onPointerUp(e) {
    if (e.isPrimary === false) return;
    this._movePointer(e);
    if (this.pointer.down) {
      this.pointer.down = false;
      this._pointerPending.released = true;
    }
  }

  _movePointer(e) {
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    const p = this.toStage(e.clientX, e.clientY);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.inside = p.x >= 0 && p.y >= 0 && p.x <= 1280 && p.y <= 720;
  }

  _isOverUI(target) {
    const ui = this.uiRoot;
    return !!(ui && target && target !== ui && typeof ui.contains === 'function' && ui.contains(target));
  }

  _isTextEntry(target) {
    if (!target || typeof target !== 'object') return false;
    if (target.isContentEditable) return true;
    const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return TEXT_INPUT_TYPES.has(String(target.type || 'text').toLowerCase());
    return false;
  }

  // ---------------------------------------------------------------- gamepad

  _pollGamepads(now) {
    const nav = this.win?.navigator;
    if (!nav || typeof nav.getGamepads !== 'function') return;
    let pads;
    try {
      pads = nav.getGamepads();
    } catch {
      return;
    }
    const down = new Set();
    let sx = 0;
    let sy = 0;
    let best = 0;
    for (const pad of pads ?? []) {
      if (!pad || pad.connected === false) continue;
      const buttons = pad.buttons ?? [];
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        const isDown = typeof b === 'number' ? b > 0.5 : !!(b && (b.pressed || b.value > 0.5));
        if (isDown) down.add(`pad:${i}`);
      }
      const ax = Number(pad.axes?.[0]) || 0;
      const ay = Number(pad.axes?.[1]) || 0;
      const m = Math.hypot(ax, ay);
      if (m > best) {
        best = m;
        sx = ax;
        sy = ay;
      }
    }
    this._stick = { x: sx, y: sy };
    // Stick → digital directions with hysteresis (menus / world movement feel consistent with the d-pad).
    const dirs = { right: sx, left: -sx, down: sy, up: -sy };
    for (const [dir, v] of Object.entries(dirs)) {
      const code = STICK_CODES[dir];
      const was = this._padDown.has(code);
      if (v > STICK_ON || (was && v > STICK_OFF)) down.add(code);
    }
    let activity = false;
    for (const code of down) {
      if (this._padDown.has(code)) continue;
      this._codesDown.add(code);
      this._pressCode(code, now, 'gamepad');
      activity = true;
    }
    for (const code of this._padDown) {
      if (down.has(code)) continue;
      this._codesDown.delete(code);
      for (const a of this._codeActions.get(code) ?? []) if (!this._held(a)) this._markReleased(a);
    }
    this._padDown = down;
    if (activity || best > STICK_ON) this._setDevice('gamepad');
  }

  // ---------------------------------------------------------------- internals

  _active() {
    return this.enabled && this._blockDepth === 0;
  }

  _held(action) {
    if ((this._virtualDown.get(action) ?? 0) > 0) return true;
    const codes = this._actionCodes.get(action);
    if (!codes) return false;
    for (const c of codes) if (this._codesDown.has(c)) return true;
    return false;
  }

  _pressCode(code, t, source) {
    if (!this._active()) return;
    this._pendingCodes.add(code);
    for (const a of this._codeActions.get(code) ?? []) this._pressAction(a, t, source, code);
  }

  _pressAction(action, t, source, code) {
    this._pendingPressed.add(action);
    this._pendingReleased.delete(action);
    if (!this._downSince.has(action)) this._downSince.set(action, t);
    const entry = { action, t, source, seq: ++this._seq, code };
    this.pressLog.push(entry);
    this.events.emit('press', entry);
  }

  _releaseCode(code, keyboard) {
    if (keyboard) this._keyboardDown.delete(code);
    if (!this._codesDown.delete(code)) return;
    for (const a of this._codeActions.get(code) ?? []) if (!this._held(a)) this._markReleased(a);
  }

  _markReleased(action) {
    this._downSince.delete(action);
    this._pendingReleased.add(action);
  }

  _setDevice(device) {
    if (this.lastDevice === device) return;
    this.lastDevice = device;
    this.events.emit('device', device);
  }

  _eventTime(e) {
    const now = this._perfNow();
    const ts = e?.timeStamp;
    // event.timeStamp shares performance.now()'s clock in modern browsers; very old engines used
    // epoch milliseconds (or 0) — detect that and fall back to the current high-res time.
    if (Number.isFinite(ts) && ts > 0 && ts <= now + 1000) return ts;
    return now;
  }

  _perfNow() {
    return this._perf && typeof this._perf.now === 'function' ? this._perf.now() : Date.now();
  }

  _warnOnce(key, msg) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`[input] ${msg}`);
  }
}
