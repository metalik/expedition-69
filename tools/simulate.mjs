#!/usr/bin/env node
// Headless balance simulator for Expedition 69 (SPEC §6): drives the real BattleModel with bots whose defense
// success rates and offensive QTE ratings are configurable, then prints win rate, battle length and damage stats.
// Also exports the built-in fixture data used by `--fixtures` and by tests/battle-*.test.mjs.
//
// Usage: node tools/simulate.mjs [--enemies a,b | --encounter id | --sweep] [--level N] [--battles 200]
//          [--parry 0.6] [--dodge 0.2] [--jump 0.7] [--gradient 0.5] [--perfect 0.4] [--good 0.4]
//          [--perfectDodge 0.3] [--unparryable P] [--difficulty expeditioner] [--seed 69] [--fixtures]
//          [--alloc auto|even] [--planner greedy|value|support] [--root dir] [--json]
//        node tools/simulate.mjs --campaign --profile novice|average|expert [--difficulty all|story,veteran]
//          [--zone shore,thicket] [--bosses-only|--no-bosses] [--level-offset N] [--compact] [--skills] [--no-scale]
//          [--chain N]  (--campaign: every encounter at the level a typical 1.3× run meets it; profiles rescale per
//          difficulty; --chain N fights each run of N consecutive regular encounters back to back, HP and items carried)

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { BattleModel } from '../src/battle/model.js';
import { expectedDamage } from '../src/battle/damage.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ---------------------------------------------------------------------------------------------------------
// Deterministic RNG (mulberry32) with the same API as src/core/rng.js, so fixtures never depend on it.
// ---------------------------------------------------------------------------------------------------------

/** Seeded mulberry32 generator: next/int/float/chance/pick/weighted/shuffle. */
export class FixtureRng {
  /** @param {number} [seed=1] */
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this._s = this.seed;
  }

  /** @returns {number} [0, 1) */
  next() {
    this._s = (this._s + 0x6d2b79f5) >>> 0;
    let t = this._s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  float(min, max) { return min + this.next() * (max - min); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(items, weightFn) {
    const total = items.reduce((s, it) => s + weightFn(it), 0);
    let r = this.next() * total;
    for (const it of items) {
      r -= weightFn(it);
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** An RNG whose next() always returns the same value (0.5 → no crits, variance exactly 1). */
export class ConstRng extends FixtureRng {
  constructor(value = 0.5) {
    super(1);
    this.value = value;
  }
  next() { return this.value; }
}

// ---------------------------------------------------------------------------------------------------------
// Fixture data: a compact but complete stand-in for src/data/* that exercises every rule of the model.
// ---------------------------------------------------------------------------------------------------------

const h = (t, type, power, anim, extra = {}) => ({ t, type, power, element: 'physical', anim, windup: 350, ...extra });
const q = (power, extra = {}) => ({ power, qte: true, ...extra });

/**
 * Fresh fixture data every call (safe to mutate in tests).
 * @returns {{ CHARACTERS, SKILLS, ITEMS, ENEMIES, DIFFICULTY, RELICS, STARTING_RELICS }}
 */
export function createFixtureData() {
  const CHARACTERS = {
    gideon: {
      id: 'gideon', name: 'Gideon', look: 'gideon', mechanic: 'surge', shotElement: 'lightning',
      base: { hp: 420, atk: 34, def: 22, spd: 40, crit: 0.05 }, growth: { hp: 105, atk: 4.3, def: 2.8, spd: 0.6 },
      basicAttack: { name: 'Saber Cut', anim: 'slash', element: 'physical', hits: [{ power: 0.5 }, { power: 0.5, gap: 260 }] },
      gradientSkill: 'storm_oath', startingSkills: ['rivets', 'discharge'],
    },
    nyra: {
      id: 'nyra', name: 'Nyra', look: 'nyra', mechanic: 'glyphs', shotElement: 'light',
      base: { hp: 300, atk: 38, def: 14, spd: 44, crit: 0.05 }, growth: { hp: 65, atk: 4.9, def: 1.8, spd: 0.7 },
      basicAttack: { name: 'Quill Flick', anim: 'cast', element: 'light', hits: [{ power: 1.0 }] },
      gradientSkill: 'aurora', startingSkills: ['ember', 'mend'],
    },
    sable: {
      id: 'sable', name: 'Sable', look: 'sable', mechanic: 'stance', shotElement: 'physical',
      base: { hp: 340, atk: 36, def: 17, spd: 52, crit: 0.12 }, growth: { hp: 85, atk: 4.8, def: 2.2, spd: 0.9 },
      basicAttack: { name: 'Twin Thrust', anim: 'thrust', element: 'physical', hits: [{ power: 0.5 }, { power: 0.5, gap: 180 }] },
      gradientSkill: 'requiem', startingSkills: ['lunge', 'en_garde'],
    },
  };

  const L = (level, requires = []) => ({ level, sp: 1, requires });
  const SKILLS = {
    // Gideon — surge
    rivets: { id: 'rivets', owner: 'gideon', name: 'Rivet Barrage', ap: 2, target: 'enemy', element: 'physical', anim: 'flurry',
      hits: [q(0.65), q(0.65), q(0.7)], effects: [{ type: 'surge', amount: 1 }], learn: L(1) },
    discharge: { id: 'discharge', owner: 'gideon', name: 'Arc Discharge', ap: 3, target: 'enemy', element: 'lightning', anim: 'heavy',
      hits: [q(1.7, { break: 24 })], effects: [], surge: 'consume', learn: L(1) },
    breach: { id: 'breach', owner: 'gideon', name: 'Breach Strike', ap: 2, target: 'enemy', element: 'physical', anim: 'heavy',
      ignoreShields: true, hits: [q(1.6, { break: 30 })], effects: [{ type: 'shieldBreak', amount: 2 }], learn: L(2) },
    relay: { id: 'relay', owner: 'gideon', name: 'Galvanic Relay', ap: 1, target: 'ally', element: 'lightning', anim: 'buff',
      hits: [], effects: [{ type: 'ap', amount: 2, target: 'target' }, { type: 'surge', amount: 1 }], learn: L(3) },
    rally: { id: 'rally', owner: 'gideon', name: 'Rallying Cry', ap: 3, target: 'allAllies', element: 'physical', anim: 'buff',
      hits: [], effects: [{ type: 'status', status: 'powerful', turns: 3, target: 'allies' }, { type: 'surge', amount: 2 }], learn: L(4) },
    quake: { id: 'quake', owner: 'gideon', name: 'Quake', ap: 3, target: 'allEnemies', element: 'earth', anim: 'heavy',
      hits: [q(1.0)], effects: [{ type: 'status', status: 'slow', turns: 2, chance: 0.5, target: 'target' }, { type: 'break', amount: 10 }], learn: L(5) },
    storm_oath: { id: 'storm_oath', owner: 'gideon', name: 'Thunderhead Oath', ap: 0, gradient: true, target: 'enemy', element: 'lightning',
      anim: 'gradient', hits: [q(1.5), q(1.5), q(2.0)], effects: [{ type: 'surge', amount: 4 }], learn: L(1) },
    // Nyra — glyphs
    ember: { id: 'ember', owner: 'nyra', name: 'Ember Script', ap: 1, target: 'enemy', element: 'fire', anim: 'cast',
      hits: [q(0.8)], effects: [{ type: 'status', status: 'burn', turns: 2, chance: 0.35, target: 'target' }, { type: 'glyph', add: 'fire' }], learn: L(1) },
    mend: { id: 'mend', owner: 'nyra', name: 'Mending Verse', ap: 2, target: 'ally', element: 'light', anim: 'heal',
      hits: [], effects: [{ type: 'heal', pct: 0.3, target: 'target' }],
      consumeGlyph: { glyph: 'light', powerMult: 1, effects: [{ type: 'heal', pct: 0.15, target: 'target' }, { type: 'status', status: 'regen', turns: 3, target: 'target' }] },
      learn: L(1) },
    frost: { id: 'frost', owner: 'nyra', name: 'Frost Sigil', ap: 2, target: 'enemy', element: 'ice', anim: 'cast',
      hits: [q(0.7), q(0.7)], effects: [{ type: 'status', status: 'chill', turns: 2, target: 'target' }, { type: 'glyph', add: 'ice' }],
      consumeGlyph: { glyph: 'fire', powerMult: 1.5, effects: [{ type: 'status', status: 'defenseless', turns: 2, target: 'target' }] }, learn: L(2) },
    lumen: { id: 'lumen', owner: 'nyra', name: 'Lumen Script', ap: 1, target: 'ally', element: 'light', anim: 'buff',
      hits: [], effects: [{ type: 'cleanse', target: 'target' }, { type: 'glyph', add: 'light' }], learn: L(2) },
    chain: { id: 'chain', owner: 'nyra', name: 'Chain Spark', ap: 3, target: 'randomEnemies', element: 'lightning', anim: 'cast',
      hits: [q(0.6, { random: true }), q(0.6, { random: true }), q(0.6, { random: true })], effects: [{ type: 'glyph', add: 'storm' }], learn: L(3) },
    unravel: { id: 'unravel', owner: 'nyra', name: 'Unravel', ap: 2, target: 'enemy', element: 'earth', anim: 'cast',
      hits: [q(0.9)], effects: [{ type: 'dispel', target: 'target' }, { type: 'glyph', add: 'earth' }], learn: L(3) },
    dawn: { id: 'dawn', owner: 'nyra', name: 'Dawn Rite', ap: 4, target: 'deadAlly', element: 'light', anim: 'heal',
      hits: [], effects: [{ type: 'revive', pct: 0.4, target: 'target' }], learn: L(4) },
    codex: { id: 'codex', owner: 'nyra', name: 'Codex Unbound', ap: 5, target: 'enemy', element: 'light', anim: 'cast',
      hits: [q(1.8)], effects: [], consumeAllGlyphs: { extraHitPower: 1.1 }, learn: L(5) },
    aurora: { id: 'aurora', owner: 'nyra', name: 'Aurora Palimpsest', ap: 0, gradient: true, target: 'allEnemies', element: 'light', anim: 'gradient',
      hits: [q(1.1), q(1.1), q(1.4)], effects: [{ type: 'heal', pct: 0.2, target: 'allies' }, { type: 'glyph', add: 'fire' }, { type: 'glyph', add: 'ice' }], learn: L(1) },
    // Sable — stance
    lunge: { id: 'lunge', owner: 'sable', name: 'Crimson Lunge', ap: 2, target: 'enemy', element: 'physical', anim: 'thrust',
      hits: [q(1.3)], effects: [{ type: 'stance', to: 'assault' }], learn: L(1) },
    en_garde: { id: 'en_garde', owner: 'sable', name: 'En Garde', ap: 1, target: 'enemy', element: 'physical', anim: 'slash',
      hits: [q(0.9)], effects: [{ type: 'stance', to: 'guard' }], learn: L(1) },
    brand: { id: 'brand', owner: 'sable', name: 'Duelist\'s Brand', ap: 1, target: 'enemy', element: 'physical', anim: 'slash',
      hits: [q(0.6)], effects: [{ type: 'status', status: 'mark', turns: 3, target: 'target' }], learn: L(2) },
    flurry: { id: 'flurry', owner: 'sable', name: 'Flurry', ap: 3, target: 'enemy', element: 'physical', anim: 'flurry',
      hits: [q(0.5), q(0.5), q(0.5), q(0.5)], effects: [{ type: 'break', amount: 4, when: 'perHit' }, { type: 'stance', to: 'assault' }], learn: L(2) },
    volley: { id: 'volley', owner: 'sable', name: 'Pistol Volley', ap: 2, target: 'randomEnemies', element: 'physical', anim: 'shoot',
      hits: [q(0.55, { random: true }), q(0.55, { random: true }), q(0.55, { random: true }), q(0.55, { random: true })], effects: [], learn: L(3) },
    coup: { id: 'coup', owner: 'sable', name: 'Coup de Grâce', ap: 4, target: 'enemy', element: 'physical', anim: 'thrust',
      hits: [q(2.4)], effects: [], bonusVs: { broken: true, mult: 1.8 }, critBonus: 0.3, learn: L(4) },
    exploit: { id: 'exploit', owner: 'sable', name: 'Exploit', ap: 2, target: 'enemy', element: 'physical', anim: 'thrust',
      hits: [q(1.2)], effects: [], bonusVs: { status: 'mark', mult: 1.5 }, learn: L(4) },
    quickstep: { id: 'quickstep', owner: 'sable', name: 'Quickstep', ap: 1, target: 'self', element: 'physical', anim: 'buff',
      hits: [], effects: [{ type: 'status', status: 'haste', turns: 3, target: 'self' }, { type: 'gradient', amount: 10 }], learn: L(5) },
    requiem: { id: 'requiem', owner: 'sable', name: 'Crimson Requiem', ap: 0, gradient: true, target: 'enemy', element: 'physical', anim: 'gradient',
      hits: [q(1.6), q(1.6), q(2.0)], effects: [{ type: 'stance', to: 'virtuoso' }], learn: L(1) },
  };

  const ITEMS = {
    tincture: { id: 'tincture', name: 'Tincture', target: 'ally', effects: [{ type: 'heal', pct: 0.45, target: 'target' }], baseMax: 4 },
    tonic: { id: 'tonic', name: 'Tonic', target: 'deadAlly', effects: [{ type: 'revive', pct: 0.5, target: 'target' }], baseMax: 2 },
    draught: { id: 'draught', name: 'Draught', target: 'ally', effects: [{ type: 'ap', amount: 3, target: 'target' }], baseMax: 2 },
  };

  const atkMap = (list) => Object.fromEntries(list.map((a) => [a.id, a]));
  const ENEMIES = {
    driftling: {
      id: 'driftling', name: 'Driftling', look: 'driftling', zone: 'shore', level: 1,
      stats: { hp: 180, atk: 30, def: 10, spd: 38, crit: 0.05 }, affinities: { lightning: 1.5, fire: 0.5 }, breakMax: 100,
      weakPoints: [{ id: 'core', effect: 'crit' }], xp: 24, glint: 12, drops: [{ relic: 'dawn_locket', chance: 0.1 }],
      attacks: atkMap([
        { id: 'sting', name: 'Lantern Sting', target: 'single', approach: 'melee', weight: 3, hits: [h(900, 'normal', 0.9, 'thrust')], duration: 1400 },
        { id: 'lash', name: 'Ribbon Lash', target: 'single', approach: 'melee', weight: 2,
          hits: [h(900, 'normal', 0.6, 'slash'), h(1250, 'normal', 0.6, 'slash')], duration: 1700 },
        { id: 'pulse', name: 'Glow Pulse', target: 'all', approach: 'stay', weight: 1, cooldown: 1,
          hits: [h(800, 'jump', 0.7, 'wave')], duration: 1300 },
      ]),
      pool: ['sting', 'lash', 'pulse'],
    },
    shellguard: {
      id: 'shellguard', name: 'Shellguard', look: 'shellguard', zone: 'shore', level: 2,
      stats: { hp: 320, atk: 34, def: 24, spd: 32, crit: 0.05 }, affinities: { lightning: 1.5, ice: 0.5 }, shields: 2, breakMax: 120,
      weakPoints: [{ id: 'conch', effect: 'shield' }, { id: 'eye', effect: 'crit' }], xp: 36, glint: 20, drops: [{ relic: 'tidal_charm', chance: 0.15 }],
      attacks: atkMap([
        { id: 'pincer', name: 'Pincer Triplet', target: 'single', approach: 'melee', weight: 3,
          hits: [h(900, 'normal', 0.6, 'slash'), h(1150, 'normal', 0.6, 'slash'), h(1400, 'normal', 0.6, 'thrust')], duration: 1900 },
        { id: 'crush', name: 'Conch Crush', target: 'single', approach: 'melee', weight: 2,
          hits: [h(1300, 'unparryable', 1.3, 'slam', { windup: 800, status: { id: 'defenseless', turns: 2, chance: 1 } })], duration: 1800 },
        { id: 'feint_snap', name: 'Feint & Snap', target: 'single', approach: 'melee', weight: 1,
          hits: [h(900, 'feint', 0, 'slash'), h(1300, 'normal', 1.0, 'slash')], duration: 1800 },
        { id: 'harden', name: 'Harden Shell', target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 3,
          condition: { shieldsBelow: 1 }, hits: [], duration: 1200, effects: [{ type: 'shield', amount: 2, target: 'self' }] },
      ]),
      pool: ['pincer', 'crush', 'feint_snap', 'harden'],
    },
    tidecaller: {
      id: 'tidecaller', name: 'Tidecaller', look: 'tidecaller', zone: 'shore', level: 2,
      stats: { hp: 240, atk: 32, def: 14, spd: 42, crit: 0.05 }, affinities: { ice: 0, lightning: 1.5 }, breakMax: 100,
      weakPoints: [{ id: 'staff_pearl', effect: 'break' }], statusResist: ['burn'], xp: 30, glint: 18, drops: [],
      attacks: atkMap([
        { id: 'tidal_bolt', name: 'Tidal Bolt', target: 'single', approach: 'ranged', weight: 3,
          hits: [h(700, 'normal', 0.9, 'bolt', { element: 'ice', status: { id: 'chill', turns: 2, chance: 0.5 } })], duration: 1200 },
        { id: 'hush', name: 'Hush', target: 'single', approach: 'ranged', weight: 1, cooldown: 2,
          hits: [h(700, 'normal', 0.5, 'bolt', { status: { id: 'silence', turns: 2, chance: 1 } })], duration: 1200 },
        { id: 'mend_tide', name: 'Mending Tide', target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 3,
          condition: { allyHpBelow: 0.6 }, hits: [], duration: 1200,
          effects: [{ type: 'heal', pct: 0.25, target: 'allies' }, { type: 'status', status: 'regen', turns: 2, target: 'allies' }] },
        { id: 'hex', name: 'Undertow Hex', target: 'all', approach: 'stay', anim: 'cast', weight: 1, cooldown: 2, hits: [], duration: 1200,
          effects: [{ type: 'status', status: 'weakened', turns: 2, target: 'target' }, { type: 'dispel', target: 'target' }] },
      ]),
      pool: ['tidal_bolt', 'hush', 'mend_tide', 'hex'],
    },
    warden: {
      id: 'warden', name: 'The Warden', look: 'wreck_warden', zone: 'shore', level: 5, boss: true,
      stats: { hp: 2900, atk: 92, def: 30, spd: 48, crit: 0.05 }, affinities: { lightning: 1.5, fire: 0.5 }, shields: 2, breakMax: 280,
      weakPoints: [{ id: 'porthole', effect: 'crit' }, { id: 'barnacles', effect: 'break' }], statusResist: ['burn'],
      xp: 360, glint: 180, drops: [{ relic: 'anvil_heart', chance: 1 }, { relic: 'second_wind', chance: 0.25 }],
      attacks: atkMap([
        { id: 'anchor', name: 'Anchor Drop', target: 'single', approach: 'melee', weight: 3, cooldown: 1,
          hits: [h(1750, 'normal', 2.5, 'slam', { windup: 1100 })], duration: 2350 },
        { id: 'sweep', name: 'Keelhaul Sweep', target: 'all', approach: 'melee', weight: 2, cooldown: 2,
          hits: [h(1200, 'unparryable', 1.4, 'spin', { windup: 700 })], duration: 1750 },
        { id: 'rolls', name: 'Anchor Roll', target: 'single', approach: 'stay', weight: 3,
          hits: [h(900, 'jump', 0.7, 'wave'), h(1350, 'jump', 0.7, 'wave'), h(1800, 'jump', 0.7, 'wave')], duration: 2300 },
        { id: 'combo', name: 'Rusted Combo', target: 'single', approach: 'melee', weight: 3,
          hits: [h(950, 'normal', 0.75, 'slash'), h(1300, 'normal', 0.75, 'slash'), h(1650, 'feint', 0, 'slam'), h(2000, 'normal', 1.4, 'slam')], duration: 2500 },
        { id: 'gloam', name: 'Gloam Beam', target: 'single', approach: 'stay', weight: 2,
          hits: [h(1400, 'gradient', 2.0, 'beam', { element: 'dark' })], duration: 2000 },
        { id: 'chain', name: 'Chain Lash', target: 'multi', approach: 'ranged', weight: 2,
          hits: [h(900, 'normal', 0.8, 'slash'), h(1200, 'normal', 0.8, 'slash'), h(1500, 'normal', 0.8, 'slash')], duration: 2000 },
        { id: 'ballast', name: 'Take on Ballast', target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 4,
          condition: { shieldsBelow: 1 }, hits: [], duration: 1300, effects: [{ type: 'shield', amount: 2, target: 'self' }] },
      ]),
      pool: ['anchor', 'sweep', 'rolls', 'combo', 'ballast'],
      phases: [{
        hpBelow: 0.5, pool: ['anchor', 'sweep', 'gloam', 'chain', 'combo', 'ballast'],
        text: 'The porthole floods crimson — the Warden lets out the chain.',
        effects: [{ type: 'shield', amount: 2, target: 'self' }, { type: 'status', status: 'powerful', turns: 3, target: 'self' }],
        statMult: { spd: 1.2, atk: 1.1 },
      }],
    },
    dummy: {
      id: 'dummy', name: 'Training Mannequin', look: 'dummy', zone: 'training', level: 1,
      stats: { hp: 1500, atk: 25, def: 10, spd: 35, crit: 0 }, affinities: {}, breakMax: 150,
      weakPoints: [{ id: 'target', effect: 'crit' }], xp: 0, glint: 0, drops: [],
      attacks: atkMap([
        { id: 'jab', name: 'Straw Jab', target: 'single', approach: 'melee', weight: 2, hits: [h(900, 'normal', 0.8, 'thrust')], duration: 1400 },
        { id: 'sweep', name: 'Pole Sweep', target: 'all', approach: 'stay', weight: 1, hits: [h(800, 'jump', 0.8, 'wave')], duration: 1300 },
      ]),
      pool: ['jab', 'sweep'],
    },
  };

  const DIFFICULTY = {
    story: { name: 'Story', windowScale: 1.7, dmgTakenMult: 0.6, bossSpdMult: 1, bossDmgMult: 1, postBattleRecovery: 0.2 },
    expeditioner: { name: 'Expeditioner', windowScale: 1.0, dmgTakenMult: 1.0, bossSpdMult: 1, bossDmgMult: 1, postBattleRecovery: 0.2 },
    veteran: { name: 'Veteran', windowScale: 0.65, dmgTakenMult: 1.3, bossSpdMult: 1.5, bossDmgMult: 1.6, postBattleRecovery: 0 },
  };

  const relic = (id, passive, stats = {}) => ({ id, name: id, stats, passive, echoCost: 2, rarity: 'common' });
  const RELICS = {
    riposte_pin: relic('riposte_pin', { id: 'counterPower', params: { mult: 1.5 } }, { def: 2 }),
    mending_quill: relic('mending_quill', { id: 'healPower', params: { mult: 1.35 } }, { hp: 20 }),
    opening_gambit: relic('opening_gambit', { id: 'firstStrike', params: { mult: 1.6 } }, { spd: 2 }),
    dawn_locket: relic('dawn_locket', { id: 'startAp', params: { amount: 1 } }),
    tidal_charm: relic('tidal_charm', { id: 'parryHeal', params: { pct: 0.04 } }),
    anvil_heart: relic('anvil_heart', { id: 'breakPower', params: { mult: 1.4 } }),
    second_wind: relic('second_wind', { id: 'secondWind', params: {} }),
  };
  const STARTING_RELICS = { gideon: 'riposte_pin', nyra: 'mending_quill', sable: 'opening_gambit' };
  return { CHARACTERS, SKILLS, ITEMS, ENEMIES, DIFFICULTY, RELICS, STARTING_RELICS };
}

// ---------------------------------------------------------------------------------------------------------
// Party construction
// ---------------------------------------------------------------------------------------------------------

const ATTRS = ['vitality', 'might', 'agility', 'defense', 'luck'];

/**
 * Builds PartySnapshots at `level` straight from CHARACTERS base/growth with an even attribute spread
 * (SPEC §3.3 formulas), every owner skill with learn.level ≤ level, and the starting relics' stats/passives.
 * @param {object} data { CHARACTERS, SKILLS, RELICS?, STARTING_RELICS? }
 * @param {number} [level=1]
 * @param {{ relics?: boolean, order?: string[] }} [opts]
 * @returns {object[]} PartySnapshot[]
 */
export function buildPartyManual(data, level = 1, { relics = true, order = ['gideon', 'nyra', 'sable'] } = {}) {
  const Lv = Math.max(1, Math.floor(level));
  const points = 3 * (Lv - 1);
  return order.filter((id) => data.CHARACTERS[id]).map((id) => {
    const c = data.CHARACTERS[id];
    const attrs = Object.fromEntries(ATTRS.map((a, i) => [a, Math.floor(points / 5) + (i < points % 5 ? 1 : 0)]));
    const g = c.growth ?? {};
    const stats = {
      maxHp: Math.round(c.base.hp + (Lv - 1) * (g.hp ?? 0) + attrs.vitality * 25),
      atk: Math.round(c.base.atk + (Lv - 1) * (g.atk ?? 0) + attrs.might * 3),
      def: Math.round(c.base.def + (Lv - 1) * (g.def ?? 0) + attrs.defense * 2.5),
      spd: Math.round(c.base.spd + (Lv - 1) * (g.spd ?? 0) + attrs.agility * 1.5),
      crit: Math.min(0.6, c.base.crit + attrs.luck * 0.01),
    };
    const passives = [];
    const relicId = relics ? data.STARTING_RELICS?.[id] : null;
    const r = relicId ? data.RELICS?.[relicId] : null;
    if (r) {
      for (const [k, v] of Object.entries(r.stats ?? {})) {
        const key = k === 'hp' ? 'maxHp' : k;
        if (typeof v === 'number' && key in stats) stats[key] += v;
      }
      passives.push({ id: r.passive.id, params: { ...r.passive.params }, source: relicId });
    }
    const skills = Object.values(data.SKILLS)
      .filter((s) => s.owner === id && !s.gradient && (s.learn?.level ?? 1) <= Lv)
      .map((s) => s.id);
    return {
      id, name: c.name, look: c.look ?? id, level: Lv, stats, hp: stats.maxHp, alive: true,
      skills, gradientSkill: c.gradientSkill, passives, mechanic: c.mechanic, shotElement: c.shotElement, basicAttack: c.basicAttack,
    };
  });
}

/**
 * Builds the party via the real game-state module (createNewGame → grantXp → auto/even allocation → learn
 * skills → rest → toBattleParty). Throws if the modules are unusable.
 */
/**
 * A party snapshot built the way the game builds it: a new GameState raised to `level` (XP granted, attributes
 * auto-allocated or spread evenly, every learnable skill learned), rested, then toBattleParty.
 * @returns {{party: object[], items: object}}
 */
export function buildPartyFromGameState(gs, prog, SKILLS, level, alloc = 'auto') {
  const state = gs.createNewGame({ seed: 69 });
  let target = 0;
  if (prog.totalXpForLevel) target = prog.totalXpForLevel(level);
  else for (let l = 1; l < level; l++) target += prog.xpToNext(l);
  for (const m of state.party) {
    if (level > 1) prog.grantXp(m, target);
    if (alloc === 'auto' && gs.autoAllocate) gs.autoAllocate(state, m.id);
    else {
      let i = 0;
      while ((m.attrPoints ?? 0) > 0 && i < 500) {
        gs.allocateAttr(state, m.id, ATTRS[i % ATTRS.length], 1);
        i++;
      }
    }
    const own = Object.values(SKILLS).filter((s) => s.owner === m.id && !s.gradient).sort((a, b) => (a.learn?.level ?? 1) - (b.learn?.level ?? 1));
    for (let pass = 0; pass < 4; pass++) for (const s of own) gs.learnSkill(state, m.id, s.id);
  }
  if (gs.restAtFlag) gs.restAtFlag(state, 'simulator');
  return { party: gs.toBattleParty(state), items: state.items };
}

// ---------------------------------------------------------------------------------------------------------
// Test helpers (used by tests/battle-*.test.mjs)
// ---------------------------------------------------------------------------------------------------------

/**
 * Builds a BattleModel on fixture data.
 * @param {object} [o]
 * @param {string[]} [o.enemies=['driftling']]
 * @param {number} [o.level=1] party level (manual build, no relics unless `relics: true`)
 * @param {object} [o.rng] defaults to ConstRng(0.5): no crits, variance 1, initiative roll 15
 * @param {(party:object[], data:object)=>void} [o.tweak] mutate snapshots/data before construction
 * @returns {{ model: BattleModel, data: object }}
 */
export function createFixtureModel({ enemies = ['driftling'], level = 1, rng = new ConstRng(0.5), relics = false, tweak = null, ...opts } = {}) {
  const data = opts.data ?? createFixtureData();
  const party = opts.party ?? buildPartyManual(data, level, { relics });
  if (tweak) tweak(party, data);
  const model = new BattleModel({ party, enemies, rng, data, ...opts });
  return { model, data };
}

/** Makes it `actorId`'s turn without advancing the CTB or applying start-of-turn effects (tests only). */
export function forceTurn(model, actorId) {
  const c = model.get(actorId);
  model.turn = {
    number: model.turn.number + 1, actorId, side: c.side, skipped: false, acted: false, ended: false, round: model.round,
  };
  return c;
}

/** Runs a whole party action: beginAction → resolveHit for every hit (same rating) → finishAction. */
export function runPartyAction(model, actorId, action, rating = null) {
  const plan = model.beginAction(actorId, action);
  if (plan.error) return { plan, events: [] };
  const events = [...plan.events];
  plan.hits.forEach((_, i) => events.push(...model.resolveHit(plan, i, rating)));
  events.push(...model.finishAction(plan));
  return { plan, events };
}

/** Runs a whole enemy action with one outcome per hit (array or single value); returns plan, events, counters. */
export function runEnemyAction(model, enemyId, outcomes = 'hit', planOverride = null) {
  const plan = planOverride ?? model.planEnemyAction(enemyId);
  const events = [...plan.events];
  plan.hits.forEach((_, i) => events.push(...model.resolveEnemyHit(plan, i, Array.isArray(outcomes) ? outcomes[i] : outcomes)));
  const counters = model.resolveCounters(plan);
  for (const c of counters) events.push(...c.events);
  events.push(...model.finishEnemyAction(plan));
  return { plan, events, counters };
}

// ---------------------------------------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------------------------------------

/** Default bot skill levels. */
export const DEFAULT_BOT = Object.freeze({
  parry: 0.6, dodge: 0.2, jump: 0.7, gradient: 0.5, perfect: 0.4, good: 0.4, perfectDodge: 0.3, unparryable: null,
});

function expectedQteMult(cfg) {
  const p = Math.max(0, Math.min(1, cfg.perfect));
  const g = Math.max(0, Math.min(1 - p, cfg.good));
  return p * 1.4 + g * 1.15 + (1 - p - g);
}

// ---------------------------------------------------------------------------------------------------------
// Player-skill profiles (balance tuning). Rates are the chance that ONE attempt of that input succeeds on
// Expeditioner. `mode:'attempt'`: on a normal hit the bot tries a parry with probability `parryTry` (else it
// dodges), and on a gradient hit it tries the counter with probability `gradientTry` (else it dodges); a failed
// attempt is a hit (the first claiming press decides, SPEC §3.2). Legacy bots (no mode) keep the old exclusive
// semantics (P(parry)=parry, P(dodge)=dodge, rest hit). `planner:'value'` picks commands AP-aware (valueAction);
// `planner:'support'` (opt-in, --planner support) adds Free Aim weak-point shots, buffs and AP hand-offs.
// ---------------------------------------------------------------------------------------------------------

/** Named bot profiles used by `--profile` and `--campaign`. */
export const BOT_PROFILES = Object.freeze({
  default: DEFAULT_BOT,
  novice: Object.freeze({ mode: 'attempt', planner: 'value', parry: 0.2, dodge: 0.45, jump: 0.4, gradient: 0.15, perfect: 0.15, good: 0.35, perfectDodge: 0.15, parryTry: 0.25, gradientTry: 0.25, unparryable: null }),
  average: Object.freeze({ mode: 'attempt', planner: 'value', parry: 0.5, dodge: 0.7, jump: 0.65, gradient: 0.4, perfect: 0.35, good: 0.45, perfectDodge: 0.3, parryTry: 0.5, gradientTry: 0.5, unparryable: null }),
  expert: Object.freeze({ mode: 'attempt', planner: 'value', parry: 0.85, dodge: 0.95, jump: 0.9, gradient: 0.8, perfect: 0.7, good: 0.25, perfectDodge: 0.5, parryTry: 0.8, gradientTry: 0.8, unparryable: null }),
});

/** Error function (Abramowitz–Stegun 7.1.26, |err| < 1.5e-7). */
export function erf(x) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** Inverse error function (Newton-refined Winitzki approximation). */
export function erfinv(y) {
  const v = Math.max(-0.999999, Math.min(0.999999, y));
  const a = 0.147;
  const ln = Math.log(1 - v * v);
  const t = 2 / (Math.PI * a) + ln / 2;
  let x = Math.sign(v) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
  for (let i = 0; i < 3; i++) x -= (erf(x) - v) / ((2 / Math.sqrt(Math.PI)) * Math.exp(-x * x));
  return x;
}

/**
 * Re-derives a bot's success rates for a difficulty's timing-window scale, assuming the player's timing error is a
 * zero-mean Gaussian: a window that is k× wider succeeds with erf(k·erfinv(p)). Offense perfect/good are treated as
 * nested windows (perfect ⊂ good).
 * @param {object} cfg bot profile (Expeditioner rates)
 * @param {number} k windowScale (story 1.7, expeditioner 1, veteran 0.7)
 */
export function scaleBotForWindows(cfg, k) {
  if (!k || k === 1) return { ...cfg };
  const sc = (p) => (p == null ? p : Math.max(0, Math.min(1, erf(k * erfinv(Math.max(0, Math.min(0.999, p)))))));
  const perfect = sc(cfg.perfect);
  const goodCum = sc(Math.min(0.999, cfg.perfect + cfg.good));
  return {
    ...cfg,
    parry: sc(cfg.parry), dodge: sc(cfg.dodge), jump: sc(cfg.jump), gradient: sc(cfg.gradient),
    unparryable: cfg.unparryable == null ? null : sc(cfg.unparryable),
    perfect, good: Math.max(0, goodCum - perfect),
    perfectDodge: sc(cfg.perfectDodge),
  };
}

/** Samples an offensive QTE rating from the bot's perfect/good probabilities. */
export function sampleRating(cfg, rng) {
  const u = rng.next();
  if (u < cfg.perfect) return 'perfect';
  if (u < cfg.perfect + cfg.good) return 'good';
  return 'miss';
}

/**
 * Samples a defense outcome for one enemy hit, respecting the hit type.
 * normal: parry | dodge | hit · unparryable: dodge | hit · jump: jump | hit · gradient: gradient | dodge | hit.
 */
export function sampleDefense(type, cfg, rng) {
  const dodgeKind = () => (rng.next() < cfg.perfectDodge ? 'perfectDodge' : 'dodge');
  const u = rng.next();
  if (cfg.mode === 'attempt') {
    const dodge = (p) => (rng.next() < p ? dodgeKind() : 'hit');
    switch (type) {
      case 'normal':
        return u < (cfg.parryTry ?? 0.5) ? (rng.next() < cfg.parry ? 'parry' : 'hit') : dodge(cfg.dodge);
      case 'unparryable':
        return dodge(cfg.unparryable ?? cfg.dodge);
      case 'jump':
        return u < cfg.jump ? 'jump' : 'hit';
      case 'gradient':
        return u < (cfg.gradientTry ?? 0.5) ? (rng.next() < cfg.gradient ? 'gradient' : 'hit') : dodge(cfg.dodge);
      default:
        return 'hit';
    }
  }
  switch (type) {
    case 'normal':
      if (u < cfg.parry) return 'parry';
      if (u < cfg.parry + cfg.dodge) return dodgeKind();
      return 'hit';
    case 'unparryable':
      return u < (cfg.unparryable ?? cfg.dodge) ? dodgeKind() : 'hit';
    case 'jump':
      return u < cfg.jump ? 'jump' : 'hit';
    case 'gradient':
      if (u < cfg.gradient) return 'gradient';
      if (u < cfg.gradient + cfg.dodge) return dodgeKind();
      return 'hit';
    default:
      return 'hit';
  }
}

const hasEffect = (def, type) => (def.effects ?? []).some((e) => e.type === type);

/** Expected damage of a skill/attack plan-shape against the model's current state (no rolls). */
function estimateDamage(model, actor, def, targetId, cfg, { attack = false } = {}) {
  const enemies = model.living('enemy');
  const qm = attack ? 1 : expectedQteMult(cfg);
  let mult = 1;
  const mech = actor.mechanic;
  if (def.surge === 'consume' && mech?.type === 'surge') mult *= 1 + 0.2 * mech.value;
  if (def.consumeGlyph && mech?.type === 'glyphs' && mech.list.includes(def.consumeGlyph.glyph)) mult *= def.consumeGlyph.powerMult ?? 1;
  const hits = (def.hits ?? []).map((hh) => ({ power: (hh.power ?? 1) * mult, element: hh.element ?? def.element ?? 'physical' }));
  if (def.consumeAllGlyphs && mech?.type === 'glyphs') {
    const el = { fire: 'fire', ice: 'ice', storm: 'lightning', earth: 'earth', light: 'light' };
    for (const g of mech.list) hits.push({ power: def.consumeAllGlyphs.extraHitPower ?? 1, element: el[g] });
  }
  const tt = attack ? 'enemy' : def.target ?? 'enemy';
  const targets = tt === 'allEnemies' ? enemies : tt === 'randomEnemies' ? enemies : enemies.filter((e) => e.id === targetId);
  let total = 0;
  for (const t of targets) {
    let shields = def.ignoreShields ? 0 : t.shields;
    let sum = 0;
    for (const hh of hits) {
      if (shields > 0) {
        shields--;
        continue;
      }
      let m2 = 1;
      if (def.bonusVs && ((def.bonusVs.broken && t.broken) || (def.bonusVs.status && t.statuses.some((s) => s.id === def.bonusVs.status)))) m2 *= def.bonusVs.mult;
      sum += expectedDamage({ attacker: actor, target: t, power: hh.power, element: hh.element, qteMult: qm, critBonus: def.critBonus ?? 0, mult: m2, kind: attack ? 'attack' : 'skill' });
    }
    const capped = Math.min(sum, t.hp);
    total += tt === 'randomEnemies' ? capped / targets.length : capped + (sum >= t.hp ? t.hp * 0.25 : 0);
  }
  return total;
}

/**
 * AP-aware damage planner (`cfg.planner:'value'`, used by the balance profiles): scores each damaging skill by its
 * damage gain over a basic attack per AP given up (cost + the attack's +1), values Sable's stance climb, spends
 * gradient charges greedily, and saves AP (attacks) when a clearly better skill is at most 3 AP away and the fight
 * will last long enough to use it. Closer to how a player who knows the kit plays than the greedy default.
 */
function valueAction(model, actor, cfg, cmds) {
  const S = model.data.SKILLS;
  const enemies = model.living('enemy');
  if (!enemies.length) return { kind: 'attack', targetIds: [] };
  const attackDef = { ...actor.basicAttack, target: 'enemy' };
  let atk = null;
  for (const t of enemies) {
    const d = estimateDamage(model, actor, attackDef, t.id, cfg, { attack: true });
    if (!atk || d > atk.dmg) atk = { dmg: d, t: t.id };
  }
  const stance = actor.mechanic?.type === 'stance' ? actor.mechanic.value : null;
  const stanceBonus = (def) => {
    const to = (def.effects ?? []).find((e) => e.type === 'stance')?.to;
    if (!stance || !to) return 0;
    if (to === 'assault' && stance === 'neutral') return atk.dmg * 0.8;
    if ((to === 'assault' && stance === 'assault') || (to === 'virtuoso' && stance !== 'virtuoso')) return atk.dmg * 1.2;
    if (to === 'guard' && stance === 'virtuoso') return -atk.dmg * 1.2;
    return 0;
  };
  const scored = [];
  const score = (kind, s, def) => {
    const tt = def.target ?? 'enemy';
    if (!['enemy', 'allEnemies', 'randomEnemies'].includes(tt)) return;
    for (const t of tt === 'enemy' ? enemies : [enemies[0]]) {
      const dmg = estimateDamage(model, actor, def, t.id, cfg) + stanceBonus(def);
      const gain = dmg - atk.dmg;
      const ap = kind === 'gradient' ? 0 : Number(def.ap) || 0;
      scored.push({ kind, id: s.id, targetIds: tt === 'enemy' ? [t.id] : [], dmg, gain, ap, eff: gain / (ap + 1), usable: s.usable });
    }
  };
  for (const g of cmds.gradient.filter((x) => x.usable)) score('gradient', g, S[g.id]);
  const grad = scored.filter((o) => o.kind === 'gradient' && o.gain > atk.dmg * 0.5).sort((a, b) => b.dmg - a.dmg)[0];
  if (grad) return { kind: 'gradient', id: grad.id, targetIds: grad.targetIds };
  scored.length = 0;
  for (const s of cmds.skills) if (s.usable || s.reason === 'Not enough AP') score('skill', s, S[s.id]);
  const good = scored.filter((o) => o.gain > 0).sort((a, b) => b.eff - a.eff);
  const affordable = good.filter((o) => o.usable);
  const top = good[0];
  const enemyHp = enemies.reduce((a, e) => a + e.hp, 0);
  if (top && !top.usable && top.ap - actor.ap <= 3 && enemyHp > atk.dmg * 4
    && (!affordable.length || top.eff > affordable[0].eff * 1.2)) return { kind: 'attack', targetIds: [atk.t] };
  if (affordable.length) return { kind: 'skill', id: affordable[0].id, targetIds: affordable[0].targetIds };
  return { kind: 'attack', targetIds: [atk.t] };
}

// ---------------------------------------------------------------------------------------------------------
// Support planner (`cfg.planner:'support'`, opt-in): the value planner plus the parts of the kit it cannot see —
// Free Aim weak-point shots, party buffs and AP hand-offs — so buff skills and Free Aim relics can be valued.
// The balance profiles keep `planner:'value'`, so the tuning tables do not move when this is changed.
// ---------------------------------------------------------------------------------------------------------

const fightIsLong = (model, actor) => {
  const hp = model.living('enemy').reduce((a, e) => a + e.hp, 0);
  return model.boss || hp > 8 * actor.stats.atk * 2;
};

/**
 * A Free Aim shot worth taking before the turn's real action (shots cost 1 AP and do not end the turn): strip a
 * shield weak point while shields stand, finish a Break with a break weak point, or — for a character whose relics
 * reward shots (shotPower / shotMark) — shoot a crit weak point once there is AP to spare. Null when none is.
 * @returns {{kind:'shot', targetIds:string[], weakPointId:string}|null}
 */
export function supportShot(model, actor, cfg, shotsThisTurn = 0) {
  if (cfg.planner !== 'support' || shotsThisTurn >= 2 || !model.getCommands(actor.id).freeAim?.usable) return null;
  const has = (id) => actor.passives?.some((p) => p.id === id);
  const shotFan = has('shotPower') || has('shotMark');
  const spare = actor.ap - (shotFan ? 1 : 2);
  if (spare < 1) return null;
  for (const e of model.living('enemy')) {
    for (const wp of e.weakPoints ?? []) {
      if (wp.effect === 'shield' && e.shields > 0) return { kind: 'shot', targetIds: [e.id], weakPointId: wp.id };
      if (wp.effect === 'break' && !e.broken && e.breakMax > 0 && e.breakValue + 48 >= e.breakMax) return { kind: 'shot', targetIds: [e.id], weakPointId: wp.id };
    }
  }
  if (shotFan && shotsThisTurn === 0) {
    for (const e of model.living('enemy')) {
      const wp = (e.weakPoints ?? []).find((w) => w.effect === 'crit');
      if (wp && e.shields === 0) return { kind: 'shot', targetIds: [e.id], weakPointId: wp.id };
    }
  }
  return null;
}

/**
 * Buff / hand-off choices of the support planner, in a long fight only: a party-wide positive status nobody holds
 * yet; a self-buff (e.g. Shell) once the caster is below 60% HP; or AP for an ally in Bravura that turns an
 * unaffordable skill into an affordable one (its turn is worth more than the caster's).
 * @returns {{kind:'skill', id:string, targetIds:string[]}|null}
 */
function supportAction(model, actor, cfg, cmds) {
  if (!fightIsLong(model, actor)) return null;
  const S = model.data.SKILLS;
  const living = model.party.filter((m) => m.alive);
  const holds = (m, status) => m.statuses.some((st) => st.id === status);
  const surgePrimed = actor.mechanic?.type === 'surge' && actor.mechanic.value >= 6;
  for (const c of cmds.skills.filter((x) => x.usable)) {
    const def = S[c.id];
    if (!def || (def.hits ?? []).length) continue;
    const buff = (def.effects ?? []).find((e) => e.type === 'status' && ['allies', 'self'].includes(e.target) && STATUS_IS_BUFF.has(e.status));
    if (buff?.target === 'allies' && living.length > 1 && living.every((m) => !holds(m, buff.status))) return { kind: 'skill', id: c.id, targetIds: [] };
    if (buff?.target === 'self' && actor.hp < actor.stats.maxHp * 0.6 && !holds(actor, buff.status)) return { kind: 'skill', id: c.id, targetIds: [] };
    const give = (def.effects ?? []).find((e) => e.type === 'ap' && e.target === 'target');
    if (give && def.target === 'ally' && !surgePrimed) {
      const costs = (m) => (m.skills ?? []).map((id) => Number(S[id]?.ap) || 0).filter((ap) => ap > 0);
      const ally = living.find((m) => m.id !== actor.id && m.mechanic?.type === 'stance' && m.mechanic.value === 'virtuoso'
        && costs(m).some((ap) => ap > m.ap && ap <= m.ap + give.amount));
      if (ally) return { kind: 'skill', id: c.id, targetIds: [ally.id] };
    }
  }
  return null;
}

const STATUS_IS_BUFF = new Set(['powerful', 'shell', 'haste', 'regen']);

/**
 * Chooses one party action for the bot: revive a KO'd ally (skill, else item) → heal an ally under 35% (skill,
 * else item) → the affordable skill / gradient skill with the highest expected damage, unless a basic attack
 * (which builds AP) is within 15% of it. `planner:'value'` replaces the last step with valueAction; `'support'`
 * also buffs and hands out AP first (supportAction) — Free Aim shots are taken by runBattle via supportShot.
 * @returns {{kind:string, id?:string, targetIds:string[]}}
 */
export function botAction(model, actor, cfg) {
  const cmds = model.getCommands(actor.id);
  const S = model.data.SKILLS;
  const party = model.party;
  const dead = party.filter((m) => !m.alive);
  const low = party.filter((m) => m.alive && m.hp / m.stats.maxHp < 0.35).sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp);
  const usable = cmds.skills.filter((s) => s.usable);

  if (dead.length) {
    const rev = usable.find((s) => S[s.id].target === 'deadAlly' && hasEffect(S[s.id], 'revive'));
    if (rev) return { kind: 'skill', id: rev.id, targetIds: [dead[0].id] };
    const tonic = cmds.items.find((i) => i.usable && model.data.ITEMS[i.id]?.target === 'deadAlly');
    if (tonic) return { kind: 'item', id: tonic.id, targetIds: [dead[0].id] };
  }
  if (low.length) {
    const heal = usable.find((s) => ['ally', 'allAllies', 'self'].includes(S[s.id].target) && hasEffect(S[s.id], 'heal')
      && (S[s.id].target !== 'self' || low[0].id === actor.id));
    if (heal) return { kind: 'skill', id: heal.id, targetIds: [low[0].id] };
    const tinc = cmds.items.find((i) => i.usable && model.data.ITEMS[i.id]?.effects?.some((e) => e.type === 'heal'));
    if (tinc) return { kind: 'item', id: tinc.id, targetIds: [low[0].id] };
  }

  if (cfg.planner === 'support') return supportAction(model, actor, cfg, cmds) ?? valueAction(model, actor, cfg, cmds);
  if (cfg.planner === 'value') return valueAction(model, actor, cfg, cmds);

  const enemies = model.living('enemy');
  let best = null;
  const consider = (action, def, isAttack = false) => {
    const tt = isAttack ? 'enemy' : def.target ?? 'enemy';
    if (!['enemy', 'allEnemies', 'randomEnemies'].includes(tt)) return;
    const candidates = tt === 'enemy' ? enemies : [enemies[0]];
    for (const t of candidates) {
      const dmg = estimateDamage(model, actor, def, t.id, cfg, { attack: isAttack });
      if (!best || dmg > best.dmg) best = { dmg, action: { ...action, targetIds: tt === 'enemy' ? [t.id] : [] } };
    }
  };
  const attackDef = { ...actor.basicAttack, target: 'enemy' };
  consider({ kind: 'attack' }, attackDef, true);
  const attackBest = best?.dmg ?? 0;
  for (const s of usable) consider({ kind: 'skill', id: s.id }, S[s.id]);
  for (const g of cmds.gradient.filter((x) => x.usable)) consider({ kind: 'gradient', id: g.id }, S[g.id]);
  if (best && best.action.kind !== 'attack' && best.dmg < attackBest * 1.15) {
    // Not worth spending AP: attack to build it instead.
    best = null;
    consider({ kind: 'attack' }, attackDef, true);
  }
  return best?.action ?? { kind: 'attack', targetIds: [] };
}

// ---------------------------------------------------------------------------------------------------------
// Battle runner & aggregation
// ---------------------------------------------------------------------------------------------------------

/**
 * Runs one bot battle to completion.
 * @param {object} o { data, party, enemies, seed, cfg, difficulty, items, boss, maxTurns }
 * @returns {object} per-battle record
 */
export function runBattle({ data, party, enemies, seed = 1, cfg = DEFAULT_BOT, difficulty = 'expeditioner', items = null, boss, maxTurns = 400 }) {
  const rng = new FixtureRng(seed);
  const bot = new FixtureRng((seed * 2654435761) >>> 0 || 7);
  const model = new BattleModel({ party, enemies, rng, difficulty, data, items, boss });
  const failed = [];
  const attackStats = {};
  const skillUse = {};
  let kos = 0;
  let guard = 0;
  let minHpPct = 1;
  const trackHp = () => {
    const f = model.party.reduce((a, m) => a + m.hp, 0) / Math.max(1, model.party.reduce((a, m) => a + m.stats.maxHp, 0));
    if (f < minHpPct) minHpPct = f;
  };
  while (!model.outcome() && guard++ < maxTurns) {
    const turn = model.nextTurn();
    kos += turn.events.filter((e) => e.type === 'ko' && e.targetId.startsWith('p')).length;
    if (!turn.actorId || turn.skipped) continue;
    const actor = model.get(turn.actorId);
    if (actor.side === 'party') {
      const perform = (plan) => {
        const key = `${actor.key}.${plan.kind === 'attack' ? 'attack' : plan.id ?? plan.kind}`;
        const su = (skillUse[key] ??= { uses: 0, dmg: 0, ap: 0 });
        su.uses++;
        su.ap += plan.events.filter((e) => e.type === 'ap' && e.targetId === actor.id && e.delta < 0).reduce((a, e) => a - e.delta, 0);
        plan.hits.forEach((hh, i) => {
          const evs = model.resolveHit(plan, i, hh.qte ? sampleRating(cfg, bot) : null);
          for (const e of evs) if (e.type === 'damage' && e.sourceId === actor.id && e.targetId.startsWith('e')) su.dmg += e.amount;
        });
        model.finishAction(plan);
      };
      // Free Aim first (support planner only): shots do not end the turn.
      for (let n = 0, shot; !model.outcome() && (shot = supportShot(model, actor, cfg, n)); n++) {
        const plan = model.beginAction(actor.id, shot);
        if (plan.error) break;
        perform(plan);
      }
      if (!model.outcome()) {
        const action = botAction(model, actor, cfg);
        let plan = model.beginAction(actor.id, action);
        if (plan.error) plan = model.beginAction(actor.id, { kind: 'attack', targetIds: [] });
        if (!plan.error) perform(plan);
      }
      model.endTurn(actor.id);
    } else {
      const plan = model.planEnemyAction(actor.id);
      const st = (attackStats[`${actor.key}.${plan.attackId}`] ??= { uses: 0, hits: 0, failed: 0, pctSum: 0, pctMax: 0, avoided: 0 });
      st.uses++;
      plan.hits.forEach((hh, i) => {
        if (hh.type === 'feint') return model.resolveEnemyHit(plan, i, 'hit');
        st.hits++;
        const oc = sampleDefense(hh.type, cfg, bot);
        const evs = model.resolveEnemyHit(plan, i, oc);
        for (const e of evs) {
          if (e.type === 'damage' && e.kind === 'enemy') {
            const t = model.get(e.targetId);
            const pct = e.amount / t.stats.maxHp;
            failed.push(pct);
            st.failed++;
            st.pctSum += pct;
            st.pctMax = Math.max(st.pctMax, pct);
          }
          if (e.type === 'ko' && e.targetId.startsWith('p')) kos++;
        }
        if (oc !== 'hit') st.avoided++;
      });
      model.resolveCounters(plan);
      model.finishEnemyAction(plan);
      model.endTurn(actor.id);
      trackHp();
    }
  }
  const s = model.summary();
  const hpNow = model.party.reduce((a, m) => a + m.hp, 0);
  const hpMax = model.party.reduce((a, m) => a + m.stats.maxHp, 0);
  const enemyHpLeft = model.enemies.reduce((a, e) => a + e.hp, 0) / Math.max(1, model.enemies.reduce((a, e) => a + e.stats.maxHp, 0));
  return {
    outcome: s.outcome ?? 'timeout',
    rounds: s.stats.rounds,
    turns: s.stats.turns,
    partyTurns: s.stats.partyTurns,
    hpPct: hpNow / hpMax,
    deadAtEnd: model.party.filter((m) => !m.alive).length,
    kos,
    failed,
    attackStats,
    enemyHpLeft,
    gradientSkills: s.stats.gradientSkills,
    counters: s.stats.counters,
    breaks: s.stats.breaks,
    damageDealt: s.stats.damageDealt,
    damageTaken: s.stats.damageTaken,
    healing: s.stats.healing,
    skillUse,
    minHpPct,
    itemsUsed: Object.values(s.itemsUsed ?? {}).reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0),
    /** End-of-battle HP per member and the item inventory left (for chained-battle runs, see runChain). */
    partyEnd: s.party.map((m) => ({ id: m.id, hp: m.hp, maxHp: m.maxHp, alive: m.alive, hpAfterRecovery: m.hpAfterRecovery })),
    itemsLeft: s.items,
  };
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
const pct = (v) => `${(v * 100).toFixed(1)}%`;

/**
 * Runs many battles and aggregates the results.
 * @returns {object} report
 */
export function simulate({ data, party, enemies, battles = 200, seed = 69, cfg = DEFAULT_BOT, difficulty = 'expeditioner', items = null, boss }) {
  const runs = [];
  for (let i = 0; i < battles; i++) {
    runs.push(runBattle({ data, party: structuredClone(party), enemies, seed: (seed + i * 7919) >>> 0, cfg, difficulty, items: items ? structuredClone(items) : null, boss }));
  }
  const wins = runs.filter((r) => r.outcome === 'victory');
  const attacks = {};
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.attackStats)) {
      const a = (attacks[k] ??= { uses: 0, hits: 0, failed: 0, pctSum: 0, pctMax: 0, avoided: 0 });
      a.uses += v.uses;
      a.hits += v.hits;
      a.failed += v.failed;
      a.pctSum += v.pctSum;
      a.avoided += v.avoided;
      a.pctMax = Math.max(a.pctMax, v.pctMax);
    }
  }
  const failed = runs.flatMap((r) => r.failed);
  const skills = {};
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.skillUse ?? {})) {
      const a = (skills[k] ??= { uses: 0, dmg: 0, ap: 0 });
      a.uses += v.uses;
      a.dmg += v.dmg;
      a.ap += v.ap;
    }
  }
  return {
    battles,
    skills,
    minHpPct: { avg: mean(runs.map((r) => r.minHpPct)), p10: [...runs.map((r) => r.minHpPct)].sort((x, y) => x - y)[Math.floor(runs.length * 0.1)] ?? 0 },
    itemsPerBattle: mean(runs.map((r) => r.itemsUsed ?? 0)),
    damageTakenPerBattle: mean(runs.map((r) => r.damageTaken ?? 0)),
    healingPerBattle: mean(runs.map((r) => r.healing ?? 0)),
    winRate: wins.length / battles,
    outcomes: runs.reduce((o, r) => ((o[r.outcome] = (o[r.outcome] ?? 0) + 1), o), {}),
    rounds: { avg: mean(runs.map((r) => r.rounds)), median: median(runs.map((r) => r.rounds)) },
    turns: { avg: mean(runs.map((r) => r.turns)), median: median(runs.map((r) => r.turns)) },
    hpPctOnWin: mean(wins.map((r) => r.hpPct)),
    deathsPerBattle: mean(runs.map((r) => r.kos)),
    deadAtEnd: mean(runs.map((r) => r.deadAtEnd)),
    failedDefense: { avg: mean(failed), median: median(failed), max: failed.length ? Math.max(...failed) : 0, count: failed.length },
    enemyHpLeftOnLoss: mean(runs.filter((r) => r.outcome !== 'victory').map((r) => r.enemyHpLeft)),
    gradientSkillsPerBattle: mean(runs.map((r) => r.gradientSkills)),
    countersPerBattle: mean(runs.map((r) => r.counters)),
    breaksPerBattle: mean(runs.map((r) => r.breaks)),
    attacks: Object.fromEntries(Object.entries(attacks).map(([k, a]) => [k, {
      uses: a.uses, hits: a.hits, avoidRate: a.hits ? a.avoided / a.hits : 0,
      avgFailedPct: a.failed ? a.pctSum / a.failed : 0, maxPct: a.pctMax,
    }])),
  };
}

/**
 * Plays `encounters` back to back the way the world does between two pennant rests: HP and items carry over, KO'd
 * members come back at 1 HP, then the difficulty's `postBattleRecovery` applies (the model's hpAfterRecovery: 20%,
 * none on Veteran). Between fights the player drinks tinctures on anyone below `topUpBelow` of max HP. Stops at the
 * first battle that is not won.
 * @param {object} o { data, party, encounters:[{enemies, boss?}], seed, cfg, difficulty, items, topUpBelow }
 * @returns {{ won:boolean, cleared:number, hpPct:number, tincturesLeft:number }}
 */
export function runChain({ data, party, encounters, seed = 1, cfg = DEFAULT_BOT, difficulty = 'expeditioner', items = null, topUpBelow = 0.5 }) {
  let snap = structuredClone(party);
  let inv = items ? structuredClone(items) : null;
  const tincture = data.ITEMS?.tincture;
  const tinctureHeal = tincture?.effects?.find((e) => e.type === 'heal')?.pct ?? 0;
  let cleared = 0;
  for (const [i, enc] of encounters.entries()) {
    const r = runBattle({ data, party: snap, enemies: enc.enemies, seed: (seed + i * 104729) >>> 0, cfg, difficulty, items: inv, boss: enc.boss });
    if (r.outcome !== 'victory') return { won: false, cleared, hpPct: 0, tincturesLeft: inv?.tincture?.count ?? 0 };
    cleared++;
    inv = r.itemsLeft ? structuredClone(r.itemsLeft) : inv;
    snap = snap.map((m) => {
      const end = r.partyEnd.find((x) => x.id === m.id);
      let hp = end ? end.hpAfterRecovery : m.hp;
      while (tinctureHeal && inv?.tincture?.count > 0 && hp < m.stats.maxHp * topUpBelow) {
        inv.tincture.count--;
        hp = Math.min(m.stats.maxHp, hp + Math.round(m.stats.maxHp * tinctureHeal));
      }
      return { ...m, hp, alive: true };
    });
  }
  const hpPct = snap.reduce((a, m) => a + m.hp, 0) / Math.max(1, snap.reduce((a, m) => a + m.stats.maxHp, 0));
  return { won: true, cleared, hpPct, tincturesLeft: inv?.tincture?.count ?? 0 };
}

/** Pretty text report. */
export function formatReport(title, r) {
  const lines = [];
  lines.push(`\n== ${title} ==`);
  lines.push(`battles ${r.battles} · win rate ${pct(r.winRate)} · outcomes ${JSON.stringify(r.outcomes)}`);
  lines.push(`rounds avg ${r.rounds.avg.toFixed(2)} / median ${r.rounds.median} · turns avg ${r.turns.avg.toFixed(1)} / median ${r.turns.median}`);
  lines.push(`party HP left on wins ${pct(r.hpPctOnWin)} · KOs per battle ${r.deathsPerBattle.toFixed(2)} · down at end ${r.deadAtEnd.toFixed(2)}`);
  lines.push(`failed defense dmg (% target max HP): avg ${pct(r.failedDefense.avg)} · median ${pct(r.failedDefense.median)} · max ${pct(r.failedDefense.max)} (${r.failedDefense.count} hits)`);
  if (r.winRate < 1) lines.push(`enemy HP left on losses ${pct(r.enemyHpLeftOnLoss)}`);
  lines.push(`per battle: gradient skills ${r.gradientSkillsPerBattle.toFixed(2)} · counters ${r.countersPerBattle.toFixed(2)} · breaks ${r.breaksPerBattle.toFixed(2)}`);
  lines.push('enemy attacks:');
  const rows = Object.entries(r.attacks).sort((a, b) => b[1].avgFailedPct - a[1].avgFailedPct);
  for (const [k, a] of rows) {
    lines.push(`  ${k.padEnd(34)} uses ${String(a.uses).padStart(5)} · hits ${String(a.hits).padStart(5)} · avoided ${pct(a.avoidRate).padStart(6)} · failed-hit dmg avg ${pct(a.avgFailedPct).padStart(6)} max ${pct(a.maxPct).padStart(6)}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------

/** Parses `--key value` / `--flag` arguments. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function tryImport(rel, root = ROOT) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return { mod: null, error: `${rel} not found` };
  try {
    return { mod: await import(pathToFileURL(file).href), error: null };
  } catch (err) {
    return { mod: null, error: `${rel}: ${err.message}` };
  }
}

/**
 * Loads the real data modules; returns { data, gs, prog, ENCOUNTERS, missing[] } (data is null when a required
 * module is missing or fails to import).
 * @param {string} [root] project root (defaults to this repository)
 */
export async function loadRealData(root = ROOT) {
  const names = {
    characters: 'src/data/characters.js', skills: 'src/data/skills.js', enemies: 'src/data/enemies.js', items: 'src/data/items.js',
    relics: 'src/data/relics.js', qte: 'src/battle/qte.js', gameState: 'src/game/gameState.js', progression: 'src/game/progression.js',
    encounters: 'src/data/encounters.js',
  };
  const mods = {};
  const missing = [];
  for (const [k, rel] of Object.entries(names)) {
    const { mod, error } = await tryImport(rel, root);
    mods[k] = mod;
    if (error) missing.push(error);
  }
  const required = ['characters', 'skills', 'enemies', 'items', 'qte'];
  const ok = required.every((k) => mods[k]);
  if (!ok) return { data: null, missing };
  const data = {
    CHARACTERS: mods.characters.CHARACTERS, SKILLS: mods.skills.SKILLS, ENEMIES: mods.enemies.ENEMIES, ITEMS: mods.items.ITEMS,
    DIFFICULTY: mods.qte.DIFFICULTY, RELICS: mods.relics?.RELICS ?? {}, STARTING_RELICS: mods.relics?.STARTING_RELICS ?? {},
  };
  return { data, gs: mods.gameState, prog: mods.progression, ENCOUNTERS: mods.encounters?.ENCOUNTERS ?? null, missing };
}

function buildParty(ctx, level, alloc, log) {
  if (ctx.gs && ctx.prog) {
    try {
      const r = buildPartyFromGameState(ctx.gs, ctx.prog, ctx.data.SKILLS, level, alloc);
      if (r.party.length) return r;
    } catch (err) {
      log(`(gameState party build failed: ${err.message}; using CHARACTERS base/growth)`);
    }
  }
  return { party: buildPartyManual(ctx.data, level), items: null };
}

function describeParty(party) {
  return party.map((m) => `${m.id} L${m.level} HP${m.stats.maxHp} ATK${Math.round(m.stats.atk)} DEF${Math.round(m.stats.def)} SPD${Math.round(m.stats.spd)} skills:${m.skills.length}`).join(' | ');
}

/**
 * Party level a typical run (each zone cleared ≈1.3×, SPEC §3.3) has when it meets an encounter: regular encounters
 * interpolate across the zone band in authoring (rising-difficulty) order; bosses sit at the band's end.
 */
export const CAMPAIGN_BANDS = Object.freeze({ shore: [1, 4], thicket: [5, 9], spire: [10, 14], summit: [15, 15], training: [1, 1] });
export const CAMPAIGN_BOSS_LEVELS = Object.freeze({ boss_wreck_warden: 5, boss_bellwether: 10, boss_stillkeeper: 15 });
export function campaignLevel(enc, ENCOUNTERS) {
  if (CAMPAIGN_BOSS_LEVELS[enc.id]) return CAMPAIGN_BOSS_LEVELS[enc.id];
  if (enc.tutorial) return 1;
  const [lo, hi] = CAMPAIGN_BANDS[enc.zone] ?? [1, 1];
  const list = Object.values(ENCOUNTERS).filter((e) => e.zone === enc.zone && !e.boss && !e.tutorial);
  const i = list.findIndex((e) => e.id === enc.id);
  return list.length > 1 ? Math.round(lo + ((hi - lo) * i) / (list.length - 1)) : lo;
}

function compactRow(job, diff, r) {
  const fd = r.failedDefense;
  return `${job.id.padEnd(24)} L${String(job.level).padStart(2)} ${diff.slice(0, 4)}  win ${pct(r.winRate).padStart(6)}  rounds ${r.rounds.avg.toFixed(2).padStart(5)}`
    + `  hpLeft ${pct(r.hpPctOnWin).padStart(6)}  minHp p10 ${pct(r.minHpPct.p10).padStart(6)}  KOs ${r.deathsPerBattle.toFixed(2)}  items ${r.itemsPerBattle.toFixed(2)}`
    + `  failHit ${pct(fd.avg).padStart(6)} max ${pct(fd.max).padStart(6)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 14).join('\n'));
    return;
  }
  const say = args.json ? () => {} : (m) => console.log(m);
  let ctx;
  if (args.fixtures) {
    ctx = { data: createFixtureData(), gs: null, prog: null, ENCOUNTERS: null };
    say('Using built-in fixture data (--fixtures).');
  } else {
    const real = await loadRealData(typeof args.root === 'string' ? path.resolve(args.root) : ROOT);
    if (!real.data) {
      console.error('Real data modules are not available yet:');
      for (const m of real.missing) console.error(`  - ${m}`);
      console.error('Run with --fixtures to simulate on the built-in fixture data.');
      process.exitCode = 1;
      return;
    }
    if (real.missing.length) say(`(optional modules missing: ${real.missing.join('; ')})`);
    ctx = real;
  }
  const num = (k, d) => (args[k] !== undefined && args[k] !== true ? Number(args[k]) : d);
  const profileName = typeof args.profile === 'string' ? args.profile : 'default';
  const base = BOT_PROFILES[profileName];
  if (!base) {
    console.error(`Unknown profile "${profileName}". Known: ${Object.keys(BOT_PROFILES).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const cfg = { ...base };
  for (const k of ['parry', 'dodge', 'jump', 'gradient', 'perfect', 'good', 'perfectDodge', 'parryTry', 'gradientTry']) cfg[k] = num(k, cfg[k]);
  if (typeof args.planner === 'string') cfg.planner = args.planner;
  if (args.unparryable !== undefined) cfg.unparryable = num('unparryable', null);
  const battles = Math.max(1, Math.floor(num('battles', 200)));
  const seed = Math.floor(num('seed', 69)) >>> 0;
  const diffArg = typeof args.difficulty === 'string' ? args.difficulty : 'expeditioner';
  const difficulties = diffArg === 'all' ? ['story', 'expeditioner', 'veteran'] : diffArg.split(',');
  // Profiles in 'attempt' mode describe Expeditioner timing; other difficulties rescale them (--no-scale disables).
  const scaleWindows = args['no-scale'] ? false : (cfg.mode === 'attempt' || !!args['scale-windows']);
  const alloc = args.alloc === 'even' ? 'even' : 'auto';
  say(`bot ${profileName}: ${JSON.stringify(cfg)} · difficulty ${difficulties.join(',')} · window scaling ${scaleWindows ? 'on' : 'off'} · seed ${seed}`);

  const jobs = [];
  if (args.sweep || args.campaign) {
    const encs = ctx.ENCOUNTERS
      ? Object.values(ctx.ENCOUNTERS)
      : [{ id: 'fixture_pair', enemies: ['driftling', 'shellguard'] }, { id: 'fixture_tide', enemies: ['tidecaller', 'driftling'] }, { id: 'fixture_boss', enemies: ['warden'], boss: true }];
    const only = typeof args.zone === 'string' ? args.zone.split(',') : null;
    for (const e of encs) {
      if (e.zone === 'training' && args.campaign && !args.training) continue;
      if (only && !only.includes(e.zone)) continue;
      if (args['bosses-only'] && !e.boss) continue;
      if (args['no-bosses'] && e.boss) continue;
      const lv = args.level !== undefined ? num('level', 1)
        : args.campaign && ctx.ENCOUNTERS ? campaignLevel(e, ctx.ENCOUNTERS) + num('level-offset', 0)
          : Math.max(...e.enemies.map((id) => ctx.data.ENEMIES[id]?.level ?? 1));
      jobs.push({ id: e.id, title: `${e.id} [${e.enemies.join(', ')}] @ party L${lv}`, enemies: e.enemies, level: Math.max(1, Math.min(20, lv)), boss: e.boss, zone: e.zone, tutorial: e.tutorial });
    }
  } else {
    let enemies;
    let boss;
    let id = 'custom';
    if (typeof args.encounter === 'string') {
      const e = ctx.ENCOUNTERS?.[args.encounter];
      if (!e) {
        console.error(`Unknown encounter "${args.encounter}".`);
        process.exitCode = 1;
        return;
      }
      enemies = e.enemies;
      boss = e.boss;
      id = e.id;
    } else enemies = typeof args.enemies === 'string' ? args.enemies.split(',').map((s) => s.trim()).filter(Boolean) : ['driftling', 'shellguard'];
    const unknown = enemies.filter((eid) => !ctx.data.ENEMIES[eid]);
    if (unknown.length) {
      console.error(`Unknown enemy id(s): ${unknown.join(', ')}. Known: ${Object.keys(ctx.data.ENEMIES).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const lv = args.level !== undefined ? num('level', 1) : Math.max(...enemies.map((eid) => ctx.data.ENEMIES[eid]?.level ?? 1));
    jobs.push({ id, title: `[${enemies.join(', ')}] @ party L${lv}`, enemies, level: lv, boss });
  }

  const reports = [];
  const partyCache = new Map();
  const partyFor = (level) => {
    if (!partyCache.has(level)) {
      const built = buildParty(ctx, level, alloc, args.compact ? () => {} : say);
      partyCache.set(level, built);
      if (!args.compact) say(`party L${level}: ${describeParty(built.party)}`);
    }
    return partyCache.get(level);
  };
  const skillTotals = {};
  const chainLen = args.chain ? Math.max(2, Math.floor(num('chain', 3))) : 0;
  for (const diff of difficulties) {
    const k = ctx.data.DIFFICULTY?.[diff]?.windowScale ?? 1;
    const dcfg = scaleWindows ? scaleBotForWindows(cfg, k) : cfg;
    if (scaleWindows && difficulties.length > 1) say(`-- ${diff}: ${JSON.stringify(Object.fromEntries(Object.entries(dcfg).map(([a, b]) => [a, typeof b === 'number' ? Math.round(b * 1000) / 1000 : b])))}`);
    if (chainLen) {
      // --chain N: every run of N consecutive regular encounters of a zone, fought back to back from a pennant rest.
      const zones = new Map();
      for (const job of jobs) {
        if (job.boss || job.tutorial) continue;
        if (!zones.has(job.zone)) zones.set(job.zone, []);
        zones.get(job.zone).push(job);
      }
      for (const [zone, list] of zones) {
        for (let i = 0; i + chainLen <= list.length; i++) {
          const win = list.slice(i, i + chainLen);
          const { party, items } = partyFor(win[0].level);
          let won = 0;
          let hp = 0;
          let left = 0;
          for (let b = 0; b < battles; b++) {
            const r = runChain({ data: ctx.data, party, encounters: win, seed: (seed + b * 7919) >>> 0, cfg: dcfg, difficulty: diff, items });
            if (r.won) {
              won++;
              hp += r.hpPct;
              left += r.tincturesLeft;
            }
          }
          say(`${String(zone).padEnd(8)} L${String(win[0].level).padStart(2)} ${diff.slice(0, 4)}  chain ${win.map((j) => j.id).join(' → ')}`
            + `  cleared ${pct(won / battles).padStart(6)}  hp at end ${pct(won ? hp / won : 0).padStart(6)}  tinctures left ${(won ? left / won : 0).toFixed(1)}`);
        }
      }
      continue;
    }
    for (const job of jobs) {
      const { party, items } = partyFor(job.level);
      const report = simulate({ data: ctx.data, party, enemies: job.enemies, battles, seed, cfg: dcfg, difficulty: diff, items, boss: job.boss });
      reports.push({ title: job.title, id: job.id, level: job.level, difficulty: diff, ...report });
      for (const [sk, v] of Object.entries(report.skills)) {
        const a = (skillTotals[sk] ??= { uses: 0, dmg: 0, ap: 0 });
        a.uses += v.uses; a.dmg += v.dmg; a.ap += v.ap;
      }
      say(args.compact ? compactRow(job, diff, report) : formatReport(`${job.title} · ${diff}`, report));
    }
  }
  if (args.skills) {
    say('\nskill usage (all jobs): uses · share of owner actions · avg dmg per use · avg AP');
    const owners = {};
    for (const [sk, v] of Object.entries(skillTotals)) (owners[sk.split('.')[0]] ??= []).push([sk, v]);
    for (const [o, list] of Object.entries(owners)) {
      const tot = list.reduce((a, [, v]) => a + v.uses, 0);
      for (const [sk, v] of list.sort((a, b) => b[1].uses - a[1].uses)) {
        say(`  ${sk.padEnd(30)} ${String(v.uses).padStart(7)} ${pct(v.uses / tot).padStart(6)}  dmg/use ${(v.dmg / v.uses).toFixed(0).padStart(6)}  ap ${(v.ap / v.uses).toFixed(2)}`);
      }
    }
  }
  if (args.json) console.log(JSON.stringify(reports, null, 2));
}

const invokedDirectly = (() => {
  try {
    return import.meta.main === true || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
