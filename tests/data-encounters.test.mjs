// Validates src/data/encounters.js (SPEC §4.8): references, counts per zone, boss/tutorial/training ids,
// sensible mixes and rising difficulty within each zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENCOUNTERS, BOSS_ENCOUNTERS, getEncounter, encountersInZone } from '../src/data/encounters.js';
import { ENEMIES } from '../src/data/enemies.js';

const ZONES = ['shore', 'thicket', 'spire', 'summit', 'training'];
const TRACKS = ['title', 'shore', 'thicket', 'spire', 'summit', 'battle', 'boss', 'final', 'victory', 'gameover', 'ending', 'training'];
const all = Object.values(ENCOUNTERS);

/** Rough threat of an encounter: Σ hp × atk × spd of its enemies (only used to compare within a zone). */
const threat = (enc) => enc.enemies.reduce((s, id) => s + ENEMIES[id].stats.hp * ENEMIES[id].stats.atk * ENEMIES[id].stats.spd, 0);

test('every encounter is well-formed and references real enemies', () => {
  for (const [key, enc] of Object.entries(ENCOUNTERS)) {
    assert.equal(enc.id, key);
    assert.match(key, /^[a-z][a-z0-9_]*$/);
    assert.equal(typeof enc.name, 'string');
    assert.ok(enc.name.length > 2);
    assert.ok(ZONES.includes(enc.zone), `${key}: zone ${enc.zone}`);
    assert.ok(Array.isArray(enc.enemies) && enc.enemies.length >= 1 && enc.enemies.length <= 3, `${key}: 1–3 enemies`);
    for (const id of enc.enemies) assert.ok(ENEMIES[id], `${key}: unknown enemy ${id}`);
    if (enc.music !== undefined) assert.ok(TRACKS.includes(enc.music), `${key}: music ${enc.music}`);
    if (enc.boss) {
      assert.equal(enc.enemies.length, 1, `${key}: a boss fights alone`);
      assert.ok(ENEMIES[enc.enemies[0]].boss, `${key}: boss encounter holds a boss`);
    } else {
      for (const id of enc.enemies) assert.ok(!ENEMIES[id].boss, `${key}: boss ${id} outside a boss encounter`);
    }
    if (enc.zone !== 'training') assert.ok(!enc.enemies.includes('dummy'), `${key}: the mannequin stays in the yard`);
  }
});

test('fixed encounter ids', () => {
  assert.deepEqual(ENCOUNTERS.tutorial_driftling.enemies, ['driftling']);
  assert.equal(ENCOUNTERS.tutorial_driftling.zone, 'shore');
  assert.equal(ENCOUNTERS.tutorial_driftling.tutorial, true);
  assert.deepEqual(ENCOUNTERS.training_dummy.enemies, ['dummy']);
  assert.equal(ENCOUNTERS.training_dummy.zone, 'training');
  const bosses = { boss_wreck_warden: ['wreck_warden', 'shore'], boss_bellwether: ['bellwether', 'thicket'], boss_stillkeeper: ['stillkeeper', 'summit'] };
  for (const [id, [enemy, zone]] of Object.entries(bosses)) {
    assert.ok(ENCOUNTERS[id], id);
    assert.deepEqual(ENCOUNTERS[id].enemies, [enemy]);
    assert.equal(ENCOUNTERS[id].zone, zone);
    assert.equal(ENCOUNTERS[id].boss, true);
    assert.equal(BOSS_ENCOUNTERS[enemy], id);
  }
  assert.equal(all.filter((e) => e.boss).length, 3);
  assert.equal(ENCOUNTERS.boss_stillkeeper.music, 'final');
});

test('at least five regular encounters per zone, using that zone\'s roster', () => {
  const home = { shore: ['shore'], thicket: ['thicket'], spire: ['spire'], summit: ['spire', 'summit'] };
  for (const [zone, rosterZones] of Object.entries(home)) {
    const list = encountersInZone(zone);
    assert.ok(list.length >= 5, `${zone}: ${list.length} regular encounters`);
    for (const enc of list) {
      for (const id of enc.enemies) assert.ok(rosterZones.includes(ENEMIES[id].zone), `${enc.id}: ${id} is out of zone`);
    }
    // Every regular enemy of the zone actually appears somewhere.
    for (const e of Object.values(ENEMIES).filter((x) => x.zone === zone && !x.boss)) {
      assert.ok(list.some((enc) => enc.enemies.includes(e.id)), `${e.id} never appears in ${zone}`);
    }
    // Mixes: some solo, some pairs, some trios.
    const sizes = new Set(list.map((e) => e.enemies.length));
    if (zone !== 'summit') assert.ok(sizes.has(2) && sizes.has(3), `${zone}: pairs and trios`);
  }
});

test('difficulty rises within each zone (authoring order)', () => {
  for (const zone of ['shore', 'thicket', 'spire']) {
    const list = encountersInZone(zone, { includeTutorial: true });
    const first = (threat(list[0]) + threat(list[1])) / 2;
    const last = (threat(list[list.length - 1]) + threat(list[list.length - 2])) / 2;
    assert.ok(last > first * 1.5, `${zone}: late encounters should be clearly harder`);
  }
  // Each boss out-threatens every regular fight of its zone (the Stillkeeper tops the summit).
  for (const [bossId, zone] of [['boss_wreck_warden', 'shore'], ['boss_bellwether', 'thicket'], ['boss_stillkeeper', 'summit']]) {
    const bossThreat = threat(getEncounter(bossId));
    for (const enc of encountersInZone(zone)) assert.ok(bossThreat > threat(enc), `${bossId} vs ${enc.id}`);
  }
});

test('helpers', () => {
  assert.equal(getEncounter('boss_bellwether'), ENCOUNTERS.boss_bellwether);
  assert.equal(getEncounter('nope'), null);
  assert.equal(getEncounter('constructor'), null);
  assert.ok(encountersInZone('shore').every((e) => !e.boss && !e.tutorial));
  assert.ok(encountersInZone('shore', { includeBoss: true, includeTutorial: true }).some((e) => e.boss));
  assert.ok(encountersInZone('shore', { includeTutorial: true }).some((e) => e.tutorial));
  assert.deepEqual(encountersInZone('training').map((e) => e.id), ['training_dummy']);
});
