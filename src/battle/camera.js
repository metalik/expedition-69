// Battle camera for Expedition 69: smooth focus / zoom with exponential damping, short zoom "punches"
// for impacts, clamped pans that stay inside the backgrounds' overscan, and world ↔ screen mapping.
// World space equals stage space at the neutral framing (centre 640,360, zoom 1).

import { clamp, damp } from '../core/util.js';

/** Neutral framing centre (stage coordinates). */
export const CAMERA_CENTER = Object.freeze({ x: 640, y: 360 });
/** Pan limits (px from the neutral centre) and zoom limits. */
export const CAMERA_LIMITS = Object.freeze({ x: 120, y: 60, zoomMin: 1, zoomMax: 1.4 });

/**
 * A 2D battle camera. Call update(dt) every frame, apply(ctx, shake) before drawing world-space things,
 * and pass `offset` to drawBattleBackground as its `camera` option (parallax pan from the neutral framing).
 */
export class BattleCamera {
  constructor() {
    /** Current world point at the screen centre. */
    this.x = CAMERA_CENTER.x;
    this.y = CAMERA_CENTER.y;
    /** Current zoom (≥ 1). */
    this.zoom = 1;
    this._tx = this.x;
    this._ty = this.y;
    this._tz = 1;
    this._lambda = 6;
    this._punch = 0;
    this._punchV = 0;
    this._punchLife = 0;
    this._punchAge = 0;
  }

  /**
   * Smoothly frame a world point.
   * @param {number} x world x to centre
   * @param {number} y world y to centre
   * @param {number} [zoom=1]
   * @param {number} [ms=600] rough settle time (~95%)
   */
  focus(x, y, zoom = 1, ms = 600) {
    this._tx = clamp(Number.isFinite(x) ? x : CAMERA_CENTER.x, CAMERA_CENTER.x - CAMERA_LIMITS.x, CAMERA_CENTER.x + CAMERA_LIMITS.x);
    this._ty = clamp(Number.isFinite(y) ? y : CAMERA_CENTER.y, CAMERA_CENTER.y - CAMERA_LIMITS.y, CAMERA_CENTER.y + CAMERA_LIMITS.y);
    this._tz = clamp(Number.isFinite(zoom) ? zoom : 1, CAMERA_LIMITS.zoomMin, CAMERA_LIMITS.zoomMax);
    this._lambda = 3000 / Math.max(60, ms);
  }

  /**
   * Frame the midpoint of two world points (e.g. attacker and target), pulled towards `bias` (0 = a, 1 = b).
   * @param {{x:number,y:number}} a
   * @param {{x:number,y:number}} b
   * @param {number} [zoom=1.06]
   * @param {number} [ms=500]
   * @param {number} [bias=0.5]
   */
  focusBetween(a, b, zoom = 1.06, ms = 500, bias = 0.5) {
    if (!a || !b) return;
    const x = a.x + (b.x - a.x) * bias;
    const y = a.y + (b.y - a.y) * bias;
    // Feet are low on screen; frame a bit above them so bodies stay centred.
    this.focus(x, y - 90, zoom, ms);
  }

  /** Return to the neutral framing. @param {number} [ms=700] */
  reset(ms = 700) {
    this.focus(CAMERA_CENTER.x, CAMERA_CENTER.y, 1, ms);
  }

  /** Jump instantly to a framing (no smoothing). */
  snap(x = CAMERA_CENTER.x, y = CAMERA_CENTER.y, zoom = 1) {
    this.focus(x, y, zoom, 60);
    this.x = this._tx;
    this.y = this._ty;
    this.zoom = this._tz;
  }

  /**
   * A short zoom kick for impacts (parry, crit, break). Punches add up to a small cap.
   * @param {number} [amount=0.035]
   * @param {number} [ms=240]
   */
  punch(amount = 0.035, ms = 240) {
    this._punchV = Math.min(0.09, Math.max(this._punchV * (1 - this._punchAge / Math.max(1, this._punchLife)), 0) + amount);
    this._punchLife = Math.max(60, ms);
    this._punchAge = 0;
  }

  /** @param {number} dt ms */
  update(dt) {
    const d = Math.max(0, Math.min(Number(dt) || 0, 100));
    this.x = damp(this.x, this._tx, this._lambda, d);
    this.y = damp(this.y, this._ty, this._lambda, d);
    this.zoom = damp(this.zoom, this._tz, this._lambda, d);
    if (this._punchLife > 0) {
      this._punchAge += d;
      const u = Math.min(1, this._punchAge / this._punchLife);
      // Fast attack, eased release.
      const env = u < 0.18 ? u / 0.18 : (1 - (u - 0.18) / 0.82) ** 2;
      this._punch = this._punchV * env;
      if (u >= 1) {
        this._punchLife = 0;
        this._punch = 0;
        this._punchV = 0;
      }
    }
  }

  /** Zoom including the current punch. */
  get effectiveZoom() {
    return this.zoom + this._punch;
  }

  /** Pan offset from the neutral framing for drawBattleBackground({camera}). */
  get offset() {
    return { x: this.x - CAMERA_CENTER.x, y: this.y - CAMERA_CENTER.y, zoom: this.effectiveZoom };
  }

  /**
   * Apply the world transform (call inside ctx.save()/restore()).
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number}} [shake]
   */
  apply(ctx, shake = null) {
    const z = this.effectiveZoom;
    ctx.translate(CAMERA_CENTER.x + (shake?.x || 0), CAMERA_CENTER.y + (shake?.y || 0));
    ctx.scale(z, z);
    ctx.translate(-this.x, -this.y);
  }

  /** Stage (screen) point → world point. */
  toWorld(sx, sy) {
    const z = this.effectiveZoom;
    return { x: (sx - CAMERA_CENTER.x) / z + this.x, y: (sy - CAMERA_CENTER.y) / z + this.y };
  }

  /** World point → stage (screen) point. */
  toScreen(wx, wy) {
    const z = this.effectiveZoom;
    return { x: (wx - this.x) * z + CAMERA_CENTER.x, y: (wy - this.y) * z + CAMERA_CENTER.y };
  }
}
