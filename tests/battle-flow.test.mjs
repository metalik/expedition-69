// Whole-battle tests for BattleModel: start-of-turn status ticks, practice mode, victory / defeat / flee,
// summary & rewards, the battle log, seeded determinism, and a randomized fuzz run checking invariants.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleModel, xpFalloff, XP_FALLOFF } from '../src/battle/model.js';
import {
  createFixtureModel, createFixtureData, buildPartyManual, forceTurn, runPartyAction, runEnemyAction, runBattle,
  FixtureRng, ConstRng, DEFAULT_BOT, supportShot, runChain,
} from '../tools/simulate.mjs';

const types = (events, type) => events.filter((e) => e.type === type);

function turnFor(model, id) {
  for (let i = 0; i < 50; i++) {
    const t = model.nextTurn();
    if (t.actorId === id) return t;
    model.endTurn(t.actorId);
  }
  throw new Error(`no turn for ${id}`);
}

test('burn ticks 5% at turn start (bosses 1.5%), regen heals 8%, durations tick at turn end', () => {
  const { model } = createFixtureModel({ enemies: ['driftling', 'warden'] });
  const g = model.get('p0');
  g.statuses.push({ id: 'burn', turns: 1 }, { id: 'regen', turns: 2 });
  g.hp = 200;
  const t = turnFor(model, 'p0');
  assert.deepEqual(types(t.events, 'statusTick'), [
    { type: 'statusTick', targetId: 'p0', status: 'burn', amount: 21 },
    { type: 'statusTick', targetId: 'p0', status: 'regen', amount: 34 },
  ]);
  assert.ok(types(t.events, 'damage').some((e) => e.targetId === 'p0' && e.amount === 21));
  assert.equal(g.hp, 200 - 21 + 34);
  const end = model.endTurn('p0');
  assert.deepEqual(types(end, 'statusEnd').map((e) => e.status), ['burn']);
  assert.equal(g.statuses[0].turns, 1);
  const w = model.get('e1');
  w.statuses.push({ id: 'burn', turns: 3 });
  const tw = turnFor(model, 'e1');
  assert.equal(types(tw.events, 'statusTick')[0].amount, Math.round(2900 * 0.015));
});

test('burn can KO the actor at turn start (turn skipped with reason ko)', () => {
  const { model } = createFixtureModel({ enemies: ['driftling', 'shellguard'] });
  const d = model.get('e0');
  d.statuses.push({ id: 'burn', turns: 3 });
  d.hp = 3;
  const t = turnFor(model, 'e0');
  assert.deepEqual([t.skipped, t.reason], [true, 'ko']);
  assert.ok(types(t.events, 'ko').length === 1);
  assert.equal(d.alive, false);
});

test('practice mode: HP floors at 1 on both sides, no rewards, no flee', () => {
  const { model } = createFixtureModel({ enemies: ['dummy'], practice: true });
  const dummy = model.get('e0');
  dummy.hp = 3;
  forceTurn(model, 'p0');
  const r = runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.equal(dummy.hp, 1);
  assert.equal(dummy.alive, true);
  assert.equal(types(r.events, 'ko').length, 0);
  assert.equal(model.outcome(), null);
  const nyra = model.get('p1');
  nyra.hp = 2;
  model.get('e0').pool = ['jab'];
  forceTurn(model, 'e0');
  const plan = model.planEnemyAction('e0');
  plan.hits[0].targetIds = ['p1'];
  model.resolveEnemyHit(plan, 0, 'hit');
  assert.deepEqual([nyra.hp, nyra.alive], [1, true]);
  assert.equal(model.getCommands('p0').flee.usable, false);
  model.endBattle('victory');
  const s = model.summary();
  assert.deepEqual([s.outcome, s.xp, s.glint, s.drops.length, s.practice], ['victory', 0, 0, 0, true]);
});

test('victory rewards: xp to everyone (half to KO\'d), glint, drops rolled once', () => {
  const { model } = createFixtureModel({ enemies: ['driftling', 'shellguard'] });
  model.get('p2').alive = false;
  model.get('p2').hp = 0;
  for (const e of model.enemies) {
    e.alive = false;
    e.hp = 0;
  }
  assert.equal(model.outcome(), 'victory');
  const s = model.summary();
  assert.equal(s.xp, 24 + 36);
  assert.deepEqual(s.xpByMember, { gideon: 60, nyra: 60, sable: 30 });
  assert.equal(s.glint, 12 + 20);
  assert.deepEqual(s.drops, [], 'ConstRng(0.5) misses 10% / 15% drops');
  assert.deepEqual(s.party.map((p) => [p.id, p.alive, p.hp, p.hpAfterRecovery]), [
    ['gideon', true, 420, 420], ['nyra', true, 300, 300], ['sable', false, 0, 1 + 68],
  ]);
  const boss = createFixtureModel({ enemies: ['warden'], rng: new FixtureRng(1) }).model;
  boss.get('e0').alive = false;
  const s1 = boss.summary();
  assert.ok(s1.drops.includes('anvil_heart'), 'chance 1 always drops');
  assert.deepEqual(boss.summary().drops, s1.drops, 'drops are rolled once');
  assert.equal(s1.boss, true);
});

test('summary carries the difficulty; Veteran has no post-battle recovery (KO\'d still come back at 1 HP)', () => {
  const finish = (difficulty) => {
    const { model } = createFixtureModel({ enemies: ['driftling'], difficulty });
    model.get('p0').hp = 100;
    model.get('p2').alive = false;
    model.get('p2').hp = 0;
    model.get('e0').alive = false;
    model.get('e0').hp = 0;
    return model.summary();
  };
  const exp = finish('expeditioner');
  assert.equal(exp.difficulty, 'expeditioner');
  assert.deepEqual(exp.party.map((p) => p.hpAfterRecovery), [100 + 84, 300, 1 + 68]);
  const vet = finish('veteran');
  assert.equal(vet.difficulty, 'veteran');
  assert.deepEqual(vet.party.map((p) => p.hpAfterRecovery), [100, 300, 1]);
});

test('xp falls off for enemies below a member\'s level: ×clamp(1 − 0.15 × gap, 0.25, 1), per member', () => {
  assert.equal(xpFalloff(3, 5), 1, 'fighting up earns full XP');
  assert.equal(xpFalloff(5, 5), 1);
  assert.ok(Math.abs(xpFalloff(7, 5) - 0.7) < 1e-9);
  assert.equal(xpFalloff(20, 1), XP_FALLOFF.min);
  const { model } = createFixtureModel({ enemies: ['driftling', 'shellguard'] }); // bestiary levels 1 and 2
  model.party[0].level = 3; // −0.3 vs the driftling, −0.15 vs the shellguard
  model.party[1].level = 12; // floor on both
  for (const e of model.enemies) {
    e.alive = false;
    e.hp = 0;
  }
  const s = model.summary();
  const [d, sh] = model.enemies;
  assert.equal(s.xp, d.xp + sh.xp, 'summary.xp stays the battle\'s full XP');
  assert.deepEqual(s.xpByMember, {
    gideon: Math.round(d.xp * xpFalloff(3, d.level) + sh.xp * xpFalloff(3, sh.level)),
    nyra: Math.round((d.xp + sh.xp) * XP_FALLOFF.min),
    sable: d.xp + sh.xp,
  });
});

test('defeat when every party member is down; no rewards', () => {
  const { model } = createFixtureModel();
  for (const m of model.party) {
    m.hp = 1;
  }
  model.get('e0').pool = ['pulse'];
  forceTurn(model, 'e0');
  const { events } = runEnemyAction(model, 'e0', 'hit');
  assert.equal(types(events, 'ko').length, 3);
  assert.equal(model.outcome(), 'defeat');
  const s = model.summary();
  assert.deepEqual([s.outcome, s.xp, s.glint], ['defeat', 0, 0]);
  assert.deepEqual(model.nextTurn(), { actorId: null, skipped: false, events: [], over: true });
  assert.ok(model.log.at(-1).includes('fallen'));
});

test('summary stats track defensive play', () => {
  const { model } = createFixtureModel();
  model.get('e0').pool = ['lash'];
  forceTurn(model, 'e0');
  runEnemyAction(model, 'e0', ['parry', 'dodge']);
  forceTurn(model, 'e0');
  runEnemyAction(model, 'e0', ['perfectDodge', 'hit']);
  const s = model.summary().stats;
  assert.deepEqual([s.parries, s.dodges, s.perfectDodges, s.hitsTaken], [1, 1, 1, 1]);
  for (const k of ['parries', 'perfectDodges', 'dodges', 'jumps', 'gradientCounters', 'perfects', 'hitsTaken', 'turns']) {
    assert.equal(typeof s[k], 'number', k);
  }
});

test('the battle log is a list of readable lines', () => {
  const { model } = createFixtureModel({ enemies: ['shellguard', 'driftling'] });
  forceTurn(model, 'p0');
  runPartyAction(model, 'p0', { kind: 'attack', targetIds: ['e0'] });
  assert.ok(model.log.length >= 3);
  assert.ok(model.log.every((l) => typeof l === 'string' && l.length > 3));
  assert.ok(model.log.some((l) => /Gideon attacks Shellguard/.test(l)));
  assert.ok(model.log.some((l) => /shield absorbs/.test(l)));
  const dup = createFixtureModel({ enemies: ['driftling', 'driftling'] }).model;
  assert.deepEqual(dup.enemies.map((e) => e.name), ['Driftling A', 'Driftling B']);
});

test('constructor validates injected data and rng; unknown enemies are skipped', () => {
  const data = createFixtureData();
  assert.throws(() => new BattleModel({ party: [], enemies: [], rng: new ConstRng() }), /data/);
  assert.throws(() => new BattleModel({ party: [], enemies: [], data }), /RNG/);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const m = new BattleModel({ party: buildPartyManual(data, 1), enemies: ['driftling', 'ghost', { id: 'shellguard', level: 4 }], rng: new ConstRng(), data });
    assert.deepEqual(m.enemies.map((e) => [e.id, e.key]), [['e0', 'driftling'], ['e1', 'shellguard']]);
    assert.ok(m.get('e1').stats.maxHp > 320, 'level scaling above the bestiary level');
    assert.equal(m.get('e1').level, 4);
  } finally {
    console.warn = warn;
  }
  const ko = new BattleModel({ party: [{ ...buildPartyManual(data, 1)[0], hp: 0 }], enemies: ['driftling'], rng: new ConstRng(), data });
  assert.equal(ko.get('p0').alive, false);
  assert.equal(ko.outcome(), 'defeat');
});

test('determinism: identical seeds replay identical battles', () => {
  const data = createFixtureData();
  const party = buildPartyManual(data, 3);
  const a = runBattle({ data, party: structuredClone(party), enemies: ['shellguard', 'tidecaller', 'driftling'], seed: 42 });
  const b = runBattle({ data, party: structuredClone(party), enemies: ['shellguard', 'tidecaller', 'driftling'], seed: 42 });
  const c = runBattle({ data, party: structuredClone(party), enemies: ['shellguard', 'tidecaller', 'driftling'], seed: 43 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.failed, c.failed);
  const run = (seed) => {
    const m = new BattleModel({ party: structuredClone(party), enemies: ['warden'], rng: new FixtureRng(seed), data });
    for (let i = 0; i < 30 && !m.outcome(); i++) {
      const t = m.nextTurn();
      if (t.skipped) continue;
      if (t.actorId.startsWith('p')) runPartyAction(m, t.actorId, { kind: 'attack' });
      else runEnemyAction(m, t.actorId, 'hit');
      m.endTurn(t.actorId);
    }
    return { log: m.log, summary: m.summary() };
  };
  assert.deepEqual(run(7), run(7));
});

test('bot battles finish with sensible results', () => {
  const data = createFixtureData();
  const party = buildPartyManual(data, 2);
  let wins = 0;
  for (let i = 0; i < 20; i++) {
    const r = runBattle({ data, party: structuredClone(party), enemies: ['driftling', 'shellguard'], seed: 100 + i, cfg: DEFAULT_BOT });
    if (r.outcome === 'victory') wins++;
    assert.ok(r.turns > 0 && r.rounds >= 1);
  }
  assert.ok(wins >= 15, `a competent bot should mostly win (won ${wins}/20)`);
  const hopeless = runBattle({ data, party: buildPartyManual(data, 1), enemies: ['warden'], seed: 5, cfg: { ...DEFAULT_BOT, parry: 0, dodge: 0, jump: 0, gradient: 0 } });
  assert.equal(hopeless.outcome, 'defeat');
});

test('fuzz: random commands and outcomes never break invariants', () => {
  const data = createFixtureData();
  const outcomes = ['parry', 'dodge', 'perfectDodge', 'jump', 'gradient', 'hit'];
  const ratings = ['perfect', 'good', 'miss', null];
  const encounters = [['driftling', 'driftling', 'shellguard'], ['tidecaller', 'shellguard'], ['warden'], ['dummy']];
  let battles = 0;
  let events = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = new FixtureRng(seed * 97);
    const pick = (arr) => arr[Math.floor(rng.next() * arr.length)];
    const party = buildPartyManual(data, 1 + (seed % 6));
    const model = new BattleModel({
      party, enemies: encounters[seed % encounters.length], rng: new FixtureRng(seed), data,
      difficulty: pick(['story', 'expeditioner', 'veteran']), ambush: pick([null, 'party', 'enemy']), practice: seed % 13 === 0,
    });
    const check = (evs) => {
      for (const e of evs) {
        assert.equal(typeof e.type, 'string');
        events++;
      }
      for (const c of model.combatants) {
        assert.ok(c.hp >= 0 && c.hp <= c.stats.maxHp, `${c.id} hp ${c.hp}`);
        assert.equal(c.alive, c.hp > 0);
        if (c.side === 'party') assert.ok(c.ap >= 0 && c.ap <= 9);
        if (c.mechanic?.type === 'surge') assert.ok(c.mechanic.value >= 0 && c.mechanic.value <= 10);
        if (c.mechanic?.type === 'glyphs') assert.ok(c.mechanic.list.length <= 4);
        if (c.side === 'enemy') assert.ok(c.shields >= 0 && c.breakValue <= c.breakMax);
        if (!c.alive) assert.equal(c.statuses.length, 0);
      }
      assert.ok(model.gradient >= 0 && model.gradient <= 300);
    };
    check(model.startEvents);
    for (let turn = 0; turn < 120 && !model.outcome(); turn++) {
      const t = model.nextTurn();
      check(t.events);
      if (!t.actorId || t.skipped) continue;
      const actor = model.get(t.actorId);
      if (actor.side === 'party') {
        for (let s = 0; s < 3 && actor.ap > 0 && rng.next() < 0.3; s++) {
          const targets = model.getValidTargets(actor.id, { kind: 'shot' });
          const target = pick([...targets, null]);
          const wp = target ? pick([...model.get(target).weakPoints.map((w) => w.id), null]) : null;
          const r = runPartyAction(model, actor.id, { kind: 'shot', targetIds: target ? [target] : [], weakPointId: wp }, null);
          check(r.events);
        }
        if (model.outcome()) break;
        const cmds = model.getCommands(actor.id);
        const options = [{ kind: 'attack' }];
        for (const s of cmds.skills.filter((x) => x.usable)) options.push({ kind: 'skill', id: s.id });
        for (const g of cmds.gradient.filter((x) => x.usable)) options.push({ kind: 'gradient', id: g.id });
        for (const it of cmds.items.filter((x) => x.usable)) options.push({ kind: 'item', id: it.id });
        const action = pick(options);
        const targets = model.getValidTargets(actor.id, action);
        const plan = model.beginAction(actor.id, { ...action, targetIds: targets.length ? [pick(targets)] : [] });
        assert.ok(!plan.error, plan.error);
        check(plan.events);
        plan.hits.forEach((_, i) => check(model.resolveHit(plan, i, pick(ratings))));
        check(model.finishAction(plan));
      } else {
        const plan = model.planEnemyAction(actor.id);
        check(plan.events);
        plan.hits.forEach((_, i) => check(model.resolveEnemyHit(plan, i, pick(outcomes))));
        for (const c of model.resolveCounters(plan)) check(c.events);
        check(model.finishEnemyAction(plan));
      }
      check(model.endTurn(actor.id));
      assert.equal(model.peekTurnOrder(8).length, model.combatants.some((c) => c.alive) ? 8 : 0);
    }
    const s = model.summary();
    assert.ok(['victory', 'defeat', 'fled', null].includes(s.outcome));
    battles++;
  }
  assert.equal(battles, 60);
  assert.ok(events > 1000);
});

test('simulator support planner: weak-point shots before the action, buffs and AP hand-offs; chains carry HP', () => {
  const { model } = createFixtureModel({ enemies: ['shellguard'] });
  const g = model.get('p0');
  forceTurn(model, 'p0');
  const support = { ...DEFAULT_BOT, planner: 'support' };
  g.ap = 1;
  assert.equal(supportShot(model, g, support), null, 'keeps AP for the real action');
  g.ap = 3;
  assert.deepEqual(supportShot(model, g, support), { kind: 'shot', targetIds: ['e0'], weakPointId: 'conch' });
  assert.equal(supportShot(model, g, { ...support, planner: 'value' }), null, 'opt-in only');
  assert.equal(supportShot(model, g, support, 2), null, 'at most two shots a turn');
  model.get('e0').shields = 0;
  assert.equal(supportShot(model, g, support), null, 'no shield left to strip, no shot fan');

  const data = createFixtureData();
  const party = buildPartyManual(data, 6);
  const r = runBattle({ data, party: structuredClone(party), enemies: ['warden'], seed: 7, cfg: support });
  assert.ok(r.outcome === 'victory' || r.outcome === 'defeat');
  assert.ok(Object.keys(r.skillUse).some((k) => k.endsWith('.shot')), 'Free Aim is used against the shielded Warden');
  assert.ok(r.skillUse['gideon.rally']?.uses >= 1, 'a party-wide buff is cast in a long fight');
  assert.equal(r.partyEnd.length, 3);

  const chain = runChain({ data, party, encounters: [{ enemies: ['driftling'] }, { enemies: ['driftling', 'shellguard'] }], seed: 3, cfg: DEFAULT_BOT, difficulty: 'veteran' });
  assert.equal(chain.won, true);
  assert.equal(chain.cleared, 2);
  assert.ok(chain.hpPct > 0 && chain.hpPct <= 1);
});
