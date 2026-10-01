// Balance check for the bestiary against the expected party table (SPEC §3.3): damage of failed defenses as % of max
// HP, boss heavy hits, battle length for regular encounters and bosses (simulated in the real battle model with the
// tools/simulate.mjs player profiles at the level a typical run meets each fight), the XP curve to the three bosses
// from the real map spawns, glint and the shop economy.
// Prints a balance table (as test diagnostics) so tuning changes are visible at a glance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMIES } from '../src/data/enemies.js';
import { ENCOUNTERS, encountersInZone } from '../src/data/encounters.js';
import { MAPS } from '../src/data/maps.js';
import { SHOPS } from '../src/data/shops.js';
import { RELICS, STARTING_RELICS } from '../src/data/relics.js';
import { xpFalloff } from '../src/battle/model.js';
import {
  loadRealData, buildPartyFromGameState, simulate, DEFAULT_BOT, BOT_PROFILES, scaleBotForWindows, campaignLevel, CAMPAIGN_BOSS_LEVELS,
} from '../tools/simulate.mjs';

// ---- Model -----------------------------------------------------------------------------------------------------
/** Expected party averages (SPEC §3.3): [level, hp, atk, def, spd]; linear between rows, extrapolated past L15. */
const PARTY_TABLE = [[1, 350, 36, 18, 45], [5, 700, 58, 32, 52], [10, 1250, 95, 52, 60], [15, 1900, 135, 72, 68]];
/**
 * Average damage one party action deals, in multiples of the actor's atk, before the target's mitigation.
 * Basic attacks are 1.0; 2-AP skills ≈ 1.9 × QTE bonus (≈1.2); plus crits, stances, surge, weak points, gradient
 * skills; minus turns spent healing/buffing. ≈ 2.0 overall. Only feeds the printed rounds column, which runs about
 * 1.2–2× longer than the real engine; the length assertions below simulate the real battle model instead.
 */
const PARTY_POWER_PER_ACTION = 2.0;
/** Party actions lost per enemy shield (multi-hit skills and shield weak points strip them cheaply). */
const ACTIONS_PER_SHIELD = 0.5;

function partyAt(level) {
  let a = PARTY_TABLE[0];
  let b = PARTY_TABLE[1];
  for (let i = 0; i < PARTY_TABLE.length - 1; i++) if (level >= PARTY_TABLE[i][0]) { a = PARTY_TABLE[i]; b = PARTY_TABLE[i + 1]; }
  const f = (level - a[0]) / (b[0] - a[0]);
  const at = (i) => a[i] + (b[i] - a[i]) * f;
  return { level, hp: at(1), atk: at(2), def: at(3), spd: at(4) };
}

/** Phases of an enemy as { index, pool, atkMult, spdMult }. */
function phasesOf(e) {
  return [
    { index: 0, pool: e.pool, atkMult: 1, spdMult: 1 },
    ...(e.phases || []).map((p, i) => ({ index: i + 1, pool: p.pool, atkMult: p.statMult?.atk ?? 1, spdMult: p.statMult?.spd ?? 1 })),
  ];
}

/** Failed-defense damage of one hit as a fraction of the party member's max HP (variance/crit ignored). */
const hitFrac = (e, power, atkMult, party) => (power * e.stats.atk * atkMult * (100 / (100 + party.def))) / party.hp;

/** Damage profile of one phase of an enemy vs the expected party at `level`. */
function profile(e, phase, level) {
  const party = partyAt(level);
  let wsum = 0;
  let avg = 0;
  let maxHit = 0;
  let minHit = Infinity;
  let maxSingle = 0;
  let maxAoe = 0;
  for (const id of phase.pool) {
    const a = e.attacks[id];
    const hits = a.hits.filter((h) => h.type !== 'feint');
    if (!hits.length) continue;
    const fr = hits.map((h) => hitFrac(e, h.power, phase.atkMult, party));
    const total = fr.reduce((s, x) => s + x, 0);
    avg += a.weight * (total / fr.length);
    wsum += a.weight;
    maxHit = Math.max(maxHit, ...fr);
    minHit = Math.min(minHit, ...fr);
    if (a.target === 'all') maxAoe = Math.max(maxAoe, total);
    else maxSingle = Math.max(maxSingle, total);
  }
  return { avgHit: avg / wsum, maxHit, minHit, maxSingle, maxAoe, turnRate: (e.stats.spd * phase.spdMult) / party.spd };
}

/** Party rounds (3 actions each) to defeat an enemy at party level `level`. */
function roundsToKill(e, level) {
  const party = partyAt(level);
  const perAction = PARTY_POWER_PER_ACTION * party.atk * (100 / (100 + e.stats.def));
  return (e.stats.hp / perAction + (e.shields || 0) * ACTIONS_PER_SHIELD) / 3;
}

const xpToNext = (level) => Math.round(60 * level ** 1.6);
const zoneMean = (zone, fn) => {
  const list = encountersInZone(zone);
  return list.reduce((s, enc) => s + enc.enemies.reduce((a, id) => a + fn(ENEMIES[id]), 0), 0) / list.length;
};

const pct = (x) => `${(100 * x).toFixed(1)}%`.padStart(6);
const combatEnemies = Object.values(ENEMIES).filter((e) => e.id !== 'dummy');

// ---- Tests -----------------------------------------------------------------------------------------------------

test('balance table (printed) — failed-defense damage vs expected party, rounds to kill', (t) => {
  t.diagnostic('enemy          lvl ph  avgHit maxHit minHit single   aoe  turns  rounds');
  for (const e of combatEnemies) {
    for (const ph of phasesOf(e)) {
      const p = profile(e, ph, e.level);
      t.diagnostic(`${e.id.padEnd(14)} ${String(e.level).padStart(3)} ${ph.index}  ${pct(p.avgHit)} ${pct(p.maxHit)} ${pct(p.minHit)} `
        + `${pct(p.maxSingle)} ${pct(p.maxAoe)}  ${p.turnRate.toFixed(2)}  ${ph.index === 0 ? roundsToKill(e, e.level).toFixed(1).padStart(6) : ''}`);
    }
  }
});

test('regular enemies: a failed normal hit costs 8–15% of max HP; nothing one-shots', () => {
  for (const e of combatEnemies.filter((x) => !x.boss)) {
    const p = profile(e, phasesOf(e)[0], e.level);
    assert.ok(p.avgHit >= 0.08 && p.avgHit <= 0.15, `${e.id}: average hit ${pct(p.avgHit)} outside 8–15%`);
    assert.ok(p.maxHit <= 0.22, `${e.id}: heaviest hit ${pct(p.maxHit)} > 22%`);
    assert.ok(p.minHit >= 0.04, `${e.id}: lightest hit ${pct(p.minHit)} is too trivial`);
    assert.ok(p.maxSingle <= 0.4, `${e.id}: a fully failed attack costs ${pct(p.maxSingle)} (> 40%)`);
    assert.ok(p.maxAoe <= 0.3, `${e.id}: a fully failed AoE costs everyone ${pct(p.maxAoe)} (> 30%)`);
    assert.ok(p.turnRate >= 0.6 && p.turnRate <= 1.3, `${e.id}: turn rate ${p.turnRate.toFixed(2)}`);
  }
});

test('bosses: heavy hits 20–35%, average hits 8–16%, turn rate', () => {
  for (const e of combatEnemies.filter((x) => x.boss)) {
    for (const ph of phasesOf(e)) {
      const p = profile(e, ph, e.level);
      assert.ok(p.maxHit >= 0.2 && p.maxHit <= 0.35, `${e.id} phase ${ph.index}: heavy hit ${pct(p.maxHit)} outside 20–35%`);
      assert.ok(p.avgHit >= 0.08 && p.avgHit <= 0.16, `${e.id} phase ${ph.index}: average hit ${pct(p.avgHit)}`);
      assert.ok(p.maxSingle <= 0.55, `${e.id} phase ${ph.index}: a fully failed attack costs ${pct(p.maxSingle)}`);
      assert.ok(p.maxAoe <= 0.4, `${e.id} phase ${ph.index}: a fully failed AoE costs everyone ${pct(p.maxAoe)}`);
      assert.ok(p.turnRate >= 0.7 && p.turnRate <= 1.4, `${e.id} phase ${ph.index}: turn rate ${p.turnRate.toFixed(2)}`);
    }
  }
});

// Battle length is measured in the real engine rather than estimated: the analytic rounds-to-kill model above leaves out
// gradient skills, counters, break stuns and QTE multipliers (it is printed for reference only). Fights are simulated at
// the level a typical run (each zone cleared ≈1.3×) has when it meets them (campaignLevel), with the player profiles of
// tools/simulate.mjs: `average` (parry 50% per attempt, dodge 70%, 35% perfect strikes) on Expeditioner, and `novice`
// (parry 20%, dodge 45%) on Story, whose ×1.7 timing windows the profile is rescaled for.
const PROFILE = (name, difficulty, data) => scaleBotForWindows(BOT_PROFILES[name], data.DIFFICULTY[difficulty].windowScale);

test('bosses last 8–15 rounds for an average player, who wins but is pressed; a novice can finish on Story (simulated)', async (t) => {
  const real = await loadRealData();
  assert.ok(real.data && real.gs && real.prog, `real data modules: ${real.missing.join('; ')}`);
  for (const [encId, level] of Object.entries(CAMPAIGN_BOSS_LEVELS)) {
    const enc = ENCOUNTERS[encId];
    const { party, items } = buildPartyFromGameState(real.gs, real.prog, real.data.SKILLS, level);
    const run = (cfg, difficulty) => simulate({ data: real.data, party, enemies: enc.enemies, battles: 60, seed: 69, cfg, difficulty, items, boss: true });
    const avg = run(PROFILE('average', 'expeditioner', real.data), 'expeditioner');
    const legacy = run(DEFAULT_BOT, 'expeditioner');
    const story = run(PROFILE('novice', 'story', real.data), 'story');
    t.diagnostic(`${encId.padEnd(18)} L${level}: average ${avg.rounds.avg.toFixed(1)} rounds, ${(avg.winRate * 100).toFixed(0)}% wins, `
      + `${(avg.hpPctOnWin * 100).toFixed(0)}% HP left · default bot ${legacy.rounds.avg.toFixed(1)} rounds · novice on Story ${story.rounds.avg.toFixed(1)} rounds, `
      + `${(story.winRate * 100).toFixed(0)}% wins`);
    assert.ok(avg.rounds.avg >= 8 && avg.rounds.avg <= 15, `${encId}: ${avg.rounds.avg.toFixed(1)} rounds for an average player`);
    assert.ok(avg.winRate >= 0.9, `${encId}: an average player should win (${(avg.winRate * 100).toFixed(0)}%)`);
    assert.ok(avg.hpPctOnWin <= 0.9, `${encId}: a boss should press an average player (${(avg.hpPctOnWin * 100).toFixed(0)}% HP left)`);
    assert.ok(legacy.rounds.avg >= 8 && legacy.rounds.avg <= 15 && legacy.winRate >= 0.95, `${encId}: default bot ${legacy.rounds.avg.toFixed(1)} rounds`);
    assert.ok(story.winRate >= 0.9, `${encId}: a novice must be able to finish on Story (${(story.winRate * 100).toFixed(0)}% wins)`);
    assert.ok(story.rounds.avg <= 18, `${encId}: a novice's Story fight drags to ${story.rounds.avg.toFixed(1)} rounds`);
  }
});

test('tutorial and training are gentle', () => {
  const d = ENEMIES.driftling;
  const p = profile(d, phasesOf(d)[0], 1);
  assert.ok(p.maxHit <= 0.15, `tutorial driftling vs L1: heaviest hit ${pct(p.maxHit)}`);
  assert.ok(roundsToKill(d, 1) <= 3, 'the first fight does not drag');
  const dummy = ENEMIES.dummy;
  const q = profile(dummy, phasesOf(dummy)[0], 1);
  assert.ok(q.maxHit <= 0.05, `mannequin heaviest hit ${pct(q.maxHit)}`);
});

test('encounters: regular battles last ≈3–5 rounds for an average player at campaign levels (simulated)', async (t) => {
  const real = await loadRealData();
  assert.ok(real.data && real.gs && real.prog, `real data modules: ${real.missing.join('; ')}`);
  const cfg = PROFILE('average', 'expeditioner', real.data);
  const parties = new Map();
  const partyAt = (lv) => {
    if (!parties.has(lv)) parties.set(lv, buildPartyFromGameState(real.gs, real.prog, real.data.SKILLS, lv));
    return parties.get(lv);
  };
  const run = (enc) => {
    const { party, items } = partyAt(campaignLevel(enc, ENCOUNTERS));
    return simulate({ data: real.data, party, enemies: enc.enemies, battles: 40, seed: 69, cfg, difficulty: 'expeditioner', items });
  };
  for (const zone of ['shore', 'thicket', 'spire', 'summit']) {
    const list = encountersInZone(zone);
    const rounds = [];
    for (const enc of list) {
      const r = run(enc);
      rounds.push(r.rounds.avg);
      t.diagnostic(`${enc.id.padEnd(24)} L${String(campaignLevel(enc, ENCOUNTERS)).padStart(2)} ${enc.enemies.join('+').padEnd(34)} `
        + `${r.rounds.avg.toFixed(1)} rounds · ${(r.hpPctOnWin * 100).toFixed(0)}% HP left`);
      assert.ok(r.winRate >= 0.97, `${enc.id}: ${(r.winRate * 100).toFixed(0)}% wins`);
      assert.ok(r.rounds.avg >= 2.3 && r.rounds.avg <= 5.5, `${enc.id}: ${r.rounds.avg.toFixed(2)} rounds`);
      assert.ok(r.hpPctOnWin <= 0.97, `${enc.id}: costs an average player nothing (${(r.hpPctOnWin * 100).toFixed(0)}% HP left)`);
    }
    const mean = rounds.reduce((s, x) => s + x, 0) / rounds.length;
    t.diagnostic(`${zone} mean ${mean.toFixed(2)} rounds`);
    assert.ok(mean >= 3 && mean <= 5, `${zone}: mean ${mean.toFixed(2)} rounds`);
  }
  const tut = run(ENCOUNTERS.tutorial_driftling);
  assert.ok(tut.winRate === 1 && tut.rounds.avg <= 3.5, `tutorial: ${tut.rounds.avg.toFixed(2)} rounds`);
});

/** Every roaming spawn of a zone's map; `later` is the encounter a spawn turns into once the tutorial is done. */
const spawnsOf = (zone) => MAPS[zone]?.entities.filter((e) => e.type === 'enemy') ?? [];
const encReward = (id, key) => ENCOUNTERS[id].enemies.reduce((a, eid) => a + ENEMIES[eid][key], 0);
/** Reward from clearing a zone `mult` times: the first clear, then (mult − 1) respawn clears after resting at flags. */
const zoneReward = (zone, key, mult) => {
  const first = spawnsOf(zone).reduce((a, e) => a + encReward(e.encounter, key), 0);
  const again = spawnsOf(zone).reduce((a, e) => a + encReward(e.later ?? e.encounter, key), 0);
  return mult <= 1 ? first * mult : first + (mult - 1) * again;
};
/** Zones walked before each boss (the summit spawns stand between the spire and the Stillkeeper). */
const ZONE_BOSSES = [[['shore'], 'wreck_warden'], [['thicket'], 'bellwether'], [['spire', 'summit'], 'stillkeeper']];

/**
 * Party level (fractional) on reaching each boss when every zone is cleared `mult` times, fight by fight in map order:
 * the first clear, then the respawns again after pennant rests. Each fight pays what BattleModel pays a living member:
 * Σ enemy xp × xpFalloff(member level, enemy level), so enemies below the party's level are worth less and less.
 */
function campaignLevels(mult) {
  let level = 1;
  let xp = 0;
  const gain = (amount) => {
    xp += amount;
    while (level < 20 && xp >= xpToNext(level)) { xp -= xpToNext(level); level += 1; }
  };
  const fight = (encId, weight = 1) => gain(weight * Math.round(ENCOUNTERS[encId].enemies
    .reduce((a, id) => a + ENEMIES[id].xp * xpFalloff(level, ENEMIES[id].level), 0)));
  const out = [];
  for (const [zones, boss] of ZONE_BOSSES) {
    for (const zone of zones) {
      const spawns = spawnsOf(zone);
      for (const s of spawns) fight(s.encounter);
      for (let k = 1; k < mult; k++) for (const s of spawns) fight(s.later ?? s.encounter, Math.min(1, mult - k));
    }
    out.push(level + (level < 20 ? xp / xpToNext(level) : 0));
    gain(ENEMIES[boss].xp);
  }
  return out;
}

test('xp curve from the real map spawns: a typical run (each zone ≈1.3×) meets the bosses at ≈L5 / L10 / L15', (t) => {
  // The XP (and Glint) tuning counts the summit's two spawns on the approach to the Stillkeeper.
  const summit = spawnsOf('summit').map((e) => e.encounter);
  t.diagnostic(`summit spawns: ${summit.join(', ')}`);
  assert.deepEqual([...summit].sort(), ['summit_honor_guard', 'summit_vigil']);
  const run = (mult) => {
    const out = campaignLevels(mult);
    t.diagnostic(`${mult.toFixed(1)}× clears → Warden L${out[0].toFixed(2)}, Bellwether L${out[1].toFixed(2)}, Stillkeeper L${out[2].toFixed(2)}`);
    return out;
  };
  const targets = [5, 10, 15];
  run(1.3).forEach((lv, i) => assert.ok(Math.abs(lv - targets[i]) <= 0.35, `typical run: boss ${i} at L${lv.toFixed(2)}`));
  run(1.0).forEach((lv, i) => assert.ok(lv >= targets[i] - 1.5, `one clear per zone: boss ${i} at L${lv.toFixed(2)}`));
  // A thorough player (every zone twice) is a little ahead — the XP falloff keeps it within 1.5 levels …
  run(2.0).forEach((lv, i) => assert.ok(lv <= targets[i] + 1.5, `thorough run: boss ${i} at L${lv.toFixed(2)}`));
  // … and even grinding every zone three times stays within about two and a half.
  run(3.0).forEach((lv, i) => assert.ok(lv <= targets[i] + 2.5, `grinding run: boss ${i} at L${lv.toFixed(2)}`));
  assert.equal(xpToNext(1), 60);
});

test('glint: 30–80 per shore fight, roughly doubling each zone', (t) => {
  const shore = zoneMean('shore', (e) => e.glint);
  const thicket = zoneMean('thicket', (e) => e.glint);
  const spire = zoneMean('spire', (e) => e.glint);
  t.diagnostic(`glint per fight: shore ${shore.toFixed(0)}, thicket ${thicket.toFixed(0)}, spire ${spire.toFixed(0)}`);
  assert.ok(shore >= 30 && shore <= 80);
  for (const enc of encountersInZone('shore')) {
    const g = enc.enemies.reduce((s, id) => s + ENEMIES[id].glint, 0);
    assert.ok(g >= 20 && g <= 100, `${enc.id}: ${g} glint`);
  }
  assert.ok(thicket / shore >= 1.5 && thicket / shore <= 2.6, 'thicket ≈ 2× shore');
  assert.ok(spire / thicket >= 1.5 && spire / thicket <= 2.6, 'spire ≈ 2× thicket');
  for (const e of combatEnemies.filter((x) => x.boss)) assert.ok(e.glint >= 3 * e.level * 10, `${e.id}: boss purse`);
});

test('economy: a typical run affords about half of each camp; no shop sells a relic a boss drops for certain', (t) => {
  const chestGlint = (zone) => MAPS[zone].entities.filter((e) => e.type === 'chest').reduce((a, c) => a + (c.loot?.glint ?? 0), 0);
  // The spire camp is the last shop; summit Glint only reaches it by pennant fast travel, but it is counted.
  const camps = { shore: 'shore_camp', thicket: 'thicket_camp', spire: 'spire_camp' };
  let purse = 0;
  for (const [zones, boss] of ZONE_BOSSES) {
    const camp = camps[zones[0]];
    const income = purse + zones.reduce((a, zone) => a + zoneReward(zone, 'glint', 1.3) + chestGlint(zone), 0);
    const stock = SHOPS[camp].stock.reduce((a, e) => a + e.price * (e.limit ?? 1), 0);
    t.diagnostic(`${zones.join('+').padEnd(13)} typical income ${Math.round(income)} Glint vs ${camp} stock ${stock} (${((100 * income) / stock).toFixed(0)}%)`);
    assert.ok(income / stock >= 0.35 && income / stock <= 0.7, `${camp}: a typical run affords ${((100 * income) / stock).toFixed(0)}% of the camp`);
    purse = ENEMIES[boss].glint;
  }
  const certain = combatEnemies.flatMap((e) => e.drops.filter((d) => d.chance >= 1).map((d) => d.relic));
  for (const shop of Object.values(SHOPS)) {
    for (const e of shop.stock) assert.ok(!(e.kind === 'relic' && certain.includes(e.id)), `${shop.id} sells ${e.id}, a guaranteed boss drop`);
  }
});

test('every relic has a sure source before the final boss (start, shop, chest or a miniboss\'s guaranteed drop)', (t) => {
  const sources = {};
  const add = (id, where) => (sources[id] ??= []).push(where);
  for (const [who, id] of Object.entries(STARTING_RELICS)) add(id, `start:${who}`);
  for (const shop of Object.values(SHOPS)) for (const e of shop.stock) if (e.kind === 'relic') add(e.id, `shop:${shop.id}`);
  for (const map of Object.values(MAPS)) {
    for (const e of map.entities) {
      if (e.type !== 'chest') continue;
      for (const loot of [].concat(e.loot ?? [])) if (loot?.relic) add(loot.relic, `chest:${e.id}`);
    }
  }
  // Random drops (regular enemies, a boss's bonus roll) are a bonus, never the only way to a relic; the final boss's
  // rewards only arrive after the ending.
  for (const e of combatEnemies) {
    for (const d of e.drops) if (e.boss && e.id !== 'stillkeeper' && d.chance >= 1) add(d.relic, `boss:${e.id}`);
  }
  const missing = Object.keys(RELICS).filter((id) => !sources[id]);
  t.diagnostic(`relic sources: ${Object.keys(RELICS).length - missing.length}/${Object.keys(RELICS).length} sure`);
  assert.deepEqual(missing, [], `relics with no sure, pre-final-boss source: ${missing.join(', ')}`);
});

test('enemy levels follow the zone bands', () => {
  const bands = { shore: [1, 5], thicket: [5, 10], spire: [10, 15], summit: [15, 16], training: [1, 1] };
  for (const e of Object.values(ENEMIES)) {
    const [lo, hi] = bands[e.zone];
    assert.ok(e.level >= lo && e.level <= hi, `${e.id}: level ${e.level} outside ${e.zone} band`);
  }
  assert.equal(ENEMIES.wreck_warden.level, 5);
  assert.equal(ENEMIES.bellwether.level, 10);
  assert.ok(ENEMIES.stillkeeper.level >= 15);
});
