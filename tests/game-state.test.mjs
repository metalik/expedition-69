// Tests for src/game/gameState.js: new game, battle hand-off, rewards, flags, attributes, skills, relics & echoes,
// items, loot, shops, serialization and storage. Run: node --test tests/game-*.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createNewGame, toBattleParty, applyBattleResult, applyPostBattleHp, restAtFlag, visitFlag, allocateAttr, learnSkill,
  equipRelic, equipEcho, unequipEcho, useItemOutOfBattle, canUseItemOutOfBattle, addLoot, buy, shopView, serialize,
  deserialize, saveGame, loadGame, hasSave, deleteSave, skillsFor, autoAllocate, describeRelic, partyMemberView,
  getMember, collectPassives, relicInventory, echoOptions, grantPartyXp, markDefeated, addPlayTime, SAVE_KEY,
  postBattleRecoveryFor, POST_BATTLE_RECOVERY,
} from '../src/game/gameState.js';
import { derivedStats, xpToNext, totalXpForLevel, echoCapacity } from '../src/game/progression.js';
import { CHARACTERS, PARTY_ORDER } from '../src/data/characters.js';
import { SKILLS } from '../src/data/skills.js';
import { RELICS, DUPE_GLINT, MASTERY_BATTLES } from '../src/data/relics.js';
import { SHOPS } from '../src/data/shops.js';

const victory = (over = {}) => ({
  outcome: 'victory', xp: 0, glint: 0, drops: [],
  party: PARTY_ORDER.map((id) => ({ id, hp: 100, alive: true })),
  stats: { parries: 0, perfectDodges: 0, dodges: 0, jumps: 0, gradientCounters: 0, perfects: 0, hitsTaken: 0, turns: 5 },
  ...over,
});
const maxHp = (state, id) => derivedStats(getMember(state, id)).maxHp;

// ───────────────────────── new game & battle party ─────────────────────────

test('createNewGame builds the spec state', () => {
  const s = createNewGame({ seed: 1234 });
  assert.equal(s.version, 1);
  assert.equal(s.seed, 1234);
  assert.deepEqual(s.party.map((m) => m.id), PARTY_ORDER);
  for (const m of s.party) {
    assert.equal(m.level, 1);
    assert.equal(m.xp, 0);
    assert.deepEqual(m.attrs, { vitality: 0, might: 0, agility: 0, defense: 0, luck: 0 });
    assert.equal(m.attrPoints, 0);
    assert.deepEqual(m.skills, CHARACTERS[m.id].startingSkills);
    assert.equal(m.relics.length, 3);
    assert.deepEqual(m.echoes, []);
    assert.equal(m.hp, derivedStats(m).maxHp);
    assert.equal(m.alive, true);
  }
  assert.deepEqual(s.party.map((m) => m.relics[0]), ['riposte_pin', 'mending_quill', 'opening_gambit']);
  assert.deepEqual(Object.keys(s.relics).sort(), ['mending_quill', 'opening_gambit', 'riposte_pin']);
  for (const r of Object.values(s.relics)) assert.deepEqual(r, { battles: 0, mastered: false });
  assert.deepEqual(s.items, { tincture: { count: 4, max: 4 }, tonic: { count: 2, max: 2 }, draught: { count: 2, max: 2 } });
  assert.equal(s.glint, 0);
  assert.equal(s.world.zone, 'shore');
  assert.equal(s.world.x, 0);
  assert.equal(s.world.y, 0);
  assert.equal(s.world.lastFlag, null);
  for (const k of ['defeated', 'bosses', 'chests', 'journals', 'flagsVisited', 'story', 'hintsSeen']) assert.deepEqual(s.world[k], {});
  for (const k of ['battles', 'victories', 'parries', 'perfectDodges', 'perfects', 'playTimeMs', 'deaths']) assert.equal(s.stats[k], 0);
  assert.ok(Number.isInteger(createNewGame().seed));
});

test('toBattleParty exports the PartySnapshot shape with effective stats', () => {
  const s = createNewGame({ seed: 1 });
  addLoot(s, { relic: 'tidal_charm' });
  equipRelic(s, 'gideon', 1, 'tidal_charm');
  getMember(s, 'nyra').hp = 123;
  const party = toBattleParty(s);
  assert.equal(party.length, 3);
  const g = party[0];
  assert.equal(g.id, 'gideon');
  assert.equal(g.name, 'Gideon Marchal');
  assert.equal(g.look, 'gideon');
  assert.equal(g.level, 1);
  assert.deepEqual(g.stats, { maxHp: 420 + 40, atk: 36, def: 24, spd: 40, crit: 0.05 });
  assert.equal(g.hp, 460);
  assert.equal(g.alive, true);
  assert.deepEqual(g.skills, ['rivet_barrage', 'arc_discharge']);
  assert.equal(g.gradientSkill, 'thunderhead_oath');
  assert.equal(g.mechanic, 'surge');
  assert.equal(g.shotElement, 'lightning');
  assert.deepEqual(g.basicAttack, CHARACTERS.gideon.basicAttack);
  assert.notEqual(g.basicAttack, CHARACTERS.gideon.basicAttack, 'basic attack is a copy');
  assert.deepEqual(g.passives.map((p) => [p.id, p.source]), [['counterPower', 'riposte_pin'], ['parryHeal', 'tidal_charm']]);
  assert.equal(party[1].hp, 123);
  assert.equal(party[1].mechanic, 'glyphs');
  assert.equal(party[2].mechanic, 'stance');
  // mutating the snapshot never touches the data tables
  g.passives[0].params.mult = 99;
  assert.equal(RELICS.riposte_pin.passive.params.mult, 1.5);
});

test('toBattleParty de-duplicates echoes against equipped relics', () => {
  const s = createNewGame({ seed: 1 });
  s.relics.riposte_pin.mastered = true;
  addLoot(s, { relic: 'dawn_locket' });
  s.relics.dawn_locket.mastered = true;
  getMember(s, 'gideon').echoes = ['riposte_pin', 'dawn_locket', 'dawn_locket'];
  getMember(s, 'sable').echoes = ['riposte_pin'];
  const [g, , sb] = toBattleParty(s);
  assert.deepEqual(g.passives.map((p) => `${p.from}:${p.source}`), ['relic:riposte_pin', 'echo:dawn_locket']);
  assert.deepEqual(sb.passives.map((p) => `${p.from}:${p.source}`), ['relic:opening_gambit', 'echo:riposte_pin']);
  // an echo whose relic is not mastered is ignored
  s.relics.dawn_locket.mastered = false;
  assert.deepEqual(collectPassives(getMember(s, 'gideon'), s).map((p) => p.source), ['riposte_pin']);
});

test('toBattleParty marks KO\'d members', () => {
  const s = createNewGame({ seed: 1 });
  const n = getMember(s, 'nyra');
  n.hp = 0;
  n.alive = false;
  const p = toBattleParty(s)[1];
  assert.equal(p.alive, false);
  assert.equal(p.hp, 0);
});

// ───────────────────────── battle results ─────────────────────────

test('applyBattleResult: HP write-back, KO → 1 HP, +20% max HP', () => {
  const s = createNewGame({ seed: 1 });
  const res = applyBattleResult(s, victory({
    party: [{ id: 'gideon', hp: 200, alive: true }, { id: 'nyra', hp: 0, alive: false }, { id: 'sable', hp: 339, alive: true }],
  }));
  assert.equal(res.outcome, 'victory');
  assert.equal(getMember(s, 'gideon').hp, 200 + Math.round(0.2 * maxHp(s, 'gideon')));
  assert.equal(getMember(s, 'nyra').hp, 1 + Math.round(0.2 * maxHp(s, 'nyra')));
  assert.equal(getMember(s, 'nyra').alive, true);
  assert.equal(getMember(s, 'sable').hp, maxHp(s, 'sable'), 'capped at max');
});

test('applyBattleResult: XP to alive members, half to KO\'d, level-ups & new skills', () => {
  const s = createNewGame({ seed: 1 });
  const xp = totalXpForLevel(3) + 10; // enough for level 3 (unlocks level-2 and level-3 skills)
  const res = applyBattleResult(s, victory({
    xp,
    party: [{ id: 'gideon', hp: 50, alive: true }, { id: 'nyra', hp: 0, alive: false }, { id: 'sable', hp: 80, alive: true }],
  }));
  assert.equal(res.xpGained, xp);
  assert.deepEqual(res.xpByMember, { gideon: xp, nyra: Math.floor(xp / 2), sable: xp });
  assert.equal(getMember(s, 'gideon').level, 3);
  assert.equal(getMember(s, 'sable').level, 3);
  assert.equal(getMember(s, 'nyra').level, 2);
  assert.deepEqual(res.levelUps.filter((u) => u.id === 'gideon'), [
    { id: 'gideon', level: 2, attrPoints: 3, sp: 1 },
    { id: 'gideon', level: 3, attrPoints: 3, sp: 1 },
  ]);
  assert.equal(getMember(s, 'gideon').attrPoints, 6);
  assert.equal(getMember(s, 'gideon').sp, 2);
  const newFor = (id) => res.newSkillsAvailable.filter((x) => x.id === id).map((x) => x.skillId).sort();
  assert.deepEqual(newFor('gideon'), ['breach_strike', 'galvanic_relay']);
  assert.deepEqual(newFor('nyra'), ['rime_script']);
  assert.deepEqual(newFor('sable'), ['calling_card', 'fleche']);
  assert.equal(s.stats.battles, 1);
  assert.equal(s.stats.victories, 1);
});

test('applyBattleResult: xpByMember overrides the shared XP (object or array form)', () => {
  const s = createNewGame({ seed: 1 });
  const res = applyBattleResult(s, victory({ xp: 999, xpByMember: { gideon: 10, nyra: 20, sable: 30 } }));
  assert.deepEqual(res.xpByMember, { gideon: 10, nyra: 20, sable: 30 });
  assert.deepEqual(s.party.map((m) => m.xp), [10, 20, 30]);
  const s2 = createNewGame({ seed: 1 });
  applyBattleResult(s2, victory({ xpByMember: [{ id: 'gideon', xp: 5 }, { id: 'sable', xp: 7 }], xp: 40 }));
  assert.deepEqual(s2.party.map((m) => m.xp), [5, 40, 7]);
});

test('applyBattleResult: glint, drops and duplicate conversion', () => {
  const s = createNewGame({ seed: 1 });
  const res = applyBattleResult(s, victory({ glint: 55, drops: ['tidal_charm', 'riposte_pin', { relic: 'glass_rose' }, 'tidal_charm', 'bogus'] }));
  assert.deepEqual(res.drops, ['tidal_charm', 'glass_rose']);
  assert.deepEqual(res.converted, [
    { id: 'riposte_pin', glint: DUPE_GLINT.common },
    { id: 'tidal_charm', glint: DUPE_GLINT.common },
  ]);
  assert.equal(res.glint, 55 + 2 * DUPE_GLINT.common);
  assert.equal(s.glint, res.glint);
  assert.deepEqual(s.relics.tidal_charm, { battles: 0, mastered: false }, 'drops do not count the battle they dropped in');
  assert.ok(s.relics.glass_rose);
});

test('applyBattleResult: relic mastery after 4 victories → echo available', () => {
  const s = createNewGame({ seed: 1 });
  for (let i = 1; i < MASTERY_BATTLES; i++) {
    const r = applyBattleResult(s, victory());
    assert.deepEqual(r.mastered, []);
  }
  assert.equal(s.relics.riposte_pin.battles, 3);
  assert.equal(equipEcho(s, 'nyra', 'riposte_pin').ok, false);
  const r = applyBattleResult(s, victory());
  assert.deepEqual(r.mastered.sort(), ['mending_quill', 'opening_gambit', 'riposte_pin']);
  assert.equal(s.relics.riposte_pin.mastered, true);
  assert.equal(applyBattleResult(s, victory()).mastered.length, 0, 'mastery is reported once');
  assert.equal(equipEcho(s, 'nyra', 'riposte_pin').ok, true);
  // unequipped relics do not progress
  addLoot(s, { relic: 'ember_edge' });
  applyBattleResult(s, victory());
  assert.equal(s.relics.ember_edge.battles, 0);
});

test('applyBattleResult: flee and defeat only write back HP and counters', () => {
  const s = createNewGame({ seed: 1 });
  const fled = applyBattleResult(s, victory({ outcome: 'fled', xp: 500, glint: 100, drops: ['tidal_charm'], stats: { parries: 3, perfects: 2 } }));
  assert.equal(fled.xpGained, 0);
  assert.equal(s.glint, 0);
  assert.ok(!s.relics.tidal_charm);
  assert.equal(getMember(s, 'gideon').level, 1);
  assert.equal(s.relics.riposte_pin.battles, 0);
  assert.equal(getMember(s, 'gideon').hp, 100 + Math.round(0.2 * maxHp(s, 'gideon')));
  assert.equal(s.stats.battles, 1);
  assert.equal(s.stats.victories, 0);
  assert.equal(s.stats.parries, 3);
  assert.equal(s.stats.perfects, 2);
  applyBattleResult(s, victory({ outcome: 'defeat', party: PARTY_ORDER.map((id) => ({ id, hp: 0, alive: false })) }));
  assert.equal(s.stats.deaths, 1);
  for (const m of s.party) {
    assert.equal(m.alive, true);
    assert.equal(m.hp, 1 + Math.round(0.2 * derivedStats(m).maxHp));
  }
});

test('applyBattleResult: practice battles change nothing; spawn/boss bookkeeping', () => {
  const s = createNewGame({ seed: 1 });
  const before = serialize(s);
  applyBattleResult(s, victory({ practice: true, xp: 500 }));
  applyBattleResult(s, victory({ xp: 500 }), { practice: true });
  assert.equal(serialize(s), before);
  applyBattleResult(s, victory(), { spawnId: 'shore_e3', bossId: 'boss_wreck_warden' });
  assert.equal(s.world.defeated.shore_e3, true);
  assert.equal(s.world.bosses.boss_wreck_warden, true);
  markDefeated(s, 'shore_e4');
  assert.equal(s.world.defeated.shore_e4, true);
});

test('applyBattleResult writes back consumed items (itemsUsed delta, else summary counts, never a refill)', () => {
  const s = createNewGame({ seed: 1 });
  applyBattleResult(s, victory({ itemsUsed: { tincture: 2, draught: 1 }, items: { tincture: { count: 4, max: 4 } } }));
  assert.equal(s.items.tincture.count, 2);
  assert.equal(s.items.draught.count, 1);
  assert.equal(s.items.tonic.count, 2);
  applyBattleResult(s, victory({ outcome: 'fled', items: { tincture: { count: 1, max: 4 }, tonic: 2, draught: { count: 2, max: 2 } } }));
  assert.equal(s.items.tincture.count, 1);
  assert.equal(s.items.draught.count, 1, 'summary counts never refill');
  applyBattleResult(s, victory({ practice: true, itemsUsed: { tincture: 1 } }));
  assert.equal(s.items.tincture.count, 1, 'practice is free');
});

test('Veteran: no post-battle recovery for any outcome (KO\'d still return at 1 HP); other difficulties keep 20%', () => {
  assert.equal(postBattleRecoveryFor({ difficulty: 'veteran' }), 0);
  assert.equal(postBattleRecoveryFor({ difficulty: 'story' }), POST_BATTLE_RECOVERY);
  assert.equal(postBattleRecoveryFor({}), POST_BATTLE_RECOVERY, 'summaries without a difficulty keep the classic rule');
  assert.equal(postBattleRecoveryFor({ difficulty: 'constructor' }), POST_BATTLE_RECOVERY);
  for (const outcome of ['victory', 'fled', 'defeat']) {
    const s = createNewGame({ seed: 1 });
    applyBattleResult(s, victory({
      outcome, difficulty: 'veteran',
      party: [{ id: 'gideon', hp: 200, alive: true }, { id: 'nyra', hp: 0, alive: false }, { id: 'sable', hp: 80, alive: true }],
    }));
    assert.deepEqual(s.party.map((m) => [m.hp, m.alive]), [[200, true], [1, true], [80, true]], outcome);
  }
  const s = createNewGame({ seed: 1 });
  applyBattleResult(s, victory({ difficulty: 'expeditioner', party: [{ id: 'gideon', hp: 200, alive: true }] }));
  assert.equal(getMember(s, 'gideon').hp, 200 + Math.round(0.2 * maxHp(s, 'gideon')));
  const hpOnly = createNewGame({ seed: 1 });
  applyPostBattleHp(hpOnly, { difficulty: 'veteran', party: [{ id: 'gideon', hp: 10, alive: true }] });
  assert.equal(getMember(hpOnly, 'gideon').hp, 10);
});

test('applyPostBattleHp handles members missing from the summary', () => {
  const s = createNewGame({ seed: 1 });
  getMember(s, 'sable').alive = false;
  getMember(s, 'sable').hp = 0;
  const ko = applyPostBattleHp(s, { party: [{ id: 'gideon', hp: 10, alive: true }] });
  assert.deepEqual(ko, { gideon: false, nyra: false, sable: true });
  assert.equal(getMember(s, 'sable').hp, 1 + Math.round(0.2 * maxHp(s, 'sable')));
  assert.equal(getMember(s, 'sable').alive, true);
  assert.equal(getMember(s, 'gideon').hp, 10 + Math.round(0.2 * maxHp(s, 'gideon')));
  assert.equal(getMember(s, 'nyra').hp, maxHp(s, 'nyra'));
  assert.equal(s.stats.battles, 0, 'HP-only helper leaves counters alone');
});

// ───────────────────────── flags ─────────────────────────

test('restAtFlag heals, refills, respawns regular enemies, records the flag', () => {
  const s = createNewGame({ seed: 1 });
  s.party[0].hp = 5;
  s.party[1].hp = 0;
  s.party[1].alive = false;
  s.items.tincture.count = 0;
  s.items.tonic.count = 1;
  s.world.defeated = { e1: true, e2: true };
  s.world.bosses = { boss_wreck_warden: true };
  s.world.zone = 'shore';
  s.world.x = 12;
  s.world.y = 7;
  assert.deepEqual(restAtFlag(s, 'shore_flag_1', { name: 'Brinegate Landing', x: 11, y: 7 }), { ok: true });
  for (const m of s.party) {
    assert.equal(m.hp, derivedStats(m).maxHp);
    assert.equal(m.alive, true);
  }
  assert.equal(s.items.tincture.count, 4);
  assert.equal(s.items.tonic.count, 2);
  assert.deepEqual(s.world.defeated, {});
  assert.deepEqual(s.world.bosses, { boss_wreck_warden: true });
  assert.deepEqual(s.world.flagsVisited.shore_flag_1, { zone: 'shore', x: 11, y: 7, name: 'Brinegate Landing' });
  assert.deepEqual(s.world.lastFlag, { zone: 'shore', flagId: 'shore_flag_1', x: 11, y: 7 });
  // a second rest without info reuses the recorded position and name
  s.world.x = 30;
  restAtFlag(s, 'shore_flag_1');
  assert.deepEqual(s.world.flagsVisited.shore_flag_1, { zone: 'shore', x: 11, y: 7, name: 'Brinegate Landing' });
  assert.equal(restAtFlag(s, '').ok, false);
  visitFlag(s, 'thicket_flag_1', { zone: 'thicket', x: 3, y: 4, name: 'Gilded Gate' });
  assert.equal(s.world.flagsVisited.thicket_flag_1.name, 'Gilded Gate');
  assert.equal(s.world.lastFlag.flagId, 'shore_flag_1');
});

// ───────────────────────── attributes & skills ─────────────────────────

test('allocateAttr validates and raises HP with vitality', () => {
  const s = createNewGame({ seed: 1 });
  const g = getMember(s, 'gideon');
  assert.equal(allocateAttr(s, 'gideon', 'vitality').ok, false, 'no points yet');
  g.attrPoints = 3;
  g.hp = 100;
  assert.deepEqual(allocateAttr(s, 'gideon', 'vitality', 2), { ok: true });
  assert.equal(g.attrs.vitality, 2);
  assert.equal(g.attrPoints, 1);
  assert.equal(g.hp, 150);
  assert.equal(allocateAttr(s, 'gideon', 'charisma').ok, false);
  assert.equal(allocateAttr(s, 'gideon', 'might', 0).ok, false);
  assert.equal(allocateAttr(s, 'gideon', 'might', 1.5).ok, false);
  assert.equal(allocateAttr(s, 'gideon', 'might', 2).reason, 'Not enough attribute points');
  assert.equal(allocateAttr(s, 'nobody', 'might').ok, false);
});

test('autoAllocate spends every point following the build weights', () => {
  const s = createNewGame({ seed: 1 });
  grantPartyXp(s, totalXpForLevel(6));
  const g = getMember(s, 'gideon');
  assert.equal(g.attrPoints, 15);
  const r = autoAllocate(s, 'gideon');
  assert.equal(r.ok, true);
  assert.equal(Object.values(r.allocated).reduce((a, b) => a + b, 0), 15);
  assert.equal(g.attrPoints, 0);
  assert.ok(g.attrs.vitality >= g.attrs.agility && g.attrs.vitality >= g.attrs.luck);
  assert.equal(autoAllocate(s, 'gideon').ok, false);
  autoAllocate(s, 'sable');
  const sb = getMember(s, 'sable');
  assert.ok(sb.attrs.might + sb.attrs.agility + sb.attrs.luck > sb.attrs.vitality + sb.attrs.defense);
});

test('learnSkill enforces owner, level, requires and SP', () => {
  const s = createNewGame({ seed: 1 });
  const g = getMember(s, 'gideon');
  assert.equal(learnSkill(s, 'gideon', 'rivet_barrage').reason, 'Already learned');
  assert.equal(learnSkill(s, 'gideon', 'ember_script').ok, false, 'wrong owner');
  assert.equal(learnSkill(s, 'gideon', 'thunderhead_oath').ok, false, 'gradient skills are innate');
  assert.equal(learnSkill(s, 'gideon', 'nope').reason, 'Unknown skill');
  assert.equal(learnSkill(s, 'gideon', 'breach_strike').reason, 'Requires level 2');
  g.level = 2;
  assert.match(learnSkill(s, 'gideon', 'breach_strike').reason, /SP/);
  g.sp = 1;
  assert.deepEqual(learnSkill(s, 'gideon', 'breach_strike'), { ok: true });
  assert.equal(g.sp, 0);
  assert.ok(g.skills.includes('breach_strike'));
  // requires chain: Nyra's Tempest Script needs Rime Script
  const n = getMember(s, 'nyra');
  n.level = 5;
  n.sp = 5;
  assert.equal(learnSkill(s, 'nyra', 'tempest_script').reason, 'Requires Rime Script');
  assert.equal(learnSkill(s, 'nyra', 'rime_script').ok, true);
  assert.equal(learnSkill(s, 'nyra', 'tempest_script').ok, true);
  assert.equal(n.sp, 5 - 1 - 2);
  assert.ok(toBattleParty(s)[1].skills.includes('tempest_script'));
});

test('skillsFor reports learned / learnable / locked / innate with reasons', () => {
  const s = createNewGame({ seed: 1 });
  const list = skillsFor(s, 'sable');
  assert.equal(list.length, 9);
  assert.equal(list.at(-1).status, 'innate');
  assert.equal(list.at(-1).id, 'crimson_requiem');
  const by = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.equal(by.crimson_lunge.status, 'learned');
  assert.equal(by.calling_card.status, 'locked');
  assert.equal(by.calling_card.reason, 'Requires level 2');
  getMember(s, 'sable').level = 3;
  getMember(s, 'sable').sp = 1;
  const again = Object.fromEntries(skillsFor('sable', s).map((x) => [x.id, x]));
  assert.equal(again.calling_card.status, 'learnable');
  assert.equal(again.calling_card.canLearn, true);
  assert.equal(again.fleche.status, 'learnable');
  assert.equal(again.crimson_cadenza.reason, 'Requires level 13');
  assert.deepEqual(again.crimson_cadenza.requires, [{ id: 'fleche', name: 'Flèche', learned: false }]);
  assert.equal(skillsFor('gideon').length, 9, 'works without a state');
  assert.deepEqual(skillsFor('nobody'), []);
  // levels are ascending (gradient last)
  const levels = list.slice(0, 8).map((x) => x.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
});

// ───────────────────────── relics & echoes ─────────────────────────

test('equipRelic: ownership, one holder per relic, swaps within a character', () => {
  const s = createNewGame({ seed: 1 });
  assert.equal(equipRelic(s, 'gideon', 1, 'glass_rose').reason, 'Relic not owned');
  assert.equal(equipRelic(s, 'gideon', 1, 'bogus').reason, 'Unknown relic');
  assert.equal(equipRelic(s, 'gideon', 3, null).ok, false);
  assert.equal(equipRelic(s, 'gideon', -1, null).ok, false);
  // move Sable's Opening Gambit to Gideon
  const r = equipRelic(s, 'gideon', 2, 'opening_gambit');
  assert.deepEqual(r, { ok: true, movedFrom: 'sable' });
  assert.deepEqual(getMember(s, 'gideon').relics, ['riposte_pin', null, 'opening_gambit']);
  assert.deepEqual(getMember(s, 'sable').relics, [null, null, null]);
  // swap within Gideon's own slots
  assert.deepEqual(equipRelic(s, 'gideon', 0, 'opening_gambit'), { ok: true });
  assert.deepEqual(getMember(s, 'gideon').relics, ['opening_gambit', null, 'riposte_pin']);
  // unequip
  assert.deepEqual(equipRelic(s, 'gideon', 2, null), { ok: true });
  assert.deepEqual(getMember(s, 'gideon').relics, ['opening_gambit', null, null]);
  // HP follows max HP changes
  addLoot(s, { relic: 'tidal_charm' });
  const g = getMember(s, 'gideon');
  g.hp = 200;
  equipRelic(s, 'gideon', 1, 'tidal_charm');
  assert.equal(g.hp, 240);
  equipRelic(s, 'nyra', 2, 'tidal_charm');
  assert.equal(g.hp, 200, 'removed from Gideon when moved');
  assert.equal(describeRelic('tidal_charm', s).equippedBy, 'nyra');
});

test('equipEcho: mastered only, capacity 4 + level, no duplicates; unequipEcho', () => {
  const s = createNewGame({ seed: 1 });
  for (const id of ['dawn_locket', 'glass_rose', 'duelists_ribbon', 'marksmans_eye']) addLoot(s, { relic: id });
  assert.match(equipEcho(s, 'sable', 'dawn_locket').reason, /Not mastered/);
  for (const id of Object.keys(s.relics)) s.relics[id].mastered = true;
  assert.equal(echoCapacity(1), 5);
  assert.deepEqual(equipEcho(s, 'sable', 'dawn_locket'), { ok: true }); // cost 4
  assert.equal(equipEcho(s, 'sable', 'dawn_locket').reason, 'Echo already equipped');
  assert.match(equipEcho(s, 'sable', 'glass_rose').reason, /capacity/); // 4 + 5 > 5
  assert.deepEqual(equipEcho(s, 'sable', 'marksmans_eye'), { ok: true }); // 4 + 1 = 5
  assert.deepEqual(equipEcho(s, 'gideon', 'dawn_locket'), { ok: true }, 'another character may share the same echo');
  getMember(s, 'sable').level = 6; // capacity 10
  assert.deepEqual(equipEcho(s, 'sable', 'glass_rose'), { ok: true }); // 4 + 1 + 5 = 10
  assert.equal(equipEcho(s, 'sable', 'bogus').ok, false);
  assert.equal(equipEcho(s, 'sable', 'second_wind').reason, 'Relic not owned');
  assert.deepEqual(unequipEcho(s, 'sable', 'dawn_locket'), { ok: true });
  assert.deepEqual(getMember(s, 'sable').echoes, ['marksmans_eye', 'glass_rose']);
  assert.equal(unequipEcho(s, 'sable', 'dawn_locket').ok, false);
  const opts = echoOptions(s, 'sable');
  assert.ok(opts.find((o) => o.id === 'glass_rose').equipped);
  assert.equal(opts.find((o) => o.id === 'dawn_locket').canEquip, true);
});

test('describeRelic and relicInventory', () => {
  const d = describeRelic('tidal_charm');
  assert.equal(d.name, RELICS.tidal_charm.name);
  assert.equal(d.statsText, '+40 HP');
  assert.equal(d.passiveText, 'Each parry heals 4% of max HP.');
  assert.equal(d.owned, false);
  assert.equal(describeRelic('nope'), null);
  const s = createNewGame({ seed: 1 });
  applyBattleResult(s, victory());
  const r = describeRelic('riposte_pin', s);
  assert.equal(r.owned, true);
  assert.equal(r.battles, 1);
  assert.equal(r.masteryText, `Mastery 1/${MASTERY_BATTLES} victories`);
  assert.equal(r.equippedBy, 'gideon');
  assert.deepEqual(relicInventory(s).map((x) => x.id).sort(), ['mending_quill', 'opening_gambit', 'riposte_pin']);
});

// ───────────────────────── items ─────────────────────────

test('useItemOutOfBattle: tincture heals, tonic revives, draught is battle-only', () => {
  const s = createNewGame({ seed: 1 });
  const g = getMember(s, 'gideon');
  assert.equal(useItemOutOfBattle(s, 'tincture', 'gideon').reason, 'Already at full HP');
  g.hp = 10;
  const r = useItemOutOfBattle(s, 'tincture', 'gideon');
  assert.equal(r.ok, true);
  assert.equal(r.amount, Math.round(0.45 * 420));
  assert.equal(g.hp, 10 + Math.round(0.45 * 420));
  assert.equal(s.items.tincture.count, 3);
  g.hp = 400;
  useItemOutOfBattle(s, 'tincture', 'gideon');
  assert.equal(g.hp, 420, 'capped at max');
  assert.match(useItemOutOfBattle(s, 'draught', 'gideon').reason, /only be used in battle/);
  assert.match(useItemOutOfBattle(s, 'tonic', 'gideon').reason, /not KO'd/);
  const n = getMember(s, 'nyra');
  n.hp = 0;
  n.alive = false;
  assert.match(useItemOutOfBattle(s, 'tincture', 'nyra').reason, /KO'd/);
  assert.equal(useItemOutOfBattle(s, 'tonic', 'nyra').ok, true);
  assert.equal(n.alive, true);
  assert.equal(n.hp, Math.round(0.5 * derivedStats(n).maxHp));
  assert.equal(s.items.tonic.count, 1);
  s.items.tincture.count = 0;
  g.hp = 1;
  assert.match(canUseItemOutOfBattle(s, 'tincture', 'gideon').reason, /No Amber Tincture left/);
  assert.equal(useItemOutOfBattle(s, 'elixir', 'gideon').ok, false);
});

// ───────────────────────── loot & shops ─────────────────────────

test('addLoot handles relics, duplicates, shards, glint and items', () => {
  const s = createNewGame({ seed: 1 });
  assert.match(addLoot(s, { relic: 'feather_step' }), /Feather Step/);
  assert.ok(s.relics.feather_step);
  assert.match(addLoot(s, { relic: 'feather_step' }), /duplicate/);
  assert.equal(s.glint, DUPE_GLINT.rare);
  assert.match(addLoot(s, { shard: 'tincture_shard' }), /raised to 5/);
  assert.deepEqual(s.items.tincture, { count: 5, max: 5 });
  assert.equal(addLoot(s, { glint: 120 }), '+120 Glint');
  assert.equal(s.glint, DUPE_GLINT.rare + 120);
  s.items.tonic.count = 0;
  assert.match(addLoot(s, { item: 'tonic' }), /Rousing Tonic ×1/);
  assert.equal(s.items.tonic.count, 1);
  assert.match(addLoot(s, [{ glint: 5 }, { shard: 'draught_shard' }]), /\+5 Glint · .*raised to 3/);
  assert.equal(addLoot(s, { glint: 0 }), 'Nothing of note');
  assert.equal(addLoot(s, null), 'Nothing of note');
  assert.equal(typeof addLoot(s, { relic: 'bogus' }), 'string');
});

test('buy: glint, ownership, limits and shopView', () => {
  const s = createNewGame({ seed: 1 });
  const stock = SHOPS.shore_camp.stock;
  const relicIdx = stock.findIndex((e) => e.kind === 'relic');
  const shardIdx = stock.findIndex((e) => e.kind === 'shard');
  assert.equal(buy(s, 'shore_camp', relicIdx).reason, 'Not enough Glint');
  s.glint = 1000;
  const r = buy(s, 'shore_camp', relicIdx);
  assert.equal(r.ok, true);
  assert.equal(s.glint, 1000 - stock[relicIdx].price);
  assert.ok(s.relics[stock[relicIdx].id]);
  assert.equal(buy(s, 'shore_camp', relicIdx).reason, 'Already owned');
  const shardItem = stock[shardIdx].id.replace('_shard', '');
  const before = s.items[shardItem].max;
  assert.equal(buy(s, 'shore_camp', shardIdx).ok, true);
  assert.equal(s.items[shardItem].max, before + 1);
  assert.equal(buy(s, 'shore_camp', shardIdx).reason, 'Sold out');
  assert.equal(buy(s, 'nowhere', 0).reason, 'Unknown shop');
  assert.equal(buy(s, 'shore_camp', 99).reason, 'Invalid item');
  assert.equal(buy(s, 'shore_camp', -1).ok, false);
  const view = shopView(s, 'shore_camp');
  assert.equal(view.length, stock.length);
  assert.equal(view[relicIdx].owned, true);
  assert.equal(view[relicIdx].canBuy, false);
  assert.equal(view[shardIdx].soldOut, true);
  assert.equal(view[shardIdx].remaining, 0);
  assert.ok(view.some((v) => v.canBuy));
  // purchases survive a save round-trip
  const back = deserialize(serialize(s));
  assert.equal(buy(back, 'shore_camp', shardIdx).reason, 'Sold out');
});

// ───────────────────────── serialization & storage ─────────────────────────

function playedState() {
  const s = createNewGame({ seed: 77 });
  applyBattleResult(s, victory({ xp: totalXpForLevel(4), glint: 300, drops: ['dawn_locket', 'ember_edge'] }));
  autoAllocate(s, 'gideon');
  learnSkill(s, 'gideon', 'breach_strike');
  equipRelic(s, 'sable', 1, 'dawn_locket');
  s.relics.riposte_pin.mastered = true;
  equipEcho(s, 'nyra', 'riposte_pin');
  restAtFlag(s, 'shore_flag_1', { name: 'Landing', x: 3, y: 9 });
  s.world.chests.c1 = true;
  s.world.story.shore_arrival = true;
  addPlayTime(s, 12345);
  return s;
}

test('serialize/deserialize round-trips', () => {
  const s = playedState();
  const back = deserialize(serialize(s));
  assert.deepEqual(back, s);
  assert.equal(serialize(back), serialize(s), 'serialization is stable (same key order)');
  assert.equal(back.stats.playTimeMs, 12345);
});

test('deserialize rejects garbage', () => {
  for (const g of [undefined, null, '', 'hello', '{', '[]', '42', '"str"', '{}', '{"party":[]}', '{"party":"x"}',
    '{"party":[{"id":"villain"}]}', '{"version":99,"party":[{"id":"gideon"}]}', '{"version":"1","party":[{"id":"gideon"}]}', 'null']) {
    assert.equal(deserialize(g), null, `should reject ${g}`);
  }
});

test('deserialize repairs partial / corrupted saves', () => {
  const raw = {
    version: 1,
    seed: 5,
    party: [
      { id: 'gideon', level: 99, xp: -5, attrs: { vitality: 'lots', might: 3 }, skills: ['ember_script', 'breach_strike', 'breach_strike', 'thunderhead_oath'],
        relics: ['riposte_pin', 'glass_rose', 'riposte_pin'], echoes: ['riposte_pin', 'dawn_locket'], hp: 1e9 },
      { id: 'sable', relics: ['riposte_pin', null, null], hp: -3 },
      'junk',
    ],
    items: { tincture: { count: 99, max: 2 }, tonic: 'x' },
    relics: { riposte_pin: { battles: 7 }, bogus: { battles: 1 }, dawn_locket: { battles: 1, mastered: false } },
    glint: -40,
    world: { zone: 'thicket', x: 4, y: 'nope', defeated: { a: true, b: 0 }, flagsVisited: { f1: { zone: 'shore', x: 1, y: 2 } }, extra: [1, 2] },
    stats: { battles: 3.7, deaths: -1 },
  };
  const s = deserialize(JSON.stringify(raw));
  assert.ok(s);
  const g = getMember(s, 'gideon');
  assert.equal(g.level, 20);
  assert.equal(g.xp, 0);
  assert.deepEqual(g.attrs, { vitality: 0, might: 3, agility: 0, defense: 0, luck: 0 });
  assert.deepEqual(g.skills, ['rivet_barrage', 'arc_discharge', 'breach_strike'], 'foreign, duplicate and gradient skills dropped; starting skills kept');
  assert.deepEqual(g.relics, ['riposte_pin', null, null], 'unowned and duplicate relics removed');
  assert.deepEqual(g.echoes, ['riposte_pin'], 'battles ≥ 4 implies mastered; unmastered echo dropped');
  assert.equal(g.hp, derivedStats(g).maxHp);
  const sb = getMember(s, 'sable');
  assert.deepEqual(sb.relics, [null, null, null], 'a relic can only be on one character');
  assert.equal(sb.alive, false);
  assert.equal(sb.hp, 0);
  assert.equal(getMember(s, 'nyra').level, 1, 'missing members are filled with defaults');
  assert.deepEqual(s.items.tincture, { count: 4, max: 4 });
  assert.deepEqual(s.items.tonic, { count: 2, max: 2 });
  assert.ok(!('bogus' in s.relics));
  assert.equal(s.relics.riposte_pin.mastered, true);
  assert.equal(s.glint, 0);
  assert.equal(s.world.zone, 'thicket');
  assert.equal(s.world.x, 4);
  assert.equal(s.world.y, 0);
  assert.deepEqual(s.world.defeated, { a: true });
  assert.deepEqual(s.world.flagsVisited.f1, { zone: 'shore', x: 1, y: 2, name: 'f1' });
  assert.deepEqual(s.world.extra, [1, 2], 'unknown world fields are preserved');
  assert.equal(s.stats.battles, 3);
  assert.equal(s.stats.deaths, 0);
  // prototype-pollution keys in a hostile save are ignored
  const hostile = deserialize('{"party":[{"id":"gideon","attrs":{"__proto__":{"x":1}}}],"__proto__":{"polluted":true},' +
    '"world":{"__proto__":{"polluted":true},"defeated":{"__proto__":true}},"relics":{"__proto__":{"battles":9}}}');
  assert.ok(hostile);
  assert.equal({}.polluted, undefined);
  assert.equal(hostile.polluted, undefined);
  assert.equal(hostile.world.polluted, undefined);
  assert.equal(Object.getPrototypeOf(hostile), Object.prototype);
  assert.equal(Object.getPrototypeOf(hostile.world), Object.prototype);
  assert.equal(Object.getPrototypeOf(hostile.world.defeated), Object.prototype);
  assert.equal(Object.getPrototypeOf(hostile.relics), Object.prototype);
  assert.equal(deserialize('{"party":[{"id":"__proto__"},{"id":"constructor"}]}'), null);
  // inherited keys are never treated as ids
  const s2 = createNewGame({ seed: 1 });
  assert.equal(equipRelic(s2, 'gideon', 1, 'constructor').reason, 'Unknown relic');
  assert.equal(learnSkill(s2, 'gideon', 'toString').reason, 'Unknown skill');
  assert.equal(buy(s2, 'hasOwnProperty', 0).reason, 'Unknown shop');
  assert.equal(useItemOutOfBattle(s2, 'valueOf', 'gideon').ok, false);
  assert.equal(describeRelic('__proto__'), null);
});

let fakeStore = null;
function installStorage() {
  const map = new Map();
  fakeStore = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: fakeStore, configurable: true, writable: true });
}
afterEach(() => {
  if (fakeStore) {
    delete globalThis.localStorage;
    fakeStore = null;
  }
});

test('save / load / hasSave / deleteSave with localStorage', () => {
  installStorage();
  assert.equal(hasSave(), false);
  assert.equal(loadGame(), null);
  const s = playedState();
  assert.equal(saveGame(s), true);
  assert.ok(fakeStore._map.has(SAVE_KEY));
  assert.equal(SAVE_KEY, 'exp69.save.v1');
  assert.equal(hasSave(), true);
  assert.deepEqual(loadGame(), s);
  fakeStore.setItem(SAVE_KEY, '{corrupt');
  assert.equal(hasSave(), false);
  assert.equal(loadGame(), null);
  assert.equal(deleteSave(), true);
  assert.equal(fakeStore._map.has(SAVE_KEY), false);
});

test('storage helpers are safe without (or with a throwing) localStorage', () => {
  assert.equal(globalThis.localStorage, undefined);
  const s = createNewGame({ seed: 1 });
  assert.equal(saveGame(s), false);
  assert.equal(loadGame(), null);
  assert.equal(hasSave(), false);
  assert.equal(deleteSave(), false);
  installStorage();
  fakeStore.setItem = () => { throw new Error('QuotaExceeded'); };
  fakeStore.getItem = () => { throw new Error('SecurityError'); };
  fakeStore.removeItem = () => { throw new Error('SecurityError'); };
  assert.equal(saveGame(s), false);
  assert.equal(loadGame(), null);
  assert.equal(deleteSave(), false);
});

// ───────────────────────── views ─────────────────────────

test('partyMemberView exposes a stats breakdown incl. relic bonuses', () => {
  const s = createNewGame({ seed: 1 });
  addLoot(s, { relic: 'tidal_charm' });
  equipRelic(s, 'gideon', 1, 'tidal_charm');
  const v = partyMemberView(s, 'gideon');
  assert.equal(v.name, 'Gideon Marchal');
  assert.equal(v.maxHp, 460);
  assert.equal(v.base.maxHp, 420);
  assert.equal(v.bonus.hp, 40);
  assert.equal(v.breakdown.maxHp.relics, 40);
  assert.equal(v.xpToNext, xpToNext(1));
  assert.equal(v.echoCapacity, 5);
  assert.equal(v.relics[1].id, 'tidal_charm');
  assert.equal(v.relics[2].id, null);
  assert.equal(v.passives.length, 2);
  assert.equal(partyMemberView(s, 'nobody'), null);
  const skills = Object.keys(SKILLS).filter((id) => SKILLS[id].owner === 'gideon');
  assert.ok(v.skills.every((id) => skills.includes(id)));
});
