// Battle bench for Expedition 69 (dev/battle.html): boots the real Game with only BattleScene registered for
// real (every other registry name is a small stub), builds a GameState at any level and starts any encounter.
// URL: ?encounter=id | ?enemies=a,b  &zone=  &level=N  &autopilot=1|random|none  (&defense= &offense= &commands=)
//      &practice=1 &tutorial=1 &boss=1 &ambush=party|enemy &seed= &difficulty=story|expeditioner|veteran
//      &hints=0 (mark every hint seen) &loop=1 (restart after each battle) &warp=N (run the clock N× faster, autopilot soak)
//      &mute=1 &noaudio=1 &cues=0 &feedback=1 &touch=1 (start as a touch device: tap wording, on-screen buttons)
// Automation: window.__game, window.__bench.{start(params), results, last(), scene()}.

import { Game, Scene } from '../src/core/engine.js';
import { Audio } from '../src/core/audio.js';
import { BattleScene } from '../src/battle/battleScene.js';
import { ENCOUNTERS } from '../src/data/encounters.js';
import { ENEMIES } from '../src/data/enemies.js';
import { STORY, getDialogue, speakerName } from '../src/data/story.js';
import { skillIdsFor } from '../src/data/skills.js';
import { createNewGame, autoAllocate, learnSkill } from '../src/game/gameState.js';
import { grantXp, totalXpForLevel, derivedStats, MAX_LEVEL } from '../src/game/progression.js';
import { drawBattleBackground } from '../src/render/backgrounds.js';

const Q = new URLSearchParams(location.search);

// ------------------------------------------------------------------ optional time warp (autopilot soak runs)
const WARP = Math.max(1, Math.min(8, Number(Q.get('warp')) || 1));
if (WARP > 1) {
  const perf = window.performance;
  const realNow = perf.now.bind(perf);
  const t0 = realNow();
  perf.now = () => t0 + (realNow() - t0) * WARP;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(perf.now()));
}

// ------------------------------------------------------------------ state

/**
 * A GameState at `level`: XP granted from level 1, attributes auto-allocated, every learnable skill learned.
 * @param {number} level
 * @param {number} seed
 */
export function buildState(level, seed = 69) {
  const st = createNewGame({ seed });
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.round(level) || 1));
  for (const m of st.party) {
    if (L > 1) grantXp(m, totalXpForLevel(L));
    if (m.attrPoints > 0) autoAllocate(st, m.id);
    for (let pass = 0; pass < 4; pass++) for (const sid of skillIdsFor(m.id)) learnSkill(st, m.id, sid);
    m.hp = derivedStats(m).maxHp;
    m.alive = true;
  }
  if (Q.get('hints') === '0') for (const k of Object.keys(STORY.hints)) st.world.hintsSeen[k] = true;
  return st;
}

function paramsFromUrl(over = {}) {
  const encId = over.encounterId ?? Q.get('encounter') ?? null;
  const enc = encId ? ENCOUNTERS[encId] : null;
  const enemies = over.enemies ?? (Q.get('enemies') ? Q.get('enemies').split(',').map((s) => s.trim()).filter(Boolean) : enc?.enemies ?? ['driftling', 'shellguard']);
  const lvl = Number(over.level ?? Q.get('level')) || Math.max(1, ...enemies.map((e) => ENEMIES[e]?.level ?? 1));
  const practice = over.practice ?? (Q.get('practice') === '1' || encId === 'training_dummy');
  return {
    encounterId: enc ? encId : undefined,
    enemies,
    zone: over.zone ?? Q.get('zone') ?? enc?.zone ?? ENEMIES[enemies[0]]?.zone ?? 'shore',
    ambush: over.ambush ?? Q.get('ambush') ?? null,
    boss: over.boss ?? (Q.get('boss') === '1' ? true : undefined),
    practice,
    tutorial: over.tutorial ?? (Q.get('tutorial') === '1' ? true : undefined),
    seed: over.seed ?? (Q.has('seed') ? Number(Q.get('seed')) : undefined),
    level: lvl,
  };
}

// ------------------------------------------------------------------ game

const game = new Game({});
window.__game = game;
if (Q.has('difficulty')) game.settings.difficulty = Q.get('difficulty');
if (Q.get('cues') === '0') game.settings.assistCues = false;
if (Q.get('feedback') === '1') game.settings.showTimingFeedback = true;
if (Q.has('cal')) game.settings.inputOffset = Number(Q.get('cal')) || 0;
// A touch-like pointer event off the stage switches the input to the touch device, as a first tap would.
if (Q.get('touch') === '1') window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: false, clientX: -10, clientY: -10 }));

if (Q.get('noaudio') !== '1') {
  const audio = new Audio();
  game.audio = audio;
  const mute = Q.get('mute') === '1';
  audio.setVolumes({ master: mute ? 0 : game.settings.masterVolume, sfx: game.settings.sfxVolume, music: game.settings.musicVolume });
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.unlock(), { capture: true });
}

function autopilotFrom(v) {
  if (!v) return null;
  const base = v === 'random' ? { defense: 'random', offense: 'perfect', commands: 'auto' }
    : v === 'none' ? { defense: 'none', offense: 'none', commands: 'auto' }
      : { defense: 'perfect', offense: 'perfect', commands: 'auto' };
  if (Q.has('defense')) base.defense = Q.get('defense');
  if (Q.has('offense')) base.offense = Q.get('offense');
  if (Q.has('commands')) base.commands = Q.get('commands') || null;
  return base;
}
game.debug.autopilot = autopilotFrom(Q.get('autopilot'));
game.debug.setAutopilot = (o) => { game.debug.autopilot = o ? { ...o } : null; };

const bench = {
  results: [],
  last: () => bench.results[bench.results.length - 1] ?? null,
  scene: () => game.scenes.get('battle'),
  /** Start a battle (params as the 'battle' scene takes, plus level). */
  start(over = {}) {
    const p = paramsFromUrl(over);
    const state = over.state ?? buildState(p.level, p.seed ?? 69);
    game.state = state;
    const t0 = performance.now();
    const params = {
      ...p,
      onEnd: (result) => {
        const s = result?.summary;
        bench.results.push({
          encounterId: p.encounterId ?? null, enemies: p.enemies, outcome: result?.outcome,
          ms: Math.round(performance.now() - t0), realMs: Math.round((performance.now() - t0) / WARP),
          rounds: s?.stats?.rounds, parries: s?.stats?.parries, hitsTaken: s?.stats?.hitsTaken, rewards: !!result?.rewards,
          levelUps: result?.rewards?.levelUps?.length ?? 0, errors: game.errors.length,
        });
        bench.lastResult = result;
        if (Q.get('loop') === '1') setTimeout(() => bench.start(over), 600 / WARP);
      },
    };
    if (game.scenes.top?.name !== 'world') game.scenes.reset('world', {});
    game.scenes.push('battle', params);
    return params;
  },
};
window.__bench = bench;

// ------------------------------------------------------------------ stub scenes

function panel(scene, html, style = '') {
  const el = document.createElement('div');
  el.className = 'bench-box';
  el.style.cssText = `left:50%;top:50%;transform:translate(-50%,-50%);padding:18px 26px;background:rgba(16,12,10,.92);
    border:1px solid rgba(224,180,88,.55);border-radius:4px;min-width:420px;text-align:center;${style}`;
  el.innerHTML = html;
  return scene.mountUI(el);
}

/** Base scene under the battle ('world' stub): shows the last result, Enter restarts. */
class BenchScene extends Scene {
  enter() {
    this.t = 0;
    this.box = panel(this, '', 'top:auto;bottom:30px;transform:translateX(-50%)');
    this._refresh();
  }

  pause() {
    this.box.style.display = 'none';
  }

  resume() {
    this.box.style.display = '';
    this._refresh();
  }

  _refresh() {
    const r = bench.last();
    const L = (a) => game.input.keyLabel(a);
    this.box.innerHTML = `<div style="font-family:var(--font-title);letter-spacing:.2em;color:var(--pale-gold)">BATTLE BENCH</div>
      <div style="margin-top:6px;font-size:18px">${r ? `Last: <b>${r.outcome}</b> · ${(r.ms / 1000).toFixed(1)} s · ${r.rounds ?? '?'} rounds` : 'Starting…'}</div>
      <div style="margin-top:6px;opacity:.75">[${L('confirm')}] fight again</div>`;
  }

  update(dt) {
    this.t += dt;
    if (game.input.pressed('confirm')) {
      game.input.consume();
      bench.start();
    }
  }

  render(ctx) {
    drawBattleBackground(ctx, paramsFromUrl().zone, this.t, {});
    ctx.fillStyle = 'rgba(8,6,4,.45)';
    ctx.fillRect(0, 0, 1280, 720);
  }
}

/** 'dialogue' stub: shows lines, confirm advances, calls onDone. Autopilot advances by itself. */
class DialogueStub extends Scene {
  constructor(g) {
    super(g);
    this.transparent = true;
  }

  enter(params) {
    this.lines = params.lines ?? getDialogue(params.id);
    this.onDone = params.onDone;
    this.i = 0;
    this.t = 0;
    this.box = panel(this, '', 'top:auto;bottom:120px;transform:translateX(-50%);width:760px;text-align:left');
    this._show();
  }

  _show() {
    const l = this.lines[this.i];
    if (!l) return;
    const who = speakerName(l.speaker);
    this.box.innerHTML = `${who ? `<div style="font-family:var(--font-title);color:var(--gold);letter-spacing:.14em">${who}</div>` : ''}
      <div style="font-size:21px;margin-top:4px;${who ? '' : 'font-style:italic'}">${l.text}</div>
      <div style="text-align:right;opacity:.6;margin-top:6px">[${game.input.keyLabel('confirm')}]</div>`;
  }

  update(dt) {
    this.t += dt;
    const auto = game.debug.autopilot?.commands === 'auto' && this.t > 700;
    if (game.input.pressed('confirm') || auto) {
      game.input.consume();
      this.t = 0;
      this.i += 1;
      if (this.i >= this.lines.length) {
        const cb = this.onDone;
        game.scenes.pop();
        cb?.();
      } else this._show();
    }
  }
}

/** 'settings' stub: toggles a few live settings. */
class SettingsStub extends Scene {
  constructor(g) {
    super(g);
    this.transparent = true;
  }

  enter() {
    this.box = panel(this, '');
    this._show();
  }

  _show() {
    const s = game.settings;
    const row = (k, label, v) => `<div style="margin:4px 0">[${k}] ${label}: <b>${v}</b></div>`;
    this.box.innerHTML = `<div style="font-family:var(--font-title);letter-spacing:.2em;color:var(--pale-gold);margin-bottom:8px">SETTINGS (bench stub)</div>
      ${row(1, 'Assist cues', s.assistCues)}${row(2, 'Timing feedback', s.showTimingFeedback)}${row(3, 'Reduced flashing', s.reducedFlashing)}
      ${row(4, 'Screen shake', s.screenShake)}<div style="opacity:.6;margin-top:8px">[${game.input.keyLabel('cancel')}] back</div>`;
  }

  update() {
    const s = game.settings;
    const inp = game.input;
    const flip = (k) => { s[k] = !s[k]; game.saveSettings(); this._show(); };
    if (inp.keyPressed('Digit1')) flip('assistCues');
    if (inp.keyPressed('Digit2')) flip('showTimingFeedback');
    if (inp.keyPressed('Digit3')) flip('reducedFlashing');
    if (inp.keyPressed('Digit4')) flip('screenShake');
    if (inp.pressed('cancel') || inp.pressed('menu')) {
      inp.consume();
      game.scenes.pop();
    }
  }
}

/** Generic stub for the other registry names. */
function stub(name) {
  return class extends Scene {
    enter() {
      this.box = panel(this, `<div style="font-family:var(--font-title);letter-spacing:.2em;color:var(--pale-gold)">${name.toUpperCase()} (stub)</div>
        <div style="margin-top:8px;opacity:.75">[${game.input.keyLabel('confirm')}] back to the bench</div>`);
    }

    update() {
      if (game.input.pressed('confirm')) {
        game.input.consume();
        game.scenes.reset('world');
      }
    }

    render(ctx) {
      ctx.fillStyle = '#120d0a';
      ctx.fillRect(0, 0, 1280, 720);
    }
  };
}

game.registerScene('battle', BattleScene);
game.registerScene('world', BenchScene);
game.registerScene('dialogue', DialogueStub);
game.registerScene('settings', SettingsStub);
for (const n of ['title', 'intro', 'pause', 'flag', 'shop', 'gameover', 'ending']) game.registerScene(n, stub(n));

// Surface caught scene errors on the page too.
game.events.on('error', (e) => window.__showError?.(`[${e.scene}/${e.phase}] ${e.message}`));

// ------------------------------------------------------------------ perf readout

const perfEl = document.getElementById('perf');
let perfT = 0;
game.events.on('scene', () => { perfT = 0; });
(function perfLoop() {
  requestAnimationFrame(perfLoop);
  const b = game.scenes.get('battle');
  if (!b?.perf) {
    perfEl.textContent = '';
    return;
  }
  perfT += 1;
  if (perfT % 15) return;
  const p = b.perf;
  perfEl.textContent = `fps ${game.fps.toFixed(0)} · update ${p.update.toFixed(2)} ms · render ${p.render.toFixed(2)} ms · worst render ${p.worst.toFixed(1)} ms${WARP > 1 ? ` · warp ×${WARP}` : ''}`;
}());

game.scenes.reset('world', {});
game.start();
if (Q.get('idle') !== '1') bench.start();
