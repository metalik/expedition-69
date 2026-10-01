// Scene base class and the stack-based SceneManager (SPEC §4.1).
// Scenes are pushed/popped by registry name; transparent scenes let the ones beneath keep rendering.
// Lifecycle hooks are error-isolated so one faulty scene cannot take the whole game down.

/**
 * Base class for every scene. Subclasses override the lifecycle hooks they need.
 * Set `this.transparent = true` (after super()) for overlays that should render over the scene below.
 */
export class Scene {
  /** @param {import('./engine.js').Game} game */
  constructor(game) {
    this.game = game;
    this.transparent = false;
    this._ui = [];
    /** Registry name, assigned by the SceneManager before enter(). */
    this.name = null;
  }

  /** Called once when the scene becomes active. @param {object} params */
  enter(params) {}

  /** Called once when the scene is removed (its mounted UI is removed right after). */
  exit() {}

  /** Called when another scene is pushed on top of this one. */
  pause() {}

  /** Called when the scene above was popped; receives that pop's result. @param {*} result */
  resume(result) {}

  /** Per-frame logic (only the top scene updates). @param {number} dt ms, ≤ 50 */
  update(dt) {}

  /** Draw in logical 1280×720 stage space (the base transform is already applied). @param {CanvasRenderingContext2D} ctx */
  render(ctx) {}

  /**
   * Append a DOM element to the game's UI root and track it for automatic removal on exit.
   * An HTML string is accepted as a convenience (wrapped in a <div>).
   * @template {Element} T
   * @param {T|string} el
   * @returns {T}
   */
  mountUI(el) {
    let node = el;
    if (typeof el === 'string') {
      node = globalThis.document.createElement('div');
      node.innerHTML = el;
    }
    const root = this.game?.uiRoot;
    if (root && node && typeof root.appendChild === 'function') root.appendChild(node);
    if (node) this._ui.push(node);
    return node;
  }

  /** Remove every element mounted with mountUI (the SceneManager calls this after exit()). */
  unmountUI() {
    for (const el of this._ui) {
      try {
        if (typeof el.remove === 'function') el.remove();
        else el.parentNode?.removeChild(el);
      } catch {
        // Element already detached — nothing to do.
      }
    }
    this._ui = [];
  }

  /** True while this scene is the top of the stack. */
  get isTop() {
    return this.game?.scenes?.top === this;
  }
}

/**
 * Stack of scene instances created from registered classes.
 * push pauses the current top; pop exits the top and resumes the one below with a result.
 */
export class SceneManager {
  /** @param {import('./engine.js').Game} game */
  constructor(game) {
    this.game = game;
    this._registry = new Map();
    this._stack = [];
  }

  /**
   * Register a scene class under a name.
   * @param {string} name
   * @param {typeof Scene} SceneClass
   */
  register(name, SceneClass) {
    if (typeof name !== 'string' || !name) throw new TypeError('Scene name must be a non-empty string');
    if (typeof SceneClass !== 'function') throw new TypeError(`Scene "${name}" must be a class`);
    this._registry.set(name, SceneClass);
  }

  /** True if a scene class is registered under `name`. */
  isRegistered(name) {
    return this._registry.has(name);
  }

  /**
   * Pause the current top and enter a new scene above it.
   * @param {string} name
   * @param {object} [params]
   * @returns {Scene}
   */
  push(name, params) {
    const scene = this._create(name);
    const prev = this.top;
    if (prev) this._call(prev, 'pause');
    this._stack.push(scene);
    this._call(scene, 'enter', params ?? {});
    this._changed('push', scene);
    return scene;
  }

  /**
   * Exit the top scene (exit + unmountUI) and resume the new top with `result`.
   * @param {*} [result]
   * @returns {Scene|undefined} the popped scene
   */
  pop(result) {
    const scene = this._stack.pop();
    if (!scene) return undefined;
    this._dispose(scene);
    const next = this.top;
    if (next) this._call(next, 'resume', result);
    this._changed('pop', scene);
    return scene;
  }

  /**
   * Exit the top scene and enter a new one at the same level (the scene below is not resumed).
   * @param {string} name
   * @param {object} [params]
   * @returns {Scene}
   */
  replace(name, params) {
    const scene = this._create(name);
    const old = this._stack.pop();
    if (old) this._dispose(old);
    this._stack.push(scene);
    this._call(scene, 'enter', params ?? {});
    this._changed('replace', scene);
    return scene;
  }

  /**
   * Exit every scene (top first) and enter a new one alone.
   * @param {string} name
   * @param {object} [params]
   * @returns {Scene}
   */
  reset(name, params) {
    const scene = this._create(name);
    while (this._stack.length) this._dispose(this._stack.pop());
    this._stack.push(scene);
    this._call(scene, 'enter', params ?? {});
    this._changed('reset', scene);
    return scene;
  }

  /** The active (top) scene, or null. */
  get top() {
    return this._stack.length ? this._stack[this._stack.length - 1] : null;
  }

  /**
   * True if a scene with this registry name is anywhere on the stack.
   * @param {string} name
   */
  has(name) {
    return this._stack.some((s) => s.name === name);
  }

  /**
   * Topmost scene instance with this name, or null.
   * @param {string} name
   */
  get(name) {
    for (let i = this._stack.length - 1; i >= 0; i--) if (this._stack[i].name === name) return this._stack[i];
    return null;
  }

  /** Copy of the stack, bottom first. */
  get stack() {
    return [...this._stack];
  }

  /** Number of scenes on the stack. */
  get size() {
    return this._stack.length;
  }

  /** Registry names on the stack, bottom first (handy for debugging). */
  names() {
    return this._stack.map((s) => s.name);
  }

  /**
   * Scenes that should render this frame: from the lowest visible one (every scene above it is
   * transparent) up to the top.
   * @returns {Scene[]}
   */
  visible() {
    let i = this._stack.length - 1;
    while (i > 0 && this._stack[i].transparent) i--;
    return i < 0 ? [] : this._stack.slice(i);
  }

  _create(name) {
    const SceneClass = this._registry.get(name);
    if (!SceneClass) throw new Error(`Unknown scene "${name}" (registered: ${[...this._registry.keys()].join(', ') || 'none'})`);
    const scene = new SceneClass(this.game);
    scene.name = name;
    if (!Array.isArray(scene._ui)) scene._ui = [];
    return scene;
  }

  _dispose(scene) {
    this._call(scene, 'exit');
    try {
      if (typeof scene.unmountUI === 'function') scene.unmountUI();
    } catch (err) {
      this._report(scene, 'unmountUI', err);
    }
  }

  _call(scene, method, arg) {
    const fn = scene?.[method];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.call(scene, arg);
    } catch (err) {
      this._report(scene, method, err);
      return undefined;
    }
  }

  _report(scene, phase, err) {
    if (this.game && typeof this.game.reportError === 'function') this.game.reportError(scene, phase, err);
    else console.error(`[scene] ${phase} of "${scene?.name}" threw:`, err);
  }

  _changed(op, scene) {
    this.game?.events?.emit?.('scene', { op, name: scene.name, stack: this.names() });
  }
}
