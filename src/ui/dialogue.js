// Dialogue overlay (registry 'dialogue', transparent): portrait medallion (party and boss busts, NPC busts from the
// world's npcPortrait(), else a monogram), gilded name plate, typewriter text with soft voice blips, confirm to
// complete/advance, hold cancel to skip. Over a battle the box docks at the top, clear of the party cards.
// openDialogue(game, idOrLines) wraps it in a Promise so world/battle code can `await openDialogue(game, 'warden_pre')`.

import { UIScene, el, HoldGauge, clickable } from './widgets.js';
import { escapeHtml, speakerInfo, fillKeys, keyCapHtml } from './text.js';
import { getDialogue } from '../data/story.js';
import { portraitDataURL } from '../render/sprites.js';

/** Milliseconds per character of the typewriter. */
const CHAR_MS = 21;
/** Extra pause after punctuation (ms). */
const PAUSE_LONG = 170;
const PAUSE_SHORT = 70;
/** Voice-blip pitch per speaker (0 = silent). */
const VOICE = { gideon: 0.74, nyra: 1.2, sable: 1.02, narrator: 0.62 };

// NPC busts are painted by the world module, which owns their looks. It is imported lazily so that a missing or
// failing module only costs the bust (the monogram medallion stands in), never the dialogue itself.
let npcPortrait = null;
/** Settles once the world's NPC portrait painter is available (or known to be missing). */
export const npcPortraitsReady = import('../world/npcPortraits.js')
  .then((mod) => {
    npcPortrait = typeof mod?.npcPortrait === 'function' ? mod.npcPortrait : null;
  })
  .catch((err) => console.warn('[dialogue] NPC portraits unavailable:', err?.message ?? err));
const npcPortraitUrls = new Map();

/**
 * Data URL of a named NPC's painted bust (cached per name and size), or null when the world paints none for it.
 * @param {string} name speaker name as written in the dialogue (e.g. 'Pellam Quist')
 * @param {number} size
 * @returns {string|null}
 */
export function npcPortraitURL(name, size) {
  if (!npcPortrait || !name) return null;
  const key = `${name}|${size}`;
  if (npcPortraitUrls.has(key)) return npcPortraitUrls.get(key);
  let url = null;
  try {
    url = npcPortrait(name, size)?.toDataURL?.() ?? null;
  } catch (err) {
    console.warn(`[dialogue] npcPortrait("${name}") failed:`, err);
  }
  npcPortraitUrls.set(key, url);
  return url;
}

/**
 * Portrait element of a speaker (see speakerInfo()): the painted bust of a party member or boss, an NPC's bust
 * from the world, else a monogram medallion in the speaker's colour.
 * @param {{look:string|null, name:string, monogram:string, color:string}} who
 * @param {number} size bust resolution (px)
 * @returns {HTMLElement}
 */
export function speakerPortrait(who, size) {
  const url = who.look ? portraitDataURL(who.look, size) : npcPortraitURL(who.name, size);
  if (url || who.look) return el('div', { class: 'portrait', html: url ? `<img src="${url}" alt="">` : '' });
  return el('div', { class: 'monogram', style: `--tint:${who.color}`, text: who.monogram });
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((l) => (typeof l === 'string' ? { speaker: 'narrator', text: l } : l))
    .filter((l) => l && typeof l.text === 'string' && l.text.length);
}

/**
 * Dialogue scene. Params: { id?: dialogue id in STORY.dialogues, lines?: [{speaker, text}], onDone?: () => void,
 * dock?: 'top'|'bottom' (default: 'top' over a battle, so the party cards stay visible; 'bottom' elsewhere) }.
 * Pops itself (result {done:true, skipped}) and then calls onDone.
 */
export class DialogueScene extends UIScene {
  constructor(game) {
    super(game);
    this.transparent = true;
    this.lines = [];
    this.index = 0;
    this.shown = 0;
    this.acc = 0;
    this.typing = false;
    this.finished = false;
    this.skipped = false;
  }

  enter(params = {}) {
    const { id, lines, onDone } = params;
    this.onDone = typeof onDone === 'function' ? onDone : null;
    this.lines = normalizeLines(lines ?? (id ? getDialogue(id) : []));
    if (!this.lines.length) console.warn(`[dialogue] no lines for ${id ? `"${id}"` : 'this dialogue'}`);
    this.root = this.mountRoot('dialogue-screen');
    const stack = this.game.scenes?.stack ?? [];
    const below = stack[stack.indexOf(this) - 1]?.name;
    const dock = params.dock === 'top' || params.dock === 'bottom' ? params.dock : below === 'battle' ? 'top' : 'bottom';
    this.root.classList.toggle('is-docked-top', dock === 'top');
    this.panel = el('div', { class: 'dlg-panel' });
    this.box = el('div', { class: 'dlg-box' });
    this.inner = el('div', { class: 'dlg-inner' });
    this.textEl = el('div', { class: 'dlg-text' });
    this.inner.appendChild(this.textEl);
    this.box.appendChild(this.inner);
    this.portraitHost = el('div', { class: 'dlg-portrait-host' });
    this.nameEl = null;
    this.nextEl = el('div', { class: 'dlg-next', html: `${keyCapHtml(this.game, 'confirm')}<i></i>` });
    this.countEl = el('div', { class: 'dlg-count' });
    this.hold = new HoldGauge(this.game, { action: 'cancel', ms: 750, label: 'Hold to skip', tapLabel: 'Skip' });
    // Tapping the pill skips too: a touch screen has no Back key to hold.
    const skip = clickable(el('div', { class: 'dlg-skip' }, this.hold.el), () => {
      if (this.finished) return;
      this.sfx('ui_cancel');
      this._finish(true);
    });
    const fleuron = el('div', { class: 'dlg-fleuron' });
    this.panel.append(this.box, fleuron, this.portraitHost, this.nextEl, this.countEl, skip);
    this.panel.addEventListener('mousedown', (e) => e.preventDefault());
    this.panel.addEventListener('click', () => this._advance());
    this.root.appendChild(this.panel);
    if (this.lines.length) this._showLine(0);
  }

  onDeviceChange() {
    super.onDeviceChange();
    this.hold?.relabel();
  }

  _showLine(i) {
    this.index = i;
    const line = this.lines[i];
    const who = speakerInfo(line.speaker);
    const prev = i > 0 ? speakerInfo(this.lines[i - 1].speaker) : null;
    this.text = fillKeys(line.text, this.game);
    this.who = who;
    this.shown = 0;
    this.acc = -90; // tiny beat before the first letter
    this.typing = true;
    this.blipCount = 0;
    this.root.classList.toggle('is-narrator', who.narrator);
    this.root.classList.remove('is-complete');
    this.countEl.textContent = this.lines.length > 1 ? `${i + 1} / ${this.lines.length}` : '';
    if (!prev || prev.id !== who.id) this._setSpeaker(who);
    this._renderText();
  }

  _setSpeaker(who) {
    this.portraitHost.innerHTML = '';
    this.nameEl?.remove();
    this.nameEl = null;
    if (who.narrator) return;
    const holder = el('div', { class: 'dlg-portrait' }, speakerPortrait(who, 288));
    this.portraitHost.appendChild(holder);
    // Opened before the NPC painter finished loading: swap the monogram for the bust once it is there.
    if (!who.look && !npcPortrait) {
      npcPortraitsReady.then(() => {
        const url = npcPortraitURL(who.name, 288);
        if (url && this.who?.id === who.id && holder.isConnected) holder.replaceChildren(speakerPortrait(who, 288));
      });
    }
    this.nameEl = el('div', { class: 'dlg-name', style: `--dlg-accent:${who.color}`, html: `<i></i>${escapeHtml(who.name)}` });
    this.panel.appendChild(this.nameEl);
  }

  _renderText() {
    const vis = this.text.slice(0, this.shown);
    const rest = this.text.slice(this.shown);
    this.textEl.innerHTML = `${escapeHtml(vis)}<span class="ghost">${escapeHtml(rest)}</span>`;
  }

  _complete() {
    this.shown = this.text.length;
    this.typing = false;
    this._renderText();
    this.root.classList.add('is-complete');
  }

  _advance() {
    if (this.finished) return;
    if (!this.lines.length) {
      this._finish(false);
      return;
    }
    if (this.typing) {
      this._complete();
      return;
    }
    this.sfx('ui_move', { volume: 0.35, pitch: 0.9 });
    if (this.index + 1 < this.lines.length) this._showLine(this.index + 1);
    else this._finish(false);
  }

  _finish(skipped) {
    if (this.finished) return;
    this.finished = true;
    this.skipped = skipped;
    const cb = this.onDone;
    this.onDone = null;
    if (this.game.scenes.top === this) this.game.scenes.pop({ done: true, skipped });
    try {
      cb?.({ skipped });
    } catch (err) {
      console.error('[dialogue] onDone threw', err);
    }
  }

  _tick(dt) {
    if (!this.typing) return;
    this.acc += dt;
    let changed = false;
    while (this.typing && this.acc >= CHAR_MS) {
      this.acc -= CHAR_MS;
      const ch = this.text[this.shown];
      this.shown += 1;
      changed = true;
      if (/[.!?…—]/.test(ch) && this.text[this.shown] === ' ') this.acc -= PAUSE_LONG;
      else if (/[,;:]/.test(ch)) this.acc -= PAUSE_SHORT;
      if (/[A-Za-zÀ-ÿ0-9]/.test(ch)) {
        this.blipCount += 1;
        const every = this.who.narrator ? 4 : 3;
        const base = VOICE[this.who.id] ?? 0.9 + ((this.who.name.length % 5) * 0.06);
        if (this.blipCount % every === 1 && base > 0) {
          this.sfx('ui_move', { volume: this.who.narrator ? 0.1 : 0.17, pitch: base * (0.95 + Math.random() * 0.1) });
        }
      }
      if (this.shown >= this.text.length) this._complete();
    }
    if (changed && this.typing) this._renderText();
  }

  update(dt) {
    this.time += dt;
    if (this.finished) return;
    const input = this.game.input;
    if (!this.lines.length) {
      this._finish(false);
      return;
    }
    if (this.hold.update(dt)) {
      this.sfx('ui_cancel');
      this._finish(true);
      return;
    }
    if (input.pressed('confirm') || input.pressed('qte')) {
      input.consume(['confirm', 'qte', 'jump']);
      this._advance();
      if (this.finished) return;
    }
    this._tick(dt);
  }
}

/**
 * Open a dialogue over the current scene and resolve when it closes.
 * @param {object} game
 * @param {string|Array<{speaker:string, text:string}>} idOrLines  STORY.dialogues id, or explicit lines
 * @returns {Promise<{skipped:boolean}>}
 */
export function openDialogue(game, idOrLines) {
  return new Promise((resolve) => {
    const params = Array.isArray(idOrLines) ? { lines: idOrLines } : { id: idOrLines };
    const lines = params.lines ?? getDialogue(params.id);
    if (!lines || !lines.length) {
      if (params.id) console.warn(`[dialogue] unknown dialogue "${params.id}"`);
      resolve({ skipped: false });
      return;
    }
    try {
      game.scenes.push('dialogue', { ...params, onDone: (r) => resolve(r ?? { skipped: false }) });
    } catch (err) {
      console.error('[dialogue] could not open dialogue', err);
      resolve({ skipped: false });
    }
  });
}
