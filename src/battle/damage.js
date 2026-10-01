// Damage & healing formulas for Expedition 69 (SPEC §3.2): attack/mitigation, affinities, crits, QTE ratings,
// Sable's stance multipliers, statuses, passive multipliers, difficulty and variance. Pure; randomness only
// through the injected RNG's next() (crit roll first, then variance).

import {
  dealtMultiplier,
  takenMultiplier,
  critVsBrokenBonus,
  critDamageBonus,
  perfectPowerMult,
  healPowerMult,
} from './passives.js';

/** Base critical multiplier (critDamage passives add to it). */
export const BASE_CRIT_MULT = 1.5;
/** Offensive QTE damage multipliers by rating (kept local: the model must not import qte.js). */
export const QTE_MULTIPLIERS = Object.freeze({ perfect: 1.4, good: 1.15, miss: 1.0 });
/** Sable's stance modifiers. */
export const STANCE_MODS = Object.freeze({
  neutral: Object.freeze({ dealt: 1, taken: 1 }),
  assault: Object.freeze({ dealt: 1.4, taken: 1.2 }),
  guard: Object.freeze({ dealt: 0.85, taken: 0.65 }),
  virtuoso: Object.freeze({ dealt: 2.0, taken: 1.25 }),
});
/** Status multipliers used by the formula. */
export const STATUS_DAMAGE_MULTS = Object.freeze({ powerful: 1.25, weakened: 0.75, defenseless: 1.25, shell: 0.7, mark: 1.5 });
/** Uniform damage variance range. */
export const VARIANCE = Object.freeze({ min: 0.95, max: 1.05 });

const has = (c, id) => Array.isArray(c?.statuses) && c.statuses.some((s) => s.id === id);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Affinity of a target to an element: weak (>1), resist (0<x<1), immune (0) or neutral.
 * @returns {{ mult: number, label: 'weak'|'resist'|'immune'|null }}
 */
export function affinityOf(target, element) {
  const v = target?.affinities?.[element];
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 1) return { mult: 1, label: null };
  if (v <= 0) return { mult: 0, label: 'immune' };
  return { mult: v, label: v > 1 ? 'weak' : 'resist' };
}

/** @returns {string|null} the combatant's stance id, or null if it has no stance mechanic */
export function stanceOf(c) {
  return c?.mechanic?.type === 'stance' ? c.mechanic.value || 'neutral' : null;
}

/** Stance damage-dealt multiplier (1 without a stance). */
export function stanceDealtMult(c) {
  const s = stanceOf(c);
  return s ? STANCE_MODS[s]?.dealt ?? 1 : 1;
}

/** Stance damage-taken multiplier (1 without a stance). */
export function stanceTakenMult(c) {
  const s = stanceOf(c);
  return s ? STANCE_MODS[s]?.taken ?? 1 : 1;
}

/** atk × powerful 1.25 × weakened 0.75. */
export function effectiveAtk(c) {
  let atk = num(c?.stats?.atk, 0);
  if (has(c, 'powerful')) atk *= STATUS_DAMAGE_MULTS.powerful;
  if (has(c, 'weakened')) atk *= STATUS_DAMAGE_MULTS.weakened;
  return atk;
}

/** 100 / (100 + max(0, def)). */
export function mitigation(def) {
  return 100 / (100 + Math.max(0, num(def, 0)));
}

/**
 * Offensive QTE multiplier: perfect 1.4 (× perfectPower), good 1.15, otherwise 1.
 * @param {'perfect'|'good'|'miss'|null} rating
 * @param {number} [perfectMult]
 */
export function qteMultiplier(rating, perfectMult = 1) {
  if (rating === 'perfect') return QTE_MULTIPLIERS.perfect * perfectMult;
  if (rating === 'good') return QTE_MULTIPLIERS.good;
  return 1;
}

/** Crit chance of attacker vs target including skill bonus and critVsBroken. */
export function critChance(attacker, target, bonus = 0) {
  return clamp01(num(attacker?.stats?.crit, 0) + num(bonus, 0) + critVsBrokenBonus(attacker, target));
}

/**
 * Everything in the formula except crit and variance (shared by computeDamage and expectedDamage).
 * @returns {{ base: number, affinity: {mult:number,label:string|null}, marked: boolean, critMult: number }}
 */
function baseDamage(ctx) {
  const {
    attacker, target, power = 1, element = 'physical', qteRating = null, critMult = null,
    mult = 1, kind = null, dmgTakenMult = 1, qteMult = null,
  } = ctx;
  const affinity = affinityOf(target, element);
  const marked = has(target, 'mark');
  const q = typeof qteMult === 'number' ? qteMult : qteMultiplier(qteRating, perfectPowerMult(attacker));
  const base =
    power *
    effectiveAtk(attacker) *
    mitigation(target?.stats?.def) *
    affinity.mult *
    q *
    stanceDealtMult(attacker) *
    stanceTakenMult(target) *
    (has(target, 'defenseless') ? STATUS_DAMAGE_MULTS.defenseless : 1) *
    (has(target, 'shell') ? STATUS_DAMAGE_MULTS.shell : 1) *
    (marked ? STATUS_DAMAGE_MULTS.mark : 1) *
    dealtMultiplier(attacker, { element, kind }) *
    takenMultiplier(target) *
    (target?.side === 'party' ? num(dmgTakenMult, 1) : 1) *
    num(mult, 1);
  return { base, affinity, marked, critMult: num(critMult, BASE_CRIT_MULT) + critDamageBonus(attacker) };
}

/**
 * Computes one hit's damage (SPEC §3.2). Does not mutate anything (the caller consumes `mark`).
 * @param {object} ctx
 * @param {object} ctx.attacker combatant
 * @param {object} ctx.target combatant
 * @param {number} ctx.power hit power
 * @param {string} [ctx.element='physical']
 * @param {{next:()=>number}} [ctx.rng] needed for crit rolls and variance (omit → no crit, variance 1)
 * @param {'perfect'|'good'|'miss'|null} [ctx.qteRating]
 * @param {number} [ctx.critBonus] extra crit chance (skill critBonus)
 * @param {boolean} [ctx.forceCrit] guaranteed crit (crit weak point)
 * @param {boolean} [ctx.noCrit] cannot crit (shots)
 * @param {number} [ctx.critMult] base crit multiplier override (crit weak point: 2)
 * @param {number} [ctx.mult] extra multipliers (weak point, bonusVs, firstStrike …)
 * @param {string} [ctx.kind] 'attack'|'skill'|'gradient'|'shot'|'counter'|'riposte'|'enemy'
 * @param {number} [ctx.dmgTakenMult] difficulty multiplier, applied only when the target is on the party side
 * @param {boolean} [ctx.variance=true]
 * @returns {{ amount: number, crit: boolean, affinity: 'weak'|'resist'|'immune'|null, marked: boolean }}
 */
export function computeDamage(ctx) {
  const { attacker, target, power = 1, rng = null, critBonus = 0, forceCrit = false, noCrit = false, variance = true } = ctx;
  if (!attacker || !target || !(num(power, 0) > 0)) return { amount: 0, crit: false, affinity: null, marked: false };
  const b = baseDamage(ctx);
  if (b.affinity.mult === 0) return { amount: 0, crit: false, affinity: 'immune', marked: false };
  let crit = false;
  if (forceCrit) crit = true;
  else if (!noCrit && rng) crit = rng.next() < critChance(attacker, target, critBonus);
  let dmg = b.base * (crit ? b.critMult : 1);
  if (variance && rng) dmg *= VARIANCE.min + rng.next() * (VARIANCE.max - VARIANCE.min);
  return { amount: Math.max(1, Math.round(dmg)), crit, affinity: b.affinity.label, marked: b.marked };
}

/**
 * Expected (mean) damage of a hit, without rolling: crit is averaged, variance is 1.
 * Accepts the same ctx as computeDamage plus `qteMult` (an expected QTE multiplier). Used by bots/AI.
 * @returns {number}
 */
export function expectedDamage(ctx) {
  const { attacker, target, power = 1, critBonus = 0, forceCrit = false, noCrit = false } = ctx;
  if (!attacker || !target || !(num(power, 0) > 0)) return 0;
  const b = baseDamage(ctx);
  if (b.affinity.mult === 0) return 0;
  const p = forceCrit ? 1 : noCrit ? 0 : critChance(attacker, target, critBonus);
  return b.base * (1 - p + p * b.critMult);
}

/**
 * Heal amount: `pct × target maxHp` or `power × healer atk × 0.5`, × healer's healPower passives, rounded.
 * @param {{ healer?: object, target: object, pct?: number, power?: number }} ctx
 * @returns {number}
 */
export function computeHeal({ healer = null, target, pct = null, power = null } = {}) {
  if (!target) return 0;
  let base = 0;
  if (typeof pct === 'number' && Number.isFinite(pct)) base = pct * num(target.stats?.maxHp, 0);
  else if (typeof power === 'number' && Number.isFinite(power) && healer) base = power * effectiveAtk(healer) * 0.5;
  if (healer) base *= healPowerMult(healer);
  return base > 0 ? Math.max(1, Math.round(base)) : 0;
}
