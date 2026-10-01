// Title screen (registry 'title'): painted key art with pointer parallax and drifting motes, the EXPEDITION 69
// logo, a "press any key" gate (unlocks audio), and the main menu — Continue, New Game (overwrite confirm +
// difficulty pick), Training Grounds (practice bout at level 5), Settings and Credits.

import { UIScene, MenuList, el, confirmDialog, choiceDialog, toast, anyInputPressed } from './widgets.js';
import { escapeHtml, zoneName, formatPlayTime, hintsHtml, DIFFICULTY_INFO, difficultyFacts } from './text.js';

export { DIFFICULTY_INFO };
import { drawTitleBackground, prepareTitleBackground } from '../render/backgrounds.js';
import { DIFFICULTY } from '../battle/qte.js';
import {
  createNewGame, saveGame, loadGame, hasSave, autoAllocate, skillsFor, learnSkill,
} from '../game/gameState.js';
import { grantXp, totalXpForLevel, derivedStats } from '../game/progression.js';

/** Build a practice-ready party: a fresh expedition raised to `level`, points auto-allocated, skills learned. */
export function makeTrainingState(level = 5) {
  const st = createNewGame();
  const need = totalXpForLevel(level);
  for (const m of st.party) {
    grantXp(m, need);
    autoAllocate(st, m.id);
    for (let guard = 0; guard < 12; guard++) {
      const next = skillsFor(st, m.id).find((s) => s.status === 'learnable');
      if (!next || !learnSkill(st, m.id, next.id).ok) break;
    }
    m.hp = derivedStats(m).maxHp;
    m.alive = true;
  }
  return st;
}

/** One-line summary of a saved expedition for the Continue entry. */
export function saveSummary(state) {
  if (!state) return '';
  const lv = Math.round(state.party.reduce((s, m) => s + (m.level || 1), 0) / Math.max(1, state.party.length));
  return `${zoneName(state.world?.zone)} · Lv ${lv} · ${formatPlayTime(state.stats?.playTimeMs ?? 0)}`;
}

/** How long after the gate opens a click still belongs to the press that opened it (ms). */
const GATE_CLICK_MS = 800;

const MOTES = Array.from({ length: 46 }, (_, i) => {
  const h = (k) => {
    const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: h(1) * 1400 - 60, y: h(2) * 760, vx: 4 + h(3) * 10, vy: 6 + h(4) * 14, r: 0.8 + h(5) * 2.2, a: 0.25 + h(6) * 0.55, ph: h(7) * 6.28 };
});

export class TitleScene extends UIScene {
  constructor(game) {
    super(game);
    this.open = false;
    this.px = 0;
    this.py = 0;
    this.prevState = null;
  }

  enter() {
    this.game.state = null;
    try {
      prepareTitleBackground({ scale: this.game.pixelRatio });
    } catch (err) {
      console.warn('[title] prepare background failed', err);
    }
    this.game.audio?.playMusic?.('title', { fade: 1200 });
    let coarse = false;
    try {
      coarse = !!globalThis.matchMedia?.('(pointer: coarse)')?.matches;
    } catch {
      /* no media queries */
    }
    const root = this.mountRoot('title-screen');
    root.innerHTML = `
      <div class="title-shade"></div>
      <div class="title-logo">
        <div class="logo-eyebrow">A Tale of the Endless Dusk</div>
        <span class="logo-word">Expedition</span>
        <div class="logo-num-wrap"><i class="logo-swash"></i><span class="logo-num">69</span></div>
        <div class="logo-sub"><span>The Sun has stopped.</span><span>Sixty-eight expeditions have failed.</span></div>
      </div>
      <div class="title-gate"><span>${coarse ? 'Tap to begin' : 'Press any key'}</span></div>
      <div class="title-menu-wrap"></div>
      <div class="title-foot"><b>v1.0</b>An original game · combat mechanics inspired by <i>Clair Obscur: Expedition 33</i></div>
      <div class="title-hints hint-bar"></div>`;
    this.menuWrap = root.querySelector('.title-menu-wrap');
    this.hintsEl = root.querySelector('.title-hints');
    this.menu = new MenuList(this.game, {
      className: 'title-menu',
      items: this._items(),
      onConfirm: (item) => this._choose(item.id),
    });
    this.menuWrap.appendChild(this.menu.el);
    this._renderHints();
    // Skip the gate when audio is already unlocked (e.g. returning from the game).
    if (this.game.audio?.unlocked || this.game.params?.get('gate') === '0') this._openMenu(false);
  }

  _items() {
    const saved = loadGame();
    const items = [];
    if (saved) items.push({ id: 'continue', label: 'Continue', sub: saveSummary(saved) });
    items.push({ id: 'new', label: 'New Game' });
    items.push({ id: 'training', label: 'Training Grounds' });
    items.push({ id: 'settings', label: 'Settings' });
    items.push({ id: 'credits', label: 'Credits' });
    return items;
  }

  _renderHints() {
    this.hintsEl.innerHTML = hintsHtml(this.game, [['nav-v', 'Select'], ['confirm', 'Confirm']]);
  }

  onDeviceChange() {
    super.onDeviceChange();
    this._renderHints();
  }

  /**
   * A tap on the gate must not also choose the menu entry that fades in under the finger: the browser sends the
   * tap's click after the finger lifts, by which time the menu takes pointer events. Swallow that one click.
   */
  _swallowGateClick() {
    const root = this.root;
    if (!root?.addEventListener) return;
    const until = (globalThis.performance?.now() ?? 0) + GATE_CLICK_MS;
    const swallow = (e) => {
      root.removeEventListener('click', swallow, true);
      if ((globalThis.performance?.now() ?? 0) > until) return;
      e.preventDefault();
      e.stopPropagation();
    };
    root.addEventListener('click', swallow, true);
  }

  _openMenu(sound = true) {
    if (this.open) return;
    this.open = true;
    this.root.classList.add('is-open');
    this.focus.set(this.menu);
    if (sound) this.sfx('menu_open');
  }

  async _choose(id) {
    const game = this.game;
    if (id === 'continue') {
      const st = loadGame();
      if (!st) {
        toast(game, 'The expedition journal could not be read.', { kind: 'warn' });
        this.menu.setItems(this._items());
        return;
      }
      this.focus.clear();
      await game.fade(650, () => {
        game.state = st;
        game.scenes.reset('world', {});
      }, 700);
      return;
    }
    if (id === 'new') {
      if (hasSave()) {
        const ok = await confirmDialog(this, {
          title: 'Begin Anew?',
          text: 'A new expedition will overwrite your current journal. What is written over cannot be read again.',
          confirmLabel: 'Overwrite',
          cancelLabel: 'Keep Journal',
          danger: true,
        });
        if (!ok) return;
      }
      const diff = await this._pickDifficulty();
      if (!diff) return;
      game.settings.difficulty = diff;
      game.saveSettings();
      this.focus.clear();
      const st = createNewGame();
      game.state = st;
      saveGame(st);
      game.audio?.stopMusic?.({ fade: 1200 });
      await game.fade(900, () => game.scenes.reset('intro', {}), 800);
      return;
    }
    if (id === 'training') {
      this._startTraining();
      return;
    }
    if (id === 'settings') {
      game.scenes.push('settings', { from: 'title' });
      return;
    }
    if (id === 'credits') this._showCredits();
  }

  _pickDifficulty() {
    const ids = Object.keys(DIFFICULTY);
    const current = ids.indexOf(this.game.settings.difficulty);
    return choiceDialog(this, {
      title: 'Choose Your Difficulty',
      html: '<span class="muted">It can be changed at any time in Settings.</span>',
      className: 'difficulty-modal',
      columns: ids.length,
      index: current >= 0 ? current : 1,
      items: ids.map((d) => ({ id: d })),
      render: (item) => {
        const def = DIFFICULTY[item.id];
        const info = DIFFICULTY_INFO[item.id] ?? { desc: '', pips: 2 };
        const pips = [1, 2, 3].map((n) => `<i class="${n <= info.pips ? 'on' : ''}"></i>`).join('');
        return `<div class="diff-emblem">${pips}</div>
          <div class="diff-name">${escapeHtml(def.name)}</div>
          <div class="diff-desc">${escapeHtml(info.desc)}</div>
          <div class="diff-stats">${difficultyFacts(def).map(([k, v]) => `${escapeHtml(k)} <b>${escapeHtml(v)}</b>`).join('<br>')}</div>
          ${item.id === this.game.settings.difficulty ? '<div class="diff-current">Current setting</div>' : '<div class="diff-current">&nbsp;</div>'}`;
      },
    });
  }

  _startTraining() {
    const game = this.game;
    const temp = makeTrainingState(5);
    this.prevState = game.state;
    game.state = temp;
    try {
      game.scenes.push('battle', {
        encounterId: 'training_dummy',
        enemies: ['dummy'],
        zone: 'training',
        ambush: null,
        boss: false,
        practice: true,
        tutorial: false,
        state: temp,
        onEnd: () => {
          if (game.state === temp) game.state = this.prevState;
        },
      });
    } catch (err) {
      console.error('[title] could not start training', err);
      game.state = this.prevState;
      toast(game, 'The training yard is closed today.', { kind: 'warn' });
    }
  }

  _showCredits() {
    const shield = el('div', { class: 'modal-shield' });
    const box = el('div', { class: 'panel modal credits-modal' });
    box.innerHTML = `
      <div class="modal-title">Credits</div>
      <div class="rule"></div>
      <div class="credits-body scroll">
        <p><b>EXPEDITION 69</b></p>
        <p class="small">An original browser role-playing game of the endless dusk.</p>
        <h4>Design, Writing &amp; Code</h4>
        <p>The Expedition 69 Workshop</p>
        <h4>Art</h4>
        <p>Every figure, sky and sea painted procedurally on canvas</p>
        <h4>Music &amp; Sound</h4>
        <p>Synthesized live in your browser with WebAudio</p>
        <h4>Typefaces</h4>
        <p>Cinzel by Natanael Gama · Cormorant Garamond by Christian Thalmann</p>
        <p class="small">Both under the SIL Open Font License</p>
        <h4>Inspiration</h4>
        <p class="attribution">An original game. Its combat mechanics are inspired by <i>Clair Obscur: Expedition 33</i>; all names, characters, story, art, audio and code are original.</p>
      </div>`;
    const actions = new MenuList(this.game, {
      className: 'modal-actions',
      horizontal: true,
      items: [{ id: 'close', label: 'Close', confirmSound: 'ui_cancel' }],
      onConfirm: () => close(),
      onCancel: () => close(),
    });
    box.appendChild(el('div', { class: 'rule plain', style: 'margin:16px 0 14px' }));
    box.appendChild(actions.el);
    shield.appendChild(box);
    shield.addEventListener('click', (e) => {
      if (e.target === shield) close();
    });
    const close = () => {
      this.focus.remove(actions);
      shield.remove();
    };
    this.root.appendChild(shield);
    this.focus.push(actions);
    this.sfx('menu_open', { volume: 0.7 });
  }

  resume(result) {
    super.resume(result);
    if (!this.game.scenes.has('world')) this.game.state = this.prevState ?? null;
    this.game.audio?.playMusic?.('title', { fade: 1200 });
    this.menu.setItems(this._items());
    this._renderHints();
  }

  update(dt) {
    this.time += dt;
    const input = this.game.input;
    if (!this.open) {
      if (anyInputPressed(input)) {
        const byPointer = !!input.pointer?.pressed;
        try {
          this.game.audio?.unlock?.();
        } catch {
          /* ignore */
        }
        input.consume();
        this._openMenu(true);
        if (byPointer) this._swallowGateClick();
      }
      return;
    }
    this.focus.update(dt);
  }

  render(ctx) {
    const game = this.game;
    const t = game.time;
    const p = game.input?.pointer;
    const tx = p?.inside ? (p.x - 640) / 36 : Math.sin(t / 5200) * 4;
    const ty = p?.inside ? (p.y - 360) / 36 : Math.cos(t / 6100) * 3;
    const k = 1 - Math.exp(-(game.dt || 16) / 380);
    this.px += (tx - this.px) * k;
    this.py += (ty - this.py) * k;
    drawTitleBackground(ctx, t, { parallax: { x: this.px, y: this.py } });

    // drifting golden motes
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of MOTES) {
      const x = ((m.x + (t / 1000) * m.vx + this.px * 2) % 1400 + 1400) % 1400 - 60;
      const y = ((m.y - (t / 1000) * m.vy + this.py * 2) % 760 + 760) % 760 - 20;
      const a = m.a * (0.55 + 0.45 * Math.sin(t / 900 + m.ph));
      const g = ctx.createRadialGradient(x, y, 0, x, y, m.r * 4);
      g.addColorStop(0, `rgba(255, 226, 160, ${a})`);
      g.addColorStop(1, 'rgba(255, 200, 120, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - m.r * 4, y - m.r * 4, m.r * 8, m.r * 8);
    }
    ctx.restore();

    // vignette
    ctx.save();
    const v = ctx.createRadialGradient(640, 330, 260, 640, 360, 820);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(6,3,8,0.62)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.restore();
  }
}
