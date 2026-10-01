// Pure battle model for Expedition 69 (SPEC §3.1–3.4, §4.7): CTB turns, the AP economy, party actions resolved
// hit-by-hit with offensive QTE ratings, enemy action plans resolved per defensive outcome, counters, gradient
// ripostes, statuses, shields/break, boss phases, character mechanics, practice mode, rewards and a battle log.
// All data is injected (`data`), all randomness comes from the injected RNG (only rng.next() is used).
// State is applied inside the model; every mutating call returns plain event objects for the scene to animate.

import {
  STATUS_DEFS,
  applyStatus,
  removeStatus,
  hasStatus,
  clearStatuses,
  cleanseStatuses,
  dispelStatuses,
  tickStartOfTurn,
  tickEndOfTurn,
} from './status.js';
import { computeDamage, computeHeal } from './damage.js';
import { AMBUSH_BONUS, rollInitiative, advanceToNext, forecastTurns } from './turnOrder.js';
import { chooseEnemyAction, randomPick } from './ai.js';
import * as P from './passives.js';

// ---- Rules constants -----------------------------------------------------------------------------------

export const MAX_AP = 9;
export const START_AP = 1;
export const GRADIENT_MAX = 300;
export const GRADIENT_CHARGE = 100;
export const SURGE_MAX = 10;
export const SURGE_CONSUME_STEP = 0.2;
export const GLYPH_MAX = 4;
/** Glyph → damage element. */
export const GLYPH_ELEMENTS = Object.freeze({ fire: 'fire', ice: 'ice', storm: 'lightning', earth: 'earth', light: 'light' });
export const GLYPHS = Object.freeze(Object.keys(GLYPH_ELEMENTS));
export const STANCES = Object.freeze(['neutral', 'assault', 'guard', 'virtuoso']);
/** Team gradient gains (before the gradientGain passive). */
export const GRADIENT_GAINS = Object.freeze({
  hit: 2, perfect: 6, parry: 8, perfectDodge: 4, dodge: 2, jump: 6, gradient: 20, counter: 5,
});
/** Free Aim shot. */
export const SHOT = Object.freeze({ power: 0.6, break: 8, ap: 1 });
/** Weak point effects: crit → guaranteed crit with a ×2 crit multiplier; break → ×1.5 and +40 break;
 * shield → removes 2 shields (the shot is absorbed while shields remain), ×1.5 once unshielded. */
export const WEAK_POINT_EFFECTS = Object.freeze({
  crit: Object.freeze({ critMult: 2, mult: 1, break: 0, shields: 0 }),
  break: Object.freeze({ critMult: null, mult: 1.5, break: 40, shields: 0 }),
  shield: Object.freeze({ critMult: null, mult: 1.5, break: 0, shields: 2 }),
});
export const COUNTER_ATTACK = Object.freeze({ power: 1.5, element: 'physical', break: 15 });
export const RIPOSTE = Object.freeze({ power: 0.8, element: 'dark' });
export const DEFAULT_HIT_GAP = 380;
export const DEFAULT_WINDUP = 350;
/** Outcomes accepted per enemy hit type; anything else is treated as 'hit'. */
export const VALID_OUTCOMES = Object.freeze({
  normal: Object.freeze(['parry', 'dodge', 'perfectDodge', 'hit']),
  unparryable: Object.freeze(['dodge', 'perfectDodge', 'hit']),
  jump: Object.freeze(['jump', 'hit']),
  gradient: Object.freeze(['gradient', 'dodge', 'perfectDodge', 'hit']),
  feint: Object.freeze([]),
});
/** The "perfect" defense per hit type that keeps a counterattack possible (unparryable has none). */
export const PERFECT_DEFENSE = Object.freeze({ normal: 'parry', jump: 'jump', gradient: 'gradient' });
/** After battle: KO'd → 1 HP, then everyone recovers this fraction of max HP (DIFFICULTY[d].postBattleRecovery wins). */
export const POST_BATTLE_RECOVERY = 0.2;
/**
 * XP falloff for enemies below a member's level (ADDITION): each level the member stands above an enemy costs 15% of
 * that enemy's XP, down to a floor of 25% — so grinding old zones stops paying and thorough runs stay near the curve.
 */
export const XP_FALLOFF = Object.freeze({ perLevel: 0.15, min: 0.25 });

/**
 * Share of an enemy's XP a member of `memberLevel` earns: clamp(1 − 0.15 × (memberLevel − enemyLevel), 0.25, 1).
 * @param {number} memberLevel
 * @param {number} enemyLevel
 * @returns {number}
 */
export function xpFalloff(memberLevel, enemyLevel) {
  const gap = num(memberLevel, 1) - num(enemyLevel, 1);
  return clamp(1 - XP_FALLOFF.perLevel * gap, XP_FALLOFF.min, 1);
}

const ENEMY_TARGET_TYPES = new Set(['enemy', 'allEnemies', 'randomEnemies']);
const SINGLE_TARGET_TYPES = new Set(['enemy', 'ally', 'deadAlly']);
const QTE_RATINGS = new Set(['perfect', 'good', 'miss']);
const LOG_LIMIT = 400;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const LOOK_RE = /^[a-z0-9_]+$/;

const warned = new Set();
function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  if (typeof console !== 'undefined') console.warn(msg);
}

function makeMechanic(type) {
  if (type === 'surge') return { type: 'surge', value: 0 };
  if (type === 'glyphs') return { type: 'glyphs', list: [] };
  if (type === 'stance') return { type: 'stance', value: 'neutral' };
  return null;
}

function copyMechanic(m) {
  if (!m) return null;
  return m.type === 'glyphs' ? { type: 'glyphs', list: [...m.list] } : { ...m };
}

function normalizeBasicAttack(ba) {
  const src = ba && typeof ba === 'object' ? ba : {};
  const hits = Array.isArray(src.hits) && src.hits.length ? src.hits : [{ power: 1 }];
  return {
    name: src.name ?? 'Attack',
    anim: src.anim ?? 'slash',
    element: src.element ?? 'physical',
    hits: hits.map((h) => ({ ...h, power: num(h?.power, 1) })),
  };
}

function normalizeItems(items, ITEMS) {
  const out = {};
  for (const [id, def] of Object.entries(ITEMS ?? {})) {
    const src = items?.[id];
    let count;
    let max;
    if (typeof src === 'number') count = src;
    else if (src && typeof src === 'object') {
      count = src.count;
      max = src.max;
    }
    const baseMax = num(def?.baseMax, 0);
    count = items ? num(count, 0) : baseMax;
    out[id] = { count: Math.max(0, Math.floor(count)), max: Math.max(0, Math.floor(num(max, Math.max(baseMax, count)))) };
  }
  return out;
}

/**
 * Enemy stats at a requested level (ADDITION: the spec leaves level scaling open). Each level above the
 * bestiary level adds ≈12% HP, 9% ATK, 8% DEF, +1.5 SPD and 10% XP/glint (compounding); below scales down.
 */
export function scaleEnemyStats(def, level) {
  const s = def?.stats ?? {};
  const base = {
    maxHp: Math.max(1, Math.round(num(s.hp, 100))),
    atk: num(s.atk, 10),
    def: num(s.def, 0),
    spd: Math.max(1, num(s.spd, 40)),
    crit: clamp(num(s.crit, 0.05), 0, 1),
  };
  const d = Math.round(num(level, num(def?.level, 1)) - num(def?.level, num(level, 1)));
  if (!d) return { stats: base, rewardMult: 1 };
  return {
    stats: {
      maxHp: Math.max(1, Math.round(base.maxHp * 1.12 ** d)),
      atk: Math.round(base.atk * 1.09 ** d * 100) / 100,
      def: Math.max(0, Math.round(base.def * 1.08 ** d * 100) / 100),
      spd: Math.max(1, base.spd + 1.5 * d),
      crit: base.crit,
    },
    rewardMult: 1.1 ** d,
  };
}

/**
 * @typedef {object} Combatant
 * @property {string} id            'p0'..'p2' for the party (fixed order), 'e0'..'e2' for enemies
 * @property {'party'|'enemy'} side
 * @property {number} slot
 * @property {string} key           character id or enemy id
 * @property {string} name          display name (duplicate enemies get " A"/" B" suffixes)
 * @property {string} look          sprite look id
 * @property {{maxHp:number, atk:number, def:number, spd:number, crit:number}} stats
 * @property {number} hp
 * @property {boolean} alive
 * @property {number} ap            party only (0 for enemies)
 * @property {object|null} mechanic {type:'surge',value}|{type:'glyphs',list}|{type:'stance',value}
 * @property {{id:string, turns:number, fresh?:boolean}[]} statuses
 * @property {number} shields       enemies
 * @property {number} breakValue    enemies
 * @property {number} breakMax      enemies
 * @property {boolean} broken       enemies
 * @property {number} phaseIndex    enemies: 0 = base pool, k = phases[k-1]
 * @property {number} initiative
 */

/**
 * @typedef {object} ActionPlan  returned by beginAction (party)
 * @property {string} actorId
 * @property {'attack'|'skill'|'gradient'|'item'|'shot'|'flee'} kind
 * @property {string|null} id        skill / item id ('attack', 'shot', 'flee' for the others)
 * @property {string} name
 * @property {object|null} def       skill / item def, or a synthetic def
 * @property {string[]} targetIds    chosen targets (for randomEnemies: every enemy some hit picked)
 * @property {boolean} endsTurn      false only for shots
 * @property {string} anim
 * @property {string} element
 * @property {{index:number, targetIds:string[], power:number, element:string, qte:boolean, gap:number, break:number,
 *   random?:boolean, glyph?:string, weakPoint?:string|null, weakPointId?:string|null, rating?:string|null}[]} hits
 * @property {object[]} effects      post effects (incl. consumeGlyph bonus effects; `when:'perHit'` ones apply per hit)
 * @property {object[]} events       immediate events (AP / gradient spent, mechanic consumed)
 * @property {string|null} weakPointId
 */

/**
 * @typedef {object} EnemyPlan  returned by planEnemyAction
 * @property {string} actorId
 * @property {string|null} attackId
 * @property {object|null} attack    the EnemyAttack def
 * @property {string} name
 * @property {string} anim
 * @property {'melee'|'ranged'|'stay'} approach
 * @property {number} duration       ms from t = 0 until the action ends
 * @property {{index:number, t:number, type:string, power:number, element:string, anim:string, windup:number,
 *   targetIds:string[], status:object|null}[]} hits   sorted by t; hit targets are fixed at plan time
 * @property {string[]} targetIds    union of hit targets (or the effect targets of a non-damaging action)
 * @property {object[]} effects
 * @property {object[]} events       immediate events (e.g. a boss phase change)
 * @property {(string|null)[]} outcomes  per hit, filled by resolveEnemyHit ('feint' for feints)
 * @property {string} [error]        set when the enemy cannot act
 */

/**
 * The battle model. See SPEC §4.7 for the call protocol:
 * nextTurn → (party: getCommands / beginAction / resolveHit×n / finishAction) | (enemy: planEnemyAction /
 * resolveEnemyHit×n / resolveCounters / finishEnemyAction) → endTurn → … until outcome() is non-null.
 */
export class BattleModel {
  /**
   * @param {object} opts
   * @param {object[]} opts.party PartySnapshot[] (SPEC §4.9); a bare character id string is also accepted
   * @param {(string|{id:string, level?:number})[]} opts.enemies
   * @param {{next:()=>number}} opts.rng injected RNG
   * @param {string} [opts.difficulty='expeditioner']
   * @param {null|'party'|'enemy'} [opts.ambush=null]
   * @param {boolean} [opts.practice=false] hp floors at 1 on both sides, no rewards, no flee
   * @param {{ENEMIES:object, SKILLS:object, ITEMS:object, CHARACTERS:object, DIFFICULTY:object}} opts.data
   * @param {boolean} [opts.boss] boss battle (no flee); inferred from ENEMIES[].boss when omitted
   * @param {boolean} [opts.tutorial=false] tutorial battle (no flee)
   * @param {object} [opts.items] item counts: { tincture:{count,max} | number, ... }; omitted → each item's baseMax
   */
  constructor({
    party = [], enemies = [], rng, difficulty = 'expeditioner', ambush = null, practice = false, data,
    boss = null, tutorial = false, items = null,
  } = {}) {
    if (!data || typeof data !== 'object') {
      throw new TypeError('BattleModel: `data` ({ ENEMIES, SKILLS, ITEMS, CHARACTERS, DIFFICULTY }) is required');
    }
    if (!rng || typeof rng.next !== 'function') throw new TypeError('BattleModel: an injected RNG with next() is required');
    this.data = {
      ENEMIES: data.ENEMIES ?? {},
      SKILLS: data.SKILLS ?? {},
      ITEMS: data.ITEMS ?? {},
      CHARACTERS: data.CHARACTERS ?? {},
      DIFFICULTY: data.DIFFICULTY ?? {},
    };
    this.rng = rng;
    this.difficulty = difficulty;
    const diff = this.data.DIFFICULTY[difficulty];
    this.dmgTakenMult = num(diff?.dmgTakenMult, 1);
    /** Boss levers of this difficulty (Veteran: bosses act more often and hit harder; regular enemies unchanged). */
    this.bossSpdMult = Math.max(0.1, num(diff?.bossSpdMult, 1));
    this.bossDmgMult = Math.max(0, num(diff?.bossDmgMult, 1));
    /** Fraction of max HP everyone recovers after the battle (SPEC §3.2; Veteran: none). */
    this.postBattleRecovery = clamp(num(diff?.postBattleRecovery, POST_BATTLE_RECOVERY), 0, 1);
    this.ambush = ambush === 'party' || ambush === 'enemy' ? ambush : null;
    this.practice = !!practice;
    this.tutorial = !!tutorial;
    /** @type {string[]} readable battle log lines */
    this.log = [];
    /** Team gradient meter 0..300. */
    this.gradient = 0;
    /** Current turn: { number, actorId, side, skipped, acted, ended, round }. */
    this.turn = { number: 0, actorId: null, side: null, skipped: false, acted: false, ended: true, round: 1 };
    /** Round counter: a round completes once every living combatant has taken a turn. */
    this.round = 1;
    this._roundSeen = new Set();
    this._forcedOutcome = null;
    this._rewards = null;
    this._outcomeLogged = false;
    this.stats = {
      parries: 0, perfectDodges: 0, dodges: 0, jumps: 0, gradientCounters: 0, perfects: 0, goods: 0, misses: 0,
      hitsTaken: 0, turns: 0, partyTurns: 0, enemyTurns: 0, rounds: 1, counters: 0, breaks: 0, kills: 0,
      shots: 0, skillsUsed: 0, gradientSkills: 0, itemsUsed: 0, damageDealt: 0, damageTaken: 0, healing: 0,
    };

    /** @type {Combatant[]} */
    this.party = (Array.isArray(party) ? party : []).slice(0, 3).map((s, i) => this._makePartyMember(s, i));
    const enemyList = [];
    for (const entry of Array.isArray(enemies) ? enemies : []) {
      const e = this._makeEnemy(entry, enemyList.length);
      if (e) enemyList.push(e);
    }
    /** @type {Combatant[]} */
    this.enemies = enemyList;
    this._nameDuplicates();
    /** @type {Combatant[]} party first, then enemies */
    this.combatants = [...this.party, ...this.enemies];
    this._byId = new Map(this.combatants.map((c) => [c.id, c]));
    this.boss = typeof boss === 'boolean' ? boss : this.enemies.some((e) => e.boss);
    this.fleeAllowed = !(this.boss || this.tutorial || this.practice);
    /** Item inventory for this battle: { [itemId]: { count, max } } (written back by the scene from summary()). */
    this.items = normalizeItems(items, this.data.ITEMS);
    this.itemsUsed = {};

    for (const c of this.combatants) {
      const bonus = (this.ambush === 'party' && c.side === 'party') || (this.ambush === 'enemy' && c.side === 'enemy') ? AMBUSH_BONUS : 0;
      c.initiative = c.alive ? rollInitiative(c, this.rng, bonus) : 0;
    }

    /** Events produced while setting up (start statuses, AP); the scene may animate them at battle start. */
    this.startEvents = [];
    const names = this.enemies.map((e) => e.name).join(', ');
    this._log(names ? `The expedition faces ${names}.` : 'The expedition stands ready.');
    if (this.ambush === 'party') this._log('Ambush! The expedition strikes first.');
    if (this.ambush === 'enemy') this._log('Ambushed! The enemy has the initiative.');
    if (this.practice) this._log('Practice battle — nobody can fall here.');
    for (const m of this.party) {
      if (!m.alive) continue;
      const ap = START_AP + (this.ambush === 'party' ? 1 : 0) + P.startApBonus(m);
      this._gainAp(m, ap, this.startEvents);
      for (const s of P.startStatusList(m)) this._applyStatusTo(m, s.status, s.turns, this.startEvents);
    }
  }

  // ---- Construction helpers ---------------------------------------------------------------------------

  _makePartyMember(snapIn, slot) {
    const snap = typeof snapIn === 'string' ? { id: snapIn } : snapIn ?? {};
    const charDef = this.data.CHARACTERS[snap.id] ?? {};
    const base = charDef.base ?? {};
    const s = snap.stats ?? {};
    const stats = {
      maxHp: Math.max(1, Math.round(num(s.maxHp ?? s.hp, num(base.hp, 100)))),
      atk: num(s.atk, num(base.atk, 10)),
      def: num(s.def, num(base.def, 0)),
      spd: Math.max(1, num(s.spd, num(base.spd, 40))),
      crit: clamp(num(s.crit, num(base.crit, 0.05)), 0, 1),
    };
    let hp = Math.round(clamp(num(snap.hp, stats.maxHp), 0, stats.maxHp));
    const alive = snap.alive !== false && hp > 0;
    if (!alive) hp = 0;
    const mechType = typeof snap.mechanic === 'string' ? snap.mechanic : snap.mechanic?.type ?? charDef.mechanic ?? null;
    const lookRaw = snap.look ?? charDef.look;
    return {
      id: `p${slot}`,
      side: 'party',
      slot,
      key: snap.id ?? `member${slot}`,
      name: snap.name ?? charDef.name ?? snap.id ?? `Member ${slot + 1}`,
      look: typeof lookRaw === 'string' && LOOK_RE.test(lookRaw) ? lookRaw : snap.id,
      level: num(snap.level, 1),
      boss: false,
      stats,
      baseStats: { ...stats },
      hp,
      alive,
      ap: 0,
      mechanic: makeMechanic(mechType),
      statuses: [],
      passives: P.normalizePassives(snap.passives),
      skills: [...(snap.skills ?? charDef.startingSkills ?? [])],
      gradientSkill: snap.gradientSkill ?? charDef.gradientSkill ?? null,
      basicAttack: normalizeBasicAttack(snap.basicAttack ?? charDef.basicAttack),
      shotElement: snap.shotElement ?? charDef.shotElement ?? 'physical',
      affinities: { ...(snap.affinities ?? {}) },
      statusResist: [],
      shields: 0,
      maxShields: 0,
      breakValue: 0,
      breakMax: 0,
      broken: false,
      weakPoints: [],
      initiative: 0,
      turnsTaken: 0,
      flags: { secondWindUsed: false, firstStrikeUsed: false },
    };
  }

  _makeEnemy(entry, slot) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    const def = this.data.ENEMIES[id];
    if (!def) {
      warnOnce(`BattleModel: unknown enemy id "${id}" skipped`);
      return null;
    }
    const level = num(typeof entry === 'object' ? entry.level : undefined, num(def.level, 1));
    const { stats, rewardMult } = scaleEnemyStats(def, level);
    if (def.boss && this.bossSpdMult !== 1) stats.spd = Math.round(stats.spd * this.bossSpdMult * 100) / 100;
    const phases = Array.isArray(def.phases) ? [...def.phases].sort((a, b) => num(b.hpBelow, 0) - num(a.hpBelow, 0)) : [];
    const attacks = {};
    for (const [aid, atk] of Object.entries(def.attacks ?? {})) if (atk) attacks[aid] = { ...atk, id: atk.id ?? aid };
    return {
      id: `e${slot}`,
      side: 'enemy',
      slot,
      key: def.id ?? id,
      baseName: def.name ?? id,
      name: def.name ?? id,
      look: typeof def.look === 'string' && LOOK_RE.test(def.look) ? def.look : def.id ?? id,
      level,
      boss: !!def.boss,
      scale: num(def.scale, 1),
      stats,
      baseStats: { ...stats },
      hp: stats.maxHp,
      alive: true,
      ap: 0,
      mechanic: null,
      statuses: [],
      passives: [],
      affinities: { ...(def.affinities ?? {}) },
      statusResist: [...(def.statusResist ?? [])],
      shields: Math.max(0, Math.floor(num(def.shields, 0))),
      maxShields: Math.max(0, Math.floor(num(def.shields, 0))),
      breakValue: 0,
      breakMax: Math.max(0, num(def.breakMax, 100)),
      broken: false,
      weakPoints: (def.weakPoints ?? []).filter((w) => w && w.id).map((w) => ({ id: w.id, effect: w.effect })),
      attacks,
      pool: Array.isArray(def.pool) ? [...def.pool] : Object.keys(attacks),
      phases,
      phaseIndex: 0,
      lastUsed: {},
      turnsTaken: 0,
      initiative: 0,
      xp: Math.round(num(def.xp, 0) * rewardMult),
      glint: Math.round(num(def.glint, 0) * rewardMult),
      drops: Array.isArray(def.drops) ? def.drops.filter((d) => d && d.relic) : [],
      flags: {},
    };
  }

  _nameDuplicates() {
    const counts = {};
    for (const e of this.enemies) counts[e.baseName] = (counts[e.baseName] ?? 0) + 1;
    const seen = {};
    for (const e of this.enemies) {
      if (counts[e.baseName] > 1) {
        const i = (seen[e.baseName] = (seen[e.baseName] ?? 0) + 1);
        e.name = `${e.baseName} ${String.fromCharCode(64 + i)}`;
      }
    }
  }

  // ---- Queries ------------------------------------------------------------------------------------------

  /** @param {string} id combatant id @returns {Combatant|null} */
  get(id) {
    return this._byId.get(id) ?? null;
  }

  /** @returns {number} 0..3 full gradient charges */
  gradientCharges() {
    return Math.floor(this.gradient / GRADIENT_CHARGE);
  }

  /** @param {'party'|'enemy'} side @returns {Combatant[]} living combatants of a side */
  living(side) {
    return (side === 'party' ? this.party : this.enemies).filter((c) => c.alive);
  }

  /**
   * Pure forecast of the next n turns (the ids successive nextTurn() calls would return if nothing changed).
   * During a turn the current actor is not included (its next turn is). Does not mutate anything.
   * @param {number} [n=8]
   * @returns {string[]}
   */
  peekTurnOrder(n = 8) {
    const current = this.turn.actorId && !this.turn.ended ? this.turn.actorId : null;
    return forecastTurns(this.combatants, n, { currentActorId: current });
  }

  /** @returns {'victory'|'defeat'|'fled'|null} */
  outcome() {
    if (this._forcedOutcome) return this._forcedOutcome;
    if (!this.enemies.some((e) => e.alive)) return 'victory';
    if (!this.party.some((m) => m.alive)) return 'defeat';
    return null;
  }

  /**
   * Ends the battle immediately (ADDITION: practice exit, debug "win battle"). A forced victory grants the
   * normal rewards (none in practice).
   * @param {'victory'|'defeat'|'fled'} outcome
   */
  endBattle(outcome) {
    if (!['victory', 'defeat', 'fled'].includes(outcome) || this.outcome()) return [];
    this._forcedOutcome = outcome;
    const events = outcome === 'fled' ? [{ type: 'fled' }] : [];
    this._noteOutcome();
    return events;
  }

  // ---- Turn flow ----------------------------------------------------------------------------------------

  /**
   * Advances the CTB to the next actor and applies start-of-turn effects (burn/regen/turnHeal, AP +1).
   * Stunned or Broken actors skip: the skipped turn is fully processed here (endTurn afterwards is a no-op).
   * An unfinished previous turn is ended automatically.
   * @returns {{ actorId: string|null, skipped: boolean, events: object[], reason?: string, over?: boolean }}
   */
  nextTurn() {
    const events = [];
    if (this.turn.actorId && !this.turn.ended) events.push(...this.endTurn(this.turn.actorId));
    if (this.outcome()) return { actorId: null, skipped: false, events, over: true };
    const living = this.combatants.filter((c) => c.alive);
    if (living.length && living.every((c) => this._roundSeen.has(c.id))) {
      this.round += 1;
      this._roundSeen.clear();
    }
    const actor = advanceToNext(this.combatants);
    if (!actor) return { actorId: null, skipped: false, events, over: true };
    this._roundSeen.add(actor.id);
    this.stats.rounds = this.round;
    this.turn = {
      number: this.turn.number + 1, actorId: actor.id, side: actor.side, skipped: false, acted: false, ended: false, round: this.round,
    };
    actor.turnsTaken += 1;
    this.stats.turns += 1;
    if (actor.side === 'party') this.stats.partyTurns += 1;
    else this.stats.enemyTurns += 1;

    // Start-of-turn ticks.
    for (const tick of tickStartOfTurn(actor)) {
      const statusName = STATUS_DEFS[tick.status]?.name ?? tick.status;
      if (tick.kind === 'damage') {
        events.push({ type: 'statusTick', targetId: actor.id, status: tick.status, amount: tick.amount });
        this._log(`${statusName} sears ${actor.name} for ${tick.amount}.`);
        this._damageEvent(null, actor, { amount: tick.amount, crit: false, affinity: null }, 'fire', null, events, { kind: 'status', status: tick.status });
        if (!actor.alive) break;
      } else {
        events.push({ type: 'statusTick', targetId: actor.id, status: tick.status, amount: tick.amount });
        this._heal(actor, tick.amount, events, `${actor.name} regenerates`);
      }
    }
    if (actor.alive && actor.side === 'party') {
      const pct = P.turnHealPct(actor);
      if (pct > 0) this._heal(actor, Math.max(1, Math.round(pct * actor.stats.maxHp)), events, `${actor.name} is mended`);
    }
    events.push(...this._checkPhases());

    if (!actor.alive) {
      this.turn.skipped = true;
      this.turn.ended = true;
      this._noteOutcome();
      return { actorId: actor.id, skipped: true, events, reason: 'ko' };
    }

    const reason = actor.broken ? 'broken' : hasStatus(actor, 'stun') ? 'stun' : null;
    if (reason) {
      this.turn.skipped = true;
      events.push({ type: 'skip', targetId: actor.id, reason });
      this._log(reason === 'broken' ? `${actor.name} is Broken and cannot act.` : `${actor.name} is stunned and loses the turn.`);
      if (removeStatus(actor, 'stun')) events.push({ type: 'statusEnd', targetId: actor.id, status: 'stun' });
      events.push(...this._endTurnInternal(actor));
      return { actorId: actor.id, skipped: true, events, reason };
    }

    if (actor.side === 'party') this._gainAp(actor, 1, events);
    return { actorId: actor.id, skipped: false, events };
  }

  /**
   * Ends the current actor's turn: status durations tick (expired → statusEnd), a Broken enemy whose turn was
   * skipped recovers (break → 0). Idempotent; ignored for anyone but the current actor.
   * @param {string} actorId
   * @returns {object[]} events
   */
  endTurn(actorId) {
    if (!actorId || this.turn.actorId !== actorId || this.turn.ended) return [];
    const actor = this.get(actorId);
    if (!actor) {
      this.turn.ended = true;
      return [];
    }
    return this._endTurnInternal(actor);
  }

  _endTurnInternal(actor) {
    this.turn.ended = true;
    const events = [];
    if (actor.alive) {
      for (const id of tickEndOfTurn(actor)) {
        events.push({ type: 'statusEnd', targetId: actor.id, status: id });
        this._log(`${STATUS_DEFS[id]?.name ?? id} fades from ${actor.name}.`);
      }
      if (this.turn.skipped && actor.broken) {
        actor.broken = false;
        actor.breakValue = 0;
        events.push({ type: 'recover', targetId: actor.id });
        events.push({ type: 'break', targetId: actor.id, value: 0, max: actor.breakMax });
        this._log(`${actor.name} recovers its guard.`);
      }
    }
    this._noteOutcome();
    return events;
  }

  // ---- Party commands -----------------------------------------------------------------------------------

  /**
   * Command menu for a party member with usability and reasons.
   * @param {string} actorId
   */
  getCommands(actorId) {
    const actor = this.get(actorId);
    const isParty = actor?.side === 'party';
    const over = !!this.outcome();
    const canAct = isParty && actor.alive && !over;
    const notActing = !isParty ? 'Not a party member' : !actor.alive ? 'Knocked out' : over ? 'The battle is over' : null;
    const silenced = canAct && hasStatus(actor, 'silence');
    const ap = actor?.ap ?? 0;
    const enemiesAlive = this.living('enemy').length > 0;

    const skills = [];
    for (const id of isParty ? actor.skills : []) {
      const def = this.data.SKILLS[id];
      if (!def) {
        warnOnce(`BattleModel: unknown skill id "${id}"`);
        continue;
      }
      if (def.gradient) continue;
      const cost = num(def.ap, 0);
      const targets = canAct ? this._targetsFor(actor, def.target ?? 'enemy') : [];
      const reason = notActing ?? (silenced ? 'Silenced' : ap < cost ? 'Not enough AP' : targets.length === 0 ? 'No targets' : null);
      skills.push({ id, name: def.name ?? id, ap: cost, usable: !reason, reason, target: def.target ?? 'enemy', element: def.element ?? 'physical', desc: def.desc ?? '' });
    }

    const items = [];
    for (const [id, def] of Object.entries(this.data.ITEMS)) {
      const count = this.items[id]?.count ?? 0;
      const targets = canAct ? this._targetsFor(actor, def?.target === 'deadAlly' ? 'deadAlly' : 'ally') : [];
      const reason = notActing ?? (count <= 0 ? 'None left' : targets.length === 0 ? 'No targets' : null);
      items.push({ id, name: def?.name ?? id, count, max: this.items[id]?.max ?? count, usable: !reason, reason, target: def?.target ?? 'ally', desc: def?.desc ?? '' });
    }

    const gradient = [];
    const gid = isParty ? actor.gradientSkill : null;
    const gdef = gid ? this.data.SKILLS[gid] : null;
    if (gdef) {
      const targets = canAct ? this._targetsFor(actor, gdef.target ?? 'enemy') : [];
      const reason = notActing ?? (silenced ? 'Silenced' : this.gradientCharges() < 1 ? 'No Prism charges' : targets.length === 0 ? 'No targets' : null);
      gradient.push({ id: gid, name: gdef.name ?? gid, usable: !reason, reason, target: gdef.target ?? 'enemy', element: gdef.element ?? 'physical', desc: gdef.desc ?? '' });
    }

    const attackReason = notActing ?? (enemiesAlive ? null : 'No targets');
    const aimReason = notActing ?? (ap < SHOT.ap ? 'Not enough AP' : null);
    const fleeReason = notActing ?? (this.fleeAllowed ? null : 'Cannot flee this battle');
    return {
      attack: { usable: !attackReason, reason: attackReason, name: actor?.basicAttack?.name ?? 'Attack' },
      skills,
      freeAim: { usable: !aimReason, reason: aimReason, ap: SHOT.ap },
      items,
      gradient,
      flee: { usable: !fleeReason, reason: fleeReason },
    };
  }

  /**
   * Valid target combatant ids for an action (targetIds ignored).
   * @param {string} actorId
   * @param {{kind:string, id?:string}} action
   * @returns {string[]}
   */
  getValidTargets(actorId, action) {
    const actor = this.get(actorId);
    if (!actor || !action) return [];
    switch (action.kind) {
      case 'attack':
      case 'shot':
        return this._targetsFor(actor, 'enemy');
      case 'skill':
      case 'gradient': {
        const id = action.kind === 'gradient' ? action.id ?? actor.gradientSkill : action.id;
        const def = this.data.SKILLS[id];
        return def ? this._targetsFor(actor, def.target ?? 'enemy') : [];
      }
      case 'item': {
        const def = this.data.ITEMS[action.id];
        return def ? this._targetsFor(actor, def.target === 'deadAlly' ? 'deadAlly' : 'ally') : [];
      }
      default:
        return [];
    }
  }

  _targetsFor(actor, targetType) {
    const own = actor.side === 'party' ? this.party : this.enemies;
    const other = actor.side === 'party' ? this.enemies : this.party;
    switch (targetType) {
      case 'enemy':
      case 'allEnemies':
      case 'randomEnemies':
        return other.filter((c) => c.alive).map((c) => c.id);
      case 'ally':
      case 'allAllies':
        return own.filter((c) => c.alive).map((c) => c.id);
      case 'self':
        return actor.alive ? [actor.id] : [];
      case 'deadAlly':
        return own.filter((c) => !c.alive).map((c) => c.id);
      default:
        return other.filter((c) => c.alive).map((c) => c.id);
    }
  }

  /**
   * Validates and plans a party action; pays its cost (AP / gradient charge) immediately.
   * @param {string} actorId
   * @param {{kind:'attack'|'skill'|'item'|'gradient'|'shot'|'flee', id?:string, targetIds?:string[], weakPointId?:string}} action
   * @returns {object} ActionPlan or { error }
   */
  beginAction(actorId, action = {}) {
    const actor = this.get(actorId);
    if (this.outcome()) return { error: 'The battle is over.' };
    if (!actor || actor.side !== 'party') return { error: 'Only party members can take commands.' };
    if (!actor.alive) return { error: `${actor.name} is knocked out.` };
    if (this.turn.actorId !== actorId || this.turn.ended) return { error: `It is not ${actor.name}'s turn.` };
    if (this.turn.acted) return { error: `${actor.name} has already acted this turn.` };
    switch (action?.kind) {
      case 'attack':
        return this._planAttack(actor, action);
      case 'skill':
        return this._planSkill(actor, action, false);
      case 'gradient':
        return this._planSkill(actor, action, true);
      case 'item':
        return this._planItem(actor, action);
      case 'shot':
        return this._planShot(actor, action);
      case 'flee':
        return this._planFlee(actor);
      default:
        return { error: `Unknown action kind "${action?.kind}".` };
    }
  }

  _basePlan(actor, fields) {
    return {
      actorId: actor.id,
      kind: 'attack',
      id: null,
      name: '',
      def: null,
      targetIds: [],
      endsTurn: true,
      anim: 'slash',
      element: 'physical',
      hits: [],
      effects: [],
      events: [],
      critBonus: 0,
      bonusVs: null,
      ignoreShields: false,
      weakPointId: null,
      resolved: [],
      finished: false,
      damagedIds: [],
      ...fields,
    };
  }

  _chooseSingle(valid, action) {
    const wanted = Array.isArray(action?.targetIds) ? action.targetIds[0] : undefined;
    if (wanted == null) return valid[0] ?? null;
    return valid.includes(wanted) ? wanted : null;
  }

  _planAttack(actor, action) {
    const valid = this._targetsFor(actor, 'enemy');
    if (!valid.length) return { error: 'There is nothing to attack.' };
    const targetId = this._chooseSingle(valid, action);
    if (!targetId) return { error: 'Invalid target.' };
    const ba = actor.basicAttack;
    const hits = ba.hits.map((h, i) => ({
      index: i,
      targetIds: [targetId],
      power: h.power,
      element: h.element ?? ba.element,
      qte: false,
      gap: num(h.gap, DEFAULT_HIT_GAP),
      break: num(h.break, Math.round(h.power * 10)),
    }));
    this._log(`${actor.name} attacks ${this.get(targetId).name}.`);
    return this._basePlan(actor, {
      kind: 'attack', id: 'attack', name: ba.name, def: { id: 'attack', ...ba, target: 'enemy' },
      targetIds: [targetId], anim: ba.anim, element: ba.element, hits,
    });
  }

  _planSkill(actor, action, isGradient) {
    const id = isGradient ? action.id ?? actor.gradientSkill : action.id;
    const def = this.data.SKILLS[id];
    if (!def) return { error: `Unknown skill "${id}".` };
    if (isGradient) {
      if (!def.gradient) return { error: `${def.name ?? id} is not a Prism skill.` };
      if (id !== actor.gradientSkill && def.owner !== actor.key) return { error: `${actor.name} cannot use ${def.name ?? id}.` };
      if (this.gradientCharges() < 1) return { error: 'No Prism charges.' };
    } else {
      if (def.gradient) return { error: 'Prism skills use the Prism command.' };
      if (!actor.skills.includes(id)) return { error: `${actor.name} has not learned ${def.name ?? id}.` };
      if (actor.ap < num(def.ap, 0)) return { error: 'Not enough AP.' };
    }
    if (hasStatus(actor, 'silence')) return { error: `${actor.name} is silenced.` };

    const targetType = def.target ?? 'enemy';
    const valid = this._targetsFor(actor, targetType);
    if (!valid.length) return { error: 'No valid targets.' };
    let chosen;
    if (SINGLE_TARGET_TYPES.has(targetType)) {
      const t = this._chooseSingle(valid, action);
      if (!t) return { error: 'Invalid target.' };
      chosen = [t];
    } else if (targetType === 'self') chosen = [actor.id];
    else chosen = [...valid];

    const events = [];
    if (isGradient) {
      this._gradientDelta(-GRADIENT_CHARGE, events);
      this.stats.gradientSkills += 1;
    } else {
      this._gainAp(actor, -num(def.ap, 0), events);
      this.stats.skillsUsed += 1;
    }

    // Plan-time mechanic modifiers.
    let powerMult = 1;
    const effects = [...(def.effects ?? [])];
    const mech = actor.mechanic;
    let surgeConsumed = null;
    if (def.surge === 'consume' && mech?.type === 'surge') {
      surgeConsumed = mech.value;
      powerMult *= 1 + SURGE_CONSUME_STEP * mech.value;
      if (mech.value !== 0) {
        mech.value = 0;
        this._mechanicEvent(actor, events);
      }
    }
    let glyphConsumed = null;
    if (def.consumeGlyph && mech?.type === 'glyphs') {
      const want = def.consumeGlyph.glyph;
      const idx = want === 'any' || want === '*' ? (mech.list.length ? 0 : -1) : mech.list.indexOf(want);
      if (idx >= 0) {
        glyphConsumed = mech.list.splice(idx, 1)[0];
        powerMult *= num(def.consumeGlyph.powerMult, 1);
        effects.push(...(def.consumeGlyph.effects ?? []));
        this._mechanicEvent(actor, events);
      }
    }

    const hits = [];
    const enemyTargeting = ENEMY_TARGET_TYPES.has(targetType);
    const livingEnemies = enemyTargeting ? valid : [];
    const pickTargets = (random) => {
      if (random || targetType === 'randomEnemies') return [randomPick(livingEnemies, this.rng)];
      if (targetType === 'allEnemies') return [...livingEnemies];
      return [...chosen];
    };
    if (enemyTargeting) {
      for (const h of def.hits ?? []) {
        const power = num(h.power, 1) * powerMult;
        const random = !!h.random || targetType === 'randomEnemies';
        hits.push({
          index: hits.length,
          targetIds: pickTargets(random),
          power,
          element: h.element ?? def.element ?? 'physical',
          qte: h.qte !== false,
          gap: num(h.gap, DEFAULT_HIT_GAP),
          break: num(h.break, Math.round(power * 10)),
          random,
        });
      }
    }
    let glyphsSpent = [];
    if (def.consumeAllGlyphs && mech?.type === 'glyphs' && mech.list.length) {
      glyphsSpent = mech.list.splice(0, mech.list.length);
      this._mechanicEvent(actor, events);
      if (enemyTargeting) {
        const extraPower = num(def.consumeAllGlyphs.extraHitPower, 1);
        const lastRandom = hits.length ? hits[hits.length - 1].random : targetType === 'randomEnemies';
        for (const g of glyphsSpent) {
          hits.push({
            index: hits.length,
            targetIds: pickTargets(lastRandom),
            power: extraPower,
            element: GLYPH_ELEMENTS[g] ?? 'physical',
            qte: true,
            gap: DEFAULT_HIT_GAP,
            break: Math.round(extraPower * 10),
            random: lastRandom,
            glyph: g,
          });
        }
      }
    }

    const targetIds = targetType === 'randomEnemies' ? [...new Set(hits.flatMap((h) => h.targetIds))] : chosen;
    const targetNote = SINGLE_TARGET_TYPES.has(targetType) && chosen[0] !== actor.id ? ` on ${this.get(chosen[0]).name}` : '';
    this._log(`${actor.name} uses ${def.name ?? id}${targetNote}.`);
    return this._basePlan(actor, {
      kind: isGradient ? 'gradient' : 'skill',
      id,
      name: def.name ?? id,
      def,
      targetIds,
      anim: def.anim ?? (isGradient ? 'gradient' : 'cast'),
      element: def.element ?? 'physical',
      hits,
      effects,
      events,
      critBonus: num(def.critBonus, 0),
      bonusVs: def.bonusVs ?? null,
      ignoreShields: !!def.ignoreShields,
      surgeConsumed,
      glyphConsumed,
      glyphsSpent,
    });
  }

  _planItem(actor, action) {
    const def = this.data.ITEMS[action.id];
    if (!def) return { error: `Unknown item "${action.id}".` };
    if ((this.items[action.id]?.count ?? 0) <= 0) return { error: `No ${def.name ?? action.id} left.` };
    const valid = this._targetsFor(actor, def.target === 'deadAlly' ? 'deadAlly' : 'ally');
    if (!valid.length) return { error: 'No valid targets.' };
    const t = this._chooseSingle(valid, action);
    if (!t) return { error: 'Invalid target.' };
    this._log(`${actor.name} uses ${def.name ?? action.id} on ${this.get(t).name}.`);
    return this._basePlan(actor, {
      kind: 'item', id: action.id, name: def.name ?? action.id, def, targetIds: [t], anim: 'buff', element: 'physical',
      effects: [...(def.effects ?? [])],
    });
  }

  _planShot(actor, action) {
    if (actor.ap < SHOT.ap) return { error: 'Not enough AP.' };
    const events = [];
    this._gainAp(actor, -SHOT.ap, events);
    this.stats.shots += 1;
    const wanted = Array.isArray(action.targetIds) ? action.targetIds[0] : null;
    const target = wanted ? this.get(wanted) : null;
    const valid = !!target && target.side === 'enemy' && target.alive;
    const wp = valid && action.weakPointId ? target.weakPoints.find((w) => w.id === action.weakPointId) : null;
    const effect = wp && WEAK_POINT_EFFECTS[wp.effect] ? wp.effect : null;
    const element = actor.shotElement ?? 'physical';
    this._log(
      valid ? `${actor.name} fires at ${target.name}${wp ? `'s ${wp.id.replace(/_/g, ' ')}` : ''}.` : `${actor.name} fires a shot into the air.`,
    );
    return this._basePlan(actor, {
      kind: 'shot',
      id: 'shot',
      name: 'Free Aim',
      def: { id: 'shot', name: 'Free Aim', power: SHOT.power, element },
      targetIds: valid ? [target.id] : [],
      endsTurn: false,
      anim: 'shoot',
      element,
      events,
      weakPointId: effect ? wp.id : null,
      hits: [{
        index: 0,
        targetIds: valid ? [target.id] : [],
        power: SHOT.power,
        element,
        qte: false,
        gap: 0,
        break: SHOT.break + (effect ? WEAK_POINT_EFFECTS[effect].break : 0),
        weakPoint: effect,
        weakPointId: effect ? wp.id : null,
      }],
    });
  }

  _planFlee(actor) {
    if (!this.fleeAllowed) return { error: 'There is no escape from this battle.' };
    return this._basePlan(actor, { kind: 'flee', id: 'flee', name: 'Flee', anim: 'run', def: { id: 'flee', name: 'Flee' } });
  }

  /**
   * Resolves one hit of a party action (damage, shields, break, gains, perHit effects).
   * @param {object} plan ActionPlan from beginAction
   * @param {number} hitIndex
   * @param {'perfect'|'good'|'miss'|null} [qteRating] ignored for hits without a QTE (a QTE hit without a rating is a miss)
   * @returns {object[]} events
   */
  resolveHit(plan, hitIndex, qteRating = null) {
    if (!plan || plan.error || plan.finished) return [];
    const hit = plan.hits?.[hitIndex];
    if (!hit || plan.resolved[hitIndex]) return [];
    plan.resolved[hitIndex] = true;
    const actor = this.get(plan.actorId);
    if (!actor?.alive || this._forcedOutcome) return [];
    const events = [];
    const rating = hit.qte ? (QTE_RATINGS.has(qteRating) ? qteRating : 'miss') : null;
    if (rating === 'perfect') this.stats.perfects += 1;
    else if (rating === 'good') this.stats.goods += 1;
    else if (rating === 'miss') this.stats.misses += 1;
    hit.rating = rating;

    let targets = hit.targetIds.map((id) => this.get(id)).filter((c) => c?.alive);
    if (hit.random && targets.length === 0) {
      const pick = randomPick(this.living('enemy'), this.rng);
      if (pick) {
        hit.targetIds = [pick.id];
        targets = [pick];
        if (!plan.targetIds.includes(pick.id)) plan.targetIds.push(pick.id);
      }
    }
    const { landed } = this._strikeGroup(actor, targets, {
      power: hit.power,
      element: hit.element,
      kind: plan.kind,
      qteRating: rating,
      critBonus: plan.critBonus,
      bonusVs: plan.bonusVs,
      ignoreShields: plan.ignoreShields,
      breakAmount: hit.break,
      weakPoint: hit.weakPoint ?? null,
      weakPointId: hit.weakPointId ?? null,
      hitIndex,
    }, events, plan);

    if (landed) {
      this._gainGradient(GRADIENT_GAINS.hit, [actor], events);
      this._addSurge(actor, 1, events);
    }
    if (rating === 'perfect') this._gainGradient(GRADIENT_GAINS.perfect, [actor], events);

    const perHit = plan.effects.filter((e) => e && e.when === 'perHit');
    if (perHit.length) this._applyEffects(perHit, { source: actor, targetIds: hit.targetIds }, events);
    this._noteOutcome();
    return events;
  }

  /**
   * Applies the action's post effects (skill effects, stance, item use, basic-attack AP/passives, flee).
   * `plan.endsTurn` tells the scene whether to end the turn (false for shots).
   * @param {object} plan
   * @returns {object[]} events
   */
  finishAction(plan) {
    if (!plan || plan.error || plan.finished) return [];
    plan.finished = true;
    const actor = this.get(plan.actorId);
    const events = [];
    if (!actor) return events;
    if (plan.endsTurn && this.turn.actorId === actor.id) this.turn.acted = true;
    if (plan.kind !== 'flee' && this.outcome()) {
      this._noteOutcome();
      return events;
    }
    switch (plan.kind) {
      case 'attack': {
        if (!actor.alive) break;
        this._gainAp(actor, 1, events);
        const target = this.get(plan.targetIds[0]);
        if (target?.alive && plan.damagedIds.includes(target.id)) {
          for (const bs of P.basicStatusList(actor)) {
            if (this._chance(bs.chance)) this._applyStatusTo(target, bs.status, bs.turns, events);
          }
        }
        break;
      }
      case 'skill':
      case 'gradient':
        this._applyEffects(plan.effects.filter((e) => e && e.when !== 'perHit'), { source: actor, targetIds: plan.targetIds }, events);
        break;
      case 'item': {
        const inv = this.items[plan.id];
        if (!inv || inv.count <= 0) break;
        inv.count -= 1;
        this.itemsUsed[plan.id] = (this.itemsUsed[plan.id] ?? 0) + 1;
        this.stats.itemsUsed += 1;
        this._applyEffects(plan.effects, { source: actor, targetIds: plan.targetIds }, events);
        break;
      }
      case 'flee':
        this._forcedOutcome = 'fled';
        events.push({ type: 'fled' });
        break;
      default:
        break;
    }
    events.push(...this._checkPhases());
    this._noteOutcome();
    return events;
  }

  // ---- Enemy actions ------------------------------------------------------------------------------------

  /**
   * Plans an enemy action: AI choice (phase pool, cooldowns, conditions, weights) and targets decided now.
   * @param {string} enemyId
   * @returns {object} EnemyPlan (hits: [{index, t, type, power, element, anim, windup, targetIds, status}])
   */
  planEnemyAction(enemyId) {
    const enemy = this.get(enemyId);
    const events = this._checkPhases();
    if (!enemy || enemy.side !== 'enemy' || !enemy.alive || this.outcome()) {
      return this._enemyPlanShell(enemyId, null, events, 'This enemy cannot act.');
    }
    const choice = chooseEnemyAction(this, enemy, this.rng);
    const atk = choice.attackId ? enemy.attacks[choice.attackId] : null;
    if (!atk) {
      this._log(`${enemy.name} hesitates.`);
      return this._enemyPlanShell(enemyId, null, events);
    }
    enemy.lastUsed[choice.attackId] = enemy.turnsTaken;
    const rawHits = Array.isArray(atk.hits) ? atk.hits : [];
    const hits = rawHits
      .map((h, i) => ({
        t: num(h.t, 600 + i * 400),
        type: VALID_OUTCOMES[h.type] ? h.type : 'normal',
        power: num(h.power, 1),
        element: h.element ?? atk.element ?? 'physical',
        anim: h.anim ?? atk.anim ?? 'slash',
        windup: num(h.windup, DEFAULT_WINDUP),
        targetIds: [...(choice.hitTargets[i] ?? choice.targetIds)],
        status: h.status ?? null,
      }))
      .sort((a, b) => a.t - b.t)
      .map((h, index) => ({ index, ...h }));
    const lastT = hits.length ? hits[hits.length - 1].t : 0;
    const plan = this._enemyPlanShell(enemyId, atk, events);
    Object.assign(plan, {
      attackId: choice.attackId,
      name: atk.name ?? choice.attackId,
      anim: atk.anim ?? hits[0]?.anim ?? 'cast',
      approach: atk.approach ?? (hits.length ? 'melee' : 'stay'),
      duration: Math.max(num(atk.duration, lastT + 400), lastT + 400),
      hits,
      targetIds: [...choice.targetIds],
      effects: Array.isArray(atk.effects) ? [...atk.effects] : [],
      outcomes: hits.map(() => null),
    });
    const tnames = choice.targetIds.map((id) => this.get(id)?.name).filter(Boolean);
    this._log(`${enemy.name} uses ${plan.name}${hits.length && tnames.length === 1 ? ` on ${tnames[0]}` : ''}.`);
    return plan;
  }

  _enemyPlanShell(enemyId, atk, events, error = null) {
    const plan = {
      actorId: enemyId,
      attackId: atk?.id ?? null,
      attack: atk,
      name: atk?.name ?? 'Hesitate',
      anim: 'cast',
      approach: 'stay',
      duration: 800,
      hits: [],
      targetIds: [],
      effects: [],
      events,
      outcomes: [],
      finished: false,
      countersResolved: false,
      _hurtAp: new Set(),
    };
    if (error) plan.error = error;
    return plan;
  }

  /**
   * Resolves one enemy hit with the defensive outcome (applies to every living target of that hit).
   * Idempotent per hit; feints and dead targets are no-ops; an invalid outcome for the hit type counts as 'hit'.
   * @param {object} plan EnemyPlan
   * @param {number} hitIndex
   * @param {'parry'|'dodge'|'perfectDodge'|'jump'|'gradient'|'hit'} outcome
   * @returns {object[]} events
   */
  resolveEnemyHit(plan, hitIndex, outcome) {
    if (!plan || plan.error || plan.finished) return [];
    const hit = plan.hits?.[hitIndex];
    if (!hit || plan.outcomes[hitIndex] != null) return [];
    if (hit.type === 'feint') {
      plan.outcomes[hitIndex] = 'feint';
      return [];
    }
    const oc = VALID_OUTCOMES[hit.type].includes(outcome) ? outcome : 'hit';
    plan.outcomes[hitIndex] = oc;
    const attacker = this.get(plan.actorId);
    if (!attacker?.alive || this._forcedOutcome) return [];
    const targets = hit.targetIds.map((id) => this.get(id)).filter((c) => c?.alive);
    if (!targets.length) return [];
    const events = [];
    const names = targets.map((t) => t.name).join(' & ');

    switch (oc) {
      case 'hit':
        for (const t of targets) this._enemyStrike(attacker, t, hit, plan, events);
        break;
      case 'parry': {
        this.stats.parries += 1;
        this._log(`${names} ${targets.length > 1 ? 'parry' : 'parries'}!`);
        for (const t of targets) {
          events.push({ type: 'defend', targetId: t.id, outcome: 'parry' });
          const guard = t.mechanic?.type === 'stance' && t.mechanic.value === 'guard' ? 1 : 0;
          this._gainAp(t, 1 + guard + P.parryApBonus(t), events);
          this._addSurge(t, 1, events);
          const pct = P.parryHealPct(t);
          if (pct > 0) this._heal(t, Math.max(1, Math.round(pct * t.stats.maxHp)), events, `${t.name} steadies`);
        }
        this._gainGradient(GRADIENT_GAINS.parry, targets, events);
        break;
      }
      case 'dodge':
        this.stats.dodges += 1;
        this._log(`${names} ${targets.length > 1 ? 'dodge' : 'dodges'}.`);
        for (const t of targets) events.push({ type: 'defend', targetId: t.id, outcome: 'dodge' });
        this._gainGradient(GRADIENT_GAINS.dodge, targets, events);
        break;
      case 'perfectDodge':
        this.stats.perfectDodges += 1;
        this._log(`${names} ${targets.length > 1 ? 'slip' : 'slips'} away — a perfect dodge!`);
        for (const t of targets) {
          events.push({ type: 'defend', targetId: t.id, outcome: 'perfectDodge' });
          const ap = P.perfectDodgeApBonus(t);
          if (ap > 0) this._gainAp(t, ap, events);
        }
        this._gainGradient(GRADIENT_GAINS.perfectDodge, targets, events);
        break;
      case 'jump':
        this.stats.jumps += 1;
        this._log(`${names} ${targets.length > 1 ? 'leap' : 'leaps'} over the shockwave.`);
        for (const t of targets) events.push({ type: 'defend', targetId: t.id, outcome: 'jump' });
        this._gainGradient(GRADIENT_GAINS.jump, targets, events);
        break;
      case 'gradient': {
        this.stats.gradientCounters += 1;
        this._log(`${names} ${targets.length > 1 ? 'turn' : 'turns'} the prism attack back!`);
        for (const t of targets) events.push({ type: 'defend', targetId: t.id, outcome: 'gradient' });
        this._gainGradient(GRADIENT_GAINS.gradient, targets, events);
        for (const t of targets) {
          if (!attacker.alive) break;
          const { landed } = this._strikeGroup(t, [attacker], {
            power: RIPOSTE.power, element: RIPOSTE.element, kind: 'riposte', breakAmount: Math.round(RIPOSTE.power * 10),
          }, events, null);
          if (landed) this._addSurge(t, 1, events);
        }
        break;
      }
      default:
        break;
    }
    this._noteOutcome();
    return events;
  }

  /**
   * Party members eligible for a counterattack: alive, targeted by at least one non-feint hit, and every such
   * hit resolved with the perfect defense for its type (parry / jump / gradient). Unparryable hits and dodges
   * make a counter impossible.
   * @param {object} plan EnemyPlan
   * @returns {string[]} combatant ids in party order
   */
  counterEligible(plan) {
    if (!plan || plan.error) return [];
    const attacker = this.get(plan.actorId);
    if (!attacker?.alive) return [];
    const ok = new Map();
    plan.hits.forEach((hit, i) => {
      if (hit.type === 'feint') return;
      for (const id of hit.targetIds) {
        if (!ok.has(id)) ok.set(id, true);
        const need = PERFECT_DEFENSE[hit.type];
        if (!need || plan.outcomes[i] !== need) ok.set(id, false);
      }
    });
    return this.party.filter((m) => m.alive && ok.get(m.id) === true).map((m) => m.id);
  }

  /**
   * Performs automatic counterattacks (power 1.5 physical, break 15, gradient +5) for every eligible member.
   * @param {object} plan EnemyPlan
   * @returns {{ counterId: string, targetId: string, events: object[] }[]}
   */
  resolveCounters(plan) {
    if (!plan || plan.error || plan.countersResolved) return [];
    plan.countersResolved = true;
    const attacker = this.get(plan.actorId);
    if (!attacker?.alive || this._forcedOutcome) return [];
    const out = [];
    for (const id of this.counterEligible(plan)) {
      if (!attacker.alive) break;
      const member = this.get(id);
      const events = [{ type: 'counter', sourceId: id, targetId: attacker.id }];
      this.stats.counters += 1;
      this._log(`${member.name} counterattacks!`);
      const { landed } = this._strikeGroup(member, [attacker], {
        power: COUNTER_ATTACK.power, element: COUNTER_ATTACK.element, kind: 'counter', breakAmount: COUNTER_ATTACK.break,
      }, events, null);
      this._gainGradient(GRADIENT_GAINS.counter, [member], events);
      if (landed) this._addSurge(member, 1, events);
      out.push({ counterId: id, targetId: attacker.id, events });
    }
    this._noteOutcome();
    return out;
  }

  /**
   * Applies the enemy action's after-effects (shield restore, heals, buffs, debuffs, dispel …) if the actor
   * is still standing, then checks boss phases.
   * @param {object} plan EnemyPlan
   * @returns {object[]} events
   */
  finishEnemyAction(plan) {
    if (!plan || plan.finished) return [];
    plan.finished = true;
    const events = [];
    if (this.turn.actorId === plan.actorId) this.turn.acted = true;
    const attacker = this.get(plan.actorId);
    if (!plan.error && attacker?.alive && !this._forcedOutcome && plan.effects.length) {
      this._applyEffects(plan.effects, { source: attacker, targetIds: plan.targetIds }, events);
    }
    events.push(...this._checkPhases());
    this._noteOutcome();
    return events;
  }

  // ---- Summary ------------------------------------------------------------------------------------------

  /**
   * Battle summary. Rewards (xp / glint / drops) only on a non-practice victory; drops are rolled once.
   * `xp` is the battle's full XP; `xpByMember` is what each member actually earns (level falloff, half when KO'd).
   * party[].id is the character id; hp is the raw end-of-battle HP, hpAfterRecovery applies SPEC §3.2
   * (KO'd → 1 HP, then + the difficulty's postBattleRecovery × max HP: 20%, none on Veteran).
   * `difficulty` is the id the battle was fought on (applyBattleResult reads it for the recovery rule).
   */
  summary() {
    const outcome = this.outcome();
    const r = this._computeRewards(outcome);
    return {
      outcome,
      difficulty: this.difficulty,
      xp: r.xp,
      glint: r.glint,
      drops: [...r.drops],
      xpByMember: { ...r.xpByMember },
      party: this.party.map((m) => {
        const base = m.alive ? m.hp : 1;
        return {
          id: m.key,
          combatantId: m.id,
          hp: m.hp,
          maxHp: m.stats.maxHp,
          alive: m.alive,
          hpAfterRecovery: Math.min(m.stats.maxHp, base + Math.round(this.postBattleRecovery * m.stats.maxHp)),
        };
      }),
      stats: { ...this.stats, rounds: this.round },
      items: Object.fromEntries(Object.entries(this.items).map(([id, v]) => [id, { ...v }])),
      itemsUsed: { ...this.itemsUsed },
      practice: this.practice,
      boss: this.boss,
      enemies: this.enemies.map((e) => e.key),
    };
  }

  _computeRewards(outcome) {
    if (this._rewards) return this._rewards;
    const none = { xp: 0, glint: 0, drops: [], xpByMember: Object.fromEntries(this.party.map((m) => [m.key, 0])) };
    if (outcome !== 'victory' || this.practice) return none;
    let xp = 0;
    let glint = 0;
    const drops = [];
    for (const e of this.enemies) {
      xp += e.xp;
      glint += e.glint;
      for (const d of e.drops) {
        if (this._chance(num(d.chance, 0)) && !drops.includes(d.relic)) drops.push(d.relic);
      }
    }
    const xpByMember = Object.fromEntries(this.party.map((m) => {
      const earned = Math.round(this.enemies.reduce((a, e) => a + e.xp * xpFalloff(m.level, e.level), 0));
      return [m.key, m.alive ? earned : Math.floor(earned / 2)];
    }));
    this._rewards = { xp, glint, drops, xpByMember };
    return this._rewards;
  }

  // ---- Internals: strikes & damage ------------------------------------------------------------------------

  /**
   * One party strike (same hit) against several targets. firstStrike applies to the whole first damaging hit.
   * @returns {{ landed: boolean }}
   */
  _strikeGroup(actor, targets, o, events, plan) {
    const fs = actor.flags?.firstStrikeUsed ? 1 : P.firstStrikeMult(actor);
    let landed = false;
    for (const t of targets) {
      const r = this._partyStrike(actor, t, { ...o, firstStrike: fs }, events);
      if (r.damaged) {
        landed = true;
        if (plan && !plan.damagedIds.includes(t.id)) plan.damagedIds.push(t.id);
      }
    }
    if (landed && actor.flags) actor.flags.firstStrikeUsed = true;
    return { landed };
  }

  _partyStrike(actor, target, o, events) {
    const res = { damaged: false, blocked: false, killed: false, amount: 0 };
    if (!target?.alive) return res;
    const wp = o.weakPoint ? WEAK_POINT_EFFECTS[o.weakPoint] : null;
    if (target.shields > 0 && (o.weakPoint === 'shield' || !o.ignoreShields)) {
      const n = o.weakPoint === 'shield' ? Math.min(target.shields, wp.shields) : 1;
      events.push({ type: 'blocked', targetId: target.id, sourceId: actor.id, hitIndex: o.hitIndex ?? null });
      this._changeShields(target, -n, events);
      this._log(`${target.name}'s shield absorbs the blow${target.shields ? ` (${target.shields} left)` : ' and shatters'}.`);
      res.blocked = true;
      return res;
    }
    let mult = num(o.firstStrike, 1);
    if (wp) mult *= wp.mult;
    if (o.bonusVs && this._bonusVsApplies(o.bonusVs, target)) mult *= num(o.bonusVs.mult, 1);
    const dmg = computeDamage({
      attacker: actor,
      target,
      power: o.power,
      element: o.element,
      rng: this.rng,
      qteRating: o.qteRating ?? null,
      critBonus: o.critBonus ?? 0,
      forceCrit: o.weakPoint === 'crit',
      noCrit: o.kind === 'shot' && o.weakPoint !== 'crit',
      critMult: wp?.critMult ?? null,
      mult,
      kind: o.kind,
      dmgTakenMult: this.dmgTakenMult,
    });
    const extra = { kind: o.kind };
    if (o.weakPointId) extra.weakPoint = o.weakPointId;
    if (o.kind === 'riposte') extra.riposte = true;
    const r = this._damageEvent(actor, target, dmg, o.element, o.hitIndex ?? null, events, extra);
    res.amount = dmg.amount;
    res.damaged = dmg.amount > 0;
    res.killed = r.killed;
    if (r.killed) {
      const ap = P.killApBonus(actor);
      if (ap > 0) this._gainAp(actor, ap, events);
    } else if (res.damaged && target.side === 'enemy') {
      const amount = num(o.breakAmount, Math.round(num(o.power, 1) * 10)) * P.breakPowerMult(actor);
      this._addBreak(target, amount, events);
    }
    if (o.kind === 'shot' && res.damaged && target.alive) {
      const c = P.shotMarkChance(actor);
      if (c > 0 && this._chance(c)) this._applyStatusTo(target, 'mark', null, events);
    }
    return res;
  }

  _bonusVsApplies(bonusVs, target) {
    if (bonusVs.broken && target.broken) return true;
    if (bonusVs.status && hasStatus(target, bonusVs.status)) return true;
    return false;
  }

  _enemyStrike(attacker, target, hit, plan, events) {
    const dmgTakenMult = this.dmgTakenMult * (attacker.boss ? this.bossDmgMult : 1);
    const dmg = computeDamage({
      attacker, target, power: hit.power, element: hit.element, rng: this.rng, kind: 'enemy', dmgTakenMult,
    });
    const r = this._damageEvent(attacker, target, dmg, hit.element, hit.index, events, { kind: 'enemy' });
    if (dmg.amount <= 0) return;
    this.stats.hitsTaken += 1;
    if (!target.alive) return;
    this._addSurge(target, 1, events);
    if (target.mechanic?.type === 'stance' && target.mechanic.value !== 'neutral') {
      target.mechanic.value = 'neutral';
      this._mechanicEvent(target, events);
      this._log(`${target.name} is knocked out of her stance.`);
    }
    if (!plan._hurtAp.has(target.id)) {
      const ap = P.hurtApBonus(target);
      if (ap > 0) {
        plan._hurtAp.add(target.id);
        this._gainAp(target, ap, events);
      }
    }
    if (hit.status?.id && !r.killed && this._chance(num(hit.status.chance, 1))) {
      this._applyStatusTo(target, hit.status.id, hit.status.turns, events);
    }
  }

  /**
   * Applies damage (practice floors, secondWind, mark consumption, KO) and emits damage/ko events.
   * @returns {{ killed: boolean }}
   */
  _damageEvent(source, target, dmg, element, hitIndex, events, extra = {}) {
    let amount = Math.max(0, Math.round(dmg.amount));
    let secondWind = false;
    if (amount > 0) {
      let hp = target.hp - amount;
      if (this.practice) hp = Math.max(1, hp);
      if (hp <= 0 && target.side === 'party' && !target.flags.secondWindUsed && P.hasSecondWind(target)) {
        hp = 1;
        target.flags.secondWindUsed = true;
        secondWind = true;
      }
      target.hp = Math.max(0, Math.round(hp));
      if (target.side === 'party') this.stats.damageTaken += amount;
      else this.stats.damageDealt += amount;
    }
    events.push({
      type: 'damage',
      targetId: target.id,
      sourceId: source?.id ?? null,
      amount,
      crit: !!dmg.crit,
      element: element ?? 'physical',
      affinity: dmg.affinity ?? null,
      hpAfter: target.hp,
      hitIndex,
      ...extra,
    });
    if (source) {
      const tags = [dmg.crit && 'critical', dmg.affinity].filter(Boolean);
      this._log(
        dmg.affinity === 'immune'
          ? `${target.name} is immune to ${element}.`
          : `${target.name} takes ${amount} damage${tags.length ? ` (${tags.join(', ')})` : ''}.`,
      );
    }
    if (amount > 0 && dmg.marked && removeStatus(target, 'mark')) {
      events.push({ type: 'statusEnd', targetId: target.id, status: 'mark' });
    }
    if (secondWind) {
      events.push({ type: 'text', text: 'Second Wind!', style: 'info', targetId: target.id });
      this._log(`${target.name} refuses to fall — Second Wind!`);
    }
    if (amount > 0 && target.hp <= 0 && target.alive) {
      this._ko(target);
      events.push({ type: 'ko', targetId: target.id });
      return { killed: true };
    }
    return { killed: false };
  }

  _ko(target) {
    target.alive = false;
    target.hp = 0;
    clearStatuses(target);
    target.initiative = 0;
    if (target.side === 'party') {
      target.ap = 0;
      if (target.mechanic?.type === 'stance') target.mechanic.value = 'neutral';
      this._log(`${target.name} falls!`);
    } else {
      target.broken = false;
      target.breakValue = 0;
      this.stats.kills += 1;
      this._log(`${target.name} is defeated.`);
    }
  }

  _heal(target, amount, events, logPrefix = null) {
    if (!target?.alive) return 0;
    const before = target.hp;
    target.hp = Math.min(target.stats.maxHp, target.hp + Math.max(0, Math.round(amount)));
    const actual = target.hp - before;
    if (target.side === 'party') this.stats.healing += actual;
    events.push({ type: 'heal', targetId: target.id, amount: actual, hpAfter: target.hp });
    this._log(`${logPrefix ?? `${target.name} recovers`} ${actual} HP.`);
    return actual;
  }

  _addBreak(target, amount, events) {
    if (!target.alive || target.side !== 'enemy' || target.broken || !(target.breakMax > 0)) return;
    const add = Math.round(amount);
    if (add <= 0) return;
    target.breakValue = Math.min(target.breakMax, target.breakValue + add);
    events.push({ type: 'break', targetId: target.id, value: target.breakValue, max: target.breakMax });
    if (target.breakValue >= target.breakMax) {
      target.broken = true;
      this.stats.breaks += 1;
      events.push({ type: 'broken', targetId: target.id });
      this._log(`${target.name} is BROKEN!`);
      this._applyStatusTo(target, 'stun', 1, events);
      this._applyStatusTo(target, 'defenseless', 2, events);
    }
  }

  _changeShields(target, delta, events) {
    const before = target.shields;
    target.shields = Math.max(0, before + delta);
    const d = target.shields - before;
    if (d !== 0) events.push({ type: 'shield', targetId: target.id, delta: d, shieldsAfter: target.shields });
    return d;
  }

  // ---- Internals: resources & mechanics -----------------------------------------------------------------

  _gainAp(member, amount, events) {
    if (!member || member.side !== 'party' || !member.alive) return 0;
    const before = member.ap;
    member.ap = clamp(Math.round(before + amount), 0, MAX_AP);
    const d = member.ap - before;
    if (d !== 0) events.push({ type: 'ap', targetId: member.id, delta: d, apAfter: member.ap });
    return d;
  }

  _gradientDelta(delta, events) {
    const before = this.gradient;
    this.gradient = clamp(Math.round(before + delta), 0, GRADIENT_MAX);
    const d = this.gradient - before;
    if (d !== 0) {
      events.push({ type: 'gradient', value: this.gradient, charges: this.gradientCharges(), delta: d });
      if (d > 0 && Math.floor(before / GRADIENT_CHARGE) < this.gradientCharges()) {
        this._log(`The Prism gauge holds ${this.gradientCharges()} charge${this.gradientCharges() > 1 ? 's' : ''}.`);
      }
    }
    return d;
  }

  /** Team gradient gain × the best gradientGain multiplier among the contributing party members. */
  _gainGradient(amount, members, events) {
    const party = (members ?? []).filter((m) => m?.side === 'party');
    const mult = party.length ? Math.max(...party.map((m) => P.gradientGainMult(m))) : 1;
    return this._gradientDelta(amount * mult, events);
  }

  _mechanicEvent(member, events) {
    events.push({ type: 'mechanic', targetId: member.id, mechanic: copyMechanic(member.mechanic) });
  }

  _addSurge(member, amount, events) {
    const m = member?.mechanic;
    if (!m || m.type !== 'surge' || !member.alive) return;
    const next = clamp(m.value + Math.round(amount), 0, SURGE_MAX);
    if (next === m.value) return;
    m.value = next;
    this._mechanicEvent(member, events);
  }

  _addGlyph(member, glyph, events) {
    const m = member?.mechanic;
    if (!m || m.type !== 'glyphs' || !GLYPH_ELEMENTS[glyph]) return;
    m.list.push(glyph);
    while (m.list.length > GLYPH_MAX) m.list.shift();
    this._mechanicEvent(member, events);
  }

  _setStance(member, to, events) {
    const m = member?.mechanic;
    if (!m || m.type !== 'stance' || !STANCES.includes(to)) return;
    const next = to === 'assault' && (m.value === 'assault' || m.value === 'virtuoso') ? 'virtuoso' : to;
    if (next === m.value) return;
    m.value = next;
    this._mechanicEvent(member, events);
    this._log(`${member.name} enters ${next === 'virtuoso' ? 'Bravura' : `${next[0].toUpperCase()}${next.slice(1)}`} stance.`);
  }

  _applyStatusTo(target, status, turns, events) {
    if (!target) return false;
    const fresh = this.turn.actorId === target.id && !this.turn.ended;
    const r = applyStatus(target, status, turns, { fresh });
    const name = STATUS_DEFS[status]?.name ?? status;
    if (r.applied) {
      events.push({ type: 'status', targetId: target.id, status, turns: r.turns });
      this._log(`${target.name} ${r.refreshed ? 'renews' : 'gains'} ${name} (${r.turns}).`);
      return true;
    }
    if (r.reason === 'resist' || r.reason === 'immune') {
      events.push({ type: 'text', text: r.reason === 'immune' ? 'Immune' : 'Resisted', style: 'info', targetId: target.id, status });
      this._log(`${target.name} ${r.reason === 'immune' ? 'is immune to' : 'resists'} ${name}.`);
    }
    return false;
  }

  // ---- Internals: effects -------------------------------------------------------------------------------

  _effectTargets(eff, ctx, { dead = false } = {}) {
    const source = ctx.source;
    const own = source.side === 'party' ? this.party : this.enemies;
    const other = source.side === 'party' ? this.enemies : this.party;
    const want = (c) => (dead ? !c.alive : c.alive);
    switch (eff.target) {
      case 'self':
        return want(source) ? [source] : [];
      case 'allies':
        return own.filter(want);
      case 'enemies':
        return other.filter(want);
      case 'target':
      default:
        return (ctx.targetIds ?? []).map((id) => this.get(id)).filter((c) => c && want(c));
    }
  }

  /**
   * Applies Effect objects (closed set, SPEC §4.8) from `ctx.source`. Targets: 'self' | 'allies' (source side)
   * | 'enemies' (other side) | 'target' (ctx.targetIds, the default).
   */
  _applyEffects(effects, ctx, events) {
    const source = ctx.source;
    for (const eff of effects ?? []) {
      if (!eff || typeof eff !== 'object') continue;
      switch (eff.type) {
        case 'status':
          for (const t of this._effectTargets(eff, ctx)) {
            if (this._chance(num(eff.chance, 1))) this._applyStatusTo(t, eff.status, eff.turns, events);
          }
          break;
        case 'heal':
          for (const t of this._effectTargets(eff, ctx)) {
            const amount = computeHeal({ healer: source, target: t, pct: eff.pct ?? null, power: eff.power ?? null });
            if (amount > 0) this._heal(t, amount, events);
          }
          break;
        case 'revive':
          for (const t of this._effectTargets(eff, ctx, { dead: true })) this._revive(t, num(eff.pct, 0.5), source, events);
          break;
        case 'ap':
          for (const t of this._effectTargets(eff, ctx)) this._gainAp(t, num(eff.amount, 1), events);
          break;
        case 'cleanse':
          for (const t of this._effectTargets(eff, ctx)) {
            const ids = cleanseStatuses(t);
            for (const id of ids) events.push({ type: 'statusEnd', targetId: t.id, status: id });
            if (ids.length) this._log(`${t.name} is cleansed.`);
          }
          break;
        case 'dispel':
          for (const t of this._effectTargets(eff, ctx)) {
            const ids = dispelStatuses(t);
            for (const id of ids) events.push({ type: 'statusEnd', targetId: t.id, status: id });
            if (ids.length) this._log(`${t.name}'s blessings are stripped away.`);
          }
          break;
        case 'shieldBreak':
          for (const t of this._effectTargets(eff, ctx)) {
            if (t.side === 'party' || t.shields <= 0) continue;
            this._changeShields(t, -Math.max(1, Math.round(num(eff.amount, 1))), events);
            this._log(`${t.name}'s shields crack (${t.shields} left).`);
          }
          break;
        case 'break':
          for (const t of this._effectTargets(eff, ctx)) {
            if (t.side !== 'enemy') continue;
            this._addBreak(t, num(eff.amount, 0) * (source.side === 'party' ? P.breakPowerMult(source) : 1), events);
          }
          break;
        case 'gradient':
          // Party sources scale with gradientGain; an enemy effect applies its raw amount (e.g. a drain).
          if (source.side === 'party') this._gainGradient(num(eff.amount, 0), [source], events);
          else this._gradientDelta(num(eff.amount, 0), events);
          break;
        case 'surge':
          this._addSurge(source, num(eff.amount, 1), events);
          break;
        case 'glyph':
          this._addGlyph(source, eff.add, events);
          break;
        case 'stance':
          this._setStance(source, eff.to, events);
          break;
        case 'shield': {
          const targets = this._effectTargets({ ...eff, target: eff.target ?? 'self' }, ctx);
          for (const t of targets) {
            if (t.side !== 'enemy') continue;
            const amount = Math.max(1, Math.round(num(eff.amount, 1)));
            const cap = Math.max(t.maxShields, amount);
            const d = this._changeShields(t, Math.max(0, Math.min(amount, cap - t.shields)), events);
            if (d > 0) this._log(`${t.name} raises ${d} shield${d > 1 ? 's' : ''}.`);
          }
          break;
        }
        default:
          warnOnce(`BattleModel: unknown effect type "${eff.type}" ignored`);
      }
    }
  }

  _revive(target, pct, source, events) {
    if (target.alive) return;
    target.alive = true;
    target.hp = Math.max(1, Math.min(target.stats.maxHp, Math.round(clamp(pct, 0, 1) * target.stats.maxHp)));
    target.statuses = [];
    target.initiative = 0;
    if (target.side === 'party') target.ap = 0;
    events.push({ type: 'revive', targetId: target.id, hpAfter: target.hp });
    this._log(`${target.name} is revived${source && source !== target ? ` by ${source.name}` : ''}!`);
  }

  // ---- Internals: phases, rng, log ------------------------------------------------------------------------

  _checkPhases() {
    const events = [];
    for (const e of this.enemies) {
      if (!e.alive || !e.phases.length) continue;
      while (e.phaseIndex < e.phases.length) {
        const ph = e.phases[e.phaseIndex];
        if (!(e.hp / e.stats.maxHp < num(ph?.hpBelow, 0))) break;
        e.phaseIndex += 1;
        const sm = ph.statMult ?? {};
        e.stats.spd = Math.max(1, e.baseStats.spd * num(sm.spd, 1));
        e.stats.atk = e.baseStats.atk * num(sm.atk, 1);
        events.push({ type: 'phase', targetId: e.id, phaseIndex: e.phaseIndex, text: ph.text ?? '' });
        this._log(ph.text || `${e.name} changes its stance.`);
        if (Array.isArray(ph.effects) && ph.effects.length) {
          this._applyEffects(ph.effects, { source: e, targetIds: this.living('party').map((m) => m.id) }, events);
        }
      }
    }
    return events;
  }

  _chance(p) {
    if (!(p > 0)) return false;
    if (p >= 1) return true;
    return this.rng.next() < p;
  }

  _log(line) {
    this.log.push(line);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  _noteOutcome() {
    if (this._outcomeLogged) return;
    const o = this.outcome();
    if (!o) return;
    this._outcomeLogged = true;
    if (o === 'victory') this._log(this.practice ? 'Practice complete.' : 'Victory! The way forward is clear.');
    else if (o === 'defeat') this._log('The expedition has fallen…');
    else this._log('The expedition withdraws.');
  }
}
