// Bestiary for Expedition 69: every enemy's stats, affinities, weak points, rewards and — most importantly —
// the choreographed attack timelines that drive the real-time defensive QTE (parry / dodge / jump / gradient).
// Pure data (no DOM, no side effects at import). Consumed by the battle model/AI, the battle scene and the UI.

/**
 * @typedef {'normal'|'unparryable'|'jump'|'gradient'|'feint'} HitType
 * @typedef {'slash'|'thrust'|'slam'|'bite'|'spin'|'charge'|'bolt'|'wave'|'beam'|'nova'|'cast'} EnemyAnim
 * @typedef {'physical'|'fire'|'ice'|'lightning'|'earth'|'light'|'dark'} Element
 *
 * @typedef {Object} EnemyHit
 * @property {number} t          Impact time in ms from the start of the action (t = 0).
 * @property {HitType} type      Which defenses are valid (see SPEC §3.2).
 * @property {number} power      Damage multiplier of the attacker's atk (0 for feints).
 * @property {Element} element   Damage element (also tints the effects).
 * @property {EnemyAnim} anim    Animation variant for the wind-up / strike (SPEC §3.7).
 * @property {number} windup     Visible wind-up length in ms before impact (default 350; 700–1100 = delayed "gotcha").
 *                               Always ≤ the gap to the previous hit, so wind-ups never overlap.
 * @property {{id:string, turns:number, chance:number}} [status]  Status inflicted when the hit is NOT avoided.
 *
 * @typedef {Object} EnemyAttack
 * @property {string} id
 * @property {string} name                    Display name (shown in the battle banner).
 * @property {string} desc                    One-line bestiary description.
 * @property {'single'|'all'|'multi'} target  single = one random member · all = every member · multi = each hit picks one.
 * @property {'melee'|'ranged'|'stay'} approach  melee: the scene spends 450 ms closing in (first hit t ≥ 850).
 * @property {EnemyAnim} anim                 Primary animation (first hit's anim; 'cast' for non-damaging actions).
 * @property {number} weight                  Relative AI weight inside the current pool.
 * @property {number} [cooldown]              Own turns before the attack may be chosen again (1 = never twice in a row).
 * @property {{selfHpBelow?:number, allyHpBelow?:number, shieldsBelow?:number, notStatus?:string}} [condition]
 *           selfHpBelow / allyHpBelow are fractions of max HP (any living ally incl. self); shieldsBelow compares the
 *           actor's current shields; notStatus requires the actor NOT to carry that status.
 * @property {EnemyHit[]} hits                Sorted by t. Empty for non-damaging actions.
 * @property {number} duration                ms from t = 0 until the action ends (≥ last t + 400).
 * @property {Array<Object>} [effects]        Effects applied after the hits. Targets from the enemy's viewpoint:
 *           'self' = the actor, 'allies' = the enemy side (incl. the actor), 'target' = the attack's party targets.
 */

/** Wind-up used when a hit does not specify one (SPEC §4.8). */
export const DEFAULT_WINDUP = 350;

/** Fixed enemy roster ids (SPEC §3.7), in bestiary order. */
export const ENEMY_IDS = [
  'driftling', 'shellguard', 'tidecaller', 'wreck_warden',
  'thornstag', 'mime', 'bloomwitch', 'bellwether',
  'coghound', 'sentinel', 'hourwraith',
  'stillkeeper',
  'dummy',
];

/** Closed sets used by the bestiary (mirrors SPEC §3.2 / §3.7 / §4.8). */
export const HIT_TYPES = ['normal', 'unparryable', 'jump', 'gradient', 'feint'];
export const MELEE_ANIMS = ['slash', 'thrust', 'slam', 'bite', 'spin', 'charge'];
export const RANGED_ANIMS = ['bolt', 'wave', 'beam', 'nova', 'cast'];
export const ENEMY_ANIMS = [...MELEE_ANIMS, ...RANGED_ANIMS];
export const ELEMENTS = ['physical', 'fire', 'ice', 'lightning', 'earth', 'light', 'dark'];
export const STATUS_IDS = ['burn', 'chill', 'mark', 'powerful', 'shell', 'haste', 'slow', 'weakened', 'defenseless', 'stun', 'regen', 'silence'];
export const EFFECT_TYPES = ['status', 'heal', 'revive', 'ap', 'cleanse', 'dispel', 'shieldBreak', 'break', 'gradient', 'surge', 'glyph', 'stance', 'shield'];
export const WEAK_POINT_EFFECTS = ['crit', 'break', 'shield'];
export const ENEMY_ZONES = ['shore', 'thicket', 'spire', 'summit', 'training'];

// ---------------------------------------------------------------------------------------------------------------
// Authoring helpers — they only build plain objects so every hit carries explicit element + windup values.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Build one damaging hit.
 * @param {number} t @param {HitType} type @param {number} power @param {EnemyAnim} anim
 * @param {{element?:Element, windup?:number, status?:[string, number, number]}} [opts] status = [id, turns, chance]
 * @returns {EnemyHit}
 */
function hit(t, type, power, anim, opts = {}) {
  const out = { t, type, power, element: opts.element ?? 'physical', anim, windup: opts.windup ?? DEFAULT_WINDUP };
  if (opts.status) out.status = { id: opts.status[0], turns: opts.status[1], chance: opts.status[2] };
  return out;
}

/** A bait swing: animates like a strike, never lands, pressing into it is a whiff. */
function feint(t, anim, opts = {}) {
  return { t, type: 'feint', power: 0, element: opts.element ?? 'physical', anim, windup: opts.windup ?? DEFAULT_WINDUP };
}

/** Turn an attack list into the `{ [id]: attack }` map the schema requires; `anim` defaults to the first hit's. */
function attackMap(list) {
  const map = {};
  for (const a of list) map[a.id] = { ...a, anim: a.anim ?? (a.hits[0] ? a.hits[0].anim : 'cast') };
  return map;
}

// ---------------------------------------------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------------------------------------------

/** @type {Record<string, Object>} */
export const ENEMIES = {
  // ============================================ BRINEGATE SHORE (L1–5) ============================================

  driftling: {
    id: 'driftling',
    name: 'Driftling',
    look: 'driftling',
    zone: 'shore',
    level: 2,
    stats: { hp: 520, atk: 60, def: 8, spd: 46, crit: 0.03 },
    affinities: { lightning: 1.5, fire: 0.5 },
    breakMax: 80,
    weakPoints: [{ id: 'core', effect: 'crit' }],
    xp: 33,
    glint: 18,
    drops: [{ relic: 'tidal_charm', chance: 0.05 }, { relic: 'feather_step', chance: 0.04 }],
    // Tutorial rhythms: one clear beat, or two evenly spaced beats. Generous wind-ups.
    attacks: attackMap([
      {
        id: 'lantern_sting',
        name: 'Lantern Sting',
        desc: 'Drifts close and jabs with a crackling filament. One clean beat.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [hit(1000, 'normal', 1.0, 'thrust', { element: 'lightning', windup: 450 })],
        duration: 1450,
      },
      {
        id: 'ribbon_lash',
        name: 'Ribbon Lash',
        desc: 'Two unhurried lashes of its trailing ribbons — one, and… two.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(950, 'normal', 0.75, 'slash', { windup: 400 }),
          hit(1500, 'normal', 0.75, 'slash', { windup: 400 }),
        ],
        duration: 1950,
      },
      {
        id: 'glow_pulse',
        name: 'Glow Pulse',
        desc: 'Its core swells and looses a slow orb of lantern-light.',
        target: 'single', approach: 'ranged', weight: 2, cooldown: 1,
        hits: [hit(900, 'normal', 0.9, 'bolt', { element: 'light', windup: 550 })],
        duration: 1400,
      },
    ]),
    pool: ['lantern_sting', 'ribbon_lash', 'glow_pulse'],
    bio: 'A lantern that learned to swim when the tide stopped. Driftlings bob along Brinegate in their hundreds, '
      + 'still trying to guide home ships that sank a lifetime ago. They sting out of habit more than malice.',
  },

  shellguard: {
    id: 'shellguard',
    name: 'Shellguard',
    look: 'shellguard',
    zone: 'shore',
    level: 3,
    stats: { hp: 580, atk: 86, def: 30, spd: 46, crit: 0.05 },
    affinities: { fire: 1.5, lightning: 1.5, ice: 0.5 },
    shields: 2,
    breakMax: 110,
    weakPoints: [{ id: 'conch', effect: 'shield' }, { id: 'eye', effect: 'crit' }],
    xp: 46,
    glint: 22,
    drops: [{ relic: 'aegis_thread', chance: 0.06 }, { relic: 'duelists_ribbon', chance: 0.04 }],
    // Teaches steady triplets, the first delayed "gotcha" slam, and shields.
    attacks: attackMap([
      {
        id: 'pincer_triplet',
        name: 'Pincer Triplet',
        desc: 'Three even snaps of the great claw. Count them: one, two, three.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(900, 'normal', 0.7, 'slash', { windup: 400 }),
          hit(1250, 'normal', 0.7, 'slash', { windup: 300 }),
          hit(1600, 'normal', 0.7, 'thrust', { windup: 300 }),
        ],
        duration: 2050,
      },
      {
        id: 'tide_crusher',
        name: 'Tide Crusher',
        desc: 'Raises the pincer high… and holds it there far longer than is polite.',
        target: 'single', approach: 'melee', weight: 2, cooldown: 1,
        hits: [hit(1650, 'normal', 1.6, 'slam', { windup: 1000 })],
        duration: 2150,
      },
      {
        id: 'snap_snap_crush',
        name: 'Snap, Snap, Crush',
        desc: 'Two quick nips, a breath, then the whole shell comes down.',
        target: 'single', approach: 'melee', weight: 2,
        hits: [
          hit(900, 'normal', 0.6, 'bite', { windup: 350 }),
          hit(1130, 'normal', 0.6, 'bite', { windup: 200 }),
          hit(1900, 'normal', 1.2, 'slam', { windup: 700 }),
        ],
        duration: 2400,
      },
      {
        id: 'shell_up',
        name: 'Shell Up',
        desc: 'Withdraws into its conch and re-plates its shell (+2 shields).',
        target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 3,
        condition: { shieldsBelow: 1 },
        hits: [],
        duration: 1200,
        effects: [{ type: 'shield', amount: 2, target: 'self' }],
      },
    ]),
    pool: ['pincer_triplet', 'tide_crusher', 'snap_snap_crush', 'shell_up'],
    bio: 'A hermit crab that found a knight\'s abandoned armour and decided it was a calling. '
      + 'Its shell plates turn aside blade and spell alike — crack the conch on its helm to strip them.',
  },

  tidecaller: {
    id: 'tidecaller',
    name: 'Tidecaller',
    look: 'tidecaller',
    zone: 'shore',
    level: 4,
    stats: { hp: 600, atk: 110, def: 14, spd: 54, crit: 0.05 },
    affinities: { earth: 1.5, lightning: 1.5, ice: 0.5 },
    breakMax: 90,
    weakPoints: [{ id: 'staff_pearl', effect: 'break' }],
    xp: 52,
    glint: 26,
    drops: [{ relic: 'frost_edge', chance: 0.05 }, { relic: 'dawn_locket', chance: 0.04 }],
    // Introduces JUMP: ground waves with long, readable wind-ups, then bolt/wave mixes.
    attacks: attackMap([
      {
        id: 'brine_bolt',
        name: 'Brine Bolt',
        desc: 'Two bolts of cold brine flung from the pearl.',
        target: 'single', approach: 'ranged', weight: 3,
        hits: [
          hit(700, 'normal', 0.75, 'bolt', { element: 'ice', windup: 450 }),
          hit(1100, 'normal', 0.75, 'bolt', { element: 'ice', windup: 350, status: ['chill', 2, 0.3] }),
        ],
        duration: 1550,
      },
      {
        id: 'undertow',
        name: 'Undertow',
        desc: 'Strikes the sand with its staff; a single swell rolls along the ground. Jump it.',
        target: 'single', approach: 'stay', weight: 3,
        hits: [hit(1000, 'jump', 1.2, 'wave', { windup: 650 })],
        duration: 1600,
      },
      {
        id: 'riptide',
        name: 'Riptide',
        desc: 'Two swells, one after the other. Land the first jump, then jump again.',
        target: 'single', approach: 'stay', weight: 2, cooldown: 1,
        hits: [
          hit(900, 'jump', 0.8, 'wave', { windup: 500 }),
          hit(1500, 'jump', 0.8, 'wave', { windup: 450 }),
        ],
        duration: 1950,
      },
      {
        id: 'tidal_hymn',
        name: 'Tidal Hymn',
        desc: 'Bolt, swell, bolt — a hymn that asks your hands and feet to take turns.',
        target: 'single', approach: 'ranged', weight: 2, cooldown: 1,
        hits: [
          hit(700, 'normal', 0.7, 'bolt', { element: 'ice', windup: 400 }),
          hit(1300, 'jump', 0.8, 'wave', { windup: 450 }),
          hit(1650, 'normal', 0.7, 'bolt', { element: 'ice', windup: 300 }),
        ],
        duration: 2100,
      },
      {
        id: 'pearl_mending',
        name: 'Pearl Mending',
        desc: 'The pearl glows and the tide returns a little of what it took (allies heal 25%).',
        target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 3,
        condition: { allyHpBelow: 0.6 },
        hits: [],
        duration: 1300,
        effects: [{ type: 'heal', pct: 0.25, target: 'allies' }],
      },
    ]),
    pool: ['brine_bolt', 'undertow', 'riptide', 'tidal_hymn', 'pearl_mending'],
    bio: 'Fish-headed acolytes who pray to a tide that no longer comes. Their coral staves can still call a swell '
      + 'along the sand — and mend their kin, which makes them the first thing worth silencing.',
  },

  wreck_warden: {
    id: 'wreck_warden',
    name: 'The Wreck Warden',
    look: 'wreck_warden',
    zone: 'shore',
    level: 5,
    boss: true,
    stats: { hp: 8000, atk: 105, def: 30, spd: 60, crit: 0.05 },
    affinities: { lightning: 1.5, earth: 1.5, fire: 0.5, ice: 0.5 },
    shields: 2,
    breakMax: 280,
    weakPoints: [{ id: 'porthole', effect: 'crit' }, { id: 'barnacles', effect: 'break' }],
    xp: 360,
    glint: 180,
    drops: [{ relic: 'anvil_heart', chance: 1 }, { relic: 'second_wind', chance: 0.25 }],
    statusResist: ['burn'],
    attacks: attackMap([
      {
        id: 'anchor_drop',
        name: 'Anchor Drop',
        desc: 'Hauls the anchor overhead. The chain creaks. Wait for it…',
        target: 'single', approach: 'melee', weight: 3, cooldown: 1,
        hits: [hit(1750, 'normal', 2.5, 'slam', { windup: 1100 })],
        duration: 2350,
      },
      {
        id: 'keelhaul_sweep',
        name: 'Keelhaul Sweep',
        desc: 'The anchor chain swings across the whole party. It cannot be parried — dodge!',
        target: 'all', approach: 'melee', weight: 2, cooldown: 2,
        hits: [hit(1200, 'unparryable', 1.4, 'spin', { windup: 700 })],
        duration: 1750,
      },
      {
        id: 'anchor_roll',
        name: 'Anchor Roll',
        desc: 'Bowls the anchor along the sand: three rolling shockwaves in steady time.',
        target: 'single', approach: 'stay', weight: 3,
        hits: [
          hit(900, 'jump', 0.7, 'wave', { windup: 500 }),
          hit(1350, 'jump', 0.7, 'wave', { windup: 400 }),
          hit(1800, 'jump', 0.7, 'wave', { windup: 400 }),
        ],
        duration: 2300,
      },
      {
        id: 'rusted_combo',
        name: 'Rusted Combo',
        desc: 'Two brass backhands, then an anchor slam that arrives a heartbeat late.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(950, 'normal', 0.75, 'slash', { windup: 450 }),
          hit(1300, 'normal', 0.75, 'slash', { windup: 300 }),
          hit(2000, 'normal', 1.4, 'slam', { windup: 700 }),
        ],
        duration: 2500,
      },
      {
        id: 'undertow_chain',
        name: 'Undertow Chain',
        desc: 'A lash, a long hauling pause, the slam — and the chain snaps back an instant later.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(950, 'normal', 0.7, 'slash', { windup: 450 }),
          hit(2000, 'normal', 1.4, 'slam', { windup: 950 }),
          hit(2230, 'normal', 0.6, 'thrust', { windup: 220 }),
        ],
        duration: 2700,
      },
      {
        id: 'tide_rolls',
        name: 'Tide Rolls',
        desc: 'Four shockwave rolls: two together, a hitch, then two more.',
        target: 'single', approach: 'stay', weight: 3,
        hits: [
          hit(900, 'jump', 0.6, 'wave', { windup: 500 }),
          hit(1250, 'jump', 0.6, 'wave', { windup: 330 }),
          hit(1850, 'jump', 0.6, 'wave', { windup: 550 }),
          hit(2200, 'jump', 0.6, 'wave', { windup: 330 }),
        ],
        duration: 2650,
      },
      {
        id: 'hull_breaker',
        name: 'Hull Breaker',
        desc: 'A backhand, a low chain sweep to jump, then the anchor comes down.',
        target: 'single', approach: 'melee', weight: 2,
        hits: [
          hit(900, 'normal', 0.75, 'slash', { windup: 420 }),
          hit(1300, 'jump', 0.75, 'spin', { windup: 380 }),
          hit(1900, 'normal', 1.3, 'slam', { windup: 580 }),
        ],
        duration: 2400,
      },
      {
        id: 'take_on_ballast',
        name: 'Take on Ballast',
        desc: 'Seals its hatches and bolts on fresh plating (+2 shields).',
        target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 4,
        condition: { shieldsBelow: 1 },
        hits: [],
        duration: 1300,
        effects: [{ type: 'shield', amount: 2, target: 'self' }],
      },
    ]),
    pool: ['anchor_drop', 'keelhaul_sweep', 'anchor_roll', 'rusted_combo', 'take_on_ballast'],
    phases: [
      {
        hpBelow: 0.5,
        pool: ['anchor_drop', 'keelhaul_sweep', 'undertow_chain', 'tide_rolls', 'hull_breaker', 'take_on_ballast'],
        text: 'The porthole floods crimson — the Warden seals its hatches and lets out the chain.',
        effects: [{ type: 'shield', amount: 2, target: 'self' }],
        statMult: { spd: 1.2 },
      },
    ],
    bio: 'A harbour diving suit from Expedition 7 that never came back up. The diver inside has been holding his breath '
      + 'for sixty-two years, and the suit walks the wreck line with an anchor the size of a door, letting no one pass.',
  },

  // ============================================ THE GILDED THICKET (L5–10) ==========================================

  thornstag: {
    id: 'thornstag',
    name: 'Thornstag',
    look: 'thornstag',
    zone: 'thicket',
    level: 6,
    stats: { hp: 1080, atk: 146, def: 30, spd: 59, crit: 0.06 },
    affinities: { fire: 1.5, earth: 0.5 },
    breakMax: 100,
    weakPoints: [{ id: 'heartwood', effect: 'crit' }, { id: 'antlers', effect: 'break' }],
    xp: 250,
    glint: 44,
    drops: [{ relic: 'thorn_wreath', chance: 0.06 }, { relic: 'keen_whetstone', chance: 0.04 }],
    // Unparryable charges and irregular, syncopated rhythms.
    attacks: attackMap([
      {
        id: 'gilded_charge',
        name: 'Gilded Charge',
        desc: 'Lowers its thorned antlers, paws the gold leaf… and charges. Red means dodge.',
        target: 'single', approach: 'melee', weight: 3, cooldown: 1,
        hits: [hit(1300, 'unparryable', 1.5, 'charge', { windup: 800 })],
        duration: 1800,
      },
      {
        id: 'antler_rake',
        name: 'Antler Rake',
        desc: 'Two quick rakes, a stumble of silence, then a goring thrust.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(900, 'normal', 0.8, 'slash', { windup: 400 }),
          hit(1100, 'normal', 0.65, 'slash', { windup: 190 }),
          hit(1650, 'normal', 1.2, 'thrust', { windup: 500 }),
        ],
        duration: 2100,
      },
      {
        id: 'rootquake',
        name: 'Rootquake',
        desc: 'Stamps the loam: one wave, a long wait, then two in a hurry.',
        target: 'single', approach: 'stay', weight: 2,
        hits: [
          hit(800, 'jump', 0.75, 'wave', { element: 'earth', windup: 500 }),
          hit(1400, 'jump', 0.75, 'wave', { element: 'earth', windup: 550 }),
          hit(1750, 'jump', 0.75, 'wave', { element: 'earth', windup: 330 }),
        ],
        duration: 2200,
      },
      {
        id: 'bramble_volley',
        name: 'Bramble Volley',
        desc: 'Shakes loose a spray of thorns at whoever stands nearest.',
        target: 'multi', approach: 'ranged', weight: 2,
        hits: [
          hit(700, 'normal', 0.6, 'bolt', { windup: 450 }),
          hit(950, 'normal', 0.6, 'bolt', { windup: 240 }),
          hit(1200, 'normal', 0.6, 'bolt', { windup: 240 }),
        ],
        duration: 1650,
      },
    ]),
    pool: ['gilded_charge', 'antler_rake', 'rootquake', 'bramble_volley'],
    bio: 'Autumn stopped halfway through turning the Thicket, and the stags turned with it: gilt leaves, thorn antlers, '
      + 'heartwood glowing through the ribs. They charge anything that moves, as if movement itself were an insult.',
  },

  mime: {
    id: 'mime',
    name: 'Gilded Harlequin',
    look: 'mime',
    zone: 'thicket',
    level: 7,
    stats: { hp: 1060, atk: 158, def: 26, spd: 64, crit: 0.08 },
    affinities: { ice: 1.5, light: 0.5 },
    breakMax: 90,
    weakPoints: [{ id: 'mask', effect: 'crit' }],
    xp: 275,
    glint: 48,
    drops: [{ relic: 'glass_rose', chance: 0.05 }, { relic: 'hunters_mark', chance: 0.04 }],
    statusResist: ['silence'],
    // The first FEINTS: bait swings that punish button-mashing, and a delayed spin.
    attacks: attackMap([
      {
        id: 'false_lunge',
        name: 'False Lunge',
        desc: 'Lunges — stops short with a bow — and lunges for real. Don\'t take the bait.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          feint(950, 'thrust', { windup: 450 }),
          hit(1500, 'normal', 1.3, 'thrust', { windup: 400 }),
        ],
        duration: 1950,
      },
      {
        id: 'mirror_waltz',
        name: 'Mirror Waltz',
        desc: 'Three bright cuts in waltz time, a mimed flourish that goes nowhere, then the real thrust.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(900, 'normal', 0.6, 'slash', { windup: 400 }),
          hit(1150, 'normal', 0.6, 'slash', { windup: 240 }),
          hit(1400, 'normal', 0.6, 'slash', { windup: 240 }),
          feint(1950, 'thrust', { windup: 500 }),
          hit(2500, 'normal', 1.1, 'thrust', { windup: 500 }),
        ],
        duration: 2950,
      },
      {
        id: 'curtain_call',
        name: 'Curtain Call',
        desc: 'A long, theatrical bow… that ends in a spinning ribbon-cut. Leaves the victim marked.',
        target: 'single', approach: 'melee', weight: 2, cooldown: 1,
        hits: [hit(1750, 'normal', 1.6, 'spin', { windup: 1050, status: ['mark', 3, 0.5] })],
        duration: 2300,
      },
      {
        id: 'pretend_knives',
        name: 'Pretend Knives',
        desc: 'Throws a knife. Pretends to throw another. Throws two more. Only three are real.',
        target: 'multi', approach: 'ranged', weight: 2,
        hits: [
          hit(700, 'normal', 0.65, 'bolt', { windup: 400 }),
          feint(1050, 'bolt', { windup: 300 }),
          hit(1600, 'normal', 0.65, 'bolt', { windup: 500 }),
          hit(1850, 'normal', 0.65, 'bolt', { windup: 240 }),
        ],
        duration: 2300,
      },
    ]),
    pool: ['false_lunge', 'mirror_waltz', 'curtain_call', 'pretend_knives'],
    bio: 'Harlequins of gold leaf and ivory lacquer who perform to an audience that left sixty-eight years ago. '
      + 'Every flourish is a lie until the one that isn\'t. They cannot be silenced; they never speak anyway.',
  },

  bloomwitch: {
    id: 'bloomwitch',
    name: 'Bloomwitch',
    look: 'bloomwitch',
    zone: 'thicket',
    level: 8,
    stats: { hp: 1140, atk: 218, def: 24, spd: 57, crit: 0.05 },
    affinities: { fire: 1.5, ice: 1.5, earth: 0.5, light: 0.5 },
    breakMax: 90,
    weakPoints: [{ id: 'bloom', effect: 'break' }],
    xp: 295,
    glint: 52,
    drops: [{ relic: 'verdant_brooch', chance: 0.06 }, { relic: 'cinder_seal', chance: 0.04 }],
    // AoE novas (one outcome for the whole party) and ally heals.
    attacks: attackMap([
      {
        id: 'petal_nova',
        name: 'Petal Nova',
        desc: 'Gathers every petal of her gown and releases them at once around the whole party.',
        target: 'all', approach: 'stay', weight: 2, cooldown: 1,
        hits: [hit(1300, 'normal', 1.0, 'nova', { windup: 900, status: ['silence', 2, 0.2] })],
        duration: 1800,
      },
      {
        id: 'thornwhip',
        name: 'Thornwhip',
        desc: 'A cut, a thrust, and a flick that comes quicker than the others.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(900, 'normal', 1.0, 'slash', { windup: 400 }),
          hit(1300, 'normal', 0.8, 'thrust', { windup: 350 }),
          hit(1550, 'normal', 0.8, 'slash', { windup: 240 }),
        ],
        duration: 2000,
      },
      {
        id: 'pollen_waltz',
        name: 'Pollen Waltz',
        desc: 'Three soft bursts of pollen around the party in even time. The last one saps strength.',
        target: 'all', approach: 'stay', weight: 2,
        hits: [
          hit(800, 'normal', 0.55, 'nova', { element: 'earth', windup: 500 }),
          hit(1150, 'normal', 0.55, 'nova', { element: 'earth', windup: 330 }),
          hit(1500, 'normal', 0.55, 'nova', { element: 'earth', windup: 330, status: ['weakened', 2, 0.3] }),
        ],
        duration: 1950,
      },
      {
        id: 'bramble_snare',
        name: 'Bramble Snare',
        desc: 'Roots burst along the ground, then a thorn is flung at whoever landed.',
        target: 'single', approach: 'stay', weight: 2,
        hits: [
          hit(900, 'jump', 0.9, 'wave', { element: 'earth', windup: 500 }),
          hit(1400, 'normal', 0.9, 'bolt', { windup: 420 }),
        ],
        duration: 1900,
      },
      {
        id: 'verdant_grace',
        name: 'Verdant Grace',
        desc: 'Waters her companions with dew from the rose (allies heal 25% and regenerate).',
        target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 3,
        condition: { allyHpBelow: 0.65 },
        hits: [],
        duration: 1400,
        effects: [
          { type: 'heal', pct: 0.25, target: 'allies' },
          { type: 'status', status: 'regen', turns: 2, target: 'allies' },
        ],
      },
    ]),
    pool: ['petal_nova', 'thornwhip', 'pollen_waltz', 'bramble_snare', 'verdant_grace'],
    bio: 'Gardeners who loved their roses so much they wore them — and then became them. '
      + 'Nothing in her care is allowed to wilt, least of all her allies. Deal with her first.',
  },

  bellwether: {
    id: 'bellwether',
    name: 'The Bellwether',
    look: 'bellwether',
    zone: 'thicket',
    level: 10,
    boss: true,
    stats: { hp: 13000, atk: 240, def: 45, spd: 70, crit: 0.06 },
    affinities: { earth: 1.5, ice: 1.5, fire: 0.5 },
    breakMax: 340,
    weakPoints: [{ id: 'bell_clapper', effect: 'break' }, { id: 'eye', effect: 'crit' }],
    xp: 1500,
    glint: 420,
    drops: [{ relic: 'warding_bell', chance: 1 }, { relic: 'metronome', chance: 0.3 }],
    // Introduces the GRADIENT hit: a prismatic toll you counter with {gradient} (or at least dodge).
    attacks: attackMap([
      {
        id: 'hammer_toll',
        name: 'Toll the Hour',
        desc: 'Three heavy hammer strokes, as steady as a clock striking three.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(1000, 'normal', 0.8, 'slam', { windup: 500 }),
          hit(1500, 'normal', 0.8, 'slam', { windup: 400 }),
          hit(2000, 'normal', 0.8, 'slam', { windup: 400 }),
        ],
        duration: 2500,
      },
      {
        id: 'triple_knell',
        name: 'Triple Knell',
        desc: 'Strikes the ground three times; three shockwaves roll out in even time.',
        target: 'single', approach: 'stay', weight: 3,
        hits: [
          hit(900, 'jump', 0.7, 'wave', { windup: 500 }),
          hit(1300, 'jump', 0.7, 'wave', { windup: 380 }),
          hit(1700, 'jump', 0.7, 'wave', { windup: 380 }),
        ],
        duration: 2200,
      },
      {
        id: 'verdict_of_bronze',
        name: 'Verdict of Bronze',
        desc: 'The bell swings back and the world loses its colour. Answer the toll with a Prism Counter — or dodge.',
        target: 'single', approach: 'stay', weight: 2, cooldown: 2,
        hits: [hit(1500, 'gradient', 2.2, 'nova', { element: 'dark', windup: 1100 })],
        duration: 2100,
      },
      {
        id: 'rams_rush',
        name: 'Ram\'s Rush',
        desc: 'A butt of the horns, then the hammer — late, and hard.',
        target: 'single', approach: 'melee', weight: 2,
        hits: [
          hit(900, 'normal', 0.9, 'thrust', { windup: 450 }),
          hit(1650, 'normal', 1.5, 'slam', { windup: 700 }),
        ],
        duration: 2150,
      },
      {
        id: 'swing_low',
        name: 'Swing Low',
        desc: 'A low hammer sweep to jump over, straight into an overhead blow.',
        target: 'single', approach: 'melee', weight: 2,
        hits: [
          hit(1100, 'jump', 1.0, 'spin', { windup: 600 }),
          hit(1600, 'normal', 1.1, 'slam', { windup: 450 }),
        ],
        duration: 2100,
      },
      {
        id: 'knell_cascade',
        name: 'Knell Cascade',
        desc: 'Three rolling shockwaves — and, when the last has passed, a prismatic toll.',
        target: 'single', approach: 'stay', weight: 3, cooldown: 1,
        hits: [
          hit(900, 'jump', 0.6, 'wave', { windup: 500 }),
          hit(1250, 'jump', 0.6, 'wave', { windup: 330 }),
          hit(1600, 'jump', 0.6, 'wave', { windup: 330 }),
          hit(2400, 'gradient', 1.6, 'nova', { element: 'dark', windup: 750 }),
        ],
        duration: 2950,
      },
      {
        id: 'discordant_toll',
        name: 'Discordant Toll',
        desc: 'The cracked bell has lost the beat: two quick strokes, a lurch, two more.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(900, 'normal', 0.7, 'slam', { windup: 450 }),
          hit(1150, 'normal', 0.7, 'slam', { windup: 230 }),
          hit(1900, 'normal', 0.9, 'slam', { windup: 700 }),
          hit(2100, 'normal', 0.7, 'slam', { windup: 190 }),
        ],
        duration: 2600,
      },
      {
        id: 'vesper_chorus',
        name: 'Vesper Chorus',
        desc: 'Two deafening peals around the whole party. The second one can steal your voice.',
        target: 'all', approach: 'stay', weight: 2, cooldown: 1,
        hits: [
          hit(1000, 'normal', 0.65, 'nova', { element: 'dark', windup: 600 }),
          hit(1600, 'normal', 0.65, 'nova', { element: 'dark', windup: 450, status: ['silence', 2, 0.35] }),
        ],
        duration: 2100,
      },
    ]),
    pool: ['hammer_toll', 'triple_knell', 'verdict_of_bronze', 'rams_rush', 'swing_low'],
    phases: [
      {
        hpBelow: 0.5,
        pool: ['knell_cascade', 'verdict_of_bronze', 'discordant_toll', 'swing_low', 'vesper_chorus'],
        text: 'The bell cracks — and every crack rings a different hour.',
        effects: [{ type: 'cleanse', target: 'self' }],
        statMult: { spd: 1.15, atk: 1.1 },
      },
    ],
    bio: 'A great bronze bell on a ram-horned body, cast to ring the hours for the Thicket\'s gardeners. '
      + 'It still rings them — the same hour, over and over — and it has decided you are late.',
  },

  // ============================================ THE MERIDIAN SPIRE (L10–15) =========================================

  coghound: {
    id: 'coghound',
    name: 'Coghound',
    look: 'coghound',
    zone: 'spire',
    level: 11,
    stats: { hp: 1340, atk: 289, def: 34, spd: 74, crit: 0.1 },
    affinities: { ice: 1.5, lightning: 1.5, earth: 0.5 },
    breakMax: 90,
    weakPoints: [{ id: 'mainspring', effect: 'crit' }],
    xp: 415,
    glint: 84,
    drops: [{ relic: 'quickened_gear', chance: 0.06 }, { relic: 'executioners_coin', chance: 0.03 }],
    // Rapid bursts at 180–220 ms: listen to the ratchet, don't watch the teeth.
    attacks: attackMap([
      {
        id: 'ratchet_bite',
        name: 'Ratchet Bite',
        desc: 'Four bites as fast as a ratchet clicks: tik-tik-tik-tik.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(900, 'normal', 0.7, 'bite', { windup: 400 }),
          hit(1100, 'normal', 0.7, 'bite', { windup: 190 }),
          hit(1300, 'normal', 0.7, 'bite', { windup: 190 }),
          hit(1480, 'normal', 0.8, 'bite', { windup: 170 }),
        ],
        duration: 1950,
      },
      {
        id: 'mainspring_pounce',
        name: 'Mainspring Pounce',
        desc: 'Coils its spring tight, holds… pounces, and worries the prey twice.',
        target: 'single', approach: 'melee', weight: 2, cooldown: 1,
        hits: [
          hit(1350, 'normal', 1.3, 'charge', { windup: 850 }),
          hit(1550, 'normal', 0.6, 'bite', { windup: 190 }),
          hit(1760, 'normal', 0.6, 'bite', { windup: 200 }),
        ],
        duration: 2200,
      },
      {
        id: 'gear_scatter',
        name: 'Gear Scatter',
        desc: 'Shakes loose a burst of sprung gears, one every fifth of a second.',
        target: 'multi', approach: 'ranged', weight: 2,
        hits: [
          hit(700, 'normal', 0.65, 'bolt', { windup: 400 }),
          hit(890, 'normal', 0.65, 'bolt', { windup: 180 }),
          hit(1080, 'normal', 0.65, 'bolt', { windup: 180 }),
          hit(1270, 'normal', 0.65, 'bolt', { windup: 180 }),
        ],
        duration: 1700,
      },
      {
        id: 'tail_sweep',
        name: 'Tail Sweep',
        desc: 'A low sweep of its bladed tail to jump, and a snap at the landing.',
        target: 'single', approach: 'melee', weight: 2,
        hits: [
          hit(1000, 'jump', 1.1, 'spin', { windup: 500 }),
          hit(1310, 'normal', 0.8, 'bite', { windup: 290 }),
        ],
        duration: 1750,
      },
      {
        id: 'overwind',
        name: 'Overwind',
        desc: 'Winds its own key until the gears scream (gains Haste).',
        target: 'single', approach: 'stay', anim: 'cast', weight: 2, cooldown: 3,
        condition: { notStatus: 'haste' },
        hits: [],
        duration: 1100,
        effects: [{ type: 'status', status: 'haste', turns: 2, target: 'self' }],
      },
    ]),
    pool: ['ratchet_bite', 'mainspring_pounce', 'gear_scatter', 'tail_sweep', 'overwind'],
    bio: 'The Spire\'s clockwork kept building itself after its makers left, and some of the pieces learned to hunt. '
      + 'Coghounds run in packs and bite in bursts — the exposed mainspring on their backs is a gift. Take it.',
  },

  sentinel: {
    id: 'sentinel',
    name: 'Porcelain Sentinel',
    look: 'sentinel',
    zone: 'spire',
    level: 12,
    stats: { hp: 1300, atk: 299, def: 60, spd: 53, crit: 0.05 },
    affinities: { physical: 1.5, earth: 1.5, fire: 0, ice: 0.5 },
    shields: 3,
    breakMax: 120,
    weakPoints: [{ id: 'clockface', effect: 'shield' }, { id: 'crack', effect: 'break' }],
    xp: 485,
    glint: 100,
    drops: [{ relic: 'shatterglass', chance: 0.06 }, { relic: 'marksmans_eye', chance: 0.04 }],
    statusResist: ['burn'],
    // Long pendulum delays and metronomic six-hit strings behind a three-layer shield.
    attacks: attackMap([
      {
        id: 'pendulum_cleave',
        name: 'Pendulum Cleave',
        desc: 'Sways its blade like a pendulum — tick, tock, tick — and cleaves on a beat you did not expect.',
        target: 'single', approach: 'melee', weight: 2, cooldown: 1,
        hits: [hit(1900, 'normal', 1.7, 'slash', { windup: 1100, status: ['stun', 1, 0.2] })],
        duration: 2500,
      },
      {
        id: 'metronome',
        name: 'Metronome',
        desc: 'Six strokes in perfect, pitiless time. Keep the beat.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(900, 'normal', 0.5, 'slash', { windup: 400 }),
          hit(1200, 'normal', 0.5, 'thrust', { windup: 280 }),
          hit(1500, 'normal', 0.5, 'slash', { windup: 280 }),
          hit(1800, 'normal', 0.5, 'thrust', { windup: 280 }),
          hit(2100, 'normal', 0.5, 'slash', { windup: 280 }),
          hit(2400, 'normal', 0.5, 'thrust', { windup: 280 }),
        ],
        duration: 2850,
      },
      {
        id: 'escapement',
        name: 'Escapement',
        desc: 'A low shield sweep to jump, a cut, then a long pendulum pause before the last stroke.',
        target: 'single', approach: 'melee', weight: 2,
        hits: [
          hit(1100, 'jump', 1.0, 'spin', { windup: 600 }),
          hit(1650, 'normal', 0.8, 'slash', { windup: 450 }),
          hit(2550, 'normal', 1.3, 'slash', { windup: 850 }),
        ],
        duration: 3050,
      },
      {
        id: 'glaze_ward',
        name: 'Glaze Ward',
        desc: 'Fresh glaze runs over the cracks and sets hard (+2 shields).',
        target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 3,
        condition: { shieldsBelow: 2 },
        hits: [],
        duration: 1300,
        effects: [{ type: 'shield', amount: 2, target: 'self' }],
      },
    ]),
    pool: ['pendulum_cleave', 'metronome', 'escapement', 'glaze_ward'],
    bio: 'Porcelain knights fired in the Spire\'s kilns to guard the stair. Their clock-face shields mend themselves; '
      + 'strike the dial to shatter the glaze, then find the crack and hit it with something heavy. Kiln-born, it shrugs off fire.',
  },

  hourwraith: {
    id: 'hourwraith',
    name: 'Hour Wraith',
    look: 'hourwraith',
    zone: 'spire',
    level: 13,
    stats: { hp: 1400, atk: 338, def: 40, spd: 67, crit: 0.07 },
    affinities: { light: 1.5, physical: 0.5 },
    breakMax: 100,
    weakPoints: [{ id: 'pendulum', effect: 'crit' }],
    xp: 515,
    glint: 106,
    drops: [{ relic: 'stillwater_pearl', chance: 0.06 }, { relic: 'prism_shard', chance: 0.04 }],
    statusResist: ['slow'],
    // Gradient hits and slowing: it steals time.
    attacks: attackMap([
      {
        id: 'minute_hand',
        name: 'Minute Hand, Hour Hand',
        desc: 'Two quick sweeps of the minute hand; then the hour hand, which takes its time.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(1000, 'normal', 0.75, 'slash', { element: 'dark', windup: 450 }),
          hit(1300, 'normal', 0.75, 'slash', { element: 'dark', windup: 290 }),
          hit(2150, 'normal', 1.4, 'thrust', { element: 'dark', windup: 850 }),
        ],
        duration: 2650,
      },
      {
        id: 'stopped_moment',
        name: 'Stopped Moment',
        desc: 'Colour drains from the room as it fixes you with a beam of stilled time. Prism Counter it.',
        target: 'single', approach: 'ranged', weight: 2, cooldown: 2,
        hits: [hit(1500, 'gradient', 1.7, 'beam', { element: 'dark', windup: 1000, status: ['slow', 2, 0.8] })],
        duration: 2000,
      },
      {
        id: 'pendulum_heart',
        name: 'Pendulum Heart',
        desc: 'Its heart swings low — and back — before a last cut. Jump, jump, then parry.',
        target: 'single', approach: 'melee', weight: 2,
        hits: [
          hit(1100, 'jump', 0.85, 'spin', { element: 'dark', windup: 600 }),
          hit(1550, 'jump', 0.85, 'spin', { element: 'dark', windup: 440 }),
          hit(2050, 'normal', 0.95, 'slash', { element: 'dark', windup: 480 }),
        ],
        duration: 2500,
      },
      {
        id: 'borrowed_time',
        name: 'Borrowed Time',
        desc: 'Two stolen seconds thrown as bolts, then the debt comes due in prismatic light.',
        target: 'single', approach: 'ranged', weight: 2, cooldown: 1,
        hits: [
          hit(700, 'normal', 0.6, 'bolt', { element: 'dark', windup: 400 }),
          hit(950, 'normal', 0.6, 'bolt', { element: 'dark', windup: 240 }),
          hit(1800, 'gradient', 1.4, 'beam', { element: 'dark', windup: 750 }),
        ],
        duration: 2300,
      },
      {
        id: 'gloaming_drag',
        name: 'Gloaming Drag',
        desc: 'A slow ring of smoke drags at the whole party\'s heels.',
        target: 'all', approach: 'stay', weight: 2, cooldown: 1,
        hits: [hit(1200, 'normal', 0.8, 'nova', { element: 'dark', windup: 800, status: ['slow', 2, 0.5] })],
        duration: 1700,
      },
      {
        id: 'rewind',
        name: 'Rewind',
        desc: 'Turns its hands backward, unmaking the party\'s blessings (dispels positive statuses).',
        target: 'all', approach: 'stay', anim: 'cast', weight: 1, cooldown: 3,
        hits: [],
        duration: 1300,
        effects: [{ type: 'dispel', target: 'target' }],
      },
    ]),
    pool: ['minute_hand', 'stopped_moment', 'pendulum_heart', 'borrowed_time', 'gloaming_drag', 'rewind'],
    bio: 'Smoke wearing clock hands, with a pendulum for a heart. Hour Wraiths are made of hours nobody got to live; '
      + 'they feed on yours. Light scatters them, blades mostly pass through.',
  },

  // ============================================ THE SUMMIT (L15–16) =================================================

  stillkeeper: {
    id: 'stillkeeper',
    name: 'The Stillkeeper',
    look: 'stillkeeper',
    zone: 'summit',
    level: 16,
    boss: true,
    stats: { hp: 17000, atk: 400, def: 70, spd: 66, crit: 0.08 },
    affinities: { lightning: 1.5, light: 0.5 },
    shields: 3,
    breakMax: 400,
    weakPoints: [{ id: 'halo', effect: 'break' }, { id: 'heart_gear', effect: 'crit' }],
    xp: 4000,
    // The final boss pays in Glint (for the post-game); its old Sun Fragment waits in the spire's top chest instead,
    // where it can still be used against the Stillkeeper.
    glint: 1500,
    drops: [{ relic: 'last_light', chance: 0.5 }],
    statusResist: ['slow', 'chill'],
    attacks: attackMap([
      // ---- Phase 1: the Keeper of Noon — measured, regal, every beat placed ----
      {
        id: 'gnomon_cleave',
        name: 'Gnomon Cleave',
        desc: 'Two sweeps of the sundial glaive, then the shadow of noon falls — late.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(950, 'normal', 0.8, 'slash', { windup: 450 }),
          hit(1300, 'normal', 0.8, 'slash', { windup: 320 }),
          hit(2150, 'normal', 1.6, 'slam', { windup: 850 }),
        ],
        duration: 2700,
      },
      {
        id: 'noon_verdict',
        name: 'Noon Verdict',
        desc: 'The cracked halo blazes and the world goes grey. A prism strike of pure noon.',
        target: 'single', approach: 'stay', weight: 2, cooldown: 2,
        hits: [hit(1700, 'gradient', 2.1, 'beam', { element: 'light', windup: 1100 })],
        duration: 2300,
      },
      {
        id: 'sundial_rolls',
        name: 'Sundial Rolls',
        desc: 'Shadows race across the dial: three rolls in time, a hitch, and two more.',
        target: 'single', approach: 'stay', weight: 3,
        hits: [
          hit(900, 'jump', 0.55, 'wave', { windup: 500 }),
          hit(1250, 'jump', 0.55, 'wave', { windup: 340 }),
          hit(1600, 'jump', 0.55, 'wave', { windup: 340 }),
          hit(2100, 'jump', 0.55, 'wave', { windup: 480 }),
          hit(2450, 'jump', 0.55, 'wave', { windup: 340 }),
        ],
        duration: 2900,
      },
      {
        id: 'halo_sweep',
        name: 'Halo Sweep',
        desc: 'Swings the glaive in a full blazing circle through the whole party. Unparryable.',
        target: 'all', approach: 'melee', weight: 2, cooldown: 2,
        hits: [hit(1250, 'unparryable', 1.3, 'spin', { element: 'light', windup: 750 })],
        duration: 1800,
      },
      {
        id: 'meridian_lances',
        name: 'Meridian Lances',
        desc: 'Lances of light, one after another — then a hesitation, a lance that never comes, and the last.',
        target: 'multi', approach: 'ranged', weight: 2,
        hits: [
          hit(700, 'normal', 0.6, 'bolt', { element: 'light', windup: 400 }),
          hit(950, 'normal', 0.6, 'bolt', { element: 'light', windup: 240 }),
          hit(1200, 'normal', 0.6, 'bolt', { element: 'light', windup: 240 }),
          feint(1500, 'bolt', { element: 'light', windup: 290 }),
          hit(2050, 'normal', 1.1, 'bolt', { element: 'light', windup: 500 }),
        ],
        duration: 2500,
      },
      {
        id: 'stilling_ward',
        name: 'Stilling Ward',
        desc: 'Stops the moment around itself like a pane of glass (+2 shields).',
        target: 'single', approach: 'stay', anim: 'cast', weight: 4, cooldown: 4,
        condition: { shieldsBelow: 1 },
        hits: [],
        duration: 1300,
        effects: [{ type: 'shield', amount: 2, target: 'self' }],
      },
      // ---- Phase 2: Unwound — faster, syncopated, every rule at once ----
      {
        id: 'unwound_cadenza',
        name: 'Unwound Cadenza',
        desc: 'Seven strokes with no time signature left: two, two, a lurch — and three more on its heels.',
        target: 'single', approach: 'melee', weight: 3,
        hits: [
          hit(900, 'normal', 0.45, 'slash', { windup: 450 }),
          hit(1100, 'normal', 0.45, 'slash', { windup: 190 }),
          hit(1450, 'normal', 0.45, 'thrust', { windup: 340 }),
          hit(1650, 'normal', 0.45, 'slash', { windup: 190 }),
          hit(2350, 'normal', 0.7, 'slam', { windup: 700 }),
          hit(2550, 'normal', 0.45, 'slash', { windup: 190 }),
          hit(2750, 'normal', 0.5, 'thrust', { windup: 190 }),
        ],
        duration: 3250,
      },
      {
        id: 'eclipse_sequence',
        name: 'Eclipse Sequence',
        desc: 'Shadow and noon in turn: roll, roll, prism — roll, prism. Feet, feet, Prism; feet, Prism.',
        target: 'single', approach: 'stay', weight: 3, cooldown: 1,
        hits: [
          hit(900, 'jump', 0.45, 'wave', { windup: 500 }),
          hit(1250, 'jump', 0.45, 'wave', { windup: 340 }),
          hit(1950, 'gradient', 0.9, 'beam', { element: 'light', windup: 700 }),
          hit(2400, 'jump', 0.45, 'wave', { windup: 440 }),
          hit(3150, 'gradient', 1.75, 'nova', { element: 'dark', windup: 750 }),
        ],
        duration: 3700,
      },
      {
        id: 'hush_of_ages',
        name: 'Hush of Ages',
        desc: 'A soundless wave of stilled time over the whole party. Fail to defend it and everyone is slowed.',
        target: 'all', approach: 'stay', weight: 2, cooldown: 3,
        hits: [hit(1400, 'normal', 0.7, 'nova', { element: 'dark', windup: 1000, status: ['slow', 2, 1] })],
        duration: 1950,
      },
      {
        id: 'shard_orbit',
        name: 'Shard Orbit',
        desc: 'The broken halo\'s shards whip past, one every fifth of a second.',
        target: 'multi', approach: 'ranged', weight: 2,
        hits: [
          hit(700, 'normal', 0.45, 'bolt', { element: 'light', windup: 400 }),
          hit(900, 'normal', 0.45, 'bolt', { element: 'light', windup: 190 }),
          hit(1100, 'normal', 0.45, 'bolt', { element: 'light', windup: 190 }),
          hit(1300, 'normal', 0.45, 'bolt', { element: 'light', windup: 190 }),
          hit(1500, 'normal', 0.45, 'bolt', { element: 'light', windup: 190 }),
        ],
        duration: 1950,
      },
      {
        id: 'last_noon',
        name: 'The Last Noon',
        desc: 'Desperate: it pours every hoarded second out at once — a red nova, two rolls, and a final blinding verdict.',
        target: 'all', approach: 'stay', weight: 10, cooldown: 3,
        condition: { selfHpBelow: 0.2 },
        hits: [
          hit(1200, 'unparryable', 0.7, 'nova', { element: 'light', windup: 900 }),
          hit(1750, 'jump', 0.5, 'wave', { windup: 500 }),
          hit(2100, 'jump', 0.5, 'wave', { windup: 340 }),
          hit(3100, 'gradient', 1.2, 'beam', { element: 'light', windup: 1000 }),
        ],
        duration: 3600,
      },
    ]),
    pool: ['gnomon_cleave', 'noon_verdict', 'sundial_rolls', 'halo_sweep', 'meridian_lances', 'stilling_ward'],
    phases: [
      {
        hpBelow: 0.5,
        pool: ['unwound_cadenza', 'eclipse_sequence', 'hush_of_ages', 'shard_orbit', 'halo_sweep', 'last_noon'],
        text: 'UNWOUND — the halo shatters, and every hoarded second comes due at once.',
        effects: [{ type: 'shield', amount: 2, target: 'self' }, { type: 'cleanse', target: 'self' }],
        statMult: { spd: 1.3, atk: 1.1 },
      },
    ],
    bio: 'A towering knight of clockwork and gilt, wearing a cracked halo of sun. It holds the great hand of the Sun '
      + 'at the last minute of an evening that has lasted sixty-eight years — and it has never once asked to be relieved.',
  },

  // ============================================ TRAINING ============================================================

  dummy: {
    id: 'dummy',
    name: 'Training Mannequin',
    look: 'dummy',
    zone: 'training',
    level: 1,
    stats: { hp: 3000, atk: 8, def: 0, spd: 45, crit: 0 },
    affinities: { fire: 1.5 },
    breakMax: 60,
    weakPoints: [{ id: 'target', effect: 'crit' }],
    xp: 0,
    glint: 0,
    drops: [],
    // One gentle example of every hit type, then a medley. Long wind-ups; never punishing.
    attacks: attackMap([
      {
        id: 'wobbling_poke',
        name: 'Wobbling Poke',
        desc: 'NORMAL — a clean white cue. Parry for AP, or dodge for safety.',
        target: 'single', approach: 'melee', weight: 2, cooldown: 1,
        hits: [hit(1000, 'normal', 1.0, 'thrust', { windup: 500 })],
        duration: 1500,
      },
      {
        id: 'straw_sweep',
        name: 'Straw Sweep',
        desc: 'UNPARRYABLE — a red, spiked cue. Only a dodge will do.',
        target: 'single', approach: 'melee', weight: 2, cooldown: 1,
        hits: [hit(1100, 'unparryable', 1.0, 'spin', { windup: 600 })],
        duration: 1600,
      },
      {
        id: 'totter_stomp',
        name: 'Totter Stomp',
        desc: 'JUMP — a gold wave along the ground. Jump over it.',
        target: 'single', approach: 'stay', weight: 2, cooldown: 1,
        hits: [hit(1000, 'jump', 1.0, 'wave', { windup: 600 })],
        duration: 1600,
      },
      {
        id: 'painted_prism',
        name: 'Painted Prism',
        desc: 'PRISM — a violet prism and a grey world. Answer it with a Prism Counter for a riposte.',
        target: 'single', approach: 'stay', weight: 2, cooldown: 1,
        hits: [hit(1300, 'gradient', 1.0, 'beam', { windup: 900 })],
        duration: 1900,
      },
      {
        id: 'fake_out',
        name: 'Fake-Out',
        desc: 'FEINT — the first swing is a bluff. Wait for the real one.',
        target: 'single', approach: 'melee', weight: 2, cooldown: 1,
        hits: [
          feint(950, 'slash', { windup: 450 }),
          hit(1600, 'normal', 1.0, 'slash', { windup: 450 }),
        ],
        duration: 2100,
      },
      {
        id: 'mannequin_medley',
        name: 'Mannequin Medley',
        desc: 'Everything at once, slowly: cut, bluff, thrust, wave, prism.',
        target: 'single', approach: 'melee', weight: 1, cooldown: 2,
        hits: [
          hit(950, 'normal', 0.5, 'slash', { windup: 450 }),
          feint(1500, 'slash', { windup: 400 }),
          hit(2100, 'normal', 0.5, 'thrust', { windup: 450 }),
          hit(2750, 'jump', 0.5, 'wave', { windup: 500 }),
          hit(3550, 'gradient', 0.5, 'nova', { windup: 750 }),
        ],
        duration: 4050,
      },
    ]),
    pool: ['wobbling_poke', 'straw_sweep', 'totter_stomp', 'painted_prism', 'fake_out', 'mannequin_medley'],
    bio: 'Straw, canvas and a painted target, patched after every expedition. It has been knocked down by sixty-eight '
      + 'crews and stood back up every time. It would like you to know it is proud of you.',
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------------------------------------------

/**
 * Enemy definition by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getEnemy(id) {
  return Object.prototype.hasOwnProperty.call(ENEMIES, id) ? ENEMIES[id] : null;
}

/**
 * Attack definition of an enemy.
 * @param {string} enemyId @param {string} attackId
 * @returns {Object|null}
 */
export function getAttack(enemyId, attackId) {
  const e = getEnemy(enemyId);
  return e && Object.prototype.hasOwnProperty.call(e.attacks, attackId) ? e.attacks[attackId] : null;
}

/**
 * The phase an enemy is in at a given HP fraction: index 0 = base pool, n = phases[n − 1].
 * Phases are entered in order and never left (the deepest phase whose hpBelow exceeds the fraction wins).
 * @param {Object} enemy   ENEMIES entry
 * @param {number} hpFrac  current hp / maxHp (0..1)
 * @returns {{ phaseIndex:number, pool:string[], statMult:{spd:number, atk:number} }}
 */
export function phaseAt(enemy, hpFrac) {
  let phaseIndex = 0;
  let pool = enemy.pool;
  let statMult = { spd: 1, atk: 1 };
  (enemy.phases || []).forEach((ph, i) => {
    if (hpFrac < ph.hpBelow) {
      phaseIndex = i + 1;
      pool = ph.pool;
      statMult = { spd: ph.statMult?.spd ?? 1, atk: ph.statMult?.atk ?? 1 };
    }
  });
  return { phaseIndex, pool, statMult };
}

/**
 * Damaging hits of an attack (feints excluded).
 * @param {Object} attack
 * @returns {EnemyHit[]}
 */
export function damagingHits(attack) {
  return attack.hits.filter((h) => h.type !== 'feint');
}
