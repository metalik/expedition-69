// Conditional-turn-battle (CTB) helpers (SPEC §3.2): initiative rolls, effective speed (haste/slow/chill),
// advancing time to the next actor and a pure, non-mutating forecast of upcoming turns for the HUD.
// Time advances in exact fractional ticks: all living combatants gain effectiveSpd per unit of time and the
// first to reach TURN_THRESHOLD acts (ties → higher speed, then party first, then slot order).

/** Initiative needed to act; the actor then subtracts it. */
export const TURN_THRESHOLD = 100;
/** Initiative bonus for the side that ambushes. */
export const AMBUSH_BONUS = 60;
/** Initial initiative = rng.int(0, INITIATIVE_ROLL_MAX) + spd (+ ambush bonus). */
export const INITIATIVE_ROLL_MAX = 30;
/** Speed multipliers from statuses. */
export const SPEED_MULTS = Object.freeze({ haste: 1.3, slow: 0.7, chill: 0.75 });

const EPS = 1e-9;
const tidy = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Product of speed multipliers for a status list.
 * @param {{id:string}[]} statuses
 */
export function speedMultiplier(statuses) {
  let m = 1;
  if (Array.isArray(statuses)) for (const s of statuses) if (SPEED_MULTS[s.id]) m *= SPEED_MULTS[s.id];
  return m;
}

/** effectiveSpd = spd × haste 1.3 × slow 0.7 × chill 0.75 (at least 1). */
export function effectiveSpd(c) {
  return Math.max(1, (c?.stats?.spd ?? 1) * speedMultiplier(c?.statuses));
}

/**
 * Initial initiative roll: integer 0..30 + spd + bonus. Uses only rng.next().
 * @param {object} c combatant
 * @param {{next:()=>number}} rng
 * @param {number} [bonus] e.g. AMBUSH_BONUS
 */
export function rollInitiative(c, rng, bonus = 0) {
  const roll = Math.min(INITIATIVE_ROLL_MAX, Math.floor(rng.next() * (INITIATIVE_ROLL_MAX + 1)));
  return roll + (c?.stats?.spd ?? 0) + bonus;
}

/** Time until an entry reaches the threshold (≤ 0 when already ready; more negative = reached earlier). */
function timeToReady(e) {
  return (TURN_THRESHOLD - e.init) / e.effSpd;
}

/**
 * Sort comparator for "who acts first": earliest to reach the threshold, then higher effective speed,
 * then party before enemies, then lower slot.
 * @param {{init:number, effSpd:number, side:string, slot:number}} a
 * @param {{init:number, effSpd:number, side:string, slot:number}} b
 */
export function compareTurnPriority(a, b) {
  const d = timeToReady(a) - timeToReady(b);
  if (Math.abs(d) > EPS) return d;
  if (Math.abs(a.effSpd - b.effSpd) > EPS) return b.effSpd - a.effSpd;
  if (a.side !== b.side) return a.side === 'party' ? -1 : 1;
  return (a.slot ?? 0) - (b.slot ?? 0);
}

/**
 * Advances CTB time to the next actor (mutates every living combatant's `initiative`) and subtracts the
 * threshold from the actor. KO'd combatants neither gain initiative nor act.
 * @param {object[]} combatants
 * @returns {object|null} the combatant whose turn it is
 */
export function advanceToNext(combatants) {
  const entries = [];
  for (const c of combatants) {
    if (!c.alive) continue;
    entries.push({ c, init: c.initiative ?? 0, effSpd: effectiveSpd(c), side: c.side, slot: c.slot });
  }
  if (entries.length === 0) return null;
  let first = entries[0];
  for (const e of entries) if (compareTurnPriority(e, first) < 0) first = e;
  const dt = Math.max(0, timeToReady(first));
  if (dt > 0) {
    for (const e of entries) e.c.initiative = tidy(e.init + e.effSpd * dt);
    first.c.initiative = TURN_THRESHOLD;
  }
  first.c.initiative = tidy(first.c.initiative - TURN_THRESHOLD);
  return first.c;
}

/** Decrements speed statuses at the end of a simulated turn (mirrors status.tickEndOfTurn). */
function simEndOfTurn(entry) {
  entry.statuses = entry.statuses.filter((s) => {
    if (s.fresh) {
      s.fresh = false;
      return true;
    }
    s.turns -= 1;
    return s.turns > 0;
  });
}

/**
 * Pure forecast of the next `n` turns: exactly the ids successive advanceToNext() calls would return if no
 * other state changed, including haste/slow/chill expiring at the end of the bearer's turns.
 * @param {object[]} combatants
 * @param {number} [n=8]
 * @param {{ currentActorId?: string|null }} [opts] an actor whose turn is in progress (its statuses still
 *   tick at the end of that turn)
 * @returns {string[]}
 */
export function forecastTurns(combatants, n = 8, { currentActorId = null } = {}) {
  const sim = [];
  for (const c of combatants) {
    if (!c.alive) continue;
    sim.push({
      id: c.id,
      init: c.initiative ?? 0,
      spd: c.stats?.spd ?? 1,
      side: c.side,
      slot: c.slot,
      effSpd: 1,
      statuses: (c.statuses ?? []).filter((s) => SPEED_MULTS[s.id]).map((s) => ({ id: s.id, turns: s.turns, fresh: !!s.fresh })),
    });
  }
  if (currentActorId) {
    const cur = sim.find((e) => e.id === currentActorId);
    if (cur) simEndOfTurn(cur);
  }
  const out = [];
  for (let i = 0; i < n && sim.length > 0; i++) {
    for (const e of sim) e.effSpd = Math.max(1, e.spd * speedMultiplier(e.statuses));
    let first = sim[0];
    for (const e of sim) if (compareTurnPriority(e, first) < 0) first = e;
    const dt = Math.max(0, timeToReady(first));
    if (dt > 0) {
      for (const e of sim) e.init = tidy(e.init + e.effSpd * dt);
      first.init = TURN_THRESHOLD;
    }
    first.init = tidy(first.init - TURN_THRESHOLD);
    out.push(first.id);
    simEndOfTurn(first);
  }
  return out;
}
