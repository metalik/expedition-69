// Expedition 69 entry point: creates the Game on index.html's DOM, wires synthesized audio to the settings, keeps the
// play clock and the compact (phone) UI mode, waits briefly for the web fonts (never blocking on them), registers
// every scene of the fixed registry (SPEC §4.11), installs window.__game and the game.debug helpers + URL
// parameters of SPEC §4.12, then starts at the title (or wherever the URL asks).
// Setting globalThis.__EXP69_NO_BOOT__ before import turns the auto-boot off (dev benches reuse the helpers).

import { Game, Scene } from './core/engine.js';
import { Audio } from './core/audio.js';
import { DIFFICULTY } from './battle/qte.js';
import { createNewGame, saveGame, grantPartyXp, autoAllocate, getMember, addPlayTime } from './game/gameState.js';
import { totalXpForLevel, MAX_LEVEL, derivedStats } from './game/progression.js';
import { ENEMIES } from './data/enemies.js';
import { ENCOUNTERS } from './data/encounters.js';
import { TitleScene } from './ui/titleScene.js';
import { IntroScene } from './ui/introScene.js';
import { PauseScene } from './ui/pauseMenu.js';
import { FlagScene } from './ui/flagMenu.js';
import { DialogueScene, openDialogue } from './ui/dialogue.js';
import { ShopScene } from './ui/shopScene.js';
import { GameOverScene } from './ui/gameOverScene.js';
import { EndingScene } from './ui/endingScene.js';
import { SettingsScene } from './ui/settingsScene.js';
import { el } from './ui/widgets.js';
import { escapeHtml } from './ui/text.js';

/** The UI-owned scenes (registry name → class). */
export const UI_SCENES = {
  title: TitleScene,
  intro: IntroScene,
  pause: PauseScene,
  flag: FlagScene,
  dialogue: DialogueScene,
  shop: ShopScene,
  gameover: GameOverScene,
  ending: EndingScene,
  settings: SettingsScene,
};

// ------------------------------------------------------------------ fallbacks

/**
 * Stand-in for a gameplay scene whose module failed to load: explains what happened and offers a way back,
 * so a broken world/battle module never leaves a black screen.
 */
export function makeMissingScene(name, error) {
  return class MissingScene extends Scene {
    enter(params = {}) {
      this.params = params;
      const msg = error ? String(error.message ?? error) : 'module not found';
      const root = el('div', { class: 'ui-screen missing-screen' });
      root.innerHTML = `<div class="panel"><div class="heading">The ${escapeHtml(name)} is unavailable</div><div class="rule"></div>
        <p>This part of the expedition could not be loaded.</p><code>${escapeHtml(msg)}</code>
        <p style="margin-top:18px"><span class="kbd">Enter</span> Return</p></div>`;
      this.mountUI(root);
    }

    update() {
      const input = this.game.input;
      if (!input.pressed('confirm') && !input.pressed('cancel')) return;
      input.consume();
      if (name === 'battle' && this.game.scenes.top === this) {
        const onEnd = this.params?.onEnd;
        const result = { outcome: 'fled', summary: null, rewards: null };
        this.game.scenes.pop(result);
        if (!this.game.scenes.size) this.game.scenes.reset('title', {});
        onEnd?.(result);
      } else this.game.scenes.reset('title', {});
    }

    render(ctx) {
      ctx.fillStyle = '#0b0806';
      ctx.fillRect(0, 0, 1280, 720);
    }
  };
}

/**
 * Import a gameplay scene module; on failure returns a MissingScene so the rest of the game still runs.
 * @param {string} path module path relative to this file
 * @param {string} exportName
 * @param {string} name registry name
 */
export async function loadSceneModule(path, exportName, name) {
  try {
    const mod = await import(path);
    const Cls = mod?.[exportName];
    if (typeof Cls !== 'function') throw new Error(`${path} does not export ${exportName}`);
    return Cls;
  } catch (err) {
    console.error(`[main] could not load the ${name} scene (${path}):`, err);
    return makeMissingScene(name, err);
  }
}

// ------------------------------------------------------------------ play clock & compact UI

/** Longest single frame gap (ms) the play clock counts; longer stalls (a debugger, a sleeping laptop) are not play. */
export const PLAY_CLOCK_MAX_GAP = 1000;
const clockedGames = new WeakSet();

/**
 * Accumulate game.state.stats.playTimeMs — the one place that does. Every engine frame counts (the field, battles,
 * dialogues, menus, cutscenes) while the tab is visible and an expedition is loaded; the title screen does not, since
 * the state it may still hold is a finished or abandoned run. Frames are timed with the real clock (the engine's dt
 * is clamped to 50 ms, which would undercount on slow devices), and a return from a hidden tab restarts the count.
 * @param {Game} game
 */
export function installPlayClock(game) {
  if (clockedGames.has(game)) return;
  clockedGames.add(game);
  let last = null;
  const step = game.step;
  game.step = function stepWithPlayClock(now) {
    step.call(this, now);
    const prev = last;
    last = now;
    if (prev === null || this.hidden || !this.state || this.scenes.has('title')) return;
    addPlayTime(this.state, Math.min(Math.max(0, now - prev), PLAY_CLOCK_MAX_GAP));
  };
  game.events.on('visibility', () => {
    last = null;
  });
}

/** Stage scale below which the DOM menus switch to their magnified compact layout (phones, small windows). */
export const COMPACT_SCALE = 0.72;
/** Effective on-screen scale the compact layout aims for (menu text of 17 logical px → ≈13 CSS px). */
const COMPACT_TARGET = 0.76;
const COMPACT_MAX_ZOOM = 1.5;

/**
 * Toggle `.ui-compact` on #ui and set `--ui-zoom` (≥ 1) for the current stage scale. styles.css magnifies the
 * pause, pennant, shop and modal panels by that zoom and reflows them, so text stays readable and rows tappable
 * when the 1280×720 stage is shrunk onto a phone (0.54 at 844×390).
 * @param {Game} game
 */
export function applyCompactUi(game) {
  const root = game.uiRoot;
  if (!root?.classList) return;
  const scale = game.scale > 0 ? game.scale : 1;
  const compact = scale < COMPACT_SCALE;
  const zoom = compact ? Math.min(COMPACT_MAX_ZOOM, Math.round((COMPACT_TARGET / scale) * 100) / 100) : 1;
  root.classList.toggle('ui-compact', compact);
  root.style.setProperty('--ui-zoom', String(zoom));
}

// ------------------------------------------------------------------ boot helpers

/**
 * Create the Game on the page and attach an Audio instance that follows the settings.
 * @returns {Game}
 */
export function createGame() {
  const doc = globalThis.document;
  const game = new Game({
    canvas: doc.getElementById('game'),
    uiRoot: doc.getElementById('ui'),
    stageEl: doc.getElementById('stage'),
    fadeEl: doc.getElementById('fade'),
  });
  const audio = new Audio();
  game.audio = audio;
  const applyVolumes = () => {
    try {
      audio.setVolumes({ master: game.settings.masterVolume, sfx: game.settings.sfxVolume, music: game.settings.musicVolume });
    } catch (err) {
      console.warn('[main] setVolumes failed', err);
    }
  };
  applyVolumes();
  game.events.on('settings', applyVolumes);
  // Unlock WebAudio on the first user gesture (Audio also listens itself; unlock() is idempotent).
  const unlock = () => {
    try {
      audio.unlock();
    } catch {
      /* ignore */
    }
    if (audio.unlocked && audio.context?.state === 'running') {
      globalThis.removeEventListener('pointerdown', unlock, true);
      globalThis.removeEventListener('keydown', unlock, true);
    }
  };
  globalThis.addEventListener('pointerdown', unlock, true);
  globalThis.addEventListener('keydown', unlock, true);
  installPlayClock(game);
  applyCompactUi(game);
  game.events.on('resize', () => applyCompactUi(game));
  globalThis.__game = game;
  return game;
}

/**
 * Settle the Google Fonts stylesheet, which the page loads without blocking: `<link data-webfonts media="print">`
 * whose inline handlers swap it to media="all" on load or mark it data-webfonts="failed". Resolves true once it
 * applies, false when it failed. Pages that link the fonts some other way (no data-webfonts) resolve true at once.
 * @param {Document} [doc]
 * @returns {Promise<boolean>}
 */
export function webFontStylesheet(doc = globalThis.document) {
  const link = doc?.querySelector?.('link[data-webfonts]');
  if (!link) return Promise.resolve(true);
  if (link.dataset.webfonts === 'failed') return Promise.resolve(false);
  if (link.media === 'all' || link.sheet) {
    link.media = 'all';
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    link.addEventListener('load', () => {
      link.media = 'all';
      resolve(true);
    }, { once: true });
    link.addEventListener('error', () => resolve(false), { once: true });
  });
}

/**
 * Give the two web fonts a short head start before the first frame, never longer than `timeoutMs`: offline (or with
 * the font host blocked) this returns as soon as the stylesheet fails; with a request that hangs it gives up at the
 * timeout and the game starts in Georgia. Fonts that arrive later still apply: DOM text swaps (display=swap) and the
 * canvas, redrawn every frame, picks them up on its own.
 * @param {number} [timeoutMs=1500]
 */
export async function waitForFonts(timeoutMs = 1500) {
  const doc = globalThis.document;
  const specs = ['700 32px "Cinzel"', '900 64px "Cinzel"', '500 24px "Cormorant Garamond"', 'italic 500 24px "Cormorant Garamond"', '600 24px "Cormorant Garamond"'];
  const ready = (async () => {
    if (!(await webFontStylesheet(doc))) return;
    const fonts = doc?.fonts;
    if (!fonts || typeof fonts.load !== 'function') return;
    await Promise.all(specs.map((s) => fonts.load(s).catch(() => null)));
  })();
  let timer;
  await Promise.race([ready, new Promise((r) => { timer = setTimeout(r, timeoutMs); })]);
  clearTimeout(timer);
}

/** Register the UI scenes plus world/battle classes. */
export function registerScenes(game, { world, battle, extra = {} } = {}) {
  for (const [name, Cls] of Object.entries({ ...UI_SCENES, ...extra })) game.registerScene(name, Cls);
  if (world) game.registerScene('world', world);
  if (battle) game.registerScene('battle', battle);
}

// ------------------------------------------------------------------ debug hooks (SPEC §4.12)

function ensureState(game) {
  if (!game.state) {
    game.state = createNewGame();
  }
  return game.state;
}

function parseEnemies(enemies) {
  if (typeof enemies === 'string') {
    if (Object.hasOwn(ENCOUNTERS, enemies)) return { encounterId: enemies, list: [...ENCOUNTERS[enemies].enemies] };
    return { encounterId: null, list: enemies.split(',').map((s) => s.trim()).filter(Boolean) };
  }
  return { encounterId: null, list: Array.isArray(enemies) ? enemies : [] };
}

/**
 * Raise every party member to `level` (grants the missing XP) and auto-allocate their attribute points.
 * @param {object} state
 * @param {number} level
 */
export function raisePartyTo(state, level) {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const need = totalXpForLevel(L);
  for (const m of state.party) {
    const have = totalXpForLevel(m.level) + (m.xp || 0);
    if (need > have) {
      const one = { ...state, party: [m] };
      grantPartyXp(one, need - have);
    }
    autoAllocate(state, m.id);
  }
  return state;
}

/**
 * Install window.__game and game.debug: startBattle, gotoZone, grantXp, winBattle, setAutopilot (+ extras).
 * @param {Game} game
 */
export function installDebug(game) {
  globalThis.__game = game;
  const debug = game.debug;
  debug.autopilot = debug.autopilot ?? null;

  debug.startBattle = (enemies, opts = {}) => {
    const state = ensureState(game);
    const { encounterId, list } = parseEnemies(enemies);
    const enc = encounterId ? ENCOUNTERS[encounterId] : null;
    const ids = list.filter((id) => Object.hasOwn(ENEMIES, typeof id === 'string' ? id : id?.id));
    if (!ids.length) {
      console.warn('[debug] startBattle: no valid enemies in', enemies);
      return null;
    }
    const firstId = typeof ids[0] === 'string' ? ids[0] : ids[0].id;
    const zone = opts.zone ?? enc?.zone ?? ENEMIES[firstId]?.zone ?? state.world?.zone ?? 'shore';
    const boss = opts.boss ?? (enc?.boss || ids.some((id) => ENEMIES[typeof id === 'string' ? id : id.id]?.boss));
    const extra = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
    const params = {
      encounterId: opts.encounterId ?? encounterId ?? undefined,
      enemies: ids,
      zone: zone || 'shore',
      ambush: opts.ambush ?? null,
      boss: !!boss,
      practice: !!opts.practice,
      tutorial: !!(opts.tutorial ?? enc?.tutorial),
      spawnId: opts.spawnId,
      ...extra,
      onEnd: (result) => {
        debug.lastBattle = result;
        console.log(`[debug] battle ended: ${result?.outcome}`, result);
        try {
          opts.onEnd?.(result);
        } finally {
          // A battle started from nothing returns to the world (or the title when there is no world).
          if (!game.scenes.size) {
            if (game.scenes.isRegistered('world') && game.state) game.scenes.reset('world', {});
            else game.scenes.reset('title', {});
          }
        }
      },
    };
    return game.scenes.push('battle', params);
  };

  debug.gotoZone = (zone, x, y) => {
    const state = ensureState(game);
    if (typeof zone === 'string' && zone) state.world.zone = zone;
    if (Number.isFinite(x)) state.world.x = x;
    if (Number.isFinite(y)) state.world.y = y;
    const params = { zone: state.world.zone };
    if (Number.isFinite(x)) params.x = x;
    if (Number.isFinite(y)) params.y = y;
    return game.scenes.reset('world', params);
  };

  debug.grantXp = (n) => {
    const state = ensureState(game);
    const res = grantPartyXp(state, Math.max(0, Math.floor(Number(n) || 0)));
    if (res.levelUps.length) console.log('[debug] level ups:', res.levelUps.map((u) => `${u.id}→${u.level}`).join(', '));
    return res;
  };

  debug.setLevel = (level) => raisePartyTo(ensureState(game), level);

  /** Restore every member to full HP (and revive the fallen) without resting — spawns and items are untouched. */
  debug.healParty = (fraction = 1) => {
    const state = ensureState(game);
    const k = Math.max(0, Math.min(1, Number(fraction)));
    for (const m of state.party) {
      const max = derivedStats(m).maxHp;
      m.hp = Math.max(1, Math.round(max * k));
      m.alive = true;
    }
    return state.party.map((m) => ({ id: m.id, hp: m.hp }));
  };

  debug.winBattle = () => {
    const scene = game.scenes.get('battle');
    if (!scene) {
      console.warn('[debug] winBattle: no battle in progress');
      return false;
    }
    if (typeof scene.debugWin === 'function') return scene.debugWin() ?? true;
    if (scene.model && typeof scene.model.endBattle === 'function') {
      scene.model.endBattle('victory');
      return true;
    }
    if (typeof scene.finish === 'function') {
      scene.finish('victory');
      return true;
    }
    console.warn('[debug] winBattle: battle scene exposes no way to end the fight');
    return false;
  };

  debug.setAutopilot = (opts) => {
    if (opts === null || opts === false) {
      debug.autopilot = null;
      return null;
    }
    const o = opts === true ? { defense: 'perfect', offense: 'perfect', commands: 'auto' } : opts ?? {};
    debug.autopilot = { defense: o.defense ?? null, offense: o.offense ?? null, commands: o.commands ?? null };
    // Opt-in: keep story dialogues (e.g. the Stillkeeper's phase-2 lines) during 'auto' battles.
    if (o.dialogues) debug.autopilot.dialogues = true;
    return debug.autopilot;
  };

  debug.newGame = ({ zone, level } = {}) => {
    game.state = createNewGame();
    if (zone) game.state.world.zone = zone;
    if (level) raisePartyTo(game.state, level);
    saveGame(game.state);
    return game.state;
  };
  debug.scene = (name, params = {}) => game.scenes.push(name, params);
  debug.dialogue = (idOrLines) => openDialogue(game, idOrLines);
  debug.save = () => saveGame(game.state);
  debug.member = (id) => getMember(game.state, id);
  debug.stack = () => game.scenes.names();
  return debug;
}

/**
 * Apply the debug URL parameters: ?autopilot=1, ?difficulty=, ?level=N, ?zone=z, ?battle=a,b (or an encounter id),
 * ?seed=, ?scene=<registry name>. Returns true when it started a scene (so boot skips the title).
 * @param {Game} game
 * @returns {boolean}
 */
export function applyUrlParams(game) {
  const p = game.params;
  const debug = game.debug;
  if (p.get('autopilot') === '1' || p.get('autopilot') === 'true') debug.setAutopilot(true);
  const diff = p.get('difficulty');
  if (diff && Object.hasOwn(DIFFICULTY, diff)) game.settings.difficulty = diff;
  const battle = p.get('battle');
  const zone = p.get('zone');
  const level = Number(p.get('level'));
  const seed = Number(p.get('seed'));
  const scene = p.get('scene');
  if (!battle && !zone && !level && !scene) return false;
  game.state = createNewGame(Number.isFinite(seed) && seed > 0 ? { seed } : {});
  if (zone) game.state.world.zone = zone;
  if (level > 1) raisePartyTo(game.state, level);
  if (battle) {
    if (!debug.startBattle(battle.includes(',') ? battle.split(',') : battle)) return false;
    return true;
  }
  if (scene && game.scenes.isRegistered(scene) && scene !== 'world') {
    if (['pause', 'flag', 'shop', 'dialogue', 'settings'].includes(scene) && game.scenes.isRegistered('world')) {
      game.scenes.reset('world', { zone: game.state.world.zone });
      game.scenes.push(scene, Object.fromEntries(p.entries()));
    } else game.scenes.reset(scene, Object.fromEntries(p.entries()));
    return true;
  }
  game.scenes.reset('world', { zone: game.state.world.zone });
  return true;
}

function showBootMark(game) {
  const node = el('div', { class: 'ui-screen boot-screen', html: '<div class="boot-mark"><i></i><span>EXPEDITION 69</span></div>' });
  game.uiRoot.appendChild(node);
  return node;
}

/**
 * Boot the full game.
 * @returns {Promise<Game>}
 */
export async function boot() {
  const game = createGame();
  const mark = showBootMark(game);
  const [world, battle] = await Promise.all([
    loadSceneModule('./world/worldScene.js', 'WorldScene', 'world'),
    loadSceneModule('./battle/battleScene.js', 'BattleScene', 'battle'),
    waitForFonts(1500),
  ]);
  registerScenes(game, { world, battle });
  installDebug(game);
  let started = false;
  try {
    started = applyUrlParams(game);
  } catch (err) {
    console.error('[main] debug URL parameters failed:', err);
  }
  if (!started) game.scenes.reset('title', {});
  mark.remove();
  game.start();
  return game;
}

if (!globalThis.__EXP69_NO_BOOT__) {
  boot().catch((err) => {
    console.error('[main] boot failed', err);
    const ui = globalThis.document?.getElementById('ui');
    if (ui) ui.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;color:#f5eedf;font:20px Georgia">Expedition 69 could not start: ${String(err?.message ?? err).replace(/</g, '&lt;')}</div>`;
  });
}
