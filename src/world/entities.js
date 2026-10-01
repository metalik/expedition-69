// Exploration entities for Expedition 69: the walking party (leader + trailing followers), roaming Gloam
// spawns (patrol → notice → chase → give up; they never step into a camp's safe radius, and are drawn outlined so
// they read against busy ground), bosses, and the interactables (pennants, chests, journals, NPCs, merchants, the
// training mannequin, zone exits, landmark props) with their painterly world sprites.
// Browser drawing only inside draw calls; import-safe in Node.

import { drawActor, lookHeight } from '../render/sprites.js';
import { TILE, worldToTile, exitTiles } from './tilemap.js';
import {
  TAU, clamp, lerp, hash2, rng, rgba, mix, shade, dab, brush, glow, softShadow, sparkle, makeCanvas, drawProp, propBounds, flame,
} from './worldRender.js';
import { FONTS } from '../render/palette.js';

/** World-map actor scale (SPEC §3.6 / sprites notes). */
export const WORLD_SCALE = 0.45;
export const FOLLOWER_SCALE = 0.42;
export const BOSS_SCALE = 0.56;
/** Leader walking speed (px/s). */
export const WALK_SPEED = 160;
const ACCEL = 1500;
const DECEL = 2000;
/** Feet collision half extents. */
export const FEET = { hw: 10, hh: 6 };

const FACING_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** 4-way facing name for a direction vector. */
export function facingName(fx, fy) {
  if (Math.abs(fx) > Math.abs(fy)) return fx < 0 ? 'left' : 'right';
  return fy < 0 ? 'up' : 'down';
}

/** Direction vector for a stored facing value (name or angle in radians). */
export function facingVector(f) {
  if (typeof f === 'number' && Number.isFinite(f)) return [Math.cos(f), Math.sin(f)];
  return FACING_VEC[f] ?? FACING_VEC.down;
}

// ═══════════════════════════════════════════════════════════════════════════ party

/**
 * The leader plus two trailing followers, walking on breadcrumbs of the leader's path.
 */
export class PartyWalker {
  /**
   * @param {string[]} looks [leader, follower1, follower2]
   * @param {number} x feet px
   * @param {number} y feet px
   * @param {string|number} facing
   */
  constructor(looks, x, y, facing = 'down') {
    this.looks = looks;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    const [fx, fy] = facingVector(facing);
    this.fx = fx;
    this.fy = fy;
    this.spriteFacing = fx < -0.2 ? -1 : 1;
    this.clock = 0;
    this.moving = false;
    this.speed = 0;
    this.swingT = -1;
    this.invuln = 0;
    this.hidden = false;
    this.bump = 0;
    this.trail = [];
    this.followers = looks.slice(1).map((look, i) => ({ look, x: x - fx * 30 * (i + 1), y: y - fy * 30 * (i + 1), facing: this.spriteFacing, clock: i * 170, moving: false }));
    this.resetTrail();
  }

  /** Clear breadcrumbs (after teleports). */
  resetTrail() {
    this.trail = [{ x: this.x, y: this.y }];
    for (let i = 1; i <= 90; i++) this.trail.push({ x: this.x - this.fx * i * 1.2, y: this.y - this.fy * i * 1.2 });
    this.followers.forEach((f, i) => {
      f.x = this.x - this.fx * 30 * (i + 1);
      f.y = this.y - this.fy * 30 * (i + 1);
    });
  }

  get facingName() {
    return facingName(this.fx, this.fy);
  }

  /**
   * Walk with acceleration toward axis * speed, colliding with sliding.
   * @param {number} dt ms
   * @param {{x:number,y:number}} axis
   * @param {import('./tilemap.js').TileMap} map
   * @param {Array<number[]>} solids extra solid rects
   */
  update(dt, axis, map, solids) {
    const s = dt / 1000;
    const len = Math.hypot(axis.x, axis.y);
    const tx = axis.x * WALK_SPEED;
    const ty = axis.y * WALK_SPEED;
    const rate = (len > 0.05 ? ACCEL : DECEL) * s;
    this.vx = approachV(this.vx, tx, rate);
    this.vy = approachV(this.vy, ty, rate);
    if (len > 0.1) {
      this.fx = axis.x / len;
      this.fy = axis.y / len;
      if (Math.abs(this.fx) > 0.2) this.spriteFacing = this.fx < 0 ? -1 : 1;
    }
    const ox = this.x;
    const oy = this.y;
    if (this.vx || this.vy) {
      const r = map.moveBox(this.x, this.y, this.vx * s, this.vy * s, FEET.hw, FEET.hh, solids);
      this.x = r.x;
      this.y = r.y;
      if (r.blockedX && Math.abs(this.vx) > Math.abs(this.vy)) this.bump = Math.min(1, this.bump + s * 3);
    }
    const moved = Math.hypot(this.x - ox, this.y - oy);
    this.speed = moved / Math.max(s, 1e-4);
    this.moving = this.speed > 18;
    this.clock += dt * clamp(this.speed / WALK_SPEED, 0.5, 1.15);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.swingT >= 0) {
      this.swingT += dt;
      if (this.swingT > 320) this.swingT = -1;
    }
    this.bump = Math.max(0, this.bump - s * 2);
    // breadcrumbs
    const last = this.trail[0];
    if (Math.hypot(this.x - last.x, this.y - last.y) >= 3) {
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > 120) this.trail.length = 120;
    }
    this._updateFollowers(dt);
  }

  _updateFollowers(dt) {
    const spacing = [30, 58];
    this.followers.forEach((f, i) => {
      const target = this._trailAt(spacing[i] ?? 30 * (i + 1));
      const dx = target.x - f.x;
      const dy = target.y - f.y;
      const d = Math.hypot(dx, dy);
      const k = 1 - Math.exp(-dt / 70);
      const nx = f.x + dx * k;
      const ny = f.y + dy * k;
      const sp = Math.hypot(nx - f.x, ny - f.y) / Math.max(dt / 1000, 1e-4);
      if (Math.abs(nx - f.x) > 0.15) f.facing = nx < f.x ? -1 : 1;
      f.x = nx;
      f.y = ny;
      f.moving = sp > 18 && d > 1;
      f.clock += dt * clamp(sp / WALK_SPEED, 0.5, 1.15);
    });
  }

  _trailAt(dist) {
    let acc = 0;
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + seg >= dist) {
        const t = seg > 0 ? (dist - acc) / seg : 0;
        return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
      }
      acc += seg;
    }
    return this.trail[this.trail.length - 1];
  }

  /** Start a weapon swing (confirm with nothing to interact with). */
  swing() {
    if (this.swingT >= 0 && this.swingT < 260) return false;
    this.swingT = 0;
    return true;
  }

  get swinging() {
    return this.swingT >= 0;
  }

  /** Drawables for y-sorting: leader and followers. */
  collect(out, t) {
    this.followers.forEach((f, i) => out.push({ y: f.y, kind: 'follower', draw: (ctx) => this._drawFollower(ctx, f, i, t) }));
    out.push({ y: this.y, kind: 'player', draw: (ctx) => this._drawLeader(ctx, t) });
  }

  _alpha(t) {
    if (this.invuln <= 0) return 1;
    return 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.03));
  }

  _drawLeader(ctx, t) {
    let anim = this.moving ? 'run' : 'idle';
    let p = 0;
    let variant = null;
    if (this.swingT >= 0) {
      anim = 'strike';
      variant = 'slash';
      p = clamp(this.swingT / 300, 0, 1);
    }
    drawActor(ctx, this.looks[0], {
      x: this.x, y: this.y, scale: WORLD_SCALE, facing: this.spriteFacing, anim, variant, p, t: anim === 'run' ? this.clock : t, alpha: this._alpha(t),
    });
  }

  _drawFollower(ctx, f, i, t) {
    drawActor(ctx, f.look, {
      x: f.x, y: f.y, scale: FOLLOWER_SCALE, facing: f.facing, anim: f.moving ? 'run' : 'idle', t: f.moving ? f.clock : t + i * 400, alpha: this._alpha(t),
    });
  }
}

function approachV(v, target, delta) {
  if (v < target) return Math.min(target, v + delta);
  return Math.max(target, v - delta);
}

// ═══════════════════════════════════════════════════════════════════════════ roaming enemies

const NOTICE_R = 5 * TILE;
const GIVEUP_R = 8.5 * TILE;
const LEASH_R = 11 * TILE;
const CONTACT_R = 26;
const CHASE_SPEED = 124;
const WANDER_SPEED = 52;
const RETURN_SPEED = 90;

/**
 * A roaming Gloam spawn. The lead enemy of its encounter is drawn at world scale; companions trail it.
 */
export class RoamingEnemy {
  /**
   * @param {object} def map entity {id, encounter, x, y, patrol, tutorial?, later?}
   * @param {{encounterId:string, enemies:string[], looks:string[], boss?:boolean, tutorial?:boolean}} info
   */
  constructor(def, info) {
    this.def = def;
    this.id = def.id;
    this.info = info;
    this.look = info.looks[0] ?? 'driftling';
    this.companions = info.looks.slice(1).map((look, i) => ({ look, x: 0, y: 0, ox: (i ? 1 : -1) * 24, oy: -10 - i * 6, facing: -1 }));
    this.sx = (def.x + 0.5) * TILE;
    this.sy = (def.y + 0.7) * TILE;
    this.x = this.sx;
    this.y = this.sy;
    this.patrolR = (def.patrol?.r ?? 2.5) * TILE;
    this.state = 'wander';
    this.timer = 400 + hash2(def.x, def.y, 3) * 1400;
    this.tx = this.x;
    this.ty = this.y;
    this.facing = hash2(def.x, def.y, 4) < 0.5 ? -1 : 1;
    this.clock = hash2(def.x, def.y, 5) * 3000;
    this.moving = false;
    this.bubble = null; // {ch:'!'|'?', t}
    this.stun = 0;
    this.alpha = 0;
    this.dying = -1;
    this.stuckT = 0;
    this.scale = WORLD_SCALE * (lookHeight(this.look) > 200 ? 0.85 : 1);
    this.companions.forEach((c) => {
      c.x = this.x + c.ox;
      c.y = this.y + c.oy;
    });
  }

  get dead() {
    return this.dying >= 600;
  }

  /**
   * @param {number} dt
   * @param {{map, player:PartyWalker, flow:Int16Array|null, frozen:boolean, playerInvuln:boolean,
   *   safe?:Array<{x:number,y:number,r:number}>, playerSafe?:boolean, grace?:boolean}} env
   *   safe = camp no-aggro circles (px) the spawn never enters; playerSafe = the party stands in one (no notice,
   *   chases end at the edge, no contact); grace = a moment after a dialogue or menu closes (no notice or contact)
   * @returns {'contact'|null}
   */
  update(dt, env) {
    this.clock += dt;
    this.alpha = Math.min(1, this.alpha + dt / 500);
    if (this.dying >= 0) {
      this.dying += dt;
      return null;
    }
    if (this.bubble) {
      this.bubble.t += dt;
      if (this.bubble.t > 900) this.bubble = null;
    }
    if (env.frozen) {
      this.moving = false;
      return null;
    }
    const { map, player } = env;
    const pdx = player.x - this.x;
    const pdy = player.y - this.y;
    const pd = Math.hypot(pdx, pdy);
    const spawnToPlayer = Math.hypot(player.x - this.sx, player.y - this.sy);
    const calm = env.playerInvuln || env.playerSafe || env.grace;
    let speed = 0;
    let gx = this.x;
    let gy = this.y;

    if (this.stun > 0) {
      this.stun -= dt;
      if (this.stun <= 0) {
        this.state = 'return';
        this.bubble = { ch: '?', t: 0 };
      }
    } else {
      switch (this.state) {
        case 'wander': {
          this.timer -= dt;
          if (this.timer <= 0) {
            const R = Math.random;
            this.tx = this.x;
            this.ty = this.y;
            for (let k = 0; k < 4; k++) {
              const a = R() * TAU;
              const r = Math.sqrt(R()) * this.patrolR;
              const x = this.sx + Math.cos(a) * r;
              const y = this.sy + Math.sin(a) * r;
              if (inSafe(env.safe, x, y, 12)) continue;
              this.tx = x;
              this.ty = y;
              break;
            }
            this.timer = 1800 + R() * 2600;
          }
          if (Math.hypot(this.tx - this.x, this.ty - this.y) > 6) {
            speed = WANDER_SPEED;
            gx = this.tx;
            gy = this.ty;
          }
          if (!calm && pd < NOTICE_R && spawnToPlayer < LEASH_R && this._canReach(env, 8)) {
            this.state = 'notice';
            this.timer = 520;
            this.bubble = { ch: '!', t: 0 };
            this.facing = pdx < 0 ? -1 : 1;
            env.onNotice?.(this);
          }
          break;
        }
        case 'notice':
          this.timer -= dt;
          this.facing = pdx < 0 ? -1 : 1;
          if (this.timer <= 0) this.state = 'chase';
          break;
        case 'chase': {
          if (env.playerInvuln || env.playerSafe || pd > GIVEUP_R || Math.hypot(this.x - this.sx, this.y - this.sy) > LEASH_R) {
            this.state = 'return';
            this.bubble = { ch: '?', t: 0 };
            break;
          }
          speed = CHASE_SPEED;
          const step = this._flowStep(env);
          gx = step.x;
          gy = step.y;
          break;
        }
        case 'return':
        default: {
          speed = RETURN_SPEED;
          gx = this.sx;
          gy = this.sy;
          if (Math.hypot(this.sx - this.x, this.sy - this.y) < 10) {
            this.state = 'wander';
            this.timer = 800;
          } else if (!calm && pd < NOTICE_R * 0.7 && spawnToPlayer < LEASH_R && this._canReach(env, 6)) {
            this.state = 'notice';
            this.timer = 380;
            this.bubble = { ch: '!', t: 0 };
          }
          break;
        }
      }
    }

    this.moving = false;
    if (speed > 0) {
      const dx = gx - this.x;
      const dy = gy - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        const st = Math.min(d, speed * (dt / 1000));
        const to = keepOut(env.safe, this.x + (dx / d) * st, this.y + (dy / d) * st);
        const r = map.moveBox(this.x, this.y, to.x - this.x, to.y - this.y, 9, 6, null);
        const moved = Math.hypot(r.x - this.x, r.y - this.y);
        this.x = r.x;
        this.y = r.y;
        this.moving = moved > 0.2;
        if (Math.abs(dx) > 2) this.facing = dx < 0 ? -1 : 1;
        if (moved < st * 0.25) {
          this.stuckT += dt;
          if (this.stuckT > 600 && this.state === 'wander') {
            this.timer = 0;
            this.stuckT = 0;
          }
        } else this.stuckT = 0;
      }
    }
    // companions trail loosely
    for (const c of this.companions) {
      const tx = this.x + c.ox * (this.facing < 0 ? -1 : 1) * -1;
      const ty = this.y + c.oy;
      const k = 1 - Math.exp(-dt / 160);
      if (Math.abs(tx - c.x) > 0.3) c.facing = tx < c.x ? -1 : 1;
      c.x += (tx - c.x) * k;
      c.y += (ty - c.y) * k;
    }
    if (!calm && this.stun <= 0 && this.alpha > 0.6 && pd < CONTACT_R) return 'contact';
    return null;
  }

  /** True when the party can be reached on foot within `maxTiles` (no noticing across voids, water or walls). */
  _canReach(env, maxTiles) {
    const { flow, map } = env;
    if (!flow) return true;
    const t = worldToTile(this.x, this.y);
    if (!map.inBounds(t.x, t.y)) return false;
    const d = flow[t.y * map.w + t.x];
    return d >= 0 && d <= maxTiles;
  }

  /** Next waypoint toward the player following the BFS flow field (falls back to straight steering). */
  _flowStep(env) {
    const { map, flow, player } = env;
    const t = worldToTile(this.x, this.y);
    const pt = worldToTile(player.x, player.y);
    if (!flow || (Math.abs(t.x - pt.x) <= 1 && Math.abs(t.y - pt.y) <= 1)) return { x: player.x, y: player.y };
    const here = flow[t.y * map.w + t.x];
    let best = null;
    let bestD = here >= 0 ? here : 32767;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = t.x + ox;
      const ny = t.y + oy;
      if (!map.inBounds(nx, ny)) continue;
      const d = flow[ny * map.w + nx];
      if (d < 0 || d >= bestD) continue;
      if (ox && oy && (!map.isWalkableTerrain(t.x + ox, t.y) || !map.isWalkableTerrain(t.x, t.y + oy))) continue;
      bestD = d;
      best = { x: (nx + 0.5) * TILE, y: (ny + 0.6) * TILE };
    }
    return best ?? { x: player.x, y: player.y };
  }

  /** Knock the spawn back from a point and daze it (after the party flees). */
  knockBack(fromX, fromY, env) {
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const r = env.map.moveBox(this.x, this.y, (dx / d) * 2.2 * TILE, (dy / d) * 2.2 * TILE, 9, 6, null);
    this.x = r.x;
    this.y = r.y;
    this.stun = 2600;
    this.state = 'return';
    this.bubble = null;
  }

  /** Start the defeat dissolve. */
  kill() {
    this.dying = 0;
  }

  collect(out, t) {
    for (const c of this.companions) out.push({ y: c.y, kind: 'enemy', draw: (ctx) => this._drawOne(ctx, c.look, c.x, c.y, c.facing, t + 300, 0.4 * (this.scale / WORLD_SCALE)) });
    out.push({ y: this.y, kind: 'enemy', ref: this, draw: (ctx) => this._drawMain(ctx, t) });
  }

  _drawOne(ctx, look, x, y, facing, t, scale) {
    const dying = this.dying >= 0;
    const pose = {
      x, y, scale, facing, anim: dying ? 'ko' : this.moving ? (this.state === 'chase' ? 'run' : 'walk') : 'idle', p: dying ? clamp(this.dying / 600, 0, 1) : 0,
      t: this.clock, alpha: this.alpha, tint: this.stun > 0 ? { color: '#9fa8d0', amount: 0.25 } : null,
    };
    if (dying) drawActor(ctx, look, pose);
    else drawOutlinedActor(ctx, look, pose);
  }

  _drawMain(ctx, t) {
    this._drawOne(ctx, this.look, this.x, this.y, this.facing, t, this.scale);
    const h = lookHeight(this.look) * this.scale;
    if (this.stun > 0 && this.dying < 0) {
      for (let i = 0; i < 3; i++) {
        const a = t * 0.004 + (i * TAU) / 3;
        sparkle(ctx, this.x + Math.cos(a) * 14, this.y - h - 4 + Math.sin(a) * 4, 4, '#ffe9a0', 0.9, a);
      }
    }
    if (this.bubble && this.dying < 0) drawBubble(ctx, this.x, this.y - h - 8, this.bubble.ch, this.bubble.t);
  }
}

// ─────────────────────────────────────────────────────────── readable silhouettes

const _scratch = [];
/** Grow-only offscreen canvas for per-frame compositing (slot 0 actor, 1 ink, 2 rim). */
function scratch(slot, w, h) {
  let c = _scratch[slot];
  if (c === undefined) c = _scratch[slot] = makeCanvas(w, h);
  if (!c) return null;
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, w);
    c.height = Math.max(c.height, h);
  }
  return c;
}

/** Device pixels per logical pixel of a context's current transform. */
function deviceScale(ctx) {
  if (typeof ctx.getTransform !== 'function') return 1;
  const m = ctx.getTransform();
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

const INK_OFFSETS = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.3], [0, 1.3], [-1.3, 0], [1.3, 0]];

/**
 * Draw an actor with a soft dark ground shadow, a thin ink outline and a warm rim light on its sunlit (top-right)
 * edge, so roaming Gloam read against busy ground (the golden Thornstag in the Thicket's canopy). The actor is
 * rendered once into an offscreen canvas at device resolution; its silhouette is stamped around it.
 * @param {CanvasRenderingContext2D} ctx world-space context
 * @param {string} look
 * @param {object} pose drawActor pose (x, y = feet)
 * @param {{ink?:string, rim?:string, width?:number}} [o]
 */
export function drawOutlinedActor(ctx, look, pose, { ink = 'rgba(20,11,9,0.8)', rim = 'rgba(255,233,184,0.9)', width = 1.5 } = {}) {
  const alpha = pose.alpha ?? 1;
  if (alpha <= 0.004) return;
  const s = pose.scale ?? 1;
  const h = lookHeight(look) * s;
  softShadow(ctx, pose.x - h * 0.05, pose.y + 1, Math.max(12, h * 0.34), Math.max(4, h * 0.1), 0.5 * alpha);
  const k = deviceScale(ctx);
  const bw = h * 1.9 + 16;
  const bh = h * 1.5 + 16;
  const ox = bw / 2;
  const oy = h * 1.3 + 8;
  const pw = Math.ceil(bw * k);
  const ph = Math.ceil(bh * k);
  const A = scratch(0, pw, ph);
  const B = scratch(1, pw, ph);
  const C = scratch(2, pw, ph);
  if (!A || !B || !C) {
    drawActor(ctx, look, pose);
    return;
  }
  const a = A.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalCompositeOperation = 'source-over';
  a.globalAlpha = 1;
  a.clearRect(0, 0, pw, ph);
  a.setTransform(k, 0, 0, k, ox * k, oy * k);
  drawActor(a, look, { ...pose, x: 0, y: 0, alpha: 1, shadow: false });
  for (const [S, col] of [[B, ink], [C, rim]]) {
    const g = S.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, pw, ph);
    g.drawImage(A, 0, 0, pw, ph, 0, 0, pw, ph);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = col;
    g.fillRect(0, 0, pw, ph);
    g.globalCompositeOperation = 'source-over';
  }
  const x0 = pose.x - ox;
  const y0 = pose.y - oy;
  const lw = pw / k;
  const lh = ph / k;
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = pa * alpha;
  for (const [dx, dy] of INK_OFFSETS) ctx.drawImage(B, 0, 0, pw, ph, x0 + dx * width, y0 + dy * width, lw, lh);
  ctx.drawImage(C, 0, 0, pw, ph, x0 + width * 0.9, y0 - width * 0.9, lw, lh);
  ctx.drawImage(A, 0, 0, pw, ph, x0, y0, lw, lh);
  ctx.globalAlpha = pa;
}

/** True when (x, y) lies within `margin` px of (or inside) any safe circle. */
export function inSafe(zones, x, y, margin = 0) {
  if (!zones) return false;
  for (const z of zones) if (Math.hypot(x - z.x, y - z.y) < z.r + margin) return true;
  return false;
}

/** Push a point out of every safe circle it falls inside (onto the rim), so a step never enters a camp. */
export function keepOut(zones, x, y) {
  if (zones) {
    for (const z of zones) {
      const dx = x - z.x;
      const dy = y - z.y;
      const d = Math.hypot(dx, dy);
      if (d >= z.r) continue;
      const k = d > 0.01 ? (z.r + 0.5) / d : 0;
      x = k ? z.x + dx * k : z.x + z.r + 0.5;
      y = k ? z.y + dy * k : y;
    }
  }
  return { x, y };
}

/** Painted "!" / "?" pop above a head. */
export function drawBubble(ctx, x, y, ch, age) {
  const pop = age < 160 ? 0.4 + 0.9 * (age / 160) : age < 260 ? 1.3 - 0.3 * ((age - 160) / 100) : 1;
  const a = age > 700 ? 1 - (age - 700) / 200 : 1;
  if (a <= 0) return;
  ctx.save();
  ctx.translate(x, y - Math.min(age, 200) * 0.03);
  ctx.scale(pop, pop);
  ctx.globalAlpha *= a;
  const col = ch === '!' ? '#e8483a' : '#e0b458';
  ctx.fillStyle = 'rgba(21,16,13,0.9)';
  ctx.beginPath();
  ctx.ellipse(0, -2, 12, 13, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-4, 8);
  ctx.lineTo(0, 16);
  ctx.lineTo(4, 8);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -2, 12, 13, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = ch === '!' ? '#ffe2c8' : '#f3dba0';
  ctx.font = `900 19px ${FONTS.title}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, 0, -1);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════ static entities

/**
 * Base for map entities that sit on a tile (flags, chests, NPCs…).
 */
export class TileEntity {
  constructor(def) {
    this.def = def;
    this.type = def.type;
    this.id = def.id ?? null;
    this.tx = def.x;
    this.ty = def.y;
    this.x = (def.x + 0.5) * TILE;
    this.y = (def.y + 0.72) * TILE;
    this.reach = 46;
    this.used = false;
  }

  /** Solid rect in px (feet-level) or null. */
  get solid() {
    return [this.tx * TILE + 5, this.ty * TILE + 10, (this.tx + 1) * TILE - 5, (this.ty + 1) * TILE - 2];
  }

  /** Point the player must be near to interact. */
  get focus() {
    return { x: this.x, y: this.y - 6 };
  }

  /** Where prompts float (world px). */
  get promptAt() {
    return { x: this.x, y: this.y - 64 };
  }

  prompt() {
    return null;
  }

  collect(out, t) {
    out.push({ y: this.y, kind: this.type, ref: this, draw: (ctx) => this.draw(ctx, t) });
  }

  draw() {}
}

/** Expedition Pennant (a `flag` entity): rest / save / fast travel via the flag scene. */
export class FlagEntity extends TileEntity {
  constructor(def, visited) {
    super(def);
    this.name = def.name ?? 'Expedition Pennant';
    this.visited = !!visited;
    this.lit = visited ? 1 : 0;
  }

  prompt() {
    return { verb: 'Rest', label: this.name };
  }

  get promptAt() {
    return { x: this.x, y: this.y - 104 };
  }

  update(dt) {
    if (this.visited) this.lit = Math.min(1, this.lit + dt / 900);
  }

  draw(ctx, t) {
    const x = this.x;
    const y = this.y;
    // ring of stones + fire pit
    softShadow(ctx, x - 6, y + 2, 30, 10, 0.5);
    const R = rng(this.tx * 31 + this.ty * 17);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      dab(ctx, x + Math.cos(a) * 17, y + 4 + Math.sin(a) * 7, 4.2, 3, a, mix('#7a6a66', '#b8a898', R()));
      dab(ctx, x + Math.cos(a) * 17 + 0.8, y + 3 + Math.sin(a) * 7, 2, 1.2, a, 'rgba(255,240,210,0.5)');
    }
    dab(ctx, x, y + 4, 12, 5, 0, '#2a1a14');
    if (this.lit > 0) {
      const fl = 0.8 + 0.2 * Math.sin(t * 0.021) * Math.sin(t * 0.013);
      glow(ctx, x, y - 2, 70 * this.lit * fl, '#ff9a4a', 0.35 * this.lit);
      flame(ctx, x, y + 3, 11 * this.lit, t);
    } else {
      // cold embers
      for (let i = 0; i < 4; i++) brush(ctx, x - 7 + i * 4, y + 5, 8, 2, -0.4 + i * 0.3, '#4a3428');
    }
    // pole
    const px = x + 12;
    ctx.fillStyle = '#3a281e';
    ctx.fillRect(px - 2, y - 92, 4, 94);
    ctx.fillStyle = 'rgba(255,230,190,0.5)';
    ctx.fillRect(px + 0.5, y - 92, 1.2, 94);
    dab(ctx, px, y - 94, 3.5, 3.5, 0, '#e0b458');
    // waving pennant (expedition colours: crimson with a gold sun)
    const W = 38;
    const H = 24;
    ctx.save();
    ctx.translate(px + 2, y - 88);
    ctx.beginPath();
    const wave = (u) => Math.sin(u * 5 - t * 0.004) * 3.2 * u;
    ctx.moveTo(0, 0);
    for (let i = 1; i <= 8; i++) {
      const u = i / 8;
      ctx.lineTo(u * W, wave(u) + u * 2);
    }
    for (let i = 8; i >= 0; i--) {
      const u = i / 8;
      ctx.lineTo(u * W * (i === 8 ? 0.82 : 1), H - u * 5 + wave(u));
    }
    ctx.closePath();
    const gr = ctx.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#8a2a24');
    gr.addColorStop(0.6, '#b8423a');
    gr.addColorStop(1, '#7a2420');
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,200,120,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // sun emblem
    const sx = W * 0.42;
    const sy = H * 0.45 + wave(0.42);
    ctx.fillStyle = '#e8c060';
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      brush(ctx, sx + Math.cos(a) * 6, sy + Math.sin(a) * 6, 3, 1.4, a, '#e8c060');
    }
    ctx.restore();
    if (this.visited) glow(ctx, px + 20, y - 76, 26, '#ffd98a', 0.18 + 0.06 * Math.sin(t * 0.003));
  }
}

/** Treasure chest (relic / shard / glint). */
export class ChestEntity extends TileEntity {
  constructor(def, opened) {
    super(def);
    this.opened = !!opened;
    this.openT = opened ? 1 : 0;
    this.reach = 44;
  }

  prompt() {
    return this.opened ? null : { verb: 'Open', label: 'Chest' };
  }

  get promptAt() {
    return { x: this.x, y: this.y - 50 };
  }

  update(dt) {
    if (this.opened) this.openT = Math.min(1, this.openT + dt / 380);
  }

  draw(ctx, t) {
    const x = this.x;
    const y = this.y;
    softShadow(ctx, x - 4, y + 1, 22, 8, 0.6);
    const w = 30;
    const h = 16;
    // body
    ctx.fillStyle = '#4a2c1c';
    ctx.fillRect(x - w / 2, y - h, w, h);
    const gr = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    gr.addColorStop(0, '#5a3522');
    gr.addColorStop(0.7, '#8a5634');
    gr.addColorStop(1, '#6a4028');
    ctx.fillStyle = gr;
    ctx.fillRect(x - w / 2 + 1.5, y - h + 1.5, w - 3, h - 3);
    // brass bands
    ctx.fillStyle = '#c9a052';
    ctx.fillRect(x - w / 2, y - h, 3, h);
    ctx.fillRect(x + w / 2 - 3, y - h, 3, h);
    ctx.fillRect(x - w / 2, y - 4, w, 2);
    const open = this.openT;
    if (open > 0.02) {
      // inner glow + lifted lid
      glow(ctx, x, y - h - 2, 26 * open, '#ffe0a0', 0.5 * (1 - open * 0.6));
      ctx.fillStyle = '#1e120c';
      ctx.fillRect(x - w / 2 + 2, y - h - 1, w - 4, 3);
      ctx.save();
      ctx.translate(x, y - h);
      ctx.scale(1, 1 - open * 1.6);
      this._lid(ctx, w);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(x, y - h);
      this._lid(ctx, w);
      ctx.restore();
      // lock
      dab(ctx, x, y - h + 3, 3.2, 3.6, 0, '#e0b458');
      dab(ctx, x - 0.6, y - h + 2.2, 1.2, 1.2, 0, '#fff0c0');
      // glint
      const g = ((t + this.tx * 700) % 2600) / 2600;
      if (g < 0.2) sparkle(ctx, x + 10, y - h - 6, 5 * Math.sin((g / 0.2) * Math.PI), '#fff0c0', 0.9, 0);
    }
  }

  _lid(ctx, w) {
    const gr = ctx.createLinearGradient(0, -12, 0, 0);
    gr.addColorStop(0, '#a06a3e');
    gr.addColorStop(1, '#5a3522');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.quadraticCurveTo(-w / 2, -11, 0, -12);
    ctx.quadraticCurveTo(w / 2, -11, w / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c9a052';
    ctx.fillRect(-w / 2, -3, 3, 3);
    ctx.fillRect(w / 2 - 3, -3, 3, 3);
    ctx.fillStyle = 'rgba(255,230,180,0.35)';
    ctx.fillRect(-w / 2 + 4, -10, w - 8, 1.2);
  }
}

/** A lost expedition's journal on a little cairn. */
export class JournalEntity extends TileEntity {
  constructor(def, read) {
    super(def);
    this.read = !!read;
  }

  prompt() {
    return { verb: 'Read', label: 'Journal' };
  }

  get promptAt() {
    return { x: this.x, y: this.y - 52 };
  }

  draw(ctx, t) {
    const x = this.x;
    const y = this.y;
    softShadow(ctx, x - 4, y + 2, 20, 7, 0.5);
    // cairn of flat stones
    const R = rng(this.tx * 13 + this.ty * 7);
    for (let i = 0; i < 3; i++) {
      const w = 14 - i * 3;
      dab(ctx, x + (R() - 0.5) * 2, y - 2 - i * 5, w, 4, (R() - 0.5) * 0.2, mix('#6e625e', '#b5a898', 0.3 + i * 0.2));
      dab(ctx, x + 2, y - 3.5 - i * 5, w * 0.6, 1.2, 0, 'rgba(255,240,210,0.4)');
    }
    // book
    const by = y - 17;
    ctx.save();
    ctx.translate(x, by);
    ctx.rotate(-0.12);
    ctx.fillStyle = '#5a2a22';
    ctx.fillRect(-9, -4, 18, 8);
    ctx.fillStyle = '#f0e2c0';
    ctx.fillRect(-8, -5, 7.5, 7);
    ctx.fillRect(0.5, -5, 7.5, 7);
    ctx.strokeStyle = 'rgba(80,60,40,0.5)';
    ctx.lineWidth = 0.6;
    for (let k = -3; k <= 0; k += 1.6) {
      ctx.beginPath();
      ctx.moveTo(-7, k);
      ctx.lineTo(-1.5, k);
      ctx.moveTo(1.5, k);
      ctx.lineTo(7, k);
      ctx.stroke();
    }
    ctx.restore();
    if (!this.read) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.004 + this.tx);
      glow(ctx, x, by - 2, 22 + 6 * pulse, '#fff0c0', 0.35 + 0.2 * pulse);
      // a page drifting up and settling (the lore beckons)
      const ph = ((t * 0.0004 + this.ty * 0.3) % 1);
      ctx.save();
      ctx.globalAlpha *= Math.sin(ph * Math.PI) * 0.8;
      ctx.translate(x + Math.sin(ph * 6) * 5, by - 12 - ph * 18);
      ctx.rotate(Math.sin(ph * 9) * 0.5);
      ctx.fillStyle = '#fff4dc';
      ctx.fillRect(-3, -4, 6, 8);
      ctx.restore();
    }
  }
}

/** A talking NPC. */
export class NpcEntity extends TileEntity {
  constructor(def) {
    super(def);
    this.look = def.look ?? 'lamplighter';
    this.facing = def.facing ?? (hash2(def.x, def.y, 9) < 0.5 ? -1 : 1);
  }

  prompt() {
    return { verb: this.def.verb ?? 'Talk', label: this.def.name ?? NPC_LOOKS[this.look]?.name ?? '' };
  }

  get promptAt() {
    const air = this.look === 'gull' ? 30 : 0;
    return { x: this.x, y: this.y - 84 - air };
  }

  get solid() {
    if (this.look === 'gull') return null;
    return [this.tx * TILE + 9, this.ty * TILE + 16, (this.tx + 1) * TILE - 9, (this.ty + 1) * TILE - 4];
  }

  draw(ctx, t, player) {
    if (player && this.look !== 'gull') this.facing = player.x < this.x - 4 ? -1 : player.x > this.x + 4 ? 1 : this.facing;
    drawNpc(ctx, this.look, this.x, this.y, t, this.facing);
  }

  collect(out, t, player) {
    out.push({ y: this.y, kind: 'npc', ref: this, draw: (ctx) => this.draw(ctx, t, player) });
  }
}

/** Merchant (opens the shop). */
export class MerchantEntity extends NpcEntity {
  constructor(def) {
    super({ ...def, look: def.look ?? 'quist' });
  }

  prompt() {
    return { verb: 'Trade', label: NPC_LOOKS[this.look]?.name ?? 'Merchant' };
  }
}

/** The Training Mannequin with Drillmaster Hesper beside it. */
export class TrainerEntity extends TileEntity {
  constructor(def) {
    super(def);
    this.hx = this.x + 30;
    this.hy = this.y + 4;
    this.hit = 0;
  }

  prompt() {
    return { verb: 'Train', label: 'Training Mannequin' };
  }

  get promptAt() {
    return { x: this.x + 12, y: this.y - 92 };
  }

  get solid() {
    return [this.tx * TILE + 6, this.ty * TILE + 12, (this.tx + 1) * TILE + 26, (this.ty + 1) * TILE - 2];
  }

  collect(out, t, player) {
    out.push({ y: this.y, kind: 'trainer', ref: this, draw: (ctx) => drawActor(ctx, 'dummy', { x: this.x, y: this.y, scale: WORLD_SCALE, facing: 1, anim: 'idle', t }) });
    out.push({ y: this.hy, kind: 'npc', draw: (ctx) => drawNpc(ctx, 'hesper', this.hx, this.hy, t, player && player.x < this.hx ? -1 : 1) });
  }
}

/** Zone exit (gate). */
export class ExitEntity {
  constructor(def) {
    this.def = def;
    this.type = 'exit';
    this.id = def.id;
    this.tiles = exitTiles(def);
    const cx = def.x + (def.w ?? 1) / 2;
    const cy = def.y + (def.h ?? 1) / 2;
    this.x = cx * TILE;
    this.y = cy * TILE;
    this.open = true;
    this.openT = 1;
    this.reach = 54 + Math.max(def.w ?? 1, def.h ?? 1) * 20;
    this.edge = def.edge ?? 'east';
  }

  /** Rect covering the exit tiles (px). */
  get rect() {
    return [this.def.x * TILE, this.def.y * TILE, (this.def.x + (this.def.w ?? 1)) * TILE, (this.def.y + (this.def.h ?? 1)) * TILE];
  }

  get solid() {
    if (this.open) return null;
    return this.rect;
  }

  get focus() {
    return { x: this.x, y: this.y };
  }

  get promptAt() {
    return { x: this.x, y: this.y - 70 };
  }

  prompt() {
    return this.open ? { verb: 'Travel', label: this.def.label ?? '' } : { verb: 'Inspect', label: 'Sealed way' };
  }

  update(dt) {
    this.openT = this.open ? Math.min(1, this.openT + dt / 1200) : Math.max(0, this.openT - dt / 400);
  }

  collect(out, t) {
    out.push({ y: this.rect[3] - 4, kind: 'exit', ref: this, draw: (ctx) => this.draw(ctx, t) });
  }

  draw(ctx, t) {
    const [x0, y0, x1, y1] = this.rect;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const seal = 1 - this.openT;
    const vertical = (y1 - y0) > (x1 - x0);
    if (seal > 0.01) {
      // Gloam seal: violet-gold shimmer wall with turning clock hands
      ctx.save();
      ctx.globalAlpha *= seal;
      const len = vertical ? y1 - y0 : x1 - x0;
      for (let i = 0; i < 26; i++) {
        const u = i / 25;
        const px = vertical ? cx + Math.sin(t * 0.002 + i) * 6 : x0 + u * len;
        const py = vertical ? y0 + u * len : cy + Math.sin(t * 0.002 + i) * 6;
        glow(ctx, px, py - 20, 22, i % 2 ? '#8a5cc4' : '#e0b458', 0.28);
      }
      ctx.strokeStyle = 'rgba(210,170,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        const off = Math.sin(u * 14 + t * 0.004) * 5;
        const px = vertical ? cx + off : x0 + u * len;
        const py = vertical ? y0 + u * len - 20 : cy + off - 20;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // sigil
      ctx.translate(cx, cy - 26);
      ctx.strokeStyle = 'rgba(243,219,160,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, TAU);
      ctx.stroke();
      ctx.rotate(t * 0.001);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -11);
      ctx.moveTo(0, 0);
      ctx.rotate(2.2);
      ctx.lineTo(0, -7);
      ctx.stroke();
      ctx.restore();
    }
    if (this.openT > 0.01) {
      // open way: two lanterns and a faint golden draft of light
      ctx.save();
      ctx.globalAlpha *= this.openT;
      const pts = vertical ? [[cx, y0 + 6], [cx, y1 - 6]] : [[x0 + 6, cy], [x1 - 6, cy]];
      for (const [px, py] of pts) {
        ctx.fillStyle = '#3a281e';
        ctx.fillRect(px - 1.5, py - 44, 3, 44);
        dab(ctx, px, py - 46, 5, 6, 0, '#2a1c14');
        dab(ctx, px, py - 46, 3.4, 4.4, 0, '#ffd27a');
        glow(ctx, px, py - 46, 30 + 3 * Math.sin(t * 0.01 + px), '#ffb45a', 0.4);
      }
      const ph = (t * 0.0006) % 1;
      for (let i = 0; i < 5; i++) {
        const u = (ph + i / 5) % 1;
        const px = vertical ? cx + (this.edge === 'west' ? -u : u) * 30 : x0 + ((i * 37) % 100) / 100 * (x1 - x0);
        const py = vertical ? y0 + ((i * 29) % 100) / 100 * (y1 - y0) : cy + (this.edge === 'north' ? -u : u) * 30;
        sparkle(ctx, px, py - 10, 2.5, '#ffe9b0', Math.sin(u * Math.PI) * 0.8, 0);
      }
      ctx.restore();
    }
  }
}

/** Boss standing guard (triggers its pre-dialogue when approached). */
export class BossEntity {
  constructor(def, info) {
    this.def = def;
    this.type = 'boss';
    this.id = def.id;
    this.info = info;
    this.look = info.looks[0] ?? def.id;
    this.tx = def.x;
    this.ty = def.y;
    this.x = (def.x + 0.5) * TILE;
    this.y = (def.y + 0.8) * TILE;
    this.facing = -1;
    this.trigger = (def.trigger ?? 3.4) * TILE;
    this.scale = def.scale ?? BOSS_SCALE * (lookHeight(this.look) > 340 ? 0.9 : 1);
    this.alert = 0;
  }

  get solid() {
    return [this.x - 26, this.y - 22, this.x + 26, this.y + 6];
  }

  update(dt, player) {
    if (player) {
      this.facing = player.x < this.x ? -1 : 1;
      const d = Math.hypot(player.x - this.x, player.y - this.y);
      this.alert = clamp(1 - (d - this.trigger) / (5 * TILE), 0, 1);
    }
  }

  collect(out, t) {
    out.push({ y: this.y, kind: 'boss', ref: this, draw: (ctx) => this.draw(ctx, t) });
  }

  draw(ctx, t) {
    const x = this.x;
    const y = this.y;
    // ominous ground sigil
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.0025);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.42);
    ctx.strokeStyle = rgba('#b07aff', 0.2 + 0.25 * this.alert + 0.1 * pulse);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 70 + pulse * 6, 0, TAU);
    ctx.stroke();
    ctx.rotate(t * 0.0003);
    ctx.strokeStyle = rgba('#e0b458', 0.18 + 0.2 * this.alert);
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      ctx.rotate(TAU / 12);
      ctx.beginPath();
      ctx.moveTo(56, 0);
      ctx.lineTo(64, 0);
      ctx.stroke();
    }
    ctx.restore();
    drawActor(ctx, this.look, { x, y, scale: this.scale, facing: this.facing, anim: 'idle', t, aura: this.alert > 0.6 ? 'red' : null });
  }
}

/** Landmark prop (lighthouse, wreck, tent…) drawn by worldRender's prop painters. */
export class PropEntity {
  constructor(def) {
    this.def = def;
    this.type = 'prop';
    this.kind = def.kind;
    this.x = (def.x + 0.5) * TILE + (def.dx ?? 0);
    this.y = (def.y + 1) * TILE + (def.dy ?? 0);
    this.sortY = this.y + (def.sort ?? 0);
  }

  collect(out, t, player) {
    if (this.kind === 'figure') {
      const fx = this.def.flip ? -1 : 1;
      out.push({ y: this.sortY - 16, kind: 'prop', ref: this, draw: (ctx) => drawNpc(ctx, this.def.look ?? 'ghost', this.x, this.y - 16, t, fx) });
      return;
    }
    out.push({ y: this.sortY, kind: 'prop', ref: this, draw: (ctx) => drawProp(ctx, this.def, this.x, this.y, t, player) });
  }

  bounds() {
    return propBounds(this.def, this.x, this.y);
  }
}

// ═══════════════════════════════════════════════════════════════════════════ NPC figures

/**
 * NPC looks: coat colours, hat, accessories. Figures are ~66 px tall at world scale.
 */
export const NPC_LOOKS = {
  lamplighter: { name: 'Lamplighter', coat: '#2e5a5a', trim: '#c9a052', skin: '#e0b494', hair: '#d8d0c4', hat: 'brim', hatCol: '#2a2420', beard: true, prop: 'lanternPole', stoop: 0.06 },
  cartographer: { name: 'Cartographer', coat: '#9a6a2e', trim: '#f0d8a0', skin: '#d8a882', hair: '#5a3a24', hat: 'tricorn', hatCol: '#3a2a1e', glasses: true, prop: 'map', satchel: true },
  apprentice: { name: 'Apprentice', coat: '#e8dcc4', trim: '#7a4a2a', skin: '#e8c0a0', hair: '#8a4a24', hat: 'cap', hatCol: '#5a3a24', apron: '#7a5234', prop: 'sunToy', small: 0.84 },
  quist: { name: 'Pellam Quist', coat: '#5a2a4a', trim: '#e0b458', skin: '#dcae8c', hair: '#3a2a22', hat: 'top', hatCol: '#241a1e', prop: 'pack', moustache: true },
  orrery: { name: 'Madame Orrery', coat: '#2a4a6a', trim: '#e8c878', skin: '#c89272', hair: '#1e1614', hat: 'feather', hatCol: '#6a2a3a', shawl: '#c9a0e8', dress: true, prop: 'orb' },
  horologist: { name: 'The Horologist', coat: '#4a3a2a', trim: '#e8c16a', skin: '#e4bca0', hair: '#e8e4dc', hat: 'none', apron: '#6a4a2e', glasses: true, prop: 'loupe', beard: true },
  hesper: { name: 'Drillmaster Hesper', coat: '#8a2a26', trim: '#e8c060', skin: '#d8a888', hair: '#c8c0b8', hat: 'bun', epaulettes: true, prop: 'cane', tall: 1.06 },
  ghost: { name: 'Lost expeditioner', coat: '#f3dba0', trim: '#fff3c2', skin: '#fff0d0', hair: '#f3dba0', hat: 'brim', hatCol: '#f3dba0', ghost: true },
  ghost2: { name: 'Lost expeditioner', coat: '#e8c890', trim: '#fff3c2', skin: '#fff0d0', hair: '#f3dba0', hat: 'none', ghost: true, dress: true },
  gull: { name: 'Frozen gull', gull: true },
};

const _npcCache = new Map();

/** Draw an NPC at feet (x, y). */
export function drawNpc(ctx, look, x, y, t, facing = 1) {
  const L = NPC_LOOKS[look] ?? NPC_LOOKS.lamplighter;
  if (L.gull) {
    drawGull(ctx, x, y, t);
    return;
  }
  const spr = npcSprite(look, L);
  const breathe = 1 + Math.sin(t * 0.0022 + x * 0.01) * 0.012;
  if (!L.ghost) softShadow(ctx, x - 3, y + 1, 17, 6, 0.55);
  ctx.save();
  ctx.translate(x, y);
  if (facing < 0) ctx.scale(-1, 1);
  ctx.scale(1, breathe);
  if (L.ghost) {
    ctx.globalAlpha *= 0.42 + 0.08 * Math.sin(t * 0.0015 + x);
    ctx.globalCompositeOperation = 'lighter';
  }
  if (spr) ctx.drawImage(spr.canvas, -spr.ax, -spr.ay, spr.w, spr.h);
  ctx.restore();
  // animated accessory light
  const s = L.small ?? L.tall ?? 1;
  if (L.prop === 'lanternPole') {
    const fl = 0.85 + 0.15 * Math.sin(t * 0.019) * Math.sin(t * 0.007);
    const lx = x + 20 * facing;
    glow(ctx, lx, y - 74, 46 * fl, '#ffb45a', 0.5);
    glow(ctx, lx, y - 74, 12, '#fff0c0', 0.7 * fl);
  } else if (L.prop === 'sunToy') {
    glow(ctx, x + 11 * facing * s, y - 36 * s, 20, '#ffd27a', 0.55 + 0.15 * Math.sin(t * 0.004));
  } else if (L.prop === 'orb') {
    glow(ctx, x + 12 * facing, y - 38, 18, '#b89cff', 0.5 + 0.2 * Math.sin(t * 0.003));
  } else if (L.ghost) {
    glow(ctx, x, y - 40, 34, '#ffe0a0', 0.12);
  }
}

function npcSprite(key, L) {
  if (_npcCache.has(key)) return _npcCache.get(key);
  const W = 80;
  const H = 100;
  const ax = 40;
  const ay = 94;
  const q = 2;
  const c = makeCanvas(W * q, H * q);
  let spr = null;
  if (c) {
    const g = c.getContext('2d');
    g.scale(q, q);
    g.translate(ax, ay);
    paintFigure(g, L);
    spr = { canvas: c, w: W, h: H, ax, ay };
  }
  _npcCache.set(key, spr);
  return spr;
}

/** Paint a standing figure (feet at 0,0, facing right). */
function paintFigure(g, L) {
  const s = L.small ?? L.tall ?? 1;
  g.save();
  g.scale(s, s);
  const coat = L.coat;
  const lit = shade(coat, 0.3);
  const dark = shade(coat, -0.45);
  const ink = 'rgba(21,14,12,0.55)';
  const stoop = L.stoop ?? 0;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // boots
  dab(g, -5, -2.5, 4.4, 2.6, 0, '#2a1c16');
  dab(g, 5, -2.5, 4.4, 2.6, 0, '#2a1c16');
  // legs
  g.fillStyle = shade('#3a2e2a', 0.05);
  g.fillRect(-7, -20, 5.5, 18);
  g.fillRect(1.5, -20, 5.5, 18);
  // coat / dress body
  const hemW = L.dress ? 17 : 13;
  const hemY = L.dress ? -2 : -14;
  g.beginPath();
  g.moveTo(-9 + stoop * 20, -47);
  g.quadraticCurveTo(-13, -30, -hemW, hemY);
  g.quadraticCurveTo(0, hemY + 3, hemW, hemY);
  g.quadraticCurveTo(13, -30, 9 + stoop * 20, -47);
  g.closePath();
  const gr = g.createLinearGradient(-14, 0, 14, 0);
  gr.addColorStop(0, dark);
  gr.addColorStop(0.55, coat);
  gr.addColorStop(1, lit);
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = 1;
  g.stroke();
  // coat opening + trim
  g.strokeStyle = L.trim;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(1 + stoop * 20, -46);
  g.quadraticCurveTo(0, -30, 1, hemY + 1);
  g.stroke();
  for (let k = 0; k < 4; k++) dab(g, 3 + stoop * 12, -42 + k * 7, 1, 1, 0, L.trim);
  if (L.apron) {
    g.fillStyle = L.apron;
    g.beginPath();
    g.moveTo(-6, -36);
    g.lineTo(6, -36);
    g.lineTo(8, hemY + 1);
    g.lineTo(-8, hemY + 1);
    g.closePath();
    g.fill();
  }
  if (L.shawl) {
    g.fillStyle = rgba(L.shawl, 0.9);
    g.beginPath();
    g.moveTo(-10, -47);
    g.quadraticCurveTo(0, -30, 10, -47);
    g.quadraticCurveTo(0, -40, -10, -47);
    g.fill();
  }
  // belt
  if (!L.dress) {
    g.fillStyle = '#2a1c14';
    g.fillRect(-11, -26, 22, 3);
    dab(g, 1, -24.5, 1.8, 1.5, 0, '#e0b458');
  }
  if (L.satchel) {
    g.strokeStyle = '#4a3020';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-8, -46);
    g.lineTo(9, -24);
    g.stroke();
    g.fillStyle = '#6a4a2e';
    g.fillRect(6, -26, 9, 8);
  }
  if (L.prop === 'pack') {
    // trinket pack behind the shoulders
    g.fillStyle = '#6a4a2e';
    g.beginPath();
    g.roundRect(-20, -58, 14, 30, 4);
    g.fill();
    g.fillStyle = '#c9a052';
    g.fillRect(-21, -50, 16, 2);
    dab(g, -13, -61, 5, 3, 0, '#8a6a4a');
    dab(g, -18, -40, 3, 3, 0, '#e0b458');
    dab(g, -9, -35, 2.4, 2.4, 0, '#9fd9f0');
  }
  if (L.epaulettes) {
    dab(g, -9, -46, 4, 2, 0, L.trim);
    dab(g, 9, -46, 4, 2, 0, L.trim);
  }
  // arms (sleeves)
  const sleeve = (x0, y0, x1, y1) => {
    g.strokeStyle = dark;
    g.lineWidth = 5.4;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo((x0 + x1) / 2 + 2, (y0 + y1) / 2, x1, y1);
    g.stroke();
    g.strokeStyle = coat;
    g.lineWidth = 3.4;
    g.stroke();
    dab(g, x1, y1 + 1, 2.4, 2.4, 0, L.skin);
  };
  sleeve(-9 + stoop * 20, -44, -11, -28);
  const handX = L.prop === 'map' ? 9 : L.prop === 'cane' ? 13 : L.prop === 'lanternPole' ? 16 : 11;
  const handY = L.prop === 'map' ? -36 : L.prop === 'sunToy' || L.prop === 'orb' || L.prop === 'loupe' ? -35 : -29;
  sleeve(9 + stoop * 20, -44, handX, handY);
  // head
  const hx = 1 + stoop * 26;
  const hy = -55;
  dab(g, hx, hy + 5, 3.2, 3, 0, shade(L.skin, -0.2)); // neck
  const hg = g.createRadialGradient(hx + 2, hy - 2, 1, hx, hy, 8);
  hg.addColorStop(0, shade(L.skin, 0.2));
  hg.addColorStop(1, shade(L.skin, -0.25));
  g.fillStyle = hg;
  g.beginPath();
  g.ellipse(hx, hy, 6.4, 7.2, 0, 0, TAU);
  g.fill();
  // hair
  g.fillStyle = L.hair;
  g.beginPath();
  g.ellipse(hx - 1.5, hy - 3, 6.6, 5, -0.2, Math.PI * 0.95, Math.PI * 2.1);
  g.fill();
  if (L.hat === 'bun') dab(g, hx - 4, hy - 7, 3.6, 3.4, 0, L.hair);
  if (L.beard) {
    g.fillStyle = L.hair;
    g.beginPath();
    g.ellipse(hx + 1, hy + 4.5, 4.6, 4, 0, 0, Math.PI);
    g.fill();
  }
  if (L.moustache) brush(g, hx + 0.5, hy + 2.6, 6, 1.8, 0, L.hair);
  // eye
  dab(g, hx + 3, hy - 0.5, 0.9, 1.1, 0, '#1e1410');
  if (L.glasses) {
    g.strokeStyle = '#e0c070';
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(hx + 3, hy - 0.5, 2, 0, TAU);
    g.stroke();
  }
  // hats
  const hc = L.hatCol ?? '#2a2420';
  if (L.hat === 'brim') {
    dab(g, hx, hy - 5, 11, 2.6, -0.05, hc);
    g.fillStyle = hc;
    g.beginPath();
    g.roundRect(hx - 5.5, hy - 13, 11, 8, 3);
    g.fill();
    g.fillStyle = rgba(L.trim, 0.8);
    g.fillRect(hx - 5.5, hy - 7.5, 11, 1.6);
  } else if (L.hat === 'top') {
    dab(g, hx, hy - 5, 9.5, 2.4, 0, hc);
    g.fillStyle = hc;
    g.fillRect(hx - 5, hy - 19, 10, 14);
    g.fillStyle = L.trim;
    g.fillRect(hx - 5, hy - 8.5, 10, 2);
    g.fillStyle = 'rgba(255,240,220,0.25)';
    g.fillRect(hx + 2.5, hy - 18, 1.4, 12);
  } else if (L.hat === 'tricorn') {
    g.fillStyle = hc;
    g.beginPath();
    g.moveTo(hx - 10, hy - 5);
    g.quadraticCurveTo(hx, hy - 16, hx + 10, hy - 5);
    g.quadraticCurveTo(hx, hy - 8, hx - 10, hy - 5);
    g.fill();
  } else if (L.hat === 'cap') {
    g.fillStyle = hc;
    g.beginPath();
    g.ellipse(hx - 0.5, hy - 5, 6.8, 4.2, 0, Math.PI, TAU);
    g.fill();
    dab(g, hx + 5, hy - 4.5, 4, 1.4, 0, hc);
  } else if (L.hat === 'feather') {
    dab(g, hx, hy - 5.5, 10, 2.4, -0.1, hc);
    g.fillStyle = hc;
    g.beginPath();
    g.ellipse(hx, hy - 8, 5.5, 4, 0, Math.PI, TAU);
    g.fill();
    brush(g, hx - 3, hy - 8, 16, 3.4, -2.3, '#f0e8d8');
  }
  // accessories in hand
  if (L.prop === 'lanternPole') {
    g.strokeStyle = '#3a281e';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(handX, handY + 22);
    g.lineTo(handX + 2, -78);
    g.stroke();
    g.strokeStyle = '#3a281e';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(handX + 2, -78);
    g.quadraticCurveTo(handX + 6, -82, handX + 6, -76);
    g.stroke();
    g.fillStyle = '#2a1c14';
    g.fillRect(handX + 2.5, -76, 7, 9);
    g.fillStyle = '#ffd27a';
    g.fillRect(handX + 3.5, -75, 5, 7);
  } else if (L.prop === 'map') {
    g.fillStyle = '#efe0bc';
    g.beginPath();
    g.moveTo(3, -40);
    g.lineTo(20, -43);
    g.lineTo(21, -31);
    g.lineTo(4, -29);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(120,80,40,0.7)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(7, -36);
    g.quadraticCurveTo(12, -40, 17, -34);
    g.stroke();
    dab(g, 14, -37, 1.2, 1.2, 0, '#a3302a');
  } else if (L.prop === 'sunToy') {
    dab(g, handX, handY - 2, 4.4, 4.4, 0, '#e0b458');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      brush(g, handX + Math.cos(a) * 5, handY - 2 + Math.sin(a) * 5, 2.6, 1.2, a, '#e0b458');
    }
  } else if (L.prop === 'orb') {
    dab(g, handX + 1, handY - 3, 4.6, 4.6, 0, '#8a6ac4');
    dab(g, handX, handY - 4.4, 1.6, 1.6, 0, '#f0e8ff');
  } else if (L.prop === 'loupe') {
    g.strokeStyle = '#e8c16a';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(handX + 2, handY - 3, 3.2, 0, TAU);
    g.stroke();
  } else if (L.prop === 'cane') {
    g.strokeStyle = '#2a1c14';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(handX, handY);
    g.lineTo(handX + 3, -1);
    g.stroke();
    dab(g, handX, handY, 1.8, 1.8, 0, '#e0b458');
  }
  // sunlit rim along the right side
  g.strokeStyle = 'rgba(255,236,196,0.45)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(9.5 + stoop * 20, -45);
  g.quadraticCurveTo(12.5, -30, hemW - 0.5, hemY - 0.5);
  g.stroke();
  g.restore();
}

/** The gull frozen in mid-squawk, a metre above the sand. */
function drawGull(ctx, x, y, t) {
  const air = 38;
  softShadow(ctx, x - 2, y + 1, 16, 5, 0.35);
  const tremble = Math.sin(t * 0.05) * 0.15;
  ctx.save();
  ctx.translate(x, y - air + tremble);
  // wings spread
  ctx.fillStyle = '#e8e4dc';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-12, -12, -26, -6);
  ctx.quadraticCurveTo(-14, -4, -4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.quadraticCurveTo(14, -14, 27, -10);
  ctx.quadraticCurveTo(15, -4, 5, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5a5a60';
  brush(ctx, -26, -6, 8, 3, 0.3, '#4a4a52');
  brush(ctx, 27, -10, -8, 3, -0.3, '#4a4a52');
  // body
  dab(ctx, 1, 2, 9, 4.6, 0.1, '#f5f2ec');
  dab(ctx, 9, -1, 4, 3.6, 0, '#f5f2ec');
  // open beak
  ctx.fillStyle = '#f0b040';
  ctx.beginPath();
  ctx.moveTo(12, -2);
  ctx.lineTo(18, -4);
  ctx.lineTo(12.5, -0.5);
  ctx.lineTo(18, 1);
  ctx.lineTo(12, 0.5);
  ctx.fill();
  dab(ctx, 10, -2, 0.8, 0.8, 0, '#1e1410');
  ctx.restore();
  // a few droplets hanging in the air around it
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3;
    sparkle(ctx, x + Math.cos(a) * 22, y - air + Math.sin(a) * 12, 1.8, '#eafaf4', 0.6, 0);
  }
}
