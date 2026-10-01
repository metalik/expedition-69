// Persistent RPG game state for Expedition 69: new game, battle hand-off (PartySnapshot), rewards, resting,
// attributes, skills, relics & echoes, items, loot, shops, save/load (SPEC §4.9) plus view helpers for the UI.
// Pure except save/load helpers, which touch globalThis.localStorage only inside guarded functions.

import { CHARACTERS, PARTY_ORDER } from '../data/characters.js';
import { SKILLS } from '../data/skills.js';
import {
  RELICS, STARTING_RELICS, MASTERY_BATTLES, DUPE_GLINT, RARITY_LABELS, formatStats, passiveText,
} from '../data/relics.js';
import { ITEMS, ITEM_ORDER, UPGRADES } from '../data/items.js';
import { SHOPS } from '../data/shops.js';
import {
  ATTRS, MAX_LEVEL, xpToNext, derivedStats, statBreakdown, relicStatBonus, grantXp, echoCapacity, echoLoad,
} from './progression.js';
import { DIFFICULTY } from '../battle/qte.js';

/** localStorage key of the single save slot. */
export const SAVE_KEY = 'exp69.save.v1';
/** Current GameState schema version. */
export const STATE_VERSION = 1;
/** Relic slots per character. */
export const RELIC_SLOTS = 3;
/**
 * Fraction of max HP everyone recovers after a battle, unless the summary's difficulty sets its own
 * `postBattleRecovery` (Veteran: 0 — HP only comes back from items and resting at a pennant).
 */
export const POST_BATTLE_RECOVERY = 0.2;

/** Default attribute weights used by autoAllocate (per character build identity). */
export const AUTO_ALLOCATE_WEIGHTS = {
  gideon: { vitality: 0.34, might: 0.26, agility: 0.1, defense: 0.26, luck: 0.04 },
  nyra: { vitality: 0.26, might: 0.36, agility: 0.18, defense: 0.12, luck: 0.08 },
  sable: { vitality: 0.18, might: 0.32, agility: 0.24, defense: 0.08, luck: 0.18 },
};

const STAT_KEYS = ['battles', 'victories', 'deaths', 'parries', 'perfectDodges', 'dodges', 'jumps', 'gradientCounters', 'perfects', 'playTimeMs'];
const WORLD_FLAG_MAPS = ['defeated', 'bosses', 'chests', 'journals', 'story', 'hintsSeen'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ───────────────────────────── small helpers ─────────────────────────────

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v, d = 0, min = -Infinity, max = Infinity) => (isNum(v) ? Math.min(max, Math.max(min, Math.floor(v))) : d);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const ok = (extra) => ({ ok: true, ...(extra || {}) });
const fail = (reason) => ({ ok: false, reason });

// Own-property lookups: ids may come from saves, UI or other modules, so never resolve inherited keys
// such as "constructor" or "__proto__".
const own = (table, key) => (typeof key === 'string' && table && Object.hasOwn(table, key) ? table[key] : undefined);
const relicDef = (id) => own(RELICS, id);
const skillDef = (id) => own(SKILLS, id);
const charDefOf = (id) => own(CHARACTERS, id);
const itemDef = (id) => own(ITEMS, id);
const upgradeDef = (id) => own(UPGRADES, id);
const shopDef = (id) => own(SHOPS, id);
const relicRec = (state, id) => own(state?.relics, id);

/**
 * Finds a party member by character id.
 * @param {Object} state
 * @param {string} charId
 * @returns {Object|null}
 */
export function getMember(state, charId) {
  if (!state || !Array.isArray(state.party)) return null;
  return state.party.find((m) => m && m.id === charId) ?? null;
}

/** Runs `fn`, then shifts current HP by the change in max HP (alive members stay ≥ 1 HP). */
function preservingHp(member, fn) {
  const before = derivedStats(member).maxHp;
  fn();
  const after = derivedStats(member).maxHp;
  if (member.alive !== false && member.hp > 0) {
    member.hp = Math.min(after, Math.max(1, Math.round(member.hp + (after - before))));
  } else {
    member.hp = Math.min(Math.max(0, member.hp || 0), after);
  }
}

function skillName(id) {
  return skillDef(id)?.name ?? id;
}

// ───────────────────────────── creation ─────────────────────────────

function newMember(id) {
  const c = charDefOf(id);
  const m = {
    id,
    level: 1,
    xp: 0,
    attrs: { vitality: 0, might: 0, agility: 0, defense: 0, luck: 0 },
    attrPoints: 0,
    sp: 0,
    skills: [...c.startingSkills],
    relics: [STARTING_RELICS[id] ?? null, null, null],
    echoes: [],
    hp: 0,
    alive: true,
  };
  m.hp = derivedStats(m).maxHp;
  return m;
}

function newWorld() {
  return {
    zone: 'shore',
    x: 0,
    y: 0,
    facing: 'down',
    lastFlag: null,
    defeated: {},
    bosses: {},
    chests: {},
    journals: {},
    flagsVisited: {},
    story: {},
    hintsSeen: {},
  };
}

function newStats() {
  const s = {};
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
}

/**
 * Creates a fresh level-1 expedition: all three members with starting skills and relics (owned + equipped),
 * full HP and items, 0 Glint, world at zone 'shore' tile (0,0) (the world scene sets the real start).
 * @param {{seed?:number}} [opts]
 * @returns {Object} GameState
 */
export function createNewGame({ seed } = {}) {
  const items = {};
  for (const id of ITEM_ORDER) items[id] = { count: itemDef(id).baseMax, max: itemDef(id).baseMax };
  const relics = {};
  for (const id of PARTY_ORDER) {
    const r = STARTING_RELICS[id];
    if (r) relics[r] = { battles: 0, mastered: false };
  }
  return {
    version: STATE_VERSION,
    seed: isNum(seed) ? seed >>> 0 : Date.now() % 4294967296 >>> 0,
    party: PARTY_ORDER.map(newMember),
    items,
    relics,
    glint: 0,
    world: newWorld(),
    stats: newStats(),
    shops: {},
  };
}

// ───────────────────────────── battle hand-off ─────────────────────────────

/**
 * Passives a member brings into battle: equipped relics first, then echoes. An echo whose relic is also
 * equipped on the same member is ignored (no stacking); duplicate echoes are ignored.
 * @param {Object} member
 * @param {Object} [state]  When given, echoes of relics that are not mastered are ignored.
 * @returns {Array<{id:string, params:Object, source:string, from:'relic'|'echo', name:string}>}
 */
export function collectPassives(member, state = null) {
  const out = [];
  if (!member) return out;
  const equipped = new Set();
  for (const rid of member.relics ?? []) {
    const r = rid && relicDef(rid);
    if (!r || equipped.has(rid)) continue;
    equipped.add(rid);
    out.push({ id: r.passive.id, params: clone(r.passive.params ?? {}), source: rid, from: 'relic', name: r.name });
  }
  const echoed = new Set();
  for (const rid of member.echoes ?? []) {
    const r = relicDef(rid);
    if (!r || equipped.has(rid) || echoed.has(rid)) continue;
    if (state && !relicRec(state, rid)?.mastered) continue;
    echoed.add(rid);
    out.push({ id: r.passive.id, params: clone(r.passive.params ?? {}), source: rid, from: 'echo', name: r.name });
  }
  return out;
}

/**
 * Builds the PartySnapshot[] the BattleModel receives (SPEC §4.9), in party order.
 * @param {Object} state
 * @returns {Array<Object>} [{ id, name, look, level, stats:{maxHp,atk,def,spd,crit}, hp, alive, skills, gradientSkill,
 *   passives:[{id, params, source}], mechanic, shotElement, basicAttack, title, color }]
 */
export function toBattleParty(state) {
  if (!state || !Array.isArray(state.party)) return [];
  return state.party
    .filter((m) => m && charDefOf(m.id))
    .map((m) => {
      const c = charDefOf(m.id);
      const stats = derivedStats(m);
      const hp = Math.min(stats.maxHp, Math.max(0, Math.round(isNum(m.hp) ? m.hp : stats.maxHp)));
      const alive = m.alive !== false && hp > 0;
      return {
        id: m.id,
        name: c.name,
        title: c.title,
        look: c.look,
        color: c.color,
        level: m.level,
        stats,
        hp: alive ? hp : 0,
        alive,
        skills: (m.skills ?? []).filter((sid) => skillDef(sid) && skillDef(sid).owner === m.id && !skillDef(sid).gradient),
        gradientSkill: c.gradientSkill,
        passives: collectPassives(m, state),
        mechanic: c.mechanic,
        shotElement: c.shotElement,
        basicAttack: clone(c.basicAttack),
      };
    });
}

// ───────────────────────────── battle results ─────────────────────────────

function xpShareFor(summary, memberId, wasKo) {
  const by = summary.xpByMember;
  if (Array.isArray(by)) {
    const e = by.find((x) => x && x.id === memberId);
    if (e && isNum(e.xp)) return Math.max(0, Math.floor(e.xp));
  } else if (isObj(by) && isNum(by[memberId])) {
    return Math.max(0, Math.floor(by[memberId]));
  }
  const base = Math.max(0, Math.floor(isNum(summary.xp) ? summary.xp : 0));
  return wasKo ? Math.floor(base / 2) : base;
}

/** Writes battle HP back (KO'd → 1 HP, alive again); returns id → was KO'd at the end of the battle. */
function writeBackHp(state, summary) {
  const ko = {};
  const entries = Array.isArray(summary?.party) ? summary.party : [];
  for (const m of state.party) {
    const e = entries.find((x) => x && x.id === m.id);
    const maxHp = derivedStats(m).maxHp;
    if (e) {
      const hp = isNum(e.hp) ? Math.round(e.hp) : m.hp;
      ko[m.id] = e.alive === false || !(hp > 0);
      m.hp = ko[m.id] ? 1 : Math.min(maxHp, Math.max(1, hp));
    } else {
      ko[m.id] = m.alive === false || !(m.hp > 0);
      if (ko[m.id]) m.hp = 1;
    }
    m.alive = true;
  }
  return ko;
}

/**
 * Post-battle recovery fraction for a battle summary: its difficulty's `postBattleRecovery` (DIFFICULTY in qte.js),
 * else POST_BATTLE_RECOVERY (summaries without a known difficulty keep the classic 20%).
 * @param {{difficulty?:string}} [summary]
 * @returns {number}
 */
export function postBattleRecoveryFor(summary) {
  const d = own(DIFFICULTY, summary?.difficulty);
  return isNum(d?.postBattleRecovery) ? Math.min(1, Math.max(0, d.postBattleRecovery)) : POST_BATTLE_RECOVERY;
}

function recoverAfterBattle(state, fraction) {
  for (const m of state.party) {
    const maxHp = derivedStats(m).maxHp;
    m.hp = Math.min(maxHp, Math.max(1, Math.round((m.hp || 0) + maxHp * fraction)));
    m.alive = true;
  }
}

/**
 * Post-battle HP rules only (SPEC §3.2): write back battle HP, KO'd members return at 1 HP, then everyone
 * recovers 20% of max HP (none on Veteran — see postBattleRecoveryFor). applyBattleResult already does this for
 * every outcome; use this directly only when no other result should be applied.
 * @param {Object} state
 * @param {{party?:Array<{id:string, hp:number, alive:boolean}>, difficulty?:string}} summary
 * @returns {Record<string, boolean>} map of member id → was KO'd at the end of the battle
 */
export function applyPostBattleHp(state, summary) {
  if (!state || !Array.isArray(state.party)) return {};
  const ko = writeBackHp(state, summary);
  recoverAfterBattle(state, postBattleRecoveryFor(summary));
  return ko;
}

/**
 * Writes consumable use back to the state. Prefers summary.itemsUsed ({id: n}, a delta that is correct whether or
 * not the scene passed the inventory to the model); falls back to summary.items counts, which can only lower a
 * count (never refill it).
 */
function writeBackItems(state, summary) {
  if (!isObj(state.items)) return;
  const used = isObj(summary?.itemsUsed) ? summary.itemsUsed : null;
  const after = isObj(summary?.items) ? summary.items : null;
  for (const id of ITEM_ORDER) {
    const inv = state.items[id];
    if (!isObj(inv)) continue;
    if (used) {
      const n = int(used[id], 0, 0);
      if (n) inv.count = Math.max(0, inv.count - n);
    } else if (after) {
      const src = after[id];
      const n = isNum(src) ? src : isObj(src) && isNum(src.count) ? src.count : null;
      if (n !== null) inv.count = Math.max(0, Math.min(inv.count, Math.floor(n)));
    }
  }
}

/** Skills whose learn level lies in (oldLevel, member.level] and that are not yet learned. */
function newlyUnlockedSkills(member, oldLevel) {
  const out = [];
  for (const s of Object.values(SKILLS)) {
    if (s.owner !== member.id || s.gradient || member.skills.includes(s.id)) continue;
    if (s.learn.level > oldLevel && s.learn.level <= member.level) out.push({ id: member.id, skillId: s.id });
  }
  return out;
}

/**
 * Applies a BattleModel summary to the game state (SPEC §4.9). On victory: XP (per summary.xpByMember if present,
 * else summary.xp to members alive at the end and half to KO'd ones), level-ups, Glint, relic drops (duplicates
 * convert to Glint), +1 battle for every equipped relic (mastered at 4 → echo available), counters. Every
 * outcome writes back HP (KO → 1 HP, then +20% max HP — none when summary.difficulty is Veteran) and consumed items
 * (summary.itemsUsed or summary.items).
 * `summary.practice` / `opts.practice` skip everything (training is free).
 * @param {Object} state
 * @param {{outcome?:string, difficulty?:string, xp?:number, xpByMember?:Object|Array, glint?:number,
 *   drops?:Array<string|{relic:string}>, party?:Array<{id,hp,alive}>, stats?:Object, items?:Object, itemsUsed?:Object,
 *   practice?:boolean}} summary
 * @param {{spawnId?:string, bossId?:string, practice?:boolean}} [opts]  Marks world.defeated / world.bosses on victory.
 * @returns {{ outcome:string, xpGained:number, xpByMember:Record<string,number>, glint:number, drops:string[],
 *   converted:Array<{id:string, glint:number}>, levelUps:Array<{id, level, attrPoints, sp}>, mastered:string[],
 *   newSkillsAvailable:Array<{id:string, skillId:string}> }}
 */
export function applyBattleResult(state, summary, opts = {}) {
  const outcome = summary?.outcome ?? 'victory';
  const res = {
    outcome,
    xpGained: 0,
    xpByMember: {},
    glint: 0,
    drops: [],
    converted: [],
    levelUps: [],
    mastered: [],
    newSkillsAvailable: [],
  };
  if (!state || !Array.isArray(state.party) || !summary) return res;
  if (summary.practice || opts.practice) return res;

  const ko = writeBackHp(state, summary);
  writeBackItems(state, summary);

  // Counters
  const st = (state.stats = isObj(state.stats) ? state.stats : newStats());
  for (const k of STAT_KEYS) if (!isNum(st[k])) st[k] = 0;
  st.battles += 1;
  const bs = isObj(summary.stats) ? summary.stats : {};
  for (const k of ['parries', 'perfectDodges', 'dodges', 'jumps', 'gradientCounters', 'perfects']) {
    st[k] += Math.max(0, Math.floor(isNum(bs[k]) ? bs[k] : 0));
  }
  if (outcome === 'defeat') st.deaths += 1;

  if (outcome === 'victory') {
    st.victories += 1;

    // XP & level-ups
    res.xpGained = Math.max(0, Math.floor(isNum(summary.xp) ? summary.xp : 0));
    for (const m of state.party) {
      const amount = xpShareFor(summary, m.id, ko[m.id]);
      res.xpByMember[m.id] = amount;
      if (amount > res.xpGained && summary.xp === undefined) res.xpGained = amount;
      const oldLevel = m.level;
      const ups = grantXp(m, amount);
      for (const u of ups) res.levelUps.push({ id: m.id, level: u.level, attrPoints: u.attrPoints, sp: u.sp });
      if (ups.length) res.newSkillsAvailable.push(...newlyUnlockedSkills(m, oldLevel));
    }

    // Glint
    const glint = Math.max(0, Math.floor(isNum(summary.glint) ? summary.glint : 0));
    state.glint = Math.max(0, Math.floor(isNum(state.glint) ? state.glint : 0)) + glint;
    res.glint = glint;

    // Relic progress (only relics equipped during the battle, i.e. before new drops are added)
    const equipped = new Set();
    for (const m of state.party) for (const rid of m.relics ?? []) if (rid) equipped.add(rid);
    for (const rid of equipped) {
      const rec = relicRec(state, rid);
      if (!rec) continue;
      rec.battles = Math.max(0, Math.floor(isNum(rec.battles) ? rec.battles : 0)) + 1;
      if (!rec.mastered && rec.battles >= MASTERY_BATTLES) {
        rec.mastered = true;
        res.mastered.push(rid);
      }
    }

    // Drops
    for (const d of Array.isArray(summary.drops) ? summary.drops : []) {
      const rid = typeof d === 'string' ? d : d?.relic;
      if (!rid || !relicDef(rid)) continue;
      if (relicRec(state, rid)) {
        const g = DUPE_GLINT[relicDef(rid).rarity] ?? DUPE_GLINT.common;
        state.glint += g;
        res.glint += g;
        res.converted.push({ id: rid, glint: g });
      } else {
        state.relics[rid] = { battles: 0, mastered: false };
        res.drops.push(rid);
      }
    }

    // World bookkeeping
    if (opts.spawnId) markDefeated(state, opts.spawnId);
    if (opts.bossId) markDefeated(state, opts.bossId, { boss: true });
  }

  recoverAfterBattle(state, postBattleRecoveryFor(summary));
  return res;
}

/**
 * Records a defeated roaming spawn (cleared again by resting) or a boss (permanent).
 * @param {Object} state
 * @param {string} id
 * @param {{boss?:boolean}} [opts]
 */
export function markDefeated(state, id, { boss = false } = {}) {
  if (!isObj(state?.world) || typeof id !== 'string' || !id || UNSAFE_KEYS.has(id)) return;
  const key = boss ? 'bosses' : 'defeated';
  if (!isObj(state.world[key])) state.world[key] = {};
  state.world[key][id] = true;
}

/**
 * Grants the same XP to every member (debug hooks / scripted rewards). Returns the same level-up shapes as
 * applyBattleResult.
 * @param {Object} state
 * @param {number} amount
 * @returns {{levelUps:Array<{id, level, attrPoints, sp}>, newSkillsAvailable:Array<{id, skillId}>}}
 */
export function grantPartyXp(state, amount) {
  const out = { levelUps: [], newSkillsAvailable: [] };
  for (const m of state?.party ?? []) {
    const oldLevel = m.level;
    for (const u of grantXp(m, amount)) out.levelUps.push({ id: m.id, level: u.level, attrPoints: u.attrPoints, sp: u.sp });
    out.newSkillsAvailable.push(...newlyUnlockedSkills(m, oldLevel));
  }
  return out;
}

// ───────────────────────────── flags ─────────────────────────────

/**
 * Marks an Expedition Pennant (internal id: flag) as visited (for fast travel) without resting.
 * @param {Object} state
 * @param {string} flagId
 * @param {{zone?:string, x?:number, y?:number, name?:string}} [info]  Defaults: previous record, then player position.
 * @returns {{zone:string, x:number, y:number, name:string}|null}
 */
export function visitFlag(state, flagId, info = {}) {
  if (!isObj(state?.world) || typeof flagId !== 'string' || !flagId || UNSAFE_KEYS.has(flagId)) return null;
  const w = state.world;
  if (!isObj(w.flagsVisited)) w.flagsVisited = {};
  const prev = isObj(w.flagsVisited[flagId]) ? w.flagsVisited[flagId] : {};
  const rec = {
    zone: typeof info.zone === 'string' ? info.zone : prev.zone ?? w.zone,
    x: isNum(info.x) ? info.x : isNum(prev.x) ? prev.x : w.x,
    y: isNum(info.y) ? info.y : isNum(prev.y) ? prev.y : w.y,
    name: typeof info.name === 'string' ? info.name : prev.name ?? flagId,
  };
  w.flagsVisited[flagId] = rec;
  return rec;
}

/**
 * Rest at an Expedition Pennant (internal id: flag): full heal & revive, refill item charges, respawn regular
 * enemies (bosses stay defeated), mark the pennant visited and make it the respawn point (world.lastFlag).
 * @param {Object} state
 * @param {string} flagId
 * @param {{zone?:string, x?:number, y?:number, name?:string}} [info]
 * @returns {{ok:boolean, reason?:string}}
 */
export function restAtFlag(state, flagId, info = {}) {
  if (!state || !Array.isArray(state.party)) return fail('No game in progress');
  if (typeof flagId !== 'string' || !flagId || UNSAFE_KEYS.has(flagId)) return fail('Unknown pennant');
  if (!isObj(state.world)) state.world = newWorld();
  for (const m of state.party) {
    m.hp = derivedStats(m).maxHp;
    m.alive = true;
  }
  for (const id of ITEM_ORDER) {
    const it = state.items?.[id];
    if (it) it.count = it.max;
  }
  state.world.defeated = {};
  const rec = visitFlag(state, flagId, info);
  state.world.lastFlag = { zone: rec.zone, flagId, x: rec.x, y: rec.y };
  return ok();
}

// ───────────────────────────── attributes & skills ─────────────────────────────

/**
 * Spends attribute points.
 * @param {Object} state
 * @param {string} charId
 * @param {'vitality'|'might'|'agility'|'defense'|'luck'} attr
 * @param {number} [n=1]
 * @returns {{ok:boolean, reason?:string}}
 */
export function allocateAttr(state, charId, attr, n = 1) {
  const m = getMember(state, charId);
  if (!m) return fail('Unknown character');
  if (!ATTRS.includes(attr)) return fail('Unknown attribute');
  if (!Number.isInteger(n) || n < 1) return fail('Invalid amount');
  if ((m.attrPoints ?? 0) < n) return fail('Not enough attribute points');
  preservingHp(m, () => {
    m.attrs[attr] = (m.attrs[attr] ?? 0) + n;
    m.attrPoints -= n;
  });
  return ok();
}

/**
 * Spends all of a character's attribute points following their build weights (AUTO_ALLOCATE_WEIGHTS),
 * always topping up the attribute furthest below its target share.
 * @param {Object} state
 * @param {string} charId
 * @returns {{ok:boolean, reason?:string, allocated?:Record<string, number>}}
 */
export function autoAllocate(state, charId) {
  const m = getMember(state, charId);
  if (!m) return fail('Unknown character');
  if (!(m.attrPoints > 0)) return fail('No attribute points to spend');
  const w = AUTO_ALLOCATE_WEIGHTS[charId] ?? { vitality: 0.2, might: 0.2, agility: 0.2, defense: 0.2, luck: 0.2 };
  const allocated = {};
  const cur = { ...m.attrs };
  let points = m.attrPoints;
  while (points > 0) {
    const total = ATTRS.reduce((s, a) => s + (cur[a] ?? 0), 0) + 1;
    let best = ATTRS[0];
    let bestDef = -Infinity;
    for (const a of ATTRS) {
      const deficit = (w[a] ?? 0) * total - (cur[a] ?? 0);
      if (deficit > bestDef + 1e-9) {
        bestDef = deficit;
        best = a;
      }
    }
    cur[best] = (cur[best] ?? 0) + 1;
    allocated[best] = (allocated[best] ?? 0) + 1;
    points -= 1;
  }
  for (const a of ATTRS) if (allocated[a]) allocateAttr(state, charId, a, allocated[a]);
  return ok({ allocated });
}

function learnCheck(m, skill) {
  if (!skill) return 'Unknown skill';
  if (skill.owner !== m.id) return `${charDefOf(m.id)?.name ?? m.id} cannot learn ${skill.name}`;
  if (skill.gradient) return 'Prism skills are innate';
  if (m.skills.includes(skill.id)) return 'Already learned';
  if (m.level < skill.learn.level) return `Requires level ${skill.learn.level}`;
  const missing = (skill.learn.requires ?? []).filter((r) => !m.skills.includes(r));
  if (missing.length) return `Requires ${missing.map(skillName).join(' and ')}`;
  if ((m.sp ?? 0) < skill.learn.sp) return `Needs ${skill.learn.sp} SP (have ${m.sp ?? 0})`;
  return null;
}

/**
 * Learns a skill: owner must match, level ≥ learn.level, every `requires` skill learned, enough SP.
 * @param {Object} state
 * @param {string} charId
 * @param {string} skillId
 * @returns {{ok:boolean, reason?:string}}
 */
export function learnSkill(state, charId, skillId) {
  const m = getMember(state, charId);
  if (!m) return fail('Unknown character');
  const s = skillDef(skillId);
  const reason = learnCheck(m, s);
  if (reason) return fail(reason);
  m.sp -= s.learn.sp;
  m.skills.push(skillId);
  return ok();
}

/**
 * All of a character's skills with their learn status, in learn order; the gradient skill comes last with
 * status 'innate'. Accepts (state, charId) or (charId, state?) — without a state, a fresh level-1 member is assumed.
 * @returns {Array<{id:string, skill:Object, name:string, ap:number, desc:string, short:string, gradient:boolean,
 *   level:number, sp:number, requires:Array<{id:string, name:string, learned:boolean}>,
 *   status:'learned'|'learnable'|'locked'|'innate', reason:string|null, canLearn:boolean}>}
 */
export function skillsFor(a, b) {
  let state = null;
  let charId;
  if (typeof a === 'string') {
    charId = a;
    state = b ?? null;
  } else {
    state = a;
    charId = b;
  }
  if (!charDefOf(charId)) return [];
  const m = getMember(state, charId) ?? newMember(charId);
  const list = Object.values(SKILLS)
    .filter((s) => s.owner === charId)
    .map((s, i) => ({ s, i }))
    .sort((x, y) => (x.s.gradient ? 1 : 0) - (y.s.gradient ? 1 : 0) || x.s.learn.level - y.s.learn.level || x.i - y.i)
    .map(({ s }) => {
      let status;
      let reason = null;
      if (s.gradient) status = 'innate';
      else if (m.skills.includes(s.id)) status = 'learned';
      else {
        reason = learnCheck(m, s);
        status = reason ? 'locked' : 'learnable';
      }
      return {
        id: s.id,
        skill: s,
        name: s.name,
        ap: s.ap,
        desc: s.desc,
        short: s.short,
        gradient: !!s.gradient,
        level: s.learn.level,
        sp: s.learn.sp,
        requires: (s.learn.requires ?? []).map((r) => ({ id: r, name: skillName(r), learned: m.skills.includes(r) })),
        status,
        reason,
        canLearn: status === 'learnable',
      };
    });
  return list;
}

// ───────────────────────────── relics & echoes ─────────────────────────────

/**
 * Where a relic is equipped.
 * @param {Object} state
 * @param {string} relicId
 * @returns {{charId:string, slot:number}|null}
 */
export function findRelicHolder(state, relicId) {
  for (const m of state?.party ?? []) {
    const i = (m.relics ?? []).indexOf(relicId);
    if (i >= 0) return { charId: m.id, slot: i };
  }
  return null;
}

/**
 * Equips (or with relicId null, clears) a relic slot. A relic lives on one character only: equipping it
 * elsewhere removes it from its previous holder; moving it between a character's own slots swaps them.
 * Current HP shifts with any max-HP change.
 * @param {Object} state
 * @param {string} charId
 * @param {number} slot  0..2
 * @param {string|null} relicId
 * @returns {{ok:boolean, reason?:string, movedFrom?:string}}
 */
export function equipRelic(state, charId, slot, relicId) {
  const m = getMember(state, charId);
  if (!m) return fail('Unknown character');
  if (!Number.isInteger(slot) || slot < 0 || slot >= RELIC_SLOTS) return fail('Invalid relic slot');
  if (!Array.isArray(m.relics)) m.relics = [null, null, null];
  while (m.relics.length < RELIC_SLOTS) m.relics.push(null);
  if (relicId === null || relicId === undefined) {
    preservingHp(m, () => { m.relics[slot] = null; });
    return ok();
  }
  if (!relicDef(relicId)) return fail('Unknown relic');
  if (!relicRec(state, relicId)) return fail('Relic not owned');
  if (m.relics[slot] === relicId) return ok();
  const holder = findRelicHolder(state, relicId);
  if (holder && holder.charId === charId) {
    preservingHp(m, () => {
      m.relics[holder.slot] = m.relics[slot];
      m.relics[slot] = relicId;
    });
    return ok();
  }
  let movedFrom;
  if (holder) {
    const other = getMember(state, holder.charId);
    preservingHp(other, () => { other.relics[holder.slot] = null; });
    movedFrom = holder.charId;
  }
  preservingHp(m, () => { m.relics[slot] = relicId; });
  return movedFrom ? ok({ movedFrom }) : ok();
}

/**
 * Equips a mastered relic's Echo on a character (any character; not twice on the same one; within capacity).
 * @param {Object} state
 * @param {string} charId
 * @param {string} relicId
 * @returns {{ok:boolean, reason?:string}}
 */
export function equipEcho(state, charId, relicId) {
  const m = getMember(state, charId);
  if (!m) return fail('Unknown character');
  const r = relicDef(relicId);
  if (!r) return fail('Unknown relic');
  const rec = relicRec(state, relicId);
  if (!rec) return fail('Relic not owned');
  if (!rec.mastered) return fail(`Not mastered yet (${Math.min(rec.battles ?? 0, MASTERY_BATTLES)}/${MASTERY_BATTLES} victories)`);
  if (!Array.isArray(m.echoes)) m.echoes = [];
  if (m.echoes.includes(relicId)) return fail('Echo already equipped');
  const load = echoLoad(m);
  const cap = echoCapacity(m.level);
  if (load + r.echoCost > cap) return fail(`Not enough echo capacity (${load}+${r.echoCost} > ${cap})`);
  m.echoes.push(relicId);
  return ok();
}

/**
 * Removes an Echo from a character.
 * @param {Object} state
 * @param {string} charId
 * @param {string} relicId
 * @returns {{ok:boolean, reason?:string}}
 */
export function unequipEcho(state, charId, relicId) {
  const m = getMember(state, charId);
  if (!m) return fail('Unknown character');
  const i = (m.echoes ?? []).indexOf(relicId);
  if (i < 0) return fail('Echo not equipped');
  m.echoes.splice(i, 1);
  return ok();
}

/**
 * Tooltip-ready description of a relic; with a state, includes ownership, mastery and who wears it.
 * @param {string} id
 * @param {Object} [state]
 * @returns {Object|null} { id, name, desc, rarity, rarityLabel, echoCost, price, stats, statsText, passive, passiveText,
 *   owned, battles, mastered, masteryText, equippedBy, echoedBy }
 */
export function describeRelic(id, state = null) {
  const r = relicDef(id);
  if (!r) return null;
  const rec = relicRec(state, id) ?? null;
  const holder = state ? findRelicHolder(state, id) : null;
  const battles = rec ? Math.max(0, rec.battles ?? 0) : 0;
  const mastered = !!rec?.mastered;
  return {
    id,
    name: r.name,
    desc: r.desc,
    rarity: r.rarity,
    rarityLabel: RARITY_LABELS[r.rarity] ?? r.rarity,
    echoCost: r.echoCost,
    price: r.price,
    stats: { ...r.stats },
    statsText: formatStats(r.stats),
    passive: clone(r.passive),
    passiveText: passiveText(r.passive),
    owned: !!rec,
    battles,
    mastered,
    masteryText: mastered ? 'Mastered — Echo available' : `Mastery ${Math.min(battles, MASTERY_BATTLES)}/${MASTERY_BATTLES} victories`,
    equippedBy: holder?.charId ?? null,
    echoedBy: (state?.party ?? []).filter((m) => (m.echoes ?? []).includes(id)).map((m) => m.id),
  };
}

/**
 * Every owned relic with its description and holder, sorted by name (relic menu).
 * @param {Object} state
 * @returns {Array<Object>} describeRelic() results
 */
export function relicInventory(state) {
  return Object.keys(state?.relics ?? {})
    .filter((id) => relicDef(id))
    .map((id) => describeRelic(id, state))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * Mastered echoes and whether a character can equip each (echo menu).
 * @param {Object} state
 * @param {string} charId
 * @returns {Array<{id, name, echoCost, passiveText, equipped:boolean, suppressed:boolean, canEquip:boolean, reason:string|null}>}
 */
export function echoOptions(state, charId) {
  const m = getMember(state, charId);
  if (!m) return [];
  const load = echoLoad(m);
  const cap = echoCapacity(m.level);
  return Object.keys(state.relics ?? {})
    .filter((id) => relicDef(id) && relicRec(state, id).mastered)
    .sort((x, y) => relicDef(x).name.localeCompare(relicDef(y).name))
    .map((id) => {
      const r = relicDef(id);
      const equipped = (m.echoes ?? []).includes(id);
      const suppressed = equipped && (m.relics ?? []).includes(id);
      let reason = null;
      if (!equipped && load + r.echoCost > cap) reason = `Needs ${r.echoCost} capacity (${cap - load} free)`;
      return {
        id, name: r.name, echoCost: r.echoCost, passiveText: passiveText(r.passive),
        equipped, suppressed, canEquip: !equipped && !reason, reason,
      };
    });
}

// ───────────────────────────── items ─────────────────────────────

/**
 * Whether an item can be used on a character outside battle (no mutation).
 * @param {Object} state
 * @param {string} itemId
 * @param {string} charId
 * @returns {{ok:boolean, reason?:string}}
 */
export function canUseItemOutOfBattle(state, itemId, charId) {
  const item = itemDef(itemId);
  if (!item) return fail('Unknown item');
  const m = getMember(state, charId);
  if (!m) return fail('Unknown character');
  if (!item.fieldUse) return fail(`${item.name} can only be used in battle`);
  const inv = state.items?.[itemId];
  if (!inv || inv.count <= 0) return fail(`No ${item.name} left`);
  const alive = m.alive !== false && m.hp > 0;
  const maxHp = derivedStats(m).maxHp;
  if (item.target === 'deadAlly') {
    if (alive) return fail(`${charDefOf(m.id).name} is not KO'd`);
  } else {
    if (!alive) return fail(`${charDefOf(m.id).name} is KO'd`);
    if (item.effects.some((e) => e.type === 'heal') && m.hp >= maxHp) return fail('Already at full HP');
  }
  return ok();
}

/**
 * Uses a field item: Amber Tincture heals a living ally, Rousing Tonic revives a KO'd one; Clockspring
 * Draught is battle-only.
 * @param {Object} state
 * @param {string} itemId
 * @param {string} charId
 * @returns {{ok:boolean, reason?:string, amount?:number}}  amount = HP restored
 */
export function useItemOutOfBattle(state, itemId, charId) {
  const check = canUseItemOutOfBattle(state, itemId, charId);
  if (!check.ok) return check;
  const item = itemDef(itemId);
  const m = getMember(state, charId);
  const maxHp = derivedStats(m).maxHp;
  const before = m.alive !== false && m.hp > 0 ? m.hp : 0;
  for (const e of item.effects) {
    if (e.type === 'heal' && isNum(e.pct)) {
      m.hp = Math.min(maxHp, Math.round(m.hp + e.pct * maxHp));
    } else if (e.type === 'revive' && isNum(e.pct)) {
      m.alive = true;
      m.hp = Math.max(1, Math.min(maxHp, Math.round(e.pct * maxHp)));
    }
  }
  state.items[itemId].count -= 1;
  return ok({ amount: m.hp - before });
}

// ───────────────────────────── loot & shops ─────────────────────────────

function applyShard(state, shardId) {
  const up = upgradeDef(shardId);
  if (!up) return null;
  const inv = state.items[up.item] ?? (state.items[up.item] = { count: 0, max: itemDef(up.item)?.baseMax ?? 0 });
  inv.max += 1;
  inv.count = Math.min(inv.max, inv.count + 1);
  return `${up.name} — ${itemDef(up.item)?.name ?? up.item} charges raised to ${inv.max}`;
}

function gainRelic(state, relicId) {
  const r = relicDef(relicId);
  if (!r) return null;
  if (relicRec(state, relicId)) {
    const g = DUPE_GLINT[r.rarity] ?? DUPE_GLINT.common;
    state.glint += g;
    return `${r.name} (duplicate) — converted to ${g} Glint`;
  }
  state.relics[relicId] = { battles: 0, mastered: false };
  return `Relic found: ${r.name}`;
}

/**
 * Adds chest / scripted loot and returns a human-readable description.
 * loot: {relic:id} | {shard:id} | {glint:n} | {item:id, count?:n} (arrays of these are accepted too).
 * Duplicate relics convert to Glint by rarity (DUPE_GLINT).
 * @param {Object} state
 * @param {Object|Object[]} loot
 * @returns {string}
 */
export function addLoot(state, loot) {
  if (!state) return '';
  if (Array.isArray(loot)) return loot.map((l) => addLoot(state, l)).filter(Boolean).join(' · ');
  if (!isObj(loot)) return 'Nothing of note';
  if (!isNum(state.glint)) state.glint = 0;
  if (!isObj(state.relics)) state.relics = {};
  if (!isObj(state.items)) state.items = {};
  const parts = [];
  if (typeof loot.relic === 'string') parts.push(gainRelic(state, loot.relic) ?? 'An unrecognisable trinket crumbles to dust');
  if (typeof loot.shard === 'string') parts.push(applyShard(state, loot.shard) ?? 'A dull shard with no power left');
  if (isNum(loot.glint) && loot.glint > 0) {
    const g = Math.floor(loot.glint);
    state.glint += g;
    parts.push(`+${g} Glint`);
  }
  if (typeof loot.item === 'string') {
    const item = itemDef(loot.item);
    const inv = state.items[loot.item];
    if (item && inv) {
      const n = Math.max(1, Math.floor(isNum(loot.count) ? loot.count : 1));
      const before = inv.count;
      inv.count = Math.min(inv.max, inv.count + n);
      parts.push(inv.count > before ? `${item.name} ×${inv.count - before}` : `${item.name} (charges already full)`);
    } else {
      parts.push('A broken vial');
    }
  }
  return parts.length ? parts.join(' · ') : 'Nothing of note';
}

function purchasesOf(state, shopId, index) {
  return int(state.shops?.[shopId]?.[index], 0, 0);
}

function stockEntryStatus(state, shopId, entry, index) {
  const limit = entry.kind === 'shard' ? Math.max(1, entry.limit ?? 1) : 1;
  const bought = purchasesOf(state, shopId, index);
  const owned = entry.kind === 'relic' && !!relicRec(state, entry.id);
  const soldOut = entry.kind === 'shard' ? bought >= limit : owned;
  let reason = null;
  if (entry.kind === 'relic' && !relicDef(entry.id)) reason = 'Unavailable';
  else if (entry.kind === 'shard' && !upgradeDef(entry.id)) reason = 'Unavailable';
  else if (owned) reason = 'Already owned';
  else if (soldOut) reason = 'Sold out';
  else if ((state.glint ?? 0) < entry.price) reason = 'Not enough Glint';
  return { limit, bought, owned, soldOut, reason };
}

/**
 * Shop listing with purchase status for the shop UI.
 * @param {Object} state
 * @param {string} shopId
 * @returns {Array<{index:number, kind:string, id:string, name:string, desc:string, price:number, rarity?:string,
 *   owned:boolean, soldOut:boolean, remaining:number, affordable:boolean, canBuy:boolean, reason:string|null}>}
 */
export function shopView(state, shopId) {
  const shop = shopDef(shopId);
  if (!shop || !state) return [];
  return shop.stock.map((entry, index) => {
    const st = stockEntryStatus(state, shopId, entry, index);
    const def = entry.kind === 'relic' ? relicDef(entry.id) : upgradeDef(entry.id);
    return {
      index,
      kind: entry.kind,
      id: entry.id,
      name: def?.name ?? entry.id,
      desc: entry.kind === 'relic' && def ? `${def.desc}${def.stats ? ` (${formatStats(def.stats)})` : ''}` : def?.desc ?? '',
      price: entry.price,
      rarity: entry.kind === 'relic' ? def?.rarity : undefined,
      owned: st.owned,
      soldOut: st.soldOut,
      remaining: entry.kind === 'shard' ? Math.max(0, st.limit - st.bought) : st.owned ? 0 : 1,
      affordable: (state.glint ?? 0) >= entry.price,
      canBuy: !st.reason,
      reason: st.reason,
    };
  });
}

/**
 * Buys stock entry `index` from a shop.
 * @param {Object} state
 * @param {string} shopId
 * @param {number} index
 * @returns {{ok:boolean, reason?:string, description?:string}}
 */
export function buy(state, shopId, index) {
  if (!state) return fail('No game in progress');
  const shop = shopDef(shopId);
  if (!shop) return fail('Unknown shop');
  if (!Number.isInteger(index) || index < 0 || index >= shop.stock.length) return fail('Invalid item');
  const entry = shop.stock[index];
  const st = stockEntryStatus(state, shopId, entry, index);
  if (st.reason) return fail(st.reason);
  state.glint -= entry.price;
  const description = entry.kind === 'relic' ? gainRelic(state, entry.id) : applyShard(state, entry.id);
  if (!isObj(state.shops)) state.shops = {};
  if (!isObj(state.shops[shopId])) state.shops[shopId] = {};
  state.shops[shopId][index] = st.bought + 1;
  return ok({ description });
}

// ───────────────────────────── views ─────────────────────────────

/**
 * Everything the party / status screens need for one member, including a per-stat breakdown.
 * @param {Object} state
 * @param {string} charId
 * @returns {Object|null}
 */
export function partyMemberView(state, charId) {
  const m = getMember(state, charId);
  const c = charDefOf(charId);
  if (!m || !c) return null;
  const breakdown = statBreakdown(m);
  const stats = derivedStats(m);
  const bonus = relicStatBonus(m);
  const base = derivedStats(m, { relics: {} });
  const atMax = m.level >= MAX_LEVEL;
  return {
    id: m.id,
    name: c.name,
    title: c.title,
    role: c.role,
    color: c.color,
    look: c.look,
    bio: c.bio,
    mechanic: c.mechanic,
    mechanicName: c.mechanicName,
    mechanicDesc: c.mechanicDesc,
    shotElement: c.shotElement,
    level: m.level,
    xp: m.xp,
    xpToNext: atMax ? 0 : xpToNext(m.level),
    atMaxLevel: atMax,
    hp: Math.min(m.hp, stats.maxHp),
    maxHp: stats.maxHp,
    alive: m.alive !== false && m.hp > 0,
    attrs: { ...m.attrs },
    attrPoints: m.attrPoints,
    sp: m.sp,
    stats,
    base,
    bonus,
    breakdown,
    relics: Array.from({ length: RELIC_SLOTS }, (_, slot) => {
      const id = m.relics?.[slot] ?? null;
      const r = id ? relicDef(id) : null;
      return r
        ? { slot, id, name: r.name, rarity: r.rarity, statsText: formatStats(r.stats), passiveText: passiveText(r.passive) }
        : { slot, id: null, name: null };
    }),
    echoes: (m.echoes ?? []).filter((id) => relicDef(id)).map((id) => ({
      id,
      name: relicDef(id).name,
      echoCost: relicDef(id).echoCost,
      passiveText: passiveText(relicDef(id).passive),
      suppressed: (m.relics ?? []).includes(id),
    })),
    echoLoad: echoLoad(m),
    echoCapacity: echoCapacity(m.level),
    skills: [...m.skills],
    gradientSkill: c.gradientSkill,
    basicAttack: clone(c.basicAttack),
    passives: collectPassives(m, state),
  };
}

/**
 * Adds elapsed play time (ms) to the stats.
 * @param {Object} state
 * @param {number} ms
 */
export function addPlayTime(state, ms) {
  if (!state?.stats || !isNum(ms) || ms <= 0) return;
  state.stats.playTimeMs = (isNum(state.stats.playTimeMs) ? state.stats.playTimeMs : 0) + ms;
}

// ───────────────────────────── serialization ─────────────────────────────

function trueMap(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v)) if (!UNSAFE_KEYS.has(k) && val) out[k] = true;
  return out;
}

function normalizeMember(raw, fresh, ownedRelics, mastered) {
  const m = fresh;
  if (!isObj(raw)) return m;
  m.level = int(raw.level, 1, 1, MAX_LEVEL);
  m.xp = m.level >= MAX_LEVEL ? 0 : int(raw.xp, 0, 0, xpToNext(m.level) - 1);
  const attrs = isObj(raw.attrs) ? raw.attrs : {};
  for (const a of ATTRS) m.attrs[a] = int(attrs[a], 0, 0, 999);
  m.attrPoints = int(raw.attrPoints, 0, 0, 999);
  m.sp = int(raw.sp, 0, 0, 999);
  const skills = new Set(m.skills);
  if (Array.isArray(raw.skills)) {
    for (const sid of raw.skills) {
      const s = typeof sid === 'string' ? skillDef(sid) : null;
      if (s && s.owner === m.id && !s.gradient) skills.add(sid);
    }
  }
  m.skills = [...skills];
  if (Array.isArray(raw.relics)) {
    m.relics = Array.from({ length: RELIC_SLOTS }, (_, i) => {
      const id = raw.relics[i];
      return typeof id === 'string' && relicDef(id) && ownedRelics.has(id) ? id : null;
    });
  } else {
    m.relics = m.relics.map((id) => (id && ownedRelics.has(id) ? id : null));
  }
  const echoes = [];
  if (Array.isArray(raw.echoes)) {
    let load = 0;
    const cap = echoCapacity(m.level);
    for (const id of raw.echoes) {
      if (typeof id !== 'string' || !relicDef(id) || !mastered.has(id) || echoes.includes(id)) continue;
      if (load + relicDef(id).echoCost > cap) continue;
      load += relicDef(id).echoCost;
      echoes.push(id);
    }
  }
  m.echoes = echoes;
  const maxHp = derivedStats(m).maxHp;
  m.alive = raw.alive !== false;
  m.hp = isNum(raw.hp) ? Math.min(maxHp, Math.max(0, Math.round(raw.hp))) : maxHp;
  if (m.hp <= 0) {
    m.hp = 0;
    m.alive = false;
  }
  if (!m.alive) m.hp = 0;
  return m;
}

function normalizeWorld(raw) {
  const w = newWorld();
  if (!isObj(raw)) return w;
  for (const [k, v] of Object.entries(raw)) {
    if (UNSAFE_KEYS.has(k) || k in w) continue;
    w[k] = v; // forward-compatible: keep extra JSON fields written by other systems
  }
  if (typeof raw.zone === 'string' && raw.zone) w.zone = raw.zone;
  if (isNum(raw.x)) w.x = raw.x;
  if (isNum(raw.y)) w.y = raw.y;
  if (typeof raw.facing === 'string' || isNum(raw.facing)) w.facing = raw.facing;
  const lf = raw.lastFlag;
  if (isObj(lf) && typeof lf.flagId === 'string' && typeof lf.zone === 'string') {
    w.lastFlag = { zone: lf.zone, flagId: lf.flagId, x: isNum(lf.x) ? lf.x : 0, y: isNum(lf.y) ? lf.y : 0 };
  }
  for (const k of WORLD_FLAG_MAPS) w[k] = trueMap(raw[k]);
  if (isObj(raw.flagsVisited)) {
    for (const [id, f] of Object.entries(raw.flagsVisited)) {
      if (UNSAFE_KEYS.has(id) || !isObj(f)) continue;
      w.flagsVisited[id] = {
        zone: typeof f.zone === 'string' ? f.zone : w.zone,
        x: isNum(f.x) ? f.x : 0,
        y: isNum(f.y) ? f.y : 0,
        name: typeof f.name === 'string' ? f.name : id,
      };
    }
  }
  return w;
}

/**
 * Validates and repairs a parsed state object (fills defaults, drops unknown ids, enforces invariants:
 * each relic equipped once and owned, echoes mastered and within capacity, counts within max).
 * @param {*} raw
 * @returns {Object|null} GameState, or null when `raw` is not a recognisable save.
 */
export function normalizeState(raw) {
  if (!isObj(raw)) return null;
  if (raw.version !== undefined && (!isNum(raw.version) || raw.version > STATE_VERSION || raw.version < 1)) return null;
  if (!Array.isArray(raw.party) || !raw.party.some((m) => isObj(m) && charDefOf(m.id))) return null;

  const state = createNewGame({ seed: isNum(raw.seed) ? raw.seed : 1 });

  // Owned relics
  if (isObj(raw.relics)) {
    state.relics = {};
    for (const [id, rec] of Object.entries(raw.relics)) {
      if (!relicDef(id)) continue;
      const battles = isObj(rec) ? int(rec.battles, 0, 0, 1e6) : 0;
      state.relics[id] = { battles, mastered: (isObj(rec) && rec.mastered === true) || battles >= MASTERY_BATTLES };
    }
  }
  const owned = new Set(Object.keys(state.relics));
  const mastered = new Set(Object.keys(state.relics).filter((id) => relicRec(state, id).mastered));

  // Party (always the full roster in PARTY_ORDER)
  state.party = PARTY_ORDER.map((id) => {
    const rawM = raw.party.find((x) => isObj(x) && x.id === id);
    return normalizeMember(rawM, newMember(id), owned, mastered);
  });
  // A relic may be equipped on one character only (first holder wins)
  const seen = new Set();
  for (const m of state.party) {
    m.relics = m.relics.map((id) => {
      if (!id) return null;
      if (seen.has(id)) return null;
      seen.add(id);
      return id;
    });
    const maxHp = derivedStats(m).maxHp;
    if (m.hp > maxHp) m.hp = maxHp;
  }

  // Items
  if (isObj(raw.items)) {
    for (const id of ITEM_ORDER) {
      const it = raw.items[id];
      if (!isObj(it)) continue;
      const max = int(it.max, itemDef(id).baseMax, itemDef(id).baseMax, 99);
      state.items[id] = { count: int(it.count, max, 0, max), max };
    }
  }

  state.glint = int(raw.glint, 0, 0, 1e9);
  state.world = normalizeWorld(raw.world);

  if (isObj(raw.stats)) {
    for (const k of STAT_KEYS) state.stats[k] = isNum(raw.stats[k]) && raw.stats[k] >= 0 ? (k === 'playTimeMs' ? raw.stats[k] : Math.floor(raw.stats[k])) : 0;
  }

  if (isObj(raw.shops)) {
    for (const [shopId, rec] of Object.entries(raw.shops)) {
      if (!shopDef(shopId) || !isObj(rec)) continue;
      const out = {};
      for (const [idx, n] of Object.entries(rec)) {
        const i = Number(idx);
        if (Number.isInteger(i) && i >= 0 && i < shopDef(shopId).stock.length && isNum(n) && n > 0) out[i] = Math.floor(n);
      }
      state.shops[shopId] = out;
    }
  }

  // Forward-compatible extra top-level fields (plain JSON written by other systems)
  for (const [k, v] of Object.entries(raw)) {
    if (UNSAFE_KEYS.has(k) || k in state) continue;
    state[k] = v;
  }
  state.version = STATE_VERSION;
  return state;
}

/**
 * Serializes a GameState to a JSON string.
 * @param {Object} state
 * @returns {string}
 */
export function serialize(state) {
  return JSON.stringify(state);
}

/**
 * Parses and validates a saved GameState string. Garbage (non-JSON, wrong shape, future version) → null.
 * @param {string} str
 * @returns {Object|null}
 */
export function deserialize(str) {
  if (typeof str !== 'string' || !str) return null;
  let raw;
  try {
    raw = JSON.parse(str);
  } catch {
    return null;
  }
  try {
    return normalizeState(raw);
  } catch {
    return null;
  }
}

function storageRef() {
  try {
    const ls = globalThis.localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

/**
 * Writes the state to localStorage ('exp69.save.v1').
 * @param {Object} state
 * @returns {boolean} true on success
 */
export function saveGame(state) {
  const ls = storageRef();
  if (!ls || !state) return false;
  try {
    ls.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads and validates the saved state.
 * @returns {Object|null}
 */
export function loadGame() {
  const ls = storageRef();
  if (!ls) return null;
  try {
    return deserialize(ls.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

/**
 * Whether a valid save exists.
 * @returns {boolean}
 */
export function hasSave() {
  return loadGame() !== null;
}

/**
 * Deletes the save slot.
 * @returns {boolean} true if storage was reachable
 */
export function deleteSave() {
  const ls = storageRef();
  if (!ls) return false;
  try {
    ls.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
