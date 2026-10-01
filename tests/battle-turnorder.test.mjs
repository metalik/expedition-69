// Tests for the CTB turn order (src/battle/turnOrder.js + BattleModel.nextTurn/endTurn/peekTurnOrder):
// initiative, ambush, haste/slow/chill, pure forecast, KO exclusion, ties, stun/broken skips and rounds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSpd, forecastTurns, rollInitiative, compareTurnPriority, AMBUSH_BONUS } from '../src/battle/turnOrder.js';
import { createFixtureModel, forceTurn, runPartyAction, FixtureRng, ConstRng } from '../tools/simulate.mjs';

const ids = (model) => model.combatants.map((c) => [c.id, c.initiative]);

/** Plays n turns doing nothing (each actor just ends its turn); returns the actor ids. */
function playIdle(model, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = model.nextTurn();
    out.push(t.actorId);
    model.endTurn(t.actorId);
  }
  return out;
}

test('initiative = rng.int(0,30) + spd, ambush side +60', () => {
  const { model } = createFixtureModel();
  // ConstRng(0.5) → roll 15.
  assert.deepEqual(model.combatants.map((c) => c.initiative), [15 + 40, 15 + 44, 15 + 52, 15 + 38]);
  const amb = createFixtureModel({ ambush: 'party' }).model;
  assert.deepEqual(amb.party.map((c) => c.initiative), [15 + 40 + AMBUSH_BONUS, 15 + 44 + AMBUSH_BONUS, 15 + 52 + AMBUSH_BONUS]);
  assert.equal(amb.enemies[0].initiative, 15 + 38);
  const enemyAmb = createFixtureModel({ ambush: 'enemy' }).model;
  assert.equal(enemyAmb.enemies[0].initiative, 15 + 38 + AMBUSH_BONUS);
  assert.equal(rollInitiative({ stats: { spd: 10 } }, new ConstRng(0.9999), 0), 40, 'roll is capped at 30');
  assert.equal(rollInitiative({ stats: { spd: 10 } }, new ConstRng(0), 0), 10);
});

test('ambush: the ambushing side acts first; party ambush grants +1 starting AP', () => {
  const { model } = createFixtureModel({ ambush: 'party' });
  assert.deepEqual(model.party.map((m) => m.ap), [2, 2, 2]);
  assert.deepEqual(model.peekTurnOrder(3).sort(), ['p0', 'p1', 'p2']);
  const e = createFixtureModel({ ambush: 'enemy', enemies: ['driftling'] }).model;
  assert.deepEqual(e.party.map((m) => m.ap), [1, 1, 1]);
  assert.equal(e.peekTurnOrder(1)[0], 'e0');
});

test('first actor is the one that reaches 100 first; the actor subtracts 100', () => {
  const { model } = createFixtureModel();
  const t = model.nextTurn();
  // Times to 100: Sable 33/52, Nyra 41/44, Gideon 45/40, Driftling 47/38.
  assert.equal(t.actorId, 'p2');
  assert.equal(t.skipped, false);
  assert.equal(model.get('p2').initiative, 0);
  const dt = 33 / 52;
  assert.ok(Math.abs(model.get('p1').initiative - (59 + 44 * dt)) < 1e-4);
  assert.ok(Math.abs(model.get('e0').initiative - (53 + 38 * dt)) < 1e-4);
  assert.equal(model.turn.actorId, 'p2');
  assert.equal(model.stats.turns, 1);
});

test('peekTurnOrder is a pure forecast that matches the real sequence', () => {
  const { model } = createFixtureModel({ enemies: ['driftling', 'shellguard'], rng: new FixtureRng(11) });
  const before = JSON.stringify(ids(model));
  const forecast = model.peekTurnOrder(12);
  assert.equal(JSON.stringify(ids(model)), before, 'forecast does not mutate initiative');
  assert.equal(forecast.length, 12);
  assert.deepEqual(playIdle(model, 12), forecast);
  assert.equal(model.peekTurnOrder().length, 8, 'default n = 8');
});

test('mid-turn forecast excludes the acting turn and accounts for statuses expiring at its end', () => {
  const { model } = createFixtureModel({ rng: new FixtureRng(3) });
  const t = model.nextTurn();
  const actor = model.get(t.actorId);
  actor.statuses.push({ id: 'haste', turns: 1 });
  const forecast = model.peekTurnOrder(10);
  model.endTurn(t.actorId); // haste expires here
  assert.equal(actor.statuses.length, 0);
  assert.deepEqual(playIdle(model, 10), forecast);
});

test('faster combatants act more often; haste/slow/chill scale effective speed', () => {
  const { model } = createFixtureModel({ rng: new FixtureRng(5) });
  const seq = playIdle(model, 60);
  const count = (id) => seq.filter((x) => x === id).length;
  assert.ok(count('p2') > count('p0'), 'Sable (52) acts more often than Gideon (40)');
  const c = { stats: { spd: 100 }, statuses: [] };
  assert.equal(effectiveSpd(c), 100);
  assert.equal(effectiveSpd({ ...c, statuses: [{ id: 'haste', turns: 1 }] }), 130);
  assert.equal(effectiveSpd({ ...c, statuses: [{ id: 'slow', turns: 1 }] }), 70);
  assert.equal(effectiveSpd({ ...c, statuses: [{ id: 'chill', turns: 1 }] }), 75);
  assert.ok(Math.abs(effectiveSpd({ ...c, statuses: [{ id: 'haste', turns: 1 }, { id: 'chill', turns: 1 }] }) - 97.5) < 1e-9);
  const hasted = createFixtureModel({ rng: new FixtureRng(5) }).model;
  hasted.get('p0').statuses.push({ id: 'haste', turns: 99 });
  const seq2 = playIdle(hasted, 60);
  assert.ok(seq2.filter((x) => x === 'p0').length > count('p0'), 'haste gives Gideon more turns');
  const slowed = createFixtureModel({ rng: new FixtureRng(5) }).model;
  slowed.get('p2').statuses.push({ id: 'slow', turns: 99 });
  assert.ok(playIdle(slowed, 60).filter((x) => x === 'p2').length < count('p2'), 'slow gives Sable fewer turns');
});

test('KO\'d combatants are excluded from forecast and turns', () => {
  const { model } = createFixtureModel({ rng: new FixtureRng(9) });
  const nyra = model.get('p1');
  nyra.alive = false;
  nyra.hp = 0;
  assert.ok(!model.peekTurnOrder(16).includes('p1'));
  assert.ok(!playIdle(model, 16).includes('p1'));
});

test('ties: higher speed, then party first, then slot order', () => {
  const mk = (id, side, slot, init, spd) => ({ id, side, slot, initiative: init, alive: true, stats: { spd }, statuses: [] });
  const list = [mk('e0', 'enemy', 0, 50, 50), mk('p1', 'party', 1, 50, 50), mk('p0', 'party', 0, 50, 50), mk('e1', 'enemy', 1, 60, 40)];
  // e1 needs 40/40 = 1.0 time units, the others 50/50 = 1.0 too → speed then side then slot.
  assert.deepEqual(forecastTurns(list, 4), ['p0', 'p1', 'e0', 'e1']);
  assert.ok(compareTurnPriority({ init: 100, effSpd: 10, side: 'enemy', slot: 0 }, { init: 50, effSpd: 90, side: 'party', slot: 0 }) < 0);
});

test('stunned actors skip their turn: skip event, stun consumed, no AP, endTurn no-op', () => {
  const { model } = createFixtureModel();
  model.get('p2').statuses.push({ id: 'stun', turns: 1 });
  const t = model.nextTurn();
  assert.equal(t.actorId, 'p2');
  assert.equal(t.skipped, true);
  assert.equal(t.reason, 'stun');
  assert.ok(t.events.some((e) => e.type === 'skip' && e.targetId === 'p2' && e.reason === 'stun'));
  assert.ok(t.events.some((e) => e.type === 'statusEnd' && e.status === 'stun'));
  assert.equal(model.get('p2').ap, 1, 'no AP on a skipped turn');
  assert.deepEqual(model.endTurn('p2'), []);
  assert.ok(model.beginAction('p2', { kind: 'attack' }).error);
  const next = model.nextTurn();
  assert.notEqual(next.actorId, null);
  assert.equal(next.skipped, false);
});

test('a Broken enemy skips its next turn, then recovers (break → 0), defenseless lingers', () => {
  const { model } = createFixtureModel();
  const drift = model.get('e0');
  forceTurn(model, 'p0');
  drift.breakValue = 95;
  const { events } = runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.ok(events.some((e) => e.type === 'broken' && e.targetId === 'e0'));
  assert.equal(drift.broken, true);
  assert.equal(drift.breakValue, 100);
  assert.ok(events.some((e) => e.type === 'status' && e.status === 'stun' && e.turns === 1));
  assert.ok(events.some((e) => e.type === 'status' && e.status === 'defenseless' && e.turns === 2));
  // Break is locked while broken.
  const before = drift.breakValue;
  model.turn.acted = false;
  runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(drift.breakValue, before);
  model.endTurn('p0');
  let t;
  do t = model.nextTurn(); while (t.actorId !== 'e0' && (model.endTurn(t.actorId), true));
  assert.equal(t.skipped, true);
  assert.equal(t.reason, 'broken');
  assert.ok(t.events.some((e) => e.type === 'recover' && e.targetId === 'e0'));
  assert.equal(drift.broken, false);
  assert.equal(drift.breakValue, 0);
  assert.equal(model.get('e0').statuses.find((s) => s.id === 'defenseless')?.turns, 1);
});

test('rounds advance once every living combatant has acted', () => {
  const { model } = createFixtureModel({ rng: new FixtureRng(2) });
  assert.equal(model.round, 1);
  const seen = new Set();
  let roundAtFirstRepeat = null;
  for (let i = 0; i < 20; i++) {
    const t = model.nextTurn();
    if (seen.size === 4 && roundAtFirstRepeat === null) roundAtFirstRepeat = model.round;
    seen.add(t.actorId);
    model.endTurn(t.actorId);
  }
  assert.equal(roundAtFirstRepeat, 2);
  assert.ok(model.round >= 4);
  assert.equal(model.summary().stats.rounds, model.round);
});

test('the party gains +1 AP at the start of each own turn', () => {
  const { model } = createFixtureModel();
  const t = model.nextTurn();
  assert.equal(t.actorId, 'p2');
  assert.equal(model.get('p2').ap, 2);
  assert.ok(t.events.some((e) => e.type === 'ap' && e.targetId === 'p2' && e.delta === 1 && e.apAfter === 2));
  model.endTurn('p2');
  const t2 = model.nextTurn();
  assert.ok(t2.actorId !== 'p2' || model.get('p2').ap === 3);
});
