// UI bench for Expedition 69 (dev/ui.html): boots the real Game with every UI scene plus stub 'world' and
// 'battle' scenes and a prepared mid-game state, so each screen can be opened, driven and screenshotted.
//
// URL: ?scene=title|intro|pause|flag|shop|gameover|ending|settings|dialogue|world (default world)
//      &tab=party|skills|relics|items|journal|system  &member=gideon|nyra|sable  &shop=shore_camp|thicket_camp|spire_camp
//      &id=<dialogue id>  &slide=N (intro/ending)  &nosave=1 (don't write the bench save)  &fresh=1 (level-1 new game)
// Stub world keys: Esc/Tab pause · F pennant · B shop · T dialogue · G game over · N battle · C settings
// Automation: window.__ui.{stack(), state(), open(name, params), text(sel)} and window.__game.

import { createGame, waitForFonts, registerScenes, installDebug } from '../src/main.js';
import { Scene } from '../src/core/engine.js';
import {
  createNewGame, saveGame, grantPartyXp, autoAllocate, equipRelic, equipEcho, learnSkill, applyBattleResult,
} from '../src/game/gameState.js';
import { totalXpForLevel, derivedStats } from '../src/game/progression.js';
import { drawBattleBackground } from '../src/render/backgrounds.js';
import { drawActor } from '../src/render/sprites.js';
import { el } from '../src/ui/widgets.js';

/** A believable mid-game state: level 7, some unspent points, relics (two mastered), journals, bestiary, pennants. */
export function makeBenchState({ fresh = false } = {}) {
  const st = createNewGame({ seed: 69 });
  if (fresh) return st;
  grantPartyXp(st, totalXpForLevel(7));
  autoAllocate(st, 'gideon');
  // nyra & sable keep their points for the allocation screen
  for (const [id, sk] of [['gideon', 'breach_strike'], ['nyra', 'rime_script'], ['sable', 'calling_card']]) learnSkill(st, id, sk);
  st.glint = 1480;
  Object.assign(st.relics, {
    dawn_locket: { battles: 4, mastered: true },
    tidal_charm: { battles: 2, mastered: false },
    ember_edge: { battles: 4, mastered: true },
    marksmans_eye: { battles: 1, mastered: false },
    keen_whetstone: { battles: 0, mastered: false },
    anvil_heart: { battles: 3, mastered: false },
  });
  st.relics.riposte_pin = { battles: 4, mastered: true };
  equipRelic(st, 'sable', 1, 'ember_edge');
  equipRelic(st, 'gideon', 1, 'anvil_heart');
  equipEcho(st, 'gideon', 'dawn_locket');
  equipEcho(st, 'nyra', 'riposte_pin');
  st.items.tincture = { count: 2, max: 5 };
  st.items.tonic = { count: 1, max: 2 };
  st.items.draught = { count: 2, max: 2 };
  const nyra = st.party.find((m) => m.id === 'nyra');
  nyra.hp = Math.round(derivedStats(nyra).maxHp * 0.38);
  const sable = st.party.find((m) => m.id === 'sable');
  sable.hp = Math.round(derivedStats(sable).maxHp * 0.72);
  const w = st.world;
  w.zone = 'thicket';
  w.x = 12;
  w.y = 18;
  w.journals = { j1: true, j2: true, j4: true };
  w.bestiary = { driftling: 12, shellguard: 4, tidecaller: 3, wreck_warden: 1, thornstag: 2, mime: 1 };
  w.bosses = { wreck_warden: true };
  w.flagsVisited = {
    shore_landing: { zone: 'shore', x: 6, y: 30, name: 'Landing Pennant' },
    shore_wreck: { zone: 'shore', x: 40, y: 12, name: 'Wreck Line Pennant' },
    thicket_gate: { zone: 'thicket', x: 4, y: 22, name: 'Gilded Gate' },
  };
  w.lastFlag = { zone: 'thicket', flagId: 'thicket_gate', x: 4, y: 22 };
  Object.assign(st.stats, { playTimeMs: 2345000, battles: 21, victories: 20, parries: 64, perfectDodges: 18, dodges: 30, jumps: 12, gradientCounters: 3, perfects: 41, deaths: 1 });
  return st;
}

/** Stub world: the zone's battle backdrop with the party idling; dev keys open every overlay. */
class StubWorld extends Scene {
  enter(params = {}) {
    this.zone = params.zone ?? this.game.state?.world?.zone ?? 'shore';
    this.params = params;
    const label = el('div', { class: 'ui-screen', html: `<div style="position:absolute;left:18px;top:14px;font:600 12px/1.6 var(--font-title);letter-spacing:.2em;color:rgba(243,219,160,.75);text-shadow:0 1px 3px #000">WORLD STUB · ${this.zone.toUpperCase()}${params.arrival ? ' · ARRIVAL' : ''}<br><span style="font:italic 500 15px var(--font-body);letter-spacing:0;color:rgba(233,220,192,.6)">Esc menu · F pennant · B shop · T dialogue · G game over · N battle · C settings</span></div>` });
    this.mountUI(label);
    this.game.audio?.playMusic?.(this.zone === 'training' ? 'training' : ['shore', 'thicket', 'spire', 'summit'].includes(this.zone) ? this.zone : 'shore');
  }

  update() {
    const input = this.game.input;
    const push = (name, params) => {
      input.consume();
      this.game.scenes.push(name, params);
    };
    if (input.pressed('menu')) push('pause', {});
    else if (input.keyPressed('KeyF')) push('flag', { flagId: 'thicket_gate', name: 'Gilded Gate' });
    else if (input.keyPressed('KeyB')) push('shop', { shopId: 'thicket_camp' });
    else if (input.keyPressed('KeyT')) push('dialogue', { id: 'bellwether_pre' });
    else if (input.keyPressed('KeyC')) push('settings', { from: 'world' });
    else if (input.keyPressed('KeyG')) this.game.scenes.reset('gameover', {});
    else if (input.keyPressed('KeyN')) this.game.debug.startBattle(['thornstag', 'mime']);
  }

  render(ctx) {
    const t = this.game.time;
    drawBattleBackground(ctx, ['shore', 'thicket', 'spire', 'summit', 'training'].includes(this.zone) ? this.zone : 'shore', t, { camera: { x: Math.sin(t / 4000) * 10, y: 0, zoom: 1 } });
    [['gideon', 390, 470], ['nyra', 265, 565], ['sable', 250, 385]].sort((a, b) => a[2] - b[2]).forEach(([look, x, y], i) => {
      drawActor(ctx, look, { x, y, scale: 1, facing: 1, anim: 'idle', t: t + i * 300 });
    });
  }
}

/** Stub battle: a practice backdrop with a result panel (Victory / Defeat / Flee). */
class StubBattle extends Scene {
  enter(params = {}) {
    this.params = params;
    this.zone = params.zone ?? 'training';
    const panel = el('div', { class: 'ui-screen' });
    panel.innerHTML = `<div class="panel" style="position:absolute;right:60px;top:60px;width:380px">
      <div class="eyebrow">Battle stub</div><div class="heading" style="margin:8px 0">${(params.enemies ?? []).join(', ') || '—'}</div>
      <p class="muted" style="margin:0 0 12px">${params.practice ? 'Practice bout (no rewards)' : `Zone: ${this.zone}`}</p>
      <div class="bench-actions" style="display:flex;gap:8px"></div></div>`;
    const actions = panel.querySelector('.bench-actions');
    for (const outcome of ['victory', 'defeat', 'fled']) {
      const b = el('button', { type: 'button', class: 'btn btn-small', text: outcome });
      b.addEventListener('click', () => this.finish(outcome));
      actions.appendChild(b);
    }
    this.mountUI(panel);
    this.game.audio?.playMusic?.(params.practice ? 'training' : 'battle', { fade: 400 });
  }

  finish(outcome) {
    const state = this.params.state ?? this.game.state;
    const summary = { outcome, xp: 60, glint: 40, drops: [], party: [], practice: !!this.params.practice };
    const rewards = state ? applyBattleResult(state, summary) : null;
    const result = { outcome, summary, rewards };
    this.game.scenes.pop(result);
    this.params.onEnd?.(result);
    if (outcome === 'defeat' && !this.params.practice) this.game.scenes.reset('gameover', {});
  }

  update() {
    const input = this.game.input;
    if (input.pressed('confirm')) this.finish('victory');
    else if (input.pressed('cancel')) this.finish('fled');
  }

  render(ctx) {
    const t = this.game.time;
    drawBattleBackground(ctx, ['shore', 'thicket', 'spire', 'summit', 'training'].includes(this.zone) ? this.zone : 'training', t);
    [['gideon', 390, 470], ['nyra', 265, 565], ['sable', 250, 385]].forEach(([look, x, y], i) => drawActor(ctx, look, { x, y, anim: 'idle', t: t + i * 200 }));
    drawActor(ctx, (this.params.enemies ?? ['dummy'])[0] ?? 'dummy', { x: 960, y: 500, facing: -1, anim: 'idle', t });
  }
}

async function main() {
  const game = createGame();
  await waitForFonts(2000);
  registerScenes(game, { world: StubWorld, battle: StubBattle });
  installDebug(game);
  const p = game.params;
  const scene = p.get('scene') ?? 'world';
  game.state = makeBenchState({ fresh: p.get('fresh') === '1' });
  if (p.get('nosave') !== '1') saveGame(game.state);

  const overWorld = (name, params) => {
    game.scenes.reset('world', {});
    game.scenes.push(name, params);
  };
  switch (scene) {
    case 'title':
      game.state = null;
      game.scenes.reset('title', {});
      break;
    case 'intro':
    case 'ending':
      game.scenes.reset(scene, {});
      if (p.get('slide')) {
        const top = game.scenes.top;
        const n = Number(p.get('slide'));
        if (top?.show && n > 0) top.show(Math.min(n, top.slides.length - 1));
      }
      break;
    case 'pause':
      overWorld('pause', { tab: p.get('tab') ?? 'party', member: p.get('member') ?? undefined });
      break;
    case 'flag':
      overWorld('flag', { flagId: 'thicket_gate', name: 'Gilded Gate' });
      break;
    case 'shop':
      overWorld('shop', { shopId: p.get('shop') ?? 'thicket_camp' });
      break;
    case 'dialogue':
      overWorld('dialogue', { id: p.get('id') ?? 'shore_arrival' });
      break;
    case 'settings':
      if (p.get('over') === 'world') overWorld('settings', { from: 'world' });
      else {
        game.state = null;
        game.scenes.reset('title', {});
        game.scenes.push('settings', { from: 'title' });
      }
      break;
    case 'gameover':
      game.scenes.reset('gameover', {});
      break;
    default:
      game.scenes.reset('world', {});
  }
  game.start();

  window.__ui = {
    stack: () => game.scenes.names(),
    state: () => game.state,
    open: (name, params = {}) => game.scenes.push(name, params),
    text: (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim()),
    errors: () => game.errors,
  };
}

main().catch((err) => {
  console.error('[ui bench] failed', err);
  window.__showError?.(err?.stack ?? String(err));
});
