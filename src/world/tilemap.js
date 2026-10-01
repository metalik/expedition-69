// Tile maps for Expedition 69's exploration: generic tile types, ASCII map parsing, box collision with
// sliding, BFS helpers (reachability, flow fields, nearest walkable tile) and whole-world validation.
// Pure (no DOM access), so the map validator also runs in Node.

/** Tile size in world px (SPEC §3.6). */
export const TILE = 40;

/**
 * Generic tile types. A map's legend maps ASCII characters to these ids; each zone's renderer decides the
 * look (sand vs leaf litter vs brass plates for `ground`, sea vs pond for `deep`, …).
 *  - stack:   continuous terrain layer with an elevation `level` (higher levels are painted over lower ones)
 *  - overlay: painted over the terrain it sits on (base level is inferred from neighbours)
 *  - raised:  extruded mass (cliff / wall / ruin) with a south face `faceH` px tall
 *  - tall:    drawn as a y-sorted sprite (trees, pillars…) so it can hide the player
 *  - shape:   collision footprint inside the tile: full | trunk | round | pillar
 */
export const TILE_TYPES = {
  deep: { id: 'deep', walk: false, stack: true, level: 0, water: true, shape: 'full' },
  void: { id: 'void', walk: false, stack: true, level: 0, abyss: true, shape: 'full' },
  shallow: { id: 'shallow', walk: true, stack: true, level: 1, water: true },
  wet: { id: 'wet', walk: true, stack: true, level: 2 },
  ground: { id: 'ground', walk: true, stack: true, level: 3 },
  grass: { id: 'grass', walk: true, stack: true, level: 4 },
  path: { id: 'path', walk: true, overlay: true },
  flowers: { id: 'flowers', walk: true, overlay: true },
  planks: { id: 'planks', walk: true, overlay: true, deck: true },
  bridge: { id: 'bridge', walk: true, overlay: true, deck: true },
  stone: { id: 'stone', walk: true, overlay: true },
  gear: { id: 'gear', walk: true, overlay: true },
  dial: { id: 'dial', walk: true, overlay: true },
  stairs: { id: 'stairs', walk: true, overlay: true },
  cliff: { id: 'cliff', walk: false, raised: true, faceH: 24, shape: 'full' },
  wall: { id: 'wall', walk: false, raised: true, faceH: 34, shape: 'full' },
  ruin: { id: 'ruin', walk: false, raised: true, faceH: 22, shape: 'full' },
  rock: { id: 'rock', walk: false, shape: 'round' },
  tree: { id: 'tree', walk: false, tall: true, shape: 'trunk' },
  bush: { id: 'bush', walk: false, tall: true, shape: 'round' },
  pillar: { id: 'pillar', walk: false, tall: true, shape: 'pillar' },
  machine: { id: 'machine', walk: false, tall: true, shape: 'full' },
};

/** Collision footprints as fractions of a tile [x0, y0, x1, y1]. */
export const SHAPES = {
  full: [0, 0, 1, 1],
  trunk: [0.2, 0.42, 0.8, 0.98],
  round: [0.1, 0.18, 0.9, 0.92],
  pillar: [0.14, 0.28, 0.86, 1],
};

/** How far (px) a raised tile's collision reaches below it, so feet never overlap its painted south face. */
export const FACE_COLLISION = 0.55;

const TYPE_IDS = Object.keys(TILE_TYPES);
const TYPE_INDEX = Object.fromEntries(TYPE_IDS.map((id, i) => [id, i]));
const OUT = TYPE_INDEX.void;

/** Entity types that occupy (block) their own tile. */
export const BLOCKING_ENTITIES = new Set(['chest', 'flag', 'npc', 'merchant', 'trainer', 'journal', 'boss']);
/** Entity types the player interacts with via `confirm`. */
export const INTERACTIVE_ENTITIES = new Set(['chest', 'flag', 'npc', 'merchant', 'trainer', 'journal', 'exit']);

/**
 * A parsed tile map with collision and search helpers. Coordinates: tiles (tx, ty) are integers; world
 * positions are px (tile * TILE).
 */
export class TileMap {
  /**
   * @param {{id?:string, tiles:string[], legend:Record<string,string>, entities?:object[]}} def
   * @param {string} [zone]
   */
  constructor(def, zone = def?.id ?? 'unknown') {
    this.def = def;
    this.zone = zone;
    const rows = Array.isArray(def?.tiles) ? def.tiles : [];
    this.h = rows.length;
    this.w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    this.pxW = this.w * TILE;
    this.pxH = this.h * TILE;
    this.grid = new Uint8Array(Math.max(1, this.w * this.h)).fill(OUT);
    this.unknownChars = new Set();
    const legend = def?.legend ?? {};
    for (let y = 0; y < this.h; y++) {
      const row = rows[y];
      for (let x = 0; x < this.w; x++) {
        const ch = row[x] ?? ' ';
        const id = legend[ch];
        if (id && Object.hasOwn(TYPE_INDEX, id)) this.grid[y * this.w + x] = TYPE_INDEX[id];
        else {
          this.unknownChars.add(ch);
          this.grid[y * this.w + x] = OUT;
        }
      }
    }
    /** Extra blocked tiles (entities, barriers): Set of y*w+x. */
    this.blockers = new Set();
    this._computeLevels();
  }

  /** Type id at a tile ('void' outside the map). */
  typeAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 'void';
    return TYPE_IDS[this.grid[ty * this.w + tx]];
  }

  /** Type definition at a tile. */
  tileAt(tx, ty) {
    return TILE_TYPES[this.typeAt(tx, ty)];
  }

  /** Terrain walkability (ignores entity blockers). */
  isWalkableTerrain(tx, ty) {
    return !!this.tileAt(tx, ty).walk;
  }

  /** Walkable terrain and not blocked by an entity. */
  isWalkable(tx, ty) {
    return this.isWalkableTerrain(tx, ty) && !this.blockers.has(ty * this.w + tx);
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  /** Mark a tile as blocked by an entity (true) or clear it (false). */
  setBlocked(tx, ty, on = true) {
    if (!this.inBounds(tx, ty)) return;
    const k = ty * this.w + tx;
    if (on) this.blockers.add(k);
    else this.blockers.delete(k);
  }

  /**
   * Solid rectangle of a tile in world px ([x0, y0, x1, y1]) or null when passable.
   * Raised tiles extend a little below themselves when their south neighbour is lower.
   */
  solidRect(tx, ty) {
    const t = this.tileAt(tx, ty);
    const k = ty * this.w + tx;
    const entityBlocked = this.inBounds(tx, ty) && this.blockers.has(k);
    if (t.walk && !entityBlocked) return null;
    const x = tx * TILE;
    const y = ty * TILE;
    if (!t.walk) {
      const s = SHAPES[t.shape ?? 'full'] ?? SHAPES.full;
      let y1 = y + s[3] * TILE;
      if (t.raised) {
        const below = this.tileAt(tx, ty + 1);
        if (!below.raised) y1 += Math.round((t.faceH ?? 20) * FACE_COLLISION);
      }
      return [x + s[0] * TILE, y + s[1] * TILE, x + s[2] * TILE, y1];
    }
    // entity-blocked walkable tile: a slightly inset box
    return [x + 3, y + 6, x + TILE - 3, y + TILE - 2];
  }

  /**
   * True if the axis-aligned box overlaps any solid tile or any of `extra` rects.
   * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
   * @param {Array<number[]>} [extra]
   */
  boxBlocked(x0, y0, x1, y1, extra) {
    if (x0 < 0 || y0 < 0 || x1 > this.pxW || y1 > this.pxH) return true;
    const tx0 = Math.floor(x0 / TILE) - 1;
    const tx1 = Math.floor(x1 / TILE);
    const ty0 = Math.floor(y0 / TILE) - 1;
    const ty1 = Math.floor(y1 / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const r = this.solidRect(tx, ty);
        if (r && x1 > r[0] && x0 < r[2] && y1 > r[1] && y0 < r[3]) return true;
      }
    }
    if (extra) {
      for (const r of extra) if (r && x1 > r[0] && x0 < r[2] && y1 > r[1] && y0 < r[3]) return true;
    }
    return false;
  }

  /**
   * Move a feet box (centre x,y; half extents hw,hh) by (dx,dy) with axis-separated collision and corner
   * sliding (a blocked axis nudges the other axis around tile corners).
   * @returns {{x:number, y:number, blockedX:boolean, blockedY:boolean}}
   */
  moveBox(x, y, dx, dy, hw, hh, extra) {
    let blockedX = false;
    let blockedY = false;
    const free = (cx, cy) => !this.boxBlocked(cx - hw, cy - hh, cx + hw, cy + hh, extra);
    const stepAxis = (axis, d) => {
      if (!d) return false;
      const n = Math.max(1, Math.ceil(Math.abs(d) / 6));
      const sd = d / n;
      for (let i = 0; i < n; i++) {
        const nx = axis === 'x' ? x + sd : x;
        const ny = axis === 'y' ? y + sd : y;
        if (free(nx, ny)) {
          x = nx;
          y = ny;
        } else {
          // approach the obstacle pixel by pixel
          let lo = 0;
          let hi = 1;
          for (let k = 0; k < 5; k++) {
            const mid = (lo + hi) / 2;
            if (free(axis === 'x' ? x + sd * mid : x, axis === 'y' ? y + sd * mid : y)) lo = mid;
            else hi = mid;
          }
          if (axis === 'x') x += sd * lo;
          else y += sd * lo;
          return true;
        }
      }
      return false;
    };
    blockedX = stepAxis('x', dx);
    blockedY = stepAxis('y', dy);
    // corner sliding: when one axis is blocked and the other isn't moving, nudge around corners
    const nudge = (axis, d) => {
      const mag = Math.min(Math.abs(d), 2.5);
      for (const off of [3, 6, 9, 12, 15]) {
        for (const s of [-1, 1]) {
          const ox = axis === 'x' ? 0 : s * off;
          const oy = axis === 'y' ? 0 : s * off;
          const tx = x + ox + (axis === 'x' ? Math.sign(d) * 2 : 0);
          const ty = y + oy + (axis === 'y' ? Math.sign(d) * 2 : 0);
          if (free(x + ox, y + oy) && free(tx, ty)) {
            const nx = x + (axis === 'x' ? 0 : s * mag);
            const ny = y + (axis === 'y' ? 0 : s * mag);
            if (free(nx, ny)) {
              x = nx;
              y = ny;
            }
            return;
          }
        }
      }
    };
    if (blockedX && Math.abs(dy) < 0.01) nudge('x', dx);
    if (blockedY && Math.abs(dx) < 0.01) nudge('y', dy);
    return { x, y, blockedX, blockedY };
  }

  /**
   * Breadth-first distances (in tiles) from a start tile. Unreached = -1.
   * @param {number} sx @param {number} sy
   * @param {{maxDist?:number, diagonal?:boolean, passable?:(tx:number, ty:number)=>boolean}} [opts]
   * @returns {Int16Array}
   */
  bfs(sx, sy, { maxDist = 32767, diagonal = false, passable = null } = {}) {
    const w = this.w;
    const dist = new Int16Array(this.w * this.h).fill(-1);
    const pass = passable ?? ((tx, ty) => this.isWalkable(tx, ty));
    if (!this.inBounds(sx, sy)) return dist;
    const queue = new Int32Array(this.w * this.h);
    let head = 0;
    let tail = 0;
    dist[sy * w + sx] = 0;
    queue[tail++] = sy * w + sx;
    const dirs = diagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (head < tail) {
      const k = queue[head++];
      const cx = k % w;
      const cy = (k - cx) / w;
      const d = dist[k];
      if (d >= maxDist) continue;
      for (const [ox, oy] of dirs) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (!this.inBounds(nx, ny)) continue;
        const nk = ny * w + nx;
        if (dist[nk] !== -1 || !pass(nx, ny)) continue;
        if (ox && oy && (!pass(cx + ox, cy) || !pass(cx, cy + oy))) continue;
        dist[nk] = d + 1;
        queue[tail++] = nk;
      }
    }
    return dist;
  }

  /**
   * Nearest walkable tile (BFS over all tiles) to (tx, ty), or null. With `mask` (an Int16Array of BFS
   * distances, e.g. from reachableFrom), only tiles with mask ≥ 0 qualify.
   * @returns {{x:number, y:number}|null}
   */
  nearestWalkable(tx, ty, { maxDist = 40, mask = null } = {}) {
    const cx = Math.max(0, Math.min(this.w - 1, Math.floor(tx)));
    const cy = Math.max(0, Math.min(this.h - 1, Math.floor(ty)));
    const ok = (x, y) => this.isWalkable(x, y) && (!mask || mask[y * this.w + x] >= 0);
    if (ok(cx, cy)) return { x: cx, y: cy };
    const dist = this.bfs(cx, cy, { maxDist, passable: () => true });
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < 0) continue;
      const x = i % this.w;
      const y = (i - x) / this.w;
      if (!ok(x, y)) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
    return best;
  }

  /**
   * BFS distances from a tile over walkable terrain (entity blockers count as passable, so an NPC standing
   * in a corridor does not cut the map in two). Cached per start tile.
   * @returns {Int16Array}
   */
  reachableFrom(sx, sy) {
    const key = `${sx},${sy}`;
    if (this._reach?.key === key) return this._reach.dist;
    const dist = this.bfs(sx, sy, { passable: (x, y) => this.isWalkableTerrain(x, y) });
    this._reach = { key, dist };
    return dist;
  }

  /**
   * Stack elevation per tile for the renderer: stack tiles use their own level; overlays, raised and
   * tall tiles inherit the most common level among their stack neighbours (so a tree on the beach sits on
   * sand and a bridge over the sea sits on water).
   */
  _computeLevels() {
    const { w, h } = this;
    this.levels = new Int8Array(w * h);
    const own = (x, y) => {
      const t = this.tileAt(x, y);
      return t.stack ? t.level : -1;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const lv = own(x, y);
        if (lv >= 0) {
          this.levels[y * w + x] = lv;
          continue;
        }
        const counts = [0, 0, 0, 0, 0, 0];
        for (let r = 1; r <= 3; r++) {
          for (let oy = -r; oy <= r; oy++) {
            for (let ox = -r; ox <= r; ox++) {
              if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
              const l = own(x + ox, y + oy);
              if (l >= 0 && this.inBounds(x + ox, y + oy)) counts[l] += r === 1 ? 3 : 1;
            }
          }
          if (counts.some((c) => c > 0)) break;
        }
        const t = this.tileAt(x, y);
        let best = 3;
        let bc = -1;
        for (let l = 0; l < counts.length; l++) {
          // decks prefer the lowest neighbour (water under a bridge); others the highest common one
          const c = counts[l] + (t.deck ? (5 - l) * 0.01 : l * 0.01);
          if (c > bc && counts[l] > 0) {
            bc = c;
            best = l;
          }
        }
        if (t.raised || t.tall || t.id === 'rock') best = Math.max(best, t.id === 'tree' || t.id === 'bush' ? best : 3);
        if (!t.deck && best < 2 && (t.overlay || t.raised || t.id === 'rock')) best = Math.max(best, 2);
        this.levels[y * w + x] = best;
      }
    }
  }

  /** Stack level used by the renderer for a tile (clamped at the edges). */
  levelAt(tx, ty) {
    const x = Math.max(0, Math.min(this.w - 1, tx));
    const y = Math.max(0, Math.min(this.h - 1, ty));
    return this.levels[y * this.w + x];
  }
}

/**
 * Parse a map definition.
 * @param {object} def MAPS[zone]
 * @param {string} [zone]
 * @returns {TileMap}
 */
export function parseMap(def, zone) {
  return new TileMap(def, zone);
}

/** World px centre of a tile. */
export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}

/** Tile containing a world px position. */
export function worldToTile(x, y) {
  return { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
}

/**
 * Tiles an entity occupies for blocking purposes (props may declare a footprint).
 * @param {object} e map entity
 * @returns {Array<{x:number, y:number}>}
 */
export function entityFootprint(e) {
  if (e.type === 'prop') {
    const out = [];
    for (const [dx, dy, w = 1, h = 1] of e.solid ?? []) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push({ x: e.x + dx + x, y: e.y + dy + y });
    }
    return out;
  }
  if (BLOCKING_ENTITIES.has(e.type)) return [{ x: e.x, y: e.y }];
  return [];
}

/**
 * Tiles covered by an exit trigger.
 * @param {object} e exit entity {x, y, w?, h?}
 */
export function exitTiles(e) {
  const out = [];
  for (let y = 0; y < (e.h ?? 1); y++) for (let x = 0; x < (e.w ?? 1); x++) out.push({ x: e.x + x, y: e.y + y });
  return out;
}

/**
 * Camp no-aggro radius (tiles) around rest points and people: roaming Gloam never step inside, never notice the
 * party while it stands inside, and give up a chase at the edge. A map entity may override its radius with
 * `safe: r` (0 = none, e.g. the frozen gull).
 */
export const SAFE_RADIUS = Object.freeze({ flag: 3.5, merchant: 3, trainer: 3, npc: 2.5 });

/**
 * Camp safe zones of a map, centred on their entity tiles.
 * @param {{entities?:object[]}} def map definition
 * @returns {Array<{x:number, y:number, r:number, id:string|null, type:string}>} tile units
 */
export function safeZones(def) {
  const out = [];
  for (const e of def?.entities ?? []) {
    const r = Number.isFinite(e.safe) ? e.safe : SAFE_RADIUS[e.type];
    if (!(r > 0)) continue;
    out.push({ x: e.x + 0.5, y: e.y + 0.5, r, id: e.id ?? null, type: e.type });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── validation

/**
 * Validate every map against the game data (pure; data injected so this runs in Node and the browser).
 * Checks: rectangular rows and known legend characters; entities on walkable terrain; everything reachable
 * from the player start (BFS around blocking entities, with sealed exits closed); arrival points of every
 * exit walkable and reachable; referenced ids exist (encounters, journals, dialogues, shops, relics, shards,
 * bosses, looks); roaming patrols stay clear of the camp safe zones; per-zone counts (enemy spawns, pennants,
 * journals, chests); every chest-only relic placed once.
 * @param {Record<string, object>} maps MAPS
 * @param {{ENCOUNTERS:object, STORY:object, SHOPS:object, RELICS:object, UPGRADES:object, ENEMIES:object,
 *   STARTING_RELICS?:object, ZONES?:object}} data
 * @returns {{ok:boolean, errors:string[], warnings:string[], report:Record<string, object>, chestRelics:string[]}}
 */
export function validateWorld(maps, data) {
  const errors = [];
  const warnings = [];
  const report = {};
  const { ENCOUNTERS = {}, STORY = {}, SHOPS = {}, RELICS = {}, UPGRADES = {}, ENEMIES = {} } = data ?? {};
  const has = (o, k) => o && typeof k === 'string' && Object.hasOwn(o, k);
  const ids = new Set();
  const relicPlacements = {};
  const journalsSeen = {};

  // Relics that must come from chests: not starting, not boss drops, not sold.
  const starting = new Set(Object.values(data?.STARTING_RELICS ?? { gideon: 'riposte_pin', nyra: 'mending_quill', sable: 'opening_gambit' }));
  const bossDrops = new Set();
  for (const en of Object.values(ENEMIES)) if (en.boss) for (const d of en.drops ?? []) bossDrops.add(d.relic);
  const sold = new Set();
  for (const shop of Object.values(SHOPS)) for (const s of shop.stock ?? []) if (s.kind === 'relic') sold.add(s.id);
  const chestRelics = Object.keys(RELICS).filter((id) => !starting.has(id) && !bossDrops.has(id) && !sold.has(id)).sort();

  for (const [zone, def] of Object.entries(maps)) {
    const E = (m) => errors.push(`[${zone}] ${m}`);
    const W = (m) => warnings.push(`[${zone}] ${m}`);
    const rows = def.tiles ?? [];
    if (!rows.length) {
      E('no tiles');
      continue;
    }
    const width = rows[0].length;
    rows.forEach((r, i) => {
      if (r.length !== width) E(`row ${i} has length ${r.length}, expected ${width}`);
    });
    const map = new TileMap(def, zone);
    if (map.unknownChars.size) E(`unknown legend characters: ${[...map.unknownChars].map((c) => JSON.stringify(c)).join(' ')}`);
    for (const [ch, id] of Object.entries(def.legend ?? {})) if (!has(TILE_TYPES, id)) E(`legend ${JSON.stringify(ch)} → unknown tile type "${id}"`);

    const ents = def.entities ?? [];
    const player = ents.find((e) => e.type === 'player');
    if (!player) E('no player start entity');

    // Blockers
    for (const e of ents) {
      for (const f of entityFootprint(e)) map.setBlocked(f.x, f.y, true);
    }
    // Sealed exits block their tiles (validation assumes their boss is not yet beaten)
    const sealed = new Set();
    for (const e of ents) {
      if (e.type === 'exit' && e.requires?.boss) for (const t of exitTiles(e)) sealed.add(t.y * map.w + t.x);
    }

    const zones = safeZones(def);
    const counts = { enemy: 0, boss: 0, flag: 0, journal: 0, chest: 0, npc: 0, merchant: 0, trainer: 0, exit: 0, prop: 0 };
    for (const e of ents) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      const where = `${e.type}${e.id ? ` "${e.id}"` : ''}${e.kind ? ` (${e.kind})` : ''} @${e.x},${e.y}`;
      if (!Number.isInteger(e.x) || !Number.isInteger(e.y)) {
        E(`${where}: non-integer tile coordinates`);
        continue;
      }
      if (!map.inBounds(e.x, e.y)) {
        E(`${where}: outside the map`);
        continue;
      }
      if (e.type !== 'prop' && !map.isWalkableTerrain(e.x, e.y)) E(`${where}: on non-walkable tile "${map.typeAt(e.x, e.y)}"`);
      if (e.id && e.type !== 'prop' && e.type !== 'player') {
        const key = `${e.type}:${e.id}`;
        if (ids.has(key) && e.type !== 'npc') E(`${where}: duplicate id`);
        ids.add(key);
      }
      switch (e.type) {
        case 'enemy': {
          const reach = (e.patrol?.r ?? 2.5) + 0.75;
          for (const z of zones) {
            if (Math.hypot(e.x + 0.5 - z.x, e.y + 0.5 - z.y) < z.r + reach) E(`${where}: patrol reaches the safe camp around ${z.type} "${z.id}"`);
          }
          const enc = ENCOUNTERS[e.encounter];
          if (!enc) E(`${where}: unknown encounter "${e.encounter}"`);
          else {
            if (enc.boss) E(`${where}: roaming spawn uses boss encounter`);
            if (enc.zone !== zone && !(zone === 'summit' && enc.zone === 'spire')) W(`${where}: encounter zone ${enc.zone}`);
            if (e.tutorial && !enc.tutorial) E(`${where}: tutorial spawn with a non-tutorial encounter`);
          }
          if (e.later && !ENCOUNTERS[e.later]) E(`${where}: unknown later encounter "${e.later}"`);
          break;
        }
        case 'boss': {
          if (!ENEMIES[e.id]?.boss) E(`${where}: "${e.id}" is not a boss enemy`);
          if (!ENCOUNTERS[e.encounter]?.boss) E(`${where}: encounter "${e.encounter}" is not a boss encounter`);
          if (e.dialogue && !has(STORY.dialogues, e.dialogue)) E(`${where}: unknown dialogue "${e.dialogue}"`);
          if (e.postDialogue && !has(STORY.dialogues, e.postDialogue)) E(`${where}: unknown post dialogue "${e.postDialogue}"`);
          break;
        }
        case 'journal': {
          const j = STORY.journals?.[e.id];
          if (!j) E(`${where}: unknown journal`);
          else if (j.zone !== zone) E(`${where}: journal belongs to zone ${j.zone}`);
          journalsSeen[e.id] = (journalsSeen[e.id] ?? 0) + 1;
          break;
        }
        case 'npc':
          if (!has(STORY.dialogues, e.dialogue)) E(`${where}: unknown dialogue "${e.dialogue}"`);
          if (!e.look) W(`${where}: npc without look`);
          break;
        case 'merchant':
          if (!has(SHOPS, e.shopId)) E(`${where}: unknown shop "${e.shopId}"`);
          if (e.greet && !has(STORY.dialogues, e.greet)) E(`${where}: unknown greet dialogue "${e.greet}"`);
          break;
        case 'chest': {
          const l = e.loot ?? {};
          if (l.relic) {
            if (!has(RELICS, l.relic)) E(`${where}: unknown relic "${l.relic}"`);
            relicPlacements[l.relic] = (relicPlacements[l.relic] ?? 0) + 1;
          }
          if (l.shard && !has(UPGRADES, l.shard)) E(`${where}: unknown shard "${l.shard}"`);
          if (!l.relic && !l.shard && !(l.glint > 0) && !l.item) E(`${where}: empty loot`);
          break;
        }
        case 'exit': {
          const dest = maps[e.to];
          if (!dest) E(`${where}: unknown destination "${e.to}"`);
          else {
            const dm = new TileMap(dest, e.to);
            if (!dm.isWalkableTerrain(e.toX, e.toY)) E(`${where}: arrival ${e.toX},${e.toY} in ${e.to} is not walkable`);
          }
          if (e.requires?.boss && !ENEMIES[e.requires.boss]?.boss) E(`${where}: requires unknown boss "${e.requires.boss}"`);
          for (const t of exitTiles(e)) if (!map.isWalkableTerrain(t.x, t.y)) E(`${where}: exit tile ${t.x},${t.y} not walkable`);
          break;
        }
        case 'flag':
          if (!e.name) E(`${where}: pennant without name`);
          break;
        default:
          break;
      }
    }

    // Reachability from the start with sealed exits closed.
    if (player && map.inBounds(player.x, player.y)) {
      const dist = map.bfs(player.x, player.y, { passable: (x, y) => map.isWalkable(x, y) && !sealed.has(y * map.w + x) });
      const reach = (x, y) => map.inBounds(x, y) && dist[y * map.w + x] >= 0;
      const reachNear = (x, y) => [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([ox, oy]) => reach(x + ox, y + oy));
      for (const e of ents) {
        const where = `${e.type}${e.id ? ` "${e.id}"` : ''} @${e.x},${e.y}`;
        if (e.type === 'prop' || e.type === 'player') continue;
        if (e.type === 'exit') {
          const tiles = exitTiles(e);
          const ok = tiles.some((t) => (e.requires?.boss ? reachNear(t.x, t.y) : reach(t.x, t.y)));
          if (!ok) E(`${where}: exit not reachable`);
          continue;
        }
        if (BLOCKING_ENTITIES.has(e.type)) {
          if (!reachNear(e.x, e.y)) E(`${where}: no reachable tile next to it`);
        } else if (!reach(e.x, e.y)) E(`${where}: unreachable`);
      }
      // Unreachable walkable pockets (warn: may be intended scenery)
      let pockets = 0;
      for (let y = 0; y < map.h; y++) {
        for (let x = 0; x < map.w; x++) {
          if (map.isWalkable(x, y) && !reach(x, y) && !sealed.has(y * map.w + x)) pockets++;
        }
      }
      if (pockets) W(`${pockets} walkable tile(s) unreachable from the start (behind sealed exits or isolated)`);
      report[zone] = { ...counts, size: `${map.w}×${map.h}`, unreachable: pockets };
    } else {
      report[zone] = { ...counts, size: `${map.w}×${map.h}` };
    }

    if (zone !== 'summit') {
      if (counts.enemy < 10 || counts.enemy > 14) E(`${counts.enemy} roaming enemy spawns (want 10–14)`);
      if (counts.flag < 2 || counts.flag > 3) E(`${counts.flag} pennants (want 2–3)`);
      if (counts.journal !== 3) E(`${counts.journal} journals (want 3)`);
      if (counts.chest < 5 || counts.chest > 8) E(`${counts.chest} chests (want 5–8)`);
    } else if (counts.flag < 1) E('summit needs a pennant');
  }

  for (const id of chestRelics) {
    if (!relicPlacements[id]) errors.push(`[world] chest relic "${id}" is not placed in any chest`);
    else if (relicPlacements[id] > 1) errors.push(`[world] chest relic "${id}" is placed ${relicPlacements[id]} times`);
  }
  for (const id of Object.keys(relicPlacements)) {
    if (!chestRelics.includes(id)) warnings.push(`[world] chest relic "${id}" is also a starting relic, boss drop or shop item`);
  }
  for (const id of Object.keys(STORY.journals ?? {})) if (!journalsSeen[id]) errors.push(`[world] journal "${id}" is not placed`);
  const npcDialogues = Object.keys(STORY.dialogues ?? {}).filter((k) => k.startsWith('npc_'));
  const usedDialogues = new Set();
  for (const def of Object.values(maps)) {
    for (const e of def.entities ?? []) {
      if (e.dialogue) usedDialogues.add(e.dialogue);
      if (e.greet) usedDialogues.add(e.greet);
    }
  }
  for (const d of npcDialogues) if (!usedDialogues.has(d)) warnings.push(`[world] npc dialogue "${d}" is unused`);

  return { ok: errors.length === 0, errors, warnings, report, chestRelics };
}
