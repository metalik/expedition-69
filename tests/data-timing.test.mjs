// Plays every bestiary attack timeline through the real defensive judge (src/battle/qte.js DefenseTracker) on
// every difficulty: a perfect player (early / on time / late) must avoid every hit, a dodge-only player must survive
// everything except jump waves, a player who bites a feint must still be able to defend the follow-up, and every
// hit must resolve before the action's duration ends. Skips (does not fail) if qte.js cannot be loaded yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMIES } from '../src/data/enemies.js';

let qte = null;
let loadError = null;
try {
  qte = await import('../src/battle/qte.js');
  if (typeof qte.DefenseTracker !== 'function' || typeof qte.windowsFor !== 'function') throw new Error('DefenseTracker/windowsFor missing');
} catch (err) {
  loadError = err;
  qte = null;
}
const skip = qte ? false : `src/battle/qte.js unavailable (${loadError?.message})`;

const DIFFICULTIES = ['story', 'expeditioner', 'veteran'];
const BEST = { normal: 'parry', unparryable: 'dodge', jump: 'jump', gradient: 'gradient' };
const attacks = Object.values(ENEMIES).flatMap((e) => Object.values(e.attacks).map((a) => ({ e, a }))).filter(({ a }) => a.hits.length);

/** Feed presses (sorted) and advance the tracker past the end of the action; returns outcomes per hit. */
function play(a, difficulty, presses) {
  const tracker = new qte.DefenseTracker({ hits: a.hits.map((h) => ({ t: h.t, type: h.type })), difficulty });
  const verdicts = [];
  for (const p of [...presses].sort((x, y) => x.t - y.t)) {
    tracker.update(p.t);
    verdicts.push({ ...p, ...tracker.press(p.action, p.t) });
  }
  tracker.update(a.duration);
  return { tracker, verdicts, outcomes: tracker.results.map((r) => r?.outcome ?? null) };
}

test('a perfect player avoids every hit, early, on time or late, on every difficulty', { skip }, () => {
  for (const difficulty of DIFFICULTIES) {
    const w = qte.windowsFor(difficulty);
    for (const lean of [-0.6, 0, 0.6]) {
      for (const { e, a } of attacks) {
        const presses = a.hits.filter((h) => h.type !== 'feint').map((h) => {
          const action = BEST[h.type];
          const win = w[action];
          return { action, t: h.t + (lean < 0 ? lean * win.pre : lean * win.post) };
        });
        const { outcomes, tracker } = play(a, difficulty, presses);
        a.hits.forEach((h, i) => {
          if (h.type === 'feint') return;
          assert.notEqual(outcomes[i], 'hit', `${difficulty} lean ${lean}: ${e.id}.${a.id} hit ${i} (${h.type} @${h.t}) was not avoidable`);
          assert.ok(outcomes[i] !== null, `${e.id}.${a.id} hit ${i} unresolved`);
        });
        assert.ok(tracker.isDone(), `${e.id}.${a.id}: tracker done by duration`);
      }
    }
  }
});

test('perfect play earns a counterattack wherever the attack allows one', { skip }, () => {
  for (const { e, a } of attacks) {
    const presses = a.hits.filter((h) => h.type !== 'feint').map((h) => ({ action: BEST[h.type], t: h.t }));
    const { outcomes } = play(a, 'expeditioner', presses);
    const counterable = a.hits.every((h, i) => h.type === 'feint' || ['parry', 'jump', 'gradient'].includes(outcomes[i]));
    const hasUnparryable = a.hits.some((h) => h.type === 'unparryable');
    assert.equal(counterable, !hasUnparryable, `${e.id}.${a.id}: counter availability`);
  }
});

test('a dodge-only player survives everything but jump waves', { skip }, () => {
  for (const difficulty of DIFFICULTIES) {
    for (const { e, a } of attacks) {
      const presses = a.hits.filter((h) => h.type !== 'feint' && h.type !== 'jump').map((h) => ({ action: 'dodge', t: h.t }));
      const { outcomes } = play(a, difficulty, presses);
      a.hits.forEach((h, i) => {
        if (h.type === 'feint' || h.type === 'jump') return;
        assert.ok(['dodge', 'perfectDodge'].includes(outcomes[i]), `${difficulty}: ${e.id}.${a.id} hit ${i} not dodgeable (${outcomes[i]})`);
      });
    }
  }
});

test('biting a feint is punished, but the follow-up can still be defended', { skip }, () => {
  const withFeint = attacks.filter(({ a }) => a.hits.some((h) => h.type === 'feint'));
  assert.ok(withFeint.length >= 5);
  for (const difficulty of DIFFICULTIES) {
    for (const { e, a } of withFeint) {
      const fi = a.hits.findIndex((h) => h.type === 'feint');
      const presses = [{ action: 'parry', t: a.hits[fi].t, bait: true }];
      for (const h of a.hits) if (h.type !== 'feint') presses.push({ action: BEST[h.type], t: h.t });
      const { outcomes, verdicts } = play(a, difficulty, presses);
      const bait = verdicts.find((v) => v.bait);
      assert.equal(bait.reason, 'whiff', `${difficulty}: ${e.id}.${a.id}: pressing into the feint must whiff`);
      a.hits.forEach((h, i) => {
        if (h.type === 'feint') return;
        assert.notEqual(outcomes[i], 'hit', `${difficulty}: ${e.id}.${a.id}: hit ${i} undefendable after biting the feint`);
      });
    }
  }
});

test('an idle player is hit by every real hit, and all hits resolve before the action ends', { skip }, () => {
  for (const difficulty of DIFFICULTIES) {
    for (const { e, a } of attacks) {
      const { outcomes, tracker } = play(a, difficulty, []);
      a.hits.forEach((h, i) => {
        if (h.type === 'feint') assert.equal(outcomes[i], null);
        else assert.equal(outcomes[i], 'hit', `${e.id}.${a.id} hit ${i}`);
      });
      assert.ok(tracker.endTime <= a.duration, `${difficulty}: ${e.id}.${a.id} resolves at ${tracker.endTime} > duration ${a.duration}`);
    }
  }
});
