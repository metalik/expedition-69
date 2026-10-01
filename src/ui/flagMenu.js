// Expedition Pennant overlay (registry 'flag', transparent): Rest (full heal, refill items, respawn the Gloam and
// save at once, then a warm glow + embers), Party menu, Fast travel between visited pennants, Save and Leave.

import { UIScene, MenuList, el, toast, barHtml, sfx } from './widgets.js';
import { escapeHtml, zoneName, formatInt, hintsHtml } from './text.js';
import { restAtFlag, saveGame, partyMemberView, visitFlag } from '../game/gameState.js';
import { PARTY_ORDER } from '../data/characters.js';
import { ITEMS, ITEM_ORDER } from '../data/items.js';
import { portraitDataURL } from '../render/sprites.js';
import { itemIcon } from '../render/icons.js';

const ZONE_ORDER = ['shore', 'thicket', 'spire', 'summit', 'training'];

const EMBERS = Array.from({ length: 70 }, (_, i) => {
  const h = (k) => {
    const x = Math.sin(i * 91.7 + k * 47.3) * 24634.6345;
    return x - Math.floor(x);
  };
  return { x: 60 + h(1) * 700, delay: h(2) * 1400, speed: 60 + h(3) * 120, sway: 10 + h(4) * 30, r: 1 + h(5) * 2.6, life: 1400 + h(6) * 1400 };
});

export class FlagScene extends UIScene {
  constructor(game) {
    super(game);
    this.transparent = true;
    this.restT = -1;
    this.rested = false;
  }

  enter(params = {}) {
    this.flagId = params.flagId ?? this.game.state?.world?.lastFlag?.flagId ?? 'flag';
    this.flagName = params.name ?? this.game.state?.world?.flagsVisited?.[this.flagId]?.name ?? 'Expedition Pennant';
    const root = this.mountRoot('flag-screen');
    if (!this.game.state) {
      console.warn('[flag] no game state');
      this.later(0, () => this.leave());
      return;
    }
    // Make sure this flag is recorded for fast travel even if the world forgot to.
    if (!this.game.state.world?.flagsVisited?.[this.flagId]) visitFlag(this.game.state, this.flagId, { name: this.flagName });
    root.innerHTML = `
      <div class="flag-shade"></div><div class="rest-glow"></div>
      <div class="panel flag-panel">
        <div class="flag-top"><i class="flag-emblem"></i><div><div class="eyebrow">Expedition Pennant</div><h2 style="margin-top:6px">${escapeHtml(this.flagName)}</h2><p>${escapeHtml(zoneName(this.game.state.world?.zone))}</p></div></div>
        <div class="rule"></div>
        <div class="flag-party"></div>
        <div class="flag-items"></div>
        <div class="rule plain"></div>
        <div class="flag-menu-host"></div>
        <div class="flag-desc"></div>
        <div class="hint-bar" style="justify-content:center;margin-top:6px;gap:6px 16px"></div>
      </div>`;
    this.partyEl = root.querySelector('.flag-party');
    this.itemsEl = root.querySelector('.flag-items');
    this.descEl = root.querySelector('.flag-desc');
    this.hintsEl = root.querySelector('.flag-panel .hint-bar');
    this.menu = new MenuList(this.game, {
      className: 'flag-menu',
      items: this._items(),
      describe: (it) => escapeHtml(it.desc ?? ''),
      descEl: this.descEl,
      onConfirm: (it) => this._choose(it.id),
      onCancel: () => this.leave(),
    });
    root.querySelector('.flag-menu-host').appendChild(this.menu.el);
    this.focus.set(this.menu);
    this._renderParty();
    this._renderHints();
    this.sfx('flag', { volume: 0.7 });
  }

  _items() {
    const visited = Object.keys(this.game.state?.world?.flagsVisited ?? {}).filter((id) => id !== this.flagId);
    return [
      { id: 'rest', label: 'Rest', desc: 'Heal fully and refill every item. The Gloam you have cleared will drift back. Your journal is saved.' },
      { id: 'party', label: 'Party', desc: 'Attributes, skills, relics, echoes and items.' },
      {
        id: 'travel', label: 'Fast Travel', desc: 'Journey to any Expedition Pennant you have visited.',
        disabled: !visited.length, reason: 'No other pennants visited yet — plant your hopes further ahead.',
      },
      { id: 'save', label: 'Save Journal', desc: 'Record the expedition so far without resting.' },
      { id: 'leave', label: 'Leave', desc: 'Return to the road.', confirmSound: 'ui_cancel' },
    ];
  }

  _renderHints() {
    this.hintsEl.innerHTML = hintsHtml(this.game, [['confirm', 'Choose'], ['cancel', 'Leave']]);
  }

  onDeviceChange() {
    super.onDeviceChange();
    this._renderHints();
  }

  _renderParty() {
    const st = this.game.state;
    this.partyEl.innerHTML = PARTY_ORDER.map((id) => {
      const v = partyMemberView(st, id);
      if (!v) return '';
      const url = portraitDataURL(v.look, 96);
      return `<div class="flag-member"><div class="portrait">${url ? `<img src="${url}" alt="">` : ''}</div>
        <div class="fm-main"><div class="fm-name">${escapeHtml(v.name.split(' ')[0])}<span>Lv ${v.level}</span></div>
        ${barHtml({ value: v.alive ? v.hp : 0, max: v.maxHp, kind: 'hp', text: `${formatInt(v.alive ? v.hp : 0)} / ${formatInt(v.maxHp)}` })}</div></div>`;
    }).join('');
    this.itemsEl.innerHTML = ITEM_ORDER.map((id) => {
      const inv = st.items?.[id] ?? { count: 0, max: 0 };
      return `<span data-tip="${escapeHtml(ITEMS[id].name)}"><img src="${itemIcon(id, 26)}" alt="">${inv.count}/${inv.max}</span>`;
    }).join('');
  }

  async _choose(id) {
    const game = this.game;
    if (id === 'rest') {
      this._rest();
    } else if (id === 'party') {
      game.scenes.push('pause', { tab: 'party' });
    } else if (id === 'travel') {
      this._openTravel();
    } else if (id === 'save') {
      const ok = saveGame(game.state);
      toast(game, ok ? 'The expedition journal is saved.' : 'Saving is unavailable in this browser.', { kind: ok ? 'good' : 'warn' });
    } else if (id === 'leave') {
      this.leave(false);
    }
  }

  _rest() {
    const game = this.game;
    const st = game.state;
    const r = restAtFlag(st, this.flagId, { name: this.flagName });
    if (!r.ok) {
      sfx(game, 'ui_error');
      toast(game, r.reason ?? 'You cannot rest here.', { kind: 'warn' });
      return;
    }
    // Write the journal right away: the glow below is only a flourish, and nothing that happens during it
    // (leaving, fast travel, a closed tab) may lose the rest the player was promised.
    const saved = saveGame(st);
    this.rested = true;
    this.restT = 0;
    this.focus.clear();
    this.root.classList.add('is-resting');
    game.events?.emit?.('rest', { flagId: this.flagId, saved });
    this.sfx('flag');
    this.later(380, () => {
      this.sfx('heal');
      this._renderParty();
    });
    this.later(1650, () => {
      this.root.classList.remove('is-resting');
      toast(game, saved ? 'Rested and restored · Journal saved' : 'Rested and restored · (saving unavailable)', { kind: saved ? 'good' : 'warn' });
      this.focus.set(this.menu);
      this.menu.setItems(this._items(), { id: 'leave' });
    });
  }

  _openTravel() {
    const game = this.game;
    const visited = game.state.world?.flagsVisited ?? {};
    const entries = Object.entries(visited)
      .filter(([id]) => id !== this.flagId)
      .map(([id, f]) => ({ id, ...f }))
      .sort((a, b) => ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone) || String(a.name).localeCompare(String(b.name)));
    const items = [];
    let zone = null;
    for (const f of entries) {
      if (f.zone !== zone) {
        zone = f.zone;
        items.push({ heading: true, label: zoneName(zone) });
      }
      items.push({ id: f.id, label: f.name ?? f.id, flag: f });
    }
    const panel = el('div', { class: 'panel travel-panel' });
    panel.innerHTML = '<div class="eyebrow">Fast Travel</div><div class="heading" style="margin:8px 0 4px">Where to?</div><div class="rule"></div><div class="scroll travel-list"></div>';
    const host = panel.querySelector('.travel-list');
    const list = new MenuList(this.game, {
      items,
      scrollEl: host,
      onConfirm: (it) => this._travel(it.flag),
      onCancel: () => close(),
    });
    host.appendChild(list.el);
    const close = () => {
      this.focus.remove(list);
      panel.remove();
      this.root.classList.remove('is-choosing-travel');
    };
    this.root.appendChild(panel);
    this.root.classList.add('is-choosing-travel');
    this.focus.push(list);
    this.sfx('menu_open', { volume: 0.7 });
  }

  async _travel(flag) {
    const game = this.game;
    this.focus.clear();
    this.sfx('ui_confirm');
    await game.fade(700, () => {
      const w = game.state.world;
      w.zone = flag.zone;
      w.x = flag.x;
      w.y = flag.y;
      game.scenes.reset('world', { zone: flag.zone, x: flag.x, y: flag.y, fastTravel: true, flagId: flag.id });
    }, 700);
  }

  leave(sound = true) {
    if (this._left) return;
    this._left = true;
    if (sound) this.sfx('ui_cancel');
    if (this.game.scenes.top === this) this.game.scenes.pop({ rested: this.rested, flagId: this.flagId });
  }

  resume(result) {
    super.resume(result);
    this._renderParty();
    this._renderHints();
  }

  update(dt) {
    this.time += dt;
    if (this.restT >= 0) this.restT += dt;
    this.focus.update(dt);
  }

  render(ctx) {
    if (this.restT < 0 || this.restT > 3200) return;
    const t = this.restT;
    const fade = Math.min(1, t / 400) * (t > 2200 ? Math.max(0, 1 - (t - 2200) / 1000) : 1);
    ctx.save();
    // warm bloom
    const g = ctx.createRadialGradient(420, 470, 20, 420, 470, 620);
    g.addColorStop(0, `rgba(255, 200, 120, ${0.42 * fade})`);
    g.addColorStop(0.5, `rgba(240, 140, 60, ${0.16 * fade})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1280, 720);
    // rising embers
    for (const e of EMBERS) {
      const age = t - e.delay;
      if (age < 0 || age > e.life) continue;
      const k = age / e.life;
      const x = e.x + Math.sin(age / 300 + e.delay) * e.sway;
      const y = 720 - (age / 1000) * e.speed * 3.2;
      const a = Math.sin(Math.PI * k) * 0.9 * fade;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, e.r * 5);
      rg.addColorStop(0, `rgba(255, 230, 170, ${a})`);
      rg.addColorStop(1, 'rgba(255, 150, 60, 0)');
      ctx.fillStyle = rg;
      ctx.fillRect(x - e.r * 5, y - e.r * 5, e.r * 10, e.r * 10);
    }
    ctx.restore();
  }
}
