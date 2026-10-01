// Tests for src/battle/damage.js and src/battle/status.js: the SPEC §3.2 damage formula term by term, heals,
// expected damage, and the status table / apply / refresh / tick / cleanse / dispel helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDamage, computeHeal, expectedDamage, affinityOf, qteMultiplier, mitigation, effectiveAtk,
  STANCE_MODS, QTE_MULTIPLIERS,
} from '../src/battle/damage.js';
import {
  STATUS_DEFS, STATUS_IDS, applyStatus, removeStatus, hasStatus, statusTurns, tickStartOfTurn, tickEndOfTurn,
  cleanseStatuses, dispelStatuses, clearStatuses, canReceiveStatus,
} from '../src/battle/status.js';
import { ConstRng } from '../tools/simulate.mjs';

const unit = (over = {}) => ({
  side: 'enemy', alive: true, hp: 1000, stats: { maxHp: 1000, atk: 100, def: 0, spd: 40, crit: 0 },
  statuses: [], passives: [], affinities: {}, mechanic: null, ...over,
});
const dmg = (ctx) => computeDamage({ variance: false, ...ctx }).amount;

test('base formula: power × atk × 100/(100+def)', () => {
  const a = unit();
  assert.equal(dmg({ attacker: a, target: unit(), power: 1 }), 100);
  assert.equal(dmg({ attacker: a, target: unit({ stats: { maxHp: 1, atk: 1, def: 100, spd: 1, crit: 0 } }), power: 1 }), 50);
  assert.equal(dmg({ attacker: a, target: unit(), power: 2.5 }), 250);
  assert.equal(mitigation(-20), 1, 'negative defense is clamped to 0');
  assert.equal(dmg({ attacker: a, target: unit(), power: 0.001 }), 1, 'minimum 1 damage');
  assert.equal(dmg({ attacker: a, target: unit(), power: 0 }), 0, 'zero-power hits deal nothing');
});

test('affinities: weak 1.5, resist 0.5, immune 0 with labels', () => {
  const a = unit();
  const t = unit({ affinities: { fire: 1.5, ice: 0.5, light: 0 } });
  let r = computeDamage({ attacker: a, target: t, power: 1, element: 'fire', variance: false });
  assert.deepEqual([r.amount, r.affinity], [150, 'weak']);
  r = computeDamage({ attacker: a, target: t, power: 1, element: 'ice', variance: false });
  assert.deepEqual([r.amount, r.affinity], [50, 'resist']);
  r = computeDamage({ attacker: a, target: t, power: 1, element: 'light', variance: false });
  assert.deepEqual([r.amount, r.affinity], [0, 'immune']);
  assert.equal(affinityOf(t, 'earth').label, null);
});

test('crits: forced, rolled, critDamage bonus, critVsBroken, noCrit', () => {
  const a = unit({ stats: { maxHp: 1, atk: 100, def: 0, spd: 1, crit: 0.05 } });
  const t = unit();
  assert.equal(dmg({ attacker: a, target: t, power: 1, forceCrit: true }), 150);
  assert.equal(dmg({ attacker: a, target: t, power: 1, forceCrit: true, critMult: 2 }), 200);
  const keen = unit({ stats: a.stats, passives: [{ id: 'critDamage', params: { bonus: 0.3 } }] });
  assert.equal(dmg({ attacker: keen, target: t, power: 1, forceCrit: true }), 180);
  // Rolled: next() = 0.04 < 0.05 → crit; 0.5 → no crit.
  assert.equal(computeDamage({ attacker: a, target: t, power: 1, rng: new ConstRng(0.04), variance: false }).crit, true);
  assert.equal(computeDamage({ attacker: a, target: t, power: 1, rng: new ConstRng(0.5), variance: false }).crit, false);
  assert.equal(computeDamage({ attacker: a, target: t, power: 1, rng: new ConstRng(0.3), critBonus: 0.3, variance: false }).crit, true);
  const hunter = unit({ stats: a.stats, passives: [{ id: 'critVsBroken', params: { bonus: 0.35 } }] });
  assert.equal(computeDamage({ attacker: hunter, target: t, power: 1, rng: new ConstRng(0.2), variance: false }).crit, false);
  assert.equal(computeDamage({ attacker: hunter, target: unit({ broken: true }), power: 1, rng: new ConstRng(0.2), variance: false }).crit, true);
  assert.equal(computeDamage({ attacker: hunter, target: unit({ statuses: [{ id: 'defenseless', turns: 1 }] }), power: 1, rng: new ConstRng(0.2), variance: false }).crit, true);
  assert.equal(computeDamage({ attacker: a, target: t, power: 1, rng: new ConstRng(0), noCrit: true, variance: false }).crit, false);
});

test('QTE multipliers 1.4 / 1.15 / 1.0 and perfectPower', () => {
  const a = unit();
  const t = unit();
  assert.deepEqual(QTE_MULTIPLIERS, { perfect: 1.4, good: 1.15, miss: 1 });
  assert.equal(dmg({ attacker: a, target: t, power: 1, qteRating: 'perfect' }), 140);
  assert.equal(dmg({ attacker: a, target: t, power: 1, qteRating: 'good' }), 115);
  assert.equal(dmg({ attacker: a, target: t, power: 1, qteRating: 'miss' }), 100);
  assert.equal(qteMultiplier(null), 1);
  const metro = unit({ passives: [{ id: 'perfectPower', params: { mult: 1.15 } }] });
  assert.equal(dmg({ attacker: metro, target: t, power: 1, qteRating: 'perfect' }), 161);
});

test('stance dealt and taken multipliers', () => {
  const stance = (value) => ({ type: 'stance', value });
  const t = unit();
  assert.equal(dmg({ attacker: unit({ mechanic: stance('assault') }), target: t, power: 1 }), 140);
  assert.equal(dmg({ attacker: unit({ mechanic: stance('guard') }), target: t, power: 1 }), 85);
  assert.equal(dmg({ attacker: unit({ mechanic: stance('virtuoso') }), target: t, power: 1 }), 200);
  assert.equal(dmg({ attacker: unit(), target: unit({ side: 'party', mechanic: stance('assault') }), power: 1 }), 120);
  assert.equal(dmg({ attacker: unit(), target: unit({ side: 'party', mechanic: stance('guard') }), power: 1 }), 65);
  assert.equal(dmg({ attacker: unit(), target: unit({ side: 'party', mechanic: stance('virtuoso') }), power: 1 }), 125);
  assert.equal(STANCE_MODS.neutral.dealt, 1);
});

test('statuses in the formula: powerful, weakened, defenseless, shell, mark', () => {
  const st = (id) => [{ id, turns: 2 }];
  const t = unit();
  assert.equal(dmg({ attacker: unit({ statuses: st('powerful') }), target: t, power: 1 }), 125);
  assert.equal(dmg({ attacker: unit({ statuses: st('weakened') }), target: t, power: 1 }), 75);
  assert.equal(effectiveAtk(unit({ statuses: [...st('powerful'), ...st('weakened')] })), 100 * 1.25 * 0.75);
  assert.equal(dmg({ attacker: unit(), target: unit({ statuses: st('defenseless') }), power: 1 }), 125);
  assert.equal(dmg({ attacker: unit(), target: unit({ statuses: st('shell') }), power: 1 }), 70);
  const r = computeDamage({ attacker: unit(), target: unit({ statuses: st('mark') }), power: 1, variance: false });
  assert.deepEqual([r.amount, r.marked], [150, true]);
});

test('passive multipliers and difficulty dmgTakenMult (party targets only)', () => {
  const t = unit();
  const low = unit({ hp: 300, passives: [{ id: 'lowHpPower', params: { threshold: 0.35, mult: 1.35 } }] });
  assert.equal(dmg({ attacker: low, target: t, power: 1 }), 135);
  assert.equal(dmg({ attacker: { ...low, hp: 400 }, target: t, power: 1 }), 100);
  const glass = unit({ passives: [{ id: 'glassCannon', params: { dealt: 1.3, taken: 1.3 } }] });
  assert.equal(dmg({ attacker: glass, target: t, power: 1 }), 130);
  assert.equal(dmg({ attacker: unit(), target: { ...glass, side: 'party' }, power: 1 }), 130);
  const cinder = unit({ passives: [{ id: 'elementPower', params: { element: 'fire', mult: 1.3 } }] });
  assert.equal(dmg({ attacker: cinder, target: t, power: 1, element: 'fire' }), 130);
  assert.equal(dmg({ attacker: cinder, target: t, power: 1, element: 'ice' }), 100);
  const eye = unit({ passives: [{ id: 'shotPower', params: { mult: 1.5 } }] });
  assert.equal(dmg({ attacker: eye, target: t, power: 1, kind: 'shot' }), 150);
  assert.equal(dmg({ attacker: eye, target: t, power: 1, kind: 'skill' }), 100);
  const pin = unit({ passives: [{ id: 'counterPower', params: { mult: 1.5 } }] });
  assert.equal(dmg({ attacker: pin, target: t, power: 1, kind: 'counter' }), 150);
  const partyTarget = unit({ side: 'party' });
  assert.equal(dmg({ attacker: unit(), target: partyTarget, power: 1, dmgTakenMult: 1.35 }), 135);
  assert.equal(dmg({ attacker: unit(), target: partyTarget, power: 1, dmgTakenMult: 0.6 }), 60);
  assert.equal(dmg({ attacker: unit(), target: unit(), power: 1, dmgTakenMult: 1.35 }), 100, 'enemies ignore difficulty');
});

test('variance is uniform 0.95–1.05 from the rng', () => {
  const a = unit();
  const t = unit();
  assert.equal(computeDamage({ attacker: a, target: t, power: 10, rng: new ConstRng(0) }).amount, 950);
  assert.equal(computeDamage({ attacker: a, target: t, power: 10, rng: new ConstRng(0.5) }).amount, 1000);
  assert.equal(computeDamage({ attacker: a, target: t, power: 10, rng: new ConstRng(0.9999) }).amount, 1050);
});

test('expectedDamage averages crits without rolling', () => {
  const a = unit({ stats: { maxHp: 1, atk: 100, def: 0, spd: 1, crit: 0.5 } });
  assert.equal(expectedDamage({ attacker: a, target: unit(), power: 1 }), 100 * (0.5 + 0.5 * 1.5));
  assert.equal(expectedDamage({ attacker: a, target: unit(), power: 1, qteMult: 1.2, noCrit: true }), 120);
});

test('computeHeal: pct of target max HP, power × atk × 0.5, healPower', () => {
  const healer = unit();
  const t = unit({ stats: { maxHp: 400, atk: 10, def: 0, spd: 1, crit: 0 } });
  assert.equal(computeHeal({ healer, target: t, pct: 0.3 }), 120);
  assert.equal(computeHeal({ healer, target: t, power: 1.5 }), 75);
  const quill = unit({ passives: [{ id: 'healPower', params: { mult: 1.35 } }] });
  assert.equal(computeHeal({ healer: quill, target: t, pct: 0.3 }), 162);
  assert.equal(computeHeal({ healer, target: t }), 0);
});

test('STATUS_DEFS: closed table with names, polarity, descriptions and default turns', () => {
  const expected = {
    burn: [false, 3], chill: [false, 2], mark: [false, 3], powerful: [true, 3], shell: [true, 3], haste: [true, 3],
    slow: [false, 2], weakened: [false, 2], defenseless: [false, 2], stun: [false, 1], regen: [true, 3], silence: [false, 2],
  };
  assert.deepEqual([...STATUS_IDS].sort(), Object.keys(expected).sort());
  for (const [id, [positive, turns]] of Object.entries(expected)) {
    const d = STATUS_DEFS[id];
    assert.equal(d.id, id);
    assert.equal(d.positive, positive, `${id} polarity`);
    assert.equal(d.defaultTurns, turns, `${id} turns`);
    assert.ok(d.name && d.desc.length > 10, `${id} has name/desc`);
  }
});

test('applyStatus: default turns, refresh to max, resist, immune, KO, unknown', () => {
  const c = unit();
  assert.deepEqual(applyStatus(c, 'burn'), { applied: true, turns: 3, refreshed: false });
  assert.equal(applyStatus(c, 'burn', 1).turns, 3, 'refresh keeps the longer duration');
  assert.equal(applyStatus(c, 'burn', 5).turns, 5);
  assert.equal(statusTurns(c, 'burn'), 5);
  assert.equal(c.statuses.length, 1);
  assert.equal(applyStatus(unit({ statusResist: ['burn'] }), 'burn').reason, 'resist');
  assert.equal(applyStatus(unit({ passives: [{ id: 'statusImmune', params: { status: 'stun' } }] }), 'stun').reason, 'immune');
  assert.equal(applyStatus(unit({ alive: false }), 'burn').reason, 'ko');
  assert.equal(applyStatus(c, 'doom').reason, 'unknown');
  assert.equal(canReceiveStatus(c, 'slow').ok, true);
  assert.equal(removeStatus(c, 'burn'), true);
  assert.equal(hasStatus(c, 'burn'), false);
  assert.equal(removeStatus(c, 'burn'), false);
});

test('tickEndOfTurn decrements, expires, spares fresh statuses once and never ticks stun', () => {
  const c = unit();
  applyStatus(c, 'haste', 2);
  applyStatus(c, 'stun', 1);
  applyStatus(c, 'powerful', 1, { fresh: true });
  assert.deepEqual(tickEndOfTurn(c), []);
  assert.equal(statusTurns(c, 'haste'), 1);
  assert.equal(statusTurns(c, 'powerful'), 1, 'fresh status spared at the end of the turn it was applied');
  assert.deepEqual(tickEndOfTurn(c).sort(), ['haste', 'powerful']);
  assert.equal(hasStatus(c, 'stun'), true, 'stun is only consumed by a skipped turn');
});

test('tickStartOfTurn: burn 5% (bosses 1.5%) and regen 8% of max HP', () => {
  const c = unit({ statuses: [{ id: 'burn', turns: 2 }, { id: 'regen', turns: 2 }] });
  assert.deepEqual(tickStartOfTurn(c), [{ status: 'burn', kind: 'damage', amount: 50 }, { status: 'regen', kind: 'heal', amount: 80 }]);
  assert.equal(tickStartOfTurn({ ...c, boss: true })[0].amount, 15);
  assert.deepEqual(tickStartOfTurn({ ...c, alive: false }), []);
});

test('cleanse removes debuffs, dispel removes buffs, clear removes all', () => {
  const mk = () => unit({ statuses: [{ id: 'burn', turns: 2 }, { id: 'haste', turns: 2 }, { id: 'mark', turns: 1 }, { id: 'regen', turns: 1 }] });
  let c = mk();
  assert.deepEqual(cleanseStatuses(c), ['burn', 'mark']);
  assert.deepEqual(c.statuses.map((s) => s.id), ['haste', 'regen']);
  c = mk();
  assert.deepEqual(dispelStatuses(c), ['haste', 'regen']);
  assert.deepEqual(c.statuses.map((s) => s.id), ['burn', 'mark']);
  c = mk();
  assert.equal(clearStatuses(c).length, 4);
  assert.equal(c.statuses.length, 0);
});
