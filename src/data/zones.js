// Zone table for Expedition 69: display names, level bands, music and battle backgrounds for every
// explorable zone (plus the training yard), the zone objective shown in the exploration HUD (full and compact
// wording) and what it points at (the compass and the minimap marker).
// Pure data (imports story text only); safe to import from Node tests.

import { STORY } from './story.js';

const title = (id, fallback) => STORY?.zoneTitles?.[id] ?? fallback;
const subtitle = (id) => STORY?.zoneSubtitles?.[id] ?? '';

/**
 * @typedef {Object} Zone
 * @property {string} id
 * @property {string} name          Display name (STORY.zoneTitles).
 * @property {string} subtitle      Arrival banner subtitle (STORY.zoneSubtitles, '' if absent).
 * @property {[number, number]} levelRange   Expected party level band.
 * @property {'shore'|'thicket'|'spire'|'summit'|'training'} music   Exploration track (audio TRACKS id).
 * @property {'shore'|'thicket'|'spire'|'summit'|'training'} battleBg  Battle background id.
 * @property {number} order         Journey order (training = -1).
 * @property {string|null} next     Zone reached through this zone's forward exit.
 * @property {string|null} prev     Zone reached through this zone's return exit.
 * @property {string|null} boss     Boss enemy id guarding the forward exit (or the finale).
 */

/** @type {Record<string, Zone>} */
export const ZONES = {
  shore: {
    id: 'shore',
    name: title('shore', 'Brinegate Shore'),
    subtitle: subtitle('shore'),
    levelRange: [1, 5],
    music: 'shore',
    battleBg: 'shore',
    order: 0,
    next: 'thicket',
    prev: null,
    boss: 'wreck_warden',
  },
  thicket: {
    id: 'thicket',
    name: title('thicket', 'The Gilded Thicket'),
    subtitle: subtitle('thicket'),
    levelRange: [5, 10],
    music: 'thicket',
    battleBg: 'thicket',
    order: 1,
    next: 'spire',
    prev: 'shore',
    boss: 'bellwether',
  },
  spire: {
    id: 'spire',
    name: title('spire', 'The Meridian Spire'),
    subtitle: subtitle('spire'),
    levelRange: [10, 15],
    music: 'spire',
    battleBg: 'spire',
    order: 2,
    next: 'summit',
    prev: 'thicket',
    boss: null,
  },
  summit: {
    id: 'summit',
    name: title('summit', 'The Summit'),
    subtitle: subtitle('summit'),
    levelRange: [15, 16],
    music: 'summit',
    battleBg: 'summit',
    order: 3,
    next: null,
    prev: 'spire',
    boss: 'stillkeeper',
  },
  training: {
    id: 'training',
    name: title('training', 'The Practice Yard'),
    subtitle: subtitle('training'),
    levelRange: [1, 20],
    music: 'training',
    battleBg: 'training',
    order: -1,
    next: null,
    prev: null,
    boss: null,
  },
};

/** Explorable zones in journey order. */
export const ZONE_ORDER = ['shore', 'thicket', 'spire', 'summit'];

/**
 * Zone by id (null when unknown).
 * @param {string} id
 * @returns {Zone|null}
 */
export function getZone(id) {
  return typeof id === 'string' && Object.hasOwn(ZONES, id) ? ZONES[id] : null;
}

/**
 * One-line objective for the exploration HUD, derived from story progress.
 * @param {string} zoneId
 * @param {{world?:{bosses?:Object}}|null} state GameState (may be null)
 * @param {{short?:boolean}} [o] short = the compact pill wording (a few words)
 * @returns {string}
 */
export function zoneObjective(zoneId, state, { short = false } = {}) {
  const bosses = state?.world?.bosses ?? {};
  switch (zoneId) {
    case 'shore':
      if (bosses.wreck_warden) return short ? 'East, into the Gilded Thicket' : 'The wreck line is clear — the Gilded Thicket lies east.';
      return short ? 'The wreck line, to the east' : 'Cross the shore. Something vast keeps watch over the wreck line to the east.';
    case 'thicket':
      if (bosses.bellwether) return short ? 'North-east, to the Meridian Spire' : 'The bell is silent — climb north-east to the Meridian Spire.';
      return short ? 'The tolling bell, north-east' : 'Follow the golden paths north-east. A bell tolls twenty to seven.';
    case 'spire':
      return short ? 'Up the terraces to the Summit' : 'Climb the brass terraces to the Summit.';
    case 'summit':
      if (bosses.stillkeeper) return 'The great hand moves.';
      return short ? 'The Stillkeeper, beneath the Sun' : 'Face the Stillkeeper beneath the frozen Sun.';
    default:
      return '';
  }
}

/**
 * What the objective points at, for the HUD compass and the minimap marker: the zone's guardian while it stands,
 * then the exit onward (null once the journey's end is reached).
 * @param {string} zoneId
 * @param {{world?:{bosses?:Object}}|null} state
 * @returns {{boss:string}|{exitTo:string}|null}
 */
export function objectiveTarget(zoneId, state) {
  const z = getZone(zoneId);
  if (!z || z.order < 0) return null;
  const bosses = state?.world?.bosses ?? {};
  if (z.boss && !bosses[z.boss]) return { boss: z.boss };
  return z.next ? { exitTo: z.next } : null;
}
