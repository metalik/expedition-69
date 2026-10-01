// RPG progression math for Expedition 69: XP curve, level-ups, attribute-derived stats, relic stat bonuses and
// echo capacity (SPEC §3.3, §3.4, §4.9). Pure — no DOM, no storage, no randomness.

import { CHARACTERS } from '../data/characters.js';
import { RELICS } from '../data/relics.js';

/** Level cap. */
export const MAX_LEVEL = 20;

/** Attribute ids, in menu order. */
export const ATTRS = ['vitality', 'might', 'agility', 'defense', 'luck'];

/** Attribute points granted per level-up. */
export const ATTR_POINTS_PER_LEVEL = 3;

/** Hard cap on total crit chance. */
export const MAX_CRIT = 0.6;

/** Display info for attributes: what each point is worth. */
export const ATTR_INFO = {
  vitality: { id: 'vitality', name: 'Vitality', short: 'VIT', stat: 'maxHp', perPoint: 25, desc: '+25 max HP per point.' },
  might: { id: 'might', name: 'Might', short: 'MGT', stat: 'atk', perPoint: 3, desc: '+3 ATK per point.' },
  agility: { id: 'agility', name: 'Agility', short: 'AGI', stat: 'spd', perPoint: 1.5, desc: '+1.5 SPD per point — act more often.' },
  defense: { id: 'defense', name: 'Defence', short: 'DEF', stat: 'def', perPoint: 2.5, desc: '+2.5 DEF per point — take less damage from every hit.' },
  luck: { id: 'luck', name: 'Luck', short: 'LCK', stat: 'crit', perPoint: 0.01, desc: '+1% critical-hit chance per point (total crit caps at 60%).' },
};

const FALLBACK_CHAR = {
  base: { hp: 300, atk: 30, def: 15, spd: 40, crit: 0.05 },
  growth: { hp: 0, atk: 0, def: 0, spd: 0 },
};
const warned = new Set();
function charDef(id) {
  const c = typeof id === 'string' && Object.hasOwn(CHARACTERS, id) ? CHARACTERS[id] : null;
  if (c) return c;
  if (!warned.has(id)) {
    warned.add(id);
    if (typeof console !== 'undefined') console.warn(`[progression] unknown character id "${id}" — using fallback stats`);
  }
  return FALLBACK_CHAR;
}

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * XP needed to advance from `level` to `level + 1`: round(60 × level^1.6).
 * @param {number} level
 * @returns {number}
 */
export function xpToNext(level) {
  const L = Math.max(1, Math.floor(num(level, 1)));
  return Math.round(60 * Math.pow(L, 1.6));
}

/**
 * Total XP required to reach `level` from a fresh level-1 character.
 * @param {number} level
 * @returns {number}
 */
export function totalXpForLevel(level) {
  let total = 0;
  const L = Math.min(MAX_LEVEL, Math.max(1, Math.floor(num(level, 1))));
  for (let l = 1; l < L; l++) total += xpToNext(l);
  return total;
}

/**
 * Skill points granted on reaching `level` (+1, or +2 at levels 5, 10 and 15).
 * @param {number} level
 * @returns {number}
 */
export function spForLevel(level) {
  return level === 5 || level === 10 || level === 15 ? 2 : 1;
}

/**
 * Stats from base + level growth + attributes, before relic bonuses (unrounded components available through
 * statBreakdown). Values are rounded to integers (crit to 3 decimals, capped at MAX_CRIT).
 * @param {{id:string, level:number, attrs?:Object}} member
 * @returns {{maxHp:number, atk:number, def:number, spd:number, crit:number}}
 */
export function baseStats(member) {
  const b = statBreakdown(member, { relics: {} });
  return { maxHp: b.maxHp.total, atk: b.atk.total, def: b.def.total, spd: b.spd.total, crit: b.crit.total };
}

/**
 * Sum of flat stat bonuses from a member's equipped relics.
 * @param {{relics?:Array<string|null>}} member
 * @param {{relics?:Object}} [opts]  Relic table (defaults to RELICS).
 * @returns {{hp:number, atk:number, def:number, spd:number, crit:number}}
 */
export function relicStatBonus(member, { relics = RELICS } = {}) {
  const out = { hp: 0, atk: 0, def: 0, spd: 0, crit: 0 };
  const list = Array.isArray(member?.relics) ? member.relics : [];
  const seen = new Set();
  for (const id of list) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const r = typeof id === 'string' && relics && Object.hasOwn(relics, id) ? relics[id] : null;
    if (!r || !r.stats) continue;
    for (const k of Object.keys(out)) out[k] += num(r.stats[k]);
  }
  out.crit = round3(out.crit);
  return out;
}

/**
 * Per-stat breakdown: base (level-1 value), growth (levels gained), attrs (attribute points), relics, total.
 * @param {{id:string, level:number, attrs?:Object, relics?:Array<string|null>}} member
 * @param {{relics?:Object}} [opts]
 * @returns {Record<'maxHp'|'atk'|'def'|'spd'|'crit', {base:number, growth:number, attrs:number, relics:number, total:number}>}
 */
export function statBreakdown(member, { relics = RELICS } = {}) {
  const c = charDef(member?.id);
  const L = Math.min(MAX_LEVEL, Math.max(1, Math.floor(num(member?.level, 1))));
  const a = member?.attrs ?? {};
  const bonus = relicStatBonus(member, { relics });
  const lv = L - 1;
  const mk = (base, growth, attrs, rel, digits = 0) => {
    const total = base + growth + attrs + rel;
    return {
      base,
      growth: digits ? round3(growth) : Math.round(growth),
      attrs: digits ? round3(attrs) : Math.round(attrs),
      relics: rel,
      total: digits ? round3(total) : Math.round(total),
    };
  };
  const maxHp = mk(c.base.hp, lv * num(c.growth.hp), num(a.vitality) * 25, bonus.hp);
  const atk = mk(c.base.atk, lv * num(c.growth.atk), num(a.might) * 3, bonus.atk);
  const def = mk(c.base.def, lv * num(c.growth.def), num(a.defense) * 2.5, bonus.def);
  const spd = mk(c.base.spd, lv * num(c.growth.spd), num(a.agility) * 1.5, bonus.spd);
  const crit = mk(c.base.crit, 0, num(a.luck) * 0.01, bonus.crit, 3);
  crit.total = Math.min(MAX_CRIT, crit.total);
  maxHp.total = Math.max(1, maxHp.total);
  atk.total = Math.max(1, atk.total);
  def.total = Math.max(0, def.total);
  spd.total = Math.max(1, spd.total);
  crit.total = Math.max(0, crit.total);
  return { maxHp, atk, def, spd, crit };
}

/**
 * Effective stats of a party member including flat relic bonuses (SPEC §3.3).
 *   maxHp = base.hp + (L−1)×growth.hp + vitality×25 (+ relic hp)
 *   atk   = base.atk + (L−1)×growth.atk + might×3 (+ relic atk)
 *   def   = base.def + (L−1)×growth.def + defense×2.5 (+ relic def)
 *   spd   = base.spd + (L−1)×growth.spd + agility×1.5 (+ relic spd)
 *   crit  = min(0.6, base.crit + luck×0.01 (+ relic crit))
 * @param {{id:string, level:number, attrs?:Object, relics?:Array<string|null>}} member
 * @param {{relics?:Object}} [opts]  Relic table override (pass {} to ignore relics).
 * @returns {{maxHp:number, atk:number, def:number, spd:number, crit:number}}
 */
export function derivedStats(member, { relics = RELICS } = {}) {
  const b = statBreakdown(member, { relics });
  return { maxHp: b.maxHp.total, atk: b.atk.total, def: b.def.total, spd: b.spd.total, crit: b.crit.total };
}

/**
 * Adds XP to a member, applying every level-up it triggers (mutates the member). Each level grants
 * +3 attribute points and +1 SP (+2 at levels 5/10/15); current HP rises by the max-HP gained.
 * At MAX_LEVEL further XP is discarded.
 * @param {{id:string, level:number, xp:number, attrPoints:number, sp:number, hp?:number, alive?:boolean}} member
 * @param {number} amount
 * @param {{relics?:Object}} [opts]
 * @returns {Array<{level:number, attrPoints:number, sp:number}>}  One entry per level gained.
 */
export function grantXp(member, amount, { relics = RELICS } = {}) {
  const ups = [];
  if (!member) return ups;
  const gain = Math.max(0, Math.floor(num(amount)));
  member.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(num(member.level, 1))));
  member.xp = Math.max(0, Math.floor(num(member.xp)));
  member.attrPoints = Math.max(0, Math.floor(num(member.attrPoints)));
  member.sp = Math.max(0, Math.floor(num(member.sp)));
  if (member.level >= MAX_LEVEL) {
    member.xp = 0;
    return ups;
  }
  const beforeMax = derivedStats(member, { relics }).maxHp;
  member.xp += gain;
  while (member.level < MAX_LEVEL && member.xp >= xpToNext(member.level)) {
    member.xp -= xpToNext(member.level);
    member.level += 1;
    const sp = spForLevel(member.level);
    member.attrPoints += ATTR_POINTS_PER_LEVEL;
    member.sp += sp;
    ups.push({ level: member.level, attrPoints: ATTR_POINTS_PER_LEVEL, sp });
  }
  if (member.level >= MAX_LEVEL) member.xp = 0;
  if (ups.length && member.alive !== false && typeof member.hp === 'number' && member.hp > 0) {
    const afterMax = derivedStats(member, { relics }).maxHp;
    member.hp = Math.min(afterMax, Math.max(1, Math.round(member.hp + (afterMax - beforeMax))));
  }
  return ups;
}

/**
 * Echo capacity of a character: 4 + level.
 * @param {number} level
 * @returns {number}
 */
export function echoCapacity(level) {
  return 4 + Math.max(1, Math.floor(num(level, 1)));
}

/**
 * Total echo cost currently equipped by a member.
 * @param {{echoes?:string[]}} member
 * @param {{relics?:Object}} [opts]
 * @returns {number}
 */
export function echoLoad(member, { relics = RELICS } = {}) {
  const list = Array.isArray(member?.echoes) ? member.echoes : [];
  let load = 0;
  const seen = new Set();
  for (const id of list) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (typeof id === 'string' && relics && Object.hasOwn(relics, id)) load += num(relics[id].echoCost);
  }
  return load;
}
