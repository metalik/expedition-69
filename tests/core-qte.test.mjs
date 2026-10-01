// Exhaustive tests for the pure QTE timing judge (src/battle/qte.js): windows, claim zones, every
// hit type × action, exact window edges at every difficulty, lockouts, debounce, feints, combos,
// calibration, resolution timing, OffenseTracker and the helper exports.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTY, BASE_WINDOWS, LOCKOUT, OFFENSE_WINDOWS, DEFENSE_ACTIONS, VALID_DEFENSES, DEBOUNCE_MS,
  windowsFor, claimZone, judgeDefense, judgeOffense, qteMultiplier, describeOffset, perfectAction,
  isAvoided, difficultyDef, DefenseTracker, OffenseTracker, AttackClock, OUTCOME_LABELS, DEFENSE_OUTCOMES,
} from '../src/battle/qte.js';

const T = 1000;
const DIFFS = ['story', 'expeditioner', 'veteran'];
const TYPES = ['normal', 'unparryable', 'jump', 'gradient'];

/** Single-hit tracker helper. */
function single(type, { difficulty = 'expeditioner', calibration = 0, t = T } = {}) {
  return new DefenseTracker({ hits: [{ t, type }], difficulty, calibration });
}

/** Press once at T+offset, run to the end, return {press, result}. */
function judgeOnce(type, action, offset, opts = {}) {
  const tr = single(type, opts);
  const press = tr.press(action, T + offset);
  tr.update(T + 10000);
  return { press, result: tr.results[0], tracker: tr };
}

// Independent reference model written straight from SPEC §3.2 (not sharing code with qte.js).
function referenceOutcome(type, action, offset, difficulty) {
  const s = DIFFICULTY[difficulty].windowScale;
  const sc = (w) => ({ pre: Math.round(w.pre * s * 10) / 10, post: Math.round(w.post * s * 10) / 10 });
  const W = {
    parry: sc({ pre: 110, post: 45 }), dodge: sc({ pre: 200, post: 70 }), perfectDodge: sc({ pre: 70, post: 30 }),
    jump: sc({ pre: 260, post: 60 }), gradient: sc({ pre: 150, post: 50 }),
  };
  const zone = type === 'jump' ? W.jump : W.dodge; // normal/unparryable/gradient use dodge's span
  if (offset < -zone.pre || offset > zone.post) return 'whiff';
  const valid = { normal: ['parry', 'dodge'], unparryable: ['dodge'], jump: ['jump'], gradient: ['gradient', 'dodge'] }[type];
  if (!valid.includes(action)) return 'hit';
  const w = W[action];
  if (offset < -w.pre || offset > w.post) return 'hit';
  if (action === 'dodge') return offset >= -W.perfectDodge.pre && offset <= W.perfectDodge.post ? 'perfectDodge' : 'dodge';
  return action;
}

test('constants match the spec', () => {
  assert.deepEqual(DIFFICULTY.story, { name: 'Story', windowScale: 1.7, dmgTakenMult: 0.6, bossSpdMult: 1, bossDmgMult: 1, postBattleRecovery: 0.2 });
  assert.deepEqual(DIFFICULTY.expeditioner, {
    name: 'Expeditioner', windowScale: 1.0, dmgTakenMult: 1.0, bossSpdMult: 1, bossDmgMult: 1, postBattleRecovery: 0.2,
  });
  // Veteran (balance pass): tighter windows and heavier blows, bosses faster and harder, no recovery between fights
  assert.deepEqual(DIFFICULTY.veteran, {
    name: 'Veteran', windowScale: 0.65, dmgTakenMult: 1.3, bossSpdMult: 1.5, bossDmgMult: 1.6, postBattleRecovery: 0,
  });
  assert.ok(DIFFICULTY.veteran.windowScale < DIFFICULTY.expeditioner.windowScale && DIFFICULTY.story.windowScale > 1);
  assert.deepEqual(BASE_WINDOWS, {
    parry: { pre: 110, post: 45 }, dodge: { pre: 200, post: 70 }, perfectDodge: { pre: 70, post: 30 },
    jump: { pre: 260, post: 60 }, gradient: { pre: 150, post: 50 },
  });
  assert.deepEqual(LOCKOUT, { parry: 380, dodge: 260, jump: 650, gradient: 450 });
  assert.deepEqual(OFFENSE_WINDOWS, { perfect: 55, good: 130, whiffLockout: 250 });
  assert.deepEqual(DEFENSE_ACTIONS, ['parry', 'dodge', 'jump', 'gradient']);
  assert.deepEqual(VALID_DEFENSES, { normal: ['parry', 'dodge'], unparryable: ['dodge'], jump: ['jump'], gradient: ['gradient', 'dodge'], feint: [] });
  assert.equal(DEBOUNCE_MS, 90);
  assert.deepEqual(DEFENSE_OUTCOMES, ['parry', 'dodge', 'perfectDodge', 'jump', 'gradient', 'hit']);
  for (const o of DEFENSE_OUTCOMES) assert.equal(typeof OUTCOME_LABELS[o], 'string');
});

test('windowsFor scales every window by difficulty (0.1 ms precision) and falls back to expeditioner', () => {
  const e = windowsFor('expeditioner');
  assert.deepEqual(e.parry, { pre: 110, post: 45 });
  assert.deepEqual(e.offense, { perfect: 55, good: 130 });
  const s = windowsFor('story');
  assert.deepEqual(s.parry, { pre: 187, post: 76.5 });
  assert.deepEqual(s.dodge, { pre: 340, post: 119 });
  assert.deepEqual(s.perfectDodge, { pre: 119, post: 51 });
  assert.deepEqual(s.jump, { pre: 442, post: 102 });
  assert.deepEqual(s.gradient, { pre: 255, post: 85 });
  assert.deepEqual(s.offense, { perfect: 93.5, good: 221 });
  const v = windowsFor('veteran');
  assert.deepEqual(v.parry, { pre: 71.5, post: 29.3 });
  assert.deepEqual(v.dodge, { pre: 130, post: 45.5 });
  assert.deepEqual(v.perfectDodge, { pre: 45.5, post: 19.5 });
  assert.deepEqual(v.jump, { pre: 169, post: 39 });
  assert.deepEqual(v.gradient, { pre: 97.5, post: 32.5 });
  assert.deepEqual(v.offense, { perfect: 35.8, good: 84.5 });
  assert.deepEqual(windowsFor(), e);
  assert.deepEqual(windowsFor({ windowScale: 1.7 }), s);
  assert.deepEqual(windowsFor(0.65), v);
  assert.deepEqual(windowsFor(0.7).parry, { pre: 77, post: 31.5 }, 'raw scales still work');
  assert.equal(difficultyDef('nope'), DIFFICULTY.expeditioner);
  // windowsFor returns fresh objects callers may mutate
  windowsFor().parry.pre = 1;
  assert.equal(windowsFor().parry.pre, 110);
});

test('claimZone: normal/unparryable/gradient use the dodge span, jump uses the jump span', () => {
  for (const d of DIFFS) {
    const w = windowsFor(d);
    assert.deepEqual(claimZone('normal', w), w.dodge);
    assert.deepEqual(claimZone('unparryable', w), w.dodge);
    assert.deepEqual(claimZone('gradient', w), w.dodge);
    assert.deepEqual(claimZone('jump', w), w.jump);
    assert.deepEqual(claimZone('feint', w), w.dodge, 'feint bait zone mirrors a normal hit');
  }
  assert.deepEqual(claimZone('normal'), { pre: 200, post: 70 });
});

test('judgeDefense matrix at offset 0: every hit type × every action', () => {
  const expected = {
    normal: { parry: 'parry', dodge: 'perfectDodge', jump: 'hit', gradient: 'hit' },
    unparryable: { parry: 'hit', dodge: 'perfectDodge', jump: 'hit', gradient: 'hit' },
    jump: { parry: 'hit', dodge: 'hit', jump: 'jump', gradient: 'hit' },
    gradient: { parry: 'hit', dodge: 'perfectDodge', jump: 'hit', gradient: 'gradient' },
    feint: { parry: 'hit', dodge: 'hit', jump: 'hit', gradient: 'hit' },
  };
  for (const [type, row] of Object.entries(expected)) {
    for (const [action, outcome] of Object.entries(row)) {
      assert.equal(judgeDefense(type, action, 0), outcome, `${type} × ${action}`);
    }
  }
});

test('DefenseTracker: every hit type × every action pressed exactly on impact', () => {
  const expected = {
    normal: { parry: 'parry', dodge: 'perfectDodge', jump: 'hit', gradient: 'hit' },
    unparryable: { parry: 'hit', dodge: 'perfectDodge', jump: 'hit', gradient: 'hit' },
    jump: { parry: 'hit', dodge: 'hit', jump: 'jump', gradient: 'hit' },
    gradient: { parry: 'hit', dodge: 'perfectDodge', jump: 'hit', gradient: 'gradient' },
  };
  for (const [type, row] of Object.entries(expected)) {
    for (const [action, outcome] of Object.entries(row)) {
      const { press, result } = judgeOnce(type, action, 0);
      assert.equal(press.reason, 'claim', `${type} × ${action} claims`);
      assert.equal(press.accepted, true);
      assert.equal(press.claimedHit, 0);
      assert.deepEqual(result, { outcome, offset: 0, action }, `${type} × ${action}`);
    }
  }
});

test('reference model sweep: every type × action × difficulty × offset −500…+160 ms', () => {
  let checked = 0;
  for (const d of DIFFS) {
    for (const type of TYPES) {
      for (const action of DEFENSE_ACTIONS) {
        for (let off = -500; off <= 160; off += 0.5) {
          const exp = referenceOutcome(type, action, off, d);
          const { press, result } = judgeOnce(type, action, off, { difficulty: d });
          if (exp === 'whiff') {
            assert.equal(press.reason, 'whiff', `${d} ${type} ${action} ${off}: whiff`);
            assert.equal(press.claimedHit, -1);
            assert.equal(press.lockedUntil, T + off + LOCKOUT[action]);
            assert.equal(result.outcome, 'hit', 'unclaimed hit resolves as hit');
            assert.equal(result.action, null);
            assert.equal(result.offset, null);
          } else {
            assert.equal(press.reason, 'claim', `${d} ${type} ${action} ${off}: claim`);
            assert.equal(result.outcome, exp, `${d} ${type} ${action} ${off}`);
            assert.equal(result.offset, off);
          }
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 30000);
});

test('exact window edges for every valid action at every difficulty', () => {
  const successFor = (action, offset, w) => (action === 'dodge'
    ? (offset >= -w.perfectDodge.pre && offset <= w.perfectDodge.post ? 'perfectDodge' : 'dodge')
    : action);
  for (const d of DIFFS) {
    const w = windowsFor(d);
    for (const type of TYPES) {
      const zone = claimZone(type, w);
      for (const action of VALID_DEFENSES[type]) {
        const win = w[action];
        // inclusive edges succeed
        assert.equal(judgeOnce(type, action, -win.pre, { difficulty: d }).result.outcome, successFor(action, -win.pre, w), `${d} ${type} ${action} early edge`);
        assert.equal(judgeOnce(type, action, win.post, { difficulty: d }).result.outcome, successFor(action, win.post, w), `${d} ${type} ${action} late edge`);
        // one ms outside fails: inside the claim zone → claimed as 'hit'; outside → whiff (still 'hit')
        for (const off of [-win.pre - 1, win.post + 1]) {
          const { press, result } = judgeOnce(type, action, off, { difficulty: d });
          assert.equal(result.outcome, 'hit', `${d} ${type} ${action} ${off}`);
          const inZone = off >= -zone.pre && off <= zone.post;
          assert.equal(press.reason, inZone ? 'claim' : 'whiff', `${d} ${type} ${action} ${off} reason`);
        }
      }
    }
  }
});

test('named spec edges at expeditioner', () => {
  const o = (type, action, off) => judgeOnce(type, action, off).result.outcome;
  assert.equal(o('normal', 'parry', -110), 'parry');
  assert.equal(o('normal', 'parry', -111), 'hit');
  assert.equal(o('normal', 'parry', 45), 'parry');
  assert.equal(o('normal', 'parry', 46), 'hit');
  assert.equal(o('normal', 'dodge', -200), 'dodge');
  assert.equal(o('normal', 'dodge', 70), 'dodge');
  assert.equal(o('normal', 'dodge', -70), 'perfectDodge');
  assert.equal(o('normal', 'dodge', -71), 'dodge');
  assert.equal(o('normal', 'dodge', 30), 'perfectDodge');
  assert.equal(o('normal', 'dodge', 31), 'dodge');
  assert.equal(judgeOnce('normal', 'dodge', -201).press.reason, 'whiff');
  assert.equal(judgeOnce('normal', 'dodge', 71).press.reason, 'whiff');
  assert.equal(o('jump', 'jump', -260), 'jump');
  assert.equal(o('jump', 'jump', 60), 'jump');
  assert.equal(judgeOnce('jump', 'jump', -261).press.reason, 'whiff');
  assert.equal(judgeOnce('jump', 'jump', 61).press.reason, 'whiff');
  assert.equal(judgeOnce('jump', 'dodge', -250).press.reason, 'claim', 'dodge inside a jump zone claims…');
  assert.equal(o('jump', 'dodge', -250), 'hit', '…and fails');
  assert.equal(o('gradient', 'gradient', -150), 'gradient');
  assert.equal(o('gradient', 'gradient', 50), 'gradient');
  assert.equal(o('gradient', 'gradient', -151), 'hit');
  assert.equal(o('gradient', 'gradient', 51), 'hit');
  assert.equal(o('gradient', 'dodge', -200), 'dodge');
  assert.equal(o('gradient', 'parry', 0), 'hit');
  assert.equal(o('gradient', 'jump', 0), 'hit');
  assert.equal(o('unparryable', 'parry', 0), 'hit');
  assert.equal(o('unparryable', 'dodge', -150), 'dodge');
});

test('difficulty scaling changes windows but not lockouts', () => {
  assert.equal(judgeOnce('normal', 'parry', -100, { difficulty: 'veteran' }).result.outcome, 'hit');
  assert.equal(judgeOnce('normal', 'parry', -100, { difficulty: 'expeditioner' }).result.outcome, 'parry');
  assert.equal(judgeOnce('normal', 'parry', -180, { difficulty: 'story' }).result.outcome, 'parry');
  assert.equal(judgeOnce('normal', 'parry', -180, { difficulty: 'expeditioner' }).result.outcome, 'hit');
  assert.equal(judgeOnce('jump', 'jump', -400, { difficulty: 'story' }).result.outcome, 'jump');
  for (const d of DIFFS) {
    for (const a of DEFENSE_ACTIONS) {
      const tr = single('normal', { difficulty: d });
      const r = tr.press(a, 0); // far too early → whiff
      assert.equal(r.reason, 'whiff');
      assert.equal(tr.lockedUntil, LOCKOUT[a], `${d} ${a} lockout unscaled`);
    }
  }
});

test('whiff lockout blocks all defensive input for the action-specific duration', () => {
  for (const a of DEFENSE_ACTIONS) {
    const tr = single('normal');
    assert.equal(tr.lockedUntil, -Infinity);
    const r = tr.press(a, 100);
    assert.deepEqual(r, { accepted: true, claimedHit: -1, reason: 'whiff', lockedUntil: 100 + LOCKOUT[a] });
    for (const other of DEFENSE_ACTIONS) {
      const l = tr.press(other, 100 + LOCKOUT[a] - 1);
      assert.equal(l.reason, 'locked', `${a} locks ${other}`);
      assert.equal(l.accepted, false);
    }
    assert.equal(tr.lockedUntil, 100 + LOCKOUT[a], 'locked presses do not extend the lockout');
    assert.equal(tr.isLocked(100 + LOCKOUT[a] - 1), true);
    assert.equal(tr.isLocked(100 + LOCKOUT[a]), false);
    const after = tr.press(a, 100 + LOCKOUT[a]);
    assert.notEqual(after.reason, 'locked', 'lockout ends exactly at t + lockout');
  }
});

test('a lockout can make the player eat the hit; a recovered player can still defend', () => {
  const tr = single('normal');
  tr.press('jump', 500); // whiff → locked until 1150
  assert.equal(tr.press('parry', 1000).reason, 'locked');
  assert.deepEqual(tr.update(1070), [], 'window still open at T+post');
  assert.deepEqual(tr.update(1071), [{ hitIndex: 0, outcome: 'hit', offset: null, action: null }]);

  const tr2 = single('normal');
  tr2.press('dodge', 500); // locked until 760
  assert.equal(tr2.press('parry', 759).reason, 'locked');
  const ok = tr2.press('parry', 950);
  assert.equal(ok.reason, 'claim');
  assert.equal(ok.outcome, 'parry');
});

test('debounce: a press within 90 ms after a claim is a double tap unless it validly defends the next hit', () => {
  const tr = new DefenseTracker({ hits: [{ t: 1000, type: 'normal' }, { t: 1180, type: 'normal' }] });
  assert.equal(tr.press('parry', 1000).reason, 'claim');
  const d = tr.press('parry', 1060); // −120 from hit 2: outside the parry window → would fail the claim
  assert.deepEqual(d, { accepted: false, claimedHit: -1, reason: 'debounce' });
  assert.equal(tr.claims[1], null, 'double tap did not claim (and fail) the next hit');
  assert.equal(tr.press('parry', 1180).reason, 'claim');
  tr.update(2000);
  assert.deepEqual(tr.results.map((r) => r.outcome), ['parry', 'parry']);

  // exactly 90 ms later is processed normally — which is why the debounce matters: without it a
  // double tap would claim (and fail) the next hit early.
  const tr2 = new DefenseTracker({ hits: [{ t: 1000, type: 'normal' }, { t: 1250, type: 'normal' }] });
  tr2.press('parry', 1000);
  assert.equal(tr2.press('parry', 1089).reason, 'debounce');
  const p = tr2.press('parry', 1090);
  assert.equal(p.reason, 'claim', 'claims hit 2 early');
  assert.equal(p.claimedHit, 1);
  assert.equal(p.outcome, 'hit', 'parry 160 ms early fails');

  // debounce applies across actions (here the second press would whiff: nothing left to claim)
  const tr3 = single('normal');
  tr3.press('parry', 990);
  assert.equal(tr3.press('dodge', 1020).reason, 'debounce');
  assert.equal(tr3.lockedUntil, -Infinity, 'a debounced press never locks');
  // … and a debounced press on a claimed-but-unresolved hit reports the debounce
  const tr4 = single('normal');
  tr4.press('dodge', 900);
  assert.equal(tr4.press('dodge', 950).reason, 'debounce');
  assert.equal(tr4.press('dodge', 995).reason, 'ignored');
});

test('debounce never eats a valid press on the next hit of a rapid burst (180–200 ms)', () => {
  // coghound Ratchet Bite: late parry on hit 3 (+30), then an early but valid parry on hit 4 (−65) 85 ms later
  const bite = new DefenseTracker({ hits: [900, 1100, 1300, 1480].map((t) => ({ t, type: 'normal' })) });
  for (const t of [900, 1100]) bite.press('parry', t);
  assert.equal(bite.press('parry', 1330).outcome, 'parry');
  const fourth = bite.press('parry', 1415);
  assert.deepEqual(fourth, { accepted: true, claimedHit: 3, reason: 'claim', offset: -65, outcome: 'parry' });
  bite.update(3000);
  assert.deepEqual(bite.results.map((r) => r.outcome), ['parry', 'parry', 'parry', 'parry']);

  // late dodge on hit 1 (+50), early dodge on hit 2 (−100) only 50 ms later
  const burst = new DefenseTracker({ hits: [{ t: 900, type: 'normal' }, { t: 1100, type: 'normal' }] });
  burst.press('dodge', 950);
  assert.equal(burst.press('dodge', 1000).outcome, 'dodge');
  burst.update(3000);
  assert.deepEqual(burst.results.map((r) => r.outcome), ['dodge', 'dodge']);

  // same timing, but the second press is invalid for the next hit type → still a double tap, the hit stays open
  const jumps = new DefenseTracker({ hits: [{ t: 900, type: 'normal' }, { t: 1100, type: 'jump' }] });
  jumps.press('dodge', 950);
  assert.equal(jumps.press('dodge', 1000).reason, 'debounce', 'a dodge cannot defend a jump hit');
  assert.equal(jumps.press('jump', 1100).outcome, 'jump', 'the real answer still gets through');

  // a debounced press that would bite a feint is ignored rather than locking the player out
  const bait = new DefenseTracker({ hits: [{ t: 1000, type: 'normal' }, { t: 1060, type: 'feint' }, { t: 1600, type: 'normal' }] });
  bait.press('parry', 1000);
  assert.equal(bait.press('parry', 1050).reason, 'debounce');
  assert.equal(bait.lockedUntil, -Infinity);

  // the exception follows the difficulty's scaled windows (Veteran's narrower parry window)
  const vet = new DefenseTracker({ hits: [{ t: 1000, type: 'normal' }, { t: 1180, type: 'normal' }], difficulty: 'veteran' });
  const w = windowsFor('veteran').parry;
  assert.equal(vet.press('parry', 1000 + w.post).outcome, 'parry', 'latest valid parry on hit 1');
  assert.ok(180 - w.pre - w.post - 1 < DEBOUNCE_MS, 'the next press lands inside the debounce window');
  assert.equal(vet.press('parry', 1180 - w.pre - 1).reason, 'debounce', 'just outside the scaled window: double tap');
  assert.equal(vet.press('parry', 1180 - w.pre).outcome, 'parry', 'the scaled window edge is honoured');
});

// Independent two-press reference model (SPEC §3.2 rules 1–4, with the rapid-burst debounce exception), written
// without sharing code with qte.js: two real hits A < B, press 1 at t1, press 2 at t2 > t1.
function referenceTwoPress(d, [typeA, typeB], TA, TB, [a1, t1], [a2, t2]) {
  const s = DIFFICULTY[d].windowScale;
  const sc = (w) => ({ pre: Math.round(w.pre * s * 10) / 10, post: Math.round(w.post * s * 10) / 10 });
  const W = {
    parry: sc({ pre: 110, post: 45 }), dodge: sc({ pre: 200, post: 70 }), perfectDodge: sc({ pre: 70, post: 30 }),
    jump: sc({ pre: 260, post: 60 }), gradient: sc({ pre: 150, post: 50 }),
  };
  const zoneOf = (type) => (type === 'jump' ? W.jump : W.dodge);
  const valid = { normal: ['parry', 'dodge'], unparryable: ['dodge'], jump: ['jump'], gradient: ['gradient', 'dodge'] };
  const judge = (type, action, off) => {
    if (!valid[type].includes(action)) return 'hit';
    const w = W[action];
    if (off < -w.pre || off > w.post) return 'hit';
    if (action === 'dodge') return off >= -W.perfectDodge.pre && off <= W.perfectDodge.post ? 'perfectDodge' : 'dodge';
    return action;
  };
  const hits = [{ T: TA, type: typeA, claim: null }, { T: TB, type: typeB, claim: null }];
  const LOCK = { parry: 380, dodge: 260, jump: 650, gradient: 450 };
  let lockedUntil = -Infinity;
  let lastClaim = null;
  const press = (action, t) => {
    if (t < lockedUntil) return 'locked';
    const debounced = lastClaim !== null && t - lastClaim < 90;
    // rule 1: earliest hit not yet resolved whose zone has not closed; a claim resolves at max(T, claim time)
    let target = null;
    for (const h of hits) {
      if (h.claim) {
        if (t >= Math.max(h.T, h.claim.t)) continue;
        return debounced ? 'debounce' : 'ignored';
      }
      if (t > h.T + zoneOf(h.type).post) continue;
      target = h;
      break;
    }
    if (target && t >= target.T - zoneOf(target.type).pre) {
      const outcome = judge(target.type, action, t - target.T);
      if (debounced && outcome === 'hit') return 'debounce';
      target.claim = { t, outcome };
      lastClaim = t;
      return 'claim';
    }
    if (debounced) return 'debounce';
    lockedUntil = t + LOCK[action];
    return 'whiff';
  };
  const reasons = [press(a1, t1), press(a2, t2)];
  return { reasons, outcomes: hits.map((h) => h.claim?.outcome ?? 'hit') };
}

test('reference model sweep: two presses on a 180/200 ms burst, every type pair × action pair × difficulty', () => {
  let checked = 0;
  let viaException = 0;
  for (const d of DIFFS) {
    for (const typeA of TYPES) {
      for (const typeB of TYPES) {
        for (const gap of [180, 200]) {
          const TA = 1000;
          const TB = TA + gap;
          for (const a1 of DEFENSE_ACTIONS) {
            for (const a2 of DEFENSE_ACTIONS) {
              for (let o1 = -240; o1 <= 120; o1 += 20) {
                for (let dt = 5; dt <= 285; dt += 20) {
                  const t1 = TA + o1;
                  const t2 = t1 + dt;
                  const exp = referenceTwoPress(d, [typeA, typeB], TA, TB, [a1, t1], [a2, t2]);
                  const tr = new DefenseTracker({ hits: [{ t: TA, type: typeA }, { t: TB, type: typeB }], difficulty: d });
                  const r1 = tr.press(a1, t1);
                  const r2 = tr.press(a2, t2);
                  tr.update(TB + 5000);
                  const label = `${d} ${typeA}/${typeB} gap ${gap} ${a1}@${o1} ${a2}@+${dt}`;
                  assert.deepEqual([r1.reason, r2.reason], exp.reasons, `${label}: reasons`);
                  assert.deepEqual(tr.results.map((x) => x.outcome), exp.outcomes, `${label}: outcomes`);
                  if (r2.reason === 'claim' && dt < DEBOUNCE_MS && r1.reason === 'claim') viaException++;
                  checked++;
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 200000, `${checked} cases`);
  assert.ok(viaException > 1000, `the burst exception is exercised (${viaException} cases)`);
});

test('first claim decides; presses on a claimed-but-unresolved hit are ignored', () => {
  const tr = single('normal');
  const early = tr.press('parry', 820); // −180: inside the claim zone, outside parry → 'hit'
  assert.equal(early.reason, 'claim');
  assert.equal(early.outcome, 'hit');
  const retry = tr.press('parry', 990);
  assert.deepEqual(retry, { accepted: false, claimedHit: -1, reason: 'ignored' });
  assert.equal(tr.lockedUntil, -Infinity, 'ignored presses never lock');
  tr.update(1000);
  assert.equal(tr.results[0].outcome, 'hit');
  assert.equal(tr.results[0].offset, -180);
  // at T the claimed hit has resolved, so a further press looks for the next hit (none → whiff)
  assert.equal(tr.press('parry', 1000).reason, 'whiff');

  const tr2 = single('normal');
  tr2.press('dodge', 850);
  assert.equal(tr2.press('dodge', 960).reason, 'ignored');
  tr2.update(1000);
  assert.equal(tr2.results[0].outcome, 'dodge');
});

test('resolution timing: claimed at max(T, claimTime), unclaimed just after T + post', () => {
  const early = single('normal');
  early.press('parry', 950);
  assert.deepEqual(early.update(999), []);
  assert.equal(early.results[0], null);
  assert.deepEqual(early.update(1000), [{ hitIndex: 0, outcome: 'parry', offset: -50, action: 'parry' }]);
  assert.deepEqual(early.update(1100), [], 'resolved hits are reported once');

  const late = single('normal');
  assert.deepEqual(late.update(1030), []);
  late.press('parry', 1040);
  assert.deepEqual(late.update(1040), [{ hitIndex: 0, outcome: 'parry', offset: 40, action: 'parry' }]);

  const none = single('normal');
  assert.equal(none.unclaimedResolveTime(0), 1070);
  assert.deepEqual(none.update(1070), []);
  assert.deepEqual(none.update(1070.5), [{ hitIndex: 0, outcome: 'hit', offset: null, action: null }]);

  const jump = single('jump');
  assert.equal(jump.unclaimedResolveTime(0), 1060);
  assert.equal(jump.endTime, 1060);

  // a press arriving before update() is still honoured at the inclusive edge
  const edge = single('normal');
  edge.press('dodge', 1070);
  assert.equal(edge.update(1071)[0].outcome, 'dodge');
});

test('press() is deterministic even if update() was never called', () => {
  const hits = [{ t: 1000, type: 'normal' }, { t: 1180, type: 'normal' }];
  const a = new DefenseTracker({ hits });
  a.press('dodge', 850); // claims hit 0
  a.press('dodge', 1030); // hit 0 already resolved at 1000 → claims hit 1 (−150)
  const b = new DefenseTracker({ hits });
  b.press('dodge', 850);
  b.update(1000);
  b.press('dodge', 1030);
  assert.deepEqual(a.claims, b.claims);
  a.update(5000);
  b.update(5000);
  assert.deepEqual(a.results, b.results);
  assert.deepEqual(a.results.map((r) => r.outcome), ['dodge', 'dodge']);
});

test('feints: no window, pressing into a feint is a whiff, and they never resolve', () => {
  const tr = new DefenseTracker({ hits: [{ t: 900, type: 'feint' }, { t: 1500, type: 'normal' }] });
  const bait = tr.press('parry', 900);
  assert.equal(bait.reason, 'whiff');
  assert.equal(bait.feintHit, 0);
  assert.equal(bait.accepted, true, 'the parry animation still plays');
  assert.equal(tr.lockedUntil, 900 + LOCKOUT.parry);
  assert.equal(tr.press('parry', 1200).reason, 'locked');
  const real = tr.press('parry', 1500);
  assert.equal(real.reason, 'claim');
  assert.equal(real.claimedHit, 1);
  tr.update(3000);
  assert.equal(tr.results[0], null, 'feints never resolve');
  assert.equal(tr.results[1].outcome, 'parry');
  assert.equal(tr.isDone(), true);

  // not pressing a feint at all is fine
  const calm = new DefenseTracker({ hits: [{ t: 900, type: 'feint' }, { t: 1500, type: 'normal' }] });
  calm.press('dodge', 1490);
  calm.update(1600);
  assert.equal(calm.results[1].outcome, 'perfectDodge');
});

test('feint right before a real hit: the nearer one takes the press (ties favour the real hit)', () => {
  const hits = [{ t: 1000, type: 'feint' }, { t: 1180, type: 'normal' }];
  const fooled = new DefenseTracker({ hits });
  const r = fooled.press('dodge', 1000); // real hit is only −180 away (inside its dodge window!)
  assert.equal(r.reason, 'whiff');
  assert.equal(r.feintHit, 0);
  assert.equal(fooled.press('dodge', 1180).reason, 'locked');
  fooled.update(2000);
  assert.equal(fooled.results[1].outcome, 'hit');

  const read = new DefenseTracker({ hits });
  const r2 = read.press('dodge', 1100); // 100 from feint, 80 from real
  assert.equal(r2.reason, 'claim');
  assert.equal(r2.outcome, 'dodge');

  const tie = new DefenseTracker({ hits });
  assert.equal(tie.press('dodge', 1090).reason, 'claim');

  // feint after a real hit: late presses past the real window are whiffs
  const after = new DefenseTracker({ hits: [{ t: 1000, type: 'normal' }, { t: 1150, type: 'feint' }, { t: 1600, type: 'normal' }] });
  assert.equal(after.press('dodge', 1060).reason, 'claim', 'nearer the real hit');
  const late = new DefenseTracker({ hits: [{ t: 1000, type: 'normal' }, { t: 1150, type: 'feint' }, { t: 1600, type: 'normal' }] });
  const lr = late.press('parry', 1100);
  assert.equal(lr.reason, 'whiff');
  assert.equal(lr.feintHit, 1);
});

test('multi-hit combos 180 ms apart', () => {
  const combo = () => new DefenseTracker({ hits: [1000, 1180, 1360].map((t) => ({ t, type: 'normal' })) });

  const perfect = combo();
  const seen = [];
  for (const t of [1000, 1180, 1360]) {
    assert.equal(perfect.press('parry', t).reason, 'claim');
    seen.push(...perfect.update(t));
  }
  assert.deepEqual(seen.map((r) => [r.hitIndex, r.outcome]), [[0, 'parry'], [1, 'parry'], [2, 'parry']]);
  assert.equal(perfect.isDone(), true);

  const sloppy = combo();
  for (const t of [990, 1200, 1340]) sloppy.press('parry', t);
  sloppy.update(2000);
  assert.deepEqual(sloppy.results.map((r) => r.outcome), ['parry', 'parry', 'parry']);
  assert.deepEqual(sloppy.results.map((r) => r.offset), [-10, 20, -20]);

  const earlyDodger = combo();
  for (const t of [850, 1030, 1210]) assert.equal(earlyDodger.press('dodge', t).reason, 'claim');
  earlyDodger.update(2000);
  assert.deepEqual(earlyDodger.results.map((r) => r.outcome), ['dodge', 'dodge', 'dodge']);

  const missedMiddle = combo();
  missedMiddle.press('parry', 1000);
  missedMiddle.press('parry', 1360);
  assert.deepEqual(missedMiddle.update(1250).map((r) => [r.hitIndex, r.outcome]), [[0, 'parry']], 'hit 1 window still open at T+post');
  assert.deepEqual(missedMiddle.update(1251).map((r) => [r.hitIndex, r.outcome]), [[1, 'hit']]);
  missedMiddle.update(1360);
  assert.equal(missedMiddle.results[2].outcome, 'parry');

  const lateOnFirst = combo();
  const l = lateOnFirst.press('parry', 1060); // hit 0 zone still open → claims hit 0, too late for parry
  assert.equal(l.claimedHit, 0);
  assert.equal(l.outcome, 'hit');

  const jumps = new DefenseTracker({ hits: [{ t: 1000, type: 'jump' }, { t: 1180, type: 'jump' }, { t: 1400, type: 'unparryable' }] });
  jumps.press('jump', 1000);
  jumps.press('jump', 1180);
  jumps.press('dodge', 1400);
  jumps.update(3000);
  assert.deepEqual(jumps.results.map((r) => r.outcome), ['jump', 'jump', 'perfectDodge']);

  // mashing a single action is punished by lockouts
  const masher = combo();
  for (let t = 600; t <= 1450; t += 50) masher.press('parry', t);
  masher.update(3000);
  assert.ok(masher.results.some((r) => r.outcome === 'hit'), 'mashing parry fails at least one hit');
});

test('update() returns resolutions in timeline order; hits may be given unsorted', () => {
  const tr = new DefenseTracker({ hits: [{ t: 1180, type: 'normal' }, { t: 1000, type: 'jump' }] });
  const r = tr.press('jump', 1000);
  assert.equal(r.claimedHit, 1, 'original indices are preserved');
  tr.press('parry', 1180);
  const out = tr.update(5000);
  assert.deepEqual(out.map((x) => x.hitIndex), [1, 0]);
  assert.equal(tr.nextHitIndex(), -1);
});

test('calibration is subtracted from press times', () => {
  const late = single('normal', { calibration: 30 });
  const r = late.press('parry', 1030);
  assert.equal(r.offset, 0);
  assert.equal(r.outcome, 'parry');
  assert.equal(judgeOnce('normal', 'parry', 75, { calibration: 30 }).result.outcome, 'parry', '75 raw = 45 judged');
  assert.equal(judgeOnce('normal', 'parry', 76, { calibration: 30 }).result.outcome, 'hit');
  assert.equal(late.unclaimedResolveTime(0), 1100);
  const lateNone = single('normal', { calibration: 30 });
  assert.deepEqual(lateNone.update(1090), [], 'a calibrated-late player may still press');
  assert.equal(lateNone.update(1101)[0].outcome, 'hit');

  const earlyCal = single('normal', { calibration: -40 });
  assert.equal(earlyCal.press('parry', 960).offset, 0);
  const earlyNone = single('normal', { calibration: -40 });
  assert.equal(earlyNone.unclaimedResolveTime(0), 1030);
  const huge = single('normal', { calibration: -150 });
  assert.equal(huge.unclaimedResolveTime(0), 1000, 'never resolves before impact');
  assert.deepEqual(huge.update(999), []);
  assert.equal(huge.update(1000)[0].outcome, 'hit');

  // lockouts and debounce are measured on the caller's (raw) clock
  const lock = single('normal', { calibration: 50 });
  lock.press('parry', 0);
  assert.equal(lock.lockedUntil, LOCKOUT.parry);

  const off = new OffenseTracker({ prompts: [{ t: 1000 }], calibration: 20 });
  const p = off.press(1020);
  assert.equal(p.rating, 'perfect');
  assert.equal(p.offset, 0);
});

test('invalid input is ignored without side effects', () => {
  const tr = single('normal');
  assert.deepEqual(tr.press('qte', 1000), { accepted: false, claimedHit: -1, reason: 'ignored' });
  assert.deepEqual(tr.press('confirm', 1000), { accepted: false, claimedHit: -1, reason: 'ignored' });
  assert.deepEqual(tr.press('parry', NaN), { accepted: false, claimedHit: -1, reason: 'ignored' });
  assert.equal(tr.lockedUntil, -Infinity);
  assert.equal(tr.press('parry', 1000).reason, 'claim');
  assert.equal(tr.pressHistory.length, 4);
  assert.deepEqual(tr.update(NaN), []);
  const empty = new DefenseTracker({ hits: [] });
  assert.equal(empty.isDone(), true);
  assert.equal(empty.press('parry', 0).reason, 'whiff');
});

test('isDone tracks every non-feint hit', () => {
  const tr = new DefenseTracker({ hits: [{ t: 1000, type: 'normal' }, { t: 1400, type: 'feint' }, { t: 1800, type: 'jump' }] });
  assert.equal(tr.isDone(), false);
  tr.update(1100);
  assert.equal(tr.isDone(), false);
  assert.equal(tr.nextHitIndex(), 2);
  tr.update(1861);
  assert.equal(tr.isDone(), true);
  assert.equal(tr.results[1], null);
});

test('OffenseTracker: perfect/good edges, whiffs and lockout', () => {
  const rate = (off, difficulty) => {
    const tr = new OffenseTracker({ prompts: [{ t: 1000 }], difficulty });
    return tr.press(1000 + off);
  };
  assert.equal(rate(0).rating, 'perfect');
  assert.equal(rate(55).rating, 'perfect');
  assert.equal(rate(-55).rating, 'perfect');
  assert.equal(rate(56).rating, 'good');
  assert.equal(rate(-56).rating, 'good');
  assert.equal(rate(130).rating, 'good');
  assert.equal(rate(-130).rating, 'good');
  const w = rate(131);
  assert.deepEqual(w, { accepted: true, claimedPrompt: -1, reason: 'whiff', lockedUntil: 1131 + 250 });
  assert.equal(rate(-131).reason, 'whiff');
  // difficulty scales offense windows
  assert.equal(rate(90, 'story').rating, 'perfect');
  assert.equal(rate(220, 'story').rating, 'good');
  assert.equal(rate(40, 'veteran').rating, 'good');
  assert.equal(rate(95, 'veteran').reason, 'whiff');
  // lockout is 250 ms and not scaled
  for (const d of DIFFS) {
    const tr = new OffenseTracker({ prompts: [{ t: 1000 }], difficulty: d });
    tr.press(500);
    assert.equal(tr.lockedUntil, 750, d);
    assert.equal(tr.press(749).reason, 'locked');
    assert.equal(tr.press(750).reason, 'whiff');
  }
  // whiff lockout can cost the prompt its perfect
  const tr = new OffenseTracker({ prompts: [{ t: 1000 }] });
  tr.press(800);
  assert.equal(tr.press(1000).reason, 'locked');
  const late = tr.press(1060);
  assert.equal(late.rating, 'good');
});

test('OffenseTracker: resolution timing, judged once, debounce, combos', () => {
  const tr = new OffenseTracker({ prompts: [{ t: 1000 }] });
  assert.deepEqual(tr.update(1130), []);
  assert.deepEqual(tr.update(1131), [{ promptIndex: 0, rating: 'miss', offset: null }]);
  assert.equal(tr.isDone(), true);

  const early = new OffenseTracker({ prompts: [{ t: 1000 }] });
  early.press(950);
  assert.deepEqual(early.update(999), []);
  assert.deepEqual(early.update(1000), [{ promptIndex: 0, rating: 'perfect', offset: -50 }]);

  const once = new OffenseTracker({ prompts: [{ t: 1000 }] });
  once.press(1000);
  const again = once.press(1100);
  assert.deepEqual(again, { accepted: false, claimedPrompt: -1, reason: 'ignored' });
  assert.equal(once.lockedUntil, -Infinity, 'pressing inside a judged prompt is not a whiff');

  const combo = new OffenseTracker({ prompts: [{ t: 1000 }, { t: 1180 }, { t: 1360 }] });
  combo.press(1000);
  assert.equal(combo.press(1060).reason, 'debounce', 'double tap does not steal prompt 2');
  combo.press(1180);
  combo.press(1350);
  combo.update(2000);
  assert.deepEqual(combo.results.map((r) => r.rating), ['perfect', 'perfect', 'perfect']);

  const overlap = new OffenseTracker({ prompts: [{ t: 1000 }, { t: 1150 }] });
  const first = overlap.press(1090);
  assert.equal(first.claimedPrompt, 0, 'earliest unjudged prompt wins');
  assert.equal(first.rating, 'good');
  assert.equal(overlap.press(1150).reason, 'debounce', 'a second press 60 ms later is a double tap');
  const second = overlap.press(1185);
  assert.equal(second.claimedPrompt, 1);
  assert.equal(second.rating, 'perfect');

  const skipped = new OffenseTracker({ prompts: [{ t: 1000 }, { t: 1400 }] });
  skipped.update(1200);
  assert.equal(skipped.results[0].rating, 'miss');
  assert.equal(skipped.press(1400).claimedPrompt, 1);
  assert.equal(skipped.unclaimedResolveTime(1), 1530);
  assert.deepEqual(new OffenseTracker({ prompts: [] }).isDone(), true);
  assert.equal(skipped.press(NaN).reason, 'ignored');
});

test('judgeOffense, qteMultiplier, describeOffset', () => {
  assert.equal(judgeOffense(0), 'perfect');
  assert.equal(judgeOffense(-55), 'perfect');
  assert.equal(judgeOffense(56), 'good');
  assert.equal(judgeOffense(130), 'good');
  assert.equal(judgeOffense(131), 'miss');
  assert.equal(judgeOffense(NaN), 'miss');
  assert.equal(judgeOffense(90, windowsFor('story')), 'perfect');
  assert.equal(judgeOffense(90, windowsFor('story').offense), 'perfect');
  assert.equal(qteMultiplier('perfect'), 1.4);
  assert.equal(qteMultiplier('good'), 1.15);
  assert.equal(qteMultiplier('miss'), 1.0);
  assert.equal(qteMultiplier(null), 1.0);
  assert.equal(describeOffset(-34), '34 ms early');
  assert.equal(describeOffset(-34.4), '34 ms early');
  assert.equal(describeOffset(12.6), '13 ms late');
  assert.equal(describeOffset(0), 'on time');
  assert.equal(describeOffset(-0.4), 'on time');
  assert.equal(describeOffset(null), '');
  assert.equal(describeOffset(undefined), '');
});

test('perfectAction and isAvoided', () => {
  assert.equal(perfectAction('normal'), 'parry');
  assert.equal(perfectAction('unparryable'), 'dodge');
  assert.equal(perfectAction('jump'), 'jump');
  assert.equal(perfectAction('gradient'), 'gradient');
  assert.equal(perfectAction('feint'), null);
  for (const type of TYPES) {
    const a = perfectAction(type);
    assert.ok(VALID_DEFENSES[type].includes(a));
    assert.ok(isAvoided(judgeOnce(type, a, 0).result.outcome));
  }
  assert.equal(isAvoided('hit'), false);
  assert.equal(isAvoided(null), false);
  assert.equal(isAvoided('perfectDodge'), true);
});

test('AttackClock maps real timestamps through hit-stop slowdowns', () => {
  const c = new AttackClock(1000);
  assert.equal(c.toLocal(1000), 0);
  assert.equal(c.toLocal(1500), 500);
  c.setScale(0.05, 1500); // hit-stop starts
  assert.equal(c.scale, 0.05);
  assert.equal(c.toLocal(1570), 503.5);
  c.setScale(1, 1570);
  assert.equal(c.toLocal(1670), 603.5);
  assert.equal(c.toLocal(1520), 501, 'presses during the hit-stop map into it');
  assert.equal(c.toLocal(900), -100, 'before start extrapolates');
  // feeding a tracker in local time keeps judging correct across the stop
  const tr = new DefenseTracker({ hits: [{ t: 500, type: 'normal' }, { t: 680, type: 'normal' }] });
  tr.press('parry', c.toLocal(1500));
  tr.update(c.toLocal(1500));
  assert.equal(c.toLocal(1746.5), 680);
  tr.press('parry', c.toLocal(1746.5)); // local 680
  tr.update(c.toLocal(1800));
  assert.deepEqual(tr.results.map((r) => r.outcome), ['parry', 'parry']);
});
