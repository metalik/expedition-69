// Validates PARTY content data (characters, skills, relics, items, shops) against SPEC §3.1, §3.3–3.5, §4.8.
// Run: node --test tests/game-*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHARACTERS, PARTY_ORDER } from '../src/data/characters.js';
import { SKILLS, skillIdsFor, skillBasePower } from '../src/data/skills.js';
import { RELICS, STARTING_RELICS, passiveText, formatStats } from '../src/data/relics.js';
import { ITEMS, UPGRADES, ITEM_ORDER } from '../src/data/items.js';
import { SHOPS } from '../src/data/shops.js';
import { derivedStats } from '../src/game/progression.js';

const ELEMENTS = ['physical', 'fire', 'ice', 'lightning', 'earth', 'light', 'dark'];
const ANIMS = ['slash', 'thrust', 'flurry', 'heavy', 'leap', 'spin', 'cast', 'buff', 'heal', 'shoot', 'gradient'];
const TARGETS = ['enemy', 'allEnemies', 'ally', 'allAllies', 'self', 'deadAlly', 'randomEnemies'];
const STATUSES = ['burn', 'chill', 'mark', 'powerful', 'shell', 'haste', 'slow', 'weakened', 'defenseless', 'stun', 'regen', 'silence'];
const GLYPHS = ['fire', 'ice', 'storm', 'earth', 'light'];
const STANCES = ['neutral', 'assault', 'guard', 'virtuoso'];
const PARTY_EFFECTS = ['status', 'heal', 'revive', 'ap', 'cleanse', 'dispel', 'shieldBreak', 'break', 'gradient', 'surge', 'glyph', 'stance'];
const PASSIVES = ['startAp', 'parryAp', 'parryHeal', 'perfectDodgeAp', 'counterPower', 'basicStatus', 'lowHpPower', 'secondWind',
  'turnHeal', 'critVsBroken', 'critDamage', 'breakPower', 'shotPower', 'shotMark', 'firstStrike', 'gradientGain', 'glassCannon',
  'elementPower', 'killAp', 'statusImmune', 'perfectPower', 'startStatus', 'hurtAp', 'healPower'];

const FIXED_RELICS = {
  dawn_locket: ['startAp', { amount: 1 }],
  riposte_pin: ['counterPower', { mult: 1.5 }],
  tidal_charm: ['parryHeal', { pct: 0.04 }],
  duelists_ribbon: ['parryAp', { amount: 1 }],
  feather_step: ['perfectDodgeAp', { amount: 1 }],
  ember_edge: ['basicStatus', { status: 'burn', turns: 2, chance: 0.5 }],
  frost_edge: ['basicStatus', { status: 'chill', turns: 2, chance: 0.5 }],
  last_light: ['lowHpPower', { threshold: 0.35, mult: 1.35 }],
  second_wind: ['secondWind', {}],
  verdant_brooch: ['turnHeal', { pct: 0.05 }],
  shatterglass: ['critVsBroken', { bonus: 0.35 }],
  keen_whetstone: ['critDamage', { bonus: 0.3 }],
  anvil_heart: ['breakPower', { mult: 1.4 }],
  marksmans_eye: ['shotPower', { mult: 1.5 }],
  hunters_mark: ['shotMark', { chance: 0.6 }],
  opening_gambit: ['firstStrike', { mult: 1.6 }],
  prism_shard: ['gradientGain', { mult: 1.3 }],
  glass_rose: ['glassCannon', { dealt: 1.3, taken: 1.3 }],
  cinder_seal: ['elementPower', { element: 'fire', mult: 1.3 }],
  storm_seal: ['elementPower', { element: 'lightning', mult: 1.3 }],
  rime_seal: ['elementPower', { element: 'ice', mult: 1.3 }],
  sun_fragment: ['elementPower', { element: 'light', mult: 1.3 }],
  executioners_coin: ['killAp', { amount: 2 }],
  warding_bell: ['statusImmune', { status: 'stun' }],
  stillwater_pearl: ['statusImmune', { status: 'slow' }],
  metronome: ['perfectPower', { mult: 1.15 }],
  aegis_thread: ['startStatus', { status: 'shell', turns: 3 }],
  quickened_gear: ['startStatus', { status: 'haste', turns: 3 }],
  thorn_wreath: ['hurtAp', { amount: 1 }],
  mending_quill: ['healPower', { mult: 1.35 }],
};

const EXPECTED = {
  1: { hp: 350, atk: 36, def: 18, spd: 45 },
  5: { hp: 700, atk: 58, def: 32, spd: 52 },
  10: { hp: 1250, atk: 95, def: 52, spd: 60 },
  15: { hp: 1900, atk: 135, def: 72, spd: 68 },
};

// ───────────────────────── characters ─────────────────────────

test('party order and §3.1 base stats', () => {
  assert.deepEqual(PARTY_ORDER, ['gideon', 'nyra', 'sable']);
  assert.deepEqual(Object.keys(CHARACTERS).sort(), ['gideon', 'nyra', 'sable']);
  assert.deepEqual(CHARACTERS.gideon.base, { hp: 420, atk: 34, def: 22, spd: 40, crit: 0.05 });
  assert.deepEqual(CHARACTERS.nyra.base, { hp: 300, atk: 38, def: 14, spd: 44, crit: 0.05 });
  assert.deepEqual(CHARACTERS.sable.base, { hp: 340, atk: 36, def: 17, spd: 52, crit: 0.12 });
  assert.equal(CHARACTERS.gideon.mechanic, 'surge');
  assert.equal(CHARACTERS.nyra.mechanic, 'glyphs');
  assert.equal(CHARACTERS.sable.mechanic, 'stance');
  assert.equal(CHARACTERS.gideon.shotElement, 'lightning');
  assert.equal(CHARACTERS.nyra.shotElement, 'light');
  assert.equal(CHARACTERS.sable.shotElement, 'physical');
});

test('character records are complete', () => {
  for (const id of PARTY_ORDER) {
    const c = CHARACTERS[id];
    assert.equal(c.id, id);
    assert.equal(c.look, id);
    for (const k of ['name', 'title', 'color', 'bio', 'mechanicName', 'mechanicDesc', 'role']) {
      assert.equal(typeof c[k], 'string', `${id}.${k}`);
      assert.ok(c[k].length > 0, `${id}.${k} empty`);
    }
    assert.match(c.color, /^#[0-9a-f]{6}$/i);
    const sentences = c.bio.split(/[.!?](\s|$)/).filter((s) => s && s.trim().length > 3);
    assert.ok(sentences.length >= 2 && sentences.length <= 4, `${id} bio should be 2–3 sentences`);
    for (const k of ['hp', 'atk', 'def', 'spd']) assert.ok(c.growth[k] > 0, `${id}.growth.${k}`);
    // basic attack
    const ba = c.basicAttack;
    assert.ok(ANIMS.includes(ba.anim));
    assert.ok(ELEMENTS.includes(ba.element));
    const total = ba.hits.reduce((s, h) => s + h.power, 0);
    assert.ok(Math.abs(total - 1.0) < 0.05, `${id} basic attack total power ≈ 1.0 (got ${total})`);
    // gradient + starting skills
    assert.ok(SKILLS[c.gradientSkill]?.gradient, `${id} gradient skill`);
    assert.equal(SKILLS[c.gradientSkill].owner, id);
    assert.equal(c.startingSkills.length, 2);
    for (const s of c.startingSkills) {
      assert.equal(SKILLS[s]?.owner, id, `${id} starting skill ${s}`);
      assert.equal(SKILLS[s].learn.level, 1);
      assert.ok(!SKILLS[s].gradient);
    }
  }
  assert.equal(CHARACTERS.gideon.basicAttack.hits.length, 2);
  assert.equal(CHARACTERS.nyra.basicAttack.hits.length, 1);
  assert.equal(CHARACTERS.sable.basicAttack.hits.length, 2);
});

test('stat curve with an even attribute spread matches the §3.3 table within ±15%', () => {
  for (const [lvl, exp] of Object.entries(EXPECTED)) {
    const L = Number(lvl);
    const each = (3 * (L - 1)) / 5; // even spread of all attribute points
    const attrs = { vitality: each, might: each, agility: each, defense: each, luck: each };
    const stats = PARTY_ORDER.map((id) => derivedStats({ id, level: L, attrs, relics: [] }));
    const avg = (k) => stats.reduce((s, x) => s + x[k], 0) / stats.length;
    const got = { hp: avg('maxHp'), atk: avg('atk'), def: avg('def'), spd: avg('spd') };
    for (const k of ['hp', 'atk', 'def', 'spd']) {
      const ratio = got[k] / exp[k];
      assert.ok(ratio >= 0.85 && ratio <= 1.15, `L${L} ${k}: party avg ${got[k].toFixed(1)} vs expected ${exp[k]} (×${ratio.toFixed(3)})`);
    }
  }
});

test('character identities hold across levels (Gideon tankiest, Sable fastest)', () => {
  for (const L of [1, 5, 10, 15]) {
    const s = Object.fromEntries(PARTY_ORDER.map((id) => [id, derivedStats({ id, level: L, attrs: {}, relics: [] })]));
    assert.ok(s.gideon.maxHp > s.sable.maxHp && s.sable.maxHp > s.nyra.maxHp, `HP order at L${L}`);
    assert.ok(s.gideon.def > s.sable.def && s.sable.def > s.nyra.def, `DEF order at L${L}`);
    assert.ok(s.sable.spd > s.nyra.spd && s.nyra.spd > s.gideon.spd, `SPD order at L${L}`);
  }
});

// ───────────────────────── skills ─────────────────────────

function checkEffect(e, where) {
  assert.ok(PARTY_EFFECTS.includes(e.type), `${where}: effect type ${e.type} not in closed party set`);
  switch (e.type) {
    case 'status':
      assert.ok(STATUSES.includes(e.status), `${where}: status ${e.status}`);
      assert.ok(Number.isInteger(e.turns) && e.turns > 0, `${where}: turns`);
      assert.ok(['target', 'self', 'allies', 'enemies'].includes(e.target), `${where}: status target ${e.target}`);
      if (e.chance !== undefined) assert.ok(e.chance > 0 && e.chance <= 1);
      break;
    case 'heal':
      assert.ok((typeof e.pct === 'number' && e.pct > 0 && e.pct <= 1) || (typeof e.power === 'number' && e.power > 0), `${where}: heal amount`);
      assert.ok(['target', 'self', 'allies'].includes(e.target), `${where}: heal target`);
      break;
    case 'revive':
      assert.ok(e.pct > 0 && e.pct <= 1);
      assert.equal(e.target, 'target');
      break;
    case 'ap':
      assert.ok(Number.isInteger(e.amount) && e.amount > 0);
      assert.ok(['target', 'self', 'allies'].includes(e.target), `${where}: ap target`);
      break;
    case 'glyph':
      assert.ok(GLYPHS.includes(e.add), `${where}: glyph ${e.add}`);
      break;
    case 'stance':
      assert.ok(STANCES.includes(e.to), `${where}: stance ${e.to}`);
      break;
    case 'surge':
    case 'shieldBreak':
    case 'break':
    case 'gradient':
      assert.ok(typeof e.amount === 'number' && e.amount > 0, `${where}: amount`);
      break;
    default:
      assert.ok(['target', 'self', 'allies', 'enemies'].includes(e.target), `${where}: target`);
  }
  if (e.when !== undefined) assert.equal(e.when, 'perHit');
}

test('every skill uses only the closed schema', () => {
  for (const [id, s] of Object.entries(SKILLS)) {
    assert.equal(s.id, id);
    assert.ok(PARTY_ORDER.includes(s.owner), `${id} owner`);
    for (const k of ['name', 'desc', 'short']) assert.ok(typeof s[k] === 'string' && s[k].length > 0, `${id}.${k}`);
    assert.ok(TARGETS.includes(s.target), `${id} target ${s.target}`);
    assert.ok(ELEMENTS.includes(s.element), `${id} element`);
    assert.ok(ANIMS.includes(s.anim), `${id} anim ${s.anim}`);
    assert.ok(Array.isArray(s.hits) && Array.isArray(s.effects));
    for (const h of s.hits) {
      assert.ok(h.power > 0, `${id} hit power`);
      assert.equal(h.qte, true, `${id} hits are QTE`);
      if (h.gap !== undefined) assert.ok(h.gap >= 250 && h.gap <= 800, `${id} gap ${h.gap} (QTE prompts need ≥ 250 ms spacing)`);
      if (h.break !== undefined) assert.ok(h.break >= 0);
      if (h.random !== undefined) assert.equal(s.target, 'randomEnemies');
    }
    if (s.target === 'randomEnemies') assert.ok(s.hits.every((h) => h.random === true));
    if (['ally', 'allAllies', 'self', 'deadAlly'].includes(s.target)) assert.equal(s.hits.length, 0, `${id}: support skills deal no damage`);
    s.effects.forEach((e, i) => checkEffect(e, `${id}.effects[${i}]`));
    if (s.surge !== undefined) {
      assert.equal(s.surge, 'consume');
      assert.equal(s.owner, 'gideon');
    }
    if (s.consumeGlyph) {
      assert.equal(s.owner, 'nyra');
      assert.ok(GLYPHS.includes(s.consumeGlyph.glyph));
      assert.ok(s.consumeGlyph.powerMult >= 1);
      s.consumeGlyph.effects.forEach((e, i) => checkEffect(e, `${id}.consumeGlyph.effects[${i}]`));
    }
    if (s.consumeAllGlyphs) {
      assert.equal(s.owner, 'nyra');
      assert.ok(s.consumeAllGlyphs.extraHitPower > 0);
    }
    if (s.bonusVs) {
      assert.ok(s.bonusVs.mult > 1);
      assert.ok(s.bonusVs.broken === true || STATUSES.includes(s.bonusVs.status));
    }
    if (s.critBonus !== undefined) assert.ok(s.critBonus > 0 && s.critBonus <= 0.5);
    if (s.effects.some((e) => e.type === 'stance')) assert.equal(s.owner, 'sable');
    if (s.effects.some((e) => e.type === 'glyph')) assert.equal(s.owner, 'nyra');
    if (s.effects.some((e) => e.type === 'surge')) assert.equal(s.owner, 'gideon');
  }
});

test('each character has exactly 8 regular skills + 1 gradient skill with sane costs and unlocks', () => {
  for (const id of PARTY_ORDER) {
    const regular = Object.values(SKILLS).filter((s) => s.owner === id && !s.gradient);
    const gradient = Object.values(SKILLS).filter((s) => s.owner === id && s.gradient);
    assert.equal(regular.length, 8, `${id} regular skills`);
    assert.equal(gradient.length, 1, `${id} gradient skills`);
    assert.equal(gradient[0].id, CHARACTERS[id].gradientSkill);
    assert.equal(gradient[0].ap, 0);
    assert.ok(gradient[0].hits.length >= 4 && gradient[0].hits.length <= 7, `${id} gradient hit count`);
    assert.ok(skillBasePower(gradient[0]) >= 3.5, `${id} gradient skill should be dramatic`);
    const levels = new Set();
    for (const s of regular) {
      assert.ok(Number.isInteger(s.ap) && s.ap >= 1 && s.ap <= 7, `${s.id} ap ${s.ap}`);
      assert.ok(s.learn.level >= 1 && s.learn.level <= 14, `${s.id} learn level`);
      assert.ok(s.learn.sp >= 1 && s.learn.sp <= 3, `${s.id} sp`);
      levels.add(s.learn.level);
      for (const r of s.learn.requires) {
        assert.equal(SKILLS[r]?.owner, id, `${s.id} requires ${r}`);
        assert.ok(!SKILLS[r].gradient);
        assert.ok(SKILLS[r].learn.level <= s.learn.level, `${s.id} requires a later skill ${r}`);
      }
    }
    assert.ok(levels.size >= 6, `${id} unlocks should be spread over many levels`);
    assert.ok(Math.max(...levels) >= 11, `${id} should have late unlocks`);
    assert.deepEqual(skillIdsFor(id).length, 8);
    assert.equal(skillIdsFor(id, { includeGradient: true }).length, 9);
  }
});

test('skill power follows the balance bands', () => {
  for (const s of Object.values(SKILLS)) {
    if (s.gradient || s.hits.length === 0) continue;
    const p = skillBasePower(s);
    const mechanicScaled = s.surge === 'consume' || !!s.consumeAllGlyphs || !!s.bonusVs || s.ignoreShields
      || (s.consumeGlyph && s.consumeGlyph.powerMult > 1);
    const aoe = s.target === 'allEnemies';
    if (s.ap === 2 && !aoe && !mechanicScaled) assert.ok(p >= 1.8 && p <= 2.4, `${s.id} 2 AP power ${p}`);
    if ((s.ap === 4 || s.ap === 5) && !aoe && !mechanicScaled) assert.ok(p >= 3.5 && p <= 5, `${s.id} ${s.ap} AP power ${p}`);
    if (mechanicScaled) assert.ok(p <= s.ap * 1.2 + 0.4, `${s.id} base power ${p} too high for a scaling skill`);
    assert.ok(p / s.ap <= 1.4, `${s.id} power per AP ${p / s.ap}`);
  }
});

test('mechanics are showcased', () => {
  const g = Object.values(SKILLS).filter((s) => s.owner === 'gideon');
  assert.ok(g.filter((s) => s.surge === 'consume').length >= 2, 'Gideon has ≥2 Surge finishers');
  assert.ok(g.some((s) => s.hits.length >= 3 && !s.surge), 'Gideon multi-hit builder');
  assert.ok(g.some((s) => s.effects.some((e) => e.type === 'surge')), 'Gideon explicit surge gain');
  assert.ok(g.some((s) => s.ignoreShields || s.effects.some((e) => e.type === 'shieldBreak')), 'Gideon shield breaker');
  assert.ok(g.some((s) => s.target === 'allAllies' && s.effects.some((e) => e.type === 'status' && e.target === 'allies')), 'Gideon party buff');
  assert.ok(g.some((s) => s.target === 'ally' && s.effects.some((e) => e.type === 'ap' && e.target === 'target')), 'Gideon AP gift');

  const n = Object.values(SKILLS).filter((s) => s.owner === 'nyra');
  const produced = new Set(n.flatMap((s) => s.effects.filter((e) => e.type === 'glyph').map((e) => e.add)));
  for (const gl of GLYPHS) assert.ok(produced.has(gl), `Nyra produces ${gl}`);
  for (const s of n) {
    if (s.gradient || s.hits.length === 0 || s.consumeAllGlyphs) continue;
    const glyphForElement = { fire: 'fire', ice: 'ice', lightning: 'storm', earth: 'earth', light: 'light' }[s.element];
    assert.ok(s.effects.some((e) => e.type === 'glyph' && e.add === glyphForElement), `${s.id} adds its ${glyphForElement} glyph`);
  }
  assert.ok(n.filter((s) => s.consumeGlyph).length >= 3, 'Nyra has several glyph consumers');
  assert.ok(n.some((s) => s.target === 'ally' && s.consumeGlyph?.glyph === 'light' && s.effects.some((e) => e.type === 'heal')), 'heal consuming light');
  assert.ok(n.some((s) => s.target === 'deadAlly' && s.effects.some((e) => e.type === 'revive')), 'Nyra revive');
  assert.ok(n.some((s) => s.consumeAllGlyphs), 'consumeAllGlyphs finisher');
  assert.ok(n.some((s) => s.target === 'allEnemies' && !s.gradient), 'Nyra AoE');

  const sb = Object.values(SKILLS).filter((s) => s.owner === 'sable');
  const to = (s) => s.effects.filter((e) => e.type === 'stance').map((e) => e.to);
  const assault = sb.filter((s) => !s.gradient && to(s).includes('assault'));
  assert.ok(assault.length >= 3, 'Sable has an assault chain');
  assert.ok(assault.some((s) => CHARACTERS.sable.startingSkills.includes(s.id)), 'a path to virtuoso from level 1');
  assert.ok(sb.some((s) => to(s).includes('guard')), 'Sable guard skill');
  assert.ok(sb.some((s) => s.effects.some((e) => e.type === 'status' && e.status === 'mark')), 'Sable marker');
  assert.ok(sb.some((s) => s.bonusVs && (s.bonusVs.broken || s.bonusVs.status === 'mark')), 'Sable execute');
});

// ───────────────────────── relics ─────────────────────────

test('RELICS contains exactly the 30 fixed ids with the §3.4 passives', () => {
  assert.deepEqual(Object.keys(RELICS).sort(), Object.keys(FIXED_RELICS).sort());
  for (const [id, [pid, params]] of Object.entries(FIXED_RELICS)) {
    const r = RELICS[id];
    assert.equal(r.id, id);
    assert.equal(r.passive.id, pid, `${id} passive id`);
    assert.deepEqual(r.passive.params, params, `${id} passive params`);
    assert.ok(PASSIVES.includes(r.passive.id));
    assert.ok(typeof r.name === 'string' && r.name.length > 2);
    assert.ok(typeof r.desc === 'string' && r.desc.length > 30);
    assert.ok(Number.isInteger(r.echoCost) && r.echoCost >= 1 && r.echoCost <= 5, `${id} echoCost`);
    assert.ok(['common', 'rare', 'legendary'].includes(r.rarity));
    assert.ok(Number.isInteger(r.price) && r.price > 0);
    for (const [k, v] of Object.entries(r.stats)) {
      assert.ok(['hp', 'atk', 'def', 'spd', 'crit'].includes(k), `${id} stat ${k}`);
      assert.ok(typeof v === 'number' && v > 0);
      if (k === 'crit') assert.ok(v <= 0.1);
    }
    assert.ok(passiveText(r.passive).length > 5 && !passiveText(r.passive).includes('undefined'), `${id} passive text`);
    assert.ok(!formatStats(r.stats).includes('undefined'));
  }
  const rarityPrice = (rar) => Object.values(RELICS).filter((r) => r.rarity === rar).map((r) => r.price);
  assert.ok(Math.max(...rarityPrice('common')) < Math.min(...rarityPrice('legendary')));
  assert.deepEqual(STARTING_RELICS, { gideon: 'riposte_pin', nyra: 'mending_quill', sable: 'opening_gambit' });
});

// ───────────────────────── items & shops ─────────────────────────

test('items and upgrades follow §3.5', () => {
  assert.deepEqual(ITEM_ORDER, ['tincture', 'tonic', 'draught']);
  assert.equal(ITEMS.tincture.baseMax, 4);
  assert.equal(ITEMS.tonic.baseMax, 2);
  assert.equal(ITEMS.draught.baseMax, 2);
  assert.deepEqual(ITEMS.tincture.effects, [{ type: 'heal', pct: 0.45, target: 'target' }]);
  assert.deepEqual(ITEMS.tonic.effects, [{ type: 'revive', pct: 0.5, target: 'target' }]);
  assert.deepEqual(ITEMS.draught.effects, [{ type: 'ap', amount: 3, target: 'target' }]);
  assert.equal(ITEMS.tincture.target, 'ally');
  assert.equal(ITEMS.tonic.target, 'deadAlly');
  assert.equal(ITEMS.draught.target, 'ally');
  for (const id of ITEM_ORDER) assert.equal(ITEMS[id].id, id);
  assert.deepEqual(Object.keys(UPGRADES).sort(), ['draught_shard', 'tincture_shard', 'tonic_shard']);
  for (const [id, u] of Object.entries(UPGRADES)) {
    assert.equal(u.item, id.replace('_shard', ''));
    assert.ok(u.name && u.desc);
  }
});

test('shops stock valid ids with escalating prices', () => {
  assert.deepEqual(Object.keys(SHOPS).sort(), ['shore_camp', 'spire_camp', 'thicket_camp']);
  const avg = {};
  for (const [id, shop] of Object.entries(SHOPS)) {
    assert.ok(shop.name && shop.stock.length >= 5, id);
    const relicIds = new Set();
    for (const e of shop.stock) {
      assert.ok(e.kind === 'relic' || e.kind === 'shard');
      if (e.kind === 'relic') {
        assert.ok(RELICS[e.id], `${id} relic ${e.id}`);
        assert.ok(!relicIds.has(e.id), `${id} lists ${e.id} twice`);
        relicIds.add(e.id);
        assert.ok(!Object.values(STARTING_RELICS).includes(e.id), 'starting relics are not sold');
      } else {
        assert.ok(UPGRADES[e.id], `${id} shard ${e.id}`);
      }
      assert.ok(Number.isInteger(e.price) && e.price > 0);
    }
    avg[id] = shop.stock.reduce((s, e) => s + e.price, 0) / shop.stock.length;
  }
  assert.ok(avg.shore_camp < avg.thicket_camp && avg.thicket_camp < avg.spire_camp, 'prices escalate by zone');
  // Shore: a regular battle pays ~30–80 Glint → cheapest shore relic within ~2–5 battles
  const cheapestShore = Math.min(...SHOPS.shore_camp.stock.map((e) => e.price));
  assert.ok(cheapestShore >= 100 && cheapestShore <= 250);
  // No relic sold in two shops
  const all = Object.values(SHOPS).flatMap((s) => s.stock.filter((e) => e.kind === 'relic').map((e) => e.id));
  assert.equal(new Set(all).size, all.length);
});
