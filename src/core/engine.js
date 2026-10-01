// Game engine: requestAnimationFrame loop, letterboxed 16:9 stage scaling, DPR-aware canvas,
// scene stack rendering with transparent overlays, error isolation, fades and settings (SPEC §4.1).
// Browser-only at construction time; importing it in Node is safe.

import { Emitter } from './events.js';
import { Input } from './input.js';
import { loadSettings, saveSettings as persistSettings, validateSettings } from './save.js';
import { Scene, SceneManager } from './scene.js';

export { Scene, SceneManager };

/** Logical stage size (all drawing and UI layout use these coordinates). */
export const STAGE_W = 1280;
export const STAGE_H = 720;
/** Largest dt (ms) handed to scene updates. */
export const MAX_DT = 50;
/** Device pixel ratio cap for the canvas backing store. */
export const MAX_DPR = 2;
/** Backing-store width cap (px) so 5K displays don't render 15-megapixel frames. */
export const MAX_BACKING_WIDTH = 3840;

const px = (n) => `${n}px`;

/**
 * The game: owns the canvas, input, settings, scene stack and main loop.
 * Construct once with the page elements, register scenes, push the first scene, then start().
 */
export class Game {
  /**
   * @param {{canvas?:HTMLCanvasElement, uiRoot?:HTMLElement, stageEl?:HTMLElement, fadeEl?:HTMLElement}} els
   *   defaults: #game, #ui, #stage, #fade (missing #ui / #fade are created inside the stage)
   */
  constructor({ canvas, uiRoot, stageEl, fadeEl } = {}) {
    const doc = globalThis.document;
    this.canvas = canvas ?? doc?.getElementById('game') ?? null;
    if (!this.canvas || typeof this.canvas.getContext !== 'function') throw new Error('Game: a <canvas> element is required');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.stageEl = stageEl ?? doc.getElementById('stage') ?? this.canvas.parentElement;
    this.uiRoot = uiRoot ?? doc.getElementById('ui') ?? this._createLayer('ui');
    this.fadeEl = fadeEl ?? doc.getElementById('fade') ?? this._createLayer('fade');
    this.viewportEl = this.stageEl.parentElement && this.stageEl.parentElement !== doc.body ? this.stageEl.parentElement : null;

    /** Logical size. */
    this.width = STAGE_W;
    this.height = STAGE_H;

    /** Persisted settings (edit, then call saveSettings()). */
    this.settings = loadSettings();
    /** URL query parameters. */
    this.params = new URLSearchParams(globalThis.location?.search ?? '');

    /** @type {Input} */
    this.input = new Input(globalThis.window ?? null);
    this.input.uiRoot = this.uiRoot;
    if (this.settings.bindings) this.input.setBindings(this.settings.bindings);

    /** Audio instance, assigned by main.js (may stay null). */
    this.audio = null;
    /**
     * Game-wide event bus: 'resize', 'settings', 'scene', 'visibility' (visible:boolean, {at, hiddenMs}), 'error'.
     * While the page is hidden no frame runs (game.time stands still, then jumps on return): time-keeping scenes
     * listen to 'visibility' to freeze their own clocks, and hiddenMs says how long the page was away.
     */
    this.events = new Emitter();
    /** RPG GameState, or null on the title screen. */
    this.state = null;
    /** performance.now() of the current frame. */
    this.time = globalThis.performance?.now() ?? 0;
    /** Frame counter. */
    this.frame = 0;
    /** Clamped dt of the current frame (ms). */
    this.dt = 0;
    /** Smoothed frames per second. */
    this.fps = 60;
    /** @type {SceneManager} */
    this.scenes = new SceneManager(this);
    /** Debug helpers (filled by main.js). */
    this.debug = {};
    /** Distinct errors caught in scene code: [{scene, phase, message, stack, time}]. */
    this.errors = [];
    /** CSS scale of the stage and canvas backing pixels per logical pixel. */
    this.scale = 1;
    this.pixelRatio = 1;
    /** Client-space rectangle of the scaled stage. */
    this.stageRect = { left: 0, top: 0, width: STAGE_W, height: STAGE_H };
    /** True while a fade() is running. */
    this.fading = false;
    /** True while the page is hidden (loop paused). */
    this.hidden = doc?.visibilityState === 'hidden';
    /** performance.now() when the page was last hidden (null while visible). */
    this.hiddenAt = this.hidden ? (globalThis.performance?.now() ?? 0) : null;
    /** Total ms the page has spent hidden since the game started. */
    this.hiddenTotal = 0;
    /** True after start() until stop(). */
    this.running = false;

    this._last = null;
    this._raf = 0;
    this._errorKeys = new Set();
    this._fadeChain = Promise.resolve();
    this._dprSeen = globalThis.devicePixelRatio || 1;
    this._tick = this._tick.bind(this);
    this._layout = this._layout.bind(this);
    this._onVisibility = this._onVisibility.bind(this);

    this._applyBaseStyles();
    this._layout();
    const win = globalThis.window;
    if (win) {
      win.addEventListener('resize', this._layout);
      win.addEventListener('orientationchange', this._layout);
      win.visualViewport?.addEventListener?.('resize', this._layout);
      doc.addEventListener('visibilitychange', this._onVisibility);
      doc.addEventListener('fullscreenchange', this._layout);
    }
  }

  // ---------------------------------------------------------------- public API

  /**
   * Register a scene class under a registry name.
   * @param {string} name
   * @param {typeof Scene} SceneClass
   * @returns {this}
   */
  registerScene(name, SceneClass) {
    this.scenes.register(name, SceneClass);
    return this;
  }

  /** Start the requestAnimationFrame loop (idempotent). @returns {this} */
  start() {
    if (this.running) return this;
    this.running = true;
    this._last = null;
    this._raf = globalThis.requestAnimationFrame(this._tick);
    return this;
  }

  /** Stop the loop. */
  stop() {
    this.running = false;
    if (this._raf) globalThis.cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /**
   * Run exactly one frame at time `now` (the rAF callback does this; exposed for tooling).
   * Order: input.beginFrame → top.update(dt) → clear → render visible stack → input.endFrame.
   * @param {number} now performance.now()-clock timestamp
   */
  step(now) {
    const raw = this._last === null ? 1000 / 60 : now - this._last;
    this._last = now;
    const dt = Math.min(Math.max(raw, 0), MAX_DT);
    this.time = now;
    this.dt = dt;
    this.frame += 1;
    if (raw > 0) this.fps += ((1000 / Math.max(raw, 1)) - this.fps) * 0.05;

    const dpr = globalThis.devicePixelRatio || 1;
    if (dpr !== this._dprSeen) {
      this._dprSeen = dpr;
      this._layout();
    }

    this.input.beginFrame(now);
    const top = this.scenes.top;
    if (top) {
      try {
        top.update(dt);
      } catch (err) {
        this.reportError(top, 'update', err);
      }
    }
    this._render();
    this.input.endFrame();
  }

  /**
   * Set ctx's transform so drawing uses logical 1280×720 coordinates.
   * @param {CanvasRenderingContext2D} [ctx=this.ctx]
   */
  applyBaseTransform(ctx = this.ctx) {
    const k = this.pixelRatio;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  /**
   * Fade the #fade overlay to black over outMs, await fn(), then fade back in over inMs.
   * Input is blocked while fading out and during fn. Calls are queued (never overlap).
   * Errors thrown by fn are reported (game.errors / console) and the promise resolves undefined.
   * @template T
   * @param {number} [outMs=300]
   * @param {() => (T|Promise<T>)} [fn]
   * @param {number} [inMs=outMs]
   * @returns {Promise<T|undefined>} fn's result
   */
  fade(outMs = 300, fn = null, inMs = outMs) {
    const run = async () => {
      this.fading = true;
      this.input.block();
      let result;
      try {
        await this._fadeTo(1, outMs);
        if (typeof fn === 'function') {
          try {
            result = await fn();
          } catch (err) {
            this.reportError(this.scenes.top, 'fade callback', err);
          }
        }
      } finally {
        this.input.unblock();
      }
      await this._fadeTo(0, inMs);
      this.fading = false;
      return result;
    };
    const p = this._fadeChain.then(run, run);
    this._fadeChain = p.catch(() => undefined);
    return p;
  }

  /**
   * Validate and persist this.settings, then apply them (bindings, audio volumes) and emit 'settings'.
   * @returns {boolean} true if written to storage
   */
  saveSettings() {
    Object.assign(this.settings, validateSettings(this.settings));
    const ok = persistSettings(this.settings);
    this.input.setBindings(this.settings.bindings);
    const a = this.audio;
    if (a && typeof a.setVolumes === 'function') {
      try {
        a.setVolumes({ master: this.settings.masterVolume, sfx: this.settings.sfxVolume, music: this.settings.musicVolume });
      } catch (err) {
        console.warn('[engine] audio.setVolumes failed:', err);
      }
    }
    this.events.emit('settings', this.settings);
    return ok;
  }

  /**
   * Convert client (viewport) coordinates to stage coordinates.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{x:number, y:number}}
   */
  toStage(clientX, clientY) {
    return this.input.toStage(clientX, clientY);
  }

  /** Toggle browser fullscreen on the viewport (no-op where unsupported). @returns {Promise<void>} */
  async toggleFullscreen() {
    const doc = globalThis.document;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await (this.viewportEl ?? this.stageEl).requestFullscreen?.();
    } catch (err) {
      console.warn('[engine] fullscreen unavailable:', err?.message ?? err);
    }
  }

  /**
   * Record an error from scene code, logging each distinct (scene, phase, message) once.
   * @param {Scene|null} scene
   * @param {string} phase
   * @param {*} err
   */
  reportError(scene, phase, err) {
    const name = scene?.name ?? '(none)';
    const message = err?.message ?? String(err);
    const key = `${name}|${phase}|${message}`;
    if (this._errorKeys.has(key)) return;
    this._errorKeys.add(key);
    const entry = { scene: name, phase, message, stack: err?.stack ?? '', time: this.time };
    this.errors.push(entry);
    console.error(`[engine] ${phase} of scene "${name}" threw: ${message}`, err);
    this.events.emit('error', entry);
  }

  // ---------------------------------------------------------------- internals

  _tick(now) {
    if (!this.running) return;
    this._raf = globalThis.requestAnimationFrame(this._tick);
    if (this.hidden) {
      this._last = null;
      return;
    }
    this.step(now);
  }

  _render() {
    const ctx = this.ctx;
    if (typeof ctx.reset === 'function') {
      ctx.reset(); // clears the bitmap AND any save() stack a crashed scene left behind
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this._normalizeCtx(ctx);
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.applyBaseTransform(ctx);
    for (const scene of this.scenes.visible()) {
      ctx.save();
      try {
        scene.render(ctx);
      } catch (err) {
        this.reportError(scene, 'render', err);
        this._normalizeCtx(ctx);
      }
      ctx.restore();
      this.applyBaseTransform(ctx);
    }
  }

  _normalizeCtx(ctx) {
    this.applyBaseTransform(ctx);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
  }

  _createLayer(id) {
    const el = globalThis.document.createElement('div');
    el.id = id;
    this.stageEl.appendChild(el);
    return el;
  }

  _applyBaseStyles() {
    const doc = globalThis.document;
    if (this.viewportEl) {
      Object.assign(this.viewportEl.style, {
        position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none',
      });
      const bg = globalThis.getComputedStyle?.(this.viewportEl)?.backgroundColor;
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') this.viewportEl.style.backgroundColor = '#000';
    }
    if (doc?.body) {
      doc.body.style.margin = '0';
      doc.body.style.overflow = 'hidden';
    }
    Object.assign(this.stageEl.style, {
      position: 'absolute', left: '0', top: '0', width: px(STAGE_W), height: px(STAGE_H),
      transformOrigin: '0 0', overflow: 'hidden', touchAction: 'none',
    });
    Object.assign(this.canvas.style, {
      position: 'absolute', left: '0', top: '0', width: px(STAGE_W), height: px(STAGE_H), display: 'block',
    });
    Object.assign(this.uiRoot.style, {
      position: 'absolute', left: '0', top: '0', width: px(STAGE_W), height: px(STAGE_H), zIndex: '1',
    });
    Object.assign(this.fadeEl.style, {
      position: 'absolute', left: '0', top: '0', width: px(STAGE_W), height: px(STAGE_H), zIndex: '2',
      background: '#000', opacity: '0', pointerEvents: 'none', transition: 'none',
    });
  }

  _layout() {
    const win = globalThis.window;
    const vw = this.viewportEl?.clientWidth || win?.innerWidth || STAGE_W;
    const vh = this.viewportEl?.clientHeight || win?.innerHeight || STAGE_H;
    const s = Math.max(0.05, Math.min(vw / STAGE_W, vh / STAGE_H));
    const left = Math.round((vw - STAGE_W * s) / 2);
    const top = Math.round((vh - STAGE_H * s) / 2);
    this.stageEl.style.left = px(left);
    this.stageEl.style.top = px(top);
    this.stageEl.style.transform = `scale(${s})`;

    const override = Number(this.params?.get('dpr'));
    const dpr = Math.min(Number.isFinite(override) && override > 0 ? override : (globalThis.devicePixelRatio || 1), MAX_DPR);
    const k = Math.min(s * dpr, MAX_BACKING_WIDTH / STAGE_W);
    const bw = Math.max(1, Math.round(STAGE_W * k));
    const bh = Math.max(1, Math.round(STAGE_H * k));
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.pixelRatio = bw / STAGE_W;
    this.scale = s;

    const r = this.stageEl.getBoundingClientRect?.();
    this.stageRect = r && r.width > 0
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : { left, top, width: STAGE_W * s, height: STAGE_H * s };
    this.input.setStageRect(this.stageRect, s);
    this.events?.emit('resize', { scale: s, pixelRatio: this.pixelRatio, rect: this.stageRect });
  }

  _onVisibility() {
    const hidden = globalThis.document.visibilityState === 'hidden';
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    const at = globalThis.performance?.now() ?? this.time;
    let hiddenMs = 0;
    if (hidden) {
      this.hiddenAt = at;
      this.input.clear();
      try {
        this.audio?.suspend?.();
      } catch (err) {
        console.warn('[engine] audio.suspend failed:', err);
      }
    } else {
      hiddenMs = this.hiddenAt === null ? 0 : Math.max(0, at - this.hiddenAt);
      this.hiddenTotal += hiddenMs;
      this.hiddenAt = null;
      this._last = null; // no giant dt after returning
      try {
        this.audio?.resumeCtx?.();
      } catch (err) {
        console.warn('[engine] audio.resumeCtx failed:', err);
      }
    }
    this.events.emit('visibility', !hidden, { at, hiddenMs });
  }

  _fadeTo(target, ms) {
    const el = this.fadeEl;
    const dur = Math.max(0, Number(ms) || 0);
    el.style.pointerEvents = target > 0 ? 'auto' : 'none';
    el.style.transition = dur > 0 ? `opacity ${dur}ms linear` : 'none';
    void el.offsetWidth; // flush styles so the transition starts from the current opacity
    el.style.opacity = String(target);
    return new Promise((resolve) => setTimeout(resolve, dur));
  }
}
