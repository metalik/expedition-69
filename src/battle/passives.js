// Passive (relic / echo) hook helpers for the battle model — implements the closed passive list of SPEC §3.4.
// Pure: every helper reads `combatant.passives` ([{ id, params, source }]) and returns a number, flag or list.
// Stacking: additive params (amounts, bonuses, pct) sum; multipliers multiply; chances combine as 1 − Π(1 − p).

/**
 * @typedef {{ id: string, params?: object, source?: string }} Passive
 */

const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
const times = (v) => `×${Number(v ?? 1).toFixed(2).replace(/\.?0+$/, '')}`;

/** Metadata for every passive id in the closed list (param names + a human description builder). */
export const PASSIVE_DEFS = Object.freeze({
  startAp: { params: ['amount'], describe: (p) => `Begin each battle with +${p.amount ?? 1} AP.` },
  parryAp: { params: ['amount'], describe: (p) => `Gain +${p.amount ?? 1} extra AP on every parry.` },
  parryHeal: { params: ['pct'], describe: (p) => `Heal ${pct(p.pct)} of max HP on every parry.` },
  perfectDodgeAp: { params: ['amount'], describe: (p) => `Gain +${p.amount ?? 1} AP on a perfect dodge.` },
  counterPower: { params: ['mult'], describe: (p) => `Counterattacks deal ${times(p.mult)} damage.` },
  basicStatus: {
    params: ['status', 'turns', 'chance'],
    describe: (p) => `Basic attacks have a ${pct(p.chance ?? 1)} chance to inflict ${p.status} (${p.turns ?? '?'} turns).`,
  },
  lowHpPower: {
    params: ['threshold', 'mult'],
    describe: (p) => `Deal ${times(p.mult)} damage while below ${pct(p.threshold)} HP.`,
  },
  secondWind: { params: [], describe: () => 'Once per battle, survive a lethal blow with 1 HP.' },
  turnHeal: { params: ['pct'], describe: (p) => `Recover ${pct(p.pct)} of max HP at the start of each turn.` },
  critVsBroken: {
    params: ['bonus'],
    describe: (p) => `+${pct(p.bonus)} critical chance against Broken or Defenceless foes.`,
  },
  critDamage: {
    params: ['bonus'],
    describe: (p) => `Critical multiplier +${p.bonus ?? 0} (×${(1.5 + num(p.bonus, 0)).toFixed(1)} instead of ×1.5).`,
  },
  breakPower: { params: ['mult'], describe: (p) => `Break damage ${times(p.mult)}.` },
  shotPower: { params: ['mult'], describe: (p) => `Free Aim shots deal ${times(p.mult)} damage.` },
  shotMark: { params: ['chance'], describe: (p) => `Free Aim shots have a ${pct(p.chance)} chance to Mark the target.` },
  firstStrike: { params: ['mult'], describe: (p) => `Your first damaging hit of each battle deals ${times(p.mult)} damage.` },
  gradientGain: { params: ['mult'], describe: (p) => `Prism gauge gains from your actions ${times(p.mult)}.` },
  glassCannon: {
    params: ['dealt', 'taken'],
    describe: (p) => `Deal ${times(p.dealt)} damage but take ${times(p.taken)} damage.`,
  },
  elementPower: { params: ['element', 'mult'], describe: (p) => `${cap(p.element)} damage ${times(p.mult)}.` },
  killAp: { params: ['amount'], describe: (p) => `Gain +${p.amount ?? 1} AP when landing a killing blow.` },
  statusImmune: { params: ['status'], describe: (p) => `Immune to ${p.status}.` },
  perfectPower: { params: ['mult'], describe: (p) => `Perfect QTE bonus ${times(p.mult)}.` },
  startStatus: {
    params: ['status', 'turns'],
    describe: (p) => `Begin each battle with ${p.status} (${p.turns ?? '?'} turns).`,
  },
  hurtAp: { params: ['amount'], describe: (p) => `Gain +${p.amount ?? 1} AP when hurt (once per enemy action).` },
  healPower: { params: ['mult'], describe: (p) => `Heals you perform are ${times(p.mult)} as strong.` },
});

/** The closed list of passive ids (SPEC §3.4). */
export const PASSIVE_IDS = Object.freeze(Object.keys(PASSIVE_DEFS));

function cap(s) {
  const str = String(s ?? '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function num(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/**
 * Human readable description of a passive, e.g. for tooltips.
 * @param {Passive} passive
 * @returns {string}
 */
export function describePassive(passive) {
  const def = passive && PASSIVE_DEFS[passive.id];
  return def ? def.describe(passive.params ?? {}) : '';
}

/** @param {string} id @returns {boolean} */
export function isPassiveId(id) {
  return Object.prototype.hasOwnProperty.call(PASSIVE_DEFS, id);
}

function sourceKey(source) {
  return typeof source === 'string' ? source.replace(/^(echo|relic)[:/]/, '') : null;
}

/**
 * Validates and de-duplicates a passive list: unknown ids are dropped, and two entries that come from the
 * same relic (e.g. the relic itself plus its own echo, `source` "x" / "echo:x") only count once.
 * @param {Passive[]} list
 * @returns {Passive[]} fresh copies
 */
export function normalizePassives(list) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || !isPassiveId(p.id)) continue;
    const key = sourceKey(p.source);
    if (key) {
      const k = `${p.id}|${key}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push({ id: p.id, params: { ...(p.params ?? {}) }, source: p.source ?? null });
  }
  return out;
}

/**
 * All param objects of a given passive id on a combatant.
 * @param {object} c combatant
 * @param {string} id passive id
 * @returns {object[]}
 */
export function passiveParams(c, id) {
  const list = c?.passives;
  if (!Array.isArray(list) || list.length === 0) return [];
  const out = [];
  for (const p of list) if (p && p.id === id) out.push(p.params ?? {});
  return out;
}

/** @returns {boolean} whether the combatant has at least one passive with that id */
export function hasPassive(c, id) {
  return passiveParams(c, id).length > 0;
}

function sum(c, id, key, dflt) {
  return passiveParams(c, id).reduce((s, p) => s + num(p[key], dflt), 0);
}

function prod(c, id, key) {
  return passiveParams(c, id).reduce((m, p) => m * num(p[key], 1), 1);
}

function chanceUnion(c, id, key) {
  const miss = passiveParams(c, id).reduce((m, p) => m * (1 - Math.min(1, Math.max(0, num(p[key], 0)))), 1);
  return 1 - miss;
}

const isStatusIdLike = (s) => typeof s === 'string' && s.length > 0;

// ---- Hooks -------------------------------------------------------------------------------------------

/** startAp: extra AP at battle start. */
export function startApBonus(c) { return sum(c, 'startAp', 'amount', 1); }
/** parryAp: extra AP per parry (on top of the base +1). */
export function parryApBonus(c) { return sum(c, 'parryAp', 'amount', 1); }
/** parryHeal: fraction of max HP healed per parry. */
export function parryHealPct(c) { return sum(c, 'parryHeal', 'pct', 0); }
/** perfectDodgeAp: AP gained on a perfect dodge. */
export function perfectDodgeApBonus(c) { return sum(c, 'perfectDodgeAp', 'amount', 1); }
/** counterPower: counterattack damage multiplier. */
export function counterPowerMult(c) { return prod(c, 'counterPower', 'mult'); }

/**
 * basicStatus: statuses a basic attack may inflict.
 * @returns {{status:string, turns:number|null, chance:number}[]}
 */
export function basicStatusList(c) {
  return passiveParams(c, 'basicStatus')
    .filter((p) => isStatusIdLike(p.status))
    .map((p) => ({ status: p.status, turns: num(p.turns, null), chance: Math.min(1, Math.max(0, num(p.chance, 1))) }));
}

/** lowHpPower: damage multiplier while hp/maxHp is below the threshold. */
export function lowHpDealtMult(c) {
  const maxHp = c?.stats?.maxHp || 1;
  const frac = (c?.hp ?? maxHp) / maxHp;
  return passiveParams(c, 'lowHpPower').reduce((m, p) => (frac < num(p.threshold, 0) ? m * num(p.mult, 1) : m), 1);
}

/** secondWind: survives one lethal hit per battle. */
export function hasSecondWind(c) { return hasPassive(c, 'secondWind'); }
/** turnHeal: fraction of max HP healed at the start of own turn. */
export function turnHealPct(c) { return sum(c, 'turnHeal', 'pct', 0); }

/** critVsBroken: extra crit chance vs a Broken or Defenseless target. */
export function critVsBrokenBonus(attacker, target) {
  if (!target) return 0;
  const vulnerable = !!target.broken || (Array.isArray(target.statuses) && target.statuses.some((s) => s.id === 'defenseless'));
  return vulnerable ? sum(attacker, 'critVsBroken', 'bonus', 0) : 0;
}

/** critDamage: added to the crit multiplier. */
export function critDamageBonus(c) { return sum(c, 'critDamage', 'bonus', 0); }
/** breakPower: break dealt multiplier. */
export function breakPowerMult(c) { return prod(c, 'breakPower', 'mult'); }
/** shotPower: free-aim damage multiplier. */
export function shotPowerMult(c) { return prod(c, 'shotPower', 'mult'); }
/** shotMark: chance that a shot marks its target. */
export function shotMarkChance(c) { return chanceUnion(c, 'shotMark', 'chance'); }
/** firstStrike: multiplier for the first damaging hit of the battle. */
export function firstStrikeMult(c) { return prod(c, 'firstStrike', 'mult'); }
/** gradientGain: gradient gained from this character's actions × mult. */
export function gradientGainMult(c) { return prod(c, 'gradientGain', 'mult'); }
/** glassCannon: dealt multiplier. */
export function glassCannonDealt(c) { return prod(c, 'glassCannon', 'dealt'); }
/** glassCannon: taken multiplier. */
export function glassCannonTaken(c) { return prod(c, 'glassCannon', 'taken'); }

/** elementPower: dealt multiplier for one element. */
export function elementPowerMult(c, element) {
  return passiveParams(c, 'elementPower').reduce((m, p) => (p.element === element ? m * num(p.mult, 1) : m), 1);
}

/** killAp: AP gained on a killing blow. */
export function killApBonus(c) { return sum(c, 'killAp', 'amount', 1); }

/** statusImmune: whether the combatant cannot receive `status`. */
export function isStatusImmune(c, status) {
  return passiveParams(c, 'statusImmune').some((p) => p.status === status);
}

/** perfectPower: multiplies the perfect-QTE damage multiplier. */
export function perfectPowerMult(c) { return prod(c, 'perfectPower', 'mult'); }

/**
 * startStatus: statuses applied at battle start.
 * @returns {{status:string, turns:number|null}[]}
 */
export function startStatusList(c) {
  return passiveParams(c, 'startStatus')
    .filter((p) => isStatusIdLike(p.status))
    .map((p) => ({ status: p.status, turns: num(p.turns, null) }));
}

/** hurtAp: AP gained when taking damage (the model limits it to once per enemy action). */
export function hurtApBonus(c) { return sum(c, 'hurtAp', 'amount', 1); }
/** healPower: heals performed × mult. */
export function healPowerMult(c) { return prod(c, 'healPower', 'mult'); }

/**
 * Combined passive damage-dealt multiplier for an attacker.
 * @param {object} attacker
 * @param {{ element?: string, kind?: string }} [opts] kind 'shot' adds shotPower, 'counter' adds counterPower
 * @returns {number}
 */
export function dealtMultiplier(attacker, { element = 'physical', kind = null } = {}) {
  let m = lowHpDealtMult(attacker) * glassCannonDealt(attacker) * elementPowerMult(attacker, element);
  if (kind === 'shot') m *= shotPowerMult(attacker);
  if (kind === 'counter') m *= counterPowerMult(attacker);
  return m;
}

/** Combined passive damage-taken multiplier for a target. */
export function takenMultiplier(target) {
  return glassCannonTaken(target);
}
