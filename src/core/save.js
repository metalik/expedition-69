// Settings persistence and a guarded JSON wrapper around localStorage.
// Pure at import time: localStorage is only touched inside functions, always inside try/catch,
// and every function degrades to a harmless no-op when storage is missing or blocked.

import { DIFFICULTY } from '../battle/qte.js';
import { ACTIONS } from './input.js';

/** localStorage key of the RPG save (written by src/game/gameState.js). */
export const SAVE_KEY = 'exp69.save.v1';
/** localStorage key of the settings object. */
export const SETTINGS_KEY = 'exp69.settings.v1';

/** Default settings. `inputOffset` is the QTE calibration in ms (subtracted from press times). */
export const DEFAULT_SETTINGS = Object.freeze({
  difficulty: 'expeditioner',
  assistCues: true,
  inputOffset: 0,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.55,
  screenShake: true,
  reducedFlashing: false,
  showTimingFeedback: false,
  bindings: null,
});

/** Allowed calibration range (ms). */
export const INPUT_OFFSET_RANGE = Object.freeze({ min: -250, max: 250 });

function getStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  } catch {
    // Accessing localStorage throws in sandboxed / privacy-restricted contexts.
  }
  return null;
}

/** Guarded JSON storage. Never throws. */
export const storage = {
  /** True if a usable localStorage exists. */
  get available() {
    return getStorage() !== null;
  },

  /**
   * Read and JSON-parse a key.
   * @param {string} key
   * @param {*} [fallback=null] returned when missing, unreadable or unparsable
   */
  get(key, fallback = null) {
    const ls = getStorage();
    if (!ls) return fallback;
    try {
      const raw = ls.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  /**
   * JSON-stringify and write a key.
   * @param {string} key
   * @param {*} value
   * @returns {boolean} true on success
   */
  set(key, value) {
    const ls = getStorage();
    if (!ls) return false;
    try {
      ls.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Remove a key.
   * @param {string} key
   * @returns {boolean} true on success
   */
  remove(key) {
    const ls = getStorage();
    if (!ls) return false;
    try {
      ls.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};

const clampNum = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

/**
 * Validate custom bindings: {action: [code strings]} for known actions only; null when empty/invalid.
 * @param {*} raw
 * @returns {Record<string, string[]>|null}
 */
export function sanitizeBindings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [action, codes] of Object.entries(raw)) {
    if (!ACTIONS.includes(action) || !Array.isArray(codes)) continue;
    const clean = [...new Set(codes.filter((c) => typeof c === 'string' && c.length > 0 && c.length < 40))];
    out[action] = clean;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Merge raw settings over the defaults and validate every known field. Unknown fields that are
 * plain JSON values are preserved (other modules may add their own settings).
 * @param {object} raw
 * @returns {object} a fresh settings object
 */
export function validateSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (Object.hasOwn(DEFAULT_SETTINGS, k)) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'object') out[k] = v;
  }
  const d = DEFAULT_SETTINGS;
  out.difficulty = typeof src.difficulty === 'string' && Object.hasOwn(DIFFICULTY, src.difficulty) ? src.difficulty : d.difficulty;
  out.assistCues = bool(src.assistCues, d.assistCues);
  out.inputOffset = Math.round(clampNum(src.inputOffset, INPUT_OFFSET_RANGE.min, INPUT_OFFSET_RANGE.max, d.inputOffset));
  out.masterVolume = clampNum(src.masterVolume, 0, 1, d.masterVolume);
  out.sfxVolume = clampNum(src.sfxVolume, 0, 1, d.sfxVolume);
  out.musicVolume = clampNum(src.musicVolume, 0, 1, d.musicVolume);
  out.screenShake = bool(src.screenShake, d.screenShake);
  out.reducedFlashing = bool(src.reducedFlashing, d.reducedFlashing);
  out.showTimingFeedback = bool(src.showTimingFeedback, d.showTimingFeedback);
  out.bindings = sanitizeBindings(src.bindings);
  return out;
}

/**
 * Load settings from storage (defaults merged, validated). Works without localStorage.
 * @returns {object}
 */
export function loadSettings() {
  return validateSettings(storage.get(SETTINGS_KEY, null));
}

/**
 * Persist settings (validated first).
 * @param {object} settings
 * @returns {boolean} true on success
 */
export function saveSettings(settings) {
  return storage.set(SETTINGS_KEY, validateSettings(settings));
}

/**
 * Fresh copy of the default settings.
 * @returns {object}
 */
export function defaultSettings() {
  return validateSettings({});
}
