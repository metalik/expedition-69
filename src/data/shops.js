// Merchant stock for Expedition 69's three camps (SPEC §3.5). Prices escalate with each zone to track the
// expected Glint income (~30–80 per regular Shore battle, roughly doubling in each later zone): a typical run
// (each zone cleared ≈1.3×, plus its chests) affords about half of a camp's stock. Relics that a boss drops for
// certain are not sold before that boss. Pure data.
//
// Stock entry: { kind:'relic'|'shard', id, price, limit? }
//   relic → each relic can be owned once; the entry shows as owned afterwards.
//   shard → may be bought `limit` times from this entry (default 1).

/**
 * @typedef {Object} ShopEntry
 * @property {'relic'|'shard'} kind
 * @property {string} id       Relic id or upgrade (shard) id.
 * @property {number} price    Glint.
 * @property {number} [limit]  Purchases allowed from this entry (shards; default 1).
 */

/** @type {Record<string, {id:string, name:string, keeper:string, zone:string, blurb:string, stock:ShopEntry[]}>} */
export const SHOPS = {
  shore_camp: {
    id: 'shore_camp',
    name: 'Brinegate Driftmarket',
    keeper: 'Pellam Quist',
    zone: 'shore',
    blurb: 'Salvage from sixty-eight expeditions, laid out on a sail-cloth under the frozen dusk.',
    stock: [
      { kind: 'relic', id: 'marksmans_eye', price: 190 },
      { kind: 'relic', id: 'tidal_charm', price: 210 },
      { kind: 'relic', id: 'ember_edge', price: 230 },
      { kind: 'relic', id: 'stillwater_pearl', price: 260 },
      { kind: 'relic', id: 'last_light', price: 290 },
      { kind: 'shard', id: 'tincture_shard', price: 240, limit: 1 },
      { kind: 'shard', id: 'tonic_shard', price: 310, limit: 1 },
    ],
  },
  thicket_camp: {
    id: 'thicket_camp',
    name: 'The Gilded Caravan',
    keeper: 'Madame Orrery',
    zone: 'thicket',
    blurb: 'A painted wagon wedged between golden trunks; its owner insists she has always been here.',
    stock: [
      { kind: 'relic', id: 'frost_edge', price: 290 },
      { kind: 'relic', id: 'hunters_mark', price: 310 },
      { kind: 'relic', id: 'dawn_locket', price: 580 },
      { kind: 'relic', id: 'cinder_seal', price: 470 },
      { kind: 'relic', id: 'feather_step', price: 520 },
      { kind: 'relic', id: 'second_wind', price: 460 },
      { kind: 'relic', id: 'verdant_brooch', price: 620 },
      { kind: 'shard', id: 'tincture_shard', price: 470, limit: 1 },
      { kind: 'shard', id: 'draught_shard', price: 550, limit: 1 },
    ],
  },
  spire_camp: {
    id: 'spire_camp',
    name: 'The Last Stall',
    keeper: 'The Horologist',
    zone: 'spire',
    blurb: 'A clockmaker\'s bench on a gear-tooth ledge. Every price is paid in Glint and a little time.',
    stock: [
      { kind: 'relic', id: 'storm_seal', price: 490 },
      { kind: 'relic', id: 'rime_seal', price: 490 },
      { kind: 'relic', id: 'executioners_coin', price: 500 },
      { kind: 'relic', id: 'keen_whetstone', price: 620 },
      { kind: 'relic', id: 'duelists_ribbon', price: 700 },
      { kind: 'relic', id: 'metronome', price: 1000 },
      { kind: 'relic', id: 'glass_rose', price: 1150 },
      { kind: 'shard', id: 'tincture_shard', price: 780, limit: 1 },
      { kind: 'shard', id: 'tonic_shard', price: 830, limit: 1 },
      { kind: 'shard', id: 'draught_shard', price: 900, limit: 1 },
    ],
  },
};
