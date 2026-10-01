// Pause menu (registry 'pause', transparent over the world): tabs for Party (attributes with +/- preview and
// auto-allocate), Skills (learn with SP), Relics & Echoes (slots, owned relics with mastery, echo capacity), Items
// (field use), Journal (lost-expedition journals + bestiary) and System (records, settings, quit to title).

import { UIScene, MenuList, Tabs, el, clickable, confirmDialog, toast, barHtml, pipsHtml, Tooltip, sfx, isCompact } from './widgets.js';
import {
  escapeHtml, zoneName, formatInt, formatPlayTime, pct, signed, elementName, targetName, hintsHtml, keyCapHtml, plural,
  deviceOf,
} from './text.js';
import {
  partyMemberView, allocateAttr, autoAllocate, skillsFor, learnSkill, equipRelic, equipEcho, unequipEcho,
  describeRelic, relicInventory, echoOptions, canUseItemOutOfBattle, useItemOutOfBattle, getMember,
} from '../game/gameState.js';
import { ATTRS, ATTR_INFO, derivedStats, echoCapacity, echoLoad } from '../game/progression.js';
import { CHARACTERS, PARTY_ORDER } from '../data/characters.js';
import { RELICS, MASTERY_BATTLES } from '../data/relics.js';
import { ITEMS, ITEM_ORDER, UPGRADES } from '../data/items.js';
import { ENEMIES } from '../data/enemies.js';
import { STORY, JOURNAL_IDS } from '../data/story.js';
import { STATUS_DEFS } from '../battle/status.js';
import { portraitDataURL, drawActor, getBounds } from '../render/sprites.js';
import { elementIcon, itemIcon, mechanicIcon, statusIcon } from '../render/icons.js';

const STAT_CELLS = [['maxHp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['spd', 'SPD'], ['crit', 'CRIT']];
const ATTR_STAT = { vitality: 'maxHp', might: 'atk', agility: 'spd', defense: 'def', luck: 'crit' };
const ZONE_ORDER = ['shore', 'thicket', 'spire', 'summit', 'training'];

const portrait = (look, size = 160) => portraitDataURL(look, size);
const fmtStat = (key, v) => (key === 'crit' ? pct(v) : formatInt(v));

function portraitHtml(look, size = 160, cls = '') {
  const url = portrait(look, size);
  return `<div class="portrait ${cls}">${url ? `<img src="${url}" alt="">` : ''}</div>`;
}

const silhouettes = new Map();
/**
 * Data URL of a foe's whole figure in solid ink, fitted into a square (cached): the Bestiary's picture of a foe not
 * yet fought. '' when no canvas is available.
 * @param {string} look
 * @param {number} size
 * @returns {string}
 */
function silhouetteURL(look, size) {
  const key = `${look}|${size}`;
  if (silhouettes.has(key)) return silhouettes.get(key);
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const pose = { x: 0, y: 0, scale: 1, facing: -1, anim: 'idle', t: 600, shadow: false };
    const b = getBounds(look, pose);
    const k = Math.min((size * 0.76) / Math.max(1, b.w), (size * 0.76) / Math.max(1, b.h), 3);
    drawActor(c.getContext('2d'), look, {
      ...pose, scale: k, x: size / 2 - (b.x + b.w / 2) * k, y: size / 2 - (b.y + b.h / 2) * k,
      tint: { color: '#0b0705', amount: 1 },
    });
    url = c.toDataURL('image/png');
  } catch (err) {
    console.warn('[pause] silhouette failed', look, err);
  }
  silhouettes.set(key, url);
  return url;
}

/** A silhouette medallion (see silhouetteURL). */
function silhouetteHtml(look, size, cls = '') {
  const url = silhouetteURL(look, size);
  return `<div class="portrait is-silhouette ${cls}">${url ? `<img src="${url}" alt="">` : ''}</div>`;
}

function breakdownTip(b, key) {
  if (!b) return '';
  const f = (v) => (key === 'crit' ? pct(v, 0) : formatInt(v));
  const parts = [`Base ${f(b.base)}`];
  if (b.growth) parts.push(`Levels ${key === 'crit' ? pct(b.growth) : signed(b.growth)}`);
  if (b.attrs) parts.push(`Attributes ${key === 'crit' ? `+${pct(b.attrs)}` : signed(b.attrs)}`);
  if (b.relics) parts.push(`Relics ${key === 'crit' ? `+${pct(b.relics)}` : signed(b.relics)}`);
  return `${parts.join(' · ')} = ${f(b.total)}`;
}

/** Display names of Nyra's glyphs and Sable's stances (ids stay internal: the 'virtuoso' stance reads Bravura). */
const GLYPH_NAMES = { fire: 'Fire', ice: 'Ice', storm: 'Storm', earth: 'Earth', light: 'Light' };
const STANCE_NAMES = { neutral: 'Neutral', assault: 'Assault', guard: 'Guard', virtuoso: 'Bravura' };
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];

/** "a Fire Glyph" / "an Ice Glyph". */
function aGlyph(g) {
  const name = GLYPH_NAMES[g] ?? titleCaseId(g);
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} Glyph`;
}

/** Mechanic flourish of a skill, for icons and tags. */
export function skillMechanic(s) {
  if (!s) return null;
  const glyphKey = (g) => (Object.hasOwn(GLYPH_NAMES, g) ? `glyph_${g}` : 'glyph_light');
  if (s.surge === 'consume') return { key: 'surge', label: 'Consumes Surge' };
  if (s.effects?.some((e) => e.type === 'surge')) return { key: 'surge', label: 'Builds Surge' };
  if (s.consumeAllGlyphs) return { key: 'glyph_light', label: 'Spends every Glyph' };
  if (s.consumeGlyph) {
    const g = s.consumeGlyph.glyph;
    return { key: glyphKey(g), label: g === 'any' || g === '*' ? 'Consumes a Glyph' : `Consumes ${aGlyph(g)}` };
  }
  const inscribed = (s.effects ?? []).filter((e) => e.type === 'glyph');
  if (inscribed.length > 1) return { key: glyphKey(inscribed[0].add), label: `Inscribes ${COUNT_WORDS[inscribed.length] ?? inscribed.length} Glyphs` };
  if (inscribed.length) return { key: glyphKey(inscribed[0].add), label: `Inscribes ${aGlyph(inscribed[0].add)}` };
  const st = s.effects?.find((e) => e.type === 'stance');
  if (st) return { key: `stance_${st.to}`, label: `Shifts to ${STANCE_NAMES[st.to] ?? titleCaseId(st.to)}` };
  return null;
}

function relicIconHtml(size = 30) {
  return `<img src="${mechanicIcon('relic', size)}" alt="">`;
}

function titleCaseId(id) {
  return String(id).split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ================================================================================================ base pane

class Pane {
  constructor(scene) {
    this.scene = scene;
    this.game = scene.game;
    this.state = scene.game.state;
    this.active = true;
    this.el = el('div', { class: 'tab-pane' });
  }

  mount(host) {
    host.appendChild(this.el);
    this.render();
  }

  unmount() {
    this.el.remove();
  }

  setActive(v) {
    this.active = v;
  }

  render() {}

  hints() {
    return [];
  }

  /** Footer description line (HTML). */
  setDesc(html) {
    this.scene.setDesc(html);
  }

  get memberId() {
    return PARTY_ORDER[this.scene.memberIndex] ?? PARTY_ORDER[0];
  }

  /** Member chips; click selects. */
  memberStripHtml(right = '') {
    const chips = PARTY_ORDER.map((id, i) => {
      const v = partyMemberView(this.state, id);
      if (!v) return '';
      return `<div class="member-chip${i === this.scene.memberIndex ? ' is-active' : ''}" data-member="${i}">${portraitHtml(v.look, 96)}<div><b>${escapeHtml(v.name.split(' ')[0])}</b><span>Lv ${v.level}</span></div></div>`;
    }).join('');
    const keys = `<span class="ms-keys">${keyCapHtml(this.game, 'left')}${keyCapHtml(this.game, 'right')}</span>`;
    return `<div class="member-strip">${this.game.input.lastDevice === 'keyboard' ? keys : ''}${chips}<div class="ms-right">${right}</div></div>`;
  }

  bindMemberStrip(root) {
    for (const chip of root.querySelectorAll('[data-member]')) {
      clickable(chip, () => this.setMember(Number(chip.dataset.member)));
    }
  }

  setMember(i) {
    const n = PARTY_ORDER.length;
    const next = ((i % n) + n) % n;
    if (next === this.scene.memberIndex) return;
    this.scene.memberIndex = next;
    sfx(this.game, 'ui_move', { pitch: 1.1 });
    this.onMemberChange();
  }

  onMemberChange() {
    this.render();
  }

  /** left/right member switching; returns true if handled. */
  memberKeys() {
    const input = this.game.input;
    if (input.pressedRepeat('left')) {
      input.consume(['left']);
      this.setMember(this.scene.memberIndex - 1);
      return true;
    }
    if (input.pressedRepeat('right')) {
      input.consume(['right']);
      this.setMember(this.scene.memberIndex + 1);
      return true;
    }
    return false;
  }

  update() {
    return false;
  }
}

// ================================================================================================ party

class PartyPane extends Pane {
  constructor(scene) {
    super(scene);
    this.row = 0;
    this.alloc = false;
    this.pending = {};
  }

  hints() {
    if (this.alloc) return [['nav-h', 'Adjust'], ['nav-v', 'Attribute'], ['confirm', 'Commit'], ['cancel', 'Discard']];
    return [['nav-h', 'Member'], ['nav-v', 'Select'], ['confirm', this.row === ATTRS.length ? 'Auto-allocate' : 'Allocate'], ['cancel', 'Close']];
  }

  pendingTotal() {
    return Object.values(this.pending).reduce((s, n) => s + n, 0);
  }

  render() {
    // Compact (phone) layout: one card at a time, picked from the member strip, so rows can be tall enough to tap.
    const single = isCompact(this.game);
    const shown = single ? [this.scene.memberIndex] : PARTY_ORDER.map((_, i) => i);
    const cards = shown.map((i) => this.cardHtml(PARTY_ORDER[i], i)).join('');
    this.el.innerHTML = single
      ? `${this.memberStripHtml()}<div class="party-cards is-single">${cards}</div>`
      : `<div class="party-cards">${cards}</div>`;
    if (single) this.bindMemberStrip(this.el);
    for (const card of this.el.querySelectorAll('.member-card')) {
      const ci = Number(card.dataset.card);
      card.addEventListener('mousedown', (e) => e.preventDefault());
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        const rowEl = e.target.closest('[data-row]');
        if (ci !== this.scene.memberIndex) this.selectCard(ci);
        if (rowEl) this.row = Number(rowEl.dataset.row);
        if (btn) {
          const act = btn.dataset.act;
          if (act === 'plus' || act === 'minus') {
            if (!this.alloc) this.enterAlloc(true);
            if (this.alloc) this.adjust(act === 'plus' ? 1 : -1);
          } else if (act === 'auto') this.doAuto();
          else if (act === 'commit') this.commit();
          else if (act === 'discard') this.discard();
        }
        this.render();
      });
    }
    this.describe();
    this.scene.renderFoot();
  }

  cardHtml(id, i) {
    const v = partyMemberView(this.state, id);
    if (!v) return '';
    const sel = i === this.scene.memberIndex;
    const pending = sel ? this.pending : {};
    const m = getMember(this.state, id);
    let preview = null;
    if (sel && this.pendingTotal() > 0) {
      const clone = { ...m, attrs: { ...m.attrs } };
      for (const [a, n] of Object.entries(pending)) clone.attrs[a] += n;
      preview = derivedStats(clone);
    }
    const focusAttr = sel && this.row < ATTRS.length ? ATTRS[this.row] : null;
    const stats = STAT_CELLS.map(([k, label]) => {
      const cur = v.stats[k];
      const nv = preview ? preview[k] : cur;
      const d = nv - cur;
      const delta = d ? (k === 'crit' ? `+${pct(d)}` : signed(d)) : '';
      const lit = focusAttr && ATTR_STAT[focusAttr] === k;
      return `<div class="mc-stat${lit ? ' is-lit' : ''}" data-tip="${escapeHtml(breakdownTip(v.breakdown[k], k))}" data-tip-title="${label}"><small>${label}</small><b>${fmtStat(k, nv)}</b><i>${delta}</i></div>`;
    }).join('');
    const left = v.attrPoints - (sel ? this.pendingTotal() : 0);
    const rows = ATTRS.map((a, r) => {
      const info = ATTR_INFO[a];
      const p = pending[a] ?? 0;
      const canPlus = left > 0;
      const canMinus = p > 0;
      const focused = sel && this.row === r;
      return `<div class="attr-row${focused ? ' is-focused' : ''}" data-row="${r}" data-tip="${escapeHtml(info.desc)}" data-tip-title="${escapeHtml(info.name)}">
        <span>${escapeHtml(info.name)}</span>
        <span class="ar-btn${v.attrPoints > 0 && canMinus ? '' : ' is-off'}" data-act="minus">−</span>
        <span class="ar-val">${v.attrs[a] + p}</span>
        <span class="ar-pend">${p ? `+${p}` : ''}</span>
        <span class="ar-btn${v.attrPoints > 0 && canPlus ? '' : ' is-off'}" data-act="plus">+</span>
      </div>`;
    }).join('');
    const actionRow = sel && this.alloc
      ? `<div class="attr-row${this.row === ATTRS.length ? ' is-focused' : ''}" data-row="${ATTRS.length}" data-act="commit"><span>Commit ${this.pendingTotal() ? `(+${this.pendingTotal()})` : ''}</span></div>
         <div class="attr-row" data-act="discard"><span>Discard</span></div>`
      : `<div class="attr-row${sel && this.row === ATTRS.length ? ' is-focused' : ''}" data-row="${ATTRS.length}" data-act="auto"><span>Auto-Allocate</span></div>`;
    const xpText = v.atMaxLevel ? 'Max level' : `${formatInt(v.xp)} / ${formatInt(v.xpToNext)}`;
    return `<div class="member-card${sel ? ' is-selected' : ''}${sel && this.alloc ? ' is-alloc' : ''}" data-card="${i}" style="--accent:${v.color}">
      <div class="mc-head">${portraitHtml(v.look, 160)}
        <div class="mc-name"><h3>${escapeHtml(v.name)}</h3><p>${escapeHtml(v.title)}</p></div>
        <div class="mc-level"><b>${v.level}</b><small>LV</small></div>
      </div>
      <div class="mc-bars">
        ${barHtml({ value: v.hp, max: preview ? preview.maxHp : v.maxHp, kind: 'hp', label: 'HP', text: `${formatInt(v.hp)} / ${formatInt(preview ? preview.maxHp : v.maxHp)}` })}
        ${barHtml({ value: v.atMaxLevel ? 1 : v.xp, max: v.atMaxLevel ? 1 : v.xpToNext, kind: 'xp', label: 'XP', text: xpText })}
      </div>
      <div class="mc-stats">${stats}</div>
      <div class="mc-attrs">
        <div class="section-label">Attributes<span class="sl-right">${left > 0 ? `<span class="badge is-hot">${plural(left, 'point')}</span>` : `${plural(left, 'point')}`}</span></div>
        ${rows}
      </div>
      <div class="mc-actions">${actionRow}</div>
    </div>`;
  }

  describe() {
    const id = this.memberId;
    const v = partyMemberView(this.state, id);
    if (!v) return;
    if (this.row < ATTRS.length) {
      const a = ATTRS[this.row];
      const info = ATTR_INFO[a];
      const k = ATTR_STAT[a];
      this.setDesc(`<b>${escapeHtml(info.name)}</b> — ${escapeHtml(info.desc)} <span class="faint">${escapeHtml(breakdownTip(v.breakdown[k], k))}</span>`);
    } else if (this.alloc) {
      this.setDesc(`<b>Commit</b> — spend ${plural(this.pendingTotal(), 'point')} as previewed. Allocation is permanent.`);
    } else {
      this.setDesc(`<b>Auto-Allocate</b> — spend ${escapeHtml(v.name.split(' ')[0])}’s ${plural(v.attrPoints, 'point')} following ${v.id === 'gideon' ? 'his' : 'her'} natural build.`);
    }
  }

  selectCard(i) {
    if (this.alloc) this.discard(false);
    this.scene.memberIndex = ((i % 3) + 3) % 3;
    sfx(this.game, 'ui_move', { pitch: 1.1 });
  }

  /** Member chip picked in the compact layout: pending points belong to the previous member. */
  onMemberChange() {
    if (this.alloc) this.discard(false);
    this.render();
  }

  enterAlloc(fromMouse = false) {
    const v = partyMemberView(this.state, this.memberId);
    if (!v || v.attrPoints <= 0) {
      sfx(this.game, 'ui_error');
      toast(this.game, 'No attribute points to spend — earn 3 with every level.', { kind: 'warn' });
      return;
    }
    this.alloc = true;
    this.pending = {};
    if (!fromMouse) sfx(this.game, 'ui_confirm');
  }

  adjust(dir) {
    const a = ATTRS[this.row];
    if (!a) return;
    const v = partyMemberView(this.state, this.memberId);
    const p = this.pending[a] ?? 0;
    if (dir > 0 && this.pendingTotal() < v.attrPoints) {
      this.pending[a] = p + 1;
      sfx(this.game, 'ui_move', { pitch: 1 + this.pendingTotal() * 0.05 });
    } else if (dir < 0 && p > 0) {
      this.pending[a] = p - 1;
      if (!this.pending[a]) delete this.pending[a];
      sfx(this.game, 'ui_move', { pitch: 0.85 });
    } else sfx(this.game, 'ui_error', { volume: 0.6 });
  }

  commit() {
    if (!this.pendingTotal()) {
      this.discard();
      return;
    }
    const id = this.memberId;
    const parts = [];
    for (const [a, n] of Object.entries(this.pending)) {
      const r = allocateAttr(this.state, id, a, n);
      if (r.ok) parts.push(`+${n} ${ATTR_INFO[a].short}`);
    }
    this.alloc = false;
    this.pending = {};
    this.row = Math.min(this.row, ATTRS.length);
    sfx(this.game, 'buff');
    toast(this.game, `${CHARACTERS[id].name.split(' ')[0]} grows stronger · ${parts.join(' · ')}`, { kind: 'good' });
    this.scene.refreshBadges();
  }

  discard(sound = true) {
    this.alloc = false;
    this.pending = {};
    if (sound) sfx(this.game, 'ui_cancel');
  }

  doAuto() {
    const id = this.memberId;
    const r = autoAllocate(this.state, id);
    if (!r.ok) {
      sfx(this.game, 'ui_error');
      toast(this.game, r.reason ?? 'Nothing to allocate.', { kind: 'warn' });
      return;
    }
    const parts = Object.entries(r.allocated ?? {}).map(([a, n]) => `+${n} ${ATTR_INFO[a].short}`);
    sfx(this.game, 'buff');
    toast(this.game, `${CHARACTERS[id].name.split(' ')[0]} · ${parts.join(' · ')}`, { kind: 'good' });
    this.scene.refreshBadges();
  }

  update() {
    const input = this.game.input;
    const rows = ATTRS.length + 1;
    if (this.alloc) {
      if (input.pressedRepeat('left')) { input.consume(['left']); if (this.row < ATTRS.length) this.adjust(-1); this.render(); return true; }
      if (input.pressedRepeat('right')) { input.consume(['right']); if (this.row < ATTRS.length) this.adjust(1); this.render(); return true; }
      if (input.pressedRepeat('up')) { input.consume(['up']); this.row = (this.row - 1 + rows) % rows; sfx(this.game, 'ui_move'); this.render(); return true; }
      if (input.pressedRepeat('down')) { input.consume(['down']); this.row = (this.row + 1) % rows; sfx(this.game, 'ui_move'); this.render(); return true; }
      if (input.pressed('confirm')) { input.consume(['confirm', 'jump', 'qte']); this.commit(); this.render(); return true; }
      if (input.pressed('cancel')) { input.consume(['cancel', 'menu']); this.discard(); this.render(); return true; }
      return false;
    }
    if (input.pressedRepeat('left')) { input.consume(['left']); this.selectCard(this.scene.memberIndex - 1); this.render(); return true; }
    if (input.pressedRepeat('right')) { input.consume(['right']); this.selectCard(this.scene.memberIndex + 1); this.render(); return true; }
    if (input.pressedRepeat('up')) { input.consume(['up']); this.row = (this.row - 1 + rows) % rows; sfx(this.game, 'ui_move'); this.render(); return true; }
    if (input.pressedRepeat('down')) { input.consume(['down']); this.row = (this.row + 1) % rows; sfx(this.game, 'ui_move'); this.render(); return true; }
    if (input.pressed('confirm')) {
      input.consume(['confirm', 'jump', 'qte']);
      if (this.row === ATTRS.length) this.doAuto();
      else this.enterAlloc();
      this.render();
      return true;
    }
    return false;
  }
}

// ================================================================================================ skills

class SkillsPane extends Pane {
  hints() {
    return [['nav-h', 'Member'], ['nav-v', 'Select'], ['confirm', 'Learn'], ['cancel', 'Close']];
  }

  render() {
    const v = partyMemberView(this.state, this.memberId);
    const sp = v?.sp ?? 0;
    this.el.innerHTML = `${this.memberStripHtml(`<span class="badge${sp > 0 ? ' is-hot' : ''}">${sp} SP</span>`)}
      <div class="split split-wide-left"><div class="panel-inset list-box scroll skill-list"></div><div class="panel-inset detail skill-detail"></div></div>`;
    this.bindMemberStrip(this.el);
    const host = this.el.querySelector('.skill-list');
    const detail = this.el.querySelector('.skill-detail');
    const prevId = this.list?.current?.id;
    this.list = new MenuList(this.game, {
      className: 'menu-body',
      items: this.items(),
      id: prevId,
      render: (item) => this.rowHtml(item),
      describe: (item) => this.detailHtml(item),
      descEl: detail,
      scrollEl: host,
      onConfirm: (item) => this.learn(item),
      onFocus: (item) => this.setDesc(`<b>${escapeHtml(item.entry.name)}</b> — ${escapeHtml(item.entry.short ?? '')}`),
    });
    if (prevId) this.list.setItems(this.list.items, { id: prevId });
    host.appendChild(this.list.el);
    this.list.setActive(this.active);
    const cur = this.list.current;
    if (cur) this.setDesc(`<b>${escapeHtml(cur.entry.name)}</b> — ${escapeHtml(cur.entry.short ?? '')}`);
    this.scene.renderFoot();
  }

  items() {
    return skillsFor(this.state, this.memberId).map((e) => ({
      id: e.id,
      entry: e,
      className: e.status === 'locked' ? 'is-locked' : '',
      disabled: false,
    }));
  }

  rowHtml(item) {
    const e = item.entry;
    const s = e.skill;
    const mech = skillMechanic(s);
    let tag;
    if (e.status === 'learned') tag = '<span class="tag t-learned">Learned</span>';
    else if (e.status === 'learnable') tag = `<span class="tag t-learnable">Learn · ${e.sp} SP</span>`;
    else if (e.status === 'innate') tag = '<span class="tag t-innate">Prism</span>';
    else tag = `<span class="tag t-locked">${e.level > (getMember(this.state, this.memberId)?.level ?? 1) ? `Lv ${e.level}` : 'Locked'}</span>`;
    const cost = e.gradient ? '<span class="tag t-ap">1 Charge</span>' : `<span class="tag t-ap">${e.ap} AP</span>`;
    return `<div class="skill-row"><img src="${elementIcon(s.element, 26)}" alt="">
      <span class="sr-name">${escapeHtml(e.name)}<small>${escapeHtml(e.short ?? '')}</small></span>
      ${mech ? `<img class="sr-mech" src="${mechanicIcon(mech.key, 20)}" alt="" data-tip="${escapeHtml(mech.label)}">` : ''}
      ${cost}${tag}</div>`;
  }

  detailHtml(item) {
    const e = item.entry;
    const s = e.skill;
    const m = getMember(this.state, this.memberId);
    const mech = skillMechanic(s);
    const tags = [
      `<span class="tag"><img src="${elementIcon(s.element, 15)}" alt="">${escapeHtml(elementName(s.element))}</span>`,
      e.gradient ? '<span class="tag t-innate">1 Prism Charge</span>' : `<span class="tag t-ap">${e.ap} AP</span>`,
      `<span class="tag">${escapeHtml(targetName(s.target))}</span>`,
      mech ? `<span class="tag"><img src="${mechanicIcon(mech.key, 15)}" alt="">${escapeHtml(mech.label)}</span>` : '',
    ].join('');
    const hits = (s.hits ?? []).map((h) => `<i style="height:${Math.round(10 + Math.min(1, h.power / 2) * 24)}px" title="${h.power}"></i>`).join('');
    const hitsHtml = s.hits?.length ? `<div class="d-hits">${hits}<span>${plural(s.hits.length, 'timed hit')}</span></div>` : '';
    let req = '';
    if (!e.gradient) {
      const lvOk = (m?.level ?? 1) >= e.level;
      const spOk = e.status === 'learned' || (m?.sp ?? 0) >= e.sp;
      req = `<div class="d-block"><div class="d-label">Requirements</div><div class="d-req">
        <span class="${lvOk ? 'ok' : 'no'}">Level ${e.level}</span>
        <span class="${spOk ? 'ok' : 'no'}">${e.sp} SP</span>
        ${e.requires.map((r) => `<span class="${r.learned ? 'ok' : 'no'}">${escapeHtml(r.name)}</span>`).join('')}
      </div></div>`;
    }
    let status;
    if (e.status === 'learned') status = '<div class="d-status">✦ Learned — ready for battle</div>';
    else if (e.status === 'innate') status = '<div class="d-status">✦ Innate — unleashed with a full Prism charge</div>';
    else if (e.status === 'learnable') status = `<div class="d-status">${keyCapHtml(this.game, 'confirm')} Learn for ${e.sp} SP</div>`;
    else status = `<div class="d-status is-muted">${escapeHtml(e.reason ?? 'Locked')}</div>`;
    return `<h3>${escapeHtml(e.name)}</h3><div class="d-tags">${tags}</div>
      <div class="d-desc">${escapeHtml(e.desc ?? '')}</div>${hitsHtml}${req}${status}`;
  }

  async learn(item) {
    const e = item.entry;
    if (e.status !== 'learnable') {
      sfx(this.game, 'ui_error');
      if (e.status === 'locked') toast(this.game, e.reason ?? 'Not yet.', { kind: 'warn' });
      return;
    }
    const m = getMember(this.state, this.memberId);
    const ok = await confirmDialog(this.scene, {
      title: `Learn ${e.name}?`,
      html: `Spend <b class="gold">${e.sp} SP</b> of ${m.sp}. ${escapeHtml(CHARACTERS[m.id].name.split(' ')[0])} will be able to use it in battle at once.`,
      confirmLabel: 'Learn',
      cancelLabel: 'Not Yet',
    });
    if (!ok) return;
    const r = learnSkill(this.state, this.memberId, e.id);
    if (!r.ok) {
      sfx(this.game, 'ui_error');
      toast(this.game, r.reason ?? 'Could not learn that skill.', { kind: 'warn' });
      return;
    }
    sfx(this.game, 'level_up', { volume: 0.8 });
    toast(this.game, `${CHARACTERS[m.id].name.split(' ')[0]} learned ${e.name}`, { kind: 'gold', icon: elementIcon(e.skill.element, 24) });
    this.render();
    this.scene.refreshBadges();
  }

  setActive(v) {
    super.setActive(v);
    this.list?.setActive(v);
  }

  update(dt) {
    if (this.memberKeys()) return true;
    return this.list?.update(dt) ?? false;
  }
}

// ================================================================================================ relics & echoes

class RelicsPane extends Pane {
  hints() {
    if (this.picker) return [['nav-v', 'Select'], ['confirm', this.pickerKind === 'echo' ? 'Attune / Release' : 'Equip'], ['cancel', 'Back']];
    return [['nav-h', 'Member'], ['nav-v', 'Select'], ['confirm', 'Change'], ['cancel', 'Close']];
  }

  render() {
    const v = partyMemberView(this.state, this.memberId);
    this.el.innerHTML = `${this.memberStripHtml(`<span class="badge"><img src="${mechanicIcon('echo', 16)}" alt="">Echoes ${v.echoLoad} / ${v.echoCapacity}</span>`)}
      <div class="split"><div class="panel-inset list-box scroll relic-list"></div><div class="panel-inset detail relic-detail"></div></div>`;
    this.bindMemberStrip(this.el);
    this.listHost = this.el.querySelector('.relic-list');
    this.detailEl = this.el.querySelector('.relic-detail');
    const prev = this.list?.current?.id;
    this.list = new MenuList(this.game, {
      className: 'menu-body',
      items: this.items(v),
      render: (item) => this.rowHtml(item),
      describe: (item) => this.detailFor(item),
      descEl: this.detailEl,
      scrollEl: this.listHost,
      onConfirm: (item) => this.choose(item),
      onFocus: (item) => this.footFor(item),
      onInactiveClick: () => this.closePicker(),
    });
    if (prev) this.list.setItems(this.list.items, { id: prev });
    this.listHost.appendChild(this.list.el);
    this.picker = null;
    this.pickerKind = null;
    this.list.setActive(this.active);
    this.footFor(this.list.current);
    this.scene.renderFoot();
  }

  items(v) {
    const items = [{ heading: true, label: 'Relic Slots' }];
    for (const r of v.relics) items.push({ id: `slot${r.slot}`, kind: 'slot', slot: r.slot, relicId: r.id });
    const load = v.echoLoad;
    const cap = v.echoCapacity;
    items.push({ heading: true, html: `Echoes<span class="sl-right">${load} / ${cap} capacity</span>` });
    for (const e of v.echoes) items.push({ id: `echo_${e.id}`, kind: 'echo', relicId: e.id, echo: e });
    const opts = echoOptions(this.state, this.memberId);
    const any = opts.some((o) => !o.equipped);
    items.push({
      id: 'attune',
      kind: 'attune',
      disabled: !opts.length,
      reason: 'No mastered relics yet — win 4 battles with a relic equipped to master it.',
      any,
    });
    return items;
  }

  rowHtml(item) {
    if (item.kind === 'slot') {
      const r = item.relicId ? RELICS[item.relicId] : null;
      if (!r) return `<div class="relic-slot is-empty"><span class="rs-num"><span>${item.slot + 1}</span></span><span class="rs-main"><b>Empty slot</b><small>Choose a relic to equip</small></span></div>`;
      const d = describeRelic(r.id, this.state);
      return `<div class="relic-slot"><span class="rs-num"><span>${item.slot + 1}</span></span><span class="rs-gem">${relicIconHtml(30)}</span>
        <span class="rs-main"><b class="rarity-${r.rarity}">${escapeHtml(r.name)}</b><small>${escapeHtml(d.passiveText)}</small></span>
        ${d.mastered ? '<span class="tag t-innate">Mastered</span>' : pipsHtml(Math.min(d.battles, MASTERY_BATTLES), MASTERY_BATTLES)}</div>`;
    }
    if (item.kind === 'echo') {
      const e = item.echo;
      return `<div class="relic-slot"><span class="rs-gem"><img src="${mechanicIcon('echo', 28)}" alt=""></span>
        <span class="rs-main"><b>${escapeHtml(e.name)}</b><small>${escapeHtml(e.passiveText)}</small></span>
        ${e.suppressed ? '<span class="tag t-danger">Suppressed</span>' : ''}<span class="tag">${e.echoCost} cap</span></div>`;
    }
    return `<div class="relic-slot"><span class="rs-gem"><img src="${mechanicIcon('echo', 28)}" alt="" style="opacity:.7"></span>
      <span class="rs-main"><b>Attune an Echo…</b><small>${item.disabled ? 'Master a relic to unlock its Echo' : 'Share a mastered relic’s passive'}</small></span></div>`;
  }

  relicDetailHtml(id, { note = '' } = {}) {
    const d = describeRelic(id, this.state);
    if (!d) return '<div class="d-empty">—</div>';
    const holder = d.equippedBy ? CHARACTERS[d.equippedBy]?.name.split(' ')[0] : null;
    const echoed = d.echoedBy.map((c) => CHARACTERS[c]?.name.split(' ')[0]).filter(Boolean);
    return `<h3 class="rarity-${d.rarity}">${escapeHtml(d.name)}</h3>
      <div class="d-tags"><span class="tag t-${d.rarity}">${escapeHtml(d.rarityLabel)}</span><span class="tag">Echo cost ${d.echoCost}</span>${d.statsText ? `<span class="tag">${escapeHtml(d.statsText)}</span>` : ''}</div>
      <div class="d-short">${escapeHtml(d.passiveText)}</div>
      <div class="d-desc">${escapeHtml(d.desc)}</div>
      <div class="d-block"><div class="d-label">Mastery</div>
        <div style="display:flex;align-items:center;gap:12px">${pipsHtml(Math.min(d.battles, MASTERY_BATTLES), MASTERY_BATTLES, 'pips-lg')}<span class="muted">${escapeHtml(d.masteryText)}</span></div></div>
      <div class="d-status${holder || echoed.length ? '' : ' is-muted'}">${holder ? `Worn by ${escapeHtml(holder)}` : 'Not worn'}${echoed.length ? ` · Echoed by ${escapeHtml(echoed.join(', '))}` : ''}${note}</div>`;
  }

  detailFor(item) {
    if (!item) return '';
    if (item.kind === 'slot') {
      if (!item.relicId) return `<div class="d-empty">An empty relic slot.<br>Press ${keyCapHtml(this.game, 'confirm')} to equip one of your ${plural(Object.keys(this.state.relics ?? {}).length, 'relic')}.</div>`;
      return this.relicDetailHtml(item.relicId);
    }
    if (item.kind === 'echo') {
      return this.relicDetailHtml(item.relicId, { note: item.echo.suppressed ? ' · Suppressed: the relic itself is equipped here' : '' });
    }
    const v = partyMemberView(this.state, this.memberId);
    return `<h3>Echoes</h3><div class="d-desc">After four victories with a relic equipped, it is <b class="gold">mastered</b>: its passive becomes an Echo that any companion can attune, at its echo cost.</div>
      <div class="d-block"><div class="d-label">Capacity</div>${barHtml({ value: v.echoLoad, max: v.echoCapacity, kind: 'echo', label: '', text: `${v.echoLoad} / ${v.echoCapacity}` })}
      <p class="muted" style="margin:10px 0 0;font-size:17px">Capacity is 4 + level. An Echo whose relic is worn by the same character does not stack.</p></div>`;
  }

  footFor(item) {
    if (!item) return;
    if (item.kind === 'slot') this.setDesc(item.relicId ? `<b>${escapeHtml(RELICS[item.relicId].name)}</b> — slot ${item.slot + 1}` : `<b>Slot ${item.slot + 1}</b> — empty`);
    else if (item.kind === 'echo') this.setDesc(`<b>${escapeHtml(item.echo.name)}</b> — Echo · ${item.echo.echoCost} capacity`);
    else this.setDesc('<b>Echoes</b> — mastered relics share their passive with the whole party');
  }

  choose(item) {
    if (item.kind === 'slot') this.openRelicPicker(item);
    else if (item.kind === 'echo') this.releaseEcho(item.relicId);
    else if (item.kind === 'attune') this.openEchoPicker();
  }

  releaseEcho(id) {
    const r = unequipEcho(this.state, this.memberId, id);
    if (!r.ok) {
      sfx(this.game, 'ui_error');
      toast(this.game, r.reason, { kind: 'warn' });
      return;
    }
    sfx(this.game, 'debuff', { volume: 0.6 });
    toast(this.game, `${RELICS[id].name} echo released`, { icon: mechanicIcon('echo', 24) });
    this.render();
  }

  pickerFrame(title, right) {
    this.detailEl.innerHTML = `<div class="picker-head"><span class="heading">${escapeHtml(title)}</span><span class="muted">${right}</span></div>
      <div class="scroll picker-list"></div><div class="panel-inset picker-detail"></div>`;
    return { host: this.detailEl.querySelector('.picker-list'), detail: this.detailEl.querySelector('.picker-detail') };
  }

  openRelicPicker(slotItem) {
    const inv = relicInventory(this.state);
    const { host, detail } = this.pickerFrame(`Slot ${slotItem.slot + 1}`, `${inv.length} owned`);
    const items = [];
    if (slotItem.relicId) items.push({ id: '__remove', label: 'Remove relic', remove: true });
    for (const d of inv) {
      const here = d.equippedBy === this.memberId && getMember(this.state, this.memberId).relics[slotItem.slot] === d.id;
      items.push({ id: d.id, relic: d, here });
    }
    const picker = new MenuList(this.game, {
      className: 'menu-body',
      items,
      scrollEl: host,
      index: Math.max(0, items.findIndex((it) => it.here)),
      render: (it) => {
        if (it.remove) return '<div class="relic-slot is-empty"><span class="rs-main"><b>Remove relic</b><small>Leave this slot empty</small></span></div>';
        const d = it.relic;
        const holder = d.equippedBy;
        const holderHtml = holder ? `<img class="mini-portrait" src="${portrait(CHARACTERS[holder].look, 64)}" alt="" data-tip="Worn by ${escapeHtml(CHARACTERS[holder].name)}">` : '';
        return `<div class="relic-slot"><span class="rs-gem">${relicIconHtml(28)}</span>
          <span class="rs-main"><b class="rarity-${d.rarity}">${escapeHtml(d.name)}</b><small>${escapeHtml(d.passiveText)}</small></span>
          ${it.here ? '<span class="tag t-learned">Here</span>' : ''}${holderHtml}
          ${d.mastered ? '<span class="tag t-innate">Mastered</span>' : pipsHtml(Math.min(d.battles, MASTERY_BATTLES), MASTERY_BATTLES)}</div>`;
      },
      describe: (it) => (it.remove ? '<div class="d-desc muted">The relic returns to your satchel.</div>' : `<div class="d-short">${escapeHtml(it.relic.statsText || 'No stat bonus')}</div><div class="d-desc">${escapeHtml(it.relic.desc)}</div>`),
      descEl: detail,
      onConfirm: (it) => this.equip(slotItem.slot, it),
      onCancel: () => this.closePicker(),
    });
    host.appendChild(picker.el);
    this.picker = picker;
    this.pickerKind = 'relic';
    this.scene.focus.push(picker);
    this.scene.renderFoot();
  }

  equip(slot, it) {
    const id = this.memberId;
    if (it.here) {
      this.closePicker();
      return;
    }
    const r = equipRelic(this.state, id, slot, it.remove ? null : it.id);
    if (!r.ok) {
      sfx(this.game, 'ui_error');
      toast(this.game, r.reason, { kind: 'warn' });
      return;
    }
    const who = CHARACTERS[id].name.split(' ')[0];
    if (it.remove) toast(this.game, `Slot ${slot + 1} emptied`, {});
    else {
      const from = r.movedFrom ? ` (taken from ${CHARACTERS[r.movedFrom].name.split(' ')[0]})` : '';
      toast(this.game, `${who} equips ${RELICS[it.id].name}${from}`, { kind: 'gold', icon: mechanicIcon('relic', 24) });
    }
    sfx(this.game, it.remove ? 'ui_cancel' : 'buff');
    this.closePicker(false);
  }

  openEchoPicker() {
    const opts = echoOptions(this.state, this.memberId);
    const m = getMember(this.state, this.memberId);
    const cap = echoCapacity(m.level);
    const load = echoLoad(m);
    const { host, detail } = this.pickerFrame('Attune an Echo', `${load} / ${cap} capacity`);
    const meter = (extra = 0, over = false) => `<div class="d-label">Capacity after</div>${barHtml({ value: load, max: cap, kind: 'echo', preview: Math.min(cap, load + extra), text: `${load + extra} / ${cap}`, cls: over ? 'is-over' : '' })}`;
    const picker = new MenuList(this.game, {
      className: 'menu-body',
      items: opts.map((o) => ({ id: o.id, opt: o, disabled: !o.equipped && !o.canEquip, reason: o.reason })),
      scrollEl: host,
      render: (it) => {
        const o = it.opt;
        return `<div class="relic-slot"><span class="rs-gem"><img src="${mechanicIcon('echo', 28)}" alt=""></span>
          <span class="rs-main"><b>${escapeHtml(o.name)}</b><small>${escapeHtml(o.passiveText)}</small></span>
          ${o.equipped ? `<span class="tag t-learned">${o.suppressed ? 'Attuned · suppressed' : 'Attuned'}</span>` : ''}${pipsHtml(o.echoCost, o.echoCost)}</div>`;
      },
      describe: (it) => {
        const o = it.opt;
        const extra = o.equipped ? -o.echoCost : o.echoCost;
        const over = !o.equipped && load + o.echoCost > cap;
        const wornHere = (m.relics ?? []).includes(o.id);
        const note = wornHere ? `<div class="d-desc bad" style="font-size:17px">${escapeHtml(CHARACTERS[m.id].name.split(' ')[0])} already wears this relic — its Echo would not stack.</div>` : '';
        return `${meter(extra, over)}<div class="d-desc" style="margin-top:8px">${o.equipped ? 'Press to release this Echo.' : o.reason ? escapeHtml(o.reason) : `Attune for ${o.echoCost} capacity.`}</div>${note}`;
      },
      descEl: detail,
      onConfirm: (it) => this.toggleEcho(it.opt),
      onCancel: () => this.closePicker(),
      emptyText: 'No mastered relics yet.',
    });
    host.appendChild(picker.el);
    this.picker = picker;
    this.pickerKind = 'echo';
    this.scene.focus.push(picker);
    this.scene.renderFoot();
  }

  toggleEcho(o) {
    const id = this.memberId;
    const r = o.equipped ? unequipEcho(this.state, id, o.id) : equipEcho(this.state, id, o.id);
    if (!r.ok) {
      sfx(this.game, 'ui_error');
      toast(this.game, r.reason, { kind: 'warn' });
      return;
    }
    sfx(this.game, o.equipped ? 'debuff' : 'buff', { volume: 0.8 });
    toast(this.game, o.equipped ? `${o.name} echo released` : `${CHARACTERS[id].name.split(' ')[0]} attunes the ${o.name} echo`, { kind: o.equipped ? 'info' : 'gold', icon: mechanicIcon('echo', 24) });
    this.closePicker(false);
  }

  closePicker(sound = true) {
    if (!this.picker) return;
    this.scene.focus.remove(this.picker);
    this.picker = null;
    this.pickerKind = null;
    if (sound) sfx(this.game, 'ui_cancel');
    this.render();
  }

  setActive(v) {
    super.setActive(v);
    this.list?.setActive(v);
  }

  update(dt) {
    if (this.memberKeys()) return true;
    return this.list?.update(dt) ?? false;
  }
}

// ================================================================================================ items

class ItemsPane extends Pane {
  hints() {
    if (this.picker) return [['nav-v', 'Member'], ['confirm', 'Use'], ['cancel', 'Back']];
    return [['nav-v', 'Select'], ['confirm', 'Use'], ['cancel', 'Close']];
  }

  render() {
    this.el.innerHTML = `<div class="split split-full"><div class="panel-inset list-box item-list"></div><div class="panel-inset detail item-detail"></div></div>`;
    const host = this.el.querySelector('.item-list');
    this.detailEl = this.el.querySelector('.item-detail');
    const prev = this.list?.current?.id;
    const items = [{ heading: true, label: 'Consumables' }, ...ITEM_ORDER.map((id) => ({ id, def: ITEMS[id] }))];
    this.list = new MenuList(this.game, {
      className: 'menu-body',
      items,
      render: (it) => this.rowHtml(it),
      describe: (it) => this.detailHtml(it),
      descEl: this.detailEl,
      onConfirm: (it) => this.use(it),
      onFocus: (it) => this.setDesc(`<b>${escapeHtml(it.def.name)}</b> — ${it.def.fieldUse ? 'usable here or in battle' : 'battle only'}`),
      onInactiveClick: () => this.closePicker(),
    });
    if (prev) this.list.setItems(items, { id: prev });
    host.appendChild(this.list.el);
    this.picker = null;
    this.list.setActive(this.active);
    const cur = this.list.current;
    if (cur?.def) this.setDesc(`<b>${escapeHtml(cur.def.name)}</b> — ${cur.def.fieldUse ? 'usable here or in battle' : 'battle only'}`);
    this.scene.renderFoot();
  }

  rowHtml(it) {
    const inv = this.state.items?.[it.id] ?? { count: 0, max: 0 };
    return `<div class="item-row"><img src="${itemIcon(it.id, 38)}" alt="">
      <span class="ir-name">${escapeHtml(it.def.name)}</span>
      ${pipsHtml(inv.count, inv.max)}<span class="ir-count">${inv.count}/${inv.max}</span>
      <span class="tag${it.def.fieldUse ? '' : ' t-locked'}">${it.def.fieldUse ? 'Field' : 'Battle'}</span></div>`;
  }

  detailHtml(it) {
    const inv = this.state.items?.[it.id] ?? { count: 0, max: 0 };
    const shards = Math.max(0, inv.max - it.def.baseMax);
    const shardName = Object.values(UPGRADES).find((u) => u.item === it.id)?.name ?? 'shard';
    return `<div class="item-big"><img src="${itemIcon(it.id, 72)}" alt=""><div><h3>${escapeHtml(it.def.name)}</h3>
      <div class="d-tags" style="margin-top:8px"><span class="tag">${inv.count} / ${inv.max} charges</span><span class="tag${it.def.fieldUse ? ' t-learned' : ' t-locked'}">${it.def.fieldUse ? 'Usable in the field' : 'Battle only'}</span></div></div></div>
      <div class="d-desc">${escapeHtml(it.def.desc)}</div>
      <div class="d-block muted" style="font-size:17px">Charges refill whenever you rest at an Expedition Pennant.${shards ? ` Maximum raised by ${plural(shards, shardName)}.` : ` Find or buy ${escapeHtml(shardName)}s to carry more.`}</div>
      <div class="member-pick-host"></div>`;
  }

  use(it) {
    if (!it.def.fieldUse) {
      sfx(this.game, 'ui_error');
      toast(this.game, `${it.def.name} can only be used in battle.`, { kind: 'warn' });
      return;
    }
    const inv = this.state.items?.[it.id];
    if (!inv || inv.count <= 0) {
      sfx(this.game, 'ui_error');
      toast(this.game, `No ${it.def.name} left — rest at a pennant to refill.`, { kind: 'warn' });
      return;
    }
    this.openPicker(it);
  }

  openPicker(it) {
    const host = this.detailEl.querySelector('.member-pick-host');
    host.innerHTML = '<div class="d-label" style="margin-top:6px">Use on…</div>';
    const picker = new MenuList(this.game, {
      className: 'member-pick',
      items: PARTY_ORDER.map((id) => {
        const chk = canUseItemOutOfBattle(this.state, it.id, id);
        return { id, disabled: !chk.ok, reason: chk.reason };
      }),
      render: (m) => {
        const v = partyMemberView(this.state, m.id);
        return `<div class="mp-row">${portraitHtml(v.look, 96)}<div class="mp-main"><b>${escapeHtml(v.name)}</b>${barHtml({ value: v.hp, max: v.maxHp, kind: 'hp', label: 'HP' })}</div>${m.disabled ? `<span class="tag t-locked">${escapeHtml(m.reason ?? '')}</span>` : ''}</div>`;
      },
      onConfirm: (m) => this.apply(it, m.id),
      onCancel: () => this.closePicker(),
    });
    host.appendChild(picker.el);
    this.picker = picker;
    this.scene.focus.push(picker);
    this.scene.renderFoot();
  }

  apply(it, charId) {
    const r = useItemOutOfBattle(this.state, it.id, charId);
    if (!r.ok) {
      sfx(this.game, 'ui_error');
      toast(this.game, r.reason, { kind: 'warn' });
      return;
    }
    const who = CHARACTERS[charId].name.split(' ')[0];
    sfx(this.game, it.id === 'tonic' ? 'revive' : 'heal');
    toast(this.game, it.id === 'tonic' ? `${who} is back on their feet (+${r.amount} HP)` : `${who} recovers ${r.amount} HP`, { kind: 'good', icon: itemIcon(it.id, 24) });
    this.closePicker(false);
  }

  closePicker(sound = true) {
    if (!this.picker) return;
    this.scene.focus.remove(this.picker);
    this.picker = null;
    if (sound) sfx(this.game, 'ui_cancel');
    this.render();
  }

  setActive(v) {
    super.setActive(v);
    this.list?.setActive(v);
  }

  update(dt) {
    return this.list?.update(dt) ?? false;
  }
}

// ================================================================================================ journal & bestiary

/**
 * Bestiary knowledge, from the record the battle scene keeps in state.world.bestiary ({id: true | count}): a foe is
 * known — name, portrait, affinities, weak points — once the party has fought it (won, lost or fled), exactly when
 * the in-battle target panel reveals its affinities too. The record only grows (the game-over screen carries it
 * into the reloaded journal), so an entry never disappears. Foes not yet met are listed as silhouettes.
 * @param {object} state
 * @returns {Array<{id:string, def:object, known:boolean, count:number|null}>}
 */
export function bestiaryEntries(state) {
  const w = state?.world ?? {};
  const record = w.bestiary && typeof w.bestiary === 'object' ? w.bestiary : {};
  const out = [];
  for (const e of Object.values(ENEMIES)) {
    const r = record[e.id];
    let count = null;
    if (typeof r === 'number') count = r;
    else if (r && typeof r === 'object' && Number.isFinite(r.defeated)) count = r.defeated;
    out.push({ id: e.id, def: e, known: !!r, count });
  }
  out.sort((a, b) => ZONE_ORDER.indexOf(a.def.zone) - ZONE_ORDER.indexOf(b.def.zone) || (a.def.boss ? 1 : 0) - (b.def.boss ? 1 : 0) || a.def.level - b.def.level);
  return out;
}

const WEAK_EFFECT = { crit: 'Guaranteed critical', break: 'Heavy break', shield: 'Strips shields' };

class JournalPane extends Pane {
  constructor(scene) {
    super(scene);
    this.sub = scene.journalSub ?? 'journals';
  }

  hints() {
    return [['nav-h', this.sub === 'journals' ? 'Bestiary' : 'Journals'], ['nav-v', 'Select'], ['cancel', 'Close']];
  }

  render() {
    const found = JOURNAL_IDS.filter((id) => this.state.world?.journals?.[id]).length;
    const beasts = bestiaryEntries(this.state);
    const known = beasts.filter((b) => b.known).length;
    this.el.innerHTML = `<div class="member-strip"><div class="subtabs">
        <span class="subtab${this.sub === 'journals' ? ' is-active' : ''}" data-sub="journals">Journals · ${found}/${JOURNAL_IDS.length}</span>
        <span class="subtab${this.sub === 'bestiary' ? ' is-active' : ''}" data-sub="bestiary">Bestiary · ${known}/${beasts.length}</span>
      </div><div class="ms-right">${deviceOf(this.game) === 'touch' ? '' : `<span class="ms-keys">${keyCapHtml(this.game, 'left')}${keyCapHtml(this.game, 'right')}</span>`}</div></div>
      <div class="split split-wide-left"><div class="panel-inset list-box scroll journal-list"></div><div class="journal-view"></div></div>`;
    for (const s of this.el.querySelectorAll('[data-sub]')) clickable(s, () => this.setSub(s.dataset.sub));
    const host = this.el.querySelector('.journal-list');
    this.view = this.el.querySelector('.journal-view');
    const items = this.sub === 'journals' ? this.journalItems() : this.beastItems(beasts);
    this.list = new MenuList(this.game, {
      className: 'menu-body',
      items,
      scrollEl: host,
      index: 1,
      render: (it) => (this.sub === 'journals' ? this.journalRow(it) : this.beastRow(it)),
      describe: (it) => (this.sub === 'journals' ? this.journalPage(it) : this.beastPage(it)),
      descEl: this.view,
      onConfirm: () => {},
      onFocus: (it) => this.setDesc(it.known ? `<b>${escapeHtml(it.title)}</b>` : '<span class="faint">Undiscovered</span>'),
    });
    host.appendChild(this.list.el);
    this.list.setActive(this.active);
    const cur = this.list.current;
    if (cur) this.setDesc(cur.known ? `<b>${escapeHtml(cur.title)}</b>` : '<span class="faint">Undiscovered</span>');
    this.scene.renderFoot();
  }

  setSub(sub) {
    if (sub === this.sub) return;
    this.sub = sub;
    this.scene.journalSub = sub;
    sfx(this.game, 'ui_move', { pitch: 1.1 });
    this.render();
  }

  journalItems() {
    const items = [];
    let zone = null;
    for (const id of JOURNAL_IDS) {
      const j = STORY.journals[id];
      if (!j) continue;
      if (j.zone !== zone) {
        zone = j.zone;
        items.push({ heading: true, label: zoneName(zone) });
      }
      const known = !!this.state.world?.journals?.[id];
      items.push({ id, j, known, title: j.title, className: known ? '' : 'is-locked', sound: false });
    }
    return items;
  }

  journalRow(it) {
    if (!it.known) return `<div class="skill-row"><img src="${mechanicIcon('relic', 26)}" alt="" style="opacity:.25;filter:grayscale(1)"><span class="sr-name"><span class="unknown">Undiscovered page</span><small>${escapeHtml(zoneName(it.j.zone))}</small></span></div>`;
    return `<div class="skill-row"><img src="${mechanicIcon('relic', 26)}" alt=""><span class="sr-name">${escapeHtml(it.j.title)}<small>${escapeHtml(it.j.author ?? '')}</small></span></div>`;
  }

  journalPage(it) {
    if (!it.known) {
      return `<div class="parchment journal-page" style="height:100%"><div class="jp-zone">${escapeHtml(zoneName(it.j.zone))}</div>
        <div class="jp-locked">This page has not yet been found.<br>Somewhere on ${escapeHtml(zoneName(it.j.zone))}, it is waiting for you.</div></div>`;
    }
    return `<div class="parchment journal-page" style="height:100%"><div class="jp-zone">${escapeHtml(zoneName(it.j.zone))}</div>
      <h3>${escapeHtml(it.j.title)}</h3><div class="jp-author">${escapeHtml(it.j.author ?? '')}</div><div class="jp-rule"></div>
      <div class="jp-text">${escapeHtml(it.j.text)}</div></div>`;
  }

  beastItems(beasts) {
    const items = [];
    let zone = null;
    for (const b of beasts) {
      if (b.def.zone !== zone) {
        zone = b.def.zone;
        items.push({ heading: true, label: zoneName(zone) });
      }
      items.push({ id: b.id, b, known: b.known, title: b.def.name, className: b.known ? '' : 'is-locked' });
    }
    return items;
  }

  beastRow(it) {
    if (!it.known) return `<div class="skill-row">${silhouetteHtml(it.b.def.look, 64, 'sr-portrait')}<span class="sr-name"><span class="unknown">???</span><small>${it.b.def.boss ? 'A great foe' : 'Not yet encountered'}</small></span></div>`;
    const d = it.b.def;
    return `<div class="skill-row"><img class="portrait" style="width:30px;height:30px" src="${portrait(d.look, 64)}" alt="">
      <span class="sr-name">${escapeHtml(d.name)}<small>Level ${d.level}${d.boss ? ' · Boss' : ''}</small></span>${it.b.count ? `<span class="tag">×${it.b.count}</span>` : ''}</div>`;
  }

  beastPage(it) {
    if (!it.known) {
      return `<div class="panel-inset detail beast-unknown" style="height:100%">${silhouetteHtml(it.b.def.look, 280)}
        <h3>???</h3><div class="d-empty">${it.b.def.boss ? 'A great foe waits further on.' : 'Not yet encountered.'}<br>Fight it once to learn its weaknesses.</div></div>`;
    }
    const d = it.b.def;
    const groups = { weak: [], resist: [], immune: [] };
    for (const [elId, mult] of Object.entries(d.affinities ?? {})) {
      const chip = `<span class="tag"><img src="${elementIcon(elId, 15)}" alt="">${escapeHtml(elementName(elId))} ×${mult}</span>`;
      if (mult === 0) groups.immune.push(chip);
      else if (mult > 1) groups.weak.push(chip);
      else groups.resist.push(chip);
    }
    const weakPts = (d.weakPoints ?? []).map((w) => `<span class="tag">${escapeHtml(titleCaseId(w.id))} · ${escapeHtml(WEAK_EFFECT[w.effect] ?? w.effect)}</span>`).join('');
    const resists = (d.statusResist ?? []).map((s) => `<span class="tag"><img src="${statusIcon(s, 15)}" alt="">${escapeHtml(STATUS_DEFS[s]?.name ?? s)}</span>`).join('');
    const aff = (k, label) => (groups[k].length ? `<span class="aff-k">${label}</span><span class="aff-v">${groups[k].join('')}</span>` : '');
    return `<div class="panel-inset detail" style="height:100%">
      <div class="beast-head">${portraitHtml(d.look, 208)}<div><h3>${escapeHtml(d.name)}</h3><p>${escapeHtml(zoneName(d.zone))} · Level ${d.level}${d.boss ? ' · Boss' : ''}${it.b.count ? ` · Defeated ×${it.b.count}` : ''}</p>
        ${d.shields ? `<p>${plural(d.shields, 'shield')} · Break ${d.breakMax}</p>` : `<p>Break gauge ${d.breakMax}</p>`}</div></div>
      <div class="d-block aff-grid">${aff('weak', 'Weak')}${aff('resist', 'Resists')}${aff('immune', 'Immune')}
        ${weakPts ? `<span class="aff-k">Weak points</span><span class="aff-v">${weakPts}</span>` : ''}
        ${resists ? `<span class="aff-k">Unshaken by</span><span class="aff-v">${resists}</span>` : ''}</div>
      <div class="d-desc">${escapeHtml(d.bio ?? '')}</div></div>`;
  }

  setActive(v) {
    super.setActive(v);
    this.list?.setActive(v);
  }

  update(dt) {
    const input = this.game.input;
    if (input.pressed('left') || input.pressed('right')) {
      input.consume(['left', 'right']);
      this.setSub(this.sub === 'journals' ? 'bestiary' : 'journals');
      return true;
    }
    return this.list?.update(dt) ?? false;
  }
}

// ================================================================================================ system

class SystemPane extends Pane {
  hints() {
    return [['nav-v', 'Select'], ['confirm', 'Choose'], ['cancel', 'Close']];
  }

  render() {
    const st = this.state.stats ?? {};
    const rec = (v, label) => `<div class="panel-inset record"><b>${v}</b><span>${label}</span></div>`;
    this.el.innerHTML = `<div class="section-label">Expedition Records</div>
      <div class="records">
        ${rec(formatPlayTime(st.playTimeMs ?? 0), 'Time on the road')}
        ${rec(`${formatInt(st.victories ?? 0)}<small class="muted" style="font-size:16px"> / ${formatInt(st.battles ?? 0)}</small>`, 'Battles won')}
        ${rec(formatInt(st.parries ?? 0), 'Parries')}
        ${rec(formatInt(st.perfectDodges ?? 0), 'Perfect dodges')}
        ${rec(formatInt(st.perfects ?? 0), 'Perfect strikes')}
        ${rec(formatInt(st.gradientCounters ?? 0), 'Prism counters')}
        ${rec(formatInt(st.jumps ?? 0), 'Waves leapt')}
        ${rec(formatInt(st.deaths ?? 0), 'Times fallen')}
      </div><div class="system-host"></div>`;
    this.list = new MenuList(this.game, {
      className: 'system-menu',
      items: [
        { id: 'resume', label: 'Resume', sub: 'Return to the expedition' },
        { id: 'settings', label: 'Settings', sub: 'Difficulty, audio, timing & controls' },
        { id: 'quit', label: 'Quit to Title', sub: 'Unsaved progress since your last pennant is lost' },
      ],
      onConfirm: (it) => this.choose(it.id),
      onFocus: (it) => this.setDesc(`<b>${escapeHtml(it.label)}</b> — ${escapeHtml(it.sub)}`),
    });
    this.el.querySelector('.system-host').appendChild(this.list.el);
    this.list.setActive(this.active);
    this.setDesc('<b>Resume</b> — return to the expedition');
    this.scene.renderFoot();
  }

  async choose(id) {
    if (id === 'resume') this.scene.close();
    else if (id === 'settings') this.game.scenes.push('settings', { from: 'pause' });
    else if (id === 'quit') {
      const ok = await confirmDialog(this.scene, {
        title: 'Quit to Title?',
        text: 'Your journal holds everything up to your last rest at an Expedition Pennant. Anything since will be lost.',
        confirmLabel: 'Quit',
        cancelLabel: 'Stay',
        danger: true,
      });
      if (!ok) return;
      this.scene.focus.clear();
      this.game.audio?.stopMusic?.({ fade: 700 });
      await this.game.fade(600, () => this.game.scenes.reset('title', {}), 600);
    }
  }

  setActive(v) {
    super.setActive(v);
    this.list?.setActive(v);
  }

  update(dt) {
    return this.list?.update(dt) ?? false;
  }
}

const PANES = { party: PartyPane, skills: SkillsPane, relics: RelicsPane, items: ItemsPane, journal: JournalPane, system: SystemPane };
const TAB_DEFS = [
  { id: 'party', label: 'Party', icon: 'ap' },
  { id: 'skills', label: 'Skills', icon: 'surge' },
  { id: 'relics', label: 'Relics & Echoes', icon: 'relic' },
  { id: 'items', label: 'Items', icon: null },
  { id: 'journal', label: 'Journal', icon: null },
  { id: 'system', label: 'System', icon: null },
];

// ================================================================================================ scene

export class PauseScene extends UIScene {
  constructor(game) {
    super(game);
    this.transparent = true;
    this.memberIndex = 0;
    this.pane = null;
  }

  enter(params = {}) {
    const state = this.game.state;
    this.root = this.mountRoot('pause-screen');
    if (!state) {
      console.warn('[pause] no game state — closing');
      this.later(0, () => this.close());
      return;
    }
    const mi = PARTY_ORDER.indexOf(params.member);
    this.memberIndex = mi >= 0 ? mi : 0;
    this.root.innerHTML = `
      <div class="backdrop"></div>
      <div class="panel pause-frame"><div class="pf-inner">
        <div class="pause-head">
          <div class="pause-crest"><i></i><div><b>EXPEDITION 69</b><span class="pause-zone"></span></div></div>
          <div class="pause-tabs"></div>
          <div class="pause-purse"></div>
        </div>
        <div class="pause-body"></div>
        <div class="pause-foot"><div class="pause-desc"></div><div class="hint-bar"></div></div>
      </div></div>`;
    this.root.querySelector('.backdrop').addEventListener('click', () => this.close());
    this.bodyEl = this.root.querySelector('.pause-body');
    this.descEl = this.root.querySelector('.pause-desc');
    this.hintsEl = this.root.querySelector('.pause-foot .hint-bar');
    this.root.querySelector('.pause-zone').textContent = zoneName(state.world?.zone);
    const tabs = TAB_DEFS.map((t) => ({ id: t.id, label: t.label }));
    const start = Math.max(0, TAB_DEFS.findIndex((t) => t.id === params.tab));
    this.tabs = new Tabs(this.game, { tabs, index: start, onChange: (t) => this.showTab(t.id) });
    this.root.querySelector('.pause-tabs').replaceWith(this.tabs.el);
    this.tooltip = new Tooltip(this).attach(this.root);
    this.renderPurse();
    this.refreshBadges();
    this.showTab(TAB_DEFS[start].id);
    // Turning a phone or resizing the window can switch the compact layout (e.g. one party card vs three).
    this.compact = isCompact(this.game);
    this.listen(this.game.events, 'resize', () => {
      if (isCompact(this.game) === this.compact) return;
      this.compact = !this.compact;
      this.pane?.render();
    });
    this.sfx('menu_open');
  }

  renderPurse() {
    const el0 = this.root.querySelector('.pause-purse');
    if (el0) el0.innerHTML = `<img src="${mechanicIcon('glint', 24)}" alt="">${formatInt(this.game.state?.glint ?? 0)}<small>GLINT</small>`;
  }

  refreshBadges() {
    const st = this.game.state;
    if (!st || !this.tabs) return;
    const pts = st.party.reduce((s, m) => s + (m.attrPoints || 0), 0);
    const learnable = PARTY_ORDER.reduce((s, id) => s + skillsFor(st, id).filter((x) => x.status === 'learnable').length, 0);
    this.tabs.setBadge('party', pts ? String(pts) : '');
    this.tabs.setBadge('skills', learnable ? String(learnable) : '');
  }

  setDesc(html) {
    if (this.descEl) this.descEl.innerHTML = html ?? '';
  }

  renderFoot() {
    if (!this.hintsEl || !this.pane) return;
    // (On touch the tabs are simply tapped: no key hints at all, like hintsHtml.)
    const atTop = this.focus.top === this.pane && !this.pane.alloc && this.game.input?.lastDevice !== 'touch';
    const tabHint = atTop ? `<span class="hint">${keyCapHtml(this.game, 'dodge')}${keyCapHtml(this.game, 'parry')}<em>Tabs</em></span>` : '';
    this.hintsEl.innerHTML = tabHint + hintsHtml(this.game, this.pane.hints());
  }

  showTab(id) {
    const Pane = PANES[id] ?? PartyPane;
    // drop pickers of the previous pane
    this.focus.clear();
    this.pane?.unmount();
    this.pane = new Pane(this);
    this.pane.mount(this.bodyEl);
    this.focus.set(this.pane);
    this.tooltip?.hide();
    this.renderFoot();
  }

  onDeviceChange() {
    super.onDeviceChange();
    this.tabs?._render();
    this.pane?.render();
    this.renderFoot();
  }

  resume(result) {
    super.resume(result);
    this.pane?.render();
    this.renderPurse();
    this.refreshBadges();
    this.renderFoot();
  }

  close() {
    if (this._closing) return;
    this._closing = true;
    this.sfx('ui_cancel');
    if (this.game.scenes.top === this) this.game.scenes.pop({ closed: true });
  }

  update(dt) {
    this.time += dt;
    if (!this.pane || this._closing) return;
    const input = this.game.input;
    const top = this.focus.top;
    if (top !== this.pane) {
      this.focus.update(dt);
      this.renderFootIfChanged();
      return;
    }
    if (input.pressed('menu') && !input.pressed('cancel')) {
      input.consume(['menu']);
      this.close();
      return;
    }
    if (!this.pane.alloc && this.tabs.update()) return;
    const handled = this.pane.update(dt);
    if (!handled && input.pressed('cancel')) {
      input.consume(['cancel', 'menu']);
      this.close();
      return;
    }
    this.renderFootIfChanged();
  }

  renderFootIfChanged() {
    const key = `${this.focus.stack.length}|${this.pane?.alloc ? 1 : 0}|${this.pane?.row ?? ''}`;
    if (key !== this._footKey) {
      this._footKey = key;
      this.renderFoot();
    }
  }
}
