// Validates src/data/enemies.js against SPEC §3.7 / §4.8: schema, closed sets, fixed roster + weak point ids,
// relic drop ids, the attack-timeline rules, and the per-zone teaching progression of hit types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENEMIES, ENEMY_IDS, DEFAULT_WINDUP, getEnemy, getAttack, phaseAt, damagingHits,
} from '../src/data/enemies.js';

// ---- Spec constants (hard-coded from SPEC so the module is checked against the contract, not itself) ----------
const ROSTER = {
  driftling: { zone: 'shore', weak: { core: 'crit' } },
  shellguard: { zone: 'shore', weak: { conch: 'shield', eye: 'crit' } },
  tidecaller: { zone: 'shore', weak: { staff_pearl: 'break' } },
  wreck_warden: { zone: 'shore', boss: true, weak: { porthole: 'crit', barnacles: 'break' } },
  thornstag: { zone: 'thicket', weak: { heartwood: 'crit', antlers: 'break' } },
  mime: { zone: 'thicket', weak: { mask: 'crit' } },
  bloomwitch: { zone: 'thicket', weak: { bloom: 'break' } },
  bellwether: { zone: 'thicket', boss: true, weak: { bell_clapper: 'break', eye: 'crit' } },
  coghound: { zone: 'spire', weak: { mainspring: 'crit' } },
  sentinel: { zone: 'spire', weak: { clockface: 'shield', crack: 'break' } },
  hourwraith: { zone: 'spire', weak: { pendulum: 'crit' } },
  stillkeeper: { zone: 'summit', boss: true, weak: { halo: 'break', heart_gear: 'crit' } },
  dummy: { zone: 'training', weak: { target: 'crit' } },
};
const HIT_TYPES = ['normal', 'unparryable', 'jump', 'gradient', 'feint'];
const MELEE = ['slash', 'thrust', 'slam', 'bite', 'spin', 'charge'];
const RANGED = ['bolt', 'wave', 'beam', 'nova', 'cast'];
const ANIMS = [...MELEE, ...RANGED];
const ELEMENTS = ['physical', 'fire', 'ice', 'lightning', 'earth', 'light', 'dark'];
const STATUSES = ['burn', 'chill', 'mark', 'powerful', 'shell', 'haste', 'slow', 'weakened', 'defenseless', 'stun', 'regen', 'silence'];
const NEGATIVE_STATUSES = ['burn', 'chill', 'mark', 'slow', 'weakened', 'defenseless', 'stun', 'silence'];
const EFFECT_TYPES = ['status', 'heal', 'revive', 'ap', 'cleanse', 'dispel', 'shieldBreak', 'break', 'gradient', 'surge', 'glyph', 'stance', 'shield'];
const ENEMY_EFFECT_TYPES = ['status', 'heal', 'shield', 'cleanse', 'dispel'];
const EFFECT_TARGETS = ['self', 'allies', 'target'];
const RELIC_IDS = [
  'dawn_locket', 'riposte_pin', 'tidal_charm', 'duelists_ribbon', 'feather_step', 'ember_edge', 'frost_edge',
  'last_light', 'second_wind', 'verdant_brooch', 'shatterglass', 'keen_whetstone', 'anvil_heart', 'marksmans_eye',
  'hunters_mark', 'opening_gambit', 'prism_shard', 'glass_rose', 'cinder_seal', 'storm_seal', 'rime_seal',
  'sun_fragment', 'executioners_coin', 'warding_bell', 'stillwater_pearl', 'metronome', 'aegis_thread',
  'quickened_gear', 'thorn_wreath', 'mending_quill',
];
const CONDITION_KEYS = ['selfHpBelow', 'allyHpBelow', 'shieldsBelow', 'notStatus'];
const MELEE_APPROACH_TIME = 450;

const enemies = Object.values(ENEMIES);
const allAttacks = enemies.flatMap((e) => Object.values(e.attacks).map((a) => ({ e, a })));
const isInt = (n) => Number.isInteger(n);
const types = (a) => a.hits.map((h) => h.type);
const poolsOf = (e) => [e.pool, ...(e.phases || []).map((p) => p.pool)];
const nonFeint = (a) => a.hits.filter((h) => h.type !== 'feint');

function checkEffect(where, ef) {
  assert.ok(EFFECT_TYPES.includes(ef.type), `${where}: effect type ${ef.type}`);
  assert.ok(ENEMY_EFFECT_TYPES.includes(ef.type), `${where}: ${ef.type} is not an enemy-side effect`);
  assert.ok(EFFECT_TARGETS.includes(ef.target), `${where}: effect target ${ef.target}`);
  if (ef.type === 'status') {
    assert.ok(STATUSES.includes(ef.status), `${where}: status ${ef.status}`);
    assert.ok(isInt(ef.turns) && ef.turns >= 1, `${where}: status turns`);
    if (ef.chance !== undefined) assert.ok(ef.chance > 0 && ef.chance <= 1, `${where}: chance`);
  }
  if (ef.type === 'heal') {
    assert.ok((ef.pct > 0 && ef.pct <= 1) || ef.power > 0, `${where}: heal pct/power`);
    assert.equal(ef.target, 'allies', `${where}: enemy heals target allies`);
  }
  if (ef.type === 'shield') {
    assert.ok(isInt(ef.amount) && ef.amount >= 1, `${where}: shield amount`);
    assert.ok(['self', 'allies'].includes(ef.target), `${where}: shield target`);
  }
}

// ---------------------------------------------------------------------------------------------------------------

test('roster: exactly the 13 fixed ids, keys match ids, looks match ids', () => {
  assert.deepEqual([...Object.keys(ENEMIES)].sort(), Object.keys(ROSTER).sort());
  assert.deepEqual([...ENEMY_IDS].sort(), Object.keys(ROSTER).sort());
  for (const [key, e] of Object.entries(ENEMIES)) {
    assert.equal(e.id, key);
    assert.equal(e.look, key, `${key}: look id must equal the roster id (SPRITES LOOK_IDS)`);
    assert.equal(typeof e.name, 'string');
    assert.ok(e.name.length > 2);
    assert.equal(typeof e.bio, 'string');
    assert.ok(e.bio.length > 60, `${key}: bio`);
    assert.match(key, /^[a-z][a-z0-9_]*$/);
  }
});

test('roster: zones, boss flags and weak point ids/effects match SPEC §3.7', () => {
  for (const [id, spec] of Object.entries(ROSTER)) {
    const e = ENEMIES[id];
    assert.equal(e.zone, spec.zone, `${id} zone`);
    assert.equal(Boolean(e.boss), Boolean(spec.boss), `${id} boss flag`);
    const got = Object.fromEntries(e.weakPoints.map((w) => [w.id, w.effect]));
    assert.deepEqual(got, spec.weak, `${id} weak points`);
    assert.equal(e.weakPoints.length, Object.keys(spec.weak).length, `${id}: duplicate weak point`);
  }
});

test('stats, affinities, shields, break, rewards are well-formed', () => {
  for (const e of enemies) {
    const s = e.stats;
    for (const k of ['hp', 'atk', 'def', 'spd']) assert.ok(typeof s[k] === 'number' && s[k] >= 0, `${e.id}.${k}`);
    assert.ok(s.hp > 0 && s.atk > 0 && s.spd > 0, `${e.id}: positive hp/atk/spd`);
    assert.ok(s.crit >= 0 && s.crit <= 0.6, `${e.id}: crit`);
    assert.ok(isInt(e.level) && e.level >= 1 && e.level <= 20, `${e.id}: level`);
    for (const [el, v] of Object.entries(e.affinities)) {
      assert.ok(ELEMENTS.includes(el), `${e.id}: affinity element ${el}`);
      assert.ok([1.5, 0.5, 0].includes(v), `${e.id}: affinity value ${v}`);
    }
    if (e.shields !== undefined) assert.ok(isInt(e.shields) && e.shields >= 0, `${e.id}: shields`);
    if (e.boss) assert.ok(e.breakMax >= 250 && e.breakMax <= 400, `${e.id}: boss breakMax`);
    else assert.ok(e.breakMax >= 60 && e.breakMax <= 130, `${e.id}: regular breakMax ~100`);
    assert.ok(isInt(e.xp) && e.xp >= 0 && isInt(e.glint) && e.glint >= 0, `${e.id}: xp/glint`);
    if (e.statusResist) for (const st of e.statusResist) assert.ok(STATUSES.includes(st), `${e.id}: resist ${st}`);
    if (e.scale !== undefined) assert.ok(e.scale > 0);
  }
  assert.equal(ENEMIES.shellguard.shields, 2);
  assert.equal(ENEMIES.sentinel.shields, 3);
  const shieldedBosses = enemies.filter((e) => e.boss && e.shields > 0);
  assert.ok(shieldedBosses.length >= 2, 'a couple of bosses carry shields');
  // Every party element has at least one enemy weak to it (rewards the party's options).
  for (const el of ['fire', 'ice', 'lightning', 'earth', 'light', 'physical']) {
    assert.ok(enemies.some((e) => e.affinities[el] === 1.5), `someone is weak to ${el}`);
  }
  assert.ok(enemies.filter((e) => Object.values(e.affinities).some((v) => v < 1)).length >= 8, 'resistances make players think');
});

test('drops reference only fixed relic ids; minibosses guarantee a relic, the final boss pays in Glint', () => {
  for (const e of enemies) {
    assert.ok(Array.isArray(e.drops));
    for (const d of e.drops) {
      assert.ok(RELIC_IDS.includes(d.relic), `${e.id}: unknown relic ${d.relic}`);
      assert.ok(d.chance > 0 && d.chance <= 1, `${e.id}: chance`);
      if (!e.boss) assert.ok(d.chance <= 0.1, `${e.id}: regular drop chances stay low`);
    }
    // A relic that only drops after the final battle could never be used, so only the minibosses guarantee one.
    if (e.boss && e.id !== 'stillkeeper') assert.ok(e.drops.some((d) => d.chance === 1), `${e.id}: guaranteed boss drop`);
  }
  assert.ok(!ENEMIES.stillkeeper.drops.some((d) => d.chance === 1), 'no relic is locked behind the final boss');
  assert.ok(ENEMIES.stillkeeper.glint > ENEMIES.bellwether.glint * 3, 'the final boss pays out in Glint instead');
  const starting = ['riposte_pin', 'mending_quill', 'opening_gambit'];
  for (const e of enemies) for (const d of e.drops) assert.ok(!starting.includes(d.relic), `${e.id} drops a starting relic`);
});

test('attacks: schema, closed sets, effects', () => {
  for (const { e, a } of allAttacks) {
    const where = `${e.id}.${a.id}`;
    assert.equal(e.attacks[a.id], a, `${where}: key must equal id`);
    assert.match(a.id, /^[a-z][a-z0-9_]*$/);
    assert.equal(typeof a.name, 'string');
    assert.ok(a.name.length > 2);
    assert.equal(typeof a.desc, 'string');
    assert.ok(a.desc.length > 10, `${where}: desc`);
    assert.ok(['single', 'all', 'multi'].includes(a.target), `${where}: target`);
    assert.ok(['melee', 'ranged', 'stay'].includes(a.approach), `${where}: approach`);
    assert.ok(ANIMS.includes(a.anim), `${where}: anim`);
    assert.ok(a.weight > 0, `${where}: weight`);
    if (a.cooldown !== undefined) assert.ok(isInt(a.cooldown) && a.cooldown >= 0, `${where}: cooldown`);
    if (a.condition) {
      for (const [k, v] of Object.entries(a.condition)) {
        assert.ok(CONDITION_KEYS.includes(k), `${where}: condition key ${k}`);
        if (k === 'notStatus') assert.ok(STATUSES.includes(v), `${where}: notStatus`);
        else if (k === 'shieldsBelow') assert.ok(isInt(v) && v >= 1, `${where}: shieldsBelow`);
        else assert.ok(v > 0 && v < 1, `${where}: ${k} is a fraction`);
      }
    }
    assert.ok(Array.isArray(a.hits), `${where}: hits array`);
    for (const ef of a.effects || []) checkEffect(where, ef);
    if (a.hits.length === 0) {
      assert.equal(a.anim, 'cast', `${where}: non-damaging actions use anim cast`);
      assert.equal(a.approach, 'stay', `${where}: non-damaging actions stay`);
      assert.ok((a.effects || []).length > 0, `${where}: a non-damaging action must do something`);
    } else {
      assert.equal(a.anim, a.hits[0].anim, `${where}: primary anim = first hit's anim`);
    }
    for (const [i, h] of a.hits.entries()) {
      const hw = `${where}[${i}]`;
      assert.ok(typeof h.t === 'number' && h.t > 0, `${hw}: t`);
      assert.ok(HIT_TYPES.includes(h.type), `${hw}: type ${h.type}`);
      assert.ok(ANIMS.includes(h.anim) && h.anim !== 'cast', `${hw}: anim ${h.anim}`);
      assert.ok(ELEMENTS.includes(h.element), `${hw}: element ${h.element}`);
      assert.ok(typeof h.windup === 'number' && h.windup >= 120 && h.windup <= 1100, `${hw}: windup ${h.windup} within 120–1100`);
      if (h.type === 'feint') {
        assert.equal(h.power, 0, `${hw}: feints deal no damage`);
        assert.equal(h.status, undefined, `${hw}: feints carry no status`);
      } else {
        assert.ok(h.power > 0 && h.power <= 3, `${hw}: power`);
      }
      if (h.status) {
        assert.ok(NEGATIVE_STATUSES.includes(h.status.id), `${hw}: hit status ${h.status.id}`);
        assert.ok(isInt(h.status.turns) && h.status.turns >= 1, `${hw}: status turns`);
        assert.ok(h.status.chance > 0 && h.status.chance <= 1, `${hw}: status chance`);
      }
      if (h.type === 'jump') assert.ok(['wave', 'spin', 'charge', 'slam'].includes(h.anim), `${hw}: jump hits travel along the ground`);
    }
    // Animation families must agree with the approach.
    for (const h of a.hits) {
      if (a.approach === 'melee') assert.ok(MELEE.includes(h.anim) || ['wave', 'nova'].includes(h.anim), `${where}: ${h.anim} in a melee attack`);
      else assert.ok(RANGED.includes(h.anim), `${where}: ${h.anim} in a ${a.approach} attack`);
    }
  }
  assert.equal(DEFAULT_WINDUP, 350);
});

test('timelines obey SPEC §4.8 rules', () => {
  for (const { e, a } of allAttacks) {
    const where = `${e.id}.${a.id}`;
    const hits = a.hits;
    if (!hits.length) {
      assert.ok(a.duration >= 800, `${where}: cast duration`);
      continue;
    }
    for (let i = 1; i < hits.length; i++) assert.ok(hits[i].t > hits[i - 1].t, `${where}: hits sorted by t`);
    const minFirst = a.approach === 'melee' ? 850 : 600;
    assert.ok(hits[0].t >= minFirst, `${where}: first hit t=${hits[0].t} < ${minFirst}`);
    const nf = nonFeint(a);
    assert.ok(nf.length >= 1, `${where}: at least one real hit`);
    for (let i = 1; i < nf.length; i++) {
      assert.ok(nf[i].t - nf[i - 1].t >= 170, `${where}: non-feint hits ${nf[i - 1].t}→${nf[i].t} closer than 170 ms`);
    }
    const feints = hits.filter((h) => h.type === 'feint');
    assert.ok(feints.length <= 1, `${where}: at most one feint`);
    assert.notEqual(hits[hits.length - 1].type, 'feint', `${where}: a feint is never last`);
    assert.ok(a.duration >= hits[hits.length - 1].t + 400, `${where}: duration ≥ last t + 400`);
    assert.ok(a.duration <= hits[hits.length - 1].t + 900, `${where}: no dead air after the last hit`);
  }
});

test('choreography: wind-ups never overlap, feints and input switches stay fair', () => {
  for (const { e, a } of allAttacks) {
    const where = `${e.id}.${a.id}`;
    const hits = a.hits;
    hits.forEach((h, i) => {
      const room = i === 0 ? h.t - (a.approach === 'melee' ? MELEE_APPROACH_TIME : 0) : h.t - hits[i - 1].t;
      assert.ok(h.windup <= room, `${where}[${i}]: windup ${h.windup} exceeds the ${room} ms available`);
      if (h.type === 'feint') {
        const gap = hits[i + 1].t - h.t;
        assert.ok(gap >= 400 && gap <= 800, `${where}: feint → real hit gap ${gap} should be 400–800 ms`);
      }
    });
    const nf = nonFeint(a);
    for (let i = 1; i < nf.length; i++) {
      const gap = nf[i].t - nf[i - 1].t;
      const pair = [nf[i - 1].type, nf[i].type];
      if (pair.includes('jump')) assert.ok(gap >= 300, `${where}: jump next to another hit needs ≥ 300 ms (got ${gap})`);
      if (pair.includes('gradient')) assert.ok(gap >= 350, `${where}: gradient next to another hit needs ≥ 350 ms (got ${gap})`);
    }
  }
});

test('pools and phases', () => {
  for (const e of enemies) {
    const pools = poolsOf(e);
    const used = new Set(pools.flat());
    for (const id of Object.keys(e.attacks)) assert.ok(used.has(id), `${e.id}.${id} is never used by any pool`);
    for (const [pi, pool] of pools.entries()) {
      assert.ok(pool.length >= 2, `${e.id} phase ${pi}: pool size`);
      assert.equal(new Set(pool).size, pool.length, `${e.id} phase ${pi}: duplicate pool entry`);
      for (const id of pool) assert.ok(e.attacks[id], `${e.id}: pool references unknown attack ${id}`);
      const damaging = pool.filter((id) => e.attacks[id].hits.length > 0);
      const unconditional = damaging.filter((id) => !e.attacks[id].condition);
      assert.ok(unconditional.length >= 2, `${e.id} phase ${pi}: needs ≥ 2 always-available damaging attacks`);
      if (e.boss) assert.ok(damaging.length >= 4, `${e.id} phase ${pi}: bosses need ≥ 4 attacks per phase`);
      else assert.ok(damaging.length >= 2, `${e.id}: regulars need ≥ 2 attacks`);
    }
    if (e.phases) {
      assert.ok(e.boss, `${e.id}: only bosses change phase`);
      let last = 1;
      for (const ph of e.phases) {
        assert.ok(ph.hpBelow > 0 && ph.hpBelow < last, `${e.id}: phases descend in hpBelow`);
        last = ph.hpBelow;
        assert.equal(typeof ph.text, 'string');
        assert.ok(ph.text.length > 10, `${e.id}: phase text`);
        for (const ef of ph.effects || []) checkEffect(`${e.id} phase`, ef);
        for (const [k, v] of Object.entries(ph.statMult || {})) {
          assert.ok(['spd', 'atk'].includes(k), `${e.id}: statMult key ${k}`);
          assert.ok(v > 0 && v <= 1.5, `${e.id}: statMult ${k}`);
        }
      }
    }
  }
});

test('mini-bosses and the Stillkeeper follow their briefs', () => {
  const warden = ENEMIES.wreck_warden;
  assert.equal(warden.phases.length, 1);
  assert.equal(warden.phases[0].hpBelow, 0.5);
  assert.ok(Object.keys(warden.attacks).length >= 4);
  const bell = ENEMIES.bellwether;
  assert.ok(Object.values(bell.attacks).some((a) => types(a).includes('gradient')), 'Bellwether introduces gradient');
  assert.ok(Object.values(bell.attacks).some((a) => types(a).filter((t) => t === 'jump').length >= 3), 'Bellwether triple shockwave rolls');

  const sk = ENEMIES.stillkeeper;
  assert.equal(sk.phases.length, 1, 'two phases');
  const p2 = sk.phases[0];
  assert.equal(p2.hpBelow, 0.5);
  assert.match(p2.text, /unwound/i);
  assert.ok(p2.statMult.spd > 1, 'phase 2 is faster');
  const p2Attacks = p2.pool.map((id) => sk.attacks[id]);
  const newInP2 = p2.pool.filter((id) => !sk.pool.includes(id));
  assert.ok(newInP2.length >= 4, 'phase 2 brings a new pool');
  const cadenza = p2Attacks.find((a) => nonFeint(a).length >= 7);
  assert.ok(cadenza, 'a 7-hit combo');
  const gaps = nonFeint(cadenza).slice(1).map((h, i) => h.t - nonFeint(cadenza)[i].t);
  assert.ok(new Set(gaps).size >= 3, 'the 7-hit combo is syncopated (irregular gaps)');
  assert.ok(p2Attacks.some((a) => types(a).includes('jump') && types(a).includes('gradient')), 'a jump + gradient sequence');
  assert.ok(p2Attacks.some((a) => a.target === 'all' && (a.hits.some((h) => h.status?.id === 'slow')
    || (a.effects || []).some((ef) => ef.status === 'slow'))), 'a party-wide slow');
  assert.ok(p2Attacks.some((a) => a.condition?.selfHpBelow), 'a desperate move');
});

test('zones introduce mechanics gradually (SPEC §4.8)', () => {
  const byZone = (z) => enemies.filter((e) => e.zone === z);
  const shoreAttacks = byZone('shore').flatMap((e) => Object.values(e.attacks).map((a) => ({ e, a })));
  // Shore: normal + jump + exactly one unparryable attack (on the Warden); no feints or gradients yet.
  for (const { e, a } of shoreAttacks) {
    assert.ok(!types(a).includes('feint'), `${e.id}.${a.id}: no feints on the shore`);
    assert.ok(!types(a).includes('gradient'), `${e.id}.${a.id}: no gradients on the shore`);
  }
  const shoreUnparryable = shoreAttacks.filter(({ a }) => types(a).includes('unparryable'));
  assert.equal(shoreUnparryable.length, 1, 'exactly one unparryable attack on the shore');
  assert.equal(shoreUnparryable[0].e.id, 'wreck_warden');
  for (const id of ['driftling', 'shellguard']) {
    for (const a of Object.values(ENEMIES[id].attacks)) {
      for (const h of a.hits) assert.equal(h.type, 'normal', `${id}.${a.id}: tutorial enemies only use normal hits`);
    }
  }
  assert.ok(Object.values(ENEMIES.driftling.attacks).every((a) => a.hits.length <= 2), 'Driftling: 1–2 hit rhythms');
  assert.ok(Object.values(ENEMIES.shellguard.attacks).some((a) => a.hits.length === 3), 'Shellguard: 3-hit combo');
  assert.ok(Object.values(ENEMIES.shellguard.attacks).some((a) => a.hits.some((h) => h.windup >= 700)), 'Shellguard: delayed slam');
  assert.ok(Object.values(ENEMIES.shellguard.attacks).some((a) => (a.effects || []).some((ef) => ef.type === 'shield')), 'Shellguard: shield restore');
  const tide = Object.values(ENEMIES.tidecaller.attacks);
  assert.ok(tide.some((a) => types(a).includes('jump')), 'Tidecaller: first jump attacks');
  assert.ok(tide.some((a) => a.hits.some((h) => h.anim === 'bolt')), 'Tidecaller: ranged bolts');
  assert.ok(tide.some((a) => (a.effects || []).some((ef) => ef.type === 'heal')), 'Tidecaller: heal');
  const warden = Object.values(ENEMIES.wreck_warden.attacks);
  assert.ok(warden.some((a) => types(a).filter((t) => t === 'jump').length >= 3), 'Warden: jump rolls');
  assert.ok(warden.some((a) => a.hits.some((h) => h.windup >= 900)), 'Warden: delayed chains');

  // Thicket: gradient only on the Bellwether; feints (Mime), unparryable charges (Thornstag), AoE + heals (Bloomwitch).
  for (const e of byZone('thicket')) {
    if (e.id === 'bellwether') continue;
    for (const a of Object.values(e.attacks)) assert.ok(!types(a).includes('gradient'), `${e.id}.${a.id}: gradient is the Bellwether's lesson`);
  }
  assert.ok(Object.values(ENEMIES.mime.attacks).filter((a) => types(a).includes('feint')).length >= 2, 'Mime: feints');
  assert.ok(Object.values(ENEMIES.thornstag.attacks).some((a) => a.hits.some((h) => h.type === 'unparryable' && h.anim === 'charge')), 'Thornstag: unparryable charge');
  const bloom = Object.values(ENEMIES.bloomwitch.attacks);
  assert.ok(bloom.some((a) => a.target === 'all' && a.hits.some((h) => h.anim === 'nova')), 'Bloomwitch: AoE novas');
  assert.ok(bloom.some((a) => (a.effects || []).some((ef) => ef.type === 'heal' && ef.target === 'allies')), 'Bloomwitch: ally heals');

  // Spire: rapid bursts, pendulum delays + metronomic strings + shields, gradient + slow.
  const burst = (a) => {
    const nf = nonFeint(a); let run = 0; let best = 0;
    for (let i = 1; i < nf.length; i++) {
      const g = nf[i].t - nf[i - 1].t;
      run = g >= 180 && g <= 220 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  };
  assert.ok(Object.values(ENEMIES.coghound.attacks).some((a) => burst(a) >= 3), 'Coghound: rapid 180–220 ms bursts');
  const sent = Object.values(ENEMIES.sentinel.attacks);
  assert.ok(sent.some((a) => a.hits.some((h) => h.windup >= 1000)), 'Sentinel: long pendulum delay');
  const metro = sent.find((a) => nonFeint(a).length >= 6);
  assert.ok(metro, 'Sentinel: 6-hit string');
  const mg = metro.hits.slice(1).map((h, i) => h.t - metro.hits[i].t);
  assert.equal(new Set(mg).size, 1, 'Sentinel: the 6-hit string is metronomic');
  assert.ok(sent.some((a) => (a.effects || []).some((ef) => ef.type === 'shield')), 'Sentinel: shield restore');
  const wraith = Object.values(ENEMIES.hourwraith.attacks);
  assert.ok(wraith.some((a) => types(a).includes('gradient')), 'Hour Wraith: gradient');
  assert.ok(wraith.some((a) => a.hits.some((h) => h.status?.id === 'slow')), 'Hour Wraith: slow');
});

test('rhythm variety across the bestiary', () => {
  const damaging = allAttacks.filter(({ e, a }) => e.id !== 'dummy' && a.hits.length);
  const delayed = damaging.filter(({ a }) => a.hits.some((h) => h.windup >= 700));
  const rolls = damaging.filter(({ a }) => {
    let run = 0; let best = 0;
    for (const h of a.hits) { run = h.type === 'jump' ? run + 1 : 0; best = Math.max(best, run); }
    return best >= 3;
  });
  const syncopated = damaging.filter(({ a }) => {
    const nf = nonFeint(a);
    if (nf.length < 3) return false;
    const gaps = nf.slice(1).map((h, i) => h.t - nf[i].t);
    return Math.max(...gaps) >= 1.8 * Math.min(...gaps);
  });
  const triplets = damaging.filter(({ a }) => {
    const nf = nonFeint(a);
    for (let i = 2; i < nf.length; i++) if (nf[i].t - nf[i - 1].t === nf[i - 1].t - nf[i - 2].t) return true;
    return false;
  });
  assert.ok(delayed.length >= 10, `delayed swings: ${delayed.length}`);
  assert.ok(rolls.length >= 5, `shockwave rolls: ${rolls.length}`);
  assert.ok(syncopated.length >= 10, `syncopated combos: ${syncopated.length}`);
  assert.ok(triplets.length >= 8, `steady triplets: ${triplets.length}`);
  for (const t of ['normal', 'unparryable', 'jump', 'gradient', 'feint']) {
    assert.ok(damaging.some(({ a }) => types(a).includes(t)), `some enemy uses ${t}`);
  }
});

test('training mannequin: one gentle example per hit type plus a medley', () => {
  const d = ENEMIES.dummy;
  const atks = Object.values(d.attacks);
  for (const t of ['normal', 'unparryable', 'jump', 'gradient']) {
    assert.ok(atks.some((a) => a.hits.length === 1 && a.hits[0].type === t), `dummy: single ${t} example`);
  }
  assert.ok(atks.some((a) => types(a).includes('feint') && a.hits.length === 2), 'dummy: feint example');
  const medley = atks.find((a) => HIT_TYPES.filter((t) => t !== 'unparryable').every((t) => types(a).includes(t)));
  assert.ok(medley, 'dummy: mixed medley');
  assert.ok(d.stats.atk <= 12, 'dummy hits very softly');
  assert.equal(d.xp, 0);
  assert.equal(d.drops.length, 0);
  for (const a of atks) for (const h of a.hits) assert.ok(h.windup >= 400, `dummy.${a.id}: generous wind-ups`);
});

test('rhythm sheet (printed): every attack as a 50 ms score — • normal  ! unparryable  ^ jump  ◆ gradient  ~ feint', (t) => {
  const glyph = { normal: '•', unparryable: '!', jump: '^', gradient: '◆', feint: '~' };
  const STEP = 50;
  for (const e of enemies) {
    for (const a of Object.values(e.attacks)) {
      if (!a.hits.length) {
        t.diagnostic(`${`${e.id}.${a.id}`.padEnd(34)} (cast: ${(a.effects || []).map((ef) => ef.type).join(', ')})`);
        continue;
      }
      const cells = Array.from({ length: Math.ceil(a.duration / STEP) + 1 }, () => '·');
      for (const h of a.hits) {
        const from = Math.max(0, Math.round((h.t - h.windup) / STEP));
        const at = Math.round(h.t / STEP);
        for (let i = from; i < at; i++) if (cells[i] === '·') cells[i] = '-';
        cells[at] = glyph[h.type];
      }
      t.diagnostic(`${`${e.id}.${a.id}`.padEnd(34)} ${cells.join('')}`);
    }
  }
  assert.ok(true);
});

test('lookup helpers', () => {
  assert.equal(getEnemy('mime'), ENEMIES.mime);
  assert.equal(getEnemy('nope'), null);
  assert.equal(getEnemy('toString'), null);
  assert.equal(getAttack('mime', 'false_lunge'), ENEMIES.mime.attacks.false_lunge);
  assert.equal(getAttack('mime', 'nope'), null);
  assert.equal(getAttack('nope', 'x'), null);
  const sk = ENEMIES.stillkeeper;
  assert.deepEqual(phaseAt(sk, 1).pool, sk.pool);
  assert.equal(phaseAt(sk, 0.6).phaseIndex, 0);
  const p = phaseAt(sk, 0.3);
  assert.equal(p.phaseIndex, 1);
  assert.deepEqual(p.pool, sk.phases[0].pool);
  assert.equal(p.statMult.spd, 1.3);
  assert.equal(phaseAt(ENEMIES.driftling, 0.1).phaseIndex, 0);
  assert.equal(damagingHits(ENEMIES.mime.attacks.false_lunge).length, 1);
});
