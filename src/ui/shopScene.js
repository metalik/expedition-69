// Merchant overlay (registry 'shop', transparent): the camp's stock (relics and charge shards) with prices in Glint,
// owned / sold-out marks, affordability, full relic details, a purchase confirmation and a live Glint purse.

import { UIScene, MenuList, confirmDialog, toast, sfx } from './widgets.js';
import { speakerPortrait, npcPortraitURL, npcPortraitsReady } from './dialogue.js';
import { escapeHtml, formatInt, hintsHtml, speakerInfo } from './text.js';
import { shopView, buy, describeRelic } from '../game/gameState.js';
import { SHOPS } from '../data/shops.js';
import { UPGRADES, ITEMS } from '../data/items.js';
import { MASTERY_BATTLES } from '../data/relics.js';
import { itemIcon, mechanicIcon } from '../render/icons.js';

const RARITY_GLOW = { common: 'rgba(233, 220, 192, 0.35)', rare: 'rgba(159, 211, 255, 0.45)', legendary: 'rgba(255, 210, 120, 0.55)' };

export class ShopScene extends UIScene {
  constructor(game) {
    super(game);
    this.transparent = true;
  }

  enter(params = {}) {
    this.shopId = params.shopId && SHOPS[params.shopId] ? params.shopId : Object.keys(SHOPS)[0];
    const shop = SHOPS[this.shopId];
    const root = this.mountRoot('shop-screen');
    if (!this.game.state) {
      console.warn('[shop] no game state');
      this.later(0, () => this.close());
      return;
    }
    const keeper = speakerInfo(shop.keeper ?? 'Merchant');
    root.innerHTML = `
      <div class="backdrop"></div>
      <div class="panel shop-frame"><div class="shop-inner">
        <div class="shop-side">
          <div class="shop-sign"><span class="eyebrow">Merchant</span><h2>${escapeHtml(shop.name)}</h2><p>${escapeHtml(shop.blurb ?? '')}</p></div>
          <div class="rule"></div>
          <div class="panel-inset shop-keeper"><i class="shop-keeper-face"></i>
            <div><b>${escapeHtml(shop.keeper ?? 'The Merchant')}</b><span class="shop-quip">“Everything here survived sixty-eight expeditions. Most of it twice.”</span></div></div>
          <div class="shop-showcase"></div>
          <div class="panel-inset shop-purse"><img src="${mechanicIcon('glint', 34)}" alt=""><div><b class="purse-num">0</b><br><small>GLINT</small></div></div>
        </div>
        <div class="shop-main">
          <div class="section-label">Wares<span class="sl-right shop-count"></span></div>
          <div class="panel-inset list-box scroll shop-list"></div>
          <div class="panel-inset shop-detail"></div>
          <div class="hint-bar"></div>
        </div>
      </div></div>`;
    root.querySelector('.backdrop').addEventListener('click', () => this.close());
    const face = root.querySelector('.shop-keeper-face');
    face.replaceWith(speakerPortrait(keeper, 160));
    if (!keeper.look) {
      // Opened before the world's NPC painter loaded: swap the monogram for the keeper's bust once it is there.
      npcPortraitsReady.then(() => {
        const mono = root.querySelector('.shop-keeper > .monogram');
        if (mono && root.isConnected && npcPortraitURL(keeper.name, 160)) mono.replaceWith(speakerPortrait(keeper, 160));
      });
    }
    this.purseEl = root.querySelector('.shop-purse');
    this.purseNum = root.querySelector('.purse-num');
    this.detailEl = root.querySelector('.shop-detail');
    this.hintsEl = root.querySelector('.shop-main .hint-bar');
    this.countEl = root.querySelector('.shop-count');
    this.quipEl = root.querySelector('.shop-quip');
    this.showcaseEl = root.querySelector('.shop-showcase');
    const host = root.querySelector('.shop-list');
    this.list = new MenuList(this.game, {
      className: 'menu-body',
      items: this._items(),
      scrollEl: host,
      render: (it) => this._row(it),
      describe: (it) => this._detail(it),
      descEl: this.detailEl,
      onConfirm: (it) => this._buy(it),
      onCancel: () => this.close(),
      onFocus: (it) => this._showcase(it),
    });
    host.appendChild(this.list.el);
    this._showcase(this.list.current);
    this.focus.set(this.list);
    this.shownGlint = this.game.state.glint ?? 0;
    this._renderPurse();
    this._renderHints();
    this.sfx('coin', { volume: 0.6 });
  }

  _items() {
    const rows = shopView(this.game.state, this.shopId);
    const items = [];
    const relics = rows.filter((r) => r.kind === 'relic');
    const shards = rows.filter((r) => r.kind === 'shard');
    if (relics.length) items.push({ heading: true, label: 'Relics' });
    for (const r of relics) items.push({ id: `r${r.index}`, row: r });
    if (shards.length) items.push({ heading: true, label: 'Charge Shards' });
    for (const r of shards) items.push({ id: `s${r.index}`, row: r });
    const left = rows.filter((r) => !r.soldOut && !r.owned).length;
    if (this.countEl) this.countEl.textContent = `${left} of ${rows.length} available`;
    return items;
  }

  _icon(row, size) {
    if (row.kind === 'shard') return itemIcon(row.id, size);
    return mechanicIcon('relic', size);
  }

  _row(it) {
    const r = it.row;
    const owned = r.owned || r.soldOut;
    const status = r.owned ? '<span class="tag t-learned">Owned</span>' : r.soldOut ? '<span class="tag t-locked">Sold out</span>' : '';
    const rarity = r.kind === 'relic' ? `<span class="tag t-${r.rarity}">${escapeHtml(r.rarity)}</span>` : `<span class="tag">+1 charge</span>`;
    const price = owned ? '' : `<span class="sh-price${r.affordable ? '' : ' is-poor'}"><img src="${mechanicIcon('glint', 18)}" alt="">${formatInt(r.price)}</span>`;
    return `<div class="shop-row${owned ? ' is-owned' : ''}"><img src="${this._icon(r, 30)}" alt="">
      <span class="sh-name${r.kind === 'relic' ? ` rarity-${r.rarity}` : ''}">${escapeHtml(r.name)}</span>${rarity}${status}${price}</div>`;
  }

  _detail(it) {
    const r = it.row;
    if (r.kind === 'relic') {
      const d = describeRelic(r.id, this.game.state);
      return `<div class="sd-head"><h3 class="rarity-${d.rarity}">${escapeHtml(d.name)}</h3>
          <div class="d-tags"><span class="tag t-${d.rarity}">${escapeHtml(d.rarityLabel)}</span><span class="tag">Echo cost ${d.echoCost}</span>${d.statsText ? `<span class="tag">${escapeHtml(d.statsText)}</span>` : ''}</div></div>
        <div class="d-short">${escapeHtml(d.passiveText)}</div>
        <div class="d-desc">${escapeHtml(d.desc)}</div>
        <div class="d-note">${r.owned ? `Owned · ${escapeHtml(d.masteryText)}` : `Worn for ${MASTERY_BATTLES} victories, it masters into an Echo the whole party can share.`}</div>`;
    }
    const up = UPGRADES[r.id];
    const inv = this.game.state.items?.[up?.item];
    return `<div class="sd-head"><h3>${escapeHtml(r.name)}</h3>
        <div class="d-tags"><span class="tag">${escapeHtml(ITEMS[up?.item]?.name ?? '')}</span><span class="tag">Now ${inv ? `${inv.count} / ${inv.max}` : '—'} charges</span>${r.soldOut ? '<span class="tag t-locked">Sold out</span>' : `<span class="tag">${r.remaining} in stock</span>`}</div></div>
      <div class="d-desc">${escapeHtml(r.desc)}</div>`;
  }

  _showcase(it) {
    if (!this.showcaseEl || !it?.row) return;
    const r = it.row;
    const glow = r.kind === 'relic' ? RARITY_GLOW[r.rarity] ?? RARITY_GLOW.common : 'rgba(159, 224, 214, 0.4)';
    const state = r.owned ? 'Owned' : r.soldOut ? 'Sold out' : r.affordable ? 'Within your means' : `${formatInt(r.price - (this.game.state.glint ?? 0))} Glint short`;
    this.showcaseEl.innerHTML = `<div class="sc-orb" style="--glow:${glow}"><img src="${this._icon(r, 96)}" alt=""></div>
      <div class="sc-name${r.kind === 'relic' ? ` rarity-${r.rarity}` : ''}">${escapeHtml(r.name)}</div>
      <div class="sc-price${r.affordable || r.owned || r.soldOut ? '' : ' is-poor'}">${r.owned || r.soldOut ? escapeHtml(state) : `<img src="${mechanicIcon('glint', 20)}" alt="">${formatInt(r.price)}<small>${escapeHtml(state)}</small>`}</div>`;
  }

  _renderHints() {
    this.hintsEl.innerHTML = hintsHtml(this.game, [['nav-v', 'Select'], ['confirm', 'Buy'], ['cancel', 'Leave']]);
  }

  onDeviceChange() {
    super.onDeviceChange();
    this._renderHints();
  }

  _renderPurse() {
    this.purseNum.textContent = formatInt(Math.round(this.shownGlint));
  }

  async _buy(it) {
    const r = it.row;
    if (!r.canBuy) {
      sfx(this.game, 'ui_error');
      const lines = { 'Not enough Glint': `You need ${formatInt(r.price - (this.game.state.glint ?? 0))} more Glint.`, 'Already owned': 'You already carry this relic.', 'Sold out': 'Sold out — the merchant has no more.' };
      toast(this.game, lines[r.reason] ?? r.reason ?? 'Not for sale.', { kind: 'warn' });
      this.quipEl.textContent = r.reason === 'Not enough Glint' ? '“Credit? On an expedition? My dear, you may not come back.”' : '“One of each, and I remember every face.”';
      return;
    }
    const ok = await confirmDialog(this, {
      title: `Buy ${r.name}?`,
      html: `For <b class="gold">${formatInt(r.price)} Glint</b> — you have ${formatInt(this.game.state.glint ?? 0)}.`,
      confirmLabel: 'Buy',
      cancelLabel: 'Not Now',
    });
    if (!ok) return;
    const res = buy(this.game.state, this.shopId, r.index);
    if (!res.ok) {
      sfx(this.game, 'ui_error');
      toast(this.game, res.reason ?? 'The merchant shakes their head.', { kind: 'warn' });
      return;
    }
    sfx(this.game, 'coin');
    this.later(120, () => sfx(this.game, 'chest', { volume: 0.5 }));
    toast(this.game, res.description ?? `Bought ${r.name}`, { kind: 'gold', icon: this._icon(r, 24) });
    this.quipEl.textContent = '“A fine choice. It has been waiting for you — or someone like you.”';
    this.purseEl.classList.add('is-spent');
    this.later(600, () => this.purseEl.classList.remove('is-spent'));
    this.list.setItems(this._items(), { id: it.id });
    this._showcase(this.list.current);
  }

  close() {
    if (this._closing) return;
    this._closing = true;
    this.sfx('ui_cancel');
    if (this.game.scenes.top === this) this.game.scenes.pop({ shopId: this.shopId });
  }

  update(dt) {
    this.time += dt;
    const target = this.game.state?.glint ?? 0;
    if (Math.abs(this.shownGlint - target) > 0.5) {
      this.shownGlint += (target - this.shownGlint) * Math.min(1, dt / 90);
      if (Math.abs(this.shownGlint - target) < 1) this.shownGlint = target;
      this._renderPurse();
    }
    const input = this.game.input;
    if (this.focus.top === this.list && input.pressed('menu') && !input.pressed('cancel')) {
      input.consume(['menu']);
      this.close();
      return;
    }
    this.focus.update(dt);
  }
}
