// Shared DOM UI components for Expedition 69: element builder, UIScene base (focus stack, key-cap refresh,
// cover/resume), MenuList (keyboard + mouse, disabled reasons, descriptions, adjustable rows), Tabs, confirm
// dialogs, toasts, tooltips, bars, pips and a hold-to-skip gauge. All keyboard input goes through game.input.

import { Scene } from '../core/scene.js';
import { escapeHtml, keyCapHtml, refreshKeyCaps, hintsHtml, deviceOf } from './text.js';

// ------------------------------------------------------------------ tiny DOM helpers

/**
 * Create an element. props: class, html, text, style (string|object), dataset, on{Event} handlers, attrs.
 * Children may be nodes, strings (text) or arrays.
 * @param {string} tag
 * @param {object} [props]
 * @param {...*} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') {
      if (typeof v === 'string') node.style.cssText = v;
      else Object.assign(node.style, v);
    } else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else node.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
  }
}

/**
 * Make a clickable element that never takes keyboard focus (so Enter only reaches game.input, never a native click).
 * @param {HTMLElement} node
 * @param {(e:Event) => void} onClick
 * @returns {HTMLElement}
 */
export function clickable(node, onClick) {
  node.tabIndex = -1;
  node.addEventListener('mousedown', (e) => e.preventDefault());
  node.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(e);
  });
  return node;
}

/** A styled button (<button class="btn">) that never takes focus. */
export function button(label, onClick, { cls = '', html = false, title = null } = {}) {
  const b = el('button', { type: 'button', class: `btn ${cls}`.trim() });
  if (html) b.innerHTML = label;
  else b.textContent = label;
  if (title) b.title = title;
  return clickable(b, onClick);
}

/**
 * Play a sound effect if audio exists (never throws).
 * @param {object} game
 * @param {string} name
 * @param {object} [opts]
 */
export function sfx(game, name, opts) {
  try {
    game?.audio?.play?.(name, opts);
  } catch (err) {
    console.warn('[ui] sfx failed', name, err);
  }
}

/**
 * True while the DOM UI runs its compact, magnified layout (a phone or small window: src/main.js sets .ui-compact on
 * #ui when the stage is drawn below COMPACT_SCALE). Scenes may lay out differently, e.g. one party card at a time.
 * @param {object} game
 * @returns {boolean}
 */
export function isCompact(game) {
  return !!game?.uiRoot?.classList?.contains('ui-compact');
}

/** Promise that resolves after ms (setTimeout; UI only). */
export const delay = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Real pointer movement (client px + time). Browsers re-dispatch hover events when the layout changes under a
// resting cursor (a dialog opening where the mouse happens to sit); hover-to-focus must ignore those, or a menu
// opened from the keyboard would silently move its focus to whatever lies under the idle mouse.
const POINTER_MOVE = { x: NaN, y: NaN, at: -Infinity };
let pointerTracked = false;

function trackPointer() {
  if (pointerTracked || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  pointerTracked = true;
  window.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - POINTER_MOVE.x) < 1 && Math.abs(e.clientY - POINTER_MOVE.y) < 1) return;
    POINTER_MOVE.x = e.clientX;
    POINTER_MOVE.y = e.clientY;
    POINTER_MOVE.at = performance.now();
  }, { capture: true, passive: true });
}

/** True when the pointer really moved after `t` (performance.now clock). */
export function pointerMovedSince(t) {
  return POINTER_MOVE.at > t;
}

/** True when the pointer really moved within the last `ms` (a hover event caused by the hand, not by layout). */
export function pointerRecentlyMoved(ms = 160) {
  return typeof performance !== 'undefined' && performance.now() - POINTER_MOVE.at < ms;
}

// ------------------------------------------------------------------ focus stack & scene base

/** Stack of input-consuming widgets: only the top one receives update(). */
export class FocusStack {
  constructor() {
    this.stack = [];
  }

  /** Push a widget (anything with update(dt)); deactivates the previous top. */
  push(w) {
    const prev = this.top;
    if (prev && prev !== w) prev.setActive?.(false);
    this.stack = this.stack.filter((x) => x !== w);
    this.stack.push(w);
    w.setActive?.(true);
    return w;
  }

  /** Remove a widget wherever it is; reactivates the new top. */
  remove(w) {
    const wasTop = this.top === w;
    this.stack = this.stack.filter((x) => x !== w);
    if (wasTop) this.top?.setActive?.(true);
  }

  /** Replace the whole stack with one widget. */
  set(w) {
    for (const x of this.stack) if (x !== w) x.setActive?.(false);
    this.stack = w ? [w] : [];
    w?.setActive?.(true);
  }

  get top() {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  }

  has(w) {
    return this.stack.includes(w);
  }

  /** Drop every widget and deactivate them, so pointer clicks stop reaching them too (input is locked). */
  clear() {
    for (const x of this.stack) x.setActive?.(false);
    this.stack = [];
  }

  /** Update the top widget; returns true if it handled input. */
  update(dt) {
    const t = this.top;
    return t ? !!t.update(dt) : false;
  }
}

/**
 * Base class for DOM-driven scenes. Provides `this.focus` (FocusStack), `this.root` (mounted screen element),
 * automatic key-cap relabelling on device changes, a `.is-covered` state while another scene is on top,
 * and listener bookkeeping that is cleaned up on exit.
 */
export class UIScene extends Scene {
  constructor(game) {
    super(game);
    this.focus = new FocusStack();
    this.root = null;
    this.time = 0;
    this._offs = [];
    this._timers = new Set();
  }

  /**
   * Mount the scene's root element (a full-stage .ui-screen container).
   * @param {string} className
   * @param {string} [html]
   * @returns {HTMLElement}
   */
  mountRoot(className, html = '') {
    const root = el('div', { class: `ui-screen ${className}`.trim(), html });
    this.mountUI(root);
    this.root = root;
    this.listen(this.game.input?.events, 'device', () => this.onDeviceChange());
    return root;
  }

  /** Called when the input device changes: relabels key caps (override to re-render hint bars). */
  onDeviceChange() {
    refreshKeyCaps(this.root, this.game);
  }

  /** Subscribe to an Emitter and auto-unsubscribe on exit. */
  listen(emitter, evt, fn) {
    if (!emitter || typeof emitter.on !== 'function') return;
    const off = emitter.on(evt, fn);
    if (typeof off === 'function') this._offs.push(off);
  }

  /** setTimeout that is cancelled on exit. */
  later(ms, fn) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, ms);
    this._timers.add(id);
    return id;
  }

  sfx(name, opts) {
    sfx(this.game, name, opts);
  }

  /** Key-cap HTML for an action. */
  cap(action) {
    return keyCapHtml(this.game, action);
  }

  /** Hint-bar HTML. */
  hints(list) {
    return hintsHtml(this.game, list);
  }

  exit() {
    for (const off of this._offs) {
      try {
        off();
      } catch {
        /* already gone */
      }
    }
    this._offs = [];
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    this.focus.clear();
  }

  pause() {
    this.root?.classList.add('is-covered');
  }

  resume() {
    this.root?.classList.remove('is-covered');
    refreshKeyCaps(this.root, this.game);
  }

  update(dt) {
    this.time += dt;
    this.focus.update(dt);
  }
}

// ------------------------------------------------------------------ menu list

/**
 * Keyboard/mouse list. Items: { id, label?, html?, sub?, right?, icon?, disabled?, reason?, className?, tip?,
 * adjustable? } — or a custom `render(item, i)` returning HTML / an element.
 * Keys: up/down (auto-repeat) move, confirm activates, cancel calls onCancel, left/right call onAdjust (vertical
 * lists with adjustable items). Horizontal lists use left/right to move. Grid lists (columns > 1) use all four.
 */
export class MenuList {
  /**
   * @param {object} game
   * @param {object} opts
   */
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = {
      items: [], className: '', index: 0, wrap: true, horizontal: false, columns: 1, sound: true, hoverFocus: true,
      repeatDelay: 360, repeatInterval: 85, emptyText: '', ...opts,
    };
    this.items = [];
    this.index = 0;
    this.active = true;
    this.el = el('div', { class: `menu ${this.opts.className}`.trim(), role: 'listbox' });
    if (this.opts.horizontal) this.el.classList.add('menu-h');
    if (this.opts.columns > 1) {
      this.el.classList.add('menu-grid');
      this.el.style.setProperty('--cols', String(this.opts.columns));
    }
    this._nodes = [];
    this._shownAt = 0;
    trackPointer();
    this.setItems(this.opts.items, { index: this.opts.index, silent: true });
  }

  /** The focused item (or null). */
  get current() {
    return this.items[this.index] ?? null;
  }

  /**
   * Replace items (re-renders). Keeps the focus index by default (clamped), or focuses `index` / the item with `id`.
   * @param {Array<object>} items
   * @param {{index?:number, id?:string, silent?:boolean}} [o]
   */
  setItems(items, { index, id, silent = true } = {}) {
    this.items = Array.isArray(items) ? items.filter(Boolean) : [];
    let i = Number.isInteger(index) ? index : this.index;
    if (id !== undefined) {
      const j = this.items.findIndex((it) => it.id === id);
      if (j >= 0) i = j;
    }
    this.index = Math.max(0, Math.min(this.items.length - 1, i));
    this._render();
    this.focusIndex(this.index, { sound: false, scroll: true, silent });
  }

  /** Re-render all items in place (e.g. after their values changed). */
  refresh() {
    this._render();
    this._markFocus();
    this._describe();
  }

  /** Patch one item and re-render it. */
  updateItem(i, patch) {
    if (!this.items[i]) return;
    Object.assign(this.items[i], patch);
    const node = this._renderItem(this.items[i], i);
    this._nodes[i]?.replaceWith(node);
    this._nodes[i] = node;
    this._markFocus();
    if (i === this.index) this._describe();
  }

  setActive(active) {
    this.active = !!active;
    this.el.classList.toggle('is-inactive', !this.active);
  }

  _render() {
    this._shownAt = typeof performance !== 'undefined' ? performance.now() : 0;
    this.el.innerHTML = '';
    this._nodes = this.items.map((it, i) => this._renderItem(it, i));
    for (const n of this._nodes) this.el.appendChild(n);
    if (!this.items.length && this.opts.emptyText) {
      this.el.appendChild(el('div', { class: 'menu-empty', text: this.opts.emptyText }));
    }
  }

  _renderItem(item, i) {
    if (item.heading) {
      const h = el('div', { class: `section-label menu-heading ${item.className ?? ''}`.trim(), html: item.html ?? escapeHtml(item.label ?? '') });
      h.dataset.index = String(i);
      return h;
    }
    const cls = ['menu-item', item.className, item.disabled ? 'is-disabled' : '', item.selected ? 'is-selected' : ''].filter(Boolean).join(' ');
    let node;
    if (typeof this.opts.render === 'function') {
      const r = this.opts.render(item, i, this);
      if (r && r.nodeType) {
        node = r;
        node.classList.add(...cls.split(' '));
      } else {
        node = el('div', { class: cls, html: r ?? '' });
      }
    } else {
      node = el('div', { class: cls });
      const icon = item.icon ? `<img class="mi-icon" src="${escapeHtml(item.icon)}" alt="" draggable="false">` : '';
      const label = item.html ?? escapeHtml(item.label ?? item.id ?? '');
      const sub = item.sub ? `<span class="mi-sub">${item.subHtml ? item.sub : escapeHtml(item.sub)}</span>` : '';
      const right = item.right ? `<span class="mi-right">${item.right}</span>` : '';
      node.innerHTML = `${icon}<span class="mi-main"><span class="mi-label">${label}</span>${sub}</span>${right}`;
    }
    node.setAttribute('role', 'option');
    node.dataset.index = String(i);
    if (item.tip) node.dataset.tip = item.tip;
    node.addEventListener('mousedown', (e) => e.preventDefault());
    // Hover focus follows only genuine mouse movement (pointermove also covers moving within an item that was
    // rendered under a resting cursor, where pointerenter would never fire again).
    node.addEventListener('pointermove', () => {
      if (!this.active || !this.opts.hoverFocus || this.index === i || !pointerMovedSince(this._shownAt)) return;
      this.focusIndex(i, { sound: true, soft: true });
    });
    node.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const adj = e.target?.closest?.('[data-adjust]');
      if (!this.active) {
        this.opts.onInactiveClick?.(item, i, this);
        if (!this.active) return;
      }
      if (this.index !== i) this.focusIndex(i, { sound: false });
      if (adj && this.opts.onAdjust) {
        this.opts.onAdjust(item, Number(adj.dataset.adjust) || 0, i, e);
        return;
      }
      if (item.clickAdjust && this.opts.onAdjust) {
        this.opts.onAdjust(item, 0, i, e);
        return;
      }
      this.confirm();
    });
    return node;
  }

  _markFocus() {
    this._nodes.forEach((n, j) => {
      n.classList.toggle('is-focused', j === this.index);
      n.setAttribute('aria-selected', j === this.index ? 'true' : 'false');
    });
  }

  _describe() {
    const { describe, descEl } = this.opts;
    if (typeof describe !== 'function' || !descEl) return;
    const item = this.current;
    const d = item ? describe(item, this.index, this) : '';
    if (d && d.nodeType) {
      descEl.innerHTML = '';
      descEl.appendChild(d);
    } else descEl.innerHTML = d ?? '';
  }

  /**
   * Focus an item.
   * @param {number} i
   * @param {{sound?:boolean, scroll?:boolean, silent?:boolean, soft?:boolean}} [o]
   */
  /** True if item i can take focus (section headings cannot). */
  selectable(i) {
    const it = this.items[i];
    return !!it && !it.heading;
  }

  focusIndex(i, { sound = true, scroll = true, silent = false, soft = false } = {}) {
    if (!this.items.length || !this.items.some((it) => !it.heading)) {
      this.index = 0;
      this._describe();
      return;
    }
    const n = this.items.length;
    let next = Math.max(0, Math.min(n - 1, i));
    if (!this.selectable(next)) {
      let j = next;
      while (j < n && !this.selectable(j)) j++;
      if (j >= n) {
        j = next;
        while (j >= 0 && !this.selectable(j)) j--;
      }
      next = j;
    }
    const changed = next !== this.index;
    this.index = next;
    this._markFocus();
    if (scroll) this._scrollIntoView();
    this._describe();
    if (changed && sound && this.opts.sound) sfx(this.game, 'ui_move', soft ? { volume: 0.55 } : undefined);
    if (!silent || changed) this.opts.onFocus?.(this.current, this.index, this);
  }

  _scrollIntoView() {
    // Manual scrolling: scrollIntoView would also scroll the overflow-hidden stage ancestors.
    const box = this.opts.scrollEl ?? this.el;
    const node = this._nodes[this.index];
    if (!box || !node || box.scrollHeight <= box.clientHeight + 1) return;
    const top = node.offsetTop - box.offsetTop;
    const pad = 8;
    let target = null;
    if (top - pad < box.scrollTop) target = top - pad;
    else if (top + node.offsetHeight + pad > box.scrollTop + box.clientHeight) target = top + node.offsetHeight + pad - box.clientHeight;
    if (target !== null) box.scrollTop = Math.max(0, target);
  }

  /** Move focus by delta, skipping nothing (disabled items stay focusable so their reason can be read). */
  move(delta) {
    const n = this.items.length;
    if (!n || !this.items.some((it) => !it.heading)) return;
    let i = this.index;
    if (Math.abs(delta) === 1) {
      for (let step = 0; step < n; step++) {
        i += delta;
        if (i < 0 || i >= n) {
          if (!this.opts.wrap) return;
          i = (i + n) % n;
        }
        if (this.selectable(i)) break;
      }
    } else {
      i = Math.max(0, Math.min(n - 1, i + delta));
      if (!this.selectable(i)) return;
    }
    if (i !== this.index) this.focusIndex(i);
  }

  /** Activate the focused item (disabled → error sound + reason). */
  confirm() {
    const item = this.current;
    if (!item) return;
    if (item.disabled) {
      sfx(this.game, 'ui_error');
      const node = this._nodes[this.index];
      if (node) {
        node.classList.remove('shake');
        void node.offsetWidth;
        node.classList.add('shake');
      }
      if (item.reason) {
        if (this.opts.onDisabled) this.opts.onDisabled(item, this.index, this);
        else toast(this.game, item.reason, { kind: 'warn' });
      }
      return;
    }
    if (this.opts.sound && item.sound !== false) sfx(this.game, item.confirmSound ?? 'ui_confirm');
    this.opts.onConfirm?.(item, this.index, this);
  }

  /**
   * Handle input for this frame. Returns true when something was handled.
   * @returns {boolean}
   */
  update() {
    const input = this.game.input;
    if (!input) return false;
    const rep = (a) => input.pressedRepeat(a, this.opts.repeatDelay, this.opts.repeatInterval);
    const { horizontal, columns } = this.opts;
    let handled = false;
    if (columns > 1) {
      if (rep('up')) { this.move(-columns); handled = true; }
      else if (rep('down')) { this.move(columns); handled = true; }
      else if (rep('left')) { this.move(-1); handled = true; }
      else if (rep('right')) { this.move(1); handled = true; }
    } else if (horizontal) {
      if (rep('left')) { this.move(-1); handled = true; }
      else if (rep('right')) { this.move(1); handled = true; }
    } else {
      if (rep('up')) { this.move(-1); handled = true; }
      else if (rep('down')) { this.move(1); handled = true; }
      else if (this.opts.onAdjust && this.current?.adjustable) {
        if (rep('left')) { this.opts.onAdjust(this.current, -1, this.index); handled = true; }
        else if (rep('right')) { this.opts.onAdjust(this.current, 1, this.index); handled = true; }
      }
    }
    if (handled) {
      input.consume(['up', 'down', 'left', 'right']);
      return true;
    }
    if (input.pressed('confirm')) {
      input.consume(['confirm', 'jump', 'qte']);
      this.confirm();
      return true;
    }
    if (input.pressed('cancel') && this.opts.onCancel) {
      input.consume(['cancel', 'menu']);
      if (this.opts.sound && this.opts.cancelSound !== false) sfx(this.game, 'ui_cancel');
      this.opts.onCancel(this);
      return true;
    }
    return false;
  }

  destroy() {
    this.el.remove();
  }
}

// ------------------------------------------------------------------ tabs

/**
 * Horizontal tab strip. Switch with the prev/next actions (default dodge/parry → Q/E, LB/RB) or the mouse.
 * Optionally left/right too (arrows:true) when nothing else consumes them.
 */
export class Tabs {
  constructor(game, { tabs = [], index = 0, onChange, prevAction = 'dodge', nextAction = 'parry', arrows = false, className = '', keys = true } = {}) {
    this.game = game;
    this.tabs = tabs;
    this.index = Math.max(0, Math.min(tabs.length - 1, index));
    this.onChange = onChange;
    this.prevAction = prevAction;
    this.nextAction = nextAction;
    this.arrows = arrows;
    this.enabled = true;
    this.el = el('div', { class: `tabs ${className}`.trim(), role: 'tablist' });
    this._keys = keys;
    this._render();
  }

  _render() {
    this._shownAt = typeof performance !== 'undefined' ? performance.now() : 0;
    this.el.innerHTML = '';
    const keys = this._keys && deviceOf(this.game) !== 'touch';
    if (keys) this.el.appendChild(el('span', { class: 'tabs-key', html: keyCapHtml(this.game, this.prevAction) }));
    this._nodes = this.tabs.map((t, i) => {
      const n = el('div', { class: 'tab', role: 'tab', html: `${t.icon ? `<img src="${escapeHtml(t.icon)}" alt="">` : ''}<span>${escapeHtml(t.label)}</span>${t.badge ? `<b class="tab-badge">${escapeHtml(t.badge)}</b>` : ''}` });
      clickable(n, () => this.select(i));
      this.el.appendChild(n);
      return n;
    });
    if (keys) this.el.appendChild(el('span', { class: 'tabs-key', html: keyCapHtml(this.game, this.nextAction) }));
    this._mark();
  }

  /** Update a tab's badge text (e.g. unspent points). */
  setBadge(id, badge) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t || t.badge === badge) return;
    t.badge = badge;
    this._render();
  }

  _mark() {
    this._nodes.forEach((n, i) => {
      n.classList.toggle('is-active', i === this.index);
      n.setAttribute('aria-selected', i === this.index ? 'true' : 'false');
    });
  }

  get current() {
    return this.tabs[this.index];
  }

  select(i, { sound = true, emit = true } = {}) {
    const n = this.tabs.length;
    if (!n) return;
    const next = ((i % n) + n) % n;
    if (next === this.index) return;
    this.index = next;
    this._mark();
    if (sound) sfx(this.game, 'ui_move', { pitch: 0.9 });
    if (emit) this.onChange?.(this.tabs[next], next, this);
  }

  /**
   * True when `action` was pressed this frame by a key/button that is not also bound to cancel/confirm
   * (on a gamepad B is both 'cancel' and 'dodge' — it must back out, not switch tabs).
   */
  _tabPress(action) {
    const input = this.game.input;
    if (!input.pressed(action)) return false;
    const presses = typeof input.framePresses === 'function' ? input.framePresses([action]) : [];
    if (!presses.length) return true; // virtual press without a code
    return presses.some((p) => {
      if (!p.code) return true;
      const acts = input.actionsFor(p.code);
      return !acts.includes('cancel') && !acts.includes('confirm');
    });
  }

  /** Handle tab-switch input. Returns true if handled. */
  update() {
    const input = this.game.input;
    if (!this.enabled || !input) return false;
    if (this._tabPress(this.prevAction)) {
      input.consume([this.prevAction]);
      this.select(this.index - 1);
      return true;
    }
    if (this._tabPress(this.nextAction)) {
      input.consume([this.nextAction]);
      this.select(this.index + 1);
      return true;
    }
    if (this.arrows) {
      if (input.pressedRepeat('left')) {
        input.consume(['left']);
        this.select(this.index - 1);
        return true;
      }
      if (input.pressedRepeat('right')) {
        input.consume(['right']);
        this.select(this.index + 1);
        return true;
      }
    }
    return false;
  }
}

// ------------------------------------------------------------------ confirm dialog

/**
 * Modal confirm dialog mounted into a UIScene (blocks the scene's other widgets while open).
 * @param {UIScene} scene
 * @param {{title?:string, text?:string, html?:string, confirmLabel?:string, cancelLabel?:string, danger?:boolean, defaultConfirm?:boolean}} o
 * @returns {Promise<boolean>}
 */
export function confirmDialog(scene, { title = 'Are you sure?', text = '', html = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, defaultConfirm } = {}) {
  const game = scene.game;
  return new Promise((resolve) => {
    const shield = el('div', { class: 'modal-shield' });
    const box = el('div', { class: `panel modal confirm-modal${danger ? ' is-danger' : ''}` });
    box.appendChild(el('div', { class: 'modal-title', text: title }));
    box.appendChild(el('div', { class: 'rule' }));
    box.appendChild(el('div', { class: 'modal-text', html: html || escapeHtml(text) }));
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      scene.focus.remove(list);
      shield.classList.add('is-leaving');
      setTimeout(() => shield.remove(), 160);
      resolve(value);
    };
    const list = new MenuList(game, {
      className: 'modal-actions',
      horizontal: true,
      wrap: true,
      index: (defaultConfirm ?? !danger) ? 0 : 1,
      items: [
        { id: 'yes', label: confirmLabel, className: danger ? 'is-danger' : '' },
        { id: 'no', label: cancelLabel, confirmSound: 'ui_cancel' },
      ],
      onConfirm: (item) => finish(item.id === 'yes'),
      onCancel: () => finish(false),
    });
    box.appendChild(list.el);
    shield.appendChild(box);
    shield.addEventListener('mousedown', (e) => e.preventDefault());
    shield.addEventListener('click', (e) => {
      if (e.target === shield) finish(false);
    });
    (scene.root ?? game.uiRoot).appendChild(shield);
    scene.focus.push(list);
    sfx(game, 'menu_open', { volume: 0.7 });
  });
}

/**
 * Generic modal hosting a MenuList of choices. Resolves with the chosen item id, or null on cancel.
 * @param {UIScene} scene
 * @param {{title?:string, text?:string, html?:string, items:Array<object>, className?:string, index?:number, horizontal?:boolean, columns?:number, describe?:function, render?:function}} o
 * @returns {Promise<string|null>}
 */
export function choiceDialog(scene, { title = '', text = '', html = '', items, className = '', index = 0, horizontal = false, columns = 1, describe, render } = {}) {
  const game = scene.game;
  return new Promise((resolve) => {
    const shield = el('div', { class: 'modal-shield' });
    const box = el('div', { class: `panel modal choice-modal ${className}`.trim() });
    if (title) {
      box.appendChild(el('div', { class: 'modal-title', text: title }));
      box.appendChild(el('div', { class: 'rule' }));
    }
    if (text || html) box.appendChild(el('div', { class: 'modal-text', html: html || escapeHtml(text) }));
    const descEl = describe ? el('div', { class: 'modal-desc' }) : null;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      scene.focus.remove(list);
      shield.classList.add('is-leaving');
      setTimeout(() => shield.remove(), 160);
      resolve(value);
    };
    const list = new MenuList(game, {
      className: 'modal-choices', items, index, horizontal, columns, describe, descEl, render,
      onConfirm: (item) => finish(item.id),
      onCancel: () => finish(null),
    });
    box.appendChild(list.el);
    if (descEl) box.appendChild(descEl);
    shield.appendChild(box);
    shield.addEventListener('mousedown', (e) => e.preventDefault());
    shield.addEventListener('click', (e) => {
      if (e.target === shield) finish(null);
    });
    (scene.root ?? game.uiRoot).appendChild(shield);
    scene.focus.push(list);
    sfx(game, 'menu_open', { volume: 0.7 });
  });
}

// ------------------------------------------------------------------ toasts

/**
 * Show a transient notification at the top of the stage (survives scene changes).
 * @param {object} game
 * @param {string} text
 * @param {{kind?:'info'|'good'|'warn'|'gold', ms?:number, icon?:string, html?:boolean}} [o]
 */
export function toast(game, text, { kind = 'info', ms = 2400, icon = null, html = false } = {}) {
  const root = game?.uiRoot;
  if (!root) return null;
  let host = root.querySelector(':scope > .toasts');
  if (!host) {
    host = el('div', { class: 'toasts' });
    root.appendChild(host);
  }
  const node = el('div', { class: `toast toast-${kind}` });
  node.innerHTML = `${icon ? `<img src="${escapeHtml(icon)}" alt="">` : '<i class="toast-gem"></i>'}<span>${html ? text : escapeHtml(text)}</span>`;
  host.appendChild(node);
  while (host.children.length > 4) host.firstElementChild.remove();
  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 320);
  }, ms);
  return node;
}

// ------------------------------------------------------------------ tooltip

/**
 * Hover tooltip for [data-tip] elements (text; optional data-tip-title). One per scene; attach() to a root.
 */
export class Tooltip {
  constructor(scene) {
    this.scene = scene;
    this.game = scene.game;
    this.el = el('div', { class: 'tooltip', role: 'tooltip' });
    scene.mountUI(this.el);
    this._target = null;
  }

  attach(root) {
    trackPointer();
    root.addEventListener('pointerover', (e) => {
      const t = e.target?.closest?.('[data-tip]');
      // Touch taps may show tips; mouse tips only follow a moving hand (not content re-rendered under a resting cursor).
      if (e.pointerType === 'mouse' && !pointerRecentlyMoved()) return;
      if (t && root.contains(t) && t !== this._target) this.show(t);
    });
    // The first real move after a rest can arrive after its pointerover: catch up on movement.
    root.addEventListener('pointermove', (e) => {
      const t = e.target?.closest?.('[data-tip]');
      if (t && root.contains(t) && t !== this._target && pointerRecentlyMoved()) this.show(t);
    }, { passive: true });
    root.addEventListener('pointerout', (e) => {
      if (!this._target) return;
      const to = e.relatedTarget;
      if (to && this._target.contains(to)) return;
      this.hide();
    });
    return this;
  }

  show(target) {
    const tip = target.getAttribute('data-tip');
    if (!tip) return;
    this._target = target;
    const title = target.getAttribute('data-tip-title');
    this.el.innerHTML = `${title ? `<b>${escapeHtml(title)}</b>` : ''}<span>${escapeHtml(tip).replace(/\n/g, '<br>')}</span>`;
    this.el.classList.add('is-visible');
    const r = target.getBoundingClientRect();
    const input = this.game.input;
    const tl = input.toStage(r.left, r.top);
    const br = input.toStage(r.right, r.bottom);
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = (tl.x + br.x) / 2 - w / 2;
    let y = tl.y - h - 10;
    let below = false;
    if (y < 8) {
      y = br.y + 10;
      below = true;
    }
    x = Math.max(8, Math.min(1280 - w - 8, x));
    y = Math.max(8, Math.min(720 - h - 8, y));
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    this.el.classList.toggle('is-below', below);
  }

  hide() {
    this._target = null;
    this.el.classList.remove('is-visible');
  }
}

// ------------------------------------------------------------------ small visual pieces

/**
 * HTML for a bar (HP, XP, echo load...).
 * @param {{value:number, max:number, kind?:string, label?:string, text?:string|null, preview?:number, cls?:string}} o
 * @returns {string}
 */
export function barHtml({ value = 0, max = 1, kind = 'hp', label = '', text = null, preview = null, cls = '' } = {}) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  let tone = '';
  if (kind === 'hp') tone = f <= 0.25 ? 'is-low' : f <= 0.5 ? 'is-mid' : '';
  const pv = preview !== null && max > 0 ? Math.max(0, Math.min(1, preview / max)) : null;
  const shown = text === null ? `${Math.round(value)} / ${Math.round(max)}` : text;
  return `<div class="bar bar-${kind} ${tone} ${cls}" style="--f:${f.toFixed(4)}${pv !== null ? `;--pv:${pv.toFixed(4)}` : ''}">`
    + `${label ? `<span class="bar-label">${escapeHtml(label)}</span>` : ''}`
    + `<span class="bar-track">${pv !== null ? '<i class="bar-preview"></i>' : ''}<i class="bar-fill"></i></span>`
    + `${shown ? `<span class="bar-text">${escapeHtml(shown)}</span>` : ''}</div>`;
}

/**
 * HTML for a row of pips (charges, mastery, AP).
 * @param {number} filled
 * @param {number} total
 * @param {string} [cls]
 * @returns {string}
 */
export function pipsHtml(filled, total, cls = '') {
  let s = `<span class="pips ${cls}">`;
  for (let i = 0; i < total; i++) s += `<i class="${i < filled ? 'on' : ''}"></i>`;
  return `${s}</span>`;
}

/** A thin ornamental rule with a centre diamond. */
export function ruleHtml(cls = '') {
  return `<div class="rule ${cls}"></div>`;
}

// ------------------------------------------------------------------ hold-to-skip gauge

/**
 * "Hold <cancel> to skip" gauge: call update(dt) every frame; returns true once the action was held long enough.
 * Renders a small radial ring (el) that fills while held. With a `tapLabel`, the owner makes the gauge tappable
 * (touch has no key to hold) and relabel() shows that label, without a key cap, while the device is touch.
 */
export class HoldGauge {
  constructor(game, { action = 'cancel', ms = 800, label = 'Hold to skip', tapLabel = null } = {}) {
    this.game = game;
    this.action = action;
    this.ms = ms;
    this.t = 0;
    this.done = false;
    this.label = label;
    this.tapLabel = tapLabel;
    this.el = el('div', { class: 'hold-gauge', html: `<i class="hold-ring"></i>${keyCapHtml(game, action)}<em>${escapeHtml(label)}</em>` });
    this.relabel();
  }

  /** Follow the input device (call from the owning scene's onDeviceChange). */
  relabel() {
    const tap = !!this.tapLabel && deviceOf(this.game) === 'touch';
    this.el.classList.toggle('is-tap', tap);
    const em = this.el.querySelector('em');
    if (em) em.textContent = tap ? this.tapLabel : this.label;
  }

  update(dt) {
    if (this.done) return false;
    const down = this.game.input?.isDown(this.action);
    this.t = down ? this.t + dt : Math.max(0, this.t - dt * 3);
    const f = Math.min(1, this.t / this.ms);
    this.el.style.setProperty('--f', f.toFixed(3));
    this.el.classList.toggle('is-holding', f > 0.02);
    if (f >= 1) {
      this.done = true;
      return true;
    }
    return false;
  }

  reset() {
    this.t = 0;
    this.done = false;
    this.el.style.setProperty('--f', '0');
    this.el.classList.remove('is-holding');
  }
}

/**
 * True when any mapped action, raw key or pointer press happened this frame (the "press any key" gate).
 * @param {object} input
 * @returns {boolean}
 */
export function anyInputPressed(input) {
  if (!input) return false;
  if (input.anyPressed()) return true;
  if (input.pointer?.pressed) return true;
  // Unbound keys (e.g. P) still count.
  return typeof input.anyKeyPressed === 'function' && input.anyKeyPressed();
}
