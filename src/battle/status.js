// Status effects for Expedition 69 battles: the closed STATUS_DEFS table (SPEC §3.2) plus pure helpers to
// apply, refresh, remove, tick and query statuses stored on a combatant as `statuses: [{ id, turns, fresh }]`.
// HP changes from ticks are only *described* here; the battle model applies them (practice floors, KO, logs).

import { isStatusImmune } from './passives.js';

/**
 * @typedef {{ id: string, name: string, positive: boolean, desc: string, defaultTurns: number }} StatusDef
 * @typedef {{ id: string, turns: number, fresh?: boolean }} StatusEntry
 */

/** Closed status table. `positive` statuses are buffs (removed by dispel), the rest debuffs (removed by cleanse). */
export const STATUS_DEFS = Object.freeze({
  burn: {
    id: 'burn', name: 'Burn', positive: false, defaultTurns: 3,
    desc: 'Loses 5% of max HP at the start of each turn (1.5% for bosses).',
  },
  chill: { id: 'chill', name: 'Chill', positive: false, defaultTurns: 2, desc: 'Speed reduced to 75%.' },
  mark: {
    id: 'mark', name: 'Mark', positive: false, defaultTurns: 3,
    desc: 'The next damaging hit taken deals 50% more damage, then the mark fades.',
  },
  powerful: { id: 'powerful', name: 'Powerful', positive: true, defaultTurns: 3, desc: 'Attack increased by 25%.' },
  shell: { id: 'shell', name: 'Shell', positive: true, defaultTurns: 3, desc: 'Damage taken reduced by 30%.' },
  haste: { id: 'haste', name: 'Haste', positive: true, defaultTurns: 3, desc: 'Speed increased by 30%.' },
  slow: { id: 'slow', name: 'Slow', positive: false, defaultTurns: 2, desc: 'Speed reduced to 70%.' },
  weakened: { id: 'weakened', name: 'Weakened', positive: false, defaultTurns: 2, desc: 'Attack reduced by 25%.' },
  defenseless: {
    id: 'defenseless', name: 'Defenceless', positive: false, defaultTurns: 2, desc: 'Damage taken increased by 25%.',
  },
  stun: { id: 'stun', name: 'Stun', positive: false, defaultTurns: 1, desc: 'Skips the next turn.' },
  regen: {
    id: 'regen', name: 'Regen', positive: true, defaultTurns: 3, desc: 'Recovers 8% of max HP at the start of each turn.',
  },
  silence: {
    id: 'silence', name: 'Silence', positive: false, defaultTurns: 2,
    desc: 'Cannot use skills or Prism skills (attacks, items and Free Aim still work).',
  },
});

/** All status ids, in table order. */
export const STATUS_IDS = Object.freeze(Object.keys(STATUS_DEFS));

/** Burn tick: fraction of max HP lost at turn start (bosses use BURN_PCT_BOSS). */
export const BURN_PCT = 0.05;
export const BURN_PCT_BOSS = 0.015;
/** Regen tick: fraction of max HP healed at turn start. */
export const REGEN_PCT = 0.08;

/** @param {string} id @returns {boolean} */
export function isStatusId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(STATUS_DEFS, id);
}

/** @returns {boolean} whether the combatant currently has the status */
export function hasStatus(c, id) {
  return Array.isArray(c?.statuses) && c.statuses.some((s) => s.id === id);
}

/** @returns {StatusEntry|null} */
export function getStatus(c, id) {
  return (Array.isArray(c?.statuses) && c.statuses.find((s) => s.id === id)) || null;
}

/** @returns {number} remaining turns (0 when absent) */
export function statusTurns(c, id) {
  return getStatus(c, id)?.turns ?? 0;
}

/** @returns {string[]} status ids currently on the combatant (HUD helper) */
export function statusIds(c) {
  return Array.isArray(c?.statuses) ? c.statuses.map((s) => s.id) : [];
}

/**
 * Whether a status can be applied. Reasons: 'unknown' id, 'ko' target, 'resist' (enemy statusResist),
 * 'immune' (statusImmune passive).
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canReceiveStatus(c, id) {
  if (!isStatusId(id)) return { ok: false, reason: 'unknown' };
  if (!c || !c.alive) return { ok: false, reason: 'ko' };
  if (Array.isArray(c.statusResist) && c.statusResist.includes(id)) return { ok: false, reason: 'resist' };
  if (isStatusImmune(c, id)) return { ok: false, reason: 'immune' };
  return { ok: true };
}

/**
 * Applies (or refreshes) a status. Refresh sets duration to max(current, new).
 * `fresh` marks a status applied during the bearer's own turn, so the end of that same turn does not
 * consume one of its turns.
 * @param {object} c combatant
 * @param {string} id status id
 * @param {number} [turns] defaults to STATUS_DEFS[id].defaultTurns
 * @param {{ fresh?: boolean }} [opts]
 * @returns {{ applied: boolean, turns: number, refreshed: boolean, reason?: string }}
 */
export function applyStatus(c, id, turns, { fresh = false } = {}) {
  const check = canReceiveStatus(c, id);
  if (!check.ok) return { applied: false, turns: 0, refreshed: false, reason: check.reason };
  const raw = typeof turns === 'number' && Number.isFinite(turns) ? turns : STATUS_DEFS[id].defaultTurns;
  const n = Math.max(1, Math.round(raw));
  if (!Array.isArray(c.statuses)) c.statuses = [];
  const cur = getStatus(c, id);
  if (cur) {
    if (n >= cur.turns && fresh) cur.fresh = true;
    cur.turns = Math.max(cur.turns, n);
    return { applied: true, turns: cur.turns, refreshed: true };
  }
  c.statuses.push({ id, turns: n, fresh: !!fresh });
  return { applied: true, turns: n, refreshed: false };
}

/** Removes a status. @returns {boolean} whether it was present */
export function removeStatus(c, id) {
  if (!Array.isArray(c?.statuses)) return false;
  const i = c.statuses.findIndex((s) => s.id === id);
  if (i < 0) return false;
  c.statuses.splice(i, 1);
  return true;
}

/** Removes every status (KO). @returns {string[]} removed ids */
export function clearStatuses(c) {
  const ids = statusIds(c);
  if (c) c.statuses = [];
  return ids;
}

/** Removes all negative statuses. @returns {string[]} removed ids */
export function cleanseStatuses(c) {
  return removeWhere(c, (s) => !STATUS_DEFS[s.id]?.positive);
}

/** Removes all positive statuses. @returns {string[]} removed ids */
export function dispelStatuses(c) {
  return removeWhere(c, (s) => !!STATUS_DEFS[s.id]?.positive);
}

function removeWhere(c, pred) {
  if (!Array.isArray(c?.statuses)) return [];
  const removed = [];
  c.statuses = c.statuses.filter((s) => {
    if (pred(s)) {
      removed.push(s.id);
      return false;
    }
    return true;
  });
  return removed;
}

/**
 * Describes start-of-turn ticks (burn damage, regen healing). Does not mutate HP.
 * @param {object} c combatant
 * @param {{ boss?: boolean }} [opts] bosses burn for 1.5% instead of 5%
 * @returns {{ status: string, kind: 'damage'|'heal', amount: number }[]}
 */
export function tickStartOfTurn(c, { boss = !!c?.boss } = {}) {
  if (!c || !c.alive) return [];
  const maxHp = c.stats?.maxHp ?? 1;
  const out = [];
  if (hasStatus(c, 'burn')) {
    out.push({ status: 'burn', kind: 'damage', amount: Math.max(1, Math.round(maxHp * (boss ? BURN_PCT_BOSS : BURN_PCT))) });
  }
  if (hasStatus(c, 'regen')) {
    out.push({ status: 'regen', kind: 'heal', amount: Math.max(1, Math.round(maxHp * REGEN_PCT)) });
  }
  return out;
}

/**
 * End-of-turn duration tick: every status except `stun` (consumed by the skipped turn) loses one turn;
 * statuses applied during this same turn (`fresh`) are spared once. Expired statuses are removed.
 * @returns {string[]} expired status ids
 */
export function tickEndOfTurn(c) {
  if (!Array.isArray(c?.statuses)) return [];
  const expired = [];
  c.statuses = c.statuses.filter((s) => {
    if (s.id === 'stun') return true;
    if (s.fresh) {
      s.fresh = false;
      return true;
    }
    s.turns -= 1;
    if (s.turns <= 0) {
      expired.push(s.id);
      return false;
    }
    return true;
  });
  return expired;
}
