// Party skills for Expedition 69: 8 regular skills + 1 gradient skill per character, built only from the
// closed Effect set and modifiers of SPEC §4.8. Pure data (plus two tiny lookup helpers).
//
// Balance guide (power = multiplier of the caster's ATK before QTE/affinity/stance):
//   basic attack ≈ 1.0 (0 AP, +1 AP) · 1 AP ≈ 1.3 · 2 AP ≈ 1.8–2.4 · 3 AP ≈ 2.7–3.0 · 4–5 AP ≈ 3.5–5
//   mechanic finishers start lower and scale (Surge up to ×3, glyph extra hits, stance ×2).

/**
 * @typedef {Object} SkillHit
 * @property {number} power       Multiplier of atk.
 * @property {true} qte           Every skill hit shows an offensive QTE ring.
 * @property {number} [gap]       ms before this hit (battle default 380).
 * @property {number} [break]     Break added (default round(power × 10)).
 * @property {true} [random]      randomEnemies: this hit picks a random living enemy.
 */

/**
 * @typedef {Object} Effect  Closed set (SPEC §4.8), e.g. {type:'status', status, turns, chance?, target},
 *   {type:'heal', pct|power, target}, {type:'revive', pct, target}, {type:'ap', amount, target},
 *   {type:'shieldBreak', amount}, {type:'break', amount}, {type:'gradient', amount}, {type:'surge', amount},
 *   {type:'glyph', add}, {type:'stance', to}. Applied after all hits unless when:'perHit'.
 */

/**
 * @typedef {Object} SkillDef
 * @property {string} id
 * @property {'gideon'|'nyra'|'sable'} owner
 * @property {string} name
 * @property {string} desc        Precise, flavourful description (AP, hits, element, effects, mechanic).
 * @property {string} short       One-line summary for compact menus.
 * @property {number} ap          0 for gradient skills.
 * @property {true} [gradient]    Costs 1 gradient charge instead of AP.
 * @property {'enemy'|'allEnemies'|'ally'|'allAllies'|'self'|'deadAlly'|'randomEnemies'} target
 * @property {string} element
 * @property {string} anim        Party anim id (§3.7).
 * @property {SkillHit[]} hits
 * @property {Effect[]} effects
 * @property {'consume'} [surge]
 * @property {{glyph:string, powerMult:number, effects:Effect[]}} [consumeGlyph]
 * @property {{extraHitPower:number}} [consumeAllGlyphs]
 * @property {{status?:string, broken?:boolean, mult:number}} [bonusVs]
 * @property {number} [critBonus]
 * @property {boolean} [ignoreShields]
 * @property {{level:number, sp:number, requires:string[]}} learn
 */

/** @type {Record<string, SkillDef>} */
export const SKILLS = {
  // ───────────────────────────── GIDEON · SURGE ─────────────────────────────
  rivet_barrage: {
    id: 'rivet_barrage',
    owner: 'gideon',
    name: 'Rivet Barrage',
    short: '3 hits · builds up to 4 Surge',
    desc:
      'A salvo of saber cuts and gauntlet jabs, hammered home like rivets into a hull. ' +
      '2 AP · 3 Physical hits (0.65 / 0.65 / 0.7 power). Every hit that lands builds 1 Surge, and the follow-through adds +1 more — up to +4 Surge.',
    ap: 2,
    target: 'enemy',
    element: 'physical',
    anim: 'flurry',
    hits: [
      { power: 0.65, qte: true, gap: 340 },
      { power: 0.65, qte: true, gap: 280 },
      { power: 0.7, qte: true, gap: 300 },
    ],
    effects: [{ type: 'surge', amount: 1 }],
    learn: { level: 1, sp: 1, requires: [] },
  },

  arc_discharge: {
    id: 'arc_discharge',
    owner: 'gideon',
    name: 'Arc Discharge',
    short: 'Consumes Surge · 1 heavy lightning hit',
    desc:
      'Gideon vents the storm stored in his arc-gauntlet in a single point-blank bolt. ' +
      '3 AP · 1 Lightning hit (1.7 power, heavy break). Consumes Surge: damage ×(1 + 0.2 per Surge). Surge is spent before the strike and the hit builds 1 again — up to 5.1 power at 10 Surge.',
    ap: 3,
    target: 'enemy',
    element: 'lightning',
    anim: 'heavy',
    hits: [{ power: 1.7, qte: true, gap: 460, break: 24 }],
    effects: [],
    surge: 'consume',
    learn: { level: 1, sp: 1, requires: [] },
  },

  breach_strike: {
    id: 'breach_strike',
    owner: 'gideon',
    name: 'Breach Strike',
    short: 'Ignores Shields · shatters 2 Shields',
    desc:
      'A two-handed overhead blow that finds the seam in any shell, plate or porcelain. ' +
      '2 AP · 1 Physical hit (1.6 power, high break) that ignores Shields, then shatters 2 of the target\'s Shields. The hit still builds 1 Surge.',
    ap: 2,
    target: 'enemy',
    element: 'physical',
    anim: 'heavy',
    ignoreShields: true,
    hits: [{ power: 1.6, qte: true, gap: 460, break: 30 }],
    effects: [{ type: 'shieldBreak', amount: 2 }],
    learn: { level: 2, sp: 1, requires: [] },
  },

  galvanic_relay: {
    id: 'galvanic_relay',
    owner: 'gideon',
    name: 'Galvanic Relay',
    short: 'Ally +2 AP · +1 Surge',
    desc:
      'Gideon claps his gauntlet to an ally\'s shoulder and lends them the current. ' +
      '1 AP · The chosen ally gains +2 AP (a net +1 AP for the expedition) and Gideon gains +1 Surge. Perfect for handing Sable or Nyra the AP for a finisher.',
    ap: 1,
    target: 'ally',
    element: 'lightning',
    anim: 'buff',
    hits: [],
    effects: [
      { type: 'ap', amount: 2, target: 'target' },
      { type: 'surge', amount: 1 },
    ],
    learn: { level: 3, sp: 1, requires: [] },
  },

  lightning_rod: {
    id: 'lightning_rod',
    owner: 'gideon',
    name: 'Lightning Rod',
    short: 'Self Shell 3 turns · +4 Surge',
    desc:
      'Plant the saber, raise the gauntlet, and dare the storm to strike. ' +
      '1 AP · Gideon gains Shell (damage taken ×0.7) for 3 turns and +4 Surge. Every blow he parries — or absorbs — keeps feeding Surge.',
    ap: 1,
    target: 'self',
    element: 'lightning',
    anim: 'buff',
    hits: [],
    effects: [
      { type: 'status', status: 'shell', turns: 3, target: 'self' },
      { type: 'surge', amount: 4 },
    ],
    learn: { level: 4, sp: 1, requires: [] },
  },

  captains_order: {
    id: 'captains_order',
    owner: 'gideon',
    name: "Captain's Order",
    short: 'All allies Powerful 3 turns · +2 Surge',
    desc:
      '"Eyes front, Expedition — we do not stop here." The old watch-captain\'s voice carries over any storm. ' +
      '3 AP · Every ally becomes Powerful (damage dealt ×1.25) for 3 turns, and Gideon gains +2 Surge.',
    ap: 3,
    target: 'allAllies',
    element: 'physical',
    anim: 'buff',
    hits: [],
    effects: [
      { type: 'status', status: 'powerful', turns: 3, target: 'allies' },
      { type: 'surge', amount: 2 },
    ],
    learn: { level: 6, sp: 2, requires: [] },
  },

  tempest_cleave: {
    id: 'tempest_cleave',
    owner: 'gideon',
    name: 'Tempest Cleave',
    short: 'All enemies · 2 hits · may Slow · up to +3 Surge',
    desc:
      'A crackling whirlwind of saber and arc-light that catches everything within reach. ' +
      '4 AP · 2 Lightning hits (0.9 / 1.1 power) against every enemy; afterwards each foe has a 35% chance to be Slowed for 2 turns. Each landed hit builds 1 Surge and the spin adds +1 more — up to +3 Surge.',
    ap: 4,
    target: 'allEnemies',
    element: 'lightning',
    anim: 'spin',
    hits: [
      { power: 0.9, qte: true, gap: 400 },
      { power: 1.1, qte: true, gap: 360 },
    ],
    effects: [
      { type: 'status', status: 'slow', turns: 2, chance: 0.35, target: 'target' },
      { type: 'surge', amount: 1 },
    ],
    learn: { level: 8, sp: 2, requires: ['rivet_barrage'] },
  },

  overload_verdict: {
    id: 'overload_verdict',
    owner: 'gideon',
    name: 'Overload Verdict',
    short: 'Consumes Surge · 3 hits · up to 9 power',
    desc:
      'Gideon leaps, drags the thundercloud down with him and drives it through the target like a judgement. ' +
      '6 AP · 3 Lightning hits (0.75 / 0.75 / 1.5 power, massive break). Consumes Surge: damage ×(1 + 0.2 per Surge); Surge is spent, then each landed hit rebuilds 1 — 9 total power at full Surge.',
    ap: 6,
    target: 'enemy',
    element: 'lightning',
    anim: 'leap',
    hits: [
      { power: 0.75, qte: true, gap: 420 },
      { power: 0.75, qte: true, gap: 320 },
      { power: 1.5, qte: true, gap: 560, break: 45 },
    ],
    effects: [],
    surge: 'consume',
    learn: { level: 12, sp: 3, requires: ['arc_discharge'] },
  },

  thunderhead_oath: {
    id: 'thunderhead_oath',
    owner: 'gideon',
    name: 'Thunderhead Oath',
    short: 'Prism · 6 lightning hits · fills Surge',
    desc:
      'The oath every harbour captain swears, spoken this once in thunder. Gideon hurls himself skyward and calls down the whole storm. ' +
      '1 Prism charge · 6 Lightning hits (0.8 / 0.8 / 1.0 / 1.0 / 1.2 / 2.4 — 7.2 total power, massive break). Every landed hit builds Surge and he gains +4 more, leaving him primed for a Surge finisher.',
    ap: 0,
    gradient: true,
    target: 'enemy',
    element: 'lightning',
    anim: 'gradient',
    hits: [
      { power: 0.8, qte: true, gap: 460 },
      { power: 0.8, qte: true, gap: 300 },
      { power: 1.0, qte: true, gap: 300 },
      { power: 1.0, qte: true, gap: 320 },
      { power: 1.2, qte: true, gap: 380 },
      { power: 2.4, qte: true, gap: 680, break: 60 },
    ],
    effects: [{ type: 'surge', amount: 4 }],
    learn: { level: 1, sp: 0, requires: [] },
  },

  // ───────────────────────────── NYRA · GLYPHS ─────────────────────────────
  ember_script: {
    id: 'ember_script',
    owner: 'nyra',
    name: 'Ember Script',
    short: '2 fire hits · may Burn · +Fire glyph',
    desc:
      'Two strokes of a burning letter, written in the air and flung. ' +
      '2 AP · 2 Fire hits (0.9 / 1.0 power) with a 35% chance to Burn for 2 turns. Inscribes a Fire glyph.',
    ap: 2,
    target: 'enemy',
    element: 'fire',
    anim: 'cast',
    hits: [
      { power: 0.9, qte: true, gap: 420 },
      { power: 1.0, qte: true, gap: 340 },
    ],
    effects: [
      { type: 'status', status: 'burn', turns: 2, chance: 0.35, target: 'target' },
      { type: 'glyph', add: 'fire' },
    ],
    learn: { level: 1, sp: 1, requires: [] },
  },

  mending_verse: {
    id: 'mending_verse',
    owner: 'nyra',
    name: 'Mending Verse',
    short: 'Heal 30% · Light glyph: +15% & Regen',
    desc:
      'A line of verse that closes wounds as it is read aloud. ' +
      '2 AP · Heals one ally for 30% of their max HP. Consumes a Light glyph if present: heals a further 15% and grants Regen (8% max HP per turn) for 3 turns.',
    ap: 2,
    target: 'ally',
    element: 'light',
    anim: 'heal',
    hits: [],
    effects: [{ type: 'heal', pct: 0.3, target: 'target' }],
    consumeGlyph: {
      glyph: 'light',
      powerMult: 1,
      effects: [
        { type: 'heal', pct: 0.15, target: 'target' },
        { type: 'status', status: 'regen', turns: 3, target: 'target' },
      ],
    },
    learn: { level: 1, sp: 1, requires: [] },
  },

  rime_script: {
    id: 'rime_script',
    owner: 'nyra',
    name: 'Rime Script',
    short: '2 ice hits · Chill · Fire glyph: Thermal Shock',
    desc:
      'Frost written across the target in a single cold sentence. ' +
      '2 AP · 2 Ice hits (0.9 power each) that Chill for 2 turns. Consumes a Fire glyph if present — Thermal Shock: ×1.6 damage and the target becomes Defenceless (damage taken ×1.25) for 2 turns. Inscribes an Ice glyph.',
    ap: 2,
    target: 'enemy',
    element: 'ice',
    anim: 'cast',
    hits: [
      { power: 0.9, qte: true, gap: 420 },
      { power: 0.9, qte: true, gap: 320 },
    ],
    effects: [
      { type: 'status', status: 'chill', turns: 2, target: 'target' },
      { type: 'glyph', add: 'ice' },
    ],
    consumeGlyph: {
      glyph: 'fire',
      powerMult: 1.6,
      effects: [{ type: 'status', status: 'defenseless', turns: 2, target: 'target' }],
    },
    learn: { level: 2, sp: 1, requires: [] },
  },

  lumen_script: {
    id: 'lumen_script',
    owner: 'nyra',
    name: 'Lumen Script',
    short: '1 AP light hit · +Light glyph',
    desc:
      'A quick, bright underline of pure dusk-light. ' +
      '1 AP · 1 Light hit (1.3 power). Inscribes a Light glyph — fuel for Mending Verse and Rekindle.',
    ap: 1,
    target: 'enemy',
    element: 'light',
    anim: 'cast',
    hits: [{ power: 1.3, qte: true, gap: 400 }],
    effects: [{ type: 'glyph', add: 'light' }],
    learn: { level: 3, sp: 1, requires: [] },
  },

  tempest_script: {
    id: 'tempest_script',
    owner: 'nyra',
    name: 'Tempest Script',
    short: 'All enemies · Ice glyph: ×1.5 & Slow · +Storm glyph',
    desc:
      'Nyra writes a thunderstorm across the whole page at once. ' +
      '3 AP · 2 Lightning hits (0.7 / 0.8 power) against every enemy. Consumes an Ice glyph if present — Frozen Conductor: ×1.5 damage and every foe is Slowed for 2 turns. Inscribes a Storm glyph.',
    ap: 3,
    target: 'allEnemies',
    element: 'lightning',
    anim: 'cast',
    hits: [
      { power: 0.7, qte: true, gap: 440 },
      { power: 0.8, qte: true, gap: 360 },
    ],
    effects: [{ type: 'glyph', add: 'storm' }],
    consumeGlyph: {
      glyph: 'ice',
      powerMult: 1.5,
      effects: [{ type: 'status', status: 'slow', turns: 2, target: 'target' }],
    },
    learn: { level: 5, sp: 2, requires: ['rime_script'] },
  },

  rekindle: {
    id: 'rekindle',
    owner: 'nyra',
    name: 'Rekindle',
    short: 'Revive 40% · Light glyph: +2 AP & Regen',
    desc:
      'She reads a fallen friend\'s name back into the world, one careful letter at a time. ' +
      '3 AP · Revives a KO\'d ally with 40% of their max HP. Consumes a Light glyph if present: the ally also rises with +2 AP and Regen for 3 turns.',
    ap: 3,
    target: 'deadAlly',
    element: 'light',
    anim: 'heal',
    hits: [],
    effects: [{ type: 'revive', pct: 0.4, target: 'target' }],
    consumeGlyph: {
      glyph: 'light',
      powerMult: 1,
      effects: [
        { type: 'ap', amount: 2, target: 'target' },
        { type: 'status', status: 'regen', turns: 3, target: 'target' },
      ],
    },
    learn: { level: 6, sp: 2, requires: ['mending_verse'] },
  },

  loam_script: {
    id: 'loam_script',
    owner: 'nyra',
    name: 'Loam Script',
    short: 'Heavy earth hit · Storm glyph: +2 AP · +Earth glyph',
    desc:
      'Heavy letters of stone, spelled out overhead and dropped. ' +
      '2 AP · 1 Earth hit (1.8 power, heavy break). Consumes a Storm glyph if present — Grounded Current: ×1.3 damage and Nyra regains 2 AP. Inscribes an Earth glyph.',
    ap: 2,
    target: 'enemy',
    element: 'earth',
    anim: 'cast',
    hits: [{ power: 1.8, qte: true, gap: 480, break: 34 }],
    effects: [{ type: 'glyph', add: 'earth' }],
    consumeGlyph: {
      glyph: 'storm',
      powerMult: 1.3,
      effects: [{ type: 'ap', amount: 2, target: 'self' }],
    },
    learn: { level: 8, sp: 2, requires: ['lumen_script'] },
  },

  codex_unbound: {
    id: 'codex_unbound',
    owner: 'nyra',
    name: 'Codex Unbound',
    short: 'Consumes ALL glyphs · +1 elemental hit each',
    desc:
      'Nyra tears every written page from the tome at once and lets them fly. ' +
      '5 AP · 1 Light hit (2.0 power), then consumes ALL glyphs: one extra QTE hit per glyph (1.7 power each) in that glyph\'s element (Storm strikes as Lightning). With 4 glyphs: 5 hits, 8.8 total power — and a chance to exploit every weakness.',
    ap: 5,
    target: 'enemy',
    element: 'light',
    anim: 'cast',
    hits: [{ power: 2.0, qte: true, gap: 460, break: 20 }],
    effects: [],
    consumeAllGlyphs: { extraHitPower: 1.7 },
    learn: { level: 11, sp: 3, requires: ['tempest_script'] },
  },

  aurora_palimpsest: {
    id: 'aurora_palimpsest',
    owner: 'nyra',
    name: 'Aurora Palimpsest',
    short: 'Prism · hits all · heals party · writes 4 glyphs',
    desc:
      'Every glyph Nyra has ever written blazes back at once, overwriting the Gloam in colour. ' +
      '1 Prism charge · 5 Light hits (0.6 / 0.6 / 0.7 / 0.8 / 1.3 — 4.0 total power) against every enemy, heals all allies for 20% max HP, then inscribes Fire, Ice, Storm and Earth glyphs — a full codex, ready to be unbound.',
    ap: 0,
    gradient: true,
    target: 'allEnemies',
    element: 'light',
    anim: 'gradient',
    hits: [
      { power: 0.6, qte: true, gap: 460 },
      { power: 0.6, qte: true, gap: 300 },
      { power: 0.7, qte: true, gap: 300 },
      { power: 0.8, qte: true, gap: 340 },
      { power: 1.3, qte: true, gap: 640, break: 30 },
    ],
    effects: [
      { type: 'heal', pct: 0.2, target: 'allies' },
      { type: 'glyph', add: 'fire' },
      { type: 'glyph', add: 'ice' },
      { type: 'glyph', add: 'storm' },
      { type: 'glyph', add: 'earth' },
    ],
    learn: { level: 1, sp: 0, requires: [] },
  },

  // ───────────────────────────── SABLE · STANCE ─────────────────────────────
  crimson_lunge: {
    id: 'crimson_lunge',
    owner: 'sable',
    name: 'Crimson Lunge',
    short: '1 big thrust · Stance → Assault',
    desc:
      'A full-extension lunge; the white plume is a streak behind it. ' +
      '2 AP · 1 Physical hit (2.0 power). Stance → Assault (dealt ×1.4, taken ×1.2). Used while already in Assault, Sable ascends to Bravura.',
    ap: 2,
    target: 'enemy',
    element: 'physical',
    anim: 'thrust',
    hits: [{ power: 2.0, qte: true, gap: 420, break: 18 }],
    effects: [{ type: 'stance', to: 'assault' }],
    learn: { level: 1, sp: 1, requires: [] },
  },

  en_garde: {
    id: 'en_garde',
    owner: 'sable',
    name: 'En Garde',
    short: 'Light flick · Stance → Guard',
    desc:
      'A salute, a testing flick of the blade, and the guard comes up. ' +
      '1 AP · 1 Physical hit (1.1 power). Stance → Guard: damage dealt ×0.85, damage taken ×0.65, and every parry grants +1 extra AP.',
    ap: 1,
    target: 'enemy',
    element: 'physical',
    anim: 'slash',
    hits: [{ power: 1.1, qte: true, gap: 380 }],
    effects: [{ type: 'stance', to: 'guard' }],
    learn: { level: 1, sp: 1, requires: [] },
  },

  calling_card: {
    id: 'calling_card',
    owner: 'sable',
    name: 'Calling Card',
    short: 'Flintlock shot · Mark 3 turns',
    desc:
      'A flintlock shot that leaves a scorched rose on the target\'s armour. ' +
      '1 AP · 1 Physical hit (1.0 power) that Marks the target for 3 turns — the next damaging hit it takes deals ×1.5. Keeps Sable\'s current stance.',
    ap: 1,
    target: 'enemy',
    element: 'physical',
    anim: 'shoot',
    hits: [{ power: 1.0, qte: true, gap: 380, break: 5 }],
    effects: [{ type: 'status', status: 'mark', turns: 3, target: 'target' }],
    learn: { level: 2, sp: 1, requires: [] },
  },

  fleche: {
    id: 'fleche',
    owner: 'sable',
    name: 'Flèche',
    short: '3 hits · Stance → Assault (→ Bravura)',
    desc:
      'A running attack that ends with Sable already past her target. ' +
      '3 AP · 3 Physical hits (0.8 / 0.8 / 1.3 power). Stance → Assault; chained after Crimson Lunge it takes her straight to Bravura.',
    ap: 3,
    target: 'enemy',
    element: 'physical',
    anim: 'leap',
    hits: [
      { power: 0.8, qte: true, gap: 420 },
      { power: 0.8, qte: true, gap: 280 },
      { power: 1.3, qte: true, gap: 380 },
    ],
    effects: [{ type: 'stance', to: 'assault' }],
    learn: { level: 3, sp: 1, requires: ['crimson_lunge'] },
  },

  scatter_volley: {
    id: 'scatter_volley',
    owner: 'sable',
    name: 'Scatter Volley',
    short: '4 shots at random enemies',
    desc:
      'Sable fans the flintlock\'s hammer and lets the smoke decide. ' +
      '2 AP · 4 Physical shots (0.55 power each), each at a random enemy. Keeps her stance — a Bravura volley shreds a whole pack.',
    ap: 2,
    target: 'randomEnemies',
    element: 'physical',
    anim: 'shoot',
    hits: [
      { power: 0.55, qte: true, gap: 400, random: true },
      { power: 0.55, qte: true, gap: 280, random: true },
      { power: 0.55, qte: true, gap: 280, random: true },
      { power: 0.55, qte: true, gap: 280, random: true },
    ],
    effects: [],
    learn: { level: 5, sp: 2, requires: ['calling_card'] },
  },

  contretemps: {
    id: 'contretemps',
    owner: 'sable',
    name: 'Contretemps',
    short: '2 hits · Weaken · Stance → Guard',
    desc:
      'Counter-time: she strikes into the opponent\'s rhythm and is back on guard before they finish the thought. ' +
      '2 AP · 2 Physical hits (1.0 / 1.1 power) that Weaken the target (damage dealt ×0.75) for 2 turns. Stance → Guard — ready to parry for bonus AP.',
    ap: 2,
    target: 'enemy',
    element: 'physical',
    anim: 'slash',
    hits: [
      { power: 1.0, qte: true, gap: 400 },
      { power: 1.1, qte: true, gap: 300 },
    ],
    effects: [
      { type: 'status', status: 'weakened', turns: 2, target: 'target' },
      { type: 'stance', to: 'guard' },
    ],
    learn: { level: 7, sp: 2, requires: ['en_garde'] },
  },

  coup_de_grace: {
    id: 'coup_de_grace',
    owner: 'sable',
    name: 'Coup de Grâce',
    short: 'Execute · ×1.8 vs Broken · +30% crit',
    desc:
      'The killing thrust, saved for a foe that can no longer defend itself. ' +
      '4 AP · 1 Physical hit (3.0 power) with +30% crit chance, dealing ×1.8 damage against Broken enemies. In Bravura, against a Broken foe, very little survives it.',
    ap: 4,
    target: 'enemy',
    element: 'physical',
    anim: 'thrust',
    hits: [{ power: 3.0, qte: true, gap: 520, break: 12 }],
    effects: [],
    bonusVs: { broken: true, mult: 1.8 },
    critBonus: 0.3,
    learn: { level: 9, sp: 2, requires: ['calling_card'] },
  },

  crimson_cadenza: {
    id: 'crimson_cadenza',
    owner: 'sable',
    name: 'Crimson Cadenza',
    short: '5 hits · Stance → Assault (keeps Bravura)',
    desc:
      'Five cuts, written as elegantly as a signature. ' +
      '5 AP · 5 Physical hits (0.8 / 0.8 / 0.9 / 0.9 / 1.5 — 4.9 total power). Stance → Assault: from Assault it ascends to Bravura, and in Bravura it keeps her there.',
    ap: 5,
    target: 'enemy',
    element: 'physical',
    anim: 'flurry',
    hits: [
      { power: 0.8, qte: true, gap: 420 },
      { power: 0.8, qte: true, gap: 270 },
      { power: 0.9, qte: true, gap: 270 },
      { power: 0.9, qte: true, gap: 290 },
      { power: 1.5, qte: true, gap: 440, break: 22 },
    ],
    effects: [{ type: 'stance', to: 'assault' }],
    learn: { level: 13, sp: 3, requires: ['fleche'] },
  },

  crimson_requiem: {
    id: 'crimson_requiem',
    owner: 'sable',
    name: 'Crimson Requiem',
    short: 'Prism · 7 hits · Stance → Bravura',
    desc:
      'For her mother, and for every plume that never came home. Sable becomes a crimson blur. ' +
      '1 Prism charge · 7 Physical hits (0.6 ×3 / 0.7 ×2 / 0.8 / 2.0 — 6.0 total power, +15% crit chance), ending in a point-blank flintlock shot. Stance → Bravura.',
    ap: 0,
    gradient: true,
    target: 'enemy',
    element: 'physical',
    anim: 'gradient',
    hits: [
      { power: 0.6, qte: true, gap: 440 },
      { power: 0.6, qte: true, gap: 280 },
      { power: 0.6, qte: true, gap: 270 },
      { power: 0.7, qte: true, gap: 300 },
      { power: 0.7, qte: true, gap: 270 },
      { power: 0.8, qte: true, gap: 320 },
      { power: 2.0, qte: true, gap: 660, break: 40 },
    ],
    effects: [{ type: 'stance', to: 'virtuoso' }],
    critBonus: 0.15,
    learn: { level: 1, sp: 0, requires: [] },
  },
};

/**
 * All skill ids owned by a character, in learn order (level, then declaration order).
 * @param {string} owner  Character id.
 * @param {{includeGradient?: boolean}} [opts]
 * @returns {string[]}
 */
export function skillIdsFor(owner, { includeGradient = false } = {}) {
  return Object.values(SKILLS)
    .filter((s) => s.owner === owner && (includeGradient || !s.gradient))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.learn.level - b.s.learn.level || a.i - b.i)
    .map(({ s }) => s.id);
}

/**
 * Sum of hit powers of a skill (ignoring mechanic multipliers) — handy for tooltips and balance tests.
 * @param {string|SkillDef} skillOrId
 * @returns {number}
 */
export function skillBasePower(skillOrId) {
  const s = typeof skillOrId === 'string' ? SKILLS[skillOrId] : skillOrId;
  if (!s || !Array.isArray(s.hits)) return 0;
  return Math.round(s.hits.reduce((sum, h) => sum + (h.power || 0), 0) * 100) / 100;
}
