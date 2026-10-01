// Game-over screen (registry 'gameover'): a drained, ash-grey dusk, "The Expedition Falters", and the choice to
// retry from the last Expedition Pennant (reloads the journal) or return to the title. Plays the 'gameover' sting.
// The fall itself is written into the journal first, so lifetime records survive the reload.

import { UIScene, MenuList, toast } from './widgets.js';
import { escapeHtml, zoneName, hintsHtml } from './text.js';
import { drawTitleBackground } from '../render/backgrounds.js';
import { applyDesaturation } from '../render/effects.js';
import { loadGame, saveGame, restAtFlag } from '../game/gameState.js';

const LINES = [
  'The Sun stays where it is. Somewhere, a sixty-ninth journal washes ashore.',
  'The dusk does not deepen. It only waits for the next crew to try.',
  'Sixty-nine now. The Stillkeeper counts them the way one counts an evening’s last bells.',
];

const ASH = Array.from({ length: 90 }, (_, i) => {
  const h = (k) => {
    const x = Math.sin(i * 57.3 + k * 19.1) * 91723.137;
    return x - Math.floor(x);
  };
  return { x: h(1) * 1300, y: h(2) * 760, vy: 10 + h(3) * 22, sway: 8 + h(4) * 26, r: 0.8 + h(5) * 2, a: 0.15 + h(6) * 0.4, ph: h(7) * 6.28 };
});

/**
 * Carry the fallen run's lifetime records into the saved journal before Rise Again (or Continue) reloads it:
 * one more death, the play time spent since the last save, and every foe met (the Bestiary never forgets).
 * Progress itself (XP, loot, position) is not carried: the expedition resumes from its last written page.
 * @param {object|null} saved  the loaded save (mutated and written back)
 * @param {object|null} fallen the in-memory state that just lost (its deaths already counted by applyBattleResult)
 * @returns {boolean} true when the journal was updated
 */
export function recordFall(saved, fallen) {
  if (!saved?.stats) return false;
  const st = saved.stats;
  const was = fallen?.stats ?? {};
  st.deaths = Math.max((st.deaths ?? 0) + 1, was.deaths ?? 0);
  st.playTimeMs = Math.max(st.playTimeMs ?? 0, was.playTimeMs ?? 0);
  const met = fallen?.world?.bestiary;
  if (met && typeof met === 'object' && saved.world) {
    const book = saved.world.bestiary && typeof saved.world.bestiary === 'object' ? saved.world.bestiary : {};
    for (const [id, v] of Object.entries(met)) if (v && !book[id]) book[id] = v;
    saved.world.bestiary = book;
  }
  return saveGame(saved);
}

export class GameOverScene extends UIScene {
  constructor(game) {
    super(game);
    this.t = 0;
  }

  enter() {
    const game = this.game;
    game.audio?.playMusic?.('gameover', { fade: 300 });
    const saved = loadGame();
    this.saved = saved;
    recordFall(saved, game.state);
    const flagName = saved?.world?.lastFlag
      ? saved.world.flagsVisited?.[saved.world.lastFlag.flagId]?.name ?? 'your last pennant'
      : null;
    const line = LINES[(game.state?.stats?.deaths ?? 0) % LINES.length];
    const root = this.mountRoot('gameover-screen');
    root.innerHTML = `<div class="go-wrap">
      <div class="go-eyebrow">The party has fallen</div>
      <div class="go-title">The Expedition Falters</div>
      <div class="go-sub">${escapeHtml(line)}</div>
      <div class="rule go-rule"></div>
      <div class="go-menu-host"></div>
      <div class="go-note">${saved ? escapeHtml(flagName ? `Your journal was last written at ${flagName}, ${zoneName(saved.world.lastFlag.zone)}.` : `Your journal was last written in ${zoneName(saved.world.zone)}.`) : 'No journal was saved — the expedition will begin again from its last known camp.'}</div>
      <div class="hint-bar" style="justify-content:center;margin-top:18px"></div>
    </div>`;
    this.menu = new MenuList(game, {
      className: 'go-menu',
      items: [
        { id: 'retry', label: 'Rise Again', sub: flagName ? `Retry from ${flagName}` : 'Retry from the last journal entry' },
        { id: 'title', label: 'Return to Title' },
      ],
      onConfirm: (it) => this._choose(it.id),
    });
    root.querySelector('.go-menu-host').appendChild(this.menu.el);
    this.hintsEl = root.querySelector('.hint-bar');
    this.hintsEl.innerHTML = hintsHtml(game, [['nav-v', 'Select'], ['confirm', 'Confirm']]);
    // Hold input a moment so a panicked button mash doesn't skip the screen.
    this.later(1400, () => this.focus.set(this.menu));
  }

  onDeviceChange() {
    super.onDeviceChange();
    this.hintsEl.innerHTML = hintsHtml(this.game, [['nav-v', 'Select'], ['confirm', 'Confirm']]);
  }

  async _choose(id) {
    const game = this.game;
    this.focus.clear();
    if (id === 'title') {
      await game.fade(700, () => game.scenes.reset('title', {}), 700);
      return;
    }
    let st = loadGame();
    if (!st && game.state) {
      // No readable save (storage blocked): recover the in-memory expedition at its last pennant.
      st = game.state;
      const lf = st.world?.lastFlag;
      if (lf) {
        restAtFlag(st, lf.flagId, {});
        st.world.zone = lf.zone;
        st.world.x = lf.x;
        st.world.y = lf.y;
      } else {
        for (const m of st.party) m.alive = true;
        restAtFlag(st, 'camp', { zone: st.world.zone, x: st.world.x, y: st.world.y, name: 'Camp' });
      }
    }
    if (!st) {
      toast(game, 'No expedition to return to.', { kind: 'warn' });
      await game.fade(700, () => game.scenes.reset('title', {}), 700);
      return;
    }
    await game.fade(800, () => {
      game.state = st;
      game.scenes.reset('world', {});
    }, 800);
  }

  update(dt) {
    this.t += dt;
    super.update(dt);
  }

  render(ctx) {
    const t = this.game.time;
    drawTitleBackground(ctx, t * 0.2, { parallax: { x: 0, y: 6 } });
    applyDesaturation(ctx, 0.85, { tint: '#3a1d24' });
    ctx.save();
    ctx.fillStyle = `rgba(8, 4, 5, ${Math.min(0.72, 0.35 + this.t / 3000)})`;
    ctx.fillRect(0, 0, 1280, 720);
    const v = ctx.createRadialGradient(640, 360, 120, 640, 360, 780);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(60, 8, 6, 0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1280, 720);
    // falling ash
    for (const a of ASH) {
      const y = ((a.y + (t / 1000) * a.vy) % 780) - 30;
      const x = a.x + Math.sin(t / 1400 + a.ph) * a.sway;
      ctx.globalAlpha = a.a * Math.min(1, this.t / 1500);
      ctx.fillStyle = '#c9b8a8';
      ctx.beginPath();
      ctx.arc(x, y, a.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
