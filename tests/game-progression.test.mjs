// Tests for src/game/progression.js: XP curve, level-up math, derived stats with relics, echo capacity/load.
// Run: node --test tests/game-*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  xpToNext, totalXpForLevel, spForLevel, derivedStats, baseStats, statBreakdown, relicStatBonus, grantXp,
  echoCapacity, echoLoad, MAX_LEVEL, MAX_CRIT, ATTRS, ATTR_INFO,
} from '../src/game/progression.js';
import { RELICS } from '../src/data/relics.js';

const member = (over = {}) => ({
  id: 'gideon', level: 1, xp: 0, attrs: { vitality: 0, might: 0, agility: 0, defense: 0, luck: 0 },
  attrPoints: 0, sp: 0, skills: [], relics: [null, null, null], echoes: [], hp: 420, alive: true, ...over,
});

test('xpToNext = round(60 × level^1.6)', () => {
  assert.equal(xpToNext(1), 60);
  assert.equal(xpToNext(2), Math.round(60 * 2 ** 1.6));
  assert.equal(xpToNext(10), Math.round(60 * 10 ** 1.6));
  assert.equal(xpToNext(0), 60, 'clamped to level 1');
  assert.equal(totalXpForLevel(1), 0);
  assert.equal(totalXpForLevel(3), xpToNext(1) + xpToNext(2));
});

test('spForLevel gives +2 at 5/10/15', () => {
  assert.deepEqual([2, 4, 5, 6, 10, 15, 16].map(spForLevel), [1, 1, 2, 1, 2, 2, 1]);
});

test('derivedStats follows the §3.3 formulas', () => {
  const m = member({ level: 4, attrs: { vitality: 2, might: 3, agility: 4, defense: 2, luck: 5 } });
  const s = derivedStats(m);
  assert.equal(s.maxHp, Math.round(420 + 3 * 105 + 2 * 25));
  assert.equal(s.atk, Math.round(34 + 3 * 4.3 + 3 * 3));
  assert.equal(s.def, Math.round(22 + 3 * 2.8 + 2 * 2.5));
  assert.equal(s.spd, Math.round(40 + 3 * 0.6 + 4 * 1.5));
  assert.equal(s.crit, 0.1);
});

test('relic flat stats are included; relics:{} ignores them', () => {
  const m = member({ relics: ['tidal_charm', 'riposte_pin', 'shatterglass'] });
  const s = derivedStats(m);
  assert.equal(s.maxHp, 420 + 40);
  assert.equal(s.atk, 34 + 2);
  assert.equal(s.def, 22 + 2);
  assert.equal(s.crit, 0.08);
  assert.deepEqual(derivedStats(m, { relics: {} }), baseStats(m));
  assert.deepEqual(relicStatBonus(m), { hp: 40, atk: 2, def: 2, spd: 0, crit: 0.03 });
  const b = statBreakdown(m);
  assert.equal(b.maxHp.base, 420);
  assert.equal(b.maxHp.relics, 40);
  assert.equal(b.maxHp.total, 460);
  // duplicate/unknown relic ids never stack or crash
  assert.deepEqual(relicStatBonus(member({ relics: ['tidal_charm', 'tidal_charm', 'nope'] })).hp, 40);
});

test('crit is capped at 60%', () => {
  const m = member({ id: 'sable', attrs: { vitality: 0, might: 0, agility: 0, defense: 0, luck: 80 }, relics: ['glass_rose'] });
  assert.equal(derivedStats(m).crit, MAX_CRIT);
});

test('grantXp: single level-up grants 3 attribute points and 1 SP and raises HP', () => {
  const m = member();
  const ups = grantXp(m, 70);
  assert.deepEqual(ups, [{ level: 2, attrPoints: 3, sp: 1 }]);
  assert.equal(m.level, 2);
  assert.equal(m.xp, 10);
  assert.equal(m.attrPoints, 3);
  assert.equal(m.sp, 1);
  assert.equal(m.hp, 420 + 105, 'current HP rises by the max-HP gained');
});

test('grantXp: multi-level jump with the +2 SP bonus at level 5', () => {
  const m = member({ hp: 100 });
  const need = totalXpForLevel(6);
  const ups = grantXp(m, need + 5);
  assert.deepEqual(ups.map((u) => u.level), [2, 3, 4, 5, 6]);
  assert.equal(ups.find((u) => u.level === 5).sp, 2);
  assert.equal(m.level, 6);
  assert.equal(m.xp, 5);
  assert.equal(m.attrPoints, 15);
  assert.equal(m.sp, 6);
  assert.equal(m.hp, 100 + 5 * 105);
});

test('grantXp: KO\'d members do not gain HP; invalid amounts are ignored; level cap', () => {
  const ko = member({ hp: 0, alive: false });
  grantXp(ko, 1000);
  assert.equal(ko.hp, 0);
  const m = member();
  assert.deepEqual(grantXp(m, -50), []);
  assert.deepEqual(grantXp(m, NaN), []);
  assert.equal(m.xp, 0);
  const top = member({ level: 19, xp: 0 });
  const ups = grantXp(top, 1e9);
  assert.deepEqual(ups.map((u) => u.level), [20]);
  assert.equal(top.level, MAX_LEVEL);
  assert.equal(top.xp, 0);
  assert.deepEqual(grantXp(top, 500), []);
});

test('echo capacity and load', () => {
  assert.equal(echoCapacity(1), 5);
  assert.equal(echoCapacity(12), 16);
  const m = member({ echoes: ['dawn_locket', 'marksmans_eye'] });
  assert.equal(echoLoad(m), RELICS.dawn_locket.echoCost + RELICS.marksmans_eye.echoCost);
  assert.equal(echoLoad(member({ echoes: ['dawn_locket', 'dawn_locket', 'bogus'] })), RELICS.dawn_locket.echoCost);
  assert.equal(echoLoad({}), 0);
});

test('attribute metadata matches formulas', () => {
  assert.deepEqual(ATTRS, ['vitality', 'might', 'agility', 'defense', 'luck']);
  assert.equal(ATTR_INFO.vitality.perPoint, 25);
  assert.equal(ATTR_INFO.might.perPoint, 3);
  assert.equal(ATTR_INFO.defense.perPoint, 2.5);
  assert.equal(ATTR_INFO.agility.perPoint, 1.5);
  assert.equal(ATTR_INFO.luck.perPoint, 0.01);
});

test('unknown character ids fall back safely', () => {
  const orig = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const s = derivedStats({ id: 'ghost', level: 3 });
    assert.ok(s.maxHp > 0 && s.atk > 0);
    derivedStats({ id: 'ghost', level: 3 });
    assert.equal(warned, 1, 'warns once');
  } finally {
    console.warn = orig;
  }
});
