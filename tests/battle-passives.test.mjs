// Tests for every passive in the closed list of SPEC §3.4 (src/battle/passives.js hooks as used by BattleModel),
// plus passive normalisation (echo/relic de-duplication) and descriptions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSIVE_IDS, describePassive, normalizePassives, shotMarkChance } from '../src/battle/passives.js';
import { createFixtureModel, forceTurn, runPartyAction, runEnemyAction, ConstRng } from '../tools/simulate.mjs';

const MIT = (def) => 100 / (100 + def);
const types = (events, type) => events.filter((e) => e.type === type);
const dmg = (events, id) => types(events, 'damage').filter((e) => e.targetId === id).map((e) => e.amount);

/** Fixture model where party member `slot` carries `passives`. */
function withPassives(slot, passives, opts = {}) {
  return createFixtureModel({
    ...opts,
    tweak: (party, d) => {
      party[slot].passives = passives.map((p, i) => ({ source: `relic_${i}`, ...p }));
      opts.tweak?.(party, d);
    },
  }).model;
}

/** Plans `attackId` for enemy e0 against `targets`. */
function enemyPlan(model, attackId, targets, enemyId = 'e0') {
  model.get(enemyId).pool = [attackId];
  forceTurn(model, enemyId);
  const plan = model.planEnemyAction(enemyId);
  for (const h of plan.hits) h.targetIds = [...targets];
  plan.targetIds = [...targets];
  return plan;
}

test('closed list: 24 passive ids, all described', () => {
  assert.equal(PASSIVE_IDS.length, 24);
  const sample = { amount: 1, pct: 0.04, mult: 1.3, status: 'burn', turns: 2, chance: 0.5, threshold: 0.35, bonus: 0.3, dealt: 1.3, taken: 1.3, element: 'fire' };
  for (const id of PASSIVE_IDS) assert.ok(describePassive({ id, params: sample }).length > 8, id);
  assert.equal(describePassive({ id: 'nope' }), '');
});

test('normalizePassives drops unknown ids and de-duplicates relic + echo of the same relic', () => {
  const list = normalizePassives([
    { id: 'startAp', params: { amount: 1 }, source: 'dawn_locket' },
    { id: 'startAp', params: { amount: 1 }, source: 'echo:dawn_locket' },
    { id: 'startAp', params: { amount: 1 }, source: 'other_relic' },
    { id: 'flyingCastle', params: {} },
    null,
  ]);
  assert.deepEqual(list.map((p) => p.source), ['dawn_locket', 'other_relic']);
  assert.ok(Math.abs(shotMarkChance({ passives: [{ id: 'shotMark', params: { chance: 0.5 } }, { id: 'shotMark', params: { chance: 0.5 } }] }) - 0.75) < 1e-9);
});

test('startAp and startStatus apply at battle start', () => {
  const m = withPassives(0, [{ id: 'startAp', params: { amount: 1 } }, { id: 'startStatus', params: { status: 'shell', turns: 3 } }], { ambush: 'party' });
  assert.equal(m.get('p0').ap, 1 + 1 + 1);
  assert.deepEqual(m.get('p0').statuses.map((s) => [s.id, s.turns]), [['shell', 3]]);
  assert.ok(m.startEvents.some((e) => e.type === 'status' && e.targetId === 'p0' && e.status === 'shell'));
  assert.ok(m.startEvents.some((e) => e.type === 'ap' && e.targetId === 'p0' && e.apAfter === 3));
});

test('parryAp, parryHeal and perfectDodgeAp', () => {
  const m = withPassives(0, [
    { id: 'parryAp', params: { amount: 1 } }, { id: 'parryHeal', params: { pct: 0.04 } }, { id: 'perfectDodgeAp', params: { amount: 1 } },
  ]);
  const g = m.get('p0');
  g.hp = 300;
  let plan = enemyPlan(m, 'sting', ['p0']);
  const ev = m.resolveEnemyHit(plan, 0, 'parry');
  assert.equal(g.ap, 1 + 1 + 1);
  assert.deepEqual(types(ev, 'heal'), [{ type: 'heal', targetId: 'p0', amount: 17, hpAfter: 317 }]);
  plan = enemyPlan(m, 'sting', ['p0']);
  m.resolveEnemyHit(plan, 0, 'perfectDodge');
  assert.equal(g.ap, 4);
  plan = enemyPlan(m, 'sting', ['p0']);
  m.resolveEnemyHit(plan, 0, 'dodge');
  assert.equal(g.ap, 4, 'a plain dodge grants no AP');
});

test('counterPower multiplies counterattack damage', () => {
  const m = withPassives(0, [{ id: 'counterPower', params: { mult: 1.5 } }]);
  const { counters } = runEnemyAction(m, 'e0', 'parry', enemyPlan(m, 'sting', ['p0']));
  assert.equal(dmg(counters[0].events, 'e0')[0], Math.round(1.5 * 34 * MIT(10) * 1.5));
});

test('basicStatus: basic attacks may inflict a status', () => {
  const pass = [{ id: 'basicStatus', params: { status: 'burn', turns: 2, chance: 0.5 } }];
  let m = withPassives(0, pass, { rng: new ConstRng(0.4) });
  forceTurn(m, 'p0');
  let r = runPartyAction(m, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.deepEqual(types(r.events, 'status'), [{ type: 'status', targetId: 'e0', status: 'burn', turns: 2 }]);
  m = withPassives(0, pass, { rng: new ConstRng(0.6) });
  forceTurn(m, 'p0');
  r = runPartyAction(m, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(types(r.events, 'status').length, 0);
  m = withPassives(0, pass, { rng: new ConstRng(0.4) });
  forceTurn(m, 'p0');
  m.get('p0').ap = 5;
  r = runPartyAction(m, 'p0', { kind: 'skill', id: 'rivets', targetIds: ['e0'] });
  assert.equal(types(r.events, 'status').length, 0, 'skills do not trigger basicStatus');
});

test('lowHpPower boosts damage only below the threshold', () => {
  const m = withPassives(0, [{ id: 'lowHpPower', params: { threshold: 0.35, mult: 1.35 } }]);
  forceTurn(m, 'p0');
  m.get('p0').hp = 100;
  const r = runPartyAction(m, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.deepEqual(dmg(r.events, 'e0'), [Math.round(0.5 * 34 * MIT(10) * 1.35), Math.round(0.5 * 34 * MIT(10) * 1.35)]);
  forceTurn(m, 'p0');
  m.get('p0').hp = 400;
  const r2 = runPartyAction(m, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(dmg(r2.events, 'e0')[0], Math.round(0.5 * 34 * MIT(10)));
});

test('secondWind: once per battle a lethal hit leaves 1 HP', () => {
  const m = withPassives(1, [{ id: 'secondWind', params: {} }]);
  const nyra = m.get('p1');
  nyra.hp = 5;
  let ev = m.resolveEnemyHit(enemyPlan(m, 'sting', ['p1']), 0, 'hit');
  assert.equal(nyra.hp, 1);
  assert.equal(nyra.alive, true);
  assert.ok(ev.some((e) => e.type === 'text' && /Second Wind/.test(e.text)));
  ev = m.resolveEnemyHit(enemyPlan(m, 'sting', ['p1']), 0, 'hit');
  assert.equal(nyra.alive, false);
  assert.ok(types(ev, 'ko').some((e) => e.targetId === 'p1'));
});

test('turnHeal heals at the start of own turn', () => {
  const m = withPassives(0, [{ id: 'turnHeal', params: { pct: 0.05 } }]);
  const g = m.get('p0');
  g.hp = 100;
  g.initiative = 100;
  const t = m.nextTurn();
  assert.equal(t.actorId, 'p0');
  assert.deepEqual(types(t.events, 'heal'), [{ type: 'heal', targetId: 'p0', amount: 21, hpAfter: 121 }]);
});

test('critVsBroken and critDamage', () => {
  let m = withPassives(2, [{ id: 'critVsBroken', params: { bonus: 0.35 } }], { rng: new ConstRng(0.3) });
  forceTurn(m, 'p2');
  let r = runPartyAction(m, 'p2', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(types(r.events, 'damage')[0].crit, false);
  m.get('e0').broken = true;
  forceTurn(m, 'p2');
  r = runPartyAction(m, 'p2', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(types(r.events, 'damage')[0].crit, true);
  m = withPassives(2, [{ id: 'critDamage', params: { bonus: 0.3 } }]);
  forceTurn(m, 'p2');
  r = runPartyAction(m, 'p2', { kind: 'shot', targetIds: ['e0'], weakPointId: 'core' });
  assert.deepEqual(dmg(r.events, 'e0'), [Math.round(0.6 * 36 * MIT(10) * 2.3)]);
});

test('breakPower multiplies break dealt', () => {
  const m = withPassives(0, [{ id: 'breakPower', params: { mult: 1.4 } }]);
  forceTurn(m, 'p0');
  runPartyAction(m, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(m.get('e0').breakValue, 14);
});

test('shotPower and shotMark', () => {
  const m = withPassives(2, [{ id: 'shotPower', params: { mult: 1.5 } }, { id: 'shotMark', params: { chance: 0.6 } }]);
  forceTurn(m, 'p2');
  const r = runPartyAction(m, 'p2', { kind: 'shot', targetIds: ['e0'] });
  assert.deepEqual(dmg(r.events, 'e0'), [Math.round(0.6 * 36 * MIT(10) * 1.5)]);
  assert.deepEqual(types(r.events, 'status'), [{ type: 'status', targetId: 'e0', status: 'mark', turns: 3 }]);
});

test('firstStrike: only the first damaging hit of the battle (shield blocks do not use it)', () => {
  const m = withPassives(2, [{ id: 'firstStrike', params: { mult: 1.6 } }], { enemies: ['shellguard', 'driftling'] });
  forceTurn(m, 'p2');
  let r = runPartyAction(m, 'p2', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(types(r.events, 'blocked').length, 2);
  forceTurn(m, 'p2');
  r = runPartyAction(m, 'p2', { kind: 'attack', targetIds: ['e1'] });
  const base = 0.5 * 36 * MIT(10);
  assert.deepEqual(dmg(r.events, 'e1'), [Math.round(base * 1.6), Math.round(base)]);
});

test('gradientGain scales gradient from that character\'s actions', () => {
  const m = withPassives(0, [{ id: 'gradientGain', params: { mult: 1.3 } }]);
  forceTurn(m, 'p0');
  runPartyAction(m, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(m.gradient, 3 + 3, 'round(2 × 1.3) per hit');
  m.resolveEnemyHit(enemyPlan(m, 'sting', ['p0']), 0, 'parry');
  assert.equal(m.gradient, 6 + 10);
  m.resolveEnemyHit(enemyPlan(m, 'sting', ['p1']), 0, 'parry');
  assert.equal(m.gradient, 16 + 8, 'other members gain normally');
});

test('glassCannon: dealt and taken multipliers', () => {
  const m = withPassives(0, [{ id: 'glassCannon', params: { dealt: 1.3, taken: 1.3 } }]);
  forceTurn(m, 'p0');
  const r = runPartyAction(m, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(dmg(r.events, 'e0')[0], Math.round(0.5 * 34 * MIT(10) * 1.3));
  const ev = m.resolveEnemyHit(enemyPlan(m, 'sting', ['p0']), 0, 'hit');
  assert.equal(dmg(ev, 'p0')[0], Math.round(0.9 * 30 * MIT(22) * 1.3));
});

test('elementPower boosts only its element', () => {
  const m = withPassives(1, [{ id: 'elementPower', params: { element: 'fire', mult: 1.3 } }]);
  forceTurn(m, 'p1');
  let r = runPartyAction(m, 'p1', { kind: 'skill', id: 'ember', targetIds: ['e0'] });
  assert.deepEqual(dmg(r.events, 'e0'), [Math.round(0.8 * 38 * MIT(10) * 0.5 * 1.3)], 'fire resisted ×0.5, boosted ×1.3');
  forceTurn(m, 'p1');
  r = runPartyAction(m, 'p1', { kind: 'attack', targetIds: ['e0'] });
  assert.deepEqual(dmg(r.events, 'e0'), [Math.round(1.0 * 38 * MIT(10))]);
});

test('killAp grants AP on a killing blow', () => {
  const m = withPassives(0, [{ id: 'killAp', params: { amount: 2 } }], { enemies: ['driftling', 'shellguard'] });
  forceTurn(m, 'p0');
  m.get('e0').hp = 5;
  const r = runPartyAction(m, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.ok(types(r.events, 'ap').some((e) => e.delta === 2));
  assert.equal(m.get('p0').ap, 1 + 2 + 1);
});

test('statusImmune blocks that status only', () => {
  const m = withPassives(1, [{ id: 'statusImmune', params: { status: 'silence' } }], { enemies: ['tidecaller'] });
  const ev = m.resolveEnemyHit(enemyPlan(m, 'hush', ['p1']), 0, 'hit');
  assert.equal(types(ev, 'status').length, 0);
  assert.ok(ev.some((e) => e.type === 'text' && e.text === 'Immune'));
  assert.deepEqual(m.get('p1').statuses, []);
});

test('perfectPower multiplies the perfect-QTE multiplier', () => {
  const m = withPassives(0, [{ id: 'perfectPower', params: { mult: 1.15 } }]);
  forceTurn(m, 'p0');
  m.get('p0').ap = 2;
  const plan = m.beginAction('p0', { kind: 'skill', id: 'rivets', targetIds: ['e0'] });
  const ev = m.resolveHit(plan, 0, 'perfect');
  assert.equal(dmg(ev, 'e0')[0], Math.round(0.65 * 34 * MIT(10) * 1.4 * 1.15));
  assert.equal(dmg(m.resolveHit(plan, 1, 'good'), 'e0')[0], Math.round(0.65 * 34 * MIT(10) * 1.15));
});

test('hurtAp: +AP when hurt, at most once per enemy action', () => {
  const m = withPassives(1, [{ id: 'hurtAp', params: { amount: 1 } }]);
  const nyra = m.get('p1');
  runEnemyAction(m, 'e0', 'hit', enemyPlan(m, 'lash', ['p1']));
  assert.equal(nyra.ap, 2, 'two hits, one AP');
  runEnemyAction(m, 'e0', 'hit', enemyPlan(m, 'sting', ['p1']));
  assert.equal(nyra.ap, 3);
  runEnemyAction(m, 'e0', 'dodge', enemyPlan(m, 'sting', ['p1']));
  assert.equal(nyra.ap, 3);
});

test('healPower multiplies heals performed (skills and items)', () => {
  const m = withPassives(1, [{ id: 'healPower', params: { mult: 1.35 } }]);
  const g = m.get('p0');
  g.hp = 100;
  forceTurn(m, 'p1');
  m.get('p1').ap = 2;
  runPartyAction(m, 'p1', { kind: 'skill', id: 'mend', targetIds: ['p0'] });
  assert.equal(g.hp, 100 + Math.round(0.3 * 420 * 1.35));
  g.hp = 100;
  forceTurn(m, 'p1');
  runPartyAction(m, 'p1', { kind: 'item', id: 'tincture', targetIds: ['p0'] });
  assert.equal(g.hp, 100 + Math.round(0.45 * 420 * 1.35));
});
