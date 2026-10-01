// Party roster for Expedition 69: identity, base stats, growth curves, basic attacks and battle mechanics.
// Pure data (no DOM, no side effects) — imported by the battle model, progression and UI.

/**
 * @typedef {Object} BasicAttackHit
 * @property {number} power  Damage multiplier of atk for this hit.
 * @property {number} [gap]  Milliseconds before this hit (battle default 380).
 */

/**
 * @typedef {Object} CharacterDef
 * @property {string} id                     snake_case id (also the sprite look id).
 * @property {string} name                   Display name.
 * @property {string} title                  Epithet, e.g. "the Vanguard".
 * @property {string} look                   Sprite look id for drawActor/renderPortrait.
 * @property {string} role                   One-line role summary for menus.
 * @property {string} color                  Accent colour used by HUD / menus.
 * @property {'surge'|'glyphs'|'stance'} mechanic  Battle-local character mechanic.
 * @property {string} mechanicName           Display name of the mechanic.
 * @property {string} mechanicDesc           Rules summary shown in menus/tooltips.
 * @property {string} shotElement            Element of Free Aim shots.
 * @property {{hp:number, atk:number, def:number, spd:number, crit:number}} base   Level-1 stats.
 * @property {{hp:number, atk:number, def:number, spd:number}} growth              Per-level growth.
 * @property {{name:string, anim:string, element:string, hits:BasicAttackHit[]}} basicAttack
 * @property {string} gradientSkill          Skill id of the character's Prism skill (internal id `gradient`).
 * @property {string[]} startingSkills       Skill ids known from level 1.
 * @property {string} bio                    Short flavour biography.
 */

/** Fixed party order: p0, p1, p2. */
export const PARTY_ORDER = ['gideon', 'nyra', 'sable'];

/** @type {Record<string, CharacterDef>} */
export const CHARACTERS = {
  gideon: {
    id: 'gideon',
    name: 'Gideon Marchal',
    title: 'the Vanguard',
    look: 'gideon',
    role: 'Tank & breaker — physical and lightning',
    color: '#6f9fd8',
    mechanic: 'surge',
    mechanicName: 'Surge',
    mechanicDesc:
      'Surge 0–10. +1 for every damaging hit Gideon lands, +1 when he takes damage, +1 for every hit he parries. ' +
      'Finishers marked "Consumes Surge" spend all Surge for ×(1 + 0.2 × Surge) damage (×3.0 at full charge); their own hits then start rebuilding it.',
    shotElement: 'lightning',
    base: { hp: 420, atk: 34, def: 22, spd: 40, crit: 0.05 },
    growth: { hp: 105, atk: 4.3, def: 2.8, spd: 0.6 },
    basicAttack: {
      name: 'Saber & Gauntlet',
      anim: 'slash',
      element: 'physical',
      hits: [{ power: 0.5 }, { power: 0.5, gap: 260 }],
    },
    gradientSkill: 'thunderhead_oath',
    startingSkills: ['rivet_barrage', 'arc_discharge'],
    bio:
      'Twenty years captain of the Brinegate harbour watch, Gideon has buried more expeditions than he has seen off. ' +
      'The brass arc-gauntlet on his left arm was salvaged from the wreck of Expedition 52, and it still hums with a storm nobody can explain. ' +
      'He volunteered for the sixty-ninth because, as he puts it, somebody has to bring the young ones home.',
  },

  nyra: {
    id: 'nyra',
    name: 'Nyra Solace',
    title: 'the Glyphwright',
    look: 'nyra',
    role: 'Elemental caster & healer',
    color: '#e8c872',
    mechanic: 'glyphs',
    mechanicName: 'Glyphs',
    mechanicDesc:
      'Nyra keeps up to 4 glyphs (fire, ice, storm, earth, light); a fifth pushes out the oldest. ' +
      'Scripts inscribe a glyph of their element. Sigil-style skills consume a specific glyph for a strong bonus, ' +
      'and Codex Unbound spends every glyph as an extra hit of that element.',
    shotElement: 'light',
    base: { hp: 300, atk: 38, def: 14, spd: 44, crit: 0.05 },
    growth: { hp: 65, atk: 4.9, def: 1.8, spd: 0.7 },
    basicAttack: {
      name: 'Quill Flick',
      anim: 'cast',
      element: 'light',
      hits: [{ power: 1.0 }],
    },
    gradientSkill: 'aurora_palimpsest',
    startingSkills: ['ember_script', 'mending_verse'],
    bio:
      'Youngest archivist ever admitted to the Veyran Lyceum, Nyra learned to write light before she learned to lie about it. ' +
      'Her quill-staff paints glyphs that remember what the world was like when the Sun still moved. ' +
      'She carries the journals of the lost expeditions in her floating tome, and reads one page aloud whenever the crew beds down.',
  },

  sable: {
    id: 'sable',
    name: 'Sable Arden',
    title: 'the Duellist',
    look: 'sable',
    role: 'Single-target burst — high risk, high reward',
    color: '#d6453d',
    mechanic: 'stance',
    mechanicName: 'Stance',
    mechanicDesc:
      'Neutral, Assault (dealt ×1.4, taken ×1.2), Guard (dealt ×0.85, taken ×0.65, +1 extra AP per parry) or ' +
      'Bravura (dealt ×2.0, taken ×1.25). Entering Assault while already in Assault or Bravura reaches Bravura. ' +
      'A skill\'s own hits use the stance held before it. Any enemy hit she fails to avoid drops her back to Neutral.',
    shotElement: 'physical',
    base: { hp: 340, atk: 36, def: 17, spd: 52, crit: 0.12 },
    growth: { hp: 85, atk: 4.8, def: 2.2, spd: 0.9 },
    basicAttack: {
      name: 'Twin Thrust',
      anim: 'thrust',
      element: 'physical',
      hits: [{ power: 0.5 }, { power: 0.5, gap: 180 }],
    },
    gradientSkill: 'crimson_requiem',
    startingSkills: ['crimson_lunge', 'en_garde'],
    bio:
      'Nineteen, undefeated, and insufferable about both. Sable fenced her way out of the Veyran gutters and into the Duellists\' Gallery before anyone thought to ask her age. ' +
      'Her mother marched with Expedition 68; the white plume in her hat was the only thing that came back.',
  },
};
