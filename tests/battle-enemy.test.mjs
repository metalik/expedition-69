// Tests for the enemy side of BattleModel and src/battle/ai.js: plans (hit lists, targets), weighted AI with
// cooldowns / conditions, boss phases, every defensive outcome, gradient ripostes, counterattack eligibility,
// AoE resolution and post-action effects (shields, heals, buffs, dispel).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEnemyAction, availableAttacks, conditionMet, phasePool, weightedPick, attackOnCooldown } from '../src/battle/ai.js';
import { createFixtureModel, createFixtureData, forceTurn, runEnemyAction, runPartyAction, FixtureRng, ConstRng } from '../tools/simulate.mjs';

const MIT = (def) => 100 / (100 + def);
const types = (events, type) => events.filter((e) => e.type === type);

/** Plans `attackId` for an enemy on its (forced) turn, optionally overriding every hit's targets. */
function planWith(model, enemyId, attackId, targetIds = null) {
  const e = model.get(enemyId);
  e.pool = [attackId];
  e.phases = e.phaseIndex > 0 ? e.phases : [];
  forceTurn(model, enemyId);
  const plan = model.planEnemyAction(enemyId);
  assert.equal(plan.attackId, attackId);
  if (targetIds) {
    for (const h of plan.hits) h.targetIds = [...targetIds];
    plan.targetIds = [...targetIds];
  }
  return plan;
}

test('planEnemyAction copies the hit list with defaults and plan-time targets', () => {
  const { model } = createFixtureModel();
  const plan = planWith(model, 'e0', 'sting');
  assert.deepEqual(plan.hits, [{ index: 0, t: 900, type: 'normal', power: 0.9, element: 'physical', anim: 'thrust', windup: 350, targetIds: ['p1'], status: null }]);
  assert.deepEqual([plan.name, plan.anim, plan.approach, plan.duration], ['Lantern Sting', 'thrust', 'melee', 1400]);
  assert.deepEqual(plan.targetIds, ['p1']);
  assert.deepEqual(plan.events, []);
  assert.ok(model.log.at(-1).includes('Lantern Sting'));
});

test('hits are sorted by t; non-damaging actions have hits: [] and effects', () => {
  const { model } = createFixtureModel({
    enemies: ['shellguard'],
    tweak: (_, d) => {
      d.ENEMIES.shellguard.attacks.scramble = {
        id: 'scramble', name: 'Scramble', target: 'single', approach: 'melee', weight: 1, duration: 2000,
        hits: [{ t: 1400, type: 'normal', power: 0.5, anim: 'slash' }, { t: 900, type: 'jump', power: 0.4, anim: 'wave', windup: 500 }],
      };
    },
  });
  const p = planWith(model, 'e0', 'scramble');
  assert.deepEqual(p.hits.map((h) => [h.index, h.t, h.type, h.windup]), [[0, 900, 'jump', 500], [1, 1400, 'normal', 350]]);
  model.get('e0').shields = 0;
  const harden = planWith(model, 'e0', 'harden');
  assert.deepEqual(harden.hits, []);
  assert.deepEqual([harden.anim, harden.approach], ['cast', 'stay']);
  assert.deepEqual(harden.effects, [{ type: 'shield', amount: 2, target: 'self' }]);
});

test('targets: single → one member for all hits, all → every living member, multi → one per hit', () => {
  const { model } = createFixtureModel({ enemies: ['driftling', 'warden'], rng: new FixtureRng(21) });
  const lash = planWith(model, 'e0', 'lash');
  assert.equal(new Set(lash.hits.map((h) => h.targetIds[0])).size, 1);
  model.get('p1').alive = false;
  model.get('p1').hp = 0;
  const pulse = planWith(model, 'e0', 'pulse');
  assert.deepEqual(pulse.hits[0].targetIds, ['p0', 'p2'], 'KO\'d members are not targeted');
  model.get('p1').alive = true;
  model.get('p1').hp = 10;
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const chain = planWith(model, 'e1', 'chain');
    assert.ok(chain.hits.every((h) => h.targetIds.length === 1));
    assert.deepEqual([...new Set(chain.hits.map((h) => h.targetIds[0]))].sort(), [...chain.targetIds].sort());
    chain.hits.forEach((h) => seen.add(h.targetIds[0]));
  }
  assert.equal(seen.size, 3, 'multi spreads hits across members');
});

test('AI: weighted random choice follows attack weights', () => {
  const { model } = createFixtureModel();
  const rng = new FixtureRng(123);
  const counts = { sting: 0, lash: 0, pulse: 0 };
  for (let i = 0; i < 6000; i++) counts[chooseEnemyAction(model, model.get('e0'), rng).attackId]++;
  assert.ok(Math.abs(counts.sting / 6000 - 3 / 6) < 0.03, JSON.stringify(counts));
  assert.ok(Math.abs(counts.lash / 6000 - 2 / 6) < 0.03);
  assert.ok(Math.abs(counts.pulse / 6000 - 1 / 6) < 0.03);
  assert.equal(weightedPick(['a', 'b'], (x) => (x === 'b' ? 1 : 0), new ConstRng(0.01)), 'b');
});

test('AI: cooldown N blocks the attack for the next N own turns', () => {
  const { model, data } = createFixtureModel();
  const e = model.get('e0');
  e.attacks.pulse.weight = 1000;
  const seq = [];
  for (let i = 0; i < 6; i++) {
    forceTurn(model, 'e0');
    e.turnsTaken += 1;
    seq.push(model.planEnemyAction('e0').attackId);
  }
  assert.deepEqual(seq.filter((_, i) => i % 2 === 0), ['pulse', 'pulse', 'pulse']);
  assert.ok(seq.filter((_, i) => i % 2 === 1).every((a) => a !== 'pulse'));
  assert.equal(attackOnCooldown(e, 'pulse'), true);
  assert.ok(data.ENEMIES.driftling.attacks.pulse.cooldown === 1);
});

test('AI conditions: shieldsBelow, allyHpBelow (self included), selfHpBelow, notStatus', () => {
  const { model } = createFixtureModel({ enemies: ['shellguard', 'tidecaller', 'driftling'] });
  const sg = model.get('e0');
  assert.ok(!availableAttacks(model, sg).includes('harden'), 'shields 2 ≥ 1');
  sg.shields = 0;
  assert.ok(availableAttacks(model, sg).includes('harden'));
  const tc = model.get('e1');
  assert.ok(!availableAttacks(model, tc).includes('mend_tide'));
  model.get('e2').hp = 50;
  assert.ok(availableAttacks(model, tc).includes('mend_tide'));
  model.get('e2').hp = 180;
  tc.hp = 100;
  assert.ok(availableAttacks(model, tc).includes('mend_tide'), 'the caster itself counts as an ally');
  assert.equal(conditionMet(model, tc, { selfHpBelow: 0.5 }), true);
  assert.equal(conditionMet(model, tc, { selfHpBelow: 0.3 }), false);
  assert.equal(conditionMet(model, tc, { notStatus: 'powerful' }), true);
  tc.statuses.push({ id: 'powerful', turns: 2 });
  assert.equal(conditionMet(model, tc, { notStatus: 'powerful' }), false);
  assert.equal(conditionMet(model, tc, { selfHpBelow: 0.5, notStatus: 'haste' }), true, 'all keys must hold');
});

test('AI: silenced enemies avoid spell-like actions', () => {
  const { model } = createFixtureModel({ enemies: ['tidecaller'] });
  const tc = model.get('e0');
  tc.hp = 10;
  tc.statuses.push({ id: 'silence', turns: 2 });
  const ids = availableAttacks(model, tc);
  assert.ok(!ids.includes('mend_tide') && !ids.includes('hex'));
  assert.ok(ids.includes('tidal_bolt'));
});

test('boss phases: hp threshold → phase event, statMult, new pool, phase effects', () => {
  const { model } = createFixtureModel({ enemies: ['warden'], level: 5 });
  const w = model.get('e0');
  assert.deepEqual(phasePool(w), ['anchor', 'sweep', 'rolls', 'combo', 'ballast']);
  w.shields = 0;
  w.hp = Math.floor(w.stats.maxHp * 0.4);
  forceTurn(model, 'e0');
  const plan = model.planEnemyAction('e0');
  const phase = types(plan.events, 'phase');
  assert.equal(phase.length, 1);
  assert.deepEqual([phase[0].targetId, phase[0].phaseIndex], ['e0', 1]);
  assert.match(phase[0].text, /crimson/);
  assert.equal(w.phaseIndex, 1);
  assert.ok(Math.abs(w.stats.spd - 48 * 1.2) < 1e-9);
  assert.ok(Math.abs(w.stats.atk - 92 * 1.1) < 1e-9);
  assert.deepEqual(types(plan.events, 'shield'), [{ type: 'shield', targetId: 'e0', delta: 2, shieldsAfter: 2 }]);
  assert.ok(types(plan.events, 'status').some((e) => e.status === 'powerful'));
  assert.deepEqual(phasePool(w), ['anchor', 'sweep', 'gloam', 'chain', 'combo', 'ballast']);
  assert.ok(['anchor', 'sweep', 'gloam', 'chain', 'combo', 'ballast'].includes(plan.attackId));
  assert.deepEqual(model.planEnemyAction('e0').events.filter((e) => e.type === 'phase'), [], 'a phase triggers once');
});

test('a phase change triggers right after the party action that crosses the threshold', () => {
  const { model } = createFixtureModel({ enemies: ['warden'], level: 5 });
  const w = model.get('e0');
  w.shields = 0;
  w.hp = Math.floor(w.stats.maxHp * 0.5) + 5;
  forceTurn(model, 'p0');
  const { events } = runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(types(events, 'phase').length, 1);
  assert.ok(events.findIndex((e) => e.type === 'phase') > events.findIndex((e) => e.type === 'damage'));
});

test('outcome hit: damage, surge +1 for Gideon, hit status, stats', () => {
  const { model } = createFixtureModel({ enemies: ['driftling', 'tidecaller'] });
  const plan = planWith(model, 'e0', 'sting', ['p0']);
  const ev = model.resolveEnemyHit(plan, 0, 'hit');
  const amount = Math.round(0.9 * 30 * MIT(22));
  assert.deepEqual(types(ev, 'damage')[0], {
    type: 'damage', targetId: 'p0', sourceId: 'e0', amount, crit: false, element: 'physical', affinity: null, hpAfter: 420 - amount, hitIndex: 0, kind: 'enemy',
  });
  assert.deepEqual(types(ev, 'mechanic')[0].mechanic, { type: 'surge', value: 1 });
  assert.equal(model.stats.hitsTaken, 1);
  model.finishEnemyAction(plan);
  const hush = planWith(model, 'e1', 'hush', ['p1']);
  const ev2 = model.resolveEnemyHit(hush, 0, 'hit');
  assert.deepEqual(types(ev2, 'status'), [{ type: 'status', targetId: 'p1', status: 'silence', turns: 2 }]);
  model.finishEnemyAction(hush);
  const bolt = planWith(model, 'e1', 'tidal_bolt', ['p1']);
  assert.equal(types(model.resolveEnemyHit(bolt, 0, 'hit'), 'status').length, 0, 'chance 0.5 vs roll 0.5 fails');
  assert.equal(types(model.resolveEnemyHit(bolt, 0, 'hit'), 'damage').length, 0, 'a hit resolves once');
});

test('difficulty dmgTakenMult scales damage to the party', () => {
  const vet = createFixtureModel({ difficulty: 'veteran' }).model;
  const story = createFixtureModel({ difficulty: 'story' }).model;
  const base = 0.9 * 30 * MIT(22);
  const hitWith = (m) => types(m.resolveEnemyHit(planWith(m, 'e0', 'sting', ['p0']), 0, 'hit'), 'damage')[0].amount;
  assert.equal(hitWith(vet), Math.round(base * 1.3));
  assert.equal(hitWith(story), Math.round(base * 0.6));
});

test('difficulty boss levers: bosses act faster (bossSpdMult) and hit harder (bossDmgMult); regular enemies do not', () => {
  const data = createFixtureData();
  const exp = createFixtureModel({ enemies: ['warden', 'driftling'], data }).model;
  const vet = createFixtureModel({ enemies: ['warden', 'driftling'], difficulty: 'veteran', data }).model;
  const V = data.DIFFICULTY.veteran;
  assert.equal(vet.get('e0').stats.spd, exp.get('e0').stats.spd * V.bossSpdMult);
  assert.equal(vet.get('e0').baseStats.spd, vet.get('e0').stats.spd, 'phase speed multipliers build on the boosted speed');
  assert.equal(vet.get('e1').stats.spd, exp.get('e1').stats.spd, 'regular enemies keep their speed');
  const hitWith = (m, id, attackId) => types(m.resolveEnemyHit(planWith(m, id, attackId, ['p0']), 0, 'hit'), 'damage')[0].amount;
  const bossRatio = hitWith(vet, 'e0', 'anchor') / hitWith(exp, 'e0', 'anchor');
  assert.ok(Math.abs(bossRatio - V.dmgTakenMult * V.bossDmgMult) < 0.01, `boss hits ×${bossRatio.toFixed(3)}`);
  const regularRatio = hitWith(vet, 'e1', 'sting') / hitWith(exp, 'e1', 'sting');
  assert.ok(Math.abs(regularRatio - V.dmgTakenMult) < 0.02, `regular hits ×${regularRatio.toFixed(3)}`);
});

test('outcome parry: +1 AP, gradient +8, surge +1; guard stance gives +1 more AP', () => {
  const { model } = createFixtureModel();
  const plan = planWith(model, 'e0', 'sting', ['p0']);
  const ev = model.resolveEnemyHit(plan, 0, 'parry');
  assert.deepEqual(types(ev, 'defend'), [{ type: 'defend', targetId: 'p0', outcome: 'parry' }]);
  assert.deepEqual(types(ev, 'ap'), [{ type: 'ap', targetId: 'p0', delta: 1, apAfter: 2 }]);
  assert.equal(model.gradient, 8);
  assert.equal(model.get('p0').mechanic.value, 1);
  assert.equal(model.get('p0').hp, 420);
  assert.equal(model.stats.parries, 1);
  model.finishEnemyAction(plan);
  model.get('p2').mechanic.value = 'guard';
  const p2 = planWith(model, 'e0', 'sting', ['p2']);
  model.resolveEnemyHit(p2, 0, 'parry');
  assert.equal(model.get('p2').ap, 3);
});

test('outcomes dodge (+2), perfectDodge (+4), jump (+6); invalid outcomes count as hit', () => {
  const { model } = createFixtureModel({ enemies: ['driftling', 'shellguard'] });
  let plan = planWith(model, 'e0', 'sting', ['p1']);
  model.resolveEnemyHit(plan, 0, 'dodge');
  assert.equal(model.gradient, 2);
  plan = planWith(model, 'e0', 'sting', ['p1']);
  model.resolveEnemyHit(plan, 0, 'perfectDodge');
  assert.equal(model.gradient, 6);
  plan = planWith(model, 'e0', 'pulse');
  const jump = model.resolveEnemyHit(plan, 0, 'jump');
  assert.equal(types(jump, 'defend').length, 3, 'AoE: one outcome for every target');
  assert.equal(model.gradient, 12, 'gradient once per hit');
  assert.deepEqual([model.stats.dodges, model.stats.perfectDodges, model.stats.jumps], [1, 1, 1]);
  plan = planWith(model, 'e0', 'sting', ['p1']);
  assert.equal(types(model.resolveEnemyHit(plan, 0, 'jump'), 'damage').length, 1, 'jump on a normal hit fails');
  const crush = planWith(model, 'e1', 'crush', ['p0']);
  const ev = model.resolveEnemyHit(crush, 0, 'parry');
  assert.equal(types(ev, 'damage').length, 1, 'parry on an unparryable hit fails');
  assert.deepEqual(types(ev, 'status'), [{ type: 'status', targetId: 'p0', status: 'defenseless', turns: 2 }]);
  plan = planWith(model, 'e0', 'pulse');
  assert.equal(types(model.resolveEnemyHit(plan, 0, 'hit'), 'damage').length, 3);
});

test('feints are no-ops; dead targets are no-ops', () => {
  const { model } = createFixtureModel({ enemies: ['shellguard'] });
  const plan = planWith(model, 'e0', 'feint_snap', ['p0']);
  assert.deepEqual(model.resolveEnemyHit(plan, 0, 'parry'), []);
  assert.equal(plan.outcomes[0], 'feint');
  assert.equal(model.get('p0').ap, 1);
  model.get('p0').alive = false;
  model.get('p0').hp = 0;
  assert.deepEqual(model.resolveEnemyHit(plan, 1, 'hit'), []);
});

test('gradient counter: +20 gradient and an immediate dark riposte on the attacker', () => {
  const { model } = createFixtureModel({ enemies: ['warden'], level: 1 });
  const w = model.get('e0');
  w.shields = 0;
  const plan = planWith(model, 'e0', 'gloam', ['p0']);
  const ev = model.resolveEnemyHit(plan, 0, 'gradient');
  assert.deepEqual(types(ev, 'defend'), [{ type: 'defend', targetId: 'p0', outcome: 'gradient' }]);
  const rip = types(ev, 'damage')[0];
  assert.deepEqual([rip.sourceId, rip.targetId, rip.element, rip.riposte], ['p0', 'e0', 'dark', true]);
  assert.equal(rip.amount, Math.round(0.8 * 34 * MIT(30)));
  assert.equal(model.gradient, 20);
  assert.equal(w.breakValue, 8);
  assert.equal(model.stats.gradientCounters, 1);
  const dodged = planWith(model, 'e0', 'gloam', ['p0']);
  const ev2 = model.resolveEnemyHit(dodged, 0, 'dodge');
  assert.equal(types(ev2, 'damage').length, 0, 'dodging a gradient hit avoids it without a riposte');
  const parried = planWith(model, 'e0', 'gloam', ['p0']);
  assert.equal(types(model.resolveEnemyHit(parried, 0, 'parry'), 'damage')[0].targetId, 'p0', 'parry fails on gradient hits');
});

test('counterattack when every non-feint hit on a member was perfectly defended', () => {
  const { model } = createFixtureModel();
  let r = runEnemyAction(model, 'e0', 'parry', planWith(model, 'e0', 'sting', ['p1']));
  assert.equal(r.counters.length, 1);
  const c = r.counters[0];
  assert.deepEqual([c.counterId, c.targetId], ['p1', 'e0']);
  assert.deepEqual(c.events[0], { type: 'counter', sourceId: 'p1', targetId: 'e0' });
  assert.equal(types(c.events, 'damage')[0].amount, Math.round(1.5 * 38 * MIT(10)));
  assert.equal(model.get('e0').breakValue, 15);
  assert.equal(model.gradient, 8 + 5);
  assert.equal(model.stats.counters, 1);
  assert.deepEqual(model.resolveCounters(r.plan), [], 'counters resolve once');
  model.get('e0').hp = 180;
  r = runEnemyAction(model, 'e0', ['parry', 'dodge'], planWith(model, 'e0', 'lash', ['p1']));
  assert.equal(r.counters.length, 0, 'a dodge breaks the chain');
  r = runEnemyAction(model, 'e0', ['parry', 'parry'], planWith(model, 'e0', 'lash', ['p1']));
  assert.equal(r.counters.length, 1);
  r = runEnemyAction(model, 'e0', 'jump', planWith(model, 'e0', 'pulse'));
  assert.deepEqual(r.counters.map((x) => x.counterId), ['p0', 'p1', 'p2'], 'AoE jumped by everyone → everyone counters');
});

test('counters: unparryable hits make it impossible, feints are ignored, multi is per target', () => {
  const { model } = createFixtureModel({ enemies: ['shellguard', 'warden'] });
  let r = runEnemyAction(model, 'e0', 'dodge', planWith(model, 'e0', 'crush', ['p0']));
  assert.equal(r.counters.length, 0);
  r = runEnemyAction(model, 'e0', ['hit', 'parry'], planWith(model, 'e0', 'feint_snap', ['p0']));
  assert.equal(r.counters.length, 1, 'feint ignored, the real hit was parried');
  model.get('e1').shields = 0;
  const chain = planWith(model, 'e1', 'chain');
  chain.hits[0].targetIds = ['p0'];
  chain.hits[1].targetIds = ['p1'];
  chain.hits[2].targetIds = ['p0'];
  assert.deepEqual(model.counterEligible(chain), []);
  r = runEnemyAction(model, 'e1', ['parry', 'hit', 'parry'], chain);
  assert.deepEqual(r.counters.map((x) => x.counterId), ['p0']);
  r = runEnemyAction(model, 'e1', ['jump', 'jump', 'hit'], planWith(model, 'e1', 'rolls', ['p2']));
  assert.equal(r.counters.length, 0);
});

test('no counters or effects once the attacker is dead (e.g. killed by a riposte)', () => {
  const { model } = createFixtureModel({ enemies: ['warden'] });
  const w = model.get('e0');
  w.shields = 0;
  w.hp = 5;
  const plan = planWith(model, 'e0', 'gloam', ['p0']);
  const ev = model.resolveEnemyHit(plan, 0, 'gradient');
  assert.ok(types(ev, 'ko').some((e) => e.targetId === 'e0'));
  assert.deepEqual(model.resolveCounters(plan), []);
  assert.deepEqual(model.finishEnemyAction(plan), []);
  assert.equal(model.outcome(), 'victory');
});

test('finishEnemyAction: shield restore (capped), ally heals + regen, debuff and dispel the party', () => {
  const { model } = createFixtureModel({ enemies: ['shellguard', 'tidecaller', 'driftling'] });
  const sg = model.get('e0');
  sg.shields = 0;
  let r = runEnemyAction(model, 'e0', 'hit', planWith(model, 'e0', 'harden'));
  assert.deepEqual(types(r.events, 'shield'), [{ type: 'shield', targetId: 'e0', delta: 2, shieldsAfter: 2 }]);
  sg.shields = 1;
  r = runEnemyAction(model, 'e0', 'hit', planWith(model, 'e0', 'harden'));
  assert.equal(sg.shields, 2, 'restores up to the starting shields');
  model.get('e2').hp = 50;
  r = runEnemyAction(model, 'e1', 'hit', planWith(model, 'e1', 'mend_tide'));
  assert.deepEqual(types(r.events, 'heal').find((e) => e.targetId === 'e2'), { type: 'heal', targetId: 'e2', amount: 45, hpAfter: 95 });
  assert.ok(model.get('e1').statuses.some((s) => s.id === 'regen' && s.fresh), 'own-turn buff is fresh');
  assert.ok(model.get('e2').statuses.some((s) => s.id === 'regen' && !s.fresh));
  model.get('p0').statuses.push({ id: 'haste', turns: 3 });
  r = runEnemyAction(model, 'e1', 'hit', planWith(model, 'e1', 'hex'));
  assert.deepEqual(types(r.events, 'status').map((e) => e.targetId), ['p0', 'p1', 'p2']);
  assert.deepEqual(model.get('p0').statuses.map((s) => s.id), ['weakened']);
});

test('planEnemyAction for a KO\'d enemy returns an empty plan with an error', () => {
  const { model } = createFixtureModel({ enemies: ['driftling', 'shellguard'] });
  model.get('e0').alive = false;
  const plan = model.planEnemyAction('e0');
  assert.ok(plan.error);
  assert.deepEqual(plan.hits, []);
  assert.deepEqual(model.resolveEnemyHit(plan, 0, 'hit'), []);
  assert.deepEqual(model.resolveCounters(plan), []);
});
