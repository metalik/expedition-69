// Text helpers for the Expedition 69 UI: HTML escaping, {action} key-token replacement (plain and key-cap HTML),
// speaker identity for dialogue portraits, number / time formatting and small typographic niceties.
// DOM-free: every function returns strings or plain objects, so it is safe to import anywhere.

import { ACTIONS } from '../core/input.js';
import { formatDuration } from '../core/util.js';
import { fillTokens, SPEAKER_NAMES, STORY } from '../data/story.js';
import { ENEMIES } from '../data/enemies.js';
import { CHARACTERS } from '../data/characters.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape a value for safe insertion into HTML text or attribute values.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/**
 * Current key label for an action (falls back to the action name without an Input).
 * @param {{input?:object}} game
 * @param {string} action
 * @returns {string}
 */
export function keyLabel(game, action) {
  const input = game?.input;
  if (!input || typeof input.keyLabel !== 'function') return action;
  return input.keyLabel(action);
}

/** Device currently driving the prompts ('keyboard' | 'gamepad' | 'touch'). */
export function deviceOf(game) {
  return game?.input?.lastDevice ?? 'keyboard';
}

/**
 * HTML for a key cap showing the current binding of an action, e.g. <span class="kbd">E</span>.
 * Elements carry data-key so refreshKeyCaps() can relabel them when the device changes.
 * @param {object} game
 * @param {string} action
 * @param {{cls?:string}} [opts]
 * @returns {string}
 */
export function keyCapHtml(game, action, { cls = '' } = {}) {
  const pad = deviceOf(game) === 'gamepad';
  const touch = deviceOf(game) === 'touch';
  const label = keyLabel(game, action);
  const classes = ['kbd', pad ? 'kbd-pad' : '', touch ? 'kbd-touch' : '', label.length > 3 ? 'kbd-wide' : '', cls].filter(Boolean).join(' ');
  return `<span class="${classes}" data-key="${escapeHtml(action)}">${escapeHtml(label)}</span>`;
}

/**
 * HTML for a directional pair: ↑↓ / ←→ on keyboard, "D-Pad" on a gamepad.
 * @param {object} game
 * @param {'vertical'|'horizontal'} axis
 * @returns {string}
 */
export function navCapHtml(game, axis = 'vertical') {
  const dev = deviceOf(game);
  if (dev === 'gamepad') return `<span class="kbd kbd-pad kbd-wide" data-nav="${axis}">D-Pad</span>`;
  if (dev === 'touch') return '';
  const [a, b] = axis === 'horizontal' ? ['left', 'right'] : ['up', 'down'];
  return `<span class="kbd" data-key="${a}">${escapeHtml(keyLabel(game, a))}</span><span class="kbd" data-key="${b}">${escapeHtml(keyLabel(game, b))}</span>`;
}

/**
 * Relabel every [data-key] key cap under `root` for the current device.
 * @param {Element} root
 * @param {object} game
 */
export function refreshKeyCaps(root, game) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const dev = deviceOf(game);
  for (const cap of root.querySelectorAll('[data-key]')) {
    const label = keyLabel(game, cap.getAttribute('data-key'));
    cap.textContent = label;
    cap.classList.toggle('kbd-pad', dev === 'gamepad');
    cap.classList.toggle('kbd-touch', dev === 'touch');
    cap.classList.toggle('kbd-wide', label.length > 3);
  }
}

/**
 * Rewrite {action} tokens for a touch screen, where there are no keys to press, only on-screen buttons and taps:
 * "press {parry}" → "tap" + button(parry); "press {confirm}" → "tap it" (the choice itself is tapped); a token that
 * opens a sentence is the button's own verb ("{dodge} them" → "Dodge them"); any other token → button(action).
 * Unknown tokens are left as they are.
 * @param {string} text
 * @param {object} game
 * @param {(action:string) => string} button  wording of an action's on-screen button (plain text or key-cap HTML)
 * @returns {string}
 */
export function touchWording(text, game, button) {
  const known = (a) => ACTIONS.includes(a);
  const tap = (verb) => (verb[0] === verb[0].toUpperCase() ? 'Tap' : 'tap');
  return String(text ?? '')
    .replace(/\b(press|hit|tap)(\s+)\{confirm\}/gi, (whole, verb) => `${tap(verb)} it`)
    .replace(/\b(press|hit|tap)(\s+)\{([a-zA-Z]+)\}/gi, (whole, verb, sp, a) => (known(a) ? `${tap(verb)}${sp}${button(a)}` : whole))
    .replace(/(^|[.!?:—]\s+)\{([a-zA-Z]+)\}/g, (whole, lead, a) => (known(a) ? `${lead}${a === 'confirm' ? 'Tap' : keyLabel(game, a)}` : whole))
    .replace(/\{([a-zA-Z]+)\}/g, (whole, a) => (!known(a) ? whole : a === 'confirm' ? 'a tap' : button(a)));
}

/**
 * Replace {action} tokens with plain key labels, e.g. "Press {parry}" → "Press E" (keyboard) / "Press RB" (gamepad);
 * on a touch screen the copy is rewritten for its buttons: "Tap the Parry button".
 * @param {string} text
 * @param {object} game
 * @returns {string}
 */
export function fillKeys(text, game) {
  if (deviceOf(game) === 'touch') return touchWording(text, game, (a) => `the ${keyLabel(game, a)} button`);
  return fillTokens(String(text ?? ''), (token) => (ACTIONS.includes(token) ? keyLabel(game, token) : null));
}

/**
 * Escape `text` and replace {action} tokens with key-cap HTML (on touch: "Tap [Parry]", see touchWording()).
 * @param {string} text
 * @param {object} game
 * @returns {string}
 */
export function keysToHtml(text, game) {
  const html = escapeHtml(text);
  if (deviceOf(game) === 'touch') return touchWording(html, game, (a) => keyCapHtml(game, a));
  return html.replace(/\{([a-zA-Z]+)\}/g, (whole, token) => (ACTIONS.includes(token) ? keyCapHtml(game, token) : whole));
}

/**
 * A list of key hints, e.g. [['confirm', 'Select'], [['up','down'], 'Move']] → hint-bar HTML.
 * An entry's first element may be an action, 'nav-v' / 'nav-h', or an array of actions.
 * @param {object} game
 * @param {Array<[string|string[], string]>} hints
 * @returns {string}
 */
export function hintsHtml(game, hints) {
  if (deviceOf(game) === 'touch') return '';
  return hints
    .filter(Boolean)
    .map(([keys, label]) => {
      let caps;
      if (keys === 'nav-v') caps = navCapHtml(game, 'vertical');
      else if (keys === 'nav-h') caps = navCapHtml(game, 'horizontal');
      else caps = [].concat(keys).map((a) => keyCapHtml(game, a)).join('');
      return `<span class="hint">${caps}<em>${escapeHtml(label)}</em></span>`;
    })
    .join('');
}

// ------------------------------------------------------------------ speakers

const NAME_TO_LOOK = (() => {
  const map = {};
  for (const e of Object.values(ENEMIES)) if (e && e.name && e.look) map[e.name.toLowerCase()] = e.look;
  return map;
})();

const SPEAKER_TINTS = ['#b77a4a', '#6f9f8f', '#8a6fb0', '#b0885a', '#7a8fb8', '#a86060'];

/**
 * Identity of a dialogue speaker: display name, portrait look id (party members and named bosses), a monogram and
 * an accent colour for everyone else. The narrator has no name and no portrait.
 * @param {string} speaker
 * @returns {{id:string, name:string, look:string|null, narrator:boolean, monogram:string, color:string}}
 */
export function speakerInfo(speaker) {
  const id = String(speaker ?? 'narrator');
  if (id === 'narrator' || id === '') return { id: 'narrator', name: '', look: null, narrator: true, monogram: '', color: '#e0b458' };
  if (Object.hasOwn(CHARACTERS, id)) {
    const c = CHARACTERS[id];
    return { id, name: SPEAKER_NAMES[id] ?? c.name, fullName: c.name, look: c.look, narrator: false, monogram: c.name[0], color: c.color };
  }
  const look = NAME_TO_LOOK[id.toLowerCase()] ?? null;
  const words = id.replace(/^the\s+/i, '').split(/\s+/).filter(Boolean);
  const monogram = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { id, name: id, look, narrator: false, monogram: monogram || '?', color: SPEAKER_TINTS[h % SPEAKER_TINTS.length] };
}

// ------------------------------------------------------------------ formatting

/** "1,240" style integer formatting. */
export function formatInt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US');
}

/** Play time "1:02:33" / "12:07". */
export function formatPlayTime(ms) {
  return formatDuration(ms);
}

/** Percentage string from a 0..1 fraction ("12%"). */
export function pct(x, digits = 0) {
  const v = (Number(x) || 0) * 100;
  return `${digits ? v.toFixed(digits) : Math.round(v)}%`;
}

/** Signed number with a real minus sign: +3 / −2 / 0. */
export function signed(n, digits = 0) {
  const v = Number(n) || 0;
  const s = digits ? Math.abs(v).toFixed(digits) : String(Math.round(Math.abs(v)));
  if (v > 0) return `+${s}`;
  if (v < 0) return `−${s}`;
  return s;
}

/** Signed milliseconds for timing offsets: "+34 ms" / "−12 ms" / "0 ms". */
export function signedMs(ms) {
  return `${signed(Math.round(Number(ms) || 0))} ms`;
}

const ROMAN = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
/** Roman numeral for small positive integers (slide / chapter numbering). */
export function roman(n) {
  let v = Math.max(1, Math.floor(Number(n) || 1));
  let out = '';
  for (const [k, s] of ROMAN) while (v >= k) { out += s; v -= k; }
  return out;
}

/** "1 point" / "3 points". */
export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** Display name of a zone id (STORY.zoneTitles, falling back to a title-cased id). */
export function zoneName(zone) {
  const t = STORY?.zoneTitles?.[zone];
  if (t) return t;
  return String(zone ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const ELEMENT_NAMES = { physical: 'Physical', fire: 'Fire', ice: 'Ice', lightning: 'Lightning', earth: 'Earth', light: 'Light', dark: 'Dark' };
/** Display name of an element id. */
export function elementName(el) {
  return ELEMENT_NAMES[el] ?? String(el ?? '');
}

const TARGET_NAMES = {
  enemy: 'One enemy', allEnemies: 'All enemies', ally: 'One ally', allAllies: 'All allies', self: 'Self',
  deadAlly: "A fallen ally", randomEnemies: 'Random enemies',
};
/** Display text of a skill target kind. */
export function targetName(target) {
  return TARGET_NAMES[target] ?? String(target ?? '');
}

/**
 * Wrap each word of a text in <span class="w" style="--i:n"> for staggered reveal animations.
 * @param {string} text
 * @param {number} [start=0] index offset
 * @returns {{html:string, count:number}}
 */
export function wordSpans(text, start = 0) {
  const words = String(text ?? '').split(/(\s+)/);
  let i = start;
  const html = words
    .map((w) => (/^\s+$/.test(w) || !w ? w : `<span class="w" style="--i:${i++}">${escapeHtml(w)}</span>`))
    .join('');
  return { html, count: i - start };
}

/** Flavour and pip count of each difficulty (title picker and settings). */
export const DIFFICULTY_INFO = {
  story: {
    desc: 'For savouring the tale. Generous timing and gentler blows — the Gloam still bites, but it forgives.',
    pips: 1,
  },
  expeditioner: {
    desc: 'The journey as intended. Read every swing, answer it in time, and the Gloam will fall.',
    pips: 2,
  },
  veteran: {
    desc: 'For those who have crossed before. Razor-thin windows, fiercer bosses and no respite between fights: every mistake is paid for in full.',
    pips: 3,
  },
};

/**
 * The numbers behind a difficulty (a DIFFICULTY entry of battle/qte.js) as [label, value] pairs for the pickers:
 * timing windows and damage taken always, then the boss levers and the post-battle recovery where they differ from
 * the defaults.
 * @param {object} def
 * @returns {Array<[string, string]>}
 */
export function difficultyFacts(def) {
  if (!def) return [];
  const facts = [['Timing windows', `×${def.windowScale}`], ['Damage taken', `×${def.dmgTakenMult}`]];
  const bossDmg = def.bossDmgMult ?? 1;
  const bossSpd = def.bossSpdMult ?? 1;
  const boss = [bossDmg !== 1 ? `hit ×${bossDmg}` : '', bossSpd !== 1 ? `speed ×${bossSpd}` : ''].filter(Boolean).join(', ');
  if (boss) facts.push(['Bosses', boss]);
  if (def.postBattleRecovery === 0) facts.push(['After battle', 'no recovery']);
  return facts;
}
