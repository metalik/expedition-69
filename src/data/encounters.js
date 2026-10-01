// Battle encounter table for Expedition 69: which enemies fight together, where, and to what music.
// Pure data. Map spawns reference these ids; `?battle=` debug jumps and the training yard use them too.

/**
 * @typedef {Object} Encounter
 * @property {string} id              Same as its key.
 * @property {string} name            Short display/debug label.
 * @property {string[]} enemies       1–3 enemy ids from ENEMIES (slot order e0, e1, e2).
 * @property {'shore'|'thicket'|'spire'|'summit'|'training'} zone   Also selects the battle background.
 * @property {boolean} [boss]         Boss battle (no flee, boss music, boss slot layout).
 * @property {boolean} [tutorial]     The scripted first battle (hints shown, no flee).
 * @property {'battle'|'boss'|'final'|'training'} music   Track from the audio TRACKS list.
 */

/** @param {string} id @param {string} name @param {string[]} enemies @param {string} zone @param {Object} [extra] */
function enc(id, name, enemies, zone, extra = {}) {
  return { id, name, enemies, zone, music: 'battle', ...extra };
}

/** @type {Record<string, Encounter>} */
export const ENCOUNTERS = Object.fromEntries([
  // --- Brinegate Shore: normal hits, then shields, then the first jump waves -------------------------------------
  enc('tutorial_driftling', 'A Lone Driftling', ['driftling'], 'shore', { tutorial: true }),
  enc('shore_driftling_pair', 'Drifting Lanterns', ['driftling', 'driftling'], 'shore'),
  enc('shore_shellguard', 'The Shell Knight', ['shellguard'], 'shore'),
  enc('shore_shell_and_drift', 'Shell and Lantern', ['shellguard', 'driftling'], 'shore'),
  enc('shore_tidecaller', 'Tidecaller\'s Vigil', ['tidecaller', 'driftling'], 'shore'),
  enc('shore_driftling_school', 'A School of Lanterns', ['driftling', 'driftling', 'driftling'], 'shore'),
  enc('shore_tide_and_shell', 'Coral Chapel', ['tidecaller', 'shellguard'], 'shore'),
  enc('shore_wreckline', 'The Wreck Line', ['shellguard', 'tidecaller', 'driftling'], 'shore'),
  enc('boss_wreck_warden', 'The Wreck Warden', ['wreck_warden'], 'shore', { boss: true, music: 'boss' }),

  // --- The Gilded Thicket: unparryable charges, feints, delays, AoE and healers -----------------------------------
  enc('thicket_thornstag', 'Gilt and Thorn', ['thornstag'], 'thicket'),
  enc('thicket_mime', 'A Silent Performance', ['mime'], 'thicket'),
  enc('thicket_stag_and_mime', 'Hunt and Harlequin', ['thornstag', 'mime'], 'thicket'),
  enc('thicket_bloomwitch', 'The Rose Keeper', ['bloomwitch', 'thornstag'], 'thicket'),
  enc('thicket_masquerade', 'Masquerade', ['mime', 'mime'], 'thicket'),
  enc('thicket_rose_court', 'The Rose Court', ['bloomwitch', 'mime'], 'thicket'),
  enc('thicket_gilded_hunt', 'The Gilded Hunt', ['thornstag', 'thornstag', 'bloomwitch'], 'thicket'),
  enc('boss_bellwether', 'The Bellwether', ['bellwether'], 'thicket', { boss: true, music: 'boss' }),

  // --- The Meridian Spire: rapid bursts, pendulum delays, shields, gradient strikes --------------------------------
  enc('spire_sentinel', 'Stair Guard', ['sentinel'], 'spire'),
  enc('spire_coghound_pair', 'Clockwork Hounds', ['coghound', 'coghound'], 'spire'),
  enc('spire_hourwraith', 'Lost Hour', ['hourwraith', 'coghound'], 'spire'),
  enc('spire_stair_watch', 'The Stair Watch', ['sentinel', 'coghound'], 'spire'),
  enc('spire_lost_hours', 'Lost Hours', ['hourwraith', 'hourwraith'], 'spire'),
  enc('spire_gallery', 'Porcelain Gallery', ['sentinel', 'hourwraith'], 'spire'),
  enc('spire_clockwork_pack', 'The Pack Unwinds', ['coghound', 'coghound', 'coghound'], 'spire'),

  // --- The Summit: the last guard of the Stillkeeper's dial --------------------------------------------------------
  enc('summit_honor_guard', 'Honour Guard', ['sentinel', 'sentinel'], 'summit'),
  enc('summit_vigil', 'The Long Vigil', ['sentinel', 'hourwraith'], 'summit'),
  enc('summit_hour_court', 'Court of Hours', ['hourwraith', 'coghound', 'hourwraith'], 'summit'),
  enc('summit_last_pack', 'The Last Pack', ['coghound', 'hourwraith', 'coghound'], 'summit'),
  enc('summit_last_watch', 'The Last Watch', ['sentinel', 'hourwraith', 'coghound'], 'summit'),
  enc('boss_stillkeeper', 'The Stillkeeper', ['stillkeeper'], 'summit', { boss: true, music: 'final' }),

  // --- Training yard ------------------------------------------------------------------------------------------------
  enc('training_dummy', 'Practice Bout', ['dummy'], 'training', { music: 'training' }),
].map((e) => [e.id, e]));

/** Encounter id of each boss enemy. */
export const BOSS_ENCOUNTERS = {
  wreck_warden: 'boss_wreck_warden',
  bellwether: 'boss_bellwether',
  stillkeeper: 'boss_stillkeeper',
};

/**
 * Encounter by id.
 * @param {string} id
 * @returns {Encounter|null}
 */
export function getEncounter(id) {
  return Object.prototype.hasOwnProperty.call(ENCOUNTERS, id) ? ENCOUNTERS[id] : null;
}

/**
 * Encounters of a zone, in authoring order (which is also rising difficulty).
 * @param {string} zone
 * @param {{ includeBoss?:boolean, includeTutorial?:boolean }} [opts]
 * @returns {Encounter[]}
 */
export function encountersInZone(zone, { includeBoss = false, includeTutorial = false } = {}) {
  return Object.values(ENCOUNTERS).filter((e) => e.zone === zone
    && (includeBoss || !e.boss)
    && (includeTutorial || !e.tutorial));
}
