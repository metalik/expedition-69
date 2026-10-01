// Relics of Expedition 69: the 30 fixed relic ids of SPEC §3.4 with flat stats, one passive each, echo cost,
// rarity and shop price. Pure data plus text helpers for tooltips (no DOM).

/**
 * @typedef {Object} RelicDef
 * @property {string} id
 * @property {string} name
 * @property {string} desc                      Flavour + precise effect text.
 * @property {{hp?:number, atk?:number, def?:number, spd?:number, crit?:number}} stats   Flat bonuses while equipped.
 * @property {{id:string, params:Object}} passive                                       Closed passive list (§3.4).
 * @property {1|2|3|4|5} echoCost               Echo capacity cost once mastered.
 * @property {'common'|'rare'|'legendary'} rarity
 * @property {number} price                     Base shop price in Glint.
 */

/** Relics owned and equipped at the start of a new game (character id → relic id). */
export const STARTING_RELICS = {
  gideon: 'riposte_pin',
  nyra: 'mending_quill',
  sable: 'opening_gambit',
};

/** Victories with a relic equipped required to master it into an Echo. */
export const MASTERY_BATTLES = 4;

/** Glint granted when a duplicate relic is found, by rarity. */
export const DUPE_GLINT = { common: 45, rare: 90, legendary: 180 };

/** Display labels for rarities. */
export const RARITY_LABELS = { common: 'Common', rare: 'Rare', legendary: 'Legendary' };

/** @type {Record<string, RelicDef>} */
export const RELICS = {
  dawn_locket: {
    id: 'dawn_locket',
    name: 'Dawn Locket',
    desc: 'A locket holding a pressed sliver of the last true sunrise. Its bearer always wakes first. Begin every battle with +1 AP.',
    stats: { spd: 2, hp: 20 },
    passive: { id: 'startAp', params: { amount: 1 } },
    echoCost: 4,
    rarity: 'rare',
    price: 460,
  },
  riposte_pin: {
    id: 'riposte_pin',
    name: 'Riposte Pin',
    desc: 'The brass collar-pin of the Brinegate harbour watch, awarded for holding the sea-wall. Counterattacks deal ×1.5 damage.',
    stats: { atk: 2, def: 2 },
    passive: { id: 'counterPower', params: { mult: 1.5 } },
    echoCost: 2,
    rarity: 'common',
    price: 140,
  },
  tidal_charm: {
    id: 'tidal_charm',
    name: 'Tidal Charm',
    desc: 'A knot of sea-glass that pulls a little back from every wave that breaks on it. Each parry heals the bearer for 4% of max HP.',
    stats: { hp: 40 },
    passive: { id: 'parryHeal', params: { pct: 0.04 } },
    echoCost: 2,
    rarity: 'common',
    price: 160,
  },
  duelists_ribbon: {
    id: 'duelists_ribbon',
    name: "Duellist's Ribbon",
    desc: 'A crimson ribbon from the Duellists\' Gallery, tied only to those who never flinch. Each parry grants +1 extra AP.',
    stats: { spd: 3, crit: 0.02 },
    passive: { id: 'parryAp', params: { amount: 1 } },
    echoCost: 4,
    rarity: 'rare',
    price: 480,
  },
  feather_step: {
    id: 'feather_step',
    name: 'Feather Step',
    desc: 'A gull feather stitched into a boot lining; the wearer moves as if the air owed them a favour. A perfect dodge grants +1 AP.',
    stats: { spd: 4 },
    passive: { id: 'perfectDodgeAp', params: { amount: 1 } },
    echoCost: 3,
    rarity: 'rare',
    price: 360,
  },
  ember_edge: {
    id: 'ember_edge',
    name: 'Ember Edge',
    desc: 'A whetstone of banked coal that leaves any blade faintly smoking. Basic attacks have a 50% chance to Burn the target for 2 turns.',
    stats: { atk: 3 },
    passive: { id: 'basicStatus', params: { status: 'burn', turns: 2, chance: 0.5 } },
    echoCost: 2,
    rarity: 'common',
    price: 180,
  },
  frost_edge: {
    id: 'frost_edge',
    name: 'Frost Edge',
    desc: 'Rime that never melts, scraped from the hull of a ship stuck in the frozen hour. Basic attacks have a 50% chance to Chill the target for 2 turns.',
    stats: { atk: 2, spd: 1 },
    passive: { id: 'basicStatus', params: { status: 'chill', turns: 2, chance: 0.5 } },
    echoCost: 2,
    rarity: 'common',
    price: 180,
  },
  last_light: {
    id: 'last_light',
    name: 'Last Light',
    desc: 'A lantern wick that burns brightest as the oil runs out. While below 35% HP, the bearer deals ×1.35 damage.',
    stats: { atk: 4 },
    passive: { id: 'lowHpPower', params: { threshold: 0.35, mult: 1.35 } },
    echoCost: 2,
    rarity: 'common',
    price: 220,
  },
  second_wind: {
    id: 'second_wind',
    name: 'Second Wind',
    desc: 'A drowned sailor\'s whistle. Blow it once and the sea gives you back. Once per battle, a lethal hit leaves the bearer at 1 HP instead.',
    stats: { hp: 60 },
    passive: { id: 'secondWind', params: {} },
    echoCost: 3,
    rarity: 'rare',
    price: 420,
  },
  verdant_brooch: {
    id: 'verdant_brooch',
    name: 'Verdant Brooch',
    desc: 'A gilded leaf from the Thicket that still remembers spring. Heals the bearer for 5% of max HP at the start of each of their turns.',
    stats: { hp: 30, def: 2 },
    passive: { id: 'turnHeal', params: { pct: 0.05 } },
    echoCost: 4,
    rarity: 'rare',
    price: 520,
  },
  shatterglass: {
    id: 'shatterglass',
    name: 'Shatterglass',
    desc: 'A monocle cracked in a pattern that shows exactly where things break. +35% crit chance against Broken or Defenceless targets.',
    stats: { crit: 0.03 },
    passive: { id: 'critVsBroken', params: { bonus: 0.35 } },
    echoCost: 2,
    rarity: 'rare',
    price: 340,
  },
  keen_whetstone: {
    id: 'keen_whetstone',
    name: 'Keen Whetstone',
    desc: 'Quarried from the Spire\'s foundations; it sharpens edges and grudges alike. Critical hits deal ×1.8 damage instead of ×1.5.',
    stats: { atk: 2, crit: 0.04 },
    passive: { id: 'critDamage', params: { bonus: 0.3 } },
    echoCost: 3,
    rarity: 'rare',
    price: 420,
  },
  anvil_heart: {
    id: 'anvil_heart',
    name: 'Anvil Heart',
    desc: 'A blacksmith\'s charm of dense iron that thuds like a second heartbeat. Break damage dealt ×1.4.',
    stats: { def: 3, hp: 30 },
    passive: { id: 'breakPower', params: { mult: 1.4 } },
    echoCost: 3,
    rarity: 'rare',
    price: 360,
  },
  marksmans_eye: {
    id: 'marksmans_eye',
    name: "Marksman's Eye",
    desc: 'A brass sighting-glass from a lighthouse gun. Free Aim shots deal ×1.5 damage.',
    stats: { crit: 0.02 },
    passive: { id: 'shotPower', params: { mult: 1.5 } },
    echoCost: 1,
    rarity: 'common',
    price: 150,
  },
  hunters_mark: {
    id: 'hunters_mark',
    name: "Hunter's Mark",
    desc: 'A chalk-stick for tallying quarry, worn to a nub. Free Aim shots have a 60% chance to Mark the target (next damaging hit ×1.5).',
    stats: { spd: 2 },
    passive: { id: 'shotMark', params: { chance: 0.6 } },
    echoCost: 2,
    rarity: 'common',
    price: 200,
  },
  opening_gambit: {
    id: 'opening_gambit',
    name: 'Opening Gambit',
    desc: 'A chess knight carved from a duelling-pistol grip. The bearer\'s first damaging hit of each battle deals ×1.6.',
    stats: { atk: 2, spd: 2 },
    passive: { id: 'firstStrike', params: { mult: 1.6 } },
    echoCost: 2,
    rarity: 'common',
    price: 150,
  },
  prism_shard: {
    id: 'prism_shard',
    name: 'Prism Shard',
    desc: 'A splinter of the Clockwork Sun\'s lens that splits the dusk into every colour at once. The bearer\'s actions fill the Prism gauge ×1.3.',
    stats: { hp: 30, spd: 2 },
    passive: { id: 'gradientGain', params: { mult: 1.3 } },
    echoCost: 5,
    rarity: 'legendary',
    price: 760,
  },
  glass_rose: {
    id: 'glass_rose',
    name: 'Glass Rose',
    desc: 'Beautiful, sharp, and one hard knock from ruin — like its owners tend to be. The bearer deals ×1.3 damage but also takes ×1.3 damage.',
    stats: { atk: 6, crit: 0.05 },
    passive: { id: 'glassCannon', params: { dealt: 1.3, taken: 1.3 } },
    echoCost: 5,
    rarity: 'legendary',
    price: 820,
  },
  cinder_seal: {
    id: 'cinder_seal',
    name: 'Cinder Seal',
    desc: 'A wax seal that never quite stops smouldering. Fire damage dealt ×1.3.',
    stats: { atk: 3 },
    passive: { id: 'elementPower', params: { element: 'fire', mult: 1.3 } },
    echoCost: 3,
    rarity: 'rare',
    price: 320,
  },
  storm_seal: {
    id: 'storm_seal',
    name: 'Storm Seal',
    desc: 'A seal pressed during a thunderstorm; your hair stands up when you hold it. Lightning damage dealt ×1.3.',
    stats: { atk: 3 },
    passive: { id: 'elementPower', params: { element: 'lightning', mult: 1.3 } },
    echoCost: 3,
    rarity: 'rare',
    price: 320,
  },
  rime_seal: {
    id: 'rime_seal',
    name: 'Rime Seal',
    desc: 'A seal of blue wax, cold enough to fog the breath. Ice damage dealt ×1.3.',
    stats: { atk: 3 },
    passive: { id: 'elementPower', params: { element: 'ice', mult: 1.3 } },
    echoCost: 3,
    rarity: 'rare',
    price: 320,
  },
  sun_fragment: {
    id: 'sun_fragment',
    name: 'Sun Fragment',
    desc: 'A warm brass cog that fell from the Clockwork Sun sixty-eight years ago and has never cooled. Light damage dealt ×1.3.',
    stats: { atk: 3, hp: 30 },
    passive: { id: 'elementPower', params: { element: 'light', mult: 1.3 } },
    echoCost: 3,
    rarity: 'rare',
    price: 380,
  },
  executioners_coin: {
    id: 'executioners_coin',
    name: "Executioner's Coin",
    desc: 'Old Veyran custom: the headsman is paid in advance, and always in gold. Landing a killing blow grants +2 AP.',
    stats: { crit: 0.03, atk: 4 },
    passive: { id: 'killAp', params: { amount: 2 } },
    echoCost: 2,
    rarity: 'rare',
    price: 360,
  },
  warding_bell: {
    id: 'warding_bell',
    name: 'Warding Bell',
    desc: 'A tiny bronze bell that rings before the blow does. The bearer cannot be Stunned.',
    stats: { def: 5, hp: 40 },
    passive: { id: 'statusImmune', params: { status: 'stun' } },
    echoCost: 1,
    rarity: 'common',
    price: 240,
  },
  stillwater_pearl: {
    id: 'stillwater_pearl',
    name: 'Stillwater Pearl',
    desc: 'A pearl grown in water that time forgot to move. Nothing can slow what is already still. The bearer cannot be Slowed.',
    stats: { def: 2, spd: 2 },
    passive: { id: 'statusImmune', params: { status: 'slow' } },
    echoCost: 1,
    rarity: 'common',
    price: 200,
  },
  metronome: {
    id: 'metronome',
    name: 'Metronome',
    desc: 'A pocket metronome that still keeps the tempo of the moving Sun. The perfect-QTE damage bonus is ×1.15 stronger (×1.61 instead of ×1.4).',
    stats: { spd: 3, crit: 0.02 },
    passive: { id: 'perfectPower', params: { mult: 1.15 } },
    echoCost: 4,
    rarity: 'legendary',
    price: 720,
  },
  aegis_thread: {
    id: 'aegis_thread',
    name: 'Aegis Thread',
    desc: 'Silver thread spun by the Lyceum\'s wardens and sewn into a collar. Begin every battle with Shell (damage taken ×0.7) for 3 turns.',
    stats: { def: 3, hp: 40 },
    passive: { id: 'startStatus', params: { status: 'shell', turns: 3 } },
    echoCost: 3,
    rarity: 'rare',
    price: 380,
  },
  quickened_gear: {
    id: 'quickened_gear',
    name: 'Quickened Gear',
    desc: 'A gear from the Spire\'s escapement that still ticks, faster than it should. Begin every battle with Haste (speed ×1.3) for 3 turns.',
    stats: { spd: 3 },
    passive: { id: 'startStatus', params: { status: 'haste', turns: 3 } },
    echoCost: 4,
    rarity: 'legendary',
    price: 740,
  },
  thorn_wreath: {
    id: 'thorn_wreath',
    name: 'Thorn Wreath',
    desc: 'A crown of gilded thorns from the Bloomwitch\'s garden; it bites, and the bite wakes you up. Gain +1 AP when taking damage (at most once per enemy action).',
    stats: { hp: 40, def: 1 },
    passive: { id: 'hurtAp', params: { amount: 1 } },
    echoCost: 3,
    rarity: 'rare',
    price: 360,
  },
  mending_quill: {
    id: 'mending_quill',
    name: 'Mending Quill',
    desc: 'A Lyceum quill that writes stitches instead of words. Heals performed by the bearer are ×1.35 stronger.',
    stats: { hp: 30, atk: 1 },
    passive: { id: 'healPower', params: { mult: 1.35 } },
    echoCost: 2,
    rarity: 'common',
    price: 150,
  },
};

const STAT_LABELS = { hp: 'HP', atk: 'ATK', def: 'DEF', spd: 'SPD', crit: 'CRIT' };
const STAT_ORDER = ['hp', 'atk', 'def', 'spd', 'crit'];

const STATUS_NAMES = {
  burn: 'Burn', chill: 'Chill', mark: 'Mark', powerful: 'Powerful', shell: 'Shell', haste: 'Haste',
  slow: 'Slow', weakened: 'Weakened', defenseless: 'Defenceless', stun: 'Stun', regen: 'Regen', silence: 'Silence',
};

const ELEMENT_NAMES = {
  physical: 'Physical', fire: 'Fire', ice: 'Ice', lightning: 'Lightning', earth: 'Earth', light: 'Light', dark: 'Dark',
};

const pct = (x) => `${Math.round(x * 100)}%`;
const statusName = (id) => STATUS_NAMES[id] ?? String(id);

/**
 * Formats a flat stat bonus block, e.g. "+40 HP · +2 DEF · +3% CRIT".
 * @param {Object} stats
 * @returns {string}
 */
export function formatStats(stats) {
  if (!stats) return '';
  const parts = [];
  for (const k of STAT_ORDER) {
    const v = stats[k];
    if (!v) continue;
    const sign = v > 0 ? '+' : '−';
    parts.push(k === 'crit' ? `${sign}${Math.round(Math.abs(v) * 100)}% ${STAT_LABELS[k]}` : `${sign}${Math.abs(v)} ${STAT_LABELS[k]}`);
  }
  return parts.join(' · ');
}

/**
 * Short, precise rules text for a passive from the closed list (§3.4).
 * @param {{id:string, params?:Object}} passive
 * @returns {string}
 */
export function passiveText(passive) {
  if (!passive) return '';
  const p = passive.params ?? {};
  switch (passive.id) {
    case 'startAp': return `Begin each battle with +${p.amount} AP.`;
    case 'parryAp': return `Each parry grants +${p.amount} extra AP.`;
    case 'parryHeal': return `Each parry heals ${pct(p.pct)} of max HP.`;
    case 'perfectDodgeAp': return `A perfect dodge grants +${p.amount} AP.`;
    case 'counterPower': return `Counterattacks deal ×${p.mult} damage.`;
    case 'basicStatus': return `Basic attacks have a ${pct(p.chance ?? 1)} chance to inflict ${statusName(p.status)} (${p.turns} turns).`;
    case 'lowHpPower': return `Deal ×${p.mult} damage while below ${pct(p.threshold)} HP.`;
    case 'secondWind': return 'Once per battle, survive a lethal hit with 1 HP.';
    case 'turnHeal': return `Heal ${pct(p.pct)} of max HP at the start of each turn.`;
    case 'critVsBroken': return `+${pct(p.bonus)} crit chance against Broken or Defenceless targets.`;
    case 'critDamage': return `Critical multiplier +${p.bonus} (×${(1.5 + p.bonus).toFixed(1)} instead of ×1.5).`;
    case 'breakPower': return `Break dealt ×${p.mult}.`;
    case 'shotPower': return `Free Aim shots deal ×${p.mult} damage.`;
    case 'shotMark': return `Free Aim shots have a ${pct(p.chance)} chance to Mark.`;
    case 'firstStrike': return `The first damaging hit of each battle deals ×${p.mult}.`;
    case 'gradientGain': return `Prism gauge gains from this character's actions ×${p.mult}.`;
    case 'glassCannon': return `Damage dealt ×${p.dealt}, damage taken ×${p.taken}.`;
    case 'elementPower': return `${ELEMENT_NAMES[p.element] ?? p.element} damage dealt ×${p.mult}.`;
    case 'killAp': return `Landing a killing blow grants +${p.amount} AP.`;
    case 'statusImmune': return `Immune to ${statusName(p.status)}.`;
    case 'perfectPower': return `Perfect-QTE damage bonus ×${p.mult}.`;
    case 'startStatus': return `Begin each battle with ${statusName(p.status)} (${p.turns} turns).`;
    case 'hurtAp': return `Gain +${p.amount} AP when taking damage (once per enemy action).`;
    case 'healPower': return `Heals performed ×${p.mult}.`;
    default: return passive.id;
  }
}

/** Alphabetical list of relic ids (stable ordering for menus). */
export function relicIdsSorted() {
  return Object.keys(RELICS).sort((a, b) => RELICS[a].name.localeCompare(RELICS[b].name));
}
