// Consumable items and their max-charge upgrades (SPEC §3.5). Charges refill whenever the party rests at
// an Expedition Flag. Pure data.

/**
 * @typedef {Object} ItemDef
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {'ally'|'deadAlly'} target
 * @property {Array<Object>} effects     Closed Effect set (§4.8).
 * @property {number} baseMax            Starting maximum charges.
 * @property {boolean} fieldUse          Usable from the pause menu (outside battle).
 */

/** @type {Record<'tincture'|'tonic'|'draught', ItemDef>} */
export const ITEMS = {
  tincture: {
    id: 'tincture',
    name: 'Amber Tincture',
    desc: 'Honey-thick amber distilled from sunlit resin, bottled before the Sun stopped. Heals one ally for 45% of their max HP. Usable in battle (ends the turn) or from the pause menu.',
    target: 'ally',
    effects: [{ type: 'heal', pct: 0.45, target: 'target' }],
    baseMax: 4,
    fieldUse: true,
  },
  tonic: {
    id: 'tonic',
    name: 'Rousing Tonic',
    desc: 'Smelling salts, strong coffee and something the apothecary refuses to name. Revives a KO\'d ally with 50% of their max HP. Ends the turn.',
    target: 'deadAlly',
    effects: [{ type: 'revive', pct: 0.5, target: 'target' }],
    baseMax: 2,
    fieldUse: true,
  },
  draught: {
    id: 'draught',
    name: 'Clockspring Draught',
    desc: 'A fizzing brass-coloured draught that makes the heart tick a little faster. Grants one ally +3 AP. Battle only; ends the turn.',
    target: 'ally',
    effects: [{ type: 'ap', amount: 3, target: 'target' }],
    baseMax: 2,
    fieldUse: false,
  },
};

/** Fixed display order of consumables. */
export const ITEM_ORDER = ['tincture', 'tonic', 'draught'];

/**
 * Shards raise an item's maximum charges by 1 (and grant that charge immediately).
 * @type {Record<string, {id:string, item:string, name:string, desc:string}>}
 */
export const UPGRADES = {
  tincture_shard: {
    id: 'tincture_shard',
    item: 'tincture',
    name: 'Amber Shard',
    desc: 'A crystallised drop of the old sunlight. Permanently raises Amber Tincture charges by 1.',
  },
  tonic_shard: {
    id: 'tonic_shard',
    item: 'tonic',
    name: 'Rousing Shard',
    desc: 'A sliver of salt-crystal that crackles when held to the ear. Permanently raises Rousing Tonic charges by 1.',
  },
  draught_shard: {
    id: 'draught_shard',
    item: 'draught',
    name: 'Clockspring Shard',
    desc: 'A tiny wound spring that never runs down. Permanently raises Clockspring Draught charges by 1.',
  },
};
