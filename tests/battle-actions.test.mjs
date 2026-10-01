// Tests for party actions in BattleModel: the AP economy, commands & reasons, target validation, attack /
// skill / gradient / item / shot / flee, every Effect type, skill modifiers, shields, break, weak points and
// the three character mechanics (Surge, Glyphs, Stance incl. Virtuoso).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureModel, forceTurn, runPartyAction, ConstRng, FixtureRng } from '../tools/simulate.mjs';

const MIT = (def) => 100 / (100 + def);
const types = (events, type) => events.filter((e) => e.type === type);
const dmgTo = (events, id) => types(events, 'damage').filter((e) => e.targetId === id).map((e) => e.amount);

/** Fixture model at L1 with extra skills; it is `actor`'s turn. */
function setup({ actor = 'p0', skills = {}, ...opts } = {}) {
  const { model, data } = createFixtureModel({
    ...opts,
    tweak: (party, d) => {
      for (const m of party) if (skills[m.id]) m.skills.push(...skills[m.id]);
      opts.tweakData?.(party, d);
    },
  });
  forceTurn(model, actor);
  return { model, data };
}

test('AP: start 1, attack costs 0 and grants +1, skills cost AP, max 9', () => {
  const { model } = setup();
  const g = model.get('p0');
  assert.equal(g.ap, 1);
  const cmds = model.getCommands('p0');
  const rivets = cmds.skills.find((s) => s.id === 'rivets');
  assert.deepEqual([rivets.ap, rivets.usable, rivets.reason], [2, false, 'Not enough AP']);
  assert.equal(model.beginAction('p0', { kind: 'skill', id: 'rivets', targetIds: ['e0'] }).error, 'Not enough AP.');
  const { events } = runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(g.ap, 2);
  assert.ok(types(events, 'ap').some((e) => e.delta === 1 && e.apAfter === 2));
  assert.match(model.beginAction('p0', { kind: 'attack' }).error, /already acted/);
  forceTurn(model, 'p0');
  const plan = model.beginAction('p0', { kind: 'skill', id: 'rivets', targetIds: ['e0'] });
  assert.deepEqual(plan.events.filter((e) => e.type === 'ap'), [{ type: 'ap', targetId: 'p0', delta: -2, apAfter: 0 }]);
  forceTurn(model, 'p1');
  model.get('p1').ap = 8;
  runPartyAction(model, 'p1', { kind: 'item', id: 'draught', targetIds: ['p1'] });
  assert.equal(model.get('p1').ap, 9, 'AP is capped at 9');
});

test('only the current, living party actor may act', () => {
  const { model } = setup({ actor: 'p0' });
  assert.match(model.beginAction('p1', { kind: 'attack' }).error, /not Nyra's turn/);
  assert.ok(model.beginAction('e0', { kind: 'attack' }).error);
  assert.ok(model.beginAction('p0', { kind: 'dance' }).error);
  model.get('p0').alive = false;
  assert.match(model.beginAction('p0', { kind: 'attack' }).error, /knocked out/);
});

test('basic attack: hits from basicAttack, no QTE, damage and break per hit', () => {
  const { model } = setup();
  const { plan, events } = runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(plan.kind, 'attack');
  assert.equal(plan.endsTurn, true);
  assert.deepEqual(plan.hits.map((h) => [h.power, h.qte, h.gap, h.break]), [[0.5, false, 380, 5], [0.5, false, 260, 5]]);
  const per = Math.round(0.5 * 34 * MIT(10));
  assert.deepEqual(dmgTo(events, 'e0'), [per, per]);
  assert.equal(model.get('e0').hp, 180 - 2 * per);
  assert.equal(model.get('e0').breakValue, 10);
  assert.equal(model.gradient, 4, '+2 gradient per damaging hit');
});

test('target validation and auto-targeting', () => {
  const { model } = setup({ enemies: ['driftling', 'shellguard'], skills: { nyra: ['dawn'] } });
  assert.deepEqual(model.getValidTargets('p0', { kind: 'attack' }), ['e0', 'e1']);
  assert.deepEqual(model.getValidTargets('p1', { kind: 'skill', id: 'mend' }), ['p0', 'p1', 'p2']);
  assert.deepEqual(model.getValidTargets('p1', { kind: 'skill', id: 'dawn' }), []);
  assert.deepEqual(model.getValidTargets('p1', { kind: 'item', id: 'tonic' }), []);
  model.get('p2').alive = false;
  model.get('p2').hp = 0;
  assert.deepEqual(model.getValidTargets('p1', { kind: 'skill', id: 'dawn' }), ['p2']);
  assert.deepEqual(model.getValidTargets('p0', { kind: 'gradient' }), ['e0', 'e1']);
  assert.equal(model.beginAction('p0', { kind: 'attack', targetIds: ['p1'] }).error, 'Invalid target.');
  assert.equal(model.beginAction('p0', { kind: 'attack', targetIds: ['nope'] }).error, 'Invalid target.');
  const plan = model.beginAction('p0', { kind: 'attack', targetIds: [] });
  assert.deepEqual(plan.targetIds, ['e0'], 'first valid target when none is given');
});

test('getCommands: usable flags and reasons', () => {
  const { model } = setup({ actor: 'p1', items: { tincture: { count: 0, max: 4 }, tonic: 2, draught: { count: 1, max: 2 } } });
  const c = model.getCommands('p1');
  assert.equal(c.attack.usable, true);
  assert.equal(c.freeAim.usable, true);
  assert.equal(c.flee.usable, true);
  assert.deepEqual(c.items.map((i) => [i.id, i.count, i.usable, i.reason]), [
    ['tincture', 0, false, 'None left'], ['tonic', 2, false, 'No targets'], ['draught', 1, true, null],
  ]);
  assert.deepEqual(c.gradient.map((g) => [g.id, g.usable, g.reason]), [['aurora', false, 'No Prism charges']]);
  assert.deepEqual(c.skills.map((s) => [s.id, s.usable]), [['ember', true], ['mend', false]]);
  model.get('p1').ap = 0;
  assert.equal(model.getCommands('p1').freeAim.reason, 'Not enough AP');
  assert.equal(model.getCommands('e0').attack.usable, false);
});

test('silence blocks skills and gradient but not attack, items or Free Aim', () => {
  const { model } = setup({ actor: 'p1' });
  model.gradient = 100;
  model.get('p1').ap = 5;
  model.get('p1').statuses.push({ id: 'silence', turns: 2 });
  const c = model.getCommands('p1');
  assert.ok(c.skills.every((s) => !s.usable && s.reason === 'Silenced'));
  assert.equal(c.gradient[0].reason, 'Silenced');
  assert.equal(c.attack.usable, true);
  assert.equal(c.freeAim.usable, true);
  assert.equal(c.items[0].usable, true);
  assert.match(model.beginAction('p1', { kind: 'skill', id: 'ember' }).error, /silenced/);
  assert.match(model.beginAction('p1', { kind: 'gradient' }).error, /silenced/);
});

test('flee: allowed in regular battles, never in boss / tutorial / practice battles', () => {
  const { model } = setup();
  const { events } = runPartyAction(model, 'p0', { kind: 'flee' });
  assert.ok(types(events, 'fled').length === 1);
  assert.equal(model.outcome(), 'fled');
  assert.equal(model.summary().xp, 0);
  for (const opts of [{ enemies: ['warden'] }, { boss: true }, { tutorial: true }, { practice: true }]) {
    const m = setup(opts).model;
    assert.equal(m.fleeAllowed, false);
    assert.deepEqual([m.getCommands('p0').flee.usable, m.getCommands('p0').flee.reason], [false, 'Cannot flee this battle']);
    assert.ok(m.beginAction('p0', { kind: 'flee' }).error);
  }
});

test('gradient skills: need a charge, cost 100 gradient and 0 AP, end the turn', () => {
  const { model } = setup();
  assert.equal(model.beginAction('p0', { kind: 'gradient' }).error, 'No Prism charges.');
  model.gradient = 150;
  assert.equal(model.gradientCharges(), 1);
  assert.match(model.beginAction('p0', { kind: 'skill', id: 'storm_oath' }).error, /Prism command/);
  const plan = model.beginAction('p0', { kind: 'gradient', targetIds: ['e0'] });
  assert.equal(plan.kind, 'gradient');
  assert.equal(plan.endsTurn, true);
  assert.deepEqual(plan.events.find((e) => e.type === 'gradient'), { type: 'gradient', value: 50, charges: 0, delta: -100 });
  assert.equal(model.get('p0').ap, 1);
  assert.equal(plan.hits.length, 3);
  assert.ok(plan.hits.every((h) => h.qte));
});

test('offensive QTE ratings multiply damage; perfect grants +6 gradient', () => {
  const { model } = setup();
  model.get('p0').ap = 9;
  const base = 0.65 * 34 * MIT(10);
  const plan = model.beginAction('p0', { kind: 'skill', id: 'rivets', targetIds: ['e0'] });
  const e1 = model.resolveHit(plan, 0, 'perfect');
  const e2 = model.resolveHit(plan, 1, 'good');
  const e3 = model.resolveHit(plan, 2, null);
  assert.equal(dmgTo(e1, 'e0')[0], Math.round(base * 1.4));
  assert.equal(dmgTo(e2, 'e0')[0], Math.round(base * 1.15));
  assert.equal(dmgTo(e3, 'e0')[0], Math.round(0.7 * 34 * MIT(10)), 'a QTE hit without rating counts as miss');
  assert.equal(model.gradient, 2 + 6 + 2 + 2);
  assert.deepEqual([model.stats.perfects, model.stats.goods, model.stats.misses], [1, 1, 1]);
  assert.deepEqual(model.resolveHit(plan, 0, 'perfect'), [], 'each hit resolves once');
});

test('items: tincture heals 45%, tonic revives at 50%, draught +3 AP; charges decrement', () => {
  const { model } = setup({ actor: 'p2' });
  const nyra = model.get('p1');
  nyra.hp = 100;
  let r = runPartyAction(model, 'p2', { kind: 'item', id: 'tincture', targetIds: ['p1'] });
  assert.equal(nyra.hp, 100 + Math.round(0.45 * 300));
  assert.equal(model.items.tincture.count, 3);
  assert.equal(r.plan.endsTurn, true);
  const gid = model.get('p0');
  gid.alive = false;
  gid.hp = 0;
  forceTurn(model, 'p2');
  r = runPartyAction(model, 'p2', { kind: 'item', id: 'tonic', targetIds: ['p0'] });
  assert.deepEqual(types(r.events, 'revive'), [{ type: 'revive', targetId: 'p0', hpAfter: 210 }]);
  assert.equal(gid.alive, true);
  forceTurn(model, 'p2');
  runPartyAction(model, 'p2', { kind: 'item', id: 'draught', targetIds: ['p0'] });
  assert.equal(gid.ap, 3);
  const s = model.summary();
  assert.deepEqual(s.itemsUsed, { tincture: 1, tonic: 1, draught: 1 });
  assert.equal(s.items.draught.count, 1);
  model.items.draught.count = 0;
  forceTurn(model, 'p2');
  assert.match(model.beginAction('p2', { kind: 'item', id: 'draught', targetIds: ['p2'] }).error, /No .* left/);
});

test('Free Aim: 1 AP per shot, does not end the turn, empty shots still cost AP', () => {
  const { model } = setup({ actor: 'p2' });
  const sable = model.get('p2');
  sable.ap = 3;
  let r = runPartyAction(model, 'p2', { kind: 'shot', targetIds: ['e0'] });
  assert.equal(r.plan.endsTurn, false);
  assert.equal(sable.ap, 2);
  assert.deepEqual(dmgTo(r.events, 'e0'), [Math.round(0.6 * 36 * MIT(10))]);
  assert.equal(model.get('e0').breakValue, 8);
  r = runPartyAction(model, 'p2', { kind: 'shot', targetIds: [] });
  assert.deepEqual(r.plan.targetIds, []);
  assert.equal(types(r.events, 'damage').length, 0);
  assert.equal(sable.ap, 1);
  runPartyAction(model, 'p2', { kind: 'shot', targetIds: ['e0'] });
  assert.equal(sable.ap, 0);
  assert.equal(model.beginAction('p2', { kind: 'shot', targetIds: ['e0'] }).error, 'Not enough AP.');
  assert.equal(model.stats.shots, 3);
  const after = runPartyAction(model, 'p2', { kind: 'attack', targetIds: ['e0'] });
  assert.ok(!after.plan.error, 'shooting does not use up the turn');
});

test('shots cannot crit, except the crit weak point (guaranteed, ×2)', () => {
  const { model } = setup({ actor: 'p2', rng: new ConstRng(0) });
  model.get('p2').ap = 5;
  const body = runPartyAction(model, 'p2', { kind: 'shot', targetIds: ['e0'] });
  const e = types(body.events, 'damage')[0];
  assert.equal(e.crit, false);
  assert.equal(e.amount, Math.round(0.6 * 36 * MIT(10) * 0.95));
  const core = runPartyAction(model, 'p2', { kind: 'shot', targetIds: ['e0'], weakPointId: 'core' });
  const c = types(core.events, 'damage')[0];
  assert.deepEqual([c.crit, c.weakPoint], [true, 'core']);
  assert.equal(c.amount, Math.round(0.6 * 36 * MIT(10) * 2 * 0.95));
  const bogus = model.beginAction('p2', { kind: 'shot', targetIds: ['e0'], weakPointId: 'tail' });
  assert.equal(bogus.weakPointId, null, 'unknown weak points are body shots');
});

test('weak points: break (+40 break, ×1.5) and shield (removes 2 shields, ×1.5 when bare)', () => {
  const { model } = setup({ actor: 'p2', enemies: ['tidecaller', 'shellguard'] });
  model.get('p2').ap = 9;
  const pearl = runPartyAction(model, 'p2', { kind: 'shot', targetIds: ['e0'], weakPointId: 'staff_pearl' });
  assert.deepEqual(dmgTo(pearl.events, 'e0'), [Math.round(0.6 * 36 * MIT(14) * 1.5)]);
  assert.equal(model.get('e0').breakValue, 48);
  const conch = runPartyAction(model, 'p2', { kind: 'shot', targetIds: ['e1'], weakPointId: 'conch' });
  assert.equal(types(conch.events, 'blocked').length, 1);
  assert.deepEqual(types(conch.events, 'shield'), [{ type: 'shield', targetId: 'e1', delta: -2, shieldsAfter: 0 }]);
  assert.equal(model.get('e1').hp, 320);
  const bare = runPartyAction(model, 'p2', { kind: 'shot', targetIds: ['e1'], weakPointId: 'conch' });
  assert.deepEqual(dmgTo(bare.events, 'e1'), [Math.round(0.6 * 36 * MIT(24) * 1.5)]);
});

test('shields absorb any damaging hit (1 per hit, no break, no gradient) unless ignoreShields', () => {
  const { model } = setup({ enemies: ['shellguard'], skills: { gideon: ['breach'] } });
  const sg = model.get('e0');
  const a = runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(types(a.events, 'blocked').length, 2);
  assert.deepEqual(types(a.events, 'shield').map((e) => e.shieldsAfter), [1, 0]);
  assert.equal(sg.hp, 320);
  assert.equal(sg.breakValue, 0);
  assert.equal(model.gradient, 0);
  const { model: m2 } = setup({ enemies: ['shellguard'], skills: { gideon: ['breach'] } });
  m2.get('p0').ap = 3;
  const b = runPartyAction(m2, 'p0', { kind: 'skill', id: 'breach', targetIds: ['e0'] });
  assert.deepEqual(dmgTo(b.events, 'e0'), [Math.round(1.6 * 34 * MIT(24))]);
  assert.equal(m2.get('e0').breakValue, 30, 'explicit hit.break');
  assert.deepEqual(types(b.events, 'shield'), [{ type: 'shield', targetId: 'e0', delta: -2, shieldsAfter: 0 }], 'shieldBreak effect');
});

test('break: accumulates, Broken at max applies stun(1) + defenseless(2)', () => {
  const { model } = setup({ skills: { sable: ['flurry'] }, actor: 'p2' });
  model.get('p2').ap = 9;
  const drift = model.get('e0');
  const r = runPartyAction(model, 'p2', { kind: 'skill', id: 'flurry', targetIds: ['e0'] });
  // Each 0.5 hit: round(0.5 × 10) = 5 break + perHit break effect 4.
  assert.equal(drift.breakValue, 36);
  assert.equal(types(r.events, 'break').length, 8);
  drift.breakValue = 99;
  forceTurn(model, 'p0');
  const k = runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.deepEqual(types(k.events, 'broken'), [{ type: 'broken', targetId: 'e0' }]);
  assert.deepEqual(drift.statuses.map((s) => [s.id, s.turns]), [['stun', 1], ['defenseless', 2]]);
  assert.equal(model.stats.breaks, 1);
});

test('effects: status (chance), heal pct/power, revive, ap, cleanse, dispel, gradient, glyph', () => {
  const salve = { id: 'salve', owner: 'nyra', name: 'Salve', ap: 1, target: 'ally', element: 'light', anim: 'heal', hits: [], effects: [{ type: 'heal', power: 2, target: 'target' }] };
  const { model } = setup({
    actor: 'p1', rng: new ConstRng(0.3),
    skills: { nyra: ['salve', 'dawn', 'lumen', 'unravel'], gideon: ['relay'], sable: ['quickstep'] },
    tweakData: (_, d) => { d.SKILLS.salve = salve; },
  });
  const nyra = model.get('p1');
  nyra.ap = 9;
  // Ember: burn chance 0.35 → rolled with next() = 0.3 → applied; adds a fire glyph.
  let r = runPartyAction(model, 'p1', { kind: 'skill', id: 'ember', targetIds: ['e0'] });
  assert.deepEqual(types(r.events, 'status'), [{ type: 'status', targetId: 'e0', status: 'burn', turns: 2 }]);
  assert.deepEqual(nyra.mechanic.list, ['fire']);
  const gid = model.get('p0');
  gid.hp = 100;
  forceTurn(model, 'p1');
  runPartyAction(model, 'p1', { kind: 'skill', id: 'mend', targetIds: ['p0'] });
  assert.equal(gid.hp, 100 + 126, 'heal pct 0.3 of 420');
  forceTurn(model, 'p1');
  r = runPartyAction(model, 'p1', { kind: 'skill', id: 'salve', targetIds: ['p0'] });
  assert.deepEqual(types(r.events, 'heal'), [{ type: 'heal', targetId: 'p0', amount: 38, hpAfter: 264 }]);
  gid.alive = false;
  gid.hp = 0;
  forceTurn(model, 'p1');
  r = runPartyAction(model, 'p1', { kind: 'skill', id: 'dawn', targetIds: ['p0'] });
  assert.equal(gid.hp, Math.round(0.4 * 420));
  gid.statuses.push({ id: 'burn', turns: 2 }, { id: 'haste', turns: 2 });
  forceTurn(model, 'p1');
  r = runPartyAction(model, 'p1', { kind: 'skill', id: 'lumen', targetIds: ['p0'] });
  assert.deepEqual(gid.statuses.map((s) => s.id), ['haste']);
  assert.deepEqual(types(r.events, 'statusEnd'), [{ type: 'statusEnd', targetId: 'p0', status: 'burn' }]);
  assert.deepEqual(nyra.mechanic.list, ['fire', 'light']);
  model.get('e0').statuses.push({ id: 'powerful', turns: 2 });
  forceTurn(model, 'p1');
  nyra.ap = 9;
  runPartyAction(model, 'p1', { kind: 'skill', id: 'unravel', targetIds: ['e0'] });
  assert.deepEqual(model.get('e0').statuses.map((s) => s.id), ['burn'], 'dispel strips buffs only');
  forceTurn(model, 'p0');
  gid.ap = 1;
  r = runPartyAction(model, 'p0', { kind: 'skill', id: 'relay', targetIds: ['p2'] });
  assert.equal(model.get('p2').ap, 3);
  assert.equal(gid.mechanic.value, 1);
  forceTurn(model, 'p2');
  const g0 = model.gradient;
  r = runPartyAction(model, 'p2', { kind: 'skill', id: 'quickstep' });
  assert.equal(model.gradient, g0 + 10);
  assert.deepEqual(model.get('p2').statuses.map((s) => [s.id, s.turns, s.fresh]), [['haste', 3, true]]);
});

test('status effects with chance fail when the roll is high', () => {
  const { model } = setup({ actor: 'p1', rng: new ConstRng(0.5) });
  const r = runPartyAction(model, 'p1', { kind: 'skill', id: 'ember', targetIds: ['e0'] });
  assert.equal(types(r.events, 'status').length, 0);
});

test('AoE skills hit every living enemy; the break effect applies to all targets', () => {
  const { model } = setup({ enemies: ['driftling', 'tidecaller', 'shellguard'], skills: { gideon: ['quake'] } });
  model.get('p0').ap = 3;
  const { plan, events } = runPartyAction(model, 'p0', { kind: 'skill', id: 'quake' });
  assert.deepEqual(plan.targetIds, ['e0', 'e1', 'e2']);
  assert.deepEqual(plan.hits[0].targetIds, ['e0', 'e1', 'e2']);
  assert.deepEqual(dmgTo(events, 'e0'), [Math.round(34 * MIT(10))]);
  assert.equal(types(events, 'blocked').length, 1, 'shellguard absorbs its hit');
  assert.deepEqual(model.enemies.map((e) => e.breakValue), [20, 20, 10]);
  assert.equal(model.get('p0').mechanic.value, 1, 'one AoE hit = +1 surge, not one per target');
});

test('randomEnemies: every hit picks a random living enemy at plan time; dead picks retarget', () => {
  const { model } = setup({ actor: 'p1', enemies: ['driftling', 'tidecaller'], rng: new FixtureRng(4), skills: { nyra: ['chain'] } });
  model.get('p1').ap = 9;
  const plan = model.beginAction('p1', { kind: 'skill', id: 'chain' });
  assert.equal(plan.hits.length, 3);
  assert.ok(plan.hits.every((h) => h.targetIds.length === 1 && ['e0', 'e1'].includes(h.targetIds[0])));
  assert.deepEqual([...new Set(plan.hits.flatMap((h) => h.targetIds))].sort(), [...plan.targetIds].sort());
  const victim = model.get(plan.hits[1].targetIds[0]);
  victim.alive = false;
  victim.hp = 0;
  const ev = model.resolveHit(plan, 1, 'good');
  const other = victim.id === 'e0' ? 'e1' : 'e0';
  assert.deepEqual(plan.hits[1].targetIds, [other]);
  assert.equal(types(ev, 'damage')[0].targetId, other);
});

test('surge: +1 per landed hit, consume multiplies power by 1 + 0.2 × surge then resets, max 10', () => {
  const { model } = setup();
  const g = model.get('p0');
  g.ap = 9;
  g.mechanic.value = 5;
  const plan = model.beginAction('p0', { kind: 'skill', id: 'discharge', targetIds: ['e0'] });
  assert.equal(plan.hits[0].power, 1.7 * 2);
  assert.equal(plan.surgeConsumed, 5);
  assert.deepEqual(plan.events.find((e) => e.type === 'mechanic'), { type: 'mechanic', targetId: 'p0', mechanic: { type: 'surge', value: 0 } });
  const ev = model.resolveHit(plan, 0, 'miss');
  assert.deepEqual(dmgTo(ev, 'e0'), [Math.round(3.4 * 34 * MIT(10) * 1.5)]);
  assert.equal(g.mechanic.value, 1);
  model.finishAction(plan);
  forceTurn(model, 'p0');
  g.mechanic.value = 8;
  model.get('e0').hp = 999;
  runPartyAction(model, 'p0', { kind: 'skill', id: 'rivets', targetIds: ['e0'] });
  assert.equal(g.mechanic.value, 10, 'capped at 10');
});

test('glyphs: FIFO max 4, consumeGlyph takes the first match, consumeAllGlyphs adds extra hits', () => {
  const { model } = setup({ actor: 'p1', skills: { nyra: ['frost', 'codex'] } });
  const nyra = model.get('p1');
  nyra.ap = 9;
  model.get('e0').hp = 5000;
  model.get('e0').stats.maxHp = 5000;
  for (let i = 0; i < 5; i++) {
    forceTurn(model, 'p1');
    runPartyAction(model, 'p1', { kind: 'skill', id: 'ember', targetIds: ['e0'] });
  }
  assert.deepEqual(nyra.mechanic.list, ['fire', 'fire', 'fire', 'fire']);
  nyra.mechanic.list = ['ice', 'fire', 'fire'];
  forceTurn(model, 'p1');
  const frost = model.beginAction('p1', { kind: 'skill', id: 'frost', targetIds: ['e0'] });
  assert.equal(frost.glyphConsumed, 'fire');
  assert.ok(frost.hits.every((h) => Math.abs(h.power - 1.05) < 1e-9));
  frost.hits.forEach((_, i) => model.resolveHit(frost, i, null));
  const fin = model.finishAction(frost);
  assert.deepEqual(types(fin, 'status').map((e) => e.status), ['chill', 'defenseless']);
  assert.deepEqual(nyra.mechanic.list, ['ice', 'fire', 'ice']);
  forceTurn(model, 'p1');
  nyra.mechanic.list = ['ice', 'ice'];
  const noFire = model.beginAction('p1', { kind: 'skill', id: 'frost', targetIds: ['e0'] });
  assert.equal(noFire.glyphConsumed, null);
  assert.equal(noFire.hits[0].power, 0.7);
  model.finishAction(noFire);
  forceTurn(model, 'p1');
  nyra.mechanic.list = ['fire', 'ice', 'storm', 'light'];
  nyra.ap = 9;
  const codex = model.beginAction('p1', { kind: 'skill', id: 'codex', targetIds: ['e0'] });
  assert.equal(codex.hits.length, 5);
  assert.deepEqual(codex.hits.slice(1).map((h) => [h.element, h.power, h.qte, h.glyph]), [
    ['fire', 1.1, true, 'fire'], ['ice', 1.1, true, 'ice'], ['lightning', 1.1, true, 'storm'], ['light', 1.1, true, 'light'],
  ]);
  assert.deepEqual(nyra.mechanic.list, []);
  assert.ok(codex.events.some((e) => e.type === 'mechanic' && e.mechanic.list.length === 0));
});

test('stance: assault → virtuoso, guard, skill hits use the stance held before, reset on unavoided hit', () => {
  const { model } = setup({ actor: 'p2' });
  const sable = model.get('p2');
  sable.ap = 9;
  model.get('e0').hp = model.get('e0').stats.maxHp = 5000;
  const base = 1.3 * 36 * MIT(10);
  let r = runPartyAction(model, 'p2', { kind: 'skill', id: 'lunge', targetIds: ['e0'] });
  assert.deepEqual(dmgTo(r.events, 'e0'), [Math.round(base)], 'neutral while striking');
  assert.equal(sable.mechanic.value, 'assault');
  forceTurn(model, 'p2');
  r = runPartyAction(model, 'p2', { kind: 'skill', id: 'lunge', targetIds: ['e0'] });
  assert.deepEqual(dmgTo(r.events, 'e0'), [Math.round(base * 1.4)]);
  assert.equal(sable.mechanic.value, 'virtuoso', 'assault while in assault → virtuoso');
  forceTurn(model, 'p2');
  r = runPartyAction(model, 'p2', { kind: 'skill', id: 'lunge', targetIds: ['e0'] });
  assert.deepEqual(dmgTo(r.events, 'e0'), [Math.round(base * 2)]);
  assert.equal(sable.mechanic.value, 'virtuoso', 'assault while virtuoso stays virtuoso');
  forceTurn(model, 'p2');
  runPartyAction(model, 'p2', { kind: 'skill', id: 'en_garde', targetIds: ['e0'] });
  assert.equal(sable.mechanic.value, 'guard');
  // Unavoided enemy hit → neutral; a dodged one keeps the stance.
  sable.mechanic.value = 'assault';
  model.get('e0').pool = ['sting'];
  forceTurn(model, 'e0');
  let plan = model.planEnemyAction('e0');
  plan.hits[0].targetIds = ['p2'];
  model.resolveEnemyHit(plan, 0, 'dodge');
  assert.equal(sable.mechanic.value, 'assault');
  model.finishEnemyAction(plan);
  forceTurn(model, 'e0');
  plan = model.planEnemyAction('e0');
  plan.hits[0].targetIds = ['p2'];
  const ev = model.resolveEnemyHit(plan, 0, 'hit');
  assert.equal(dmgTo(ev, 'p2')[0], Math.round(0.9 * 30 * MIT(17) * 1.2), 'assault takes ×1.2');
  assert.equal(sable.mechanic.value, 'neutral');
  assert.ok(ev.some((e) => e.type === 'mechanic' && e.mechanic.value === 'neutral'));
});

test('bonusVs (broken / status), critBonus and mark consumption', () => {
  const { model } = setup({ actor: 'p2', skills: { sable: ['coup', 'exploit'] } });
  const sable = model.get('p2');
  const drift = model.get('e0');
  drift.hp = drift.stats.maxHp = 5000;
  sable.ap = 9;
  let r = runPartyAction(model, 'p2', { kind: 'skill', id: 'coup', targetIds: ['e0'] });
  assert.deepEqual(dmgTo(r.events, 'e0'), [Math.round(2.4 * 36 * MIT(10))]);
  drift.broken = true;
  forceTurn(model, 'p2');
  r = runPartyAction(model, 'p2', { kind: 'skill', id: 'coup', targetIds: ['e0'] });
  assert.deepEqual(dmgTo(r.events, 'e0'), [Math.round(2.4 * 36 * MIT(10) * 1.8)]);
  drift.broken = false;
  drift.statuses.push({ id: 'mark', turns: 3 });
  forceTurn(model, 'p2');
  sable.ap = 9;
  r = runPartyAction(model, 'p2', { kind: 'skill', id: 'exploit', targetIds: ['e0'] });
  assert.deepEqual(dmgTo(r.events, 'e0'), [Math.round(1.2 * 36 * MIT(10) * 1.5 * 1.5)]);
  assert.ok(r.events.some((e) => e.type === 'statusEnd' && e.status === 'mark'), 'mark consumed by the hit');
  const { model: m2 } = setup({ actor: 'p2', rng: new ConstRng(0.4), skills: { sable: ['coup'] } });
  m2.get('p2').ap = 9;
  const c = runPartyAction(m2, 'p2', { kind: 'skill', id: 'coup', targetIds: ['e0'] });
  assert.equal(types(c.events, 'damage')[0].crit, true, 'crit 0.12 + critBonus 0.3 beats a 0.4 roll');
});

test('kills: KO event, statuses cleared, victory when the last enemy falls', () => {
  const { model } = setup();
  const drift = model.get('e0');
  drift.hp = 10;
  drift.statuses.push({ id: 'burn', turns: 3 });
  const { events } = runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.deepEqual(types(events, 'ko'), [{ type: 'ko', targetId: 'e0' }]);
  assert.equal(drift.alive, false);
  assert.equal(drift.hp, 0);
  assert.deepEqual(drift.statuses, []);
  assert.equal(dmgTo(events, 'e0').length, 1, 'the second hit on a dead target is a no-op');
  assert.equal(model.outcome(), 'victory');
  assert.ok(model.log.some((l) => /Victory/.test(l)));
});
