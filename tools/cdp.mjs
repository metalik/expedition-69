#!/usr/bin/env node
// Zero-dependency headless Chrome harness over the DevTools protocol (Node's built-in WebSocket + fetch).
// Library: const { page, close } = await launch({ width, height, headless }); await page.goto(url); ...
// CLI:     node tools/cdp.mjs <url> [--shot out.png] [--wait ms] [--eval "expr"] [--keys "KeyE@500,Space@900"]

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Chrome executables tried in order (CHROME_PATH env var first). */
export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

/** Find a Chrome executable or throw. */
export function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('Chrome not found. Set CHROME_PATH to your Chrome/Chromium executable.');
}

/** Resolve after ms. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// ------------------------------------------------------------------ keyboard table

const KEY_DEFS = (() => {
  const d = {};
  for (let i = 0; i < 26; i++) {
    const lower = String.fromCharCode(97 + i);
    d[`Key${lower.toUpperCase()}`] = { key: lower, keyCode: 65 + i, text: lower, shiftKey: lower.toUpperCase() };
  }
  const shiftedDigits = ')!@#$%^&*(';
  for (let i = 0; i < 10; i++) {
    d[`Digit${i}`] = { key: String(i), keyCode: 48 + i, text: String(i), shiftKey: shiftedDigits[i] };
    d[`Numpad${i}`] = { key: String(i), keyCode: 96 + i, text: String(i), location: 3 };
  }
  Object.assign(d, {
    Space: { key: ' ', keyCode: 32, text: ' ' },
    Enter: { key: 'Enter', keyCode: 13, text: '\r' },
    NumpadEnter: { key: 'Enter', keyCode: 13, text: '\r', location: 3 },
    Escape: { key: 'Escape', keyCode: 27 },
    Tab: { key: 'Tab', keyCode: 9 },
    Backspace: { key: 'Backspace', keyCode: 8 },
    Delete: { key: 'Delete', keyCode: 46 },
    ArrowLeft: { key: 'ArrowLeft', keyCode: 37 },
    ArrowUp: { key: 'ArrowUp', keyCode: 38 },
    ArrowRight: { key: 'ArrowRight', keyCode: 39 },
    ArrowDown: { key: 'ArrowDown', keyCode: 40 },
    Home: { key: 'Home', keyCode: 36 },
    End: { key: 'End', keyCode: 35 },
    PageUp: { key: 'PageUp', keyCode: 33 },
    PageDown: { key: 'PageDown', keyCode: 34 },
    ShiftLeft: { key: 'Shift', keyCode: 16, location: 1, modifier: 8 },
    ShiftRight: { key: 'Shift', keyCode: 16, location: 2, modifier: 8 },
    ControlLeft: { key: 'Control', keyCode: 17, location: 1, modifier: 2 },
    ControlRight: { key: 'Control', keyCode: 17, location: 2, modifier: 2 },
    AltLeft: { key: 'Alt', keyCode: 18, location: 1, modifier: 1 },
    AltRight: { key: 'Alt', keyCode: 18, location: 2, modifier: 1 },
    MetaLeft: { key: 'Meta', keyCode: 91, location: 1, modifier: 4 },
    MetaRight: { key: 'Meta', keyCode: 93, location: 2, modifier: 4 },
    Backquote: { key: '`', keyCode: 192, text: '`', shiftKey: '~' },
    Minus: { key: '-', keyCode: 189, text: '-', shiftKey: '_' },
    Equal: { key: '=', keyCode: 187, text: '=', shiftKey: '+' },
    BracketLeft: { key: '[', keyCode: 219, text: '[', shiftKey: '{' },
    BracketRight: { key: ']', keyCode: 221, text: ']', shiftKey: '}' },
    Backslash: { key: '\\', keyCode: 220, text: '\\', shiftKey: '|' },
    Semicolon: { key: ';', keyCode: 186, text: ';', shiftKey: ':' },
    Quote: { key: "'", keyCode: 222, text: "'", shiftKey: '"' },
    Comma: { key: ',', keyCode: 188, text: ',', shiftKey: '<' },
    Period: { key: '.', keyCode: 190, text: '.', shiftKey: '>' },
    Slash: { key: '/', keyCode: 191, text: '/', shiftKey: '?' },
  });
  for (let i = 1; i <= 12; i++) d[`F${i}`] = { key: `F${i}`, keyCode: 111 + i };
  return d;
})();

/** Supported KeyboardEvent.code values for page.key / page.press. */
export const KEY_CODES = Object.freeze(Object.keys(KEY_DEFS));

// ------------------------------------------------------------------ cleanup registry

const liveBrowsers = new Set();
let exitHooksInstalled = false;

function killSync(b) {
  try {
    if (b.proc.exitCode === null && b.proc.signalCode === null) b.proc.kill('SIGKILL');
  } catch {
    // already gone
  }
  try {
    rmSync(b.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // best effort
  }
}

function installExitHooks() {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.on('exit', () => {
    for (const b of liveBrowsers) killSync(b);
    liveBrowsers.clear();
  });
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(sig, () => {
      for (const b of liveBrowsers) killSync(b);
      liveBrowsers.clear();
      process.exit(code);
    });
  }
}

// ------------------------------------------------------------------ CDP connection

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this._onMessage(ev));
    ws.addEventListener('close', () => this._onClose());
    ws.addEventListener('error', () => this._onClose());
  }

  static open(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error(`CDP WebSocket connect timeout: ${url}`)), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new Connection(ws));
      }, { once: true });
      ws.addEventListener('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`CDP WebSocket error: ${e?.message ?? 'connection failed'}`));
      }, { once: true });
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error(`CDP connection closed (${method})`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  waitForEvent(event, timeoutMs = 30000, predicate = () => true) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${event}`));
      }, timeoutMs);
      const off = this.on(event, (params) => {
        if (!predicate(params)) return;
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`CDP ${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else p.resolve(msg.result ?? {});
      return;
    }
    const set = this.listeners.get(msg.method);
    if (set) for (const fn of [...set]) fn(msg.params ?? {});
  }

  _onClose() {
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`CDP connection closed during ${p.method}`));
    }
    this.pending.clear();
  }
}

const SAFE_CLONE = `function () {
  const seen = new WeakSet();
  const clone = (v, depth) => {
    if (typeof v === 'bigint') return String(v);
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
    if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    if (typeof Node !== 'undefined' && v instanceof Node) return '[' + v.nodeName + ']';
    if (depth > 6) return '[' + ((v.constructor && v.constructor.name) || 'Object') + ']';
    seen.add(v);
    if (Array.isArray(v)) return v.slice(0, 1000).map((x) => clone(x, depth + 1));
    const out = {};
    for (const k of Object.keys(v).slice(0, 1000)) {
      try { out[k] = clone(v[k], depth + 1); } catch (e) { out[k] = '[Unreadable]'; }
    }
    return out;
  };
  return clone(this, 0);
}`;

function remoteObjectText(o) {
  if (!o) return '';
  if (o.type === 'string') return o.value;
  if ('value' in o) return typeof o.value === 'object' ? JSON.stringify(o.value) : String(o.value);
  if (o.unserializableValue) return o.unserializableValue;
  if (o.preview?.properties) {
    const props = o.preview.properties.map((p) => `${p.name}: ${p.value}`).join(', ');
    return o.subtype === 'array' ? `[${props}]` : `{${props}}`;
  }
  return o.description ?? o.type ?? '';
}

function exceptionText(d) {
  const desc = d?.exception?.description ?? d?.exception?.value ?? d?.text ?? 'Unknown exception';
  const where = d?.url ? ` (${d.url}:${(d.lineNumber ?? 0) + 1}:${(d.columnNumber ?? 0) + 1})` : '';
  return `${desc}${desc.includes('\n    at ') ? '' : where}`;
}

/**
 * A controllable page (one Chrome tab).
 */
export class Page {
  constructor(conn, { width, height }) {
    this.conn = conn;
    this.width = width;
    this.height = height;
    /** Console output: [{type, text, time}] (includes browser Log entries as 'log.<level>'). */
    this.consoleMessages = [];
    /** Uncaught page exceptions and unhandled rejections: [{message, time}]. */
    this.errors = [];
    this._modifiers = 0;
    this._handlers = { console: new Set(), error: new Set() };

    conn.on('Runtime.consoleAPICalled', (p) => {
      const msg = { type: p.type, text: (p.args ?? []).map(remoteObjectText).join(' '), time: Date.now() };
      this.consoleMessages.push(msg);
      for (const fn of this._handlers.console) fn(msg);
    });
    conn.on('Log.entryAdded', ({ entry }) => {
      if (!entry) return;
      const msg = { type: `log.${entry.level}`, text: `${entry.text}${entry.url ? ` (${entry.url})` : ''}`, time: Date.now() };
      this.consoleMessages.push(msg);
      for (const fn of this._handlers.console) fn(msg);
    });
    conn.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      const err = { message: exceptionText(exceptionDetails), time: Date.now() };
      this.errors.push(err);
      for (const fn of this._handlers.error) fn(err);
    });
  }

  /** Raw CDP command. */
  send(method, params, timeoutMs) {
    return this.conn.send(method, params, timeoutMs);
  }

  /**
   * Listen to 'console' ({type,text}), 'error' ({message}) or any raw CDP event name.
   * @returns {() => void} unsubscribe
   */
  on(event, fn) {
    if (this._handlers[event]) {
      this._handlers[event].add(fn);
      return () => this._handlers[event].delete(fn);
    }
    return this.conn.on(event, fn);
  }

  async _init() {
    await Promise.all([
      this.send('Page.enable'),
      this.send('Runtime.enable'),
      this.send('Log.enable'),
    ]);
    await this.setViewport(this.width, this.height);
    // Without focus emulation headless Chrome flips the page to visibilityState 'hidden' on the
    // first Escape key event (pausing rAF loops) and fires blur events. (Page.bringToFront is
    // deliberately NOT used: after input it starves setTimeout on pages running an rAF loop.)
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }

  /** Set the viewport size (CSS px) via device metrics emulation. */
  async setViewport(width, height, deviceScaleFactor = 1) {
    this.width = width;
    this.height = height;
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  }

  /**
   * Navigate and wait.
   * @param {string} url
   * @param {{waitUntil?:'load'|'domcontentloaded'|'none', timeout?:number}} [opts]
   */
  async goto(url, { waitUntil = 'load', timeout = 30000 } = {}) {
    const eventName = waitUntil === 'domcontentloaded' ? 'Page.domContentEventFired' : 'Page.loadEventFired';
    const waiter = waitUntil === 'none' ? null : this.conn.waitForEvent(eventName, timeout);
    const res = await this.send('Page.navigate', { url });
    if (res.errorText) {
      waiter?.catch(() => {});
      throw new Error(`Navigation to ${url} failed: ${res.errorText}`);
    }
    if (waiter) await waiter;
    return res;
  }

  /** Reload the page and wait for load. */
  async reload({ timeout = 30000 } = {}) {
    const waiter = this.conn.waitForEvent('Page.loadEventFired', timeout);
    await this.send('Page.reload', { ignoreCache: true });
    await waiter;
  }

  /**
   * Evaluate an expression (or a function with JSON-serialisable args) in the page; promises are
   * awaited and the result is returned by value. Throws on page exceptions.
   * @param {string|Function} expr
   * @param {...any} args
   */
  async eval(expr, ...args) {
    const expression = typeof expr === 'function' ? `(${expr.toString()})(...${JSON.stringify(args)})` : String(expr);
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: false,
      userGesture: true,
      allowUnsafeEvalBlockedByCSP: true,
    });
    if (res.exceptionDetails) throw new Error(`eval failed: ${exceptionText(res.exceptionDetails)}`);
    return this._valueOf(res.result);
  }

  // Objects are copied out with a cycle-safe, depth-limited clone so that evaluating expressions that
  // return live engine objects (scenes, the Game…) never fails; the expression itself runs once.
  async _valueOf(ro) {
    if (!ro) return undefined;
    if (!ro.objectId) {
      if ('value' in ro) return ro.value;
      if (ro.unserializableValue !== undefined) {
        const n = Number(ro.unserializableValue);
        return Number.isNaN(n) && ro.unserializableValue !== 'NaN' ? ro.unserializableValue : n;
      }
      return undefined;
    }
    try {
      const r = await this.send('Runtime.callFunctionOn', { objectId: ro.objectId, functionDeclaration: SAFE_CLONE, returnByValue: true });
      if (r.exceptionDetails) return ro.description;
      return r.result?.value;
    } finally {
      this.send('Runtime.releaseObject', { objectId: ro.objectId }).catch(() => {});
    }
  }

  /**
   * Poll an expression until it is truthy; returns its value.
   * @param {string|Function} expr
   * @param {number} [timeoutMs=5000]
   * @param {{interval?:number}} [opts]
   */
  async waitFor(expr, timeoutMs = 5000, { interval = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    for (;;) {
      try {
        const v = await this.eval(expr);
        if (v) return v;
      } catch (err) {
        lastErr = err;
      }
      if (Date.now() >= deadline) {
        const src = typeof expr === 'function' ? expr.toString() : expr;
        throw new Error(`waitFor timed out after ${timeoutMs}ms: ${src}${lastErr ? ` (last error: ${lastErr.message})` : ''}`);
      }
      await sleep(interval);
    }
  }

  /**
   * Save a PNG screenshot of the viewport.
   * @param {string} file
   * @returns {Promise<string>} the absolute path written
   */
  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const abs = path.resolve(file);
    mkdirSync(path.dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.from(data, 'base64'));
    return abs;
  }

  /** Key down (KeyboardEvent.code, e.g. 'KeyE', 'Space', 'ArrowLeft', 'ShiftLeft'). */
  async keyDown(code) {
    const def = KEY_DEFS[code];
    if (!def) throw new Error(`Unknown key code "${code}" (supported: ${KEY_CODES.join(', ')})`);
    if (def.modifier) this._modifiers |= def.modifier;
    const shifted = (this._modifiers & 8) && def.shiftKey;
    const key = shifted ? def.shiftKey : def.key;
    const text = def.text !== undefined ? (shifted ? def.shiftKey : def.text) : undefined;
    const suppressText = (this._modifiers & (2 | 4)) !== 0;
    await this.send('Input.dispatchKeyEvent', {
      type: text && !suppressText ? 'keyDown' : 'rawKeyDown',
      code,
      key,
      windowsVirtualKeyCode: def.keyCode,
      nativeVirtualKeyCode: def.keyCode,
      text: suppressText ? undefined : text,
      unmodifiedText: suppressText ? undefined : text,
      location: def.location ?? 0,
      modifiers: this._modifiers,
      autoRepeat: false,
    });
  }

  /** Key up. */
  async keyUp(code) {
    const def = KEY_DEFS[code];
    if (!def) throw new Error(`Unknown key code "${code}"`);
    const shifted = (this._modifiers & 8) && def.shiftKey;
    if (def.modifier) this._modifiers &= ~def.modifier;
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code,
      key: shifted ? def.shiftKey : def.key,
      windowsVirtualKeyCode: def.keyCode,
      nativeVirtualKeyCode: def.keyCode,
      location: def.location ?? 0,
      modifiers: this._modifiers,
    });
  }

  /**
   * Key press: down and/or up, optionally holding in between.
   * @param {string} code
   * @param {{down?:boolean, up?:boolean, delay?:number, holdMs?:number}} [opts]
   */
  async key(code, { down = true, up = true, delay = 0, holdMs } = {}) {
    if (down) await this.keyDown(code);
    const hold = holdMs ?? delay;
    if (down && up && hold > 0) await sleep(hold);
    if (up) await this.keyUp(code);
  }

  /**
   * Press and release a key, holding it for holdMs.
   * @param {string} code
   * @param {{holdMs?:number}} [opts]
   */
  async press(code, { holdMs = 40 } = {}) {
    await this.key(code, { holdMs });
  }

  /** Type text made of letters, digits, spaces and common punctuation. */
  async type(text, { delay = 20 } = {}) {
    for (const ch of String(text)) {
      let code = KEY_CODES.find((c) => KEY_DEFS[c].text === ch && !KEY_DEFS[c].location);
      let needShift = false;
      if (!code) {
        code = KEY_CODES.find((c) => KEY_DEFS[c].shiftKey === ch);
        needShift = true;
      }
      if (!code) throw new Error(`Cannot type character "${ch}"`);
      if (needShift) await this.keyDown('ShiftLeft');
      await this.press(code, { holdMs: 10 });
      if (needShift) await this.keyUp('ShiftLeft');
      if (delay) await sleep(delay);
    }
  }

  /** Move the mouse. */
  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: this._modifiers });
  }

  /**
   * Click at viewport coordinates.
   * @param {number} x
   * @param {number} y
   * @param {{button?:'left'|'right'|'middle', holdMs?:number, clickCount?:number}} [opts]
   */
  async click(x, y, { button = 'left', holdMs = 30, clickCount = 1 } = {}) {
    const buttons = { left: 1, right: 2, middle: 4 }[button] ?? 1;
    await this.mouseMove(x, y);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount, modifiers: this._modifiers });
    if (holdMs > 0) await sleep(holdMs);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount, modifiers: this._modifiers });
  }

  /** Touch tap at viewport coordinates (enables touch emulation on first use). */
  async tap(x, y, { holdMs = 40 } = {}) {
    if (!this._touch) {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      this._touch = true;
    }
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    if (holdMs > 0) await sleep(holdMs);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** Resolve after ms. */
  sleep(ms) {
    return sleep(ms);
  }
}

/**
 * Launch headless Chrome with a throw-away profile and attach to its first tab.
 * Chrome is killed and the profile deleted on close(), on process exit and on SIGINT/SIGTERM.
 * @param {{width?:number, height?:number, headless?:boolean, port?:number, chromePath?:string, args?:string[], timeout?:number}} [opts]
 * @returns {Promise<{page:Page, close:() => Promise<void>, port:number, process:import('node:child_process').ChildProcess, userDataDir:string}>}
 */
export async function launch({ width = 1280, height = 720, headless = true, port = 0, chromePath, args = [], timeout = 20000, gpu = false } = {}) {
  const exe = chromePath ?? findChrome();
  const tmpBase = process.env.EXP69_CDP_TMP || os.tmpdir();
  mkdirSync(tmpBase, { recursive: true });
  const userDataDir = mkdtempSync(path.join(tmpBase, 'exp69-cdp-'));
  const chromeArgs = [
    headless ? '--headless=new' : null,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    gpu ? null : '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--password-store=basic',
    '--use-mock-keychain',
    ...args,
    'about:blank',
  ].filter(Boolean);

  installExitHooks();
  const proc = spawn(exe, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  const browser = { proc, userDataDir };
  liveBrowsers.add(browser);
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });

  let conn = null;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    conn?.close();
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill('SIGTERM');
      const killed = await Promise.race([exited.then(() => true), sleep(3000).then(() => false)]);
      if (!killed) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // gone
        }
        await Promise.race([exited, sleep(1000)]);
      }
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // best effort
    }
    liveBrowsers.delete(browser);
  };

  try {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    const deadline = Date.now() + timeout;
    let devPort = 0;
    while (!devPort) {
      if (proc.exitCode !== null) throw new Error(`Chrome exited early (code ${proc.exitCode}).\n${stderr}`);
      if (existsSync(portFile)) {
        const lines = readFileSync(portFile, 'utf8').split('\n');
        if (lines.length >= 2 && Number(lines[0]) > 0) devPort = Number(lines[0]);
      }
      if (!devPort) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for Chrome DevTools port.\n${stderr}`);
        await sleep(50);
      }
    }
    const base = `http://127.0.0.1:${devPort}`;
    let target = null;
    while (!target) {
      const list = await (await fetch(`${base}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!target) {
        if (Date.now() > deadline) {
          target = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
          break;
        }
        await sleep(50);
      }
    }
    conn = await Connection.open(target.webSocketDebuggerUrl);
    const page = new Page(conn, { width, height });
    await page._init();
    return { page, close, port: devPort, process: proc, userDataDir };
  } catch (err) {
    await close();
    throw err;
  }
}

// ------------------------------------------------------------------ CLI

function parseKeys(spec) {
  if (!spec) return [];
  return spec.split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
    const m = /^([A-Za-z0-9]+)(?:@(\d+))?(?::(\d+))?$/.exec(item);
    if (!m) throw new Error(`Bad --keys item "${item}" (expected CODE@ms or CODE@ms:holdMs)`);
    if (!KEY_DEFS[m[1]]) throw new Error(`Unknown key code "${m[1]}" in --keys`);
    return { code: m[1], at: Number(m[2] ?? 0), hold: m[3] !== undefined ? Number(m[3]) : 40 };
  }).sort((a, b) => a.at - b.at);
}

function parseCli(argv) {
  const o = { url: null, shot: null, wait: 500, evals: [], keys: [], width: 1280, height: 720, headless: true, quiet: false, waitFor: null, timeout: 30000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === '--shot') o.shot = val();
    else if (a === '--wait') o.wait = Number(val());
    else if (a === '--eval') o.evals.push(val());
    else if (a === '--keys') o.keys.push(...parseKeys(val()));
    else if (a === '--wait-for') o.waitFor = val();
    else if (a === '--width') o.width = Number(val());
    else if (a === '--height') o.height = Number(val());
    else if (a === '--timeout') o.timeout = Number(val());
    else if (a === '--headful') o.headless = false;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (!a.startsWith('--') && !o.url) o.url = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  o.keys.sort((x, y) => x.at - y.at);
  return o;
}

const USAGE = `Usage: node tools/cdp.mjs <url> [options]
  --shot out.png        save a screenshot after waiting
  --wait ms             time to wait after load before evals/screenshot (default 500; extended to cover --keys)
  --keys "KeyE@500,Space@900:120"   press keys at ms after load (optional :holdMs, default 40)
  --eval "expr"         evaluate an expression and print its JSON result (repeatable)
  --wait-for "expr"     poll until expr is truthy (before evals)
  --width N --height N  viewport (default 1280x720)
  --headful             show the browser window
  --quiet               don't stream console output
Exit code: 0 ok, 1 uncaught page exception(s) or a failed --eval, 2 harness failure.`;

async function main() {
  let opts;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    return 2;
  }
  if (opts.help || !opts.url) {
    console.log(USAGE);
    return opts.help ? 0 : 2;
  }
  let session;
  try {
    session = await launch({ width: opts.width, height: opts.height, headless: opts.headless });
    const { page } = session;
    if (!opts.quiet) {
      page.on('console', (m) => console.log(`[console.${m.type}] ${m.text}`));
      page.on('error', (e) => console.log(`[pageerror] ${e.message}`));
    }
    await page.goto(opts.url, { timeout: opts.timeout });
    const t0 = Date.now();
    for (const k of opts.keys) {
      await sleep(k.at - (Date.now() - t0));
      await page.press(k.code, { holdMs: k.hold });
    }
    const lastKey = opts.keys.length ? opts.keys[opts.keys.length - 1].at + opts.keys[opts.keys.length - 1].hold : 0;
    await sleep(Math.max(opts.wait, lastKey + 50) - (Date.now() - t0));
    if (opts.waitFor) await page.waitFor(opts.waitFor, opts.timeout);
    for (const expr of opts.evals) {
      try {
        const v = await page.eval(expr);
        console.log(`eval> ${expr}\n${JSON.stringify(v, null, 2)}`);
      } catch (err) {
        console.log(`eval> ${expr}\n!! ${err.message}`);
        page.errors.push({ message: err.message, time: Date.now() });
      }
    }
    if (opts.shot) console.log(`screenshot → ${await page.screenshot(opts.shot)}`);
    const errs = page.errors;
    const consoleErrors = page.consoleMessages.filter((m) => m.type === 'error' || m.type === 'log.error').length;
    console.log(`done: ${errs.length} uncaught exception(s), ${consoleErrors} console error(s)`);
    if (errs.length && opts.quiet) for (const e of errs) console.log(`[pageerror] ${e.message}`);
    return errs.length ? 1 : 0;
  } catch (err) {
    console.error(`cdp harness failed: ${err.message}`);
    return 2;
  } finally {
    await session?.close();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().then((code) => process.exit(code));
}
