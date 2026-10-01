// Validates src/data/story.js (SPEC §3.8 / §4.8): slides, required dialogues, journals j1–j9, hint keys and tokens,
// zone titles — plus basic writing-quality guards (lengths, no placeholders).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORY, REQUIRED_DIALOGUE_IDS, HINT_KEYS, JOURNAL_IDS, HINT_TOKENS, fillTokens, getDialogue, speakerName,
} from '../src/data/story.js';
import { ENEMIES } from '../src/data/enemies.js';

const SPEC_DIALOGUES = ['shore_arrival', 'flag_first', 'warden_pre', 'warden_post', 'thicket_arrival', 'bellwether_pre',
  'bellwether_post', 'spire_arrival', 'summit_arrival', 'stillkeeper_pre', 'stillkeeper_phase2', 'stillkeeper_post',
  'merchant_greet', 'trainer_greet'];
const SPEC_HINTS = ['firstTurn', 'ap', 'skills', 'qte', 'parry', 'dodge', 'jump', 'unparryable', 'gradientHit', 'counter',
  'freeAim', 'shields', 'break', 'gradientMeter', 'stances', 'glyphs', 'surge'];
const SPEAKER_IDS = ['gideon', 'nyra', 'sable', 'narrator'];
const words = (s) => s.trim().split(/\s+/).length;
const sentences = (s) => s.split(/(?<=[.!?])\s+(?=[A-Z"{])/).filter(Boolean).length;

function allText() {
  const out = [];
  for (const s of [...STORY.intro, ...STORY.ending]) out.push(s.title ?? '', s.text);
  for (const lines of Object.values(STORY.dialogues)) for (const l of lines) out.push(l.text);
  for (const j of Object.values(STORY.journals)) out.push(j.title, j.text);
  out.push(...Object.values(STORY.hints), ...Object.values(STORY.zoneTitles));
  return out;
}

test('exported id lists match the spec', () => {
  assert.deepEqual([...REQUIRED_DIALOGUE_IDS].sort(), [...SPEC_DIALOGUES].sort());
  assert.deepEqual([...HINT_KEYS].sort(), [...SPEC_HINTS].sort());
  assert.deepEqual(JOURNAL_IDS, ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8', 'j9']);
});

test('intro and ending: 5–7 slides each', () => {
  for (const key of ['intro', 'ending']) {
    const slides = STORY[key];
    assert.ok(slides.length >= 5 && slides.length <= 7, `${key}: ${slides.length} slides`);
    for (const s of slides) {
      if (s.title !== undefined) assert.ok(typeof s.title === 'string' && s.title.length > 0);
      assert.ok(typeof s.text === 'string' && words(s.text) >= 15 && s.text.length <= 420, `${key}: slide length`);
    }
  }
});

test('every required dialogue exists with 3–8 well-formed lines', () => {
  for (const id of SPEC_DIALOGUES) {
    const lines = STORY.dialogues[id];
    assert.ok(Array.isArray(lines), `missing dialogue ${id}`);
    assert.ok(lines.length >= 3 && lines.length <= 8, `${id}: ${lines.length} lines`);
  }
  for (const [id, lines] of Object.entries(STORY.dialogues)) {
    assert.match(id, /^[a-z][a-z0-9_]*$/);
    assert.ok(SPEC_DIALOGUES.includes(id) || id.startsWith('npc_'), `${id}: extra dialogues must be npc_*`);
    for (const l of lines) {
      assert.equal(typeof l.speaker, 'string');
      assert.ok(SPEAKER_IDS.includes(l.speaker) || /^[A-Z]/.test(l.speaker), `${id}: speaker "${l.speaker}"`);
      assert.ok(typeof l.text === 'string' && l.text.length >= 3 && l.text.length <= 240, `${id}: line length`);
    }
  }
  const npcs = Object.keys(STORY.dialogues).filter((id) => id.startsWith('npc_'));
  assert.ok(npcs.length >= 3, 'a few optional npc_* dialogues');
});

test('the three voices appear throughout, and bosses speak in their scenes', () => {
  const lines = Object.values(STORY.dialogues).flat();
  for (const who of ['gideon', 'nyra', 'sable']) assert.ok(lines.filter((l) => l.speaker === who).length >= 10, `${who} speaks often`);
  for (const [id, boss] of [['warden_pre', 'The Wreck Warden'], ['bellwether_pre', 'The Bellwether'], ['stillkeeper_pre', 'The Stillkeeper'],
    ['stillkeeper_phase2', 'The Stillkeeper'], ['stillkeeper_post', 'The Stillkeeper']]) {
    assert.ok(STORY.dialogues[id].some((l) => l.speaker === boss), `${id}: ${boss} speaks`);
  }
  for (const id of ['bellwether', 'stillkeeper', 'wreck_warden']) assert.equal(ENEMIES[id].name, ENEMIES[id].name.trim());
});

test('journals j1–j9: zones, distinct expeditions, 60–120 words, hinting at the secret', () => {
  const zones = { j1: 'shore', j2: 'shore', j3: 'shore', j4: 'thicket', j5: 'thicket', j6: 'thicket', j7: 'spire', j8: 'spire', j9: 'spire' };
  const numbers = new Set();
  for (const [id, zone] of Object.entries(zones)) {
    const j = STORY.journals[id];
    assert.ok(j, `missing journal ${id}`);
    assert.equal(j.zone, zone, `${id} zone`);
    const m = /^Expedition (\d+) — Day (\d+)$/.exec(j.title);
    assert.ok(m, `${id}: title "Expedition N — Day D"`);
    const n = Number(m[1]);
    assert.ok(n >= 1 && n <= 68, `${id}: a past expedition`);
    numbers.add(n);
    assert.ok(typeof j.author === 'string' && j.author.length > 2, `${id}: author`);
    const w = words(j.text);
    assert.ok(w >= 60 && w <= 120, `${id}: ${w} words`);
  }
  assert.equal(numbers.size, 9, 'each journal comes from a different expedition');
  assert.deepEqual(Object.keys(STORY.journals).sort(), Object.keys(zones).sort());
  const hinting = Object.values(STORY.journals).filter((j) => /Lise|Vantine|stay/i.test(j.text));
  assert.ok(hinting.length >= 6, 'journals build towards the Stillkeeper\'s secret');
});

test('hints: every key, crisp, only known tokens, each defense names its own key', () => {
  for (const key of SPEC_HINTS) {
    const h = STORY.hints[key];
    assert.ok(typeof h === 'string' && h.length >= 20 && h.length <= 200, `${key}: hint length`);
    assert.ok(sentences(h) <= 2, `${key}: one or two sentences (${sentences(h)})`);
    for (const [, tok] of h.matchAll(/\{([a-zA-Z]+)\}/g)) assert.ok(HINT_TOKENS.includes(tok), `${key}: unknown token {${tok}}`);
  }
  assert.deepEqual(Object.keys(STORY.hints).sort(), [...SPEC_HINTS].sort());
  const needs = { parry: 'parry', dodge: 'dodge', jump: 'jump', gradientHit: 'gradient', qte: 'qte', unparryable: 'dodge', firstTurn: 'confirm' };
  for (const [key, tok] of Object.entries(needs)) assert.ok(STORY.hints[key].includes(`{${tok}}`), `${key} mentions {${tok}}`);
});

test('zone titles', () => {
  for (const z of ['shore', 'thicket', 'spire', 'summit']) {
    assert.ok(typeof STORY.zoneTitles[z] === 'string' && STORY.zoneTitles[z].length > 3, z);
    assert.ok(typeof STORY.zoneSubtitles[z] === 'string' && STORY.zoneSubtitles[z].length > 3, z);
  }
  assert.equal(STORY.zoneTitles.shore, 'Brinegate Shore');
  assert.equal(STORY.zoneTitles.thicket, 'The Gilded Thicket');
  assert.equal(STORY.zoneTitles.spire, 'The Meridian Spire');
});

test('no placeholder text anywhere', () => {
  for (const s of allText()) {
    assert.ok(!/\b(TODO|TBD|lorem|ipsum|placeholder|FIXME)\b/i.test(s), `placeholder in: ${s.slice(0, 60)}`);
    assert.ok(!/undefined|null|NaN/.test(s), `stray value in: ${s.slice(0, 60)}`);
  }
});

test('helpers', () => {
  const labels = { parry: 'E', dodge: 'Q' };
  assert.equal(fillTokens('Press {parry} or {dodge}.', (t) => labels[t]), 'Press E or Q.');
  assert.equal(fillTokens('Press {jump}.', () => null), 'Press {jump}.');
  assert.equal(fillTokens('Press {jump}.', () => ''), 'Press {jump}.');
  const filled = fillTokens(STORY.hints.gradientHit, (t) => t.toUpperCase());
  assert.ok(!/\{[a-z]+\}/.test(filled));
  assert.equal(getDialogue('warden_pre'), STORY.dialogues.warden_pre);
  assert.deepEqual(getDialogue('nope'), []);
  assert.deepEqual(getDialogue('hasOwnProperty'), []);
  assert.equal(speakerName('nyra'), 'Nyra');
  assert.equal(speakerName('narrator'), '');
  assert.equal(speakerName('Pellam Quist'), 'Pellam Quist');
});

// Display-name glossary (SPEC v1.1): ids keep the internal names (gradient, virtuoso, flag, mime), but every string a
// player reads uses Prism / Bravura / Expedition Pennant / Gilded Harlequin, in British spelling.
test('player-facing data text follows the display-name glossary and British spelling', async () => {
  const [{ SKILLS }, { RELICS, passiveText }, { CHARACTERS }, { ENCOUNTERS }, { SHOPS }, { ITEMS, UPGRADES }, { STATUS_DEFS }, { ATTR_INFO }] = await Promise.all([
    import('../src/data/skills.js'), import('../src/data/relics.js'), import('../src/data/characters.js'),
    import('../src/data/encounters.js'), import('../src/data/shops.js'), import('../src/data/items.js'),
    import('../src/battle/status.js'), import('../src/game/progression.js'),
  ]);
  const texts = [];
  const push = (where, ...strings) => { for (const s of strings) if (typeof s === 'string') texts.push([where, s]); };
  for (const s of allText()) push('story', s);
  for (const e of Object.values(ENEMIES)) {
    push(`enemy ${e.id}`, e.name, e.bio, ...(e.phases ?? []).map((p) => p.text));
    for (const a of Object.values(e.attacks)) push(`attack ${e.id}.${a.id}`, a.name, a.desc);
  }
  for (const s of Object.values(SKILLS)) push(`skill ${s.id}`, s.name, s.short, s.desc);
  for (const r of Object.values(RELICS)) push(`relic ${r.id}`, r.name, r.desc, passiveText(r.passive));
  for (const c of Object.values(CHARACTERS)) push(`character ${c.id}`, c.name, c.title, c.role, c.mechanicName, c.mechanicDesc, c.bio);
  for (const e of Object.values(ENCOUNTERS)) push(`encounter ${e.id}`, e.name);
  for (const s of Object.values(SHOPS)) push(`shop ${s.id}`, s.name, s.keeper, s.blurb);
  for (const i of [...Object.values(ITEMS), ...Object.values(UPGRADES)]) push(`item ${i.id}`, i.name, i.desc);
  for (const s of Object.values(STATUS_DEFS)) push(`status ${s.id}`, s.name, s.desc);
  for (const a of Object.values(ATTR_INFO)) push(`attribute ${a.id}`, a.name, a.desc);
  const banned = [
    [/\bgradient\b/i, 'Prism'], [/\bvirtuos[eo]\b/i, 'Bravura'], [/\bflags?\b/i, 'pennant'], [/\bmimes?\b(?!\s+(?:it|whatever))/i, 'Harlequin'],
    [/\bdefense(?:less)?\b/i, 'Defence / Defenceless'], [/\bduelists?\b/i, 'duellist'],
    [/\b(?:color|armor|harbor|favor|honor|center)(?:s|ed|ing)?\b/i, 'British spelling'],
  ];
  for (const [where, s] of texts) {
    const plain = s.replace(/\{[a-zA-Z]+\}/g, ''); // input tokens such as {gradient} are key labels, not names
    for (const [re, want] of banned) assert.ok(!re.test(plain), `${where}: "${s.slice(0, 90)}…" — use ${want}`);
  }
  assert.equal(ENEMIES.mime.name, 'Gilded Harlequin');
  assert.equal(STATUS_DEFS.defenseless.name, 'Defenceless');
  assert.ok(texts.length > 400, `${texts.length} strings checked`);
});
